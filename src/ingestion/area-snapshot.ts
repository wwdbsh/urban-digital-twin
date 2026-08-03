import type {
  CityAdapter,
  Feature,
  Freshness,
  Geometry,
  IngestionRun,
  Position,
  Rejection,
  SourceRef,
} from "../domain/schema.ts";
import { DOMAIN_SCHEMA_VERSION } from "../domain/schema.ts";
import type { SourceRegistryEntry } from "../domain/schema.ts";
import { getSourceRegistryEntry, sourceRegistry } from "../data/source-registry.ts";
import { manhattanAdapter } from "../data/city-adapters.ts";
import { AREA_SEMANTICS, AREA_TYPES, type AreaRecord, type AreaSemantic, type AreaType } from "../domain/areas.ts";
import { makeCanonicalFeatureId, sha256Hex } from "./offline.ts";
import { buildLayerManifest, DEFAULT_LAYER_VISIBILITY, type LayerManifest, type LayerVisibility, type RuntimeLayerId } from "../runtime/layers.ts";
import { DeduplicatingTileLoader, MemoryTileCache } from "../runtime/cache.ts";
import { tileKeyForFeature, tileKeyString } from "../runtime/spatial.ts";
import type { RuntimeCityAdapter } from "../runtime/fixture-adapter.ts";

export interface AreaSnapshotMetadata {
  inputFileName: string;
  inputChecksumSha256: string;
  ingestedAt: string;
  immutable: true;
  fixtureOnly: boolean;
}

export interface AreaSnapshotRecord {
  sourceRegistryEntryId: string;
  provider: string;
  datasetId: string;
  sourceRecordId: string;
  termsUrl: string;
  attribution: string;
  licenseClass: string;
  officialName: string;
  areaType: string;
  areaLevel: string;
  semantics: string;
  labels?: unknown;
  capturedAt?: string | null;
  updatedAt?: string | null;
  observedAt?: string | null;
  geometry?: unknown;
}

export interface AreaIngestionReport extends IngestionRun {
  manifestVersion: typeof DOMAIN_SCHEMA_VERSION;
  sourceRegistryEntryIds: string[];
  outputCrs: "EPSG:4326";
  acceptedAreaCount: number;
  acceptedFeatureCount: number;
  acceptedFeatureIds: string[];
  rejected: Rejection[];
  rejectedRecordIndices: number[];
  allInputRecordsAccountedFor: boolean;
  layerManifest: LayerManifest;
}

export interface AreaSnapshotAdapterOptions {
  snapshotText: string;
  metadata: AreaSnapshotMetadata;
  city?: CityAdapter;
  registryEntries?: readonly SourceRegistryEntry[];
}

interface Bounds { west: number; east: number; south: number; north: number; }
interface ParsedArea extends AreaSnapshotRecord {
  entry: SourceRegistryEntry;
  geometry: Geometry;
  sourceRef: SourceRef;
  labels: string[];
  areaType: AreaType;
  semantics: AreaSemantic;
  coordinates: Position;
  freshness: Freshness;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validTimestamp(value: unknown): value is string | null {
  return value === null || value === undefined || (typeof value === "string" && !Number.isNaN(Date.parse(value)));
}

function position(value: unknown): Position | null {
  if (!Array.isArray(value) || value.length < 2 || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) return null;
  const [longitude, latitude] = value as [number, number];
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return null;
  return [longitude, latitude];
}

function ring(value: unknown): Position[] | null {
  if (!Array.isArray(value) || value.length < 4) return null;
  const points = value.map(position);
  if (points.some((item) => item === null)) return null;
  const normalized = points as Position[];
  const first = normalized[0];
  const last = normalized[normalized.length - 1];
  if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) return null;
  return normalized;
}

function boundsFor(city: CityAdapter): Bounds {
  const positions = city.boundary.coordinates[0] ?? [];
  return {
    west: Math.min(...positions.map(([longitude]) => longitude)),
    east: Math.max(...positions.map(([longitude]) => longitude)),
    south: Math.min(...positions.map(([, latitude]) => latitude)),
    north: Math.max(...positions.map(([, latitude]) => latitude)),
  };
}

type ClipBoundary = "west" | "east" | "south" | "north";
function inside(pointValue: Position, bounds: Bounds, boundary: ClipBoundary): boolean {
  if (boundary === "west") return pointValue[0] >= bounds.west;
  if (boundary === "east") return pointValue[0] <= bounds.east;
  if (boundary === "south") return pointValue[1] >= bounds.south;
  return pointValue[1] <= bounds.north;
}

function intersect(start: Position, end: Position, bounds: Bounds, boundary: ClipBoundary): Position {
  const vertical = boundary === "west" || boundary === "east";
  const target = vertical ? (boundary === "west" ? bounds.west : bounds.east) : (boundary === "south" ? bounds.south : bounds.north);
  const denominator = vertical ? end[0] - start[0] : end[1] - start[1];
  if (denominator === 0) return start;
  const factor = (target - (vertical ? start[0] : start[1])) / denominator;
  return [start[0] + factor * (end[0] - start[0]), start[1] + factor * (end[1] - start[1])];
}

function clipRing(input: Position[], bounds: Bounds): Position[] {
  let output = input.slice(0, -1);
  for (const boundary of ["west", "east", "south", "north"] as const) {
    const next: Position[] = [];
    for (let index = 0; index < output.length; index += 1) {
      const current = output[index]!;
      const previous = output[(index + output.length - 1) % output.length]!;
      const currentInside = inside(current, bounds, boundary);
      const previousInside = inside(previous, bounds, boundary);
      if (currentInside !== previousInside) next.push(intersect(previous, current, bounds, boundary));
      if (currentInside) next.push(current);
    }
    output = next;
  }
  if (output.length < 3) return [];
  return [...output, output[0]!];
}

function normalizePolygon(value: unknown, bounds: Bounds): Position[][] | null {
  if (!Array.isArray(value)) return null;
  const rings = value.map((item) => ring(item));
  if (rings.some((item) => item === null)) return null;
  const clipped = (rings as Position[][]).map((item) => clipRing(item, bounds));
  if (!clipped[0] || clipped[0].length < 4) return null;
  return clipped.filter((item, index) => index === 0 || item.length >= 4);
}

function normalizeGeometry(value: unknown, bounds: Bounds): Geometry | null {
  if (!record(value) || (value.type !== "Polygon" && value.type !== "MultiPolygon")) return null;
  if (value.type === "Polygon") {
    const coordinates = normalizePolygon(value.coordinates, bounds);
    return coordinates ? { type: "Polygon", coordinates } : null;
  }
  if (!Array.isArray(value.coordinates)) return null;
  const polygons = value.coordinates.map((polygon) => normalizePolygon(polygon, bounds)).filter((item): item is Position[][] => item !== null);
  return polygons.length > 0 ? { type: "MultiPolygon", coordinates: polygons } : null;
}

function labelPoint(geometry: Geometry): Position {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
  const points = polygons.flatMap((polygon) => (polygon[0] ?? []).slice(0, -1));
  if (points.length === 0) return [0, 0];
  return [points.reduce((sum, pointValue) => sum + pointValue[0], 0) / points.length, points.reduce((sum, pointValue) => sum + pointValue[1], 0) / points.length];
}

function sourceRef(entry: SourceRegistryEntry, raw: AreaSnapshotRecord, fixtureOnly: boolean): SourceRef {
  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    id: `source-ref:${entry.id}:${raw.sourceRecordId}`,
    registryEntryId: entry.id,
    provider: raw.provider,
    datasetId: raw.datasetId,
    sourceRecordId: raw.sourceRecordId,
    sourceUrl: entry.canonicalUrl,
    licenseRefId: `license:${entry.id}`,
    role: fixtureOnly ? "fixture" : "primary",
    capturedAt: raw.capturedAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    observedAt: raw.observedAt ?? null,
    release: null,
  };
}

function sourceFeatures(value: unknown): AreaSnapshotRecord[] {
  if (!record(value) || value.type !== "FeatureCollection" || !Array.isArray(value.features)) throw new Error("Area snapshot must be a local GeoJSON FeatureCollection.");
  return value.features.map((item) => {
    if (!record(item) || item.type !== "Feature" || !record(item.properties)) return item as AreaSnapshotRecord;
    return { ...item.properties, geometry: item.geometry } as AreaSnapshotRecord;
  });
}

function toFeature(area: AreaRecord): Feature {
  const source = area.sourceRefs[0];
  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    id: area.canonicalId,
    cityId: area.cityId,
    kind: "area",
    name: area.officialName,
    geometry: area.geometry,
    coordinates: area.coordinates,
    geometryProvenance: {
      schemaVersion: DOMAIN_SCHEMA_VERSION,
      sourceRefId: source?.id ?? "unknown",
      inputCrs: "EPSG:4326",
      outputCrs: "EPSG:4326",
      capturedAt: area.freshness.capturedAt,
      height: { schemaVersion: DOMAIN_SCHEMA_VERSION, valueMeters: null, verticalDatum: "unknown", sourceRefId: null, method: "unknown", uncertaintyMeters: null },
      horizontalUncertaintyMeters: null,
      notes: area.fixtureOnly ? "Invented area fixture; not real Manhattan coverage." : "Normalized from an approved local area snapshot.",
    },
    sourceRefs: area.sourceRefs,
    provenance: area.fixtureOnly ? "generated" : "authoritative",
    confidence: { score: area.fixtureOnly ? 0 : 0.8, label: area.fixtureOnly ? "unknown" : "medium", rationale: area.fixtureOnly ? "Invented area fixture; not real boundary coverage." : "Normalized source geometry; boundary uncertainty is retained." },
    uncertainty: { horizontalMeters: null, verticalMeters: null, temporalDays: null, notes: area.uncertainty },
    freshness: area.freshness,
    attributes: {
      areaType: area.areaType,
      areaLevel: area.areaLevel,
      areaSemantics: area.semantics,
      areaLabels: JSON.stringify(area.labels),
      areaOfficialName: area.officialName,
      areaSourceRecordId: area.sourceRecordId,
      areaLicense: JSON.stringify(area.sourceLicense),
      areaUncertainty: area.uncertainty,
      fixtureOnly: area.fixtureOnly,
    },
  };
}

export class AreaSnapshotAdapter implements RuntimeCityAdapter {
  readonly city: CityAdapter;
  readonly fixtureOnly: boolean;
  private readonly areas: readonly AreaRecord[];
  private readonly features: readonly Feature[];
  private readonly byId: ReadonlyMap<string, Feature>;
  private readonly areaById: ReadonlyMap<string, AreaRecord>;
  private readonly cache = new MemoryTileCache<Feature[]>();
  private readonly loader = new DeduplicatingTileLoader(this.cache);
  private readonly tileIndex = new Map<string, Feature[]>();
  private readonly layerManifest: LayerManifest;
  private readonly report: AreaIngestionReport;

  private constructor(areas: AreaRecord[], report: AreaIngestionReport, city: CityAdapter, fixtureOnly: boolean) {
    this.areas = areas;
    this.features = areas.map(toFeature);
    this.byId = new Map(this.features.map((feature) => [feature.id, feature]));
    this.areaById = new Map(areas.map((area) => [area.canonicalId, area]));
    this.city = city;
    this.fixtureOnly = fixtureOnly;
    this.layerManifest = report.layerManifest;
    this.report = report;
    this.features.forEach((feature) => {
      const key = `areas/${tileKeyString(tileKeyForFeature(feature, this.layerManifest.tileLevel))}`;
      this.tileIndex.set(key, [...(this.tileIndex.get(key) ?? []), feature]);
    });
  }

  static async fromSnapshot(options: AreaSnapshotAdapterOptions): Promise<AreaSnapshotAdapter> {
    const city = options.city ?? manhattanAdapter;
    const registry = options.registryEntries ?? sourceRegistry;
    if (options.metadata.immutable !== true) throw new Error("Area snapshot metadata must explicitly mark the local input immutable.");
    if (!/^[a-f0-9]{64}$/i.test(options.metadata.inputChecksumSha256)) throw new Error("A 64-character SHA-256 checksum is required.");
    if (await sha256Hex(options.snapshotText) !== options.metadata.inputChecksumSha256.toLocaleLowerCase()) throw new Error("Area snapshot checksum does not match recorded metadata.");
    const rawRecords = sourceFeatures(JSON.parse(options.snapshotText));
    const sourceIds = [...new Set(rawRecords.map((item) => item?.sourceRegistryEntryId).filter((item): item is string => typeof item === "string"))];
    for (const sourceId of sourceIds) {
      const entry = registry.find((candidate) => candidate.id === sourceId) ?? (registry === sourceRegistry ? getSourceRegistryEntry(sourceId) : undefined);
      if (!entry) throw new Error(`Area source registry entry not found: ${sourceId}`);
      if (entry.approval.state !== "approved") throw new Error(`Area source registry entry ${sourceId} is pending; approval is required before ingest.`);
    }
    const bounds = boundsFor(city);
    const parsed: ParsedArea[] = [];
    const rejected: Rejection[] = [];
    const seen = new Set<string>();
    rawRecords.forEach((raw, index) => {
      const entry = registry.find((candidate) => candidate.id === raw?.sourceRegistryEntryId);
      const sourceId = typeof raw?.sourceRecordId === "string" ? raw.sourceRecordId : null;
      const reject = (code: Rejection["code"], path: string, message: string) => rejected.push({ index, sourceId, code, path, message });
      if (!entry || !record(raw)) return reject("schema-invalid", `features[${index}]`, "Area properties and an approved source registry entry are required.");
      if (entry.approval.state !== "approved") return reject("schema-invalid", `features[${index}].properties.sourceRegistryEntryId`, "Source registry entry is not approved.");
      if (!sourceId || raw.provider !== entry.provider || raw.datasetId !== entry.datasetId || seen.has(`${entry.id}|${raw.datasetId}|${sourceId}`)) return reject("schema-invalid", `features[${index}].properties.sourceRecordId`, "Provider, dataset, and source record ID must be registry-backed and unique.");
      seen.add(`${entry.id}|${raw.datasetId}|${sourceId}`);
      if (raw.termsUrl !== entry.termsUrl || !raw.attribution || !raw.licenseClass) return reject("schema-invalid", `features[${index}].properties.termsUrl`, "Terms URL, attribution, and license class are required and terms must match the registry.");
      if (!raw.officialName || !raw.areaLevel || !AREA_TYPES.includes(raw.areaType as AreaType) || !AREA_SEMANTICS.includes(raw.semantics as AreaSemantic)) return reject("schema-invalid", `features[${index}].properties`, "Official name, level, area type, and supported semantics are required.");
      if (![raw.capturedAt, raw.updatedAt, raw.observedAt].every(validTimestamp)) return reject("schema-invalid", `features[${index}].properties`, "Freshness fields must be ISO timestamps or null.");
      const geometry = normalizeGeometry(raw.geometry, bounds);
      if (!geometry) return reject("geometry-invalid", `features[${index}].geometry`, "Only WGS84 Polygon or MultiPolygon geometry intersecting the city slice is accepted.");
      const labels = raw.labels === undefined || raw.labels === null ? [] : Array.isArray(raw.labels) && raw.labels.every((label) => typeof label === "string") ? [...new Set(raw.labels)].sort() : null;
      if (labels === null) return reject("schema-invalid", `features[${index}].properties.labels`, "Optional labels must be an array of strings.");
      const freshness: Freshness = { capturedAt: raw.capturedAt ?? null, updatedAt: raw.updatedAt ?? null, observedAt: raw.observedAt ?? null, ingestedAt: options.metadata.ingestedAt };
      parsed.push({ ...raw, entry, geometry, sourceRef: sourceRef(entry, raw, options.metadata.fixtureOnly), labels, areaType: raw.areaType as AreaType, semantics: raw.semantics as AreaSemantic, coordinates: labelPoint(geometry), freshness });
    });
    const areas = parsed.sort((left, right) => `${left.entry.id}|${left.sourceRecordId}`.localeCompare(`${right.entry.id}|${right.sourceRecordId}`)).map((raw): AreaRecord => ({
      schemaVersion: DOMAIN_SCHEMA_VERSION,
      canonicalId: makeCanonicalFeatureId(city.cityId, "area", { provider: raw.provider, datasetId: raw.datasetId, sourceId: raw.sourceRecordId }),
      cityId: city.cityId,
      officialName: raw.officialName,
      areaType: raw.areaType,
      areaLevel: raw.areaLevel,
      semantics: raw.semantics,
      labels: raw.labels,
      coordinates: raw.coordinates,
      geometry: raw.geometry,
      sourceRefs: [raw.sourceRef],
      sourceRecordId: raw.sourceRecordId,
      sourceLicense: { licenseClass: raw.licenseClass, termsUrl: raw.termsUrl, attribution: raw.attribution },
      freshness: raw.freshness,
      uncertainty: options.metadata.fixtureOnly ? "Invented fixture geometry; not an official neighborhood or boundary claim." : "Source boundary accuracy and shoreline treatment must be reviewed at capture.",
      fixtureOnly: options.metadata.fixtureOnly,
    }));
    const features = areas.map(toFeature);
    const layerManifest = buildLayerManifest("areas", features, { tileLevel: 10, generatedAt: options.metadata.ingestedAt, fixtureOnly: options.metadata.fixtureOnly });
    const rejectedRecordIndices = [...new Set(rejected.map((item) => item.index))].sort((left, right) => left - right);
    const run: IngestionRun = { schemaVersion: DOMAIN_SCHEMA_VERSION, runId: `area-snapshot:${options.metadata.inputChecksumSha256.slice(0, 16)}`, adapterId: city.id, sourceRegistryEntryId: "multiple", inputFileName: options.metadata.inputFileName, inputChecksumSha256: options.metadata.inputChecksumSha256, startedAt: options.metadata.ingestedAt, finishedAt: options.metadata.ingestedAt, immutable: true, acceptedCount: parsed.length, rejectedCount: rejectedRecordIndices.length, sourceRecordCount: rawRecords.length };
    const report: AreaIngestionReport = { ...run, manifestVersion: DOMAIN_SCHEMA_VERSION, sourceRegistryEntryIds: [...new Set(parsed.map((item) => item.entry.id))].sort(), outputCrs: "EPSG:4326", acceptedAreaCount: areas.length, acceptedFeatureCount: features.length, acceptedFeatureIds: features.map((feature) => feature.id), rejected, rejectedRecordIndices, allInputRecordsAccountedFor: run.acceptedCount + run.rejectedCount === run.sourceRecordCount, layerManifest };
    return new AreaSnapshotAdapter(areas, report, city, options.metadata.fixtureOnly);
  }

  getLayerManifest(layer: RuntimeLayerId): LayerManifest { return layer === "areas" ? this.layerManifest : buildLayerManifest(layer, [], { tileLevel: 10, generatedAt: this.report.finishedAt, fixtureOnly: this.fixtureOnly }); }
  getFeature(featureId: string): Feature | undefined { return this.byId.get(featureId); }
  getArea(featureId: string): AreaRecord | undefined { return this.areaById.get(featureId); }
  getFeatures(visibility: LayerVisibility = DEFAULT_LAYER_VISIBILITY): Feature[] { return visibility.areas ? [...this.features] : []; }
  getIngestionReport(): AreaIngestionReport { return this.report; }
  cacheSize(): number { return this.cache.size(); }
  search(query: string): Feature[] {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return [];
    return this.features.filter((feature) => [feature.id, feature.name, feature.sourceRefs[0]?.sourceRecordId ?? "", String(feature.attributes.areaLabels ?? "")].some((value) => value.toLocaleLowerCase().includes(normalized))).sort((left, right) => left.id.localeCompare(right.id));
  }
  async loadLayerFeatures(layer: RuntimeLayerId): Promise<Feature[]> {
    if (layer !== "areas") return [];
    const loaded = await Promise.all(this.layerManifest.tileKeys.map((tileKey) => this.loader.load(`areas/${tileKey}`, async (cacheKey) => this.tileIndex.get(cacheKey) ?? [])));
    return [...new Map(loaded.flat().map((feature) => [feature.id, feature])).values()].sort((left, right) => left.id.localeCompare(right.id));
  }
}
