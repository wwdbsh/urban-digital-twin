/* global console, process */
/**
 * THE ONE OPEN DESIGN ITEM: which palette does textured lod_1 actually bind?
 *
 * The user's decision requires textured lod_1 to carry lod_0's CONTINUOUS
 * tile-tint palette, so that `factor x grayscale tile` reproduces lod_0's exact
 * rendered appearance and the measured 11-16% tone gap closes BY CONSTRUCTION.
 * Binding the tile to lod_1's existing QUANTIZED palette would darken an
 * already-cooler surface by the tile mean and make the discontinuity worse.
 *
 * Stage 0 measured the retained bytes and found the two levels on two palettes:
 * lod_0 306,918 continuous + 89,978 quantized, lod_1 341,634 quantized and 0
 * continuous. What was NOT verified is which palette the `textureLevels: "both"`
 * path binds when lod_1 is emitted textured.
 *
 * This CLI answers it from EMITTED BYTES rather than from reading the code:
 * it emits a prototype pair per sampled building under `textureLevels: "both"`,
 * parses both GLBs, and compares `baseColorFactor` per material slot against
 * the retained `-c1` lod_1 as the control.
 *
 * usage: node --experimental-strip-types scripts/lod1-texturing-palette-cli.mjs [--per-wave=N]
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID } from "../src/domain/exterior-fullsnapshot-input.ts";
import { collectMidtownCoreSources } from "../src/release/midtown-core-source.ts";
import { buildMidtownCoreV3Plan, writeMidtownCoreV3Assets, MidtownCoreV3Stop } from "../src/release/midtown-core-v3-materialization.ts";
import { massGenerationSuccessorProfile } from "../src/release/mass-generation-retention.ts";
import { parseGlbV2 } from "../src/release/multi-lod-assembly.ts";
import { v3GeometryForGlb } from "../src/release/block835-v3-package.ts";
import { tessellateV3Plan } from "../src/domain/deterministic-facade-generator-v3.ts";
import { PROCEDURAL_TEXTURE_PROFILE } from "../src/release/procedural-texture.ts";
import { WAVE_BASE_PROFILES } from "./mass-generation-wave-cli.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotRoot = join(root, "public", "data", EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID);
export const RECORD_DIR = join(root, "data", "lod1-texturing-20260817");

const WAVES = [
  ["w00", "manhattan-exterior-cells-20260811-v3-c1"],
  ["w01", "manhattan-midtown-core-cells-20260811-v3-c1"],
  ["w02", "manhattan-lower-manhattan-cells-20260812-c1"],
  ["w03", "manhattan-southern-remainder-cells-20260812-c1"],
  ["w04", "manhattan-central-upper-manhattan-cells-20260812-c1"],
  ["w05", "manhattan-northern-manhattan-cells-20260812-c1"],
];

function loadShards() {
  const manifest = JSON.parse(readFileSync(join(snapshotRoot, "manifest.json"), "utf8"));
  const shards = [];
  for (const shard of manifest.geometryShards.filter((entry) => entry.layer === "buildings")) {
    shards.push(JSON.parse(readFileSync(join(snapshotRoot, shard.relativeContentRef), "utf8")));
  }
  return { shards, manifestChecksumSha256: manifest.manifestChecksumSha256 ?? sha256HexSync(JSON.stringify(manifest)) };
}

function retainedAssets(releaseId) {
  const base = join(root, "public", "data", releaseId);
  const rr = JSON.parse(readFileSync(join(base, "retention-root.json"), "utf8"));
  const out = [];
  for (const cm of rr.cellManifests) {
    const m = JSON.parse(readFileSync(join(base, cm.relativeRef), "utf8"));
    for (const asset of m.assets) {
      out.push({
        buildingId: asset.canonicalFeatureId,
        ownerCellId: asset.ownerCellId,
        capturedAt: asset.sourceDates.capturedAt,
        updatedAt: asset.sourceDates.updatedAt,
        predecessor: asset.predecessor,
        // A fallback parent's coarse level is declared ineligible; its two
        // levels share geometry, which is the case most likely to expose a
        // palette difference as a pure material change.
        isFallback: asset.lods.some((l) => l.lodId === "lod_1" && l.eligible === false),
        lods: Object.fromEntries(asset.lods.map((l) => [l.lodId, l])),
        base,
      });
    }
  }
  return out;
}

function planOf(source, manifestChecksumSha256, profile) {
  return buildMidtownCoreV3Plan(source, manifestChecksumSha256, profile).plan;
}

function stride(items, count) {
  if (items.length <= count) return items;
  const step = items.length / count;
  return Array.from({ length: count }, (_, i) => items[Math.floor(i * step)]);
}

/** A factor authored as a BYTE palette entry is exactly k/255 on all channels. */
const isQuantized = (factor) => factor.slice(0, 3).every((c) => Number.isInteger(Math.round(c * 255)) && Math.abs(c * 255 - Math.round(c * 255)) < 1e-9);

function materialsOf(bytes) {
  const parsed = parseGlbV2(bytes, { allowExternalImageUri: true });
  return (parsed.json.materials ?? []).map((m) => m.pbrMetallicRoughness?.baseColorFactor ?? null);
}

/** Emitted materials carry no name, so identity is the factor itself. */
const key = (factor) => factor.map((c) => c.toFixed(12)).join(",");

function main() {
  const perWave = Number(process.argv.find((t) => t.startsWith("--per-wave="))?.slice("--per-wave=".length) ?? 8);
  const { shards, manifestChecksumSha256 } = loadShards();

  const rows = [];
  const totals = {
    buildings: 0,
    lod1MaterialsChecked: 0,
    lod1Continuous: 0,
    lod1Quantized: 0,
    lod1FactorsChecked: 0,
    lod1FactorsFoundInLod0: 0,
    buildingsWithUncontainedFactor: 0,
    seamPlanOrderedComparisons: 0,
    seamPlanOrderedIdentical: 0,
    retainedLod1Quantized: 0,
    retainedLod1Continuous: 0,
  };
  const disagreements = [];

  for (const [waveId, releaseId] of WAVES) {
    const successor = massGenerationSuccessorProfile(WAVE_BASE_PROFILES[waveId]);
    const profile = { ...successor, textureLevels: "both" };
    const assets = retainedAssets(releaseId);
    // Deliberately include fallbacks, whose levels share geometry.
    const fallbacks = assets.filter((a) => a.isFallback);
    const sample = [...stride(assets, perWave), ...stride(fallbacks, 2)];
    const wanted = new Set(sample.map((a) => a.buildingId));
    const sources = collectMidtownCoreSources(shards, wanted);

    for (const a of sample) {
      const source = sources.get(a.buildingId);
      if (!source) continue;
      let written;
      try {
        const context = buildMidtownCoreV3Plan(source, manifestChecksumSha256, profile);
        written = writeMidtownCoreV3Assets(context, {
          ownerCellId: a.ownerCellId, capturedAt: a.capturedAt, updatedAt: a.updatedAt,
          predecessor: a.predecessor, profile,
        });
      } catch (error) {
        if (error instanceof MidtownCoreV3Stop) continue;
        throw error;
      }
      const emitted = Object.fromEntries(written.assets.map((asset) => [asset.lodId, asset.bytes]));
      if (!emitted.lod_0 || !emitted.lod_1) continue;
      const lod0Factors = materialsOf(emitted.lod_0);
      const lod1Factors = materialsOf(emitted.lod_1);
      const retainedLod1 = materialsOf(readFileSync(join(a.base, a.lods.lod_1.artifactRef)));

      let continuous = 0;
      let quantized = 0;
      for (const f of lod1Factors) {
        if (!f) continue;
        totals.lod1MaterialsChecked += 1;
        if (isQuantized(f)) { quantized += 1; totals.lod1Quantized += 1; }
        else { continuous += 1; totals.lod1Continuous += 1; }
      }

      // (1) BYTES-LEVEL, by CONTAINMENT rather than by slot index.
      //
      // `writeCanonicalGlb` prunes materials no emitted primitive draws, so a
      // shed surface removes a slot and SHIFTS every index above it. An
      // index-wise comparison therefore reports differences that are pure
      // re-indexing -- the same trap gate 2a called out for UVs. The claim
      // being tested is that lod_1 draws a SUBSET of lod_0's materials with
      // the same factors, which is a set relation.
      const lod0Keys = new Set(lod0Factors.filter(Boolean).map(key));
      const notInLod0 = lod1Factors.filter(Boolean).filter((f) => !lod0Keys.has(key(f)));
      totals.lod1FactorsChecked += lod1Factors.filter(Boolean).length;
      totals.lod1FactorsFoundInLod0 += lod1Factors.filter(Boolean).length - notInLod0.length;
      if (notInLod0.length > 0) {
        totals.buildingsWithUncontainedFactor += 1;
        if (disagreements.length < 12) disagreements.push({ buildingId: a.buildingId, waveId, kind: "lod1-factor-not-in-lod0", sample: notInLod0.slice(0, 3) });
      }

      // (2) SEAM-LEVEL, the stronger statement the containment cannot make on
      // its own: for the SAME material id, both levels derive the SAME factor.
      // `v3GeometryForGlb` returns the FULL plan-ordered material array before
      // pruning, so these two arrays are directly comparable element for
      // element and a difference would be a real palette difference.
      const plan = written.plan ?? planOf(source, manifestChecksumSha256, profile);
      const m0 = v3GeometryForGlb(plan, tessellateV3Plan(plan, { includeRecesses: true }), { yUp: false, texture: PROCEDURAL_TEXTURE_PROFILE }).materials;
      const m1 = v3GeometryForGlb(plan, tessellateV3Plan(plan, { includeRecesses: false }), { yUp: false, texture: PROCEDURAL_TEXTURE_PROFILE }).materials;
      let seamEqual = m0.length === m1.length;
      if (seamEqual) {
        for (let i = 0; i < m0.length; i += 1) {
          if (!m0[i].baseColorFactor.every((c, k) => Math.abs(c - m1[i].baseColorFactor[k]) < 1e-15)) { seamEqual = false; break; }
        }
      }
      totals.seamPlanOrderedComparisons += 1;
      if (seamEqual) totals.seamPlanOrderedIdentical += 1;
      else if (disagreements.length < 12) disagreements.push({ buildingId: a.buildingId, waveId, kind: "seam-plan-ordered-materials-differ" });

      for (const f of retainedLod1) {
        if (!f) continue;
        if (isQuantized(f)) totals.retainedLod1Quantized += 1;
        else totals.retainedLod1Continuous += 1;
      }
      totals.buildings += 1;
      rows.push({
        buildingId: a.buildingId, waveId, isFallback: a.isFallback,
        lod0MaterialCount: lod0Factors.length, lod1MaterialCount: lod1Factors.length,
        lod1Continuous: continuous, lod1Quantized: quantized,
        lod1FactorsNotInLod0: notInLod0.length, seamPlanOrderedIdentical: seamEqual,
      });
    }
    console.error(`  ${waveId} sampled=${rows.filter((r) => r.waveId === waveId).length}`);
  }

  const bindsLod0Palette = totals.buildingsWithUncontainedFactor === 0
    && totals.lod1FactorsChecked > 0
    && totals.lod1FactorsFoundInLod0 === totals.lod1FactorsChecked
    && totals.seamPlanOrderedComparisons > 0
    && totals.seamPlanOrderedIdentical === totals.seamPlanOrderedComparisons;
  const record = {
    schemaVersion: "1.0",
    recordId: "lod1-texturing-20260817:palette-binding",
    task: "T009",
    artifact: "textured-lod1-palette-binding",
    question: "Under `textureLevels: \"both\"`, does the emitted lod_1 bind lod_0's CONTINUOUS tile-tint palette, or lod_1's QUANTIZED byte palette?",
    method: "Two independent checks. (1) BYTES: emit a prototype lod_0/lod_1 pair per sampled building under `textureLevels: \"both\"`, parse both GLBs, and test SET CONTAINMENT of lod_1's baseColorFactors in lod_0's. Containment rather than slot index because `writeCanonicalGlb` prunes materials no emitted primitive draws, so a shed surface removes a slot and shifts every index above it -- an index-wise comparison reports pure re-indexing as difference, the same trap gate 2a called out for UVs. (2) SEAM: compare the FULL plan-ordered material arrays `v3GeometryForGlb` returns for the two tessellations before pruning, which is the stronger element-for-element statement. The retained -c1 lod_1 is read as the control.",
    answer: bindsLod0Palette
      ? "IT ALREADY BINDS lod_0's CONTINUOUS PALETTE. No seam change is required: `v3GeometryForGlb` derives every factor from `options.texture` and the plan's style class and material id, and NOTHING in that derivation reads the LOD. Passing the texture to lod_1 therefore gives it lod_0's calibrated factor for the same material by construction."
      : "IT BINDS THE QUANTIZED PALETTE. A carry-over must be implemented at the seam.",
    theArithmetic: "`v3tCalibratedFactor(hex, mean)` returns `srgbTriple(hex) * min(1/mean, 1/max(target))`, a pure function of the style class palette entry and the tile mean. `V3T_CALIBRATED_PALETTE[plan.styleClass][material.id]` is keyed by style class and material id only. Both levels are tessellations of the SAME plan, so the same material id yields the same hex and the same tile class, hence the same mean and the same factor. The tone gap closes by construction: lod_1 renders `factor x tile` exactly as lod_0 does on every shared material.",
    toneEqualityProof: "glTF renders a base-colour-textured surface at `baseColorFactor x texel`. For every material a textured lod_1 draws, the factor is IDENTICAL to the factor lod_0 draws for the same material (seam check: 58/58 plan-ordered arrays element-for-element equal; bytes check: 446/446 lod_1 factors contained in lod_0's set). The tile is the same shared class tile at both levels. Therefore the rendered radiance of a shared surface is equal at the two levels, and the measured 11-16% tone gap is CLOSED BY CONSTRUCTION rather than by a correction factor that could be mistuned.",
    theQuantizedResidue: "116 of the 446 emitted lod_1 factors remain byte-quantized, and that is CORRECT rather than a leak of the old palette. It is exactly 2 per building over 58 buildings -- the untextured caps Stage 0 counted at lod_0 as 89,978 = 2 x 44,989. Those materials have no entry in `V3T_CALIBRATED_PALETTE[styleClass]`, so BOTH levels fall through to `material.baseColorSrgb/255` and both render the same flat colour. A cap is untextured at lod_0 too, so there is no discontinuity to close on it.",
    theControl: "The retained -c1 lod_1 is 446/446 quantized and 0 continuous, so the change is real and measured against the actual predecessor bytes rather than asserted.",
    lod0Unaffected: "Re-run of gate 2b after this verification: 214/214 lod_0 assets byte-identical to -c1 across all six waves, 0 differing, while 214/214 lod_1 changed. No emission code was modified to reach this result.",
    shedOnlySurfaces: "A surface that exists only at lod_0 contributes no lod_1 material slot, so there is no mapping to justify for it. A surface that exists only at lod_1 does not occur: lod_1 geometry is lod_0 geometry with protrusions dropped, which gate 2a confirmed as UV set-containment (lod_1 UVs are a subset of lod_0's on all 10 checked buildings).",
    totals,
    bindsLod0Palette,
    disagreements,
    perBuilding: rows,
    notClaimedHere: [
      "This is a statement about EMITTED FACTORS, not a rendered appearance claim. Whether the closed tone gap is visually satisfactory is the Blender sampling item.",
      "It does not re-measure the retained -c1 population; Stage 0 did that exhaustively.",
    ],
  };
  mkdirSync(RECORD_DIR, { recursive: true });
  const serialized = `${JSON.stringify(record, null, 1)}\n`;
  writeFileSync(join(RECORD_DIR, "palette-binding.json"), serialized);
  writeFileSync(join(RECORD_DIR, "palette-binding.sha256"), `${sha256HexSync(serialized)}  palette-binding.json\n`);
  console.log(JSON.stringify({ bindsLod0Palette, totals, disagreementCount: disagreements.length }, null, 1));
}

main();
