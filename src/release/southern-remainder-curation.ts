/**
 * The CURATED renderable subset of wave `w03`, and the record of why it is those
 * cells.
 *
 * ADR 0035 precondition (b) forbids promotion from inheriting this wave's canary
 * subset. That subset is one cell, chosen by the ledger's `order` field — which
 * is documented as global visual-priority order but is in fact a south-to-north
 * tile-row traversal, so for this wave it is simply the wave's first cell rather
 * than its best one. The precondition also says, in terms, that the skyline
 * argument "is available and unused here on purpose" and that "a curated subset
 * chosen for what it looks like is exactly what promotion is for".
 *
 * So "visual priority" is, for the promoted subset, a STATED PROPERTY whose value
 * is this list. Everything about the choice that can be computed is computed and
 * gated:
 *
 *  - the cells exist in the committed wave ledger and are admitted WHOLE;
 *  - their bounds lie inside the stated skyline envelope
 *    (`SOUTHERN_REMAINDER_SKYLINE_ENVELOPE`), so "the high-rise band at the
 *    wave's northern edge" is closed by geometry rather than by the phrase
 *    appearing in a comment;
 *  - the subset is EDGE-CONNECTED and admits at most
 *    `SOUTHERN_REMAINDER_CURATION_MAX_CELLS` cells;
 *  - it fits the entry budget derived from the RAISED cache cap;
 *  - its LOCAL refusal rate is recomputed from the shipped census and required to
 *    sit near the 1.00% wave rate, which closes precondition (b)'s second half.
 *
 * ## The decision rule, stated exactly, because an earlier draft overclaimed it
 *
 * The first version of this module said the curated set is "the enumerated
 * OPTIMUM on skyline value over every admissible combination in the envelope".
 * That was FALSE, and review caught it. The enumeration behind it silently
 * bounded combinations at four cells, and the sentence did not say so. Lift the
 * bound and `{379, 380, 385, 387, 388}` scores **18** at 196 owned buildings —
 * inside the envelope, inside the entry budget, and beating the curated set's
 * 16. So did `{379, 381, 385, 387, 388}` at 18 and 198 owned.
 *
 * The rule that was actually applied is a LEXICOGRAPHIC one, and it is now
 * written down in the order it is applied:
 *
 *   1. **Edge-contiguity is a PRECONDITION, not a tie-break.** A promoted subset
 *      must render as one continuous piece of city; scattered textured islands
 *      with untextured ground between them read as a rendering fault rather than
 *      as a skyline. This is the constraint that actually costs something and
 *      the cost is stated rather than hidden: BOTH 18-scoring sets are
 *      disconnected — in each, cell 385 touches nothing else in the set — so
 *      contiguity gives up 2 skyline buildings. Under contiguity the maximum
 *      reachable score is 16 AT ANY SIZE, which is the fact that makes the give-up
 *      bounded and knowable rather than open-ended.
 *   2. **At most four cells**, for the reason `SOUTHERN_REMAINDER_CURATION_MAX_CELLS`
 *      states. This bound does NOT improve the score — five connected
 *      combinations also reach 16 — it makes the choice UNIQUE, and it is the
 *      only thing that does.
 *   3. **Maximize skyline value** under 1 and 2. `{379, 385, 386, 387}` is then
 *      the unique maximum at 16.
 *
 * `southern-remainder-curation-optimum.test.ts` enumerates WITHOUT hiding the
 * size bound, pins the rejected 18-scoring alternatives by name together with
 * their scores and their disconnectedness, and pins the five connected
 * combinations that tie at 16 once the bound is lifted. The tradeoff is
 * therefore checked on every run rather than asserted in prose.
 *
 * What is NOT computed, and is therefore stated as a judgement: that contiguity
 * is worth two skyline buildings, that four cells is the right blast radius, and
 * that a viewer meeting this wave for the first time should meet it here. The
 * rationale strings below are that judgement, written down.
 */

import { EXTERIOR_WAVE_LEDGER_RELEASE_ID } from "./exterior-wave-ledger.ts";

function fail(message: string): never {
  throw new Error(`Southern-remainder curated subset: ${message}`);
}

/**
 * The envelope the curated cells must lie inside, in WGS84 degrees.
 *
 * Wave `w03` runs from the Battery to the Midtown-core wave boundary at
 * `40.748291015625`, and its tall structures are almost entirely in the band
 * immediately below that boundary. The rectangle is stated because the gate below
 * compares rectangles, and it is deliberately no larger than that band: a cell
 * from the Village, Tribeca or the harbour cannot satisfy it, and neither can the
 * canary's cell, which sits nine tile rows further south.
 *
 * Geographically it is roughly West 27th to West 31st Street between Seventh and
 * Fifth Avenues — NoMad and the southern Garment District. That sentence is a
 * description, not a gate; the gate is the rectangle.
 */
export const SOUTHERN_REMAINDER_SKYLINE_ENVELOPE = {
  west: -73.9930,
  south: 40.7442,
  east: -73.9819,
  north: 40.7483,
} as const;

/**
 * The sourced height, in metres, at or above which a building counts toward this
 * subset's skyline score.
 *
 * 90 m is about a thirty-storey building. It is a threshold, not a discovery: it
 * was chosen because it separates the towers that are visible from outside their
 * own block from the loft and warehouse stock that dominates this wave's building
 * COUNT, and the enumeration that ranks candidate subsets uses this and nothing
 * else as its primary key. Every height it is applied to is the SOURCED
 * `heightMeters` of the pinned `manhattan-citywide-20260804` base.
 */
export const SOUTHERN_REMAINDER_SKYLINE_HEIGHT_METERS = 90;

/**
 * The self-imposed ceiling on the promoted subset, in cache entries.
 *
 * It is a JUDGEMENT and is recorded as one. The raised cap leaves 257 entries of
 * headroom beside the three already-promoted waves, and spending all of it would
 * make this wave's promotion the reason waves `w04` and `w05` cannot promote at
 * all — which is precisely the failure this promotion had to clear for itself.
 * 200 keeps the promoted composition inside 85% of the raised cap while still
 * admitting the enumerated best subset whole, and what it leaves unspent is
 * stated rather than implied: see ADR 0035's next-wave preconditions.
 */
export const SOUTHERN_REMAINDER_CURATED_SUBSET_CEILING = 200;

/**
 * The most cells a promoted curated subset may admit.
 *
 * It is a STATED CRITERION with a reason, not a property of the data and not a
 * tie-break dressed up as one. Two reasons, and neither is "it scores better",
 * because it does not:
 *
 *  - **Bounded curation blast radius.** Every admitted cell is a judgement that
 *    has to be written down, defended and re-checked whenever the base moves.
 *    Four rationales are readable; a subset that grows to fill whatever the
 *    entry budget allows stops being a curation and becomes a fill.
 *  - **A single coherent district.** Four contiguous cells of this ledger's tile
 *    grid are about four blocks by two — one neighbourhood a viewer reads as one
 *    place. Beyond that the subset spans places that have nothing to do with each
 *    other and the word "curated" stops meaning anything.
 *
 * What it buys is UNIQUENESS. With contiguity as a precondition the maximum
 * skyline score is 16 at any size, and lifting this bound leaves FIVE connected
 * combinations tied at 16 rather than one. This bound is the only thing that
 * makes the promoted set determined rather than arbitrary among equals.
 */
export const SOUTHERN_REMAINDER_CURATION_MAX_CELLS = 4;

/**
 * The higher-scoring combinations this curation REFUSED, named so the tradeoff
 * is a record rather than an omission.
 *
 * Both beat the curated set on raw skyline value and both are DISCONNECTED: in
 * each, cell 385 shares only a corner with the rest, so the subset would render
 * as one block of textured city plus one textured island with untextured ground
 * between them. Contiguity is a precondition here, so both are refused — and the
 * two skyline buildings that refusal gives up are stated rather than absorbed.
 *
 * `southern-remainder-curation-optimum.test.ts` recomputes each entry's score,
 * owned count and connectedness from the committed skyline census, so a claim
 * here cannot drift from the data it is about.
 */
export const SOUTHERN_REMAINDER_REJECTED_ALTERNATIVES: readonly {
  readonly parentOrders: readonly number[];
  readonly skylineBuildingCount: number;
  readonly ownedBuildingCount: number;
  readonly connected: false;
  readonly reason: string;
}[] = [
  {
    parentOrders: [379, 380, 385, 387, 388],
    skylineBuildingCount: 18,
    ownedBuildingCount: 196,
    connected: false,
    reason: "Scores 18 against the curated set's 16 and fits the 200-entry budget, and is refused because it is not one piece: cells 379, 380, 387 and 388 form a connected block and cell 385 touches none of them, sharing only the corner point where the two tile rows meet. Promoting it would put a textured island beside a textured block with base massing between them.",
  },
  {
    parentOrders: [379, 381, 385, 387, 388],
    skylineBuildingCount: 18,
    ownedBuildingCount: 198,
    connected: false,
    reason: "The other combination that reaches 18, and disconnected twice over: cell 385 is isolated for the same reason as above, and cell 381 touches nothing in the set either. It is named because an alternative that is refused for the same reason as another is still an alternative, and leaving it out would make the record look like there was exactly one path not taken.",
  },
];

/**
 * The local refusal rate this subset must not exceed, as a fraction.
 *
 * ADR 0035 requires the promoted subset's local rate to be justified against the
 * 1.00% wave rate, with no tolerance moved to reach it. The bound is stated as an
 * absolute ceiling of twice the wave rate rather than as a distance from it,
 * because a subset that refuses LESS than the wave does is not the defect the
 * precondition was written about.
 */
export const SOUTHERN_REMAINDER_CURATED_MAX_REFUSAL_RATE = 0.02;

/**
 * The wave-scale refusal rate this subset's local rate is compared against.
 *
 * 96 of 9,603 owned buildings — the ASSET-stage census, which is the superset
 * that includes the writer's own volume-identity check. The plan stage reports
 * 85; ADR 0035 records that the difference is a stage boundary rather than a
 * discrepancy, and the comparison here uses the larger, later number because it
 * is the one that describes buildings that actually failed to ship.
 */
export const SOUTHERN_REMAINDER_WAVE_REFUSAL_RATE = 96 / 9603;

export interface SouthernRemainderCuratedCellRecord {
  readonly cellId: string;
  /** Order this cell carries in the committed full-city wave ledger. */
  readonly parentOrder: number;
  /** Why this cell is in the promoted subset. Curation, stated as curation. */
  readonly rationale: string;
}

/**
 * The curated cells, in the order a viewer meets them coming south from the
 * already-promoted Midtown-core wave.
 *
 * They are EDGE-CONNECTED through cell 386: 379 sits directly above it, 385 to
 * its west and 387 to its east. The promoted subset therefore renders as one
 * continuous piece of city, and cell 379's northern edge is the wave boundary
 * itself — it is shared, exactly, with promoted Midtown-core cell
 * `manhattan-exterior-cell-w01-000030-16-19298-17931`, so the four promoted waves
 * meet on the ground rather than being four separate textured patches.
 *
 * Heights quoted in the rationales are the SOURCED `heightMeters` of the pinned
 * `manhattan-citywide-20260804` base, not a claim about any named building. The
 * NYC OTI footprint dataset carries no building names — its `name` field is the
 * literal string "Building <id>" — so no rationale here identifies a building by
 * name, and none is implied. The place names are geographic: the cell bounds
 * provably cover that ground.
 */
export const SOUTHERN_REMAINDER_CURATED_CELLS: readonly SouthernRemainderCuratedCellRecord[] = [
  {
    cellId: "manhattan-exterior-cell-w03-000379-17-38597-35864",
    parentOrder: 379,
    rationale:
      "The wave's northern edge cell, and the only cell in the subset that touches another promoted wave: its north bound 40.748291015625 is shared exactly with Midtown-core cell manhattan-exterior-cell-w01-000030-16-19298-17931, so a camera crossing that line crosses from one promoted wave into another with no untextured gap between them. It is also the densest cell in the subset by built height per building: 6 of its 29 owned structures carry a sourced height at or above 90 m, two of them at or above 150 m, topping out at 190.0 m, and the V3 grammar carries every one of them — 29 of 29 materialize, none refused.",
  },
  {
    cellId: "manhattan-exterior-cell-w03-000385-17-38596-35865",
    parentOrder: 385,
    rationale:
      "The western end of the subset's lower row, and the cell that supplies its street wall. It owns 65 buildings, more than any other candidate in the envelope, of which 4 reach 90 m and two exceed 120 m, topping out at 137.2 m. Its value is not its tallest structure but its continuity: without it the subset would end in mid-air at cell 386's western bound, and a skyline that stops at a tile edge reads as a rendering artifact rather than as a city. 65 of 65 materialize, none refused.",
  },
  {
    cellId: "manhattan-exterior-cell-w03-000386-17-38597-35865",
    parentOrder: 386,
    rationale:
      "The hub of the subset: every other curated cell is edge-adjacent to this one, so it is what makes the four a single connected piece rather than a set. It carries two sourced structures above 150 m — 155.8 m and 154.8 m, close enough to read as a pair from the ground — in 50 owned buildings. 49 of 50 materialize; the single refusal is doitt:938827, whose sourced height falls below the one-floor minimum the V3 grammar can carry, and it ships as an explicit unavailable detail rather than being given an invented storey.",
  },
  {
    cellId: "manhattan-exterior-cell-w03-000387-17-38598-35865",
    parentOrder: 387,
    rationale:
      "The eastern end of the lower row, and the reason this subset exists rather than another: it owns the TALLEST sourced structure in the whole of wave w03 at 245.4 m, and the second-tallest at 202.1 m, in only 36 owned buildings. Nothing else the wave owns comes within 50 m of the first. Six more of its structures sit at or above 60 m, so the tower has a skyline around it instead of standing alone on flat massing. 36 of 36 materialize, none refused.",
  },
];

/**
 * What the curation is, stated so a reader does not have to infer it.
 *
 * Carried into the release record and asserted by test, because ADR 0035 asks
 * promotion to record how it chose, and an unrecorded choice is the failure mode
 * the precondition exists to prevent.
 */
export const SOUTHERN_REMAINDER_CURATION_BASIS = "curated-list" as const;

export const SOUTHERN_REMAINDER_CURATION_STATEMENT =
  "The promoted renderable subset of wave w03 is an EXPLICIT CURATED LIST of four ownership cells, not a re-derivation of the wave ledger's cell order. The ledger's `order` field is documented as global visual-priority order but is a south-to-north tile-row traversal, so the canary's single order-derived cell is simply the wave's first rather than its best. Visual priority for the promoted subset is therefore a stated property whose value is this list. THE DECISION RULE IS LEXICOGRAPHIC AND IS STATED IN THE ORDER IT WAS APPLIED. (1) EDGE-CONTIGUITY IS A PRECONDITION, not a tie-break: a promoted subset must render as one continuous piece of city rather than as scattered textured islands with untextured ground between them. (2) AT MOST FOUR CELLS, a stated criterion whose reason is a bounded curation blast radius and a single coherent district. (3) MAXIMIZE SKYLINE VALUE — the count of owned buildings whose sourced height reaches 90 m — subject to those two constraints, over every admissible combination inside the stated envelope that fits the entry budget. Under that rule these four cells are the UNIQUE maximum at 16. THE RULE IS NOT COST-FREE AND THE COST IS RECORDED: lifting the contiguity precondition admits {379, 380, 385, 387, 388} at 18 and {379, 381, 385, 387, 388} at 18, both inside the envelope and the budget, so contiguity gives up two skyline buildings; in both, cell 385 shares only a corner with the rest. Lifting the four-cell bound does NOT raise the score — under contiguity the maximum is 16 at any size — but it leaves five connected combinations tied at 16 rather than one, so the bound buys uniqueness rather than quality. The four cells form one connected piece through cell 386, and cell 379's northern edge is shared exactly with a promoted Midtown-core cell, so the promoted waves meet on the ground. The canary's cell 276 is deliberately not reused." as const;

/** Cells the promoted subset must NOT silently inherit (ADR 0035 (b)). */
export const SOUTHERN_REMAINDER_CANARY_RENDERABLE_CELL_IDS: readonly string[] = [
  "manhattan-exterior-cell-w03-000276-17-38590-35872",
];

export interface SouthernRemainderCurationCellInput {
  readonly cellId: string;
  readonly order: number;
  readonly bounds: { readonly west: number; readonly south: number; readonly east: number; readonly north: number };
  readonly buildingIds: readonly string[];
}

export interface SouthernRemainderCuratedSubset<T extends SouthernRemainderCurationCellInput> {
  readonly cells: readonly T[];
  readonly records: readonly SouthernRemainderCuratedCellRecord[];
  readonly ownedBuildingCount: number;
  readonly entryBudget: number;
  readonly spareEntries: number;
  readonly basis: typeof SOUTHERN_REMAINDER_CURATION_BASIS;
}

/** Whether two cells share a boundary segment rather than only a corner. */
export function southernRemainderCellsAdjacent(
  left: SouthernRemainderCurationCellInput["bounds"],
  right: SouthernRemainderCurationCellInput["bounds"],
): boolean {
  const epsilon = 1e-9;
  const longitudeOverlap = Math.min(left.east, right.east) - Math.max(left.west, right.west);
  const latitudeOverlap = Math.min(left.north, right.north) - Math.max(left.south, right.south);
  const sharesLatitudeEdge = Math.abs(left.north - right.south) < epsilon || Math.abs(right.north - left.south) < epsilon;
  const sharesLongitudeEdge = Math.abs(left.east - right.west) < epsilon || Math.abs(right.east - left.west) < epsilon;
  return (sharesLatitudeEdge && longitudeOverlap > epsilon) || (sharesLongitudeEdge && latitudeOverlap > epsilon);
}

/** Whether a cell set is one edge-connected piece. A single cell trivially is. */
export function southernRemainderCellsConnected(cells: readonly SouthernRemainderCurationCellInput[]): boolean {
  if (cells.length === 0) return false;
  const reached = new Set<number>([0]);
  const frontier = [0];
  while (frontier.length > 0) {
    const index = frontier.pop()!;
    for (let other = 0; other < cells.length; other += 1) {
      if (reached.has(other) || !southernRemainderCellsAdjacent(cells[index]!.bounds, cells[other]!.bounds)) continue;
      reached.add(other);
      frontier.push(other);
    }
  }
  return reached.size === cells.length;
}

/**
 * The entry budget for the PROMOTED subset, derived from the RAISED cache cap.
 *
 * `maxCacheEntries - promotedAssetEntries` is what a fourth wave may occupy
 * beside the three already promoted; the curated ceiling is the smaller,
 * self-imposed bound that keeps this promotion from spending the whole raise on
 * itself. The budget is the lesser of the two, and both are carried into the
 * committed record so a reader can see which one bound.
 */
export interface SouthernRemainderCuratedEntryBudget {
  readonly maxCacheEntries: number;
  readonly promotedAssetEntries: number;
  readonly alongsidePromotedHeadroom: number;
  readonly curatedSubsetCeiling: number;
  readonly entryBudget: number;
}

export function southernRemainderCuratedEntryBudget(input: {
  maxCacheEntries: number;
  promotedAssetEntries: number;
  curatedSubsetCeiling?: number;
}): SouthernRemainderCuratedEntryBudget {
  const ceiling = input.curatedSubsetCeiling ?? SOUTHERN_REMAINDER_CURATED_SUBSET_CEILING;
  const headroom = input.maxCacheEntries - input.promotedAssetEntries;
  if (headroom <= 0) {
    fail(`the three promoted waves occupy ${input.promotedAssetEntries} of ${input.maxCacheEntries} cache entries, so no renderable subset fits beside them; the cache ceiling must be resolved before this wave can promote (ADR 0034, ADR 0035 precondition (a)).`);
  }
  if (ceiling <= 0) fail(`the curated subset ceiling must admit at least one entry, not ${ceiling}.`);
  return {
    maxCacheEntries: input.maxCacheEntries,
    promotedAssetEntries: input.promotedAssetEntries,
    alongsidePromotedHeadroom: headroom,
    curatedSubsetCeiling: ceiling,
    entryBudget: Math.min(headroom, ceiling),
  };
}

/**
 * Resolves the curated list against the committed wave ledger's cells.
 *
 * Every failure below is a refusal, never a repair. A curated id that does not
 * resolve, a cell outside the skyline envelope, a subset that is not one
 * connected piece, a cell that would overflow the entry budget, or a silent reuse
 * of the canary's cell stops the build rather than producing a smaller or
 * different subset than the one that was recorded and reviewed.
 *
 * Cells are admitted WHOLE, for the reason the canary gave: a cell loads
 * atomically, so a partially renderable cell is a cell that can never finish
 * loading.
 */
export function southernRemainderCuratedCells<T extends SouthernRemainderCurationCellInput>(
  cells: readonly T[],
  entryBudget: number,
): SouthernRemainderCuratedSubset<T> {
  const byId = new Map(cells.map((cell) => [cell.cellId, cell]));
  const chosen: T[] = [];
  let owned = 0;
  for (const record of SOUTHERN_REMAINDER_CURATED_CELLS) {
    const cell = byId.get(record.cellId);
    if (!cell) fail(`curated cell ${record.cellId} is not owned by this wave's ledger (${EXTERIOR_WAVE_LEDGER_RELEASE_ID}); the curation names a cell that does not exist.`);
    // The subset ledger RENUMBERS its cells contiguously from zero, so a cell's
    // `order` here is its position in wave w03 and not the full-city order the
    // curation quotes. The full-city order is checked against the one place it
    // survives verbatim — the cell id, which the ledger mints as
    // `...-w03-<parentOrder padded to six digits>-<tile>`.
    const parentOrderInId = /-w03-(\d{6})-/u.exec(record.cellId);
    if (!parentOrderInId || Number(parentOrderInId[1]) !== record.parentOrder) {
      fail(`curated cell ${record.cellId} does not carry the full-city order ${record.parentOrder} the curation recorded; the ledger this build reads is not the ledger the curation was written against.`);
    }
    const envelope = SOUTHERN_REMAINDER_SKYLINE_ENVELOPE;
    const inside = cell.bounds.west >= envelope.west && cell.bounds.east <= envelope.east
      && cell.bounds.south >= envelope.south && cell.bounds.north <= envelope.north;
    if (!inside) {
      fail(`curated cell ${record.cellId} has bounds outside the stated skyline envelope; ADR 0035 precondition (b) requires the promoted subset to be the high-rise band at the wave's northern edge, and this one is not in it.`);
    }
    if (SOUTHERN_REMAINDER_CANARY_RENDERABLE_CELL_IDS.includes(record.cellId)) {
      fail(`curated cell ${record.cellId} is the canary's order-derived renderable cell; ADR 0035 precondition (b) excludes reusing it.`);
    }
    chosen.push(cell);
    owned += cell.buildingIds.length;
  }
  if (chosen.length === 0) fail("the curated list is empty; a promoted wave with no renderable cell would ship as pure tombstones.");
  // The two stated constraints, in the order the decision rule applies them.
  // Both are gates rather than comments, because the statement this release
  // commits claims each of them by name.
  if (!southernRemainderCellsConnected(chosen)) {
    fail("the curated cells are not one edge-connected piece; edge-contiguity is a PRECONDITION of this curation, not a tie-break, and a subset that renders as scattered textured islands would falsify the statement this release commits.");
  }
  if (chosen.length > SOUTHERN_REMAINDER_CURATION_MAX_CELLS) {
    fail(`the curated list admits ${chosen.length} cells, above the stated ${SOUTHERN_REMAINDER_CURATION_MAX_CELLS}-cell bound; that bound is what makes the promoted subset unique among equally-scoring connected combinations, and exceeding it silently would turn a curation into a fill.`);
  }
  if (owned > entryBudget) {
    fail(`the curated subset owns ${owned} buildings, above the ${entryBudget}-entry budget derived from the raised runtime cache cap; a subset that does not fit alongside the promoted waves would have to be re-cut after promotion, which an immutable release cannot do.`);
  }
  return {
    cells: chosen,
    records: SOUTHERN_REMAINDER_CURATED_CELLS,
    ownedBuildingCount: owned,
    entryBudget,
    spareEntries: entryBudget - owned,
    basis: SOUTHERN_REMAINDER_CURATION_BASIS,
  };
}

export interface SouthernRemainderCuratedRefusalCensus {
  readonly ownedBuildingCount: number;
  readonly materializedBuildingCount: number;
  readonly refusedBuildingCount: number;
  readonly localRefusalRate: number;
  readonly waveRefusalRate: number;
  readonly maxRefusalRate: number;
  readonly ok: boolean;
}

/**
 * The local refusal rate, recomputed from a shipped census rather than recalled.
 *
 * This is the gate for ADR 0035 precondition (b): the promoted subset's local
 * rate must be justified against the 1.00% wave rate with no tolerance moved to
 * reach it. The rate is computed from what the materializer actually did on this
 * build's inputs, so a curation that stopped being representative — because the
 * base moved, or the grammar's tolerances did — fails here instead of shipping on
 * a remembered number.
 */
export function southernRemainderCuratedRefusalCensus(input: {
  ownedBuildingCount: number;
  materializedBuildingCount: number;
  refusedBuildingCount: number;
}): SouthernRemainderCuratedRefusalCensus {
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
    waveRefusalRate: SOUTHERN_REMAINDER_WAVE_REFUSAL_RATE,
    maxRefusalRate: SOUTHERN_REMAINDER_CURATED_MAX_REFUSAL_RATE,
    ok: localRefusalRate <= SOUTHERN_REMAINDER_CURATED_MAX_REFUSAL_RATE,
  };
}
