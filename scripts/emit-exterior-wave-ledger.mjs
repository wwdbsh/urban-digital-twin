// Emits the immutable Manhattan exterior wave ledger and its sibling artifacts
// from the local, gitignored `manhattan-citywide-20260804` snapshot.
//
// The ledger is derived from the frozen shard grouping of that snapshot; this
// script computes no geometry and changes nothing under public/data. Output is
// committed under data/normalized/ (not public/data) because nothing fetches
// the ledger at runtime, matching the 0023 browser-root boundary.
//
// The emit is deterministic: a second run rewrites byte-identical files.
//
// Usage: pnpm exterior-ledger:emit
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { OTI_RAW_SHA256 } from "../src/domain/commercial-frontage.ts";
import { isSafeReleaseArtifactReference } from "../src/runtime/path-security.ts";
import { sha256HexSync } from "../src/release/catalog-release.ts";
import {
  EXTERIOR_CELL_MAX_BUILDINGS,
  cellTileKey,
  EXTERIOR_WAVE_BASE_BUILDING_COUNT,
  EXTERIOR_WAVE_BASE_RELEASE_ID,
  EXTERIOR_WAVE_LEDGER_RELEASE_ID,
  EXTERIOR_WAVE_TILE_LEVEL,
  buildExteriorWaveLedger,
  exteriorArtifactChecksum,
  serializeExteriorArtifact,
  validateExteriorLedgerEligibility,
  validateExteriorWaveLedger,
  validateExteriorWaveLedgerDigest,
} from "../src/release/exterior-wave-ledger.ts";
import { reconcileExteriorWaveLedger } from "../src/release/exterior-wave-reconciliation.ts";
import { tileKeyForCoordinate, tileKeyString } from "../src/runtime/spatial.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotRoot = join(repositoryRoot, "public", "data", EXTERIOR_WAVE_BASE_RELEASE_ID);
const outputRoot = join(repositoryRoot, "data", "normalized", EXTERIOR_WAVE_LEDGER_RELEASE_ID);

const checks = [];
function check(label, passed, detail) {
  checks.push({ label, passed, detail });
  if (!passed) throw new Error(`Cross-check failed: ${label} (${detail}).`);
}

if (!existsSync(snapshotRoot)) {
  throw new Error(`Local citywide snapshot ${snapshotRoot} is absent. This script never acquires data; publish the approved local release first.`);
}

// --- Base snapshot: manifest identity -------------------------------------
const manifestPath = join(snapshotRoot, "manifest.json");
const manifestText = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(manifestText);
const recordedChecksum = (await readFile(join(snapshotRoot, "manifest.sha256"), "utf8")).trim().split(/\s+/u)[0];
const manifestChecksum = sha256HexSync(manifestText);
check("citywide manifest checksum matches its recorded manifest.sha256", recordedChecksum === manifestChecksum, `${recordedChecksum} vs ${manifestChecksum}`);
check("base release id is the approved snapshot", manifest.releaseId === EXTERIOR_WAVE_BASE_RELEASE_ID, manifest.releaseId);
check("base snapshot is not fixture-only", manifest.fixtureOnly === false, String(manifest.fixtureOnly));

const buildingLayer = manifest.layers.find((layer) => layer.id === "buildings");
const otiSnapshot = manifest.sourceSnapshots.find((snapshot) => snapshot.registryEntryId === "nyc.building-footprints");
check("OTI raw snapshot checksum matches the accepted domain constant", otiSnapshot?.rawChecksumSha256 === OTI_RAW_SHA256, String(otiSnapshot?.rawChecksumSha256));
check("building layer tile level is 14", buildingLayer?.tileLevel === EXTERIOR_WAVE_TILE_LEVEL, String(buildingLayer?.tileLevel));
check(
  "manifest counts agree on the accepted building total",
  buildingLayer?.parentCount === EXTERIOR_WAVE_BASE_BUILDING_COUNT
    && buildingLayer?.renderPartCount === EXTERIOR_WAVE_BASE_BUILDING_COUNT
    && manifest.coverage.acceptedBuildingCount === EXTERIOR_WAVE_BASE_BUILDING_COUNT
    && manifest.coverage.candidateBuildingCount === EXTERIOR_WAVE_BASE_BUILDING_COUNT
    && manifest.coverage.unresolvedBuildingCount === 0,
  `${buildingLayer?.parentCount}/${buildingLayer?.renderPartCount}/${manifest.coverage.acceptedBuildingCount}`,
);

// --- Base snapshot: frozen shard grouping ---------------------------------
// Every shard is read through its manifest-declared `relativeContentRef` and
// verified against the declared checksum and byte size before a single id is
// trusted. The immutable ledger is derived from these bytes, so an unverified
// read would let silent local corruption become canonical membership.
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

const grouped = new Map();
let featureCount = 0;
let tileKeyMismatches = 0;
let nonZeroPartIndex = 0;
let checksumMismatches = 0;
let byteSizeMismatches = 0;
let unsafeRefs = 0;
const representativeById = new Map();
for (const declared of declaredShards) {
  if (!isSafeReleaseArtifactReference(declared.relativeContentRef)) { unsafeRefs += 1; continue; }
  const text = await readFile(join(snapshotRoot, declared.relativeContentRef), "utf8");
  if (new globalThis.TextEncoder().encode(text).byteLength !== declared.byteSize) byteSizeMismatches += 1;
  if (sha256HexSync(text) !== declared.checksumSha256) checksumMismatches += 1;
  const shard = JSON.parse(text);
  const bucket = grouped.get(shard.tileKey) ?? [];
  for (const feature of shard.features) {
    featureCount += 1;
    if (feature.partIndex !== 0) nonZeroPartIndex += 1;
    const [longitude, latitude] = feature.coordinates;
    if (tileKeyString(tileKeyForCoordinate(longitude, latitude, EXTERIOR_WAVE_TILE_LEVEL)) !== shard.tileKey) tileKeyMismatches += 1;
    representativeById.set(feature.parentId, [longitude, latitude]);
    bucket.push({ buildingId: feature.parentId, longitude, latitude });
  }
  grouped.set(shard.tileKey, bucket);
}
check("every declared shard reference is a canonical safe relative path", unsafeRefs === 0, `${unsafeRefs} unsafe refs`);
check("every building shard matches its declared byte size", byteSizeMismatches === 0, `${byteSizeMismatches} mismatches of ${declaredShards.length}`);
check("every building shard matches its declared SHA-256 checksum", checksumMismatches === 0, `${checksumMismatches} mismatches of ${declaredShards.length}`);
const shardGroups = [...grouped.entries()].sort(([left], [right]) => (left < right ? -1 : 1)).map(([tileKey, buildings]) => ({ tileKey, buildings }));
const baseBuildingIds = shardGroups.flatMap((group) => group.buildings.map((building) => building.buildingId));

check("shard feature total equals the accepted building count", featureCount === EXTERIOR_WAVE_BASE_BUILDING_COUNT, String(featureCount));
check("every building is a single render part", nonZeroPartIndex === 0, `${nonZeroPartIndex} parts with a non-zero partIndex`);
check("building ids are unique across the frozen grouping", new Set(baseBuildingIds).size === featureCount, `${new Set(baseBuildingIds).size} unique of ${featureCount}`);
check("every representative coordinate reproduces its shard tile key", tileKeyMismatches === 0, `${tileKeyMismatches} mismatches`);
check("frozen grouping spans exactly 50 level-14 tiles", shardGroups.length === 50, String(shardGroups.length));

// --- Ledger construction --------------------------------------------------
const built = buildExteriorWaveLedger({
  baseReleaseId: EXTERIOR_WAVE_BASE_RELEASE_ID,
  baseManifestChecksumSha256: manifestChecksum,
  shardGroups,
});
const { ledger, digest, eligibility } = built;
const ledgerChecksumSha256 = exteriorArtifactChecksum(ledger);

const validation = validateExteriorWaveLedger(ledger);
check("ledger passes the accepted release-graph schema and the wave invariants", validation.ok, validation.ok ? "" : JSON.stringify(validation.issues.slice(0, 5)));

const digestIssues = validateExteriorWaveLedgerDigest(digest, ledger, ledgerChecksumSha256, {
  ledgerChecksumSha256,
  baseReleaseId: EXTERIOR_WAVE_BASE_RELEASE_ID,
  baseManifestChecksumSha256: manifestChecksum,
});
check("membership digest reproduces the ledger it pins", digestIssues.length === 0, JSON.stringify(digestIssues));

const eligibilityIssues = validateExteriorLedgerEligibility(eligibility, ledger, ledgerChecksumSha256);
check("eligibility artifact reproduces the ledger it pins", eligibilityIssues.length === 0, JSON.stringify(eligibilityIssues));

const owned = ledger.cells.reduce((total, cell) => total + cell.buildingIds.length, 0);
const maxMembership = ledger.cells.reduce((maximum, cell) => Math.max(maximum, cell.buildingIds.length), 0);
check("ledger owns exactly the accepted building total", owned === EXTERIOR_WAVE_BASE_BUILDING_COUNT && ledger.baseIdentitySet.buildingCount === EXTERIOR_WAVE_BASE_BUILDING_COUNT, String(owned));
check("no cell exceeds the runtime membership cap", maxMembership <= EXTERIOR_CELL_MAX_BUILDINGS, `${maxMembership} > ${EXTERIOR_CELL_MAX_BUILDINGS}`);

// Leaf-level assignment: the level-14 grouping is the snapshot's authority, but
// the sub-partition is this module's, so every split assignment is re-derived
// from the same frozen representative point at the leaf's own tile level.
let leafMismatches = 0;
let leafChecked = 0;
for (const cell of ledger.cells) {
  const tile = cellTileKey(cell.cellId);
  if (tile === null) continue;
  const expected = tileKeyString(tile);
  for (const buildingId of cell.buildingIds) {
    const representative = representativeById.get(buildingId);
    if (!representative) { leafMismatches += 1; continue; }
    leafChecked += 1;
    if (tileKeyString(tileKeyForCoordinate(representative[0], representative[1], tile.level)) !== expected) leafMismatches += 1;
  }
}
check("every member's representative point resolves to its own leaf cell tile", leafMismatches === 0, `${leafMismatches} mismatches of ${leafChecked} checked`);
check("every wave owns at least one cell", digest.waves.every((wave) => wave.cellCount > 0), JSON.stringify(digest.waves.map((wave) => [wave.waveId, wave.cellCount])));

const reconciliation = reconcileExteriorWaveLedger(ledger, {
  baseBuildingIds,
  baseReleaseId: EXTERIOR_WAVE_BASE_RELEASE_ID,
  ledgerChecksumSha256,
});
check("reconciliation reports zero missing/duplicate/stale/changed memberships", reconciliation.ok, JSON.stringify(reconciliation.counts));

// --- Emit -----------------------------------------------------------------
const files = new Map([
  ["ledger.json", serializeExteriorArtifact(ledger)],
  ["ledger.sha256", `${ledgerChecksumSha256}  ledger.json\n`],
  ["membership-digest.json", serializeExteriorArtifact(digest)],
  ["eligibility.json", serializeExteriorArtifact(eligibility)],
  ["reconciliation-report.json", serializeExteriorArtifact(reconciliation)],
]);

async function existingFiles(directory) {
  if (!existsSync(directory)) return [];
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => relative(directory, join(entry.parentPath ?? entry.path, entry.name)));
}

const stale = (await existingFiles(outputRoot)).filter((path) => !files.has(path.split("\\").join("/")));
for (const path of stale) await rm(join(outputRoot, path));
for (const [path, text] of [...files].sort(([left], [right]) => (left < right ? -1 : 1))) {
  const target = join(outputRoot, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text, "utf8");
}

const lines = [
  `Exterior wave ledger emitted: ${EXTERIOR_WAVE_LEDGER_RELEASE_ID}`,
  `  ledgerId              ${ledger.ledgerId}`,
  `  ledger.sha256         ${ledgerChecksumSha256}`,
  `  baseIdentitySet.id    ${ledger.baseIdentitySet.id}`,
  `  buildings             ${owned}`,
  `  cells                 ${ledger.cells.length} (max membership ${maxMembership} <= ${EXTERIOR_CELL_MAX_BUILDINGS})`,
  `  coverage              ${JSON.stringify(ledger.coverage)}`,
  "  waves",
  ...digest.waves.map((wave) => `    ${String(wave.waveIndex)} ${wave.waveId.padEnd(24)} rows ${wave.tileRowRange ? `${wave.tileRowRange.southRowY}..${wave.tileRowRange.northRowY}` : "declared-set"}  cells ${String(wave.cellCount).padStart(4)}  buildings ${String(wave.buildingCount).padStart(6)}`),
  "  cross-checks",
  ...checks.map((entry) => `    PASS  ${entry.label}`),
  `  files written ${files.size} (removed ${stale.length} stale)`,
];
globalThis.process.stdout.write(`${lines.join("\n")}\n`);
