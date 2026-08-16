/* global console, process, TextEncoder, TextDecoder */
/**
 * The T005 SERVING WAVE driver: one retained `-c1` wave becomes one `-s1`
 * release the browser can load.
 *
 * ## It regenerates no geometry
 *
 * Every GLB, every detail tile and every measured quality figure is COPIED from
 * the retention package T004 validated and committed an inventory for. What this
 * driver produces is the release surface around those bytes: a wave-scoped
 * ownership ledger, one cell release per owned cell, one fetched evidence
 * sidecar and one fetched assembly package per content-bearing cell, a rollout
 * snapshot, two roots and a runtime index. See `exterior-serving-release.ts` for
 * why a transform rather than a rebuild.
 *
 * ## What it DOES regenerate, and why it has to
 *
 * Inventories. A `-c1` assembly manifest pins each asset's `inventoryHashSha256`
 * but does not carry the inventory itself — the retention package had no
 * evidence surface, because nothing was served. A serving release must carry one
 * per shipped building, so this driver re-runs `buildMidtownCoreV3Plan` under the
 * SAME successor profile the wave was generated with and takes `plan.inventory`.
 *
 * That is not trusted. Every regenerated inventory is hashed and compared
 * against what the retained manifest declared, and a single mismatch stops the
 * wave. So the regeneration is a DERIVATION whose correctness is proven against
 * the retained bytes, not a second opinion about them.
 *
 * The inventory and evidence-shard IDS it publishes are the RETENTION release's,
 * not this release's, and every one is compared against the retained manifest
 * asset that declares it. See `servingInventoryId` for why they have to be: the
 * ids are inside the immutable GLB bytes, so it is the record ids that move.
 *
 * ## Copies, never links
 *
 * Payload GLBs are read and written as bytes. A hardlink would make the served
 * file and the retained file one inode, so a later edit or a truncated write
 * against either would silently corrupt the other — and the retention packages
 * are the evidence base for the whole island. There is disk for two copies;
 * there is no recovering a shared-inode corruption.
 *
 * ## Nothing here promotes
 *
 * No activation record is written, no default moves, and the emitted release is
 * reachable only through an explicit `?exteriorCells=` opt-in until a separate,
 * reviewed promotion commit says otherwise.
 */
import { mkdir, readFile, readdir, rm, writeFile, lstat } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexBytes, sha256HexSync, stableSerialize } from "../src/domain/deterministic-hash.ts";
import { EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID } from "../src/domain/exterior-fullsnapshot-input.ts";
import { verifyCitywideSnapshot } from "../src/release/citywide-snapshot-gate.ts";
import { EXTERIOR_WAVE_LEDGER_RELEASE_ID, exteriorArtifactChecksum, validateExteriorWaveLedger } from "../src/release/exterior-wave-ledger.ts";
import { collectMidtownCoreSources } from "../src/release/midtown-core-source.ts";
import { buildMidtownCoreV3Plan, MidtownCoreV3Stop } from "../src/release/midtown-core-v3-materialization.ts";
import { massGenerationSuccessorProfile, retentionCellManifestRef, retentionRootChecksum, validateRetentionReleaseRoot } from "../src/release/mass-generation-retention.ts";
import { validateExteriorReleaseGraph, validateExteriorCellDetailSidecar } from "../src/release/exterior-release.ts";
import { replayMultiLodAssembly, validateMultiLodAssembly } from "../src/release/multi-lod-assembly.ts";
import { isSafeReleaseArtifactReference } from "../src/runtime/path-security.ts";
import {
  buildServingCellDetailSidecar,
  buildServingCellRelease,
  buildServingIndex,
  buildServingOwnershipLedger,
  buildServingPrivateRoot,
  buildServingPublicRoot,
  buildServingSnapshot,
  servingArtifactBlob,
  servingAssemblyBlob,
  servingArtifactRef,
  servingAssemblyPackageId,
  servingCellReleaseId,
  servingDocumentBlob,
  servingSourceRights,
  servingTilesetRef,
  transformRetentionAssemblyToServing,
  transformRetentionTilesetToServing,
} from "../src/release/exterior-serving-release.ts";
import {
  EXTERIOR_SERVING_BASE_RELEASE_IDS,
  EXTERIOR_SERVING_CAPTURE,
  EXTERIOR_SERVING_EVIDENCE_ID,
  EXTERIOR_SERVING_GENERATED_AT,
  EXTERIOR_SERVING_TEXTURE_ADMISSION,
  EXTERIOR_SERVING_WAVES,
  exteriorServingApproval,
  exteriorServingWave,
} from "../src/release/exterior-serving-waves.ts";
import { WAVE_BASE_PROFILES } from "./mass-generation-wave-cli.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotRoot = join(repositoryRoot, "public", "data", EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID);
const ledgerRoot = join(repositoryRoot, "data", "normalized", EXTERIOR_WAVE_LEDGER_RELEASE_ID);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function fail(message) { console.error(`STOP: ${message}`); process.exit(1); }
function serialize(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function compareText(left, right) { return left < right ? -1 : left > right ? 1 : 0; }

// ---------------------------------------------------------------------------
// Pinned inputs
// ---------------------------------------------------------------------------

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
  if (!gate.ok) fail(`${gate.message}\n\nA serving wave cannot be cut against an unverified base. Nothing was written.`);
  const manifest = JSON.parse(await readFile(join(snapshotRoot, "manifest.json"), "utf8"));
  const shards = [];
  for (const shard of manifest.geometryShards.filter((entry) => entry.layer === "buildings")) {
    if (!isSafeReleaseArtifactReference(shard.relativeContentRef)) fail(`Shard reference ${shard.relativeContentRef} is not a canonical safe relative path.`);
    const text = await readFile(join(snapshotRoot, shard.relativeContentRef), "utf8");
    if (encoder.encode(text).byteLength !== shard.byteSize) fail(`Base shard ${shard.relativeContentRef} does not match its declared byte size.`);
    if (sha256HexSync(text) !== shard.checksumSha256) fail(`Base shard ${shard.relativeContentRef} does not match its declared SHA-256.`);
    shards.push(JSON.parse(text));
  }
  return { shards, manifestChecksumSha256: manifest.manifestChecksumSha256 ?? sha256HexSync(JSON.stringify(manifest)) };
}

async function loadIslandLedger() {
  const ledger = JSON.parse(await readFile(join(ledgerRoot, "ledger.json"), "utf8"));
  const checksum = exteriorArtifactChecksum(ledger);
  const recorded = (await readFile(join(ledgerRoot, "ledger.sha256"), "utf8")).trim().split(/\s+/u)[0];
  if (recorded !== checksum) fail(`Committed island ledger checksum ${checksum} does not match its recorded ${recorded}.`);
  const validation = validateExteriorWaveLedger(ledger);
  if (!validation.ok) fail(`Committed island ledger fails its own schema: ${JSON.stringify(validation.issues.slice(0, 3))}`);
  return ledger;
}

/** The committed `-c1` record pair, each verified against its own `.sha256`. */
async function loadRetentionRecords(retentionReleaseId) {
  const recordRoot = join(repositoryRoot, "data", retentionReleaseId);
  const read = async (name) => {
    const text = await readFile(join(recordRoot, `${name}.json`), "utf8");
    const recorded = (await readFile(join(recordRoot, `${name}.sha256`), "utf8")).trim().split(/\s+/u)[0];
    const actual = sha256HexSync(text);
    if (actual !== recorded) fail(`Committed ${retentionReleaseId}/${name}.json hashes ${actual}, but its recorded checksum is ${recorded}.`);
    return JSON.parse(text);
  };
  return { census: await read("wave-census"), inventory: await read("payload-inventory") };
}

/**
 * The retention payload, present and matching the root it declares.
 *
 * READ ONLY. Nothing in this driver writes to, moves or replaces a `-c1`
 * directory, and `fingerprintRetentionPayload` re-proves that after every wave.
 */
async function loadRetentionPayload(retentionReleaseId) {
  const payloadRoot = join(repositoryRoot, "public", "data", retentionReleaseId);
  if (!existsSync(payloadRoot)) fail(`retention payload ${payloadRoot} is absent; the serving transform reads the retained bytes and cannot invent them.`);
  const rootText = await readFile(join(payloadRoot, "retention-root.json"), "utf8");
  const root = JSON.parse(rootText);
  const validation = validateRetentionReleaseRoot(root);
  if (!validation.ok) fail(`retention root for ${retentionReleaseId} fails its own schema: ${validation.issues.slice(0, 3).join(" | ")}`);
  const recomputed = retentionRootChecksum(root);
  if (recomputed !== root.rootChecksumSha256) fail(`retention root for ${retentionReleaseId} self-pin mismatch: recomputed ${recomputed}, declared ${root.rootChecksumSha256}.`);
  return { payloadRoot, root };
}

async function readPayloadFile(payloadRoot, relativeRef) {
  if (!isSafeReleaseArtifactReference(relativeRef)) fail(`${relativeRef} is not a canonical safe relative path.`);
  return readFile(join(payloadRoot, ...relativeRef.split("/")));
}

async function writeFileAt(root, relativeRef, bytes) {
  const path = join(root, ...relativeRef.split("/"));
  await mkdir(dirname(path), { recursive: true });
  // A serving payload must never be a link into a retention package: one inode
  // shared between the two would make either directory able to corrupt the
  // other's bytes. Nothing here creates a link, and this asserts it.
  const existing = await lstat(path).catch(() => null);
  if (existing?.isSymbolicLink()) fail(`${path} is a symbolic link; a serving payload file must be its own bytes.`);
  if (existing && existing.nlink > 1) fail(`${path} already has ${existing.nlink} links; a serving payload file must be its own bytes.`);
  await writeFile(path, bytes);
}

// ---------------------------------------------------------------------------
// The retention fingerprint check
// ---------------------------------------------------------------------------

/**
 * Re-proves that every `-c1` payload still matches its committed inventory.
 *
 * Run after every serving wave, because the whole island's evidence base is
 * six local directories that nothing may edit and that this driver reads
 * heavily. It re-hashes every declared file: a byte-size-only check would miss
 * exactly the in-place corruption a shared inode or an interrupted copy causes,
 * which is the failure this exists to catch.
 */
async function fingerprintRetentionPayload(retentionReleaseIds) {
  const results = [];
  for (const retentionReleaseId of retentionReleaseIds) {
    const payloadRoot = join(repositoryRoot, "public", "data", retentionReleaseId);
    if (!existsSync(payloadRoot)) { results.push({ retentionReleaseId, present: false, ok: false, reason: "payload directory absent" }); continue; }
    const { inventory } = await loadRetentionRecords(retentionReleaseId);
    let checked = 0;
    const mismatches = [];
    for (const file of inventory.files) {
      const path = join(payloadRoot, ...file.path.split("/"));
      const info = await lstat(path).catch(() => null);
      if (!info) { mismatches.push({ path: file.path, reason: "absent" }); continue; }
      if (info.isSymbolicLink()) { mismatches.push({ path: file.path, reason: "is a symbolic link" }); continue; }
      if (info.size !== file.byteSize) { mismatches.push({ path: file.path, reason: `byte size ${info.size} != ${file.byteSize}` }); continue; }
      const checksum = sha256HexBytes(await readFile(path));
      if (checksum !== file.checksumSha256) { mismatches.push({ path: file.path, reason: `checksum ${checksum} != ${file.checksumSha256}` }); continue; }
      checked += 1;
    }
    results.push({ retentionReleaseId, present: true, declaredFileCount: inventory.files.length, verifiedFileCount: checked, mismatches: mismatches.slice(0, 10), mismatchCount: mismatches.length, ok: mismatches.length === 0 && checked === inventory.files.length });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

async function runEmit(waveId, options) {
  const started = Date.now();
  const waveEntry = exteriorServingWave(waveId);
  const base = WAVE_BASE_PROFILES[waveId];
  if (!base) fail(`unknown wave ${waveId}.`);
  const profile = massGenerationSuccessorProfile(base);
  if (profile.releaseId !== waveEntry.retentionReleaseId) {
    fail(`wave ${waveId} successor profile names ${profile.releaseId}, but the serving table expects ${waveEntry.retentionReleaseId}.`);
  }
  const releaseId = waveEntry.servingReleaseId;

  const { census, inventory: retentionInventory } = await loadRetentionRecords(waveEntry.retentionReleaseId);
  if (census.waveId !== waveId) fail(`committed census for ${waveEntry.retentionReleaseId} names wave ${census.waveId}.`);
  for (const [field, expected] of [["cellCount", waveEntry.cellCount], ["ownedBuildingCount", waveEntry.ownedBuildingCount], ["generatedBuildingCount", waveEntry.generatedBuildingCount], ["tombstonedBuildingCount", waveEntry.tombstonedBuildingCount]]) {
    if (census[field] !== expected) fail(`committed census for ${waveEntry.retentionReleaseId} declares ${field} ${census[field]}, but the serving table expects ${expected}.`);
  }
  const { payloadRoot: retentionPayloadRoot, root: retentionRoot } = await loadRetentionPayload(waveEntry.retentionReleaseId);
  const declaredRetentionFiles = new Map(retentionInventory.files.map((file) => [file.path, file]));

  const islandLedger = await loadIslandLedger();
  const waveCells = islandLedger.cells
    .filter((cell) => cell.cellId.startsWith(`manhattan-exterior-cell-${waveId}-`))
    .sort((left, right) => compareText(left.cellId, right.cellId));
  if (waveCells.length !== waveEntry.cellCount) fail(`island ledger declares ${waveCells.length} cells for wave ${waveId}, expected ${waveEntry.cellCount}.`);

  const ledger = buildServingOwnershipLedger({
    releaseId,
    cityId: islandLedger.cityId,
    configId: islandLedger.configId,
    cells: waveCells.map((cell) => ({ cellId: cell.cellId, bounds: cell.bounds, buildingIds: cell.buildingIds })),
  });
  if (ledger.baseIdentitySet.buildingCount !== waveEntry.ownedBuildingCount) {
    fail(`derived serving ledger owns ${ledger.baseIdentitySet.buildingCount} buildings, expected ${waveEntry.ownedBuildingCount}.`);
  }

  const approval = exteriorServingApproval(waveEntry);
  const rights = servingSourceRights(approval.id, `license:nyc.building-footprints`);
  const tombstoneReasons = new Map(census.tombstones.map((entry) => [entry.buildingId, entry.reason]));

  const payloadRoot = join(repositoryRoot, "public", "data", releaseId);
  const recordRoot = join(repositoryRoot, "data", releaseId);
  if (existsSync(payloadRoot)) {
    if (!options.force) fail(`${payloadRoot} already exists; pass --force to replace this LOCAL, GITIGNORED payload.`);
    await rm(payloadRoot, { recursive: true, force: true });
  }
  await mkdir(payloadRoot, { recursive: true });
  await mkdir(recordRoot, { recursive: true });

  const { shards, manifestChecksumSha256 } = await loadSources();
  const wanted = new Set(waveCells.flatMap((cell) => cell.buildingIds));
  const sources = collectMidtownCoreSources(shards, wanted);
  if (sources.size !== waveEntry.ownedBuildingCount) fail(`resolved ${sources.size} base sources for ${waveEntry.ownedBuildingCount} owned buildings.`);

  const retentionManifestByCell = new Map(retentionRoot.cellManifests.map((entry) => [entry.cellId, entry]));
  const emittedFiles = [];
  const record = async (relativeRef, bytes) => {
    await writeFileAt(payloadRoot, relativeRef, bytes);
    emittedFiles.push({ path: relativeRef, byteSize: bytes.byteLength, checksumSha256: sha256HexBytes(bytes) });
  };

  // -------------------------------------------------------------------------
  // Pass 1: cell releases and evidence sidecars, one cell at a time.
  // -------------------------------------------------------------------------
  const cellReleases = [];
  const publicArtifacts = [];
  const cellReleaseRefs = new Map();
  const assemblyPackageRefs = [];
  const contentCellIds = [];
  let availableBuildingCount = 0;
  let unavailableBuildingCount = 0;
  let inventoryRegenCount = 0;
  const sharedTextureRefs = new Set();

  let index = 0;
  for (const cell of ledger.cells) {
    index += 1;
    const declaredManifest = retentionManifestByCell.get(cell.cellId);
    const manifest = declaredManifest ? await readRetentionManifest(retentionPayloadRoot, declaredManifest) : null;
    const availableBuildingIds = manifest ? manifest.assets.map((asset) => asset.canonicalFeatureId).sort(compareText) : [];

    const cellRelease = buildServingCellRelease({
      releaseId,
      recordReleaseId: waveEntry.retentionReleaseId,
      ledger,
      cell,
      approval,
      availableBuildingIds,
      unavailableReasons: tombstoneReasons,
    });
    cellReleases.push(cellRelease);
    availableBuildingCount += availableBuildingIds.length;
    unavailableBuildingCount += cellRelease.buildingDetails.length - availableBuildingIds.length;

    const cellReleaseBlob = servingArtifactBlob("public", "cell-release", cellRelease.cellReleaseId, cellRelease);
    await record(cellReleaseBlob.ref.relativeRef, cellReleaseBlob.bytes);
    publicArtifacts.push(cellReleaseBlob.ref);
    cellReleaseRefs.set(cell.cellId, { cellReleaseId: cellRelease.cellReleaseId, checksumSha256: cellReleaseBlob.ref.checksumSha256 });

    if (!manifest) continue;
    contentCellIds.push(cell.cellId);
    for (const artifact of manifest.artifacts) if (artifact.role === "texture") sharedTextureRefs.add(artifact.relativeRef);

    const buildings = [];
    for (const asset of manifest.assets) {
      const source = sources.get(asset.canonicalFeatureId);
      if (!source) fail(`retained cell ${cell.cellId} packages ${asset.canonicalFeatureId}, which resolves to no pinned base source.`);
      let context;
      try {
        context = buildMidtownCoreV3Plan(source, manifestChecksumSha256, profile);
      } catch (error) {
        if (error instanceof MidtownCoreV3Stop) fail(`plan regeneration for ${asset.canonicalFeatureId} was refused [${error.code}] although the retention package shipped it: ${error.detail}`);
        throw error;
      }
      if (context.plan.planId !== asset.source.planId || context.plan.planHashSha256 !== asset.source.planHashSha256) {
        fail(`plan regeneration for ${asset.canonicalFeatureId} produced ${context.plan.planId}/${context.plan.planHashSha256}, but the retained manifest declared ${asset.source.planId}/${asset.source.planHashSha256}.`);
      }
      buildings.push({
        buildingId: asset.canonicalFeatureId,
        sourceRefId: source.sourceRefId,
        sourceRecordId: source.sourceRecordId,
        inventory: context.plan.inventory,
        declaredInventoryHashSha256: asset.inventoryHashSha256,
        declaredInventoryId: asset.inventoryId,
        declaredEvidenceShardId: asset.evidenceShardId,
      });
      inventoryRegenCount += 1;
    }

    const sidecar = buildServingCellDetailSidecar({
      releaseId,
      recordReleaseId: waveEntry.retentionReleaseId,
      cellReleaseId: cellRelease.cellReleaseId,
      approval,
      rights,
      capture: { ...EXTERIOR_SERVING_CAPTURE },
      buildings,
    });
    const sidecarValidation = validateExteriorCellDetailSidecar(sidecar, { cell: cellRelease, artifactRef: sidecar.artifactRef });
    if (!sidecarValidation.ok) fail(`emitted sidecar for ${cell.cellId} fails closed: ${JSON.stringify(sidecarValidation.issues.slice(0, 3))}`);
    const sidecarBlob = servingDocumentBlob("cell-detail-sidecar", cellRelease.cellReleaseId, sidecar);
    await record(sidecarBlob.ref.relativeRef, sidecarBlob.bytes);
    publicArtifacts.push(sidecarBlob.ref);
    assemblyPackageRefs.push({
      logicalId: cellRelease.cellReleaseId,
      relativeRef: servingArtifactRef("public", "cell-assembly-package", cellRelease.cellReleaseId),
    });

    if (index % 25 === 0 || index === ledger.cells.length) {
      console.log(`  ${waveId} cell ${index}/${ledger.cells.length} available=${availableBuildingCount} unavailable=${unavailableBuildingCount} elapsed=${Math.round((Date.now() - started) / 1000)}s`);
    }
  }

  if (availableBuildingCount !== waveEntry.generatedBuildingCount) fail(`serving release ships ${availableBuildingCount} buildings, expected ${waveEntry.generatedBuildingCount}.`);
  if (unavailableBuildingCount !== waveEntry.tombstonedBuildingCount) fail(`serving release tombstones ${unavailableBuildingCount} buildings, expected ${waveEntry.tombstonedBuildingCount}.`);

  // -------------------------------------------------------------------------
  // Ledger, snapshot and the two roots.
  // -------------------------------------------------------------------------
  const privateLedgerBlob = servingArtifactBlob("private", "ownership-ledger", ledger.ledgerId, ledger);
  const publicLedgerBlob = servingArtifactBlob("public", "ownership-ledger", ledger.ledgerId, ledger);
  await record(publicLedgerBlob.ref.relativeRef, publicLedgerBlob.bytes);
  publicArtifacts.push(publicLedgerBlob.ref);

  const snapshot = buildServingSnapshot({ releaseId, ledger, generatedAt: EXTERIOR_SERVING_GENERATED_AT, approval, cellReleaseRefs });
  const snapshotBlob = servingArtifactBlob("public", "rollout-snapshot", snapshot.snapshotId, snapshot);
  await record(snapshotBlob.ref.relativeRef, snapshotBlob.bytes);
  publicArtifacts.push(snapshotBlob.ref);

  const rootInput = { releaseId, ledger, generatedAt: EXTERIOR_SERVING_GENERATED_AT, approval, textureAdmission: EXTERIOR_SERVING_TEXTURE_ADMISSION };
  const privateRoot = buildServingPrivateRoot(rootInput, privateLedgerBlob);
  const publicDraft = buildServingPublicRoot({
    ...rootInput,
    privateRoot,
    artifacts: publicArtifacts,
    assemblyPackageRefs,
    predecessor: null,
  });

  // -------------------------------------------------------------------------
  // Pass 2: tilesets, assembly packages and the copied payload.
  // -------------------------------------------------------------------------
  const assemblyAccounting = new Map();
  const assemblyPackageIds = [];
  let copiedAssetCount = 0;
  let copiedAssetBytes = 0;
  index = 0;
  for (const cellId of contentCellIds) {
    index += 1;
    const declaredManifest = retentionManifestByCell.get(cellId);
    const manifest = await readRetentionManifest(retentionPayloadRoot, declaredManifest);
    const cellReleaseId = servingCellReleaseId(releaseId, cellId);

    const retainedTilesetRef = manifest.artifacts.find((artifact) => artifact.role === "tileset-json")?.relativeRef;
    if (!retainedTilesetRef) fail(`retained cell ${cellId} declares no tileset artifact.`);
    const retainedTileset = JSON.parse(decoder.decode(await readRetentionPayloadFile(retentionPayloadRoot, retainedTilesetRef, declaredRetentionFiles)));
    const servingTileset = transformRetentionTilesetToServing(retainedTileset);
    const tilesetBytes = encoder.encode(`${stableSerialize(servingTileset)}\n`);
    await record(servingTilesetRef(cellId), tilesetBytes);

    const servingManifest = transformRetentionAssemblyToServing(manifest, {
      packageId: servingAssemblyPackageId(releaseId, cellId),
      generatedAt: EXTERIOR_SERVING_GENERATED_AT,
      release: {
        rootId: publicDraft.root.rootId,
        rootChecksumSha256: publicDraft.root.rootChecksumSha256,
        releaseId,
        cityId: ledger.cityId,
        configId: ledger.configId,
        privatePredecessor: { id: privateRoot.rootId, checksumSha256: privateRoot.rootChecksumSha256 },
      },
      baseIdentitySet: { id: ledger.baseIdentitySet.id, checksumSha256: ledger.baseIdentitySet.checksumSha256 },
      ownershipLedger: { id: ledger.ledgerId, checksumSha256: publicLedgerBlob.ref.checksumSha256 },
      cellRelease: { id: cellReleaseId, checksumSha256: cellReleaseRefs.get(cellId).checksumSha256 },
      tileset: { byteSize: tilesetBytes.byteLength, checksumSha256: sha256HexBytes(tilesetBytes) },
    });
    const structural = validateMultiLodAssembly(servingManifest, { textureAdmission: "procedural-replay", declaredSamplerFilter: EXTERIOR_SERVING_TEXTURE_ADMISSION.generatedTextureFact.samplerFilter });
    if (!structural.ok) fail(`emitted assembly package for ${cellId} fails closed: ${JSON.stringify(structural.issues.slice(0, 3))}`);

    // The GLBs this package declares, copied byte for byte from the retained
    // package and re-verified against the committed retention inventory.
    for (const artifact of servingManifest.artifacts) {
      if (artifact.role !== "glb") continue;
      const bytes = await readRetentionPayloadFile(retentionPayloadRoot, artifact.relativeRef, declaredRetentionFiles);
      if (bytes.byteLength !== artifact.byteSize || sha256HexBytes(bytes) !== artifact.checksumSha256) {
        fail(`retained GLB ${artifact.relativeRef} does not match the accounting its own manifest declares.`);
      }
      await record(artifact.relativeRef, bytes);
      copiedAssetCount += 1;
      copiedAssetBytes += bytes.byteLength;
    }

    const assemblyBlob = servingAssemblyBlob(servingManifest, cellReleaseId);
    await record(assemblyBlob.ref.relativeRef, assemblyBlob.bytes);
    assemblyAccounting.set(cellReleaseId, { byteSize: assemblyBlob.ref.byteSize, checksumSha256: assemblyBlob.ref.checksumSha256 });
    assemblyPackageIds.push(servingManifest.packageId);

    if (index % 25 === 0 || index === contentCellIds.length) {
      console.log(`  ${waveId} package ${index}/${contentCellIds.length} assets=${copiedAssetCount} bytes=${copiedAssetBytes} elapsed=${Math.round((Date.now() - started) / 1000)}s`);
    }
  }

  // Shared detail tiles, once for the release.
  for (const textureRef of [...sharedTextureRefs].sort(compareText)) {
    const bytes = await readRetentionPayloadFile(retentionPayloadRoot, textureRef, declaredRetentionFiles);
    await record(textureRef, bytes);
  }

  const publicRoot = publicDraft.finalize(assemblyAccounting);
  const graph = {
    schemaVersion: "1.0",
    roots: [privateRoot, publicRoot],
    ownershipLedger: ledger,
    cellReleases,
    inventoryShards: [],
    evidenceShards: [],
    snapshots: [snapshot],
  };
  const graphValidation = validateExteriorReleaseGraph(graph);
  if (!graphValidation.ok) fail(`emitted release graph fails closed: ${JSON.stringify(graphValidation.issues.slice(0, 5))}`);

  const runtimeIndex = buildServingIndex({
    releaseId,
    ledger,
    snapshot,
    snapshotChecksumSha256: snapshotBlob.ref.checksumSha256,
    assemblyPackageIds,
    baseReleaseIds: EXTERIOR_SERVING_BASE_RELEASE_IDS,
  });

  const indexBytes = encoder.encode(serialize(runtimeIndex));
  const graphBytes = encoder.encode(serialize(graph));
  const assembliesBytes = encoder.encode(serialize([]));
  for (const [name, bytes] of [["index.json", indexBytes], ["release-graph.json", graphBytes], ["assemblies.json", assembliesBytes]]) {
    await record(name, bytes);
  }

  // -------------------------------------------------------------------------
  // Committed records
  // -------------------------------------------------------------------------
  emittedFiles.sort((left, right) => compareText(left.path, right.path));
  const payloadInventory = {
    schemaVersion: "1.0",
    releaseId,
    waveId,
    payloadDirectory: `public/data/${releaseId}`,
    note: "The payload directory is intentionally untracked and LOCAL ONLY. This inventory is the committed record that keeps every emitted byte checkable after the local tree is removed. The geometry bytes are COPIES of the retention package named below; nothing here was regenerated.",
    retentionSource: { releaseId: waveEntry.retentionReleaseId, rootId: retentionRoot.rootId, rootChecksumSha256: retentionRoot.rootChecksumSha256 },
    base: { releaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID, manifestChecksumSha256 },
    textureAdmission: EXTERIOR_SERVING_TEXTURE_ADMISSION,
    roots: {
      private: { rootId: privateRoot.rootId, rootChecksumSha256: privateRoot.rootChecksumSha256 },
      public: { rootId: publicRoot.rootId, rootChecksumSha256: publicRoot.rootChecksumSha256 },
    },
    ownershipLedger: { ledgerId: ledger.ledgerId, baseIdentitySetId: ledger.baseIdentitySet.id, baseIdentitySetChecksumSha256: ledger.baseIdentitySet.checksumSha256, cellCount: ledger.cells.length, buildingCount: ledger.baseIdentitySet.buildingCount },
    head: { snapshotId: snapshot.snapshotId, checksumSha256: snapshotBlob.ref.checksumSha256, assemblyPackageCount: assemblyPackageIds.length },
    composition: {
      cellCount: ledger.cells.length,
      contentCellCount: contentCellIds.length,
      availableBuildingCount,
      unavailableBuildingCount,
      shippedLodIds: ["lod_0"],
      copiedAssetCount,
      copiedAssetBytes,
      regeneratedInventoryCount: inventoryRegenCount,
    },
    cellReleases: cellReleases.map((entry) => ({ cellId: entry.cellId, cellReleaseId: entry.cellReleaseId, checksumSha256: cellReleaseRefs.get(entry.cellId).checksumSha256 })),
    assemblyPackageIds: [...assemblyPackageIds].sort(compareText),
    totals: { fileCount: emittedFiles.length, byteSize: emittedFiles.reduce((total, file) => total + file.byteSize, 0) },
    files: emittedFiles,
  };
  await writeFile(join(recordRoot, "payload-inventory.json"), serialize(payloadInventory));
  await writeFile(join(recordRoot, "payload-inventory.sha256"), `${sha256HexSync(serialize(payloadInventory))}  payload-inventory.json\n`);

  console.log(serialize({
    ok: true,
    waveId,
    releaseId,
    cellCount: ledger.cells.length,
    contentCellCount: contentCellIds.length,
    availableBuildingCount,
    unavailableBuildingCount,
    copiedAssetCount,
    copiedAssetBytes,
    totalBytes: payloadInventory.totals.byteSize,
    fileCount: emittedFiles.length,
    elapsedSeconds: Math.round((Date.now() - started) / 1000),
  }));
}

async function readRetentionManifest(payloadRoot, declared) {
  const bytes = await readPayloadFile(payloadRoot, declared.relativeRef);
  if (bytes.byteLength !== declared.byteSize || sha256HexBytes(bytes) !== declared.checksumSha256) {
    fail(`retained cell manifest ${declared.relativeRef} does not match the accounting its own retention root declares.`);
  }
  const manifest = JSON.parse(decoder.decode(bytes));
  const structural = validateMultiLodAssembly(manifest, { textureAdmission: "procedural-replay" });
  if (!structural.ok) fail(`retained cell manifest ${declared.relativeRef} fails closed: ${JSON.stringify(structural.issues.slice(0, 3))}`);
  if (retentionCellManifestRef(manifest.cells[0].cellId) !== declared.relativeRef) fail(`retained cell manifest ${declared.relativeRef} packages cell ${manifest.cells[0].cellId}.`);
  return structural.value;
}

async function readRetentionPayloadFile(payloadRoot, relativeRef, declaredFiles) {
  const declared = declaredFiles.get(relativeRef);
  if (!declared) fail(`retained file ${relativeRef} is not declared by the committed retention inventory.`);
  const bytes = await readPayloadFile(payloadRoot, relativeRef);
  if (bytes.byteLength !== declared.byteSize || sha256HexBytes(bytes) !== declared.checksumSha256) {
    fail(`retained file ${relativeRef} does not match the committed retention inventory.`);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

/**
 * Offline acceptance for an emitted `-s1` release, over the REAL bytes.
 *
 * The emitter already ran the structural validators as it wrote. This runs the
 * ones that need the payload: `replayMultiLodAssembly` per cell — which parses
 * every GLB, re-rasterizes every shared tile and walks the tileset against the
 * manifest's LOD chain — plus the graph, the sidecar and the head pin. A wave is
 * not committed until this passes.
 */
async function runValidate(waveId, options) {
  const started = Date.now();
  const waveEntry = exteriorServingWave(waveId);
  const releaseId = waveEntry.servingReleaseId;
  const payloadRoot = join(repositoryRoot, "public", "data", releaseId);
  const recordRoot = join(repositoryRoot, "data", releaseId);
  if (!existsSync(payloadRoot)) fail(`${payloadRoot} is absent; emit the wave before validating it.`);

  const inventoryText = await readFile(join(recordRoot, "payload-inventory.json"), "utf8");
  const recordedInventoryChecksum = (await readFile(join(recordRoot, "payload-inventory.sha256"), "utf8")).trim().split(/\s+/u)[0];
  if (sha256HexSync(inventoryText) !== recordedInventoryChecksum) fail(`committed serving inventory for ${releaseId} does not match its recorded checksum.`);
  const inventory = JSON.parse(inventoryText);
  const declaredFiles = new Map(inventory.files.map((file) => [file.path, file]));

  const graph = JSON.parse(await readFile(join(payloadRoot, "release-graph.json"), "utf8"));
  const graphValidation = validateExteriorReleaseGraph(graph);
  if (!graphValidation.ok) fail(`release graph fails closed: ${JSON.stringify(graphValidation.issues.slice(0, 5))}`);
  const runtimeIndex = JSON.parse(await readFile(join(payloadRoot, "index.json"), "utf8"));
  const publicRoot = graph.roots.find((root) => root.audience === "public");
  const pinnedPackages = new Set(runtimeIndex.defaultHead.assemblyPackageIds);

  const cellById = new Map(graph.cellReleases.map((entry) => [entry.cellReleaseId, entry]));
  const replayed = [];
  const issues = [];
  let cellIndex = 0;
  const assemblyArtifacts = publicRoot.artifacts.filter((artifact) => artifact.kind === "cell-assembly-package");
  for (const artifact of assemblyArtifacts) {
    cellIndex += 1;
    const cellRelease = cellById.get(artifact.logicalId);
    if (!cellRelease) { issues.push({ artifact: artifact.logicalId, reason: "no cell release" }); continue; }

    const manifestBytes = await readServingFile(payloadRoot, artifact.relativeRef, declaredFiles, artifact);
    const manifest = JSON.parse(decoder.decode(manifestBytes));
    if (!pinnedPackages.has(manifest.packageId)) { issues.push({ artifact: artifact.logicalId, reason: `package ${manifest.packageId} is not pinned by the default head` }); continue; }

    const contents = new Map();
    for (const declared of manifest.artifacts) {
      contents.set(declared.relativeRef, await readServingFile(payloadRoot, declared.relativeRef, declaredFiles, declared));
    }
    const replay = await replayMultiLodAssembly(manifest, contents, {
      textureAdmission: "procedural-replay",
      declaredSamplerFilter: EXTERIOR_SERVING_TEXTURE_ADMISSION.generatedTextureFact.samplerFilter,
    });
    if (!replay.ok) { issues.push({ artifact: artifact.logicalId, reason: JSON.stringify(replay.issues.slice(0, 3)) }); continue; }
    replayed.push({ packageId: manifest.packageId, totalBytes: replay.value.totalBytes, assetCount: manifest.assets.length });

    const sidecarArtifact = publicRoot.artifacts.find((entry) => entry.kind === "cell-detail-sidecar" && entry.logicalId === artifact.logicalId);
    if (!sidecarArtifact) { issues.push({ artifact: artifact.logicalId, reason: "no evidence sidecar" }); continue; }
    const sidecar = JSON.parse(decoder.decode(await readServingFile(payloadRoot, sidecarArtifact.relativeRef, declaredFiles, sidecarArtifact)));
    const sidecarValidation = validateExteriorCellDetailSidecar(sidecar, { cell: cellRelease, artifactRef: sidecarArtifact.relativeRef });
    if (!sidecarValidation.ok) issues.push({ artifact: artifact.logicalId, reason: `sidecar: ${JSON.stringify(sidecarValidation.issues.slice(0, 3))}` });

    if (cellIndex % 25 === 0 || cellIndex === assemblyArtifacts.length) {
      console.log(`  ${waveId} validated ${cellIndex}/${assemblyArtifacts.length} elapsed=${Math.round((Date.now() - started) / 1000)}s`);
    }
    if (options.limit && cellIndex >= options.limit) break;
  }

  const result = {
    schemaVersion: "1.0",
    releaseId,
    waveId,
    artifact: "serving-offline-validation",
    note: "Per-cell replayMultiLodAssembly over the emitted bytes: every GLB parsed under the shared-texture gate, every declared detail tile re-rasterized and byte-compared, the tileset walked against the manifest LOD chain, plus the release graph, each evidence sidecar and the head pin. Passing this is a structural and byte statement; it is not visual, geographic or performance acceptance.",
    replayedPackageCount: replayed.length,
    declaredPackageCount: assemblyArtifacts.length,
    replayedAssetCount: replayed.reduce((total, entry) => total + entry.assetCount, 0),
    replayedBytes: replayed.reduce((total, entry) => total + entry.totalBytes, 0),
    issues,
    ok: issues.length === 0 && replayed.length === assemblyArtifacts.length,
  };
  if (!options.limit) {
    await writeFile(join(recordRoot, "serving-validation.json"), serialize(result));
    await writeFile(join(recordRoot, "serving-validation.sha256"), `${sha256HexSync(serialize(result))}  serving-validation.json\n`);
  }
  if (!result.ok) fail(`serving validation found ${issues.length} issue(s): ${JSON.stringify(issues.slice(0, 3))}`);
  console.log(serialize({ ok: true, waveId, releaseId, ...result, issues: [] }));
}

async function readServingFile(payloadRoot, relativeRef, declaredFiles, declaredArtifact) {
  const declared = declaredFiles.get(relativeRef);
  if (!declared) fail(`emitted file ${relativeRef} is not declared by the committed serving inventory.`);
  const info = await lstat(join(payloadRoot, ...relativeRef.split("/"))).catch(() => null);
  if (!info) fail(`emitted file ${relativeRef} is absent.`);
  if (info.isSymbolicLink()) fail(`emitted file ${relativeRef} is a symbolic link.`);
  const bytes = await readPayloadFile(payloadRoot, relativeRef);
  if (bytes.byteLength !== declared.byteSize || sha256HexBytes(bytes) !== declared.checksumSha256) fail(`emitted file ${relativeRef} does not match the committed serving inventory.`);
  if (declaredArtifact && (bytes.byteLength !== declaredArtifact.byteSize || sha256HexBytes(bytes) !== declaredArtifact.checksumSha256)) {
    fail(`emitted file ${relativeRef} does not match the accounting the release declares for it.`);
  }
  return bytes;
}

// ---------------------------------------------------------------------------

/**
 * The boot cost of a serving wave, before and after the assembly seam.
 *
 * DETERMINISTIC and browser-free, because the quantity is exactly determinable
 * from the emitted bytes and a browser measurement of it would be a slower way
 * to read the same file sizes. `loadExteriorCellRuntime` fetches exactly three
 * documents, whole, in parallel, `cache: "no-store"`, before anything renders:
 * `index.json`, `release-graph.json` and `assemblies.json`. That is the boot
 * cost, and nothing else is in it.
 *
 * The BEFORE figure is a counterfactual, and it is an exact one rather than a
 * projection: the same documents this release emits, carried the way the
 * pre-seam form carried them. Every per-cell assembly manifest would be an
 * element of `assemblies.json`, and every per-cell evidence sidecar would be
 * inventory and evidence shards inside `release-graph.json`. So the before-cost
 * is the sum of bytes that exist on disk, differing from a real pre-seam
 * emission only by the array punctuation joining them, which is stated rather
 * than absorbed.
 *
 * The second column is the one ADR 0052 §2 actually argued: the number of
 * assets `validateMultiLodAssembly` walks synchronously in the runtime
 * constructor, before the first frame.
 */
/**
 * The promotion pins for a serving wave, derived from COMMITTED RECORDS ALONE.
 *
 * No payload directory is read. The accepted cell set comes from the serving
 * inventory's own `cellReleases`, the accepted building set from the island
 * ledger's membership minus the retention census's tombstones, and the head from
 * the inventory's `assemblyPackageIds`. So the record a promotion commit pastes
 * into `exterior-default-activation.ts` is reproducible on a clean checkout, and
 * `exterior-serving-promotion.test.ts` recomputes every digest below on every
 * run rather than trusting the paste.
 */
async function runActivation(waveIds) {
  const targets = waveIds.length > 0 ? waveIds.map((waveId) => exteriorServingWave(waveId)) : EXTERIOR_SERVING_WAVES;
  const islandLedger = await loadIslandLedger();
  const records = [];
  for (const waveEntry of targets) {
    const recordRoot = join(repositoryRoot, "data", waveEntry.servingReleaseId);
    if (!existsSync(join(recordRoot, "payload-inventory.json"))) continue;
    const inventory = JSON.parse(await readFile(join(recordRoot, "payload-inventory.json"), "utf8"));
    const { census } = await loadRetentionRecords(waveEntry.retentionReleaseId);
    const tombstoned = new Set(census.tombstones.map((entry) => entry.buildingId));
    const owned = islandLedger.cells
      .filter((cell) => cell.cellId.startsWith(`manhattan-exterior-cell-${waveEntry.waveId}-`))
      .flatMap((cell) => cell.buildingIds);
    const buildingIds = owned.filter((buildingId) => !tombstoned.has(buildingId)).sort();
    if (buildingIds.length !== waveEntry.generatedBuildingCount) {
      fail(`wave ${waveEntry.waveId} derives ${buildingIds.length} accepted buildings, expected ${waveEntry.generatedBuildingCount}.`);
    }
    const cellsJoin = inventory.cellReleases.map((entry) => `${entry.cellId}|${entry.cellReleaseId}|${entry.checksumSha256}`).sort().join(", ");
    records.push({
      waveId: waveEntry.waveId,
      releaseId: waveEntry.servingReleaseId,
      snapshotId: inventory.head.snapshotId,
      snapshotChecksumSha256: inventory.head.checksumSha256,
      assemblyPackageCount: inventory.assemblyPackageIds.length,
      assemblyPackageIdsDigestSha256: sha256HexSync([...inventory.assemblyPackageIds].sort().join(", ")),
      cellCount: inventory.cellReleases.length,
      cellsDigestSha256: sha256HexSync(cellsJoin),
      buildingCount: buildingIds.length,
      buildingIdsDigestSha256: sha256HexSync(buildingIds.join(", ")),
      predecessorReleaseId: null,
    });
  }
  const record = {
    schemaVersion: "1.0",
    artifact: "serving-activation-pins",
    note: "Every pin below is derived from committed records only — the serving payload inventory, the retention wave census and the committed island ledger — so it is reproducible on a clean checkout with no payload directory present. The digests use the same canonical joins the runtime gate recomputes: cellId|cellReleaseId|checksum for cells, and a plain sorted join for building identities and assembly package ids, each sorted then joined with the same separator.",
    waves: records,
  };
  const evidenceRoot = join(repositoryRoot, "data", EXTERIOR_SERVING_EVIDENCE_ID);
  await mkdir(evidenceRoot, { recursive: true });
  await writeFile(join(evidenceRoot, "activation-pins.json"), serialize(record));
  await writeFile(join(evidenceRoot, "activation-pins.sha256"), `${sha256HexSync(serialize(record))}  activation-pins.json\n`);
  console.log(serialize(record));
}

async function runBootCost(waveIds) {
  const targets = waveIds.length > 0 ? waveIds.map((waveId) => exteriorServingWave(waveId)) : EXTERIOR_SERVING_WAVES;
  const waves = [];
  for (const waveEntry of targets) {
    const recordRoot = join(repositoryRoot, "data", waveEntry.servingReleaseId);
    if (!existsSync(join(recordRoot, "payload-inventory.json"))) continue;
    const inventory = JSON.parse(await readFile(join(recordRoot, "payload-inventory.json"), "utf8"));
    const byPath = new Map(inventory.files.map((file) => [file.path, file]));
    const sum = (prefix) => inventory.files.filter((file) => file.path.startsWith(prefix)).reduce((total, file) => total + file.byteSize, 0);
    const indexBytes = byPath.get("index.json").byteSize;
    const graphBytes = byPath.get("release-graph.json").byteSize;
    const assembliesBytes = byPath.get("assemblies.json").byteSize;
    const shardedAssemblyBytes = sum("public/cell-assembly-package/");
    const shardedSidecarBytes = sum("public/cell-detail-sidecar/");
    const after = indexBytes + graphBytes + assembliesBytes;
    const before = indexBytes + graphBytes + shardedAssemblyBytes + shardedSidecarBytes;
    waves.push({
      waveId: waveEntry.waveId,
      releaseId: waveEntry.servingReleaseId,
      shippedAssetCount: waveEntry.generatedBuildingCount,
      cellCount: waveEntry.cellCount,
      contentCellCount: inventory.composition.contentCellCount,
      afterSeam: {
        blockingBootBytes: after,
        documents: { "index.json": indexBytes, "release-graph.json": graphBytes, "assemblies.json": assembliesBytes },
        assetsValidatedBeforeFirstFrame: 0,
        lazyDocumentsPerResidentCell: 2,
      },
      beforeSeam: {
        blockingBootBytes: before,
        documents: { "index.json": indexBytes, "release-graph.json": graphBytes, "assemblies.json (inlined manifests)": shardedAssemblyBytes, "release-graph.json (inlined evidence)": shardedSidecarBytes },
        assetsValidatedBeforeFirstFrame: waveEntry.generatedBuildingCount,
        lazyDocumentsPerResidentCell: 0,
      },
      removedBlockingBytes: before - after,
      removedBlockingRatio: before === 0 ? null : Number(((before - after) / before).toFixed(6)),
      bytesPerShippedAssetBeforeSeam: Number(((shardedAssemblyBytes + shardedSidecarBytes) / waveEntry.generatedBuildingCount).toFixed(2)),
    });
  }
  const record = {
    schemaVersion: "1.0",
    artifact: "serving-boot-cost",
    note: "loadExteriorCellRuntime fetches index.json, release-graph.json and assemblies.json whole, in parallel, cache: no-store, before anything renders, and the runtime constructor then runs validateMultiLodAssembly over every head-pinned package synchronously. That is the whole boot cost, so it is determined by three file sizes and one count rather than measured through a browser.",
    counterfactualDisclosure: "The BEFORE column is not an estimate. It is the byte sum of the same documents this release emitted, carried the way the pre-seam form carried them: each per-cell assembly manifest as an element of assemblies.json, each per-cell sidecar's shards inside release-graph.json. It differs from a real pre-seam emission only by the array punctuation joining the elements — two bytes per element, under 1 KB per wave — which is named here rather than absorbed into the figure.",
    waves,
    islandTotals: {
      blockingBootBytesAfterSeam: waves.reduce((total, wave) => total + wave.afterSeam.blockingBootBytes, 0),
      blockingBootBytesBeforeSeam: waves.reduce((total, wave) => total + wave.beforeSeam.blockingBootBytes, 0),
      assetsValidatedBeforeFirstFrameAfterSeam: 0,
      assetsValidatedBeforeFirstFrameBeforeSeam: waves.reduce((total, wave) => total + wave.shippedAssetCount, 0),
      wavesCovered: waves.length,
    },
  };
  const evidenceRoot = join(repositoryRoot, "data", EXTERIOR_SERVING_EVIDENCE_ID);
  await mkdir(evidenceRoot, { recursive: true });
  await writeFile(join(evidenceRoot, "boot-cost.json"), serialize(record));
  await writeFile(join(evidenceRoot, "boot-cost.sha256"), `${sha256HexSync(serialize(record))}  boot-cost.json\n`);
  console.log(serialize(record));
}

async function runFingerprint(waveIds) {
  const started = Date.now();
  const targets = waveIds.length > 0 ? waveIds.map((waveId) => exteriorServingWave(waveId).retentionReleaseId) : EXTERIOR_SERVING_WAVES.map((entry) => entry.retentionReleaseId);
  const results = await fingerprintRetentionPayload(targets);
  const ok = results.every((entry) => entry.ok);
  const record = {
    schemaVersion: "1.0",
    artifact: "retention-payload-fingerprint",
    note: "Every byte the six T004 retention inventories declare, re-hashed and compared. It is run after every serving wave because the whole island's evidence base is six local directories that nothing may edit and that the serving driver reads heavily. A byte-size-only check would miss exactly the in-place corruption a shared inode or an interrupted copy causes, so this re-hashes.",
    scope: targets,
    declaredFileCount: results.reduce((total, entry) => total + (entry.declaredFileCount ?? 0), 0),
    verifiedFileCount: results.reduce((total, entry) => total + (entry.verifiedFileCount ?? 0), 0),
    elapsedSeconds: Math.round((Date.now() - started) / 1000),
    results,
    ok,
  };
  if (waveIds.length === 0) {
    const evidenceRoot = join(repositoryRoot, "data", EXTERIOR_SERVING_EVIDENCE_ID);
    await mkdir(evidenceRoot, { recursive: true });
    await writeFile(join(evidenceRoot, "retention-fingerprint.json"), serialize(record));
    await writeFile(join(evidenceRoot, "retention-fingerprint.sha256"), `${sha256HexSync(serialize(record))}  retention-fingerprint.json\n`);
  }
  console.log(serialize(record));
  if (!ok) process.exit(1);
}

async function main() {
  const argv = process.argv.slice(2);
  const positional = argv.filter((token) => !token.startsWith("--"));
  const force = argv.includes("--force");
  const limitFlag = argv.find((token) => token.startsWith("--limit="));
  const limit = limitFlag ? Number(limitFlag.slice("--limit=".length)) : 0;
  for (const token of argv.filter((item) => item.startsWith("--"))) {
    if (token !== "--force" && !token.startsWith("--limit=")) fail(`unknown flag ${token}.`);
  }
  const [command, ...rest] = positional;
  if (command === "emit") {
    if (rest.length !== 1) fail("usage: exterior-serving-wave-cli.mjs emit <w00|…|w05> [--force]");
    await runEmit(rest[0], { force });
  } else if (command === "validate") {
    if (rest.length !== 1) fail("usage: exterior-serving-wave-cli.mjs validate <w00|…|w05> [--limit=N]");
    await runValidate(rest[0], { limit });
  } else if (command === "fingerprint") {
    await runFingerprint(rest);
  } else if (command === "boot-cost") {
    await runBootCost(rest);
  } else if (command === "activation") {
    await runActivation(rest);
  } else {
    console.error("usage: exterior-serving-wave-cli.mjs <emit|validate|fingerprint|boot-cost|activation> [wave] [--force] [--limit=N]");
    console.error("The wave is REQUIRED for emit and validate. There is no default: a bare invocation would cut an island.");
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exit(1); });
}

export { fingerprintRetentionPayload };
