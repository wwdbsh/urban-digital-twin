import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runtimeFixtureFeatures } from "../../src/domain/features";
import { assetModelUriForFeature, denseFeatureRenderMode, modelGraphicsForFeature } from "../features/explorer/CesiumViewport";
import manifestJson from "../../public/assets/landmarks/landmark-wave-20260804/manifest.json";
import { assembleCityAssetPackage, replayCityAssetPackage } from "./asset-package";
import { CityAssetResolver, validateCityAssetManifest, type CityAssetManifest } from "./city-asset-manifest";

const assetRoot = "public/assets/landmarks/landmark-wave-20260804";
const manifest = manifestJson as unknown as CityAssetManifest;

describe("bounded landmark GLB package", () => {
  it("validates three approved landmarks with two LODs and no Penn Station identity", () => {
    const validation = validateCityAssetManifest(manifest);
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    expect(validation.value.assets).toHaveLength(3);
    expect(validation.value.assets.every((asset) => asset.lodVariants.length === 2)).toBe(true);
    expect(validation.value.assets.some((asset) => asset.canonicalFeatureId.endsWith(":254344"))).toBe(false);
    expect(validation.value.assets.find((asset) => asset.canonicalFeatureId.endsWith(":507159"))?.bounds.max[2]).toBeCloseTo(91.528389, 5);
    expect(validation.value.assets.flatMap((asset) => asset.lineage.licenseRefIds).some((id) => id.includes("commons"))).toBe(false);
  });

  it("replays every immutable GLB checksum and byte size", async () => {
    const assembled = assembleCityAssetPackage([manifest], { packageId: "manhattan-landmark-assets-20260804", generatedAt: "2026-08-04T12:50:00Z", fixtureOnly: false });
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;
    const contents = new Map(assembled.value.expectedContentRefs.map((ref) => [ref, { bytes: readFileSync(`${assetRoot}/${ref.split("/").at(-1)}`) }]));
    const replay = await replayCityAssetPackage(assembled.value, contents);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.state).toBe("replayed");
    expect(replay.value.verifiedContentRefs).toHaveLength(6);
    expect(replay.value.missingContentRefs).toHaveLength(0);
  });

  it("routes a verified real landmark to a Cesium Model URI while an ordinary building stays procedural", () => {
    const validation = validateCityAssetManifest(manifest);
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    const verifiedRefs = new Set(validation.value.assets.flatMap((asset) => asset.lodVariants.map((lod) => lod.content.relativeContentRef)));
    const resolver = new CityAssetResolver(validation.value, { verifiedContentRefs: verifiedRefs });
    const ordinaryBuilding = runtimeFixtureFeatures.find((feature) => feature.kind === "building");
    expect(ordinaryBuilding).toBeDefined();
    if (!ordinaryBuilding) return;
    const realLandmark = { ...ordinaryBuilding, id: validation.value.assets[0]!.canonicalFeatureId };

    expect(denseFeatureRenderMode(realLandmark, resolver, 240)).toBe("asset-model");
    expect(assetModelUriForFeature(realLandmark, resolver, 240)).toMatch(/^\/assets\/landmarks\/landmark-wave-20260804\/.*\.glb$/);
    const model = modelGraphicsForFeature(realLandmark, resolver, 240);
    expect(model).not.toBeNull();
    expect(model?.uri?.getValue()).toBe(assetModelUriForFeature(realLandmark, resolver, 240));
    expect(denseFeatureRenderMode(ordinaryBuilding, resolver, 240)).toBe("procedural-massing");
    expect(assetModelUriForFeature(ordinaryBuilding, resolver, 240)).toBeNull();
    expect(modelGraphicsForFeature(ordinaryBuilding, resolver, 240)).toBeNull();
  });
});
