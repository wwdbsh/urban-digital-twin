/**
 * Provider-neutral, source-preserving reconciliation contracts.
 *
 * This module deliberately contains no provider client. It is usable by the
 * browser for the synthetic catalog and by the offline CLI for approved local
 * snapshots. Null means unknown; it is never a value to be inferred.
 */
import type { Feature, Geometry, SourceRef } from "./schema.ts";
import { getSourceRegistryEntry } from "../data/source-registry.ts";
import { makeCanonicalFeatureId } from "../ingestion/offline.ts";
import { PLACE_CATEGORIES, type PlaceCategory } from "./places.ts";

export const RECONCILIATION_SCHEMA_VERSION = "1.0" as const;
export type ReconciledEntityKind = "building" | "poi" | "address" | "area" | "transit-place";
export type ParsedHoursStatus = "parsed" | "invalid" | "unknown";

export interface StructuredAddress {
  formatted: string | null;
  houseNumber: string | null;
  street: string | null;
  unit: string | null;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
  normalizedKey: string | null;
}

export interface ContactFields {
  website: string | null;
  phone: string | null;
  email: string | null;
}

export interface OpeningHoursObservation {
  raw: string | null;
  parsedStatus: ParsedHoursStatus;
  timezone: string | null;
  weekdayText: string[] | null;
}

export interface ReconciledPayload {
  name: string | null;
  aliases: string[];
  categories: PlaceCategory[];
  rawCategories: string[];
  address: StructuredAddress;
  contact: ContactFields;
  brand: string | null;
  operator: string | null;
  cuisine: string | null;
  openingHours: OpeningHoursObservation;
  accessibility: "yes" | "no" | "limited" | "unknown";
  priceLevel: string | null;
  rating: number | null;
  geometry: Geometry | null;
  runtimeFeatureId: string | null;
  links: { buildingIds: string[]; areaIds: string[]; transitIds: string[] };
}

export interface SourceObservation {
  schemaVersion: typeof RECONCILIATION_SCHEMA_VERSION;
  observationId: string;
  entityKind: ReconciledEntityKind;
  cityId: string;
  source: SourceRef;
  payload: ReconciledPayload;
  validFrom: string | null;
  validTo: string | null;
  observedAt: string | null;
  ingestedAt: string;
  confidence: number;
  uncertainty: string;
}

export interface FieldProvenance {
  field: string;
  observationIds: string[];
  sourceRefIds: string[];
  observedAt: string | null;
  confidence: number;
}

export interface SourceConflict {
  field: string;
  observationIds: string[];
  sourceRefIds: string[];
  values: string[];
  reason: string;
}

export interface CandidateDecision {
  leftObservationId: string;
  rightObservationId: string;
  score: number;
  threshold: number;
  reasons: string[];
  decision: "merge" | "unmerged" | "quarantined";
}

export interface CanonicalEntity {
  schemaVersion: typeof RECONCILIATION_SCHEMA_VERSION;
  canonicalId: string;
  mergeGroupId: string;
  entityKind: ReconciledEntityKind;
  cityId: string;
  fields: ReconciledPayload;
  observationIds: string[];
  fieldProvenance: FieldProvenance[];
  conflicts: SourceConflict[];
  confidence: number;
  uncertainty: string;
  validFrom: string | null;
  validTo: string | null;
  observedAt: string | null;
  ingestedAt: string;
  reversibleMerge: true;
}

export interface RejectionRecord {
  index: number;
  observationId: string | null;
  code: "schema-invalid" | "pending-source" | "duplicate-observation" | "malformed";
  message: string;
}

export interface ReconciliationQuality {
  canonicalEntityCount: number;
  sourceObservationCount: number;
  mergedGroupCount: number;
  unmergedCandidateCount: number;
  conflictCount: number;
  staleObservationCount: number;
  rejectedRecordCount: number;
  quarantinedCount: number;
  pendingSourceRefusal: boolean;
}

export interface ReconciliationResult {
  schemaVersion: typeof RECONCILIATION_SCHEMA_VERSION;
  fixtureOnly: boolean;
  observations: SourceObservation[];
  entities: CanonicalEntity[];
  mergeGroups: { id: string; canonicalId: string; memberObservationIds: string[]; reversible: true }[];
  candidates: CandidateDecision[];
  conflicts: SourceConflict[];
  rejected: RejectionRecord[];
  quality: ReconciliationQuality;
}

export interface ReconciliationInputMetadata {
  inputFileName: string;
  inputChecksumSha256: string;
  snapshotChecksumSha256: string;
  sourceRegistryEntryIds: string[];
  ingestedAt: string;
  fixtureOnly: boolean;
}

export interface ReconciliationValidationResult {
  ok: boolean;
  issues: string[];
}

const EMPTY_ADDRESS: StructuredAddress = {
  formatted: null,
  houseNumber: null,
  street: null,
  unit: null,
  locality: null,
  region: null,
  postalCode: null,
  countryCode: null,
  normalizedKey: null,
};

export function unknownHours(raw: string | null = null): OpeningHoursObservation {
  if (raw === null || raw.trim() === "") return { raw: null, parsedStatus: "unknown", timezone: null, weekdayText: null };
  // Parsing is intentionally conservative. We only mark the simple fixture
  // syntax as parsed; complex provider syntax remains explicit/unknown.
  const simple = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:-(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun))? \d{2}:\d{2}-\d{2}:\d{2}$/;
  return simple.test(raw.trim())
    ? { raw, parsedStatus: "parsed", timezone: "America/New_York", weekdayText: [raw] }
    : { raw, parsedStatus: "invalid", timezone: null, weekdayText: null };
}

export function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .normalize("NFC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizePhone(value: string | null): string | null {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length === 0 ? null : digits;
}

export function normalizeAddress(address: Partial<StructuredAddress> | string | null | undefined): StructuredAddress {
  if (typeof address === "string") {
    const formatted = address.trim() || null;
    return { ...EMPTY_ADDRESS, formatted, normalizedKey: formatted ? normalizeText(formatted) : null };
  }
  if (!address) return { ...EMPTY_ADDRESS };
  const result: StructuredAddress = {
    ...EMPTY_ADDRESS,
    ...address,
  };
  const parts = [result.houseNumber, result.street, result.unit, result.locality, result.region, result.postalCode, result.countryCode]
    .filter((value): value is string => Boolean(value?.trim()));
  result.normalizedKey = parts.length > 0 ? normalizeText(parts.join(" ")) : result.formatted ? normalizeText(result.formatted) : null;
  return result;
}

export function normalizeCategory(value: string): PlaceCategory | null {
  const normalized = normalizeText(value).replace(/ /g, "-");
  return (PLACE_CATEGORIES as readonly string[]).includes(normalized) ? normalized as PlaceCategory : null;
}

export function validateSourceObservation(value: unknown): ReconciliationValidationResult {
  const issues: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, issues: ["Expected an observation object."] };
  const item = value as Record<string, unknown>;
  if (item.schemaVersion !== RECONCILIATION_SCHEMA_VERSION) issues.push("schemaVersion must be 1.0.");
  for (const field of ["observationId", "cityId", "ingestedAt", "uncertainty"] as const) if (typeof item[field] !== "string" || !(item[field] as string).trim()) issues.push(`${field} is required.`);
  if (!(typeof item.entityKind === "string" && ["building", "poi", "address", "area", "transit-place"].includes(item.entityKind))) issues.push("entityKind is unsupported.");
  if (!item.source || typeof item.source !== "object" || Array.isArray(item.source)) issues.push("source is required.");
  else {
    const source = item.source as Record<string, unknown>;
    for (const field of ["id", "registryEntryId", "provider", "datasetId", "sourceRecordId", "licenseRefId"] as const) if (typeof source[field] !== "string" || !(source[field] as string).trim()) issues.push(`source.${field} is required.`);
  }
  if (!item.payload || typeof item.payload !== "object" || Array.isArray(item.payload)) issues.push("payload is required.");
  else {
    const payload = item.payload as Record<string, unknown>;
    for (const field of ["aliases", "categories", "rawCategories"] as const) if (!Array.isArray(payload[field])) issues.push(`payload.${field} must be an array.`);
    for (const field of ["address", "contact", "openingHours", "links"] as const) if (!payload[field] || typeof payload[field] !== "object" || Array.isArray(payload[field])) issues.push(`payload.${field} is required.`);
    if (payload.geometry !== null && payload.geometry !== undefined && typeof payload.geometry !== "object") issues.push("payload.geometry must be geometry or null.");
  }
  if (typeof item.confidence !== "number" || item.confidence < 0 || item.confidence > 1) issues.push("confidence must be between 0 and 1.");
  for (const field of ["validFrom", "validTo", "observedAt"] as const) if (item[field] !== null && (typeof item[field] !== "string" || Number.isNaN(Date.parse(item[field] as string)))) issues.push(`${field} must be an ISO string or null.`);
  if (typeof item.ingestedAt === "string" && Number.isNaN(Date.parse(item.ingestedAt))) issues.push("ingestedAt must be an ISO timestamp.");
  return { ok: issues.length === 0, issues };
}

export function validateReconciliationInput(metadata: ReconciliationInputMetadata): ReconciliationValidationResult {
  const issues: string[] = [];
  if (!metadata.inputFileName || /^https?:\/\//i.test(metadata.inputFileName)) issues.push("input must be an explicit local path, not a URL.");
  if (metadata.inputFileName.includes("..") || metadata.inputFileName.startsWith("/")) issues.push("input path must be relative and traversal-free.");
  if (!/^[a-f0-9]{64}$/.test(metadata.inputChecksumSha256)) issues.push("inputChecksumSha256 must be a SHA-256 checksum.");
  if (metadata.inputChecksumSha256 !== metadata.snapshotChecksumSha256) issues.push("snapshot checksum does not match the pinned checksum.");
  if (!metadata.sourceRegistryEntryIds.length) issues.push("at least one source registry entry is required.");
  for (const sourceId of metadata.sourceRegistryEntryIds) {
    const entry = getSourceRegistryEntry(sourceId);
    if (!entry) issues.push(`unknown source registry entry: ${sourceId}`);
    else if (entry.approval.state !== "approved") issues.push(`source remains pending: ${sourceId}`);
  }
  if (!metadata.ingestedAt || Number.isNaN(Date.parse(metadata.ingestedAt))) issues.push("ingestedAt must be an ISO timestamp.");
  return { ok: issues.length === 0, issues };
}

function sourceStableKey(observation: SourceObservation): string {
  return `${observation.source.registryEntryId}:${observation.source.sourceRecordId}`;
}

function coordinateOf(observation: SourceObservation): [number, number] | null {
  const geometry = observation.payload.geometry;
  if (!geometry) return null;
  if (geometry.type === "Point") return [geometry.coordinates[0], geometry.coordinates[1]];
  const position = geometry.type === "LineString" ? geometry.coordinates[0] : geometry.type === "MultiLineString" ? geometry.coordinates[0]?.[0] : geometry.type === "Polygon" ? geometry.coordinates[0]?.[0] : geometry.coordinates[0]?.[0]?.[0];
  return position ? [position[0], position[1]] : null;
}

function distanceMeters(left: SourceObservation, right: SourceObservation): number | null {
  const a = coordinateOf(left); const b = coordinateOf(right);
  if (!a || !b) return null;
  const dLon = (a[0] - b[0]) * 111_320 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
  const dLat = (a[1] - b[1]) * 110_540;
  return Math.sqrt(dLon * dLon + dLat * dLat);
}

function categoryOverlap(left: SourceObservation, right: SourceObservation): boolean {
  return left.payload.categories.some((category) => right.payload.categories.includes(category))
    || left.payload.rawCategories.some((category) => right.payload.rawCategories.includes(category));
}

export function scoreCandidate(left: SourceObservation, right: SourceObservation): CandidateDecision {
  const reasons: string[] = [];
  let score = 0;
  const threshold = 0.72;
  if (left.entityKind !== right.entityKind || left.cityId !== right.cityId) return { leftObservationId: left.observationId, rightObservationId: right.observationId, score: 0, threshold, reasons: ["entity kind or city differs"], decision: "unmerged" };
  // A provider record ID is only comparable inside its declared registry
  // namespace. Different providers commonly use unrelated IDs for the same
  // place, so high confidence alone must not quarantine a cross-provider pair.
  const comparableIdentityNamespace = left.source.registryEntryId === right.source.registryEntryId;
  const contradictoryHighIds = comparableIdentityNamespace && left.source.sourceRecordId !== right.source.sourceRecordId && left.confidence >= 0.9 && right.confidence >= 0.9;
  const sameProviderId = left.source.registryEntryId === right.source.registryEntryId && left.source.sourceRecordId === right.source.sourceRecordId;
  if (sameProviderId) { reasons.push("exact provider registry and source ID"); score = 1; }
  if (contradictoryHighIds) return { leftObservationId: left.observationId, rightObservationId: right.observationId, score, threshold, reasons: ["contradictory high-confidence provider IDs"], decision: "quarantined" };
  if (left.payload.address.normalizedKey && left.payload.address.normalizedKey === right.payload.address.normalizedKey) { score += 0.25; reasons.push("normalized address matches"); }
  if (left.payload.links.buildingIds.some((id) => right.payload.links.buildingIds.includes(id))) { score += 0.2; reasons.push("building link matches"); }
  const leftName = normalizeText(left.payload.name); const rightName = normalizeText(right.payload.name);
  if (leftName && leftName === rightName) { score += 0.2; reasons.push("normalized name matches"); }
  else if (left.payload.aliases.some((alias) => normalizeText(alias) === rightName) || right.payload.aliases.some((alias) => normalizeText(alias) === leftName)) { score += 0.1; reasons.push("alias matches"); }
  if (categoryOverlap(left, right)) { score += 0.1; reasons.push("category overlap"); }
  const distance = distanceMeters(left, right);
  if (distance !== null && distance <= 30) { score += 0.2; reasons.push("coordinates within 30 m"); }
  if (normalizeText(left.payload.brand) && normalizeText(left.payload.brand) === normalizeText(right.payload.brand)) { score += 0.15; reasons.push("brand matches"); }
  if (normalizePhone(left.payload.contact.phone) && normalizePhone(left.payload.contact.phone) === normalizePhone(right.payload.contact.phone)) { score += 0.15; reasons.push("phone matches"); }
  if (normalizeText(left.payload.contact.website) && normalizeText(left.payload.contact.website) === normalizeText(right.payload.contact.website)) { score += 0.15; reasons.push("website matches"); }
  const decision = score >= threshold ? "merge" : "unmerged";
  return { leftObservationId: left.observationId, rightObservationId: right.observationId, score: Number(score.toFixed(4)), threshold, reasons, decision };
}

function fieldValue(payload: ReconciledPayload, field: keyof ReconciledPayload): unknown {
  return payload[field];
}

const RECONCILE_FIELDS: (keyof ReconciledPayload)[] = ["name", "aliases", "categories", "rawCategories", "address", "contact", "brand", "operator", "cuisine", "openingHours", "accessibility", "priceLevel", "rating", "geometry", "runtimeFeatureId", "links"];

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).sort().join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value as object).sort().map((key) => `${key}:${stableValue((value as Record<string, unknown>)[key])}`).join(";")}}`;
  return String(value ?? "");
}

function chooseObservation(members: SourceObservation[]): SourceObservation {
  return [...members].sort((left, right) => right.confidence - left.confidence || (right.observedAt ?? "").localeCompare(left.observedAt ?? "") || left.observationId.localeCompare(right.observationId))[0]!;
}

function makeEntity(members: SourceObservation[], cityId: string, kind: ReconciledEntityKind, conflicts: SourceConflict[]): CanonicalEntity {
  const anchor = [...members].sort((left, right) => left.observationId.localeCompare(right.observationId))[0]!;
  const winner = chooseObservation(members);
  const fields = { ...winner.payload, aliases: [...new Set(members.flatMap((member) => [member.payload.name, ...member.payload.aliases].filter((value): value is string => Boolean(value))))].sort() };
  const fieldProvenance = RECONCILE_FIELDS.map((field) => {
    const selected = [...members].sort((left, right) => right.confidence - left.confidence || left.observationId.localeCompare(right.observationId)).find((member) => fieldValue(member.payload, field) !== null && fieldValue(member.payload, field) !== undefined && stableValue(fieldValue(member.payload, field)) !== "" && stableValue(fieldValue(member.payload, field)) !== "[]") ?? winner;
    return { field, observationIds: members.filter((member) => stableValue(fieldValue(member.payload, field)) === stableValue(fieldValue(selected.payload, field))).map((member) => member.observationId).sort(), sourceRefIds: members.filter((member) => stableValue(fieldValue(member.payload, field)) === stableValue(fieldValue(selected.payload, field))).map((member) => member.source.id).sort(), observedAt: selected.observedAt, confidence: selected.confidence };
  });
  const observed = [...members].map((member) => member.observedAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  const validFrom = [...members].map((member) => member.validFrom).filter((value): value is string => Boolean(value)).sort()[0] ?? null;
  const validTo = [...members].map((member) => member.validTo).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  const featureKind = kind === "transit-place" ? "transit-station" : kind === "address" ? "fixture-point" : kind;
  const canonicalId = makeCanonicalFeatureId(cityId, featureKind, { provider: "reconciled-catalog", datasetId: "source-observation-groups-v1", sourceId: anchor.observationId });
  return { schemaVersion: RECONCILIATION_SCHEMA_VERSION, canonicalId, mergeGroupId: `merge:${anchor.observationId}`, entityKind: kind, cityId, fields, observationIds: members.map((member) => member.observationId).sort(), fieldProvenance, conflicts: conflicts.filter((conflict) => conflict.observationIds.some((id) => members.some((member) => member.observationId === id))), confidence: Math.max(...members.map((member) => member.confidence)), uncertainty: members.map((member) => member.uncertainty).filter(Boolean).join("; "), validFrom, validTo, observedAt: observed, ingestedAt: winner.ingestedAt, reversibleMerge: true };
}

function conflictFor(members: SourceObservation[], field: keyof ReconciledPayload): SourceConflict | null {
  const values = [...new Map(members.map((member) => [stableValue(fieldValue(member.payload, field)), member])).values()];
  const distinct = [...new Set(values.map((member) => stableValue(fieldValue(member.payload, field))))].filter(Boolean);
  if (distinct.length < 2) return null;
  return { field, observationIds: values.map((member) => member.observationId).sort(), sourceRefIds: values.map((member) => member.source.id).sort(), values: distinct.sort(), reason: "Multiple source observations disagree; selected value uses deterministic confidence and recency precedence." };
}

export function reconcileObservations(input: readonly (SourceObservation | unknown)[], options: { fixtureOnly?: boolean; now?: string } = {}): ReconciliationResult {
  const observations: SourceObservation[] = [];
  const rejected: RejectionRecord[] = [];
  const seen = new Set<string>();
  input.forEach((value, index) => {
    const validation = validateSourceObservation(value);
    if (!validation.ok) { rejected.push({ index, observationId: null, code: "schema-invalid", message: validation.issues.join(" ") }); return; }
    const observation = value as SourceObservation;
    const registry = getSourceRegistryEntry(observation.source.registryEntryId);
    if (!registry || registry.approval.state !== "approved") { rejected.push({ index, observationId: observation.observationId, code: "pending-source", message: `Source ${observation.source.registryEntryId} is not approved.` }); return; }
    if (seen.has(observation.observationId) || seen.has(sourceStableKey(observation))) { rejected.push({ index, observationId: observation.observationId, code: "duplicate-observation", message: "Observation ID or provider source ID is duplicated." }); return; }
    seen.add(observation.observationId); seen.add(sourceStableKey(observation)); observations.push(observation);
  });
  const candidates: CandidateDecision[] = [];
  for (let leftIndex = 0; leftIndex < observations.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < observations.length; rightIndex += 1) candidates.push(scoreCandidate(observations[leftIndex]!, observations[rightIndex]!));
  const parent = observations.map((_, index) => index);
  const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index]!));
  const unite = (left: number, right: number) => { const a = find(left); const b = find(right); if (a !== b) parent[b] = a; };
  candidates.filter((candidate) => candidate.decision === "merge").forEach((candidate) => unite(observations.findIndex((item) => item.observationId === candidate.leftObservationId), observations.findIndex((item) => item.observationId === candidate.rightObservationId)));
  const groups = new Map<number, SourceObservation[]>();
  observations.forEach((observation, index) => { const key = find(index); groups.set(key, [...(groups.get(key) ?? []), observation]); });
  const conflicts = [...groups.values()].flatMap((members) => RECONCILE_FIELDS.map((field) => conflictFor(members, field)).filter((conflict): conflict is SourceConflict => conflict !== null));
  const entities = [...groups.values()].map((members) => makeEntity(members, members[0]!.cityId, members[0]!.entityKind, conflicts)).sort((left, right) => left.canonicalId.localeCompare(right.canonicalId));
  const mergeGroups = entities.map((entity) => ({ id: entity.mergeGroupId, canonicalId: entity.canonicalId, memberObservationIds: entity.observationIds, reversible: true as const }));
  const staleObservationCount = observations.filter((observation) => options.now && observation.observedAt && Date.parse(options.now) - Date.parse(observation.observedAt) > 1000 * 60 * 60 * 24 * 180).length;
  return { schemaVersion: RECONCILIATION_SCHEMA_VERSION, fixtureOnly: options.fixtureOnly ?? false, observations, entities, mergeGroups, candidates, conflicts, rejected, quality: { canonicalEntityCount: entities.length, sourceObservationCount: observations.length, mergedGroupCount: mergeGroups.filter((group) => group.memberObservationIds.length > 1).length, unmergedCandidateCount: candidates.filter((candidate) => candidate.decision === "unmerged").length, conflictCount: conflicts.length, staleObservationCount, rejectedRecordCount: rejected.length, quarantinedCount: candidates.filter((candidate) => candidate.decision === "quarantined").length, pendingSourceRefusal: rejected.some((item) => item.code === "pending-source") } };
}

export function searchReconciledCatalog(result: ReconciliationResult, query: string): CanonicalEntity[] {
  const normalized = normalizeText(query);
  if (!normalized) return [];
  const scored = result.entities.map((entity) => {
    const sourceObservations = result.observations.filter((observation) => entity.observationIds.includes(observation.observationId));
    const sourceMetadata = sourceObservations.flatMap((observation) => [observation.observationId, observation.source.id, observation.source.registryEntryId, observation.source.provider, observation.source.datasetId, observation.source.sourceRecordId]);
    const fields = [entity.fields.name, ...entity.fields.aliases, entity.fields.address.formatted, entity.fields.address.normalizedKey, ...entity.fields.categories, ...entity.fields.rawCategories, entity.fields.brand, entity.fields.operator, entity.fields.cuisine, entity.canonicalId, ...entity.observationIds, ...sourceMetadata, ...entity.fields.links.buildingIds, ...entity.fields.links.areaIds, ...entity.fields.links.transitIds].filter((value): value is string => Boolean(value)).map(normalizeText);
    const exactName = normalizeText(entity.fields.name) === normalized;
    const exactSource = entity.observationIds.some((id) => normalizeText(id) === normalized);
    const starts = fields.some((field) => field.startsWith(normalized));
    const includes = fields.some((field) => field.includes(normalized));
    return { entity, score: exactSource ? 0 : exactName ? 1 : starts ? 2 : includes ? 3 : Number.POSITIVE_INFINITY };
  });
  return scored.filter((item) => Number.isFinite(item.score)).sort((left, right) => left.score - right.score || left.entity.canonicalId.localeCompare(right.entity.canonicalId)).map((item) => item.entity);
}

export function observationFromFeature(feature: Feature, options: { observationId: string; sourceRecordId?: string; name?: string; address?: StructuredAddress | string | null; confidence?: number; aliases?: string[]; rawCategories?: string[]; conflictingPhone?: string | null; observedAt?: string | null } ): SourceObservation {
  const source = feature.sourceRefs[0];
  if (!source) throw new Error(`Feature ${feature.id} has no source reference.`);
  const rawCategories = options.rawCategories ?? String(feature.attributes.placeCategories ?? feature.kind).split(",");
  const categories = rawCategories.map(normalizeCategory).filter((value): value is PlaceCategory => value !== null);
  const addressValue = options.address ?? (typeof feature.attributes.placeAddress === "string" ? feature.attributes.placeAddress : null);
  const payload: ReconciledPayload = {
    name: options.name ?? feature.name,
    aliases: options.aliases ?? [],
    categories,
    rawCategories,
    address: normalizeAddress(addressValue),
    contact: { website: typeof feature.attributes.placeWebsite === "string" ? feature.attributes.placeWebsite : null, phone: options.conflictingPhone ?? (typeof feature.attributes.placePhone === "string" ? feature.attributes.placePhone : null), email: null },
    brand: typeof feature.attributes.placeBrand === "string" ? feature.attributes.placeBrand : null,
    operator: null,
    cuisine: typeof feature.attributes.placeCuisine === "string" ? feature.attributes.placeCuisine : null,
    openingHours: unknownHours(typeof feature.attributes.placeOpeningHours === "string" ? feature.attributes.placeOpeningHours.replaceAll("[", "").replaceAll("]", "").replaceAll('"', "").split(",")[0] ?? null : null),
    accessibility: feature.attributes.placeAccessibility === "yes" || feature.attributes.placeAccessibility === "no" || feature.attributes.placeAccessibility === "limited" ? feature.attributes.placeAccessibility : "unknown",
    priceLevel: null,
    rating: null,
    geometry: feature.geometry,
    runtimeFeatureId: feature.id,
    links: { buildingIds: feature.kind === "building" ? [feature.id] : [], areaIds: feature.kind === "area" ? [feature.id] : [], transitIds: feature.kind.startsWith("transit-") ? [feature.id] : [] },
  };
  const sourceRecordId = options.sourceRecordId ?? source.sourceRecordId;
  return { schemaVersion: RECONCILIATION_SCHEMA_VERSION, observationId: options.observationId, entityKind: feature.kind === "transit-station" || feature.kind === "transit-entrance" || feature.kind === "transit-route" ? "transit-place" : feature.kind === "area" ? "area" : feature.kind === "building" ? "building" : "poi", cityId: feature.cityId, source: { ...source, id: `${source.id}:${options.observationId}`, sourceRecordId }, payload, validFrom: null, validTo: null, observedAt: options.observedAt ?? feature.freshness.observedAt, ingestedAt: feature.freshness.ingestedAt, confidence: options.confidence ?? feature.confidence.score, uncertainty: feature.uncertainty.notes };
}
