/**
 * Immutable Manhattan exterior wave ledger (Task T011).
 *
 * This module derives the canonical `ExteriorOwnershipLedger` for the approved
 * `manhattan-citywide-20260804` snapshot.  It owns four decisions and nothing
 * else:
 *
 * 1. **Membership** is the frozen shard grouping of the accepted citywide
 *    snapshot.  No centroid, footprint, or boundary geometry is recomputed
 *    here, so this module can never become a second, drifting geographic
 *    authority next to the snapshot builder.
 * 2. **Waves** are inclusive level-14 tile-row (`y`) ranges.  The WGS84
 *    geodetic scheme in `../runtime/spatial.ts` increases `y` southwards, so a
 *    larger `y` is further south and "south-to-north" is descending `y`.
 * 3. **Cell sizing** caps membership so one atomically loaded cell always fits
 *    inside the accepted exterior runtime budgets.  Over-cap level-14 tiles are
 *    recursively split into their four children in the same WGS84 tile scheme.
 * 4. **Ordering** is a contiguous global `order` whose sequence is embedded in
 *    the `cellId`, so the accepted runtime's lexicographic `cellIds()` sort
 *    reproduces visual priority without any change to `src/runtime/`.
 *
 * `validateExteriorReleaseGraph` in `./exterior-release.ts` remains the schema
 * authority: this module never re-implements its invariants, it invokes it.
 */

import { BLOCK_835_DOITT_IDS } from "../domain/commercial-frontage.ts";
import { parseTileKey, tileBounds, tileKeyForCoordinate, tileKeyString, type TileKey } from "../runtime/spatial.ts";
import { sha256HexSync, stableSerialize } from "./catalog-release.ts";
import {
  EXTERIOR_RELEASE_SCHEMA_VERSION,
  validateExteriorReleaseGraph,
  validateExteriorReleaseStructure,
  type ExteriorOwnershipCell,
  type ExteriorOwnershipLedger,
  type ExteriorReleaseIssue,
  type Wgs84Bounds,
} from "./exterior-release.ts";

export const EXTERIOR_WAVE_LEDGER_SCHEMA_VERSION = "1.0" as const;

/** Sibling artifacts (digest, eligibility) live beside the ledger, never inside it. */
export const EXTERIOR_WAVE_LEDGER_RELEASE_ID = "manhattan-exterior-wave-ledger-20260804" as const;
export const EXTERIOR_WAVE_LEDGER_CITY_ID = "city:manhattan" as const;
export const EXTERIOR_WAVE_LEDGER_CONFIG_ID = "config:manhattan-exterior" as const;

/** The one base snapshot this ledger may be derived from. */
export const EXTERIOR_WAVE_BASE_RELEASE_ID = "manhattan-citywide-20260804" as const;
export const EXTERIOR_WAVE_BASE_BUILDING_COUNT = 45_194 as const;

/** Level-14 WGS84 geodetic tiles are the wave and cell substrate. */
export const EXTERIOR_WAVE_TILE_LEVEL = 14 as const;

/**
 * Recursive splitting stops here and fails closed.  Level 24 is ~0.65 m of
 * latitude, far below any plausible building spacing, so exhausting it means
 * the input is degenerate rather than merely dense.
 */
export const EXTERIOR_CELL_MAX_TILE_LEVEL = 24 as const;

/**
 * Maximum canonical buildings per ownership cell.
 *
 * Derivation against the accepted runtime budgets in
 * `src/runtime/exterior-cell-runtime.ts` (`maxCacheEntries: 256`,
 * `maxCachedBytes: 256 MiB`):
 *
 * - A cell loads atomically: every available building in the cell contributes
 *   one selected-LOD GLB cache entry per render, so a single cell load costs
 *   `buildings` entries.  120 <= 256 therefore makes one cell individually
 *   loadable with 53% of the cache still free.
 * - Bytes are not the binding constraint.  The Stage 3 pilot measured 28 GLBs
 *   (14 buildings x 2 LODs) at 2,457,444 bytes, i.e. ~87.8 KiB per asset and
 *   ~171 KiB per building for both LODs.  120 buildings x both LODs is about
 *   20.1 MiB, roughly 8% of the 256 MiB ceiling.
 *
 * What this cap does **not** buy:
 *
 * - It is not a 16-entry safety margin.  A predecessor-fallback load re-runs
 *   `verifyCellRelease`, so one fallback load of a full cell can approach
 *   `2 x buildings` (~238) entries while the earliest entries are still
 *   resident, leaving the 256-entry cache effectively saturated by a single
 *   cell.
 * - The 256-entry cache is **shared across all cells**.  This cap bounds
 *   per-cell atomicity only; it says nothing about the cache budget once more
 *   than one cell is resident, which is the normal multi-cell case.
 *
 * Cache pressure in multi-cell operation is therefore a runtime scheduling
 * concern for T013+, not something a per-cell membership cap can solve.
 */
export const EXTERIOR_CELL_MAX_BUILDINGS = 120 as const;

export type ExteriorWaveId =
  | "block-835"
  | "midtown-core"
  | "lower-manhattan"
  | "southern-remainder"
  | "central-upper-manhattan"
  | "northern-manhattan";

export interface ExteriorWaveDefinition {
  waveIndex: number;
  waveId: ExteriorWaveId;
  /**
   * Inclusive level-14 tile rows.  `northRowY` is the smaller `y` (further
   * north) and `southRowY` the larger `y` (further south).  `null` marks the
   * declared-set wave that is carved out of a tile rather than owning rows.
   */
  tileRowRange: { northRowY: number; southRowY: number } | null;
}

/**
 * Occupied level-14 tile rows of the accepted citywide snapshot.  Waves 1..5
 * must partition this closed interval exactly once.
 */
export const EXTERIOR_WAVE_TILE_ROW_ENVELOPE = { northRowY: 4471, southRowY: 4488 } as const;

/** Level-14 tile that physically contains Block 835. */
export const BLOCK_835_TILE_KEY = "wgs84-geodetic/14/4824/4482" as const;

/**
 * Declared assignment bounds for the Block 835 cell: the frozen public-realm
 * clip rectangle of `manhattan-esb-block-public-realm-20260806`.  These bounds
 * are a *declaration*, never a membership rule -- the clip rectangle contains
 * 62 citywide buildings while Block 835 is the 14 declared DOITT ids.
 */
export const BLOCK_835_CELL_BOUNDS: Wgs84Bounds = {
  west: -73.988311361,
  south: 40.747617192,
  east: -73.984408373,
  north: 40.749932441,
};

/**
 * Wave order and coverage.
 *
 * The Goal fixes the order: Block 835, then Midtown core, then Lower
 * Manhattan, then every remaining Manhattan cell in deterministic
 * south-to-north order.  District names are labels only; these tile-row ranges
 * are the coverage contract.  Rationale for each range is recorded in
 * `docs/decisions/0024-exterior-wave-ledger.md`.
 */
export const EXTERIOR_WAVE_PLAN: readonly ExteriorWaveDefinition[] = [
  { waveIndex: 0, waveId: "block-835", tileRowRange: null },
  { waveIndex: 1, waveId: "midtown-core", tileRowRange: { northRowY: 4481, southRowY: 4482 } },
  { waveIndex: 2, waveId: "lower-manhattan", tileRowRange: { northRowY: 4485, southRowY: 4488 } },
  { waveIndex: 3, waveId: "southern-remainder", tileRowRange: { northRowY: 4483, southRowY: 4484 } },
  { waveIndex: 4, waveId: "central-upper-manhattan", tileRowRange: { northRowY: 4478, southRowY: 4480 } },
  { waveIndex: 5, waveId: "northern-manhattan", tileRowRange: { northRowY: 4471, southRowY: 4477 } },
];

/**
 * The cell-id order field is zero-padded to six digits, so the scheme encodes
 * at most this many cells and generation fails closed beyond it rather than
 * silently breaking the lexicographic ordering guarantee.
 */
const MAX_ORDERED_CELLS = 999_999;

const CELL_ID_PREFIX = "manhattan-exterior-cell-" as const;
const BLOCK_835_CELL_SUFFIX = "block-00835" as const;
const CELL_ID_PATTERN = /^manhattan-exterior-cell-w(\d{2})-(\d{6})-(block-00835|14-\d+-\d+|1[5-9]-\d+-\d+|2[0-4]-\d+-\d+)$/u;

/** Hash domains keep unlike contracts from colliding on the same digest space. */
const LEDGER_ID_DOMAIN = "udt:exterior:wave-ledger:id:v1";
const BASE_IDENTITY_DOMAIN = "udt:exterior:wave-ledger:base-identity:v1";
const PROBE_DOMAIN = "udt:exterior:wave-ledger:graph-probe:v1";

export interface ExteriorBaseBuildingRef {
  buildingId: string;
  longitude: number;
  latitude: number;
}

export interface ExteriorBaseShardGroup {
  /** Canonical level-14 tile key string, exactly as recorded by the snapshot. */
  tileKey: string;
  buildings: readonly ExteriorBaseBuildingRef[];
}

export interface ExteriorWaveLedgerInput {
  baseReleaseId: string;
  /** SHA-256 of the accepted citywide `manifest.json` bytes. */
  baseManifestChecksumSha256: string;
  shardGroups: readonly ExteriorBaseShardGroup[];
  cityId?: string;
  configId?: string;
  maxCellBuildings?: number;
}

export interface ExteriorWaveSummary {
  waveIndex: number;
  waveId: ExteriorWaveId;
  tileRowRange: { northRowY: number; southRowY: number } | null;
  cellCount: number;
  buildingCount: number;
}

export interface ExteriorWaveLedgerDigestCell {
  cellId: string;
  order: number;
  waveIndex: number;
  waveId: ExteriorWaveId;
  bounds: Wgs84Bounds;
  buildingCount: number;
  membershipChecksumSha256: string;
}

export interface ExteriorWaveLedgerDigest {
  schemaVersion: typeof EXTERIOR_WAVE_LEDGER_SCHEMA_VERSION;
  ledgerId: string;
  ledgerChecksumSha256: string;
  cityId: string;
  configId: string;
  baseReleaseId: string;
  baseManifestChecksumSha256: string;
  baseIdentitySet: { id: string; checksumSha256: string; buildingCount: number };
  coverage: Wgs84Bounds;
  maxCellBuildings: number;
  cellCount: number;
  maxObservedCellBuildings: number;
  waves: readonly ExteriorWaveSummary[];
  cells: readonly ExteriorWaveLedgerDigestCell[];
}

export interface ExteriorLedgerCellEligibility {
  cellId: string;
  privateEligible: boolean;
  publicEligible: boolean;
}

export interface ExteriorLedgerEligibility {
  schemaVersion: typeof EXTERIOR_WAVE_LEDGER_SCHEMA_VERSION;
  ledgerId: string;
  ledgerChecksumSha256: string;
  basis: string;
  cells: readonly ExteriorLedgerCellEligibility[];
}

export interface ExteriorWaveLedgerBuild {
  ledger: ExteriorOwnershipLedger;
  digest: ExteriorWaveLedgerDigest;
  eligibility: ExteriorLedgerEligibility;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const BLOCK_835_BUILDING_IDS: readonly string[] = BLOCK_835_DOITT_IDS.map((id) => `doitt:${id}`);

export function block835BuildingIds(): string[] {
  return [...BLOCK_835_BUILDING_IDS];
}

function digestOf(domain: string, payload: unknown): string {
  return sha256HexSync(stableSerialize({ domain, payload }));
}

export interface ExteriorBaseIdentitySetIdInput {
  baseReleaseId: string;
  baseManifestChecksumSha256: string;
  buildingCount: number;
  membershipChecksumSha256: string;
}

/**
 * Derives `baseIdentitySet.id` from the base lineage only, so it stays stable
 * across re-partitions of the same pinned snapshot.
 */
export function deriveExteriorBaseIdentitySetId(input: ExteriorBaseIdentitySetIdInput): string {
  const digest = digestOf(BASE_IDENTITY_DOMAIN, {
    baseReleaseId: input.baseReleaseId,
    baseManifestChecksumSha256: input.baseManifestChecksumSha256,
    buildingCount: input.buildingCount,
    membershipChecksumSha256: input.membershipChecksumSha256,
  });
  return `${input.baseReleaseId}:exterior-base-identity:${digest.slice(0, 16)}`;
}

export interface ExteriorWaveLedgerIdInput {
  baseReleaseId: string;
  baseManifestChecksumSha256: string;
  baseIdentitySetId: string;
  cityId: string;
  configId: string;
  maxCellBuildings: number;
  coverage: Wgs84Bounds;
  cells: readonly ExteriorOwnershipCell[];
}

/**
 * Derives `ledgerId` from the base lineage *and* the full partition, so any
 * change to the snapshot or to the cell layout yields a different ledger.
 */
export function deriveExteriorWaveLedgerId(input: ExteriorWaveLedgerIdInput): string {
  const digest = digestOf(LEDGER_ID_DOMAIN, {
    baseReleaseId: input.baseReleaseId,
    baseManifestChecksumSha256: input.baseManifestChecksumSha256,
    baseIdentitySetId: input.baseIdentitySetId,
    cityId: input.cityId,
    configId: input.configId,
    maxCellBuildings: input.maxCellBuildings,
    wavePlan: EXTERIOR_WAVE_PLAN,
    coverage: input.coverage,
    cells: [...input.cells]
      .sort((left, right) => left.order - right.order)
      .map((cell) => ({ cellId: cell.cellId, order: cell.order, bounds: cell.bounds, membershipChecksumSha256: cell.membershipChecksumSha256 })),
  });
  return `${EXTERIOR_WAVE_LEDGER_RELEASE_ID}-${digest.slice(0, 16)}`;
}

export function membershipChecksum(buildingIds: readonly string[]): string {
  return sha256HexSync(stableSerialize([...buildingIds].sort()));
}

export function serializeExteriorArtifact(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Canonical checksum of an emitted artifact: SHA-256 over its exact bytes. */
export function exteriorArtifactChecksum(value: unknown): string {
  return sha256HexSync(serializeExteriorArtifact(value));
}

function sortedIds(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function unionBounds(bounds: readonly Wgs84Bounds[]): Wgs84Bounds {
  const first = bounds[0];
  if (!first) throw new Error("Exterior coverage requires at least one cell.");
  return bounds.reduce<Wgs84Bounds>((accumulator, entry) => ({
    west: Math.min(accumulator.west, entry.west),
    south: Math.min(accumulator.south, entry.south),
    east: Math.max(accumulator.east, entry.east),
    north: Math.max(accumulator.north, entry.north),
  }), { ...first });
}

function waveForRow(rowY: number): ExteriorWaveDefinition | undefined {
  return EXTERIOR_WAVE_PLAN.find((wave) => wave.tileRowRange !== null && rowY >= wave.tileRowRange.northRowY && rowY <= wave.tileRowRange.southRowY);
}

function ancestorTile(tile: TileKey, level: number): TileKey {
  if (tile.level < level) throw new Error("Cannot take an ancestor above the requested level.");
  const factor = 2 ** (tile.level - level);
  return { scheme: "wgs84-geodetic", level, x: Math.floor(tile.x / factor), y: Math.floor(tile.y / factor) };
}

function cellIdFor(waveIndex: number, order: number, suffix: string): string {
  return `${CELL_ID_PREFIX}w${String(waveIndex).padStart(2, "0")}-${String(order).padStart(6, "0")}-${suffix}`;
}

function tileSuffix(tile: TileKey): string {
  return `${tile.level}-${tile.x}-${tile.y}`;
}

/** Parses the tile encoded in a cell id, or `null` for the declared-set cell. */
export function cellTileKey(cellId: string): TileKey | null {
  const match = CELL_ID_PATTERN.exec(cellId);
  if (!match) throw new Error(`Cell id ${cellId} does not follow the exterior wave cell scheme.`);
  const suffix = match[3]!;
  if (suffix === BLOCK_835_CELL_SUFFIX) return null;
  const [level, x, y] = suffix.split("-").map(Number);
  return parseTileKey(`wgs84-geodetic/${level}/${x}/${y}`);
}

export function cellWaveIndex(cellId: string): number {
  const match = CELL_ID_PATTERN.exec(cellId);
  if (!match) throw new Error(`Cell id ${cellId} does not follow the exterior wave cell scheme.`);
  return Number(match[1]);
}

export function cellWaveId(cellId: string): ExteriorWaveId {
  const wave = EXTERIOR_WAVE_PLAN[cellWaveIndex(cellId)];
  if (!wave) throw new Error(`Cell id ${cellId} names an undefined wave.`);
  return wave.waveId;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

interface PendingCell {
  waveIndex: number;
  tile: TileKey | null;
  anchorTile: TileKey;
  bounds: Wgs84Bounds;
  buildingIds: string[];
}

function splitTile(tile: TileKey, members: readonly ExteriorBaseBuildingRef[], cap: number, out: { tile: TileKey; members: ExteriorBaseBuildingRef[] }[]): void {
  if (members.length <= cap) {
    out.push({ tile, members: [...members] });
    return;
  }
  if (tile.level >= EXTERIOR_CELL_MAX_TILE_LEVEL) {
    throw new Error(`Tile ${tileKeyString(tile)} still holds ${members.length} buildings at the maximum split level ${EXTERIOR_CELL_MAX_TILE_LEVEL}; the exterior cell cap cannot be met.`);
  }
  const children = new Map<string, { tile: TileKey; members: ExteriorBaseBuildingRef[] }>();
  for (const member of members) {
    const child = tileKeyForCoordinate(member.longitude, member.latitude, tile.level + 1);
    const key = tileKeyString(child);
    const bucket = children.get(key) ?? { tile: child, members: [] };
    bucket.members.push(member);
    children.set(key, bucket);
  }
  for (const key of sortedIds(children.keys())) {
    const bucket = children.get(key)!;
    splitTile(bucket.tile, bucket.members, cap, out);
  }
}

function comparePending(left: PendingCell, right: PendingCell): number {
  if (left.waveIndex !== right.waveIndex) return left.waveIndex - right.waveIndex;
  // South-to-north over level-14 tile rows: descending y.
  if (left.anchorTile.y !== right.anchorTile.y) return right.anchorTile.y - left.anchorTile.y;
  // West-to-east over level-14 tile columns: ascending x.
  if (left.anchorTile.x !== right.anchorTile.x) return left.anchorTile.x - right.anchorTile.x;
  // Leaves inside one level-14 tile keep the same south-to-north, west-to-east rule.
  if (left.bounds.south !== right.bounds.south) return right.bounds.south - left.bounds.south;
  if (left.bounds.west !== right.bounds.west) return left.bounds.west - right.bounds.west;
  const leftLevel = left.tile?.level ?? 0;
  const rightLevel = right.tile?.level ?? 0;
  if (leftLevel !== rightLevel) return leftLevel - rightLevel;
  const leftY = left.tile?.y ?? 0;
  const rightY = right.tile?.y ?? 0;
  if (leftY !== rightY) return leftY - rightY;
  return (left.tile?.x ?? 0) - (right.tile?.x ?? 0);
}

/**
 * Builds the canonical ledger plus its sibling digest and eligibility
 * artifacts.  Fails closed on any input the contract cannot describe.
 */
export function buildExteriorWaveLedger(input: ExteriorWaveLedgerInput): ExteriorWaveLedgerBuild {
  const cityId = input.cityId ?? EXTERIOR_WAVE_LEDGER_CITY_ID;
  const configId = input.configId ?? EXTERIOR_WAVE_LEDGER_CONFIG_ID;
  const cap = input.maxCellBuildings ?? EXTERIOR_CELL_MAX_BUILDINGS;
  if (!Number.isSafeInteger(cap) || cap < 1) throw new Error("Exterior cell cap must be a positive integer.");
  if (!/^[a-f0-9]{64}$/u.test(input.baseManifestChecksumSha256)) throw new Error("Base manifest checksum must be a lowercase SHA-256 digest.");
  if (input.shardGroups.length === 0) throw new Error("Exterior wave ledger requires at least one base shard group.");

  // 1. Fold the frozen shard grouping into one membership per level-14 tile.
  const perTile = new Map<string, { tile: TileKey; members: ExteriorBaseBuildingRef[] }>();
  const seen = new Set<string>();
  for (const group of input.shardGroups) {
    const tile = parseTileKey(group.tileKey);
    if (tile.level !== EXTERIOR_WAVE_TILE_LEVEL) throw new Error(`Base shard ${group.tileKey} is not a level-${EXTERIOR_WAVE_TILE_LEVEL} tile.`);
    const bucket = perTile.get(group.tileKey) ?? { tile, members: [] };
    for (const member of group.buildings) {
      if (!member.buildingId.trim()) throw new Error("Base building ids must be non-empty.");
      if (seen.has(member.buildingId)) throw new Error(`Base building ${member.buildingId} appears in more than one shard; the frozen grouping is not a partition.`);
      if (!Number.isFinite(member.longitude) || !Number.isFinite(member.latitude)) throw new Error(`Base building ${member.buildingId} has a non-finite representative coordinate.`);
      seen.add(member.buildingId);
      bucket.members.push(member);
    }
    perTile.set(group.tileKey, bucket);
  }

  // 2. Carve the declared Block 835 set out of its containing tile.
  const blockTile = perTile.get(BLOCK_835_TILE_KEY);
  if (!blockTile) throw new Error(`Base snapshot has no ${BLOCK_835_TILE_KEY} shard, so Block 835 cannot be carved out.`);
  const blockSet = new Set(BLOCK_835_BUILDING_IDS);
  const blockMembers = blockTile.members.filter((member) => blockSet.has(member.buildingId));
  if (blockMembers.length !== BLOCK_835_BUILDING_IDS.length) {
    throw new Error(`Block 835 declares ${BLOCK_835_BUILDING_IDS.length} buildings but only ${blockMembers.length} are present in ${BLOCK_835_TILE_KEY}.`);
  }
  blockTile.members = blockTile.members.filter((member) => !blockSet.has(member.buildingId));

  // 3. Assign waves by tile row and split every over-cap tile.
  const pending: PendingCell[] = [{
    waveIndex: 0,
    tile: null,
    anchorTile: parseTileKey(BLOCK_835_TILE_KEY),
    bounds: { ...BLOCK_835_CELL_BOUNDS },
    buildingIds: sortedIds(blockMembers.map((member) => member.buildingId)),
  }];

  for (const key of sortedIds(perTile.keys())) {
    const bucket = perTile.get(key)!;
    if (bucket.members.length === 0) continue;
    const wave = waveForRow(bucket.tile.y);
    if (!wave) throw new Error(`Level-14 tile row ${bucket.tile.y} (${key}) is outside every declared exterior wave range.`);
    const leaves: { tile: TileKey; members: ExteriorBaseBuildingRef[] }[] = [];
    splitTile(bucket.tile, bucket.members, cap, leaves);
    for (const leaf of leaves) {
      pending.push({
        waveIndex: wave.waveIndex,
        tile: leaf.tile,
        anchorTile: bucket.tile,
        bounds: tileBounds(leaf.tile),
        buildingIds: sortedIds(leaf.members.map((member) => member.buildingId)),
      });
    }
  }

  // 4. Global visual-priority order, embedded in each cell id.
  pending.sort(comparePending);
  if (pending.length > MAX_ORDERED_CELLS) {
    throw new Error(`Partition produced ${pending.length} cells; the ${String(MAX_ORDERED_CELLS).length}-digit cell-id order field cannot encode more than ${MAX_ORDERED_CELLS}.`);
  }
  const cells: ExteriorOwnershipCell[] = pending.map((entry, order) => ({
    cellId: cellIdFor(entry.waveIndex, order, entry.tile ? tileSuffix(entry.tile) : BLOCK_835_CELL_SUFFIX),
    order,
    bounds: entry.bounds,
    buildingIds: entry.buildingIds,
    membershipChecksumSha256: membershipChecksum(entry.buildingIds),
  }));

  // 5. Ledger identity: base lineage for the identity set, base + partition for
  //    the ledger itself, each in its own hash domain.
  const allBuildingIds = sortedIds(cells.flatMap((cell) => cell.buildingIds));
  const baseIdentityChecksum = membershipChecksum(allBuildingIds);
  const baseIdentitySet = {
    id: deriveExteriorBaseIdentitySetId({
      baseReleaseId: input.baseReleaseId,
      baseManifestChecksumSha256: input.baseManifestChecksumSha256,
      buildingCount: allBuildingIds.length,
      membershipChecksumSha256: baseIdentityChecksum,
    }),
    checksumSha256: baseIdentityChecksum,
    buildingCount: allBuildingIds.length,
  };
  const coverage = unionBounds(cells.map((cell) => cell.bounds));

  const ledger: ExteriorOwnershipLedger = {
    schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
    ledgerId: deriveExteriorWaveLedgerId({
      baseReleaseId: input.baseReleaseId,
      baseManifestChecksumSha256: input.baseManifestChecksumSha256,
      baseIdentitySetId: baseIdentitySet.id,
      cityId,
      configId,
      maxCellBuildings: cap,
      coverage,
      cells,
    }),
    cityId,
    configId,
    immutable: true,
    baseIdentitySet,
    coverage,
    cells,
  };

  const ledgerChecksumSha256 = exteriorArtifactChecksum(ledger);
  return {
    ledger,
    digest: exteriorWaveLedgerDigest(ledger, {
      ledgerChecksumSha256,
      baseReleaseId: input.baseReleaseId,
      baseManifestChecksumSha256: input.baseManifestChecksumSha256,
      maxCellBuildings: cap,
    }),
    eligibility: exteriorLedgerEligibility(ledger, ledgerChecksumSha256),
  };
}

// ---------------------------------------------------------------------------
// Sibling artifacts
// ---------------------------------------------------------------------------

export interface ExteriorWaveLedgerDigestOptions {
  ledgerChecksumSha256: string;
  baseReleaseId: string;
  baseManifestChecksumSha256: string;
  maxCellBuildings?: number;
}

export function exteriorWaveLedgerDigest(ledger: ExteriorOwnershipLedger, options: ExteriorWaveLedgerDigestOptions): ExteriorWaveLedgerDigest {
  const cap = options.maxCellBuildings ?? EXTERIOR_CELL_MAX_BUILDINGS;
  const cells: ExteriorWaveLedgerDigestCell[] = [...ledger.cells]
    .sort((left, right) => left.order - right.order)
    .map((cell) => ({
      cellId: cell.cellId,
      order: cell.order,
      waveIndex: cellWaveIndex(cell.cellId),
      waveId: cellWaveId(cell.cellId),
      bounds: cell.bounds,
      buildingCount: cell.buildingIds.length,
      membershipChecksumSha256: cell.membershipChecksumSha256,
    }));
  const waves: ExteriorWaveSummary[] = EXTERIOR_WAVE_PLAN.map((wave) => {
    const owned = cells.filter((cell) => cell.waveIndex === wave.waveIndex);
    return {
      waveIndex: wave.waveIndex,
      waveId: wave.waveId,
      tileRowRange: wave.tileRowRange,
      cellCount: owned.length,
      buildingCount: owned.reduce((total, cell) => total + cell.buildingCount, 0),
    };
  });
  return {
    schemaVersion: EXTERIOR_WAVE_LEDGER_SCHEMA_VERSION,
    ledgerId: ledger.ledgerId,
    ledgerChecksumSha256: options.ledgerChecksumSha256,
    cityId: ledger.cityId,
    configId: ledger.configId,
    baseReleaseId: options.baseReleaseId,
    baseManifestChecksumSha256: options.baseManifestChecksumSha256,
    baseIdentitySet: { ...ledger.baseIdentitySet },
    coverage: ledger.coverage,
    maxCellBuildings: cap,
    cellCount: cells.length,
    maxObservedCellBuildings: cells.reduce((maximum, cell) => Math.max(maximum, cell.buildingCount), 0),
    waves,
    cells,
  };
}

/**
 * Audience eligibility is a T011-owned sibling artifact, not a ledger field:
 * `validateExteriorReleaseGraph` closes the ledger and cell key sets exactly,
 * so widening them here would break the accepted schema authority.
 *
 * v1 declares every cell private-eligible and no cell public-eligible: public
 * conveyance requires promotion evidence that no exterior asset has yet earned.
 */
export function exteriorLedgerEligibility(ledger: ExteriorOwnershipLedger, ledgerChecksumSha256: string): ExteriorLedgerEligibility {
  return {
    schemaVersion: EXTERIOR_WAVE_LEDGER_SCHEMA_VERSION,
    ledgerId: ledger.ledgerId,
    ledgerChecksumSha256,
    basis: "Ledger membership is private-eligible only. No cell is public-eligible until a promotion task supplies per-cell rights-cleared evidence; this artifact never widens the accepted ownership ledger schema.",
    cells: [...ledger.cells]
      .sort((left, right) => left.order - right.order)
      .map((cell) => ({ cellId: cell.cellId, privateEligible: true, publicEligible: false })),
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function issue(issues: ExteriorReleaseIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

/**
 * Re-homes probe-graph diagnostics onto the ledger.  Only the ledger is under
 * test here, so an issue reported at a synthetic root path (for example an
 * unusable `ledgerId` that a root cannot pin) must read as a ledger issue and
 * never as a claim about a real root manifest.
 */
function probePath(entry: ExteriorReleaseIssue): ExteriorReleaseIssue {
  if (entry.path === "ownershipLedger" || entry.path.startsWith("ownershipLedger.")) return entry;
  return { path: `ownershipLedger[probe:${entry.path}]`, message: entry.message };
}

/**
 * Wraps a bare ledger in the smallest structurally complete release graph so
 * the accepted `validateExteriorReleaseGraph` can adjudicate it.  These roots
 * are a validation probe: they are never serialized, published, or treated as
 * approval evidence, and T011 emits no root manifest at all.
 */
function ledgerGraphProbe(ledger: ExteriorOwnershipLedger): unknown {
  const probeApproval = (audience: string) => ({
    id: `probe:${audience}:${ledger.ledgerId}`,
    fingerprintSha256: digestOf(PROBE_DOMAIN, { audience, ledgerId: ledger.ledgerId, field: "approval" }),
    scope: "Structural validation probe for the canonical exterior ownership ledger; never published.",
    exclusions: ["publication", "promotion", "approval evidence"],
    approvedAt: "2026-08-10T00:00:00.000Z",
  });
  const root = (audience: "private" | "public") => ({
    schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
    audience,
    rootId: `probe-root:${audience}:${ledger.ledgerId}`,
    rootChecksumSha256: digestOf(PROBE_DOMAIN, { audience, ledgerId: ledger.ledgerId, field: "root" }),
    releaseId: `probe-release:${audience}:${ledger.ledgerId}`,
    cityId: ledger.cityId,
    configId: ledger.configId,
    generatedAt: "2026-08-10T00:00:00.000Z",
    immutable: true,
    artifactAllowlist: [`${audience}/ownership-ledger.json`],
    artifacts: [{
      logicalId: ledger.ledgerId,
      kind: "ownership-ledger",
      relativeRef: `${audience}/ownership-ledger.json`,
      byteSize: 0,
      checksumSha256: digestOf(PROBE_DOMAIN, { audience, ledgerId: ledger.ledgerId, field: "artifact" }),
    }],
    approval: probeApproval(audience),
    predecessor: null,
    privatePredecessor: null,
  });
  return {
    schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
    roots: [root("private"), root("public")],
    ownershipLedger: ledger,
    cellReleases: [],
    inventoryShards: [],
    evidenceShards: [],
    snapshots: [],
  };
}

/**
 * Validates a candidate ledger against the accepted release-graph schema and
 * the additional T011 wave invariants.
 */
export function validateExteriorWaveLedger(value: unknown, options: { maxCellBuildings?: number } = {}): { ok: true; value: ExteriorOwnershipLedger } | { ok: false; issues: ExteriorReleaseIssue[] } {
  const cap = options.maxCellBuildings ?? EXTERIOR_CELL_MAX_BUILDINGS;
  // Fail closed before the probe touches the candidate: an absent or non-object
  // ledger is a validation result, never a thrown TypeError.
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, issues: [{ path: "ownershipLedger", message: "Canonical ownership ledger must be an object." }] };
  }
  const probe = ledgerGraphProbe(value as ExteriorOwnershipLedger);
  // The accepted validator stays the schema authority.  Structure first, so a
  // shape failure never gets re-diagnosed here; then the full graph pass, whose
  // issues are merged with the T011 wave invariants rather than short-circuiting
  // them, so one run reports every problem.
  const structure = validateExteriorReleaseStructure(probe);
  if (!structure.ok) return { ok: false, issues: structure.issues.map(probePath) };
  const ledger = structure.value.ownershipLedger;
  const graph = validateExteriorReleaseGraph(probe);
  const issues: ExteriorReleaseIssue[] = graph.ok ? [] : graph.issues.map(probePath);

  // Wave plan must partition the declared occupied tile-row envelope exactly.
  const rowOwners = new Map<number, ExteriorWaveId>();
  for (const wave of EXTERIOR_WAVE_PLAN) {
    if (wave.tileRowRange === null) continue;
    if (wave.tileRowRange.northRowY > wave.tileRowRange.southRowY) issue(issues, `wavePlan.${wave.waveId}`, "Wave tile-row range must run north row <= south row.");
    for (let rowY = wave.tileRowRange.northRowY; rowY <= wave.tileRowRange.southRowY; rowY += 1) {
      if (rowOwners.has(rowY)) issue(issues, `wavePlan.${wave.waveId}`, `Tile row ${rowY} is claimed by more than one wave.`);
      rowOwners.set(rowY, wave.waveId);
    }
  }
  for (let rowY = EXTERIOR_WAVE_TILE_ROW_ENVELOPE.northRowY; rowY <= EXTERIOR_WAVE_TILE_ROW_ENVELOPE.southRowY; rowY += 1) {
    if (!rowOwners.has(rowY)) issue(issues, "wavePlan", `Occupied tile row ${rowY} belongs to no wave.`);
  }
  for (const rowY of rowOwners.keys()) {
    if (rowY < EXTERIOR_WAVE_TILE_ROW_ENVELOPE.northRowY || rowY > EXTERIOR_WAVE_TILE_ROW_ENVELOPE.southRowY) issue(issues, "wavePlan", `Wave tile row ${rowY} is outside the declared occupied envelope.`);
  }
  // Waves 3..5 must stay in south-to-north order.
  const remainder = EXTERIOR_WAVE_PLAN.filter((wave) => wave.waveIndex >= 3 && wave.tileRowRange !== null);
  for (let index = 1; index < remainder.length; index += 1) {
    const previous = remainder[index - 1]!.tileRowRange!;
    const current = remainder[index]!.tileRowRange!;
    if (current.southRowY >= previous.northRowY) issue(issues, "wavePlan", `Wave ${remainder[index]!.waveId} does not continue strictly northwards from ${remainder[index - 1]!.waveId}.`);
  }

  // Cell ids, ordering, wave membership, bounds semantics, and the cap.
  const byOrder = [...ledger.cells].sort((left, right) => left.order - right.order);
  const lexicographic = sortedIds(ledger.cells.map((cell) => cell.cellId));
  if (stableSerialize(lexicographic) !== stableSerialize(byOrder.map((cell) => cell.cellId))) {
    issue(issues, "ownershipLedger.cells", "Lexicographic cell-id order must equal visual-priority order so the accepted runtime cellIds() sort preserves it.");
  }
  let blockCells = 0;
  let previousWaveIndex = -1;
  for (const cell of byOrder) {
    const path = `ownershipLedger.cells.${cell.cellId}`;
    const match = CELL_ID_PATTERN.exec(cell.cellId);
    if (!match) { issue(issues, path, "Cell id must follow manhattan-exterior-cell-w<wave>-<order>-<tile|block-00835>."); continue; }
    const waveIndex = Number(match[1]);
    const sequence = Number(match[2]);
    const wave = EXTERIOR_WAVE_PLAN[waveIndex];
    if (!wave) { issue(issues, path, `Cell id names undefined wave ${waveIndex}.`); continue; }
    if (sequence !== cell.order) issue(issues, path, "Cell id sequence must equal the cell order.");
    if (waveIndex < previousWaveIndex) issue(issues, path, "Cells must be ordered wave by wave.");
    previousWaveIndex = waveIndex;
    if (cell.buildingIds.length === 0) issue(issues, path, "Ownership cells must not be empty.");
    if (cell.buildingIds.length > cap) issue(issues, path, `Cell holds ${cell.buildingIds.length} buildings, above the ${cap}-building runtime cap.`);
    if (stableSerialize(cell.buildingIds) !== stableSerialize(sortedIds(cell.buildingIds))) issue(issues, path, "Cell membership must be recorded in sorted order.");

    if (match[3] === BLOCK_835_CELL_SUFFIX) {
      blockCells += 1;
      if (waveIndex !== 0) issue(issues, path, "The Block 835 cell must be wave 0.");
      if (stableSerialize(cell.buildingIds) !== stableSerialize(sortedIds(BLOCK_835_BUILDING_IDS))) issue(issues, path, "Block 835 membership must be exactly the declared DOITT set.");
      if (stableSerialize(cell.bounds) !== stableSerialize(BLOCK_835_CELL_BOUNDS)) issue(issues, path, "Block 835 bounds must be the frozen public-realm clip rectangle.");
      continue;
    }
    if (waveIndex === 0) { issue(issues, path, "Wave 0 holds only the declared Block 835 cell."); continue; }
    let tile: TileKey;
    try { tile = cellTileKey(cell.cellId)!; } catch { issue(issues, path, "Cell id tile suffix is not a valid WGS84 tile key."); continue; }
    if (tile.level < EXTERIOR_WAVE_TILE_LEVEL || tile.level > EXTERIOR_CELL_MAX_TILE_LEVEL) issue(issues, path, "Cell tile level is outside the declared split range.");
    if (stableSerialize(cell.bounds) !== stableSerialize(tileBounds(tile))) issue(issues, path, "Cell bounds must be the exact WGS84 tile rectangle it is named for.");
    const anchor = ancestorTile(tile, EXTERIOR_WAVE_TILE_LEVEL);
    if (wave.tileRowRange === null || anchor.y < wave.tileRowRange.northRowY || anchor.y > wave.tileRowRange.southRowY) {
      issue(issues, path, `Cell sits in level-14 row ${anchor.y}, outside wave ${wave.waveId}.`);
    }
  }
  if (blockCells !== 1) issue(issues, "ownershipLedger.cells", "Exactly one declared Block 835 cell is required.");

  // Coverage is the exact union rectangle of every cell rectangle.
  if (ledger.cells.length > 0 && stableSerialize(ledger.coverage) !== stableSerialize(unionBounds(ledger.cells.map((cell) => cell.bounds)))) {
    issue(issues, "ownershipLedger.coverage", "Coverage must be the exact union rectangle of all cell bounds.");
  }

  return issues.length === 0 ? { ok: true, value: ledger } : { ok: false, issues };
}

export function validateExteriorWaveLedgerDigest(value: unknown, ledger: ExteriorOwnershipLedger, ledgerChecksumSha256: string, options: ExteriorWaveLedgerDigestOptions): ExteriorReleaseIssue[] {
  const expected = exteriorWaveLedgerDigest(ledger, { ...options, ledgerChecksumSha256 });
  return stableSerialize(value) === stableSerialize(expected) ? [] : [{ path: "digest", message: "Membership digest does not reproduce the ledger it pins." }];
}

export function validateExteriorLedgerEligibility(value: unknown, ledger: ExteriorOwnershipLedger, ledgerChecksumSha256: string): ExteriorReleaseIssue[] {
  const expected = exteriorLedgerEligibility(ledger, ledgerChecksumSha256);
  return stableSerialize(value) === stableSerialize(expected) ? [] : [{ path: "eligibility", message: "Eligibility artifact does not reproduce the ledger it pins." }];
}
