/**
 * The CURATED renderable subset of wave `w05`, and the record of why it is that
 * cell.
 *
 * ADR 0037 precondition (b) forbids promotion from inheriting this wave's canary
 * subset. That subset is the ledger-order walk — cell 701 alone, the wave's first
 * under a 100-entry ceiling — which is the wave's FIRST ground rather than its
 * best, because the ledger's `order` field is documented as global visual-priority
 * order and is in fact a south-to-north tile-row traversal. Precondition (b) also
 * requires the promoted subset to be an explicit list with a stated basis, its
 * optimality claim to be RE-ENUMERABLE from committed bytes on every test run, its
 * refusal census to reach the committed inventory only through a fresh `gates`
 * receipt, and the list to be covered by the stage fingerprint.
 *
 * ## The budget is an INHERITED RESERVATION, not a share this task may cut
 *
 * This is what differs most from wave `w04`'s curation and it cannot be inherited
 * by silence. T020 took ADR 0036 Decision 3's response 2: it split the 78-entry
 * headroom that stood beside the four promoted waves, took 42 for wave `w04`, and
 * RESERVED 36 for this wave in its own committed `payload-inventory.json`. So this
 * promotion opens no split. It CONSUMES a reservation another release already
 * made, and `northernManhattanCuratedEntryBudget` reads the two halves back out of
 * those bytes rather than retyping either.
 *
 * TWO NUMBERS DIFFER AND BOTH ARE RECORDED. 38 entries are actually free — 512
 * minus the 474 the five promoted waves ship — while 36 were promised. The 2-entry
 * surplus is what wave `w04`'s promotion did not spend of its own 42-entry share.
 * This release is bound by the 36 it was PROMISED rather than by the 38 that happen
 * to be free, and the surplus is left where it is. IT WOULD HAVE BOUGHT NOTHING
 * HERE IN ANY CASE, and that is measured rather than assumed: no cell of this wave
 * owning between 37 and 38 buildings carries a single building at the stated
 * skyline threshold, so raising the budget to the free 38 would not have changed
 * which cell this rule selects. The reservation is honoured because it is a
 * recorded decision, not because the alternative was tempting.
 *
 * 36 IS BELOW THIS WAVE'S MEDIAN CELL OF 55, which is the largest median of the
 * six partitions. Only 50 of the 182 cells fit the reservation whole, and the
 * promoted subset is ONE of them.
 *
 * ## The decision rule, stated exactly, in the order it is applied
 *
 *   1. **Edge-contiguity is a PRECONDITION, not a tie-break.** A promoted subset
 *      must render as one continuous piece of city; scattered textured islands
 *      with untextured ground between them read as a rendering fault rather than
 *      as a skyline. WHAT IT COSTS HERE IS NOTHING ON SCORE AND IS STATED AS SUCH:
 *      dropping connectivity entirely, the best 36-entry subset still scores 1 —
 *      it is `{711, 727, 836, 838, 850}` at 35 owned, the SAME single tall
 *      building spread across five separate pieces. Contiguity gave up FOUR
 *      skyline buildings for wave `w04` and TWO for `w03`; here it gives up none
 *      and decides only the shape, which is reported rather than dressed up as a
 *      sacrifice.
 *   2. **Fit the 36-entry inherited reservation.** A precondition, not a
 *      preference, and the only one of the two that costs this promotion anything.
 *   3. **Maximize skyline value** — the count of owned buildings whose SOURCED
 *      height reaches `NORTHERN_MANHATTAN_SKYLINE_HEIGHT_METERS` — under 1 and 2.
 *      The maximum is 1, and exactly one connected admissible subset reaches it:
 *      `{727}` at 24 owned.
 *   4. **Tie-break: at equal skyline value, admit MORE WHOLE CELLS.** NEVER
 *      REACHED, because key 3 already leaves one candidate. It is stated because
 *      the rule is the `w04` rule applied unchanged, and a key that is silently
 *      dropped is a rule that was edited.
 *   5. **Total-order fallback: lexicographic on the parent-order sequence.** It
 *      lives in `northern-manhattan-curation-optimum.test.ts`'s `ruleWinner` and
 *      exists only so the rule is a function rather than a relation. That suite
 *      asserts it is NOT reached at the stated threshold, and — unlike wave
 *      `w04`, which could say it was never reached at all — shows the two lower
 *      thresholds where it would be.
 *
 * THE SUBSET IS ONE CELL, AND THAT IS A CONSEQUENCE OF THE RESERVATION MEETING
 * THIS WAVE'S CELL SIZES RATHER THAN A PREFERENCE. Cell 727 owns 24 of the 36
 * reserved entries and every one of its four edge-neighbours owns 40, 41, 53 and
 * 89 buildings, so no second cell can join it without breaking the reservation.
 * TWELVE OF THE 36 RESERVED ENTRIES ARE THEREFORE LEFT UNSPENT. The only way to
 * spend them is a second, non-adjacent island, which key 1 refuses; that is the
 * whole of the reason and it is recorded rather than left to be inferred from a
 * spare count.
 *
 * ## The 90 m threshold was CHECKED against this wave, and the answer is WEAKER
 * ## than wave `w04`'s
 *
 * ADR 0036 precondition (b) established that 90 m is wave `w03`'s judgement rather
 * than a discovery, and that each wave must state whether it is right rather than
 * reusing the constant because it exists. Wave `w04` could answer that the ranking
 * did not depend on the threshold at all — the same cell won at 60, 75, 90, 100
 * and 120 m. THAT ANSWER IS NOT AVAILABLE HERE AND IT IS NOT BORROWED:
 *
 *  - **It still discriminates, thinly.** 19 of this wave's 10,214 sourced heights
 *    reach 90 m — 0.19%, against 1.20% for wave `w04` — spread over 9 of its 182
 *    cells, and over exactly ONE of the 50 cells that fit the reservation. Northern
 *    Manhattan is genuinely lower-rise: the tallest sourced structure in the whole
 *    wave is 123.1 m, where wave `w04` had 219.2 m in a single admissible cell.
 *  - **The ranking DOES depend on it, and every other answer is named.** Under the
 *    same rule this wave would promote `{714, 715}` at 30 m, `{852}` at 45 m,
 *    `{707}` at 60 and 75 m, `{727}` at 90 and 100 m, and nothing at all at
 *    120 m. `northern-manhattan-curation-optimum.test.ts` re-runs the enumeration
 *    at all seven recorded thresholds and pins each of those winners, so the
 *    sensitivity is a checked fact rather than a caveat.
 *  - **KEY 5 IS REACHED AT TWO OF THE SEVEN, WHICH WAVE `w04` COULD SAY OF NONE,
 *    and it is recorded rather than omitted.** At 60 m cells 707 and 782 both
 *    carry two qualifying buildings and both are single cells, so keys 3 and 4
 *    leave a genuine two-way tie that only the lexicographic fallback breaks; at
 *    120 m every admissible subset scores zero. Neither is at the stated
 *    threshold — at 90 m key 3 alone leaves one candidate — but a fallback that
 *    can decide somewhere has to be shown deciding, or "never reached" would be
 *    an untested claim.
 *  - **THE THRESHOLD WAS NOT MOVED AFTER THE ANSWER WAS KNOWN.** That is the point
 *    of recording the sensitivity instead of lowering the bar to where the rule
 *    ranks more comfortably: choosing a threshold because of which cell it selects
 *    is the same defect as moving a tolerance to pass a gate, and it would be
 *    harder to see. 90 m is carried forward unchanged from the two waves before it.
 *  - **A THRESHOLD-FREE KEY AGREES, and it is reported because the primary key is
 *    thin.** Cell 727 also carries the TALLEST sourced structure of any cell that
 *    fits the reservation — 101.5 m against 79.8 m for the next — so the selected
 *    cell is the maximum on a second criterion that has no threshold in it at all.
 *    That is corroboration, not the rule: the rule is the one stated above, and
 *    this agreement is recorded so a reader can see the choice does not rest on a
 *    single building clearing a single bar by 11.5 m.
 */

import { EXTERIOR_WAVE_LEDGER_RELEASE_ID } from "./exterior-wave-ledger.ts";
import type { NorthernManhattanReservation } from "./northern-manhattan-release.ts";

function fail(message: string): never {
  throw new Error(`Northern-Manhattan curated subset: ${message}`);
}

/**
 * The candidate envelope, in WGS84 degrees: the WHOLE WAVE.
 *
 * This rectangle is the bounding box of all 182 owned cells, so the enumeration
 * behind the curated list ranges over EVERY cell of the wave and the containment
 * gate below is satisfied by construction — the same choice wave `w04` made and
 * for the same reason: a maximum over a band drawn after the answer was known is
 * a maximum over whatever the band happened to contain.
 */
export const NORTHERN_MANHATTAN_CANDIDATE_ENVELOPE = {
  west: -73.98193359375,
  south: 40.80322265625,
  east: -73.89404296875,
  north: 40.880126953125,
} as const;

/**
 * The sourced height, in metres, at or above which a building counts toward this
 * subset's skyline score.
 *
 * 90 m, carried forward unchanged and CHECKED against this wave rather than
 * assumed — see the module docstring, which records that the ranking DOES depend
 * on it here and names what every other threshold would have chosen. Every height
 * it is applied to is the SOURCED `heightMeters` of the pinned
 * `manhattan-citywide-20260804` base.
 */
export const NORTHERN_MANHATTAN_SKYLINE_HEIGHT_METERS = 90;

/**
 * Every threshold the committed skyline census profiles, and therefore every
 * threshold the optimum suite can re-run the whole rule at.
 *
 * SEVEN RATHER THAN THE FIVE WAVE `w04` RECORDED, and the two extra ones are the
 * low end. 45 m and 30 m are below anything the earlier waves would have called a
 * tower, and they are here precisely because this wave's stock is lower: without
 * them the sensitivity finding would stop at 60 m and a reader could not see that
 * the winner keeps moving all the way down.
 */
export const NORTHERN_MANHATTAN_SKYLINE_THRESHOLDS_METERS: readonly number[] = [30, 45, 60, 75, 90, 100, 120];

/**
 * The reservation T020 recorded, as a number this module can be read against.
 *
 * It is NOT what the entry budget is derived from: `northernManhattanCuratedEntryBudget`
 * takes the reservation that was READ from the promoted predecessor's committed
 * bytes and refuses one that disagrees with this constant, so a predecessor
 * re-emitted with a different reservation fails the build instead of quietly
 * re-sizing this promotion.
 */
export const NORTHERN_MANHATTAN_RESERVED_ENTRIES = 36;

/** The release whose committed bytes made that reservation. */
export const NORTHERN_MANHATTAN_RESERVATION_SOURCE_RELEASE_ID = "manhattan-central-upper-manhattan-cells-20260812-p1" as const;

/**
 * The reservation decision as the committed record states it, in words.
 *
 * Carried into this release's own `payload-inventory.json` so a reader holding the
 * bytes learns what was inherited, what it cost, and what the ledger-wide occupancy
 * end-state is, without having to find an ADR.
 */
export const NORTHERN_MANHATTAN_RESERVATION_STATEMENT =
  "THIS PROMOTION OPENS NO SPLIT; IT CONSUMES ONE. ADR 0036 Decision 3 named three admissible responses to a 78-entry headroom two unpromoted waves had to share, and T020 took RESPONSE 2 — the two remaining waves split it at sub-median scale — proportional to canonical buildings: 78 x 11,721 / (11,721 + 10,230) = 41.65, so wave w04 took 42 entries and wave w05 was RESERVED the remaining 36. That reservation is recorded in manhattan-central-upper-manhattan-cells-20260812-p1's own committed payload-inventory.json, and this release reads both halves back out of those bytes and requires them to reconstitute the 78-entry headroom they were split out of; a predecessor re-emitted with a different share, a different headroom, or a reservation edited on its own fails this build rather than quietly re-sizing this promotion. THE RESERVATION IS CONSUMED AND RECORDED AS CONSUMED. The entry budget applied here is 36, the promoted subset ships 24 assets, and 12 of the reserved entries are left unspent. TWO NUMBERS DIFFER AND BOTH ARE RECORDED: 38 entries are actually free — 512 minus the 474 the five promoted waves ship — while 36 were promised, and the 2-entry surplus is what wave w04's promotion did not spend of its own 42-entry share. This release is bound by the 36 it was PROMISED rather than by the 38 that happen to be free, and it does not re-open the split to take them. THE SURPLUS WOULD HAVE BOUGHT NOTHING: no cell of this wave owning 37 or 38 buildings carries a single building at the 90 m skyline threshold, so a 38-entry budget selects the same cell as a 36-entry one. THE 12 UNSPENT ENTRIES ARE NOT AN OVERSIGHT. Cell 727 owns 24 and its four edge-neighbours own 40, 41, 53 and 89, so no second cell can join it inside the reservation; the only way to spend the remainder is a second, non-adjacent island, and edge-contiguity is a precondition of this curation rather than a tie-break. THE LEDGER-WIDE END STATE, stated in full because this is the LAST wave: the six promoted waves occupy 28 + 156 + 71 + 179 + 40 + 24 = 498 of 512 exterior cache entries, leaving 14 entries of headroom and no unpromoted wave to reserve them for. The cache cap is UNCHANGED at 512 entries and 256 MiB, and EXTERIOR_RUNTIME_BUDGETS is not edited by this release. Every occupancy figure here is a count of shipped GLB artifacts on disk, on the accounting T020 adopted when it considered and rejected ADR 0034's response 3." as const;

/**
 * The alternatives this curation REFUSED, named so the tradeoff is a record rather
 * than an omission.
 *
 * `northern-manhattan-curation-optimum.test.ts` recomputes each entry's score,
 * owned count, connectedness and budget fit from the committed skyline census, so
 * a claim here cannot drift from the data it is about.
 *
 * UNLIKE WAVE `w04`'S LIST, NOT EVERY ENTRY HERE FITS THE BUDGET. That wave could
 * say its refusals were all about shape or reuse because the entry share admitted
 * every alternative it named; this wave's binding constraint is the reservation
 * itself, and the alternative it costs most is a cell that does not fit at all. So
 * each entry carries `withinEntryBudget` explicitly and the suite requires the
 * stated `refusedBy` to match the property that actually refuses it.
 */
export const NORTHERN_MANHATTAN_REJECTED_ALTERNATIVES: readonly {
  readonly parentOrders: readonly number[];
  readonly skylineBuildingCount: number;
  readonly ownedBuildingCount: number;
  readonly connected: boolean;
  readonly withinEntryBudget: boolean;
  readonly refusedBy: "edge-contiguity" | "reservation-entry-budget" | "canary-subset-reuse" | "skyline-value";
  readonly reason: string;
}[] = [
  {
    parentOrders: [711, 727, 836, 838, 850],
    skylineBuildingCount: 1,
    ownedBuildingCount: 35,
    connected: false,
    withinEntryBudget: true,
    refusedBy: "edge-contiguity",
    reason: "What the rule selects with the contiguity precondition DROPPED, and therefore the exact price of that precondition on this wave: the same score of 1, on 35 of the 36 reserved entries, in FIVE separate pieces scattered from central Harlem to Washington Heights. It contains the curated cell and four small cells that contribute nothing to the score and exist in it only to satisfy key 4, which ranks tied maxima by whole-cell count. CONTIGUITY COSTS NOTHING ON SCORE HERE — four skyline buildings for wave w04 and two for w03, none for this one — and that is recorded rather than presented as a sacrifice. What it decides is the shape, and promoting five textured islands in an untextured city would read as five rendering faults rather than as one promoted piece of ground.",
  },
  {
    parentOrders: [778],
    skylineBuildingCount: 5,
    ownedBuildingCount: 79,
    connected: true,
    withinEntryBudget: false,
    refusedBy: "reservation-entry-budget",
    reason: "THE WAVE'S BEST SKYLINE CELL, AND THE TRUE COST OF THE INHERITED RESERVATION. It carries FIVE owned buildings at a sourced height of 90 m or more — five times the curated cell's one — and every one of them is at 102.4 m. It is refused for one reason only: it owns 79 buildings against a 36-entry reservation, so admitting it would consume more than twice what T020's split promised this wave, and a promotion that needs more than its reservation must re-open that split explicitly rather than quietly outgrow it. This entry is why the reservation and not contiguity is the constraint that shapes this promotion, and it is stated at full strength: the reservation gives up FOUR skyline buildings.",
  },
  {
    parentOrders: [701],
    skylineBuildingCount: 1,
    ownedBuildingCount: 86,
    connected: true,
    withinEntryBudget: false,
    refusedBy: "canary-subset-reuse",
    reason: "The T021 canary's single order-derived renderable cell, and it is inadmissible TWICE OVER: ADR 0037 precondition (b) forbids this promotion from inheriting the canary's subset, and it owns 86 buildings against a 36-entry reservation, so it could not have been promoted even if inheriting it were permitted. It is recorded with both reasons because attributing its refusal to either one alone would overstate what that constraint costs — it ties the curated cell's score of 1 and carries the wave's second-tallest sourced structure at 118.0 m, so a reader who saw only the score would ask why the canary's ground was not simply kept.",
  },
  {
    parentOrders: [707],
    skylineBuildingCount: 0,
    ownedBuildingCount: 11,
    connected: true,
    withinEntryBudget: true,
    refusedBy: "skyline-value",
    reason: "THE CELL THIS PROMOTION WOULD HAVE SHIPPED AT A LOWER THRESHOLD, named because this wave's ranking depends on the threshold and wave w04's did not. It owns two buildings at 79.8 m and 77.3 m, which is two at 60 m and two at 75 m against the curated cell's one at each — so under the identical rule with the bar at 75 m it wins outright, at 60 m it ties cell 782 and wins only on the lexicographic fallback, and at 45 m cell 852 wins instead. At the stated 90 m it scores zero, because neither of its two buildings reaches the bar. It is refused by key 3 at the threshold this curation states, and the threshold was NOT moved after the answer was known; the sensitivity is recorded here and re-enumerated at all seven thresholds by the optimum suite rather than smoothed over.",
  },
];

export interface NorthernManhattanCuratedCellRecord {
  readonly cellId: string;
  /** Order this cell carries in the committed full-city wave ledger. */
  readonly parentOrder: number;
  /** Why this cell is in the promoted subset. Curation, stated as curation. */
  readonly rationale: string;
}

/**
 * The curated cells.
 *
 * ONE CELL, and the module docstring says why: the reservation is 36 entries, this
 * cell owns 24, and its four edge-neighbours own 40, 41, 53 and 89, so no second
 * cell fits beside it.
 *
 * Heights quoted in the rationale are the SOURCED `heightMeters` of the pinned
 * `manhattan-citywide-20260804` base, not a claim about any named building. The NYC
 * OTI footprint dataset carries no building names — its `name` field is the literal
 * string "Building <id>" — so this rationale identifies no building by name and
 * none is implied. The place names are geographic: the cell bounds provably cover
 * that ground.
 */
export const NORTHERN_MANHATTAN_CURATED_CELLS: readonly NorthernManhattanCuratedCellRecord[] = [
  {
    cellId: "manhattan-exterior-cell-w05-000727-17-38611-35819",
    parentOrder: 727,
    rationale:
      "The one cell of this wave that fits the inherited 36-entry reservation AND carries a building at the stated 90 m skyline threshold, which is the whole of why this subset is this cell. Its bounds run from -73.95172 to -73.94897 east and 40.80872 to 40.81009 north — a roughly 231-metre by 152-metre block band in central Harlem covering the West 125th Street corridor between approximately Frederick Douglass Boulevard and Adam Clayton Powell Jr. Boulevard. It owns 24 buildings and all 24 carry a sourced height. ITS TALL STRUCTURE IS ALSO THE TALLEST IN ANY ADMISSIBLE CELL: 101.5 m, against 79.8 m for the next-tallest cell that fits the reservation, so the selection is the maximum on a threshold-free criterion as well as on the stated one. It is NOT a tower district and the record does not pretend otherwise: the same cell carries three buildings at 30 m or more and two at 45 m, so the tall structure stands over four- to eight-storey Harlem stock rather than inside a wall of towers. That is what northern Manhattan is, and promoting a curated subset of it should look like it. 24 owned, 24 materialize, NONE refused.",
  },
];

/**
 * What the curation is, stated so a reader does not have to infer it.
 *
 * Carried into the release record and asserted by test, because ADR 0037 asks
 * promotion to record how it chose, and an unrecorded choice is the failure mode
 * the precondition exists to prevent.
 */
export const NORTHERN_MANHATTAN_CURATION_BASIS = "curated-list" as const;

export const NORTHERN_MANHATTAN_CURATION_STATEMENT =
  "The promoted renderable subset of wave w05 is an EXPLICIT CURATED LIST of one ownership cell, not a re-derivation of the wave ledger's cell order. The canary's order-derived cell 701 is the wave's FIRST ground rather than its best, and ADR 0037 precondition (b) forbids inheriting it; it does not appear here. THE DECISION RULE IS LEXICOGRAPHIC AND IS STATED IN THE ORDER IT WAS APPLIED. (1) EDGE-CONTIGUITY IS A PRECONDITION, not a tie-break: a promoted subset must render as one continuous piece of city rather than as scattered textured islands with untextured ground between them. (2) FIT THE 36-ENTRY INHERITED RESERVATION, which is the w05 half of ADR 0036's 78-entry split, recorded by T020 in its own committed bytes and read back out of them rather than retyped. (3) MAXIMIZE SKYLINE VALUE — the count of owned buildings whose sourced height reaches 90 m — subject to those two. (4) TIE-BREAK ON WHOLE CELLS: at equal skyline value, admit MORE WHOLE CELLS. Key 4 is NEVER REACHED here, because key 3 already leaves exactly one candidate, and it is stated rather than dropped because this is the wave w04 rule applied unchanged. THE ENUMERATION IS OVER THE WHOLE WAVE: all 182 owned cells, not a band drawn after the answer was known. Under that rule the maximum reachable skyline score is 1 AT ANY SIZE, and exactly one connected admissible subset reaches it: {727} at 24 owned. WHAT EACH PRECONDITION COSTS IS RECORDED SEPARATELY AND THEY ARE NOT THE SAME SIZE. Contiguity costs NOTHING on score — dropping it, the best 36-entry subset is {711, 727, 836, 838, 850} at 35 owned, the same score of 1 in five separate pieces — against four skyline buildings for wave w04 and two for w03. THE RESERVATION IS WHAT COSTS: the wave's best skyline cell, 778, carries FIVE buildings at 90 m or more, all of them at 102.4 m, and is refused solely because it owns 79 buildings against a 36-entry reservation. THE 90 m THRESHOLD IS CARRIED FORWARD UNCHANGED AND WAS CHECKED AGAINST THIS WAVE, AND THE ANSWER IS WEAKER THAN WAVE w04'S. It selects 19 of 10,214 sourced heights (0.19%, against 1.20% for wave w04) across 9 of 182 cells and exactly ONE of the 50 cells that fit the reservation; northern Manhattan is genuinely lower-rise, its tallest sourced structure being 123.1 m. THE RANKING DOES DEPEND ON THE THRESHOLD HERE, WHICH WAVE w04 COULD SAY IT DID NOT: under the same rule this wave would promote {714, 715} at 30 m, {852} at 45 m, {707} at 60 and 75 m, {727} at 90 and 100 m, and nothing at all at 120 m. THE ARBITRARY FIFTH KEY IS REACHED AT TWO OF THE SEVEN THRESHOLDS AND THAT IS RECORDED RATHER THAN OMITTED: at 60 m cells 707 and 782 tie on both scoring keys and only the lexicographic fallback separates them, and at 120 m nothing scores at all. At the STATED 90 m threshold key 3 alone leaves one candidate, so neither key 4 nor key 5 decides this promotion. THE THRESHOLD WAS NOT MOVED AFTER THE ANSWER WAS KNOWN — choosing a threshold for the cell it selects is the same defect as moving a tolerance to pass a gate — and the sensitivity is recorded and re-enumerated at all seven thresholds instead. A THRESHOLD-FREE KEY AGREES: cell 727 also carries the tallest sourced structure of any cell that fits the reservation, 101.5 m against 79.8 m. THE SUBSET IS ONE CELL AND 12 OF THE 36 RESERVED ENTRIES ARE LEFT UNSPENT, because cell 727's four edge-neighbours own 40, 41, 53 and 89 buildings and none of them fits beside it; the only way to spend the remainder is a second, non-adjacent island, which precondition (1) refuses." as const;

/** Cells the promoted subset must NOT silently inherit (ADR 0037 (b)). */
export const NORTHERN_MANHATTAN_CANARY_RENDERABLE_CELL_IDS: readonly string[] = [
  "manhattan-exterior-cell-w05-000701-15-9651-8954",
];

export interface NorthernManhattanCurationCellInput {
  readonly cellId: string;
  readonly order: number;
  readonly bounds: { readonly west: number; readonly south: number; readonly east: number; readonly north: number };
  readonly buildingIds: readonly string[];
}

export interface NorthernManhattanCuratedSubset<T extends NorthernManhattanCurationCellInput> {
  readonly cells: readonly T[];
  readonly records: readonly NorthernManhattanCuratedCellRecord[];
  readonly ownedBuildingCount: number;
  readonly entryBudget: number;
  readonly spareEntries: number;
  readonly basis: typeof NORTHERN_MANHATTAN_CURATION_BASIS;
}

/** Whether two cells share a boundary segment rather than only a corner. */
export function northernManhattanCellsAdjacent(
  left: NorthernManhattanCurationCellInput["bounds"],
  right: NorthernManhattanCurationCellInput["bounds"],
): boolean {
  const epsilon = 1e-9;
  const longitudeOverlap = Math.min(left.east, right.east) - Math.max(left.west, right.west);
  const latitudeOverlap = Math.min(left.north, right.north) - Math.max(left.south, right.south);
  const sharesLatitudeEdge = Math.abs(left.north - right.south) < epsilon || Math.abs(right.north - left.south) < epsilon;
  const sharesLongitudeEdge = Math.abs(left.east - right.west) < epsilon || Math.abs(right.east - left.west) < epsilon;
  return (sharesLatitudeEdge && longitudeOverlap > epsilon) || (sharesLongitudeEdge && latitudeOverlap > epsilon);
}

/** Whether a cell set is one edge-connected piece. A single cell trivially is. */
export function northernManhattanCellsConnected(cells: readonly NorthernManhattanCurationCellInput[]): boolean {
  if (cells.length === 0) return false;
  const reached = new Set<number>([0]);
  const frontier = [0];
  while (frontier.length > 0) {
    const index = frontier.pop()!;
    for (let other = 0; other < cells.length; other += 1) {
      if (reached.has(other) || !northernManhattanCellsAdjacent(cells[index]!.bounds, cells[other]!.bounds)) continue;
      reached.add(other);
      frontier.push(other);
    }
  }
  return reached.size === cells.length;
}

/**
 * The entry budget for the PROMOTED subset, and the ledger-wide occupancy
 * end-state this promotion produces.
 *
 * `maxCacheEntries - promotedAssetEntries` is the headroom the five promoted waves
 * leave; the RESERVATION is what this wave was promised out of it, and the two are
 * not the same number. Both are carried into the committed record, so a reader can
 * see which one bound and what the surplus was.
 */
export interface NorthernManhattanCuratedEntryBudget {
  readonly maxCacheEntries: number;
  readonly promotedWaves: readonly { readonly releaseId: string; readonly assetEntries: number }[];
  readonly promotedWaveCount: number;
  readonly promotedAssetEntries: number;
  readonly alongsidePromotedHeadroom: number;
  /** The reservation, as read from the promoted predecessor's committed bytes. */
  readonly reservation: NorthernManhattanReservation;
  readonly reservationStatement: string;
  /** `alongsidePromotedHeadroom - reservation.entries`. Free but not promised. */
  readonly headroomExceedsReservationBy: number;
  /** True: this promotion spends the reservation rather than re-opening the split. */
  readonly reservationConsumed: true;
  /**
   * THE LAST-WAVE STATEMENT. `true` only when this wave is the sole remaining
   * unpromoted wave of the declared plan, which is what makes the reservation the
   * whole story rather than a share of a contested headroom.
   */
  readonly isLastUnpromotedWave: boolean;
  readonly remainingUnpromotedWaveIds: readonly string[];
  /** Promoted waves once this release joins them. Six, for a six-wave ledger. */
  readonly promotedWaveCountAfterThisRelease: number;
  readonly completesLedgerCoverage: boolean;
  readonly entryBudget: number;
}

export function northernManhattanCuratedEntryBudget(input: {
  maxCacheEntries: number;
  promotedWaves: readonly { readonly releaseId: string; readonly assetEntries: number }[];
  remainingUnpromotedWaveIds: readonly string[];
  reservation: NorthernManhattanReservation;
  declaredWaveCount: number;
}): NorthernManhattanCuratedEntryBudget {
  if (input.promotedWaves.length === 0) fail("no promoted wave was supplied; the occupancy statement would understate the promoted set.");
  for (const wave of input.promotedWaves) {
    if (wave.assetEntries <= 0) fail(`promoted wave ${wave.releaseId} declares ${wave.assetEntries} asset entries; a promoted wave that ships nothing is not a promoted wave.`);
  }
  if (new Set(input.promotedWaves.map((wave) => wave.releaseId)).size !== input.promotedWaves.length) {
    fail("a promoted release was counted twice; the occupancy statement would overstate the promoted set.");
  }
  if (input.reservation.fromReleaseId !== NORTHERN_MANHATTAN_RESERVATION_SOURCE_RELEASE_ID) {
    fail(`the reservation was read from ${input.reservation.fromReleaseId}, not from ${NORTHERN_MANHATTAN_RESERVATION_SOURCE_RELEASE_ID}; only the promoted predecessor's own committed bytes bind this promotion.`);
  }
  // The reservation this curation was written against, checked rather than
  // assumed. A predecessor re-emitted with a different reservation must fail the
  // build rather than silently re-size a promotion whose curated list, rejected
  // alternatives and cost statements were all chosen against 36 entries.
  if (input.reservation.entries !== NORTHERN_MANHATTAN_RESERVED_ENTRIES) {
    fail(`the promoted predecessor's committed record reserves ${input.reservation.entries} entries for this wave, but this curation was enumerated against ${NORTHERN_MANHATTAN_RESERVED_ENTRIES}; the promoted subset and every cost it states must be re-decided rather than re-cut against a different budget.`);
  }
  const promotedAssetEntries = input.promotedWaves.reduce((total, wave) => total + wave.assetEntries, 0);
  const headroom = input.maxCacheEntries - promotedAssetEntries;
  if (headroom <= 0) {
    fail(`the ${input.promotedWaves.length} promoted waves occupy ${promotedAssetEntries} of ${input.maxCacheEntries} cache entries, so no renderable subset fits beside them; the cache ceiling must be resolved before this wave can promote (ADR 0037 precondition (a)).`);
  }
  // A reservation that no longer fits what is actually free is not the decision
  // that was recorded, and must be re-opened deliberately rather than honoured at
  // a smaller size.
  if (input.reservation.entries > headroom) {
    fail(`the recorded split reserves ${input.reservation.entries} entries for ${input.reservation.forWaveId}, but only ${headroom} of ${input.maxCacheEntries} are free beside the ${input.promotedWaves.length} promoted waves; the reservation no longer fits the cache it was split out of and must be re-decided rather than silently re-cut.`);
  }
  if (input.remainingUnpromotedWaveIds.length === 0) fail("no unpromoted wave was supplied; this release is itself one until it is promoted, so the list can never be empty.");
  const isLast = input.remainingUnpromotedWaveIds.length === 1 && input.remainingUnpromotedWaveIds[0] === input.reservation.forWaveId;
  if (!isLast) {
    fail(`the unpromoted set is ${JSON.stringify([...input.remainingUnpromotedWaveIds])}, which is not this wave alone; every reservation sentence this record states rests on this being the LAST unpromoted wave, so a build in which it is not must re-open the decision rather than emit those sentences.`);
  }
  const promotedAfter = input.promotedWaves.length + 1;
  return {
    maxCacheEntries: input.maxCacheEntries,
    promotedWaves: input.promotedWaves.map((wave) => ({ ...wave })),
    promotedWaveCount: input.promotedWaves.length,
    promotedAssetEntries,
    alongsidePromotedHeadroom: headroom,
    reservation: { ...input.reservation },
    reservationStatement: NORTHERN_MANHATTAN_RESERVATION_STATEMENT,
    headroomExceedsReservationBy: headroom - input.reservation.entries,
    reservationConsumed: true,
    isLastUnpromotedWave: isLast,
    remainingUnpromotedWaveIds: [...input.remainingUnpromotedWaveIds],
    promotedWaveCountAfterThisRelease: promotedAfter,
    completesLedgerCoverage: promotedAfter === input.declaredWaveCount,
    entryBudget: Math.min(headroom, input.reservation.entries),
  };
}

/**
 * Resolves the curated list against the committed wave ledger's cells.
 *
 * Every failure below is a refusal, never a repair. A curated id that does not
 * resolve, a cell outside the stated envelope, a subset that is not one connected
 * piece, a cell that would overflow the entry budget, or a silent reuse of the
 * canary's cell stops the build rather than producing a smaller or different subset
 * than the one that was recorded and reviewed.
 *
 * Cells are admitted WHOLE, for the reason the canary gave: a cell loads
 * atomically, so a partially renderable cell is a cell that can never finish
 * loading.
 */
export function northernManhattanCuratedCells<T extends NorthernManhattanCurationCellInput>(
  cells: readonly T[],
  entryBudget: number,
): NorthernManhattanCuratedSubset<T> {
  const byId = new Map(cells.map((cell) => [cell.cellId, cell]));
  const chosen: T[] = [];
  let owned = 0;
  for (const record of NORTHERN_MANHATTAN_CURATED_CELLS) {
    const cell = byId.get(record.cellId);
    if (!cell) fail(`curated cell ${record.cellId} is not owned by this wave's ledger (${EXTERIOR_WAVE_LEDGER_RELEASE_ID}); the curation names a cell that does not exist.`);
    // The subset ledger RENUMBERS its cells contiguously from zero, so a cell's
    // `order` here is its position in wave w05 and not the full-city order the
    // curation quotes. The full-city order is checked against the one place it
    // survives verbatim — the cell id, which the ledger mints as
    // `...-w05-<parentOrder padded to six digits>-<tile>`.
    const parentOrderInId = /-w05-(\d{6})-/u.exec(record.cellId);
    if (!parentOrderInId || Number(parentOrderInId[1]) !== record.parentOrder) {
      fail(`curated cell ${record.cellId} does not carry the full-city order ${record.parentOrder} the curation recorded; the ledger this build reads is not the ledger the curation was written against.`);
    }
    const envelope = NORTHERN_MANHATTAN_CANDIDATE_ENVELOPE;
    const inside = cell.bounds.west >= envelope.west && cell.bounds.east <= envelope.east
      && cell.bounds.south >= envelope.south && cell.bounds.north <= envelope.north;
    if (!inside) {
      fail(`curated cell ${record.cellId} has bounds outside the stated candidate envelope; the envelope is this wave's own bounding box, so a cell outside it is not a cell of this wave.`);
    }
    if (NORTHERN_MANHATTAN_CANARY_RENDERABLE_CELL_IDS.includes(record.cellId)) {
      fail(`curated cell ${record.cellId} is the canary's order-derived renderable cell; ADR 0037 precondition (b) excludes reusing it.`);
    }
    chosen.push(cell);
    owned += cell.buildingIds.length;
  }
  if (chosen.length === 0) fail("the curated list is empty; a promoted wave with no renderable cell would ship as pure tombstones.");
  if (!northernManhattanCellsConnected(chosen)) {
    fail("the curated cells are not one edge-connected piece; edge-contiguity is a PRECONDITION of this curation, not a tie-break, and a subset that renders as scattered textured islands would falsify the statement this release commits.");
  }
  // BUILDINGS ARE COMPARED AGAINST ENTRIES HERE, AND THAT IS AN ASSUMPTION.
  //
  // `owned` counts OWNED BUILDINGS; `entryBudget` counts CACHE ENTRIES, and one
  // cache entry is one shipped GLB artifact. The two are the same number only for
  // a release that ships exactly one level of detail per building, which this one
  // does — every wave release since Midtown-core ships LOD 0 alone, and Block 835
  // is the single exception that ships both. So the comparison is CONSERVATIVE
  // rather than exact in the direction that matters: `owned` is an upper bound on
  // entries here, because a refused building owns nothing and ships nothing.
  //
  // It would stop being conservative if a future wave shipped two LODs, and this
  // gate could not tell: the entry count is not knowable at this point, because
  // nothing has been materialized yet. The release-level check that closes it is
  // in `exterior-northern-manhattan-promotion-record.test.ts`, which compares the
  // SHIPPED asset count from the committed inventory against this same budget
  // after the bytes exist.
  if (owned > entryBudget) {
    fail(`the curated subset owns ${owned} buildings, above the ${entryBudget}-entry reservation T020's split committed to this wave; taking more would spend entries this promotion was not promised, which requires re-opening that split explicitly rather than outgrowing it.`);
  }
  return {
    cells: chosen,
    records: NORTHERN_MANHATTAN_CURATED_CELLS,
    ownedBuildingCount: owned,
    entryBudget,
    spareEntries: entryBudget - owned,
    basis: NORTHERN_MANHATTAN_CURATION_BASIS,
  };
}

export interface NorthernManhattanCuratedRefusalCensus {
  readonly ownedBuildingCount: number;
  readonly materializedBuildingCount: number;
  readonly refusedBuildingCount: number;
  readonly localRefusalRate: number;
  readonly waveRefusalRate: number;
  readonly maxRefusalRate: number;
  /** True when the local rate is ABOVE the wave rate. For this subset it is not. */
  readonly localRateExceedsWaveRate: boolean;
  /**
   * The smallest non-zero rate a subset this size can have: one refusal over the
   * owned count. Carried because at 24 buildings the granularity is coarse enough
   * to matter — one refusal would be 4.17% and two would be 8.33%, which is ABOVE
   * the ceiling — so a reader can see how much room the passing result actually
   * had rather than only that it passed.
   */
  readonly refusalGranularity: number;
  readonly ok: boolean;
}

/**
 * The local refusal rate this subset must not exceed, as a fraction.
 *
 * ADR 0037 precondition (c) requires the promoted subset's local rate to be
 * recomputed from that run's own shipped census and justified against the 3.72%
 * wave rate, with no tolerance moved to reach it. The bound is TWICE the wave rate,
 * which is the rule waves `w03` and `w04` stated; it is written here as arithmetic
 * over the wave rate rather than as a rounded constant, so it cannot drift from the
 * rate it is about.
 *
 * The subset's actual rate is 0 of 24 = 0%, which is BELOW the wave's 3.72% and is
 * reported as such. That is a better result than wave `w04`'s, whose curated ground
 * refused more than its wave did, and it is not presented as an achievement: 24
 * buildings is a small sample and this wave refuses 381 of 10,230 elsewhere.
 */
export const NORTHERN_MANHATTAN_WAVE_REFUSAL_RATE = 381 / 10230;
export const NORTHERN_MANHATTAN_CURATED_MAX_REFUSAL_RATE = 2 * NORTHERN_MANHATTAN_WAVE_REFUSAL_RATE;

export function northernManhattanCuratedRefusalCensus(input: {
  ownedBuildingCount: number;
  materializedBuildingCount: number;
  refusedBuildingCount: number;
}): NorthernManhattanCuratedRefusalCensus {
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
    waveRefusalRate: NORTHERN_MANHATTAN_WAVE_REFUSAL_RATE,
    maxRefusalRate: NORTHERN_MANHATTAN_CURATED_MAX_REFUSAL_RATE,
    localRateExceedsWaveRate: localRefusalRate > NORTHERN_MANHATTAN_WAVE_REFUSAL_RATE,
    refusalGranularity: 1 / input.ownedBuildingCount,
    ok: localRefusalRate <= NORTHERN_MANHATTAN_CURATED_MAX_REFUSAL_RATE,
  };
}

/**
 * The VOLUME-IDENTITY MARGIN of the curated subset, named by ADR 0037 as a
 * precondition of its own.
 *
 * ADR 0037 reported the wave's worst mesh-versus-analytic volume deviation at
 * 0.9895 of the tolerance — a check that passed but did not pass comfortably — and
 * required T022 to report the CURATED SUBSET's own worst margin rather than
 * inheriting the wave figure. The two are different measurements over different
 * sets, and the subset's is the one that describes the bytes this release ships.
 *
 * `buildingsChecked` IS ACCEPTED PLUS REJECTED, which is the T021 F1 correction
 * applied here at the site that would otherwise have inherited the wrong
 * denominator. A building this check rejects never becomes a materialized building,
 * so the materialized count is the count of buildings that PASSED and is the wrong
 * denominator for a rate.
 */
export interface NorthernManhattanCuratedVolumeMargin {
  readonly buildingsChecked: number;
  readonly buildingsAccepted: number;
  readonly buildingsRejected: number;
  readonly worstVolumeDeviation: number;
  readonly tolerance: number;
  readonly worstDeviationAsFractionOfTolerance: number;
  readonly waveWorstDeviationAsFractionOfTolerance: number;
  /** True when the SHIPPED subset's margin is better than the wave's. */
  readonly betterThanWave: boolean;
  readonly ok: boolean;
}

/** The wave-scale figure ADR 0037 recorded, for comparison and nothing else. */
export const NORTHERN_MANHATTAN_WAVE_WORST_VOLUME_FRACTION = 0.989500294880465;

export function northernManhattanCuratedVolumeMargin(input: {
  buildingsChecked: number;
  buildingsRejected: number;
  worstVolumeDeviation: number;
  tolerance: number;
}): NorthernManhattanCuratedVolumeMargin {
  if (input.buildingsChecked <= 0) fail("a volume-identity margin over zero checked buildings is not a measurement.");
  if (input.buildingsRejected < 0 || input.buildingsRejected > input.buildingsChecked) {
    fail(`the margin rejects ${input.buildingsRejected} of ${input.buildingsChecked} checked buildings, which is not a count of the set it was measured over; the denominator is accepted + rejected.`);
  }
  if (input.tolerance <= 0) fail("the volume-identity tolerance must be positive.");
  const fraction = input.worstVolumeDeviation / input.tolerance;
  return {
    buildingsChecked: input.buildingsChecked,
    buildingsAccepted: input.buildingsChecked - input.buildingsRejected,
    buildingsRejected: input.buildingsRejected,
    worstVolumeDeviation: input.worstVolumeDeviation,
    tolerance: input.tolerance,
    worstDeviationAsFractionOfTolerance: fraction,
    waveWorstDeviationAsFractionOfTolerance: NORTHERN_MANHATTAN_WAVE_WORST_VOLUME_FRACTION,
    betterThanWave: fraction < NORTHERN_MANHATTAN_WAVE_WORST_VOLUME_FRACTION,
    ok: input.buildingsRejected === 0 && fraction < 1,
  };
}
