import { describe, expect, it } from "vitest";
import { DeduplicatingTileLoader, MemoryTileCache } from "./cache";
import { LocalFixtureCityAdapter } from "./fixture-adapter";
import { DEFAULT_LAYER_VISIBILITY } from "./layers";
import {
  DEFAULT_LOD_BANDS,
  positionWithinBounds,
  selectLod,
  tileBounds,
  tileKeyForCoordinate,
  tileKeyString,
} from "./spatial";

describe("WGS84 tile keys and LOD", () => {
  it("keeps tile boundaries deterministic and bounded", () => {
    const level = 4;
    const left = tileKeyForCoordinate(-73.9912, 40.7431, level);
    const repeated = tileKeyForCoordinate(-73.9912, 40.7431, level);
    const bounds = tileBounds(left);

    expect(left).toEqual(repeated);
    expect(tileKeyString(left)).toBe(`wgs84-geodetic/${level}/${left.x}/${left.y}`);
    expect(positionWithinBounds([-73.9912, 40.7431], bounds)).toBe(true);
    expect(tileKeyForCoordinate(-180, 90, level)).toEqual({ scheme: "wgs84-geodetic", level, x: 0, y: 0 });
    expect(tileKeyForCoordinate(180, -90, level)).toEqual({ scheme: "wgs84-geodetic", level, x: 2 ** level - 1, y: 2 ** level - 1 });
  });

  it("selects monotonically coarser LOD as distance increases", () => {
    const near = selectLod(100);
    const mid = selectLod(1_000);
    const far = selectLod(5_000);
    const horizon = selectLod(50_000);

    expect(near.level).toBeGreaterThan(mid.level);
    expect(mid.level).toBeGreaterThan(far.level);
    expect(far.level).toBeGreaterThan(horizon.level);
    expect(near.reason).toBe("near");
    expect(horizon.reason).toBe("horizon");
    expect(DEFAULT_LOD_BANDS.every((band, index) => index === 0 || band.maxDistanceMeters > DEFAULT_LOD_BANDS[index - 1]!.maxDistanceMeters)).toBe(true);
  });
});

describe("cache and local fixture adapter", () => {
  it("deduplicates concurrent tile loads and serves cache hits", async () => {
    const cache = new MemoryTileCache<string[]>();
    const loader = new DeduplicatingTileLoader(cache);
    let calls = 0;
    const load = () => loader.load("tile/1", async () => {
      calls += 1;
      await Promise.resolve();
      return ["fixture-building-001"];
    });

    const [first, second] = await Promise.all([load(), load()]);
    const third = await load();
    expect(first).toEqual(second);
    expect(third).toEqual(["fixture-building-001"]);
    expect(calls).toBe(1);
    expect(loader.pendingCount()).toBe(0);
    expect(cache.size()).toBe(1);
  });

  it("projects building and POI layers, supports source-ID search and filtering", async () => {
    const adapter = new LocalFixtureCityAdapter();
    const buildingsManifest = adapter.getLayerManifest("buildings");
    const poisManifest = adapter.getLayerManifest("pois");
    const buildings = await adapter.loadLayerFeatures("buildings");
    const pois = await adapter.loadLayerFeatures("pois");

    expect(buildingsManifest.acceptedCount).toBe(1);
    expect(poisManifest.acceptedCount).toBe(3);
    expect(buildings[0]?.kind).toBe("building");
    expect(buildings[0]?.geometry.type).toBe("Polygon");
    expect(buildings[0]?.geometryProvenance.height.valueMeters).toBe(31.2);
    expect(pois[0]?.kind).toBe("poi");
    expect(pois[0]?.geometry.type).toBe("Point");
    expect(adapter.search("fixture-poi-001")[0]?.name).toBe("Fixture Coffee Counter");
    expect(adapter.search("Fixture Flatiron Block")[0]?.kind).toBe("building");
    expect(adapter.getFeatures({ buildings: false, pois: true, areas: false, stations: false, entrances: false, routes: false }).map((feature) => feature.kind)).toEqual(["poi", "poi", "poi"]);
    expect(adapter.getFeatures({ ...DEFAULT_LAYER_VISIBILITY, buildings: false })).toHaveLength(8);
    expect(adapter.getFeatures({ buildings: false, pois: false, areas: false, stations: false, entrances: false, routes: false })).toHaveLength(0);
    expect(adapter.cacheSize()).toBe(2);
    expect(buildingsManifest.fixtureOnly).toBe(true);
    expect(poisManifest.sourceRegistryEntryIds).toEqual(["fixture.local.manhattan-slice"]);
  });
});
