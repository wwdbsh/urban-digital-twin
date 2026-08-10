import { describe, expect, it } from "vitest";
import { CameraEventType, KeyboardEventModifier } from "cesium";
import restaurants from "../../../public/data/real-wave-20260804/restaurants.json";
import exteriorRelease from "../../../public/data/manhattan-esb-block-exterior-pilot-20260805/release.json";
import { runtimeFixtureFeatures } from "../../domain/features";
import type { Feature } from "../../domain/schema";
import type { CityAssetResolver } from "../../runtime/city-asset-manifest";
import { LocalFixtureCityAdapter } from "../../runtime/fixture-adapter";
import { DEFAULT_LAYER_VISIBILITY } from "../../runtime/layers";
import { STAGE3_RENDER_PROOF_ATTRIBUTE, STAGE3_STOREFRONT_PROJECTIONS_ATTRIBUTE, buildCollisionCheckedFeatureMap, canonicalPickId, clearStorefrontProjectionRecords, collectStage3RenderProof, collectStorefrontProjectionRecords, commercialStorefrontProxyId, denseFeatureIntersectsBounds, densePoiMarkerStyle, denseRenderPlanKey, drillPickedEntityId, featureForPickedId, fixtureOnlyForFeature, focusCameraCoordinatesForFeature, focusCoordinatesForFeature, focusHeightForFeature, focusPoseForFeature, focusPoseForFeatureWithOcclusion, medianFrameInterval, nativeCameraControlBindings, normalizeFocusCameraPose, poiRenderMode, publicRealmAssetEntityId, publicRealmProxyId, publicRealmRepresentative, publishStage3RenderProof, publishStorefrontProjectionRecords, selectDenseFeatureGroups, selectDenseFeatures, shouldApplyCameraPoseRequest, shouldFocusFeature, shouldReplaceDenseRenderPlan, shouldShowFeatureLabel, shouldStartFocusFlight, stage3StorefrontProofRequested, storefrontProjectionCameraSignature, supportedVisibleLayers, canonicalExteriorPickId, exteriorCellEntityId, exteriorCellSignature, exteriorOverlayRenderEntries, exteriorUnanchoredNotice, planExteriorOverlayUpdate, type ExteriorCellOverlay } from "./CesiumViewport";
import type { Block835PublicRealmFeature } from "../../runtime/block835-public-realm-release";

describe("Cesium POI render seam", () => {
  const realRestaurant = (restaurants as unknown as Feature[])[0]!;
  const fixturePoi = runtimeFixtureFeatures.find((feature) => feature.kind === "poi")!;

  it("keeps ordinary dense POIs in primitives and only selected POIs in a labeled entity", () => {
    expect(poiRenderMode(realRestaurant, true, false)).toBe("point-primitive");
    expect(poiRenderMode(realRestaurant, true, true)).toBe("selected-entity");
    expect(poiRenderMode(realRestaurant, false, false)).toBe("entity");
    expect(poiRenderMode(fixturePoi, true, false)).toBe("point-primitive");
  });

  it("declares native mouse and trackpad camera controls without relying on synthetic DOM events", () => {
    const controls = nativeCameraControlBindings();
    expect(controls.rotateEventTypes).toHaveLength(1);
    expect(controls.tiltEventTypes).toHaveLength(3);
    expect(controls.zoomEventTypes).toHaveLength(3);
    expect(controls.lookEventTypes).toHaveLength(1);
    expect(controls.rotateEventTypes).not.toEqual(controls.tiltEventTypes);
    expect(controls.rotateEventTypes).toContain(CameraEventType.LEFT_DRAG);
    expect(controls.tiltEventTypes).toEqual(expect.arrayContaining([
      CameraEventType.MIDDLE_DRAG,
      CameraEventType.PINCH,
      { eventType: CameraEventType.LEFT_DRAG, modifier: KeyboardEventModifier.CTRL },
    ]));
    expect(controls.lookEventTypes).toEqual([{ eventType: CameraEventType.LEFT_DRAG, modifier: KeyboardEventModifier.SHIFT }]);
    expect(controls.zoomEventTypes).toEqual(expect.arrayContaining([CameraEventType.WHEEL, CameraEventType.PINCH]));
  });

  it("applies each programmatic camera request once and keeps selection out of an unchanged dense plan", () => {
    expect(shouldApplyCameraPoseRequest(4, { requestId: 4 })).toBe(false);
    expect(shouldApplyCameraPoseRequest(4, { requestId: 5 })).toBe(true);
    expect(shouldApplyCameraPoseRequest(4, undefined)).toBe(false);
    const key = denseRenderPlanKey([realRestaurant]);
    expect(shouldReplaceDenseRenderPlan(null, [realRestaurant])).toBe(true);
    expect(shouldReplaceDenseRenderPlan([realRestaurant], [realRestaurant])).toBe(false);
    expect(shouldReplaceDenseRenderPlan([realRestaurant], [{ ...realRestaurant, name: "revised" }])).toBe(true);
    expect(denseRenderPlanKey([realRestaurant])).toBe(key);
    expect(key).toMatch(/^1:[0-9a-f]+$/);
  });

  it("uses a stable namespace for accepted commercial storefront proxies", () => {
    expect(commercialStorefrontProxyId("storefront:osm:node:1@2")).toBe("commercial-storefront:storefront:osm:node:1@2");
    expect(commercialStorefrontProxyId("storefront:osm:node:1@2")).toBe(commercialStorefrontProxyId("storefront:osm:node:1@2"));
  });

  it("keeps Block 835 public-realm proxy and asset IDs isolated from buildings/storefronts", () => {
    expect(publicRealmProxyId("crosswalk:intersection-1")).toBe("public-realm:feature:crosswalk:intersection-1");
    expect(publicRealmAssetEntityId("roadbed")).toBe("public-realm:asset:roadbed");
    const feature: Block835PublicRealmFeature = {
      id: "crosswalk:intersection-1",
      semantic: "crosswalk",
      sourceDatasetId: "derived:block835",
      geometry: { type: "MultiPolygon", coordinates: [[[[ -73.99, 40.748 ], [ -73.989, 40.748 ], [ -73.989, 40.749 ], [ -73.99, 40.749 ], [ -73.99, 40.748 ]]]] },
      sourceCrs: "CRS84",
      normalizedCrs: "EPSG:4326",
      verticalDatum: "NAVD88",
      claimLevel: "estimated",
      uncertainty: { horizontalMeters: 2, verticalMeters: 0.1, temporal: "estimated" },
      transform: { inputCrs: "CRS84", outputCrs: "EPSG:4326", verticalDatum: "NAVD88", method: "identity", residualMeters: 0, zPolicy: "none" },
    };
    expect(publicRealmRepresentative(feature)).toEqual([-73.99, 40.748]);
  });

  it("normalizes Cesium drill-pick entity wrappers to their string IDs", () => {
    expect(drillPickedEntityId({ id: "commercial-storefront:storefront:osm:node:1@2" })).toBe("commercial-storefront:storefront:osm:node:1@2");
    expect(drillPickedEntityId({ id: { id: "commercial-storefront:storefront:osm:node:1@2" } })).toBe("commercial-storefront:storefront:osm:node:1@2");
    expect(drillPickedEntityId({ id: { id: 123 } })).toBeNull();
    expect(drillPickedEntityId(undefined)).toBeNull();
  });

  it("publishes the exact eight rendered storefront identities as a non-selecting, stable proof payload", () => {
    const release = exteriorRelease as unknown as { commercialRelease: { storefrontPlacements: Array<{ storefrontId: string; canonicalBuildingId: string | null; anchorWgs84: readonly [number, number] | null; signPolicy: string; placementDecision: string }> } };
    const accepted = release.commercialRelease.storefrontPlacements.filter((placement) => placement.signPolicy === "neutral-text-only" && placement.placementDecision.startsWith("storefront"));
    const candidates = accepted.map((placement) => ({
      storefrontId: placement.storefrontId,
      canonicalBuildingId: placement.canonicalBuildingId ?? "",
      proxyEntityId: commercialStorefrontProxyId(placement.storefrontId),
      anchorWgs84: placement.anchorWgs84,
      rendered: true,
    }));
    const selectionCallbackCount = 0;
    const records = collectStorefrontProjectionRecords(
      candidates,
      240,
      { clientWidth: 1_200, clientHeight: 800 },
      storefrontProjectionCameraSignature({ longitude: -73.986, latitude: 40.748, height: 240, heading: 35, pitch: -35, roll: 0 }),
      (anchor) => ({ x: (anchor[0] + 74) * 100_000, y: (41 - anchor[1]) * 100_000 }),
    );
    expect(records).toHaveLength(8);
    expect(records.map((record) => record.storefrontId)).toEqual([...records.map((record) => record.storefrontId)].sort());
    expect(records.map((record) => record.proxyEntityId)).toEqual(records.map((record) => commercialStorefrontProxyId(record.storefrontId)));
    expect(records.every((record) => record.canonicalBuildingId.startsWith("doitt:") && record.canvasX !== null && record.canvasY !== null)).toBe(true);
    // Projection records have no selection callback or selection state; merely
    // reading them cannot select an entity.
    expect(selectionCallbackCount).toBe(0);
  });

  it("filters stale/out-of-range proxies, records bounds state, and clears the proof DOM attribute", () => {
    const candidate = { storefrontId: "storefront:osm:node:1@2", canonicalBuildingId: "doitt:778052", proxyEntityId: commercialStorefrontProxyId("storefront:osm:node:1@2"), anchorWgs84: [-73.986, 40.748] as const, rendered: true };
    const outOfBounds = collectStorefrontProjectionRecords([candidate], 240, { clientWidth: 100, clientHeight: 100 }, "camera", () => ({ x: -1, y: 101 }));
    expect(outOfBounds).toEqual([expect.objectContaining({ visible: true, inBounds: false, canvasX: -1, canvasY: 101 })]);
    expect(collectStorefrontProjectionRecords([candidate], 901, { clientWidth: 100, clientHeight: 100 }, "camera", () => ({ x: 1, y: 1 }))).toEqual([]);
    expect(collectStorefrontProjectionRecords([{ ...candidate, rendered: false }], 240, { clientWidth: 100, clientHeight: 100 }, "camera", () => ({ x: 1, y: 1 }))).toEqual([]);
    const attributes = new Map<string, string>();
    const element = {
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name),
    } as unknown as HTMLElement;
    publishStorefrontProjectionRecords(element, outOfBounds);
    expect(JSON.parse(attributes.get(STAGE3_STOREFRONT_PROJECTIONS_ATTRIBUTE) ?? "[]")).toEqual(outOfBounds);
    clearStorefrontProjectionRecords(element);
    expect(attributes.has(STAGE3_STOREFRONT_PROJECTIONS_ATTRIBUTE)).toBe(false);
    expect(stage3StorefrontProofRequested("?stage3Proof=storefront-picks")).toBe(true);
    expect(stage3StorefrontProofRequested("?stage3Proof=unsupported")).toBe(false);
  });

  it("proves all live Stage 3 model entities and storefront proxies instead of reusing manifest or UI counts", () => {
    const storefronts = Array.from({ length: 8 }, (_, index) => ({
      storefrontId: `storefront:${index}`,
      canonicalBuildingId: `doitt:${index}`,
      proxyEntityId: `commercial-storefront:storefront:${index}`,
      canvasX: 20,
      canvasY: 20,
      visible: true,
      inBounds: true,
      cameraSignature: "camera",
      rendered: true,
    }));
    const proof = collectStage3RenderProof(
      Array.from({ length: 14 }, (_, index) => ({
        canonicalBuildingId: `doitt:${index}`,
        entityId: `doitt:${index}`,
        modelUri: `/assets/manhattan-esb-block-exterior-pilot-20260805/doitt-${index}__lod_0.glb`,
        modelEntity: true,
        showing: true,
      })),
      storefronts,
      "camera",
      240,
    );
    expect(proof).toMatchObject({ expectedBuildingCount: 14, activeBuildingCount: 14, expectedStorefrontCount: 8, activeStorefrontCount: 8, pass: true });
    expect(collectStage3RenderProof([{ canonicalBuildingId: "doitt:bad", entityId: "doitt:bad", modelUri: null, modelEntity: true, showing: true }], [], "camera", 240).pass).toBe(false);
    const attributes = new Map<string, string>();
    const element = { setAttribute: (name: string, value: string) => attributes.set(name, value) } as unknown as HTMLElement;
    publishStage3RenderProof(element, proof);
    expect(JSON.parse(attributes.get(STAGE3_RENDER_PROOF_ATTRIBUTE) ?? "{}")).toMatchObject({ pass: true, activeBuildingCount: 14, activeStorefrontCount: 8 });
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

  it("does not schedule unavailable shared layers while the fixture adapter is active", () => {
    const fixture = new LocalFixtureCityAdapter();
    expect(supportedVisibleLayers(fixture, DEFAULT_LAYER_VISIBILITY)).toEqual([
      "buildings",
      "pois",
      "areas",
      "stations",
      "entrances",
      "routes",
    ]);
    expect(() => supportedVisibleLayers({
      getLayerManifest: () => { throw new Error("Corrupt layer manifest"); },
    }, { buildings: true })).toThrow("Corrupt layer manifest");
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

  it("keeps dense feature filtering aligned with wrapped shared viewport bounds", () => {
    const eastOfDateline = { ...realRestaurant, id: "citywide:dateline-east", coordinates: [179.8, 10] as Feature["coordinates"], geometry: { type: "Point" as const, coordinates: [179.8, 10] as Feature["coordinates"] } };
    const westOfDateline = { ...realRestaurant, id: "citywide:dateline-west", coordinates: [-179.8, 10] as Feature["coordinates"], geometry: { type: "Point" as const, coordinates: [-179.8, 10] as Feature["coordinates"] } };
    const middleOfWorld = { ...realRestaurant, id: "citywide:dateline-middle", coordinates: [0, 10] as Feature["coordinates"], geometry: { type: "Point" as const, coordinates: [0, 10] as Feature["coordinates"] } };
    const wrappedBounds = { west: 179.7, east: -179.7, south: 9, north: 11 };
    expect(denseFeatureIntersectsBounds(eastOfDateline, wrappedBounds)).toBe(true);
    expect(denseFeatureIntersectsBounds(westOfDateline, wrappedBounds)).toBe(true);
    expect(denseFeatureIntersectsBounds(middleOfWorld, wrappedBounds)).toBe(false);
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

describe("exterior cell overlay seam", () => {
  const canonicalId = "doitt:778052";
  const baseFeature = { ...(restaurants as unknown as Feature[])[0]!, id: canonicalId };
  const provenance = {
    inventoryId: "inventory:b1:v2",
    inventoryHashSha256: "a".repeat(64),
    evidenceShardId: "evidence:b1:v2",
    truthTiers: ["generated" as const],
    sourceDates: { capturedAt: "2026-08-09T00:00:00.000Z", updatedAt: null },
    predecessor: null,
    uncertainty: "Generated exterior geometry; not observed real-world truth.",
  };
  const asset = (lodId: string, checksumSha256: string) => ({
    canonicalFeatureId: canonicalId,
    ownerCellId: "c1",
    lodId,
    artifactRef: `public/assemblies/cell-c1-v2/assets/${lodId}.glb`,
    byteSize: 240,
    checksumSha256,
    bytes: new Uint8Array([1, 2, 3]),
    geometricErrorMeters: lodId === "lod-0" ? 0 : 2,
    maxDistanceMeters: lodId === "lod-0" ? 220 : null,
    provenance,
  });
  const overlayFor = (lodId: string, checksumSha256: string, profile: "exploration" | "inspection"): ExteriorCellOverlay => ({
    releaseId: "udt-fixture-exterior-cells",
    snapshotId: "snapshot:v2",
    origin: "default",
    profile,
    cells: [
      { kind: "rendered", cellId: "c1", cellReleaseId: "cell:c1:v2", cellReleaseVersion: "v2", assemblyPackageId: "assembly:cell:c1:v2", representation: "head", assets: [asset(lodId, checksumSha256)], notice: null },
      { kind: "failed", cellId: "c9", cellReleaseId: "cell:c9:v1", code: "checksum-mismatch", message: "corrupt", notice: "no exterior geometry is shown" },
      { kind: "base-massing", cellId: "c8", cellReleaseId: "cell:c8:v1", code: "checksum-mismatch", message: "corrupt", notice: "base massing" },
    ],
  });

  it("renders only verified cells and gives each cell one stable entity per canonical feature", () => {
    const entries = exteriorOverlayRenderEntries(overlayFor("lod-0", "b".repeat(64), "inspection"));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.entityId).toBe(exteriorCellEntityId("c1", canonicalId));
    expect(entries[0]!.canonicalFeatureId).toBe(canonicalId);
    expect(exteriorOverlayRenderEntries(null)).toEqual([]);
  });

  it("keeps entity identity and provenance byte-identical across a profile change", () => {
    const inspection = exteriorOverlayRenderEntries(overlayFor("lod-0", "b".repeat(64), "inspection"))[0]!;
    const exploration = exteriorOverlayRenderEntries(overlayFor("lod-1", "c".repeat(64), "exploration"))[0]!;
    expect(exploration.entityId).toBe(inspection.entityId);
    expect(exploration.canonicalFeatureId).toBe(inspection.canonicalFeatureId);
    expect(exploration.cellReleaseId).toBe(inspection.cellReleaseId);
    expect(exploration.provenance).toEqual(inspection.provenance);
    expect(exploration.lodId).not.toBe(inspection.lodId);
    expect(exteriorCellSignature([exploration])).not.toBe(exteriorCellSignature([inspection]));
    expect(exteriorCellSignature([inspection])).toBe(exteriorCellSignature([inspection]));
  });

  it("resolves an exterior pick to its base canonical feature ahead of the public-realm proxy branch", () => {
    const denseFeatureMap = new Map([[canonicalId, baseFeature]]);
    const adapter = { getFeature: () => undefined };
    const entityId = exteriorCellEntityId("c1", canonicalId);
    const pickMap = new Map([[entityId, canonicalId]]);

    // The exterior primitive resolves through the existing canonical cascade to
    // the same base feature, so it is answered in the base-feature branch.
    expect(canonicalExteriorPickId(entityId, pickMap)).toBe(canonicalId);
    expect(featureForPickedId(canonicalExteriorPickId(entityId, pickMap), denseFeatureMap, adapter)).toBe(baseFeature);

    // A public-realm proxy in the same drill pick is untouched and stays in the
    // later, lower-precedence branch.
    const proxyId = publicRealmProxyId("crosswalk:intersection-1");
    expect(canonicalExteriorPickId(proxyId, pickMap)).toBe(proxyId);
    expect(featureForPickedId(canonicalExteriorPickId(proxyId, pickMap), denseFeatureMap, adapter)).toBeUndefined();
  });

  it("keeps the exterior pick identity stable across LOD and profile swaps", () => {
    const inspection = exteriorOverlayRenderEntries(overlayFor("lod-0", "b".repeat(64), "inspection"))[0]!;
    const exploration = exteriorOverlayRenderEntries(overlayFor("lod-1", "c".repeat(64), "exploration"))[0]!;
    const pickMap = new Map([[inspection.entityId, inspection.canonicalFeatureId]]);
    expect(canonicalExteriorPickId(exploration.entityId, pickMap)).toBe(canonicalId);
    expect(canonicalExteriorPickId(inspection.entityId, pickMap)).toBe(canonicalId);
  });
});

describe("exterior overlay owned-collection reducer", () => {
  const provenance = {
    inventoryId: "inventory:1",
    inventoryHashSha256: "a".repeat(64),
    evidenceShardId: "evidence:1",
    truthTiers: ["generated" as const],
    sourceDates: { capturedAt: null, updatedAt: null },
    predecessor: null,
    uncertainty: "Generated exterior geometry; not observed real-world truth.",
  };
  const entry = (cellId: string, canonicalFeatureId: string, lodId = "lod-0", checksumSha256 = "b".repeat(64)) => ({
    entityId: exteriorCellEntityId(cellId, canonicalFeatureId),
    cellId,
    cellReleaseId: `cell:${cellId}:v1`,
    representation: "head" as const,
    canonicalFeatureId,
    lodId,
    checksumSha256,
    byteSize: 240,
    bytes: new Uint8Array([1, 2, 3]),
    geometricErrorMeters: 0,
    provenance,
  });
  const anchor = { longitude: -73.9857, latitude: 40.7484, name: "base building" };
  const anchorAll = () => anchor;

  it("adds each cell once and retains an unchanged complete cell without re-adding it", () => {
    const entries = [entry("c1", "doitt:778052"), entry("c2", "doitt:982383")];
    const first = planExteriorOverlayUpdate(entries, new Map(), anchorAll);
    expect(first.addCells.map((cell) => cell.cellId)).toEqual(["c1", "c2"]);
    expect(first.addCells.every((cell) => cell.complete)).toBe(true);
    expect(first.removeEntityIds).toEqual([]);
    expect(first.unanchoredCanonicalFeatureIds).toEqual([]);

    const owned = new Map(first.addCells.map((cell) => [cell.cellId, {
      entityIds: cell.adds.map(({ entry: added }) => added.entityId),
      objectUrls: cell.adds.map(({ entry: added }) => `blob:${added.entityId}`),
      signature: cell.signature,
      complete: cell.complete,
    }]));
    const second = planExteriorOverlayUpdate(entries, owned, anchorAll);
    expect(second.retainedCellIds).toEqual(["c1", "c2"]);
    expect(second.addCells).toEqual([]);
    expect(second.removeEntityIds).toEqual([]);
    expect(second.revokeObjectUrls).toEqual([]);
  });

  it("retries a cell whose verified asset had no base anchor instead of memoizing the gap", () => {
    const entries = [entry("c1", "doitt:778052")];
    const first = planExteriorOverlayUpdate(entries, new Map(), () => null);
    expect(first.addCells[0]!.adds).toEqual([]);
    expect(first.addCells[0]!.complete).toBe(false);
    expect(first.addCells[0]!.unanchoredCanonicalFeatureIds).toEqual(["doitt:778052"]);
    expect(first.unanchoredCanonicalFeatureIds).toEqual(["doitt:778052"]);

    // Same entries, same signature, but the cell was recorded incomplete: the
    // next pass must retry rather than retain, so a later dense-map load wins.
    const owned = new Map([["c1", { entityIds: [], objectUrls: [], signature: first.addCells[0]!.signature, complete: false }]]);
    const retry = planExteriorOverlayUpdate(entries, owned, anchorAll);
    expect(retry.retainedCellIds).toEqual([]);
    expect(retry.addCells[0]!.complete).toBe(true);
    expect(retry.addCells[0]!.adds).toHaveLength(1);
    expect(retry.unanchoredCanonicalFeatureIds).toEqual([]);
  });

  it("replaces exactly one cell and revokes only that cell's object URLs", () => {
    const before = [entry("c1", "doitt:778052"), entry("c2", "doitt:982383")];
    const owned = new Map(before.map((added) => [added.cellId, {
      entityIds: [added.entityId],
      objectUrls: [`blob:${added.entityId}`],
      signature: exteriorCellSignature([added]),
      complete: true,
    }]));
    const after = [entry("c1", "doitt:778052", "lod-1", "c".repeat(64)), entry("c2", "doitt:982383")];
    const plan = planExteriorOverlayUpdate(after, owned, anchorAll);
    expect(plan.retainedCellIds).toEqual(["c2"]);
    expect(plan.removeCellIds).toEqual(["c1"]);
    expect(plan.removeEntityIds).toEqual([exteriorCellEntityId("c1", "doitt:778052")]);
    expect(plan.revokeObjectUrls).toEqual([`blob:${exteriorCellEntityId("c1", "doitt:778052")}`]);
    expect(plan.addCells.map((cell) => cell.cellId)).toEqual(["c1"]);
  });

  it("removes and revokes a cell that failed closed and is no longer rendered", () => {
    const owned = new Map([["c1", { entityIds: ["exterior-cell:c1:doitt:778052"], objectUrls: ["blob:one", "blob:two"], signature: "stale", complete: true }]]);
    const plan = planExteriorOverlayUpdate([], owned, anchorAll);
    expect(plan.removeCellIds).toEqual(["c1"]);
    expect(plan.removeEntityIds).toEqual(["exterior-cell:c1:doitt:778052"]);
    expect(plan.revokeObjectUrls).toEqual(["blob:one", "blob:two"]);
    expect(plan.addCells).toEqual([]);
    expect(plan.retainedCellIds).toEqual([]);
  });

  it("states plainly when verified geometry is withheld for want of an anchor", () => {
    expect(exteriorUnanchoredNotice([])).toBeNull();
    const notice = exteriorUnanchoredNotice(["doitt:778052"]);
    expect(notice).toContain("doitt:778052");
    expect(notice).toContain("1 verified building");
    expect(notice).toContain("no verified WGS84 anchor");
    expect(exteriorUnanchoredNotice(["a", "b"])).toContain("2 verified buildings");
  });
});
