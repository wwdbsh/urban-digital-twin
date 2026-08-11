/* global console, process, TextEncoder */
/**
 * Central-and-upper-Manhattan exterior wave pipeline (Task T019).
 *
 * A sibling of `scripts/southern-remainder-cli.mjs`, which stays exactly as it is
 * and keeps emitting the byte-frozen Southern-remainder canary and its promoted
 * P1 successor. Five resumable, idempotent stages over the pinned, gitignored
 * `manhattan-citywide-20260804` snapshot, the committed
 * `manhattan-exterior-wave-ledger-20260804` ledger, and the four promoted waves'
 * committed records:
 *
 *   plans  census every one of the 11,721 wave-w04 buildings through the V3
 *          footprint-faithful grammar over its REAL sourced ring; record which
 *          property of a polygon the grammar could not carry, never invent one.
 *   glbs   generate both canonical LODs for every planned building, run the
 *          per-asset census gates on the emitted bytes, and write the shipped
 *          LOD of the renderable cells — TEXTURED — into the payload.
 *   gates  ownership, digest reconciliation, the renderable-subset entry
 *          derivation, and the wave-scale budget statement.
 *   graph  assemble and emit the release graph, runtime index, assembly package
 *          and artifact blobs, replay the emitted bytes, and write the committed
 *          checksum inventory.
 *   sample select the deterministic Blender inspection sample and emit one
 *          authoring input per sampled building.
 *
 * THERE IS NO `probe` STAGE, and that is a decision rather than an omission.
 * The kill switch asked one question — are procedural detail tiles affordable in
 * the shipping renderer at all — and T015 answered it PASS on this exact tile
 * system, this exact sampler filter and this exact LOD placement; T016 re-measured
 * the promoted composition OFF the vsync floor and found it inside both budgets,
 * and T018 re-measured a four-wave composition at the RAISED cache cap and found
 * the same. Wave w04 changes which buildings carry the tiles, not the tiles, so
 * re-running the switch would measure the same catalogue a fourth time while
 * pretending to decide something. ADR 0036 records that inheritance explicitly,
 * including the fact that it is an inheritance.
 *
 * Each stage writes a receipt carrying the fingerprint of its inputs, so an
 * interrupted run resumes rather than restarting. The payload directory is
 * intentionally untracked (the citywide precedent);
 * `data/central-upper-manhattan-20260812/` carries the committed checksum
 * inventory that keeps it checkable after the tree is removed.
 *
 * This script acquires nothing, replaces no retained snapshot, never writes into
 * another wave's directories, and writes only under the two it owns.
 *
 * ONE RELEASE TRAVELS THIS PIPELINE TODAY, THROUGH A TABLE BUILT FOR TWO.
 *
 *   canary  (default) `manhattan-central-upper-manhattan-cells-20260812` — the
 *           order-derived renderable subset under a deliberately modest entry
 *           ceiling. Opt-in only; nothing here promotes it.
 *
 * The `RELEASE_VARIANTS` table, the optional `renderableCellDigestSha256`
 * fingerprint component and the fail-closed gates-receipt rule are carried
 * forward from the Southern-remainder pipeline UNUSED by this variant. They are
 * the seam a promoted successor slots into, and both of them exist because their
 * absence was a real defect the T016 review found: a curated subset that is a
 * constant in this repository moves nothing hashed when it is edited, and a
 * curated variant that reaches its committed inventory without a gates receipt
 * emits its refusal census as `null`. Adding the seam after the successor exists
 * would repeat both.
 *
 * Usage:
 *   node scripts/central-upper-manhattan-cli.mjs <plans|glbs|gates|graph|sample|all> [--release canary] [--force]
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
import { EXTERIOR_WAVE_LEDGER_RELEASE_ID, EXTERIOR_WAVE_PLAN, cellWaveIndex } from "../src/release/exterior-wave-ledger.ts";
import { EXTERIOR_RUNTIME_BUDGETS } from "../src/runtime/exterior-cell-runtime.ts";
import { replayMultiLodAssembly } from "../src/release/multi-lod-assembly.ts";
import { replayExteriorArtifactIntegrity } from "../src/release/exterior-release.ts";
import { V3T_QUALITY_BUDGETS } from "../src/release/block835-v3-package.ts";
import { proceduralTextureProvenance } from "../src/release/procedural-texture.ts";
import {
  exteriorWaveArtifactChecksum,
  serializeExteriorWaveArtifact,
} from "../src/release/exterior-wave-subset.ts";
import {
  CENTRAL_UPPER_MANHATTAN_BUILDING_COUNT,
  CENTRAL_UPPER_MANHATTAN_CELL_COUNT,
  CENTRAL_UPPER_MANHATTAN_RELEASE_ID,
  CENTRAL_UPPER_MANHATTAN_WAVE_INDEX,
  buildCentralUpperManhattanSubsetLedger,
  reconcileCentralUpperManhattanAgainstDigest,
  validateCentralUpperManhattanSubsetLedger,
} from "../src/release/central-upper-manhattan-package.ts";
import {
  CENTRAL_UPPER_MANHATTAN_CENSUS_PROFILE,
  CENTRAL_UPPER_MANHATTAN_MODEST_SUBSET_CEILING,
  CENTRAL_UPPER_MANHATTAN_OUTPUT_DIRECTORY,
  CENTRAL_UPPER_MANHATTAN_PREDECESSOR_RELEASE_ID,
  CENTRAL_UPPER_MANHATTAN_WAVE_PROFILE,
  centralUpperManhattanPredecessor,
  centralUpperManhattanProfile,
  centralUpperManhattanRenderableCells,
  centralUpperManhattanRenderableEntryBudget,
} from "../src/release/central-upper-manhattan-release.ts";
import { collectMidtownCoreSources, midtownCoreGlbBounds } from "../src/release/midtown-core-source.ts";
import { MIDTOWN_CORE_SHIPPED_LOD_ID, buildMidtownCoreRelease } from "../src/release/midtown-core-release.ts";
import {
  MIDTOWN_CORE_V3_VOLUME_TOLERANCE,
  MidtownCoreV3Stop,
  buildMidtownCoreV3Plan,
  writeMidtownCoreV3Assets,
} from "../src/release/midtown-core-v3-materialization.ts";
import { materializeMidtownCoreV3Cells, midtownCoreV3StageFingerprint } from "../src/release/midtown-core-v3-source.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotRoot = join(repositoryRoot, "public", "data", EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID);
const ledgerRoot = join(repositoryRoot, "data", "normalized", EXTERIOR_WAVE_LEDGER_RELEASE_ID);

/**
 * The FOUR PROMOTED waves, for cache occupancy alone — and the wave index each
 * one materializes.
 *
 * Each is read from what it actually SHIPPED rather than from a remembered
 * number, and each is named here so a FIFTH promotion cannot be forgotten: the
 * occupancy statement this pipeline emits is only as true as this list. The wave
 * index is carried beside the release id because the same list also answers the
 * complementary question — which waves are still UNPROMOTED — by subtraction from
 * the declared wave plan, rather than by a second list that could disagree with
 * this one.
 *
 * `source` says where the count comes from, because they are not all the same.
 * Block 835 declares its GLBs in its assembly package rather than on its root, so
 * a root-manifest filter over it silently returns zero; it is counted from its
 * committed payload directory instead.
 */
const PROMOTED_WAVES = [
  {
    waveIndex: 0,
    releaseId: "manhattan-exterior-cells-20260811-v3",
    source: { kind: "payload-directory", path: join(repositoryRoot, "public", "data", "manhattan-exterior-cells-20260811-v3", "public", "assets") },
  },
  {
    waveIndex: 1,
    releaseId: "manhattan-midtown-core-cells-20260811-v3",
    source: { kind: "inventory", path: join(repositoryRoot, "data", "midtown-core-20260811-v3", "payload-inventory.json") },
  },
  {
    waveIndex: 2,
    releaseId: "manhattan-lower-manhattan-cells-20260812-p1",
    source: { kind: "inventory", path: join(repositoryRoot, "data", "lower-manhattan-20260812-p1", "payload-inventory.json") },
  },
  {
    waveIndex: 3,
    releaseId: "manhattan-southern-remainder-cells-20260812-p1",
    source: { kind: "inventory", path: join(repositoryRoot, "data", "southern-remainder-20260812-p1", "payload-inventory.json") },
  },
];

/** Directories this pipeline owns and may replace. */
export const CENTRAL_UPPER_MANHATTAN_WORK_ROOT = "artifacts/central-upper-manhattan-20260812";
export const CENTRAL_UPPER_MANHATTAN_RECORD_ROOT = "data/central-upper-manhattan-20260812";

/**
 * The releases this pipeline emits, and everything that differs between them.
 * Anything not in this table is shared by construction rather than by agreement
 * between two copies.
 */
const RELEASE_VARIANTS = {
  canary: {
    variantId: "canary",
    releaseId: CENTRAL_UPPER_MANHATTAN_RELEASE_ID,
    outputDirectory: CENTRAL_UPPER_MANHATTAN_OUTPUT_DIRECTORY,
    workRoot: CENTRAL_UPPER_MANHATTAN_WORK_ROOT,
    recordRoot: CENTRAL_UPPER_MANHATTAN_RECORD_ROOT,
    waveProfile: CENTRAL_UPPER_MANHATTAN_WAVE_PROFILE,
    predecessorReleaseId: CENTRAL_UPPER_MANHATTAN_PREDECESSOR_RELEASE_ID,
    predecessorInventoryPath: join(repositoryRoot, "data", "southern-remainder-20260812-p1", "payload-inventory.json"),
    predecessorOf: centralUpperManhattanPredecessor,
    releaseProfile: centralUpperManhattanProfile,
    renderable: (cells, entryBudget) => centralUpperManhattanRenderableCells(cells, entryBudget),
    /**
     * The CANARY occupancy derivation: what an opt-in-only session may hold,
     * under a deliberately modest self-imposed ceiling. It also states, in the
     * release's own bytes, what the promoted headroom is at the cap that was in
     * force when it was emitted — and that the headroom is shared with the one
     * other wave that is still unpromoted.
     */
    occupancyOf: (input) => centralUpperManhattanRenderableEntryBudget({
      maxCacheEntries: input.maxCacheEntries,
      promotedWaves: input.promotedWaves,
      modestSubsetCeiling: CENTRAL_UPPER_MANHATTAN_MODEST_SUBSET_CEILING,
      cellBuildingCounts: input.cellBuildingCounts,
      remainingUnpromotedWaves: input.remainingUnpromotedWaves,
    }),
    curation: null,
    skylineEnvelope: null,
    stages: ["plans", "glbs", "gates", "graph", "sample"],
    inventoryNote: "The payload directory is intentionally untracked, following the citywide precedent. This inventory is the committed record that keeps every emitted byte checkable after the local tree is removed; `node scripts/central-upper-manhattan-cli.mjs graph --force` rebuilds it byte-identically. This release is a CANARY: it is pinned for `?exteriorCells=` opt-in and is absent from the promotion record, so an ordinary session never loads it. CACHE: the occupancy below is derived against the 512-entry cap raised at T018 (ADR 0034 admissible response 1). The 78-entry headroom it records beside the four promoted waves is NOT this release's to spend — wave w05 is also unpromoted, and the two waves' median cells are 48 and 55, which do not both fit. That split is a promotion decision this canary states and does not make.",
  },
};

const STAGES = ["plans", "glbs", "gates", "graph", "sample"];

function fail(message) { throw new Error(`central-upper-manhattan: ${message}`); }

function readJsonText(text, label) {
  try { return JSON.parse(text); } catch { return fail(`${label} is not valid JSON.`); }
}

async function readVerifiedText(path, label) {
  if (!existsSync(path)) fail(`${label} is absent at ${path}. This pipeline never acquires data.`);
  return readFile(path, "utf8");
}

function countInventoryGlbs(inventory) {
  return inventory.files.filter((file) => /^public\/assets\/.*\.glb$/u.test(file.path)).length;
}

/**
 * Counts what each promoted wave shipped, from that wave's own committed record.
 *
 * Every GLB artifact counts, both LODs included: the runtime cache is keyed per
 * artifact, so a resident coarse level occupies an entry exactly as a fine one
 * does. A wave whose record declares zero assets fails the run rather than
 * silently shrinking the promoted set.
 */
async function readPromotedWaveEntries() {
  const entries = [];
  for (const wave of PROMOTED_WAVES) {
    let assetEntries;
    if (wave.source.kind === "inventory") {
      const label = `committed ${wave.releaseId} inventory`;
      assetEntries = countInventoryGlbs(readJsonText(await readVerifiedText(wave.source.path, label), label));
    } else {
      if (!existsSync(wave.source.path)) fail(`the promoted ${wave.releaseId} assets are absent at ${wave.source.path}.`);
      assetEntries = (await readdir(wave.source.path)).filter((name) => name.endsWith(".glb")).length;
    }
    if (assetEntries === 0) fail(`the promoted ${wave.releaseId} record declares no GLB assets; the occupancy derivation would understate the promoted set.`);
    entries.push({ releaseId: wave.releaseId, assetEntries });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Shared inputs
// ---------------------------------------------------------------------------

async function loadContext(variant) {
  const workRoot = join(repositoryRoot, variant.workRoot);
  const recordRoot = join(repositoryRoot, variant.recordRoot);
  const payloadRoot = join(repositoryRoot, variant.outputDirectory);
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
  const parentLedgerChecksumSha256 = exteriorWaveArtifactChecksum(parentLedger);
  const recordedLedgerChecksum = (await readVerifiedText(join(ledgerRoot, "ledger.sha256"), "committed wave ledger checksum")).trim().split(/\s+/u)[0];
  if (recordedLedgerChecksum !== parentLedgerChecksumSha256) fail("committed wave ledger does not match its recorded checksum.");

  const subset = buildCentralUpperManhattanSubsetLedger({
    parentLedger,
    parentLedgerChecksumSha256,
    baseReleaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID,
    baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
  });
  if (subset.ledger.cells.length !== CENTRAL_UPPER_MANHATTAN_CELL_COUNT) fail(`subset owns ${subset.ledger.cells.length} cells, not ${CENTRAL_UPPER_MANHATTAN_CELL_COUNT}.`);

  const predecessorLabel = `committed ${variant.predecessorReleaseId} inventory`;
  const predecessorInventoryText = await readVerifiedText(variant.predecessorInventoryPath, predecessorLabel);
  const predecessorInventory = readJsonText(predecessorInventoryText, predecessorLabel);
  const predecessorInventoryChecksumSha256 = sha256HexSync(predecessorInventoryText);
  const predecessor = variant.predecessorOf(predecessorInventory);

  const promotedWaves = await readPromotedWaveEntries();

  // Which waves are still UNPROMOTED, derived by subtracting the promoted list
  // from the declared wave plan rather than written down a second time. This
  // release is itself one of them, and the headroom question is about all of them
  // at once, so each remaining wave's cell sizes are measured from the same
  // parent ledger this subset came from.
  const promotedWaveIndexes = new Set(PROMOTED_WAVES.map((wave) => wave.waveIndex));
  const remainingUnpromotedWaves = EXTERIOR_WAVE_PLAN
    .filter((wave) => !promotedWaveIndexes.has(wave.waveIndex))
    .map((wave) => ({
      waveId: wave.waveId,
      cellBuildingCounts: parentLedger.cells.filter((cell) => cellWaveIndex(cell.cellId) === wave.waveIndex).map((cell) => cell.buildingIds.length),
    }));
  if (!remainingUnpromotedWaves.some((wave) => wave.waveId === EXTERIOR_WAVE_PLAN[CENTRAL_UPPER_MANHATTAN_WAVE_INDEX].waveId)) {
    fail("this wave is missing from the unpromoted list; it is a canary and cannot be counted as promoted.");
  }

  const occupancy = variant.occupancyOf({
    maxCacheEntries: EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries,
    promotedWaves,
    cellBuildingCounts: subset.ledger.cells.map((cell) => cell.buildingIds.length),
    remainingUnpromotedWaves,
  });
  const renderable = variant.renderable(subset.ledger.cells, occupancy.entryBudget);

  return {
    variant, workRoot, recordRoot, payloadRoot,
    renderableCellDigestSha256: sha256HexSync(stableSerialize(renderable.cells.map((cell) => cell.cellId))),
    manifest, manifestChecksum, capture, parentLedger, parentLedgerChecksumSha256, subset,
    predecessorInventory, predecessorInventoryChecksumSha256, predecessor,
    occupancy,
    renderable,
  };
}

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
    subsetLedgerChecksumSha256: exteriorWaveArtifactChecksum(context.subset.ledger),
    predecessorInventoryChecksumSha256: context.predecessorInventoryChecksumSha256,
    renderableCellCount: context.renderable.cells.length,
    // WHICH cells, not merely how many, for a CURATED subset. An order-derived
    // subset is a walk of the ledger order under an entry budget, so it moves
    // whenever `subsetLedgerChecksumSha256` does; a curated list would be a
    // constant in this repository, and editing it to a different set of the same
    // length would otherwise leave every stage `skipped: true` on the previous
    // curation's bytes. The digest is over the RESOLVED cell ids, so it also
    // covers an occupancy change that re-cut the subset.
    ...(context.variant.curation ? { renderableCellDigestSha256: context.renderableCellDigestSha256 } : {}),
    shippedLodId: MIDTOWN_CORE_SHIPPED_LOD_ID,
    profile: context.variant.waveProfile,
  });
}

async function readReceipt(context, stage) {
  const path = join(context.workRoot, "stages", `${stage}.json`);
  if (!existsSync(path)) return null;
  return readJsonText(await readFile(path, "utf8"), `${stage} receipt`);
}

async function writeReceipt(context, stage, fingerprint, summary) {
  const path = join(context.workRoot, "stages", `${stage}.json`);
  await mkdir(dirname(path), { recursive: true });
  const receipt = { schemaVersion: "1.0", stage, releaseId: context.variant.releaseId, inputFingerprint: fingerprint, summary };
  await writeFile(path, serializeExteriorWaveArtifact(receipt), "utf8");
  return receipt;
}

/**
 * Reads a stage receipt and refuses a missing or STALE one.
 *
 * Stale matters as much as missing. A receipt written against different inputs
 * describes different bytes, and copying its numbers into a committed record
 * would publish a census of a build that no longer exists. Both cases name the
 * command that fixes them rather than leaving a reader to work it out.
 */
async function requireFreshReceipt(context, stage, purpose) {
  const receipt = await readReceipt(context, stage);
  const suffix = context.variant.variantId === "canary" ? "" : ` --release ${context.variant.variantId}`;
  if (!receipt) {
    fail(`the ${stage} stage has not run for the ${context.variant.variantId} variant, so ${purpose} would be emitted as null — which reads as "not applicable" rather than "never run". Run \`${stage}${suffix}\` first.`);
  }
  if (receipt.inputFingerprint !== inputFingerprint(context, stage)) {
    fail(`the ${stage} receipt for the ${context.variant.variantId} variant was written against different inputs than this run, so ${purpose} does not describe these bytes. Re-run \`${stage}${suffix} --force\`.`);
  }
  return receipt;
}

async function writeRecord(context, name, value) {
  await mkdir(context.recordRoot, { recursive: true });
  const text = serializeExteriorWaveArtifact(value);
  await writeFile(join(context.recordRoot, name), text, "utf8");
  return sha256HexSync(text);
}

// ---------------------------------------------------------------------------
// Stage: plans
// ---------------------------------------------------------------------------

async function stagePlans(context, options) {
  const fingerprint = inputFingerprint(context, "plans");
  const existing = await readReceipt(context, "plans");
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
        const built = buildMidtownCoreV3Plan(source, EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256, CENTRAL_UPPER_MANHATTAN_CENSUS_PROFILE);
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
  if (summary.ownedBuildingCount !== CENTRAL_UPPER_MANHATTAN_BUILDING_COUNT) fail(`the subset owns ${summary.ownedBuildingCount} buildings, not ${CENTRAL_UPPER_MANHATTAN_BUILDING_COUNT}.`);
  if (summary.uniquePlanHashCount !== planned) fail(`plan hashes are not unique: ${summary.uniquePlanHashCount} of ${planned}.`);

  await mkdir(context.workRoot, { recursive: true });
  await writeFile(join(context.workRoot, "plan-census.json"), serializeExteriorWaveArtifact({ ...summary, perCell, refusals }), "utf8");
  await writeReceipt(context, "plans", fingerprint, summary);
  return { skipped: false, ...summary };
}

// ---------------------------------------------------------------------------
// Stage: glbs
// ---------------------------------------------------------------------------

/**
 * Only the running variant's OWN payload directory is writable.
 *
 * The check compares against `context.variant.releaseId` rather than against a
 * set of known names, so no run of this pipeline can write into another wave's
 * frozen payload.
 */
function assertOwnedPayloadDirectory(context) {
  const directory = context.payloadRoot;
  if (basename(directory) !== context.variant.releaseId) {
    fail(`refusing to write ${directory}: only a directory named ${context.variant.releaseId} is writable by the ${context.variant.variantId} variant.`);
  }
}

async function existingFiles(directory) {
  if (!existsSync(directory)) return [];
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => relative(directory, join(entry.parentPath ?? entry.path, entry.name)).split("\\").join("/"));
}

async function stageGlbs(context, options) {
  const fingerprint = inputFingerprint(context, "glbs");
  const existing = await readReceipt(context, "glbs");
  if (existing && existing.inputFingerprint === fingerprint && !options.force && existsSync(join(context.payloadRoot, "public", "assets"))) {
    return { skipped: true, ...existing.summary };
  }
  assertOwnedPayloadDirectory(context);

  const { shards } = await readVerifiedShards(context.manifest);
  const sources = collectMidtownCoreSources(shards, new Set(context.subset.buildingIds));

  // Full-wave asset census, UNTEXTURED. The census answers a question about
  // GEOMETRY — which sourced polygons this grammar can carry — and tiles touch no
  // plan field, so the census profile shares this wave's seed, tool and generated
  // instant and therefore every plan hash with the shipped profile.
  const startedAt = Date.now();
  const full = materializeMidtownCoreV3Cells({
    cells: context.subset.ledger.cells,
    sources,
    baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
    capture: context.capture,
    retain: "census-only",
    profile: CENTRAL_UPPER_MANHATTAN_CENSUS_PROFILE,
  });
  const censusMilliseconds = Date.now() - startedAt;

  const cells = context.renderable.cells;
  const shipped = materializeMidtownCoreV3Cells({
    cells,
    sources,
    baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
    capture: context.capture,
    profile: context.variant.waveProfile,
  });
  for (const [relativeRef, bytes] of [...shipped.assetBytes].sort(([left], [right]) => (left < right ? -1 : 1))) {
    if (!relativeRef.startsWith("public/")) fail(`refusing to emit a non-public asset path: ${relativeRef}`);
    const target = join(context.payloadRoot, relativeRef);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  const summary = {
    censusMilliseconds,
    wave: full.census,
    renderableCellIds: cells.map((cell) => cell.cellId),
    shipped: shipped.census,
    shippedAssetCount: shipped.assetBytes.size,
    shippedAbsentSetbackBuildingIds: [...shipped.absentSetbacks.keys()].sort(),
    shippedRefusedBuildingIds: [...shipped.refusals.keys()].sort(),
  };
  if (full.census.maximumTriangleCount > V3T_QUALITY_BUDGETS.maxTriangles) fail(`a generated LOD declares ${full.census.maximumTriangleCount} triangles, above the ${V3T_QUALITY_BUDGETS.maxTriangles} budget.`);
  if (full.census.generatedAssetCount !== full.census.materializedBuildingCount * 2) fail("the asset census does not carry two LODs per materialized building.");
  // Tiles ride on LOD 0 alone, so a textured pass must never exceed one tile set
  // per asset nor put a tile on the coarse level.
  if (shipped.census.maximumTextureCount > V3T_QUALITY_BUDGETS.maxTextures) fail(`a shipped LOD declares ${shipped.census.maximumTextureCount} textures, above the ${V3T_QUALITY_BUDGETS.maxTextures} budget.`);
  if (full.census.maximumTextureCount !== 0) fail("the untextured wave census emitted a texture.");

  await mkdir(context.workRoot, { recursive: true });
  await writeFile(join(context.workRoot, "asset-census.json"), serializeExteriorWaveArtifact({
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
  await writeReceipt(context, "glbs", fingerprint, summary);
  return { skipped: false, ...summary };
}

// ---------------------------------------------------------------------------
// Stage: gates
// ---------------------------------------------------------------------------

async function stageGates(context, options) {
  const fingerprint = inputFingerprint(context, "gates");
  const existing = await readReceipt(context, "gates");
  if (existing && existing.inputFingerprint === fingerprint && !options.force) return { skipped: true, ...existing.summary };

  const ownership = validateCentralUpperManhattanSubsetLedger(context.subset.ledger);
  if (!ownership.ok) fail(`subset ledger fails the accepted ownership checks: ${stableSerialize(ownership.issues.slice(0, 5))}`);

  const digest = readJsonText(await readVerifiedText(join(ledgerRoot, "membership-digest.json"), "committed membership digest"), "membership digest");
  const reconciliation = reconcileCentralUpperManhattanAgainstDigest(context.subset, digest);
  if (!reconciliation.ok) fail(`digest reconciliation failed: ${stableSerialize(reconciliation.findings.slice(0, 5))}`);

  // Same rule as the graph stage's: missing OR stale both fail closed. A gates
  // summary computed from a receipt written against different inputs would state
  // a refusal ratio and an asset count for bytes this run did not produce.
  const glbs = await requireFreshReceipt(context, "glbs", "the wave statement");

  const summary = {
    ownershipOk: ownership.ok,
    reconciliation: reconciliation.counts,
    reconciliationOk: reconciliation.ok,
    maximumCellBuildings: context.subset.derivation.subset.maxObservedCellBuildings,
    exclusionCellCount: context.subset.derivation.exclusions.length,
    exclusionOverlapTotal: context.subset.derivation.exclusions.reduce((total, entry) => total + entry.overlapWithSubset, 0),
    predecessorReleaseId: context.predecessor.releaseId,
    predecessorPublicRootChecksumSha256: context.predecessor.publicRoot.rootChecksumSha256,
    predecessorSnapshotChecksumSha256: context.predecessor.snapshot.checksumSha256,
    predecessorCellReleaseCount: context.predecessor.cellReleases.size,
    occupancy: context.occupancy,
    renderable: {
      cellIds: context.renderable.cells.map((cell) => cell.cellId),
      ownedBuildingCount: context.renderable.ownedBuildingCount,
      spareEntries: context.renderable.spareEntries,
      shippedAssetCount: glbs.summary.shippedAssetCount ?? null,
    },
    tombstonedCellCount: context.subset.ledger.cells.length - context.renderable.cells.length,
    budgets: { ...V3T_QUALITY_BUDGETS },
    textureCatalog: proceduralTextureProvenance(),
    waveMaximumTriangleCount: glbs.summary.wave?.maximumTriangleCount ?? null,
    waveMaximumMaterialCount: glbs.summary.wave?.maximumMaterialCount ?? null,
    waveRefusalRatio: (glbs.summary.wave?.refusedBuildingCount ?? 0) / CENTRAL_UPPER_MANHATTAN_BUILDING_COUNT,
  };
  // A first-generation wave owns no predecessor asset, so there is no
  // availability delta to derive; what must hold is that the renderable subset
  // fits the entry budget it was derived from.
  if ((glbs.summary.shippedAssetCount ?? 0) > context.occupancy.entryBudget) {
    fail(`the renderable subset ships ${glbs.summary.shippedAssetCount} assets, above the ${context.occupancy.entryBudget}-entry budget.`);
  }
  // The wave-scale refusal ceiling this task was given. It is a STOP, not a
  // tolerance to be moved: a wave that refuses more than one building in seven
  // is not a wave whose geometry this grammar can carry.
  if (summary.waveRefusalRatio > 0.15) {
    fail(`the wave refuses ${(summary.waveRefusalRatio * 100).toFixed(2)}% of its buildings, above the 15% ceiling. No tolerance may be moved to pass this.`);
  }
  // Carried forward UNUSED by the canary. A curated variant would recompute its
  // local refusal census here from this run's own shipped census.
  if (context.variant.curation) {
    const shipped = glbs.summary.shipped ?? {};
    summary.curation = {
      basis: context.variant.curation.basis,
      statement: context.variant.curation.statement,
      cells: context.variant.curation.cells.map((record) => ({ ...record })),
      refusal: context.variant.curation.refusalCensus({
        ownedBuildingCount: context.renderable.ownedBuildingCount,
        materializedBuildingCount: shipped.materializedBuildingCount ?? 0,
        refusedBuildingCount: shipped.refusedBuildingCount ?? 0,
      }),
    };
    if (summary.curation.refusal.ok !== true) {
      fail(`the curated subset's local refusal rate is above the ceiling its curation sets. No tolerance was moved to improve it.`);
    }
  }
  await writeReceipt(context, "gates", fingerprint, summary);
  return { skipped: false, ...summary };
}

// ---------------------------------------------------------------------------
// Stage: graph
// ---------------------------------------------------------------------------

async function stageGraph(context, options) {
  const fingerprint = inputFingerprint(context, "graph");
  const existing = await readReceipt(context, "graph");
  if (existing && existing.inputFingerprint === fingerprint && !options.force && existsSync(join(context.payloadRoot, "release-graph.json"))) {
    return { skipped: true, ...existing.summary };
  }
  assertOwnedPayloadDirectory(context);

  const { shards } = await readVerifiedShards(context.manifest);
  const cells = context.renderable.cells;
  const sources = collectMidtownCoreSources(shards, new Set(cells.flatMap((cell) => cell.buildingIds)));
  const shipped = materializeMidtownCoreV3Cells({
    cells,
    sources,
    baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
    capture: context.capture,
    profile: context.variant.waveProfile,
  });
  const release = buildMidtownCoreRelease({
    subset: context.subset,
    renderableCellIds: cells.map((cell) => cell.cellId),
    materialized: shipped.buildings,
    refusals: shipped.refusals,
    capture: context.capture,
    profile: context.variant.releaseProfile(context.predecessor),
  });

  const payload = new Map([...release.files, ...shipped.assetBytes]);
  const stale = (await existingFiles(context.payloadRoot)).filter((path) => !payload.has(path));
  for (const path of stale) await rm(join(context.payloadRoot, path));
  for (const [path, bytes] of [...payload].sort(([left], [right]) => (left < right ? -1 : 1))) {
    const target = join(context.payloadRoot, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  const emitted = new Map();
  for (const path of await existingFiles(context.payloadRoot)) emitted.set(path, new Uint8Array(await readFile(join(context.payloadRoot, path))));
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
  // The assembly replay is given this release's OWN admission, taken from the
  // emitted public root rather than from a constant, so the replay is gated by
  // exactly what the release declares.
  const publicRoot = release.graph.roots.find((root) => root.audience === "public");
  const admission = publicRoot.textureAdmission;
  if (admission?.policy !== "procedural-replay") fail("the emitted public root does not declare the procedural-replay admission this wave's textured assets require.");
  const assemblyReplay = await replayMultiLodAssembly(release.assemblies[0], assemblyContents, {
    textureAdmission: admission.policy,
    declaredSamplerFilter: { ...admission.generatedTextureFact.samplerFilter },
  });
  if (!assemblyReplay.ok) fail(`assembly replay failed: ${stableSerialize(assemblyReplay.issues.slice(0, 5))}`);

  const privateLeaks = [...emitted.keys()].filter((path) => path.startsWith("private/") || path.toLowerCase().includes("/private"));
  if (privateLeaks.length > 0) fail(`private-audience bytes reached the browser-reachable root: ${privateLeaks.join(", ")}`);

  // A curated variant may not reach the committed record without its gates
  // receipt, or its ADR-precondition refusal census would be emitted as `null` —
  // which reads as "not applicable" rather than as "never checked".
  // `stageGates` hard-fails on a missing `glbs` receipt but nothing makes
  // `graph` require `gates`, so this is the fail-closed edge. Inert for the
  // canary, which carries no curation at all.
  let curationRefusal = null;
  if (context.variant.curation) {
    const gates = await requireFreshReceipt(context, "gates", "the curated subset's refusal census");
    curationRefusal = gates.summary?.curation?.refusal ?? null;
    if (curationRefusal === null || curationRefusal.ok !== true) {
      fail(`the gates receipt for the ${context.variant.variantId} variant carries no passing refusal census; the curated subset's precondition result cannot be emitted as null.`);
    }
  }

  const files = [...emitted]
    .map(([path, bytes]) => ({ path, byteSize: bytes.byteLength, checksumSha256: sha256HexBytes(bytes) }))
    .sort((left, right) => (left.path < right.path ? -1 : 1));
  const inventory = {
    schemaVersion: "1.0",
    releaseId: context.variant.releaseId,
    payloadDirectory: context.variant.outputDirectory,
    note: context.variant.inventoryNote,
    base: { releaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID, manifestChecksumSha256: context.manifestChecksum },
    parentLedger: { releaseId: EXTERIOR_WAVE_LEDGER_RELEASE_ID, checksumSha256: context.parentLedgerChecksumSha256 },
    predecessor: {
      releaseId: context.predecessor.releaseId,
      inventoryChecksumSha256: context.predecessorInventoryChecksumSha256,
      publicRootChecksumSha256: context.predecessor.publicRoot.rootChecksumSha256,
      snapshotChecksumSha256: context.predecessor.snapshot.checksumSha256,
    },
    ownershipLedgerId: context.subset.ledger.ledgerId,
    textureAdmission: { policy: "procedural-replay", ...proceduralTextureProvenance(), samplerFilter: { ...context.variant.waveProfile.textureFilter } },
    occupancy: context.occupancy,
    renderableCellIds: cells.map((cell) => cell.cellId),
    // How the renderable subset was chosen, carried in the release's own
    // committed record rather than only in an ADR. The key is SPREAD IN, not set
    // to `null`, for a variant without a curation: a release that derived its
    // subset from the ledger order says so by carrying no curation record at
    // all, and an extra `"curation": null` would move a checksum a successor's
    // predecessor pin is taken over.
    ...(context.variant.curation
      ? {
        curation: {
          basis: context.variant.curation.basis,
          statement: context.variant.curation.statement,
          cells: context.variant.curation.cells.map((record) => ({ ...record })),
          refusal: curationRefusal,
        },
      }
      : {}),
    roots: Object.fromEntries(release.graph.roots.map((root) => [root.audience, { rootId: root.rootId, rootChecksumSha256: root.rootChecksumSha256, artifactCount: root.artifacts.length }])),
    assemblyFingerprintSha256: assemblyReplay.value.fingerprintSha256,
    stats: release.stats,
    census: shipped.census,
    absentSetbackBuildingIds: [...shipped.absentSetbacks.keys()].sort(),
    refusedBuildingIds: [...shipped.refusals.keys()].sort(),
    totals: { fileCount: files.length, byteSize: files.reduce((total, file) => total + file.byteSize, 0) },
    files,
  };
  const inventoryChecksum = await writeRecord(context, "payload-inventory.json", inventory);
  const derivationChecksum = await writeRecord(context, "derivation.json", {
    schemaVersion: "1.0",
    derivation: context.subset.derivation,
    reconciliation: reconcileCentralUpperManhattanAgainstDigest(context.subset, readJsonText(await readVerifiedText(join(ledgerRoot, "membership-digest.json"), "committed membership digest"), "membership digest")),
  });
  // The wave census is the whole point of the committed record. Missing OR stale
  // both fail closed: `?? null` would emit `"wave": null` — a census that reads
  // as "not applicable" rather than "never run" — which is the H2 defect the
  // T017 review found on this exact line and fixed with this exact helper.
  const waveCensus = await requireFreshReceipt(context, "glbs", "the wave-scale census");
  const planCensus = await requireFreshReceipt(context, "plans", "the plan-stage refusal distribution");
  const censusChecksum = await writeRecord(context, "wave-census.json", {
    schemaVersion: "1.0",
    releaseId: context.variant.releaseId,
    note: `Wave-scale V3 stop-code census over all ${CENTRAL_UPPER_MANHATTAN_BUILDING_COUNT.toLocaleString("en-US")} owned buildings — the largest wave of the six — plus the shipped-subset census over the renderable cells. Committed so the refusal distribution stays checkable without the untracked work root. The wave census is untextured by design; the shipped subset carries procedural-texture-v1 tiles on LOD 0. READ \`wave.retention\` BEFORE \`wave.shippedAssetCount\`: the wave pass runs \`census-only\`, so it generated, gated and measured every asset and then dropped the bytes rather than keeping them. Its \`shippedAssetBytes\` is therefore a real measurement while its \`shippedAssetCount\` is zero, which is a retention mode and not a contradiction. The \`shipped\` object below is the pass that retained bytes. TWO REFUSAL DISTRIBUTIONS ARE RECORDED AND FOR THIS WAVE THEY ARE EQUAL. \`waveRefusals\` is the PLAN stage: the grammar reading a sourced polygon and reporting which property of it it cannot carry. \`wave.refusalsByCode\` is the ASSET stage: the same plans plus the writer's own mesh-versus-analytic volume identity check, which can only fail after a plan has been accepted and geometry has been generated. The asset distribution is therefore always a superset of the plan distribution and the only key that can appear in it alone is \`volume-identity-failed\`. THE PREVIOUS WAVE'S RECORD SAID EQUAL TOTALS WOULD MEAN THE IDENTITY CHECK HAD NEVER RUN. THAT IS NOT TRUE OF THIS WAVE AND THE SENTENCE IS NOT CARRIED OVER. Wave w03 happened to contain 11 buildings the writer's check rejected, so its two totals differed; here the check ran on every one of the ${waveCensus.summary.wave.materializedBuildingCount.toLocaleString("en-US")} materialized buildings and rejected none, which is why the totals are equal. The check running and finding nothing is recorded as a measurement rather than inferred from the equality: \`volumeIdentity\` below carries the count checked, the count rejected, the worst deviation observed across the whole wave and the tolerance it was compared against. An equal-totals record with a worst deviation of zero and nothing checked would be the failure this paragraph exists to distinguish, and it is distinguishable here.`,
    // The writer-stage check stated as a MEASUREMENT rather than left to be
    // inferred from two totals that happen to match. This is what separates "the
    // identity check ran on 11,543 buildings and rejected none" from "the
    // identity check never ran", which are indistinguishable from the refusal
    // distributions alone.
    volumeIdentity: {
      stage: "asset-writer",
      stopCode: "volume-identity-failed",
      buildingsChecked: waveCensus.summary.wave.materializedBuildingCount,
      buildingsRejected: waveCensus.summary.wave.refusalsByCode["volume-identity-failed"] ?? 0,
      worstVolumeDeviation: waveCensus.summary.wave.worstVolumeDeviation,
      tolerance: MIDTOWN_CORE_V3_VOLUME_TOLERANCE,
      worstDeviationAsFractionOfTolerance: waveCensus.summary.wave.worstVolumeDeviation / MIDTOWN_CORE_V3_VOLUME_TOLERANCE,
      statement: "Every materialized building's generated mesh volume was compared against the analytic volume its plan declares. The worst deviation observed across the whole wave is recorded beside the tolerance it was compared against, so a run in which the check silently did not execute is distinguishable from a run in which it executed and passed. THE MARGIN IS NARROW AND IS REPORTED RATHER THAN ROUNDED AWAY: the worst case in this wave sits at more than nine tenths of the tolerance. Zero rejections here therefore means the check passed, not that it passed comfortably, and a reader deciding whether this wave's geometry is sound should read `worstDeviationAsFractionOfTolerance` and not only `buildingsRejected`. No tolerance was moved; the recorded value is the accepted MIDTOWN_CORE_V3_VOLUME_TOLERANCE unchanged.",
    },
    textureCatalog: proceduralTextureProvenance(),
    samplerFilter: { ...context.variant.waveProfile.textureFilter },
    occupancy: context.occupancy,
    wave: waveCensus.summary.wave,
    waveRefusals: planCensus.summary.refusalsByCode,
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
  await writeReceipt(context, "graph", fingerprint, summary);
  return { skipped: false, ...summary };
}

// ---------------------------------------------------------------------------
// Stage: sample
// ---------------------------------------------------------------------------

const V3_SAMPLE_STRATA = [
  { id: "most-ring-vertices", order: (entry) => [-entry.ringVertexCount] },
  { id: "fewest-ring-vertices", order: (entry) => [entry.ringVertexCount] },
  { id: "tallest", order: (entry) => [-entry.heightMm] },
  { id: "shortest", order: (entry) => [entry.heightMm] },
  { id: "largest-footprint-area", order: (entry) => [-entry.footprintAreaMm2] },
  { id: "smallest-footprint-area", order: (entry) => [entry.footprintAreaMm2] },
  { id: "most-triangles", order: (entry) => [-entry.triangleCount] },
  { id: "fewest-triangles", order: (entry) => [entry.triangleCount] },
  { id: "fallback-height", order: (entry) => [entry.heightSource === "fallback" ? 0 : 1, entry.heightMm] },
  { id: "most-tiers", order: (entry) => [-entry.effectiveTierCount] },
  // The assets that carry the most distinct motifs are where a UV projection or
  // a tile binding would show a fault.
  { id: "most-textures", order: (entry) => [-entry.textureCount, -entry.triangleCount] },
];
const V3_SAMPLES_PER_STRATUM = 4;

function compareBy(order) {
  return (left, right) => {
    const a = order(left);
    const b = order(right);
    for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
    return left.buildingId < right.buildingId ? -1 : left.buildingId > right.buildingId ? 1 : 0;
  };
}

function ringAreaMm2(ring) {
  let twice = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    twice += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(twice) / 2;
}

async function stageSample(context, options) {
  const fingerprint = inputFingerprint(context, "sample");
  const existing = await readReceipt(context, "sample");
  if (existing && existing.inputFingerprint === fingerprint && !options.force) return { skipped: true, ...existing.summary };

  const { shards } = await readVerifiedShards(context.manifest);
  const cells = context.renderable.cells;
  const sources = collectMidtownCoreSources(shards, new Set(cells.flatMap((cell) => cell.buildingIds)));

  const candidates = [];
  for (const cell of cells) {
    for (const buildingId of cell.buildingIds) {
      const source = sources.get(buildingId);
      if (!source) continue;
      let context3;
      try { context3 = buildMidtownCoreV3Plan(source, EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256, context.variant.waveProfile); }
      catch (error) { if (!(error instanceof MidtownCoreV3Stop)) throw error; continue; }
      const written = writeMidtownCoreV3Assets(context3, {
        ownerCellId: cell.cellId,
        capturedAt: context.capture.capturedAt,
        updatedAt: context.capture.updatedAt,
        predecessor: null,
        profile: context.variant.waveProfile,
      });
      const shippedAsset = written.assets.find((asset) => asset.lodId === MIDTOWN_CORE_SHIPPED_LOD_ID);
      candidates.push({
        buildingId,
        cellId: cell.cellId,
        plan: context3.plan,
        ringVertexCount: context3.ringMm.length,
        heightMm: context3.plan.input.geometry.heightMm,
        heightSource: context3.heightSource,
        footprintAreaMm2: ringAreaMm2(context3.plan.tiers[0].ring),
        effectiveTierCount: context3.plan.massing.effectiveTierCount,
        setbacksAbsent: written.setbacksAbsent,
        triangleCount: shippedAsset.counts.triangleCount,
        materialCount: shippedAsset.counts.materialCount,
        textureCount: shippedAsset.counts.textureCount,
        analyticVolumeCubicMeters: shippedAsset.analyticVolumeCubicMeters,
        meshVolumeCubicMeters: shippedAsset.meshVolumeCubicMeters,
        boundsYUp: midtownCoreGlbBounds(shippedAsset.bytes),
        checksumSha256: shippedAsset.checksumSha256,
        relativeRef: shippedAsset.relativeRef,
      });
    }
  }

  const byId = new Map(candidates.map((entry) => [entry.buildingId, entry]));
  const chosen = new Map();
  const strata = [];
  for (const stratum of V3_SAMPLE_STRATA) {
    const ordered = [...candidates].sort(compareBy(stratum.order));
    const taken = [];
    for (const entry of ordered) {
      if (taken.length >= V3_SAMPLES_PER_STRATUM) break;
      if (chosen.has(entry.buildingId)) continue;
      chosen.set(entry.buildingId, stratum.id);
      taken.push(entry.buildingId);
    }
    strata.push({ stratum: stratum.id, buildingIds: taken });
  }
  // EVERY disclosed tier collapse in the renderable cells, not a sample of them.
  const collapse = candidates.filter((entry) => entry.setbacksAbsent).map((entry) => entry.buildingId).sort();
  for (const buildingId of collapse) if (!chosen.has(buildingId)) chosen.set(buildingId, "tier-collapse-absent-setbacks");
  strata.push({ stratum: "tier-collapse-absent-setbacks", buildingIds: collapse });

  const sampleIds = [...chosen.keys()].sort();
  const texturedSampleIds = sampleIds.filter((buildingId) => byId.get(buildingId).textureCount > 0);
  if (texturedSampleIds.length < 10) fail(`only ${texturedSampleIds.length} sampled assets carry tiles; a textured wave must re-import at least 10.`);

  const inputsRoot = join(context.workRoot, "blender", "inputs");
  await rm(inputsRoot, { recursive: true, force: true });
  await mkdir(inputsRoot, { recursive: true });
  for (const buildingId of sampleIds) {
    const entry = byId.get(buildingId);
    const slug = buildingId.replace(":", "-");
    await writeFile(join(inputsRoot, `${slug}.json`), serializeExteriorWaveArtifact({
      buildingId,
      cellId: entry.cellId,
      stratum: chosen.get(buildingId),
      assetPath: join(context.payloadRoot, entry.relativeRef),
      checksumSha256: entry.checksumSha256,
      planHashSha256: entry.plan.planHashSha256,
      declared: { triangleCount: entry.triangleCount, materialCount: entry.materialCount, textureCount: entry.textureCount },
      declaredBoundsYUp: entry.boundsYUp,
      analyticVolumeCubicMeters: entry.analyticVolumeCubicMeters,
      writerMeshVolumeCubicMeters: entry.meshVolumeCubicMeters,
      volumeTolerance: MIDTOWN_CORE_V3_VOLUME_TOLERANCE,
      setbacksAbsent: entry.setbacksAbsent,
      effectiveTierCount: entry.effectiveTierCount,
      ringVertexCount: entry.ringVertexCount,
      heightMm: entry.heightMm,
      heightSource: entry.heightSource,
    }), "utf8");
  }

  const summary = {
    candidateCount: candidates.length,
    sampleCount: sampleIds.length,
    texturedSampleCount: texturedSampleIds.length,
    tierCollapseCount: collapse.length,
    strata,
    sampleIds,
    inputsDirectory: join(context.variant.workRoot, "blender", "inputs"),
  };
  await writeFile(join(context.workRoot, "blender-sample.json"), serializeExteriorWaveArtifact(summary), "utf8");
  await writeReceipt(context, "sample", fingerprint, summary);
  return { skipped: false, ...summary };
}

// ---------------------------------------------------------------------------

const RUNNERS = { plans: stagePlans, glbs: stageGlbs, gates: stageGates, graph: stageGraph, sample: stageSample };

async function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes("--force");
  const requested = argv.filter((token, index) => !token.startsWith("--") && argv[index - 1] !== "--release");
  const stage = requested[0] ?? "all";
  if (stage !== "all" && !STAGES.includes(stage)) fail(`unknown stage ${stage}; expected one of ${STAGES.join(", ")} or all.`);

  const variantIndex = argv.indexOf("--release");
  const variantId = variantIndex >= 0 ? argv[variantIndex + 1] : "canary";
  const variant = RELEASE_VARIANTS[variantId];
  if (!variant) fail(`unknown release variant ${variantId}; expected one of ${Object.keys(RELEASE_VARIANTS).join(", ")}.`);
  if (stage !== "all" && !variant.stages.includes(stage)) {
    fail(`the ${variant.variantId} variant does not run stage ${stage}; it runs ${variant.stages.join(", ")}.`);
  }

  const context = await loadContext(variant);
  const report = {};
  for (const name of stage === "all" ? variant.stages : [stage]) {
    const startedAt = Date.now();
    report[name] = { ...(await RUNNERS[name](context, { force })), elapsedMilliseconds: Date.now() - startedAt };
  }
  console.log(JSON.stringify({
    ok: true,
    variant: variant.variantId,
    releaseId: variant.releaseId,
    predecessorReleaseId: variant.predecessorReleaseId,
    stages: report,
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main();
