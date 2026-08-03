import { describe, expect, it } from "vitest";
import { runtimeFixtureFeatures } from "./features";
import { findNearbyFeatures, formatDistanceMeters, greatCircleDistanceMeters, representativePoint } from "./proximity";
import type { Feature } from "./schema";

const station = runtimeFixtureFeatures.find((feature) => feature.kind === "transit-station")!;
const entrance = runtimeFixtureFeatures.find((feature) => feature.kind === "transit-entrance")!;
const point = (id: string, coordinates: [number, number]): Feature => ({ ...station, id, name: id, coordinates, geometry: { type: "Point", coordinates } });

describe("geometry-derived proximity", () => {
  it("uses great-circle meters and sorts by distance before stable ID", () => {
    const origin = point("origin", [-73.99, 40.74]);
    const far = point("z-far", [-73.99, 40.741]);
    const near = point("z-near", [-73.9901, 40.74]);
    const result = findNearbyFeatures(origin, [far, near]);
    expect(result.map((item) => item.feature.id)).toEqual(["z-near", "z-far"]);
    expect(result[0]?.units).toBe("meters");
    expect(result[0]?.method).toBe("great-circle");
    expect(greatCircleDistanceMeters(origin.coordinates, near.coordinates)).toBeGreaterThan(0);
  });

  it("applies threshold and maximum explicitly", () => {
    const origin = point("origin", [-73.99, 40.74]);
    const candidates = [point("a", [-73.99, 40.74001]), point("b", [-73.99, 40.74002]), point("c", [-73.99, 40.74003]), point("d", [-73.99, 40.75])];
    expect(findNearbyFeatures(origin, candidates, { thresholdMeters: 5, maxResults: 2 }).map((item) => item.feature.id)).toEqual(["a", "b"]);
  });

  it("breaks equal-distance ties by stable feature ID", () => {
    const origin = point("origin", [-73.99, 40.74]);
    const west = point("z-west", [-73.9901, 40.74]);
    const east = point("a-east", [-73.9899, 40.74]);
    expect(findNearbyFeatures(origin, [west, east]).map((item) => item.feature.id)).toEqual(["a-east", "z-west"]);
  });

  it("makes no proximity claim for invalid or non-point geometry", () => {
    const polygon = { ...station, geometry: { type: "Polygon", coordinates: [[[-73.99, 40.74], [-73.989, 40.74], [-73.989, 40.741], [-73.99, 40.74]]] } } as Feature;
    const invalid = { ...entrance, geometry: { type: "Point", coordinates: [999, 999] } } as Feature;
    expect(representativePoint(polygon)).toBeNull();
    expect(findNearbyFeatures(polygon, [station])).toEqual([]);
    expect(findNearbyFeatures(station, [invalid])).toEqual([]);
  });

  it("formats only honest distance units", () => {
    expect(formatDistanceMeters(42)).toBe("42 m");
    expect(formatDistanceMeters(1200)).toBe("1.20 km");
    expect(formatDistanceMeters(Number.NaN)).toBe("Unknown distance");
  });
});
