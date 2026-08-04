/* global Buffer, console, process */

import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sha256HexSync, stableSerialize } from "../src/release/catalog-release.ts";
import { CITYWIDE_RELEASE_SCHEMA_VERSION, CITYWIDE_TILE_LEVEL, CITYWIDE_BUDGETS, citywideQueryTokens } from "../src/release/citywide-release.ts";
import { parseTileKey, tileBounds, tileKeyForCoordinate, tileKeyString } from "../src/runtime/spatial.ts";

const RELEASE = "manhattan-citywide-20260804";
const FIELD_ORDER = ["camis", "dba", "boro", "building", "street", "zipcode", "phone", "cuisine_description", "inspection_date", "action", "violation_code", "violation_description", "critical_flag", "score", "grade", "grade_date", "record_date", "inspection_type", "latitude", "longitude", "community_board", "council_district", "census_tract", "bin", "bbl", "nta", "location", ":@computed_region_f5dn_yrer", ":@computed_region_yeji_bk3q", ":@computed_region_sbqj_enih", ":@computed_region_92fq_4b7q"];

function args(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) continue;
    const equals = token.indexOf("=");
    if (equals > 2) output[token.slice(2, equals)] = token.slice(equals + 1);
    else { output[token.slice(2)] = argv[index + 1]; index += 1; }
  }
  return output;
}

async function exists(path) { try { await stat(path); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; } }
async function readJson(path) { return JSON.parse(await readFile(path, "utf8")); }
function contentText(value) { return `${stableSerialize(value)}\n`; }
function contentSha(text) { return sha256HexSync(text); }
function requiredTimestamp(value, label) { if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error(`${label} must be a valid source timestamp.`); return value; }
function idHash(value) { let hash = 0; for (const char of value) hash = Math.imul(hash ^ char.codePointAt(0), 16777619); return Math.abs(hash) >>> 0; }
function safePart(value) { return value.replace(/[^a-z0-9_-]+/gi, "-"); }

async function writeContent(root, relative, value) {
  const text = contentText(value);
  const path = join(root, relative);
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, text, { flag: "wx", mode: 0o600 });
  return { relativeContentRef: relative, byteSize: Buffer.byteLength(text), checksumSha256: contentSha(text), text };
}

function chunkByBudget(entries, makeContent, maxBytes, maxCount) {
  const chunks = [];
  const emptyBytes = Buffer.byteLength(contentText(makeContent([])));
  const entryBytes = entries.map((entry) => Buffer.byteLength(stableSerialize(entry)));
  let current = [];
  let currentBytes = emptyBytes;
  for (const [index, entry] of entries.entries()) {
    const additionalBytes = entryBytes[index] + (current.length > 0 ? 1 : 0);
    if (current.length >= maxCount || currentBytes + additionalBytes > maxBytes) {
      if (current.length === 0) throw new Error(`A single citywide release record exceeds ${maxBytes} bytes.`);
      chunks.push(current);
      current = [entry];
      currentBytes = emptyBytes + entryBytes[index];
    } else {
      current.push(entry);
      currentBytes += additionalBytes;
    }
  }
  if (current.length > 0) chunks.push(current);
  for (const chunk of chunks) {
    if (Buffer.byteLength(contentText(makeContent(chunk))) > maxBytes) throw new Error(`A citywide release shard exceeds ${maxBytes} bytes.`);
  }
  return chunks;
}

function geometryShardBounds(tileKey) { return tileBounds(parseTileKey(tileKey)); }

function buildingSummary(record, detailRef = `details/buildings/${record.doittId}.json`) {
  const ids = [record.doittId, record.bin, record.baseBbl, record.mapPlutoBbl, String(record.objectId)].filter((value) => value !== null && value !== undefined).map(String);
  const searchable = [record.name, ...ids].filter(Boolean).join(" ");
  return { parentId: record.parentId, kind: "building", name: record.name, address: null, cuisine: null, sourceIdentifiers: ids, normalizedTokens: citywideQueryTokens(searchable), coordinates: record.coordinates, locationStatus: "located", tileKeys: [tileKeyString(tileKeyForCoordinate(record.coordinates[0], record.coordinates[1], CITYWIDE_TILE_LEVEL))], detailRef };
}

function restaurantSummary(record, detailRef = record.detailRef) {
  const ids = [record.camis].filter(Boolean).map(String);
  const searchable = [record.name, record.address, record.cuisine, ...ids].filter(Boolean).join(" ");
  const tileKeys = record.coordinates ? [tileKeyString(tileKeyForCoordinate(record.coordinates[0], record.coordinates[1], CITYWIDE_TILE_LEVEL))] : [];
  return { parentId: record.parentId, kind: "restaurant", name: record.name, address: record.address, cuisine: record.cuisine, sourceIdentifiers: ids, normalizedTokens: citywideQueryTokens(searchable), coordinates: record.coordinates, locationStatus: record.locationStatus, tileKeys, detailRef };
}

function compactSearchSummary(summary) {
  return [summary.parentId, summary.kind, summary.name, summary.address, summary.cuisine, summary.sourceIdentifiers, summary.coordinates, summary.locationStatus, summary.tileKeys, summary.detailRef];
}

function compactRestaurantDetail(record) {
  return {
    p: record.parentId,
    k: "restaurant",
    n: record.name,
    l: record.locationStatus,
    c: record.coordinates,
    r: record.sourceOccurrenceIds,
    s: record.sourceRefIds,
    v: record.observations.map((observation) => [observation.occurrenceId, null, observation.identityClass, observation.rowDigest, observation.duplicateGroupMultiplicity, observation.ordinalWithinDigestGroup, FIELD_ORDER.map((field) => observation.row[field] ?? null)]),
    a: [["source-ref:nyc.dohmh-restaurant-inspections", "conditional-source", "https://www.nyc.gov/html/datamine/html/data/terms.html?dataSetJs=raw", "Source: NYC Department of Health and Mental Hygiene (DOHMH), DOHMH New York City Restaurant Inspection Results, dataset 43nn-pn8j."]],
  };
}

function compactBuildingDetail(records) {
  const first = records[0];
  return { p: first.parentId, k: "building", n: first.name, s: [first.doittId], r: records.map((record) => record.sourceRefId).filter(Boolean), a: [first.objectId, first.doittId, first.bin, first.baseBbl, first.mapPlutoBbl], v: records.map((record) => [record.partId, record.partIndex, record.partCount, record.coordinates, record.heightMeters, record.heightUnknown]) };
}

async function buildGeometry(root, buildings, restaurants) {
  const manifests = [];
  const groups = new Map();
  const add = (layer, tileKey, record) => { const key = `${layer}|${tileKey}`; groups.set(key, [...(groups.get(key) ?? []), record]); };
  buildings.forEach((record) => add("buildings", tileKeyString(tileKeyForCoordinate(record.coordinates[0], record.coordinates[1], CITYWIDE_TILE_LEVEL)), { parentId: record.parentId, partId: record.partId, partIndex: record.partIndex, name: record.name, geometry: record.geometry, coordinates: record.coordinates, heightMeters: record.heightMeters, heightUnknown: record.heightUnknown, sourceRecordId: record.doittId, bin: record.bin, baseBbl: record.baseBbl, mapPlutoBbl: record.mapPlutoBbl, sourceRefIds: record.sourceRefId ? [record.sourceRefId] : [] }));
  restaurants.filter((record) => record.coordinates).forEach((record) => add("restaurants", tileKeyString(tileKeyForCoordinate(record.coordinates[0], record.coordinates[1], CITYWIDE_TILE_LEVEL)), { parentId: record.parentId, name: record.name, address: record.address, cuisine: record.cuisine, coordinates: record.coordinates, locationStatus: record.locationStatus, observationCount: record.observationCount, sourceRecordIds: record.sourceOccurrenceIds, detailRef: record.detailRef }));
  for (const [groupKey, entries] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const [layer, tileKey] = groupKey.split("|");
    const sorted = entries.sort((left, right) => `${left.parentId}|${left.partId ?? ""}`.localeCompare(`${right.parentId}|${right.partId ?? ""}`));
    const chunks = chunkByBudget(sorted, (records) => ({ schemaVersion: "citywide-geometry-1", layer, tileKey, features: records }), CITYWIDE_BUDGETS.geometryShardBytes, CITYWIDE_BUDGETS.maxFeaturesPerGeometryShard);
    chunks.forEach((chunk, index) => { manifests.push({ layer, tileKey, chunk, densePartIndex: index, densePartCount: chunks.length }); });
  }
  const output = [];
  for (const item of manifests) {
    const shardId = `${item.layer}-${safePart(item.tileKey)}-${String(item.densePartIndex).padStart(3, "0")}`;
    const relative = `geometry/${item.layer}/${shardId}.json`;
    const file = await writeContent(root, relative, { schemaVersion: "citywide-geometry-1", layer: item.layer, tileKey: item.tileKey, features: item.chunk });
    output.push({ shardId, layer: item.layer, tileKey: item.tileKey, bounds: geometryShardBounds(item.tileKey), featureCount: item.chunk.length, byteSize: file.byteSize, checksumSha256: file.checksumSha256, relativeContentRef: relative, sourceRegistryEntryIds: [item.layer === "buildings" ? "nyc.building-footprints" : "nyc.dohmh-restaurant-inspections"], densePartIndex: item.densePartIndex, densePartCount: item.densePartCount });
  }
  return output.sort((left, right) => left.shardId.localeCompare(right.shardId));
}

async function buildSearch(root, summaries) {
  const groups = new Map();
  const add = (prefix, summary) => { const key = prefix || "__"; groups.set(key, [...(groups.get(key) ?? []), summary]); };
  for (const summary of summaries) {
    const prefixes = new Set(summary.normalizedTokens.map((token) => token.slice(0, 1)));
    [...summary.sourceIdentifiers, summary.parentId].forEach((identifier) => { const normalized = identifier.toLocaleLowerCase(); if (normalized.length >= 2) prefixes.add(`id-${String(idHash(normalized) % 16).padStart(2, "0")}`); });
    if (prefixes.size === 0) prefixes.add("__");
    prefixes.forEach((prefix) => add(prefix, summary));
  }
  const output = [];
  for (const [prefix, entries] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const unique = [...new Map(entries.sort((left, right) => left.parentId.localeCompare(right.parentId)).map((entry) => [entry.parentId, entry])).values()];
    const chunks = chunkByBudget(unique, (records) => ({ schemaVersion: "citywide-search-1", prefix, summaries: records.map(compactSearchSummary) }), CITYWIDE_BUDGETS.searchDetailShardBytes, Number.MAX_SAFE_INTEGER);
    chunks.forEach((chunk, index) => output.push({ prefix, chunk, index, count: chunks.length }));
  }
  const manifests = [];
  for (const item of output) {
    const shardId = `search-${safePart(item.prefix)}${item.count > 1 ? `-${String(item.index).padStart(2, "0")}` : ""}`;
    const relative = `search/${shardId}.json`;
    const file = await writeContent(root, relative, { schemaVersion: "citywide-search-1", prefix: item.prefix, summaries: item.chunk.map(compactSearchSummary) });
    manifests.push({ shardId, prefix: item.prefix, kind: "mixed", summaryCount: item.chunk.length, byteSize: file.byteSize, checksumSha256: file.checksumSha256, relativeContentRef: relative, parentIds: [] });
  }
  return manifests.sort((left, right) => left.shardId.localeCompare(right.shardId));
}

async function buildDetails(root, buildingRecords, restaurantRecords) {
  const buildingGroups = new Map();
  buildingRecords.forEach((record) => buildingGroups.set(record.parentId, [...(buildingGroups.get(record.parentId) ?? []), record]));
  const details = [...buildingGroups.values()].map(compactBuildingDetail).concat(restaurantRecords.map(compactRestaurantDetail)).sort((left, right) => left.p.localeCompare(right.p));
  const chunks = chunkByBudget(details, (records) => ({ schemaVersion: "citywide-details-1", records }), CITYWIDE_BUDGETS.searchDetailShardBytes, Number.MAX_SAFE_INTEGER);
  const manifests = [];
  const indexEntries = [];
  for (const [index, chunk] of chunks.entries()) {
    const shardId = `details-${String(index).padStart(3, "0")}`;
    const relative = `details/${shardId}.json`;
    const file = await writeContent(root, relative, { schemaVersion: "citywide-details-1", records: chunk });
    manifests.push({ shardId, parentIds: [], byteSize: file.byteSize, checksumSha256: file.checksumSha256, relativeContentRef: relative });
    chunk.forEach((record) => indexEntries.push([record.p, relative]));
  }
  const indexFile = await writeContent(root, "details/index.json", { schemaVersion: "citywide-detail-index-1", entries: indexEntries.sort(([left], [right]) => left.localeCompare(right)) });
  return { manifests, indexFile, indexEntries };
}

async function run() {
  const values = args(process.argv.slice(2));
  const release = String(values.release ?? RELEASE);
  const normalizedRoot = resolve(String(values["normalized-root"] ?? `data/generated/${release}`));
  const outputRoot = resolve(String(values["output-root"] ?? `data/generated/catalog/${release}`));
  if (release !== RELEASE) throw new Error(`Release is pinned to ${RELEASE}.`);
  if (await exists(outputRoot)) throw new Error(`Refusing to reuse existing citywide release output: ${outputRoot}`);
  const stageRoot = `${outputRoot}.staging-${process.pid}-${Date.now()}`;
  await mkdir(stageRoot, { recursive: false, mode: 0o700 });
  try {
    const normalizedManifest = await readJson(join(normalizedRoot, "normalization.manifest.json"));
    const rawRoot = resolve(String(values["raw-root"] ?? `data/raw/${release}`));
    const buildingAcquisition = await readJson(join(rawRoot, "buildings", "manhattan-building-footprints.manifest.json"));
    const dohmhAcquisition = await readJson(join(rawRoot, "dohmh-citywide-acquisition.manifest.json"));
    const buildingCaptureTimestamp = requiredTimestamp(buildingAcquisition.capturedAt, "OTI acquisition capturedAt");
    const buildingSourceUpdatedAt = requiredTimestamp(new Date(Number(buildingAcquisition.metadata?.lastEditDate ?? Number.NaN)).toISOString(), "OTI acquisition lastEditDate");
    const dohmhCaptureTimestamp = requiredTimestamp(dohmhAcquisition.capturedAt, "DOHMH acquisition capturedAt");
    const dohmhSourceUpdatedAt = requiredTimestamp(dohmhAcquisition.metadata?.rowsUpdatedAt, "DOHMH acquisition rowsUpdatedAt");
    const buildingsData = await readJson(join(normalizedRoot, "buildings.normalized.json"));
    const restaurantsData = await readJson(join(normalizedRoot, "restaurants.normalized.json"));
    const geometryShards = await buildGeometry(stageRoot, buildingsData.records, restaurantsData.records);
    const detailOutput = await buildDetails(stageRoot, buildingsData.records, restaurantsData.records);
    const detailRefByParent = new Map(detailOutput.indexFile ? JSON.parse(detailOutput.indexFile.text).entries : []);
    const searchShards = await buildSearch(stageRoot, [
      ...buildingsData.records.map((record) => buildingSummary(record, detailRefByParent.get(record.parentId))),
      ...restaurantsData.records.map((record) => restaurantSummary(record, detailRefByParent.get(record.parentId))),
    ]);
    const detailShards = detailOutput.manifests;
    const anchorCoverage = normalizedManifest.coverage.anchors.map((anchor) => ({ ...anchor, tileKeys: [tileKeyString(tileKeyForCoordinate(anchor.longitude, anchor.latitude, CITYWIDE_TILE_LEVEL))] }));
    const manifest = {
      schemaVersion: CITYWIDE_RELEASE_SCHEMA_VERSION,
      releaseId: release,
      cityId: "manhattan",
      scope: "citywide",
      outputCrs: "EPSG:4326",
      generatedAt: "2026-08-04T00:00:00.000Z",
      fixtureOnly: false,
      approval: { messageId: "msg_91770ac6d098", scope: "local snapshot-relative OTI/DOHMH citywide release", exclusions: ["new providers", "Google-derived data", "public deployment", "unrelated datasets"] },
      sourceSnapshots: [
        { registryEntryId: "nyc.building-footprints", provider: "NYC Office of Technology and Innovation (OTI) GIS", datasetId: "jh45-qr5r", captureTimestamp: buildingCaptureTimestamp, sourceUpdatedAt: buildingSourceUpdatedAt, rawRelativeRef: "raw/oti-building-footprints.geojson", rawByteSize: normalizedManifest.inputs.buildings.rawBytes, rawChecksumSha256: normalizedManifest.inputs.buildings.rawSha256, sourceRecordCount: normalizedManifest.buildingMetrics.sourceRecords, acceptedCount: normalizedManifest.buildingMetrics.normalizedParents, rejectedCount: normalizedManifest.buildingMetrics.rejectedRecords, termsUrl: "https://opendata.cityofnewyork.us/overview/", attribution: "Source: NYC Office of Technology and Innovation GIS, Building Footprints; accessed through NYC Open Data." },
        { registryEntryId: "nyc.dohmh-restaurant-inspections", provider: "NYC Department of Health and Mental Hygiene", datasetId: "43nn-pn8j", captureTimestamp: dohmhCaptureTimestamp, sourceUpdatedAt: dohmhSourceUpdatedAt, rawRelativeRef: "raw/dohmh-manhattan.snapshot.json", rawByteSize: normalizedManifest.inputs.restaurants.rawBytes, rawChecksumSha256: normalizedManifest.inputs.restaurants.rawSha256, sourceRecordCount: normalizedManifest.restaurantMetrics.sourceRows, acceptedCount: normalizedManifest.restaurantMetrics.normalizedOccurrences, rejectedCount: normalizedManifest.restaurantMetrics.rejectedOccurrences, termsUrl: "https://www.nyc.gov/html/datamine/html/data/terms.html?dataSetJs=raw", attribution: "Source: NYC Department of Health and Mental Hygiene (DOHMH), DOHMH New York City Restaurant Inspection Results, dataset 43nn-pn8j." },
      ],
      coverage: { cityId: "manhattan", claim: "snapshot-relative-all-records-accounted", boundaryEvidence: "OTI direct BASE_BBL/MAPPLUTO_BBL code-1 equality under unchanged layer edit truth; DOHMH exact boro='Manhattan' dual multiset capture", candidateBuildingCount: 45194, acceptedBuildingCount: normalizedManifest.buildingMetrics.normalizedParents, unresolvedBuildingCount: 0, acceptedRestaurantObservationCount: normalizedManifest.restaurantMetrics.normalizedOccurrences, rejectedRestaurantObservationCount: normalizedManifest.restaurantMetrics.rejectedOccurrences, locatedRestaurantParentCount: normalizedManifest.restaurantMetrics.locatedParents, unlocatedRestaurantParentCount: normalizedManifest.restaurantMetrics.unlocatedParents, anchors: anchorCoverage, accountingRemainderCount: normalizedManifest.coverage.accountingRemainder, identityCollisionCount: normalizedManifest.coverage.identityCollisionCount, pilotReplayStable: normalizedManifest.coverage.pilotReplayStable === true },
      layers: [
        { id: "buildings", label: "OTI Building Footprints", tileLevel: CITYWIDE_TILE_LEVEL, parentCount: normalizedManifest.buildingMetrics.normalizedParents, renderPartCount: normalizedManifest.buildingMetrics.normalizedParts, shardCount: geometryShards.filter((shard) => shard.layer === "buildings").length, sourceRegistryEntryIds: ["nyc.building-footprints"] },
        { id: "restaurants", label: "DOHMH Restaurant Inspection Places", tileLevel: CITYWIDE_TILE_LEVEL, parentCount: normalizedManifest.restaurantMetrics.camisParents, renderPartCount: normalizedManifest.restaurantMetrics.locatedParents, shardCount: geometryShards.filter((shard) => shard.layer === "restaurants").length, sourceRegistryEntryIds: ["nyc.dohmh-restaurant-inspections"] },
      ],
      geometryShards,
      searchShards,
      detailShards,
      detailIndex: { relativeContentRef: "details/index.json", byteSize: detailOutput.indexFile.byteSize, checksumSha256: detailOutput.indexFile.checksumSha256, entryCount: detailOutput.indexEntries.length },
      totalDeclaredBytes: 0,
      publishedFiles: Object.fromEntries([...geometryShards, ...searchShards, ...detailShards, { relativeContentRef: "details/index.json", checksumSha256: detailOutput.indexFile.checksumSha256 }].map((shard) => [shard.relativeContentRef, shard.checksumSha256])),
      fallback: { mode: "fixtures", reason: "Only an explicitly selected validated citywide release may claim real data; failed roots never substitute fixtures inside citywide mode." },
    };
    const contentBytes = [...geometryShards, ...searchShards, ...detailShards].reduce((sum, shard) => sum + shard.byteSize, 0) + detailOutput.indexFile.byteSize;
    let measuredTotalBytes = contentBytes + Buffer.byteLength(`${JSON.stringify({ ...manifest, totalDeclaredBytes: contentBytes }, null, 2)}\n`);
    for (let iteration = 0; iteration < 3; iteration += 1) {
      manifest.totalDeclaredBytes = measuredTotalBytes;
      const nextTotalBytes = contentBytes + Buffer.byteLength(`${JSON.stringify(manifest, null, 2)}\n`);
      if (nextTotalBytes === measuredTotalBytes) break;
      measuredTotalBytes = nextTotalBytes;
    }
    manifest.totalDeclaredBytes = measuredTotalBytes;
    if (manifest.totalDeclaredBytes > CITYWIDE_BUDGETS.totalBytes) throw new Error(`Citywide release total bytes exceed ${CITYWIDE_BUDGETS.totalBytes}: ${manifest.totalDeclaredBytes}.`);
    if (geometryShards.length + searchShards.length + detailShards.length > CITYWIDE_BUDGETS.maxShards) throw new Error("Citywide release exceeds shard-count budget.");
    const finalManifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(join(stageRoot, "manifest.json"), finalManifestText, { flag: "wx", mode: 0o600 });
    await writeFile(join(stageRoot, "manifest.sha256"), `${sha256HexSync(finalManifestText)}\n`, { flag: "wx", mode: 0o600 });
    await rename(stageRoot, outputRoot);
    console.log(JSON.stringify({ outputRoot, geometryShards: geometryShards.length, searchShards: searchShards.length, detailShards: detailShards.length, totalDeclaredBytes: manifest.totalDeclaredBytes, buildingParents: normalizedManifest.buildingMetrics.normalizedParents, restaurantParents: normalizedManifest.restaurantMetrics.camisParents }, null, 2));
  } catch (error) {
    const quarantinePath = resolve(`data/generated/citywide-recovery-quarantine/manhattan-citywide-20260804-cp4-build-failed-${Date.now()}`);
    try {
      await mkdir(quarantinePath, { recursive: false, mode: 0o700 });
      await rename(stageRoot, quarantinePath);
      console.error(`Citywide release build stage quarantined at ${quarantinePath}`);
    } catch (quarantineError) {
      console.error(`Citywide release build stage quarantine failed: ${quarantineError instanceof Error ? quarantineError.message : String(quarantineError)}`);
    }
    throw error;
  }
}

run().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
