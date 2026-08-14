import { describe, expect, it } from "vitest";

import { EXTERIOR_FULLSNAPSHOT_PROJECTION } from "../domain/exterior-fullsnapshot-input.ts";
import {
  CITYWIDE_OVERHANG_METRIC,
  aggregateCellExtents,
  deriveCellExtent,
  integerHistogram,
  openRing,
  overhangMeters,
  type CellExtentInput,
  type CensusBuildingSource,
} from "./citywide-overview-census.ts";

const BOUNDS = { west: -74, south: 40.7, east: -73.99, north: 40.71 };

function building(overrides: Partial<CensusBuildingSource> & { buildingId: string }): CensusBuildingSource {
  return { outerRing: [], heightMeters: 10, heightUnknown: false, ...overrides };
}

function cell(buildings: readonly CensusBuildingSource[], overrides: Partial<CellExtentInput> = {}): CellExtentInput {
  return { cellId: "cell-a", order: 0, assignmentBounds: BOUNDS, buildings, unknownHeightSubstituteMeters: 10.5, ...overrides };
}

describe("overhangMeters", () => {
  it("is exactly zero inside and on the closed rectangle boundary", () => {
    expect(overhangMeters(-73.995, 40.705, BOUNDS)).toBe(0);
    expect(overhangMeters(BOUNDS.west, BOUNDS.south, BOUNDS)).toBe(0);
    expect(overhangMeters(BOUNDS.east, BOUNDS.north, BOUNDS)).toBe(0);
  });

  it("uses the frozen ADR 0025 citywide scale pair, not a local trigonometric scale", () => {
    expect(CITYWIDE_OVERHANG_METRIC.metersPerDegreeLongitude).toBe(EXTERIOR_FULLSNAPSHOT_PROJECTION.millimetersPerDegreeLongitude / 1_000);
    expect(CITYWIDE_OVERHANG_METRIC.metersPerDegreeLatitude).toBe(EXTERIOR_FULLSNAPSHOT_PROJECTION.millimetersPerDegreeLatitude / 1_000);
    // 0.001 degrees of longitude east of the rectangle.
    expect(overhangMeters(BOUNDS.east + 0.001, 40.705, BOUNDS)).toBeCloseTo(84.412702, 6);
    // 0.001 degrees of latitude south of the rectangle.
    expect(overhangMeters(-73.995, BOUNDS.south - 0.001, BOUNDS)).toBeCloseTo(111.049654, 6);
  });

  it("is the Euclidean distance from the rectangle at a corner, not the larger axis alone", () => {
    const diagonal = overhangMeters(BOUNDS.east + 0.001, BOUNDS.north + 0.001, BOUNDS);
    expect(diagonal).toBeCloseTo(Math.hypot(84.412702, 111.049654), 6);
    expect(diagonal).toBeGreaterThan(111.049654);
  });
});

describe("openRing", () => {
  it("drops a trailing duplicate of the first vertex and leaves an already-open ring alone", () => {
    const closed: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 0]];
    expect(openRing(closed)).toHaveLength(3);
    expect(openRing([[0, 0], [1, 0], [1, 1]])).toHaveLength(3);
    expect(openRing([])).toHaveLength(0);
  });
});

describe("integerHistogram", () => {
  it("reports exact value buckets ascending, with observed-value quantiles", () => {
    const histogram = integerHistogram([4, 4, 5, 4, 8, 6]);
    expect(histogram.buckets).toEqual([
      { value: 4, count: 3 },
      { value: 5, count: 1 },
      { value: 6, count: 1 },
      { value: 8, count: 1 },
    ]);
    expect(histogram.count).toBe(6);
    expect(histogram.min).toBe(4);
    expect(histogram.max).toBe(8);
    expect(histogram.median).toBe(4);
    expect(histogram.p95).toBe(8);
    expect(histogram.mean).toBe(5.1667);
  });

  it("is empty-safe and refuses a non-integer rather than rounding a count", () => {
    expect(integerHistogram([])).toMatchObject({ count: 0, min: null, max: null, median: null, mean: null, buckets: [] });
    expect(() => integerHistogram([3, 4.5])).toThrow(/requires integers/u);
  });
});

describe("deriveCellExtent", () => {
  it("returns the assignment rectangle unchanged when nothing overhangs", () => {
    const row = deriveCellExtent(cell([
      building({ buildingId: "a", outerRing: [[-73.997, 40.703], [-73.996, 40.703], [-73.996, 40.704], [-73.997, 40.703]] }),
    ]));
    expect(row.renderBounds).toEqual(BOUNDS);
    expect(row.maxOverhangMeters).toBe(0);
    expect(row.overhangBuildingCount).toBe(0);
    expect(row.maxOverhangBuildingId).toBeNull();
    // The closing duplicate is not counted.
    expect(row.outerRingVertexCount).toBe(3);
  });

  it("widens the render extent to the overhanging vertex and attributes the worst overhang", () => {
    const row = deriveCellExtent(cell([
      building({ buildingId: "inside", outerRing: [[-73.995, 40.705]] }),
      building({ buildingId: "over-east", outerRing: [[-73.995, 40.705], [-73.9885, 40.705]] }),
    ]));
    expect(row.renderBounds).toEqual({ ...BOUNDS, east: -73.9885 });
    expect(row.maxOverhangBuildingId).toBe("over-east");
    expect(row.overhangBuildingCount).toBe(1);
    expect(row.maxOverhangMeters).toBeCloseTo(0.0015 * CITYWIDE_OVERHANG_METRIC.metersPerDegreeLongitude, 6);
  });

  it("reproduces an ADR 0024 scale worst case: a single member overhanging by 248.2 m", () => {
    // 248.2 m east of the assignment rectangle at the frozen longitude scale.
    const degrees = 248.2 / CITYWIDE_OVERHANG_METRIC.metersPerDegreeLongitude;
    const row = deriveCellExtent(cell([
      building({ buildingId: "doitt:308707-like", outerRing: [[-73.995, 40.705], [BOUNDS.east + degrees, 40.705]] }),
    ]));
    expect(row.maxOverhangMeters).toBeCloseTo(248.2, 6);
    expect(row.maxOverhangBuildingId).toBe("doitt:308707-like");
    expect(row.renderBounds.east).toBeCloseTo(BOUNDS.east + degrees, 12);
    // The render extent is ~2.94 mdeg wider than a 10 mdeg cell: a 29% extent
    // increase from ONE member, which is why cell bounds cannot be a cull rect.
    expect(row.renderBounds.east - BOUNDS.east).toBeCloseTo(0.00294, 6);
  });

  it("counts substituted heights separately and never reports a substitute as sourced", () => {
    const sourced = deriveCellExtent(cell([
      building({ buildingId: "a", outerRing: [[-73.995, 40.705]], heightMeters: 42 }),
      building({ buildingId: "b", outerRing: [[-73.995, 40.705]], heightMeters: null, heightUnknown: true }),
    ]));
    expect(sourced.maxTopMeters).toBe(42);
    expect(sourced.maxTopSource).toBe("source");
    expect(sourced.unknownHeightCount).toBe(1);

    const substituted = deriveCellExtent(cell([
      building({ buildingId: "b", outerRing: [[-73.995, 40.705]], heightMeters: null, heightUnknown: true }),
    ], { unknownHeightSubstituteMeters: 10.5 }));
    expect(substituted.maxTopMeters).toBe(10.5);
    expect(substituted.maxTopSource).toBe("substituted");

    const empty = deriveCellExtent(cell([]));
    expect(empty.maxTopSource).toBe("none");
    expect(empty.maxTopMeters).toBe(0);
  });

  it("treats a null height as unknown even when the source did not set the flag", () => {
    const row = deriveCellExtent(cell([building({ buildingId: "a", outerRing: [[-73.995, 40.705]], heightMeters: null, heightUnknown: false })]));
    expect(row.unknownHeightCount).toBe(1);
    expect(row.maxTopSource).toBe("substituted");
  });
});

describe("aggregateCellExtents", () => {
  it("sums buildings and overhangs and attributes the island worst case to one cell", () => {
    const near = deriveCellExtent(cell([
      building({ buildingId: "a", outerRing: [[BOUNDS.east + 0.0005, 40.705]] }),
    ], { cellId: "cell-near", order: 1 }));
    const far = deriveCellExtent(cell([
      building({ buildingId: "b", outerRing: [[BOUNDS.east + 0.003, 40.705]] }),
      building({ buildingId: "c", outerRing: [[-73.995, 40.705]], heightMeters: 300 }),
    ], { cellId: "cell-far", order: 2 }));
    const quiet = deriveCellExtent(cell([building({ buildingId: "d", outerRing: [[-73.995, 40.705]] })], { cellId: "cell-quiet", order: 3 }));

    const aggregates = aggregateCellExtents([near, far, quiet]);
    expect(aggregates.cellCount).toBe(3);
    expect(aggregates.buildingCount).toBe(4);
    expect(aggregates.overhangBuildingCount).toBe(2);
    expect(aggregates.overhangBuildingShare).toBe(0.5);
    expect(aggregates.cellsWithOverhang).toBe(2);
    expect(aggregates.maxOverhangCellId).toBe("cell-far");
    expect(aggregates.maxOverhangBuildingId).toBe("b");
    expect(aggregates.maxTopMeters).toBe(300);
    expect(aggregates.maxTopBuildingId).toBe("c");
  });

  it("is empty-safe", () => {
    expect(aggregateCellExtents([])).toMatchObject({ cellCount: 0, buildingCount: 0, overhangBuildingShare: 0, maxOverhangMeters: 0 });
  });
});
