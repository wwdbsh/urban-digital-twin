/* global AbortSignal, TextDecoder, TextEncoder, URL, URLSearchParams, console, fetch, process */

import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  assertApprovedDohmhUrl,
  assertDohmhTruth,
  buildDohmhMultiset,
  buildDohmhQueryUrl,
  compareDohmhMultisets,
  compareSourceTruth,
  DOHMH_CITYWIDE_COLUMN_TYPES,
  DOHMH_CITYWIDE_DATASET_ID,
  DOHMH_CITYWIDE_ENDPOINT,
  DOHMH_CITYWIDE_EXPECTED_CAMIS,
  DOHMH_CITYWIDE_EXPECTED_ROWS,
  DOHMH_CITYWIDE_FIELDS,
  DOHMH_CITYWIDE_MAX_BYTES,
  DOHMH_CITYWIDE_METADATA_ENDPOINT,
  DOHMH_CITYWIDE_RESPONSE_TYPES,
  DOHMH_CITYWIDE_WHERE,
  metadataFingerprint,
  redactTruthMismatch,
  validateDohmhRows,
} from "../src/ingestion/dohmh-citywide-snapshot.ts";

const RELEASE_DEFAULT = "manhattan-citywide-20260804";
const APPROVAL_ID = "msg_91770ac6d098";
const TERMS_URL = "https://www.nyc.gov/html/datamine/html/data/terms.html?dataSetJs=raw";
const ATTRIBUTION = "Source: NYC Department of Health and Mental Hygiene (DOHMH), DOHMH New York City Restaurant Inspection Results, dataset 43nn-pn8j.";

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) continue;
    const assignment = token.indexOf("=");
    if (assignment > 2) values[token.slice(2, assignment)] = token.slice(assignment + 1);
    else { values[token.slice(2)] = argv[index + 1]; index += 1; }
  }
  return values;
}

function requiredInteger(values, name, fallback, minimum = 0) {
  const value = Number(values[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error("--" + name + " must be a safe integer >= " + minimum + ".");
  return value;
}

function nowIso() { return new Date().toISOString(); }

function sha256Bytes(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

function sha256FileBytes(bytes) { return sha256Bytes(bytes); }

function textDecoder(bytes) {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function writeExclusive(path, value, encoding = "utf8") {
  await writeFile(path, value, { flag: "wx", encoding });
}

async function pathExists(path) {
  try { await stat(path); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

async function fetchBytes(url, init, timeoutMs) {
  const response = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
  if (response.status !== 200) throw new Error("Official DOHMH request returned HTTP " + response.status + ".");
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { response, bytes };
}

function responseHeaders(response) {
  const wanted = [
    "date", "etag", "last-modified", "content-type", "content-encoding", "content-length",
    "x-socrata-requestid", "x-soda2-data-out-of-date", "x-soda2-secondary-last-modified",
    "x-soda2-truth-last-modified", "x-soda2-fields", "x-soda2-types",
  ];
  return Object.fromEntries(wanted.map((key) => [key, response.headers.get(key)]));
}

function headerTruth(headers, schemaFingerprint, rowCount, camisCount, metadata) {
  return {
    datasetId: DOHMH_CITYWIDE_DATASET_ID,
    schemaFingerprint,
    rowsUpdatedAt: metadata.rowsUpdatedAt,
    viewLastModified: metadata.viewLastModified,
    lastModified: headers["last-modified"] ?? null,
    secondaryLastModified: headers["x-soda2-secondary-last-modified"] ?? null,
    outOfDate: headers["x-soda2-data-out-of-date"] ?? null,
    rowCount,
    camisCount,
  };
}

function parseCount(value) {
  if (!Array.isArray(value) || value.length !== 1 || !value[0] || typeof value[0] !== "object") throw new Error("DOHMH aggregate count response is malformed.");
  const count = Number(value[0].count);
  const camis = Number(value[0].unique_camis);
  if (!Number.isSafeInteger(count) || !Number.isSafeInteger(camis)) throw new Error("DOHMH aggregate count response is not integral.");
  return { count, camis };
}

function countUrl() {
  const url = new URL(DOHMH_CITYWIDE_ENDPOINT);
  url.search = new URLSearchParams({ "$select": "count(*) as count,count(distinct camis) as unique_camis", "$where": DOHMH_CITYWIDE_WHERE }).toString();
  return url.toString();
}

function selectedHeaderFields(headers) {
  const fields = JSON.parse(headers["x-soda2-fields"] ?? "null");
  const types = JSON.parse(headers["x-soda2-types"] ?? "null");
  if (!Array.isArray(fields) || !Array.isArray(types) || fields.length !== DOHMH_CITYWIDE_FIELDS.length || types.length !== DOHMH_CITYWIDE_COLUMN_TYPES.length) throw new Error("DOHMH response omitted official 31-field/type headers.");
  const expectedFields = [...DOHMH_CITYWIDE_FIELDS];
  const expectedTypes = [...DOHMH_CITYWIDE_RESPONSE_TYPES];
  if (JSON.stringify(fields) !== JSON.stringify(expectedFields) || JSON.stringify(types) !== JSON.stringify(expectedTypes)) throw new Error("DOHMH response fields/types differ from the pinned 31-field contract.");
}

async function preflight(attemptDir, phase, expectedRows, expectedCamis, timeoutMs) {
  const metadataResponse = await fetchBytes(DOHMH_CITYWIDE_METADATA_ENDPOINT, { headers: { accept: "application/json", "accept-encoding": "identity" } }, timeoutMs);
  const metadataText = textDecoder(metadataResponse.bytes);
  const metadata = JSON.parse(metadataText);
  const metadataResult = metadataFingerprint(metadata);
  if (!metadataResult.ok) throw new Error("DOHMH metadata fingerprint failed: " + metadataResult.issues.map((item) => item.path + " " + item.message).join("; "));
  await writeExclusive(join(attemptDir, phase + ".metadata.json"), metadataText + "\n");
  await writeExclusive(join(attemptDir, phase + ".metadata.headers.json"), JSON.stringify(responseHeaders(metadataResponse.response), null, 2) + "\n");

  const countResponse = await fetchBytes(countUrl(), { headers: { accept: "application/json", "accept-encoding": "identity" } }, timeoutMs);
  const countText = textDecoder(countResponse.bytes);
  const count = parseCount(JSON.parse(countText));
  if (count.count !== expectedRows || count.camis !== expectedCamis) throw new Error("DOHMH source truth changed: expected rows/CAMIS " + expectedRows + "/" + expectedCamis + ", got " + count.count + "/" + count.camis + ".");
  await writeExclusive(join(attemptDir, phase + ".count.json"), countText + "\n");
  await writeExclusive(join(attemptDir, phase + ".count.headers.json"), JSON.stringify(responseHeaders(countResponse.response), null, 2) + "\n");

  const queryUrl = buildDohmhQueryUrl(expectedRows + 1);
  assertApprovedDohmhUrl(queryUrl);
  const head = await fetch(queryUrl, { method: "HEAD", redirect: "manual", headers: { accept: "application/json", "accept-encoding": "identity" }, signal: AbortSignal.timeout(timeoutMs) });
  if (head.status !== 200) throw new Error("DOHMH full-query HEAD returned HTTP " + head.status + ".");
  const headers = responseHeaders(head);
  if (!String(headers["content-type"] ?? "").toLocaleLowerCase().includes("application/json")) throw new Error("DOHMH full-query HEAD content type is not JSON.");
  if (headers["x-soda2-data-out-of-date"] !== "false") throw new Error("DOHMH source reports data out of date.");
  selectedHeaderFields(headers);
  const truth = headerTruth(headers, metadataResult.value.fingerprint, count.count, count.camis, metadataResult.value);
  if (!truth.lastModified || !truth.secondaryLastModified || truth.outOfDate !== "false") throw new Error("DOHMH source truth headers are incomplete.");
  await writeExclusive(join(attemptDir, phase + ".head.headers.json"), JSON.stringify({ url: queryUrl, status: head.status, headers, capturedAt: nowIso() }, null, 2) + "\n");
  return { metadata, metadataResult: metadataResult.value, truth, queryUrl, count, headers };
}

async function streamCandidate(attemptDir, label, preflightResult, expectedRows, maxBytes, timeoutMs) {
  const rawPartial = join(attemptDir, "dohmh-manhattan.snapshot-" + label + ".json.partial");
  const headersPartial = join(attemptDir, "dohmh-manhattan.snapshot-" + label + ".headers.json.partial");
  const rawFinal = join(attemptDir, "dohmh-manhattan.snapshot-" + label + ".json");
  const headersFinal = join(attemptDir, "dohmh-manhattan.snapshot-" + label + ".headers.json");
  await writeExclusive(headersPartial, JSON.stringify({ label, url: preflightResult.queryUrl, startedAt: nowIso(), headers: preflightResult.headers }, null, 2) + "\n");
  const response = await fetch(preflightResult.queryUrl, { method: "GET", redirect: "manual", headers: { accept: "application/json", "accept-encoding": "identity" }, signal: AbortSignal.timeout(timeoutMs) });
  if (response.status !== 200) throw new Error("DOHMH full capture " + label + " returned HTTP " + response.status + ".");
  const headers = responseHeaders(response);
  if (!String(headers["content-type"] ?? "").toLocaleLowerCase().includes("application/json")) throw new Error("DOHMH full capture " + label + " content type is not JSON.");
  if (headers["x-soda2-data-out-of-date"] !== "false") throw new Error("DOHMH full capture " + label + " reports data out of date.");
  selectedHeaderFields(headers);
  const headerMismatch = compareSourceTruth(preflightResult.truth, headerTruth(headers, preflightResult.metadataResult.fingerprint, preflightResult.count.count, preflightResult.count.camis, preflightResult.metadataResult));
  if (headerMismatch && ["lastModified", "secondaryLastModified", "outOfDate", "schemaFingerprint"].includes(String(headerMismatch.field))) throw new Error("DOHMH capture truth changed: " + JSON.stringify(redactTruthMismatch(headerMismatch)));
  const handle = await open(rawPartial, "wx");
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    if (!response.body) throw new Error("DOHMH response did not expose a body stream.");
    for await (const chunk of response.body) {
      const data = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      bytes += data.byteLength;
      if (bytes > maxBytes) throw new Error("DOHMH response exceeded the byte budget.");
      hash.update(data);
      await handle.write(data);
    }
  } finally {
    await handle.close();
  }
  const bodyBytes = await readFile(rawPartial);
  const bodyText = textDecoder(bodyBytes);
  const parsed = JSON.parse(bodyText);
  const canonical = validateDohmhRows(parsed, expectedRows);
  const multiset = buildDohmhMultiset(canonical, expectedRows);
  assertDohmhTruth(multiset.metrics, expectedRows, preflightResult.count.camis);
  await writeExclusive(join(attemptDir, "dohmh-manhattan." + label + ".multiset.txt"), [...multiset.groups.values()].sort((left, right) => left.digest.localeCompare(right.digest)).map((group) => group.digest + "\t" + group.multiplicity + "\n").join(""));
  await writeExclusive(join(attemptDir, "dohmh-manhattan." + label + ".metrics.json"), JSON.stringify(multiset.metrics, null, 2) + "\n");
  await writeFile(headersPartial, JSON.stringify({ label, url: preflightResult.queryUrl, startedAt: nowIso(), finishedAt: nowIso(), status: response.status, headers, bytes, sha256: hash.digest("hex") }, null, 2) + "\n", { flag: "w" });
  await rename(rawPartial, rawFinal);
  await rename(headersPartial, headersFinal);
  return { path: rawFinal, headersPath: headersFinal, bytes, sha256: sha256FileBytes(bodyBytes), metrics: multiset.metrics, multiset, responseHeaders: headers };
}

async function quarantineAttempt(attemptDir, root, attempt, reason) {
  const quarantine = join(root, "quarantine");
  await mkdir(quarantine, { recursive: true, mode: 0o700 });
  const safeReason = String(reason).replace(/[^a-z0-9-]+/gi, "-").slice(0, 60) || "failure";
  const target = join(quarantine, "attempt-" + attempt + "-" + Date.now() + "-" + safeReason);
  await rename(attemptDir, target);
  return target;
}

async function run() {
  const values = parseArgs(process.argv.slice(2));
  const release = String(values.release ?? RELEASE_DEFAULT);
  const outputRoot = resolve(String(values["output-root"] ?? "data/raw/" + release));
  const expectedRows = requiredInteger(values, "expected-rows", DOHMH_CITYWIDE_EXPECTED_ROWS, 1);
  const expectedCamis = requiredInteger(values, "expected-camis", DOHMH_CITYWIDE_EXPECTED_CAMIS, 1);
  const replayCount = requiredInteger(values, "replay-count", 2, 2);
  const timeoutMs = requiredInteger(values, "timeout-ms", 900_000, 1_000);
  const maxBytes = requiredInteger(values, "max-bytes", DOHMH_CITYWIDE_MAX_BYTES, 1);
  const maxFullAttempts = requiredInteger(values, "max-full-attempts", 4, 2);
  if (replayCount !== 2) throw new Error("Recovery CP2 requires exactly two independent full captures.");
  if (maxFullAttempts > 4) throw new Error("Recovery CP2 allows at most four full attempts.");
  if (expectedRows !== DOHMH_CITYWIDE_EXPECTED_ROWS || expectedCamis !== DOHMH_CITYWIDE_EXPECTED_CAMIS) throw new Error("Expected truth must remain 109386 rows and 12439 CAMIS; rebaseline is not permitted.");
  if (await pathExists(outputRoot)) throw new Error("Refusing to reuse an existing immutable output root: " + outputRoot);
  await mkdir(dirname(outputRoot), { recursive: true });
  await mkdir(outputRoot, { recursive: false, mode: 0o700 });
  const stagingRoot = join(outputRoot, "staging");
  await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
  let fullAttempts = 0;
  let accepted = null;
  let lastError = null;
  for (let sequence = 1; sequence <= 2 && !accepted; sequence += 1) {
    const attemptDir = join(stagingRoot, "sequence-" + sequence + "-" + Date.now());
    await mkdir(attemptDir, { recursive: false, mode: 0o700 });
    try {
      const preA = await preflight(attemptDir, "pre-a", expectedRows, expectedCamis, timeoutMs);
      fullAttempts += 1;
      const captureA = await streamCandidate(attemptDir, "a", preA, expectedRows, maxBytes, timeoutMs);
      const postA = await preflight(attemptDir, "post-a", expectedRows, expectedCamis, timeoutMs);
      const mismatchA = compareSourceTruth(preA.truth, postA.truth);
      if (mismatchA) throw new Error("DOHMH pre/post A truth changed: " + JSON.stringify(redactTruthMismatch(mismatchA)));
      const preB = await preflight(attemptDir, "pre-b", expectedRows, expectedCamis, timeoutMs);
      fullAttempts += 1;
      const captureB = await streamCandidate(attemptDir, "b", preB, expectedRows, maxBytes, timeoutMs);
      const postB = await preflight(attemptDir, "post-b", expectedRows, expectedCamis, timeoutMs);
      const mismatchB = compareSourceTruth(preB.truth, postB.truth);
      if (mismatchB) throw new Error("DOHMH pre/post B truth changed: " + JSON.stringify(redactTruthMismatch(mismatchB)));
      const truthMismatch = compareSourceTruth(postA.truth, postB.truth);
      if (truthMismatch) throw new Error("DOHMH A/B truth changed: " + JSON.stringify(redactTruthMismatch(truthMismatch)));
      const multisetMismatch = compareDohmhMultisets(captureA.multiset, captureB.multiset);
      if (multisetMismatch) throw new Error("DOHMH A/B multiset differs: " + JSON.stringify(redactTruthMismatch(multisetMismatch)));
      accepted = { attemptDir, preA, postA, preB, postB, captureA, captureB };
    } catch (error) {
      lastError = error;
      const quarantined = await quarantineAttempt(attemptDir, outputRoot, sequence, error instanceof Error ? error.message : String(error));
      console.error(JSON.stringify({ sequence, quarantined, error: error instanceof Error ? error.message : String(error) }));
      if (fullAttempts >= maxFullAttempts || (error instanceof Error && /truth changed|multiset differs|metadata fingerprint|source truth changed|row count mismatch|outside the exact|unknown fields|invalid value type/.test(error.message))) throw error;
    }
  }
  if (!accepted) throw lastError ?? new Error("No complete DOHMH capture sequence was accepted.");
  const { attemptDir, preA, postA, preB, postB, captureA, captureB } = accepted;
  const replayDir = join(outputRoot, "replay");
  await mkdir(replayDir, { recursive: false, mode: 0o700 });
  const finalRaw = join(outputRoot, "dohmh-manhattan.snapshot.json");
  const finalHeaders = join(outputRoot, "dohmh-manhattan.snapshot.headers.json");
  const finalReplay = join(replayDir, "dohmh-manhattan.snapshot-b.json");
  const finalReplayHeaders = join(replayDir, "dohmh-manhattan.snapshot-b.headers.json");
  await rename(captureA.path, finalRaw);
  await rename(captureA.headersPath, finalHeaders);
  await rename(captureB.path, finalReplay);
  await rename(captureB.headersPath, finalReplayHeaders);
  const metricsA = captureA.metrics;
  const metricsB = captureB.metrics;
  const manifest = {
    schemaVersion: "1.0",
    releaseId: release,
    cityId: "manhattan",
    scope: "snapshot-relative-all-records-accounted",
    approval: { messageId: APPROVAL_ID, scope: "local all-Manhattan raw retention, derived spatial/search/detail artifacts, and local browser display for OTI jh45-qr5r and DOHMH 43nn-pn8j only", exclusions: ["new providers", "Google-derived data", "public deployment", "unrelated datasets", "credentials", "packages", "commit", "push"] },
    source: { provider: "NYC Department of Health and Mental Hygiene", datasetId: DOHMH_CITYWIDE_DATASET_ID, endpoint: DOHMH_CITYWIDE_ENDPOINT, metadataEndpoint: DOHMH_CITYWIDE_METADATA_ENDPOINT, termsUrl: TERMS_URL, attribution: ATTRIBUTION },
    query: { method: "GET", where: DOHMH_CITYWIDE_WHERE, select: [...DOHMH_CITYWIDE_FIELDS], limit: expectedRows + 1, noOffset: true, noOrder: true, noSystemId: true, noToken: true, acceptEncoding: "identity" },
    metadata: { schemaFingerprint: preA.metadataResult.fingerprint, rowsUpdatedAt: preA.metadataResult.rowsUpdatedAt, viewLastModified: preA.metadataResult.viewLastModified },
    truth: { preA: preA.truth, postA: postA.truth, preB: preB.truth, postB: postB.truth, equal: true },
    captures: {
      a: { relativePath: "dohmh-manhattan.snapshot.json", headersPath: "dohmh-manhattan.snapshot.headers.json", bytes: captureA.bytes, sha256: captureA.sha256, metrics: metricsA, requestHeaders: captureA.responseHeaders },
      b: { relativePath: "replay/dohmh-manhattan.snapshot-b.json", headersPath: "replay/dohmh-manhattan.snapshot-b.headers.json", bytes: captureB.bytes, sha256: captureB.sha256, metrics: metricsB, requestHeaders: captureB.responseHeaders },
    },
    multiset: { equal: true, digest: metricsA.multisetDigest, rowCount: metricsA.rowCount, uniqueCanonicalRowCount: metricsA.uniqueCanonicalRowCount, duplicateGroupCount: metricsA.duplicateGroupCount, duplicateExcessCount: metricsA.duplicateExcessCount, maximumMultiplicity: metricsA.maximumMultiplicity, camisCount: metricsA.camisCount },
    invariants: { fullAttempts, replayCount, everyRowManhattan: true, sumMultiplicity: metricsA.rowCount, duplicateMetricsNonzero: metricsA.duplicateGroupCount > 0 && metricsA.duplicateExcessCount > 0, noDigestCollision: true, noAccountingRemainder: true, noPagination: true, immutable: true },
    capturedAt: nowIso(),
  };
  await rename(join(attemptDir, "pre-a.metadata.json"), join(outputRoot, "pre-a.metadata.json"));
  await rename(join(attemptDir, "pre-a.metadata.headers.json"), join(outputRoot, "pre-a.metadata.headers.json"));
  await rename(join(attemptDir, "pre-a.count.json"), join(outputRoot, "pre-a.count.json"));
  await rename(join(attemptDir, "pre-a.count.headers.json"), join(outputRoot, "pre-a.count.headers.json"));
  await rename(join(attemptDir, "pre-a.head.headers.json"), join(outputRoot, "pre-a.head.headers.json"));
  const acceptedEvidenceDir = join(outputRoot, "evidence", "accepted-sequence");
  await mkdir(join(outputRoot, "evidence"), { recursive: false, mode: 0o700 });
  await rename(attemptDir, acceptedEvidenceDir);
  await writeExclusive(join(outputRoot, "dohmh-citywide-acquisition.manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  await writeExclusive(join(outputRoot, "dohmh-citywide-acquisition.manifest.sha256"), sha256Bytes(new TextEncoder().encode(JSON.stringify(manifest, null, 2) + "\n") ) + "\n");
  console.log(JSON.stringify({ release, outputRoot, rawBytes: captureA.bytes, rawSha256: captureA.sha256, replayBytes: captureB.bytes, replaySha256: captureB.sha256, rowCount: metricsA.rowCount, camisCount: metricsA.camisCount, multisetDigest: metricsA.multisetDigest, duplicateGroupCount: metricsA.duplicateGroupCount, duplicateExcessCount: metricsA.duplicateExcessCount, fullAttempts }, null, 2));
}

run().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
