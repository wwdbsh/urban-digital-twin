/* global console, process, TextEncoder */
/**
 * Midtown-core **V3** exterior wave pipeline (Task T026, phase P3).
 *
 * A sibling of `scripts/midtown-core-cli.mjs`, which stays exactly as it is and
 * keeps emitting the byte-frozen V2 wave. Four resumable, idempotent stages over
 * the pinned, gitignored `manhattan-citywide-20260804` snapshot, the committed
 * `manhattan-exterior-wave-ledger-20260804` ledger, and the committed V2 wave
 * inventory that supplies every predecessor pin:
 *
 *   plans  census every one of the 7,201 wave-w01 buildings through the V3
 *          footprint-faithful grammar over its REAL sourced ring; record which
 *          property of a polygon the grammar could not carry, never invent one.
 *   glbs   generate both canonical LODs for every planned building, run the
 *          per-asset census gates on the emitted bytes (analytic volume
 *          identity, true-footprint-vertex registration, V3 quality budgets),
 *          and write the shipped LOD of the renderable cells into the payload.
 *   gates  ownership, digest reconciliation, availability drift against the V2
 *          wave, and the wave-scale budget statement.
 *   graph  assemble and emit the successor release graph, runtime index,
 *          assembly package and artifact blobs, replay the emitted bytes, and
 *          write the committed checksum inventory.
 *
 * Each stage writes a receipt carrying the fingerprint of its inputs, so an
 * interrupted run resumes rather than restarting. The payload directory is
 * intentionally untracked (the citywide precedent);
 * `data/midtown-core-20260811-v3/` carries the committed checksum inventory that
 * keeps it checkable after the tree is removed.
 *
 * This script acquires nothing, replaces no retained snapshot, never writes into
 * the V2 wave's directories, and writes only under the three it owns.
 *
 * Usage:
 *   node scripts/midtown-core-v3-cli.mjs <plans|glbs|gates|graph|all> [--force]
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
import { EXTERIOR_WAVE_LEDGER_RELEASE_ID } from "../src/release/exterior-wave-ledger.ts";
import { replayMultiLodAssembly } from "../src/release/multi-lod-assembly.ts";
import { replayExteriorArtifactIntegrity } from "../src/release/exterior-release.ts";
import { V3_QUALITY_BUDGETS } from "../src/release/block835-v3-package.ts";
import {
  MIDTOWN_CORE_BUILDING_COUNT,
  MIDTOWN_CORE_CELL_COUNT,
  buildMidtownCoreSubsetLedger,
  midtownCoreArtifactChecksum,
  reconcileMidtownCoreAgainstDigest,
  serializeMidtownCoreArtifact,
  validateMidtownCoreSubsetLedger,
} from "../src/release/midtown-core-package.ts";
import { collectMidtownCoreSources } from "../src/release/midtown-core-source.ts";
import { MIDTOWN_CORE_SHIPPED_LOD_ID, buildMidtownCoreRelease } from "../src/release/midtown-core-release.ts";
import {
  MIDTOWN_CORE_V3_RELEASE_ID,
  MidtownCoreV3Stop,
  buildMidtownCoreV3Plan,
} from "../src/release/midtown-core-v3-materialization.ts";
import {
  MIDTOWN_CORE_V3_OUTPUT_DIRECTORY,
  midtownCoreV3Predecessor,
  midtownCoreV3PredecessorAssets,
  midtownCoreV3Profile,
} from "../src/release/midtown-core-v3-release.ts";
import { materializeMidtownCoreV3Cells, midtownCoreV3StageFingerprint } from "../src/release/midtown-core-v3-source.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotRoot = join(repositoryRoot, "public", "data", EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID);
const ledgerRoot = join(repositoryRoot, "data", "normalized", EXTERIOR_WAVE_LEDGER_RELEASE_ID);
/** The V2 wave's committed inventory. Read-only; this pipeline never writes it. */
const predecessorInventoryPath = join(repositoryRoot, "data", "midtown-core-20260811", "payload-inventory.json");

/** Directories this pipeline owns and may replace. */
export const MIDTOWN_CORE_V3_WORK_ROOT = "artifacts/midtown-core-20260811-v3";
export const MIDTOWN_CORE_V3_RECORD_ROOT = "data/midtown-core-20260811-v3";
const workRoot = join(repositoryRoot, MIDTOWN_CORE_V3_WORK_ROOT);
const recordRoot = join(repositoryRoot, MIDTOWN_CORE_V3_RECORD_ROOT);
const payloadRoot = join(repositoryRoot, MIDTOWN_CORE_V3_OUTPUT_DIRECTORY);

/**
 * Cells this cycle materializes: the SAME three priority cells the V2 wave
 * shipped. The cache-safety rationale that bounded the V2 wave is unchanged by a
 * grammar swap, and ADR 0024 scheduling stays deferred, so holding the renderable
 * set fixed is what makes the V2-to-V3 availability delta attributable to the
 * grammar alone.
 */
const RENDERABLE_CELL_COUNT = 3;

const STAGES = ["plans", "glbs", "gates", "graph"];

function fail(message) { throw new Error(`midtown-core-v3: ${message}`); }

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

  // Predecessor pins come from the V2 wave's own COMMITTED inventory, so they
  // stay derivable on a fresh clone with no payload directory present.
  const predecessorInventoryText = await readVerifiedText(predecessorInventoryPath, "committed V2 wave inventory");
  const predecessorInventory = readJsonText(predecessorInventoryText, "committed V2 wave inventory");
  const predecessorInventoryChecksumSha256 = sha256HexSync(predecessorInventoryText);
  const predecessor = midtownCoreV3Predecessor(predecessorInventory);
  const predecessorAssets = midtownCoreV3PredecessorAssets(predecessorInventory);

  return {
    manifest, manifestChecksum, capture, parentLedger, parentLedgerChecksumSha256, subset,
    predecessorInventory, predecessorInventoryChecksumSha256, predecessor, predecessorAssets,
  };
}

/**
 * Reads every declared building shard, verifying byte size and checksum before a
 * single coordinate is trusted. Unverified reads would let local corruption
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
  return midtownCoreV3StageFingerprint({
    stage,
    baseManifestChecksumSha256: context.manifestChecksum,
    parentLedgerChecksumSha256: context.parentLedgerChecksumSha256,
    subsetLedgerChecksumSha256: midtownCoreArtifactChecksum(context.subset.ledger),
    predecessorInventoryChecksumSha256: context.predecessorInventoryChecksumSha256,
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
  const receipt = { schemaVersion: "1.0", stage, releaseId: MIDTOWN_CORE_V3_RELEASE_ID, inputFingerprint: fingerprint, summary };
  await writeFile(path, serializeMidtownCoreArtifact(receipt), "utf8");
  return receipt;
}

async function writeRecord(name, value) {
  await mkdir(recordRoot, { recursive: true });
  const text = serializeMidtownCoreArtifact(value);
  await writeFile(join(recordRoot, name), text, "utf8");
  return sha256HexSync(text);
}

function renderableCells(context) {
  return context.subset.ledger.cells.slice(0, RENDERABLE_CELL_COUNT);
}

// ---------------------------------------------------------------------------
// Stage: plans
// ---------------------------------------------------------------------------

async function stagePlans(context, options) {
  const fingerprint = inputFingerprint(context, "plans");
  const existing = await readReceipt("plans");
  if (existing && existing.inputFingerprint === fingerprint && !options.force) return { skipped: true, ...existing.summary };

  const { shards, declaredShardCount } = await readVerifiedShards(context.manifest);
  const sources = collectMidtownCoreSources(shards, new Set(context.subset.buildingIds));

  const planHashes = new Set();
  const refusals = [];
  const perCell = [];
  const styleClassCounts = {};
  const refusalsByCode = {};
  let planned = 0;
  let fallbackHeights = 0;
  let tierCollapse = 0;
  let reversedRings = 0;
  let maximumRingVertexCount = 0;
  let maximumFloorCount = 0;
  for (const cell of context.subset.ledger.cells) {
    let cellPlanned = 0;
    let cellRefused = 0;
    for (const buildingId of cell.buildingIds) {
      const source = sources.get(buildingId);
      if (!source) {
        refusals.push({ buildingId, cellId: cell.cellId, code: "absent-from-base-shards", detail: "No accepted footprint resolves for this owned building." });
        refusalsByCode["absent-from-base-shards"] = (refusalsByCode["absent-from-base-shards"] ?? 0) + 1;
        cellRefused += 1;
        continue;
      }
      try {
        const built = buildMidtownCoreV3Plan(source, EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256);
        planHashes.add(built.plan.planHashSha256);
        if (built.heightSource === "fallback") fallbackHeights += 1;
        if (built.reversed) reversedRings += 1;
        if (built.plan.massing.effectiveTierCount <= 1) tierCollapse += 1;
        maximumRingVertexCount = Math.max(maximumRingVertexCount, built.ringMm.length);
        maximumFloorCount = Math.max(maximumFloorCount, built.plan.massing.floorCount);
        styleClassCounts[built.plan.styleClass] = (styleClassCounts[built.plan.styleClass] ?? 0) + 1;
        planned += 1; cellPlanned += 1;
      } catch (error) {
        if (!(error instanceof MidtownCoreV3Stop)) throw error;
        refusals.push({ buildingId, cellId: cell.cellId, code: error.code, detail: error.message });
        refusalsByCode[error.code] = (refusalsByCode[error.code] ?? 0) + 1;
        cellRefused += 1;
      }
    }
    perCell.push({ cellId: cell.cellId, order: cell.order, owned: cell.buildingIds.length, planned: cellPlanned, refused: cellRefused });
  }

  const summary = {
    declaredShardCount,
    ownedBuildingCount: context.subset.buildingIds.length,
    resolvedBuildingCount: sources.size,
    plannedBuildingCount: planned,
    refusedBuildingCount: refusals.length,
    refusalRatio: refusals.length / context.subset.buildingIds.length,
    refusalsByCode,
    tierCollapseAbsentSetbackCount: tierCollapse,
    uniquePlanHashCount: planHashes.size,
    fallbackHeightCount: fallbackHeights,
    reversedRingCount: reversedRings,
    maximumRingVertexCount,
    maximumFloorCount,
    styleClassCounts,
  };
  if (summary.ownedBuildingCount !== MIDTOWN_CORE_BUILDING_COUNT) fail(`the subset owns ${summary.ownedBuildingCount} buildings, not ${MIDTOWN_CORE_BUILDING_COUNT}.`);
  if (summary.uniquePlanHashCount !== planned) fail(`plan hashes are not unique: ${summary.uniquePlanHashCount} of ${planned}.`);

  await mkdir(workRoot, { recursive: true });
  await writeFile(join(workRoot, "plan-census.json"), serializeMidtownCoreArtifact({ ...summary, perCell, refusals }), "utf8");
  await writeReceipt("plans", fingerprint, summary);
  return { skipped: false, ...summary };
}

// ---------------------------------------------------------------------------
// Stage: glbs
// ---------------------------------------------------------------------------

/** Refuses any output directory this pipeline does not own. */
function assertOwnedPayloadDirectory(directory) {
  if (basename(directory) !== MIDTOWN_CORE_V3_RELEASE_ID) fail(`refusing to write ${directory}: only a directory named ${MIDTOWN_CORE_V3_RELEASE_ID} is writable.`);
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

  // Full-wave asset census: the same materializer the shipped subset uses, run
  // over every owned cell, so the shipped subset is never a different code path
  // from the census that measures the wave.
  const startedAt = Date.now();
  const full = materializeMidtownCoreV3Cells({
    cells: context.subset.ledger.cells,
    sources,
    baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
    capture: context.capture,
    predecessorAssets: context.predecessorAssets,
    retain: "census-only",
  });
  const censusMilliseconds = Date.now() - startedAt;

  const cells = renderableCells(context);
  const renderable = new Set(cells.map((cell) => cell.cellId));
  const shipped = materializeMidtownCoreV3Cells({
    cells,
    sources,
    baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
    capture: context.capture,
    predecessorAssets: context.predecessorAssets,
  });
  for (const [relativeRef, bytes] of [...shipped.assetBytes].sort(([left], [right]) => (left < right ? -1 : 1))) {
    if (!relativeRef.startsWith("public/")) fail(`refusing to emit a non-public asset path: ${relativeRef}`);
    const target = join(payloadRoot, relativeRef);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  const summary = {
    censusMilliseconds,
    wave: full.census,
    renderableCellIds: [...renderable],
    shipped: shipped.census,
    shippedAssetCount: shipped.assetBytes.size,
    shippedAbsentSetbackBuildingIds: [...shipped.absentSetbacks.keys()].sort(),
    shippedRefusedBuildingIds: [...shipped.refusals.keys()].sort(),
  };
  if (full.census.maximumTriangleCount > V3_QUALITY_BUDGETS.maxTriangles) fail(`a generated LOD declares ${full.census.maximumTriangleCount} triangles, above the ${V3_QUALITY_BUDGETS.maxTriangles} V3 budget.`);
  if (full.census.generatedAssetCount !== full.census.materializedBuildingCount * 2) fail("the asset census does not carry two LODs per materialized building.");

  await mkdir(workRoot, { recursive: true });
  await writeFile(join(workRoot, "asset-census.json"), serializeMidtownCoreArtifact({
    ...summary,
    waveRefusalsByCode: full.census.refusalsByCode,
    waveRefusals: [...full.refusalCodes]
      .map(([buildingId, code]) => ({ buildingId, code, reason: full.refusals.get(buildingId) }))
      .sort((left, right) => (left.buildingId < right.buildingId ? -1 : 1)),
    waveAbsentSetbackCount: full.absentSetbacks.size,
    registrationWorst: {
      perVertexShapeMeters: full.census.worstPerVertexShapeDeviationMeters,
      horizontalMeters: full.census.worstHorizontalDeviationMeters,
      verticalMeters: full.census.worstVerticalDeviationMeters,
      volumeDeviation: full.census.worstVolumeDeviation,
    },
  }), "utf8");
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

  // Availability drift against the V2 wave, over the SAME three renderable
  // cells. A building V2 shipped that V3 refuses is the delta this promotion has
  // to state out loud; it is derived here rather than asserted.
  const glbs = await readReceipt("glbs");
  if (!glbs) fail("the glbs stage has not run, so availability drift cannot be derived.");
  const v2Available = [...midtownCoreV3PredecessorAssets(context.predecessorInventory).keys()].sort();
  const v3Refused = glbs.summary.shippedRefusedBuildingIds ?? [];
  const v3Available = v2Available.filter((buildingId) => !v3Refused.includes(buildingId));
  const withdrawn = v2Available.filter((buildingId) => v3Refused.includes(buildingId));
  const added = (glbs.summary.shipped?.materializedBuildingCount ?? 0) - v3Available.length;

  const summary = {
    ownershipOk: ownership.ok,
    reconciliation: reconciliation.counts,
    reconciliationOk: reconciliation.ok,
    maximumCellBuildings: context.subset.derivation.subset.maxObservedCellBuildings,
    predecessorReleaseId: context.predecessor.releaseId,
    predecessorPublicRootChecksumSha256: context.predecessor.publicRoot.rootChecksumSha256,
    predecessorSnapshotChecksumSha256: context.predecessor.snapshot.checksumSha256,
    predecessorCellReleaseCount: context.predecessor.cellReleases.size,
    predecessorAssetPinCount: context.predecessorAssets.size,
    availability: {
      v2AvailableBuildingCount: v2Available.length,
      v3AvailableBuildingCount: glbs.summary.shipped?.materializedBuildingCount ?? 0,
      withdrawnBuildingIds: withdrawn,
      unexpectedAdditions: added,
    },
    budgets: { ...V3_QUALITY_BUDGETS },
    waveMaximumTriangleCount: glbs.summary.wave?.maximumTriangleCount ?? null,
    waveMaximumMaterialCount: glbs.summary.wave?.maximumMaterialCount ?? null,
  };
  // A successor may withdraw a building it cannot honestly draw; it may never
  // invent one the predecessor did not own.
  if (added !== 0) fail(`the V3 wave ships ${added} building(s) the V2 wave did not, which membership drift this promotion does not authorise.`);
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
  const cells = renderableCells(context);
  const sources = collectMidtownCoreSources(shards, new Set(cells.flatMap((cell) => cell.buildingIds)));
  const shipped = materializeMidtownCoreV3Cells({
    cells,
    sources,
    baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
    capture: context.capture,
    predecessorAssets: context.predecessorAssets,
  });
  const release = buildMidtownCoreRelease({
    subset: context.subset,
    renderableCellIds: cells.map((cell) => cell.cellId),
    materialized: shipped.buildings,
    refusals: shipped.refusals,
    capture: context.capture,
    profile: midtownCoreV3Profile(context.predecessor),
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
    releaseId: MIDTOWN_CORE_V3_RELEASE_ID,
    payloadDirectory: MIDTOWN_CORE_V3_OUTPUT_DIRECTORY,
    note: "The payload directory is intentionally untracked, following the citywide precedent. This inventory is the committed record that keeps every emitted byte checkable after the local tree is removed; `node scripts/midtown-core-v3-cli.mjs graph --force` rebuilds it byte-identically.",
    base: { releaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID, manifestChecksumSha256: context.manifestChecksum },
    parentLedger: { releaseId: EXTERIOR_WAVE_LEDGER_RELEASE_ID, checksumSha256: context.parentLedgerChecksumSha256 },
    predecessor: {
      releaseId: context.predecessor.releaseId,
      inventoryChecksumSha256: context.predecessorInventoryChecksumSha256,
      publicRootChecksumSha256: context.predecessor.publicRoot.rootChecksumSha256,
      snapshotChecksumSha256: context.predecessor.snapshot.checksumSha256,
      assetPinCount: context.predecessorAssets.size,
    },
    ownershipLedgerId: context.subset.ledger.ledgerId,
    roots: Object.fromEntries(release.graph.roots.map((root) => [root.audience, { rootId: root.rootId, rootChecksumSha256: root.rootChecksumSha256, artifactCount: root.artifacts.length }])),
    assemblyFingerprintSha256: assemblyReplay.value.fingerprintSha256,
    stats: release.stats,
    census: shipped.census,
    absentSetbackBuildingIds: [...shipped.absentSetbacks.keys()].sort(),
    refusedBuildingIds: [...shipped.refusals.keys()].sort(),
    totals: { fileCount: files.length, byteSize: files.reduce((total, file) => total + file.byteSize, 0) },
    files,
  };
  const inventoryChecksum = await writeRecord("payload-inventory.json", inventory);
  const derivationChecksum = await writeRecord("derivation.json", {
    schemaVersion: "1.0",
    derivation: context.subset.derivation,
    reconciliation: reconcileMidtownCoreAgainstDigest(context.subset, readJsonText(await readVerifiedText(join(ledgerRoot, "membership-digest.json"), "committed membership digest"), "membership digest")),
  });
  const censusChecksum = await writeRecord("v3-census.json", {
    schemaVersion: "1.0",
    releaseId: MIDTOWN_CORE_V3_RELEASE_ID,
    note: "Wave-scale V3 stop-code census over all 7,201 owned buildings, plus the shipped-subset census over the three renderable cells. Committed so the refusal distribution stays checkable without the untracked work root.",
    wave: (await readReceipt("glbs"))?.summary?.wave ?? null,
    waveRefusals: (await readReceipt("plans"))?.summary?.refusalsByCode ?? null,
    shipped: shipped.census,
    shippedRefusedBuildingIds: [...shipped.refusalCodes].map(([buildingId, code]) => ({ buildingId, code })).sort((left, right) => (left.buildingId < right.buildingId ? -1 : 1)),
    shippedAbsentSetbackBuildingIds: [...shipped.absentSetbacks.keys()].sort(),
    registration: shipped.registration.map((entry) => ({
      buildingId: entry.buildingId,
      sourceVertexCount: entry.sourceVertexCount,
      perVertexShapeDeviationMeters: entry.perVertexShapeDeviationMeters,
      horizontalDeviationMeters: entry.horizontalDeviationMeters,
      verticalDeviationMeters: entry.verticalDeviationMeters,
      ringOrientationReversed: entry.ringOrientationReversed,
    })).sort((left, right) => (left.buildingId < right.buildingId ? -1 : 1)),
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
    censusRecordChecksumSha256: censusChecksum,
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
  console.log(JSON.stringify({ ok: true, releaseId: MIDTOWN_CORE_V3_RELEASE_ID, stages: report }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main();
