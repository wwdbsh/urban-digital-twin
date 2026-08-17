/* global console, process */
/**
 * T009 closure: the textured-lod_1 coverage record.
 *
 * Machine-checked against the IMMUTABLE ownership ledger rather than against the
 * `-c2` censuses that produced it, and against the `-c1` predecessor it must not
 * have moved. Measured storage replaces Stage 0's projection.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { exteriorArtifactChecksum, EXTERIOR_WAVE_LEDGER_RELEASE_ID } from "../src/release/exterior-wave-ledger.ts";
import { WAVE_OWNED_PARENTS } from "./mass-generation-wave-cli.mjs";
import { C1_RELEASE_IDS, c2ReleaseId } from "./lod1-texturing-wave-cli.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ISLAND_OWNED_PARENTS = 45_194;
const WAVES = ["w00", "w01", "w02", "w03", "w04", "w05"];
const read = (p) => readFileSync(p, "utf8");
const fail = (m) => { console.error(`STOP: ${m}`); process.exit(1); };

const ledger = JSON.parse(read(join(root, "data", "normalized", EXTERIOR_WAVE_LEDGER_RELEASE_ID, "ledger.json")));
const ledgerChecksum = exteriorArtifactChecksum(ledger);
const ownedByWave = new Map();
for (const cell of ledger.cells) {
  const w = /^manhattan-exterior-cell-(w\d{2})-/u.exec(cell.cellId)[1];
  ownedByWave.set(w, (ownedByWave.get(w) ?? 0) + cell.buildingIds.length);
}
const islandOwned = [...ownedByWave.values()].reduce((a, b) => a + b, 0);
if (islandOwned !== ISLAND_OWNED_PARENTS) fail(`ledger yields ${islandOwned} owned parents.`);

const rows = [];
const totals = { textured: 0, tombstoned: 0, fallbacks: 0, lod0Bytes: 0, lod1Bytes: 0, totalBytes: 0, c1Lod1Bytes: 0, cells: 0 };
const categories = {};
for (const waveId of WAVES) {
  const c2 = c2ReleaseId(waveId);
  const c1 = C1_RELEASE_IDS[waveId];
  const censusText = read(join(root, "data", c2, "wave-census.json"));
  const invText = read(join(root, "data", c2, "payload-inventory.json"));
  const valText = read(join(root, "data", c2, "retention-validation.json"));
  const verText = read(join(root, "data", c2, "verification.json"));
  const census = JSON.parse(censusText);
  const val = JSON.parse(valText); const ver = JSON.parse(verText);
  const c1Census = JSON.parse(read(join(root, "data", c1, "wave-census.json")));
  const c1Inv = JSON.parse(read(join(root, "data", c1, "payload-inventory.json")));

  const owned = ownedByWave.get(waveId);
  if (owned !== WAVE_OWNED_PARENTS[waveId]) fail(`${waveId} ledger owned ${owned}.`);
  if (census.generatedBuildingCount + census.tombstonedBuildingCount !== owned) fail(`${waveId} does not account for itself.`);
  if (census.generatedBuildingCount !== c1Census.generatedBuildingCount) fail(`${waveId} generated drifted from -c1.`);
  if (census.tombstonedBuildingCount !== c1Census.tombstonedBuildingCount) fail(`${waveId} tombstones drifted from -c1.`);
  if (census.lod1FallbackCount !== c1Census.lod1FallbackCount) fail(`${waveId} fallbacks drifted from -c1.`);
  if (val.ok !== true || val.validatedCellCount !== val.declaredCellCount) fail(`${waveId} validation incomplete.`);
  if (val.silhouetteRecords !== census.generatedBuildingCount) fail(`${waveId} silhouette records != generated.`);
  if (census.lod0.matchedC1Inventory !== census.lod0.copied || census.lod0.mismatches !== 0) fail(`${waveId} lod_0 copy unverified.`);
  if (ver.determinismReplay.byteIdenticalCount !== ver.determinismReplay.comparedGlbCount) fail(`${waveId} replay not byte-identical.`);
  if (ver.c1Immutability.differing.length !== 0) fail(`${waveId} -c1 MUTATION detected.`);

  // A -c1 lod_1 byte total, for the MEASURED texturing delta.
  const c1Lod1 = c1Inv.files.filter((f) => f.path.endsWith("__lod_1.glb")).reduce((t, f) => t + f.byteSize, 0);
  for (const [k, v] of Object.entries(census.aggregate.refusalsByCode)) categories[k] = (categories[k] ?? 0) + v;

  rows.push({
    waveId, c1ReleaseId: c1, c2ReleaseId: c2, owned,
    texturedLod1: census.generatedBuildingCount, tombstoned: census.tombstonedBuildingCount,
    texturedFallbacks: census.lod1FallbackCount, cellManifests: val.declaredCellCount,
    lod0Bytes: census.bytes.lod0, lod1Bytes: census.bytes.lod1, totalBytes: census.bytes.total,
    predecessorLod1Bytes: c1Lod1, lod1TexturingDeltaBytes: census.bytes.lod1 - c1Lod1,
    lod0Copy: { copied: census.lod0.copied, matchedC1Inventory: census.lod0.matchedC1Inventory, matchedReemission: census.lod0.matchedReemission },
    validation: { validatedCellCount: val.validatedCellCount, declaredCellCount: val.declaredCellCount, assets: val.assets, silhouetteRecords: val.silhouetteRecords, lod1FallbackCount: val.lod1FallbackCount, completenessSources: val.completenessSources },
    determinismReplay: { compared: ver.determinismReplay.comparedGlbCount, byteIdentical: ver.determinismReplay.byteIdenticalCount, fallbackGlbCompared: ver.determinismReplay.fallbackGlbCompared },
    c1Immutability: { sampled: ver.c1Immutability.sampled, identical: ver.c1Immutability.identical },
    waveCensusSha256: sha256HexSync(censusText), payloadInventorySha256: sha256HexSync(invText),
    retentionValidationSha256: sha256HexSync(valText), verificationSha256: sha256HexSync(verText),
  });
  totals.textured += census.generatedBuildingCount; totals.tombstoned += census.tombstonedBuildingCount;
  totals.fallbacks += census.lod1FallbackCount; totals.lod0Bytes += census.bytes.lod0;
  totals.lod1Bytes += census.bytes.lod1; totals.totalBytes += census.bytes.total;
  totals.c1Lod1Bytes += c1Lod1; totals.cells += val.declaredCellCount;
}
if (totals.textured + totals.tombstoned !== ISLAND_OWNED_PARENTS) fail(`island does not close: ${totals.textured} + ${totals.tombstoned}.`);
if (Object.values(categories).reduce((a, b) => a + b, 0) !== totals.tombstoned) fail("tombstone categories do not total.");

const sampling = JSON.parse(read(join(root, "data", "lod1-texturing-20260817", "sampling-results.json")));
const record = {
  schemaVersion: "1.0", recordId: "lod1-texturing-20260817:coverage", task: "T009", artifact: "textured-lod1-coverage",
  note: "The six -c2 textured-lod_1 waves in one table, checked against the IMMUTABLE ownership ledger and against the -c1 predecessor the campaign must not have moved. Deterministic counts and bytes only; NOT visual, geographic, architectural or performance acceptance.",
  ledger: { releaseId: EXTERIOR_WAVE_LEDGER_RELEASE_ID, checksumSha256: ledgerChecksum, ownedParents: islandOwned },
  waves: rows,
  island: {
    owned: ISLAND_OWNED_PARENTS, texturedLod1: totals.textured, texturedFallbacks: totals.fallbacks,
    tombstoned: totals.tombstoned, cellManifests: totals.cells,
    texturedPlusTombstonedEqualsOwned: totals.textured + totals.tombstoned === ISLAND_OWNED_PARENTS,
  },
  tombstoneCategories: categories,
  measuredStorage: {
    status: "MEASURED, replacing Stage 0's first-order projection.",
    lod0BytesCopied: totals.lod0Bytes, lod1BytesTextured: totals.lod1Bytes, totalBytes: totals.totalBytes,
    predecessorLod1Bytes: totals.c1Lod1Bytes,
    lod1TexturingDeltaBytes: totals.lod1Bytes - totals.c1Lod1Bytes,
    againstProjection: "Stage 0 projected the lod_1 texturing delta at 0.4-1.3 GB, consistent with the architect's +0.5-1.1 GB and NOT with +3-4 GB. The measured delta is stated above; it is the figure that now stands.",
  },
  appearanceSampling: {
    record: "sampling-results.json",
    fallbackCell: sampling.result_fallbackPairs.verdict,
    fallbackPassed: `${sampling.result_fallbackPairs.passed}/${sampling.result_fallbackPairs.of}`,
    shedCell: sampling.result_shedPairs.verdict,
    shedPassed: `${sampling.result_shedPairs.passed}/${sampling.result_shedPairs.of}`,
    statement: "The fallback cell PASSES its strictest pre-registered bar pixel-identically and settles the palette question. The shed cell MISSES on 12 of 24 pairs; a post-hoc intersection diagnostic attributes most of it to the pre-registered measure conflating silhouette area with tone and recovers 19/24, but 5 remain unexplained and the pre-registered result stands as a MISS.",
  },
  rights: {
    statement: "The six -c2 packages RETAIN bytes LOCALLY ONLY under gitignored payload directories. Nothing is conveyed, redistributed, published or served. No approval envelope is widened.",
    servingSurfaceChange: "none", pinnedReleaseIdChange: "none", promotedDefaultChange: "none",
    predecessorMutation: "none — -c1 immutability spot-checked on every wave and unchanged",
  },
  notClaimedHere: [
    "Any visual, geographic, architectural, accessibility or performance acceptance.",
    "That every shed lod_1 matches its lod_0 in tone at mid distance; the sampling did not establish that.",
    "That the tile is resolvable at mid ring. Stage 0 measured that it is not and that finding is unchanged.",
    "Distinct LOD thresholds: -c2 keeps maxDistanceMeters null at both levels and eligible:false for the 424; T001 owns -s2.",
  ],
};
mkdirSync(join(root, "data", "lod1-texturing-20260817"), { recursive: true });
const s = `${JSON.stringify(record, null, 1)}\n`;
writeFileSync(join(root, "data", "lod1-texturing-20260817", "coverage.json"), s);
writeFileSync(join(root, "data", "lod1-texturing-20260817", "coverage.sha256"), `${sha256HexSync(s)}  coverage.json\n`);
console.log(JSON.stringify({ island: record.island, storage: record.measuredStorage, categories }, null, 1));
