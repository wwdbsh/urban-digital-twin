/**
 * Citywide ground partition ledger and release document (Task T005).
 *
 * `../domain/ground.ts` owns the city-agnostic contracts. This module owns the
 * three things that are release concerns, and nothing else:
 *
 * 1. **A ground-owned, space-filling partition.** The exterior ownership cells
 *    in `./exterior-wave-ledger.ts` are derived from BUILDING membership: a
 *    level-14 tile with no buildings in it produces no cell, so the Hudson, the
 *    East River, and the interior of Central Park are simply absent from that
 *    ledger. Ground must cover them, so it partitions a DECLARED extent rather
 *    than a point set, and every tile of that extent becomes exactly one cell
 *    whether or not anything is currently materialized inside it.
 * 2. **A versioned partition scheme.** `partitionSchemeId` is part of ledger
 *    identity. Changing the grid is therefore an explicit new scheme with a new
 *    `ledgerId`, not a silent rewrite of every `cellId` under the old name.
 * 3. **The Manhattan constants.** Held here for the same reason
 *    `./exterior-wave-ledger.ts` holds the exterior ones: the domain contract
 *    must stay city-neutral, and the platform must stay able to configure a
 *    second city without editing `src/domain`.
 *
 * Tile mathematics are IMPORTED from `../runtime/spatial.ts` rather than
 * replicated. `src/release` importing that module is long established —
 * `./exterior-wave-ledger.ts`, `./citywide-release.ts` and `./catalog-release.ts`
 * all do it — so there is no layering violation to buy off, and a second copy of
 * the quadtree arithmetic is exactly the drift a single tile authority exists to
 * prevent. The one thing this module computes itself is the CONTINUOUS tile
 * index, which outward snapping needs and which the authority does not expose;
 * `groundPartitionTiles` cross-checks its own floor against
 * `tileKeyForCoordinate` and throws if they ever disagree.
 *
 * Budget discipline: no runtime budget number is restated here. Cell-residency
 * and cache limits live in `EXTERIOR_RUNTIME_BUDGETS`
 * (`../runtime/exterior-cell-runtime.ts`) and the ground tier budgets that a
 * materialization task will need must be read from there, not remembered from
 * this comment. This module deliberately declares no asset-size ceiling of its
 * own: it has measured nothing, and a number nobody sized is worse than none.
 */

import {
  DEFAULT_GROUND_IDENTITY_POLICY,
  collectGroundAssetTierIssues,
  compareGroundIds,
  groundIdentitySetChecksum,
  groundPartId,
  isGroundEmbellishmentClass,
  isGroundSurfaceClass,
  sortGroundIds,
  validateGroundFeature,
  validateGroundFeatureSet,
  type GroundFeature,
  type GroundFeaturePart,
  type GroundIdentityPolicy,
  type GroundIssue,
  type GroundSurfaceClass,
  type GroundTier,
  type GroundValidation,
} from "../domain/ground.ts";
import { domainSeparatedSha256, sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";
import { isSafeReleaseArtifactReference } from "../runtime/path-security.ts";
import { parseTileKey, tileBounds, tileKeyForCoordinate, tileKeyString, type TileBounds, type TileKey } from "../runtime/spatial.ts";

/**
 * WGS84 degree bounds. Structurally identical to `Wgs84Bounds` in
 * `./exterior-release.ts`; aliased from the tile authority instead of imported
 * from the exterior release so the ground contracts carry no dependency on the
 * building pipeline.
 */
export type GroundBounds = TileBounds;

export const GROUND_RELEASE_SCHEMA_VERSION = "1.0" as const;

/**
 * Known partition schemes, keyed by the id that appears in ledger identity.
 *
 * A new grid MUST be added as a new entry with a new id. Editing the level of an
 * existing entry would silently repoint every `cellId` ever published under it.
 */
export const GROUND_PARTITION_SCHEMES = {
  "ground-partition-v1-level14": { tileLevel: 14 },
} as const satisfies Record<string, { tileLevel: number }>;

export type GroundPartitionSchemeId = keyof typeof GROUND_PARTITION_SCHEMES;

export const GROUND_PARTITION_SCHEME_ID = "ground-partition-v1-level14" satisfies GroundPartitionSchemeId;

/**
 * City identity is pinned to the wave-ledger convention (`city:manhattan`, see
 * `EXTERIOR_WAVE_LEDGER_CITY_ID` in `./exterior-wave-ledger.ts`).
 *
 * `../runtime/block835-public-realm-release.ts` uses a bare `"manhattan"` for
 * the same city. Both forms are live and neither is being rewritten by this
 * task; the ground contracts standardize on the prefixed form because it is the
 * one the citywide ledger already uses, and a consumer joining the two must
 * translate explicitly rather than assume they are the same string.
 */
export const MANHATTAN_GROUND_CITY_ID = "city:manhattan" as const;
export const MANHATTAN_GROUND_CONFIG_ID = "config:manhattan-ground" as const;

export interface GroundExtentDeclaration {
  extentId: string;
  /**
   * The requested envelope, in WGS84 degrees. The ledger snaps this OUTWARD to
   * whole tiles of the partition scheme, and publishes the snapped rectangle as
   * `coverage`; nothing downstream should treat `requested` as the covered area.
   */
  requested: GroundBounds;
  /** What the envelope is, and — as importantly — what it is not. */
  note: string;
}

/**
 * Manhattan's declared ground extent: the island plus a water margin.
 *
 * This is a DECLARED working envelope, not a surveyed boundary and not a
 * borough limit. It is deliberately generous on all four sides so the Hudson
 * and East River water surfaces, the Harlem River, and the shoreline edge are
 * inside the partition rather than clipped at it. A feature that falls outside
 * it is refused by `buildGroundOwnershipLedger` rather than silently dropped,
 * which is what makes widening the envelope an explicit decision.
 */
export const MANHATTAN_GROUND_EXTENT: GroundExtentDeclaration = {
  extentId: "manhattan-ground-extent-v1",
  requested: { west: -74.03, south: 40.68, east: -73.9, north: 40.89 },
  note: "Declared working envelope covering Manhattan island plus a surrounding water margin. Not a surveyed borough boundary; not a claim that every surface inside it is materialized.",
};

const GROUND_CELL_ID_PREFIX = "ground-cell-" as const;
export const GROUND_CELL_ID_PATTERN = /^ground-cell-(\d{6})-(\d{1,2})-(\d+)-(\d+)$/u;

const GROUND_LEDGER_ID_DOMAIN = "udt:ground:ownership-ledger:id:v1";
const GROUND_ASSET_DIGEST_DOMAIN = "udt:ground:asset-digest:v1";

export interface GroundOwnershipCell {
  cellId: string;
  order: number;
  bounds: GroundBounds;
  partIds: string[];
  membershipChecksumSha256: string;
}

export interface GroundOwnershipLedger {
  schemaVersion: typeof GROUND_RELEASE_SCHEMA_VERSION;
  ledgerId: string;
  cityId: string;
  configId: string;
  partitionSchemeId: string;
  immutable: true;
  baseIdentitySet: { id: string; checksumSha256: string; featureCount: number; partCount: number };
  coverage: GroundBounds;
  cells: GroundOwnershipCell[];
}

/**
 * How a feature's cell occupancy is determined.
 *
 * `declared-cells` is the honest form and the seam a real polygon clipper will
 * use: the caller has already clipped the geometry and states which cells
 * genuinely hold a share. `bounds` is a deliberate CONSERVATIVE
 * over-approximation from an axis-aligned envelope — correct for rectangular
 * fixtures and for any feature whose footprint fills its envelope, and an
 * over-count for an L-shaped or diagonal one. It exists so this contract can be
 * proven deterministic without pretending a clipper has been written; nothing
 * here claims a bounds-derived part set is geometrically minimal.
 */
export type GroundFeatureOccupancy =
  | { kind: "bounds"; bounds: GroundBounds }
  | { kind: "declared-cells"; tileKeys: readonly string[] };

export interface GroundFeatureOccupancyInput {
  canonicalFeatureId: string;
  occupancy: GroundFeatureOccupancy;
}

export interface GroundOwnershipLedgerInput {
  cityId: string;
  configId: string;
  partitionSchemeId: GroundPartitionSchemeId;
  extent: GroundExtentDeclaration;
  baseIdentitySetId: string;
  features: readonly GroundFeature[];
  occupancy: readonly GroundFeatureOccupancyInput[];
  identityPolicy?: GroundIdentityPolicy;
}

export interface GroundPartitionBuild {
  ledger: GroundOwnershipLedger;
  parts: GroundFeaturePart[];
}

// ---------------------------------------------------------------------------
// Partition geometry
// ---------------------------------------------------------------------------

function partitionTileLevel(partitionSchemeId: string): number {
  const scheme = (GROUND_PARTITION_SCHEMES as Record<string, { tileLevel: number } | undefined>)[partitionSchemeId];
  if (!scheme) throw new Error(`Unknown ground partition scheme ${partitionSchemeId}.`);
  return scheme.tileLevel;
}

/** Continuous (unfloored) tile column. `tileKeyForCoordinate` remains the authority for the floored value. */
function tileColumn(longitude: number, level: number): number {
  return ((longitude + 180) / 360) * 2 ** level;
}

/** Continuous (unfloored) tile row. Rows increase southwards, matching `../runtime/spatial.ts`. */
function tileRow(latitude: number, level: number): number {
  return ((90 - latitude) / 180) * 2 ** level;
}

function assertOrderedBounds(bounds: GroundBounds, label: string): void {
  const finite = [bounds.west, bounds.south, bounds.east, bounds.north].every((value) => typeof value === "number" && Number.isFinite(value));
  if (!finite) throw new Error(`${label} must contain finite WGS84 coordinates.`);
  if (bounds.west < -180 || bounds.east > 180 || bounds.south < -90 || bounds.north > 90) throw new Error(`${label} is outside the WGS84 range.`);
  if (bounds.west >= bounds.east || bounds.south >= bounds.north) throw new Error(`${label} must be an ordered, non-degenerate rectangle.`);
}

interface TileIndexRange { xStart: number; xEndExclusive: number; yStart: number; yEndExclusive: number }

function tileIndexRange(bounds: GroundBounds, level: number, label: string): TileIndexRange {
  assertOrderedBounds(bounds, label);
  const xStart = Math.floor(tileColumn(bounds.west, level));
  const yStart = Math.floor(tileRow(bounds.north, level));
  // The floored corner must agree with the tile authority, or the continuous
  // form above has drifted from `../runtime/spatial.ts` and every derived cell
  // id is suspect.
  const authority = tileKeyForCoordinate(bounds.west, bounds.north, level);
  if (authority.x !== xStart || authority.y !== yStart) {
    throw new Error(`Ground tile arithmetic disagrees with ../runtime/spatial.ts for ${label}.`);
  }
  const xEndExclusive = Math.max(xStart + 1, Math.ceil(tileColumn(bounds.east, level)));
  const yEndExclusive = Math.max(yStart + 1, Math.ceil(tileRow(bounds.south, level)));
  return { xStart, xEndExclusive, yStart, yEndExclusive };
}

function tileAt(level: number, x: number, y: number): TileKey {
  return parseTileKey(`wgs84-geodetic/${level}/${x}/${y}`);
}

/**
 * Every tile of the declared extent, in ledger order.
 *
 * Order is south-to-north (descending row) then west-to-east (ascending
 * column), matching `comparePending` in `./exterior-wave-ledger.ts` so ground
 * and exterior sweep the island in the same direction. A pure grid has no ties
 * to break — one (x, y) is one cell — but the comparator is written as a total
 * order over both keys so that stays true if a future scheme subdivides.
 */
export function groundPartitionTiles(extent: GroundExtentDeclaration, partitionSchemeId: string): { coverage: GroundBounds; tiles: TileKey[] } {
  const level = partitionTileLevel(partitionSchemeId);
  const range = tileIndexRange(extent.requested, level, `Ground extent ${extent.extentId}`);
  const tiles: TileKey[] = [];
  for (let y = range.yEndExclusive - 1; y >= range.yStart; y -= 1) {
    for (let x = range.xStart; x < range.xEndExclusive; x += 1) tiles.push(tileAt(level, x, y));
  }
  const northWest = tileBounds(tileAt(level, range.xStart, range.yStart));
  const southEast = tileBounds(tileAt(level, range.xEndExclusive - 1, range.yEndExclusive - 1));
  return { coverage: { west: northWest.west, south: southEast.south, east: southEast.east, north: northWest.north }, tiles };
}

function groundCellId(order: number, tile: TileKey): string {
  return `${GROUND_CELL_ID_PREFIX}${String(order).padStart(6, "0")}-${tile.level}-${tile.x}-${tile.y}`;
}

/** Parses the tile encoded in a ground cell id. Throws on a malformed id. */
export function groundCellTileKey(cellId: string): TileKey {
  const match = GROUND_CELL_ID_PATTERN.exec(cellId);
  if (!match) throw new Error(`Cell id ${cellId} does not follow the ground partition cell scheme.`);
  return tileAt(Number(match[2]), Number(match[3]), Number(match[4]));
}

export function groundCellOrder(cellId: string): number {
  const match = GROUND_CELL_ID_PATTERN.exec(cellId);
  if (!match) throw new Error(`Cell id ${cellId} does not follow the ground partition cell scheme.`);
  return Number(match[1]);
}

export function groundMembershipChecksum(partIds: readonly string[]): string {
  return sha256HexSync(stableSerialize(sortGroundIds(partIds)));
}

/** The identity a ledger id is derived from. Cells contribute id, order, bounds and membership. */
export interface GroundOwnershipLedgerIdentity {
  cityId: string;
  configId: string;
  partitionSchemeId: string;
  extentId: string;
  coverage: GroundBounds;
  baseIdentitySet: GroundOwnershipLedger["baseIdentitySet"];
  cells: readonly Pick<GroundOwnershipCell, "cellId" | "order" | "bounds" | "membershipChecksumSha256">[];
}

/**
 * The ledger id, derived rather than declared.
 *
 * Exported because a RUNTIME must be able to ask the question the builder
 * answered: does this `ledger.json` actually produce the id the release
 * document pins? The ledger file carries no checksum of its own, so
 * re-deriving its id is the only cryptographic link between the two documents,
 * and a second copy of this derivation in the runtime would be a link to
 * nothing. `buildGroundOwnershipLedger` below is the only other caller.
 */
export function groundOwnershipLedgerId(identity: GroundOwnershipLedgerIdentity): string {
  const citySlug = identity.cityId.replaceAll(":", "-");
  return `ground-ledger:${citySlug}:${identity.partitionSchemeId}:${domainSeparatedSha256(GROUND_LEDGER_ID_DOMAIN, {
    cityId: identity.cityId,
    configId: identity.configId,
    partitionSchemeId: identity.partitionSchemeId,
    extentId: identity.extentId,
    coverage: identity.coverage,
    baseIdentitySet: identity.baseIdentitySet,
    cells: identity.cells.map((cell) => ({ cellId: cell.cellId, order: cell.order, bounds: cell.bounds, membershipChecksumSha256: cell.membershipChecksumSha256 })),
  }).slice(0, 32)}`;
}

// ---------------------------------------------------------------------------
// Ledger construction
// ---------------------------------------------------------------------------

function occupiedTileKeys(occupancy: GroundFeatureOccupancy, level: number, canonicalFeatureId: string): string[] {
  if (occupancy.kind === "declared-cells") {
    if (occupancy.tileKeys.length === 0) throw new Error(`Feature ${canonicalFeatureId} declared no occupied cells.`);
    const keys = new Set<string>();
    for (const key of occupancy.tileKeys) {
      const tile = parseTileKey(key);
      if (tile.level !== level) throw new Error(`Feature ${canonicalFeatureId} declared tile ${key} at the wrong partition level ${tile.level}.`);
      keys.add(tileKeyString(tile));
    }
    return sortGroundIds(keys);
  }
  const range = tileIndexRange(occupancy.bounds, level, `Occupancy bounds for ${canonicalFeatureId}`);
  const keys: string[] = [];
  for (let y = range.yStart; y < range.yEndExclusive; y += 1) {
    for (let x = range.xStart; x < range.xEndExclusive; x += 1) keys.push(tileKeyString(tileAt(level, x, y)));
  }
  return sortGroundIds(keys);
}

/**
 * Builds the ground ownership ledger and the part set it owns.
 *
 * Fails closed by throwing: a ledger that quietly drops a feature outside the
 * declared extent, or quietly accepts an unvalidated one, is worse than no
 * ledger at all. Structural validation of the RESULT is a separate concern —
 * see `validateGroundOwnershipLedgerStructure` and `validateGroundReleaseGraph`.
 */
export function buildGroundOwnershipLedger(input: GroundOwnershipLedgerInput): GroundPartitionBuild {
  const policy = input.identityPolicy ?? DEFAULT_GROUND_IDENTITY_POLICY;
  const level = partitionTileLevel(input.partitionSchemeId);
  if (input.cityId.trim().length === 0 || input.configId.trim().length === 0 || input.baseIdentitySetId.trim().length === 0) {
    throw new Error("Ground ledger identity requires a city id, a config id, and a base identity-set id.");
  }
  const { coverage, tiles } = groundPartitionTiles(input.extent, input.partitionSchemeId);

  const cellIdByTileKey = new Map<string, string>();
  const cells = tiles.map((tile, order) => {
    const cellId = groundCellId(order, tile);
    cellIdByTileKey.set(tileKeyString(tile), cellId);
    return { cellId, order, bounds: tileBounds(tile), partIds: [] as string[] };
  });

  const occupancyByFeature = new Map<string, GroundFeatureOccupancy>();
  for (const entry of input.occupancy) {
    if (occupancyByFeature.has(entry.canonicalFeatureId)) throw new Error(`Feature ${entry.canonicalFeatureId} declared occupancy twice.`);
    occupancyByFeature.set(entry.canonicalFeatureId, entry.occupancy);
  }

  const parts: GroundFeaturePart[] = [];
  const seenFeatureIds = new Set<string>();
  const orderedFeatures = [...input.features].sort((left, right) => compareGroundIds(left.canonicalFeatureId, right.canonicalFeatureId));
  for (const feature of orderedFeatures) {
    if (seenFeatureIds.has(feature.canonicalFeatureId)) throw new Error(`Feature ${feature.canonicalFeatureId} appears twice; a canonical identity is singular.`);
    seenFeatureIds.add(feature.canonicalFeatureId);
    if (feature.cityId !== input.cityId) throw new Error(`Feature ${feature.canonicalFeatureId} belongs to ${feature.cityId}, not ${input.cityId}.`);
    const validation = validateGroundFeature(feature, policy);
    if (!validation.ok) throw new Error(`Feature ${feature.canonicalFeatureId} is invalid: ${validation.issues.map((entry) => `${entry.path}: ${entry.message}`).join("; ")}`);
    const occupancy = occupancyByFeature.get(feature.canonicalFeatureId);
    if (!occupancy) throw new Error(`Feature ${feature.canonicalFeatureId} declared no cell occupancy.`);
    for (const tileKey of occupiedTileKeys(occupancy, level, feature.canonicalFeatureId)) {
      const cellId = cellIdByTileKey.get(tileKey);
      if (!cellId) throw new Error(`Feature ${feature.canonicalFeatureId} occupies ${tileKey}, which is outside the declared extent ${input.extent.extentId}.`);
      parts.push({ partId: groundPartId(feature.canonicalFeatureId, cellId), canonicalFeatureId: feature.canonicalFeatureId, ownerCellId: cellId });
    }
  }
  for (const canonicalFeatureId of occupancyByFeature.keys()) {
    if (!seenFeatureIds.has(canonicalFeatureId)) throw new Error(`Occupancy declared for unknown feature ${canonicalFeatureId}.`);
  }

  const partIdsByCell = new Map<string, string[]>();
  for (const part of parts) {
    const bucket = partIdsByCell.get(part.ownerCellId) ?? [];
    if (bucket.includes(part.partId)) throw new Error(`Cell ${part.ownerCellId} owns part ${part.partId} twice.`);
    bucket.push(part.partId);
    partIdsByCell.set(part.ownerCellId, bucket);
  }

  const resolvedCells: GroundOwnershipCell[] = cells.map((cell) => {
    const partIds = sortGroundIds(partIdsByCell.get(cell.cellId) ?? []);
    return { cellId: cell.cellId, order: cell.order, bounds: cell.bounds, partIds, membershipChecksumSha256: groundMembershipChecksum(partIds) };
  });

  const baseIdentitySet = {
    id: input.baseIdentitySetId,
    checksumSha256: groundIdentitySetChecksum(orderedFeatures, parts),
    featureCount: orderedFeatures.length,
    partCount: parts.length,
  };

  const ledgerId = groundOwnershipLedgerId({
    cityId: input.cityId,
    configId: input.configId,
    partitionSchemeId: input.partitionSchemeId,
    extentId: input.extent.extentId,
    coverage,
    baseIdentitySet,
    cells: resolvedCells,
  });

  return {
    ledger: {
      schemaVersion: GROUND_RELEASE_SCHEMA_VERSION,
      ledgerId,
      cityId: input.cityId,
      configId: input.configId,
      partitionSchemeId: input.partitionSchemeId,
      immutable: true,
      baseIdentitySet,
      coverage,
      cells: resolvedCells,
    },
    parts: [...parts].sort((left, right) => compareGroundIds(left.partId, right.partId)),
  };
}

// ---------------------------------------------------------------------------
// Release document
// ---------------------------------------------------------------------------

export interface GroundSourceSnapshot {
  datasetId: string;
  mappedViewId?: string | null;
  rawSha256: string;
  sourceFeatureCount: number;
}

export interface GroundClipDeclaration {
  sourceExtent: GroundBounds;
  clipBounds: GroundBounds;
  bufferMeters: number;
  rule: string;
}

export interface GroundGeometryValidation {
  method: string;
  areaResidualToleranceRelative: number;
  maxObservedRelativeAreaError: number;
  status: "pass";
}

export interface GroundAssetEntry {
  assetId: string;
  cellId: string;
  class: GroundSurfaceClass;
  tiers: GroundTier[];
  /**
   * Per-asset digest over the asset's tier artifacts. Each tier already carries
   * its own artifact checksum; this is the one value that changes if ANY tier of
   * the asset is re-materialized, so a consumer can compare assets without
   * walking tiers.
   */
  contentSha256: string;
}

/**
 * Reserved additive seam for zone imagery (T012/T013).
 *
 * Declared now, and optional, so adding imagery later is an additive change to
 * an already-published schema rather than a hash-breaking one. A release that
 * omits it or sets it to `null` is byte-identical to one written before the
 * seam existed. Imagery FAILS CLOSED to the polygon base: a missing, unverified,
 * or mismatched imagery artifact removes the imagery and nothing else, which is
 * exactly why every asset must keep its always-covering flat tier.
 */
export interface GroundZoneImagery {
  zoneRef: string;
  artifactRef: string;
  checksumSha256: string;
  captureYear: number;
  attribution: string;
}

export interface GroundProvenance {
  sourceEpoch: string;
  termsUrl: string;
  attribution: string;
  disclaimer: string;
  localOnly: boolean;
  runtimeExternalNetwork: boolean;
}

export interface GroundReleaseDocument {
  schemaVersion: typeof GROUND_RELEASE_SCHEMA_VERSION;
  releaseId: string;
  cityId: string;
  configId: string;
  partitionSchemeId: string;
  ownershipLedgerId: string;
  generatedAt: string;
  immutable: true;
  sourceSnapshots: GroundSourceSnapshot[];
  clip: GroundClipDeclaration;
  geometryValidation: GroundGeometryValidation;
  assets: GroundAssetEntry[];
  /** Aggregate prose ceiling per class. Per-feature strength stays on the feature. */
  claimCeilings: Partial<Record<GroundSurfaceClass, string>>;
  zoneImagery?: GroundZoneImagery | null;
  provenance: GroundProvenance;
  fallback: string;
}

export function groundAssetContentSha256(tiers: readonly GroundTier[]): string {
  return domainSeparatedSha256(
    GROUND_ASSET_DIGEST_DOMAIN,
    [...tiers]
      .map((tier) => ({ tierId: tier.tierId, kind: tier.kind, maxDistanceMeters: tier.maxDistanceMeters, artifactRef: tier.artifactRef, checksumSha256: tier.checksumSha256 }))
      .sort((left, right) => compareGroundIds(left.tierId, right.tierId)),
  );
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type GroundReleaseIssue = GroundIssue;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function checksum(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }
function issue(issues: GroundReleaseIssue[], path: string, message: string): void { issues.push({ path, message }); }
function timestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const milliseconds = Date.parse(value);
  return !Number.isNaN(milliseconds) && new Date(milliseconds).toISOString() === value;
}
function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, issues: GroundReleaseIssue[], optional: readonly string[] = []): void {
  const allowlist = new Set([...allowed, ...optional]);
  for (const key of Object.keys(value)) if (!allowlist.has(key)) issue(issues, `${path}.${key}`, "Unexpected ground release field.");
  for (const key of allowed) if (!(key in value)) issue(issues, `${path}.${key}`, "Required ground release field is missing.");
}
function validBounds(value: unknown, path: string, issues: GroundReleaseIssue[]): value is GroundBounds {
  if (!record(value)) { issue(issues, path, "WGS84 bounds are required."); return false; }
  exactKeys(value, ["west", "south", "east", "north"], path, issues);
  const valid = (["west", "south", "east", "north"] as const).every((field) => typeof value[field] === "number" && Number.isFinite(value[field]));
  if (!valid) { issue(issues, path, "WGS84 bounds must contain finite coordinates."); return false; }
  const bounds = value as unknown as GroundBounds;
  if (bounds.west < -180 || bounds.east > 180 || bounds.south < -90 || bounds.north > 90 || bounds.west >= bounds.east || bounds.south >= bounds.north) {
    issue(issues, path, "WGS84 bounds are outside their valid ordered range.");
  }
  return valid;
}
function sameBounds(left: GroundBounds, right: GroundBounds): boolean {
  return left.west === right.west && left.south === right.south && left.east === right.east && left.north === right.north;
}
function withinBounds(inner: GroundBounds, outer: GroundBounds): boolean {
  return inner.west >= outer.west && inner.south >= outer.south && inner.east <= outer.east && inner.north <= outer.north;
}

export function validateGroundOwnershipLedgerStructure(value: unknown): GroundValidation<GroundOwnershipLedger> {
  const issues: GroundReleaseIssue[] = [];
  if (!record(value)) return { ok: false, issues: [{ path: "$", message: "Ground ownership ledger must be an object." }] };
  exactKeys(value, ["schemaVersion", "ledgerId", "cityId", "configId", "partitionSchemeId", "immutable", "baseIdentitySet", "coverage", "cells"], "$", issues);
  if (value.schemaVersion !== GROUND_RELEASE_SCHEMA_VERSION) issue(issues, "schemaVersion", "Unsupported ground ownership schema.");
  for (const field of ["ledgerId", "cityId", "configId"] as const) if (!nonEmpty(value[field])) issue(issues, field, "Ownership identity field is required.");
  if (!nonEmpty(value.partitionSchemeId) || !(value.partitionSchemeId in GROUND_PARTITION_SCHEMES)) issue(issues, "partitionSchemeId", "Unknown ground partition scheme.");
  else if (typeof value.ledgerId === "string" && !value.ledgerId.includes(value.partitionSchemeId)) issue(issues, "ledgerId", "Ledger identity must name its partition scheme.");
  if (value.immutable !== true) issue(issues, "immutable", "Ground ownership ledger must declare immutability.");
  if (!record(value.baseIdentitySet)) issue(issues, "baseIdentitySet", "Pinned base identity set is required.");
  else {
    exactKeys(value.baseIdentitySet, ["id", "checksumSha256", "featureCount", "partCount"], "baseIdentitySet", issues);
    if (!nonEmpty(value.baseIdentitySet.id)) issue(issues, "baseIdentitySet.id", "Base identity-set id is required.");
    if (!checksum(value.baseIdentitySet.checksumSha256)) issue(issues, "baseIdentitySet.checksumSha256", "Base identity checksum must be lowercase SHA-256.");
    for (const field of ["featureCount", "partCount"] as const) {
      const count = value.baseIdentitySet[field];
      if (!Number.isSafeInteger(count) || (count as number) < 0) issue(issues, `baseIdentitySet.${field}`, "Base identity count must be a non-negative integer.");
    }
  }
  validBounds(value.coverage, "coverage", issues);
  if (!Array.isArray(value.cells) || value.cells.length === 0) issue(issues, "cells", "At least one ownership cell is required.");
  else value.cells.forEach((cell, index) => {
    const path = `cells[${index}]`;
    if (!record(cell)) return issue(issues, path, "Ownership cell must be an object.");
    exactKeys(cell, ["cellId", "order", "bounds", "partIds", "membershipChecksumSha256"], path, issues);
    if (!nonEmpty(cell.cellId) || !GROUND_CELL_ID_PATTERN.test(cell.cellId as string)) issue(issues, `${path}.cellId`, "Cell id must follow the ground partition cell scheme.");
    if (!Number.isSafeInteger(cell.order) || (cell.order as number) < 0) issue(issues, `${path}.order`, "Cell order must be a non-negative integer.");
    validBounds(cell.bounds, `${path}.bounds`, issues);
    if (!Array.isArray(cell.partIds) || cell.partIds.some((entry) => !nonEmpty(entry))) issue(issues, `${path}.partIds`, "Cell membership must be an array of non-empty part ids.");
    else if (new Set(cell.partIds).size !== cell.partIds.length) issue(issues, `${path}.partIds`, "Cell membership part ids must be unique.");
    else if (!checksum(cell.membershipChecksumSha256)) issue(issues, `${path}.membershipChecksumSha256`, "Membership checksum must be lowercase SHA-256.");
    else if (cell.membershipChecksumSha256 !== groundMembershipChecksum(cell.partIds as string[])) issue(issues, `${path}.membershipChecksumSha256`, "Membership checksum does not match the declared part ids.");
  });
  return issues.length === 0 ? { ok: true, value: value as unknown as GroundOwnershipLedger } : { ok: false, issues };
}

/**
 * The invariant the exterior ledger does not have and cannot have: the cells
 * tile the declared coverage EXACTLY ONCE.
 *
 * Exterior cells are derived from building membership, so a gap is normal
 * there. A gap in the ground partition is a hole in the world, and an overlap is
 * two cells claiming the same square metre — either one makes cell ownership,
 * and therefore membership checksums, meaningless.
 */
export function validateGroundPartitionCoverage(ledger: GroundOwnershipLedger): GroundValidation<GroundOwnershipLedger> {
  const issues: GroundReleaseIssue[] = [];
  const level = (GROUND_PARTITION_SCHEMES as Record<string, { tileLevel: number } | undefined>)[ledger.partitionSchemeId]?.tileLevel;
  if (level === undefined) return { ok: false, issues: [{ path: "partitionSchemeId", message: "Unknown ground partition scheme." }] };

  let range: TileIndexRange;
  try {
    range = tileIndexRange(ledger.coverage, level, "Ledger coverage");
  } catch (error) {
    return { ok: false, issues: [{ path: "coverage", message: error instanceof Error ? error.message : "Ledger coverage is invalid." }] };
  }
  const expected = new Set<string>();
  for (let y = range.yStart; y < range.yEndExclusive; y += 1) {
    for (let x = range.xStart; x < range.xEndExclusive; x += 1) expected.add(tileKeyString(tileAt(level, x, y)));
  }
  const snapped = groundPartitionTiles({ extentId: "coverage", requested: ledger.coverage, note: "" }, ledger.partitionSchemeId).coverage;
  if (!sameBounds(snapped, ledger.coverage)) issue(issues, "coverage", "Ledger coverage must already be snapped to whole partition tiles.");

  const seen = new Set<string>();
  ledger.cells.forEach((cell, index) => {
    const path = `cells[${index}]`;
    let tile: TileKey;
    try {
      tile = groundCellTileKey(cell.cellId);
    } catch {
      return issue(issues, `${path}.cellId`, "Cell id must encode a partition tile.");
    }
    if (tile.level !== level) return issue(issues, `${path}.cellId`, "Cell tile level must match the partition scheme.");
    const key = tileKeyString(tile);
    if (!expected.has(key)) return issue(issues, `${path}.cellId`, "Cell lies outside the declared coverage.");
    if (seen.has(key)) return issue(issues, `${path}.cellId`, "Coverage tile is claimed by more than one cell.");
    seen.add(key);
    if (!sameBounds(cell.bounds, tileBounds(tile))) issue(issues, `${path}.bounds`, "Cell bounds must be exactly its partition tile bounds.");
    if (cell.order !== index) issue(issues, `${path}.order`, "Cell order must be its contiguous index in the ledger.");
    if (groundCellOrder(cell.cellId) !== cell.order) issue(issues, `${path}.cellId`, "Cell id must embed its own order.");
  });
  for (const key of sortGroundIds(expected)) if (!seen.has(key)) issue(issues, "cells", `Coverage tile ${key} is not owned by any cell.`);

  // Ordering: south-to-north then west-to-east, matching the exterior sweep.
  for (let index = 1; index < ledger.cells.length; index += 1) {
    const previous = groundCellTileKeyOrNull(ledger.cells[index - 1]!.cellId);
    const current = groundCellTileKeyOrNull(ledger.cells[index]!.cellId);
    if (!previous || !current) continue;
    const ordered = previous.y > current.y || (previous.y === current.y && previous.x < current.x);
    if (!ordered) issue(issues, `cells[${index}].cellId`, "Cells must run south-to-north then west-to-east.");
  }

  return issues.length === 0 ? { ok: true, value: ledger } : { ok: false, issues };
}

function groundCellTileKeyOrNull(cellId: string): TileKey | null {
  try {
    return groundCellTileKey(cellId);
  } catch {
    return null;
  }
}

export function validateGroundReleaseStructure(value: unknown): GroundValidation<GroundReleaseDocument> {
  const issues: GroundReleaseIssue[] = [];
  if (!record(value)) return { ok: false, issues: [{ path: "$", message: "Ground release document must be an object." }] };
  exactKeys(
    value,
    ["schemaVersion", "releaseId", "cityId", "configId", "partitionSchemeId", "ownershipLedgerId", "generatedAt", "immutable", "sourceSnapshots", "clip", "geometryValidation", "assets", "claimCeilings", "provenance", "fallback"],
    "$",
    issues,
    ["zoneImagery"],
  );
  if (value.schemaVersion !== GROUND_RELEASE_SCHEMA_VERSION) issue(issues, "schemaVersion", "Unsupported ground release schema.");
  for (const field of ["releaseId", "cityId", "configId", "ownershipLedgerId", "fallback"] as const) if (!nonEmpty(value[field])) issue(issues, field, "Ground release identity field is required.");
  if (!nonEmpty(value.partitionSchemeId) || !(value.partitionSchemeId in GROUND_PARTITION_SCHEMES)) issue(issues, "partitionSchemeId", "Unknown ground partition scheme.");
  if (!timestamp(value.generatedAt)) issue(issues, "generatedAt", "Release timestamp is required.");
  if (value.immutable !== true) issue(issues, "immutable", "Ground release must declare immutability.");

  if (!Array.isArray(value.sourceSnapshots) || value.sourceSnapshots.length === 0) issue(issues, "sourceSnapshots", "At least one pinned source snapshot is required.");
  else value.sourceSnapshots.forEach((snapshot, index) => {
    const path = `sourceSnapshots[${index}]`;
    if (!record(snapshot)) return issue(issues, path, "Source snapshot must be an object.");
    exactKeys(snapshot, ["datasetId", "rawSha256", "sourceFeatureCount"], path, issues, ["mappedViewId"]);
    if (!nonEmpty(snapshot.datasetId)) issue(issues, `${path}.datasetId`, "Snapshot dataset id is required.");
    if (!checksum(snapshot.rawSha256)) issue(issues, `${path}.rawSha256`, "Snapshot raw checksum must be lowercase SHA-256.");
    if (!Number.isSafeInteger(snapshot.sourceFeatureCount) || (snapshot.sourceFeatureCount as number) < 0) issue(issues, `${path}.sourceFeatureCount`, "Snapshot feature count must be a non-negative integer.");
    if (snapshot.mappedViewId !== undefined && snapshot.mappedViewId !== null && !nonEmpty(snapshot.mappedViewId)) issue(issues, `${path}.mappedViewId`, "Mapped view id must be null or non-empty.");
  });

  if (!record(value.clip)) issue(issues, "clip", "Clip declaration is required.");
  else {
    exactKeys(value.clip, ["sourceExtent", "clipBounds", "bufferMeters", "rule"], "clip", issues);
    const sourceExtent = validBounds(value.clip.sourceExtent, "clip.sourceExtent", issues);
    const clipBounds = validBounds(value.clip.clipBounds, "clip.clipBounds", issues);
    if (sourceExtent && clipBounds && !withinBounds(value.clip.clipBounds as GroundBounds, value.clip.sourceExtent as GroundBounds)) {
      issue(issues, "clip.clipBounds", "Clip bounds must lie inside the declared source extent.");
    }
    if (!(typeof value.clip.bufferMeters === "number" && Number.isFinite(value.clip.bufferMeters) && value.clip.bufferMeters >= 0)) issue(issues, "clip.bufferMeters", "Clip buffer must be a finite non-negative number of metres.");
    if (!nonEmpty(value.clip.rule)) issue(issues, "clip.rule", "Clip rule statement is required.");
  }

  if (!record(value.geometryValidation)) issue(issues, "geometryValidation", "Geometry validation evidence is required.");
  else {
    exactKeys(value.geometryValidation, ["method", "areaResidualToleranceRelative", "maxObservedRelativeAreaError", "status"], "geometryValidation", issues);
    if (!nonEmpty(value.geometryValidation.method)) issue(issues, "geometryValidation.method", "Geometry validation method is required.");
    const tolerance = value.geometryValidation.areaResidualToleranceRelative;
    const observed = value.geometryValidation.maxObservedRelativeAreaError;
    const numeric = [tolerance, observed].every((entry) => typeof entry === "number" && Number.isFinite(entry) && entry >= 0);
    if (!numeric) issue(issues, "geometryValidation", "Area residual tolerance and observation must be finite non-negative numbers.");
    else if ((observed as number) > (tolerance as number)) issue(issues, "geometryValidation.maxObservedRelativeAreaError", "Observed area residual exceeds the declared tolerance.");
    if (value.geometryValidation.status !== "pass") issue(issues, "geometryValidation.status", "Geometry validation must pass for a release to be valid.");
  }

  const declaredClasses = new Set<GroundSurfaceClass>();
  if (!Array.isArray(value.assets) || value.assets.length === 0) issue(issues, "assets", "At least one ground asset is required.");
  else {
    const assetIds = new Set<string>();
    value.assets.forEach((asset, index) => {
      const path = `assets[${index}]`;
      if (!record(asset)) return issue(issues, path, "Ground asset entry must be an object.");
      exactKeys(asset, ["assetId", "cellId", "class", "tiers", "contentSha256"], path, issues);
      if (!nonEmpty(asset.assetId)) issue(issues, `${path}.assetId`, "Asset id is required.");
      else if (assetIds.has(asset.assetId)) issue(issues, `${path}.assetId`, "Asset ids must be unique.");
      else assetIds.add(asset.assetId);
      if (!nonEmpty(asset.cellId) || !GROUND_CELL_ID_PATTERN.test(asset.cellId as string)) issue(issues, `${path}.cellId`, "Asset cell id must follow the ground partition cell scheme.");
      if (isGroundSurfaceClass(asset.class)) declaredClasses.add(asset.class);
      collectGroundAssetTierIssues({ assetId: asset.assetId, class: asset.class, tiers: asset.tiers }, path, issues);
      if (Array.isArray(asset.tiers)) {
        asset.tiers.forEach((tier, tierIndex) => {
          if (record(tier) && !isSafeReleaseArtifactReference(tier.artifactRef)) issue(issues, `${path}.tiers[${tierIndex}].artifactRef`, "Tier artifact ref must be a canonical safe relative path.");
        });
        if (!checksum(asset.contentSha256)) issue(issues, `${path}.contentSha256`, "Asset content digest must be lowercase SHA-256.");
        else if (asset.contentSha256 !== groundAssetContentSha256(asset.tiers as GroundTier[])) issue(issues, `${path}.contentSha256`, "Asset content digest does not match its declared tiers.");
      }
    });
  }

  if (!record(value.claimCeilings)) issue(issues, "claimCeilings", "Per-class claim ceilings are required.");
  else {
    for (const key of Object.keys(value.claimCeilings)) {
      if (!isGroundSurfaceClass(key)) { issue(issues, `claimCeilings.${key}`, "Unknown ground class."); continue; }
      const ceiling = (value.claimCeilings as Record<string, unknown>)[key];
      if (!nonEmpty(ceiling)) { issue(issues, `claimCeilings.${key}`, "Claim ceiling statement is required."); continue; }
      if (isGroundEmbellishmentClass(key)) {
        if (!/estimated/iu.test(ceiling)) issue(issues, `claimCeilings.${key}`, "Curb and crosswalk ceilings must state that the claim is estimated.");
        if (!/current|survey/iu.test(ceiling)) issue(issues, `claimCeilings.${key}`, "Curb and crosswalk claim ceilings must retain explicit uncertainty language.");
      }
    }
    for (const declared of sortGroundIds(declaredClasses)) {
      if (!nonEmpty((value.claimCeilings as Record<string, unknown>)[declared])) issue(issues, `claimCeilings.${declared}`, "Every shipped class requires a claim ceiling.");
    }
  }

  if (value.zoneImagery !== undefined && value.zoneImagery !== null) {
    if (!record(value.zoneImagery)) issue(issues, "zoneImagery", "Zone imagery must be an object or null.");
    else {
      exactKeys(value.zoneImagery, ["zoneRef", "artifactRef", "checksumSha256", "captureYear", "attribution"], "zoneImagery", issues);
      if (!nonEmpty(value.zoneImagery.zoneRef)) issue(issues, "zoneImagery.zoneRef", "Imagery zone reference is required.");
      if (!isSafeReleaseArtifactReference(value.zoneImagery.artifactRef)) issue(issues, "zoneImagery.artifactRef", "Imagery artifact ref must be a canonical safe relative path.");
      if (!checksum(value.zoneImagery.checksumSha256)) issue(issues, "zoneImagery.checksumSha256", "Imagery checksum must be lowercase SHA-256.");
      if (!Number.isSafeInteger(value.zoneImagery.captureYear)) issue(issues, "zoneImagery.captureYear", "Imagery capture year is required.");
      if (!nonEmpty(value.zoneImagery.attribution)) issue(issues, "zoneImagery.attribution", "Imagery attribution is required.");
    }
  }

  if (!record(value.provenance)) issue(issues, "provenance", "Provenance declaration is required.");
  else {
    exactKeys(value.provenance, ["sourceEpoch", "termsUrl", "attribution", "disclaimer", "localOnly", "runtimeExternalNetwork"], "provenance", issues);
    for (const field of ["sourceEpoch", "termsUrl", "attribution", "disclaimer"] as const) if (!nonEmpty(value.provenance[field])) issue(issues, `provenance.${field}`, "Provenance statement is required.");
    for (const field of ["localOnly", "runtimeExternalNetwork"] as const) if (typeof value.provenance[field] !== "boolean") issue(issues, `provenance.${field}`, "Provenance network declaration must be explicit.");
    if (value.provenance.localOnly === true && value.provenance.runtimeExternalNetwork === true) issue(issues, "provenance.runtimeExternalNetwork", "A local-only ground release must not declare runtime external network use.");
  }

  return issues.length === 0 ? { ok: true, value: value as unknown as GroundReleaseDocument } : { ok: false, issues };
}

export interface GroundReleaseGraph {
  ledger: GroundOwnershipLedger;
  document: GroundReleaseDocument;
  features: GroundFeature[];
  parts: GroundFeaturePart[];
}

/**
 * The whole ground release, validated closed.
 *
 * Invokes the structural validators and the domain feature-set validator rather
 * than re-implementing their rules, then adds only the cross-document
 * agreements no single validator can see.
 */
export function validateGroundReleaseGraph(value: unknown): GroundValidation<GroundReleaseGraph> {
  const issues: GroundReleaseIssue[] = [];
  if (!record(value)) return { ok: false, issues: [{ path: "$", message: "Ground release graph must be an object." }] };
  exactKeys(value, ["ledger", "document", "features", "parts"], "$", issues);
  if (issues.length > 0) return { ok: false, issues };

  const ledgerResult = validateGroundOwnershipLedgerStructure(value.ledger);
  if (!ledgerResult.ok) for (const entry of ledgerResult.issues) issue(issues, `ledger.${entry.path}`, entry.message);
  const documentResult = validateGroundReleaseStructure(value.document);
  if (!documentResult.ok) for (const entry of documentResult.issues) issue(issues, `document.${entry.path}`, entry.message);
  const setResult = validateGroundFeatureSet({ features: value.features, parts: value.parts });
  if (!setResult.ok) for (const entry of setResult.issues) issue(issues, entry.path, entry.message);
  if (!ledgerResult.ok || !documentResult.ok || !setResult.ok) return { ok: false, issues };

  const ledger = ledgerResult.value;
  const document = documentResult.value;
  const { features, parts } = setResult.value;

  const coverageResult = validateGroundPartitionCoverage(ledger);
  if (!coverageResult.ok) for (const entry of coverageResult.issues) issue(issues, `ledger.${entry.path}`, entry.message);

  if (document.schemaVersion !== ledger.schemaVersion) issue(issues, "document.schemaVersion", "Release document and ownership ledger must declare the same schema version.");
  if (document.cityId !== ledger.cityId) issue(issues, "document.cityId", "Release document and ownership ledger must name the same city.");
  if (document.configId !== ledger.configId) issue(issues, "document.configId", "Release document and ownership ledger must name the same configuration.");
  if (document.partitionSchemeId !== ledger.partitionSchemeId) issue(issues, "document.partitionSchemeId", "Release document and ownership ledger must name the same partition scheme.");
  if (document.ownershipLedgerId !== ledger.ledgerId) issue(issues, "document.ownershipLedgerId", "Release document must pin the ownership ledger it was built against.");

  const cellById = new Map(ledger.cells.map((cell) => [cell.cellId, cell]));
  const partById = new Map(parts.map((part) => [part.partId, part]));
  for (const cell of ledger.cells) {
    for (const partId of cell.partIds) {
      const part = partById.get(partId);
      if (!part) { issue(issues, `ledger.cells.${cell.cellId}`, `Cell claims unknown part ${partId}.`); continue; }
      if (part.ownerCellId !== cell.cellId) issue(issues, `ledger.cells.${cell.cellId}`, `Part ${partId} is owned by ${part.ownerCellId}, not this cell.`);
    }
  }
  for (const part of parts) {
    const cell = cellById.get(part.ownerCellId);
    if (!cell) { issue(issues, `parts.${part.partId}`, "Part names a cell that is not in the ownership ledger."); continue; }
    if (!cell.partIds.includes(part.partId)) issue(issues, `parts.${part.partId}`, "Part is not listed in its owning cell's membership.");
  }

  if (ledger.baseIdentitySet.featureCount !== features.length) issue(issues, "ledger.baseIdentitySet.featureCount", "Pinned feature count does not match the feature set.");
  if (ledger.baseIdentitySet.partCount !== parts.length) issue(issues, "ledger.baseIdentitySet.partCount", "Pinned part count does not match the part set.");
  if (ledger.baseIdentitySet.checksumSha256 !== groundIdentitySetChecksum(features, parts)) issue(issues, "ledger.baseIdentitySet.checksumSha256", "Pinned identity checksum does not match the feature and part set.");

  for (const feature of features) {
    if (feature.cityId !== ledger.cityId) issue(issues, `features.${feature.canonicalFeatureId}.cityId`, "Ground feature belongs to a different city than the ledger.");
  }

  document.assets.forEach((asset, index) => {
    if (!cellById.has(asset.cellId)) issue(issues, `document.assets[${index}].cellId`, "Asset names a cell that is not in the ownership ledger.");
  });

  if (!withinBounds(document.clip.clipBounds, ledger.coverage)) issue(issues, "document.clip.clipBounds", "Clip bounds must lie inside the ledger coverage.");

  return issues.length === 0 ? { ok: true, value: { ledger, document, features, parts } } : { ok: false, issues };
}
