import { describe, expect, it } from "vitest";

import type { CameraPose } from "../domain/visitor-navigation";
import { CITYWIDE_OVERVIEW_CELL_EXTENTS, CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE } from "./citywide-overview-cell-extents";
import { EMPTY_SCHEDULER_CARRY, EXTERIOR_CELL_SCHEDULER_POLICY, selectResidentUnits, unitDistanceMeters, type SchedulableUnit, type SchedulerCarry, type SchedulerPolicy } from "./exterior-visibility-scheduler";
import { viewportBoundsIntersect, viewportFootprintFromGroundPoints, fallbackViewportFootprint, type ViewportBounds, type ViewportFootprint } from "./viewport-footprint";

/**
 * Expectations here are derived from the committed census and from hand-checked
 * geometry, never from running the scheduler and writing down what it said.
 *
 * The three named cells and their arithmetic:
 *
 *   - `…w05-000830…` is the island's worst overhang cell: its tallest member
 *     `doitt:308707` reaches 249.29 m beyond the cell's assignment rectangle,
 *     which is 0.0022449 deg of latitude at the census scale (40.8251953 -
 *     40.8229504) x 111,049.654 m/deg = 249.29 m. A ground point at latitude
 *     40.8240 is therefore INSIDE this cell's render extent and OUTSIDE its
 *     assignment rectangle. That single point is what separates a scheduler that
 *     culls correctly from one that drops a 249 m building.
 *   - `…w00-000000-block-00835` overlaps exactly 8 other ledger cells. Its
 *     render extent intersects the extents of orders 25, 26, 30, 31, 32, 379,
 *     380 and 381 — checked against the census, not asserted.
 *   - The centre of Block 835's extent lies inside exactly two cells' extents:
 *     Block 835 itself (order 0) and order 31.
 */

const METRIC = {
  metersPerDegreeLongitude: CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE.metersPerDegreeLongitude,
  metersPerDegreeLatitude: CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE.metersPerDegreeLatitude,
};

const CENSUS_UNITS: readonly SchedulableUnit[] = CITYWIDE_OVERVIEW_CELL_EXTENTS.map((entry) => ({
  unitId: entry.cellId,
  class: "exterior-cell",
  bounds: entry.renderBounds,
  order: entry.order,
  tieBreakKey: entry.cellId,
}));

const OVERHANG_CELL = "manhattan-exterior-cell-w05-000830-16-19304-17903";
const OVERHANG_NEIGHBOUR = "manhattan-exterior-cell-w05-000767-16-19304-17904";
const BLOCK_835 = "manhattan-exterior-cell-w00-000000-block-00835";
const BLOCK_835_OVERLAPS = [
  "manhattan-exterior-cell-w01-000025-17-38598-35862",
  "manhattan-exterior-cell-w01-000026-17-38599-35862",
  "manhattan-exterior-cell-w01-000030-16-19298-17931",
  "manhattan-exterior-cell-w01-000031-17-38598-35863",
  "manhattan-exterior-cell-w01-000032-17-38599-35863",
  "manhattan-exterior-cell-w03-000379-17-38597-35864",
  "manhattan-exterior-cell-w03-000380-17-38598-35864",
  "manhattan-exterior-cell-w03-000381-17-38599-35864",
];

function policy(overrides: Partial<SchedulerPolicy> = {}): SchedulerPolicy {
  return { ...EXTERIOR_CELL_SCHEDULER_POLICY, ...METRIC, previous: null, ...overrides };
}

function pose(longitude: number, latitude: number, height = 300): CameraPose {
  return { longitude, latitude, height, heading: 0, pitch: -45, roll: 0 };
}

/** A ground-ray footprint, so the decision is not the untrusted-sample hold. */
function groundFootprint(bounds: ViewportBounds): ViewportFootprint {
  const footprint = viewportFootprintFromGroundPoints([
    [bounds.west, bounds.south], [bounds.east, bounds.south], [bounds.west, bounds.north], [bounds.east, bounds.north],
  ]);
  if (!footprint) throw new Error("fixture bounds produced no footprint");
  return footprint;
}

function centredFootprint(longitude: number, latitude: number, halfLongitude: number, halfLatitude: number): ViewportFootprint {
  return groundFootprint({ west: longitude - halfLongitude, east: longitude + halfLongitude, south: latitude - halfLatitude, north: latitude + halfLatitude });
}

function unit(id: string, bounds: ViewportBounds, order: number): SchedulableUnit {
  return { unitId: id, class: "test", bounds, order, tieBreakKey: id };
}

function rect(west: number, south: number, east: number, north: number): ViewportBounds {
  return { west, south, east, north };
}

describe("selectResidentUnits: the frozen policy order", () => {
  it("reserves every unit containing the camera ground point, ahead of and exempt from the cap", () => {
    // Ten identical-priority far units and one the camera stands in, with a cap
    // of 2. A distance-ranked cut alone would drop the camera's own unit here,
    // which is the T009 F2 defect this reservation exists to prevent.
    const far = Array.from({ length: 10 }, (_, index) => unit(`far-${index}`, rect(-74.05 + index * 0.001, 40.90, -74.049 + index * 0.001, 40.901), index));
    const home = unit("home", rect(-73.99, 40.74, -73.98, 40.75), 999);
    const decision = selectResidentUnits([...far, home], { footprint: centredFootprint(-74.045, 40.9005, 0.02, 0.02), camera: pose(-73.985, 40.745), heightBucket: 300 }, policy({ maxResidentUnits: 2 }));
    expect(decision.reserved).toEqual(["home"]);
    expect(decision.resident).toContain("home");
    // The cap bounds the TOTAL: one reserved unit plus one contested admission
    // against a cap of 2. The reservation is never the thing that gets cut.
    expect(decision.resident).toHaveLength(2);
    expect(decision.order).toEqual(["home", "far-0"]);
  });

  it("ranks by distance band first and by explicit order inside a band", () => {
    // `near-late` sits in band 0 with a high order; `mid-early` sits in band 1
    // with order 0. The band decides, so the high-order near unit outranks the
    // low-order mid one — and inside band 0 the order decides.
    const nearEarly = unit("near-early", rect(-73.9805, 40.7495, -73.9795, 40.7505), 5);
    const nearLate = unit("near-late", rect(-73.9825, 40.7495, -73.9815, 40.7505), 900);
    // ~1.9 km east of centre at the census longitude scale (0.0225 deg x 84,412.702).
    const midEarly = unit("mid-early", rect(-73.9575, 40.7495, -73.9565, 40.7505), 0);
    const decision = selectResidentUnits([midEarly, nearLate, nearEarly], { footprint: centredFootprint(-73.98, 40.75, 0.05, 0.05), camera: pose(-73.98, 40.75), heightBucket: 500 }, policy());
    expect(decision.order).toEqual(["near-early", "near-late", "mid-early"]);
    expect(unitDistanceMeters(midEarly.bounds, -73.98, 40.75, METRIC)).toBeGreaterThan(1_200);
    expect(unitDistanceMeters(nearLate.bounds, -73.98, 40.75, METRIC)).toBeLessThan(1_200);
  });

  it("bounds the output by construction at the cap", () => {
    const decision = selectResidentUnits(CENSUS_UNITS, { footprint: centredFootprint(-73.98, 40.76, 0.2, 0.2), camera: pose(-73.98, 40.76, 6_000), heightBucket: 6_000 }, policy());
    expect(decision.visibleCount).toBeGreaterThan(EXTERIOR_CELL_SCHEDULER_POLICY.maxResidentUnits);
    expect(decision.resident.length).toBeLessThanOrEqual(EXTERIOR_CELL_SCHEDULER_POLICY.maxResidentUnits + decision.reserved.length);
    expect(decision.deferredCount).toBe(decision.visibleCount - decision.resident.length);
  });

  it("is invariant to the input array order", () => {
    const view = { footprint: centredFootprint(-73.98, 40.755, 0.01, 0.01), camera: pose(-73.98, 40.755), heightBucket: 400 };
    const forward = selectResidentUnits(CENSUS_UNITS, view, policy());
    const shuffled = [...CENSUS_UNITS].reverse();
    // A deterministic non-trivial permutation, so "reversed" is not the only case tested.
    for (let index = 0; index < shuffled.length; index += 7) {
      const swap = (index * 31 + 11) % shuffled.length;
      [shuffled[index]!, shuffled[swap]!] = [shuffled[swap]!, shuffled[index]!];
    }
    expect(shuffled.map((entry) => entry.unitId)).not.toEqual(CENSUS_UNITS.map((entry) => entry.unitId));
    const reordered = selectResidentUnits(shuffled, view, policy());
    expect(reordered.order).toEqual(forward.order);
    expect(reordered.resident).toEqual(forward.resident);
    expect(reordered.reserved).toEqual(forward.reserved);
  });

  it("breaks a shared band and order by tieBreakKey and never by input position", () => {
    const bounds = rect(-73.981, 40.749, -73.979, 40.751);
    const left = { unitId: "z-unit", class: "test", bounds, order: 4, tieBreakKey: "aaa" };
    const right = { unitId: "a-unit", class: "test", bounds, order: 4, tieBreakKey: "bbb" };
    const view = { footprint: centredFootprint(-73.98, 40.75, 0.01, 0.01), camera: pose(-73.9, 40.7), heightBucket: 300 };
    expect(selectResidentUnits([left, right], view, policy()).order).toEqual(["z-unit", "a-unit"]);
    expect(selectResidentUnits([right, left], view, policy()).order).toEqual(["z-unit", "a-unit"]);
  });
});

describe("selectResidentUnits: overlapping units", () => {
  it("admits Block 835 and all eight leaf cells its render extent overlaps", () => {
    const block835 = CITYWIDE_OVERVIEW_CELL_EXTENTS.find((entry) => entry.cellId === BLOCK_835)!;
    const centre = { longitude: (block835.renderBounds.west + block835.renderBounds.east) / 2, latitude: (block835.renderBounds.south + block835.renderBounds.north) / 2 };
    const decision = selectResidentUnits(CENSUS_UNITS, {
      footprint: groundFootprint(block835.renderBounds),
      camera: pose(centre.longitude, centre.latitude, 120),
      heightBucket: 100,
    }, policy());
    expect(decision.visibleCount).toBe(9);
    expect([...decision.resident].sort()).toEqual([BLOCK_835, ...BLOCK_835_OVERLAPS].sort());
    // Overlap means several units can contain one ground point, and all of them
    // are reserved rather than one being chosen.
    expect(decision.reserved).toEqual([BLOCK_835, "manhattan-exterior-cell-w01-000031-17-38598-35863"]);
    expect(decision.order[0]).toBe(BLOCK_835);
  });
});

describe("selectResidentUnits: the render-extent fixture", () => {
  /**
   * Correct ONLY with `renderBounds`. The point sits in the 249.29 m overhang
   * strip of `…w05-000830…`: inside its render extent, outside its assignment
   * rectangle. A scheduler culling on assignment rectangles reserves only the
   * neighbour and drops the overhang cell — the exact geometry loss ADR 0040
   * warned about, made into a failing assertion.
   */
  it("reserves the 249.29 m overhang cell for a camera standing in its overhang strip", () => {
    const camera = pose(-73.957, 40.8240, 90);
    const decision = selectResidentUnits(CENSUS_UNITS, { footprint: centredFootprint(-73.957, 40.8240, 0.0015, 0.001), camera, heightBucket: 100 }, policy());
    expect([...decision.reserved].sort()).toEqual([OVERHANG_CELL, OVERHANG_NEIGHBOUR].sort());
    expect(decision.resident).toContain(OVERHANG_CELL);

    // The counterfactual, computed here rather than asserted: had the units
    // carried assignment rectangles, only the neighbour would contain the point.
    const overhang = CITYWIDE_OVERVIEW_CELL_EXTENTS.find((entry) => entry.cellId === OVERHANG_CELL)!;
    expect(camera.latitude).toBeGreaterThan(overhang.renderBounds.south);
    expect(camera.latitude).toBeLessThan(40.8251953125);
    expect((40.8251953125 - overhang.renderBounds.south) * METRIC.metersPerDegreeLatitude).toBeCloseTo(249.29, 1);
  });

  it("leaves a wholly-outside cell absent", () => {
    const decision = selectResidentUnits(CENSUS_UNITS, { footprint: centredFootprint(-73.957, 40.8240, 0.0015, 0.001), camera: pose(-73.957, 40.8240, 90), heightBucket: 100 }, policy());
    expect(decision.resident).not.toContain(BLOCK_835);
    for (const cellId of decision.resident) {
      const entry = CITYWIDE_OVERVIEW_CELL_EXTENTS.find((candidate) => candidate.cellId === cellId)!;
      expect(entry.renderBounds.north).toBeGreaterThan(40.82);
    }
  });
});

describe("selectResidentUnits: invariants", () => {
  it("keeps the resident set a subset of the units it was given", () => {
    const subset = CENSUS_UNITS.slice(0, 40);
    const ids = new Set(subset.map((entry) => entry.unitId));
    const decision = selectResidentUnits(subset, { footprint: centredFootprint(-73.98, 40.75, 0.3, 0.3), camera: pose(-73.98, 40.75, 4_000), heightBucket: 4_000 }, policy());
    for (const id of decision.resident) expect(ids.has(id)).toBe(true);
  });

  it("is monotone non-decreasing in camera height at a fixed ground centre", () => {
    const counts = [200, 600, 1_200, 2_400, 4_800, 9_600].map((height) => {
      // Footprint half-extent grows with height, which is the only channel
      // through which height reaches this decision at all.
      const half = Math.min(0.09, height / 111_000 * 0.9);
      const decision = selectResidentUnits(CENSUS_UNITS, {
        footprint: centredFootprint(-73.98, 40.758, half, half * 0.65),
        camera: pose(-73.98, 40.758, height),
        heightBucket: Math.max(50, Math.round(height / 100) * 100),
      }, policy());
      return decision.resident.length;
    });
    for (let index = 1; index < counts.length; index += 1) expect(counts[index]!).toBeGreaterThanOrEqual(counts[index - 1]!);
    expect(counts[0]!).toBeLessThan(counts[counts.length - 1]!);
  });

  it("keeps the camera's own unit resident at every height", () => {
    for (const height of [80, 300, 1_500, 8_000]) {
      const half = Math.min(0.09, height / 111_000 * 0.9);
      const decision = selectResidentUnits(CENSUS_UNITS, {
        footprint: centredFootprint(-73.957, 40.8240, half, half * 0.65),
        camera: pose(-73.957, 40.8240, height),
        heightBucket: Math.max(50, Math.round(height / 100) * 100),
      }, policy());
      expect(decision.resident, `height ${height}`).toContain(OVERHANG_CELL);
    }
  });
});

describe("selectResidentUnits: untrusted footprints", () => {
  const view = (footprint: ViewportFootprint) => ({ footprint, camera: pose(-73.98, 40.75), heightBucket: 300 });

  it("holds the previous resident set and evicts nothing on a camera-fallback sample", () => {
    const previous: SchedulerCarry = { ...EMPTY_SCHEDULER_CARRY, resident: [BLOCK_835, OVERHANG_CELL], retained: new Map([[BLOCK_835, 3], [OVERHANG_CELL, 3]]), decisionIndex: 4 };
    const fallback = fallbackViewportFootprint(pose(-73.90, 40.68, 900));
    expect(fallback.source).toBe("camera-fallback");
    expect(fallback.valid).toBe(false);
    const decision = selectResidentUnits(CENSUS_UNITS, view(fallback), policy({ previous }));
    expect(decision.hold).toBe("held-previous");
    expect(decision.evict).toEqual([]);
    expect(decision.load).toEqual([]);
    expect([...decision.resident].sort()).toEqual([BLOCK_835, OVERHANG_CELL].sort());
    expect(decision.carry.decisionIndex).toBe(5);
    expect(decision.carry.retained).toBe(previous.retained);
  });

  it("holds on a last-valid sample too, because only a ground-ray sample is evidence", () => {
    const lastValid = { ...groundFootprint(rect(-74.0, 40.7, -73.9, 40.8)), valid: false, source: "last-valid" as const };
    const previous: SchedulerCarry = { ...EMPTY_SCHEDULER_CARRY, resident: [BLOCK_835], retained: new Map([[BLOCK_835, 2]]) };
    expect(selectResidentUnits(CENSUS_UNITS, view(lastValid), policy({ previous })).evict).toEqual([]);
  });

  it("bootstraps rather than holding nothing when there is no previous decision", () => {
    const decision = selectResidentUnits(CENSUS_UNITS, view(fallbackViewportFootprint(pose(-73.98, 40.75, 900))), policy());
    expect(decision.hold).toBe("bootstrap-untrusted-footprint");
    expect(decision.resident.length).toBeGreaterThan(0);
    expect(decision.evict).toEqual([]);
  });
});

/**
 * T005: the detail radius.
 *
 * The arithmetic these tests are checked against, all in the census planar
 * metric (84,412.702 m/deg longitude, 111,049.654 m/deg latitude):
 *
 *   - A rectangle spanning longitudes -73.9575..-73.9565 has its nearest edge
 *     0.0225 deg east of -73.98, which is 0.0225 x 84,412.702 = 1,899.29 m.
 *   - A rectangle spanning -73.9705..-73.9695 is 0.0095 deg east, which is
 *     801.92 m.
 *
 * So a radius of 1,000 m admits the second and refuses the first, and a radius
 * of 2,000 m admits both. Neither number was read off the implementation.
 */
describe("selectResidentUnits: the detail radius (T005)", () => {
  const near = unit("near", rect(-73.9705, 40.7495, -73.9695, 40.7505), 1);
  const far = unit("far", rect(-73.9575, 40.7495, -73.9565, 40.7505), 2);
  const units = [near, far];
  // Wide enough that BOTH rectangles intersect it, so the radius is the only
  // thing that can separate them. Camera parked far away so nothing is reserved.
  const view = { footprint: centredFootprint(-73.98, 40.75, 0.05, 0.05), camera: pose(-73.80, 40.60), heightBucket: 600 };

  it("measures the two fixture distances as the census metric says", () => {
    expect(unitDistanceMeters(near.bounds, -73.98, 40.75, METRIC)).toBeCloseTo(801.92, 1);
    expect(unitDistanceMeters(far.bounds, -73.98, 40.75, METRIC)).toBeCloseTo(1_899.29, 1);
  });

  it("is today's decision when the field is absent, and when it is explicitly null", () => {
    const absent = selectResidentUnits(units, view, policy());
    expect(absent.resident).toEqual(["near", "far"]);
    const explicitNull = selectResidentUnits(units, view, policy({ maxUnitDistanceMeters: null }));
    expect(explicitNull.resident).toEqual(absent.resident);
    expect(explicitNull.visibleCount).toBe(absent.visibleCount);
    expect(explicitNull.order).toEqual(absent.order);
  });

  it("refuses a unit whose nearest edge is beyond the radius, even though it intersects the footprint", () => {
    const decision = selectResidentUnits(units, view, policy({ maxUnitDistanceMeters: 1_000 }));
    // The refusal is a VISIBILITY refusal, not a cap truncation: the cap is 96
    // and only two units exist, so nothing here is contested.
    expect(decision.resident).toEqual(["near"]);
    expect(decision.visibleCount).toBe(1);
    expect(decision.deferredCount).toBe(0);
    expect(viewportBoundsIntersect(far.bounds, view.footprint.bounds)).toBe(true);
  });

  it("admits on the boundary, so the radius is inclusive", () => {
    const exact = unitDistanceMeters(far.bounds, -73.98, 40.75, METRIC);
    expect(selectResidentUnits(units, view, policy({ maxUnitDistanceMeters: exact })).resident).toContain("far");
    expect(selectResidentUnits(units, view, policy({ maxUnitDistanceMeters: exact - 0.001 })).resident).not.toContain("far");
  });

  it("never drops the unit the camera is standing in, at any radius", () => {
    // A radius of one metre with the camera inside `near`. The reservation is
    // decided before the intersection tier and is exempt by construction.
    const inside = { footprint: centredFootprint(-73.97, 40.75, 0.05, 0.05), camera: pose(-73.97, 40.75), heightBucket: 300 };
    const decision = selectResidentUnits(units, inside, policy({ maxUnitDistanceMeters: 1 }));
    expect(decision.reserved).toEqual(["near"]);
    expect(decision.resident).toContain("near");
    expect(decision.resident).not.toContain("far");
  });

  /**
   * The one configuration where the exemption is LOAD-BEARING.
   *
   * The test above puts the camera inside the footprint, so `home` would have
   * survived on the intersection test alone and the reservation is not doing
   * the work. Here the camera stands in a unit that is 8.7 km from the
   * footprint's ground centre and does NOT intersect the footprint at all: the
   * intersection tier refuses it, the radius refuses it, and the reservation is
   * the only thing left holding it. This is the T009 F2 geometry — a steeply
   * pitched camera whose measured ground footprint lies well away from the
   * camera's own position — and it is exactly where a distance-ranked cut
   * dropped the shard the camera was standing on.
   */
  it("reserves the camera's own unit when it neither intersects the footprint nor lies inside the radius", () => {
    const home = unit("home", rect(-73.99, 40.74, -73.98, 40.75), 1);
    const view = { footprint: centredFootprint(-73.90, 40.80, 0.01, 0.01), camera: pose(-73.985, 40.745), heightBucket: 300 };
    // Hand-checked against the census metric: 0.08 deg x 84,412.702 east and
    // 0.05 deg x 111,049.654 north.
    expect(unitDistanceMeters(home.bounds, -73.90, 40.80, METRIC)).toBeCloseTo(Math.hypot(0.08 * METRIC.metersPerDegreeLongitude, 0.05 * METRIC.metersPerDegreeLatitude), 1);
    expect(unitDistanceMeters(home.bounds, -73.90, 40.80, METRIC)).toBeGreaterThan(8_000);
    // Both refusals are real: no intersection, and far outside a 500 m radius.
    expect(viewportBoundsIntersect(home.bounds, view.footprint.bounds)).toBe(false);
    const decision = selectResidentUnits([home], view, policy({ maxUnitDistanceMeters: 500 }));
    expect(decision.reserved).toEqual(["home"]);
    expect(decision.resident).toEqual(["home"]);
    // And it is the RESERVATION doing it, not hysteresis: there is no previous
    // decision for `home` to coast on.
    expect(decision.retainedCount).toBe(0);
    expect(decision.load).toEqual(["home"]);
  });

  it("fades a unit out through hysteresis rather than dropping it the instant the radius tightens", () => {
    const wide = selectResidentUnits(units, view, policy({ maxUnitDistanceMeters: 2_000 }));
    expect(wide.resident).toEqual(["near", "far"]);
    // Same camera, tighter radius: `far` leaves the visible tier and lands in
    // the retained tier, which is what makes a radius change a fade and not a cliff.
    const first = selectResidentUnits(units, view, policy({ maxUnitDistanceMeters: 1_000, previous: wide.carry }));
    expect(first.resident).toContain("far");
    expect(first.retainedCount).toBe(1);
    expect(first.evict).toEqual([]);
    const second = selectResidentUnits(units, view, policy({ maxUnitDistanceMeters: 1_000, previous: first.carry }));
    expect(second.resident).toContain("far");
    const third = selectResidentUnits(units, view, policy({ maxUnitDistanceMeters: 1_000, previous: second.carry }));
    expect(third.resident).not.toContain("far");
    expect(third.evict).toEqual(["far"]);
  });

  it("leaves the band edges and the cap untouched: it is a filter, not a re-rank", () => {
    // Both fixtures sit in band 0 and band 1 respectively; the radius removes
    // one, and the surviving order is the order the un-radiused decision had.
    const none = selectResidentUnits(units, view, policy());
    const radiused = selectResidentUnits(units, view, policy({ maxUnitDistanceMeters: 1_000 }));
    expect(none.order).toEqual(["near", "far"]);
    expect(radiused.order).toEqual(none.order.filter((id) => id !== "far"));
  });

  it("bounds the island decision monotonically: a wider radius is never a smaller resident set", () => {
    const overview = { footprint: centredFootprint(-73.98, 40.76, 0.2, 0.2), camera: pose(-73.98, 40.76, 6_000), heightBucket: 6_000 };
    // The island's own reach from this centre, measured rather than assumed:
    // 12 km is NOT enough (the northern cells sit beyond it), which is itself
    // the reason a "generous" radius has to be checked against the census.
    const reach = Math.max(...CENSUS_UNITS.map((entry) => unitDistanceMeters(entry.bounds, -73.98, 40.76, METRIC)));
    expect(reach).toBeGreaterThan(12_000);
    expect(reach).toBeLessThan(15_000);
    const counts = [500, 1_000, 2_000, 3_000, 12_000, Math.ceil(reach)].map((radius) => selectResidentUnits(CENSUS_UNITS, overview, policy({ maxUnitDistanceMeters: radius })).visibleCount);
    for (let index = 1; index < counts.length; index += 1) expect(counts[index]!).toBeGreaterThanOrEqual(counts[index - 1]!);
    // A radius at the island's own reach must reproduce the un-radiused visible
    // count exactly, which is the "null is the limit case" property.
    expect(counts.at(-1)).toBe(selectResidentUnits(CENSUS_UNITS, overview, policy()).visibleCount);
    expect(counts[0]!).toBeLessThan(counts.at(-1)!);
  });

  it("still holds the previous set verbatim on an untrusted footprint, radius or not", () => {
    const previous: SchedulerCarry = { ...EMPTY_SCHEDULER_CARRY, resident: [BLOCK_835, OVERHANG_CELL], retained: new Map([[BLOCK_835, 3], [OVERHANG_CELL, 3]]) };
    const held = selectResidentUnits(CENSUS_UNITS, { footprint: fallbackViewportFootprint(pose(-73.98, 40.75, 900)), camera: pose(-73.98, 40.75), heightBucket: 300 }, policy({ previous, maxUnitDistanceMeters: 1 }));
    expect(held.hold).toBe("held-previous");
    expect(held.evict).toEqual([]);
    expect([...held.resident].sort()).toEqual([BLOCK_835, OVERHANG_CELL].sort());
  });
});

describe("selectResidentUnits: hysteresis", () => {
  const near = unit("near", rect(-73.981, 40.749, -73.979, 40.751), 1);
  const away = unit("away", rect(-73.881, 40.649, -73.879, 40.651), 2);
  const units = [near, away];

  function decide(longitude: number, latitude: number, previous: SchedulerCarry | null) {
    return selectResidentUnits(units, { footprint: centredFootprint(longitude, latitude, 0.005, 0.005), camera: pose(longitude, latitude), heightBucket: 300 }, policy({ previous, hysteresisDecisions: 3 }));
  }

  it("retains a unit that has left the footprint for exactly the configured number of decisions", () => {
    const first = decide(-73.88, 40.65, null);
    expect([...first.resident]).toEqual(["away"]);
    // Three further decisions away from it: resident, resident, then gone.
    const second = decide(-73.98, 40.75, first.carry);
    expect(second.resident).toContain("away");
    expect(second.retainedCount).toBe(1);
    expect(second.evict).toEqual([]);
    const third = decide(-73.98, 40.75, second.carry);
    expect(third.resident).toContain("away");
    const fourth = decide(-73.98, 40.75, third.carry);
    expect(fourth.resident).not.toContain("away");
    expect(fourth.evict).toEqual(["away"]);
  });

  it("resets the retention counter the moment a unit becomes visible again", () => {
    const first = decide(-73.88, 40.65, null);
    const second = decide(-73.98, 40.75, first.carry);
    const back = decide(-73.88, 40.65, second.carry);
    expect(second.carry.retained.get("away")).toBe(2);
    expect(back.carry.retained.get("away")).toBe(3);
    // `near` is now the retained one, so the counter is about which unit is
    // coasting on hysteresis rather than about how many ever have.
    expect(back.retainedCount).toBe(1);
    expect(back.carry.retained.get("near")).toBe(2);
  });

  it("never prefetches behind the camera: nothing outside the footprint is admitted without prior residency", () => {
    const decision = decide(-73.98, 40.75, null);
    expect([...decision.resident]).toEqual(["near"]);
    expect(decision.load).toEqual(["near"]);
  });
});
