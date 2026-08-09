/**
 * Deterministic assembly contracts for approved local adapter artifacts.
 * This module is deliberately provider- and filesystem-neutral; the CLI is
 * the only layer that reads paths or publishes a release directory.
 */
import type { CanonicalEntity } from "../domain/reconciliation.ts";
import { normalizeText } from "../domain/reconciliation.ts";
import type { Feature, LicenseRef, SourceRef } from "../domain/schema.ts";
import { getSourceRegistryEntry } from "../data/source-registry.ts";
import { layerForFeature, type RuntimeLayerId } from "../runtime/layers.ts";
import { SUPPORTED_TILE_LODS, tileManifestContentId, type CityTilePackage, type SupportedTileLod } from "../runtime/tile-package.ts";
import { parseTileKey, tileBounds, tileKeyForFeature, tileKeyString } from "../runtime/spatial.ts";
import { isSafeLocalReleaseReference } from "../runtime/path-security.ts";
import { sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";
export { sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";

export const CATALOG_RELEASE_SCHEMA_VERSION = "1.0" as const;
export const CATALOG_TOOL_VERSION = "catalog-assembler-1.0" as const;
export type CatalogArtifactKind = "buildings" | "pois" | "areas" | "transit" | "routes" | "reconciliation";
export type DiffStatus = "added" | "modified" | "removed" | "tombstoned";

export interface ReleaseScope {
  cityId: "manhattan";
  label: string;
  boundaryId: string;
  coverageClaim: "citywide" | "vertical-slice";
}

export interface FreshnessRange {
  earliest: string | null;
  latest: string | null;
  observationCount: number;
}

export interface ArtifactStatus {
  artifactId: string;
  kind: CatalogArtifactKind;
  checksumSha256: string;
  sourceRegistryEntryIds: string[];
  acceptedCount: number;
  rejectedCount: number;
  conflictCount: number;
  freshness: FreshnessRange;
  status: "ready" | "replayed";
}

export interface CatalogRelationship {
  relationshipId: string;
  fromCanonicalId: string;
  toCanonicalId: string;
  relationship: "located-on" | "contains" | "overlaps" | "same-as" | "enriched-by" | "serves" | "near";
  sourceRefIds: string[];
  confidence: number;
  observedAt: string | null;
}

export interface Tombstone {
  tombstoneId: string;
  canonicalId: string;
  sourceRefIds: string[];
  reason: "source-removed" | "merged" | "invalid" | "superseded";
  effectiveAt: string;
  replacementCanonicalId: string | null;
  authoritativeRuleId: string;
}

export interface SourceArtifact {
  schemaVersion: typeof CATALOG_RELEASE_SCHEMA_VERSION;
  artifactId: string;
  kind: CatalogArtifactKind;
  cityId: "manhattan";
  scope: ReleaseScope;
  inputPath: string;
  checksumSha256: string;
  sourceRegistryEntryIds: string[];
  sourceLicenses: LicenseRef[];
  outputCrs: "EPSG:4326";
  verticalDatum: string;
  generatedAt: string;
  freshness: FreshnessRange;
  fixtureOnly: boolean;
  acceptedCount: number;
  rejectedCount: number;
  conflictCount: number;
  features: Feature[];
  entities: CanonicalEntity[];
  relationships: CatalogRelationship[];
  tombstones: Tombstone[];
  explicitRemovals: string[];
  nonAuthoritativeOmission: boolean;
}

export interface LayerPartition {
  partitionId: string;
  layer: RuntimeLayerId;
  tileKey: string;
  bounds: ReturnType<typeof tileBounds>;
  lods: SupportedTileLod[];
  geometricErrorMeters: number;
  canonicalIds: string[];
  sourceRecordIds: string[];
  sourceRegistryEntryIds: string[];
  featureCount: number;
  byteSize: number;
  checksumSha256: string;
  relativeContentRef: string;
}

export interface SearchIndex {
  schemaVersion: typeof CATALOG_RELEASE_SCHEMA_VERSION;
  tokenCount: number;
  byToken: Record<string, string[]>;
  byCanonicalId: Record<string, string>;
  bySourceIdentifier: Record<string, string[]>;
}

export interface RelationshipIndex {
  schemaVersion: typeof CATALOG_RELEASE_SCHEMA_VERSION;
  byCanonicalId: Record<string, CatalogRelationship[]>;
  relationshipCount: number;
}

export interface CatalogEntitySnapshot {
  canonicalId: string;
  kind: string;
  name: string | null;
  featureId: string | null;
  fields: Record<string, unknown>;
  sourceIdentifierKeys: string[];
  sourceRefIds: string[];
  freshness: FreshnessRange;
  tileKeys: string[];
  fieldProvenanceFingerprint: string;
}

export interface ReleaseFieldChange {
  field: string;
  previous: string | null;
  current: string | null;
  provenanceChanged: boolean;
  freshnessChanged: boolean;
}

export interface ReleaseDiffEntry {
  canonicalId: string;
  status: DiffStatus;
  fieldChanges: ReleaseFieldChange[];
  affectedTileKeys: string[];
  explicit: boolean;
}

export interface ReleaseDiff {
  schemaVersion: typeof CATALOG_RELEASE_SCHEMA_VERSION;
  fromReleaseId: string | null;
  toReleaseId: string;
  entries: ReleaseDiffEntry[];
  addedCount: number;
  modifiedCount: number;
  removedCount: number;
  tombstonedCount: number;
  affectedTileKeys: string[];
  boundedInvalidation: { maxTiles: number; withinBudget: boolean };
}

export interface BuildJournal {
  schemaVersion: typeof CATALOG_RELEASE_SCHEMA_VERSION;
  journalId: string;
  fingerprint: string;
  artifactChecksums: string[];
  status: "staged" | "published" | "replayed" | "failed";
  startedAt: string;
  finishedAt: string | null;
  immutable: true;
  publishedFiles: Record<string, string>;
}

export interface CatalogRelease {
  schemaVersion: typeof CATALOG_RELEASE_SCHEMA_VERSION;
  releaseId: string;
  releaseVersion: string;
  cityId: "manhattan";
  scope: ReleaseScope;
  schemaVersions: Record<string, string>;
  toolVersion: typeof CATALOG_TOOL_VERSION;
  inputArtifacts: ArtifactStatus[];
  sourceRegistryEntryIds: string[];
  sourceLicenses: LicenseRef[];
  freshness: FreshnessRange;
  outputCrs: "EPSG:4326";
  verticalDatum: string;
  generatedAt: string;
  fixtureOnly: boolean;
  recordCounts: { artifacts: number; accepted: number; rejected: number; conflicts: number; entities: number; relationships: number; tombstones: number };
  tileCoverage: { partitionCount: number; tileKeys: string[]; lods: SupportedTileLod[]; byteSize: number };
  layerCounts: Record<RuntimeLayerId, number>;
  partitions: LayerPartition[];
  searchIndex: SearchIndex;
  relationshipIndex: RelationshipIndex;
  entitySnapshots: CatalogEntitySnapshot[];
  tombstones: Tombstone[];
  releaseDiff: ReleaseDiff | null;
  buildJournal: BuildJournal;
  lineage: { artifactIds: string[]; sourceRefIds: string[]; sourceIdentifierCount: number };
  publishedFiles: Record<string, string>;
}

export interface CatalogBuildOptions {
  releaseVersion: string;
  generatedAt: string;
  scope?: ReleaseScope;
  fixtureOnly?: boolean;
  previousRelease?: CatalogRelease | null;
  maxInvalidatedTiles?: number;
}

export interface CatalogBuildIssue { path: string; message: string; }
export type CatalogBuildValidation = { ok: true } | { ok: false; issues: CatalogBuildIssue[] };

const DEFAULT_SCOPE: ReleaseScope = { cityId: "manhattan", label: "Manhattan vertical-slice assembly", boundaryId: "manhattan-city-boundary-v1", coverageClaim: "vertical-slice" };
const LAYERS: RuntimeLayerId[] = ["buildings", "pois", "areas", "stations", "entrances", "routes"];

export function deterministicFingerprint(value: unknown): string {
  const text = stableSerialize(value);
  let hashA = 2_166_136_261;
  let hashB = 2_169_136_261;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    hashA = Math.imul(hashA ^ code, 16_777_619);
    hashB = Math.imul(hashB ^ (code + index), 16_777_619);
  }
  const first = (hashA >>> 0).toString(16).padStart(8, "0");
  const second = (hashB >>> 0).toString(16).padStart(8, "0");
  return `${first}${second}${first}${second}${first}${second}${first}${second}`;
}

function issue(path: string, message: string): CatalogBuildIssue { return { path, message }; }
function timestamp(value: unknown): value is string { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }
function safePath(value: unknown): value is string { return typeof value === "string" && value.length > 0 && !value.includes("\0") && !value.includes("://") && !value.startsWith("/") && !value.includes("\\") && !value.split("/").includes(".."); }

function allArtifactSourceRefs(artifact: SourceArtifact): SourceRef[] {
  return artifact.features.flatMap((feature) => feature.sourceRefs);
}

export function validateSourceArtifact(value: unknown, index = 0): CatalogBuildValidation {
  const issues: CatalogBuildIssue[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, issues: [issue(`artifacts[${index}]`, "Expected a SourceArtifact object.")] };
  const artifact = value as Record<string, unknown>;
  const path = `artifacts[${index}]`;
  if (artifact.schemaVersion !== CATALOG_RELEASE_SCHEMA_VERSION) issues.push(issue(`${path}.schemaVersion`, "Unsupported artifact schema version."));
  for (const field of ["artifactId", "inputPath", "checksumSha256", "verticalDatum"] as const) if (typeof artifact[field] !== "string" || !(artifact[field] as string).trim()) issues.push(issue(`${path}.${field}`, "Required artifact metadata is missing."));
  if (!safePath(artifact.inputPath)) issues.push(issue(`${path}.inputPath`, "Artifact input path must be local, relative and traversal-free."));
  if (typeof artifact.checksumSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(artifact.checksumSha256)) issues.push(issue(`${path}.checksumSha256`, "A SHA-256 artifact checksum is required."));
  if (artifact.kind === undefined || !["buildings", "pois", "areas", "transit", "routes", "reconciliation"].includes(String(artifact.kind))) issues.push(issue(`${path}.kind`, "Unsupported artifact kind."));
  if (artifact.cityId !== "manhattan") issues.push(issue(`${path}.cityId`, "Only the Manhattan adapter scope is supported by this release."));
  if (!artifact.scope || typeof artifact.scope !== "object" || (artifact.scope as Record<string, unknown>).cityId !== "manhattan") issues.push(issue(`${path}.scope`, "Artifact scope must be Manhattan."));
  if (artifact.outputCrs !== "EPSG:4326") issues.push(issue(`${path}.outputCrs`, "Artifacts must be normalized to WGS84."));
  if (!timestamp(artifact.generatedAt)) issues.push(issue(`${path}.generatedAt`, "Artifact generatedAt must be an ISO timestamp."));
  if (typeof artifact.fixtureOnly !== "boolean") issues.push(issue(`${path}.fixtureOnly`, "Fixture/production claim is required."));
  if (!Array.isArray(artifact.sourceRegistryEntryIds) || artifact.sourceRegistryEntryIds.length === 0) issues.push(issue(`${path}.sourceRegistryEntryIds`, "Artifact source registry provenance is required."));
  if (!Array.isArray(artifact.sourceLicenses) || artifact.sourceLicenses.length === 0) issues.push(issue(`${path}.sourceLicenses`, "Artifact source license metadata is required."));
  if (!Array.isArray(artifact.features)) issues.push(issue(`${path}.features`, "Artifact features must be an array."));
  if (!Array.isArray(artifact.entities)) issues.push(issue(`${path}.entities`, "Artifact entities must be an array."));
  if (!Array.isArray(artifact.relationships)) issues.push(issue(`${path}.relationships`, "Artifact relationships must be an array."));
  if (!Array.isArray(artifact.tombstones)) issues.push(issue(`${path}.tombstones`, "Artifact tombstones must be an array."));
  for (const sourceId of Array.isArray(artifact.sourceRegistryEntryIds) ? artifact.sourceRegistryEntryIds : []) {
    const entry = getSourceRegistryEntry(String(sourceId));
    if (!entry) issues.push(issue(`${path}.sourceRegistryEntryIds`, `Unknown source registry entry: ${String(sourceId)}.`));
    else if (entry.approval.state !== "approved") issues.push(issue(`${path}.sourceRegistryEntryIds`, `Pending source cannot be assembled: ${String(sourceId)}.`));
  }
  if (Array.isArray(artifact.sourceLicenses)) artifact.sourceLicenses.forEach((license, licenseIndex) => {
    const item = license as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.termsUrl !== "string" || typeof item.attribution !== "string") issues.push(issue(`${path}.sourceLicenses[${licenseIndex}]`, "License ID, terms URL and attribution are required."));
  });
  if (Array.isArray(artifact.features)) artifact.features.forEach((feature, featureIndex) => {
    const item = feature as Record<string, unknown>;
    if (typeof item.id !== "string" || !item.id) issues.push(issue(`${path}.features[${featureIndex}].id`, "Feature canonical ID is required."));
    const sourceRefs = Array.isArray(item.sourceRefs) ? item.sourceRefs : [];
    if (sourceRefs.length === 0) issues.push(issue(`${path}.features[${featureIndex}].sourceRefs`, "Feature source provenance is required."));
    const declaredSourceIds = Array.isArray(artifact.sourceRegistryEntryIds) ? artifact.sourceRegistryEntryIds.map(String) : [];
    sourceRefs.forEach((source) => { if (!declaredSourceIds.includes((source as SourceRef).registryEntryId)) issues.push(issue(`${path}.features[${featureIndex}].sourceRefs`, "Feature source registry ID is not declared by its artifact.")); });
  });
  if (Array.isArray(artifact.freshness)) issues.push(issue(`${path}.freshness`, "Freshness must be a range object."));
  return issues.length > 0 ? { ok: false, issues } : { ok: true };
}

export function validateCatalogArtifacts(artifacts: readonly SourceArtifact[], options: { fixtureOnly?: boolean; maxInvalidatedTiles?: number } = {}): CatalogBuildValidation {
  const issues: CatalogBuildIssue[] = [];
  if (artifacts.length === 0) issues.push(issue("artifacts", "At least one source artifact is required."));
  const artifactIds = new Set<string>(); const canonicalIds = new Set<string>(); const sourceIds = new Set<string>(); const relationshipIds = new Set<string>();
  const sourceRefIds = new Set<string>(); const allRelationships: { index: number; relationship: CatalogRelationship }[] = []; const allTombstones: { index: number; tombstone: Tombstone }[] = [];
  artifacts.forEach((artifact, index) => {
    const validation = validateSourceArtifact(artifact, index); if (!validation.ok) issues.push(...validation.issues);
    if (artifactIds.has(artifact.artifactId)) issues.push(issue(`artifacts[${index}].artifactId`, "Duplicate artifact ID.")); artifactIds.add(artifact.artifactId);
    if (artifact.cityId !== "manhattan" || artifact.scope.cityId !== "manhattan") issues.push(issue(`artifacts[${index}].scope`, "All artifacts must use Manhattan scope."));
    if (options.fixtureOnly === false && artifact.fixtureOnly) issues.push(issue(`artifacts[${index}].fixtureOnly`, "Fixture artifact cannot enter a production release."));
    artifact.features.forEach((feature) => {
      if (canonicalIds.has(feature.id)) issues.push(issue(`artifacts[${index}].features`, `Duplicate canonical feature identity: ${feature.id}.`)); canonicalIds.add(feature.id);
      feature.sourceRefs.forEach((source) => { const key = `${source.registryEntryId}:${source.sourceRecordId}`; if (sourceIds.has(key)) issues.push(issue(`artifacts[${index}].features`, `Duplicate source identity: ${key}.`)); sourceIds.add(key); sourceRefIds.add(source.id); });
    });
    artifact.entities.forEach((entity) => {
      if (canonicalIds.has(entity.canonicalId)) issues.push(issue(`artifacts[${index}].entities`, `Duplicate canonical entity identity: ${entity.canonicalId}.`)); canonicalIds.add(entity.canonicalId);
      entity.observationIds.forEach((observationId) => sourceIds.add(`${entity.entityKind}:${observationId}`));
      entity.fieldProvenance.forEach((field) => field.sourceRefIds.forEach((sourceRefId) => sourceRefIds.add(sourceRefId)));
    });
    artifact.relationships.forEach((relationship) => { if (relationshipIds.has(relationship.relationshipId)) issues.push(issue(`artifacts[${index}].relationships`, `Duplicate relationship ID: ${relationship.relationshipId}.`)); relationshipIds.add(relationship.relationshipId); allRelationships.push({ index, relationship }); });
    artifact.tombstones.forEach((tombstone) => allTombstones.push({ index, tombstone }));
  });
  allRelationships.forEach(({ index, relationship }) => { if (!canonicalIds.has(relationship.fromCanonicalId) || !canonicalIds.has(relationship.toCanonicalId)) issues.push(issue(`artifacts[${index}].relationships`, `Relationship references an unknown canonical ID: ${relationship.relationshipId}.`)); relationship.sourceRefIds.forEach((sourceRefId) => { if (!sourceRefIds.has(sourceRefId)) issues.push(issue(`artifacts[${index}].relationships`, `Relationship references unknown source ref: ${sourceRefId}.`)); }); });
  allTombstones.forEach(({ index, tombstone }) => { if (canonicalIds.has(tombstone.canonicalId)) issues.push(issue(`artifacts[${index}].tombstones`, `Tombstone contradicts a current canonical entity: ${tombstone.canonicalId}.`)); });
  return issues.length > 0 ? { ok: false, issues } : { ok: true };
}

function freshnessRange(values: (string | null | undefined)[]): FreshnessRange {
  const timestamps = values.filter((value): value is string => Boolean(value) && timestamp(value)).sort();
  return { earliest: timestamps[0] ?? null, latest: timestamps.at(-1) ?? null, observationCount: timestamps.length };
}

function sourceIdentifiers(source: SourceRef): string[] { return [source.id, source.registryEntryId, source.provider, source.datasetId, source.sourceRecordId]; }
function featureFieldMap(feature: Feature): Record<string, unknown> { return { name: feature.name, kind: feature.kind, geometry: feature.geometry, coordinates: feature.coordinates, attributes: feature.attributes, confidence: feature.confidence, uncertainty: feature.uncertainty }; }
function entityFieldMap(entity: CanonicalEntity): Record<string, unknown> { return { entityKind: entity.entityKind, fields: entity.fields, conflicts: entity.conflicts, confidence: entity.confidence, uncertainty: entity.uncertainty, validFrom: entity.validFrom, validTo: entity.validTo }; }
function featureTileKeys(feature: Feature): string[] { return [tileKeyString(tileKeyForFeature(feature, 12))]; }
function flattenSearchValues(value: unknown): string[] { if (typeof value === "string") return [value]; if (Array.isArray(value)) return value.flatMap(flattenSearchValues); if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(flattenSearchValues); return []; }
function tokenize(values: unknown[]): string[] { return [...new Set(flattenSearchValues(values).flatMap((value) => normalizeText(value).split(" ").filter(Boolean)))].sort(); }

function makeSnapshots(artifacts: readonly SourceArtifact[]): CatalogEntitySnapshot[] {
  const snapshots: CatalogEntitySnapshot[] = [];
  artifacts.forEach((artifact) => artifact.features.forEach((feature) => {
    const sources = feature.sourceRefs.flatMap(sourceIdentifiers);
    snapshots.push({ canonicalId: feature.id, kind: feature.kind, name: feature.name, featureId: feature.id, fields: featureFieldMap(feature), sourceIdentifierKeys: sources, sourceRefIds: feature.sourceRefs.map((source) => source.id).sort(), freshness: artifact.freshness, tileKeys: featureTileKeys(feature), fieldProvenanceFingerprint: sha256HexSync(stableSerialize({ sourceRefs: feature.sourceRefs, freshness: artifact.freshness })) });
  }));
  artifacts.forEach((artifact) => artifact.entities.forEach((entity) => {
    const observations = entity.observationIds;
    const runtimeFeatureId = entity.fields.runtimeFeatureId; const linkedFeature = typeof runtimeFeatureId === "string" ? artifacts.flatMap((item) => item.features).find((feature) => feature.id === runtimeFeatureId) : undefined;
    snapshots.push({ canonicalId: entity.canonicalId, kind: entity.entityKind, name: entity.fields.name, featureId: runtimeFeatureId, fields: entityFieldMap(entity), sourceIdentifierKeys: observations, sourceRefIds: entity.fieldProvenance.flatMap((field) => field.sourceRefIds).sort(), freshness: { earliest: entity.observedAt, latest: entity.observedAt, observationCount: entity.observedAt ? 1 : 0 }, tileKeys: linkedFeature ? featureTileKeys(linkedFeature) : [], fieldProvenanceFingerprint: sha256HexSync(stableSerialize(entity.fieldProvenance)) });
  }));
  return snapshots.sort((left, right) => left.canonicalId.localeCompare(right.canonicalId));
}

function diffSnapshots(previous: CatalogEntitySnapshot[], current: CatalogEntitySnapshot[], tombstones: Tombstone[], explicitRemovals: string[], fromReleaseId: string | null, toReleaseId: string, maxInvalidatedTiles: number): ReleaseDiff {
  const oldMap = new Map(previous.map((snapshot) => [snapshot.canonicalId, snapshot])); const newMap = new Map(current.map((snapshot) => [snapshot.canonicalId, snapshot])); const entries: ReleaseDiffEntry[] = [];
  current.forEach((snapshot) => { if (!oldMap.has(snapshot.canonicalId)) entries.push({ canonicalId: snapshot.canonicalId, status: "added", fieldChanges: [], affectedTileKeys: snapshot.tileKeys, explicit: true }); else {
    const old = oldMap.get(snapshot.canonicalId)!; const changes: (ReleaseFieldChange | null)[] = [...new Set([...Object.keys(old.fields), ...Object.keys(snapshot.fields), "sourceIdentifierKeys", "freshness", "fieldProvenanceFingerprint"])].sort().map((field) => {
      const previousValue = field === "sourceIdentifierKeys" ? old.sourceIdentifierKeys : field === "freshness" ? old.freshness : field === "fieldProvenanceFingerprint" ? old.fieldProvenanceFingerprint : old.fields[field];
      const currentValue = field === "sourceIdentifierKeys" ? snapshot.sourceIdentifierKeys : field === "freshness" ? snapshot.freshness : field === "fieldProvenanceFingerprint" ? snapshot.fieldProvenanceFingerprint : snapshot.fields[field];
      const before = stableSerialize(previousValue); const after = stableSerialize(currentValue);
      if (before === after) return null;
      return { field, previous: before, current: after, provenanceChanged: field === "sourceIdentifierKeys" || field === "fieldProvenanceFingerprint", freshnessChanged: field === "freshness" };
    });
    const fields = changes.filter((change): change is ReleaseFieldChange => change !== null);
    if (fields.length > 0) entries.push({ canonicalId: snapshot.canonicalId, status: "modified", fieldChanges: fields, affectedTileKeys: [...new Set([...old.tileKeys, ...snapshot.tileKeys])].sort(), explicit: true });
  }});
  const explicitSet = new Set(explicitRemovals); explicitSet.forEach((canonicalId) => { if (oldMap.has(canonicalId) && !newMap.has(canonicalId)) entries.push({ canonicalId, status: "removed", fieldChanges: [], affectedTileKeys: oldMap.get(canonicalId)!.tileKeys, explicit: true }); });
  tombstones.forEach((tombstone) => { const old = oldMap.get(tombstone.canonicalId); entries.push({ canonicalId: tombstone.canonicalId, status: "tombstoned", fieldChanges: [], affectedTileKeys: old?.tileKeys ?? [], explicit: true }); });
  const affectedTileKeys = [...new Set(entries.flatMap((entry) => entry.affectedTileKeys))].sort();
  return { schemaVersion: CATALOG_RELEASE_SCHEMA_VERSION, fromReleaseId, toReleaseId, entries: entries.sort((left, right) => left.canonicalId.localeCompare(right.canonicalId) || left.status.localeCompare(right.status)), addedCount: entries.filter((entry) => entry.status === "added").length, modifiedCount: entries.filter((entry) => entry.status === "modified").length, removedCount: entries.filter((entry) => entry.status === "removed").length, tombstonedCount: entries.filter((entry) => entry.status === "tombstoned").length, affectedTileKeys, boundedInvalidation: { maxTiles: maxInvalidatedTiles, withinBudget: affectedTileKeys.length <= maxInvalidatedTiles } };
}

export function buildCatalogRelease(artifacts: readonly SourceArtifact[], options: CatalogBuildOptions): CatalogRelease {
  const validation = validateCatalogArtifacts(artifacts, { fixtureOnly: options.fixtureOnly ?? artifacts.every((artifact) => artifact.fixtureOnly), maxInvalidatedTiles: options.maxInvalidatedTiles });
  if (!validation.ok) throw new Error(validation.issues.map((item) => `${item.path}: ${item.message}`).join("\n"));
  const scope = options.scope ?? DEFAULT_SCOPE; const generatedAt = options.generatedAt; if (!timestamp(generatedAt)) throw new Error("Release generatedAt must be an ISO timestamp.");
  const sortedArtifacts = [...artifacts].sort((left, right) => left.artifactId.localeCompare(right.artifactId)); const artifactChecksums = sortedArtifacts.map((artifact) => artifact.checksumSha256);
  const fingerprint = deterministicFingerprint({ releaseVersion: options.releaseVersion, scope, artifactChecksums, sourceRegistryEntryIds: sortedArtifacts.flatMap((artifact) => artifact.sourceRegistryEntryIds).sort() });
  const releaseId = `catalog:${scope.cityId}:${options.releaseVersion}:${fingerprint.slice(0, 16)}`;
  const featureById = new Map<string, Feature>(); sortedArtifacts.forEach((artifact) => artifact.features.forEach((feature) => featureById.set(feature.id, feature)));
  const partitionMap = new Map<string, { layer: RuntimeLayerId; tileKey: string; features: Feature[] }>();
  featureById.forEach((feature) => { const layer = layerForFeature(feature); if (!layer) return; const tileKey = tileKeyString(tileKeyForFeature(feature, 12)); const key = `${layer}/${tileKey}`; const existing = partitionMap.get(key) ?? { layer, tileKey, features: [] }; existing.features.push(feature); partitionMap.set(key, existing); });
  const partitions = [...partitionMap.values()].sort((left, right) => `${left.layer}/${left.tileKey}`.localeCompare(`${right.layer}/${right.tileKey}`)).map((partition) => {
    const features = partition.features.sort((left, right) => left.id.localeCompare(right.id)); const sourceRefs = features.flatMap((feature) => feature.sourceRefs); const content = features.map((feature) => ({ id: feature.id, geometry: feature.geometry, coordinates: feature.coordinates }));
    const contentText = stableSerialize({ schemaVersion: CATALOG_RELEASE_SCHEMA_VERSION, layer: partition.layer, tileKey: partition.tileKey, features: content });
    return { partitionId: `partition:${partition.layer}:${partition.tileKey}`, layer: partition.layer, tileKey: partition.tileKey, bounds: tileBounds(tileKeyForFeature(features[0]!, 12)), lods: [12], geometricErrorMeters: partition.layer === "buildings" ? 4 : 12, canonicalIds: features.map((feature) => feature.id), sourceRecordIds: [...new Set(sourceRefs.map((source) => source.sourceRecordId))].sort(), sourceRegistryEntryIds: [...new Set(sourceRefs.map((source) => source.registryEntryId))].sort(), featureCount: features.length, byteSize: new TextEncoder().encode(contentText).byteLength, checksumSha256: sha256HexSync(contentText), relativeContentRef: `layers/${partition.layer}/${partition.tileKey.replaceAll("/", "_")}.json` } satisfies LayerPartition;
  });
  const allEntities = makeSnapshots(sortedArtifacts); const tokenMap = new Map<string, Set<string>>(); const sourceMap = new Map<string, Set<string>>(); const byCanonicalId: Record<string, string> = {};
  const addSearch = (canonicalId: string, values: unknown[], exactIdentifiers: string[] = []) => { byCanonicalId[canonicalId] = canonicalId; tokenize(values).forEach((token) => { const set = tokenMap.get(token) ?? new Set<string>(); set.add(canonicalId); tokenMap.set(token, set); }); exactIdentifiers.forEach((value) => { for (const identifier of [value, normalizeText(value)]) { if (!identifier) continue; const set = sourceMap.get(identifier) ?? new Set<string>(); set.add(canonicalId); sourceMap.set(identifier, set); } }); };
  const sourceRefById = new Map(sortedArtifacts.flatMap((artifact) => artifact.features.flatMap((feature) => feature.sourceRefs)).map((source) => [source.id, source]));
  sortedArtifacts.forEach((artifact) => { artifact.features.forEach((feature) => addSearch(feature.id, [feature.name, feature.attributes, ...feature.sourceRefs.flatMap(sourceIdentifiers)], [feature.id, ...feature.sourceRefs.flatMap(sourceIdentifiers)])); artifact.entities.forEach((entity) => { const sourceRefs = entity.fieldProvenance.flatMap((field) => field.sourceRefIds).map((sourceRefId) => sourceRefById.get(sourceRefId)).filter((source): source is SourceRef => Boolean(source)); const exactIdentifiers = [entity.canonicalId, ...entity.observationIds, ...entity.fieldProvenance.flatMap((field) => field.sourceRefIds), ...sourceRefs.flatMap(sourceIdentifiers)]; addSearch(entity.canonicalId, [entity.fields.name, entity.fields.aliases, entity.fields.address, entity.fields.categories, entity.fields.rawCategories, entity.fields.brand, entity.fields.operator, entity.fields.cuisine], exactIdentifiers); }); });
  const searchIndex: SearchIndex = { schemaVersion: CATALOG_RELEASE_SCHEMA_VERSION, tokenCount: tokenMap.size, byToken: Object.fromEntries([...tokenMap.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([token, ids]) => [token, [...ids].sort()])), byCanonicalId: Object.fromEntries(Object.entries(byCanonicalId).sort(([left], [right]) => left.localeCompare(right))), bySourceIdentifier: Object.fromEntries([...sourceMap.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([identifier, ids]) => [identifier, [...ids].sort()])) };
  const relationships = sortedArtifacts.flatMap((artifact) => artifact.relationships).sort((left, right) => left.relationshipId.localeCompare(right.relationshipId)); const relationshipMap = new Map<string, CatalogRelationship[]>(); relationships.forEach((relationship) => { relationshipMap.set(relationship.fromCanonicalId, [...(relationshipMap.get(relationship.fromCanonicalId) ?? []), relationship]); relationshipMap.set(relationship.toCanonicalId, [...(relationshipMap.get(relationship.toCanonicalId) ?? []), relationship]); });
  const relationshipIndex: RelationshipIndex = { schemaVersion: CATALOG_RELEASE_SCHEMA_VERSION, byCanonicalId: Object.fromEntries([...relationshipMap.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([id, values]) => [id, values.sort((left, right) => left.relationshipId.localeCompare(right.relationshipId))])), relationshipCount: relationships.length };
  const tombstones = sortedArtifacts.flatMap((artifact) => artifact.tombstones).sort((left, right) => left.tombstoneId.localeCompare(right.tombstoneId)); const previous = options.previousRelease ?? null; const releaseDiff = diffSnapshots(previous?.entitySnapshots ?? [], allEntities, tombstones, sortedArtifacts.flatMap((artifact) => artifact.explicitRemovals), previous?.releaseId ?? null, releaseId, options.maxInvalidatedTiles ?? 2_048); if (!releaseDiff.boundedInvalidation.withinBudget) throw new Error("Release diff exceeds bounded incremental invalidation budget.");
  const allSources = sortedArtifacts.flatMap((artifact) => artifact.sourceRegistryEntryIds); const allLicenses = sortedArtifacts.flatMap((artifact) => artifact.sourceLicenses); const allFreshness = sortedArtifacts.flatMap((artifact) => [artifact.generatedAt, artifact.freshness.earliest, artifact.freshness.latest]); const layerCounts = Object.fromEntries(LAYERS.map((layer) => [layer, partitions.filter((partition) => partition.layer === layer).reduce((sum, partition) => sum + partition.featureCount, 0)])) as Record<RuntimeLayerId, number>; const finishedAt = generatedAt; const journal: BuildJournal = { schemaVersion: CATALOG_RELEASE_SCHEMA_VERSION, journalId: `journal:${releaseId}`, fingerprint, artifactChecksums, status: "staged", startedAt: generatedAt, finishedAt, immutable: true, publishedFiles: {} };
  return { schemaVersion: CATALOG_RELEASE_SCHEMA_VERSION, releaseId, releaseVersion: options.releaseVersion, cityId: "manhattan", scope, schemaVersions: Object.fromEntries(sortedArtifacts.map((artifact) => [artifact.artifactId, artifact.schemaVersion])), toolVersion: CATALOG_TOOL_VERSION, inputArtifacts: sortedArtifacts.map((artifact) => ({ artifactId: artifact.artifactId, kind: artifact.kind, checksumSha256: artifact.checksumSha256, sourceRegistryEntryIds: [...artifact.sourceRegistryEntryIds].sort(), acceptedCount: artifact.acceptedCount, rejectedCount: artifact.rejectedCount, conflictCount: artifact.conflictCount, freshness: artifact.freshness, status: "ready" })), sourceRegistryEntryIds: [...new Set(allSources)].sort(), sourceLicenses: [...new Map(allLicenses.map((license) => [license.id, license])).values()].sort((left, right) => left.id.localeCompare(right.id)), freshness: freshnessRange(allFreshness), outputCrs: "EPSG:4326", verticalDatum: [...new Set(sortedArtifacts.map((artifact) => artifact.verticalDatum))].join("; "), generatedAt, fixtureOnly: options.fixtureOnly ?? sortedArtifacts.every((artifact) => artifact.fixtureOnly), recordCounts: { artifacts: sortedArtifacts.length, accepted: sortedArtifacts.reduce((sum, artifact) => sum + artifact.acceptedCount, 0), rejected: sortedArtifacts.reduce((sum, artifact) => sum + artifact.rejectedCount, 0), conflicts: sortedArtifacts.reduce((sum, artifact) => sum + artifact.conflictCount, 0), entities: allEntities.length, relationships: relationships.length, tombstones: tombstones.length }, tileCoverage: { partitionCount: partitions.length, tileKeys: [...new Set(partitions.map((partition) => partition.tileKey))].sort(), lods: [12], byteSize: partitions.reduce((sum, partition) => sum + partition.byteSize, 0) }, layerCounts, partitions, searchIndex, relationshipIndex, entitySnapshots: allEntities, tombstones, releaseDiff, buildJournal: journal, lineage: { artifactIds: sortedArtifacts.map((artifact) => artifact.artifactId), sourceRefIds: [...new Set(sortedArtifacts.flatMap(allArtifactSourceRefs).map((source) => source.id))].sort(), sourceIdentifierCount: sourceMap.size }, publishedFiles: {} };
}

export function makeSyntheticSourceArtifact(input: Omit<SourceArtifact, "checksumSha256">): SourceArtifact {
  const checksumSha256 = sha256HexSync(stableSerialize({ ...input, checksumSha256: undefined }));
  return { ...input, checksumSha256 };
}

/** Exact bytes written for a partition; publication and validation share this function. */
export function partitionContentBytes(release: CatalogRelease, partition: LayerPartition): string {
  const snapshots = new Map(release.entitySnapshots.map((snapshot) => [snapshot.canonicalId, snapshot]));
  const features = partition.canonicalIds.map((canonicalId) => {
    const snapshot = snapshots.get(canonicalId);
    return { id: canonicalId, geometry: snapshot?.fields.geometry ?? null, coordinates: snapshot?.fields.coordinates ?? null };
  });
  return stableSerialize({ schemaVersion: CATALOG_RELEASE_SCHEMA_VERSION, layer: partition.layer, tileKey: partition.tileKey, features });
}

export function cityTilePackageForRelease(release: CatalogRelease): CityTilePackage {
  const freshness = { capturedAt: null, updatedAt: null, observedAt: release.freshness.latest, ingestedAt: release.generatedAt };
  const tiles = release.partitions.map((partition) => {
    const tileKey = parseTileKey(partition.tileKey);
    return {
      schemaVersion: "1.0" as const,
      contentId: tileManifestContentId(partition.layer, tileKey, 12),
      layer: partition.layer,
      tileKey,
      bounds: partition.bounds,
      lod: 12 as SupportedTileLod,
      geometricErrorMeters: partition.geometricErrorMeters,
      featureCount: partition.featureCount,
      byteSize: partition.byteSize,
      checksumSha256: partition.checksumSha256,
      relativeContentRef: partition.relativeContentRef,
      sourceRegistryEntryIds: partition.sourceRegistryEntryIds,
      freshness,
      fixtureOnly: release.fixtureOnly,
      children: [],
    };
  });
  return { schemaVersion: "1.0", packageId: `catalog-package:${release.releaseId}`, cityId: release.cityId, outputCrs: "EPSG:4326", generatedAt: release.generatedAt, fixtureOnly: release.fixtureOnly, rootContentIds: tiles.map((tile) => tile.contentId), tiles };
}

/** Ensures the currently claimed LOD (12) has one manifest per partition. */
export function validateCatalogTileCoverage(release: CatalogRelease, tilePackage: CityTilePackage): CatalogBuildValidation {
  const issues: CatalogBuildIssue[] = [];
  if (release.tileCoverage.lods.length !== 1 || release.tileCoverage.lods[0] !== 12) issues.push(issue("tileCoverage.lods", "This release claims only the generated LOD 12 payload."));
  const manifests = new Set(tilePackage.tiles.map((tile) => `${tile.layer}/${tile.tileKey.scheme}/${tile.tileKey.level}/${tile.tileKey.x}/${tile.tileKey.y}`));
  release.partitions.forEach((partition, index) => {
    if (partition.lods.length !== 1 || partition.lods[0] !== 12) issues.push(issue(`partitions[${index}].lods`, "Partition claims an LOD without generated content."));
    const expected = `${partition.layer}/${partition.tileKey}`;
    if (!manifests.has(expected)) issues.push(issue(`partitions[${index}]`, "Every claimed partition LOD must have a tile manifest."));
    if (!/^[a-f0-9]{64}$/i.test(partition.checksumSha256) || partition.byteSize < 0) issues.push(issue(`partitions[${index}]`, "Partition content checksum and byte size are required."));
  });
  return issues.length ? { ok: false, issues } : { ok: true };
}

export function validatePublishedFileMap(value: unknown, path = "publishedFiles"): CatalogBuildValidation {
  const issues: CatalogBuildIssue[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, issues: [issue(path, "File checksum map is required.")] };
  const refs = new Set<string>();
  Object.entries(value as Record<string, unknown>).forEach(([ref, digest]) => {
    if (!isSafeLocalReleaseReference(ref) || refs.has(ref)) issues.push(issue(`${path}.${ref}`, "Reference must be a unique normalized relative POSIX path.")); else refs.add(ref);
    if (typeof digest !== "string" || !/^[a-f0-9]{64}$/i.test(digest)) issues.push(issue(`${path}.${ref}`, "File checksum must be a SHA-256 hex digest."));
  });
  return issues.length ? { ok: false, issues } : { ok: true };
}

export function validateCatalogRelease(value: unknown): CatalogBuildValidation {
  const issues: CatalogBuildIssue[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, issues: [issue("release", "Expected a CatalogRelease object.")] };
  const release = value as Record<string, unknown>;
  if (release.schemaVersion !== CATALOG_RELEASE_SCHEMA_VERSION) issues.push(issue("release.schemaVersion", "Unsupported release schema version."));
  if (typeof release.releaseId !== "string" || !release.releaseId) issues.push(issue("release.releaseId", "Release ID is required."));
  if (release.cityId !== "manhattan") issues.push(issue("release.cityId", "Release city scope must be Manhattan."));
  if (release.outputCrs !== "EPSG:4326") issues.push(issue("release.outputCrs", "Release CRS must be WGS84."));
  if (!timestamp(release.generatedAt)) issues.push(issue("release.generatedAt", "Release generatedAt must be an ISO timestamp."));
  if (typeof release.fixtureOnly !== "boolean") issues.push(issue("release.fixtureOnly", "Release fixture/production claim is required."));
  const requiredArrays = ["inputArtifacts", "sourceRegistryEntryIds", "sourceLicenses", "partitions", "entitySnapshots", "tombstones"] as const;
  requiredArrays.forEach((field) => { if (!Array.isArray(release[field])) issues.push(issue(`release.${field}`, "Required release array is missing.")); });
  const tileCoverage = release.tileCoverage as Record<string, unknown> | undefined;
  if (!tileCoverage || typeof tileCoverage !== "object" || !Array.isArray(tileCoverage.tileKeys) || !Array.isArray(tileCoverage.lods)) issues.push(issue("release.tileCoverage", "Tile coverage keys and LOD arrays are required."));
  const recordCounts = release.recordCounts as Record<string, unknown> | undefined;
  if (!recordCounts || typeof recordCounts !== "object") issues.push(issue("release.recordCounts", "Record counts are required."));
  const lineage = release.lineage as Record<string, unknown> | undefined;
  if (!lineage || !Array.isArray(lineage.artifactIds) || !Array.isArray(lineage.sourceRefIds)) issues.push(issue("release.lineage", "Complete lineage arrays are required."));
  if (!release.searchIndex || typeof release.searchIndex !== "object" || !release.relationshipIndex || typeof release.relationshipIndex !== "object") issues.push(issue("release.indexes", "Search and relationship indexes are required."));
  const journal = release.buildJournal as Record<string, unknown> | undefined;
  if (!journal || !["staged", "published", "replayed", "failed"].includes(String(journal.status))) issues.push(issue("release.buildJournal.status", "Valid build journal status is required."));
  if (!journal || !Array.isArray(journal.artifactChecksums) || journal.artifactChecksums.some((checksum) => typeof checksum !== "string" || !/^[a-f0-9]{64}$/i.test(checksum))) issues.push(issue("release.buildJournal.artifactChecksums", "Build journal artifact checksums must be SHA-256."));
  const journalValidation = validatePublishedFileMap(journal?.publishedFiles, "release.buildJournal.publishedFiles"); if (!journalValidation.ok) issues.push(...journalValidation.issues); const releaseValidation = validatePublishedFileMap(release.publishedFiles, "release.publishedFiles"); if (!releaseValidation.ok) issues.push(...releaseValidation.issues);
  const journalFiles = journal?.publishedFiles && typeof journal.publishedFiles === "object" && !Array.isArray(journal.publishedFiles) ? journal.publishedFiles as Record<string, string> : {}; const releaseFiles = release.publishedFiles && typeof release.publishedFiles === "object" && !Array.isArray(release.publishedFiles) ? release.publishedFiles as Record<string, string> : {};
  if (stableSerialize(journalFiles) !== stableSerialize(releaseFiles)) issues.push(issue("release.publishedFiles", "Release and build journal published file maps must match."));
  const partitionRefs = new Set<string>(); const partitions = Array.isArray(release.partitions) ? release.partitions : [];
  partitions.forEach((partition, index) => {
    const item = partition as Record<string, unknown>; const path = `release.partitions[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) { issues.push(issue(path, "Partition object is required.")); return; }
    for (const field of ["partitionId", "layer", "tileKey", "relativeContentRef"] as const) if (typeof item[field] !== "string" || !item[field]) issues.push(issue(`${path}.${field}`, "Partition metadata is required."));
    const ref = item.relativeContentRef; if (!isSafeLocalReleaseReference(ref)) issues.push(issue(`${path}.relativeContentRef`, "Partition content reference must be a normalized relative POSIX path.")); else if (partitionRefs.has(ref)) issues.push(issue(`${path}.relativeContentRef`, "Duplicate normalized partition content reference.")); else partitionRefs.add(ref);
    if (!Array.isArray(item.lods) || item.lods.length === 0 || item.lods.some((lod) => !SUPPORTED_TILE_LODS.includes(lod as SupportedTileLod))) issues.push(issue(`${path}.lods`, "Partition LOD metadata must be a non-empty supported array."));
    for (const field of ["canonicalIds", "sourceRecordIds", "sourceRegistryEntryIds"] as const) if (!Array.isArray(item[field])) issues.push(issue(`${path}.${field}`, "Partition index array is required."));
    if (!Number.isInteger(item.featureCount) || Number(item.featureCount) < 0) issues.push(issue(`${path}.featureCount`, "Feature count must be a non-negative integer."));
    if (!Number.isInteger(item.byteSize) || Number(item.byteSize) < 0) issues.push(issue(`${path}.byteSize`, "Byte size must be a non-negative integer."));
    if (typeof item.checksumSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(item.checksumSha256)) issues.push(issue(`${path}.checksumSha256`, "Partition checksum must be SHA-256."));
    if (!item.bounds || typeof item.bounds !== "object") issues.push(issue(`${path}.bounds`, "Partition bounds are required."));
  });
  if (journal?.status === "published") partitionRefs.forEach((ref) => { if (!(ref in journalFiles) || !(ref in releaseFiles)) issues.push(issue("release.publishedFiles", `Published partition content is missing: ${ref}`)); });
  return issues.length ? { ok: false, issues } : { ok: true };
}
