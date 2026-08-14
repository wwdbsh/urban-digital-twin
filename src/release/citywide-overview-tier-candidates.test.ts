import { describe, expect, it } from "vitest";

import type { V3Plan, V3Tier } from "../domain/deterministic-facade-generator-v3.ts";
import {
  CITYWIDE_OVERVIEW_SILHOUETTE_METRIC,
  cellSkylineDeviation,
  checkCandidateBudgets,
  coarsePrismGeometry,
  costCandidate,
  prismSilhouetteDeviation,
  screenSpaceErrorPixels,
  unionRectangleArea,
} from "./citywide-overview-tier-candidates.ts";

/** A square ring of half-width `half` millimetres, centred on the origin. */
function square(half: number): Array<[number, number]> {
  return [[-half, -half], [half, -half], [half, half], [-half, half]];
}

function tier(half: number, baseZMm: number, topZMm: number): V3Tier {
  return { ring: square(half), baseZMm, topZMm } as unknown as V3Tier;
}

function plan(tiers: V3Tier[]): V3Plan {
  return { tiers } as unknown as V3Plan;
}

describe("coarsePrismGeometry", () => {
  it("counts an open prism as n side quads plus one roof fan, with unshared vertices", () => {
    const geometry = coarsePrismGeometry(6);
    expect(geometry).toEqual({ ringVertexCount: 6, quadCount: 6, triangleCount: 4, vertexCount: 36, totalTriangleCount: 16 });
  });

  it("adds a floor fan only when explicitly closed", () => {
    expect(coarsePrismGeometry(6, { closed: true })).toMatchObject({ triangleCount: 8, vertexCount: 48, totalTriangleCount: 20 });
  });

  it("refuses a degenerate ring rather than emitting a zero-area prism", () => {
    expect(() => coarsePrismGeometry(2)).toThrow(/at least 3 ring vertices/u);
    expect(() => coarsePrismGeometry(4.5)).toThrow(/at least 3 ring vertices/u);
  });
});

describe("prismSilhouetteDeviation", () => {
  it("is exactly zero for a single-tier building, because the prism IS the massing", () => {
    const deviation = prismSilhouetteDeviation(plan([tier(5_000, 0, 30_000)]));
    expect(deviation.deviationRatio).toBe(0);
    expect(deviation.maxHorizontalErrorMeters).toBe(0);
    expect(deviation.perView).toHaveLength(CITYWIDE_OVERVIEW_SILHOUETTE_METRIC.viewIds.length);
    expect(deviation.perView.every((ratio) => ratio === 0)).toBe(true);
  });

  it("measures the staircase a setback leaves, exactly", () => {
    // Base 10 m wide over 0..20 m; upper tier 6 m wide over 20..40 m.
    // Massing area = 10*20 + 6*20 = 320; prism = 10*40 = 400; ratio = 80/320 = 0.25.
    const deviation = prismSilhouetteDeviation(plan([tier(5_000, 0, 20_000), tier(3_000, 20_000, 40_000)]));
    expect(deviation.deviationRatio).toBeCloseTo(0.25, 12);
    // The inset is 2 m on the axis-aligned views and 2*sqrt(2) m on the
    // diagonals, where a square's projected span is widest. The reported value
    // is the WORST over the eight views, so it is the diagonal one.
    expect(deviation.maxHorizontalErrorMeters).toBeCloseTo(2 * Math.SQRT2, 9);
  });

  it("exceeds the multi-LOD schema's 0.02 cap for an ordinary two-tier setback", () => {
    // A 0.5 m inset on a 10 m building over the upper half: still above 2%.
    const deviation = prismSilhouetteDeviation(plan([tier(5_000, 0, 20_000), tier(4_500, 20_000, 40_000)]));
    expect(deviation.deviationRatio).toBeGreaterThan(0.02);
  });

  it("reports the worst view rather than an average, and names it", () => {
    // A ring inset on one axis only deviates from the views that see that axis.
    const base = [[-5_000, -5_000], [5_000, -5_000], [5_000, 5_000], [-5_000, 5_000]] as Array<[number, number]>;
    const upper = [[-1_000, -5_000], [1_000, -5_000], [1_000, 5_000], [-1_000, 5_000]] as Array<[number, number]>;
    const deviation = prismSilhouetteDeviation(plan([
      { ring: base, baseZMm: 0, topZMm: 20_000 } as unknown as V3Tier,
      { ring: upper, baseZMm: 20_000, topZMm: 40_000 } as unknown as V3Tier,
    ]));
    expect(deviation.deviationRatio).toBeGreaterThan(Math.max(...deviation.perView.slice(1)) - 1e-9);
    expect(CITYWIDE_OVERVIEW_SILHOUETTE_METRIC.viewIds).toContain(deviation.worstViewId);
    // North looks along +y, so its horizontal axis is x and the inset is fully
    // visible: massing 10*20 + 2*20 = 240, prism 10*40 = 400, ratio 160/240.
    expect(deviation.perView[0]).toBeCloseTo(2 / 3, 10);
  });

  it("refuses a plan with no tiers", () => {
    expect(() => prismSilhouetteDeviation(plan([]))).toThrow(/at least one tier/u);
  });
});

describe("screenSpaceErrorPixels", () => {
  it("scales inversely with distance and linearly with viewport height", () => {
    const at1km = screenSpaceErrorPixels({ geometricErrorMeters: 2, distanceMeters: 1_000, verticalFieldOfViewDegrees: 60, viewportHeightPixels: 1_080 });
    const at2km = screenSpaceErrorPixels({ geometricErrorMeters: 2, distanceMeters: 2_000, verticalFieldOfViewDegrees: 60, viewportHeightPixels: 1_080 });
    expect(at2km).toBeCloseTo(at1km / 2, 10);
    const taller = screenSpaceErrorPixels({ geometricErrorMeters: 2, distanceMeters: 1_000, verticalFieldOfViewDegrees: 60, viewportHeightPixels: 2_160 });
    expect(taller).toBeCloseTo(at1km * 2, 10);
  });

  it("computes the pixel count a stated budget is checked against", () => {
    // 2 m of error at 8 km, 60 degrees vertical FOV, 1080 device pixels.
    const pixels = screenSpaceErrorPixels({ geometricErrorMeters: 2, distanceMeters: 8_000, verticalFieldOfViewDegrees: 60, viewportHeightPixels: 1_080 });
    expect(pixels).toBeCloseTo(0.234, 3);
  });

  it("is infinite at zero distance rather than dividing by zero silently", () => {
    expect(screenSpaceErrorPixels({ geometricErrorMeters: 1, distanceMeters: 0, verticalFieldOfViewDegrees: 60, viewportHeightPixels: 1_080 })).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("unionRectangleArea", () => {
  it("is the plain area for one rectangle and does not double count an overlap", () => {
    expect(unionRectangleArea([{ uMin: 0, uMax: 2, zMin: 0, zMax: 3 }])).toBe(6);
    expect(unionRectangleArea([
      { uMin: 0, uMax: 2, zMin: 0, zMax: 2 },
      { uMin: 1, uMax: 3, zMin: 0, zMax: 2 },
    ])).toBe(6);
  });

  it("handles full containment, disjoint boxes and vertical stacking", () => {
    expect(unionRectangleArea([
      { uMin: 0, uMax: 4, zMin: 0, zMax: 4 },
      { uMin: 1, uMax: 2, zMin: 1, zMax: 2 },
    ])).toBe(16);
    expect(unionRectangleArea([
      { uMin: 0, uMax: 1, zMin: 0, zMax: 1 },
      { uMin: 5, uMax: 6, zMin: 0, zMax: 1 },
    ])).toBe(2);
    expect(unionRectangleArea([
      { uMin: 0, uMax: 2, zMin: 0, zMax: 1 },
      { uMin: 0, uMax: 2, zMin: 3, zMax: 4 },
    ])).toBe(4);
  });

  it("drops degenerate rectangles and is empty-safe", () => {
    expect(unionRectangleArea([])).toBe(0);
    expect(unionRectangleArea([{ uMin: 1, uMax: 1, zMin: 0, zMax: 5 }, { uMin: 0, uMax: 2, zMin: 3, zMax: 3 }])).toBe(0);
  });
});

describe("cellSkylineDeviation", () => {
  it("is zero when every member is a single tier", () => {
    const deviation = cellSkylineDeviation([
      { tiers: [{ ring: square(5_000), zMin: 0, zMax: 20_000 }] },
      { tiers: [{ ring: square(3_000), zMin: 0, zMax: 40_000 }] },
    ]);
    expect(deviation.deviationRatio).toBe(0);
    expect(deviation.memberCount).toBe(2);
  });

  it("is SMALLER than the per-building deviation when a neighbour occludes the step", () => {
    const setback = plan([tier(5_000, 0, 20_000), tier(3_000, 20_000, 40_000)]);
    const alone = prismSilhouetteDeviation(setback).deviationRatio;
    // A taller, wider neighbour occupying the same projected span hides the step
    // from every horizontal view.
    const withNeighbour = cellSkylineDeviation([
      { tiers: [{ ring: square(5_000), zMin: 0, zMax: 20_000 }, { ring: square(3_000), zMin: 20_000, zMax: 40_000 }] },
      { tiers: [{ ring: square(9_000), zMin: 0, zMax: 60_000 }] },
    ]);
    expect(alone).toBeCloseTo(0.25, 10);
    expect(withNeighbour.deviationRatio).toBe(0);
    expect(withNeighbour.deviationRatio).toBeLessThan(alone);
  });

  it("still reports a positive deviation when the step is not occluded", () => {
    const deviation = cellSkylineDeviation([
      { tiers: [{ ring: square(5_000), zMin: 0, zMax: 20_000 }, { ring: square(3_000), zMin: 20_000, zMax: 40_000 }] },
    ]);
    expect(deviation.deviationRatio).toBeCloseTo(0.25, 10);
  });

  it("ignores members with no tiers rather than dividing by zero", () => {
    expect(cellSkylineDeviation([{ tiers: [] }]).deviationRatio).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("costCandidate and checkCandidateBudgets", () => {
  const input = {
    candidateId: "c-no-new-tier",
    wireBytes: 45_903_404,
    gpuBytes: 60_000_000,
    drawCalls: 30,
    requestCount: 56,
    perRequestMilliseconds: 20,
    concurrency: 4,
    cacheEntries: 56,
  };

  it("serializes requests at the stated concurrency as a floor", () => {
    const cost = costCandidate(input);
    // ceil(56 / 4) = 14 waves at 20 ms.
    expect(cost.timeToCompleteOverviewSeconds).toBe(0.3);
    expect(cost.wireMebibytes).toBeCloseTo(43.78, 2);
  });

  it("refuses a non-positive concurrency instead of dividing by zero", () => {
    expect(() => costCandidate({ ...input, concurrency: 0 })).toThrow(/Concurrency must be positive/u);
  });

  it("reports each ceiling it was given, and how far over a failing one is", () => {
    const cost = costCandidate(input);
    const checks = checkCandidateBudgets(cost, { wireBytes: 50_331_648, drawCalls: 10, cacheEntries: 512 });
    expect(checks.map((check) => check.id)).toEqual(["wire-bytes", "draw-calls", "cache-entries"]);
    expect(checks[0]!.ok).toBe(true);
    expect(checks[1]!).toMatchObject({ ok: false, overBy: 3 });
    expect(checks[2]!.ok).toBe(true);
  });

  it("omits ceilings the caller did not state rather than inventing defaults", () => {
    expect(checkCandidateBudgets(costCandidate(input), {})).toEqual([]);
  });
});
