/**
 * Stable domain contracts shared by source adapters, offline ingestion, search,
 * and the detail panel.  Runtime parsing is intentionally dependency-free so
 * the browser and the local fixture harness use the same checks.
 */

export const DOMAIN_SCHEMA_VERSION = "1.0" as const;

export type ApprovalState = "pending" | "approved" | "rejected";
export type ApprovalScope = "test-only" | "ingestion" | "runtime";
export type LicenseClass =
  | "nyc-open-data-terms"
  | "odbl-1.0"
  | "cdla-permissive-2.0"
  | "apache-2.0"
  | "cc0-1.0"
  | "cc-by-sa-4.0"
  | "cc-by-sa-3.0"
  | "nyc-publication-facts"
  | "public-domain"
  | "provider-terms"
  | "fixture-only"
  | "unknown";

export type CoordinateReferenceSystem = "EPSG:4326" | "EPSG:3857";
export const WGS84_CRS = "EPSG:4326" as const;

export type FeatureKind =
  | "building"
  | "parcel"
  | "street"
  | "park"
  | "landmark"
  | "facility"
  | "poi"
  | "transit-stop"
  | "transit-station"
  | "transit-entrance"
  | "transit-route"
  | "neighborhood"
  | "area"
  | "fixture-point";

export type ProvenanceKind = "authoritative" | "derived" | "generated";
export type SourceRole = "primary" | "enrichment" | "derived" | "fixture";

export interface RetentionPolicy {
  rawSnapshots: "allowed" | "conditional" | "not-permitted" | "unknown";
  maximumDays: number | null;
  caching: "allowed" | "restricted" | "not-permitted" | "unknown";
  constraints: string;
}

export interface DerivativePolicy {
  allowed: "yes" | "conditional" | "no" | "unknown";
  constraints: string;
}

export interface AccessRequirement {
  keyOrAgreementRequired: boolean;
  kind: "none" | "api-key" | "account" | "data-agreement" | "legal-review";
  constraints: string;
}

export interface LicenseRef {
  schemaVersion: typeof DOMAIN_SCHEMA_VERSION;
  id: string;
  licenseClass: LicenseClass;
  termsUrl: string;
  attribution: string;
  derivativePolicy: DerivativePolicy;
  retention: RetentionPolicy;
}

export interface SourceRegistryEntry {
  schemaVersion: typeof DOMAIN_SCHEMA_VERSION;
  id: string;
  provider: string;
  datasetId: string;
  canonicalUrl: string;
  termsUrl: string;
  licenseClass: LicenseClass;
  attribution: string;
  releaseTimestamp: string | null;
  captureTimestamp: string | null;
  updateTimestamp: string | null;
  cadence: string;
  retention: RetentionPolicy;
  derivativePolicy: DerivativePolicy;
  access: AccessRequirement;
  geographicScope: string;
  expectedCrs: CoordinateReferenceSystem | "varies" | "unknown";
  expectedVerticalDatum: string;
  approval: {
    state: ApprovalState;
    scope: ApprovalScope;
    reviewedAt: string;
    note: string;
  };
}

export interface SourceRef {
  schemaVersion: typeof DOMAIN_SCHEMA_VERSION;
  id: string;
  registryEntryId: string;
  provider: string;
  datasetId: string;
  sourceRecordId: string;
  sourceUrl: string;
  licenseRefId: string;
  role: SourceRole;
  capturedAt: string | null;
  updatedAt: string | null;
  observedAt: string | null;
  release: string | null;
}

export interface HeightProvenance {
  schemaVersion: typeof DOMAIN_SCHEMA_VERSION;
  valueMeters: number | null;
  /** Raw source measurement retained when a provider publishes a unit-bearing value. */
  sourceValue?: number | null;
  sourceUnit?: "feet" | "meters" | "unknown";
  verticalDatum: string;
  sourceRefId: string | null;
  method: "source" | "derived" | "unknown";
  uncertaintyMeters: number | null;
}

export interface GeometryProvenance {
  schemaVersion: typeof DOMAIN_SCHEMA_VERSION;
  sourceRefId: string;
  inputCrs: CoordinateReferenceSystem;
  outputCrs: typeof WGS84_CRS;
  capturedAt: string | null;
  height: HeightProvenance;
  horizontalUncertaintyMeters: number | null;
  notes: string;
}

export interface Confidence {
  score: number;
  label: "high" | "medium" | "low" | "unknown";
  rationale: string;
}

export interface Uncertainty {
  horizontalMeters: number | null;
  verticalMeters: number | null;
  temporalDays: number | null;
  notes: string;
}

export interface Freshness {
  capturedAt: string | null;
  updatedAt: string | null;
  observedAt: string | null;
  ingestedAt: string;
}

export type Position = [number, number] | [number, number, number];

export interface PointGeometry {
  type: "Point";
  coordinates: Position;
}

export interface LineStringGeometry {
  type: "LineString";
  coordinates: Position[];
}

export interface MultiLineStringGeometry {
  type: "MultiLineString";
  coordinates: Position[][];
}

export interface PolygonGeometry {
  type: "Polygon";
  coordinates: Position[][];
}

export interface MultiPolygonGeometry {
  type: "MultiPolygon";
  coordinates: Position[][][];
}

export type Geometry = PointGeometry | LineStringGeometry | MultiLineStringGeometry | PolygonGeometry | MultiPolygonGeometry;

export interface Feature {
  schemaVersion: typeof DOMAIN_SCHEMA_VERSION;
  id: string;
  cityId: string;
  kind: FeatureKind;
  name: string;
  geometry: Geometry;
  coordinates: Position;
  geometryProvenance: GeometryProvenance;
  sourceRefs: SourceRef[];
  provenance: ProvenanceKind;
  confidence: Confidence;
  uncertainty: Uncertainty;
  freshness: Freshness;
  attributes: Record<string, string | number | boolean | null>;
}

export interface FeatureLink {
  schemaVersion: typeof DOMAIN_SCHEMA_VERSION;
  fromFeatureId: string;
  toFeatureId: string;
  relationship: "located-on" | "contains" | "overlaps" | "same-as" | "enriched-by";
  method: "source-id" | "spatial" | "manual" | "inferred";
  confidence: Confidence;
  sourceRefIds: string[];
}

export interface FeatureAlias {
  schemaVersion: typeof DOMAIN_SCHEMA_VERSION;
  featureId: string;
  alias: string;
  language: string | null;
  sourceRefIds: string[];
}

export interface FeatureTombstone {
  schemaVersion: typeof DOMAIN_SCHEMA_VERSION;
  featureId: string;
  reason: "source-removed" | "merged" | "invalid" | "superseded";
  effectiveAt: string;
  replacementFeatureId: string | null;
  sourceRefIds: string[];
}

export interface CityAdapter {
  schemaVersion: typeof DOMAIN_SCHEMA_VERSION;
  id: string;
  cityId: string;
  displayName: string;
  purpose: string;
  boundary: PolygonGeometry;
  boundaryProvenance: {
    source: string;
    sourceUrl: string;
    capturedAt: string;
    notes: string;
  };
  defaultInputCrs: CoordinateReferenceSystem;
  outputCrs: typeof WGS84_CRS;
  verticalDatum: string;
  sourceRegistryEntryIds: string[];
  supportedFeatureKinds: FeatureKind[];
}

export interface IngestionRun {
  schemaVersion: typeof DOMAIN_SCHEMA_VERSION;
  runId: string;
  adapterId: string;
  sourceRegistryEntryId: string;
  inputFileName: string;
  inputChecksumSha256: string;
  startedAt: string;
  finishedAt: string;
  immutable: true;
  acceptedCount: number;
  rejectedCount: number;
  sourceRecordCount: number;
}

export interface Rejection {
  index: number;
  sourceId: string | null;
  code: "parse-error" | "schema-invalid" | "geometry-invalid" | "unsupported-crs" | "outside-slice";
  path: string;
  message: string;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, path: string, issues: ValidationIssue[]): value is string {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push({ path, message: "Expected a non-empty string." });
    return false;
  }
  return true;
}

function schemaVersionField(value: unknown, path: string, issues: ValidationIssue[]): value is typeof DOMAIN_SCHEMA_VERSION {
  if (value !== DOMAIN_SCHEMA_VERSION) {
    issues.push({ path, message: `Expected schema version ${DOMAIN_SCHEMA_VERSION}.` });
    return false;
  }
  return true;
}

function nullableStringField(value: unknown, path: string, issues: ValidationIssue[]): value is string | null {
  if (value !== null && typeof value !== "string") {
    issues.push({ path, message: "Expected a string or null." });
    return false;
  }
  return true;
}

function finiteField(value: unknown, path: string, issues: ValidationIssue[]): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push({ path, message: "Expected a finite number." });
    return false;
  }
  return true;
}

function isoField(value: unknown, path: string, issues: ValidationIssue[], nullable = true): value is string | null {
  if (value === null && nullable) {
    return true;
  }
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    issues.push({ path, message: "Expected an ISO-8601 timestamp or null." });
    return false;
  }
  return true;
}

function validatePosition(value: unknown, path: string, issues: ValidationIssue[], crs: CoordinateReferenceSystem): value is Position {
  if (!Array.isArray(value) || (value.length !== 2 && value.length !== 3)) {
    issues.push({ path, message: "Expected a 2D or 3D coordinate position." });
    return false;
  }
  value.forEach((coordinate, index) => finiteField(coordinate, `${path}[${index}]`, issues));
  if (issues.some((issue) => issue.path.startsWith(path))) {
    return false;
  }
  const [x, y] = value as [number, number];
  if (crs === "EPSG:4326" && (x < -180 || x > 180 || y < -90 || y > 90)) {
    issues.push({ path, message: "WGS84 longitude/latitude is outside its valid range." });
    return false;
  }
  if (crs === "EPSG:3857" && (Math.abs(x) > 20_037_508.342789244 || Math.abs(y) > 20_037_508.342789244)) {
    issues.push({ path, message: "Web Mercator coordinate is outside its valid range." });
    return false;
  }
  return true;
}

function parseGeometry(value: unknown, path: string, crs: CoordinateReferenceSystem): ValidationResult<Geometry> {
  const issues: ValidationIssue[] = [];
  if (!record(value) || typeof value.type !== "string") {
    return { ok: false, issues: [{ path, message: "Expected a GeoJSON-like geometry object." }] };
  }
  if (value.type === "Point") {
    if (!validatePosition(value.coordinates, `${path}.coordinates`, issues, crs)) {
      return { ok: false, issues };
    }
    return { ok: true, value: { type: "Point", coordinates: value.coordinates } };
  }
  if (value.type === "LineString") {
    if (!Array.isArray(value.coordinates) || value.coordinates.length < 2) {
      return { ok: false, issues: [{ path: `${path}.coordinates`, message: "A LineString needs at least two positions." }] };
    }
    value.coordinates.forEach((position, index) => validatePosition(position, `${path}.coordinates[${index}]`, issues, crs));
    return issues.length > 0
      ? { ok: false, issues }
      : { ok: true, value: { type: "LineString", coordinates: value.coordinates as Position[] } };
  }
  if (value.type === "MultiLineString") {
    if (!Array.isArray(value.coordinates) || value.coordinates.length === 0) {
      return { ok: false, issues: [{ path: `${path}.coordinates`, message: "A MultiLineString needs at least one line." }] };
    }
    value.coordinates.forEach((line, lineIndex) => {
      if (!Array.isArray(line) || line.length < 2) {
        issues.push({ path: `${path}.coordinates[${lineIndex}]`, message: "A MultiLineString member needs at least two positions." });
        return;
      }
      line.forEach((position, positionIndex) => validatePosition(position, `${path}.coordinates[${lineIndex}][${positionIndex}]`, issues, crs));
    });
    return issues.length > 0
      ? { ok: false, issues }
      : { ok: true, value: { type: "MultiLineString", coordinates: value.coordinates as Position[][] } };
  }
  if (value.type === "Polygon") {
    if (!Array.isArray(value.coordinates) || value.coordinates.length === 0) {
      return { ok: false, issues: [{ path: `${path}.coordinates`, message: "A Polygon needs at least one ring." }] };
    }
    value.coordinates.forEach((ring, ringIndex) => {
      if (!Array.isArray(ring) || ring.length < 4) {
        issues.push({ path: `${path}.coordinates[${ringIndex}]`, message: "A polygon ring needs at least four positions." });
        return;
      }
      ring.forEach((position, positionIndex) => validatePosition(position, `${path}.coordinates[${ringIndex}][${positionIndex}]`, issues, crs));
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (Array.isArray(first) && Array.isArray(last) && (first[0] !== last[0] || first[1] !== last[1])) {
        issues.push({ path: `${path}.coordinates[${ringIndex}]`, message: "A polygon ring must be closed." });
      }
    });
    return issues.length > 0
      ? { ok: false, issues }
      : { ok: true, value: { type: "Polygon", coordinates: value.coordinates as Position[][] } };
  }
  if (value.type === "MultiPolygon") {
    if (!Array.isArray(value.coordinates) || value.coordinates.length === 0) {
      return { ok: false, issues: [{ path: `${path}.coordinates`, message: "A MultiPolygon needs at least one polygon." }] };
    }
    value.coordinates.forEach((polygon, polygonIndex) => {
      if (!Array.isArray(polygon) || polygon.length === 0) {
        issues.push({ path: `${path}.coordinates[${polygonIndex}]`, message: "A MultiPolygon member needs at least one ring." });
        return;
      }
      polygon.forEach((ring, ringIndex) => {
        if (!Array.isArray(ring) || ring.length < 4) {
          issues.push({ path: `${path}.coordinates[${polygonIndex}][${ringIndex}]`, message: "A polygon ring needs at least four positions." });
          return;
        }
        ring.forEach((position, positionIndex) => validatePosition(position, `${path}.coordinates[${polygonIndex}][${ringIndex}][${positionIndex}]`, issues, crs));
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (Array.isArray(first) && Array.isArray(last) && (first[0] !== last[0] || first[1] !== last[1])) {
          issues.push({ path: `${path}.coordinates[${polygonIndex}][${ringIndex}]`, message: "A polygon ring must be closed." });
        }
      });
    });
    return issues.length > 0
      ? { ok: false, issues }
      : { ok: true, value: { type: "MultiPolygon", coordinates: value.coordinates as Position[][][] } };
  }
  return { ok: false, issues: [{ path: `${path}.type`, message: `Unsupported geometry type: ${value.type}.` }] };
}

export function validateCityAdapter(value: unknown): ValidationResult<CityAdapter> {
  const issues: ValidationIssue[] = [];
  if (!record(value)) {
    return { ok: false, issues: [{ path: "$", message: "Expected a CityAdapter object." }] };
  }
  schemaVersionField(value.schemaVersion, "schemaVersion", issues);
  stringField(value.id, "id", issues);
  stringField(value.cityId, "cityId", issues);
  stringField(value.displayName, "displayName", issues);
  stringField(value.purpose, "purpose", issues);
  const boundary = parseGeometry(value.boundary, "boundary", "EPSG:4326");
  if (!boundary.ok || boundary.value.type !== "Polygon") {
    issues.push(...(boundary.ok ? [{ path: "boundary", message: "CityAdapter boundary must be a Polygon." }] : boundary.issues));
  }
  if (!record(value.boundaryProvenance)) {
    issues.push({ path: "boundaryProvenance", message: "Boundary provenance is required." });
  } else {
    stringField(value.boundaryProvenance.source, "boundaryProvenance.source", issues);
    stringField(value.boundaryProvenance.sourceUrl, "boundaryProvenance.sourceUrl", issues);
    isoField(value.boundaryProvenance.capturedAt, "boundaryProvenance.capturedAt", issues, false);
    stringField(value.boundaryProvenance.notes, "boundaryProvenance.notes", issues);
  }
  if (value.defaultInputCrs !== "EPSG:4326" && value.defaultInputCrs !== "EPSG:3857") {
    issues.push({ path: "defaultInputCrs", message: "Unsupported input CRS." });
  }
  if (value.outputCrs !== WGS84_CRS) {
    issues.push({ path: "outputCrs", message: "CityAdapter output CRS must be EPSG:4326." });
  }
  stringField(value.verticalDatum, "verticalDatum", issues);
  if (!Array.isArray(value.sourceRegistryEntryIds) || value.sourceRegistryEntryIds.some((item) => typeof item !== "string")) {
    issues.push({ path: "sourceRegistryEntryIds", message: "Expected source registry IDs." });
  }
  if (!Array.isArray(value.supportedFeatureKinds) || value.supportedFeatureKinds.some((item) => typeof item !== "string")) {
    issues.push({ path: "supportedFeatureKinds", message: "Expected supported feature kinds." });
  }
  if (issues.length > 0 || !boundary.ok || boundary.value.type !== "Polygon") {
    return { ok: false, issues };
  }
  return { ok: true, value: value as unknown as CityAdapter };
}

export function validateSourceRef(value: unknown): ValidationResult<SourceRef> {
  const issues: ValidationIssue[] = [];
  if (!record(value)) return { ok: false, issues: [{ path: "$", message: "Expected a SourceRef object." }] };
  schemaVersionField(value.schemaVersion, "schemaVersion", issues);
  stringField(value.id, "id", issues);
  stringField(value.registryEntryId, "registryEntryId", issues);
  stringField(value.provider, "provider", issues);
  stringField(value.datasetId, "datasetId", issues);
  stringField(value.sourceRecordId, "sourceRecordId", issues);
  stringField(value.sourceUrl, "sourceUrl", issues);
  stringField(value.licenseRefId, "licenseRefId", issues);
  if (!["primary", "enrichment", "derived", "fixture"].includes(String(value.role))) issues.push({ path: "role", message: "Unsupported source role." });
  nullableStringField(value.capturedAt, "capturedAt", issues);
  nullableStringField(value.updatedAt, "updatedAt", issues);
  nullableStringField(value.observedAt, "observedAt", issues);
  nullableStringField(value.release, "release", issues);
  ["capturedAt", "updatedAt", "observedAt"].forEach((field) => isoField(value[field], field, issues));
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: value as unknown as SourceRef };
}

export function validateConfidence(value: unknown): ValidationResult<Confidence> {
  const issues: ValidationIssue[] = [];
  if (!record(value)) return { ok: false, issues: [{ path: "$", message: "Expected a Confidence object." }] };
  if (!finiteField(value.score, "score", issues) || value.score < 0 || value.score > 1) issues.push({ path: "score", message: "Confidence score must be between 0 and 1." });
  if (!["high", "medium", "low", "unknown"].includes(String(value.label))) issues.push({ path: "label", message: "Unsupported confidence label." });
  stringField(value.rationale, "rationale", issues);
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: value as unknown as Confidence };
}

export function validateUncertainty(value: unknown): ValidationResult<Uncertainty> {
  const issues: ValidationIssue[] = [];
  if (!record(value)) return { ok: false, issues: [{ path: "$", message: "Expected an Uncertainty object." }] };
  ["horizontalMeters", "verticalMeters", "temporalDays"].forEach((field) => {
    const fieldValue = value[field];
    if (fieldValue !== null && (!finiteField(fieldValue, field, issues) || fieldValue < 0)) issues.push({ path: field, message: "Uncertainty must be a non-negative number or null." });
  });
  stringField(value.notes, "notes", issues);
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: value as unknown as Uncertainty };
}

export function validateHeightProvenance(value: unknown): ValidationResult<HeightProvenance> {
  const issues: ValidationIssue[] = [];
  if (!record(value)) return { ok: false, issues: [{ path: "$", message: "Expected HeightProvenance." }] };
  schemaVersionField(value.schemaVersion, "schemaVersion", issues);
  if (value.valueMeters !== null && !finiteField(value.valueMeters, "valueMeters", issues)) issues.push({ path: "valueMeters", message: "Height must be a finite number or null." });
  if (value.sourceValue !== undefined && value.sourceValue !== null && !finiteField(value.sourceValue, "sourceValue", issues)) issues.push({ path: "sourceValue", message: "Source height must be a finite number or null." });
  if (value.sourceUnit !== undefined && !["feet", "meters", "unknown"].includes(String(value.sourceUnit))) issues.push({ path: "sourceUnit", message: "Unsupported source height unit." });
  stringField(value.verticalDatum, "verticalDatum", issues);
  nullableStringField(value.sourceRefId, "sourceRefId", issues);
  if (!["source", "derived", "unknown"].includes(String(value.method))) issues.push({ path: "method", message: "Unsupported height provenance method." });
  if (value.uncertaintyMeters !== null && (!finiteField(value.uncertaintyMeters, "uncertaintyMeters", issues) || value.uncertaintyMeters < 0)) issues.push({ path: "uncertaintyMeters", message: "Height uncertainty must be a non-negative number or null." });
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: value as unknown as HeightProvenance };
}

export function validateGeometryProvenance(value: unknown): ValidationResult<GeometryProvenance> {
  const issues: ValidationIssue[] = [];
  if (!record(value)) return { ok: false, issues: [{ path: "$", message: "Expected GeometryProvenance." }] };
  schemaVersionField(value.schemaVersion, "schemaVersion", issues);
  stringField(value.sourceRefId, "sourceRefId", issues);
  if (value.inputCrs !== "EPSG:4326" && value.inputCrs !== "EPSG:3857") issues.push({ path: "inputCrs", message: "Unsupported input CRS." });
  if (value.outputCrs !== WGS84_CRS) issues.push({ path: "outputCrs", message: "Geometry output CRS must be EPSG:4326." });
  isoField(value.capturedAt, "capturedAt", issues);
  const height = validateHeightProvenance(value.height);
  if (!height.ok) height.issues.forEach((item) => issues.push({ path: `height.${item.path}`, message: item.message }));
  if (value.horizontalUncertaintyMeters !== null && (!finiteField(value.horizontalUncertaintyMeters, "horizontalUncertaintyMeters", issues) || value.horizontalUncertaintyMeters < 0)) issues.push({ path: "horizontalUncertaintyMeters", message: "Horizontal uncertainty must be a non-negative number or null." });
  stringField(value.notes, "notes", issues);
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: value as unknown as GeometryProvenance };
}

export function validateFeature(value: unknown): ValidationResult<Feature> {
  const issues: ValidationIssue[] = [];
  if (!record(value)) return { ok: false, issues: [{ path: "$", message: "Expected a Feature object." }] };
  schemaVersionField(value.schemaVersion, "schemaVersion", issues);
  stringField(value.id, "id", issues);
  stringField(value.cityId, "cityId", issues);
  if (!stringField(value.kind, "kind", issues) || !["building", "parcel", "street", "park", "landmark", "facility", "poi", "transit-stop", "transit-station", "transit-entrance", "transit-route", "neighborhood", "area", "fixture-point"].includes(value.kind)) issues.push({ path: "kind", message: "Unsupported feature kind." });
  stringField(value.name, "name", issues);
  const geometry = parseGeometry(value.geometry, "geometry", "EPSG:4326");
  if (!geometry.ok) issues.push(...geometry.issues);
  if (!validatePosition(value.coordinates, "coordinates", issues, "EPSG:4326")) {
    // Position issues are already recorded.
  }
  const geometryProvenance = validateGeometryProvenance(value.geometryProvenance);
  if (!geometryProvenance.ok) geometryProvenance.issues.forEach((item) => issues.push({ path: `geometryProvenance.${item.path}`, message: item.message }));
  if (!Array.isArray(value.sourceRefs)) issues.push({ path: "sourceRefs", message: "At least one source reference is required." });
  else value.sourceRefs.forEach((sourceRef, index) => {
    const result = validateSourceRef(sourceRef);
    if (!result.ok) result.issues.forEach((issue) => issues.push({ path: `sourceRefs[${index}].${issue.path}`, message: issue.message }));
  });
  if (!["authoritative", "derived", "generated"].includes(String(value.provenance))) issues.push({ path: "provenance", message: "Unsupported provenance kind." });
  const confidence = validateConfidence(value.confidence);
  if (!confidence.ok) confidence.issues.forEach((item) => issues.push({ path: `confidence.${item.path}`, message: item.message }));
  const uncertainty = validateUncertainty(value.uncertainty);
  if (!uncertainty.ok) uncertainty.issues.forEach((item) => issues.push({ path: `uncertainty.${item.path}`, message: item.message }));
  if (!record(value.freshness)) issues.push({ path: "freshness", message: "Freshness is required." });
  else {
    const freshness = value.freshness;
    ["capturedAt", "updatedAt", "observedAt"].forEach((field) => isoField(freshness[field], `freshness.${field}`, issues));
    isoField(freshness.ingestedAt, "freshness.ingestedAt", issues, false);
  }
  if (!record(value.attributes)) issues.push({ path: "attributes", message: "Attributes must be an object." });
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: value as unknown as Feature };
}

export function validateLicenseRef(value: unknown): ValidationResult<LicenseRef> {
  const issues: ValidationIssue[] = [];
  if (!record(value)) return { ok: false, issues: [{ path: "$", message: "Expected a LicenseRef object." }] };
  schemaVersionField(value.schemaVersion, "schemaVersion", issues);
  stringField(value.id, "id", issues);
  stringField(value.licenseClass, "licenseClass", issues);
  stringField(value.termsUrl, "termsUrl", issues);
  stringField(value.attribution, "attribution", issues);
  if (!record(value.derivativePolicy)) issues.push({ path: "derivativePolicy", message: "Derivative policy is required." });
  if (!record(value.retention)) issues.push({ path: "retention", message: "Retention policy is required." });
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: value as unknown as LicenseRef };
}

export function validateFeatureLink(value: unknown): ValidationResult<FeatureLink> {
  const issues: ValidationIssue[] = [];
  if (!record(value)) return { ok: false, issues: [{ path: "$", message: "Expected a FeatureLink object." }] };
  schemaVersionField(value.schemaVersion, "schemaVersion", issues);
  stringField(value.fromFeatureId, "fromFeatureId", issues);
  stringField(value.toFeatureId, "toFeatureId", issues);
  stringField(value.relationship, "relationship", issues);
  stringField(value.method, "method", issues);
  if (!record(value.confidence)) issues.push({ path: "confidence", message: "Link confidence is required." });
  if (!Array.isArray(value.sourceRefIds)) issues.push({ path: "sourceRefIds", message: "Link source references are required." });
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: value as unknown as FeatureLink };
}

export function validateAlias(value: unknown): ValidationResult<FeatureAlias> {
  const issues: ValidationIssue[] = [];
  if (!record(value)) return { ok: false, issues: [{ path: "$", message: "Expected a FeatureAlias object." }] };
  schemaVersionField(value.schemaVersion, "schemaVersion", issues);
  stringField(value.featureId, "featureId", issues);
  stringField(value.alias, "alias", issues);
  nullableStringField(value.language, "language", issues);
  if (!Array.isArray(value.sourceRefIds)) issues.push({ path: "sourceRefIds", message: "Alias source references are required." });
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: value as unknown as FeatureAlias };
}

export function validateTombstone(value: unknown): ValidationResult<FeatureTombstone> {
  const issues: ValidationIssue[] = [];
  if (!record(value)) return { ok: false, issues: [{ path: "$", message: "Expected a FeatureTombstone object." }] };
  schemaVersionField(value.schemaVersion, "schemaVersion", issues);
  stringField(value.featureId, "featureId", issues);
  stringField(value.reason, "reason", issues);
  isoField(value.effectiveAt, "effectiveAt", issues, false);
  nullableStringField(value.replacementFeatureId, "replacementFeatureId", issues);
  if (!Array.isArray(value.sourceRefIds)) issues.push({ path: "sourceRefIds", message: "Tombstone source references are required." });
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: value as unknown as FeatureTombstone };
}

export function validateIngestionRun(value: unknown): ValidationResult<IngestionRun> {
  const issues: ValidationIssue[] = [];
  if (!record(value)) return { ok: false, issues: [{ path: "$", message: "Expected an IngestionRun object." }] };
  schemaVersionField(value.schemaVersion, "schemaVersion", issues);
  stringField(value.runId, "runId", issues);
  stringField(value.adapterId, "adapterId", issues);
  stringField(value.sourceRegistryEntryId, "sourceRegistryEntryId", issues);
  stringField(value.inputFileName, "inputFileName", issues);
  stringField(value.inputChecksumSha256, "inputChecksumSha256", issues);
  ["startedAt", "finishedAt"].forEach((field) => isoField(value[field], field, issues, false));
  if (value.immutable !== true) issues.push({ path: "immutable", message: "Ingestion manifests must be immutable." });
  ["acceptedCount", "rejectedCount", "sourceRecordCount"].forEach((field) => finiteField(value[field], field, issues));
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: value as unknown as IngestionRun };
}
