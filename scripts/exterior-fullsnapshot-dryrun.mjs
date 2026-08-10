// Full-snapshot deterministic generation dry run (Task T012).
//
// Runs the deterministic facade generator and the package planner over every
// accepted building parent of the pinned, gitignored `manhattan-citywide-
// 20260804` snapshot and proves, without activating or publishing anything:
//
//   (a) every parent receives a deterministic, schema-complete component plan;
//   (b) two replays are byte identical and reconciliation reports zero
//       missing / duplicate / unclassified outcomes; and
//   (c) a budget violation fails closed before any wave is materialized.
//
// This script materializes no wave, writes nothing under public/data, and
// touches no release. Its whole output tree lives under one disposable root.
//
// Plans are streamed one ledger cell at a time and discarded: retaining all
// 45,194 plans costs ~2.8 GB of resident memory for no benefit. Generation is
// single threaded because determinism, not throughput, is the deliverable.
//
// Usage: pnpm exterior-fullsnapshot:dryrun -- <output-directory>
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  generateDeterministicFacadePlan,
  validateDeterministicFacadePlan,
  DETERMINISTIC_FACADE_LIMITS,
} from "../src/domain/deterministic-facade-generator.ts";
import { domainSeparatedSha256, sha256HexSync } from "../src/domain/deterministic-hash.ts";
import {
  EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
  EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID,
  EXTERIOR_FULLSNAPSHOT_GENERATED_AT,
  EXTERIOR_FULLSNAPSHOT_INPUT_ISSUE_CODES,
  EXTERIOR_FULLSNAPSHOT_PROJECTION,
  buildExteriorFullSnapshotInput,
} from "../src/domain/exterior-fullsnapshot-input.ts";
import {
  EXTERIOR_WAVE_BASE_BUILDING_COUNT,
  EXTERIOR_WAVE_LEDGER_RELEASE_ID,
  EXTERIOR_WAVE_TILE_LEVEL,
  exteriorArtifactChecksum,
  serializeExteriorArtifact,
  validateExteriorWaveLedger,
} from "../src/release/exterior-wave-ledger.ts";
import {
  EXTERIOR_FULLSNAPSHOT_LOD_PROFILE,
  buildFullSnapshotBudgetTable,
  buildFullSnapshotPackagePlan,
  estimateFullSnapshotBuildingBytes,
  reconcileFullSnapshotGeneration,
  simulateFullSnapshotCache,
} from "../src/release/exterior-fullsnapshot-plan.ts";
import { EXTERIOR_RUNTIME_BUDGETS } from "../src/runtime/exterior-cell-runtime.ts";
import { isSafeReleaseArtifactReference } from "../src/runtime/path-security.ts";

const APPROVED_OUTPUT_ROOT = "/tmp/udt-t012-fullsnapshot-dryrun-20260810";
const EVIDENCE_RELEASE_ID = "manhattan-exterior-fullsnapshot-dryrun-20260810";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotRoot = join(repositoryRoot, "public", "data", EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID);
const ledgerRoot = join(repositoryRoot, "data", "normalized", EXTERIOR_WAVE_LEDGER_RELEASE_ID);

const argv = globalThis.process.argv.slice(2);
const evidenceFlag = argv.indexOf("--evidence");
const emitEvidence = evidenceFlag !== -1;
const positional = argv.filter((value, index) => index !== evidenceFlag && !value.startsWith("--"));
const outputRoot = resolve(positional[0] ?? join(APPROVED_OUTPUT_ROOT, "run-a"));
if (outputRoot !== APPROVED_OUTPUT_ROOT && !outputRoot.startsWith(`${APPROVED_OUTPUT_ROOT}/`)) {
  throw new Error(`Refusing to write outside the approved disposable root ${APPROVED_OUTPUT_ROOT}: ${outputRoot}.`);
}

const startedAt = Date.now();
let peakRssBytes = 0;
function sampleRss() {
  peakRssBytes = Math.max(peakRssBytes, globalThis.process.memoryUsage().rss);
}

const checks = [];
class DryRunStop extends Error {}
function check(label, passed, detail) {
  checks.push({ label, passed, detail });
  if (!passed) throw new DryRunStop(`${label} (${detail})`);
}

async function writeStopReport(message) {
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const target = join(APPROVED_OUTPUT_ROOT, `stop-report-${stamp}.md`);
  const lines = [
    "# T012 full-snapshot dry-run stop report",
    "",
    `Output root: \`${outputRoot}\``,
    `Failure: ${message}`,
    "",
    "No wave was materialized and no release was activated. Cross-checks up to",
    "the failure, in execution order:",
    "",
    ...checks.map((entry) => `- ${entry.passed ? "PASS" : "FAIL"}  ${entry.label}${entry.passed ? "" : ` -- ${entry.detail}`}`),
    "",
  ];
  await mkdir(APPROVED_OUTPUT_ROOT, { recursive: true });
  await writeFile(target, `${lines.join("\n")}\n`, "utf8");
  return target;
}

async function run() {
  if (!existsSync(snapshotRoot)) {
    throw new Error(`Local citywide snapshot ${snapshotRoot} is absent. This script never acquires data; publish the approved local release first.`);
  }

  // --- Base snapshot identity ---------------------------------------------
  const manifestText = await readFile(join(snapshotRoot, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestText);
  const recordedChecksum = (await readFile(join(snapshotRoot, "manifest.sha256"), "utf8")).trim().split(/\s+/u)[0];
  const manifestChecksum = sha256HexSync(manifestText);
  check("citywide manifest checksum matches its recorded manifest.sha256", recordedChecksum === manifestChecksum, `${recordedChecksum} vs ${manifestChecksum}`);
  check("citywide manifest checksum is the pinned base the generation instant is defined for", manifestChecksum === EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256, manifestChecksum);
  check("base release id is the approved snapshot", manifest.releaseId === EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID, String(manifest.releaseId));
  check("base snapshot is not fixture-only", manifest.fixtureOnly === false, String(manifest.fixtureOnly));
  const buildingLayer = manifest.layers.find((layer) => layer.id === "buildings");
  check("building layer tile level is 14", buildingLayer?.tileLevel === EXTERIOR_WAVE_TILE_LEVEL, String(buildingLayer?.tileLevel));
  check(
    "manifest counts agree on the accepted building total",
    buildingLayer?.parentCount === EXTERIOR_WAVE_BASE_BUILDING_COUNT && manifest.coverage.acceptedBuildingCount === EXTERIOR_WAVE_BASE_BUILDING_COUNT && manifest.coverage.unresolvedBuildingCount === 0,
    `${buildingLayer?.parentCount}/${manifest.coverage.acceptedBuildingCount}`,
  );

  // --- Verified shard reads ------------------------------------------------
  // Every shard is read through its manifest-declared `relativeContentRef` and
  // verified against the declared checksum and byte size before a single
  // coordinate is trusted. Generation is derived from these bytes, so an
  // unverified read would let silent local corruption become a "deterministic"
  // result.
  const shardDirectory = join(snapshotRoot, "geometry", "buildings");
  const shardFiles = (await readdir(shardDirectory)).filter((name) => name.endsWith(".json")).sort();
  const declaredShards = manifest.geometryShards
    .filter((shard) => shard.layer === "buildings")
    .sort((left, right) => (left.shardId < right.shardId ? -1 : 1));
  check("every declared building shard is present on disk", declaredShards.length === shardFiles.length, `${declaredShards.length} declared vs ${shardFiles.length} on disk`);
  check(
    "no undeclared building shard file is present",
    shardFiles.every((name) => declaredShards.some((shard) => shard.relativeContentRef === `geometry/buildings/${name}`)),
    "an on-disk shard is absent from the manifest",
  );

  const encoder = new globalThis.TextEncoder();
  const sources = new Map();
  let unsafeRefs = 0;
  let byteSizeMismatches = 0;
  let checksumMismatches = 0;
  let nonPolygon = 0;
  let nonZeroPartIndex = 0;
  let featureCount = 0;
  let multipleSourceRefs = 0;
  for (const declared of declaredShards) {
    if (!isSafeReleaseArtifactReference(declared.relativeContentRef)) { unsafeRefs += 1; continue; }
    const text = await readFile(join(snapshotRoot, declared.relativeContentRef), "utf8");
    if (encoder.encode(text).byteLength !== declared.byteSize) byteSizeMismatches += 1;
    if (sha256HexSync(text) !== declared.checksumSha256) checksumMismatches += 1;
    const shard = JSON.parse(text);
    for (const feature of shard.features) {
      featureCount += 1;
      if (feature.partIndex !== 0) nonZeroPartIndex += 1;
      if (feature.geometry?.type !== "Polygon") { nonPolygon += 1; continue; }
      if (feature.sourceRefIds.length !== 1) multipleSourceRefs += 1;
      const rings = feature.geometry.coordinates;
      sources.set(feature.parentId, {
        buildingId: feature.parentId,
        representative: feature.coordinates,
        outerRing: rings[0],
        holeRings: rings.slice(1),
        heightMeters: feature.heightMeters,
        heightUnknown: feature.heightUnknown === true,
        sourceRefId: feature.sourceRefIds[0],
      });
    }
    sampleRss();
  }
  check("every declared shard reference is a canonical safe relative path", unsafeRefs === 0, `${unsafeRefs} unsafe refs`);
  check("every building shard matches its declared byte size", byteSizeMismatches === 0, `${byteSizeMismatches} mismatches of ${declaredShards.length}`);
  check("every building shard matches its declared SHA-256 checksum", checksumMismatches === 0, `${checksumMismatches} mismatches of ${declaredShards.length}`);
  check("every accepted building carries one polygon footprint", nonPolygon === 0, `${nonPolygon} non-polygon geometries`);
  check("every building is a single render part", nonZeroPartIndex === 0, `${nonZeroPartIndex} parts with a non-zero partIndex`);
  check("every building carries exactly one source reference", multipleSourceRefs === 0, `${multipleSourceRefs} buildings with a different count`);
  check("shard feature total equals the accepted building count", featureCount === EXTERIOR_WAVE_BASE_BUILDING_COUNT, String(featureCount));
  check("building ids are unique across the frozen grouping", sources.size === EXTERIOR_WAVE_BASE_BUILDING_COUNT, `${sources.size} unique of ${featureCount}`);

  // --- Committed ledger ----------------------------------------------------
  const ledgerText = await readFile(join(ledgerRoot, "ledger.json"), "utf8");
  const ledger = JSON.parse(ledgerText);
  const ledgerChecksumSha256 = exteriorArtifactChecksum(ledger);
  const recordedLedgerChecksum = (await readFile(join(ledgerRoot, "ledger.sha256"), "utf8")).trim().split(/\s+/u)[0];
  check("committed ledger checksum matches its recorded ledger.sha256", recordedLedgerChecksum === ledgerChecksumSha256, `${recordedLedgerChecksum} vs ${ledgerChecksumSha256}`);
  const ledgerValidation = validateExteriorWaveLedger(ledger);
  check("committed ledger passes the accepted release-graph schema and wave invariants", ledgerValidation.ok, ledgerValidation.ok ? "" : JSON.stringify(ledgerValidation.issues.slice(0, 5)));
  const enumerated = ledger.cells.reduce((total, cell) => total + cell.buildingIds.length, 0);
  check("ledger enumerates the accepted building total exactly once", enumerated === EXTERIOR_WAVE_BASE_BUILDING_COUNT && new Set(ledger.cells.flatMap((cell) => cell.buildingIds)).size === EXTERIOR_WAVE_BASE_BUILDING_COUNT, String(enumerated));

  // --- Streamed generation, one ledger cell at a time ----------------------
  const cellFiles = new Map();
  const outcomes = [];
  const planned = new Map();
  const orderedPlanHashes = [];
  const totals = {
    planned: 0,
    stopped: 0,
    heightUnknown: 0,
    forcedTwoFloor: 0,
    forcedTwoBay: 0,
    subThreeMeter: 0,
    holeRingsDropped: 0,
    buildingsWithDroppedHoles: 0,
    fallbackHeight: 0,
    maximumFloorCount: 0,
    maximumBayCount: 0,
    maximumPlacementCount: 0,
    maximumHeightResidualMm: 0,
    heightResidualSumMm: 0,
    maximumSpanMm: 0,
    maximumCellBuildingCount: 0,
  };
  const areaRatios = [];
  const axisAlignedAreaRatios = [];
  const placementCounts = [];
  const heightResiduals = [];
  const spans = [];
  const stopsByCode = Object.fromEntries(EXTERIOR_FULLSNAPSHOT_INPUT_ISSUE_CODES.map((code) => [code, 0]));

  const orderedCells = [...ledger.cells].sort((left, right) => left.order - right.order);
  for (const cell of orderedCells) {
    totals.maximumCellBuildingCount = Math.max(totals.maximumCellBuildingCount, cell.buildingIds.length);
    const rows = [];
    for (const buildingId of cell.buildingIds) {
      const source = sources.get(buildingId);
      if (!source) {
        outcomes.push({ kind: "stopped", buildingId, cellId: cell.cellId, stopCode: "rejected-input" });
        stopsByCode["rejected-input"] += 1;
        totals.stopped += 1;
        rows.push({ buildingId, outcome: "stopped", stopCode: "rejected-input", detail: "Ledger member is absent from the verified shard grouping." });
        continue;
      }
      const adapted = buildExteriorFullSnapshotInput(source, { baseManifestChecksumSha256: manifestChecksum });
      if (!adapted.ok) {
        const stopCode = adapted.issues[0].code;
        outcomes.push({ kind: "stopped", buildingId, cellId: cell.cellId, stopCode });
        stopsByCode[stopCode] += 1;
        totals.stopped += 1;
        rows.push({ buildingId, outcome: "stopped", stopCode, detail: adapted.issues[0].detail });
        continue;
      }
      const generated = generateDeterministicFacadePlan(adapted.input);
      if (!generated.ok) {
        outcomes.push({ kind: "stopped", buildingId, cellId: cell.cellId, stopCode: "rejected-input" });
        stopsByCode["rejected-input"] += 1;
        totals.stopped += 1;
        rows.push({ buildingId, outcome: "stopped", stopCode: "rejected-input", detail: JSON.stringify(generated.issues.slice(0, 2)) });
        continue;
      }
      const validated = validateDeterministicFacadePlan(generated.value);
      if (!validated.ok) {
        outcomes.push({ kind: "stopped", buildingId, cellId: cell.cellId, stopCode: "rejected-input" });
        stopsByCode["rejected-input"] += 1;
        totals.stopped += 1;
        rows.push({ buildingId, outcome: "stopped", stopCode: "rejected-input", detail: JSON.stringify(validated.issues.slice(0, 2)) });
        continue;
      }
      const plan = validated.value;
      const record = adapted.record;
      const bytes = estimateFullSnapshotBuildingBytes(record.placementCount);
      totals.planned += 1;
      totals.holeRingsDropped += record.holeRingsDropped;
      if (record.holeRingsDropped > 0) totals.buildingsWithDroppedHoles += 1;
      if (source.heightUnknown) totals.heightUnknown += 1;
      if (record.heightSource === "fallback") totals.fallbackHeight += 1;
      if (record.forcedTwoFloor) totals.forcedTwoFloor += 1;
      if (record.forcedTwoBay) totals.forcedTwoBay += 1;
      if (record.heightSource === "source" && record.unquantizedHeightMm < 3_000) totals.subThreeMeter += 1;
      totals.maximumFloorCount = Math.max(totals.maximumFloorCount, record.floorCount);
      totals.maximumBayCount = Math.max(totals.maximumBayCount, record.bayCount);
      totals.maximumPlacementCount = Math.max(totals.maximumPlacementCount, record.placementCount);
      totals.maximumHeightResidualMm = Math.max(totals.maximumHeightResidualMm, record.heightResidualMm);
      totals.heightResidualSumMm += record.heightResidualMm;
      totals.maximumSpanMm = Math.max(totals.maximumSpanMm, record.maximumSpanMm);
      areaRatios.push(record.areaRatioPartsPerMillion);
      axisAlignedAreaRatios.push(record.axisAlignedAreaRatioPartsPerMillion);
      placementCounts.push(record.placementCount);
      heightResiduals.push(record.heightResidualMm);
      spans.push(record.maximumSpanMm);
      outcomes.push({ kind: "planned", buildingId, cellId: cell.cellId, planHashSha256: plan.planHashSha256 });
      planned.set(buildingId, { buildingId, placementCount: record.placementCount });
      orderedPlanHashes.push(plan.planHashSha256);
      rows.push({
        buildingId,
        outcome: "planned",
        planId: plan.planId,
        planHashSha256: plan.planHashSha256,
        inputFingerprintSha256: plan.inputFingerprintSha256,
        parametersHashSha256: plan.parametersHashSha256,
        record,
        estimatedBytes: bytes,
      });
    }
    cellFiles.set(`cells/${cell.cellId}.json`, serializeExteriorArtifact({
      schemaVersion: "1.0",
      cellId: cell.cellId,
      order: cell.order,
      buildingCount: cell.buildingIds.length,
      membershipChecksumSha256: cell.membershipChecksumSha256,
      generatedAt: EXTERIOR_FULLSNAPSHOT_GENERATED_AT,
      rows,
    }));
    sampleRss();
  }

  check("every enumerated ledger member produced a deterministic plan", totals.planned === EXTERIOR_WAVE_BASE_BUILDING_COUNT && totals.stopped === 0, `${totals.planned} planned, ${totals.stopped} stopped, stops ${JSON.stringify(stopsByCode)}`);
  check("every plan hash is unique across the snapshot", new Set(orderedPlanHashes).size === orderedPlanHashes.length, `${new Set(orderedPlanHashes).size} unique of ${orderedPlanHashes.length}`);
  check("no generator cap was reached, so no plan was silently clamped", totals.maximumFloorCount < DETERMINISTIC_FACADE_LIMITS.maxFloors && totals.maximumBayCount < DETERMINISTIC_FACADE_LIMITS.maxBays && totals.maximumPlacementCount < DETERMINISTIC_FACADE_LIMITS.maxPlacements, `floors ${totals.maximumFloorCount}, bays ${totals.maximumBayCount}, placements ${totals.maximumPlacementCount}`);

  // --- Package plan, budgets, cache simulation, reconciliation -------------
  const packagePlan = buildFullSnapshotPackagePlan({
    ledger,
    ledgerChecksumSha256,
    baseReleaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID,
    baseManifestChecksumSha256: manifestChecksum,
    planned,
  });
  const budgetTable = buildFullSnapshotBudgetTable({
    plan: packagePlan,
    maximumPlacementCount: totals.maximumPlacementCount,
    maximumCellBuildingCount: totals.maximumCellBuildingCount,
    placementCap: DETERMINISTIC_FACADE_LIMITS.maxPlacements,
  });
  const cacheSimulation = simulateFullSnapshotCache({
    plan: packagePlan,
    maxCacheEntries: EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries,
    maxCachedBytes: EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes,
  });
  const reconciliation = reconcileFullSnapshotGeneration(ledger, {
    ledgerChecksumSha256,
    outcomes,
    stopCodes: EXTERIOR_FULLSNAPSHOT_INPUT_ISSUE_CODES,
  });

  check("package plan covers every accepted building across the whole LOD profile", packagePlan.assetCount === EXTERIOR_WAVE_BASE_BUILDING_COUNT && packagePlan.artifactCount === EXTERIOR_WAVE_BASE_BUILDING_COUNT * EXTERIOR_FULLSNAPSHOT_LOD_PROFILE.length, `${packagePlan.assetCount} assets / ${packagePlan.artifactCount} artifacts`);
  check("package plan is explicitly an estimate and not an assembly manifest", packagePlan.estimated === true && packagePlan.pilotCrossCheckGating === false, `${packagePlan.estimateBasis}`);
  // Acceptance (c): budgets are hard ceilings. A failing check throws here,
  // before the package plan is written and long before any wave could be built.
  check("every multi-LOD assembly budget check passes on the gating structural estimate", budgetTable.ok, JSON.stringify(budgetTable.checks.filter((entry) => !entry.ok)));
  check("one ledger cell still loads atomically inside the accepted runtime cache", cacheSimulation.singleCellFitsCache && cacheSimulation.cellsOverCachedBytes === 0, JSON.stringify({ entries: cacheSimulation.maximumSingleCellEntries, overBytes: cacheSimulation.cellsOverCachedBytes }));
  check("reconciliation reports zero missing, duplicate, and unclassified outcomes", reconciliation.ok && reconciliation.counts.missing === 0 && reconciliation.counts.duplicate === 0 && reconciliation.counts.unclassified === 0, JSON.stringify(reconciliation.counts));

  // --- Deterministic emission ---------------------------------------------
  const percentile = (values, fraction) => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
  };
  const summary = {
    schemaVersion: "1.0",
    runKind: "dry-run",
    activatedRelease: false,
    baseReleaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID,
    baseManifestChecksumSha256: manifestChecksum,
    ledgerId: ledger.ledgerId,
    ledgerChecksumSha256,
    generatedAt: EXTERIOR_FULLSNAPSHOT_GENERATED_AT,
    projection: EXTERIOR_FULLSNAPSHOT_PROJECTION,
    counts: {
      enumerated,
      planned: totals.planned,
      stopped: totals.stopped,
      stopsByCode,
      cells: ledger.cells.length,
      heightUnknown: totals.heightUnknown,
      fallbackHeight: totals.fallbackHeight,
      forcedTwoFloor: totals.forcedTwoFloor,
      forcedTwoBay: totals.forcedTwoBay,
      subThreeMeterHeight: totals.subThreeMeter,
      buildingsWithDroppedHoles: totals.buildingsWithDroppedHoles,
      holeRingsDropped: totals.holeRingsDropped,
    },
    grammar: {
      maximumFloorCount: totals.maximumFloorCount,
      maximumBayCount: totals.maximumBayCount,
      maximumPlacementCount: totals.maximumPlacementCount,
      medianPlacementCount: percentile(placementCounts, 0.5),
      capsReached: stopsByCode["cap-exceeded"],
    },
    quantization: {
      medianHeightResidualMm: percentile(heightResiduals, 0.5),
      maximumHeightResidualMm: totals.maximumHeightResidualMm,
      meanHeightResidualMicrometers: Math.round((totals.heightResidualSumMm / Math.max(1, totals.planned)) * 1000),
    },
    footprintProxy: {
      proxy: "min-rect-proxy-v1",
      medianAreaRatioPartsPerMillion: percentile(areaRatios, 0.5),
      p95AreaRatioPartsPerMillion: percentile(areaRatios, 0.95),
      maximumAreaRatioPartsPerMillion: percentile(areaRatios, 1),
      // The cheaper alternative this proxy replaces, measured on the same rings.
      medianAxisAlignedAreaRatioPartsPerMillion: percentile(axisAlignedAreaRatios, 0.5),
      p95AxisAlignedAreaRatioPartsPerMillion: percentile(axisAlignedAreaRatios, 0.95),
      maximumAxisAlignedAreaRatioPartsPerMillion: percentile(axisAlignedAreaRatios, 1),
      medianSpanMm: percentile(spans, 0.5),
      p95SpanMm: percentile(spans, 0.95),
      maximumSpanMm: totals.maximumSpanMm,
      maximumProjectionScaleErrorMm: Math.round((totals.maximumSpanMm * EXTERIOR_FULLSNAPSHOT_PROJECTION.maximumLongitudeScaleErrorPartsPerMillion) / 1_000_000),
    },
    bytes: {
      gatingBasis: "structural-gltf-accessor-arithmetic-v1",
      structuralTotalBytes: packagePlan.estimatedTotalBytes,
      nonGatingPilotTotalBytes: packagePlan.pilotCrossCheckTotalBytes,
      maximumArtifactEstimatedBytes: packagePlan.maximumArtifactEstimatedBytes,
      maximumCellEstimatedBytes: packagePlan.maximumCellEstimatedBytes,
    },
  };

  const documents = new Map([
    ["summary.json", serializeExteriorArtifact(summary)],
    ["package-plan.json", serializeExteriorArtifact(packagePlan)],
    ["budget-table.json", serializeExteriorArtifact(budgetTable)],
    ["cache-simulation.json", serializeExteriorArtifact(cacheSimulation)],
    ["reconciliation.json", serializeExteriorArtifact(reconciliation)],
  ]);

  // The run digest covers every plan hash in ledger order plus each emitted
  // document, so a single changed plan or a single changed report moves it.
  const runDigest = domainSeparatedSha256("udt.fullsnapshot.dryrun.v1", {
    ledgerChecksumSha256,
    baseManifestChecksumSha256: manifestChecksum,
    generatedAt: EXTERIOR_FULLSNAPSHOT_GENERATED_AT,
    planHashesSha256: sha256HexSync(orderedPlanHashes.join("\n")),
    planCount: orderedPlanHashes.length,
    documents: [...documents].sort(([left], [right]) => (left < right ? -1 : 1)).map(([name, text]) => [name, sha256HexSync(text)]),
    cellDocuments: [...cellFiles].sort(([left], [right]) => (left < right ? -1 : 1)).map(([name, text]) => [name, sha256HexSync(text)]),
  });
  documents.set("run-digest.json", serializeExteriorArtifact({
    schemaVersion: "1.0",
    runDigestSha256: runDigest,
    planCount: orderedPlanHashes.length,
    cellDocumentCount: cellFiles.size,
    documentCount: documents.size + 1,
  }));

  const files = new Map([...cellFiles, ...documents]);
  async function existingFiles(directory) {
    if (!existsSync(directory)) return [];
    const entries = await readdir(directory, { recursive: true, withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => relative(directory, join(entry.parentPath ?? entry.path, entry.name)).split("\\").join("/"));
  }
  const stale = (await existingFiles(outputRoot)).filter((path) => !files.has(path));
  for (const path of stale) await rm(join(outputRoot, path));
  for (const [path, text] of [...files].sort(([left], [right]) => (left < right ? -1 : 1))) {
    const target = join(outputRoot, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text, "utf8");
  }
  sampleRss();

  const wallClockSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(1));

  // Host timings and memory are observations of one run, not replayed values.
  // They are written beside the run under the disposable root and are quoted in
  // docs/implementation/; they must never enter the checksummed committed
  // evidence, or every later `--evidence` run would rewrite its bytes and
  // invalidate the recorded checksum.
  await writeFile(join(APPROVED_OUTPUT_ROOT, `observed-${relative(APPROVED_OUTPUT_ROOT, outputRoot) || "root"}.json`), `${JSON.stringify({
    outputRoot,
    wallClockSeconds,
    peakRssBytes,
    nodeVersion: globalThis.process.version,
    platform: globalThis.process.platform,
    runDigestSha256: runDigest,
  }, null, 2)}\n`, "utf8");

  if (emitEvidence) {
    const evidenceRoot = join(repositoryRoot, "data", "normalized", EVIDENCE_RELEASE_ID);
    // Every field below is a deterministic function of the pinned snapshot, the
    // committed ledger, and this repository's code. Two `--evidence` runs on any
    // host therefore emit byte-identical evidence.
    const evidence = {
      schemaVersion: "1.0",
      evidenceId: EVIDENCE_RELEASE_ID,
      taskId: "T012",
      runKind: "dry-run",
      activatedRelease: false,
      publishedArtifacts: false,
      deterministic: true,
      producedBy: "pnpm exterior-fullsnapshot:dryrun -- <output-directory> --evidence",
      hostObservationsLocation: "docs/implementation/20260810-exterior-fullsnapshot-dryrun.md (host timings and memory are deliberately not part of this artifact)",
      runDigestSha256: runDigest,
      summary,
      budgetTable,
      cacheSimulation,
      reconciliation: { ...reconciliation, findings: reconciliation.findings },
    };
    const evidenceText = serializeExteriorArtifact(evidence);
    await mkdir(evidenceRoot, { recursive: true });
    await writeFile(join(evidenceRoot, "evidence.json"), evidenceText, "utf8");
    await writeFile(join(evidenceRoot, "evidence.sha256"), `${sha256HexSync(evidenceText)}  evidence.json\n`, "utf8");
  }

  const lines = [
    `T012 full-snapshot deterministic dry run: ${outputRoot}`,
    `  runDigestSha256       ${runDigest}`,
    `  baseManifest.sha256   ${manifestChecksum}`,
    `  ledger.sha256         ${ledgerChecksumSha256}`,
    `  planned / stopped     ${totals.planned} / ${totals.stopped}`,
    `  cells                 ${ledger.cells.length} (max membership ${totals.maximumCellBuildingCount})`,
    `  heightUnknown         ${totals.heightUnknown}  forcedTwoFloor ${totals.forcedTwoFloor}  holeRingsDropped ${totals.holeRingsDropped} over ${totals.buildingsWithDroppedHoles} buildings`,
    `  grammar maxima        floors ${totals.maximumFloorCount} / bays ${totals.maximumBayCount} / placements ${totals.maximumPlacementCount} (zero caps reached)`,
    `  structural bytes      ${packagePlan.estimatedTotalBytes} (${(packagePlan.estimatedTotalBytes / 1024 ** 3).toFixed(3)} GiB) -- GATES`,
    `  pilot cross-check     ${packagePlan.pilotCrossCheckTotalBytes} (${(packagePlan.pilotCrossCheckTotalBytes / 1024 ** 3).toFixed(3)} GiB) -- non-gating label only`,
    "  budget table",
    ...budgetTable.checks.map((entry) => `    ${entry.ok ? "PASS" : "FAIL"}  ${entry.id.padEnd(20)} ${String(entry.observed).padStart(12)} / ${String(entry.limit).padStart(12)}  headroom ${(entry.headroomPartsPerMillion / 10_000).toFixed(2)}%`),
    `  reconciliation        ${JSON.stringify(reconciliation.counts)}`,
    "  cross-checks",
    ...checks.map((entry) => `    PASS  ${entry.label}`),
    `  files written         ${files.size} (removed ${stale.length} stale)`,
    `  wall clock            ${wallClockSeconds}s   peak RSS ${(peakRssBytes / 1024 ** 2).toFixed(0)} MiB`,
  ];
  globalThis.process.stdout.write(`${lines.join("\n")}\n`);
}

try {
  await run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const report = await writeStopReport(message);
  globalThis.process.stdout.write(`T012 dry run FAILED CLOSED before wave materialization.\n  ${message}\n  stop report: ${report}\n`);
  globalThis.process.exitCode = 1;
}
