import type { Feature } from "../domain/schema.ts";
import { travelContextPickPriority, type TravelContextRecordKind } from "../domain/schema.ts";
import {
  CITYWIDE_BUDGETS,
  CITYWIDE_RELEASE_ID,
} from "../release/citywide-release.ts";
import type { CitywideLruCache, CitywideSharedRequestBudget } from "../release/citywide-release.ts";
import { TRAVEL_CONTEXT_BUDGETS, TRAVEL_CONTEXT_RELEASE_ID } from "../release/travel-context-release.ts";
import { DEFAULT_LAYER_VISIBILITY, type LayerManifest, type LayerVisibility, type RuntimeLayerId } from "./layers.ts";
import type { RuntimeCityAdapter } from "./fixture-adapter.ts";
import type { CitywideReleaseAdapter, CitywideRuntimeMetrics } from "./citywide-release-runtime.ts";
import type { TravelContextReleaseAdapter, TravelContextRuntimeMetrics } from "./travel-context-release-runtime.ts";
import { normalizeViewportRefreshRequest, type ViewportRefreshInput } from "./viewport-footprint.ts";

export type ComposedReleaseOrigin = "base" | "context";

export interface ComposedReleaseIdentity {
  contextReleaseId: string;
  baseReleaseId: string;
}

export interface ComposedFeatureGroups {
  base: Feature[];
  context: Feature[];
}

export interface AggregateRuntimeMetrics {
  cacheEntries: number;
  cachedBytes: number;
  cacheEvictions: number;
  maxCacheEntries: number;
  maxCachedBytes: number;
  activeRequests: number;
  maxConcurrentRequests: number;
  peakConcurrentRequests: number;
  requestedShardCount: number;
  loadedShardCount: number;
  failedRequestCount: number;
  cancelledRequestCount: number;
  staleResultCount: number;
}

export interface ComposedReleaseMetrics {
  base: CitywideRuntimeMetrics;
  context: TravelContextRuntimeMetrics;
  aggregate: AggregateRuntimeMetrics;
  failedRoles: ComposedReleaseOrigin[];
  render: {
    baseFeatureCount: number;
    contextFeatureCount: number;
    baseLimit: number;
    contextLimit: number;
  };
}

export class ComposedReleaseCollisionError extends Error {
  readonly featureId: string;

  constructor(featureId: string) {
    super(`Composed release identity collision for ${featureId}; no owner was selected.`);
    this.name = "ComposedReleaseCollisionError";
    this.featureId = featureId;
  }
}

export class ComposedReleaseMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComposedReleaseMismatchError";
  }
}

export interface ComposedReleaseValidation {
  ok: boolean;
  reason?: string;
  identity?: ComposedReleaseIdentity;
}

export function validateComposedReleaseIdentity(
  baseReleaseId: string,
  contextReleaseId: string,
  declaredBaseReleaseId: string,
): ComposedReleaseValidation {
  if (contextReleaseId !== TRAVEL_CONTEXT_RELEASE_ID) return { ok: false, reason: `Unsupported civic context release ${contextReleaseId}.` };
  if (baseReleaseId !== CITYWIDE_RELEASE_ID) return { ok: false, reason: `Unsupported citywide base release ${baseReleaseId}.` };
  if (declaredBaseReleaseId !== baseReleaseId) return { ok: false, reason: `Civic baseReleaseId ${declaredBaseReleaseId} does not match loaded citywide release ${baseReleaseId}.` };
  return { ok: true, identity: { contextReleaseId, baseReleaseId } };
}

/**
 * One deterministic semaphore shared by the two child request pools.  The
 * child pools still retain their standalone four-request defaults, but every
 * actual loader must acquire this permit before touching the local payload.
 */
export class AggregateRequestBudget implements CitywideSharedRequestBudget {
  readonly maxConcurrent = CITYWIDE_BUDGETS.maxConcurrentRequests;
  private active = 0;
  private peak = 0;
  private sequence = 0;
  private readonly waiters: Array<{ sequence: number; signal?: AbortSignal; resolve: (release: () => void) => void; reject: (error: unknown) => void; abort?: () => void }> = [];

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new DOMException("Shared request was aborted.", "AbortError"));
    if (this.active < this.maxConcurrent) return Promise.resolve(this.reserve());
    return new Promise<() => void>((resolve, reject) => {
      const waiter: { sequence: number; signal?: AbortSignal; resolve: (release: () => void) => void; reject: (error: unknown) => void; abort?: () => void } = { sequence: ++this.sequence, signal, resolve, reject };
      this.waiters.push(waiter);
      const abort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new DOMException("Shared request was aborted.", "AbortError"));
      };
      if (signal) signal.addEventListener("abort", abort, { once: true });
      waiter.abort = abort;
    });
  }

  activeCount(): number { return this.active; }

  peakConcurrency(): number { return this.peak; }

  private reserve(): () => void {
    this.active += 1;
    this.peak = Math.max(this.peak, this.active);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active = Math.max(0, this.active - 1);
      this.drain();
    };
  }

  private drain(): void {
    while (this.active < this.maxConcurrent && this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      if (waiter.signal?.aborted) {
        waiter.reject(new DOMException("Shared request was aborted.", "AbortError"));
        continue;
      }
      if (waiter.signal && waiter.abort) waiter.signal.removeEventListener("abort", waiter.abort);
      waiter.resolve(this.reserve());
    }
  }
}

export function featureOrigin(feature: Pick<Feature, "id" | "attributes">): ComposedReleaseOrigin | null {
  if (feature.attributes.citywideReleaseId === CITYWIDE_RELEASE_ID || /^(?:doitt:|dohmh:)/iu.test(feature.id)) return "base";
  if (feature.attributes.civicReleaseId === TRAVEL_CONTEXT_RELEASE_ID || /^udt:manhattan:(?:nta|park|lpc):/iu.test(feature.id)) return "context";
  return null;
}

export function ownerForFeatureId(
  featureId: string,
  baseFeature: Feature | undefined,
  contextFeature: Feature | undefined,
): ComposedReleaseOrigin | "missing" | "collision" {
  if (baseFeature && contextFeature) return "collision";
  if (baseFeature) return "base";
  if (contextFeature) return "context";
  if (/^(?:doitt:|dohmh:)/iu.test(featureId)) return "base";
  if (/^udt:manhattan:(?:nta|park|lpc):/iu.test(featureId)) return "context";
  return "missing";
}

function mergeFeatureGroups(base: readonly Feature[], context: readonly Feature[]): ComposedFeatureGroups {
  const seen = new Set<string>();
  for (const feature of base) seen.add(feature.id);
  for (const feature of context) {
    if (seen.has(feature.id)) throw new ComposedReleaseCollisionError(feature.id);
    seen.add(feature.id);
  }
  return {
    base: [...base].sort((left, right) => left.id.localeCompare(right.id)),
    context: [...context].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function visibleFor(adapter: RuntimeCityAdapter, visibility: LayerVisibility): readonly Feature[] {
  return adapter.getFeatures(visibility === undefined || Object.keys(visibility).length === 0 ? DEFAULT_LAYER_VISIBILITY : visibility);
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function composedAbortError(message: string): DOMException {
  return new DOMException(message, "AbortError");
}

export interface ComposedReleaseRuntimeOptions {
  sharedBudget?: AggregateRequestBudget | null;
  sharedCache?: CitywideLruCache<unknown> | null;
}

/**
 * Runtime-only pair of the immutable citywide base and civic context.  It
 * deliberately does not emit or mutate a manifest; the civic manifest remains
 * the canonical URL/root and supplies the transitive base pin.
 */
export class ComposedReleaseAdapter implements RuntimeCityAdapter {
  readonly city: CitywideReleaseAdapter["city"];
  readonly fixtureOnly = false;
  readonly releaseId: string;
  readonly contextReleaseId: string;
  readonly baseReleaseId: string;
  readonly identity: ComposedReleaseIdentity;
  readonly assetResolver = undefined;
  private readonly base: CitywideReleaseAdapter;
  private readonly context: TravelContextReleaseAdapter;
  private readonly sharedBudget: AggregateRequestBudget | null;
  private readonly sharedCache: CitywideLruCache<unknown> | null;
  private baseFeatures: Feature[] = [];
  private contextFeatures: Feature[] = [];
  private viewportAbortController: AbortController | null = null;
  private activeViewportSignature: string | null = null;
  private activeViewportPromise: Promise<Feature[]> | null = null;
  private committedViewportSignature: string | null = null;
  private searchAbortController: AbortController | null = null;
  private generation = 0;
  private searchGeneration = 0;
  private staleResultCount = 0;
  private failedRoles = new Set<ComposedReleaseOrigin>();
  private destroyed = false;

  constructor(base: CitywideReleaseAdapter, context: TravelContextReleaseAdapter, options: ComposedReleaseRuntimeOptions = {}) {
    const validation = validateComposedReleaseIdentity(base.releaseId, context.releaseId, context.manifest.baseReleaseId);
    if (!validation.ok || !validation.identity) throw new ComposedReleaseMismatchError(validation.reason ?? "Immutable release composition identity is invalid.");
    this.base = base;
    this.context = context;
    this.city = base.city;
    this.identity = validation.identity;
    this.releaseId = context.releaseId;
    this.contextReleaseId = context.releaseId;
    this.baseReleaseId = base.releaseId;
    this.sharedBudget = options.sharedBudget ?? null;
    this.sharedCache = options.sharedCache ?? null;
  }

  getLayerManifest(layer: RuntimeLayerId): LayerManifest {
    if (layer === "buildings" || layer === "pois") return this.base.getLayerManifest(layer);
    if (layer === "statistical-areas" || layer === "parks" || layer === "landmarks") return this.context.getLayerManifest(layer);
    return this.base.getLayerManifest(layer);
  }

  /**
   * Civic-context mode composes over the citywide base, and exterior cells are
   * base building identities, so membership must resolve against the base
   * release rather than whatever the camera has streamed. Forwarding these
   * keeps civic-context on deterministic release membership instead of silently
   * falling back to the residency oracle and failing base-incompatible.
   */
  async ensureIdentityIndex(signal?: AbortSignal): Promise<number> {
    return this.base.ensureIdentityIndex(signal);
  }

  hasIdentityMember(featureId: string): boolean {
    return this.base.hasIdentityMember(featureId) || this.getFeature(featureId) !== undefined;
  }

  getFeature(featureId: string): Feature | undefined {
    const baseFeature = this.base.getFeature(featureId);
    const contextFeature = this.context.getFeature(featureId);
    const owner = ownerForFeatureId(featureId, baseFeature, contextFeature);
    if (owner === "collision") throw new ComposedReleaseCollisionError(featureId);
    return owner === "base" ? baseFeature : owner === "context" ? contextFeature : undefined;
  }

  getFeatures(visibility: LayerVisibility = {}): Feature[] {
    const groups = mergeFeatureGroups(visibleFor(this.base, visibility), visibleFor(this.context, visibility));
    return [...groups.base, ...groups.context];
  }

  // Copy before sorting: an adapter is entitled to return a retained array
  // (the citywide runtime memoizes its visible sequence so unchanged shards
  // stay reference-identical), and composition must not sort in place.
  getBaseFeatures(visibility: LayerVisibility = {}): Feature[] {
    return [...visibleFor(this.base, visibility)].sort((left, right) => left.id.localeCompare(right.id));
  }

  getContextFeatures(visibility: LayerVisibility = {}): Feature[] {
    return [...visibleFor(this.context, visibility)].sort((left, right) => left.id.localeCompare(right.id));
  }

  getVisibleFeatureGroups(): ComposedFeatureGroups {
    return mergeFeatureGroups(this.baseFeatures, this.contextFeatures);
  }

  search(query: string, civicFacets: readonly string[] = []): Feature[] {
    const base = this.base.search(query);
    const context = this.context.search(query).filter((feature) => civicFacets.length === 0 || civicFacets.includes(String(feature.attributes.civicRecordKind)));
    const groups = mergeFeatureGroups(base, context);
    return [...groups.base, ...groups.context];
  }

  async searchAsync(query: string, signal?: AbortSignal, civicFacets: readonly string[] = []): Promise<Feature[]> {
    if (!query.trim()) return [];
    this.searchAbortController?.abort();
    const controller = new AbortController();
    this.searchAbortController = controller;
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    const generation = ++this.searchGeneration;
    try {
      const [baseResult, contextResult] = await Promise.allSettled([
        this.base.searchAsync(query, controller.signal),
        this.context.searchAsync(query, controller.signal),
      ]);
      if (controller.signal.aborted || generation !== this.searchGeneration || this.destroyed) throw composedAbortError("Composed search was aborted.");
      const base = baseResult.status === "fulfilled" ? baseResult.value : [];
      const context = contextResult.status === "fulfilled" ? contextResult.value.filter((feature) => civicFacets.length === 0 || civicFacets.includes(String(feature.attributes.civicRecordKind))) : [];
      if (baseResult.status === "rejected" && !isAbort(baseResult.reason)) this.failedRoles.add("base");
      else if (baseResult.status === "fulfilled") this.failedRoles.delete("base");
      if (contextResult.status === "rejected" && !isAbort(contextResult.reason)) this.failedRoles.add("context");
      else if (contextResult.status === "fulfilled") this.failedRoles.delete("context");
      const groups = mergeFeatureGroups(base, context);
      return [...groups.base, ...groups.context];
    } finally {
      signal?.removeEventListener("abort", abort);
      if (this.searchAbortController === controller) this.searchAbortController = null;
    }
  }

  async loadLayerFeatures(layer: RuntimeLayerId): Promise<Feature[]> {
    if (layer === "buildings" || layer === "pois") return this.base.loadLayerFeatures(layer);
    if (layer === "statistical-areas" || layer === "parks" || layer === "landmarks") return this.context.loadLayerFeatures(layer);
    return [];
  }

  refreshViewport(input: ViewportRefreshInput, signal?: AbortSignal): Promise<Feature[]> {
    if (this.destroyed) throw composedAbortError("Composed viewport refresh was aborted.");
    const request = normalizeViewportRefreshRequest(input);
    const signature = request.footprint.signature;
    if (signature === this.activeViewportSignature && this.activeViewportPromise) return this.activeViewportPromise;
    if (signature === this.committedViewportSignature) {
      const groups = mergeFeatureGroups(this.baseFeatures, this.contextFeatures);
      return Promise.resolve([...groups.base, ...groups.context]);
    }
    this.viewportAbortController?.abort();
    const controller = new AbortController();
    this.viewportAbortController = controller;
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    const generation = ++this.generation;
    const run = async (): Promise<Feature[]> => {
      try {
        const [baseResult, contextResult] = await Promise.allSettled([
          this.base.refreshViewport(request, controller.signal),
          this.context.refreshViewport(request, controller.signal),
        ]);
        if (controller.signal.aborted || generation !== this.generation || this.destroyed) {
          this.staleResultCount += 1;
          throw composedAbortError("Composed viewport refresh was aborted.");
        }
        if (baseResult.status === "fulfilled") {
          this.baseFeatures = baseResult.value;
          this.failedRoles.delete("base");
        } else if (!isAbort(baseResult.reason)) {
          this.failedRoles.add("base");
        }
        if (contextResult.status === "fulfilled") {
          this.contextFeatures = contextResult.value;
          this.failedRoles.delete("context");
        } else if (!isAbort(contextResult.reason)) {
          this.failedRoles.add("context");
        }
        const groups = mergeFeatureGroups(this.baseFeatures, this.contextFeatures);
        this.committedViewportSignature = signature;
        return [...groups.base, ...groups.context];
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

  async loadDetailsForFeature(feature: Feature, signal?: AbortSignal): Promise<Feature | undefined> {
    return this.loadDetail(feature.id, signal, featureOrigin(feature));
  }

  async loadDetail(featureId: string, signal?: AbortSignal, explicitOrigin?: ComposedReleaseOrigin | null): Promise<Feature | undefined> {
    const baseFeature = this.base.getFeature(featureId);
    const contextFeature = this.context.getFeature(featureId);
    const discovered = ownerForFeatureId(featureId, baseFeature, contextFeature);
    if (discovered === "collision") throw new ComposedReleaseCollisionError(featureId);
    const owner = explicitOrigin ?? (discovered === "missing" ? null : discovered);
    if (owner === "base") return this.base.loadDetail(featureId, signal);
    if (owner === "context") return this.context.loadDetail(featureId, signal);
    if (owner === "missing") return undefined;
    const [baseResult, contextResult] = await Promise.allSettled([
      this.base.loadDetail(featureId, signal),
      this.context.loadDetail(featureId, signal),
    ]);
    const matches = [baseResult, contextResult].filter((result): result is PromiseFulfilledResult<Feature | undefined> => result.status === "fulfilled" && Boolean(result.value)).map((result) => result.value!);
    if (matches.length > 1) throw new ComposedReleaseCollisionError(featureId);
    if (matches.length === 1) return matches[0];
    const failure = [baseResult, contextResult].find((result) => result.status === "rejected" && !isAbort(result.reason));
    if (failure?.status === "rejected") throw failure.reason;
    return undefined;
  }

  getMetrics(): ComposedReleaseMetrics {
    const base = this.base.getMetrics();
    const context = this.context.getMetrics();
    const sharedCache = this.sharedCache ? { entries: this.sharedCache.size(), bytes: this.sharedCache.bytes() } : undefined;
    const separateCache = !sharedCache;
    const aggregate: AggregateRuntimeMetrics = {
      cacheEntries: sharedCache?.entries ?? base.cacheEntries + context.cacheEntries,
      cachedBytes: sharedCache?.bytes ?? base.loadedBytes + context.loadedBytes,
      cacheEvictions: this.sharedCache?.evictionCount() ?? base.cacheEvictions + context.cacheEvictions,
      // Report the cache the session actually has. A shared cache constructed
      // from a resolved overview budget record has caps the shared constant
      // does not describe, and a metric that contradicts the live cache is not
      // evidence.
      maxCacheEntries: this.sharedCache?.maxEntries ?? CITYWIDE_BUDGETS.maxLoadedShards,
      maxCachedBytes: this.sharedCache?.maxBytes ?? CITYWIDE_BUDGETS.maxLoadedBytes,
      activeRequests: this.sharedBudget?.activeCount() ?? Math.max(base.activeRequests, context.activeRequests),
      maxConcurrentRequests: this.sharedBudget?.maxConcurrent ?? CITYWIDE_BUDGETS.maxConcurrentRequests,
      peakConcurrentRequests: this.sharedBudget?.peakConcurrency() ?? Math.max(base.maxConcurrentRequests, context.maxConcurrentRequests),
      requestedShardCount: base.requestedShardCount + context.requestedShardCount,
      loadedShardCount: separateCache ? base.cacheEntries + context.cacheEntries : sharedCache?.entries ?? 0,
      failedRequestCount: base.failedRequestCount + context.failedRequestCount,
      cancelledRequestCount: base.cancelledRequestCount + context.cancelledRequestCount,
      staleResultCount: base.staleResultCount + context.staleResultCount + this.staleResultCount,
    };
    return {
      base,
      context,
      aggregate,
      failedRoles: [...this.failedRoles].sort(),
      render: { baseFeatureCount: this.baseFeatures.length, contextFeatureCount: this.contextFeatures.length, baseLimit: this.base.budgets.maxRenderedDenseFeatures, contextLimit: TRAVEL_CONTEXT_BUDGETS.maxAreaRenderParts },
    };
  }

  destroy(): void {
    this.destroyed = true;
    this.viewportAbortController?.abort();
    this.searchAbortController?.abort();
    this.viewportAbortController = null;
    this.searchAbortController = null;
    // Child adapters are borrowed from App-owned state. StrictMode can tear
    // down and recreate this composition without recreating those children;
    // only abort work owned by this composition instance here.
  }
}

export function contextOverlapPriority(kind: TravelContextRecordKind): number {
  return travelContextPickPriority(kind);
}
