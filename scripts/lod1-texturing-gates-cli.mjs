/* global console, process */
/**
 * T009 STEP 2 — the three gates that can still stop the textured-lod_1 campaign.
 *
 * Each one is run against the REAL emission path and the REAL retained bytes.
 * None of them is a simulation: `writeMidtownCoreV3Assets` is called, and what
 * it returns is compared byte for byte with what `-c1` committed.
 *
 * GATE 2b IS THE ONE THAT MATTERS. The campaign re-emits every building, so
 * lod_0 must come out byte-identical under the changed write path or the near
 * ring silently changes underneath a task that only meant to touch lod_1. The
 * named suspect is `writeCanonicalGlb` accessor/image write-order renumbering.
 *
 * The BASELINE run is not optional and is not ceremony: if this harness cannot
 * reproduce `-c1` lod_0 with the seam UNCHANGED, then a comparison after the
 * flip proves nothing about the flip.
 */
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexBytes, sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID } from "../src/domain/exterior-fullsnapshot-input.ts";
import { collectMidtownCoreSources } from "../src/release/midtown-core-source.ts";
import { buildMidtownCoreV3Plan, writeMidtownCoreV3Assets, MidtownCoreV3Stop } from "../src/release/midtown-core-v3-materialization.ts";
import { massGenerationSuccessorProfile } from "../src/release/mass-generation-retention.ts";
import { WAVE_BASE_PROFILES } from "./mass-generation-wave-cli.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotRoot = join(root, "public", "data", EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID);
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

/** Every `-c1` asset of a wave, with the pins the writer needs to reproduce it. */
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
        lods: Object.fromEntries(asset.lods.map((l) => [l.lodId, l])),
        base,
      });
    }
  }
  return out;
}

function stride(items, count) {
  if (items.length <= count) return items;
  const step = items.length / count;
  return Array.from({ length: count }, (_, i) => items[Math.floor(i * step)]);
}

function run(perWave, textured) {
  const { shards, manifestChecksumSha256 } = loadShards();
  const report = { perWave: [], totals: { checked: 0, identical: 0, differing: 0, refused: 0 }, differing: [] };
  for (const [waveId, releaseId] of WAVES) {
    const successor = massGenerationSuccessorProfile(WAVE_BASE_PROFILES[waveId]);
    // The ONLY difference between the baseline and the gate run. Everything else
    // -- sources, plan, pins, capture dates, predecessor -- is identical.
    const profile = textured ? { ...successor, textureLevels: "both" } : successor;
    const assets = retainedAssets(releaseId);
    const sample = stride(assets, perWave);
    const wanted = new Set(sample.map((a) => a.buildingId));
    const sources = collectMidtownCoreSources(shards, wanted);
    const row = { waveId, releaseId, population: assets.length, sampled: sample.length, identical: 0, differing: 0, refused: 0, lod1: { identicalToC1: 0, differing: 0 } };
    for (const a of sample) {
      const source = sources.get(a.buildingId);
      if (!source) { row.refused += 1; continue; }
      let written;
      try {
        const context = buildMidtownCoreV3Plan(source, manifestChecksumSha256, profile);
        written = writeMidtownCoreV3Assets(context, {
          ownerCellId: a.ownerCellId, capturedAt: a.capturedAt, updatedAt: a.updatedAt,
          predecessor: a.predecessor, profile,
        });
      } catch (error) {
        if (error instanceof MidtownCoreV3Stop) { row.refused += 1; continue; }
        throw error;
      }
      for (const emitted of written.assets) {
        const declared = a.lods[emitted.lodId];
        if (!declared) continue;
        const retained = readFileSync(join(a.base, declared.artifactRef));
        const same = retained.length === emitted.bytes.length && sha256HexBytes(retained) === sha256HexBytes(emitted.bytes);
        if (emitted.lodId === "lod_0") {
          if (same) row.identical += 1;
          else {
            row.differing += 1;
            if (report.differing.length < 12) report.differing.push({ buildingId: a.buildingId, waveId, retainedBytes: retained.length, emittedBytes: emitted.bytes.length, retainedSha: sha256HexBytes(retained), emittedSha: sha256HexBytes(emitted.bytes) });
          }
        } else if (same) row.lod1.identicalToC1 += 1;
        else row.lod1.differing += 1;
      }
    }
    report.perWave.push(row);
    report.totals.checked += row.identical + row.differing;
    report.totals.identical += row.identical;
    report.totals.differing += row.differing;
    report.totals.refused += row.refused;
    console.error(`  ${waveId} lod_0 identical=${row.identical} differing=${row.differing} refused=${row.refused} | lod_1 same-as-c1=${row.lod1.identicalToC1} changed=${row.lod1.differing}`);
  }
  return report;
}

const perWave = Number(process.argv.find((t) => t.startsWith("--per-wave="))?.slice("--per-wave=".length) ?? 40);
const textured = process.argv.includes("--textured");
console.error(textured ? "GATE RUN: textureLevels=both" : "BASELINE RUN: textureLevels defaulted (lod-0-only)");
const out = run(perWave, textured);
out.mode = textured ? "textureLevels=both" : "baseline";
console.log(JSON.stringify(out, null, 1));
