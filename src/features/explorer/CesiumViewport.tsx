import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEventHandler } from "react";
import {
  Cartesian3,
  Cartesian2,
  Cartographic,
  CameraEventType,
  Color,
  ColorGeometryInstanceAttribute,
  ConstantProperty,
  EllipsoidTerrainProvider,
  GridImageryProvider,
  HeightReference,
  ImageryLayer,
  Matrix3,
  Matrix4,
  ModelGraphics,
  Math as CesiumMath,
  PolygonHierarchy,
  PolygonGeometry,
  GeometryInstance,
  PerInstanceColorAppearance,
  Primitive,
  PointPrimitiveCollection,
  ShowGeometryInstanceAttribute,
  PrimitiveCollection,
  KeyboardEventModifier,
  ScreenSpaceEventType,
  Quaternion,
  SceneTransforms,
  Transforms,
  VertexFormat,
  Viewer,
} from "cesium";
import type { Feature, Position } from "../../domain/schema";
import type { Itinerary } from "../../domain/routing";
import { layerForFeature, type LayerVisibility, type RuntimeLayerId } from "../../runtime/layers";
import type { RuntimeCityAdapter } from "../../runtime/fixture-adapter";
import type { TileCameraState } from "../../runtime/tile-stream";
import type { CameraPose } from "../../domain/visitor-navigation";
import type { CityAssetResolver } from "../../runtime/city-asset-manifest";
import { EXTERIOR_PILOT_RELEASE_ID, type CommercialStorefrontPlacement, type LoadedExteriorPilotRelease } from "../../runtime/exterior-pilot-release";
import { publicRealmFeatureToFeature, type Block835PublicRealmFeature, type LoadedBlock835PublicRealmRelease } from "../../runtime/block835-public-realm-release";
import type { ExteriorCellOutcome, ExteriorCellRenderPlan } from "../../runtime/exterior-cell-runtime";
import type { ExteriorRenderProfile } from "../../runtime/exterior-render-profiles";
import { verifiedExteriorModelResource, type VerifiedExteriorResource } from "./exterior-verified-resource";
import { createFarTierPickBracket, FAR_TIER_MASSING_PICK_ALPHA, type FarTierHideable } from "./far-tier-pick-bracket";
import { createFarTierResidency, farTierTileReady, type FarTierDrawnTile } from "./far-tier-layer";
import { createFarTierFetcher, farTierFailureDetail, parseVerifiedFarTierInventory, summarizeFarTierState, FAR_TIER_PAYLOAD_INVENTORY_REF, type FarTierCellState, type FarTierLoadOutcome, type FarTierStateSummary } from "../../runtime/far-tier-serving";
import { farTierCellDistanceMeters, farTierCellInRange } from "../../runtime/far-tier-selection";
import {
  boundFootprintToCamera,
  viewportFootprintFromGroundPoints,
  viewportBoundsIntersect,
  type ViewportBounds,
  type ViewportFootprint,
} from "../../runtime/viewport-footprint";

interface CesiumViewportProps {
  adapter: RuntimeCityAdapter;
  /** T003 opt-in: draw baked far-tier tiles over the massing they replace. */
  farTier?: boolean;
  /** One aggregate line for the far tier, never one notice per cell. */
  onFarTierState?: (summary: FarTierStateSummary) => void;
  focusRequest: number;
  focusFeatureId: string | null;
  focusOverlayOpen?: boolean;
  visibleLayers: LayerVisibility;
  onFeatureSelected: (feature: Feature) => void;
  onFeatureOverlap?: (features: Feature[]) => void;
  featureFilter?: (feature: Feature) => boolean;
  itinerary?: Itinerary | null;
  previewRequest?: { action: "start" | "pause" | "stop" | "previous" | "next" | "focus"; requestId: number };
  denseRendering?: boolean;
  denseFeatures?: Feature[];
  denseFeatureLimit?: number;
  denseFeatureGroups?: DenseFeatureGroups;
  denseFeatureGroupLimits?: { base: number; context: number };
  onDenseMetrics?: (metrics: DenseRenderMetrics) => void;
  selectedFeatureId?: string | null;
  onCameraChanged?: (camera: CameraPose, footprint?: ViewportFootprint) => void;
  viewportFootprint?: ViewportFootprint | null;
  cameraRequest?: (TileCameraState | CameraPose) & { requestId: number };
  cameraPoseRequest?: (CameraPose & { requestId: number });
  onViewportKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  assetResolver?: CityAssetResolver;
  commercialOverlay?: LoadedExteriorPilotRelease | null;
  onStorefrontSelected?: (placement: CommercialStorefrontPlacement) => void;
  publicRealmOverlay?: LoadedBlock835PublicRealmRelease | null;
  onPublicRealmSelected?: (feature: Block835PublicRealmFeature) => void;
  /**
   * The exterior wave(s) to render. A build may promote more than one, so this
   * accepts an ordered set; a single overlay stays accepted unchanged.
   */
  exteriorOverlay?: ExteriorCellOverlaySet;
  onExteriorUnanchored?: (canonicalFeatureIds: string[]) => void;
  /**
   * Cells this pass removed from the scene AND whose object URLs it has just
   * revoked, reported after the revoke rather than before it.
   *
   * The viewport is the only holder of the Blob copy of an exterior cell's
   * bytes, so it is the only component that can say the copy is gone. T003's
   * cache release seam treats this as gate (d): until it fires for a cell,
   * deleting that cell's cache entries would free the cache's reference while a
   * live Blob still held an independent copy of the same bytes.
   */
  onExteriorCellsRetired?: (cellIds: readonly string[]) => void;
  onStage3RenderProof?: (proof: Stage3RenderProof | null) => void;
}

/**
 * Verified exterior cells handed to the viewport as bytes, not paths. The
 * runtime already checksum-verified and canonically bound every GLB, so the
 * viewport must never re-resolve an artifact by path (a second fetch would
 * reopen a time-of-check/time-of-use gap and escape the request accounting).
 */
export interface ExteriorCellOverlay {
  releaseId: string;
  snapshotId: string;
  origin: "default" | "canary";
  profile: ExteriorRenderProfile;
  cells: readonly ExteriorCellOutcome[];
}

/** One wave or the ordered set of them; `null`/absent is "no exterior wave". */
export type ExteriorCellOverlaySet = ExteriorCellOverlay | readonly ExteriorCellOverlay[] | null | undefined;

function exteriorOverlayList(overlay: ExteriorCellOverlaySet): readonly ExteriorCellOverlay[] {
  if (!overlay) return [];
  return Array.isArray(overlay) ? overlay as readonly ExteriorCellOverlay[] : [overlay as ExteriorCellOverlay];
}

export interface DenseRenderMetrics {
  featureCount: number;
  primitiveCount: number;
  instanceCount: number;
  buildingFeatureCount: number;
  pointFeatureCount: number;
  baseFeatureCount?: number;
  contextFeatureCount?: number;
  contextPartCount?: number;
  /**
   * `exteriorRenderedCanonicalFeatureIds(...).size` — the canonical features
   * that are LIVE exterior entities in this scene and are therefore suppressed
   * from the dense pass. It is the honest rendered unit for a detail-radius
   * measurement: scheduled cell counts describe residency intent, and
   * `buildingFeatureCount` describes what the dense pass drew, but only this
   * number says how many buildings the V3 overlay is actually showing.
   */
  exteriorSuppressedFeatureCount?: number;
  /**
   * Instances the built layer holds but does not draw, because the exterior
   * wave or a pilot asset owns them right now. The layer is built over the
   * whole membership so that suppression is a `show` flip; this field is the
   * difference between what was tessellated and what `buildingFeatureCount`
   * reports as drawn.
   */
  denseSuppressedInstanceCount?: number;
  /** Counters make repeated dense-plan work observable in the local diagnostics. */
  planBuildCount?: number;
  planReuseCount?: number;
  planCancellationCount?: number;
  planSwapCount?: number;
  /** Suppression-only updates served by `show` flips instead of a rebuild. */
  planSuppressionUpdateCount?: number;
  /** Individual instances whose `show` was flipped, summed over the session. */
  planSuppressionFlipCount?: number;
  planFingerprint?: string;
  selectionMs?: number;
  keyMs?: number;
  allocationMs?: number;
  allocationMaxSliceMs?: number;
  allocationChunkCount?: number;
  workerReadyMs?: number;
  totalBuildMs?: number;
  /**
   * The double-draw window, measured against its own definition rather than by
   * a build-duration proxy (ADR 0044 D-9 leg Y). `doubleDrawOpenedAt` is the
   * moment the FIRST pending layer of the current uncommitted chain entered
   * `rootDenseCollection` — including chains whose earlier builds were
   * cancelled, which is exactly what a `totalBuildMs` proxy undercounts.
   */
  pendingLayerAddedAt?: number;
  doubleDrawOpenedAt?: number;
  previousLayerRemovedAt?: number;
  doubleDrawMs?: number;
}

/**
 * A release can expose fewer layers than the shared visibility model.  Probe
 * the manifest before scheduling a load so an initial fixture adapter cannot
 * leave an unhandled rejected promise while the compatible real adapter is
 * being selected.
 */
export function supportedVisibleLayers(
  adapter: Pick<RuntimeCityAdapter, "getLayerManifest">,
  visibleLayers: LayerVisibility,
): RuntimeLayerId[] {
  return (Object.keys(visibleLayers) as RuntimeLayerId[]).filter((layer) => {
    if (!visibleLayers[layer]) return false;
    try {
      adapter.getLayerManifest(layer);
      return true;
    } catch (error) {
      if (error instanceof Error && error.message === `Unknown runtime layer: ${layer}`) return false;
      throw error;
    }
  });
}

interface PendingDenseBuild {
  complete: boolean;
  result: DenseBuildResult | null;
  cancel: () => void;
}

// Polygon hierarchy allocation is still JavaScript work even when Cesium's
// primitive compilation is asynchronous. Keep each visible-frame slice small.
const DENSE_BUILD_CHUNK_SIZE = 120;
// A handful of asynchronous worker jobs avoids both the old per-chunk
// primitive churn and one monolithic main-thread-ready upload.
const DENSE_PRIMITIVE_GROUP_SIZE = 1_500;

interface DenseBuildResult {
  metrics: DenseRenderMetrics;
  /** Where each built instance lives, so a later ownership change is a write. */
  index: DenseInstanceIndex;
  /** The ownership set the instances were CREATED with, so the commit can reconcile. */
  builtSuppressedIds: ReadonlySet<string>;
  builtBuildingCount: number;
  builtPointCount: number;
  primitiveCount: number;
  hiddenBuildingCount: number;
  hiddenPointCount: number;
  startedAt: number;
  allocationMs: number;
  allocationMaxSliceMs: number;
  allocationChunkCount: number;
  allocationCompletedAt: number;
}

interface DenseRenderTelemetry {
  planBuildCount: number;
  planReuseCount: number;
  planCancellationCount: number;
  planSwapCount: number;
  planSuppressionUpdateCount: number;
  planSuppressionFlipCount: number;
  planFingerprint: string;
  selectionMs: number;
  keyMs: number;
  allocationMs?: number;
  allocationMaxSliceMs?: number;
  allocationChunkCount?: number;
  workerReadyMs?: number;
  totalBuildMs?: number;
  denseSuppressedInstanceCount?: number;
  pendingLayerAddedAt?: number;
  doubleDrawOpenedAt?: number;
  previousLayerRemovedAt?: number;
  doubleDrawMs?: number;
}

const EMPTY_DENSE_RENDER_TELEMETRY: DenseRenderTelemetry = {
  planBuildCount: 0,
  planReuseCount: 0,
  planCancellationCount: 0,
  planSwapCount: 0,
  planSuppressionUpdateCount: 0,
  planSuppressionFlipCount: 0,
  planFingerprint: "",
  selectionMs: 0,
  keyMs: 0,
};

export interface DenseFeatureGroups {
  base: Feature[];
  context: Feature[];
}

export function commercialStorefrontProxyId(storefrontId: string): string {
  return `commercial-storefront:${storefrontId}`;
}

export function publicRealmProxyId(featureId: string): string {
  return `public-realm:feature:${featureId}`;
}

export function publicRealmAssetEntityId(semantic: string): string {
  return `public-realm:asset:${semantic}`;
}

/** Public-realm source geometry has no point primitive; use its first coordinate as a stable pick proxy. */
export function publicRealmRepresentative(feature: Block835PublicRealmFeature): readonly [number, number] | null {
  let result: readonly [number, number] | null = null;
  const walk = (part: unknown): void => {
    if (result || !Array.isArray(part)) return;
    if (part.length >= 2 && typeof part[0] === "number" && typeof part[1] === "number") {
      if (Number.isFinite(part[0]) && Number.isFinite(part[1])) result = [part[0], part[1]];
      return;
    }
    part.forEach(walk);
  };
  walk(feature.geometry.coordinates);
  return result;
}

/**
 * Stable across LOD and profile swaps: the LOD is a rendering choice, not an
 * identity, so it never enters the entity ID or the pick path.
 */
export function exteriorCellEntityId(cellId: string, canonicalFeatureId: string): string {
  return `exterior-cell:${cellId}:${canonicalFeatureId}`;
}

export interface ExteriorCellRenderEntry {
  entityId: string;
  cellId: string;
  cellReleaseId: string;
  representation: ExteriorCellRenderPlan["representation"];
  canonicalFeatureId: string;
  lodId: string;
  checksumSha256: string;
  byteSize: number;
  bytes: Uint8Array;
  geometricErrorMeters: number;
  provenance: ExteriorCellRenderPlan["assets"][number]["provenance"];
  /**
   * Release attribution of the wave this entry came from. It rides on the ENTRY
   * rather than on the scene as a whole because a build may render more than
   * one wave at once, and an entity stamped with a session-wide release id
   * would then attribute some of its geometry to a release that did not ship
   * it. Every consumer of this attribution must read it from the entry.
   */
  releaseId: string;
  snapshotId: string;
  origin: "default" | "canary";
  profile: ExteriorRenderProfile;
  /**
   * Present only when the RELEASE ships its detail tiles as shared artifacts.
   * Its presence is what selects the verified-resource branch below; its
   * absence — every release frozen before this seam — keeps the Blob path
   * byte-identical.
   */
  sharedTextures?: ExteriorCellRenderPlan["assets"][number]["sharedTextures"];
}

/** Only cells the runtime actually verified reach the scene; failures render nothing. */
export function exteriorOverlayRenderEntries(overlay: ExteriorCellOverlaySet): ExteriorCellRenderEntry[] {
  return exteriorOverlayList(overlay)
    .flatMap((wave) => wave.cells
      .filter((cell): cell is ExteriorCellRenderPlan => cell.kind === "rendered")
      .flatMap((cell) => cell.assets.map((asset) => ({
        entityId: exteriorCellEntityId(cell.cellId, asset.canonicalFeatureId),
        cellId: cell.cellId,
        cellReleaseId: cell.cellReleaseId,
        representation: cell.representation,
        canonicalFeatureId: asset.canonicalFeatureId,
        lodId: asset.lodId,
        checksumSha256: asset.checksumSha256,
        byteSize: asset.byteSize,
        bytes: asset.bytes,
        geometricErrorMeters: asset.geometricErrorMeters,
        provenance: asset.provenance,
        ...(asset.sharedTextures ? { sharedTextures: asset.sharedTextures } : {}),
        releaseId: wave.releaseId,
        snapshotId: wave.snapshotId,
        origin: wave.origin,
        profile: wave.profile,
      }))))
    .sort((left, right) => (left.entityId < right.entityId ? -1 : left.entityId > right.entityId ? 1 : 0));
}

/**
 * Base features whose geometry the exterior wave takes over this frame.
 *
 * Only `rendered` cells produce render entries, so a cell that failed
 * verification contributes nothing here and the base representation of its
 * buildings stays on screen: coverage fails open to the base, never to a hole.
 */
export function exteriorCoveredCanonicalFeatureIds(overlay: ExteriorCellOverlaySet): ReadonlySet<string> {
  return new Set(exteriorOverlayRenderEntries(overlay).map((entry) => entry.canonicalFeatureId));
}

/**
 * Base features whose exterior geometry is ACTUALLY IN THE SCENE right now.
 *
 * Coverage alone is not enough to suppress a building's base representation,
 * and the difference is not academic. A verified entry is withheld when its
 * base building record has not streamed yet, because there is no verified WGS84
 * anchor for it — that is the `unanchoredCanonicalFeatureIds` path, and it is
 * the normal state of a wave the moment it loads. Suppressing on coverage
 * removed the base for every one of those buildings while their exterior was
 * still being withheld, so both disappeared and the viewport went black.
 *
 * Suppression therefore keys on the live exterior pick map, which holds exactly
 * the entities the exterior pass added to the scene. Intersecting it with
 * coverage keeps it honest in the other direction too: an entity left over from
 * a wave that is no longer in the overlay suppresses nothing.
 *
 * Both failure modes now fail open to the base: a failed cell contributes no
 * coverage, and a withheld cell contributes no entity.
 */
export function exteriorRenderedCanonicalFeatureIds(
  overlay: ExteriorCellOverlaySet,
  liveExteriorPickMap: ReadonlyMap<string, string>,
): ReadonlySet<string> {
  const covered = exteriorCoveredCanonicalFeatureIds(overlay);
  const rendered = new Set<string>();
  for (const canonicalFeatureId of liveExteriorPickMap.values()) {
    if (covered.has(canonicalFeatureId)) rendered.add(canonicalFeatureId);
  }
  return rendered;
}

export type DenseFeatureRenderOwner = "exterior-wave" | "pilot-asset" | "procedural-extrusion";

/**
 * The single precedence authority for who draws one base building:
 * exterior wave > pilot asset > procedural extrusion.
 *
 * Block 835 buildings sit in the pilot resolver set *and* in the exterior wave,
 * so without one shared rule each of them is drawn twice — once as verified
 * exterior geometry and once as the pilot model or the procedural extrusion
 * underneath it (Issue #41). Every draw path consults this function.
 *
 * `exteriorRenderedIds` must be geometry that IS IN THE SCENE, not geometry
 * that was verified — see `exteriorRenderedCanonicalFeatureIds`. Passing
 * coverage here removes the base for buildings whose exterior is still withheld
 * for want of an anchor, and leaves nothing drawn at all.
 */
export function denseFeatureRenderOwner(
  featureId: string,
  exteriorRenderedIds: ReadonlySet<string>,
  assetBuildingIds: ReadonlySet<string>,
): DenseFeatureRenderOwner {
  if (exteriorRenderedIds.has(featureId)) return "exterior-wave";
  if (assetBuildingIds.has(featureId)) return "pilot-asset";
  return "procedural-extrusion";
}

/**
 * Selection feedback for exterior geometry.
 *
 * The base entity that used to carry selection styling is gone once the
 * exterior wave owns the building, so the exterior model itself has to show the
 * selection. It is a silhouette rather than a rebuilt entity: selection must not
 * churn the per-cell collections that own the verified bytes.
 */
export const EXTERIOR_SELECTION_SILHOUETTE_CSS_COLOR = "#63f3c5" as const;
export const EXTERIOR_SELECTION_SILHOUETTE_SIZE_PIXELS = 3 as const;

export function exteriorSelectionSilhouetteSize(canonicalFeatureId: string, selectedFeatureId: string | null | undefined): number {
  return canonicalFeatureId === selectedFeatureId ? EXTERIOR_SELECTION_SILHOUETTE_SIZE_PIXELS : 0;
}

/**
 * What the owned-collection reducer needs to place geometry. Wave attribution
 * is optional here and REQUIRED on `ExteriorCellRenderEntry`: everything the
 * overlay projection actually hands the scene carries its release, while the
 * reducer stays usable for callers that only describe placements.
 */
export type ExteriorCellRenderPlacement =
  Omit<ExteriorCellRenderEntry, "releaseId" | "snapshotId" | "origin" | "profile">
  & Partial<Pick<ExteriorCellRenderEntry, "releaseId" | "snapshotId" | "origin" | "profile">>;

/**
 * Diff key for one cell's owned collection; a change replaces exactly that cell.
 * Release attribution is part of the key: the same cell resolved from a
 * different wave, snapshot, or head origin is different scene state, and the
 * entity properties that carry that attribution have to be rebuilt with it.
 */
export function exteriorCellSignature(entries: readonly ExteriorCellRenderPlacement[]): string {
  return entries.map((entry) => `${entry.entityId}|${entry.cellReleaseId}|${entry.representation}|${entry.lodId}|${entry.checksumSha256}|${entry.releaseId ?? ""}|${entry.snapshotId ?? ""}|${entry.origin ?? ""}|${entry.profile ?? ""}`).join(";");
}

export interface ExteriorOverlayAnchor {
  longitude: number;
  latitude: number;
  name: string;
}

export interface ExteriorOwnedCellCollection {
  entityIds: string[];
  objectUrls: string[];
  signature: string;
  /**
   * False when at least one verified asset of this cell had no resolvable base
   * anchor on the pass that built it. An incomplete cell is never retained, so
   * a later pass retries it once the base feature is available.
   */
  complete: boolean;
}

export interface ExteriorOverlayCellPlan<T extends ExteriorCellRenderPlacement = ExteriorCellRenderEntry> {
  cellId: string;
  signature: string;
  complete: boolean;
  adds: Array<{ entry: T; anchor: ExteriorOverlayAnchor }>;
  unanchoredCanonicalFeatureIds: string[];
}

export interface ExteriorOverlayPlan<T extends ExteriorCellRenderPlacement = ExteriorCellRenderEntry> {
  removeCellIds: string[];
  removeEntityIds: string[];
  revokeObjectUrls: string[];
  retainedCellIds: string[];
  addCells: ExteriorOverlayCellPlan<T>[];
  unanchoredCanonicalFeatureIds: string[];
}

/**
 * The four mutations retiring an exterior cell performs, AS AN ORDERED LIST.
 *
 * These used to be four loops inlined in the effect, and their ORDER carried a
 * contract that nothing checked: the retirement notification must come after
 * the object URLs are revoked, because T003's cache release seam treats it as
 * evidence that the Blob copies of the bytes are gone. A notification sent
 * ahead of the revoke would be a promise, and the seam would free cache bytes
 * while a live Blob still held an independent copy of them.
 *
 * Emitting the steps instead of performing them lets that ordering be asserted
 * against THIS file rather than against a test's re-statement of it. The effect
 * below executes exactly what this returns, in exactly this order.
 */
export type ExteriorRetirementStep =
  | { op: "remove-entity"; entityId: string }
  | { op: "forget-pick"; entityId: string }
  | { op: "revoke-object-url"; objectUrl: string }
  | { op: "forget-cell"; cellId: string }
  | { op: "report-retired"; cellIds: readonly string[] };

export function exteriorRetirementSteps(plan: Pick<ExteriorOverlayPlan<ExteriorCellRenderPlacement>, "removeCellIds" | "removeEntityIds" | "revokeObjectUrls">): ExteriorRetirementStep[] {
  const steps: ExteriorRetirementStep[] = [];
  for (const entityId of plan.removeEntityIds) {
    steps.push({ op: "remove-entity", entityId });
    // The pick map entry goes with the entity, always in the same step pair: a
    // surviving entry would resolve a stale entity id to a canonical feature
    // the scene is no longer drawing.
    steps.push({ op: "forget-pick", entityId });
  }
  for (const objectUrl of plan.revokeObjectUrls) steps.push({ op: "revoke-object-url", objectUrl });
  for (const cellId of plan.removeCellIds) steps.push({ op: "forget-cell", cellId });
  if (plan.removeCellIds.length > 0) steps.push({ op: "report-retired", cellIds: plan.removeCellIds });
  return steps;
}

/**
 * Pure diff between the currently owned per-cell collections and the verified
 * entries the runtime produced. Keeping this outside the imperative Cesium
 * effect makes the retry, isolation, and object-URL revocation rules testable.
 */
export function planExteriorOverlayUpdate<T extends ExteriorCellRenderPlacement>(
  entries: readonly T[],
  owned: ReadonlyMap<string, ExteriorOwnedCellCollection>,
  anchorFor: (entry: T) => ExteriorOverlayAnchor | null,
): ExteriorOverlayPlan<T> {
  const byCell = new Map<string, T[]>();
  for (const entry of entries) byCell.set(entry.cellId, [...(byCell.get(entry.cellId) ?? []), entry]);
  const removeCellIds: string[] = [];
  const removeEntityIds: string[] = [];
  const revokeObjectUrls: string[] = [];
  const retainedCellIds: string[] = [];
  for (const [cellId, collection] of owned) {
    const next = byCell.get(cellId);
    if (next && collection.complete && collection.signature === exteriorCellSignature(next)) { retainedCellIds.push(cellId); continue; }
    removeCellIds.push(cellId);
    removeEntityIds.push(...collection.entityIds);
    revokeObjectUrls.push(...collection.objectUrls);
  }
  const retained = new Set(retainedCellIds);
  const addCells: ExteriorOverlayCellPlan<T>[] = [];
  const unanchored: string[] = [];
  for (const [cellId, cellEntries] of byCell) {
    if (retained.has(cellId)) continue;
    const adds: ExteriorOverlayCellPlan<T>["adds"] = [];
    const missing: string[] = [];
    for (const entry of cellEntries) {
      const anchor = anchorFor(entry);
      if (anchor) adds.push({ entry, anchor });
      else missing.push(entry.canonicalFeatureId);
    }
    unanchored.push(...missing);
    addCells.push({ cellId, signature: exteriorCellSignature(cellEntries), complete: missing.length === 0, adds, unanchoredCanonicalFeatureIds: missing });
  }
  return { removeCellIds, removeEntityIds, revokeObjectUrls, retainedCellIds, addCells, unanchoredCanonicalFeatureIds: [...new Set(unanchored)].sort() };
}

/** One explicit line naming verified geometry that was withheld for want of an anchor. */
export function exteriorUnanchoredNotice(canonicalFeatureIds: readonly string[]): string | null {
  if (canonicalFeatureIds.length === 0) return null;
  return `Exterior geometry for ${canonicalFeatureIds.length} verified building${canonicalFeatureIds.length === 1 ? "" : "s"} (${canonicalFeatureIds.join(", ")}) is not drawn: the matching base building record is not loaded, so there is no verified WGS84 anchor for it. It will be drawn once that base record loads.`;
}

/**
 * Exterior canonical feature IDs are base building IDs, so an exterior pick
 * resolves through the existing canonical cascade to the same base feature the
 * dense layer would have produced. Pick precedence therefore stays exactly:
 * storefront proxy, then base feature (including exterior geometry), then
 * public-realm proxy. This helper only translates an exterior entity ID; it
 * does not reorder the cascade.
 */
export function canonicalExteriorPickId(pickedId: string, exteriorPickMap: ReadonlyMap<string, string>): string {
  return exteriorPickMap.get(pickedId) ?? pickedId;
}

export function exteriorModelObjectUrl(bytes: Uint8Array): string {
  return URL.createObjectURL(new Blob([new Uint8Array(bytes) as unknown as BlobPart], { type: "model/gltf-binary" }));
}

/**
 * Builds every model URI one cell needs, ALL OF THEM OR NONE.
 *
 * Two ways to put verified bytes in front of Cesium, chosen by the RELEASE and
 * never by a toggle. A release that ships its tiles inside each GLB keeps the
 * Blob URL it has always had, unchanged down to the revoke bookkeeping. A
 * release that declares SHARED tiles cannot use a Blob URL at all — an image URI
 * has nothing to resolve against inside `blob:` — so it hands Cesium a resource
 * that answers for the model and for its tiles out of the already-verified set,
 * and creates no object URL to revoke.
 *
 * It is all-or-nothing because `verifiedExteriorModelResource` runs a load-time
 * canary that REFUSES when this CesiumJS build would not preserve the verified
 * resource through its own clone path. That refusal has to fail the CELL closed,
 * and a cell is only closed cleanly if the refusal happens before any entity of
 * it exists. Blob URLs already created for earlier entries are revoked on the
 * way out, so a refusal leaks nothing either.
 */
export function exteriorCellModelUris<T extends ExteriorCellRenderPlacement>(
  cell: Pick<ExteriorOverlayCellPlan<T>, "cellId" | "adds">,
): { ok: true; modelUris: Array<string | VerifiedExteriorResource>; objectUrls: string[] } | { ok: false; cellId: string; message: string } {
  const modelUris: Array<string | VerifiedExteriorResource> = [];
  const objectUrls: string[] = [];
  try {
    for (const { entry } of cell.adds) {
      const modelUri = entry.sharedTextures
        ? verifiedExteriorModelResource(entry.sharedTextures, entry.bytes)
        : exteriorModelObjectUrl(entry.bytes);
      if (typeof modelUri === "string") objectUrls.push(modelUri);
      modelUris.push(modelUri);
    }
  } catch (error) {
    for (const objectUrl of objectUrls) URL.revokeObjectURL(objectUrl);
    return { ok: false, cellId: cell.cellId, message: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, modelUris, objectUrls };
}

/** Cesium drill picks may expose an Entity object under `id` rather than its string id. */
export function drillPickedEntityId(picked: { id?: unknown } | null | undefined): string | null {
  const id = picked?.id;
  if (typeof id === "string") return id;
  if (id && typeof id === "object" && "id" in id) {
    const entityId = (id as { id?: unknown }).id;
    return typeof entityId === "string" ? entityId : null;
  }
  return null;
}

export const STAGE3_STOREFRONT_PROOF_QUERY = "storefront-picks";
export const STAGE3_STOREFRONT_PROJECTIONS_ATTRIBUTE = "data-stage3-storefront-projections";
export const STAGE3_RENDER_PROOF_ATTRIBUTE = "data-stage3-render-proof";

export interface StorefrontProjectionCandidate {
  storefrontId: string;
  canonicalBuildingId: string;
  proxyEntityId: string;
  anchorWgs84: readonly [number, number] | null;
  rendered: boolean;
}

export interface StorefrontProjectionRecord {
  storefrontId: string;
  canonicalBuildingId: string;
  proxyEntityId: string;
  rendered: boolean;
  canvasX: number | null;
  canvasY: number | null;
  visible: boolean;
  inBounds: boolean;
  cameraSignature: string;
}

export interface Stage3BuildingRenderCandidate {
  canonicalBuildingId: string;
  entityId: string;
  modelUri: string | null;
  modelEntity: boolean;
  showing: boolean;
}

export interface Stage3BuildingRenderRecord extends Stage3BuildingRenderCandidate {
  active: boolean;
}

export interface Stage3RenderProof {
  cameraSignature: string;
  assetDistanceMeters: number;
  expectedBuildingCount: number;
  activeBuildingCount: number;
  expectedStorefrontCount: number;
  activeStorefrontCount: number;
  buildings: readonly Stage3BuildingRenderRecord[];
  storefronts: readonly StorefrontProjectionRecord[];
  pass: boolean;
}

export function stage3StorefrontProofRequested(search: string): boolean {
  return new URLSearchParams(search).get("stage3Proof") === STAGE3_STOREFRONT_PROOF_QUERY;
}

export function storefrontProjectionCameraSignature(camera: CameraPose): string {
  return [camera.longitude, camera.latitude, camera.height, camera.heading, camera.pitch, camera.roll]
    .map((value) => Number.isFinite(value) ? value.toFixed(6) : "invalid")
    .join(",");
}

/** Derive a stable, non-selecting diagnostic payload for already-rendered proxies. */
export function collectStorefrontProjectionRecords(
  candidates: readonly StorefrontProjectionCandidate[],
  assetDistanceMeters: number,
  canvas: Pick<HTMLCanvasElement, "clientWidth" | "clientHeight">,
  cameraSignature: string,
  project: (anchor: readonly [number, number]) => Pick<Cartesian2, "x" | "y"> | undefined,
): StorefrontProjectionRecord[] {
  if (!Number.isFinite(assetDistanceMeters) || assetDistanceMeters > 900) return [];
  return candidates
    .filter((candidate) => candidate.rendered && candidate.anchorWgs84 !== null)
    .map((candidate) => {
      const projected = project(candidate.anchorWgs84!);
      const visible = Boolean(projected && Number.isFinite(projected.x) && Number.isFinite(projected.y));
      const canvasX = visible ? Number(projected!.x.toFixed(3)) : null;
      const canvasY = visible ? Number(projected!.y.toFixed(3)) : null;
      const inBounds = visible && canvasX !== null && canvasY !== null && canvasX >= 0 && canvasY >= 0 && canvasX <= canvas.clientWidth && canvasY <= canvas.clientHeight;
      return { storefrontId: candidate.storefrontId, canonicalBuildingId: candidate.canonicalBuildingId, proxyEntityId: candidate.proxyEntityId, rendered: candidate.rendered, canvasX, canvasY, visible, inBounds, cameraSignature };
    })
    .sort((left, right) => left.storefrontId.localeCompare(right.storefrontId));
}

export function publishStorefrontProjectionRecords(element: HTMLElement, records: readonly StorefrontProjectionRecord[]): void {
  element.setAttribute(STAGE3_STOREFRONT_PROJECTIONS_ATTRIBUTE, JSON.stringify(records));
}

export function clearStorefrontProjectionRecords(element: HTMLElement): void {
  element.removeAttribute(STAGE3_STOREFRONT_PROJECTIONS_ATTRIBUTE);
}

/**
 * Renderer proof is derived from the live Cesium entity collection after the
 * Stage 3 model/proxy branch has executed, never from manifest or status text.
 */
export function collectStage3RenderProof(
  buildingCandidates: readonly Stage3BuildingRenderCandidate[],
  storefronts: readonly StorefrontProjectionRecord[],
  cameraSignature: string,
  assetDistanceMeters: number,
): Stage3RenderProof {
  const buildings = buildingCandidates
    .map((candidate) => ({ ...candidate, active: candidate.modelEntity && candidate.showing && typeof candidate.modelUri === "string" && candidate.modelUri.startsWith("/assets/manhattan-esb-block-exterior-pilot-20260805/") }))
    .sort((left, right) => left.canonicalBuildingId.localeCompare(right.canonicalBuildingId));
  const activeBuildingCount = buildings.filter((record) => record.active).length;
  const activeStorefrontCount = storefronts.filter((record) => record.rendered).length;
  return {
    cameraSignature,
    assetDistanceMeters: Number.isFinite(assetDistanceMeters) ? Number(assetDistanceMeters.toFixed(3)) : Number.POSITIVE_INFINITY,
    expectedBuildingCount: buildings.length,
    activeBuildingCount,
    expectedStorefrontCount: storefronts.length,
    activeStorefrontCount,
    buildings,
    storefronts,
    pass: buildings.length === 14 && activeBuildingCount === 14 && storefronts.length === 8 && activeStorefrontCount === 8,
  };
}

export function publishStage3RenderProof(element: HTMLElement, proof: Stage3RenderProof): void {
  element.setAttribute(STAGE3_RENDER_PROOF_ATTRIBUTE, JSON.stringify(proof));
}

export function clearStage3RenderProof(element: HTMLElement): void {
  element.removeAttribute(STAGE3_RENDER_PROOF_ATTRIBUTE);
}

export interface DensePoiMarkerStyle {
  pixelSize: number;
  outlineWidth: number;
  color: string;
  opacity: number;
}

export function densePoiMarkerStyle(selected: boolean): DensePoiMarkerStyle {
  return selected
    ? { pixelSize: 20, outlineWidth: 3, color: "#ffdf6b", opacity: 1 }
    : { pixelSize: 5, outlineWidth: 0, color: "#4ce2e6", opacity: 0.78 };
}

function applyCameraPoseRequest(viewer: Viewer, request: CameraPose & { requestId: number }): void {
  viewer.camera.cancelFlight();
  viewer.camera.setView({
    destination: Cartesian3.fromDegrees(request.longitude, request.latitude, request.height),
    orientation: {
      heading: CesiumMath.toRadians(request.heading),
      pitch: CesiumMath.toRadians(request.pitch),
      roll: CesiumMath.toRadians(request.roll),
    },
  });
}

export interface DenseRenderCamera {
  longitude: number;
  latitude: number;
}

export type DenseRenderBounds = ViewportBounds;

export interface CameraControlBindings {
  rotateEventTypes: Array<CameraEventType | { eventType: CameraEventType; modifier: KeyboardEventModifier }>;
  tiltEventTypes: Array<CameraEventType | { eventType: CameraEventType; modifier: KeyboardEventModifier }>;
  zoomEventTypes: CameraEventType[];
  lookEventTypes: Array<{ eventType: CameraEventType; modifier: KeyboardEventModifier }>;
}

/** Explicit, native-pointer camera contract: drag to orbit, middle/Ctrl-drag to tilt, wheel/pinch to zoom. */
export function nativeCameraControlBindings(): CameraControlBindings {
  return {
    rotateEventTypes: [CameraEventType.LEFT_DRAG],
    tiltEventTypes: [CameraEventType.MIDDLE_DRAG, CameraEventType.PINCH, { eventType: CameraEventType.LEFT_DRAG, modifier: KeyboardEventModifier.CTRL }],
    zoomEventTypes: [CameraEventType.WHEEL, CameraEventType.PINCH, CameraEventType.RIGHT_DRAG],
    lookEventTypes: [{ eventType: CameraEventType.LEFT_DRAG, modifier: KeyboardEventModifier.SHIFT }],
  };
}

/** The only part of a Cesium scene this scheduling policy is allowed to see. */
export interface PostRenderSource {
  postRender: {
    addEventListener(listener: () => void): unknown;
    removeEventListener(listener: () => void): unknown;
  };
}

/**
 * Emit a settled camera AFTER the next rendered frame, exactly once (defect D-18).
 *
 * Extracted as a pure scheduling policy rather than left inline, because the
 * defect it fixes is entirely about ORDER and order is the one thing an inline
 * effect in this component cannot be tested for: `CesiumViewport` needs a live
 * WebGL viewer, so every test in this file works against extracted functions.
 *
 * The rule it enforces, and each clause is a failure that was available:
 *
 *   - **After a frame, never before one.** The settled-camera emit builds a
 *     ground footprint from nine globe pick-rays, and pick-rays read the last
 *     RENDERED scene. Emitting synchronously after a pose change publishes a
 *     footprint for the camera's previous position.
 *   - **Exactly once.** A listener that stayed subscribed would emit a settled
 *     camera on every subsequent frame, turning one pose request into a
 *     continuous reconciliation storm.
 *   - **Never after disposal.** The returned disposer detaches a listener that
 *     has not fired yet, so a component unmounting between the request and the
 *     frame emits nothing rather than touching a torn-down viewer.
 */
export function emitCameraSettledAfterNextFrame(scene: PostRenderSource, emit: () => void): () => void {
  let settled = false;
  const listener = (): void => {
    if (settled) return;
    settled = true;
    scene.postRender.removeEventListener(listener);
    emit();
  };
  scene.postRender.addEventListener(listener);
  return () => {
    if (settled) return;
    settled = true;
    scene.postRender.removeEventListener(listener);
  };
}

export function shouldApplyCameraPoseRequest(lastRequestId: number, request: { requestId: number } | undefined): boolean {
  return Boolean(request && Number.isSafeInteger(request.requestId) && request.requestId > 0 && request.requestId !== lastRequestId);
}

export function shouldReplaceDenseRenderPlan(previousFeatures: readonly Feature[] | null, nextFeatures: readonly Feature[]): boolean {
  return previousFeatures === null || previousFeatures.length !== nextFeatures.length || previousFeatures.some((feature, index) => feature !== nextFeatures[index]);
}

/**
 * The narrow delta, and the trigger taxonomy it belongs to.
 *
 * A dense layer is built over its MEMBERSHIP — every base feature the camera
 * footprint and the group caps admit — and each instance carries a `show`
 * attribute. Two different things can then change:
 *
 *  1. **Membership** changes (the camera moved, a shard arrived, a cap bound).
 *     The instance set itself is wrong, so the layer is rebuilt.
 *     `shouldReplaceDenseRenderPlan` decides this, unchanged, by reference
 *     sequence — the frozen thrash and reuse baselines are measured against it.
 *  2. **Ownership** changes (a V3 exterior cell became live, was evicted, or a
 *     pilot asset swapped in or out). The same instances are still correct;
 *     only which of them may draw has moved. That is a `show` flip per affected
 *     instance — O(1) each, no rebuild, no re-tessellation, no second layer in
 *     the scene and therefore no double-draw.
 *
 * This function computes case 2 and is consulted ONLY when case 1 says the
 * membership is identical. It never decides a rebuild, so it cannot retain
 * stale geometry: the reference compare remains the sole authority for that.
 */
export interface DenseRenderPlanDelta {
  /** Ids that must start drawing again (their exterior/pilot owner went away). */
  added: readonly string[];
  /** Ids that must stop drawing (an exterior or pilot owner took them over). */
  removed: readonly string[];
}

export function denseRenderPlanDelta(
  previousSuppressedIds: ReadonlySet<string>,
  nextSuppressedIds: ReadonlySet<string>,
): DenseRenderPlanDelta {
  const added: string[] = [];
  const removed: string[] = [];
  for (const id of previousSuppressedIds) if (!nextSuppressedIds.has(id)) added.push(id);
  for (const id of nextSuppressedIds) if (!previousSuppressedIds.has(id)) removed.push(id);
  return { added, removed };
}

export function denseRenderPlanDeltaSize(delta: DenseRenderPlanDelta): number {
  return delta.added.length + delta.removed.length;
}

/**
 * Compact O(n) diagnostic fingerprint for dense-plan observations. Rendering
 * reuse is intentionally decided by reference sequence above, so a hash
 * collision can never retain stale geometry or content.
 */
export function denseRenderPlanKey(
  features: readonly Feature[],
): string {
  let hash = 2_166_136_261;
  const fold = (value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16_777_619);
    }
  };
  for (const feature of features) {
    fold(feature.id);
    fold(feature.kind);
    fold(`${feature.coordinates[0].toFixed(6)},${feature.coordinates[1].toFixed(6)},${feature.geometryProvenance.height.valueMeters ?? "unknown"}`);
  }
  return `${features.length}:${(hash >>> 0).toString(16)}`;
}

function emptyDenseRenderMetrics(): DenseRenderMetrics {
  return { featureCount: 0, primitiveCount: 0, instanceCount: 0, buildingFeatureCount: 0, pointFeatureCount: 0 };
}

function withDenseRenderTelemetry(metrics: DenseRenderMetrics, telemetry: DenseRenderTelemetry): DenseRenderMetrics {
  return {
    ...metrics,
    planBuildCount: telemetry.planBuildCount,
    planReuseCount: telemetry.planReuseCount,
    planCancellationCount: telemetry.planCancellationCount,
    planSwapCount: telemetry.planSwapCount,
    planSuppressionUpdateCount: telemetry.planSuppressionUpdateCount,
    planSuppressionFlipCount: telemetry.planSuppressionFlipCount,
    denseSuppressedInstanceCount: telemetry.denseSuppressedInstanceCount,
    pendingLayerAddedAt: telemetry.pendingLayerAddedAt,
    doubleDrawOpenedAt: telemetry.doubleDrawOpenedAt,
    previousLayerRemovedAt: telemetry.previousLayerRemovedAt,
    doubleDrawMs: telemetry.doubleDrawMs,
    planFingerprint: telemetry.planFingerprint,
    selectionMs: telemetry.selectionMs,
    keyMs: telemetry.keyMs,
    allocationMs: telemetry.allocationMs,
    allocationMaxSliceMs: telemetry.allocationMaxSliceMs,
    allocationChunkCount: telemetry.allocationChunkCount,
    workerReadyMs: telemetry.workerReadyMs,
    totalBuildMs: telemetry.totalBuildMs,
  };
}

function positionsInFeature(feature: Feature): Position[] {
  if (feature.geometry.type === "Point") return [feature.geometry.coordinates];
  if (feature.geometry.type === "Polygon") return feature.geometry.coordinates.flat();
  if (feature.geometry.type === "MultiPolygon") return feature.geometry.coordinates.flat(2);
  if (feature.geometry.type === "LineString") return feature.geometry.coordinates;
  return feature.geometry.coordinates.flat(1);
}

export function denseFeatureIntersectsBounds(feature: Feature, bounds: DenseRenderBounds): boolean {
  const positions = positionsInFeature(feature);
  if (positions.length === 0) return false;
  const longitudes = positions.map((position) => position[0]);
  const latitudes = positions.map((position) => position[1]);
  const featureBounds: ViewportBounds = {
    west: Math.min(...longitudes),
    east: Math.max(...longitudes),
    south: Math.min(...latitudes),
    north: Math.max(...latitudes),
  };
  return viewportBoundsIntersect(featureBounds, bounds) || positions.some(([longitude, latitude]) => viewportBoundsIntersect({ west: longitude, east: longitude, south: latitude, north: latitude }, bounds));
}

/**
 * Select a bounded, deterministic dense render proxy for a settled camera.
 * The adapter retains every loaded parent for search/detail/picking; this
 * seam only bounds the Cesium instance set at a dense citywide LOD. A
 * selected parent is retained even when it falls outside the nearest set.
 */
export function selectDenseFeatures(
  features: readonly Feature[],
  camera: DenseRenderCamera | null,
  limit: number,
  selectedFeatureId: string | null = null,
  bounds: DenseRenderBounds | null = null,
): Feature[] {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Dense render feature limit must be a positive integer.");
  const selected = selectedFeatureId ? features.find((feature) => feature.id === selectedFeatureId) : undefined;
  const spatial = bounds ? features.filter((feature) => denseFeatureIntersectsBounds(feature, bounds)) : [...features];
  const candidates = selected && !spatial.some((feature) => feature.id === selected.id) ? [...spatial, selected] : spatial;
  if (candidates.length <= limit) return [...candidates].sort((left, right) => left.id.localeCompare(right.id));
  const distance = (feature: Feature): number => {
    if (!camera) return 0;
    const longitude = feature.coordinates[0] ?? 0;
    const latitude = feature.coordinates[1] ?? 0;
    return (longitude - camera.longitude) ** 2 + (latitude - camera.latitude) ** 2;
  };
  const ordered = [...candidates].sort((left, right) => distance(left) - distance(right) || left.id.localeCompare(right.id));
  const bounded = ordered.slice(0, limit);
  if (selected && !bounded.some((feature) => feature.id === selected.id)) bounded[bounded.length - 1] = selected;
  return bounded.sort((left, right) => left.id.localeCompare(right.id));
}

function denseRenderPartCount(feature: Feature): number {
  if (feature.geometry.type === "MultiPolygon") return feature.geometry.coordinates.length;
  if (feature.geometry.type === "MultiLineString") return feature.geometry.coordinates.length;
  return 1;
}

/**
 * Select independent ordinary-base and civic-context quotas.  Both groups use
 * the same settled camera/bounds, and only the active selection may be added
 * after its group's bulk quota is full.
 */
export function selectDenseFeatureGroups(
  baseFeatures: readonly Feature[],
  contextFeatures: readonly Feature[],
  camera: DenseRenderCamera | null,
  limits: { base: number; context: number },
  selectedFeatureId: string | null = null,
  bounds: DenseRenderBounds | null = null,
): DenseFeatureGroups {
  const base = selectDenseFeatures(baseFeatures, camera, limits.base, selectedFeatureId, bounds);
  const spatial = contextFeatures.filter((feature) => !bounds || denseFeatureIntersectsBounds(feature, bounds));
  const distance = (feature: Feature): number => {
    if (!camera) return 0;
    return (feature.coordinates[0] - camera.longitude) ** 2 + (feature.coordinates[1] - camera.latitude) ** 2;
  };
  const ordered = [...spatial].sort((left, right) => distance(left) - distance(right) || left.id.localeCompare(right.id));
  const selected = selectedFeatureId ? contextFeatures.find((feature) => feature.id === selectedFeatureId) : undefined;
  const context: Feature[] = [];
  let parts = 0;
  for (const feature of ordered) {
    const count = denseRenderPartCount(feature);
    if (parts + count > limits.context && feature.id !== selectedFeatureId) continue;
    context.push(feature);
    parts += count;
    if (parts >= limits.context && !selected) break;
  }
  if (selected && !context.some((feature) => feature.id === selected.id)) context.push(selected);
  return { base: [...base].sort((left, right) => left.id.localeCompare(right.id)), context: context.sort((left, right) => left.id.localeCompare(right.id)) };
}

/** Build a pick map that omits ambiguous IDs instead of overwriting an owner. */
export function buildCollisionCheckedFeatureMap(features: readonly Feature[]): Map<string, Feature> {
  const map = new Map<string, Feature>();
  const collisions = new Set<string>();
  for (const feature of features) {
    if (collisions.has(feature.id)) continue;
    const existing = map.get(feature.id);
    if (existing) {
      map.delete(feature.id);
      collisions.add(feature.id);
      continue;
    }
    map.set(feature.id, feature);
  }
  return map;
}

function polygonParts(feature: Feature): Position[][][] {
  if (feature.geometry.type === "Polygon") return [feature.geometry.coordinates];
  if (feature.geometry.type === "MultiPolygon") return feature.geometry.coordinates;
  return [];
}

function positionsForRing(ring: Position[]): Cartesian3[] {
  const positions = ring;
  return Cartesian3.fromDegreesArray(positions.flatMap(([longitude, latitude]) => [longitude, latitude]));
}

function positionsForLine(line: Position[]): Cartesian3[] {
  return Cartesian3.fromDegreesArray(line.flatMap(([longitude, latitude]) => [longitude, latitude]));
}

function itineraryLines(itinerary: Itinerary): Position[][] {
  return itinerary.legs.flatMap((leg) => {
    if (leg.geometry.type === "LineString") return [leg.geometry.coordinates];
    if (leg.geometry.type === "MultiLineString") return leg.geometry.coordinates;
    return [];
  });
}

function itineraryWaypoints(itinerary: Itinerary): Position[] {
  return itinerary.legs.flatMap((leg) => leg.steps.flatMap((step) => {
    if (step.geometry.type === "LineString") return [step.geometry.coordinates[0]!, step.geometry.coordinates[step.geometry.coordinates.length - 1]!];
    if (step.geometry.type === "MultiLineString") return step.geometry.coordinates.flatMap((line) => [line[0]!, line[line.length - 1]!]);
    return [];
  }));
}

function hierarchyForArea(feature: Feature, partIndex = 0): PolygonHierarchy | undefined {
  const polygon = polygonParts(feature)[partIndex];
  if (!polygon) return undefined;
  const [outer, ...holes] = polygon;
  if (!outer) return undefined;
  return new PolygonHierarchy(positionsForRing(outer), holes.map((hole) => new PolygonHierarchy(positionsForRing(hole))));
}

/** Return the immutable runtime URI only when the manifest and package gate approve this building. */
export function assetModelUriForFeature(feature: Feature, assetResolver: CityAssetResolver | undefined, distanceMeters = 240): string | null {
  if (feature.kind !== "building") return null;
  const resolution = assetResolver?.resolve(feature.id, distanceMeters, 1);
  return resolution?.kind === "asset" ? `/${resolution.lod.content.relativeContentRef}` : null;
}

/** Construct the Cesium ModelGraphics payload used by the semantic entity branch. */
export function modelGraphicsForFeature(feature: Feature, assetResolver: CityAssetResolver | undefined, distanceMeters = 240): ModelGraphics | null {
  const uri = assetModelUriForFeature(feature, assetResolver, distanceMeters);
  return uri ? new ModelGraphics({ uri, scale: 1, minimumPixelSize: 1 }) : null;
}

/** Dense rendering intentionally keeps ordinary buildings in the procedural primitive path. */
export function denseFeatureRenderMode(feature: Feature, assetResolver: CityAssetResolver | undefined, distanceMeters = 240): "asset-model" | "procedural-massing" {
  return assetModelUriForFeature(feature, assetResolver, distanceMeters) ? "asset-model" : "procedural-massing";
}

export type PoiRenderMode = "point-primitive" | "selected-entity" | "entity";

/** Ordinary dense POIs stay in the app-owned point collection; only the active selection gets an entity label. */
export function poiRenderMode(feature: Feature, denseRendering: boolean, selected: boolean): PoiRenderMode {
  if (feature.kind !== "poi") return "entity";
  if (!denseRendering) return "entity";
  return selected ? "selected-entity" : "point-primitive";
}

function addFeatureEntity(
  viewer: Viewer,
  feature: Feature,
  partIndex = 0,
  assetResolver?: CityAssetResolver,
  assetDistanceMeters = 240,
  selectedFeatureId: string | null = null,
  suppressUnselectedLabels = false,
): ReturnType<Viewer["entities"]["add"]> {
  const selected = feature.id === selectedFeatureId;
  const showLabel = shouldShowFeatureLabel(feature, suppressUnselectedLabels, assetDistanceMeters >= 1_200, selectedFeatureId);
  const assetResolution = assetResolver?.resolve(feature.id, assetDistanceMeters, 1);
  const assetProperties = {
    assetResolution: assetResolution?.kind ?? "not-registered",
    assetDiagnostic: assetResolution?.kind === "procedural-fallback" ? assetResolution.diagnostic.message : null,
    assetContentRef: assetResolution?.kind === "asset" ? assetResolution.lod.content.relativeContentRef : null,
  };
  if (feature.kind === "area" || feature.kind === "park") {
    const isPark = feature.kind === "park";
    return viewer.entities.add({
      id: partIndex === 0 ? feature.id : `${feature.id}:part:${partIndex}`,
      name: feature.name,
      position: Cartesian3.fromDegrees(feature.coordinates[0], feature.coordinates[1], 18),
      polygon: {
        hierarchy: hierarchyForArea(feature, partIndex),
        height: 0,
        extrudedHeight: 0,
        material: Color.fromCssColorString(selected ? "#63f3c5" : isPark ? "#55b875" : "#7e9de8").withAlpha(selected ? 0.42 : isPark ? 0.26 : 0.18),
        outline: true,
        outlineColor: Color.fromCssColorString(selected ? "#ffdf6b" : isPark ? "#b7f2c6" : "#a7c0ff").withAlpha(0.95),
      },
      label: partIndex === 0 && showLabel ? {
        text: `${feature.name}${selected ? " · selected" : ` · ${isPark ? "NYC Parks-managed property" : feature.attributes.areaSemantics ?? "area"}`}`,
        font: "11px Inter, sans-serif",
        fillColor: Color.WHITE,
        showBackground: true,
        backgroundColor: Color.fromCssColorString("#0d151b").withAlpha(0.82),
        pixelOffset: new Cartesian2(0, -18),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      } : undefined,
      properties: {
        canonicalFeatureId: feature.id,
        sourceRecordId: feature.sourceRefs[0]?.sourceRecordId ?? null,
        fixtureOnly: fixtureOnlyForFeature(feature),
        ...assetProperties,
      },
    });
  }
  if (feature.kind === "building" && feature.geometry.type === "Polygon") {
    const assetModelUri = assetModelUriForFeature(feature, assetResolver, assetDistanceMeters);
    const assetModel = modelGraphicsForFeature(feature, assetResolver, assetDistanceMeters);
    if (assetResolution?.kind === "asset" && assetModelUri && assetModel) {
      const anchor = Cartesian3.fromDegrees(assetResolution.entry.wgs84Anchor.longitude, assetResolution.entry.wgs84Anchor.latitude, assetResolution.entry.wgs84Anchor.heightMeters);
      const enuFrame = Transforms.eastNorthUpToFixedFrame(anchor);
      const enuRotation = Matrix4.getMatrix3(enuFrame, new Matrix3());
      return viewer.entities.add({
        id: feature.id,
        name: feature.name,
        position: anchor,
        orientation: Quaternion.fromRotationMatrix(enuRotation),
        model: assetModel,
        label: selected && showLabel ? {
          text: `${feature.name} · selected`,
          font: "12px Inter, sans-serif",
          fillColor: Color.WHITE,
          showBackground: true,
          backgroundColor: Color.fromCssColorString("#0d151b").withAlpha(0.9),
          pixelOffset: new Cartesian2(0, -22),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        } : undefined,
        properties: {
          canonicalFeatureId: feature.id,
          sourceRecordId: feature.sourceRefs[0]?.sourceRecordId ?? null,
          fixtureOnly: fixtureOnlyForFeature(feature),
          ...assetProperties,
        },
      });
    }
    const height = feature.geometryProvenance.height.valueMeters ?? 1;
      return viewer.entities.add({
        id: feature.id,
        name: feature.name,
        position: Cartesian3.fromDegrees(feature.coordinates[0], feature.coordinates[1], 18),
        polygon: {
        hierarchy: new PolygonHierarchy(positionsForRing(feature.geometry.coordinates[0] ?? [])),
        height: 0,
        extrudedHeight: Math.max(1, height),
        material: Color.fromCssColorString(selected ? "#63f3c5" : "#d7a85d").withAlpha(0.82),
        outline: true,
        outlineColor: Color.fromCssColorString(selected ? "#ffdf6b" : "#f4d89a"),
      },
      label: selected && showLabel ? {
        text: `${feature.name} · selected`,
        font: "12px Inter, sans-serif",
        fillColor: Color.WHITE,
        showBackground: true,
        backgroundColor: Color.fromCssColorString("#0d151b").withAlpha(0.9),
        pixelOffset: new Cartesian2(0, -22),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      } : undefined,
      properties: {
        canonicalFeatureId: feature.id,
        sourceRecordId: feature.sourceRefs[0]?.sourceRecordId ?? null,
        fixtureOnly: fixtureOnlyForFeature(feature),
        ...assetProperties,
      },
    });
  }

  if (feature.kind === "transit-route" && (feature.geometry.type === "LineString" || feature.geometry.type === "MultiLineString")) {
    const lines = feature.geometry.type === "LineString" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    const colorValue = typeof feature.attributes.transitRouteColor === "string" && /^#[0-9a-f]{6}$/i.test(feature.attributes.transitRouteColor)
      ? feature.attributes.transitRouteColor
      : "#c56cff";
    return viewer.entities.add({
      id: partIndex === 0 ? feature.id : `${feature.id}:part:${partIndex}`,
      name: feature.name,
      polyline: { positions: positionsForLine(lines[partIndex] ?? lines[0] ?? []), width: selected ? 7 : 5, material: Color.fromCssColorString(selected ? "#63f3c5" : colorValue).withAlpha(0.92), clampToGround: true },
      label: partIndex === 0 && showLabel ? { text: `${feature.name}${selected ? " · selected" : " · schematic"}`, font: "11px Inter, sans-serif", fillColor: Color.WHITE, showBackground: true, backgroundColor: Color.fromCssColorString("#0d151b").withAlpha(0.82), pixelOffset: new Cartesian2(0, -18), disableDepthTestDistance: Number.POSITIVE_INFINITY } : undefined,
      properties: { canonicalFeatureId: feature.id, sourceRecordId: feature.sourceRefs[0]?.sourceRecordId ?? null, fixtureOnly: fixtureOnlyForFeature(feature), ...assetProperties },
    });
  }

  const [longitude, latitude] = feature.coordinates;
  const pointColor = feature.kind === "transit-station" ? "#ff7ac8" : feature.kind === "transit-entrance" ? "#ffd166" : feature.kind === "landmark" ? "#f0a3ff" : "#4ce2e6";
  const ordinaryDensePoint = suppressUnselectedLabels && !selected;
  const pointSize = ordinaryDensePoint ? 6 : feature.kind === "transit-station" ? 22 : feature.kind === "transit-entrance" ? 12 : feature.kind === "landmark" ? 18 : 16;
  return viewer.entities.add({
    id: feature.id,
    name: feature.name,
    position: Cartesian3.fromDegrees(longitude, latitude, 14),
    point: {
      pixelSize: selected ? pointSize + 7 : pointSize,
      color: Color.fromCssColorString(selected ? "#ffdf6b" : pointColor),
      outlineColor: Color.fromCssColorString("#d5ffff"),
      outlineWidth: ordinaryDensePoint ? 0 : 2,
      heightReference: HeightReference.NONE,
    },
    label: showLabel ? {
      text: `${feature.name}${selected ? " · selected" : ""}`,
      font: "12px Inter, sans-serif",
      fillColor: Color.WHITE,
      showBackground: true,
      backgroundColor: Color.fromCssColorString("#0d151b").withAlpha(0.82),
      pixelOffset: new Cartesian2(0, -22),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    } : undefined,
    properties: {
      canonicalFeatureId: feature.id,
      sourceRecordId: feature.sourceRefs[0]?.sourceRecordId ?? null,
      fixtureOnly: fixtureOnlyForFeature(feature),
      ...assetProperties,
    },
  });
}

/** Source role, rather than a renderer branch, controls fixture truth. */
export function fixtureOnlyForFeature(feature: Feature): boolean {
  return feature.sourceRefs.length === 0 || feature.sourceRefs.every((source) => source.role === "fixture" || source.registryEntryId.startsWith("fixture."));
}

function addFeatureEntities(
  viewer: Viewer,
  feature: Feature,
  assetResolver?: CityAssetResolver,
  assetDistanceMeters = 240,
  selectedFeatureId: string | null = null,
  suppressUnselectedLabels = false,
): ReturnType<Viewer["entities"]["add"]>[] {
  if ((feature.kind === "area" || feature.kind === "park") && feature.geometry.type === "MultiPolygon") {
    return feature.geometry.coordinates.map((_, partIndex) => addFeatureEntity(viewer, feature, partIndex, assetResolver, assetDistanceMeters, selectedFeatureId, suppressUnselectedLabels));
  }
  if (feature.kind === "transit-route" && feature.geometry.type === "MultiLineString") {
    return feature.geometry.coordinates.map((_, partIndex) => addFeatureEntity(viewer, feature, partIndex, assetResolver, assetDistanceMeters, selectedFeatureId, suppressUnselectedLabels));
  }
  return [addFeatureEntity(viewer, feature, 0, assetResolver, assetDistanceMeters, selectedFeatureId, suppressUnselectedLabels)];
}

type DenseBuildingFeature = Feature & { kind: "building"; geometry: Extract<Feature["geometry"], { type: "Polygon" }> };

function isDenseBuildingFeature(feature: Feature): feature is DenseBuildingFeature {
  return feature.kind === "building" && feature.geometry.type === "Polygon";
}

/** The massing's shipped colour, named so the far-tier writer cannot drift from it. */
export const DENSE_MASSING_CSS_COLOR = "#d7a85d" as const;
export const DENSE_MASSING_BASE_ALPHA = 0.82 as const;

function denseBuildingInstance(feature: DenseBuildingFeature, show: boolean): GeometryInstance {
  return new GeometryInstance({
    id: feature.id,
    geometry: new PolygonGeometry({
      polygonHierarchy: new PolygonHierarchy(positionsForRing(feature.geometry.coordinates[0] ?? [])),
      height: 0,
      extrudedHeight: Math.max(1, feature.geometryProvenance.height.valueMeters ?? 1),
      // Cesium's flat per-instance appearance requires position only; keeping
      // normals/ST/bitangents out of every citywide polygon reduces worker and
      // upload work without changing the flat-colored visual contract.
      vertexFormat: VertexFormat.POSITION_ONLY,
    }),
    attributes: {
      color: ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString(DENSE_MASSING_CSS_COLOR).withAlpha(DENSE_MASSING_BASE_ALPHA)),
      // The per-instance `show` is what makes exterior-wave takeover an O(1)
      // attribute write instead of a whole-island rebuild. Cesium compiles it
      // into the single shader program used by BOTH the color and the pick
      // pass (`Primitive._appendShowToShader` runs before
      // `appendPickToVertexShader`), so a hidden instance is also unpickable
      // and cannot compete with the exterior model for the same click.
      show: new ShowGeometryInstanceAttribute(show),
    },
  });
}

/**
 * Where one feature's drawable lives, so ownership changes are a write and not
 * a search. Buildings resolve to the batched `Primitive` that owns their
 * instance; POIs resolve to their own point primitive, which carries `show`
 * directly.
 */
export interface DenseInstanceIndex {
  buildings: Map<string, Primitive>;
  points: Map<string, { show: boolean }>;
}

export function emptyDenseInstanceIndex(): DenseInstanceIndex {
  return { buildings: new Map(), points: new Map() };
}

export interface DenseSuppressionWriteResult {
  flips: number;
  hiddenBuildingChange: number;
  hiddenPointChange: number;
  /**
   * Ids whose write did NOT land — the index does not hold them, the primitive
   * is not ready, or the batch table has no `show` attribute.
   *
   * This is returned rather than swallowed because the caller records what it
   * believes it applied. Advancing that record over a write that never happened
   * makes the recorded state a lie in three compounding ways: the id never gets
   * retried, the REVERSE delta later "un-flips" an instance that was never
   * flipped, and the hidden-instance count — which feeds
   * `buildingFeatureCount` through `liveDenseMetrics` — drifts by one per
   * skipped write, permanently, for the life of the layer.
   */
  skipped: readonly string[];
}

export interface DenseFarTierAlphaWriteResult {
  writes: number;
  /** Same meaning, and same obligation, as `DenseSuppressionWriteResult.skipped`. */
  skipped: readonly string[];
}

/**
 * Hide massing UNDER a far-tier tile by driving its colour alpha, never `show`.
 *
 * THIS IS THE WHOLE REASON THE FAR TIER DOES NOT REUSE `applyDenseSuppressionDelta`.
 * That function writes the `show` attribute, and Cesium compiles `show` into the
 * single shader program used by BOTH the colour and the pick pass, so a
 * `show=false` instance is also unpickable. Exterior-wave takeover WANTS that:
 * the exterior model replaces the massing as the pick target. The far tier does
 * NOT — its tile is one merged mesh with no per-building ids, so if the massing
 * stopped picking there would be nothing left to answer a click with, and
 * per-building identity at far range would simply disappear.
 *
 * Driving the colour instead keeps the instance in the pick pass. The alpha
 * floor is `FAR_TIER_MASSING_PICK_ALPHA`, which is not zero for a measured
 * reason recorded on that constant.
 *
 * The result contract mirrors the suppression writer's exactly: `skipped` ids
 * did not write, and the caller must not advance its applied set over them.
 */
export function applyDenseFarTierAlphaDelta(index: DenseInstanceIndex, delta: DenseRenderPlanDelta): DenseFarTierAlphaWriteResult {
  let writes = 0;
  const skipped: string[] = [];
  const write = (id: string, alpha: number): void => {
    const primitive = index.buildings.get(id);
    // Points carry no per-instance colour and are never far-tier members; a
    // point id here is a caller error, so it is skipped rather than guessed at.
    if (!primitive) { skipped.push(id); return; }
    if (primitive.ready !== true) { skipped.push(id); return; }
    const attributes = primitive.getGeometryInstanceAttributes(id) as { color?: Uint8Array } | undefined;
    if (!attributes?.color) { skipped.push(id); return; }
    attributes.color = ColorGeometryInstanceAttribute.toValue(Color.fromCssColorString(DENSE_MASSING_CSS_COLOR).withAlpha(alpha), attributes.color);
    writes += 1;
  };
  // `added` means "no longer covered by a tile", so the massing comes back.
  for (const id of delta.added) write(id, DENSE_MASSING_BASE_ALPHA);
  for (const id of delta.removed) write(id, FAR_TIER_MASSING_PICK_ALPHA);
  return { writes, skipped };
}

/**
 * The far tier's alpha reconciliation as ONE function, applied set in and out.
 *
 * IT IS A FUNCTION AND NOT A CLOSURE BECAUSE OF THE BUG IT NOW PINS. The applied
 * set is only meaningful against the instance index it was written into. When a
 * dense render plan is rebuilt, every instance is new and at full opacity, so an
 * applied set carried across the rebuild describes writes that no longer exist:
 * the next delta is empty, this function early-returns, and the tan massing
 * under every drawn far-tier tile comes back at full opacity and NEVER HEALS,
 * because nothing will ever produce a delta again until the covered set itself
 * changes. The fix is that every site which replaces or discards
 * `denseActiveIndexRef` also resets the applied set, and the commit path
 * re-applies the desired covered set against the layer it just installed —
 * exactly what the `show`-based ownership path already did.
 */
export function reconcileDenseFarTierAlpha(
  index: DenseInstanceIndex,
  previousCovered: ReadonlySet<string>,
  nextCovered: ReadonlySet<string>,
): { applied: ReadonlySet<string>; writes: number } {
  const delta = denseRenderPlanDelta(previousCovered, nextCovered);
  if (denseRenderPlanDeltaSize(delta) === 0) return { applied: previousCovered, writes: 0 };
  const result = applyDenseFarTierAlphaDelta(index, delta);
  // Only what actually wrote advances the record, so a skipped id is retried
  // next pass instead of being un-flipped by a reverse delta that never had a
  // matching forward write.
  return { applied: denseAppliedSuppressionSet(previousCovered, nextCovered, result.skipped), writes: result.writes };
}

/**
 * Flip `show` for the ids in a delta. Returns the number of instances actually
 * written, which is the honest flip count, plus the ids that did not write so
 * the caller can leave them out of its applied set.
 */
export function applyDenseSuppressionDelta(index: DenseInstanceIndex, delta: DenseRenderPlanDelta): DenseSuppressionWriteResult {
  let flips = 0;
  let hiddenBuildingChange = 0;
  let hiddenPointChange = 0;
  const skipped: string[] = [];
  const write = (id: string, show: boolean): void => {
    const primitive = index.buildings.get(id);
    if (primitive) {
      // `getGeometryInstanceAttributes` requires at least one `update`; the
      // commit gate already waits for `primitiveLayerReady`, and this guard
      // keeps a not-yet-ready layer from throwing if that ever changes.
      if (primitive.ready !== true) { skipped.push(id); return; }
      const attributes = primitive.getGeometryInstanceAttributes(id) as { show?: Uint8Array } | undefined;
      if (!attributes?.show) { skipped.push(id); return; }
      attributes.show = ShowGeometryInstanceAttribute.toValue(show, attributes.show);
      flips += 1;
      hiddenBuildingChange += show ? -1 : 1;
      return;
    }
    const point = index.points.get(id);
    if (!point) { skipped.push(id); return; }
    point.show = show;
    flips += 1;
    hiddenPointChange += show ? -1 : 1;
  };
  for (const id of delta.added) write(id, true);
  for (const id of delta.removed) write(id, false);
  return { flips, hiddenBuildingChange, hiddenPointChange, skipped };
}

/**
 * The set the caller may now claim it has applied: the intended set, with every
 * SKIPPED id put back to whatever was true before. An id that did not write is
 * still in its old state, so recording the new one would guarantee it is never
 * retried and would corrupt the next reverse delta.
 */
export function denseAppliedSuppressionSet(
  previousSuppressedIds: ReadonlySet<string>,
  nextSuppressedIds: ReadonlySet<string>,
  skipped: readonly string[],
): ReadonlySet<string> {
  if (skipped.length === 0) return nextSuppressedIds;
  const applied = new Set(nextSuppressedIds);
  for (const id of skipped) {
    if (previousSuppressedIds.has(id)) applied.add(id);
    else applied.delete(id);
  }
  return applied;
}

/**
 * `hiddenCount` is the number of allocated instances the ownership set hides,
 * so `featureCount`/`buildingFeatureCount`/`pointFeatureCount` keep their
 * established meaning — what the dense pass DRAWS — while `instanceCount`
 * reports what was allocated. The two reconcile through
 * `denseSuppressedInstanceCount`.
 */
function denseRenderMetricsFor(
  builtBuildingCount: number,
  builtPointCount: number,
  primitiveCount: number,
  hiddenBuildingCount: number,
  hiddenPointCount: number,
): DenseRenderMetrics {
  const drawnBuildings = builtBuildingCount - hiddenBuildingCount;
  const drawnPoints = builtPointCount - hiddenPointCount;
  return {
    featureCount: drawnBuildings + drawnPoints,
    primitiveCount,
    instanceCount: builtBuildingCount + builtPointCount,
    buildingFeatureCount: drawnBuildings,
    pointFeatureCount: drawnPoints,
    denseSuppressedInstanceCount: hiddenBuildingCount + hiddenPointCount,
  };
}

function addDensePrimitives(
  collection: PrimitiveCollection,
  buildingInstances: readonly GeometryInstance[],
  points: readonly Feature[],
  suppressedIds: ReadonlySet<string>,
): { metrics: DenseRenderMetrics; index: DenseInstanceIndex; hiddenBuildingCount: number; hiddenPointCount: number } {
  let primitiveCount = 0;
  const index = emptyDenseInstanceIndex();
  let hiddenBuildingCount = 0;
  for (let start = 0; start < buildingInstances.length; start += DENSE_PRIMITIVE_GROUP_SIZE) {
    const group = buildingInstances.slice(start, start + DENSE_PRIMITIVE_GROUP_SIZE);
    const primitive = new Primitive({
      geometryInstances: group,
      appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
      asynchronous: true,
    });
    for (const instance of group) {
      if (typeof instance.id !== "string") continue;
      index.buildings.set(instance.id, primitive);
      if (suppressedIds.has(instance.id)) hiddenBuildingCount += 1;
    }
    collection.add(primitive);
    primitiveCount += 1;
  }
  let hiddenPointCount = 0;
  if (points.length) {
    const pointCollection = collection.add(new PointPrimitiveCollection());
    const style = densePoiMarkerStyle(false);
    for (const feature of points) {
      const hidden = suppressedIds.has(feature.id);
      if (hidden) hiddenPointCount += 1;
      const point = pointCollection.add({ id: feature.id, position: Cartesian3.fromDegrees(feature.coordinates[0], feature.coordinates[1], 14), pixelSize: style.pixelSize, color: Color.fromCssColorString(style.color).withAlpha(style.opacity), outlineColor: Color.WHITE, outlineWidth: style.outlineWidth, show: !hidden });
      index.points.set(feature.id, point);
    }
    primitiveCount += 1;
  }
  return {
    metrics: denseRenderMetricsFor(buildingInstances.length, points.length, primitiveCount, hiddenBuildingCount, hiddenPointCount),
    index,
    hiddenBuildingCount,
    hiddenPointCount,
  };
}

/**
 * Build a replacement layer over several animation frames. The current layer
 * remains active until every owned primitive is ready, so no camera settle can
 * expose a clear-before-ready frame.
 */
function scheduleDensePrimitiveBuild(
  viewer: Viewer,
  collection: PrimitiveCollection,
  features: readonly Feature[],
  suppressedIds: ReadonlySet<string>,
  onComplete: (result: DenseBuildResult) => void,
): PendingDenseBuild {
  let cursor = 0;
  let frame: number | null = null;
  let cancelled = false;
  const startedAt = performance.now();
  const buildingInstances: GeometryInstance[] = [];
  const points: Feature[] = [];
  let allocationMs = 0;
  let allocationMaxSliceMs = 0;
  let allocationChunkCount = 0;
  const build: PendingDenseBuild = {
    complete: false,
    result: null,
    cancel: () => {
      cancelled = true;
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
    },
  };
  const appendChunk = () => {
    frame = null;
    if (cancelled) return;
    const sliceStartedAt = performance.now();
    const sliceEnd = Math.min(features.length, cursor + DENSE_BUILD_CHUNK_SIZE);
    while (cursor < sliceEnd) {
      const feature = features[cursor]!;
      if (isDenseBuildingFeature(feature)) buildingInstances.push(denseBuildingInstance(feature, !suppressedIds.has(feature.id)));
      else if (feature.kind === "poi") points.push(feature);
      cursor += 1;
    }
    const sliceMs = performance.now() - sliceStartedAt;
    allocationMs += sliceMs;
    allocationMaxSliceMs = Math.max(allocationMaxSliceMs, sliceMs);
    allocationChunkCount += 1;
    if (cursor < features.length) {
      frame = window.requestAnimationFrame(appendChunk);
      viewer.scene.requestRender();
      return;
    }
    // Primitive construction only groups the already-created descriptors;
    // Cesium performs polygon geometry work asynchronously after this frame.
    const finalizeStartedAt = performance.now();
    const added = addDensePrimitives(collection, buildingInstances, points, suppressedIds);
    const finalizeMs = performance.now() - finalizeStartedAt;
    allocationMs += finalizeMs;
    allocationMaxSliceMs = Math.max(allocationMaxSliceMs, finalizeMs);
    build.result = {
      metrics: added.metrics,
      index: added.index,
      builtSuppressedIds: suppressedIds,
      builtBuildingCount: buildingInstances.length,
      builtPointCount: points.length,
      primitiveCount: added.metrics.primitiveCount,
      hiddenBuildingCount: added.hiddenBuildingCount,
      hiddenPointCount: added.hiddenPointCount,
      startedAt,
      allocationMs,
      allocationMaxSliceMs,
      allocationChunkCount,
      allocationCompletedAt: performance.now(),
    };
    build.complete = true;
    onComplete(build.result);
    viewer.scene.requestRender();
  };
  frame = window.requestAnimationFrame(appendChunk);
  return build;
}

function addSelectedPoiEntity(viewer: Viewer, feature: Feature): ReturnType<Viewer["entities"]["add"]> {
  const [longitude, latitude] = feature.coordinates;
  return viewer.entities.add({
    id: feature.id,
    name: feature.name,
    position: Cartesian3.fromDegrees(longitude, latitude, 16),
    point: {
      pixelSize: 24,
      color: Color.fromCssColorString("#ffdf6b"),
      outlineColor: Color.WHITE,
      outlineWidth: 3,
      heightReference: HeightReference.NONE,
    },
    label: {
      text: `${feature.name} · selected`,
      font: "12px Inter, sans-serif",
      fillColor: Color.WHITE,
      showBackground: true,
      backgroundColor: Color.fromCssColorString("#0d151b").withAlpha(0.9),
      pixelOffset: new Cartesian2(0, -26),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    properties: {
      canonicalFeatureId: feature.id,
      sourceRecordId: feature.sourceRefs[0]?.sourceRecordId ?? null,
      fixtureOnly: fixtureOnlyForFeature(feature),
      selected: true,
    },
  });
}

function verifiedAssetBuildingIds(features: Feature[], assetResolver: CityAssetResolver | undefined, distanceMeters: number): ReadonlySet<string> {
  if (!assetResolver) return new Set<string>();
  return new Set(features.filter((feature) => denseFeatureRenderMode(feature, assetResolver, distanceMeters) === "asset-model").map((feature) => feature.id));
}

function cameraStateForViewer(viewer: Viewer): CameraPose {
  const position = viewer.camera.positionCartographic;
  return { longitude: CesiumMath.toDegrees(position.longitude), latitude: CesiumMath.toDegrees(position.latitude), height: Math.max(0, Number.isFinite(position.height) ? position.height : 0), heading: CesiumMath.toDegrees(viewer.camera.heading), pitch: CesiumMath.toDegrees(viewer.camera.pitch), roll: CesiumMath.toDegrees(viewer.camera.roll) };
}

function fallbackBoundsForViewer(viewer: Viewer): ViewportBounds | null {
  const rectangle = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
  if (!rectangle) return null;
  return {
    west: CesiumMath.toDegrees(rectangle.west),
    east: CesiumMath.toDegrees(rectangle.east),
    south: CesiumMath.toDegrees(rectangle.south),
    north: CesiumMath.toDegrees(rectangle.north),
  };
}

/** Sample the real visible globe surface instead of deriving loading bounds from the camera's air position. */
function cameraFootprintForViewer(viewer: Viewer, lastValid: ViewportFootprint | null): ViewportFootprint | null {
  const width = Math.max(1, viewer.canvas.clientWidth || viewer.canvas.width || 1);
  const height = Math.max(1, viewer.canvas.clientHeight || viewer.canvas.height || 1);
  // Canvas coordinates are zero-based: sampling width/height can land one
  // pixel outside its valid pick-ray domain on the right/bottom edges.
  const maxX = Math.max(0, width - 1);
  const maxY = Math.max(0, height - 1);
  const samples: Array<readonly [number, number]> = [
    [maxX * 0.5, maxY * 0.5],
    [0, 0], [maxX, 0], [0, maxY], [maxX, maxY],
    [maxX * 0.5, 0], [maxX * 0.5, maxY], [0, maxY * 0.5], [maxX, maxY * 0.5],
  ];
  const groundPoints: Array<readonly [number, number]> = [];
  for (const [x, y] of samples) {
    const ray = viewer.camera.getPickRay(new Cartesian2(x, y));
    const hit = ray ? viewer.scene.globe.pick(ray, viewer.scene) : undefined;
    const cartographic = hit ? Cartographic.fromCartesian(hit) : undefined;
    if (cartographic && Number.isFinite(cartographic.longitude) && Number.isFinite(cartographic.latitude)) {
      groundPoints.push([CesiumMath.toDegrees(cartographic.longitude), CesiumMath.toDegrees(cartographic.latitude)]);
    }
  }
  const sampled = viewportFootprintFromGroundPoints(groundPoints, { lastValid, fallbackBounds: fallbackBoundsForViewer(viewer) });
  // Bound a horizon-stretched sample to the camera's own neighbourhood so the
  // shard the camera stands on cannot be ranked out of the budget (T009 F2).
  // Shallow attitudes only: a steep or near-nadir sample is returned unchanged.
  return sampled ? boundFootprintToCamera(sampled, cameraStateForViewer(viewer)) : sampled;
}

function primitiveLayerReady(layer: PrimitiveCollection): boolean {
  for (let index = 0; index < layer.length; index += 1) {
    const primitive = layer.get(index) as { ready?: boolean } | undefined;
    if (primitive && primitive.ready === false) return false;
  }
  return true;
}

function cameraDuration(seconds: number): number { return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0.01 : seconds; }

/** Build the bounded, deterministic camera pose used for a selected parent. */
export function focusAssetEntryForFeature(feature: Feature, assetResolver?: Pick<CityAssetResolver, "resolve">) {
  const resolution = assetResolver?.resolve(feature.id, 180, 1);
  return resolution?.kind === "asset" ? resolution.entry : undefined;
}

/** Keep a selected asset outside the camera while retaining a little three-quarter context. */
export function focusHeightForFeature(feature: Feature, assetResolver?: Pick<CityAssetResolver, "resolve">, minimumHeight = 240): number {
  const sourceHeight = feature.geometryProvenance.height.valueMeters ?? 0;
  const assetBounds = focusAssetEntryForFeature(feature, assetResolver)?.bounds;
  const assetHeight = assetBounds ? Math.max(0, assetBounds.max[2] - assetBounds.min[2]) : 0;
  const targetHeight = Math.max(sourceHeight, assetHeight);
  return Math.max(minimumHeight, Math.ceil(targetHeight * 1.8 + 180));
}

export function focusCoordinatesForFeature(feature: Feature, assetResolver?: Pick<CityAssetResolver, "resolve">): Position {
  const anchor = focusAssetEntryForFeature(feature, assetResolver)?.wgs84Anchor;
  return anchor ? [anchor.longitude, anchor.latitude] : feature.coordinates;
}

/** Place the camera behind the selected target so a pitched view looks at it from outside. */
export function focusCameraCoordinatesForFeature(feature: Feature, height = 240, targetCoordinates: Position = feature.coordinates): Position {
  const headingRadians = CesiumMath.toRadians(35);
  const pitchRadians = CesiumMath.toRadians(35);
  const groundDistance = height / Math.max(0.1, Math.tan(pitchRadians));
  const eastOffset = groundDistance * Math.sin(headingRadians);
  const northOffset = groundDistance * Math.cos(headingRadians);
  const latitudeRadians = CesiumMath.toRadians(targetCoordinates[1]);
  const metersPerLongitudeDegree = 111_320 * Math.max(0.2, Math.cos(latitudeRadians));
  return [
    targetCoordinates[0] - eastOffset / metersPerLongitudeDegree,
    targetCoordinates[1] - northOffset / 111_320,
  ];
}

export function focusPoseForFeature(feature: Feature, height = 240, coordinates: Position = feature.coordinates): CameraPose {
  return { longitude: coordinates[0], latitude: coordinates[1], height, heading: 35, pitch: -35, roll: 0 };
}

export interface FocusOcclusion {
  leftPx?: number;
  rightPx?: number;
  topPx?: number;
  bottomPx?: number;
  viewportWidthPx: number;
  viewportHeightPx: number;
}

/**
 * Keep dense and overview labels quiet while preserving a deterministic label
 * for the active feature. Geometry and picking remain present either way.
 */
export function shouldShowFeatureLabel(
  feature: Pick<Feature, "id">,
  denseRendering: boolean,
  overview: boolean,
  selectedFeatureId: string | null,
): boolean {
  return feature.id === selectedFeatureId || (!denseRendering && !overview);
}

/**
 * Shift the requested camera center away from an overlay's occluded center.
 * Cesium's camera destination is the visual center, so a right-side panel
 * requires an eastward destination shift to place the selected world point
 * on the left side of the unobscured viewport; a bottom sheet shifts south.
 */
export function focusPoseForFeatureWithOcclusion(feature: Feature, height = 240, occlusion?: FocusOcclusion, coordinates: Position = feature.coordinates): CameraPose {
  const base = focusPoseForFeature(feature, height, coordinates);
  if (!occlusion || occlusion.viewportWidthPx <= 0 || occlusion.viewportHeightPx <= 0) return base;
  const width = occlusion.viewportWidthPx;
  const viewportHeight = occlusion.viewportHeightPx;
  const horizontalShiftPx = ((occlusion.rightPx ?? 0) - (occlusion.leftPx ?? 0)) / 2;
  const verticalShiftPx = ((occlusion.bottomPx ?? 0) - (occlusion.topPx ?? 0)) / 2;
  if (horizontalShiftPx === 0 && verticalShiftPx === 0) return base;
  // A bounded 45° ground-span approximation is stable across fixtures and
  // local releases and avoids making focus dependent on provider imagery.
  const groundSpanMeters = Math.max(1, height) * 0.8284271247;
  const metersPerHorizontalPixel = groundSpanMeters / width;
  const metersPerVerticalPixel = groundSpanMeters / viewportHeight;
  const latitudeRadians = CesiumMath.toRadians(base.latitude);
  const metersPerLongitudeDegree = 111_320 * Math.max(0.2, Math.cos(latitudeRadians));
  return {
    ...base,
    longitude: base.longitude + (horizontalShiftPx * metersPerHorizontalPixel) / metersPerLongitudeDegree,
    latitude: base.latitude - (verticalShiftPx * metersPerVerticalPixel) / 111_320,
  };
}

/**
 * Cesium can report an equivalent 180° local-frame roll after a low-altitude
 * WGS84 flight even when the requested view is upright. Keep the published
 * focus link tied to its deterministic requested orientation.
 */
export function normalizeFocusCameraPose(actual: CameraPose, requested: CameraPose): CameraPose {
  return { ...actual, heading: requested.heading, pitch: requested.pitch, roll: requested.roll };
}

/**
 * A focus request owns one flight. Dense shard refreshes may rerun the effect,
 * but they must not restart that request's flight or re-enter the camera loop.
 */
export function shouldStartFocusFlight(lastRequest: number, nextRequest: number, hasTarget: boolean): boolean {
  return hasTarget && Number.isSafeInteger(nextRequest) && nextRequest > 0 && nextRequest !== lastRequest;
}

/** Cesium dense primitives use a part suffix, while runtime adapters index the parent. */
export function canonicalPickId(pickedId: string): string {
  const partSeparator = pickedId.indexOf(":part:");
  return partSeparator >= 0 ? pickedId.slice(0, partSeparator) : pickedId;
}

/** Resolve a Cesium pick through the canonical parent ID before consulting either index. */
export function featureForPickedId(
  pickedId: string | null,
  denseFeatureMap: ReadonlyMap<string, Feature>,
  adapter: Pick<RuntimeCityAdapter, "getFeature">,
): Feature | undefined {
  if (!pickedId) return undefined;
  const canonicalId = canonicalPickId(pickedId);
  return denseFeatureMap.get(canonicalId) ?? adapter.getFeature(canonicalId);
}

/** Locationless civic/citywide records remain selectable but must never trigger a camera flight. */
export function shouldFocusFeature(feature: Pick<Feature, "attributes"> | null | undefined): boolean {
  return Boolean(feature && feature.attributes.civicNoMarker !== true && feature.attributes.citywideNoMarker !== true);
}

export function medianFrameInterval(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : ((sorted[middle - 1]! + sorted[middle]!) / 2);
}

export function CesiumViewport({
  adapter,
  farTier = false,
  onFarTierState,
  focusRequest,
  focusFeatureId,
  focusOverlayOpen = false,
  visibleLayers,
  onFeatureSelected,
  onFeatureOverlap,
  featureFilter,
  itinerary = null,
  previewRequest,
  denseRendering = false,
  denseFeatures = [],
  denseFeatureLimit,
  denseFeatureGroups,
  denseFeatureGroupLimits,
  onDenseMetrics,
  selectedFeatureId = null,
  onCameraChanged,
  viewportFootprint = null,
  cameraRequest,
  cameraPoseRequest,
  onViewportKeyDown,
  assetResolver,
  commercialOverlay = null,
  onStorefrontSelected,
  publicRealmOverlay = null,
  onPublicRealmSelected,
  exteriorOverlay = null,
  onExteriorUnanchored,
  onExteriorCellsRetired,
  onStage3RenderProof,
}: CesiumViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const stage3StorefrontProofEnabled = import.meta.env.DEV && typeof window !== "undefined" && stage3StorefrontProofRequested(window.location.search);
  const [viewerReadyGeneration, setViewerReadyGeneration] = useState(0);
  const adapterRef = useRef(adapter);
  const onFeatureSelectedRef = useRef(onFeatureSelected);
  const onFeatureOverlapRef = useRef(onFeatureOverlap);
  const onStorefrontSelectedRef = useRef(onStorefrontSelected);
  const onPublicRealmSelectedRef = useRef(onPublicRealmSelected);
  const onStage3RenderProofRef = useRef(onStage3RenderProof);
  const onCameraChangedRef = useRef(onCameraChanged);
  const onDenseMetricsRef = useRef(onDenseMetrics);
  adapterRef.current = adapter;
  onFeatureSelectedRef.current = onFeatureSelected;
  onFeatureOverlapRef.current = onFeatureOverlap;
  onStorefrontSelectedRef.current = onStorefrontSelected;
  onPublicRealmSelectedRef.current = onPublicRealmSelected;
  onStage3RenderProofRef.current = onStage3RenderProof;
  onCameraChangedRef.current = onCameraChanged;
  onDenseMetricsRef.current = onDenseMetrics;
  const cameraPoseRequestRef = useRef(cameraPoseRequest);
  cameraPoseRequestRef.current = cameraPoseRequest;
  const previewIndexRef = useRef(0);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const denseFeatureMapRef = useRef(new Map<string, Feature>());
  const denseCollectionRef = useRef<PrimitiveCollection | null>(null);
  const activeDenseLayerRef = useRef<PrimitiveCollection | null>(null);
  const pendingDenseLayerRef = useRef<PrimitiveCollection | null>(null);
  const pendingDenseBuildRef = useRef<PendingDenseBuild | null>(null);
  /** The MEMBERSHIP the live layer was built over — the rebuild trigger's input. */
  const denseRenderPlanFeaturesRef = useRef<readonly Feature[] | null>(null);
  /** Where the live layer's instances are, so an ownership change is a write. */
  const denseActiveIndexRef = useRef<DenseInstanceIndex>(emptyDenseInstanceIndex());
  /** The ownership set currently APPLIED to the live layer. */
  const denseAppliedSuppressedIdsRef = useRef<ReadonlySet<string>>(new Set<string>());
  /** The ownership set the scene WANTS, reconciled at commit if a build is in flight. */
  const denseDesiredSuppressedIdsRef = useRef<ReadonlySet<string>>(new Set<string>());
  const denseBuiltCountsRef = useRef({ buildings: 0, points: 0, primitives: 0 });
  const denseHiddenCountsRef = useRef({ buildings: 0, points: 0 });
  /** Non-null while an old and a new layer are both in `rootDenseCollection`. */
  const denseDoubleDrawOpenedAtRef = useRef<number | null>(null);
  const denseBuildGenerationRef = useRef(0);
  const denseRenderTelemetryRef = useRef<DenseRenderTelemetry>({ ...EMPTY_DENSE_RENDER_TELEMETRY });
  const denseMetricsRef = useRef<DenseRenderMetrics>(emptyDenseRenderMetrics());
  const denseGroupMetricsRef = useRef({ baseFeatureCount: 0, contextFeatureCount: 0, contextPartCount: 0, exteriorSuppressedFeatureCount: 0 });
  const ownedEntityIdsRef = useRef(new Set<string>());
  const storefrontPickMapRef = useRef(new Map<string, CommercialStorefrontPlacement>());
  const publicRealmPickMapRef = useRef(new Map<string, Block835PublicRealmFeature>());
  const exteriorPickMapRef = useRef(new Map<string, string>());
  const exteriorCellCollectionsRef = useRef(new Map<string, ExteriorOwnedCellCollection>());
  const exteriorUnanchoredRef = useRef<string>("");
  /**
   * Cells whose verified model resources could not be built, by cell id.
   *
   * Populated only when the load-time canary refuses — that is, when this
   * CesiumJS build did not preserve the verified resource through its own clone
   * path and a model would otherwise fetch unverified bytes. It is a REF rather
   * than state because it must not re-render the scene; it exists so the
   * refusal is inspectable rather than invisible, and so a cell that recovers
   * clears its entry instead of accumulating one forever.
   */
  const exteriorVerifiedResourceFailuresRef = useRef<Map<string, string>>(new Map());

  /**
   * The far-tier tile primitives currently in the scene.
   *
   * Read at pick time by the Route D bracket rather than captured once, because
   * tiles arrive and leave as cells stream; a snapshot taken when the handler
   * was installed would stop covering everything added afterwards.
   */
  const farTierPrimitivesRef = useRef<FarTierHideable[]>([]);

  /**
   * Verified far-tier tiles, with the rectangle each was anchored on.
   *
   * The rectangle is kept because SELECTION IS PER CELL AND PER FRAME: a tile is
   * drawn only while the camera is beyond the tier's near edge, so the distance
   * has to be recomputed against the cell's own bounds as the camera moves.
   */
  const farTierTilesRef = useRef<readonly FarTierDrawnTile[]>([]);
  /** Cell ids currently drawn. This is the hysteresis state the band acts on. */
  const farTierDrawnCellsRef = useRef<Set<string>>(new Set());
  /** Outcomes for every cell that is NOT resident, so the summary can be rebuilt. */
  const farTierBaseOutcomesRef = useRef<readonly FarTierLoadOutcome[]>([]);

  /** Ids whose massing is currently held at the far-tier pick alpha. */
  const denseFarTierAlphaAppliedRef = useRef<ReadonlySet<string>>(new Set());
  /**
   * The covered set the scene WANTS, reconciled at commit if a build is in
   * flight — the alpha twin of `denseDesiredSuppressedIdsRef`, and missing from
   * the first revision, which is half of why a rebuild lost the far tier.
   */
  const denseDesiredFarTierCoveredRef = useRef<ReadonlySet<string>>(new Set());
  /**
   * Bumped whenever far-tier residency changes, purely to wake the dense pass.
   *
   * Without it the tier activates only when some unrelated dense dependency
   * happens to change: a camera that is already stationary when the tiles finish
   * loading gets a scene with the primitives added, hidden, and nothing to show
   * them, until the user moves. Selection lives inside the dense effect, so the
   * dense effect is what has to be woken.
   */
  const [farTierResidencyGeneration, setFarTierResidencyGeneration] = useState(0);
  const onFarTierStateRef = useRef(onFarTierState);
  onFarTierStateRef.current = onFarTierState;

  /**
   * Recompute the aggregate from the load outcomes plus the CURRENT selection.
   *
   * A verified tile the camera is too close for reports `near`, not `drawn` and
   * certainly not a failure, so the one status line stays true as the camera
   * moves rather than describing the moment the tiles were loaded.
   */
  const publishFarTierState = useCallback(() => {
    const drawnCells = farTierDrawnCellsRef.current;
    const outcomes: FarTierLoadOutcome[] = [
      ...farTierBaseOutcomesRef.current,
      ...farTierTilesRef.current.map((tile) => ({ cellId: tile.cellId, state: (drawnCells.has(tile.cellId) ? "drawn" : "near") as FarTierCellState })),
    ];
    const container = containerRef.current;
    if (container) {
      const detail = farTierFailureDetail(outcomes);
      if (detail === null) delete container.dataset.farTierFailures;
      else container.dataset.farTierFailures = detail;
    }
    onFarTierStateRef.current?.(summarizeFarTierState(outcomes));
  }, []);
  const onExteriorUnanchoredRef = useRef(onExteriorUnanchored);
  onExteriorUnanchoredRef.current = onExteriorUnanchored;
  const onExteriorCellsRetiredRef = useRef(onExteriorCellsRetired);
  onExteriorCellsRetiredRef.current = onExteriorCellsRetired;
  const suppressCameraEventsUntilRef = useRef(0);
  const lastValidFootprintRef = useRef<ViewportFootprint | null>(viewportFootprint?.valid ? viewportFootprint : null);
  const cameraSettledEmitterRef = useRef<(() => void) | null>(null);
  const lastCameraRequestIdRef = useRef(0);
  const lastCameraPoseRequestIdRef = useRef(0);
  const lastFocusFlightRequestRef = useRef(0);
  const lastFocusTargetSignatureRef = useRef<string | null>(null);
  if (viewportFootprint?.valid) lastValidFootprintRef.current = viewportFootprint;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const viewer = new Viewer(container, {
      animation: false,
      baseLayer: false,
      baseLayerPicker: false,
      contextOptions: { webgl: { preserveDrawingBuffer: import.meta.env.DEV } },
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      terrainProvider: new EllipsoidTerrainProvider(),
    });

    viewer.scene.backgroundColor = Color.fromCssColorString("#0d151b");
    viewer.scene.globe.baseColor = Color.fromCssColorString("#18252d");
    viewer.scene.globe.showGroundAtmosphere = false;
    viewer.scene.globe.enableLighting = false;
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false;
    if (viewer.scene.skyBox) viewer.scene.skyBox.show = false;
    const controls = nativeCameraControlBindings();
    const controller = viewer.scene.screenSpaceCameraController;
    controller.enableInputs = true;
    controller.enableRotate = true;
    controller.enableTilt = true;
    controller.enableZoom = true;
    controller.enableLook = true;
    controller.rotateEventTypes = controls.rotateEventTypes;
    controller.tiltEventTypes = controls.tiltEventTypes;
    controller.zoomEventTypes = controls.zoomEventTypes;
    controller.lookEventTypes = controls.lookEventTypes;
    const denseCollection = viewer.scene.primitives.add(new PrimitiveCollection());
    denseCollectionRef.current = denseCollection;
    viewer.imageryLayers.add(new ImageryLayer(new GridImageryProvider({
      cells: 16,
      color: Color.fromCssColorString("#5b737d").withAlpha(0.45),
      glowColor: Color.TRANSPARENT,
      glowWidth: 0,
      backgroundColor: Color.fromCssColorString("#18252d"),
    })));

    viewer.selectedEntityChanged.addEventListener((entity) => {
      if (!entity || typeof entity.id !== "string") return;
      const storefront = storefrontPickMapRef.current.get(entity.id);
      if (storefront) { onStorefrontSelectedRef.current?.(storefront); return; }
      const feature = featureForPickedId(canonicalExteriorPickId(entity.id, exteriorPickMapRef.current), denseFeatureMapRef.current, adapterRef.current);
      if (feature) onFeatureSelectedRef.current(feature);
      else {
        const publicRealmFeature = publicRealmPickMapRef.current.get(entity.id);
        if (publicRealmFeature) onPublicRealmSelectedRef.current?.(publicRealmFeature);
      }
    });
    // ROUTE D (T003). Every pick in this application goes through this bracket,
    // which hides the far-tier tiles for the duration of the pick call. Cesium
    // pushes a non-pickable primitive's draw command into the pick pass anyway
    // — `allowPicking: false` only clears the pick id — so a far-tier tile is an
    // invisible-id occluder that would otherwise swallow every click on the
    // massing behind it. See `far-tier-pick-bracket.ts` for the measurement.
    const pickBracket = createFarTierPickBracket(viewer.scene, () => farTierPrimitivesRef.current);
    // AND CESIUM'S OWN PICK IS REMOVED, because the bracket cannot wrap what it
    // does not own. `Viewer` installs a LEFT_DOUBLE_CLICK handler
    // (`pickAndTrackObject`) that calls `scene.pick` directly, outside this
    // bracket, so a double click over a far-tier tile would pick against a scene
    // with the tile still in the pick pass — the exact invisible-id occluder
    // Stage 0 measured. This application does not use entity tracking, so the
    // handler is removed rather than re-registered through the bracket: nothing
    // in this product tracks an entity, so there is no behaviour to preserve.
    viewer.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    viewer.screenSpaceEventHandler.setInputAction((movement: { position: Cartesian2 }) => {
      const picks = pickBracket.drillPick(movement.position, 12) as Array<{ id?: unknown }>;
      const storefront = picks.map((picked) => {
        const pickedId = drillPickedEntityId(picked);
        return pickedId ? storefrontPickMapRef.current.get(pickedId) : undefined;
      }).find((placement): placement is CommercialStorefrontPlacement => Boolean(placement));
      if (storefront) { onStorefrontSelectedRef.current?.(storefront); return; }
      const pickedFeatures = [...new Map(picks.map((picked) => {
        const pickedId = drillPickedEntityId(picked);
        if (!pickedId) return ["", undefined] as const;
        const canonicalId = canonicalExteriorPickId(pickedId, exteriorPickMapRef.current);
        return [canonicalPickId(canonicalId), featureForPickedId(canonicalId, denseFeatureMapRef.current, adapterRef.current)] as const;
      }).filter((entry): entry is readonly [string, Feature] => Boolean(entry[0] && entry[1]))).values()];
      if (pickedFeatures.length > 1) {
        onFeatureOverlapRef.current?.(pickedFeatures);
        return;
      }
      if (pickedFeatures.length === 1) {
        onFeatureSelectedRef.current?.(pickedFeatures[0]!);
        return;
      }
      const publicRealmFeatures = [...new Map(picks.map((picked) => {
        const pickedId = drillPickedEntityId(picked);
        return pickedId ? [pickedId, publicRealmPickMapRef.current.get(pickedId)] as const : ["", undefined] as const;
      }).filter((entry): entry is readonly [string, Block835PublicRealmFeature] => Boolean(entry[0] && entry[1]))).values()];
      if (publicRealmFeatures.length > 0) {
        onPublicRealmSelectedRef.current?.(publicRealmFeatures[0]!);
        return;
      }
      const picked = pickBracket.pick(movement.position) as { id?: unknown } | undefined;
      const pickedId = drillPickedEntityId(picked);
      const feature = featureForPickedId(pickedId === null ? null : canonicalExteriorPickId(pickedId, exteriorPickMapRef.current), denseFeatureMapRef.current, adapterRef.current) ?? pickedFeatures[0];
      if (feature) onFeatureSelectedRef.current(feature);
      else if (pickedId) {
        const publicRealmFeature = publicRealmPickMapRef.current.get(pickedId);
        if (publicRealmFeature) onPublicRealmSelectedRef.current?.(publicRealmFeature);
      }
    }, ScreenSpaceEventType.LEFT_CLICK);
    viewerRef.current = viewer;
    const emitSettledCamera = (force = false) => {
      if (!force && Date.now() < suppressCameraEventsUntilRef.current) return;
      const footprint = cameraFootprintForViewer(viewer, lastValidFootprintRef.current);
      if (footprint?.valid) lastValidFootprintRef.current = footprint;
      onCameraChangedRef.current?.(cameraStateForViewer(viewer), footprint ?? lastValidFootprintRef.current ?? undefined);
    };
    cameraSettledEmitterRef.current = () => emitSettledCamera(true);
    const onCameraMoveEnd = () => emitSettledCamera();
    viewer.camera.moveEnd.addEventListener(onCameraMoveEnd);
    const initialCameraPoseRequest = cameraPoseRequestRef.current;
    if (initialCameraPoseRequest && shouldApplyCameraPoseRequest(lastCameraPoseRequestIdRef.current, initialCameraPoseRequest)) {
      lastCameraPoseRequestIdRef.current = initialCameraPoseRequest.requestId;
      suppressCameraEventsUntilRef.current = Date.now() + 900;
      applyCameraPoseRequest(viewer, initialCameraPoseRequest);
    }
    emitSettledCamera(true);
    setViewerReadyGeneration((generation) => generation + 1);

    return () => {
      viewer.camera.moveEnd.removeEventListener(onCameraMoveEnd);
      if (cameraSettledEmitterRef.current) cameraSettledEmitterRef.current = null;
      if (denseCollectionRef.current === denseCollection) denseCollectionRef.current = null;
      activeDenseLayerRef.current = null;
      pendingDenseLayerRef.current = null;
      pendingDenseBuildRef.current?.cancel();
      pendingDenseBuildRef.current = null;
      denseRenderPlanFeaturesRef.current = null;
      denseBuildGenerationRef.current += 1;
      denseActiveIndexRef.current = emptyDenseInstanceIndex();
      denseAppliedSuppressedIdsRef.current = new Set<string>();
      // The far tier's applied set is reset EVERYWHERE the index it describes is
      // replaced or discarded. An applied set that outlives its instances makes
      // the next delta empty and leaves the massing under every tile at full
      // opacity with nothing left to repair it.
      denseFarTierAlphaAppliedRef.current = new Set<string>();
      denseDoubleDrawOpenedAtRef.current = null;
      ownedEntityIdsRef.current.clear();
      storefrontPickMapRef.current.clear();
      publicRealmPickMapRef.current.clear();
      exteriorPickMapRef.current.clear();
      for (const owned of exteriorCellCollectionsRef.current.values()) for (const objectUrl of owned.objectUrls) URL.revokeObjectURL(objectUrl);
      exteriorCellCollectionsRef.current.clear();
      if (viewerRef.current === viewer) viewerRef.current = null;
      viewer.destroy();
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    let cancelled = false;
    const loadVisibleFeatures = async () => {
      const layers = supportedVisibleLayers(adapter, visibleLayers);
      const loaded = await Promise.all(layers.map((layer) => adapter.loadLayerFeatures(layer)));
      if (cancelled || viewerRef.current !== viewer) return;
      const visibleFeatures = loaded.flat().filter((feature) => featureFilter?.(feature) ?? true);
      const visibleDenseFeatures = denseFeatures.filter((feature) => {
        const layer = layerForFeature(feature);
        return !layer || visibleLayers[layer];
      });
      const allFeatures = [...new Map([...visibleFeatures, ...visibleDenseFeatures].map((feature) => [feature.id, feature])).values()];
      const selectionStartedAt = performance.now();
      const cameraFootprint = viewportFootprint ?? cameraFootprintForViewer(viewer, lastValidFootprintRef.current);
      if (cameraFootprint?.valid) lastValidFootprintRef.current = cameraFootprint;
      const denseCamera = cameraFootprint
        ? cameraFootprint.groundCenter
        : Number.isFinite(viewer.camera.positionCartographic.longitude) && Number.isFinite(viewer.camera.positionCartographic.latitude)
        ? { longitude: CesiumMath.toDegrees(viewer.camera.positionCartographic.longitude), latitude: CesiumMath.toDegrees(viewer.camera.positionCartographic.latitude) }
        : null;
      const denseBounds = cameraFootprint?.bounds ?? null;
      const selectedFromAdapter = selectedFeatureId ? adapter.getFeature(selectedFeatureId) : undefined;
      const layerVisible = (feature: Feature): boolean => {
        const layer = layerForFeature(feature);
        return !layer || visibleLayers[layer] !== false;
      };
      const baseDenseFeatures = (denseFeatureGroups?.base ?? visibleDenseFeatures.filter((feature) => feature.kind === "building" || feature.kind === "poi")).filter(layerVisible);
      const contextDenseFeatures = (denseFeatureGroups?.context ?? visibleDenseFeatures.filter((feature) => feature.kind !== "building" && feature.kind !== "poi")).filter(layerVisible);
      const renderedGroups = denseFeatureGroups && denseFeatureGroupLimits
        ? selectDenseFeatureGroups(baseDenseFeatures, contextDenseFeatures, denseCamera, denseFeatureGroupLimits, selectedFeatureId, denseBounds)
        : { base: denseFeatureLimit ? selectDenseFeatures(allFeatures, denseCamera, denseFeatureLimit, selectedFeatureId, denseBounds) : allFeatures, context: [] };
      const renderedDenseFeatures = [...renderedGroups.base, ...renderedGroups.context];
      if (selectedFromAdapter && layerVisible(selectedFromAdapter) && !renderedDenseFeatures.some((feature) => feature.id === selectedFromAdapter.id)) renderedDenseFeatures.push(selectedFromAdapter);
      denseFeatureMapRef.current = buildCollisionCheckedFeatureMap(renderedDenseFeatures);
      const assetDistanceMeters = Math.max(0, Number.isFinite(viewer.camera.positionCartographic.height) ? viewer.camera.positionCartographic.height : 240);
      const assetBuildingIds = verifiedAssetBuildingIds(renderedDenseFeatures, assetResolver, assetDistanceMeters);
      const rootDenseCollection = denseCollectionRef.current;
      // Read the exterior pick map HERE, not at the top of the effect. This
      // continuation resumes after the exterior pass of the same commit has
      // already added its entities, so the map is the current scene, and
      // suppression can key on geometry that exists rather than on geometry
      // that was merely verified.
      const exteriorRenderedIds = exteriorRenderedCanonicalFeatureIds(exteriorOverlay, exteriorPickMapRef.current);
      const renderOwner = (feature: Feature): DenseFeatureRenderOwner => denseFeatureRenderOwner(feature.id, exteriorRenderedIds, assetBuildingIds);
      const primitiveDenseFeatures = renderedGroups.base.filter((feature) => renderOwner(feature) === "procedural-extrusion");
      // The layer is built over the MEMBERSHIP and hides what it does not own.
      // `renderedGroups.base` is the membership; `denseSuppressedIds` is the
      // ownership set. Splitting the two is what lets an exterior cell arriving
      // or being evicted be a `show` write instead of a whole-island rebuild.
      const denseRenderBasis = renderedGroups.base;
      const denseSuppressedIds = new Set<string>();
      // The far tier contributes into the SAME ownership set rather than
      // carrying a parallel write path, so its suppression inherits the
      // `skipped` contract of `applyDenseSuppressionDelta` for free: an id whose
      // write does not land is retried instead of being recorded as flipped.
      // Membership is by MEMBER BUILDING ID, so a building the bake refused is
      // simply absent from this set and keeps its massing and its refusal entry.
      /**
       * FAR-TIER SELECTION, re-evaluated every dense pass because that is what
       * the camera drives. A tile is shown only while the camera is beyond the
       * tier's near edge, with an exit band so the boundary cannot flicker; the
       * massing alpha follows the SAME decision, so a cell the camera has come
       * close to shows ordinary tan massing and picks exactly as it always did.
       */
      const farTierCamera = viewer.camera.positionCartographic;
      const farTierPose = {
        longitude: CesiumMath.toDegrees(farTierCamera.longitude),
        latitude: CesiumMath.toDegrees(farTierCamera.latitude),
        heightMeters: farTierCamera.height,
      };
      const farTierSuppressed = new Set<string>();
      const previouslyDrawn = farTierDrawnCellsRef.current;
      const nowDrawn = new Set<string>();
      for (const tile of farTierTilesRef.current) {
        const distance = farTierCellDistanceMeters(farTierPose, tile.bounds);
        // READINESS IS PART OF THE SELECTION, not an afterthought. A tile whose
        // model has not finished uploading draws nothing, so showing it and
        // dimming its massing in the same pass opens a window in which NEITHER
        // is on screen. The massing-side writer applies the same `ready` gate to
        // its own primitives. Until the tile is ready the cell simply reads as
        // `near`: not drawn, massing showing, which is exactly what is true.
        const inRange = farTierCellInRange(distance, previouslyDrawn.has(tile.cellId)) && farTierTileReady(tile.primitive);
        tile.primitive.show = inRange;
        if (!inRange) continue;
        nowDrawn.add(tile.cellId);
        for (const buildingId of tile.suppressibleBuildingIds) farTierSuppressed.add(buildingId);
      }
      if (nowDrawn.size !== previouslyDrawn.size || [...nowDrawn].some((cellId) => !previouslyDrawn.has(cellId))) {
        farTierDrawnCellsRef.current = nowDrawn;
        publishFarTierState();
      }

      const farTierCovered = new Set<string>();
      for (const feature of denseRenderBasis) {
        if (renderOwner(feature) !== "procedural-extrusion") denseSuppressedIds.add(feature.id);
        // The far tier is deliberately NOT added to `denseSuppressedIds`. That
        // set is written with `show`, which would take the massing out of the
        // pick pass and destroy per-building identity under the tile. It gets
        // its own alpha-driven set instead.
        else if (farTierSuppressed.has(feature.id)) farTierCovered.add(feature.id);
      }
      const telemetry = denseRenderTelemetryRef.current;
      telemetry.selectionMs = performance.now() - selectionStartedAt;
      const keyStartedAt = performance.now();
      const nextDensePlanKey = denseRenderPlanKey(primitiveDenseFeatures);
      telemetry.keyMs = performance.now() - keyStartedAt;
      telemetry.planFingerprint = nextDensePlanKey;
      const groupMetrics = { baseFeatureCount: renderedGroups.base.length, contextFeatureCount: renderedGroups.context.length, contextPartCount: renderedGroups.context.reduce((sum, feature) => sum + denseRenderPartCount(feature), 0), exteriorSuppressedFeatureCount: exteriorRenderedIds.size };
      denseGroupMetricsRef.current = groupMetrics;
      const publishDenseMetrics = (metrics: DenseRenderMetrics): void => {
        onDenseMetricsRef.current?.({ ...withDenseRenderTelemetry(metrics, telemetry), ...denseGroupMetricsRef.current });
      };
      const liveDenseMetrics = (): DenseRenderMetrics => denseRenderMetricsFor(
        denseBuiltCountsRef.current.buildings,
        denseBuiltCountsRef.current.points,
        denseBuiltCountsRef.current.primitives,
        denseHiddenCountsRef.current.buildings,
        denseHiddenCountsRef.current.points,
      );
      /**
       * TRIGGER 2 of the taxonomy: ownership moved, membership did not. Every
       * affected instance is one `show` write against the live layer — no new
       * `PrimitiveCollection` enters the scene, so this path cannot double-draw
       * and cannot re-tessellate.
       */
      const applyDenseOwnership = (nextSuppressed: ReadonlySet<string>): boolean => {
        const previousSuppressed = denseAppliedSuppressedIdsRef.current;
        const delta = denseRenderPlanDelta(previousSuppressed, nextSuppressed);
        if (denseRenderPlanDeltaSize(delta) === 0) return false;
        const applied = applyDenseSuppressionDelta(denseActiveIndexRef.current, delta);
        // Only what actually WROTE advances the record. A skipped id stays at
        // its old value so the next pass retries it, instead of being recorded
        // as flipped and then un-flipped by a reverse delta that never had a
        // matching forward write.
        denseAppliedSuppressedIdsRef.current = denseAppliedSuppressionSet(previousSuppressed, nextSuppressed, applied.skipped);
        if (applied.flips === 0) return false;
        telemetry.planSuppressionUpdateCount += 1;
        telemetry.planSuppressionFlipCount += applied.flips;
        denseHiddenCountsRef.current = {
          buildings: denseHiddenCountsRef.current.buildings + applied.hiddenBuildingChange,
          points: denseHiddenCountsRef.current.points + applied.hiddenPointChange,
        };
        telemetry.denseSuppressedInstanceCount = denseHiddenCountsRef.current.buildings + denseHiddenCountsRef.current.points;
        return true;
      };
      /**
       * The far tier's own visibility write. Same delta shape and same
       * `skipped` obligation as ownership, different attribute.
       */
      const applyFarTierAlpha = (nextCovered: ReadonlySet<string>): void => {
        denseFarTierAlphaAppliedRef.current = reconcileDenseFarTierAlpha(denseActiveIndexRef.current, denseFarTierAlphaAppliedRef.current, nextCovered).applied;
      };
      // Recorded BEFORE the write, and for the same reason the ownership set is:
      // if this pass schedules a rebuild, the write below lands on a layer that
      // is about to be discarded, and the commit path needs the desired set in
      // order to write it again against the layer it installs.
      denseDesiredFarTierCoveredRef.current = farTierCovered;
      applyFarTierAlpha(farTierCovered);
      denseDesiredSuppressedIdsRef.current = denseSuppressedIds;
      if (denseRendering && rootDenseCollection && shouldReplaceDenseRenderPlan(denseRenderPlanFeaturesRef.current, denseRenderBasis)) {
        const pending = pendingDenseLayerRef.current;
        if (pendingDenseBuildRef.current) telemetry.planCancellationCount += 1;
        pendingDenseBuildRef.current?.cancel();
        pendingDenseBuildRef.current = null;
        if (pending && pending !== activeDenseLayerRef.current) rootDenseCollection.remove(pending);
        const nextDenseLayer = new PrimitiveCollection();
        rootDenseCollection.add(nextDenseLayer);
        const previousDenseLayer = activeDenseLayerRef.current;
        // The double-draw window opens HERE, at the pending-layer add, and only
        // when there is an old layer to draw alongside. A cancelled build keeps
        // the chain open: measuring from the surviving build's start is exactly
        // the undercount ADR 0044 §4.2 could not clear leg Y through.
        const pendingLayerAddedAt = performance.now();
        telemetry.pendingLayerAddedAt = pendingLayerAddedAt;
        if (previousDenseLayer && denseDoubleDrawOpenedAtRef.current === null) {
          denseDoubleDrawOpenedAtRef.current = pendingLayerAddedAt;
          telemetry.doubleDrawOpenedAt = pendingLayerAddedAt;
        }
        const buildGeneration = denseBuildGenerationRef.current + 1;
        denseBuildGenerationRef.current = buildGeneration;
        denseRenderPlanFeaturesRef.current = denseRenderBasis;
        telemetry.planBuildCount += 1;
        pendingDenseLayerRef.current = nextDenseLayer;
        const pendingBuild = scheduleDensePrimitiveBuild(viewer, nextDenseLayer, denseRenderBasis, denseSuppressedIds, (result) => {
          if (viewerRef.current !== viewer || denseBuildGenerationRef.current !== buildGeneration) return;
          telemetry.allocationMs = result.allocationMs;
          telemetry.allocationMaxSliceMs = result.allocationMaxSliceMs;
          telemetry.allocationChunkCount = result.allocationChunkCount;
          denseMetricsRef.current = result.metrics;
          publishDenseMetrics(result.metrics);
        });
        pendingDenseBuildRef.current = pendingBuild;
        const commitDenseLayer = () => {
          if (viewerRef.current !== viewer || denseBuildGenerationRef.current !== buildGeneration) {
            pendingBuild.cancel();
            rootDenseCollection.remove(nextDenseLayer);
            if (pendingDenseLayerRef.current === nextDenseLayer) pendingDenseLayerRef.current = null;
            if (pendingDenseBuildRef.current === pendingBuild) pendingDenseBuildRef.current = null;
            viewer.scene.postRender.removeEventListener(commitDenseLayer);
            return;
          }
          if (!pendingBuild.complete || !primitiveLayerReady(nextDenseLayer)) return;
          if (previousDenseLayer && previousDenseLayer !== nextDenseLayer) {
            rootDenseCollection.remove(previousDenseLayer);
            const previousLayerRemovedAt = performance.now();
            telemetry.previousLayerRemovedAt = previousLayerRemovedAt;
            if (denseDoubleDrawOpenedAtRef.current !== null) {
              telemetry.doubleDrawMs = previousLayerRemovedAt - denseDoubleDrawOpenedAtRef.current;
              denseDoubleDrawOpenedAtRef.current = null;
            }
          }
          activeDenseLayerRef.current = nextDenseLayer;
          if (pendingDenseLayerRef.current === nextDenseLayer) pendingDenseLayerRef.current = null;
          if (pendingDenseBuildRef.current === pendingBuild) pendingDenseBuildRef.current = null;
          const result = pendingBuild.result;
          if (result) {
            telemetry.workerReadyMs = performance.now() - result.allocationCompletedAt;
            telemetry.totalBuildMs = performance.now() - result.startedAt;
            telemetry.planSwapCount += 1;
            denseActiveIndexRef.current = result.index;
            denseBuiltCountsRef.current = { buildings: result.builtBuildingCount, points: result.builtPointCount, primitives: result.primitiveCount };
            denseHiddenCountsRef.current = { buildings: result.hiddenBuildingCount, points: result.hiddenPointCount };
            denseAppliedSuppressedIdsRef.current = result.builtSuppressedIds;
            telemetry.denseSuppressedInstanceCount = result.hiddenBuildingCount + result.hiddenPointCount;
            // Ownership that moved while the build ran is reconciled as flips,
            // never as another build: the instances are already correct.
            applyDenseOwnership(denseDesiredSuppressedIdsRef.current);
            // AND SO IS THE FAR TIER'S ALPHA. These instances are brand new and
            // fully opaque, and the applied set describes writes into the layer
            // that was just replaced — so it is cleared first and the desired
            // covered set is written afresh. Without this the massing under
            // every drawn tile returns at full opacity on the first rebuild and
            // never heals, because the next delta is empty forever.
            denseFarTierAlphaAppliedRef.current = new Set<string>();
            applyFarTierAlpha(denseDesiredFarTierCoveredRef.current);
            denseMetricsRef.current = liveDenseMetrics();
            publishDenseMetrics(denseMetricsRef.current);
          }
          viewer.scene.postRender.removeEventListener(commitDenseLayer);
        };
        viewer.scene.postRender.addEventListener(commitDenseLayer);
        viewer.scene.requestRender();
      } else if (denseRendering && rootDenseCollection) {
        telemetry.planReuseCount += 1;
        // A build in flight owns the reconciliation; it will read the desired
        // set at commit. With no build in flight the flip lands immediately.
        if (!pendingDenseBuildRef.current && applyDenseOwnership(denseSuppressedIds)) {
          denseMetricsRef.current = liveDenseMetrics();
          publishDenseMetrics(denseMetricsRef.current);
          viewer.scene.requestRender();
        }
      } else if (!denseRendering && rootDenseCollection) {
        if (pendingDenseBuildRef.current) telemetry.planCancellationCount += 1;
        pendingDenseBuildRef.current?.cancel();
        pendingDenseBuildRef.current = null;
        if (activeDenseLayerRef.current) rootDenseCollection.remove(activeDenseLayerRef.current);
        if (pendingDenseLayerRef.current && pendingDenseLayerRef.current !== activeDenseLayerRef.current) rootDenseCollection.remove(pendingDenseLayerRef.current);
        activeDenseLayerRef.current = null;
        pendingDenseLayerRef.current = null;
        denseRenderPlanFeaturesRef.current = null;
        denseBuildGenerationRef.current += 1;
        denseActiveIndexRef.current = emptyDenseInstanceIndex();
        denseAppliedSuppressedIdsRef.current = new Set<string>();
        // Same obligation as the ownership set above: the index these described
        // is gone, so the record of what was written into it must go too.
        denseFarTierAlphaAppliedRef.current = new Set<string>();
        denseBuiltCountsRef.current = { buildings: 0, points: 0, primitives: 0 };
        denseHiddenCountsRef.current = { buildings: 0, points: 0 };
        denseDoubleDrawOpenedAtRef.current = null;
        Object.assign(telemetry, EMPTY_DENSE_RENDER_TELEMETRY, { allocationMs: undefined, allocationMaxSliceMs: undefined, allocationChunkCount: undefined, workerReadyMs: undefined, totalBuildMs: undefined, denseSuppressedInstanceCount: undefined, pendingLayerAddedAt: undefined, doubleDrawOpenedAt: undefined, previousLayerRemovedAt: undefined, doubleDrawMs: undefined });
        denseMetricsRef.current = emptyDenseRenderMetrics();
      }
      // A building whose exterior model is in the scene gets no semantic entity
      // either: that model carries the pick (via `exteriorPickMapRef`) and, when
      // selected, the silhouette applied by the selection effect below.
      const semanticallyRendered = (feature: Feature): boolean => {
        const owner = renderOwner(feature);
        if (owner === "exterior-wave") return false;
        if (feature.kind !== "building" && feature.kind !== "poi") return true;
        return owner === "pilot-asset";
      };
      const semanticBaseFeatures = denseRendering
        ? renderedGroups.base.filter(semanticallyRendered)
        : renderedDenseFeatures.filter((feature) => renderOwner(feature) !== "exterior-wave");
      const semanticContextFeatures = denseRendering
        ? renderedGroups.context.filter(semanticallyRendered)
        : [];
      const suppressUnselectedLabels = denseRendering || assetDistanceMeters >= 1_200;
      for (const entityId of ownedEntityIdsRef.current) viewer.entities.removeById(entityId);
      const nextOwnedEntityIds = new Set<string>();
      storefrontPickMapRef.current.clear();
      publicRealmPickMapRef.current.clear();
      const addOwnedFeatureEntities = (feature: Feature, distance: number, suppressLabels: boolean) => {
        addFeatureEntities(viewer, feature, assetResolver, distance, selectedFeatureId, suppressLabels).forEach((entity) => {
          if (typeof entity.id === "string") nextOwnedEntityIds.add(entity.id);
        });
      };
      semanticBaseFeatures.forEach((feature) => {
        // Keep the selected model on its highest verified LOD while the camera
        // is framed from outside its full authored bounds; this preserves a
        // visible pinnacle/silhouette instead of swapping to a roof-only LOD.
        const selectedAssetDistanceMeters = feature.id === selectedFeatureId ? Math.min(assetDistanceMeters, 180) : assetDistanceMeters;
        addOwnedFeatureEntities(feature, selectedAssetDistanceMeters, suppressUnselectedLabels);
      });
      const denseMetrics = denseRendering ? denseMetricsRef.current : emptyDenseRenderMetrics();
      publishDenseMetrics(denseMetrics);
      semanticContextFeatures.forEach((feature) => {
        const selectedAssetDistanceMeters = feature.id === selectedFeatureId ? Math.min(assetDistanceMeters, 180) : assetDistanceMeters;
        addOwnedFeatureEntities(feature, selectedAssetDistanceMeters, suppressUnselectedLabels);
      });
      if (commercialOverlay && (assetDistanceMeters <= 900)) {
        // The citywide streaming set is intentionally sparse. Stage 3 is a
        // bounded, checksum-verified 14-building overlay, so render its
        // approved models directly at close range instead of treating a
        // temporary viewport-shard omission as a building fallback.
        const activeStage3BuildingIds = new Set<string>();
        for (const asset of commercialOverlay.manifest.assets) {
          const buildingId = asset.canonicalFeatureId;
          const resolution = commercialOverlay.resolve(buildingId, assetDistanceMeters, 1);
          if (resolution.kind !== "asset") continue;
          if (exteriorRenderedIds.has(buildingId)) {
            // Same precedence rule as the dense paths: the exterior wave draws
            // this building, so the pilot model must not be drawn over it. The
            // building still counts as active, because its verified storefront
            // proxies are separate semantic pick points, not duplicate geometry.
            activeStage3BuildingIds.add(buildingId);
            continue;
          }
          let buildingEntity = viewer.entities.getById(buildingId);
          if (!buildingEntity?.model) {
            if (buildingEntity) viewer.entities.removeById(buildingId);
            const anchor = Cartesian3.fromDegrees(resolution.entry.wgs84Anchor.longitude, resolution.entry.wgs84Anchor.latitude, resolution.entry.wgs84Anchor.heightMeters);
            const enuFrame = Transforms.eastNorthUpToFixedFrame(anchor);
            const enuRotation = Matrix4.getMatrix3(enuFrame, new Matrix3());
            buildingEntity = viewer.entities.add({
              id: buildingId,
              name: `Block 835 ${buildingId}`,
              position: anchor,
              orientation: Quaternion.fromRotationMatrix(enuRotation),
              model: new ModelGraphics({ uri: `/${resolution.lod.content.relativeContentRef}`, scale: 1, minimumPixelSize: 1 }),
              properties: {
                canonicalFeatureId: buildingId,
                fixtureOnly: false,
                assetResolution: "asset",
                assetContentRef: resolution.lod.content.relativeContentRef,
                block835ExteriorOverlay: EXTERIOR_PILOT_RELEASE_ID,
              },
            });
            nextOwnedEntityIds.delete(buildingId);
            nextOwnedEntityIds.add(buildingId);
          }
          if (buildingEntity.model) activeStage3BuildingIds.add(buildingId);
        }
        for (const buildingId of activeStage3BuildingIds) {
          const frontage = commercialOverlay.commercialForBuilding(buildingId);
          for (const placement of frontage.acceptedPlacements) {
            const anchor = placement.anchorWgs84;
            if (!anchor || anchor.length !== 2) continue;
            const resolution = commercialOverlay.resolve(buildingId, assetDistanceMeters, 1);
            if (resolution.kind !== "asset") continue;
            const proxyId = commercialStorefrontProxyId(placement.storefrontId);
            storefrontPickMapRef.current.set(proxyId, placement);
            const tenantLabel = placement.displayName ?? placement.rawName ?? "Verified storefront";
            const storefrontEntity = viewer.entities.add({
              id: proxyId,
              name: tenantLabel,
              position: Cartesian3.fromDegrees(anchor[0], anchor[1], 4),
              point: { pixelSize: 12, color: Color.fromCssColorString("#ffdf6b"), outlineColor: Color.fromCssColorString("#17372c"), outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
              label: resolution.lod.id === "lod0" ? { text: tenantLabel, font: "11px Inter, sans-serif", fillColor: Color.WHITE, showBackground: true, backgroundColor: Color.fromCssColorString("#17372c").withAlpha(0.9), pixelOffset: new Cartesian2(0, -18), disableDepthTestDistance: Number.POSITIVE_INFINITY } : undefined,
              properties: { canonicalTenantId: placement.canonicalTenantId, canonicalBuildingId: placement.canonicalBuildingId, storefrontId: placement.storefrontId, evidenceIds: placement.evidenceIds.join(","), activeAssetLod: resolution.lod.id, placementDecision: placement.placementDecision, licensePartition: placement.licensePartition },
            });
            if (typeof storefrontEntity.id === "string") nextOwnedEntityIds.add(storefrontEntity.id);
          }
        }
      }
      if (publicRealmOverlay && assetDistanceMeters <= 900) {
        const anchor = publicRealmOverlay.document.anchorWgs84;
        const anchorCartesian = Cartesian3.fromDegrees(anchor[0], anchor[1], anchor[2]);
        const enuFrame = Transforms.eastNorthUpToFixedFrame(anchorCartesian);
        const enuRotation = Matrix4.getMatrix3(enuFrame, new Matrix3());
        for (const semantic of ["roadbed", "sidewalk", "curb", "crosswalk"] as const) {
          const resolution = publicRealmOverlay.resolve(semantic, assetDistanceMeters);
          if (!resolution) continue;
          const modelId = publicRealmAssetEntityId(semantic);
          const firstFeature = publicRealmOverlay.featuresForSemantic(semantic)[0];
          if (firstFeature) publicRealmPickMapRef.current.set(modelId, firstFeature);
          const modelEntity = viewer.entities.add({
            id: modelId,
            name: `Block 835 ${semantic}`,
            position: anchorCartesian,
            orientation: Quaternion.fromRotationMatrix(enuRotation),
            model: new ModelGraphics({ uri: resolution.uri, scale: 1, minimumPixelSize: 1 }),
            properties: {
              publicRealmSemantic: semantic,
              activeAssetLod: resolution.lod,
              assetSha256: resolution.entry.sha256,
              assetContentRef: resolution.entry.relativeContentRef,
              sourceDatasets: publicRealmOverlay.document.sourceSnapshots.map((snapshot) => snapshot.datasetId).join(","),
              claimCeiling: publicRealmOverlay.document.claimCeilings[semantic],
              localOnly: true,
            },
          });
          if (typeof modelEntity.id === "string") nextOwnedEntityIds.add(modelEntity.id);
        }
        for (const feature of publicRealmOverlay.features) {
          const representative = publicRealmRepresentative(feature);
          if (!representative) continue;
          const proxyId = publicRealmProxyId(feature.id);
          publicRealmPickMapRef.current.set(proxyId, feature);
          const selected = selectedFeatureId === `public-realm:${feature.id}`;
          const proxyEntity = viewer.entities.add({
            id: proxyId,
            name: `Block 835 ${feature.semantic}`,
            position: Cartesian3.fromDegrees(representative[0], representative[1], feature.semantic === "curb" ? 0.32 : feature.semantic === "crosswalk" ? 0.16 : 0.05),
            point: {
              pixelSize: selected ? 16 : 8,
              color: Color.fromCssColorString(selected ? "#ffdf6b" : feature.semantic === "crosswalk" ? "#f6d66b" : feature.semantic === "curb" ? "#b9d0c2" : feature.semantic === "sidewalk" ? "#8bc3bf" : "#4ce2e6").withAlpha(selected ? 1 : 0.88),
              outlineColor: Color.fromCssColorString("#17372c"),
              outlineWidth: 2,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label: selected ? { text: `Block 835 · ${feature.semantic}`, font: "11px Inter, sans-serif", fillColor: Color.WHITE, showBackground: true, backgroundColor: Color.fromCssColorString("#17372c").withAlpha(0.9), pixelOffset: new Cartesian2(0, -18), disableDepthTestDistance: Number.POSITIVE_INFINITY } : undefined,
            properties: {
              publicRealmFeatureId: feature.id,
              publicRealmSemantic: feature.semantic,
              claimLevel: feature.claimLevel,
              sourceDatasetId: feature.sourceDatasetId,
              sourceFeatureIds: (feature.sourceFeatureIds ?? []).join(","),
              uncertainty: feature.uncertainty.temporal,
              localOnly: true,
            },
          });
          if (typeof proxyEntity.id === "string") nextOwnedEntityIds.add(proxyEntity.id);
        }
      }
      if (denseRendering && selectedFeatureId) {
        const selectedFeature = renderedDenseFeatures.find((feature) => feature.id === selectedFeatureId);
        // Selecting an exterior-owned building must not re-add the base entity
        // the coverage rule just removed; its feedback is the silhouette.
        if (selectedFeature && renderOwner(selectedFeature) !== "exterior-wave" && !semanticBaseFeatures.some((feature) => feature.id === selectedFeature.id) && !semanticContextFeatures.some((feature) => feature.id === selectedFeature.id) && selectedFeature.kind !== "poi") {
          addOwnedFeatureEntities(selectedFeature, Math.min(assetDistanceMeters, 180), false);
        }
        const selectedPoi = renderedDenseFeatures.find((feature) => feature.id === selectedFeatureId && feature.kind === "poi");
        if (selectedPoi) {
          const selectedPoiEntity = addSelectedPoiEntity(viewer, selectedPoi);
          if (typeof selectedPoiEntity.id === "string") nextOwnedEntityIds.add(selectedPoiEntity.id);
        }
      }
      if (itinerary) {
        itineraryLines(itinerary).forEach((line, index) => {
          const routeEntity = viewer.entities.add({
            id: `synthetic-itinerary-route:${index}`,
            name: "Synthetic itinerary preview",
            polyline: { positions: positionsForLine(line), width: 8, material: Color.fromCssColorString("#63f3c5").withAlpha(0.95), clampToGround: true },
            properties: { fixtureOnly: true, routeWarning: "Synthetic route preview; not real navigation." },
          });
          if (typeof routeEntity.id === "string") nextOwnedEntityIds.add(routeEntity.id);
        });
      }
      ownedEntityIdsRef.current = nextOwnedEntityIds;
    };
    void loadVisibleFeatures();
    return () => { cancelled = true; };
    // `exteriorOverlay` is a real dependency: coverage decides which base
    // geometry this pass may draw, so the base pass has to re-run when the wave
    // changes or the two passes disagree for one render.
    // `farTierResidencyGeneration` is a WAKE-UP, not an input: far-tier
    // selection and the alpha writes live in this pass, so a tile that finishes
    // loading or becomes ready while the camera is stationary has no other way
    // to reach the scene. It changes only when residency actually changed, and
    // never at all in a session that did not opt into the tier.
  }, [adapter, assetResolver, commercialOverlay, denseFeatureGroups, denseFeatureGroupLimits, denseFeatureLimit, denseFeatures, denseRendering, exteriorOverlay, farTierResidencyGeneration, featureFilter, itinerary, publicRealmOverlay, selectedFeatureId, viewportFootprint, visibleLayers.buildings, visibleLayers.pois, visibleLayers.areas, visibleLayers.stations, visibleLayers.entrances, visibleLayers.routes, visibleLayers["statistical-areas"], visibleLayers.parks, visibleLayers.landmarks]);

  // Exterior cells own a per-cell collection with diff-and-replace discipline so
  // one cell failing closed removes exactly that cell. Bytes come from the
  // runtime already verified; the scene never refetches an artifact by path.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return undefined;
    const owned = exteriorCellCollectionsRef.current;
    // Exterior canonical feature IDs are base building IDs; CesiumJS keeps its
    // WGS84 authority by anchoring on the base feature's own coordinates.
    const plan = planExteriorOverlayUpdate(exteriorOverlayRenderEntries(exteriorOverlay), owned, (entry) => {
      const baseFeature = featureForPickedId(entry.canonicalFeatureId, denseFeatureMapRef.current, adapterRef.current);
      return baseFeature ? { longitude: baseFeature.coordinates[0], latitude: baseFeature.coordinates[1], name: baseFeature.name } : null;
    });
    // Executed exactly as `exteriorRetirementSteps` emits them, so the ordering
    // that makes `onExteriorCellsRetired` EVIDENCE rather than a promise — the
    // revoke strictly before the report — is a property of that function and is
    // asserted against this file rather than restated in a test.
    for (const step of exteriorRetirementSteps(plan)) {
      if (step.op === "remove-entity") viewer.entities.removeById(step.entityId);
      else if (step.op === "forget-pick") exteriorPickMapRef.current.delete(step.entityId);
      else if (step.op === "revoke-object-url") URL.revokeObjectURL(step.objectUrl);
      else if (step.op === "forget-cell") owned.delete(step.cellId);
      else onExteriorCellsRetiredRef.current?.(step.cellIds);
    }
    for (const cell of plan.addCells) {
      // EVERY model URI for this cell is built BEFORE the first entity is added.
      // The load-time canary can throw, and its wording — "fails the cell
      // closed" — has to be true of what actually happens: building first means
      // a refusal leaves nothing half-added to orphan, because nothing was
      // added. Ordering is the whole mechanism; a try/catch around the add loop
      // would still have to unwind entities the scene already owns.
      const built = exteriorCellModelUris(cell);
      if (!built.ok) {
        // The cell is not owned, so the next pass retries it — the same
        // treatment an incomplete cell already gets. Nothing else is disturbed:
        // the remaining cells in this plan are still added.
        exteriorVerifiedResourceFailuresRef.current.set(cell.cellId, built.message);
        continue;
      }
      exteriorVerifiedResourceFailuresRef.current.delete(cell.cellId);
      const entityIds: string[] = [];
      const objectUrls: string[] = [...built.objectUrls];
      for (const [index, { entry, anchor }] of cell.adds.entries()) {
        const modelUri = built.modelUris[index]!;
        const position = Cartesian3.fromDegrees(anchor.longitude, anchor.latitude, 0);
        const enuRotation = Matrix4.getMatrix3(Transforms.eastNorthUpToFixedFrame(position), new Matrix3());
        viewer.entities.removeById(entry.entityId);
        const entity = viewer.entities.add({
          id: entry.entityId,
          name: anchor.name,
          position,
          orientation: Quaternion.fromRotationMatrix(enuRotation),
          model: new ModelGraphics({ uri: modelUri, scale: 1, minimumPixelSize: 1 }),
          properties: {
            canonicalFeatureId: entry.canonicalFeatureId,
            // Per-entry attribution: the entity names the release that actually
            // shipped its bytes, not whatever wave the session happens to lead
            // with. With several waves rendered at once, a scene-level stamp
            // would misattribute every entity outside the leading wave.
            exteriorReleaseId: entry.releaseId,
            exteriorSnapshotId: entry.snapshotId,
            exteriorSnapshotOrigin: entry.origin,
            exteriorProfile: entry.profile,
            exteriorCellId: cell.cellId,
            exteriorCellReleaseId: entry.cellReleaseId,
            exteriorRepresentation: entry.representation,
            activeAssetLod: entry.lodId,
            assetSha256: entry.checksumSha256,
            geometricErrorMeters: entry.geometricErrorMeters,
            uncertainty: entry.provenance.uncertainty,
            localOnly: true,
          },
        });
        if (typeof entity.id === "string") {
          entityIds.push(entity.id);
          exteriorPickMapRef.current.set(entity.id, entry.canonicalFeatureId);
        }
      }
      owned.set(cell.cellId, { entityIds, objectUrls, signature: cell.signature, complete: cell.complete });
    }
    // Published on the container so a refusal is INSPECTABLE rather than merely
    // recorded. A written-never-read map would be dead state and would make the
    // loudest failure this path has — a CesiumJS that stopped preserving the
    // verified resource — visible only in a debugger. Absent when nothing
    // refused, so an ordinary session's DOM is unchanged.
    const failures = exteriorVerifiedResourceFailuresRef.current;
    const container = containerRef.current;
    if (container) {
      if (failures.size === 0) delete container.dataset.exteriorVerifiedResourceFailures;
      else container.dataset.exteriorVerifiedResourceFailures = [...failures].map(([cellId, message]) => `${cellId}: ${message}`).join(" | ");
    }
    const unanchoredKey = plan.unanchoredCanonicalFeatureIds.join(",");
    if (unanchoredKey !== exteriorUnanchoredRef.current) {
      exteriorUnanchoredRef.current = unanchoredKey;
      onExteriorUnanchoredRef.current?.(plan.unanchoredCanonicalFeatureIds);
    }
    return undefined;
  }, [exteriorOverlay, viewerReadyGeneration, denseFeatures, adapter]);

  // Selection feedback for exterior geometry lives in its own effect on
  // purpose. Folding `selectedFeatureId` into the effect above would rebuild the
  // per-cell collections — revoking object URLs and re-adding models — on every
  // click, so selection is applied to the entities that pass already owns.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return undefined;
    const silhouetteColor = Color.fromCssColorString(EXTERIOR_SELECTION_SILHOUETTE_CSS_COLOR);
    for (const [entityId, canonicalFeatureId] of exteriorPickMapRef.current) {
      const model = viewer.entities.getById(entityId)?.model;
      if (!model) continue;
      model.silhouetteColor = new ConstantProperty(silhouetteColor);
      model.silhouetteSize = new ConstantProperty(exteriorSelectionSilhouetteSize(canonicalFeatureId, selectedFeatureId));
    }
    viewer.scene.requestRender();
    return undefined;
  }, [selectedFeatureId, exteriorOverlay, viewerReadyGeneration, denseFeatures, adapter]);

  useEffect(() => {
    const container = containerRef.current;
    const viewer = viewerRef.current;
    if (!container) return undefined;
    if (!stage3StorefrontProofEnabled || !viewer || !commercialOverlay) {
      clearStorefrontProjectionRecords(container);
      clearStage3RenderProof(container);
      onStage3RenderProofRef.current?.(null);
      return undefined;
    }
    let frame: number | null = null;
    const publish = () => {
      frame = null;
      const assetDistanceMeters = Math.max(0, Number.isFinite(viewer.camera.positionCartographic.height) ? viewer.camera.positionCartographic.height : Number.POSITIVE_INFINITY);
      const cameraSignature = storefrontProjectionCameraSignature(cameraStateForViewer(viewer));
      const candidates = [...storefrontPickMapRef.current.entries()].map(([proxyEntityId, placement]) => ({
        storefrontId: placement.storefrontId,
        canonicalBuildingId: placement.canonicalBuildingId ?? "",
        proxyEntityId,
        anchorWgs84: placement.anchorWgs84 ?? null,
        rendered: Boolean(viewer.entities.getById(proxyEntityId)),
      }));
      const storefrontRecords = collectStorefrontProjectionRecords(
        candidates,
        assetDistanceMeters,
        viewer.canvas,
        cameraSignature,
        (anchor) => SceneTransforms.worldToWindowCoordinates(viewer.scene, Cartesian3.fromDegrees(anchor[0], anchor[1], 4)),
      );
      publishStorefrontProjectionRecords(container, storefrontRecords);
      const buildingCandidates = commercialOverlay.manifest.assets.map((asset) => {
        const entity = viewer.entities.getById(asset.canonicalFeatureId);
        const uriProperty = entity?.model?.uri as unknown as { getValue?: (time: unknown) => unknown } | undefined;
        const uriValue = uriProperty?.getValue?.(viewer.clock.currentTime) ?? uriProperty;
        const modelUri = typeof uriValue === "string"
          ? uriValue
          : uriValue && typeof uriValue === "object" && "url" in uriValue && typeof (uriValue as { url?: unknown }).url === "string"
          ? (uriValue as { url: string }).url
          : null;
        return {
          canonicalBuildingId: asset.canonicalFeatureId,
          entityId: asset.canonicalFeatureId,
          modelUri,
          modelEntity: Boolean(entity?.model),
          showing: entity?.isShowing === true,
        };
      });
      const proof = collectStage3RenderProof(buildingCandidates, storefrontRecords, cameraSignature, assetDistanceMeters);
      publishStage3RenderProof(container, proof);
      onStage3RenderProofRef.current?.(proof);
    };
    const schedule = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(publish);
    };
    viewer.camera.changed.addEventListener(schedule);
    viewer.scene.postRender.addEventListener(schedule);
    schedule();
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      viewer.camera.changed.removeEventListener(schedule);
      viewer.scene.postRender.removeEventListener(schedule);
      clearStorefrontProjectionRecords(container);
      clearStage3RenderProof(container);
      onStage3RenderProofRef.current?.(null);
    };
  }, [commercialOverlay, stage3StorefrontProofEnabled, viewerReadyGeneration]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !cameraRequest || !shouldApplyCameraPoseRequest(lastCameraRequestIdRef.current, cameraRequest)) return;
    lastCameraRequestIdRef.current = cameraRequest.requestId;
    suppressCameraEventsUntilRef.current = Date.now() + 900;
    if ("height" in cameraRequest) applyCameraPoseRequest(viewer, cameraRequest);
    else {
      viewer.camera.cancelFlight();
      viewer.camera.setView({ destination: Cartesian3.fromDegrees(cameraRequest.longitude, cameraRequest.latitude, cameraRequest.distanceMeters), orientation: { heading: 0, pitch: CesiumMath.toRadians(-45), roll: 0 } });
    }
    viewer.scene.requestRender();
    cameraSettledEmitterRef.current?.();
  }, [cameraRequest, viewerReadyGeneration]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !previewRequest || !itinerary) return;
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    if (previewRequest.action === "pause" || previewRequest.action === "stop") {
      viewer.camera.cancelFlight();
      if (previewRequest.action === "stop") previewIndexRef.current = 0;
      return;
    }
    const waypoints = itineraryWaypoints(itinerary);
    if (waypoints.length === 0) return;
    if (previewRequest.action === "start") previewIndexRef.current = 0;
    else if (previewRequest.action === "previous") previewIndexRef.current = Math.max(previewIndexRef.current - 1, 0);
    else if (previewRequest.action === "next") previewIndexRef.current = Math.min(previewIndexRef.current + 1, waypoints.length - 1);
    const [longitude, latitude] = waypoints[previewIndexRef.current] ?? waypoints[0]!;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(longitude, latitude, 220), duration: reducedMotion ? 0.01 : cameraDuration(0.6) });
    return () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      viewer.camera.cancelFlight();
    };
  }, [itinerary, previewRequest]);

  useEffect(() => () => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    viewerRef.current?.camera.cancelFlight();
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || focusRequest === 0 || !focusFeatureId) return;
    const publicRealmFeature = publicRealmOverlay?.feature(focusFeatureId.replace(/^public-realm:/u, ""));
    const feature = denseFeatureMapRef.current.get(focusFeatureId) ?? adapter.getFeature(focusFeatureId) ?? (publicRealmFeature && publicRealmOverlay ? publicRealmFeatureToFeature(publicRealmFeature, publicRealmOverlay.document.generatedAt) : undefined);
    if (!feature || !shouldFocusFeature(feature)) return;
    const requestChanged = shouldStartFocusFlight(lastFocusFlightRequestRef.current, focusRequest, true);
    const focusHeight = focusHeightForFeature(feature, assetResolver);
    const focusCoordinates = focusCoordinatesForFeature(feature, assetResolver);
    const focusCameraCoordinates = focusCameraCoordinatesForFeature(feature, focusHeight, focusCoordinates);
    const focusTargetSignature = `${feature.id}:${focusHeight}:${focusCoordinates[0]}:${focusCoordinates[1]}`;
    const targetChanged = focusTargetSignature !== lastFocusTargetSignatureRef.current;
    if (!requestChanged && !targetChanged) return;
    lastFocusFlightRequestRef.current = focusRequest;
    lastFocusTargetSignatureRef.current = focusTargetSignature;
    viewer.camera.cancelFlight();
    const viewport = containerRef.current;
    const inspector = focusOverlayOpen ? viewport?.parentElement?.querySelector<HTMLElement>(".inspector") : null;
    const viewportRect = viewport?.getBoundingClientRect();
    const inspectorRect = inspector?.getBoundingClientRect();
    const viewportWidthPx = viewportRect?.width ?? 0;
    const viewportHeightPx = viewportRect?.height ?? 0;
    const intersectionLeft = viewportRect && inspectorRect ? Math.max(viewportRect.left, inspectorRect.left) : 0;
    const intersectionRight = viewportRect && inspectorRect ? Math.min(viewportRect.right, inspectorRect.right) : 0;
    const intersectionTop = viewportRect && inspectorRect ? Math.max(viewportRect.top, inspectorRect.top) : 0;
    const intersectionBottom = viewportRect && inspectorRect ? Math.min(viewportRect.bottom, inspectorRect.bottom) : 0;
    const intersectionWidth = Math.max(0, intersectionRight - intersectionLeft);
    const intersectionHeight = Math.max(0, intersectionBottom - intersectionTop);
    const overlayCenterX = viewportRect ? (intersectionLeft + intersectionRight) / 2 - viewportRect.left : 0;
    const overlayCenterY = viewportRect ? (intersectionTop + intersectionBottom) / 2 - viewportRect.top : 0;
    const occlusion: FocusOcclusion | undefined = viewportRect && inspectorRect && intersectionWidth > 0 && intersectionHeight > 0
      ? {
        leftPx: overlayCenterX < viewportWidthPx / 2 ? intersectionWidth : 0,
        rightPx: overlayCenterX > viewportWidthPx / 2 ? intersectionWidth : 0,
        topPx: overlayCenterY < viewportHeightPx / 2 ? intersectionHeight : 0,
        bottomPx: overlayCenterY > viewportHeightPx / 2 ? intersectionHeight : 0,
        viewportWidthPx,
        viewportHeightPx,
      }
      : undefined;
    const pose = focusPoseForFeatureWithOcclusion(feature, focusHeight, occlusion, focusCameraCoordinates);
    const duration = cameraDuration(0.6);
    suppressCameraEventsUntilRef.current = Date.now() + Math.max(900, duration * 1_000 + 250);
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(pose.longitude, pose.latitude, pose.height),
      orientation: {
        heading: CesiumMath.toRadians(pose.heading),
        pitch: CesiumMath.toRadians(pose.pitch),
        roll: CesiumMath.toRadians(pose.roll),
      },
      duration,
      complete: () => {
        suppressCameraEventsUntilRef.current = Date.now() + 900;
        const footprint = cameraFootprintForViewer(viewer, lastValidFootprintRef.current);
        if (footprint?.valid) lastValidFootprintRef.current = footprint;
        onCameraChangedRef.current?.(normalizeFocusCameraPose(cameraStateForViewer(viewer), pose), footprint ?? lastValidFootprintRef.current ?? undefined);
      },
    });
  }, [adapter, assetResolver, denseFeatures, focusFeatureId, focusOverlayOpen, focusRequest, publicRealmOverlay]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !cameraPoseRequest || !shouldApplyCameraPoseRequest(lastCameraPoseRequestIdRef.current, cameraPoseRequest)) return;
    lastCameraPoseRequestIdRef.current = cameraPoseRequest.requestId;
    // Set BEFORE the pose is applied and left in force across the deferred emit
    // below. `applyCameraPoseRequest` provokes a `moveEnd`, and the suppression
    // window is what stops that synthetic move from being reported as a settled
    // camera; the forced emit deliberately bypasses it, so the two must not be
    // reordered. `CesiumViewport.landing.test.tsx` asserts the ordering.
    suppressCameraEventsUntilRef.current = Date.now() + 900;
    applyCameraPoseRequest(viewer, cameraPoseRequest);
    viewer.scene.requestRender();
    /**
     * Emit AFTER the first frame at the new camera, not before it (defect D-18).
     *
     * `emitSettledCamera` calls `cameraFootprintForViewer`, which samples the
     * globe with nine pick-rays to build the ground footprint the residency
     * scheduler culls on. Pick-rays read the scene as it was last RENDERED. Called
     * synchronously here — one line after the camera moved and before any frame
     * has been drawn at the new pose — they sampled the OLD view, so a deep link
     * or a landing pose published a footprint belonging to wherever the camera
     * used to be. The consequence is invisible at a cap that does not bind and
     * severe at one that does: the scheduler admits the cells around the previous
     * position and defers the ones the user is actually looking at, and only the
     * next genuine camera move repairs it.
     *
     * A one-shot `postRender` listener is the narrowest fix that is actually
     * correct. `requestRender` above guarantees the frame will come in the
     * request-render mode this viewer runs in; the listener removes itself on the
     * first invocation so a pose request cannot leave a permanent subscriber; and
     * the effect's cleanup removes it too, so a component that unmounts between
     * the request and the frame emits nothing at all rather than touching a torn
     * -down viewer.
     *
     * The `flyTo` completion path above is NOT this defect and is untouched: a
     * flight's `complete` callback already runs after frames have been drawn.
     */
    return emitCameraSettledAfterNextFrame(viewer.scene, () => cameraSettledEmitterRef.current?.());
  }, [cameraPoseRequest]);


  /**
   * THE FAR TIER (T003). Off unless the session asked for it.
   *
   * Fails closed per cell and stays quiet about it in aggregate: absence,
   * checksum mismatch and unanchorable cells each keep their massing and
   * contribute a count, never a per-cell notice. The per-cell detail goes on the
   * container as a dataset attribute, deleted rather than emptied when nothing
   * failed, so an ordinary session's DOM is unchanged.
   */
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!farTier || !viewer) return;
    const controller = new AbortController();
    let disposed = false;
    let residency: ReturnType<typeof createFarTierResidency> | null = null;
    let readinessWatchActive = false;
    let readinessFramesLeft = 0;

    const cameraPose = () => {
      const carto = viewer.camera.positionCartographic;
      return { longitude: CesiumMath.toDegrees(carto.longitude), latitude: CesiumMath.toDegrees(carto.latitude), heightMeters: carto.height };
    };

    /**
     * A far-tier primitive is only worth showing once Cesium reports it ready,
     * and readiness lands during a frame rather than at a promise. This watcher
     * wakes the dense pass on the frame it happens, so a stationary camera gets
     * its tiles instead of waiting for the user to move. It is bounded: after
     * `readinessFramesLeft` frames it gives up and leaves the next genuine
     * camera move to notice, rather than driving frames forever for a tile that
     * is never going to upload.
     */
    const watchReadiness = () => {
      if (disposed || !residency) return;
      const tiles = residency.tiles();
      if (tiles.length === 0) return;
      if (tiles.every((tile) => farTierTileReady(tile.primitive))) {
        viewer.scene.postRender.removeEventListener(watchReadiness);
        readinessWatchActive = false;
        setFarTierResidencyGeneration((generation) => generation + 1);
        return;
      }
      readinessFramesLeft -= 1;
      if (readinessFramesLeft <= 0) {
        viewer.scene.postRender.removeEventListener(watchReadiness);
        readinessWatchActive = false;
        return;
      }
      viewer.scene.requestRender();
    };

    const publishAfterReconcile = (changed: boolean) => {
      if (disposed) return;
      // PUBLISHED EVEN WHEN NOTHING CHANGED. A camera that opens inside the near
      // edge selects no cell, loads nothing and changes nothing — and the tier
      // still owes the user its line, which is exactly "0 drawn, 1 declared, 1
      // near (massing drawing)". Running the app is what caught this: gating the
      // publish on `changed` left the line absent entirely at a near pose.
      farTierBaseOutcomesRef.current = residency?.outcomes() ?? [];
      farTierTilesRef.current = residency?.tiles() ?? [];
      publishFarTierState();
      if (!changed) return;
      // Selection and the alpha writes live in the dense pass, so residency
      // changes have to WAKE it. Without this the tier activated only when some
      // unrelated dense dependency happened to change.
      setFarTierResidencyGeneration((generation) => generation + 1);
      if (!readinessWatchActive && (residency?.tiles().length ?? 0) > 0) {
        readinessWatchActive = true;
        readinessFramesLeft = 900;
        viewer.scene.postRender.addEventListener(watchReadiness);
      }
      viewer.scene.requestRender();
    };

    const onCameraSettled = () => {
      if (disposed || !residency) return;
      void residency.reconcile(cameraPose()).then(publishAfterReconcile);
    };

    void (async () => {
      let inventory;
      try {
        const response = await fetch(`/${FAR_TIER_PAYLOAD_INVENTORY_REF}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        // THE STAGED INVENTORY IS A CACHE OF THE COMMITTED ONE, NOT A SECOND
        // AUTHORITY. Its digest is pinned in shipped code, so a swapped staged
        // file cannot declare its own checksums for the tiles and have every
        // per-tile check below faithfully verify against them.
        inventory = parseVerifiedFarTierInventory(await response.text());
      } catch {
        // Nothing staged, or something staged that is not what this build
        // declares. Either way the massing keeps drawing exactly as it does
        // today, and the tier reports nothing rather than something wrong.
        if (!disposed) onFarTierStateRef.current?.({ declared: 0, drawn: 0, near: 0, notDeclared: 0, absent: 0, checksumMismatch: 0, buildFailure: 0, overBudget: 0 });
        return;
      }
      if (disposed) return;
      residency = createFarTierResidency({
        // The scene wrapper is where the teardown guard lives: React runs this
        // effect's cleanup AFTER the viewer effect's, so by the time a release
        // reaches the scene the viewer may already be destroyed, and Cesium
        // throws on a destroyed viewer rather than ignoring the call.
        scene: {
          primitives: {
            add: (primitive) => viewer.scene.primitives.add(primitive),
            remove: (primitive) => (viewer.isDestroyed() ? false : viewer.scene.primitives.remove(primitive)),
          },
        },
        entries: inventory.entries,
        fetcher: createFarTierFetcher((url, init) => fetch(url, init)),
        signal: controller.signal,
        // AT ADD TIME. The pick bracket reads this list on every pick, so a tile
        // that arrives mid-load must be coverable immediately rather than when
        // the whole ring resolves.
        onPrimitiveAdded: (primitive) => { farTierPrimitivesRef.current = [...farTierPrimitivesRef.current, primitive]; },
        onPrimitiveRemoved: (primitive) => { farTierPrimitivesRef.current = farTierPrimitivesRef.current.filter((entry) => entry !== primitive); },
      });
      viewer.camera.moveEnd.addEventListener(onCameraSettled);
      publishAfterReconcile(await residency.reconcile(cameraPose()));
    })();

    return () => {
      disposed = true;
      controller.abort();
      // THE VIEWER IS USUALLY ALREADY GONE BY HERE. React runs this effect's
      // cleanup AFTER the viewer effect's, which destroys the viewer, and a
      // destroyed Cesium `Viewer` throws from `camera` and `scene` rather than
      // ignoring the call — so an unmount with the far tier on took the whole
      // component down with it. Running the app is what caught this: React's
      // development double-invoke made it fire on every mount.
      if (!viewer.isDestroyed()) {
        viewer.camera.moveEnd.removeEventListener(onCameraSettled);
        if (readinessWatchActive) viewer.scene.postRender.removeEventListener(watchReadiness);
      }
      // Every primitive this tier ever added is tracked by the residency from
      // the instant it entered the scene, so an aborted mid-load leaves nothing
      // behind. The removal itself is guarded against a destroyed viewer by the
      // scene wrapper above.
      residency?.releaseAll();
      farTierPrimitivesRef.current = [];
      farTierTilesRef.current = [];
      farTierDrawnCellsRef.current = new Set();
      farTierBaseOutcomesRef.current = [];
      const container = containerRef.current;
      if (container) delete container.dataset.farTierFailures;
    };
  }, [farTier, publishFarTierState]);

  return <div className="viewport" ref={containerRef} aria-label="3D city viewport" tabIndex={0} onKeyDown={onViewportKeyDown} />;
}
