/**
 * The curated `w04` subset is the maximum under a STATED decision rule, and the
 * rule's cost is pinned rather than hidden.
 *
 * The T018 review of the `w03` curation found an optimality claim that was FALSE
 * because the enumeration behind it silently bounded combinations at four cells
 * and the sentence did not say so. Two things are done differently here so the
 * same defect cannot recur:
 *
 *  - **The candidate set is the WHOLE WAVE.** All 249 owned cells, not a band
 *    drawn around the answer. A maximum over a band is a maximum over whatever
 *    the band happened to contain.
 *  - **The connectivity-ignoring optimum is computed EXACTLY**, by enumerating
 *    every subset of the scoring candidates rather than by bounding the search.
 *    A cell that scores zero can only consume budget, so the maximum over all
 *    subsets equals the maximum over subsets of the scoring candidates — which is
 *    what makes an exhaustive enumeration over 2^18 subsets an exact statement
 *    about a space that is otherwise 2^249.
 *
 * The rule, in the order `central-upper-manhattan-curation.ts` states it:
 *
 *   1. edge-contiguity, a PRECONDITION;
 *   2. fit the 42-entry decided share, a PRECONDITION;
 *   3. maximize skyline value;
 *   4. tie-break on ground covered — at equal skyline value, more whole cells.
 *
 * And what each constraint costs, because a constraint whose price is unmeasured
 * is indistinguishable from a rationalisation:
 *
 *   - contiguity costs FOUR skyline buildings (11 -> 7) and the 11-scoring set is
 *     named and asserted disconnected;
 *   - a twelfth is reachable only by also reusing a canary cell, which is
 *     inadmissible independently, and that is recorded rather than folded into
 *     the contiguity cost;
 *   - the tie-break costs nothing on score and buys uniqueness, which is asserted
 *     by showing that without it two connected subsets tie at 7.
 *
 * Everything is recomputed from the committed wave ledger and the committed
 * skyline census on every run.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CENTRAL_UPPER_MANHATTAN_CANARY_RENDERABLE_CELL_IDS,
  CENTRAL_UPPER_MANHATTAN_CANDIDATE_ENVELOPE,
  CENTRAL_UPPER_MANHATTAN_CURATED_CELLS,
  CENTRAL_UPPER_MANHATTAN_CURATED_SUBSET_CEILING,
  CENTRAL_UPPER_MANHATTAN_REJECTED_ALTERNATIVES,
  CENTRAL_UPPER_MANHATTAN_SKYLINE_HEIGHT_METERS,
  CENTRAL_UPPER_MANHATTAN_W05_RESERVED_ENTRIES,
  centralUpperManhattanCellsConnected,
  centralUpperManhattanSplitShares,
} from "./central-upper-manhattan-curation";
import { EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256, EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID } from "../domain/exterior-fullsnapshot-input";
import { collectMidtownCoreSources } from "./midtown-core-source";
import { sha256HexSync } from "../domain/deterministic-hash";

const LEDGER_PATH = "data/normalized/manhattan-exterior-wave-ledger-20260804/ledger.json";
/**
 * The candidate profile the release itself committed. It is emitted by the same
 * pipeline run that emitted the release, from the same pinned base, so "which
 * cells were available to choose from and how tall are they" is read from
 * committed bytes rather than recomputed here over 11,721 buildings.
 */
const SKYLINE_PATH = "data/central-upper-manhattan-20260812-p1/skyline-census.json";
const CENSUS_PATH = "data/central-upper-manhattan-20260812-p1/wave-census.json";
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
  entryBudget: number;
  curatedCellIds: string[];
  candidates: SkylineCandidate[];
}>(SKYLINE_PATH);

const ENTRY_BUDGET = CENTRAL_UPPER_MANHATTAN_CURATED_SUBSET_CEILING;
const CANARY = new Set(CENTRAL_UPPER_MANHATTAN_CANARY_RENDERABLE_CELL_IDS);
const curatedIds = [...CENTRAL_UPPER_MANHATTAN_CURATED_CELLS.map((record) => record.cellId)].sort();

function scoreOf(candidate: SkylineCandidate, threshold: number): number {
  return threshold === CENTRAL_UPPER_MANHATTAN_SKYLINE_HEIGHT_METERS
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
    .map((right, other) => (other === index ? -1 : (centralUpperManhattanCellsConnected([
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
 * The maximum over EVERY subset that fits the budget, connected or not, computed
 * exactly.
 *
 * A cell whose score is zero can only consume budget, so it can never be in an
 * optimum that a smaller subset does not already match. The maximum over all
 * subsets is therefore the maximum over subsets of the SCORING candidates, and
 * that set is small enough to enumerate exhaustively — which is asserted rather
 * than assumed, so a future base that produced a hundred scoring cells fails here
 * instead of silently exceeding the enumeration's reach.
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
 * The rule, applied in the order the curation states it.
 *
 * KEY 4 IS A COUNT OF WHOLE CELLS. `central-upper-manhattan-curation.ts` states
 * it in exactly those words; the string this release SHIPPED says "the larger
 * contiguous ground", which reads as a ranking on area. The two are the same
 * ranking here only because this ledger's cells are equal-area tiles at a fixed
 * zoom, and they select the SAME subset at every threshold this suite runs — which
 * `returns the same winner at 60, 75, 90, 100 and 120 metres` checks. The shipped
 * string is immutable, so the module carries the precise wording and this comment
 * records the equivalence rather than the code being changed to rank on area.
 *
 * KEY 5 is the total-order fallback below: lexicographic on the parent-order
 * sequence. It exists only so the rule is a function rather than a relation, and
 * `key 5 is never reached, at any threshold` asserts it never decides anything.
 */
function ruleWinner(candidates: readonly SkylineCandidate[], threshold: number): Combination {
  return ruleMaxima(candidates, threshold)
    .sort((left, right) => left.orders.join(",").localeCompare(right.orders.join(",")))[0]!;
}

/**
 * Everything that survives keys 1 to 4. More than one entry here means key 5 —
 * the arbitrary tie-break — decided the promoted subset, which is the thing the
 * curation must never rest on.
 */
function ruleMaxima(candidates: readonly SkylineCandidate[], threshold: number): Combination[] {
  const admissible = candidates.filter((cell) => !CANARY.has(cell.cellId));
  const connected = connectedCombinations(admissible, threshold);
  const best = Math.max(...connected.map((entry) => entry.skyline));
  const maxima = connected.filter((entry) => entry.skyline === best);
  const mostCells = Math.max(...maxima.map((entry) => entry.size));
  return maxima.filter((entry) => entry.size === mostCells);
}

describe("the curated subset under the stated decision rule", () => {
  const admissible = skyline.candidates.filter((cell) => !CANARY.has(cell.cellId));
  const connected = connectedCombinations(admissible, CENTRAL_UPPER_MANHATTAN_SKYLINE_HEIGHT_METERS);

  it("reads its candidates from the committed skyline census, over the WHOLE wave", () => {
    expect(skyline.envelope).toEqual({ ...CENTRAL_UPPER_MANHATTAN_CANDIDATE_ENVELOPE });
    expect(skyline.skylineThresholdMeters).toBe(CENTRAL_UPPER_MANHATTAN_SKYLINE_HEIGHT_METERS);
    expect(skyline.entryBudget).toBe(ENTRY_BUDGET);
    expect(skyline.curatedCellIds).toEqual(CENTRAL_UPPER_MANHATTAN_CURATED_CELLS.map((record) => record.cellId));
    // Every owned cell of the wave is a candidate: 249, not a band.
    expect(skyline.candidates).toHaveLength(249);
    expect(skyline.candidates.filter((cell) => cell.ownedBuildingCount <= ENTRY_BUDGET)).toHaveLength(104);
    // A real choice, not a set of one.
    expect(connected.length).toBeGreaterThan(250);
    // The census is derived from the same committed ledger this test reads, so a
    // candidate that stopped existing fails here rather than silently shrinking
    // the enumeration.
    const byId = new Map(ledger.cells.map((cell) => [cell.cellId, cell]));
    for (const candidate of skyline.candidates) {
      expect(byId.get(candidate.cellId)!.buildingIds).toHaveLength(candidate.ownedBuildingCount);
      expect(byId.get(candidate.cellId)!.bounds).toEqual(candidate.bounds);
    }
  });

  it("takes the 42-entry share from the recorded split rather than from a typed constant", () => {
    const shares = centralUpperManhattanSplitShares();
    expect(shares).toEqual({
      headroomEntries: 78,
      response: 2,
      basis: "proportional-to-canonical-buildings",
      w04Share: CENTRAL_UPPER_MANHATTAN_CURATED_SUBSET_CEILING,
      w05Reserved: CENTRAL_UPPER_MANHATTAN_W05_RESERVED_ENTRIES,
    });
    expect(shares.w04Share + shares.w05Reserved).toBe(shares.headroomEntries);
    // Sub-median by construction: response 2 is the sub-median split, and this
    // wave's median cell owns 48.
    expect(shares.w04Share).toBeLessThan(48);
  });

  /** Step 1 of the rule, and the only one that costs score. */
  it("EDGE-CONTIGUITY is a precondition, and it costs exactly four skyline buildings", () => {
    const anyShape = unconstrainedOptima(admissible, CENTRAL_UPPER_MANHATTAN_SKYLINE_HEIGHT_METERS);
    const bestConnected = Math.max(...connected.map((entry) => entry.skyline));
    expect(anyShape.best).toBe(11);
    expect(bestConnected).toBe(7);
    expect(anyShape.best - bestConnected).toBe(4);
    // Every set that reaches 11 is disconnected, or contiguity would cost nothing.
    for (const witness of anyShape.witnesses) {
      const cells = witness.cellIds.map((cellId) => skyline.candidates.find((cell) => cell.cellId === cellId)!);
      expect({
        orders: witness.orders,
        connected: centralUpperManhattanCellsConnected(cells.map((cell) => ({ cellId: cell.cellId, order: cell.parentOrder, bounds: cell.bounds, buildingIds: [] }))),
      }).toEqual({ orders: witness.orders, connected: false });
    }
    // Contiguity caps the score at 7 AT ANY SIZE. `connectedCombinations` grows
    // without a size bound, so this is a statement about every connected subset
    // that fits the share and not about a truncated search.
    expect(Math.max(...connected.map((entry) => entry.size))).toBeGreaterThan(2);
  });

  it("names the 12-scoring combination separately, because it is inadmissible for a SECOND reason", () => {
    const withCanary = unconstrainedOptima(skyline.candidates, CENTRAL_UPPER_MANHATTAN_SKYLINE_HEIGHT_METERS);
    expect(withCanary.best).toBe(12);
    // Every 12-scoring set reuses a canary cell, which is what makes attributing
    // 12 - 7 to contiguity an overstatement.
    for (const witness of withCanary.witnesses) {
      expect(witness.cellIds.some((cellId) => CANARY.has(cellId))).toBe(true);
    }
  });

  /** The rejected alternatives, pinned by name, score, cost and shape. */
  it("names every alternative it refused and recomputes each one's properties", () => {
    const byOrders = new Map<string, SkylineCandidate[]>();
    for (const rejected of CENTRAL_UPPER_MANHATTAN_REJECTED_ALTERNATIVES) {
      byOrders.set(
        rejected.parentOrders.join(","),
        rejected.parentOrders.map((order) => skyline.candidates.find((cell) => cell.parentOrder === order)!),
      );
    }
    for (const rejected of CENTRAL_UPPER_MANHATTAN_REJECTED_ALTERNATIVES) {
      const cells = byOrders.get(rejected.parentOrders.join(","))!;
      expect(cells.every((cell) => cell !== undefined)).toBe(true);
      const measured = {
        skyline: cells.reduce((sum, cell) => sum + cell.skylineBuildingCount, 0),
        owned: cells.reduce((sum, cell) => sum + cell.ownedBuildingCount, 0),
        connected: centralUpperManhattanCellsConnected(cells.map((cell) => ({ cellId: cell.cellId, order: cell.parentOrder, bounds: cell.bounds, buildingIds: [] }))),
      };
      expect({ orders: rejected.parentOrders, ...measured }).toEqual({
        orders: rejected.parentOrders,
        skyline: rejected.skylineBuildingCount,
        owned: rejected.ownedBuildingCount,
        connected: rejected.connected,
      });
      // The refusal is about SHAPE, REUSE or the tie-break, never about cost:
      // every one of them fits the 42-entry share.
      expect({ orders: rejected.parentOrders, withinBudget: measured.owned <= ENTRY_BUDGET })
        .toEqual({ orders: rejected.parentOrders, withinBudget: true });
      // The stated reason matches the property that actually refuses it.
      if (rejected.refusedBy === "edge-contiguity") expect(measured.connected).toBe(false);
      if (rejected.refusedBy === "canary-subset-reuse") {
        expect(cells.some((cell) => CANARY.has(cell.cellId))).toBe(true);
      }
      if (rejected.refusedBy === "ground-coverage-tie-break") {
        expect(measured.connected).toBe(true);
        expect(measured.skyline).toBe(7);
        expect(cells.length).toBeLessThan(CENTRAL_UPPER_MANHATTAN_CURATED_CELLS.length);
      }
      if (rejected.refusedBy === "skyline-value") expect(measured.skyline).toBeLessThan(7);
    }
  });

  /** Step 3 and step 4: the maximum, the tie, and what breaks it. */
  it("reaches 7 with exactly two connected subsets, and the whole-cell tie-break makes the curated one unique", () => {
    const maxima = connected.filter((entry) => entry.skyline === 7);
    expect(maxima.map((entry) => entry.orders.join(",")).sort()).toEqual(["490", "490,491"]);
    const survivors = ruleMaxima(skyline.candidates, CENTRAL_UPPER_MANHATTAN_SKYLINE_HEIGHT_METERS);
    expect(survivors).toHaveLength(1);
    expect([...survivors[0]!.cellIds].sort()).toEqual(curatedIds);
    expect(survivors[0]!.owned).toBe(41);
    // The winner spends 41 of the 42-entry share, leaving one spare.
    expect(ENTRY_BUDGET - survivors[0]!.owned).toBe(1);
  });

  /**
   * Key 5 is the arbitrary one, and a curation that rested on it would be
   * choosing between equals by string order. Keys 1 to 4 must leave exactly one
   * candidate — and must do so at every threshold, not only at the one the
   * curation names, or the claim would hold by coincidence at 90 m.
   */
  it("never reaches key 5, at any of the five thresholds", () => {
    for (const threshold of [60, 75, 90, 100, 120]) {
      const survivors = ruleMaxima(skyline.candidates, threshold);
      expect({ threshold, survivors: survivors.map((entry) => entry.orders.join(",")) })
        .toEqual({ threshold, survivors: ["490,491"] });
    }
  });

  /**
   * ADR 0036 precondition (b): 90 m is wave `w03`'s judgement and this wave has
   * to say whether it is right. The strongest available answer is that the
   * ranking does not depend on it.
   */
  it("returns the same winner at 60, 75, 90, 100 and 120 metres", () => {
    for (const threshold of [60, 75, 90, 100, 120]) {
      const winner = ruleWinner(skyline.candidates, threshold);
      expect({ threshold, cellIds: [...winner.cellIds].sort() }).toEqual({ threshold, cellIds: curatedIds });
    }
    // And the threshold still discriminates on this wave rather than admitting
    // everything: 141 of 11,703 sourced heights reach it.
    const sourced = skyline.candidates.reduce((sum, cell) => sum + cell.sourcedHeightCount, 0);
    const tall = skyline.candidates.reduce((sum, cell) => sum + cell.skylineBuildingCount, 0);
    expect({ sourced, tall }).toEqual({ sourced: 11703, tall: 141 });
    expect(skyline.candidates.filter((cell) => cell.skylineBuildingCount > 0)).toHaveLength(56);
  });

  it("states owned and materialized separately, because they are different numbers", () => {
    const census = readJson<{ shipped: { requestedBuildingCount: number; materializedBuildingCount: number; refusedBuildingCount: number } }>(CENSUS_PATH);
    expect(census.shipped.requestedBuildingCount).toBe(41);
    expect(census.shipped.materializedBuildingCount).toBe(40);
    expect(census.shipped.refusedBuildingCount).toBe(1);
    const owned = CENTRAL_UPPER_MANHATTAN_CURATED_CELLS
      .map((record) => ledger.cells.find((cell) => cell.cellId === record.cellId)!.buildingIds.length)
      .reduce((sum, count) => sum + count, 0);
    expect(owned).toBe(41);
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
      const thresholds = [60, 75, 90, 100, 120];
      const counts = thresholds.map((threshold) => candidate.skylineBuildingCountByThresholdMeters[String(threshold)]!);
      expect({ label, counts, sorted: [...counts].sort((a, b) => b - a) }).toEqual({ label, counts, sorted: counts });
      expect({ label, at90: counts[2] }).toEqual({ label, at90: candidate.skylineBuildingCount });
      // The top-five window is a lower bound on the skyline count whenever it is
      // not itself truncated by the threshold.
      const tallInTop = top.filter((height) => height >= CENTRAL_UPPER_MANHATTAN_SKYLINE_HEIGHT_METERS).length;
      if (tallInTop < top.length) expect({ label, count: candidate.skylineBuildingCount }).toEqual({ label, count: tallInTop });
      else expect({ label, ok: candidate.skylineBuildingCount >= tallInTop }).toEqual({ label, ok: true });
    }
  });
});

describe.skipIf(!existsSync(`${SNAPSHOT_ROOT}/manifest.json`))("the skyline census recomputed from the pinned base", () => {
  /**
   * The cells whose heights the decision rule actually turned on: the two that
   * were curated and every cell named in a rejected alternative. Recomputing the
   * whole wave would be no stronger and much slower; recomputing less than this
   * would leave the tradeoff resting on numbers nobody checked.
   */
  const decisive = new Set<number>([
    ...CENTRAL_UPPER_MANHATTAN_CURATED_CELLS.map((record) => record.parentOrder),
    ...CENTRAL_UPPER_MANHATTAN_REJECTED_ALTERNATIVES.flatMap((entry) => [...entry.parentOrders]),
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
        skylineCount: heights.filter((height) => height >= CENTRAL_UPPER_MANHATTAN_SKYLINE_HEIGHT_METERS).length,
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
