import { describe, expect, it } from "vitest";
import {
  buildSyntheticCitywideRelease,
  CITYWIDE_BUDGETS,
  CITYWIDE_OVERVIEW_BUDGETS,
  CITYWIDE_NO_CACHE_FLOORS,
  CITYWIDE_OVERVIEW_CACHE_FLOORS,
  citywideCacheClass,
  CitywideLruCache,
  CitywideRequestPool,
  citywideExactIdBucket,
  citywidePrefixForToken,
  citywideQueryTokens,
  isCitywideExactIdentifier,
  isCitywideExactParentIdentifier,
  normalizeCitywideQuery,
  selectCitywideSearchPrefixes,
  selectViewportShards,
  resolveCitywideBudgets,
  stableCitywidePickId,
  validateCitywideReleaseManifest,
} from "./citywide-release";
import { parseTileKey, tileBounds, tileKeyForCoordinate, tileKeyString } from "../runtime/spatial";

describe("citywide release contract", () => {
  it("builds a deterministic seven-anchor synthetic scale release", () => {
    const first = buildSyntheticCitywideRelease();
    const second = buildSyntheticCitywideRelease();
    expect(JSON.stringify(first.manifest)).toBe(JSON.stringify(second.manifest));
    expect([...first.bytes.entries()]).toEqual([...second.bytes.entries()]);
    expect(validateCitywideReleaseManifest(first.manifest).ok).toBe(true);
    expect(first.manifest.fixtureOnly).toBe(true);
    expect(first.manifest.coverage.anchors).toHaveLength(7);
    expect(first.manifest.geometryShards).toHaveLength(14);
    expect(first.manifest.searchShards).toHaveLength(4);
    expect(first.manifest.detailShards).toHaveLength(14);
    expect(first.manifest.geometryShards.every((shard) => shard.featureCount <= 2_000 && shard.byteSize <= 2 * 1024 * 1024)).toBe(true);
  });

  it("rejects unsafe refs, invalid checksums, oversized declarations, and nonzero accounting", () => {
    const fixture = buildSyntheticCitywideRelease();
    const unsafe = { ...fixture.manifest, geometryShards: fixture.manifest.geometryShards.map((shard, index) => index === 0 ? { ...shard, relativeContentRef: "../escape.json" } : shard) };
    expect(validateCitywideReleaseManifest(unsafe).ok).toBe(false);
    const badChecksum = { ...fixture.manifest, searchShards: fixture.manifest.searchShards.map((shard, index) => index === 0 ? { ...shard, checksumSha256: "bad" } : shard) };
    expect(validateCitywideReleaseManifest(badChecksum).ok).toBe(false);
    const tooLarge = { ...fixture.manifest, totalDeclaredBytes: 301 * 1024 * 1024 };
    expect(validateCitywideReleaseManifest(tooLarge).ok).toBe(false);
    const remainder = { ...fixture.manifest, coverage: { ...fixture.manifest.coverage, accountingRemainderCount: 1 } };
    expect(validateCitywideReleaseManifest(remainder).ok).toBe(false);
    const external = { ...fixture.manifest, detailShards: fixture.manifest.detailShards.map((shard, index) => index === 0 ? { ...shard, relativeContentRef: "https://example.invalid/detail.json" } : shard) };
    expect(validateCitywideReleaseManifest(external).ok).toBe(false);
  });

  it("selects viewport-intersecting tiles and only a bounded prefetch ring", () => {
    const fixture = buildSyntheticCitywideRelease();
    const anchor = fixture.manifest.coverage.anchors[0]!;
    const tile = tileKeyForCoordinate(anchor.longitude, anchor.latitude, 14);
    const viewport = tileBounds(tile);
    const visible = selectViewportShards(fixture.manifest.geometryShards, viewport, 0);
    const firstVisible = visible[0]!;
    const parsed = parseTileKey(firstVisible.tileKey);
    const adjacent = { ...firstVisible, shardId: firstVisible.shardId + ":adjacent", tileKey: tileKeyString({ ...parsed, x: parsed.x + 1 }), bounds: tileBounds({ ...parsed, x: parsed.x + 1 }) };
    const prefetched = selectViewportShards([...fixture.manifest.geometryShards, adjacent], viewport, 1);
    expect(visible.length).toBeGreaterThan(0);
    expect(prefetched.length).toBeGreaterThanOrEqual(visible.length);
    expect(prefetched.some((shard) => !visible.some((candidate) => candidate.shardId === shard.shardId))).toBe(true);
    expect(() => selectViewportShards(fixture.manifest.geometryShards, viewport, 2)).toThrow(/prefetch ring/);
    expect(tileKeyString(tile)).toBe(anchor.tileKeys[0]);
  });

  it("normalizes searchable text and derives stable IDs", () => {
    expect(normalizeCitywideQuery("Café — North")).toBe("cafe north");
    expect(citywideQueryTokens("The Café, Café North")).toEqual(["cafe", "north", "the"]);
    expect(citywideExactIdBucket("DOITT:ABC")).toBe(citywideExactIdBucket("doitt:abc"));
    expect(isCitywideExactParentIdentifier("doitt:123")).toBe(true);
    expect(isCitywideExactParentIdentifier("dohmh:camis:123")).toBe(true);
    expect(isCitywideExactParentIdentifier("udt:123")).toBe(false);
    expect(isCitywideExactParentIdentifier("12345678")).toBe(false);
    expect(isCitywideExactIdentifier("12345678")).toBe(true);
    expect(isCitywideExactIdentifier("123456")).toBe(false);
    expect(citywidePrefixForToken("DONUT")).toBe("do");
    expect(stableCitywidePickId("nyc:restaurant:123")).toBe("citywide-parent:nyc:restaurant:123");
  });

  it("routes AND search through the smallest complete token prefix", () => {
    const shards = [
      { prefix: "1", summaryCount: 57_468, byteSize: 12_524_183 },
      { prefix: "2", summaryCount: 11_293, byteSize: 2_455_421 },
      { prefix: "a", summaryCount: 7_215, byteSize: 1_515_640 },
      { prefix: "i", summaryCount: 1_536, byteSize: 321_815 },
    ];
    expect(selectCitywideSearchPrefixes(shards, "1500 ave")).toEqual(["a"]);
    expect(selectCitywideSearchPrefixes(shards, "1500 2n")).toEqual(["2"]);
    expect(selectCitywideSearchPrefixes(shards, "zzzzzzzz no match")).toEqual([]);
    expect(selectCitywideSearchPrefixes(shards, "doitt:123")).toEqual([citywideExactIdBucket("doitt:123")]);
  });

  it("evicts least-recently-used entries within entry and byte budgets", () => {
    const cache = new CitywideLruCache<string>(2, 5);
    cache.set("a", "A", 3);
    cache.set("b", "B", 2);
    expect(cache.get("a")).toBe("A");
    cache.set("c", "C", 2);
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.evictionCount()).toBe(1);
    expect(cache.bytes()).toBe(5);
  });

  /**
   * The byte counter is now INCREMENTAL, and this is what keeps it honest.
   *
   * `bytes()` used to be a full reduce over every entry, and `evict()` called it
   * inside its own `while` condition, so one saturating `set()` that had to drop
   * k entries walked the whole map k times. That was tolerable while eviction
   * was a rare backstop; T003 makes scheduler-driven residency routine and
   * eviction ordinary, so the counter is maintained by the mutators instead.
   *
   * A maintained counter can drift from the thing it counts, which is the whole
   * risk of the change, so this re-derives the truth by full reduce over the
   * live keys after a mixed workload — overwrites, deletes, re-inserts and
   * capacity evictions — rather than trusting that the three mutators agree.
   */
  it("keeps its incremental byte total equal to a full reduce over the live entries", () => {
    const cache = new CitywideLruCache<number>(6, 1_000);
    const live = new Map<string, number>();
    const put = (key: string, bytes: number) => { cache.set(key, bytes, bytes); live.set(key, bytes); };
    const drop = (key: string) => { cache.delete(key); live.delete(key); };
    const reduceLive = () => [...cache.keys()].reduce((sum, key) => sum + (live.get(key) ?? Number.NaN), 0);

    for (const [key, bytes] of [["a", 10], ["b", 20], ["c", 30], ["d", 40]] as const) put(key, bytes);
    expect(cache.bytes()).toBe(reduceLive());
    // An overwrite must subtract the old size before adding the new one.
    put("b", 200);
    expect(cache.bytes()).toBe(reduceLive());
    expect(cache.bytes()).toBe(10 + 200 + 30 + 40);
    // A delete of a live key subtracts; a delete of an absent key must not.
    drop("c");
    expect(cache.delete("not-here")).toBe(false);
    expect(cache.bytes()).toBe(reduceLive());
    // Capacity eviction: five more entries against a six-entry cap.
    for (const [key, bytes] of [["e", 5], ["f", 6], ["g", 7], ["h", 8], ["i", 9]] as const) put(key, bytes);
    expect(cache.size()).toBe(6);
    expect(cache.bytes()).toBe(reduceLive());
    // And a byte-capped eviction, which is the loop the counter made cheap.
    put("big", 900);
    expect(cache.bytes()).toBeLessThanOrEqual(1_000);
    expect(cache.bytes()).toBe(reduceLive());
    cache.clear();
    expect(cache.bytes()).toBe(0);
  });

  /**
   * The desync warning, as an executable statement rather than only a comment.
   *
   * `set()` throws for an entry larger than `maxBytes`; callers precheck the
   * same condition before fetching (`ExteriorCellRuntime.loadVerifiedArtifact`
   * fails closed with `artifact-exceeds-cache-budget`). The two agree ONLY
   * because both read the same `maxBytes`. A future per-class reservation that
   * gave one class a smaller effective ceiling would break that: the precheck
   * would pass and `set()` would throw from inside a settled request promise,
   * surfacing as an unrelated failure code. Any per-class ceiling must be
   * readable by the precheck, not merely enforced at `set()`.
   */
  it("throws rather than silently refusing an entry larger than its byte cap", () => {
    const cache = new CitywideLruCache<string>(4, 100);
    expect(() => cache.set("too-big", "X", 101)).toThrow(/entry bytes are invalid/u);
    expect(cache.bytes()).toBe(0);
    expect(cache.has("too-big")).toBe(false);
    // The precheck's own view of the ceiling, which is the value that has to
    // stay reachable by any future per-class reservation.
    expect(cache.maxBytes).toBe(100);
  });

  it("bounds request concurrency, deduplicates keys, and cancels stale queued work", async () => {
    const cache = new CitywideLruCache<string>(8, 100);
    const pool = new CitywideRequestPool<string>(2, cache);
    let active = 0;
    let peak = 0;
    const loaders = new Map<string, (signal: AbortSignal) => Promise<{ value: string; bytes: number }>>();
    for (const key of ["a", "b", "c", "d"]) {
      loaders.set(key, (signal) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => { active -= 1; resolve({ value: key.toUpperCase(), bytes: 1 }); }, 5);
        active += 1;
        peak = Math.max(peak, active);
        signal.addEventListener("abort", () => { clearTimeout(timer); active -= 1; reject(new DOMException("aborted", "AbortError")); }, { once: true });
      }));
    }
    const load = (key: string) => pool.load({ key, loader: loaders.get(key)! });
    const duplicate = load("a");
    const first = await Promise.all([duplicate, load("a"), load("b"), load("c"), load("d")]);
    expect(first[0]).toBe("A");
    expect(first[1]).toBe("A");
    expect(first).toEqual(["A", "A", "B", "C", "D"]);
    expect(peak).toBeLessThanOrEqual(2);
    expect(pool.peakConcurrency()).toBeLessThanOrEqual(2);
    expect(pool.pendingCount()).toBe(0);
    expect(pool.activeCount()).toBe(0);
    expect(pool.cacheMetrics().entries).toBe(4);
    const stale = pool.load({ key: "stale", loader: (signal) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }) });
    pool.abortExcept([]);
    await expect(stale).resolves.toBeUndefined();
    expect(pool.pendingCount()).toBe(0);
  });
});

describe("citywide budget records and per-class cache floors", () => {
  /**
   * The shared constant is read by the build script, the release validator,
   * the civic and composed runtimes, and the default `CitywideLruCache`
   * arguments. Nothing in T004 may move it, so its values are pinned here —
   * there was no such pin before, which is exactly why raising a field on it
   * looked cheap.
   */
  it("pins the shared citywide budget constant", () => {
    expect(CITYWIDE_BUDGETS).toEqual({
      rootBytes: 256 * 1024,
      geometryShardBytes: 2 * 1024 * 1024,
      searchDetailShardBytes: 1024 * 1024,
      totalBytes: 300 * 1024 * 1024,
      maxShards: 512,
      maxFeaturesPerGeometryShard: 2_000,
      maxLoadedShards: 24,
      maxLoadedBytes: 48 * 1024 * 1024,
      maxConcurrentRequests: 4,
      maxRenderedDenseFeatures: 6_000,
      maxDecodedSummaries: 8_192,
      maxDecodedFeatures: 8_192,
      maxDecodedDetails: 512,
    });
  });

  it("resolves the raised overview record only for the opt-in session", () => {
    expect(resolveCitywideBudgets(false)).toBe(CITYWIDE_BUDGETS);
    expect(resolveCitywideBudgets(true)).toBe(CITYWIDE_OVERVIEW_BUDGETS);
    // The recorded contract raises, each one derived in the record's comment
    // from the committed release census.
    expect(CITYWIDE_OVERVIEW_BUDGETS.maxLoadedShards).toBe(112);
    expect(CITYWIDE_OVERVIEW_BUDGETS.maxLoadedShards).toBeGreaterThanOrEqual(56 + 47);
    expect(CITYWIDE_OVERVIEW_BUDGETS.maxLoadedBytes).toBe(80 * 1024 * 1024);
    expect(CITYWIDE_OVERVIEW_BUDGETS.maxLoadedBytes).toBeGreaterThanOrEqual(45_903_404 + 14_279_876 + 2_633_218 + 558_788 + 1_048_527);
    expect(CITYWIDE_OVERVIEW_BUDGETS.maxRenderedDenseFeatures).toBe(45_194 + 12_353);
    // Everything else is untouched, including the decoded-map ceilings.
    for (const key of ["rootBytes", "geometryShardBytes", "searchDetailShardBytes", "totalBytes", "maxShards", "maxFeaturesPerGeometryShard", "maxConcurrentRequests", "maxDecodedSummaries", "maxDecodedFeatures", "maxDecodedDetails"] as const) {
      expect(CITYWIDE_OVERVIEW_BUDGETS[key]).toBe(CITYWIDE_BUDGETS[key]);
    }
  });

  it("derives a cache class from the ref prefix across namespaces", () => {
    expect(citywideCacheClass("citywide:geometry/buildings/wgs84-geodetic/14/4823/4486/0.json")).toBe("geometry/buildings");
    expect(citywideCacheClass("citywide:geometry/restaurants/wgs84-geodetic/14/4823/4486/0.json")).toBe("geometry/restaurants");
    expect(citywideCacheClass("citywide:search/a.json")).toBe("search");
    expect(citywideCacheClass("citywide:details/index.json")).toBe("details");
    expect(citywideCacheClass("civic:details/one.json")).toBe("details");
    expect(citywideCacheClass("civic:areas/one.json")).toBe("other");
    expect(citywideCacheClass("geometry/buildings/loose.json")).toBe("geometry/buildings");
  });

  it("keeps a floored class resident while another class is over its own floor", () => {
    const cache = new CitywideLruCache<string>(10, 1_000, { "geometry/buildings": 4, search: 1 });
    for (let index = 0; index < 4; index += 1) cache.set(`citywide:geometry/buildings/${index}.json`, "B", 10);
    for (let index = 0; index < 6; index += 1) cache.set(`citywide:search/${index}.json`, "S", 10);
    // Ten entries, cap ten: the next search load must evict, and the buildings
    // are the least recently used. The floor sends the evictor to `search`.
    cache.set("citywide:search/storm.json", "S", 10);
    expect(cache.size()).toBe(10);
    for (let index = 0; index < 4; index += 1) expect(cache.has(`citywide:geometry/buildings/${index}.json`)).toBe(true);
    expect(cache.classSizes()).toEqual({ "geometry/buildings": 4, search: 6 });
    expect(cache.classEvictionCounts()).toEqual({ search: 1 });
  });

  it("yields the floor rather than growing without bound when no class is over its floor", () => {
    const cache = new CitywideLruCache<string>(4, 1_000, { "geometry/buildings": 2, search: 1 });
    cache.set("citywide:geometry/buildings/0.json", "B", 10);
    cache.set("citywide:geometry/buildings/1.json", "B", 10);
    cache.set("citywide:search/0.json", "S", 10);
    cache.set("citywide:details/0.json", "D", 10);
    // Every class is at or below its floor (details has none), yet the cap has
    // to bind. The oldest entry goes and the cap holds.
    cache.set("citywide:details/1.json", "D", 10);
    expect(cache.size()).toBe(4);
    expect(cache.evictionCount()).toBe(1);
  });

  it("never lets a floor refuse admission of a legal artifact", () => {
    const cache = new CitywideLruCache<string>(6, 1_000, CITYWIDE_OVERVIEW_CACHE_FLOORS.search ? { search: 1 } : {});
    for (let index = 0; index < 6; index += 1) cache.set(`citywide:search/${index}.json`, "S", 10);
    // Saturated by one floored class. Admission is class-blind, so this must
    // not throw from inside a settled request promise.
    expect(() => cache.set("citywide:geometry/buildings/0.json", "B", 10)).not.toThrow();
    expect(cache.has("citywide:geometry/buildings/0.json")).toBe(true);
    // The only admission refusal remains the byte cap the precheck can read.
    expect(() => cache.set("citywide:geometry/buildings/1.json", "B", 1_001)).toThrow(/entry bytes are invalid/u);
  });

  it("refuses a floor configuration that would leave no evictable entry", () => {
    expect(() => new CitywideLruCache<string>(3, 1_000, { "geometry/buildings": 2, search: 1 })).toThrow(/evictable entry/u);
    expect(() => new CitywideLruCache<string>(10, 1_000, { search: 0 })).toThrow(/positive integers/u);
    // The shipped floors have to fit inside the shipped entry cap.
    expect(() => new CitywideLruCache<string>(CITYWIDE_OVERVIEW_BUDGETS.maxLoadedShards, CITYWIDE_OVERVIEW_BUDGETS.maxLoadedBytes, CITYWIDE_OVERVIEW_CACHE_FLOORS)).not.toThrow();
  });

  it("evicts in exactly the historical order when no floors are configured", () => {
    const floored = new CitywideLruCache<string>(3, 1_000, {});
    for (const key of ["citywide:search/a.json", "citywide:search/b.json", "citywide:search/c.json"]) floored.set(key, "S", 10);
    floored.get("citywide:search/a.json");
    floored.set("citywide:search/d.json", "S", 10);
    expect(floored.keys().sort()).toEqual(["citywide:search/a.json", "citywide:search/c.json", "citywide:search/d.json"]);
  });

  it("holds the whole committed dense island against a search and detail storm", () => {
    const cache = new CitywideLruCache<string>(CITYWIDE_OVERVIEW_BUDGETS.maxLoadedShards, CITYWIDE_OVERVIEW_BUDGETS.maxLoadedBytes, CITYWIDE_OVERVIEW_CACHE_FLOORS);
    for (let index = 0; index < 56; index += 1) cache.set(`citywide:geometry/buildings/${index}.json`, "B", 819_704);
    for (let index = 0; index < 47; index += 1) cache.set(`citywide:geometry/restaurants/${index}.json`, "R", 303_827);
    cache.set("citywide:details/index.json", "I", 2_633_218);
    for (let index = 0; index < 200; index += 1) cache.set(`citywide:search/${index}.json`, "S", 558_788);
    for (let index = 0; index < 100; index += 1) cache.set(`citywide:details/${index}.json`, "D", 1_048_527);
    const sizes = cache.classSizes();
    expect(sizes["geometry/buildings"]).toBe(56);
    expect(sizes["geometry/restaurants"]).toBe(47);
    expect(cache.classEvictionCounts()["geometry/buildings"]).toBeUndefined();
    expect(cache.classEvictionCounts()["geometry/restaurants"]).toBeUndefined();
    expect(cache.size()).toBeLessThanOrEqual(CITYWIDE_OVERVIEW_BUDGETS.maxLoadedShards);
    expect(cache.bytes()).toBeLessThanOrEqual(CITYWIDE_OVERVIEW_BUDGETS.maxLoadedBytes);
  });
  /**
   * The B1 hazard, as an executable statement.
   *
   * The aggregate cache has several tenants. Civic-context refs derive to
   * class `other`, which has no floor, so overview floors applied while civic
   * is the mode on screen pin 103 citywide shards nobody is looking at and
   * evict the civic shards that are. The floors are therefore live-gated on
   * citywide being the active mode (see `resolveCitywideOverviewResidency`),
   * and withdrawing them has to actually restore plain recency.
   */
  it("starves an unfloored tenant while floored, and stops when the floors are withdrawn", () => {
    const cache = new CitywideLruCache<string>(CITYWIDE_OVERVIEW_BUDGETS.maxLoadedShards, CITYWIDE_OVERVIEW_BUDGETS.maxLoadedBytes, CITYWIDE_OVERVIEW_CACHE_FLOORS);
    for (let index = 0; index < 56; index += 1) cache.set(`citywide:geometry/buildings/${index}.json`, "B", 800_000);
    for (let index = 0; index < 47; index += 1) cache.set(`citywide:geometry/restaurants/${index}.json`, "R", 300_000);
    // Civic geometry, loaded AFTER every citywide shard, so plain recency would
    // never choose it.
    for (let index = 0; index < 20; index += 1) cache.set(`civic:areas/${index}.json`, "C", 300_000);
    expect(cache.classSizes()["geometry/buildings"]).toBe(56);
    expect(cache.classEvictionCounts().other).toBeGreaterThan(0);
    expect(cache.classSizes().other ?? 0).toBeLessThan(20);

    // Withdrawing the record restores the default caps and plain recency.
    cache.configure(CITYWIDE_BUDGETS.maxLoadedShards, CITYWIDE_BUDGETS.maxLoadedBytes, CITYWIDE_NO_CACHE_FLOORS);
    expect(cache.maxEntries).toBe(CITYWIDE_BUDGETS.maxLoadedShards);
    expect(cache.maxBytes).toBe(CITYWIDE_BUDGETS.maxLoadedBytes);
    expect(cache.floors).toEqual({});
    expect(cache.size()).toBeLessThanOrEqual(CITYWIDE_BUDGETS.maxLoadedShards);
    // With no floors the coldest entries go, and the citywide geometry loaded
    // first is the coldest thing in the cache: the shrink itself evicts the
    // building shards the floors had been pinning.
    expect(cache.classEvictionCounts()["geometry/buildings"] ?? 0).toBeGreaterThan(0);
    expect(cache.classSizes()["geometry/buildings"] ?? 0).toBeLessThan(56);
  });

  it("keeps both recorded configurations admissible for every declared shard size", () => {
    // Reconfiguration must never make an already-legal artifact inadmissible;
    // the largest declared shard is a 2 MiB geometry chunk.
    for (const record of [CITYWIDE_BUDGETS, CITYWIDE_OVERVIEW_BUDGETS]) {
      expect(record.maxLoadedBytes).toBeGreaterThan(record.geometryShardBytes);
      expect(record.maxLoadedBytes).toBeGreaterThan(record.searchDetailShardBytes);
    }
  });

  it("freezes both exported records", () => {
    expect(Object.isFrozen(CITYWIDE_BUDGETS)).toBe(true);
    expect(Object.isFrozen(CITYWIDE_OVERVIEW_BUDGETS)).toBe(true);
    expect(Object.isFrozen(CITYWIDE_OVERVIEW_CACHE_FLOORS)).toBe(true);
  });
});
