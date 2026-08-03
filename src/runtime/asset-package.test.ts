import { describe, expect, it } from "vitest";
import { runtimeFixtureFeatures } from "../domain/features";
import { buildMetadataOnlyFixtureAssetManifest } from "./city-asset-manifest";
import { assembleCityAssetPackage, replayCityAssetPackage } from "./asset-package";

describe("deterministic local asset package", () => {
  it("assembles and replays metadata-only fixtures without creating binary output", async () => {
    const manifest = buildMetadataOnlyFixtureAssetManifest(runtimeFixtureFeatures.filter((feature) => feature.kind === "building"));
    const assembled = assembleCityAssetPackage([manifest], { packageId: "fixture-assets-v1", generatedAt: "2026-08-03T00:00:00Z", fixtureOnly: true });
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;
    const replay = await replayCityAssetPackage(assembled.value, new Map());
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.value.missingContentRefs.length).toBe(1);
  });

  it("refuses corrupt partial output and duplicate content refs", async () => {
    const first = buildMetadataOnlyFixtureAssetManifest(runtimeFixtureFeatures.filter((feature) => feature.kind === "building"));
    const duplicate = { ...first, manifestId: "fixture-assets-duplicate", assets: first.assets.map((asset) => ({ ...asset, canonicalFeatureId: `${asset.canonicalFeatureId}:duplicate` })) };
    const assembled = assembleCityAssetPackage([first, duplicate], { packageId: "fixture-assets-v1", generatedAt: "2026-08-03T00:00:00Z", fixtureOnly: true });
    expect(assembled.ok).toBe(false);
    const single = assembleCityAssetPackage([first], { packageId: "fixture-assets-v1", generatedAt: "2026-08-03T00:00:00Z", fixtureOnly: true });
    expect(single.ok).toBe(true);
    if (!single.ok) return;
    const ref = single.value.expectedContentRefs[0]!;
    const corrupted = await replayCityAssetPackage({ ...single.value, assets: single.value.assets.map((manifestValue) => ({ ...manifestValue, assets: manifestValue.assets.map((asset) => ({ ...asset, lodVariants: asset.lodVariants.map((lod) => ({ ...lod, content: { ...lod.content, contentStatus: "staged" as const, byteSize: 3 } })) })) })) }, new Map([[ref, { bytes: "bad" }]]));
    expect(corrupted.ok).toBe(false);
  });
});
