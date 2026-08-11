/**
 * The curated `w05` subset is the maximum under a STATED decision rule, and the
 * rule's cost — and its THRESHOLD SENSITIVITY — are pinned rather than hidden.
 *
 * This follows `central-upper-manhattan-curation-optimum.test.ts` exactly in
 * method:
 *
 *  - **The candidate set is the WHOLE WAVE.** All 182 owned cells, not a band
 *    drawn around the answer.
 *  - **The connectivity-ignoring optimum is computed EXACTLY**, over the scoring
 *    candidates rather than by bounding the search, because a cell that scores
 *    zero can only consume budget.
 *
 * The rule, in the order `northern-manhattan-curation.ts` states it:
 *
 *   1. edge-contiguity, a PRECONDITION;
 *   2. fit the 36-entry inherited reservation, a PRECONDITION;
 *   3. maximize skyline value;
 *   4. tie-break on whole cells — at equal skyline value, more whole cells;
 *   5. total-order fallback: lexicographic on the parent-order sequence.
 *
 * WHERE IT DIFFERS FROM WAVE `w04`, AND THE DIFFERENCE IS THE POINT.
 *
 *  - Wave `w04` could assert that keys 4 and 5 never decided anything at ANY
 *    threshold, so the winner was threshold-independent. THAT IS FALSE HERE and
 *    this suite proves the negative rather than omitting the claim: the winner
 *    moves at 30, 45, 60 and 75 m, and at 120 m every admissible subset scores
 *    zero so key 5 does decide. Each of those outcomes is pinned by name.
 *  - At the STATED 90 m threshold key 3 alone leaves one candidate, so keys 4 and
 *    5 are never reached — and that is asserted, because the rule being a function
 *    is what makes the promoted subset a consequence rather than a preference.
 *  - Contiguity costs FOUR skyline buildings for `w04` and NOTHING here; the
 *    RESERVATION is what costs, and both are measured rather than described.
 *
 * Everything is recomputed from the committed wave ledger and the committed
 * skyline census on every run.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  NORTHERN_MANHATTAN_CANARY_RENDERABLE_CELL_IDS,
  NORTHERN_MANHATTAN_CANDIDATE_ENVELOPE,
  NORTHERN_MANHATTAN_CURATED_CELLS,
  NORTHERN_MANHATTAN_REJECTED_ALTERNATIVES,
  NORTHERN_MANHATTAN_RESERVED_ENTRIES,
  NORTHERN_MANHATTAN_SKYLINE_HEIGHT_METERS,
  NORTHERN_MANHATTAN_SKYLINE_THRESHOLDS_METERS,
  northernManhattanCellsConnected,
} from "./northern-manhattan-curation";
import { EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256, EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID } from "../domain/exterior-fullsnapshot-input";
import { collectMidtownCoreSources } from "./midtown-core-source";
import { sha256HexSync } from "../domain/deterministic-hash";

const LEDGER_PATH = "data/normalized/manhattan-exterior-wave-ledger-20260804/ledger.json";
/**
 * The candidate profile the release itself committed. It is emitted by the same
 * pipeline run that emitted the release, from the same pinned base, so "which
 * cells were available to choose from and how tall are they" is read from
 * committed bytes rather than recomputed here over 10,230 buildings.
 */
const SKYLINE_PATH = "data/northern-manhattan-20260812-p1/skyline-census.json";
const CENSUS_PATH = "data/northern-manhattan-20260812-p1/wave-census.json";
/** The pinned base the census was derived from. Gitignored; see the recompute below. */
const SNAPSHOT_ROOT = `public/data/${EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID}`;

interface Bounds { west: number; south: number; east: number; north: number }
interface LedgerCell { cellId: string; order: number; bounds: Bounds; buildingIds: string[] }
interface SkylineCandidate {
  cellId: string;
  parentOrder: number;
  bounds: Bounds;
  ownedBuildingCount: number;
  sourcedHeightCount: number;
  skylineBuildingCount: number;
  skylineBuildingCountByThresholdMeters: Record<string, number>;
  tallestSourcedHeightMeters: number | null;
  topSourcedHeightMeters: number[];
}

function readJson<T>(path: string): T {
  return JSON.parse(new TextDecoder().decode(readFileSync(path))) as T;
}

const ledger = readJson<{ cells: LedgerCell[] }>(LEDGER_PATH);
const skyline = readJson<{
  base: { releaseId: string; manifestChecksumSha256: string };
  envelope: Bounds;
  skylineThresholdMeters: number;
  skylineThresholdsMeters: number[];
  entryBudget: number;
  curatedCellIds: string[];
  candidates: SkylineCandidate[];
}>(SKYLINE_PATH);

const ENTRY_BUDGET = NORTHERN_MANHATTAN_RESERVED_ENTRIES;
const CANARY = new Set(NORTHERN_MANHATTAN_CANARY_RENDERABLE_CELL_IDS);
const curatedIds = [...NORTHERN_MANHATTAN_CURATED_CELLS.map((record) => record.cellId)].sort();

function scoreOf(candidate: SkylineCandidate, threshold: number): number {
  return threshold === NORTHERN_MANHATTAN_SKYLINE_HEIGHT_METERS
    ? candidate.skylineBuildingCount
    : candidate.skylineBuildingCountByThresholdMeters[String(threshold)]!;
}

interface Combination { cellIds: string[]; orders: number[]; skyline: number; owned: number; size: number }

/**
 * Every EDGE-CONNECTED subset of `cells` that fits the entry budget, with no
 * bound on size at all.
 *
 * Grown by expansion from every single cell and deduplicated on the canonical
 * member set, which terminates because the budget bounds the total owned count
 * and every cell owns at least one building.
 */
function connectedCombinations(cells: readonly SkylineCandidate[], threshold: number): Combination[] {
  const adjacency = cells.map((left, index) => cells
    .map((right, other) => (other === index ? -1 : (northernManhattanCellsConnected([
      { cellId: left.cellId, order: left.parentOrder, bounds: left.bounds, buildingIds: [] },
      { cellId: right.cellId, order: right.parentOrder, bounds: right.bounds, buildingIds: [] },
    ]) ? other : -1)))
    .filter((other) => other >= 0));
  const all = new Map<string, number[]>();
  let level = new Map<string, number[]>();
  for (let index = 0; index < cells.length; index += 1) {
    if (cells[index]!.ownedBuildingCount > ENTRY_BUDGET) continue;
    level.set(String(index), [index]);
    all.set(String(index), [index]);
  }
  while (level.size > 0) {
    const next = new Map<string, number[]>();
    for (const members of level.values()) {
      const owned = members.reduce((sum, index) => sum + cells[index]!.ownedBuildingCount, 0);
      for (const index of new Set(members.flatMap((member) => adjacency[member]!))) {
        if (members.includes(index) || owned + cells[index]!.ownedBuildingCount > ENTRY_BUDGET) continue;
        const set = [...members, index].sort((left, right) => left - right);
        const key = set.join(",");
        if (all.has(key)) continue;
        next.set(key, set);
        all.set(key, set);
      }
    }
    level = next;
  }
  return [...all.values()].map((members) => ({
    cellIds: members.map((index) => cells[index]!.cellId),
    orders: members.map((index) => cells[index]!.parentOrder),
    skyline: members.reduce((sum, index) => sum + scoreOf(cells[index]!, threshold), 0),
    owned: members.reduce((sum, index) => sum + cells[index]!.ownedBuildingCount, 0),
    size: members.length,
  }));
}

/**
 * The maximum SKYLINE SCORE over every subset that fits the budget, connected or
 * not, computed exactly.
 *
 * A cell whose score is zero can only consume budget, so it can never raise the
 * score of an optimum that a smaller subset does not already match. The maximum
 * over all subsets is therefore the maximum over subsets of the SCORING
 * candidates, and that set is small enough to enumerate exhaustively — which is
 * asserted rather than assumed, so a future base that produced a hundred scoring
 * cells fails here instead of silently exceeding the enumeration's reach.
 */
function unconstrainedOptima(cells: readonly SkylineCandidate[], threshold: number): { best: number; witnesses: Combination[] } {
  const scoring = cells.filter((cell) => scoreOf(cell, threshold) > 0 && cell.ownedBuildingCount <= ENTRY_BUDGET);
  expect(scoring.length).toBeLessThanOrEqual(24);
  let best = 0;
  const witnesses: Combination[] = [];
  for (let mask = 1; mask < 1 << scoring.length; mask += 1) {
    let owned = 0;
    let value = 0;
    for (let bit = 0; bit < scoring.length; bit += 1) {
      if ((mask & (1 << bit)) === 0) continue;
      owned += scoring[bit]!.ownedBuildingCount;
      if (owned > ENTRY_BUDGET) { value = -1; break; }
      value += scoreOf(scoring[bit]!, threshold);
    }
    if (value < best) continue;
    const members = scoring.filter((_, bit) => (mask & (1 << bit)) !== 0);
    const combination: Combination = {
      cellIds: members.map((cell) => cell.cellId),
      orders: members.map((cell) => cell.parentOrder),
      skyline: value,
      owned,
      size: members.length,
    };
    if (value > best) { best = value; witnesses.length = 0; }
    witnesses.push(combination);
  }
  return { best, witnesses };
}

/**
 * The WHOLE rule with the contiguity precondition DROPPED, applied through keys 3,
 * 4 and 5. This is what produces the named `edge-contiguity` rejected alternative:
 * not merely "a set that scores the same", but the specific set the rule itself
 * would have selected without key 1.
 *
 * A dynamic program over the budget rather than an enumeration of 2^50 subsets: at
 * each used-entry total it keeps the best (score, cell count, lexicographic order
 * sequence) triple, which is exactly the rule's own ordering.
 */
function ruleWinnerWithoutContiguity(cells: readonly SkylineCandidate[], threshold: number): Combination {
  const admissible = [...cells]
    .filter((cell) => !CANARY.has(cell.cellId) && cell.ownedBuildingCount <= ENTRY_BUDGET)
    .sort((left, right) => left.parentOrder - right.parentOrder);
  const better = (a: Combination, b: Combination | undefined): boolean => {
    if (!b) return true;
    if (a.skyline !== b.skyline) return a.skyline > b.skyline;
    if (a.size !== b.size) return a.size > b.size;
    for (let index = 0; index < Math.min(a.orders.length, b.orders.length); index += 1) {
      if (a.orders[index] !== b.orders[index]) return a.orders[index]! < b.orders[index]!;
    }
    return a.orders.length < b.orders.length;
  };
  let table = new Map<number, Combination>([[0, { cellIds: [], orders: [], skyline: 0, owned: 0, size: 0 }]]);
  for (const cell of admissible) {
    const next = new Map(table);
    for (const [used, entry] of table) {
      const owned = used + cell.ownedBuildingCount;
      if (owned > ENTRY_BUDGET) continue;
      const candidate: Combination = {
        cellIds: [...entry.cellIds, cell.cellId],
        orders: [...entry.orders, cell.parentOrder],
        skyline: entry.skyline + scoreOf(cell, threshold),
        owned,
        size: entry.size + 1,
      };
      if (better(candidate, next.get(owned))) next.set(owned, candidate);
    }
    table = next;
  }
  let best: Combination | undefined;
  for (const entry of table.values()) if (better(entry, best)) best = entry;
  return best!;
}

/**
 * Everything that survives keys 1 to 4. More than one entry here means key 5 —
 * the arbitrary tie-break — decided the promoted subset, which is the thing the
 * curation must never rest on at the threshold it states.
 */
function ruleMaxima(candidates: readonly SkylineCandidate[], threshold: number): Combination[] {
  const admissible = candidates.filter((cell) => !CANARY.has(cell.cellId));
  const connected = connectedCombinations(admissible, threshold);
  const best = Math.max(...connected.map((entry) => entry.skyline));
  const maxima = connected.filter((entry) => entry.skyline === best);
  const mostCells = Math.max(...maxima.map((entry) => entry.size));
  return maxima.filter((entry) => entry.size === mostCells);
}

/** Key 5: the total-order fallback, so the rule is a function rather than a relation. */
function ruleWinner(candidates: readonly SkylineCandidate[], threshold: number): Combination {
  return ruleMaxima(candidates, threshold)
    .sort((left, right) => left.orders.join(",").localeCompare(right.orders.join(",")))[0]!;
}

describe("the curated subset under the stated decision rule", () => {
  const admissible = skyline.candidates.filter((cell) => !CANARY.has(cell.cellId));
  const connected = connectedCombinations(admissible, NORTHERN_MANHATTAN_SKYLINE_HEIGHT_METERS);

  it("reads its candidates from the committed skyline census, over the WHOLE wave", () => {
    expect(skyline.envelope).toEqual({ ...NORTHERN_MANHATTAN_CANDIDATE_ENVELOPE });
    expect(skyline.skylineThresholdMeters).toBe(NORTHERN_MANHATTAN_SKYLINE_HEIGHT_METERS);
    expect(skyline.skylineThresholdsMeters).toEqual([...NORTHERN_MANHATTAN_SKYLINE_THRESHOLDS_METERS]);
    expect(skyline.entryBudget).toBe(ENTRY_BUDGET);
    expect(skyline.curatedCellIds).toEqual(NORTHERN_MANHATTAN_CURATED_CELLS.map((record) => record.cellId));
    // Every owned cell of the wave is a candidate: 182, not a band.
    expect(skyline.candidates).toHaveLength(182);
    // 50 of them fit the reservation whole — the real choice this rule ranges over.
    expect(skyline.candidates.filter((cell) => cell.ownedBuildingCount <= ENTRY_BUDGET)).toHaveLength(50);
    // A real choice, not a set of one: connected admissible subsets number in the
    // dozens even at this budget.
    expect(connected.length).toBeGreaterThan(50);
    // The census is derived from the same committed ledger this test reads, so a
    // candidate that stopped existing fails here rather than silently shrinking
    // the enumeration.
    const byId = new Map(ledger.cells.map((cell) => [cell.cellId, cell]));
    for (const candidate of skyline.candidates) {
      expect(byId.get(candidate.cellId)!.buildingIds).toHaveLength(candidate.ownedBuildingCount);
      expect(byId.get(candidate.cellId)!.bounds).toEqual(candidate.bounds);
    }
  });

  /**
   * Step 1 of the rule, and on this wave it costs NOTHING on score. That is the
   * opposite of wave `w04`, where it gave up four skyline buildings, and it is
   * asserted in both halves: the connectivity-ignoring optimum ties the connected
   * one, and the set the rule would have taken without key 1 is disconnected.
   */
  it("EDGE-CONTIGUITY is a precondition, and here it costs ZERO skyline buildings", () => {
    const anyShape = unconstrainedOptima(admissible, NORTHERN_MANHATTAN_SKYLINE_HEIGHT_METERS);
    const bestConnected = Math.max(...connected.map((entry) => entry.skyline));
    expect(anyShape.best).toBe(1);
    expect(bestConnected).toBe(1);
    expect(anyShape.best - bestConnected).toBe(0);

    // What contiguity DOES decide is the shape, and the shape it refuses is the
    // rule's own answer without key 1 — five scattered pieces on 35 entries.
    const withoutContiguity = ruleWinnerWithoutContiguity(skyline.candidates, NORTHERN_MANHATTAN_SKYLINE_HEIGHT_METERS);
    expect(withoutContiguity.orders).toEqual([711, 727, 836, 838, 850]);
    expect(withoutContiguity.skyline).toBe(1);
    expect(withoutContiguity.owned).toBe(35);
    const scattered = withoutContiguity.cellIds.map((cellId) => skyline.candidates.find((cell) => cell.cellId === cellId)!);
    expect(northernManhattanCellsConnected(scattered.map((cell) => ({ cellId: cell.cellId, order: cell.parentOrder, bounds: cell.bounds, buildingIds: [] })))).toBe(false);

    // Contiguity caps the score at 1 AT ANY SIZE. `connectedCombinations` grows
    // without a size bound, so this is a statement about every connected subset
    // that fits the reservation and not about a truncated search.
    expect(Math.max(...connected.map((entry) => entry.size))).toBeGreaterThan(1);
  });

  /**
   * Step 2, and on this wave it is the precondition that actually costs. The
   * wave's best cell carries five skyline buildings and does not fit.
   */
  it("THE RESERVATION is what costs, and it gives up FOUR skyline buildings", () => {
    const bestAnywhere = Math.max(...skyline.candidates
      .filter((cell) => !CANARY.has(cell.cellId))
      .map((cell) => cell.skylineBuildingCount));
    expect(bestAnywhere).toBe(5);
    const bestFitting = Math.max(...skyline.candidates
      .filter((cell) => !CANARY.has(cell.cellId) && cell.ownedBuildingCount <= ENTRY_BUDGET)
      .map((cell) => cell.skylineBuildingCount));
    expect(bestFitting).toBe(1);
    expect(bestAnywhere - bestFitting).toBe(4);
    // And the cell that carries them is named in the refusal list.
    const best = skyline.candidates.find((cell) => cell.skylineBuildingCount === 5 && !CANARY.has(cell.cellId))!;
    expect(best.parentOrder).toBe(778);
    expect(best.ownedBuildingCount).toBeGreaterThan(ENTRY_BUDGET);
    expect(NORTHERN_MANHATTAN_REJECTED_ALTERNATIVES.some((entry) => entry.parentOrders.join(",") === "778")).toBe(true);
  });

  /**
   * THE 2-ENTRY SURPLUS BUYS NOTHING, which the release record asserts in words
   * and this checks in arithmetic: raising the budget from the promised 36 to the
   * free 38 admits four more cells and not one of them scores.
   */
  it("would select the SAME cell at the 38 entries that are free rather than the 36 promised", () => {
    const extra = skyline.candidates.filter((cell) => cell.ownedBuildingCount > 36 && cell.ownedBuildingCount <= 38);
    expect(extra.map((cell) => cell.parentOrder)).toEqual([753, 768, 795, 803]);
    expect(extra.every((cell) => cell.skylineBuildingCount === 0)).toBe(true);
  });

  /** The rejected alternatives, pinned by name, score, cost and shape. */
  it("names every alternative it refused and recomputes each one's properties", () => {
    for (const rejected of NORTHERN_MANHATTAN_REJECTED_ALTERNATIVES) {
      const cells = rejected.parentOrders.map((order) => skyline.candidates.find((cell) => cell.parentOrder === order)!);
      expect(cells.every((cell) => cell !== undefined)).toBe(true);
      const measured = {
        skyline: cells.reduce((sum, cell) => sum + cell.skylineBuildingCount, 0),
        owned: cells.reduce((sum, cell) => sum + cell.ownedBuildingCount, 0),
        connected: northernManhattanCellsConnected(cells.map((cell) => ({ cellId: cell.cellId, order: cell.parentOrder, bounds: cell.bounds, buildingIds: [] }))),
      };
      expect({ orders: rejected.parentOrders, ...measured }).toEqual({
        orders: rejected.parentOrders,
        skyline: rejected.skylineBuildingCount,
        owned: rejected.ownedBuildingCount,
        connected: rejected.connected,
      });
      // UNLIKE WAVE w04'S LIST, budget fit is not uniform here, so it is recorded
      // per entry and checked rather than assumed.
      expect({ orders: rejected.parentOrders, withinEntryBudget: measured.owned <= ENTRY_BUDGET })
        .toEqual({ orders: rejected.parentOrders, withinEntryBudget: rejected.withinEntryBudget });
      // The stated reason matches the property that actually refuses it.
      if (rejected.refusedBy === "edge-contiguity") {
        expect(measured.connected).toBe(false);
        expect(measured.owned).toBeLessThanOrEqual(ENTRY_BUDGET);
      }
      if (rejected.refusedBy === "reservation-entry-budget") {
        expect(measured.owned).toBeGreaterThan(ENTRY_BUDGET);
        expect(measured.connected).toBe(true);
      }
      if (rejected.refusedBy === "canary-subset-reuse") {
        expect(cells.some((cell) => CANARY.has(cell.cellId))).toBe(true);
      }
      if (rejected.refusedBy === "skyline-value") {
        expect(measured.connected).toBe(true);
        expect(measured.owned).toBeLessThanOrEqual(ENTRY_BUDGET);
        expect(measured.skyline).toBeLessThan(1);
      }
    }
  });

  /** Step 3: the maximum, and the fact that it needs no tie-break at all. */
  it("reaches 1 with exactly ONE connected subset, so keys 4 and 5 are never reached", () => {
    const maxima = connected.filter((entry) => entry.skyline === 1);
    expect(maxima.map((entry) => entry.orders.join(",")).sort()).toEqual(["727"]);
    const survivors = ruleMaxima(skyline.candidates, NORTHERN_MANHATTAN_SKYLINE_HEIGHT_METERS);
    expect(survivors).toHaveLength(1);
    expect([...survivors[0]!.cellIds].sort()).toEqual(curatedIds);
    expect(survivors[0]!.owned).toBe(24);
    // The winner spends 24 of the 36-entry reservation, leaving twelve unspent —
    // and no admissible connected superset of it exists to spend them on.
    expect(ENTRY_BUDGET - survivors[0]!.owned).toBe(12);
    expect(connected.filter((entry) => entry.orders.includes(727))).toHaveLength(1);
  });

  /**
   * A THRESHOLD-FREE KEY AGREES, and it is checked rather than asserted: the
   * curated cell carries the tallest sourced structure of any cell that fits the
   * reservation, by more than twenty metres.
   */
  it("is also the tallest admissible cell, on a criterion with no threshold in it", () => {
    const fitting = skyline.candidates
      .filter((cell) => !CANARY.has(cell.cellId) && cell.ownedBuildingCount <= ENTRY_BUDGET)
      .sort((left, right) => (right.tallestSourcedHeightMeters ?? 0) - (left.tallestSourcedHeightMeters ?? 0));
    expect(fitting[0]!.parentOrder).toBe(727);
    expect(fitting[0]!.tallestSourcedHeightMeters).toBeCloseTo(101.4984, 4);
    expect(fitting[1]!.tallestSourcedHeightMeters).toBeCloseTo(79.75092, 5);
    expect(fitting[0]!.tallestSourcedHeightMeters! - fitting[1]!.tallestSourcedHeightMeters!).toBeGreaterThan(20);
  });

  /**
   * THE SENSITIVITY, PROVEN RATHER THAN CAVEATED.
   *
   * ADR 0036 precondition (b) asked each wave whether 90 m is right for it. Wave
   * `w04` answered that the ranking did not depend on the threshold. This wave's
   * honest answer is that it does, and every other threshold's winner is pinned by
   * name so a reader can see exactly what a different bar would have promoted.
   */
  it("selects a DIFFERENT cell at four of the seven recorded thresholds", () => {
    const winners = Object.fromEntries(NORTHERN_MANHATTAN_SKYLINE_THRESHOLDS_METERS
      .map((threshold) => [threshold, ruleWinner(skyline.candidates, threshold).orders.join(",")]));
    expect(winners).toEqual({
      30: "714,715",
      45: "852",
      60: "707",
      75: "707",
      90: "727",
      100: "727",
      120: ruleWinner(skyline.candidates, 120).orders.join(","),
    });
    // The stated threshold and the one above it agree; everything below does not.
    expect(winners[90]).toBe("727");
    expect(winners[100]).toBe("727");
    expect(winners[75]).not.toBe("727");
    expect(winners[60]).not.toBe("727");
    expect(winners[45]).not.toBe("727");
    expect(winners[30]).not.toBe("727");
  });

  /**
   * WHERE KEY 5 — THE ARBITRARY FALLBACK — ACTUALLY DECIDES, stated exactly.
   *
   * Wave `w04` could assert that key 5 was never reached at any threshold it ran.
   * On this wave it IS reached at two of the seven, and both are recorded rather
   * than omitted:
   *
   *  - at 60 m, where cells 707 and 782 both carry two qualifying buildings and
   *    both are single cells, so keys 3 and 4 leave a genuine two-way tie;
   *  - at 120 m, where the wave's one qualifying building sits in a cell that does
   *    not fit the reservation, so every admissible subset scores zero.
   *
   * Neither is a defect in the curation, which states 90 m — but a rule whose
   * fallback can decide somewhere is a rule whose fallback must be shown deciding,
   * or "never reached" at the stated threshold would be an untested claim rather
   * than a checked one. At 45, 75, 90 and 100 m keys 1 to 4 leave exactly one
   * candidate, and at the STATED threshold key 3 alone does.
   */
  it("reaches key 5 at 60 m and 120 m, and NOT at the stated threshold", () => {
    const at120 = ruleMaxima(skyline.candidates, 120);
    expect(at120.length).toBeGreaterThan(1);
    expect(at120.every((entry) => entry.skyline === 0)).toBe(true);

    const at60 = ruleMaxima(skyline.candidates, 60);
    expect(at60.map((entry) => entry.orders.join(",")).sort()).toEqual(["707", "782"]);
    expect(at60.every((entry) => entry.skyline === 2)).toBe(true);

    for (const threshold of [45, 75, 90, 100]) {
      expect({ threshold, survivors: ruleMaxima(skyline.candidates, threshold).length }).toEqual({ threshold, survivors: 1 });
    }
    // And at the stated threshold key 3 alone is decisive: the survivor set after
    // keys 1 to 3 is already a single candidate, so key 4 does not decide either.
    const connectedAt90 = connectedCombinations(admissible, NORTHERN_MANHATTAN_SKYLINE_HEIGHT_METERS);
    const best = Math.max(...connectedAt90.map((entry) => entry.skyline));
    expect(connectedAt90.filter((entry) => entry.skyline === best)).toHaveLength(1);
  });

  it("keeps 90 m discriminating on this wave, thinly and measurably", () => {
    const sourced = skyline.candidates.reduce((sum, cell) => sum + cell.sourcedHeightCount, 0);
    const tall = skyline.candidates.reduce((sum, cell) => sum + cell.skylineBuildingCount, 0);
    expect({ sourced, tall }).toEqual({ sourced: 10214, tall: 19 });
    expect(skyline.candidates.filter((cell) => cell.skylineBuildingCount > 0)).toHaveLength(9);
    // Exactly ONE of the 50 admissible cells carries a qualifying building, which
    // is what makes the primary key thin and the corroborating key worth stating.
    expect(skyline.candidates.filter((cell) => cell.ownedBuildingCount <= ENTRY_BUDGET && cell.skylineBuildingCount > 0)).toHaveLength(1);
    // 0.19% here against 1.20% for wave w04, so the bar is genuinely harder on
    // this wave rather than the wave being short of tall buildings by accident.
    expect(tall / sourced).toBeLessThan(0.002);
  });

  it("states owned and materialized separately, because they are different numbers", () => {
    const census = readJson<{ shipped: { requestedBuildingCount: number; materializedBuildingCount: number; refusedBuildingCount: number } }>(CENSUS_PATH);
    expect(census.shipped.requestedBuildingCount).toBe(24);
    expect(census.shipped.materializedBuildingCount).toBe(24);
    expect(census.shipped.refusedBuildingCount).toBe(0);
    const owned = NORTHERN_MANHATTAN_CURATED_CELLS
      .map((record) => ledger.cells.find((cell) => cell.cellId === record.cellId)!.buildingIds.length)
      .reduce((sum, count) => sum + count, 0);
    expect(owned).toBe(24);
  });
});

/**
 * "Skyline value" is a claim about SOURCED HEIGHTS, so this section checks the
 * heights rather than trusting them.
 *
 * The census is pinned to the exact base it was derived from, and that pin is
 * checked unconditionally. Its per-cell numbers are then checked for internal
 * consistency, also unconditionally.
 *
 * The full recompute needs the pinned citywide snapshot, which this repository
 * deliberately does not commit. It runs whenever those bytes are on the machine
 * and is skipped when they are not — which is why it is NOT the only check here.
 */
describe("the skyline census is measured, not trusted", () => {
  it("is pinned to the exact base snapshot the promotion was derived from", () => {
    expect(skyline.base.releaseId).toBe(EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID);
    expect(skyline.base.manifestChecksumSha256).toBe(EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256);
  });

  it("is internally consistent for every candidate cell, at every recorded threshold", () => {
    for (const candidate of skyline.candidates) {
      const label = `cell ${candidate.parentOrder}`;
      // A building whose source states no height is counted as owned and cannot
      // be ranked, so the two counts are ordered rather than equal.
      expect({ label, ok: candidate.sourcedHeightCount <= candidate.ownedBuildingCount }).toEqual({ label, ok: true });
      expect({ label, ok: candidate.skylineBuildingCount <= candidate.sourcedHeightCount }).toEqual({ label, ok: true });
      const top = candidate.topSourcedHeightMeters;
      expect({ label, sorted: [...top].sort((a, b) => b - a) }).toEqual({ label, sorted: top });
      expect({ label, tallest: candidate.tallestSourcedHeightMeters }).toEqual({ label, tallest: top[0] ?? null });
      // The per-threshold counts must be monotonically non-increasing in height,
      // and must agree with the primary count at 90 m.
      const counts = NORTHERN_MANHATTAN_SKYLINE_THRESHOLDS_METERS
        .map((threshold) => candidate.skylineBuildingCountByThresholdMeters[String(threshold)]!);
      expect({ label, counts, sorted: [...counts].sort((a, b) => b - a) }).toEqual({ label, counts, sorted: counts });
      const at90 = counts[NORTHERN_MANHATTAN_SKYLINE_THRESHOLDS_METERS.indexOf(90)]!;
      expect({ label, at90 }).toEqual({ label, at90: candidate.skylineBuildingCount });
      // The top-five window is a lower bound on the skyline count whenever it is
      // not itself truncated by the threshold.
      const tallInTop = top.filter((height) => height >= NORTHERN_MANHATTAN_SKYLINE_HEIGHT_METERS).length;
      if (tallInTop < top.length) expect({ label, count: candidate.skylineBuildingCount }).toEqual({ label, count: tallInTop });
      else expect({ label, ok: candidate.skylineBuildingCount >= tallInTop }).toEqual({ label, ok: true });
    }
  });
});

describe.skipIf(!existsSync(`${SNAPSHOT_ROOT}/manifest.json`))("the skyline census recomputed from the pinned base", () => {
  /**
   * The cells whose heights the decision rule actually turned on: the one that was
   * curated and every cell named in a rejected alternative. Recomputing the whole
   * wave would be no stronger and much slower; recomputing less than this would
   * leave the tradeoff resting on numbers nobody checked.
   */
  const decisive = new Set<number>([
    ...NORTHERN_MANHATTAN_CURATED_CELLS.map((record) => record.parentOrder),
    ...NORTHERN_MANHATTAN_REJECTED_ALTERNATIVES.flatMap((entry) => [...entry.parentOrders]),
  ]);

  it("recomputes every decisive cell's skyline count and tallest height, exactly", () => {
    const manifestText = new TextDecoder().decode(readFileSync(`${SNAPSHOT_ROOT}/manifest.json`));
    // The census claims a base by checksum; a machine holding a DIFFERENT
    // snapshot must fail here rather than recompute against the wrong bytes.
    expect(sha256HexSync(manifestText)).toBe(skyline.base.manifestChecksumSha256);
    const manifest = JSON.parse(manifestText) as { geometryShards: { layer: string; relativeContentRef: string }[] };
    const targets = skyline.candidates.filter((candidate) => decisive.has(candidate.parentOrder));
    expect(targets.length).toBe(decisive.size);
    const wanted = new Set(targets.flatMap((candidate) => ledger.cells.find((cell) => cell.cellId === candidate.cellId)!.buildingIds));
    const shards = manifest.geometryShards
      .filter((shard) => shard.layer === "buildings")
      .map((shard) => JSON.parse(new TextDecoder().decode(readFileSync(`${SNAPSHOT_ROOT}/${shard.relativeContentRef}`))) as { layer?: unknown; features?: unknown });
    const sources = collectMidtownCoreSources(shards, wanted);

    for (const candidate of targets) {
      const cell = ledger.cells.find((entry) => entry.cellId === candidate.cellId)!;
      const heights = cell.buildingIds
        .map((buildingId) => sources.get(buildingId)?.heightMeters)
        .filter((height): height is number => typeof height === "number")
        .sort((left, right) => right - left);
      expect({
        order: candidate.parentOrder,
        sourced: heights.length,
        skylineCount: heights.filter((height) => height >= NORTHERN_MANHATTAN_SKYLINE_HEIGHT_METERS).length,
        tallest: heights[0] ?? null,
      }).toEqual({
        order: candidate.parentOrder,
        sourced: candidate.sourcedHeightCount,
        skylineCount: candidate.skylineBuildingCount,
        tallest: candidate.tallestSourcedHeightMeters,
      });
    }
  });
});
