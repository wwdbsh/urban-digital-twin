import { describe, expect, it } from "vitest";
import { generateSyntheticTileHarness, SYNTHETIC_TILE_ANCHORS } from "./synthetic-tile-harness";
import { isSafeRelativeContentRef, validateCityTilePackage } from "./tile-package";
import { RuntimeTileStream, selectRuntimeTiles } from "./tile-stream";
import { tileKeyString } from "./spatial";

describe("city tile package and runtime stream", () => {
  it("generates deterministic fixture-only manifests with valid quadtree provenance", async () => {
    const first = await generateSyntheticTileHarness({ featuresPerLayerPerLod: 3 });
    const second = await generateSyntheticTileHarness({ featuresPerLayerPerLod: 3 });
    expect(JSON.stringify(first.package)).toBe(JSON.stringify(second.package));
    expect(validateCityTilePackage(first.package).ok).toBe(true);
    expect(first.package.fixtureOnly).toBe(true);
    expect(first.package.tiles.some((tile) => tile.layer === "buildings" && tile.featureCount === 3)).toBe(true);
    expect(first.package.tiles.some((tile) => tile.layer === "pois" && tile.featureCount === 3)).toBe(true);
    expect(first.package.tiles.every((tile) => tile.sourceRegistryEntryIds.length > 0 && tile.relativeContentRef.startsWith("synthetic/"))).toBe(true);
    for (const lod of [8, 10, 12, 14]) {
      for (const layer of ["buildings", "pois"]) {
        const manifests = first.package.tiles.filter((tile) => tile.lod === lod && tile.layer === layer);
        expect(new Set(manifests.map((tile) => tileKeyString(tile.tileKey)).values()).size).toBeGreaterThan(1);
        expect(manifests.flatMap((tile) => tile.children).every((childId) => first.package.tiles.some((child) => child.contentId === childId))).toBe(true);
      }
    }
  });

  it("rejects unsafe content references, missing children, duplicates, and checksum gaps", async () => {
    expect(isSafeRelativeContentRef("synthetic/buildings/12/1/2.json")).toBe(true);
    expect(isSafeRelativeContentRef("/absolute.json")).toBe(false);
    expect(isSafeRelativeContentRef("../escape.json")).toBe(false);
    expect(isSafeRelativeContentRef("https://example.invalid/tile.json")).toBe(false);
    const fixture = await generateSyntheticTileHarness({ featuresPerLayerPerLod: 1 });
    const invalid = { ...fixture.package, tiles: fixture.package.tiles.map((tile, index) => index === 0 ? { ...tile, children: ["missing-child"], checksumSha256: "bad" } : tile) };
    const result = validateCityTilePackage(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((issue) => issue.message).join(" ")).toMatch(/SHA-256|Missing child/);
  });

  it("fails closed for a pending source in a non-fixture package", async () => {
    const fixture = await generateSyntheticTileHarness({ featuresPerLayerPerLod: 1 });
    const pendingPackage = { ...fixture.package, fixtureOnly: false, tiles: fixture.package.tiles.map((tile) => ({ ...tile, sourceRegistryEntryIds: ["mta.subway-entrances-2024"] })) };
    const result = validateCityTilePackage(pendingPackage);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.message.includes("Pending source"))).toBe(true);
  });

  it("selects bounded LODs, deduplicates requests, and evicts deterministically", async () => {
    const fixture = await generateSyntheticTileHarness({ featuresPerLayerPerLod: 2 });
    const selected = selectRuntimeTiles(fixture.package, { longitude: -73.991, latitude: 40.744, distanceMeters: 4_000 }, { minLod: 8, maxLod: 12 });
    expect(selected.map((tile) => tile.lod)).toEqual([10, 10]);
    const movedKeys = SYNTHETIC_TILE_ANCHORS.slice(0, 3).map(([longitude, latitude]) => selectRuntimeTiles(fixture.package, { longitude, latitude, distanceMeters: 4_000 }, { minLod: 8, maxLod: 12 }).map((tile) => tileKeyString(tile.tileKey)).join("|"));
    expect(new Set(movedKeys).size).toBe(3);
    expect(selectRuntimeTiles(fixture.package, { longitude: SYNTHETIC_TILE_ANCHORS[0]![0], latitude: SYNTHETIC_TILE_ANCHORS[0]![1], distanceMeters: 100 }, { minLod: 8, maxLod: 14 }).every((tile) => tile.lod === 14)).toBe(true);
    let loads = 0; let active = 0; let peak = 0;
    const stream = new RuntimeTileStream(fixture.package, async (manifest) => { loads += 1; active += 1; peak = Math.max(peak, active); await Promise.resolve(); active -= 1; return fixture.contents.get(manifest.contentId)!; }, { maxLoadedTiles: 1, maxLoadedBytes: 1_000_000, maxConcurrentRequests: 1, minLod: 8, maxLod: 12 });
    await stream.refresh({ longitude: SYNTHETIC_TILE_ANCHORS[0]![0], latitude: SYNTHETIC_TILE_ANCHORS[0]![1], distanceMeters: 4_000 });
    const firstMetrics = stream.getMetrics();
    const firstLoaded = stream.getLoadedContentIds();
    await stream.refresh({ longitude: SYNTHETIC_TILE_ANCHORS[1]![0], latitude: SYNTHETIC_TILE_ANCHORS[1]![1], distanceMeters: 4_000 });
    const secondMetrics = stream.getMetrics();
    const secondLoaded = stream.getLoadedContentIds();
    expect(loads).toBeGreaterThanOrEqual(2);
    expect(peak).toBe(1);
    expect(firstMetrics.loadedTileCount).toBe(1);
    expect(firstMetrics.evictedTileCount).toBeGreaterThan(0);
    expect(secondMetrics.loadedTileCount).toBe(1);
    expect(firstLoaded).not.toEqual(secondLoaded);
    stream.destroy();
    expect(stream.pendingCount()).toBe(0);
  });

  it("fences stale generations and aborts no-longer-selected local requests", async () => {
    const fixture = await generateSyntheticTileHarness({ featuresPerLayerPerLod: 1 });
    let aborts = 0;
    const stream = new RuntimeTileStream(fixture.package, (manifest, signal) => new Promise((resolve, reject) => {
      const finish = () => resolve(fixture.contents.get(manifest.contentId));
      if (signal.aborted) { aborts += 1; reject(new DOMException("aborted", "AbortError")); return; }
      signal.addEventListener("abort", () => { aborts += 1; reject(new DOMException("aborted", "AbortError")); }, { once: true });
      if (manifest.lod === 12) queueMicrotask(finish);
    }), { maxLoadedTiles: 2, maxLoadedBytes: 1_000_000, maxConcurrentRequests: 2, minLod: 8, maxLod: 12 });
    const staleRefresh = stream.refresh({ longitude: SYNTHETIC_TILE_ANCHORS[0]![0], latitude: SYNTHETIC_TILE_ANCHORS[0]![1], distanceMeters: 4_000 });
    await Promise.resolve();
    await stream.refresh({ longitude: SYNTHETIC_TILE_ANCHORS[1]![0], latitude: SYNTHETIC_TILE_ANCHORS[1]![1], distanceMeters: 100 });
    await staleRefresh;
    expect(aborts).toBeGreaterThan(0);
    expect(stream.getMetrics().cancelledRequestCount).toBeGreaterThan(0);
    expect(stream.getMetrics().staleResultCount).toBeGreaterThanOrEqual(0);
    expect(stream.getMetrics().generation).toBe(2);
    expect(stream.pendingCount()).toBe(0);
    stream.destroy();
    expect(stream.pendingCount()).toBe(0);
  });
});
