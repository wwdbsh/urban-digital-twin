/* global console, process */
/**
 * Per-wave verification for a `-c2` textured-lod_1 release: the determinism
 * replay, and the `-c1` immutability spot-check.
 *
 * The replay re-emits a STRIDE SAMPLE of the wave from the same pinned snapshot
 * and ledger and byte-compares against the committed `-c2` inventory. It
 * deliberately includes the wave's LOD-1 FALLBACK parents when it has any:
 * those are the buildings whose two levels share geometry, so a palette or
 * texture-binding fault would show there first and nowhere else.
 *
 * The immutability check re-hashes a sample of `-c1` artifacts from disk against
 * the `-c1` inventory. `-c1` is READ-ONLY for this task; this is the check that
 * says so from bytes rather than from intent.
 *
 * usage: node --experimental-strip-types scripts/lod1-texturing-verify-cli.mjs <wNN> [--sample=40]
 */
import { readFileSync, writeFileSync, lstatSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexBytes, sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID } from "../src/domain/exterior-fullsnapshot-input.ts";
import { collectMidtownCoreSources } from "../src/release/midtown-core-source.ts";
import { materializeMidtownCoreV3Cells } from "../src/release/midtown-core-v3-source.ts";
import { massGenerationSuccessorProfile } from "../src/release/mass-generation-retention.ts";
import { exteriorArtifactChecksum } from "../src/release/exterior-wave-ledger.ts";
import { WAVE_BASE_PROFILES } from "./mass-generation-wave-cli.mjs";
import { C1_RELEASE_IDS, c2ReleaseId } from "./lod1-texturing-wave-cli.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotRoot = join(repositoryRoot, "public", "data", EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID);
const CAPTURE = { capturedAt: "2026-08-04T00:00:00.000Z", updatedAt: "2026-08-04T00:00:00.000Z" };

function fail(message) { console.error(`STOP: ${message}`); process.exit(1); }
function serialize(value) { return `${JSON.stringify(value, null, 2)}\n`; }
const waveOf = (cellId) => /^manhattan-exterior-cell-(w\d{2})-/u.exec(cellId)[1];

function loadShards() {
  const manifest = JSON.parse(readFileSync(join(snapshotRoot, "manifest.json"), "utf8"));
  const shards = manifest.geometryShards
    .filter((e) => e.layer === "buildings")
    .map((s) => JSON.parse(readFileSync(join(snapshotRoot, s.relativeContentRef), "utf8")));
  return { shards, manifestChecksumSha256: manifest.manifestChecksumSha256 ?? sha256HexSync(JSON.stringify(manifest)) };
}

function stride(items, count) {
  if (items.length <= count) return items;
  const step = items.length / count;
  return Array.from({ length: count }, (_, i) => items[Math.floor(i * step)]);
}

function main() {
  const waveId = process.argv.slice(2).find((t) => !t.startsWith("--"));
  if (!waveId || !WAVE_BASE_PROFILES[waveId]) fail("usage: lod1-texturing-verify-cli.mjs <wNN> [--sample=40]");
  const sampleSize = Number(process.argv.find((t) => t.startsWith("--sample="))?.slice("--sample=".length) ?? 40);

  const c1Id = C1_RELEASE_IDS[waveId];
  const releaseId = c2ReleaseId(waveId);
  const recordRoot = join(repositoryRoot, "data", releaseId);
  const inventory = JSON.parse(readFileSync(join(recordRoot, "payload-inventory.json"), "utf8"));
  const declared = new Map(inventory.files.map((f) => [f.path, f]));
  const c1Inventory = JSON.parse(readFileSync(join(repositoryRoot, "data", c1Id, "payload-inventory.json"), "utf8"));

  // ---- (A) -c1 immutability, from bytes ------------------------------------
  const c1Root = join(repositoryRoot, "public", "data", c1Id);
  const c1Sample = stride(c1Inventory.files, 60);
  const immutability = { sampled: c1Sample.length, identical: 0, differing: [], symlinks: 0 };
  for (const file of c1Sample) {
    const path = join(c1Root, ...file.path.split("/"));
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) immutability.symlinks += 1;
    const bytes = readFileSync(path);
    const measured = sha256HexBytes(bytes);
    if (measured === file.checksumSha256 && bytes.byteLength === file.byteSize) immutability.identical += 1;
    else immutability.differing.push({ path: file.path, declared: file.checksumSha256, measured });
  }
  if (immutability.differing.length > 0) fail(`-c1 MUTATION DETECTED on ${immutability.differing.length} artifact(s): ${JSON.stringify(immutability.differing.slice(0, 3))}`);

  // ---- (B) determinism replay of the -c2 emission ---------------------------
  const emissionProfile = { ...massGenerationSuccessorProfile(WAVE_BASE_PROFILES[waveId]), textureLevels: "both" };
  const { shards, manifestChecksumSha256 } = loadShards();
  const ledger = JSON.parse(readFileSync(join(repositoryRoot, "data", "normalized", "manhattan-exterior-wave-ledger-20260804", "ledger.json"), "utf8"));
  const ledgerChecksum = exteriorArtifactChecksum(ledger);
  const cells = ledger.cells.filter((c) => waveOf(c.cellId) === waveId).sort((l, r) => l.order - r.order);

  // Which cells own a fallback parent? Read the -c2 manifests, which declare it.
  const c2Root = join(repositoryRoot, "public", "data", releaseId);
  const c2RetentionRoot = JSON.parse(readFileSync(join(c2Root, "retention-root.json"), "utf8"));
  const fallbackCells = new Set();
  for (const cm of c2RetentionRoot.cellManifests) {
    const m = JSON.parse(readFileSync(join(c2Root, cm.relativeRef), "utf8"));
    if (m.assets.some((a) => a.lods.some((l) => l.lodId === "lod_1" && l.eligible === false))) fallbackCells.add(cm.cellId);
  }
  // A FALLBACK QUOTA, not a fallback priority.
  //
  // Sorting fallbacks first fixed "0 fallback GLBs" and then overshot: on w03,
  // which owns 289 fallback parents, they consumed the ENTIRE 40-GLB cap and the
  // replay covered 0 shed lod_1 assets -- the opposite blind spot, and on the
  // population that is 97% shed. The cap is now SPLIT: at most
  // `min(4, ceil(cap/4))` GLBs may be fallbacks, and shed buildings fill the
  // rest. Both classes are covered on every wave that has both.
  const fallbackQuota = Math.min(4, Math.max(1, Math.ceil(sampleSize / 4)));
  // PER-CELL CAP, the third instance of the same defect. This CLI's own header
  // promises a sample "stratified by ownership cell ... so the sample cannot all
  // come from one neighbourhood", and honest `cellsSampled` reporting exposed
  // that all 40 GLBs were coming from the FIRST cell. A cell may contribute at
  // most this many, so the cap spreads across roughly ten cells as intended.
  // Scaled by how many cells the wave HAS, not by a fixed ten. w00 owns a
  // single cell, and a fixed cap silently cut its replay from its whole
  // 28-GLB population to 4 -- trading one blind spot for another.
  const spreadTarget = Math.min(10, Math.max(1, cells.length));
  const perCellCap = Math.max(2, Math.ceil(sampleSize / spreadTarget));
  const fallbackFirst = cells.filter((c) => fallbackCells.has(c.cellId));
  const rest = cells.filter((c) => !fallbackCells.has(c.cellId));
  const picked = [...fallbackFirst.slice(0, 2), ...stride(rest.length > 0 ? rest : cells, Math.max(1, Math.ceil(sampleSize / 2)))];

  const wanted = new Set(picked.flatMap((c) => c.buildingIds));
  const sources = collectMidtownCoreSources(shards, wanted);
  const replay = { requestedSample: sampleSize, fallbackQuota, perCellCap, spreadTarget, cellsSampled: 0, cellsPicked: picked.length, comparedGlbCount: 0, byteIdenticalCount: 0, lod0Compared: 0, lod1Compared: 0, fallbackGlbCompared: 0, shedGlbCompared: 0, mismatches: [] };

  for (const cell of picked) {
    if (replay.comparedGlbCount >= sampleSize) break;
    const comparedBefore = replay.comparedGlbCount;
    let fromThisCell = 0;
    const m = materializeMidtownCoreV3Cells({
      cells: [cell], sources, baseManifestChecksumSha256: manifestChecksumSha256,
      capture: CAPTURE, retainAllLods: true, retain: "shipped-bytes",
      profile: emissionProfile, assemblyLods: { lod0MaxDistanceMeters: null },
    });
    const fallbackIds = new Set([...m.lod1Decisions].filter(([, d]) => d.variant === "full-geometry").map(([id]) => id));
    // FALLBACK REFS FIRST within the cell, for the same reason the fallback
    // CELLS come first: a cell holds ~50 buildings and only one of them is a
    // fallback, so taking the first 40 refs in name order sampled 40 GLBs that
    // reliably excluded the very building the sample exists to cover.
    const fallbackRef = (ref) => [...fallbackIds].some((id) => ref.includes(id.replaceAll(":", "-")));
    const ordered = [...m.assetBytes.keys()].sort((l, r) => {
      const fl = fallbackRef(l) ? 0 : 1;
      const fr = fallbackRef(r) ? 0 : 1;
      return fl !== fr ? fl - fr : (l < r ? -1 : l > r ? 1 : 0);
    });
    for (const ref of ordered) {
      if (replay.comparedGlbCount >= sampleSize || fromThisCell >= perCellCap) break;
      const isFallback = fallbackRef(ref);
      // The quota: once it is filled, fallback refs are SKIPPED so the rest of
      // the cap can reach shed assets.
      if (isFallback && replay.fallbackGlbCompared >= fallbackQuota) continue;
      const expected = declared.get(ref);
      if (!expected) { replay.mismatches.push({ ref, reason: "not declared by the -c2 inventory" }); replay.comparedGlbCount += 1; continue; }
      const bytes = m.assetBytes.get(ref);
      const measured = sha256HexBytes(bytes);
      replay.comparedGlbCount += 1;
      fromThisCell += 1;
      if (ref.endsWith("__lod_0.glb")) replay.lod0Compared += 1; else replay.lod1Compared += 1;
      if (isFallback) replay.fallbackGlbCompared += 1; else replay.shedGlbCompared += 1;
      if (measured === expected.checksumSha256 && bytes.byteLength === expected.byteSize) replay.byteIdenticalCount += 1;
      else replay.mismatches.push({ ref, declared: expected.checksumSha256, replayed: measured });
    }
    // Only a cell that actually contributed a comparison counts as sampled.
    if (replay.comparedGlbCount > comparedBefore) replay.cellsSampled += 1;
  }
  if (replay.mismatches.length > 0) fail(`replay found ${replay.mismatches.length} mismatch(es): ${JSON.stringify(replay.mismatches.slice(0, 3))}`);

  // SUPERSESSION, not silent rewrite. A prior verification record's reading is
  // carried forward verbatim under `supersededReadings` so the sequence of
  // belief stays readable, exactly as the -c1 stage records do it.
  const priorPath = join(recordRoot, "verification.json");
  let superseded = [];
  if (existsSync(priorPath)) {
    const prior = JSON.parse(readFileSync(priorPath, "utf8"));
    superseded = [...(prior.supersededReadings ?? []), {
      supersededAt: new Date().toISOString(),
      reason: "The replay sampler reserved no fallback QUOTA: fallback refs were sorted first and, on a wave with many fallback parents, consumed the whole cap so that 0 shed lod_1 assets were covered. `cellsSampled` also counted cells that were PICKED rather than cells that contributed a comparison, and `fallbackAvailability` asserted that the sample included a fallback without checking. This entry preserves the reading those defects produced.",
      determinismReplay: prior.determinismReplay,
    }];
  }

  const record = {
    schemaVersion: "1.0",
    recordId: `${releaseId}:verification`,
    task: "T009",
    artifact: "c2-wave-verification",
    waveId,
    releaseId,
    predecessorReleaseId: c1Id,
    parentLedgerChecksumSha256: ledgerChecksum,
    determinismReplay: {
      ...replay,
      note: "Re-emitted from the same pinned snapshot and ledger and byte-compared to the committed -c2 inventory. lod_0 entries in this sample are the COPIED bytes, so their agreement is a second, independent confirmation of the copy.",
      includedFallbackParent: replay.fallbackGlbCompared > 0,
      // DERIVED from what the run actually compared. The previous wording said
      // "the sample includes one" unconditionally, which was an assertion the
      // run had not checked and which was false on w01's first pass.
      fallbackAvailability: fallbackCells.size === 0
        ? "THIS WAVE HAS NO LOD-1 FALLBACK PARENT, so none could be sampled. Stated rather than silently satisfied."
        : `${fallbackCells.size} cells own at least one fallback parent; this run compared ${replay.fallbackGlbCompared} fallback GLB(s) against a quota of ${fallbackQuota}, and ${replay.shedGlbCompared} shed GLB(s).`,
    },
    c1Immutability: {
      ...immutability,
      note: "A stride sample of the -c1 payload re-hashed from disk against the -c1 committed inventory. -c1 is READ-ONLY for this task and this is the check that says so from bytes.",
      symlinkCount: immutability.symlinks,
    },
    ...(superseded.length > 0 ? { supersededReadings: superseded } : {}),
    ok: true,
  };
  const serialized = serialize(record);
  writeFileSync(join(recordRoot, "verification.json"), serialized);
  writeFileSync(join(recordRoot, "verification.sha256"), `${sha256HexSync(serialized)}  verification.json\n`);
  console.log(serialize({
    ok: true, waveId,
    replay: `${replay.byteIdenticalCount}/${replay.comparedGlbCount} byte-identical (lod_0 ${replay.lod0Compared}, lod_1 ${replay.lod1Compared}, fallback GLBs ${replay.fallbackGlbCompared})`,
    c1Immutability: `${immutability.identical}/${immutability.sampled} unchanged`,
  }));
}

main();
