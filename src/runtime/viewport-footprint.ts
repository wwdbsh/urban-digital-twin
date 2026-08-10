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

/**
 * The shallowest camera pitch, in degrees, still measured to render a complete
 * facade scene in the T009 F2 sweep. Attitudes strictly shallower than this are
 * treated as horizon-stretched; this one and every steeper one are left alone.
 *
 * The value is read straight off the measurement, not chosen for roundness: at
 * a fixed position pitch -30 deg and -28 deg both drew 14/14 Block 835
 * buildings, -25 deg dropped to 10/14, and -20 deg and shallower drew 0/14. The
 * boundary therefore sits between -28 and -25; anchoring on -28 keeps every
 * measured *complete* attitude untouched and bounds every measured *degraded*
 * one.
 */
export const HORIZON_STRETCH_PITCH_DEGREES = -28;

/**
 * Whether a camera attitude is shallow enough for the nine ground-ray sample to
 * run away toward the horizon.
 *
 * Pitch is the discriminator because pitch is what the F2 evidence isolated:
 * position, height and heading were held fixed across the sweep and only the
 * attitude changed, so the rendered-building count tracked pitch alone. The
 * alternative candidate — the distance from the camera sub-point to the sampled
 * ground centre — is a *symptom* of the same geometry and would additionally
 * misfire on a legitimate wide near-nadir view whose centre is far from the
 * camera merely because the view is large.
 *
 * A non-finite pitch is treated as not horizon-stretched: without a usable
 * attitude there is no evidence of the defect, and the sample is left intact
 * rather than clipped on a guess.
 */
export function isHorizonStretchedAttitude(camera: CameraPose): boolean {
  return Number.isFinite(camera.pitch) && camera.pitch > HORIZON_STRETCH_PITCH_DEGREES;
}

/**
 * Bound a horizon-stretched ground-ray footprint to the extent the camera could
 * reasonably be serving, anchored on the camera's own sub-point.
 *
 * Why this exists (T009 finding F2). The footprint is sampled by nine globe
 * pick-rays. At a level or near-level camera attitude the upper rays graze the
 * horizon, so the sampled bounds stretch for kilometres and their centre lands
 * far downrange of the camera. Shard selection then ranks candidates by
 * distance from that displaced centre and truncates to the shard budget, and
 * the shard the camera is *standing on* falls outside the cut. With no base
 * building record there is no verified WGS84 anchor, so exterior cells withhold
 * geometry and a street-level facade view renders nothing.
 *
 * The bound reuses the already-accepted `fallbackViewportFootprint` extent
 * rather than inventing a new constant. That extent is a pure function of
 * camera height — it knows nothing about pitch, field of view or aspect — so as
 * an unconditional intersection it would clip *any* oversized sample, including
 * legitimate wide near-nadir ones: the app's own 4 km overview loses breadth
 * against it, and at citywide altitude its 0.12/0.078 deg caps are narrower than
 * Manhattan's ~0.18 deg latitude span. So the bound is applied only on the
 * condition the finding actually describes, `isHorizonStretchedAttitude`; at any
 * steeper attitude the sample is returned untouched by identity.
 *
 * Deliberately *not* in scope: multi-cell cache pressure and cell-bounds
 * culling, which ADR 0024 hands forward to T013+. This clamps one camera
 * sample; it does not schedule the cache.
 */
export function boundFootprintToCamera(footprint: ViewportFootprint, camera: CameraPose): ViewportFootprint {
  if (!isHorizonStretchedAttitude(camera)) return footprint;
  const limit = fallbackViewportFootprint(camera).bounds;
  // The antimeridian case is left alone: intersecting a wrapped arc needs the
  // two-interval form, and narrowing is an optimisation, not a correctness
  // requirement. Manhattan never wraps.
  if (viewportBoundsCrossesAntimeridian(footprint.bounds) || viewportBoundsCrossesAntimeridian(limit)) return footprint;
  const bounded: ViewportBounds = {
    west: Math.max(footprint.bounds.west, limit.west),
    east: Math.min(footprint.bounds.east, limit.east),
    south: Math.max(footprint.bounds.south, limit.south),
    north: Math.min(footprint.bounds.north, limit.north),
  };
  // A degenerate intersection means the camera sub-point is not inside its own
  // sampled footprint. Keep the sample rather than invent an empty viewport.
  if (bounded.west >= bounded.east || bounded.south >= bounded.north) return footprint;
  if (
    bounded.west === footprint.bounds.west && bounded.east === footprint.bounds.east &&
    bounded.south === footprint.bounds.south && bounded.north === footprint.bounds.north
  ) return footprint;
  return footprintFromBounds(bounded, viewportBoundsCenter(bounded), footprint.valid, footprint.source);
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
