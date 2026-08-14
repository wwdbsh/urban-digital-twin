import type { Geometry, Position } from "../domain/schema.ts";
import { isSafeLocalReleaseReference } from "../runtime/path-security.ts";
import { parseTileKey, tileBounds, tileKeyForCoordinate, tileKeyString, type TileBounds, type TileKey } from "../runtime/spatial.ts";
import { sha256HexSync, stableSerialize } from "./catalog-release.ts";

export const CITYWIDE_RELEASE_SCHEMA_VERSION = "1.0" as const;
export const CITYWIDE_RELEASE_ID = "manhattan-citywide-20260804" as const;
export const CITYWIDE_TILE_LEVEL = 14 as const;
export const CITYWIDE_BUDGETS = Object.freeze({
  rootBytes: 256 * 1024,
  geometryShardBytes: 2 * 1024 * 1024,
  searchDetailShardBytes: 1024 * 1024,
  totalBytes: 300 * 1024 * 1024,
  maxShards: 512,
  maxFeaturesPerGeometryShard: 2_000,
  maxLoadedShards: 24,
  maxLoadedBytes: 48 * 1024 * 1024,
  maxConcurrentRequests: 4,
  maxRenderedDenseFeatures: 6_000,
  maxDecodedSummaries: 8_192,
  maxDecodedFeatures: 8_192,
  maxDecodedDetails: 512,
} as const);

/**
 * A resolved budget record.
 *
 * `CITYWIDE_BUDGETS` is read at build, validation, runtime-selection and
 * cache-construction sites and is the default `CitywideLruCache` argument, so
 * raising a field on the constant raises it for every session — including the
 * civic and composed sessions that never asked for citywide overview
 * residency. T004 therefore resolves a record per session instead of mutating
 * the constant; the constant itself is pinned byte-for-byte by a test.
 */
export type CitywideBudgetRecord = { readonly [K in keyof typeof CITYWIDE_BUDGETS]: number };

/**
 * Overview-streaming budgets, raised from the committed release census rather
 * than from preference.  Every number below is arithmetic over
 * `public/data/manhattan-citywide-20260804/manifest.json`:
 *
 *   maxLoadedShards 112
 *     56 building geometry shards + 47 restaurant geometry shards = 103, the
 *     whole committed dense island.  At exactly 103 the first search shard or
 *     detail shard would evict a geometry shard, so the cap carries the four
 *     class floors (56 + 47 + 2 search + 2 details = 107) plus 5 entries of
 *     working headroom.  A cap equal to the sum of the floors would leave the
 *     evictor no legal candidate, so the cap must exceed it.
 *
 *   maxLoadedBytes 80 MiB (83,886,080 B)
 *     geometry 60,183,280 B (buildings 45,903,404 + restaurants 14,279,876)
 *     + detail index 2,633,218 B
 *     + largest search shard 558,788 B
 *     + largest detail shard 1,048,527 B
 *     = 64,423,813 B is the floor a working overview session cannot go below.
 *     80 MiB leaves 19,462,267 B — about 18 further search/detail shards —
 *     so ordinary querying does not push the byte ceiling into the geometry.
 *     These are WIRE bytes (the cached JSON text). Decoded GPU and JS-heap
 *     arithmetic is recorded in ADR 0043 and is not measured here.
 *
 *   maxRenderedDenseFeatures 57,547
 *     45,194 building parents + 12,353 restaurant parents present in the
 *     geometry shards.  Not 57,633: the release declares 12,439 restaurant
 *     parents, but 86 of them are `location-unavailable` and therefore never
 *     appear in a geometry shard, so they can never reach the dense path.
 *     57,547 is the largest set the dense path can actually be handed.
 *     One combined limit rather than a split building/POI pair: at the full
 *     renderable census the limit can never truncate, so a split would add a
 *     second selection axis that no measurement could distinguish from this
 *     one.
 *
 * The decoded-feature and decoded-summary LRUs are deliberately NOT raised.
 * The render source is the adapter's visible-feature sequence, not those maps,
 * so raising them buys no rendered building and costs the JS-heap expansion
 * ADR 0043 records.
 */
export const CITYWIDE_OVERVIEW_BUDGETS: CitywideBudgetRecord = Object.freeze({
  ...CITYWIDE_BUDGETS,
  maxLoadedShards: 112,
  maxLoadedBytes: 80 * 1024 * 1024,
  maxRenderedDenseFeatures: 57_547,
});

/** The one flag (`?exteriorScheduler=on`) selects the record; nothing mutates. */
export function resolveCitywideBudgets(overviewStreaming: boolean): CitywideBudgetRecord {
  return overviewStreaming ? CITYWIDE_OVERVIEW_BUDGETS : CITYWIDE_BUDGETS;
}

/**
 * Cache classes, derived from the release ref prefix so the same derivation
 * works for every namespace the shared cache holds (`citywide:`, `civic:`, and
 * any later one).  A key is `<namespace>:<relativeContentRef>`.
 */
export type CitywideCacheClass = "geometry/buildings" | "geometry/restaurants" | "search" | "details" | "other";

export function citywideCacheClass(key: string): CitywideCacheClass {
  const separator = key.indexOf(":");
  const ref = separator >= 0 ? key.slice(separator + 1) : key;
  if (ref.startsWith("geometry/buildings/")) return "geometry/buildings";
  if (ref.startsWith("geometry/restaurants/")) return "geometry/restaurants";
  if (ref.startsWith("search/")) return "search";
  if (ref.startsWith("details/")) return "details";
  return "other";
}

export type CitywideCacheFloors = Partial<Record<CitywideCacheClass, number>>;

/**
 * Per-class floors for the overview session.
 *
 * A floor is a PERMISSION TO KEEP, not a space reservation: it is never
 * consulted on admission, only when `evict` is choosing which resident entry
 * to drop.  Nothing is held back for a class that is not using it, so the
 * building classes shrink naturally as the selection releases their shards.
 *
 * Each floor is at least one entry, so the largest single entry of every class
 * (buildings 2,096,314 B, restaurants 1,487,908 B, search 558,788 B, details
 * 1,048,527 B) is always keepable.  The geometry floors are the whole
 * committed dense island (56 and 47) because that is what the overview
 * renders; `search` and `details` keep 2 each so an in-flight query and the
 * detail index plus one detail shard survive a geometry sweep.
 */
export const CITYWIDE_OVERVIEW_CACHE_FLOORS: CitywideCacheFloors = Object.freeze({
  "geometry/buildings": 56,
  "geometry/restaurants": 47,
  search: 2,
  details: 2,
});

/** No floors. Named so a caller cannot express "unfloored" by accident. */
export const CITYWIDE_NO_CACHE_FLOORS: CitywideCacheFloors = Object.freeze({});

export type CitywideLayerId = "buildings" | "restaurants";
export type CitywideRecordKind = "building" | "restaurant";
export type CitywideLocationStatus = "located" | "location-unavailable";

export interface CitywideApprovalEvidence {
  messageId: string;
  scope: string;
  exclusions: string[];
}

export interface CitywideSourceSnapshotEvidence {
  registryEntryId: string;
  provider: string;
  datasetId: string;
  captureTimestamp: string;
  sourceUpdatedAt: string | null;
  rawRelativeRef: string;
  rawByteSize: number;
  rawChecksumSha256: string;
  sourceRecordCount: number;
  acceptedCount: number;
  rejectedCount: number;
  termsUrl: string;
  attribution: string;
}

export interface CitywideAnchorCoverage {
  id: string;
  label: string;
  longitude: number;
  latitude: number;
  buildingCount: number;
  restaurantCount: number;
  tileKeys: string[];
  sourceBacked: boolean;
}

export interface CitywideCoverageEvidence {
  cityId: "manhattan";
  claim: "snapshot-relative-all-records-accounted";
  boundaryEvidence: string;
  candidateBuildingCount: number;
  acceptedBuildingCount: number;
  unresolvedBuildingCount: number;
  acceptedRestaurantObservationCount: number;
  rejectedRestaurantObservationCount: number;
  locatedRestaurantParentCount: number;
  unlocatedRestaurantParentCount: number;
  anchors: CitywideAnchorCoverage[];
  accountingRemainderCount: number;
  identityCollisionCount: number;
  pilotReplayStable: boolean;
}

export interface CitywideBuildingPart {
  parentId: string;
  partId: string;
  partIndex: number;
  partCount: number;
  name: string;
  geometry: Geometry;
  coordinates: Position;
  heightMeters: number | null;
  heightUnknown: boolean;
  sourceRecordId: string;
  bin: string | null;
  baseBbl: string | null;
  mapPlutoBbl: string | null;
  tileKey: string;
  sourceRefIds: string[];
}

export interface CitywideRestaurantSummary {
  parentId: string;
  name: string | null;
  address: string | null;
  cuisine: string | null;
  categories: string[];
  coordinates: Position | null;
  locationStatus: CitywideLocationStatus;
  observationCount: number;
  sourceRecordIds: string[];
  tileKeys: string[];
  detailRef: string;
}

export interface CitywideSearchSummary {
  parentId: string;
  kind: CitywideRecordKind;
  name: string | null;
  address: string | null;
  cuisine: string | null;
  sourceIdentifiers: string[];
  normalizedTokens: string[];
  coordinates: Position | null;
  locationStatus: CitywideLocationStatus;
  tileKeys: string[];
  detailRef: string;
}

export interface CitywideDetailRecord {
  parentId: string;
  kind: CitywideRecordKind;
  name: string | null;
  locationStatus: CitywideLocationStatus;
  coordinates: Position | null;
  sourceRecordIds: string[];
  sourceRefIds: string[];
  freshness: { capturedAt: string | null; updatedAt: string | null; observedAt: string | null };
  uncertainty: string;
  attributes: Record<string, unknown>;
  observations?: readonly Record<string, unknown>[];
}

export interface CitywideShardManifest {
  shardId: string;
  layer: CitywideLayerId;
  tileKey: string;
  bounds: TileBounds;
  featureCount: number;
  byteSize: number;
  checksumSha256: string;
  relativeContentRef: string;
  sourceRegistryEntryIds: string[];
  densePartIndex: number;
  densePartCount: number;
}

export interface CitywideSearchShardManifest {
  shardId: string;
  prefix: string;
  kind: CitywideRecordKind | "mixed";
  summaryCount: number;
  byteSize: number;
  checksumSha256: string;
  relativeContentRef: string;
  parentIds: string[];
}

export interface CitywideDetailShardManifest {
  shardId: string;
  parentIds: string[];
  byteSize: number;
  checksumSha256: string;
  relativeContentRef: string;
}

export interface CitywideDetailIndexManifest {
  relativeContentRef: string;
  byteSize: number;
  checksumSha256: string;
  entryCount: number;
}

export interface CitywideLayerManifest {
  id: CitywideLayerId;
  label: string;
  tileLevel: typeof CITYWIDE_TILE_LEVEL;
  parentCount: number;
  renderPartCount: number;
  shardCount: number;
  sourceRegistryEntryIds: string[];
}

export interface CitywideReleaseManifest {
  schemaVersion: typeof CITYWIDE_RELEASE_SCHEMA_VERSION;
  releaseId: string;
  cityId: "manhattan";
  scope: "citywide";
  outputCrs: "EPSG:4326";
  generatedAt: string;
  fixtureOnly: boolean;
  approval: CitywideApprovalEvidence;
  sourceSnapshots: CitywideSourceSnapshotEvidence[];
  coverage: CitywideCoverageEvidence;
  layers: CitywideLayerManifest[];
  geometryShards: CitywideShardManifest[];
  searchShards: CitywideSearchShardManifest[];
  detailShards: CitywideDetailShardManifest[];
  /** The index is loaded lazily by the browser, but its immutable contract is root-declared. */
  detailIndex?: CitywideDetailIndexManifest;
  totalDeclaredBytes: number;
  publishedFiles: Record<string, string>;
  fallback: { mode: "fixtures"; reason: string };
}

export interface SyntheticCitywideRelease {
  manifest: CitywideReleaseManifest;
  geometry: Map<string, CitywideBuildingPart[] | CitywideRestaurantSummary[]>;
  search: Map<string, CitywideSearchSummary[]>;
  details: Map<string, CitywideDetailRecord[]>;
  bytes: Map<string, string>;
}

export interface CitywideManifestIssue {
  path: string;
  message: string;
}

export type CitywideManifestValidation = { ok: true; value: CitywideReleaseManifest } | { ok: false; issues: CitywideManifestIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isChecksum(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function issue(path: string, message: string): CitywideManifestIssue {
  return { path, message };
}

function validBounds(value: unknown): value is TileBounds {
  if (!isRecord(value)) return false;
  return ["west", "south", "east", "north"].every((key) => typeof value[key] === "number" && Number.isFinite(value[key]));
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("/") && !value.includes("\\");
}

function validateShardRefs(
  shards: readonly (CitywideShardManifest | CitywideSearchShardManifest | CitywideDetailShardManifest)[],
  path: string,
  issues: CitywideManifestIssue[],
  seenRefs: Set<string>,
): void {
  shards.forEach((shard, index) => {
    const shardPath = `${path}[${index}]`;
    if (!safeId(shard.shardId)) issues.push(issue(`${shardPath}.shardId`, "Shard ID must be a safe non-empty ID."));
    if (!Number.isSafeInteger(shard.byteSize) || shard.byteSize < 0) issues.push(issue(`${shardPath}.byteSize`, "Shard byte size must be a non-negative integer."));
    const limit = "layer" in shard ? CITYWIDE_BUDGETS.geometryShardBytes : "prefix" in shard ? CITYWIDE_BUDGETS.searchDetailShardBytes : CITYWIDE_BUDGETS.searchDetailShardBytes;
    if (shard.byteSize > limit) issues.push(issue(`${shardPath}.byteSize`, `Shard exceeds ${limit}-byte budget.`));
    if (!isChecksum(shard.checksumSha256)) issues.push(issue(`${shardPath}.checksumSha256`, "Shard SHA-256 checksum is required."));
    if (!isSafeLocalReleaseReference(shard.relativeContentRef)) issues.push(issue(`${shardPath}.relativeContentRef`, "Shard ref must be a safe relative POSIX path."));
    if (seenRefs.has(shard.relativeContentRef)) issues.push(issue(`${shardPath}.relativeContentRef`, "Content refs must be unique."));
    seenRefs.add(shard.relativeContentRef);
    if ("layer" in shard && (!Array.isArray(shard.sourceRegistryEntryIds) || shard.sourceRegistryEntryIds.length === 0)) issues.push(issue(`${shardPath}.sourceRegistryEntryIds`, "Geometry source groups are required."));
  });
}

export function validateCitywideReleaseManifest(value: unknown): CitywideManifestValidation {
  const issues: CitywideManifestIssue[] = [];
  if (!isRecord(value)) return { ok: false, issues: [issue("$", "Citywide release manifest must be an object.")] };
  if (value.schemaVersion !== CITYWIDE_RELEASE_SCHEMA_VERSION) issues.push(issue("schemaVersion", "Unsupported citywide release schema."));
  if (!safeId(value.releaseId)) issues.push(issue("releaseId", "Release ID is required."));
  if (value.cityId !== "manhattan" || value.scope !== "citywide" || value.outputCrs !== "EPSG:4326") issues.push(issue("scope", "Citywide release must be Manhattan WGS84."));
  if (!isTimestamp(value.generatedAt)) issues.push(issue("generatedAt", "Generated timestamp is required."));
  if (typeof value.fixtureOnly !== "boolean") issues.push(issue("fixtureOnly", "Fixture flag is required."));
  const approval = value.approval;
  if (!isRecord(approval) || typeof approval.messageId !== "string" || typeof approval.scope !== "string" || !Array.isArray(approval.exclusions)) issues.push(issue("approval", "Approval evidence and exclusions are required."));
  const sources = value.sourceSnapshots;
  if (!Array.isArray(sources) || sources.length === 0) issues.push(issue("sourceSnapshots", "At least one source snapshot is required."));
  else sources.forEach((source, index) => {
    if (!isRecord(source)) {
      issues.push(issue(`sourceSnapshots[${index}]`, "Source snapshot evidence is incomplete."));
      return;
    }
    if (typeof source.registryEntryId !== "string" || typeof source.provider !== "string" || typeof source.datasetId !== "string" || !isTimestamp(source.captureTimestamp) || (source.sourceUpdatedAt !== null && !isTimestamp(source.sourceUpdatedAt)) || !isSafeLocalReleaseReference(source.rawRelativeRef) || !isNonNegativeInteger(source.rawByteSize) || !isChecksum(source.rawChecksumSha256) || !isNonNegativeInteger(source.sourceRecordCount) || !isNonNegativeInteger(source.acceptedCount) || !isNonNegativeInteger(source.rejectedCount) || typeof source.termsUrl !== "string" || typeof source.attribution !== "string") issues.push(issue(`sourceSnapshots[${index}]`, "Source snapshot evidence is incomplete."));
  });
  const coverage = value.coverage;
  if (!isRecord(coverage) || coverage.cityId !== "manhattan" || coverage.claim !== "snapshot-relative-all-records-accounted" || typeof coverage.boundaryEvidence !== "string" || !Number.isSafeInteger(coverage.unresolvedBuildingCount) || coverage.unresolvedBuildingCount !== 0 || !Number.isSafeInteger(coverage.accountingRemainderCount) || coverage.accountingRemainderCount !== 0 || !Number.isSafeInteger(coverage.identityCollisionCount) || coverage.identityCollisionCount !== 0 || coverage.pilotReplayStable !== true || !Array.isArray(coverage.anchors)) issues.push(issue("coverage", "Coverage/accounting evidence is incomplete or non-zero."));
  else coverage.anchors.forEach((anchor, index) => {
    if (!isRecord(anchor) || typeof anchor.id !== "string" || typeof anchor.label !== "string" || typeof anchor.longitude !== "number" || typeof anchor.latitude !== "number" || !Number.isSafeInteger(anchor.buildingCount) || !Number.isSafeInteger(anchor.restaurantCount) || !Array.isArray(anchor.tileKeys) || anchor.sourceBacked !== true) issues.push(issue(`coverage.anchors[${index}]`, "Anchor coverage evidence is incomplete."));
  });
  const layers = value.layers;
  if (!Array.isArray(layers) || layers.length !== 2) issues.push(issue("layers", "Building and restaurant layer manifests are required."));
  const seenRefs = new Set<string>();
  if (!Array.isArray(value.geometryShards)) issues.push(issue("geometryShards", "Geometry shard manifests are required."));
  else {
    validateShardRefs(value.geometryShards as CitywideShardManifest[], "geometryShards", issues, seenRefs);
    value.geometryShards.forEach((shard, index) => {
      if (shard.layer !== "buildings" && shard.layer !== "restaurants") issues.push(issue(`geometryShards[${index}].layer`, "Unsupported citywide layer."));
      if (typeof shard.tileKey !== "string" || !validBounds(shard.bounds) || !Number.isSafeInteger(shard.featureCount) || shard.featureCount < 0 || shard.featureCount > CITYWIDE_BUDGETS.maxFeaturesPerGeometryShard) issues.push(issue(`geometryShards[${index}]`, "Geometry shard tile/count metadata is invalid."));
    });
  }
  if (!Array.isArray(value.searchShards)) issues.push(issue("searchShards", "Search shard manifests are required."));
  else validateShardRefs(value.searchShards as CitywideSearchShardManifest[], "searchShards", issues, seenRefs);
  if (!Array.isArray(value.detailShards)) issues.push(issue("detailShards", "Detail shard manifests are required."));
  else validateShardRefs(value.detailShards as CitywideDetailShardManifest[], "detailShards", issues, seenRefs);
  if (!value.fixtureOnly) {
    const detailIndex = value.detailIndex;
    if (!isRecord(detailIndex) || !isSafeLocalReleaseReference(detailIndex.relativeContentRef) || !isNonNegativeInteger(detailIndex.byteSize) || !isChecksum(detailIndex.checksumSha256) || detailIndex.entryCount !== 57_633) {
      issues.push(issue("detailIndex", "Production citywide releases require a checksum-pinned 57,633-entry detail index."));
    } else if (seenRefs.has(detailIndex.relativeContentRef)) {
      issues.push(issue("detailIndex.relativeContentRef", "Detail index content ref must be unique."));
    } else {
      seenRefs.add(detailIndex.relativeContentRef);
    }
  }
  const totalShards = (Array.isArray(value.geometryShards) ? value.geometryShards.length : 0) + (Array.isArray(value.searchShards) ? value.searchShards.length : 0) + (Array.isArray(value.detailShards) ? value.detailShards.length : 0);
  if (totalShards > CITYWIDE_BUDGETS.maxShards) issues.push(issue("shards", "Citywide release exceeds the shard-count budget."));
  if (!isNonNegativeInteger(value.totalDeclaredBytes) || value.totalDeclaredBytes > CITYWIDE_BUDGETS.totalBytes) issues.push(issue("totalDeclaredBytes", "Citywide release exceeds the total byte budget."));
  if (!isRecord(value.publishedFiles) || Object.values(value.publishedFiles).some((ref) => !isChecksum(ref))) issues.push(issue("publishedFiles", "Published file checksum map is invalid."));
  if (!isRecord(value.fallback) || value.fallback.mode !== "fixtures" || typeof value.fallback.reason !== "string") issues.push(issue("fallback", "Explicit fixture fallback state is required."));
  if (issues.length) return { ok: false, issues };
  return { ok: true, value: value as unknown as CitywideReleaseManifest };
}

function boundsIntersect(left: TileBounds, right: TileBounds): boolean {
  return left.west <= right.east && left.east >= right.west && left.south <= right.north && left.north >= right.south;
}

function neighborTileKeys(tile: TileKey, radius: number): Set<string> {
  const keys = new Set<string>();
  const dimension = 2 ** tile.level;
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      const x = (tile.x + dx + dimension) % dimension;
      const y = Math.min(dimension - 1, Math.max(0, tile.y + dy));
      keys.add(tileKeyString({ ...tile, x, y }));
    }
  }
  return keys;
}

export function selectViewportShards(
  shards: readonly CitywideShardManifest[],
  viewport: TileBounds,
  prefetchRing = 1,
): CitywideShardManifest[] {
  if (!Number.isInteger(prefetchRing) || prefetchRing < 0 || prefetchRing > 1) throw new Error("Citywide prefetch ring must be 0 or 1.");
  const visible = shards.filter((shard) => boundsIntersect(shard.bounds, viewport));
  const wantedKeys = new Set<string>();
  visible.forEach((shard) => {
    try { neighborTileKeys(parseTileKey(shard.tileKey), prefetchRing).forEach((key) => wantedKeys.add(key)); } catch { wantedKeys.add(shard.tileKey); }
  });
  return shards.filter((shard) => wantedKeys.has(shard.tileKey) || (visible.length === 0 && boundsIntersect(shard.bounds, viewport))).sort((left, right) => left.shardId.localeCompare(right.shardId));
}

export function normalizeCitywideQuery(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

export function citywideQueryTokens(value: string): string[] {
  return [...new Set(normalizeCitywideQuery(value).split(" ").filter((token) => token.length >= 2))].sort();
}

export function citywideExactIdBucket(value: string): string {
  let hash = 0;
  for (const char of value.toLocaleLowerCase()) hash = Math.imul(hash ^ char.codePointAt(0)!, 16_777_619);
  return `id-${String((Math.abs(hash) >>> 0) % 16).padStart(2, "0")}`;
}

export function isCitywideExactParentIdentifier(value: string): boolean {
  return /^(?:doitt:[^\s]+|dohmh:camis:[^\s]+)$/iu.test(value.trim());
}

export function isCitywideExactIdentifier(value: string): boolean {
  const trimmed = value.trim();
  return isCitywideExactParentIdentifier(trimmed) || /^\d{7,10}$/u.test(trimmed);
}

/**
 * Choose the smallest complete candidate prefix for an AND query. The
 * citywide builder emits each summary into every first-character prefix of
 * its normalized searchable tokens, so one prefix is sufficient to produce
 * the candidate set; the caller still applies the complete token predicate.
 * Keeping this routing decision in the shared release contract prevents the
 * browser and the offline benchmark from measuring different search paths.
 */
export function selectCitywideSearchPrefixes(
  shards: readonly Pick<CitywideSearchShardManifest, "prefix" | "summaryCount" | "byteSize">[],
  query: string,
): string[] {
  const raw = query.trim();
  const normalized = normalizeCitywideQuery(query);
  if (!normalized) return [];
  if (isCitywideExactIdentifier(raw)) return [citywideExactIdBucket(raw)];
  const tokens = citywideQueryTokens(normalized);
  if (tokens.length === 0) return [];
  const stats = new Map<string, { summaryCount: number; byteSize: number }>();
  shards.forEach((shard) => {
    const current = stats.get(shard.prefix) ?? { summaryCount: 0, byteSize: 0 };
    current.summaryCount += Number.isFinite(shard.summaryCount) ? shard.summaryCount : Number.MAX_SAFE_INTEGER;
    current.byteSize += Number.isFinite(shard.byteSize) ? shard.byteSize : Number.MAX_SAFE_INTEGER;
    stats.set(shard.prefix, current);
  });
  const candidates = tokens.map((token) => {
    const prefix = token.slice(0, 1);
    const metric = stats.get(prefix);
    return metric ? { prefix, ...metric } : null;
  });
  // A missing token prefix proves that no indexed summary can satisfy the
  // AND query. Do not fall back to a broad/hash route and parse unrelated
  // records in that case.
  if (candidates.some((candidate) => candidate === null)) return [];
  const selected = candidates
    .filter((candidate): candidate is { prefix: string; summaryCount: number; byteSize: number } => candidate !== null)
    .sort((left, right) => left.summaryCount - right.summaryCount || left.byteSize - right.byteSize || left.prefix.localeCompare(right.prefix))[0];
  return selected ? [selected.prefix] : [];
}

export function citywidePrefixForToken(token: string): string {
  const normalized = normalizeCitywideQuery(token);
  return normalized.length < 2 ? normalized : normalized.slice(0, 2);
}

export function stableCitywidePickId(parentId: string): string {
  return `citywide-parent:${parentId}`;
}

/**
 * The shared recency cache behind every release runtime.
 *
 * ## The byte counter is incremental, and that is a T003 change
 *
 * `bytes()` used to be a full reduce over every entry, and `evict()` called it
 * inside its own `while` condition — so one saturating `set()` that had to drop
 * k entries walked the whole map k times, and a cache holding n entries did
 * O(n * k) work to admit one artifact. That was tolerable while eviction was a
 * rare backstop nobody expected to fire. T003 makes scheduler-driven residency
 * routine, so eviction stops being rare, and the counter is now maintained
 * incrementally by the three mutators. `bytes()` reads the running total.
 *
 * The running total is an INVARIANT rather than a cache of a computation, so a
 * test re-derives it by full reduce after a mixed workload rather than trusting
 * that the three mutators agree.
 *
 * ## A desync warning for whoever adds a per-class ceiling
 *
 * `set()` THROWS for an entry larger than `maxBytes`, and callers precheck the
 * same condition before fetching — `ExteriorCellRuntime.loadVerifiedArtifact`
 * reads `cache.maxBytes` and fails closed with `artifact-exceeds-cache-budget`.
 * The two agree today only because both read the SAME `maxBytes`. A future
 * per-class reservation that gave one class a smaller effective ceiling would
 * break that: the precheck would pass against the pool ceiling and `set()` would
 * throw against the class ceiling, from inside a settled request promise, and
 * the failure would surface as an unrelated code. Any per-class ceiling must
 * therefore be readable by the precheck, not only enforced at `set()`.
 */
export class CitywideLruCache<T> {
  private readonly entries = new Map<string, { value: T; bytes: number; used: number; cacheClass: CitywideCacheClass }>();
  private readonly classCounts = new Map<CitywideCacheClass, number>();
  private readonly classEvictions = new Map<CitywideCacheClass, number>();
  private clock = 0;
  private evictions = 0;
  private totalBytes = 0;
  private currentMaxEntries: number;
  private currentMaxBytes: number;
  private currentFloors: CitywideCacheFloors;
  get maxEntries(): number { return this.currentMaxEntries; }
  get maxBytes(): number { return this.currentMaxBytes; }
  get floors(): CitywideCacheFloors { return this.currentFloors; }
  constructor(maxEntries: number = CITYWIDE_BUDGETS.maxLoadedShards, maxBytes: number = CITYWIDE_BUDGETS.maxLoadedBytes, floors: CitywideCacheFloors = CITYWIDE_NO_CACHE_FLOORS) {
    this.currentMaxEntries = maxEntries;
    this.currentMaxBytes = maxBytes;
    this.currentFloors = floors;
    this.assertConfiguration(maxEntries, maxBytes, floors);
  }
  /**
   * Re-point one shared cache at a different recorded configuration.
   *
   * This exists because the aggregate cache has several tenants and only ONE
   * of them ever wants overview residency. A flag that pinned the citywide
   * island while a civic session was the one on screen would starve the
   * tenant the user is actually looking at, so the caller re-applies the
   * configuration when the active mode changes rather than choosing once at
   * mount. Only the two RECORDED configurations are ever applied, and both
   * byte caps exceed every declared shard size, so no re-configuration can
   * make an already-legal artifact inadmissible.
   */
  configure(maxEntries: number, maxBytes: number, floors: CitywideCacheFloors = CITYWIDE_NO_CACHE_FLOORS): void {
    this.assertConfiguration(maxEntries, maxBytes, floors);
    this.currentMaxEntries = maxEntries;
    this.currentMaxBytes = maxBytes;
    this.currentFloors = floors;
    this.evict();
  }
  private assertConfiguration(maxEntries: number, maxBytes: number, floors: CitywideCacheFloors): void {
    // A cap that does not exceed the sum of the floors would leave `evict` no
    // legal candidate on a full cache; the floors would then have to be
    // ignored wholesale, which is exactly the residency failure they exist to
    // prevent.  Refuse the configuration instead of silently degrading.
    const floorTotal = Object.values(floors).reduce((sum, value) => sum + (value ?? 0), 0);
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("Citywide cache caps must be positive integers.");
    if (Object.values(floors).some((value) => !Number.isSafeInteger(value) || (value ?? 0) < 1)) throw new Error("Citywide cache class floors must be positive integers.");
    if (floorTotal >= maxEntries) throw new Error("Citywide cache class floors must leave at least one evictable entry below the entry cap.");
  }
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    entry.used = ++this.clock;
    return entry.value;
  }
  /**
   * Admission is class-blind, deliberately.
   *
   * There is no citywide precheck anywhere on the load path: `set` runs inside
   * the pooled loader promise, after the fetch, the checksum and the JSON
   * parse.  A throw here surfaces as a failed shard load with the bytes
   * already paid for, so a class floor must never be able to refuse a legal
   * artifact.  Floors are consulted only by `evict` below.
   */
  set(key: string, value: T, bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.maxBytes) throw new Error("Citywide cache entry bytes are invalid.");
    this.dropEntry(key);
    const cacheClass = citywideCacheClass(key);
    this.entries.set(key, { value, bytes, used: ++this.clock, cacheClass });
    this.classCounts.set(cacheClass, (this.classCounts.get(cacheClass) ?? 0) + 1);
    this.totalBytes += bytes;
    this.evict();
  }
  delete(key: string): boolean { return this.dropEntry(key); }
  clear(): void { this.entries.clear(); this.classCounts.clear(); this.totalBytes = 0; }
  has(key: string): boolean { return this.entries.has(key); }
  size(): number { return this.entries.size; }
  bytes(): number { return this.totalBytes; }
  evictionCount(): number { return this.evictions; }
  keys(): string[] { return [...this.entries.keys()]; }
  /** Resident entries per class, for residency evidence. */
  classSizes(): Record<string, number> {
    return Object.fromEntries([...this.classCounts.entries()].filter(([, count]) => count > 0).sort(([left], [right]) => left.localeCompare(right)));
  }
  /** Evictions per class. The reservation AC has no per-class evidence without this. */
  classEvictionCounts(): Record<string, number> {
    return Object.fromEntries([...this.classEvictions.entries()].sort(([left], [right]) => left.localeCompare(right)));
  }
  /** The single place an entry leaves the map, so the running total cannot drift. */
  private dropEntry(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    this.totalBytes -= entry.bytes;
    const remaining = (this.classCounts.get(entry.cacheClass) ?? 1) - 1;
    if (remaining > 0) this.classCounts.set(entry.cacheClass, remaining);
    else this.classCounts.delete(entry.cacheClass);
    return true;
  }
  /**
   * Least-recently-used within the classes that are over their own floor.
   *
   * Chosen by one linear minimum scan rather than the previous full sort, so a
   * floor costs strictly less per drop than the code it replaces, not more.
   * With no floors configured the scan selects exactly the entry the sort's
   * first element selected — lowest `used`, ties broken by key — so every
   * unflagged session, including civic and composed, is unchanged.
   *
   * When no class is over its floor the floors yield: eviction must still make
   * progress or the cap would not bound anything.
   */
  private evict(): void {
    while (this.entries.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      const restricted = this.hasOverflowingClass();
      let victimKey: string | null = null;
      let victim: { used: number } | null = null;
      for (const [key, entry] of this.entries) {
        if (restricted && !this.isOverFloor(entry.cacheClass)) continue;
        if (victim === null || entry.used < victim.used || (entry.used === victim.used && key.localeCompare(victimKey!) < 0)) {
          victimKey = key;
          victim = entry;
        }
      }
      if (victimKey === null) break;
      const cacheClass = this.entries.get(victimKey)!.cacheClass;
      this.dropEntry(victimKey);
      this.classEvictions.set(cacheClass, (this.classEvictions.get(cacheClass) ?? 0) + 1);
      this.evictions += 1;
    }
  }
  private isOverFloor(cacheClass: CitywideCacheClass): boolean {
    return (this.classCounts.get(cacheClass) ?? 0) > (this.floors[cacheClass] ?? 0);
  }
  private hasOverflowingClass(): boolean {
    for (const cacheClass of this.classCounts.keys()) if (this.isOverFloor(cacheClass)) return true;
    return false;
  }
}

export interface CitywideRequestTask<T> {
  key: string;
  loader: (signal: AbortSignal) => Promise<{ value: T; bytes: number }>;
}

/**
 * Optional aggregate request ownership for composed releases.  Standalone
 * adapters keep their historical per-adapter pool when this is omitted;
 * composition injects one owner shared by the base and context adapters.
 */
export interface CitywideSharedRequestBudget {
  readonly maxConcurrent: number;
  acquire(signal?: AbortSignal): Promise<() => void>;
  activeCount(): number;
  peakConcurrency(): number;
}

export class CitywideRequestPool<T> {
  private readonly cache: CitywideLruCache<T>;
  private readonly sharedBudget: CitywideSharedRequestBudget | null;
  private readonly pending = new Map<string, { controller: AbortController; promise: Promise<T | undefined>; resolve: (value: T | undefined) => void; started: boolean; waiters: number; nonAbortableWaiters: number }>();
  private readonly queue: CitywideRequestTask<T>[] = [];
  private active = 0;
  private peak = 0;
  private aborted = 0;
  private failed = 0;
  readonly maxConcurrent: number;
  constructor(maxConcurrent: number = CITYWIDE_BUDGETS.maxConcurrentRequests, cache = new CitywideLruCache<T>(), sharedBudget: CitywideSharedRequestBudget | null = null) {
    if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > CITYWIDE_BUDGETS.maxConcurrentRequests) throw new Error("Citywide request concurrency must be between 1 and 4.");
    if (sharedBudget && (!Number.isSafeInteger(sharedBudget.maxConcurrent) || sharedBudget.maxConcurrent < 1 || sharedBudget.maxConcurrent > CITYWIDE_BUDGETS.maxConcurrentRequests)) throw new Error("Shared request concurrency must be between 1 and 4.");
    this.maxConcurrent = maxConcurrent;
    this.cache = cache;
    this.sharedBudget = sharedBudget;
  }
  load(task: CitywideRequestTask<T>, signal?: AbortSignal): Promise<T | undefined> {
    const shared = this.loadShared(task);
    if (!signal) {
      const pending = this.pending.get(task.key);
      if (!pending) return shared;
      pending.waiters += 1;
      pending.nonAbortableWaiters += 1;
      return shared.finally(() => this.releaseWaiter(task.key, false, true));
    }
    if (signal.aborted) return Promise.reject(new DOMException("Request was aborted.", "AbortError"));
    const pending = this.pending.get(task.key);
    if (pending) pending.waiters += 1;
    return new Promise<T | undefined>((resolve, reject) => {
      let settled = false;
      const cleanup = () => signal.removeEventListener("abort", onAbort);
      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        this.releaseWaiter(task.key, true, false);
        reject(new DOMException("Request was aborted.", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      shared.then((value) => {
        if (settled) return;
        settled = true;
        cleanup();
        this.releaseWaiter(task.key, false, false);
        resolve(value);
      }, (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        this.releaseWaiter(task.key, false, false);
        reject(error);
      });
    });
  }
  private loadShared(task: CitywideRequestTask<T>): Promise<T | undefined> {
    const cached = this.cache.get(task.key);
    if (cached !== undefined) return Promise.resolve(cached);
    const existing = this.pending.get(task.key);
    if (existing) return existing.promise;
    const controller = new AbortController();
    let settle: (value: T | undefined) => void = () => undefined;
    const promise = new Promise<T | undefined>((resolve) => {
      settle = resolve;
      this.queue.push(task);
      const run = () => {
        const current = this.pending.get(task.key);
        if (current) current.started = true;
        this.active += 1;
        this.peak = Math.max(this.peak, this.active);
        const runTask = async (): Promise<T | undefined> => {
          const release = this.sharedBudget ? await this.sharedBudget.acquire(controller.signal) : null;
          try {
            const result = await task.loader(controller.signal);
            this.cache.set(task.key, result.value, result.bytes);
            return result.value;
          } finally {
            release?.();
          }
        };
        runTask().then((value) => {
          return value;
        }).catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") this.aborted += 1;
          else this.failed += 1;
          return undefined;
        }).then((value) => {
          this.active -= 1;
          this.pending.delete(task.key);
          this.pump();
          resolve(value);
        });
      };
      (task as CitywideRequestTask<T> & { run?: () => void }).run = run;
    });
    this.pending.set(task.key, { controller, promise, resolve: settle, started: false, waiters: 0, nonAbortableWaiters: 0 });
    this.pump();
    return promise;
  }
  abortExcept(keys: readonly string[]): void {
    const keep = new Set(keys);
    for (const [key, pending] of this.pending) {
      if (keep.has(key)) continue;
      pending.controller.abort();
      if (!pending.started) {
        pending.resolve(undefined);
        this.pending.delete(key);
      }
    }
    this.queue.splice(0, this.queue.length, ...this.queue.filter((task) => keep.has(task.key)));
  }
  pendingCount(): number { return this.pending.size; }
  activeCount(): number { return this.active; }
  peakConcurrency(): number { return this.peak; }
  abortedCount(): number { return this.aborted; }
  failedCount(): number { return this.failed; }
  cacheMetrics(): { entries: number; bytes: number; evictions: number } { return { entries: this.cache.size(), bytes: this.cache.bytes(), evictions: this.cache.evictionCount() }; }
  private releaseWaiter(key: string, aborted: boolean, nonAbortable: boolean): void {
    const current = this.pending.get(key);
    if (!current) return;
    current.waiters = Math.max(0, current.waiters - 1);
    if (nonAbortable) current.nonAbortableWaiters = Math.max(0, current.nonAbortableWaiters - 1);
    if (aborted && current.waiters === 0 && current.nonAbortableWaiters === 0) {
      current.controller.abort();
      if (!current.started) {
        current.resolve(undefined);
        this.pending.delete(key);
        this.queue.splice(0, this.queue.length, ...this.queue.filter((queued) => queued.key !== key));
      }
    }
  }
  private pump(): void {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const task = this.queue.shift()!;
      const pending = this.pending.get(task.key);
      if (!pending) continue;
      const runner = (task as CitywideRequestTask<T> & { run?: () => void }).run;
      runner?.();
    }
  }
}

function syntheticAnchor(index: number): CitywideAnchorCoverage {
  const anchors = [
    ["financial-battery", "Financial/Battery", -74.012, 40.706],
    ["chelsea-midtown", "Chelsea/Midtown", -73.992, 40.748],
    ["upper-west", "Upper West", -73.975, 40.787],
    ["upper-east", "Upper East", -73.956, 40.773],
    ["harlem", "Harlem", -73.944, 40.817],
    ["inwood-marble-hill", "Inwood/Marble Hill", -73.922, 40.871],
    ["roosevelt-island", "Roosevelt Island", -73.949, 40.762],
  ] as const;
  const [id, label, longitude, latitude] = anchors[index]!;
  const tileKey = tileKeyString(tileKeyForCoordinate(longitude, latitude, CITYWIDE_TILE_LEVEL));
  return { id, label, longitude, latitude, buildingCount: 1, restaurantCount: 1, tileKeys: [tileKey], sourceBacked: true };
}

export function buildSyntheticCitywideRelease(): SyntheticCitywideRelease {
  const generatedAt = "2026-08-04T00:00:00.000Z";
  const geometry = new Map<string, CitywideBuildingPart[] | CitywideRestaurantSummary[]>();
  const search = new Map<string, CitywideSearchSummary[]>();
  const details = new Map<string, CitywideDetailRecord[]>();
  const bytes = new Map<string, string>();
  const geometryShards: CitywideShardManifest[] = [];
  const searchShards: CitywideSearchShardManifest[] = [];
  const detailShards: CitywideDetailShardManifest[] = [];
  const buildingParents = new Set<string>();
  const restaurantParents = new Set<string>();
  const anchors = Array.from({ length: 7 }, (_, index) => syntheticAnchor(index));
  anchors.forEach((anchor, index) => {
    const buildingParent = `fixture:citywide:building:${anchor.id}`;
    const restaurantParent = `fixture:citywide:restaurant:${anchor.id}`;
    buildingParents.add(buildingParent);
    restaurantParents.add(restaurantParent);
    const buildingTile = anchor.tileKeys[0]!;
    const buildingPart: CitywideBuildingPart = {
      parentId: buildingParent, partId: `${buildingParent}:part-0`, partIndex: 0, partCount: 1,
      name: `Synthetic ${anchor.label} building`,
      geometry: { type: "Polygon", coordinates: [[
        [anchor.longitude - 0.0002, anchor.latitude - 0.0002],
        [anchor.longitude + 0.0002, anchor.latitude - 0.0002],
        [anchor.longitude + 0.0002, anchor.latitude + 0.0002],
        [anchor.longitude - 0.0002, anchor.latitude + 0.0002],
        [anchor.longitude - 0.0002, anchor.latitude - 0.0002],
      ]] },
      coordinates: [anchor.longitude, anchor.latitude], heightMeters: 12, heightUnknown: false,
      sourceRecordId: `fixture-doitt-${index}`, bin: `fixture-bin-${index}`, baseBbl: null, mapPlutoBbl: null,
      tileKey: buildingTile, sourceRefIds: ["source-ref:fixture.local.manhattan-slice:citywide"],
    };
    const restaurant: CitywideRestaurantSummary = {
      parentId: restaurantParent, name: `Synthetic ${anchor.label} diner`, address: `${index + 1} Synthetic Way`,
      cuisine: "Synthetic", categories: ["restaurant"], coordinates: [anchor.longitude + 0.0003, anchor.latitude + 0.0003],
      locationStatus: "located", observationCount: 2, sourceRecordIds: [`fixture-camis-${index}`], tileKeys: [buildingTile],
      detailRef: `details/${restaurantParent}.json`,
    };
    geometry.set(`geometry/buildings/${buildingTile}/0.json`, [buildingPart]);
    geometry.set(`geometry/restaurants/${buildingTile}/0.json`, [restaurant]);
    const buildingSummary: CitywideSearchSummary = {
      parentId: buildingParent, kind: "building", name: buildingPart.name, address: null, cuisine: null,
      sourceIdentifiers: [buildingParent, buildingPart.sourceRecordId, buildingPart.bin ?? ""].filter(Boolean),
      normalizedTokens: citywideQueryTokens(buildingPart.name), coordinates: buildingPart.coordinates, locationStatus: "located",
      tileKeys: [buildingTile], detailRef: `details/${buildingParent}.json`,
    };
    const restaurantSummary: CitywideSearchSummary = {
      parentId: restaurantParent, kind: "restaurant", name: restaurant.name, address: restaurant.address, cuisine: restaurant.cuisine,
      sourceIdentifiers: [restaurantParent, ...restaurant.sourceRecordIds], normalizedTokens: citywideQueryTokens(`${restaurant.name} ${restaurant.address} ${restaurant.cuisine}`),
      coordinates: restaurant.coordinates, locationStatus: restaurant.locationStatus, tileKeys: restaurant.tileKeys, detailRef: restaurant.detailRef,
    };
    const prefix = citywidePrefixForToken(buildingSummary.normalizedTokens[0] ?? "sy");
    const restaurantPrefix = citywidePrefixForToken(restaurantSummary.normalizedTokens[0] ?? "sy");
    const existingBuilding = search.get(`search/prefix/${prefix}.json`) ?? [];
    const existingRestaurant = search.get(`search/prefix/${restaurantPrefix}.json`) ?? [];
    search.set(`search/prefix/${prefix}.json`, [...existingBuilding, buildingSummary]);
    search.set(`search/prefix/${restaurantPrefix}.json`, [...existingRestaurant, restaurantSummary]);
    details.set(buildingSummary.detailRef, [{
      parentId: buildingParent, kind: "building", name: buildingPart.name, locationStatus: "located", coordinates: buildingPart.coordinates,
      sourceRecordIds: [buildingPart.sourceRecordId], sourceRefIds: buildingPart.sourceRefIds,
      freshness: { capturedAt: generatedAt, updatedAt: null, observedAt: null }, uncertainty: "Synthetic fixture only.", attributes: { heightMeters: buildingPart.heightMeters },
    }]);
    details.set(restaurantSummary.detailRef, [{
      parentId: restaurantParent, kind: "restaurant", name: restaurant.name, locationStatus: "located", coordinates: restaurant.coordinates,
      sourceRecordIds: restaurant.sourceRecordIds, sourceRefIds: ["source-ref:fixture.local.manhattan-slice:citywide"],
      freshness: { capturedAt: generatedAt, updatedAt: null, observedAt: null }, uncertainty: "Synthetic fixture only.",
      attributes: { address: restaurant.address, cuisine: restaurant.cuisine }, observations: [{ observationCount: restaurant.observationCount }],
    }]);
  });
  for (const [ref, value] of geometry) {
    const serialized = stableSerialize(value);
    bytes.set(ref, serialized);
    const layer: CitywideLayerId = ref.startsWith("geometry/buildings") ? "buildings" : "restaurants";
    const tileParts = ref.split("/");
    const tileKey = tileParts.slice(2, 6).join("/");
    geometryShards.push({ shardId: `geometry:${layer}:${tileKey.replaceAll("/", ":")}:0`, layer, tileKey, bounds: tileBounds(parseTileKey(tileKey)), featureCount: value.length, byteSize: new TextEncoder().encode(serialized).byteLength, checksumSha256: sha256HexSync(serialized), relativeContentRef: ref, sourceRegistryEntryIds: ["fixture.local.manhattan-slice"], densePartIndex: 0, densePartCount: 1 });
  }
  for (const [ref, value] of search) {
    const serialized = stableSerialize(value);
    bytes.set(ref, serialized);
    const prefix = ref.match(/\/([^/]+)\.json$/)?.[1] ?? "";
    searchShards.push({ shardId: `search:${prefix}`, prefix, kind: "mixed", summaryCount: value.length, byteSize: new TextEncoder().encode(serialized).byteLength, checksumSha256: sha256HexSync(serialized), relativeContentRef: ref, parentIds: value.map((item) => item.parentId).sort() });
  }
  for (const [ref, value] of details) {
    const serialized = stableSerialize(value);
    bytes.set(ref, serialized);
    detailShards.push({ shardId: `detail:${value[0]?.parentId ?? ref}`, parentIds: value.map((item) => item.parentId), byteSize: new TextEncoder().encode(serialized).byteLength, checksumSha256: sha256HexSync(serialized), relativeContentRef: ref });
  }
  const manifest: CitywideReleaseManifest = {
    schemaVersion: CITYWIDE_RELEASE_SCHEMA_VERSION, releaseId: "fixture-citywide-scale", cityId: "manhattan", scope: "citywide",
    outputCrs: "EPSG:4326", generatedAt, fixtureOnly: true,
    approval: { messageId: "synthetic-fixture", scope: "synthetic scale fixture only", exclusions: ["provider requests", "production coverage"] },
    sourceSnapshots: [{ registryEntryId: "fixture.local.manhattan-slice", provider: "Urban Digital Twin synthetic fixture", datasetId: "citywide-scale", captureTimestamp: generatedAt, sourceUpdatedAt: null, rawRelativeRef: "fixtures/citywide/raw.json", rawByteSize: 0, rawChecksumSha256: sha256HexSync(""), sourceRecordCount: 14, acceptedCount: 14, rejectedCount: 0, termsUrl: "https://example.invalid/fixture-terms", attribution: "Synthetic fixture only." }],
    coverage: { cityId: "manhattan", claim: "snapshot-relative-all-records-accounted", boundaryEvidence: "synthetic anchor fixture", candidateBuildingCount: 7, acceptedBuildingCount: 7, unresolvedBuildingCount: 0, acceptedRestaurantObservationCount: 14, rejectedRestaurantObservationCount: 0, locatedRestaurantParentCount: 7, unlocatedRestaurantParentCount: 0, anchors, accountingRemainderCount: 0, identityCollisionCount: 0, pilotReplayStable: true },
    layers: [{ id: "buildings", label: "Buildings", tileLevel: CITYWIDE_TILE_LEVEL, parentCount: buildingParents.size, renderPartCount: buildingParents.size, shardCount: geometryShards.filter((shard) => shard.layer === "buildings").length, sourceRegistryEntryIds: ["fixture.local.manhattan-slice"] }, { id: "restaurants", label: "Restaurants", tileLevel: CITYWIDE_TILE_LEVEL, parentCount: restaurantParents.size, renderPartCount: restaurantParents.size, shardCount: geometryShards.filter((shard) => shard.layer === "restaurants").length, sourceRegistryEntryIds: ["fixture.local.manhattan-slice"] }],
    geometryShards: geometryShards.sort((left, right) => left.shardId.localeCompare(right.shardId)), searchShards: searchShards.sort((left, right) => left.shardId.localeCompare(right.shardId)), detailShards: detailShards.sort((left, right) => left.shardId.localeCompare(right.shardId)),
    totalDeclaredBytes: [...bytes.values()].reduce((sum, value) => sum + new TextEncoder().encode(value).byteLength, 0), publishedFiles: {}, fallback: { mode: "fixtures", reason: "Synthetic scale fixture is not production coverage." },
  };
  return { manifest, geometry, search, details, bytes };
}
