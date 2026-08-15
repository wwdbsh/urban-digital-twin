/**
 * DRIFT TEST for the shared-class-texture evidence (T002, ADR 0047).
 *
 * The committed campaign record is only worth committing if it stays the record
 * of what was measured. This suite re-derives every number ADR 0047 quotes from
 * the committed bytes themselves, so an edited record, a re-run that was not
 * re-recorded, or a re-emitted release breaks a test rather than quietly
 * becoming the new truth.
 *
 * It asserts nothing about a renderer. It asserts that the evidence and the
 * releases agree with each other and with the arithmetic.
 */
import { describe, expect, it } from "vitest";
import { predictedTextureByteLength, validateGpuTextureProbe } from "../features/explorer/gpu-texture-probe";
import { EXTERIOR_T1_RELEASE_IDS } from "./exterior-t1-variants";
import { PROCEDURAL_TEXTURE_CLASSES, proceduralTextureCatalog } from "./procedural-texture";
// The committed records are IMPORTED rather than read through a path at
// runtime, so a renamed or deleted record fails to resolve instead of failing
// with a path nobody can see from the test name.
import campaignRecord from "../../data/shared-class-textures-20260815/gpu-campaign.json";
import rollbackRecord from "../../data/shared-class-textures-20260815/rollback-transcript.json";
import southernT1 from "../../data/southern-remainder-20260812-t1/payload-inventory.json";
import lowerT1 from "../../data/lower-manhattan-20260812-t1/payload-inventory.json";
import centralT1 from "../../data/central-upper-manhattan-20260812-t1/payload-inventory.json";
import northernT1 from "../../data/northern-manhattan-20260812-t1/payload-inventory.json";
import southernP1 from "../../data/southern-remainder-20260812-p1/payload-inventory.json";
import lowerP1 from "../../data/lower-manhattan-20260812-p1/payload-inventory.json";
import centralP1 from "../../data/central-upper-manhattan-20260812-p1/payload-inventory.json";
import northernP1 from "../../data/northern-manhattan-20260812-p1/payload-inventory.json";

interface Inventory { releaseId: string; totals: { fileCount: number; byteSize: number }; files: { path: string; byteSize: number; checksumSha256: string }[] }
interface CampaignRecord {
  results: Array<{ arm: string; releaseId: string; probe: { residentAssetCount: number; reading: { texturesByteLength: number; geometryByteLength: number } } }>;
}

const campaign = campaignRecord as unknown as CampaignRecord;
const embedded = campaign.results.find((entry) => entry.arm === "p1-embedded")!;
const shared = campaign.results.find((entry) => entry.arm === "t1-shared")!;

describe("the committed GPU campaign", () => {
  it("compared the SAME scene, which is what makes the delta a texture delta", () => {
    // Resident asset count and geometry bytes are the two witnesses that the two
    // arms held the same geometry. Without them the texture delta could be a
    // difference in what was loaded rather than in how it was delivered.
    expect(shared.probe.residentAssetCount).toBe(embedded.probe.residentAssetCount);
    expect(shared.probe.reading.geometryByteLength).toBe(embedded.probe.reading.geometryByteLength);
    expect(embedded.probe.residentAssetCount).toBeGreaterThan(0);
  });

  it("validates BOTH arms against the instrument with a delta of exactly zero", () => {
    // 174 and 4 are the decoded texture counts the readings imply. Exactness is
    // the whole point: it is what refuted the probe's original base-level claim.
    expect(validateGpuTextureProbe({ ...embedded.probe.reading, resourceCacheEntryCount: -1 }, 174)).toMatchObject({ deltaByteLength: 0, agrees: true });
    expect(validateGpuTextureProbe({ ...shared.probe.reading, resourceCacheEntryCount: -1 }, 4)).toMatchObject({ deltaByteLength: 0, agrees: true });
  });

  it("pins the measured figures ADR 0047 quotes", () => {
    expect(embedded.probe.reading.texturesByteLength).toBe(15_204_294);
    expect(shared.probe.reading.texturesByteLength).toBe(349_524);
    expect(embedded.probe.reading.texturesByteLength - shared.probe.reading.texturesByteLength).toBe(14_854_770);
    // 97.70%, stated as the ADR states it.
    expect(Number((100 * (1 - shared.probe.reading.texturesByteLength / embedded.probe.reading.texturesByteLength)).toFixed(2))).toBe(97.7);
  });

  it("keeps the island figure a PROJECTION with arithmetic that closes", () => {
    // 941 embedded copies against 16 shared artifacts (4 classes x 4 releases).
    expect(predictedTextureByteLength(941)).toBe(82_225_521);
    expect(predictedTextureByteLength(16)).toBe(1_398_096);
    expect(predictedTextureByteLength(941) - predictedTextureByteLength(16)).toBe(80_827_425);
  });
});

describe("the committed rollback rehearsal", () => {
  const rollback = rollbackRecord as unknown as { transcript: Array<{ label: string; state: { probe: { exteriorReleaseIds: string[]; residentAssetCount: number } } }> };
  const byLabel = new Map(rollback.transcript.map((entry) => [entry.label, entry.state.probe]));

  it("shows the opt-in selecting that release ALONE", () => {
    expect(byLabel.get("t1-shared")!.exteriorReleaseIds).toStrictEqual(["manhattan-southern-remainder-cells-20260812-t1"]);
  });

  it("shows reverting the parameter restoring the promoted default untouched", () => {
    const fallback = byLabel.get("rollback-default")!;
    // The default composition is several waves, none of them a `-t1`, and its
    // residency is larger than the single opted-in release's.
    expect(fallback.exteriorReleaseIds.length).toBeGreaterThan(1);
    expect(fallback.exteriorReleaseIds.some((id) => id.endsWith("-t1"))).toBe(false);
    expect(fallback.residentAssetCount).toBeGreaterThan(byLabel.get("t1-shared")!.residentAssetCount);
  });

  it("shows a withdrawn successor failing CLOSED rather than falling back to one", () => {
    const withdrawn = byLabel.get("withdrawn-successor")!;
    expect(withdrawn.exteriorReleaseIds).toStrictEqual([]);
    expect(withdrawn.residentAssetCount).toBe(0);
  });
});

describe("the four -t1 releases", () => {
  const inventories = [southernT1, lowerT1, centralT1, northernT1] as unknown as Inventory[];

  it("declares exactly the four catalogue tiles, once each, at their real bytes", () => {
    const catalog = proceduralTextureCatalog();
    for (const inventory of inventories) {
      const tiles = inventory.files.filter((file) => file.path.startsWith("public/textures/"));
      expect(tiles.map((file) => file.path).sort()).toStrictEqual([...PROCEDURAL_TEXTURE_CLASSES].map((textureClass) => `public/textures/${textureClass}.png`).sort());
      for (const tile of tiles) {
        const textureClass = tile.path.slice("public/textures/".length, -".png".length) as (typeof PROCEDURAL_TEXTURE_CLASSES)[number];
        // The DECLARED byte size is the rasterizer's own tile length, so a
        // record describing a different tile than the catalogue produces fails.
        expect(tile.byteSize).toBe(catalog.get(textureClass)!.pngBytes.byteLength);
      }
    }
  });

  it("carries the 314 textured assets of the tier, and is smaller on the wire", () => {
    const glbCount = inventories.reduce((total, inventory) => total + inventory.files.filter((file) => file.path.startsWith("public/assets/")).length, 0);
    expect(glbCount).toBe(314);
    expect(inventories.map((inventory) => inventory.releaseId).sort()).toStrictEqual([...EXTERIOR_T1_RELEASE_IDS].sort());
    const t1Bytes = inventories.reduce((total, inventory) => total + inventory.totals.byteSize, 0);
    const p1Bytes = ([southernP1, lowerP1, centralP1, northernP1] as unknown as Inventory[]).reduce((total, inventory) => total + inventory.totals.byteSize, 0);
    expect(t1Bytes).toBe(142_672_284);
    expect(p1Bytes - t1Bytes).toBe(15_355_783);
  });
});
