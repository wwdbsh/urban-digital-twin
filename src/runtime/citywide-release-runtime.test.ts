import { describe, expect, it } from "vitest";
import { buildSyntheticCitywideRelease, CITYWIDE_BUDGETS, CITYWIDE_OVERVIEW_BUDGETS, CITYWIDE_RELEASE_ID, citywideExactIdBucket, CitywideLruCache, CitywideRequestPool, type CitywideBudgetRecord, type CitywideReleaseManifest } from "../release/citywide-release.ts";
import { sha256HexSync, stableSerialize } from "../release/catalog-release.ts";
import { CitywideReleaseAdapter, loadCitywideRelease } from "./citywide-release-runtime.ts";

function response(text: string, status = 200): Response {
  return new Response(text, { status, headers: { "content-type": "application/json" } });
}

function productionLikeFixture(): { manifest: CitywideReleaseManifest; files: Map<string, string> } {
  const synthetic = buildSyntheticCitywideRelease();
  const files = new Map<string, string>();
  const manifest = structuredClone(synthetic.manifest) as CitywideReleaseManifest;
  manifest.releaseId = CITYWIDE_RELEASE_ID;
  manifest.fixtureOnly = false;
  manifest.sourceSnapshots = [
    { registryEntryId: "nyc.building-footprints", provider: "OTI", datasetId: "jh45-qr5r", captureTimestamp: "2026-08-04T08:25:05.580Z", sourceUpdatedAt: "2026-08-02T02:17:27.174Z", rawRelativeRef: "raw/oti.geojson", rawByteSize: 1, rawChecksumSha256: "a".repeat(64), sourceRecordCount: 1, acceptedCount: 1, rejectedCount: 0, termsUrl: "https://opendata.cityofnewyork.us/overview/", attribution: "OTI" },
    { registryEntryId: "nyc.dohmh-restaurant-inspections", provider: "DOHMH", datasetId: "43nn-pn8j", captureTimestamp: "2026-08-04T07:41:56.726Z", sourceUpdatedAt: "2026-08-03T22:06:07.000Z", rawRelativeRef: "raw/dohmh.json", rawByteSize: 1, rawChecksumSha256: "b".repeat(64), sourceRecordCount: 1, acceptedCount: 1, rejectedCount: 0, termsUrl: "https://www.nyc.gov/html/datamine/html/data/terms.html?dataSetJs=raw", attribution: "DOHMH" },
  ];
  const detailEntries = [
    ["doitt:target", "details/one.json"] as [string, string],
    ["dohmh:target", "details/one.json"] as [string, string],
    ...Array.from({ length: 57_631 }, (_, index) => [`parent:${index}`, "details/one.json"] as [string, string]),
  ];
  const detailIndexText = `${stableSerialize({ schemaVersion: "citywide-detail-index-1", entries: detailEntries })}\n`;
  files.set("details/index.json", detailIndexText);
  manifest.detailIndex = { relativeContentRef: "details/index.json", byteSize: new TextEncoder().encode(detailIndexText).byteLength, checksumSha256: sha256HexSync(detailIndexText), entryCount: detailEntries.length };
  const firstBuildingShard = manifest.geometryShards[0]!;
  const original = synthetic.geometry.get(firstBuildingShard.relativeContentRef) ?? [];
  const firstText = `${stableSerialize({ schemaVersion: "citywide-geometry-1", layer: firstBuildingShard.layer, tileKey: firstBuildingShard.tileKey, features: original })}\n`;
  files.set(firstBuildingShard.relativeContentRef, firstText);
  const firstShard = { ...firstBuildingShard, densePartIndex: 0, densePartCount: 2, byteSize: new TextEncoder().encode(firstText).byteLength, checksumSha256: sha256HexSync(firstText) };
  // Keep the cold target out of chunk 0 and use production-shaped compact
  // records: the enclosing payload supplies tileKey and partCount is omitted.
  const targetRef = "geometry/buildings/wgs84-geodetic/14/4823/4486/1.json";
  const targetFeatures = [{
    parentId: "doitt:target", partId: "part-target", partIndex: 0,
    name: "Target Building",
    geometry: { type: "Polygon", coordinates: [[[-74.0102, 40.7098], [-74.0098, 40.7098], [-74.0098, 40.7102], [-74.0102, 40.7102], [-74.0102, 40.7098]]] },
    coordinates: [-74.01, 40.71], heightMeters: 33, heightUnknown: false,
    sourceRecordId: "target", bin: "123", baseBbl: "100", mapPlutoBbl: "100",
    sourceRefIds: ["source-ref:nyc.building-footprints:target"],
  }];
  const targetText = `${stableSerialize({ schemaVersion: "citywide-geometry-1", layer: "buildings", tileKey: firstBuildingShard.tileKey, features: targetFeatures })}\n`;
  files.set(targetRef, targetText);
  const targetShard = {
    ...firstBuildingShard,
    shardId: `${firstBuildingShard.shardId}:chunk-1`,
    relativeContentRef: targetRef,
    featureCount: targetFeatures.length,
    densePartIndex: 1,
    densePartCount: 2,
    byteSize: new TextEncoder().encode(targetText).byteLength,
    checksumSha256: sha256HexSync(targetText),
  };
  manifest.geometryShards = [firstShard, targetShard];
  manifest.layers = manifest.layers.map((layer) => layer.id === "buildings" ? { ...layer, shardCount: 2, renderPartCount: 2 } : layer);
  const exactId = "doitt:target";
  let idBucket = 0;
  for (const char of exactId) idBucket = Math.imul(idBucket ^ char.codePointAt(0)!, 16_777_619);
  const searchPrefix = `id-${String((Math.abs(idBucket) >>> 0) % 16).padStart(2, "0")}`;
  const searchRef = `search/${searchPrefix}.json`;
  const searchText = `${stableSerialize({ schemaVersion: "citywide-search-1", prefix: searchPrefix, summaries: [[exactId, "building", "Target Building", null, null, ["target"], [-74.01, 40.71], "located", [firstBuildingShard.tileKey], "details/one.json"]] })}\n`;
  files.set(searchRef, searchText);
  manifest.searchShards = [{ shardId: "search-id-target", prefix: searchPrefix, kind: "building", summaryCount: 1, byteSize: new TextEncoder().encode(searchText).byteLength, checksumSha256: sha256HexSync(searchText), relativeContentRef: searchRef, parentIds: [] }];
  manifest.detailShards = [{ shardId: "details-one", parentIds: [], byteSize: 0, checksumSha256: "0".repeat(64), relativeContentRef: "details/one.json" }];
  const restaurantFields = ["123", "Target Restaurant", "Manhattan", "1", "TARGET STREET", "10010", null, "Cafe", "2026-07-01", "Action", null, null, "Not Critical", "10", "A", "2026-07-01", "2026-07-02", "Cycle", "40.74", "-73.99", null, null, null, null, null, null, { coordinates: [-73.99, 40.74], type: "Point" }, null, null, null, null];
  const detailRecords = [
    { p: "doitt:target", k: "building", n: "Target Building", s: ["source-ref:nyc.building-footprints:target"], r: ["source-ref:nyc.building-footprints:target"], a: [48190, "target", "123", "100", "100"], v: [["part-target", 0, 1, [-74.01, 40.71], 33, false]] },
    { p: "dohmh:target", k: "restaurant", n: "Target Restaurant", l: "located", c: [-73.99, 40.74], r: ["source-ref:nyc.dohmh-restaurant-inspections:occ-target"], s: ["source-ref:nyc.dohmh-restaurant-inspections:occ-target"], v: [["occ-target", null, "derived-transport-occurrence", "digest-target", 1, 1, restaurantFields]], a: [["source-ref:nyc.dohmh-restaurant-inspections", "conditional-source", "https://example.invalid/terms", "DOHMH"]] },
  ];
  const detailText = `${stableSerialize({ schemaVersion: "citywide-details-1", records: detailRecords })}\n`;
  files.set("details/one.json", detailText);
  manifest.detailShards[0] = { ...manifest.detailShards[0]!, byteSize: new TextEncoder().encode(detailText).byteLength, checksumSha256: sha256HexSync(detailText) };
  manifest.totalDeclaredBytes = 1;
  manifest.publishedFiles = {};
  return { manifest, files };
}

describe("citywide release runtime", () => {
  it("requires the exact production detail-index count and rejects a mismatched root", () => {
    const { manifest } = productionLikeFixture();
    manifest.detailIndex = { ...manifest.detailIndex!, entryCount: 57_632 };
    expect(() => new CitywideReleaseAdapter(manifest, "/data/citywide", async () => response("{}"))).toThrow(/57,633/);
  });

  it("loads only requested local geometry, verifies its checksum, and exposes parent identity", async () => {
    const { manifest, files } = productionLikeFixture();
    const requested: string[] = [];
    const adapter = new CitywideReleaseAdapter(manifest, "/data/citywide", async (input) => {
      const ref = input.replace("/data/citywide/", "");
      requested.push(ref);
      return response(files.get(ref) ?? "{}", files.has(ref) ? 200 : 404);
    });
    const bounds = manifest.geometryShards[0]!.bounds;
    const loaded = await adapter.refreshViewport({ longitude: (bounds.west + bounds.east) / 2, latitude: (bounds.south + bounds.north) / 2, height: 700, heading: 0, pitch: -35, roll: 0 });
    expect(loaded.length).toBeGreaterThan(0);
    expect(loaded.every((feature) => feature.id === feature.attributes.citywideParentId)).toBe(true);
    const building = loaded.find((feature) => feature.attributes.citywideDoittId === "fixture-doitt-0");
    expect(building?.geometryProvenance.height.valueMeters).toBe(12);
    expect(building?.geometryProvenance.height.method).toBe("source");
    expect(building?.sourceRefs[0]?.id).toMatch(/^source-ref:/);
    expect(requested).toContain(manifest.geometryShards[0]!.relativeContentRef);
    const metrics = adapter.getMetrics();
    expect(metrics.maxConcurrentRequests).toBeLessThanOrEqual(4);
    expect(metrics.visibleShardCount).toBe(metrics.requestedShardCount);
    expect(metrics.loadedFeatureCount).toBeGreaterThan(0);
    expect(metrics.loadedBytes).toBeGreaterThan(0);
    expect(metrics.cacheEntries).toBeGreaterThan(0);
    expect(metrics.activeRequests).toBe(0);
    expect(metrics.failedRequestCount).toBe(0);
    expect(metrics.retainedSummaryCount).toBeLessThanOrEqual(CITYWIDE_BUDGETS.maxDecodedSummaries);
    expect(metrics.retainedFeatureCount).toBeLessThanOrEqual(CITYWIDE_BUDGETS.maxDecodedFeatures);
    expect(metrics.retainedDetailCount).toBeLessThanOrEqual(CITYWIDE_BUDGETS.maxDecodedDetails);
  });

  it("selects shards from a supplied ground footprint and dedupes repeated settled views", async () => {
    const { manifest, files } = productionLikeFixture();
    let geometryRequests = 0;
    const adapter = new CitywideReleaseAdapter(manifest, "/data/citywide", async (input) => {
      const ref = input.replace("/data/citywide/", "");
      if (ref.startsWith("geometry/")) geometryRequests += 1;
      return response(files.get(ref) ?? "{}", files.has(ref) ? 200 : 404);
    });
    const target = manifest.geometryShards.find((shard) => shard.relativeContentRef.endsWith("/1.json"))!;
    const request = {
      // Deliberately far from the selected shard: the ground footprint, not
      // this aerial position, is the release selection contract.
      camera: { longitude: -73.7, latitude: 40.95, height: 8_000, heading: 20, pitch: -50, roll: 0 },
      footprint: {
        bounds: target.bounds,
        groundCenter: { longitude: -74.01, latitude: 40.71 },
        valid: true,
        source: "ground-rays" as const,
        signature: "target-ground-footprint",
      },
    };
    const first = adapter.refreshViewport(request);
    const duplicate = adapter.refreshViewport(request);
    expect(duplicate).toBe(first);
    await expect(first).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: "doitt:target" })]));
    await expect(adapter.refreshViewport(request)).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: "doitt:target" })]));
    expect(adapter.getMetrics().dedupedRefreshCount).toBe(2);
    expect(geometryRequests).toBeGreaterThan(0);
  });

  it("routes exact identifiers through their hash bucket and supports cold parent details", async () => {
    const { manifest, files } = productionLikeFixture();
    const requested: string[] = [];
    const adapter = new CitywideReleaseAdapter(manifest, "/data/citywide", async (input) => {
      const ref = input.replace("/data/citywide/", "");
      requested.push(ref);
      return response(files.get(ref) ?? "{}", files.has(ref) ? 200 : 404);
    });
    const results = await adapter.searchAsync("doitt:target");
    expect(results.map((feature) => feature.id)).toContain("doitt:target");
    expect(requested.some((ref) => ref.includes("search/id-"))).toBe(true);
    expect(requested.filter((ref) => ref.startsWith("search/")).every((ref) => ref.includes("search/id-"))).toBe(true);
    const building = await adapter.loadDetail("doitt:target");
    const restaurant = await adapter.loadDetail("dohmh:target");
    expect(building?.name).toBe("Target Building");
    expect(building?.geometry.type).toBe("Polygon");
    expect(building?.geometryProvenance.height.valueMeters).toBe(33);
    expect(building?.geometryProvenance.height.method).toBe("source");
    expect(building?.sourceRefs[0]?.id).toBe("source-ref:nyc.building-footprints:target");
    expect(restaurant?.name).toBe("Target Restaurant");
    expect(restaurant?.attributes.citywideObservationCount).toBe(1);
    expect(restaurant?.sourceRefs[0]?.id).toBe("source-ref:nyc.dohmh-restaurant-inspections:occ-target");
  });

  it("routes a numeric source identifier through only its hash bucket and exact-matches the parent", async () => {
    const { manifest, files } = productionLikeFixture();
    const sourceIdentifier = "12345678";
    const prefix = citywideExactIdBucket(sourceIdentifier);
    const relativeContentRef = `search/${prefix}-numeric-source.json`;
    const summary = ["doitt:target", "building", "Target Building", null, null, ["target", sourceIdentifier], [-74.01, 40.71], "located", [manifest.geometryShards[0]!.tileKey], "details/one.json"];
    const text = `${stableSerialize({ schemaVersion: "citywide-search-1", prefix, summaries: [summary] })}\n`;
    files.set(relativeContentRef, text);
    manifest.searchShards = [...manifest.searchShards, {
      shardId: "search-numeric-source",
      prefix,
      kind: "building",
      summaryCount: 1,
      byteSize: new TextEncoder().encode(text).byteLength,
      checksumSha256: sha256HexSync(text),
      relativeContentRef,
      parentIds: [],
    }];
    const requested: string[] = [];
    const adapter = new CitywideReleaseAdapter(manifest, "/data/citywide", async (input) => {
      const ref = input.replace("/data/citywide/", "");
      requested.push(ref);
      return response(files.get(ref) ?? "{}", files.has(ref) ? 200 : 404);
    });
    const results = await adapter.searchAsync(sourceIdentifier);
    expect(results.map((feature) => feature.id)).toEqual(["doitt:target"]);
    const searchRequests = requested.filter((ref) => ref.startsWith("search/"));
    expect(searchRequests).toEqual([relativeContentRef]);
    expect(searchRequests.every((ref) => !ref.includes("/1"))).toBe(true);
  });

  it("keeps an exact-ID match from an early hash chunk after later chunks exceed the summary cap", async () => {
    const { manifest, files } = productionLikeFixture();
    const template = manifest.searchShards[0]!;
    const prefix = template.prefix;
    const target = ["doitt:target", "building", "Target Building", null, null, ["target"], [-74.01, 40.71], "located", [manifest.geometryShards[0]!.tileKey], "details/one.json"];
    const filler = Array.from({ length: CITYWIDE_BUDGETS.maxDecodedSummaries + 8_201 }, (_, index) => [`doitt:filler-${String(index).padStart(5, "0")}`, "building", `Filler ${index}`, null, null, [`filler-${index}`], [-74.01, 40.71], "located", [manifest.geometryShards[0]!.tileKey], "details/one.json"]);
    const firstText = `${stableSerialize({ schemaVersion: "citywide-search-1", prefix, summaries: [target] })}\n`;
    const firstRef = "search/target-early.json";
    files.set(firstRef, firstText);
    const laterShards = Array.from({ length: 5 }, (_, chunkIndex) => {
      const chunk = filler.slice(chunkIndex * 4_000, (chunkIndex + 1) * 4_000);
      const text = `${stableSerialize({ schemaVersion: "citywide-search-1", prefix, summaries: chunk })}\n`;
      const ref = `search/target-later-${chunkIndex}.json`;
      files.set(ref, text);
      return { ...template, shardId: `search-target-later-${chunkIndex}`, relativeContentRef: ref, summaryCount: chunk.length, byteSize: new TextEncoder().encode(text).byteLength, checksumSha256: sha256HexSync(text) };
    });
    manifest.searchShards = [
      { ...template, shardId: "search-target-early", relativeContentRef: firstRef, summaryCount: 1, byteSize: new TextEncoder().encode(firstText).byteLength, checksumSha256: sha256HexSync(firstText) },
      ...laterShards,
    ];
    const adapter = new CitywideReleaseAdapter(manifest, "/data/citywide", async (input) => {
      const ref = input.replace("/data/citywide/", "");
      return response(files.get(ref) ?? "{}", files.has(ref) ? 200 : 404);
    });
    const results = await adapter.searchAsync("doitt:target");
    expect(results.map((feature) => feature.id)).toContain("doitt:target");
    expect(adapter.getMetrics().retainedSummaryCount).toBeLessThanOrEqual(CITYWIDE_BUDGETS.maxDecodedSummaries);
  });

  it("verifies the immutable root manifest sidecar before activation", async () => {
    const { manifest } = productionLikeFixture();
    const manifestText = `${stableSerialize(manifest)}\n`;
    const hash = sha256HexSync(manifestText);
    const adapter = await loadCitywideRelease("/data/citywide", undefined, async (input) => {
      if (input.endsWith("/manifest.json")) return response(manifestText);
      if (input.endsWith("/manifest.sha256")) return response(`${hash}  manifest.json\n`);
      return response("{}", 404);
    });
    expect(adapter.releaseId).toBe(CITYWIDE_RELEASE_ID);
    await expect(loadCitywideRelease("/data/citywide", undefined, async (input) => {
      if (input.endsWith("/manifest.json")) return response(manifestText);
      if (input.endsWith("/manifest.sha256")) return response(`${"0".repeat(64)}  manifest.json\n`);
      return response("{}", 404);
    })).rejects.toThrow(/root manifest checksum/);
  });

  it("fails closed when a requested shard checksum is wrong", async () => {
    const { manifest, files } = productionLikeFixture();
    manifest.geometryShards = manifest.geometryShards.map((shard) => ({ ...shard, checksumSha256: "f".repeat(64) }));
    const adapter = new CitywideReleaseAdapter(manifest, "/data/citywide", async (input) => response(files.get(input.replace("/data/citywide/", "")) ?? "{}"));
    const bounds = manifest.geometryShards[0]!.bounds;
    await expect(adapter.refreshViewport({ longitude: (bounds.west + bounds.east) / 2, latitude: (bounds.south + bounds.north) / 2, height: 700, heading: 0, pitch: -35, roll: 0 })).resolves.toHaveLength(0);
  });

  it("fails closed when an exact-ID search shard checksum is wrong", async () => {
    const { manifest, files } = productionLikeFixture();
    const searchShard = manifest.searchShards[0]!;
    manifest.searchShards = [{ ...searchShard, checksumSha256: "f".repeat(64) }];
    const adapter = new CitywideReleaseAdapter(manifest, "/data/citywide", async (input) => {
      const ref = input.replace("/data/citywide/", "");
      return response(files.get(ref) ?? "{}", files.has(ref) ? 200 : 404);
    });
    await expect(adapter.searchAsync("doitt:target")).rejects.toThrow(/Invalid citywide search shard/);
    expect(adapter.getFeature("doitt:target")).toBeUndefined();
    expect(adapter.getMetrics().retainedSummaryCount).toBe(0);
    expect(adapter.getMetrics().failedRequestCount).toBeGreaterThan(0);
  });

  it("fails closed when a cold detail shard checksum is wrong", async () => {
    const { manifest, files } = productionLikeFixture();
    const detailShard = manifest.detailShards[0]!;
    manifest.detailShards = [{ ...detailShard, checksumSha256: "f".repeat(64) }];
    const adapter = new CitywideReleaseAdapter(manifest, "/data/citywide", async (input) => {
      const ref = input.replace("/data/citywide/", "");
      return response(files.get(ref) ?? "{}", files.has(ref) ? 200 : 404);
    });
    await expect(adapter.loadDetail("dohmh:target")).rejects.toThrow(/Invalid citywide detail shard/);
    expect(adapter.getFeature("dohmh:target")).toBeUndefined();
    expect(adapter.getMetrics().retainedDetailCount).toBe(0);
    expect(adapter.getMetrics().failedRequestCount).toBeGreaterThan(0);
  });

  it("rejects an emitted geometry payload whose tile key differs from its manifest", async () => {
    const { manifest, files } = productionLikeFixture();
    const ref = manifest.geometryShards[0]!.relativeContentRef;
    const badText = `${stableSerialize({ schemaVersion: "citywide-geometry-1", layer: "buildings", tileKey: "wgs84-geodetic/14/0/0", features: [] })}\n`;
    files.set(ref, badText);
    manifest.geometryShards[0] = { ...manifest.geometryShards[0]!, checksumSha256: sha256HexSync(badText), byteSize: new TextEncoder().encode(badText).byteLength };
    const adapter = new CitywideReleaseAdapter(manifest, "/data/citywide", async (input) => response(files.get(input.replace("/data/citywide/", "")) ?? "{}"));
    const bounds = manifest.geometryShards[0]!.bounds;
    await expect(adapter.refreshViewport({ longitude: (bounds.west + bounds.east) / 2, latitude: (bounds.south + bounds.north) / 2, height: 700, heading: 0, pitch: -35, roll: 0 })).rejects.toThrow(/tile\/layer gate|tile\/layer/);
  });

  it("aborts cold viewport fetches without promoting partial geometry", async () => {
    const { manifest } = productionLikeFixture();
    const controller = new AbortController();
    const adapter = new CitywideReleaseAdapter(manifest, "/data/citywide", async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const bounds = manifest.geometryShards[0]!.bounds;
    const pending = adapter.refreshViewport({ longitude: (bounds.west + bounds.east) / 2, latitude: (bounds.south + bounds.north) / 2, height: 700, heading: 0, pitch: -35, roll: 0 }, controller.signal);
    controller.abort();
    await expect(pending).resolves.toHaveLength(0);
    expect(adapter.getMetrics().loadedFeatureCount).toBe(0);
  });

  it("does not let an aborted search caller cancel a shared shard for its next caller", async () => {
    const { manifest, files } = productionLikeFixture();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const adapter = new CitywideReleaseAdapter(manifest, "/data/citywide", async (input) => {
      const ref = input.replace("/data/citywide/", "");
      if (ref.startsWith("search/")) await gate;
      return response(files.get(ref) ?? "{}", files.has(ref) ? 200 : 404);
    });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = adapter.searchAsync("doitt:target", firstController.signal);
    await Promise.resolve();
    const second = adapter.searchAsync("doitt:target", secondController.signal);
    firstController.abort();
    release?.();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: "doitt:target" })]));
  });

  it("clears a failed detail-index promise so a later cold detail lookup can retry", async () => {
    const { manifest, files } = productionLikeFixture();
    let failed = true;
    const adapter = new CitywideReleaseAdapter(manifest, "/data/citywide", async (input) => {
      const ref = input.replace("/data/citywide/", "");
      if (ref === "details/index.json" && failed) {
        failed = false;
        return response("unavailable", 503);
      }
      return response(files.get(ref) ?? "{}", files.has(ref) ? 200 : 404);
    });
    await expect(adapter.loadDetail("dohmh:target")).rejects.toThrow(/503|detail index/i);
    await expect(adapter.loadDetail("dohmh:target")).resolves.toMatchObject({ id: "dohmh:target", name: "Target Restaurant" });
  });

  it("keeps an unsignalled shared caller alive when a signalled peer aborts", async () => {
    const runCase = async (signalledFirst: boolean, key: string) => {
      const pool = new CitywideRequestPool<string>(1);
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const task = { key, loader: async (signal: AbortSignal) => {
        await gate;
        if (signal.aborted) throw new DOMException("aborted", "AbortError");
        return { value: "shared-value", bytes: 12 };
      } };
      const controller = new AbortController();
      const signalled = () => pool.load(task, controller.signal);
      const unsignalled = () => pool.load(task);
      const first = signalledFirst ? signalled() : unsignalled();
      await Promise.resolve();
      const second = signalledFirst ? unsignalled() : signalled();
      controller.abort();
      release?.();
      const values = await Promise.allSettled([first, second]);
      expect(values.filter((result) => result.status === "fulfilled").map((result) => result.status === "fulfilled" ? result.value : null)).toContain("shared-value");
      expect(values.filter((result) => result.status === "rejected").map((result) => result.status === "rejected" ? result.reason.name : null)).toContain("AbortError");
      expect(pool.pendingCount()).toBe(0);
      expect(pool.activeCount()).toBe(0);
      expect(pool.cacheMetrics().entries).toBe(1);
    };
    await runCase(false, "unsignalled-first");
    await runCase(true, "signalled-first");
  });

  it("cancels only a stale viewport waiter when cold detail shares the same geometry ref", async () => {
    const runCase = async (detailFirst: boolean, key: string) => {
      const pool = new CitywideRequestPool<string>(1);
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const task = { key, loader: async (signal: AbortSignal) => {
        await gate;
        if (signal.aborted) throw new DOMException("aborted", "AbortError");
        return { value: "shared-geometry", bytes: 16 };
      } };
      const viewportController = new AbortController();
      const detailController = new AbortController();
      const detail = detailFirst ? pool.load(task, detailController.signal) : undefined;
      await Promise.resolve();
      const viewport = pool.load(task, viewportController.signal);
      await Promise.resolve();
      const laterDetail = detailFirst ? detail! : pool.load(task, detailController.signal);
      viewportController.abort();
      release?.();
      await expect(viewport).rejects.toMatchObject({ name: "AbortError" });
      await expect(laterDetail).resolves.toBe("shared-geometry");
      expect(pool.pendingCount()).toBe(0);
      expect(pool.activeCount()).toBe(0);
      expect(pool.cacheMetrics().entries).toBe(1);
    };
    await runCase(false, "shared-geometry-viewport-first");
    await runCase(true, "shared-geometry-detail-first");
  });

  /**
   * The viability fix, pinned.
   *
   * Before T004 a settled camera move rebuilt every visible parent — a fresh
   * `Feature` object plus `validateFeature` for each — even when the shard set
   * behind them had not changed. The objects were never reference-equal, so
   * the app's `preserveFeatureSequence` produced a new array and Cesium
   * rebuilt every instance. At island overview that is 45,194 decodes and
   * 45,194 instances per move. This asserts the property the render path
   * actually consumes: identical shards must yield identical objects.
   */
  it("returns reference-identical features across a settled move that does not change the shard set", async () => {
    const { manifest, files } = productionLikeFixture();
    let geometryRequests = 0;
    const adapter = new CitywideReleaseAdapter(manifest, "/data/citywide", async (input) => {
      const ref = input.replace("/data/citywide/", "");
      if (ref.startsWith("geometry/")) geometryRequests += 1;
      return response(files.get(ref) ?? "{}", files.has(ref) ? 200 : 404);
    });
    const bounds = manifest.geometryShards[0]!.bounds;
    const groundCenter = { longitude: (bounds.west + bounds.east) / 2, latitude: (bounds.south + bounds.north) / 2 };
    const move = async (signature: string, height: number) => adapter.refreshViewport({
      camera: { longitude: groundCenter.longitude, latitude: groundCenter.latitude, height, heading: 0, pitch: -40, roll: 0 },
      footprint: { bounds, groundCenter, valid: true, source: "ground-rays" as const, signature },
    });
    const first = await move("settled-a", 900);
    expect(first.length).toBeGreaterThan(0);
    const requestsAfterFirst = geometryRequests;
    const second = await move("settled-b", 905);
    expect(second).toHaveLength(first.length);
    // Every rendered object, not merely equal content.
    expect(second.every((feature, index) => feature === first[index])).toBe(true);
    // And the sequence itself, so the app's identity check retains its array.
    expect(second).toBe(first);
    expect(geometryRequests).toBe(requestsAfterFirst);
  });

  it("rebuilds when the resident shard objects change and keeps the rebuilt features valid", async () => {
    const { manifest, files } = productionLikeFixture();
    // A one-entry cache guarantees the second move re-fetches, so the memo
    // key — the cached shard object — is a different object and must miss.
    const cache = new CitywideLruCache<unknown>(1, 4 * 1024 * 1024);
    const adapter = new CitywideReleaseAdapter(manifest, "/data/citywide", async (input) => {
      const ref = input.replace("/data/citywide/", "");
      return response(files.get(ref) ?? "{}", files.has(ref) ? 200 : 404);
    }, { sharedCache: cache });
    const bounds = manifest.geometryShards[0]!.bounds;
    const groundCenter = { longitude: (bounds.west + bounds.east) / 2, latitude: (bounds.south + bounds.north) / 2 };
    const move = async (signature: string) => adapter.refreshViewport({
      camera: { longitude: groundCenter.longitude, latitude: groundCenter.latitude, height: 900, heading: 0, pitch: -40, roll: 0 },
      footprint: { bounds, groundCenter, valid: true, source: "ground-rays" as const, signature },
    });
    const first = await move("evict-a");
    const second = await move("evict-b");
    expect(second).not.toBe(first);
    expect(second.map((feature) => feature.id)).toEqual(first.map((feature) => feature.id));
    expect(second.every((feature) => feature.id === feature.attributes.citywideParentId)).toBe(true);
  });

  it("threads a resolved budget record without touching the shared constant", async () => {
    const { manifest, files } = productionLikeFixture();
    const adapter = new CitywideReleaseAdapter(manifest, "/data/citywide", async (input) => {
      const ref = input.replace("/data/citywide/", "");
      return response(files.get(ref) ?? "{}", files.has(ref) ? 200 : 404);
    }, { budgets: CITYWIDE_OVERVIEW_BUDGETS });
    expect(adapter.budgets).toBe(CITYWIDE_OVERVIEW_BUDGETS);
    // A supplier, so the record can follow the ACTIVE mode: this adapter is
    // also the composed civic session's base, and a record fixed at
    // construction would let a citywide flag raise a civic selection bound.
    let active: CitywideBudgetRecord = CITYWIDE_BUDGETS;
    const supplied = new CitywideReleaseAdapter(manifest, "/data/citywide", async (input) => {
      const ref = input.replace("/data/citywide/", "");
      return response(files.get(ref) ?? "{}", files.has(ref) ? 200 : 404);
    }, { budgets: () => active });
    expect(supplied.budgets).toBe(CITYWIDE_BUDGETS);
    active = CITYWIDE_OVERVIEW_BUDGETS;
    expect(supplied.budgets).toBe(CITYWIDE_OVERVIEW_BUDGETS);
    expect(CITYWIDE_BUDGETS.maxLoadedShards).toBe(24);
    const defaulted = new CitywideReleaseAdapter(manifest, "/data/citywide", async (input) => {
      const ref = input.replace("/data/citywide/", "");
      return response(files.get(ref) ?? "{}", files.has(ref) ? 200 : 404);
    });
    expect(defaulted.budgets).toBe(CITYWIDE_BUDGETS);
  });
  it("treats a reordered but unchanged visible shard set as unchanged", async () => {
    const { manifest, files } = productionLikeFixture();
    const adapter = new CitywideReleaseAdapter(manifest, "/data/citywide", async (input) => {
      const ref = input.replace("/data/citywide/", "");
      return response(files.get(ref) ?? "{}", files.has(ref) ? 200 : 404);
    });
    const bounds = manifest.geometryShards[0]!.bounds;
    // Two ground centres inside the same bounds. The shard ranking is by
    // distance from the ground centre, so this permutes the visible order
    // without changing the set; an order-sensitive memo would pay the full
    // class rebuild for a set that did not change.
    const move = async (signature: string, groundCenter: { longitude: number; latitude: number }) => adapter.refreshViewport({
      camera: { longitude: groundCenter.longitude, latitude: groundCenter.latitude, height: 900, heading: 0, pitch: -40, roll: 0 },
      footprint: { bounds, groundCenter, valid: true, source: "ground-rays" as const, signature },
    });
    const first = await move("order-a", { longitude: bounds.west + (bounds.east - bounds.west) * 0.2, latitude: bounds.south + (bounds.north - bounds.south) * 0.2 });
    const second = await move("order-b", { longitude: bounds.west + (bounds.east - bounds.west) * 0.8, latitude: bounds.south + (bounds.north - bounds.south) * 0.8 });
    expect(first.length).toBeGreaterThan(0);
    expect(second).toBe(first);
    // The fixture's two same-tile chunks share bounds, so the above cannot by
    // itself permute the ranking. Assert the comparison directly on a
    // permuted list, which is the property the ranking can produce in the
    // field and which an order-sensitive comparison fails.
    const sameSet = (adapter as unknown as { sameVisibleShards(visible: readonly unknown[]): boolean; committedVisibleShards: readonly unknown[] | null });
    const committed = sameSet.committedVisibleShards ?? [];
    expect(committed.length).toBeGreaterThan(1);
    expect(sameSet.sameVisibleShards([...committed].reverse())).toBe(true);
    expect(sameSet.sameVisibleShards(committed.slice(1))).toBe(false);
  });
});
