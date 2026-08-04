/* global TextDecoder, console, process */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  assertDohmhTruth,
  buildDohmhMultiset,
  compareDohmhMultisets,
  DOHMH_CITYWIDE_EXPECTED_CAMIS,
  DOHMH_CITYWIDE_EXPECTED_ROWS,
  DOHMH_CITYWIDE_MAX_BYTES,
  metadataFingerprint,
  validateDohmhResponseBytes,
  validateDohmhRows,
} from "../src/ingestion/dohmh-citywide-snapshot.ts";
import {
  OTI_EXPECTED_MANHATTAN_COUNT,
  OTI_EXPECTED_MANHATTAN_SET_SHA256,
  hashObjectIds,
  validateOtiFeature,
} from "../src/ingestion/nyc-citywide-building-proof.ts";

function args(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index]?.startsWith("--")) continue;
    const token = argv[index];
    const equals = token.indexOf("=");
    if (equals > 2) output[token.slice(2, equals)] = token.slice(equals + 1);
    else { output[token.slice(2)] = argv[index + 1]; index += 1; }
  }
  return output;
}

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

async function readJson(path) { return JSON.parse(await readFile(path, "utf8")); }

async function checkFile(root, relativePath, expectedBytes, expectedSha) {
  if (typeof relativePath !== "string" || relativePath.startsWith("/") || relativePath.includes("..") || relativePath.includes("\\") || relativePath.includes("://")) throw new Error("Raw manifest contains an unsafe file ref.");
  const path = join(root, relativePath);
  const bytes = await readFile(path);
  if (bytes.byteLength !== expectedBytes) throw new Error(`Raw byte size mismatch for ${relativePath}.`);
  const actualSha = sha256(bytes);
  if (actualSha !== expectedSha) throw new Error(`Raw SHA-256 mismatch for ${relativePath}.`);
  return bytes;
}

async function validateDohmhCapture(root, capture, expectedRows, expectedCamis) {
  const bytes = await checkFile(root, capture.relativePath, capture.bytes, capture.sha256);
  validateDohmhResponseBytes(bytes.byteLength, DOHMH_CITYWIDE_MAX_BYTES);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const rows = JSON.parse(text);
  const canonical = validateDohmhRows(rows, expectedRows);
  const multiset = buildDohmhMultiset(canonical, expectedRows);
  assertDohmhTruth(multiset.metrics, expectedRows, expectedCamis);
  if (multiset.metrics.multisetDigest !== capture.metrics.multisetDigest || multiset.metrics.duplicateGroupCount !== capture.metrics.duplicateGroupCount || multiset.metrics.duplicateExcessCount !== capture.metrics.duplicateExcessCount || multiset.metrics.maximumMultiplicity !== capture.metrics.maximumMultiplicity || multiset.metrics.camisCount !== capture.metrics.camisCount) throw new Error(`Raw capture metrics differ from immutable manifest for ${capture.relativePath}.`);
  return multiset;
}

async function validateDohmhRoot(root) {
  const manifest = await readJson(join(root, "dohmh-citywide-acquisition.manifest.json"));
  if (manifest.source?.datasetId !== "43nn-pn8j" || manifest.query?.where !== "boro='Manhattan'" || manifest.query?.noOffset !== true || manifest.query?.noOrder !== true || manifest.query?.noSystemId !== true || manifest.query?.noToken !== true) throw new Error("Raw manifest scope/query is not the approved DOHMH recovery contract.");
  if (manifest.query.limit !== DOHMH_CITYWIDE_EXPECTED_ROWS + 1 || manifest.query.select?.length !== 31) throw new Error("Raw manifest query limit/field contract is invalid.");
  if (manifest.approval?.messageId !== "msg_91770ac6d098") throw new Error("Raw manifest is missing the durable citywide approval ID.");
  const metadata = await readJson(join(root, "pre-a.metadata.json"));
  const metadataResult = metadataFingerprint(metadata);
  if (!metadataResult.ok || metadataResult.value.fingerprint !== manifest.metadata.schemaFingerprint) throw new Error("Raw metadata fingerprint mismatch.");
  const left = await validateDohmhCapture(root, manifest.captures.a, DOHMH_CITYWIDE_EXPECTED_ROWS, DOHMH_CITYWIDE_EXPECTED_CAMIS);
  const right = await validateDohmhCapture(root, manifest.captures.b, DOHMH_CITYWIDE_EXPECTED_ROWS, DOHMH_CITYWIDE_EXPECTED_CAMIS);
  const mismatch = compareDohmhMultisets(left, right);
  if (mismatch) throw new Error(`Raw A/B multiset mismatch at ${mismatch.field}.`);
  if (left.metrics.multisetDigest !== manifest.multiset.digest) throw new Error("Raw multiset digest differs from manifest.");
  return { rows: left.metrics.rowCount, camis: left.metrics.camisCount, uniqueCanonicalRows: left.metrics.uniqueCanonicalRowCount, duplicateGroups: left.metrics.duplicateGroupCount, duplicateExcess: left.metrics.duplicateExcessCount, maximumMultiplicity: left.metrics.maximumMultiplicity, multisetDigest: left.metrics.multisetDigest, rawBytes: manifest.captures.a.bytes, replayBytes: manifest.captures.b.bytes };
}

async function validateBuildingRoot(root) {
  const buildingsRoot = join(root, "buildings");
  const manifest = await readJson(join(buildingsRoot, "manhattan-building-footprints.manifest.json"));
  if (manifest.releaseId !== "manhattan-citywide-20260804" || manifest.source?.datasetId !== "jh45-qr5r" || manifest.source?.objectIdField !== "OBJECTID" || manifest.source?.stableParentField !== "DOITT_ID" || manifest.source?.outputCrs !== "EPSG:4326") throw new Error("Building manifest source identity/CRS contract is invalid.");
  if (manifest.approval?.messageId !== "msg_91770ac6d098" || manifest.membership?.mode !== "direct-bbl-code-1" || manifest.membership?.noGeometry !== true || manifest.membership?.noEnvelope !== true || manifest.membership?.noSpatialRelation !== true || manifest.membership?.noPagination !== true) throw new Error("Building manifest does not prove the approved direct no-envelope membership contract.");
  if (manifest.membership.expectedCount !== OTI_EXPECTED_MANHATTAN_COUNT || manifest.membership.expectedSetSha256 !== OTI_EXPECTED_MANHATTAN_SET_SHA256) throw new Error("Building manifest expected direct-set pin is invalid.");
  if (manifest.requests?.normalGeometry !== 181 || manifest.requests?.total > 205 || manifest.requests?.retries > 12) throw new Error("Building request/retry budget is invalid.");
  const raw = manifest.rawSnapshot;
  const bytes = await checkFile(buildingsRoot, raw.relativePath, raw.bytes, raw.sha256);
  if (raw.featureCount !== OTI_EXPECTED_MANHATTAN_COUNT || raw.uniqueDoittParentCount !== OTI_EXPECTED_MANHATTAN_COUNT || raw.outsideDiagnosticEnvelopeFeatureCount <= 0) throw new Error("Building raw count/parent/outside-diagnostic contract is invalid.");
  const collection = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (collection?.type !== "FeatureCollection" || !Array.isArray(collection.features) || collection.features.length !== OTI_EXPECTED_MANHATTAN_COUNT) throw new Error("Building raw GeoJSON FeatureCollection count is invalid.");
  const ids = [];
  const doitt = new Set();
  const seen = new Set();
  let vertices = 0;
  let outsideDiagnosticFeatureCount = 0;
  for (const [index, feature] of collection.features.entries()) {
    const result = validateOtiFeature(feature);
    if (result.issues.length > 0) throw new Error(`Building feature ${index} invalid: ${result.issues[0]?.message}`);
    if (result.objectId === null || result.doittId === null || seen.has(result.objectId) || doitt.has(result.doittId)) throw new Error(`Building feature ${index} has duplicate/missing source identity.`);
    if (index > 0 && Number(collection.features[index - 1]?.properties?.OBJECTID) >= result.objectId) throw new Error("Building raw features are not in deterministic OBJECTID order.");
    seen.add(result.objectId); ids.push(result.objectId); doitt.add(result.doittId); vertices += result.vertexCount;
    if (result.outsideDiagnosticEnvelope) outsideDiagnosticFeatureCount += 1;
  }
  if (hashObjectIds(ids) !== OTI_EXPECTED_MANHATTAN_SET_SHA256 || ids.length !== OTI_EXPECTED_MANHATTAN_COUNT || doitt.size !== OTI_EXPECTED_MANHATTAN_COUNT) throw new Error("Building raw OBJECTID/DOITT accounting differs from the direct membership proof.");
  if (outsideDiagnosticFeatureCount !== raw.outsideDiagnosticEnvelopeFeatureCount || vertices !== raw.vertexCount) throw new Error("Building raw geometry metrics differ from manifest.");
  if (!ids.includes(48190) || !ids.includes(5919)) throw new Error("Building raw does not retain OBJECTID 48190 and the historical envelope-omitted source member 5919.");
  for (const name of ["pre-base-bbl", "pre-mappluto-bbl", "post-base-bbl", "post-mappluto-bbl"]) {
    const record = await readJson(join(buildingsRoot, `${name}.set.json`));
    if (record.objectIdField !== "OBJECTID" || record.exceededTransferLimit === true || record.count !== OTI_EXPECTED_MANHATTAN_COUNT || record.objectIdsSha256 !== OTI_EXPECTED_MANHATTAN_SET_SHA256 || hashObjectIds(record.objectIds) !== OTI_EXPECTED_MANHATTAN_SET_SHA256) throw new Error(`${name} IDs-only evidence failed field/transfer/count/hash validation.`);
  }
  if (manifest.accounting?.requestedObjectIds !== OTI_EXPECTED_MANHATTAN_COUNT || manifest.accounting?.returnedObjectIds !== OTI_EXPECTED_MANHATTAN_COUNT || manifest.accounting?.acceptedObjectIds !== OTI_EXPECTED_MANHATTAN_COUNT || manifest.accounting?.uniqueDoittParents !== OTI_EXPECTED_MANHATTAN_COUNT || manifest.accounting?.unexplainedRemainder !== 0) throw new Error("Building manifest accounting remainder is nonzero.");
  return { features: ids.length, doittParents: doitt.size, bytes: raw.bytes, sha256: raw.sha256, objectIdsSha256: hashObjectIds(ids), vertices, outsideDiagnosticFeatureCount, requests: manifest.requests };
}

async function run() {
  const values = args(process.argv.slice(2));
  const root = resolve(String(values.root ?? "data/raw/manhattan-citywide-20260804"));
  const dohmh = await validateDohmhRoot(root);
  const buildings = await validateBuildingRoot(root);
  console.log(JSON.stringify({ root, valid: true, dohmh, buildings }, null, 2));
}

run().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
