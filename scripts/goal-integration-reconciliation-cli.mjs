#!/usr/bin/env node
/* global console, process */
/**
 * GOAL-LEVEL COVERAGE RECONCILIATION for the Manhattan high-fidelity exteriors
 * Goal (T024). LOCAL ONLY. Reads committed bytes; acquires nothing; publishes
 * nothing; renders nothing.
 *
 * WHAT THIS COMPUTES, from the committed ledger and the six committed wave
 * censuses rather than from prose:
 *
 *   (1) CELL CLOSURE. Every cell the immutable ledger declares is assigned to
 *       exactly one wave, and the six waves' declared cell counts sum to the
 *       ledger's. Missing cells and duplicate cells are counted, not assumed.
 *   (2) PARENT CLOSURE. Every canonical building id in the ledger's 883 cells
 *       appears exactly once. Missing accepted parents and duplicate canonical
 *       owners are counted from the id multiset itself.
 *   (3) REFUSAL CLOSURE. Every owned building of every wave is either
 *       materialized or refused under a stop code drawn from the closed
 *       vocabulary, and each wave's stop-code distribution sums to its own
 *       refusal count. An owned building accounted for by neither is an
 *       UNCLASSIFIED building and is reported as such.
 *   (4) STYLE-CLASS CLOSURE. Each wave's style-class distribution sums to its
 *       materialized count, so no materialized building ships without a
 *       machine-readable class. The metric is named `buildingsWithoutStyleClass`
 *       rather than "unclassified components" because that is what it counts:
 *       BUILDINGS missing a class, not components. Goal criterion 12's
 *       component-class half is carried by criterion 15's contract — a component
 *       outside the closed generated / evidence-backed / absent / not-applicable
 *       vocabulary makes the release THROW rather than ship an unclassified
 *       component for a census to count later. A census cannot count what
 *       cannot exist, and this metric does not pretend to.
 *   (5) PROMOTED DEFAULT COVERAGE. The six default activation records'
 *       renderable memberships, the shipped GLB artifact count, and the
 *       resulting exterior cache occupancy against the 512-entry contract.
 *
 * WHAT IT DOES NOT COMPUTE. It is arithmetic over committed records. It proves
 * no visual, geographic, architectural or performance claim, and it does not
 * re-measure anything a browser or Blender measured. Those live in each wave's
 * own committed evidence record and are cited, never restated as findings here.
 *
 * The `--check` mode recomputes and compares against the committed
 * `data/goal-integration-acceptance-20260812/reconciliation.json`, so the record
 * cannot drift from the ledgers it summarizes.
 *
 * RUNTIME. This script imports `.ts` modules directly and relies on Node's
 * native type stripping, so it requires **Node >= 24** and takes no
 * `--experimental-strip-types` flag. That is the convention of the newer
 * scripts here (`public-showcase-audit-cli.mjs`, `northern-manhattan-cli.mjs`);
 * the older `--experimental-strip-types` aliases in `package.json` predate it
 * and are deliberately not disturbed. On Node 22 this script fails to load
 * rather than producing a partial reconciliation.
 *
 * Usage:
 *   pnpm goal:reconcile
 *   pnpm goal:reconcile -- --check
 *   node scripts/goal-integration-reconciliation-cli.mjs [--check] [--out <path>]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { EXTERIOR_WAVE_PLAN } from "../src/release/exterior-wave-ledger.ts";
import { MIDTOWN_CORE_V3_STOP_CODES } from "../src/release/midtown-core-v3-materialization.ts";
import { EXTERIOR_RUNTIME_BUDGETS } from "../src/runtime/exterior-cell-runtime.ts";
import { exteriorDefaultActivations } from "../src/runtime/exterior-default-activation.ts";

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ledgerRoot = join(repositoryRoot, "data", "normalized", "manhattan-exterior-wave-ledger-20260804");
export const RECONCILIATION_RECORD_PATH = join(repositoryRoot, "data", "goal-integration-acceptance-20260812", "reconciliation.json");

/**
 * The census that speaks for each wave. Block 835 predates the wave-census
 * schema: it is a fourteen-building authored package whose census enumerates
 * buildings individually, so it is read through its own shape rather than
 * reshaped into a wave census it never had.
 */
export const WAVE_CENSUS_SOURCES = [
  { waveId: "block-835", kind: "package-census", path: "data/manhattan-esb-block-reference-20260811-v3t/census.json" },
  { waveId: "midtown-core", kind: "wave-census", path: "data/midtown-core-20260811-v3/v3-census.json" },
  { waveId: "lower-manhattan", kind: "wave-census", path: "data/lower-manhattan-20260812-p1/wave-census.json" },
  { waveId: "southern-remainder", kind: "wave-census", path: "data/southern-remainder-20260812-p1/wave-census.json" },
  { waveId: "central-upper-manhattan", kind: "wave-census", path: "data/central-upper-manhattan-20260812-p1/wave-census.json" },
  { waveId: "northern-manhattan", kind: "wave-census", path: "data/northern-manhattan-20260812-p1/wave-census.json" },
];

/** The promoted payload inventory each wave's default record ships from. */
export const PROMOTED_PAYLOAD_INVENTORIES = [
  { waveId: "midtown-core", path: "data/midtown-core-20260811-v3/payload-inventory.json" },
  { waveId: "lower-manhattan", path: "data/lower-manhattan-20260812-p1/payload-inventory.json" },
  { waveId: "southern-remainder", path: "data/southern-remainder-20260812-p1/payload-inventory.json" },
  { waveId: "central-upper-manhattan", path: "data/central-upper-manhattan-20260812-p1/payload-inventory.json" },
  { waveId: "northern-manhattan", path: "data/northern-manhattan-20260812-p1/payload-inventory.json" },
];

/**
 * Block 835 ships both canonical levels of detail for each of its fourteen
 * buildings, so its CACHE ENTRY count is twice its building count. Every other
 * promoted wave ships one artifact per available building. Keeping the two
 * quantities apart is the whole reason 484 and 498 are different numbers.
 */
const BLOCK835_LODS_PER_BUILDING = 2;

function readJson(relativeOrAbsolute) {
  const path = relativeOrAbsolute.startsWith("/") ? relativeOrAbsolute : join(repositoryRoot, relativeOrAbsolute);
  return JSON.parse(readFileSync(path, "utf8"));
}

function tally(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function sumValues(record) {
  return Object.values(record ?? {}).reduce((total, value) => total + value, 0);
}

/** (1) and (2): cell and canonical-parent closure, computed from the ledger itself. */
export function computeLedgerClosure() {
  const ledger = readJson(join(ledgerRoot, "ledger.json"));
  const digest = readJson(join(ledgerRoot, "membership-digest.json"));
  const committedReport = readJson(join(ledgerRoot, "reconciliation-report.json"));

  const cellIdCounts = tally(ledger.cells.map((cell) => cell.cellId));
  const duplicateCellIds = [...cellIdCounts].filter(([, count]) => count > 1).map(([cellId]) => cellId);

  const digestCellById = new Map(digest.cells.map((cell) => [cell.cellId, cell]));
  const cellsWithoutWave = ledger.cells.filter((cell) => !digestCellById.has(cell.cellId)).map((cell) => cell.cellId);
  const digestCellsWithoutLedgerCell = digest.cells.filter((cell) => !cellIdCounts.has(cell.cellId)).map((cell) => cell.cellId);

  const buildingIds = ledger.cells.flatMap((cell) => cell.buildingIds);
  const buildingIdCounts = tally(buildingIds);
  const duplicateOwners = [...buildingIdCounts].filter(([, count]) => count > 1).map(([buildingId, count]) => ({ buildingId, owners: count }));

  const declaredWaveCells = new Map(EXTERIOR_WAVE_PLAN.map((wave) => [wave.waveId, wave]));
  const observedByWave = new Map();
  for (const cell of digest.cells) {
    const seen = observedByWave.get(cell.waveId) ?? { cells: 0, buildings: 0 };
    seen.cells += 1;
    seen.buildings += cell.buildingCount;
    observedByWave.set(cell.waveId, seen);
  }
  const waves = [...declaredWaveCells.values()].map((wave) => {
    const observed = observedByWave.get(wave.waveId) ?? { cells: 0, buildings: 0 };
    const declared = digest.waves.find((entry) => entry.waveId === wave.waveId);
    return {
      waveIndex: wave.waveIndex,
      waveId: wave.waveId,
      declaredCellCount: declared?.cellCount ?? null,
      declaredBuildingCount: declared?.buildingCount ?? null,
      observedCellCount: observed.cells,
      observedBuildingCount: observed.buildings,
      agrees: declared?.cellCount === observed.cells && declared?.buildingCount === observed.buildings,
    };
  });

  return {
    ledgerId: ledger.ledgerId,
    ledgerChecksumSha256: committedReport.ledgerChecksumSha256,
    baseIdentitySetId: ledger.baseIdentitySet.id,
    baseIdentitySetChecksumSha256: ledger.baseIdentitySet.checksumSha256,
    declaredBaseBuildingCount: ledger.baseIdentitySet.buildingCount,
    declaredCellCount: ledger.cells.length,
    observedCellCount: cellIdCounts.size,
    missingCells: [...cellsWithoutWave, ...digestCellsWithoutLedgerCell].length,
    duplicateCells: duplicateCellIds.length,
    observedBuildingIdCount: buildingIds.length,
    distinctBuildingIdCount: buildingIdCounts.size,
    missingAcceptedParents: ledger.baseIdentitySet.buildingCount - buildingIdCounts.size,
    duplicateCanonicalOwners: duplicateOwners.length,
    waves,
    waveCellSum: waves.reduce((total, wave) => total + wave.observedCellCount, 0),
    waveBuildingSum: waves.reduce((total, wave) => total + wave.observedBuildingCount, 0),
    committedReport: {
      observedBuildingCount: committedReport.observedBuildingCount,
      ownedBuildingCount: committedReport.ownedBuildingCount,
      cellCount: committedReport.cellCount,
      counts: committedReport.counts,
      ok: committedReport.ok,
    },
  };
}

/** (3) and (4): refusal and component-class closure, computed from the six censuses. */
export function computeCensusClosure() {
  const closedStopCodes = new Set(MIDTOWN_CORE_V3_STOP_CODES);
  const waves = WAVE_CENSUS_SOURCES.map((source) => {
    const census = readJson(source.path);
    if (source.kind === "package-census") {
      const buildings = census.buildings;
      const styleCounts = Object.fromEntries(tally(buildings.map((building) => building.styleClass)));
      return {
        waveId: source.waveId,
        censusPath: source.path,
        ownedBuildingCount: buildings.length,
        materializedBuildingCount: buildings.length,
        refusedBuildingCount: 0,
        refusalsByCode: {},
        refusalCodeSum: 0,
        unknownStopCodes: [],
        styleClassCounts: styleCounts,
        styleClassSum: sumValues(styleCounts),
        buildingsWithoutStyleClass: buildings.length - sumValues(styleCounts),
        unaccountedOwnedCount: 0,
      };
    }
    const wave = census.wave;
    const refusalsByCode = wave.refusalsByCode ?? {};
    const styleClassCounts = wave.styleClassCounts ?? {};
    return {
      waveId: source.waveId,
      censusPath: source.path,
      ownedBuildingCount: wave.resolvedBuildingCount,
      materializedBuildingCount: wave.materializedBuildingCount,
      refusedBuildingCount: wave.refusedBuildingCount,
      refusalsByCode,
      refusalCodeSum: sumValues(refusalsByCode),
      unknownStopCodes: Object.keys(refusalsByCode).filter((code) => !closedStopCodes.has(code)),
      styleClassCounts,
      styleClassSum: sumValues(styleClassCounts),
      buildingsWithoutStyleClass: wave.materializedBuildingCount - sumValues(styleClassCounts),
      unaccountedOwnedCount: wave.resolvedBuildingCount - wave.materializedBuildingCount - wave.refusedBuildingCount,
    };
  });

  const observedStopCodes = [...new Set(waves.flatMap((wave) => Object.keys(wave.refusalsByCode)))].sort();
  const refusalsByCode = {};
  for (const code of observedStopCodes) {
    refusalsByCode[code] = waves.reduce((total, wave) => total + (wave.refusalsByCode[code] ?? 0), 0);
  }

  return {
    waves,
    closedStopCodeVocabulary: [...MIDTOWN_CORE_V3_STOP_CODES],
    observedStopCodes,
    refusalsByCode,
    ownedBuildingCount: waves.reduce((total, wave) => total + wave.ownedBuildingCount, 0),
    materializedBuildingCount: waves.reduce((total, wave) => total + wave.materializedBuildingCount, 0),
    refusedBuildingCount: waves.reduce((total, wave) => total + wave.refusedBuildingCount, 0),
    unaccountedOwnedCount: waves.reduce((total, wave) => total + wave.unaccountedOwnedCount, 0),
    buildingsWithoutStyleClass: waves.reduce((total, wave) => total + wave.buildingsWithoutStyleClass, 0),
    unknownStopCodeCount: waves.reduce((total, wave) => total + wave.unknownStopCodes.length, 0),
  };
}

/**
 * (5): what the six default activation records actually put on screen.
 *
 * The activation set is a PARAMETER, defaulting to what this build ships.
 *
 * It became one when T005 promoted six `-s1` serving releases over the six
 * curated ones this Goal's committed reconciliation describes. That record is a
 * completion artifact and is not regenerated to follow a later promotion, so a
 * bare recompute stopped equalling it — and the choice was either to freeze the
 * comparison against the record's own numbers, losing the drift check entirely,
 * or to let a caller name the composition it is asking about. This is the second.
 *
 * `goal-integration-reconciliation.test.mjs` passes the CURATED set, read off the
 * live promotion records' predecessor chain rather than hand-typed, and gets the
 * committed record back field for field. So a curated record edited underneath
 * the promotion still fails the gate, which is the property the split form gave
 * up. The runtime BUDGET fields below are read from the live build and are the
 * one part that legitimately moved with the promotion; the test names those two
 * rather than absorbing them.
 */
export function computePromotedCoverage(activations = exteriorDefaultActivations()) {
  const inventoryByWave = new Map(PROMOTED_PAYLOAD_INVENTORIES.map((entry) => [entry.waveId, readJson(entry.path)]));

  const releases = activations.map((activation) => {
    if (!activation.enabled) throw new Error(`Promoted coverage read a DISABLED activation record; the six-wave default set is not what this build ships.`);
    const waveId = WAVE_CENSUS_SOURCES.find((source) => activation.releaseId.includes(source.waveId))?.waveId
      ?? (activation.releaseId === "manhattan-exterior-cells-20260811-v3" ? "block-835" : null);
    const inventory = waveId ? inventoryByWave.get(waveId) : undefined;
    const buildingCount = activation.membership.buildingIds.length;
    const shippedAssetCount = inventory ? inventory.stats.shippedAssetCount : buildingCount * BLOCK835_LODS_PER_BUILDING;
    return {
      waveId,
      releaseId: activation.releaseId,
      approvalRef: activation.approvalRef,
      predecessorReleaseId: activation.predecessor.enabled ? activation.predecessor.releaseId : null,
      predecessorEnabled: activation.predecessor.enabled,
      predecessorIsBaseMassing: !activation.predecessor.enabled,
      declaredCellCount: activation.membership.cellCount,
      renderableCellCount: inventory ? inventory.stats.renderableCellCount : 1,
      notShippedCellCount: inventory ? inventory.stats.notShippedCellCount : 0,
      promotedBuildingCount: buildingCount,
      shippedAssetCount,
    };
  });

  const promotedBuildingCount = releases.reduce((total, release) => total + release.promotedBuildingCount, 0);
  const shippedAssetCount = releases.reduce((total, release) => total + release.shippedAssetCount, 0);
  const renderableCellCount = releases.reduce((total, release) => total + release.renderableCellCount, 0);
  const declaredCellCount = releases.reduce((total, release) => total + release.declaredCellCount, 0);
  const distinctPromotedBuildingIds = new Set(activations.flatMap((activation) => (activation.enabled ? activation.membership.buildingIds : [])));

  return {
    promotedWaveCount: releases.length,
    releases,
    promotedBuildingCount,
    distinctPromotedBuildingCount: distinctPromotedBuildingIds.size,
    shippedAssetCount,
    renderableCellCount,
    tombstonedCellCount: declaredCellCount - renderableCellCount,
    declaredCellCount,
    maxCacheEntries: EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries,
    maxCachedBytes: EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes,
    maxConcurrentRequests: EXTERIOR_RUNTIME_BUDGETS.maxConcurrentRequests,
    cacheEntryHeadroom: EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries - shippedAssetCount,
  };
}

/**
 * The zero-violation claim of Goal criterion 12, stated as five separate counts
 * so that a single non-zero cannot hide behind an aggregate boolean.
 */
export function computeCoverageReconciliation(activations = exteriorDefaultActivations()) {
  const ledger = computeLedgerClosure();
  const census = computeCensusClosure();
  const promoted = computePromotedCoverage(activations);

  const violations = {
    missingSpatialCells: ledger.missingCells,
    missingAcceptedBuildingParents: ledger.missingAcceptedParents,
    duplicateCanonicalOwners: ledger.duplicateCanonicalOwners,
    buildingsWithoutStyleClass: census.buildingsWithoutStyleClass,
    ownedBuildingsAccountedByNeither: census.unaccountedOwnedCount,
    stopCodesOutsideClosedVocabulary: census.unknownStopCodeCount,
    censusOwnedVersusLedgerOwned: census.ownedBuildingCount - ledger.observedBuildingIdCount,
    waveCellSumVersusLedgerCells: ledger.waveCellSum - ledger.declaredCellCount,
  };

  return {
    ledger,
    census,
    promoted,
    violations,
    allZero: Object.values(violations).every((value) => value === 0),
    refusalRatePercent: Number(((census.refusedBuildingCount / census.ownedBuildingCount) * 100).toFixed(4)),
    promotedSharePercent: Number(((promoted.promotedBuildingCount / ledger.declaredBaseBuildingCount) * 100).toFixed(4)),
  };
}

function stableStringify(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function runCli(argv) {
  const outIndex = argv.indexOf("--out");
  const outPath = outIndex >= 0 ? resolve(argv[outIndex + 1]) : RECONCILIATION_RECORD_PATH;
  const check = argv.includes("--check");
  const computed = computeCoverageReconciliation();

  if (check) {
    const committed = readJson(outPath);
    const drift = stableStringify(computed) !== stableStringify(committed.coverage);
    const result = { ok: !drift && computed.allZero, checkedPath: outPath, drift, allZero: computed.allZero, violations: computed.violations };
    console.log(stableStringify(result));
    return result.ok ? 0 : 1;
  }

  mkdirSync(dirname(outPath), { recursive: true });
  const existing = (() => {
    try { return readJson(outPath); } catch { return null; }
  })();
  const record = { ...(existing ?? {}), coverage: computed };
  writeFileSync(outPath, stableStringify(record), "utf8");
  console.log(stableStringify({ ok: computed.allZero, outPath, violations: computed.violations, promoted: { buildings: computed.promoted.promotedBuildingCount, assets: computed.promoted.shippedAssetCount, of: computed.ledger.declaredBaseBuildingCount } }));
  return computed.allZero ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = runCli(process.argv.slice(2));
}
