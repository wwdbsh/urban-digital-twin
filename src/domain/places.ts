import type { Feature, Position, SourceRef, Freshness, LicenseClass, ValidationIssue, ValidationResult } from "./schema.ts";
import { DOMAIN_SCHEMA_VERSION } from "./schema.ts";

export const PLACE_CATEGORIES = [
  "restaurant",
  "cafe",
  "bar",
  "retail",
  "department-store",
  "grocery",
  "attraction",
  "museum",
  "park",
  "transit",
  "public-service",
  "lodging",
  "other",
] as const;

export type PlaceCategory = (typeof PLACE_CATEGORIES)[number];

export interface PlaceAddress {
  formatted: string | null;
  line1: string | null;
  line2: string | null;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
}

export interface PlaceContact {
  website: string | null;
  phone: string | null;
  email: string | null;
}

export interface PlaceHoursPeriod {
  day: number;
  opens: string | null;
  closes: string | null;
}

export interface PlaceOpeningHours {
  timezone: string | null;
  weekdayText: string[] | null;
  periods: PlaceHoursPeriod[] | null;
  isOpenNow: boolean | null;
}

export interface PlaceAccessibility {
  wheelchair: "yes" | "no" | "limited" | "unknown";
  entrance: "yes" | "no" | "limited" | "unknown";
  notes: string | null;
}

export interface PlaceSourceLicense {
  sourceRefId: string;
  licenseClass: LicenseClass | string;
  termsUrl: string;
  attribution: string;
}

export interface PlaceConflict {
  field: string;
  sourceRefIds: string[];
  values: string[];
}

/** Provider-neutral place contract. Missing source fields stay null. */
export interface PlaceRecord {
  schemaVersion: typeof DOMAIN_SCHEMA_VERSION;
  canonicalId: string;
  cityId: string;
  name: string | null;
  categories: PlaceCategory[];
  coordinates: Position;
  address: PlaceAddress;
  contact: PlaceContact;
  openingHours: PlaceOpeningHours;
  cuisine: string | null;
  brand: string | null;
  accessibility: PlaceAccessibility;
  freshness: Freshness;
  sourceRefs: SourceRef[];
  sourceLicenses: PlaceSourceLicense[];
  conflicts: PlaceConflict[];
  sourceRecordIds: string[];
  fixtureOnly: boolean;
}

export function isPlaceCategory(value: unknown): value is PlaceCategory {
  return typeof value === "string" && (PLACE_CATEGORIES as readonly string[]).includes(value);
}

function issue(path: string, message: string): ValidationIssue {
  return { path, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown, path: string, issues: ValidationIssue[]): value is string | null {
  if (value !== null && typeof value !== "string") issues.push(issue(path, "Expected a string or null."));
  return value === null || typeof value === "string";
}

function validateCoordinate(value: unknown, path: string, issues: ValidationIssue[]): value is Position {
  if (!Array.isArray(value) || (value.length !== 2 && value.length !== 3) || value.some((coordinate) => typeof coordinate !== "number" || !Number.isFinite(coordinate))) {
    issues.push(issue(path, "Expected a finite WGS84 2D or 3D position."));
    return false;
  }
  const [longitude, latitude] = value as [number, number];
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) issues.push(issue(path, "WGS84 coordinates are outside their valid range."));
  return true;
}

export function validatePlaceRecord(value: unknown): ValidationResult<PlaceRecord> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return { ok: false, issues: [issue("$", "Expected a PlaceRecord.")] };
  if (value.schemaVersion !== DOMAIN_SCHEMA_VERSION) issues.push(issue("schemaVersion", "Unexpected place schema version."));
  if (typeof value.canonicalId !== "string" || value.canonicalId.length === 0) issues.push(issue("canonicalId", "A canonical ID is required."));
  if (typeof value.cityId !== "string" || value.cityId.length === 0) issues.push(issue("cityId", "A city ID is required."));
  nullableString(value.name, "name", issues);
  if (!Array.isArray(value.categories) || value.categories.some((category) => !isPlaceCategory(category))) issues.push(issue("categories", "Categories must use the provider-neutral PlaceCategory vocabulary."));
  validateCoordinate(value.coordinates, "coordinates", issues);
  for (const field of ["address", "contact", "openingHours", "accessibility", "freshness"] as const) if (!isRecord(value[field])) issues.push(issue(field, "Field is required even when all source values are unknown."));
  if (!Array.isArray(value.sourceRefs) || value.sourceRefs.length === 0) issues.push(issue("sourceRefs", "At least one source reference is required."));
  if (!Array.isArray(value.sourceLicenses) || value.sourceLicenses.length === 0) issues.push(issue("sourceLicenses", "Per-source license records are required."));
  if (!Array.isArray(value.conflicts)) issues.push(issue("conflicts", "Reconciliation conflicts must be explicit."));
  if (!Array.isArray(value.sourceRecordIds) || value.sourceRecordIds.some((id) => typeof id !== "string")) issues.push(issue("sourceRecordIds", "Source record IDs are required."));
  if (typeof value.fixtureOnly !== "boolean") issues.push(issue("fixtureOnly", "Fixture state must be explicit."));
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: value as unknown as PlaceRecord };
}

export function placeCategoriesFromFeature(feature: Feature): PlaceCategory[] {
  const raw = feature.attributes.placeCategories;
  if (typeof raw !== "string") return [];
  return raw.split(",").map((value) => value.trim()).filter(isPlaceCategory);
}

export function placeDisplayName(place: PlaceRecord): string {
  return place.name ?? "Unnamed place";
}
