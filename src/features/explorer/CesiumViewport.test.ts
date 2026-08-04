import { describe, expect, it } from "vitest";
import restaurants from "../../../public/data/real-wave-20260804/restaurants.json";
import { runtimeFixtureFeatures } from "../../domain/features";
import type { Feature } from "../../domain/schema";
import { denseFeatureIntersectsBounds, fixtureOnlyForFeature, focusPoseForFeature, medianFrameInterval, normalizeFocusCameraPose, poiRenderMode, selectDenseFeatures, shouldStartFocusFlight } from "./CesiumViewport";

describe("Cesium POI render seam", () => {
  const realRestaurant = (restaurants as unknown as Feature[])[0]!;
  const fixturePoi = runtimeFixtureFeatures.find((feature) => feature.kind === "poi")!;

  it("keeps ordinary dense POIs in primitives and only selected POIs in a labeled entity", () => {
    expect(poiRenderMode(realRestaurant, true, false)).toBe("point-primitive");
    expect(poiRenderMode(realRestaurant, true, true)).toBe("selected-entity");
    expect(poiRenderMode(realRestaurant, false, false)).toBe("entity");
    expect(poiRenderMode(fixturePoi, true, false)).toBe("point-primitive");
  });

  it("derives fixture truth from source role for real and fixture records", () => {
    expect(fixtureOnlyForFeature(realRestaurant)).toBe(false);
    expect(fixtureOnlyForFeature(fixturePoi)).toBe(true);
    expect(fixtureOnlyForFeature({ ...realRestaurant, attributes: { ...realRestaurant.attributes, fixtureOnly: true } })).toBe(false);
  });

  it("computes the statistical median for odd and even frame samples", () => {
    expect(medianFrameInterval([9, 1, 5])).toBe(5);
    expect(medianFrameInterval([10, 2, 8, 4])).toBe(6);
    expect(medianFrameInterval([])).toBeNull();
  });

  it("bounds the citywide dense proxy while retaining a selected parent deterministically", () => {
    const features = Array.from({ length: 6_002 }, (_, index) => ({
      ...realRestaurant,
      id: `citywide:poi:${String(index).padStart(5, "0")}`,
      coordinates: [-73.99 + index * 0.000001, 40.748 + index * 0.000001] as Feature["coordinates"],
    }));
    const selectedId = features.at(-1)!.id;
    const first = selectDenseFeatures(features, { longitude: -73.99, latitude: 40.748 }, 6_000, selectedId);
    const second = selectDenseFeatures(features, { longitude: -73.99, latitude: 40.748 }, 6_000, selectedId);
    expect(first).toHaveLength(6_000);
    expect(first.map((feature) => feature.id)).toEqual(second.map((feature) => feature.id));
    expect(first.some((feature) => feature.id === selectedId)).toBe(true);
    expect(first).toContainEqual(expect.objectContaining({ id: features[0]!.id }));
  });

  it("refines boundary-shard records by feature bounds before applying the dense cap", () => {
    const inViewport = { ...realRestaurant, id: "citywide:in-viewport", coordinates: [-73.99, 40.748] as Feature["coordinates"], geometry: { type: "Point" as const, coordinates: [-73.99, 40.748] as Feature["coordinates"] } };
    const outsideViewport = { ...realRestaurant, id: "citywide:outside-viewport", coordinates: [-73.8, 40.9] as Feature["coordinates"], geometry: { type: "Point" as const, coordinates: [-73.8, 40.9] as Feature["coordinates"] } };
    const bounds = { west: -74.01, east: -73.98, south: 40.73, north: 40.76 };
    expect(denseFeatureIntersectsBounds(inViewport, bounds)).toBe(true);
    expect(denseFeatureIntersectsBounds(outsideViewport, bounds)).toBe(false);
    expect(selectDenseFeatures([inViewport, outsideViewport], { longitude: -73.99, latitude: 40.748 }, 6_000, null, bounds).map((feature) => feature.id)).toEqual(["citywide:in-viewport"]);
  });

  it("owns one deterministic focus flight per request across repeated dense updates", () => {
    const feature = { ...realRestaurant, id: "citywide:focus-target", coordinates: [-73.99, 40.748] as Feature["coordinates"] };
    expect(focusPoseForFeature(feature)).toEqual({ longitude: -73.99, latitude: 40.748, height: 240, heading: 0, pitch: -35, roll: 0 });
    expect(shouldStartFocusFlight(0, 1, true)).toBe(true);
    // The load/render effect may rerun for every dense shard refresh, but the
    // request has already claimed its flight and must not start another one.
    expect(shouldStartFocusFlight(1, 1, true)).toBe(false);
    expect(shouldStartFocusFlight(1, 1, true)).toBe(false);
    expect(shouldStartFocusFlight(1, 2, true)).toBe(true);
    expect(shouldStartFocusFlight(2, 3, false)).toBe(false);
  });

  it("serializes an upright requested focus pose when Cesium reports local-frame roll 180", () => {
    const actual = { longitude: -74, latitude: 40.7, height: 240, heading: 0, pitch: -35, roll: 180 };
    const requested = { longitude: -74, latitude: 40.7, height: 240, heading: 0, pitch: -35, roll: 0 };
    expect(normalizeFocusCameraPose(actual, requested)).toEqual(requested);
  });
});
