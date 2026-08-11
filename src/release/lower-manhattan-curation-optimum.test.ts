/**
 * The curated subset is the OPTIMUM, enumerated rather than asserted.
 *
 * ADR 0034's promotion section claims the curated pair is the unique maximum
 * over every Financial District combination that fits the entry budget. That
 * claim was made from an enumeration run once, by hand, and then thrown away —
 * which is exactly the kind of number that drifts into an ADR and stays there.
 * The enumeration lives here now, over the COMMITTED wave ledger and the
 * COMMITTED plan census, so the ADR sentence is checked on every run.
 *
 * It also fixes the fingerprint gap the same review found: a curated subset is a
 * constant in this repository rather than a derivation, so nothing about it is
 * covered by the ledger checksum. `lower-manhattan-fingerprint.test.ts` covers
 * the resumability half; this file covers the "is it still the best choice"
 * half.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LOWER_MANHATTAN_CURATED_CELLS,
  LOWER_MANHATTAN_FINANCIAL_DISTRICT_ENVELOPE,
} from "./lower-manhattan-curation";

const LEDGER_PATH = "data/normalized/manhattan-exterior-wave-ledger-20260804/ledger.json";
/**
 * The plan census of the wave, taken from the P1 release's own committed
 * record. It is the same census the canary produced — the release id is not an
 * input to any plan hash — so "how many of this cell's buildings materialize" is
 * read from committed bytes rather than recomputed over 6,425 buildings here.
 */
const CENSUS_PATH = "data/lower-manhattan-20260812-p1/wave-census.json";

interface LedgerCell {
  cellId: string;
  order: number;
  bounds: { west: number; south: number; east: number; north: number };
  buildingIds: string[];
}

const ledger = JSON.parse(new TextDecoder().decode(readFileSync(LEDGER_PATH))) as { cells: LedgerCell[] };
const w02 = ledger.cells.filter((cell) => cell.cellId.startsWith("manhattan-exterior-cell-w02-"));

/** The entry budget the release derived and committed. */
const ENTRY_BUDGET = 72;

/**
 * Financial District candidates: every `w02` cell whose CENTRE lies inside the
 * stated envelope. Centre rather than full containment, because the enumeration
 * asks which cells are Financial District cells; the stricter full-containment
 * rule is what `lowerManhattanCuratedCells` gates the admitted ones on, and a
 * candidate set that is too GENEROUS only makes the optimality claim harder.
 */
function candidates(): LedgerCell[] {
  const envelope = LOWER_MANHATTAN_FINANCIAL_DISTRICT_ENVELOPE;
  return w02.filter((cell) => {
    const longitude = (cell.bounds.west + cell.bounds.east) / 2;
    const latitude = (cell.bounds.south + cell.bounds.north) / 2;
    return longitude >= envelope.west && longitude <= envelope.east
      && latitude >= envelope.south && latitude <= envelope.north;
  }).sort((left, right) => left.order - right.order);
}

/** Every admissible combination of up to four candidate cells, best first. */
function admissibleCombinations(cells: LedgerCell[]): { cellIds: string[]; owned: number }[] {
  const results: { cellIds: string[]; owned: number }[] = [];
  const walk = (start: number, chosen: LedgerCell[], owned: number) => {
    if (chosen.length > 0) results.push({ cellIds: chosen.map((cell) => cell.cellId), owned });
    if (chosen.length === 4) return;
    for (let index = start; index < cells.length; index += 1) {
      const next = owned + cells[index]!.buildingIds.length;
      if (next > ENTRY_BUDGET) continue;
      walk(index + 1, [...chosen, cells[index]!], next);
    }
  };
  walk(0, [], 0);
  return results.sort((left, right) => right.owned - left.owned);
}

describe("the curated subset is the enumerated optimum", () => {
  const cells = candidates();
  const ranked = admissibleCombinations(cells);

  it("enumerates the Financial District candidates the curation chose from", () => {
    // A real choice, not a set of one: the enumeration has to have alternatives
    // for "optimum" to mean anything.
    expect(cells.length).toBeGreaterThanOrEqual(10);
    expect(cells.map((cell) => cell.order)).toContain(157);
    expect(cells.map((cell) => cell.order)).toContain(160);
    expect(ranked.length).toBeGreaterThan(10);
  });

  it("makes the curated pair the UNIQUE maximum at 72 owned buildings", () => {
    const best = ranked[0]!;
    expect(best.owned).toBe(ENTRY_BUDGET);
    expect([...best.cellIds].sort()).toEqual([...LOWER_MANHATTAN_CURATED_CELLS.map((record) => record.cellId)].sort());
    // Unique: no other admissible combination reaches 72.
    expect(ranked.filter((entry) => entry.owned === ENTRY_BUDGET)).toHaveLength(1);
  });

  it("names the runner-up and the best single cell, so the ADR quotes checked figures", () => {
    // The enumeration ranks by OWNED buildings, which is the quantity the entry
    // budget constrains and the only one the committed ledger states.
    //
    // Two figures were quoted before this test existed and NEITHER survived it.
    // The first draft of the ADR said "next best is a single cell at 65", which
    // was cell 162's MATERIALIZED count quoted as though it were the ranking
    // quantity. Review corrected it to "cell 162 at 66 owned", which is cell
    // 162's real owned count but is not the runner-up: the pair (157, 179)
    // reaches 67. Both were right about a number and wrong about what it ranked.
    const runnerUp = ranked.find((entry) => entry.owned < ENTRY_BUDGET)!;
    expect(runnerUp.owned).toBe(67);
    expect([...runnerUp.cellIds].sort()).toEqual([
      "manhattan-exterior-cell-w02-000157-16-19294-17944",
      "manhattan-exterior-cell-w02-000179-16-19296-17945",
    ]);
    // And the best single cell, which is what "a single cell at N" meant.
    const bestSingle = ranked.find((entry) => entry.cellIds.length === 1)!;
    expect(bestSingle.cellIds).toEqual(["manhattan-exterior-cell-w02-000162-16-19294-17946"]);
    expect(bestSingle.owned).toBe(66);
  });

  it("states owned and materialized separately, because they are different numbers", () => {
    const census = JSON.parse(new TextDecoder().decode(readFileSync(CENSUS_PATH))) as {
      shipped: { requestedBuildingCount: number; materializedBuildingCount: number; refusedBuildingCount: number };
    };
    // The curated pair: 72 owned, 71 materialized, from the release's own
    // committed census. Quoting one of these without naming which is what
    // produced two wrong ADR sentences in a row.
    expect(census.shipped.requestedBuildingCount).toBe(72);
    expect(census.shipped.materializedBuildingCount).toBe(71);
    expect(census.shipped.refusedBuildingCount).toBe(1);
    const bestSingleCell = w02.find((cell) => cell.order === 162)!;
    expect(bestSingleCell.buildingIds).toHaveLength(66);
  });
});
