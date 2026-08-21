/**
 * Serving, verifying and accounting for baked far-tier tiles.
 *
 * A SEPARATE PATH ON PURPOSE, and the separation is the point of the module.
 *
 * The far tier does NOT extend `ExteriorArtifactKind`. That vocabulary is
 * closed (ADR 0051), and its member string is a filesystem path segment inside
 * a hashed artifact envelope — `${audience}/${kind}/${slug(id)}.json` — so
 * adding a member would rewrite on-disk layout and every declared checksum of
 * releases that are already immutable. A far-tier tile is also not a
 * `canonicalFeatureId` holder: it is one merged mesh for a whole cell, and
 * fabricating a feature id for it would put a thing with no feature identity
 * into a map that exists to answer "which building is this".
 *
 * The far tier also does NOT touch `EXTERIOR_RUNTIME_BUDGETS`. That cap is
 * criterion #30, closed at 256 MiB against a measurement this tier did not
 * exist for. `FAR_TIER_BOUND_EXCLUSIONS` already records that a retained
 * eviction cache is ADDITIVE to the B3-B5 bars, so this module carries its own
 * cache with its own ceiling and its own accounting, and a total is obtained by
 * ADDING the two rather than merging them.
 */

import { sha256HexBytes, sha256HexSync } from "../domain/deterministic-hash";

/**
 * The far tier's own residency ceiling, additive to B3-B5 and to criterion #30.
 *
 * Deliberately modest. `FAR_TIER_BOUND_EXCLUSIONS` names retained eviction
 * caches as a cost the frozen bars do NOT cover, so every byte counted here is
 * a byte on top of the 390 MiB steady-state bound and on top of the exterior
 * tier's 256 MiB. Sized against the measured prototype tile — 122,976 GLB plus
 * 196,947 atlas, about 320 KiB per cell — 64 MiB retains roughly 200 cells,
 * which comfortably spans the far ring without approaching either neighbour's
 * ceiling.
 *
 * THIS IS A CEILING ON RESIDENCY, AND IT IS ENFORCED, NOT DECLARED. Every
 * admission goes through `farTierAdmission` below, and a cell that would take
 * the resident total past either number is REFUSED — reported as `over-budget`
 * and left drawing its massing. An earlier revision of this module exported
 * these numbers with no consumer at all while the record claimed "its own cache
 * with its own accounting"; that gap is what this contract closes.
 *
 * WHAT IS STILL NOT IMPLEMENTED, stated here rather than left to be discovered:
 * there is NO EVICTION POLICY. Bytes are released when the camera leaves a
 * cell's exit band and at no other time, so a pose that selects more than the
 * ceiling refuses the excess rather than evicting an older tile for it. With one
 * baked cell the ceiling cannot be reached; a policy is owed at mass-bake scale
 * (T004) and is named in the runtime record as a gap rather than described as a
 * cache that already has one.
 */
export const FAR_TIER_RUNTIME_BUDGETS = {
  maxCacheEntries: 256,
  maxCachedBytes: 64 * 1024 * 1024,
  additiveTo: "far-tier-hlod-gpu-budget-v1 B3-B5, and the closed criterion #30. Never merged with either.",
  evictionPolicy: "NONE. Bytes are released on distance deselection only; an admission over either ceiling is refused rather than evicted for. Deferred to mass-bake scale (T004).",
} as const;

/**
 * BUDGETS v2 — the promoted tier's ceilings, and the unit they are counted in.
 *
 * THE UNIT IS DECLARED FILE BYTES. `farTierEntryByteCost` sums an entry's
 * `glbByteSize` and `atlasByteSize`, which are the sizes of the files as
 * staged. It is NOT the decoded GPU footprint, and this ceiling is NOT
 * comparable with `FAR_TIER_BUDGET_CONTRACT`'s B3-B5 or with
 * `maxResidentTotalGpuBytes`. Stating the unit is the whole point: the two
 * numbers are within a factor of 1.5 of each other and would silently pass for
 * one another.
 *
 * WHY THE OLD CEILING HAD TO MOVE. Selection folds camera height into distance,
 * so at the acceptance poses — 1,200 m and above — EVERY cell in the island is
 * in range and the selected set is all 840. The v1 ceiling of 64 MiB was sized
 * when the tier served ONE cell; against the island it admits roughly a quarter
 * of it and refuses the rest, which is not a budget doing its job but a budget
 * that was never asked this question.
 *
 * THE DERIVATION.
 *
 *   declared file bytes, all 840 promoted tiles = 258,644,848
 *     (98,818,356 GLB + 159,826,492 atlas, summed from the promoted inventory)
 *   ceiling = 288 MiB = 301,989,888
 *   headroom = 43,345,040 bytes, 16.8 per cent
 *
 * The headroom is for tiles a later bake may add or grow; it is not a claim
 * that anything needs it today.
 *
 * WHY 288 MiB IS SAFE TO ADMIT, which is a GPU question and is answered in GPU
 * units. Holding the whole island resident costs 283,639,528 bytes of atlas
 * (804 tiles at 256px, 28 at 128, 8 at 64, mip chain included) plus geometry
 * bounded above by the 98,818,356 bytes of GLB on disk — the decoded arrays are
 * a subset of those bytes, since the file also carries JSON. That upper bound is
 * 382,457,884 against the frozen `maxResidentTotalGpuBytes` of 390,295,058: a
 * 2.0 per cent margin. Inside, and not comfortably. A tier that grew would need
 * that bar revisited, and this note is where a later reader should start.
 *
 * ADDITIVE, NEVER MERGED. These ceilings sit alongside B3-B5 and criterion #30
 * exactly as v1's did. Nothing here relaxes either.
 *
 * EVICTION IS NOT DEFERRED ANY MORE — IT IS DISCHARGED. v1 owed a policy at
 * mass-bake scale. The analysis that discharges it: `release()` in
 * `far-tier-layer.ts` removes the primitive, subtracts its byte cost and drops
 * it from residency, and it is driven by the SAME range predicate that decides
 * drawing. Bytes are therefore freed exactly when a cell stops being drawable,
 * and with a ceiling that admits the whole island there is no pose that both
 * selects a cell and cannot afford it. An eviction policy exists to choose what
 * to drop when you cannot hold what you selected; at this ceiling that state is
 * unreachable, so the policy would be code with no reachable branch. See the
 * T005 activation record for the full statement.
 */
export const FAR_TIER_MAX_LOADS_PER_PASS = 24 as const;

/**
 * How many failing cells `farTierFailureDetail` spells out before summarising.
 *
 * Twelve is enough to name a pattern by eye and small enough that the attribute
 * stays a few hundred characters at worst. The per-state COUNTS are unbounded
 * and are what a verdict is read from; this string is for the human looking at
 * one session.
 */
export const FAR_TIER_FAILURE_DETAIL_LIMIT = 12 as const;

export const FAR_TIER_RUNTIME_BUDGETS_V2 = {
  maxCacheEntries: 1_024,
  maxCachedBytes: 288 * 1024 * 1024,
  unit: "DECLARED FILE BYTES — the staged file sizes an entry declares, summed by farTierEntryByteCost. NOT decoded GPU bytes and never comparable with B3-B5 or maxResidentTotalGpuBytes.",
  derivation: {
    promotedTiles: 840,
    declaredFileBytesAllTiles: 258_644_848,
    glbBytes: 98_818_356,
    atlasBytes: 159_826_492,
    ceilingBytes: 288 * 1024 * 1024,
    headroomBytes: 288 * 1024 * 1024 - 258_644_848,
    headroomShare: 0.1676,
    entriesCeilingRationale: "1,024 against 840 promoted cells, so the entry ceiling cannot bind before the byte ceiling and a later bake has room without another swap.",
  },
  gpuJustification: {
    islandAtlasGpuBytes: 283_639_528,
    islandGeometryGpuBytesUpperBound: 98_818_356,
    islandResidentGpuBytesUpperBound: 382_457_884,
    frozenMaxResidentTotalGpuBytes: 390_295_058,
    insideFrozenBar: true,
    marginShare: 0.0201,
    statement: "Holding the whole island is inside the frozen GPU bar by 2.0 per cent. That is the justification for admitting it, and it is stated as a margin rather than as comfort.",
  },
  supersedes: {
    constant: "FAR_TIER_RUNTIME_BUDGETS",
    maxCacheEntries: 256,
    maxCachedBytes: 64 * 1024 * 1024,
    whySuperseded: "Sized when the tier served ONE staged cell. Against 840 it admits about a quarter of the island and refuses the rest.",
    keptInPlace: "The v1 constant is NOT deleted. It is the record of what the tier was admitted under before promotion.",
  },
  additiveTo: "far-tier-hlod-gpu-budget-v1 B3-B5, and the closed criterion #30. Never merged with either.",
  evictionPolicy: "NONE, AND NONE IS OWED. Bytes are released on distance deselection by the same predicate that decides drawing; at a ceiling that admits the whole island there is no pose that selects a cell it cannot afford, so an eviction policy would have no reachable branch. Discharged by analysis in the T005 activation record, not deferred again.",
} as const;

/**
 * The digest of the COMMITTED payload inventory, pinned in shipped code.
 *
 * The staged copy under the serving root is gitignored operator work product,
 * and it is a byte copy of `data/far-tier-hlod-runtime-20260818/
 * payload-inventory.json`. Fetching it and trusting it would make a swapped or
 * hand-edited staged file authoritative over the committed record — an attacker
 * or an accident could then declare any digest it liked for the tiles, and every
 * per-tile check below would faithfully verify bytes against a declaration
 * nobody committed. Pinning the digest here makes the staged copy a CACHE of the
 * committed text rather than a second authority, and a mismatch fails closed
 * with no tier at all.
 *
 * A test re-derives this from the committed file, so it cannot drift silently.
 */
export const FAR_TIER_PAYLOAD_INVENTORY_SHA256 = "cf8e26480eecc91f2e7b473d217a0d3551d0be59b4d8da39ee1217a6e0538f0a" as const;

/**
 * The pin this one replaced, kept so the swap is legible in the code as well as
 * in the activation record.
 *
 * It declared the ONE-CELL T003 inventory. Promotion swaps the whole tier's
 * declaration in a single token, and a reader who finds only the new value has
 * no way to tell that it moved.
 */
export const FAR_TIER_PAYLOAD_INVENTORY_SHA256_PREDECESSOR = "9c46f62a1ac9a662f768facd716f8d04ecf960afaf3ae0f536eb216bb3e6bd24" as const;

/** Where staged far-tier bytes are served from. Its own root, not a release audience. */
export const FAR_TIER_SERVING_ROOT = "far-tier" as const;

/** Where the staged copy of the committed inventory is served from. */
export const FAR_TIER_PAYLOAD_INVENTORY_REF = `${FAR_TIER_SERVING_ROOT}/payload-inventory.json` as const;

/** The bake emitter's flat layout: `<cellId>.far_0.glb` and `<cellId>.atlas.png`. */
export function farTierTileRef(cellId: string): string { return `${FAR_TIER_SERVING_ROOT}/${cellId}.far_0.glb`; }
export function farTierAtlasRef(cellId: string): string { return `${FAR_TIER_SERVING_ROOT}/${cellId}.atlas.png`; }

/** One cell's declaration in the committed staging inventory. */
export interface FarTierInventoryEntry {
  readonly cellId: string;
  readonly glbSha256: string;
  readonly glbByteSize: number;
  readonly atlasSha256: string;
  readonly atlasByteSize: number;
  /**
   * The member buildings this tile draws, and whether each one is actually IN
   * the baked mesh. A building the V3 bake refused is `included: false`: its
   * massing must keep drawing and its refusal must keep explaining itself.
   */
  readonly members: readonly { readonly buildingId: string; readonly included: boolean }[];
}

export interface FarTierInventory {
  readonly inventoryId: string;
  readonly entries: readonly FarTierInventoryEntry[];
}

/**
 * The states a cell can be in, and each failure class keeps its own name.
 *
 * `checksum-mismatch` is never folded into `absent`. Absence is a staging gap —
 * the operator has not put the bytes there yet — and it is ordinary. A checksum
 * mismatch is an INTEGRITY FAILURE: bytes exist at the path and are not the
 * bytes that were declared. Reporting the second as the first would turn the
 * loudest signal this path can produce into routine background noise.
 *
 * `build-failure` is a THIRD thing and was split out of `checksum-mismatch`
 * after independent review. Bytes that verified and then would not build a model
 * are not bytes that differ from their declaration: reporting them as a mismatch
 * accuses the staging of an integrity failure it did not commit, and — worse —
 * makes the mismatch column stop meaning "the bytes are not the declared bytes",
 * which is the one thing it exists to say.
 *
 * `over-budget` is a REFUSAL, not a failure of the payload: the cell's bytes
 * would take far-tier residency past `FAR_TIER_RUNTIME_BUDGETS`, so it was never
 * fetched. Named rather than silently skipped, because a tier that quietly draws
 * fewer cells than it selected is indistinguishable from one that is broken.
 *
 * `near` is none of these. It is a cell the camera is inside the near edge of,
 * so the massing is showing instead — the tier working as designed. Since T003's
 * review it also covers a cell that was never fetched BECAUSE it is near: the
 * tier bounds loading by the same distance rule it bounds drawing by, so `near`
 * means "not drawn, by distance", and it does not claim the bytes were verified.
 */
export const FAR_TIER_CELL_STATES = ["declared", "drawn", "near", "not-declared", "absent", "checksum-mismatch", "build-failure", "over-budget"] as const;
export type FarTierCellState = (typeof FAR_TIER_CELL_STATES)[number];

export interface FarTierLoadOutcome {
  readonly cellId: string;
  readonly state: FarTierCellState;
  /** Present only for the two failure states, for the per-cell detail attribute. */
  readonly detail?: string;
}

export type FarTierFetcher = (relativeRef: string, signal?: AbortSignal) => Promise<Uint8Array>;

/**
 * Just enough of a `fetch` response for this module, so the shell refusal below
 * can be exercised without a network or a DOM.
 */
export interface FarTierHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type FarTierHttpFetch = (url: string, init?: { signal?: AbortSignal }) => Promise<FarTierHttpResponse>;

/**
 * The HTTP fetcher, with the single-page-app fallback refused BY NAME.
 *
 * A SPA fallback answers 200 with the application shell for a path that does
 * not exist. Those bytes are not a corrupted tile — they are the ABSENCE of a
 * tile wearing a 200 — and letting them reach the digest check reports a staging
 * gap as an INTEGRITY FAILURE, which is precisely the confusion the state
 * vocabulary exists to prevent. Measured, not hypothesised: the dev server did
 * exactly this, and removing a staged tile produced "1 checksum-mismatch" before
 * this refusal and "1 absent" after it.
 *
 * It lives here, and not inline in the viewport effect it used to live in, so it
 * is a pinned contract with a test rather than a closure nothing can reach.
 */
export function createFarTierFetcher(httpFetch: FarTierHttpFetch): FarTierFetcher {
  return async (relativeRef: string, signal?: AbortSignal): Promise<Uint8Array> => {
    const response = await httpFetch(`/${relativeRef}`, { signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/html")) {
      throw new Error(`served the application shell rather than an artifact (content-type ${contentType}); the tile is not staged`);
    }
    return new Uint8Array(await response.arrayBuffer());
  };
}

/**
 * The committed inventory, verified against the digest pinned in this module.
 *
 * FAILS CLOSED FOR THE WHOLE TIER, not per cell: an inventory that is not the
 * committed one cannot be trusted to declare anything, so there is nothing to
 * fall back to except the massing that is already drawing.
 */
export function parseVerifiedFarTierInventory(text: string): FarTierInventory {
  const actual = sha256HexSync(text);
  if (actual !== FAR_TIER_PAYLOAD_INVENTORY_SHA256) {
    throw new Error(`${FAR_TIER_PAYLOAD_INVENTORY_REF}: digest ${actual} is not the committed ${FAR_TIER_PAYLOAD_INVENTORY_SHA256}; the staged inventory is not the inventory this build declares.`);
  }
  return JSON.parse(text) as FarTierInventory;
}

/**
 * Size-then-digest, so a truncated or padded response is named for what it is
 * rather than reported as a hash failure. Returns null when the bytes are good.
 */
function verificationFailure(ref: string, bytes: Uint8Array, declaredSize: number, declaredSha256: string): string | null {
  if (bytes.byteLength !== declaredSize) return `${ref}: returned ${bytes.byteLength} bytes; ${declaredSize} were declared.`;
  if (sha256HexBytes(bytes) !== declaredSha256) return `${ref}: failed its declared SHA-256.`;
  return null;
}

/**
 * Fetch and verify one tile's bytes, failing CLOSED and distinguishing why.
 */
export async function loadVerifiedFarTierTile(
  entry: FarTierInventoryEntry,
  fetcher: FarTierFetcher,
  signal?: AbortSignal,
): Promise<{ outcome: FarTierLoadOutcome; bytes?: Uint8Array }> {
  const ref = farTierTileRef(entry.cellId);
  let bytes: Uint8Array;
  try {
    bytes = await fetcher(ref, signal);
  } catch (error) {
    return { outcome: { cellId: entry.cellId, state: "absent", detail: `${ref}: ${(error as Error).message}` } };
  }
  const failure = verificationFailure(ref, bytes, entry.glbByteSize, entry.glbSha256);
  if (failure !== null) return { outcome: { cellId: entry.cellId, state: "checksum-mismatch", detail: failure } };
  return { outcome: { cellId: entry.cellId, state: "declared" }, bytes };
}

/**
 * Fetch and verify one tile's ATLAS, which the inventory declares just as
 * precisely as it declares the GLB.
 *
 * NEVER TEXTURE FROM UNVERIFIED BYTES. An earlier revision fetched the atlas and
 * handed it straight to the model factory unchecked, while declaring
 * `atlasSha256` and `atlasByteSize` two fields away — so the one payload a user
 * actually LOOKS at was the one payload nothing verified. Bytes that are present
 * and wrong now fail the tile closed as `checksum-mismatch`, exactly as wrong
 * geometry bytes do.
 *
 * ABSENCE IS STILL NOT MISMATCH here either. An atlas that cannot be fetched at
 * all is a staging gap: it returns `bytes: undefined` with no outcome, and the
 * caller draws the tile untextured rather than refusing it. Nothing unverified
 * is ever uploaded either way.
 */
export async function loadVerifiedFarTierAtlas(
  entry: FarTierInventoryEntry,
  fetcher: FarTierFetcher,
  signal?: AbortSignal,
): Promise<{ outcome?: FarTierLoadOutcome; bytes?: Uint8Array }> {
  const ref = farTierAtlasRef(entry.cellId);
  let bytes: Uint8Array;
  try {
    bytes = await fetcher(ref, signal);
  } catch {
    return {};
  }
  const failure = verificationFailure(ref, bytes, entry.atlasByteSize, entry.atlasSha256);
  if (failure !== null) return { outcome: { cellId: entry.cellId, state: "checksum-mismatch", detail: failure } };
  return { bytes };
}

/** What one cell costs the far tier's own residency ledger, in declared bytes. */
export function farTierEntryByteCost(entry: FarTierInventoryEntry): number {
  return entry.glbByteSize + entry.atlasByteSize;
}

export interface FarTierResidencyLedger {
  readonly entries: number;
  readonly bytes: number;
}

/**
 * Would admitting this cell keep the far tier inside its OWN ceiling?
 *
 * Returns the refusal message when it would not, so the refusal can be reported
 * with its arithmetic instead of as a silent skip.
 */
export function farTierAdmission(
  resident: FarTierResidencyLedger,
  cost: number,
  budgets: { readonly maxCacheEntries: number; readonly maxCachedBytes: number } = FAR_TIER_RUNTIME_BUDGETS,
): string | null {
  if (resident.entries + 1 > budgets.maxCacheEntries) {
    return `refused: ${resident.entries} tiles are resident and the far-tier ceiling is ${budgets.maxCacheEntries}.`;
  }
  if (resident.bytes + cost > budgets.maxCachedBytes) {
    return `refused: ${cost} bytes on top of ${resident.bytes} resident would exceed the far-tier ceiling of ${budgets.maxCachedBytes} bytes.`;
  }
  return null;
}

/**
 * The buildings whose massing this tile is entitled to hide.
 *
 * SUPPRESSION IS BY MEMBER BUILDING ID, NEVER BY CELL. A cell is not a unit of
 * truth about what was baked: the V3 bake refused some buildings, and each
 * refusal is still owed its massing and its entry in the refusal panel. Hiding
 * a whole cell because a tile arrived would silently erase those refusals and
 * make the panel describe buildings the user can no longer see.
 */
export function farTierSuppressibleBuildingIds(entry: FarTierInventoryEntry): readonly string[] {
  return entry.members.filter((member) => member.included).map((member) => member.buildingId);
}

export interface FarTierStateSummary {
  /**
   * EVERY CELL THE COMMITTED INVENTORY DECLARES, whatever became of it.
   *
   * It used to be `drawn + near`, which read as "declared" and meant "verified",
   * and which under distance-bounded loading would have meant neither. A cell
   * the inventory declares is declared whether its bytes are staged, corrupt or
   * simply too near to fetch, so the column is now the inventory's own count and
   * every other column is a partition of it. (`not-declared` is not the
   * contradiction it looks like: it names a cell with no ANCHOR — an id that
   * encodes no tile rectangle — not a cell missing from the inventory.)
   */
  readonly declared: number;
  readonly drawn: number;
  /** Cells not drawn because of distance — including cells never fetched for it. */
  readonly near: number;
  readonly notDeclared: number;
  readonly absent: number;
  readonly checksumMismatch: number;
  /** Verified bytes that would not build a model. Never a mismatch. */
  readonly buildFailure: number;
  /** Cells refused admission by the far tier's own residency ceiling. */
  readonly overBudget: number;
}

/** Count outcomes into the aggregate. Every failure class keeps its own column. */
export function summarizeFarTierState(outcomes: readonly FarTierLoadOutcome[]): FarTierStateSummary {
  const count = (state: FarTierCellState): number => outcomes.filter((outcome) => outcome.state === state).length;
  return {
    declared: outcomes.length,
    drawn: count("drawn"),
    near: count("near"),
    notDeclared: count("not-declared"),
    absent: count("absent"),
    checksumMismatch: count("checksum-mismatch"),
    buildFailure: count("build-failure"),
    overBudget: count("over-budget"),
  };
}

/**
 * ONE aggregate line, never one notice per cell.
 *
 * A per-cell notice would put up to 883 lines in front of a user to say
 * something that is true of the tier as a whole, and would make a single
 * staging gap look like a catastrophe. Per-cell detail belongs in the
 * container dataset attribute, which is inspectable without being shouted.
 */
export function farTierStatusLine(summary: FarTierStateSummary): string {
  const parts = [`${summary.drawn} drawn`, `${summary.declared} declared`];
  // Named for what the user is actually looking at: the massing, because the
  // camera is inside the near edge. Not a failure, and never counted as one.
  if (summary.near > 0) parts.push(`${summary.near} near (massing drawing)`);
  if (summary.notDeclared > 0) parts.push(`${summary.notDeclared} not declared`);
  if (summary.absent > 0) parts.push(`${summary.absent} absent`);
  if (summary.overBudget > 0) parts.push(`${summary.overBudget} over-budget (refused, drawing massing)`);
  // Named separately and last, so each reads as the distinct class it is: bytes
  // that differ from their declaration, and bytes that matched it and then would
  // not build. Collapsing the second into the first would stop the first meaning
  // anything precise.
  if (summary.checksumMismatch > 0) parts.push(`${summary.checksumMismatch} checksum-mismatch (fail-closed, drawing massing)`);
  if (summary.buildFailure > 0) parts.push(`${summary.buildFailure} build-failure (fail-closed, drawing massing)`);
  return `Far tier · ${parts.join(" · ")}`;
}

/** The states that owe the user a per-cell explanation on the container. */
const FAR_TIER_DETAILED_STATES: readonly FarTierCellState[] = ["absent", "checksum-mismatch", "build-failure", "over-budget"];

/**
 * Per-cell detail for the container dataset attribute, mirroring the
 * `data-exterior-verified-resource-failures` idiom: `cellId: message`, joined
 * by " | ", and ABSENT rather than empty when nothing failed.
 */
export function farTierFailureDetail(outcomes: readonly FarTierLoadOutcome[]): string | null {
  const failures = outcomes.filter((outcome) => (FAR_TIER_DETAILED_STATES as readonly string[]).includes(outcome.state));
  if (failures.length === 0) return null;
  // BOUNDED, BECAUSE THIS BECOMES A DOM ATTRIBUTE.
  //
  // At one staged cell the detail string was at most one clause. At 840 a bad
  // stage could put every cell in it — each clause carries a cell id, a state
  // and a path — and a multi-hundred-kilobyte `data-` attribute is not
  // diagnostics, it is a way to make the inspector unusable and the attribute
  // unreadable by the very sweep that needs it.
  //
  // The cap keeps the FIRST few, in the order the outcomes arrived, and then
  // says how many it did not print. It never silently truncates: a reader who
  // sees the summary knows there is more and knows exactly how much.
  const shown = failures.slice(0, FAR_TIER_FAILURE_DETAIL_LIMIT);
  const detail = shown.map((outcome) => `${outcome.cellId}: ${outcome.state}: ${outcome.detail ?? ""}`).join(" | ");
  const omitted = failures.length - shown.length;
  return omitted === 0 ? detail : `${detail} | (+${omitted} more of ${failures.length} failing cells; see the per-state counts)`;
}
