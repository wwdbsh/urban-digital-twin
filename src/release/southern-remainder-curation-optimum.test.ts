/**
 * The curated `w03` subset is the maximum under a STATED decision rule, and the
 * rule's cost is pinned rather than hidden.
 *
 * An earlier version of this suite enumerated only combinations of up to FOUR
 * cells and let the module claim the result was "the enumerated optimum over
 * every admissible combination". Review caught it: lift the bound and
 * `{379, 380, 385, 387, 388}` scores 18 against the curated set's 16, inside the
 * envelope and inside the entry budget. The bound was real and load-bearing; the
 * sentence describing it was not there.
 *
 * So this suite now enumerates WITHOUT the bound and applies the rule in the
 * open, in the order `southern-remainder-curation.ts` states it:
 *
 *   1. edge-contiguity, a PRECONDITION;
 *   2. at most `SOUTHERN_REMAINDER_CURATION_MAX_CELLS` cells, a stated criterion;
 *   3. maximize skyline value under 1 and 2.
 *
 * And it pins what each constraint costs, because a constraint whose price is
 * unmeasured is indistinguishable from a rationalisation:
 *
 *   - contiguity costs 2 skyline buildings (18 -> 16), and the two 18-scoring
 *     sets are named and asserted DISCONNECTED;
 *   - the four-cell bound costs nothing on score — under contiguity the maximum
 *     is 16 at any size — and buys uniqueness, which is asserted by showing that
 *     lifting it leaves FIVE connected combinations tied at 16.
 *
 * Everything is recomputed from the committed wave ledger and the committed
 * skyline census on every run.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SOUTHERN_REMAINDER_CURATED_CELLS,
  SOUTHERN_REMAINDER_CURATED_SUBSET_CEILING,
  SOUTHERN_REMAINDER_CURATION_MAX_CELLS,
  SOUTHERN_REMAINDER_REJECTED_ALTERNATIVES,
  SOUTHERN_REMAINDER_SKYLINE_ENVELOPE,
  SOUTHERN_REMAINDER_SKYLINE_HEIGHT_METERS,
  southernRemainderCellsConnected,
} from "./southern-remainder-curation";
import { EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256, EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID } from "../domain/exterior-fullsnapshot-input";
import { collectMidtownCoreSources } from "./midtown-core-source";
import { sha256HexSync } from "../domain/deterministic-hash";

const LEDGER_PATH = "data/normalized/manhattan-exterior-wave-ledger-20260804/ledger.json";
/**
 * The candidate profile the release itself committed. It is emitted by the same
 * pipeline run that emitted the release, from the same pinned base, so "which
 * cells were available to choose from and how tall are they" is read from
 * committed bytes rather than recomputed here over 9,603 buildings.
 */
const SKYLINE_PATH = "data/southern-remainder-20260812-p1/skyline-census.json";
const CENSUS_PATH = "data/southern-remainder-20260812-p1/wave-census.json";
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

const ENTRY_BUDGET = SOUTHERN_REMAINDER_CURATED_SUBSET_CEILING;

interface Combination { cellIds: string[]; orders: number[]; skyline: number; tallest: number; owned: number; connected: boolean; size: number }

/**
 * Every combination of two or more candidates that fits the entry budget, with
 * NO size bound of its own.
 *
 * `maxSize` exists only so the suite can state what each bound costs; it is
 * never defaulted to the curation's bound, because defaulting it is exactly how
 * the previous version hid the constraint it was supposed to be testing.
 */
function admissibleCombinations(cells: readonly SkylineCandidate[], maxSize: number): Combination[] {
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
        size: chosen.length,
      });
    }
    if (chosen.length === maxSize) return;
    for (let index = start; index < cells.length; index += 1) {
      const next = owned + cells[index]!.ownedBuildingCount;
      if (next > ENTRY_BUDGET) continue;
      walk(index + 1, [...chosen, cells[index]!], next);
    }
  };
  walk(0, [], 0);
  return results.sort((left, right) => right.skyline - left.skyline || right.tallest - left.tallest || right.owned - left.owned);
}

const curatedIds = [...SOUTHERN_REMAINDER_CURATED_CELLS.map((record) => record.cellId)].sort();
/** Unbounded: every candidate could in principle be admitted. */
const UNBOUNDED = skyline.candidates.length;

describe("the curated subset under the stated decision rule", () => {
  const bounded = admissibleCombinations(skyline.candidates, SOUTHERN_REMAINDER_CURATION_MAX_CELLS);
  const unbounded = admissibleCombinations(skyline.candidates, UNBOUNDED);

  it("reads its candidates from the committed skyline census, against the committed envelope", () => {
    expect(skyline.envelope).toEqual({ ...SOUTHERN_REMAINDER_SKYLINE_ENVELOPE });
    expect(skyline.skylineThresholdMeters).toBe(SOUTHERN_REMAINDER_SKYLINE_HEIGHT_METERS);
    expect(skyline.entryBudget).toBe(ENTRY_BUDGET);
    expect(skyline.curatedCellIds).toEqual(SOUTHERN_REMAINDER_CURATED_CELLS.map((record) => record.cellId));
    // A real choice, not a set of one: without alternatives "maximum" is empty.
    expect(skyline.candidates.length).toBeGreaterThanOrEqual(8);
    expect(bounded.length).toBeGreaterThan(50);
    expect(unbounded.length).toBeGreaterThan(bounded.length);
    // The census is derived from the same committed ledger this test reads, so a
    // candidate that stopped existing fails here rather than silently shrinking
    // the enumeration.
    const byId = new Map(ledger.cells.map((cell) => [cell.cellId, cell]));
    for (const candidate of skyline.candidates) {
      expect(byId.get(candidate.cellId)!.buildingIds).toHaveLength(candidate.ownedBuildingCount);
      expect(byId.get(candidate.cellId)!.bounds).toEqual(candidate.bounds);
    }
  });

  /** Step 1 of the rule, and the only one that costs score. */
  it("EDGE-CONTIGUITY is a precondition, and it costs exactly two skyline buildings", () => {
    const bestAnyShape = Math.max(...unbounded.map((entry) => entry.skyline));
    const bestConnected = Math.max(...unbounded.filter((entry) => entry.connected).map((entry) => entry.skyline));
    expect(bestAnyShape).toBe(18);
    expect(bestConnected).toBe(16);
    expect(bestAnyShape - bestConnected).toBe(2);
    // Contiguity caps the score at 16 AT ANY SIZE, which is what makes the
    // give-up bounded rather than open-ended.
    for (const maxSize of [4, 5, 6, UNBOUNDED]) {
      const combos = admissibleCombinations(skyline.candidates, maxSize).filter((entry) => entry.connected);
      expect({ maxSize, best: Math.max(...combos.map((entry) => entry.skyline)) }).toEqual({ maxSize, best: 16 });
    }
  });

  /** The rejected alternatives, pinned by name, score and disconnectedness. */
  it("names every higher-scoring combination it refused, and proves each is disconnected", () => {
    const reachedEighteen = unbounded.filter((entry) => entry.skyline === 18);
    expect(reachedEighteen).toHaveLength(SOUTHERN_REMAINDER_REJECTED_ALTERNATIVES.length);
    // Compared as SETS: the enumeration's ordering is an artifact of its sort
    // keys, and pinning it would make this suite fail on a tie-break change
    // rather than on a curation change.
    expect(reachedEighteen.map((entry) => entry.orders.join(",")).sort()).toEqual(
      SOUTHERN_REMAINDER_REJECTED_ALTERNATIVES.map((entry) => entry.parentOrders.join(",")).sort(),
    );
    for (const rejected of SOUTHERN_REMAINDER_REJECTED_ALTERNATIVES) {
      const measured = unbounded.find((entry) => entry.orders.join(",") === rejected.parentOrders.join(","));
      expect(measured).toBeDefined();
      expect({
        skyline: measured!.skyline,
        owned: measured!.owned,
        connected: measured!.connected,
        withinBudget: measured!.owned <= ENTRY_BUDGET,
      }).toEqual({
        skyline: rejected.skylineBuildingCount,
        owned: rejected.ownedBuildingCount,
        connected: false,
        // The refusal is about SHAPE, not about cost: both fit the budget.
        withinBudget: true,
      });
      // Cell 385 is the isolated one in both, which is what the reason says.
      expect(rejected.parentOrders).toContain(385);
      expect(rejected.reason).toMatch(/385/u);
    }
  });

  /** Step 2 of the rule: buys uniqueness, not score. */
  it("the four-cell bound buys UNIQUENESS rather than quality", () => {
    const connectedUnbounded = unbounded.filter((entry) => entry.connected && entry.skyline === 16);
    // Lift the bound and five connected combinations tie at 16.
    expect(connectedUnbounded).toHaveLength(5);
    expect(connectedUnbounded.map((entry) => entry.orders.join(",")).sort()).toEqual([
      "379,380,381,386,387",
      "379,380,381,387,388",
      "379,380,386,387,388",
      "379,381,386,387,388",
      "379,385,386,387",
    ]);
    // Exactly one of the five respects the stated bound, and it is the curated
    // set. That is what the bound is for.
    const withinBound = connectedUnbounded.filter((entry) => entry.size <= SOUTHERN_REMAINDER_CURATION_MAX_CELLS);
    expect(withinBound).toHaveLength(1);
    expect([...withinBound[0]!.cellIds].sort()).toEqual(curatedIds);
    expect(SOUTHERN_REMAINDER_CURATION_MAX_CELLS).toBe(4);
    expect(SOUTHERN_REMAINDER_CURATED_CELLS.length).toBeLessThanOrEqual(SOUTHERN_REMAINDER_CURATION_MAX_CELLS);
  });

  /** Step 3: the maximum under 1 and 2, and it is unique. */
  it("makes the curated four the UNIQUE maximum among connected combinations of at most four cells", () => {
    const eligible = bounded.filter((entry) => entry.connected);
    const best = Math.max(...eligible.map((entry) => entry.skyline));
    expect(best).toBe(16);
    const maxima = eligible.filter((entry) => entry.skyline === best);
    expect(maxima).toHaveLength(1);
    expect([...maxima[0]!.cellIds].sort()).toEqual(curatedIds);
    // The three DISCONNECTED size-<=4 combinations that also reach 16 are named,
    // so the precondition is visibly doing work at this size too.
    const disconnectedTies = bounded.filter((entry) => entry.skyline === best && !entry.connected);
    expect(disconnectedTies.map((entry) => entry.orders.join(",")).sort()).toEqual([
      "379,380,385,387",
      "379,381,385,387",
      "379,385,387,388",
    ]);
  });

  it("names the runner-up and the best single-cell score, so the ADR quotes checked figures", () => {
    const eligible = bounded.filter((entry) => entry.connected);
    const runnerUp = eligible.filter((entry) => entry.skyline < 16).sort((left, right) => right.skyline - left.skyline)[0]!;
    // The best CONNECTED four-cell-or-fewer alternative scores 14: the rule's
    // margin over its own runner-up is 2, the same size as what contiguity gave
    // up, and both numbers are checked rather than quoted.
    expect(runnerUp.skyline).toBe(14);
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
    const census = readJson<{ shipped: { requestedBuildingCount: number; materializedBuildingCount: number; refusedBuildingCount: number } }>(CENSUS_PATH);
    expect(census.shipped.requestedBuildingCount).toBe(180);
    expect(census.shipped.materializedBuildingCount).toBe(179);
    expect(census.shipped.refusedBuildingCount).toBe(1);
    const owned = SOUTHERN_REMAINDER_CURATED_CELLS
      .map((record) => ledger.cells.find((cell) => cell.cellId === record.cellId)!.buildingIds.length)
      .reduce((sum, count) => sum + count, 0);
    expect(owned).toBe(180);
  });
});

/**
 * "Skyline value" is a claim about SOURCED HEIGHTS, so this section checks the
 * heights rather than trusting them.
 *
 * The census is pinned to the exact base it was derived from, and that pin is
 * checked unconditionally: a census computed against a different snapshot would
 * be describing different buildings. Its per-cell numbers are then checked for
 * internal consistency, also unconditionally.
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

  it("is internally consistent for every candidate cell", () => {
    for (const candidate of skyline.candidates) {
      const label = `cell ${candidate.parentOrder}`;
      // A building whose source states no height is counted as owned and cannot
      // be ranked, so the two counts are ordered rather than equal.
      expect({ label, ok: candidate.sourcedHeightCount <= candidate.ownedBuildingCount }).toEqual({ label, ok: true });
      expect({ label, ok: candidate.skylineBuildingCount <= candidate.sourcedHeightCount }).toEqual({ label, ok: true });
      const top = candidate.topSourcedHeightMeters;
      expect({ label, sorted: [...top].sort((a, b) => b - a) }).toEqual({ label, sorted: top });
      expect({ label, tallest: candidate.tallestSourcedHeightMeters }).toEqual({ label, tallest: top[0] ?? null });
      // The top-five window is a lower bound on the skyline count whenever it is
      // not itself truncated by the threshold.
      const tallInTop = top.filter((height) => height >= SOUTHERN_REMAINDER_SKYLINE_HEIGHT_METERS).length;
      if (tallInTop < top.length) expect({ label, count: candidate.skylineBuildingCount }).toEqual({ label, count: tallInTop });
      else expect({ label, ok: candidate.skylineBuildingCount >= tallInTop }).toEqual({ label, ok: true });
    }
  });
});

describe.skipIf(!existsSync(`${SNAPSHOT_ROOT}/manifest.json`))("the skyline census recomputed from the pinned base", () => {
  /**
   * The cells whose heights the decision rule actually turned on: the four that
   * were curated and every cell named in a rejected alternative. Recomputing the
   * whole envelope would be no stronger and much slower; recomputing less than
   * this would leave the tradeoff resting on numbers nobody checked.
   */
  const decisive = new Set<number>([
    ...SOUTHERN_REMAINDER_CURATED_CELLS.map((record) => record.parentOrder),
    ...SOUTHERN_REMAINDER_REJECTED_ALTERNATIVES.flatMap((entry) => [...entry.parentOrders]),
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
        skylineCount: heights.filter((height) => height >= SOUTHERN_REMAINDER_SKYLINE_HEIGHT_METERS).length,
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
