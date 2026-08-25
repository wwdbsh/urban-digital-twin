/**
 * Runtime loader for the citywide flat ground release (Task T007).
 *
 * Modelled end to end on `./block835-public-realm-release.ts`: a normalized
 * local base path, a manifest validated before anything else is fetched, and a
 * SHA-256 check of every artifact against the checksum the manifest declares.
 * Three things are different, and each is different for a reason:
 *
 * 1. **The validators are IMPORTED, not restated.** `../release/ground-release.ts`
 *    already owns the release-document, ownership-ledger and feature/part-graph
 *    rules (T005), so this module calls `validateGroundReleaseGraph` and adds
 *    only what a runtime can see that a pure validator cannot: the bytes.
 * 2. **The manifest declares no checksum for its own sidecars.** `release.json`
 *    hashes every per-cell artifact but not `ledger.json`, `features.json` or
 *    `parts.json`. Those three are bound cryptographically anyway, by
 *    re-deriving what the builder derived: `groundIdentitySetChecksum` over the
 *    loaded features and parts must equal the ledger's pinned
 *    `baseIdentitySet.checksumSha256` (that is inside the graph validator), and
 *    `groundOwnershipLedgerId` over the loaded ledger must equal the
 *    `ownershipLedgerId` the release document pins (that is here). A tampered
 *    `features.json`, `parts.json` or `ledger.json` therefore fails closed just
 *    as loudly as a tampered artifact, which is what "match or exceed the Block
 *    835 rigor" has to mean when the manifest itself is silent.
 * 3. **Artifacts are loaded lazily, per cell and per class.** Block 835 is one
 *    block and verifies its whole asset set at load. This release is 352
 *    artifacts and 174 MB, so the manifest load verifies the DOCUMENTS and each
 *    artifact is verified at the moment it is first drawn. Nothing
 *    unverified is ever handed to the renderer; a cell that fails its checksum
 *    is refused and no partial geometry from it reaches the scene.
 *
 * Budgets are BORROWED, not invented. `CITYWIDE_BUDGETS` governs the other
 * shard-shaped JSON streaming in this application and its three numbers are the
 * ones used here; no ground-specific ceiling is declared, because nothing about
 * ground residency has been measured yet and a number nobody sized is worse
 * than a borrowed one that is named as borrowed.
 */

import {
  GROUND_BASE_CLASSES,
  isGroundClass,
  type GroundClass,
  type GroundFeature,
  type GroundSurfaceClass,
} from "../domain/ground.ts";
import { sha256HexBytes } from "../domain/deterministic-hash.ts";
import { CITYWIDE_BUDGETS } from "../release/citywide-release.ts";
import {
  GROUND_PARTITION_SCHEMES,
  MANHATTAN_GROUND_EXTENT,
  groundCellTileKey,
  groundOwnershipLedgerId,
  groundPartitionTiles,
  validateGroundReleaseGraph,
  type GroundAssetEntry,
  type GroundBounds,
  type GroundOwnershipCell,
  type GroundOwnershipLedger,
  type GroundReleaseDocument,
} from "../release/ground-release.ts";
import { isSafeReleaseArtifactReference } from "./path-security.ts";
import { tileKeyForCoordinate, tileKeyString } from "./spatial.ts";
import type { ViewportBounds } from "./viewport-footprint.ts";

export const MANHATTAN_GROUND_RELEASE_ID = "manhattan-ground-20260824";
export const GROUND_ARTIFACT_SCHEMA_VERSION = "manhattan-ground-artifact-1";

/**
 * Residency ceilings for the ground canary, every one of them borrowed.
 *
 * `maxVisibleCells` is the ceiling that actually binds. The declared extent is
 * 140 level-14 cells and the shipped artifacts total about 174 MB, so a
 * whole-island camera would otherwise ask for all of it at once. Bounding the
 * VISIBLE set — nearest to the viewport centre first — is what keeps the byte
 * ceiling reachable rather than decorative, and the count of cells left undrawn
 * is reported to the user rather than hidden.
 */
export const GROUND_RUNTIME_BUDGETS = {
  maxVisibleCells: CITYWIDE_BUDGETS.maxLoadedShards,
  maxCachedBytes: CITYWIDE_BUDGETS.maxLoadedBytes,
  maxConcurrentRequests: CITYWIDE_BUDGETS.maxConcurrentRequests,
} as const;

export interface GroundMultiPolygon {
  type: "MultiPolygon";
  coordinates: number[][][][];
}

export interface GroundArtifactPart {
  partId: string;
  canonicalFeatureId: string;
  clipped: boolean;
  geometry: GroundMultiPolygon;
  sourceProperties?: Record<string, unknown>;
}

export interface GroundCellArtifact {
  schemaVersion: string;
  releaseId: string;
  cellId: string;
  class: GroundClass;
  cellBounds: GroundBounds;
  coordinateDecimals: number;
  partCount: number;
  parts: GroundArtifactPart[];
}

/** A verified artifact plus the byte size that was hashed to admit it. */
export interface LoadedGroundCellArtifact {
  artifact: GroundCellArtifact;
  byteSize: number;
  checksumSha256: string;
}

export interface GroundReleaseIndexEntry {
  cell: GroundOwnershipCell;
  assets: ReadonlyMap<GroundClass, GroundAssetEntry>;
}

export interface LoadedGroundRelease {
  releaseId: string;
  document: GroundReleaseDocument;
  ledger: GroundOwnershipLedger;
  features: readonly GroundFeature[];
  /** Every class the release actually ships an artifact for, in contract order. */
  shippedClasses: readonly GroundClass[];
  partitionTileLevel: number;
  coverage: GroundBounds;
  feature(canonicalFeatureId: string): GroundFeature | undefined;
  cell(cellId: string): GroundReleaseIndexEntry | undefined;
  cellIdForTileKey(tileKey: string): string | undefined;
  /** Cells that ship at least one artifact, in ledger order. */
  materializedCellIds: readonly string[];
  hasArtifact(cellId: string, groundClass: GroundClass): boolean;
  /** Verified bytes or a rejection. Never resolves with partially checked geometry. */
  loadCellClass(cellId: string, groundClass: GroundClass, signal?: AbortSignal): Promise<LoadedGroundCellArtifact>;
  cached(cellId: string, groundClass: GroundClass): LoadedGroundCellArtifact | undefined;
  /** Drops least-recently-used entries outside `keep` until the byte ceiling holds. */
  retain(keep: ReadonlySet<string>): number;
  residency(): { entries: number; bytes: number; evictions: number };
}

export type GroundFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The residency key for one (cell, class) pair.
 *
 * Typed over the whole SURFACE vocabulary rather than the base classes alone so
 * the embellishment runtime keys its own cache the same way. Widening the key
 * does not widen what either loader will serve — each still refuses the other's
 * classes at its asset loop — it only keeps one key scheme instead of two.
 */
export function groundCacheKey(cellId: string, groundClass: GroundSurfaceClass): string {
  return `${cellId}/${groundClass}`;
}

/**
 * The digest every ground-family artifact is admitted by.
 *
 * Exported so the T010 embellishment loader verifies bytes with THIS function
 * rather than a second copy: two hash paths in one family is two chances for
 * one of them to be quietly weakened. Nothing about the flat loader's own use
 * of it changed when it was named.
 */
export async function groundArtifactSha256(bytes: ArrayBuffer): Promise<string> {
  // Web Crypto is only exposed in secure contexts (https / localhost). This
  // local-first app can legitimately be served over plain http on a LAN
  // address, so fall back to the repository's pure-JS digest instead of
  // refusing every artifact for a reason unrelated to its integrity.
  if (!globalThis.crypto?.subtle) return sha256HexBytes(new Uint8Array(bytes));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

const sha256 = groundArtifactSha256;

function normalizeBasePath(basePath: string): string {
  if (!basePath.startsWith(`/data/${MANHATTAN_GROUND_RELEASE_ID}/`) || !basePath.endsWith("/")) {
    throw new Error("Ground base path is not the approved local release root.");
  }
  return basePath;
}

function localDataPath(basePath: string, fileName: string): string {
  if (!/^[a-z0-9._-]+\.json$/u.test(fileName) || fileName.includes("..")) throw new Error("Ground data path is unsafe.");
  return `${basePath}${fileName}`;
}

async function fetchJson(fetcher: GroundFetcher, url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetcher(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`Ground request failed (${response.status}) for ${url}.`);
  return response.json();
}

// ---------------------------------------------------------------------------
// Per-cell artifact validation
// ---------------------------------------------------------------------------

export interface GroundArtifactExpectation {
  releaseId: string;
  cellId: string;
  groundClass: GroundClass;
  cellBounds: GroundBounds;
  /** Part ids the ownership ledger says this cell owns. */
  ownedPartIds: ReadonlySet<string>;
  knownFeatureIds: ReadonlySet<string>;
}

function validRing(value: unknown): value is number[][] {
  if (!Array.isArray(value) || value.length < 4) return false;
  return value.every((position) => Array.isArray(position)
    && position.length >= 2
    && typeof position[0] === "number" && Number.isFinite(position[0]) && Math.abs(position[0]) <= 180
    && typeof position[1] === "number" && Number.isFinite(position[1]) && Math.abs(position[1]) <= 90);
}

/**
 * Structural and RELATIONAL validation of one per-cell artifact.
 *
 * The relational half is the point: a checksum proves the bytes are the bytes
 * the manifest hashed, and says nothing about whether they belong to this cell,
 * this class, or this feature set. A part the ownership ledger does not own, or
 * a canonical feature id absent from `features.json`, would be geometry with no
 * provenance and no selectable identity — so it fails the whole artifact closed
 * rather than being drawn as an anonymous polygon.
 */
export function validateGroundCellArtifact(value: unknown, expectation: GroundArtifactExpectation): GroundCellArtifact {
  if (!record(value)) throw new Error(`Ground artifact for ${expectation.cellId}/${expectation.groundClass} is not an object.`);
  const label = `${expectation.cellId}/${expectation.groundClass}`;
  if (value.schemaVersion !== GROUND_ARTIFACT_SCHEMA_VERSION) throw new Error(`Ground artifact ${label} declares an unsupported schema.`);
  if (value.releaseId !== expectation.releaseId) throw new Error(`Ground artifact ${label} names release ${String(value.releaseId)}.`);
  if (value.cellId !== expectation.cellId) throw new Error(`Ground artifact ${label} names cell ${String(value.cellId)}.`);
  if (value.class !== expectation.groundClass) throw new Error(`Ground artifact ${label} names class ${String(value.class)}.`);
  if (!record(value.cellBounds)
    || value.cellBounds.west !== expectation.cellBounds.west
    || value.cellBounds.south !== expectation.cellBounds.south
    || value.cellBounds.east !== expectation.cellBounds.east
    || value.cellBounds.north !== expectation.cellBounds.north) {
    throw new Error(`Ground artifact ${label} declares bounds that are not its own partition tile.`);
  }
  if (!Array.isArray(value.parts) || value.parts.length === 0) throw new Error(`Ground artifact ${label} carries no parts.`);
  if (value.partCount !== value.parts.length) throw new Error(`Ground artifact ${label} declares ${String(value.partCount)} parts and carries ${value.parts.length}.`);
  const seen = new Set<string>();
  for (const part of value.parts) {
    if (!record(part)) throw new Error(`Ground artifact ${label} carries a non-object part.`);
    if (typeof part.partId !== "string" || !expectation.ownedPartIds.has(part.partId)) {
      throw new Error(`Ground artifact ${label} carries part ${String(part.partId)}, which cell ${expectation.cellId} does not own.`);
    }
    if (seen.has(part.partId)) throw new Error(`Ground artifact ${label} carries part ${part.partId} twice.`);
    seen.add(part.partId);
    if (typeof part.canonicalFeatureId !== "string" || !expectation.knownFeatureIds.has(part.canonicalFeatureId)) {
      throw new Error(`Ground artifact ${label} carries part ${part.partId} for unknown feature ${String(part.canonicalFeatureId)}.`);
    }
    const geometry = part.geometry;
    if (!record(geometry) || geometry.type !== "MultiPolygon" || !Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
      throw new Error(`Ground artifact ${label} carries part ${part.partId} without MultiPolygon geometry.`);
    }
    for (const polygon of geometry.coordinates) {
      if (!Array.isArray(polygon) || polygon.length === 0 || !polygon.every((ring) => validRing(ring))) {
        throw new Error(`Ground artifact ${label} carries part ${part.partId} with an invalid ring.`);
      }
    }
  }
  return value as unknown as GroundCellArtifact;
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

export interface GroundVisibilityInput {
  bounds: ViewportBounds;
  center?: { longitude: number; latitude: number };
  coverage: GroundBounds;
  tileLevel: number;
  /** Tile key string to cell id, for cells that ship at least one artifact. */
  cellIdForTileKey: (tileKey: string) => string | undefined;
  maxCells?: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function boundsCenter(bounds: ViewportBounds): { longitude: number; latitude: number } {
  return { longitude: (bounds.west + bounds.east) / 2, latitude: (bounds.south + bounds.north) / 2 };
}

/**
 * Ground cells the camera can see, bounded and deterministic.
 *
 * A wrapped viewport (`west > east`, a dateline crossing) and a viewport that
 * misses the coverage entirely both return nothing: neither can be intersected
 * with a single Manhattan rectangle without inventing an answer. Over the
 * ceiling the nearest cells to the viewport centre win, ties broken by ledger
 * order, so the same camera always yields the same set — the property a cache
 * and a byte budget both depend on.
 */
export function visibleGroundCellIds(input: GroundVisibilityInput): string[] {
  const { bounds, coverage, tileLevel } = input;
  const maxCells = input.maxCells ?? GROUND_RUNTIME_BUDGETS.maxVisibleCells;
  const finite = [bounds.west, bounds.south, bounds.east, bounds.north].every((value) => Number.isFinite(value));
  if (!finite || bounds.west > bounds.east || bounds.south > bounds.north) return [];
  const west = clamp(bounds.west, coverage.west, coverage.east);
  const east = clamp(bounds.east, coverage.west, coverage.east);
  const south = clamp(bounds.south, coverage.south, coverage.north);
  const north = clamp(bounds.north, coverage.south, coverage.north);
  if (bounds.east < coverage.west || bounds.west > coverage.east || bounds.north < coverage.south || bounds.south > coverage.north) return [];

  // The northern and eastern coverage edges belong to the tile that ENDS there,
  // so a viewport touching them must not index one tile past the partition.
  const epsilon = 1e-9;
  const northWest = tileKeyForCoordinate(west, Math.min(north, coverage.north - epsilon), tileLevel);
  const southEast = tileKeyForCoordinate(Math.min(east, coverage.east - epsilon), south, tileLevel);
  const candidates: { cellId: string; order: number; distance: number }[] = [];
  const center = input.center ?? boundsCenter(bounds);
  for (let y = northWest.y; y <= southEast.y; y += 1) {
    for (let x = northWest.x; x <= southEast.x; x += 1) {
      const cellId = input.cellIdForTileKey(tileKeyString({ scheme: "wgs84-geodetic", level: tileLevel, x, y }));
      if (!cellId) continue;
      const tile = groundCellTileKey(cellId);
      const tileWest = (tile.x / 2 ** tileLevel) * 360 - 180;
      const tileNorth = 90 - (tile.y / 2 ** tileLevel) * 180;
      const width = 360 / 2 ** tileLevel;
      const height = 180 / 2 ** tileLevel;
      const deltaLongitude = tileWest + width / 2 - center.longitude;
      const deltaLatitude = tileNorth - height / 2 - center.latitude;
      candidates.push({ cellId, order: candidates.length, distance: deltaLongitude * deltaLongitude + deltaLatitude * deltaLatitude });
    }
  }
  if (candidates.length <= maxCells) return candidates.map((entry) => entry.cellId);
  return [...candidates]
    .sort((left, right) => (left.distance === right.distance ? left.order - right.order : left.distance - right.distance))
    .slice(0, maxCells)
    .sort((left, right) => left.order - right.order)
    .map((entry) => entry.cellId);
}

// ---------------------------------------------------------------------------
// Residency
// ---------------------------------------------------------------------------

/**
 * Recency cache over verified per-cell artifacts.
 *
 * Deliberately NOT `CitywideLruCache`: that cache classifies every key into the
 * citywide shard taxonomy and enforces per-class floors defined for that
 * release, and it evicts purely by recency. Ground needs one thing that shape
 * cannot express — an entry the camera can currently SEE must never be the
 * eviction candidate, or a pan would drop the cell it just drew and refetch it
 * on the next frame.
 */
export class GroundArtifactCache<T extends { byteSize: number } = LoadedGroundCellArtifact> {
  private readonly entries = new Map<string, { value: T; used: number }>();
  private clock = 0;
  private evictions = 0;
  private totalBytes = 0;
  /**
   * `onEvict` exists for the T013 imagery cache, whose values hold an object
   * URL over verified bytes: an entry dropped without releasing that handle
   * leaks one per drape a long pan leaves behind. It is optional and the flat
   * and near-tier callers pass nothing, so their behaviour is unchanged.
   */
  constructor(
    private readonly maxBytes: number = GROUND_RUNTIME_BUDGETS.maxCachedBytes,
    private readonly onEvict?: (key: string, value: T) => void,
  ) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("Ground cache byte ceiling must be a positive integer.");
  }
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    entry.used = ++this.clock;
    return entry.value;
  }
  has(key: string): boolean { return this.entries.has(key); }
  set(key: string, value: T): void {
    const existing = this.entries.get(key);
    if (existing) {
      this.totalBytes -= existing.value.byteSize;
      if (existing.value !== value) this.onEvict?.(key, existing.value);
    }
    this.entries.set(key, { value, used: ++this.clock });
    this.totalBytes += value.byteSize;
  }
  size(): number { return this.entries.size; }
  bytes(): number { return this.totalBytes; }
  evictionCount(): number { return this.evictions; }
  keys(): string[] { return [...this.entries.keys()]; }
  /** Evicts least-recently-used entries outside `keep` until the ceiling holds. */
  retain(keep: ReadonlySet<string>): number {
    let evicted = 0;
    while (this.totalBytes > this.maxBytes) {
      let victim: string | null = null;
      let victimUsed = Number.POSITIVE_INFINITY;
      for (const [key, entry] of this.entries) {
        if (keep.has(key)) continue;
        if (entry.used < victimUsed) { victim = key; victimUsed = entry.used; }
      }
      if (victim === null) break;
      const dropped = this.entries.get(victim)!.value;
      this.totalBytes -= dropped.byteSize;
      this.entries.delete(victim);
      this.onEvict?.(victim, dropped);
      this.evictions += 1;
      evicted += 1;
    }
    return evicted;
  }
}

// ---------------------------------------------------------------------------
// Development fault seam
// ---------------------------------------------------------------------------

export const GROUND_FAULTS = ["release", "ledger", "artifact", "artifact-checksum"] as const;
export type GroundFault = (typeof GROUND_FAULTS)[number];

export function parseGroundFault(value: string | null | undefined, developmentEnabled: boolean): GroundFault | null {
  if (!developmentEnabled || !value) return null;
  return (GROUND_FAULTS as readonly string[]).includes(value) ? value as GroundFault : null;
}

function localGroundFaultPath(input: RequestInfo | URL): string | null {
  const raw = input instanceof URL ? input.href : typeof input === "string" ? input : input.url;
  const currentOrigin = typeof window !== "undefined" ? window.location.origin : null;
  try {
    const url = new URL(raw, currentOrigin ?? "http://ground-local.invalid");
    if (currentOrigin && url.origin !== currentOrigin) return null;
    if (!currentOrigin && !raw.startsWith("/")) return null;
    return url.pathname.startsWith(`/data/${MANHATTAN_GROUND_RELEASE_ID}/`) ? url.pathname : null;
  } catch {
    return null;
  }
}

/** Development-only local fault seam; the immutable release bytes are never changed. */
export function createGroundFaultFetcher(fault: GroundFault, fetcher: GroundFetcher = globalThis.fetch.bind(globalThis)): GroundFetcher {
  return async (input, init) => {
    const path = localGroundFaultPath(input);
    if (!path) throw new Error("Ground development fault fetcher permits only current app-origin release files.");
    if (fault === "release" && path.endsWith("/release.json")) return new Response("forced ground release fault", { status: 503, statusText: "Forced local fault" });
    if (fault === "ledger" && path.endsWith("/ledger.json")) return new Response("forced ground ledger fault", { status: 503, statusText: "Forced local fault" });
    if (fault === "artifact" && path.includes("/artifacts/")) return new Response("forced ground artifact fault", { status: 404, statusText: "Forced local fault" });
    if (fault === "artifact-checksum" && path.includes("/artifacts/")) {
      const response = await fetcher(input, init);
      if (!response.ok) return response;
      const text = await response.text();
      return new Response(`${text} `, { status: 200, headers: { "content-type": "application/json" } });
    }
    return fetcher(input, init);
  };
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/** Bounded parallelism, borrowed from `CITYWIDE_BUDGETS.maxConcurrentRequests`. */
export class GroundRequestGate {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(private readonly limit: number) {}
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

export async function loadGroundRelease(
  basePath = `/data/${MANHATTAN_GROUND_RELEASE_ID}/`,
  signal?: AbortSignal,
  fetcher: GroundFetcher = globalThis.fetch.bind(globalThis),
): Promise<LoadedGroundRelease> {
  const normalizedPath = normalizeBasePath(basePath);
  const [documentValue, ledgerValue, featuresValue, partsValue] = await Promise.all([
    fetchJson(fetcher, localDataPath(normalizedPath, "release.json"), signal),
    fetchJson(fetcher, localDataPath(normalizedPath, "ledger.json"), signal),
    fetchJson(fetcher, localDataPath(normalizedPath, "features.json"), signal),
    fetchJson(fetcher, localDataPath(normalizedPath, "parts.json"), signal),
  ]);

  const graph = validateGroundReleaseGraph({ ledger: ledgerValue, document: documentValue, features: featuresValue, parts: partsValue });
  if (!graph.ok) {
    throw new Error(`Ground release failed closed: ${graph.issues.slice(0, 4).map((entry) => `${entry.path} ${entry.message}`).join("; ")}`);
  }
  const { ledger, document, features } = graph.value;
  if (document.releaseId !== MANHATTAN_GROUND_RELEASE_ID) throw new Error(`Ground release id mismatch: ${document.releaseId}.`);

  // The ledger carries no checksum of its own, so its IDENTITY is re-derived.
  // This is the link that makes `ledger.json` — and through its pinned identity
  // checksum, `features.json` and `parts.json` — as tamper-evident as an
  // artifact with a declared hash.
  const derivedLedgerId = groundOwnershipLedgerId({
    cityId: ledger.cityId,
    configId: ledger.configId,
    partitionSchemeId: ledger.partitionSchemeId,
    extentId: MANHATTAN_GROUND_EXTENT.extentId,
    coverage: ledger.coverage,
    baseIdentitySet: ledger.baseIdentitySet,
    cells: ledger.cells,
  });
  if (derivedLedgerId !== ledger.ledgerId) {
    throw new Error("Ground ownership ledger identity does not re-derive from its own contents; the ledger failed closed.");
  }
  const partition = groundPartitionTiles(MANHATTAN_GROUND_EXTENT, ledger.partitionSchemeId);
  if (partition.tiles.length !== ledger.cells.length
    || partition.coverage.west !== ledger.coverage.west
    || partition.coverage.south !== ledger.coverage.south
    || partition.coverage.east !== ledger.coverage.east
    || partition.coverage.north !== ledger.coverage.north) {
    throw new Error("Ground ownership ledger does not partition the declared Manhattan extent.");
  }
  const tileLevel = GROUND_PARTITION_SCHEMES[ledger.partitionSchemeId as keyof typeof GROUND_PARTITION_SCHEMES]?.tileLevel;
  if (tileLevel === undefined) throw new Error(`Unknown ground partition scheme ${ledger.partitionSchemeId}.`);

  const featureById = new Map(features.map((feature) => [feature.canonicalFeatureId, feature]));
  const knownFeatureIds = new Set(featureById.keys());
  const cellIndex = new Map<string, { cell: GroundOwnershipCell; assets: Map<GroundClass, GroundAssetEntry>; ownedPartIds: Set<string> }>();
  const cellIdByTileKey = new Map<string, string>();
  for (const cell of ledger.cells) {
    cellIndex.set(cell.cellId, { cell, assets: new Map(), ownedPartIds: new Set(cell.partIds) });
  }
  const shipped = new Set<GroundClass>();
  for (const asset of document.assets) {
    const entry = cellIndex.get(asset.cellId);
    if (!entry) throw new Error(`Ground asset ${asset.assetId} names a cell outside the ownership ledger.`);
    if (!isGroundClass(asset.class)) throw new Error(`Ground asset ${asset.assetId} declares a non-base class ${asset.class}; this release ships flat classes only.`);
    if (entry.assets.has(asset.class)) throw new Error(`Ground cell ${asset.cellId} declares class ${asset.class} twice.`);
    entry.assets.set(asset.class, asset);
    shipped.add(asset.class);
  }
  const materializedCellIds: string[] = [];
  for (const cell of ledger.cells) {
    const entry = cellIndex.get(cell.cellId)!;
    if (entry.assets.size === 0) continue;
    materializedCellIds.push(cell.cellId);
    cellIdByTileKey.set(tileKeyString(groundCellTileKey(cell.cellId)), cell.cellId);
  }

  const cache = new GroundArtifactCache();
  const gate = new GroundRequestGate(GROUND_RUNTIME_BUDGETS.maxConcurrentRequests);
  const inFlight = new Map<string, Promise<LoadedGroundCellArtifact>>();

  const loadCellClass = async (cellId: string, groundClass: GroundClass, requestSignal?: AbortSignal): Promise<LoadedGroundCellArtifact> => {
    const key = groundCacheKey(cellId, groundClass);
    const cached = cache.get(key);
    if (cached) return cached;
    const pending = inFlight.get(key);
    if (pending) return pending;
    const entry = cellIndex.get(cellId);
    const asset = entry?.assets.get(groundClass);
    if (!entry || !asset) throw new Error(`Ground release ships no ${groundClass} artifact for cell ${cellId}.`);
    const tier = asset.tiers.find((candidate) => candidate.kind === "flat" && candidate.maxDistanceMeters === null);
    if (!tier) throw new Error(`Ground asset ${asset.assetId} has no always-covering flat tier.`);
    if (!isSafeReleaseArtifactReference(tier.artifactRef)) throw new Error(`Ground artifact reference ${tier.artifactRef} is unsafe.`);
    const request = gate.run(async () => {
      const url = `${normalizedPath}${tier.artifactRef}`;
      const response = await fetcher(url, { signal: requestSignal ?? signal, cache: "no-store" });
      if (!response.ok) throw new Error(`Ground artifact request failed (${response.status}) for ${tier.artifactRef}.`);
      const bytes = await response.arrayBuffer();
      const digest = await sha256(bytes);
      if (digest !== tier.checksumSha256) throw new Error(`Ground artifact checksum mismatch for ${tier.artifactRef}.`);
      const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
      const artifact = validateGroundCellArtifact(parsed, {
        releaseId: document.releaseId,
        cellId,
        groundClass,
        cellBounds: entry.cell.bounds,
        ownedPartIds: entry.ownedPartIds,
        knownFeatureIds,
      });
      const loaded: LoadedGroundCellArtifact = { artifact, byteSize: bytes.byteLength, checksumSha256: digest };
      cache.set(key, loaded);
      return loaded;
    }).finally(() => { inFlight.delete(key); });
    inFlight.set(key, request);
    return request;
  };

  return {
    releaseId: document.releaseId,
    document,
    ledger,
    features,
    shippedClasses: GROUND_BASE_CLASSES.filter((groundClass) => shipped.has(groundClass)),
    partitionTileLevel: tileLevel,
    coverage: ledger.coverage,
    feature: (canonicalFeatureId) => featureById.get(canonicalFeatureId),
    cell: (cellId) => {
      const entry = cellIndex.get(cellId);
      return entry ? { cell: entry.cell, assets: entry.assets } : undefined;
    },
    cellIdForTileKey: (tileKey) => cellIdByTileKey.get(tileKey),
    materializedCellIds,
    hasArtifact: (cellId, groundClass) => cellIndex.get(cellId)?.assets.has(groundClass) ?? false,
    loadCellClass,
    cached: (cellId, groundClass) => cache.get(groundCacheKey(cellId, groundClass)),
    retain: (keep) => cache.retain(keep),
    residency: () => ({ entries: cache.size(), bytes: cache.bytes(), evictions: cache.evictionCount() }),
  };
}

/** Do not imply the base scene changed when a ground request fails in isolation. */
export function groundFailureMessage(error: unknown): string {
  const prefix = error instanceof Error ? error.message : "The citywide ground overlay failed closed.";
  return `${prefix} The ground overlay was disabled; the existing base scene was left unchanged.`;
}
