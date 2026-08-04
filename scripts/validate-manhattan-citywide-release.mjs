/* global Buffer, console, process */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CITYWIDE_BUDGETS, validateCitywideReleaseManifest } from "../src/release/citywide-release.ts";

const RELEASE = "manhattan-citywide-20260804";

function parseArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") continue;
    if (!token?.startsWith("--")) continue;
    const equals = token.indexOf("=");
    if (equals > 2) output[token.slice(2, equals)] = token.slice(equals + 1);
    else { output[token.slice(2)] = argv[index + 1]; index += 1; }
  }
  return output;
}

async function readJson(path) { return JSON.parse(await readFile(path, "utf8")); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function safeRef(value) { return typeof value === "string" && value.length > 0 && !value.startsWith("/") && !value.includes("\\") && !value.includes("://") && !value.split("/").includes(".."); }
function assert(condition, message) { if (!condition) throw new Error(message); }

async function validatePublishedFiles(releaseRoot, manifest, manifestText) {
  const declared = Object.entries(manifest.publishedFiles ?? {});
  const expectedRefs = [...manifest.geometryShards, ...manifest.searchShards, ...manifest.detailShards].map((shard) => [shard.relativeContentRef, shard.checksumSha256]);
  if (manifest.detailIndex) expectedRefs.push([manifest.detailIndex.relativeContentRef, manifest.detailIndex.checksumSha256]);
  assert(declared.length === expectedRefs.length, "Published file declaration count does not match the release shard/index declarations.");
  const expectedByRef = new Map(expectedRefs);
  for (const [relative, expectedSha] of declared) {
    assert(safeRef(relative), `Unsafe release content reference: ${relative}`);
    assert(expectedByRef.get(relative) === expectedSha, `Published checksum declaration mismatch: ${relative}`);
    const bytes = await readFile(join(releaseRoot, relative));
    assert(sha256(bytes) === expectedSha, `Published content checksum mismatch: ${relative}`);
  }
  const manifestSha = (await readFile(join(releaseRoot, "manifest.sha256"), "utf8")).trim();
  assert(manifestSha === sha256(manifestText), "Release manifest checksum sidecar mismatch.");
  const measuredTotal = Buffer.byteLength(manifestText) + (await Promise.all(declared.map(async ([relative]) => (await readFile(join(releaseRoot, relative))).byteLength))).reduce((sum, bytes) => sum + bytes, 0);
  assert(measuredTotal === manifest.totalDeclaredBytes, `Release total byte declaration mismatch: ${manifest.totalDeclaredBytes} versus ${measuredTotal}.`);
  assert(manifest.totalDeclaredBytes <= CITYWIDE_BUDGETS.totalBytes, "Release total byte budget failed.");
  assert(Buffer.byteLength(manifestText) <= CITYWIDE_BUDGETS.rootBytes, "Release root manifest byte budget failed.");
  return { declaredFiles: declared.length, measuredTotal, rootBytes: Buffer.byteLength(manifestText) };
}

async function validateSourceSnapshots(rawRoot, normalizedManifest, manifest) {
  const buildingAcquisition = await readJson(join(rawRoot, "buildings", "manhattan-building-footprints.manifest.json"));
  const buildingBytes = await readFile(join(rawRoot, "buildings", buildingAcquisition.rawSnapshot.relativePath));
  const dohmhAcquisition = await readJson(join(rawRoot, "dohmh-citywide-acquisition.manifest.json"));
  const dohmhBytes = await readFile(join(rawRoot, dohmhAcquisition.captures.a.relativePath));
  const sourceByDataset = new Map(manifest.sourceSnapshots.map((source) => [source.datasetId, source]));
  const buildingSource = sourceByDataset.get("jh45-qr5r");
  const dohmhSource = sourceByDataset.get("43nn-pn8j");
  assert(buildingSource && dohmhSource, "Release source snapshot declarations are incomplete.");
  const expectedBuildingCapture = buildingAcquisition.capturedAt;
  const expectedBuildingSourceUpdated = new Date(Number(buildingAcquisition.metadata?.lastEditDate ?? Number.NaN)).toISOString();
  const expectedDohmhCapture = dohmhAcquisition.capturedAt;
  const expectedDohmhSourceUpdated = dohmhAcquisition.metadata?.rowsUpdatedAt;
  assert(buildingSource.captureTimestamp === expectedBuildingCapture && buildingSource.sourceUpdatedAt === expectedBuildingSourceUpdated, "Release OTI capture/source-update provenance does not match the immutable acquisition manifest.");
  assert(dohmhSource.captureTimestamp === expectedDohmhCapture && dohmhSource.sourceUpdatedAt === expectedDohmhSourceUpdated, "Release DOHMH capture/source-update provenance does not match the immutable acquisition manifest.");
  assert(buildingBytes.byteLength === buildingAcquisition.rawSnapshot.bytes && sha256(buildingBytes) === buildingAcquisition.rawSnapshot.sha256, "Immutable OTI raw artifact fails acquisition-manifest checksum/byte validation.");
  assert(buildingSource.rawByteSize === buildingBytes.byteLength && buildingSource.rawChecksumSha256 === sha256(buildingBytes) && buildingSource.sourceRecordCount === 45194 && buildingSource.acceptedCount === 45194 && buildingSource.rejectedCount === 0, "Release OTI source snapshot evidence does not match immutable raw truth.");
  assert(dohmhBytes.byteLength === dohmhAcquisition.captures.a.bytes && sha256(dohmhBytes) === dohmhAcquisition.captures.a.sha256, "Immutable DOHMH raw artifact fails acquisition-manifest checksum/byte validation.");
  assert(dohmhSource.rawByteSize === dohmhBytes.byteLength && dohmhSource.rawChecksumSha256 === sha256(dohmhBytes) && dohmhSource.sourceRecordCount === 109386 && dohmhSource.acceptedCount === 109386 && dohmhSource.rejectedCount === 0, "Release DOHMH source snapshot evidence does not match immutable raw truth.");
  assert(normalizedManifest.inputs?.buildings?.rawBytes === buildingBytes.byteLength && normalizedManifest.inputs?.buildings?.rawSha256 === sha256(buildingBytes), "Normalized OTI input evidence is inconsistent with immutable raw truth.");
  assert(normalizedManifest.inputs?.restaurants?.rawBytes === dohmhBytes.byteLength && normalizedManifest.inputs?.restaurants?.rawSha256 === sha256(dohmhBytes), "Normalized DOHMH input evidence is inconsistent with immutable raw truth.");
  return { buildings: { bytes: buildingBytes.byteLength, sha256: sha256(buildingBytes), count: buildingSource.sourceRecordCount }, restaurants: { bytes: dohmhBytes.byteLength, sha256: sha256(dohmhBytes), count: dohmhSource.sourceRecordCount } };
}

async function validateContent(releaseRoot, manifest, normalizedManifest, normalizedRoot) {
  const detailIndexPath = join(releaseRoot, manifest.detailIndex?.relativeContentRef ?? "");
  assert(manifest.detailIndex && safeRef(manifest.detailIndex.relativeContentRef), "A checksum-pinned detail index is required for lazy detail lookup.");
  const detailIndex = await readJson(detailIndexPath);
  assert(detailIndex.schemaVersion === "citywide-detail-index-1" && Array.isArray(detailIndex.entries), "Detail index schema is invalid.");
  assert(detailIndex.entries.length === 57633 && new Set(detailIndex.entries.map((entry) => Array.isArray(entry) ? entry[0] : null)).size === 57633 && detailIndex.entries.every((entry) => Array.isArray(entry) && typeof entry[0] === "string" && safeRef(entry[1])), "Detail index must contain exactly 57,633 unique parent entries.");
  assert(manifest.detailIndex.entryCount === detailIndex.entries.length, "Release detailIndex.entryCount does not equal the emitted unique entry count.");
  const detailByParent = new Map(detailIndex.entries);
  const expectedBuildingParents = new Set();
  const expectedRestaurantParents = new Set();
  const normalizedBuildings = JSON.parse(await readFile(join(normalizedRoot, "buildings.normalized.json"), "utf8"));
  const normalizedRestaurants = JSON.parse(await readFile(join(normalizedRoot, "restaurants.normalized.json"), "utf8"));
  normalizedBuildings.records.forEach((record) => expectedBuildingParents.add(record.parentId));
  normalizedRestaurants.records.forEach((record) => expectedRestaurantParents.add(record.parentId));
  const expectedParents = new Set([...expectedBuildingParents, ...expectedRestaurantParents]);
  assert(detailIndex.entries.length === expectedParents.size && detailByParent.size === expectedParents.size, "Detail index parent accounting is incomplete or duplicated.");
  const detailParents = new Set();
  let detailBuildingParts = 0;
  let detailRestaurantObservations = 0;
  let detailUnlocated = 0;
  for (const shard of manifest.detailShards) {
    const value = await readJson(join(releaseRoot, shard.relativeContentRef));
    assert(value.schemaVersion === "citywide-details-1" && Array.isArray(value.records), `Invalid detail shard: ${shard.relativeContentRef}`);
    for (const record of value.records) {
      assert(typeof record.p === "string" && (record.k === "building" || record.k === "restaurant"), `Invalid compact detail record in ${shard.relativeContentRef}`);
      assert(!detailParents.has(record.p) && detailByParent.get(record.p) === shard.relativeContentRef, `Detail parent mapping is unstable: ${record.p}`);
      detailParents.add(record.p);
      if (record.k === "building") { assert(Array.isArray(record.v), `Building detail parts are missing: ${record.p}`); detailBuildingParts += record.v.length; }
      else { assert(Array.isArray(record.v), `Restaurant observations are missing: ${record.p}`); detailRestaurantObservations += record.v.length; if (record.l === "location-unavailable") detailUnlocated += 1; }
    }
  }
  assert(detailParents.size === expectedParents.size && [...expectedParents].every((id) => detailParents.has(id)), "Detail parent coverage does not match normalized parent identity.");
  assert(detailBuildingParts === normalizedManifest.buildingMetrics.normalizedParts && detailRestaurantObservations === normalizedManifest.restaurantMetrics.normalizedOccurrences && detailUnlocated === normalizedManifest.restaurantMetrics.unlocatedParents, "Detail accounting does not match normalized source truth.");
  const searchParents = new Set();
  for (const shard of manifest.searchShards) {
    const value = await readJson(join(releaseRoot, shard.relativeContentRef));
    assert(value.schemaVersion === "citywide-search-1" && Array.isArray(value.summaries), `Invalid search shard: ${shard.relativeContentRef}`);
    for (const summary of value.summaries) {
      assert(Array.isArray(summary) && summary.length === 10 && typeof summary[0] === "string" && typeof summary[9] === "string", `Invalid compact search summary in ${shard.relativeContentRef}`);
      assert(detailByParent.get(summary[0]) === summary[9], `Search/detail identity mismatch: ${summary[0]}`);
      searchParents.add(summary[0]);
    }
  }
  assert([...expectedParents].every((id) => searchParents.has(id)), "Search shards do not cover every normalized parent.");
  let geometryBuildings = 0;
  let geometryRestaurants = 0;
  const geometryParentIds = new Set();
  for (const shard of manifest.geometryShards) {
    const value = await readJson(join(releaseRoot, shard.relativeContentRef));
    assert(value.schemaVersion === "citywide-geometry-1" && value.layer === shard.layer && value.tileKey === shard.tileKey && Array.isArray(value.features) && value.features.length === shard.featureCount, `Invalid geometry shard payload tile/layer/count: ${shard.relativeContentRef}`);
    for (const feature of value.features) {
      assert(typeof feature.parentId === "string", `Geometry parent identity missing: ${shard.relativeContentRef}`);
      if (shard.layer === "buildings") { geometryBuildings += 1; geometryParentIds.add(feature.parentId); }
      else geometryRestaurants += 1;
    }
  }
  assert(geometryBuildings === normalizedManifest.buildingMetrics.normalizedParts && geometryRestaurants === normalizedManifest.restaurantMetrics.locatedParents && geometryParentIds.size === normalizedManifest.buildingMetrics.normalizedParents, "Geometry shard accounting does not match normalized source truth.");
  return { detailParents: detailParents.size, detailBuildingParts, detailRestaurantObservations, detailUnlocated, searchParents: searchParents.size, geometryBuildings, geometryRestaurants, geometryShardCount: manifest.geometryShards.length, searchShardCount: manifest.searchShards.length, detailShardCount: manifest.detailShards.length };
}

async function run() {
  const values = parseArgs(process.argv.slice(2));
  const releaseRoot = resolve(String(values["release-root"] ?? `data/generated/catalog/${RELEASE}-replay-a`));
  const rawRoot = resolve(String(values["raw-root"] ?? `data/raw/${RELEASE}`));
  const normalizedRoot = resolve(String(values["normalized-root"] ?? `data/generated/${RELEASE}`));
  const manifestText = await readFile(join(releaseRoot, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestText);
  const validation = validateCitywideReleaseManifest(manifest);
  if (!validation.ok) throw new Error(`Citywide release manifest failed: ${validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
  const normalizedManifest = await readJson(join(normalizedRoot, "normalization.manifest.json"));
  assert(manifest.releaseId === RELEASE && manifest.approval?.messageId === "msg_91770ac6d098" && manifest.coverage?.pilotReplayStable === true, "Citywide release identity/approval/pilot replay gate failed.");
  const files = await validatePublishedFiles(releaseRoot, manifest, manifestText);
  const sources = await validateSourceSnapshots(rawRoot, normalizedManifest, manifest);
  const content = await validateContent(releaseRoot, manifest, normalizedManifest, normalizedRoot);
  console.log(JSON.stringify({ releaseRoot, valid: true, files, sources, content, totalDeclaredBytes: manifest.totalDeclaredBytes }, null, 2));
}

run().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
