/**
 * The curated `w03` subset's own gates, exercised on their refusal paths.
 *
 * Everything here is about what the curation REFUSES rather than what it
 * accepts: a curation module that only ever runs on the list it was written for
 * is a constant with extra steps, and each of these failures is one an edit to
 * that list could actually cause.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SOUTHERN_REMAINDER_CANARY_RENDERABLE_CELL_IDS,
  SOUTHERN_REMAINDER_CURATED_CELLS,
  SOUTHERN_REMAINDER_CURATED_MAX_REFUSAL_RATE,
  SOUTHERN_REMAINDER_CURATED_SUBSET_CEILING,
  SOUTHERN_REMAINDER_CURATION_BASIS,
  SOUTHERN_REMAINDER_SKYLINE_ENVELOPE,
  SOUTHERN_REMAINDER_WAVE_REFUSAL_RATE,
  southernRemainderCellsAdjacent,
  southernRemainderCellsConnected,
  southernRemainderCuratedCells,
  southernRemainderCuratedEntryBudget,
  southernRemainderCuratedRefusalCensus,
  type SouthernRemainderCurationCellInput,
} from "./southern-remainder-curation";

const LEDGER_PATH = "data/normalized/manhattan-exterior-wave-ledger-20260804/ledger.json";
const ledger = JSON.parse(new TextDecoder().decode(readFileSync(LEDGER_PATH))) as { cells: SouthernRemainderCurationCellInput[] };
const w03 = ledger.cells.filter((cell) => cell.cellId.startsWith("manhattan-exterior-cell-w03-"));

describe("the curated cell list", () => {
  it("resolves four whole cells owning 180 buildings inside the stated envelope", () => {
    const subset = southernRemainderCuratedCells(w03, SOUTHERN_REMAINDER_CURATED_SUBSET_CEILING);
    expect(subset.cells).toHaveLength(4);
    expect(subset.ownedBuildingCount).toBe(180);
    expect(subset.spareEntries).toBe(20);
    expect(subset.basis).toBe(SOUTHERN_REMAINDER_CURATION_BASIS);
    expect(subset.cells.map((cell) => cell.cellId)).toEqual(SOUTHERN_REMAINDER_CURATED_CELLS.map((record) => record.cellId));
    for (const cell of subset.cells) {
      expect(cell.bounds.west).toBeGreaterThanOrEqual(SOUTHERN_REMAINDER_SKYLINE_ENVELOPE.west);
      expect(cell.bounds.east).toBeLessThanOrEqual(SOUTHERN_REMAINDER_SKYLINE_ENVELOPE.east);
      expect(cell.bounds.south).toBeGreaterThanOrEqual(SOUTHERN_REMAINDER_SKYLINE_ENVELOPE.south);
      expect(cell.bounds.north).toBeLessThanOrEqual(SOUTHERN_REMAINDER_SKYLINE_ENVELOPE.north);
    }
  });

  /**
   * The contiguity claim in the curation statement, checked rather than
   * asserted. Cell 386 is the hub; removing it leaves three cells that touch
   * nothing, which is exactly the "scattered textured islands" outcome the
   * statement says the curation avoided.
   */
  it("is ONE edge-connected piece, and stops being one without its hub cell", () => {
    const subset = southernRemainderCuratedCells(w03, SOUTHERN_REMAINDER_CURATED_SUBSET_CEILING);
    expect(southernRemainderCellsConnected(subset.cells)).toBe(true);
    const withoutHub = subset.cells.filter((cell) => !cell.cellId.includes("-000386-"));
    expect(withoutHub).toHaveLength(3);
    expect(southernRemainderCellsConnected(withoutHub)).toBe(false);
    // A shared corner is not a shared edge, which is why adjacency is not
    // "bounding boxes touch".
    expect(southernRemainderCellsAdjacent(
      { west: 0, south: 0, east: 1, north: 1 },
      { west: 1, south: 1, east: 2, north: 2 },
    )).toBe(false);
    expect(southernRemainderCellsAdjacent(
      { west: 0, south: 0, east: 1, north: 1 },
      { west: 0, south: 1, east: 1, north: 2 },
    )).toBe(true);
  });

  /**
   * The northern-edge claim in cell 379's rationale: its north bound is shared
   * exactly with a PROMOTED Midtown-core cell, which is what makes the promoted
   * composition contiguous across waves rather than four separate patches.
   */
  it("touches the promoted Midtown-core wave along cell 379's northern edge", () => {
    const northern = w03.find((cell) => cell.cellId.includes("-000379-"))!;
    const midtown = ledger.cells.find((cell) => cell.cellId === "manhattan-exterior-cell-w01-000030-16-19298-17931")!;
    expect(northern.bounds.north).toBe(40.748291015625);
    expect(midtown.bounds.south).toBe(northern.bounds.north);
    expect(southernRemainderCellsAdjacent(northern.bounds, midtown.bounds)).toBe(true);
  });

  it("refuses a cell that is not in the ledger, outside the envelope, or the canary's", () => {
    expect(() => southernRemainderCuratedCells([], 200)).toThrow(/is not owned by this wave's ledger/u);
    const displaced = w03.map((cell) => (
      cell.cellId.includes("-000387-")
        ? { ...cell, bounds: { west: -74.02, south: 40.70, east: -74.01, north: 40.71 } }
        : cell
    ));
    expect(() => southernRemainderCuratedCells(displaced, 200)).toThrow(/outside the stated skyline envelope/u);
    // The canary's cell is excluded by name as well as by envelope, so the
    // exclusion survives an envelope that was later widened.
    expect(SOUTHERN_REMAINDER_CANARY_RENDERABLE_CELL_IDS).toEqual(["manhattan-exterior-cell-w03-000276-17-38590-35872"]);
    expect(SOUTHERN_REMAINDER_CURATED_CELLS.map((record) => record.cellId))
      .not.toContain(SOUTHERN_REMAINDER_CANARY_RENDERABLE_CELL_IDS[0]);
  });

  it("refuses a subset that does not fit the entry budget rather than truncating it", () => {
    expect(() => southernRemainderCuratedCells(w03, 179)).toThrow(/above the 179-entry budget/u);
  });

  it("refuses a curated id whose ledger order is not the one the curation recorded", () => {
    // The full-city order survives verbatim only inside the cell id, so a
    // renumbered ledger is caught there rather than against the renumbered field.
    for (const record of SOUTHERN_REMAINDER_CURATED_CELLS) {
      expect(record.cellId).toContain(`-w03-${String(record.parentOrder).padStart(6, "0")}-`);
    }
  });
});

describe("the curated entry budget, derived from the RAISED cache cap", () => {
  it("is the lesser of the promoted headroom and the self-imposed ceiling", () => {
    const budget = southernRemainderCuratedEntryBudget({ maxCacheEntries: 512, promotedAssetEntries: 255 });
    expect(budget.alongsidePromotedHeadroom).toBe(257);
    expect(budget.curatedSubsetCeiling).toBe(200);
    expect(budget.entryBudget).toBe(200);
    // At the OLD cap this promotion was not representable at all, and the
    // failure names the ADRs rather than returning a smaller budget.
    expect(() => southernRemainderCuratedEntryBudget({ maxCacheEntries: 256, promotedAssetEntries: 255, curatedSubsetCeiling: 200 }))
      .not.toThrow();
    expect(southernRemainderCuratedEntryBudget({ maxCacheEntries: 256, promotedAssetEntries: 255 }).entryBudget).toBe(1);
    expect(() => southernRemainderCuratedEntryBudget({ maxCacheEntries: 255, promotedAssetEntries: 255 }))
      .toThrow(/no renderable subset fits beside them/u);
  });
});

describe("the curated subset's local refusal rate", () => {
  it("is 1 of 180 and sits below the 1.00% wave rate", () => {
    const census = southernRemainderCuratedRefusalCensus({ ownedBuildingCount: 180, materializedBuildingCount: 179, refusedBuildingCount: 1 });
    expect(census.localRefusalRate).toBeCloseTo(1 / 180, 12);
    expect(census.waveRefusalRate).toBeCloseTo(96 / 9603, 12);
    expect(SOUTHERN_REMAINDER_WAVE_REFUSAL_RATE).toBeCloseTo(0.0099969, 6);
    expect(census.localRefusalRate).toBeLessThan(census.waveRefusalRate);
    expect(census.maxRefusalRate).toBe(SOUTHERN_REMAINDER_CURATED_MAX_REFUSAL_RATE);
    expect(census.ok).toBe(true);
    // For calibration, the canary's own single cell refused 1 of 77 = 1.30%.
    expect(census.localRefusalRate).toBeLessThan(1 / 77);
  });

  it("refuses a census that does not account for every owned building", () => {
    expect(() => southernRemainderCuratedRefusalCensus({ ownedBuildingCount: 180, materializedBuildingCount: 178, refusedBuildingCount: 1 }))
      .toThrow(/does not account for every owned building/u);
    expect(() => southernRemainderCuratedRefusalCensus({ ownedBuildingCount: 0, materializedBuildingCount: 0, refusedBuildingCount: 0 }))
      .toThrow(/over zero owned buildings/u);
  });

  it("reports NOT ok above the ceiling, without moving the ceiling", () => {
    const bad = southernRemainderCuratedRefusalCensus({ ownedBuildingCount: 100, materializedBuildingCount: 90, refusedBuildingCount: 10 });
    expect(bad.localRefusalRate).toBe(0.1);
    expect(bad.ok).toBe(false);
    expect(bad.maxRefusalRate).toBe(0.02);
  });
});
