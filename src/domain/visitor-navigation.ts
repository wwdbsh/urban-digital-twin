import type { Itinerary, TravelMode } from "./routing";
// Explicit `.ts`, as everywhere else in `src/`: Node's `--experimental-strip-types`
// loader does no extension resolution, so an extensionless value import here
// makes this module unloadable from the `scripts/` CLIs that reach it.
import { explorationUrl, parseExplorationUrl, type ExplorationUrlState } from "./exploration.ts";

export const VISITOR_NAVIGATION_SCHEMA_VERSION = "1.0" as const;
export type CameraMode = "overview" | "explore";
export type NavigationDataMode = "fixtures" | "real-pilot" | "civic-context";
export type JourneyStepAction = "start" | "previous" | "next" | "focus";

export interface CameraPose {
  longitude: number;
  latitude: number;
  height: number;
  heading: number;
  pitch: number;
  roll: number;
}

export interface NavigationUrlState extends ExplorationUrlState {
  cameraMode: CameraMode;
  pose: CameraPose | null;
  poseInvalid: boolean;
  /** Optional for backward compatibility with legacy `?feature=` links. */
  dataMode?: NavigationDataMode;
  /** The immutable release requested by a real link; absent means fixture mode. */
  releaseId?: string | null;
  /** URL-restored visibility state for generic v2 release layers. */
  visibleLayers?: string[];
  /** URL-restored category/facet state for the active release. */
  facets?: string[];
  /** Optional additive exterior asset package; base/civic release identity remains separate. */
  exteriorReleaseId?: string | null;
  /** Commercial frontage metadata/signs are opt-in with the exterior package. */
  commercial?: boolean;
  /** Optional accepted storefront deep-link while preserving its building identity. */
  storefrontId?: string | null;
}

export interface SavedPlace {
  schemaVersion: typeof VISITOR_NAVIGATION_SCHEMA_VERSION;
  canonicalId: string;
  label: string;
  savedAt: string;
  /** Immutable release pin for real/civic bookmarks; absent means legacy fixture bookmark. */
  releaseId?: string | null;
}

export interface SavedJourney {
  schemaVersion: typeof VISITOR_NAVIGATION_SCHEMA_VERSION;
  id: string;
  originFeatureId: string;
  destinationFeatureId: string;
  mode: TravelMode;
  label: string;
  savedAt: string;
}

export interface SavedNavigationState {
  schemaVersion: typeof VISITOR_NAVIGATION_SCHEMA_VERSION;
  places: SavedPlace[];
  journeys: SavedJourney[];
}

export interface NavigationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_CAMERA_POSE: CameraPose = { longitude: -73.991, latitude: 40.744, height: 4_000, heading: 0, pitch: -75, roll: 0 };
export const VISITOR_NAVIGATION_STORAGE_KEY = "udt.visitor-navigation.v1";

function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
function wrapDegrees(value: number): number { return ((value % 360) + 360) % 360; }

export function normalizeCameraPose(value: Partial<CameraPose>): CameraPose | null {
  if (![value.longitude, value.latitude, value.height, value.heading, value.pitch, value.roll].every(finite)) return null;
  return {
    longitude: clamp(value.longitude!, -180, 180),
    latitude: clamp(value.latitude!, -90, 90),
    height: clamp(value.height!, 80, 500_000),
    heading: wrapDegrees(value.heading!),
    pitch: clamp(value.pitch!, -90, 0),
    roll: clamp(value.roll!, -180, 180),
  };
}

function parseNumber(value: string | null): number | null { if (value === null || value.trim() === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }

export function parseNavigationUrl(value: string): NavigationUrlState {
  const base = parseExplorationUrl(value);
  try {
    const url = new URL(value);
    const dataValue = url.searchParams.get("data");
    const releaseValue = url.searchParams.get("release");
    const exteriorValue = url.searchParams.get("exterior");
    const commercialValue = url.searchParams.get("commercial");
    const storefrontValue = url.searchParams.get("storefront");
    const isFixtureData = dataValue === "fixture" || dataValue === "fixtures";
    const civicData = dataValue === "civic-context" || releaseValue === "manhattan-civic-context-20260804";
    const dataMode: NavigationDataMode | undefined = dataValue && !isFixtureData || releaseValue ? civicData ? "civic-context" : "real-pilot" : undefined;
    const releaseId = dataMode ? releaseValue ?? (dataValue === "real-pilot" ? null : dataValue === "civic-context" ? "manhattan-civic-context-20260804" : dataValue) : undefined;
    const dataState = dataMode ? { dataMode, releaseId } : {};
    const poseKeys = ["lon", "lat", "height", "heading", "pitch", "roll"];
    const hasPose = poseKeys.some((key) => url.searchParams.has(key));
    const modeValue = url.searchParams.get("view");
    // A bare URL has no camera intent to restore, so start in the safe
    // overview. An explicit view or any pose-bearing link retains the legacy
    // explore default and remains deterministic for shared links.
    const cameraMode: CameraMode = modeValue === "overview" ? "overview" : modeValue === "explore" || hasPose ? "explore" : "overview";
    const layerValue = url.searchParams.get("layers");
    const facetValue = url.searchParams.get("facets");
    const filterState = {
      ...(layerValue ? { visibleLayers: [...new Set(layerValue.split(",").map((item) => item.trim()).filter(Boolean))].sort() } : {}),
      ...(facetValue ? { facets: [...new Set(facetValue.split(",").map((item) => item.trim()).filter(Boolean))].sort() } : {}),
    };
    const overlayState = exteriorValue ? { exteriorReleaseId: exteriorValue, commercial: commercialValue === "1" || commercialValue === "true", storefrontId: storefrontValue } : {};
    if (!hasPose) return { ...base, ...dataState, ...filterState, ...overlayState, cameraMode, pose: null, poseInvalid: false };
    const values = Object.fromEntries(poseKeys.map((key) => [key, parseNumber(url.searchParams.get(key))]));
    const pose = normalizeCameraPose({ longitude: values.lon!, latitude: values.lat!, height: values.height!, heading: values.heading!, pitch: values.pitch!, roll: values.roll! });
    return { ...base, ...dataState, ...filterState, ...overlayState, cameraMode, pose, poseInvalid: pose === null };
  } catch {
    return { ...base, cameraMode: "explore", pose: null, poseInvalid: true };
  }
}

export function navigationUrl(value: NavigationUrlState, base: string): string {
  const url = new URL(explorationUrl({ featureId: value.featureId, query: value.query }, base));
  url.searchParams.set("view", value.cameraMode);
  if (value.dataMode === "real-pilot" || value.dataMode === "civic-context") {
    url.searchParams.set("data", value.releaseId ?? "real-pilot");
    if (value.releaseId) url.searchParams.set("release", value.releaseId);
    else url.searchParams.delete("release");
  } else {
    url.searchParams.delete("data");
    url.searchParams.delete("release");
  }
  if (value.exteriorReleaseId) url.searchParams.set("exterior", value.exteriorReleaseId);
  else url.searchParams.delete("exterior");
  if (value.commercial && value.exteriorReleaseId) url.searchParams.set("commercial", "1");
  else url.searchParams.delete("commercial");
  if (value.storefrontId && value.exteriorReleaseId && value.commercial) url.searchParams.set("storefront", value.storefrontId);
  else url.searchParams.delete("storefront");
  if (value.visibleLayers && value.visibleLayers.length > 0) url.searchParams.set("layers", [...new Set(value.visibleLayers)].sort().join(","));
  else url.searchParams.delete("layers");
  if (value.facets && value.facets.length > 0) url.searchParams.set("facets", [...new Set(value.facets)].sort().join(","));
  else url.searchParams.delete("facets");
  if (value.pose) {
    const pose = normalizeCameraPose(value.pose);
    if (pose) for (const [key, numberValue] of Object.entries({ lon: pose.longitude, lat: pose.latitude, height: pose.height, heading: pose.heading, pitch: pose.pitch, roll: pose.roll })) url.searchParams.set(key, numberValue.toFixed(6));
  }
  return url.toString();
}

export function stepIndex(current: number, action: JourneyStepAction, count: number): number {
  if (!Number.isInteger(count) || count <= 0) return 0;
  const safe = clamp(Math.trunc(current), 0, count - 1);
  if (action === "start") return 0;
  if (action === "previous") return Math.max(0, safe - 1);
  if (action === "next") return Math.min(count - 1, safe + 1);
  return safe;
}

export function journeyStepCount(itinerary: Itinerary | null | undefined): number { return itinerary?.legs.reduce((count, leg) => count + leg.steps.length, 0) ?? 0; }

function emptySavedState(): SavedNavigationState { return { schemaVersion: VISITOR_NAVIGATION_SCHEMA_VERSION, places: [], journeys: [] }; }
function validSavedPlace(value: unknown): value is SavedPlace { return typeof value === "object" && value !== null && (value as SavedPlace).schemaVersion === VISITOR_NAVIGATION_SCHEMA_VERSION && typeof (value as SavedPlace).canonicalId === "string" && Boolean((value as SavedPlace).canonicalId) && typeof (value as SavedPlace).label === "string" && typeof (value as SavedPlace).savedAt === "string" && (!Object.prototype.hasOwnProperty.call(value, "releaseId") || (typeof (value as SavedPlace).releaseId === "string" || (value as SavedPlace).releaseId === null)); }
function validSavedJourney(value: unknown): value is SavedJourney { return typeof value === "object" && value !== null && (value as SavedJourney).schemaVersion === VISITOR_NAVIGATION_SCHEMA_VERSION && typeof (value as SavedJourney).id === "string" && typeof (value as SavedJourney).originFeatureId === "string" && typeof (value as SavedJourney).destinationFeatureId === "string" && (value as SavedJourney).mode !== undefined && ((value as SavedJourney).mode === "walking" || (value as SavedJourney).mode === "transit") && typeof (value as SavedJourney).label === "string" && typeof (value as SavedJourney).savedAt === "string"; }

export function loadSavedNavigation(storage: NavigationStorage | null | undefined, validFeatureIds: ReadonlySet<string>): SavedNavigationState {
  if (!storage) return emptySavedState();
  try {
    const parsed = JSON.parse(storage.getItem(VISITOR_NAVIGATION_STORAGE_KEY) ?? "null") as Partial<SavedNavigationState> | null;
    if (!parsed || parsed.schemaVersion !== VISITOR_NAVIGATION_SCHEMA_VERSION) return emptySavedState();
    // Pinned real/civic bookmarks are intentionally retained even when their
    // release is not the currently hydrated adapter. The UI can then explain
    // the release mismatch instead of silently dropping a user bookmark.
    const places = [...new Map((Array.isArray(parsed.places) ? parsed.places : []).filter(validSavedPlace).filter((place) => Boolean(place.releaseId) || validFeatureIds.has(place.canonicalId)).map((place) => [place.canonicalId, place])).values()].sort((a, b) => a.canonicalId.localeCompare(b.canonicalId));
    const journeys = [...new Map((Array.isArray(parsed.journeys) ? parsed.journeys : []).filter(validSavedJourney).filter((journey) => validFeatureIds.has(journey.originFeatureId) && validFeatureIds.has(journey.destinationFeatureId)).map((journey) => [journey.id, journey])).values()].sort((a, b) => a.id.localeCompare(b.id));
    return { schemaVersion: VISITOR_NAVIGATION_SCHEMA_VERSION, places, journeys };
  } catch { return emptySavedState(); }
}

export function persistSavedNavigation(storage: NavigationStorage | null | undefined, state: SavedNavigationState): void {
  if (!storage) return;
  try { storage.setItem(VISITOR_NAVIGATION_STORAGE_KEY, JSON.stringify(state)); } catch { /* Corrupt or unavailable browser storage is non-fatal. */ }
}

export function savePlace(state: SavedNavigationState, place: SavedPlace): SavedNavigationState { return { ...state, places: [...state.places.filter((item) => item.canonicalId !== place.canonicalId), place].sort((a, b) => a.canonicalId.localeCompare(b.canonicalId)) }; }
export function saveJourney(state: SavedNavigationState, journey: SavedJourney): SavedNavigationState { return { ...state, journeys: [...state.journeys.filter((item) => item.id !== journey.id), journey].sort((a, b) => a.id.localeCompare(b.id)) }; }
