/**
 * Provider-neutral v2 release contracts for the Manhattan civic-context wave.
 *
 * The existing citywide v1 manifest remains the rollback release.  This module
 * intentionally keeps the new civic package generic so another city can reuse
 * the same layer/record/search/detail contracts without dataset-specific
 * runtime branches.
 */
import {
  TRAVEL_CONTEXT_SCHEMA_VERSION,
  travelContextPickPriority,
  type Geometry,
  type SourceApprovalEvidence,
  type SourceRef,
  type TravelContextGeometryKind,
  type TravelContextLayerDescriptor,
  type TravelContextLayerId,
  type TravelContextOverlapCandidate,
  type TravelContextRecord,
  type TravelContextRecordKind,
  type TravelContextSearchSummary,
} from "../domain/schema.ts";
import { MANHATTAN_CIVIC_APPROVAL_EVIDENCE } from "../data/source-registry.ts";
import { isSafeLocalReleaseReference } from "../runtime/path-security.ts";
import { parseTileKey, tileBounds, tileKeyForCoordinate, tileKeyString, type TileBounds } from "../runtime/spatial.ts";
import { sha256HexSync, stableSerialize } from "./catalog-release.ts";

export const TRAVEL_CONTEXT_RELEASE_SCHEMA_VERSION = TRAVEL_CONTEXT_SCHEMA_VERSION;
export const TRAVEL_CONTEXT_RELEASE_ID = "manhattan-civic-context-20260804" as const;
export const TRAVEL_CONTEXT_TILE_LEVEL = 14 as const;

export const TRAVEL_CONTEXT_BUDGETS = {
  rootBytes: 256 * 1024,
  geometryShardBytes: 2 * 1024 * 1024,
  searchDetailShardBytes: 1024 * 1024,
  exactDetailIndexBytes: 4 * 1024 * 1024,
  incrementalBytes: 40 * 1024 * 1024,
  combinedBytes: 340 * 1024 * 1024,
  maxShards: 640,
  maxLoadedShards: 24,
  maxLoadedBytes: 48 * 1024 * 1024,
  maxConcurrentRequests: 4,
  maxAreaRenderParts: 128,
  initialIncrementalBytes: 3 * 1024 * 1024,
  initialIncrementalRequests: 6,
} as const;

export const CIVIC_CONTEXT_LAYER_IDS: readonly TravelContextLayerId[] = ["statistical-areas", "parks", "landmarks"];

export interface TravelContextApprovalEvidence extends SourceApprovalEvidence {
  canonicalScopeJson: string;
}

export interface TravelContextSourceSnapshot {
  registryEntryId: string;
  provider: string;
  datasetId: string;
  mappedViewId?: string | null;
  sourceUrl: string;
  exactQuery: string;
  termsUrl: string;
  attribution: string;
  captureTimestamp: string;
  sourceUpdatedAt: string | null;
  sourceRelease: string | null;
  inputCrs: string;
  outputCrs: "EPSG:4326";
  rawRelativeRef: string;
  metadataRelativeRef: string;
  requestHeadersRelativeRef: string;
  rawByteSize: number;
  rawChecksumSha256: string;
  metadataByteSize: number;
  metadataChecksumSha256: string;
  sourceRecordCount: number;
  acceptedCount: number;
  rejectedCount: number;
  accountingRemainderCount: number;
  identityCollisionCount: number;
  updateTokenBefore: string | null;
  updateTokenAfter: string | null;
}

export interface TravelContextGeometryShardManifest {
  shardId: string;
  layerId: TravelContextLayerId;
  tileKey: string;
  bounds: TileBounds;
  parentIds: string[];
  renderPartCount: number;
  byteSize: number;
  checksumSha256: string;
  relativeContentRef: string;
  sourceRegistryEntryIds: string[];
}

export interface TravelContextSearchShardManifest {
  shardId: string;
  prefix: string;
  summaryCount: number;
  byteSize: number;
  checksumSha256: string;
  relativeContentRef: string;
  parentIds: string[];
}

export interface TravelContextDetailShardManifest {
  shardId: string;
  parentIds: string[];
  byteSize: number;
  checksumSha256: string;
  relativeContentRef: string;
}

export interface TravelContextDetailIndexEntry {
  canonicalId: string;
  layerId: TravelContextLayerId;
  detailShardRef: string;
  geometryShardRefs: string[];
}

export interface TravelContextCoverageEvidence {
  cityId: "manhattan";
  claim: "snapshot-relative-all-records-accounted";
  boundaryEvidence: string;
  sourceAccounting: Record<string, {
    sourceRecordCount: number;
    acceptedCount: number;
    rejectedCount: number;
    accountingRemainderCount: number;
    identityCollisionCount: number;
  }>;
  missingLocationCount: Record<string, number>;
  replayStable: boolean;
  overlapCandidateCount: number;
}

export interface TravelContextReleaseManifest {
  schemaVersion: typeof TRAVEL_CONTEXT_RELEASE_SCHEMA_VERSION;
  releaseId: string;
  baseReleaseId: string;
  cityId: "manhattan";
  scope: "citywide-context";
  outputCrs: "EPSG:4326";
  generatedAt: string;
  fixtureOnly: boolean;
  approval: TravelContextApprovalEvidence;
  sourceSnapshots: TravelContextSourceSnapshot[];
  coverage: TravelContextCoverageEvidence;
  layers: TravelContextLayerDescriptor[];
  geometryShards: TravelContextGeometryShardManifest[];
  searchShards: TravelContextSearchShardManifest[];
  detailShards: TravelContextDetailShardManifest[];
  detailIndex: { relativeContentRef: string; byteSize: number; checksumSha256: string; entryCount: number };
  totalDeclaredBytes: number;
  publishedFiles: Record<string, string>;
  fallback: { mode: "previous-release"; reason: string };
}

export interface TravelContextReleaseContents {
  manifest: TravelContextReleaseManifest;
  geometry: Map<string, TravelContextRecord[]>;
  search: Map<string, TravelContextSearchSummary[]>;
  details: Map<string, TravelContextRecord[]>;
  detailIndex: TravelContextDetailIndexEntry[];
  bytes: Map<string, string>;
}

export interface TravelContextManifestIssue { path: string; message: string; }
export type TravelContextManifestValidation =
  | { ok: true; value: TravelContextReleaseManifest }
  | { ok: false; issues: TravelContextManifestIssue[] };

function issue(path: string, message: string): TravelContextManifestIssue { return { path, message }; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function timestamp(value: unknown): value is string { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }
function checksum(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/iu.test(value); }
function nonNegativeInteger(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function safeId(value: unknown): value is string { return typeof value === "string" && value.length > 0 && !/[\\/]/u.test(value); }

function validateShardRefs(value: unknown, path: string, issues: TravelContextManifestIssue[], seen: Set<string>): void {
  if (!Array.isArray(value)) { issues.push(issue(path, "Shard manifests are required.")); return; }
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!record(item)) { issues.push(issue(itemPath, "Shard manifest must be an object.")); return; }
    if (!safeId(item.shardId)) issues.push(issue(`${itemPath}.shardId`, "Shard ID must be safe."));
    if (!nonNegativeInteger(item.byteSize)) issues.push(issue(`${itemPath}.byteSize`, "Shard byte size must be non-negative."));
    const max = path === "geometryShards" ? TRAVEL_CONTEXT_BUDGETS.geometryShardBytes : TRAVEL_CONTEXT_BUDGETS.searchDetailShardBytes;
    if (typeof item.byteSize === "number" && item.byteSize > max) issues.push(issue(`${itemPath}.byteSize`, `Shard exceeds ${max}-byte budget.`));
    if (!checksum(item.checksumSha256)) issues.push(issue(`${itemPath}.checksumSha256`, "SHA-256 checksum is required."));
    if (!isSafeLocalReleaseReference(item.relativeContentRef)) issues.push(issue(`${itemPath}.relativeContentRef`, "Content ref must be a safe local path."));
    if (typeof item.relativeContentRef === "string" && seen.has(item.relativeContentRef)) issues.push(issue(`${itemPath}.relativeContentRef`, "Content refs must be unique."));
    if (typeof item.relativeContentRef === "string") seen.add(item.relativeContentRef);
    if (!Array.isArray(item.parentIds) || !item.parentIds.every((id) => typeof id === "string")) issues.push(issue(`${itemPath}.parentIds`, "Parent IDs are required."));
  });
}

export function validateTravelContextReleaseManifest(value: unknown): TravelContextManifestValidation {
  const issues: TravelContextManifestIssue[] = [];
  if (!record(value)) return { ok: false, issues: [issue("$", "Travel-context manifest must be an object.")] };
  if (value.schemaVersion !== TRAVEL_CONTEXT_RELEASE_SCHEMA_VERSION) issues.push(issue("schemaVersion", "Unsupported travel-context schema."));
  if (!safeId(value.releaseId) || value.releaseId !== TRAVEL_CONTEXT_RELEASE_ID && !String(value.releaseId).startsWith("fixture-")) issues.push(issue("releaseId", "Release ID is invalid."));
  if (!safeId(value.baseReleaseId) || value.cityId !== "manhattan" || value.scope !== "citywide-context" || value.outputCrs !== "EPSG:4326") issues.push(issue("scope", "Travel-context release must be Manhattan WGS84."));
  if (!timestamp(value.generatedAt) || typeof value.fixtureOnly !== "boolean") issues.push(issue("generatedAt", "Generated timestamp and fixture flag are required."));
  const approval = value.approval;
  if (!record(approval) || typeof approval.evidenceId !== "string" || !checksum(approval.fingerprintSha256) || typeof approval.canonicalScopeJson !== "string" || typeof approval.scope !== "string" || !Array.isArray(approval.exclusions)) issues.push(issue("approval", "Durable approval evidence is required."));
  const sources = value.sourceSnapshots;
  if (!Array.isArray(sources) || sources.length === 0) issues.push(issue("sourceSnapshots", "Source snapshots are required."));
  else sources.forEach((source, index) => {
    if (!record(source) || typeof source.registryEntryId !== "string" || typeof source.provider !== "string" || typeof source.datasetId !== "string" || !timestamp(source.captureTimestamp) || !isSafeLocalReleaseReference(source.rawRelativeRef) || !isSafeLocalReleaseReference(source.metadataRelativeRef) || !isSafeLocalReleaseReference(source.requestHeadersRelativeRef) || !checksum(source.rawChecksumSha256) || !checksum(source.metadataChecksumSha256) || !nonNegativeInteger(source.rawByteSize) || !nonNegativeInteger(source.metadataByteSize) || !nonNegativeInteger(source.sourceRecordCount) || !nonNegativeInteger(source.acceptedCount) || !nonNegativeInteger(source.rejectedCount) || !nonNegativeInteger(source.accountingRemainderCount) || source.accountingRemainderCount !== 0 || !nonNegativeInteger(source.identityCollisionCount) || source.identityCollisionCount !== 0 || typeof source.exactQuery !== "string" || typeof source.termsUrl !== "string" || typeof source.attribution !== "string" || typeof source.inputCrs !== "string") issues.push(issue(`sourceSnapshots[${index}]`, "Source snapshot evidence is incomplete or nonzero."));
  });
  const coverage = value.coverage;
  if (!record(coverage) || coverage.cityId !== "manhattan" || coverage.claim !== "snapshot-relative-all-records-accounted" || typeof coverage.boundaryEvidence !== "string" || coverage.replayStable !== true || !record(coverage.sourceAccounting) || !record(coverage.missingLocationCount)) issues.push(issue("coverage", "Coverage/accounting evidence is incomplete."));
  const layers = value.layers;
  if (!Array.isArray(layers) || layers.length < 3) issues.push(issue("layers", "At least the three civic layers are required."));
  else {
    const ids = layers.map((layer) => record(layer) ? layer.id : null);
    CIVIC_CONTEXT_LAYER_IDS.forEach((id) => { if (!ids.includes(id)) issues.push(issue("layers", `Missing civic layer ${id}.`)); });
  }
  const seen = new Set<string>();
  validateShardRefs(value.geometryShards, "geometryShards", issues, seen);
  validateShardRefs(value.searchShards, "searchShards", issues, seen);
  validateShardRefs(value.detailShards, "detailShards", issues, seen);
  const detailIndex = value.detailIndex;
  if (!record(detailIndex) || !isSafeLocalReleaseReference(detailIndex.relativeContentRef) || !nonNegativeInteger(detailIndex.byteSize) || !checksum(detailIndex.checksumSha256) || !nonNegativeInteger(detailIndex.entryCount) || seen.has(String(detailIndex.relativeContentRef))) issues.push(issue("detailIndex", "Detail index is invalid or duplicated."));
  if (record(detailIndex) && typeof detailIndex.relativeContentRef === "string") seen.add(detailIndex.relativeContentRef);
  const shardCount = [value.geometryShards, value.searchShards, value.detailShards].reduce<number>((sum: number, shards: unknown) => sum + (Array.isArray(shards) ? shards.length : 0), 0);
  if (shardCount > TRAVEL_CONTEXT_BUDGETS.maxShards) issues.push(issue("shards", "Travel-context release exceeds shard budget."));
  if (!nonNegativeInteger(value.totalDeclaredBytes) || (typeof value.totalDeclaredBytes === "number" && value.totalDeclaredBytes > TRAVEL_CONTEXT_BUDGETS.incrementalBytes)) issues.push(issue("totalDeclaredBytes", "Travel-context release exceeds incremental budget."));
  if (!record(value.publishedFiles) || Object.values(value.publishedFiles).some((item) => !checksum(item))) issues.push(issue("publishedFiles", "Published file checksums are invalid."));
  if (!record(value.fallback) || value.fallback.mode !== "previous-release" || typeof value.fallback.reason !== "string") issues.push(issue("fallback", "Explicit previous-release fallback is required."));
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: value as unknown as TravelContextReleaseManifest };
}

export function stableTravelContextSerialize(value: unknown): string { return stableSerialize(value); }
export function travelContextChecksum(value: string): string { return sha256HexSync(value); }

export function normalizeTravelContextQuery(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/gu, " ");
}

export function travelContextQueryTokens(value: string): string[] {
  return [...new Set(normalizeTravelContextQuery(value).split(" ").filter((token) => token.length >= 2))].sort();
}

export function travelContextPrefix(value: string): string {
  const normalized = normalizeTravelContextQuery(value);
  return normalized.length < 2 ? normalized : normalized.slice(0, 2);
}

export function isTravelContextExactIdentifier(value: string): boolean {
  const normalized = value.trim();
  return /^(?:nta20(?:20)?[-:]?[a-z0-9-]+|(?:mn|m)\d+|gispropnum\s*[-:]?\s*[a-z0-9-]+|lp[-_ ]?\d+)$/iu.test(normalized) || /^udt:manhattan:(?:nta|park|lpc):[^\s]+$/iu.test(normalized);
}

export function selectTravelContextSearchPrefixes(shards: readonly Pick<TravelContextSearchShardManifest, "prefix" | "summaryCount" | "byteSize">[], query: string): string[] {
  const normalized = normalizeTravelContextQuery(query);
  if (!normalized) return [];
  if (isTravelContextExactIdentifier(query)) return [travelContextPrefix(query)];
  const tokens = travelContextQueryTokens(normalized);
  const available = new Map(shards.map((shard) => [shard.prefix, shard]));
  const candidates = tokens.map((token) => available.get(travelContextPrefix(token))).filter((item): item is TravelContextSearchShardManifest => Boolean(item));
  if (candidates.length !== tokens.length || candidates.length === 0) return [];
  return [candidates.sort((a, b) => a.summaryCount - b.summaryCount || a.byteSize - b.byteSize || a.prefix.localeCompare(b.prefix))[0]!.prefix];
}

export function stableTravelContextOverlapCandidates(candidates: readonly TravelContextOverlapCandidate[]): TravelContextOverlapCandidate[] {
  return [...candidates].sort((a, b) => a.priority - b.priority || travelContextPickPriority(a.kind) - travelContextPickPriority(b.kind) || a.label.localeCompare(b.label) || a.canonicalId.localeCompare(b.canonicalId));
}

export function buildTravelContextRecord(input: Omit<TravelContextRecord, "schemaVersion">): TravelContextRecord {
  if (!input.identity.canonicalId || !input.identity.groupingKey || input.identity.reversible !== true) throw new Error("Travel-context records require stable reversible identity.");
  if (input.cityId.length === 0 || input.layerId.length === 0 || input.kind.length === 0 || input.uncertainty.length === 0) throw new Error("Travel-context record semantics are incomplete.");
  return { schemaVersion: TRAVEL_CONTEXT_SCHEMA_VERSION, ...input };
}

function sourceRef(registryEntryId: string, sourceRecordId: string, capturedAt: string): SourceRef {
  return { schemaVersion: "1.0", id: `source-ref:${registryEntryId}:${sourceRecordId}`, registryEntryId, provider: "Synthetic civic-context fixture", datasetId: registryEntryId, sourceRecordId, sourceUrl: "https://example.invalid/fixture", licenseRefId: `license:${registryEntryId}`, role: "fixture", capturedAt, updatedAt: null, observedAt: capturedAt, release: "fixture-civic-context" };
}

function syntheticGeometry(longitude: number, latitude: number): Geometry {
  return { type: "Polygon", coordinates: [[[longitude - 0.0004, latitude - 0.0003], [longitude + 0.0004, latitude - 0.0003], [longitude + 0.0004, latitude + 0.0003], [longitude - 0.0004, latitude + 0.0003], [longitude - 0.0004, latitude - 0.0003]]] };
}

export function buildSyntheticTravelContextRelease(): TravelContextReleaseContents {
  const generatedAt = "2026-08-04T00:00:00.000Z";
  const bytes = new Map<string, string>();
  const geometry = new Map<string, TravelContextRecord[]>();
  const search = new Map<string, TravelContextSearchSummary[]>();
  const details = new Map<string, TravelContextRecord[]>();
  const detailIndex: TravelContextDetailIndexEntry[] = [];
  const samples: Array<{ layerId: TravelContextLayerId; kind: TravelContextRecordKind; id: string; name: string; lon: number; lat: number; source: string }> = [
    { layerId: "buildings", kind: "building", id: "udt:manhattan:building:fixture-001", name: "Synthetic building", lon: -73.9912, lat: 40.7431, source: "fixture.buildings" },
    { layerId: "restaurants", kind: "restaurant", id: "udt:manhattan:restaurant:fixture-001", name: "Synthetic restaurant", lon: -73.9908, lat: 40.7433, source: "fixture.restaurants" },
    { layerId: "statistical-areas", kind: "statistical-area", id: "udt:manhattan:nta:MN01", name: "Synthetic Statistical Area", lon: -73.991, lat: 40.744, source: "fixture.nta" },
    { layerId: "parks", kind: "park", id: "udt:manhattan:park:GI0001", name: "Synthetic NYC Parks-managed property", lon: -73.991, lat: 40.7442, source: "fixture.parks" },
    { layerId: "landmarks", kind: "landmark-record", id: "udt:manhattan:lpc:LP-0001", name: "Synthetic LPC landmark record", lon: -73.9909, lat: 40.7432, source: "fixture.lpc" },
  ];
  for (const sample of samples) {
    const geometryKind: TravelContextGeometryKind = sample.kind === "restaurant" || sample.kind === "landmark-record" ? "point" : "area";
    const detailRef = `details/${sample.id.replaceAll(":", "_")}.json`;
    const tileKey = tileKeyString(tileKeyForCoordinate(sample.lon, sample.lat, TRAVEL_CONTEXT_TILE_LEVEL));
    const source = sourceRef(sample.source, sample.id, generatedAt);
    const recordValue = buildTravelContextRecord({ identity: { canonicalId: sample.id, sourceRecordIds: [sample.id], groupingKey: sample.id, reversible: true }, cityId: "manhattan", layerId: sample.layerId, kind: sample.kind, geometryKind, name: sample.name, geometry: geometryKind === "point" ? { type: "Point", coordinates: [sample.lon, sample.lat] } : syntheticGeometry(sample.lon, sample.lat), coordinates: [sample.lon, sample.lat], sourceRefs: [source], freshness: { capturedAt: generatedAt, updatedAt: null, observedAt: generatedAt, ingestedAt: generatedAt }, uncertainty: "Synthetic fixture only; no real Manhattan fact asserted.", attributes: { sourceId: sample.id } });
    const geometryRef = `geometry/${sample.layerId}/${tileKey}/0.json`;
    geometry.set(geometryRef, [...(geometry.get(geometryRef) ?? []), recordValue]);
    const summary: TravelContextSearchSummary = { canonicalId: sample.id, layerId: sample.layerId, kind: sample.kind, name: sample.name, searchableText: [sample.name, sample.id], sourceIdentifiers: [sample.id], coordinates: [sample.lon, sample.lat], geometryShardRefs: [geometryRef], detailShardRef: detailRef };
    const prefix = `search/${travelContextPrefix(sample.name)}.json`;
    search.set(prefix, [...(search.get(prefix) ?? []), summary]);
    details.set(detailRef, [recordValue]);
    detailIndex.push({ canonicalId: sample.id, layerId: sample.layerId, detailShardRef: detailRef, geometryShardRefs: [geometryRef] });
  }
  const geometryShards: TravelContextGeometryShardManifest[] = [];
  for (const [ref, records] of [...geometry.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const serialized = stableSerialize(records); bytes.set(ref, serialized);
    const [, layerId, ...tileParts] = ref.split("/"); const tileKey = tileParts.slice(0, -1).join("/");
    geometryShards.push({ shardId: `geometry:${layerId}:${tileKey.replaceAll("/", ":")}:0`, layerId: layerId as TravelContextLayerId, tileKey, bounds: tileBounds(parseTileKey(tileKey)), parentIds: records.map((item) => item.identity.canonicalId).sort(), renderPartCount: records.length, byteSize: new TextEncoder().encode(serialized).byteLength, checksumSha256: sha256HexSync(serialized), relativeContentRef: ref, sourceRegistryEntryIds: [...new Set(records.flatMap((item) => item.sourceRefs.map((source) => source.registryEntryId)))].sort() });
  }
  const searchShards: TravelContextSearchShardManifest[] = [];
  for (const [ref, summaries] of [...search.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const serialized = stableSerialize(summaries); bytes.set(ref, serialized); const prefix = ref.match(/\/([^/]+)\.json$/u)?.[1] ?? "";
    searchShards.push({ shardId: `search:${prefix}`, prefix, summaryCount: summaries.length, byteSize: new TextEncoder().encode(serialized).byteLength, checksumSha256: sha256HexSync(serialized), relativeContentRef: ref, parentIds: summaries.map((item) => item.canonicalId).sort() });
  }
  const detailShards: TravelContextDetailShardManifest[] = [];
  for (const [ref, records] of [...details.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const serialized = stableSerialize(records); bytes.set(ref, serialized);
    detailShards.push({ shardId: `detail:${records[0]?.identity.canonicalId ?? ref}`, parentIds: records.map((item) => item.identity.canonicalId), byteSize: new TextEncoder().encode(serialized).byteLength, checksumSha256: sha256HexSync(serialized), relativeContentRef: ref });
  }
  const detailIndexRef = "details/index.json"; const detailIndexText = stableSerialize(detailIndex.sort((a, b) => a.canonicalId.localeCompare(b.canonicalId))); bytes.set(detailIndexRef, detailIndexText);
  const layers = (["buildings", "restaurants", "statistical-areas", "parks", "landmarks"] as TravelContextLayerId[]).map((layerId) => {
    const items = samples.filter((sample) => sample.layerId === layerId);
    const kind = items[0]?.kind ?? "building";
    return { schemaVersion: TRAVEL_CONTEXT_SCHEMA_VERSION, id: layerId, label: layerId === "statistical-areas" ? "Statistical areas" : layerId === "parks" ? "Parks" : layerId === "landmarks" ? "Landmark records" : layerId === "restaurants" ? "Restaurants" : "Buildings", recordKind: kind, geometryKind: kind === "restaurant" || kind === "landmark-record" ? "point" : "area", sourceRegistryEntryIds: items.map((item) => item.source), parentCount: items.length, renderPartCount: items.length, shardCount: geometryShards.filter((shard) => shard.layerId === layerId).length, failurePolicy: "isolated-layer" } satisfies TravelContextLayerDescriptor;
  });
  const sourceAccounting = Object.fromEntries(samples.map((sample) => [sample.source, { sourceRecordCount: 1, acceptedCount: 1, rejectedCount: 0, accountingRemainderCount: 0, identityCollisionCount: 0 }]));
  const manifest: TravelContextReleaseManifest = { schemaVersion: TRAVEL_CONTEXT_RELEASE_SCHEMA_VERSION, releaseId: "fixture-civic-context", baseReleaseId: "fixture-citywide-scale", cityId: "manhattan", scope: "citywide-context", outputCrs: "EPSG:4326", generatedAt, fixtureOnly: true, approval: { ...MANHATTAN_CIVIC_APPROVAL_EVIDENCE }, sourceSnapshots: samples.map((sample) => ({ registryEntryId: sample.source, provider: "Synthetic civic-context fixture", datasetId: sample.source, sourceUrl: "https://example.invalid/fixture", exactQuery: "fixture-only", termsUrl: "https://example.invalid/terms", attribution: "Synthetic fixture only.", captureTimestamp: generatedAt, sourceUpdatedAt: null, sourceRelease: null, inputCrs: "EPSG:4326", outputCrs: "EPSG:4326", rawRelativeRef: `raw/${sample.source}.json`, metadataRelativeRef: `metadata/${sample.source}.json`, requestHeadersRelativeRef: `metadata/${sample.source}.headers.json`, rawByteSize: 0, rawChecksumSha256: sha256HexSync(""), metadataByteSize: 0, metadataChecksumSha256: sha256HexSync(""), sourceRecordCount: 1, acceptedCount: 1, rejectedCount: 0, accountingRemainderCount: 0, identityCollisionCount: 0, updateTokenBefore: null, updateTokenAfter: null })), coverage: { cityId: "manhattan", claim: "snapshot-relative-all-records-accounted", boundaryEvidence: "Synthetic fixture anchors only; no coverage claim.", sourceAccounting, missingLocationCount: {}, replayStable: true, overlapCandidateCount: 5 }, layers, geometryShards, searchShards, detailShards, detailIndex: { relativeContentRef: detailIndexRef, byteSize: new TextEncoder().encode(detailIndexText).byteLength, checksumSha256: sha256HexSync(detailIndexText), entryCount: detailIndex.length }, totalDeclaredBytes: [...bytes.values()].reduce((sum, value) => sum + new TextEncoder().encode(value).byteLength, 0), publishedFiles: {}, fallback: { mode: "previous-release", reason: "Synthetic fixture falls back to its previous fixture release." } };
  return { manifest, geometry, search, details, detailIndex, bytes };
}
