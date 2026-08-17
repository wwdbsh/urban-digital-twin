/* global console, process, Buffer */
/**
 * T009 STEP 2 gates 2a and 2c, against the real emission path.
 *
 * 2a  UV SET-CONTAINMENT and the MEASURED byte delta. The containment claim is
 *     that LOD 1's UVs are LOD 0's restricted to the faces that survive
 *     shedding - not a new projection. It is checked as a SET relation on the
 *     rounded (u,v) pairs, because the two levels do not share vertex order and
 *     an index-wise comparison would fail for a reason that is not the claim.
 * 2c  FALLBACK IDENTITY. A `full-geometry` LOD 1 carries the same geometry as
 *     LOD 0, so under textured emission the two must agree on geometry AND on
 *     their texture binding, differing only where the level identifies itself.
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
const WAVES = [["w00","manhattan-exterior-cells-20260811-v3-c1"],["w01","manhattan-midtown-core-cells-20260811-v3-c1"],["w02","manhattan-lower-manhattan-cells-20260812-c1"],["w03","manhattan-southern-remainder-cells-20260812-c1"],["w04","manhattan-central-upper-manhattan-cells-20260812-c1"],["w05","manhattan-northern-manhattan-cells-20260812-c1"]];

function glb(bytes) {
  const b = Buffer.from(bytes);
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.slice(20, 20 + jsonLen).toString("utf8"));
  const binOffset = 20 + jsonLen + 8;
  return { json, bin: b.slice(binOffset) };
}
/** Every (u,v) the asset declares, rounded, as a set. */
function uvSet(bytes) {
  const { json, bin } = glb(bytes);
  const set = new Set();
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      const idx = prim.attributes?.TEXCOORD_0;
      if (idx === undefined) continue;
      const acc = json.accessors[idx];
      const view = json.bufferViews[acc.bufferView];
      const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
      const strideBytes = view.byteStride ?? 8;
      for (let i = 0; i < acc.count; i += 1) {
        const o = base + i * strideBytes;
        set.add(`${bin.readFloatLE(o).toFixed(4)},${bin.readFloatLE(o + 4).toFixed(4)}`);
      }
    }
  }
  return set;
}
function loadShards() {
  const manifest = JSON.parse(readFileSync(join(snapshotRoot, "manifest.json"), "utf8"));
  const shards = manifest.geometryShards.filter((e) => e.layer === "buildings").map((s) => JSON.parse(readFileSync(join(snapshotRoot, s.relativeContentRef), "utf8")));
  return { shards, manifestChecksumSha256: manifest.manifestChecksumSha256 ?? sha256HexSync(JSON.stringify(manifest)) };
}
function retained(releaseId) {
  const base = join(root, "public", "data", releaseId);
  const rr = JSON.parse(readFileSync(join(base, "retention-root.json"), "utf8"));
  const out = [];
  for (const cm of rr.cellManifests) {
    const m = JSON.parse(readFileSync(join(base, cm.relativeRef), "utf8"));
    for (const a of m.assets) {
      const lods = Object.fromEntries(a.lods.map((l) => [l.lodId, l]));
      out.push({ buildingId: a.canonicalFeatureId, ownerCellId: a.ownerCellId, capturedAt: a.sourceDates.capturedAt, updatedAt: a.sourceDates.updatedAt, predecessor: a.predecessor, lods, base,
        isFallback: lods.lod_0.quality.triangleCount === lods.lod_1.quality.triangleCount });
    }
  }
  return out;
}
const stride = (items, n) => items.length <= n ? items : Array.from({ length: n }, (_, i) => items[Math.floor(i * items.length / n)]);

const perWave = Number(process.argv.find((t) => t.startsWith("--per-wave="))?.slice("--per-wave=".length) ?? 40);
const { shards, manifestChecksumSha256 } = loadShards();
const report = { uvContainment: [], byteDelta: { perWave: [], island: {} }, fallbackIdentity: [], population: {} };
let dTotal = 0, dCount = 0, c1Total = 0, c2Total = 0;

for (const [waveId, releaseId] of WAVES) {
  const profile = { ...massGenerationSuccessorProfile(WAVE_BASE_PROFILES[waveId]), textureLevels: "both" };
  const assets = retained(releaseId);
  const fallbacks = assets.filter((a) => a.isFallback);
  const sample = [...stride(assets, perWave), ...stride(fallbacks, 2)];
  const sources = collectMidtownCoreSources(shards, new Set(sample.map((a) => a.buildingId)));
  const row = { waveId, sampled: 0, c1Lod1Bytes: 0, c2Lod1Bytes: 0, deltaBytes: 0, fallbacksInWave: fallbacks.length };
  for (const a of sample) {
    const source = sources.get(a.buildingId);
    if (!source) continue;
    let written;
    try {
      written = writeMidtownCoreV3Assets(buildMidtownCoreV3Plan(source, manifestChecksumSha256, profile), { ownerCellId: a.ownerCellId, capturedAt: a.capturedAt, updatedAt: a.updatedAt, predecessor: a.predecessor, profile });
    } catch (e) { if (e instanceof MidtownCoreV3Stop) continue; throw e; }
    const e0 = written.assets.find((x) => x.lodId === "lod_0");
    const e1 = written.assets.find((x) => x.lodId === "lod_1");
    const c1lod1 = readFileSync(join(a.base, a.lods.lod_1.artifactRef));
    row.sampled += 1; row.c1Lod1Bytes += c1lod1.length; row.c2Lod1Bytes += e1.bytes.length;
    const vOld = glb(c1lod1).json.accessors?.[0]?.count ?? 0;
    const vNew = glb(e1.bytes).json.accessors?.[0]?.count ?? 0;
    row.vertexOld = (row.vertexOld ?? 0) + vOld; row.vertexNew = (row.vertexNew ?? 0) + vNew;
    dTotal += e1.bytes.length - c1lod1.length; dCount += 1; c1Total += c1lod1.length; c2Total += e1.bytes.length;

    if (report.uvContainment.length < 10) {
      const s0 = uvSet(e0.bytes), s1 = uvSet(e1.bytes);
      const missing = [...s1].filter((uv) => !s0.has(uv));
      report.uvContainment.push({ buildingId: a.buildingId, waveId, isFallback: a.isFallback, lod0UvCount: s0.size, lod1UvCount: s1.size, lod1NotInLod0: missing.length, contained: missing.length === 0, sampleMissing: missing.slice(0, 3) });
    }
    if (a.isFallback && report.fallbackIdentity.length < 8) {
      const g0 = glb(e0.bytes).json, g1 = glb(e1.bytes).json;
      // The exported predicate takes GEOMETRY, which the writer's result does not
      // expose. The stronger observable is used instead: for a full-geometry
      // fallback under textured emission the two levels must produce the SAME
      // GLB apart from where the level names itself, so the JSON is compared
      // with the canonical metadata stripped and the binary chunk hashed.
      const strip = (j) => { const c = JSON.parse(JSON.stringify(j)); if (c.asset) delete c.asset.extras; return JSON.stringify(c); };
      report.fallbackIdentity.push({ buildingId: a.buildingId, waveId,
        binaryChunkIdentical: sha256HexBytes(glb(e0.bytes).bin) === sha256HexBytes(glb(e1.bytes).bin),
        lod0Images: (g0.images ?? []).length, lod1Images: (g1.images ?? []).length,
        lod0Uvs: uvSet(e0.bytes).size, lod1Uvs: uvSet(e1.bytes).size,
        jsonEqualIgnoringExtras: strip(g0) === strip(g1),
        bytesEqual: sha256HexBytes(e0.bytes) === sha256HexBytes(e1.bytes),
        lod0Bytes: e0.bytes.length, lod1Bytes: e1.bytes.length });
    }
  }
  row.deltaBytes = row.c2Lod1Bytes - row.c1Lod1Bytes;
  row.meanDeltaPerAsset = row.sampled ? Math.round(row.deltaBytes / row.sampled) : null;
  report.byteDelta.perWave.push(row);
  console.error(`  ${waveId} n=${row.sampled} meanDelta=${row.meanDeltaPerAsset} B/asset`);
}
report.byteDelta.island = { sampled: dCount, meanDeltaBytesPerAsset: Math.round(dTotal / dCount),
  c1MeanLod1Bytes: Math.round(c1Total / dCount), c2MeanLod1Bytes: Math.round(c2Total / dCount),
  projectedIslandDeltaBytes: Math.round((dTotal / dCount) * 44989),
  projectedIslandDeltaGb: Number(((dTotal / dCount) * 44989 / 1e9).toFixed(4)) };
console.log(JSON.stringify(report, null, 1));
