/**
 * Deterministic per-building input adapter for the full Manhattan exterior
 * snapshot (Task T012).
 *
 * This module is the only place that turns a WGS84 building record of the
 * pinned `manhattan-citywide-20260804` snapshot into a
 * `DeterministicFacadeInput`.  It owns four decisions and nothing else:
 *
 * 1. **Pinned generation time.**  `generatedAt` is a frozen documented instant
 *    bound to one base-manifest checksum.  A wall clock would make replay fail
 *    by construction, so the adapter refuses to build anything for a snapshot
 *    whose manifest checksum is not the pinned one.
 * 2. **Trig-free integer projection.**  ADR 0020 bans trigonometry from plan
 *    generation, and `Math.cos` is implementation-approximated.  WGS84 degrees
 *    become integer nanodegrees and then local millimetres through one frozen
 *    city-wide rational scale pair.  Every arithmetic step is `BigInt`.
 * 3. **Minimum-area rotated rectangle footprint proxy.**  The accepted V1 plan
 *    schema takes exactly one axis-aligned rectangle and no georeference, so
 *    the local frame's orientation is this adapter's free choice.  The proxy,
 *    its orientation, and the magnitude of the substitution are recorded in the
 *    run record and encoded in the plan's footprint anchor id.
 * 4. **Universal height quantization.**  `validateDeterministicFacadeInput`
 *    requires `floorCount * floorHeightMm === heightMm` exactly, and the
 *    snapshot's foot-derived heights (e.g. 5,791.2 mm) have no admissible
 *    factorization.  Every height is therefore quantized, and the residual is
 *    disclosed per building rather than hidden.
 *
 * The adapter never clamps a generator cap.  Caps are fail-closed conditions:
 * a plan that would exceed one is refused, because a firing cap means the input
 * data drifted, not that the output should be silently trimmed.
 */

import {
  DETERMINISTIC_FACADE_GENERATOR_ID,
  DETERMINISTIC_FACADE_GENERATOR_VERSION,
  DETERMINISTIC_FACADE_LIMITS,
  DETERMINISTIC_FACADE_SCHEMA_VERSION,
  type DeterministicFacadeInput,
  type FacadeGeneratorParameters,
  type FacadeSourceAnchor,
} from "./deterministic-facade-generator.ts";
import { domainSeparatedSha256 } from "./deterministic-hash.ts";

export const EXTERIOR_FULLSNAPSHOT_INPUT_SCHEMA_VERSION = "1.0" as const;

/** The one base snapshot this adapter may read. */
export const EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID = "manhattan-citywide-20260804" as const;

/**
 * The pinned `manifest.json` SHA-256 of that snapshot.  `generatedAt` below is
 * only defined relative to this checksum; the adapter refuses any other input.
 */
export const EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256 = "acb5a9b52014f86535c8478e7d4e516efc03f6dff95c17e9896dfea4413c203c" as const;

/**
 * Frozen canonical generation instant: the pinned snapshot's own capture day at
 * midnight UTC.  It is a constant of the *snapshot*, never of the run, so two
 * replays separated by any amount of wall-clock time produce identical plans.
 */
export const EXTERIOR_FULLSNAPSHOT_GENERATED_AT = "2026-08-04T00:00:00.000Z" as const;

/**
 * One city-wide rational projection scale.
 *
 * Derived once, offline, at the citywide coverage centre latitude 40.78125 deg
 * from the standard degree-length series
 * (`111132.92 - 559.82 cos2f + 1.175 cos4f - 0.0023 cos6f` metres per degree of
 * latitude and `111412.84 cos f - 93.5 cos3f + 0.118 cos5f` metres per degree of
 * longitude), then frozen as integer millimetres per degree.  No trigonometry
 * runs at generation time.
 *
 * Disclosed residual, stated throughout in parts per million: the longitude
 * scale is exact only at the reference latitude.  Across the snapshot's
 * 40.6843..40.8787 deg latitude band the true longitude scale varies by
 * 2,916 ppm, so a projected east-west distance carries up to 1,463 ppm relative
 * error.  Because every building is projected around its own representative
 * point, that error is a per-building *scale* error over the footprint span
 * only, not an absolute position error.  The latitude scale varies by 17 ppm
 * over the same band.
 */
export const EXTERIOR_FULLSNAPSHOT_PROJECTION = {
  referenceLatitudeNanodegrees: 40_781_250_000,
  millimetersPerDegreeLatitude: 111_049_654,
  millimetersPerDegreeLongitude: 84_412_702,
  maximumLongitudeScaleErrorPartsPerMillion: 1_463,
  maximumLatitudeScaleErrorPartsPerMillion: 17,
} as const;

/** Universal height quantization and grammar rules. */
export const EXTERIOR_FULLSNAPSHOT_HEIGHT_RULES = {
  /** Nominal storey height used to pick a floor count. */
  targetFloorHeightMm: 3_500,
  /** The accepted plan schema's own floor-count floor. */
  minimumFloorCount: 2,
  /**
   * Deterministic substitute height for the 76 buildings the snapshot marks
   * `heightUnknown`.  Three nominal storeys.  It is a stated substitution, not
   * a measurement: the plan carries the `fallback` height anchor id and the run
   * record carries `heightSource: "fallback"`.
   */
  unknownHeightFallbackMm: 10_500,
  /** Refuse degenerate footprints instead of inventing a building. */
  minimumRectangleSideMm: 1_000,
  /** Refuse a bay narrower than this instead of clamping the bay count. */
  minimumBayWidthMm: 500,
  /** Nominal bay width used to pick a bay count. */
  targetBayWidthMm: 6_000,
} as const;

export const EXTERIOR_FULLSNAPSHOT_FOOTPRINT_PROXY_ID = "min-rect-proxy-v1" as const;
export const EXTERIOR_FULLSNAPSHOT_FOOTPRINT_ANCHOR_ID = `anchor:footprint:${EXTERIOR_FULLSNAPSHOT_FOOTPRINT_PROXY_ID}` as const;
export const EXTERIOR_FULLSNAPSHOT_HEIGHT_ANCHOR_ID = "anchor:height:source-v1" as const;
export const EXTERIOR_FULLSNAPSHOT_HEIGHT_FALLBACK_ANCHOR_ID = "anchor:height:fallback-v1" as const;

/** One accepted building of the pinned snapshot, as the geometry shards carry it. */
export interface FullSnapshotBuildingSource {
  buildingId: string;
  /** Representative point `[longitude, latitude]` in WGS84 degrees. */
  representative: readonly [number, number];
  /** Closed outer ring in WGS84 degrees, first vertex repeated last. */
  outerRing: ReadonlyArray<readonly [number, number]>;
  /** Closed interior rings in WGS84 degrees; V1 drops them and says so. */
  holeRings: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
  heightMeters: number | null;
  heightUnknown: boolean;
  sourceRefId: string;
}

/**
 * Per-building truth record for one adapted building.
 *
 * Every field is always present.  `stableSerialize` maps `undefined` and `null`
 * to the same token, so an omitted optional field could collide with an
 * explicit `null` and corrupt the run digest; the type therefore has no
 * optional members and `assertFullSnapshotRunRecord` rejects `undefined` at
 * runtime.
 */
export interface FullSnapshotRunRecord {
  schemaVersion: typeof EXTERIOR_FULLSNAPSHOT_INPUT_SCHEMA_VERSION;
  buildingId: string;
  /** Local-frame origin: the snapshot's representative point, in nanodegrees. */
  originLongitudeNanodegrees: number;
  originLatitudeNanodegrees: number;
  footprintProxy: typeof EXTERIOR_FULLSNAPSHOT_FOOTPRINT_PROXY_ID;
  /**
   * Exact integer direction of the rectangle's local +u axis in the east-north
   * millimetre frame, reduced by gcd and canonicalized into the half plane
   * `x > 0 or (x === 0 and y > 0)`.  An angle in degrees is deliberately not
   * emitted: `atan2` is trigonometry, which ADR 0020 bans from this path.
   */
  orientationXMm: number;
  orientationYMm: number;
  /** Rectangle centre offset from the origin, in the east-north mm frame. */
  centerOffsetXMm: number;
  centerOffsetYMm: number;
  /** `widthMm` is the +u extent and is always the longer side. */
  widthMm: number;
  depthMm: number;
  /** Shoelace area of the projected outer ring, in square millimetres. */
  trueAreaMm2: number;
  /** Shoelace area of the dropped interior rings, in square millimetres. */
  holeAreaMm2: number;
  proxyAreaMm2: number;
  /** `proxyAreaMm2 / trueAreaMm2`, scaled by one million. */
  areaRatioPartsPerMillion: number;
  /**
   * The same ratio for the axis-aligned bounding box of the projected ring.
   * Recorded so the rotated-rectangle proxy can be compared against the
   * cheaper alternative from committed data rather than from a one-off script.
   */
  axisAlignedAreaRatioPartsPerMillion: number;
  holeRingsDropped: number;
  sourceVertexCount: number;
  hullVertexCount: number;
  /** Longest projected footprint span; bounds the disclosed projection error. */
  maximumSpanMm: number;
  heightSource: "source" | "fallback";
  /** Height before quantization: the source height, or the stated fallback. */
  unquantizedHeightMm: number;
  /** `floorCount * floorHeightMm`, the height the plan actually carries. */
  quantizedHeightMm: number;
  heightResidualMm: number;
  floorCount: number;
  floorHeightMm: number;
  bayCount: number;
  /** True when the two-floor grammar floor raised a sub-5.25 m building. */
  forcedTwoFloor: boolean;
  /**
   * True when the two-bay grammar floor raised a building whose shorter side is
   * under 12 m.  That includes the common 25 ft Manhattan lot, so this is a
   * frequent substitution and is disclosed exactly like `forcedTwoFloor`.
   */
  forcedTwoBay: boolean;
  placementCount: number;
}

export interface FullSnapshotInputIssue {
  buildingId: string;
  code: FullSnapshotInputIssueCode;
  detail: string;
}

/**
 * Closed refusal vocabulary.  Each code is an explicit deterministic stop, not
 * a silent substitution: the caller must account for it.
 */
export const EXTERIOR_FULLSNAPSHOT_INPUT_ISSUE_CODES = [
  "unsupported-base-manifest",
  "invalid-identity",
  "degenerate-footprint",
  "degenerate-rectangle",
  "invalid-height",
  "cap-exceeded",
  "rejected-input",
] as const;

export type FullSnapshotInputIssueCode = (typeof EXTERIOR_FULLSNAPSHOT_INPUT_ISSUE_CODES)[number];

export type FullSnapshotInputResult =
  | { ok: true; input: DeterministicFacadeInput; record: FullSnapshotRunRecord }
  | { ok: false; issues: readonly FullSnapshotInputIssue[] };

// ---------------------------------------------------------------------------
// Exact integer helpers
// ---------------------------------------------------------------------------

/** Rounds a `BigInt` quotient half away from zero.  `denominator` must be > 0. */
function roundDiv(numerator: bigint, denominator: bigint): bigint {
  const doubled = numerator * 2n;
  return numerator >= 0n
    ? (doubled + denominator) / (denominator * 2n)
    : -((-doubled + denominator) / (denominator * 2n));
}

function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function gcdBigInt(left: bigint, right: bigint): bigint {
  let a = absBigInt(left);
  let b = absBigInt(right);
  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

/** Exact integer square root by Newton iteration; no floating point involved. */
function isqrtBigInt(value: bigint): bigint {
  if (value < 0n) throw new RangeError("isqrt requires a non-negative value.");
  if (value < 2n) return value;
  let guess = 1n << (BigInt(value.toString(2).length + 1) / 2n);
  while (true) {
    const next = (guess + value / guess) / 2n;
    if (next >= guess) break;
    guess = next;
  }
  return guess;
}

/**
 * Converts a WGS84 degree coordinate to integer nanodegrees.
 *
 * The source value is an IEEE-754 double parsed from the snapshot's own JSON.
 * Double multiplication and `Math.round` are exactly specified by ECMA-262, so
 * this step is reproducible on every conforming engine; everything after it is
 * integer arithmetic.
 */
export function degreesToNanodegrees(value: number): number {
  return Math.round(value * 1e9);
}

const NANODEGREES_PER_DEGREE = 1_000_000_000n;
const SCALE = 1_000_000n;
const SCALE_SQUARED = SCALE * SCALE;

interface LocalPoint {
  x: bigint;
  y: bigint;
}

function projectToLocalMillimeters(
  longitudeNanodegrees: number,
  latitudeNanodegrees: number,
  originLongitudeNanodegrees: number,
  originLatitudeNanodegrees: number,
): LocalPoint {
  const deltaLongitude = BigInt(longitudeNanodegrees) - BigInt(originLongitudeNanodegrees);
  const deltaLatitude = BigInt(latitudeNanodegrees) - BigInt(originLatitudeNanodegrees);
  return {
    x: roundDiv(deltaLongitude * BigInt(EXTERIOR_FULLSNAPSHOT_PROJECTION.millimetersPerDegreeLongitude), NANODEGREES_PER_DEGREE),
    y: roundDiv(deltaLatitude * BigInt(EXTERIOR_FULLSNAPSHOT_PROJECTION.millimetersPerDegreeLatitude), NANODEGREES_PER_DEGREE),
  };
}

function projectRing(
  ring: ReadonlyArray<readonly [number, number]>,
  originLongitudeNanodegrees: number,
  originLatitudeNanodegrees: number,
): LocalPoint[] {
  const points: LocalPoint[] = [];
  for (const vertex of ring) {
    points.push(projectToLocalMillimeters(
      degreesToNanodegrees(vertex[0]),
      degreesToNanodegrees(vertex[1]),
      originLongitudeNanodegrees,
      originLatitudeNanodegrees,
    ));
  }
  // Drop the repeated closing vertex and any run of vertices that collapsed
  // onto one another at millimetre resolution.
  const deduplicated: LocalPoint[] = [];
  for (const point of points) {
    const previous = deduplicated[deduplicated.length - 1];
    if (previous && previous.x === point.x && previous.y === point.y) continue;
    deduplicated.push(point);
  }
  while (deduplicated.length > 1) {
    const first = deduplicated[0]!;
    const last = deduplicated[deduplicated.length - 1]!;
    if (first.x !== last.x || first.y !== last.y) break;
    deduplicated.pop();
  }
  return deduplicated;
}

/** Doubled shoelace area of a projected ring; sign-free. */
function doubledRingArea(points: readonly LocalPoint[]): bigint {
  let total = 0n;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    total += current.x * next.y - next.x * current.y;
  }
  return absBigInt(total);
}

function cross(origin: LocalPoint, left: LocalPoint, right: LocalPoint): bigint {
  return (left.x - origin.x) * (right.y - origin.y) - (left.y - origin.y) * (right.x - origin.x);
}

/**
 * Monotone-chain convex hull over exact integer coordinates.  Returns the hull
 * in counter-clockwise order with no collinear vertices, or fewer than three
 * points when the input is degenerate.
 */
function convexHull(points: readonly LocalPoint[]): LocalPoint[] {
  const sorted = [...points].sort((left, right) => (left.x === right.x ? (left.y < right.y ? -1 : left.y > right.y ? 1 : 0) : left.x < right.x ? -1 : 1));
  const unique: LocalPoint[] = [];
  for (const point of sorted) {
    const previous = unique[unique.length - 1];
    if (previous && previous.x === point.x && previous.y === point.y) continue;
    unique.push(point);
  }
  if (unique.length < 3) return unique;
  const build = (source: readonly LocalPoint[]): LocalPoint[] => {
    const chain: LocalPoint[] = [];
    for (const point of source) {
      while (chain.length >= 2 && cross(chain[chain.length - 2]!, chain[chain.length - 1]!, point) <= 0n) chain.pop();
      chain.push(point);
    }
    chain.pop();
    return chain;
  };
  const lower = build(unique);
  const upper = build([...unique].reverse());
  const hull = [...lower, ...upper];
  return hull.length < 3 ? [] : hull;
}

interface RectangleCandidate {
  /** Doubled-precision area numerator: `spanU * spanV`, in mm^2 * |e|^2. */
  areaNumerator: bigint;
  /** `|e|^2`, the shared denominator of this candidate's area. */
  lengthSquared: bigint;
  orientationX: bigint;
  orientationY: bigint;
  widthMm: bigint;
  depthMm: bigint;
  centerXMm: bigint;
  centerYMm: bigint;
}

/**
 * Canonicalizes a rectangle axis into the half plane `x > 0 or (x === 0 and
 * y > 0)` and reduces it by gcd, so the same geometric orientation always
 * yields the same integer pair regardless of hull traversal direction.
 */
function canonicalAxis(x: bigint, y: bigint): { x: bigint; y: bigint } {
  const divisor = gcdBigInt(x, y);
  let reducedX = x / divisor;
  let reducedY = y / divisor;
  if (reducedX < 0n || (reducedX === 0n && reducedY < 0n)) {
    reducedX = -reducedX;
    reducedY = -reducedY;
  }
  return { x: reducedX, y: reducedY };
}

/**
 * Orders two canonical axes by their signed yaw in `(-90, 90]` degrees, using
 * the exact rational slope `y / x` rather than any inverse trigonometric
 * function.  A vertical axis (`x === 0`) is the largest yaw.
 */
function compareAxisYaw(left: { x: bigint; y: bigint }, right: { x: bigint; y: bigint }): number {
  if (left.x === 0n && right.x === 0n) return 0;
  if (left.x === 0n) return 1;
  if (right.x === 0n) return -1;
  const difference = left.y * right.x - right.y * left.x;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

/** True when `left` is a strictly better candidate than `right`. */
function betterCandidate(left: RectangleCandidate, right: RectangleCandidate): boolean {
  const leftArea = left.areaNumerator * right.lengthSquared;
  const rightArea = right.areaNumerator * left.lengthSquared;
  if (leftArea !== rightArea) return leftArea < rightArea;
  return compareAxisYaw({ x: left.orientationX, y: left.orientationY }, { x: right.orientationX, y: right.orientationY }) < 0;
}

/**
 * Deterministic minimum-area rotated rectangle over integer millimetre points.
 *
 * By the rotating-calipers theorem a minimum-area enclosing rectangle has one
 * side collinear with a convex-hull edge, so the candidate set is exactly the
 * hull edges.  For each edge `e` every hull point is projected onto `e` and its
 * left normal with integer dot and cross products, which needs no angle and no
 * floating point.  Areas are compared as exact rationals
 * `spanU * spanV / |e|^2`; ties go to the smaller yaw.
 *
 * Side lengths are recovered as `span * 10^6 / floor(|e| * 10^6)`, where
 * `floor(|e| * 10^6)` is an exact integer square root.  The 10^6 scale keeps
 * the recovered millimetre lengths accurate to well under one micrometre.
 */
function minimumAreaRectangle(hull: readonly LocalPoint[]): RectangleCandidate | null {
  let best: RectangleCandidate | null = null;
  for (let index = 0; index < hull.length; index += 1) {
    const origin = hull[index]!;
    const next = hull[(index + 1) % hull.length]!;
    const edgeX = next.x - origin.x;
    const edgeY = next.y - origin.y;
    const lengthSquared = edgeX * edgeX + edgeY * edgeY;
    if (lengthSquared === 0n) continue;
    let minimumU = 0n;
    let maximumU = 0n;
    let minimumV = 0n;
    let maximumV = 0n;
    for (const point of hull) {
      const deltaX = point.x - origin.x;
      const deltaY = point.y - origin.y;
      const u = edgeX * deltaX + edgeY * deltaY;
      const v = edgeX * deltaY - edgeY * deltaX;
      if (u < minimumU) minimumU = u;
      if (u > maximumU) maximumU = u;
      if (v < minimumV) minimumV = v;
      if (v > maximumV) maximumV = v;
    }
    const spanU = maximumU - minimumU;
    const spanV = maximumV - minimumV;
    const lengthScaled = isqrtBigInt(lengthSquared * SCALE_SQUARED);
    if (lengthScaled === 0n) continue;
    const sideU = roundDiv(spanU * SCALE, lengthScaled);
    const sideV = roundDiv(spanV * SCALE, lengthScaled);
    // The +u axis is always the longer side, so the same rectangle found from
    // an edge and from its perpendicular collapses onto one descriptor.
    const longEdgeIsU = sideU >= sideV;
    const axis = canonicalAxis(longEdgeIsU ? edgeX : -edgeY, longEdgeIsU ? edgeY : edgeX);
    const doubledCenterU = minimumU + maximumU;
    const doubledCenterV = minimumV + maximumV;
    const candidate: RectangleCandidate = {
      areaNumerator: spanU * spanV,
      lengthSquared,
      orientationX: axis.x,
      orientationY: axis.y,
      widthMm: longEdgeIsU ? sideU : sideV,
      depthMm: longEdgeIsU ? sideV : sideU,
      centerXMm: origin.x + roundDiv(edgeX * doubledCenterU - edgeY * doubledCenterV, lengthSquared * 2n),
      centerYMm: origin.y + roundDiv(edgeY * doubledCenterU + edgeX * doubledCenterV, lengthSquared * 2n),
    };
    if (!best || betterCandidate(candidate, best)) best = candidate;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Height and parameter derivation
// ---------------------------------------------------------------------------

interface HeightDerivation {
  heightSource: "source" | "fallback";
  unquantizedHeightMm: number;
  quantizedHeightMm: number;
  residualMm: number;
  floorCount: number;
  floorHeightMm: number;
  forcedTwoFloor: boolean;
}

function deriveHeight(source: FullSnapshotBuildingSource): HeightDerivation | null {
  const rules = EXTERIOR_FULLSNAPSHOT_HEIGHT_RULES;
  const useFallback = source.heightUnknown || source.heightMeters === null;
  const unquantizedHeightMm = useFallback
    ? rules.unknownHeightFallbackMm
    : Math.round((source.heightMeters as number) * 1000);
  if (!Number.isSafeInteger(unquantizedHeightMm) || unquantizedHeightMm < 1) return null;
  const nominalFloorCount = Math.floor((unquantizedHeightMm + rules.targetFloorHeightMm / 2) / rules.targetFloorHeightMm);
  const floorCount = Math.max(rules.minimumFloorCount, nominalFloorCount);
  const floorHeightMm = Math.floor(unquantizedHeightMm / floorCount);
  if (floorHeightMm < 1) return null;
  const quantizedHeightMm = floorCount * floorHeightMm;
  return {
    heightSource: useFallback ? "fallback" : "source",
    unquantizedHeightMm,
    quantizedHeightMm,
    residualMm: unquantizedHeightMm - quantizedHeightMm,
    floorCount,
    floorHeightMm,
    forcedTwoFloor: nominalFloorCount < rules.minimumFloorCount,
  };
}

/**
 * Derives every generation parameter from the rectangle dimensions and the
 * quantized floor height as exact integer fractions, so a tiny building yields
 * a small but still schema-valid grammar rather than a clamped one.
 */
function deriveParameters(widthMm: number, depthMm: number, floorCount: number, floorHeightMm: number): { parameters: FacadeGeneratorParameters; forcedTwoBay: boolean } | null {
  const rules = EXTERIOR_FULLSNAPSHOT_HEIGHT_RULES;
  const minimumDimension = Math.min(widthMm, depthMm);
  const nominalBayCount = Math.floor(minimumDimension / rules.targetBayWidthMm);
  const bayCount = Math.max(2, nominalBayCount);
  const minimumBay = Math.floor(minimumDimension / bayCount);
  if (minimumBay < rules.minimumBayWidthMm) return null;
  const openingInsetMm = Math.max(1, Math.floor(minimumBay / 10));
  const usableBayMm = minimumBay - openingInsetMm * 2;
  if (usableBayMm < 2) return null;
  const verticalGapMm = Math.max(1, Math.floor(floorHeightMm / 10));
  const corniceHeightMm = Math.max(1, Math.floor(floorHeightMm / 10));
  const windowSillMm = Math.max(1, Math.floor(floorHeightMm / 4));
  const windowHeightMm = floorHeightMm - windowSillMm - corniceHeightMm - verticalGapMm;
  if (windowHeightMm < 1) return null;
  const parameters: FacadeGeneratorParameters = {
    floorCount,
    bayCount,
    floorHeightMm,
    windowWidthMm: Math.max(1, Math.floor(usableBayMm / 2)),
    windowHeightMm,
    windowSillMm,
    openingInsetMm,
    entranceWidthMm: Math.max(1, Math.floor((usableBayMm * 3) / 4)),
    entranceHeightMm: Math.max(1, Math.floor((floorHeightMm * 7) / 10)),
    storefrontHeightMm: Math.max(1, Math.floor((floorHeightMm * 4) / 5)),
    corniceHeightMm,
    roofEquipmentSizeMm: Math.max(1, Math.floor(minimumDimension / 5)),
  };
  return { parameters, forcedTwoBay: nominalBayCount < 2 };
}

/** Placement count the accepted generator will produce for these parameters. */
export function fullSnapshotPlacementCount(parameters: FacadeGeneratorParameters): number {
  return 4 * (parameters.floorCount - 1) * parameters.bayCount + parameters.bayCount + 5;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

function issue(buildingId: string, code: FullSnapshotInputIssueCode, detail: string): { ok: false; issues: readonly FullSnapshotInputIssue[] } {
  return { ok: false, issues: [{ buildingId, code, detail }] };
}

/**
 * Rejects any `undefined` reaching a run record.  `stableSerialize` renders
 * `undefined` and `null` identically, so an accidentally omitted field would
 * silently alias an explicit `null` inside the run digest.
 */
export function assertFullSnapshotRunRecord(record: FullSnapshotRunRecord): FullSnapshotRunRecord {
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) throw new TypeError(`Run record field ${key} is undefined; run records forbid undefined fields.`);
  }
  return record;
}

/**
 * Builds the deterministic facade input and truth record for one accepted
 * building of the pinned snapshot.
 */
export function buildExteriorFullSnapshotInput(
  source: FullSnapshotBuildingSource,
  options: { baseManifestChecksumSha256: string },
): FullSnapshotInputResult {
  if (options.baseManifestChecksumSha256 !== EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256) {
    return issue(source.buildingId, "unsupported-base-manifest", `The pinned generation instant is defined only for ${EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256}.`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9:._-]*$/u.test(source.buildingId) || source.buildingId.length > DETERMINISTIC_FACADE_LIMITS.maxInputIdLength) {
    return issue(source.buildingId, "invalid-identity", "Building id is not a bounded safe identifier.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9:._-]*$/u.test(source.sourceRefId) || source.sourceRefId.length > DETERMINISTIC_FACADE_LIMITS.maxInputIdLength) {
    return issue(source.buildingId, "invalid-identity", "Source reference id is not a bounded safe identifier.");
  }

  const originLongitudeNanodegrees = degreesToNanodegrees(source.representative[0]);
  const originLatitudeNanodegrees = degreesToNanodegrees(source.representative[1]);
  const outer = projectRing(source.outerRing, originLongitudeNanodegrees, originLatitudeNanodegrees);
  if (outer.length < 3) return issue(source.buildingId, "degenerate-footprint", `Projected outer ring collapsed to ${outer.length} distinct millimetre vertices.`);
  const hull = convexHull(outer);
  if (hull.length < 3) return issue(source.buildingId, "degenerate-footprint", "Projected outer ring is collinear at millimetre resolution.");
  const rectangle = minimumAreaRectangle(hull);
  if (!rectangle) return issue(source.buildingId, "degenerate-footprint", "No convex-hull edge produced a rectangle candidate.");

  const widthMm = Number(rectangle.widthMm);
  const depthMm = Number(rectangle.depthMm);
  if (depthMm < EXTERIOR_FULLSNAPSHOT_HEIGHT_RULES.minimumRectangleSideMm || widthMm > DETERMINISTIC_FACADE_LIMITS.maxLocalMillimeters) {
    return issue(source.buildingId, "degenerate-rectangle", `Minimum-area rectangle is ${widthMm} x ${depthMm} mm; the shorter side must reach ${EXTERIOR_FULLSNAPSHOT_HEIGHT_RULES.minimumRectangleSideMm} mm.`);
  }

  const height = deriveHeight(source);
  if (!height) return issue(source.buildingId, "invalid-height", `Height ${String(source.heightMeters)} m does not quantize to a positive integer storey.`);
  const derived = deriveParameters(widthMm, depthMm, height.floorCount, height.floorHeightMm);
  if (!derived) return issue(source.buildingId, "degenerate-rectangle", `A ${widthMm} x ${depthMm} mm footprint at ${height.floorHeightMm} mm storeys admits no schema-valid grammar.`);
  const parameters = derived.parameters;

  // Caps are fail-closed conditions, never clamps: a firing cap means the input
  // drifted outside the envelope this task measured.
  if (parameters.floorCount > DETERMINISTIC_FACADE_LIMITS.maxFloors) return issue(source.buildingId, "cap-exceeded", `floorCount ${parameters.floorCount} exceeds ${DETERMINISTIC_FACADE_LIMITS.maxFloors}.`);
  if (parameters.bayCount > DETERMINISTIC_FACADE_LIMITS.maxBays) return issue(source.buildingId, "cap-exceeded", `bayCount ${parameters.bayCount} exceeds ${DETERMINISTIC_FACADE_LIMITS.maxBays}.`);
  const placementCount = fullSnapshotPlacementCount(parameters);
  if (placementCount > DETERMINISTIC_FACADE_LIMITS.maxPlacements) return issue(source.buildingId, "cap-exceeded", `placementCount ${placementCount} exceeds ${DETERMINISTIC_FACADE_LIMITS.maxPlacements}.`);

  const holePoints = source.holeRings.map((ring) => projectRing(ring, originLongitudeNanodegrees, originLatitudeNanodegrees));
  const doubledTrueArea = doubledRingArea(outer);
  const doubledHoleArea = holePoints.reduce((total, ring) => total + (ring.length >= 3 ? doubledRingArea(ring) : 0n), 0n);
  const proxyArea = rectangle.widthMm * rectangle.depthMm;
  const areaRatioPartsPerMillion = doubledTrueArea === 0n ? 0 : Number(roundDiv(proxyArea * 2n * 1_000_000n, doubledTrueArea));

  // The cheaper alternative this proxy replaces, measured on the same ring so
  // the comparison lives in committed evidence rather than a one-off script.
  let minimumX = outer[0]!.x;
  let maximumX = outer[0]!.x;
  let minimumY = outer[0]!.y;
  let maximumY = outer[0]!.y;
  for (const point of outer) {
    if (point.x < minimumX) minimumX = point.x;
    if (point.x > maximumX) maximumX = point.x;
    if (point.y < minimumY) minimumY = point.y;
    if (point.y > maximumY) maximumY = point.y;
  }
  const axisAlignedArea = (maximumX - minimumX) * (maximumY - minimumY);
  const axisAlignedAreaRatioPartsPerMillion = doubledTrueArea === 0n ? 0 : Number(roundDiv(axisAlignedArea * 2n * 1_000_000n, doubledTrueArea));

  let maximumSpanSquared = 0n;
  for (let left = 0; left < hull.length; left += 1) {
    for (let right = left + 1; right < hull.length; right += 1) {
      const deltaX = hull[right]!.x - hull[left]!.x;
      const deltaY = hull[right]!.y - hull[left]!.y;
      const span = deltaX * deltaX + deltaY * deltaY;
      if (span > maximumSpanSquared) maximumSpanSquared = span;
    }
  }

  const heightAnchorId = height.heightSource === "fallback"
    ? EXTERIOR_FULLSNAPSHOT_HEIGHT_FALLBACK_ANCHOR_ID
    : EXTERIOR_FULLSNAPSHOT_HEIGHT_ANCHOR_ID;
  const sourceAnchors: FacadeSourceAnchor[] = [
    {
      id: EXTERIOR_FULLSNAPSHOT_FOOTPRINT_ANCHOR_ID,
      kind: "footprint",
      sourceRefId: source.sourceRefId,
      fingerprintSha256: domainSeparatedSha256("udt.fullsnapshot.footprint.v1", {
        buildingId: source.buildingId,
        originLongitudeNanodegrees,
        originLatitudeNanodegrees,
        outer: source.outerRing.map((vertex) => [degreesToNanodegrees(vertex[0]), degreesToNanodegrees(vertex[1])]),
        holes: source.holeRings.map((ring) => ring.map((vertex) => [degreesToNanodegrees(vertex[0]), degreesToNanodegrees(vertex[1])])),
        proxy: EXTERIOR_FULLSNAPSHOT_FOOTPRINT_PROXY_ID,
      }),
    },
    {
      id: heightAnchorId,
      kind: "height",
      sourceRefId: source.sourceRefId,
      fingerprintSha256: domainSeparatedSha256("udt.fullsnapshot.height.v1", {
        buildingId: source.buildingId,
        heightMeters: source.heightMeters,
        heightUnknown: source.heightUnknown,
        heightSource: height.heightSource,
        unquantizedHeightMm: height.unquantizedHeightMm,
      }),
    },
  ];

  const input: DeterministicFacadeInput = {
    schemaVersion: DETERMINISTIC_FACADE_SCHEMA_VERSION,
    buildingId: source.buildingId,
    generatedAt: EXTERIOR_FULLSNAPSHOT_GENERATED_AT,
    seed: domainSeparatedSha256("udt.fullsnapshot.seed.v1", {
      buildingId: source.buildingId,
      baseManifestChecksumSha256: options.baseManifestChecksumSha256,
    }),
    tool: { id: DETERMINISTIC_FACADE_GENERATOR_ID, version: DETERMINISTIC_FACADE_GENERATOR_VERSION },
    geometry: {
      unit: "millimeter",
      footprint: { outer: [[0, 0], [widthMm, 0], [widthMm, depthMm], [0, depthMm]], holes: [] },
      baseElevationMm: 0,
      heightMm: height.quantizedHeightMm,
    },
    sourceAnchors,
    parameters,
  };

  const record = assertFullSnapshotRunRecord({
    schemaVersion: EXTERIOR_FULLSNAPSHOT_INPUT_SCHEMA_VERSION,
    buildingId: source.buildingId,
    originLongitudeNanodegrees,
    originLatitudeNanodegrees,
    footprintProxy: EXTERIOR_FULLSNAPSHOT_FOOTPRINT_PROXY_ID,
    orientationXMm: Number(rectangle.orientationX),
    orientationYMm: Number(rectangle.orientationY),
    centerOffsetXMm: Number(rectangle.centerXMm),
    centerOffsetYMm: Number(rectangle.centerYMm),
    widthMm,
    depthMm,
    trueAreaMm2: Number(roundDiv(doubledTrueArea, 2n)),
    holeAreaMm2: Number(roundDiv(doubledHoleArea, 2n)),
    proxyAreaMm2: Number(proxyArea),
    areaRatioPartsPerMillion,
    axisAlignedAreaRatioPartsPerMillion,
    holeRingsDropped: source.holeRings.length,
    sourceVertexCount: Math.max(0, source.outerRing.length - 1),
    hullVertexCount: hull.length,
    maximumSpanMm: Number(roundDiv(isqrtBigInt(maximumSpanSquared * SCALE_SQUARED), SCALE)),
    heightSource: height.heightSource,
    unquantizedHeightMm: height.unquantizedHeightMm,
    quantizedHeightMm: height.quantizedHeightMm,
    heightResidualMm: height.residualMm,
    floorCount: height.floorCount,
    floorHeightMm: height.floorHeightMm,
    bayCount: parameters.bayCount,
    forcedTwoFloor: height.forcedTwoFloor,
    forcedTwoBay: derived.forcedTwoBay,
    placementCount,
  });

  return { ok: true, input, record };
}
