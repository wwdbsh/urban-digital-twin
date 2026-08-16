/* global console, process, TextEncoder */
/**
 * The T004 mass-generation RETENTION WAVE driver.
 *
 * One wave per invocation, generating the FULL owned generatable population of
 * that wave at `lod_0` + `lod_1` under the wave's retention successor profile,
 * writing the payload into a gitignored `public/data/<releaseId>` directory and
 * the committed records into `data/<releaseId>`.
 *
 * ## Cell by cell, deliberately
 *
 * The materialization is driven ONE OWNERSHIP CELL AT A TIME and its bytes are
 * written and dropped before the next cell starts. A whole-wave pass would hold
 * both LODs of up to 11,721 buildings in memory at once — gigabytes, to produce
 * a package whose validation unit is the cell anyway. The cell is also the unit
 * the assembly replay bound makes possible: 256 MiB in memory, against a wave
 * that is far larger.
 *
 * ## What this does NOT do
 *
 * It writes no serving surface. No runtime index is emitted, no promoted default
 * moves, no approved release's bytes are touched, and nothing is published. The
 * payload directory is gitignored; the committed record is the inventory and the
 * census, which is what keeps every emitted byte checkable after the local tree
 * is removed.
 */
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexBytes, sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { DETERMINISTIC_FACADE_V3T_UNCERTAINTY } from "../src/domain/deterministic-facade-generator-v3.ts";
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
  MIDTOWN_CORE_V3_WAVE_PROFILE,
  V3_FROZEN_WAVE_ADMISSION_ENVELOPE,
  midtownCoreV3EvidenceShardId,
  midtownCoreV3InventoryId,
  sharedTextureArtifactRef,
} from "../src/release/midtown-core-v3-materialization.ts";
import { LOWER_MANHATTAN_WAVE_PROFILE } from "../src/release/lower-manhattan-release.ts";
import { SOUTHERN_REMAINDER_WAVE_PROFILE } from "../src/release/southern-remainder-release.ts";
import { CENTRAL_UPPER_MANHATTAN_WAVE_PROFILE } from "../src/release/central-upper-manhattan-release.ts";
import { NORTHERN_MANHATTAN_WAVE_PROFILE } from "../src/release/northern-manhattan-release.ts";
import { BLOCK835_V3_GENERATED_AT, BLOCK835_V3_SEED, BLOCK835_V3_TOOL, V3T_QUALITY_BUDGETS } from "../src/release/block835-v3-package.ts";
import { PROCEDURAL_TEXTURE_PROFILE, PROCEDURAL_TEXTURE_SAMPLER_FILTER, proceduralTextureCatalog } from "../src/release/procedural-texture.ts";
import {
  MASS_GENERATION_ADMISSION_ENVELOPE,
  RETENTION_ROOT_REF,
  RETENTION_STATEMENT,
  buildRetentionCellPackage,
  massGenerationSuccessorProfile,
  retentionCellManifestRef,
  retentionRootChecksum,
} from "../src/release/mass-generation-retention.ts";
import { isSafeReleaseArtifactReference } from "../src/runtime/path-security.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotRoot = join(repositoryRoot, "public", "data", EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID);
const ledgerRoot = join(repositoryRoot, "data", "normalized", EXTERIOR_WAVE_LEDGER_RELEASE_ID);
const encoder = new TextEncoder();

function fail(message) { console.error(`STOP: ${message}`); process.exit(1); }
function serialize(value) { return `${JSON.stringify(value, null, 2)}\n`; }

/**
 * Wave `w00` has no committed `V3WaveProfile`: Block 835 shipped through the
 * block835 package builder, not the wave builder. Its identity fields are taken
 * from that release's own constants rather than borrowed from a neighbouring
 * wave, so the successor's lineage is the release it actually descends from.
 */
const BLOCK835_W00_BASE_PROFILE = {
  releaseId: "manhattan-exterior-cells-20260811-v3",
  generatedAt: BLOCK835_V3_GENERATED_AT,
  seed: BLOCK835_V3_SEED,
  tool: { ...BLOCK835_V3_TOOL },
  uncertainty: DETERMINISTIC_FACADE_V3T_UNCERTAINTY,
  budgets: { ...V3T_QUALITY_BUDGETS },
  texture: PROCEDURAL_TEXTURE_PROFILE,
  textureFilter: { ...PROCEDURAL_TEXTURE_SAMPLER_FILTER },
  admissionEnvelope: V3_FROZEN_WAVE_ADMISSION_ENVELOPE,
};

export const WAVE_BASE_PROFILES = {
  w00: BLOCK835_W00_BASE_PROFILE,
  w01: MIDTOWN_CORE_V3_WAVE_PROFILE,
  w02: LOWER_MANHATTAN_WAVE_PROFILE,
  w03: SOUTHERN_REMAINDER_WAVE_PROFILE,
  w04: CENTRAL_UPPER_MANHATTAN_WAVE_PROFILE,
  w05: NORTHERN_MANHATTAN_WAVE_PROFILE,
};

/** GLBs byte-replayed per wave. */
export const REPLAY_SAMPLE_SIZE = 40;

/** Owned parents per wave, from the immutable ledger. Checked, never assumed. */
export const WAVE_OWNED_PARENTS = { w00: 14, w01: 7_201, w02: 6_425, w03: 9_603, w04: 11_721, w05: 10_230 };

function waveOf(cellId) {
  const match = /^manhattan-exterior-cell-(w\d{2})-/u.exec(cellId);
  if (!match) fail(`cell id ${cellId} does not name a wave.`);
  return match[1];
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
  if (!gate.ok) fail(`${gate.message}\n\nA retention wave cannot run against an unverified base. Nothing was written.`);
  const manifest = JSON.parse(await readFile(join(snapshotRoot, "manifest.json"), "utf8"));
  const shards = [];
  let byteMismatch = 0;
  let checksumMismatch = 0;
  for (const shard of manifest.geometryShards.filter((entry) => entry.layer === "buildings")) {
    if (!isSafeReleaseArtifactReference(shard.relativeContentRef)) fail(`Shard reference ${shard.relativeContentRef} is not a canonical safe relative path.`);
    const text = await readFile(join(snapshotRoot, shard.relativeContentRef), "utf8");
    if (encoder.encode(text).byteLength !== shard.byteSize) byteMismatch += 1;
    if (sha256HexSync(text) !== shard.checksumSha256) checksumMismatch += 1;
    shards.push(JSON.parse(text));
  }
  if (byteMismatch > 0) fail(`${byteMismatch} building shards do not match their declared byte size.`);
  if (checksumMismatch > 0) fail(`${checksumMismatch} building shards do not match their declared SHA-256 checksum.`);
  return { manifest, shards, manifestChecksumSha256: manifest.manifestChecksumSha256 ?? sha256HexSync(JSON.stringify(manifest)) };
}

async function loadLedger() {
  const ledger = JSON.parse(await readFile(join(ledgerRoot, "ledger.json"), "utf8"));
  const checksum = exteriorArtifactChecksum(ledger);
  const recorded = (await readFile(join(ledgerRoot, "ledger.sha256"), "utf8")).trim().split(/\s+/u)[0];
  if (recorded !== checksum) fail(`Committed ledger checksum ${checksum} does not match its recorded ${recorded}.`);
  const validation = validateExteriorWaveLedger(ledger);
  if (!validation.ok) fail(`Committed ledger fails its own schema: ${JSON.stringify(validation.issues.slice(0, 3))}`);
  return { ledger, ledgerChecksumSha256: checksum };
}

async function writeFileAt(root, relativeRef, bytes) {
  const path = join(root, ...relativeRef.split("/"));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

async function runWave(waveId, options) {
  const base = WAVE_BASE_PROFILES[waveId];
  if (!base) fail(`unknown wave ${waveId}; expected one of ${Object.keys(WAVE_BASE_PROFILES).join(", ")}.`);
  const profile = massGenerationSuccessorProfile(base);
  const releaseId = profile.releaseId;

  const started = Date.now();
  const { shards, manifestChecksumSha256 } = await loadSources();
  const { ledger, ledgerChecksumSha256 } = await loadLedger();

  const cells = ledger.cells.filter((cell) => waveOf(cell.cellId) === waveId).sort((left, right) => left.order - right.order);
  if (cells.length === 0) fail(`wave ${waveId} owns no cell in the committed ledger.`);
  const owned = cells.reduce((total, cell) => total + cell.buildingIds.length, 0);
  if (owned !== WAVE_OWNED_PARENTS[waveId]) fail(`wave ${waveId} owns ${owned} parents in the ledger, expected ${WAVE_OWNED_PARENTS[waveId]}.`);

  const wanted = new Set(cells.flatMap((cell) => cell.buildingIds));
  const sources = collectMidtownCoreSources(shards, wanted);
  if (sources.size !== owned) fail(`resolved ${sources.size} sources for ${owned} owned parents.`);

  const payloadRoot = join(repositoryRoot, "public", "data", releaseId);
  const recordRoot = join(repositoryRoot, "data", releaseId);
  if (existsSync(payloadRoot)) {
    if (!options.force) fail(`${payloadRoot} already exists; pass --force to replace this LOCAL, GITIGNORED payload.`);
    await rm(payloadRoot, { recursive: true, force: true });
  }
  await mkdir(payloadRoot, { recursive: true });
  await mkdir(recordRoot, { recursive: true });

  // -------------------------------------------------------------------------
  // Cell by cell: materialize, write, drop.
  // -------------------------------------------------------------------------
  const files = [];
  const cellManifests = [];
  const tombstones = [];
  const lod1DecisionRows = [];
  const refusalsByCode = {};
  const styleClassCounts = {};
  const sharedTextureClasses = new Set();
  const planHashes = new Set();
  let generatedBuildingCount = 0;
  let generatedAssetCount = 0;
  let lod1FallbackCount = 0;
  let worstMeasuredDeviationRatio = 0;
  let worstShedProtrusionsDeviationRatio = 0;
  let worstVolumeDeviation = 0;
  let totalTriangleCount = 0;
  let maximumTriangleCount = 0;
  let fallbackHeightCount = 0;
  let reversedRingCount = 0;
  let absentSetbackCount = 0;

  const rootIdentity = {
    rootId: `root:${releaseId}:retention`,
    releaseId,
    predecessorReleaseId: base.releaseId,
    waveId,
    cityId: ledger.cityId,
    configId: ledger.configId,
    generatedAt: profile.generatedAt,
    baseIdentitySet: { id: ledger.baseIdentitySet.id, checksumSha256: ledger.baseIdentitySet.checksumSha256 },
    ownershipLedger: { id: ledger.ledgerId, checksumSha256: ledgerChecksumSha256 },
  };
  // The manifests cite the root's checksum, and the root pins the manifests'.
  // That is circular unless one side is fixed first, so the root is pinned over
  // its IDENTITY and admission — the facts a manifest cites — and the cell list
  // is appended afterwards under that same pin.
  const rootPinDraft = {
    schemaVersion: "1.0",
    ...rootIdentity,
    immutable: true,
    textureAdmission: TEXTURE_ADMISSION,
    cellManifests: [],
    retention: RETENTION_STATEMENT,
  };
  const rootChecksumSha256 = retentionRootChecksum(rootPinDraft);

  let cellIndex = 0;
  for (const cell of cells) {
    cellIndex += 1;
    const materialization = materializeMidtownCoreV3Cells({
      cells: [cell],
      sources,
      baseManifestChecksumSha256: manifestChecksumSha256,
      capture: { capturedAt: CAPTURE.capturedAt, updatedAt: CAPTURE.updatedAt },
      retainAllLods: true,
      retain: "shipped-bytes",
      profile,
      assemblyLods: { lod0MaxDistanceMeters: null },
    });

    for (const [buildingId, reason] of materialization.refusals) {
      tombstones.push({ buildingId, ownerCellId: cell.cellId, stopCode: materialization.refusalCodes.get(buildingId) ?? "unknown", reason });
    }
    for (const [code, count] of Object.entries(materialization.census.refusalsByCode)) refusalsByCode[code] = (refusalsByCode[code] ?? 0) + count;
    for (const [style, count] of Object.entries(materialization.census.styleClassCounts)) styleClassCounts[style] = (styleClassCounts[style] ?? 0) + count;
    for (const textureClass of materialization.sharedTextureClasses) sharedTextureClasses.add(textureClass);
    for (const [buildingId, decision] of materialization.lod1Decisions) {
      lod1DecisionRows.push({ buildingId, ownerCellId: cell.cellId, ...decision });
      if (decision.variant === "full-geometry") lod1FallbackCount += 1;
      worstMeasuredDeviationRatio = Math.max(worstMeasuredDeviationRatio, decision.measuredDeviationRatio);
      if (decision.variant === "shed-protrusions") worstShedProtrusionsDeviationRatio = Math.max(worstShedProtrusionsDeviationRatio, decision.emittedDeviationRatio);
    }
    for (const building of materialization.buildings) planHashes.add(building.planHashSha256);
    absentSetbackCount += materialization.absentSetbacks.size;
    generatedBuildingCount += materialization.buildings.length;
    generatedAssetCount += materialization.census.shippedAssetCount;
    worstVolumeDeviation = Math.max(worstVolumeDeviation, materialization.census.worstVolumeDeviation);
    totalTriangleCount += materialization.census.totalShippedTriangleCount;
    maximumTriangleCount = Math.max(maximumTriangleCount, materialization.census.maximumTriangleCount);
    fallbackHeightCount += materialization.census.fallbackHeightCount;
    reversedRingCount += materialization.census.reversedRingCount;

    // GLB bytes first, so the manifest that names them is never written before
    // the bytes it declares exist.
    for (const [relativeRef, bytes] of materialization.assetBytes) {
      await writeFileAt(payloadRoot, relativeRef, bytes);
      files.push({ path: relativeRef, byteSize: bytes.byteLength, checksumSha256: sha256HexBytes(bytes) });
    }

    if (materialization.buildings.length === 0) {
      // A cell whose every owned parent was refused packages nothing. It is
      // stated in the census as tombstones and carries no manifest, because an
      // assembly manifest with no asset declares nothing to check.
      continue;
    }
    const cellPackage = buildRetentionCellPackage({
      cell,
      releaseId,
      generatedAt: profile.generatedAt,
      cityId: ledger.cityId,
      configId: ledger.configId,
      rootId: rootIdentity.rootId,
      rootChecksumSha256,
      baseIdentitySet: rootIdentity.baseIdentitySet,
      ownershipLedger: rootIdentity.ownershipLedger,
      buildings: materialization.buildings,
      assemblyLods: materialization.assemblyLods,
      inventoryId: (buildingId) => midtownCoreV3InventoryId(buildingId, releaseId),
      evidenceShardId: (buildingId) => midtownCoreV3EvidenceShardId(buildingId, releaseId),
      uncertainty: profile.uncertainty,
      sourceDates: { capturedAt: CAPTURE.capturedAt, updatedAt: CAPTURE.updatedAt },
    });
    for (const [relativeRef, bytes] of cellPackage.files) {
      await writeFileAt(payloadRoot, relativeRef, bytes);
      files.push({ path: relativeRef, byteSize: bytes.byteLength, checksumSha256: sha256HexBytes(bytes) });
    }
    const manifestBytes = cellPackage.files.get(cellPackage.manifestRef);
    cellManifests.push({
      cellId: cell.cellId,
      relativeRef: retentionCellManifestRef(cell.cellId),
      byteSize: manifestBytes.byteLength,
      checksumSha256: sha256HexBytes(manifestBytes),
    });
    if (cellIndex % 25 === 0 || cellIndex === cells.length) {
      console.log(`  ${waveId} cell ${cellIndex}/${cells.length} generated=${generatedBuildingCount} tombstoned=${tombstones.length} elapsed=${Math.round((Date.now() - started) / 1000)}s`);
    }
  }

  // Shared detail tiles, written once for the package.
  const catalog = proceduralTextureCatalog();
  for (const textureClass of [...sharedTextureClasses].sort()) {
    const tile = catalog.get(textureClass);
    if (!tile) fail(`detail tile ${textureClass} is not a class this repository's rasterizer produces.`);
    const relativeRef = sharedTextureArtifactRef(textureClass);
    await writeFileAt(payloadRoot, relativeRef, tile.pngBytes);
    files.push({ path: relativeRef, byteSize: tile.pngBytes.byteLength, checksumSha256: sha256HexBytes(tile.pngBytes) });
  }

  // The root, under the pin computed before any manifest was written.
  const root = { ...rootPinDraft, cellManifests, rootChecksumSha256 };
  const rootBytes = encoder.encode(serialize(root));
  await writeFileAt(payloadRoot, RETENTION_ROOT_REF, rootBytes);
  files.push({ path: RETENTION_ROOT_REF, byteSize: rootBytes.byteLength, checksumSha256: sha256HexBytes(rootBytes) });

  if (generatedBuildingCount + tombstones.length !== owned) {
    fail(`wave ${waveId} does not account for itself: ${generatedBuildingCount} generated + ${tombstones.length} tombstoned != ${owned} owned.`);
  }

  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const inventory = {
    schemaVersion: "1.0",
    releaseId,
    waveId,
    payloadDirectory: `public/data/${releaseId}`,
    note: "The payload directory is intentionally untracked and LOCAL ONLY. This inventory is the committed record that keeps every emitted byte checkable after the local tree is removed. Nothing here is served, published or conveyed.",
    base: { releaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID, manifestChecksumSha256 },
    parentLedger: { releaseId: EXTERIOR_WAVE_LEDGER_RELEASE_ID, checksumSha256: ledgerChecksumSha256 },
    predecessorReleaseId: base.releaseId,
    retentionRoot: { rootId: rootIdentity.rootId, rootChecksumSha256 },
    textureAdmission: TEXTURE_ADMISSION,
    cellManifestCount: cellManifests.length,
    totals: { fileCount: files.length, byteSize: files.reduce((total, file) => total + file.byteSize, 0) },
    files,
  };
  await writeFile(join(recordRoot, "payload-inventory.json"), serialize(inventory));
  const inventoryChecksum = sha256HexSync(serialize(inventory));
  await writeFile(join(recordRoot, "payload-inventory.sha256"), `${inventoryChecksum}  payload-inventory.json\n`);

  const census = {
    schemaVersion: "1.0",
    releaseId,
    waveId,
    predecessorReleaseId: base.releaseId,
    generatedAt: profile.generatedAt,
    ownedBuildingCount: owned,
    cellCount: cells.length,
    generatedBuildingCount,
    tombstonedBuildingCount: tombstones.length,
    generatedAssetCount,
    admissionEnvelope: MASS_GENERATION_ADMISSION_ENVELOPE,
    lod1Policy: profile.lod1Policy,
    lod1FallbackCount,
    worstMeasuredDeviationRatio,
    worstShedProtrusionsDeviationRatio,
    aggregate: {
      uniquePlanHashCount: planHashes.size,
      totalShippedTriangleCount: totalTriangleCount,
      maximumTriangleCount,
      worstVolumeDeviation,
      fallbackHeightCount,
      reversedRingCount,
      tierCollapseAbsentSetbackCount: absentSetbackCount,
      refusalsByCode,
      styleClassCounts,
    },
    tombstones: tombstones.sort((left, right) => (left.buildingId < right.buildingId ? -1 : 1)),
    lod1Decisions: lod1DecisionRows.sort((left, right) => (left.buildingId < right.buildingId ? -1 : 1)),
    blenderAgreement: {
      status: "pending Blender connection",
      note: "The per-wave 16-sample Blender agreement is a SEPARATE evidence item and has NOT been run for this wave. Blender MCP was disconnected for the whole of this run. Nothing has been substituted for it: no render, no screenshot and no proxy measurement stands in its place, and no visual or architectural acceptance is claimed by this record.",
    },
    rights: {
      statement: RETENTION_STATEMENT,
      conveyance: "none",
      approvalEnvelopeChange: "none",
      servingSurfaceChange: "none",
      retention: "gitignored payload, committed inventory and census only",
    },
  };
  await writeFile(join(recordRoot, "wave-census.json"), serialize(census));
  await writeFile(join(recordRoot, "wave-census.sha256"), `${sha256HexSync(serialize(census))}  wave-census.json\n`);

  console.log(serialize({
    ok: true,
    waveId,
    releaseId,
    ownedBuildingCount: owned,
    generatedBuildingCount,
    tombstonedBuildingCount: tombstones.length,
    lod1FallbackCount,
    cellManifestCount: cellManifests.length,
    totalBytes: inventory.totals.byteSize,
    elapsedSeconds: Math.round((Date.now() - started) / 1000),
  }));
}


/**
 * STRATIFIED BYTE REPLAY.
 *
 * Regenerates a deterministic sample of the wave's GLBs from the same pinned
 * inputs and byte-compares them against the committed inventory. Stratified by
 * ownership cell through a stride over the cell order rather than taken from
 * the front, so the sample cannot all come from one neighbourhood — a
 * front-loaded sample would replay the first cells and say nothing about the
 * last.
 */
async function runReplay(waveId, sampleSize) {
  const base = WAVE_BASE_PROFILES[waveId];
  if (!base) fail(`unknown wave ${waveId}.`);
  const profile = massGenerationSuccessorProfile(base);
  const releaseId = profile.releaseId;
  const recordRoot = join(repositoryRoot, "data", releaseId);
  const inventory = JSON.parse(await readFile(join(recordRoot, "payload-inventory.json"), "utf8"));
  const declared = new Map(inventory.files.filter((file) => file.path.endsWith(".glb")).map((file) => [file.path, file]));
  if (declared.size === 0) fail(`inventory for ${releaseId} declares no GLB.`);

  const { shards, manifestChecksumSha256 } = await loadSources();
  const { ledger } = await loadLedger();
  const cells = ledger.cells.filter((cell) => waveOf(cell.cellId) === waveId).sort((left, right) => left.order - right.order);
  const wanted = new Set(cells.flatMap((cell) => cell.buildingIds));
  const sources = collectMidtownCoreSources(shards, wanted);

  // Stride the CELLS, then take from each until the sample is full.
  const stride = Math.max(1, Math.floor(cells.length / Math.min(sampleSize, cells.length)));
  const picked = [];
  for (let index = 0; index < cells.length && picked.length < sampleSize; index += stride) picked.push(cells[index]);
  for (let index = 0; index < cells.length && picked.length < sampleSize; index += 1) if (!picked.includes(cells[index])) picked.push(cells[index]);

  let compared = 0;
  let identical = 0;
  const mismatches = [];
  for (const cell of picked) {
    if (compared >= sampleSize) break;
    const materialization = materializeMidtownCoreV3Cells({
      cells: [cell],
      sources,
      baseManifestChecksumSha256: manifestChecksumSha256,
      capture: { capturedAt: CAPTURE.capturedAt, updatedAt: CAPTURE.updatedAt },
      retainAllLods: true,
      retain: "shipped-bytes",
      profile,
      assemblyLods: { lod0MaxDistanceMeters: null },
    });
    const refs = [...materialization.assetBytes.keys()].sort();
    for (const ref of refs) {
      if (compared >= sampleSize) break;
      const expected = declared.get(ref);
      if (!expected) { mismatches.push({ ref, reason: "not declared by the committed inventory" }); compared += 1; continue; }
      const bytes = materialization.assetBytes.get(ref);
      const checksum = sha256HexBytes(bytes);
      compared += 1;
      if (bytes.byteLength === expected.byteSize && checksum === expected.checksumSha256) identical += 1;
      else mismatches.push({ ref, declaredBytes: expected.byteSize, replayedBytes: bytes.byteLength, declaredChecksum: expected.checksumSha256, replayedChecksum: checksum });
    }
  }
  const record = {
    schemaVersion: "1.0",
    releaseId,
    waveId,
    artifact: "stratified-byte-replay",
    note: "Regenerated from the same pinned snapshot and ledger and byte-compared against the committed payload inventory. A byte-identical replay is a determinism statement about this repository's generator; it is not visual, geographic or performance acceptance.",
    declaredGlbCount: declared.size,
    cellsSampled: picked.length,
    requestedSample: sampleSize,
    comparedGlbCount: compared,
    byteIdenticalCount: identical,
    mismatches,
    ok: mismatches.length === 0 && compared > 0,
  };
  await writeFile(join(recordRoot, "determinism-replay.json"), serialize(record));
  await writeFile(join(recordRoot, "determinism-replay.sha256"), `${sha256HexSync(serialize(record))}  determinism-replay.json\n`);
  if (!record.ok) fail(`byte replay found ${mismatches.length} mismatch(es) over ${compared} GLBs.`);
  console.log(serialize({ ok: true, waveId, comparedGlbCount: compared, byteIdenticalCount: identical, cellsSampled: picked.length }));
}

/** Real capture chronology of the pinned base snapshot. */
const CAPTURE = { capturedAt: "2026-08-04T00:00:00.000Z", updatedAt: "2026-08-04T00:00:00.000Z" };

const TEXTURE_ADMISSION = {
  policy: "procedural-replay",
  generatedTextureFact: {
    basis: "generated-texture",
    profile: PROCEDURAL_TEXTURE_PROFILE,
    gate: "rasterizer-replay",
    evidenceBasis: null,
    samplerFilter: { ...PROCEDURAL_TEXTURE_SAMPLER_FILTER },
    statement: "Facade detail tiles in this retention package are four grayscale, pattern-only motifs generated from named constants in this repository and delivered by shared URI. They carry luminance modulation and no colour, cite no evidence record, and reproduce no photograph: the retention validator re-rasterizes the catalogue and requires byte equality with every declared tile, so a tile derived from an image cannot pass. No tile asserts the material, colour, age, or condition of any real building.",
  },
};

async function main() {
  const argv = process.argv.slice(2);
  const positional = argv.filter((token) => !token.startsWith("--"));
  const force = argv.includes("--force");
  const replay = argv.includes("--replay");
  for (const token of argv.filter((item) => item.startsWith("--"))) {
    if (token !== "--force" && token !== "--replay") fail(`unknown flag ${token}.`);
  }
  if (positional.length !== 1) {
    console.error("usage: node scripts/mass-generation-wave-cli.mjs <w00|w01|w02|w03|w04|w05> [--force] [--replay]");
    console.error("The wave is REQUIRED. There is no default: a bare invocation would generate an island.");
    process.exit(1);
  }
  if (replay) await runReplay(positional[0], REPLAY_SAMPLE_SIZE);
  else await runWave(positional[0], { force });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exit(1); });
}
