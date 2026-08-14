/**
 * Costing and silhouette arithmetic for the citywide overview-tier decision
 * (Task T001, ADR 0040).
 *
 * The decision compares three candidates for showing real building shapes
 * island-wide at overview zoom. Every number the decision quotes is produced
 * here or by `scripts/citywide-overview-census-cli.mjs`, so the ADR can be
 * re-derived rather than believed.
 *
 * Nothing in this module writes, publishes or activates anything. It computes.
 */
import type { V3Plan, Point2Mm } from "../domain/deterministic-facade-generator-v3.ts";

export const CITYWIDE_OVERVIEW_TIER_SCHEMA_VERSION = "1.0" as const;

// ---------------------------------------------------------------------------
// Coarse-prism geometry
// ---------------------------------------------------------------------------

/**
 * The coarse representation under consideration: the sourced outer ring,
 * extruded from grade to the building's top, with no setback steps, no
 * openings, no attached elements and no texture.
 *
 * It is a SILHOUETTE COLLAPSE. It keeps the footprint vertex for vertex and the
 * total height, and it discards every tier step above the first. Whether that
 * is acceptable is exactly what `prismSilhouetteDeviation` measures.
 */
export interface CoarsePrismGeometry {
  ringVertexCount: number;
  /** Side quads: one per ring edge. */
  quadCount: number;
  /** Cap triangles: a fan over the ring, once for the roof and once for the floor when closed. */
  triangleCount: number;
  /** Unshared vertices, as the canonical writer emits them: 4 per quad, 3 per triangle. */
  vertexCount: number;
  /** Total triangles including the two triangles each side quad decomposes into. */
  totalTriangleCount: number;
}

/**
 * Geometry counts for a coarse prism over an `n`-vertex ring.
 *
 * `closed` controls whether a floor cap is emitted. A floor cap is invisible
 * from any camera above grade and costs `n-2` triangles per building — about
 * 500,000 triangles island-wide — so whether it is emitted is a real decision
 * and not a detail. It is `false` by default because the analytic volume
 * identity is NOT among the gates this tier can pass anyway (ADR 0040), so the
 * usual reason to keep a mesh closed does not apply.
 */
export function coarsePrismGeometry(ringVertexCount: number, options: { closed?: boolean } = {}): CoarsePrismGeometry {
  if (!Number.isInteger(ringVertexCount) || ringVertexCount < 3) {
    throw new Error(`A coarse prism needs at least 3 ring vertices; received ${ringVertexCount}.`);
  }
  const caps = options.closed === true ? 2 : 1;
  const quadCount = ringVertexCount;
  const triangleCount = caps * (ringVertexCount - 2);
  return {
    ringVertexCount,
    quadCount,
    triangleCount,
    vertexCount: quadCount * 4 + triangleCount * 3,
    totalTriangleCount: quadCount * 2 + triangleCount,
  };
}

// ---------------------------------------------------------------------------
// Projected-silhouette deviation, computed analytically
// ---------------------------------------------------------------------------

export const CITYWIDE_OVERVIEW_SILHOUETTE_METRIC = {
  metricId: "prism-vs-tiered-orthographic-staircase-v1",
  /**
   * Eight horizontal orthographic azimuths, 45 degrees apart, starting at north.
   *
   * Horizontal views only: the deviation this metric bounds is the setback
   * STEP, which is invisible from directly above and maximal from the side.
   */
  viewIds: ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"] as const,
  azimuthDegrees: [0, 45, 90, 135, 180, 225, 270, 315] as const,
} as const;

/** One of the eight stated horizontal orthographic views. */
export type CitywideOverviewViewId = (typeof CITYWIDE_OVERVIEW_SILHOUETTE_METRIC.viewIds)[number];

export interface SilhouetteDeviation {
  /** Symmetric-difference area over reference area, worst over all views. */
  deviationRatio: number;
  worstViewId: CitywideOverviewViewId;
  /** Largest horizontal setback inset visible in any view, in metres. */
  maxHorizontalErrorMeters: number;
  /** Per-view ratios, in `CITYWIDE_OVERVIEW_SILHOUETTE_METRIC.viewIds` order. */
  perView: number[];
}

/**
 * Deviation of a coarse prism from the V3 tiered massing it would replace.
 *
 * The arithmetic is exact rather than rasterized, and it can be, because both
 * shapes are unions of axis-aligned rectangles in every horizontal orthographic
 * view. Project each tier ring onto the view's horizontal axis: tier `i`
 * silhouettes as the rectangle `[minU_i, maxU_i] x [baseZ_i, topZ_i]`. The V3
 * massing is the union of those rectangles; the coarse prism is
 * `[minU_0, maxU_0] x [0, topZ_last]`.
 *
 * Tier rings are produced by inward offset and are contained in the tier below
 * (`planTiers` refuses an offset that is not), so the union is a staircase
 * whose every rectangle is inside the prism. The symmetric difference is
 * therefore exactly `prismArea - massingArea` and needs no clipping.
 *
 * The denominator is the MASSING area — the finer representation the coarse one
 * is being judged against — so the ratio reads as "how much silhouette this
 * tier adds relative to the truth it replaces". Rooftop prisms are ignored:
 * they are additive detail above the massing and would only ever reduce the
 * measured gap, so ignoring them is the conservative choice.
 */
export function prismSilhouetteDeviation(plan: V3Plan): SilhouetteDeviation {
  const tiers = plan.tiers;
  if (tiers.length === 0) throw new Error("A V3 plan always carries at least one tier.");
  const topZMm = Math.max(...tiers.map((tier) => tier.topZMm));
  const baseZMm = Math.min(...tiers.map((tier) => tier.baseZMm));
  const perView: number[] = [];
  let worst = 0;
  let worstViewId: CitywideOverviewViewId = CITYWIDE_OVERVIEW_SILHOUETTE_METRIC.viewIds[0];
  let maxHorizontalErrorMm = 0;

  for (const [index, azimuth] of CITYWIDE_OVERVIEW_SILHOUETTE_METRIC.azimuthDegrees.entries()) {
    // Horizontal screen axis for a camera looking along `azimuth`.
    const radians = (azimuth * Math.PI) / 180;
    const ux = Math.cos(radians);
    const uy = -Math.sin(radians);
    const span = (ring: readonly Point2Mm[]): { min: number; max: number } => {
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (const [x, y] of ring) {
        const u = x * ux + y * uy;
        if (u < min) min = u;
        if (u > max) max = u;
      }
      return { min, max };
    };
    const baseSpan = span(tiers[0]!.ring);
    const prismWidth = baseSpan.max - baseSpan.min;
    const prismArea = prismWidth * (topZMm - baseZMm);
    let massingArea = 0;
    for (const tier of tiers) {
      const tierSpan = span(tier.ring);
      massingArea += (tierSpan.max - tierSpan.min) * (tier.topZMm - tier.baseZMm);
      const inset = Math.max(tierSpan.min - baseSpan.min, baseSpan.max - tierSpan.max);
      if (inset > maxHorizontalErrorMm) maxHorizontalErrorMm = inset;
    }
    const ratio = massingArea <= 0 ? Number.POSITIVE_INFINITY : (prismArea - massingArea) / massingArea;
    perView.push(ratio);
    if (ratio > worst) {
      worst = ratio;
      worstViewId = CITYWIDE_OVERVIEW_SILHOUETTE_METRIC.viewIds[index]!;
    }
  }

  return {
    deviationRatio: worst,
    worstViewId,
    maxHorizontalErrorMeters: maxHorizontalErrorMm / 1_000,
    perView,
  };
}

// ---------------------------------------------------------------------------
// Screen-space error
// ---------------------------------------------------------------------------

export interface ScreenSpaceErrorInput {
  /** Geometric error of the tier, in metres. */
  geometricErrorMeters: number;
  /** Camera distance at which the tier would be selected, in metres. */
  distanceMeters: number;
  /** Vertical field of view, in degrees. */
  verticalFieldOfViewDegrees: number;
  /** Drawing-buffer height in device pixels. */
  viewportHeightPixels: number;
}

/**
 * Screen-space error in device pixels.
 *
 * `deviationRatio` is a ratio of areas and says nothing about whether a viewer
 * can see the difference; this says how many pixels the error subtends at the
 * distance the tier is actually selected. Both are reported, because a tier can
 * pass one and fail the other and the schema only checks the first.
 */
export function screenSpaceErrorPixels(input: ScreenSpaceErrorInput): number {
  if (input.distanceMeters <= 0) return Number.POSITIVE_INFINITY;
  const halfFov = (input.verticalFieldOfViewDegrees * Math.PI) / 360;
  const metersPerPixel = (2 * input.distanceMeters * Math.tan(halfFov)) / input.viewportHeightPixels;
  return input.geometricErrorMeters / metersPerPixel;
}

// ---------------------------------------------------------------------------
// Wire, GPU and request costing
// ---------------------------------------------------------------------------

export interface CandidateCostInput {
  candidateId: string;
  /** Bytes transferred to show the whole island at overview. */
  wireBytes: number;
  /** Decoded bytes resident on the GPU for the same view. */
  gpuBytes: number;
  /** Draw calls issued per frame at overview. */
  drawCalls: number;
  /** HTTP requests needed to complete the overview. */
  requestCount: number;
  /** Measured per-request round-trip floor, in milliseconds. */
  perRequestMilliseconds: number;
  /** Concurrent request permits available to this loader. */
  concurrency: number;
  /** Distinct runtime cache entries the overview occupies. */
  cacheEntries: number;
}

export interface CandidateCost extends CandidateCostInput {
  /** Serialized request time at the stated concurrency, in seconds. */
  timeToCompleteOverviewSeconds: number;
  wireMebibytes: number;
  gpuMebibytes: number;
}

/**
 * Time to complete the overview at a stated concurrency.
 *
 * Deliberately the simple `ceil(requests / concurrency) * perRequest` model:
 * the concurrency permit is a hard ceiling and the responses are served from a
 * local origin with `cache: "no-store"`, so there is neither a warm cache nor a
 * long tail to model. It is a FLOOR, not a prediction, and the ADR quotes it as
 * one.
 */
export function costCandidate(input: CandidateCostInput): CandidateCost {
  if (input.concurrency <= 0) throw new Error("Concurrency must be positive.");
  const waves = Math.ceil(input.requestCount / input.concurrency);
  return {
    ...input,
    timeToCompleteOverviewSeconds: Math.round((waves * input.perRequestMilliseconds) / 100) / 10,
    wireMebibytes: Math.round((input.wireBytes / 1048576) * 100) / 100,
    gpuMebibytes: Math.round((input.gpuBytes / 1048576) * 100) / 100,
  };
}

export interface BudgetCheck {
  id: string;
  limit: number;
  observed: number;
  ok: boolean;
  /** Factor by which the observed value exceeds the limit; 0 when within. */
  overBy: number;
}

/** Check a candidate against a recorded contract's ceilings. */
export function checkCandidateBudgets(
  cost: CandidateCost,
  limits: { wireBytes?: number; gpuBytes?: number; drawCalls?: number; cacheEntries?: number; timeToCompleteOverviewSeconds?: number },
): BudgetCheck[] {
  const pairs: Array<[string, number | undefined, number]> = [
    ["wire-bytes", limits.wireBytes, cost.wireBytes],
    ["gpu-bytes", limits.gpuBytes, cost.gpuBytes],
    ["draw-calls", limits.drawCalls, cost.drawCalls],
    ["cache-entries", limits.cacheEntries, cost.cacheEntries],
    ["time-to-complete-overview-seconds", limits.timeToCompleteOverviewSeconds, cost.timeToCompleteOverviewSeconds],
  ];
  return pairs
    .filter((pair): pair is [string, number, number] => pair[1] !== undefined)
    .map(([id, limit, observed]) => ({
      id,
      limit,
      observed,
      ok: observed <= limit,
      overBy: observed <= limit ? 0 : Math.round((observed / limit) * 1000) / 1000,
    }));
}

// ---------------------------------------------------------------------------
// Aggregate skyline deviation across a cell
// ---------------------------------------------------------------------------

/** One axis-aligned rectangle in a projected (horizontal, vertical) view plane. */
export interface ViewRectangle { uMin: number; uMax: number; zMin: number; zMax: number }

/**
 * Exact area of a union of axis-aligned rectangles, by coordinate compression.
 *
 * Per-building deviation is not the whole story at city scale: a setback step
 * that is 25% of one building's silhouette can be entirely hidden behind its
 * neighbour, and the thing a viewer actually sees at overview zoom is the
 * cell's combined profile. That requires a union, not a sum, and a union needs
 * this.
 */
export function unionRectangleArea(rectangles: readonly ViewRectangle[]): number {
  const live = rectangles.filter((rectangle) => rectangle.uMax > rectangle.uMin && rectangle.zMax > rectangle.zMin);
  if (live.length === 0) return 0;
  const uEdges = [...new Set(live.flatMap((rectangle) => [rectangle.uMin, rectangle.uMax]))].sort((left, right) => left - right);
  let area = 0;
  for (let index = 0; index < uEdges.length - 1; index += 1) {
    const uLow = uEdges[index]!;
    const uHigh = uEdges[index + 1]!;
    const width = uHigh - uLow;
    if (width <= 0) continue;
    // Height of the union of the z-intervals of every rectangle covering this strip.
    const intervals = live
      .filter((rectangle) => rectangle.uMin <= uLow && rectangle.uMax >= uHigh)
      .map((rectangle) => [rectangle.zMin, rectangle.zMax] as const)
      .sort((left, right) => left[0] - right[0]);
    let covered = 0;
    let cursor = Number.NEGATIVE_INFINITY;
    for (const [zMin, zMax] of intervals) {
      const start = Math.max(zMin, cursor);
      if (zMax > start) {
        covered += zMax - start;
        cursor = zMax;
      }
    }
    area += width * covered;
  }
  return area;
}

export interface SkylineMember {
  /** Tier rectangles in the cell's own local frame, per tier: ring points and z range. */
  tiers: ReadonlyArray<{ ring: ReadonlyArray<readonly [number, number]>; zMin: number; zMax: number }>;
}

export interface SkylineDeviation {
  deviationRatio: number;
  worstViewId: CitywideOverviewViewId;
  perView: number[];
  memberCount: number;
}

/**
 * Deviation of a whole cell's rendered profile, coarse against V3, per view.
 *
 * The coarse profile of each member is its base tier's horizontal span over the
 * member's full height; the V3 profile is the union of its tier rectangles.
 * Both are unioned ACROSS members before the ratio is taken, so mutual
 * occlusion counts — which is the only reason this number can be smaller than
 * the per-building distribution, and the only honest way to claim that it is.
 */
export function cellSkylineDeviation(members: readonly SkylineMember[]): SkylineDeviation {
  const perView: number[] = [];
  let worst = 0;
  let worstViewId: CitywideOverviewViewId = CITYWIDE_OVERVIEW_SILHOUETTE_METRIC.viewIds[0];
  for (const [index, azimuth] of CITYWIDE_OVERVIEW_SILHOUETTE_METRIC.azimuthDegrees.entries()) {
    const radians = (azimuth * Math.PI) / 180;
    const ux = Math.cos(radians);
    const uy = -Math.sin(radians);
    const coarse: ViewRectangle[] = [];
    const fine: ViewRectangle[] = [];
    for (const member of members) {
      if (member.tiers.length === 0) continue;
      let baseMin = Number.POSITIVE_INFINITY;
      let baseMax = Number.NEGATIVE_INFINITY;
      let zMin = Number.POSITIVE_INFINITY;
      let zMax = Number.NEGATIVE_INFINITY;
      for (const [tierIndex, tier] of member.tiers.entries()) {
        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;
        for (const [x, y] of tier.ring) {
          const u = x * ux + y * uy;
          if (u < min) min = u;
          if (u > max) max = u;
        }
        fine.push({ uMin: min, uMax: max, zMin: tier.zMin, zMax: tier.zMax });
        if (tierIndex === 0) { baseMin = min; baseMax = max; }
        if (tier.zMin < zMin) zMin = tier.zMin;
        if (tier.zMax > zMax) zMax = tier.zMax;
      }
      coarse.push({ uMin: baseMin, uMax: baseMax, zMin, zMax });
    }
    const fineArea = unionRectangleArea(fine);
    const coarseArea = unionRectangleArea(coarse);
    const ratio = fineArea <= 0 ? Number.POSITIVE_INFINITY : (coarseArea - fineArea) / fineArea;
    perView.push(ratio);
    if (ratio > worst) { worst = ratio; worstViewId = CITYWIDE_OVERVIEW_SILHOUETTE_METRIC.viewIds[index]!; }
  }
  return { deviationRatio: worst, worstViewId, perView, memberCount: members.length };
}
