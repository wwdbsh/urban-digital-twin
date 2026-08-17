import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { tessellateV3Plan } from "../src/domain/deterministic-facade-generator-v3.ts";
import { v3GeometryForGlb } from "../src/release/block835-v3-package.ts";
import { PROCEDURAL_TEXTURE_PROFILE } from "../src/release/procedural-texture.ts";
import { buildMidtownCoreV3Plan } from "../src/release/midtown-core-v3-materialization.ts";
import { collectMidtownCoreSources } from "../src/release/midtown-core-source.ts";
import { EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID } from "../src/domain/exterior-fullsnapshot-input.ts";
import { massGenerationSuccessorProfile } from "../src/release/mass-generation-retention.ts";
import { WAVE_BASE_PROFILES } from "./mass-generation-wave-cli.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const recordPath = join(repositoryRoot, "data", "lod1-texturing-20260817", "palette-binding.json");
const recordText = readFileSync(recordPath, "utf8");
const record = JSON.parse(recordText);

describe("the textured-lod_1 palette binding", () => {
  it("matches its committed sidecar", () => {
    const sidecar = readFileSync(recordPath.replace(/\.json$/u, ".sha256"), "utf8").trim().split(/\s+/u)[0];
    expect(sha256HexSync(recordText)).toBe(sidecar);
  });

  it("answers the open design item: lod_1 binds lod_0's CONTINUOUS palette", () => {
    expect(record.bindsLod0Palette).toBe(true);
    expect(record.totals.buildings).toBeGreaterThanOrEqual(50);
    expect(record.disagreements).toEqual([]);
  });

  it("proves containment in the emitted bytes, with nothing uncontained", () => {
    expect(record.totals.lod1FactorsChecked).toBeGreaterThan(0);
    expect(record.totals.lod1FactorsFoundInLod0).toBe(record.totals.lod1FactorsChecked);
    expect(record.totals.buildingsWithUncontainedFactor).toBe(0);
  });

  it("proves element-for-element equality at the seam, on every sampled building", () => {
    expect(record.totals.seamPlanOrderedComparisons).toBe(record.totals.buildings);
    expect(record.totals.seamPlanOrderedIdentical).toBe(record.totals.seamPlanOrderedComparisons);
  });

  it("keeps the quantized residue at exactly the two untextured caps per building", () => {
    // Not "most factors are continuous now" — the residue has to be the caps
    // exactly, or some textured surface is still on the old palette.
    expect(record.totals.lod1Quantized).toBe(2 * record.totals.buildings);
    expect(record.totals.lod1Continuous).toBe(record.totals.lod1MaterialsChecked - record.totals.lod1Quantized);
  });

  it("measures the predecessor as the control: -c1 lod_1 was wholly quantized", () => {
    expect(record.totals.retainedLod1Continuous).toBe(0);
    expect(record.totals.retainedLod1Quantized).toBeGreaterThan(0);
  });
});

/**
 * The property the record ASSERTS, re-derived here from live code rather than
 * read back out of the record. A record can go stale; this cannot.
 */
describe("the palette derivation itself", () => {
  const snapshotRoot = join(repositoryRoot, "public", "data", EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID);

  it("derives the SAME factor at both levels for every material of a real building", () => {
    const manifest = JSON.parse(readFileSync(join(snapshotRoot, "manifest.json"), "utf8"));
    const shards = manifest.geometryShards
      .filter((entry) => entry.layer === "buildings")
      .map((shard) => JSON.parse(readFileSync(join(snapshotRoot, shard.relativeContentRef), "utf8")));
    const manifestChecksumSha256 = manifest.manifestChecksumSha256 ?? sha256HexSync(JSON.stringify(manifest));

    // Block 835's fourteen: real, committed, and cheap to plan.
    const wanted = new Set(["doitt:102705", "doitt:131170", "doitt:147902", "doitt:262867", "doitt:39969"]);
    const sources = collectMidtownCoreSources(shards, wanted);
    expect(sources.size).toBe(wanted.size);

    const profile = { ...massGenerationSuccessorProfile(WAVE_BASE_PROFILES.w00), textureLevels: "both" };
    let compared = 0;
    for (const source of sources.values()) {
      const { plan } = buildMidtownCoreV3Plan(source, manifestChecksumSha256, profile);
      const fine = v3GeometryForGlb(plan, tessellateV3Plan(plan, { includeRecesses: true }), { yUp: false, texture: PROCEDURAL_TEXTURE_PROFILE }).materials;
      const coarse = v3GeometryForGlb(plan, tessellateV3Plan(plan, { includeRecesses: false }), { yUp: false, texture: PROCEDURAL_TEXTURE_PROFILE }).materials;
      expect(coarse).toHaveLength(fine.length);
      for (let index = 0; index < fine.length; index += 1) {
        // EXACT equality, not a tolerance: both sides are the same pure
        // function of the same style class and material id, so any difference
        // at all would mean the derivation had started reading the LOD.
        expect(coarse[index].baseColorFactor).toEqual(fine[index].baseColorFactor);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(20);
  });

  it("gives an UNTEXTURED coarse level the quantized palette, which is the contrast", () => {
    const manifest = JSON.parse(readFileSync(join(snapshotRoot, "manifest.json"), "utf8"));
    const shards = manifest.geometryShards
      .filter((entry) => entry.layer === "buildings")
      .map((shard) => JSON.parse(readFileSync(join(snapshotRoot, shard.relativeContentRef), "utf8")));
    const manifestChecksumSha256 = manifest.manifestChecksumSha256 ?? sha256HexSync(JSON.stringify(manifest));
    const sources = collectMidtownCoreSources(shards, new Set(["doitt:131170"]));
    const source = [...sources.values()][0];
    const profile = { ...massGenerationSuccessorProfile(WAVE_BASE_PROFILES.w00), textureLevels: "both" };
    const { plan } = buildMidtownCoreV3Plan(source, manifestChecksumSha256, profile);
    const tessellation = tessellateV3Plan(plan, { includeRecesses: false });
    const textured = v3GeometryForGlb(plan, tessellation, { yUp: false, texture: PROCEDURAL_TEXTURE_PROFILE }).materials;
    const untextured = v3GeometryForGlb(plan, tessellation, { yUp: false, texture: null }).materials;

    const quantized = (factor) => factor.slice(0, 3).every((c) => Math.abs(c * 255 - Math.round(c * 255)) < 1e-9);
    // The old path: every factor a byte palette entry. This is what -c1 shipped.
    expect(untextured.every((m) => quantized(m.baseColorFactor))).toBe(true);
    // The new path: some factors continuous. If this ever became all-quantized
    // again the tone gap would silently return.
    expect(textured.some((m) => !quantized(m.baseColorFactor))).toBe(true);
  });
});
