/**
 * The CURATED renderable subset of wave `w02`, and the record of why it is those
 * cells.
 *
 * ADR 0034 precondition (a) forbids promotion from inheriting the canary's
 * renderable subset. That subset was derived from the ledger's cell `order`,
 * which is documented as "global visual-priority order" but is in fact a
 * south-to-north tile-row traversal; for this wave the south end is water, so
 * the canary's two highest-priority cells are harbour and Governors Island
 * low-rise. The ADR gives promotion two admissible answers and requires it to
 * record which one it took. This module takes the SECOND: an explicit curated
 * list, stated as curation, with the reason for each admitted cell written down.
 *
 * So "visual priority" is, for the promoted subset, a STATED PROPERTY whose
 * value is this list — not a re-derivation of the ledger order under a new name.
 * Everything about the choice that can be computed is computed and gated:
 *
 *  - the cells exist in the committed wave ledger and are admitted WHOLE;
 *  - their bounds lie inside the stated Financial District envelope
 *    (`LOWER_MANHATTAN_FINANCIAL_DISTRICT_ENVELOPE`), which closes ADR 0034
 *    precondition (b)'s first half by geometry rather than by the word
 *    "Financial District" appearing in a comment;
 *  - the subset fits the shared runtime cache entry budget;
 *  - its LOCAL refusal rate is recomputed from the shipped census and required
 *    to sit near the 2.09% wave rate rather than the canary's 34%, which closes
 *    precondition (b)'s second half.
 *
 * What is NOT computed, and is therefore stated as a judgement: that these are
 * the cells a first-time viewer should see textured. The rationale strings below
 * are that judgement, written down.
 */

import { EXTERIOR_WAVE_LEDGER_RELEASE_ID } from "./exterior-wave-ledger.ts";

function fail(message: string): never {
  throw new Error(`Lower-Manhattan curated subset: ${message}`);
}

/**
 * The envelope the curated cells must lie inside, in WGS84 degrees.
 *
 * The Financial District as the City draws it: Battery Park at the south, the
 * City Hall / Chambers Street edge at the north, West Street at the west and
 * South Street at the east. It is stated as a rectangle because the gate below
 * compares rectangles; it is deliberately no larger than the neighbourhood, so
 * a cell from Tribeca, SoHo or the harbour cannot satisfy it.
 */
export const LOWER_MANHATTAN_FINANCIAL_DISTRICT_ENVELOPE = {
  west: -74.0180,
  south: 40.7010,
  east: -74.0000,
  north: 40.7155,
} as const;

/**
 * The local refusal rate this subset must not exceed, as a fraction.
 *
 * ADR 0034 requires "materially closer to the 2.09% wave rate" than the canary's
 * 34%. The bound is stated as an absolute ceiling rather than as a distance from
 * 2.09% because a subset that refuses LESS than the wave does is not a problem
 * the precondition was written about: the defect it names is a promoted set that
 * refuses a third of what it owns. Twice the wave rate is the ceiling, and the
 * curated set measures well inside it.
 */
export const LOWER_MANHATTAN_CURATED_MAX_REFUSAL_RATE = 0.0418;

/** The wave-scale refusal rate this subset's local rate is compared against. */
export const LOWER_MANHATTAN_WAVE_REFUSAL_RATE = 134 / 6425;

export interface LowerManhattanCuratedCellRecord {
  readonly cellId: string;
  /** Order this cell carries in the committed full-city wave ledger. */
  readonly parentOrder: number;
  /** Why this cell is in the promoted subset. Curation, stated as curation. */
  readonly rationale: string;
}

/**
 * The curated cells, in the order a viewer meets them from the ground: the
 * lower cell first, then the cell above it.
 *
 * They are vertically adjacent and share their whole eastern-to-western extent,
 * so the promoted subset renders as ONE contiguous block of city rather than as
 * two textured islands with untextured ground between them. That contiguity is
 * itself part of the curation: a viewer reads a skyline, not a pair of cells.
 *
 * Heights quoted in the rationales are the SOURCED `heightMeters` of the pinned
 * `manhattan-citywide-20260804` base, not a claim about any named building. The
 * NYC OTI footprint dataset carries no building names — its `name` field is the
 * literal string "Building <id>" — so no rationale here identifies a building by
 * name, and none is implied. The place names are geographic: the cell bounds
 * provably cover that ground.
 */
export const LOWER_MANHATTAN_CURATED_CELLS: readonly LowerManhattanCuratedCellRecord[] = [
  {
    cellId: "manhattan-exterior-cell-w02-000160-16-19294-17945",
    parentOrder: 160,
    rationale:
      "The southern half of the World Trade Center superblock and the Church Street frontage east of it. It carries the wave's second- and third-tallest sourced structures (324.3 m and 298.2 m) plus four more above 120 m in only 32 owned buildings, so it is dense in built height rather than in building count, and the V3 grammar carries every one of them: 32 of 32 materialize, none refused. It is the cell a viewer standing on Church Street is looking at.",
  },
  {
    cellId: "manhattan-exterior-cell-w02-000157-16-19294-17944",
    parentOrder: 157,
    rationale:
      "The northern half of the same superblock, directly adjacent, up to the Vesey and Barclay Street edge. It carries the tallest sourced structure in the entire wave at 429.3 m — 105 m taller than anything else w02 owns — and five more above 190 m. Admitting it beside cell 160 makes the promoted subset one contiguous column of the World Trade Center site instead of two islands, which is what makes it read as a skyline from the river stations. 39 of 40 materialize; the single refusal is doitt:602678, whose sourced ring carries more than the 64 distinct vertices the V3 grammar supports, and it ships as an explicit unavailable detail rather than being simplified into a shape the source does not state.",
  },
];

/**
 * What the curation is, stated so a reader does not have to infer it.
 *
 * Carried into the release record and asserted by test, because ADR 0034 asks
 * promotion to record WHICH of its two admissible answers it took, and an
 * unrecorded answer is the failure mode the precondition exists to prevent.
 */
export const LOWER_MANHATTAN_CURATION_BASIS = "curated-list" as const;

export const LOWER_MANHATTAN_CURATION_STATEMENT =
  "The promoted renderable subset of wave w02 is an EXPLICIT CURATED LIST of two ownership cells, not a re-derivation of the wave ledger's cell order. The ledger's `order` field is documented as global visual-priority order but is a south-to-north tile-row traversal, and for this wave the south end is open water, so the order-derived subset the canary shipped is harbour and Governors Island low-rise. Visual priority for the promoted subset is therefore a stated property whose value is this list, chosen for built height, materialization density and contiguity over the World Trade Center site, and every cell's reason is recorded beside it. The canary's cells 150 and 151 are deliberately not reused." as const;

/** Cells the promoted subset must NOT silently inherit (ADR 0034 (a)). */
export const LOWER_MANHATTAN_CANARY_RENDERABLE_CELL_IDS: readonly string[] = [
  "manhattan-exterior-cell-w02-000150-14-4822-4488",
  "manhattan-exterior-cell-w02-000151-15-9646-8976",
];

export interface LowerManhattanCurationCellInput {
  readonly cellId: string;
  readonly order: number;
  readonly bounds: { readonly west: number; readonly south: number; readonly east: number; readonly north: number };
  readonly buildingIds: readonly string[];
}

export interface LowerManhattanCuratedSubset<T extends LowerManhattanCurationCellInput> {
  readonly cells: readonly T[];
  readonly records: readonly LowerManhattanCuratedCellRecord[];
  readonly ownedBuildingCount: number;
  readonly entryBudget: number;
  readonly spareEntries: number;
  readonly basis: typeof LOWER_MANHATTAN_CURATION_BASIS;
}

/**
 * Resolves the curated list against the committed wave ledger's cells.
 *
 * Every failure below is a refusal, never a repair. A curated id that does not
 * resolve, a cell outside the Financial District envelope, a cell that would
 * overflow the entry budget, or a silent reuse of the canary's cells stops the
 * build rather than producing a smaller or different subset than the one that
 * was recorded and reviewed.
 *
 * Cells are admitted WHOLE, for the reason the canary gave: a cell loads
 * atomically, so a partially renderable cell is a cell that can never finish
 * loading.
 */
export function lowerManhattanCuratedCells<T extends LowerManhattanCurationCellInput>(
  cells: readonly T[],
  entryBudget: number,
): LowerManhattanCuratedSubset<T> {
  const byId = new Map(cells.map((cell) => [cell.cellId, cell]));
  const chosen: T[] = [];
  let owned = 0;
  for (const record of LOWER_MANHATTAN_CURATED_CELLS) {
    const cell = byId.get(record.cellId);
    if (!cell) fail(`curated cell ${record.cellId} is not owned by this wave's ledger (${EXTERIOR_WAVE_LEDGER_RELEASE_ID}); the curation names a cell that does not exist.`);
    // The subset ledger RENUMBERS its cells contiguously from zero, so a cell's
    // `order` here is its position in wave w02 and not the full-city order the
    // curation quotes. The full-city order is checked against the one place it
    // survives verbatim — the cell id, which the ledger mints as
    // `...-w02-<parentOrder padded to six digits>-<tile>`. Checking it there
    // rather than against the renumbered field means the curation cannot quote a
    // parent order that the ledger never assigned, and does not have to restate
    // a subset index that is an output of the derivation.
    const parentOrderInId = /-w02-(\d{6})-/u.exec(record.cellId);
    if (!parentOrderInId || Number(parentOrderInId[1]) !== record.parentOrder) {
      fail(`curated cell ${record.cellId} does not carry the full-city order ${record.parentOrder} the curation recorded; the ledger this build reads is not the ledger the curation was written against.`);
    }
    const envelope = LOWER_MANHATTAN_FINANCIAL_DISTRICT_ENVELOPE;
    const inside = cell.bounds.west >= envelope.west && cell.bounds.east <= envelope.east
      && cell.bounds.south >= envelope.south && cell.bounds.north <= envelope.north;
    if (!inside) {
      fail(`curated cell ${record.cellId} has bounds outside the stated Financial District envelope; ADR 0034 precondition (b) requires the promoted subset to be Financial District cells, and this one is not.`);
    }
    if (LOWER_MANHATTAN_CANARY_RENDERABLE_CELL_IDS.includes(record.cellId)) {
      fail(`curated cell ${record.cellId} is one of the canary's order-derived renderable cells; ADR 0034 precondition (a) excludes reusing them.`);
    }
    chosen.push(cell);
    owned += cell.buildingIds.length;
  }
  if (chosen.length === 0) fail("the curated list is empty; a promoted wave with no renderable cell would ship as pure tombstones.");
  if (owned > entryBudget) {
    fail(`the curated subset owns ${owned} buildings, above the ${entryBudget}-entry budget derived from the shared runtime cache cap; a subset that does not fit alongside the promoted waves would have to be re-cut after promotion, which an immutable release cannot do.`);
  }
  return {
    cells: chosen,
    records: LOWER_MANHATTAN_CURATED_CELLS,
    ownedBuildingCount: owned,
    entryBudget,
    spareEntries: entryBudget - owned,
    basis: LOWER_MANHATTAN_CURATION_BASIS,
  };
}

export interface LowerManhattanCuratedRefusalCensus {
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
 * This is the gate for ADR 0034 precondition (b): the canary's subset refused 21
 * of 62 (34%) against a 2.09% wave rate, and a promoted set that refuses a third
 * of what it owns is not representative of the wave it promotes. The rate is
 * computed from what the materializer actually did on this build's inputs, so a
 * curation that stopped being representative — because the base moved, or the
 * grammar's tolerances did — fails here instead of shipping on a remembered
 * number.
 */
export function lowerManhattanCuratedRefusalCensus(input: {
  ownedBuildingCount: number;
  materializedBuildingCount: number;
  refusedBuildingCount: number;
}): LowerManhattanCuratedRefusalCensus {
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
    waveRefusalRate: LOWER_MANHATTAN_WAVE_REFUSAL_RATE,
    maxRefusalRate: LOWER_MANHATTAN_CURATED_MAX_REFUSAL_RATE,
    ok: localRefusalRate <= LOWER_MANHATTAN_CURATED_MAX_REFUSAL_RATE,
  };
}
