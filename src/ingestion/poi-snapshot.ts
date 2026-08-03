import type {
  CityAdapter,
  Confidence,
  Feature,
  IngestionRun,
  Position,
  Rejection,
  SourceRef,
} from "../domain/schema.ts";
import { DOMAIN_SCHEMA_VERSION } from "../domain/schema.ts";
import type { SourceRegistryEntry } from "../domain/schema.ts";
import { getSourceRegistryEntry, sourceRegistry } from "../data/source-registry.ts";
import { manhattanAdapter } from "../data/city-adapters.ts";
import { makeCanonicalFeatureId, sha256Hex } from "./offline.ts";
import {
  isPlaceCategory,
  PLACE_CATEGORIES,
  type PlaceAccessibility,
  type PlaceAddress,
  type PlaceCategory,
  type PlaceConflict,
  type PlaceContact,
  type PlaceOpeningHours,
  type PlaceRecord,
  type PlaceSourceLicense,
  validatePlaceRecord,
} from "../domain/places.ts";
import type { LayerManifest, LayerVisibility, RuntimeLayerId } from "../runtime/layers.ts";
import { buildLayerManifest, DEFAULT_LAYER_VISIBILITY } from "../runtime/layers.ts";
import { DeduplicatingTileLoader, MemoryTileCache } from "../runtime/cache.ts";
import { tileKeyForFeature, tileKeyString } from "../runtime/spatial.ts";
import type { RuntimeCityAdapter } from "../runtime/fixture-adapter.ts";

export interface PoiSnapshotMetadata {
  inputFileName: string;
  inputChecksumSha256: string;
  ingestedAt: string;
  immutable: true;
  fixtureOnly: boolean;
}

export interface PoiSnapshotRecord {
  sourceRegistryEntryId: string;
  provider: string;
  datasetId: string;
  sourceRecordId: string;
  termsUrl: string;
  attribution: string;
  licenseClass: string;
  matchKey?: string | null;
  name?: string | null;
  categories?: unknown;
  coordinates?: unknown;
  geometry?: unknown;
  address?: Partial<PlaceAddress> | null;
  contact?: Partial<PlaceContact> | null;
  openingHours?: Partial<PlaceOpeningHours> | null;
  cuisine?: string | null;
  brand?: string | null;
  accessibility?: Partial<PlaceAccessibility> | null;
  capturedAt?: string | null;
  updatedAt?: string | null;
  observedAt?: string | null;
}

export interface PoiIngestionReport extends IngestionRun {
  manifestVersion: typeof DOMAIN_SCHEMA_VERSION;
  sourceRegistryEntryIds: string[];
  outputCrs: "EPSG:4326";
  acceptedPlaceCount: number;
  acceptedFeatureCount: number;
  acceptedFeatureIds: string[];
  rejected: Rejection[];
  rejectedRecordIndices: number[];
  allInputRecordsAccountedFor: boolean;
  layerManifest: LayerManifest;
}

export interface PoiSnapshotAdapterOptions {
  snapshotText: string;
  metadata: PoiSnapshotMetadata;
  city?: CityAdapter;
  registryEntries?: readonly SourceRegistryEntry[];
}

interface ParsedRecord extends PoiSnapshotRecord {
  sourceRef: SourceRef;
  sourceLicense: PlaceSourceLicense;
  coordinates: Position;
  categories: PlaceCategory[];
  matchKey: string;
}

interface PoiCollection {
  records: unknown[];
}

const allowedAccessibility = new Set(["yes", "no", "limited", "unknown"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return value === null || value === undefined || value === "" ? null : typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function validTimestamp(value: unknown): value is string | null {
  return value === null || value === undefined || (typeof value === "string" && !Number.isNaN(Date.parse(value)));
}

function point(value: unknown): Position | null {
  const coordinates = isRecord(value) && value.type === "Point" ? value.coordinates : value;
  if (!Array.isArray(coordinates) || (coordinates.length !== 2 && coordinates.length !== 3) || coordinates.some((coordinate) => typeof coordinate !== "number" || !Number.isFinite(coordinate))) return null;
  const [longitude, latitude] = coordinates as [number, number];
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return null;
  return [...coordinates] as Position;
}

function parseCategories(value: unknown): PlaceCategory[] | null {
  if (value === undefined || value === null) return [];
  const values = typeof value === "string" ? value.split(",").map((item) => item.trim()) : value;
  if (!Array.isArray(values) || values.some((item) => !isPlaceCategory(item))) return null;
  return [...new Set(values)].sort();
}

function parseAddress(value: unknown): Partial<PlaceAddress> {
  if (!isRecord(value)) return {};
  return value;
}

function parseContact(value: unknown): Partial<PlaceContact> {
  if (!isRecord(value)) return {};
  return value;
}

function parseHours(value: unknown): Partial<PlaceOpeningHours> {
  if (!isRecord(value)) return {};
  return value;
}

function parseAccessibility(value: unknown): Partial<PlaceAccessibility> {
  if (!isRecord(value)) return {};
  return value;
}

function asCollection(value: unknown): PoiCollection {
  if (isRecord(value) && value.type === "FeatureCollection" && Array.isArray(value.features)) {
    return {
      records: value.features.map((feature) => {
        if (!isRecord(feature)) return feature;
        const properties = isRecord(feature.properties) ? feature.properties : {};
        return { ...properties, geometry: feature.geometry };
      }),
    };
  }
  if (isRecord(value) && Array.isArray(value.records)) return { records: value.records };
  throw new Error("POI snapshot must be a local JSON records envelope or GeoJSON FeatureCollection.");
}

function sourceKey(entry: SourceRegistryEntry, raw: PoiSnapshotRecord): string {
  return `${entry.id}|${raw.provider}|${raw.datasetId}|${raw.sourceRecordId}`;
}

function sourceRefFor(entry: SourceRegistryEntry, raw: PoiSnapshotRecord, fixtureOnly: boolean): SourceRef {
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

function unknownAddress(): PlaceAddress {
  return { formatted: null, line1: null, line2: null, locality: null, region: null, postalCode: null, countryCode: null };
}

function unknownContact(): PlaceContact {
  return { website: null, phone: null, email: null };
}

function unknownHours(): PlaceOpeningHours {
  return { timezone: null, weekdayText: null, periods: null, isOpenNow: null };
}

function unknownAccessibility(): PlaceAccessibility {
  return { wheelchair: "unknown", entrance: "unknown", notes: null };
}

function scalar(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value) ?? null;
}

function chooseField<T>(records: ParsedRecord[], field: string, read: (record: ParsedRecord) => T | null): { value: T | null; conflict?: PlaceConflict } {
  const values = records.map((record) => ({ record, value: read(record) })).filter((item): item is { record: ParsedRecord; value: T } => item.value !== null && item.value !== undefined);
  if (values.length === 0) return { value: null };
  const distinct = [...new Set(values.map((item) => scalar(item.value)))].sort();
  const selected = values[0]?.value ?? null;
  if (distinct.length <= 1) return { value: selected };
  return {
    value: selected,
    conflict: {
      field,
      sourceRefIds: values.map((item) => item.record.sourceRef.id).sort(),
      values: distinct.map((value) => value ?? "null"),
    },
  };
}

function chooseString(records: ParsedRecord[], field: string, read: (record: ParsedRecord) => string | null, conflicts: PlaceConflict[]): string | null {
  const result = chooseField(records, field, read);
  if (result.conflict) conflicts.push(result.conflict);
  return result.value;
}

function chooseNested<T extends Record<string, unknown>>(records: ParsedRecord[], field: string, read: (record: ParsedRecord) => T, conflicts: PlaceConflict[]): T {
  const output: Record<string, unknown> = {};
  const keys = new Set(records.flatMap((record) => Object.keys(read(record))));
  keys.forEach((key) => {
    const values = records.map((record) => ({ record, value: read(record)[key] })).filter((item) => item.value !== null && item.value !== undefined);
    const distinct = [...new Set(values.map((item) => JSON.stringify(item.value)))].sort();
    output[key] = values[0]?.value ?? null;
    if (distinct.length > 1) conflicts.push({
      field: `${field}.${key}`,
      sourceRefIds: values.map((item) => item.record.sourceRef.id).sort(),
      values: distinct.map((value) => value ?? "null"),
    });
  });
  return output as T;
}

function confidenceFor(place: PlaceRecord): Confidence {
  if (place.fixtureOnly) return { score: 0, label: "unknown", rationale: "Invented place fixture; not evidence of Manhattan coverage." };
  if (place.conflicts.length > 0) return { score: 0.55, label: "medium", rationale: "Multiple approved sources disagree; every conflict remains visible in provenance." };
  return { score: 0.8, label: "medium", rationale: "Normalized source record; field completeness and directory coverage remain source-dependent." };
}

function toFeature(place: PlaceRecord): Feature {
  const primary = place.sourceRefs[0];
  const name = place.name ?? "Unnamed place";
  const feature: Feature = {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    id: place.canonicalId,
    cityId: place.cityId,
    kind: "poi",
    name,
    geometry: { type: "Point", coordinates: place.coordinates },
    coordinates: place.coordinates,
    geometryProvenance: {
      schemaVersion: DOMAIN_SCHEMA_VERSION,
      sourceRefId: primary?.id ?? "unknown",
      inputCrs: "EPSG:4326",
      outputCrs: "EPSG:4326",
      capturedAt: place.freshness.capturedAt,
      height: { schemaVersion: DOMAIN_SCHEMA_VERSION, valueMeters: null, verticalDatum: "unknown", sourceRefId: null, method: "unknown", uncertaintyMeters: null },
      horizontalUncertaintyMeters: null,
      notes: place.fixtureOnly ? "Invented local place fixture; not real Manhattan coverage." : "Normalized from an approved local place snapshot.",
    },
    sourceRefs: place.sourceRefs,
    provenance: place.fixtureOnly ? "generated" : place.sourceRefs.length > 1 ? "derived" : "authoritative",
    confidence: confidenceFor(place),
    uncertainty: { horizontalMeters: null, verticalMeters: null, temporalDays: null, notes: "Source did not provide a numeric uncertainty value." },
    freshness: place.freshness,
    attributes: {
      placeCategories: place.categories.join(","),
      placeName: place.name,
      placeAddress: place.address.formatted,
      placeWebsite: place.contact.website,
      placePhone: place.contact.phone,
      placeCuisine: place.cuisine,
      placeBrand: place.brand,
      placeOpeningHours: place.openingHours.weekdayText ? JSON.stringify(place.openingHours.weekdayText) : null,
      placeAccessibility: place.accessibility.wheelchair,
      placeSourceRecordIds: JSON.stringify(place.sourceRecordIds),
      placeConflicts: JSON.stringify(place.conflicts),
      placeLicenses: JSON.stringify(place.sourceLicenses),
      fixtureOnly: place.fixtureOnly,
    },
  };
  return feature;
}

export class PoiSnapshotAdapter implements RuntimeCityAdapter {
  readonly city: CityAdapter;
  readonly fixtureOnly: boolean;
  private readonly features: readonly Feature[];
  private readonly places: readonly PlaceRecord[];
  private readonly byId: ReadonlyMap<string, Feature>;
  private readonly placeById: ReadonlyMap<string, PlaceRecord>;
  private readonly cache = new MemoryTileCache<Feature[]>();
  private readonly loader = new DeduplicatingTileLoader(this.cache);
  private readonly tileIndex = new Map<string, Feature[]>();
  private readonly layerManifest: LayerManifest;
  private readonly report: PoiIngestionReport;

  private constructor(places: PlaceRecord[], report: PoiIngestionReport, city: CityAdapter, fixtureOnly: boolean) {
    this.places = places;
    this.features = places.map(toFeature);
    this.byId = new Map(this.features.map((feature) => [feature.id, feature]));
    this.placeById = new Map(places.map((place) => [place.canonicalId, place]));
    this.city = city;
    this.fixtureOnly = fixtureOnly;
    this.layerManifest = report.layerManifest;
    this.report = report;
    this.features.forEach((feature) => {
      const key = `pois/${tileKeyString(tileKeyForFeature(feature, this.layerManifest.tileLevel))}`;
      const bucket = this.tileIndex.get(key) ?? [];
      bucket.push(feature);
      this.tileIndex.set(key, bucket);
    });
  }

  static async fromSnapshot(options: PoiSnapshotAdapterOptions): Promise<PoiSnapshotAdapter> {
    const city = options.city ?? manhattanAdapter;
    const registry = options.registryEntries ?? sourceRegistry;
    if (options.metadata.immutable !== true) throw new Error("POI snapshot metadata must explicitly mark the local input immutable.");
    if (!/^[a-f0-9]{64}$/i.test(options.metadata.inputChecksumSha256)) throw new Error("A 64-character SHA-256 checksum is required.");
    const actualChecksum = await sha256Hex(options.snapshotText);
    if (actualChecksum.toLocaleLowerCase() !== options.metadata.inputChecksumSha256.toLocaleLowerCase()) throw new Error("POI snapshot checksum does not match recorded metadata.");
    const collection = asCollection(JSON.parse(options.snapshotText));
    const rawRecords = collection.records as PoiSnapshotRecord[];
    const sourceIds = [...new Set(rawRecords.map((record) => record?.sourceRegistryEntryId).filter((value): value is string => typeof value === "string"))];
    for (const sourceId of sourceIds) {
      const entry = registry.find((candidate) => candidate.id === sourceId) ?? (registry === sourceRegistry ? getSourceRegistryEntry(sourceId) : undefined);
      if (!entry) throw new Error(`POI source registry entry not found: ${sourceId}`);
      if (entry.approval.state !== "approved") throw new Error(`POI source registry entry ${sourceId} is pending; approval is required before ingest.`);
    }
    const bounds = {
      west: Math.min(...(city.boundary.coordinates[0] ?? []).map(([longitude]) => longitude)),
      east: Math.max(...(city.boundary.coordinates[0] ?? []).map(([longitude]) => longitude)),
      south: Math.min(...(city.boundary.coordinates[0] ?? []).map(([, latitude]) => latitude)),
      north: Math.max(...(city.boundary.coordinates[0] ?? []).map(([, latitude]) => latitude)),
    };
    const parsed: ParsedRecord[] = [];
    const rejected: Rejection[] = [];
    const seen = new Set<string>();
    rawRecords.forEach((raw, index) => {
      const entry = registry.find((candidate) => candidate.id === raw?.sourceRegistryEntryId);
      const sourceId = typeof raw?.sourceRecordId === "string" ? raw.sourceRecordId : null;
      const reject = (code: Rejection["code"], path: string, message: string) => rejected.push({ index, sourceId, code, path, message });
      if (!entry || !raw || typeof raw !== "object") return reject("schema-invalid", `records[${index}]`, "Source registry entry and record object are required.");
      if (entry.approval.state !== "approved") return reject("schema-invalid", `records[${index}].sourceRegistryEntryId`, "Source registry entry is not approved.");
      if (!sourceId || raw.provider !== entry.provider || raw.datasetId !== entry.datasetId) return reject("schema-invalid", `records[${index}]`, "Source provider, dataset, and sourceRecordId must match registry-backed metadata.");
      if (raw.termsUrl !== entry.termsUrl || typeof raw.attribution !== "string" || raw.attribution.length === 0 || typeof raw.licenseClass !== "string" || raw.licenseClass.length === 0) return reject("schema-invalid", `records[${index}]`, "Per-record terms URL, attribution, and license class are required and terms must match the registry.");
      const sourceKeyValue = sourceKey(entry, raw);
      if (seen.has(sourceKeyValue)) return reject("schema-invalid", `records[${index}].sourceRecordId`, "Duplicate source/provider/dataset record ID; reconciliation cannot silently deduplicate it.");
      seen.add(sourceKeyValue);
      const coordinates = point(raw.coordinates ?? raw.geometry);
      if (!coordinates) return reject("geometry-invalid", `records[${index}].geometry`, "A finite WGS84 Point geometry is required.");
      if (coordinates[0] < bounds.west || coordinates[0] > bounds.east || coordinates[1] < bounds.south || coordinates[1] > bounds.north) return reject("outside-slice", `records[${index}].geometry`, "Place is outside the documented Manhattan vertical slice.");
      const categories = parseCategories(raw.categories);
      if (!categories) return reject("schema-invalid", `records[${index}].categories`, `Categories must use ${PLACE_CATEGORIES.join(", ")}.`);
      if (![raw.capturedAt, raw.updatedAt, raw.observedAt].every(validTimestamp)) return reject("schema-invalid", `records[${index}]`, "Freshness fields must be ISO timestamps or null.");
      parsed.push({
        ...raw,
        sourceRef: sourceRefFor(entry, raw, options.metadata.fixtureOnly),
        sourceLicense: { sourceRefId: `source-ref:${entry.id}:${sourceId}`, licenseClass: raw.licenseClass, termsUrl: raw.termsUrl, attribution: raw.attribution },
        coordinates,
        categories,
        matchKey: text(raw.matchKey) ?? sourceKeyValue,
      });
    });
    const groups = new Map<string, ParsedRecord[]>();
    parsed.forEach((record) => groups.set(record.matchKey, [...(groups.get(record.matchKey) ?? []), record]));
    const places = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([matchKey, records]) => {
      const sorted = [...records].sort((left, right) => sourceKey({ id: left.sourceRegistryEntryId } as SourceRegistryEntry, left).localeCompare(sourceKey({ id: right.sourceRegistryEntryId } as SourceRegistryEntry, right)));
      const conflicts: PlaceConflict[] = [];
      const address = chooseNested(sorted, "address", (record) => ({ ...unknownAddress(), ...(parseAddress(record.address) as Partial<PlaceAddress>) }), conflicts) as PlaceAddress;
      const contact = chooseNested(sorted, "contact", (record) => ({ ...unknownContact(), ...(parseContact(record.contact) as Partial<PlaceContact>) }), conflicts) as PlaceContact;
      const openingHours = chooseNested(sorted, "openingHours", (record) => ({ ...unknownHours(), ...(parseHours(record.openingHours) as Partial<PlaceOpeningHours>) }), conflicts) as PlaceOpeningHours;
      const accessibility = chooseNested(sorted, "accessibility", (record) => ({ ...unknownAccessibility(), ...(parseAccessibility(record.accessibility) as Partial<PlaceAccessibility>) }), conflicts) as PlaceAccessibility;
      if (!allowedAccessibility.has(accessibility.wheelchair)) accessibility.wheelchair = "unknown";
      if (!allowedAccessibility.has(accessibility.entrance)) accessibility.entrance = "unknown";
      const sourceRefs = sorted.map((record) => record.sourceRef);
      const place: PlaceRecord = {
        schemaVersion: DOMAIN_SCHEMA_VERSION,
        canonicalId: makeCanonicalFeatureId(city.cityId, "poi", { provider: "reconciled", datasetId: "place", sourceId: matchKey }),
        cityId: city.cityId,
        name: chooseString(sorted, "name", (record) => text(record.name), conflicts),
        categories: [...new Set(sorted.flatMap((record) => record.categories))].sort(),
        coordinates: sorted[0]?.coordinates ?? [0, 0],
        address,
        contact,
        openingHours,
        cuisine: chooseString(sorted, "cuisine", (record) => text(record.cuisine), conflicts),
        brand: chooseString(sorted, "brand", (record) => text(record.brand), conflicts),
        accessibility,
        freshness: {
          capturedAt: chooseString(sorted, "capturedAt", (record) => record.capturedAt ?? null, conflicts),
          updatedAt: chooseString(sorted, "updatedAt", (record) => record.updatedAt ?? null, conflicts),
          observedAt: chooseString(sorted, "observedAt", (record) => record.observedAt ?? null, conflicts),
          ingestedAt: options.metadata.ingestedAt,
        },
        sourceRefs,
        sourceLicenses: sorted.map((record) => record.sourceLicense),
        conflicts,
        sourceRecordIds: sorted.map((record) => record.sourceRecordId).sort(),
        fixtureOnly: options.metadata.fixtureOnly,
      };
      const result = validatePlaceRecord(place);
      if (!result.ok) throw new Error(`Generated invalid PlaceRecord: ${result.issues.map((item) => `${item.path} ${item.message}`).join("; ")}`);
      return result.value;
    });
    const features = places.map(toFeature);
    const layerManifest = buildLayerManifest("pois", features, { tileLevel: 12, generatedAt: options.metadata.ingestedAt, fixtureOnly: options.metadata.fixtureOnly });
    const rejectedRecordIndices = [...new Set(rejected.map((item) => item.index))].sort((left, right) => left - right);
    const run: IngestionRun = {
      schemaVersion: DOMAIN_SCHEMA_VERSION,
      runId: `poi-snapshot:${options.metadata.inputChecksumSha256.slice(0, 16)}`,
      adapterId: city.id,
      sourceRegistryEntryId: "multiple",
      inputFileName: options.metadata.inputFileName,
      inputChecksumSha256: options.metadata.inputChecksumSha256,
      startedAt: options.metadata.ingestedAt,
      finishedAt: options.metadata.ingestedAt,
      immutable: true,
      acceptedCount: parsed.length,
      rejectedCount: rejectedRecordIndices.length,
      sourceRecordCount: rawRecords.length,
    };
    const report: PoiIngestionReport = {
      ...run,
      manifestVersion: DOMAIN_SCHEMA_VERSION,
      sourceRegistryEntryIds: [...new Set(parsed.map((record) => record.sourceRegistryEntryId))].sort(),
      outputCrs: "EPSG:4326",
      acceptedPlaceCount: places.length,
      acceptedFeatureCount: features.length,
      acceptedFeatureIds: features.map((feature) => feature.id),
      rejected,
      rejectedRecordIndices,
      allInputRecordsAccountedFor: run.acceptedCount + run.rejectedCount === run.sourceRecordCount,
      layerManifest,
    };
    return new PoiSnapshotAdapter(places, report, city, options.metadata.fixtureOnly);
  }

  getLayerManifest(layer: RuntimeLayerId): LayerManifest {
    if (layer === "pois") return this.layerManifest;
    return buildLayerManifest("buildings", [], { tileLevel: 12, generatedAt: this.report.finishedAt, fixtureOnly: this.fixtureOnly });
  }

  getFeature(featureId: string): Feature | undefined { return this.byId.get(featureId); }
  getPlace(featureId: string): PlaceRecord | undefined { return this.placeById.get(featureId); }
  getPlaces(categories: readonly PlaceCategory[] = []): PlaceRecord[] {
    return this.places.filter((place) => categories.length === 0 || categories.every((category) => place.categories.includes(category)));
  }
  getFeatures(visibility: LayerVisibility = DEFAULT_LAYER_VISIBILITY): Feature[] { return visibility.pois ? [...this.features] : []; }
  getIngestionReport(): PoiIngestionReport { return this.report; }
  cacheSize(): number { return this.cache.size(); }

  search(query: string): Feature[] {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return [];
    return this.features.map((feature) => {
      const place = this.placeById.get(feature.id);
      const fields = [feature.id, feature.name, ...(place?.sourceRecordIds ?? []), ...(place?.categories ?? []), place?.address.formatted ?? "", place?.brand ?? "", place?.cuisine ?? ""].map((field) => field.toLocaleLowerCase());
      const score = fields[0] === normalized || fields.slice(2).includes(normalized) ? 0 : fields.some((field) => field.includes(normalized)) ? 1 : Number.POSITIVE_INFINITY;
      return { feature, score };
    }).filter((result) => Number.isFinite(result.score)).sort((left, right) => left.score - right.score || left.feature.id.localeCompare(right.feature.id)).map((result) => result.feature);
  }

  async loadLayerFeatures(layer: RuntimeLayerId): Promise<Feature[]> {
    if (layer === "buildings") return [];
    const loaded = await Promise.all(this.layerManifest.tileKeys.map((tileKey) => this.loader.load(`pois/${tileKey}`, async (cacheKey) => this.tileIndex.get(cacheKey) ?? [])));
    return [...new Map(loaded.flat().map((feature) => [feature.id, feature])).values()].sort((left, right) => left.id.localeCompare(right.id));
  }
}
