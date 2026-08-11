/**
 * The CURATED renderable subset of wave `w04`, and the record of why it is those
 * cells.
 *
 * ADR 0036 precondition (b) forbids promotion from inheriting this wave's canary
 * subset. That subset is the ledger-order walk — cells 452, 453 and 454, the
 * wave's first three under an 80-entry ceiling — which is the wave's FIRST ground
 * rather than its best, because the ledger's `order` field is documented as
 * global visual-priority order and is in fact a south-to-north tile-row traversal.
 * Precondition (b) also requires the promoted subset to be an explicit list with a
 * stated basis, its optimality claim to be RE-ENUMERABLE from committed bytes on
 * every test run, its refusal census to reach the committed inventory only through
 * a fresh `gates` receipt, and the list to be covered by the stage fingerprint.
 *
 * ## The budget is a DECIDED SHARE, not a self-imposed judgement
 *
 * This is the one thing that differs most from wave `w03`'s curation, and it
 * cannot be inherited by silence. ADR 0036 Decision 3 recorded that 78 promoted
 * cache entries are left beside the four promoted waves, that TWO waves remain
 * unpromoted (`w04` and `w05`), and that their median cells — 48 and 55 — do not
 * both fit. It named three admissible responses and deliberately took none.
 *
 * **T020 takes response 2 — the two remaining waves split the 78 entries at
 * sub-median scale — in a PROPORTIONAL-TO-BUILDINGS form rather than the even
 * "roughly 39 each" the ADR sketched.** Wave `w04` owns 11,721 canonical buildings
 * and wave `w05` owns 10,230, so `w04` takes 42 entries and `w05` is RESERVED 36:
 *
 *     78 x 11721 / (11721 + 10230) = 41.65 -> 42      w04, this release
 *     78 - 42                              = 36       w05, reserved for T022
 *
 * The reservation is stated in this release's committed bytes as well as here,
 * because a reservation nobody can read from the record is not a reservation. It
 * is BINDING on T022 in the sense ADR 0036 asked for — the decision was taken and
 * recorded by number, and what it costs the other wave is written down rather than
 * left to be discovered when that wave arrives.
 *
 * 42 IS BELOW THIS WAVE'S MEDIAN CELL OF 48, and response 2 says in terms that
 * both promotions would then ship deliberately small curated sets and both would
 * have to say so. This one says so: 104 of this wave's 249 cells fit the share at
 * all, and the promoted subset is two of them.
 *
 * ## The decision rule, stated exactly, in the order it is applied
 *
 *   1. **Edge-contiguity is a PRECONDITION, not a tie-break.** A promoted subset
 *      must render as one continuous piece of city; scattered textured islands
 *      with untextured ground between them read as a rendering fault rather than
 *      as a skyline. THE COST IS LARGER HERE THAN IT WAS FOR `w03` AND IT IS
 *      STATED RATHER THAN ABSORBED: ignoring connectivity entirely, the best
 *      42-entry subset of this wave scores 11 skyline buildings
 *      (`{457, 482, 616}`, 42 owned, three separate pieces), against 7 for the
 *      best connected one. Contiguity gives up FOUR skyline buildings. A twelfth
 *      is reachable only by also reusing the canary's cell 454, which precondition
 *      (b) excludes independently, so that combination is inadmissible twice over
 *      and is recorded as such rather than quoted as the cost of contiguity alone.
 *   2. **Fit the 42-entry decided share.** A precondition, not a preference: the
 *      share is what makes `w05`'s 36 reserved entries survive this promotion.
 *   3. **Maximize skyline value** — the count of owned buildings whose SOURCED
 *      height reaches `CENTRAL_UPPER_MANHATTAN_SKYLINE_HEIGHT_METERS` — under 1
 *      and 2. The maximum is 7, and it is reached by exactly two connected
 *      subsets: `{490}` at 39 owned and `{490, 491}` at 41.
 *   4. **Tie-break: at equal skyline value, admit the larger contiguous ground.**
 *      `{490, 491}` is then unique. This is a JUDGEMENT and is recorded as one:
 *      at equal skyline value the subset that also owns the open ground the towers
 *      are SEEN ACROSS is the better promotion, because a viewer who walks into
 *      the park is then standing on promoted ground looking at a promoted wall
 *      rather than crossing an invisible tile edge into base massing. What it
 *      costs is two more cache entries — 41 of 42 rather than 39 — and it costs
 *      wave `w05` nothing at all, because that wave's 36 entries are reserved
 *      separately and are not the remainder of this share.
 *
 * A fifth key is defined below and is never reached; the suite asserts that.
 *
 * `central-upper-manhattan-curation-optimum.test.ts` re-runs the whole rule over
 * the committed ledger and the committed per-cell skyline census on every test
 * run: it enumerates every connected admissible subset by expansion, computes the
 * connectivity-ignoring optimum EXACTLY by dynamic programming over the scoring
 * candidates rather than by sampling, and pins each rejected alternative by name,
 * score, owned count and connectedness.
 *
 * ## The 90 m threshold was CHECKED against this wave, not reused
 *
 * ADR 0036 precondition (b) says plainly that 90 m is `w03`'s judgement rather
 * than a discovery, and that a wave whose cells sit north of Midtown must state
 * whether it is right rather than reusing the constant because it exists. Two
 * things are recorded, and the second is the stronger:
 *
 *  - **It still discriminates.** 141 of this wave's 11,703 sourced heights reach
 *    90 m — 1.20% — spread over 56 of its 249 cells. It separates towers from the
 *    pre-war apartment stock that dominates this wave's building COUNT exactly as
 *    it separated towers from loft and warehouse stock in `w03`.
 *  - **The ranking does not depend on it.** The same cell wins at 60 m, 75 m,
 *    90 m, 100 m and 120 m; `central-upper-manhattan-curation-optimum.test.ts`
 *    re-runs the enumeration at all five and asserts it. So the threshold is a
 *    stated criterion whose exact value is NOT what chose these cells, which is a
 *    much better answer to precondition (b) than defending the number.
 */

import { EXTERIOR_WAVE_LEDGER_RELEASE_ID } from "./exterior-wave-ledger.ts";

function fail(message: string): never {
  throw new Error(`Central-upper-Manhattan curated subset: ${message}`);
}

/**
 * The candidate envelope, in WGS84 degrees: the WHOLE WAVE.
 *
 * Wave `w03`'s curation stated a band at the wave's northern edge and enumerated
 * inside it. That is deliberately NOT reproduced, because restricting the
 * candidate set weakens the optimality claim rather than strengthening it: a
 * maximum over a band is a maximum over whatever the band happened to contain,
 * and the band was drawn after the answer was known.
 *
 * This rectangle is the bounding box of all 249 owned cells, so the enumeration
 * behind the curated list ranges over EVERY cell of the wave and the containment
 * gate below is satisfied by construction. That is said here rather than being
 * presented as a gate that constrains anything: what actually constrains the
 * curated list is contiguity, the entry share, and the enumerated maximum.
 */
export const CENTRAL_UPPER_MANHATTAN_CANDIDATE_ENVELOPE = {
  west: -74.00390625,
  south: 40.770263671875,
  east: -73.916015625,
  north: 40.80322265625,
} as const;

/**
 * The sourced height, in metres, at or above which a building counts toward this
 * subset's skyline score.
 *
 * 90 m, carried forward from wave `w03` and CHECKED against this wave rather than
 * assumed — see the module docstring. Every height it is applied to is the SOURCED
 * `heightMeters` of the pinned `manhattan-citywide-20260804` base.
 */
export const CENTRAL_UPPER_MANHATTAN_SKYLINE_HEIGHT_METERS = 90;

/** Canonical building counts of the two waves that were still unpromoted at T020. */
export const CENTRAL_UPPER_MANHATTAN_SPLIT_BASIS = {
  headroomEntries: 78,
  w04BuildingCount: 11721,
  w05BuildingCount: 10230,
} as const;

/**
 * The promoted subset's entry share, in cache entries.
 *
 * It is NOT a self-imposed judgement like `w03`'s 200-entry ceiling. It is the
 * `w04` half of the ADJUDICATED SPLIT of ADR 0036's 78-entry headroom — response
 * 2, taken proportional to canonical buildings — and the arithmetic that produces
 * it is `centralUpperManhattanSplitShares` below rather than a number typed here.
 */
export const CENTRAL_UPPER_MANHATTAN_CURATED_SUBSET_CEILING = 42;

/** What the same split RESERVES for wave `w05`, and therefore denies this one. */
export const CENTRAL_UPPER_MANHATTAN_W05_RESERVED_ENTRIES = 36;

/** ADR 0036 Decision 3's admissible responses, by the numbers that ADR gave them. */
export const CENTRAL_UPPER_MANHATTAN_SPLIT_RESPONSE_TAKEN = 2 as const;

/**
 * The split, computed rather than asserted.
 *
 * Proportional to canonical buildings, with this wave's share ROUNDED and the
 * other wave's taken as the remainder, so the two always sum to the headroom and
 * neither can be quietly enlarged by a rounding choice made twice.
 */
export function centralUpperManhattanSplitShares(input: {
  headroomEntries: number;
  w04BuildingCount: number;
  w05BuildingCount: number;
} = CENTRAL_UPPER_MANHATTAN_SPLIT_BASIS): {
  headroomEntries: number;
  response: typeof CENTRAL_UPPER_MANHATTAN_SPLIT_RESPONSE_TAKEN;
  basis: "proportional-to-canonical-buildings";
  w04Share: number;
  w05Reserved: number;
} {
  if (input.headroomEntries <= 0) fail(`the headroom to split is ${input.headroomEntries} entries; there is nothing to split.`);
  if (input.w04BuildingCount <= 0 || input.w05BuildingCount <= 0) fail("a wave that owns no building cannot take a proportional share.");
  const w04Share = Math.round((input.headroomEntries * input.w04BuildingCount) / (input.w04BuildingCount + input.w05BuildingCount));
  return {
    headroomEntries: input.headroomEntries,
    response: CENTRAL_UPPER_MANHATTAN_SPLIT_RESPONSE_TAKEN,
    basis: "proportional-to-canonical-buildings",
    w04Share,
    w05Reserved: input.headroomEntries - w04Share,
  };
}

/**
 * The split decision as the committed record states it, in words.
 *
 * Carried into the release's own `payload-inventory.json` so a reader holding the
 * bytes learns what was decided and what it cost the other wave without having to
 * find an ADR.
 */
export const CENTRAL_UPPER_MANHATTAN_SPLIT_STATEMENT =
  "ADR 0036 Decision 3 recorded that 78 exterior cache entries remain beside the four promoted waves, that TWO waves are still unpromoted (w04 and w05), that their median cells own 48 and 55 buildings and therefore do not both fit, and that the promotion decision is a SPLIT rather than a fit-check. It enumerated three admissible responses and took none. T020 TAKES RESPONSE 2 — the two remaining waves split the 78 entries at sub-median scale — in a PROPORTIONAL-TO-CANONICAL-BUILDINGS form rather than the even 'roughly 39 each' that ADR sketched: 78 x 11,721 / (11,721 + 10,230) = 41.65, so wave w04 takes 42 entries and wave w05 is RESERVED the remaining 36. RESPONSE 1 WAS NOT TAKEN: this promotion does not consume the whole headroom and does not decide w05's fate by silence. RESPONSE 3 WAS NOT TAKEN: the cache cap is unchanged at 512 entries and 256 MiB, and EXTERIOR_RUNTIME_BUDGETS is not edited by this release. 42 IS BELOW THIS WAVE'S MEDIAN CELL OF 48, which response 2 says a sub-median split requires both promotions to state: only 104 of this wave's 249 cells fit the share at all, and the promoted subset is two of them. THE 36 RESERVED ENTRIES ARE BINDING ON T022 in the sense ADR 0036 asked for — the decision is recorded by number, in this release's own committed bytes, and what it costs the other wave is written down rather than left to be discovered when that wave arrives. A T022 promotion that needs more than 36 entries must re-open this split explicitly and say that it did. SEPARATELY, ADR 0034's admissible response 3 — count RESOLVED cache entries rather than shipped artifacts on disk — was CONSIDERED AND REJECTED at this task. Its appeal is that it would have made the promoted set look smaller: Block 835 ships 28 GLB artifacts for 14 buildings because it is the one release that ships both canonical levels of detail, and counting resolved entries would have recorded it as 14. It is rejected because BOTH of those levels can be resident in one session at once — the exterior cache is keyed per artifact, a camera that approaches and retreats resolves the fine level and then the coarse one, and neither is evicted while the entry cap is not met — so a resolved count would understate real occupancy by exactly the amount that matters. Disk-based counting stands, and every occupancy figure in this release is a count of shipped GLB artifacts." as const;

/**
 * The alternatives this curation REFUSED, named so the tradeoff is a record
 * rather than an omission.
 *
 * `central-upper-manhattan-curation-optimum.test.ts` recomputes each entry's
 * score, owned count and connectedness from the committed skyline census, so a
 * claim here cannot drift from the data it is about.
 */
export const CENTRAL_UPPER_MANHATTAN_REJECTED_ALTERNATIVES: readonly {
  readonly parentOrders: readonly number[];
  readonly skylineBuildingCount: number;
  readonly ownedBuildingCount: number;
  readonly connected: boolean;
  readonly refusedBy: "edge-contiguity" | "canary-subset-reuse" | "ground-coverage-tie-break" | "skyline-value";
  readonly reason: string;
}[] = [
  {
    parentOrders: [457, 482, 616],
    skylineBuildingCount: 11,
    ownedBuildingCount: 42,
    connected: false,
    refusedBy: "edge-contiguity",
    reason: "The BEST 42-entry subset of this wave when connectivity is ignored, and the true price of the contiguity precondition: 11 skyline buildings against the curated set's 7, exactly on the 42-entry share, and no cell of it reused from the canary. It is three separate pieces — a cell on West 74th Street west of Broadway, a cell on Broadway at West 69th, and a cell on the Upper East Side four kilometres away — so promoting it would put three textured islands in an untextured city and would read as three rendering faults rather than as one skyline. Contiguity therefore gives up FOUR skyline buildings here, against two for wave w03, and the larger cost is stated rather than smoothed.",
  },
  {
    parentOrders: [454, 457, 503, 588, 616],
    skylineBuildingCount: 12,
    ownedBuildingCount: 34,
    connected: false,
    refusedBy: "canary-subset-reuse",
    reason: "The highest-scoring 42-entry subset of any shape at all, at 12, and it is inadmissible TWICE OVER: it is five separate pieces, and one of them is cell 454, which is one of the three renderable cells of the T019 canary that ADR 0036 precondition (b) forbids this promotion from inheriting. It is recorded because leaving it out would let the contiguity cost above read as the whole story, and it is recorded with both reasons because attributing all of it to contiguity would overstate what that precondition costs.",
  },
  {
    parentOrders: [490],
    skylineBuildingCount: 7,
    ownedBuildingCount: 39,
    connected: true,
    refusedBy: "ground-coverage-tie-break",
    reason: "The other connected subset that reaches the maximum of 7, and the only alternative refused by a JUDGEMENT rather than by a precondition. It is the curated set minus the park cell: same seven skyline buildings, same tower wall, 39 owned rather than 41, and three entries of the share left unspent. It is refused by decision key 4 — at equal skyline value, admit the larger contiguous ground — because the subset that also owns the open ground the towers are seen across gives a viewer somewhere to stand and look from, and the two entries it costs are the share's own and are not wave w05's reserved 36.",
  },
  {
    parentOrders: [616],
    skylineBuildingCount: 6,
    ownedBuildingCount: 9,
    connected: true,
    refusedBy: "skyline-value",
    reason: "The densest candidate in the wave by skyline buildings per cache entry — six of its nine owned buildings reach 90 m, in one Upper East Side cell that would cost 9 of the 42 entries and leave 33 unspent. It is named because a reader who saw the ratios would ask why the cheapest tall cell was not taken, and the answer is that the rule ranks on skyline VALUE rather than on value per entry: it scores 6 against 7, and a promoted subset that spends a fifth of its share is not a better use of the share, it is a smaller promotion.",
  },
];

/**
 * The local refusal rate this subset must not exceed, as a fraction.
 *
 * ADR 0036 precondition (c) requires the promoted subset's local rate to be
 * recomputed from that run's own shipped census and justified against the 1.52%
 * wave rate, with no tolerance moved to reach it. The bound is TWICE the wave
 * rate, which is the rule wave `w03` stated; it is written here as arithmetic
 * over the wave rate rather than as the rounded constant `w03` used, so it cannot
 * drift from the rate it is about.
 *
 * The subset's actual rate is 1 of 41 = 2.44%, which is HIGHER than the wave's
 * 1.52% and is reported as such rather than smoothed: a 41-building subset has a
 * refusal granularity of 2.44 percentage points, so one refused ring is the
 * smallest non-zero rate it can have. The single refusal is a real one and it
 * ships as an explicit unavailable detail.
 */
export const CENTRAL_UPPER_MANHATTAN_WAVE_REFUSAL_RATE = 178 / 11721;
export const CENTRAL_UPPER_MANHATTAN_CURATED_MAX_REFUSAL_RATE = 2 * CENTRAL_UPPER_MANHATTAN_WAVE_REFUSAL_RATE;

export interface CentralUpperManhattanCuratedCellRecord {
  readonly cellId: string;
  /** Order this cell carries in the committed full-city wave ledger. */
  readonly parentOrder: number;
  /** Why this cell is in the promoted subset. Curation, stated as curation. */
  readonly rationale: string;
}

/**
 * The curated cells, west to east, in the order a viewer meets them walking into
 * the park.
 *
 * They are EDGE-CONNECTED: cell 490's eastern bound is exactly cell 491's western
 * bound over the identical latitude span, so the promoted subset renders as one
 * continuous piece of ground.
 *
 * Heights quoted in the rationales are the SOURCED `heightMeters` of the pinned
 * `manhattan-citywide-20260804` base, not a claim about any named building. The
 * NYC OTI footprint dataset carries no building names — its `name` field is the
 * literal string "Building <id>" — so no rationale here identifies a building by
 * name, and none is implied. The place names are geographic: the cell bounds
 * provably cover that ground.
 */
export const CENTRAL_UPPER_MANHATTAN_CURATED_CELLS: readonly CentralUpperManhattanCuratedCellRecord[] = [
  {
    cellId: "manhattan-exterior-cell-w04-000490-16-19300-17923",
    parentOrder: 490,
    rationale:
      "The tower wall, and the reason this subset exists rather than another: it carries SEVEN of its 39 owned buildings at a sourced height of 90 m or more, which is more than any other cell of this wave that fits the 42-entry share, and it tops out at 219.2 m — the tallest sourced structure in any admissible cell of wave w04 by more than 70 m, the next-tallest admissible cell reaching 148.1 m. Ten of its buildings reach 60 m, so the tallest has a skyline around it instead of standing alone on flat massing. Its bounds run from -73.98193 to -73.97644 east and 40.77026 to 40.77301 north, which is the block band between roughly Broadway and the western edge of Central Park from about West 65th to West 70th Street; the eastern bound IS that park edge, which is what makes the second cell adjacent to this one. 39 owned, 38 materialize; the single refusal is doitt:996078, whose sourced ring exceeds the 64-vertex limit the V3 grammar can carry, and it ships as an explicit unavailable detail rather than being given an invented outline.",
  },
  {
    cellId: "manhattan-exterior-cell-w04-000491-16-19301-17923",
    parentOrder: 491,
    rationale:
      "The parkland the wall is seen across. It owns TWO buildings in the same 460-metre by 300-metre footprint its neighbour fits 39 into — sourced heights 12.8 m and 6.1 m — because its bounds, -73.97644 to -73.97095 east over the identical latitude span, lie inside Central Park. It contributes NOTHING to the skyline score and is admitted for one stated reason: it is the ground a viewer stands on to look at the wall, so the promoted subset ends at the park's own edge rather than at an invisible tile boundary in the middle of open ground. Its two structures materialize and carry the same procedural tiles as everything else in the subset, which is a fact about the pipeline and not a claim that a park building looks like a tower. 2 owned, 2 materialize, none refused.",
  },
];

/**
 * What the curation is, stated so a reader does not have to infer it.
 *
 * Carried into the release record and asserted by test, because ADR 0036 asks
 * promotion to record how it chose, and an unrecorded choice is the failure mode
 * the precondition exists to prevent.
 */
export const CENTRAL_UPPER_MANHATTAN_CURATION_BASIS = "curated-list" as const;

export const CENTRAL_UPPER_MANHATTAN_CURATION_STATEMENT =
  "The promoted renderable subset of wave w04 is an EXPLICIT CURATED LIST of two ownership cells, not a re-derivation of the wave ledger's cell order. The canary's three order-derived cells 452, 453 and 454 are the wave's FIRST ground rather than its best, and ADR 0036 precondition (b) forbids inheriting them; none of the three appears here. THE DECISION RULE IS LEXICOGRAPHIC AND IS STATED IN THE ORDER IT WAS APPLIED. (1) EDGE-CONTIGUITY IS A PRECONDITION, not a tie-break: a promoted subset must render as one continuous piece of city rather than as scattered textured islands with untextured ground between them. (2) FIT THE 42-ENTRY DECIDED SHARE, which is the w04 half of ADR 0036's 78-entry headroom under response 2 taken proportional to canonical buildings, and which is what makes wave w05's 36 reserved entries survive this promotion. (3) MAXIMIZE SKYLINE VALUE — the count of owned buildings whose sourced height reaches 90 m — subject to those two. (4) TIE-BREAK ON GROUND COVERED: at equal skyline value, admit the larger contiguous ground. THE ENUMERATION IS OVER THE WHOLE WAVE. Wave w03's curation ranked inside a stated band; this one deliberately does not, because a maximum over a band drawn after the answer was known is weaker than a maximum over all 249 cells, and this claim is the latter. Under that rule the maximum reachable skyline score is 7 AT ANY SIZE, it is reached by exactly two connected subsets — {490} at 39 owned and {490, 491} at 41 — and key 4 makes {490, 491} unique. THE RULE IS NOT COST-FREE AND THE COST IS RECORDED: ignoring connectivity, the best admissible 42-entry subset is {457, 482, 616} at 11 skyline buildings in three separate pieces, so contiguity gives up FOUR — twice what it cost wave w03 — and a 12-scoring combination exists only by also reusing the canary's cell 454, which precondition (b) excludes independently. THE 90 m THRESHOLD IS CARRIED FORWARD FROM WAVE w03 AND WAS CHECKED AGAINST THIS WAVE RATHER THAN REUSED: it selects 141 of 11,703 sourced heights (1.20%) across 56 of 249 cells, so it still separates towers from this wave's dominant pre-war apartment stock, and the ranking is INSENSITIVE to it — the same cell wins at 60, 75, 90, 100 and 120 m, which the optimum suite re-runs and asserts. THE TWO CURATED CELLS ARE ONE PIECE: cell 490's eastern bound is exactly cell 491's western bound over the identical latitude span. BOTH ALSO SHARE AN EDGE WITH MIDTOWN-CORE OWNERSHIP CELL manhattan-exterior-cell-w01-000106-15-9650-8962, so this subset abuts a promoted wave's owned ground; THAT CELL IS A TOMBSTONE IN THE MIDTOWN-CORE RELEASE, so the two waves' TEXTURED patches do not touch, and this statement says so rather than implying that they do." as const;

/** Cells the promoted subset must NOT silently inherit (ADR 0036 (b)). */
export const CENTRAL_UPPER_MANHATTAN_CANARY_RENDERABLE_CELL_IDS: readonly string[] = [
  "manhattan-exterior-cell-w04-000452-17-38598-35840",
  "manhattan-exterior-cell-w04-000453-17-38599-35840",
  "manhattan-exterior-cell-w04-000454-16-19298-17920",
];

export interface CentralUpperManhattanCurationCellInput {
  readonly cellId: string;
  readonly order: number;
  readonly bounds: { readonly west: number; readonly south: number; readonly east: number; readonly north: number };
  readonly buildingIds: readonly string[];
}

export interface CentralUpperManhattanCuratedSubset<T extends CentralUpperManhattanCurationCellInput> {
  readonly cells: readonly T[];
  readonly records: readonly CentralUpperManhattanCuratedCellRecord[];
  readonly ownedBuildingCount: number;
  readonly entryBudget: number;
  readonly spareEntries: number;
  readonly basis: typeof CENTRAL_UPPER_MANHATTAN_CURATION_BASIS;
}

/** Whether two cells share a boundary segment rather than only a corner. */
export function centralUpperManhattanCellsAdjacent(
  left: CentralUpperManhattanCurationCellInput["bounds"],
  right: CentralUpperManhattanCurationCellInput["bounds"],
): boolean {
  const epsilon = 1e-9;
  const longitudeOverlap = Math.min(left.east, right.east) - Math.max(left.west, right.west);
  const latitudeOverlap = Math.min(left.north, right.north) - Math.max(left.south, right.south);
  const sharesLatitudeEdge = Math.abs(left.north - right.south) < epsilon || Math.abs(right.north - left.south) < epsilon;
  const sharesLongitudeEdge = Math.abs(left.east - right.west) < epsilon || Math.abs(right.east - left.west) < epsilon;
  return (sharesLatitudeEdge && longitudeOverlap > epsilon) || (sharesLongitudeEdge && latitudeOverlap > epsilon);
}

/** Whether a cell set is one edge-connected piece. A single cell trivially is. */
export function centralUpperManhattanCellsConnected(cells: readonly CentralUpperManhattanCurationCellInput[]): boolean {
  if (cells.length === 0) return false;
  const reached = new Set<number>([0]);
  const frontier = [0];
  while (frontier.length > 0) {
    const index = frontier.pop()!;
    for (let other = 0; other < cells.length; other += 1) {
      if (reached.has(other) || !centralUpperManhattanCellsAdjacent(cells[index]!.bounds, cells[other]!.bounds)) continue;
      reached.add(other);
      frontier.push(other);
    }
  }
  return reached.size === cells.length;
}

/**
 * The entry budget for the PROMOTED subset.
 *
 * `maxCacheEntries - promotedAssetEntries` is the headroom the four promoted
 * waves leave; the decided share is what THIS wave may take out of it, and the
 * reservation is what it must leave behind. All four numbers are carried into the
 * committed record, so a reader can see which one bound and what was left for
 * whom.
 */
export interface CentralUpperManhattanCuratedEntryBudget {
  readonly maxCacheEntries: number;
  readonly promotedWaves: readonly { readonly releaseId: string; readonly assetEntries: number }[];
  readonly promotedWaveCount: number;
  readonly promotedAssetEntries: number;
  readonly alongsidePromotedHeadroom: number;
  /** ADR 0036 Decision 3, response 2, proportional to canonical buildings. */
  readonly splitResponse: typeof CENTRAL_UPPER_MANHATTAN_SPLIT_RESPONSE_TAKEN;
  readonly splitBasis: "proportional-to-canonical-buildings";
  readonly splitStatement: string;
  readonly curatedSubsetCeiling: number;
  /** Entries this split RESERVES for wave `w05` and denies this release. */
  readonly reservedForNextWaveEntries: number;
  readonly reservedForNextWaveId: string;
  readonly entryBudget: number;
}

export function centralUpperManhattanCuratedEntryBudget(input: {
  maxCacheEntries: number;
  promotedWaves: readonly { readonly releaseId: string; readonly assetEntries: number }[];
  curatedSubsetCeiling?: number;
  reservedForNextWaveEntries?: number;
  reservedForNextWaveId?: string;
}): CentralUpperManhattanCuratedEntryBudget {
  if (input.promotedWaves.length === 0) fail("no promoted wave was supplied; the occupancy statement would understate the promoted set.");
  for (const wave of input.promotedWaves) {
    if (wave.assetEntries <= 0) fail(`promoted wave ${wave.releaseId} declares ${wave.assetEntries} asset entries; a promoted wave that ships nothing is not a promoted wave.`);
  }
  if (new Set(input.promotedWaves.map((wave) => wave.releaseId)).size !== input.promotedWaves.length) {
    fail("a promoted release was counted twice; the occupancy statement would overstate the promoted set.");
  }
  const ceiling = input.curatedSubsetCeiling ?? CENTRAL_UPPER_MANHATTAN_CURATED_SUBSET_CEILING;
  const reserved = input.reservedForNextWaveEntries ?? CENTRAL_UPPER_MANHATTAN_W05_RESERVED_ENTRIES;
  const promotedAssetEntries = input.promotedWaves.reduce((total, wave) => total + wave.assetEntries, 0);
  const headroom = input.maxCacheEntries - promotedAssetEntries;
  if (headroom <= 0) {
    fail(`the ${input.promotedWaves.length} promoted waves occupy ${promotedAssetEntries} of ${input.maxCacheEntries} cache entries, so no renderable subset fits beside them; the cache ceiling must be resolved before this wave can promote (ADR 0036 precondition (a)).`);
  }
  if (ceiling <= 0) fail(`the curated subset ceiling must admit at least one entry, not ${ceiling}.`);
  // The split is a DECISION, and a decision whose two halves no longer fit the
  // headroom they were split out of is not the decision that was recorded.
  if (ceiling + reserved > headroom) {
    fail(`the decided split takes ${ceiling} entries for this wave and reserves ${reserved} for ${input.reservedForNextWaveId ?? "northern-manhattan"}, which is ${ceiling + reserved} against a ${headroom}-entry headroom; the split recorded in ADR 0036 no longer fits the cache it was split out of and must be re-decided rather than silently re-cut.`);
  }
  return {
    maxCacheEntries: input.maxCacheEntries,
    promotedWaves: input.promotedWaves.map((wave) => ({ ...wave })),
    promotedWaveCount: input.promotedWaves.length,
    promotedAssetEntries,
    alongsidePromotedHeadroom: headroom,
    splitResponse: CENTRAL_UPPER_MANHATTAN_SPLIT_RESPONSE_TAKEN,
    splitBasis: "proportional-to-canonical-buildings",
    splitStatement: CENTRAL_UPPER_MANHATTAN_SPLIT_STATEMENT,
    curatedSubsetCeiling: ceiling,
    reservedForNextWaveEntries: reserved,
    reservedForNextWaveId: input.reservedForNextWaveId ?? "northern-manhattan",
    entryBudget: Math.min(headroom, ceiling),
  };
}

/**
 * Resolves the curated list against the committed wave ledger's cells.
 *
 * Every failure below is a refusal, never a repair. A curated id that does not
 * resolve, a cell outside the stated envelope, a subset that is not one connected
 * piece, a cell that would overflow the entry budget, or a silent reuse of one of
 * the canary's cells stops the build rather than producing a smaller or different
 * subset than the one that was recorded and reviewed.
 *
 * Cells are admitted WHOLE, for the reason the canary gave: a cell loads
 * atomically, so a partially renderable cell is a cell that can never finish
 * loading.
 */
export function centralUpperManhattanCuratedCells<T extends CentralUpperManhattanCurationCellInput>(
  cells: readonly T[],
  entryBudget: number,
): CentralUpperManhattanCuratedSubset<T> {
  const byId = new Map(cells.map((cell) => [cell.cellId, cell]));
  const chosen: T[] = [];
  let owned = 0;
  for (const record of CENTRAL_UPPER_MANHATTAN_CURATED_CELLS) {
    const cell = byId.get(record.cellId);
    if (!cell) fail(`curated cell ${record.cellId} is not owned by this wave's ledger (${EXTERIOR_WAVE_LEDGER_RELEASE_ID}); the curation names a cell that does not exist.`);
    // The subset ledger RENUMBERS its cells contiguously from zero, so a cell's
    // `order` here is its position in wave w04 and not the full-city order the
    // curation quotes. The full-city order is checked against the one place it
    // survives verbatim — the cell id, which the ledger mints as
    // `...-w04-<parentOrder padded to six digits>-<tile>`.
    const parentOrderInId = /-w04-(\d{6})-/u.exec(record.cellId);
    if (!parentOrderInId || Number(parentOrderInId[1]) !== record.parentOrder) {
      fail(`curated cell ${record.cellId} does not carry the full-city order ${record.parentOrder} the curation recorded; the ledger this build reads is not the ledger the curation was written against.`);
    }
    const envelope = CENTRAL_UPPER_MANHATTAN_CANDIDATE_ENVELOPE;
    const inside = cell.bounds.west >= envelope.west && cell.bounds.east <= envelope.east
      && cell.bounds.south >= envelope.south && cell.bounds.north <= envelope.north;
    if (!inside) {
      fail(`curated cell ${record.cellId} has bounds outside the stated candidate envelope; the envelope is this wave's own bounding box, so a cell outside it is not a cell of this wave.`);
    }
    if (CENTRAL_UPPER_MANHATTAN_CANARY_RENDERABLE_CELL_IDS.includes(record.cellId)) {
      fail(`curated cell ${record.cellId} is one of the canary's order-derived renderable cells; ADR 0036 precondition (b) excludes reusing them.`);
    }
    chosen.push(cell);
    owned += cell.buildingIds.length;
  }
  if (chosen.length === 0) fail("the curated list is empty; a promoted wave with no renderable cell would ship as pure tombstones.");
  if (!centralUpperManhattanCellsConnected(chosen)) {
    fail("the curated cells are not one edge-connected piece; edge-contiguity is a PRECONDITION of this curation, not a tie-break, and a subset that renders as scattered textured islands would falsify the statement this release commits.");
  }
  if (owned > entryBudget) {
    fail(`the curated subset owns ${owned} buildings, above the ${entryBudget}-entry share ADR 0036's headroom split allots this wave; taking more would consume entries this promotion reserved for wave w05, which is precisely the decision response 2 was chosen to avoid.`);
  }
  return {
    cells: chosen,
    records: CENTRAL_UPPER_MANHATTAN_CURATED_CELLS,
    ownedBuildingCount: owned,
    entryBudget,
    spareEntries: entryBudget - owned,
    basis: CENTRAL_UPPER_MANHATTAN_CURATION_BASIS,
  };
}

export interface CentralUpperManhattanCuratedRefusalCensus {
  readonly ownedBuildingCount: number;
  readonly materializedBuildingCount: number;
  readonly refusedBuildingCount: number;
  readonly localRefusalRate: number;
  readonly waveRefusalRate: number;
  readonly maxRefusalRate: number;
  /** True when the local rate is ABOVE the wave rate, which it is here. */
  readonly localRateExceedsWaveRate: boolean;
  readonly ok: boolean;
}

/**
 * The local refusal rate, recomputed from a shipped census rather than recalled.
 *
 * This is the gate for ADR 0036 precondition (c): the promoted subset's local
 * rate must be computed from this run's own shipped census and justified against
 * the 1.52% wave rate with no tolerance moved to reach it. `localRateExceedsWaveRate`
 * is carried explicitly because for this subset it is TRUE, and a record that
 * reported only the ceiling result would let a reader assume the curated ground
 * was at least as clean as the wave.
 */
export function centralUpperManhattanCuratedRefusalCensus(input: {
  ownedBuildingCount: number;
  materializedBuildingCount: number;
  refusedBuildingCount: number;
}): CentralUpperManhattanCuratedRefusalCensus {
  if (input.ownedBuildingCount <= 0) fail("a refusal rate over zero owned buildings is not a rate.");
  if (input.materializedBuildingCount + input.refusedBuildingCount !== input.ownedBuildingCount) {
    fail(`the census does not account for every owned building: ${input.materializedBuildingCount} materialized plus ${input.refusedBuildingCount} refused is not ${input.ownedBuildingCount} owned.`);
  }
  const localRefusalRate = input.refusedBuildingCount / input.ownedBuildingCount;
  return {
    ownedBuildingCount: input.ownedBuildingCount,
    materializedBuildingCount: input.materializedBuildingCount,
    refusedBuildingCount: input.refusedBuildingCount,
    localRefusalRate,
    waveRefusalRate: CENTRAL_UPPER_MANHATTAN_WAVE_REFUSAL_RATE,
    maxRefusalRate: CENTRAL_UPPER_MANHATTAN_CURATED_MAX_REFUSAL_RATE,
    localRateExceedsWaveRate: localRefusalRate > CENTRAL_UPPER_MANHATTAN_WAVE_REFUSAL_RATE,
    ok: localRefusalRate <= CENTRAL_UPPER_MANHATTAN_CURATED_MAX_REFUSAL_RATE,
  };
}

/**
 * The VOLUME-IDENTITY MARGIN of the curated subset, named by ADR 0036 as a
 * precondition of its own.
 *
 * ADR 0036 reported the wave's worst mesh-versus-analytic volume deviation at
 * 0.988 of the tolerance — a check that passed but did not pass comfortably — and
 * required T020 to report the CURATED SUBSET's own worst margin rather than
 * inheriting the wave figure. The two are different measurements over different
 * sets, and the subset's is the one that describes the bytes this release ships.
 */
export interface CentralUpperManhattanCuratedVolumeMargin {
  readonly buildingsChecked: number;
  readonly buildingsRejected: number;
  readonly worstVolumeDeviation: number;
  readonly tolerance: number;
  readonly worstDeviationAsFractionOfTolerance: number;
  readonly waveWorstDeviationAsFractionOfTolerance: number;
  /** True when the SHIPPED subset's margin is better than the wave's. */
  readonly betterThanWave: boolean;
  readonly ok: boolean;
}

/** The wave-scale figure ADR 0036 recorded, for comparison and nothing else. */
export const CENTRAL_UPPER_MANHATTAN_WAVE_WORST_VOLUME_FRACTION = 0.9882970279185347;

export function centralUpperManhattanCuratedVolumeMargin(input: {
  buildingsChecked: number;
  buildingsRejected: number;
  worstVolumeDeviation: number;
  tolerance: number;
}): CentralUpperManhattanCuratedVolumeMargin {
  if (input.buildingsChecked <= 0) fail("a volume-identity margin over zero checked buildings is not a measurement.");
  if (input.tolerance <= 0) fail("the volume-identity tolerance must be positive.");
  const fraction = input.worstVolumeDeviation / input.tolerance;
  return {
    buildingsChecked: input.buildingsChecked,
    buildingsRejected: input.buildingsRejected,
    worstVolumeDeviation: input.worstVolumeDeviation,
    tolerance: input.tolerance,
    worstDeviationAsFractionOfTolerance: fraction,
    waveWorstDeviationAsFractionOfTolerance: CENTRAL_UPPER_MANHATTAN_WAVE_WORST_VOLUME_FRACTION,
    betterThanWave: fraction < CENTRAL_UPPER_MANHATTAN_WAVE_WORST_VOLUME_FRACTION,
    ok: input.buildingsRejected === 0 && fraction < 1,
  };
}
