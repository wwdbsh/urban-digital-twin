/* global Buffer, console, process */

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sourceRegistry } from "../src/data/source-registry.ts";
import { validateDohmhRows, buildDohmhMultiset, deriveDohmhOccurrences, DOHMH_CITYWIDE_EXPECTED_CAMIS, DOHMH_CITYWIDE_EXPECTED_ROWS } from "../src/ingestion/dohmh-citywide-snapshot.ts";
import { NycBuildingFootprintsSnapshotAdapter } from "../src/ingestion/nyc-building-footprints.ts";

const RELEASE = "manhattan-citywide-20260804";
const OTI_DATASET_ID = "jh45-qr5r";
const DOHMH_DATASET_ID = "43nn-pn8j";
const PILOT_RAW_PATH = "data/raw/real-wave-20260804/manhattan-building-pilot-20260804.geojson";
const PILOT_MANIFEST_PATH = "data/raw/real-wave-20260804/manhattan-building-pilot-20260804.manifest.json";
const PILOT_EXPECTED_FEATURES_PATH = "data/generated/nyc-building-footprints/manhattan-pilot-20260804/normalized-features.json";
const ANCHORS = [
  ["financial-battery", "Financial/Battery", -74.012, 40.706],
  ["chelsea-midtown", "Chelsea/Midtown", -73.992, 40.748],
  ["upper-west", "Upper West", -73.975, 40.787],
  ["upper-east", "Upper East", -73.956, 40.773],
  ["harlem", "Harlem", -73.944, 40.817],
  ["inwood-marble-hill", "Inwood/Marble Hill", -73.922, 40.871],
  ["roosevelt-island", "Roosevelt Island", -73.949, 40.762],
];

function parseArgs(argv) {
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

function hashText(text) { return createHash("sha256").update(text).digest("hex"); }

async function readJson(path) { return JSON.parse(await readFile(path, "utf8")); }

async function writeExclusive(path, text) { await writeFile(path, text, { flag: "wx", mode: 0o600 }); return { bytes: Buffer.byteLength(text), sha256: hashText(text) }; }

function sourceEntry(id) {
  const entry = sourceRegistry.find((candidate) => candidate.id === id);
  if (!entry || entry.approval.state !== "approved") throw new Error(`Approved source registry entry is required: ${id}`);
  return entry;
}

function pilotSemanticProjection(feature) {
  const geometryProvenance = feature.geometryProvenance ?? {};
  const sourceRefs = (feature.sourceRefs ?? []).map((sourceRef) => {
    const stableSourceRef = { ...sourceRef };
    delete stableSourceRef.capturedAt;
    return stableSourceRef;
  }).sort((left, right) => String(left.id).localeCompare(String(right.id)));
  return {
    schemaVersion: feature.schemaVersion,
    id: feature.id,
    cityId: feature.cityId,
    kind: feature.kind,
    name: feature.name,
    geometry: feature.geometry,
    coordinates: feature.coordinates,
    geometryProvenance: {
      schemaVersion: geometryProvenance.schemaVersion,
      inputCrs: geometryProvenance.inputCrs,
      outputCrs: geometryProvenance.outputCrs,
      height: geometryProvenance.height,
      horizontalUncertaintyMeters: geometryProvenance.horizontalUncertaintyMeters,
    },
    sourceRefs,
    provenance: feature.provenance,
    confidence: feature.confidence,
    uncertainty: feature.uncertainty,
    attributes: feature.attributes,
  };
}

function sortedFeatures(features) {
  return [...features].sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function digestValues(values) {
  return hashText(JSON.stringify(values));
}

async function replayProtectedPilot() {
  const pilotManifest = await readJson(resolve(PILOT_MANIFEST_PATH));
  const rawText = await readFile(resolve(PILOT_RAW_PATH), "utf8");
  const rawBytes = Buffer.byteLength(rawText);
  const rawSha256 = hashText(rawText);
  if (rawBytes !== pilotManifest.snapshotBytes || rawSha256 !== pilotManifest.snapshotSha256) throw new Error("Protected pilot replay raw checksum/byte gate failed.");
  const rawCollection = JSON.parse(rawText);
  if (rawCollection?.type !== "FeatureCollection" || !Array.isArray(rawCollection.features) || rawCollection.features.length !== pilotManifest.featureCount || pilotManifest.objectIdCount !== pilotManifest.featureCount) throw new Error("Protected pilot replay raw count/schema gate failed.");
  const expectedText = await readFile(resolve(PILOT_EXPECTED_FEATURES_PATH), "utf8");
  const expectedFeatures = JSON.parse(expectedText);
  if (!Array.isArray(expectedFeatures)) throw new Error("Protected pilot replay expected feature artifact is malformed.");
  const entry = sourceEntry("nyc.building-footprints");
  const adapter = await NycBuildingFootprintsSnapshotAdapter.fromSnapshot({
    snapshotText: rawText,
    metadata: {
      sourceRegistryEntryId: entry.id,
      inputFileName: PILOT_RAW_PATH,
      inputChecksumSha256: rawSha256,
      termsUrl: entry.termsUrl,
      attribution: entry.attribution,
      releaseTimestamp: null,
      captureTimestamp: pilotManifest.capturedAt,
      updateTimestamp: "2026-08-03T02:59:51Z",
      ingestedAt: "2026-08-04T03:08:30.000Z",
      inputCrs: "EPSG:4326",
      verticalDatum: "GROUND_ELEVATION NAVD88 when documented; HEIGHT_ROOF relative to source ground; source uncertainty preserved",
      heightUnit: "feet",
      groundElevationUnit: "unknown",
      fixtureOnly: false,
      immutable: true,
    },
  });
  const actualFeatures = sortedFeatures(adapter.getFeatures());
  const expectedSortedFeatures = sortedFeatures(expectedFeatures);
  if (actualFeatures.length !== expectedSortedFeatures.length || actualFeatures.length !== pilotManifest.featureCount) throw new Error("Protected pilot replay feature count gate failed.");
  const actualIds = actualFeatures.map((feature) => feature.id);
  const expectedIds = expectedSortedFeatures.map((feature) => feature.id);
  const actualHeights = actualFeatures.map((feature) => [feature.id, feature.geometryProvenance?.height?.valueMeters ?? null]);
  const expectedHeights = expectedSortedFeatures.map((feature) => [feature.id, feature.geometryProvenance?.height?.valueMeters ?? null]);
  if (digestValues(actualIds) !== digestValues(expectedIds) || actualIds.some((id, index) => id !== expectedIds[index])) throw new Error("Protected pilot replay canonical identity gate failed.");
  if (digestValues(actualHeights) !== digestValues(expectedHeights) || actualHeights.some((height, index) => JSON.stringify(height) !== JSON.stringify(expectedHeights[index]))) throw new Error("Protected pilot replay height gate failed.");
  const actualSemantics = actualFeatures.map(pilotSemanticProjection);
  const expectedSemantics = expectedSortedFeatures.map(pilotSemanticProjection);
  const actualSemanticDigest = digestValues(actualSemantics);
  const expectedSemanticDigest = digestValues(expectedSemantics);
  if (actualSemanticDigest !== expectedSemanticDigest) throw new Error(`Protected pilot replay semantic gate failed (expected ${expectedSemanticDigest}, got ${actualSemanticDigest}).`);
  const report = adapter.getIngestionReport();
  if (report.acceptedCount !== pilotManifest.featureCount || report.rejectedCount !== 0 || report.allInputRecordsAccountedFor !== true) throw new Error("Protected pilot replay accounting gate failed.");
  return {
    stable: true,
    rawPath: PILOT_RAW_PATH,
    rawBytes,
    rawSha256,
    expectedFeaturesPath: PILOT_EXPECTED_FEATURES_PATH,
    expectedFeaturesBytes: Buffer.byteLength(expectedText),
    expectedFeaturesSha256: hashText(expectedText),
    sourceRecords: pilotManifest.featureCount,
    replayAcceptedFeatures: report.acceptedFeatureCount,
    replayRejectedRecords: report.rejectedCount,
    canonicalIdentityDigest: digestValues(actualIds),
    heightDigest: digestValues(actualHeights),
    semanticDigest: actualSemanticDigest,
    comparison: "IDs, geometry, coordinates, names, normalized heights, source attributes, provenance identity, and uncertainty semantics compared after excluding capture/ingest timestamps and clipping-note wording.",
  };
}

function pointFromRow(row) {
  const location = row?.location;
  const candidate = location && typeof location === "object" && location.type === "Point" ? location.coordinates : null;
  const values = Array.isArray(candidate) ? candidate : row?.longitude !== null && row?.longitude !== undefined && row?.latitude !== null && row?.latitude !== undefined ? [row.longitude, row.latitude] : null;
  if (!Array.isArray(values) || values.length < 2) return null;
  const longitude = Number(values[0]);
  const latitude = Number(values[1]);
  return Number.isFinite(longitude) && Number.isFinite(latitude) && longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90 ? [longitude, latitude] : null;
}

function formattedAddress(row) {
  const values = [row?.building, row?.street, row?.zipcode].filter((value) => typeof value === "string" && value.length > 0);
  return values.length > 0 ? values.join(" ") : null;
}

function sourceRefFor(entry, sourceRecordId) {
  return `source-ref:${entry.id}:${sourceRecordId}`;
}

function normalizeRestaurantRows(rawRows, dohmhManifest, entry) {
  const canonicalRows = validateDohmhRows(rawRows, DOHMH_CITYWIDE_EXPECTED_ROWS);
  const multiset = buildDohmhMultiset(canonicalRows, DOHMH_CITYWIDE_EXPECTED_ROWS);
  if (multiset.metrics.camisCount !== DOHMH_CITYWIDE_EXPECTED_CAMIS) throw new Error("DOHMH CAMIS parent count changed during normalization.");
  const occurrences = deriveDohmhOccurrences(multiset);
  if (occurrences.length !== DOHMH_CITYWIDE_EXPECTED_ROWS || new Set(occurrences.map((item) => item.observationOccurrenceId)).size !== occurrences.length) throw new Error("DOHMH derived occurrence accounting/collision gate failed.");
  const parents = new Map();
  for (const occurrence of occurrences) {
    const row = occurrence.row;
    const camis = String(row.camis);
    const parentId = occurrence.parentId;
    const point = pointFromRow(row);
    const parent = parents.get(camis) ?? { parentId, camis, name: typeof row.dba === "string" ? row.dba : null, address: formattedAddress(row), cuisine: typeof row.cuisine_description === "string" ? row.cuisine_description : null, coordinates: point, locationStatus: point ? "located" : "location-unavailable", observationCount: 0, sourceOccurrenceIds: [], sourceRefIds: [], observations: [] };
    if (!parent.coordinates && point) { parent.coordinates = point; parent.locationStatus = "located"; }
    parent.observationCount += 1;
    parent.sourceOccurrenceIds.push(occurrence.observationOccurrenceId);
    parent.sourceRefIds.push(sourceRefFor(entry, occurrence.observationOccurrenceId));
    parent.observations.push({ occurrenceId: occurrence.observationOccurrenceId, providerRowId: null, identityClass: occurrence.identityClass, rowDigest: occurrence.rowDigest, duplicateGroupMultiplicity: occurrence.duplicateGroupMultiplicity, ordinalWithinDigestGroup: occurrence.ordinalWithinDigestGroup, row });
    parents.set(camis, parent);
  }
  const normalizedParents = [...parents.values()].sort((left, right) => left.parentId.localeCompare(right.parentId)).map((parent) => ({
    ...parent,
    sourceOccurrenceIds: [...parent.sourceOccurrenceIds].sort(),
    sourceRefIds: [...parent.sourceRefIds].sort(),
    observations: [...parent.observations].sort((left, right) => left.occurrenceId.localeCompare(right.occurrenceId)),
    detailRef: `details/restaurants/${parent.parentId.slice("dohmh:camis:".length)}.json`,
  }));
  const locatedParentCount = normalizedParents.filter((parent) => parent.locationStatus === "located").length;
  const unlocatedParentCount = normalizedParents.length - locatedParentCount;
  return {
    parents: normalizedParents,
    metrics: {
      sourceRows: rawRows.length,
      normalizedOccurrences: occurrences.length,
      rejectedOccurrences: 0,
      camisParents: normalizedParents.length,
      locatedParents: locatedParentCount,
      unlocatedParents: unlocatedParentCount,
      duplicateGroups: multiset.metrics.duplicateGroupCount,
      duplicateExcess: multiset.metrics.duplicateExcessCount,
      maximumMultiplicity: multiset.metrics.maximumMultiplicity,
      multisetDigest: multiset.metrics.multisetDigest,
      rawSha256: dohmhManifest.captures.a.sha256,
      rawBytes: dohmhManifest.captures.a.bytes,
      identityCollisionCount: 0,
      accountingRemainder: rawRows.length - occurrences.length,
    },
  };
}

function normalizeBuildingFeatures(rawCollection, adapter, buildingManifest, entry) {
  const objectIdByDoitt = new Map(rawCollection.features.map((feature) => [String(feature?.properties?.DOITT_ID), Number(feature?.properties?.OBJECTID)]));
  const features = adapter.getFeatures().sort((left, right) => left.id.localeCompare(right.id));
  const records = features.map((feature) => {
    const sourceRecordId = String(feature.sourceRefs[0]?.sourceRecordId ?? "");
    return {
      parentId: `doitt:${sourceRecordId}`,
      partId: feature.id,
      partIndex: Number(feature.attributes.geometryPartIndex ?? 0),
      partCount: Number(feature.attributes.geometryPartCount ?? 1),
      objectId: objectIdByDoitt.get(sourceRecordId) ?? null,
      doittId: sourceRecordId,
      bin: feature.attributes.bin ?? null,
      baseBbl: feature.attributes.baseBbl ?? null,
      mapPlutoBbl: feature.attributes.mapPlutoBbl ?? null,
      name: feature.name,
      geometry: feature.geometry,
      coordinates: feature.coordinates,
      heightMeters: feature.geometryProvenance.height.valueMeters,
      heightUnknown: feature.geometryProvenance.height.valueMeters === null,
      sourceRefId: feature.sourceRefs[0]?.id ?? null,
    };
  });
  const parentIds = new Set(records.map((record) => record.parentId));
  if (parentIds.size !== buildingManifest.rawSnapshot.featureCount || records.some((record) => record.objectId === null)) throw new Error("Citywide building normalization lost a source OBJECTID/DOITT parent.");
  return {
    records,
    metrics: {
      sourceRecords: buildingManifest.rawSnapshot.featureCount,
      normalizedParts: records.length,
      normalizedParents: parentIds.size,
      rejectedRecords: adapter.getIngestionReport().rejectedCount,
      identityCollisionCount: 0,
      accountingRemainder: buildingManifest.rawSnapshot.featureCount - adapter.getIngestionReport().acceptedCount - adapter.getIngestionReport().rejectedCount,
      rawSha256: buildingManifest.rawSnapshot.sha256,
      rawBytes: buildingManifest.rawSnapshot.bytes,
      acceptedObjectIdsSha256: buildingManifest.accounting.objectIdsSha256,
      noClipScope: true,
      sourceRegistryEntryId: entry.id,
    },
  };
}

function anchorCoverage(buildings, restaurants) {
  return ANCHORS.map(([id, label, longitude, latitude]) => {
    const near = (coordinates) => Array.isArray(coordinates) && Math.abs(coordinates[0] - longitude) <= 0.02 && Math.abs(coordinates[1] - latitude) <= 0.02;
    const buildingCount = buildings.records.filter((record) => near(record.coordinates)).length;
    const restaurantCount = restaurants.parents.filter((record) => near(record.coordinates)).length;
    if (buildingCount === 0 || restaurantCount === 0) throw new Error(`Source-backed anchor ${id} has empty coverage.`);
    return { id, label, longitude, latitude, buildingCount, restaurantCount, sourceBacked: true };
  });
}

async function run() {
  const values = parseArgs(process.argv.slice(2));
  const release = String(values.release ?? RELEASE);
  const rawRoot = resolve(String(values["raw-root"] ?? `data/raw/${release}`));
  const outputRoot = resolve(String(values["output-root"] ?? `data/generated/${release}`));
  if (release !== RELEASE) throw new Error(`Release is pinned to ${RELEASE}.`);
  try { await stat(outputRoot); throw new Error(`Refusing to reuse existing normalized root: ${outputRoot}`); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  const buildingRoot = join(rawRoot, "buildings");
  const buildingManifest = await readJson(join(buildingRoot, "manhattan-building-footprints.manifest.json"));
  const buildingText = await readFile(join(buildingRoot, buildingManifest.rawSnapshot.relativePath), "utf8");
  const rawCollection = JSON.parse(buildingText);
  const buildingEntry = sourceEntry("nyc.building-footprints");
  const adapter = await NycBuildingFootprintsSnapshotAdapter.fromSnapshot({
    snapshotText: buildingText,
    metadata: {
      sourceRegistryEntryId: "nyc.building-footprints",
      inputFileName: buildingManifest.rawSnapshot.relativePath,
      inputChecksumSha256: buildingManifest.rawSnapshot.sha256,
      termsUrl: buildingEntry.termsUrl,
      attribution: buildingEntry.attribution,
      releaseTimestamp: null,
      captureTimestamp: buildingManifest.capturedAt,
      updateTimestamp: new Date(Number(buildingManifest.metadata?.lastEditDate ?? 0)).toISOString(),
      ingestedAt: "2026-08-04T00:00:00.000Z",
      inputCrs: "EPSG:4326",
      verticalDatum: "GROUND_ELEVATION source unit unknown; HEIGHT_ROOF relative to source ground",
      heightUnit: "feet",
      groundElevationUnit: "unknown",
      fixtureOnly: false,
      immutable: true,
    },
    scope: "citywide",
  });
  const buildings = normalizeBuildingFeatures(rawCollection, adapter, buildingManifest, buildingEntry);
  const dohmhManifest = await readJson(join(rawRoot, "dohmh-citywide-acquisition.manifest.json"));
  const dohmhText = await readFile(join(rawRoot, dohmhManifest.captures.a.relativePath), "utf8");
  const restaurants = normalizeRestaurantRows(JSON.parse(dohmhText), dohmhManifest, sourceEntry("nyc.dohmh-restaurant-inspections"));
  const anchors = anchorCoverage(buildings, restaurants);
  const pilotReplay = await replayProtectedPilot();
  await mkdir(outputRoot, { recursive: false, mode: 0o700 });
  const buildingTextOut = `${JSON.stringify({ schemaVersion: "citywide-normalized-1", releaseId: release, scope: "citywide-no-clip", records: buildings.records }, null, 2)}\n`;
  const restaurantTextOut = `${JSON.stringify({ schemaVersion: "citywide-normalized-1", releaseId: release, records: restaurants.parents }, null, 2)}\n`;
  const buildingFile = await writeExclusive(join(outputRoot, "buildings.normalized.json"), buildingTextOut);
  const restaurantFile = await writeExclusive(join(outputRoot, "restaurants.normalized.json"), restaurantTextOut);
  const manifest = {
    schemaVersion: "1.0",
    releaseId: release,
    scope: "citywide",
    generatedAt: "2026-08-04T00:00:00.000Z",
    approval: { messageId: "msg_91770ac6d098", exclusions: ["new providers", "Google-derived data", "public deployment", "unrelated datasets"] },
    inputs: {
      buildings: { registryEntryId: buildingEntry.id, datasetId: OTI_DATASET_ID, rawRelativePath: "data/raw/manhattan-citywide-20260804/buildings/manhattan-building-footprints.geojson", rawBytes: buildingManifest.rawSnapshot.bytes, rawSha256: buildingManifest.rawSnapshot.sha256 },
      restaurants: { registryEntryId: "nyc.dohmh-restaurant-inspections", datasetId: DOHMH_DATASET_ID, rawRelativePath: "data/raw/manhattan-citywide-20260804/dohmh-manhattan.snapshot.json", rawBytes: dohmhManifest.captures.a.bytes, rawSha256: dohmhManifest.captures.a.sha256, multisetDigest: dohmhManifest.multiset.digest },
    },
    outputs: { buildings: { relativePath: "buildings.normalized.json", ...buildingFile, sourceRecords: buildings.metrics.sourceRecords, normalizedParts: buildings.metrics.normalizedParts, normalizedParents: buildings.metrics.normalizedParents }, restaurants: { relativePath: "restaurants.normalized.json", ...restaurantFile, sourceRows: restaurants.metrics.sourceRows, normalizedOccurrences: restaurants.metrics.normalizedOccurrences, camisParents: restaurants.metrics.camisParents } },
    buildingMetrics: buildings.metrics,
    restaurantMetrics: restaurants.metrics,
    coverage: { cityId: "manhattan", claim: "snapshot-relative-all-records-accounted", anchors, accountingRemainder: buildings.metrics.accountingRemainder + restaurants.metrics.accountingRemainder, identityCollisionCount: buildings.metrics.identityCollisionCount + restaurants.metrics.identityCollisionCount, pilotReplayStable: pilotReplay.stable },
    pilotReplay,
    immutableInputs: true,
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeExclusive(join(outputRoot, "normalization.manifest.json"), manifestText);
  await writeExclusive(join(outputRoot, "normalization.manifest.sha256"), `${hashText(manifestText)}\n`);
  console.log(JSON.stringify({ outputRoot, buildings: buildings.metrics, restaurants: restaurants.metrics, anchorCount: anchors.length, outputBytes: Buffer.byteLength(buildingTextOut) + Buffer.byteLength(restaurantTextOut) }, null, 2));
}

run().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
