import { describe, expect, it } from "vitest";

import type { CameraPose } from "../domain/visitor-navigation";
import { CITYWIDE_OVERVIEW_CELL_EXTENTS } from "./citywide-overview-cell-extents";
import { EXTERIOR_DEFAULT_ACTIVATION, verifyPromotedExteriorPin } from "./exterior-default-activation";
import { EXTERIOR_CELL_UNIT_CLASS, exteriorCellUnits, scheduleExteriorCells } from "./exterior-cell-scheduling";
import { EXTERIOR_CELL_SCHEDULER_POLICY } from "./exterior-visibility-scheduler";
import { fallbackViewportFootprint, viewportFootprintFromGroundPoints, type ViewportFootprint } from "./viewport-footprint";

const BLOCK_835_LEDGER_ID = "manhattan-exterior-cell-w00-000000-block-00835";
const BLOCK_835_RELEASE_ID = "cell:manhattan:block-835";
const OVERHANG_CELL = "manhattan-exterior-cell-w05-000830-16-19304-17903";

/** Every ledger cell, in the sorted order `ExteriorCellRuntime.cellIds()` produces. */
const ALL_CELL_IDS = CITYWIDE_OVERVIEW_CELL_EXTENTS.map((entry) => entry.cellId).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

function pose(longitude: number, latitude: number, height = 300): CameraPose {
  return { longitude, latitude, height, heading: 0, pitch: -45, roll: 0 };
}

function footprintAround(longitude: number, latitude: number, half: number): ViewportFootprint {
  const footprint = viewportFootprintFromGroundPoints([
    [longitude - half, latitude - half * 0.65], [longitude + half, latitude - half * 0.65],
    [longitude - half, latitude + half * 0.65], [longitude + half, latitude + half * 0.65],
  ]);
  if (!footprint) throw new Error("fixture bounds produced no footprint");
  return footprint;
}

describe("scheduleExteriorCells: the default path", () => {
  /**
   * The identity claim, as a fact about object identity rather than about
   * contents. `toBe` is the point: a filtered copy that happens to keep every
   * element would pass a `toEqual` and would still be a different array reaching
   * `Promise.all` in a different allocation, and a future change to the filter
   * could silently start dropping elements while the test kept passing.
   */
  it("returns the caller's own array by reference when the flag is off", () => {
    const schedule = scheduleExteriorCells(ALL_CELL_IDS, { enabled: false, footprint: footprintAround(-73.98, 40.75, 0.01), camera: pose(-73.98, 40.75), heightBucket: 300, previous: null });
    expect(schedule.cellIds).toBe(ALL_CELL_IDS);
    expect(schedule.deferredCellIds).toEqual([]);
    expect(schedule.unschedulableCellIds).toEqual([]);
    expect(schedule.carry).toBeNull();
    expect(schedule.decision).toBeNull();
  });

  it("stays identity for every camera, footprint and bucket while the flag is off", () => {
    for (const [longitude, latitude, height] of [[-73.98, 40.75, 120], [-74.02, 40.71, 4_000], [-73.93, 40.85, 12_000]] as const) {
      const schedule = scheduleExteriorCells(ALL_CELL_IDS, { enabled: false, footprint: footprintAround(longitude, latitude, height / 111_000), camera: pose(longitude, latitude, height), heightBucket: Math.round(height / 100) * 100, previous: null });
      expect(schedule.cellIds).toBe(ALL_CELL_IDS);
    }
  });
});

describe("scheduleExteriorCells: the opt-in path", () => {
  it("defers the overwhelming majority of the island at a street-level camera", () => {
    const schedule = scheduleExteriorCells(ALL_CELL_IDS, { enabled: true, footprint: footprintAround(-73.98, 40.755, 0.004), camera: pose(-73.98, 40.755, 250), heightBucket: 300, previous: null });
    expect(schedule.cellIds.length).toBeLessThanOrEqual(EXTERIOR_CELL_SCHEDULER_POLICY.maxResidentUnits + (schedule.decision?.reserved.length ?? 0));
    expect(schedule.cellIds.length + schedule.deferredCellIds.length).toBe(ALL_CELL_IDS.length);
    expect(schedule.deferredCellIds.length).toBeGreaterThan(700);
  });

  it("preserves the runtime's own declared order in the load list", () => {
    const schedule = scheduleExteriorCells(ALL_CELL_IDS, { enabled: true, footprint: footprintAround(-73.98, 40.755, 0.01), camera: pose(-73.98, 40.755, 400), heightBucket: 400, previous: null });
    const positions = schedule.cellIds.map((cellId) => ALL_CELL_IDS.indexOf(cellId));
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it("resolves the Block 835 release cell id through the ledger alias rather than deferring it", () => {
    const declared = [BLOCK_835_RELEASE_ID];
    const block835 = CITYWIDE_OVERVIEW_CELL_EXTENTS.find((entry) => entry.cellId === BLOCK_835_LEDGER_ID)!;
    const centre = { longitude: (block835.renderBounds.west + block835.renderBounds.east) / 2, latitude: (block835.renderBounds.south + block835.renderBounds.north) / 2 };
    const schedule = scheduleExteriorCells(declared, { enabled: true, footprint: footprintAround(centre.longitude, centre.latitude, 0.002), camera: pose(centre.longitude, centre.latitude, 120), heightBucket: 100, previous: null });
    expect(schedule.unschedulableCellIds).toEqual([]);
    expect(schedule.cellIds).toEqual([BLOCK_835_RELEASE_ID]);
    expect(schedule.decision?.reserved).toEqual([BLOCK_835_RELEASE_ID]);
  });

  /**
   * The fail-closed direction. A cell the census carries no extent for cannot be
   * proven invisible, so it is loaded. Withholding it would be the scheduler
   * inventing an absence, which is the one failure mode a visibility scheduler
   * must not have.
   */
  it("always loads a cell the committed census carries no extent for", () => {
    const declared = ["c1", "c2", OVERHANG_CELL];
    const schedule = scheduleExteriorCells(declared, { enabled: true, footprint: footprintAround(-73.98, 40.75, 0.002), camera: pose(-73.98, 40.75, 200), heightBucket: 200, previous: null });
    expect(schedule.unschedulableCellIds).toEqual(["c1", "c2"]);
    expect(schedule.cellIds).toEqual(["c1", "c2"]);
    expect(schedule.deferredCellIds).toEqual([OVERHANG_CELL]);
    expect(exteriorCellUnits(declared).units.map((entry) => entry.unitId)).toEqual([OVERHANG_CELL]);
  });

  it("builds units from renderBounds, the census order and the cell id as the tiebreak", () => {
    const { units } = exteriorCellUnits([OVERHANG_CELL]);
    const extent = CITYWIDE_OVERVIEW_CELL_EXTENTS.find((entry) => entry.cellId === OVERHANG_CELL)!;
    expect(units).toEqual([{ unitId: OVERHANG_CELL, class: EXTERIOR_CELL_UNIT_CLASS, bounds: extent.renderBounds, order: extent.order, tieBreakKey: OVERHANG_CELL }]);
    expect(extent.order).toBe(830);
  });

  /**
   * The separation the whole opt-in depends on: the scheduler filters LOADS, and
   * the promotion gate verifies the RESOLVED ACTIVATION SET. They are different
   * sets and must never be the same one.
   *
   * `verifyPromotedExteriorPin` compares `resolved.cells.length` against the
   * accepted `cellCount`, so a build that ever fed it the scheduled subset would
   * fail every promoted wave closed the moment the scheduler deferred a cell —
   * exterior geometry would disappear because the camera moved. This test proves
   * that failure is real rather than hypothetical, which is the reason the App
   * passes `runtime.snapshot.cells` to the gate and the scheduled list only to
   * `loadCell`.
   */
  it("must never be fed to the promoted-pin gate: a scheduled subset fails the cell-count check", () => {
    const record = EXTERIOR_DEFAULT_ACTIVATION;
    if (!record.enabled) throw new Error("the Block 835 record is expected to be enabled in this build");
    const resolved = {
      releaseId: record.releaseId,
      snapshotId: record.snapshotId,
      snapshotChecksumSha256: record.snapshotChecksumSha256,
      assemblyPackageIds: record.assemblyPackageIds,
    };
    expect(verifyPromotedExteriorPin({ ...resolved, cells: record.membership.cells }, record).ok).toBe(true);
    const scheduledToNothing = verifyPromotedExteriorPin({ ...resolved, cells: [] }, record);
    if (scheduledToNothing.ok) throw new Error("a scheduled-to-nothing subset must not pass the promoted pin gate");
    expect(scheduledToNothing.message).toContain("cell count");
  });

  /**
   * The cap is per CALL, and the App calls this once per wave runtime, so a
   * six-wave session is bounded by 6 x `maxResidentUnits` rather than by
   * `maxResidentUnits`. That is a real property of this shape and it is pinned
   * here rather than left to be discovered from a measurement: the committed
   * evidence shows the midtown wave alone hitting exactly 96 at 2.4 km.
   */
  it("applies the cap per call, so a per-wave caller is bounded by the cap times the wave count", () => {
    const half = Math.floor(ALL_CELL_IDS.length / 2);
    const view = { enabled: true as const, footprint: footprintAround(-73.98, 40.758, 0.05), camera: pose(-73.98, 40.758, 5_000), heightBucket: 5_000, previous: null };
    const first = scheduleExteriorCells(ALL_CELL_IDS.slice(0, half), view);
    const second = scheduleExteriorCells(ALL_CELL_IDS.slice(half), view);
    const cap = EXTERIOR_CELL_SCHEDULER_POLICY.maxResidentUnits;
    expect(first.cellIds.length).toBeGreaterThan(0);
    expect(second.cellIds.length).toBeGreaterThan(0);
    expect(first.cellIds.length + second.cellIds.length).toBeGreaterThan(cap);
    expect(first.cellIds.length + second.cellIds.length).toBeLessThanOrEqual(2 * cap + 4);
  });

  it("holds the previous load list rather than evicting on an untrusted camera sample", () => {
    const first = scheduleExteriorCells(ALL_CELL_IDS, { enabled: true, footprint: footprintAround(-73.98, 40.755, 0.004), camera: pose(-73.98, 40.755, 250), heightBucket: 300, previous: null });
    const held = scheduleExteriorCells(ALL_CELL_IDS, { enabled: true, footprint: fallbackViewportFootprint(pose(-73.93, 40.85, 9_000)), camera: pose(-73.93, 40.85, 9_000), heightBucket: 9_000, previous: first.carry });
    expect(held.decision?.hold).toBe("held-previous");
    expect(held.decision?.evict).toEqual([]);
    expect([...held.cellIds].sort()).toEqual([...first.cellIds].sort());
  });
});
