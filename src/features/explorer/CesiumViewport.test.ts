import { describe, expect, it } from "vitest";
import { CameraEventType, KeyboardEventModifier } from "cesium";
import restaurants from "../../../public/data/real-wave-20260804/restaurants.json";
import exteriorRelease from "../../../public/data/manhattan-esb-block-exterior-pilot-20260805/release.json";
import { runtimeFixtureFeatures } from "../../domain/features";
import type { Feature } from "../../domain/schema";
import type { CityAssetResolver } from "../../runtime/city-asset-manifest";
import { LocalFixtureCityAdapter } from "../../runtime/fixture-adapter";
import { DEFAULT_LAYER_VISIBILITY } from "../../runtime/layers";
import { emitCameraSettledAfterNextFrame, STAGE3_RENDER_PROOF_ATTRIBUTE, STAGE3_STOREFRONT_PROJECTIONS_ATTRIBUTE, buildCollisionCheckedFeatureMap, canonicalPickId, clearStorefrontProjectionRecords, collectStage3RenderProof, collectStorefrontProjectionRecords, commercialStorefrontProxyId, denseFeatureIntersectsBounds, densePoiMarkerStyle, applyDenseSuppressionDelta, denseAppliedSuppressionSet, denseRenderPlanDelta, denseRenderPlanDeltaSize, denseRenderPlanKey, emptyDenseInstanceIndex, drillPickedEntityId, featureForPickedId, fixtureOnlyForFeature, focusCameraCoordinatesForFeature, focusCoordinatesForFeature, focusHeightForFeature, focusPoseForFeature, focusPoseForFeatureWithOcclusion, medianFrameInterval, nativeCameraControlBindings, normalizeFocusCameraPose, poiRenderMode, publicRealmAssetEntityId, publicRealmProxyId, publicRealmRepresentative, publishStage3RenderProof, publishStorefrontProjectionRecords, selectDenseFeatureGroups, selectDenseFeatures, shouldApplyCameraPoseRequest, shouldFocusFeature, shouldReplaceDenseRenderPlan, shouldShowFeatureLabel, shouldStartFocusFlight, stage3StorefrontProofRequested, storefrontProjectionCameraSignature, supportedVisibleLayers, canonicalExteriorPickId, exteriorCellEntityId, exteriorCellSignature, exteriorOverlayRenderEntries, exteriorUnanchoredNotice, planExteriorOverlayUpdate, type ExteriorCellOverlay } from "./CesiumViewport";
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

  /**
   * The other half of the T004 viability fix.
   *
   * The adapter now hands back reference-identical features when the resident
   * shard set is unchanged. That only reaches the renderer if selection keeps
   * the identities: `shouldReplaceDenseRenderPlan` returning false here IS the
   * branch that increments `planReuseCount` instead of rebuilding 45,194
   * instances, so a selection that copied its features would silently undo the
   * fix.
   */
  it("keeps dense selection element-identical for a retained feature sequence, so an unchanged shard set reuses the plan", () => {
    const features = Array.from({ length: 2_000 }, (_, index) => ({
      ...realRestaurant,
      id: `citywide:poi:${String(index).padStart(5, "0")}`,
      coordinates: [-73.99 + index * 0.000001, 40.748 + index * 0.000001] as Feature["coordinates"],
      geometry: { type: "Point" as const, coordinates: [-73.99 + index * 0.000001, 40.748 + index * 0.000001] as Feature["coordinates"] },
    }));
    const bounds = { west: -74.01, east: -73.98, south: 40.73, north: 40.76 };
    // Two settled camera positions over the same retained sequence.
    const first = selectDenseFeatures(features, { longitude: -73.99, latitude: 40.748 }, 57_547, null, bounds);
    const second = selectDenseFeatures(features, { longitude: -73.9902, latitude: 40.7481 }, 57_547, null, bounds);
    expect(first).toHaveLength(features.length);
    expect(second.every((feature, index) => feature === first[index])).toBe(true);
    expect(shouldReplaceDenseRenderPlan(first, second)).toBe(false);
  });

  /**
   * T005: the transition artifact, isolated from the browser.
   *
   * A detail radius crossing removes ONE building from the dense pass — the
   * V3 overlay takes over drawing it. This is the deterministic half of the
   * measurement in ADR 0044 §3.2: it pins the *mechanism* exactly (one element
   * of 45,154 is enough), while the browser capture measures what that costs.
   *
   * The test is written to fail if the compare is ever weakened to a length
   * check or a fingerprint, because both would silently retain stale geometry.
   */
  it("rebuilds the whole dense plan when exactly one of 45,154 features changes", () => {
    const island = Array.from({ length: 45_154 }, (_, index) => ({
      ...realRestaurant,
      id: `doitt:${String(index).padStart(7, "0")}`,
    }));
    // The V3 overlay takes over one building: the dense pass sees the same
    // array minus one element, in the same order.
    const oneLeft = [...island.slice(0, 22_000), ...island.slice(22_001)];
    expect(oneLeft).toHaveLength(island.length - 1);
    expect(shouldReplaceDenseRenderPlan(island, oneLeft)).toBe(true);

    // And a same-length change is caught too, so the trigger is not merely the
    // length: substituting one element for a DIFFERENT OBJECT with identical
    // content still rebuilds, because the compare is by reference.
    const oneSwapped = island.map((feature, index) => (index === 22_000 ? { ...feature } : feature));
    expect(oneSwapped).toHaveLength(island.length);
    expect(oneSwapped[22_000]).toEqual(island[22_000]);
    expect(oneSwapped[22_000]).not.toBe(island[22_000]);
    expect(shouldReplaceDenseRenderPlan(island, oneSwapped)).toBe(true);

    // The counterfactual that makes the two assertions above mean something:
    // the identical array does NOT rebuild, so the trigger really is the
    // one-element difference and not "any call rebuilds".
    expect(shouldReplaceDenseRenderPlan(island, island)).toBe(false);
  });

  /**
   * T006 D-2 (A1): the show-attribute suppression path, and its trigger taxonomy.
   *
   * The test above pins what a MEMBERSHIP change costs and is deliberately left
   * unchanged — the frozen thrash and reuse baselines were measured against
   * that compare. What changes is which quantity the compare is fed. The layer
   * is now built over the membership and hides what it does not own, so an
   * OWNERSHIP change (a V3 cell arriving or being evicted) leaves the
   * membership reference-identical and resolves as `show` writes.
   *
   * Written to fail if anyone ever routes an ownership change back through the
   * rebuild trigger, because that silently restores the multi-second
   * double-draw ADR 0044 §4.1 measured.
   */
  it("resolves a V3 ownership change as show flips, and still rebuilds when membership moves", () => {
    const island = Array.from({ length: 45_154 }, (_, index) => ({
      ...realRestaurant,
      id: `doitt:${String(index).padStart(7, "0")}`,
    }));
    // The V3 overlay takes over ONE building. The membership — every base
    // feature the camera admits — is the same array, element for element.
    const before = new Set<string>();
    const after = new Set<string>(["doitt:0022000"]);
    expect(shouldReplaceDenseRenderPlan(island, island)).toBe(false);
    const takeover = denseRenderPlanDelta(before, after);
    expect(takeover).toEqual({ added: [], removed: ["doitt:0022000"] });
    expect(denseRenderPlanDeltaSize(takeover)).toBe(1);

    // And the reverse — the cell is evicted, the extrusion comes back — is the
    // same single write in the other direction. Before this path existed the
    // return direction could not be expressed at all: the instance was absent
    // from the built layer, so only a rebuild could restore it.
    const handback = denseRenderPlanDelta(after, before);
    expect(handback).toEqual({ added: ["doitt:0022000"], removed: [] });

    // An unchanged ownership set is not an update: zero writes, and the
    // caller's reuse branch stays a reuse.
    expect(denseRenderPlanDeltaSize(denseRenderPlanDelta(after, new Set(after)))).toBe(0);

    // The counterfactual that makes the above mean something: a MEMBERSHIP
    // change is still a rebuild, by the same reference compare as before.
    const oneLeft = [...island.slice(0, 22_000), ...island.slice(22_001)];
    expect(shouldReplaceDenseRenderPlan(island, oneLeft)).toBe(true);
  });

  /**
   * T006 B1/B2: the commit gate's highest-risk logic, which shipped with no
   * automated coverage at all.
   *
   * A synthetic `featureId -> Primitive` index stands in for the live layer.
   * Cesium's real `Primitive` is not constructible without a GPU context, but
   * everything under test here is the bookkeeping around the write — which id
   * is written, whether the write landed, and what the caller then records —
   * and that is exactly what a fake exercises honestly.
   */
  const fakeIndex = (ids: readonly string[], options: { ready?: boolean; withShow?: boolean } = {}) => {
    const index = emptyDenseInstanceIndex();
    const state = new Map<string, { show: Uint8Array }>();
    for (const id of ids) {
      const attributes = { show: new Uint8Array([1]) };
      state.set(id, attributes);
      index.buildings.set(id, {
        ready: options.ready ?? true,
        getGeometryInstanceAttributes: () => (options.withShow === false ? {} : attributes),
      } as unknown as Parameters<typeof applyDenseSuppressionDelta>[0]["buildings"] extends Map<string, infer P> ? P : never);
    }
    return { index, shown: (id: string) => state.get(id)!.show[0] === 1 };
  };

  it("flips show, counter-flips it back, and returns the hidden count to zero", () => {
    const { index, shown } = fakeIndex(["doitt:a", "doitt:b", "doitt:c"]);
    // A V3 cell goes live over two of the three buildings.
    const forward = applyDenseSuppressionDelta(index, denseRenderPlanDelta(new Set(), new Set(["doitt:a", "doitt:b"])));
    expect(forward.flips).toBe(2);
    expect(forward.hiddenBuildingChange).toBe(2);
    expect(forward.skipped).toEqual([]);
    expect(shown("doitt:a")).toBe(false);
    expect(shown("doitt:b")).toBe(false);
    expect(shown("doitt:c")).toBe(true);

    // The cell is evicted. The instances are still there, so the extrusions
    // come back — the direction that could not be expressed at all before the
    // layer was built over its membership.
    const back = applyDenseSuppressionDelta(index, denseRenderPlanDelta(new Set(["doitt:a", "doitt:b"]), new Set()));
    expect(back.flips).toBe(2);
    // The counts return to zero. A sign error here would leak one hidden
    // instance per crossing into `buildingFeatureCount`, forever.
    expect(forward.hiddenBuildingChange + back.hiddenBuildingChange).toBe(0);
    expect(shown("doitt:a")).toBe(true);
    expect(shown("doitt:b")).toBe(true);
  });

  /**
   * B2. A write can be skipped — the primitive is not ready, the batch table
   * has no `show`, or the id is not in the index at all. Recording it as
   * applied anyway is a three-way corruption: the id is never retried, the
   * reverse delta un-flips an instance that was never flipped, and the hidden
   * count drifts by one per skipped write for the life of the layer.
   *
   * PRE-FIX DEMONSTRATION, stated as what THIS test can observe: stubbing
   * `denseAppliedSuppressionSet` to `return nextSuppressedIds` — the pre-fix
   * behaviour, and a pure function this test calls directly — fails the
   * assertions below; the applied set claims `doitt:a` is suppressed and the
   * follow-up delta is empty instead of retrying it. Demonstrated, observed as
   * `expected [ 'doitt:a' ] to deeply equal []`.
   *
   * The matching production line is
   * `denseAppliedSuppressedIdsRef.current = denseAppliedSuppressionSet(...)`
   * inside the React component. Reverting THAT line is not detectable here:
   * this file renders nothing. It is covered only in the sense that the
   * function it calls is covered.
   */
  it("does not record a write that never landed, so the id is retried instead of corrupting the next delta", () => {
    const notReady = fakeIndex(["doitt:a"], { ready: false });
    const intended = new Set(["doitt:a"]);
    const result = applyDenseSuppressionDelta(notReady.index, denseRenderPlanDelta(new Set(), intended));
    expect(result.flips).toBe(0);
    expect(result.skipped).toEqual(["doitt:a"]);
    // Nothing was drawn differently, so nothing may be recorded.
    expect(notReady.shown("doitt:a")).toBe(true);
    const applied = denseAppliedSuppressionSet(new Set(), intended, result.skipped);
    expect([...applied]).toEqual([]);
    // And because the record did not advance, the NEXT pass still sees work to
    // do rather than a no-op diff against a state that never existed.
    expect(denseRenderPlanDeltaSize(denseRenderPlanDelta(applied, intended))).toBe(1);

    // A missing batch-table attribute is the same class of skip.
    const noShow = fakeIndex(["doitt:b"], { withShow: false });
    const missing = applyDenseSuppressionDelta(noShow.index, denseRenderPlanDelta(new Set(), new Set(["doitt:b"])));
    expect(missing.skipped).toEqual(["doitt:b"]);
    expect(missing.hiddenBuildingChange).toBe(0);
    // An id outside the current membership writes nothing and is not counted.
    const absent = applyDenseSuppressionDelta(emptyDenseInstanceIndex(), denseRenderPlanDelta(new Set(), new Set(["doitt:z"])));
    expect(absent.skipped).toEqual(["doitt:z"]);
    expect(denseAppliedSuppressionSet(new Set(), new Set(["doitt:z"]), absent.skipped).size).toBe(0);
    // The no-skip path returns the intended set BY REFERENCE, so the common
    // case allocates nothing.
    const clean = new Set(["doitt:q"]);
    expect(denseAppliedSuppressionSet(new Set(), clean, [])).toBe(clean);
  });

  /**
   * B1(ii): the mid-build reconciliation at the commit gate.
   *
   * Instances are created with the ownership set captured at BUILD START, but
   * a V3 cell can go live while the build is still running. The commit
   * reconciles the difference as flips — never as another build, because the
   * instances are already correct. This models that sequence exactly.
   *
   * WHAT THIS TEST DOES NOT COVER, stated plainly: **no production line is
   * under test here.** The sequence below is assembled by the test itself out
   * of the same pure functions the commit gate calls, so it pins the
   * pure-function CONTRACT — that reconciling built-set against desired-set
   * yields the desired `show` states and a hidden count matching the desired
   * set — and nothing about whether the component actually performs that
   * reconciliation. Deleting the commit-path call would not fail this file.
   *
   * The demonstration that was run (replacing the reconciliation step below
   * with a no-op, observed as `expected +0 to be 2`) shows the assertions are
   * load-bearing, not that any wiring is guarded.
   *
   * The unguarded wiring is `applyDenseOwnership` (defined at
   * `CesiumViewport.tsx:2044`) and its two call sites — the commit-path
   * reconciliation at `:2132` and the settled-camera flip at `:2144`. Closing
   * it needs the React harness carried as ADR 0044 D-6; the gap is recorded as
   * ADR 0045 D-17.
   */
  it("reconciles an ownership change that arrived while the build was running", () => {
    const membership = ["doitt:a", "doitt:b", "doitt:c", "doitt:d"];
    // Build start: a and b are owned by the V3 overlay, so their instances are
    // created hidden.
    const builtSuppressed = new Set(["doitt:a", "doitt:b"]);
    const { index, shown } = fakeIndex(membership);
    applyDenseSuppressionDelta(index, denseRenderPlanDelta(new Set(), builtSuppressed));
    let hidden = 2;

    // Mid-build: a's cell was evicted and c's cell went live. Membership never
    // moved, so this must NOT become another build.
    const desired = new Set(["doitt:b", "doitt:c"]);
    const reconciliation = applyDenseSuppressionDelta(index, denseRenderPlanDelta(builtSuppressed, desired));
    hidden += reconciliation.hiddenBuildingChange;

    expect(reconciliation.flips).toBe(2);
    expect(shown("doitt:a")).toBe(true);
    expect(shown("doitt:b")).toBe(false);
    expect(shown("doitt:c")).toBe(false);
    expect(shown("doitt:d")).toBe(true);
    // The hidden count tracks the DESIRED set, not the built one.
    expect(hidden).toBe(desired.size);
    expect(denseAppliedSuppressionSet(builtSuppressed, desired, reconciliation.skipped)).toBe(desired);
    // And the drawn count reconciles with what was allocated: four instances
    // built, two hidden, two drawn.
    expect(membership.length - hidden).toBe(2);
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

/**
 * Defect D-18: the settled-camera emit after a pose request ran BEFORE any frame
 * had been drawn at the new camera.
 *
 * The emit builds the ground footprint the residency scheduler culls on, from
 * nine globe pick-rays that read the last RENDERED scene. Synchronously after a
 * pose change there is no such frame yet, so a deep link or a landing pose
 * published the footprint of wherever the camera used to be — and the scheduler
 * then admitted the cells around the OLD position while deferring the ones the
 * user was looking at. Harmless while the residency cap does not bind, and
 * severe at the 8-cell cap a full-city serving composition needs.
 */
describe("camera-settled emit after a pose request (D-18)", () => {
  function fakeScene() {
    const listeners = new Set<() => void>();
    return {
      scene: {
        postRender: {
          addEventListener: (listener: () => void) => { listeners.add(listener); },
          removeEventListener: (listener: () => void) => { listeners.delete(listener); },
        },
      },
      frame: () => { for (const listener of [...listeners]) listener(); },
      listenerCount: () => listeners.size,
    };
  }

  it("does not emit until a frame has been rendered, and then emits exactly once", () => {
    const { scene, frame, listenerCount } = fakeScene();
    let dispatchCount = 0;
    emitCameraSettledAfterNextFrame(scene, () => { dispatchCount += 1; });

    // The defect, stated as an assertion: nothing is dispatched synchronously.
    expect(dispatchCount).toBe(0);

    frame();
    // The landing-loop regression instrument. One pose request must produce
    // exactly one settled-camera dispatch: zero would strand the scheduler on a
    // stale footprint, and more than one would re-enter reconciliation on every
    // subsequent frame.
    expect(dispatchCount).toBe(1);

    // Repeated frames must not re-emit, and the listener must be gone.
    frame();
    frame();
    expect(dispatchCount).toBe(1);
    expect(listenerCount()).toBe(0);
  });

  it("emits nothing when disposed before the first frame", () => {
    const { scene, frame, listenerCount } = fakeScene();
    let dispatchCount = 0;
    const dispose = emitCameraSettledAfterNextFrame(scene, () => { dispatchCount += 1; });
    dispose();
    expect(listenerCount()).toBe(0);
    frame();
    expect(dispatchCount).toBe(0);
  });

  it("is inert when disposed after it has already emitted", () => {
    const { scene, frame } = fakeScene();
    let dispatchCount = 0;
    const dispose = emitCameraSettledAfterNextFrame(scene, () => { dispatchCount += 1; });
    frame();
    dispose();
    frame();
    expect(dispatchCount).toBe(1);
  });

  it("keeps each pose request's dispatch independent", () => {
    // Two requests in one session are two schedulers, and the second must not be
    // satisfied by the first one's frame.
    const { scene, frame } = fakeScene();
    const dispatched: string[] = [];
    emitCameraSettledAfterNextFrame(scene, () => dispatched.push("first"));
    frame();
    emitCameraSettledAfterNextFrame(scene, () => dispatched.push("second"));
    frame();
    expect(dispatched).toEqual(["first", "second"]);
  });
});
