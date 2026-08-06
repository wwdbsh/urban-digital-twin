import type { CameraPose } from "../domain/visitor-navigation";

/** A WGS84 viewport bounds value. `west > east` deliberately represents a dateline wrap. */
export interface ViewportBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface ViewportGroundCenter {
  longitude: number;
  latitude: number;
}

export type ViewportFootprintSource = "ground-rays" | "view-rectangle" | "camera-fallback" | "last-valid";

/**
 * The one spatial contract shared by Cesium dense rendering and release shard
 * selection.  It describes ground the camera can see, rather than the camera
 * position in the air.
 */
export interface ViewportFootprint {
  bounds: ViewportBounds;
  groundCenter: ViewportGroundCenter;
  /** Whether the current camera sample reached the globe. A last-valid footprint remains usable. */
  valid: boolean;
  source: ViewportFootprintSource;
  /** Stable across repeated camera events for the same visible ground extent. */
  signature: string;
}

export interface ViewportRefreshRequest {
  camera: CameraPose;
  footprint: ViewportFootprint;
}

export type ViewportRefreshInput = CameraPose | ViewportRefreshRequest;

const SIGNATURE_PRECISION = 6;

function fixed(value: number): string {
  return Number.isFinite(value) ? value.toFixed(SIGNATURE_PRECISION) : "invalid";
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeViewportLongitude(longitude: number): number {
  const wrapped = ((longitude + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 && longitude > 0 ? 180 : wrapped;
}

function finiteCoordinate(value: readonly number[]): value is readonly [number, number] {
  const longitude = value[0];
  const latitude = value[1];
  return typeof longitude === "number" && typeof latitude === "number" && Number.isFinite(longitude) && Number.isFinite(latitude) && longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90;
}

export function viewportBoundsCrossesAntimeridian(bounds: ViewportBounds): boolean {
  return bounds.west > bounds.east;
}

function longitudeIntervals(bounds: ViewportBounds): Array<readonly [number, number]> {
  return viewportBoundsCrossesAntimeridian(bounds)
    ? [[bounds.west, 180], [-180, bounds.east]]
    : [[bounds.west, bounds.east]];
}

export function viewportBoundsIntersect(left: ViewportBounds, right: ViewportBounds): boolean {
  if (left.south > right.north || left.north < right.south) return false;
  return longitudeIntervals(left).some(([leftWest, leftEast]) => longitudeIntervals(right).some(([rightWest, rightEast]) => leftWest <= rightEast && leftEast >= rightWest));
}

export function viewportBoundsCenter(bounds: ViewportBounds): ViewportGroundCenter {
  const longitude = normalizeViewportLongitude(bounds.west + (viewportBoundsCrossesAntimeridian(bounds)
    ? ((bounds.east + 360 - bounds.west) / 2)
    : ((bounds.east - bounds.west) / 2)));
  return { longitude, latitude: (bounds.south + bounds.north) / 2 };
}

export function viewportFootprintSignature(bounds: ViewportBounds, groundCenter: ViewportGroundCenter): string {
  return [bounds.west, bounds.south, bounds.east, bounds.north, groundCenter.longitude, groundCenter.latitude].map(fixed).join(":");
}

function footprintFromBounds(bounds: ViewportBounds, groundCenter: ViewportGroundCenter, valid: boolean, source: ViewportFootprintSource): ViewportFootprint {
  const normalizedBounds: ViewportBounds = {
    west: normalizeViewportLongitude(bounds.west),
    east: normalizeViewportLongitude(bounds.east),
    south: clamp(bounds.south, -90, 90),
    north: clamp(bounds.north, -90, 90),
  };
  const normalizedCenter: ViewportGroundCenter = {
    longitude: normalizeViewportLongitude(groundCenter.longitude),
    latitude: clamp(groundCenter.latitude, -90, 90),
  };
  return { bounds: normalizedBounds, groundCenter: normalizedCenter, valid, source, signature: viewportFootprintSignature(normalizedBounds, normalizedCenter) };
}

/** Convert a Cesium `computeViewRectangle` fallback into the shared contract. */
export function viewportFootprintFromBounds(bounds: ViewportBounds, source: Exclude<ViewportFootprintSource, "ground-rays" | "last-valid"> = "view-rectangle"): ViewportFootprint | null {
  if (![bounds.west, bounds.east, bounds.south, bounds.north].every(Number.isFinite)) return null;
  if (bounds.south > bounds.north || bounds.south < -90 || bounds.north > 90) return null;
  return footprintFromBounds(bounds, viewportBoundsCenter(bounds), false, source);
}

/**
 * Produces the smallest circular longitude arc containing the samples.  The
 * returned west/east pair uses `west > east` only when the arc crosses ±180°.
 */
export function viewportBoundsFromGroundPoints(points: readonly (readonly [number, number])[]): ViewportBounds | null {
  const valid = points.filter(finiteCoordinate);
  if (valid.length === 0) return null;
  const longitudes = valid.map(([longitude]) => ((normalizeViewportLongitude(longitude) + 360) % 360)).sort((left, right) => left - right);
  let largestGap = -1;
  let startIndex = 0;
  for (let index = 0; index < longitudes.length; index += 1) {
    const current = longitudes[index]!;
    const next = index === longitudes.length - 1 ? longitudes[0]! + 360 : longitudes[index + 1]!;
    const gap = next - current;
    if (gap > largestGap) {
      largestGap = gap;
      startIndex = (index + 1) % longitudes.length;
    }
  }
  const west = normalizeViewportLongitude(longitudes[startIndex]!);
  const east = normalizeViewportLongitude(longitudes[(startIndex + longitudes.length - 1) % longitudes.length]!);
  const latitudes = valid.map(([, latitude]) => latitude);
  return { west, east, south: Math.min(...latitudes), north: Math.max(...latitudes) };
}

/**
 * Favor real globe intersections.  If the horizon or temporary rendering
 * state yields no intersections, retain a supplied valid footprint before
 * considering a camera-independent rectangle fallback.
 */
export function viewportFootprintFromGroundPoints(
  points: readonly (readonly [number, number])[],
  options: { lastValid?: ViewportFootprint | null; fallbackBounds?: ViewportBounds | null } = {},
): ViewportFootprint | null {
  const bounds = viewportBoundsFromGroundPoints(points);
  if (bounds) return footprintFromBounds(bounds, viewportBoundsCenter(bounds), true, "ground-rays");
  if (options.lastValid?.valid) return { ...options.lastValid, valid: false, source: "last-valid" };
  return options.fallbackBounds ? viewportFootprintFromBounds(options.fallbackBounds) : null;
}

/** Compatibility-only bootstrap used until Cesium has supplied ground rays. */
export function fallbackViewportFootprint(camera: CameraPose): ViewportFootprint {
  const radiusLongitude = Math.min(0.12, Math.max(0.006, camera.height / 111_000 * 0.9));
  const radiusLatitude = radiusLongitude * 0.65;
  const bounds: ViewportBounds = {
    west: normalizeViewportLongitude(camera.longitude - radiusLongitude),
    east: normalizeViewportLongitude(camera.longitude + radiusLongitude),
    south: clamp(camera.latitude - radiusLatitude, -90, 90),
    north: clamp(camera.latitude + radiusLatitude, -90, 90),
  };
  return footprintFromBounds(bounds, { longitude: camera.longitude, latitude: camera.latitude }, false, "camera-fallback");
}

export function isViewportRefreshRequest(value: ViewportRefreshInput): value is ViewportRefreshRequest {
  return "footprint" in value && "camera" in value;
}

/** Accept legacy camera-only callers while directing all new callers to the shared footprint. */
export function normalizeViewportRefreshRequest(value: ViewportRefreshInput): ViewportRefreshRequest {
  return isViewportRefreshRequest(value) ? value : { camera: value, footprint: fallbackViewportFootprint(value) };
}
