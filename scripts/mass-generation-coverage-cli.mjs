/* global console, process */
/**
 * The T004 STAGE-4 COVERAGE RECORD.
 *
 * One table over the six retention waves, machine-checked against the immutable
 * ownership ledger rather than against the wave records that produced it. Its
 * central claim — shipped + tombstoned = 45,194 — is recomputed here from the
 * ledger's own cell membership, so a census that drifted could not make this
 * record agree with it.
 *
 * `recovered` is measured, not carried forward: every owned parent is planned
 * AGAIN under the SHIPPED admission envelope, and a building the retention wave
 * generated while the shipped grammar refuses is a recovery. That is the only
 * way to state per-wave recoveries, since T003's 694 is an island total.
 *
 * It changes nothing. No serving surface, no pinned release id, no promoted
 * default, and no approved release's bytes.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readdir } from "node:fs/promises";

import { sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256, EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID } from "../src/domain/exterior-fullsnapshot-input.ts";
import { V3_FROZEN_WAVE_ADMISSION_ENVELOPE, MidtownCoreV3Stop, buildMidtownCoreV3Plan } from "../src/release/midtown-core-v3-materialization.ts";
import { verifyCitywideSnapshot } from "../src/release/citywide-snapshot-gate.ts";
import { EXTERIOR_WAVE_LEDGER_RELEASE_ID, exteriorArtifactChecksum, validateExteriorWaveLedger } from "../src/release/exterior-wave-ledger.ts";
import { collectMidtownCoreSources } from "../src/release/midtown-core-source.ts";
import { massGenerationSuccessorProfile } from "../src/release/mass-generation-retention.ts";
import { WAVE_BASE_PROFILES, WAVE_OWNED_PARENTS } from "./mass-generation-wave-cli.mjs";
import { isSafeReleaseArtifactReference } from "../src/runtime/path-security.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotRoot = join(repositoryRoot, "public", "data", EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID);
const ledgerRoot = join(repositoryRoot, "data", "normalized", EXTERIOR_WAVE_LEDGER_RELEASE_ID);

export const RECORD_ID = "mass-generation-20260816";
export const COVERAGE_PATH = join(repositoryRoot, "data", RECORD_ID, "coverage.json");

/** The ledger's own owned-parent total; the record's arithmetic must reproduce it. */
export const ISLAND_OWNED_PARENTS = 45_194;

function fail(message) { console.error(`STOP: ${message}`); process.exit(1); }
function serialize(value) { return `${JSON.stringify(value, null, 2)}\n`; }
const waveOf = (cellId) => /^manhattan-exterior-cell-(w\d{2})-/u.exec(cellId)[1];

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
  if (!gate.ok) fail(`${gate.message}\n\nThe coverage record cannot be built against an unverified base.`);
  const manifest = JSON.parse(await readFile(join(snapshotRoot, "manifest.json"), "utf8"));
  const shards = [];
  for (const shard of manifest.geometryShards.filter((entry) => entry.layer === "buildings")) {
    if (!isSafeReleaseArtifactReference(shard.relativeContentRef)) fail(`Shard reference ${shard.relativeContentRef} is not canonical.`);
    const text = await readFile(join(snapshotRoot, shard.relativeContentRef), "utf8");
    if (sha256HexSync(text) !== shard.checksumSha256) fail(`Shard ${shard.relativeContentRef} does not match its declared checksum.`);
    shards.push(JSON.parse(text));
  }
  return shards;
}

async function loadLedger() {
  const ledger = JSON.parse(await readFile(join(ledgerRoot, "ledger.json"), "utf8"));
  const checksum = exteriorArtifactChecksum(ledger);
  const recorded = (await readFile(join(ledgerRoot, "ledger.sha256"), "utf8")).trim().split(/\s+/u)[0];
  if (recorded !== checksum) fail(`Committed ledger checksum ${checksum} does not match its recorded ${recorded}.`);
  if (!validateExteriorWaveLedger(ledger).ok) fail("Committed ledger fails its own schema.");
  return { ledger, ledgerChecksumSha256: checksum };
}

/** True when the SHIPPED grammar refuses this sourced polygon at plan stage. */
function shippedGrammarRefuses(source) {
  try {
    buildMidtownCoreV3Plan(source, EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256, undefined, V3_FROZEN_WAVE_ADMISSION_ENVELOPE);
    return false;
  } catch (error) {
    if (!(error instanceof MidtownCoreV3Stop)) throw error;
    return true;
  }
}

async function main() {
  const started = Date.now();
  const shards = await loadSources();
  const { ledger, ledgerChecksumSha256 } = await loadLedger();

  const ownedByWave = new Map();
  for (const cell of ledger.cells) {
    const wave = waveOf(cell.cellId);
    if (!ownedByWave.has(wave)) ownedByWave.set(wave, []);
    ownedByWave.get(wave).push(...cell.buildingIds);
  }
  const islandOwned = [...ownedByWave.values()].reduce((total, ids) => total + ids.length, 0);
  if (islandOwned !== ISLAND_OWNED_PARENTS) fail(`ledger yields ${islandOwned} owned parents, expected ${ISLAND_OWNED_PARENTS}.`);

  const sources = collectMidtownCoreSources(shards, new Set([...ownedByWave.values()].flat()));

  const rows = [];
  const tombstoneCategories = {};
  let islandGenerated = 0;
  let islandTombstoned = 0;
  let islandRecovered = 0;
  let islandFallbacks = 0;
  let islandBytes = 0;

  for (const waveId of Object.keys(WAVE_BASE_PROFILES)) {
    const releaseId = massGenerationSuccessorProfile(WAVE_BASE_PROFILES[waveId]).releaseId;
    const recordRoot = join(repositoryRoot, "data", releaseId);
    const censusText = await readFile(join(recordRoot, "wave-census.json"), "utf8");
    const inventoryText = await readFile(join(recordRoot, "payload-inventory.json"), "utf8");
    const replayText = await readFile(join(recordRoot, "determinism-replay.json"), "utf8");
    const validationText = await readFile(join(recordRoot, "retention-validation.json"), "utf8");
    const census = JSON.parse(censusText);
    const inventory = JSON.parse(inventoryText);
    const replay = JSON.parse(replayText);
    const validation = JSON.parse(validationText);

    const owned = ownedByWave.get(waveId) ?? [];
    if (owned.length !== WAVE_OWNED_PARENTS[waveId]) fail(`wave ${waveId} owns ${owned.length}, expected ${WAVE_OWNED_PARENTS[waveId]}.`);
    if (census.ownedBuildingCount !== owned.length) fail(`wave ${waveId} census claims ${census.ownedBuildingCount} owned against the ledger's ${owned.length}.`);
    if (census.generatedBuildingCount + census.tombstonedBuildingCount !== owned.length) {
      fail(`wave ${waveId} census does not account for itself.`);
    }
    // The validator's output must describe THIS wave, completely.
    if (validation.releaseId !== releaseId) fail(`wave ${waveId} validation names ${validation.releaseId}.`);
    if (validation.ok !== true) fail(`wave ${waveId} validation is not green.`);
    if (validation.validatedCellCount !== validation.declaredCellCount) fail(`wave ${waveId} validated ${validation.validatedCellCount} of ${validation.declaredCellCount} manifests.`);
    if (validation.declaredCellCount !== inventory.cellManifestCount) fail(`wave ${waveId} validation walked ${validation.declaredCellCount} manifests against the inventory's ${inventory.cellManifestCount}.`);
    if (validation.silhouetteRecords !== census.generatedBuildingCount) fail(`wave ${waveId} carries ${validation.silhouetteRecords} silhouette records for ${census.generatedBuildingCount} generated buildings.`);
    if (validation.lod1FallbackCount !== census.lod1FallbackCount) fail(`wave ${waveId} validation counts ${validation.lod1FallbackCount} fallbacks against the census's ${census.lod1FallbackCount}.`);
    if (validation.packagedBuildingCount !== census.generatedBuildingCount) fail(`wave ${waveId} packaged ${validation.packagedBuildingCount} against ${census.generatedBuildingCount} generated.`);

    // RECOVERED, measured: generated by the retention wave AND refused by the
    // shipped grammar. The tombstoned set is excluded because a building that
    // shipped nothing was not recovered by anything.
    const tombstonedIds = new Set(census.tombstones.map((entry) => entry.buildingId));
    let recovered = 0;
    for (const buildingId of owned) {
      if (tombstonedIds.has(buildingId)) continue;
      const source = sources.get(buildingId);
      if (!source) fail(`wave ${waveId} owns ${buildingId}, which the verified snapshot does not carry.`);
      if (shippedGrammarRefuses(source)) recovered += 1;
    }

    for (const [code, count] of Object.entries(census.aggregate.refusalsByCode)) {
      tombstoneCategories[code] = (tombstoneCategories[code] ?? 0) + count;
    }

    rows.push({
      waveId,
      predecessorReleaseId: census.predecessorReleaseId,
      c1ReleaseId: releaseId,
      owned: owned.length,
      materialized: census.generatedBuildingCount,
      recovered,
      tombstoned: census.tombstonedBuildingCount,
      lod1FallbackCount: census.lod1FallbackCount,
      cellManifestCount: inventory.cellManifestCount,
      payloadFileCount: inventory.totals.fileCount,
      payloadByteSize: inventory.totals.byteSize,
      retentionRootChecksumSha256: inventory.retentionRoot.rootChecksumSha256,
      payloadInventorySha256: sha256HexSync(inventoryText),
      waveCensusSha256: sha256HexSync(censusText),
      determinismReplay: { compared: replay.comparedGlbCount, byteIdentical: replay.byteIdenticalCount, cellsSampled: replay.cellsSampled },
      determinismReplaySha256: sha256HexSync(replayText),
      // The VALIDATOR's own committed output, folded in so the coverage table
      // states what was checked rather than only what was generated.
      validation: {
        declaredCellCount: validation.declaredCellCount,
        validatedCellCount: validation.validatedCellCount,
        silhouetteRecords: validation.silhouetteRecords,
        lod1FallbackCount: validation.lod1FallbackCount,
        packagedBuildingCount: validation.packagedBuildingCount,
        completenessSources: validation.completenessSources,
        textureAdmissionPolicy: validation.textureAdmission.policy,
      },
      retentionValidationSha256: sha256HexSync(validationText),
      blenderAgreement: census.blenderAgreement.status,
    });
    islandGenerated += census.generatedBuildingCount;
    islandTombstoned += census.tombstonedBuildingCount;
    islandRecovered += recovered;
    islandFallbacks += census.lod1FallbackCount;
    islandBytes += inventory.totals.byteSize;
  }

  if (islandGenerated + islandTombstoned !== ISLAND_OWNED_PARENTS) {
    fail(`island does not close: ${islandGenerated} + ${islandTombstoned} != ${ISLAND_OWNED_PARENTS}.`);
  }
  const categoryTotal = Object.values(tombstoneCategories).reduce((total, count) => total + count, 0);
  if (categoryTotal !== islandTombstoned) fail(`per-category tombstones total ${categoryTotal} against ${islandTombstoned} tombstoned.`);

  const record = {
    schemaVersion: "1.0",
    recordId: RECORD_ID,
    taskId: "T004",
    artifact: "stage4-coverage",
    note: "The six retention waves in one table, checked against the IMMUTABLE ownership ledger rather than against the censuses that produced it. `recovered` is re-measured here by planning every owned parent again under the SHIPPED admission envelope; a building the retention wave generated and the shipped grammar refuses is a recovery. Passing this record is a statement about deterministic counts and bytes, and is NOT visual, geographic, architectural or performance acceptance.",
    ledger: { releaseId: EXTERIOR_WAVE_LEDGER_RELEASE_ID, checksumSha256: ledgerChecksumSha256, ownedParents: islandOwned },
    base: { releaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID, manifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256 },
    waves: rows,
    island: {
      owned: ISLAND_OWNED_PARENTS,
      materialized: islandGenerated,
      recovered: islandRecovered,
      tombstoned: islandTombstoned,
      lod1FallbackCount: islandFallbacks,
      payloadByteSize: islandBytes,
      shippedPlusTombstonedEqualsOwned: islandGenerated + islandTombstoned === ISLAND_OWNED_PARENTS,
    },
    tombstoneCategories,
    lod1: {
      policy: "measured-fallback",
      note: "ADR 0050. A building whose MEASURED silhouette deviation is outside the assembly schema's 2% cap emits FULL GEOMETRY at LOD 1, declares a derived geometric error of 0 because it dropped nothing, and marks that level INELIGIBLE so the runtime never selects a fake-coarse representation. The cap is not relaxed and no coarse level above it exists in any wave.",
      islandFallbackCount: islandFallbacks,
    },
    rights: {
      statement: "The six -c1 packages RETAIN bytes LOCALLY ONLY, under gitignored payload directories. Nothing is conveyed, redistributed or published. No external data was acquired and no retained snapshot was replaced. No approval envelope is widened: every committed release keeps its approval scope, licensing and retention terms exactly as they were.",
      servingSurfaceChange: "none",
      pinnedReleaseIdChange: "none",
      promotedDefaultChange: "none",
      runtimeRollbackSurface: "zero",
      conveyance: "none",
    },
    payloadRetentionHold: {
      status: "HOLD",
      directories: "public/data/*-c1 (six, gitignored)",
      approximateBytes: 6_400_000_000,
      reason: "The per-wave 16-sample BLENDER AGREEMENT has not run — Blender MCP was disconnected for the whole of this task. Those samples must be taken from the SAME bytes these records pin. Deleting these payload directories therefore costs a full island regeneration before the agreement can be run at all, and the regenerated bytes would need re-validating before they could carry it.",
      releaseCondition: "Release the hold only after the per-wave Blender agreement has run, or after an explicit decision that it will not be run.",
    },
    notClaimedHere: [
      "Any visual, geographic, architectural, accessibility or performance acceptance.",
      "The per-wave 16-sample Blender agreement, which is a separate evidence item and is PENDING CONNECTION for all six waves.",
      "Cache-ceiling and streaming benchmarks against a two-LOD population, which belong to T005/T006.",
    ],
  };

  await mkdir(dirname(COVERAGE_PATH), { recursive: true });
  await writeFile(COVERAGE_PATH, serialize(record));
  await writeFile(COVERAGE_PATH.replace(/\.json$/u, ".sha256"), `${sha256HexSync(serialize(record))}  coverage.json\n`);
  // Host timing is REPORTED and never HASHED: a wall-clock number inside the
  // record would make a byte-identical re-run impossible on a different machine,
  // which is exactly the property the sidecar is supposed to give a reader.
  console.log(serialize({ ok: true, island: record.island, tombstoneCategories, elapsedSeconds: Math.round((Date.now() - started) / 1000) }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exit(1); });
}
