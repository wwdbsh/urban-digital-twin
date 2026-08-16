import { describe, expect, it } from "vitest";

import type { CameraPose } from "../domain/visitor-navigation";
import { CITYWIDE_OVERVIEW_CELL_EXTENTS } from "./citywide-overview-cell-extents";
import { EXTERIOR_DEFAULT_ACTIVATION, verifyPromotedExteriorPin } from "./exterior-default-activation";
import { EXTERIOR_CELL_STATIC_UNITS, EXTERIOR_CELL_UNIT_CLASS, exteriorCellUnits, scheduleExteriorCells, scheduleExteriorCellsGlobally } from "./exterior-cell-scheduling";
import { EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY, EXTERIOR_CELL_SCHEDULER_POLICY, unitDistanceMeters } from "./exterior-visibility-scheduler";
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

/**
 * T006 B4: the mirror.
 *
 * `enabled: false` was the DEFAULT path, and the `toBe` identity test above
 * pinned that a default session allocated nothing. That claim now describes the
 * OPT-OUT, and "runs exactly as often as before" inverts with it: the question
 * is no longer whether the disabled path is free, but whether the ENABLED path
 * is stable enough that a settled camera does not churn the effect.
 *
 * The honest answer, pinned here rather than asserted: the enabled path
 * allocates a new array per call by construction — it is a filter — so it is
 * NOT reference-identical. What it is, and what the effect actually depends on,
 * is CONTENT-stable across repeated calls at one settled camera. The effect
 * reconciles on `exteriorCellLoadInputsUnchanged`, which compares runtime,
 * profile and height bucket and is deliberately blind to the footprint, so a
 * content-stable decision produces no additional load work.
 */
describe("scheduleExteriorCells: the default path is now the enabled path", () => {
  const settled = () => ({ enabled: true, footprint: footprintAround(-73.98, 40.755, 0.004), camera: pose(-73.98, 40.755, 250), heightBucket: 300, previous: null });

  it("is content-stable, and NOT reference-identical, at a settled camera", () => {
    const first = scheduleExteriorCells(ALL_CELL_IDS, settled());
    const second = scheduleExteriorCells(ALL_CELL_IDS, settled());
    expect(second.cellIds).toEqual(first.cellIds);
    expect(second.deferredCellIds).toEqual(first.deferredCellIds);
    // Stated rather than hidden: the enabled path is a filter and allocates.
    // A future change that made it identity would be an improvement, not a
    // requirement, and this line is what would notice.
    expect(second.cellIds).not.toBe(first.cellIds);
    // And it is a real filter, so the stability claim is not vacuous.
    expect(first.cellIds.length).toBeLessThan(ALL_CELL_IDS.length);
  });

  it("keeps the opt-out identity guarantee available as the rollback", () => {
    // The rollback restores exactly the array the caller passed in — the
    // property the promoted-subset behaviour depended on.
    const rolledBack = scheduleExteriorCells(ALL_CELL_IDS, { ...settled(), enabled: false });
    expect(rolledBack.cellIds).toBe(ALL_CELL_IDS);
    expect(rolledBack.decision).toBeNull();
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

/**
 * The six promoted waves, partitioned out of the census by the wave marker the
 * ledger stamps into every cell id. Derived rather than listed, so a census
 * change moves the partition instead of silently invalidating the test.
 */
const WAVE_IDS = ["w00", "w01", "w02", "w03", "w04", "w05"] as const;
const WAVES = WAVE_IDS.map((waveId) => ({ releaseId: `wave-${waveId}`, declaredCellIds: ALL_CELL_IDS.filter((cellId) => cellId.includes(`-cell-${waveId}-`)) }));

describe("scheduleExteriorCellsGlobally: one decision for the session", () => {
  it("partitions the whole census into the six promoted waves", () => {
    expect(WAVES.map((wave) => wave.declaredCellIds.length)).toEqual([1, 149, 126, 176, 249, 182]);
    expect(WAVES.reduce((sum, wave) => sum + wave.declaredCellIds.length, 0)).toBe(883);
    expect(EXTERIOR_CELL_STATIC_UNITS).toHaveLength(883);
  });

  it("returns every wave's own array by reference when the flag is off", () => {
    const schedule = scheduleExteriorCellsGlobally(WAVES, { enabled: false, footprint: footprintAround(-73.98, 40.75, 0.01), camera: pose(-73.98, 40.75), heightBucket: 300, previous: null });
    for (const wave of WAVES) expect(schedule.byRelease.get(wave.releaseId)!.cellIds).toBe(wave.declaredCellIds);
    expect(schedule.carry).toBeNull();
    expect(schedule.decision).toBeNull();
  });

  /**
   * The frozen correction, as the test that would catch its violation.
   *
   * The unit list must be the STATIC 883-row table and never "the waves loaded
   * so far". A pool built from loaded waves would hand the first wave to arrive
   * the whole cap, so a wave's residency would depend on the order the waves'
   * indexes happened to come back — which is not reproducible from a camera
   * trace, and reproducibility from a camera trace is the one property the
   * scheduler contract exists to have.
   */
  it("gives a wave the same cells whether it loaded alone or beside the other five", () => {
    const view = { enabled: true as const, footprint: footprintAround(-73.98, 40.758, 0.03), camera: pose(-73.98, 40.758, 3_000), heightBucket: 3_000, previous: null };
    const midtown = WAVES.find((wave) => wave.releaseId === "wave-w01")!;
    const alone = scheduleExteriorCellsGlobally([midtown], view).byRelease.get(midtown.releaseId)!;
    const together = scheduleExteriorCellsGlobally(WAVES, view).byRelease.get(midtown.releaseId)!;
    expect(alone.cellIds).toEqual(together.cellIds);
    // And the wave that loaded alone did NOT inherit the whole cap: it took the
    // share the global ranking gave it, leaving the rest for waves not yet here.
    expect(alone.cellIds.length).toBeLessThan(EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY.maxResidentUnits);
  });

  it("bounds the SESSION by one cap instead of the cap times the wave count", () => {
    const view = { enabled: true as const, footprint: footprintAround(-73.98, 40.758, 0.05), camera: pose(-73.98, 40.758, 5_000), heightBucket: 5_000, previous: null };
    const global = scheduleExteriorCellsGlobally(WAVES, view);
    const globalTotal = WAVES.reduce((sum, wave) => sum + global.byRelease.get(wave.releaseId)!.cellIds.length, 0);
    const perWaveTotal = WAVES.reduce((sum, wave) => sum + scheduleExteriorCells(wave.declaredCellIds, view).cellIds.length, 0);

    const reserved = global.decision?.reserved.length ?? 0;
    expect(globalTotal).toBeLessThanOrEqual(EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY.maxResidentUnits + reserved);
    // The shape T003 replaces: six independent caps, and it really does exceed
    // the single one at this camera rather than being a theoretical difference.
    expect(perWaveTotal).toBeGreaterThan(globalTotal);
    expect(6 * EXTERIOR_CELL_SCHEDULER_POLICY.maxResidentUnits).toBe(576);
    expect(EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY.maxResidentUnits).toBe(128);
  });

  /**
   * No residency regression against the six-pool configuration. ADR 0041's
   * committed evidence holds 110 cells at the 2,400 m overview camera; whenever
   * the single decision binds it admits 128, which is strictly more, and the
   * 18-cell difference is budget the per-wave shape could not spend because it
   * was locked inside four waves the camera was not looking at.
   */
  it("admits the full cap where the six-pool configuration truncated at 110", () => {
    const MEASURED_SIX_POOL_OVERVIEW_RESIDENCY = 110;
    const view = { enabled: true as const, footprint: footprintAround(-73.98, 40.758, 0.05), camera: pose(-73.98, 40.758, 5_000), heightBucket: 5_000, previous: null };
    const global = scheduleExteriorCellsGlobally(WAVES, view);
    expect(global.decision!.visibleCount).toBeGreaterThan(EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY.maxResidentUnits);
    expect(global.residentCellIds.length).toBe(EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY.maxResidentUnits);
    expect(global.residentCellIds.length).toBeGreaterThan(MEASURED_SIX_POOL_OVERVIEW_RESIDENCY);
  });

  it("keeps each wave's load list in that wave's own declared order", () => {
    const view = { enabled: true as const, footprint: footprintAround(-73.98, 40.758, 0.03), camera: pose(-73.98, 40.758, 3_000), heightBucket: 3_000, previous: null };
    const schedule = scheduleExteriorCellsGlobally(WAVES, view);
    for (const wave of WAVES) {
      const positions = schedule.byRelease.get(wave.releaseId)!.cellIds.map((cellId) => wave.declaredCellIds.indexOf(cellId));
      expect(positions).toEqual([...positions].sort((left, right) => left - right));
    }
  });

  /**
   * The alias, which a global pool gets wrong in a way a per-wave pool cannot.
   *
   * Block 835 shipped before the wave ledger existed, so its release names the
   * cell `cell:manhattan:block-835` while the census — and therefore the static
   * unit pool — names it `manhattan-exterior-cell-w00-000000-block-00835`. The
   * per-wave binding never had this problem: it built units FROM the declared
   * ids, so the alias resolved on the way in. The global binding compares a
   * declared id against a resident set of census ids, and comparing them
   * directly deferred wave w00 at every camera including the one it is standing
   * in. Caught by a latency capture on the real build: a street-level session
   * requested 6 artifacts where it had requested 20.
   */
  it("resolves the Block 835 release alias against the census unit pool", () => {
    const block835 = CITYWIDE_OVERVIEW_CELL_EXTENTS.find((entry) => entry.cellId === BLOCK_835_LEDGER_ID)!;
    const centre = { longitude: (block835.renderBounds.west + block835.renderBounds.east) / 2, latitude: (block835.renderBounds.south + block835.renderBounds.north) / 2 };
    const view = { enabled: true as const, footprint: footprintAround(centre.longitude, centre.latitude, 0.002), camera: pose(centre.longitude, centre.latitude, 260), heightBucket: 300, previous: null };
    const wave = { releaseId: "manhattan-exterior-cells-20260811-v3", declaredCellIds: [BLOCK_835_RELEASE_ID] };
    const schedule = scheduleExteriorCellsGlobally([wave, ...WAVES.filter((entry) => entry.releaseId !== "wave-w00")], view);
    const block835Schedule = schedule.byRelease.get(wave.releaseId)!;
    expect(block835Schedule.cellIds).toEqual([BLOCK_835_RELEASE_ID]);
    expect(block835Schedule.deferredCellIds).toEqual([]);
    expect(block835Schedule.unschedulableCellIds).toEqual([]);
    // The camera is standing in it, so the reservation names the CENSUS id.
    expect(schedule.decision!.reserved).toContain(BLOCK_835_LEDGER_ID);
  });

  it("still always loads a cell the census carries no extent for, per wave", () => {
    const fixtureWave = { releaseId: "wave-fixture", declaredCellIds: ["c1", "c2"] };
    const view = { enabled: true as const, footprint: footprintAround(-73.98, 40.75, 0.002), camera: pose(-73.98, 40.75, 200), heightBucket: 200, previous: null };
    const schedule = scheduleExteriorCellsGlobally([...WAVES, fixtureWave], view);
    const fixture = schedule.byRelease.get("wave-fixture")!;
    expect(fixture.unschedulableCellIds).toEqual(["c1", "c2"]);
    expect(fixture.cellIds).toEqual(["c1", "c2"]);
    expect(fixture.deferredCellIds).toEqual([]);
  });

  it("carries one residency forward and holds it verbatim on an untrusted sample", () => {
    const first = scheduleExteriorCellsGlobally(WAVES, { enabled: true, footprint: footprintAround(-73.98, 40.755, 0.004), camera: pose(-73.98, 40.755, 250), heightBucket: 300, previous: null });
    const held = scheduleExteriorCellsGlobally(WAVES, { enabled: true, footprint: fallbackViewportFootprint(pose(-73.93, 40.85, 9_000)), camera: pose(-73.93, 40.85, 9_000), heightBucket: 9_000, previous: first.carry });
    expect(held.decision!.hold).toBe("held-previous");
    expect(held.decision!.evict).toEqual([]);
    expect([...held.residentCellIds].sort()).toEqual([...first.residentCellIds].sort());
  });
});

/**
 * ## T005 D-4, FIXED: no admitted cell is farther than a deferred one
 *
 * T003 recorded this as a FINDING and pinned the defect rather than repairing
 * it: the policy ranked by tier, then distance BAND, then the census `order`,
 * and `order` is the ledger's wave-and-position index — Block 835 at 0, midtown
 * from 1, northern to 882. Inside one band, up to 1,200 m wide, a cell the
 * camera nearly stands on could be deferred in favour of a cell 1,100 m away
 * belonging to an earlier wave. T003 deferred the fix because changing the rank
 * changes the frozen thrash baselines, and handed it to T005 as the first task
 * with a rendered A/B in scope.
 *
 * `compareRanked` now ranks by the measured distance below the band, and this
 * test is inverted accordingly: what was an assertion that an inversion EXISTS
 * is now an assertion that NONE does, over the whole 883-cell census at a camera
 * where the cap binds hard. The scan is exhaustive over admitted/deferred pairs
 * rather than sampled, so a future rank change that reintroduces the defect
 * fails here rather than being noticed in a frame capture.
 */
describe("T005 D-4: band-internal ranking prefers distance over wave order", () => {
  it("never admits a cell farther than one it defers in the same band", () => {
    const view = { enabled: true as const, footprint: footprintAround(-73.96, 40.79, 0.06), camera: pose(-73.96, 40.79, 6_000), heightBucket: 6_000, previous: null };
    const schedule = scheduleExteriorCellsGlobally(WAVES, view);
    const decision = schedule.decision!;
    const resident = new Set(decision.resident);
    const policy = { metersPerDegreeLongitude: 84_600, metersPerDegreeLatitude: 111_000 };
    const centre = view.footprint.groundCenter;

    const scored = EXTERIOR_CELL_STATIC_UNITS.map((unit) => {
      const distance = unitDistanceMeters(unit.bounds, centre.longitude, centre.latitude, policy);
      const band = EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY.distanceBandEdgesMeters.filter((edge) => distance >= edge).length;
      return { unitId: unit.unitId, order: unit.order, distance, band, admitted: resident.has(unit.unitId) };
    });
    // The camera must be somewhere the cap actually binds, or "no inversion"
    // would be vacuously true because nothing was deferred at all.
    expect(decision.deferredCount).toBeGreaterThan(0);

    const admitted = scored.filter((entry) => entry.admitted);
    const deferred = scored.filter((entry) => !entry.admitted);
    const inversions = admitted.flatMap((entry) => deferred
      .filter((victim) => victim.band === entry.band && victim.distance < entry.distance)
      // A camera-reserved unit is exempt from the cap by design and can sit at
      // any distance, so it is not an ordering inversion. See `selectResidentUnits`.
      .filter(() => !decision.reserved.includes(entry.unitId))
      .map((victim) => ({ admitted: entry.unitId, admittedDistance: entry.distance, deferred: victim.unitId, deferredDistance: victim.distance })));
    expect(inversions).toEqual([]);
  });
});

/**
 * T005: the detail radius reaches the decision through this binding, and the
 * identity guarantee survives it.
 */
describe("scheduleExteriorCellsGlobally: the detail radius (T005)", () => {
  const view = { enabled: true as const, footprint: footprintAround(-73.98, 40.758, 0.05), camera: pose(-73.98, 40.758, 5_000), heightBucket: 5_000, previous: null };

  it("still returns each wave's own array by reference when disabled, radius or not", () => {
    const schedule = scheduleExteriorCellsGlobally(WAVES, { ...view, enabled: false, maxUnitDistanceMeters: 250 });
    for (const wave of WAVES) expect(schedule.byRelease.get(wave.releaseId)!.cellIds).toBe(wave.declaredCellIds);
    expect(schedule.decision).toBeNull();
  });

  it("passes the radius through: a tighter radius is a strict subset of a wider one", () => {
    const wide = scheduleExteriorCellsGlobally(WAVES, view);
    const tight = scheduleExteriorCellsGlobally(WAVES, { ...view, maxUnitDistanceMeters: 1_000 });
    expect(tight.residentCellIds.length).toBeLessThan(wide.residentCellIds.length);
    for (const cellId of tight.residentCellIds) expect(wide.residentCellIds).toContain(cellId);
    expect(tight.decision!.visibleCount).toBeLessThan(wide.decision!.visibleCount);
  });

  it("treats an absent radius and an explicit null as the same decision", () => {
    const absent = scheduleExteriorCellsGlobally(WAVES, view);
    const nulled = scheduleExteriorCellsGlobally(WAVES, { ...view, maxUnitDistanceMeters: null });
    expect(nulled.residentCellIds).toEqual(absent.residentCellIds);
  });

  it("keeps Block 835 resident at its own camera at any radius", () => {
    const block835 = "manhattan-exterior-cell-w00-000000-block-00835";
    const extent = CITYWIDE_OVERVIEW_CELL_EXTENTS.find((entry) => entry.cellId === block835)!;
    const centre = { longitude: (extent.renderBounds.west + extent.renderBounds.east) / 2, latitude: (extent.renderBounds.south + extent.renderBounds.north) / 2 };
    const schedule = scheduleExteriorCellsGlobally(WAVES, {
      enabled: true, footprint: footprintAround(centre.longitude, centre.latitude, 0.01), camera: pose(centre.longitude, centre.latitude, 120), heightBucket: 100, previous: null, maxUnitDistanceMeters: 1,
    });
    expect(schedule.residentCellIds).toContain(block835);
  });
});
