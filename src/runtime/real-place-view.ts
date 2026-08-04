import type {
  Feature,
  Freshness,
  SourceRef,
} from "../domain/schema.ts";
import type {
  PlaceAddress,
  PlaceCategory,
  PlaceContact,
  PlaceSourceLicense,
} from "../domain/places.ts";
import { isPlaceCategory } from "../domain/places.ts";

/** The only restaurant release currently approved for the browser pilot. */
export const REAL_PILOT_RELEASE_ID = "real-wave-20260804" as const;
export const DOHMH_REGISTRY_ENTRY_ID = "nyc.dohmh-restaurant-inspections" as const;
export const DOHMH_SENTINEL_INSPECTION_DATE = "1900-01-01" as const;

export type RealPlaceDetailStatus = "known" | "unknown" | "error";
export type InspectionDateStatus = "usable" | "not-yet-inspected" | "unknown";

export interface RealPlaceInspectionSummary {
  camis: string | null;
  sourceRecordId: string | null;
  inspectionDate: string | null;
  inspectionDateStatus: InspectionDateStatus;
  recordDate: string | null;
  grade: string | null;
  score: string | null;
  action: string | null;
  inspectionType: string | null;
}

export interface RealPlaceView {
  canonicalId: string;
  runtimeFeatureId: string;
  releaseId: typeof REAL_PILOT_RELEASE_ID;
  cityId: string;
  name: string;
  categories: PlaceCategory[];
  rawCategories: string[];
  canonicalCategory: PlaceCategory | null;
  address: PlaceAddress;
  contact: PlaceContact;
  cuisine: string | null;
  brand: string | null;
  sourceRefs: SourceRef[];
  sourceRecordIds: string[];
  sourceLicenses: PlaceSourceLicense[];
  inspectionObservationCount: number | null;
  latestInspection: RealPlaceInspectionSummary | null;
  freshness: Freshness;
  uncertainty: string;
  fixtureOnly: false;
  diagnostics: string[];
}

export interface RealPlaceSearchDocument {
  featureId: string;
  canonicalId: string;
  name: string;
  normalizedName: string;
  address: string[];
  cuisine: string[];
  rawCategories: string[];
  categories: PlaceCategory[];
  sourceIds: string[];
  sourceRecordIds: string[];
  camis: string | null;
  canonicalCategory: PlaceCategory | null;
  view: RealPlaceView;
}

interface ParsedJson<T> {
  status: RealPlaceDetailStatus;
  value: T | null;
  message: string | null;
}

const INSPECTION_STRING_FIELDS = [
  "camis",
  "inspectionDate",
  "recordDate",
  "grade",
  "score",
  "action",
  "inspectionType",
] as const;

type InspectionJson = Partial<Record<(typeof INSPECTION_STRING_FIELDS)[number], unknown>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function attribute(feature: Feature, key: string): unknown {
  return feature.attributes[key];
}

function normalizedWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function parseJson<T>(feature: Feature, key: string, validate: (value: unknown) => value is T): ParsedJson<T> {
  const raw = attribute(feature, key);
  if (raw === null || raw === undefined || raw === "") return { status: "unknown", value: null, message: null };
  if (typeof raw !== "string") return { status: "error", value: null, message: `${key} is not a JSON string.` };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!validate(parsed)) return { status: "error", value: null, message: `${key} has an invalid JSON shape.` };
    return { status: "known", value: parsed, message: null };
  } catch {
    return { status: "error", value: null, message: `${key} contains malformed JSON.` };
  }
}

function stringAttribute(feature: Feature, key: string, diagnostics: string[]): string | null {
  const raw = attribute(feature, key);
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string") {
    diagnostics.push(`${key} is unknown because its value is not a string.`);
    return null;
  }
  return normalizedWhitespace(raw) || null;
}

function validStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim() !== "");
}

function validLicenseArray(value: unknown): value is PlaceSourceLicense[] {
  return Array.isArray(value) && value.every((item) => isRecord(item)
    && typeof item.sourceRefId === "string"
    && typeof item.licenseClass === "string"
    && typeof item.termsUrl === "string"
    && typeof item.attribution === "string");
}

function validInspectionObject(value: unknown): value is InspectionJson {
  if (!isRecord(value)) return false;
  return INSPECTION_STRING_FIELDS.every((field) => value[field] === undefined || value[field] === null || typeof value[field] === "string");
}

function validCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseAddress(raw: string | null): PlaceAddress {
  if (!raw) return { formatted: null, line1: null, line2: null, locality: null, region: null, postalCode: null, countryCode: null };
  const parts = raw.split(",").map((part) => normalizedWhitespace(part)).filter(Boolean);
  const line1 = parts[0] ?? null;
  const locality = parts[1] ?? null;
  const regionPart = parts.slice(2).join(", ") || null;
  const postalMatch = regionPart?.match(/\b\d{5}(?:-\d{4})?\b/) ?? null;
  const postalCode = postalMatch?.[0] ?? null;
  const region = regionPart ? normalizedWhitespace(regionPart.replace(postalCode ?? "", "")).replace(/,$/, "").trim() || null : null;
  return { formatted: raw, line1, line2: null, locality, region, postalCode, countryCode: "US" };
}

function parseCategories(feature: Feature, diagnostics: string[]): { rawCategories: string[]; categories: PlaceCategory[] } {
  const raw = attribute(feature, "placeCategories");
  if (raw === null || raw === undefined || raw === "") return { rawCategories: [], categories: [] };
  if (typeof raw !== "string") {
    diagnostics.push("placeCategories is unknown because its value is not a string.");
    return { rawCategories: [], categories: [] };
  }
  const rawCategories = raw.split(",").map((value) => normalizedWhitespace(value)).filter(Boolean);
  const categories = rawCategories.filter(isPlaceCategory);
  if (categories.length !== rawCategories.length) diagnostics.push("placeCategories contains an unsupported provider category; only known canonical categories are enabled.");
  return { rawCategories, categories };
}

/**
 * Parse a date only after checking its calendar portion in UTC. Date.parse
 * alone normalizes values such as 2025-02-30 into March, which would turn
 * malformed source data into an asserted observation.
 */
function strictUtcDateParse(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendar = new Date(0);
  calendar.setUTCHours(0, 0, 0, 0);
  calendar.setUTCFullYear(year, month - 1, day);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function parseInspectionDate(value: string | null, diagnostics: string[]): { date: string | null; status: InspectionDateStatus } {
  if (!value) return { date: null, status: "unknown" };
  const normalized = value.slice(0, 10);
  if (normalized === DOHMH_SENTINEL_INSPECTION_DATE) return { date: null, status: "not-yet-inspected" };
  if (strictUtcDateParse(value) === null) {
    diagnostics.push("placeLatestInspection.inspectionDate is malformed; no inspection date is asserted.");
    return { date: null, status: "unknown" };
  }
  return { date: normalized, status: "usable" };
}

function parseOptionalDate(value: string | null, field: string, diagnostics: string[]): string | null {
  if (!value) return null;
  if (strictUtcDateParse(value) === null) {
    diagnostics.push(`placeLatestInspection.${field} is malformed; the date is unknown.`);
    return null;
  }
  return value;
}

function sourceCamis(sourceRecordId: string | null): string | null {
  const match = sourceRecordId?.match(/^dohmh:(\d+):/);
  return match?.[1] ?? null;
}

function inspectionSourceRecordId(feature: Feature, sourceRecordIds: readonly string[]): string | null {
  const explicit = sourceRecordIds.find((id) => id.trim() !== "");
  if (explicit) return explicit;
  return feature.sourceRefs.find((source) => source.registryEntryId === DOHMH_REGISTRY_ENTRY_ID)?.sourceRecordId ?? null;
}

/**
 * Parse a single lightweight browser record. Optional JSON detail is fail-soft
 * and diagnostic; a manifest/source/checksum failure is handled by the loader.
 */
export function parseRealPlaceFeature(feature: Feature, releaseId: string = REAL_PILOT_RELEASE_ID): RealPlaceView {
  if (feature.kind !== "poi") throw new Error(`Real place projection requires a POI feature: ${feature.id}`);
  if (!isRealPlaceFeature(feature)) throw new Error(`Real place projection refuses fixture-only feature: ${feature.id}`);
  if (releaseId !== REAL_PILOT_RELEASE_ID) throw new Error(`Unsupported real place release: ${releaseId}`);
  const diagnostics: string[] = [];
  const { rawCategories, categories } = parseCategories(feature, diagnostics);
  const sourceRecordIdsJson = parseJson(feature, "placeSourceRecordIds", validStringArray);
  const sourceRecordIds = sourceRecordIdsJson.value ?? feature.sourceRefs.map((source) => source.sourceRecordId).filter(Boolean);
  if (sourceRecordIdsJson.message) diagnostics.push(sourceRecordIdsJson.message);

  const sourceRefIds = new Set(feature.sourceRefs.map((source) => source.id));
  const licensesJson = parseJson(feature, "placeLicenses", validLicenseArray);
  const sourceLicenses = (licensesJson.value ?? []).filter((license) => sourceRefIds.has(license.sourceRefId));
  if (licensesJson.message) diagnostics.push(licensesJson.message);

  const latestJson = parseJson(feature, "placeLatestInspection", validInspectionObject);
  const latestInspection = latestJson.value ? parseInspectionSummary(latestJson.value, inspectionSourceRecordId(feature, sourceRecordIds), diagnostics) : null;
  if (latestJson.message) diagnostics.push(latestJson.message);

  const countRaw = attribute(feature, "placeInspectionObservationCount");
  const inspectionObservationCount = countRaw === null || countRaw === undefined ? null : validCount(countRaw) ? countRaw : null;
  if (countRaw !== null && countRaw !== undefined && !validCount(countRaw)) diagnostics.push("placeInspectionObservationCount is unknown because it is not a non-negative integer.");

  const sourceCamisValue = latestInspection?.camis ?? sourceCamis(sourceRecordIds[0] ?? null);
  const sourceRefMismatch = (licensesJson.value ?? []).some((license) => !sourceRefIds.has(license.sourceRefId));
  if (sourceRefMismatch) diagnostics.push("placeLicenses references a source ref not present on the feature; the source identity remains unverified.");
  const fixtureValue = attribute(feature, "fixtureOnly");
  if (fixtureValue === true) diagnostics.push("fixtureOnly attribute disagrees with source role; source role controls runtime truth.");

  const contact: PlaceContact = {
    website: stringAttribute(feature, "placeWebsite", diagnostics),
    phone: stringAttribute(feature, "placePhone", diagnostics),
    email: null,
  };
  return {
    canonicalId: feature.id,
    runtimeFeatureId: feature.id,
    releaseId: REAL_PILOT_RELEASE_ID,
    cityId: feature.cityId,
    name: feature.name,
    categories,
    rawCategories,
    canonicalCategory: categories[0] ?? null,
    address: parseAddress(stringAttribute(feature, "placeAddress", diagnostics)),
    contact,
    cuisine: stringAttribute(feature, "placeCuisine", diagnostics),
    brand: stringAttribute(feature, "placeBrand", diagnostics),
    sourceRefs: feature.sourceRefs,
    sourceRecordIds,
    sourceLicenses,
    inspectionObservationCount,
    latestInspection: latestInspection ? { ...latestInspection, camis: latestInspection.camis ?? sourceCamisValue } : null,
    freshness: feature.freshness,
    uncertainty: feature.uncertainty.notes,
    fixtureOnly: false,
    diagnostics,
  };
}

function parseInspectionSummary(value: InspectionJson, sourceRecordId: string | null, diagnostics: string[]): RealPlaceInspectionSummary {
  const stringValue = (field: (typeof INSPECTION_STRING_FIELDS)[number]): string | null => {
    const current = value[field];
    return typeof current === "string" && current.trim() !== "" ? normalizedWhitespace(current) : null;
  };
  const date = parseInspectionDate(stringValue("inspectionDate"), diagnostics);
  return {
    camis: stringValue("camis") ?? sourceCamis(sourceRecordId),
    sourceRecordId,
    inspectionDate: date.date,
    inspectionDateStatus: date.status,
    recordDate: parseOptionalDate(stringValue("recordDate"), "recordDate", diagnostics),
    grade: stringValue("grade"),
    score: stringValue("score"),
    action: stringValue("action"),
    inspectionType: stringValue("inspectionType"),
  };
}

function dateRank(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  return strictUtcDateParse(value) ?? Number.NEGATIVE_INFINITY;
}

/** Deterministic latest inspection ordering: inspection date, record date, ID. */
export function compareInspectionSummaries(left: RealPlaceInspectionSummary, right: RealPlaceInspectionSummary): number {
  const inspectionOrder = dateRank(left.inspectionDate) - dateRank(right.inspectionDate);
  if (inspectionOrder !== 0) return inspectionOrder;
  const recordOrder = dateRank(left.recordDate) - dateRank(right.recordDate);
  if (recordOrder !== 0) return recordOrder;
  return (left.sourceRecordId ?? "").localeCompare(right.sourceRecordId ?? "");
}

export function selectLatestInspectionSummary(summaries: readonly RealPlaceInspectionSummary[]): RealPlaceInspectionSummary | null {
  return summaries.reduce<RealPlaceInspectionSummary | null>((latest, candidate) => !latest || compareInspectionSummaries(candidate, latest) > 0 ? candidate : latest, null);
}

export function isRealPlaceFeature(feature: Feature): boolean {
  return feature.kind === "poi" && feature.sourceRefs.length > 0 && feature.sourceRefs.every((source) => source.registryEntryId === DOHMH_REGISTRY_ENTRY_ID && source.role !== "fixture");
}

export function buildRealPlaceSearchDocument(feature: Feature): RealPlaceSearchDocument | null {
  if (!isRealPlaceFeature(feature)) return null;
  const view = parseRealPlaceFeature(feature);
  const addressValues = [view.address.formatted, view.address.line1, view.address.locality, view.address.region, view.address.postalCode].filter((value): value is string => Boolean(value));
  return {
    featureId: feature.id,
    canonicalId: view.canonicalId,
    name: view.name,
    normalizedName: normalizeSearchText(view.name),
    address: addressValues,
    cuisine: view.cuisine ? [view.cuisine] : [],
    rawCategories: view.rawCategories,
    categories: view.categories,
    sourceIds: [...new Set([...view.sourceRefs.map((source) => source.id), ...view.sourceRefs.map((source) => source.sourceRecordId)])],
    sourceRecordIds: view.sourceRecordIds,
    camis: view.latestInspection?.camis ?? null,
    canonicalCategory: view.canonicalCategory,
    view,
  };
}

/** Unicode-normalized visitor search text; JSON blobs are never included. */
export function normalizeSearchText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .normalize("NFC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}
