import { describe, expect, it } from "vitest";

import {
  GROUND_COORDINATE_SCALE,
  GROUND_COORDINATE_STEP,
  clipMultiPolygonToRect,
  clipPolygonToRect,
  clipRingToRect,
  multiPolygonBounds,
  multiPolygonNetArea,
  polygonNetArea,
  quantizeCoordinate,
  quantizeMultiPolygon,
  quantizeRing,
  rectsOverlap,
  ringArea,
  ringSignedArea,
  ringSimplicityCensus,
  type GroundRect,
} from "./ground-geometry.ts";

/** A unit square, counter-clockwise and closed, in the middle of the clip rectangle. */
function square(west: number, south: number, size: number): number[][] {
  return [
    [west, south],
    [west + size, south],
    [west + size, south + size],
    [west, south + size],
    [west, south],
  ];
}

const CELL: GroundRect = { west: 0, south: 0, east: 10, north: 10 };

describe("quantization", () => {
  it("rounds to seven decimal places", () => {
    expect(quantizeCoordinate(-73.903535868654)).toBe(-73.9035359);
    expect(quantizeCoordinate(40.695240446059515)).toBe(40.6952404);
    expect(GROUND_COORDINATE_SCALE).toBe(10000000);
    expect(GROUND_COORDINATE_STEP).toBe(1e-7);
  });

  it("is idempotent, which is what the validator's shipped-coordinate check relies on", () => {
    for (const value of [-74.0478515625, 40.67138671875, -73.89404296875, 0, 1 / 3, -1 / 7]) {
      const once = quantizeCoordinate(value);
      expect(quantizeCoordinate(once)).toBe(once);
    }
  });

  it("moves a coordinate by no more than half a step", () => {
    for (const value of [-74.04785156251, 40.671386718759, -73.8940429687, 40.88888888888]) {
      const delta = Math.abs(quantizeCoordinate(value) - value);
      expect(delta).toBeLessThanOrEqual(GROUND_COORDINATE_STEP / 2);
    }
  });

  it("collapses vertices that quantization made identical and keeps the ring closed", () => {
    const ring = [
      [0, 0],
      [0.000000001, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ];
    const quantized = quantizeRing(ring);
    expect(quantized).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ]);
  });

  it("drops a ring that quantization collapsed below three distinct vertices", () => {
    expect(quantizeRing(square(0, 0, 1e-9))).toEqual([]);
  });

  it("keeps holes as holes and drops collapsed polygons", () => {
    const withHole = [square(0, 0, 4), square(1, 1, 2)];
    const collapsed = [square(0, 0, 1e-9)];
    expect(quantizeMultiPolygon([withHole, collapsed])).toHaveLength(1);
    expect(quantizeMultiPolygon([withHole])[0]).toHaveLength(2);
  });
});

describe("areas", () => {
  it("computes a signed shoelace area with counter-clockwise positive", () => {
    expect(ringSignedArea(square(0, 0, 2))).toBe(4);
    expect(ringSignedArea([...square(0, 0, 2)].reverse())).toBe(-4);
    expect(ringArea([...square(0, 0, 2)].reverse())).toBe(4);
  });

  it("keeps precision at Manhattan longitudes, where a naive shoelace loses the signal", () => {
    // ~11 m square near the island, about 1e-8 square degrees. The truth to
    // compare against is the area of the doubles actually stored, not of the
    // nominal size: `west + size` is not exactly `west` plus `size` up here.
    const west = -73.98765432;
    const south = 40.75432198;
    const size = 1e-4;
    const ring = square(west, south, size);
    const truth = (ring[1]![0]! - ring[0]![0]!) * (ring[2]![1]! - ring[1]![1]!);
    expect(Math.abs(ringArea(ring) - truth) / truth).toBeLessThan(1e-12);

    // The same ring through a shoelace about the origin instead of about the
    // ring's first vertex: this is the cancellation the module exists to avoid.
    let naive = 0;
    for (let index = 0; index < ring.length - 1; index += 1) {
      naive += ring[index]![0]! * ring[index + 1]![1]! - ring[index + 1]![0]! * ring[index]![1]!;
    }
    expect(Math.abs(naive / 2 - truth) / truth).toBeGreaterThan(1e-6);
  });

  it("subtracts holes and floors a hole-dominated polygon at zero", () => {
    expect(polygonNetArea([square(0, 0, 4), square(1, 1, 2)])).toBe(12);
    // A cell entirely inside a hole clips to outer === hole; the honest net is zero.
    expect(polygonNetArea([square(0, 0, 4), square(0, 0, 4)])).toBe(0);
    expect(multiPolygonNetArea([[square(0, 0, 2)], [square(5, 5, 2)]])).toBe(8);
  });

  it("reports null bounds for an empty MultiPolygon", () => {
    expect(multiPolygonBounds([])).toBeNull();
    expect(multiPolygonBounds([[square(1, 2, 3)]])).toEqual({ west: 1, south: 2, east: 4, north: 5 });
  });
});

describe("rectangle clipping", () => {
  it("passes a fully contained ring through unchanged", () => {
    const ring = square(2, 2, 3);
    expect(clipRingToRect(ring, CELL)).toEqual(ring);
  });

  it("returns nothing for a ring entirely outside", () => {
    expect(clipRingToRect(square(20, 20, 3), CELL)).toEqual([]);
  });

  it("returns nothing for a ring that only grazes an edge, rather than a zero-area sliver", () => {
    // Sitting exactly west of the cell, touching x === 0 along its whole east side.
    const grazing = [
      [-3, 2],
      [0, 2],
      [0, 5],
      [-3, 5],
      [-3, 2],
    ];
    expect(ringArea(clipRingToRect(grazing, CELL))).toBe(0);
  });

  it("conserves area when a ring is cut across two abutting cells with no buffer", () => {
    const left: GroundRect = { west: 0, south: 0, east: 5, north: 10 };
    const right: GroundRect = { west: 5, south: 0, east: 10, north: 10 };
    const ring = square(1, 1, 8);
    const whole = ringArea(ring);
    const parts = ringArea(clipRingToRect(ring, left)) + ringArea(clipRingToRect(ring, right));
    expect(Math.abs(parts - whole) / whole).toBeLessThan(1e-12);
  });

  it("places the shared vertex on the exact boundary double in both neighbours", () => {
    const left: GroundRect = { west: -74.0478515625, south: 40, east: -74, north: 41 };
    const right: GroundRect = { west: -74, south: 40, east: -73.9, north: 41 };
    const ring = square(-74.02, 40.5, 0.04);
    const leftPart = clipRingToRect(ring, left);
    const rightPart = clipRingToRect(ring, right);
    expect(leftPart.some((position) => position[0] === -74)).toBe(true);
    expect(rightPart.some((position) => position[0] === -74)).toBe(true);
    // No vertex escapes its own cell: the ownership contract, before quantization.
    expect(leftPart.every((position) => position[0]! <= -74)).toBe(true);
    expect(rightPart.every((position) => position[0]! >= -74)).toBe(true);
  });

  it("clips a rectangle bigger than the cell down to exactly the cell", () => {
    const covering = clipRingToRect(square(-5, -5, 30), CELL);
    expect(ringArea(covering)).toBe(100);
    expect(multiPolygonBounds([[covering]])).toEqual(CELL);
  });

  it("keeps a hole as a hole and drops a hole that falls outside the cell", () => {
    const polygon = [square(-5, -5, 30), square(2, 2, 3), square(20, 20, 3)];
    const clipped = clipPolygonToRect(polygon, CELL);
    expect(clipped).toHaveLength(2);
    expect(polygonNetArea(clipped)).toBe(100 - 9);
  });

  it("drops holes when the outer ring does not reach the cell", () => {
    expect(clipPolygonToRect([square(20, 20, 5), square(21, 21, 1)], CELL)).toEqual([]);
    expect(clipMultiPolygonToRect([[square(20, 20, 5)], [square(1, 1, 2)]], CELL)).toHaveLength(1);
  });

  it("reports zero net area for a cell that lies entirely inside a hole", () => {
    const polygon = [square(-5, -5, 30), square(-1, -1, 20)];
    expect(polygonNetArea(clipPolygonToRect(polygon, CELL))).toBe(0);
  });

  it("conserves area over a full four-cell partition of a concave ring", () => {
    const concave = [
      [1, 1],
      [9, 1],
      [9, 9],
      [6, 9],
      [6, 4],
      [4, 4],
      [4, 9],
      [1, 9],
      [1, 1],
    ];
    const quadrants: GroundRect[] = [
      { west: 0, south: 0, east: 5, north: 5 },
      { west: 5, south: 0, east: 10, north: 5 },
      { west: 0, south: 5, east: 5, north: 10 },
      { west: 5, south: 5, east: 10, north: 10 },
    ];
    const whole = ringArea(concave);
    const parts = quadrants.reduce((total, rect) => total + ringArea(clipRingToRect(concave, rect)), 0);
    expect(Math.abs(parts - whole) / whole).toBeLessThan(1e-12);
  });
});

describe("overlap prefilter", () => {
  it("treats a shared boundary line as no overlap", () => {
    expect(rectsOverlap({ west: -5, south: 0, east: 0, north: 10 }, CELL)).toBe(false);
    expect(rectsOverlap({ west: -5, south: 0, east: 0.001, north: 10 }, CELL)).toBe(true);
  });
});

describe("ring simplicity census", () => {
  it("counts a clean ring as clean", () => {
    const census = ringSimplicityCensus([[square(1, 1, 2)]]);
    expect(census).toEqual({ rings: 1, selfTouchingRings: 0, collinearVertices: 0, zeroAreaRings: 0 });
  });

  it("counts collinear vertices a clip introduces along the boundary", () => {
    const withCollinear = [
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 2],
      [0, 0],
    ];
    expect(ringSimplicityCensus([[withCollinear]]).collinearVertices).toBe(1);
  });

  it("counts a self-touching ring and a zero-area ring without repairing either", () => {
    const selfTouching = [
      [0, 0],
      [2, 0],
      [1, 1],
      [2, 2],
      [0, 2],
      [1, 1],
      [0, 0],
    ];
    const census = ringSimplicityCensus([[selfTouching]]);
    expect(census.selfTouchingRings).toBe(1);
    expect(census.rings).toBe(1);
    const degenerate = [
      [0, 0],
      [1, 1],
      [0, 0],
      [0, 0],
    ];
    expect(ringSimplicityCensus([[degenerate]]).zeroAreaRings).toBe(1);
  });

  it("accumulates into a caller-supplied census so a whole class can be measured in one pass", () => {
    const census = ringSimplicityCensus([[square(0, 0, 1)]]);
    ringSimplicityCensus([[square(3, 3, 1)]], census);
    expect(census.rings).toBe(2);
  });
});
