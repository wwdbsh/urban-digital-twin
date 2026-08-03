import type { CityTilePackage, TileContentManifest, SupportedTileLod } from "./tile-package.ts";
import { selectLod, tileBounds, tileKeyForCoordinate, tileKeyString } from "./spatial.ts";

export interface TileCameraState { longitude: number; latitude: number; distanceMeters: number; }
export interface TileStreamBudgets { maxLoadedTiles: number; maxLoadedBytes: number; maxConcurrentRequests: number; minLod: SupportedTileLod; maxLod: SupportedTileLod; }
export interface TileStreamMetrics { generation: number; selectedLod: number | null; visibleTileCount: number; requestedTileCount: number; loadedTileCount: number; evictedTileCount: number; failedTileCount: number; loadedBytes: number; activeRequests: number; maxConcurrentRequests: number; deduplicatedRequests: number; cancelledRequestCount: number; staleResultCount: number; renderedFeatureCount: number; }
export type TileContentLoader<T> = (manifest: TileContentManifest, signal: AbortSignal) => Promise<T>;

interface CacheRecord<T> { value: T; bytes: number; lastUsed: number; manifest: TileContentManifest; }
interface PendingRecord<T> { promise: Promise<T | undefined>; controller: AbortController; manifest: TileContentManifest; generation: number; resolve: (value: T | undefined) => void; }
interface QueueItem<T> { manifest: TileContentManifest; generation: number; resolve: (value: T | undefined) => void; }

export function selectRuntimeTiles(pkg: CityTilePackage, camera: TileCameraState, budgets: Pick<TileStreamBudgets, "minLod" | "maxLod">): TileContentManifest[] {
  const lodSelection = selectLod(camera.distanceMeters);
  const selectedLod = Math.min(budgets.maxLod, Math.max(budgets.minLod, lodSelection.level)) as SupportedTileLod;
  const tileKey = tileKeyForCoordinate(camera.longitude, camera.latitude, selectedLod);
  const exact = pkg.tiles.filter((manifest) => manifest.lod === selectedLod && tileKeyString(manifest.tileKey) === tileKeyString(tileKey));
  if (exact.length) return exact.sort((a, b) => a.contentId.localeCompare(b.contentId));
  const candidates = pkg.tiles.filter((manifest) => manifest.lod === selectedLod);
  const byLayer = new Map<string, TileContentManifest>();
  for (const candidate of candidates) {
    const bounds = tileBounds(candidate.tileKey); const centerLongitude = (bounds.west + bounds.east) / 2; const centerLatitude = (bounds.south + bounds.north) / 2; const distance = (centerLongitude - camera.longitude) ** 2 + (centerLatitude - camera.latitude) ** 2; const existing = byLayer.get(candidate.layer); const existingBounds = existing ? tileBounds(existing.tileKey) : null; const existingDistance = existingBounds ? ((existingBounds.west + existingBounds.east) / 2 - camera.longitude) ** 2 + ((existingBounds.south + existingBounds.north) / 2 - camera.latitude) ** 2 : Number.POSITIVE_INFINITY;
    if (!existing || distance < existingDistance || (distance === existingDistance && candidate.contentId.localeCompare(existing.contentId) < 0)) byLayer.set(candidate.layer, candidate);
  }
  if (byLayer.size) return [...byLayer.values()].sort((a, b) => a.contentId.localeCompare(b.contentId));
  return pkg.tiles.filter((manifest) => manifest.lod >= budgets.minLod && manifest.lod <= budgets.maxLod).sort((a, b) => Math.abs(a.lod - selectedLod) - Math.abs(b.lod - selectedLod) || a.contentId.localeCompare(b.contentId)).slice(0, 1);
}

export class RuntimeTileStream<T> {
  readonly package: CityTilePackage;
  readonly budgets: TileStreamBudgets;
  private readonly loader: TileContentLoader<T>;
  private readonly manifestsById = new Map<string, TileContentManifest>();
  private readonly cache = new Map<string, CacheRecord<T>>();
  private readonly pending = new Map<string, PendingRecord<T>>();
  private readonly queue: QueueItem<T>[] = [];
  private selected = new Set<string>();
  private generation = 0;
  private clock = 0;
  private activeRequests = 0;
  private destroyed = false;
  private metricsState: TileStreamMetrics = { generation: 0, selectedLod: null, visibleTileCount: 0, requestedTileCount: 0, loadedTileCount: 0, evictedTileCount: 0, failedTileCount: 0, loadedBytes: 0, activeRequests: 0, maxConcurrentRequests: 0, deduplicatedRequests: 0, cancelledRequestCount: 0, staleResultCount: 0, renderedFeatureCount: 0 };

  constructor(pkg: CityTilePackage, loader: TileContentLoader<T>, budgets: TileStreamBudgets) {
    this.package = pkg; this.loader = loader; this.budgets = budgets;
    if (budgets.maxLoadedTiles < 1 || budgets.maxLoadedBytes < 1 || budgets.maxConcurrentRequests < 1 || budgets.minLod > budgets.maxLod) throw new Error("Tile stream budgets are invalid.");
    for (const manifest of pkg.tiles) { if (this.manifestsById.has(manifest.contentId)) throw new Error(`Duplicate tile content ID: ${manifest.contentId}`); this.manifestsById.set(manifest.contentId, manifest); }
  }

  async refresh(camera: TileCameraState): Promise<void> {
    if (this.destroyed) return;
    this.generation += 1; const generation = this.generation; const manifests = selectRuntimeTiles(this.package, camera, this.budgets); this.selected = new Set(manifests.map((manifest) => manifest.contentId)); this.metricsState = { ...this.metricsState, generation, selectedLod: manifests[0]?.lod ?? null, visibleTileCount: manifests.length, requestedTileCount: manifests.length, renderedFeatureCount: 0 };
    for (const pending of this.pending.values()) if (!this.selected.has(pending.manifest.contentId)) pending.controller.abort();
    const values = await Promise.all(manifests.map((manifest) => this.request(manifest, generation)));
    if (generation !== this.generation || this.destroyed) return;
    this.metricsState = { ...this.metricsState, renderedFeatureCount: values.reduce((sum, value) => { const count = value && typeof value === "object" && value !== null && "features" in value && Array.isArray((value as { features?: unknown }).features) ? (value as { features: unknown[] }).features.length : 0; return sum + count; }, 0) };
  }

  private request(manifest: TileContentManifest, generation: number): Promise<T | undefined> {
    const cached = this.cache.get(manifest.contentId); if (cached) { cached.lastUsed = ++this.clock; return Promise.resolve(cached.value); }
    const existing = this.pending.get(manifest.contentId); if (existing) { this.metricsState = { ...this.metricsState, deduplicatedRequests: this.metricsState.deduplicatedRequests + 1 }; return existing.promise; }
    let resolveRequest!: (value: T | undefined) => void; const promise = new Promise<T | undefined>((resolve) => { resolveRequest = resolve; }); const pending: PendingRecord<T> = { promise, controller: new AbortController(), manifest, generation, resolve: resolveRequest }; this.pending.set(manifest.contentId, pending); this.queue.push({ manifest, generation, resolve: resolveRequest }); this.pump(); return promise;
  }

  private pump(): void {
    while (!this.destroyed && this.activeRequests < this.budgets.maxConcurrentRequests && this.queue.length) {
      const item = this.queue.shift()!; const pending = this.pending.get(item.manifest.contentId); if (!pending) continue; this.activeRequests += 1; this.metricsState = { ...this.metricsState, activeRequests: this.activeRequests, maxConcurrentRequests: Math.max(this.metricsState.maxConcurrentRequests, this.activeRequests) };
      void this.loader(item.manifest, pending.controller.signal).then((value) => {
        this.pending.delete(item.manifest.contentId); if (this.destroyed || item.generation !== this.generation || !this.selected.has(item.manifest.contentId)) { this.metricsState = { ...this.metricsState, staleResultCount: this.metricsState.staleResultCount + 1 }; item.resolve(undefined); return; }
        this.cache.set(item.manifest.contentId, { value, bytes: item.manifest.byteSize, lastUsed: ++this.clock, manifest: item.manifest }); this.metricsState = { ...this.metricsState, loadedBytes: [...this.cache.values()].reduce((sum, record) => sum + record.bytes, 0), loadedTileCount: this.cache.size }; this.evict(); item.resolve(value);
      }).catch((error: unknown) => { this.pending.delete(item.manifest.contentId); if (error instanceof DOMException && error.name === "AbortError") this.metricsState = { ...this.metricsState, cancelledRequestCount: this.metricsState.cancelledRequestCount + 1 }; else this.metricsState = { ...this.metricsState, failedTileCount: this.metricsState.failedTileCount + 1 }; item.resolve(undefined); }).finally(() => { this.activeRequests -= 1; this.metricsState = { ...this.metricsState, activeRequests: this.activeRequests }; this.pump(); });
    }
  }

  private evict(): void { while (this.cache.size > this.budgets.maxLoadedTiles || this.metricsState.loadedBytes > this.budgets.maxLoadedBytes) { const candidate = [...this.cache.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed || a[0].localeCompare(b[0]))[0]; if (!candidate) break; this.cache.delete(candidate[0]); this.metricsState = { ...this.metricsState, evictedTileCount: this.metricsState.evictedTileCount + 1, loadedTileCount: this.cache.size, loadedBytes: [...this.cache.values()].reduce((sum, record) => sum + record.bytes, 0) }; } }

  getLoaded(contentId: string): T | undefined { const record = this.cache.get(contentId); if (record) record.lastUsed = ++this.clock; return record?.value; }
  getLoadedContentIds(): string[] { return [...this.cache.keys()].sort(); }
  getLoadedValues(): T[] { return [...this.cache.entries()].sort((left, right) => left[0].localeCompare(right[0])).map(([, record]) => record.value); }
  getVisibleValues(): T[] { return [...this.selected].sort().map((contentId) => this.cache.get(contentId)?.value).filter((value): value is T => value !== undefined); }
  getMetrics(): TileStreamMetrics { return { ...this.metricsState, loadedTileCount: this.cache.size, loadedBytes: [...this.cache.values()].reduce((sum, record) => sum + record.bytes, 0), activeRequests: this.activeRequests }; }
  pendingCount(): number { return this.pending.size; }
  clear(): void { for (const pending of this.pending.values()) pending.controller.abort(); this.pending.clear(); this.queue.splice(0).forEach((item) => item.resolve(undefined)); this.cache.clear(); this.metricsState = { ...this.metricsState, loadedTileCount: 0, loadedBytes: 0 }; }
  destroy(): void { this.destroyed = true; this.clear(); }
}
