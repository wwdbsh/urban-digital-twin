import type { CityAdapter, Feature, Freshness, Geometry, IngestionRun, Position, Rejection, SourceRef } from "../domain/schema.ts";
import { DOMAIN_SCHEMA_VERSION } from "../domain/schema.ts";
import type { SourceRegistryEntry } from "../domain/schema.ts";
import { getSourceRegistryEntry, sourceRegistry } from "../data/source-registry.ts";
import { manhattanAdapter } from "../data/city-adapters.ts";
import { makeCanonicalFeatureId, sha256Hex } from "./offline.ts";
import { buildLayerManifest, DEFAULT_LAYER_VISIBILITY, type LayerManifest, type LayerVisibility, type RuntimeLayerId } from "../runtime/layers.ts";
import { DeduplicatingTileLoader, MemoryTileCache } from "../runtime/cache.ts";
import { tileKeyForFeature, tileKeyString } from "../runtime/spatial.ts";
import type { RuntimeCityAdapter } from "../runtime/fixture-adapter.ts";
import type { AccessibilityStatus, TransitFeatureKind, TransitMode, TransitServiceSemantics, TransitRecord } from "../domain/transit.ts";

export interface TransitSnapshotMetadata {
  inputFileName: string;
  inputChecksumSha256: string;
  ingestedAt: string;
  immutable: true;
  fixtureOnly: boolean;
}

export interface TransitSnapshotRecord {
  sourceRegistryEntryId: string;
  provider: string;
  datasetId: string;
  sourceRecordId: string;
  termsUrl: string;
  attribution: string;
  licenseClass: string;
  transitKind: "station" | "entrance" | "route";
  name: string;
  inputCrs: "EPSG:4326";
  geometry?: unknown;
  stationComplexId?: string | null;
  parentStationId?: string | null;
  parentStopId?: string | null;
  routeIds?: unknown;
  routeNames?: unknown;
  routeColor?: string | null;
  routeTextColor?: string | null;
  mode?: string | null;
  serviceDate?: string | null;
  serviceSemantics?: string | null;
  accessibility?: string | null;
  elevatorStatus?: string | null;
  capturedAt?: string | null;
  updatedAt?: string | null;
  observedAt?: string | null;
}

export interface TransitIngestionReport extends IngestionRun {
  manifestVersion: typeof DOMAIN_SCHEMA_VERSION;
  sourceRegistryEntryIds: string[];
  outputCrs: "EPSG:4326";
  acceptedTransitCount: number;
  acceptedFeatureCount: number;
  acceptedFeatureIds: string[];
  rejected: Rejection[];
  rejectedRecordIndices: number[];
  allInputRecordsAccountedFor: boolean;
  layerManifests: Record<"stations" | "entrances" | "routes", LayerManifest>;
}

export interface TransitSnapshotAdapterOptions {
  snapshotText: string;
  metadata: TransitSnapshotMetadata;
  city?: CityAdapter;
  registryEntries?: readonly SourceRegistryEntry[];
}

interface Bounds { west: number; east: number; south: number; north: number; }
interface ParsedTransit extends Omit<TransitSnapshotRecord, "transitKind"> {
  entry: SourceRegistryEntry;
  geometry: Geometry;
  sourceRef: SourceRef;
  freshness: Freshness;
  transitKind: "station" | "entrance" | "route";
  mode: TransitMode;
  routeIds: string[];
  routeNames: string[];
  serviceSemantics: TransitServiceSemantics;
  accessibility: AccessibilityStatus;
  elevatorStatus: "working" | "out-of-service" | "unknown";
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function validTimestamp(value: unknown): value is string | null { return value === null || value === undefined || (typeof value === "string" && !Number.isNaN(Date.parse(value))); }
function boundsFor(city: CityAdapter): Bounds {
  const points = city.boundary.coordinates[0] ?? [];
  return { west: Math.min(...points.map(([x]) => x)), east: Math.max(...points.map(([x]) => x)), south: Math.min(...points.map(([, y]) => y)), north: Math.max(...points.map(([, y]) => y)) };
}
function inBounds(point: Position, bounds: Bounds): boolean { return point[0] >= bounds.west && point[0] <= bounds.east && point[1] >= bounds.south && point[1] <= bounds.north; }
function clipSegment(a: Position, b: Position, bounds: Bounds): [Position, Position] | null {
  let t0 = 0; let t1 = 1; const dx = b[0] - a[0]; const dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - bounds.west], [dx, bounds.east - a[0]], [-dy, a[1] - bounds.south], [dy, bounds.north - a[1]]] as const) {
    if (p === 0 && q < 0) return null;
    if (p === 0) continue;
    const ratio = q / p;
    if (p < 0) { if (ratio > t1) return null; if (ratio > t0) t0 = ratio; }
    else { if (ratio < t0) return null; if (ratio < t1) t1 = ratio; }
  }
  return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
}
function clipLine(line: Position[], bounds: Bounds): Position[] | null {
  const result: Position[] = [];
  for (let index = 1; index < line.length; index += 1) {
    const segment = clipSegment(line[index - 1]!, line[index]!, bounds);
    if (!segment) continue;
    const [start, end] = segment;
    if (result.length === 0 || result[result.length - 1]![0] !== start[0] || result[result.length - 1]![1] !== start[1]) result.push(start);
    result.push(end);
  }
  return result.length >= 2 ? result : null;
}
function point(value: unknown): Position | null {
  if (!Array.isArray(value) || (value.length !== 2 && value.length !== 3) || value.some((part) => typeof part !== "number" || !Number.isFinite(part))) return null;
  const [x, y] = value as [number, number];
  return x >= -180 && x <= 180 && y >= -90 && y <= 90 ? [...value] as Position : null;
}
function line(value: unknown): Position[] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const parsed = value.map(point);
  return parsed.some((item) => item === null) ? null : parsed as Position[];
}
function normalizeGeometry(value: unknown, bounds: Bounds, kind: "station" | "entrance" | "route"): Geometry | null {
  if (!record(value) || typeof value.type !== "string") return null;
  if (kind !== "route" && value.type === "Point") {
    const coordinates = point(value.coordinates);
    return coordinates && inBounds(coordinates, bounds) ? { type: "Point", coordinates } : null;
  }
  if (kind !== "route") return null;
  if (value.type === "LineString") {
    const clipped = line(value.coordinates); const normalized = clipped && clipLine(clipped, bounds);
    return normalized ? { type: "LineString", coordinates: normalized } : null;
  }
  if (value.type === "MultiLineString" && Array.isArray(value.coordinates)) {
    const lines = value.coordinates.map((item) => line(item)).map((item) => item && clipLine(item, bounds)).filter((item): item is Position[] => item !== null);
    return lines.length ? { type: "MultiLineString", coordinates: lines } : null;
  }
  return null;
}
function list(value: unknown): string[] | null {
  const items = typeof value === "string" ? value.split(",") : value;
  if (!Array.isArray(items) || items.some((item) => typeof item !== "string" || !item.trim())) return null;
  return [...new Set(items.map((item) => item.trim()))].sort();
}
function color(value: unknown): string | null { return value === null || value === undefined || value === "" ? null : typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : undefined as never; }
function sourceRef(entry: SourceRegistryEntry, raw: TransitSnapshotRecord, fixtureOnly: boolean): SourceRef {
  return { schemaVersion: DOMAIN_SCHEMA_VERSION, id: `source-ref:${entry.id}:${raw.sourceRecordId}`, registryEntryId: entry.id, provider: raw.provider, datasetId: raw.datasetId, sourceRecordId: raw.sourceRecordId, sourceUrl: entry.canonicalUrl, licenseRefId: `license:${entry.id}`, role: fixtureOnly ? "fixture" : "primary", capturedAt: raw.capturedAt ?? null, updatedAt: raw.updatedAt ?? null, observedAt: raw.observedAt ?? null, release: null };
}
function rawRecords(value: unknown): TransitSnapshotRecord[] {
  if (!record(value) || value.type !== "FeatureCollection" || !Array.isArray(value.features)) throw new Error("Transit snapshot must be a local GeoJSON FeatureCollection.");
  return value.features.map((item) => record(item) && item.type === "Feature" && record(item.properties) ? { ...item.properties, geometry: item.geometry } as TransitSnapshotRecord : item as TransitSnapshotRecord);
}
function transitKind(kind: TransitSnapshotRecord["transitKind"]): TransitFeatureKind { return kind === "station" ? "transit-station" : kind === "entrance" ? "transit-entrance" : "transit-route"; }
function positionOf(geometry: Geometry): Position { if (geometry.type === "Point") return geometry.coordinates; if (geometry.type === "LineString") return geometry.coordinates[0]!; if (geometry.type === "MultiLineString") return geometry.coordinates[0]?.[0] ?? [0, 0]; if (geometry.type === "Polygon") return geometry.coordinates[0]?.[0] ?? [0, 0]; return [0, 0]; }
function toFeature(parsed: ParsedTransit, cityId: string, metadata: TransitSnapshotMetadata): Feature {
  const canonicalId = makeCanonicalFeatureId(cityId, transitKind(parsed.transitKind), { provider: parsed.provider, datasetId: parsed.datasetId, sourceId: parsed.sourceRecordId });
  const geometrySemantics = parsed.transitKind === "route" ? "schematic-route-centerline-not-tunnel" : "point";
  const recordValue: TransitRecord = { schemaVersion: DOMAIN_SCHEMA_VERSION, canonicalId, transitKind: transitKind(parsed.transitKind), sourceRecordId: parsed.sourceRecordId, name: parsed.name, mode: parsed.mode, stationComplexId: parsed.stationComplexId ?? null, parentStationId: parsed.parentStationId ?? null, parentStopId: parsed.parentStopId ?? null, routeIds: parsed.routeIds, routeNames: parsed.routeNames, routeColor: parsed.routeColor ?? null, routeTextColor: parsed.routeTextColor ?? null, serviceDate: parsed.serviceDate ?? null, serviceSemantics: parsed.serviceSemantics, accessibility: parsed.accessibility, elevatorStatus: parsed.elevatorStatus, geometrySemantics };
  return { schemaVersion: DOMAIN_SCHEMA_VERSION, id: canonicalId, cityId, kind: transitKind(parsed.transitKind), name: parsed.name, geometry: parsed.geometry, coordinates: positionOf(parsed.geometry), geometryProvenance: { schemaVersion: DOMAIN_SCHEMA_VERSION, sourceRefId: parsed.sourceRef.id, inputCrs: "EPSG:4326", outputCrs: "EPSG:4326", capturedAt: parsed.freshness.capturedAt, height: { schemaVersion: DOMAIN_SCHEMA_VERSION, valueMeters: null, verticalDatum: "unknown", sourceRefId: null, method: "unknown", uncertaintyMeters: null }, horizontalUncertaintyMeters: parsed.transitKind === "route" ? 20 : 10, notes: parsed.transitKind === "route" ? "Schematic route centerline; not an exact tunnel alignment." : "Point inventory location; not a platform geometry." }, sourceRefs: [parsed.sourceRef], provenance: metadata.fixtureOnly ? "generated" : "authoritative", confidence: { score: metadata.fixtureOnly ? 0.4 : 0.8, label: metadata.fixtureOnly ? "low" : "medium", rationale: metadata.fixtureOnly ? "Synthetic fixture only." : "Approved source snapshot normalized without inferring operational state." }, uncertainty: { horizontalMeters: parsed.transitKind === "route" ? 20 : 10, verticalMeters: null, temporalDays: null, notes: parsed.transitKind === "route" ? "Schematic geometry uncertainty; never use as tunnel alignment or routing graph." : "Accessibility and operational status are unknown unless explicitly sourced." }, freshness: parsed.freshness, attributes: { fixtureOnly: metadata.fixtureOnly, transitKind: parsed.transitKind, transitMode: parsed.mode, transitStationComplexId: parsed.stationComplexId ?? null, transitParentStationId: parsed.parentStationId ?? null, transitParentStopId: parsed.parentStopId ?? null, transitRouteIds: parsed.routeIds.join(","), transitRouteNames: parsed.routeNames.join(","), transitRouteColor: parsed.routeColor ?? null, transitRouteTextColor: parsed.routeTextColor ?? null, transitServiceDate: parsed.serviceDate ?? null, transitServiceSemantics: parsed.serviceSemantics, transitAccessibility: parsed.accessibility, transitElevatorStatus: parsed.elevatorStatus, transitGeometrySemantics: geometrySemantics, transitSourceLicense: JSON.stringify({ licenseClass: parsed.licenseClass, termsUrl: parsed.termsUrl, attribution: parsed.attribution }), transitRecord: JSON.stringify(recordValue) } };
}

export class TransitSnapshotAdapter implements RuntimeCityAdapter {
  readonly city: CityAdapter;
  readonly fixtureOnly: boolean;
  private readonly features: readonly Feature[];
  private readonly byId: ReadonlyMap<string, Feature>;
  private readonly layerManifests: Record<"stations" | "entrances" | "routes", LayerManifest>;
  private readonly tileIndex = new Map<string, Feature[]>();
  private readonly cache = new MemoryTileCache<Feature[]>();
  private readonly loader = new DeduplicatingTileLoader(this.cache);
  private readonly report: TransitIngestionReport;
  private constructor(features: Feature[], report: TransitIngestionReport, city: CityAdapter, fixtureOnly: boolean) {
    this.features = features; this.byId = new Map(features.map((feature) => [feature.id, feature])); this.report = report; this.city = city; this.fixtureOnly = fixtureOnly; this.layerManifests = report.layerManifests;
    for (const feature of features) { const layer = feature.kind === "transit-station" ? "stations" : feature.kind === "transit-entrance" ? "entrances" : "routes"; const key = `${layer}/${tileKeyString(tileKeyForFeature(feature, 12))}`; this.tileIndex.set(key, [...(this.tileIndex.get(key) ?? []), feature]); }
  }
  static async fromSnapshot(options: TransitSnapshotAdapterOptions): Promise<TransitSnapshotAdapter> {
    const city = options.city ?? manhattanAdapter; const registry = options.registryEntries ?? sourceRegistry;
    if (options.metadata.immutable !== true) throw new Error("Transit snapshot metadata must explicitly mark the local input immutable.");
    if (!/^[a-f0-9]{64}$/i.test(options.metadata.inputChecksumSha256)) throw new Error("A 64-character SHA-256 checksum is required.");
    if (await sha256Hex(options.snapshotText) !== options.metadata.inputChecksumSha256.toLowerCase()) throw new Error("Transit snapshot checksum does not match recorded metadata.");
    const records = rawRecords(JSON.parse(options.snapshotText)); const ids = [...new Set(records.map((recordValue) => recordValue?.sourceRegistryEntryId).filter((id): id is string => typeof id === "string"))];
    for (const id of ids) { const entry = registry.find((candidate) => candidate.id === id) ?? (registry === sourceRegistry ? getSourceRegistryEntry(id) : undefined); if (!entry) throw new Error(`Transit source registry entry not found: ${id}`); if (entry.approval.state !== "approved") throw new Error(`Transit source registry entry ${id} is pending; approval is required before ingest.`); }
    const bounds = boundsFor(city); const parsed: ParsedTransit[] = []; const rejected: Rejection[] = []; const seen = new Set<string>();
    records.forEach((raw, index) => {
      const sourceId = text(raw?.sourceRecordId); const entry = registry.find((candidate) => candidate.id === raw?.sourceRegistryEntryId); const reject = (code: Rejection["code"], path: string, message: string) => rejected.push({ index, sourceId, code, path, message });
      if (!entry || !record(raw)) return reject("schema-invalid", `features[${index}]`, "Transit properties and an approved source registry entry are required.");
      if (entry.approval.state !== "approved") return reject("schema-invalid", `features[${index}].properties.sourceRegistryEntryId`, "Source registry entry is not approved.");
      if (!sourceId || raw.provider !== entry.provider || raw.datasetId !== entry.datasetId || seen.has(`${entry.id}|${raw.datasetId}|${sourceId}`)) return reject("schema-invalid", `features[${index}].properties.sourceRecordId`, "Provider, dataset and source record ID must be registry-backed and unique.");
      seen.add(`${entry.id}|${raw.datasetId}|${sourceId}`);
      if (raw.inputCrs !== "EPSG:4326" || raw.termsUrl !== entry.termsUrl || !text(raw.attribution) || !text(raw.licenseClass) || !text(raw.name)) return reject("schema-invalid", `features[${index}].properties`, "Name, explicit WGS84 CRS, terms URL, attribution and license class are required and terms must match registry.");
      if (![raw.capturedAt, raw.updatedAt, raw.observedAt].every(validTimestamp)) return reject("schema-invalid", `features[${index}].properties`, "Freshness fields must be ISO timestamps or null.");
      if (!["station", "entrance", "route"].includes(raw.transitKind)) return reject("schema-invalid", `features[${index}].properties.transitKind`, "Transit kind must be station, entrance or route.");
      const geometry = normalizeGeometry(raw.geometry, bounds, raw.transitKind); if (!geometry) return reject(raw.transitKind === "route" ? "outside-slice" : "geometry-invalid", `features[${index}].geometry`, "Only WGS84 Point stations/entrances or clipped LineString/MultiLineString routes intersecting the documented slice are accepted.");
      const routeIds = list(raw.routeIds ?? []); const routeNames = list(raw.routeNames ?? []); if (!routeIds || !routeNames) return reject("schema-invalid", `features[${index}].properties.routeIds`, "Route IDs and names must be arrays or comma-separated strings.");
      const routeColor = raw.routeColor === undefined ? null : color(raw.routeColor); const routeTextColor = raw.routeTextColor === undefined ? null : color(raw.routeTextColor); if (routeColor === undefined || routeTextColor === undefined) return reject("schema-invalid", `features[${index}].properties.routeColor`, "Route colors must be #RRGGBB or null.");
      const modes = ["subway", "rail", "bus", "other"]; const mode = (raw.mode ?? "other") as string; if (!modes.includes(mode)) return reject("schema-invalid", `features[${index}].properties.mode`, "Unsupported transit mode.");
      const semantics = ["static-schedule", "live-operation", "schematic-route", "station-inventory"]; const serviceSemantics = (raw.serviceSemantics ?? "station-inventory") as string; if (!semantics.includes(serviceSemantics)) return reject("schema-invalid", `features[${index}].properties.serviceSemantics`, "Unsupported service semantics.");
      const accessibility = (raw.accessibility ?? "unknown") as string; if (!["accessible", "partial", "not-accessible", "unknown"].includes(accessibility)) return reject("schema-invalid", `features[${index}].properties.accessibility`, "Accessibility must remain an explicit status or unknown.");
      const elevatorStatus = (raw.elevatorStatus ?? "unknown") as string; if (!["working", "out-of-service", "unknown"].includes(elevatorStatus)) return reject("schema-invalid", `features[${index}].properties.elevatorStatus`, "Elevator status must be working, out-of-service or unknown.");
      const freshness = { capturedAt: raw.capturedAt ?? null, updatedAt: raw.updatedAt ?? null, observedAt: raw.observedAt ?? null, ingestedAt: options.metadata.ingestedAt };
      parsed.push({ ...raw, entry, geometry, sourceRef: sourceRef(entry, raw, options.metadata.fixtureOnly), freshness, transitKind: raw.transitKind, mode: mode as TransitMode, routeIds, routeNames, routeColor, routeTextColor, serviceSemantics: serviceSemantics as TransitServiceSemantics, accessibility: accessibility as AccessibilityStatus, elevatorStatus: elevatorStatus as ParsedTransit["elevatorStatus"] });
    });
    const features = parsed.sort((a, b) => `${a.entry.id}|${a.sourceRecordId}`.localeCompare(`${b.entry.id}|${b.sourceRecordId}`)).map((item) => toFeature(item, city.cityId, options.metadata));
    const layerManifests = { stations: buildLayerManifest("stations", features, { tileLevel: 12, generatedAt: options.metadata.ingestedAt, fixtureOnly: options.metadata.fixtureOnly }), entrances: buildLayerManifest("entrances", features, { tileLevel: 12, generatedAt: options.metadata.ingestedAt, fixtureOnly: options.metadata.fixtureOnly }), routes: buildLayerManifest("routes", features, { tileLevel: 12, generatedAt: options.metadata.ingestedAt, fixtureOnly: options.metadata.fixtureOnly }) };
    const rejectedRecordIndices = [...new Set(rejected.map((item) => item.index))].sort((a, b) => a - b); const run: IngestionRun = { schemaVersion: DOMAIN_SCHEMA_VERSION, runId: `transit-snapshot:${options.metadata.inputChecksumSha256.slice(0, 16)}`, adapterId: city.id, sourceRegistryEntryId: "multiple", inputFileName: options.metadata.inputFileName, inputChecksumSha256: options.metadata.inputChecksumSha256, startedAt: options.metadata.ingestedAt, finishedAt: options.metadata.ingestedAt, immutable: true, acceptedCount: parsed.length, rejectedCount: rejectedRecordIndices.length, sourceRecordCount: records.length };
    const report: TransitIngestionReport = { ...run, manifestVersion: DOMAIN_SCHEMA_VERSION, sourceRegistryEntryIds: [...new Set(parsed.map((item) => item.entry.id))].sort(), outputCrs: "EPSG:4326", acceptedTransitCount: features.length, acceptedFeatureCount: features.length, acceptedFeatureIds: features.map((feature) => feature.id), rejected, rejectedRecordIndices, allInputRecordsAccountedFor: run.acceptedCount + run.rejectedCount === run.sourceRecordCount, layerManifests };
    return new TransitSnapshotAdapter(features, report, city, options.metadata.fixtureOnly);
  }
  getLayerManifest(layer: RuntimeLayerId): LayerManifest { return layer === "stations" || layer === "entrances" || layer === "routes" ? this.layerManifests[layer] : buildLayerManifest(layer, [], { tileLevel: 12, generatedAt: this.report.finishedAt, fixtureOnly: this.fixtureOnly }); }
  getFeature(featureId: string): Feature | undefined { return this.byId.get(featureId); }
  getFeatures(visibility: LayerVisibility = DEFAULT_LAYER_VISIBILITY): Feature[] { return this.features.filter((feature) => (feature.kind === "transit-station" ? visibility.stations : feature.kind === "transit-entrance" ? visibility.entrances : visibility.routes)); }
  getIngestionReport(): TransitIngestionReport { return this.report; }
  cacheSize(): number { return this.cache.size(); }
  search(query: string): Feature[] { const normalized = query.trim().toLowerCase(); if (!normalized) return []; return this.features.map((feature) => { const sourceId = feature.sourceRefs[0]?.sourceRecordId?.toLowerCase() ?? ""; const fields = [feature.id, feature.name, sourceId, String(feature.attributes.transitStationComplexId ?? ""), String(feature.attributes.transitParentStationId ?? ""), String(feature.attributes.transitRouteIds ?? ""), String(feature.attributes.transitRouteNames ?? "")].map((value) => value.toLowerCase()); const score = sourceId === normalized || fields[0] === normalized ? 0 : fields.some((value) => value.includes(normalized)) ? 1 : Number.POSITIVE_INFINITY; return { feature, score }; }).filter((result) => Number.isFinite(result.score)).sort((a, b) => a.score - b.score || a.feature.id.localeCompare(b.feature.id)).map((result) => result.feature); }
  async loadLayerFeatures(layer: RuntimeLayerId): Promise<Feature[]> { if (!(layer in this.layerManifests)) return []; const manifest = this.layerManifests[layer as keyof typeof this.layerManifests]; const loaded = await Promise.all(manifest.tileKeys.map((key) => this.loader.load(`${layer}/${key}`, async (cacheKey) => this.tileIndex.get(cacheKey) ?? []))); return [...new Map(loaded.flat().map((feature) => [feature.id, feature])).values()].sort((a, b) => a.id.localeCompare(b.id)); }
}
