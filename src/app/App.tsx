import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  Bookmark,
  Box,
  ChevronLeft,
  Clock3,
  Compass,
  Crosshair,
  Database,
  HelpCircle,
  Layers3,
  Search,
  Settings,
  X,
} from "lucide-react";
import {
  featureMatchesQuery,
  projectFeatureToCityFeature,
  provenanceLabel,
  runtimeMarker,
} from "../domain/features";
import type { Feature, TravelContextOverlapCandidate, TravelContextRecordKind } from "../domain/schema";
import type { Itinerary, TravelMode } from "../domain/routing";
import { PLACE_CATEGORIES, placeCategoriesFromFeature, type PlaceCategory } from "../domain/places";
import { evaluatePlaceHours, placeTruthCategoryLabel } from "../domain/place-truth";
import { placeTruthByRuntimeFeatureId, placeTruthFixtures } from "../domain/place-truth-fixtures";
import { areaSemanticsLabel, isAreaSemantic } from "../domain/areas";
import { transitKindLabel } from "../domain/transit";
import { DEFAULT_PROXIMITY_MAX_RESULTS, DEFAULT_PROXIMITY_THRESHOLD_METERS, findNearbyFeatures, formatDistanceMeters, representativePoint } from "../domain/proximity";
import { buildSyntheticReconciliationCatalog } from "../domain/reconciliation-fixtures";
import { searchReconciledCatalog, type CanonicalEntity } from "../domain/reconciliation";
import { rankOverlapCandidates, searchMixedReleaseFeatures, searchRealPlaceCatalog, searchUnifiedCatalog, type UnifiedSearchResult } from "../domain/exploration";
import { buildCatalogRelease } from "../release/catalog-release";
import { buildSyntheticCatalogArtifacts } from "../release/fixtures";
import { CesiumViewport, exteriorUnanchoredNotice, medianFrameInterval, shouldFocusFeature, type DenseRenderMetrics, type ExteriorCellOverlay, type Stage3RenderProof } from "../features/explorer/CesiumViewport";
import { LocalFixtureCityAdapter, type RuntimeCityAdapter } from "../runtime/fixture-adapter";
import { RouteGraphSnapshotAdapter } from "../ingestion/route-graph-snapshot";
import { sha256Hex } from "../ingestion/offline";
import routeGraphFixture from "../ingestion/fixtures/route-graph.synthetic.fixture.json";
import { generateSyntheticTileHarness, SYNTHETIC_TILE_ANCHORS, type SyntheticTileContent } from "../runtime/synthetic-tile-harness";
import { RuntimeTileStream, type TileCameraState, type TileStreamMetrics } from "../runtime/tile-stream";
import { DEFAULT_CAMERA_POSE, loadSavedNavigation, navigationUrl, normalizeCameraPose, parseNavigationUrl, persistSavedNavigation, saveJourney, savePlace, stepIndex, journeyStepCount, VISITOR_NAVIGATION_SCHEMA_VERSION, type CameraMode, type CameraPose, type NavigationDataMode, type SavedNavigationState } from "../domain/visitor-navigation";
import {
  DEFAULT_LAYER_VISIBILITY,
  LAYER_LABELS,
  type LayerVisibility,
  type RuntimeLayerId,
} from "../runtime/layers";
import { loadRealPilot } from "../runtime/real-pilot-manifest";
import { parseRealPlaceFeature, REAL_PILOT_RELEASE_ID, type RealPlaceView } from "../runtime/real-place-view";
import { loadLandmarkAssets } from "../runtime/landmark-assets";
import { CITYWIDE_BUDGETS, CITYWIDE_RELEASE_ID, CitywideLruCache } from "../release/citywide-release";
import { loadCitywideRelease } from "../runtime/citywide-release-runtime";
import type { CitywideReleaseAdapter, CitywideRuntimeMetrics } from "../runtime/citywide-release-runtime";
import { loadTravelContextRelease, type TravelContextFault, type TravelContextReleaseAdapter, type TravelContextRuntimeMetrics } from "../runtime/travel-context-release-runtime";
import { TRAVEL_CONTEXT_BUDGETS, TRAVEL_CONTEXT_RELEASE_ID, TRAVEL_CONTEXT_TILE_LEVEL } from "../release/travel-context-release";
import { AggregateRequestBudget, ComposedReleaseAdapter, type ComposedReleaseMetrics } from "../runtime/composed-release-runtime";
import { EXTERIOR_PILOT_RELEASE_ID, createExteriorPilotFaultFetcher, loadExteriorPilotRelease, parseExteriorPilotFault, type CommercialStorefrontPlacement, type LoadedExteriorPilotRelease } from "../runtime/exterior-pilot-release";
import { BLOCK835_PUBLIC_REALM_RELEASE_ID, createBlock835PublicRealmFaultFetcher, loadBlock835PublicRealmRelease, parseBlock835PublicRealmFault, publicRealmFeatureToFeature, type Block835PublicRealmFeature, type LoadedBlock835PublicRealmRelease } from "../runtime/block835-public-realm-release";
import { EXTERIOR_RUNTIME_BUDGETS, loadExteriorCellRuntime, type ExteriorCellOutcome, type ExteriorCellRuntime, type ExteriorHeadRequest } from "../runtime/exterior-cell-runtime";
import { createExteriorAssetFaultFetcher, createExteriorCellFaultFetcher, parseExteriorAssetFault, parseExteriorCellFault } from "../runtime/exterior-cell-fault";
import { EXTERIOR_DEFAULT_ACTIVATION, exteriorAcceptedCellsDigest, exteriorDefaultActivations, exteriorRolledBackReleaseNotice, exteriorStreamingOverrideDisables, exteriorUnavailableStatements, resolveExteriorActivationSet, restoresPromotedDefault, verifyPromotedExteriorMembership, verifyPromotedExteriorPin, type ExteriorDefaultActivationRecord, type ExteriorDefaultActivationRecords, type ExteriorReleaseActivation, type ExteriorStreamingOverride } from "../runtime/exterior-default-activation";
import {
  BLOCK835_CANARY_REPEATS,
  BLOCK835_CANARY_SAMPLES_PER_POSE,
  BLOCK835_CANARY_SETTLE_MS,
  block835CanaryBudgetVerdict,
  block835CanaryHeapVerdict,
  block835CanaryRuntimeVerdict,
  estimateCanaryDisplay,
  exteriorCanaryTarget,
  parseBlock835CanaryProbeMode,
  summarizeCanaryFrames,
  type Block835CanaryProbeResult,
  type Block835CanaryRepeatSample,
} from "../runtime/block835-canary-probe";
import { MIDTOWN_CORE_CANARY_FACADE_PATH } from "../runtime/midtown-core-canary-facade-path";
import { DEFAULT_EXTERIOR_RENDER_PROFILE, EXTERIOR_RENDER_PROFILES, exteriorRenderProfileLabel, parseExteriorRenderProfile, type ExteriorRenderProfile } from "../runtime/exterior-render-profiles";
import { exteriorNotShippedSummary, exteriorQualifiedNotice, exteriorWaveForSelection } from "../runtime/exterior-wave-attribution";
import { fallbackViewportFootprint, type ViewportFootprint } from "../runtime/viewport-footprint";

const navigation = [
  { label: "Explore", icon: Compass },
  { label: "Layers", icon: Layers3 },
  { label: "Bookmarks", icon: Bookmark },
] as const;

const CIVIC_FACETS = ["statistical-area", "park", "landmark-record"] as const satisfies readonly TravelContextRecordKind[];
type CivicFacet = (typeof CIVIC_FACETS)[number];
const civicFacetLabel = (facet: CivicFacet): string => facet === "statistical-area" ? "Statistical areas" : facet === "park" ? "Parks" : "Landmark records";

const CITYWIDE_DEBUG_ANCHORS = [
  { label: "Financial/Battery", longitude: -74.012, latitude: 40.706 },
  { label: "Chelsea/Midtown", longitude: -73.992, latitude: 40.748 },
  { label: "Upper West", longitude: -73.975, latitude: 40.787 },
  { label: "Upper East", longitude: -73.956, latitude: 40.773 },
  { label: "Harlem", longitude: -73.944, latitude: 40.817 },
  { label: "Inwood/Marble Hill", longitude: -73.922, latitude: 40.871 },
  { label: "Roosevelt Island", longitude: -73.949, latitude: 40.762 },
] as const;

/**
 * Build-time opt-in for the T009 Block 835 canary validation harness (the
 * canary frame-time probe and the exterior-cell fault seam). A normal
 * `pnpm build` leaves `VITE_BLOCK835_PROBE` unset, so this constant folds to
 * `false` and both branches are tree-shaken out of the shipped bundle. The
 * separate `import.meta.env.DEV` guards on the Stage 3 probe and the Stage 3
 * fault fetcher are untouched.
 */
const BLOCK835_CANARY_HARNESS_ENABLED = import.meta.env.VITE_BLOCK835_PROBE === "1";

const BLOCK835_PERFORMANCE_PROBE_QUERY = "block835Performance";
const BLOCK835_PERFORMANCE_CAMERA_PATH_ID = "block835-stage3-six-pose-v1";
const BLOCK835_PERFORMANCE_SETTLE_MS = 1_000;
const BLOCK835_PERFORMANCE_SAMPLES_PER_POSE = 100;
const BLOCK835_PERFORMANCE_CAMERA_PATH = [
  { longitude: -73.98683, latitude: 40.74825, height: 760, heading: 0, pitch: -45, roll: 0 },
  { longitude: -73.98658, latitude: 40.74853, height: 720, heading: 22, pitch: -43, roll: 0 },
  { longitude: -73.98622, latitude: 40.74885, height: 680, heading: 48, pitch: -42, roll: 0 },
  { longitude: -73.98588, latitude: 40.74904, height: 720, heading: 82, pitch: -44, roll: 0 },
  { longitude: -73.98563, latitude: 40.74876, height: 760, heading: 118, pitch: -46, roll: 0 },
  { longitude: -73.98616, latitude: 40.74852, height: 700, heading: 156, pitch: -43, roll: 0 },
] as const satisfies readonly CameraPose[];

export type Block835PerformanceProbeMode = "stage3-only" | "stage3-plus-public-realm";

export interface Block835FrameSummary {
  sampleCount: number;
  medianMs: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

export interface Block835PerformanceProbeResult extends Block835FrameSummary {
  schemaVersion: "1.0";
  status: "waiting-for-prerequisites" | "waiting-for-focus" | "running" | "invalid" | "complete";
  condition: Block835PerformanceProbeMode;
  releaseId: string;
  browserSessionId: string | null;
  capturedAt: string | null;
  cameraPath: { id: string; poses: readonly CameraPose[]; settleMs: number; samplesPerPose: number };
  documentHasFocus: { before: boolean; after: boolean };
  visibilityState: { before: DocumentVisibilityState; after: DocumentVisibilityState };
  viewportCss: { width: number; height: number };
  devicePixelRatio: number;
  consoleErrors: readonly string[];
  windowErrors: readonly string[];
  networkHosts: readonly string[];
  reason: string | null;
  control: Block835PerformanceProbeResult | null;
  comparison: { sameBrowserSession: boolean; p95DeltaMs: number | null; p95Regression: number | null; overlayMedianPass: boolean; overlayP95Pass: boolean; p95RegressionPass: boolean; pass: boolean } | null;
}

const fixtureAdapter = new LocalFixtureCityAdapter();
const fixtureIngestionSummary = runtimeMarker.ingestionSummary;
const syntheticCatalog = buildSyntheticReconciliationCatalog();
const syntheticCatalogV1 = buildCatalogRelease(buildSyntheticCatalogArtifacts("v1"), { releaseVersion: "fixture-v1", generatedAt: "2026-08-03T00:00:00Z", fixtureOnly: true });
const syntheticCatalogRelease = buildCatalogRelease(buildSyntheticCatalogArtifacts("v2"), { releaseVersion: "fixture-v2", generatedAt: "2026-08-04T00:00:00Z", fixtureOnly: true, previousRelease: syntheticCatalogV1 });
const EMPTY_CITYWIDE_METRICS: CitywideRuntimeMetrics = {
  visibleShardCount: 0,
  requestedShardCount: 0,
  loadedFeatureCount: 0,
  loadedBytes: 0,
  maxConcurrentRequests: 0,
  activeRequests: 0,
  failedRequestCount: 0,
  cancelledRequestCount: 0,
  staleResultCount: 0,
  retainedSummaryCount: 0,
  retainedFeatureCount: 0,
  retainedDetailCount: 0,
  detailIndexEntryCount: 0,
  cacheEntries: 0,
  cacheEvictions: 0,
  dedupedRefreshCount: 0,
};

const EMPTY_TRAVEL_CONTEXT_METRICS: TravelContextRuntimeMetrics = {
  visibleShardCount: 0,
  requestedShardCount: 0,
  loadedFeatureCount: 0,
  loadedBytes: 0,
  maxConcurrentRequests: 0,
  activeRequests: 0,
  failedRequestCount: 0,
  cancelledRequestCount: 0,
  staleResultCount: 0,
  retainedSummaryCount: 0,
  retainedFeatureCount: 0,
  retainedDetailCount: 0,
  detailIndexEntryCount: 0,
  cacheEntries: 0,
  cacheEvictions: 0,
  failedLayers: [],
  dedupedRefreshCount: 0,
};

const EMPTY_COMPOSED_METRICS: ComposedReleaseMetrics = {
  base: EMPTY_CITYWIDE_METRICS,
  context: EMPTY_TRAVEL_CONTEXT_METRICS,
  aggregate: {
    cacheEntries: 0,
    cachedBytes: 0,
    cacheEvictions: 0,
    maxCacheEntries: CITYWIDE_BUDGETS.maxLoadedShards,
    maxCachedBytes: CITYWIDE_BUDGETS.maxLoadedBytes,
    activeRequests: 0,
    maxConcurrentRequests: CITYWIDE_BUDGETS.maxConcurrentRequests,
    peakConcurrentRequests: 0,
    requestedShardCount: 0,
    loadedShardCount: 0,
    failedRequestCount: 0,
    cancelledRequestCount: 0,
    staleResultCount: 0,
  },
  failedRoles: [],
  render: { baseFeatureCount: 0, contextFeatureCount: 0, baseLimit: CITYWIDE_BUDGETS.maxRenderedDenseFeatures, contextLimit: TRAVEL_CONTEXT_BUDGETS.maxAreaRenderParts },
};

type CitywideDebugMeasurement = {
  anchor: string;
  status: "idle" | "settling" | "measuring" | "complete";
  frameCount: number;
  frameAverageMs: number | null;
  frameMedianMs: number | null;
  frameP95Ms: number | null;
  frameMaxMs: number | null;
  heapBytes: number | null;
  citywideResourceCount: number;
  citywideResourceBytes: number;
};

const EMPTY_CITYWIDE_DEBUG_MEASUREMENT: CitywideDebugMeasurement = {
  anchor: "",
  status: "idle",
  frameCount: 0,
  frameAverageMs: null,
  frameMedianMs: null,
  frameP95Ms: null,
  frameMaxMs: null,
  heapBytes: null,
  citywideResourceCount: 0,
  citywideResourceBytes: 0,
};

const EMPTY_CITYWIDE_DENSE_METRICS: DenseRenderMetrics = {
  featureCount: 0,
  primitiveCount: 0,
  instanceCount: 0,
  buildingFeatureCount: 0,
  pointFeatureCount: 0,
  baseFeatureCount: 0,
  contextFeatureCount: 0,
  contextPartCount: 0,
  planBuildCount: 0,
  planReuseCount: 0,
  planCancellationCount: 0,
  planSwapCount: 0,
  planFingerprint: "",
  selectionMs: 0,
  keyMs: 0,
};

type CitywideBrowserBaseline = {
  heapBytes: number | null;
  citywideResourceCount: number;
  citywideResourceBytes: number;
};

const EMPTY_CITYWIDE_BROWSER_BASELINE: CitywideBrowserBaseline = {
  heapBytes: null,
  citywideResourceCount: 0,
  citywideResourceBytes: 0,
};

/** Retain a stable array only when every immutable feature object is unchanged. */
export function preserveFeatureSequence(previous: readonly Feature[], next: readonly Feature[]): Feature[] {
  return previous.length === next.length && previous.every((feature, index) => feature === next[index]) ? previous as Feature[] : [...next];
}

export async function resolveStorefrontBuilding(
  placement: Pick<CommercialStorefrontPlacement, "canonicalBuildingId">,
  activeAdapter: Pick<RuntimeCityAdapter, "getFeature">,
  loadCanonical?: (featureId: string) => Promise<Feature | undefined>,
): Promise<Feature | undefined> {
  const canonicalBuildingId = placement.canonicalBuildingId;
  if (!canonicalBuildingId) return undefined;
  const loaded = activeAdapter.getFeature(canonicalBuildingId);
  if (loaded) return loaded;
  return loadCanonical?.(canonicalBuildingId);
}

export type StorefrontResolutionState = {
  requestId: number;
  adapter: unknown;
  dataMode: NavigationDataMode;
};

export function isCurrentStorefrontResolution(request: StorefrontResolutionState, current: StorefrontResolutionState): boolean {
  return request.requestId === current.requestId && request.adapter === current.adapter && request.dataMode === current.dataMode;
}

export function applyStorefrontResolution(
  request: StorefrontResolutionState,
  current: () => StorefrontResolutionState,
  resolution: Promise<Feature | undefined>,
  commit: (building: Feature | undefined) => void,
): Promise<void> {
  return resolution.then(
    (building) => {
      if (isCurrentStorefrontResolution(request, current())) commit(building);
    },
    () => {
      if (isCurrentStorefrontResolution(request, current())) commit(undefined);
    },
  );
}

function formatDenseTiming(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "pending";
}

function readCitywideBrowserMeasurement(): CitywideBrowserBaseline {
  if (typeof performance === "undefined") return EMPTY_CITYWIDE_BROWSER_BASELINE;
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory?.usedJSHeapSize;
  const resources = performance.getEntriesByType("resource").filter((entry): entry is PerformanceResourceTiming => entry.name.includes(`/data/${CITYWIDE_RELEASE_ID}/`));
  return {
    heapBytes: typeof memory === "number" && Number.isFinite(memory) ? memory : null,
    citywideResourceCount: resources.length,
    citywideResourceBytes: resources.reduce((sum, entry) => sum + Math.max(entry.transferSize || 0, entry.encodedBodySize || 0, entry.decodedBodySize || 0), 0),
  };
}

export function block835PerformanceProbeMode(search: string): Block835PerformanceProbeMode | null {
  const value = new URLSearchParams(search).get(BLOCK835_PERFORMANCE_PROBE_QUERY);
  return value === "stage3-only" || value === "stage3-plus-public-realm" ? value : null;
}

export function summarizeBlock835Frames(samples: readonly number[]): Block835FrameSummary {
  const sorted = samples.filter((value) => Number.isFinite(value) && value > 0).sort((left, right) => left - right);
  if (!sorted.length) return { sampleCount: 0, medianMs: null, p95Ms: null, maxMs: null };
  const middle = Math.floor(sorted.length / 2);
  const medianMs = sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle] ?? null;
  return {
    sampleCount: sorted.length,
    medianMs,
    p95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? null,
    maxMs: sorted.at(-1) ?? null,
  };
}

export function block835PerformanceGate(overlay: Pick<Block835FrameSummary, "medianMs" | "p95Ms">, control: Pick<Block835FrameSummary, "p95Ms"> | null) {
  const controlP95Ms = control?.p95Ms ?? null;
  const p95DeltaMs = overlay.p95Ms !== null && controlP95Ms !== null ? overlay.p95Ms - controlP95Ms : null;
  const p95Regression = p95DeltaMs !== null && controlP95Ms !== null && controlP95Ms > 0 ? p95DeltaMs / controlP95Ms : null;
  const overlayMedianPass = overlay.medianMs !== null && overlay.medianMs <= 12;
  const overlayP95Pass = overlay.p95Ms !== null && overlay.p95Ms <= 30;
  const p95RegressionPass = p95Regression !== null && p95Regression <= 0.2;
  return { p95DeltaMs, p95Regression, overlayMedianPass, overlayP95Pass, p95RegressionPass, pass: overlayMedianPass && overlayP95Pass && p95RegressionPass };
}

const BLOCK835_PERFORMANCE_CONTROL_STORAGE_KEY = "udt:block835-performance-control:v1";
const BLOCK835_PERFORMANCE_SESSION_STORAGE_KEY = "udt:block835-performance-session:v1";

function block835PerformanceSessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.sessionStorage.getItem(BLOCK835_PERFORMANCE_SESSION_STORAGE_KEY);
    if (existing) return existing;
    const created = globalThis.crypto?.randomUUID?.() ?? `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(BLOCK835_PERFORMANCE_SESSION_STORAGE_KEY, created);
    return created;
  } catch {
    return null;
  }
}

function storedBlock835PerformanceControl(): Block835PerformanceProbeResult | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(BLOCK835_PERFORMANCE_CONTROL_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Block835PerformanceProbeResult : null;
  } catch {
    return null;
  }
}

function storeBlock835PerformanceControl(control: Block835PerformanceProbeResult): void {
  try { window.sessionStorage.setItem(BLOCK835_PERFORMANCE_CONTROL_STORAGE_KEY, JSON.stringify(control)); } catch { /* the overlay run will report the missing same-session control */ }
}

function block835NetworkHosts(): string[] {
  if (typeof performance === "undefined" || typeof window === "undefined") return [];
  return [...new Set(performance.getEntriesByType("resource").flatMap((entry) => {
    try { return [new URL(entry.name, window.location.href).host]; } catch { return []; }
  }))].sort();
}

function compactConsoleArguments(values: readonly unknown[]): string {
  return values.map((value) => {
    if (typeof value === "string") return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  }).join(" ").slice(0, 500);
}

function startBlock835ConsoleAudit() {
  const consoleErrors: string[] = [];
  const windowErrors: string[] = [];
  const originalError = console.error;
  const patchedError = (...values: unknown[]) => {
    consoleErrors.push(compactConsoleArguments(values));
    originalError.apply(console, values);
  };
  const onError = (event: ErrorEvent) => windowErrors.push(event.message || "window error");
  const onUnhandledRejection = (event: PromiseRejectionEvent) => windowErrors.push(`unhandled rejection: ${String(event.reason)}`);
  console.error = patchedError;
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  return {
    consoleErrors,
    windowErrors,
    stop: () => {
      if (console.error === patchedError) console.error = originalError;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    },
  };
}

function nextAnimationFrame(): Promise<number> {
  return new Promise((resolve) => window.requestAnimationFrame(resolve));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function hasDisplayValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export interface SelectionFocusTransaction {
  focusFeatureId: string | null;
  shouldFly: boolean;
}

/** Every locatable selection path claims one focus request; locationless records claim none. */
export function selectionFocusTransaction(feature: Pick<Feature, "id" | "attributes">): SelectionFocusTransaction {
  const shouldFly = shouldFocusFeature(feature);
  return { focusFeatureId: shouldFly ? feature.id : null, shouldFly };
}

export interface OverlayLayoutPolicy {
  mapOwnsMainRegion: true;
  inspectorPosition: "overlay";
  desktopRightInset: "inspector-width" | "none";
  mobileBottomInset: "inspector-sheet" | "none";
  runtimeNoteLane: "left-control-lane";
  cameraControlsLane: "centered-control-lane";
}

/** Shared placement contract for persistent controls and the details surface. */
export function overlayLayoutPolicy(inspectorOpen: boolean, mobile: boolean): OverlayLayoutPolicy {
  return {
    mapOwnsMainRegion: true,
    inspectorPosition: "overlay",
    desktopRightInset: inspectorOpen && !mobile ? "inspector-width" : "none",
    mobileBottomInset: inspectorOpen && mobile ? "inspector-sheet" : "none",
    runtimeNoteLane: "left-control-lane",
    cameraControlsLane: "centered-control-lane",
  };
}

function navigationOverlayFields(exteriorRequested: boolean, selectedStorefrontId: string | null) {
  return exteriorRequested
    ? { exteriorReleaseId: EXTERIOR_PILOT_RELEASE_ID, commercial: true, storefrontId: selectedStorefrontId }
    : {};
}

/** Preserve the additive local Block 835 overlay across canonical navigation URL writes. */
export function appendBlock835PublicRealmUrl(baseUrl: string, requested: boolean, featureId: string | null): string {
  const url = new URL(baseUrl, typeof window === "undefined" ? "http://localhost/" : window.location.href);
  if (requested) url.searchParams.set("publicRealm", BLOCK835_PUBLIC_REALM_RELEASE_ID);
  else url.searchParams.delete("publicRealm");
  if (requested && featureId) url.searchParams.set("publicRealmFeature", featureId);
  else url.searchParams.delete("publicRealmFeature");
  return url.toString();
}

/**
 * This build pins an explicit allowlist of exterior-cell releases: the
 * synthetic, obviously named fixture package and the local Manhattan canary
 * packages. A deep link naming any other exterior release still fails closed
 * rather than resolving something that merely shares a shape.
 *
 * `manhattan-lower-manhattan-cells-20260812` — the T015 canary — is pinned but
 * NOT promoted, and stays that way. Pinning makes it reachable by an explicit
 * `?exteriorCells=` opt-in and nothing else, so an ordinary session never loads
 * it. Because it is not promoted, `verifyPromotedExteriorPin` does not run for
 * it: that check reads the promotion record, and this release has no entry
 * there. Its verification rests on the release-graph and checksum validation the
 * emitter and its committed inventory carry, which is a narrower guarantee.
 *
 * `manhattan-lower-manhattan-cells-20260812-p1` — the T016 successor — IS
 * promoted, and that is where ADR 0034's stated gap closes. It has an entry in
 * the promotion record, so both promotion gates run for it on every load. The
 * canary keeps its narrower guarantee because it is still only an opt-in; the
 * gap was never closed for the canary and this comment does not claim it was.
 *
 * `manhattan-southern-remainder-cells-20260812` — the T017 canary — is pinned on
 * exactly the same terms as the T015 one: opt-in reachable, absent from the
 * promotion record, verified by its release graph and its committed inventory
 * rather than by `verifyPromotedExteriorPin`. It could not be promoted here even
 * if that were in scope: the three promoted waves already occupy 255 of the
 * 256-entry exterior cache, which admits only the two cells of wave w03 that own
 * a single building each. Raising that cap is a promotion decision with its own
 * evidence, and this pin makes no part of it.
 *
 * `manhattan-southern-remainder-cells-20260812-p1` — the T018 successor — IS
 * promoted, on exactly the terms the T016 successor was: it has an entry in the
 * promotion record, so both promotion gates run for it on every load, while the
 * T017 canary above keeps its narrower guarantee because it is still only an
 * opt-in. The cache blocker quoted in the paragraph above was cleared rather
 * than worked around: ADR 0034's admissible response 1 was taken and
 * `EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries` is 512, which is what makes a
 * fourth promoted wave representable at all. That paragraph is left as it was
 * written because it was true of the build it described.
 *
 * `manhattan-central-upper-manhattan-cells-20260812` — the T019 canary — is
 * pinned on exactly the same terms as the T015 and T017 canaries: opt-in
 * reachable, absent from the promotion record, verified by its release graph and
 * its committed inventory rather than by `verifyPromotedExteriorPin`. Whether it
 * COULD be promoted is a different question from the one wave w03's canary faced,
 * and the answer is not simply "no": the four promoted waves occupy 434 of the
 * 512 entries, leaving 78, and this wave's median cell owns 48. What stops a
 * decision here is that wave w05 is unpromoted too and its median cell owns 55,
 * so the one 78-entry headroom admits an ordinary cell of either wave and not one
 * of each. That split belongs to promotion, and this pin makes no part of it.
 *
 * `manhattan-central-upper-manhattan-cells-20260812-p1` — the T020 successor —
 * IS promoted, on exactly the terms the T016 and T018 successors were: it has an
 * entry in the promotion record, so both promotion gates run for it on every
 * load, while the T019 canary above keeps its narrower guarantee because it is
 * still only an opt-in. The split the paragraph above declined to make WAS made,
 * and it was made without moving the cache cap: ADR 0036's response 2 was taken
 * and the 78 entries were divided 42 to this wave and 36 reserved for wave w05,
 * proportional to their canonical building counts. That paragraph is left as it
 * was written because it was true of the build it described.
 *
 * `manhattan-northern-manhattan-cells-20260812` — the T021 canary, materializing
 * the LAST wave the committed ledger declares — is pinned on exactly the same
 * terms as the T015, T017 and T019 canaries: opt-in reachable, absent from the
 * promotion record, verified by its release graph and its committed inventory
 * rather than by `verifyPromotedExteriorPin`. Being the last wave changes nothing
 * about that; it is not promoted for completeness' sake.
 *
 * Whether it COULD be promoted is a settled question rather than an open one, and
 * the answer is a number somebody else already chose: the split above reserved 36
 * entries for this wave, so T022's subset has 36 to spend and not the 38 that are
 * momentarily free. This wave's median cell owns 55, so the reservation does not
 * admit an ordinary cell of it and a promoted subset here has to be curated below
 * median size. None of that constrains this pin, because `?exteriorCells=` selects
 * this release ALONE and an opt-in session is budgeted against the whole cache.
 */
export const PINNED_EXTERIOR_CELL_RELEASE_IDS = ["udt-fixture-exterior-cells", "manhattan-exterior-cells-20260811", "manhattan-exterior-cells-20260811-v3", "manhattan-midtown-core-cells-20260811", "manhattan-midtown-core-cells-20260811-v3", "manhattan-lower-manhattan-cells-20260812", "manhattan-lower-manhattan-cells-20260812-p1", "manhattan-southern-remainder-cells-20260812", "manhattan-southern-remainder-cells-20260812-p1", "manhattan-central-upper-manhattan-cells-20260812", "manhattan-central-upper-manhattan-cells-20260812-p1", "manhattan-northern-manhattan-cells-20260812"] as const;

/**
 * The release used when neither a URL nor the promoted default names one: still
 * the synthetic fixture package. Since the Block 835 promotion, a session with
 * an active compatible real base resolves `EXTERIOR_DEFAULT_ACTIVATION` instead;
 * this fallback covers fixture-mode sessions, where it is only reachable through
 * an explicit opt-in because the promoted default stays quiet without a base.
 */
export const EXTERIOR_CELL_STREAMING_RELEASE_ID = PINNED_EXTERIOR_CELL_RELEASE_IDS[0];

export function isPinnedExteriorCellRelease(releaseId: string | null | undefined): boolean {
  return typeof releaseId === "string" && (PINNED_EXTERIOR_CELL_RELEASE_IDS as readonly string[]).includes(releaseId);
}

export function exteriorCellBasePath(releaseId: string): string {
  return `/data/${releaseId}/`;
}

export const EXTERIOR_CELL_STREAMING_BASE_PATH = exteriorCellBasePath(EXTERIOR_CELL_STREAMING_RELEASE_ID);

/** The one accepted value of the explicit-disable parameter. */
export const EXTERIOR_STREAMING_OFF_PARAM = "exteriorStreaming" as const;

/**
 * URL *intent*, not resolved state. `exteriorCells` keeps meaning "which pinned
 * release", and the distinct `exteriorStreaming=off` sentinel means "no exterior
 * wave at all". Absent parameters mean "no opinion", which the promotion record
 * resolves: default-on over an active real base, quiet in fixture mode.
 */
export interface ExteriorStreamingUrlState {
  override: ExteriorStreamingOverride;
  /** A pinned release id named by the URL, or `null` when the URL names none. */
  explicitReleaseId: string | null;
  profile: ExteriorRenderProfile;
  canarySnapshotId: string | null;
}

/** What a URL write needs: the intent plus the activation it resolved to. */
export interface ExteriorStreamingUrlWrite {
  override: ExteriorStreamingOverride;
  /** The release actually streaming, so an explicit link is never ambiguous. */
  releaseId: string;
  streaming: boolean;
  profile: ExteriorRenderProfile;
  canarySnapshotId: string | null;
}

/**
 * App-local URL wrapper chained after `navigationUrl`, exactly like the Block
 * 835 public-realm wrapper. The canonical navigation contract in
 * `domain/visitor-navigation` is deliberately untouched.
 *
 * Only explicit intent is serialized: a default-on session carries no
 * `exteriorCells`, so its links stay reproducible against whatever this build
 * promotes rather than freezing a release id into every shared URL. The render
 * profile follows the same rule — it is written for an explicit opt-in, and in a
 * default-on session only once the user has actually chosen a non-default
 * profile, so an untouched default-on session serializes no exterior parameter
 * at all while a chosen profile still survives sharing.
 */
export function appendExteriorProfileUrl(baseUrl: string, state: ExteriorStreamingUrlWrite): string {
  const url = new URL(baseUrl, typeof window === "undefined" ? "http://localhost/" : window.location.href);
  if (exteriorStreamingOverrideDisables(state.override)) {
    url.searchParams.set(EXTERIOR_STREAMING_OFF_PARAM, "off");
    url.searchParams.delete("exteriorCells");
    url.searchParams.delete("exteriorProfile");
    url.searchParams.delete("exteriorCanary");
    return url.toString();
  }
  url.searchParams.delete(EXTERIOR_STREAMING_OFF_PARAM);
  if (state.override === "on") url.searchParams.set("exteriorCells", state.releaseId);
  else url.searchParams.delete("exteriorCells");
  if (state.streaming && (state.override === "on" || state.profile !== DEFAULT_EXTERIOR_RENDER_PROFILE)) url.searchParams.set("exteriorProfile", state.profile);
  else url.searchParams.delete("exteriorProfile");
  if (state.override === "on" && state.canarySnapshotId) url.searchParams.set("exteriorCanary", state.canarySnapshotId);
  else url.searchParams.delete("exteriorCanary");
  return url.toString();
}

export function parseExteriorStreamingUrl(href: string): ExteriorStreamingUrlState {
  const url = new URL(href, typeof window === "undefined" ? "http://localhost/" : window.location.href);
  // An explicit disable outranks every other exterior parameter: a link that
  // says "off" must never resolve to a wave because it also carries a release.
  const requestedRelease = url.searchParams.get("exteriorCells");
  // A URL that names a release this build does not pin fails closed to "off",
  // never to the promoted default: asking for an unknown release must not be
  // answered with a different one.
  const switchedOff = url.searchParams.get(EXTERIOR_STREAMING_OFF_PARAM) === "off";
  const unpinnedRelease = !switchedOff && requestedRelease !== null && !isPinnedExteriorCellRelease(requestedRelease);
  const disabled = switchedOff || unpinnedRelease;
  const explicitReleaseId = !disabled && isPinnedExteriorCellRelease(requestedRelease) ? requestedRelease : null;
  // The two kinds of "off" stay distinct all the way to the details panel: a
  // typo is a link this build could not honour, not a session anyone disabled.
  const override: ExteriorStreamingOverride = unpinnedRelease ? "off-unpinned" : switchedOff ? "off" : explicitReleaseId !== null ? "on" : null;
  const canary = override === "on" ? url.searchParams.get("exteriorCanary") : null;
  return {
    override,
    explicitReleaseId,
    profile: (disabled ? null : parseExteriorRenderProfile(url.searchParams.get("exteriorProfile"))) ?? DEFAULT_EXTERIOR_RENDER_PROFILE,
    canarySnapshotId: canary && canary.trim().length > 0 ? canary : null,
  };
}

export interface ExteriorStreamingActivationInput {
  requested: boolean;
  /** The pinned release actually being streamed; defaults to the default pin. */
  releaseId?: string;
  loadState: "idle" | "loading" | "ready" | "failed";
  hasVerifiedRuntime: boolean;
  activeBaseReleaseId: string | null;
  compatibleWithActiveBase: boolean;
}

export interface ExteriorStreamingActivation {
  active: boolean;
  prerequisiteMessage: string | null;
}

/**
 * Exterior cells reuse base building identities, so they can only activate on
 * top of a live, compatible base release. An index alone cannot activate itself.
 */
export function exteriorStreamingActivation(input: ExteriorStreamingActivationInput): ExteriorStreamingActivation {
  if (!input.requested || input.loadState !== "ready" || !input.hasVerifiedRuntime) return { active: false, prerequisiteMessage: null };
  if (input.activeBaseReleaseId && input.compatibleWithActiveBase) return { active: true, prerequisiteMessage: null };
  return {
    active: false,
    prerequisiteMessage: `Exterior streaming release ${input.releaseId ?? EXTERIOR_CELL_STREAMING_RELEASE_ID} was verified locally but was not activated: it requires an active base release its index declares compatible.`,
  };
}

export function exteriorStreamingFailureMessage(error: unknown): string {
  const prefix = error instanceof Error ? error.message : "Exterior streaming failed closed.";
  return `${prefix} Exterior streaming was disabled; the existing base/exterior state was left unchanged.`;
}

/**
 * Everything one promoted exterior wave owns. Waves are held per release id so
 * that verification, failure, notices, and provenance stay attributed to the
 * release they came from — and so a second wave cannot inherit the first one's
 * acceptance evidence.
 */
export interface ExteriorWaveState {
  runtime: ExteriorCellRuntime | null;
  loadState: "idle" | "loading" | "ready" | "failed";
  message: string;
  headNotice: string | null;
}

/** A wave plus the cell outcomes it has resolved so far. */
export interface ExteriorWaveView extends ExteriorWaveState {
  outcomes: readonly ExteriorCellOutcome[];
}

export const IDLE_EXTERIOR_WAVE: ExteriorWaveState = { runtime: null, loadState: "idle", message: "", headNotice: null };
const NO_EXTERIOR_OUTCOMES: readonly ExteriorCellOutcome[] = [];
const LOADING_EXTERIOR_WAVE: ExteriorWaveState = { ...IDLE_EXTERIOR_WAVE, loadState: "loading", message: "Exterior streaming is loading from the local release…" };

/** A wave that failed closed renders nothing and keeps its own failure words. */
function failedExteriorWave(message: string): ExteriorWaveState {
  return { ...IDLE_EXTERIOR_WAVE, loadState: "failed", message };
}

/**
 * One user-visible line per cell that did not render its pinned head
 * representation, plus one for verified geometry withheld for want of a base
 * anchor. Nothing is ever withheld silently.
 *
 * Bounded-availability exception: a release may deliberately ship a large
 * number of cells with no exterior geometry (see ADR 0029). Those carry the
 * runtime's `not-shipped` outcome, which is not a failure, and they are
 * summarized in a single truthful line instead of one alarming bullet each — a
 * 149-cell wave would otherwise emit ~146 identical rows claiming verification
 * failures that never happened. Every genuine failure keeps its own per-cell
 * line, so nothing that actually went wrong is aggregated away.
 */
export function exteriorStreamingNotices(
  headNotice: string | null,
  cells: readonly ExteriorCellOutcome[],
  unanchoredCanonicalFeatureIds: readonly string[] = [],
): string[] {
  const notices = headNotice ? [headNotice] : [];
  for (const cell of cells) {
    if (cell.kind === "rendered") { if (cell.notice) notices.push(cell.notice); continue; }
    if (cell.kind === "not-shipped") continue;
    notices.push(cell.notice);
  }
  const notShipped = exteriorNotShippedSummary(cells);
  if (notShipped) notices.push(notShipped);
  const unanchored = exteriorUnanchoredNotice(unanchoredCanonicalFeatureIds);
  if (unanchored) notices.push(unanchored);
  return notices;
}

/**
 * Deep links degrade loudly. An `exteriorCells` value this build does not pin,
 * one naming a release this build rolled back, or an unsupported
 * `exteriorProfile`, produces the same kind of explicit notice every other
 * release/mode mismatch in the app produces.
 */
export function exteriorDeepLinkMessage(href: string, records: ExteriorDefaultActivationRecords = EXTERIOR_DEFAULT_ACTIVATION): string | null {
  const url = new URL(href, typeof window === "undefined" ? "http://localhost/" : window.location.href);
  const requestedRelease = url.searchParams.get("exteriorCells");
  if (requestedRelease !== null && !isPinnedExteriorCellRelease(requestedRelease)) {
    return `Exterior streaming release ${requestedRelease} is not pinned by this build; exterior streaming stayed off and the rest of the view was left unchanged. The pinned exterior-cell releases here are ${PINNED_EXTERIOR_CELL_RELEASE_IDS.join(", ")}.`;
  }
  // A withdrawn release stays in the pinned allowlist (its bytes are still on
  // disk), so the refusal has to be stated here rather than inferred from the
  // allowlist.
  // Checked against the WHOLE promoted set: a link into a wave this build
  // withdrew must be refused by that wave's record, not silently accepted
  // because a different wave is still promoted.
  const rolledBack = exteriorRolledBackReleaseNotice(requestedRelease, records);
  if (rolledBack) return `${rolledBack} The rest of the view was left unchanged.`;
  const requestedStreaming = url.searchParams.get(EXTERIOR_STREAMING_OFF_PARAM);
  if (requestedStreaming !== null && requestedStreaming !== "off") {
    return `Exterior streaming parameter ${EXTERIOR_STREAMING_OFF_PARAM}=${requestedStreaming} is not supported; only ${EXTERIOR_STREAMING_OFF_PARAM}=off disables the exterior wave, so this link resolved the build default instead.`;
  }
  const requestedProfile = url.searchParams.get("exteriorProfile");
  if (requestedStreaming !== "off" && requestedProfile !== null && parseExteriorRenderProfile(requestedProfile) === null) {
    return `Exterior render profile ${requestedProfile} is not supported; the ${DEFAULT_EXTERIOR_RENDER_PROFILE} profile was used instead.`;
  }
  return null;
}

/**
 * A canary snapshot can only be resolved against the heads the loaded release
 * actually publishes. `manhattan-exterior-cells-20260811` ships an empty
 * `canaryHeads`, so any `exteriorCanary` deep link into it is unresolvable and
 * must say so rather than silently falling back to the default head.
 */
export function exteriorCanarySnapshotMessage(releaseId: string, snapshotId: string, availableCanarySnapshotIds: readonly string[]): string | null {
  if (availableCanarySnapshotIds.includes(snapshotId)) return null;
  return availableCanarySnapshotIds.length === 0
    ? `Exterior canary snapshot ${snapshotId} is not available: release ${releaseId} publishes no canary heads. The default pinned snapshot was used instead.`
    : `Exterior canary snapshot ${snapshotId} is not published by release ${releaseId}; the default pinned snapshot was used instead. Available canary snapshots are ${availableCanarySnapshotIds.join(", ")}.`;
}

/**
 * Optional deterministic-membership surface. An adapter that can prove release
 * membership without streaming exposes these; anything else falls back to
 * resident lookup, which is correct for fully-resident adapters such as the
 * fixture.
 */
interface ExteriorBaseIdentityAdapter {
  getFeature(featureId: string): unknown;
  ensureIdentityIndex?: (signal?: AbortSignal) => Promise<number>;
  hasIdentityMember?: (featureId: string) => boolean;
}

export async function ensureExteriorBaseIdentity(adapter: ExteriorBaseIdentityAdapter, signal?: AbortSignal): Promise<void> {
  if (typeof adapter.ensureIdentityIndex !== "function") return;
  await adapter.ensureIdentityIndex(signal);
}

export function exteriorBaseIdentityHas(adapter: ExteriorBaseIdentityAdapter, featureId: string): boolean {
  if (typeof adapter.hasIdentityMember === "function") return adapter.hasIdentityMember(featureId);
  const resident = adapter.getFeature(featureId);
  return resident !== undefined && resident !== null;
}

export function exteriorSnapshotOriginLabel(origin: "default" | "canary", snapshotId: string): string {
  return origin === "canary" ? `Canary snapshot ${snapshotId} (explicitly selected)` : `Default pinned snapshot ${snapshotId}`;
}

export interface Block835PublicRealmActivationInput {
  requested: boolean;
  loadState: "idle" | "loading" | "ready" | "failed";
  hasVerifiedOverlay: boolean;
  activeBaseReleaseId: string | null;
  exteriorActive: boolean;
  compatibleWithActiveBase: boolean;
}

export interface Block835PublicRealmActivation {
  active: boolean;
  prerequisiteMessage: string | null;
}

/**
 * The public-realm manifest may describe compatible releases, but it cannot
 * activate itself. It is an additive Stage 3 child that needs both a live
 * compatible real base and the already-validated exterior/commercial overlay.
 */
export function block835PublicRealmActivation(input: Block835PublicRealmActivationInput): Block835PublicRealmActivation {
  if (!input.requested || input.loadState !== "ready" || !input.hasVerifiedOverlay) return { active: false, prerequisiteMessage: null };
  if (input.activeBaseReleaseId && input.compatibleWithActiveBase && input.exteriorActive) return { active: true, prerequisiteMessage: null };
  return {
    active: false,
    prerequisiteMessage: `Block 835 public realm was verified locally but was not activated: it requires an active compatible real base and the active Stage 3 exterior/commercial overlay (${EXTERIOR_PILOT_RELEASE_ID}).`,
  };
}

/** Do not imply Stage 3 is active when a public-realm request fails in isolation. */
export function block835PublicRealmFailureMessage(error: unknown): string {
  const prefix = error instanceof Error ? error.message : "Block 835 public-realm overlay failed closed.";
  return `${prefix} The public-realm overlay was disabled; the existing base/exterior state was left unchanged.`;
}

function civicDetailValue(feature: Feature | undefined, key: string): string {
  const value = feature?.attributes[key];
  if (!hasDisplayValue(value)) return "Unknown / not provided";
  if (typeof value !== "string") return String(value);
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.length > 0 ? parsed.map(String).join(" · ") : "Unknown / not provided";
  } catch { /* scalar source values remain strings */ }
  return value;
}

function overlapKind(feature: Feature): TravelContextRecordKind {
  if (feature.kind === "building") return "building";
  if (feature.kind === "poi") return "restaurant";
  if (feature.kind === "park") return "park";
  if (feature.kind === "landmark") return "landmark-record";
  if (feature.kind === "area" && (feature.attributes.areaSemantics === "statistical-area" || feature.attributes.areaSemantics === "statistical")) return "statistical-area";
  return "building";
}

function toCityFeature(feature: Feature) {
  const fixture = feature.sourceRefs.some((source) => source.registryEntryId.startsWith("fixture."));
  const civic = feature.attributes.civicReleaseId === TRAVEL_CONTEXT_RELEASE_ID;
  const citywide = feature.attributes.citywideReleaseId === CITYWIDE_RELEASE_ID;
  return projectFeatureToCityFeature(feature, "Manhattan, New York", fixture ? fixtureIngestionSummary : civic ? {
    manifestVersion: "2.0",
    manifestId: TRAVEL_CONTEXT_RELEASE_ID,
    fixtureOnly: false,
    acceptedCount: 1,
    rejectedCount: 0,
    rejectionReport: "Civic source accounting is zero remainder/collisions; parent grouping and source observations remain reversible in the local release.",
  } : citywide ? {
    manifestVersion: "1.0",
    manifestId: CITYWIDE_RELEASE_ID,
    fixtureOnly: false,
    acceptedCount: 57_633,
    rejectedCount: 0,
    rejectionReport: "Citywide source accounting is snapshot-relative; procedural footprint/height massing carries source height where present and explicit unknown height otherwise.",
  } : {
    manifestVersion: "1.0",
    manifestId: "real-wave-20260804",
    fixtureOnly: false,
    acceptedCount: 0,
    rejectedCount: 0,
    rejectionReport: "No records rejected by the bounded real-data adapter.",
  });
}

export function App() {
  const initialNavigation = typeof window === "undefined" ? { featureId: null, query: "", cameraMode: "overview" as CameraMode, pose: null, poseInvalid: false } : parseNavigationUrl(window.location.href);
  const initialPublicRealmRequested = typeof window !== "undefined" && new URL(window.location.href).searchParams.get("publicRealm") === BLOCK835_PUBLIC_REALM_RELEASE_ID;
  const initialPublicRealmFeatureId = typeof window !== "undefined" ? new URL(window.location.href).searchParams.get("publicRealmFeature") : null;
  const initialExteriorStreaming: ExteriorStreamingUrlState = typeof window === "undefined"
    ? { override: null, explicitReleaseId: null, profile: DEFAULT_EXTERIOR_RENDER_PROFILE, canarySnapshotId: null }
    : parseExteriorStreamingUrl(window.location.href);
  const stage3RenderProofRequested = import.meta.env.DEV && typeof window !== "undefined" && new URL(window.location.href).searchParams.get("stage3Proof") === "storefront-picks";
  const block835PerformanceMode = import.meta.env.DEV && typeof window !== "undefined" ? block835PerformanceProbeMode(window.location.search) : null;
  // Separate condition axis from the Stage 3 probe above. The Stage 3 probe
  // refuses a scene that streams exterior cells, because certifying it against
  // a Stage-3-only control sample would compare two different scenes. The
  // canary probe is the inverse: it *requires* the exterior-cell release to be
  // active and measures the Goal's absolute budgets instead of a regression.
  const block835CanaryMode = BLOCK835_CANARY_HARNESS_ENABLED && typeof window !== "undefined" ? parseBlock835CanaryProbeMode(window.location.search) : null;
  // Which promoted wave the probe measures, and the camera path it drives.
  // Defaults to the Block 835 target so every T009-era probe URL still means
  // exactly what it meant.
  const exteriorCanaryProbeTarget = exteriorCanaryTarget(
    BLOCK835_CANARY_HARNESS_ENABLED && typeof window !== "undefined" ? window.location.search : "",
    MIDTOWN_CORE_CANARY_FACADE_PATH,
  );
  // A URL cannot activate the real adapter until its immutable release has
  // loaded and passed validation. Start every first render in fixtures so an
  // unknown/loading release never wears a real label over fixture geometry.
  const initialRealRequest = initialNavigation.dataMode === "real-pilot" || initialNavigation.dataMode === "civic-context";
  const initialCitywideRequest = initialNavigation.releaseId === CITYWIDE_RELEASE_ID;
  const initialCivicRequest = initialNavigation.releaseId === TRAVEL_CONTEXT_RELEASE_ID || initialNavigation.dataMode === "civic-context";
  const initialExteriorRequest = initialNavigation.exteriorReleaseId === EXTERIOR_PILOT_RELEASE_ID && initialNavigation.commercial === true;
  const initialDataMode: NavigationDataMode = "fixtures";
  const initialReleaseId = null;
  const fixtureFeatureIds = useMemo(() => new Set(fixtureAdapter.getFeatures().map((feature) => feature.id)), []);
  const [activeAdapter, setActiveAdapter] = useState<RuntimeCityAdapter>(fixtureAdapter);
  const [realAdapter, setRealAdapter] = useState<RuntimeCityAdapter | null>(null);
  const [dataMode, setDataMode] = useState<NavigationDataMode>(initialDataMode);
  const [realLoadState, setRealLoadState] = useState<"loading" | "ready" | "failed">("loading");
  const [citywideAdapter, setCitywideAdapter] = useState<CitywideReleaseAdapter | null>(null);
  const [citywideLoadState, setCitywideLoadState] = useState<"loading" | "ready" | "failed">("loading");
  const [citywideFeatures, setCitywideFeatures] = useState<Feature[]>([]);
  const [citywideMetrics, setCitywideMetrics] = useState<CitywideRuntimeMetrics>(EMPTY_CITYWIDE_METRICS);
  const [citywideDenseMetrics, setCitywideDenseMetrics] = useState<DenseRenderMetrics>(EMPTY_CITYWIDE_DENSE_METRICS);
  const [citywideBrowserBaseline, setCitywideBrowserBaseline] = useState<CitywideBrowserBaseline>(() => initialRealRequest && typeof window !== "undefined" ? readCitywideBrowserMeasurement() : EMPTY_CITYWIDE_BROWSER_BASELINE);
  const [citywideDebugMeasurement, setCitywideDebugMeasurement] = useState<CitywideDebugMeasurement>(EMPTY_CITYWIDE_DEBUG_MEASUREMENT);
  const [citywideSearchResults, setCitywideSearchResults] = useState<UnifiedSearchResult[]>([]);
  const [civicAdapter, setCivicAdapter] = useState<TravelContextReleaseAdapter | null>(null);
  const [civicLoadState, setCivicLoadState] = useState<"loading" | "ready" | "failed">("loading");
  const [civicFeatures, setCivicFeatures] = useState<Feature[]>([]);
  const [civicSearchResults, setCivicSearchResults] = useState<UnifiedSearchResult[]>([]);
  const [composedAdapter, setComposedAdapter] = useState<ComposedReleaseAdapter | null>(null);
  const [compositionLoadState, setCompositionLoadState] = useState<"loading" | "ready" | "failed">("loading");
  const [composedMetrics, setComposedMetrics] = useState<ComposedReleaseMetrics>(EMPTY_COMPOSED_METRICS);
  const [exteriorRequested, setExteriorRequested] = useState(initialExteriorRequest);
  const [exteriorOverlay, setExteriorOverlay] = useState<LoadedExteriorPilotRelease | null>(null);
  const [exteriorLoadState, setExteriorLoadState] = useState<"idle" | "loading" | "ready" | "failed">(initialExteriorRequest ? "loading" : "idle");
  const [exteriorMessage, setExteriorMessage] = useState(initialExteriorRequest ? "Exterior/commercial overlay is loading from the local release…" : "");
  const [publicRealmRequested, setPublicRealmRequested] = useState(initialPublicRealmRequested);
  const [publicRealmOverlay, setPublicRealmOverlay] = useState<LoadedBlock835PublicRealmRelease | null>(null);
  const [publicRealmLoadState, setPublicRealmLoadState] = useState<"idle" | "loading" | "ready" | "failed">(initialPublicRealmRequested ? "loading" : "idle");
  const [publicRealmMessage, setPublicRealmMessage] = useState(initialPublicRealmRequested ? "Block 835 public-realm overlay is loading from the local release…" : "");
  const [selectedPublicRealmId, setSelectedPublicRealmId] = useState<string | null>(initialPublicRealmFeatureId);
  // Explicit URL/toggle intent only. Whether streaming actually runs, and which
  // release it targets, is resolved from this plus the promotion record and the
  // live base release, so a promoted default cannot be half-applied.
  const [exteriorStreamingOverride, setExteriorStreamingOverride] = useState<ExteriorStreamingOverride>(initialExteriorStreaming.override);
  // The pinned release a deep link or a toggle named. A session with no explicit
  // release follows whatever this build promotes.
  const [exteriorExplicitReleaseId, setExteriorExplicitReleaseId] = useState<string | null>(initialExteriorStreaming.explicitReleaseId);
  const [exteriorProfile, setExteriorProfile] = useState<ExteriorRenderProfile>(initialExteriorStreaming.profile);
  const [exteriorCanarySnapshotId, setExteriorCanarySnapshotId] = useState<string | null>(initialExteriorStreaming.canarySnapshotId);
  // One entry per promoted exterior release. A wave failing closed clears its
  // own entry and leaves every other wave exactly as it was, so one bad release
  // can never withdraw a good one.
  const [exteriorWaves, setExteriorWaves] = useState<ReadonlyMap<string, ExteriorWaveState>>(() => (
    initialExteriorStreaming.override === "on"
      ? new Map([[initialExteriorStreaming.explicitReleaseId ?? EXTERIOR_CELL_STREAMING_RELEASE_ID, LOADING_EXTERIOR_WAVE]])
      : new Map()
  ));
  // Cell outcomes live beside the waves, not inside them: publishing an outcome
  // must not change the identity the load effect watches, or resolving cells
  // would restart the very load that produced them.
  const [exteriorWaveOutcomes, setExteriorWaveOutcomes] = useState<ReadonlyMap<string, readonly ExteriorCellOutcome[]>>(() => new Map());
  const [exteriorUnanchoredIds, setExteriorUnanchoredIds] = useState<string[]>([]);
  // Kept separate from `deepLinkMessage`, which the first selection clears.
  const [exteriorDeepLinkNotice, setExteriorDeepLinkNotice] = useState<string | null>(
    typeof window === "undefined" ? null : exteriorDeepLinkMessage(window.location.href, exteriorDefaultActivations(EXTERIOR_DEFAULT_ACTIVATION)),
  );
  const [stage3RenderProof, setStage3RenderProof] = useState<Stage3RenderProof | null>(null);
  const [block835PerformanceProbe, setBlock835PerformanceProbe] = useState<Block835PerformanceProbeResult | null>(null);
  const [block835CanaryProbe, setBlock835CanaryProbe] = useState<Block835CanaryProbeResult | null>(null);
  const [, setRealFallbackActive] = useState(initialRealRequest);
  const [realDataMessage, setRealDataMessage] = useState("Real pilot artifact not loaded; fixture fallback is active.");
  const [landmarkAssetMessage, setLandmarkAssetMessage] = useState("Landmark GLB package not loaded; procedural fallback is active.");
  const initialSelectionId = !initialRealRequest && initialNavigation.featureId && fixtureFeatureIds.has(initialNavigation.featureId) ? initialNavigation.featureId : null;
  const [activeNavigation, setActiveNavigation] = useState("Explore");
  const [inspectorOpen, setInspectorOpen] = useState(!initialRealRequest);
  const [focusRequest, setFocusRequest] = useState(0);
  const [focusFeatureId, setFocusFeatureId] = useState<string | null>(initialRealRequest ? null : runtimeMarker.id);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const [deepLinkMessage, setDeepLinkMessage] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [selectedFeature, setSelectedFeature] = useState(runtimeMarker);
  const [activeSelectionId, setActiveSelectionId] = useState<string | null>(initialSelectionId);
  const [selectedStorefrontId, setSelectedStorefrontId] = useState<string | null>(initialNavigation.storefrontId ?? null);
  const [overlapFeatures, setOverlapFeatures] = useState<Feature[]>([]);
  const [selectedCatalogEntityId, setSelectedCatalogEntityId] = useState<string | null>(null);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [directionsOpen, setDirectionsOpen] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<PlaceCategory[]>(initialNavigation.facets?.filter((value): value is PlaceCategory => PLACE_CATEGORIES.includes(value as PlaceCategory)) ?? []);
  const [selectedCivicFacets, setSelectedCivicFacets] = useState<CivicFacet[]>(initialNavigation.facets?.filter((value): value is CivicFacet => (CIVIC_FACETS as readonly string[]).includes(value)) ?? []);
  const [layerVisibility, setLayerVisibility] = useState<LayerVisibility>(() => {
    if (!initialNavigation.visibleLayers) return DEFAULT_LAYER_VISIBILITY;
    const requested = new Set(initialNavigation.visibleLayers);
    return Object.fromEntries((Object.keys(DEFAULT_LAYER_VISIBILITY) as RuntimeLayerId[]).map((layer) => [layer, requested.has(layer)])) as LayerVisibility;
  });
  const [routeAdapter, setRouteAdapter] = useState<RouteGraphSnapshotAdapter | null>(null);
  const [routeOriginId, setRouteOriginId] = useState<string | null>(null);
  const [routeDestinationId, setRouteDestinationId] = useState<string | null>(null);
  const [routeOriginQuery, setRouteOriginQuery] = useState("");
  const [routeDestinationQuery, setRouteDestinationQuery] = useState("");
  const [routeMode, setRouteMode] = useState<TravelMode>("walking");
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [routeMessage, setRouteMessage] = useState("");
  const [previewRequest, setPreviewRequest] = useState<{ action: "start" | "pause" | "stop" | "previous" | "next" | "focus"; requestId: number } | undefined>();
  const [previewStep, setPreviewStep] = useState(0);
  const [cameraMode, setCameraMode] = useState<CameraMode>(initialNavigation.cameraMode);
  const [cameraPose, setCameraPose] = useState<CameraPose>(initialNavigation.pose ?? DEFAULT_CAMERA_POSE);
  const [viewportFootprint, setViewportFootprint] = useState<ViewportFootprint>(() => fallbackViewportFootprint(initialNavigation.pose ?? DEFAULT_CAMERA_POSE));
  const [cameraRequest, setCameraRequest] = useState<CameraPose & { requestId: number }>({ ...(initialNavigation.pose ?? DEFAULT_CAMERA_POSE), requestId: 1 });
  const [poseInvalid, setPoseInvalid] = useState(initialNavigation.poseInvalid);
  const [savedNavigation, setSavedNavigation] = useState<SavedNavigationState>(() => typeof window === "undefined" ? { schemaVersion: VISITOR_NAVIGATION_SCHEMA_VERSION, places: [], journeys: [] } : loadSavedNavigation(window.localStorage, fixtureFeatureIds));
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stressMode, setStressMode] = useState(false);
  const [stressCameraRequest, setStressCameraRequest] = useState<{ longitude: number; latitude: number; distanceMeters: number; requestId: number } | undefined>();
  const [stressFeatures, setStressFeatures] = useState<Feature[]>([]);
  const [tileMetrics, setTileMetrics] = useState<TileStreamMetrics>({ generation: 0, selectedLod: null, visibleTileCount: 0, requestedTileCount: 0, loadedTileCount: 0, evictedTileCount: 0, failedTileCount: 0, loadedBytes: 0, activeRequests: 0, maxConcurrentRequests: 0, deduplicatedRequests: 0, cancelledRequestCount: 0, staleResultCount: 0, renderedFeatureCount: 0 });
  const stressStreamRef = useRef<RuntimeTileStream<SyntheticTileContent> | null>(null);
  const stressCameraRef = useRef<TileCameraState>({ longitude: -73.991, latitude: 40.744, distanceMeters: 4_000 });
  const stressCameraIntentRef = useRef<{ camera: TileCameraState; expiresAt: number } | null>(null);
  const queryRef = useRef(query);
  const cameraPoseRef = useRef(cameraPose);
  const viewportFootprintRef = useRef(viewportFootprint);
  const cameraModeRef = useRef(cameraMode);
  const activeSelectionRef = useRef(activeSelectionId);
  const activeAdapterRef = useRef<RuntimeCityAdapter>(activeAdapter);
  const storefrontResolutionRequestRef = useRef(0);
  const layerVisibilityRef = useRef(layerVisibility);
  const selectedCategoriesRef = useRef(selectedCategories);
  const selectedCivicFacetsRef = useRef(selectedCivicFacets);
  const citywideAdapterRef = useRef<CitywideReleaseAdapter | null>(citywideAdapter);
  const composedAdapterRef = useRef<ComposedReleaseAdapter | null>(composedAdapter);
  const composedMetricsRef = useRef<ComposedReleaseMetrics>(composedMetrics);
  const exteriorRequestedRef = useRef(exteriorRequested);
  const selectedStorefrontIdRef = useRef(selectedStorefrontId);
  const publicRealmRequestedRef = useRef(publicRealmRequested);
  const selectedPublicRealmIdRef = useRef(selectedPublicRealmId);
  const exteriorStreamingRequestedRef = useRef(false);
  const exteriorStreamingOverrideRef = useRef(exteriorStreamingOverride);
  const exteriorExplicitReleaseIdRef = useRef(exteriorExplicitReleaseId);
  const exteriorCellReleaseIdRef = useRef<string>(EXTERIOR_CELL_STREAMING_RELEASE_ID);
  const exteriorProfileRef = useRef(exteriorProfile);
  const exteriorCanarySnapshotIdRef = useRef(exteriorCanarySnapshotId);
  const aggregateBudgetRef = useRef(new AggregateRequestBudget());
  // ONE exterior cache for every promoted wave. The declared exterior ceiling is
  // 256 entries / 256 MiB for exterior streaming as a whole, so waves share this
  // budget instead of each constructing its own and multiplying the ceiling by
  // the number of promotions. Entries are keyed by artifact ref AND checksum, so
  // sharing can only ever reuse identical verified bytes.
  const exteriorCellLoadsRef = useRef(new Map<string, { runtime: ExteriorCellRuntime; profile: ExteriorRenderProfile; bucket: number; controller: AbortController }>());
  const exteriorCacheRef = useRef<CitywideLruCache<Uint8Array>>(new CitywideLruCache<Uint8Array>(EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries, EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes));
  const aggregateCacheRef = useRef<CitywideLruCache<unknown>>(new CitywideLruCache<unknown>(CITYWIDE_BUDGETS.maxLoadedShards, CITYWIDE_BUDGETS.maxLoadedBytes));
  const citywideModeRef = useRef(false);
  const civicModeRef = useRef(false);
  const dataModeRef = useRef(dataMode);
  const releaseIdRef = useRef<string | null>(initialReleaseId);
  // Cesium can report its initial camera before the URL hydration effect has
  // activated a requested release. Preserve that request until the pinned
  // adapter is ready instead of replacing it with the fixture mode.
  const initialRealNavigationPendingRef = useRef(initialRealRequest);
  const pendingNavigationPoseRef = useRef<CameraPose | null>(initialRealRequest ? initialNavigation.pose : null);
  const terminalRealFallbackNoticeRef = useRef<string | null>(null);
  const citywideDebugMeasurementRunRef = useRef(0);
  const block835PerformanceProbeRunRef = useRef(0);
  const block835CanaryProbeRunRef = useRef(0);
  const detailsHeadingRef = useRef<HTMLHeadingElement>(null);
  const detailsReturnRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  queryRef.current = query;
  cameraPoseRef.current = cameraPose;
  viewportFootprintRef.current = viewportFootprint;
  cameraModeRef.current = cameraMode;
  activeSelectionRef.current = activeSelectionId;
  activeAdapterRef.current = activeAdapter;
  layerVisibilityRef.current = layerVisibility;
  selectedCategoriesRef.current = selectedCategories;
  selectedCivicFacetsRef.current = selectedCivicFacets;
  dataModeRef.current = dataMode;
  citywideAdapterRef.current = citywideAdapter;
  composedAdapterRef.current = composedAdapter;
  composedMetricsRef.current = composedMetrics;
  exteriorRequestedRef.current = exteriorRequested;
  selectedStorefrontIdRef.current = selectedStorefrontId;
  publicRealmRequestedRef.current = publicRealmRequested;
  selectedPublicRealmIdRef.current = selectedPublicRealmId;
  exteriorStreamingOverrideRef.current = exteriorStreamingOverride;
  exteriorExplicitReleaseIdRef.current = exteriorExplicitReleaseId;
  exteriorProfileRef.current = exteriorProfile;
  exteriorCanarySnapshotIdRef.current = exteriorCanarySnapshotId;
  const getOverlayUrlFields = useCallback(() => navigationOverlayFields(exteriorRequestedRef.current, selectedStorefrontIdRef.current), []);
  const navigationUrlForApp = useCallback((value: Parameters<typeof navigationUrl>[0], base: string) => appendExteriorProfileUrl(
    appendBlock835PublicRealmUrl(navigationUrl(value, base), publicRealmRequestedRef.current, selectedPublicRealmIdRef.current),
    { override: exteriorStreamingOverrideRef.current, releaseId: exteriorCellReleaseIdRef.current, streaming: exteriorStreamingRequestedRef.current, profile: exteriorProfileRef.current, canarySnapshotId: exteriorCanarySnapshotIdRef.current },
  ), []);
  const updateSelectedStorefront = useCallback((storefrontId: string | null) => {
    selectedStorefrontIdRef.current = storefrontId;
    setSelectedStorefrontId(storefrontId);
  }, []);
  const citywideMode = dataMode === "real-pilot" && activeAdapter === citywideAdapter && citywideAdapter !== null;
  const civicMode = dataMode === "civic-context" && activeAdapter === composedAdapter && composedAdapter !== null;
  const exteriorActive = Boolean(exteriorOverlay && exteriorLoadState === "ready" && (citywideMode || civicMode) && exteriorOverlay.compatibleWith(CITYWIDE_RELEASE_ID));
  const activeRealBaseReleaseId = citywideMode ? CITYWIDE_RELEASE_ID : civicMode ? TRAVEL_CONTEXT_RELEASE_ID : null;
  const publicRealmActivation = block835PublicRealmActivation({
    requested: publicRealmRequested,
    loadState: publicRealmLoadState,
    hasVerifiedOverlay: publicRealmOverlay !== null,
    activeBaseReleaseId: activeRealBaseReleaseId,
    exteriorActive,
    compatibleWithActiveBase: Boolean(publicRealmOverlay && activeRealBaseReleaseId && publicRealmOverlay.compatibleWith(activeRealBaseReleaseId)),
  });
  const publicRealmActive = publicRealmActivation.active;
  const publicRealmStatusMessage = publicRealmActivation.prerequisiteMessage ?? publicRealmMessage;
  const activeRealBaseReleaseIdRef = useRef(activeRealBaseReleaseId);
  activeRealBaseReleaseIdRef.current = activeRealBaseReleaseId;
  // The promotion gate, run over the whole promoted set. `exteriorStreamingRequested`
  // is no longer URL-only state: with a wave promoted, an active compatible real
  // base is itself the request, and a fixture-mode session resolves to quiet.
  // The records are read per render, not captured once, so a build that swaps a
  // record resolves the record it actually exports.
  const exteriorActivationRecords = exteriorDefaultActivations(EXTERIOR_DEFAULT_ACTIVATION);
  const exteriorActivationSet = resolveExteriorActivationSet({
    override: exteriorStreamingOverride,
    explicitReleaseId: exteriorExplicitReleaseId,
    activeRealBaseReleaseId,
    fallbackReleaseId: EXTERIOR_CELL_STREAMING_RELEASE_ID,
    records: exteriorActivationRecords,
  });
  const exteriorStreamingRequested = exteriorActivationSet.streaming;
  const exteriorCellReleaseId = exteriorActivationSet.primaryReleaseId;
  const exteriorTargetsRef = useRef<readonly ExteriorReleaseActivation[]>(exteriorActivationSet.targets);
  exteriorTargetsRef.current = exteriorActivationSet.targets;
  const exteriorActivationRecordsRef = useRef<readonly ExteriorDefaultActivationRecord[]>(exteriorActivationRecords);
  exteriorActivationRecordsRef.current = exteriorActivationRecords;
  /** Every release this build promotes by default, named for the operator probes. */
  const exteriorPromotedReleaseIdLabel = exteriorActivationRecords.flatMap((record) => (record.enabled ? [record.releaseId] : [])).join(", ") || "none";
  exteriorStreamingRequestedRef.current = exteriorStreamingRequested;
  exteriorCellReleaseIdRef.current = exteriorCellReleaseId;
  const exteriorWaveState = (releaseId: string): ExteriorWaveView => ({
    ...(exteriorWaves.get(releaseId) ?? IDLE_EXTERIOR_WAVE),
    outcomes: exteriorWaveOutcomes.get(releaseId) ?? NO_EXTERIOR_OUTCOMES,
  });
  // One activation verdict per targeted wave. A wave that has not cleared its
  // own prerequisites contributes nothing to the scene and says so in its own
  // words, rather than being covered by a sibling wave that did clear them.
  const exteriorWaveActivations = exteriorActivationSet.targets.map((target) => {
    const wave = exteriorWaveState(target.releaseId);
    return {
      target,
      wave,
      activation: exteriorStreamingActivation({
        requested: true,
        releaseId: target.releaseId,
        loadState: wave.loadState,
        hasVerifiedRuntime: wave.runtime !== null,
        activeBaseReleaseId: activeRealBaseReleaseId,
        compatibleWithActiveBase: Boolean(wave.runtime?.compatibleWith(activeRealBaseReleaseId)),
      }),
    };
  });
  const exteriorActiveWaves = exteriorWaveActivations.filter((entry) => entry.activation.active);
  const exteriorStreamingActive = exteriorActiveWaves.length > 0;
  const exteriorPrimaryRuntime = exteriorWaveActivations[0]?.wave.runtime ?? null;
  // The wave the canary probe measures, resolved by release id rather than by
  // position: a probe bound to "whichever wave came first" would report Block
  // 835's numbers for a Midtown camera path.
  const exteriorProbeRuntime = exteriorActiveWaves.find((entry) => entry.target.releaseId === exteriorCanaryProbeTarget.releaseId)?.wave.runtime ?? null;
  // Stable identity of "which releases, gated how". The load effect and the
  // overlay memo both key off it so a re-render that changed neither the waves
  // nor the promotion verdicts rebuilds no scene state.
  const exteriorTargetKey = exteriorActivationSet.targets.map((target) => `${target.releaseId}|${target.promotedDefault ? "gated" : "plain"}`).join(";");
  const exteriorActiveWavesRef = useRef(exteriorActiveWaves);
  exteriorActiveWavesRef.current = exteriorActiveWaves;
  const exteriorCellOverlays = useMemo<readonly ExteriorCellOverlay[]>(() => exteriorActiveWavesRef.current.flatMap((entry) => (
    entry.wave.runtime
      ? [{ releaseId: entry.wave.runtime.releaseId, snapshotId: entry.wave.runtime.snapshot.snapshotId, origin: entry.wave.runtime.origin, profile: exteriorProfile, cells: entry.wave.outcomes }]
      : []
  )), [activeRealBaseReleaseId, exteriorProfile, exteriorTargetKey, exteriorWaveOutcomes, exteriorWaves]);
  // Notices stay attributed to the wave that produced them, always. Two waves
  // produce otherwise-identical lines ("N of M cells ship no exterior
  // geometry"), and a reader cannot act on a fallback notice without knowing
  // which release it is about — so the release is named unconditionally rather
  // than appearing only once a second wave happens to be streaming.
  const exteriorNoticeEntries = exteriorActiveWaves.flatMap((entry) => exteriorStreamingNotices(entry.wave.headNotice, entry.wave.outcomes)
    .map((notice) => ({ releaseId: entry.target.releaseId, notice: exteriorQualifiedNotice(entry.target.releaseId, notice) })));
  // Withheld-anchor geometry is reported once for the scene: the viewport
  // resolves anchors across every wave at once and reports one union.
  const exteriorUnanchoredStatement = exteriorStreamingActive ? exteriorUnanchoredNotice(exteriorUnanchoredIds) : null;
  const exteriorNotices = exteriorUnanchoredStatement
    ? [...exteriorNoticeEntries, { releaseId: "", notice: exteriorUnanchoredStatement }]
    : exteriorNoticeEntries;
  // Explicit-unavailable rule, per wave: a real-base session whose exterior wave
  // is not running says so in the details panel instead of letting the exterior
  // provenance section disappear as if it had never been promised.
  const exteriorUnavailableStatementList = exteriorUnavailableStatements({
    set: exteriorActivationSet,
    override: exteriorStreamingOverride,
    activeRealBaseReleaseId,
    explicitReleaseId: exteriorExplicitReleaseId,
  });
  // Bucketed camera *ellipsoid height*, used as the proxy the exterior LOD
  // thresholds are evaluated against. It is not a measured camera-to-asset
  // distance, and bucketing keeps a continuous camera move from restarting LOD
  // selection on every frame.
  const exteriorCameraHeightBucketMeters = Math.max(50, Math.round(Math.max(0, cameraPose.height) / 100) * 100);
  citywideModeRef.current = citywideMode;
  civicModeRef.current = civicMode;
  if (dataMode === "fixtures") releaseIdRef.current = null;
  else if (!releaseIdRef.current) releaseIdRef.current = dataMode === "civic-context" ? TRAVEL_CONTEXT_RELEASE_ID : REAL_PILOT_RELEASE_ID;

  useEffect(() => {
    if (!block835PerformanceMode || typeof window === "undefined") return undefined;
    const expectedPublicRealm = block835PerformanceMode === "stage3-plus-public-realm";
    // Neither declared probe condition includes the exterior streaming overlay.
    // A scene that renders extra verified exterior cells is a different scene,
    // so the probe must not certify it against a stale control sample.
    const prerequisitesReady = Boolean(activeRealBaseReleaseId && exteriorActive && !exteriorStreamingRequested && (expectedPublicRealm ? publicRealmActive : !publicRealmRequested));
    const sessionId = block835PerformanceSessionId();
    const pending = (status: Block835PerformanceProbeResult["status"], reason: string | null): Block835PerformanceProbeResult => ({
      schemaVersion: "1.0",
      status,
      condition: block835PerformanceMode,
      releaseId: BLOCK835_PUBLIC_REALM_RELEASE_ID,
      browserSessionId: sessionId,
      capturedAt: null,
      cameraPath: { id: BLOCK835_PERFORMANCE_CAMERA_PATH_ID, poses: BLOCK835_PERFORMANCE_CAMERA_PATH, settleMs: BLOCK835_PERFORMANCE_SETTLE_MS, samplesPerPose: BLOCK835_PERFORMANCE_SAMPLES_PER_POSE },
      sampleCount: 0,
      medianMs: null,
      p95Ms: null,
      maxMs: null,
      documentHasFocus: { before: document.hasFocus(), after: document.hasFocus() },
      visibilityState: { before: document.visibilityState, after: document.visibilityState },
      viewportCss: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio,
      consoleErrors: [],
      windowErrors: [],
      networkHosts: block835NetworkHosts(),
      reason,
      control: null,
      comparison: null,
    });
    if (!prerequisitesReady) {
      setBlock835PerformanceProbe(pending("waiting-for-prerequisites", exteriorStreamingRequested
        ? `Exterior streaming is active; this probe only measures the declared Stage 3 conditions and will not certify a scene with the additional exterior overlay. Since the Block 835 exterior wave became the default over a real base, add &${EXTERIOR_STREAMING_OFF_PARAM}=off to measure the Stage-3-only scene.`
        : expectedPublicRealm
          ? "Waiting for an active compatible real base, active Stage 3 exterior, and active public-realm overlay."
          : "Waiting for an active compatible real base and active Stage 3 exterior with public realm disabled."));
      return undefined;
    }

    let cancelled = false;
    let started = false;
    const runId = ++block835PerformanceProbeRunRef.current;
    const isCurrent = () => !cancelled && runId === block835PerformanceProbeRunRef.current;
    const run = async () => {
      if (!isCurrent()) return;
      const beforeFocus = document.hasFocus();
      const beforeVisibility = document.visibilityState;
      if (!beforeFocus || beforeVisibility !== "visible") {
        setBlock835PerformanceProbe(pending("waiting-for-focus", "The external browser page must be focused and visible before the deterministic probe starts."));
        return;
      }
      setBlock835PerformanceProbe(pending("running", null));
      const audit = startBlock835ConsoleAudit();
      const samples: number[] = [];
      let reason: string | null = null;
      try {
        for (const pose of BLOCK835_PERFORMANCE_CAMERA_PATH) {
          if (!isCurrent()) return;
          setCameraPose(pose);
          setCameraRequest((current) => ({ ...pose, requestId: (current?.requestId ?? 0) + 1 }));
          await delay(BLOCK835_PERFORMANCE_SETTLE_MS);
          if (!isCurrent()) return;
          if (!document.hasFocus() || document.visibilityState !== "visible") {
            reason = "Focus or visibility changed while collecting settled requestAnimationFrame samples.";
            break;
          }
          let previous = await nextAnimationFrame();
          for (let index = 0; index < BLOCK835_PERFORMANCE_SAMPLES_PER_POSE; index += 1) {
            const now = await nextAnimationFrame();
            if (!isCurrent()) return;
            samples.push(now - previous);
            previous = now;
            if (!document.hasFocus() || document.visibilityState !== "visible") {
              reason = "Focus or visibility changed while collecting settled requestAnimationFrame samples.";
              break;
            }
          }
          if (reason) break;
        }
      } catch (error) {
        reason = error instanceof Error ? error.message : String(error);
      } finally {
        audit.stop();
      }
      if (!isCurrent()) return;
      const summary = summarizeBlock835Frames(samples);
      const afterFocus = document.hasFocus();
      const afterVisibility = document.visibilityState;
      const control = expectedPublicRealm ? storedBlock835PerformanceControl() : null;
      const gate = expectedPublicRealm ? block835PerformanceGate(summary, control) : null;
      const comparison = expectedPublicRealm && gate ? {
        sameBrowserSession: Boolean(control && sessionId && control.browserSessionId === sessionId),
        ...gate,
      } : null;
      const complete = reason === null && summary.sampleCount >= BLOCK835_PERFORMANCE_CAMERA_PATH.length * BLOCK835_PERFORMANCE_SAMPLES_PER_POSE && beforeFocus && afterFocus && beforeVisibility === "visible" && afterVisibility === "visible";
      const result: Block835PerformanceProbeResult = {
        schemaVersion: "1.0",
        status: complete ? "complete" : "invalid",
        condition: block835PerformanceMode,
        releaseId: BLOCK835_PUBLIC_REALM_RELEASE_ID,
        browserSessionId: sessionId,
        capturedAt: new Date().toISOString(),
        cameraPath: { id: BLOCK835_PERFORMANCE_CAMERA_PATH_ID, poses: BLOCK835_PERFORMANCE_CAMERA_PATH, settleMs: BLOCK835_PERFORMANCE_SETTLE_MS, samplesPerPose: BLOCK835_PERFORMANCE_SAMPLES_PER_POSE },
        ...summary,
        documentHasFocus: { before: beforeFocus, after: afterFocus },
        visibilityState: { before: beforeVisibility, after: afterVisibility },
        viewportCss: { width: window.innerWidth, height: window.innerHeight },
        devicePixelRatio: window.devicePixelRatio,
        consoleErrors: audit.consoleErrors,
        windowErrors: audit.windowErrors,
        networkHosts: block835NetworkHosts(),
        reason: reason ?? (complete ? null : "The probe did not retain 600 focused, visible settled samples."),
        control,
        comparison,
      };
      if (!expectedPublicRealm && complete) storeBlock835PerformanceControl(result);
      setBlock835PerformanceProbe(result);
    };
    const startWhenFocused = () => {
      if (started || !isCurrent() || !document.hasFocus() || document.visibilityState !== "visible") return;
      started = true;
      void run();
    };
    if (!document.hasFocus() || document.visibilityState !== "visible") {
      setBlock835PerformanceProbe(pending("waiting-for-focus", "The external browser page must be focused and visible before the deterministic probe starts."));
      window.addEventListener("focus", startWhenFocused);
      document.addEventListener("visibilitychange", startWhenFocused);
    } else {
      startWhenFocused();
    }
    return () => {
      cancelled = true;
      window.removeEventListener("focus", startWhenFocused);
      document.removeEventListener("visibilitychange", startWhenFocused);
    };
  }, [activeRealBaseReleaseId, block835PerformanceMode, exteriorActive, exteriorStreamingRequested, publicRealmActive, publicRealmRequested]);

  // T009 canary validation probe. Compiled out unless VITE_BLOCK835_PROBE=1.
  useEffect(() => {
    if (!block835CanaryMode || typeof window === "undefined") return undefined;
    // The probe measures ONE named wave. Binding it to the leading wave would
    // silently certify Block 835 while the camera flew a Midtown path.
    const runtime = exteriorProbeRuntime;
    const buildMode: "development" | "production" = import.meta.env.DEV ? "development" : "production";
    const facadePath = exteriorCanaryProbeTarget.path;
    const poses = facadePath.poses;
    const pending = (status: Block835CanaryProbeResult["status"], reason: string | null, partial?: Partial<Block835CanaryProbeResult>): Block835CanaryProbeResult => ({
      schemaVersion: "1.0",
      status,
      profile: block835CanaryMode,
      pathId: facadePath.pathId,
      exteriorReleaseId: runtime?.releaseId ?? null,
      exteriorSnapshotId: runtime?.snapshot.snapshotId ?? null,
      baseReleaseId: activeRealBaseReleaseId ?? null,
      capturedAt: null,
      repeats: BLOCK835_CANARY_REPEATS,
      settleMs: BLOCK835_CANARY_SETTLE_MS,
      samplesPerPose: BLOCK835_CANARY_SAMPLES_PER_POSE,
      poseCount: poses.length,
      closestCameraToFacadeMeters: facadePath.closestCameraToFacadeMeters,
      perRepeat: [],
      aggregate: summarizeCanaryFrames([]),
      display: estimateCanaryDisplay([]),
      budget: block835CanaryBudgetVerdict(block835CanaryMode, { medianMs: null, p95Ms: null }),
      heap: block835CanaryHeapVerdict([]),
      runtime: block835CanaryRuntimeVerdict(null, null),
      disclosures: {
        buildMode,
        viewportCss: { width: window.innerWidth, height: window.innerHeight },
        devicePixelRatio: window.devicePixelRatio,
        documentHasFocus: { before: document.hasFocus(), after: document.hasFocus() },
        visibilityState: { before: document.visibilityState, after: document.visibilityState },
        userAgent: window.navigator.userAgent,
        consoleErrors: [],
        windowErrors: [],
        networkHosts: block835NetworkHosts(),
      },
      reason,
      ...partial,
    });
    // The canary probe certifies the canary scene, so it starts only once the
    // exterior-cell release is actually streaming over an active real base.
    if (!activeRealBaseReleaseId || !exteriorStreamingActive || !runtime) {
      // Name the wave being waited for. With several waves promoted, "the
      // pinned exterior-cell release" sent the reader looking at the wrong one.
      setBlock835CanaryProbe(pending("waiting-for-prerequisites", `Waiting for an active compatible real base with exterior release ${exteriorCanaryProbeTarget.releaseId} streaming, which this probe measures along path ${facadePath.pathId}. This build streams ${exteriorPromotedReleaseIdLabel} by default over a real base; remove ?${EXTERIOR_STREAMING_OFF_PARAM}=off if this session disabled exterior streaming, and do not pin a different release with ?exteriorCells=, which selects that release ALONE.`));
      return undefined;
    }

    let cancelled = false;
    let started = false;
    const runId = ++block835CanaryProbeRunRef.current;
    const isCurrent = () => !cancelled && runId === block835CanaryProbeRunRef.current;
    const jsHeapBytes = (): number | null => {
      const used = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory?.usedJSHeapSize;
      return typeof used === "number" && Number.isFinite(used) ? used : null;
    };
    // Peak concurrency is a max across every active wave plus the shared budget.
    const peakConcurrency = (): number => Math.max(
      aggregateBudgetRef.current.peakConcurrency(),
      ...exteriorActiveWavesRef.current.map((entry) => entry.wave.runtime?.getMetrics().peakConcurrentRequests ?? 0),
    );
    // The exterior cache is SHARED across waves, so it is read once from the
    // cache itself. Summing per-runtime metrics would count the same bytes and
    // the same entries once per promoted wave and report a false ceiling.
    const exteriorCacheSample = () => ({
      entries: exteriorCacheRef.current.size(),
      bytes: exteriorCacheRef.current.bytes(),
      evictions: exteriorCacheRef.current.evictionCount(),
    });
    // A6: with --js-flags=--expose-gc the probe forces a collection before each
    // heap sample, so growth across repeats is retention rather than collection
    // lag. Without it the sample keeps its weaker, explicitly-labelled claim.
    const forcedCollection = typeof (window as Window & { gc?: () => void }).gc === "function";
    const collectGarbage = () => { (window as Window & { gc?: () => void }).gc?.(); };
    const run = async () => {
      if (!isCurrent()) return;
      const beforeFocus = document.hasFocus();
      const beforeVisibility = document.visibilityState;
      if (!beforeFocus || beforeVisibility !== "visible") {
        setBlock835CanaryProbe(pending("waiting-for-focus", "The browser page must be focused and visible before the deterministic canary probe starts."));
        return;
      }
      setBlock835CanaryProbe(pending("running", null));
      const audit = startBlock835ConsoleAudit();
      const perRepeat: Block835CanaryRepeatSample[] = [];
      const allSamples: number[] = [];
      let peakCachedBytes = 0;
      let reason: string | null = null;
      try {
        for (let repeatIndex = 0; repeatIndex < BLOCK835_CANARY_REPEATS && !reason; repeatIndex += 1) {
          const repeatSamples: number[] = [];
          for (const facadePose of poses) {
            if (!isCurrent()) return;
            const pose: CameraPose = { ...facadePose.pose };
            setCameraPose(pose);
            setCameraRequest((current) => ({ ...pose, requestId: (current?.requestId ?? 0) + 1 }));
            await delay(BLOCK835_CANARY_SETTLE_MS);
            if (!isCurrent()) return;
            if (!document.hasFocus() || document.visibilityState !== "visible") {
              reason = "Focus or visibility changed while collecting settled requestAnimationFrame samples.";
              break;
            }
            let previous = await nextAnimationFrame();
            for (let index = 0; index < BLOCK835_CANARY_SAMPLES_PER_POSE; index += 1) {
              const now = await nextAnimationFrame();
              if (!isCurrent()) return;
              repeatSamples.push(now - previous);
              previous = now;
              if (!document.hasFocus() || document.visibilityState !== "visible") {
                reason = "Focus or visibility changed while collecting settled requestAnimationFrame samples.";
                break;
              }
            }
            if (reason) break;
          }
          allSamples.push(...repeatSamples);
          const exteriorCache = exteriorCacheSample();
          const cachedBytes = exteriorCache.bytes + composedMetricsRef.current.aggregate.cachedBytes;
          peakCachedBytes = Math.max(peakCachedBytes, cachedBytes);
          collectGarbage();
          perRepeat.push({
            repeatIndex,
            summary: summarizeCanaryFrames(repeatSamples),
            cacheEntries: exteriorCache.entries + composedMetricsRef.current.aggregate.cacheEntries,
            cachedBytes,
            cacheEvictions: exteriorCache.evictions + composedMetricsRef.current.aggregate.cacheEvictions,
            peakConcurrentRequests: peakConcurrency(),
            jsHeapBytes: jsHeapBytes(),
          });
        }
      } catch (error) {
        reason = error instanceof Error ? error.message : String(error);
      } finally {
        audit.stop();
      }
      if (!isCurrent()) return;
      const aggregate = summarizeCanaryFrames(allSamples);
      const afterFocus = document.hasFocus();
      const afterVisibility = document.visibilityState;
      const expectedSamples = BLOCK835_CANARY_REPEATS * poses.length * BLOCK835_CANARY_SAMPLES_PER_POSE;
      const complete = reason === null && aggregate.sampleCount >= expectedSamples && beforeFocus && afterFocus && beforeVisibility === "visible" && afterVisibility === "visible";
      setBlock835CanaryProbe({
        ...pending(complete ? "complete" : "invalid", reason ?? (complete ? null : `The probe did not retain ${expectedSamples} focused, visible settled samples.`)),
        capturedAt: new Date().toISOString(),
        perRepeat,
        aggregate,
        display: estimateCanaryDisplay(allSamples),
        budget: block835CanaryBudgetVerdict(block835CanaryMode, aggregate),
        heap: block835CanaryHeapVerdict(perRepeat.map((entry) => entry.jsHeapBytes), undefined, forcedCollection),
        runtime: block835CanaryRuntimeVerdict(peakConcurrency(), peakCachedBytes || null),
        disclosures: {
          buildMode,
          viewportCss: { width: window.innerWidth, height: window.innerHeight },
          devicePixelRatio: window.devicePixelRatio,
          documentHasFocus: { before: beforeFocus, after: afterFocus },
          visibilityState: { before: beforeVisibility, after: afterVisibility },
          userAgent: window.navigator.userAgent,
          consoleErrors: audit.consoleErrors,
          windowErrors: audit.windowErrors,
          networkHosts: block835NetworkHosts(),
        },
      });
    };
    const startWhenFocused = () => {
      if (started || !isCurrent() || !document.hasFocus() || document.visibilityState !== "visible") return;
      started = true;
      void run();
    };
    if (!document.hasFocus() || document.visibilityState !== "visible") {
      setBlock835CanaryProbe(pending("waiting-for-focus", "The browser page must be focused and visible before the deterministic canary probe starts."));
      window.addEventListener("focus", startWhenFocused);
      document.addEventListener("visibilitychange", startWhenFocused);
    } else {
      startWhenFocused();
    }
    return () => {
      cancelled = true;
      window.removeEventListener("focus", startWhenFocused);
      document.removeEventListener("visibilitychange", startWhenFocused);
    };
  }, [activeRealBaseReleaseId, block835CanaryMode, exteriorCanaryProbeTarget.path, exteriorCanaryProbeTarget.targetId, exteriorProbeRuntime, exteriorStreamingActive]);

  useEffect(() => {
    const targets = exteriorTargetsRef.current;
    if (targets.length === 0) {
      setExteriorUnanchoredIds([]);
      setExteriorWaves((current) => (current.size === 0 ? current : new Map()));
      setExteriorWaveOutcomes((current) => (current.size === 0 ? current : new Map()));
      return undefined;
    }
    // One controller per wave: aborting a superseded load must not cancel a
    // sibling wave that is still resolving its own release.
    const controllers = new Map<string, AbortController>(targets.map((target) => [target.releaseId, new AbortController()]));
    setExteriorWaves(new Map(targets.map((target) => [target.releaseId, LOADING_EXTERIOR_WAVE])));
    setExteriorWaveOutcomes((current) => (current.size === 0 ? current : new Map()));
    const request: ExteriorHeadRequest = exteriorCanarySnapshotId ? { kind: "canary", snapshotId: exteriorCanarySnapshotId } : { kind: "default" };
    // Harness-only failure-boundary seam. It is compiled out unless the build
    // opted in, is query-driven with no user-facing control, and corrupts only
    // a cloned response body in memory: the pinned release files on disk are
    // never rewritten, so the fault journey cannot disturb an immutable byte.
    const harnessParams = BLOCK835_CANARY_HARNESS_ENABLED && typeof window !== "undefined" ? new URL(window.location.href).searchParams : null;
    const cellFault = harnessParams ? parseExteriorCellFault(harnessParams.get("exteriorCellFault"), true) : null;
    // Wave-agnostic per-asset seam: names one GLB by file name so a single
    // asset of a single wave can fail its checksum while every other wave and
    // the base scene are left alone.
    const assetFault = harnessParams ? parseExteriorAssetFault(harnessParams.get("exteriorAssetFault"), true) : null;
    const cellFetcher = cellFault
      ? createExteriorCellFaultFetcher(cellFault)
      : assetFault
        ? createExteriorAssetFaultFetcher(assetFault)
        : undefined;
    // Depend on the adapter STATE, not the ref. `exteriorStreamingRequested` is
    // URL-derived and true on the very first render, while the citywide adapter
    // arrives asynchronously afterwards. Reading the ref captured the
    // placeholder adapter, membership resolution no-opped, verification failed
    // base-incompatible, and nothing re-ran when the real adapter landed — only
    // a manual disable/enable toggle recovered. Listing it as a dependency makes
    // the effect re-run on adapter swap, and the abort in the cleanup cancels
    // the in-flight load so the stale attempt cannot overwrite the new one.
    const adapter = activeAdapter;
    // Membership must be DETERMINISTIC RELEASE MEMBERSHIP, not residency.
    // `getFeature` only sees shards the camera has already streamed, so asking
    // it whether a Block 835 building belongs to the base release answered
    // "no" whenever the camera was elsewhere and every exterior cell failed
    // base-incompatible. Adapters that publish a checksum-verified identity
    // index resolve it once here; fully-resident adapters keep working
    // unchanged through the `getFeature` fallback inside `hasIdentityMember`.
    for (const target of targets) {
      const controller = controllers.get(target.releaseId)!;
      const setWave = (state: ExteriorWaveState) => setExteriorWaves((current) => {
        // A wave no longer targeted has already been replaced; a late resolution
        // must not resurrect it beside the set this session actually resolved.
        if (!current.has(target.releaseId)) return current;
        return new Map(current).set(target.releaseId, state);
      });
      void ensureExteriorBaseIdentity(adapter, controller.signal)
        .then(() => loadExteriorCellRuntime(exteriorCellBasePath(target.releaseId), {
          signal: controller.signal,
          request,
          fetcher: cellFetcher,
          sharedBudget: aggregateBudgetRef.current,
          cache: exteriorCacheRef.current,
          baseIdentity: { releaseId: activeRealBaseReleaseId ?? "no-active-base", has: (featureId) => exteriorBaseIdentityHas(adapter, featureId) },
        })).then(async ({ runtime, head }) => {
        if (controller.signal.aborted) return;
        // Digest-form membership is recomputed from what the runtime resolved,
        // never read from the release. Computed before the gate because Web
        // Crypto is async and the gate is not.
        const resolvedCellsDigest = target.record.enabled && target.record.membership.cellsDigestSha256 !== null
          ? await exteriorAcceptedCellsDigest(runtime.snapshot.cells)
          : null;
        if (controller.signal.aborted) return;
        // Acceptance gate for the promoted default: what the runtime resolved must
        // be the accepted hashes and the accepted cell membership. A same-named
        // release that resolved different bytes renders nothing. The gate runs
        // against THIS wave's record, so no wave can borrow another's acceptance.
        if (target.promotedDefault) {
          const verification = verifyPromotedExteriorPin({
            releaseId: runtime.releaseId,
            snapshotId: head.pin.snapshotId,
            snapshotChecksumSha256: head.pin.checksumSha256,
            assemblyPackageIds: head.pin.assemblyPackageIds,
            cells: runtime.snapshot.cells,
            cellsDigestSha256: resolvedCellsDigest,
          }, target.record);
          if (!verification.ok) {
            setWave(failedExteriorWave(verification.message));
            return;
          }
        }
        setWave({ runtime, loadState: "ready", message: "", headNotice: head.notice });
        // Only the loaded index knows which canary heads exist, so an
        // unresolvable canary deep link is reported here rather than at parse time.
        const requestedCanary = exteriorCanarySnapshotIdRef.current;
        if (requestedCanary) {
          setExteriorDeepLinkNotice(exteriorCanarySnapshotMessage(target.releaseId, requestedCanary, runtime.index.canaryHeads.map((entry) => entry.snapshotId)));
        }
      }).catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setWave(failedExteriorWave(exteriorStreamingFailureMessage(error)));
      });
    }
    return () => { for (const controller of controllers.values()) controller.abort(); };
  }, [activeAdapter, activeRealBaseReleaseId, exteriorCanarySnapshotId, exteriorTargetKey]);

  /**
   * Per-wave cell loading.
   *
   * The loads are keyed by release and OUTLIVE the effect run that started
   * them. An effect-scoped controller looked correct and was not: this effect
   * re-runs whenever ANY wave changes state, so the moment a second wave
   * finished loading its index, the cleanup aborted the first wave's in-flight
   * asset requests and that wave's cell failed closed with a request error it
   * had no reason to have. A load is therefore cancelled only when its OWN
   * inputs change — its runtime, the render profile, or the camera LOD bucket —
   * or when the whole component goes away.
   */
  useEffect(() => {
    const running = exteriorCellLoadsRef.current;
    const wanted = new Map(exteriorTargetsRef.current.flatMap((target) => {
      const runtime = exteriorWaves.get(target.releaseId)?.runtime ?? null;
      return runtime ? [[target.releaseId, { target, runtime }] as const] : [];
    }));
    for (const [releaseId, entry] of [...running]) {
      const next = wanted.get(releaseId);
      const unchanged = next && next.runtime === entry.runtime && entry.profile === exteriorProfile && entry.bucket === exteriorCameraHeightBucketMeters;
      if (unchanged) continue;
      entry.controller.abort();
      running.delete(releaseId);
      // A wave that is no longer targeted keeps no outcomes: they describe a
      // load that was just cancelled, and holding their verified GLB bytes
      // would retain a whole withdrawn wave for the life of the session.
      if (!next) setExteriorWaveOutcomes((current) => { if (!current.has(releaseId)) return current; const remaining = new Map(current); remaining.delete(releaseId); return remaining; });
    }
    for (const [releaseId, { target, runtime }] of wanted) {
      if (running.has(releaseId)) continue;
      const controller = new AbortController();
      const entry = { runtime, profile: exteriorProfile, bucket: exteriorCameraHeightBucketMeters, controller };
      running.set(releaseId, entry);
      const isCurrent = () => exteriorCellLoadsRef.current.get(releaseId) === entry && !controller.signal.aborted;
      void Promise.all(runtime.cellIds().map((cellId) => runtime.loadCell(cellId, exteriorProfile, exteriorCameraHeightBucketMeters, controller.signal)))
        .then((outcomes) => {
          if (!isCurrent()) return;
          // Identity gate: exterior assets reuse canonical base identities, so an
          // identity outside the accepted membership means these are not the
          // accepted bytes. A cell that degraded to base massing renders no asset
          // and is reported by the existing per-cell notices instead. The gate
          // runs against THIS wave's accepted membership.
          if (target.promotedDefault) {
            const renderedIds = outcomes.flatMap((outcome) => outcome.kind === "rendered" ? outcome.assets.map((asset) => asset.canonicalFeatureId) : []);
            const membership = verifyPromotedExteriorMembership(renderedIds, target.record);
            if (!membership.ok) {
              setExteriorWaveOutcomes((current) => { const next = new Map(current); next.delete(releaseId); return next; });
              setExteriorWaves((current) => (current.has(releaseId) ? new Map(current).set(releaseId, failedExteriorWave(membership.message)) : current));
              return;
            }
          }
          setExteriorWaveOutcomes((current) => new Map(current).set(releaseId, outcomes));
        })
        .catch(() => {
          if (!isCurrent()) return;
          setExteriorWaveOutcomes((current) => { const next = new Map(current); next.delete(releaseId); return next; });
        });
    }
    return undefined;
    // `exteriorTargetKey` is a dependency even though the targets are read from
    // a ref: a change to WHICH releases are targeted must always re-run this
    // reconciliation, and it does not always coincide with a wave-state change.
  }, [exteriorCameraHeightBucketMeters, exteriorProfile, exteriorTargetKey, exteriorWaves]);

  // The only place a live cell load is cancelled wholesale: the component going
  // away. Everything else cancels exactly the wave whose inputs changed.
  useEffect(() => () => {
    for (const entry of exteriorCellLoadsRef.current.values()) entry.controller.abort();
    exteriorCellLoadsRef.current.clear();
  }, []);

  const publishCitywideMetrics = useCallback((adapter: CitywideReleaseAdapter) => {
    if (citywideAdapterRef.current !== adapter) return;
    const next = adapter.getMetrics();
    setCitywideMetrics((previous) => (
      previous.visibleShardCount === next.visibleShardCount &&
      previous.requestedShardCount === next.requestedShardCount &&
      previous.loadedFeatureCount === next.loadedFeatureCount &&
      previous.loadedBytes === next.loadedBytes &&
      previous.maxConcurrentRequests === next.maxConcurrentRequests &&
      previous.activeRequests === next.activeRequests &&
      previous.failedRequestCount === next.failedRequestCount &&
      previous.cancelledRequestCount === next.cancelledRequestCount &&
      previous.staleResultCount === next.staleResultCount &&
      previous.retainedSummaryCount === next.retainedSummaryCount &&
      previous.retainedFeatureCount === next.retainedFeatureCount &&
      previous.retainedDetailCount === next.retainedDetailCount &&
      previous.detailIndexEntryCount === next.detailIndexEntryCount &&
      previous.cacheEntries === next.cacheEntries &&
      previous.cacheEvictions === next.cacheEvictions &&
      previous.dedupedRefreshCount === next.dedupedRefreshCount
        ? previous
        : next
    ));
  }, []);

  const publishCitywideDenseMetrics = useCallback((next: DenseRenderMetrics) => {
    setCitywideDenseMetrics((previous) => (
      previous.featureCount === next.featureCount &&
      previous.primitiveCount === next.primitiveCount &&
      previous.instanceCount === next.instanceCount &&
      previous.buildingFeatureCount === next.buildingFeatureCount &&
      previous.pointFeatureCount === next.pointFeatureCount &&
      previous.baseFeatureCount === next.baseFeatureCount &&
      previous.contextFeatureCount === next.contextFeatureCount &&
      previous.contextPartCount === next.contextPartCount &&
      previous.planBuildCount === next.planBuildCount &&
      previous.planReuseCount === next.planReuseCount &&
      previous.planCancellationCount === next.planCancellationCount &&
      previous.planSwapCount === next.planSwapCount &&
      previous.planFingerprint === next.planFingerprint &&
      previous.selectionMs === next.selectionMs &&
      previous.keyMs === next.keyMs &&
      previous.allocationMs === next.allocationMs &&
      previous.allocationMaxSliceMs === next.allocationMaxSliceMs &&
      previous.allocationChunkCount === next.allocationChunkCount &&
      previous.workerReadyMs === next.workerReadyMs &&
      previous.totalBuildMs === next.totalBuildMs
        ? previous
        : next
    ));
  }, []);

  const publishComposedMetrics = useCallback((adapter: ComposedReleaseAdapter) => {
    if (composedAdapterRef.current !== adapter) return;
    const next = adapter.getMetrics();
    setComposedMetrics((previous) => (
      previous.base.loadedBytes === next.base.loadedBytes &&
      previous.base.activeRequests === next.base.activeRequests &&
      previous.base.failedRequestCount === next.base.failedRequestCount &&
      previous.context.loadedBytes === next.context.loadedBytes &&
      previous.context.activeRequests === next.context.activeRequests &&
      previous.context.failedRequestCount === next.context.failedRequestCount &&
      previous.aggregate.cacheEntries === next.aggregate.cacheEntries &&
      previous.aggregate.cachedBytes === next.aggregate.cachedBytes &&
      previous.aggregate.cacheEvictions === next.aggregate.cacheEvictions &&
      previous.aggregate.activeRequests === next.aggregate.activeRequests &&
      previous.aggregate.failedRequestCount === next.aggregate.failedRequestCount &&
      previous.aggregate.staleResultCount === next.aggregate.staleResultCount &&
      previous.failedRoles.join(",") === next.failedRoles.join(",") &&
      previous.render.baseFeatureCount === next.render.baseFeatureCount &&
      previous.render.contextFeatureCount === next.render.contextFeatureCount
        ? previous
        : next
    ));
  }, []);

  useEffect(() => { if (typeof window !== "undefined") persistSavedNavigation(window.localStorage, savedNavigation); }, [savedNavigation]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const injectedFault = import.meta.env.DEV && typeof window !== "undefined" ? new URL(window.location.href).searchParams.get("travelFault") : null;
    const civicFault: TravelContextFault | null = injectedFault === "parks-geometry" || injectedFault === "lpc-detail" ? injectedFault : null;
    const loadCitywide = async () => {
      try {
        if (injectedFault === "citywide-root") throw new Error("Injected citywide root failure; immutable release was not modified.");
        const adapter = await loadCitywideRelease("/data/manhattan-citywide-20260804/", controller.signal, undefined, { sharedBudget: aggregateBudgetRef.current, sharedCache: aggregateCacheRef.current, cacheNamespace: "citywide" });
        if (!active) { adapter.destroy(); return; }
        setCitywideAdapter(adapter);
        setCitywideLoadState("ready");
        if (initialCitywideRequest) setRealDataMessage(`Citywide release ${CITYWIDE_RELEASE_ID} validated locally; viewport geometry and global search/detail shards load on demand.`);
      } catch (error) {
        if (active && !(error instanceof DOMException && error.name === "AbortError")) {
          setCitywideAdapter(null);
          setCitywideLoadState("failed");
          if (initialCitywideRequest) setRealDataMessage(error instanceof Error ? `${error.message} Fixture fallback is active.` : "Citywide release unavailable. Fixture fallback is active.");
        }
      }
    };
    void loadCitywide();
    const loadCivic = async () => {
      try {
        if (injectedFault === "civic-root") throw new Error("Injected civic root failure; immutable release was not modified.");
        const adapter = await loadTravelContextRelease("/data/manhattan-civic-context-20260804/", controller.signal, undefined, { fault: civicFault, sharedBudget: aggregateBudgetRef.current, sharedCache: aggregateCacheRef.current, cacheNamespace: "civic" });
        if (!active) { adapter.destroy(); return; }
        setCivicAdapter(adapter);
        setCivicLoadState("ready");
        if (initialCivicRequest) setRealDataMessage(`Civic-context release ${TRAVEL_CONTEXT_RELEASE_ID} validated locally; statistical areas, Parks properties, and LPC records load from checksum-pinned local shards.`);
      } catch (error) {
        if (active && !(error instanceof DOMException && error.name === "AbortError")) {
          setCivicAdapter(null);
          setCivicLoadState("failed");
          if (initialCivicRequest) setRealDataMessage(error instanceof Error ? `${error.message} Fixture fallback is active.` : "Civic-context release unavailable. Fixture fallback is active.");
        }
      }
    };
    void loadCivic();
    const load = async () => {
      try {
        const [loaded, landmarkAssets] = await Promise.all([
          loadRealPilot("/data/real-wave-20260804/", controller.signal),
          loadLandmarkAssets().catch((error) => {
            if (active) setLandmarkAssetMessage(error instanceof Error ? error.message : "Landmark GLB package unavailable; procedural fallback is active.");
            return null;
          }),
        ]);
        const buildings = loaded.features.filter((feature) => feature.kind === "building");
        const restaurants = loaded.features.filter((feature) => feature.kind === "poi");
        if (buildings.length === 0 || restaurants.length === 0) throw new Error("Published real pilot partitions are invalid.");
        if (!active) return;
        const adapter = landmarkAssets
          ? new LocalFixtureCityAdapter([...buildings, ...restaurants], undefined, landmarkAssets.manifest, false, landmarkAssets.verifiedContentRefs, REAL_PILOT_RELEASE_ID)
          : new LocalFixtureCityAdapter([...buildings, ...restaurants], undefined, undefined, false, new Set<string>(), REAL_PILOT_RELEASE_ID);
        setRealAdapter(adapter);
        setRealLoadState("ready");
        if (landmarkAssets) setLandmarkAssetMessage(`${landmarkAssets.manifest.assets.length} bounded landmark GLBs verified with SHA-256; all other buildings remain procedural fallback.`);
        setRealDataMessage(`Real pilot available: ${buildings.length.toLocaleString()} buildings and ${restaurants.length.toLocaleString()} restaurants; source dates and attribution are shown in Data.`);
      } catch (error) {
        if (active && !(error instanceof DOMException && error.name === "AbortError")) {
          setRealAdapter(null);
          setRealLoadState("failed");
          setRealDataMessage(error instanceof Error ? `${error.message} Fixture fallback is active.` : "Real pilot unavailable. Fixture fallback is active.");
        }
      }
    };
    void load();
    return () => { active = false; controller.abort(); };
  }, []);

  useEffect(() => {
    if (!exteriorRequested) {
      setExteriorOverlay(null);
      setExteriorLoadState("idle");
      setExteriorMessage("");
      return undefined;
    }
    let active = true;
    const controller = new AbortController();
    // This branch is compiled out of production builds. It is deliberately
    // query-driven and has no user-facing control because it exists only for
    // local Stage 3 failure-boundary proof against cloned responses.
    const exteriorFault = import.meta.env.DEV && typeof window !== "undefined"
      ? parseExteriorPilotFault(new URL(window.location.href).searchParams.get("exteriorFault"), true)
      : null;
    const exteriorFetcher = exteriorFault ? createExteriorPilotFaultFetcher(exteriorFault) : undefined;
    setExteriorLoadState("loading");
    setExteriorMessage("Exterior/commercial overlay is loading from the local release…");
    void loadExteriorPilotRelease(`/data/${EXTERIOR_PILOT_RELEASE_ID}/`, controller.signal, exteriorFetcher).then((loaded) => {
      if (!active) return;
      setExteriorOverlay(loaded);
      setExteriorLoadState("ready");
      setExteriorMessage(loaded.assetFailures.length > 0
        ? `Exterior overlay active with ${loaded.assetFailures.length} asset fallback${loaded.assetFailures.length === 1 ? "" : "s"}; the affected building remains procedural.`
        : `Exterior overlay ${EXTERIOR_PILOT_RELEASE_ID} verified locally: 14 buildings, 28 LOD assets, ${loaded.diagnostics.acceptedStorefronts} accepted storefront signs.`);
    }).catch((error: unknown) => {
      if (!active || (error instanceof DOMException && error.name === "AbortError")) return;
      setExteriorOverlay(null);
      setExteriorLoadState("failed");
      setExteriorMessage(error instanceof Error ? `${error.message} The untouched base/civic release remains active.` : "Exterior overlay failed closed; the untouched base/civic release remains active.");
    });
    return () => { active = false; controller.abort(); };
  }, [exteriorRequested]);

  useEffect(() => {
    if (!publicRealmRequested) {
      setPublicRealmOverlay(null);
      setPublicRealmLoadState("idle");
      setPublicRealmMessage("");
      setSelectedPublicRealmId(null);
      selectedPublicRealmIdRef.current = null;
      return undefined;
    }
    let active = true;
    const controller = new AbortController();
    const publicRealmFault = import.meta.env.DEV && typeof window !== "undefined"
      ? parseBlock835PublicRealmFault(new URL(window.location.href).searchParams.get("publicRealmFault"), true)
      : null;
    const publicRealmFetcher = publicRealmFault ? createBlock835PublicRealmFaultFetcher(publicRealmFault) : undefined;
    setPublicRealmLoadState("loading");
    setPublicRealmMessage("Block 835 public-realm overlay is loading from the local release…");
    void loadBlock835PublicRealmRelease(`/data/${BLOCK835_PUBLIC_REALM_RELEASE_ID}/`, controller.signal, publicRealmFetcher).then((loaded) => {
      if (!active) return;
      setPublicRealmOverlay(loaded);
      setPublicRealmLoadState("ready");
      setPublicRealmMessage(`Block 835 public realm verified locally: ${loaded.features.length} selectable source/estimated features, four intersections, and 8 hashed LOD assets.`);
    }).catch((error: unknown) => {
      if (!active || (error instanceof DOMException && error.name === "AbortError")) return;
      setPublicRealmOverlay(null);
      setPublicRealmLoadState("failed");
      setSelectedPublicRealmId(null);
      selectedPublicRealmIdRef.current = null;
      setPublicRealmMessage(block835PublicRealmFailureMessage(error));
    });
    return () => { active = false; controller.abort(); };
  }, [publicRealmRequested]);

  useEffect(() => {
    if (!citywideAdapter || !civicAdapter || citywideLoadState !== "ready" || civicLoadState !== "ready") {
      setComposedAdapter(null);
      setCompositionLoadState(citywideLoadState === "failed" || civicLoadState === "failed" ? "failed" : "loading");
      setComposedMetrics(EMPTY_COMPOSED_METRICS);
      return undefined;
    }
    try {
      const next = new ComposedReleaseAdapter(citywideAdapter, civicAdapter, { sharedBudget: aggregateBudgetRef.current, sharedCache: aggregateCacheRef.current });
      setComposedAdapter(next);
      setCompositionLoadState("ready");
      return () => next.destroy();
    } catch (error) {
      setComposedAdapter(null);
      setCompositionLoadState("failed");
      setDeepLinkMessage(error instanceof Error ? error.message : "Immutable civic/base release composition failed closed.");
      return undefined;
    }
  }, [citywideAdapter, citywideLoadState, civicAdapter, civicLoadState]);

  useEffect(() => {
    if (!citywideMode || !citywideAdapter) {
      setCitywideFeatures([]);
      setCitywideMetrics((previous) => previous === EMPTY_CITYWIDE_METRICS ? previous : EMPTY_CITYWIDE_METRICS);
      setCitywideDenseMetrics((previous) => previous === EMPTY_CITYWIDE_DENSE_METRICS ? previous : EMPTY_CITYWIDE_DENSE_METRICS);
      return undefined;
    }
    let active = true;
    void citywideAdapter.refreshViewport({ camera: cameraPoseRef.current, footprint: viewportFootprintRef.current }).then((features) => {
      if (active && citywideAdapterRef.current === citywideAdapter) {
        setCitywideFeatures((previous) => preserveFeatureSequence(previous, features));
        publishCitywideMetrics(citywideAdapter);
      }
    }).catch((error: unknown) => {
      if (active && !(error instanceof DOMException && error.name === "AbortError")) setDeepLinkMessage(error instanceof Error ? error.message : "Citywide viewport shard failed closed.");
    });
    return () => { active = false; };
  }, [citywideAdapter, citywideMode, publishCitywideMetrics]);

  useEffect(() => {
    if (!civicMode || !composedAdapter) {
      setCivicFeatures([]);
      setComposedMetrics((previous) => previous === EMPTY_COMPOSED_METRICS ? previous : EMPTY_COMPOSED_METRICS);
      return undefined;
    }
    let active = true;
    void composedAdapter.refreshViewport({ camera: cameraPoseRef.current, footprint: viewportFootprintRef.current }).then((features) => {
      if (active && composedAdapterRef.current === composedAdapter) {
        setCivicFeatures((previous) => preserveFeatureSequence(previous, features));
        publishComposedMetrics(composedAdapter);
      }
    }).catch((error: unknown) => {
      if (active && !(error instanceof DOMException && error.name === "AbortError")) setDeepLinkMessage(error instanceof Error ? error.message : "Civic/base viewport shard failed closed.");
    });
    return () => { active = false; };
  }, [composedAdapter, civicMode, publishComposedMetrics]);

  useEffect(() => {
    if (!citywideMode || !citywideAdapter || !query.trim()) {
      setCitywideSearchResults([]);
      return undefined;
    }
    const controller = new AbortController();
    void citywideAdapter.searchAsync(query, controller.signal).then((features) => {
      if (controller.signal.aborted || citywideAdapterRef.current !== citywideAdapter) return;
      setCitywideSearchResults(features.map((feature, index) => ({ feature, entity: null, group: feature.kind === "building" ? "Buildings" : "Places", typeLabel: feature.kind === "building" ? "Building" : "Restaurant", score: index, matchedBy: "text" as const })));
      publishCitywideMetrics(citywideAdapter);
    }).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) setCitywideSearchResults([]);
    });
    return () => controller.abort();
  }, [citywideAdapter, citywideMode, publishCitywideMetrics, query]);

  useEffect(() => {
    if (!civicMode || !composedAdapter || !query.trim()) {
      setCivicSearchResults([]);
      return undefined;
    }
    const controller = new AbortController();
    void composedAdapter.searchAsync(query, controller.signal, selectedCivicFacets).then((features) => {
      if (controller.signal.aborted || composedAdapterRef.current !== composedAdapter) return;
      const baseFeatures = features.filter((feature) => feature.attributes.citywideReleaseId === CITYWIDE_RELEASE_ID || /^(?:doitt:|dohmh:)/iu.test(feature.id));
      const contextFeatures = features.filter((feature) => feature.attributes.civicReleaseId === TRAVEL_CONTEXT_RELEASE_ID || /^udt:manhattan:/iu.test(feature.id));
      setCivicSearchResults(searchMixedReleaseFeatures(baseFeatures, contextFeatures, query, { civicFacets: selectedCivicFacets, limit: 8 }));
      publishComposedMetrics(composedAdapter);
    }).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) setCivicSearchResults([]);
    });
    return () => controller.abort();
  }, [composedAdapter, civicMode, publishComposedMetrics, query, selectedCivicFacets]);

  const publishStressState = useCallback((stream: RuntimeTileStream<SyntheticTileContent>) => {
    if (stressStreamRef.current !== stream) return;
    setStressFeatures(stream.getVisibleValues().flatMap((content) => content.features));
    setTileMetrics(stream.getMetrics());
  }, []);

  const onTileCameraChanged = useCallback((camera: CameraPose, receivedFootprint?: ViewportFootprint) => {
    const intent = stressCameraIntentRef.current;
    if (intent && Date.now() < intent.expiresAt) camera = { longitude: intent.camera.longitude, latitude: intent.camera.latitude, height: intent.camera.distanceMeters, heading: 0, pitch: -45, roll: 0 };
    else stressCameraIntentRef.current = null;
    const tileCamera: TileCameraState = { longitude: camera.longitude, latitude: camera.latitude, distanceMeters: camera.height };
    stressCameraRef.current = tileCamera;
    const normalizedCamera = normalizeCameraPose(camera) ?? DEFAULT_CAMERA_POSE;
    const nextFootprint = receivedFootprint ?? fallbackViewportFootprint(normalizedCamera);
    if (viewportFootprintRef.current.signature !== nextFootprint.signature) {
      viewportFootprintRef.current = nextFootprint;
      setViewportFootprint(nextFootprint);
    }
    setCameraPose(normalizedCamera);
    const pendingPose = pendingNavigationPoseRef.current;
    if (pendingPose) {
      const poseMatches = Math.abs(normalizedCamera.longitude - pendingPose.longitude) < 1e-7 &&
        Math.abs(normalizedCamera.latitude - pendingPose.latitude) < 1e-7 &&
        Math.abs(normalizedCamera.height - pendingPose.height) < 1e-3 &&
        Math.abs(normalizedCamera.heading - pendingPose.heading) < 1e-6 &&
        Math.abs(normalizedCamera.pitch - pendingPose.pitch) < 1e-6 &&
        Math.abs(normalizedCamera.roll - pendingPose.roll) < 1e-6;
      if (!poseMatches) return;
      pendingNavigationPoseRef.current = null;
    }
    if (initialRealNavigationPendingRef.current) return;
    if (typeof window !== "undefined") window.history.replaceState({}, "", navigationUrlForApp({ featureId: activeSelectionRef.current ?? initialNavigation.featureId, query: queryRef.current || initialNavigation.query, cameraMode: cameraModeRef.current, pose: normalizedCamera, poseInvalid: false, dataMode: dataModeRef.current, releaseId: releaseIdRef.current, visibleLayers: Object.entries(layerVisibilityRef.current).filter(([, visible]) => visible).map(([layer]) => layer), facets: civicModeRef.current ? selectedCivicFacetsRef.current : selectedCategoriesRef.current, ...getOverlayUrlFields() }, window.location.href));
    const citywide = citywideAdapterRef.current;
    if (citywideModeRef.current && citywide) {
      void citywide.refreshViewport({ camera: normalizedCamera, footprint: nextFootprint }).then((features) => {
        if (citywideAdapterRef.current === citywide && citywideModeRef.current) {
          setCitywideFeatures((previous) => preserveFeatureSequence(previous, features));
          publishCitywideMetrics(citywide);
        }
      }).catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setDeepLinkMessage(error instanceof Error ? error.message : "Citywide viewport shard failed closed.");
      });
    }
    const composed = composedAdapterRef.current;
    if (civicModeRef.current && composed) {
      void composed.refreshViewport({ camera: normalizedCamera, footprint: nextFootprint }).then((features) => {
        if (composedAdapterRef.current === composed && civicModeRef.current) {
          setCivicFeatures((previous) => preserveFeatureSequence(previous, features));
          publishComposedMetrics(composed);
        }
      }).catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setDeepLinkMessage(error instanceof Error ? error.message : "Civic/base viewport shard failed closed.");
      });
    }
    const stream = stressStreamRef.current;
    if (!stream) return;
    void stream.refresh(tileCamera).then(() => publishStressState(stream));
  }, [getOverlayUrlFields, navigationUrlForApp, publishCitywideMetrics, publishComposedMetrics, publishStressState]);

  const moveStressCamera = (anchorIndex: number, distanceMeters: number) => {
    const anchor = SYNTHETIC_TILE_ANCHORS[anchorIndex];
    if (!anchor) return;
    const camera = { longitude: anchor[0], latitude: anchor[1], distanceMeters };
    stressCameraIntentRef.current = { camera, expiresAt: Date.now() + 1_500 };
    setStressCameraRequest((current) => ({ ...camera, requestId: (current?.requestId ?? 0) + 1 }));
  };

  useEffect(() => {
    let active = true;
    const text = JSON.stringify(routeGraphFixture);
    void sha256Hex(text).then((inputChecksumSha256) => RouteGraphSnapshotAdapter.fromSnapshot({ snapshotText: text, metadata: { inputFileName: "route-graph.synthetic.fixture.json", inputChecksumSha256, ingestedAt: "2026-08-03T00:00:00Z", immutable: true, fixtureOnly: true } })).then((adapter) => { if (active) setRouteAdapter(adapter); }).catch(() => { if (active) setRouteMessage("Synthetic route graph unavailable; no real routing is connected."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    let stream: RuntimeTileStream<SyntheticTileContent> | null = null;
    if (!stressMode) {
      setStressFeatures([]);
      stressStreamRef.current?.destroy();
      stressStreamRef.current = null;
      setTileMetrics((current) => ({ ...current, selectedLod: null, visibleTileCount: 0, requestedTileCount: 0, loadedTileCount: 0, evictedTileCount: 0, failedTileCount: 0, loadedBytes: 0, activeRequests: 0, renderedFeatureCount: 0 }));
      return () => { active = false; };
    }
    void generateSyntheticTileHarness({ featuresPerLayerPerLod: 18 }).then(async ({ package: tilePackage, contents }) => {
      if (!active) return;
      const tileStream = new RuntimeTileStream<SyntheticTileContent>(tilePackage, async (manifest, signal) => {
        if (signal.aborted) throw new DOMException("Tile request cancelled", "AbortError");
        const content = contents.get(manifest.contentId); if (!content) throw new Error(`Synthetic tile content missing: ${manifest.contentId}`); return content;
      }, { maxLoadedTiles: 4, maxLoadedBytes: 1_000_000, maxConcurrentRequests: 2, minLod: 8, maxLod: 12 });
      stream = tileStream;
      stressStreamRef.current = tileStream;
      await tileStream.refresh(stressCameraRef.current);
      if (!active) { tileStream.destroy(); return; }
      publishStressState(tileStream);
    }).catch(() => { if (active) setTileMetrics((current) => ({ ...current, failedTileCount: current.failedTileCount + 1 })); });
    return () => { active = false; if (stressStreamRef.current === stream) stressStreamRef.current = null; stream?.destroy(); stream = null; };
  }, [publishStressState, stressMode]);

  const selectFeature = useCallback((feature: Feature, options: { syncUrl?: boolean } = {}) => {
    storefrontResolutionRequestRef.current += 1;
    if (typeof document !== "undefined") {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement && !activeElement.closest(".inspector")) detailsReturnRef.current = activeElement;
    }
    setOverlapFeatures([]);
    updateSelectedStorefront(null);
    selectedPublicRealmIdRef.current = null;
    setSelectedPublicRealmId(null);
    setSelectedFeature(toCityFeature(feature));
    setActiveSelectionId(feature.id);
    setSelectedCatalogEntityId(syntheticCatalog.entities.find((entity) => entity.fields.runtimeFeatureId === feature.id)?.canonicalId ?? null);
    const focusTransaction = selectionFocusTransaction(feature);
    setFocusFeatureId(focusTransaction.focusFeatureId);
    if (focusTransaction.shouldFly) setFocusRequest((request) => request + 1);
    setInspectorOpen(true);
    setDeepLinkMessage(null);
    if (options.syncUrl !== false && typeof window !== "undefined") window.history.pushState({}, "", navigationUrlForApp({ featureId: feature.id, query: queryRef.current, cameraMode: cameraModeRef.current, pose: cameraPoseRef.current, poseInvalid: false, dataMode: dataModeRef.current, releaseId: releaseIdRef.current, visibleLayers: Object.entries(layerVisibilityRef.current).filter(([, visible]) => visible).map(([layer]) => layer), facets: civicModeRef.current ? selectedCivicFacetsRef.current : selectedCategoriesRef.current, ...getOverlayUrlFields() }, window.location.href));
    window.setTimeout(() => detailsHeadingRef.current?.focus(), 0);
    const citywide = citywideAdapterRef.current;
    if (citywideModeRef.current && citywide && feature.attributes.citywideDetailLoaded !== true) {
      void citywide.loadDetailsForFeature(feature).then((detail) => {
        if (detail && citywideAdapterRef.current === citywide && citywideModeRef.current && activeSelectionRef.current === detail.id) setSelectedFeature(toCityFeature(detail));
        publishCitywideMetrics(citywide);
      }).catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setDeepLinkMessage(error instanceof Error ? error.message : "Citywide detail shard failed closed; no substitute record was selected.");
      });
    }
    const composed = composedAdapterRef.current;
    if (civicModeRef.current && composed && feature.attributes.civicDetailLoaded !== true) {
      void composed.loadDetailsForFeature(feature).then((detail) => {
        if (detail && composedAdapterRef.current === composed && civicModeRef.current && activeSelectionRef.current === detail.id) setSelectedFeature(toCityFeature(detail));
        publishComposedMetrics(composed);
      }).catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setDeepLinkMessage(error instanceof Error ? error.message : "Civic/base detail shard failed closed; no substitute record was selected.");
      });
    }
  }, [getOverlayUrlFields, navigationUrlForApp, publishComposedMetrics, publishCitywideMetrics, updateSelectedStorefront]);

  const selectPublicRealm = useCallback((feature: Block835PublicRealmFeature, options: { syncUrl?: boolean } = {}) => {
    if (!publicRealmOverlay) return;
    const runtimeFeature = publicRealmFeatureToFeature(feature, publicRealmOverlay.document.generatedAt);
    selectedPublicRealmIdRef.current = feature.id;
    setSelectedPublicRealmId(feature.id);
    selectFeature(runtimeFeature, { syncUrl: false });
    selectedPublicRealmIdRef.current = feature.id;
    setSelectedPublicRealmId(feature.id);
    if (options.syncUrl !== false && typeof window !== "undefined") {
      window.history.pushState({}, "", navigationUrlForApp({
        featureId: runtimeFeature.id,
        query: queryRef.current,
        cameraMode: cameraModeRef.current,
        pose: cameraPoseRef.current,
        poseInvalid: false,
        dataMode: dataModeRef.current,
        releaseId: releaseIdRef.current,
        visibleLayers: Object.entries(layerVisibilityRef.current).filter(([, visible]) => visible).map(([layer]) => layer),
        facets: civicModeRef.current ? selectedCivicFacetsRef.current : selectedCategoriesRef.current,
        ...getOverlayUrlFields(),
      }, window.location.href));
    }
  }, [getOverlayUrlFields, navigationUrlForApp, publicRealmOverlay, selectFeature]);

  const selectStorefront = useCallback((placement: CommercialStorefrontPlacement) => {
    const request: StorefrontResolutionState = {
      requestId: storefrontResolutionRequestRef.current + 1,
      adapter: activeAdapter,
      dataMode,
    };
    storefrontResolutionRequestRef.current = request.requestId;
    const composed = composedAdapterRef.current;
    const citywide = citywideAdapterRef.current;
    const loadCanonical = civicModeRef.current && composed
      ? (featureId: string) => composed.loadDetail(featureId)
      : citywideModeRef.current && citywide
      ? (featureId: string) => citywide.loadDetail(featureId)
      : undefined;
    const commit = (building: Feature | undefined) => {
      if (building) {
        selectFeature(building, { syncUrl: false });
        // selectFeature clears any prior storefront selection; restore the
        // accepted proxy after the building identity has become authoritative.
        updateSelectedStorefront(placement.storefrontId);
        setDeepLinkMessage(null);
      } else {
        updateSelectedStorefront(placement.storefrontId);
        setDeepLinkMessage(`Storefront ${placement.storefrontId} has no loaded canonical building; no substitute identity was selected.`);
      }
      if (typeof window !== "undefined") {
        window.history.pushState({}, "", navigationUrlForApp({
          featureId: building?.id ?? activeSelectionRef.current,
          query: queryRef.current,
          cameraMode: cameraModeRef.current,
          pose: cameraPoseRef.current,
          poseInvalid: false,
          dataMode: dataModeRef.current,
          releaseId: releaseIdRef.current,
          visibleLayers: Object.entries(layerVisibilityRef.current).filter(([, visible]) => visible).map(([layer]) => layer),
          facets: civicModeRef.current ? selectedCivicFacetsRef.current : selectedCategoriesRef.current,
          ...getOverlayUrlFields(),
        }, window.location.href));
      }
    };
    updateSelectedStorefront(placement.storefrontId);
    void applyStorefrontResolution(
      request,
      () => ({ requestId: storefrontResolutionRequestRef.current, adapter: activeAdapterRef.current, dataMode: dataModeRef.current }),
      resolveStorefrontBuilding(placement, activeAdapter, loadCanonical),
      commit,
    );
  }, [activeAdapter, dataMode, getOverlayUrlFields, navigationUrlForApp, selectFeature, updateSelectedStorefront]);

  const selectOverlapFeatures = useCallback((features: Feature[]) => {
    const byId = new Map(features.map((feature) => [feature.id, feature]));
    const candidates: TravelContextOverlapCandidate[] = features.map((feature) => ({ canonicalId: feature.id, layerId: feature.attributes.civicLayerId === "statistical-areas" ? "statistical-areas" : feature.attributes.civicLayerId === "parks" ? "parks" : feature.attributes.civicLayerId === "landmarks" ? "landmarks" : feature.kind === "building" ? "buildings" : "restaurants", kind: overlapKind(feature), label: feature.name, priority: 0 }));
    setOverlapFeatures(rankOverlapCandidates(candidates).map((candidate) => byId.get(candidate.canonicalId)).filter((feature): feature is Feature => Boolean(feature)));
  }, []);

  const unifiedResults = useMemo(() => civicMode
    ? civicSearchResults
    : citywideMode
    ? citywideSearchResults
    : dataMode === "real-pilot"
    ? searchRealPlaceCatalog(activeAdapter.getFeatures(), query, selectedCategories)
    : searchUnifiedCatalog(activeAdapter.getFeatures(), syntheticCatalog, query).filter((result) => selectedCategories.length === 0 || result.feature.kind !== "poi" || selectedCategories.some((category) => placeCategoriesFromFeature(result.feature).includes(category))), [activeAdapter, civicMode, civicSearchResults, citywideMode, citywideSearchResults, dataMode, query, selectedCategories]);
  const composedDenseGroups = useMemo(() => civicMode && composedAdapter ? composedAdapter.getVisibleFeatureGroups() : undefined, [civicFeatures, civicMode, composedAdapter]);
  const composedDenseGroupLimits = useMemo(() => civicMode ? { base: CITYWIDE_BUDGETS.maxRenderedDenseFeatures, context: TRAVEL_CONTEXT_BUDGETS.maxAreaRenderParts } : undefined, [civicMode]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const applyUrl = () => {
      const state = parseNavigationUrl(window.location.href);
      const requestedExterior = state.exteriorReleaseId === EXTERIOR_PILOT_RELEASE_ID && state.commercial === true;
      const url = new URL(window.location.href);
      const requestedPublicRealm = url.searchParams.get("publicRealm") === BLOCK835_PUBLIC_REALM_RELEASE_ID;
      const requestedPublicRealmFeature = requestedPublicRealm ? url.searchParams.get("publicRealmFeature") : null;
      // Exterior streaming intent is part of history state. Before the Block 835
      // promotion it was read once at mount and never restored, so Back/Forward
      // silently kept whatever the session last had; now every entry restores
      // its own explicit on/off intent, release, profile, and canary.
      const requestedExteriorStreaming = parseExteriorStreamingUrl(window.location.href);
      exteriorStreamingOverrideRef.current = requestedExteriorStreaming.override;
      exteriorExplicitReleaseIdRef.current = requestedExteriorStreaming.explicitReleaseId;
      exteriorProfileRef.current = requestedExteriorStreaming.profile;
      exteriorCanarySnapshotIdRef.current = requestedExteriorStreaming.canarySnapshotId;
      setExteriorStreamingOverride(requestedExteriorStreaming.override);
      setExteriorExplicitReleaseId(requestedExteriorStreaming.explicitReleaseId);
      setExteriorProfile(requestedExteriorStreaming.profile);
      setExteriorCanarySnapshotId(requestedExteriorStreaming.canarySnapshotId);
      exteriorRequestedRef.current = requestedExterior;
      publicRealmRequestedRef.current = requestedPublicRealm;
      selectedPublicRealmIdRef.current = requestedPublicRealmFeature;
      updateSelectedStorefront(state.storefrontId ?? null);
      setExteriorRequested(requestedExterior);
      setPublicRealmRequested(requestedPublicRealm);
      setSelectedPublicRealmId(requestedPublicRealmFeature);
      setQuery(state.query);
      setCameraMode(state.cameraMode); setPoseInvalid(state.poseInvalid);
      if (state.visibleLayers) {
        const requestedLayers = new Set(state.visibleLayers);
        setLayerVisibility(Object.fromEntries((Object.keys(DEFAULT_LAYER_VISIBILITY) as RuntimeLayerId[]).map((layer) => [layer, requestedLayers.has(layer)])) as LayerVisibility);
      }
      if (state.facets) {
        setSelectedCategories(state.facets.filter((value): value is PlaceCategory => PLACE_CATEGORIES.includes(value as PlaceCategory)));
        setSelectedCivicFacets(state.facets.filter((value): value is CivicFacet => (CIVIC_FACETS as readonly string[]).includes(value)));
      }
      if (state.pose) { setCameraPose(state.pose); setCameraRequest((current) => ({ ...state.pose!, requestId: (current?.requestId ?? 0) + 1 })); }
      const requestedReal = state.dataMode === "real-pilot" || state.dataMode === "civic-context";
      const requestedCitywide = requestedReal && state.releaseId === CITYWIDE_RELEASE_ID;
      const requestedCivic = requestedReal && state.releaseId === TRAVEL_CONTEXT_RELEASE_ID;
      pendingNavigationPoseRef.current = requestedReal ? state.pose : null;
      if (!requestedReal) initialRealNavigationPendingRef.current = false;
      if (requestedCitywide) {
        releaseIdRef.current = CITYWIDE_RELEASE_ID;
        if (citywideLoadState !== "ready" || !citywideAdapter) {
          if (citywideLoadState === "failed") {
            initialRealNavigationPendingRef.current = false;
            pendingNavigationPoseRef.current = null;
            releaseIdRef.current = null;
          }
          dataModeRef.current = "fixtures";
          setDataMode("fixtures");
          if (activeAdapter !== fixtureAdapter) setActiveAdapter(fixtureAdapter);
          setRealFallbackActive(true);
          setInspectorOpen(false);
          setActiveSelectionId(null);
          setSelectedCatalogEntityId(null);
          setFocusFeatureId(null);
          const notice = citywideLoadState === "failed"
            ? "The requested citywide release failed to load or validate. Fixture fallback is active; no fixture or same-name substitute was selected."
            : "The requested citywide release is still loading. Fixture fallback is active; no fixture or same-name substitute was selected.";
          if (citywideLoadState === "failed") terminalRealFallbackNoticeRef.current = notice;
          setDeepLinkMessage(notice);
          return;
        }
        initialRealNavigationPendingRef.current = false;
        terminalRealFallbackNoticeRef.current = null;
        dataModeRef.current = "real-pilot";
        releaseIdRef.current = CITYWIDE_RELEASE_ID;
        setDataMode("real-pilot");
        setRealFallbackActive(false);
        if (activeAdapter !== citywideAdapter) setActiveAdapter(citywideAdapter);
        if (!state.featureId) {
          setActiveSelectionId(null);
          setFocusFeatureId(null);
          setInspectorOpen(false);
          setDeepLinkMessage(state.poseInvalid ? "This shared camera pose is malformed; the safe citywide view is active." : null);
          return;
        }
        const feature = citywideAdapter.getFeature(state.featureId);
        if (feature) {
          selectFeature(feature, { syncUrl: false });
          if (state.storefrontId) updateSelectedStorefront(state.storefrontId);
        }
        else {
          setActiveSelectionId(null);
          setFocusFeatureId(null);
          setInspectorOpen(false);
          void citywideAdapter.loadDetail(state.featureId).then((loadedFeature) => {
            if (loadedFeature && citywideAdapterRef.current === citywideAdapter && citywideModeRef.current) {
              selectFeature(loadedFeature, { syncUrl: false });
              if (state.storefrontId) updateSelectedStorefront(state.storefrontId);
            }
            else if (!loadedFeature && activeSelectionRef.current === null) setDeepLinkMessage(`This shared link points to a parent unavailable in release ${CITYWIDE_RELEASE_ID}; no substitute was selected.`);
          }).catch(() => setDeepLinkMessage(`This shared link could not load parent ${state.featureId}; no substitute was selected.`));
        }
        return;
      }
      if (requestedCivic) {
        releaseIdRef.current = TRAVEL_CONTEXT_RELEASE_ID;
        if (compositionLoadState !== "ready" || !composedAdapter) {
          const canFallbackToCitywide = citywideLoadState === "ready" && Boolean(citywideAdapter) && (civicLoadState === "failed" || compositionLoadState === "failed");
          if (canFallbackToCitywide && citywideAdapter) {
            initialRealNavigationPendingRef.current = false;
            pendingNavigationPoseRef.current = null;
            terminalRealFallbackNoticeRef.current = "The civic context root failed closed; the validated citywide base is active with its truthful URL and release identity.";
            dataModeRef.current = "real-pilot";
            releaseIdRef.current = CITYWIDE_RELEASE_ID;
            setDataMode("real-pilot");
            setRealFallbackActive(true);
            setActiveAdapter(citywideAdapter);
            const baseFeatureId = state.featureId && /^(?:doitt:|dohmh:)/iu.test(state.featureId) ? state.featureId : null;
            setActiveSelectionId(null);
            setFocusFeatureId(null);
            setInspectorOpen(false);
            setDeepLinkMessage(terminalRealFallbackNoticeRef.current);
            if (typeof window !== "undefined") window.history.replaceState({}, "", navigationUrlForApp({ featureId: baseFeatureId, query: state.query, cameraMode: state.cameraMode, pose: state.pose, poseInvalid: state.poseInvalid, dataMode: "real-pilot", releaseId: CITYWIDE_RELEASE_ID, visibleLayers: state.visibleLayers, facets: state.facets, ...getOverlayUrlFields() }, window.location.href));
            return;
          }
          if (civicLoadState === "failed" || compositionLoadState === "failed") {
            initialRealNavigationPendingRef.current = false;
            pendingNavigationPoseRef.current = null;
            releaseIdRef.current = null;
          }
          dataModeRef.current = "fixtures";
          setDataMode("fixtures");
          if (activeAdapter !== fixtureAdapter) setActiveAdapter(fixtureAdapter);
          setRealFallbackActive(true);
          setInspectorOpen(false);
          setActiveSelectionId(null);
          setSelectedCatalogEntityId(null);
          setFocusFeatureId(null);
          const notice = civicLoadState === "failed" || compositionLoadState === "failed"
            ? "The requested civic-context composition failed to validate. Fixture fallback is active; no fixture or same-name substitute was selected."
            : "The requested civic-context release is still loading. Fixture fallback is active; no fixture or same-name substitute was selected.";
          if (civicLoadState === "failed" || compositionLoadState === "failed") terminalRealFallbackNoticeRef.current = notice;
          setDeepLinkMessage(notice);
          return;
        }
        initialRealNavigationPendingRef.current = false;
        terminalRealFallbackNoticeRef.current = null;
        dataModeRef.current = "civic-context";
        releaseIdRef.current = TRAVEL_CONTEXT_RELEASE_ID;
        setDataMode("civic-context");
        setRealFallbackActive(false);
        if (activeAdapter !== composedAdapter) setActiveAdapter(composedAdapter);
        if (!state.featureId) {
          setActiveSelectionId(null);
          setFocusFeatureId(null);
          setInspectorOpen(false);
          setDeepLinkMessage(state.poseInvalid ? "This shared camera pose is malformed; the safe civic-context view is active." : null);
          return;
        }
        const feature = composedAdapter.getFeature(state.featureId);
        if (feature) {
          selectFeature(feature, { syncUrl: false });
          if (state.storefrontId) updateSelectedStorefront(state.storefrontId);
        }
        else {
          setActiveSelectionId(null);
          setFocusFeatureId(null);
          setInspectorOpen(false);
          void composedAdapter.loadDetail(state.featureId).then((loadedFeature) => {
            if (loadedFeature && composedAdapterRef.current === composedAdapter && civicModeRef.current) {
              selectFeature(loadedFeature, { syncUrl: false });
              if (state.storefrontId) updateSelectedStorefront(state.storefrontId);
            }
            else if (!loadedFeature && activeSelectionRef.current === null) setDeepLinkMessage(`This shared link points to a parent unavailable in release ${TRAVEL_CONTEXT_RELEASE_ID}; no substitute was selected.`);
          }).catch(() => setDeepLinkMessage(`This shared link could not load parent ${state.featureId}; no substitute was selected.`));
        }
        return;
      }
      const releaseValid = requestedReal && state.releaseId === REAL_PILOT_RELEASE_ID;
      if (requestedReal) {
        releaseIdRef.current = state.releaseId ?? null;
        if (!releaseValid) {
          initialRealNavigationPendingRef.current = false;
          pendingNavigationPoseRef.current = null;
          releaseIdRef.current = null;
          dataModeRef.current = "fixtures";
          setDataMode("fixtures");
          if (activeAdapter !== fixtureAdapter) setActiveAdapter(fixtureAdapter);
          setRealFallbackActive(true);
          setInspectorOpen(false);
          setActiveSelectionId(null);
          setSelectedCatalogEntityId(null);
          setFocusFeatureId(null);
          const notice = `This shared link requests unavailable real release “${state.releaseId ?? "unknown"}”. Fixture fallback is active; no fixture or same-name substitute was selected.`;
          terminalRealFallbackNoticeRef.current = notice;
          setDeepLinkMessage(notice);
          return;
        }
        if (realLoadState !== "ready" || !realAdapter) {
          if (realLoadState === "failed") {
            initialRealNavigationPendingRef.current = false;
            pendingNavigationPoseRef.current = null;
            releaseIdRef.current = null;
          }
          dataModeRef.current = "fixtures";
          setDataMode("fixtures");
          if (activeAdapter !== fixtureAdapter) setActiveAdapter(fixtureAdapter);
          setRealFallbackActive(true);
          setInspectorOpen(false);
          setActiveSelectionId(null);
          setSelectedCatalogEntityId(null);
          setFocusFeatureId(null);
          const notice = realLoadState === "failed"
            ? "The requested real pilot release failed to load or validate. Fixture fallback is active; no fixture substitute was selected."
            : "The requested real pilot release is still loading. Fixture fallback is active; no fixture substitute was selected.";
          if (realLoadState === "failed") terminalRealFallbackNoticeRef.current = notice;
          setDeepLinkMessage(notice);
          return;
        }
        initialRealNavigationPendingRef.current = false;
        terminalRealFallbackNoticeRef.current = null;
        dataModeRef.current = "real-pilot";
        releaseIdRef.current = REAL_PILOT_RELEASE_ID;
        setDataMode("real-pilot");
        setRealFallbackActive(false);
        if (activeAdapter !== realAdapter) setActiveAdapter(realAdapter);
        if (!state.featureId) { setDeepLinkMessage(state.poseInvalid ? "This shared camera pose is malformed; the safe real pilot view is active." : null); return; }
        const feature = realAdapter.getFeature(state.featureId);
        if (feature) {
          selectFeature(feature, { syncUrl: false });
          if (state.storefrontId) updateSelectedStorefront(state.storefrontId);
        }
        else {
          setActiveSelectionId(null);
          setFocusFeatureId(null);
          setInspectorOpen(false);
          setDeepLinkMessage(state.poseInvalid ? "This shared link has an invalid camera pose and a feature that is not in the current real release." : `This shared link points to a feature unavailable in release ${state.releaseId ?? REAL_PILOT_RELEASE_ID}; no substitute was selected.`);
        }
        return;
      } else {
        dataModeRef.current = "fixtures";
        setDataMode("fixtures");
        releaseIdRef.current = null;
        setRealFallbackActive(false);
        if (activeAdapter !== fixtureAdapter) setActiveAdapter(fixtureAdapter);
      }
      if (!state.featureId) {
        setActiveSelectionId(null);
        setDeepLinkMessage(terminalRealFallbackNoticeRef.current ?? (state.poseInvalid ? "This shared camera pose is malformed; the safe default view is active." : null));
        return;
      }
      const feature = fixtureAdapter.getFeature(state.featureId);
      if (feature) {
        selectFeature(feature, { syncUrl: false });
        if (state.storefrontId) updateSelectedStorefront(state.storefrontId);
      }
      else { setActiveSelectionId(null); setDeepLinkMessage(terminalRealFallbackNoticeRef.current ?? (state.poseInvalid ? "This shared link has an invalid camera pose and a feature that is not in the current catalog release." : `This shared link points to a feature unavailable in release ${state.releaseId ?? "the active fixture catalog"}; no substitute was selected.`)); }
    };
    applyUrl();
    window.addEventListener("popstate", applyUrl);
    return () => window.removeEventListener("popstate", applyUrl);
  }, [activeAdapter, civicAdapter, civicLoadState, citywideAdapter, citywideLoadState, composedAdapter, compositionLoadState, getOverlayUrlFields, navigationUrlForApp, realAdapter, realLoadState, selectFeature, updateSelectedStorefront]);

  useEffect(() => {
    if (!publicRealmRequested || publicRealmLoadState !== "ready" || !publicRealmOverlay || !selectedPublicRealmId) return;
    if (activeSelectionRef.current === `public-realm:${selectedPublicRealmId}`) return;
    const feature = publicRealmOverlay.feature(selectedPublicRealmId);
    if (feature) selectPublicRealm(feature, { syncUrl: false });
    else setDeepLinkMessage(`This shared link points to a public-realm feature unavailable in release ${BLOCK835_PUBLIC_REALM_RELEASE_ID}; no substitute was selected.`);
  }, [publicRealmLoadState, publicRealmOverlay, publicRealmRequested, selectPublicRealm, selectedPublicRealmId]);

  const closeInspector = useCallback(() => {
    setInspectorOpen(false);
    window.setTimeout(() => {
      const returnTarget = detailsReturnRef.current;
      if (returnTarget && returnTarget !== document.body && document.contains(returnTarget)) returnTarget.focus();
      else searchInputRef.current?.focus();
    }, 0);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSearchOpen(false); setActiveSearchIndex(-1); setQualityOpen(false);
      setLayersOpen(false); setDiagnosticsOpen(false); setDirectionsOpen(false);
      if (inspectorOpen) closeInspector();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeInspector, inspectorOpen]);

  const focusMarker = () => {
    setInspectorOpen(true);
    if (!shouldFocusFeature(selectedFeature)) return;
    setFocusFeatureId(selectedFeature.id);
    setFocusRequest((request) => request + 1);
  };

  const selectSearchResult = (result: UnifiedSearchResult) => {
    setQuery(result.feature.name);
    selectFeature(result.feature);
    setSearchOpen(false);
    setActiveSearchIndex(-1);
  };

  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const unifiedMatch = unifiedResults[activeSearchIndex >= 0 ? activeSearchIndex : 0];
    if (unifiedMatch) { selectSearchResult(unifiedMatch); return; }
    if (dataMode !== "fixtures") {
      setDeepLinkMessage(null);
      return;
    }
    const catalogMatch = searchReconciledCatalog(syntheticCatalog, query).find((entity) => {
      if (selectedCategories.length === 0 || entity.entityKind !== "poi") return true;
      return selectedCategories.some((category) => entity.fields.categories.includes(category));
    });
    const catalogFeature = catalogMatch?.fields.runtimeFeatureId ? activeAdapter.getFeature(catalogMatch.fields.runtimeFeatureId) : undefined;
    if (catalogMatch && catalogFeature) {
      setSelectedCatalogEntityId(catalogMatch.canonicalId);
      selectFeature(catalogFeature);
      return;
    }
    const matches = activeAdapter.search(query);
    const match = matches.find((feature) => selectedCategories.length === 0 || selectedCategories.some((category) => placeCategoriesFromFeature(feature).includes(category))) ?? matches[0];
    if (match && featureMatchesQuery(toCityFeature(match), query)) selectFeature(match);
    if (match) setSearchOpen(false);
  };

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setSearchOpen(true); setActiveSearchIndex((index) => Math.min(index + 1, unifiedResults.length - 1)); }
    if (event.key === "ArrowUp") { event.preventDefault(); setActiveSearchIndex((index) => Math.max(index - 1, 0)); }
    if (event.key === "Enter" && unifiedResults.length > 0) {
      event.preventDefault();
      const result = unifiedResults[activeSearchIndex >= 0 ? activeSearchIndex : 0];
      if (result) selectSearchResult(result);
    }
    if (event.key === "Escape") { event.preventDefault(); setSearchOpen(false); setActiveSearchIndex(-1); }
  };

  const copyShareLink = async () => {
    if (typeof window === "undefined") return;
    const link = navigationUrlForApp({ featureId: selectedFeature.id, query: queryRef.current, cameraMode: cameraModeRef.current, pose: cameraPoseRef.current, poseInvalid: false, dataMode: dataModeRef.current, releaseId: releaseIdRef.current, visibleLayers: Object.entries(layerVisibility).filter(([, visible]) => visible).map(([layer]) => layer), facets: civicMode ? selectedCivicFacets : selectedCategories, ...getOverlayUrlFields() }, window.location.href);
    setShareMessage("Share link copied.");
    try { await navigator.clipboard?.writeText(link); } catch { setShareMessage(link); }
    window.setTimeout(() => setShareMessage(null), 2500);
  };

  const toggleCategory = (category: PlaceCategory) => {
    const next = selectedCategories.includes(category)
      ? selectedCategories.filter((item) => item !== category)
      : [...selectedCategories, category];
    setSelectedCategories(next);
    if (typeof window !== "undefined") window.history.replaceState({}, "", navigationUrlForApp({ featureId: activeSelectionRef.current, query: queryRef.current, cameraMode: cameraModeRef.current, pose: cameraPoseRef.current, poseInvalid: false, dataMode: dataModeRef.current, releaseId: releaseIdRef.current, visibleLayers: Object.entries(layerVisibility).filter(([, visible]) => visible).map(([layer]) => layer), facets: next, ...getOverlayUrlFields() }, window.location.href));
  };

  const toggleCivicFacet = (facet: CivicFacet) => {
    const next = selectedCivicFacets.includes(facet)
      ? selectedCivicFacets.filter((item) => item !== facet)
      : [...selectedCivicFacets, facet];
    setSelectedCivicFacets(next);
    if (typeof window !== "undefined") window.history.replaceState({}, "", navigationUrlForApp({ featureId: activeSelectionRef.current, query: queryRef.current, cameraMode: cameraModeRef.current, pose: cameraPoseRef.current, poseInvalid: false, dataMode: dataModeRef.current, releaseId: releaseIdRef.current, visibleLayers: Object.entries(layerVisibility).filter(([, visible]) => visible).map(([layer]) => layer), facets: next, ...getOverlayUrlFields() }, window.location.href));
  };

  const availableCategories = useMemo<PlaceCategory[]>(() => {
    if (citywideMode || civicMode) return ["restaurant"];
    if (dataMode === "real-pilot") {
      return [...new Set(activeAdapter.getFeatures().filter((feature) => feature.kind === "poi").flatMap((feature) => {
        try { return parseRealPlaceFeature(feature).categories; } catch { return []; }
      }))].sort((left, right) => left.localeCompare(right));
    }
    return PLACE_CATEGORIES.filter((category) => ["restaurant", "cafe", "bar", "retail", "department-store", "grocery", "attraction", "museum"].includes(category));
  }, [activeAdapter, civicMode, citywideMode, dataMode]);

  useEffect(() => {
    setSelectedCategories((current) => current.filter((category) => availableCategories.includes(category)));
  }, [availableCategories]);

  const featureFilter = useCallback((feature: Feature) => {
    if (civicMode && feature.attributes.civicReleaseId === TRAVEL_CONTEXT_RELEASE_ID && selectedCivicFacets.length > 0 && !selectedCivicFacets.includes(feature.attributes.civicRecordKind as CivicFacet)) return false;
    if (selectedCategories.length === 0 || feature.kind !== "poi") return true;
    const categories = placeCategoriesFromFeature(feature);
    return selectedCategories.some((category) => categories.includes(category));
  }, [civicMode, selectedCategories, selectedCivicFacets]);

  const toggleLayer = (layer: RuntimeLayerId) => {
    const next = { ...layerVisibility, [layer]: !layerVisibility[layer] };
    setLayerVisibility(next);
    if (typeof window !== "undefined") window.history.replaceState({}, "", navigationUrlForApp({ featureId: activeSelectionRef.current, query: queryRef.current, cameraMode: cameraModeRef.current, pose: cameraPoseRef.current, poseInvalid: false, dataMode: dataModeRef.current, releaseId: releaseIdRef.current, visibleLayers: Object.entries(next).filter(([, visible]) => visible).map(([visibleLayer]) => visibleLayer), facets: civicMode ? selectedCivicFacets : selectedCategories, ...getOverlayUrlFields() }, window.location.href));
  };

  const selectedRuntimeFeature = activeAdapter.getFeature(selectedFeature.id);
  const selectedPublicRealmFeature = publicRealmActive && publicRealmOverlay && selectedPublicRealmId ? publicRealmOverlay.feature(selectedPublicRealmId) ?? null : null;
  const selectedCommercialBuilding = exteriorActive && selectedRuntimeFeature?.kind === "building" && exteriorOverlay ? exteriorOverlay.commercialForBuilding(selectedRuntimeFeature.id) : null;
  const selectedPlaceTruth = dataMode === "fixtures" && selectedRuntimeFeature ? placeTruthByRuntimeFeatureId.get(selectedRuntimeFeature.id) : undefined;
  const selectedRealPlace = useMemo<RealPlaceView | null>(() => {
    // Citywide uses its own parent/detail projection below. Do not parse a
    // citywide feature through the bounded pilot view as well: occurrence
    // source refs can legitimately repeat, and rendering both projections
    // creates duplicate keyed attribution links and a misleading pilot claim.
    if (dataMode !== "real-pilot" || citywideMode || !selectedRuntimeFeature || selectedRuntimeFeature.kind !== "poi") return null;
    try { return parseRealPlaceFeature(selectedRuntimeFeature); } catch { return null; }
  }, [citywideMode, dataMode, selectedRuntimeFeature]);
  const selectedPlaceHoursStatus = selectedPlaceTruth ? evaluatePlaceHours(selectedPlaceTruth.hours, new Date()) : null;
  const selectedCatalogEntity: CanonicalEntity | undefined = dataMode === "fixtures" ? syntheticCatalog.entities.find((entity) => entity.canonicalId === selectedCatalogEntityId)
    ?? syntheticCatalog.entities.find((entity) => entity.fields.runtimeFeatureId === selectedFeature.id) : undefined;
  const relatedFeatureIds = selectedCatalogEntity ? [...selectedCatalogEntity.fields.links.buildingIds, ...selectedCatalogEntity.fields.links.areaIds, ...selectedCatalogEntity.fields.links.transitIds] : [];
  const relatedFeatures = relatedFeatureIds.map((id) => activeAdapter.getFeature(id)).filter((feature): feature is Feature => Boolean(feature));
  const nearbyTransit = findNearbyFeatures(selectedRuntimeFeature, activeAdapter.getFeatures(), {
    thresholdMeters: DEFAULT_PROXIMITY_THRESHOLD_METERS,
    maxResults: DEFAULT_PROXIMITY_MAX_RESULTS,
    predicate: (feature) => feature.kind === "transit-station" || feature.kind === "transit-entrance",
  });
  const proximityOriginAvailable = representativePoint(selectedRuntimeFeature) !== null;
  const routeOriginName = activeAdapter.getFeature(routeOriginId ?? "")?.name ?? "Not set";
  const routeDestinationName = activeAdapter.getFeature(routeDestinationId ?? "")?.name ?? "Not set";
  const selectedRouteSupported = Boolean(routeAdapter?.canRouteFeature(selectedRuntimeFeature, routeMode));
  const routeOriginFeature = activeAdapter.getFeature(routeOriginId ?? "");
  const routeDestinationFeature = activeAdapter.getFeature(routeDestinationId ?? "");
  const routeEndpointsSupported = Boolean(routeAdapter && routeOriginFeature && routeDestinationFeature
    && routeAdapter.canRouteFeature(routeOriginFeature, routeMode)
    && routeAdapter.canRouteFeature(routeDestinationFeature, routeMode));
  const setRouteEndpointFromSelected = (endpoint: "origin" | "destination") => {
    if (!selectedRuntimeFeature || !routeAdapter || !routeAdapter.canRouteFeature(selectedRuntimeFeature, routeMode)) {
      setRouteMessage(`Selected ${selectedRuntimeFeature?.kind ?? "feature"} is unsupported by the synthetic ${routeMode} graph.`);
      return;
    }
    if (endpoint === "origin") { setRouteOriginId(selectedRuntimeFeature.id); setRouteOriginQuery(selectedRuntimeFeature.name); }
    else { setRouteDestinationId(selectedRuntimeFeature.id); setRouteDestinationQuery(selectedRuntimeFeature.name); }
    setRouteMessage("");
  };
  const resolveRouteSearch = (endpoint: "origin" | "destination") => {
    const queryValue = endpoint === "origin" ? routeOriginQuery : routeDestinationQuery;
    const match = activeAdapter.search(queryValue)[0];
    if (!match) { setRouteMessage(`No synthetic feature matches “${queryValue}”.`); return; }
    if (!routeAdapter || !routeAdapter.canRouteFeature(match, routeMode)) {
      if (endpoint === "origin") setRouteOriginId(null); else setRouteDestinationId(null);
      setRouteMessage(`${match.name} is unsupported by the synthetic ${routeMode} graph; choose a linked point endpoint.`);
      return;
    }
    if (endpoint === "origin") setRouteOriginId(match.id);
    else setRouteDestinationId(match.id);
    setRouteMessage("");
  };
  const calculateRoute = () => {
    const origin = activeAdapter.getFeature(routeOriginId ?? ""); const destination = activeAdapter.getFeature(routeDestinationId ?? "");
    if (!origin || !destination || !routeAdapter) { setRouteMessage("Set both endpoints after the local fixture graph loads."); return; }
    if (!routeAdapter.canRouteFeature(origin, routeMode) || !routeAdapter.canRouteFeature(destination, routeMode)) {
      setItinerary(null);
      setRouteMessage(`One or more endpoints are unsupported by the synthetic ${routeMode} graph.`);
      return;
    }
    const nextItinerary = routeAdapter.route(origin, destination, routeMode, { avoidStairs: false, stepFreeOnly: false, maxSlopePercent: null });
    setItinerary(nextItinerary);
    setRouteMessage(nextItinerary ? "Synthetic route calculated; not real navigation." : "No synthetic route connects these endpoints in the selected mode.");
  };
  const clearRoute = () => { setItinerary(null); setRouteMessage(""); setPreviewRequest((current) => ({ action: "stop", requestId: (current?.requestId ?? 0) + 1 })); };
  const swapRoute = () => { setRouteOriginId(routeDestinationId); setRouteDestinationId(routeOriginId); setRouteOriginQuery(routeDestinationQuery); setRouteDestinationQuery(routeOriginQuery); setItinerary(null); };
  const preview = (action: "start" | "pause" | "stop" | "previous" | "next" | "focus") => {
    const count = journeyStepCount(itinerary);
    if (action !== "pause" && action !== "stop") setPreviewStep((current) => stepIndex(current, action, count));
    setPreviewRequest((current) => ({ action, requestId: (current?.requestId ?? 0) + 1 }));
  };
  const routeLines = useMemo(() => itinerary, [itinerary]);
  const updateCamera = (next: Partial<CameraPose>, nextMode = cameraMode) => {
    const normalized = normalizeCameraPose({ ...cameraPose, ...next });
    if (!normalized) return;
    setCameraMode(nextMode); setCameraPose(normalized); setPoseInvalid(false);
    setCameraRequest((current) => ({ ...normalized, requestId: (current?.requestId ?? 0) + 1 }));
    if (typeof window !== "undefined") window.history.replaceState({}, "", navigationUrlForApp({ featureId: activeSelectionRef.current, query: queryRef.current, cameraMode: nextMode, pose: normalized, poseInvalid: false, dataMode: dataModeRef.current, releaseId: releaseIdRef.current, visibleLayers: Object.entries(layerVisibility).filter(([, visible]) => visible).map(([layer]) => layer), facets: civicMode ? selectedCivicFacets : selectedCategories, ...getOverlayUrlFields() }, window.location.href));
  };
  const focusCurrentSelection = () => {
    if (!selectedRuntimeFeature) return;
    if (!shouldFocusFeature(selectedRuntimeFeature) || (citywideMode || civicMode) && (selectedRuntimeFeature.attributes.citywideLocationStatus === "location-unavailable" || selectedRuntimeFeature.attributes.civicLocationStatus === "location-unavailable")) {
      setDeepLinkMessage(citywideMode ? "This DOHMH parent has no source coordinates; details remain available and no substitute marker is shown." : "This civic record has no source coordinates; details remain available and no substitute marker is shown.");
      return;
    }
    setActiveSelectionId(selectedRuntimeFeature.id);
    setFocusFeatureId(selectedRuntimeFeature.id);
    setFocusRequest((request) => request + 1);
  };
  const onViewportKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.currentTarget !== document.activeElement) return;
    const delta = 0.0015;
    if (event.key === "ArrowUp") { event.preventDefault(); updateCamera({ latitude: cameraPose.latitude + delta }); }
    else if (event.key === "ArrowDown") { event.preventDefault(); updateCamera({ latitude: cameraPose.latitude - delta }); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); updateCamera({ longitude: cameraPose.longitude - delta }); }
    else if (event.key === "ArrowRight") { event.preventDefault(); updateCamera({ longitude: cameraPose.longitude + delta }); }
    else if (event.key.toLowerCase() === "n") { event.preventDefault(); updateCamera({ heading: 0 }); }
    else if (event.key === "Home") { event.preventDefault(); updateCamera(DEFAULT_CAMERA_POSE, "overview"); }
  };
  const saveCurrentPlace = () => {
    setSavedNavigation((current) => savePlace(current, { schemaVersion: VISITOR_NAVIGATION_SCHEMA_VERSION, canonicalId: selectedFeature.id, label: selectedFeature.name, savedAt: new Date().toISOString(), releaseId: dataModeRef.current === "fixtures" ? null : releaseIdRef.current }));
  };
  const saveCurrentJourney = () => {
    if (!itinerary) return;
    const journeyId = `journey:${itinerary.originFeatureId}:${itinerary.destinationFeatureId}:${itinerary.mode}`;
    setSavedNavigation((current) => saveJourney(current, { schemaVersion: VISITOR_NAVIGATION_SCHEMA_VERSION, id: journeyId, originFeatureId: itinerary.originFeatureId, destinationFeatureId: itinerary.destinationFeatureId, mode: itinerary.mode, label: `${routeOriginName} → ${routeDestinationName}`, savedAt: new Date().toISOString() }));
  };
  const restorePlace = (place: SavedNavigationState["places"][number]) => {
    const activeRelease = dataModeRef.current === "fixtures" ? null : releaseIdRef.current;
    if (place.releaseId && place.releaseId !== activeRelease) {
      setDeepLinkMessage(`Saved place ${place.label} belongs to immutable release ${place.releaseId}; the active release is ${activeRelease ?? "fixture mode"}.`);
      return;
    }
    const feature = activeAdapter.getFeature(place.canonicalId);
    if (feature) { selectFeature(feature); return; }
    const composed = composedAdapterRef.current;
    if (civicModeRef.current && composed) {
      void composed.loadDetail(place.canonicalId).then((detail) => {
        if (detail && composedAdapterRef.current === composed && civicModeRef.current) selectFeature(detail);
        else setDeepLinkMessage(`Saved civic place ${place.label} is not present in release ${TRAVEL_CONTEXT_RELEASE_ID}; no substitute record was selected.`);
      }).catch(() => setDeepLinkMessage(`Saved civic place ${place.label} could not be loaded from release ${TRAVEL_CONTEXT_RELEASE_ID}; no substitute record was selected.`));
      return;
    }
    setDeepLinkMessage(`Saved place ${place.label} is not present in the active release; no substitute record was selected.`);
  };
  const restoreJourney = (journey: SavedNavigationState["journeys"][number]) => { setRouteOriginId(journey.originFeatureId); setRouteDestinationId(journey.destinationFeatureId); setRouteOriginQuery(activeAdapter.getFeature(journey.originFeatureId)?.name ?? ""); setRouteDestinationQuery(activeAdapter.getFeature(journey.destinationFeatureId)?.name ?? ""); setRouteMode(journey.mode); setItinerary(null); setRouteMessage("Saved journey restored; calculate to preview the synthetic route."); };
  const switchDataMode = (nextMode: NavigationDataMode) => {
    initialRealNavigationPendingRef.current = false;
    terminalRealFallbackNoticeRef.current = null;
    if (nextMode === "civic-context") {
      if (!composedAdapter || compositionLoadState !== "ready") {
        setRealFallbackActive(true);
        setActiveSelectionId(null);
        setFocusFeatureId(null);
        setInspectorOpen(false);
        setDeepLinkMessage(civicLoadState === "failed" || compositionLoadState === "failed"
          ? "The approved civic-context composition failed to load or validate; fixture fallback remains active."
          : "The approved civic-context release is still loading; fixture fallback remains active.");
        return;
      }
      dataModeRef.current = "civic-context";
      releaseIdRef.current = TRAVEL_CONTEXT_RELEASE_ID;
      setRealFallbackActive(false);
      setDataMode("civic-context");
      setActiveAdapter(composedAdapter);
      setSelectedCatalogEntityId(null);
      const civicFeaturesNow = composedAdapter.getContextFeatures();
      const queryMatch = queryRef.current.trim() ? composedAdapter.search(queryRef.current, selectedCivicFacets)[0] : undefined;
      const firstCivicFeature = queryMatch ?? civicFeaturesNow[0] ?? composedAdapter.getBaseFeatures()[0];
      if (firstCivicFeature) selectFeature(firstCivicFeature);
      else {
        setActiveSelectionId(null); setFocusFeatureId(null); setInspectorOpen(false);
        if (typeof window !== "undefined") window.history.replaceState({}, "", navigationUrlForApp({ featureId: null, query: queryRef.current, cameraMode: cameraModeRef.current, pose: cameraPoseRef.current, poseInvalid: false, dataMode: "civic-context", releaseId: TRAVEL_CONTEXT_RELEASE_ID, visibleLayers: Object.entries(layerVisibility).filter(([, visible]) => visible).map(([layer]) => layer), facets: selectedCivicFacets, ...getOverlayUrlFields() }, window.location.href));
      }
      return;
    }
    if (nextMode === "real-pilot") {
      if (!realAdapter) {
        setRealFallbackActive(true);
        setActiveSelectionId(null);
        setFocusFeatureId(null);
        setInspectorOpen(false);
        setDeepLinkMessage(realLoadState === "failed"
          ? "The approved real pilot release failed to load or validate; fixture fallback remains active."
          : "The approved real pilot release is still loading; fixture fallback remains active.");
        return;
      }
      dataModeRef.current = "real-pilot";
      releaseIdRef.current = REAL_PILOT_RELEASE_ID;
      setRealFallbackActive(false);
      setDataMode("real-pilot");
      setActiveAdapter(realAdapter);
      setSelectedCatalogEntityId(null);
      const realFeatures = realAdapter.getFeatures();
      const queryMatch = queryRef.current.trim() ? searchRealPlaceCatalog(realFeatures, queryRef.current)[0]?.feature : undefined;
      const firstRealFeature = queryMatch ?? realFeatures.find((feature) => feature.kind === "poi") ?? realFeatures[0];
      if (firstRealFeature) selectFeature(firstRealFeature);
      return;
    }
    dataModeRef.current = "fixtures";
    releaseIdRef.current = null;
    setRealFallbackActive(false);
    setDataMode("fixtures");
    setActiveAdapter(fixtureAdapter);
    const fixture = fixtureAdapter.getFeature(runtimeMarker.id);
    if (fixture) selectFeature(fixture);
  };
  const switchCitywideMode = () => {
    initialRealNavigationPendingRef.current = false;
    terminalRealFallbackNoticeRef.current = null;
    if (!citywideAdapter || citywideLoadState !== "ready") {
      setRealFallbackActive(true);
      setActiveSelectionId(null);
      setFocusFeatureId(null);
      setInspectorOpen(false);
      setDeepLinkMessage(citywideLoadState === "failed"
        ? "The approved citywide release failed to load or validate; fixture fallback remains active."
        : "The approved citywide release is still loading; fixture fallback remains active.");
      return;
    }
    dataModeRef.current = "real-pilot";
    releaseIdRef.current = CITYWIDE_RELEASE_ID;
    setDataMode("real-pilot");
    setActiveAdapter(citywideAdapter);
    setRealFallbackActive(false);
    setSelectedCatalogEntityId(null);
    setActiveSelectionId(null);
    setFocusFeatureId(null);
    setInspectorOpen(false);
    setDeepLinkMessage(null);
    if (typeof window !== "undefined") window.history.replaceState({}, "", navigationUrlForApp({ featureId: null, query: queryRef.current, cameraMode: cameraModeRef.current, pose: cameraPoseRef.current, poseInvalid: false, dataMode: "real-pilot", releaseId: CITYWIDE_RELEASE_ID, visibleLayers: Object.entries(layerVisibility).filter(([, visible]) => visible).map(([layer]) => layer), facets: selectedCategories, ...getOverlayUrlFields() }, window.location.href));
  };

  const switchCivicMode = () => switchDataMode("civic-context");

  const measureCitywideDebugAnchor = (anchor: (typeof CITYWIDE_DEBUG_ANCHORS)[number]) => {
    if (!citywideMode) return;
    const pose: CameraPose = { longitude: anchor.longitude, latitude: anchor.latitude, height: 1_200, heading: 0, pitch: -45, roll: 0 };
    const runId = ++citywideDebugMeasurementRunRef.current;
    setCitywideDebugMeasurement({ ...EMPTY_CITYWIDE_DEBUG_MEASUREMENT, anchor: anchor.label, status: "settling" });
    setCameraPose(pose);
    setCameraRequest((current) => ({ ...pose, requestId: (current?.requestId ?? 0) + 1 }));
    window.setTimeout(() => {
      if (runId !== citywideDebugMeasurementRunRef.current || !citywideModeRef.current) return;
      setCitywideDebugMeasurement((current) => ({ ...current, status: "measuring" }));
      const frameIntervals: number[] = [];
      let previous = performance.now();
      const started = previous;
      const sampleFrame = (now: number) => {
        if (runId !== citywideDebugMeasurementRunRef.current || !citywideModeRef.current) return;
        frameIntervals.push(now - previous);
        previous = now;
        if (now - started < 10_000) {
          window.requestAnimationFrame(sampleFrame);
          return;
        }
        const sorted = [...frameIntervals].sort((left, right) => left - right);
        const browserMeasurement = readCitywideBrowserMeasurement();
        setCitywideDebugMeasurement((current) => ({
          ...current,
          status: "complete",
          frameCount: frameIntervals.length,
          frameAverageMs: frameIntervals.length > 0 ? frameIntervals.reduce((sum, value) => sum + value, 0) / frameIntervals.length : null,
          frameMedianMs: medianFrameInterval(sorted),
          frameP95Ms: sorted.length > 0 ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? null : null,
          frameMaxMs: sorted.at(-1) ?? null,
          heapBytes: browserMeasurement.heapBytes,
          citywideResourceCount: browserMeasurement.citywideResourceCount,
          citywideResourceBytes: browserMeasurement.citywideResourceBytes,
        }));
      };
      window.requestAnimationFrame(sampleFrame);
    }, 3_000);
  };

  const captureCitywideBrowserBaseline = () => {
    if (typeof window === "undefined" || citywideMode) return;
    setCitywideBrowserBaseline(readCitywideBrowserMeasurement());
  };

  const disablePublicRealm = () => {
    const wasPublicRealmSelection = activeSelectionRef.current?.startsWith("public-realm:") ?? false;
    publicRealmRequestedRef.current = false;
    selectedPublicRealmIdRef.current = null;
    setPublicRealmRequested(false);
    setSelectedPublicRealmId(null);
    setPublicRealmOverlay(null);
    setPublicRealmLoadState("idle");
    setPublicRealmMessage("");
    if (wasPublicRealmSelection) {
      activeSelectionRef.current = null;
      setActiveSelectionId(null);
      setSelectedFeature(runtimeMarker);
      setSelectedCatalogEntityId(null);
      setFocusFeatureId(null);
      setInspectorOpen(false);
    }
    if (typeof window !== "undefined") window.history.replaceState({}, "", navigationUrlForApp({ featureId: wasPublicRealmSelection ? null : activeSelectionRef.current, query: queryRef.current, cameraMode: cameraModeRef.current, pose: cameraPoseRef.current, poseInvalid: false, dataMode: dataModeRef.current, releaseId: releaseIdRef.current, visibleLayers: Object.entries(layerVisibilityRef.current).filter(([, visible]) => visible).map(([layer]) => layer), facets: civicModeRef.current ? selectedCivicFacetsRef.current : selectedCategoriesRef.current, ...getOverlayUrlFields() }, window.location.href));
  };

  /**
   * The profile is a rendering choice only: the selected feature, its details,
   * its provenance, and the pinned release origin are untouched, and only the
   * `exteriorProfile` URL parameter changes.
   */
  const switchExteriorProfile = (nextProfile: ExteriorRenderProfile) => {
    if (nextProfile === exteriorProfileRef.current) return;
    exteriorProfileRef.current = nextProfile;
    setExteriorProfile(nextProfile);
    if (typeof window !== "undefined") window.history.replaceState({}, "", navigationUrlForApp({ featureId: activeSelectionRef.current, query: queryRef.current, cameraMode: cameraModeRef.current, pose: cameraPoseRef.current, poseInvalid: false, dataMode: dataModeRef.current, releaseId: releaseIdRef.current, visibleLayers: Object.entries(layerVisibilityRef.current).filter(([, visible]) => visible).map(([layer]) => layer), facets: civicModeRef.current ? selectedCivicFacetsRef.current : selectedCategoriesRef.current, ...getOverlayUrlFields() }, window.location.href));
  };

  /** A canary is always an explicit opt-in and never becomes the default head. */
  const switchExteriorCanary = (snapshotId: string | null) => {
    if (snapshotId === exteriorCanarySnapshotIdRef.current) return;
    exteriorCanarySnapshotIdRef.current = snapshotId;
    setExteriorCanarySnapshotId(snapshotId);
    // Selecting a canary pins the release explicitly, so the shared link names
    // both the release and the alternate head it was taken against.
    if (snapshotId) {
      exteriorStreamingOverrideRef.current = "on";
      exteriorExplicitReleaseIdRef.current = exteriorCellReleaseIdRef.current;
      setExteriorStreamingOverride("on");
      setExteriorExplicitReleaseId(exteriorCellReleaseIdRef.current);
    }
    if (typeof window !== "undefined") window.history.replaceState({}, "", navigationUrlForApp({ featureId: activeSelectionRef.current, query: queryRef.current, cameraMode: cameraModeRef.current, pose: cameraPoseRef.current, poseInvalid: false, dataMode: dataModeRef.current, releaseId: releaseIdRef.current, visibleLayers: Object.entries(layerVisibilityRef.current).filter(([, visible]) => visible).map(([layer]) => layer), facets: civicModeRef.current ? selectedCivicFacetsRef.current : selectedCategoriesRef.current, ...getOverlayUrlFields() }, window.location.href));
  };

  /**
   * The toggle writes explicit intent in both directions. Disabling clears the
   * explicit release too, so re-enabling over a real base targets whatever this
   * build promotes rather than resurrecting a release the URL no longer names.
   *
   * Re-enabling in a session the promotion record itself would turn on returns
   * to the *unqualified* default — no override, no explicit release — rather
   * than pinning the promoted release as an explicit opt-in. Pinning it made a
   * default-on session serialize a release id it never asked for, and (before
   * the resolver also gated explicitly-named promoted releases) skipped both
   * promotion gates for the rest of that session. Fixture-mode and genuinely
   * explicit release sessions keep pinning their release as before.
   */
  const toggleExteriorStreaming = () => {
    const next = !exteriorStreamingRequestedRef.current;
    const backToPromotedDefault = next && restoresPromotedDefault({
      targetReleaseId: exteriorCellReleaseIdRef.current,
      activeRealBaseReleaseId: activeRealBaseReleaseIdRef.current,
      record: exteriorActivationRecordsRef.current,
    });
    const nextOverride: ExteriorStreamingOverride = !next ? "off" : backToPromotedDefault ? null : "on";
    exteriorStreamingRequestedRef.current = next;
    exteriorStreamingOverrideRef.current = nextOverride;
    setExteriorStreamingOverride(nextOverride);
    if (next && !backToPromotedDefault) {
      exteriorExplicitReleaseIdRef.current = exteriorCellReleaseIdRef.current;
      setExteriorExplicitReleaseId(exteriorCellReleaseIdRef.current);
    } else if (next) {
      exteriorExplicitReleaseIdRef.current = null;
      setExteriorExplicitReleaseId(null);
    } else {
      exteriorExplicitReleaseIdRef.current = null;
      exteriorCanarySnapshotIdRef.current = null;
      setExteriorExplicitReleaseId(null);
      setExteriorCanarySnapshotId(null);
    }
    if (typeof window !== "undefined") window.history.replaceState({}, "", navigationUrlForApp({ featureId: activeSelectionRef.current, query: queryRef.current, cameraMode: cameraModeRef.current, pose: cameraPoseRef.current, poseInvalid: false, dataMode: dataModeRef.current, releaseId: releaseIdRef.current, visibleLayers: Object.entries(layerVisibilityRef.current).filter(([, visible]) => visible).map(([layer]) => layer), facets: civicModeRef.current ? selectedCivicFacetsRef.current : selectedCategoriesRef.current, ...getOverlayUrlFields() }, window.location.href));
  };

  const displayedTileMetrics: TileStreamMetrics = civicMode ? {
    generation: 0,
    selectedLod: TRAVEL_CONTEXT_TILE_LEVEL,
    visibleTileCount: composedMetrics.base.visibleShardCount + composedMetrics.context.visibleShardCount,
    requestedTileCount: composedMetrics.aggregate.requestedShardCount,
    loadedTileCount: composedMetrics.aggregate.cacheEntries,
    evictedTileCount: composedMetrics.aggregate.cacheEvictions,
    failedTileCount: composedMetrics.aggregate.failedRequestCount,
    loadedBytes: composedMetrics.aggregate.cachedBytes,
    activeRequests: composedMetrics.aggregate.activeRequests,
    maxConcurrentRequests: composedMetrics.aggregate.maxConcurrentRequests,
    deduplicatedRequests: 0,
    cancelledRequestCount: composedMetrics.aggregate.cancelledRequestCount,
    staleResultCount: composedMetrics.aggregate.staleResultCount,
    renderedFeatureCount: composedMetrics.render.contextFeatureCount + composedMetrics.render.baseFeatureCount,
  } : citywideMode ? {
    generation: 0,
    selectedLod: 14,
    visibleTileCount: citywideMetrics.visibleShardCount,
    requestedTileCount: citywideMetrics.requestedShardCount,
    loadedTileCount: citywideMetrics.cacheEntries,
    evictedTileCount: citywideMetrics.cacheEvictions,
    failedTileCount: citywideMetrics.failedRequestCount,
    loadedBytes: citywideMetrics.loadedBytes,
    activeRequests: citywideMetrics.activeRequests,
    maxConcurrentRequests: citywideMetrics.maxConcurrentRequests,
    deduplicatedRequests: 0,
    cancelledRequestCount: citywideMetrics.cancelledRequestCount,
    staleResultCount: citywideMetrics.staleResultCount,
    renderedFeatureCount: citywideMetrics.loadedFeatureCount,
  } : tileMetrics;
  const layerControlIds = useMemo<RuntimeLayerId[]>(() => civicMode
    ? ["buildings", "pois", "statistical-areas", "parks", "landmarks"]
    : Object.keys(LAYER_LABELS) as RuntimeLayerId[], [civicMode]);

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div className="brand" aria-label="Urban Digital Twin home">
          <span className="brand-mark" aria-hidden="true">
            UDT
          </span>
          <span>Urban Digital Twin</span>
        </div>
        <div className="search-shell">
          <form className="search" onSubmit={submitSearch} role="search">
            <Search aria-hidden="true" size={18} />
            <input
              aria-activedescendant={activeSearchIndex >= 0 ? `search-result-${activeSearchIndex}` : undefined}
              aria-autocomplete="list"
              aria-controls="unified-search-results"
              aria-expanded={searchOpen && query.length > 0}
              aria-label="Search Manhattan"
              onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); setActiveSearchIndex(-1); }}
              onFocus={() => setSearchOpen(query.length > 0)}
              onKeyDown={onSearchKeyDown}
              placeholder={dataMode === "fixtures" ? "Search buildings, places, areas, transit" : "Search buildings, places, areas"}
              role="combobox"
              ref={searchInputRef}
              value={query}
            />
          </form>
          {searchOpen && query.length > 0 && (
            <div className="search-results" id="unified-search-results" role="listbox" aria-label="Search results">
              {unifiedResults.length > 0 ? unifiedResults.slice(0, 8).map((result, index) => (
                <button className={index === activeSearchIndex ? "search-result is-active" : "search-result"} id={`search-result-${index}`} key={result.feature.id} onClick={() => selectSearchResult(result)} role="option" aria-selected={index === activeSearchIndex} type="button">
                  <span className="search-result-icon" aria-hidden="true">{result.typeLabel.slice(0, 1)}</span>
                  <span><strong>{result.feature.name}</strong><small>{result.typeLabel} · {result.group} · {result.matchedBy}</small></span>
                </button>
              )) : <p className="search-empty" role="status">{civicMode ? `The composed view (${TRAVEL_CONTEXT_RELEASE_ID} over ${CITYWIDE_RELEASE_ID}) has no result for “${query}”; this does not mean Manhattan has no such record.` : citywideMode ? `The active citywide release ${CITYWIDE_RELEASE_ID} has no result for “${query}”; this does not mean Manhattan has no such place.` : dataMode === "real-pilot" ? `The active bounded real pilot release ${REAL_PILOT_RELEASE_ID} has no result for “${query}”; this does not mean Manhattan has no such place.` : `No fixture result for “${query}”. Try a source ID, alias, address, or category.`}</p>}
            </div>
          )}
        </div>
        <div className="top-actions">
          <button type="button" onClick={() => { setQualityOpen((open) => !open); setLayersOpen(false); setDiagnosticsOpen(false); setDirectionsOpen(false); }}><Database size={18} />Data</button>
          <button type="button"><Clock3 size={18} />Time</button>
        </div>
      </header>

      <nav className="navigation-rail" aria-label="Primary navigation">
        <div>
          {navigation.map(({ label, icon: Icon }) => (
            <button
              className={activeNavigation === label ? "is-active" : ""}
              key={label}
              onClick={() => setActiveNavigation(label)}
              type="button"
            >
              <Icon aria-hidden="true" size={22} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div>
          <button type="button" aria-pressed={helpOpen} onClick={() => { setHelpOpen((open) => !open); setSettingsOpen(false); }}><HelpCircle size={21} /><span>Help</span></button>
          <button type="button" aria-pressed={settingsOpen} onClick={() => { setSettingsOpen((open) => !open); setHelpOpen(false); }}><Settings size={21} /><span>Settings</span></button>
        </div>
      </nav>

      <section className={`map-region${inspectorOpen ? " inspector-open" : ""}`} aria-label="City explorer" data-overlay-policy="map-with-inspector-overlay">
        <CesiumViewport
          adapter={activeAdapter}
          assetResolver={exteriorActive && exteriorOverlay ? exteriorOverlay.resolver : activeAdapter.assetResolver}
          focusRequest={focusRequest}
          focusFeatureId={focusFeatureId}
          focusOverlayOpen={inspectorOpen}
          onFeatureSelected={selectFeature}
          commercialOverlay={exteriorActive && exteriorOverlay ? exteriorOverlay : null}
          onStorefrontSelected={selectStorefront}
          publicRealmOverlay={publicRealmActive && publicRealmOverlay ? publicRealmOverlay : null}
          onPublicRealmSelected={(feature) => selectPublicRealm(feature)}
          exteriorOverlay={exteriorCellOverlays}
          onExteriorUnanchored={setExteriorUnanchoredIds}
          onStage3RenderProof={stage3RenderProofRequested ? setStage3RenderProof : undefined}
          onFeatureOverlap={selectOverlapFeatures}
          featureFilter={featureFilter}
          visibleLayers={layerVisibility}
          itinerary={routeLines}
          previewRequest={previewRequest}
          denseRendering={stressMode || dataMode === "real-pilot" || dataMode === "civic-context"}
          denseFeatures={citywideMode ? citywideFeatures : civicMode ? civicFeatures : stressFeatures}
          denseFeatureLimit={citywideMode ? CITYWIDE_BUDGETS.maxRenderedDenseFeatures : undefined}
          denseFeatureGroups={composedDenseGroups}
          denseFeatureGroupLimits={composedDenseGroupLimits}
          onDenseMetrics={citywideMode || civicMode ? publishCitywideDenseMetrics : undefined}
          selectedFeatureId={dataMode === "fixtures" ? activeSelectionId ?? selectedFeature.id : activeSelectionId}
          onCameraChanged={onTileCameraChanged}
          viewportFootprint={viewportFootprint}
          cameraRequest={stressCameraRequest}
          cameraPoseRequest={cameraRequest}
          onViewportKeyDown={onViewportKeyDown}
        />
        <section className="camera-controls" aria-label="Camera controls">
          <span>Camera</span>
          <button type="button" className={cameraMode === "overview" ? "is-selected" : ""} aria-pressed={cameraMode === "overview"} onClick={() => updateCamera(DEFAULT_CAMERA_POSE, "overview")}>Overview</button>
          <button type="button" className={cameraMode === "explore" ? "is-selected" : ""} aria-pressed={cameraMode === "explore"} onClick={() => updateCamera({ height: 700, pitch: -35 }, "explore")}>Explore</button>
          <button type="button" onClick={() => updateCamera({ heading: 0 })}>North</button>
          <button type="button" onClick={() => updateCamera(DEFAULT_CAMERA_POSE, "overview")}>Reset</button>
          <button type="button" onClick={focusCurrentSelection}>Current selection</button>
          <small>Keyboard arrows move only when this 3D viewport is focused; no street-level imagery or live navigation.</small>
          {poseInvalid && <small role="status">Malformed camera pose ignored; safe bounded view is active.</small>}
        </section>
        {overlapFeatures.length > 1 && <section className="overlap-chooser" aria-label="Overlapping feature choices" role="dialog">
          <strong>Overlapping records</strong>
          <p className="section-label">Choose a source record; ordering is deterministic and no hidden first hit is selected.</p>
          <div role="listbox" aria-label="Overlap candidates">
            {overlapFeatures.map((feature) => <button key={feature.id} type="button" role="option" onClick={() => selectFeature(feature)}>{feature.name}<small>{feature.attributes.civicTypeLabel?.toString() ?? feature.kind} · {feature.id}</small></button>)}
          </div>
          <button type="button" onClick={() => setOverlapFeatures([])}>Close choices</button>
        </section>}
        <div
          className="runtime-note"
          aria-label={publicRealmActive ? "Block 835 public-realm overlay status" : exteriorActive ? "Block 835 exterior commercial overlay status" : "Local runtime layer"}
          data-overlay-status={publicRealmRequested ? publicRealmLoadState : exteriorRequested ? exteriorLoadState : undefined}
        >
          {publicRealmActive ? <strong title={publicRealmStatusMessage}>Block 835 · public realm · 4 semantic classes · 4 intersections</strong> : exteriorActive ? <strong title={exteriorMessage}>Block 835 · 14 buildings · {exteriorOverlay?.diagnostics.acceptedStorefronts ?? 0} signs</strong> : <strong>Local runtime layer</strong>}
          {!exteriorRequested && <span>{civicMode ? `Real NYC civic-context release · ${TRAVEL_CONTEXT_RELEASE_ID} over base ${CITYWIDE_RELEASE_ID} · local snapshot-relative coverage` : citywideMode ? `Real NYC citywide release · ${CITYWIDE_RELEASE_ID} · local snapshot-relative coverage` : dataMode === "real-pilot" ? "Real NYC pilot · bounded Flatiron/NoMad/Union Square coverage" : "Synthetic fixture only · no real Manhattan coverage"}</span>}
          {exteriorRequested && !exteriorActive && <span className="runtime-note-overlay" role="status">{exteriorLoadState === "loading" ? "Block 835 overlay · loading local release…" : exteriorMessage || "Block 835 overlay unavailable; base release remains active."}</span>}
          {publicRealmActive && <span className="runtime-note-overlay" role="status">NYC OTI Planimetrics local snapshot · curb profile and crosswalk striping are estimated, source-constrained, and not survey/current-paint truth.</span>}
          {publicRealmRequested && !publicRealmActive && <span className="runtime-note-overlay" role="status">{publicRealmLoadState === "loading" ? "Block 835 public realm · loading local release…" : publicRealmStatusMessage || "Block 835 public realm unavailable; the existing base/exterior state was left unchanged."}</span>}
          {publicRealmRequested && <button type="button" onClick={disablePublicRealm}>Disable public realm</button>}
          <div className="exterior-streaming-controls" role="group" aria-label="Exterior streaming and render profile">
            <button type="button" aria-pressed={exteriorStreamingRequested} onClick={toggleExteriorStreaming}>{exteriorStreamingRequested ? "Disable exterior streaming" : "Enable exterior streaming"}</button>
            {EXTERIOR_RENDER_PROFILES.map((profile) => (
              <button
                key={profile}
                type="button"
                aria-pressed={exteriorProfile === profile}
                disabled={!exteriorStreamingActive}
                title={exteriorRenderProfileLabel(profile)}
                onClick={() => switchExteriorProfile(profile)}
              >{profile === "inspection" ? "Inspection profile" : "Exploration profile"}</button>
            ))}
            {exteriorStreamingRequested && exteriorPrimaryRuntime && exteriorPrimaryRuntime.index.canaryHeads.map((canary) => (
              <button
                key={canary.snapshotId}
                data-exterior-canary={canary.snapshotId}
                type="button"
                aria-pressed={exteriorCanarySnapshotId === canary.snapshotId}
                disabled={!exteriorStreamingActive}
                onClick={() => switchExteriorCanary(exteriorCanarySnapshotId === canary.snapshotId ? null : canary.snapshotId)}
              >{exteriorCanarySnapshotId === canary.snapshotId ? `Leave canary ${canary.snapshotId}` : `Try canary ${canary.snapshotId}`}</button>
            ))}
          </div>
          {/* One status line per wave: a session streaming two waves must not
              report one wave's snapshot as if it covered the other. */}
          {exteriorActiveWaves.map((entry) => entry.wave.runtime && <span key={entry.target.releaseId} className="runtime-note-overlay" data-exterior-release={entry.target.releaseId} data-exterior-snapshot-origin={entry.wave.runtime.origin} role="status">Exterior streaming · {exteriorSnapshotOriginLabel(entry.wave.runtime.origin, entry.wave.runtime.snapshot.snapshotId)} · {exteriorRenderProfileLabel(exteriorProfile)} · verified local GLB bytes only.</span>)}
          {exteriorWaveActivations.filter((entry) => !entry.activation.active).map((entry) => <span key={entry.target.releaseId} className="runtime-note-overlay" data-exterior-release={entry.target.releaseId} role="status">{entry.wave.loadState === "loading" ? "Exterior streaming · loading local release…" : (entry.activation.prerequisiteMessage ?? entry.wave.message) || "Exterior streaming unavailable; the existing base state was left unchanged."}</span>)}
          {exteriorActive && <a className="runtime-note-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">Map data © OpenStreetMap contributors.</a>}
        </div>
        {stage3RenderProofRequested && <output data-stage3-render-proof-summary role="status">{stage3RenderProof
          ? `Stage 3 renderer proof: ${stage3RenderProof.activeBuildingCount}/${stage3RenderProof.expectedBuildingCount} active GLB model entities; ${stage3RenderProof.activeStorefrontCount}/${stage3RenderProof.expectedStorefrontCount} active storefront proxies; ${stage3RenderProof.pass ? "pass" : "not yet complete"}.`
          : "Stage 3 renderer proof is waiting for the live Cesium entities."}</output>}
        {block835PerformanceMode && <output
          data-block835-performance-probe
          role="status"
          style={{ position: "fixed", zIndex: 100, right: 8, bottom: 8, maxWidth: "min(960px, calc(100vw - 16px))", maxHeight: "40vh", overflow: "auto", overflowWrap: "anywhere", whiteSpace: "pre-wrap", padding: 8, background: "rgba(13, 21, 27, 0.94)", color: "#d5ffff", font: "11px ui-monospace, SFMono-Regular, Menlo, monospace" }}
        >{block835PerformanceProbe ? JSON.stringify(block835PerformanceProbe) : "Block 835 performance probe is initializing."}</output>}
        {block835CanaryMode && <output
          data-block835-canary-probe
          role="status"
          style={{ position: "fixed", zIndex: 100, left: 8, bottom: 8, maxWidth: "min(960px, calc(100vw - 16px))", maxHeight: "40vh", overflow: "auto", overflowWrap: "anywhere", whiteSpace: "pre-wrap", padding: 8, background: "rgba(13, 21, 27, 0.94)", color: "#d5ffff", font: "11px ui-monospace, SFMono-Regular, Menlo, monospace" }}
        >{block835CanaryProbe ? JSON.stringify(block835CanaryProbe) : "Block 835 canary probe is initializing."}</output>}
        {deepLinkMessage && <div className="exploration-notice" role="alert">{deepLinkMessage} <button type="button" onClick={() => { terminalRealFallbackNoticeRef.current = null; setDeepLinkMessage(null); setPoseInvalid(false); window.history.replaceState({}, "", navigationUrlForApp({ featureId: activeSelectionRef.current, query, cameraMode, pose: cameraPose, poseInvalid: false, dataMode: dataModeRef.current, releaseId: releaseIdRef.current, visibleLayers: Object.entries(layerVisibility).filter(([, visible]) => visible).map(([layer]) => layer), facets: civicMode ? selectedCivicFacets : selectedCategories, ...getOverlayUrlFields() }, window.location.href)); }}>Dismiss</button></div>}
        {exteriorDeepLinkNotice && <div className="exploration-notice" role="alert" data-exterior-deep-link-notice>
          {exteriorDeepLinkNotice} <button type="button" onClick={() => setExteriorDeepLinkNotice(null)}>Dismiss</button>
        </div>}
        {exteriorNotices.length > 0 && <div className="exploration-notice" role="alert" data-exterior-notices={exteriorNotices.length}>
          <strong>Exterior streaming fallback</strong>
          <ul>{exteriorNotices.map((entry) => <li key={`${entry.releaseId}|${entry.notice}`}>{entry.notice}</li>)}</ul>
        </div>}
        {shareMessage && <div className="share-notice" role="status">{shareMessage}</div>}
        <section className={`tile-diagnostics ${diagnosticsOpen ? "is-open" : "is-collapsed"}`} aria-label="Tile diagnostics">
          <button className="overlay-launcher" type="button" aria-expanded={diagnosticsOpen} onClick={() => { setDiagnosticsOpen((open) => !open); setDirectionsOpen(false); setLayersOpen(false); }}><strong>Diagnostics</strong><span>{diagnosticsOpen ? "Collapse" : "Runtime health"}</span></button>
          {diagnosticsOpen && <div className="tile-diagnostics-content">
          <div><strong>Tile diagnostics</strong><button type="button" aria-pressed={stressMode} onClick={() => setStressMode((enabled) => !enabled)}>{stressMode ? "Normal mode" : "Stress harness"}</button></div>
          <span>{civicMode ? `Composed ${TRAVEL_CONTEXT_RELEASE_ID} over ${CITYWIDE_RELEASE_ID} · one aggregate streaming budget · search/detail shards remain on demand` : citywideMode ? "Citywide viewport shards loaded lazily · global search/detail shards remain on demand" : dataMode === "real-pilot" ? "Partitioned real pilot loaded · not full-Manhattan performance" : "Fixture-only synthetic harness · not full-Manhattan performance"}</span>
          {civicMode && <span>Aggregate cache / bytes / active / evictions: {composedMetrics.aggregate.cacheEntries.toLocaleString()} / {composedMetrics.aggregate.cachedBytes.toLocaleString()} / {composedMetrics.aggregate.activeRequests} / {composedMetrics.aggregate.cacheEvictions} · max 24 / 50,331,648 / 4</span>}
          {civicMode && <span>Base/context decoded summaries: {composedMetrics.base.retainedSummaryCount.toLocaleString()} / {composedMetrics.context.retainedSummaryCount.toLocaleString()} · render groups: {citywideDenseMetrics.baseFeatureCount?.toLocaleString() ?? "0"} / {citywideDenseMetrics.contextPartCount?.toLocaleString() ?? "0"} (caps 6,000 / 128 parts)</span>}
          {civicMode && (composedMetrics.failedRoles.length > 0 || composedMetrics.context.failedLayers.length > 0) && <span role="status">Degraded layers isolated: {[...composedMetrics.failedRoles, ...composedMetrics.context.failedLayers].join(", ")}</span>}
          {citywideMode && <span>Decoded summaries / features / details: {citywideMetrics.retainedSummaryCount.toLocaleString()} / {citywideMetrics.retainedFeatureCount.toLocaleString()} / {citywideMetrics.retainedDetailCount.toLocaleString()} · detail index: {citywideMetrics.detailIndexEntryCount.toLocaleString()}</span>}
          <span>Assets: {activeAdapter.getAssetDiagnostics?.().registered ?? 0} registered · {activeAdapter.getAssetDiagnostics?.().approved ?? 0} approved · {activeAdapter.getAssetDiagnostics?.().verified ?? 0} verified · procedural fallback retained when unavailable</span>
          {import.meta.env.DEV && citywideMode && <div className="citywide-debug-baseline" aria-label="Citywide browser baseline">
            <button type="button" onClick={captureCitywideBrowserBaseline}>Capture Citywide browser baseline</button>
            <span data-citywide-browser-baseline>Heap {citywideBrowserBaseline.heapBytes?.toLocaleString() ?? "unsupported"} · citywide resources {citywideBrowserBaseline.citywideResourceCount} / {citywideBrowserBaseline.citywideResourceBytes.toLocaleString()} bytes</span>
          </div>}
          {stressMode ? <div className="tile-stress-controls" aria-label="Synthetic camera anchors">
            <button type="button" onClick={() => moveStressCamera(0, 4_000)}>Center tile</button>
            <button type="button" onClick={() => moveStressCamera(1, 4_000)}>West tile</button>
            <button type="button" onClick={() => moveStressCamera(2, 4_000)}>North tile</button>
            <button type="button" onClick={() => moveStressCamera(2, 100)}>Zoom closer</button>
          </div> : null}
          <dl>
            <div><dt>LOD</dt><dd>{displayedTileMetrics.selectedLod ?? "—"}</dd></div>
            <div><dt>Visible / requested</dt><dd>{displayedTileMetrics.visibleTileCount} / {displayedTileMetrics.requestedTileCount}</dd></div>
            <div><dt>Loaded / evicted</dt><dd>{displayedTileMetrics.loadedTileCount} / {displayedTileMetrics.evictedTileCount}</dd></div>
            <div><dt>Failed / active</dt><dd>{displayedTileMetrics.failedTileCount} / {displayedTileMetrics.activeRequests}</dd></div>
            <div><dt>Cancelled / stale</dt><dd>{displayedTileMetrics.cancelledRequestCount} / {displayedTileMetrics.staleResultCount}</dd></div>
            <div><dt>Bytes / features</dt><dd>{displayedTileMetrics.loadedBytes.toLocaleString()} / {citywideMode ? citywideDenseMetrics.featureCount : displayedTileMetrics.renderedFeatureCount}</dd></div>
          </dl>
          {import.meta.env.DEV && citywideMode && <div className="citywide-debug-anchors" aria-label="Citywide debug anchors">
            {CITYWIDE_DEBUG_ANCHORS.map((anchor) => <button key={anchor.label} type="button" onClick={() => measureCitywideDebugAnchor(anchor)}>Debug {anchor.label}</button>)}
            <span data-citywide-render-metrics>Rendered dense features / instances / primitives: {citywideDenseMetrics.featureCount} / {citywideDenseMetrics.instanceCount} / {citywideDenseMetrics.primitiveCount}</span>
            <span data-citywide-dense-build-metrics>Dense plans build / reuse / cancelled / swapped: {citywideDenseMetrics.planBuildCount ?? 0} / {citywideDenseMetrics.planReuseCount ?? 0} / {citywideDenseMetrics.planCancellationCount ?? 0} / {citywideDenseMetrics.planSwapCount ?? 0} · fingerprint {citywideDenseMetrics.planFingerprint || "pending"} · select / key / allocation / max slice / worker-ready / total: {formatDenseTiming(citywideDenseMetrics.selectionMs)} / {formatDenseTiming(citywideDenseMetrics.keyMs)} / {formatDenseTiming(citywideDenseMetrics.allocationMs)} / {formatDenseTiming(citywideDenseMetrics.allocationMaxSliceMs)} / {formatDenseTiming(citywideDenseMetrics.workerReadyMs)} / {formatDenseTiming(citywideDenseMetrics.totalBuildMs)} ms · allocation chunks {citywideDenseMetrics.allocationChunkCount ?? 0}</span>
            <span data-citywide-browser-baseline>Pre-citywide initial-mount baseline heap {citywideBrowserBaseline.heapBytes?.toLocaleString() ?? "unsupported"} · citywide resources {citywideBrowserBaseline.citywideResourceCount} / {citywideBrowserBaseline.citywideResourceBytes.toLocaleString()} bytes</span>
            {citywideDebugMeasurement.status !== "idle" && <span data-citywide-debug-measurement role="status">Debug {citywideDebugMeasurement.anchor} · {citywideDebugMeasurement.status} · frames {citywideDebugMeasurement.frameCount} · avg/median/p95/max {citywideDebugMeasurement.frameAverageMs?.toFixed(2) ?? "unsupported"}/{citywideDebugMeasurement.frameMedianMs?.toFixed(2) ?? "unsupported"}/{citywideDebugMeasurement.frameP95Ms?.toFixed(2) ?? "unsupported"}/{citywideDebugMeasurement.frameMaxMs?.toFixed(2) ?? "unsupported"} ms · heap {citywideDebugMeasurement.heapBytes?.toLocaleString() ?? "unsupported"} · citywide resources {citywideDebugMeasurement.citywideResourceCount} / {citywideDebugMeasurement.citywideResourceBytes.toLocaleString()} bytes</span>}
          </div>}
          </div>}
        </section>
        {qualityOpen && (
          <section className="quality-panel" aria-label="Data quality">
            <div className="quality-heading"><strong>Data quality</strong><button type="button" onClick={() => setQualityOpen(false)}>Close</button></div>
            <div className="data-mode-controls" role="group" aria-label="Data mode">
              <button type="button" aria-pressed={dataMode === "fixtures"} onClick={() => switchDataMode("fixtures")}>Fixture catalog</button>
              <button type="button" aria-pressed={dataMode === "real-pilot" && !citywideMode} disabled={!realAdapter} onClick={() => switchDataMode("real-pilot")}>Real open-data pilot</button>
              <button type="button" aria-pressed={citywideMode} disabled={citywideLoadState !== "ready"} onClick={switchCitywideMode}>Citywide local release</button>
              <button type="button" aria-pressed={civicMode} disabled={compositionLoadState !== "ready"} onClick={switchCivicMode}>Civic context release</button>
            </div>
            <p className="section-label">Mode: {civicMode ? `Composed civic-context snapshot · context ${TRAVEL_CONTEXT_RELEASE_ID} over base ${CITYWIDE_RELEASE_ID} · local lazy shards` : citywideMode ? `Real NYC citywide snapshot · release ${CITYWIDE_RELEASE_ID} · local lazy shards` : dataMode === "real-pilot" ? `Real NYC pilot · bounded Flatiron/NoMad/Union Square coverage · release ${REAL_PILOT_RELEASE_ID} · not full Manhattan` : "Synthetic fixture only · no real provider records"}</p>
            <p className="section-label" role="status">{realDataMessage}</p>
            {dataMode === "real-pilot" && !citywideMode && <p className="section-label" role="status">{landmarkAssetMessage}</p>}
            {citywideMode && <p className="section-label" role="status">Citywide procedural massing is active; bounded-pilot landmark GLB assets remain inactive in this release.</p>}
            {civicMode && <p className="section-label" role="status">Civic composition keeps citywide footprint/height massing beneath metadata/marker layers; bounded-pilot landmark GLB assets remain inactive.</p>}
            {citywideMode && <section className="real-source-summary" aria-label="Citywide source scope">
              <strong>Approved citywide source scope</strong>
              <p className="section-label">Every accepted OTI Building Footprints record (dataset jh45-qr5r) and every accepted DOHMH Restaurant Inspection Results observation (dataset 43nn-pn8j) in the immutable Manhattan snapshot is represented by local release shards; unlocated DOHMH parents remain searchable and detail-visible without invented geometry.</p>
              <p className="section-label">No external provider, imagery, ratings, hours, routing, facade, or public deployment is connected by this release.</p>
            </section>}
            {civicMode && <section className="real-source-summary" aria-label="Civic context source scope">
              <strong>Approved civic-context source scope</strong>
              <p className="section-label">Civic context {TRAVEL_CONTEXT_RELEASE_ID} is composed at runtime over immutable citywide base {CITYWIDE_RELEASE_ID}; the civic manifest baseReleaseId is the authority. DCP 2020 Neighborhood Tabulation Areas (NTA2020 / mapped view 4hft-v355), NYC Parks Properties, and LPC Designated and Calendared Buildings and Sites are dated Manhattan-filtered snapshots in local WGS84. Exact source IDs, capture/update dates, terms, attribution, and uncertainty remain attached to every record.</p>
              <p className="section-label">NTAs are statistical geographies, not definitive or exhaustive neighborhoods. Parks presence does not prove hours, amenities, legal survey accuracy, or current access. LPC records are designation/calendaring records, not attractions or facade/photo/model claims; generated LPC time values are dates only.</p>
              <p className="section-label">NYC Open Data terms and City modified-data disclaimer apply; portal metadata license remains unspecified. This release is local-only and is not publicly deployed or redistributed.</p>
              <p className="source-links"><a href="https://data.cityofnewyork.us/City-Government/2020-Neighborhood-Tabulation-Areas-NTAs-/9nt8-h7nd" target="_blank" rel="noreferrer">DCP 9nt8-h7nd</a> · <a href="https://nycopendata.socrata.com/Recreation/Parks-Properties/enfh-gkve" target="_blank" rel="noreferrer">NYC Parks enfh-gkve</a> · <a href="https://data.cityofnewyork.us/Housing-Development/Designated-and-Calendared-Buildings-and-Sites/ncre-qhxs" target="_blank" rel="noreferrer">LPC ncre-qhxs</a></p>
            </section>}
            {dataMode === "real-pilot" && !citywideMode && <section className="real-source-summary" aria-label="Real pilot source scope">
              <strong>Approved source scope</strong>
              <p className="section-label">Restaurants from the NYC Department of Health and Mental Hygiene Restaurant Inspection Results dataset 43nn-pn8j, captured 2026-08-04; bounded WGS84 pilot envelope west -74.005, south 40.738, east -73.982, north 40.752.</p>
              <p className="section-label">Source: NYC Department of Health and Mental Hygiene, DOHMH New York City Restaurant Inspection Results (dataset 43nn-pn8j), accessed through NYC Open Data.</p>
              <p className="section-label">City/agency disclaimer: this source is informational, may be updated, corrected, or discontinued, and NYC makes no warranty of completeness, accuracy, content, or fitness; this app does not claim full-Manhattan directory coverage.</p>
              <p className="source-links"><a href="https://data.cityofnewyork.us/Health/DOHMH-New-York-City-Restaurant-Inspection-Results/43nn-pn8j" target="_blank" rel="noreferrer">Dataset 43nn-pn8j</a> · <a href="https://www.nyc.gov/html/datamine/html/data/terms.html?dataSetJs=raw" target="_blank" rel="noreferrer">NYC DataMine terms</a></p>
            </section>}
            <section aria-label="Visual fidelity and provenance">
              <strong>Visual fidelity / provenance</strong>
              <p className="section-label">{citywideMode || civicMode ? "Citywide buildings are procedural footprint/height massing from source geometry; they are not real facade imagery, textures, roofs, interiors, entrances, or photorealistic models. Civic LPC records are designation/calendaring facts and markers, not facade assets." : dataMode === "real-pilot" ? "Pilot buildings use source-backed procedural footprint/height massing except for explicitly approved bounded assets; this is not a facade, interior, entrance, or photorealistic model claim." : "Fixture geometry is synthetic and does not claim real-Manhattan visual fidelity or source coverage."}</p>
              {dataMode === "real-pilot" && !citywideMode ? <>
                <ul>
                  {(activeAdapter.assetResolver?.manifest.assets ?? []).filter((entry) => !entry.approval.fixtureOnly && entry.approval.state === "approved").map((entry) => (
                    <li key={entry.canonicalFeatureId}><strong>High-fidelity bounded:</strong> {activeAdapter.getFeature(entry.canonicalFeatureId)?.name ?? entry.canonicalFeatureId} · {entry.lineage.licenseRefIds.join(", ")}</li>
                  ))}
                  <li><strong>Procedural fallback:</strong> all ordinary pilot buildings and any landmark whose verified package content is unavailable.</li>
                  <li><strong>Missing:</strong> no additional landmark exterior is claimed in this wave.</li>
                </ul>
                <p className="section-label">Commons CC BY-SA photographs were reviewed as optional visual references only and are not adapted, bundled, or a dependency of these GLBs; the assets rely on NYC factual publications, NPS public-domain facts, and OTI geometry.</p>
              </> : <ul>
                <li><strong>Procedural massing:</strong> citywide buildings use source footprints and source/unknown height states; no facade imagery, textures, roofs, interiors, entrances, or photorealistic model is claimed.</li>
                <li><strong>Civic context:</strong> statistical areas, Parks properties, and LPC records render as sourced geometry or markers/metadata, not facade assets.</li>
                <li><strong>Inactive:</strong> bounded-pilot GLB packages do not participate in citywide or civic-composition views.</li>
              </ul>}
            </section>
            {dataMode === "fixtures" && <>
              <p className="section-label">Unpublished vertical-slice release {syntheticCatalogRelease.releaseVersion} · {syntheticCatalogRelease.releaseId}</p>
              <dl>
                <div><dt>Artifacts / layers</dt><dd>{syntheticCatalogRelease.recordCounts.artifacts} / {syntheticCatalogRelease.tileCoverage.partitionCount}</dd></div>
                <div><dt>Accepted / rejected</dt><dd>{syntheticCatalogRelease.recordCounts.accepted} / {syntheticCatalogRelease.recordCounts.rejected}</dd></div>
                <div><dt>Freshness range</dt><dd>{syntheticCatalogRelease.freshness.earliest ?? "Unknown"} → {syntheticCatalogRelease.freshness.latest ?? "Unknown"}</dd></div>
                <div><dt>Changes / affected tiles</dt><dd>{syntheticCatalogRelease.releaseDiff?.entries.length ?? 0} / {syntheticCatalogRelease.releaseDiff?.affectedTileKeys.length ?? 0}</dd></div>
                <div><dt>Explicit tombstones</dt><dd>{syntheticCatalogRelease.recordCounts.tombstones}</dd></div>
                <div><dt>Canonical entities</dt><dd>{syntheticCatalog.quality.canonicalEntityCount}</dd></div>
                <div><dt>Source observations</dt><dd>{syntheticCatalog.quality.sourceObservationCount}</dd></div>
                <div><dt>Merged groups</dt><dd>{syntheticCatalog.quality.mergedGroupCount}</dd></div>
                <div><dt>Unmerged / quarantined</dt><dd>{syntheticCatalog.quality.unmergedCandidateCount} / {syntheticCatalog.quality.quarantinedCount}</dd></div>
                <div><dt>Conflicts / stale</dt><dd>{syntheticCatalog.quality.conflictCount} / {syntheticCatalog.quality.staleObservationCount}</dd></div>
                <div><dt>Rejected records</dt><dd>{syntheticCatalog.quality.rejectedRecordCount}</dd></div>
                <div><dt>Pending-source refusal</dt><dd>{syntheticCatalog.quality.pendingSourceRefusal ? "Yes" : "No"}</dd></div>
                <div><dt>Place truth</dt><dd>{placeTruthFixtures.length} fixture records · open-source baseline pending approval</dd></div>
              </dl>
              <button type="button" onClick={() => {
                const conflict = syntheticCatalog.entities.find((entity) => entity.conflicts.length > 0);
                const feature = conflict?.fields.runtimeFeatureId ? activeAdapter.getFeature(conflict.fields.runtimeFeatureId) : undefined;
                if (conflict && feature) { setSelectedCatalogEntityId(conflict.canonicalId); selectFeature(feature); }
              }}>Inspect synthetic conflict</button>
            </>}
          </section>
        )}
        {activeNavigation === "Bookmarks" && <section className="bookmarks-panel" aria-label="Saved places and journeys">
          <div className="quality-heading"><strong>Bookmarks</strong><span>Local only · no remote sync</span></div>
          <h2>Saved places</h2>
          {savedNavigation.places.length ? <ul>{savedNavigation.places.map((place) => <li key={place.canonicalId}><button type="button" onClick={() => restorePlace(place)}>{place.label}</button><small>{place.canonicalId}{place.releaseId ? ` · ${place.releaseId}` : " · legacy fixture"}</small></li>)}</ul> : <p className="section-label">No saved places yet.</p>}
          <h2>Saved journeys</h2>
          {savedNavigation.journeys.length ? <ul>{savedNavigation.journeys.map((journey) => <li key={journey.id}><button type="button" onClick={() => restoreJourney(journey)}>{journey.label}</button><small>{journey.mode} · local synthetic route</small></li>)}</ul> : <p className="section-label">No saved journeys yet.</p>}
        </section>}
        {helpOpen && <section className="help-panel" aria-label="Help"><strong>Help</strong><p>Search or focus a fixture feature, then inspect its provenance. Use the camera controls or focus the viewport before arrow-key exploration; routes and camera previews are synthetic offline fixtures.</p><button type="button" onClick={() => setHelpOpen(false)}>Close</button></section>}
        {settingsOpen && <section className="settings-panel" aria-label="Settings"><strong>Settings</strong><p>Provider connections, live navigation, street imagery, and remote sync are not enabled. Reduced-motion preferences are honored by the camera journey.</p><button type="button" onClick={() => setSettingsOpen(false)}>Close</button></section>}
        <div className={`layer-controls ${layersOpen ? "is-open" : "is-collapsed"}`} aria-label="Runtime layers">
          <button className="overlay-launcher" type="button" aria-expanded={layersOpen} onClick={() => { setLayersOpen((open) => !open); setDiagnosticsOpen(false); setDirectionsOpen(false); }}><strong>Layers</strong><span>{layersOpen ? "Collapse" : "Show layers"}</span></button>
          {layersOpen && <div className="layer-options">
            {layerControlIds.map((layer) => (
              <button
                aria-pressed={layerVisibility[layer]}
                className={layerVisibility[layer] ? "is-visible" : ""}
                key={layer}
                onClick={() => toggleLayer(layer)}
                type="button"
              >
                <span className={`layer-dot layer-dot-${layer}`} />
                {LAYER_LABELS[layer]}
              </button>
            ))}
          </div>}
        </div>
        {availableCategories.length > 0 && <div className="category-controls category-controls-poi" aria-label="POI categories" role="group">
          <span>POI</span>
          {availableCategories.map((category) => (
            <button
              aria-pressed={selectedCategories.includes(category)}
              className={selectedCategories.includes(category) ? "is-selected" : ""}
              key={category}
              onClick={() => toggleCategory(category)}
              type="button"
            >
              {placeTruthCategoryLabel(category)}
            </button>
          ))}
        </div>}
        {civicMode && <div className="category-controls category-controls-civic" aria-label="Civic context facets" role="group">
          <span>Civic facets</span>
          {CIVIC_FACETS.map((facet) => (
            <button
              aria-pressed={selectedCivicFacets.includes(facet)}
              className={selectedCivicFacets.includes(facet) ? "is-selected" : ""}
              key={facet}
              onClick={() => toggleCivicFacet(facet)}
              type="button"
            >
              {civicFacetLabel(facet)}
            </button>
          ))}
        </div>}
        <section className={`directions-panel ${directionsOpen ? "is-open" : "is-collapsed"}`} aria-label="Synthetic directions">
          <button className="overlay-launcher" type="button" aria-expanded={directionsOpen} onClick={() => { setDirectionsOpen((open) => !open); setDiagnosticsOpen(false); setLayersOpen(false); }}><strong>Directions</strong><span>{directionsOpen ? "Collapse" : "Plan a synthetic route"}</span></button>
          {directionsOpen && <div className="directions-content">
          <div className="directions-heading"><strong>Directions</strong><span>Synthetic 3D route preview</span></div>
          <div className="direction-field">
            <label htmlFor="route-origin">Start</label>
            <input id="route-origin" aria-label="Directions start" value={routeOriginQuery} onChange={(event) => setRouteOriginQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") resolveRouteSearch("origin"); }} placeholder="Search a start feature" />
            <button type="button" onClick={() => resolveRouteSearch("origin")} disabled={!routeAdapter}>Set</button>
          </div>
          <div className="direction-field">
            <label htmlFor="route-destination">End</label>
            <input id="route-destination" aria-label="Directions destination" value={routeDestinationQuery} onChange={(event) => setRouteDestinationQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") resolveRouteSearch("destination"); }} placeholder="Search a destination feature" />
            <button type="button" onClick={() => resolveRouteSearch("destination")} disabled={!routeAdapter}>Set</button>
          </div>
          <div className="direction-endpoints"><span>From: {routeOriginName}</span><span>To: {routeDestinationName}</span></div>
          <div className="direction-actions">
            <button type="button" className={routeMode === "walking" ? "is-selected" : ""} aria-pressed={routeMode === "walking"} onClick={() => setRouteMode("walking")}>Walking</button>
            <button type="button" className={routeMode === "transit" ? "is-selected" : ""} aria-pressed={routeMode === "transit"} onClick={() => setRouteMode("transit")}>Synthetic transit</button>
            <button type="button" onClick={swapRoute}>Swap</button>
            <button type="button" onClick={clearRoute}>Clear</button>
          </div>
          <button className="calculate-route" type="button" onClick={calculateRoute} disabled={!routeEndpointsSupported}>Calculate synthetic route</button>
          {routeAdapter && !routeEndpointsSupported && (routeOriginId || routeDestinationId) && <p className="route-message" role="status">Choose valid point endpoints linked to the offline graph; areas, routes, polygons, stale IDs, and unsupported modes cannot be routed.</p>}
          {routeMessage && <p className="route-message" role="status">{routeMessage}</p>}
          {itinerary && (
            <div className="itinerary-result" aria-label="Synthetic itinerary">
              <strong>{(itinerary.distanceMeters / 1000).toFixed(2)} km · {Math.ceil(itinerary.durationSeconds / 60)} min</strong>
              <small>Fixture estimate only · source and accessibility uncertainty retained</small>
              <ol aria-label="Itinerary steps">{itinerary.legs.flatMap((leg) => leg.steps).map((step) => <li key={step.id}>{step.instruction} · {Math.round(step.distanceMeters)} m</li>)}</ol>
              <div className="preview-controls" aria-label="Route camera preview">
                <span>Camera journey</span>
                <button type="button" onClick={() => preview("start")}>Start</button>
                <button type="button" onClick={() => preview("pause")}>Pause</button>
                <button type="button" onClick={() => preview("stop")}>Stop</button>
                <button type="button" onClick={() => preview("previous")}>Previous</button>
                <button type="button" onClick={() => preview("next")}>Next</button>
                <button type="button" onClick={() => preview("focus")}>Focus step</button>
                <small>Step {Math.min(previewStep + 1, journeyStepCount(itinerary) || 1)} of {journeyStepCount(itinerary) || 0} · synthetic fixture only</small>
              </div>
              <button type="button" onClick={saveCurrentJourney}>Save journey locally</button>
            </div>
          )}
          </div>}
        </section>
        {!inspectorOpen && (
          <button
            className="open-inspector"
            onClick={() => setInspectorOpen(true)}
            type="button"
          >
            Open details
          </button>
        )}
      {inspectorOpen && (
        <aside className="inspector" aria-label="Selected feature details">
          <div className="inspector-actions">
            <button
              aria-label="Collapse details"
              onClick={closeInspector}
              type="button"
            >
              <ChevronLeft />
            </button>
            <button aria-label="Close details" onClick={closeInspector} type="button"><X /></button>
          </div>
          <h1 ref={detailsHeadingRef} tabIndex={-1}>{selectedFeature.name}</h1>

          <section className="inspector-section">
            <h2>Overview</h2>
            <dl>
              <div><dt>Location</dt><dd>{selectedFeature.location}</dd></div>
              <div>
                <dt>Coordinates</dt>
                <dd>
                  {(citywideMode || civicMode) && (selectedFeature.attributes.citywideLocationStatus === "location-unavailable" || selectedFeature.attributes.civicLocationStatus === "location-unavailable")
                    ? "Location unavailable in the accepted source; no marker invented"
                    : `${selectedFeature.coordinates.latitude.toFixed(4)}, ${selectedFeature.coordinates.longitude.toFixed(4)} (${selectedFeature.coordinates.heightMeters.toFixed(1)} m)`}
                </dd>
              </div>
              <div><dt>Geometry</dt><dd>{selectedFeature.geometry}</dd></div>
              <div><dt>Feature ID</dt><dd>{selectedFeature.id}</dd></div>
              <div><dt>Confidence</dt><dd>{selectedFeature.confidence.label} ({selectedFeature.confidence.score.toFixed(2)})</dd></div>
              <div><dt>Uncertainty</dt><dd>{selectedFeature.uncertainty}</dd></div>
              <div><dt>Freshness</dt><dd>{selectedFeature.freshness.observedAt ?? "Not observed"}</dd></div>
            </dl>
          </section>

          {selectedPublicRealmFeature && publicRealmOverlay && <section className="inspector-section public-realm-detail" aria-label="Block 835 public-realm provenance">
            <div className="place-truth-heading">
              <h2>Block 835 public realm</h2>
              <span className="truth-badge real-badge">Local · {BLOCK835_PUBLIC_REALM_RELEASE_ID}</span>
            </div>
            <p className="claim-badge" data-visual-evidence-level={selectedPublicRealmFeature.claimLevel}>{selectedPublicRealmFeature.claimLevel === "estimated" ? "Estimated / source-constrained geometry" : "Source-backed planimetry"}</p>
            <p className="section-label">Roadbed and sidewalk geometry come from the approved NYC OTI snapshot. Curb vertical profile and crosswalk placement/striping are deterministic estimates—not current-paint or survey-grade truth.</p>
            <dl>
              <div><dt>Semantic</dt><dd>{selectedPublicRealmFeature.semantic}</dd></div>
              <div><dt>Source dataset</dt><dd>{selectedPublicRealmFeature.sourceDatasetId}{selectedPublicRealmFeature.sourceMappedViewId ? ` · view ${selectedPublicRealmFeature.sourceMappedViewId}` : ""}</dd></div>
              <div><dt>Source feature</dt><dd>{(selectedPublicRealmFeature.sourceFeatureIds ?? (selectedPublicRealmFeature.sourceFeatureId ? [selectedPublicRealmFeature.sourceFeatureId] : [])).join(" · ") || "Derived from source edges"}</dd></div>
              <div><dt>Capture / generated</dt><dd>{publicRealmOverlay.document.generatedAt} · {selectedPublicRealmFeature.sourceEpoch ?? publicRealmOverlay.document.provenance.sourceEpoch}</dd></div>
              <div><dt>CRS / vertical</dt><dd>{selectedPublicRealmFeature.transform.inputCrs} → {selectedPublicRealmFeature.transform.outputCrs} · {selectedPublicRealmFeature.verticalDatum}</dd></div>
              <div><dt>Uncertainty</dt><dd>{selectedPublicRealmFeature.uncertainty.temporal} · horizontal ±{selectedPublicRealmFeature.uncertainty.horizontalMeters ?? "unknown"} m · vertical ±{selectedPublicRealmFeature.uncertainty.verticalMeters ?? "unknown"} m</dd></div>
              <div><dt>Claim ceiling</dt><dd>{publicRealmOverlay.document.claimCeilings[selectedPublicRealmFeature.semantic]}</dd></div>
              <div><dt>Active asset</dt><dd>{(() => { const resolution = publicRealmOverlay.resolve(selectedPublicRealmFeature.semantic, 180); return resolution ? `${resolution.lod} · ${resolution.entry.sha256}` : "No verified local asset"; })()}</dd></div>
              {selectedPublicRealmFeature.derivation && <div><dt>Derivation</dt><dd>{selectedPublicRealmFeature.derivation.algorithm}{selectedPublicRealmFeature.derivation.parameters ? ` · ${JSON.stringify(selectedPublicRealmFeature.derivation.parameters)}` : ""}</dd></div>}
              <div><dt>Terms / attribution</dt><dd><a href={publicRealmOverlay.document.provenance.termsUrl} target="_blank" rel="noreferrer">NYC Open Data terms</a> · {publicRealmOverlay.document.provenance.attribution}</dd></div>
              <div><dt>Disclaimer</dt><dd>{publicRealmOverlay.document.provenance.disclaimer}</dd></div>
            </dl>
          </section>}

          {exteriorUnavailableStatementList.map((statement) => <section key={statement} className="inspector-section exterior-streaming-detail" aria-label="Exterior streaming provenance" data-exterior-unavailable>
            <div className="place-truth-heading">
              <h2>Exterior streaming</h2>
              <span className="truth-badge">Unavailable</span>
            </div>
            <p className="section-label">{statement}</p>
          </section>)}
          {/*
            Attribution follows the SELECTED feature. With more than one wave
            rendered, a session-level release badge would attribute the selected
            building's geometry to whichever wave the session happened to lead
            with. The selection's own wave answers instead; a selection with no
            exterior representation falls back to the session's single wave, and
            says nothing release-specific when several are streaming, because
            picking one of them would be a guess presented as provenance.
          */}
          {exteriorStreamingActive && (() => {
            const attributed = exteriorWaveForSelection(exteriorActiveWaves.map((entry) => ({ ...entry, outcomes: entry.wave.outcomes })), activeSelectionId);
            const owning = attributed && attributed.wave.outcomes.some((cell) => cell.kind === "rendered" && cell.assets.some((asset) => asset.canonicalFeatureId === activeSelectionId))
              ? attributed
              : undefined;
            const runtime = attributed?.wave.runtime ?? null;
            const origin = runtime?.origin ?? "default";
            return <section className="inspector-section exterior-streaming-detail" aria-label="Exterior streaming provenance">
              <div className="place-truth-heading">
                <h2>Exterior streaming</h2>
                {runtime
                  ? <span className="truth-badge real-badge" data-exterior-snapshot-origin={origin}>Local · {runtime.releaseId}</span>
                  : <span className="truth-badge real-badge">Local · {exteriorActiveWaves.length} exterior releases</span>}
              </div>
              <p className="section-label">Exterior cells reuse the canonical base building identity. The render profile changes only which verified LOD is drawn; identity, provenance, and the pinned release origin do not change.</p>
              <dl>
                {runtime && <div><dt>Release origin</dt><dd data-exterior-release-origin={origin}>{exteriorSnapshotOriginLabel(origin, runtime.snapshot.snapshotId)}</dd></div>}
                <div><dt>Render profile</dt><dd data-exterior-profile={exteriorProfile}>{exteriorRenderProfileLabel(exteriorProfile)}</dd></div>
                {(() => {
                  const selectedId = activeSelectionId;
                  const owner = selectedId ? owning?.wave.outcomes.find((cell) => cell.kind === "rendered" && cell.assets.some((asset) => asset.canonicalFeatureId === selectedId)) : undefined;
                  if (!owner || owner.kind !== "rendered") return <div><dt>Selected feature</dt><dd>No verified exterior representation is active for this record.</dd></div>;
                  const asset = owner.assets.find((entry) => entry.canonicalFeatureId === selectedId)!;
                  return <>
                    <div><dt>Cell / release</dt><dd>{owner.cellId} · {owner.cellReleaseId} ({owner.cellReleaseVersion}){owner.representation === "predecessor" ? " · pinned predecessor fallback" : ""}</dd></div>
                    <div><dt>Active asset</dt><dd>{asset.lodId} · {asset.checksumSha256}</dd></div>
                    <div><dt>Truth tiers</dt><dd>{asset.provenance.truthTiers.join(" · ")}</dd></div>
                    <div><dt>Source dates</dt><dd>captured {asset.provenance.sourceDates.capturedAt ?? "unknown"} · updated {asset.provenance.sourceDates.updatedAt ?? "unknown"}</dd></div>
                    {asset.provenance.citedStyle && <div data-exterior-cited-style><dt>Facade material</dt><dd>
                      {asset.provenance.citedStyle.fact} (source: {asset.provenance.citedStyle.provider}, <a href={asset.provenance.citedStyle.sourceUrl} target="_blank" rel="noreferrer">{asset.provenance.citedStyle.sourceUrl}</a>; intake record {asset.provenance.citedStyle.evidenceRecordId}).
                      {" "}This sourced fact selected the designed style class <code>{asset.provenance.citedStyle.styleClass}</code>. The tones, coursing and geometry expressing it are still designed, and no imagery was ingested, traced or reproduced. {asset.provenance.citedStyle.attribution}
                    </dd></div>}
                    <div><dt>Uncertainty</dt><dd>{asset.provenance.uncertainty}</dd></div>
                  </>;
                })()}
              </dl>
            </section>;
          })()}

          <section className="inspector-section asset-detail" aria-label="3D asset diagnostics">
            <h2>3D asset diagnostics</h2>
            {(() => {
              const selectedAssetDistanceMeters = selectedFeature.id === activeSelectionId ? 180 : 240;
              const resolution = exteriorActive && exteriorOverlay
                ? exteriorOverlay.resolve(selectedFeature.id, selectedAssetDistanceMeters, 1)
                : activeAdapter.getAssetResolution?.(selectedFeature.id, selectedAssetDistanceMeters, 1);
              return resolution?.kind === "asset" ? <dl><div><dt>Resolution</dt><dd>Verified {resolution.lod.id}</dd></div><div><dt>Content</dt><dd>{resolution.lod.content.relativeContentRef}</dd></div><div><dt>Geometric error</dt><dd>{resolution.lod.geometricErrorMeters} m</dd></div></dl> : <><p className="section-label">Procedural geometry fallback remains active.</p><p className="section-label" role="status">{resolution?.diagnostic.message ?? "No asset manifest is published for this data mode."}</p></>;
            })()}
          </section>

          {selectedCommercialBuilding && exteriorOverlay && <section className="inspector-section exterior-commercial-detail" aria-label="Exterior commercial frontage provenance">
            <h2>Block 835 exterior / frontage</h2>
            {(() => {
              const commercial = exteriorOverlay.document.commercialRelease;
              const resolution = exteriorOverlay.resolve(selectedCommercialBuilding.canonicalBuildingId, 240, 1);
              const doittId = selectedRuntimeFeature?.attributes.citywideDoittId ?? selectedCommercialBuilding.canonicalBuildingId.replace(/^doitt:/u, "");
              const bin = selectedRuntimeFeature?.attributes.citywideBin ?? "Unknown / not provided";
              const bbl = selectedRuntimeFeature?.attributes.citywideBaseBbl ?? "Unknown / not provided";
              const tenantById = new Map(commercial.tenantEntities.map((tenant) => [tenant.canonicalTenantId, tenant]));
              const observationsById = new Map(commercial.tenantObservations.map((observation) => [observation.observationId, observation]));
              return <>
                <p className="claim-badge" data-visual-evidence-level={selectedCommercialBuilding.visualEvidenceLevel}>{selectedCommercialBuilding.visualEvidenceLevel === "licensed-near-real" ? "Near-real licensed details (ESB/Herald visible evidence only)" : "Source-constrained massing; estimated facade/storefront geometry"}</p>
                <p className="section-label">{selectedCommercialBuilding.claim}</p>
                <dl>
                  <div><dt>Canonical / DOITT</dt><dd>{selectedCommercialBuilding.canonicalBuildingId} · {doittId}</dd></div>
                  <div><dt>BIN / BBL</dt><dd>{String(bin)} · {String(bbl)}</dd></div>
                  <div><dt>Exterior LOD / checksum</dt><dd>{resolution.kind === "asset" ? `${resolution.lod.id} · ${resolution.lod.content.sha256}` : "Procedural fallback · no verified overlay content"}</dd></div>
                  <div><dt>Storefront signs</dt><dd>{selectedCommercialBuilding.acceptedPlacements.length} accepted neutral-text sign{selectedCommercialBuilding.acceptedPlacements.length === 1 ? "" : "s"} · {selectedCommercialBuilding.unknownPlacements.length} unknown/ambiguous placement{selectedCommercialBuilding.unknownPlacements.length === 1 ? "" : "s"}</dd></div>
                </dl>
                {resolution.kind === "procedural-fallback" && <p className="section-label" role="status">Overlay diagnostic: {resolution.diagnostic.message}</p>}
                {selectedCommercialBuilding.placements.length > 0 && <ul className="commercial-frontage-list">
                  {selectedCommercialBuilding.placements.map((placement, placementIndex) => {
                    const tenant = placement.canonicalTenantId ? tenantById.get(placement.canonicalTenantId) : undefined;
                    const observation = placement.sourceObservationId ? observationsById.get(placement.sourceObservationId) : undefined;
                    const eligible = placement.signPolicy === "neutral-text-only" && placement.placementDecision.startsWith("storefront");
                    return <li key={`${placement.storefrontId}:${placementIndex}`} data-placement-decision={placement.placementDecision} data-selected={selectedStorefrontId === placement.storefrontId} aria-current={selectedStorefrontId === placement.storefrontId ? "true" : undefined}>
                      <strong>{eligible ? (tenant?.signText ?? placement.displayName ?? "Unknown") : "Unknown / metadata-only"}</strong>
                      {selectedStorefrontId === placement.storefrontId && <span role="status">Selected storefront proxy</span>}
                      <span>{placement.storefrontId} · {placement.placementDecision} · confidence {placement.confidence.toFixed(2)}</span>
                      <span>{observation?.source ?? "Source unknown"} {observation?.sourceRecordId ?? ""} · observed {observation?.sourceRecordObservedAt ?? "Unknown"} · status {observation?.rawStatus ?? "Unknown / not live"}</span>
                      <span>{placement.evidenceIds.join(", ")} · {placement.licensePartition} · {placement.reasons.join("; ")}</span>
                    </li>;
                  })}
                </ul>}
                <p className="section-label">ODbL-derived frontage metadata retains {commercial.totals.acceptedSigns} accepted signs and {Number(commercial.rejectionConflictSummary.unknownStorefronts ?? 0)} unknown storefronts; no current occupancy is inferred. Map data © OpenStreetMap contributors.</p>
              </>;
            })()}
          </section>}

          {selectedCatalogEntity && (
            <section className="inspector-section reconciliation-detail">
              <h2>Source &amp; freshness</h2>
              <p className="section-label">Canonical catalog projection · fixture only</p>
              <dl>
                <div><dt>Canonical ID</dt><dd>{selectedCatalogEntity.canonicalId}</dd></div>
                <div><dt>Merged from</dt><dd>{selectedCatalogEntity.observationIds.length} source observations · reversible merge</dd></div>
                <div><dt>Last observed</dt><dd>{selectedCatalogEntity.observedAt ?? "Unknown"}</dd></div>
                <div><dt>Valid interval</dt><dd>{selectedCatalogEntity.validFrom ?? "Unknown"} → {selectedCatalogEntity.validTo ?? "Unknown"}</dd></div>
                <div><dt>Confidence</dt><dd>{selectedCatalogEntity.confidence.toFixed(2)}</dd></div>
                <div><dt>Uncertainty</dt><dd>{selectedCatalogEntity.uncertainty || "Unknown"}</dd></div>
                {hasDisplayValue(selectedCatalogEntity.fields.address.formatted) && <div><dt>Address</dt><dd>{selectedCatalogEntity.fields.address.formatted}</dd></div>}
                {hasDisplayValue(selectedCatalogEntity.fields.contact.phone) || hasDisplayValue(selectedCatalogEntity.fields.contact.website) ? <div><dt>Contact</dt><dd>{[selectedCatalogEntity.fields.contact.phone, selectedCatalogEntity.fields.contact.website].filter(hasDisplayValue).join(" · ")}</dd></div> : null}
                {hasDisplayValue(selectedCatalogEntity.fields.brand) || hasDisplayValue(selectedCatalogEntity.fields.operator) ? <div><dt>Brand / operator</dt><dd>{[selectedCatalogEntity.fields.brand, selectedCatalogEntity.fields.operator].filter(hasDisplayValue).join(" · ")}</dd></div> : null}
                {hasDisplayValue(selectedCatalogEntity.fields.cuisine) && <div><dt>Cuisine</dt><dd>{selectedCatalogEntity.fields.cuisine}</dd></div>}
                {hasDisplayValue(selectedCatalogEntity.fields.openingHours.raw) && <div><dt>Hours</dt><dd>{selectedCatalogEntity.fields.openingHours.raw} ({selectedCatalogEntity.fields.openingHours.parsedStatus})</dd></div>}
                {selectedCatalogEntity.fields.accessibility !== "unknown" && <div><dt>Accessibility</dt><dd>{selectedCatalogEntity.fields.accessibility}</dd></div>}
                {hasDisplayValue(selectedCatalogEntity.fields.priceLevel) || selectedCatalogEntity.fields.rating !== null ? <div><dt>Price / rating</dt><dd>{[selectedCatalogEntity.fields.priceLevel, selectedCatalogEntity.fields.rating].filter(hasDisplayValue).join(" · ")}</dd></div> : null}
                {selectedCatalogEntity.conflicts.length > 0 && <div><dt>Conflicts</dt><dd>{selectedCatalogEntity.conflicts.map((conflict) => `${conflict.field}: conflicting values`).join("; ")}</dd></div>}
              </dl>
              {selectedCatalogEntity.conflicts.length > 0 && <div className="conflict-list">{selectedCatalogEntity.conflicts.map((conflict) => <div key={conflict.field}><strong>{conflict.field}</strong><small>{conflict.values.join(" · ")}</small><small>{conflict.sourceRefIds.join(", ")}</small></div>)}</div>}
              <details><summary>Field sources</summary><ul>{selectedCatalogEntity.fieldProvenance.map((field) => <li key={field.field}><strong>{field.field}</strong> · {field.sourceRefIds.join(", ")} · observed {field.observedAt ?? "Unknown"}</li>)}</ul></details>
            </section>
          )}

          {selectedPlaceTruth && (
            <section className="inspector-section place-truth-detail" aria-label="Place truth details">
              <div className="place-truth-heading">
                <h2>Place truth</h2>
                <span className="truth-badge">Fixture only</span>
              </div>
              <p className="section-label">Provider-neutral travel record · synthetic values only · no real Manhattan fact asserted</p>
              <dl>
                <div><dt>Categories</dt><dd>{selectedPlaceTruth.categories.map(placeTruthCategoryLabel).join(" · ")}</dd></div>
                <div><dt>Facets</dt><dd>{selectedPlaceTruth.facets.join(" · ")}</dd></div>
                <div><dt>Localizations</dt><dd>{selectedPlaceTruth.localizedNames.map((name) => `${name.value}${name.language ? ` (${name.language})` : ""}`).join(" · ")}</dd></div>
                <div><dt>Address</dt><dd>{selectedPlaceTruth.address.value?.formatted ?? `Not supplied (${selectedPlaceTruth.address.status})`}</dd></div>
                <div><dt>Entrances</dt><dd>{selectedPlaceTruth.entrances.length ? `${selectedPlaceTruth.entrances.length} sourced entrance${selectedPlaceTruth.entrances.length === 1 ? "" : "s"}` : "Not recorded (absent)"}</dd></div>
                <div><dt>Contact</dt><dd>{selectedPlaceTruth.contact.value ? [selectedPlaceTruth.contact.value.website, selectedPlaceTruth.contact.value.phone].filter(Boolean).join(" · ") || "No contact values" : `Not supplied (${selectedPlaceTruth.contact.status})`}</dd></div>
                <div><dt>Brand / operator</dt><dd>{selectedPlaceTruth.brand.value || selectedPlaceTruth.operator.value ? [selectedPlaceTruth.brand.value, selectedPlaceTruth.operator.value].filter(Boolean).join(" · ") : `Not supplied (${selectedPlaceTruth.brand.status} / ${selectedPlaceTruth.operator.status})`}</dd></div>
                <div><dt>Hours</dt><dd><strong className={`truth-status truth-status-${selectedPlaceHoursStatus?.status ?? "unknown"}`}>{selectedPlaceHoursStatus?.status ?? "unknown"}</strong>{selectedPlaceTruth.hours.raw ? ` · ${selectedPlaceTruth.hours.raw}` : ""}{selectedPlaceHoursStatus?.localTime ? ` · local ${selectedPlaceHoursStatus.localTime}` : ""}</dd></div>
                <div><dt>Hours note</dt><dd>{selectedPlaceHoursStatus?.explanation ?? "Opening hours are unknown."}</dd></div>
                <div><dt>Timezone</dt><dd>{selectedPlaceTruth.hours.timezone ?? "Unknown"}</dd></div>
                <div><dt>Amenities</dt><dd>{selectedPlaceTruth.amenities.value?.length ? selectedPlaceTruth.amenities.value.map((amenity) => `${amenity.label}: ${amenity.value}`).join(" · ") : `Not supplied (${selectedPlaceTruth.amenities.status})`}</dd></div>
                <div><dt>Accessibility</dt><dd>{selectedPlaceTruth.accessibility.value ? `${selectedPlaceTruth.accessibility.value.wheelchair} wheelchair · ${selectedPlaceTruth.accessibility.value.entrance} entrance` : `Not supplied (${selectedPlaceTruth.accessibility.status})`}</dd></div>
                <div><dt>Price / reviews</dt><dd>{selectedPlaceTruth.commercial.priceLevel.status === "absent" && selectedPlaceTruth.commercial.rating.status === "absent" ? "Not sourced" : "See source lineage"}</dd></div>
                <div><dt>Business status</dt><dd>{selectedPlaceTruth.commercial.businessStatus.value ?? `Not supplied (${selectedPlaceTruth.commercial.businessStatus.status})`}</dd></div>
                <div><dt>Imagery</dt><dd>{selectedPlaceTruth.imagery.status === "absent" ? "No photo or street imagery reference" : selectedPlaceTruth.imagery.status}</dd></div>
              </dl>
              <details>
                <summary>Field-level lineage</summary>
                <ul className="place-lineage-list">
                  {selectedPlaceTruth.lineage.map((field) => <li key={field.field}><strong>{field.field}</strong><span>{field.status} · {field.sourceRefIds.join(", ") || "no source"}</span><small>{field.uncertainty}</small></li>)}
                </ul>
              </details>
              <p className="section-label">Source: {selectedPlaceTruth.sourceRefs.map((source) => `${source.provider} · ${source.sourceRecordId}`).join(" · ")} · {selectedPlaceTruth.sourceLicenses.map((license) => license.licenseClass).join(", ")}</p>
            </section>
          )}

          {citywideMode && selectedRuntimeFeature?.kind === "poi" && (
            <section className="inspector-section real-place-detail" aria-label="Citywide restaurant details">
              <div className="place-truth-heading">
                <h2>Citywide restaurant record</h2>
                <span className="truth-badge real-badge">Real · {CITYWIDE_RELEASE_ID}</span>
              </div>
              <p className="section-label">NYC DOHMH snapshot-relative parent record · administrative inspection observations only, not a rating, review, opening-status claim, or recommendation.</p>
              <dl>
                <div><dt>CAMIS parent</dt><dd>{selectedRuntimeFeature.id.replace(/^dohmh:camis:/, "")}</dd></div>
                <div><dt>Location status</dt><dd>{selectedRuntimeFeature.attributes.citywideLocationStatus === "location-unavailable" ? "Location unavailable in source; no map marker is invented." : "Located from the accepted source point."}</dd></div>
                <div><dt>Inspection observations</dt><dd>{selectedRuntimeFeature.attributes.citywideObservationCount ?? "Unknown / detail not loaded"}</dd></div>
                <div><dt>Latest usable inspection date</dt><dd>{selectedRuntimeFeature.attributes.citywideLatestInspectionDate ?? "Unknown / no usable inspection date"}</dd></div>
                <div><dt>Record date</dt><dd>{selectedRuntimeFeature.attributes.citywideRecordDate ?? "Unknown / not provided"} <small>(record date is not an inspection date)</small></dd></div>
                <div><dt>Grade / score</dt><dd>{[selectedRuntimeFeature.attributes.citywideGrade, selectedRuntimeFeature.attributes.citywideScore].filter(hasDisplayValue).join(" · ") || "Unknown / not provided"}</dd></div>
                <div><dt>Action / type</dt><dd>{[selectedRuntimeFeature.attributes.citywideAction, selectedRuntimeFeature.attributes.citywideInspectionType].filter(hasDisplayValue).join(" · ") || "Unknown / not provided"}</dd></div>
                <div><dt>Snapshot captured</dt><dd>{selectedRuntimeFeature.freshness.capturedAt ?? "Unknown"}</dd></div>
                <div><dt>Source updated</dt><dd>{selectedRuntimeFeature.freshness.updatedAt ?? "Unknown"}</dd></div>
              </dl>
              <p className="section-label">Source observations retain derived occurrence identity internally; no derived occurrence token is presented as a DOHMH inspection ID.</p>
            </section>
          )}

          {civicMode && selectedRuntimeFeature?.attributes.civicRecordKind && (
            <section className="inspector-section real-place-detail" aria-label="Civic context details">
              <div className="place-truth-heading">
                <h2>Civic context record</h2>
                <span className="truth-badge real-badge">Real · {TRAVEL_CONTEXT_RELEASE_ID}</span>
              </div>
              <p className="section-label">Snapshot-relative source record · local WGS84 derivative · missing values remain unknown.</p>
              <dl>
                <div><dt>Record type</dt><dd>{civicDetailValue(selectedRuntimeFeature, "civicTypeLabel")}</dd></div>
                <div><dt>Canonical ID</dt><dd>{selectedRuntimeFeature.id}</dd></div>
                <div><dt>Location status</dt><dd>{selectedRuntimeFeature.attributes.civicLocationStatus === "location-unavailable" ? "Location unavailable in accepted source; no marker invented." : "Located from accepted source geometry/point."}</dd></div>
                {selectedRuntimeFeature.attributes.civicRecordKind === "statistical-area" && <>
                  <div><dt>NTA2020</dt><dd>{civicDetailValue(selectedRuntimeFeature, "nta2020")}</dd></div>
                  <div><dt>Official name</dt><dd>{civicDetailValue(selectedRuntimeFeature, "ntaName")}</dd></div>
                  <div><dt>Abbreviation / type</dt><dd>{[civicDetailValue(selectedRuntimeFeature, "ntaAbbrev"), civicDetailValue(selectedRuntimeFeature, "ntaType")].join(" · ")}</dd></div>
                  <div><dt>CDTA relationship</dt><dd>{[civicDetailValue(selectedRuntimeFeature, "cdta2020"), civicDetailValue(selectedRuntimeFeature, "cdtaName")].join(" · ")}</dd></div>
                  <div><dt>Statistical caveat</dt><dd>DCP 2020 NTA is a statistical geography, not a definitive or exhaustive neighborhood.</dd></div>
                </>}
                {selectedRuntimeFeature.attributes.civicRecordKind === "park" && <>
                  <div><dt>GISPROPNUM / parent</dt><dd>{[civicDetailValue(selectedRuntimeFeature, "gispropnum"), civicDetailValue(selectedRuntimeFeature, "parentId")].join(" · ")}</dd></div>
                  <div><dt>Source names</dt><dd>{civicDetailValue(selectedRuntimeFeature, "names")}</dd></div>
                  <div><dt>Management / jurisdiction</dt><dd>{civicDetailValue(selectedRuntimeFeature, "jurisdiction")}</dd></div>
                  <div><dt>Address / location</dt><dd>{[civicDetailValue(selectedRuntimeFeature, "address"), civicDetailValue(selectedRuntimeFeature, "location")].join(" · ")}</dd></div>
                  <div><dt>Type / subcategory</dt><dd>{[civicDetailValue(selectedRuntimeFeature, "typeCategory"), civicDetailValue(selectedRuntimeFeature, "subcategory")].join(" · ")}</dd></div>
                  <div><dt>Acres / acquisition</dt><dd>{[civicDetailValue(selectedRuntimeFeature, "acres"), civicDetailValue(selectedRuntimeFeature, "acquisitionDate")].join(" · ")}</dd></div>
                  <div><dt>Retired/current source state</dt><dd>{civicDetailValue(selectedRuntimeFeature, "currentSourceState")}</dd></div>
                  <div><dt>Access caveat</dt><dd>Source presence does not prove hours, amenities, legal survey accuracy, or current access.</dd></div>
                </>}
                {selectedRuntimeFeature.attributes.civicRecordKind === "landmark-record" && <>
                  <div><dt>LP number</dt><dd>{civicDetailValue(selectedRuntimeFeature, "lpNumber")}</dd></div>
                  <div><dt>Official name / type</dt><dd>{[selectedRuntimeFeature.name, civicDetailValue(selectedRuntimeFeature, "landmarkTypes")].join(" · ")}</dd></div>
                  <div><dt>Status / current flag</dt><dd>{[civicDetailValue(selectedRuntimeFeature, "siteStatuses"), civicDetailValue(selectedRuntimeFeature, "mostCurrent")].join(" · ")}</dd></div>
                  <div><dt>Designation address</dt><dd>{civicDetailValue(selectedRuntimeFeature, "designationAddresses")}</dd></div>
                  <div><dt>PLUTO address</dt><dd>{civicDetailValue(selectedRuntimeFeature, "plutoAddresses")}</dd></div>
                  <div><dt>BIN / BBL</dt><dd>{[civicDetailValue(selectedRuntimeFeature, "bins"), civicDetailValue(selectedRuntimeFeature, "bbls")].join(" · ")}</dd></div>
                  <div><dt>Designation / calendaring dates</dt><dd>{[civicDetailValue(selectedRuntimeFeature, "designationDates"), civicDetailValue(selectedRuntimeFeature, "calendaringDates")].join(" · ")}</dd></div>
                  <div><dt>Last action</dt><dd>{civicDetailValue(selectedRuntimeFeature, "lastActions")}</dd></div>
                  <div><dt>Relationship to OTI building</dt><dd>No relationship asserted without explicit BIN, BBL, or geometry evidence.</dd></div>
                  <div><dt>Date semantics</dt><dd>LPC generated time values are rendered as dates only; no official action time is inferred.</dd></div>
                </>}
                <div><dt>Source captured</dt><dd>{selectedRuntimeFeature.freshness.capturedAt ?? "Unknown / not provided"}</dd></div>
                <div><dt>Source updated</dt><dd>{selectedRuntimeFeature.freshness.updatedAt ?? "Unknown / not provided"}</dd></div>
                <div><dt>Terms / attribution</dt><dd>NYC Open Data terms · DCP/NYC Parks/LPC attribution · portal metadata license unspecified.</dd></div>
                <div><dt>Uncertainty</dt><dd>{selectedRuntimeFeature.uncertainty.notes}</dd></div>
              </dl>
              {selectedRuntimeFeature.attributes.civicDetailLoaded !== true && <p className="section-label" role="status">Loading checksum-pinned detail shard…</p>}
            </section>
          )}

          {selectedRealPlace && (
            <section className="inspector-section real-place-detail" aria-label="Real restaurant details">
              <div className="place-truth-heading">
                <h2>Real restaurant record</h2>
                <span className="truth-badge real-badge">Real · {selectedRealPlace.releaseId}</span>
              </div>
              <p className="section-label">Bounded NYC DOHMH place projection · source facts only · not a full-Manhattan directory.</p>
              <dl>
                <div><dt>Canonical ID</dt><dd>{selectedRealPlace.canonicalId}</dd></div>
                <div><dt>Address</dt><dd>{selectedRealPlace.address.formatted ?? "Unknown / Not provided"}</dd></div>
                <div><dt>Cuisine</dt><dd>{selectedRealPlace.cuisine ?? "Unknown / Not provided"}</dd></div>
                <div><dt>Phone</dt><dd>{selectedRealPlace.contact.phone ?? "Unknown / Not provided"}</dd></div>
                <div><dt>CAMIS</dt><dd>{selectedRealPlace.latestInspection?.camis ?? "Unknown / Not provided"} <small>(DOHMH source identity; not the platform canonical ID)</small></dd></div>
                <div><dt>Source record</dt><dd>{selectedRealPlace.sourceRecordIds.join(" · ") || "Unknown / Not provided"}</dd></div>
                <div><dt>Hours</dt><dd>Unknown / Not provided by this release</dd></div>
                <div><dt>Accessibility</dt><dd>Unknown / Not provided by this release</dd></div>
                <div><dt>Brand / website</dt><dd>Unknown / Not provided</dd></div>
                <div><dt>Snapshot captured</dt><dd>{selectedRealPlace.freshness.capturedAt ?? "Unknown"}</dd></div>
                <div><dt>Record updated</dt><dd>{selectedRealPlace.freshness.updatedAt ?? "Unknown"}</dd></div>
                <div><dt>Source observed</dt><dd>{selectedRealPlace.freshness.observedAt ?? "Unknown"}</dd></div>
                <div><dt>Uncertainty</dt><dd>{selectedRealPlace.uncertainty}</dd></div>
              </dl>
              <section className="inspection-record" aria-label="DOHMH inspection record">
                <h3>DOHMH inspection record</h3>
                <p className="section-label">Administrative inspection data only — not a consumer rating, review, popularity signal, opening-status claim, or recommendation.</p>
                <dl>
                  <div><dt>Inspection observations</dt><dd>{selectedRealPlace.inspectionObservationCount ?? "Unknown / Not provided"}</dd></div>
                  <div><dt>Latest usable date</dt><dd>{selectedRealPlace.latestInspection?.inspectionDateStatus === "not-yet-inspected" ? "not yet inspected / no usable inspection date" : selectedRealPlace.latestInspection?.inspectionDate ?? "Unknown / no usable inspection date"}</dd></div>
                  <div><dt>Record date</dt><dd>{selectedRealPlace.latestInspection?.recordDate ?? "Unknown / Not provided"} <small>(record date is not an inspection date)</small></dd></div>
                  <div><dt>Grade</dt><dd>{selectedRealPlace.latestInspection?.grade ?? "Unknown / Not provided"}</dd></div>
                  <div><dt>Score</dt><dd>{selectedRealPlace.latestInspection?.score ?? "Unknown / Not provided"}</dd></div>
                  <div><dt>Action</dt><dd>{selectedRealPlace.latestInspection?.action ?? "Unknown / Not provided"}</dd></div>
                  <div><dt>Inspection type</dt><dd>{selectedRealPlace.latestInspection?.inspectionType ?? "Unknown / Not provided"}</dd></div>
                </dl>
              </section>
              {selectedRealPlace.diagnostics.length > 0 && <p className="section-label" role="status">Optional record detail diagnostic: {selectedRealPlace.diagnostics.join(" ")}</p>}
              <details>
                <summary>Source and terms</summary>
                <p className="section-label">{selectedRealPlace.sourceLicenses.map((license) => license.attribution).join(" ") || "Source attribution unknown."}</p>
                <p className="source-links">{selectedRealPlace.sourceRefs.map((source) => <a href={source.sourceUrl} key={source.id} target="_blank" rel="noreferrer">Dataset {source.datasetId}</a>)} · {selectedRealPlace.sourceLicenses.map((license) => <a href={license.termsUrl} key={`${license.sourceRefId}:terms`} target="_blank" rel="noreferrer">Terms</a>)}</p>
              </details>
            </section>
          )}

          <section className="inspector-section relationship-detail">
            <h2>Related entities</h2>
            {relatedFeatures.length > 0 ? <ul className="related-list">{relatedFeatures.map((feature) => <li key={feature.id}><button type="button" onClick={() => selectFeature(feature)}>{feature.name}<small>{feature.kind}</small></button></li>)}</ul> : <p className="section-label">No source-linked related entities recorded for this feature.</p>}
            <h3>Nearby transit</h3>
            {nearbyTransit.length > 0 ? <ul className="related-list">{nearbyTransit.map(({ feature, distanceMeters, method }) => <li key={feature.id}><button type="button" onClick={() => selectFeature(feature)}>{feature.name}<small>{feature.kind} · {formatDistanceMeters(distanceMeters)} · geometry-derived {method}</small></button></li>)}</ul> : <p className="section-label">{proximityOriginAvailable ? "Unknown · no geometry-derived transit within 1,000 meters." : "Proximity unavailable · this geometry has no trustworthy representative point."}</p>}
          </section>

          {selectedFeature.kind === "poi" && !selectedRealPlace && (
            <section className="inspector-section poi-detail">
              <h2>Place details</h2>
              <dl>
                {hasDisplayValue(selectedFeature.attributes.placeCategories) && <div><dt>Categories</dt><dd>{selectedFeature.attributes.placeCategories?.toString().split(",").join(", ")}</dd></div>}
                {hasDisplayValue(selectedFeature.attributes.placeAddress) && <div><dt>Address</dt><dd>{selectedFeature.attributes.placeAddress?.toString()}</dd></div>}
                {hasDisplayValue(selectedFeature.attributes.placeWebsite) && <div><dt>Website</dt><dd>{selectedFeature.attributes.placeWebsite?.toString()}</dd></div>}
                {hasDisplayValue(selectedFeature.attributes.placePhone) && <div><dt>Phone</dt><dd>{selectedFeature.attributes.placePhone?.toString()}</dd></div>}
                {hasDisplayValue(selectedFeature.attributes.placeCuisine) || hasDisplayValue(selectedFeature.attributes.placeBrand) ? <div><dt>Cuisine / brand</dt><dd>{[selectedFeature.attributes.placeCuisine, selectedFeature.attributes.placeBrand].filter(hasDisplayValue).join(" · ")}</dd></div> : null}
                {hasDisplayValue(selectedFeature.attributes.placeOpeningHours) && <div><dt>Opening hours</dt><dd>{selectedFeature.attributes.placeOpeningHours?.toString()}</dd></div>}
                {hasDisplayValue(selectedFeature.attributes.placeAccessibility) && <div><dt>Accessibility</dt><dd>{selectedFeature.attributes.placeAccessibility?.toString()}</dd></div>}
                {hasDisplayValue(selectedFeature.attributes.placeLicenses) && <div><dt>License provenance</dt><dd>{selectedFeature.attributes.placeLicenses?.toString()}</dd></div>}
                {hasDisplayValue(selectedFeature.attributes.placeConflicts) && <div><dt>Source conflicts</dt><dd>{selectedFeature.attributes.placeConflicts?.toString()}</dd></div>}
              </dl>
            </section>
          )}

          {selectedFeature.kind === "area" && (
            <section className="inspector-section area-detail">
              <h2>Area details</h2>
              <dl>
                <div><dt>Semantics</dt><dd>{isAreaSemantic(selectedFeature.attributes.areaSemantics) ? areaSemanticsLabel(selectedFeature.attributes.areaSemantics) : "Unknown"}</dd></div>
                {hasDisplayValue(selectedFeature.attributes.areaType) || hasDisplayValue(selectedFeature.attributes.areaLevel) ? <div><dt>Area type / level</dt><dd>{[selectedFeature.attributes.areaType, selectedFeature.attributes.areaLevel].filter(hasDisplayValue).join(" · ")}</dd></div> : null}
                {hasDisplayValue(selectedFeature.attributes.areaOfficialName) && <div><dt>Official name</dt><dd>{selectedFeature.attributes.areaOfficialName?.toString()}</dd></div>}
                {hasDisplayValue(selectedFeature.attributes.areaLabels) && <div><dt>Labels</dt><dd>{selectedFeature.attributes.areaLabels?.toString()}</dd></div>}
                {(selectedFeature.freshness.updatedAt || selectedFeature.freshness.capturedAt) && <div><dt>Source date</dt><dd>{selectedFeature.freshness.updatedAt ?? selectedFeature.freshness.capturedAt}</dd></div>}
                {hasDisplayValue(selectedFeature.attributes.areaUncertainty) && <div><dt>Boundary uncertainty</dt><dd>{selectedFeature.attributes.areaUncertainty?.toString()}</dd></div>}
                {hasDisplayValue(selectedFeature.attributes.areaLicense) && <div><dt>License provenance</dt><dd>{selectedFeature.attributes.areaLicense?.toString()}</dd></div>}
              </dl>
            </section>
          )}

          {(selectedFeature.kind === "transit-station" || selectedFeature.kind === "transit-entrance" || selectedFeature.kind === "transit-route") && (
            <section className="inspector-section transit-detail">
              <h2>Transit details</h2>
              <p className="section-label">Synthetic fixture only · no live arrivals or routing</p>
              <dl>
                <div><dt>Transit kind</dt><dd>{transitKindLabel(selectedFeature.kind)}</dd></div>
                <div><dt>Mode</dt><dd>{selectedFeature.attributes.transitMode?.toString() || "Unknown"}</dd></div>
                <div><dt>Station complex</dt><dd>{selectedFeature.attributes.transitStationComplexId?.toString() || "Unknown"}</dd></div>
                <div><dt>Parent station</dt><dd>{selectedFeature.attributes.transitParentStationId?.toString() || "Unknown"}</dd></div>
                <div><dt>Parent stop</dt><dd>{selectedFeature.attributes.transitParentStopId?.toString() || "Unknown"}</dd></div>
                <div><dt>Routes / services</dt><dd>{selectedFeature.attributes.transitRouteNames?.toString() || selectedFeature.attributes.transitRouteIds?.toString() || "Unknown"}</dd></div>
                <div><dt>Service date</dt><dd>{selectedFeature.attributes.transitServiceDate?.toString() || "Unknown"}</dd></div>
                <div><dt>Semantics</dt><dd>{selectedFeature.attributes.transitServiceSemantics?.toString() || "Unknown"}</dd></div>
                <div><dt>Accessibility</dt><dd>{selectedFeature.attributes.transitAccessibility?.toString() || "Unknown"}</dd></div>
                <div><dt>Elevator status</dt><dd>{selectedFeature.attributes.transitElevatorStatus?.toString() || "Unknown"}</dd></div>
                <div><dt>Geometry meaning</dt><dd>{selectedFeature.attributes.transitGeometrySemantics?.toString() || (selectedFeature.kind === "transit-route" ? "Schematic centerline; not an exact tunnel path" : "Point location")}</dd></div>
                <div><dt>License / attribution</dt><dd>{selectedFeature.attributes.transitSourceLicense?.toString() || "Not recorded"}</dd></div>
              </dl>
            </section>
          )}

          <section className="inspector-section route-selection">
            <h2>Directions</h2>
            <p className="section-label">{selectedRouteSupported ? "Use this selected fixture feature as a route endpoint." : "Unsupported for this offline graph: only valid linked or nearby point features can be route endpoints."}</p>
            <div className="route-selection-actions">
              <button type="button" onClick={() => setRouteEndpointFromSelected("origin")} disabled={!selectedRouteSupported}>Set start</button>
              <button type="button" onClick={() => setRouteEndpointFromSelected("destination")} disabled={!selectedRouteSupported}>Set destination</button>
              <button type="button" onClick={saveCurrentPlace}>{savedNavigation.places.some((place) => place.canonicalId === selectedFeature.id) ? "Saved locally" : "Save place locally"}</button>
            </div>
          </section>

          <section className="inspector-section">
            <h2>Sources</h2>
            <p className="section-label">
              {selectedFeature.provenanceRecord.label} · {civicMode ? `origin release ${selectedRuntimeFeature?.attributes.civicReleaseId === TRAVEL_CONTEXT_RELEASE_ID ? TRAVEL_CONTEXT_RELEASE_ID : CITYWIDE_RELEASE_ID}; composition context ${TRAVEL_CONTEXT_RELEASE_ID} over base ${CITYWIDE_RELEASE_ID}; attribution retained` : citywideMode ? `origin release ${CITYWIDE_RELEASE_ID}; source attribution retained` : dataMode === "real-pilot" ? `bounded real pilot ${REAL_PILOT_RELEASE_ID}; source attribution retained` : "local fixture only"}
            </p>
            <div className="provenance-list">
              {(["authoritative", "derived", "generated"] as const).map((kind) => (
                <div className={kind === selectedFeature.provenance ? "is-current" : ""} key={kind}>
                  <span className={`provenance-swatch provenance-${kind}`} />
                  <span>
                    <strong>{provenanceLabel(kind)}</strong>
                    <small>
                      {kind === selectedFeature.provenance
                        ? civicMode ? `Current normalized ${selectedRuntimeFeature?.attributes.civicReleaseId === TRAVEL_CONTEXT_RELEASE_ID ? "civic-context" : "citywide"} source snapshot; composition root ${TRAVEL_CONTEXT_RELEASE_ID} pins base ${CITYWIDE_RELEASE_ID}; source dates, terms, and uncertainty apply.` : citywideMode ? "Current normalized source snapshot; citywide scope and uncertainty apply." : dataMode === "real-pilot" ? "Current normalized source snapshot; pilot scope and uncertainty apply." : "Current normalized local fixture; not production city data."
                        : kind === "generated"
                          ? "Visible runtime-only geometry; not ground truth."
                          : "No source connected in this setup milestone."}
                    </small>
                  </span>
                </div>
              ))}
            </div>
            <dl className="source-record">
              <div>
                <dt>Source URL</dt>
                <dd>{selectedFeature.provenanceRecord.sourceUrl ? <a href={selectedFeature.provenanceRecord.sourceUrl} target="_blank" rel="noreferrer">{selectedFeature.provenanceRecord.sourceUrl}</a> : "Not recorded"}</dd>
              </div>
              <div>
                <dt>Captured</dt>
                <dd>{selectedFeature.provenanceRecord.capturedAt ?? "Not recorded"}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{selectedFeature.provenanceRecord.updatedAt ?? "Not recorded"}</dd>
              </div>
              <div>
                <dt>Source record</dt>
                <dd>{selectedFeature.sourceRefs[0]?.sourceRecordId ?? "Not recorded"}</dd>
              </div>
              <div>
                <dt>Ingestion rejects</dt>
                <dd>{selectedFeature.ingestionSummary.rejectionReport}</dd>
              </div>
              {selectedRealPlace && <>
                <div><dt>Terms URL</dt><dd>{selectedRealPlace.sourceLicenses[0]?.termsUrl ? <a href={selectedRealPlace.sourceLicenses[0].termsUrl} target="_blank" rel="noreferrer">NYC DataMine terms</a> : "Unknown / Not provided"}</dd></div>
                <div><dt>Attribution</dt><dd>{selectedRealPlace.sourceLicenses[0]?.attribution ?? "Unknown / Not provided"}</dd></div>
                <div><dt>City disclaimer</dt><dd>Informational source; may be updated, corrected, or discontinued; NYC makes no warranty of completeness, accuracy, content, or fitness.</dd></div>
              </>}
            </dl>
          </section>

          <div className="inspector-footer">
            <button className="primary-action" onClick={focusMarker} type="button">
              <Crosshair size={18} />Focus
            </button>
            <button disabled type="button">Compare</button>
            <button type="button" onClick={copyShareLink}><Crosshair size={18} />Copy share link</button>
          </div>
        </aside>
      )}

      </section>

      <footer className="status-bar">
        <span>Manhattan, New York</span>
            <span><Box size={16} />{dataMode === "real-pilot" || dataMode === "civic-context" ? "Cesium primitives + selected detail ready" : "Cesium entities ready"}</span>
            <span className="status-pending">{civicMode ? `Composed NYC context ${TRAVEL_CONTEXT_RELEASE_ID} over base ${CITYWIDE_RELEASE_ID} · local app-origin requests only` : citywideMode ? "Real NYC citywide snapshot · local app-origin requests only" : dataMode === "real-pilot" ? "Real open-data pilot · MTA/OSM/Overture not loaded" : "Fixture data only · provider approval pending"}</span>
      </footer>
    </main>
  );
}
