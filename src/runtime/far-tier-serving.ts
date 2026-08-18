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

import { sha256HexBytes } from "../domain/deterministic-hash";

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
 */
export const FAR_TIER_RUNTIME_BUDGETS = {
  maxCacheEntries: 256,
  maxCachedBytes: 64 * 1024 * 1024,
  additiveTo: "far-tier-hlod-gpu-budget-v1 B3-B5, and the closed criterion #30. Never merged with either.",
} as const;

/** Where staged far-tier bytes are served from. Its own root, not a release audience. */
export const FAR_TIER_SERVING_ROOT = "far-tier" as const;

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
 * The five states a cell can be in, and they are FIVE, not four.
 *
 * `checksum-mismatch` is never folded into `absent`. Absence is a staging gap —
 * the operator has not put the bytes there yet — and it is ordinary. A checksum
 * mismatch is an INTEGRITY FAILURE: bytes exist at the path and are not the
 * bytes that were declared. Reporting the second as the first would turn the
 * loudest signal this path can produce into routine background noise.
 *
 * `near` is neither. It is a verified tile that the camera is simply too close
 * to draw coarsely, so the massing is showing instead — the tier working as
 * designed. It is counted separately from both failure states precisely so a
 * session spent inside the near edge does not read as a broken far tier.
 */
export const FAR_TIER_CELL_STATES = ["declared", "drawn", "near", "not-declared", "absent", "checksum-mismatch"] as const;
export type FarTierCellState = (typeof FAR_TIER_CELL_STATES)[number];

export interface FarTierLoadOutcome {
  readonly cellId: string;
  readonly state: FarTierCellState;
  /** Present only for the two failure states, for the per-cell detail attribute. */
  readonly detail?: string;
}

export type FarTierFetcher = (relativeRef: string, signal?: AbortSignal) => Promise<Uint8Array>;

/**
 * Fetch and verify one tile's bytes, failing CLOSED and distinguishing why.
 *
 * Byte size is checked before the digest so a truncated or padded response is
 * named for what it is rather than reported as a hash failure.
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
  if (bytes.byteLength !== entry.glbByteSize) {
    return { outcome: { cellId: entry.cellId, state: "checksum-mismatch", detail: `${ref}: returned ${bytes.byteLength} bytes; ${entry.glbByteSize} were declared.` } };
  }
  if (sha256HexBytes(bytes) !== entry.glbSha256) {
    return { outcome: { cellId: entry.cellId, state: "checksum-mismatch", detail: `${ref}: failed its declared SHA-256.` } };
  }
  return { outcome: { cellId: entry.cellId, state: "declared" }, bytes };
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
  readonly declared: number;
  readonly drawn: number;
  /** Verified tiles held back because the camera is inside the near edge. */
  readonly near: number;
  readonly notDeclared: number;
  readonly absent: number;
  readonly checksumMismatch: number;
}

/** Count outcomes into the aggregate. Mismatch keeps its own column. */
export function summarizeFarTierState(outcomes: readonly FarTierLoadOutcome[]): FarTierStateSummary {
  const count = (state: FarTierCellState): number => outcomes.filter((outcome) => outcome.state === state).length;
  return {
    declared: count("declared") + count("drawn") + count("near"),
    drawn: count("drawn"),
    near: count("near"),
    notDeclared: count("not-declared"),
    absent: count("absent"),
    checksumMismatch: count("checksum-mismatch"),
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
  // Named separately and last, so it reads as the distinct integrity class it is.
  if (summary.checksumMismatch > 0) parts.push(`${summary.checksumMismatch} checksum-mismatch (fail-closed, drawing massing)`);
  return `Far tier · ${parts.join(" · ")}`;
}

/**
 * Per-cell detail for the container dataset attribute, mirroring the
 * `data-exterior-verified-resource-failures` idiom: `cellId: message`, joined
 * by " | ", and ABSENT rather than empty when nothing failed.
 */
export function farTierFailureDetail(outcomes: readonly FarTierLoadOutcome[]): string | null {
  const failures = outcomes.filter((outcome) => outcome.detail && (outcome.state === "absent" || outcome.state === "checksum-mismatch"));
  if (failures.length === 0) return null;
  return failures.map((outcome) => `${outcome.cellId}: ${outcome.state}: ${outcome.detail}`).join(" | ");
}
