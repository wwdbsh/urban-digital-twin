import type { Itinerary, TravelMode } from "./routing";
import { explorationUrl, parseExplorationUrl, type ExplorationUrlState } from "./exploration";

export const VISITOR_NAVIGATION_SCHEMA_VERSION = "1.0" as const;
export type CameraMode = "overview" | "explore";
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
}

export interface SavedPlace {
  schemaVersion: typeof VISITOR_NAVIGATION_SCHEMA_VERSION;
  canonicalId: string;
  label: string;
  savedAt: string;
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

export const DEFAULT_CAMERA_POSE: CameraPose = { longitude: -73.991, latitude: 40.744, height: 4_000, heading: 0, pitch: -45, roll: 0 };
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
    const modeValue = url.searchParams.get("view");
    const cameraMode: CameraMode = modeValue === "overview" ? "overview" : "explore";
    const poseKeys = ["lon", "lat", "height", "heading", "pitch", "roll"];
    const hasPose = poseKeys.some((key) => url.searchParams.has(key));
    if (!hasPose) return { ...base, cameraMode, pose: null, poseInvalid: false };
    const values = Object.fromEntries(poseKeys.map((key) => [key, parseNumber(url.searchParams.get(key))]));
    const pose = normalizeCameraPose({ longitude: values.lon!, latitude: values.lat!, height: values.height!, heading: values.heading!, pitch: values.pitch!, roll: values.roll! });
    return { ...base, cameraMode, pose, poseInvalid: pose === null };
  } catch {
    return { ...base, cameraMode: "explore", pose: null, poseInvalid: true };
  }
}

export function navigationUrl(value: NavigationUrlState, base: string): string {
  const url = new URL(explorationUrl({ featureId: value.featureId, query: value.query }, base));
  url.searchParams.set("view", value.cameraMode);
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
function validSavedPlace(value: unknown): value is SavedPlace { return typeof value === "object" && value !== null && (value as SavedPlace).schemaVersion === VISITOR_NAVIGATION_SCHEMA_VERSION && typeof (value as SavedPlace).canonicalId === "string" && Boolean((value as SavedPlace).canonicalId) && typeof (value as SavedPlace).label === "string" && typeof (value as SavedPlace).savedAt === "string"; }
function validSavedJourney(value: unknown): value is SavedJourney { return typeof value === "object" && value !== null && (value as SavedJourney).schemaVersion === VISITOR_NAVIGATION_SCHEMA_VERSION && typeof (value as SavedJourney).id === "string" && typeof (value as SavedJourney).originFeatureId === "string" && typeof (value as SavedJourney).destinationFeatureId === "string" && (value as SavedJourney).mode !== undefined && ((value as SavedJourney).mode === "walking" || (value as SavedJourney).mode === "transit") && typeof (value as SavedJourney).label === "string" && typeof (value as SavedJourney).savedAt === "string"; }

export function loadSavedNavigation(storage: NavigationStorage | null | undefined, validFeatureIds: ReadonlySet<string>): SavedNavigationState {
  if (!storage) return emptySavedState();
  try {
    const parsed = JSON.parse(storage.getItem(VISITOR_NAVIGATION_STORAGE_KEY) ?? "null") as Partial<SavedNavigationState> | null;
    if (!parsed || parsed.schemaVersion !== VISITOR_NAVIGATION_SCHEMA_VERSION) return emptySavedState();
    const places = [...new Map((Array.isArray(parsed.places) ? parsed.places : []).filter(validSavedPlace).filter((place) => validFeatureIds.has(place.canonicalId)).map((place) => [place.canonicalId, place])).values()].sort((a, b) => a.canonicalId.localeCompare(b.canonicalId));
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
