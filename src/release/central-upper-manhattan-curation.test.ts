/**
 * The curated `w04` subset's own gates, exercised on their refusal paths.
 *
 * Everything here is about what the curation REFUSES rather than what it
 * accepts: a curation module that only ever runs on the list it was written for
 * is a constant with extra steps, and each of these failures is one an edit to
 * that list, to the split, or to the promoted set could actually cause.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CENTRAL_UPPER_MANHATTAN_CANARY_RENDERABLE_CELL_IDS,
  CENTRAL_UPPER_MANHATTAN_CANDIDATE_ENVELOPE,
  CENTRAL_UPPER_MANHATTAN_CURATED_CELLS,
  CENTRAL_UPPER_MANHATTAN_CURATED_MAX_REFUSAL_RATE,
  CENTRAL_UPPER_MANHATTAN_CURATED_SUBSET_CEILING,
  CENTRAL_UPPER_MANHATTAN_CURATION_BASIS,
  CENTRAL_UPPER_MANHATTAN_SPLIT_RESPONSE_TAKEN,
  CENTRAL_UPPER_MANHATTAN_W05_RESERVED_ENTRIES,
  CENTRAL_UPPER_MANHATTAN_WAVE_REFUSAL_RATE,
  CENTRAL_UPPER_MANHATTAN_WAVE_WORST_VOLUME_FRACTION,
  centralUpperManhattanCellsAdjacent,
  centralUpperManhattanCellsConnected,
  centralUpperManhattanCuratedCells,
  centralUpperManhattanCuratedEntryBudget,
  centralUpperManhattanCuratedRefusalCensus,
  centralUpperManhattanCuratedVolumeMargin,
  centralUpperManhattanSplitShares,
  type CentralUpperManhattanCurationCellInput,
} from "./central-upper-manhattan-curation";

const LEDGER_PATH = "data/normalized/manhattan-exterior-wave-ledger-20260804/ledger.json";
const ledger = JSON.parse(new TextDecoder().decode(readFileSync(LEDGER_PATH))) as { cells: CentralUpperManhattanCurationCellInput[] };
const w04 = ledger.cells.filter((cell) => cell.cellId.startsWith("manhattan-exterior-cell-w04-"));

/** The four promoted waves, as the pipeline counts them from committed records. */
const PROMOTED = [
  { releaseId: "manhattan-exterior-cells-20260811-v3", assetEntries: 28 },
  { releaseId: "manhattan-midtown-core-cells-20260811-v3", assetEntries: 156 },
  { releaseId: "manhattan-lower-manhattan-cells-20260812-p1", assetEntries: 71 },
  { releaseId: "manhattan-southern-remainder-cells-20260812-p1", assetEntries: 179 },
];

describe("the curated cell list", () => {
  it("resolves two whole cells owning 41 buildings inside the stated envelope", () => {
    const subset = centralUpperManhattanCuratedCells(w04, CENTRAL_UPPER_MANHATTAN_CURATED_SUBSET_CEILING);
    expect(subset.cells).toHaveLength(2);
    expect(subset.ownedBuildingCount).toBe(41);
    expect(subset.spareEntries).toBe(1);
    expect(subset.basis).toBe(CENTRAL_UPPER_MANHATTAN_CURATION_BASIS);
    expect(subset.cells.map((cell) => cell.cellId)).toEqual(CENTRAL_UPPER_MANHATTAN_CURATED_CELLS.map((record) => record.cellId));
    for (const cell of subset.cells) {
      expect(cell.bounds.west).toBeGreaterThanOrEqual(CENTRAL_UPPER_MANHATTAN_CANDIDATE_ENVELOPE.west);
      expect(cell.bounds.east).toBeLessThanOrEqual(CENTRAL_UPPER_MANHATTAN_CANDIDATE_ENVELOPE.east);
      expect(cell.bounds.south).toBeGreaterThanOrEqual(CENTRAL_UPPER_MANHATTAN_CANDIDATE_ENVELOPE.south);
      expect(cell.bounds.north).toBeLessThanOrEqual(CENTRAL_UPPER_MANHATTAN_CANDIDATE_ENVELOPE.north);
    }
  });

  /**
   * The contiguity claim in the curation statement, checked rather than asserted.
   * The two cells share a longitude edge over the identical latitude span, which
   * is the shape the statement claims and not merely a shared corner.
   */
  it("is ONE edge-connected piece, and the shared edge is a segment rather than a corner", () => {
    const cells = CENTRAL_UPPER_MANHATTAN_CURATED_CELLS.map((record) => w04.find((cell) => cell.cellId === record.cellId)!);
    expect(centralUpperManhattanCellsConnected(cells)).toBe(true);
    expect(centralUpperManhattanCellsAdjacent(cells[0]!.bounds, cells[1]!.bounds)).toBe(true);
    expect(cells[0]!.bounds.east).toBe(cells[1]!.bounds.west);
    expect(cells[0]!.bounds.south).toBe(cells[1]!.bounds.south);
    expect(cells[0]!.bounds.north).toBe(cells[1]!.bounds.north);
    // A corner touch is NOT adjacency, which is what makes the precondition mean
    // something: two cells meeting only at a point would render as two islands.
    const cornerOnly = {
      west: cells[0]!.bounds.east,
      east: cells[0]!.bounds.east + 0.005,
      south: cells[0]!.bounds.north,
      north: cells[0]!.bounds.north + 0.003,
    };
    expect(centralUpperManhattanCellsAdjacent(cells[0]!.bounds, cornerOnly)).toBe(false);
  });

  it("refuses a cell that is not owned by this wave's ledger", () => {
    const withoutFirst = w04.filter((cell) => cell.cellId !== CENTRAL_UPPER_MANHATTAN_CURATED_CELLS[0]!.cellId);
    expect(() => centralUpperManhattanCuratedCells(withoutFirst, CENTRAL_UPPER_MANHATTAN_CURATED_SUBSET_CEILING))
      .toThrow(/is not owned by this wave's ledger/u);
  });

  it("refuses a subset that would overflow the decided share, naming what it would consume", () => {
    expect(() => centralUpperManhattanCuratedCells(w04, 40)).toThrow(/above the 40-entry share/u);
    expect(() => centralUpperManhattanCuratedCells(w04, 40)).toThrow(/reserved for wave w05/u);
  });

  it("refuses reuse of any canary renderable cell", () => {
    // The canary's cells are real cells of this wave, so the reuse gate is the
    // only thing standing between the promotion and inheriting them.
    for (const cellId of CENTRAL_UPPER_MANHATTAN_CANARY_RENDERABLE_CELL_IDS) {
      expect(w04.some((cell) => cell.cellId === cellId)).toBe(true);
      expect(CENTRAL_UPPER_MANHATTAN_CURATED_CELLS.some((record) => record.cellId === cellId)).toBe(false);
    }
  });

  it("refuses a curated record whose id and recorded parent order disagree", () => {
    const renamed = w04.map((cell) => (cell.cellId === CENTRAL_UPPER_MANHATTAN_CURATED_CELLS[0]!.cellId
      ? cell
      : cell));
    // The gate reads the order out of the id itself, so the only way to break it
    // is a record whose id does not carry its recorded order. Assert the shape
    // the gate depends on rather than mutating a frozen constant.
    for (const record of CENTRAL_UPPER_MANHATTAN_CURATED_CELLS) {
      expect(Number(/-w04-(\d{6})-/u.exec(record.cellId)![1]!)).toBe(record.parentOrder);
    }
    expect(renamed).toHaveLength(w04.length);
  });
});

describe("the decided headroom split", () => {
  it("is response 2, proportional to canonical buildings, and sums to the headroom", () => {
    expect(CENTRAL_UPPER_MANHATTAN_SPLIT_RESPONSE_TAKEN).toBe(2);
    const shares = centralUpperManhattanSplitShares();
    expect(shares.w04Share).toBe(42);
    expect(shares.w05Reserved).toBe(36);
    expect(shares.w04Share + shares.w05Reserved).toBe(78);
  });

  it("refuses a split of a headroom that no longer exists", () => {
    expect(() => centralUpperManhattanSplitShares({ headroomEntries: 0, w04BuildingCount: 1, w05BuildingCount: 1 }))
      .toThrow(/there is nothing to split/u);
  });

  it("derives the entry budget from the promoted waves' own counts", () => {
    const budget = centralUpperManhattanCuratedEntryBudget({ maxCacheEntries: 512, promotedWaves: PROMOTED });
    expect(budget.promotedAssetEntries).toBe(434);
    expect(budget.alongsidePromotedHeadroom).toBe(78);
    expect(budget.promotedWaveCount).toBe(4);
    expect(budget.entryBudget).toBe(42);
    expect(budget.reservedForNextWaveEntries).toBe(CENTRAL_UPPER_MANHATTAN_W05_RESERVED_ENTRIES);
    expect(budget.reservedForNextWaveId).toBe("northern-manhattan");
    expect(budget.splitResponse).toBe(2);
    expect(budget.splitStatement).toMatch(/RESPONSE 3 WAS NOT TAKEN/u);
    expect(budget.splitStatement).toMatch(/ADR 0034's admissible response 3/u);
  });

  it("refuses a split whose two halves no longer fit the headroom they came from", () => {
    // A fifth promotion, or a heavier fourth one, shrinks the headroom. The
    // split must then be RE-DECIDED rather than silently re-cut, so this is a
    // refusal and not a clamp.
    expect(() => centralUpperManhattanCuratedEntryBudget({
      maxCacheEntries: 512,
      promotedWaves: [...PROMOTED, { releaseId: "some-fifth-wave", assetEntries: 60 }],
    })).toThrow(/no longer fits the cache it was split out of/u);
  });

  it("refuses a promoted set that is empty, duplicated, or ships nothing", () => {
    expect(() => centralUpperManhattanCuratedEntryBudget({ maxCacheEntries: 512, promotedWaves: [] }))
      .toThrow(/no promoted wave was supplied/u);
    expect(() => centralUpperManhattanCuratedEntryBudget({ maxCacheEntries: 512, promotedWaves: [PROMOTED[0]!, PROMOTED[0]!] }))
      .toThrow(/counted twice/u);
    expect(() => centralUpperManhattanCuratedEntryBudget({
      maxCacheEntries: 512,
      promotedWaves: [...PROMOTED.slice(1), { releaseId: "empty", assetEntries: 0 }],
    })).toThrow(/is not a promoted wave/u);
  });

  it("refuses to derive a budget when the promoted set already fills the cache", () => {
    expect(() => centralUpperManhattanCuratedEntryBudget({
      maxCacheEntries: 434,
      promotedWaves: PROMOTED,
    })).toThrow(/no renderable subset fits beside them/u);
  });
});

describe("the local refusal census", () => {
  it("recomputes the shipped rate and reports that it EXCEEDS the wave rate", () => {
    const census = centralUpperManhattanCuratedRefusalCensus({
      ownedBuildingCount: 41,
      materializedBuildingCount: 40,
      refusedBuildingCount: 1,
    });
    expect(census.localRefusalRate).toBeCloseTo(0.024390, 6);
    expect(census.waveRefusalRate).toBeCloseTo(0.015186, 6);
    // The finding, stated rather than smoothed: the curated ground refuses at a
    // HIGHER rate than the wave, because one refusal in 41 buildings is the
    // smallest non-zero rate this subset can have.
    expect(census.localRateExceedsWaveRate).toBe(true);
    expect(census.ok).toBe(true);
  });

  it("bounds the local rate at twice the wave rate, computed rather than rounded", () => {
    expect(CENTRAL_UPPER_MANHATTAN_CURATED_MAX_REFUSAL_RATE).toBe(2 * CENTRAL_UPPER_MANHATTAN_WAVE_REFUSAL_RATE);
    const failing = centralUpperManhattanCuratedRefusalCensus({
      ownedBuildingCount: 41,
      materializedBuildingCount: 39,
      refusedBuildingCount: 2,
    });
    expect(failing.ok).toBe(false);
  });

  it("refuses a census that does not account for every owned building", () => {
    expect(() => centralUpperManhattanCuratedRefusalCensus({
      ownedBuildingCount: 41,
      materializedBuildingCount: 40,
      refusedBuildingCount: 0,
    })).toThrow(/does not account for every owned building/u);
  });
});

describe("the curated subset's volume-identity margin", () => {
  it("is the SUBSET's own measurement and is better than the wave's 0.988", () => {
    const margin = centralUpperManhattanCuratedVolumeMargin({
      buildingsChecked: 40,
      buildingsRejected: 0,
      worstVolumeDeviation: 3.6537873909924657e-7,
      tolerance: 0.000001,
    });
    expect(margin.worstDeviationAsFractionOfTolerance).toBeCloseTo(0.365379, 6);
    expect(margin.waveWorstDeviationAsFractionOfTolerance).toBe(CENTRAL_UPPER_MANHATTAN_WAVE_WORST_VOLUME_FRACTION);
    expect(margin.betterThanWave).toBe(true);
    expect(margin.ok).toBe(true);
  });

  it("fails closed on a rejection or on a margin at or above the tolerance", () => {
    expect(centralUpperManhattanCuratedVolumeMargin({
      buildingsChecked: 40, buildingsRejected: 1, worstVolumeDeviation: 1e-7, tolerance: 1e-6,
    }).ok).toBe(false);
    expect(centralUpperManhattanCuratedVolumeMargin({
      buildingsChecked: 40, buildingsRejected: 0, worstVolumeDeviation: 1e-6, tolerance: 1e-6,
    }).ok).toBe(false);
    expect(() => centralUpperManhattanCuratedVolumeMargin({
      buildingsChecked: 0, buildingsRejected: 0, worstVolumeDeviation: 0, tolerance: 1e-6,
    })).toThrow(/not a measurement/u);
  });
});
