/* global console, process, TextEncoder */
/**
 * Citywide overview-tier census (Task T001).
 *
 * T001 is this goal's measurement-and-decision task. Its deliverable is an
 * evidence-backed decision (ADR 0040) about how the island can show real
 * building shapes at overview zoom — not a mass build. This CLI produces the
 * measurements that decision rests on, over ALL 45,194 accepted parents of the
 * pinned `manhattan-citywide-20260804` snapshot.
 *
 * CENSUS ONLY. It generates no GLB, materializes no wave, writes nothing under
 * `public/data/`, touches no release, and retains nothing but the committed
 * summary records under `data/citywide-overview-census-20260814/`. It acquires
 * no data: an absent or drifted snapshot is a fail-closed stop with an operator
 * message, never a download.
 *
 * Four resumable stages, receipts fingerprinted on their inputs (the wave-CLI
 * pattern):
 *
 *   gate     the pinned-snapshot availability gate, then per-shard checksum
 *            verification of every building shard before a coordinate is
 *            trusted.
 *   extents  per-cell RENDER extents for all 883 ledger cells — the artifact
 *            the ledger deliberately does not carry (ADR 0024 D6 committed the
 *            overhang aggregates as prose and no code) — and a re-derivation of
 *            ADR 0024's 9,944 / 45,194 / 248.2 m figures as the correctness
 *            check.
 *   plans    every parent through the SAME V3 plan stage the wave CLIs run,
 *            for the ring-vertex-count and effective-tier-count distributions,
 *            reconciled against the six waves' committed refusal counts.
 *   bytes    per-building bytes by wave, read from the waves' own COMMITTED
 *            census records. Nothing is re-generated: those bytes were measured
 *            once by the census-only wave passes and re-measuring them here
 *            would be a weaker claim, not a stronger one.
 *   coarse   the candidate coarse-prism tier, MEASURED rather than modelled:
 *            every planned building's prism is written through the real
 *            canonical GLB writer, its bytes and counts are recorded, and the
 *            bytes are dropped. Also measures each prism's projected-silhouette
 *            deviation from the V3 massing it would replace, which is the
 *            decisive number for whether such a tier can pass the multi-LOD
 *            schema's 2% cap at all.
 *
 * Usage: pnpm citywide-overview:census <gate|extents|plans|bytes|all> [--force]
 */
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexSync, stableSerialize } from "../src/domain/deterministic-hash.ts";
import {
  EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
  EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID,
  EXTERIOR_FULLSNAPSHOT_HEIGHT_RULES,
} from "../src/domain/exterior-fullsnapshot-input.ts";
import { verifyCitywideSnapshot } from "../src/release/citywide-snapshot-gate.ts";
import {
  CITYWIDE_OVERHANG_METRIC,
  CITYWIDE_OVERVIEW_CENSUS_SCHEMA_VERSION,
  aggregateCellExtents,
  deriveCellExtent,
  integerHistogram,
  openRing,
} from "../src/release/citywide-overview-census.ts";
import {
  EXTERIOR_WAVE_BASE_BUILDING_COUNT,
  EXTERIOR_WAVE_LEDGER_RELEASE_ID,
  exteriorArtifactChecksum,
  validateExteriorWaveLedger,
} from "../src/release/exterior-wave-ledger.ts";
import { MidtownCoreV3Stop, buildMidtownCoreV3Plan } from "../src/release/midtown-core-v3-materialization.ts";
import { writeCanonicalGlb } from "../src/release/canonical-glb.ts";
import { CITYWIDE_BUDGETS } from "../src/release/citywide-release.ts";
import { EXTERIOR_RUNTIME_BUDGETS } from "../src/runtime/exterior-cell-runtime.ts";
import { MULTI_LOD_ASSEMBLY_LIMITS } from "../src/release/multi-lod-assembly.ts";
import {
  CITYWIDE_OVERVIEW_SILHOUETTE_METRIC,
  cellSkylineDeviation,
  coarsePrismGeometry,
  checkCandidateBudgets,
  costCandidate,
  prismSilhouetteDeviation,
  screenSpaceErrorPixels,
} from "../src/release/citywide-overview-tier-candidates.ts";
import { isSafeReleaseArtifactReference } from "../src/runtime/path-security.ts";

const CENSUS_ID = "citywide-overview-census-20260814";
const STAGES = ["gate", "extents", "plans", "bytes", "coarse", "sample", "decide"];

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotRoot = join(repositoryRoot, "public", "data", EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID);
const ledgerRoot = join(repositoryRoot, "data", "normalized", EXTERIOR_WAVE_LEDGER_RELEASE_ID);
const recordRoot = join(repositoryRoot, "data", CENSUS_ID);
const workRoot = join(repositoryRoot, "artifacts", CENSUS_ID);

/**
 * The six waves' COMMITTED census records, in ledger wave order.
 *
 * `censusFile` is null for wave w00: Block 835 is 14 buildings whose bytes are
 * git-tracked, so they are measured from the shipped files themselves rather
 * than from a wave-scale census that was never run for it.
 */
const WAVE_RECORDS = [
  { waveIndex: 0, waveId: "block-835", releaseId: "manhattan-exterior-cells-20260811-v3", censusFile: null, assetDirectory: "public/data/manhattan-exterior-cells-20260811-v3/public/assets", textured: true },
  { waveIndex: 1, waveId: "midtown-core", releaseId: "manhattan-midtown-core-cells-20260811-v3", censusFile: "data/midtown-core-20260811-v3/v3-census.json", assetDirectory: null, textured: false },
  { waveIndex: 2, waveId: "lower-manhattan", releaseId: "manhattan-lower-manhattan-cells-20260812-p1", censusFile: "data/lower-manhattan-20260812-p1/wave-census.json", assetDirectory: null, textured: false },
  { waveIndex: 3, waveId: "southern-remainder", releaseId: "manhattan-southern-remainder-cells-20260812-p1", censusFile: "data/southern-remainder-20260812-p1/wave-census.json", assetDirectory: null, textured: false },
  { waveIndex: 4, waveId: "central-upper-manhattan", releaseId: "manhattan-central-upper-manhattan-cells-20260812-p1", censusFile: "data/central-upper-manhattan-20260812-p1/wave-census.json", assetDirectory: null, textured: false },
  { waveIndex: 5, waveId: "northern-manhattan", releaseId: "manhattan-northern-manhattan-cells-20260812-p1", censusFile: "data/northern-manhattan-20260812-p1/wave-census.json", assetDirectory: null, textured: false },
];

const argv = process.argv.slice(2);
const stage = argv[0];
const force = argv.includes("--force");
if (!stage || (stage !== "all" && !STAGES.includes(stage))) {
  console.error(`Usage: pnpm citywide-overview:census <${[...STAGES, "all"].join("|")}> [--force]`);
  process.exit(2);
}

function fail(message) {
  console.error(`STOP: ${message}`);
  process.exit(1);
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeRecord(name, value) {
  await mkdir(recordRoot, { recursive: true });
  const text = serialize(value);
  await writeFile(join(recordRoot, name), text, "utf8");
  const checksum = sha256HexSync(text);
  await writeFile(join(recordRoot, `${name.replace(/\.json$/u, "")}.sha256`), `${checksum}  ${name}\n`, "utf8");
  return checksum;
}

async function readReceipt(name) {
  try {
    return JSON.parse(await readFile(join(workRoot, "stages", `${name}.json`), "utf8"));
  } catch {
    return null;
  }
}

async function writeReceipt(name, fingerprint, summary) {
  await mkdir(join(workRoot, "stages"), { recursive: true });
  await writeFile(
    join(workRoot, "stages", `${name}.json`),
    serialize({ schemaVersion: "1.0", stage: name, censusId: CENSUS_ID, inputFingerprint: fingerprint, summary }),
    "utf8",
  );
}

// ---------------------------------------------------------------------------
// Stage: gate
// ---------------------------------------------------------------------------

async function loadGate() {
  const present = existsSync(snapshotRoot) && statSync(snapshotRoot).isDirectory();
  const result = verifyCitywideSnapshot({
    snapshotRoot,
    snapshotRootPresent: present,
    manifestText: present ? await readFile(join(snapshotRoot, "manifest.json"), "utf8").catch(() => null) : null,
    recordedChecksumText: present ? await readFile(join(snapshotRoot, "manifest.sha256"), "utf8").catch(() => null) : null,
    buildingShardFileCount: present
      ? await readdir(join(snapshotRoot, "geometry", "buildings")).then((names) => names.filter((name) => name.endsWith(".json")).length).catch(() => null)
      : null,
  });
  if (!result.ok) fail(`${result.message}\n\nThe census cannot run against an unverified base. Nothing was written.`);
  return result;
}

/**
 * Read every declared building shard and verify it against its declared byte
 * size and checksum before a single coordinate is trusted. An unverified read
 * would let local corruption become a "deterministic" citywide measurement.
 */
async function readVerifiedSources(manifest) {
  const declared = manifest.geometryShards.filter((shard) => shard.layer === "buildings");
  const encoder = new TextEncoder();
  const sources = new Map();
  let byteMismatch = 0;
  let checksumMismatch = 0;
  let unsafeRef = 0;
  for (const shard of declared) {
    if (!isSafeReleaseArtifactReference(shard.relativeContentRef)) { unsafeRef += 1; continue; }
    const text = await readFile(join(snapshotRoot, shard.relativeContentRef), "utf8");
    if (encoder.encode(text).byteLength !== shard.byteSize) byteMismatch += 1;
    if (sha256HexSync(text) !== shard.checksumSha256) checksumMismatch += 1;
    for (const feature of JSON.parse(text).features) {
      if (feature.geometry?.type !== "Polygon") continue;
      sources.set(feature.parentId, {
        buildingId: feature.parentId,
        representative: feature.coordinates,
        outerRing: feature.geometry.coordinates[0],
        holeRings: feature.geometry.coordinates.slice(1),
        heightMeters: feature.heightMeters,
        heightUnknown: feature.heightUnknown === true,
        sourceRefId: feature.sourceRefIds[0],
      });
    }
  }
  if (unsafeRef > 0) fail(`${unsafeRef} declared shard references are not canonical safe relative paths.`);
  if (byteMismatch > 0) fail(`${byteMismatch} building shards do not match their declared byte size.`);
  if (checksumMismatch > 0) fail(`${checksumMismatch} building shards do not match their declared SHA-256 checksum.`);
  if (sources.size !== EXTERIOR_WAVE_BASE_BUILDING_COUNT) {
    fail(`Verified shards yielded ${sources.size} unique building parents, expected ${EXTERIOR_WAVE_BASE_BUILDING_COUNT}.`);
  }
  return { sources, declaredShardCount: declared.length };
}

async function loadLedger() {
  const text = await readFile(join(ledgerRoot, "ledger.json"), "utf8");
  const ledger = JSON.parse(text);
  const checksum = exteriorArtifactChecksum(ledger);
  const recorded = (await readFile(join(ledgerRoot, "ledger.sha256"), "utf8")).trim().split(/\s+/u)[0];
  if (recorded !== checksum) fail(`Committed ledger checksum ${checksum} does not match its recorded ${recorded}.`);
  const validation = validateExteriorWaveLedger(ledger);
  if (!validation.ok) fail(`Committed ledger fails its own schema: ${JSON.stringify(validation.issues.slice(0, 3))}`);
  return { ledger, ledgerChecksumSha256: checksum };
}

async function loadContext() {
  const gate = await loadGate();
  const manifest = JSON.parse(await readFile(join(snapshotRoot, "manifest.json"), "utf8"));
  const { sources, declaredShardCount } = await readVerifiedSources(manifest);
  const { ledger, ledgerChecksumSha256 } = await loadLedger();
  const cells = [...ledger.cells].sort((left, right) => left.order - right.order);
  return { gate, manifest, sources, declaredShardCount, ledger, ledgerChecksumSha256, cells };
}

function fingerprint(context, name) {
  return sha256HexSync(stableSerialize({
    stage: name,
    censusId: CENSUS_ID,
    baseManifestChecksumSha256: context.gate.observedManifestChecksumSha256,
    ledgerChecksumSha256: context.ledgerChecksumSha256,
    schemaVersion: CITYWIDE_OVERVIEW_CENSUS_SCHEMA_VERSION,
  }));
}

const base = (context) => ({
  releaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID,
  manifestChecksumSha256: context.gate.observedManifestChecksumSha256,
});
const ledgerPin = (context) => ({
  releaseId: EXTERIOR_WAVE_LEDGER_RELEASE_ID,
  ledgerId: context.ledger.ledgerId,
  checksumSha256: context.ledgerChecksumSha256,
});

// ---------------------------------------------------------------------------
// Stage: extents
// ---------------------------------------------------------------------------

const ADR_0024_CLAIM = { overhangBuildingCount: 9944, buildingCount: 45194, maxOverhangMeters: 248.2, maxOverhangBuildingId: "doitt:308707" };

async function stageExtents(context) {
  const name = "extents";
  const print = fingerprint(context, name);
  const existing = await readReceipt(name);
  if (existing && existing.inputFingerprint === print && !force) return { skipped: true, ...existing.summary };

  const rows = context.cells.map((cell) => deriveCellExtent({
    cellId: cell.cellId,
    order: cell.order,
    assignmentBounds: cell.bounds,
    buildings: cell.buildingIds.map((buildingId) => {
      const source = context.sources.get(buildingId);
      if (!source) fail(`Ledger member ${buildingId} is absent from the verified shard grouping.`);
      return { buildingId, outerRing: source.outerRing, heightMeters: source.heightMeters, heightUnknown: source.heightUnknown };
    }),
    unknownHeightSubstituteMeters: EXTERIOR_FULLSNAPSHOT_HEIGHT_RULES.unknownHeightFallbackMm / 1_000,
  }));
  const aggregates = aggregateCellExtents(rows);

  // ADR 0024 D6 reported these figures and committed NO code for them. This is
  // the re-derivation, reported as agreement or disagreement rather than
  // asserted. A disagreement is a finding to record, not a reason to adjust the
  // metric until it matches.
  const reDerivation = {
    claim: ADR_0024_CLAIM,
    metric: CITYWIDE_OVERHANG_METRIC,
    observed: {
      overhangBuildingCount: aggregates.overhangBuildingCount,
      buildingCount: aggregates.buildingCount,
      maxOverhangMeters: Math.round(aggregates.maxOverhangMeters * 10) / 10,
      maxOverhangMetersExact: aggregates.maxOverhangMeters,
      maxOverhangBuildingId: aggregates.maxOverhangBuildingId,
      maxOverhangCellId: aggregates.maxOverhangCellId,
    },
    agrees: {
      overhangBuildingCount: aggregates.overhangBuildingCount === ADR_0024_CLAIM.overhangBuildingCount,
      buildingCount: aggregates.buildingCount === ADR_0024_CLAIM.buildingCount,
      maxOverhangMeters: Math.abs(aggregates.maxOverhangMeters - ADR_0024_CLAIM.maxOverhangMeters) < 0.05,
      maxOverhangBuildingId: aggregates.maxOverhangBuildingId === ADR_0024_CLAIM.maxOverhangBuildingId,
    },
  };

  const extentSpans = rows.map((row) => ({
    cellId: row.cellId,
    assignmentLongitudeSpan: row.assignmentBounds.east - row.assignmentBounds.west,
    renderLongitudeSpan: row.renderBounds.east - row.renderBounds.west,
    assignmentLatitudeSpan: row.assignmentBounds.north - row.assignmentBounds.south,
    renderLatitudeSpan: row.renderBounds.north - row.renderBounds.south,
  }));
  const areaRatios = extentSpans
    .map((span) => (span.renderLongitudeSpan * span.renderLatitudeSpan) / (span.assignmentLongitudeSpan * span.assignmentLatitudeSpan))
    .sort((left, right) => left - right);

  const artifact = {
    schemaVersion: CITYWIDE_OVERVIEW_CENSUS_SCHEMA_VERSION,
    censusId: CENSUS_ID,
    taskId: "T001",
    artifact: "per-cell-render-extents",
    note: "One row per committed ledger cell. `assignmentBounds` is the ledger's own rectangle, which decides MEMBERSHIP by representative point and is not a containment or cull rectangle (ADR 0024 D6). `renderBounds` is the union of that rectangle with every member's outer-ring vertices and IS a safe cull rectangle for this membership. `maxTopMeters` is the tallest member top; when `maxTopSource` is `substituted` the tallest member carries no sourced height and the value is the stated 10.5 m substitute, not a measurement. Nothing here is a claim about any real building's name, use or appearance.",
    base: base(context),
    ledger: ledgerPin(context),
    overhangMetric: CITYWIDE_OVERHANG_METRIC,
    unknownHeightSubstituteMeters: EXTERIOR_FULLSNAPSHOT_HEIGHT_RULES.unknownHeightFallbackMm / 1_000,
    aggregates,
    adr0024ReDerivation: reDerivation,
    renderExtentInflation: {
      note: "Render-extent area divided by assignment-rectangle area, per cell. A scheduler that culls on assignment bounds drops geometry in every cell whose ratio exceeds 1.",
      cellsAboveOne: areaRatios.filter((ratio) => ratio > 1).length,
      median: Math.round(areaRatios[Math.floor((areaRatios.length - 1) / 2)] * 1e6) / 1e6,
      p95: Math.round(areaRatios[Math.min(areaRatios.length - 1, Math.ceil(0.95 * areaRatios.length) - 1)] * 1e6) / 1e6,
      max: Math.round(areaRatios[areaRatios.length - 1] * 1e6) / 1e6,
    },
    cells: rows,
  };
  const checksum = await writeRecord("cell-extents.json", artifact);
  const summary = {
    cellCount: rows.length,
    buildingCount: aggregates.buildingCount,
    overhangBuildingCount: aggregates.overhangBuildingCount,
    maxOverhangMeters: aggregates.maxOverhangMeters,
    maxOverhangBuildingId: aggregates.maxOverhangBuildingId,
    adr0024Agreement: reDerivation.agrees,
    checksumSha256: checksum,
  };
  await writeReceipt(name, print, summary);
  return summary;
}

// ---------------------------------------------------------------------------
// Stage: plans
// ---------------------------------------------------------------------------

/**
 * Wave index from the cell id. The ledger encodes it in the `-wNN-` segment and
 * the whole ordering guarantee rests on that encoding (ADR 0024 D5), so reading
 * it back is safe and a cell id that does not carry one is a stop.
 */
function waveIndexOf(cellId) {
  const match = /-w(\d{2})-/u.exec(cellId);
  if (!match) fail(`Cell id ${cellId} does not encode a wave index.`);
  return Number(match[1]);
}

async function stagePlans(context) {
  const name = "plans";
  const print = fingerprint(context, name);
  const existing = await readReceipt(name);
  if (existing && existing.inputFingerprint === print && !force) return { skipped: true, ...existing.summary };

  const startedAt = Date.now();
  const sourceRingVertexCounts = [];
  const plannedRingVertexCounts = [];
  const tierCounts = [];
  const floorCounts = [];
  const refusalsByCode = {};
  const refusalsByWave = {};
  const plannedByWave = {};
  const singleTierByWave = {};
  const ownedByWave = {};
  let planned = 0;
  let refused = 0;
  let peakRssBytes = 0;

  for (const cell of context.cells) {
    const waveIndex = waveIndexOf(cell.cellId);
    ownedByWave[waveIndex] = (ownedByWave[waveIndex] ?? 0) + cell.buildingIds.length;
    for (const buildingId of cell.buildingIds) {
      const source = context.sources.get(buildingId);
      if (!source) fail(`Ledger member ${buildingId} is absent from the verified shard grouping.`);
      sourceRingVertexCounts.push(openRing(source.outerRing).length);
      try {
        const built = buildMidtownCoreV3Plan(source, EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256);
        plannedRingVertexCounts.push(built.ringMm.length);
        tierCounts.push(built.plan.massing.effectiveTierCount);
        if (built.plan.massing.effectiveTierCount <= 1) singleTierByWave[waveIndex] = (singleTierByWave[waveIndex] ?? 0) + 1;
        floorCounts.push(built.plan.massing.floorCount);
        planned += 1;
        plannedByWave[waveIndex] = (plannedByWave[waveIndex] ?? 0) + 1;
      } catch (error) {
        if (!(error instanceof MidtownCoreV3Stop)) throw error;
        refused += 1;
        refusalsByCode[error.code] = (refusalsByCode[error.code] ?? 0) + 1;
        refusalsByWave[waveIndex] = (refusalsByWave[waveIndex] ?? 0) + 1;
      }
    }
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }

  // Reconcile against the waves' OWN committed plan-stage refusal counts. The
  // wave censuses ran each wave's census profile; this pass runs one profile for
  // all six. Exact agreement is therefore also the evidence that plan-stage
  // refusal is a function of the sourced polygon alone and not of the wave's
  // seed — which is the claim the tier distribution below depends on.
  const waveReconciliation = [];
  for (const record of WAVE_RECORDS) {
    if (!record.censusFile) {
      waveReconciliation.push({
        waveIndex: record.waveIndex, waveId: record.waveId, releaseId: record.releaseId,
        committedRefusedBuildingCount: null, observedRefusedBuildingCount: refusalsByWave[record.waveIndex] ?? 0,
        agrees: null,
        note: "Wave w00 (Block 835) shipped through the reference/authoring path and committed no wave-scale plan census, so there is nothing to reconcile against.",
      });
      continue;
    }
    const committed = JSON.parse(await readFile(join(repositoryRoot, record.censusFile), "utf8"));
    const wave = committed.wave ?? committed;
    // TWO refusal distributions are committed per wave and they are not the same
    // set. `waveRefusals` is the PLAN stage — the grammar reading a sourced
    // polygon. `wave.refusalsByCode` is the ASSET stage, which is the plan stage
    // PLUS the writer's mesh-versus-analytic volume identity, a check that can
    // only fire after a plan has been accepted. This census runs the plan stage,
    // so `waveRefusals` is the comparable record; comparing against the asset
    // total would manufacture a disagreement out of a stage boundary.
    const committedPlanRefusals = Object.values(committed.waveRefusals ?? {}).reduce((total, count) => total + count, 0);
    const committedAssetRefused = wave.refusedBuildingCount;
    const committedVolumeIdentityFailed = wave.refusalsByCode?.["volume-identity-failed"] ?? committed.volumeIdentity?.buildingsRejected ?? 0;
    const observed = refusalsByWave[record.waveIndex] ?? 0;
    const ownedAgrees = wave.requestedBuildingCount === (ownedByWave[record.waveIndex] ?? 0);
    const planAgrees = committedPlanRefusals === observed;
    const stageBoundaryAccounted = committedAssetRefused === observed + committedVolumeIdentityFailed;
    waveReconciliation.push({
      waveIndex: record.waveIndex, waveId: record.waveId, releaseId: record.releaseId,
      committedOwnedBuildingCount: wave.requestedBuildingCount,
      observedOwnedBuildingCount: ownedByWave[record.waveIndex] ?? 0,
      committedPlanStageRefusedBuildingCount: committedPlanRefusals,
      observedPlanStageRefusedBuildingCount: observed,
      committedAssetStageRefusedBuildingCount: committedAssetRefused,
      committedVolumeIdentityFailedCount: committedVolumeIdentityFailed,
      committedMaterializedBuildingCount: wave.materializedBuildingCount,
      observedPlannedBuildingCount: plannedByWave[record.waveIndex] ?? 0,
      committedTierCollapseAbsentSetbackCount: wave.tierCollapseAbsentSetbackCount,
      observedSingleTierCount: singleTierByWave[record.waveIndex] ?? 0,
      agrees: ownedAgrees && planAgrees && stageBoundaryAccounted,
      note: ownedAgrees && planAgrees && stageBoundaryAccounted
        ? "Ownership, plan-stage refusals and the plan/asset stage boundary all reconcile exactly."
        : "DIFFERS — record this rather than adjusting the census until it matches.",
    });
  }

  const artifact = {
    schemaVersion: CITYWIDE_OVERVIEW_CENSUS_SCHEMA_VERSION,
    censusId: CENSUS_ID,
    taskId: "T001",
    artifact: "citywide-plan-stage-distributions",
    note: "Distributions over every accepted parent of the pinned base, produced by a CENSUS-ONLY pass through the same V3 plan stage the wave CLIs run. No geometry was retained: the pass generated plans, counted, and dropped them. `sourceOuterRingVertexCount` counts DISTINCT outer-ring vertices (the closing duplicate is dropped, as the grammar drops it). `effectiveTierCount` is the massing the grammar actually produced, which is 1 whenever a setback was refused rather than repaired — so the tier distribution is a distribution of REALISED massing, not of requested massing.",
    base: base(context),
    ledger: ledgerPin(context),
    counts: {
      enumerated: sourceRingVertexCounts.length,
      planned,
      refused,
      plannedPlusRefused: planned + refused,
      block835Materialized: 14,
      materializedIslandTotal: planned - refused === 0 ? planned : planned,
    },
    sourceOuterRingVertexCount: {
      note: "Over all enumerated parents, including the ones the grammar later refuses. This is the input distribution a coarse-prism tier would have to carry.",
      histogram: integerHistogram(sourceRingVertexCounts),
    },
    plannedOuterRingVertexCount: {
      note: "Over planned buildings only. Differs from the source distribution exactly by the refused set, which includes every ring above the grammar's 64-vertex cap.",
      histogram: integerHistogram(plannedRingVertexCounts),
    },
    effectiveTierCount: {
      note: "1 means the grammar refused a setback for this lot and produced a single tier. A coarse tier that collapses massing to one prism loses NOTHING for these buildings and loses the setback steps for the rest.",
      histogram: integerHistogram(tierCounts),
      singleTierCount: tierCounts.filter((value) => value === 1).length,
      singleTierShare: Math.round((tierCounts.filter((value) => value === 1).length / tierCounts.length) * 1e6) / 1e6,
    },
    floorCount: { histogram: integerHistogram(floorCounts) },
    refusals: { byCode: refusalsByCode, total: refused },
    waveReconciliation,
    retention: "census-only",
    hostObservationsLocation: "artifacts/citywide-overview-census-20260814/stages/plans.json and docs/implementation/20260814-citywide-overview-tier-decision.md — wall clock and RSS are host facts, so they are deliberately kept OUT of this artifact's deterministic body (the ADR 0025 D8 precedent). Every field above is a function of the pinned snapshot, the committed ledger and this repository's code, so a replay rewrites byte-identical content and the recorded checksum stays valid.",
  };
  const checksum = await writeRecord("distributions.json", artifact);
  const summary = {
    enumerated: sourceRingVertexCounts.length,
    planned,
    refused,
    singleTierShare: artifact.effectiveTierCount.singleTierShare,
    wallClockSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
    peakRssMebibytes: Math.round(peakRssBytes / 1048576),
    checksumSha256: checksum,
  };
  await writeReceipt(name, print, summary);
  return summary;
}

// ---------------------------------------------------------------------------
// Stage: bytes
// ---------------------------------------------------------------------------

async function stageBytes(context) {
  const name = "bytes";
  const print = fingerprint(context, name);
  const existing = await readReceipt(name);
  if (existing && existing.inputFingerprint === print && !force) return { skipped: true, ...existing.summary };

  const waves = [];
  for (const record of WAVE_RECORDS) {
    if (record.assetDirectory) {
      const directory = join(repositoryRoot, record.assetDirectory);
      const files = (await readdir(directory)).filter((file) => file.endsWith(".glb")).sort();
      let lod0Bytes = 0; let lod1Bytes = 0; let lod0Count = 0; let lod1Count = 0;
      for (const file of files) {
        const bytes = statSync(join(directory, file)).size;
        if (file.includes("__lod_0")) { lod0Bytes += bytes; lod0Count += 1; } else { lod1Bytes += bytes; lod1Count += 1; }
      }
      waves.push({
        waveIndex: record.waveIndex, waveId: record.waveId, releaseId: record.releaseId,
        source: `measured from the git-tracked shipped GLBs under ${record.assetDirectory}`,
        materializedBuildingCount: lod0Count,
        lod0TotalBytes: lod0Bytes, lod1TotalBytes: lod1Bytes,
        lod0BytesPerBuilding: Math.round(lod0Bytes / lod0Count), lod1BytesPerBuilding: Math.round(lod1Bytes / lod1Count),
        bothLodBytesPerBuilding: Math.round((lod0Bytes + lod1Bytes) / lod0Count),
        textured: record.textured,
        note: "Wave w00's shipped LOD 0 carries procedural detail tiles AND reference-authored massing, so its bytes per building are not comparable with the five generated waves and are excluded from the island geometry means below.",
      });
      continue;
    }
    const committed = JSON.parse(await readFile(join(repositoryRoot, record.censusFile), "utf8"));
    const wave = committed.wave ?? committed;
    // The wave census pass generated BOTH LODs untextured and measured them.
    // `generatedAssetBytes` is both LODs; `shippedAssetBytes` is the shipped LOD
    // (lod_0) of the same untextured pass. The difference is therefore lod_1.
    const lod0Bytes = wave.shippedAssetBytes;
    const lod1Bytes = wave.generatedAssetBytes - wave.shippedAssetBytes;
    waves.push({
      waveIndex: record.waveIndex, waveId: record.waveId, releaseId: record.releaseId,
      source: `committed census record ${record.censusFile} (retention: ${wave.retention ?? "census-only"})`,
      materializedBuildingCount: wave.materializedBuildingCount,
      refusedBuildingCount: wave.refusedBuildingCount,
      generatedAssetCount: wave.generatedAssetCount,
      lod0TotalBytes: lod0Bytes,
      lod1TotalBytes: lod1Bytes,
      lod0BytesPerBuilding: Math.round(lod0Bytes / wave.materializedBuildingCount),
      lod1BytesPerBuilding: Math.round(lod1Bytes / wave.materializedBuildingCount),
      bothLodBytesPerBuilding: Math.round(wave.generatedAssetBytes / wave.materializedBuildingCount),
      totalShippedTriangleCount: wave.totalShippedTriangleCount,
      trianglesPerBuilding: Math.round(wave.totalShippedTriangleCount / wave.materializedBuildingCount),
      maximumTriangleCount: wave.maximumTriangleCount,
      tierCollapseAbsentSetbackCount: wave.tierCollapseAbsentSetbackCount,
      textured: record.textured,
      note: "The wave census pass is UNTEXTURED by design. These are geometry bytes; the promoted subset's shipped LOD 0 additionally carries procedural-texture-v1 tiles and is heavier.",
    });
  }

  const generated = waves.filter((wave) => wave.waveIndex !== 0);
  const generatedBuildings = generated.reduce((total, wave) => total + wave.materializedBuildingCount, 0);
  const generatedLod0 = generated.reduce((total, wave) => total + wave.lod0TotalBytes, 0);
  const generatedLod1 = generated.reduce((total, wave) => total + wave.lod1TotalBytes, 0);
  const generatedTriangles = generated.reduce((total, wave) => total + (wave.totalShippedTriangleCount ?? 0), 0);

  const artifact = {
    schemaVersion: CITYWIDE_OVERVIEW_CENSUS_SCHEMA_VERSION,
    censusId: CENSUS_ID,
    taskId: "T001",
    artifact: "per-building-bytes-by-wave",
    note: "READ THIS BEFORE THE NUMBERS. Nothing here was re-generated. Each wave's bytes are its OWN committed measurement from the census-only pass that already generated, gated and measured every asset and then dropped the bytes. Re-measuring them here would be a weaker claim than quoting the record that was gated. `lod1TotalBytes` is derived as generated-minus-shipped of the same untextured pass and is therefore a measurement, not a model.",
    base: base(context),
    ledger: ledgerPin(context),
    waves,
    islandGeneratedWaves: {
      note: "Waves w01-w05 only. Wave w00 is excluded because its 14 buildings are reference-authored and textured; including them would move the island mean by an amount that describes 0.03% of the city.",
      waveCount: generated.length,
      materializedBuildingCount: generatedBuildings,
      lod0TotalBytes: generatedLod0,
      lod1TotalBytes: generatedLod1,
      bothLodTotalBytes: generatedLod0 + generatedLod1,
      lod0MeanBytesPerBuilding: Math.round(generatedLod0 / generatedBuildings),
      lod1MeanBytesPerBuilding: Math.round(generatedLod1 / generatedBuildings),
      lod1AsShareOfLod0: Math.round((generatedLod1 / generatedLod0) * 1e6) / 1e6,
      totalShippedTriangleCount: generatedTriangles,
      meanTrianglesPerBuilding: Math.round(generatedTriangles / generatedBuildings),
    },
    islandMaterializedBuildingCount: generatedBuildings + 14,
  };
  const checksum = await writeRecord("wave-bytes.json", artifact);
  const summary = {
    islandMaterializedBuildingCount: artifact.islandMaterializedBuildingCount,
    lod0TotalBytes: generatedLod0,
    lod1TotalBytes: generatedLod1,
    lod0MeanBytesPerBuilding: artifact.islandGeneratedWaves.lod0MeanBytesPerBuilding,
    lod1MeanBytesPerBuilding: artifact.islandGeneratedWaves.lod1MeanBytesPerBuilding,
    checksumSha256: checksum,
  };
  await writeReceipt(name, print, summary);
  return summary;
}

// ---------------------------------------------------------------------------
// Stage: coarse
// ---------------------------------------------------------------------------

/** The single grey material a coarse overview prism carries. Colour is designed, not observed. */
const COARSE_MATERIAL = { baseColorFactor: [0.6, 0.58, 0.54, 1], metallicFactor: 0, roughnessFactor: 0.9 };

/** Build the coarse prism's quads and cap triangles from a V3 plan's base tier. */
function coarsePrismPrimitives(plan) {
  const ring = plan.tiers[0].ring;
  const topZMm = Math.max(...plan.tiers.map((tier) => tier.topZMm));
  const baseZMm = Math.min(...plan.tiers.map((tier) => tier.baseZMm));
  const quads = [];
  for (let index = 0; index < ring.length; index += 1) {
    const [ax, ay] = ring[index];
    const [bx, by] = ring[(index + 1) % ring.length];
    quads.push({ materialIndex: 0, corners: [[ax, baseZMm, ay], [bx, baseZMm, by], [bx, topZMm, by], [ax, topZMm, ay]] });
  }
  // Roof only: a floor cap is invisible from every camera above grade.
  const triangles = [];
  for (let index = 1; index < ring.length - 1; index += 1) {
    triangles.push({
      materialIndex: 0,
      a: [ring[0][0], topZMm, ring[0][1]],
      b: [ring[index][0], topZMm, ring[index][1]],
      c: [ring[index + 1][0], topZMm, ring[index + 1][1]],
    });
  }
  return { quads, triangles };
}

async function stageCoarse(context) {
  const name = "coarse";
  const print = fingerprint(context, name);
  const existing = await readReceipt(name);
  if (existing && existing.inputFingerprint === print && !force) return { skipped: true, ...existing.summary };

  const startedAt = Date.now();
  let peakRssBytes = 0;
  let measured = 0;
  let perBuildingBytesTotal = 0;
  let maxPerBuildingBytes = 0;
  let totalTriangles = 0;
  let totalVertices = 0;
  const perBuildingBytes = [];
  const deviationRatios = [];
  const horizontalErrors = [];
  let withinSchemaCap = 0;
  const perCell = new Map();

  for (const cell of context.cells) {
    let cellQuadCount = 0;
    let cellTriangleCount = 0;
    let cellBuildings = 0;
    let cellPerBuildingBytes = 0;
    for (const buildingId of cell.buildingIds) {
      const source = context.sources.get(buildingId);
      let built;
      try {
        built = buildMidtownCoreV3Plan(source, EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256);
      } catch (error) {
        if (!(error instanceof MidtownCoreV3Stop)) throw error;
        continue; // Refused by the grammar; a coarse tier ships nothing for it either.
      }
      const { quads, triangles } = coarsePrismPrimitives(built.plan);
      // MEASURED through the real writer, not modelled. Bytes are counted and dropped.
      const written = writeCanonicalGlb({
        quads,
        triangles,
        materials: [COARSE_MATERIAL],
        metadata: {
          canonicalFeatureId: buildingId,
          lodId: "lod_2",
          ownerCellId: cell.cellId,
          planHashSha256: built.plan.planHashSha256,
          uncertainty: "Coarse overview massing: the sourced footprint extruded to the sourced height. Setback steps, openings, attached elements, colour and material are absent by construction and assert nothing about the real building.",
        },
      });
      const geometry = coarsePrismGeometry(built.plan.tiers[0].ring.length);
      const deviation = prismSilhouetteDeviation(built.plan);

      measured += 1;
      perBuildingBytesTotal += written.bytes.byteLength;
      perBuildingBytes.push(written.bytes.byteLength);
      if (written.bytes.byteLength > maxPerBuildingBytes) maxPerBuildingBytes = written.bytes.byteLength;
      totalTriangles += geometry.totalTriangleCount;
      totalVertices += geometry.vertexCount;
      deviationRatios.push(deviation.deviationRatio);
      horizontalErrors.push(deviation.maxHorizontalErrorMeters);
      if (deviation.deviationRatio <= 0.02) withinSchemaCap += 1;

      cellQuadCount += geometry.quadCount;
      cellTriangleCount += geometry.triangleCount;
      cellBuildings += 1;
      cellPerBuildingBytes += written.bytes.byteLength;
    }
    perCell.set(cell.cellId, { cellId: cell.cellId, buildings: cellBuildings, quads: cellQuadCount, triangles: cellTriangleCount, perBuildingBytes: cellPerBuildingBytes });
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }

  // Candidate (a): ONE aggregated GLB per cell. Its buffer content is the same
  // geometry; what it saves is the per-file container and metadata paid 44,295
  // times instead of 883. The saving is measured, not assumed, by writing one
  // real aggregated artifact for the largest cell and one for the median cell.
  const cellRows = [...perCell.values()];
  const byBuildings = [...cellRows].sort((left, right) => left.buildings - right.buildings);
  const aggregateSamples = [];
  for (const [label, row] of [["largest", byBuildings[byBuildings.length - 1]], ["median", byBuildings[Math.floor((byBuildings.length - 1) / 2)]]]) {
    const cell = context.cells.find((candidate) => candidate.cellId === row.cellId);
    const quads = [];
    const triangles = [];
    for (const buildingId of cell.buildingIds) {
      let built;
      try { built = buildMidtownCoreV3Plan(context.sources.get(buildingId), EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256); } catch { continue; }
      const primitives = coarsePrismPrimitives(built.plan);
      quads.push(...primitives.quads);
      triangles.push(...primitives.triangles);
    }
    const written = writeCanonicalGlb({
      quads, triangles, materials: [COARSE_MATERIAL],
      metadata: { canonicalFeatureId: row.cellId, lodId: "lod_2", ownerCellId: row.cellId, buildingCount: row.buildings, uncertainty: "Aggregated coarse overview massing for one ledger cell." },
    });
    aggregateSamples.push({
      label, cellId: row.cellId, buildingCount: row.buildings,
      aggregatedBytes: written.bytes.byteLength,
      perBuildingBytesForSameCell: row.perBuildingBytes,
      containerOverheadSavedBytes: row.perBuildingBytes - written.bytes.byteLength,
      containerOverheadSavedShare: Math.round(((row.perBuildingBytes - written.bytes.byteLength) / row.perBuildingBytes) * 1e6) / 1e6,
      aggregatedBytesPerBuilding: Math.round(written.bytes.byteLength / row.buildings),
      triangleCount: written.counts.triangleCount,
    });
  }
  const overheadShare = aggregateSamples.reduce((total, sample) => total + sample.containerOverheadSavedShare, 0) / aggregateSamples.length;

  const sortedBytes = [...perBuildingBytes].sort((left, right) => left - right);
  const sortedDeviations = [...deviationRatios].sort((left, right) => left - right);
  const sortedErrors = [...horizontalErrors].sort((left, right) => left - right);
  const at = (values, fraction) => values[Math.min(values.length - 1, Math.max(0, Math.ceil(fraction * values.length) - 1))];

  const artifact = {
    schemaVersion: CITYWIDE_OVERVIEW_CENSUS_SCHEMA_VERSION,
    censusId: CENSUS_ID,
    taskId: "T001",
    artifact: "coarse-overview-tier-measurement",
    note: "CENSUS ONLY: every prism below was written through the REAL canonical GLB writer and its bytes were then dropped. No artifact was retained, no release was assembled and nothing was published. `deviationRatio` is this task's own analytic projected-silhouette measurement of the prism against the V3 massing it would replace (metric `prism-vs-tiered-orthographic-staircase-v1`, eight horizontal azimuths); it is NOT the schema's `authoring-declared` silhouette field and must not be copied into one. Schema compliance is also not visual acceptance: a shape can sit inside a 2% area ratio and still read wrongly on screen.",
    base: base(context),
    ledger: ledgerPin(context),
    coarseProfile: {
      representation: "sourced outer ring extruded from grade to the sourced top; roof cap only, no floor cap; one designed grey material; texture-free",
      capsEmitted: "roof",
      floorCapOmittedNote: "A floor cap is invisible from every camera above grade and would cost n-2 triangles per building, roughly 500,000 island-wide. It is omitted deliberately, which also means the mesh is NOT closed and the analytic volume identity cannot apply to it.",
      materialCount: 1,
      textureCount: 0,
    },
    silhouetteMetric: CITYWIDE_OVERVIEW_SILHOUETTE_METRIC,
    counts: { measured, refusedAndNotShipped: 45194 - measured },
    perBuildingArtifact: {
      note: "Candidate (b): one coarse GLB per building. Measured bytes.",
      totalBytes: perBuildingBytesTotal,
      meanBytes: Math.round(perBuildingBytesTotal / measured),
      medianBytes: sortedBytes[Math.floor((sortedBytes.length - 1) / 2)],
      p95Bytes: at(sortedBytes, 0.95),
      maxBytes: maxPerBuildingBytes,
    },
    aggregatedArtifact: {
      note: "Candidate (a): one aggregated coarse GLB per ledger cell. Two cells were written in full and measured; the island projection applies the measured container-overhead share to the per-building total.",
      samples: aggregateSamples,
      measuredContainerOverheadShare: Math.round(overheadShare * 1e6) / 1e6,
      projectedIslandBytes: Math.round(perBuildingBytesTotal * (1 - overheadShare)),
      artifactCount: cellRows.length,
    },
    gpu: {
      note: "Decoded GPU bytes for the coarse tier, counted as the canonical writer emits: unshared vertices carrying POSITION and NORMAL as float32 (24 B) plus uint32 indices (4 B each). This is the floor; a renderer may add per-instance attributes and pick metadata on top.",
      totalTriangleCount: totalTriangles,
      totalVertexCount: totalVertices,
      vertexBytes: totalVertices * 24,
      indexBytes: totalTriangles * 3 * 4,
      totalBytes: totalVertices * 24 + totalTriangles * 3 * 4,
    },
    silhouetteDeviation: {
      note: "THE DECISIVE MEASUREMENT. The multi-LOD schema pins `maximumRatio` at 0.02 and rejects any declared LOD above it. This is the distribution of the coarse prism's own deviation from the massing it replaces.",
      buildingsMeasured: deviationRatios.length,
      withinSchemaCapCount: withinSchemaCap,
      withinSchemaCapShare: Math.round((withinSchemaCap / deviationRatios.length) * 1e6) / 1e6,
      aboveSchemaCapCount: deviationRatios.length - withinSchemaCap,
      median: Math.round(sortedDeviations[Math.floor((sortedDeviations.length - 1) / 2)] * 1e6) / 1e6,
      p95: Math.round(at(sortedDeviations, 0.95) * 1e6) / 1e6,
      p99: Math.round(at(sortedDeviations, 0.99) * 1e6) / 1e6,
      max: Math.round(sortedDeviations[sortedDeviations.length - 1] * 1e6) / 1e6,
    },
    horizontalError: {
      note: "Largest setback inset the prism fills in, in metres. This is the geometric error a screen-space-error statement must be made against.",
      medianMeters: Math.round(sortedErrors[Math.floor((sortedErrors.length - 1) / 2)] * 1000) / 1000,
      p95Meters: Math.round(at(sortedErrors, 0.95) * 1000) / 1000,
      maxMeters: Math.round(sortedErrors[sortedErrors.length - 1] * 1000) / 1000,
    },
    retention: "census-only",
    hostObservationsLocation: "artifacts/citywide-overview-census-20260814/stages/coarse.json and docs/implementation/20260814-citywide-overview-tier-decision.md — kept out of this artifact's deterministic body so a replay rewrites byte-identical content.",
  };
  const checksum = await writeRecord("coarse-tier.json", artifact);
  const summary = {
    measured,
    perBuildingTotalBytes: perBuildingBytesTotal,
    perBuildingMeanBytes: artifact.perBuildingArtifact.meanBytes,
    projectedAggregatedIslandBytes: artifact.aggregatedArtifact.projectedIslandBytes,
    gpuTotalBytes: artifact.gpu.totalBytes,
    deviationWithinSchemaCapShare: artifact.silhouetteDeviation.withinSchemaCapShare,
    deviationMedian: artifact.silhouetteDeviation.median,
    deviationMax: artifact.silhouetteDeviation.max,
    wallClockSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
    peakRssMebibytes: Math.round(peakRssBytes / 1048576),
    checksumSha256: checksum,
  };
  await writeReceipt(name, print, summary);
  return summary;
}

// ---------------------------------------------------------------------------
// Stage: sample
// ---------------------------------------------------------------------------

/**
 * The overview activation distance and viewport the screen-space-error
 * statement is made against.
 *
 * 8,000 m is the camera height at which the whole island (about 21.6 km north
 * to south) fits a 60-degree vertical field of view, which is what "overview"
 * means for this product. 1,080 device pixels is the reference MacBook viewport
 * height the goal's acceptance is stated against (ADR 0039 Q4). Both are STATED
 * choices; a different overview distance gives a different pixel figure and the
 * arithmetic is in `screenSpaceErrorPixels` so it can be redone.
 */
const OVERVIEW_VIEW = { distanceMeters: 8_000, verticalFieldOfViewDegrees: 60, viewportHeightPixels: 1_080, pixelBudget: 1 };

/** Convert a WGS84 point to metres in a cell-local frame, using the frozen scale pair. */
function toCellLocalMeters(origin, longitude, latitude) {
  return [
    (longitude - origin[0]) * CITYWIDE_OVERHANG_METRIC.metersPerDegreeLongitude,
    (latitude - origin[1]) * CITYWIDE_OVERHANG_METRIC.metersPerDegreeLatitude,
  ];
}

async function stageSample(context) {
  const name = "sample";
  const print = fingerprint(context, name);
  const existing = await readReceipt(name);
  if (existing && existing.inputFingerprint === print && !force) return { skipped: true, ...existing.summary };

  // --- Worst-case individual buildings, SELECTED BY MEASUREMENT ------------
  // Not hand-picked: each is the extremum of a stated property over the whole
  // island, found by the same pass that measures it.
  let widestRing = null;
  let tallest = null;
  let worstDeviation = null;
  for (const cell of context.cells) {
    for (const buildingId of cell.buildingIds) {
      const source = context.sources.get(buildingId);
      let built;
      try { built = buildMidtownCoreV3Plan(source, EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256); } catch { continue; }
      const deviation = prismSilhouetteDeviation(built.plan);
      const ringVertexCount = built.plan.tiers[0].ring.length;
      const topMeters = Math.max(...built.plan.tiers.map((tier) => tier.topZMm)) / 1_000;
      const row = {
        buildingId, cellId: cell.cellId, ringVertexCount, topMeters,
        effectiveTierCount: built.plan.massing.effectiveTierCount,
        deviationRatio: deviation.deviationRatio,
        worstViewId: deviation.worstViewId,
        maxHorizontalErrorMeters: deviation.maxHorizontalErrorMeters,
        coarseGeometry: coarsePrismGeometry(ringVertexCount),
      };
      if (!widestRing || ringVertexCount > widestRing.ringVertexCount) widestRing = row;
      if (!tallest || topMeters > tallest.topMeters) tallest = row;
      if (!worstDeviation || deviation.deviationRatio > worstDeviation.deviationRatio) worstDeviation = row;
    }
  }

  // --- Named sample cells --------------------------------------------------
  const block835Cell = context.cells.find((cell) => cell.cellId.includes("-w00-"));
  const midtownCell = context.cells.filter((cell) => cell.cellId.includes("-w01-")).sort((left, right) => right.buildingIds.length - left.buildingIds.length)[0];
  // The northern cell with the highest share of tier-collapsed members: the
  // case where a coarse tier loses the LEAST and the fine tier buys the least.
  let northernCollapse = null;
  for (const cell of context.cells.filter((candidate) => candidate.cellId.includes("-w05-"))) {
    let collapsed = 0; let planned = 0;
    for (const buildingId of cell.buildingIds) {
      try {
        const built = buildMidtownCoreV3Plan(context.sources.get(buildingId), EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256);
        planned += 1;
        if (built.plan.massing.effectiveTierCount <= 1) collapsed += 1;
      } catch { /* refused */ }
    }
    if (planned >= 20) {
      const share = collapsed / planned;
      if (!northernCollapse || share > northernCollapse.share) northernCollapse = { cell, share, collapsed, planned };
    }
  }

  const sampleCells = [];
  for (const [label, cell] of [["block-835", block835Cell], ["midtown-core-densest", midtownCell], ["northern-highest-tier-collapse", northernCollapse.cell]]) {
    const origin = [cell.bounds.west, cell.bounds.south];
    const members = [];
    const perBuilding = [];
    for (const buildingId of cell.buildingIds) {
      const source = context.sources.get(buildingId);
      let built;
      try { built = buildMidtownCoreV3Plan(source, EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256); } catch { continue; }
      // The plan's rings are in the building's OWN ENU frame around its
      // representative point. Re-anchoring them in a cell-local frame with the
      // frozen scale pair is an approximation: it carries the ADR 0025 scale
      // residual (up to 1,463 ppm) over a cell that is at most ~300 m across,
      // so at most ~0.44 m of relative placement error. That is disclosed here
      // rather than hidden, and it is far below the setback steps being judged.
      const [offsetX, offsetY] = toCellLocalMeters(origin, source.representative[0], source.representative[1]);
      members.push({
        tiers: built.plan.tiers.map((tier) => ({
          ring: tier.ring.map(([x, y]) => [x / 1_000 + offsetX, y / 1_000 + offsetY]),
          zMin: tier.baseZMm / 1_000,
          zMax: tier.topZMm / 1_000,
        })),
      });
      const deviation = prismSilhouetteDeviation(built.plan);
      perBuilding.push({ buildingId, deviationRatio: deviation.deviationRatio, maxHorizontalErrorMeters: deviation.maxHorizontalErrorMeters, effectiveTierCount: built.plan.massing.effectiveTierCount });
    }
    const skyline = cellSkylineDeviation(members);
    const deviations = perBuilding.map((row) => row.deviationRatio).sort((left, right) => left - right);
    const errors = perBuilding.map((row) => row.maxHorizontalErrorMeters);
    sampleCells.push({
      label, cellId: cell.cellId, buildingCount: cell.buildingIds.length, plannedCount: perBuilding.length,
      singleTierCount: perBuilding.filter((row) => row.effectiveTierCount <= 1).length,
      perBuildingDeviation: {
        median: deviations.length ? Math.round(deviations[Math.floor((deviations.length - 1) / 2)] * 1e6) / 1e6 : null,
        max: deviations.length ? Math.round(deviations[deviations.length - 1] * 1e6) / 1e6 : null,
        withinSchemaCapCount: deviations.filter((ratio) => ratio <= 0.02).length,
      },
      aggregateSkylineDeviation: {
        note: "The cell's COMBINED rendered profile, coarse against V3, unioned across members so mutual occlusion counts. This is the number an overview viewer is actually exposed to; the per-building distribution above is not.",
        deviationRatio: Math.round(skyline.deviationRatio * 1e6) / 1e6,
        worstViewId: skyline.worstViewId,
        withinSchemaCap: skyline.deviationRatio <= 0.02,
      },
      screenSpaceError: {
        maxHorizontalErrorMeters: Math.round(Math.max(0, ...errors) * 1000) / 1000,
        pixelsAtOverview: Math.round(screenSpaceErrorPixels({ geometricErrorMeters: Math.max(0, ...errors), ...OVERVIEW_VIEW }) * 1000) / 1000,
      },
    });
  }

  const worstCases = [
    { label: "widest-ring", ...widestRing },
    { label: "tallest", ...tallest },
    { label: "worst-silhouette-deviation", ...worstDeviation },
  ].map((row) => ({
    ...row,
    deviationRatio: Math.round(row.deviationRatio * 1e6) / 1e6,
    withinSchemaCap: row.deviationRatio <= 0.02,
    screenSpaceErrorPixelsAtOverview: Math.round(screenSpaceErrorPixels({ geometricErrorMeters: row.maxHorizontalErrorMeters, ...OVERVIEW_VIEW }) * 1000) / 1000,
  }));

  const artifact = {
    schemaVersion: CITYWIDE_OVERVIEW_CENSUS_SCHEMA_VERSION,
    censusId: CENSUS_ID,
    taskId: "T001",
    artifact: "overview-tier-sample-proof",
    note: "SCHEMA COMPLIANCE IS NOT VISUAL ACCEPTANCE. Everything below is arithmetic over committed geometry: a deviation ratio, a pixel count and an aggregate profile. None of it is a rendered frame, none of it was looked at, and none of it can tell you whether the result reads correctly on screen. The visual gate for whichever tier is adopted still requires rendered stills at the activation distance, and this task did not produce them.",
    base: base(context),
    ledger: ledgerPin(context),
    silhouetteMetric: CITYWIDE_OVERVIEW_SILHOUETTE_METRIC,
    overviewView: { ...OVERVIEW_VIEW, note: "8,000 m puts the island's ~21.6 km extent inside a 60-degree vertical field of view. The pixel budget of 1 device pixel is a STATED bar, not an inherited one." },
    schemaCap: { maximumRatio: 0.02, source: "MULTI_LOD_ASSEMBLY multi-lod schema, `lods[].silhouette.maximumRatio`" },
    cellLocalFrameDisclosure: "Cell skylines re-anchor each building's own ENU plan frame into a cell-local frame with the frozen ADR 0025 scale pair. Over a cell at most ~300 m across the ADR 0025 residual (<=1,463 ppm) is under 0.44 m of relative placement error — well below the setback steps being judged, and disclosed rather than hidden.",
    sampleCells,
    worstCaseBuildings: worstCases,
    retention: "census-only",
  };
  const checksum = await writeRecord("sample-proof.json", artifact);
  const summary = {
    sampleCells: sampleCells.map((cell) => ({ label: cell.label, cellId: cell.cellId, skyline: cell.aggregateSkylineDeviation.deviationRatio, withinCap: cell.aggregateSkylineDeviation.withinSchemaCap, ssePixels: cell.screenSpaceError.pixelsAtOverview })),
    worstCases: worstCases.map((row) => ({ label: row.label, buildingId: row.buildingId, deviationRatio: row.deviationRatio, withinCap: row.withinSchemaCap, ssePixels: row.screenSpaceErrorPixelsAtOverview })),
    checksumSha256: checksum,
  };
  await writeReceipt(name, print, summary);
  return summary;
}

// ---------------------------------------------------------------------------
// Stage: decide
// ---------------------------------------------------------------------------

/**
 * Per-request round-trip rates the completion times are stated at.
 *
 * NOT MEASURED. No committed acceptance evidence in this repository records a
 * per-request latency — the recorded network evidence is request COUNTS only.
 * Two stated rates are given so the shape of the answer is visible and the
 * request-count difference between candidates (which IS structural and exact)
 * is not hidden behind one invented number. Measuring the real local-origin
 * `cache: "no-store"` rate is named as a T002 obligation.
 */
const REQUEST_RATE_ASSUMPTIONS_MS = [5, 20];

async function stageDecide(context) {
  const name = "decide";
  const coarseRecord = JSON.parse(await readFile(join(recordRoot, "coarse-tier.json"), "utf8"));
  const bytesRecord = JSON.parse(await readFile(join(recordRoot, "wave-bytes.json"), "utf8"));
  const sampleRecord = JSON.parse(await readFile(join(recordRoot, "sample-proof.json"), "utf8"));
  const distributions = JSON.parse(await readFile(join(recordRoot, "distributions.json"), "utf8"));
  const print = sha256HexSync(stableSerialize({ stage: name, censusId: CENSUS_ID, coarse: coarseRecord, bytes: bytesRecord, sample: sampleRecord }));
  const existing = await readReceipt(name);
  if (existing && existing.inputFingerprint === print && !force) return { skipped: true, ...existing.summary };

  // --- Candidate (c) wire cost, MEASURED from the shipped shard bytes -------
  const shardDirectory = join(snapshotRoot, "geometry", "buildings");
  const shardNames = (await readdir(shardDirectory)).filter((file) => file.endsWith(".json")).sort();
  const { gzipSync } = await import("node:zlib");
  let denseRawBytes = 0;
  let denseGzipBytes = 0;
  let denseMaxShardRawBytes = 0;
  for (const file of shardNames) {
    const bytes = await readFile(join(shardDirectory, file));
    denseRawBytes += bytes.byteLength;
    denseMaxShardRawBytes = Math.max(denseMaxShardRawBytes, bytes.byteLength);
    denseGzipBytes += gzipSync(bytes, { level: 9 }).byteLength;
  }

  const planned = distributions.counts.planned;
  const coarseGpuBytes = coarseRecord.gpu.totalBytes;
  // Candidate (c) renders through Cesium's own extruded PolygonGeometry with
  // VertexFormat.POSITION_ONLY, so its vertex payload carries no normals. The
  // POSITION-only floor is therefore the coarse tier's vertex bytes halved.
  const densePositionOnlyGpuFloor = coarseRecord.gpu.totalVertexCount * 12 + coarseRecord.gpu.totalTriangleCount * 3 * 4;
  const denseDrawCalls = Math.ceil(planned / 1_500);

  const candidates = [
    {
      candidateId: "a-per-cell-aggregated-coarse-glb",
      label: "Per-cell aggregated coarse GLB (883 assets)",
      cost: costCandidate({
        candidateId: "a-per-cell-aggregated-coarse-glb",
        wireBytes: coarseRecord.aggregatedArtifact.projectedIslandBytes,
        gpuBytes: coarseGpuBytes,
        // One Cesium Model per cell, one material each: 883 draw calls is the FLOOR,
        // and it is only reachable if per-building pick identity is solved some
        // other way than splitting the model.
        drawCalls: 883,
        requestCount: 883,
        perRequestMilliseconds: REQUEST_RATE_ASSUMPTIONS_MS[1],
        concurrency: CITYWIDE_BUDGETS.maxConcurrentRequests,
        cacheEntries: 883,
      }),
      pickStrategies: [
        { id: "a1-model-per-cell-no-feature-ids", drawCalls: 883, verdict: "REJECTED", why: "One Model per cell gives 883 draw calls but NO per-building pick id, so selection, deep links and the details panel all break. The product contract requires selecting a building." },
        { id: "a2-model-per-building", drawCalls: planned, verdict: "REJECTED", why: `${planned.toLocaleString("en-US")} Cesium Models is ${Math.round(planned / denseDrawCalls)}x the draw calls of the batched path already shipping, for the same pixels.` },
        { id: "a3-feature-ids-via-profile-change", drawCalls: 883, verdict: "POSSIBLE, NOT FREE", why: "Per-feature ids inside one GLB need EXT_mesh_features or an equivalent. The multi-LOD glTF profile is CLOSED and validates an exact key set; admitting an extension is a schema change that widens what every future artifact may carry, and it must be argued on its own rather than smuggled in as a rendering detail." },
      ],
      requiredContractChanges: [
        `EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries ${EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries} -> at least ${883 + 474} (883 overview cells alongside the 474 promoted entries)`,
        "multi-LOD glTF profile: admit a per-feature-id extension (closed profile change)",
        "multi-LOD schema: exempt this tier from `silhouette.maximumRatio = 0.02`, or declare no silhouette for it",
      ],
      rightsGate: "883 cells, every one `publicEligible: false` pending per-cell rights evidence. A NAMED USER GATE before any mass shipping.",
      validatorExemptions: ["volume identity (mesh is not closed)", "silhouette maximumRatio 0.02", "non-increasing triangles (a new coarsest tier is fine, but it must be declared LAST in the chain)"],
    },
    {
      candidateId: "b-per-building-coarse-glb",
      label: "Per-building coarse GLB (44,330 assets)",
      cost: costCandidate({
        candidateId: "b-per-building-coarse-glb",
        wireBytes: coarseRecord.perBuildingArtifact.totalBytes,
        gpuBytes: coarseGpuBytes,
        drawCalls: planned,
        requestCount: planned,
        perRequestMilliseconds: REQUEST_RATE_ASSUMPTIONS_MS[1],
        concurrency: CITYWIDE_BUDGETS.maxConcurrentRequests,
        cacheEntries: planned,
      }),
      containerOverhead: {
        note: "The measured price of the per-file container and metadata, paid once per building instead of once per cell.",
        perBuildingTotalBytes: coarseRecord.perBuildingArtifact.totalBytes,
        aggregatedProjectedBytes: coarseRecord.aggregatedArtifact.projectedIslandBytes,
        overheadBytes: coarseRecord.perBuildingArtifact.totalBytes - coarseRecord.aggregatedArtifact.projectedIslandBytes,
        overheadShare: coarseRecord.aggregatedArtifact.measuredContainerOverheadShare,
        meanBytesPerBuilding: coarseRecord.perBuildingArtifact.meanBytes,
        medianBytesPerBuilding: coarseRecord.perBuildingArtifact.medianBytes,
        p95BytesPerBuilding: coarseRecord.perBuildingArtifact.p95Bytes,
        maxBytesPerBuilding: coarseRecord.perBuildingArtifact.maxBytes,
      },
      pickStrategies: [{ id: "b1-model-per-building", drawCalls: planned, verdict: "REJECTED", why: "Pick identity is free, and everything else is not." }],
      requiredContractChanges: [
        `EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries ${EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries} -> ${planned + 474}, an ${Math.round((planned + 474) / EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries)}x raise`,
        `MULTI_LOD_ASSEMBLY_LIMITS.assets ${MULTI_LOD_ASSEMBLY_LIMITS.assets}: ADR 0025 measured 9.61% headroom at one asset per parent and named a multi-asset-per-building scheme as the thing that breaches it. This is that scheme.`,
        "the same silhouette and volume-identity exemptions as candidate (a)",
      ],
      rightsGate: "Same 883-cell rights gate, plus per-building evidence at 44,330 assets.",
      validatorExemptions: ["volume identity", "silhouette maximumRatio 0.02"],
    },
    {
      candidateId: "c-no-new-tier-dense-citywide-shards",
      label: "NO NEW TIER: visibility-stream the existing citywide dense shards",
      cost: costCandidate({
        candidateId: "c-no-new-tier-dense-citywide-shards",
        wireBytes: denseRawBytes,
        gpuBytes: densePositionOnlyGpuFloor,
        drawCalls: denseDrawCalls,
        requestCount: shardNames.length,
        perRequestMilliseconds: REQUEST_RATE_ASSUMPTIONS_MS[1],
        concurrency: CITYWIDE_BUDGETS.maxConcurrentRequests,
        cacheEntries: shardNames.length,
      }),
      wireDetail: {
        note: "These bytes ALREADY EXIST, are already checksum-pinned in the manifest this task's gate verifies, and are already the published, rights-cleared base. Nothing is generated.",
        shardCount: shardNames.length,
        rawBytes: denseRawBytes,
        gzipBytes: denseGzipBytes,
        maxShardRawBytes: denseMaxShardRawBytes,
        rawBytesPerBuilding: Math.round(denseRawBytes / 45194),
        gzipBytesPerBuilding: Math.round(denseGzipBytes / 45194),
      },
      pickStrategies: [{
        id: "c1-batched-geometryinstance-per-instance-pick-id",
        drawCalls: denseDrawCalls,
        verdict: "ALREADY SHIPPING",
        why: "`denseBuildingInstance` already sets `id: feature.id` on every GeometryInstance and the runtime already sets `Feature.id = summary.parentId`, which is the SAME `doitt:NNNNNN` identity the exterior cell assets carry as `canonicalFeatureId`. Selection, deep links and provenance survive unchanged; nothing new has to be invented.",
      }],
      requiredContractChanges: [
        `CITYWIDE_BUDGETS.maxRenderedDenseFeatures ${CITYWIDE_BUDGETS.maxRenderedDenseFeatures} -> ${45194}`,
        `CITYWIDE_BUDGETS.maxDecodedFeatures ${CITYWIDE_BUDGETS.maxDecodedFeatures} -> ${45194}`,
        `CITYWIDE_BUDGETS.maxDecodedSummaries ${CITYWIDE_BUDGETS.maxDecodedSummaries} -> ${45194}`,
        `CITYWIDE_BUDGETS.maxLoadedShards ${CITYWIDE_BUDGETS.maxLoadedShards} -> ${shardNames.length}`,
      ],
      alreadyWithinBudget: [
        `CITYWIDE_BUDGETS.maxLoadedBytes is ${CITYWIDE_BUDGETS.maxLoadedBytes} B and the whole island's building shards are ${denseRawBytes} B. The BYTE ceiling already fits island-wide residency; only the SHARD-COUNT ceiling binds.`,
        `CITYWIDE_BUDGETS.maxShards is ${CITYWIDE_BUDGETS.maxShards} against ${shardNames.length} building shards.`,
      ],
      rightsGate: "NONE. The base snapshot is the already-published, already-approved citywide release; this candidate ships no new artifact and needs no new per-cell rights evidence.",
      validatorExemptions: ["NONE. No release is assembled, no LOD is declared, so no multi-LOD gate applies to it at all."],
      fidelityLoss: {
        note: "STATED HONESTLY. The dense path extrudes the sourced outer ring flat to the sourced height — which is EXACTLY the same shape as the coarse prism of candidates (a) and (b). It is not a weaker representation than them; it is the same representation, reached without shipping anything. What it loses against V3 tiered massing is the setback steps, measured below.",
        medianSilhouetteDeviation: coarseRecord.silhouetteDeviation.median,
        p95SilhouetteDeviation: coarseRecord.silhouetteDeviation.p95,
        maxSilhouetteDeviation: coarseRecord.silhouetteDeviation.max,
        worstSampleCellSkylineDeviation: Math.max(...sampleRecord.sampleCells.map((cell) => cell.aggregateSkylineDeviation.deviationRatio)),
        worstSampleScreenSpaceErrorPixels: Math.max(...sampleRecord.sampleCells.map((cell) => cell.screenSpaceError.pixelsAtOverview)),
        alsoLost: "Procedural facade texture and openings, which LOD 1 already drops and which are far below a pixel at overview distance in any case.",
        notRendered: "NO A/B STILL WAS RENDERED. This task produced arithmetic, not frames. A rendered comparison at the overview distance is an unmet gate, named for T002.",
      },
    },
  ];

  for (const candidate of candidates) {
    candidate.budgetChecks = checkCandidateBudgets(candidate.cost, {
      cacheEntries: EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries,
      drawCalls: 1_000,
    });
    candidate.timeToCompleteOverviewSecondsByRate = Object.fromEntries(REQUEST_RATE_ASSUMPTIONS_MS.map((rate) => [
      `${rate}ms`,
      Math.round((Math.ceil(candidate.cost.requestCount / candidate.cost.concurrency) * rate) / 100) / 10,
    ]));
  }

  const recommendation = {
    recommended: "c-no-new-tier-dense-citywide-shards",
    killSwitchFired: false,
    statement: "Candidate (c). The overview representation the goal asks for — real building shapes island-wide — is a flat extrusion of the sourced footprint to the sourced height, and the shipping renderer ALREADY draws exactly that from bytes that already exist. Candidates (a) and (b) generate new artifacts whose rendered silhouette is IDENTICAL to what (c) draws for free, and pay for it in cache entries, container overhead, a closed-profile extension, a silhouette-cap exemption and a per-cell rights envelope. There is no fidelity argument for (a) or (b) at overview distance, because there is no fidelity difference.",
    boundsAndConditions: [
      `(c) is bounded by four recorded budget raises, not by data: ${CITYWIDE_BUDGETS.maxRenderedDenseFeatures} -> 45,194 rendered dense features and three decode/shard ceilings. The BYTE ceiling already fits.`,
      `Draw calls at overview are ${denseDrawCalls} batched Primitives, against ${planned.toLocaleString("en-US")} if the same geometry were drawn as per-building Models.`,
      "Decoded GPU bytes inside Cesium are NOT observable from this task and are explicitly out of scope for the exterior loader's own byte ceiling. The figure quoted for (c) is a POSITION-only structural floor, not a measurement, and T002 must measure the real one before the frame budgets can be claimed.",
      "The per-request rate is an assumption, not a measurement. The request COUNT is exact and is the part that separates the candidates by two orders of magnitude.",
      "A coarse GLB tier is NOT dead as a near-field idea; it is rejected as the OVERVIEW answer. If a future need appears for a mid-distance tier between V3 lod_1 and the dense path, this measurement stands ready and the kill switch does not apply to it.",
    ],
    killSwitchCondition: "If a measured decoded-GPU or frame-time result in T002 shows (c) cannot hold the 16.7/25 ms budget island-wide even with the dense feature cap raised, the fallback is NOT candidate (a) or (b) — their GPU cost is the same or higher for the same pixels. The fallback is to bound (c) by visibility rather than by a flat cap, and the kill switch fires only if a visibility-bounded (c) also fails.",
  };

  const artifact = {
    schemaVersion: CITYWIDE_OVERVIEW_CENSUS_SCHEMA_VERSION,
    censusId: CENSUS_ID,
    taskId: "T001",
    artifact: "overview-tier-candidate-costs-and-recommendation",
    note: "Every wire and GPU figure here comes from a MEASUREMENT recorded in a sibling artifact of this census, except the two that are labelled as assumptions (the per-request rate) or as structural floors (decoded GPU bytes inside Cesium). Nothing was estimated where it could be measured.",
    base: base(context),
    ledger: ledgerPin(context),
    requestRateAssumptionsMilliseconds: REQUEST_RATE_ASSUMPTIONS_MS,
    islandBuildingCounts: { enumerated: 45194, planned, materializedByWaves: bytesRecord.islandMaterializedBuildingCount },
    existingTierCosts: {
      note: "What the island would cost with the tiers that already exist, for scale.",
      lod0TotalBytes: bytesRecord.islandGeneratedWaves.lod0TotalBytes,
      lod0MeanBytesPerBuilding: bytesRecord.islandGeneratedWaves.lod0MeanBytesPerBuilding,
      lod1TotalBytes: bytesRecord.islandGeneratedWaves.lod1TotalBytes,
      lod1MeanBytesPerBuilding: bytesRecord.islandGeneratedWaves.lod1MeanBytesPerBuilding,
      lod1AsShareOfLod0: bytesRecord.islandGeneratedWaves.lod1AsShareOfLod0,
      finding: "lod_1 is not a coarse tier. It is lod_0 without wall recesses and without texture, and it costs 46% of lod_0. An island-wide lod_1 overview would be 1.49 GB, which is why 'ship the tier that already exists' is not an option and why this task exists.",
    },
    candidates,
    recommendation,
  };
  const checksum = await writeRecord("candidate-costs.json", artifact);
  const summary = {
    recommended: recommendation.recommended,
    killSwitchFired: recommendation.killSwitchFired,
    table: candidates.map((candidate) => ({
      id: candidate.candidateId,
      wireMiB: candidate.cost.wireMebibytes,
      gpuMiB: candidate.cost.gpuMebibytes,
      drawCalls: candidate.cost.drawCalls,
      requests: candidate.cost.requestCount,
      cacheEntries: candidate.cost.cacheEntries,
      failedBudgets: candidate.budgetChecks.filter((check) => !check.ok).map((check) => check.id),
    })),
    checksumSha256: checksum,
  };
  await writeReceipt(name, print, summary);
  return summary;
}

// ---------------------------------------------------------------------------

const context = await loadContext();
console.log(`gate PASS  ${context.gate.expectedReleaseId} @ ${context.gate.observedManifestChecksumSha256}`);
console.log(`           ${context.declaredShardCount} verified building shards, ${context.sources.size} parents, ${context.cells.length} ledger cells`);
if (stage === "gate") process.exit(0);

const selected = stage === "all" ? STAGES.filter((name) => name !== "gate") : [stage];
for (const name of selected) {
  const summary = name === "extents" ? await stageExtents(context)
    : name === "plans" ? await stagePlans(context)
    : name === "bytes" ? await stageBytes(context)
    : name === "coarse" ? await stageCoarse(context)
    : name === "sample" ? await stageSample(context)
    : await stageDecide(context);
  console.log(`${name} ${summary.skipped ? "SKIP (fresh receipt)" : "OK"}  ${JSON.stringify(summary)}`);
}
console.log(`records written under data/${CENSUS_ID}/`);
