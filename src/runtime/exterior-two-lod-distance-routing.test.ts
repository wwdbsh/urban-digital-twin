/**
 * The two runtime halves of T001 S3 (ADR 0057 §1.1).
 *
 * 1. The scheduler PUBLISHES the camera-to-cell distance it already measured to
 *    rank with, so the LOD tier and the residency order cannot disagree about
 *    how far away a cell is.
 * 2. A cell that CROSSES the near-ring bound is re-requested, so the crossing
 *    becomes a reload instead of being absorbed.
 *
 * Neither is observable from a release record, which is why both are pinned
 * here rather than left to the capture campaign to notice.
 */
import { describe, expect, it } from "vitest";

import { createExteriorCellLoadState, reconcileExteriorCellLoads } from "./exterior-cell-reconciliation.ts";
import { CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE } from "./citywide-overview-cell-extents.ts";
import { EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY, selectResidentUnits, type SchedulableUnit, type SchedulerCarry } from "./exterior-visibility-scheduler.ts";

/** The policy exactly as `scheduleExteriorCellsGlobally` composes it. */
function policy(previous: SchedulerCarry | null) {
  return {
    ...EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY,
    metersPerDegreeLongitude: CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE.metersPerDegreeLongitude,
    metersPerDegreeLatitude: CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE.metersPerDegreeLatitude,
    previous,
    maxUnitDistanceMeters: null,
  };
}

function unit(unitId: string, west: number, east: number, south: number, north: number): SchedulableUnit {
  return { unitId, class: "exterior-cell", order: 0, tieBreakKey: unitId, bounds: { west, east, south, north } } as unknown as SchedulableUnit;
}

const FOOTPRINT = {
  valid: true,
  source: "camera" as const,
  signature: "sig",
  bounds: { west: -74.05, east: -73.9, south: 40.68, north: 40.88 },
  groundCenter: { longitude: -74.0, latitude: 40.75 },
} as unknown as Parameters<typeof selectResidentUnits>[1]["footprint"];

const CAMERA = { longitude: -74.0, latitude: 40.75, height: 500, heading: 0, pitch: -45, roll: 0 };

describe("the scheduler publishes the distance the LOD thresholds are evaluated against", () => {
  const units = [
    unit("near", -74.001, -73.999, 40.749, 40.751),
    unit("far", -73.95, -73.94, 40.86, 40.87),
  ];

  it("measures a distance for every resident unit", () => {
    const decision = selectResidentUnits(units, {
      footprint: FOOTPRINT,
      camera: CAMERA,
      heightBucket: 500,
    }, policy(null));
    for (const unitId of decision.resident) {
      expect(decision.distanceMetersByUnitId.has(unitId), `${unitId} has no measured distance`).toBe(true);
      expect(decision.distanceMetersByUnitId.get(unitId)).toBeGreaterThanOrEqual(0);
    }
    // And it is a DISTANCE, not a height: the two units must not share a value
    // the way they would if the camera's ellipsoid height were being passed
    // through. This is the defect ADR 0057 §1.1 records.
    if (decision.resident.length === 2) {
      const [a, b] = decision.resident;
      expect(decision.distanceMetersByUnitId.get(a!)).not.toBe(decision.distanceMetersByUnitId.get(b!));
    }
  });

  it("publishes NO distances on a held-previous decision rather than stale ones", () => {
    // A held-previous decision ranks nothing, so it has no distances of its own.
    // Publishing the previous decision's numbers would let a caller read a stale
    // distance as if this decision had measured it.
    const invalid = { ...FOOTPRINT, valid: false, signature: "" };
    const decision = selectResidentUnits(units, {
      footprint: invalid,
      camera: CAMERA,
      heightBucket: 500,
    }, policy({ resident: ["near"], retained: new Map([["near", 3]]), heightBucket: 500, footprintSignature: "sig", decisionIndex: 1 }));
    if (decision.hold !== "none") expect(decision.distanceMetersByUnitId.size).toBe(0);
  });
});

describe("a cell that crosses the near ring is re-requested", () => {
  it("puts an invalidated cell back into fresh", () => {
    const state = createExteriorCellLoadState<string>();
    const scheduled = ["cell-a", "cell-b"];

    const first = reconcileExteriorCellLoads(state, scheduled);
    expect(first.fresh).toEqual(scheduled);
    // Settle both so neither is in flight.
    for (const cellId of scheduled) { state.inFlight.delete(cellId); state.outcomes.set(cellId, "lod_0"); }

    // Nothing changed: no reload.
    expect(reconcileExteriorCellLoads(state, scheduled).fresh).toEqual([]);

    // `cell-a` crossed the bound; its level is now wrong.
    const crossed = reconcileExteriorCellLoads(state, scheduled, ["cell-a"]);
    expect(crossed.fresh).toEqual(["cell-a"]);
    // And the stale outcome is gone rather than being served alongside the new one.
    expect(state.outcomes.has("cell-a")).toBe(false);
    expect(state.outcomes.get("cell-b")).toBe("lod_0");
  });

  it("leaves an IN-FLIGHT cell alone, so one cell never has two loads on the wire", () => {
    const state = createExteriorCellLoadState<string>();
    reconcileExteriorCellLoads(state, ["cell-a"]);
    expect(state.inFlight.has("cell-a")).toBe(true);
    // It crossed while its first load was still settling.
    const again = reconcileExteriorCellLoads(state, ["cell-a"], ["cell-a"]);
    expect(again.fresh).toEqual([]);
    expect(state.requested.has("cell-a")).toBe(true);
  });

  it("is a no-op when nothing is invalidated, so the default path is unchanged", () => {
    const state = createExteriorCellLoadState<string>();
    reconcileExteriorCellLoads(state, ["cell-a"]);
    state.inFlight.delete("cell-a");
    expect(reconcileExteriorCellLoads(state, ["cell-a"], []).fresh).toEqual([]);
    expect(reconcileExteriorCellLoads(state, ["cell-a"]).fresh).toEqual([]);
  });
});
