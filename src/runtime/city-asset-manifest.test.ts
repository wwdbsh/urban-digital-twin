import { describe, expect, it } from "vitest";
import { runtimeFixtureFeatures } from "../domain/features";
import { buildMetadataOnlyFixtureAssetManifest, CityAssetResolver, IDENTITY_MATRIX, validateCityAssetManifest } from "./city-asset-manifest";

const fixture = buildMetadataOnlyFixtureAssetManifest(runtimeFixtureFeatures.filter((feature) => feature.kind === "building"));

describe("city asset manifest contract", () => {
  it("validates metadata-only fixture lineage and keeps canonical identity", () => {
    expect(validateCityAssetManifest(fixture).ok).toBe(true);
    expect(fixture.assets[0]?.canonicalFeatureId).toBe(runtimeFixtureFeatures.find((feature) => feature.kind === "building")?.id);
  });

  it("fails closed for unsafe paths, duplicate refs, checksums, matrices, bounds and missing lineage", () => {
    const base = fixture.assets[0]!;
    const invalid = { ...fixture, assets: [{ ...base, lineage: { ...base.lineage, sourceRefIds: [] }, transform: { ...base.transform, matrix: [...IDENTITY_MATRIX.slice(0, 15), 0] }, bounds: { min: [1, 1, 1], max: [0, 0, 0] }, lodVariants: [{ ...base.lodVariants[0]!, content: { ...base.lodVariants[0]!.content, relativeContentRef: "../escape.glb", sha256: "bad" } }, { ...base.lodVariants[0]!, id: "duplicate", content: { ...base.lodVariants[0]!.content, relativeContentRef: base.lodVariants[0]!.content.relativeContentRef } }] }] };
    const result = validateCityAssetManifest(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((item) => item.message).join(" ")).toMatch(/Lineage|normalized|SHA-256|transform|Bounds|unique/);
  });

  it("selects deterministic LODs and falls back for missing, unapproved, and unverified content", () => {
    const resolver = new CityAssetResolver(fixture);
    const id = fixture.assets[0]!.canonicalFeatureId;
    expect(resolver.resolve(id, 10).kind).toBe("procedural-fallback");
    expect(resolver.resolve("missing", 10).kind).toBe("procedural-fallback");
    const production = { ...fixture, fixtureOnly: false, assets: fixture.assets.map((asset) => ({ ...asset, approval: { ...asset.approval, fixtureOnly: false, state: "approved" as const, scope: "runtime" as const } })) };
    expect(validateCityAssetManifest(production).ok).toBe(false);
  });

  it("does not confuse same source record IDs on different canonical features", () => {
    const first = fixture.assets[0]!;
    const second = { ...first, canonicalFeatureId: `${first.canonicalFeatureId}:other`, lodVariants: first.lodVariants.map((lod) => ({ ...lod, content: { ...lod.content, relativeContentRef: "fixtures/assets/other.glb" } })) };
    expect(validateCityAssetManifest({ ...fixture, assets: [first, second] }).ok).toBe(true);
  });
});
