import { manhattanAdapter } from "../data/city-adapters.ts";
import type { CityAdapter, Feature, Geometry, Position, SourceRef } from "../domain/schema.ts";
import { validateFeature } from "../domain/schema.ts";
import { sha256Hex } from "../ingestion/offline.ts";
import {
  CITYWIDE_BUDGETS,
  CITYWIDE_RELEASE_ID,
  CITYWIDE_TILE_LEVEL,
  citywideQueryTokens,
  isCitywideExactIdentifier,
  normalizeCitywideQuery,
  selectCitywideSearchPrefixes,
  selectViewportShards,
  stableCitywidePickId,
  validateCitywideReleaseManifest,
  type CitywideBudgetRecord,
  type CitywideBuildingPart,
  type CitywideReleaseManifest,
  type CitywideSearchSummary,
  type CitywideShardManifest,
} from "../release/citywide-release.ts";
import { tileKeyForCoordinate, tileKeyString } from "./spatial.ts";

/** Whether a shard's declared bounds contain a WGS84 point, edges inclusive. */
export function shardContainsPoint(shard: Pick<CitywideShardManifest, "bounds">, longitude: number, latitude: number): boolean {
  const { west, east, south, north } = shard.bounds;
  const withinLongitude = west <= east
    ? longitude >= west && longitude <= east
    : longitude >= west || longitude <= east;
  return withinLongitude && latitude >= south && latitude <= north;
}

/**
 * Reserve the shard the camera is standing on before the budget truncation.
 *
 * The ranking is by distance from the footprint's ground centre, which is the
 * right ordering for what the camera is *looking at*. It is the wrong ordering
 * for what the camera is *standing on*: at a shallow attitude the ground centre
 * sits far downrange, and the camera's own shard is ranked out and dropped by
 * `slice(0, maxLoadedShards)`. Losing that shard costs the base building
 * records under the camera, and with them the verified WGS84 anchors the
 * exterior cells need, so a street-level facade view renders nothing (T009
 * finding F2).
 *
 * The fix is deliberately confined to selection ordering: the camera's shards
 * are moved to the front so truncation can never discard them. The LRU cache
 * itself is untouched, and cross-cell cache pressure remains the T013+ concern
 * ADR 0024 hands forward.
 */
export function retainCameraShards<T extends Pick<CitywideShardManifest, "bounds" | "relativeContentRef">>(
  ranked: readonly T[],
  camera: { longitude: number; latitude: number },
  limit: number,
): T[] {
  if (ranked.length <= limit) return [...ranked];
  // Invariant: the reserved head cannot itself overflow the budget. The shards
  // are a non-overlapping tile grid, so a point falls in one tile per layer —
  // up to four only when it lands exactly on a tile edge or corner, since
  // `shardContainsPoint` is edge-inclusive — across the two geometry layers
  // this selection requests. That is a small constant against the budget, so
  // the slice below can never drop a reserved shard.
  const cameraShards = ranked.filter((shard) => shardContainsPoint(shard, camera.longitude, camera.latitude));
  if (cameraShards.length === 0) return ranked.slice(0, limit);
  const reserved = new Set(cameraShards.map((shard) => shard.relativeContentRef));
  return [...cameraShards, ...ranked.filter((shard) => !reserved.has(shard.relativeContentRef))].slice(0, limit);
}
import { DEFAULT_LAYER_VISIBILITY, layerForFeature, type LayerManifest, type LayerVisibility, type RuntimeLayerId } from "./layers.ts";
import type { RuntimeCityAdapter } from "./fixture-adapter.ts";
import { CitywideLruCache, CitywideRequestPool, type CitywideSharedRequestBudget } from "../release/citywide-release.ts";
import {
  normalizeViewportRefreshRequest,
  viewportBoundsCrossesAntimeridian,
  viewportBoundsIntersect,
  type ViewportBounds,
  type ViewportGroundCenter,
  type ViewportRefreshInput,
} from "./viewport-footprint.ts";

const DOHMH_SOURCE_URL = "https://data.cityofnewyork.us/resource/43nn-pn8j.json";
const OTI_SOURCE_URL = "https://data.cityofnewyork.us/resource/jh45-qr5r.json";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
type CompactDetail = { p: string; k: "building" | "restaurant"; n: string | null; l?: "located" | "location-unavailable"; c?: Position | null; r?: string[]; s?: string[]; v?: unknown[]; a?: unknown[] };
type GeometryPayload = { schemaVersion: "citywide-geometry-1"; layer: "buildings" | "restaurants"; tileKey: string; features: unknown[] };
type SearchPayload = { schemaVersion: "citywide-search-1"; prefix: string; summaries: unknown[] };
type DetailPayload = { schemaVersion: "citywide-details-1"; records: unknown[] };

interface LoadedShard {
  ref: string;
  payload: GeometryPayload | SearchPayload | DetailPayload | { schemaVersion: "citywide-detail-index-1"; entries: unknown[] };
  byteSize: number;
}

export interface CitywideRuntimeMetrics {
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
  dedupedRefreshCount?: number;
}

export interface CitywideRuntimeOptions {
  sharedBudget?: CitywideSharedRequestBudget | null;
  /** A shared cache is supplied only by an approved composed runtime. */
  sharedCache?: CitywideLruCache<unknown>;
  cacheNamespace?: string;
  /**
   * The session's resolved budget record, or a supplier of it. Defaults to the
   * shared constant, so an unflagged session behaves exactly as before.
   *
   * A supplier exists because this adapter is ALSO the base of the composed
   * civic runtime. A record fixed at construction would let an overview
   * session raise the shard-selection bound for a civic session that never
   * asked for it, so the caller supplies the record the ACTIVE mode is
   * entitled to and the adapter reads it per access.
   */
  budgets?: CitywideBudgetRecord | (() => CitywideBudgetRecord);
}

interface SourceSnapshot {
  registryEntryId: string;
  provider: string;
  datasetId: string;
  captureTimestamp: string;
  sourceUpdatedAt: string | null;
  termsUrl: string;
  attribution: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPosition(value: unknown): value is Position {
  return Array.isArray(value) && (value.length === 2 || value.length === 3) && value.every((part) => typeof part === "number" && Number.isFinite(part));
}

function sourceRecordIdFromRef(value: string | null | undefined): string {
  if (!value) return "unknown";
  const parts = value.split(":");
  return parts.at(-1) || value;
}

function sourceSnapshotFor(manifest: CitywideReleaseManifest, registryEntryId: string): SourceSnapshot {
  const source = manifest.sourceSnapshots.find((item) => item.registryEntryId === registryEntryId);
  if (!source) throw new Error(`Citywide release is missing source snapshot ${registryEntryId}.`);
  return source;
}

function sourceRefFor(manifest: CitywideReleaseManifest, registryEntryId: string, sourceRecordId: string, sourceRefId?: string): SourceRef {
  const source = sourceSnapshotFor(manifest, registryEntryId);
  const isBuilding = registryEntryId === "nyc.building-footprints";
  return {
    schemaVersion: "1.0",
    id: sourceRefId ?? `source-ref:${registryEntryId}:${sourceRecordId}`,
    registryEntryId,
    provider: source.provider,
    datasetId: source.datasetId,
    sourceRecordId,
    sourceUrl: isBuilding ? OTI_SOURCE_URL : DOHMH_SOURCE_URL,
    licenseRefId: isBuilding ? "license:nyc.building-footprints" : "license:nyc.dohmh-restaurant-inspections",
    role: "primary",
    capturedAt: source.captureTimestamp,
    updatedAt: source.sourceUpdatedAt,
    observedAt: source.captureTimestamp,
    release: manifest.releaseId,
  };
}

function sourceRefsFor(manifest: CitywideReleaseManifest, registryEntryId: string, ids: readonly string[], explicitRefs: readonly string[] = []): SourceRef[] {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
  const refs = unique.map((id, index) => sourceRefFor(manifest, registryEntryId, sourceRecordIdFromRef(id), explicitRefs[index] ?? (id.startsWith("source-ref:") ? id : undefined)));
  return refs.length > 0 ? refs : [sourceRefFor(manifest, registryEntryId, "unknown")];
}

function searchSummaryMatches(summary: CitywideSearchSummary, normalized: string): number {
  const tokens = citywideQueryTokens(normalized);
  const haystack = normalizeCitywideQuery([summary.parentId, summary.name, summary.address, summary.cuisine, ...summary.sourceIdentifiers].filter(Boolean).join(" "));
  if (!tokens.every((token) => haystack.includes(token))) return Number.POSITIVE_INFINITY;
  return haystack === normalized ? 0 : summary.name && normalizeCitywideQuery(summary.name) === normalized ? 1 : haystack.startsWith(normalized) ? 2 : 3;
}

function searchSummaryList(summaries: Iterable<CitywideSearchSummary>, normalized: string): CitywideSearchSummary[] {
  return [...summaries]
    .map((summary) => ({ summary, score: searchSummaryMatches(summary, normalized) }))
    .filter((result) => Number.isFinite(result.score))
    .sort((left, right) => left.score - right.score || left.summary.parentId.localeCompare(right.summary.parentId))
    .map(({ summary }) => summary);
}

function compactSummary(value: unknown): CitywideSearchSummary | null {
  if (!Array.isArray(value) || value.length !== 10) return null;
  const [parentId, kind, name, address, cuisine, sourceIdentifiers, coordinates, locationStatus, tileKeys, detailRef] = value;
  if (typeof parentId !== "string" || (kind !== "building" && kind !== "restaurant") || (name !== null && typeof name !== "string") || (address !== null && typeof address !== "string") || (cuisine !== null && typeof cuisine !== "string") || !Array.isArray(sourceIdentifiers) || !sourceIdentifiers.every((id) => typeof id === "string") || (coordinates !== null && !isPosition(coordinates)) || (locationStatus !== "located" && locationStatus !== "location-unavailable") || !Array.isArray(tileKeys) || !tileKeys.every((tileKey) => typeof tileKey === "string") || typeof detailRef !== "string") return null;
  return { parentId, kind, name, address, cuisine, sourceIdentifiers, normalizedTokens: citywideQueryTokens([name, address, cuisine, ...sourceIdentifiers].filter(Boolean).join(" ")), coordinates, locationStatus, tileKeys, detailRef };
}

function compactDetail(value: unknown): CompactDetail | null {
  if (!isRecord(value) || typeof value.p !== "string" || (value.k !== "building" && value.k !== "restaurant") || (value.n !== null && typeof value.n !== "string")) return null;
  if (value.l !== undefined && value.l !== "located" && value.l !== "location-unavailable") return null;
  if (value.c !== undefined && value.c !== null && !isPosition(value.c)) return null;
  if (value.r !== undefined && (!Array.isArray(value.r) || !value.r.every((item) => typeof item === "string"))) return null;
  if (value.s !== undefined && (!Array.isArray(value.s) || !value.s.every((item) => typeof item === "string"))) return null;
  if (value.v !== undefined && !Array.isArray(value.v)) return null;
  return value as unknown as CompactDetail;
}

function compactBuildingPart(value: unknown, payloadTileKey: string): CitywideBuildingPart | null {
  if (!isRecord(value) || payloadTileKey.length === 0 || typeof value.parentId !== "string" || typeof value.partId !== "string" || !Number.isSafeInteger(value.partIndex) || (value.partCount !== undefined && !Number.isSafeInteger(value.partCount)) || typeof value.name !== "string" || !isRecord(value.geometry) || typeof value.geometry.type !== "string" || !isPosition(value.coordinates) || (value.heightMeters !== null && typeof value.heightMeters !== "number") || typeof value.heightUnknown !== "boolean" || typeof value.sourceRecordId !== "string" || (value.bin !== null && typeof value.bin !== "string") || (value.baseBbl !== null && typeof value.baseBbl !== "string") || (value.mapPlutoBbl !== null && typeof value.mapPlutoBbl !== "string") || !Array.isArray(value.sourceRefIds) || !value.sourceRefIds.every((item) => typeof item === "string")) return null;
  // The enclosing emitted geometry payload is authoritative.  Production
  // compact records intentionally omit tileKey and partCount; when a record
  // carries tileKey as redundant metadata it must agree with the payload.
  if (value.tileKey !== undefined && (typeof value.tileKey !== "string" || value.tileKey !== payloadTileKey)) return null;
  return { ...value, partCount: value.partCount ?? 1, tileKey: payloadTileKey } as unknown as CitywideBuildingPart;
}

function geometryFromDetail(detail: CompactDetail, existing: Feature | undefined): Geometry {
  if (existing) return existing.geometry;
  if (detail.c && isPosition(detail.c)) return { type: "Point", coordinates: detail.c };
  return { type: "Point", coordinates: [0, 0] };
}

function citywideFeature(
  manifest: CitywideReleaseManifest,
  summary: CitywideSearchSummary,
  geometry: Geometry,
  sourceRefs: SourceRef[],
  attributes: Record<string, string | number | boolean | null> = {},
): Feature {
  const registryEntryId = summary.kind === "building" ? "nyc.building-footprints" : "nyc.dohmh-restaurant-inspections";
  const source = sourceSnapshotFor(manifest, registryEntryId);
  const coordinates = summary.coordinates ?? [0, 0];
  const locationUnavailable = summary.locationStatus === "location-unavailable";
  const feature: Feature = {
    schemaVersion: "1.0",
    id: summary.parentId,
    cityId: "manhattan",
    kind: summary.kind === "building" ? "building" : "poi",
    name: summary.name ?? (summary.kind === "building" ? `Building ${summary.parentId}` : `DOHMH CAMIS ${summary.sourceIdentifiers[0] ?? "unknown"}`),
    geometry,
    coordinates,
    geometryProvenance: {
      schemaVersion: "1.0",
      sourceRefId: sourceRefs[0]?.id ?? `source-ref:${registryEntryId}:${summary.parentId}`,
      inputCrs: "EPSG:4326",
      outputCrs: "EPSG:4326",
      capturedAt: source.captureTimestamp,
      height: { schemaVersion: "1.0", valueMeters: null, verticalDatum: "source-published-vertical-datum-unknown", sourceRefId: sourceRefs[0]?.id ?? null, method: "unknown", uncertaintyMeters: null },
      horizontalUncertaintyMeters: null,
      notes: "Compact citywide release geometry; snapshot-relative source truth; no facade fidelity claim.",
    },
    sourceRefs,
    provenance: "authoritative",
    confidence: { score: 0.96, label: "high", rationale: "Accepted immutable citywide source record with checksum-pinned release provenance." },
    uncertainty: { horizontalMeters: null, verticalMeters: null, temporalDays: null, notes: "Snapshot-relative source record; no unsourced hours, ratings, routing, imagery, or facade claim." },
    freshness: { capturedAt: source.captureTimestamp, updatedAt: source.sourceUpdatedAt, observedAt: source.captureTimestamp, ingestedAt: manifest.generatedAt },
    attributes: {
      citywideReleaseId: manifest.releaseId,
      citywideParentId: summary.parentId,
      citywideDetailRef: summary.detailRef,
      citywideLocationStatus: summary.locationStatus,
      citywideSourceIdentifiers: JSON.stringify(summary.sourceIdentifiers),
      citywideNoMarker: locationUnavailable,
      placeAddress: summary.address,
      placeCuisine: summary.cuisine,
      placeCategories: summary.kind === "restaurant" ? "restaurant" : null,
      ...attributes,
    },
  };
  const validation = validateFeature(feature);
  if (!validation.ok) throw new Error(`Citywide runtime feature ${summary.parentId} failed validation: ${validation.issues.map((item) => `${item.path} ${item.message}`).join("; ")}`);
  return feature;
}

function detailAttributes(detail: CompactDetail, summary: CitywideSearchSummary): Record<string, string | number | boolean | null> {
  const attributes: Record<string, string | number | boolean | null> = {
    citywideDetailLoaded: true,
    citywideSourceOccurrenceIds: JSON.stringify(detail.r ?? []),
    citywideSourceRefIds: JSON.stringify(detail.s ?? []),
  };
  if (detail.k !== "restaurant") {
    const values = Array.isArray(detail.a) ? detail.a : [];
    attributes.citywideObjectId = typeof values[0] === "number" ? values[0] : null;
    attributes.citywideDoittId = typeof values[1] === "string" ? values[1] : summary.parentId.replace(/^doitt:/, "");
    attributes.citywideBin = typeof values[2] === "string" ? values[2] : null;
    attributes.citywideBaseBbl = typeof values[3] === "string" ? values[3] : null;
    attributes.citywideMapPlutoBbl = typeof values[4] === "string" ? values[4] : null;
    return attributes;
  }
  const rows = (detail.v ?? []).filter((row): row is unknown[] => Array.isArray(row) && row.length === 7);
  attributes.citywideObservationCount = rows.length;
  attributes.citywideInspectionSemantics = "Administrative inspection observations only; not a rating, review, popularity, opening-status, or recommendation claim.";
  const latest = [...rows].sort((left, right) => String(right[6] && Array.isArray(right[6]) ? right[6][8] ?? "" : "").localeCompare(String(left[6] && Array.isArray(left[6]) ? left[6][8] ?? "" : "")))[0];
  const latestFields = latest && Array.isArray(latest[6]) ? latest[6] : [];
  attributes.citywideLatestInspectionDate = typeof latestFields[8] === "string" ? latestFields[8] : null;
  attributes.citywideAction = typeof latestFields[9] === "string" ? latestFields[9] : null;
  attributes.citywideScore = typeof latestFields[13] === "string" || typeof latestFields[13] === "number" ? String(latestFields[13]) : null;
  attributes.citywideGrade = typeof latestFields[14] === "string" ? latestFields[14] : null;
  attributes.citywideRecordDate = typeof latestFields[16] === "string" ? latestFields[16] : null;
  attributes.citywideInspectionType = typeof latestFields[17] === "string" ? latestFields[17] : null;
  attributes.citywideLocationStatus = detail.l ?? summary.locationStatus;
  return attributes;
}

export class CitywideReleaseAdapter implements RuntimeCityAdapter {
  readonly city: CityAdapter = manhattanAdapter;
  readonly fixtureOnly = false;
  readonly releaseId: string;
  readonly manifest: CitywideReleaseManifest;
  private readonly basePath: string;
  private readonly fetcher: Fetcher;
  private readonly pool: CitywideRequestPool<LoadedShard>;
  private readonly cacheNamespace: string;
  private readonly resolveBudgets: () => CitywideBudgetRecord;
  /** Public so a composed session can report the caps it actually runs under. */
  get budgets(): CitywideBudgetRecord { return this.resolveBudgets(); }
  private readonly sourceSnapshots: ReadonlyMap<string, SourceSnapshot>;
  /**
   * Decoded features per cached shard, keyed on the shard object itself.
   *
   * A settled camera move that does not change the shard set used to rebuild
   * every visible parent — a fresh `Feature` plus `validateFeature` for each —
   * even though the bytes behind them had not moved. At island overview that
   * is a 45,194-parent decode and, because the new objects were never
   * reference-equal, a full Cesium instance rebuild on every move.
   *
   * The cache hands back the SAME `LoadedShard` object while an entry is
   * resident (`CitywideRequestPool.loadShared` resolves `cache.get`), so shard
   * identity is exactly the right memo key: a re-fetch after eviction produces
   * a new object and correctly misses. A `WeakMap` means an evicted shard's
   * decoded features become collectable with it, with no second bound to keep.
   */
  private readonly shardFeatureMemo = new WeakMap<LoadedShard, readonly Feature[]>();
  /** The visible shard objects that produced `visibleFeatures`, in order. */
  private committedVisibleShards: readonly LoadedShard[] | null = null;
  // Keyed by visibility, not a single slot: `loadLayerFeatures` asks for one
  // layer at a time between viewport refreshes, and a one-slot memo would be
  // evicted by those calls and hand the render path a fresh array for an
  // unchanged sequence.
  private visibleFeatureView: { source: readonly Feature[]; results: Map<string, Feature[]> } | null = null;
  private readonly summaries = new Map<string, CitywideSearchSummary>();
  private readonly features = new Map<string, Feature>();
  private readonly detailFeatures = new Map<string, Feature>();
  private detailIndexPromise: Promise<Map<string, string>> | null = null;
  private identityIndex: Map<string, string> | null = null;
  private detailIndexEntryCount = 0;
  private visibleFeatures: Feature[] = [];
  private visibleShardCount = 0;
  private requestedShardCount = 0;
  private generation = 0;
  private viewportAbortController: AbortController | null = null;
  private activeViewportSignature: string | null = null;
  private activeViewportPromise: Promise<readonly Feature[]> | null = null;
  private committedViewportSignature: string | null = null;
  private dedupedRefreshCount = 0;
  private staleResultCount = 0;
  private destroyed = false;

  constructor(manifest: CitywideReleaseManifest, basePath: string, fetcher: Fetcher = globalThis.fetch.bind(globalThis), options: CitywideRuntimeOptions = {}) {
    const validation = validateCitywideReleaseManifest(manifest);
    if (!validation.ok) throw new Error(`Citywide release manifest is invalid: ${validation.issues.map((item) => `${item.path} ${item.message}`).join("; ")}`);
    if (manifest.fixtureOnly || manifest.releaseId !== CITYWIDE_RELEASE_ID) throw new Error("Only the pinned non-fixture citywide release may activate this adapter.");
    if (!manifest.detailIndex || manifest.detailIndex.entryCount !== 57_633) throw new Error("Citywide detail index must declare exactly 57,633 parent entries.");
    this.manifest = manifest;
    this.releaseId = manifest.releaseId;
    this.basePath = basePath.replace(/\/$/, "");
    this.fetcher = fetcher;
    this.cacheNamespace = options.cacheNamespace ?? manifest.releaseId;
    const budgets = options.budgets ?? CITYWIDE_BUDGETS;
    this.resolveBudgets = typeof budgets === "function" ? budgets : () => budgets;
    // Concurrency and the private cache caps are structural and are read once;
    // both records declare the same concurrency, and a private cache has no
    // second tenant whose mode could disagree with this one.
    const sharedCache = options.sharedCache as unknown as CitywideLruCache<LoadedShard> | undefined;
    this.pool = new CitywideRequestPool<LoadedShard>(this.budgets.maxConcurrentRequests, sharedCache ?? new CitywideLruCache<LoadedShard>(this.budgets.maxLoadedShards, this.budgets.maxLoadedBytes), options.sharedBudget ?? null);
    this.sourceSnapshots = new Map(manifest.sourceSnapshots.map((source) => [source.registryEntryId, source]));
  }

  get assetResolver(): undefined { return undefined; }

  getLayerManifest(layer: RuntimeLayerId): LayerManifest {
    const cityLayer = layer === "buildings" ? this.manifest.layers.find((item) => item.id === "buildings") : layer === "pois" ? this.manifest.layers.find((item) => item.id === "restaurants") : undefined;
    const shards = layer === "buildings" ? this.manifest.geometryShards.filter((item) => item.layer === "buildings") : layer === "pois" ? this.manifest.geometryShards.filter((item) => item.layer === "restaurants") : [];
    return {
      schemaVersion: "1.0",
      id: layer,
      version: this.releaseId,
      label: layer === "pois" ? "Restaurants" : cityLayer?.label ?? layer,
      fixtureOnly: false,
      featureKinds: layer === "buildings" ? ["building"] : layer === "pois" ? ["poi"] : [],
      featureIds: [],
      tileLevel: CITYWIDE_TILE_LEVEL,
      tileKeys: [...new Set(shards.map((item) => item.tileKey))].sort(),
      sourceRegistryEntryIds: cityLayer?.sourceRegistryEntryIds ?? [],
      acceptedCount: cityLayer?.parentCount ?? 0,
      generatedAt: this.manifest.generatedAt,
    };
  }

  getFeature(featureId: string): Feature | undefined { return this.detailFeatures.get(featureId) ?? this.features.get(featureId); }

  /**
   * Deterministic release membership, independent of what is currently resident.
   *
   * `getFeature` only sees shards the camera has already streamed, so using it
   * as a membership oracle makes the answer load-order and camera dependent.
   * The detail index is checksum-verified release data covering every parent in
   * the release, so it answers "is this a member" the same way on every run.
   * Call `ensureIdentityIndex` once before relying on `hasIdentityMember`.
   */
  async ensureIdentityIndex(signal?: AbortSignal): Promise<number> {
    let index: Map<string, string>;
    try {
      index = await this.loadDetailIndex(signal);
    } catch (error) {
      // A concurrent caller can abort the memoized load while this caller is
      // still live. The memo self-clears on rejection, so retry once rather
      // than leaving streaming failed until someone toggles it manually.
      const foreignAbort = error instanceof DOMException && error.name === "AbortError" && signal?.aborted !== true;
      if (!foreignAbort) throw error;
      index = await this.loadDetailIndex(signal);
    }
    this.identityIndex = index;
    return index.size;
  }

  hasIdentityMember(featureId: string): boolean {
    return (this.identityIndex?.has(featureId) ?? false) || this.getFeature(featureId) !== undefined;
  }

  getFeatures(visibility: LayerVisibility = DEFAULT_LAYER_VISIBILITY): readonly Feature[] {
    // `visibleFeatures` is already id-sorted where it is assigned, and `filter`
    // preserves order, so the historical re-sort here only re-paid an
    // O(n log n) `localeCompare` pass per call. Memoizing on the source array
    // identity plus the visibility key also makes two consecutive calls return
    // the SAME array, which is what lets the app's sequence check reuse it.
    const key = (Object.keys(visibility) as RuntimeLayerId[]).sort().map((layer) => `${layer}:${visibility[layer] ? 1 : 0}`).join(",");
    const cached = this.visibleFeatureView?.source === this.visibleFeatures ? this.visibleFeatureView : null;
    const existing = cached?.results.get(key);
    if (existing) return existing;
    const result = this.visibleFeatures.filter((feature) => {
      const layer = layerForFeature(feature);
      return layer ? visibility[layer] : false;
    });
    const view = cached ?? { source: this.visibleFeatures, results: new Map<string, Feature[]>() };
    view.results.set(key, result);
    this.visibleFeatureView = view;
    return result;
  }

  search(query: string): Feature[] {
    const normalized = normalizeCitywideQuery(query);
    if (!normalized) return [];
    return searchSummaryList(this.summaries.values(), normalized).map((summary) => this.summaryFeature(summary));
  }

  async searchAsync(query: string, signal?: AbortSignal): Promise<Feature[]> {
    const normalized = normalizeCitywideQuery(query);
    if (!normalized) return [];
    const rawQuery = query.trim();
    const exactIdentifier = isCitywideExactIdentifier(rawQuery) ? rawQuery.toLocaleLowerCase() : null;
    const prefixes = new Set(selectCitywideSearchPrefixes(this.manifest.searchShards, query));
    const shards = this.manifest.searchShards.filter((shard) => prefixes.has(shard.prefix));
    const loadedSummaries = new Map<string, CitywideSearchSummary>();
    await Promise.all(shards.map(async (shard) => {
      if (signal?.aborted) throw new DOMException("Search request was aborted.", "AbortError");
      const loaded = await this.loadRef(shard.relativeContentRef, shard.checksumSha256, signal);
      if (signal?.aborted) throw new DOMException("Search request was aborted.", "AbortError");
      if (!loaded || !isRecord(loaded.payload) || loaded.payload.schemaVersion !== "citywide-search-1" || !Array.isArray(loaded.payload.summaries)) throw new Error(`Invalid citywide search shard ${shard.relativeContentRef}.`);
      loaded.payload.summaries.forEach((value) => {
        if (exactIdentifier) {
          const identifiers = Array.isArray(value) && Array.isArray(value[5]) ? value[5] : [];
          const parentMatch = Array.isArray(value) && typeof value[0] === "string" && value[0].toLocaleLowerCase() === exactIdentifier;
          const sourceMatch = identifiers.some((identifier) => typeof identifier === "string" && identifier.toLocaleLowerCase() === exactIdentifier);
          if (!parentMatch && !sourceMatch) return;
        }
        const summary = compactSummary(value);
        if (summary) {
          loadedSummaries.set(summary.parentId, summary);
          this.setBounded(this.summaries, summary.parentId, summary, this.budgets.maxDecodedSummaries);
        }
      });
    }));
    // A hash bucket may span several dense chunks. Preserve the current
    // request's matches before the global decoded-summary LRU evicts an early
    // chunk; otherwise an exact ID in chunk 0 can disappear behind later
    // chunks even though the routing was correct.
    const matches = exactIdentifier ? [...loadedSummaries.values()] : searchSummaryList(loadedSummaries.values(), normalized);
    return matches.map((summary) => {
      this.setBounded(this.summaries, summary.parentId, summary, this.budgets.maxDecodedSummaries);
      return this.summaryFeature(summary);
    });
  }

  async loadLayerFeatures(layer: RuntimeLayerId): Promise<readonly Feature[]> {
    return this.getFeatures({ ...DEFAULT_LAYER_VISIBILITY, buildings: layer === "buildings", pois: layer === "pois", areas: false, stations: false, entrances: false, routes: false });
  }

  refreshViewport(input: ViewportRefreshInput, signal?: AbortSignal): Promise<readonly Feature[]> {
    if (this.destroyed) return Promise.resolve([]);
    const request = normalizeViewportRefreshRequest(input);
    const viewport = request.footprint.bounds;
    const requested = [
      // Fixed-camera citywide requests must stay within the first-camera
      // budget. Geometry outside the viewport is loaded only when a later
      // camera move intersects it; the cache remains bounded independently.
      ...this.selectViewportShards(this.manifest.geometryShards.filter((shard) => shard.layer === "buildings"), viewport),
      ...this.selectViewportShards(this.manifest.geometryShards.filter((shard) => shard.layer === "restaurants"), viewport),
    ];
    const unique = [...new Map(requested.map((shard) => [shard.relativeContentRef, shard])).values()];
    const ranked = unique.sort((left, right) => this.shardDistance(left, request.footprint.groundCenter) - this.shardDistance(right, request.footprint.groundCenter) || left.shardId.localeCompare(right.shardId));
    const bounded = retainCameraShards(ranked, request.camera, this.budgets.maxLoadedShards);
    const visibleRefs = new Set(bounded.filter((shard) => this.shardIntersectsViewport(shard, viewport)).map((shard) => shard.relativeContentRef));
    const signature = `${request.footprint.signature}|${[...visibleRefs].sort().join(",")}|${bounded.map((shard) => shard.relativeContentRef).sort().join(",")}`;
    if (signature === this.activeViewportSignature && this.activeViewportPromise) {
      this.dedupedRefreshCount += 1;
      return this.activeViewportPromise;
    }
    if (signature === this.committedViewportSignature) {
      this.dedupedRefreshCount += 1;
      return Promise.resolve(this.getFeatures());
    }
    // A changed settled footprint cancels only the previous viewport waiter.
    // The shared request pool still owns joined local fetches.
    this.viewportAbortController?.abort();
    const viewportController = new AbortController();
    this.viewportAbortController = viewportController;
    const abortViewport = () => viewportController.abort();
    signal?.addEventListener("abort", abortViewport, { once: true });
    if (signal?.aborted) viewportController.abort();
    const generation = ++this.generation;
    this.visibleShardCount = visibleRefs.size;
    this.requestedShardCount = bounded.length;
    const run = async (): Promise<readonly Feature[]> => {
      try {
        const values = await Promise.all(bounded.map((shard) => this.loadRef(shard.relativeContentRef, shard.checksumSha256, viewportController.signal)));
        if (viewportController.signal.aborted || generation !== this.generation || this.destroyed) {
          this.staleResultCount += 1;
          return this.getFeatures();
        }
        const visible: LoadedShard[] = [];
        values.forEach((loaded) => {
          if (!loaded || !isRecord(loaded.payload) || loaded.payload.schemaVersion !== "citywide-geometry-1" || !Array.isArray(loaded.payload.features)) return;
          const payload = loaded.payload as GeometryPayload;
          const declared = bounded.find((shard) => shard.relativeContentRef === loaded.ref);
          if (!declared || payload.layer !== declared.layer || payload.tileKey !== declared.tileKey) throw new Error(`Citywide geometry payload ${loaded.ref} does not match its emitted manifest tile/layer.`);
          if (!visibleRefs.has(loaded.ref)) return;
          visible.push(loaded);
        });
        // Nothing about the resident geometry changed, only where the camera
        // is pointing. Keep the exact feature objects the last commit
        // produced: the app's sequence check then retains its array and no
        // Cesium instance is rebuilt.
        if (this.sameVisibleShards(visible)) {
          this.committedViewportSignature = signature;
          return this.getFeatures();
        }
        const next = new Map<string, Feature>();
        visible.forEach((loaded) => {
          this.shardFeatures(loaded).forEach((feature) => next.set(feature.id, feature));
        });
        this.visibleFeatures = [...next.values()].sort((left, right) => left.id.localeCompare(right.id));
        this.visibleFeatures.forEach((feature) => this.setBounded(this.features, feature.id, feature, this.budgets.maxDecodedFeatures));
        this.committedVisibleShards = visible;
        this.committedViewportSignature = signature;
        return this.getFeatures();
      } finally {
        signal?.removeEventListener("abort", abortViewport);
        if (this.viewportAbortController === viewportController) this.viewportAbortController = null;
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

  async loadDetail(parentId: string, signal?: AbortSignal): Promise<Feature | undefined> {
    const index = await this.loadDetailIndex(signal);
    if (signal?.aborted) return undefined;
    const ref = index.get(parentId);
    if (!ref) return undefined;
    const manifest = this.manifest.detailShards.find((shard) => shard.relativeContentRef === ref);
    if (!manifest) throw new Error(`Citywide detail index points to undeclared shard ${ref}.`);
    const loaded = await this.loadRef(ref, manifest.checksumSha256, signal);
    if (signal?.aborted) return undefined;
    if (!loaded || !isRecord(loaded.payload) || loaded.payload.schemaVersion !== "citywide-details-1" || !Array.isArray(loaded.payload.records)) throw new Error(`Invalid citywide detail shard ${ref}.`);
    const detail = loaded.payload.records.map(compactDetail).find((item): item is CompactDetail => item?.p === parentId);
    if (!detail) throw new Error(`Citywide detail shard ${ref} omitted indexed parent ${parentId}.`);
    let summary = this.summaries.get(parentId) ?? this.summaryFromFeature(this.features.get(parentId));
    if (!summary) summary = this.summaryFromDetail(detail, ref);
    if (!summary) return undefined;
    const existingGeometry = this.features.get(parentId);
    // Search results intentionally create a lightweight point feature.  A
    // cold building deep link must still hydrate its emitted polygon from the
    // geometry chunks, even when that summary feature is already cached.
    if (summary.kind === "building" && summary.coordinates && (!existingGeometry || existingGeometry.geometry.type === "Point")) await this.loadGeometryForParent(summary, signal);
    const registry = detail.k === "building" ? "nyc.building-footprints" : "nyc.dohmh-restaurant-inspections";
    const explicitRefs = [...(detail.s ?? []), ...(detail.r ?? [])].filter((value) => value.startsWith("source-ref:"));
    const sourceIds = explicitRefs.length > 0 ? explicitRefs : detail.s ?? detail.r ?? summary.sourceIdentifiers;
    const sourceRefs = sourceRefsFor(this.manifest, registry, sourceIds, explicitRefs);
    const detailFeature = citywideFeature(this.manifest, { ...summary, name: detail.n ?? summary.name, coordinates: detail.c ?? summary.coordinates, locationStatus: detail.l ?? summary.locationStatus }, geometryFromDetail(detail, this.features.get(parentId)), sourceRefs, detailAttributes(detail, summary));
    const existing = this.features.get(parentId);
    if (existing?.kind === "building") {
      detailFeature.geometryProvenance.height = { ...existing.geometryProvenance.height };
      detailFeature.geometryProvenance.notes = existing.geometryProvenance.notes;
      const validation = validateFeature(detailFeature);
      if (!validation.ok) throw new Error(`Citywide detail ${parentId} failed post-geometry validation: ${validation.issues.map((item) => `${item.path} ${item.message}`).join("; ")}`);
    }
    this.setBounded(this.detailFeatures, parentId, detailFeature, this.budgets.maxDecodedDetails);
    this.setBounded(this.features, parentId, detailFeature, this.budgets.maxDecodedFeatures);
    return detailFeature;
  }

  async loadDetailsForFeature(feature: Feature, signal?: AbortSignal): Promise<Feature | undefined> { return this.loadDetail(feature.id, signal); }

  getMetrics(): CitywideRuntimeMetrics {
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
      dedupedRefreshCount: this.dedupedRefreshCount,
    };
  }

  destroy(): void {
    this.destroyed = true;
    this.viewportAbortController?.abort();
    this.viewportAbortController = null;
    this.pool.abortExcept([]);
  }

  /**
   * Set equality over the visible shard objects, deliberately order-insensitive.
   *
   * The visible list is produced in distance-ranked order, so a camera nudge
   * can permute an otherwise unchanged set, and an order-sensitive comparison
   * would pay the full class rebuild for a set that did not change. Comparing
   * as a set is sound here because the merge that builds `visibleFeatures` is
   * keyed by parent id and the committed release carries exactly one geometry
   * part per building parent (45,194 parts for 45,194 parents), so no parent
   * is served by two shards and no permutation can change which record wins.
   */
  private sameVisibleShards(visible: readonly LoadedShard[]): boolean {
    const committed = this.committedVisibleShards;
    if (committed === null || committed.length !== visible.length) return false;
    // Set equality needs both sides distinct, and the caller's distinctness is
    // an upstream property (`unique` de-duplicates by ref before ranking)
    // rather than something visible here. Check it instead of inheriting it,
    // so a future selection change that admitted a repeat would take the slow
    // path rather than silently comparing equal on a shorter set.
    const resident = new Set(committed);
    if (resident.size !== committed.length) return false;
    const incoming = new Set(visible);
    if (incoming.size !== visible.length) return false;
    return visible.every((shard) => resident.has(shard));
  }

  /**
   * Decode a geometry shard once per resident copy.
   *
   * The decoded features are immutable and are handed out by reference, which
   * is the whole point: an unchanged shard must yield the same objects so the
   * render plan can be reused. Validation failures still throw here, on the
   * first decode, exactly as they did before.
   */
  private shardFeatures(loaded: LoadedShard): readonly Feature[] {
    const memoized = this.shardFeatureMemo.get(loaded);
    if (memoized) return memoized;
    const payload = loaded.payload as GeometryPayload;
    const recordsByParent = new Map<string, unknown[]>();
    payload.features.forEach((value) => {
      const parentId = isRecord(value) && typeof value.parentId === "string" ? value.parentId : null;
      if (!parentId) throw new Error(`Geometry shard ${loaded.ref} contains a record without a stable parent ID.`);
      recordsByParent.set(parentId, [...(recordsByParent.get(parentId) ?? []), value]);
    });
    const features: Feature[] = [];
    recordsByParent.forEach((records, parentId) => {
      const feature = payload.layer === "buildings" ? this.buildingFeature(records, parentId, payload.tileKey) : this.restaurantGeometryFeature(records, parentId);
      if (feature) features.push(feature);
    });
    this.shardFeatureMemo.set(loaded, features);
    return features;
  }

  private summaryFeature(summary: CitywideSearchSummary): Feature {
    const existing = this.features.get(summary.parentId);
    if (existing) return existing;
    const registry = summary.kind === "building" ? "nyc.building-footprints" : "nyc.dohmh-restaurant-inspections";
    const sourceRefs = sourceRefsFor(this.manifest, registry, summary.sourceIdentifiers);
    const feature = citywideFeature(this.manifest, summary, { type: "Point", coordinates: summary.coordinates ?? [0, 0] }, sourceRefs);
    this.setBounded(this.features, summary.parentId, feature, this.budgets.maxDecodedFeatures);
    return feature;
  }

  private summaryFromFeature(feature: Feature | undefined): CitywideSearchSummary | undefined {
    if (!feature || feature.attributes.citywideReleaseId !== this.releaseId) return undefined;
    const sourceIdentifiers = (() => { try { const parsed = JSON.parse(String(feature.attributes.citywideSourceIdentifiers ?? "[]")); return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []; } catch { return []; } })();
    return { parentId: feature.id, kind: feature.kind === "building" ? "building" : "restaurant", name: feature.name, address: typeof feature.attributes.placeAddress === "string" ? feature.attributes.placeAddress : null, cuisine: typeof feature.attributes.placeCuisine === "string" ? feature.attributes.placeCuisine : null, normalizedTokens: citywideQueryTokens(feature.name), coordinates: feature.attributes.citywideLocationStatus === "location-unavailable" ? null : feature.coordinates, locationStatus: feature.attributes.citywideLocationStatus === "location-unavailable" ? "location-unavailable" : "located", tileKeys: [], detailRef: typeof feature.attributes.citywideDetailRef === "string" ? feature.attributes.citywideDetailRef : "" , sourceIdentifiers };
  }

  private summaryFromDetail(detail: CompactDetail, detailRef: string): CitywideSearchSummary | undefined {
    const coordinates = detail.c ?? (detail.k === "building" && Array.isArray(detail.v?.[0]) && isPosition(detail.v[0][3]) ? detail.v[0][3] : null);
    const sourceIdentifiers = (detail.s ?? detail.r ?? []).map(sourceRecordIdFromRef);
    return {
      parentId: detail.p,
      kind: detail.k,
      name: detail.n,
      address: null,
      cuisine: null,
      sourceIdentifiers,
      normalizedTokens: citywideQueryTokens([detail.n, ...sourceIdentifiers].filter(Boolean).join(" ")),
      coordinates,
      locationStatus: detail.l ?? "located",
      tileKeys: coordinates ? [tileKeyString(tileKeyForCoordinate(coordinates[0], coordinates[1], CITYWIDE_TILE_LEVEL))] : [],
      detailRef,
    };
  }

  private async loadGeometryForParent(summary: CitywideSearchSummary, signal?: AbortSignal): Promise<void> {
    if (!summary.coordinates) return;
    const tileKey = tileKeyString(tileKeyForCoordinate(summary.coordinates[0], summary.coordinates[1], CITYWIDE_TILE_LEVEL));
    // A tile can be split into multiple deterministic chunks.  Do not assume
    // the first manifest entry contains a cold deep-link parent.
    const shards = this.manifest.geometryShards
      .filter((item) => item.layer === "buildings" && item.tileKey === tileKey)
      .sort((left, right) => left.densePartIndex - right.densePartIndex || left.shardId.localeCompare(right.shardId));
    if (shards.length === 0) return;
    const loadedShards = await Promise.all(shards.map((shard) => this.loadRef(shard.relativeContentRef, shard.checksumSha256, signal)));
    if (signal?.aborted) return;
    const records: Record<string, unknown>[] = [];
    loadedShards.forEach((loaded, index) => {
      const shard = shards[index]!;
      if (!loaded || !isRecord(loaded.payload) || loaded.payload.schemaVersion !== "citywide-geometry-1" || loaded.payload.layer !== "buildings" || loaded.payload.tileKey !== shard.tileKey || !Array.isArray(loaded.payload.features)) throw new Error(`Citywide deep-link geometry shard ${shard.relativeContentRef} failed its tile/layer gate.`);
      loaded.payload.features.forEach((record) => {
        if (isRecord(record) && record.parentId === summary.parentId) records.push(record);
      });
    });
    if (records.length > 0) {
      const feature = this.buildingFeature(records, summary.parentId, tileKey);
      if (feature) this.setBounded(this.features, summary.parentId, feature, this.budgets.maxDecodedFeatures);
    }
  }

  private buildingFeature(records: unknown[], parentId: string, payloadTileKey: string): Feature | undefined {
    const parts = records.map((record) => compactBuildingPart(record, payloadTileKey));
    if (parts.some((part) => !part)) throw new Error(`Citywide geometry contains malformed building parent ${parentId}.`);
    const valid = parts.filter((part): part is CitywideBuildingPart => Boolean(part));
    const first = valid[0];
    if (!first) return undefined;
    const polygons = valid.flatMap((part) => part.geometry.type === "Polygon" ? [part.geometry.coordinates] : part.geometry.type === "MultiPolygon" ? part.geometry.coordinates : []);
    const geometry: Geometry = polygons.length === 1 ? { type: "Polygon", coordinates: polygons[0]! } : { type: "MultiPolygon", coordinates: polygons };
    const summary: CitywideSearchSummary = { parentId, kind: "building", name: first.name, address: null, cuisine: null, sourceIdentifiers: [first.sourceRecordId, first.bin, first.baseBbl, first.mapPlutoBbl].filter((value): value is string => Boolean(value)), normalizedTokens: citywideQueryTokens(first.name), coordinates: first.coordinates, locationStatus: "located", tileKeys: [first.tileKey], detailRef: `details/${parentId}` };
    this.setBounded(this.summaries, parentId, summary, this.budgets.maxDecodedSummaries);
    const sourceRefs = sourceRefsFor(this.manifest, "nyc.building-footprints", valid.flatMap((part) => part.sourceRefIds), valid.map((part) => part.sourceRefIds[0] ?? ""));
    const feature = citywideFeature(this.manifest, summary, geometry, sourceRefs, { citywidePartCount: valid.length, citywidePartIds: JSON.stringify(valid.map((part) => part.partId)), citywideHeightMeters: first.heightMeters, citywideHeightUnknown: first.heightUnknown, citywideDoittId: first.sourceRecordId, citywideBin: first.bin, citywideBaseBbl: first.baseBbl, citywideMapPlutoBbl: first.mapPlutoBbl });
    feature.geometryProvenance.height = {
      schemaVersion: "1.0",
      valueMeters: first.heightUnknown ? null : first.heightMeters,
      sourceValue: first.heightMeters,
      sourceUnit: "meters",
      verticalDatum: "OTI source-published building height; datum not specified",
      sourceRefId: sourceRefs[0]?.id ?? null,
      method: first.heightUnknown ? "unknown" : "source",
      uncertaintyMeters: null,
    };
    feature.geometryProvenance.notes = "Compact citywide release geometry; OTI roof height is preserved for Cesium extrusion; no facade fidelity claim.";
    const validation = validateFeature(feature);
    if (!validation.ok) throw new Error(`Citywide building ${parentId} failed post-height validation: ${validation.issues.map((item) => `${item.path} ${item.message}`).join("; ")}`);
    return feature;
  }

  private restaurantGeometryFeature(records: unknown[], parentId: string): Feature | undefined {
    const first = records.find(isRecord);
    if (!first || typeof first.name !== "string" || !isPosition(first.coordinates)) throw new Error(`Citywide geometry contains malformed restaurant parent ${parentId}.`);
    const summary: CitywideSearchSummary = { parentId, kind: "restaurant", name: typeof first.name === "string" ? first.name : null, address: typeof first.address === "string" ? first.address : null, cuisine: typeof first.cuisine === "string" ? first.cuisine : null, sourceIdentifiers: Array.isArray(first.sourceRecordIds) ? first.sourceRecordIds.filter((value): value is string => typeof value === "string") : [], normalizedTokens: citywideQueryTokens([first.name, first.address, first.cuisine, ...((first.sourceRecordIds ?? []) as unknown[])].filter((value): value is string => typeof value === "string").join(" ")), coordinates: first.coordinates, locationStatus: first.locationStatus === "location-unavailable" ? "location-unavailable" : "located", tileKeys: Array.isArray(first.tileKeys) ? first.tileKeys.filter((value): value is string => typeof value === "string") : [], detailRef: typeof first.detailRef === "string" ? first.detailRef : `details/${parentId}` };
    this.setBounded(this.summaries, parentId, summary, this.budgets.maxDecodedSummaries);
    const sourceRefs = sourceRefsFor(this.manifest, "nyc.dohmh-restaurant-inspections", summary.sourceIdentifiers);
    return citywideFeature(this.manifest, summary, { type: "Point", coordinates: summary.coordinates ?? [0, 0] }, sourceRefs, { citywideObservationCount: typeof first.observationCount === "number" ? first.observationCount : null });
  }

  private async loadDetailIndex(signal?: AbortSignal): Promise<Map<string, string>> {
    if (this.detailIndexPromise) return this.detailIndexPromise;
    const declared = this.manifest.detailIndex;
    if (!declared) throw new Error("Citywide release has no detail index.");
    const pending = this.loadRef(declared.relativeContentRef, declared.checksumSha256, signal).then((loaded) => {
      if (signal?.aborted) throw new DOMException("Detail index request was aborted.", "AbortError");
      if (!loaded || !isRecord(loaded.payload) || loaded.payload.schemaVersion !== "citywide-detail-index-1" || !Array.isArray(loaded.payload.entries)) throw new Error("Citywide detail index payload is invalid.");
      const entries = loaded.payload.entries;
      if (entries.length !== declared.entryCount || entries.length !== 57_633) throw new Error("Citywide detail index entryCount is not exactly 57,633.");
      const map = new Map<string, string>();
      entries.forEach((entry) => {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || typeof entry[1] !== "string" || map.has(entry[0])) throw new Error("Citywide detail index contains duplicate or malformed parent entries.");
        map.set(entry[0], entry[1]);
      });
      if (map.size !== 57_633) throw new Error("Citywide detail index does not contain exactly 57,633 unique parents.");
      this.detailIndexEntryCount = map.size;
      return map;
    });
    this.detailIndexPromise = pending.catch((error: unknown) => {
      this.detailIndexPromise = null;
      this.detailIndexEntryCount = 0;
      throw error;
    });
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
    const safeRef = ref.replace(/^\/+/, "");
    if (safeRef !== ref || safeRef.includes("..") || safeRef.includes("\\") || safeRef.includes("://")) throw new Error(`Unsafe citywide runtime ref ${ref}.`);
    if (signal?.aborted) return undefined;
    const task = { key: `${this.cacheNamespace}:${ref}`, loader: async (requestSignal: AbortSignal) => {
      const combinedController = new AbortController();
      const abort = () => combinedController.abort();
      requestSignal.addEventListener("abort", abort, { once: true });
      try {
        const response = await this.fetcher(`${this.basePath}/${safeRef}`, { signal: combinedController.signal });
        if (!response.ok) throw new Error(`Citywide release request failed (${response.status}) for ${ref}.`);
        const text = await response.text();
        const actual = await sha256Hex(text);
        if (actual.toLowerCase() !== checksum.toLowerCase()) throw new Error(`Citywide checksum mismatch for ${ref}.`);
        let payload: unknown;
        try { payload = JSON.parse(text); } catch { throw new Error(`Citywide payload ${ref} is not valid JSON.`); }
        const byteSize = new TextEncoder().encode(text).byteLength;
        return { value: { ref, payload: payload as LoadedShard["payload"], byteSize }, bytes: byteSize };
      } finally {
        // Keep the pooled request signal attached through body read, hashing,
        // and JSON validation; a post-header cancellation must not promote data.
        requestSignal.removeEventListener("abort", abort);
      }
    } };
    try {
      return await this.pool.load(task, signal);
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") return undefined;
      throw error;
    }
  }

  private selectViewportShards(shards: readonly CitywideShardManifest[], viewport: ViewportBounds): CitywideShardManifest[] {
    // The existing release helper intentionally has a non-wrapped TileBounds
    // contract. Preserve its prefetch behavior for normal views and use the
    // shared wrapped-bounds predicate only for the reusable dateline case.
    return viewportBoundsCrossesAntimeridian(viewport)
      ? shards.filter((shard) => viewportBoundsIntersect(shard.bounds, viewport)).sort((left, right) => left.shardId.localeCompare(right.shardId))
      : selectViewportShards(shards, viewport, 0);
  }

  private shardDistance(shard: CitywideShardManifest, groundCenter: ViewportGroundCenter): number {
    return ((shard.bounds.west + shard.bounds.east) / 2 - groundCenter.longitude) ** 2 + ((shard.bounds.south + shard.bounds.north) / 2 - groundCenter.latitude) ** 2;
  }

  private shardIntersectsViewport(shard: CitywideShardManifest, viewport: ViewportBounds): boolean {
    return viewportBoundsIntersect(shard.bounds, viewport);
  }
}

export async function loadCitywideRelease(basePath = "/data/manhattan-citywide-20260804/", signal?: AbortSignal, fetcher: Fetcher = globalThis.fetch.bind(globalThis), options: CitywideRuntimeOptions = {}): Promise<CitywideReleaseAdapter> {
  const normalizedPath = basePath.replace(/\/$/, "");
  const response = await fetcher(`${normalizedPath}/manifest.json`, { signal });
  if (!response.ok) throw new Error(`Citywide release manifest request failed (${response.status}).`);
  const text = await response.text();
  let manifest: unknown;
  try { manifest = JSON.parse(text); } catch { throw new Error("Citywide release manifest is not valid JSON."); }
  const validation = validateCitywideReleaseManifest(manifest);
  if (!validation.ok) throw new Error(`Citywide release manifest failed validation: ${validation.issues.map((item) => `${item.path} ${item.message}`).join("; ")}`);
  if (validation.value.releaseId !== CITYWIDE_RELEASE_ID || validation.value.fixtureOnly) throw new Error("Requested citywide release is not the pinned non-fixture release.");
  const hashResponse = await fetcher(`${normalizedPath}/manifest.sha256`, { signal });
  if (!hashResponse.ok) throw new Error(`Citywide root checksum request failed (${hashResponse.status}).`);
  const declaredHash = (await hashResponse.text()).trim().split(/\s+/)[0] ?? "";
  const actual = await sha256Hex(text);
  if (!/^[a-f0-9]{64}$/i.test(declaredHash) || actual.toLowerCase() !== declaredHash.toLowerCase()) throw new Error("Citywide root manifest checksum mismatch.");
  return new CitywideReleaseAdapter(validation.value, normalizedPath, fetcher, options);
}

export { stableCitywidePickId };
