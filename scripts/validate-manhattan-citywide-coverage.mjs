/* global console, process */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { hashObjectIds, OTI_EXPECTED_MANHATTAN_COUNT, OTI_EXPECTED_MANHATTAN_SET_SHA256, validateOtiFeature } from "../src/ingestion/nyc-citywide-building-proof.ts";

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

async function readJson(path) { return JSON.parse(await readFile(path, "utf8")); }

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

async function validateImmutableBuildingInput(rawRoot, normalizedManifest) {
  const buildingRoot = join(rawRoot, "buildings");
  const acquisitionManifestPath = join(buildingRoot, "manhattan-building-footprints.manifest.json");
  const acquisitionManifest = await readJson(acquisitionManifestPath);
  const snapshot = acquisitionManifest.rawSnapshot;
  if (!snapshot || typeof snapshot.relativePath !== "string" || snapshot.relativePath.includes("..") || snapshot.relativePath.includes("/")) throw new Error("Immutable OTI acquisition manifest has an unsafe raw snapshot path.");
  if (acquisitionManifest.source?.datasetId !== "jh45-qr5r" || acquisitionManifest.source?.objectIdField !== "OBJECTID" || acquisitionManifest.source?.stableParentField !== "DOITT_ID") throw new Error("Immutable OTI acquisition manifest source identity is invalid.");
  const rawPath = join(buildingRoot, snapshot.relativePath);
  const rawBytes = await readFile(rawPath);
  const rawSha256 = sha256(rawBytes);
  if (rawBytes.byteLength !== snapshot.bytes || rawSha256 !== snapshot.sha256) throw new Error("Immutable OTI raw bytes do not match the acquisition manifest.");
  const collection = JSON.parse(rawBytes.toString("utf8"));
  if (collection?.type !== "FeatureCollection" || !Array.isArray(collection.features) || collection.features.length !== OTI_EXPECTED_MANHATTAN_COUNT || collection.features.length !== snapshot.featureCount) throw new Error("Immutable OTI raw feature count/schema does not match the acquisition manifest.");
  const objectIds = [];
  const doittIds = [];
  const issues = [];
  for (const [index, feature] of collection.features.entries()) {
    const result = validateOtiFeature(feature);
    if (result.issues.length > 0 && issues.length < 5) issues.push(...result.issues.slice(0, 5).map((issue) => ({ ...issue, path: `features[${index}].${issue.path}` })));
    if (result.objectId !== null) objectIds.push(result.objectId);
    if (result.doittId !== null) doittIds.push(result.doittId);
  }
  if (issues.length > 0) throw new Error(`Immutable OTI raw feature validation failed: ${JSON.stringify(issues)}`);
  const sortedObjectIds = [...objectIds].sort((left, right) => left - right);
  const objectIdsSha256 = hashObjectIds(sortedObjectIds);
  if (new Set(objectIds).size !== OTI_EXPECTED_MANHATTAN_COUNT || objectIdsSha256 !== OTI_EXPECTED_MANHATTAN_SET_SHA256) throw new Error("Immutable OTI raw OBJECTID set does not match the approved acquisition set.");
  if (new Set(doittIds).size !== OTI_EXPECTED_MANHATTAN_COUNT) throw new Error("Immutable OTI raw DOITT parent identity is not unique.");
  const expectedManifestValues = {
    rawBytes: snapshot.bytes,
    rawSha256: snapshot.sha256,
    sourceRecords: snapshot.featureCount,
    acceptedObjectIdsSha256: acquisitionManifest.accounting?.objectIdsSha256,
  };
  if (expectedManifestValues.rawBytes !== rawBytes.byteLength || expectedManifestValues.rawSha256 !== rawSha256 || expectedManifestValues.sourceRecords !== collection.features.length || expectedManifestValues.acceptedObjectIdsSha256 !== objectIdsSha256) throw new Error("Immutable OTI acquisition manifest accounting does not match its raw artifact.");
  const normalizedInput = normalizedManifest.inputs?.buildings;
  const normalizedMetrics = normalizedManifest.buildingMetrics;
  if (!normalizedInput || !normalizedMetrics || normalizedInput.rawBytes !== rawBytes.byteLength || normalizedInput.rawSha256 !== rawSha256 || normalizedMetrics.rawBytes !== rawBytes.byteLength || normalizedMetrics.rawSha256 !== rawSha256 || normalizedMetrics.sourceRecords !== collection.features.length || normalizedMetrics.acceptedObjectIdsSha256 !== objectIdsSha256) throw new Error("Normalized building input is not independently consistent with the immutable OTI raw artifact.");
  return { acquisitionManifestPath, rawPath, bytes: rawBytes.byteLength, sha256: rawSha256, featureCount: collection.features.length, objectIdsSha256, doittParentCount: new Set(doittIds).size };
}

async function run() {
  const values = args(process.argv.slice(2));
  const rawRoot = resolve(String(values["raw-root"] ?? "data/raw/manhattan-citywide-20260804"));
  const normalizedRoot = resolve(String(values["normalized-root"] ?? "data/generated/manhattan-citywide-20260804"));
  const manifest = await readJson(join(normalizedRoot, "normalization.manifest.json"));
  const buildings = manifest.buildingMetrics;
  const restaurants = manifest.restaurantMetrics;
  const coverage = manifest.coverage;
  if (manifest.releaseId !== "manhattan-citywide-20260804" || manifest.scope !== "citywide" || manifest.approval?.messageId !== "msg_91770ac6d098") throw new Error("Normalization scope/approval evidence is invalid.");
  if (buildings.sourceRecords !== 45194 || buildings.normalizedParents !== 45194 || buildings.rejectedRecords !== 0 || buildings.identityCollisionCount !== 0 || buildings.accountingRemainder !== 0 || buildings.noClipScope !== true) throw new Error("Building normalization accounting/no-clip gate failed.");
  if (restaurants.sourceRows !== 109386 || restaurants.normalizedOccurrences !== 109386 || restaurants.rejectedOccurrences !== 0 || restaurants.camisParents !== 12439 || restaurants.identityCollisionCount !== 0 || restaurants.accountingRemainder !== 0 || restaurants.duplicateGroups <= 0 || restaurants.duplicateExcess <= 0) throw new Error("DOHMH normalization accounting/multiplicity gate failed.");
  if (coverage.accountingRemainder !== 0 || coverage.identityCollisionCount !== 0 || coverage.pilotReplayStable !== true || manifest.pilotReplay?.stable !== true || typeof manifest.pilotReplay?.comparison !== "string" || !manifest.pilotReplay?.canonicalIdentityDigest || !manifest.pilotReplay?.heightDigest || !manifest.pilotReplay?.semanticDigest || !Array.isArray(coverage.anchors) || coverage.anchors.length !== 7 || coverage.anchors.some((anchor) => anchor.sourceBacked !== true || anchor.buildingCount <= 0 || anchor.restaurantCount <= 0)) throw new Error("Citywide source-backed anchor or protected pilot replay coverage is incomplete.");
  if (restaurants.unlocatedParents <= 0) throw new Error("Accepted DOHMH truth lost all unlocated CAMIS parents.");
  const buildingEvidence = await validateImmutableBuildingInput(rawRoot, manifest);
  const rawManifest = await readJson(join(rawRoot, "dohmh-citywide-acquisition.manifest.json"));
  if (restaurants.multisetDigest !== rawManifest.multiset.digest || restaurants.rawSha256 !== rawManifest.captures.a.sha256) throw new Error("Normalized DOHMH truth does not match the immutable raw manifest.");
  console.log(JSON.stringify({ normalizedRoot, valid: true, buildings, restaurants, buildingEvidence, pilotReplay: manifest.pilotReplay, coverage: { anchors: coverage.anchors.length, accountingRemainder: coverage.accountingRemainder, identityCollisionCount: coverage.identityCollisionCount } }, null, 2));
}

run().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
