/* global console, process, TextEncoder */
/**
 * Midtown-core exterior canary pipeline (Task T013).
 *
 * Four resumable, idempotent stages over the pinned, gitignored
 * `manhattan-citywide-20260804` snapshot and the committed
 * `manhattan-exterior-wave-ledger-20260804` ledger:
 *
 *   plans  census every one of the 7,201 wave-w01 buildings through the V2
 *          grammar; record refusals rather than inventing geometry.
 *   glbs   generate both canonical LODs for every planned building (the full
 *          asset census) and write the shipped LOD of the renderable cells into
 *          the payload directory.
 *   gates  re-run the ownership, digest-reconciliation, Block 835
 *          non-divergence, and budget gates over the censused wave.
 *   graph  assemble and emit the release graph, runtime index, assembly
 *          package, and artifact blobs, then replay the emitted bytes and write
 *          the committed checksum inventory.
 *
 * Each stage writes a receipt under the work root carrying the fingerprint of
 * its inputs. Re-running a stage whose fingerprint is unchanged is a no-op
 * unless `--force` is given, so an interrupted run resumes instead of
 * restarting. The payload directory is intentionally untracked (it follows the
 * citywide precedent); `data/midtown-core-20260811/` carries the committed
 * checksum inventory that keeps it checkable after the tree is removed.
 *
 * This script acquires nothing, replaces no retained snapshot, and writes only
 * under the three directories it owns.
 *
 * Usage:
 *   node scripts/midtown-core-cli.mjs <plans|glbs|gates|graph|all> [--force]
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexBytes, sha256HexSync, stableSerialize } from "../src/domain/deterministic-hash.ts";
import {
  EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
  EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID,
} from "../src/domain/exterior-fullsnapshot-input.ts";
import { BLOCK835_QUALITY_BUDGETS, readPilotBuildings } from "../src/release/block835-reference-package.ts";
import { buildSuccessorPlan, successorPlanToEnu, tessellateV2Plan } from "../src/release/block835-successor-package.ts";
import { EXTERIOR_WAVE_LEDGER_RELEASE_ID } from "../src/release/exterior-wave-ledger.ts";
import { replayMultiLodAssembly } from "../src/release/multi-lod-assembly.ts";
import { replayExteriorArtifactIntegrity } from "../src/release/exterior-release.ts";
import {
  MIDTOWN_CORE_BUILDING_COUNT,
  MIDTOWN_CORE_CELL_COUNT,
  MIDTOWN_CORE_RELEASE_ID,
  buildMidtownCoreSubsetLedger,
  midtownCoreArtifactChecksum,
  reconcileMidtownCoreAgainstDigest,
  serializeMidtownCoreArtifact,
  validateMidtownCoreSubsetLedger,
} from "../src/release/midtown-core-package.ts";
import {
  MidtownCoreStop,
  buildMidtownCorePlan,
  midtownCorePlanToEnu,
  midtownCoreV2Parameters,
  writeMidtownCoreAssets,
} from "../src/release/midtown-core-materialization.ts";
import { collectMidtownCoreSources, materializeMidtownCoreCells, midtownCoreStageFingerprint } from "../src/release/midtown-core-source.ts";
import {
  MIDTOWN_CORE_OUTPUT_DIRECTORY,
  MIDTOWN_CORE_SHIPPED_LOD_ID,
  buildMidtownCoreRelease,
} from "../src/release/midtown-core-release.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotRoot = join(repositoryRoot, "public", "data", EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID);
const ledgerRoot = join(repositoryRoot, "data", "normalized", EXTERIOR_WAVE_LEDGER_RELEASE_ID);
const pilotReleasePath = join(repositoryRoot, "public", "data", "manhattan-esb-block-exterior-pilot-20260805", "release.json");

/** Directories this pipeline owns and may replace. */
export const MIDTOWN_CORE_WORK_ROOT = "artifacts/midtown-core-20260811";
export const MIDTOWN_CORE_RECORD_ROOT = "data/midtown-core-20260811";
const workRoot = join(repositoryRoot, MIDTOWN_CORE_WORK_ROOT);
const recordRoot = join(repositoryRoot, MIDTOWN_CORE_RECORD_ROOT);
const payloadRoot = join(repositoryRoot, MIDTOWN_CORE_OUTPUT_DIRECTORY);

/** Cells this cycle materializes: the first cells of the wave in priority order. */
const RENDERABLE_CELL_COUNT = 3;

const STAGES = ["plans", "glbs", "gates", "graph"];

function fail(message) { throw new Error(`midtown-core: ${message}`); }

function readJsonText(text, label) {
  try { return JSON.parse(text); } catch { return fail(`${label} is not valid JSON.`); }
}

async function readVerifiedText(path, label) {
  if (!existsSync(path)) fail(`${label} is absent at ${path}. This pipeline never acquires data.`);
  return readFile(path, "utf8");
}

// ---------------------------------------------------------------------------
// Shared inputs
// ---------------------------------------------------------------------------

async function loadContext() {
  const manifestText = await readVerifiedText(join(snapshotRoot, "manifest.json"), "pinned citywide manifest");
  const manifestChecksum = sha256HexSync(manifestText);
  if (manifestChecksum !== EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256) {
    fail(`citywide manifest checksum ${manifestChecksum} is not the pinned ${EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256}.`);
  }
  const manifest = readJsonText(manifestText, "citywide manifest");
  const snapshot = (manifest.sourceSnapshots ?? []).find((entry) => entry.registryEntryId === "nyc.building-footprints");
  if (!snapshot) fail("the citywide manifest declares no nyc.building-footprints source snapshot.");
  const capture = { capturedAt: snapshot.captureTimestamp, updatedAt: snapshot.sourceUpdatedAt };

  const parentLedgerText = await readVerifiedText(join(ledgerRoot, "ledger.json"), "committed wave ledger");
  const parentLedger = readJsonText(parentLedgerText, "committed wave ledger");
  const parentLedgerChecksumSha256 = midtownCoreArtifactChecksum(parentLedger);
  const recordedLedgerChecksum = (await readVerifiedText(join(ledgerRoot, "ledger.sha256"), "committed wave ledger checksum")).trim().split(/\s+/u)[0];
  if (recordedLedgerChecksum !== parentLedgerChecksumSha256) fail("committed wave ledger does not match its recorded checksum.");

  const subset = buildMidtownCoreSubsetLedger({
    parentLedger,
    parentLedgerChecksumSha256,
    baseReleaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID,
    baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
  });
  if (subset.ledger.cells.length !== MIDTOWN_CORE_CELL_COUNT) fail(`subset owns ${subset.ledger.cells.length} cells, not ${MIDTOWN_CORE_CELL_COUNT}.`);

  return { manifest, manifestChecksum, capture, parentLedger, parentLedgerChecksumSha256, subset };
}

/**
 * Reads every declared building shard, verifying byte size and checksum before
 * a single coordinate is trusted. Unverified reads would let local corruption
 * become a "deterministic" result.
 */
async function readVerifiedShards(manifest) {
  const declared = manifest.geometryShards.filter((shard) => shard.layer === "buildings");
  const encoder = new TextEncoder();
  const shards = [];
  for (const shard of declared) {
    const text = await readVerifiedText(join(snapshotRoot, shard.relativeContentRef), `citywide shard ${shard.shardId}`);
    if (encoder.encode(text).byteLength !== shard.byteSize) fail(`shard ${shard.shardId} byte size drifted.`);
    if (sha256HexSync(text) !== shard.checksumSha256) fail(`shard ${shard.shardId} checksum drifted.`);
    shards.push(readJsonText(text, `citywide shard ${shard.shardId}`));
  }
  return { shards, declaredShardCount: declared.length };
}

function inputFingerprint(context, stage) {
  return midtownCoreStageFingerprint({
    stage,
    baseManifestChecksumSha256: context.manifestChecksum,
    parentLedgerChecksumSha256: context.parentLedgerChecksumSha256,
    subsetLedgerChecksumSha256: midtownCoreArtifactChecksum(context.subset.ledger),
    renderableCellCount: RENDERABLE_CELL_COUNT,
    shippedLodId: MIDTOWN_CORE_SHIPPED_LOD_ID,
  });
}

async function readReceipt(stage) {
  const path = join(workRoot, "stages", `${stage}.json`);
  if (!existsSync(path)) return null;
  return readJsonText(await readFile(path, "utf8"), `${stage} receipt`);
}

async function writeReceipt(stage, fingerprint, summary) {
  const path = join(workRoot, "stages", `${stage}.json`);
  await mkdir(dirname(path), { recursive: true });
  const receipt = { schemaVersion: "1.0", stage, releaseId: MIDTOWN_CORE_RELEASE_ID, inputFingerprint: fingerprint, summary };
  await writeFile(path, serializeMidtownCoreArtifact(receipt), "utf8");
  return receipt;
}

async function writeRecord(name, value) {
  await mkdir(recordRoot, { recursive: true });
  const text = serializeMidtownCoreArtifact(value);
  await writeFile(join(recordRoot, name), text, "utf8");
  return sha256HexSync(text);
}

// ---------------------------------------------------------------------------
// Stage: plans
// ---------------------------------------------------------------------------

async function stagePlans(context, options) {
  const fingerprint = inputFingerprint(context, "plans");
  const existing = await readReceipt("plans");
  if (existing && existing.inputFingerprint === fingerprint && !options.force) return { skipped: true, ...existing.summary };

  const { shards, declaredShardCount } = await readVerifiedShards(context.manifest);
  const wanted = new Set(context.subset.buildingIds);
  const sources = collectMidtownCoreSources(shards, wanted);

  const planHashes = new Set();
  const refusals = [];
  const perCell = [];
  let planned = 0;
  let fallbackHeights = 0;
  let maximumFloorCount = 0;
  for (const cell of context.subset.ledger.cells) {
    let cellPlanned = 0;
    for (const buildingId of cell.buildingIds) {
      const source = sources.get(buildingId);
      if (!source) { refusals.push({ buildingId, cellId: cell.cellId, code: "absent-from-base-shards", detail: "No accepted footprint resolves for this owned building." }); continue; }
      try {
        const built = buildMidtownCorePlan(source, EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256);
        planHashes.add(built.plan.planHashSha256);
        if (built.heightSource === "fallback") fallbackHeights += 1;
        maximumFloorCount = Math.max(maximumFloorCount, built.plan.input.parameters.floorCount);
        planned += 1; cellPlanned += 1;
      } catch (error) {
        if (!(error instanceof MidtownCoreStop)) throw error;
        refusals.push({ buildingId, cellId: cell.cellId, code: error.code, detail: error.message });
      }
    }
    perCell.push({ cellId: cell.cellId, order: cell.order, owned: cell.buildingIds.length, planned: cellPlanned });
  }

  const summary = {
    declaredShardCount,
    ownedBuildingCount: context.subset.buildingIds.length,
    resolvedBuildingCount: sources.size,
    plannedBuildingCount: planned,
    refusedBuildingCount: refusals.length,
    uniquePlanHashCount: planHashes.size,
    fallbackHeightCount: fallbackHeights,
    maximumFloorCount,
    refusals,
  };
  if (summary.ownedBuildingCount !== MIDTOWN_CORE_BUILDING_COUNT) fail(`the subset owns ${summary.ownedBuildingCount} buildings, not ${MIDTOWN_CORE_BUILDING_COUNT}.`);
  if (summary.uniquePlanHashCount !== planned) fail(`plan hashes are not unique: ${summary.uniquePlanHashCount} of ${planned}.`);

  await mkdir(workRoot, { recursive: true });
  await writeFile(join(workRoot, "plan-census.json"), serializeMidtownCoreArtifact({ ...summary, perCell }), "utf8");
  await writeReceipt("plans", fingerprint, summary);
  return { skipped: false, ...summary };
}

// ---------------------------------------------------------------------------
// Stage: glbs
// ---------------------------------------------------------------------------

/** Refuses any output directory this pipeline does not own. */
function assertOwnedPayloadDirectory(directory) {
  if (basename(directory) !== MIDTOWN_CORE_RELEASE_ID) fail(`refusing to write ${directory}: only a directory named ${MIDTOWN_CORE_RELEASE_ID} is writable.`);
}

async function existingFiles(directory) {
  if (!existsSync(directory)) return [];
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => relative(directory, join(entry.parentPath ?? entry.path, entry.name)).split("\\").join("/"));
}

async function stageGlbs(context, options) {
  const fingerprint = inputFingerprint(context, "glbs");
  const existing = await readReceipt("glbs");
  if (existing && existing.inputFingerprint === fingerprint && !options.force && existsSync(join(payloadRoot, "public", "assets"))) {
    return { skipped: true, ...existing.summary };
  }
  assertOwnedPayloadDirectory(payloadRoot);

  const { shards } = await readVerifiedShards(context.manifest);
  const sources = collectMidtownCoreSources(shards, new Set(context.subset.buildingIds));
  const renderableCells = context.subset.ledger.cells.slice(0, RENDERABLE_CELL_COUNT);
  const renderable = new Set(renderableCells.map((cell) => cell.cellId));

  // Full-wave asset census: both LODs are generated for every planned building
  // and discarded, so the shipped subset is never a different code path from
  // the census that measures the wave.
  const startedAt = Date.now();
  let generatedAssetCount = 0;
  let generatedAssetBytes = 0;
  let maximumTriangleCount = 0;
  let maximumMaterialCount = 0;
  let materializedBuildingCount = 0;
  let fallbackHeightCount = 0;
  const censusRefusals = [];
  for (const cell of context.subset.ledger.cells) {
    for (const buildingId of cell.buildingIds) {
      const source = sources.get(buildingId);
      if (!source) { censusRefusals.push({ buildingId, code: "absent-from-base-shards" }); continue; }
      let built;
      try { built = buildMidtownCorePlan(source, EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256); }
      catch (error) {
        if (!(error instanceof MidtownCoreStop)) throw error;
        censusRefusals.push({ buildingId, code: error.code, detail: error.message });
        continue;
      }
      if (built.heightSource === "fallback") fallbackHeightCount += 1;
      const assets = writeMidtownCoreAssets(built, { ownerCellId: cell.cellId, capturedAt: context.capture.capturedAt, updatedAt: context.capture.updatedAt });
      materializedBuildingCount += 1;
      for (const asset of assets) {
        generatedAssetCount += 1;
        generatedAssetBytes += asset.bytes.byteLength;
        maximumTriangleCount = Math.max(maximumTriangleCount, asset.counts.triangleCount);
        maximumMaterialCount = Math.max(maximumMaterialCount, asset.counts.materialCount);
      }
    }
  }
  const censusMilliseconds = Date.now() - startedAt;

  // Shipped subset, written through the same materializer the replay uses.
  const shipped = materializeMidtownCoreCells({
    cells: renderableCells,
    sources,
    baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
    capture: context.capture,
  });
  for (const [relativeRef, bytes] of [...shipped.assetBytes].sort(([left], [right]) => (left < right ? -1 : 1))) {
    if (!relativeRef.startsWith("public/")) fail(`refusing to emit a non-public asset path: ${relativeRef}`);
    const target = join(payloadRoot, relativeRef);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  const summary = {
    censusMilliseconds,
    materializedBuildingCount,
    refusedBuildingCount: censusRefusals.length,
    refusals: censusRefusals,
    generatedAssetCount,
    generatedAssetBytes,
    maximumTriangleCount,
    maximumMaterialCount,
    triangleBudget: BLOCK835_QUALITY_BUDGETS.maxTriangles,
    materialBudget: BLOCK835_QUALITY_BUDGETS.maxMaterials,
    fallbackHeightCount,
    renderableCellIds: [...renderable],
    shippedAssetCount: shipped.assetBytes.size,
    shippedAssetBytes: shipped.census.shippedAssetBytes,
    shippedBuildingCount: shipped.buildings.length,
  };
  if (maximumTriangleCount > BLOCK835_QUALITY_BUDGETS.maxTriangles) fail(`a generated LOD declares ${maximumTriangleCount} triangles, above the ${BLOCK835_QUALITY_BUDGETS.maxTriangles} budget.`);
  if (generatedAssetCount !== materializedBuildingCount * 2) fail("the asset census does not carry two LODs per materialized building.");

  await mkdir(workRoot, { recursive: true });
  await writeFile(join(workRoot, "asset-census.json"), serializeMidtownCoreArtifact(summary), "utf8");
  await writeReceipt("glbs", fingerprint, summary);
  return { skipped: false, ...summary };
}

// ---------------------------------------------------------------------------
// Stage: gates
// ---------------------------------------------------------------------------

async function stageGates(context, options) {
  const fingerprint = inputFingerprint(context, "gates");
  const existing = await readReceipt("gates");
  if (existing && existing.inputFingerprint === fingerprint && !options.force) return { skipped: true, ...existing.summary };

  const ownership = validateMidtownCoreSubsetLedger(context.subset.ledger);
  if (!ownership.ok) fail(`subset ledger fails the accepted ownership checks: ${stableSerialize(ownership.issues.slice(0, 5))}`);

  const digest = readJsonText(await readVerifiedText(join(ledgerRoot, "membership-digest.json"), "committed membership digest"), "membership digest");
  const reconciliation = reconcileMidtownCoreAgainstDigest(context.subset, digest);
  if (!reconciliation.ok) fail(`digest reconciliation failed: ${stableSerialize(reconciliation.findings.slice(0, 5))}`);

  // Block 835 non-divergence: the wave derivation must reproduce the pinned
  // Block 835 parameters and ENU mapping exactly, or the two paths have drifted.
  const pilotBuildings = readPilotBuildings(readJsonText(await readVerifiedText(pilotReleasePath, "pinned pilot release"), "pilot release"));
  let parameterMismatches = 0;
  let enuMismatches = 0;
  for (const building of pilotBuildings) {
    const pinned = buildSuccessorPlan(building);
    const derived = midtownCoreV2Parameters(
      building.canonicalBuildingId,
      Math.round(pinned.rectangle.widthMeters * 1_000),
      Math.round(pinned.rectangle.depthMeters * 1_000),
      Math.round(building.heightMeters * 1_000),
    );
    if (stableSerialize(derived.parameters) !== stableSerialize(pinned.plan.input.parameters) || derived.heightMm !== pinned.plan.input.geometry.heightMm) parameterMismatches += 1;
    const tessellated = tessellateV2Plan(pinned.plan, { includeRecesses: true });
    if (stableSerialize(midtownCorePlanToEnu(pinned.rectangle, tessellated.quads)) !== stableSerialize(successorPlanToEnu(pinned, tessellated.quads))) enuMismatches += 1;
  }
  if (parameterMismatches !== 0 || enuMismatches !== 0) fail(`Block 835 non-divergence failed: ${parameterMismatches} parameter and ${enuMismatches} ENU mismatches.`);

  const summary = {
    ownershipOk: ownership.ok,
    reconciliation: reconciliation.counts,
    reconciliationOk: reconciliation.ok,
    block835Buildings: pilotBuildings.length,
    block835ParameterMismatches: parameterMismatches,
    block835EnuMismatches: enuMismatches,
    maximumCellBuildings: context.subset.derivation.subset.maxObservedCellBuildings,
  };
  await writeReceipt("gates", fingerprint, summary);
  return { skipped: false, ...summary };
}

// ---------------------------------------------------------------------------
// Stage: graph
// ---------------------------------------------------------------------------

async function stageGraph(context, options) {
  const fingerprint = inputFingerprint(context, "graph");
  const existing = await readReceipt("graph");
  if (existing && existing.inputFingerprint === fingerprint && !options.force && existsSync(join(payloadRoot, "release-graph.json"))) {
    return { skipped: true, ...existing.summary };
  }
  assertOwnedPayloadDirectory(payloadRoot);

  const { shards } = await readVerifiedShards(context.manifest);
  const renderableCells = context.subset.ledger.cells.slice(0, RENDERABLE_CELL_COUNT);
  const sources = collectMidtownCoreSources(shards, new Set(renderableCells.flatMap((cell) => cell.buildingIds)));
  const shipped = materializeMidtownCoreCells({
    cells: renderableCells,
    sources,
    baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
    capture: context.capture,
  });
  const release = buildMidtownCoreRelease({
    subset: context.subset,
    renderableCellIds: renderableCells.map((cell) => cell.cellId),
    materialized: shipped.buildings,
    refusals: shipped.refusals,
    capture: context.capture,
  });

  const payload = new Map([...release.files, ...shipped.assetBytes]);
  const stale = (await existingFiles(payloadRoot)).filter((path) => !payload.has(path));
  for (const path of stale) await rm(join(payloadRoot, path));
  for (const [path, bytes] of [...payload].sort(([left], [right]) => (left < right ? -1 : 1))) {
    const target = join(payloadRoot, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  // Replay the emitted bytes rather than the in-memory objects.
  const emitted = new Map();
  for (const path of await existingFiles(payloadRoot)) emitted.set(path, new Uint8Array(await readFile(join(payloadRoot, path))));
  const declaredBlobs = new Map();
  for (const root of release.graph.roots) for (const artifact of root.artifacts) {
    const bytes = root.audience === "private" ? release.rootArtifactBytes.get(artifact.relativeRef) : emitted.get(artifact.relativeRef);
    if (!bytes) fail(`declared artifact ${artifact.relativeRef} has no bytes to replay.`);
    declaredBlobs.set(artifact.relativeRef, bytes);
  }
  const integrity = await replayExteriorArtifactIntegrity(release.graph, declaredBlobs);
  if (!integrity.ok) fail(`artifact integrity replay failed: ${stableSerialize(integrity.issues.slice(0, 5))}`);

  const assemblyContents = new Map();
  for (const artifact of release.assemblies[0].artifacts) {
    const bytes = emitted.get(artifact.relativeRef);
    if (!bytes) fail(`assembly artifact ${artifact.relativeRef} is absent from the emitted payload.`);
    assemblyContents.set(artifact.relativeRef, bytes);
  }
  const assemblyReplay = await replayMultiLodAssembly(release.assemblies[0], assemblyContents);
  if (!assemblyReplay.ok) fail(`assembly replay failed: ${stableSerialize(assemblyReplay.issues.slice(0, 5))}`);

  const privateLeaks = [...emitted.keys()].filter((path) => path.startsWith("private/") || path.toLowerCase().includes("/private"));
  if (privateLeaks.length > 0) fail(`private-audience bytes reached the browser-reachable root: ${privateLeaks.join(", ")}`);

  const files = [...emitted]
    .map(([path, bytes]) => ({ path, byteSize: bytes.byteLength, checksumSha256: sha256HexBytes(bytes) }))
    .sort((left, right) => (left.path < right.path ? -1 : 1));
  const inventory = {
    schemaVersion: "1.0",
    releaseId: MIDTOWN_CORE_RELEASE_ID,
    payloadDirectory: MIDTOWN_CORE_OUTPUT_DIRECTORY,
    note: "The payload directory is intentionally untracked, following the citywide precedent. This inventory is the committed record that keeps every emitted byte checkable after the local tree is removed; `node scripts/midtown-core-cli.mjs graph --force` rebuilds it byte-identically.",
    base: { releaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID, manifestChecksumSha256: context.manifestChecksum },
    parentLedger: { releaseId: EXTERIOR_WAVE_LEDGER_RELEASE_ID, checksumSha256: context.parentLedgerChecksumSha256 },
    ownershipLedgerId: context.subset.ledger.ledgerId,
    roots: Object.fromEntries(release.graph.roots.map((root) => [root.audience, { rootId: root.rootId, rootChecksumSha256: root.rootChecksumSha256, artifactCount: root.artifacts.length }])),
    assemblyFingerprintSha256: assemblyReplay.value.fingerprintSha256,
    stats: release.stats,
    totals: { fileCount: files.length, byteSize: files.reduce((total, file) => total + file.byteSize, 0) },
    files,
  };
  const inventoryChecksum = await writeRecord("payload-inventory.json", inventory);
  const derivationChecksum = await writeRecord("derivation.json", {
    schemaVersion: "1.0",
    derivation: context.subset.derivation,
    reconciliation: reconcileMidtownCoreAgainstDigest(context.subset, readJsonText(await readVerifiedText(join(ledgerRoot, "membership-digest.json"), "committed membership digest"), "membership digest")),
  });

  const summary = {
    ...release.stats,
    emittedFileCount: files.length,
    removedStaleCount: stale.length,
    payloadByteSize: inventory.totals.byteSize,
    publicRootChecksumSha256: release.graph.roots.find((root) => root.audience === "public").rootChecksumSha256,
    privateRootChecksumSha256: release.graph.roots.find((root) => root.audience === "private").rootChecksumSha256,
    declaredPrivateArtifacts: release.graph.roots.find((root) => root.audience === "private").artifacts.length,
    emittedPrivateFiles: privateLeaks.length,
    assemblyFingerprintSha256: assemblyReplay.value.fingerprintSha256,
    payloadInventoryChecksumSha256: inventoryChecksum,
    derivationRecordChecksumSha256: derivationChecksum,
  };
  await writeReceipt("graph", fingerprint, summary);
  return { skipped: false, ...summary };
}

// ---------------------------------------------------------------------------

const RUNNERS = { plans: stagePlans, glbs: stageGlbs, gates: stageGates, graph: stageGraph };

async function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes("--force");
  const requested = argv.filter((token) => !token.startsWith("--"));
  const stage = requested[0] ?? "all";
  if (stage !== "all" && !STAGES.includes(stage)) fail(`unknown stage ${stage}; expected one of ${STAGES.join(", ")} or all.`);

  const context = await loadContext();
  const report = {};
  for (const name of stage === "all" ? STAGES : [stage]) {
    const startedAt = Date.now();
    report[name] = { ...(await RUNNERS[name](context, { force })), elapsedMilliseconds: Date.now() - startedAt };
  }
  console.log(JSON.stringify({ ok: true, releaseId: MIDTOWN_CORE_RELEASE_ID, stages: report }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main();
