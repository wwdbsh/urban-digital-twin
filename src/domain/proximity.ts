import type { Feature, Position } from "./schema";

/**
 * Geometry-derived proximity defaults.  These values are deliberately small
 * and explicit: they describe a local relationship hint, not a transit route
 * or a source-published relationship.
 */
export const DEFAULT_PROXIMITY_THRESHOLD_METERS = 1_000;
export const DEFAULT_PROXIMITY_MAX_RESULTS = 3;

export interface ProximityResult {
  feature: Feature;
  distanceMeters: number;
  units: "meters";
  method: "great-circle";
  representativePoint: [number, number];
}

export interface ProximityOptions {
  thresholdMeters?: number;
  maxResults?: number;
  predicate?: (feature: Feature) => boolean;
}

function validPoint(value: unknown): value is [number, number] {
  return Array.isArray(value)
    && value.length >= 2
    && typeof value[0] === "number" && Number.isFinite(value[0]) && value[0] >= -180 && value[0] <= 180
    && typeof value[1] === "number" && Number.isFinite(value[1]) && value[1] >= -90 && value[1] <= 90;
}

/** A point is the only geometry with an unambiguous feature representative. */
export function representativePoint(feature: Feature | null | undefined): [number, number] | null {
  if (!feature || feature.geometry.type !== "Point") return null;
  return validPoint(feature.geometry.coordinates) ? [feature.geometry.coordinates[0], feature.geometry.coordinates[1]] : null;
}

/** Haversine distance over WGS84 coordinates; result is an honest metric unit. */
export function greatCircleDistanceMeters(a: Position | null | undefined, b: Position | null | undefined): number | null {
  if (!validPoint(a) || !validPoint(b)) return null;
  const radians = Math.PI / 180;
  const latitudeA = a[1] * radians;
  const latitudeB = b[1] * radians;
  const deltaLatitude = (b[1] - a[1]) * radians;
  const deltaLongitude = (b[0] - a[0]) * radians;
  const haversine = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(deltaLongitude / 2) ** 2;
  return 6_371_008.8 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)));
}

export function findNearbyFeatures(
  origin: Feature | null | undefined,
  candidates: readonly Feature[],
  options: ProximityOptions = {},
): ProximityResult[] {
  const originPoint = representativePoint(origin);
  if (!originPoint) return [];
  const thresholdMeters = options.thresholdMeters ?? DEFAULT_PROXIMITY_THRESHOLD_METERS;
  const maxResults = options.maxResults ?? DEFAULT_PROXIMITY_MAX_RESULTS;
  if (!Number.isFinite(thresholdMeters) || thresholdMeters < 0 || !Number.isInteger(maxResults) || maxResults <= 0) return [];
  return candidates
    .filter((candidate) => candidate.id !== origin?.id && (options.predicate?.(candidate) ?? true))
    .map((candidate) => {
      const point = representativePoint(candidate);
      const distanceMeters = greatCircleDistanceMeters(originPoint, point);
      return point && distanceMeters !== null && distanceMeters <= thresholdMeters
        ? { feature: candidate, distanceMeters, units: "meters" as const, method: "great-circle" as const, representativePoint: point }
        : null;
    })
    .filter((result): result is ProximityResult => result !== null)
    .sort((a, b) => a.distanceMeters - b.distanceMeters || a.feature.id.localeCompare(b.feature.id))
    .slice(0, maxResults);
}

export function formatDistanceMeters(distanceMeters: number): string {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return "Unknown distance";
  return distanceMeters < 1_000 ? `${Math.round(distanceMeters)} m` : `${(distanceMeters / 1_000).toFixed(2)} km`;
}
