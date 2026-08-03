import { getSourceRegistryEntry } from "../data/source-registry.ts";
import type {
  CityAdapter,
  Confidence,
  Feature,
  FeatureKind,
  Geometry,
  GeometryProvenance,
  IngestionRun,
  Position,
  Rejection,
  SourceRef,
  Uncertainty,
  ValidationIssue,
} from "../domain/schema.ts";
import {
  DOMAIN_SCHEMA_VERSION,
  validateCityAdapter,
  validateFeature,
  validateIngestionRun,
} from "../domain/schema.ts";

export interface FixtureEnvelope {
  schemaVersion: typeof DOMAIN_SCHEMA_VERSION;
  fixtureId: string;
  purpose: string;
  sourceRegistryId: string;
  inputCrs: "EPSG:4326" | "EPSG:3857";
  verticalDatum: string;
  features: unknown[];
}

export interface RawFixtureFeature {
  sourceId: string;
  kind: FeatureKind;
  name: string;
  geometry: unknown;
  heightMeters?: number | null;
  capturedAt?: string | null;
  updatedAt?: string | null;
  observedAt?: string | null;
  horizontalUncertaintyMeters?: number | null;
  verticalUncertaintyMeters?: number | null;
  confidence?: Partial<Confidence>;
  attributes?: Record<string, string | number | boolean | null>;
}

export interface IngestionManifest extends IngestionRun {
  manifestVersion: typeof DOMAIN_SCHEMA_VERSION;
  fixtureId: string;
  adapterPurpose: string;
  outputCrs: "EPSG:4326";
  rejectionAccounting: {
    allInputRecordsAccountedFor: boolean;
    rejectedRecordIndices: number[];
    rejected: Rejection[];
  };
  acceptedFeatureIds: string[];
}

export interface OfflineIngestionResult {
  adapter: CityAdapter;
  features: Feature[];
  manifest: IngestionManifest;
  manifestJson: string;
}

export interface OfflineIngestionOptions {
  adapter: CityAdapter;
  inputFileName: string;
  runId: string;
  startedAt: string;
  finishedAt: string;
  ingestedAt: string;
  requireApprovedSource?: boolean;
}

const MAX_MERCATOR = 20_037_508.342789244;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function stableSerialize(value: unknown): string {
  return stableJson(value);
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function issue(path: string, message: string): ValidationIssue {
  return { path, message };
}

function validateFixtureEnvelope(value: unknown): { envelope?: FixtureEnvelope; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return { issues: [issue("$", "Expected a fixture envelope object.")] };
  if (value.schemaVersion !== DOMAIN_SCHEMA_VERSION) issues.push(issue("schemaVersion", `Expected ${DOMAIN_SCHEMA_VERSION}.`));
  if (!isNonEmptyString(value.fixtureId)) issues.push(issue("fixtureId", "Expected a fixture ID."));
  if (!isNonEmptyString(value.purpose)) issues.push(issue("purpose", "Expected a fixture purpose."));
  if (!isNonEmptyString(value.sourceRegistryId)) issues.push(issue("sourceRegistryId", "Expected a source registry entry ID."));
  if (value.inputCrs !== "EPSG:4326" && value.inputCrs !== "EPSG:3857") issues.push(issue("inputCrs", "Expected EPSG:4326 or EPSG:3857."));
  if (!isNonEmptyString(value.verticalDatum)) issues.push(issue("verticalDatum", "Expected a vertical datum label."));
  if (!Array.isArray(value.features)) issues.push(issue("features", "Expected a feature array."));
  if (issues.length > 0) return { issues };
  return { envelope: value as unknown as FixtureEnvelope, issues };
}

function validateRawFeature(value: unknown, index: number): { feature?: RawFixtureFeature; issues: ValidationIssue[] } {
  const path = `features[${index}]`;
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return { issues: [issue(path, "Expected a feature object.")] };
  if (!isNonEmptyString(value.sourceId)) issues.push(issue(`${path}.sourceId`, "Expected a stable source ID."));
  if (!isNonEmptyString(value.kind)) issues.push(issue(`${path}.kind`, "Expected a feature kind."));
  if (!isNonEmptyString(value.name)) issues.push(issue(`${path}.name`, "Expected a feature name."));
  if (!isRecord(value.geometry)) issues.push(issue(`${path}.geometry`, "Expected a geometry object."));
  if (value.heightMeters !== undefined && value.heightMeters !== null && (typeof value.heightMeters !== "number" || !Number.isFinite(value.heightMeters))) issues.push(issue(`${path}.heightMeters`, "Expected a finite height or null."));
  for (const field of ["capturedAt", "updatedAt", "observedAt"] as const) {
    const timestamp = value[field];
    if (timestamp !== undefined && timestamp !== null && (typeof timestamp !== "string" || Number.isNaN(Date.parse(timestamp)))) issues.push(issue(`${path}.${field}`, "Expected an ISO timestamp or null."));
  }
  for (const field of ["horizontalUncertaintyMeters", "verticalUncertaintyMeters"] as const) {
    const uncertainty = value[field];
    if (uncertainty !== undefined && uncertainty !== null && (typeof uncertainty !== "number" || !Number.isFinite(uncertainty) || uncertainty < 0)) issues.push(issue(`${path}.${field}`, "Expected a non-negative uncertainty or null."));
  }
  if (value.attributes !== undefined && !isRecord(value.attributes)) issues.push(issue(`${path}.attributes`, "Expected a flat attributes object."));
  if (issues.length > 0) return { issues };
  return { feature: value as unknown as RawFixtureFeature, issues };
}

function normalizePosition(position: Position, inputCrs: "EPSG:4326" | "EPSG:3857"): Position {
  if (inputCrs === "EPSG:4326") return [...position] as Position;
  const [x, y, z] = position;
  const longitude = (x / MAX_MERCATOR) * 180;
  const latitude = (Math.atan(Math.sinh((y / MAX_MERCATOR) * Math.PI)) * 180) / Math.PI;
  return z === undefined ? [longitude, latitude] : [longitude, latitude, z];
}

function normalizeGeometry(geometry: Geometry, inputCrs: "EPSG:4326" | "EPSG:3857"): Geometry {
  if (geometry.type === "Point") return { type: "Point", coordinates: normalizePosition(geometry.coordinates, inputCrs) };
  if (geometry.type === "LineString") return { type: "LineString", coordinates: geometry.coordinates.map((position) => normalizePosition(position, inputCrs)) };
  if (geometry.type === "MultiLineString") return { type: "MultiLineString", coordinates: geometry.coordinates.map((line) => line.map((position) => normalizePosition(position, inputCrs))) };
  if (geometry.type === "Polygon") return { type: "Polygon", coordinates: geometry.coordinates.map((ring) => ring.map((position) => normalizePosition(position, inputCrs))) };
  return { type: "MultiPolygon", coordinates: geometry.coordinates.map((polygon) => polygon.map((ring) => ring.map((position) => normalizePosition(position, inputCrs)))) };
}

function centroid(geometry: Geometry): Position {
  if (geometry.type === "Point") return geometry.coordinates;
  const positions = geometry.type === "LineString"
    ? geometry.coordinates
    : geometry.type === "Polygon"
      ? geometry.coordinates[0] ?? []
      : geometry.type === "MultiLineString"
        ? geometry.coordinates.flatMap((line) => line)
        : geometry.coordinates.flatMap((polygon) => polygon[0] ?? []);
  if (positions.length === 0) return [0, 0];
  const [longitude, latitude] = positions.reduce(([sumLongitude, sumLatitude], [nextLongitude, nextLatitude]) => [sumLongitude + nextLongitude, sumLatitude + nextLatitude], [0, 0]);
  return [longitude / positions.length, latitude / positions.length];
}

function canonicalFeatureId(cityId: string, kind: FeatureKind, source: { provider: string; datasetId: string; sourceId: string }): string {
  const slug = (value: string) => encodeURIComponent(value.trim().toLocaleLowerCase());
  return `udt:${slug(cityId)}:${kind}:${slug(source.provider)}:${slug(source.datasetId)}:${slug(source.sourceId)}`;
}

export function makeCanonicalFeatureId(cityId: string, kind: FeatureKind, source: { provider: string; datasetId: string; sourceId: string }): string {
  return canonicalFeatureId(cityId, kind, source);
}

function sourceRefFor(raw: RawFixtureFeature, sourceRegistryId: string, sourceUrl: string, licenseRefId: string, provider: string, datasetId: string): SourceRef {
  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    id: `source-ref:${sourceRegistryId}:${raw.sourceId}`,
    registryEntryId: sourceRegistryId,
    provider,
    datasetId,
    sourceRecordId: raw.sourceId,
    sourceUrl,
    licenseRefId,
    role: "fixture",
    capturedAt: raw.capturedAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    observedAt: raw.observedAt ?? null,
    release: null,
  };
}

function toConfidence(raw: RawFixtureFeature): Confidence {
  const score = raw.confidence?.score ?? 0;
  const label = raw.confidence?.label ?? "unknown";
  return {
    score: typeof score === "number" && Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0,
    label: label === "high" || label === "medium" || label === "low" || label === "unknown" ? label : "unknown",
    rationale: raw.confidence?.rationale ?? "Synthetic fixture confidence is not evidence of real-world coverage.",
  };
}

function toUncertainty(raw: RawFixtureFeature): Uncertainty {
  return {
    horizontalMeters: raw.horizontalUncertaintyMeters ?? null,
    verticalMeters: raw.verticalUncertaintyMeters ?? null,
    temporalDays: null,
    notes: "Synthetic fixture uncertainty; replace with source metadata after approval.",
  };
}

function makeFeature(raw: RawFixtureFeature, envelope: FixtureEnvelope, adapter: CityAdapter, sourceEntry: NonNullable<ReturnType<typeof getSourceRegistryEntry>>, ingestedAt: string): Feature {
  const sourceRef = sourceRefFor(raw, envelope.sourceRegistryId, sourceEntry.canonicalUrl, `license:${sourceEntry.id}`, sourceEntry.provider, sourceEntry.datasetId);
  const geometryResult = validateFeatureGeometry(raw.geometry, envelope.inputCrs);
  if (!geometryResult.ok) throw new Error("Raw feature geometry should have been validated before normalization.");
  const geometry = normalizeGeometry(geometryResult.value, envelope.inputCrs);
  const coordinates = centroid(geometry);
  const height: GeometryProvenance["height"] = {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    valueMeters: raw.heightMeters ?? null,
    verticalDatum: envelope.verticalDatum,
    sourceRefId: sourceRef.id,
    method: raw.heightMeters === undefined || raw.heightMeters === null ? "unknown" : "source",
    uncertaintyMeters: raw.verticalUncertaintyMeters ?? null,
  };
  const geometryProvenance: GeometryProvenance = {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    sourceRefId: sourceRef.id,
    inputCrs: envelope.inputCrs,
    outputCrs: "EPSG:4326",
    capturedAt: raw.capturedAt ?? null,
    height,
    horizontalUncertaintyMeters: raw.horizontalUncertaintyMeters ?? null,
    notes: "Normalized by the local offline fixture harness; not production city coverage.",
  };
  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    id: canonicalFeatureId(adapter.cityId, raw.kind, { provider: sourceEntry.provider, datasetId: sourceEntry.datasetId, sourceId: raw.sourceId }),
    cityId: adapter.cityId,
    kind: raw.kind,
    name: raw.name,
    geometry,
    coordinates,
    geometryProvenance,
    sourceRefs: [sourceRef],
    provenance: "derived",
    confidence: toConfidence(raw),
    uncertainty: toUncertainty(raw),
    freshness: {
      capturedAt: raw.capturedAt ?? null,
      updatedAt: raw.updatedAt ?? null,
      observedAt: raw.observedAt ?? null,
      ingestedAt,
    },
    attributes: {
      ...(raw.attributes ?? {}),
      fixtureId: envelope.fixtureId,
      fixturePurpose: envelope.purpose,
    },
  };
}

function validateFeatureGeometry(value: unknown, inputCrs: "EPSG:4326" | "EPSG:3857"): { ok: true; value: Geometry } | { ok: false; issues: ValidationIssue[] } {
  if (!isRecord(value) || typeof value.type !== "string") return { ok: false, issues: [issue("geometry", "Expected a geometry object.")] };
  const issues: ValidationIssue[] = [];
  const validatePositionLocal = (position: unknown, path: string): position is Position => {
    if (!Array.isArray(position) || (position.length !== 2 && position.length !== 3) || position.some((coordinate) => typeof coordinate !== "number" || !Number.isFinite(coordinate))) {
      issues.push(issue(path, "Expected a finite 2D or 3D position."));
      return false;
    }
    const [x, y] = position as [number, number];
    if (inputCrs === "EPSG:4326" && (x < -180 || x > 180 || y < -90 || y > 90)) issues.push(issue(path, "WGS84 position is out of range."));
    if (inputCrs === "EPSG:3857" && (Math.abs(x) > MAX_MERCATOR || Math.abs(y) > MAX_MERCATOR)) issues.push(issue(path, "Web Mercator position is out of range."));
    return issues.length === 0;
  };
  if (value.type === "Point") {
    validatePositionLocal(value.coordinates, "geometry.coordinates");
    return issues.length > 0 ? { ok: false, issues } : { ok: true, value: { type: "Point", coordinates: value.coordinates as Position } };
  }
  if (value.type === "LineString" && Array.isArray(value.coordinates)) {
    if (value.coordinates.length < 2) issues.push(issue("geometry.coordinates", "LineString needs at least two positions."));
    value.coordinates.forEach((position, index) => validatePositionLocal(position, `geometry.coordinates[${index}]`));
    return issues.length > 0 ? { ok: false, issues } : { ok: true, value: { type: "LineString", coordinates: value.coordinates as Position[] } };
  }
  if (value.type === "Polygon" && Array.isArray(value.coordinates)) {
    value.coordinates.forEach((ring, ringIndex) => {
      if (!Array.isArray(ring) || ring.length < 4) {
        issues.push(issue(`geometry.coordinates[${ringIndex}]`, "Polygon ring needs at least four positions."));
        return;
      }
      ring.forEach((position, positionIndex) => validatePositionLocal(position, `geometry.coordinates[${ringIndex}][${positionIndex}]`));
      const first = ring[0] as Position;
      const last = ring[ring.length - 1] as Position;
      if (first?.[0] !== last?.[0] || first?.[1] !== last?.[1]) issues.push(issue(`geometry.coordinates[${ringIndex}]`, "Polygon ring must be closed."));
    });
    return issues.length > 0 ? { ok: false, issues } : { ok: true, value: { type: "Polygon", coordinates: value.coordinates as Position[][] } };
  }
  return { ok: false, issues: [issue("geometry.type", "Unsupported fixture geometry type.")] };
}

function manifestJson(manifest: IngestionManifest): string {
  return `${stableJson(manifest)}\n`;
}

function rejection(index: number, value: unknown, code: Rejection["code"], path: string, message: string): Rejection {
  return { index, sourceId: isRecord(value) && typeof value.sourceId === "string" ? value.sourceId : null, code, path, message };
}

export async function ingestFixtureText(rawText: string, options: OfflineIngestionOptions): Promise<OfflineIngestionResult> {
  const adapterResult = validateCityAdapter(options.adapter);
  if (!adapterResult.ok) throw new Error(`Invalid CityAdapter: ${adapterResult.issues.map((item) => `${item.path} ${item.message}`).join("; ")}`);
  const inputChecksumSha256 = await sha256Hex(stableJson(safeParse(rawText)));
  const rejections: Rejection[] = [];
  const features: Feature[] = [];
  let envelope: FixtureEnvelope | undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch (error) {
    rejections.push(rejection(0, null, "parse-error", "$", error instanceof Error ? error.message : "Fixture JSON could not be parsed."));
  }
  if (rejections.length === 0) {
    const envelopeResult = validateFixtureEnvelope(parsed);
    envelope = envelopeResult.envelope;
    envelopeResult.issues.forEach((item) => {
      rejections.push(rejection(-1, parsed, "schema-invalid", item.path, item.message));
      if (isRecord(parsed) && Array.isArray(parsed.features)) {
        parsed.features.forEach((feature, index) => rejections.push(rejection(index, feature, "schema-invalid", item.path, item.message)));
      }
    });
  }
  const sourceEntry = envelope ? getSourceRegistryEntry(envelope.sourceRegistryId) : undefined;
  if (envelope && !sourceEntry) {
    rejections.push(rejection(-1, envelope, "schema-invalid", "sourceRegistryId", "Source registry entry was not found."));
    envelope.features.forEach((feature, index) => rejections.push(rejection(index, feature, "schema-invalid", "sourceRegistryId", "Source registry entry was not found.")));
  }
  if (envelope && sourceEntry && options.requireApprovedSource !== false && sourceEntry.approval.state !== "approved") {
    rejections.push(rejection(-1, envelope, "schema-invalid", "sourceRegistryId", "Source registry entry is not approved for this harness."));
    envelope.features.forEach((feature, index) => rejections.push(rejection(index, feature, "schema-invalid", "sourceRegistryId", "Source registry entry is not approved for this harness.")));
  }
  if (envelope && sourceEntry && rejections.length === 0) {
    envelope.features.forEach((rawValue, index) => {
      const rawResult = validateRawFeature(rawValue, index);
      if (!rawResult.feature) {
        const geometryIssue = rawResult.issues.find((item) => item.path.endsWith(".geometry"));
        const code: Rejection["code"] = geometryIssue ? "geometry-invalid" : "schema-invalid";
        rawResult.issues.forEach((item) => rejections.push(rejection(index, rawValue, code, item.path, item.message)));
        return;
      }
      const geometryResult = validateFeatureGeometry(rawResult.feature.geometry, envelope.inputCrs);
      if (!geometryResult.ok) {
        geometryResult.issues.forEach((item) => rejections.push(rejection(index, rawValue, "geometry-invalid", item.path, item.message)));
        return;
      }
      const feature = makeFeature(rawResult.feature, envelope, adapterResult.value, sourceEntry, options.ingestedAt);
      const featureResult = validateFeature(feature);
      if (!featureResult.ok) {
        featureResult.issues.forEach((item) => rejections.push(rejection(index, rawValue, "schema-invalid", item.path, item.message)));
        return;
      }
      features.push(featureResult.value);
    });
  }
  const rejectedRecordIndices = [...new Set(rejections.filter((item) => item.index >= 0).map((item) => item.index))].sort((a, b) => a - b);
  const run: IngestionRun = {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    runId: options.runId,
    adapterId: options.adapter.id,
    sourceRegistryEntryId: envelope?.sourceRegistryId ?? "unknown",
    inputFileName: options.inputFileName,
    inputChecksumSha256,
    startedAt: options.startedAt,
    finishedAt: options.finishedAt,
    immutable: true,
    acceptedCount: features.length,
    rejectedCount: rejectedRecordIndices.length,
    sourceRecordCount: envelope?.features.length ?? (rejections.length > 0 ? 1 : 0),
  };
  const runResult = validateIngestionRun(run);
  if (!runResult.ok) throw new Error(`Invalid generated ingestion run: ${runResult.issues.map((item) => `${item.path} ${item.message}`).join("; ")}`);
  const manifest: IngestionManifest = {
    ...run,
    manifestVersion: DOMAIN_SCHEMA_VERSION,
    fixtureId: envelope?.fixtureId ?? "invalid-fixture",
    adapterPurpose: options.adapter.purpose,
    outputCrs: "EPSG:4326",
    rejectionAccounting: {
      allInputRecordsAccountedFor: run.acceptedCount + run.rejectedCount === run.sourceRecordCount || rejections.some((item) => item.index === -1),
      rejectedRecordIndices,
      rejected: rejections,
    },
    acceptedFeatureIds: features.map((feature) => feature.id),
  };
  return { adapter: adapterResult.value, features, manifest, manifestJson: manifestJson(manifest) };
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return { invalidJson: value };
  }
}
