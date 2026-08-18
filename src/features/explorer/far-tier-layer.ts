/**
 * The far-tier layer: verified tiles in, drawn primitives and honest state out.
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
import { verifiedExteriorModelResource } from "./exterior-verified-resource";
import {
  farTierAtlasRef, farTierTileRef, loadVerifiedFarTierTile,
  type FarTierFetcher, type FarTierInventoryEntry, type FarTierLoadOutcome,
} from "../../runtime/far-tier-serving";

/** Just enough of a Cesium scene for this layer, so tests need no viewer. */
export interface FarTierScene {
  primitives: { add(primitive: unknown): unknown; remove(primitive: unknown): boolean };
}

export interface FarTierDrawnTile {
  readonly cellId: string;
  readonly primitive: { show: boolean };
  /** The member buildings whose massing this tile is entitled to hide. */
  readonly suppressibleBuildingIds: readonly string[];
  /** The rectangle it was anchored on, which is what distance selection measures against. */
  readonly bounds: { west: number; south: number; east: number; north: number };
}

export interface FarTierLoadResult {
  readonly outcomes: readonly FarTierLoadOutcome[];
  readonly drawn: readonly FarTierDrawnTile[];
}

/** Injectable so tests can drive the layer without a WebGL context. */
export interface FarTierModelFactory {
  (options: { url: string; modelBytes: Uint8Array; atlasUrl: string; atlasBytes: Uint8Array | null; modelMatrix: unknown }): Promise<{ show: boolean }>;
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
export async function createFarTierModel(options: { url: string; modelBytes: Uint8Array; atlasUrl: string; atlasBytes: Uint8Array | null; modelMatrix: unknown }): Promise<{ show: boolean }> {
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
  }) as unknown as { show: boolean };
}

/**
 * Load, verify, place and draw the far-tier tiles for a set of declared cells.
 *
 * Fails CLOSED per cell: a tile that is absent, mismatched, or unanchorable
 * leaves the massing exactly as it was and contributes its own state to the
 * aggregate. One bad cell never prevents the others from drawing.
 */
export async function loadFarTierLayer(
  scene: FarTierScene,
  entries: readonly FarTierInventoryEntry[],
  fetcher: FarTierFetcher,
  modelFactory: FarTierModelFactory = createFarTierModel,
  signal?: AbortSignal,
): Promise<FarTierLoadResult> {
  const outcomes: FarTierLoadOutcome[] = [];
  const drawn: FarTierDrawnTile[] = [];

  for (const entry of entries) {
    // The anchor is resolved BEFORE any bytes are fetched. A cell with no tile
    // rectangle can never be placed, so fetching for it would be work whose
    // result has nowhere to go.
    let modelMatrix: Matrix4;
    let bounds: { west: number; south: number; east: number; north: number };
    try {
      const anchor = farTierTileAnchor(entry.cellId);
      bounds = anchor.bounds;
      modelMatrix = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(anchor.originLongitude, anchor.originLatitude, 0));
    } catch (error) {
      if (!(error instanceof FarTierAnchorError)) throw error;
      outcomes.push({ cellId: entry.cellId, state: "not-declared", detail: error.message });
      continue;
    }

    const { outcome, bytes } = await loadVerifiedFarTierTile(entry, fetcher, signal);
    if (!bytes) { outcomes.push(outcome); continue; }

    // The atlas is fetched but NOT failed-closed on independently: a tile whose
    // geometry verified is still a better draw than tan massing, and a missing
    // atlas shows as an untextured tile rather than as a refusal.
    let atlasBytes: Uint8Array | null;
    try { atlasBytes = await fetcher(farTierAtlasRef(entry.cellId), signal); } catch { atlasBytes = null; }

    try {
      const primitive = await modelFactory({
        url: `/${farTierTileRef(entry.cellId)}`,
        modelBytes: bytes,
        atlasUrl: `/${farTierAtlasRef(entry.cellId)}`,
        atlasBytes,
        modelMatrix,
      });
      // Starts HIDDEN. Selection decides whether it is shown, so a tile can
      // never appear for a frame at a distance the tier does not serve.
      primitive.show = false;
      scene.primitives.add(primitive);
      outcomes.push({ cellId: entry.cellId, state: "near" });
      drawn.push({
        cellId: entry.cellId,
        primitive,
        suppressibleBuildingIds: entry.members.filter((member) => member.included).map((member) => member.buildingId),
        bounds,
      });
    } catch (error) {
      // A model that will not build leaves the massing alone. It is reported as
      // a mismatch class rather than absence: the bytes were there and verified,
      // and something about them could not be turned into geometry.
      outcomes.push({ cellId: entry.cellId, state: "checksum-mismatch", detail: `${farTierTileRef(entry.cellId)}: verified bytes did not build a model: ${(error as Error).message}` });
    }
  }
  return { outcomes, drawn };
}
