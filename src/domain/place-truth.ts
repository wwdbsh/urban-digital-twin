import type {
  Freshness,
  Position,
  SourceRef,
  ValidationIssue,
  ValidationResult,
} from "./schema.ts";
import type {
  PlaceAccessibility,
  PlaceAddress,
  PlaceCategory,
  PlaceContact,
  PlaceSourceLicense,
} from "./places.ts";
import { isPlaceCategory, PLACE_CATEGORIES } from "./places.ts";

/**
 * Source-preserving place truth. A status is deliberately separate from the
 * value: null means no value is being asserted, while stale/conflict retain
 * the last observed value and explain why it should not be treated as current.
 */
export const PLACE_TRUTH_SCHEMA_VERSION = "1.0" as const;
export type TruthStatus = "known" | "unknown" | "absent" | "stale" | "conflict";
export type OpenStatus = "open" | "closed" | "unknown" | "stale";

export interface TruthField<T> {
  status: TruthStatus;
  value: T | null;
  sourceRefIds: string[];
  observationIds: string[];
  observedAt: string | null;
  publishedAt: string | null;
  validFrom: string | null;
  validTo: string | null;
  confidence: number;
  uncertainty: string;
}

export interface LocalizedPlaceName {
  value: string;
  language: string | null;
  sourceRefIds: string[];
}

export interface PlaceTruthAlias {
  value: string;
  language: string | null;
  sourceRefIds: string[];
}

export interface PlaceTruthEntrance {
  id: string;
  label: string | null;
  coordinates: Position;
  address: TruthField<PlaceAddress>;
  accessibility: TruthField<PlaceAccessibility>;
  sourceRefIds: string[];
}

export interface PlaceTruthHoursPeriod {
  /** Monday is 0 and Sunday is 6; all times are local to `timezone`. */
  day: number;
  opens: string;
  closes: string;
}

export interface PlaceTruthSpecialHours {
  date: string;
  kind: "closed" | "open";
  periods: PlaceTruthHoursPeriod[];
  note: string | null;
}

export interface PlaceTruthHours {
  status: TruthStatus;
  timezone: string | null;
  raw: string | null;
  periods: TruthField<PlaceTruthHoursPeriod[]>;
  specialDates: TruthField<PlaceTruthSpecialHours[]>;
}

export interface PlaceTruthAmenity {
  id: string;
  label: string;
  value: "yes" | "no" | "limited" | "unknown";
  note: string | null;
  sourceRefIds: string[];
}

export interface PlaceTruthImageryReference {
  kind: "photo" | "street-view" | "map-tile" | "other";
  uri: string;
  attribution: string;
  author: string | null;
  observedAt: string | null;
  sourceRefIds: string[];
}

export interface PlaceTruthCommercialFacts {
  priceLevel: TruthField<string>;
  rating: TruthField<number>;
  reviewCount: TruthField<number>;
  popularity: TruthField<number>;
  businessStatus: TruthField<"open" | "closed" | "temporarily-closed" | "unknown">;
}

export interface PlaceTruthConflict {
  field: string;
  sourceRefIds: string[];
  observationIds: string[];
  values: string[];
  reason: string;
}

export interface PlaceFieldLineage {
  field: string;
  status: TruthStatus;
  sourceRefIds: string[];
  observationIds: string[];
  observedAt: string | null;
  publishedAt: string | null;
  confidence: number;
  uncertainty: string;
}

export interface PlaceTruthRecord {
  schemaVersion: typeof PLACE_TRUTH_SCHEMA_VERSION;
  canonicalId: string;
  cityId: string;
  name: TruthField<string>;
  localizedNames: LocalizedPlaceName[];
  aliases: PlaceTruthAlias[];
  categories: PlaceCategory[];
  facets: string[];
  coordinates: Position;
  address: TruthField<PlaceAddress>;
  entrances: PlaceTruthEntrance[];
  brand: TruthField<string>;
  operator: TruthField<string>;
  contact: TruthField<PlaceContact>;
  hours: PlaceTruthHours;
  amenities: TruthField<PlaceTruthAmenity[]>;
  accessibility: TruthField<PlaceAccessibility>;
  commercial: PlaceTruthCommercialFacts;
  imagery: TruthField<PlaceTruthImageryReference[]>;
  freshness: Freshness;
  validFrom: string | null;
  validTo: string | null;
  sourceRefs: SourceRef[];
  sourceLicenses: PlaceSourceLicense[];
  lineage: PlaceFieldLineage[];
  conflicts: PlaceTruthConflict[];
  uncertainty: string;
  fixtureOnly: boolean;
  runtimeFeatureId: string | null;
}

export interface HoursEvaluation {
  status: OpenStatus;
  localDate: string | null;
  localTime: string | null;
  explanation: string;
  matchedPeriod: PlaceTruthHoursPeriod | null;
}

function issue(path: string, message: string): ValidationIssue {
  return { path, message };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validIso(value: unknown, path: string, issues: ValidationIssue[], nullable = true): boolean {
  if (value === null && nullable) return true;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    issues.push(issue(path, "Expected an ISO-8601 timestamp or null."));
    return false;
  }
  return true;
}

function validPosition(value: unknown, path: string, issues: ValidationIssue[]): value is Position {
  if (!Array.isArray(value) || (value.length !== 2 && value.length !== 3) || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    issues.push(issue(path, "Expected a finite WGS84 2D or 3D position."));
    return false;
  }
  const [longitude, latitude] = value as [number, number];
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) issues.push(issue(path, "WGS84 coordinates are outside their valid range."));
  return true;
}

function validClock(value: unknown, path: string, issues: ValidationIssue[], allow24 = false): value is string {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) {
    issues.push(issue(path, "Expected a local HH:mm clock value."));
    return false;
  }
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (minute > 59 || hour > (allow24 ? 24 : 23) || (hour === 24 && minute !== 0)) issues.push(issue(path, "Clock value is outside the valid local-time range."));
  return true;
}

function validateTruthField<T>(value: unknown, path: string, issues: ValidationIssue[], validateValue?: (value: unknown, path: string, issues: ValidationIssue[]) => void): value is TruthField<T> {
  if (!record(value)) {
    issues.push(issue(path, "A field truth envelope is required."));
    return false;
  }
  const status = value.status;
  if (!(["known", "unknown", "absent", "stale", "conflict"] as readonly string[]).includes(status as string)) issues.push(issue(`${path}.status`, "Unknown field truth status."));
  if (!Array.isArray(value.sourceRefIds) || value.sourceRefIds.some((item) => typeof item !== "string" || item.trim() === "")) issues.push(issue(`${path}.sourceRefIds`, "Source reference IDs must be strings."));
  if (!Array.isArray(value.observationIds) || value.observationIds.some((item) => typeof item !== "string" || item.trim() === "")) issues.push(issue(`${path}.observationIds`, "Observation IDs must be strings."));
  for (const field of ["observedAt", "publishedAt", "validFrom", "validTo"] as const) validIso(value[field], `${path}.${field}`, issues);
  if (typeof value.confidence !== "number" || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) issues.push(issue(`${path}.confidence`, "Confidence must be between 0 and 1."));
  if (typeof value.uncertainty !== "string") issues.push(issue(`${path}.uncertainty`, "Uncertainty must be explicit."));
  if ((status === "known" || status === "stale" || status === "conflict") && value.value === null) issues.push(issue(`${path}.value`, `${String(status)} fields must retain a value.`));
  if ((status === "known" || status === "stale" || status === "conflict") && (!Array.isArray(value.sourceRefIds) || value.sourceRefIds.length === 0)) issues.push(issue(`${path}.sourceRefIds`, `${String(status)} fields require source lineage.`));
  if ((status === "unknown" || status === "absent") && value.value !== null) issues.push(issue(`${path}.value`, `${String(status)} fields cannot assert a value.`));
  if (validateValue && value.value !== null) validateValue(value.value, `${path}.value`, issues);
  return true;
}

function validateHoursPeriod(value: unknown, path: string, issues: ValidationIssue[]): value is PlaceTruthHoursPeriod {
  if (!record(value)) {
    issues.push(issue(path, "Expected an hours period."));
    return false;
  }
  if (typeof value.day !== "number" || !Number.isInteger(value.day) || value.day < 0 || value.day > 6) issues.push(issue(`${path}.day`, "Day must be Monday=0 through Sunday=6."));
  validClock(value.opens, `${path}.opens`, issues);
  validClock(value.closes, `${path}.closes`, issues, true);
  return true;
}

function validateAddress(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!record(value)) {
    issues.push(issue(path, "Structured address is required."));
    return;
  }
  for (const field of ["formatted", "line1", "line2", "locality", "region", "postalCode", "countryCode"] as const) if (value[field] !== null && typeof value[field] !== "string") issues.push(issue(`${path}.${field}`, "Expected a string or null."));
}

function validateContact(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!record(value)) {
    issues.push(issue(path, "Contact fields are required."));
    return;
  }
  for (const field of ["website", "phone", "email"] as const) if (value[field] !== null && typeof value[field] !== "string") issues.push(issue(`${path}.${field}`, "Expected a string or null."));
}

function validateAccessibility(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!record(value)) {
    issues.push(issue(path, "Accessibility fields are required."));
    return;
  }
  for (const field of ["wheelchair", "entrance"] as const) if (!(["yes", "no", "limited", "unknown"] as readonly string[]).includes(value[field] as string)) issues.push(issue(`${path}.${field}`, "Unsupported accessibility state."));
  if (value.notes !== null && typeof value.notes !== "string") issues.push(issue(`${path}.notes`, "Expected a string or null."));
}

function validateFieldValue(field: string, value: unknown, path: string, issues: ValidationIssue[]): void {
  if (field === "address") validateAddress(value, path, issues);
  if (field === "contact") validateContact(value, path, issues);
  if (field === "accessibility") validateAccessibility(value, path, issues);
  if (["name", "brand", "operator", "priceLevel"].includes(field) && typeof value !== "string") issues.push(issue(path, "Expected a string."));
  if (["rating", "reviewCount", "popularity"].includes(field) && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) issues.push(issue(path, "Expected a finite non-negative number."));
  if (field === "businessStatus" && !( ["open", "closed", "temporarily-closed", "unknown"] as readonly string[]).includes(value as string)) issues.push(issue(path, "Unsupported business status."));
}

export function validatePlaceTruthRecord(value: unknown): ValidationResult<PlaceTruthRecord> {
  const issues: ValidationIssue[] = [];
  if (!record(value)) return { ok: false, issues: [issue("$", "Expected a PlaceTruthRecord.")] };
  if (value.schemaVersion !== PLACE_TRUTH_SCHEMA_VERSION) issues.push(issue("schemaVersion", "Unexpected place truth schema version."));
  for (const field of ["canonicalId", "cityId", "uncertainty"] as const) if (typeof value[field] !== "string" || value[field].trim() === "") issues.push(issue(field, "A non-empty string is required."));
  validPosition(value.coordinates, "coordinates", issues);
  if (typeof value.fixtureOnly !== "boolean") issues.push(issue("fixtureOnly", "Fixture state must be explicit."));
  if (typeof value.runtimeFeatureId !== "string" && value.runtimeFeatureId !== null) issues.push(issue("runtimeFeatureId", "Runtime feature ID must be a string or null."));
  if (!Array.isArray(value.categories) || value.categories.length === 0 || value.categories.some((category) => !isPlaceCategory(category))) issues.push(issue("categories", "At least one known provider-neutral category is required."));
  if (!Array.isArray(value.facets) || value.facets.some((facet) => typeof facet !== "string" || facet.trim() === "")) issues.push(issue("facets", "Facets must be non-empty strings."));
  if (!Array.isArray(value.localizedNames) || value.localizedNames.some((item) => !record(item) || typeof item.value !== "string" || item.value.trim() === "" || (item.language !== null && typeof item.language !== "string") || !Array.isArray(item.sourceRefIds) || item.sourceRefIds.some((sourceRefId) => typeof sourceRefId !== "string" || sourceRefId.trim() === ""))) issues.push(issue("localizedNames", "Localized names require a value, optional language, and source lineage."));
  if (!Array.isArray(value.aliases) || value.aliases.some((item) => !record(item) || typeof item.value !== "string" || item.value.trim() === "" || (item.language !== null && typeof item.language !== "string") || !Array.isArray(item.sourceRefIds) || item.sourceRefIds.some((sourceRefId) => typeof sourceRefId !== "string" || sourceRefId.trim() === ""))) issues.push(issue("aliases", "Aliases require a value, optional language, and source lineage."));
  for (const field of ["name", "address", "brand", "operator", "contact", "amenities", "accessibility", "imagery"] as const) validateTruthField(value[field], field, issues, (nested, path, nestedIssues) => validateFieldValue(field, nested, path, nestedIssues));
  if (!record(value.hours)) issues.push(issue("hours", "Hours are required even when unknown."));
  else {
    if (!["known", "unknown", "absent", "stale", "conflict"].includes(value.hours.status as string)) issues.push(issue("hours.status", "Unknown hours status."));
    if (value.hours.timezone !== null && typeof value.hours.timezone !== "string") issues.push(issue("hours.timezone", "Timezone must be an IANA name or null."));
    if (value.hours.raw !== null && typeof value.hours.raw !== "string") issues.push(issue("hours.raw", "Raw hours must be a string or null."));
    validateTruthField(value.hours.periods, "hours.periods", issues, (nested, path, nestedIssues) => {
      if (!Array.isArray(nested) || nested.some((period) => !validateHoursPeriod(period, path, nestedIssues))) nestedIssues.push(issue(path, "Hours periods must be an array of valid periods."));
    });
    validateTruthField(value.hours.specialDates, "hours.specialDates", issues, (nested, path, nestedIssues) => {
      if (!Array.isArray(nested)) nestedIssues.push(issue(path, "Special dates must be an array."));
      else nested.forEach((item, index) => {
        if (!record(item) || typeof item.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) nestedIssues.push(issue(`${path}[${index}].date`, "Special date must be YYYY-MM-DD."));
        if (!record(item) || !(["closed", "open"] as readonly string[]).includes(item.kind as string)) nestedIssues.push(issue(`${path}[${index}].kind`, "Special date kind must be closed or open."));
        if (record(item) && (!Array.isArray(item.periods) || item.periods.some((period) => !validateHoursPeriod(period, `${path}[${index}].periods`, nestedIssues)))) nestedIssues.push(issue(`${path}[${index}].periods`, "Special-date periods are invalid."));
      });
    });
    if (value.hours.status === "known" && (typeof value.hours.timezone !== "string" || !validTimezone(value.hours.timezone))) issues.push(issue("hours.timezone", "Known hours require a valid IANA timezone."));
  }
  if (!Array.isArray(value.entrances)) issues.push(issue("entrances", "Entrances must be an array."));
  else value.entrances.forEach((entrance, index) => {
    if (!record(entrance) || typeof entrance.id !== "string" || entrance.id.trim() === "") issues.push(issue(`entrances[${index}].id`, "Entrance ID is required."));
    if (record(entrance)) {
      validPosition(entrance.coordinates, `entrances[${index}].coordinates`, issues);
      validateTruthField(entrance.address, `entrances[${index}].address`, issues, (nested, path, nestedIssues) => validateAddress(nested, path, nestedIssues));
      validateTruthField(entrance.accessibility, `entrances[${index}].accessibility`, issues, (nested, path, nestedIssues) => validateAccessibility(nested, path, nestedIssues));
      if (!Array.isArray(entrance.sourceRefIds)) issues.push(issue(`entrances[${index}].sourceRefIds`, "Entrance lineage is required."));
    }
  });
  if (!record(value.commercial)) issues.push(issue("commercial", "Commercial fact envelopes are required even when absent."));
  else for (const field of ["priceLevel", "rating", "reviewCount", "popularity", "businessStatus"] as const) validateTruthField(value.commercial[field], `commercial.${field}`, issues, (nested, path, nestedIssues) => validateFieldValue(field, nested, path, nestedIssues));
  validIso(value.validFrom, "validFrom", issues);
  validIso(value.validTo, "validTo", issues);
  if (!record(value.freshness)) issues.push(issue("freshness", "Freshness is required."));
  if (!Array.isArray(value.sourceRefs) || value.sourceRefs.length === 0) issues.push(issue("sourceRefs", "At least one source reference is required."));
  if (!Array.isArray(value.sourceLicenses) || value.sourceLicenses.length === 0) issues.push(issue("sourceLicenses", "Per-source license records are required."));
  if (!Array.isArray(value.lineage)) issues.push(issue("lineage", "Field-level lineage is required."));
  if (!Array.isArray(value.conflicts)) issues.push(issue("conflicts", "Conflicts must be explicit, including an empty array."));
  if (record(value.imagery) && value.imagery.status === "known" && Array.isArray(value.imagery.value) && value.imagery.value.some((image) => !record(image) || typeof image.uri !== "string" || image.uri.startsWith("data:"))) issues.push(issue("imagery", "Imagery references must be attributable URLs or IDs; inline blobs are forbidden."));
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: value as unknown as PlaceTruthRecord };
}

function validTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

function clockMinutes(value: string): number {
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  return hour * 60 + minute;
}

function localParts(instant: Date, timezone: string): { date: string; day: number; minutes: number; time: string } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant);
    const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const day = weekdays.indexOf(values.weekday ?? "");
    if (day < 0 || !values.year || !values.month || !values.day || !values.hour || !values.minute) return null;
    return { date: `${values.year}-${values.month}-${values.day}`, day, minutes: Number(values.hour) * 60 + Number(values.minute), time: `${values.hour}:${values.minute}` };
  } catch {
    return null;
  }
}

function matchesPeriod(period: PlaceTruthHoursPeriod, day: number, minutes: number): boolean {
  const open = clockMinutes(period.opens);
  const close = clockMinutes(period.closes);
  if (open === close) return period.day === day;
  if (close > open) return period.day === day && minutes >= open && minutes < close;
  return (period.day === day && minutes >= open) || (period.day === (day + 6) % 7 && minutes < close);
}

export function evaluatePlaceHours(hours: PlaceTruthHours, instant: Date | string): HoursEvaluation {
  if (hours.status === "stale") return { status: "stale", localDate: null, localTime: null, explanation: "Hours are stale; a current open/closed claim is withheld.", matchedPeriod: null };
  if (hours.status !== "known" || hours.periods.status !== "known" || !hours.timezone || !validTimezone(hours.timezone) || !Array.isArray(hours.periods.value)) return { status: "unknown", localDate: null, localTime: null, explanation: "Opening hours are not known for this source release.", matchedPeriod: null };
  const date = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) return { status: "unknown", localDate: null, localTime: null, explanation: "The evaluation time is invalid.", matchedPeriod: null };
  const local = localParts(date, hours.timezone);
  if (!local) return { status: "unknown", localDate: null, localTime: null, explanation: "The source timezone could not be evaluated.", matchedPeriod: null };
  const special = hours.specialDates.status === "known" ? hours.specialDates.value?.find((entry) => entry.date === local.date) ?? null : null;
  if (special?.kind === "closed") return { status: "closed", localDate: local.date, localTime: local.time, explanation: special.note ?? "Closed by a dated special-hours observation.", matchedPeriod: null };
  const periods = special?.kind === "open" ? special.periods : hours.periods.value;
  const matchedPeriod = periods.find((period) => matchesPeriod(period, local.day, local.minutes)) ?? null;
  return matchedPeriod
    ? { status: "open", localDate: local.date, localTime: local.time, explanation: "Open according to the source schedule in its local timezone.", matchedPeriod }
    : { status: "closed", localDate: local.date, localTime: local.time, explanation: special?.note ?? "Closed according to the source schedule in its local timezone.", matchedPeriod: null };
}

export function placeTruthDisplayName(place: PlaceTruthRecord): string {
  return place.name.value ?? place.localizedNames[0]?.value ?? "Unnamed place";
}

export function placeTruthCategoryLabel(category: PlaceCategory): string {
  return category.split("-").map((word) => word.slice(0, 1).toLocaleUpperCase() + word.slice(1)).join(" ");
}

export const PLACE_TRUTH_CATEGORIES = PLACE_CATEGORIES;
