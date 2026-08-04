/* global AbortSignal, Buffer, URL, URLSearchParams, console, fetch, process, setTimeout */

import { createHash } from "node:crypto";
import { mkdir, open, rename, stat, statfs, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  OTI_DIAGNOSTIC_ENVELOPE,
  OTI_EXPECTED_EDIT_DATE,
  OTI_EXPECTED_MANHATTAN_COUNT,
  OTI_EXPECTED_MANHATTAN_SET_SHA256,
  OTI_DATASET_ID,
  compareObjectIdSets,
  hashObjectIds,
  stableJson,
  validateMetadataFingerprint,
  validateOtiBatch,
  validateOtiIdsOnlyResponse,
} from "../src/ingestion/nyc-citywide-building-proof.ts";

const ENDPOINT = "https://services6.arcgis.com/yG5s3afENB5iO9fj/arcgis/rest/services/BUILDING_view/FeatureServer/0/query";
const LAYER_ENDPOINT = "https://services6.arcgis.com/yG5s3afENB5iO9fj/arcgis/rest/services/BUILDING_view/FeatureServer/0";
const RELEASE_DEFAULT = "manhattan-citywide-20260804";
const BUILDING_FIELDS = [
  "OBJECTID", "DOITT_ID", "BIN", "BASE_BBL", "MAPPLUTO_BBL", "CONSTRUCTION_YEAR", "FEATURE_CODE",
  "GEOM_SOURCE", "GROUND_ELEVATION", "HEIGHT_ROOF", "LAST_EDITED_DATE", "LAST_STATUS_TYPE", "NAME",
].join(",");
const BATCH_LIMIT = 250;
const NORMAL_BATCH_COUNT = Math.ceil(OTI_EXPECTED_MANHATTAN_COUNT / BATCH_LIMIT);
const MAX_RAW_BYTES = 300 * 1024 * 1024;
const MAX_PROJECTION_BYTES = 240 * 1024 * 1024;
const MAX_GEOMETRY_RETRIES = 12;
const MAX_TOTAL_REQUESTS = 205;
const HISTORICAL_ENVELOPE = {
  ...OTI_DIAGNOSTIC_ENVELOPE,
  candidateCount: 132_410,
  candidateSha256: "632f3e560cd262c4d5ec88efeab04f853c77058264d887533438f683e02cf7a9",
  envelopeMemberCount: 45_106,
  envelopeMemberSha256: "668afa44b52881518a387297f0e54a81d6b27060064681e63bb434c93f6fabff",
  sourceNotCandidateCount: 88,
  sourceNotCandidateSha256: "567958ebc811f10caa3a90eaf18acdcb5796a74ffcc8f959b72774b31cd0f967",
  exampleOmittedObjectId: 5919,
};

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

function integerArg(values, name, fallback, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  const value = Number(values[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`--${name} must be a safe integer between ${minimum} and ${maximum}.`);
  return value;
}

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

async function exists(path) {
  try { await stat(path); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

async function exclusive(path, value) {
  await writeFile(path, value, { flag: "wx", mode: 0o600 });
}

class OtiRequestError extends Error {
  constructor(message, { transient = false, status = null } = {}) {
    super(message);
    this.name = "OtiRequestError";
    this.transient = transient;
    this.status = status;
  }
}

async function requestJson(url, init, timeoutMs, tracker) {
  tracker.total += 1;
  if (tracker.total > tracker.maxTotal) throw new OtiRequestError(`OTI request budget exceeded at ${tracker.total}.`);
  let response;
  try {
    response = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new OtiRequestError(`OTI request failed: ${error instanceof Error ? error.message : String(error)}.`, { transient: true });
  }
  if (response.status !== 200) throw new OtiRequestError(`OTI request returned HTTP ${response.status}.`, { transient: response.status === 429 || response.status >= 500, status: response.status });
  const text = await response.text();
  let value;
  try { value = JSON.parse(text); } catch { throw new OtiRequestError("OTI response was not valid JSON."); }
  if (value?.error) throw new OtiRequestError(`OTI response contained an error: ${JSON.stringify(value.error)}.`);
  return { response, text, value };
}

async function getJson(url, timeoutMs, tracker) {
  return requestJson(url, { headers: { accept: "application/json", "accept-encoding": "identity" } }, timeoutMs, tracker);
}

async function postJson(params, timeoutMs, tracker, retryable = false) {
  let attempt = 0;
  while (true) {
    try {
      const body = new URLSearchParams(params);
      return await requestJson(ENDPOINT, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", "accept-encoding": "identity" }, body }, timeoutMs, tracker);
    } catch (error) {
      if (!(error instanceof OtiRequestError) || !retryable || !error.transient || attempt >= 2 || tracker.retries >= tracker.maxRetries) throw error;
      tracker.retries += 1;
      attempt += 1;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt === 1 ? 2_000 : 8_000));
    }
  }
}

function queryUrl(where) {
  const query = new URL(ENDPOINT);
  query.search = new URLSearchParams({ where, returnIdsOnly: "true", f: "json" }).toString();
  const serialized = query.toString();
  if (/[?&](?:geometry|geometryType|spatialRel|resultOffset|resultRecordCount)=/i.test(serialized)) throw new Error("Direct membership query unexpectedly contains a geometry, spatial, or pagination parameter.");
  return serialized;
}

async function queryDirectIds(where, name, timeoutMs, tracker, attemptDir) {
  const url = queryUrl(where);
  const query = await getJson(url, timeoutMs, tracker);
  const normalized = validateOtiIdsOnlyResponse(query.value);
  if (normalized.issues.length > 0) throw new Error(`${name} direct ID query invalid: ${normalized.issues[0]?.message}`);
  if (normalized.ids.length !== OTI_EXPECTED_MANHATTAN_COUNT) throw new Error(`${name} direct ID count changed: expected ${OTI_EXPECTED_MANHATTAN_COUNT}, got ${normalized.ids.length}.`);
  const setSha256 = hashObjectIds(normalized.ids);
  if (setSha256 !== OTI_EXPECTED_MANHATTAN_SET_SHA256) throw new Error(`${name} direct ID set hash changed: expected ${OTI_EXPECTED_MANHATTAN_SET_SHA256}, got ${setSha256}.`);
  const record = {
    name,
    where,
    url,
    requestId: query.response.headers.get("x-esri-request-id") ?? null,
    responseHeaders: Object.fromEntries(query.response.headers),
    responseBytes: Buffer.byteLength(query.text),
    responseSha256: sha256(query.text),
    objectIdField: normalized.objectIdField,
    exceededTransferLimit: normalized.exceededTransferLimit,
    count: normalized.ids.length,
    objectIdsSha256: setSha256,
    objectIds: normalized.ids,
  };
  await exclusive(join(attemptDir, `${name}.response.json`), `${query.text}\n`);
  await exclusive(join(attemptDir, `${name}.set.json`), `${JSON.stringify({ ...record, responseBodyRef: `${name}.response.json` }, null, 2)}\n`);
  return { ...record, ids: normalized.ids };
}

function allFiniteGeometry(value) {
  if (!Array.isArray(value)) return false;
  if (value.length >= 2 && value.every((part) => typeof part === "number" && Number.isFinite(part))) return value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90;
  return value.every(allFiniteGeometry);
}

function featureSort(left, right) {
  return Number(left?.properties?.OBJECTID) - Number(right?.properties?.OBJECTID);
}

function stableFeature(feature) {
  return JSON.parse(stableJson(feature));
}

async function writeGeoJsonSnapshot(ids, timeoutMs, batchSize, attemptDir, tracker, maxBytes) {
  const partialPath = join(attemptDir, "manhattan-building-footprints.geojson.partial");
  const finalPath = join(attemptDir, "manhattan-building-footprints.geojson");
  const handle = await open(partialPath, "wx");
  const digest = createHash("sha256");
  const returned = new Set();
  const doitt = new Set();
  let bytes = 0;
  let featureCount = 0;
  let vertexCount = 0;
  let outsideDiagnosticFeatureCount = 0;
  let first = true;
  const requestEvidence = [];
  const write = async (chunk) => {
    const encodedBytes = Buffer.byteLength(chunk);
    bytes += encodedBytes;
    if (bytes > maxBytes) throw new Error(`OTI raw building GeoJSON exceeded ${maxBytes} bytes.`);
    digest.update(chunk);
    await handle.write(chunk);
  };
  try {
    await write('{"type":"FeatureCollection","features":[');
    for (let offset = 0; offset < ids.length; offset += batchSize) {
      const batch = ids.slice(offset, offset + batchSize);
      const query = await postJson({ objectIds: batch.join(","), outFields: BUILDING_FIELDS, returnGeometry: "true", outSR: "4326", f: "geojson" }, timeoutMs, tracker, true);
      if (query.value?.exceededTransferLimit === true || query.value?.exceededTransferLimit === "true") throw new Error(`OTI geometry batch ${Math.floor(offset / batchSize) + 1} exceeded the transfer limit.`);
      const features = Array.isArray(query.value?.features) ? [...query.value.features].sort(featureSort) : [];
      const validation = validateOtiBatch(features, batch, returned);
      if (validation.issues.length > 0) throw new Error(`OTI geometry batch ${Math.floor(offset / batchSize) + 1} invalid: ${validation.issues[0]?.message}`);
      for (const [featureIndex, feature] of features.entries()) {
        const objectId = Number(feature.properties.OBJECTID);
        const doittId = String(feature.properties.DOITT_ID);
        if (doitt.has(doittId)) throw new Error(`OTI geometry returned duplicate DOITT_ID ${doittId}.`);
        returned.add(objectId);
        doitt.add(doittId);
        const geometry = feature.geometry;
        if (!geometry || !allFiniteGeometry(geometry.coordinates)) throw new Error(`OTI geometry contains invalid/non-WGS84 coordinates for OBJECTID ${objectId}.`);
        if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") throw new Error(`OTI geometry type is not Polygon/MultiPolygon for OBJECTID ${objectId}.`);
        const serialized = JSON.stringify(stableFeature(feature));
        await write(`${first ? "" : ","}${serialized}`);
        first = false;
        featureCount += 1;
        vertexCount += validation.vertexCounts[featureIndex] ?? 0;
        if (validation.outsideDiagnosticFeatureFlags[featureIndex]) outsideDiagnosticFeatureCount += 1;
        if (featureCount === 5_000) {
          const projection = Math.ceil((bytes / featureCount) * ids.length);
          if (projection > MAX_PROJECTION_BYTES) throw new Error(`OTI raw projection exceeded ${MAX_PROJECTION_BYTES} bytes at 5000 features (projected ${projection}).`);
        }
      }
      requestEvidence.push({ batch: Math.floor(offset / batchSize) + 1, requested: batch.length, returned: features.length, requestId: query.response.headers.get("x-esri-request-id") ?? null });
      console.log(`OTI geometry batch ${Math.floor(offset / batchSize) + 1}/${Math.ceil(ids.length / batchSize)}: ${features.length}`);
    }
    await write("]}\n");
  } finally {
    await handle.close();
  }
  if (returned.size !== ids.length || doitt.size !== ids.length || featureCount !== ids.length) throw new Error("OTI geometry raw accounting did not reconcile requested IDs, returned IDs, and DOITT parents.");
  await rename(partialPath, finalPath);
  return { path: finalPath, featureCount, bytes, sha256: digest.digest("hex"), returnedObjectIds: [...returned].sort((left, right) => left - right), doittParentCount: doitt.size, vertexCount, outsideDiagnosticFeatureCount, requestEvidence };
}

async function quarantineStage(stageDir, outputRoot, reason) {
  if (!stageDir || !(await exists(stageDir))) return null;
  const quarantineRoot = resolve("data/raw/citywide-recovery-quarantine");
  await mkdir(quarantineRoot, { recursive: true });
  const safeReason = String(reason).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "failed";
  const destination = join(quarantineRoot, `${RELEASE_DEFAULT}-cp2c-direct-${new Date().toISOString().replace(/[-:.TZ]/g, "")}-${safeReason}`);
  await rename(stageDir, destination);
  console.error(`Moved failed OTI building staging to ${destination}; output root ${outputRoot} was not promoted.`);
  return destination;
}

async function run() {
  const values = parseArgs(process.argv.slice(2));
  if (Object.prototype.hasOwnProperty.call(values, "candidate-envelope")) throw new Error("--candidate-envelope is superseded; use --membership-mode direct-bbl-code-1 with no geometry filter.");
  const release = String(values.release ?? RELEASE_DEFAULT);
  const outputRoot = resolve(String(values["output-root"] ?? `data/raw/${release}`));
  const membershipMode = String(values["membership-mode"] ?? "direct-bbl-code-1");
  const batchSize = integerArg(values, "batch-size", BATCH_LIMIT, 1, BATCH_LIMIT);
  const timeoutMs = integerArg(values, "timeout-ms", 30_000, 1_000, 300_000);
  const maxBytes = integerArg(values, "max-bytes", MAX_RAW_BYTES, 1, MAX_RAW_BYTES);
  const maxRetries = integerArg(values, "max-geometry-retries", MAX_GEOMETRY_RETRIES, 0, MAX_GEOMETRY_RETRIES);
  const maxTotalRequests = integerArg(values, "max-total-requests", MAX_TOTAL_REQUESTS, NORMAL_BATCH_COUNT + 6, MAX_TOTAL_REQUESTS);
  if (release !== RELEASE_DEFAULT) throw new Error(`Citywide release ID is pinned to ${RELEASE_DEFAULT}.`);
  if (membershipMode !== "direct-bbl-code-1") throw new Error("--membership-mode must be direct-bbl-code-1.");
  if (batchSize !== BATCH_LIMIT) throw new Error(`--batch-size must remain exactly ${BATCH_LIMIT} for the pinned source truth.`);
  if (maxRetries !== MAX_GEOMETRY_RETRIES) throw new Error(`--max-geometry-retries must remain exactly ${MAX_GEOMETRY_RETRIES}.`);
  if (maxTotalRequests !== MAX_TOTAL_REQUESTS) throw new Error(`--max-total-requests must remain exactly ${MAX_TOTAL_REQUESTS}.`);
  const finalRoot = join(outputRoot, "buildings");
  if (await exists(finalRoot)) throw new Error(`Refusing to reuse existing immutable building root: ${finalRoot}`);
  await mkdir(outputRoot, { recursive: true });
  const disk = await statfs(outputRoot);
  const freeBytes = Number(disk.bavail) * Number(disk.bsize);
  if (freeBytes < 1024 * 1024 * 1024) throw new Error(`OTI building preflight requires at least 1 GiB free disk; observed ${freeBytes} bytes.`);
  const stageDir = join(outputRoot, `buildings.direct-attempt-${process.pid}-${Date.now()}`);
  await mkdir(stageDir, { recursive: false, mode: 0o700 });
  const tracker = { total: 0, retries: 0, maxRetries, maxTotal: maxTotalRequests };
  try {
    await exclusive(join(stageDir, "acquisition-request-contract.json"), `${JSON.stringify({ endpoint: ENDPOINT, layerEndpoint: LAYER_ENDPOINT, datasetId: OTI_DATASET_ID, membershipMode, membershipQueries: ["BASE_BBL LIKE '1%'", "MAPPLUTO_BBL LIKE '1%'"] , noGeometry: true, noEnvelope: true, noSpatialRelation: true, noPagination: true, batchSize, expectedNormalGeometryBatches: NORMAL_BATCH_COUNT, approvalMessageId: "msg_91770ac6d098", exclusions: ["new providers", "Google-derived data", "public deployment", "unrelated datasets"] }, null, 2)}\n`);
    const metadataBefore = await getJson(`${LAYER_ENDPOINT}?f=pjson`, timeoutMs, tracker);
    const metadataBeforeValidation = validateMetadataFingerprint(metadataBefore.value);
    if (metadataBeforeValidation.issues.length > 0) throw new Error(`OTI metadata preflight failed: ${metadataBeforeValidation.issues[0]?.message}`);
    if (metadataBeforeValidation.value.lastEditDate !== OTI_EXPECTED_EDIT_DATE) throw new Error(`OTI editingInfo.lastEditDate changed: expected ${OTI_EXPECTED_EDIT_DATE}, got ${metadataBeforeValidation.value.lastEditDate}.`);
    await exclusive(join(stageDir, "source-layer.metadata.pre.json"), `${metadataBefore.text}\n`);
    await exclusive(join(stageDir, "source-layer.metadata.pre.headers.json"), `${JSON.stringify(Object.fromEntries(metadataBefore.response.headers), null, 2)}\n`);
    const preBase = await queryDirectIds("BASE_BBL LIKE '1%'", "pre-base-bbl", timeoutMs, tracker, stageDir);
    const preMap = await queryDirectIds("MAPPLUTO_BBL LIKE '1%'", "pre-mappluto-bbl", timeoutMs, tracker, stageDir);
    const preSets = compareObjectIdSets(preBase.ids, preMap.ids);
    if (!preSets.equal) throw new Error(`OTI direct BASE/MAP preflight sets differ: ${preSets.onlyLeft.length}/${preSets.onlyRight.length}.`);
    const snapshot = await writeGeoJsonSnapshot(preBase.ids, timeoutMs, batchSize, stageDir, tracker, maxBytes);
    const metadataAfter = await getJson(`${LAYER_ENDPOINT}?f=pjson`, timeoutMs, tracker);
    const metadataAfterValidation = validateMetadataFingerprint(metadataAfter.value, metadataBeforeValidation.value);
    if (metadataAfterValidation.issues.length > 0) throw new Error(`OTI metadata postflight failed: ${metadataAfterValidation.issues[0]?.message}`);
    await exclusive(join(stageDir, "source-layer.metadata.post.json"), `${metadataAfter.text}\n`);
    await exclusive(join(stageDir, "source-layer.metadata.post.headers.json"), `${JSON.stringify(Object.fromEntries(metadataAfter.response.headers), null, 2)}\n`);
    const postBase = await queryDirectIds("BASE_BBL LIKE '1%'", "post-base-bbl", timeoutMs, tracker, stageDir);
    const postMap = await queryDirectIds("MAPPLUTO_BBL LIKE '1%'", "post-mappluto-bbl", timeoutMs, tracker, stageDir);
    for (const [left, right, label] of [[preBase, postBase, "BASE pre/post"], [preMap, postMap, "MAPPLUTO pre/post"], [postBase, postMap, "BASE/MAP post"]]) {
      if (!compareObjectIdSets(left.ids, right.ids).equal) throw new Error(`OTI ${label} direct sets differ.`);
    }
    const rawRelativePath = "buildings/manhattan-building-footprints.geojson";
    const rawManifest = {
      relativePath: "manhattan-building-footprints.geojson",
      featureCount: snapshot.featureCount,
      bytes: snapshot.bytes,
      sha256: snapshot.sha256,
      batchSize,
      normalGeometryBatches: NORMAL_BATCH_COUNT,
      geometryRequestCount: snapshot.requestEvidence.length,
      objectIdsSortedUnique: true,
      allRequestedReturnedExactlyOnce: true,
      uniqueDoittParentCount: snapshot.doittParentCount,
      vertexCount: snapshot.vertexCount,
      outsideDiagnosticEnvelopeFeatureCount: snapshot.outsideDiagnosticFeatureCount,
      projectionGateBytes: MAX_PROJECTION_BYTES,
      maxBytes,
    };
    const manifest = {
      schemaVersion: "1.1",
      releaseId: release,
      source: { provider: "NYC Office of Technology and Innovation (OTI) GIS", datasetId: OTI_DATASET_ID, layerEndpoint: LAYER_ENDPOINT, queryEndpoint: ENDPOINT, fields: BUILDING_FIELDS.split(","), outputCrs: "EPSG:4326", objectIdField: "OBJECTID", stableParentField: "DOITT_ID" },
      approval: { messageId: "msg_91770ac6d098", scope: "local all-Manhattan raw retention, derived artifacts, and browser display for OTI jh45-qr5r only", exclusions: ["new providers", "Google-derived data", "public deployment", "unrelated datasets"] },
      membership: {
        mode: membershipMode,
        claim: "snapshot-relative source-internal OTI membership; not a legal borough boundary",
        baseWhere: "BASE_BBL LIKE '1%'",
        mapplutoWhere: "MAPPLUTO_BBL LIKE '1%'",
        preBaseCount: preBase.count,
        preMapplutoCount: preMap.count,
        postBaseCount: postBase.count,
        postMapplutoCount: postMap.count,
        expectedCount: OTI_EXPECTED_MANHATTAN_COUNT,
        expectedSetSha256: OTI_EXPECTED_MANHATTAN_SET_SHA256,
        preBaseSetSha256: preBase.objectIdsSha256,
        preMapplutoSetSha256: preMap.objectIdsSha256,
        postBaseSetSha256: postBase.objectIdsSha256,
        postMapplutoSetSha256: postMap.objectIdsSha256,
        equality: true,
        noGeometry: true,
        noEnvelope: true,
        noSpatialRelation: true,
        noPagination: true,
      },
      historicalEnvelope: HISTORICAL_ENVELOPE,
      metadata: { beforeFingerprint: metadataBeforeValidation.value.fingerprint, afterFingerprint: metadataAfterValidation.value.fingerprint, lastEditDate: metadataBeforeValidation.value.lastEditDate, beforeResponseSha256: sha256(metadataBefore.text), afterResponseSha256: sha256(metadataAfter.text) },
      rawSnapshot: rawManifest,
      accounting: { requestedObjectIds: preBase.count, returnedObjectIds: snapshot.returnedObjectIds.length, acceptedObjectIds: snapshot.featureCount, uniqueDoittParents: snapshot.doittParentCount, rejectedOrQuarantinedRecords: 0, unexplainedRemainder: 0, objectIdsSha256: hashObjectIds(snapshot.returnedObjectIds) },
      requests: { metadata: 2, directMembership: 4, normalGeometry: NORMAL_BATCH_COUNT, retries: tracker.retries, total: tracker.total, maxTotal: maxTotalRequests, maxRetries },
      geometry: { requestEvidence: snapshot.requestEvidence, acceptedTypes: ["Polygon", "MultiPolygon"], diagnosticEnvelope: OTI_DIAGNOSTIC_ENVELOPE, outsideEnvelopeIsDiagnosticOnly: true },
      capturedAt: new Date().toISOString(),
      immutable: true,
      rawRelativePath,
    };
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    await exclusive(join(stageDir, "manhattan-building-footprints.manifest.json"), manifestText);
    await exclusive(join(stageDir, "manhattan-building-footprints.manifest.sha256"), `${sha256(manifestText)}\n`);
    if (tracker.total > MAX_TOTAL_REQUESTS || tracker.retries > MAX_GEOMETRY_RETRIES) throw new Error("OTI request/retry budget did not pass.");
    await rename(stageDir, finalRoot);
    console.log(JSON.stringify({ outputRoot, finalRoot, release, membershipCount: preBase.count, membershipSha256: preBase.objectIdsSha256, featureCount: snapshot.featureCount, bytes: snapshot.bytes, sha256: snapshot.sha256, outsideDiagnosticEnvelopeFeatureCount: snapshot.outsideDiagnosticFeatureCount, retries: tracker.retries, totalRequests: tracker.total }, null, 2));
  } catch (error) {
    await quarantineStage(stageDir, outputRoot, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

run().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
