import { describe, expect, it } from "vitest";
import { runtimeFixtureFeatures } from "../domain/features.ts";
import type { Feature } from "../domain/schema.ts";
import { CITYWIDE_BUDGETS, CITYWIDE_RELEASE_ID, CitywideLruCache } from "../release/citywide-release.ts";
import { TRAVEL_CONTEXT_RELEASE_ID } from "../release/travel-context-release.ts";
import { AggregateRequestBudget, ComposedReleaseAdapter, ComposedReleaseCollisionError, ComposedReleaseMismatchError, ownerForFeatureId, validateComposedReleaseIdentity } from "./composed-release-runtime.ts";
import type { CitywideReleaseAdapter, CitywideRuntimeMetrics } from "./citywide-release-runtime.ts";
import type { TravelContextReleaseAdapter, TravelContextRuntimeMetrics } from "./travel-context-release-runtime.ts";

const building = runtimeFixtureFeatures.find((feature) => feature.kind === "building")!;
const civic = { ...building, id: "udt:manhattan:park:M001", name: "Synthetic Park", attributes: { ...building.attributes, civicReleaseId: TRAVEL_CONTEXT_RELEASE_ID, civicRecordKind: "park", civicLayerId: "parks", civicTypeLabel: "NYC Parks-managed property" } };
const base = { ...building, id: "doitt:fixture-building", attributes: { ...building.attributes, citywideReleaseId: CITYWIDE_RELEASE_ID } };

const baseMetrics: CitywideRuntimeMetrics = {
  visibleShardCount: 1, requestedShardCount: 1, loadedFeatureCount: 1, loadedBytes: 10, maxConcurrentRequests: 4, activeRequests: 0, failedRequestCount: 0, cancelledRequestCount: 0, staleResultCount: 0, retainedSummaryCount: 1, retainedFeatureCount: 1, retainedDetailCount: 0, detailIndexEntryCount: 57_633, cacheEntries: 1, cacheEvictions: 0,
};
const contextMetrics: TravelContextRuntimeMetrics = {
  visibleShardCount: 1, requestedShardCount: 1, loadedFeatureCount: 1, loadedBytes: 10, maxConcurrentRequests: 4, activeRequests: 0, failedRequestCount: 0, cancelledRequestCount: 0, staleResultCount: 0, retainedSummaryCount: 1, retainedFeatureCount: 1, retainedDetailCount: 0, detailIndexEntryCount: 1, cacheEntries: 1, cacheEvictions: 0, failedLayers: [],
};

function fakeBase(features: Feature[] = [base], refresh: (signal: AbortSignal) => Promise<Feature[]> = async () => features): CitywideReleaseAdapter {
  const byId = new Map(features.map((feature) => [feature.id, feature]));
  return {
    city: building as never,
    fixtureOnly: false,
    releaseId: CITYWIDE_RELEASE_ID,
    budgets: CITYWIDE_BUDGETS,
    manifest: {} as never,
    assetResolver: undefined,
    getLayerManifest: () => ({ schemaVersion: "1.0", id: "buildings", version: CITYWIDE_RELEASE_ID, label: "Buildings", fixtureOnly: false, featureKinds: ["building"], featureIds: [], tileLevel: 14, tileKeys: [], sourceRegistryEntryIds: [], acceptedCount: 0, generatedAt: "2026-08-04T00:00:00Z" }),
    getFeature: (id: string) => byId.get(id),
    getFeatures: () => features,
    search: () => features,
    searchAsync: async () => features,
    loadLayerFeatures: async () => features,
    refreshViewport: refresh,
    loadDetail: async (id: string) => byId.get(id),
    loadDetailsForFeature: async (feature: Feature) => byId.get(feature.id),
    getMetrics: () => baseMetrics,
    destroy: () => undefined,
  } as unknown as CitywideReleaseAdapter;
}

function fakeContext(features: Feature[] = [civic], refresh: (signal: AbortSignal) => Promise<Feature[]> = async () => features): TravelContextReleaseAdapter {
  const byId = new Map(features.map((feature) => [feature.id, feature]));
  return {
    city: building as never,
    fixtureOnly: false,
    releaseId: TRAVEL_CONTEXT_RELEASE_ID,
    manifest: { baseReleaseId: CITYWIDE_RELEASE_ID } as never,
    assetResolver: undefined,
    getLayerManifest: () => ({ schemaVersion: "1.0", id: "parks", version: TRAVEL_CONTEXT_RELEASE_ID, label: "Parks", fixtureOnly: false, featureKinds: ["park"], featureIds: [], tileLevel: 14, tileKeys: [], sourceRegistryEntryIds: [], acceptedCount: 0, generatedAt: "2026-08-04T00:00:00Z" }),
    getFeature: (id: string) => byId.get(id),
    getFeatures: () => features,
    search: () => features,
    searchAsync: async () => features,
    loadLayerFeatures: async () => features,
    refreshViewport: refresh,
    loadDetail: async (id: string) => byId.get(id),
    loadDetailsForFeature: async (feature: Feature) => byId.get(feature.id),
    getMetrics: () => contextMetrics,
    destroy: () => undefined,
  } as unknown as TravelContextReleaseAdapter;
}

describe("composed release runtime", () => {
  it("requires the civic manifest base pin to equal the loaded citywide release", () => {
    expect(validateComposedReleaseIdentity(CITYWIDE_RELEASE_ID, TRAVEL_CONTEXT_RELEASE_ID, CITYWIDE_RELEASE_ID).ok).toBe(true);
    expect(validateComposedReleaseIdentity(CITYWIDE_RELEASE_ID, TRAVEL_CONTEXT_RELEASE_ID, "citywide-other").ok).toBe(false);
    expect(() => new ComposedReleaseAdapter(fakeBase(), { ...fakeContext(), manifest: { baseReleaseId: "citywide-other" } } as never)).toThrow(ComposedReleaseMismatchError);
  });

  it("fails closed instead of overwriting a mixed feature ID collision", () => {
    const duplicate = { ...civic, id: base.id };
    const adapter = new ComposedReleaseAdapter(fakeBase(), fakeContext([duplicate]));
    expect(() => adapter.getFeatures()).toThrow(ComposedReleaseCollisionError);
  });

  it("routes cold details to one explicit owner and reports unknown IDs as unavailable", async () => {
    const calls: string[] = [];
    const baseAdapter = fakeBase();
    baseAdapter.loadDetail = async (id) => { calls.push(`base:${id}`); return id === base.id ? base : undefined; };
    const contextAdapter = fakeContext();
    contextAdapter.loadDetail = async (id) => { calls.push(`context:${id}`); return id === civic.id ? civic : undefined; };
    const adapter = new ComposedReleaseAdapter(baseAdapter, contextAdapter);
    expect(ownerForFeatureId(base.id, undefined, undefined)).toBe("base");
    expect(ownerForFeatureId(civic.id, undefined, undefined)).toBe("context");
    await expect(adapter.loadDetail(base.id)).resolves.toBe(base);
    await expect(adapter.loadDetail(civic.id)).resolves.toBe(civic);
    await expect(adapter.loadDetail("unknown-parent")).resolves.toBeUndefined();
    expect(calls).toEqual([`base:${base.id}`, `context:${civic.id}`, "base:unknown-parent", "context:unknown-parent"]);
  });

  it("shares one four-request aggregate permit with FIFO release and aborts queued work", async () => {
    const budget = new AggregateRequestBudget();
    const releases = await Promise.all(Array.from({ length: 4 }, () => budget.acquire()));
    expect(budget.activeCount()).toBe(4);
    const controller = new AbortController();
    const queued = budget.acquire(controller.signal);
    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    releases[0]!();
    expect(budget.activeCount()).toBe(3);
    releases.slice(1).forEach((release) => release());
    expect(budget.peakConcurrency()).toBe(4);
  });

  it("promotes only the current viewport generation and retains aggregate metrics", async () => {
    let resolveFirst: ((features: Feature[]) => void) | undefined;
    const first = new Promise<Feature[]>((resolve) => { resolveFirst = resolve; });
    const baseAdapter = fakeBase([base], async (signal) => {
      if (signal.aborted) return [];
      return first;
    });
    const contextAdapter = fakeContext([civic]);
    // The caps asserted below are now read from this cache rather than from
    // the shared constant, so the fixture has to declare the real byte cap.
    const cache = new CitywideLruCache<unknown>(24, 48 * 1024 * 1024);
    cache.set("base:one", {}, 8);
    const budget = new AggregateRequestBudget();
    const adapter = new ComposedReleaseAdapter(baseAdapter, contextAdapter, { sharedBudget: budget, sharedCache: cache });
    const firstRefresh = adapter.refreshViewport({ longitude: -74, latitude: 40.7, height: 700, heading: 0, pitch: -35, roll: 0 });
    const secondRefresh = adapter.refreshViewport({ longitude: -73.99, latitude: 40.74, height: 700, heading: 0, pitch: -35, roll: 0 });
    resolveFirst?.([base]);
    await expect(firstRefresh).rejects.toMatchObject({ name: "AbortError" });
    await expect(secondRefresh).resolves.toEqual([base, civic]);
    const metrics = adapter.getMetrics();
    expect(metrics.aggregate.cacheEntries).toBe(1);
    expect(metrics.aggregate.cachedBytes).toBe(8);
    expect(metrics.aggregate.cacheEvictions).toBe(0);
    expect(metrics.aggregate.maxCacheEntries).toBe(24);
    expect(metrics.aggregate.maxCachedBytes).toBe(48 * 1024 * 1024);
    expect(metrics.aggregate.maxConcurrentRequests).toBe(4);
    expect(metrics.aggregate.activeRequests).toBe(0);
  });

  it("forwards one shared footprint unchanged and avoids duplicate child refreshes", async () => {
    let baseCalls = 0;
    let contextCalls = 0;
    const baseAdapter = fakeBase();
    const contextAdapter = fakeContext();
    const request = {
      camera: { longitude: -73.7, latitude: 40.95, height: 8_000, heading: 20, pitch: -50, roll: 0 },
      footprint: {
        bounds: { west: -74.02, east: -73.98, south: 40.7, north: 40.75 },
        groundCenter: { longitude: -74, latitude: 40.725 },
        valid: true,
        source: "ground-rays" as const,
        signature: "composed-ground-footprint",
      },
    };
    baseAdapter.refreshViewport = async (input) => {
      baseCalls += 1;
      expect(input).toEqual(request);
      return [base];
    };
    contextAdapter.refreshViewport = async (input) => {
      contextCalls += 1;
      expect(input).toEqual(request);
      return [civic];
    };
    const adapter = new ComposedReleaseAdapter(baseAdapter, contextAdapter);
    const first = adapter.refreshViewport(request);
    expect(adapter.refreshViewport(request)).toBe(first);
    await expect(first).resolves.toEqual([base, civic]);
    await expect(adapter.refreshViewport(request)).resolves.toEqual([base, civic]);
    expect(baseCalls).toBe(1);
    expect(contextCalls).toBe(1);
  });

  it("does not destroy borrowed children and can recreate after StrictMode-style cleanup", async () => {
    let baseDestroyed = 0;
    let contextDestroyed = 0;
    const baseAdapter = fakeBase();
    const contextAdapter = fakeContext();
    baseAdapter.destroy = () => { baseDestroyed += 1; };
    contextAdapter.destroy = () => { contextDestroyed += 1; };

    const firstComposition = new ComposedReleaseAdapter(baseAdapter, contextAdapter);
    firstComposition.destroy();
    expect(baseDestroyed).toBe(0);
    expect(contextDestroyed).toBe(0);

    const recreatedComposition = new ComposedReleaseAdapter(baseAdapter, contextAdapter);
    await expect(recreatedComposition.refreshViewport({ longitude: -74, latitude: 40.7, height: 700, heading: 0, pitch: -35, roll: 0 })).resolves.toHaveLength(2);
    expect(baseDestroyed).toBe(0);
    expect(contextDestroyed).toBe(0);
    recreatedComposition.destroy();
  });

  it("reports evictions from the shared aggregate cache", () => {
    const cache = new CitywideLruCache<unknown>(24, 1_000_000);
    for (let index = 0; index < 25; index += 1) cache.set(`shard:${index}`, {}, 8);
    const adapter = new ComposedReleaseAdapter(fakeBase(), fakeContext(), { sharedCache: cache });
    expect(adapter.getMetrics().aggregate.cacheEntries).toBe(24);
    expect(adapter.getMetrics().aggregate.cacheEvictions).toBe(1);
  });
});
