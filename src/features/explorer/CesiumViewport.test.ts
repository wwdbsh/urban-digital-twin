import { describe, expect, it } from "vitest";
import restaurants from "../../../public/data/real-wave-20260804/restaurants.json";
import { runtimeFixtureFeatures } from "../../domain/features";
import type { Feature } from "../../domain/schema";
import type { CityAssetResolver } from "../../runtime/city-asset-manifest";
import { buildCollisionCheckedFeatureMap, canonicalPickId, commercialStorefrontProxyId, denseFeatureIntersectsBounds, densePoiMarkerStyle, featureForPickedId, fixtureOnlyForFeature, focusCameraCoordinatesForFeature, focusCoordinatesForFeature, focusHeightForFeature, focusPoseForFeature, focusPoseForFeatureWithOcclusion, medianFrameInterval, normalizeFocusCameraPose, poiRenderMode, selectDenseFeatureGroups, selectDenseFeatures, shouldFocusFeature, shouldShowFeatureLabel, shouldStartFocusFlight } from "./CesiumViewport";

describe("Cesium POI render seam", () => {
  const realRestaurant = (restaurants as unknown as Feature[])[0]!;
  const fixturePoi = runtimeFixtureFeatures.find((feature) => feature.kind === "poi")!;

  it("keeps ordinary dense POIs in primitives and only selected POIs in a labeled entity", () => {
    expect(poiRenderMode(realRestaurant, true, false)).toBe("point-primitive");
    expect(poiRenderMode(realRestaurant, true, true)).toBe("selected-entity");
    expect(poiRenderMode(realRestaurant, false, false)).toBe("entity");
    expect(poiRenderMode(fixturePoi, true, false)).toBe("point-primitive");
  });

  it("uses a stable namespace for accepted commercial storefront proxies", () => {
    expect(commercialStorefrontProxyId("storefront:osm:node:1@2")).toBe("commercial-storefront:storefront:osm:node:1@2");
    expect(commercialStorefrontProxyId("storefront:osm:node:1@2")).toBe(commercialStorefrontProxyId("storefront:osm:node:1@2"));
  });

  it("keeps ordinary dense POI markers bounded while retaining a strong selected marker", () => {
    expect(densePoiMarkerStyle(false)).toEqual({ pixelSize: 5, outlineWidth: 0, color: "#4ce2e6", opacity: 0.78 });
    expect(densePoiMarkerStyle(true)).toEqual({ pixelSize: 20, outlineWidth: 3, color: "#ffdf6b", opacity: 1 });
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

  it("keeps independent 6,000 base and 128 context quotas with selected retention", () => {
    const baseFeatures = Array.from({ length: 6_001 }, (_, index) => ({ ...realRestaurant, id: `doitt:base:${index}`, kind: "building" as const, geometry: { type: "Point" as const, coordinates: [-73.99, 40.748] as Feature["coordinates"] }, coordinates: [-73.99, 40.748] as Feature["coordinates"] }));
    const contextFeatures = Array.from({ length: 130 }, (_, index) => ({ ...realRestaurant, id: `udt:manhattan:park:M${index}`, kind: "park" as const, geometry: { type: "Polygon" as const, coordinates: [[[-73.99, 40.748], [-73.989, 40.748], [-73.989, 40.749], [-73.99, 40.748]]] } as unknown as Feature["geometry"], coordinates: [-73.99, 40.748] as Feature["coordinates"] }));
    const groups = selectDenseFeatureGroups(baseFeatures, contextFeatures, { longitude: -73.99, latitude: 40.748 }, { base: 6_000, context: 128 }, contextFeatures.at(-1)!.id);
    expect(groups.base).toHaveLength(6_000);
    expect(groups.context.length).toBeLessThanOrEqual(129);
    expect(groups.context).toContainEqual(expect.objectContaining({ id: contextFeatures.at(-1)!.id }));
  });

  it("omits ambiguous IDs from the pick map instead of silently overwriting an owner", () => {
    const first = { ...realRestaurant, id: "shared:id" };
    const second = { ...realRestaurant, id: "shared:id", name: "Different owner" };
    expect(buildCollisionCheckedFeatureMap([first, second])).not.toHaveProperty("shared:id");
  });

  it("owns one deterministic focus flight per request across repeated dense updates", () => {
    const feature = { ...realRestaurant, id: "citywide:focus-target", coordinates: [-73.99, 40.748] as Feature["coordinates"] };
    expect(focusPoseForFeature(feature)).toEqual({ longitude: -73.99, latitude: 40.748, height: 240, heading: 35, pitch: -35, roll: 0 });
    expect(shouldStartFocusFlight(0, 1, true)).toBe(true);
    // The load/render effect may rerun for every dense shard refresh, but the
    // request has already claimed its flight and must not start another one.
    expect(shouldStartFocusFlight(1, 1, true)).toBe(false);
    expect(shouldStartFocusFlight(1, 1, true)).toBe(false);
    expect(shouldStartFocusFlight(1, 2, true)).toBe(true);
    expect(shouldStartFocusFlight(2, 3, false)).toBe(false);
  });

  it("frames a verified tall asset from outside its authored bounds and uses its WGS84 anchor", () => {
    const feature = { ...realRestaurant, id: "doitt:778052", kind: "building" as const, geometry: { type: "Polygon" as const, coordinates: [] }, coordinates: [-73.986, 40.7486] as Feature["coordinates"], geometryProvenance: { ...realRestaurant.geometryProvenance, height: { ...realRestaurant.geometryProvenance.height, valueMeters: 377.583 } } } as Feature;
    const resolver = { resolve: () => ({ kind: "asset" as const, featureId: feature.id, entry: { bounds: { min: [-58, -72, 0], max: [98, 41, 442.6] }, wgs84Anchor: { longitude: -73.9859858615, latitude: 40.7485827513, heightMeters: 0 } }, lod: {} }) } as unknown as Pick<CityAssetResolver, "resolve">;
    expect(focusHeightForFeature(feature, resolver)).toBeGreaterThan(442.6);
    expect(focusCoordinatesForFeature(feature, resolver)).toEqual([-73.9859858615, 40.7485827513]);
    const targetCoordinates = focusCoordinatesForFeature(feature, resolver);
    const cameraCoordinates = focusCameraCoordinatesForFeature(feature, focusHeightForFeature(feature, resolver), targetCoordinates);
    expect(cameraCoordinates[0]).toBeLessThan(targetCoordinates[0]);
    expect(cameraCoordinates[1]).toBeLessThan(targetCoordinates[1]);
    expect(focusPoseForFeatureWithOcclusion(feature, focusHeightForFeature(feature, resolver), undefined, cameraCoordinates).heading).toBe(35);
  });

  it("serializes an upright requested focus pose when Cesium reports local-frame roll 180", () => {
    const actual = { longitude: -74, latitude: 40.7, height: 240, heading: 0, pitch: -35, roll: 180 };
    const requested = { longitude: -74, latitude: 40.7, height: 240, heading: 0, pitch: -35, roll: 0 };
    expect(normalizeFocusCameraPose(actual, requested)).toEqual(requested);
  });

  it("resolves every Cesium part pick through its canonical parent ID", () => {
    const canonicalId = "udt:manhattan:lpc:LP-00006";
    const feature = { ...realRestaurant, id: canonicalId };
    const denseFeatureMap = new Map([[canonicalId, feature]]);
    const adapterCalls: string[] = [];
    const adapter = { getFeature: (id: string) => { adapterCalls.push(id); return undefined; } };

    expect(canonicalPickId(`${canonicalId}:part:0`)).toBe(canonicalId);
    expect(canonicalPickId(`${canonicalId}:part:1`)).toBe(canonicalId);
    expect(featureForPickedId(`${canonicalId}:part:1`, denseFeatureMap, adapter)).toBe(feature);
    expect(adapterCalls).toEqual([]);
  });

  it("uses the canonical ID for adapter fallback after a part pick", () => {
    const canonicalId = "udt:manhattan:lpc:LP-00007";
    const feature = { ...realRestaurant, id: canonicalId };
    const adapterCalls: string[] = [];
    const adapter = { getFeature: (id: string) => { adapterCalls.push(id); return id === canonicalId ? feature : undefined; } };

    expect(featureForPickedId(`${canonicalId}:part:2`, new Map(), adapter)).toBe(feature);
    expect(adapterCalls).toEqual([canonicalId]);
  });

  it("keeps locationless civic records selectable without a focus target", () => {
    const locationlessCivic = { ...realRestaurant, attributes: { ...realRestaurant.attributes, civicNoMarker: true } };
    const locatedCivic = { ...realRestaurant, attributes: { ...realRestaurant.attributes, civicNoMarker: false } };

    expect(shouldFocusFeature(locationlessCivic)).toBe(false);
    expect(shouldFocusFeature(locatedCivic)).toBe(true);
    expect(shouldFocusFeature(realRestaurant)).toBe(true);
    expect(shouldFocusFeature(null)).toBe(false);
  });

  it("shifts a focus destination away from the inspector occlusion", () => {
    const feature = { ...realRestaurant, id: "citywide:occluded-focus", coordinates: [-73.99, 40.748] as Feature["coordinates"] };
    const pose = focusPoseForFeatureWithOcclusion(feature, 240, { rightPx: 360, bottomPx: 0, viewportWidthPx: 1_200, viewportHeightPx: 700 });
    expect(pose.longitude).toBeGreaterThan(feature.coordinates[0]);
    expect(pose.latitude).toBe(feature.coordinates[1]);
  });

  it("suppresses dense and overview labels without suppressing the selected label", () => {
    expect(shouldShowFeatureLabel(realRestaurant, true, false, null)).toBe(false);
    expect(shouldShowFeatureLabel(realRestaurant, false, true, null)).toBe(false);
    expect(shouldShowFeatureLabel(realRestaurant, true, true, realRestaurant.id)).toBe(true);
    expect(shouldShowFeatureLabel(realRestaurant, false, false, realRestaurant.id)).toBe(true);
  });
});
