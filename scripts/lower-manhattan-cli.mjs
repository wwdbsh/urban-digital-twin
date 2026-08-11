/* global console, process, TextEncoder */
/**
 * Lower-Manhattan exterior wave pipeline (Task T015) — the FIRST TEXTURED WAVE.
 *
 * A sibling of `scripts/midtown-core-v3-cli.mjs`, which stays exactly as it is
 * and keeps emitting the byte-frozen Midtown-core waves. Six resumable,
 * idempotent stages over the pinned, gitignored `manhattan-citywide-20260804`
 * snapshot, the committed `manhattan-exterior-wave-ledger-20260804` ledger, and
 * the promoted Midtown-core V3 wave's committed inventory:
 *
 *   probe  KILL SWITCH, and it runs FIRST. Build the heaviest cell of the
 *          renderable subset in BOTH variants — untextured baseline and
 *          textured candidate — into a gitignored scratch root, and write the
 *          harness input the Cesium probe page reads. `capture` then measures
 *          them in the shipping renderer. If the textured variant is not
 *          acceptable against its own untextured baseline, the wave proceeds
 *          UNTEXTURED and nothing below changes except the profile.
 *   plans  census every one of the 6,425 wave-w02 buildings through the V3
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
 * Each stage writes a receipt carrying the fingerprint of its inputs, so an
 * interrupted run resumes rather than restarting. The payload directory is
 * intentionally untracked (the citywide precedent);
 * `data/lower-manhattan-20260812/` carries the committed checksum inventory that
 * keeps it checkable after the tree is removed.
 *
 * This script acquires nothing, replaces no retained snapshot, never writes into
 * another wave's directories, and writes only under the three it owns.
 *
 * Usage:
 *   node scripts/lower-manhattan-cli.mjs <probe|plans|glbs|gates|graph|sample|all> [--force]
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
  LOWER_MANHATTAN_BUILDING_COUNT,
  LOWER_MANHATTAN_CELL_COUNT,
  buildLowerManhattanSubsetLedger,
  reconcileLowerManhattanAgainstDigest,
  validateLowerManhattanSubsetLedger,
} from "../src/release/lower-manhattan-package.ts";
import { LOWER_MANHATTAN_RELEASE_ID } from "../src/release/lower-manhattan-package.ts";
import {
  LOWER_MANHATTAN_CENSUS_PROFILE,
  LOWER_MANHATTAN_OUTPUT_DIRECTORY,
  LOWER_MANHATTAN_PREDECESSOR_RELEASE_ID,
  LOWER_MANHATTAN_WAVE_PROFILE,
  lowerManhattanPredecessor,
  lowerManhattanProfile,
  lowerManhattanRenderableCells,
  lowerManhattanRenderableEntryBudget,
} from "../src/release/lower-manhattan-release.ts";
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
/** The promoted Midtown-core V3 wave's committed inventory. Read-only. */
const predecessorInventoryPath = join(repositoryRoot, "data", "midtown-core-20260811-v3", "payload-inventory.json");
/** The promoted Block 835 V3 payload, for its shipped asset count alone. */
const block835AssetsRoot = join(repositoryRoot, "public", "data", "manhattan-exterior-cells-20260811-v3", "public", "assets");

/** Directories this pipeline owns and may replace. */
export const LOWER_MANHATTAN_WORK_ROOT = "artifacts/lower-manhattan-20260812";
export const LOWER_MANHATTAN_RECORD_ROOT = "data/lower-manhattan-20260812";
/** Served to the Cesium probe page by the dev/preview middleware; gitignored. */
export const LOWER_MANHATTAN_PROBE_ROOT = "artifacts/lower-manhattan-20260812-probe";
const workRoot = join(repositoryRoot, LOWER_MANHATTAN_WORK_ROOT);
const recordRoot = join(repositoryRoot, LOWER_MANHATTAN_RECORD_ROOT);
const probeRoot = join(repositoryRoot, LOWER_MANHATTAN_PROBE_ROOT);
const payloadRoot = join(repositoryRoot, LOWER_MANHATTAN_OUTPUT_DIRECTORY);

const STAGES = ["probe", "plans", "glbs", "gates", "graph", "sample"];

function fail(message) { throw new Error(`lower-manhattan: ${message}`); }

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
  const parentLedgerChecksumSha256 = exteriorWaveArtifactChecksum(parentLedger);
  const recordedLedgerChecksum = (await readVerifiedText(join(ledgerRoot, "ledger.sha256"), "committed wave ledger checksum")).trim().split(/\s+/u)[0];
  if (recordedLedgerChecksum !== parentLedgerChecksumSha256) fail("committed wave ledger does not match its recorded checksum.");

  const subset = buildLowerManhattanSubsetLedger({
    parentLedger,
    parentLedgerChecksumSha256,
    baseReleaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID,
    baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
  });
  if (subset.ledger.cells.length !== LOWER_MANHATTAN_CELL_COUNT) fail(`subset owns ${subset.ledger.cells.length} cells, not ${LOWER_MANHATTAN_CELL_COUNT}.`);

  const predecessorInventoryText = await readVerifiedText(predecessorInventoryPath, "committed Midtown-core V3 inventory");
  const predecessorInventory = readJsonText(predecessorInventoryText, "committed Midtown-core V3 inventory");
  const predecessorInventoryChecksumSha256 = sha256HexSync(predecessorInventoryText);
  const predecessor = lowerManhattanPredecessor(predecessorInventory);

  // Promoted cache occupancy, counted from what the two promoted waves actually
  // SHIPPED rather than from a remembered number. Every GLB artifact is counted,
  // both LODs included: the runtime cache is keyed per artifact, so a resident
  // coarse level occupies an entry exactly as a fine one does.
  const midtownAssetEntries = predecessorInventory.files.filter((file) => /^public\/assets\/.*\.glb$/u.test(file.path)).length;
  // Counted from the COMMITTED payload directory rather than from the root
  // manifest: that release declares its GLBs in its assembly package, not on the
  // root, so a root-manifest filter silently returns zero — which it did, and
  // which would have handed this wave 28 cache entries that are not free.
  if (!existsSync(block835AssetsRoot)) fail(`the promoted Block 835 V3 assets are absent at ${block835AssetsRoot}.`);
  const block835AssetEntries = (await readdir(block835AssetsRoot)).filter((name) => name.endsWith(".glb")).length;
  if (block835AssetEntries === 0) fail("the promoted Block 835 V3 payload declares no GLB assets; the occupancy derivation would understate the promoted set.");
  const promotedAssetEntries = midtownAssetEntries + block835AssetEntries;

  const entryBudget = lowerManhattanRenderableEntryBudget({
    maxCacheEntries: EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries,
    promotedAssetEntries,
  });
  const renderable = lowerManhattanRenderableCells(subset.ledger.cells, entryBudget);

  return {
    manifest, manifestChecksum, capture, parentLedger, parentLedgerChecksumSha256, subset,
    predecessorInventory, predecessorInventoryChecksumSha256, predecessor,
    occupancy: {
      maxCacheEntries: EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries,
      block835AssetEntries,
      midtownAssetEntries,
      promotedAssetEntries,
      entryBudget,
    },
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
    shippedLodId: MIDTOWN_CORE_SHIPPED_LOD_ID,
    profile: LOWER_MANHATTAN_WAVE_PROFILE,
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
  const receipt = { schemaVersion: "1.0", stage, releaseId: LOWER_MANHATTAN_RELEASE_ID, inputFingerprint: fingerprint, summary };
  await writeFile(path, serializeExteriorWaveArtifact(receipt), "utf8");
  return receipt;
}

async function writeRecord(name, value) {
  await mkdir(recordRoot, { recursive: true });
  const text = serializeExteriorWaveArtifact(value);
  await writeFile(join(recordRoot, name), text, "utf8");
  return sha256HexSync(text);
}

// ---------------------------------------------------------------------------
// Stage: probe (the kill switch)
// ---------------------------------------------------------------------------

/** Metres per degree at Manhattan's latitude; only used to place probe cameras. */
const METERS_PER_DEGREE_LATITUDE = 111_320;

/**
 * The three viewing distances the kill switch measures at.
 *
 * They are the ranges a user actually occupies, not a sweep: a facade at reading
 * distance, a street approach, and a skyline view past the LOD 0 cut-off where a
 * 128-pixel tile is repeated most and aliases worst.
 */
const PROBE_STATIONS = [
  { stationId: "facade-detail", groundDistanceMeters: 60, cameraHeightMeters: 35, pitchDegrees: -6, note: "Facade at reading distance: the range a detail tile exists for." },
  { stationId: "street-approach", groundDistanceMeters: 190, cameraHeightMeters: 55, pitchDegrees: -12, note: "Street approach: many textured facades at once, the common exploration range." },
  { stationId: "far-silhouette", groundDistanceMeters: 640, cameraHeightMeters: 260, pitchDegrees: -20, note: "Beyond the LOD 0 cut-off: maximum tile repeats per screen pixel, where aliasing shows first." },
];

async function stageProbe(context, options) {
  const fingerprint = inputFingerprint(context, "probe");
  const existing = await readReceipt("probe");
  if (existing && existing.inputFingerprint === fingerprint && !options.force && existsSync(join(probeRoot, "harness.json"))) {
    return { skipped: true, ...existing.summary };
  }

  // The worst case among what will actually ship: the heaviest cell of the
  // renderable subset. Measuring the lightest would prove nothing about cost.
  const cell = [...context.renderable.cells].sort((left, right) => right.buildingIds.length - left.buildingIds.length)[0];
  const { shards } = await readVerifiedShards(context.manifest);
  const sources = collectMidtownCoreSources(shards, new Set(cell.buildingIds));

  const variants = [];
  for (const [variantId, profile, note] of [
    ["untextured-baseline", LOWER_MANHATTAN_CENSUS_PROFILE, "The V3 grammar with no detail tiles: this wave's own untextured baseline."],
    ["textured-candidate", LOWER_MANHATTAN_WAVE_PROFILE, "The same plans with procedural-texture-v1 detail tiles on LOD 0, LINEAR/LINEAR_MIPMAP_LINEAR."],
  ]) {
    const materialized = materializeMidtownCoreV3Cells({
      cells: [cell],
      sources,
      baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
      capture: context.capture,
      profile,
    });
    const assets = [];
    for (const building of materialized.buildings) {
      const asset = building.assets.find((entry) => entry.lodId === MIDTOWN_CORE_SHIPPED_LOD_ID);
      if (!asset) continue;
      const bytes = materialized.assetBytes.get(asset.relativeRef);
      const target = join(probeRoot, variantId, asset.relativeRef);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
      assets.push({
        canonicalBuildingId: building.buildingId,
        relativeRef: asset.relativeRef,
        byteSize: asset.byteSize,
        checksumSha256: asset.checksumSha256,
        textureCount: asset.counts.textureCount,
        longitude: building.representative[0],
        latitude: building.representative[1],
      });
    }
    variants.push({
      variantId,
      samplerFilter: profile.textureFilter ? { ...profile.textureFilter } : null,
      note,
      assets,
      census: materialized.census,
    });
  }

  const baseline = variants[0];
  const candidate = variants[1];
  if (baseline.assets.length !== candidate.assets.length) {
    fail(`the two probe variants materialize different building sets (${baseline.assets.length} vs ${candidate.assets.length}); the comparison would not be attributable to texturing.`);
  }
  if (candidate.assets.some((asset) => asset.textureCount === 0)) fail("the textured candidate emitted an untextured asset.");
  if (baseline.assets.some((asset) => asset.textureCount !== 0)) fail("the untextured baseline emitted a textured asset.");

  // Stations look at the tallest building of the cell, from the south-west, so
  // both variants see the identical geometry from the identical place.
  const tallest = [...candidate.assets].sort((left, right) => right.byteSize - left.byteSize)[0];
  const targetSource = sources.get(tallest.canonicalBuildingId);
  const metersPerDegreeLongitude = METERS_PER_DEGREE_LATITUDE * Math.cos((targetSource.representative[1] * Math.PI) / 180);
  const stations = PROBE_STATIONS.map((station) => {
    // Camera sits south-west of the target and looks north-east.
    const offset = station.groundDistanceMeters / Math.SQRT2;
    return {
      stationId: station.stationId,
      note: station.note,
      targetBuildingId: tallest.canonicalBuildingId,
      groundDistanceMeters: station.groundDistanceMeters,
      longitude: targetSource.representative[0] - offset / metersPerDegreeLongitude,
      latitude: targetSource.representative[1] - offset / METERS_PER_DEGREE_LATITUDE,
      heightMeters: station.cameraHeightMeters,
      headingDegrees: 45,
      pitchDegrees: station.pitchDegrees,
      rollDegrees: 0,
    };
  });

  const harness = {
    schemaVersion: "1.0",
    packageId: LOWER_MANHATTAN_RELEASE_ID,
    note: "T015 kill switch: the first textured wave's heaviest renderable cell, in the shipping renderer, against its own untextured baseline. Scratch only; not a release.",
    cellId: cell.cellId,
    textureCatalog: proceduralTextureProvenance(),
    stations,
    variants: variants.map((variant) => ({ variantId: variant.variantId, samplerFilter: variant.samplerFilter, note: variant.note, assets: variant.assets })),
  };
  await writeFile(join(probeRoot, "harness.json"), serializeExteriorWaveArtifact(harness), "utf8");

  const summary = {
    cellId: cell.cellId,
    ownedBuildingCount: cell.buildingIds.length,
    materializedBuildingCount: candidate.assets.length,
    targetBuildingId: tallest.canonicalBuildingId,
    stationIds: stations.map((station) => station.stationId),
    variants: variants.map((variant) => ({
      variantId: variant.variantId,
      assetCount: variant.assets.length,
      totalByteSize: variant.assets.reduce((total, asset) => total + asset.byteSize, 0),
      maximumTextureCount: variant.census.maximumTextureCount,
    })),
    textureCatalog: proceduralTextureProvenance(),
    probeDirectory: LOWER_MANHATTAN_PROBE_ROOT,
  };
  summary.texturedByteIncreaseRatio = summary.variants[1].totalByteSize / summary.variants[0].totalByteSize;
  await writeReceipt("probe", fingerprint, summary);
  return { skipped: false, ...summary };
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
        const built = buildMidtownCoreV3Plan(source, EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256, LOWER_MANHATTAN_CENSUS_PROFILE);
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
  if (summary.ownedBuildingCount !== LOWER_MANHATTAN_BUILDING_COUNT) fail(`the subset owns ${summary.ownedBuildingCount} buildings, not ${LOWER_MANHATTAN_BUILDING_COUNT}.`);
  if (summary.uniquePlanHashCount !== planned) fail(`plan hashes are not unique: ${summary.uniquePlanHashCount} of ${planned}.`);

  await mkdir(workRoot, { recursive: true });
  await writeFile(join(workRoot, "plan-census.json"), serializeExteriorWaveArtifact({ ...summary, perCell, refusals }), "utf8");
  await writeReceipt("plans", fingerprint, summary);
  return { skipped: false, ...summary };
}

// ---------------------------------------------------------------------------
// Stage: glbs
// ---------------------------------------------------------------------------

function assertOwnedPayloadDirectory(directory) {
  if (basename(directory) !== LOWER_MANHATTAN_RELEASE_ID) fail(`refusing to write ${directory}: only a directory named ${LOWER_MANHATTAN_RELEASE_ID} is writable.`);
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
    profile: LOWER_MANHATTAN_CENSUS_PROFILE,
  });
  const censusMilliseconds = Date.now() - startedAt;

  const cells = context.renderable.cells;
  const shipped = materializeMidtownCoreV3Cells({
    cells,
    sources,
    baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
    capture: context.capture,
    profile: LOWER_MANHATTAN_WAVE_PROFILE,
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

  await mkdir(workRoot, { recursive: true });
  await writeFile(join(workRoot, "asset-census.json"), serializeExteriorWaveArtifact({
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

  const ownership = validateLowerManhattanSubsetLedger(context.subset.ledger);
  if (!ownership.ok) fail(`subset ledger fails the accepted ownership checks: ${stableSerialize(ownership.issues.slice(0, 5))}`);

  const digest = readJsonText(await readVerifiedText(join(ledgerRoot, "membership-digest.json"), "committed membership digest"), "membership digest");
  const reconciliation = reconcileLowerManhattanAgainstDigest(context.subset, digest);
  if (!reconciliation.ok) fail(`digest reconciliation failed: ${stableSerialize(reconciliation.findings.slice(0, 5))}`);

  const glbs = await readReceipt("glbs");
  if (!glbs) fail("the glbs stage has not run, so the wave statement cannot be derived.");

  const summary = {
    ownershipOk: ownership.ok,
    reconciliation: reconciliation.counts,
    reconciliationOk: reconciliation.ok,
    maximumCellBuildings: context.subset.derivation.subset.maxObservedCellBuildings,
    exclusions: context.subset.derivation.exclusions,
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
    waveRefusalRatio: (glbs.summary.wave?.refusedBuildingCount ?? 0) / LOWER_MANHATTAN_BUILDING_COUNT,
  };
  // A first-generation wave owns no predecessor asset, so there is no
  // availability delta to derive; what must hold is that the renderable subset
  // fits the entry budget it was derived from.
  if ((glbs.summary.shippedAssetCount ?? 0) > context.occupancy.entryBudget) {
    fail(`the renderable subset ships ${glbs.summary.shippedAssetCount} assets, above the ${context.occupancy.entryBudget}-entry budget derived from the runtime cache cap.`);
  }
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
  const cells = context.renderable.cells;
  const sources = collectMidtownCoreSources(shards, new Set(cells.flatMap((cell) => cell.buildingIds)));
  const shipped = materializeMidtownCoreV3Cells({
    cells,
    sources,
    baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
    capture: context.capture,
    profile: LOWER_MANHATTAN_WAVE_PROFILE,
  });
  const release = buildMidtownCoreRelease({
    subset: context.subset,
    renderableCellIds: cells.map((cell) => cell.cellId),
    materialized: shipped.buildings,
    refusals: shipped.refusals,
    capture: context.capture,
    profile: lowerManhattanProfile(context.predecessor),
  });

  const payload = new Map([...release.files, ...shipped.assetBytes]);
  const stale = (await existingFiles(payloadRoot)).filter((path) => !payload.has(path));
  for (const path of stale) await rm(join(payloadRoot, path));
  for (const [path, bytes] of [...payload].sort(([left], [right]) => (left < right ? -1 : 1))) {
    const target = join(payloadRoot, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

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
  // The assembly replay is given this release's OWN admission, taken from the
  // emitted public root rather than from a constant, so the replay is gated by
  // exactly what the release declares. Without it the replay correctly refuses
  // the textured assets as a texture-free package, which is the gate working.
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

  const files = [...emitted]
    .map(([path, bytes]) => ({ path, byteSize: bytes.byteLength, checksumSha256: sha256HexBytes(bytes) }))
    .sort((left, right) => (left.path < right.path ? -1 : 1));
  const inventory = {
    schemaVersion: "1.0",
    releaseId: LOWER_MANHATTAN_RELEASE_ID,
    payloadDirectory: LOWER_MANHATTAN_OUTPUT_DIRECTORY,
    note: "The payload directory is intentionally untracked, following the citywide precedent. This inventory is the committed record that keeps every emitted byte checkable after the local tree is removed; `node scripts/lower-manhattan-cli.mjs graph --force` rebuilds it byte-identically.",
    base: { releaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID, manifestChecksumSha256: context.manifestChecksum },
    parentLedger: { releaseId: EXTERIOR_WAVE_LEDGER_RELEASE_ID, checksumSha256: context.parentLedgerChecksumSha256 },
    predecessor: {
      releaseId: context.predecessor.releaseId,
      inventoryChecksumSha256: context.predecessorInventoryChecksumSha256,
      publicRootChecksumSha256: context.predecessor.publicRoot.rootChecksumSha256,
      snapshotChecksumSha256: context.predecessor.snapshot.checksumSha256,
    },
    ownershipLedgerId: context.subset.ledger.ledgerId,
    textureAdmission: { policy: "procedural-replay", ...proceduralTextureProvenance(), samplerFilter: { ...LOWER_MANHATTAN_WAVE_PROFILE.textureFilter } },
    occupancy: context.occupancy,
    renderableCellIds: cells.map((cell) => cell.cellId),
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
    reconciliation: reconcileLowerManhattanAgainstDigest(context.subset, readJsonText(await readVerifiedText(join(ledgerRoot, "membership-digest.json"), "committed membership digest"), "membership digest")),
  });
  const censusChecksum = await writeRecord("wave-census.json", {
    schemaVersion: "1.0",
    releaseId: LOWER_MANHATTAN_RELEASE_ID,
    note: "Wave-scale V3 stop-code census over all 6,425 owned buildings, plus the shipped-subset census over the renderable cells. Committed so the refusal distribution stays checkable without the untracked work root. The wave census is untextured by design; the shipped subset carries procedural-texture-v1 tiles on LOD 0. READ `wave.retention` BEFORE `wave.shippedAssetCount`: the wave pass runs `census-only`, so it generated, gated and measured every asset and then dropped the bytes rather than keeping them. Its `shippedAssetBytes` is therefore a real measurement while its `shippedAssetCount` is zero, which is a retention mode and not a contradiction. The `shipped` object below is the pass that retained bytes.",
    textureCatalog: proceduralTextureProvenance(),
    samplerFilter: { ...LOWER_MANHATTAN_WAVE_PROFILE.textureFilter },
    occupancy: context.occupancy,
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
  // New for the first textured wave: the assets that carry the most distinct
  // motifs are where a UV projection or a tile binding would show a fault.
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
  const existing = await readReceipt("sample");
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
      try { context3 = buildMidtownCoreV3Plan(source, EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256, LOWER_MANHATTAN_WAVE_PROFILE); }
      catch (error) { if (!(error instanceof MidtownCoreV3Stop)) throw error; continue; }
      const written = writeMidtownCoreV3Assets(context3, {
        ownerCellId: cell.cellId,
        capturedAt: context.capture.capturedAt,
        updatedAt: context.capture.updatedAt,
        predecessor: null,
        profile: LOWER_MANHATTAN_WAVE_PROFILE,
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
  if (texturedSampleIds.length < 10) fail(`only ${texturedSampleIds.length} sampled assets carry tiles; the first textured wave must re-import at least 10.`);

  const inputsRoot = join(workRoot, "blender", "inputs");
  await rm(inputsRoot, { recursive: true, force: true });
  await mkdir(inputsRoot, { recursive: true });
  for (const buildingId of sampleIds) {
    const entry = byId.get(buildingId);
    const slug = buildingId.replace(":", "-");
    await writeFile(join(inputsRoot, `${slug}.json`), serializeExteriorWaveArtifact({
      buildingId,
      cellId: entry.cellId,
      stratum: chosen.get(buildingId),
      assetPath: join(payloadRoot, entry.relativeRef),
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
    inputsDirectory: join(LOWER_MANHATTAN_WORK_ROOT, "blender", "inputs"),
  };
  await writeFile(join(workRoot, "blender-sample.json"), serializeExteriorWaveArtifact(summary), "utf8");
  await writeReceipt("sample", fingerprint, summary);
  return { skipped: false, ...summary };
}

// ---------------------------------------------------------------------------

const RUNNERS = { probe: stageProbe, plans: stagePlans, glbs: stageGlbs, gates: stageGates, graph: stageGraph, sample: stageSample };

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
  console.log(JSON.stringify({ ok: true, releaseId: LOWER_MANHATTAN_RELEASE_ID, predecessorReleaseId: LOWER_MANHATTAN_PREDECESSOR_RELEASE_ID, stages: report }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main();
