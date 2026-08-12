/**
 * The curated `w05` subset's own rules: what it refuses, and what it records.
 *
 * The OPTIMALITY claim — that this cell is the maximum under the stated rule — is
 * re-enumerated from committed bytes in
 * `northern-manhattan-curation-optimum.test.ts`. This suite is the other half:
 * the resolver's refusals, the inherited-reservation guard, the refusal census and
 * the volume margin, each probed in both directions.
 */
import { describe, expect, it } from "vitest";
import {
  NORTHERN_MANHATTAN_CANARY_RENDERABLE_CELL_IDS,
  NORTHERN_MANHATTAN_CANDIDATE_ENVELOPE,
  NORTHERN_MANHATTAN_CURATED_CELLS,
  NORTHERN_MANHATTAN_CURATED_MAX_REFUSAL_RATE,
  NORTHERN_MANHATTAN_CURATION_BASIS,
  NORTHERN_MANHATTAN_CURATION_STATEMENT,
  NORTHERN_MANHATTAN_RESERVATION_SOURCE_RELEASE_ID,
  NORTHERN_MANHATTAN_RESERVED_ENTRIES,
  NORTHERN_MANHATTAN_SKYLINE_HEIGHT_METERS,
  NORTHERN_MANHATTAN_SKYLINE_THRESHOLDS_METERS,
  NORTHERN_MANHATTAN_WAVE_REFUSAL_RATE,
  NORTHERN_MANHATTAN_WAVE_WORST_VOLUME_FRACTION,
  northernManhattanCellsAdjacent,
  northernManhattanCellsConnected,
  northernManhattanCuratedCells,
  northernManhattanCuratedEntryBudget,
  northernManhattanCuratedRefusalCensus,
  northernManhattanCuratedVolumeMargin,
} from "./northern-manhattan-curation";
import type { NorthernManhattanReservation } from "./northern-manhattan-release";

const CURATED_ID = "manhattan-exterior-cell-w05-000727-17-38611-35819";

/** The curated cell as the committed ledger states it. */
const CURATED_CELL = {
  cellId: CURATED_ID,
  order: 26,
  bounds: { west: -73.95172119140625, south: 40.8087158203125, east: -73.948974609375, north: 40.810089111328125 },
  buildingIds: Array.from({ length: 24 }, (_, index) => `doitt:${100000 + index}`),
};

const RESERVATION: NorthernManhattanReservation = {
  fromReleaseId: NORTHERN_MANHATTAN_RESERVATION_SOURCE_RELEASE_ID,
  forWaveId: "northern-manhattan",
  entries: 36,
  splitResponse: 2,
  splitFromHeadroomEntries: 78,
  splitTakenByPredecessorEntries: 42,
};

const PROMOTED_WAVES = [
  { releaseId: "manhattan-exterior-cells-20260811-v3", assetEntries: 28 },
  { releaseId: "manhattan-midtown-core-cells-20260811-v3", assetEntries: 156 },
  { releaseId: "manhattan-lower-manhattan-cells-20260812-p1", assetEntries: 71 },
  { releaseId: "manhattan-southern-remainder-cells-20260812-p1", assetEntries: 179 },
  { releaseId: "manhattan-central-upper-manhattan-cells-20260812-p1", assetEntries: 40 },
];

const BUDGET_INPUT = {
  maxCacheEntries: 512,
  promotedWaves: PROMOTED_WAVES,
  remainingUnpromotedWaveIds: ["northern-manhattan"],
  reservation: RESERVATION,
  declaredWaveCount: 6,
};

describe("the curated list resolves against the ledger or refuses", () => {
  it("resolves the one curated cell and reports the entries it leaves unspent", () => {
    const subset = northernManhattanCuratedCells([CURATED_CELL], 36);
    expect(subset.cells.map((cell) => cell.cellId)).toEqual([CURATED_ID]);
    expect(subset.records).toBe(NORTHERN_MANHATTAN_CURATED_CELLS);
    expect(subset.ownedBuildingCount).toBe(24);
    expect(subset.entryBudget).toBe(36);
    // TWELVE UNSPENT, which is the shape of this promotion and not a rounding.
    expect(subset.spareEntries).toBe(12);
    expect(subset.basis).toBe(NORTHERN_MANHATTAN_CURATION_BASIS);
    // A single cell is trivially one connected piece.
    expect(northernManhattanCellsConnected(subset.cells)).toBe(true);
  });

  it("refuses a curated id the ledger does not own", () => {
    expect(() => northernManhattanCuratedCells([], 36)).toThrow(/is not owned by this wave's ledger/u);
  });

  it("refuses a cell whose id no longer carries the full-city order the curation recorded", () => {
    // The parent order survives verbatim only in the cell id, so a ledger that
    // renumbered would be caught here rather than silently promoting other ground.
    expect(() => northernManhattanCuratedCells([{ ...CURATED_CELL, cellId: "manhattan-exterior-cell-w05-000728-17-38611-35819" }], 36))
      .toThrow(/is not owned by this wave's ledger/u);
  });

  it("refuses a cell outside the stated candidate envelope", () => {
    const outside = { ...CURATED_CELL, bounds: { ...CURATED_CELL.bounds, west: NORTHERN_MANHATTAN_CANDIDATE_ENVELOPE.west - 1 } };
    expect(() => northernManhattanCuratedCells([outside], 36)).toThrow(/outside the stated candidate envelope/u);
  });

  it("refuses a subset that would overflow the inherited reservation", () => {
    const oversized = { ...CURATED_CELL, buildingIds: Array.from({ length: 37 }, (_, index) => `doitt:${index}`) };
    expect(() => northernManhattanCuratedCells([oversized], 36))
      .toThrow(/above the 36-entry reservation T020's split committed to this wave/u);
  });

  it("names the canary's cell as excluded, and that cell is NOT the curated one", () => {
    expect(NORTHERN_MANHATTAN_CANARY_RENDERABLE_CELL_IDS).toEqual(["manhattan-exterior-cell-w05-000701-15-9651-8954"]);
    expect(NORTHERN_MANHATTAN_CANARY_RENDERABLE_CELL_IDS).not.toContain(CURATED_ID);
  });
});

describe("edge adjacency and connectedness", () => {
  const left = { cellId: "a", order: 0, bounds: { west: 0, south: 0, east: 1, north: 1 }, buildingIds: [] };
  const right = { cellId: "b", order: 1, bounds: { west: 1, south: 0, east: 2, north: 1 }, buildingIds: [] };
  const corner = { cellId: "c", order: 2, bounds: { west: 1, south: 1, east: 2, north: 2 }, buildingIds: [] };
  const far = { cellId: "d", order: 3, bounds: { west: 9, south: 9, east: 10, north: 10 }, buildingIds: [] };

  it("counts a shared edge and not a shared corner", () => {
    expect(northernManhattanCellsAdjacent(left.bounds, right.bounds)).toBe(true);
    expect(northernManhattanCellsAdjacent(left.bounds, corner.bounds)).toBe(false);
    expect(northernManhattanCellsAdjacent(left.bounds, far.bounds)).toBe(false);
  });

  it("calls a scattered set disconnected and an empty set not a piece at all", () => {
    expect(northernManhattanCellsConnected([left, right])).toBe(true);
    expect(northernManhattanCellsConnected([left, far])).toBe(false);
    expect(northernManhattanCellsConnected([])).toBe(false);
  });
});

describe("the inherited reservation is consumed, not re-cut", () => {
  it("derives a 36-entry budget and records the surplus it does not take", () => {
    const budget = northernManhattanCuratedEntryBudget(BUDGET_INPUT);
    expect(budget.promotedAssetEntries).toBe(474);
    expect(budget.alongsidePromotedHeadroom).toBe(38);
    expect(budget.entryBudget).toBe(36);
    expect(budget.entryBudget).toBe(NORTHERN_MANHATTAN_RESERVED_ENTRIES);
    expect(budget.headroomExceedsReservationBy).toBe(2);
    expect(budget.reservationConsumed).toBe(true);
    expect(budget.isLastUnpromotedWave).toBe(true);
    expect(budget.promotedWaveCountAfterThisRelease).toBe(6);
    expect(budget.completesLedgerCoverage).toBe(true);
    expect(budget.reservationStatement).toMatch(/IT CONSUMES ONE/u);
  });

  /**
   * The guard that stops this promotion from inheriting a number it was not
   * enumerated against. The curated list, the rejected alternatives and every cost
   * sentence were all chosen against 36 entries; a predecessor re-emitted with a
   * different reservation must re-open the decision rather than re-cut the subset.
   */
  it("refuses a reservation that disagrees with the one this curation was enumerated against", () => {
    expect(() => northernManhattanCuratedEntryBudget({ ...BUDGET_INPUT, reservation: { ...RESERVATION, entries: 30 } }))
      .toThrow(/reserves 30 entries for this wave, but this curation was enumerated against 36/u);
  });

  it("refuses a reservation read from a release that did not make it", () => {
    expect(() => northernManhattanCuratedEntryBudget({ ...BUDGET_INPUT, reservation: { ...RESERVATION, fromReleaseId: "manhattan-lower-manhattan-cells-20260812-p1" } }))
      .toThrow(/only the promoted predecessor's own committed bytes bind this promotion/u);
  });

  it("refuses a reservation that no longer fits what is actually free", () => {
    const crowded = [...PROMOTED_WAVES, { releaseId: "manhattan-extra-wave", assetEntries: 20 }];
    expect(() => northernManhattanCuratedEntryBudget({ ...BUDGET_INPUT, promotedWaves: crowded }))
      .toThrow(/the reservation no longer fits the cache it was split out of/u);
  });

  /**
   * Every reservation sentence in the emitted record rests on this being the LAST
   * unpromoted wave. A build where it is not — a rollback of an earlier wave, say
   * — must re-open the decision rather than emit those sentences unchanged.
   */
  it("refuses a build in which this is not the last unpromoted wave", () => {
    expect(() => northernManhattanCuratedEntryBudget({ ...BUDGET_INPUT, remainingUnpromotedWaveIds: ["northern-manhattan", "southern-remainder"] }))
      .toThrow(/which is not this wave alone/u);
    expect(() => northernManhattanCuratedEntryBudget({ ...BUDGET_INPUT, remainingUnpromotedWaveIds: [] }))
      .toThrow(/no unpromoted wave was supplied/u);
  });

  it("refuses an understated or overstated promoted set", () => {
    expect(() => northernManhattanCuratedEntryBudget({ ...BUDGET_INPUT, promotedWaves: [] })).toThrow(/no promoted wave was supplied/u);
    expect(() => northernManhattanCuratedEntryBudget({ ...BUDGET_INPUT, promotedWaves: [...PROMOTED_WAVES, PROMOTED_WAVES[0]!] })).toThrow(/counted twice/u);
    expect(() => northernManhattanCuratedEntryBudget({ ...BUDGET_INPUT, promotedWaves: [{ releaseId: "empty", assetEntries: 0 }] })).toThrow(/is not a promoted wave/u);
  });

  /**
   * `completesLedgerCoverage` is arithmetic over the DECLARED plan, not a constant
   * six. A seven-wave ledger with six promoted waves must report `false`.
   */
  it("reports incomplete coverage when the declared plan is larger than the promoted set", () => {
    expect(northernManhattanCuratedEntryBudget({ ...BUDGET_INPUT, declaredWaveCount: 7 }).completesLedgerCoverage).toBe(false);
  });
});

describe("the local refusal census", () => {
  it("reports 0 of 24 as BELOW the wave rate, with the granularity that pass had", () => {
    const census = northernManhattanCuratedRefusalCensus({ ownedBuildingCount: 24, materializedBuildingCount: 24, refusedBuildingCount: 0 });
    expect(census.localRefusalRate).toBe(0);
    expect(census.waveRefusalRate).toBeCloseTo(381 / 10230, 12);
    expect(census.maxRefusalRate).toBeCloseTo(2 * NORTHERN_MANHATTAN_WAVE_REFUSAL_RATE, 12);
    expect(census.localRateExceedsWaveRate).toBe(false);
    expect(census.refusalGranularity).toBeCloseTo(1 / 24, 12);
    expect(census.ok).toBe(true);
  });

  /**
   * The ceiling has real teeth at this size, and the two-refusal case proves it
   * rather than the record asserting it. ONE refusal passes at 4.17%; TWO is
   * 8.33%, which is above twice the 3.72% wave rate.
   */
  it("would still pass at one refusal and would FAIL at two", () => {
    expect(northernManhattanCuratedRefusalCensus({ ownedBuildingCount: 24, materializedBuildingCount: 23, refusedBuildingCount: 1 }).ok).toBe(true);
    const two = northernManhattanCuratedRefusalCensus({ ownedBuildingCount: 24, materializedBuildingCount: 22, refusedBuildingCount: 2 });
    expect(two.localRefusalRate).toBeCloseTo(2 / 24, 12);
    expect(two.localRefusalRate).toBeGreaterThan(NORTHERN_MANHATTAN_CURATED_MAX_REFUSAL_RATE);
    expect(two.ok).toBe(false);
  });

  it("refuses a census that does not account for every owned building", () => {
    expect(() => northernManhattanCuratedRefusalCensus({ ownedBuildingCount: 24, materializedBuildingCount: 20, refusedBuildingCount: 1 }))
      .toThrow(/does not account for every owned building/u);
    expect(() => northernManhattanCuratedRefusalCensus({ ownedBuildingCount: 0, materializedBuildingCount: 0, refusedBuildingCount: 0 }))
      .toThrow(/is not a rate/u);
  });
});

describe("the curated subset's volume-identity margin", () => {
  it("reports 0.18 of tolerance against the wave's 0.9895, on an accepted+rejected denominator", () => {
    const margin = northernManhattanCuratedVolumeMargin({
      buildingsChecked: 24,
      buildingsRejected: 0,
      worstVolumeDeviation: 1.8181954616596268e-7,
      tolerance: 0.000001,
    });
    expect(margin.buildingsAccepted).toBe(24);
    expect(margin.worstDeviationAsFractionOfTolerance).toBeCloseTo(0.18182, 5);
    expect(margin.waveWorstDeviationAsFractionOfTolerance).toBe(NORTHERN_MANHATTAN_WAVE_WORST_VOLUME_FRACTION);
    expect(margin.betterThanWave).toBe(true);
    expect(margin.ok).toBe(true);
  });

  it("fails on any rejection and on a deviation at or beyond tolerance", () => {
    expect(northernManhattanCuratedVolumeMargin({ buildingsChecked: 24, buildingsRejected: 1, worstVolumeDeviation: 1e-7, tolerance: 1e-6 }).ok).toBe(false);
    expect(northernManhattanCuratedVolumeMargin({ buildingsChecked: 24, buildingsRejected: 0, worstVolumeDeviation: 1e-6, tolerance: 1e-6 }).ok).toBe(false);
  });

  it("refuses a denominator that cannot be the set it was measured over", () => {
    expect(() => northernManhattanCuratedVolumeMargin({ buildingsChecked: 24, buildingsRejected: 25, worstVolumeDeviation: 1e-7, tolerance: 1e-6 }))
      .toThrow(/the denominator is accepted \+ rejected/u);
    expect(() => northernManhattanCuratedVolumeMargin({ buildingsChecked: 0, buildingsRejected: 0, worstVolumeDeviation: 1e-7, tolerance: 1e-6 }))
      .toThrow(/is not a measurement/u);
    expect(() => northernManhattanCuratedVolumeMargin({ buildingsChecked: 24, buildingsRejected: 0, worstVolumeDeviation: 1e-7, tolerance: 0 }))
      .toThrow(/tolerance must be positive/u);
  });
});

describe("what the curation states about itself", () => {
  it("keeps 90 m and the seven recorded thresholds", () => {
    expect(NORTHERN_MANHATTAN_SKYLINE_HEIGHT_METERS).toBe(90);
    expect(NORTHERN_MANHATTAN_SKYLINE_THRESHOLDS_METERS).toEqual([30, 45, 60, 75, 90, 100, 120]);
    expect(NORTHERN_MANHATTAN_SKYLINE_THRESHOLDS_METERS).toContain(NORTHERN_MANHATTAN_SKYLINE_HEIGHT_METERS);
  });

  it("states the rule, its costs and its threshold sensitivity in one place", () => {
    expect(NORTHERN_MANHATTAN_CURATION_STATEMENT).toMatch(/EXPLICIT CURATED LIST of one ownership cell/u);
    expect(NORTHERN_MANHATTAN_CURATION_STATEMENT).toMatch(/EDGE-CONTIGUITY IS A PRECONDITION/u);
    expect(NORTHERN_MANHATTAN_CURATION_STATEMENT).toMatch(/FIT THE 36-ENTRY INHERITED RESERVATION/u);
    // Key 4 is stated AND declared unreached, rather than dropped.
    expect(NORTHERN_MANHATTAN_CURATION_STATEMENT).toMatch(/Key 4 is NEVER REACHED here/u);
    expect(NORTHERN_MANHATTAN_CURATION_STATEMENT).toMatch(/Contiguity costs NOTHING on score/u);
    expect(NORTHERN_MANHATTAN_CURATION_STATEMENT).toMatch(/THE RESERVATION IS WHAT COSTS/u);
  });
});
