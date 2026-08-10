import { useEffect, useRef, useState } from "react";
import type { KeyboardEventHandler } from "react";
import {
  Cartesian3,
  Cartesian2,
  Cartographic,
  CameraEventType,
  Color,
  ColorGeometryInstanceAttribute,
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
import {
  viewportFootprintFromGroundPoints,
  viewportBoundsIntersect,
  type ViewportBounds,
  type ViewportFootprint,
} from "../../runtime/viewport-footprint";

interface CesiumViewportProps {
  adapter: RuntimeCityAdapter;
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
  exteriorOverlay?: ExteriorCellOverlay | null;
  onExteriorUnanchored?: (canonicalFeatureIds: string[]) => void;
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

export interface DenseRenderMetrics {
  featureCount: number;
  primitiveCount: number;
  instanceCount: number;
  buildingFeatureCount: number;
  pointFeatureCount: number;
  baseFeatureCount?: number;
  contextFeatureCount?: number;
  contextPartCount?: number;
  /** Counters make repeated dense-plan work observable in the local diagnostics. */
  planBuildCount?: number;
  planReuseCount?: number;
  planCancellationCount?: number;
  planSwapCount?: number;
  planFingerprint?: string;
  selectionMs?: number;
  keyMs?: number;
  allocationMs?: number;
  allocationMaxSliceMs?: number;
  allocationChunkCount?: number;
  workerReadyMs?: number;
  totalBuildMs?: number;
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
  planFingerprint: string;
  selectionMs: number;
  keyMs: number;
  allocationMs?: number;
  allocationMaxSliceMs?: number;
  allocationChunkCount?: number;
  workerReadyMs?: number;
  totalBuildMs?: number;
}

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
}

/** Only cells the runtime actually verified reach the scene; failures render nothing. */
export function exteriorOverlayRenderEntries(overlay: ExteriorCellOverlay | null | undefined): ExteriorCellRenderEntry[] {
  if (!overlay) return [];
  return overlay.cells
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
    })))
    .sort((left, right) => (left.entityId < right.entityId ? -1 : left.entityId > right.entityId ? 1 : 0));
}

/** Diff key for one cell's owned collection; a change replaces exactly that cell. */
export function exteriorCellSignature(entries: readonly ExteriorCellRenderEntry[]): string {
  return entries.map((entry) => `${entry.entityId}|${entry.cellReleaseId}|${entry.representation}|${entry.lodId}|${entry.checksumSha256}`).join(";");
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

export interface ExteriorOverlayCellPlan {
  cellId: string;
  signature: string;
  complete: boolean;
  adds: Array<{ entry: ExteriorCellRenderEntry; anchor: ExteriorOverlayAnchor }>;
  unanchoredCanonicalFeatureIds: string[];
}

export interface ExteriorOverlayPlan {
  removeCellIds: string[];
  removeEntityIds: string[];
  revokeObjectUrls: string[];
  retainedCellIds: string[];
  addCells: ExteriorOverlayCellPlan[];
  unanchoredCanonicalFeatureIds: string[];
}

/**
 * Pure diff between the currently owned per-cell collections and the verified
 * entries the runtime produced. Keeping this outside the imperative Cesium
 * effect makes the retry, isolation, and object-URL revocation rules testable.
 */
export function planExteriorOverlayUpdate(
  entries: readonly ExteriorCellRenderEntry[],
  owned: ReadonlyMap<string, ExteriorOwnedCellCollection>,
  anchorFor: (entry: ExteriorCellRenderEntry) => ExteriorOverlayAnchor | null,
): ExteriorOverlayPlan {
  const byCell = new Map<string, ExteriorCellRenderEntry[]>();
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
  const addCells: ExteriorOverlayCellPlan[] = [];
  const unanchored: string[] = [];
  for (const [cellId, cellEntries] of byCell) {
    if (retained.has(cellId)) continue;
    const adds: ExteriorOverlayCellPlan["adds"] = [];
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

export function shouldApplyCameraPoseRequest(lastRequestId: number, request: { requestId: number } | undefined): boolean {
  return Boolean(request && Number.isSafeInteger(request.requestId) && request.requestId > 0 && request.requestId !== lastRequestId);
}

export function shouldReplaceDenseRenderPlan(previousFeatures: readonly Feature[] | null, nextFeatures: readonly Feature[]): boolean {
  return previousFeatures === null || previousFeatures.length !== nextFeatures.length || previousFeatures.some((feature, index) => feature !== nextFeatures[index]);
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

function denseBuildingInstance(feature: DenseBuildingFeature): GeometryInstance {
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
    attributes: { color: ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString("#d7a85d").withAlpha(0.82)) },
  });
}

function addDensePrimitives(
  collection: PrimitiveCollection,
  buildingInstances: readonly GeometryInstance[],
  points: readonly Feature[],
): DenseRenderMetrics {
  let primitiveCount = 0;
  for (let start = 0; start < buildingInstances.length; start += DENSE_PRIMITIVE_GROUP_SIZE) {
    const primitive = new Primitive({
      geometryInstances: buildingInstances.slice(start, start + DENSE_PRIMITIVE_GROUP_SIZE),
      appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
      asynchronous: true,
    });
    collection.add(primitive);
    primitiveCount += 1;
  }
  if (points.length) {
    const pointCollection = collection.add(new PointPrimitiveCollection());
    const style = densePoiMarkerStyle(false);
    for (const feature of points) {
      pointCollection.add({ id: feature.id, position: Cartesian3.fromDegrees(feature.coordinates[0], feature.coordinates[1], 14), pixelSize: style.pixelSize, color: Color.fromCssColorString(style.color).withAlpha(style.opacity), outlineColor: Color.WHITE, outlineWidth: style.outlineWidth });
    }
    primitiveCount += 1;
  }
  return {
    featureCount: buildingInstances.length + points.length,
    primitiveCount,
    instanceCount: buildingInstances.length + points.length,
    buildingFeatureCount: buildingInstances.length,
    pointFeatureCount: points.length,
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
      if (isDenseBuildingFeature(feature)) buildingInstances.push(denseBuildingInstance(feature));
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
    const metrics = addDensePrimitives(collection, buildingInstances, points);
    const finalizeMs = performance.now() - finalizeStartedAt;
    allocationMs += finalizeMs;
    allocationMaxSliceMs = Math.max(allocationMaxSliceMs, finalizeMs);
    build.result = {
      metrics,
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
  return viewportFootprintFromGroundPoints(groundPoints, { lastValid, fallbackBounds: fallbackBoundsForViewer(viewer) });
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
  const denseRenderPlanFeaturesRef = useRef<readonly Feature[] | null>(null);
  const denseBuildGenerationRef = useRef(0);
  const denseRenderTelemetryRef = useRef<DenseRenderTelemetry>({ planBuildCount: 0, planReuseCount: 0, planCancellationCount: 0, planSwapCount: 0, planFingerprint: "", selectionMs: 0, keyMs: 0 });
  const denseMetricsRef = useRef<DenseRenderMetrics>(emptyDenseRenderMetrics());
  const denseGroupMetricsRef = useRef({ baseFeatureCount: 0, contextFeatureCount: 0, contextPartCount: 0 });
  const ownedEntityIdsRef = useRef(new Set<string>());
  const storefrontPickMapRef = useRef(new Map<string, CommercialStorefrontPlacement>());
  const publicRealmPickMapRef = useRef(new Map<string, Block835PublicRealmFeature>());
  const exteriorPickMapRef = useRef(new Map<string, string>());
  const exteriorCellCollectionsRef = useRef(new Map<string, ExteriorOwnedCellCollection>());
  const exteriorUnanchoredRef = useRef<string>("");
  const onExteriorUnanchoredRef = useRef(onExteriorUnanchored);
  onExteriorUnanchoredRef.current = onExteriorUnanchored;
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
    viewer.screenSpaceEventHandler.setInputAction((movement: { position: Cartesian2 }) => {
      const picks = viewer.scene.drillPick(movement.position, 12) as Array<{ id?: unknown }>;
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
      const picked = viewer.scene.pick(movement.position) as { id?: unknown } | undefined;
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
      const primitiveDenseFeatures = renderedGroups.base.filter((feature) => !assetBuildingIds.has(feature.id));
      const telemetry = denseRenderTelemetryRef.current;
      telemetry.selectionMs = performance.now() - selectionStartedAt;
      const keyStartedAt = performance.now();
      const nextDensePlanKey = denseRenderPlanKey(primitiveDenseFeatures);
      telemetry.keyMs = performance.now() - keyStartedAt;
      telemetry.planFingerprint = nextDensePlanKey;
      const groupMetrics = { baseFeatureCount: renderedGroups.base.length, contextFeatureCount: renderedGroups.context.length, contextPartCount: renderedGroups.context.reduce((sum, feature) => sum + denseRenderPartCount(feature), 0) };
      denseGroupMetricsRef.current = groupMetrics;
      const publishDenseMetrics = (metrics: DenseRenderMetrics): void => {
        onDenseMetricsRef.current?.({ ...withDenseRenderTelemetry(metrics, telemetry), ...denseGroupMetricsRef.current });
      };
      if (denseRendering && rootDenseCollection && shouldReplaceDenseRenderPlan(denseRenderPlanFeaturesRef.current, primitiveDenseFeatures)) {
        const pending = pendingDenseLayerRef.current;
        if (pendingDenseBuildRef.current) telemetry.planCancellationCount += 1;
        pendingDenseBuildRef.current?.cancel();
        pendingDenseBuildRef.current = null;
        if (pending && pending !== activeDenseLayerRef.current) rootDenseCollection.remove(pending);
        const nextDenseLayer = new PrimitiveCollection();
        rootDenseCollection.add(nextDenseLayer);
        const previousDenseLayer = activeDenseLayerRef.current;
        const buildGeneration = denseBuildGenerationRef.current + 1;
        denseBuildGenerationRef.current = buildGeneration;
        denseRenderPlanFeaturesRef.current = primitiveDenseFeatures;
        telemetry.planBuildCount += 1;
        pendingDenseLayerRef.current = nextDenseLayer;
        const pendingBuild = scheduleDensePrimitiveBuild(viewer, nextDenseLayer, primitiveDenseFeatures, (result) => {
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
          if (previousDenseLayer && previousDenseLayer !== nextDenseLayer) rootDenseCollection.remove(previousDenseLayer);
          activeDenseLayerRef.current = nextDenseLayer;
          if (pendingDenseLayerRef.current === nextDenseLayer) pendingDenseLayerRef.current = null;
          if (pendingDenseBuildRef.current === pendingBuild) pendingDenseBuildRef.current = null;
          const result = pendingBuild.result;
          if (result) {
            telemetry.workerReadyMs = performance.now() - result.allocationCompletedAt;
            telemetry.totalBuildMs = performance.now() - result.startedAt;
            telemetry.planSwapCount += 1;
            denseMetricsRef.current = result.metrics;
            publishDenseMetrics(result.metrics);
          }
          viewer.scene.postRender.removeEventListener(commitDenseLayer);
        };
        viewer.scene.postRender.addEventListener(commitDenseLayer);
        viewer.scene.requestRender();
      } else if (denseRendering && rootDenseCollection) {
        telemetry.planReuseCount += 1;
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
        Object.assign(telemetry, { planBuildCount: 0, planReuseCount: 0, planCancellationCount: 0, planSwapCount: 0, planFingerprint: "", selectionMs: 0, keyMs: 0, allocationMs: undefined, allocationMaxSliceMs: undefined, allocationChunkCount: undefined, workerReadyMs: undefined, totalBuildMs: undefined });
        denseMetricsRef.current = emptyDenseRenderMetrics();
      }
      const semanticBaseFeatures = denseRendering
        ? renderedGroups.base.filter((feature) => (feature.kind !== "building" && feature.kind !== "poi") || assetBuildingIds.has(feature.id))
        : renderedDenseFeatures;
      const semanticContextFeatures = denseRendering
        ? renderedGroups.context.filter((feature) => (feature.kind !== "building" && feature.kind !== "poi") || assetBuildingIds.has(feature.id))
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
        if (selectedFeature && !semanticBaseFeatures.some((feature) => feature.id === selectedFeature.id) && !semanticContextFeatures.some((feature) => feature.id === selectedFeature.id) && selectedFeature.kind !== "poi") {
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
  }, [adapter, assetResolver, commercialOverlay, denseFeatureGroups, denseFeatureGroupLimits, denseFeatureLimit, denseFeatures, denseRendering, featureFilter, itinerary, publicRealmOverlay, selectedFeatureId, viewportFootprint, visibleLayers.buildings, visibleLayers.pois, visibleLayers.areas, visibleLayers.stations, visibleLayers.entrances, visibleLayers.routes, visibleLayers["statistical-areas"], visibleLayers.parks, visibleLayers.landmarks]);

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
    for (const entityId of plan.removeEntityIds) {
      viewer.entities.removeById(entityId);
      exteriorPickMapRef.current.delete(entityId);
    }
    for (const objectUrl of plan.revokeObjectUrls) URL.revokeObjectURL(objectUrl);
    for (const cellId of plan.removeCellIds) owned.delete(cellId);
    for (const cell of plan.addCells) {
      const entityIds: string[] = [];
      const objectUrls: string[] = [];
      for (const { entry, anchor } of cell.adds) {
        const objectUrl = exteriorModelObjectUrl(entry.bytes);
        objectUrls.push(objectUrl);
        const position = Cartesian3.fromDegrees(anchor.longitude, anchor.latitude, 0);
        const enuRotation = Matrix4.getMatrix3(Transforms.eastNorthUpToFixedFrame(position), new Matrix3());
        viewer.entities.removeById(entry.entityId);
        const entity = viewer.entities.add({
          id: entry.entityId,
          name: anchor.name,
          position,
          orientation: Quaternion.fromRotationMatrix(enuRotation),
          model: new ModelGraphics({ uri: objectUrl, scale: 1, minimumPixelSize: 1 }),
          properties: {
            canonicalFeatureId: entry.canonicalFeatureId,
            exteriorReleaseId: exteriorOverlay?.releaseId ?? null,
            exteriorSnapshotId: exteriorOverlay?.snapshotId ?? null,
            exteriorSnapshotOrigin: exteriorOverlay?.origin ?? null,
            exteriorProfile: exteriorOverlay?.profile ?? null,
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
    const unanchoredKey = plan.unanchoredCanonicalFeatureIds.join(",");
    if (unanchoredKey !== exteriorUnanchoredRef.current) {
      exteriorUnanchoredRef.current = unanchoredKey;
      onExteriorUnanchoredRef.current?.(plan.unanchoredCanonicalFeatureIds);
    }
    return undefined;
  }, [exteriorOverlay, viewerReadyGeneration, denseFeatures, adapter]);

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
    suppressCameraEventsUntilRef.current = Date.now() + 900;
    applyCameraPoseRequest(viewer, cameraPoseRequest);
    viewer.scene.requestRender();
    cameraSettledEmitterRef.current?.();
  }, [cameraPoseRequest]);

  return <div className="viewport" ref={containerRef} aria-label="3D city viewport" tabIndex={0} onKeyDown={onViewportKeyDown} />;
}
