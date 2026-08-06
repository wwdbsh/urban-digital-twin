import { manhattanAdapter } from "../data/city-adapters.ts";
import type {
  CityAdapter,
  Feature,
  Geometry,
  Position,
  SourceRef,
  TravelContextLayerId,
  TravelContextRecordKind,
  TravelContextSearchSummary,
} from "../domain/schema.ts";
import { validateFeature } from "../domain/schema.ts";
import {
  TRAVEL_CONTEXT_BUDGETS,
  TRAVEL_CONTEXT_RELEASE_ID,
  TRAVEL_CONTEXT_TILE_LEVEL,
  isTravelContextExactIdentifier,
  normalizeTravelContextQuery,
  selectTravelContextSearchPrefixes,
  travelContextQueryTokens,
  validateTravelContextReleaseManifest,
  type TravelContextDetailIndexEntry,
  type TravelContextGeometryShardManifest,
  type TravelContextReleaseManifest,
  type TravelContextSearchShardManifest,
} from "../release/travel-context-release.ts";
import { MANHATTAN_CIVIC_APPROVAL_EVIDENCE } from "../data/source-registry.ts";
import { CitywideLruCache, CitywideRequestPool, type CitywideSharedRequestBudget } from "../release/citywide-release.ts";
import { DEFAULT_LAYER_VISIBILITY, layerForFeature, type LayerManifest, type LayerVisibility, type RuntimeLayerId } from "./layers.ts";
import type { RuntimeCityAdapter } from "./fixture-adapter.ts";
import { sha256Hex } from "../ingestion/offline.ts";
import {
  normalizeViewportRefreshRequest,
  viewportBoundsIntersect,
  type ViewportGroundCenter,
  type ViewportRefreshInput,
} from "./viewport-footprint.ts";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export type TravelContextFault = "parks-geometry" | "lpc-detail";

type CompactGeometryRecord = {
  p: string;
  l: TravelContextLayerId;
  k: TravelContextRecordKind;
  n: string | null;
  g: Geometry | null;
  c: Position | null;
  s: string[];
};

type CompactDetailRecord = {
  p: string;
  l: TravelContextLayerId;
  k: TravelContextRecordKind;
  n: string | null;
  c: Position | null;
  s: string[];
  f: { capturedAt: string | null; updatedAt: string | null; observedAt: string | null; ingestedAt: string };
  u: string;
  a: Record<string, unknown>;
  ot: string[];
  o: unknown[][];
};

interface LoadedShard {
  ref: string;
  payload: unknown;
  byteSize: number;
}

export interface TravelContextRuntimeMetrics {
  visibleShardCount: number;
  requestedShardCount: number;
  loadedFeatureCount: number;
  loadedBytes: number;
  maxConcurrentRequests: number;
  activeRequests: number;
  failedRequestCount: number;
  cancelledRequestCount: number;
  staleResultCount: number;
  retainedSummaryCount: number;
  retainedFeatureCount: number;
  retainedDetailCount: number;
  detailIndexEntryCount: number;
  cacheEntries: number;
  cacheEvictions: number;
  failedLayers: RuntimeLayerId[];
  dedupedRefreshCount?: number;
}

export interface TravelContextRuntimeOptions {
  allowFixture?: boolean;
  fault?: TravelContextFault | null;
  sharedBudget?: CitywideSharedRequestBudget | null;
  /** A shared cache is supplied only by an approved composed runtime. */
  sharedCache?: CitywideLruCache<unknown>;
  cacheNamespace?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPosition(value: unknown): value is Position {
  return Array.isArray(value) && (value.length === 2 || value.length === 3) && value.every((part) => typeof part === "number" && Number.isFinite(part));
}

function isGeometry(value: unknown): value is Geometry {
  if (!isRecord(value) || typeof value.type !== "string" || !Array.isArray(value.coordinates)) return false;
  const validPosition = (part: unknown): part is Position => isPosition(part);
  if (value.type === "Point") return validPosition(value.coordinates);
  if (value.type === "LineString" || value.type === "MultiLineString" || value.type === "Polygon") {
    if (!Array.isArray(value.coordinates)) return false;
    const walk = (parts: unknown[]): boolean => parts.every((part) => validPosition(part) || (Array.isArray(part) && walk(part)));
    return walk(value.coordinates);
  }
  if (value.type === "MultiPolygon") {
    return value.coordinates.every((polygon) => Array.isArray(polygon) && polygon.every((ring) => Array.isArray(ring) && ring.every(validPosition)));
  }
  return false;
}

function isLayerId(value: unknown): value is TravelContextLayerId {
  return value === "buildings" || value === "restaurants" || value === "statistical-areas" || value === "parks" || value === "landmarks";
}

function isRecordKind(value: unknown): value is TravelContextRecordKind {
  return value === "building" || value === "restaurant" || value === "statistical-area" || value === "park" || value === "landmark-record";
}

function runtimeLayerForTravelLayer(layerId: TravelContextLayerId): RuntimeLayerId {
  if (layerId === "restaurants") return "pois";
  if (layerId === "buildings") return "buildings";
  return layerId;
}

function compactGeometry(value: unknown): CompactGeometryRecord | null {
  if (isRecord(value) && typeof value.p === "string" && isLayerId(value.l) && isRecordKind(value.k) && (value.n === null || typeof value.n === "string") && (value.g === null || isGeometry(value.g)) && (value.c === null || isPosition(value.c)) && Array.isArray(value.s) && value.s.every((item) => typeof item === "string")) return value as unknown as CompactGeometryRecord;
  if (isRecord(value) && isRecord(value.identity) && typeof value.identity.canonicalId === "string" && isLayerId(value.layerId) && isRecordKind(value.kind) && (value.name === null || typeof value.name === "string") && (value.geometry === null || isGeometry(value.geometry)) && (value.coordinates === null || isPosition(value.coordinates)) && Array.isArray(value.identity.sourceRecordIds) && value.identity.sourceRecordIds.every((item) => typeof item === "string")) {
    return { p: value.identity.canonicalId, l: value.layerId, k: value.kind, n: value.name, g: value.geometry, c: value.coordinates, s: value.identity.sourceRecordIds };
  }
  return null;
}

function compactDetail(value: unknown): CompactDetailRecord | null {
  if (isRecord(value) && typeof value.p === "string" && isLayerId(value.l) && isRecordKind(value.k) && (value.n === null || typeof value.n === "string") && (value.c === null || isPosition(value.c)) && Array.isArray(value.s) && value.s.every((item) => typeof item === "string") && isRecord(value.f) && (value.f.capturedAt === null || typeof value.f.capturedAt === "string") && (value.f.updatedAt === null || typeof value.f.updatedAt === "string") && (value.f.observedAt === null || typeof value.f.observedAt === "string") && typeof value.f.ingestedAt === "string" && typeof value.u === "string" && isRecord(value.a) && Array.isArray(value.ot) && value.ot.every((item) => typeof item === "string") && Array.isArray(value.o) && value.o.every((row) => Array.isArray(row))) return value as unknown as CompactDetailRecord;
  if (isRecord(value) && isRecord(value.identity) && typeof value.identity.canonicalId === "string" && isLayerId(value.layerId) && isRecordKind(value.kind) && (value.name === null || typeof value.name === "string") && (value.coordinates === null || isPosition(value.coordinates)) && Array.isArray(value.identity.sourceRecordIds) && value.identity.sourceRecordIds.every((item) => typeof item === "string") && isRecord(value.freshness) && typeof value.freshness.ingestedAt === "string" && typeof value.uncertainty === "string" && isRecord(value.attributes)) {
    return { p: value.identity.canonicalId, l: value.layerId, k: value.kind, n: value.name, c: value.coordinates, s: value.identity.sourceRecordIds, f: value.freshness as CompactDetailRecord["f"], u: value.uncertainty, a: value.attributes, ot: [], o: [] };
  }
  return null;
}

function compactSummary(value: unknown): TravelContextSearchSummary | null {
  if (!isRecord(value) || typeof value.canonicalId !== "string" || !isLayerId(value.layerId) || !isRecordKind(value.kind) || (value.name !== null && typeof value.name !== "string") || !Array.isArray(value.searchableText) || !value.searchableText.every((item) => typeof item === "string") || !Array.isArray(value.sourceIdentifiers) || !value.sourceIdentifiers.every((item) => typeof item === "string") || (value.coordinates !== null && !isPosition(value.coordinates)) || !Array.isArray(value.geometryShardRefs) || !value.geometryShardRefs.every((item) => typeof item === "string") || typeof value.detailShardRef !== "string") return null;
  return value as unknown as TravelContextSearchSummary;
}

function normalizeAttribute(value: unknown): string | number | boolean | null {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return JSON.stringify(value);
  if (isRecord(value)) return JSON.stringify(value);
  return null;
}

function attributesFromRecord(source: Record<string, unknown>): Record<string, string | number | boolean | null> {
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [key, normalizeAttribute(value)]));
}

function sourceRecordIdFromValue(value: string): string {
  return value.startsWith("source-ref:") ? value.split(":").at(-1) ?? value : value;
}

function layerSourceId(manifest: TravelContextReleaseManifest, layerId: TravelContextLayerId): string {
  const layer = manifest.layers.find((item) => item.id === layerId);
  const source = layer?.sourceRegistryEntryIds[0];
  if (!source) throw new Error(`Travel-context release is missing source registry entry for ${layerId}.`);
  return source;
}

function sourceSnapshot(manifest: TravelContextReleaseManifest, registryEntryId: string): TravelContextReleaseManifest["sourceSnapshots"][number] {
  const snapshot = manifest.sourceSnapshots.find((item) => item.registryEntryId === registryEntryId);
  if (!snapshot) throw new Error(`Travel-context release is missing source snapshot ${registryEntryId}.`);
  return snapshot;
}

function sourceRefsFor(manifest: TravelContextReleaseManifest, layerId: TravelContextLayerId, sourceRecordIds: readonly string[]): SourceRef[] {
  const registryEntryId = layerSourceId(manifest, layerId);
  const snapshot = sourceSnapshot(manifest, registryEntryId);
  const ids = [...new Set(sourceRecordIds.filter((value) => value.length > 0))];
  return (ids.length > 0 ? ids : ["unknown"]).map((sourceRecordId) => ({
    schemaVersion: "1.0",
    id: `source-ref:${registryEntryId}:${sourceRecordId}`,
    registryEntryId,
    provider: snapshot.provider,
    datasetId: snapshot.datasetId,
    sourceRecordId: sourceRecordIdFromValue(sourceRecordId),
    sourceUrl: snapshot.sourceUrl,
    licenseRefId: `license:${registryEntryId}`,
    role: "primary",
    capturedAt: snapshot.captureTimestamp,
    updatedAt: snapshot.sourceUpdatedAt,
    observedAt: snapshot.captureTimestamp,
    release: manifest.releaseId,
  }));
}

function kindLabel(kind: TravelContextRecordKind): string {
  if (kind === "statistical-area") return "2020 NTA (statistical)";
  if (kind === "park") return "NYC Parks-managed property";
  if (kind === "landmark-record") return "LPC landmark record";
  if (kind === "restaurant") return "Restaurant";
  return "Building";
}

function defaultName(kind: TravelContextRecordKind, canonicalId: string): string {
  return `${kindLabel(kind)} · ${canonicalId}`;
}

function mergeGeometry(values: readonly Geometry[]): Geometry | null {
  const geometries = values.filter((value): value is Geometry => Boolean(value));
  if (geometries.length === 0) return null;
  if (geometries.length === 1) return geometries[0]!;
  if (geometries.every((value) => value.type === "Polygon")) return { type: "MultiPolygon", coordinates: geometries.map((value) => value.coordinates) };
  if (geometries.every((value) => value.type === "Point")) return geometries[0]!;
  return geometries[0]!;
}

function featureGeometry(kind: TravelContextRecordKind, geometry: Geometry | null, coordinates: Position | null): Geometry {
  if (geometry) return geometry;
  if (coordinates) return { type: "Point", coordinates };
  return { type: "Point", coordinates: [0, 0] };
}

function featureAttributes(releaseId: string, layerId: TravelContextLayerId, kind: TravelContextRecordKind, canonicalId: string, name: string, coordinates: Position | null, detail: CompactDetailRecord | null): Record<string, string | number | boolean | null> {
  const attributes = detail ? attributesFromRecord(detail.a) : {};
  const locationStatus = coordinates ? "located" : "location-unavailable";
  const result: Record<string, string | number | boolean | null> = {
    civicReleaseId: releaseId,
    civicLayerId: layerId,
    civicRecordKind: kind,
    civicCanonicalId: canonicalId,
    civicDetailLoaded: Boolean(detail),
    civicLocationStatus: locationStatus,
    civicNoMarker: !coordinates,
    civicTypeLabel: kindLabel(kind),
    civicOfficialName: name,
    civicObservationColumns: detail && detail.ot.length > 0 ? JSON.stringify(detail.ot) : null,
    civicObservations: detail && detail.o.length > 0 ? JSON.stringify(detail.o) : null,
    ...attributes,
  };
  if (kind === "statistical-area") {
    result.areaSemantics = "statistical";
    result.areaType = "2020 NTA";
    result.areaOfficialName = name;
    result.areaUncertainty = "DCP statistical geography; not a definitive or exhaustive neighborhood boundary.";
    result.areaLicense = "NYC Open Data terms; DCP attribution; portal metadata license unspecified.";
  }
  if (kind === "park") {
    result.parkManagementSemantics = "NYC Parks-managed property";
    result.parkAccessUncertainty = "Source presence does not prove hours, amenities, legal survey accuracy, or current access.";
  }
  if (kind === "landmark-record") {
    result.landmarkSemantics = "Official LPC designation/calendaring record; not an attraction or facade claim.";
    result.landmarkRelationship = "No OTI building relationship is asserted without explicit BIN, BBL, or geometry evidence.";
    result.landmarkDateSemantics = "LPC generated time values are rendered as dates only; no official action time is inferred.";
  }
  return result;
}

function buildFeature(manifest: TravelContextReleaseManifest, geometryRecord: CompactGeometryRecord | null, summary: TravelContextSearchSummary | null, detail: CompactDetailRecord | null, existingGeometry: Geometry | null = null): Feature {
  const canonicalId = detail?.p ?? geometryRecord?.p ?? summary?.canonicalId;
  const layerId = detail?.l ?? geometryRecord?.l ?? summary?.layerId;
  const kind = detail?.k ?? geometryRecord?.k ?? summary?.kind;
  if (!canonicalId || !layerId || !kind) throw new Error("Travel-context feature is missing stable identity, layer, or kind.");
  const name = detail?.n ?? geometryRecord?.n ?? summary?.name ?? defaultName(kind, canonicalId);
  const coordinates = detail?.c ?? geometryRecord?.c ?? summary?.coordinates ?? null;
  const geometry = featureGeometry(kind, mergeGeometry([existingGeometry, geometryRecord?.g ?? null].filter((value): value is Geometry => Boolean(value))), coordinates);
  const sourceRefs = sourceRefsFor(manifest, layerId, detail?.s ?? geometryRecord?.s ?? summary?.sourceIdentifiers ?? []);
  const source = sourceSnapshot(manifest, layerSourceId(manifest, layerId));
  const featureKind = kind === "statistical-area" ? "area" : kind === "park" ? "park" : kind === "landmark-record" ? "landmark" : kind === "building" ? "building" : "poi";
  const feature: Feature = {
    schemaVersion: "1.0",
    id: canonicalId,
    cityId: manifest.cityId,
    kind: featureKind,
    name,
    geometry,
    coordinates: coordinates ?? [0, 0],
    geometryProvenance: {
      schemaVersion: "1.0",
      sourceRefId: sourceRefs[0]?.id ?? `source-ref:${layerSourceId(manifest, layerId)}:unknown`,
      inputCrs: "EPSG:4326",
      outputCrs: "EPSG:4326",
      capturedAt: detail?.f.capturedAt ?? source.captureTimestamp,
      height: { schemaVersion: "1.0", valueMeters: null, verticalDatum: "source-published-vertical-datum-unknown", sourceRefId: sourceRefs[0]?.id ?? null, method: "unknown", uncertaintyMeters: null },
      horizontalUncertaintyMeters: null,
      notes: `Checksum-pinned ${kindLabel(kind)} geometry; WGS84 source snapshot; no facade, legal-boundary, access, hours, attraction, or completeness claim.`,
    },
    sourceRefs,
    provenance: "authoritative",
    confidence: { score: 0.95, label: "high", rationale: "Accepted immutable civic source record with checksum-pinned local release provenance." },
    uncertainty: { horizontalMeters: null, verticalMeters: null, temporalDays: null, notes: detail?.u ?? "Snapshot-relative source observation; current status and scale accuracy are not independently verified." },
    freshness: detail?.f ?? { capturedAt: source.captureTimestamp, updatedAt: source.sourceUpdatedAt, observedAt: source.captureTimestamp, ingestedAt: manifest.generatedAt },
    attributes: featureAttributes(manifest.releaseId, layerId, kind, canonicalId, name, coordinates, detail),
  };
  const validation = validateFeature(feature);
  if (!validation.ok) throw new Error(`Travel-context feature ${canonicalId} failed validation: ${validation.issues.map((item) => `${item.path} ${item.message}`).join("; ")}`);
  return feature;
}

function summaryMatches(summary: TravelContextSearchSummary, query: string): number {
  const normalized = normalizeTravelContextQuery(query);
  const tokens = travelContextQueryTokens(normalized);
  const searchable = normalizeTravelContextQuery([summary.canonicalId, summary.name, ...summary.searchableText, ...summary.sourceIdentifiers].filter(Boolean).join(" "));
  if (!tokens.every((token) => searchable.includes(token))) return Number.POSITIVE_INFINITY;
  if (summary.canonicalId.toLocaleLowerCase() === query.trim().toLocaleLowerCase() || summary.sourceIdentifiers.some((value) => value.toLocaleLowerCase() === query.trim().toLocaleLowerCase())) return 0;
  if (summary.name && normalizeTravelContextQuery(summary.name) === normalized) return 1;
  if (summary.name && normalizeTravelContextQuery(summary.name).startsWith(normalized)) return 2;
  return 3;
}

function sortResults(values: Iterable<TravelContextSearchSummary>, query: string): TravelContextSearchSummary[] {
  return [...values].map((summary) => ({ summary, score: summaryMatches(summary, query) })).filter((item) => Number.isFinite(item.score)).sort((left, right) => left.score - right.score || left.summary.layerId.localeCompare(right.summary.layerId) || left.summary.canonicalId.localeCompare(right.summary.canonicalId)).map((item) => item.summary);
}

export class TravelContextReleaseAdapter implements RuntimeCityAdapter {
  readonly city: CityAdapter = manhattanAdapter;
  readonly fixtureOnly: boolean;
  readonly releaseId: string;
  readonly manifest: TravelContextReleaseManifest;
  private readonly basePath: string;
  private readonly fetcher: Fetcher;
  private readonly pool: CitywideRequestPool<LoadedShard>;
  private readonly cacheNamespace: string;
  private readonly summaries = new Map<string, TravelContextSearchSummary>();
  private readonly features = new Map<string, Feature>();
  private readonly detailFeatures = new Map<string, Feature>();
  private readonly sourceSnapshots: ReadonlyMap<string, TravelContextReleaseManifest["sourceSnapshots"][number]>;
  private readonly fault: TravelContextFault | null;
  private detailIndexPromise: Promise<Map<string, TravelContextDetailIndexEntry>> | null = null;
  private detailIndexEntryCount = 0;
  private visibleFeatures: Feature[] = [];
  private visibleShardCount = 0;
  private requestedShardCount = 0;
  private generation = 0;
  private viewportAbortController: AbortController | null = null;
  private activeViewportSignature: string | null = null;
  private activeViewportPromise: Promise<Feature[]> | null = null;
  private committedViewportSignature: string | null = null;
  private dedupedRefreshCount = 0;
  private staleResultCount = 0;
  private failedLayers = new Set<RuntimeLayerId>();
  private geometryFailedLayers = new Set<RuntimeLayerId>();
  private destroyed = false;

  constructor(manifest: TravelContextReleaseManifest, basePath: string, fetcher: Fetcher = globalThis.fetch.bind(globalThis), options: TravelContextRuntimeOptions = {}) {
    const validation = validateTravelContextReleaseManifest(manifest);
    if (!validation.ok) throw new Error(`Travel-context release manifest is invalid: ${validation.issues.map((item) => `${item.path} ${item.message}`).join("; ")}`);
    if ((!options.allowFixture && manifest.fixtureOnly) || (!manifest.fixtureOnly && manifest.releaseId !== TRAVEL_CONTEXT_RELEASE_ID)) throw new Error("Only the pinned civic-context release may activate this adapter.");
    if (manifest.approval.evidenceId !== MANHATTAN_CIVIC_APPROVAL_EVIDENCE.evidenceId || manifest.approval.fingerprintSha256 !== MANHATTAN_CIVIC_APPROVAL_EVIDENCE.fingerprintSha256) throw new Error("Travel-context release approval evidence does not match the approved local wave.");
    this.manifest = manifest;
    this.fixtureOnly = manifest.fixtureOnly;
    this.releaseId = manifest.releaseId;
    this.basePath = basePath.replace(/\/$/u, "");
    this.fetcher = fetcher;
    this.fault = options.fault ?? null;
    this.cacheNamespace = options.cacheNamespace ?? manifest.releaseId;
    const sharedCache = options.sharedCache as unknown as CitywideLruCache<LoadedShard> | undefined;
    this.pool = new CitywideRequestPool<LoadedShard>(TRAVEL_CONTEXT_BUDGETS.maxConcurrentRequests, sharedCache ?? new CitywideLruCache<LoadedShard>(), options.sharedBudget ?? null);
    this.sourceSnapshots = new Map(manifest.sourceSnapshots.map((source) => [source.registryEntryId, source]));
  }

  get assetResolver(): undefined { return undefined; }

  getLayerManifest(layer: RuntimeLayerId): LayerManifest {
    const descriptor = this.manifest.layers.find((item) => item.id === layer);
    const shards = this.manifest.geometryShards.filter((item) => item.layerId === layer);
    if (descriptor) return {
      schemaVersion: "1.0",
      id: layer,
      version: this.releaseId,
      label: descriptor.label,
      fixtureOnly: this.fixtureOnly,
      featureKinds: descriptor.recordKind === "statistical-area" ? ["area"] : descriptor.recordKind === "park" ? ["park"] : descriptor.recordKind === "landmark-record" ? ["landmark"] : descriptor.recordKind === "building" ? ["building"] : ["poi"],
      featureIds: descriptor.parentCount > 0 ? this.featuresForLayer(layer).map((feature) => feature.id) : [],
      tileLevel: TRAVEL_CONTEXT_TILE_LEVEL,
      tileKeys: [...new Set(shards.map((item) => item.tileKey))].sort(),
      sourceRegistryEntryIds: descriptor.sourceRegistryEntryIds,
      acceptedCount: descriptor.parentCount,
      generatedAt: this.manifest.generatedAt,
    };
    return {
      schemaVersion: "1.0",
      id: layer,
      version: this.releaseId,
      label: layer === "pois" ? "Points of interest" : layer,
      fixtureOnly: this.fixtureOnly,
      featureKinds: layer === "buildings" ? ["building"] : layer === "pois" ? ["poi"] : layer === "areas" ? ["area"] : layer === "parks" ? ["park"] : layer === "landmarks" ? ["landmark"] : [],
      featureIds: [], tileLevel: TRAVEL_CONTEXT_TILE_LEVEL, tileKeys: [], sourceRegistryEntryIds: [], acceptedCount: 0, generatedAt: this.manifest.generatedAt,
    };
  }

  getFeature(featureId: string): Feature | undefined { return this.detailFeatures.get(featureId) ?? this.features.get(featureId); }

  getFeatures(visibility: LayerVisibility = DEFAULT_LAYER_VISIBILITY): Feature[] {
    return this.visibleFeatures.filter((feature) => {
      const layer = layerForFeature(feature);
      return layer ? visibility[layer] !== false : false;
    }).sort((left, right) => left.id.localeCompare(right.id));
  }

  search(query: string): Feature[] {
    const normalized = normalizeTravelContextQuery(query);
    if (!normalized) return [];
    return sortResults(this.summaries.values(), query).map((summary) => this.summaryFeature(summary));
  }

  async searchAsync(query: string, signal?: AbortSignal): Promise<Feature[]> {
    const normalized = normalizeTravelContextQuery(query);
    if (!normalized || normalized.length < 2) return [];
    const prefixes = new Set(selectTravelContextSearchPrefixes(this.manifest.searchShards, query));
    const shards = this.manifest.searchShards.filter((shard) => prefixes.has(shard.prefix));
    const loaded = new Map<string, TravelContextSearchSummary>();
    await Promise.all(shards.map(async (shard) => {
      if (signal?.aborted) throw new DOMException("Travel-context search was aborted.", "AbortError");
      const value = await this.loadRef(shard.relativeContentRef, shard.checksumSha256, signal).catch(() => undefined);
      if (!value) { this.failLayerForSearch(shard); return; }
      if (!Array.isArray(value.payload)) { this.failLayerForSearch(shard); return; }
      for (const item of value.payload) {
        const summary = compactSummary(item);
        if (!summary) { this.failLayerForSearch(shard); continue; }
        loaded.set(summary.canonicalId, summary);
        this.setBounded(this.summaries, summary.canonicalId, summary, TRAVEL_CONTEXT_BUDGETS.maxLoadedShards * 700);
      }
    }));
    const exact = isTravelContextExactIdentifier(query);
    const results = exact ? [...loaded.values()].filter((summary) => summaryMatches(summary, query) === 0).sort((left, right) => left.canonicalId.localeCompare(right.canonicalId)) : sortResults(loaded.values(), query);
    return results.map((summary) => this.summaryFeature(summary));
  }

  async loadLayerFeatures(layer: RuntimeLayerId): Promise<Feature[]> {
    return this.getFeatures({ ...DEFAULT_LAYER_VISIBILITY, buildings: layer === "buildings", pois: layer === "pois", areas: layer === "areas", stations: false, entrances: false, routes: false, "statistical-areas": layer === "statistical-areas", parks: layer === "parks", landmarks: layer === "landmarks" });
  }

  refreshViewport(input: ViewportRefreshInput, signal?: AbortSignal): Promise<Feature[]> {
    if (this.destroyed) return Promise.resolve([]);
    const request = normalizeViewportRefreshRequest(input);
    const viewport = request.footprint.bounds;
    const candidates = this.manifest.geometryShards
      .filter((shard) => viewportBoundsIntersect(shard.bounds, viewport))
      .sort((left, right) => this.shardDistance(left, request.footprint.groundCenter) - this.shardDistance(right, request.footprint.groundCenter) || left.shardId.localeCompare(right.shardId));
    const bounded = candidates.slice(0, TRAVEL_CONTEXT_BUDGETS.maxLoadedShards);
    const visibleRefs = new Set(bounded.map((shard) => shard.relativeContentRef));
    const signature = `${request.footprint.signature}|${[...visibleRefs].sort().join(",")}`;
    if (signature === this.activeViewportSignature && this.activeViewportPromise) {
      this.dedupedRefreshCount += 1;
      return this.activeViewportPromise;
    }
    if (signature === this.committedViewportSignature) {
      this.dedupedRefreshCount += 1;
      return Promise.resolve(this.getFeatures());
    }
    this.viewportAbortController?.abort();
    const controller = new AbortController();
    this.viewportAbortController = controller;
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    const generation = ++this.generation;
    this.visibleShardCount = visibleRefs.size;
    this.requestedShardCount = bounded.length;
    const run = async (): Promise<Feature[]> => {
      try {
        const viewportFailedLayers = new Set<RuntimeLayerId>();
        const values = await Promise.all(bounded.map((shard) => this.loadRef(shard.relativeContentRef, shard.checksumSha256, controller.signal).catch(() => undefined)));
        if (controller.signal.aborted || generation !== this.generation || this.destroyed) {
          this.staleResultCount += 1;
          return this.getFeatures();
        }
        const next = new Map<string, Feature>();
        values.forEach((loaded, index) => {
          const shard = bounded[index];
          if (!shard) return;
          if (!loaded) { viewportFailedLayers.add(runtimeLayerForTravelLayer(shard.layerId)); return; }
          if (!Array.isArray(loaded.payload)) { viewportFailedLayers.add(runtimeLayerForTravelLayer(shard.layerId)); return; }
          const records = loaded.payload.map(compactGeometry);
          if (records.some((record) => !record)) { viewportFailedLayers.add(runtimeLayerForTravelLayer(shard.layerId)); return; }
          const grouped = new Map<string, CompactGeometryRecord[]>();
          records.forEach((record) => { if (record) grouped.set(record.p, [...(grouped.get(record.p) ?? []), record]); });
          grouped.forEach((parts, canonicalId) => {
            const first = parts[0]!;
            try {
              const feature = buildFeature(this.manifest, { ...first, g: mergeGeometry(parts.map((part) => part.g).filter((value): value is Geometry => Boolean(value))) }, this.summaries.get(canonicalId) ?? null, this.detailFeatures.get(canonicalId) ? this.detailFromFeature(this.detailFeatures.get(canonicalId)!) : null);
              next.set(feature.id, feature);
              this.setBounded(this.features, feature.id, feature, TRAVEL_CONTEXT_BUDGETS.maxLoadedShards * 700);
            } catch {
              viewportFailedLayers.add(runtimeLayerForTravelLayer(shard.layerId));
            }
          });
        });
        this.geometryFailedLayers = viewportFailedLayers;
        this.visibleFeatures = [...next.values()].sort((left, right) => left.id.localeCompare(right.id));
        this.committedViewportSignature = signature;
        return this.getFeatures();
      } finally {
        signal?.removeEventListener("abort", abort);
        if (this.viewportAbortController === controller) this.viewportAbortController = null;
        if (this.activeViewportSignature === signature) {
          this.activeViewportSignature = null;
          this.activeViewportPromise = null;
        }
      }
    };
    const promise = run();
    this.activeViewportSignature = signature;
    this.activeViewportPromise = promise;
    return promise;
  }

  async loadDetailsForFeature(feature: Feature, signal?: AbortSignal): Promise<Feature | undefined> { return this.loadDetail(feature.id, signal); }

  async loadDetail(canonicalId: string, signal?: AbortSignal): Promise<Feature | undefined> {
    const index = await this.loadDetailIndex(signal);
    const entry = index.get(canonicalId);
    if (!entry) return undefined;
    if (this.fault === "lpc-detail" && entry.layerId === "landmarks") {
      this.failedLayers.add("landmarks");
      throw new Error("Injected LPC detail shard failure; the immutable release was not modified.");
    }
    const shard = this.manifest.detailShards.find((item) => item.relativeContentRef === entry.detailShardRef);
    if (!shard) throw new Error(`Travel-context detail index points to undeclared shard ${entry.detailShardRef}.`);
    const loaded = await this.loadRef(shard.relativeContentRef, shard.checksumSha256, signal);
    if (!loaded || !Array.isArray(loaded.payload)) { this.failedLayers.add(runtimeLayerForTravelLayer(entry.layerId)); throw new Error(`Travel-context detail shard failed closed for ${canonicalId}; no substitute record was selected.`); }
    const detail = loaded.payload.map(compactDetail).find((item): item is CompactDetailRecord => Boolean(item && item.p === canonicalId));
    if (!detail) { this.failedLayers.add(runtimeLayerForTravelLayer(entry.layerId)); throw new Error(`Travel-context detail shard omitted indexed record ${canonicalId}.`); }
    let geometry: Geometry | null = null;
    const existing = this.features.get(canonicalId);
    if (existing && existing.geometry.type !== "Point") geometry = existing.geometry;
    if (!geometry && entry.geometryShardRefs.length > 0) {
      const parts = await Promise.all(entry.geometryShardRefs.map((ref) => {
        const declared = this.manifest.geometryShards.find((item) => item.relativeContentRef === ref);
        if (!declared) throw new Error(`Travel-context detail index points to undeclared geometry shard ${ref}.`);
        return this.loadRef(ref, declared.checksumSha256, signal).catch(() => undefined);
      }));
      const compactParts = parts.flatMap((item) => item && Array.isArray(item.payload) ? item.payload.map(compactGeometry).filter((value): value is CompactGeometryRecord => Boolean(value && value.p === canonicalId)) : []);
      geometry = mergeGeometry(compactParts.map((part) => part.g).filter((value): value is Geometry => Boolean(value)));
    }
    const feature = buildFeature(this.manifest, geometry ? { p: detail.p, l: detail.l, k: detail.k, n: detail.n, g: geometry, c: detail.c, s: detail.s } : null, this.summaries.get(canonicalId) ?? null, detail, geometry);
    this.setBounded(this.detailFeatures, canonicalId, feature, TRAVEL_CONTEXT_BUDGETS.maxLoadedShards * 700);
    this.setBounded(this.features, canonicalId, feature, TRAVEL_CONTEXT_BUDGETS.maxLoadedShards * 700);
    return feature;
  }

  getMetrics(): TravelContextRuntimeMetrics {
    const cache = this.pool.cacheMetrics();
    return {
      visibleShardCount: this.visibleShardCount,
      requestedShardCount: this.requestedShardCount,
      loadedFeatureCount: this.visibleFeatures.length,
      loadedBytes: cache.bytes,
      maxConcurrentRequests: this.pool.peakConcurrency(),
      activeRequests: this.pool.activeCount(),
      failedRequestCount: this.pool.failedCount(),
      cancelledRequestCount: this.pool.abortedCount(),
      staleResultCount: this.staleResultCount,
      retainedSummaryCount: this.summaries.size,
      retainedFeatureCount: this.features.size,
      retainedDetailCount: this.detailFeatures.size,
      detailIndexEntryCount: this.detailIndexEntryCount,
      cacheEntries: cache.entries,
      cacheEvictions: cache.evictions,
      failedLayers: [...new Set([...this.failedLayers, ...this.geometryFailedLayers])].sort(),
      dedupedRefreshCount: this.dedupedRefreshCount,
    };
  }

  destroy(): void {
    this.destroyed = true;
    this.viewportAbortController?.abort();
    this.viewportAbortController = null;
    this.pool.abortExcept([]);
  }

  private summaryFeature(summary: TravelContextSearchSummary): Feature {
    const existing = this.features.get(summary.canonicalId);
    if (existing) return existing;
    const feature = buildFeature(this.manifest, { p: summary.canonicalId, l: summary.layerId, k: summary.kind, n: summary.name, g: null, c: summary.coordinates, s: summary.sourceIdentifiers }, summary, null);
    this.setBounded(this.features, summary.canonicalId, feature, TRAVEL_CONTEXT_BUDGETS.maxLoadedShards * 700);
    return feature;
  }

  private detailFromFeature(feature: Feature): CompactDetailRecord | null {
    if (feature.attributes.civicDetailLoaded !== true) return null;
    const attrs = Object.fromEntries(Object.entries(feature.attributes).filter(([key]) => !key.startsWith("civic")));
    return { p: feature.id, l: feature.attributes.civicLayerId as TravelContextLayerId, k: feature.attributes.civicRecordKind as TravelContextRecordKind, n: feature.name, c: feature.attributes.civicLocationStatus === "location-unavailable" ? null : feature.coordinates, s: feature.sourceRefs.map((source) => source.sourceRecordId), f: feature.freshness, u: feature.uncertainty.notes, a: attrs, ot: [], o: [] };
  }

  private featuresForLayer(layer: RuntimeLayerId): Feature[] {
    return [...this.features.values()].filter((feature) => layerForFeature(feature) === layer);
  }

  private failLayerForSearch(shard: TravelContextSearchShardManifest): void {
    const layerIds = shard.parentIds.map((id) => this.summaries.get(id)?.layerId).filter((value): value is TravelContextLayerId => Boolean(value));
    layerIds.forEach((layerId) => this.failedLayers.add(runtimeLayerForTravelLayer(layerId)));
  }

  private shardDistance(shard: TravelContextGeometryShardManifest, groundCenter: ViewportGroundCenter): number {
    const centerLongitude = (shard.bounds.west + shard.bounds.east) / 2;
    const centerLatitude = (shard.bounds.south + shard.bounds.north) / 2;
    return (centerLongitude - groundCenter.longitude) ** 2 + (centerLatitude - groundCenter.latitude) ** 2;
  }

  private async loadDetailIndex(signal?: AbortSignal): Promise<Map<string, TravelContextDetailIndexEntry>> {
    if (this.detailIndexPromise) return this.detailIndexPromise;
    const declared = this.manifest.detailIndex;
    const pending = this.loadRef(declared.relativeContentRef, declared.checksumSha256, signal).then((loaded) => {
      if (!loaded || !Array.isArray(loaded.payload)) throw new Error("Travel-context detail index payload is invalid.");
      const entries = loaded.payload.filter((entry): entry is TravelContextDetailIndexEntry => isRecord(entry) && typeof entry.canonicalId === "string" && isLayerId(entry.layerId) && typeof entry.detailShardRef === "string" && Array.isArray(entry.geometryShardRefs) && entry.geometryShardRefs.every((ref) => typeof ref === "string"));
      if (entries.length !== declared.entryCount || new Set(entries.map((entry) => entry.canonicalId)).size !== entries.length) throw new Error("Travel-context detail index has invalid or duplicate entries.");
      this.detailIndexEntryCount = entries.length;
      return new Map(entries.map((entry) => [entry.canonicalId, entry]));
    });
    this.detailIndexPromise = pending.catch((error: unknown) => { this.detailIndexPromise = null; this.detailIndexEntryCount = 0; throw error; });
    return this.detailIndexPromise;
  }

  private setBounded<T>(map: Map<string, T>, key: string, value: T, limit: number): void {
    map.delete(key);
    map.set(key, value);
    while (map.size > limit) {
      const oldest = map.keys().next().value;
      if (typeof oldest !== "string") break;
      map.delete(oldest);
    }
  }

  private async loadRef(ref: string, checksum: string, signal?: AbortSignal): Promise<LoadedShard | undefined> {
    if (ref.startsWith("/") || ref.includes("..") || ref.includes("\\") || ref.includes("://")) throw new Error(`Unsafe travel-context runtime ref ${ref}.`);
    if (signal?.aborted) return undefined;
    const declaredLayer = this.manifest.geometryShards.find((item) => item.relativeContentRef === ref)?.layerId;
    if (this.fault === "parks-geometry" && declaredLayer === "parks") throw new Error("Injected parks geometry shard failure; the immutable release was not modified.");
    const task = {
      key: `${this.cacheNamespace}:${ref}`,
      loader: async (requestSignal: AbortSignal) => {
        const combinedController = new AbortController();
        const abort = () => combinedController.abort();
        requestSignal.addEventListener("abort", abort, { once: true });
        try {
          const response = await this.fetcher(`${this.basePath}/${ref}`, { signal: combinedController.signal });
          if (!response.ok) throw new Error(`Travel-context release request failed (${response.status}) for ${ref}.`);
          const text = await response.text();
          const actual = await sha256Hex(text);
          if (actual.toLowerCase() !== checksum.toLowerCase()) throw new Error(`Travel-context checksum mismatch for ${ref}.`);
          let payload: unknown;
          try { payload = JSON.parse(text); } catch { throw new Error(`Travel-context payload ${ref} is not valid JSON.`); }
          return { value: { ref, payload, byteSize: new TextEncoder().encode(text).byteLength }, bytes: new TextEncoder().encode(text).byteLength };
        } finally {
          requestSignal.removeEventListener("abort", abort);
        }
      },
    };
    try {
      return await this.pool.load(task, signal);
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") return undefined;
      throw error;
    }
  }

}

export async function loadTravelContextRelease(basePath = "/data/manhattan-civic-context-20260804/", signal?: AbortSignal, fetcher: Fetcher = globalThis.fetch.bind(globalThis), options: TravelContextRuntimeOptions = {}): Promise<TravelContextReleaseAdapter> {
  const normalizedPath = basePath.replace(/\/$/u, "");
  const response = await fetcher(`${normalizedPath}/manifest.json`, { signal });
  if (!response.ok) throw new Error(`Travel-context release manifest request failed (${response.status}).`);
  const text = await response.text();
  let manifest: unknown;
  try { manifest = JSON.parse(text); } catch { throw new Error("Travel-context release manifest is not valid JSON."); }
  const validation = validateTravelContextReleaseManifest(manifest);
  if (!validation.ok) throw new Error(`Travel-context release manifest failed validation: ${validation.issues.map((item) => `${item.path} ${item.message}`).join("; ")}`);
  if (validation.value.releaseId !== TRAVEL_CONTEXT_RELEASE_ID || validation.value.fixtureOnly) throw new Error("Requested civic-context release is not the pinned non-fixture release.");
  const hashResponse = await fetcher(`${normalizedPath}/manifest.sha256`, { signal });
  if (!hashResponse.ok) throw new Error(`Travel-context root checksum request failed (${hashResponse.status}).`);
  const declaredHash = (await hashResponse.text()).trim().split(/\s+/u)[0] ?? "";
  const actual = await sha256Hex(text);
  if (!/^[a-f0-9]{64}$/iu.test(declaredHash) || actual.toLowerCase() !== declaredHash.toLowerCase()) throw new Error("Travel-context root manifest checksum mismatch.");
  return new TravelContextReleaseAdapter(validation.value, normalizedPath, fetcher, options);
}

export { kindLabel };
