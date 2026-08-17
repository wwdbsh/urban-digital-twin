/* global console, process */
/**
 * PRE-REGISTRATION of the textured-lod_1 appearance sampling.
 *
 * Written and committed BEFORE any still is captured. It fixes the strata, the
 * camera, the measurement and — the part that matters — the AGREEMENT BAR, so
 * the bar cannot be chosen after the numbers are known.
 *
 * usage: node --experimental-strip-types scripts/lod1-texturing-sampling-plan-cli.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID } from "../src/domain/exterior-fullsnapshot-input.ts";
import { collectMidtownCoreSources } from "../src/release/midtown-core-source.ts";
import { buildMidtownCoreV3Plan, MidtownCoreV3Stop } from "../src/release/midtown-core-v3-materialization.ts";
import { massGenerationSuccessorProfile } from "../src/release/mass-generation-retention.ts";
import { WAVE_BASE_PROFILES } from "./mass-generation-wave-cli.mjs";
import { C1_RELEASE_IDS, c2ReleaseId } from "./lod1-texturing-wave-cli.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotRoot = join(repositoryRoot, "public", "data", EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID);
const RECORD_DIR = join(repositoryRoot, "data", "lod1-texturing-20260817");
const WAVES = ["w00", "w01", "w02", "w03", "w04", "w05"];
const STYLE_CLASSES = ["curtain-cool", "masonry-light", "masonry-warm", "stone-neutral"];

function loadShards() {
  const manifest = JSON.parse(readFileSync(join(snapshotRoot, "manifest.json"), "utf8"));
  const shards = manifest.geometryShards.filter((e) => e.layer === "buildings")
    .map((s) => JSON.parse(readFileSync(join(snapshotRoot, s.relativeContentRef), "utf8")));
  return { shards, manifestChecksumSha256: manifest.manifestChecksumSha256 ?? sha256HexSync(JSON.stringify(manifest)) };
}

function main() {
  const { shards, manifestChecksumSha256 } = loadShards();
  const strata = [];
  const availability = [];

  for (const waveId of WAVES) {
    const releaseId = c2ReleaseId(waveId);
    const base = join(repositoryRoot, "public", "data", releaseId);
    const rr = JSON.parse(readFileSync(join(base, "retention-root.json"), "utf8"));
    const candidates = [];
    for (const cm of rr.cellManifests) {
      const m = JSON.parse(readFileSync(join(base, cm.relativeRef), "utf8"));
      for (const a of m.assets) {
        const coarse = a.lods.find((l) => l.lodId === "lod_1");
        candidates.push({
          buildingId: a.canonicalFeatureId,
          variant: coarse.eligible === false ? "fallback" : "shed",
          lod0Ref: a.lods.find((l) => l.lodId === "lod_0").artifactRef,
          lod1Ref: coarse.artifactRef,
        });
      }
    }
    candidates.sort((l, r) => (l.buildingId < r.buildingId ? -1 : 1));
    const wanted = new Set(candidates.map((c) => c.buildingId));
    const sources = collectMidtownCoreSources(shards, wanted);
    const profile = { ...massGenerationSuccessorProfile(WAVE_BASE_PROFILES[waveId]), textureLevels: "both" };

    // Fill each (styleClass, variant) cell with the LOWEST building id that
    // matches. Deterministic, and fixed before any render.
    const filled = new Map();
    const counts = new Map();
    for (const c of candidates) {
      const source = sources.get(c.buildingId);
      if (!source) continue;
      let styleClass;
      try { styleClass = buildMidtownCoreV3Plan(source, manifestChecksumSha256, profile).plan.styleClass; }
      catch (error) { if (error instanceof MidtownCoreV3Stop) continue; throw error; }
      const key = `${styleClass}|${c.variant}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!filled.has(key)) filled.set(key, { ...c, styleClass, waveId, releaseId });
      // Stop early once every cell that CAN be filled is filled and we have
      // enough population evidence to report availability honestly.
      if (filled.size === STYLE_CLASSES.length * 2 && [...counts.values()].every((v) => v > 0)) break;
    }

    for (const styleClass of STYLE_CLASSES) {
      for (const variant of ["shed", "fallback"]) {
        const key = `${styleClass}|${variant}`;
        const pick = filled.get(key);
        availability.push({ waveId, styleClass, variant, populationSeen: counts.get(key) ?? 0, available: Boolean(pick) });
        if (pick) strata.push(pick);
      }
    }
    console.error(`  ${waveId}: ${strata.filter((s) => s.waveId === waveId).length}/8 strata available`);
  }

  const record = {
    schemaVersion: "1.0",
    recordId: "lod1-texturing-20260817:sampling-pre-registration",
    task: "T009",
    artifact: "blender-sampling-pre-registration",
    status: "PRE-REGISTERED — written and committed BEFORE any still was captured",
    purpose: "Compare the TEXTURED lod_1 against the TEXTURED lod_0 at mid distance, to test whether the palette carry-over closes the 11-16% tone gap Stage 0 measured between the levels.",
    design: {
      contractedStrata: "4 style classes x 6 waves x {shed, fallback} = 48 pairs = 96 stills.",
      selection: "Within each (wave, style class, variant) cell, the LOWEST canonical building id that matches. Deterministic and fixed here, before any render.",
      unavailableCells: "A cell with no matching building is recorded as UNAVAILABLE and is NOT substituted from a neighbouring cell. w00 has 14 buildings and no fallback parent at all, so several of its cells cannot be filled; reporting a substitute would be reporting a stratum that was not sampled.",
      camera: "One camera per pair, identical for both levels: azimuth 55 degrees, elevation 18 degrees, framed so the building's bounding sphere subtends the same angle at a nominal 350 m mid-ring distance. The two levels are rendered from the SAME camera transform, so any difference is the asset and not the framing.",
      lighting: "One sun at fixed elevation and strength, no environment texture, no colour management beyond the scene default. Identical across every pair.",
      sceneClearing: "Objects are deleted and orphans purged. `bpy.ops.wm.read_factory_settings` is NEVER called: it unregisters the BlenderMCP addon and killed the channel during Stage 0.",
    },
    measurement: {
      primary: "MEAN LUMINANCE RATIO over the building's silhouette pixels, lod_1 / lod_0. Silhouette pixels are those where either render is non-background. Luminance is Rec. 709 on the linear framebuffer.",
      secondary: "PER-CHANNEL mean ratios, reported to expose any residual HUE error. Stage 0's finding was that the old gap varied 12.3% ACROSS channels, which a grayscale tile cannot produce, so the channel spread is the hue diagnostic.",
      why: "Pixel-identity is the wrong measure for a SHED pair: the two levels genuinely differ in geometry, by design. Tone is the thing the campaign set out to fix and tone is what is measured.",
    },
    agreementBar: {
      statedInAdvance: true,
      fallbackPairs: {
        bar: "|meanLuminanceRatio - 1| <= 0.005",
        rationale: "A fallback's two levels are the SAME geometry, so any difference at all is the material binding. This is effectively an equality check and it is the strictest cell in the design.",
      },
      shedPairs: {
        bar: "|meanLuminanceRatio - 1| <= 0.02",
        rationale: "Shed geometry removes protrusions, which changes shading and self-occlusion slightly even when the palette is identical. 2% is the tolerance for that, and it is far inside the 11-16% gap this campaign exists to close.",
      },
      hueDiagnostic: {
        bar: "max per-channel ratio spread <= 0.01",
        rationale: "The pre-campaign defect was a HUE error of 12.3% channel spread. A grayscale tile applied to an identical factor cannot produce a channel spread, so anything above 1% would mean the palette carry-over did not take.",
      },
      reportingRule: "REPORT WITH THRESHOLD. Every pair's measured values are reported against these bars whether they pass or fail. A miss is reported as a miss and is NOT re-explained by a bar chosen afterwards. A failed bar does not retract the byte-level gates, which are separate evidence.",
    },
    strataSelected: strata,
    availability,
    availableStrata: strata.length,
    contractedStrata: 48,
    notClaimedHere: [
      "No still has been captured at the time this record is committed.",
      "This is an APPEARANCE comparison between two levels of the same release. It is not geographic, architectural or performance acceptance, and it does not claim the tile is resolvable at mid ring — Stage 0 measured that it is not.",
    ],
  };
  mkdirSync(RECORD_DIR, { recursive: true });
  const serialized = `${JSON.stringify(record, null, 1)}\n`;
  writeFileSync(join(RECORD_DIR, "sampling-pre-registration.json"), serialized);
  writeFileSync(join(RECORD_DIR, "sampling-pre-registration.sha256"), `${sha256HexSync(serialized)}  sampling-pre-registration.json\n`);
  console.log(JSON.stringify({ availableStrata: strata.length, contractedStrata: 48, byWave: WAVES.map((w) => ({ w, n: strata.filter((s) => s.waveId === w).length })) }, null, 1));
}

main();
