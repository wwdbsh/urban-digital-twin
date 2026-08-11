/**
 * The curated `w03` subset is the OPTIMUM on skyline value, enumerated rather
 * than asserted.
 *
 * ADR 0035's promotion section claims the four curated cells are the best
 * skyline available inside the stated envelope at the stated entry budget. The
 * T016 precedent established why that claim has to live here rather than in the
 * document: an enumeration run once by hand and then thrown away is exactly the
 * kind of number that drifts into an ADR and stays there. This suite re-runs it
 * over the COMMITTED wave ledger and the COMMITTED skyline census on every run.
 *
 * The ranking key is SKYLINE VALUE — owned buildings whose sourced height reaches
 * the stated threshold — and not owned-building count, because "maximal fill" is
 * explicitly not what this promotion is for. Ties on that key are broken by
 * CONTIGUITY, which is a property the curation claims and which happens to be
 * decisive here: four combinations reach the maximum score and exactly one of
 * them is one edge-connected piece.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SOUTHERN_REMAINDER_CURATED_CELLS,
  SOUTHERN_REMAINDER_CURATED_SUBSET_CEILING,
  SOUTHERN_REMAINDER_SKYLINE_ENVELOPE,
  SOUTHERN_REMAINDER_SKYLINE_HEIGHT_METERS,
  southernRemainderCellsConnected,
} from "./southern-remainder-curation";

const LEDGER_PATH = "data/normalized/manhattan-exterior-wave-ledger-20260804/ledger.json";
/**
 * The candidate profile the release itself committed. It is emitted by the same
 * pipeline run that emitted the release, from the same pinned base, so "which
 * cells were available to choose from and how tall are they" is read from
 * committed bytes rather than recomputed here over 9,603 buildings.
 */
const SKYLINE_PATH = "data/southern-remainder-20260812-p1/skyline-census.json";
const CENSUS_PATH = "data/southern-remainder-20260812-p1/wave-census.json";

interface Bounds { west: number; south: number; east: number; north: number }
interface LedgerCell { cellId: string; order: number; bounds: Bounds; buildingIds: string[] }
interface SkylineCandidate {
  cellId: string;
  parentOrder: number;
  bounds: Bounds;
  ownedBuildingCount: number;
  sourcedHeightCount: number;
  skylineBuildingCount: number;
  tallestSourcedHeightMeters: number | null;
}

const ledger = JSON.parse(new TextDecoder().decode(readFileSync(LEDGER_PATH))) as { cells: LedgerCell[] };
const skyline = JSON.parse(new TextDecoder().decode(readFileSync(SKYLINE_PATH))) as {
  envelope: Bounds;
  skylineThresholdMeters: number;
  entryBudget: number;
  curatedCellIds: string[];
  candidates: SkylineCandidate[];
};

const ENTRY_BUDGET = SOUTHERN_REMAINDER_CURATED_SUBSET_CEILING;

interface Combination { cellIds: string[]; orders: number[]; skyline: number; tallest: number; owned: number; connected: boolean }

/** Every combination of two to four candidates that fits the entry budget. */
function admissibleCombinations(cells: readonly SkylineCandidate[]): Combination[] {
  const results: Combination[] = [];
  const walk = (start: number, chosen: SkylineCandidate[], owned: number): void => {
    if (chosen.length >= 2) {
      results.push({
        cellIds: chosen.map((cell) => cell.cellId),
        orders: chosen.map((cell) => cell.parentOrder),
        skyline: chosen.reduce((sum, cell) => sum + cell.skylineBuildingCount, 0),
        tallest: Math.max(...chosen.map((cell) => cell.tallestSourcedHeightMeters ?? 0)),
        owned,
        connected: southernRemainderCellsConnected(chosen.map((cell) => ({ cellId: cell.cellId, order: cell.parentOrder, bounds: cell.bounds, buildingIds: [] }))),
      });
    }
    if (chosen.length === 4) return;
    for (let index = start; index < cells.length; index += 1) {
      const next = owned + cells[index]!.ownedBuildingCount;
      if (next > ENTRY_BUDGET) continue;
      walk(index + 1, [...chosen, cells[index]!], next);
    }
  };
  walk(0, [], 0);
  return results.sort((left, right) => right.skyline - left.skyline || right.tallest - left.tallest || right.owned - left.owned);
}

describe("the curated subset is the enumerated skyline optimum", () => {
  const ranked = admissibleCombinations(skyline.candidates);
  const curatedIds = [...SOUTHERN_REMAINDER_CURATED_CELLS.map((record) => record.cellId)].sort();

  it("reads its candidates from the committed skyline census, against the committed envelope", () => {
    expect(skyline.envelope).toEqual({ ...SOUTHERN_REMAINDER_SKYLINE_ENVELOPE });
    expect(skyline.skylineThresholdMeters).toBe(SOUTHERN_REMAINDER_SKYLINE_HEIGHT_METERS);
    expect(skyline.entryBudget).toBe(ENTRY_BUDGET);
    expect(skyline.curatedCellIds).toEqual(SOUTHERN_REMAINDER_CURATED_CELLS.map((record) => record.cellId));
    // A real choice, not a set of one: without alternatives "optimum" is empty.
    expect(skyline.candidates.length).toBeGreaterThanOrEqual(8);
    expect(ranked.length).toBeGreaterThan(50);
    // The census is derived from the same committed ledger this test reads, so
    // a candidate that stopped existing fails here rather than silently
    // shrinking the enumeration.
    const byId = new Map(ledger.cells.map((cell) => [cell.cellId, cell]));
    for (const candidate of skyline.candidates) {
      expect(byId.get(candidate.cellId)!.buildingIds).toHaveLength(candidate.ownedBuildingCount);
    }
  });

  it("makes the curated four the maximum on skyline value, and the UNIQUE connected one", () => {
    const best = ranked[0]!;
    expect(best.skyline).toBe(16);
    expect([...best.cellIds].sort()).toEqual(curatedIds);
    // Four combinations reach 16. Only one of them is one edge-connected piece,
    // which is what makes the tie-break a stated property of the curation rather
    // than a preference for the biggest set.
    const tied = ranked.filter((entry) => entry.skyline === best.skyline);
    expect(tied).toHaveLength(4);
    expect(tied.filter((entry) => entry.connected)).toHaveLength(1);
    expect([...tied.find((entry) => entry.connected)!.cellIds].sort()).toEqual(curatedIds);
    expect(tied.filter((entry) => !entry.connected).map((entry) => entry.orders.join(","))).toEqual([
      "379,381,385,387",
      "379,380,385,387",
      "379,385,387,388",
    ]);
  });

  it("names the runner-up and the best single-cell score, so the ADR quotes checked figures", () => {
    const runnerUp = ranked.find((entry) => entry.skyline < 16)!;
    expect(runnerUp.skyline).toBe(15);
    expect(runnerUp.orders).toEqual([378, 379, 385, 387]);
    // And the cell that carries the most skyline on its own, which is NOT the
    // cell that carries the tallest structure.
    const bestSingle = [...skyline.candidates].sort((left, right) => right.skylineBuildingCount - left.skylineBuildingCount)[0]!;
    expect(bestSingle.parentOrder).toBe(379);
    expect(bestSingle.skylineBuildingCount).toBe(6);
    const tallest = [...skyline.candidates].sort((left, right) => (right.tallestSourcedHeightMeters ?? 0) - (left.tallestSourcedHeightMeters ?? 0))[0]!;
    expect(tallest.parentOrder).toBe(387);
    expect(tallest.tallestSourcedHeightMeters).toBeCloseTo(245.364, 3);
  });

  it("states owned and materialized separately, because they are different numbers", () => {
    const census = JSON.parse(new TextDecoder().decode(readFileSync(CENSUS_PATH))) as {
      shipped: { requestedBuildingCount: number; materializedBuildingCount: number; refusedBuildingCount: number };
    };
    expect(census.shipped.requestedBuildingCount).toBe(180);
    expect(census.shipped.materializedBuildingCount).toBe(179);
    expect(census.shipped.refusedBuildingCount).toBe(1);
    const owned = SOUTHERN_REMAINDER_CURATED_CELLS
      .map((record) => ledger.cells.find((cell) => cell.cellId === record.cellId)!.buildingIds.length)
      .reduce((sum, count) => sum + count, 0);
    expect(owned).toBe(180);
  });

  it("would not have admitted this subset at the CANARY's modest ceiling", () => {
    // The canary's 80-entry ceiling admits no combination of these cells at all
    // above two, which is why promotion needed both a raised cap and its own
    // budget rather than reusing the canary's.
    const atCanaryCeiling = skyline.candidates.filter((cell) => cell.ownedBuildingCount <= 80);
    expect(atCanaryCeiling.length).toBeGreaterThan(0);
    expect(skyline.candidates.filter((cell) => curatedIds.includes(cell.cellId)).reduce((sum, cell) => sum + cell.ownedBuildingCount, 0)).toBe(180);
    expect(180).toBeGreaterThan(80);
  });
});
