import type {
  CityAdapter,
  Confidence,
  CoordinateReferenceSystem,
  Feature,
  GeometryProvenance,
  IngestionRun,
  Position,
  Rejection,
  SourceRef,
  ValidationIssue,
} from "../domain/schema.ts";
import { DOMAIN_SCHEMA_VERSION } from "../domain/schema.ts";
import { manhattanAdapter } from "../data/city-adapters.ts";
import { getSourceRegistryEntry, sourceRegistry } from "../data/source-registry.ts";
import type { SourceRegistryEntry } from "../domain/schema.ts";
import { makeCanonicalFeatureId } from "./offline.ts";
import type { LayerManifest, LayerVisibility, RuntimeLayerId } from "../runtime/layers.ts";
import { buildLayerManifest, DEFAULT_LAYER_VISIBILITY } from "../runtime/layers.ts";
import { DeduplicatingTileLoader, MemoryTileCache } from "../runtime/cache.ts";
import { tileKeyForFeature, tileKeyString } from "../runtime/spatial.ts";
import type { RuntimeCityAdapter } from "../runtime/fixture-adapter.ts";

/**
 * Metadata must travel with the local snapshot.  The adapter never discovers
 * these values from a URL or by calling a provider.
 */
export interface NycBuildingFootprintsSnapshotMetadata {
  sourceRegistryEntryId: string;
  inputFileName: string;
  inputChecksumSha256: string;
  termsUrl: string;
  attribution: string;
  releaseTimestamp: string | null;
  captureTimestamp: string | null;
  updateTimestamp: string | null;
  ingestedAt: string;
  inputCrs: CoordinateReferenceSystem;
  verticalDatum: string;
  fixtureOnly: boolean;
  immutable: true;
}

export interface NycBuildingFootprintsIngestionReport extends IngestionRun {
  manifestVersion: typeof DOMAIN_SCHEMA_VERSION;
  sourceDataset: "nyc.building-footprints";
  sourceTermsUrl: string;
  sourceAttribution: string;
  outputCrs: "EPSG:4326";
  acceptedFeatureCount: number;
  acceptedFeatureIds: string[];
  rejected: Rejection[];
  rejectedRecordIndices: number[];
  allInputRecordsAccountedFor: boolean;
  layerManifest: LayerManifest;
}

export interface NycBuildingFootprintsSnapshotAdapterOptions {
  snapshotText: string;
  metadata: NycBuildingFootprintsSnapshotMetadata;
  city?: CityAdapter;
  registryEntries?: readonly SourceRegistryEntry[];
}

interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  features: unknown[];
}

interface RawBuildingRecord {
  sourceId: string;
  properties: Record<string, unknown>;
  geometry: PolygonCoordinates[];
  sourceGeometryType: "Polygon" | "MultiPolygon";
}

type PolygonCoordinates = Position[][];

interface SliceBounds {
  west: number;
  east: number;
  south: number;
  north: number;
}

const WGS84_MAX_MERCATOR = 20_037_508.342789244;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function issue(path: string, message: string): ValidationIssue {
  return { path, message };
}

function property(properties: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(properties, name)) return properties[name];
  }
  return undefined;
}

function textProperty(properties: Record<string, unknown>, ...names: string[]): string | null {
  const value = property(properties, ...names);
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function nullableNumberProperty(properties: Record<string, unknown>, ...names: string[]): { value: number | null; invalid: boolean } {
  const value = property(properties, ...names);
  if (value === null || value === undefined || value === "") return { value: null, invalid: false };
  if (typeof value !== "number" || !Number.isFinite(value)) return { value: null, invalid: true };
  return { value, invalid: false };
}

function normalizePosition(position: Position, inputCrs: CoordinateReferenceSystem): Position {
  if (inputCrs === "EPSG:4326") return [...position] as Position;
  const [x, y, z] = position;
  const longitude = (x / WGS84_MAX_MERCATOR) * 180;
  const latitude = (Math.atan(Math.sinh((y / WGS84_MAX_MERCATOR) * Math.PI)) * 180) / Math.PI;
  return z === undefined ? [longitude, latitude] : [longitude, latitude, z];
}

function validPosition(value: unknown, inputCrs: CoordinateReferenceSystem): value is Position {
  if (!Array.isArray(value) || (value.length !== 2 && value.length !== 3)) return false;
  if (value.some((coordinate) => typeof coordinate !== "number" || !Number.isFinite(coordinate))) return false;
  const [x, y] = value as [number, number];
  return inputCrs === "EPSG:4326"
    ? x >= -180 && x <= 180 && y >= -90 && y <= 90
    : Math.abs(x) <= WGS84_MAX_MERCATOR && Math.abs(y) <= WGS84_MAX_MERCATOR;
}

function validRing(ring: unknown, inputCrs: CoordinateReferenceSystem): ring is Position[] {
  if (!Array.isArray(ring) || ring.length < 4 || !ring.every((position) => validPosition(position, inputCrs))) return false;
  const first = ring[0] as Position;
  const last = ring[ring.length - 1] as Position;
  return first[0] === last[0] && first[1] === last[1];
}

function parseGeometry(value: unknown, inputCrs: CoordinateReferenceSystem): { value?: RawBuildingRecord["geometry"]; type?: RawBuildingRecord["sourceGeometryType"]; issues: ValidationIssue[] } {
  if (!isRecord(value) || (value.type !== "Polygon" && value.type !== "MultiPolygon")) {
    return { issues: [issue("geometry.type", "Expected Polygon or MultiPolygon.")] };
  }
  const polygons = value.type === "Polygon" ? [value.coordinates] : value.coordinates;
  if (!Array.isArray(polygons) || polygons.length === 0) return { issues: [issue("geometry.coordinates", "Expected at least one polygon.")] };
  const issues: ValidationIssue[] = [];
  const parsed: PolygonCoordinates[] = [];
  polygons.forEach((polygon, polygonIndex) => {
    if (!Array.isArray(polygon) || polygon.length === 0) {
      issues.push(issue(`geometry.coordinates[${polygonIndex}]`, "Expected an outer ring and optional holes."));
      return;
    }
    const rings = polygon as unknown[];
    if (!rings.every((ring) => validRing(ring, inputCrs))) {
      issues.push(issue(`geometry.coordinates[${polygonIndex}]`, "Every polygon ring must have four or more closed finite positions."));
      return;
    }
    parsed.push(rings as Position[][]);
  });
  return issues.length > 0 ? { issues } : { value: parsed, type: value.type, issues };
}

function boundsForCity(city: CityAdapter): SliceBounds {
  const positions = city.boundary.coordinates[0] ?? [];
  const longitudes = positions.map(([longitude]) => longitude);
  const latitudes = positions.map(([, latitude]) => latitude);
  return {
    west: Math.min(...longitudes),
    east: Math.max(...longitudes),
    south: Math.min(...latitudes),
    north: Math.max(...latitudes),
  };
}

function inside(position: Position, edge: "west" | "east" | "south" | "north", bounds: SliceBounds): boolean {
  const [longitude, latitude] = position;
  if (edge === "west") return longitude >= bounds.west;
  if (edge === "east") return longitude <= bounds.east;
  if (edge === "south") return latitude >= bounds.south;
  return latitude <= bounds.north;
}

function intersection(start: Position, end: Position, edge: "west" | "east" | "south" | "north", bounds: SliceBounds): Position {
  const [startLongitude, startLatitude] = start;
  const [endLongitude, endLatitude] = end;
  if (edge === "west" || edge === "east") {
    const longitude = edge === "west" ? bounds.west : bounds.east;
    const ratio = (longitude - startLongitude) / (endLongitude - startLongitude || 1);
    return [longitude, startLatitude + ((endLatitude - startLatitude) * ratio)];
  }
  const latitude = edge === "south" ? bounds.south : bounds.north;
  const ratio = (latitude - startLatitude) / (endLatitude - startLatitude || 1);
  return [startLongitude + ((endLongitude - startLongitude) * ratio), latitude];
}

function clipRing(ring: Position[], bounds: SliceBounds): Position[] | null {
  let output = ring.slice(0, -1);
  for (const edge of ["west", "east", "south", "north"] as const) {
    if (output.length === 0) return null;
    const next: Position[] = [];
    let previous = output[output.length - 1] as Position;
    for (const current of output) {
      const currentInside = inside(current, edge, bounds);
      const previousInside = inside(previous, edge, bounds);
      if (currentInside !== previousInside) next.push(intersection(previous, current, edge, bounds));
      if (currentInside) next.push(current);
      previous = current;
    }
    output = next;
  }
  if (output.length < 3) return null;
  const closed = [...output, output[0]] as Position[];
  return closed;
}

function clipPolygon(polygon: PolygonCoordinates, bounds: SliceBounds): PolygonCoordinates | null {
  const outer = clipRing(polygon[0] ?? [], bounds);
  if (!outer) return null;
  const holes = polygon.slice(1).map((ring) => clipRing(ring, bounds)).filter((ring): ring is Position[] => ring !== null);
  return [outer, ...holes];
}

function centroid(polygon: PolygonCoordinates): Position {
  const ring = polygon[0] ?? [];
  const openRing = ring.slice(0, -1);
  if (openRing.length === 0) return [0, 0];
  const [longitude, latitude] = openRing.reduce(([sumLongitude, sumLatitude], [nextLongitude, nextLatitude]) => [sumLongitude + nextLongitude, sumLatitude + nextLatitude], [0, 0]);
  return [longitude / openRing.length, latitude / openRing.length];
}

function sourceRecordIndex(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.properties)) return null;
  return textProperty(value.properties, "DOITT_ID", "doitt_id", "DOITTID", "doittId");
}

function parseFeature(value: unknown, index: number, inputCrs: CoordinateReferenceSystem): { value?: RawBuildingRecord; issues: ValidationIssue[] } {
  if (!isRecord(value) || value.type !== "Feature" || !isRecord(value.properties)) return { issues: [issue(`features[${index}]`, "Expected a GeoJSON Feature with properties.")] };
  const sourceId = sourceRecordIndex(value);
  if (!sourceId) return { issues: [issue(`features[${index}].properties.DOITT_ID`, "DOITT_ID is required as the stable source record identifier.")] };
  const geometryResult = parseGeometry(value.geometry, inputCrs);
  if (!geometryResult.value || !geometryResult.type) return { issues: geometryResult.issues };
  return { value: { sourceId, properties: value.properties, geometry: geometryResult.value, sourceGeometryType: geometryResult.type }, issues: [] };
}

function sourceRefFor(entry: SourceRegistryEntry, metadata: NycBuildingFootprintsSnapshotMetadata, sourceId: string): SourceRef {
  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    id: `source-ref:${entry.id}:${sourceId}`,
    registryEntryId: entry.id,
    provider: entry.provider,
    datasetId: entry.datasetId,
    sourceRecordId: sourceId,
    sourceUrl: entry.canonicalUrl,
    licenseRefId: `license:${entry.id}`,
    role: metadata.fixtureOnly ? "fixture" : "primary",
    capturedAt: metadata.captureTimestamp,
    updatedAt: metadata.updateTimestamp,
    observedAt: null,
    release: metadata.releaseTimestamp,
  };
}

function confidenceFor(geometrySource: string | null, fixtureOnly: boolean): Confidence {
  if (fixtureOnly) return { score: 0, label: "unknown", rationale: "Invented schema fixture; not evidence of NYC coverage." };
  if (geometrySource?.toLocaleLowerCase() === "photogrammetric") return { score: 0.95, label: "high", rationale: "OTI metadata reports photogrammetric updates conforming to stated ASPRS accuracy standards." };
  return { score: 0.7, label: "medium", rationale: "OTI metadata identifies manually digitized geometry as less accurate than photogrammetric updates." };
}

function propertyAttributes(properties: Record<string, unknown>, sourceId: string, fixtureOnly: boolean): Record<string, string | number | boolean | null> {
  const baseBbl = textProperty(properties, "BASE_BBL", "base_bbl", "BASEBBL");
  const mapPlutoBbl = textProperty(properties, "MAPPLUTO_BBL", "mappluto_bbl", "MPLUTO_BBL", "mpluto_bbl");
  const bin = textProperty(properties, "BIN", "bin");
  const constructionYear = nullableNumberProperty(properties, "CONSTRUCTION_YEAR", "CNSTRCT_YR", "construction_year").value;
  const featureCode = nullableNumberProperty(properties, "FEATURE_CODE", "FEAT_CODE", "feature_code").value;
  const groundElevation = nullableNumberProperty(properties, "GROUND_ELEVATION", "GROUNDELEV", "ground_elevation").value;
  const heightRoof = nullableNumberProperty(properties, "HEIGHT_ROOF", "HEIGHTROOF", "height_roof").value;
  const geometrySource = textProperty(properties, "GEOM_SOURCE", "geometry_source");
  const name = textProperty(properties, "NAME", "name");
  const lastEditedDate = textProperty(properties, "LAST_EDITED_DATE", "LSTMODDATE", "last_edited_date");
  const lastStatusType = textProperty(properties, "LAST_STATUS_TYPE", "LSTSTATTYPE", "last_status_type");
  return {
    sourceRecordId: sourceId,
    doittId: sourceId,
    bin,
    baseBbl,
    mapPlutoBbl,
    constructionYear,
    featureCode,
    groundElevationMeters: groundElevation,
    heightRoofMeters: heightRoof,
    geometrySource,
    sourceName: name,
    lastEditedDate,
    lastStatusType,
    fixtureOnly,
  };
}

function parseFeatureIntoNormalized(
  raw: RawBuildingRecord,
  index: number,
  metadata: NycBuildingFootprintsSnapshotMetadata,
  entry: SourceRegistryEntry,
  city: CityAdapter,
  bounds: SliceBounds,
): { features: Feature[]; rejection?: Rejection } {
  const heightResult = nullableNumberProperty(raw.properties, "HEIGHT_ROOF", "HEIGHTROOF", "height_roof");
  const groundResult = nullableNumberProperty(raw.properties, "GROUND_ELEVATION", "GROUNDELEV", "ground_elevation");
  const yearResult = nullableNumberProperty(raw.properties, "CONSTRUCTION_YEAR", "CNSTRCT_YR", "construction_year");
  const codeResult = nullableNumberProperty(raw.properties, "FEATURE_CODE", "FEAT_CODE", "feature_code");
  if (heightResult.invalid || (heightResult.value !== null && heightResult.value < 0)) {
    return { features: [], rejection: { index, sourceId: raw.sourceId, code: "schema-invalid", path: `features[${index}].properties.HEIGHT_ROOF`, message: "HEIGHT_ROOF must be a non-negative finite number or null; zero means unavailable." } };
  }
  if (groundResult.invalid || yearResult.invalid || codeResult.invalid) {
    return { features: [], rejection: { index, sourceId: raw.sourceId, code: "schema-invalid", path: `features[${index}].properties`, message: "Documented numeric fields must be finite numbers or null." } };
  }
  const clipped = raw.geometry.map((polygon) => clipPolygon(polygon.map((ring) => ring.map((position) => normalizePosition(position, metadata.inputCrs))), bounds)).filter((polygon): polygon is PolygonCoordinates => polygon !== null);
  if (clipped.length === 0) {
    return { features: [], rejection: { index, sourceId: raw.sourceId, code: "outside-slice", path: `features[${index}].geometry`, message: "Feature does not intersect the documented Manhattan study slice." } };
  }
  const sourceRef = sourceRefFor(entry, metadata, raw.sourceId);
  const baseId = makeCanonicalFeatureId(city.cityId, "building", { provider: entry.provider, datasetId: entry.datasetId, sourceId: raw.sourceId });
  const geometrySource = textProperty(raw.properties, "GEOM_SOURCE", "geometry_source");
  const name = textProperty(raw.properties, "NAME", "name") ?? `Building ${raw.sourceId}`;
  const heightValue = heightResult.value === null || heightResult.value === 0 ? null : heightResult.value;
  const features = clipped.map((polygon, partIndex) => {
    const id = clipped.length === 1 ? baseId : `${baseId}:part-${String(partIndex + 1).padStart(3, "0")}`;
    const height: GeometryProvenance["height"] = {
      schemaVersion: DOMAIN_SCHEMA_VERSION,
      valueMeters: heightValue,
      verticalDatum: metadata.verticalDatum,
      sourceRefId: sourceRef.id,
      method: heightValue === null ? "unknown" : "source",
      uncertaintyMeters: null,
    };
    const feature: Feature = {
      schemaVersion: DOMAIN_SCHEMA_VERSION,
      id,
      cityId: city.cityId,
      kind: "building",
      name,
      geometry: { type: "Polygon", coordinates: polygon },
      coordinates: centroid(polygon),
      geometryProvenance: {
        schemaVersion: DOMAIN_SCHEMA_VERSION,
        sourceRefId: sourceRef.id,
        inputCrs: metadata.inputCrs,
        outputCrs: "EPSG:4326",
        capturedAt: metadata.captureTimestamp,
        height,
        horizontalUncertaintyMeters: geometrySource?.toLocaleLowerCase() === "photogrammetric" ? 0.6096 : null,
        notes: metadata.fixtureOnly
          ? "Invented schema fixture clipped to the documented slice; not real Manhattan coverage."
          : "Clipped from the approved local NYC Building Footprints GeoJSON snapshot. HEIGHT_ROOF is relative to source ground; no roof-height uncertainty was published.",
      },
      sourceRefs: [sourceRef],
      provenance: metadata.fixtureOnly ? "generated" : "authoritative",
      confidence: confidenceFor(geometrySource, metadata.fixtureOnly),
      uncertainty: {
        horizontalMeters: geometrySource?.toLocaleLowerCase() === "photogrammetric" ? 0.6096 : null,
        verticalMeters: null,
        temporalDays: null,
        notes: metadata.fixtureOnly ? "Synthetic fixture uncertainty is unknown." : "OTI publishes horizontal accuracy guidance for photogrammetric geometry; no numeric roof-height uncertainty was published.",
      },
      freshness: {
        capturedAt: metadata.captureTimestamp,
        updatedAt: metadata.updateTimestamp,
        observedAt: null,
        ingestedAt: metadata.ingestedAt,
      },
      attributes: {
        ...propertyAttributes(raw.properties, raw.sourceId, metadata.fixtureOnly),
        geometryPartIndex: partIndex,
        geometryPartCount: clipped.length,
      },
    };
    return feature;
  });
  return { features };
}

function parseCollection(value: unknown): GeoJsonFeatureCollection {
  if (!isRecord(value) || value.type !== "FeatureCollection" || !Array.isArray(value.features)) {
    throw new Error("Snapshot must be a GeoJSON FeatureCollection.");
  }
  return value as unknown as GeoJsonFeatureCollection;
}

export class NycBuildingFootprintsSnapshotAdapter implements RuntimeCityAdapter {
  readonly fixtureOnly: boolean;
  readonly city: CityAdapter;
  private readonly features: readonly Feature[];
  private readonly byId: ReadonlyMap<string, Feature>;
  private readonly layerManifest: LayerManifest;
  private readonly cache = new MemoryTileCache<Feature[]>();
  private readonly loader = new DeduplicatingTileLoader(this.cache);
  private readonly tileIndex = new Map<string, Feature[]>();
  private readonly report: NycBuildingFootprintsIngestionReport;

  private constructor(features: Feature[], report: NycBuildingFootprintsIngestionReport, city: CityAdapter, fixtureOnly: boolean) {
    this.features = features;
    this.byId = new Map(features.map((feature) => [feature.id, feature]));
    this.report = report;
    this.city = city;
    this.fixtureOnly = fixtureOnly;
    this.layerManifest = report.layerManifest;
    features.forEach((feature) => {
      const key = `buildings/${tileKeyString(tileKeyForFeature(feature, this.layerManifest.tileLevel))}`;
      const bucket = this.tileIndex.get(key) ?? [];
      bucket.push(feature);
      this.tileIndex.set(key, bucket);
    });
  }

  static async fromSnapshot(options: NycBuildingFootprintsSnapshotAdapterOptions): Promise<NycBuildingFootprintsSnapshotAdapter> {
    const metadata = options.metadata;
    const city = options.city ?? manhattanAdapter;
    const registry = options.registryEntries ?? sourceRegistry;
    const entry = registry.find((candidate) => candidate.id === metadata.sourceRegistryEntryId) ?? getSourceRegistryEntry(metadata.sourceRegistryEntryId);
    if (!entry) throw new Error(`Source registry entry not found: ${metadata.sourceRegistryEntryId}`);
    if (entry.approval.state !== "approved") throw new Error(`Source registry entry ${entry.id} is pending; approval is required before ingest.`);
    if (entry.id !== "nyc.building-footprints") throw new Error(`Unexpected source registry entry: ${entry.id}`);
    if (metadata.immutable !== true) throw new Error("Snapshot metadata must explicitly mark the local input immutable.");
    if (metadata.termsUrl !== entry.termsUrl) throw new Error("Recorded terms URL does not match the approved source registry entry.");
    if (!isNonEmptyString(metadata.attribution)) throw new Error("Recorded attribution is required.");
    if (!/^[a-f0-9]{64}$/i.test(metadata.inputChecksumSha256)) throw new Error("A 64-character SHA-256 snapshot checksum is required.");
    const actualChecksum = await (await import("./offline")).sha256Hex(options.snapshotText);
    if (actualChecksum.toLocaleLowerCase() !== metadata.inputChecksumSha256.toLocaleLowerCase()) throw new Error("Snapshot checksum does not match recorded metadata.");
    const collection = parseCollection(JSON.parse(options.snapshotText));
    const bounds = boundsForCity(city);
    const features: Feature[] = [];
    const rejected: Rejection[] = [];
    collection.features.forEach((value, index) => {
      const parsed = parseFeature(value, index, metadata.inputCrs);
      if (!parsed.value) {
        parsed.issues.forEach((item) => rejected.push({ index, sourceId: sourceRecordIndex(value), code: "geometry-invalid", path: item.path, message: item.message }));
        return;
      }
      const normalized = parseFeatureIntoNormalized(parsed.value, index, metadata, entry, city, bounds);
      if (normalized.rejection) rejected.push(normalized.rejection);
      features.push(...normalized.features);
    });
    const rejectedRecordIndices = [...new Set(rejected.map((item) => item.index))].sort((left, right) => left - right);
    const layerManifest = buildLayerManifest("buildings", features, { tileLevel: 12, generatedAt: metadata.ingestedAt, fixtureOnly: metadata.fixtureOnly });
    const run: IngestionRun = {
      schemaVersion: DOMAIN_SCHEMA_VERSION,
      runId: `nyc-building-footprints:${metadata.inputChecksumSha256.slice(0, 16)}`,
      adapterId: city.id,
      sourceRegistryEntryId: entry.id,
      inputFileName: metadata.inputFileName,
      inputChecksumSha256: metadata.inputChecksumSha256,
      startedAt: metadata.ingestedAt,
      finishedAt: metadata.ingestedAt,
      immutable: true,
      acceptedCount: collection.features.length - rejectedRecordIndices.length,
      rejectedCount: rejectedRecordIndices.length,
      sourceRecordCount: collection.features.length,
    };
    const report: NycBuildingFootprintsIngestionReport = {
      ...run,
      manifestVersion: DOMAIN_SCHEMA_VERSION,
      sourceDataset: "nyc.building-footprints",
      sourceTermsUrl: metadata.termsUrl,
      sourceAttribution: metadata.attribution,
      outputCrs: "EPSG:4326",
      acceptedFeatureCount: features.length,
      acceptedFeatureIds: features.map((feature) => feature.id),
      rejected,
      rejectedRecordIndices,
      allInputRecordsAccountedFor: run.acceptedCount + run.rejectedCount === run.sourceRecordCount,
      layerManifest,
    };
    return new NycBuildingFootprintsSnapshotAdapter(features, report, city, metadata.fixtureOnly);
  }

  getLayerManifest(layer: RuntimeLayerId): LayerManifest {
    if (layer === "buildings") return this.layerManifest;
    return buildLayerManifest("pois", [], { tileLevel: 12, generatedAt: this.report.finishedAt, fixtureOnly: this.fixtureOnly });
  }

  getFeature(featureId: string): Feature | undefined {
    return this.byId.get(featureId);
  }

  getFeatures(visibility: LayerVisibility = DEFAULT_LAYER_VISIBILITY): Feature[] {
    return visibility.buildings ? [...this.features] : [];
  }

  search(query: string): Feature[] {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return [];
    return this.features
      .map((feature) => {
        const fields = [feature.id, feature.name, ...feature.sourceRefs.map((source) => source.sourceRecordId), ...Object.values(feature.attributes).filter((value): value is string => typeof value === "string")].map((field) => field.toLocaleLowerCase());
        const score = fields[0] === normalized || fields.slice(2).includes(normalized) ? 0 : feature.name.toLocaleLowerCase() === normalized ? 1 : fields.some((field) => field.includes(normalized)) ? 2 : Number.POSITIVE_INFINITY;
        return { feature, score };
      })
      .filter((result) => Number.isFinite(result.score))
      .sort((left, right) => left.score - right.score || left.feature.id.localeCompare(right.feature.id))
      .map((result) => result.feature);
  }

  async loadLayerFeatures(layer: RuntimeLayerId): Promise<Feature[]> {
    if (layer === "pois") return [];
    const loaded = await Promise.all(this.layerManifest.tileKeys.map((tileKey) => this.loader.load(`buildings/${tileKey}`, async (cacheKey) => this.tileIndex.get(cacheKey) ?? [])));
    return [...new Map(loaded.flat().map((feature) => [feature.id, feature])).values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  getIngestionReport(): NycBuildingFootprintsIngestionReport {
    return this.report;
  }

  cacheSize(): number {
    return this.cache.size();
  }
}
