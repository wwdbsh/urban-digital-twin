import { describe, expect, it } from "vitest";
import releaseJson from "../../public/data/manhattan-esb-block-exterior-pilot-20260805/release.json";
import { BLOCK_835_DOITT_IDS } from "../domain/commercial-frontage";
import { validateExteriorPilotRelease } from "./exterior-pilot-release";

describe("Stage 3 exterior asset package", () => {
  it("keeps every canonical building at two clean, bounded LODs", () => {
    const validation = validateExteriorPilotRelease(releaseJson);
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    const assets = validation.value.assets.assets;
    expect(assets.map((asset) => asset.canonicalFeatureId.replace(/^doitt:/u, ""))).toEqual([...BLOCK_835_DOITT_IDS]);
    expect(assets).toHaveLength(14);
    for (const asset of assets) {
      expect(asset.lodVariants.map((lod) => lod.id)).toEqual(["lod0", "lod1"]);
      expect(asset.bounds.min[2]).toBeGreaterThanOrEqual(-0.1);
      expect(asset.bounds.max[2]).toBeGreaterThan(asset.bounds.min[2]);
      expect(asset.quality.textureCount).toBe(0);
      expect(asset.lodVariants.every((lod) => (lod.content as typeof lod.content & { textureCount?: number }).textureCount === 0 && lod.content.contentStatus === "verified")).toBe(true);
    }
    expect(validation.value.assetEntries).toHaveLength(28);
    expect(new Set(validation.value.assetEntries.map((entry) => entry.sha256)).size).toBe(28);
  });
});
