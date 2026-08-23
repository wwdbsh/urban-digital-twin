/**
 * The far-tier layer: verified tiles in, drawn primitives and honest state out.
 *
 * IT IS A RESIDENCY, NOT A ONE-SHOT LOAD, and that changed after independent
 * review. The first revision loaded every declared cell the moment the tier was
 * switched on — no distance bound, no byte accounting, no ceiling — while the
 * runtime record described "its own cache with its own ceiling and its own
 * accounting". With one baked cell nothing visible was wrong; at mass-bake scale
 * it would have fetched and uploaded the whole island to draw a ring. Loading is
 * now bounded by the SAME distance rule that bounds drawing, admission is
 * checked against the tier's own ceiling, and bytes are released when the camera
 * leaves a cell. What is still missing is named on `FAR_TIER_RUNTIME_BUDGETS`:
 * there is no eviction policy, so an over-ceiling pose refuses rather than
 * evicts.
 *
 * WHY THE STANDARD ENU TRANSFORM IS CORRECT HERE, since it looks like a place
 * that would need a bespoke matrix. The bake frame is declared as y-up with
 * axes `[east, up, -north]`, and that is exactly glTF's own convention. Cesium's
 * `Model` applies the glTF Y-up-to-Z-up conversion, mapping gltf `(x, y, z)` to
 * `(x, -z, y)`: gltf x = east becomes Cesium x = east, gltf y = up becomes
 * Cesium z = up, and gltf z = -north becomes Cesium -y = -north, i.e. y = north.
 * So `eastNorthUpToFixedFrame` at the cell's south-west corner places the tile
 * correctly with no extra rotation, and the frame declaration and the transform
 * agree rather than one silently compensating for the other.
 */

import type { Matrix4 } from "cesium";
import { Cartesian3, Model, Transforms } from "cesium";
import { farTierTileAnchor, FarTierAnchorError } from "../../runtime/far-tier-anchor";
import { farTierCellDistanceMeters, farTierCellInRange, type FarTierCameraPose, type FarTierRectangle } from "../../runtime/far-tier-selection";
import { verifiedExteriorModelResource } from "./exterior-verified-resource";
import {
  farTierAdmission, farTierAtlasRef, farTierEntryByteCost, farTierTileRef,
  loadVerifiedFarTierAtlas, loadVerifiedFarTierTile, FAR_TIER_MAX_LOADS_PER_PASS, FAR_TIER_RUNTIME_BUDGETS_V3,
  type FarTierFetcher, type FarTierInventoryEntry, type FarTierLoadOutcome,
} from "../../runtime/far-tier-serving";

/** Just enough of a Cesium scene for this layer, so tests need no viewer. */
export interface FarTierScene {
  primitives: { add(primitive: unknown): unknown; remove(primitive: unknown): boolean };
}

/**
 * A far-tier primitive as this layer uses it.
 *
 * `ready` is Cesium's own upload/parse gate. It is read rather than assumed
 * because the massing must not be dimmed for a tile that is in the scene but has
 * nothing on screen yet — see `farTierTileReady`.
 */
export interface FarTierPrimitive {
  show: boolean;
  readonly ready?: boolean;
}

export interface FarTierDrawnTile {
  readonly cellId: string;
  readonly primitive: FarTierPrimitive;
  /** The member buildings whose massing this tile is entitled to hide. */
  readonly suppressibleBuildingIds: readonly string[];
  /** The rectangle it was anchored on, which is what distance selection measures against. */
  readonly bounds: FarTierRectangle;
  /** Declared GLB + atlas bytes, which is what the residency ledger counts. */
  readonly byteCost: number;
}

/**
 * IS THIS TILE ACTUALLY ON SCREEN YET?
 *
 * `Model.fromGltfAsync` resolves when the model has been CREATED, not when it
 * has been uploaded and drawn; `ready` is the flag that says the latter. The
 * massing-side writer applies the same gate to its own primitives, and the
 * consequence of skipping it here is a visible one: show the tile and dim the
 * massing in the same pass and there are frames where the tile is not drawn and
 * the massing is at 0.4% alpha, which is a hole in the city rather than a
 * handoff.
 *
 * A primitive with no `ready` field at all is treated as NOT ready, so a stub
 * cannot accidentally claim readiness it never had.
 */
export function farTierTileReady(primitive: FarTierPrimitive): boolean {
  return primitive.ready === true;
}

/** Injectable so tests can drive the layer without a WebGL context. */
export interface FarTierModelFactory {
  (options: { url: string; modelBytes: Uint8Array; atlasUrl: string; atlasBytes: Uint8Array | null; modelMatrix: unknown }): Promise<FarTierPrimitive>;
}

/**
 * The default factory: a real Cesium `Model` built from the VERIFIED bytes.
 *
 * It goes through `verifiedExteriorModelResource` rather than a blob URL for the
 * reason that module's header gives — a glTF that references an external image
 * has nothing to resolve a relative URI against inside `blob:`, and this tile
 * always references its atlas. The resource answers for both the model and its
 * atlas out of the already-verified set, so Cesium never refetches either.
 */
export async function createFarTierModel(options: { url: string; modelBytes: Uint8Array; atlasUrl: string; atlasBytes: Uint8Array | null; modelMatrix: unknown }): Promise<FarTierPrimitive> {
  const textureUrls = new Map<string, Uint8Array>();
  if (options.atlasBytes) textureUrls.set(options.atlasUrl, options.atlasBytes);
  const resource = verifiedExteriorModelResource({ modelUrl: options.url, textureUrls }, options.modelBytes);
  return await Model.fromGltfAsync({
    url: resource,
    modelMatrix: options.modelMatrix as Matrix4,
    // NOT a picking control. Stage 0 measured that `allowPicking: false` leaves
    // the command in the pick pass as an invisible-id occluder; the Route D
    // bracket is what actually keeps this tile from taking a click. It is set
    // anyway so the tile never reports itself as a pick result if the bracket
    // is ever bypassed — a second line, not the line.
    allowPicking: false,
  }) as unknown as FarTierPrimitive;
}

export interface FarTierResidencyOptions {
  readonly scene: FarTierScene;
  readonly entries: readonly FarTierInventoryEntry[];
  readonly fetcher: FarTierFetcher;
  readonly modelFactory?: FarTierModelFactory;
  readonly budgets?: { readonly maxCacheEntries: number; readonly maxCachedBytes: number };
  /**
   * How many cells one pass may load before returning to the driver.
   *
   * AT ONE STAGED CELL THIS WAS INVISIBLE. At 840 the fill was a single
   * uninterruptible chain of fetch, hash-verify and model build, and the driver
   * only re-read the queued camera pose BETWEEN passes — so a camera move that
   * arrived during the fill waited for every remaining cell. Bounding the pass
   * turns that wait into one batch, and the driver yields to the event loop
   * between batches so the move is actually delivered.
   *
   * It is a RESPONSIVENESS control, not a budget: every selected cell still
   * loads, just across more passes.
   */
  readonly maxLoadsPerPass?: number;
  /**
   * Called the instant a primitive enters the scene, and the instant it leaves.
   *
   * AT ADD TIME, NOT AT RESOLVE TIME. The caller has to hide these primitives on
   * every pick and remove them on unmount, and a load that is aborted halfway
   * through a multi-cell ring used to leave everything it had already added in
   * the scene with nothing tracking it, because the caller only learned about
   * primitives when the whole load resolved.
   */
  readonly onPrimitiveAdded?: (primitive: FarTierPrimitive) => void;
  readonly onPrimitiveRemoved?: (primitive: FarTierPrimitive) => void;
  readonly signal?: AbortSignal;
}

export interface FarTierResidency {
  /**
   * Bring residency into line with a camera pose: load newly selected cells
   * (subject to the ceiling), release cells the camera has come inside of.
   * Resolves to whether anything changed.
   */
  reconcile(camera: FarTierCameraPose): Promise<boolean>;
  /** Outcomes for every cell that is NOT resident. Resident cells are `tiles()`. */
  outcomes(): readonly FarTierLoadOutcome[];
  tiles(): readonly FarTierDrawnTile[];
  /** Declared bytes currently charged to the far tier's own ledger. */
  residentBytes(): number;
  /** Remove everything from the scene and refuse all further work. */
  releaseAll(): void;
}

/**
 * Load, verify, place and draw far-tier tiles for the cells a camera selects.
 *
 * Fails CLOSED per cell: a tile that is absent, mismatched, unbuildable,
 * unanchorable or over the ceiling leaves the massing exactly as it was and
 * contributes its own state to the aggregate. One bad cell never prevents the
 * others from drawing.
 */
export function createFarTierResidency(options: FarTierResidencyOptions): FarTierResidency {
  const modelFactory = options.modelFactory ?? createFarTierModel;
  const maxLoadsPerPass = options.maxLoadsPerPass ?? FAR_TIER_MAX_LOADS_PER_PASS;
  const budgets = options.budgets ?? FAR_TIER_RUNTIME_BUDGETS_V3;

  /** Anchors are resolved once per cell: a cell id's rectangle never changes. */
  const anchors = new Map<string, { modelMatrix: Matrix4; bounds: FarTierRectangle } | FarTierLoadOutcome>();
  const resident = new Map<string, FarTierDrawnTile>();
  const outcomes = new Map<string, FarTierLoadOutcome>();
  /**
   * Cells already tried during the CURRENT in-range episode, so a permanently
   * absent tile is fetched once rather than on every camera move. Cleared when
   * the cell leaves the band, so approaching it again retries — which is how a
   * tile the operator restores heals without a reload.
   */
  const attempted = new Set<string>();
  let bytes = 0;
  let disposed = false;

  const aborted = (): boolean => disposed || options.signal?.aborted === true;

  const anchorFor = (cellId: string): { modelMatrix: Matrix4; bounds: FarTierRectangle } | FarTierLoadOutcome => {
    const cached = anchors.get(cellId);
    if (cached) return cached;
    let resolved: { modelMatrix: Matrix4; bounds: FarTierRectangle } | FarTierLoadOutcome;
    try {
      const anchor = farTierTileAnchor(cellId);
      resolved = {
        bounds: anchor.bounds,
        modelMatrix: Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(anchor.originLongitude, anchor.originLatitude, 0)),
      };
    } catch (error) {
      if (!(error instanceof FarTierAnchorError)) throw error;
      // A cell with no tile rectangle can never be placed, so this is decided
      // BEFORE any bytes are fetched: fetching for it would be work whose result
      // has nowhere to go.
      resolved = { cellId, state: "not-declared", detail: error.message };
    }
    anchors.set(cellId, resolved);
    return resolved;
  };

  const release = (cellId: string): void => {
    const tile = resident.get(cellId);
    if (!tile) return;
    resident.delete(cellId);
    bytes -= tile.byteCost;
    options.scene.primitives.remove(tile.primitive);
    options.onPrimitiveRemoved?.(tile.primitive);
    // FREED BYTES MAKE A REFUSAL RETRIABLE.
    //
    // `load` marks a cell attempted BEFORE the admission check, so a cell
    // refused over-budget stayed marked and `pass` skipped it forever — the
    // ceiling was permanent for that cell even once the bytes it needed were
    // free. Clearing the refusal here, at the only place bytes are ever
    // returned, is what makes the ceiling a queue rather than a verdict.
    //
    // Only `over-budget` is cleared. An absent, mismatched or unbuildable tile
    // is not fixed by another cell leaving, and retrying it would be a fetch
    // loop over a file that is not going to change.
    for (const [refusedId, outcome] of outcomes) {
      if (outcome.state !== "over-budget") continue;
      outcomes.delete(refusedId);
      attempted.delete(refusedId);
    }
  };

  const load = async (entry: FarTierInventoryEntry, anchor: { modelMatrix: Matrix4; bounds: FarTierRectangle }): Promise<boolean> => {
    attempted.add(entry.cellId);
    const cost = farTierEntryByteCost(entry);
    // ADMISSION BEFORE FETCH. A refusal that happens after the bytes are on the
    // wire has not saved anything the ceiling exists to save.
    const refusal = farTierAdmission({ entries: resident.size, bytes }, cost, budgets);
    if (refusal !== null) {
      outcomes.set(entry.cellId, { cellId: entry.cellId, state: "over-budget", detail: `${farTierTileRef(entry.cellId)}: ${refusal}` });
      return true;
    }

    const tile = await loadVerifiedFarTierTile(entry, options.fetcher, options.signal);
    if (aborted()) return false;
    if (!tile.bytes) { outcomes.set(entry.cellId, tile.outcome); return true; }

    // The atlas is verified against its OWN declaration before a texel of it is
    // uploaded. Absence is still not mismatch: an atlas that cannot be fetched
    // leaves an untextured tile, an atlas whose bytes are wrong fails the tile.
    const atlas = await loadVerifiedFarTierAtlas(entry, options.fetcher, options.signal);
    if (aborted()) return false;
    if (atlas.outcome) { outcomes.set(entry.cellId, atlas.outcome); return true; }

    let primitive: FarTierPrimitive;
    try {
      primitive = await modelFactory({
        url: `/${farTierTileRef(entry.cellId)}`,
        modelBytes: tile.bytes,
        atlasUrl: `/${farTierAtlasRef(entry.cellId)}`,
        atlasBytes: atlas.bytes ?? null,
        modelMatrix: anchor.modelMatrix,
      });
    } catch (error) {
      // VERIFIED BYTES THAT WILL NOT BUILD ARE NOT A MISMATCH. They matched
      // their declaration exactly; something else about them — or about this
      // renderer — could not turn them into geometry. Reporting it as a mismatch
      // accuses the staging of an integrity failure it did not commit.
      outcomes.set(entry.cellId, { cellId: entry.cellId, state: "build-failure", detail: `${farTierTileRef(entry.cellId)}: verified bytes did not build a model: ${(error as Error).message}` });
      return true;
    }
    if (aborted()) return false;

    // Starts HIDDEN. Selection decides whether it is shown, so a tile can never
    // appear for a frame at a distance the tier does not serve.
    primitive.show = false;
    options.scene.primitives.add(primitive);
    // Tracked in the same synchronous breath as the add, so there is no instant
    // at which a primitive is in the scene and unknown to the thing that removes
    // it or hides it for a pick.
    resident.set(entry.cellId, {
      cellId: entry.cellId,
      primitive,
      suppressibleBuildingIds: entry.members.filter((member) => member.included).map((member) => member.buildingId),
      bounds: anchor.bounds,
      byteCost: cost,
    });
    bytes += cost;
    outcomes.delete(entry.cellId);
    options.onPrimitiveAdded?.(primitive);
    if (aborted()) release(entry.cellId);
    return true;
  };

  const pass = async (camera: FarTierCameraPose): Promise<boolean> => {
    let changed = false;
    const candidates: Array<{ entry: FarTierInventoryEntry; anchor: { modelMatrix: Matrix4; bounds: FarTierRectangle }; distance: number }> = [];

    for (const entry of options.entries) {
      const anchor = anchorFor(entry.cellId);
      if ("state" in anchor) { outcomes.set(entry.cellId, anchor); continue; }
      const isResident = resident.has(entry.cellId);
      const distance = farTierCellDistanceMeters(camera, anchor.bounds);
      // THE SAME PREDICATE THAT DECIDES DRAWING DECIDES LOADING, hysteresis and
      // all, so bytes are never held for a cell the tier would not draw.
      if (!farTierCellInRange(distance, isResident)) {
        if (isResident) { release(entry.cellId); changed = true; }
        attempted.delete(entry.cellId);
        outcomes.set(entry.cellId, { cellId: entry.cellId, state: "near" });
        continue;
      }
      if (isResident) continue;
      if (attempted.has(entry.cellId)) continue;
      candidates.push({ entry, anchor, distance });
    }

    // NEAREST FIRST, so a pose that cannot afford every selected cell spends the
    // ceiling on the cells the viewer is closest to rather than on inventory
    // order, which is an arbitrary way to decide what a user sees.
    candidates.sort((left, right) => left.distance - right.distance);
    // ONE BATCH PER PASS. `pending` tells the driver there is more to do, so it
    // comes back after yielding instead of holding the main thread for the
    // whole island.
    const batch = candidates.slice(0, maxLoadsPerPass);
    pending = candidates.length > batch.length;
    for (const candidate of batch) {
      if (aborted()) break;
      if (await load(candidate.entry, candidate.anchor)) changed = true;
    }
    return changed;
  };

  let running = false;
  let queued: FarTierCameraPose | null = null;
  let lastPose: FarTierCameraPose | null = null;
  let pending = false;
  let current: Promise<boolean> = Promise.resolve(false);

  /**
   * Hand the main thread back between batches.
   *
   * A microtask is not enough: the camera pose arrives from a Cesium event, and
   * only a macrotask boundary lets that event run. `setTimeout(0)` is the
   * smallest one available in both the browser and the test environment.
   */
  const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

  const drain = async (): Promise<boolean> => {
    running = true;
    let changed = false;
    try {
      // The loop re-reads `queued` synchronously after each pass, so a camera
      // move that arrives mid-pass is served rather than dropped, and two passes
      // never run concurrently over the same residency maps. `pending` keeps it
      // going when the fill was cut short by the batch bound rather than by a
      // new pose.
      while ((queued || pending) && !aborted()) {
        const pose = queued ?? lastPose;
        queued = null;
        if (!pose) break;
        lastPose = pose;
        changed = (await pass(pose)) || changed;
        if (pending && !queued && !aborted()) await yieldToEventLoop();
      }
    } finally {
      running = false;
    }
    return changed;
  };

  return {
    reconcile(camera: FarTierCameraPose): Promise<boolean> {
      if (aborted()) return Promise.resolve(false);
      queued = camera;
      if (!running) current = drain();
      return current;
    },
    outcomes(): readonly FarTierLoadOutcome[] {
      return [...outcomes.values()].filter((outcome) => !resident.has(outcome.cellId));
    },
    tiles(): readonly FarTierDrawnTile[] {
      return [...resident.values()];
    },
    residentBytes(): number {
      return bytes;
    },
    releaseAll(): void {
      disposed = true;
      pending = false;
      for (const cellId of [...resident.keys()]) release(cellId);
      attempted.clear();
    },
  };
}
