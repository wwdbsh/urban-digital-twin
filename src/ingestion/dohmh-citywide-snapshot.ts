import { sha256HexSync, stableSerialize } from "../release/catalog-release.ts";

export const DOHMH_CITYWIDE_DATASET_ID = "43nn-pn8j" as const;
export const DOHMH_CITYWIDE_ENDPOINT = "https://data.cityofnewyork.us/resource/43nn-pn8j.json" as const;
export const DOHMH_CITYWIDE_METADATA_ENDPOINT = "https://data.cityofnewyork.us/api/views/43nn-pn8j" as const;
export const DOHMH_CITYWIDE_WHERE = "boro='Manhattan'" as const;
export const DOHMH_CITYWIDE_EXPECTED_ROWS = 109_386 as const;
export const DOHMH_CITYWIDE_EXPECTED_CAMIS = 12_439 as const;
export const DOHMH_CITYWIDE_MAX_BYTES = 300 * 1024 * 1024;
export const DOHMH_CITYWIDE_FIELDS = [
  "camis", "dba", "boro", "building", "street", "zipcode", "phone", "cuisine_description",
  "inspection_date", "action", "violation_code", "violation_description", "critical_flag", "score",
  "grade", "grade_date", "record_date", "inspection_type", "latitude", "longitude", "community_board",
  "council_district", "census_tract", "bin", "bbl", "nta", "location",
  ":@computed_region_f5dn_yrer", ":@computed_region_yeji_bk3q", ":@computed_region_sbqj_enih",
  ":@computed_region_92fq_4b7q",
] as const;

export const DOHMH_CITYWIDE_COLUMN_TYPES = [
  "text", "text", "text", "text", "text", "text", "text", "text", "calendar_date", "text",
  "text", "text", "text", "number", "text", "calendar_date", "calendar_date", "text", "number",
  "number", "text", "text", "text", "text", "text", "text", "point", "number", "number", "number", "number",
] as const;

/** SODA 2.1 transport types returned by x-soda2-types for calendar fields. */
export const DOHMH_CITYWIDE_RESPONSE_TYPES = [
  "text", "text", "text", "text", "text", "text", "text", "text", "floating_timestamp", "text",
  "text", "text", "text", "number", "text", "floating_timestamp", "floating_timestamp", "text", "number",
  "number", "text", "text", "text", "text", "text", "text", "point", "number", "number", "number", "number",
] as const;

export type DohnmhCitywideField = (typeof DOHMH_CITYWIDE_FIELDS)[number];
export type CanonicalValue = null | string | number | boolean | CanonicalValue[] | { [key: string]: CanonicalValue };
export type CanonicalRow = { [K in DohnmhCitywideField]: CanonicalValue };

export interface MetadataColumn {
  fieldName?: unknown;
  dataTypeName?: unknown;
  position?: unknown;
}

export interface MetadataFingerprintResult {
  datasetId: string;
  fingerprint: string;
  columns: Array<{ fieldName: string; dataTypeName: string; position: number }>;
  rowsUpdatedAt: string | null;
  viewLastModified: string | null;
}

export interface SourceTruth {
  datasetId: string;
  schemaFingerprint: string;
  rowsUpdatedAt: string | null;
  viewLastModified: string | null;
  lastModified: string | null;
  secondaryLastModified: string | null;
  outOfDate: string | null;
  rowCount: number;
  camisCount: number;
}

export interface CanonicalRowResult {
  row: CanonicalRow;
  json: string;
  digest: string;
}

export interface MultisetGroup {
  digest: string;
  canonicalRow: CanonicalRow;
  canonicalJson: string;
  multiplicity: number;
}

export interface DuplicateMetrics {
  rowCount: number;
  uniqueCanonicalRowCount: number;
  duplicateGroupCount: number;
  duplicateExcessCount: number;
  maximumMultiplicity: number;
  camisCount: number;
  rowsPerCamis: Record<string, number>;
  nullCountByField: Record<string, number>;
  emptyStringCountByField: Record<string, number>;
  multisetDigest: string;
}

export interface MultisetSnapshot {
  groups: Map<string, MultisetGroup>;
  metrics: DuplicateMetrics;
}

export interface DerivedOccurrence {
  parentId: string;
  observationOccurrenceId: string;
  sourceRecordId: string;
  providerRowId: null;
  identityClass: "derived-transport-occurrence";
  rowDigest: string;
  duplicateGroupMultiplicity: number;
  ordinalWithinDigestGroup: number;
  row: CanonicalRow;
}

export interface TruthMismatch {
  field: string;
  expected: string | number | null;
  actual: string | number | null;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export type MetadataValidation = { ok: true; value: MetadataFingerprintResult } | { ok: false; issues: ValidationIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(path: string, message: string): ValidationIssue {
  return { path, message };
}

function timestampFromMetadata(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value * 1000).toISOString();
  return typeof value === "string" && value.length > 0 ? value : null;
}

function canonicalizeValue(value: unknown, path: string): CanonicalValue {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(path + " must be finite.");
    return value;
  }
  if (Array.isArray(value)) return value.map((part, index) => canonicalizeValue(part, path + "[" + index + "]"));
  if (!isRecord(value)) throw new Error(path + " has an unsupported value type.");
  const output: Record<string, CanonicalValue> = {};
  for (const key of Object.keys(value).sort()) output[key] = canonicalizeValue(value[key], path + "." + key);
  return output;
}

function valueMatchesType(value: CanonicalValue, type: string): boolean {
  if (value === null) return true;
  if (type === "point") {
    if (!isRecord(value) || value.type !== "Point" || !Array.isArray(value.coordinates)) return false;
    return value.coordinates.length >= 2 && value.coordinates.length <= 3 && value.coordinates.every((part) => typeof part === "number" && Number.isFinite(part));
  }
  if (type === "number") {
    if (typeof value === "number") return Number.isFinite(value);
    return typeof value === "string" && (value === "" || Number.isFinite(Number(value)));
  }
  return typeof value === "string";
}

export function metadataFingerprint(metadata: unknown): MetadataValidation {
  const issues: ValidationIssue[] = [];
  if (!isRecord(metadata)) return { ok: false, issues: [issue("metadata", "Metadata must be an object.")] };
  if (metadata.id !== DOHMH_CITYWIDE_DATASET_ID) issues.push(issue("metadata.id", "Unexpected DOHMH dataset ID."));
  if (!Array.isArray(metadata.columns)) issues.push(issue("metadata.columns", "Metadata columns are required."));
  const columns = Array.isArray(metadata.columns) ? metadata.columns as MetadataColumn[] : [];
  if (columns.length !== DOHMH_CITYWIDE_FIELDS.length) issues.push(issue("metadata.columns", "Expected exactly 31 metadata columns."));
  const normalized = columns.map((column, index) => {
    const fieldName = typeof column.fieldName === "string" ? column.fieldName : "";
    const dataTypeName = typeof column.dataTypeName === "string" ? column.dataTypeName : "";
    const position = typeof column.position === "number" ? column.position : index + 1;
    return { fieldName, dataTypeName, position };
  });
  DOHMH_CITYWIDE_FIELDS.forEach((field, index) => {
    const column = normalized[index];
    if (!column || column.fieldName !== field || column.dataTypeName !== DOHMH_CITYWIDE_COLUMN_TYPES[index] || column.position !== index + 1) {
      issues.push(issue("metadata.columns[" + index + "]", "Metadata field/type/order does not match the pinned 31-field contract."));
    }
  });
  if (issues.length > 0) return { ok: false, issues };
  const fingerprint = sha256HexSync(stableSerialize(normalized));
  return { ok: true, value: {
    datasetId: DOHMH_CITYWIDE_DATASET_ID,
    fingerprint,
    columns: normalized,
    rowsUpdatedAt: timestampFromMetadata(metadata.rowsUpdatedAt),
    viewLastModified: timestampFromMetadata(metadata.viewLastModified),
  } };
}

export function canonicalizeDohmhRow(value: unknown): CanonicalRowResult {
  if (!isRecord(value)) throw new Error("DOHMH row must be an object.");
  const unknownKeys = Object.keys(value).filter((key) => !(DOHMH_CITYWIDE_FIELDS as readonly string[]).includes(key));
  if (unknownKeys.length > 0) throw new Error("DOHMH row has unknown fields: " + unknownKeys.sort().join(","));
  const row = {} as CanonicalRow;
  DOHMH_CITYWIDE_FIELDS.forEach((field, index) => {
    const canonical = canonicalizeValue(Object.prototype.hasOwnProperty.call(value, field) ? value[field] : null, field);
    if (!valueMatchesType(canonical, DOHMH_CITYWIDE_COLUMN_TYPES[index]!)) throw new Error("DOHMH field has an invalid value type: " + field);
    row[field] = canonical;
  });
  const json = stableSerialize(DOHMH_CITYWIDE_FIELDS.map((field) => row[field]));
  return { row, json, digest: sha256HexSync(json) };
}

export function validateDohmhRows(value: unknown, expectedRows: number = DOHMH_CITYWIDE_EXPECTED_ROWS): CanonicalRowResult[] {
  if (!Array.isArray(value)) throw new Error("DOHMH response must be a JSON array.");
  if (value.length !== expectedRows) throw new Error("DOHMH row count mismatch: expected " + expectedRows + ", got " + value.length + ".");
  return value.map((row, index) => {
    const canonical = canonicalizeDohmhRow(row);
    if (canonical.row.boro !== "Manhattan") throw new Error("DOHMH row " + index + " is outside the exact Manhattan filter.");
    if (typeof canonical.row.camis !== "string" || canonical.row.camis.length === 0) throw new Error("DOHMH row " + index + " has no CAMIS parent identity.");
    return canonical;
  });
}

export function buildDohmhMultiset(rows: readonly CanonicalRowResult[], expectedRows: number = DOHMH_CITYWIDE_EXPECTED_ROWS): MultisetSnapshot {
  if (rows.length !== expectedRows) throw new Error("Cannot build a complete multiset from " + rows.length + " rows; expected " + expectedRows + ".");
  const groups = new Map<string, MultisetGroup>();
  const rowsPerCamis: Record<string, number> = {};
  const nullCountByField: Record<string, number> = Object.fromEntries(DOHMH_CITYWIDE_FIELDS.map((field) => [field, 0]));
  const emptyStringCountByField: Record<string, number> = Object.fromEntries(DOHMH_CITYWIDE_FIELDS.map((field) => [field, 0]));
  for (const canonical of rows) {
    const previous = groups.get(canonical.digest);
    if (previous && previous.canonicalJson !== canonical.json) throw new Error("SHA-256 digest collision detected for canonical DOHMH rows.");
    if (previous) previous.multiplicity += 1;
    else groups.set(canonical.digest, { digest: canonical.digest, canonicalRow: canonical.row, canonicalJson: canonical.json, multiplicity: 1 });
    const camis = canonical.row.camis;
    if (typeof camis === "string") rowsPerCamis[camis] = (rowsPerCamis[camis] ?? 0) + 1;
    DOHMH_CITYWIDE_FIELDS.forEach((field) => {
      const fieldValue = canonical.row[field];
      if (fieldValue === null) nullCountByField[field] = (nullCountByField[field] ?? 0) + 1;
      if (fieldValue === "") emptyStringCountByField[field] = (emptyStringCountByField[field] ?? 0) + 1;
    });
  }
  const sortedGroups = [...groups.values()].sort((left, right) => left.digest.localeCompare(right.digest));
  const multisetDigest = sha256HexSync(sortedGroups.map((group) => group.digest + "\t" + group.multiplicity + "\n").join(""));
  const duplicateGroups = sortedGroups.filter((group) => group.multiplicity > 1);
  return {
    groups,
    metrics: {
      rowCount: rows.length,
      uniqueCanonicalRowCount: groups.size,
      duplicateGroupCount: duplicateGroups.length,
      duplicateExcessCount: sortedGroups.reduce((sum, group) => sum + Math.max(0, group.multiplicity - 1), 0),
      maximumMultiplicity: sortedGroups.reduce((max, group) => Math.max(max, group.multiplicity), 0),
      camisCount: Object.keys(rowsPerCamis).length,
      rowsPerCamis: Object.fromEntries(Object.entries(rowsPerCamis).sort(([left], [right]) => left.localeCompare(right))),
      nullCountByField,
      emptyStringCountByField,
      multisetDigest,
    },
  };
}

export function deriveDohmhOccurrences(snapshot: MultisetSnapshot): DerivedOccurrence[] {
  const output: DerivedOccurrence[] = [];
  for (const group of [...snapshot.groups.values()].sort((left, right) => left.digest.localeCompare(right.digest))) {
    const camis = group.canonicalRow.camis;
    if (typeof camis !== "string" || camis.length === 0) throw new Error("Cannot derive an occurrence without CAMIS.");
    for (let ordinal = 1; ordinal <= group.multiplicity; ordinal += 1) {
      const suffix = String(ordinal).padStart(6, "0");
      const occurrenceId = "dohmh:derived-occurrence:" + group.digest + ":" + suffix;
      output.push({
        parentId: "dohmh:camis:" + camis,
        observationOccurrenceId: occurrenceId,
        sourceRecordId: occurrenceId,
        providerRowId: null,
        identityClass: "derived-transport-occurrence",
        rowDigest: group.digest,
        duplicateGroupMultiplicity: group.multiplicity,
        ordinalWithinDigestGroup: ordinal,
        row: group.canonicalRow,
      });
    }
  }
  const ids = new Set(output.map((item) => item.observationOccurrenceId));
  if (ids.size !== output.length) throw new Error("Derived occurrence ID collision detected.");
  return output;
}

export function compareDohmhMultisets(left: MultisetSnapshot, right: MultisetSnapshot): TruthMismatch | null {
  if (left.metrics.rowCount !== right.metrics.rowCount) return { field: "rowCount", expected: left.metrics.rowCount, actual: right.metrics.rowCount };
  if (left.metrics.multisetDigest !== right.metrics.multisetDigest) {
    const leftKeys = new Set(left.groups.keys());
    const rightKeys = new Set(right.groups.keys());
    const keys = [...new Set([...leftKeys, ...rightKeys])].sort();
    for (const digest of keys) {
      const leftMultiplicity = left.groups.get(digest)?.multiplicity ?? 0;
      const rightMultiplicity = right.groups.get(digest)?.multiplicity ?? 0;
      if (leftMultiplicity !== rightMultiplicity) return { field: "rowDigest:" + digest, expected: leftMultiplicity, actual: rightMultiplicity };
    }
    return { field: "multisetDigest", expected: left.metrics.multisetDigest, actual: right.metrics.multisetDigest };
  }
  return null;
}

export function compareSourceTruth(left: SourceTruth, right: SourceTruth): TruthMismatch | null {
  const fields: Array<keyof SourceTruth> = ["datasetId", "schemaFingerprint", "rowsUpdatedAt", "viewLastModified", "lastModified", "secondaryLastModified", "outOfDate", "rowCount", "camisCount"];
  for (const field of fields) if (left[field] !== right[field]) return { field, expected: left[field], actual: right[field] };
  return null;
}

export function redactTruthMismatch(mismatch: TruthMismatch | null): Record<string, string | number | null> | null {
  if (!mismatch) return null;
  return { field: mismatch.field, expected: mismatch.expected, actual: mismatch.actual };
}

export function assertDohmhTruth(metrics: DuplicateMetrics, expectedRows: number = DOHMH_CITYWIDE_EXPECTED_ROWS, expectedCamis: number = DOHMH_CITYWIDE_EXPECTED_CAMIS): void {
  if (metrics.rowCount !== expectedRows) throw new Error("DOHMH rows mismatch: expected " + expectedRows + ", got " + metrics.rowCount + ".");
  if (metrics.camisCount !== expectedCamis) throw new Error("DOHMH CAMIS mismatch: expected " + expectedCamis + ", got " + metrics.camisCount + ".");
  if (metrics.duplicateGroupCount === 0 || metrics.duplicateExcessCount === 0 || metrics.maximumMultiplicity < 2) throw new Error("DOHMH duplicate multiplicity evidence is missing.");
}

export function validateDohmhResponseBytes(bytes: number, maxBytes = DOHMH_CITYWIDE_MAX_BYTES): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maxBytes) throw new Error("DOHMH response exceeds the immutable byte budget.");
}

export function buildDohmhQueryUrl(limit: number): string {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("DOHMH limit must be a positive integer.");
  const selected = DOHMH_CITYWIDE_FIELDS.map((field) => field.startsWith(":") ? "`" + field + "`" : field).join(",");
  const url = new URL(DOHMH_CITYWIDE_ENDPOINT);
  url.search = new URLSearchParams({ "$select": selected, "$where": DOHMH_CITYWIDE_WHERE, "$limit": String(limit) }).toString();
  return url.toString();
}

export function assertApprovedDohmhUrl(value: string): void {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "data.cityofnewyork.us" || url.pathname !== "/resource/43nn-pn8j.json") throw new Error("DOHMH acquisition URL must be the exact official HTTPS endpoint.");
  if (url.searchParams.has("$offset") || url.searchParams.has("$order") || url.searchParams.has(":id") || url.searchParams.has("$$app_token")) throw new Error("DOHMH acquisition URL contains a forbidden pagination/order/system/token parameter.");
}
