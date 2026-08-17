/* global console, process, TextEncoder */
/**
 * The T009 textured-lod_1 campaign: one `-c2` retention wave per invocation.
 *
 * ## What a `-c2` wave is
 *
 * The `-c1` population re-packaged with its COARSE level textured. lod_0 is not
 * re-emitted — it is COPIED from `-c1` and verified byte for byte — and lod_1 is
 * emitted under `textureLevels: "both"`, which binds lod_0's continuous
 * tile-tint palette (see `palette-binding.json`) and closes the measured 11-16%
 * tone gap by construction.
 *
 * ## Why the GLBs keep the `-c1` release identity
 *
 * `writeMidtownCoreV3Assets` embeds `inventoryId` and `evidenceShardId` in every
 * GLB's canonical metadata, and both are derived from `profile.releaseId`. The
 * assembly replay compares those embedded strings to the manifest asset field
 * for field. So a GLB emitted under a `-c2` releaseId could never sit beside a
 * lod_0 COPIED from `-c1` — the two would disagree, and the only ways out are to
 * re-emit lod_0 (which the contract forbids, and which would move the near ring)
 * or to keep one identity across both levels.
 *
 * This wave keeps one identity: the EMISSION profile carries the `-c1`
 * releaseId, exactly as gate 2b ran it, and `-c2` is the identity of the RELEASE
 * WRAPPER only — its root, its cell package ids, its inventory. That is also the
 * truthful reading: `inventoryId` names a building's COMPONENT INVENTORY, which
 * is derived from the plan and is byte-identical between `-c1` and `-c2`. Only
 * the coarse level's material binding changed, and an inventory id is not the
 * thing that changed.
 *
 * ## Copy discipline
 *
 * `-c1` is READ-ONLY and is reached through a symlinked directory. lod_0 is
 * copied by READING BYTES AND WRITING BYTES, never by `cpSync`, which can
 * reproduce a symlink instead of its target and which caused the earlier w00
 * corruption. The retention validator refuses symlinked artifacts outright, so a
 * symlink here fails the wave rather than shipping.
 *
 * usage: node --experimental-strip-types scripts/lod1-texturing-wave-cli.mjs <w00..w05> [--force]
 */
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexBytes, sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID } from "../src/domain/exterior-fullsnapshot-input.ts";
import { verifyCitywideSnapshot } from "../src/release/citywide-snapshot-gate.ts";
import {
  EXTERIOR_WAVE_LEDGER_RELEASE_ID,
  exteriorArtifactChecksum,
  validateExteriorWaveLedger,
} from "../src/release/exterior-wave-ledger.ts";
import { collectMidtownCoreSources } from "../src/release/midtown-core-source.ts";
import { materializeMidtownCoreV3Cells } from "../src/release/midtown-core-v3-source.ts";
import {
  midtownCoreV3EvidenceShardId,
  midtownCoreV3InventoryId,
  sharedTextureArtifactRef,
} from "../src/release/midtown-core-v3-materialization.ts";
import { proceduralTextureCatalog } from "../src/release/procedural-texture.ts";
import {
  RETENTION_ROOT_REF,
  buildRetentionCellPackage,
  massGenerationSuccessorProfile,
  retentionCellManifestRef,
  retentionRootChecksum,
} from "../src/release/mass-generation-retention.ts";
import { isSafeReleaseArtifactReference } from "../src/runtime/path-security.ts";
import { WAVE_BASE_PROFILES, WAVE_OWNED_PARENTS } from "./mass-generation-wave-cli.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotRoot = join(repositoryRoot, "public", "data", EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID);
const ledgerRoot = join(repositoryRoot, "data", "normalized", EXTERIOR_WAVE_LEDGER_RELEASE_ID);
const encoder = new TextEncoder();

/** Free bytes this wave refuses to start without. */
const REQUIRED_FREE_BYTES = 1_500_000_000;

function fail(message) { console.error(`STOP: ${message}`); process.exit(1); }
function serialize(value) { return `${JSON.stringify(value, null, 2)}\n`; }

export const C1_RELEASE_IDS = {
  w00: "manhattan-exterior-cells-20260811-v3-c1",
  w01: "manhattan-midtown-core-cells-20260811-v3-c1",
  w02: "manhattan-lower-manhattan-cells-20260812-c1",
  w03: "manhattan-southern-remainder-cells-20260812-c1",
  w04: "manhattan-central-upper-manhattan-cells-20260812-c1",
  w05: "manhattan-northern-manhattan-cells-20260812-c1",
};

/** The `-c2` wrapper identity. The GLBs keep the `-c1` one; see the header. */
export function c2ReleaseId(waveId) {
  return `${WAVE_BASE_PROFILES[waveId].releaseId}-c2`;
}

const waveOf = (cellId) => /^manhattan-exterior-cell-(w\d{2})-/u.exec(cellId)[1];

function freeBytes(path) {
  const out = execFileSync("df", ["-k", path], { encoding: "utf8" }).trim().split("\n").pop().split(/\s+/u);
  return Number(out[3]) * 1024;
}

async function loadSources() {
  const present = existsSync(snapshotRoot) && statSync(snapshotRoot).isDirectory();
  const gate = verifyCitywideSnapshot({
    snapshotRoot,
    snapshotRootPresent: present,
    manifestText: present ? await readFile(join(snapshotRoot, "manifest.json"), "utf8").catch(() => null) : null,
    recordedChecksumText: present ? await readFile(join(snapshotRoot, "manifest.sha256"), "utf8").catch(() => null) : null,
    buildingShardFileCount: present
      ? await readdir(join(snapshotRoot, "geometry", "buildings")).then((names) => names.filter((name) => name.endsWith(".json")).length).catch(() => null)
      : null,
  });
  if (!gate.ok) fail(`${gate.message}\n\nA -c2 wave cannot run against an unverified base.`);
  const manifest = JSON.parse(await readFile(join(snapshotRoot, "manifest.json"), "utf8"));
  const shards = [];
  for (const shard of manifest.geometryShards.filter((entry) => entry.layer === "buildings")) {
    if (!isSafeReleaseArtifactReference(shard.relativeContentRef)) fail(`Shard reference ${shard.relativeContentRef} is not canonical.`);
    const text = await readFile(join(snapshotRoot, shard.relativeContentRef), "utf8");
    if (sha256HexSync(text) !== shard.checksumSha256) fail(`Shard ${shard.relativeContentRef} fails its declared checksum.`);
    shards.push(JSON.parse(text));
  }
  return { shards, manifestChecksumSha256: manifest.manifestChecksumSha256 ?? sha256HexSync(JSON.stringify(manifest)) };
}

async function loadLedger() {
  const ledger = JSON.parse(await readFile(join(ledgerRoot, "ledger.json"), "utf8"));
  const checksum = exteriorArtifactChecksum(ledger);
  const recorded = (await readFile(join(ledgerRoot, "ledger.sha256"), "utf8")).trim().split(/\s+/u)[0];
  if (recorded !== checksum) fail(`Committed ledger checksum ${checksum} != recorded ${recorded}.`);
  if (!validateExteriorWaveLedger(ledger).ok) fail("Committed ledger fails its own schema.");
  return { ledger, ledgerChecksumSha256: checksum };
}

async function writeFileAt(root, relativeRef, bytes) {
  const path = join(root, ...relativeRef.split("/"));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

async function runWave(waveId, options) {
  const base = WAVE_BASE_PROFILES[waveId];
  if (!base) fail(`unknown wave ${waveId}.`);
  // EXACTLY gate 2b's profile: the -c1 identity with the coarse level textured.
  const emissionProfile = { ...massGenerationSuccessorProfile(base), textureLevels: "both" };
  const c1Id = C1_RELEASE_IDS[waveId];
  const releaseId = c2ReleaseId(waveId);
  const started = Date.now();

  // ---- (1) disk headroom, before a byte is written -------------------------
  const free = freeBytes(repositoryRoot);
  if (free < REQUIRED_FREE_BYTES) fail(`only ${(free / 1e9).toFixed(2)} GB free; this wave needs ${(REQUIRED_FREE_BYTES / 1e9).toFixed(1)} GB of headroom.`);

  const { shards, manifestChecksumSha256 } = await loadSources();
  const { ledger, ledgerChecksumSha256 } = await loadLedger();

  const c1Root = join(repositoryRoot, "public", "data", c1Id);
  const c1RecordRoot = join(repositoryRoot, "data", c1Id);
  const c1Inventory = JSON.parse(await readFile(join(c1RecordRoot, "payload-inventory.json"), "utf8"));
  const c1Census = JSON.parse(await readFile(join(c1RecordRoot, "wave-census.json"), "utf8"));
  const c1RetentionRoot = JSON.parse(await readFile(join(c1Root, RETENTION_ROOT_REF), "utf8"));
  const c1ByPath = new Map(c1Inventory.files.map((f) => [f.path, f]));

  const cells = ledger.cells.filter((cell) => waveOf(cell.cellId) === waveId).sort((l, r) => l.order - r.order);
  const owned = cells.reduce((total, cell) => total + cell.buildingIds.length, 0);
  if (owned !== WAVE_OWNED_PARENTS[waveId]) fail(`wave ${waveId} owns ${owned}, expected ${WAVE_OWNED_PARENTS[waveId]}.`);
  const wanted = new Set(cells.flatMap((cell) => cell.buildingIds));
  const sources = collectMidtownCoreSources(shards, wanted);

  const payloadRoot = join(repositoryRoot, "public", "data", releaseId);
  const recordRoot = join(repositoryRoot, "data", releaseId);
  if (existsSync(payloadRoot)) {
    if (!options.force) fail(`${payloadRoot} exists; pass --force to replace this LOCAL, GITIGNORED payload.`);
    await rm(payloadRoot, { recursive: true, force: true });
  }
  await mkdir(payloadRoot, { recursive: true });
  await mkdir(recordRoot, { recursive: true });

  const files = [];
  const cellManifests = [];
  const tombstones = [];
  const refusalsByCode = {};
  const sharedTextureClasses = new Set();
  let generated = 0;
  let lod1Fallbacks = 0;
  // The single recorded lod_0 check: copied bytes verified against the -c1
  // inventory AND against what the writer emits, in one pass.
  const lod0 = { copied: 0, matchedC1Inventory: 0, matchedReemission: 0, mismatches: [] };
  let lod1Bytes = 0;
  let lod0Bytes = 0;

  const rootIdentity = {
    rootId: `root:${releaseId}:retention`,
    releaseId,
    predecessorReleaseId: c1Id,
    waveId,
    cityId: ledger.cityId,
    configId: ledger.configId,
    generatedAt: emissionProfile.generatedAt,
    baseIdentitySet: { id: ledger.baseIdentitySet.id, checksumSha256: ledger.baseIdentitySet.checksumSha256 },
    ownershipLedger: { id: ledger.ledgerId, checksumSha256: ledgerChecksumSha256 },
    ownedCellIds: cells.map((c) => c.cellId).sort(),
  };
  const rootDraft = {
    schemaVersion: "1.0",
    ...rootIdentity,
    immutable: true,
    textureAdmission: c1RetentionRoot.textureAdmission,
    cellManifests: [],
    retention: c1RetentionRoot.retention,
  };
  const rootChecksumSha256 = retentionRootChecksum(rootDraft);

  let index = 0;
  for (const cell of cells) {
    index += 1;
    const m = materializeMidtownCoreV3Cells({
      cells: [cell],
      sources,
      baseManifestChecksumSha256: manifestChecksumSha256,
      capture: { capturedAt: CAPTURE.capturedAt, updatedAt: CAPTURE.updatedAt },
      retainAllLods: true,
      retain: "shipped-bytes",
      profile: emissionProfile,
      assemblyLods: { lod0MaxDistanceMeters: null },
    });

    for (const [buildingId, reason] of m.refusals) {
      tombstones.push({ buildingId, ownerCellId: cell.cellId, stopCode: m.refusalCodes.get(buildingId) ?? "unknown", reason });
    }
    for (const [code, count] of Object.entries(m.census.refusalsByCode)) refusalsByCode[code] = (refusalsByCode[code] ?? 0) + count;
    for (const c of m.sharedTextureClasses) sharedTextureClasses.add(c);
    for (const [, d] of m.lod1Decisions) if (d.variant === "full-geometry") lod1Fallbacks += 1;
    generated += m.buildings.length;

    for (const [relativeRef, emittedBytes] of m.assetBytes) {
      if (relativeRef.endsWith("__lod_0.glb")) {
        // COPY, not re-emit. Read the -c1 bytes, verify them against the -c1
        // inventory, verify the writer reproduces them, then write them.
        const declared = c1ByPath.get(relativeRef);
        if (!declared) fail(`-c1 inventory declares no entry for ${relativeRef}.`);
        const path = join(c1Root, ...relativeRef.split("/"));
        const stat = statSync(path);
        if (!stat.isFile()) fail(`-c1 artifact is not a regular file: ${relativeRef}`);
        const c1Bytes = await readFile(path);
        const measured = sha256HexBytes(c1Bytes);
        lod0.copied += 1;
        if (measured === declared.checksumSha256 && c1Bytes.byteLength === declared.byteSize) lod0.matchedC1Inventory += 1;
        else { lod0.mismatches.push({ relativeRef, kind: "c1-inventory", declared: declared.checksumSha256, measured }); continue; }
        const reemitted = sha256HexBytes(emittedBytes);
        if (reemitted === measured) lod0.matchedReemission += 1;
        else lod0.mismatches.push({ relativeRef, kind: "re-emission", c1: measured, reemitted });
        await writeFileAt(payloadRoot, relativeRef, c1Bytes);
        lod0Bytes += c1Bytes.byteLength;
        files.push({ path: relativeRef, byteSize: c1Bytes.byteLength, checksumSha256: measured });
      } else {
        await writeFileAt(payloadRoot, relativeRef, emittedBytes);
        lod1Bytes += emittedBytes.byteLength;
        files.push({ path: relativeRef, byteSize: emittedBytes.byteLength, checksumSha256: sha256HexBytes(emittedBytes) });
      }
    }

    if (m.buildings.length === 0) continue;
    const pkg = buildRetentionCellPackage({
      cell,
      releaseId,
      generatedAt: emissionProfile.generatedAt,
      cityId: ledger.cityId,
      configId: ledger.configId,
      rootId: rootIdentity.rootId,
      rootChecksumSha256,
      baseIdentitySet: rootIdentity.baseIdentitySet,
      ownershipLedger: rootIdentity.ownershipLedger,
      buildings: m.buildings,
      assemblyLods: m.assemblyLods,
      // The -c1 identity, because the GLBs carry it. See the header.
      inventoryId: (b) => midtownCoreV3InventoryId(b, emissionProfile.releaseId),
      evidenceShardId: (b) => midtownCoreV3EvidenceShardId(b, emissionProfile.releaseId),
      uncertainty: emissionProfile.uncertainty,
      sourceDates: { capturedAt: CAPTURE.capturedAt, updatedAt: CAPTURE.updatedAt },
    });
    for (const [ref, bytes] of pkg.files) {
      await writeFileAt(payloadRoot, ref, bytes);
      files.push({ path: ref, byteSize: bytes.byteLength, checksumSha256: sha256HexBytes(bytes) });
    }
    const manifestBytes = pkg.files.get(pkg.manifestRef);
    cellManifests.push({ cellId: cell.cellId, relativeRef: retentionCellManifestRef(cell.cellId), byteSize: manifestBytes.byteLength, checksumSha256: sha256HexBytes(manifestBytes) });
    if (index % 25 === 0 || index === cells.length) {
      console.log(`  ${waveId} cell ${index}/${cells.length} generated=${generated} lod0copied=${lod0.copied} elapsed=${Math.round((Date.now() - started) / 1000)}s`);
    }
  }

  if (lod0.mismatches.length > 0) fail(`lod_0 verification failed on ${lod0.mismatches.length} asset(s): ${JSON.stringify(lod0.mismatches.slice(0, 3))}`);

  const catalog = proceduralTextureCatalog();
  for (const textureClass of [...sharedTextureClasses].sort()) {
    const tile = catalog.get(textureClass);
    if (!tile) fail(`detail tile ${textureClass} is not a class this rasterizer produces.`);
    const ref = sharedTextureArtifactRef(textureClass);
    await writeFileAt(payloadRoot, ref, tile.pngBytes);
    files.push({ path: ref, byteSize: tile.pngBytes.byteLength, checksumSha256: sha256HexBytes(tile.pngBytes) });
  }

  const root = { ...rootDraft, cellManifests, rootChecksumSha256 };
  const rootBytes = encoder.encode(serialize(root));
  await writeFileAt(payloadRoot, RETENTION_ROOT_REF, rootBytes);
  files.push({ path: RETENTION_ROOT_REF, byteSize: rootBytes.byteLength, checksumSha256: sha256HexBytes(rootBytes) });

  // ---- census carried from -c1, with the refusal set ASSERTED equal --------
  if (generated + tombstones.length !== owned) fail(`wave does not account for itself: ${generated} + ${tombstones.length} != ${owned}.`);
  if (generated !== c1Census.generatedBuildingCount) fail(`generated ${generated} != -c1's ${c1Census.generatedBuildingCount}.`);
  if (tombstones.length !== c1Census.tombstonedBuildingCount) fail(`tombstoned ${tombstones.length} != -c1's ${c1Census.tombstonedBuildingCount}.`);
  if (lod1Fallbacks !== c1Census.lod1FallbackCount) fail(`lod1 fallbacks ${lod1Fallbacks} != -c1's ${c1Census.lod1FallbackCount}.`);
  const c1Refusals = new Map(c1Census.tombstones.map((t) => [t.buildingId, t.stopCode]));
  for (const t of tombstones) {
    if (c1Refusals.get(t.buildingId) !== t.stopCode) fail(`tombstone drift for ${t.buildingId}: -c1 says ${c1Refusals.get(t.buildingId)}, this wave says ${t.stopCode}.`);
  }
  if (JSON.stringify(refusalsByCode) !== JSON.stringify(c1Census.aggregate.refusalsByCode)) {
    fail(`refusal code histogram drifted from -c1: ${JSON.stringify(refusalsByCode)} vs ${JSON.stringify(c1Census.aggregate.refusalsByCode)}`);
  }

  files.sort((l, r) => (l.path < r.path ? -1 : l.path > r.path ? 1 : 0));
  const inventory = {
    schemaVersion: "1.0",
    releaseId,
    waveId,
    payloadDirectory: `public/data/${releaseId}`,
    note: "Textured-lod_1 successor of the -c1 retention wave. lod_0 is COPIED from -c1 and verified byte for byte; lod_1 is re-emitted with the shared-class tile bound and lod_0's continuous tint palette. Payload is gitignored and LOCAL ONLY; nothing is served, published or conveyed.",
    base: { releaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID, manifestChecksumSha256 },
    parentLedger: { releaseId: EXTERIOR_WAVE_LEDGER_RELEASE_ID, checksumSha256: ledgerChecksumSha256 },
    predecessorReleaseId: c1Id,
    predecessorRetentionRoot: { rootId: c1RetentionRoot.rootId, rootChecksumSha256: c1RetentionRoot.rootChecksumSha256 },
    glbReleaseIdentity: {
      releaseId: emissionProfile.releaseId,
      why: "Every GLB embeds inventoryId and evidenceShardId derived from the EMISSION profile's releaseId. lod_0 is copied from -c1, so both levels must carry the -c1 identity or the assembly replay's field-for-field comparison would fail. -c2 is the identity of this release WRAPPER only.",
    },
    retentionRoot: { rootId: rootIdentity.rootId, rootChecksumSha256 },
    textureAdmission: c1RetentionRoot.textureAdmission,
    cellManifestCount: cellManifests.length,
    totals: { fileCount: files.length, byteSize: files.reduce((t, f) => t + f.byteSize, 0) },
    files,
  };
  await writeFile(join(recordRoot, "payload-inventory.json"), serialize(inventory));
  await writeFile(join(recordRoot, "payload-inventory.sha256"), `${sha256HexSync(serialize(inventory))}  payload-inventory.json\n`);

  const census = {
    ...c1Census,
    releaseId,
    predecessorReleaseId: c1Id,
    textureLevels: "both",
    carriedFromPredecessor: {
      statement: "Counts, tombstones and LOD-1 decisions are CARRIED from the -c1 census and asserted equal by this run, not recomputed into a new claim. Texturing the coarse level changes no plan, so a different refusal set would be a fault rather than a finding.",
      assertedEqual: ["generatedBuildingCount", "tombstonedBuildingCount", "lod1FallbackCount", "tombstones[].stopCode", "aggregate.refusalsByCode"],
      predecessorCensusSha256: sha256HexSync(await readFile(join(c1RecordRoot, "wave-census.json"), "utf8")),
    },
    lod0: { source: "copied-from-c1", copied: lod0.copied, matchedC1Inventory: lod0.matchedC1Inventory, matchedReemission: lod0.matchedReemission, mismatches: lod0.mismatches.length },
    bytes: { lod0: lod0Bytes, lod1: lod1Bytes, total: inventory.totals.byteSize },
    blenderAgreement: { status: "see lod1-texturing-20260817/blender-sampling records", note: "The textured-lod_1 appearance sampling is a separate pre-registered evidence item and is not claimed by this record." },
  };
  await writeFile(join(recordRoot, "wave-census.json"), serialize(census));
  await writeFile(join(recordRoot, "wave-census.sha256"), `${sha256HexSync(serialize(census))}  wave-census.json\n`);

  console.log(serialize({
    ok: true, waveId, releaseId, predecessor: c1Id,
    owned, generated, tombstoned: tombstones.length, lod1Fallbacks,
    cellManifestCount: cellManifests.length,
    lod0Verified: `${lod0.matchedC1Inventory}/${lod0.copied} vs -c1 inventory, ${lod0.matchedReemission}/${lod0.copied} vs re-emission`,
    bytes: census.bytes,
    freeBytesAtStart: free,
    elapsedSeconds: Math.round((Date.now() - started) / 1000),
  }));
}

const CAPTURE = { capturedAt: "2026-08-04T00:00:00.000Z", updatedAt: "2026-08-04T00:00:00.000Z" };

async function main() {
  const argv = process.argv.slice(2);
  const positional = argv.filter((t) => !t.startsWith("--"));
  const force = argv.includes("--force");
  for (const t of argv.filter((x) => x.startsWith("--"))) if (t !== "--force") fail(`unknown flag ${t}.`);
  if (positional.length !== 1) {
    console.error("usage: node scripts/lod1-texturing-wave-cli.mjs <w00|w01|w02|w03|w04|w05> [--force]");
    process.exit(1);
  }
  await runWave(positional[0], { force });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exit(1); });
}
