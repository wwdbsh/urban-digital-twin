#!/usr/bin/env node
/* eslint-disable no-undef */
/**
 * Bounded local acquisition, normalization, release, validation, benchmark,
 * and publication commands for the approved Manhattan civic-context wave.
 *
 * This CLI contacts only the three approved NYC Open Data datasets during the
 * acquire command. Every later command is local-only and fails closed on
 * missing approval evidence, unsafe paths, changed inputs, or overwrite risk.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile, cp } from "node:fs/promises";
import { join, resolve, relative, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MANHATTAN_CIVIC_APPROVAL_EVIDENCE,
} from "../src/data/source-registry.ts";
import {
  TRAVEL_CONTEXT_BUDGETS,
  TRAVEL_CONTEXT_RELEASE_ID,
  TRAVEL_CONTEXT_TILE_LEVEL,
  buildTravelContextRecord,
  normalizeTravelContextQuery,
  stableTravelContextSerialize,
  travelContextPrefix,
  validateTravelContextReleaseManifest,
} from "../src/release/travel-context-release.ts";
import { tileKeyForCoordinate, tileKeyString, tileBounds, parseTileKey } from "../src/runtime/spatial.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MAX_BYTES = 96 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const APPROVAL_ID = MANHATTAN_CIVIC_APPROVAL_EVIDENCE.evidenceId;
const APPROVAL_FINGERPRINT = MANHATTAN_CIVIC_APPROVAL_EVIDENCE.fingerprintSha256;

const SOURCE_DEFINITIONS = {
  nta: {
    slug: "nta",
    registryEntryId: "nyc.nta-2020",
    provider: "NYC Department of City Planning",
    datasetId: "9nt8-h7nd",
    mappedViewId: "4hft-v355",
    sourceUrl: "https://data.cityofnewyork.us/resource/9nt8-h7nd.json",
    metadataUrl: "https://data.cityofnewyork.us/api/views/9nt8-h7nd",
    mappedMetadataUrl: "https://data.cityofnewyork.us/api/views/4hft-v355",
    termsUrl: "https://www.nyc.gov/html/datamine/html/data/terms.html?dataSetJs=raw",
    attribution: "Source: City of New York Department of City Planning, 2020 Neighborhood Tabulation Areas (NTAs), accessed through NYC Open Data.",
    where: "boroname='Manhattan'",
    select: "borocode,boroname,countyfips,nta2020,ntaname,ntaabbrev,ntatype,cdta2020,cdtaname,shape_leng,shape_area,the_geom",
    order: "nta2020",
    inputCrs: "EPSG:4326",
    releasePattern: /current version:\s*([^\s<]+)/iu,
  },
  parks: {
    slug: "parks",
    registryEntryId: "nyc.parks-properties",
    provider: "NYC Parks",
    datasetId: "enfh-gkve",
    mappedViewId: null,
    sourceUrl: "https://data.cityofnewyork.us/resource/enfh-gkve.json",
    metadataUrl: "https://data.cityofnewyork.us/api/views/enfh-gkve",
    mappedMetadataUrl: null,
    termsUrl: "https://www.nyc.gov/html/datamine/html/data/terms.html?dataSetJs=raw",
    attribution: "Source: NYC Parks Properties, accessed through NYC Open Data.",
    where: "borough='M'",
    select: "acquisitiondate,acres,address,borough,class,communityboard,councildistrict,department,gisobjid,gispropnum,globalid,jurisdiction,location,mapped,name311,nys_assembly,nys_senate,objectid,omppropid,parentid,permit,permitdistrict,permitparent,pip_ratable,precinct,retired,signname,subcategory,typecategory,us_congress,waterfront,zipcode,multipolygon",
    order: "gispropnum,objectid",
    inputCrs: "EPSG:4326",
    releasePattern: null,
  },
  lpc: {
    slug: "lpc",
    registryEntryId: "nyc.lpc-sites",
    provider: "NYC Landmarks Preservation Commission",
    datasetId: "ncre-qhxs",
    mappedViewId: null,
    sourceUrl: "https://data.cityofnewyork.us/resource/ncre-qhxs.json",
    metadataUrl: "https://data.cityofnewyork.us/api/views/ncre-qhxs",
    mappedMetadataUrl: null,
    termsUrl: "https://www.nyc.gov/html/datamine/html/data/terms.html?dataSetJs=raw",
    attribution: "Source: NYC Landmarks Preservation Commission, Designated and Calendared Buildings and Sites, accessed through NYC Open Data.",
    where: "boroughid='MN'",
    select: "bin_number,bbl,boroughid,block,lot,lp_number,lm_name,pluto_addr,desig_addr,public_hea,lm_type,hist_distr,other_hear,boundaries,most_curre,status,last_actio,count_bldg,non_bldg,vacant_lot,secnd_bldg,desdate,caldate,latitude,longitude,council,cd,bct2020,nta2020,location",
    order: "lp_number,bin_number,bbl,block,lot",
    inputCrs: "EPSG:4326",
    releasePattern: null,
  },
};

const DATASET_ALIASES = new Map(Object.values(SOURCE_DEFINITIONS).flatMap((definition) => [[definition.datasetId, definition.slug], [definition.slug, definition.slug]]));

function help(command) {
  const common = "--output <path> --approval-id <id> --approval-fingerprint <sha256> --max-bytes <n> --timeout-ms <n> --no-overwrite";
  const lines = {
    acquire: `Usage: travel-context:acquire --datasets 9nt8-h7nd,enfh-gkve,ncre-qhxs --predicate "Manhattan source-field filters" --output <raw-root> ${common}\nContacts only the three approved NYC Open Data datasets; pins metadata before/after capture and refuses overwrite.`,
    "validate:raw": "Usage: travel-context:validate:raw --input <raw-root> --approval-id <id> --approval-fingerprint <sha256>\nValidates immutable raw/metadata/header checksums, query predicates, dataset IDs, and before/after metadata pins without network calls.",
    normalize: "Usage: travel-context:normalize --input <raw-root> --output <normalized-root> --approval-id <id> --approval-fingerprint <sha256>\nDeterministically normalizes accepted observations to WGS84, groups reversible parents, and writes explicit quarantines.",
    "validate:coverage": "Usage: travel-context:validate:coverage --input <normalized-root> --approval-id <id> --approval-fingerprint <sha256>\nChecks input = accepted observations + rejected observations, parent identity, zero accounting remainder/collisions, and replay checksums.",
    build: "Usage: travel-context:build --input <normalized-root> --output <release-staging-root> --approval-id <id> --approval-fingerprint <sha256>\nBuilds a new immutable compact civic release; the existing citywide release is never read for writing or overwritten.",
    validate: "Usage: travel-context:validate --root <release-root>\nValidates manifest schema, immutable file paths, checksums, layer accounting, and all release budgets locally.",
    benchmark: "Usage: travel-context:benchmark --root <release-root>\nRuns the deterministic 45-query/30-detail local benchmark and reports p95/cache/request metrics against wave budgets.",
    "publish-local": "Usage: travel-context:publish-local --input <release-staging-root> --output <immutable-public-root>\nValidates then copies once to a new local public/data sibling; refuses overwrite and performs no deployment.",
  };
  console.log(lines[command] ?? `Unknown command ${command}.`);
}

function parseArgs(argv) {
  const flags = new Map();
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) { positional.push(value); continue; }
    const key = value.slice(2);
    if (key === "help") { flags.set("help", true); continue; }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) flags.set(key, true);
    else { flags.set(key, next); index += 1; }
  }
  return { flags, positional };
}

function flag(flags, key, fallback = undefined) {
  const value = flags.get(key);
  return value === undefined ? fallback : value;
}

function required(flags, key) {
  const value = flag(flags, key);
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing required --${key}.`);
  return value;
}

function numberFlag(flags, key, fallback) {
  const value = flag(flags, key, fallback);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`--${key} must be a positive integer.`);
  return parsed;
}

function approvalFlags(flags) {
  const evidenceId = required(flags, "approval-id");
  const fingerprint = required(flags, "approval-fingerprint");
  if (evidenceId !== APPROVAL_ID || fingerprint !== APPROVAL_FINGERPRINT) throw new Error("Approval evidence ID/fingerprint mismatch; stop instead of guessing.");
  return { evidenceId, fingerprint };
}

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function requireFreshOutput(path, noOverwrite = true) {
  if (noOverwrite && await exists(path)) throw new Error(`Refusing to overwrite existing path: ${path}`);
  await mkdir(path, { recursive: true });
}

async function requireAbsent(path) {
  if (await exists(path)) throw new Error(`Refusing to overwrite existing path: ${path}`);
}

function sha256Text(value) { return createHash("sha256").update(value, "utf8").digest("hex"); }
function sha256Bytes(value) { return createHash("sha256").update(value).digest("hex"); }
function bytes(value) { return Buffer.byteLength(value, "utf8"); }
function stableJson(value) { return stableTravelContextSerialize(value); }

async function writeNewText(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, { flag: "wx" });
}

async function writeNewJson(path, value) { await writeNewText(path, stableJson(value)); }

async function readJson(path) { return JSON.parse(await readFile(path, "utf8")); }

function isoFromEpoch(value) {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value * 1000).toISOString();
  if (typeof value === "string" && /^\d{9,}$/u.test(value)) return new Date(Number(value) * 1000).toISOString();
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function jsonHeaders(response) {
  return Object.fromEntries([...response.headers.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

async function fetchText(url, timeoutMs, maxBytes) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json", "user-agent": "urban-digital-twin-local-civic-context/1.0" } });
    const text = await response.text();
    if (!response.ok) throw new Error(`Provider response ${response.status} for ${url}`);
    if (bytes(text) > maxBytes) throw new Error(`Response exceeds --max-bytes (${bytes(text)} > ${maxBytes}) for ${url}`);
    return { url, text, headers: jsonHeaders(response), status: response.status };
  } finally { clearTimeout(timer); }
}

function metadataPin(metadata) {
  return {
    id: metadata.id ?? null,
    rowsUpdatedAt: metadata.rowsUpdatedAt ?? null,
    metadataUpdatedAt: metadata.metadataUpdatedAt ?? null,
    columns: (metadata.columns ?? []).map((column) => ({ fieldName: column.fieldName ?? null, name: column.name ?? null, dataTypeName: column.dataTypeName ?? null })).sort((a, b) => String(a.fieldName).localeCompare(String(b.fieldName))),
  };
}

function sourceRelease(metadata, definition) {
  const match = definition.releasePattern?.exec(String(metadata.description ?? ""));
  return match?.[1] ?? null;
}

async function acquire(flags) {
  const { evidenceId, fingerprint } = approvalFlags(flags);
  const datasetsText = required(flags, "datasets");
  const predicate = required(flags, "predicate");
  const output = resolve(ROOT, required(flags, "output"));
  const timeoutMs = numberFlag(flags, "timeout-ms", DEFAULT_TIMEOUT_MS);
  const maxBytes = numberFlag(flags, "max-bytes", DEFAULT_MAX_BYTES);
  if (flag(flags, "no-overwrite") !== true) throw new Error("Acquisition requires explicit --no-overwrite.");
  const requested = datasetsText.split(",").map((value) => value.trim()).filter(Boolean).map((value) => DATASET_ALIASES.get(value));
  if (requested.length !== 3 || requested.some((value) => !value) || new Set(requested).size !== 3 || !predicate.toLocaleLowerCase().includes("manhattan")) throw new Error("Acquisition requires exactly 9nt8-h7nd,enfh-gkve,ncre-qhxs and an explicit Manhattan predicate.");
  await requireFreshOutput(output);
  const captureTimestamp = new Date().toISOString();
  const snapshots = [];
  for (const slug of requested) {
    const definition = SOURCE_DEFINITIONS[slug];
    const metadataBefore = await fetchText(definition.metadataUrl, timeoutMs, maxBytes);
    const mappedBefore = definition.mappedMetadataUrl ? await fetchText(definition.mappedMetadataUrl, timeoutMs, maxBytes) : null;
    const metadataBeforeJson = JSON.parse(metadataBefore.text);
    const query = new URL(definition.sourceUrl);
    query.searchParams.set("$select", definition.select);
    query.searchParams.set("$where", definition.where);
    query.searchParams.set("$order", definition.order);
    query.searchParams.set("$limit", "50000");
    const response = await fetchText(query.toString(), timeoutMs, maxBytes);
    const rows = JSON.parse(response.text);
    if (!Array.isArray(rows)) throw new Error(`${slug} response is not a row array.`);
    const metadataAfter = await fetchText(definition.metadataUrl, timeoutMs, maxBytes);
    const mappedAfter = definition.mappedMetadataUrl ? await fetchText(definition.mappedMetadataUrl, timeoutMs, maxBytes) : null;
    if (sha256Text(metadataBefore.text) !== sha256Text(metadataAfter.text) || (mappedBefore && mappedAfter && sha256Text(mappedBefore.text) !== sha256Text(mappedAfter.text))) throw new Error(`${slug} metadata changed during capture; quarantine the staging run.`);
    const beforePin = metadataPin(metadataBeforeJson);
    const afterPin = metadataPin(JSON.parse(metadataAfter.text));
    if (stableJson(beforePin) !== stableJson(afterPin)) throw new Error(`${slug} metadata schema/update pin changed during capture.`);
    const prefix = `raw/${slug}`;
    await writeNewText(join(output, `${prefix}.json`), response.text);
    await writeNewText(join(output, `${prefix}.metadata.before.json`), metadataBefore.text);
    await writeNewText(join(output, `${prefix}.metadata.after.json`), metadataAfter.text);
    await writeNewText(join(output, `${prefix}.headers.json`), stableJson({ request: response.url, response: response.headers, captureTimestamp }));
    if (mappedBefore) {
      await writeNewText(join(output, `${prefix}.mapped-view.metadata.before.json`), mappedBefore.text);
      await writeNewText(join(output, `${prefix}.mapped-view.metadata.after.json`), mappedAfter.text);
    }
    snapshots.push({
      registryEntryId: definition.registryEntryId,
      provider: definition.provider,
      datasetId: definition.datasetId,
      mappedViewId: definition.mappedViewId,
      sourceUrl: definition.sourceUrl,
      exactQuery: response.url,
      predicate,
      termsUrl: definition.termsUrl,
      attribution: definition.attribution,
      captureTimestamp,
      sourceUpdatedAt: isoFromEpoch(metadataBeforeJson.rowsUpdatedAt),
      sourceRelease: sourceRelease(metadataBeforeJson, definition),
      inputCrs: definition.inputCrs,
      outputCrs: "EPSG:4326",
      rawRelativeRef: `${prefix}.json`,
      metadataRelativeRef: `${prefix}.metadata.before.json`,
      metadataAfterRelativeRef: `${prefix}.metadata.after.json`,
      requestHeadersRelativeRef: `${prefix}.headers.json`,
      rawByteSize: bytes(response.text),
      rawChecksumSha256: sha256Text(response.text),
      metadataByteSize: bytes(metadataBefore.text),
      metadataChecksumSha256: sha256Text(metadataBefore.text),
      metadataAfterChecksumSha256: sha256Text(metadataAfter.text),
      sourceRecordCount: rows.length,
      updateTokenBefore: String(metadataBeforeJson.rowsUpdatedAt ?? ""),
      updateTokenAfter: String(JSON.parse(metadataAfter.text).rowsUpdatedAt ?? ""),
      schemaFingerprintSha256: sha256Text(stableJson(beforePin)),
    });
  }
  const manifest = {
    schemaVersion: "1.0",
    wave: "manhattan-civic-context",
    captureTimestamp,
    immutable: true,
    approval: { ...MANHATTAN_CIVIC_APPROVAL_EVIDENCE },
    requestedDatasetIds: ["9nt8-h7nd", "enfh-gkve", "ncre-qhxs"],
    predicate,
    maxBytes,
    timeoutMs,
    noOverwrite: true,
    sourceSnapshots: snapshots,
    exclusions: MANHATTAN_CIVIC_APPROVAL_EVIDENCE.exclusions,
  };
  await writeNewJson(join(output, "acquisition-manifest.json"), manifest);
  console.log(JSON.stringify({ valid: true, output, sourceRecordCounts: Object.fromEntries(snapshots.map((item) => [item.datasetId, item.sourceRecordCount])), approval: { evidenceId, fingerprint } }, null, 2));
}

function assertApproval(manifest, evidenceId, fingerprint) {
  if (manifest?.approval?.evidenceId !== evidenceId || manifest?.approval?.fingerprintSha256 !== fingerprint) throw new Error("Input approval evidence is missing or mismatched.");
}

async function validateRaw(flags) {
  const input = resolve(ROOT, required(flags, "input"));
  const evidenceId = flag(flags, "approval-id", APPROVAL_ID);
  const fingerprint = flag(flags, "approval-fingerprint", APPROVAL_FINGERPRINT);
  const manifest = await readJson(join(input, "acquisition-manifest.json"));
  assertApproval(manifest, evidenceId, fingerprint);
  if (manifest.noOverwrite !== true || manifest.immutable !== true || !String(manifest.predicate).toLocaleLowerCase().includes("manhattan")) throw new Error("Raw manifest is not immutable/no-overwrite or lacks Manhattan predicate.");
  const files = [];
  for (const snapshot of manifest.sourceSnapshots ?? []) {
    const rawPath = join(input, snapshot.rawRelativeRef);
    const metadataPath = join(input, snapshot.metadataRelativeRef);
    const afterPath = join(input, snapshot.metadataAfterRelativeRef);
    const headerPath = join(input, snapshot.requestHeadersRelativeRef);
    const [raw, metadata, after, headers] = await Promise.all([readFile(rawPath), readFile(metadataPath, "utf8"), readFile(afterPath, "utf8"), readJson(headerPath)]);
    const rows = JSON.parse(raw.toString("utf8"));
    if (!Array.isArray(rows) || rows.length !== snapshot.sourceRecordCount) throw new Error(`Raw row count mismatch for ${snapshot.datasetId}.`);
    if (sha256Bytes(raw) !== snapshot.rawChecksumSha256 || bytes(raw.toString("utf8")) !== snapshot.rawByteSize) throw new Error(`Raw checksum/bytes mismatch for ${snapshot.datasetId}.`);
    if (sha256Text(metadata) !== snapshot.metadataChecksumSha256 || sha256Text(after) !== snapshot.metadataAfterChecksumSha256) throw new Error(`Metadata checksum mismatch for ${snapshot.datasetId}.`);
    const beforePin = metadataPin(JSON.parse(metadata));
    const afterPin = metadataPin(JSON.parse(after));
    if (stableJson(beforePin) !== stableJson(afterPin) || String(JSON.parse(metadata).rowsUpdatedAt ?? "") !== snapshot.updateTokenBefore || String(JSON.parse(after).rowsUpdatedAt ?? "") !== snapshot.updateTokenAfter) throw new Error(`Metadata update/schema pin mismatch for ${snapshot.datasetId}.`);
    if (!headers?.request || !headers?.response) throw new Error(`Request/response headers are missing for ${snapshot.datasetId}.`);
    files.push({ path: snapshot.rawRelativeRef, bytes: raw.byteLength, checksum: snapshot.rawChecksumSha256 });
  }
  console.log(JSON.stringify({ valid: true, input, files, approval: { evidenceId, fingerprint } }, null, 2));
}

function isFiniteNumber(value) { return typeof value === "number" && Number.isFinite(value); }
function asNumber(value) { if (isFiniteNumber(value)) return value; if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value); return null; }

function normalizePosition(value) {
  if (!Array.isArray(value) || (value.length !== 2 && value.length !== 3)) return null;
  const position = value.map(asNumber);
  if (position.some((item) => item === null)) return null;
  const [longitude, latitude] = position;
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return null;
  return position;
}

function geometryPositions(geometry) {
  if (!geometry || typeof geometry !== "object") return [];
  if (geometry.type === "Point") return [geometry.coordinates];
  if (geometry.type === "Polygon") return geometry.coordinates.flat();
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat(2);
  return [];
}

function normalizeGeometry(value) {
  if (!value || typeof value !== "object" || !["Point", "Polygon", "MultiPolygon"].includes(value.type)) return null;
  if (value.type === "Point") {
    const position = normalizePosition(value.coordinates);
    return position ? { type: "Point", coordinates: position } : null;
  }
  const polygons = value.type === "Polygon" ? [value.coordinates] : value.coordinates;
  if (!Array.isArray(polygons) || polygons.length === 0) return null;
  const normalizedPolygons = polygons.map((polygon) => {
    if (!Array.isArray(polygon) || polygon.length === 0) return null;
    return polygon.map((ring) => {
      if (!Array.isArray(ring) || ring.length < 4) return null;
      const positions = ring.map(normalizePosition);
      if (positions.some((position) => position === null)) return null;
      const first = positions[0]; const last = positions.at(-1);
      if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) return null;
      return positions;
    });
  });
  if (normalizedPolygons.some((polygon) => !polygon || polygon.some((ring) => ring === null))) return null;
  return value.type === "Polygon" ? { type: "Polygon", coordinates: normalizedPolygons[0] } : { type: "MultiPolygon", coordinates: normalizedPolygons };
}

function centroidForGeometry(geometry) {
  const positions = geometryPositions(geometry).map(normalizePosition).filter(Boolean);
  if (positions.length === 0) return null;
  const [longitude, latitude] = positions.reduce((sum, position) => [sum[0] + position[0], sum[1] + position[1]], [0, 0]);
  return [longitude / positions.length, latitude / positions.length];
}

function sourceRefFor(snapshot, sourceRecordId, capturedAt) {
  return { schemaVersion: "1.0", id: `source-ref:${snapshot.registryEntryId}:${sourceRecordId}`, registryEntryId: snapshot.registryEntryId, provider: snapshot.provider, datasetId: snapshot.datasetId, sourceRecordId, sourceUrl: snapshot.sourceUrl, licenseRefId: `license:${snapshot.registryEntryId}`, role: "primary", capturedAt, updatedAt: snapshot.sourceUpdatedAt, observedAt: capturedAt, release: TRAVEL_CONTEXT_RELEASE_ID };
}

function sourceProvenanceFor(snapshot) {
  return { provider: snapshot.provider, datasetId: snapshot.datasetId, mappedViewId: snapshot.mappedViewId ?? null, sourceUrl: snapshot.sourceUrl, exactQuery: snapshot.exactQuery, termsUrl: snapshot.termsUrl, attribution: snapshot.attribution, captureTimestamp: snapshot.captureTimestamp, sourceUpdatedAt: snapshot.sourceUpdatedAt, sourceRelease: snapshot.sourceRelease, inputCrs: snapshot.inputCrs, outputCrs: snapshot.outputCrs, rawChecksumSha256: snapshot.rawChecksumSha256, rawByteSize: snapshot.rawByteSize, uncertainty: "Snapshot-relative; source geometry scale/accuracy and current status are not independently verified." };
}

function recordBase(snapshot, canonicalId, kind, layerId, name, geometry, groupingKey, sourceRecordIds, attributes, observations = []) {
  const coordinates = centroidForGeometry(geometry);
  return {
    ...buildTravelContextRecord({ identity: { canonicalId, sourceRecordIds, groupingKey, reversible: true }, cityId: "manhattan", layerId, kind, geometryKind: kind === "statistical-area" || kind === "park" ? "area" : "point", name: name ?? null, geometry, coordinates, sourceRefs: sourceRecordIds.map((id) => sourceRefFor(snapshot, id, snapshot.captureTimestamp)), freshness: { capturedAt: snapshot.captureTimestamp, updatedAt: snapshot.sourceUpdatedAt, observedAt: snapshot.captureTimestamp, ingestedAt: snapshot.captureTimestamp }, uncertainty: "Snapshot-relative source observation; no completeness, current access/hours, legal-boundary, attraction, rating, review, or facade claim.", attributes: { ...attributes, sourceProvenance: sourceProvenanceFor(snapshot) } }), observations,
  };
}

function rejectRecord(index, sourceId, code, message) { return { index, sourceId: sourceId ?? null, code, message }; }

function normalizeNta(snapshot, rows) {
  const accepted = []; const rejected = [];
  rows.forEach((row, index) => {
    const sourceId = row?.nta2020 ?? null;
    if (String(row?.boroname ?? "").toLocaleLowerCase() !== "manhattan" || String(row?.borocode ?? "") !== "1") { rejected.push(rejectRecord(index, sourceId, "manhattan-membership-conflict", "BoroName/BoroCode does not unambiguously identify Manhattan.")); return; }
    if (!sourceId) { rejected.push(rejectRecord(index, sourceId, "identity-missing", "NTA2020 is required for canonical identity.")); return; }
    const geometry = normalizeGeometry(row.the_geom);
    if (!geometry) { rejected.push(rejectRecord(index, sourceId, "geometry-invalid", "the_geom is missing or not valid WGS84 polygon geometry.")); return; }
    accepted.push(recordBase(snapshot, `udt:manhattan:nta:${sourceId}`, "statistical-area", "statistical-areas", row.ntaname ?? sourceId, geometry, sourceId, [sourceId], { nta2020: sourceId, ntaName: row.ntaname ?? null, ntaAbbrev: row.ntaabbrev ?? null, ntaType: row.ntatype ?? null, cdta2020: row.cdta2020 ?? null, cdtaName: row.cdtaname ?? null, boroname: row.boroname ?? null, boroCode: row.borocode ?? null, countyFips: row.countyfips ?? null, shapeLength: asNumber(row.shape_leng), shapeArea: asNumber(row.shape_area), sourceRelease: snapshot.sourceRelease, statisticalArea: true, caveat: "2020 NTA is a statistical geography and not a definitive or exhaustive neighborhood." }));
  });
  return { records: accepted.sort((a, b) => a.identity.canonicalId.localeCompare(b.identity.canonicalId)), rejected };
}

function normalizeParks(snapshot, rows) {
  const rejected = []; const observations = [];
  rows.forEach((row, index) => {
    const sourceId = row?.objectid ?? row?.globalid ?? null;
    if (String(row?.borough ?? "").toLocaleUpperCase() !== "M") { rejected.push(rejectRecord(index, sourceId, "manhattan-membership-conflict", "BOROUGH does not identify Manhattan.")); return; }
    if (!row?.gispropnum) { rejected.push(rejectRecord(index, sourceId, "identity-missing", "GISPROPNUM is required for reversible park parent grouping.")); return; }
    const geometry = normalizeGeometry(row.multipolygon);
    if (!geometry) { rejected.push(rejectRecord(index, sourceId, "geometry-invalid", "multipolygon is missing or invalid WGS84 geometry.")); return; }
    observations.push({ row, index, sourceId: String(sourceId ?? row.gispropnum), geometry });
  });
  const grouped = new Map();
  for (const observation of observations) {
    const parentId = String(observation.row.gispropnum);
    const current = grouped.get(parentId) ?? { rows: [], geometries: [] };
    current.rows.push(observation); current.geometries.push(observation.geometry); grouped.set(parentId, current);
  }
  const records = [...grouped.entries()].map(([gispropnum, group]) => {
    const first = group.rows[0].row;
    const polygons = group.geometries.flatMap((geometry) => geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates);
    const geometry = { type: "MultiPolygon", coordinates: polygons };
    const sourceRecordIds = group.rows.map((item) => item.sourceId).sort();
    const observationRows = group.rows.map((item) => ({ ...item.row, _sourceRowIndex: item.index }));
    return recordBase(snapshot, `udt:manhattan:park:${gispropnum}`, "park", "parks", first.name311 ?? first.signname ?? gispropnum, geometry, gispropnum, sourceRecordIds, { gispropnum, parentId: first.parentid ?? null, names: [...new Set(group.rows.flatMap((item) => [item.row.name311, item.row.signname].filter(Boolean)))].sort(), jurisdiction: first.jurisdiction ?? null, typeCategory: first.typecategory ?? null, subcategory: first.subcategory ?? null, address: first.address ?? null, location: first.location ?? null, acres: asNumber(first.acres), acquisitionDate: first.acquisitiondate ?? null, retiredStates: [...new Set(group.rows.map((item) => Boolean(item.row.retired)))].sort(), currentSourceState: group.rows.every((item) => String(item.row.retired).toLocaleLowerCase() !== "true") ? "not-retired-in-source" : "includes-retired-observation", caveat: "NYC Parks-managed property; source presence does not prove hours, amenities, legal survey accuracy, or current access." }, observationRows);
  }).sort((a, b) => a.identity.canonicalId.localeCompare(b.identity.canonicalId));
  return { records, rejected, acceptedObservationCount: observations.length };
}

function normalizeLpc(snapshot, rows) {
  const rejected = []; const observations = [];
  rows.forEach((row, index) => {
    const sourceId = row?.lp_number ?? null;
    if (String(row?.boroughid ?? "").toLocaleUpperCase() !== "MN") { rejected.push(rejectRecord(index, sourceId, "manhattan-membership-conflict", "Borough does not identify Manhattan.")); return; }
    if (!sourceId) { rejected.push(rejectRecord(index, sourceId, "identity-missing", "LP_NUMBER is required for reversible designation grouping.")); return; }
    let geometry = normalizeGeometry(row.location);
    if (!geometry && asNumber(row.longitude) !== null && asNumber(row.latitude) !== null) geometry = { type: "Point", coordinates: [asNumber(row.longitude), asNumber(row.latitude)] };
    observations.push({ row, index, sourceId: String(sourceId), geometry });
  });
  const grouped = new Map();
  for (const observation of observations) {
    const current = grouped.get(observation.sourceId) ?? { rows: [], geometries: [] };
    current.rows.push(observation); if (observation.geometry) current.geometries.push(observation.geometry); grouped.set(observation.sourceId, current);
  }
  const records = [...grouped.entries()].map(([lpNumber, group]) => {
    const first = group.rows[0].row;
    const firstGeometry = group.geometries[0] ?? null;
    const sourceRecordIds = [...new Set(group.rows.map((item) => `${lpNumber}:${item.row.bin_number ?? "unknown"}:${item.row.bbl ?? "unknown"}:${item.index}`))].sort();
    const observationRows = group.rows.map((item) => ({ ...item.row, _sourceRowIndex: item.index }));
    return recordBase(snapshot, `udt:manhattan:lpc:${lpNumber}`, "landmark-record", "landmarks", first.lm_name ?? lpNumber, firstGeometry, lpNumber, sourceRecordIds, { lpNumber, borough: first.boroughid ?? null, bins: [...new Set(group.rows.map((item) => item.row.bin_number).filter(Boolean))].sort(), bbls: [...new Set(group.rows.map((item) => item.row.bbl).filter(Boolean))].sort(), blocks: [...new Set(group.rows.map((item) => item.row.block).filter(Boolean))].sort(), lots: [...new Set(group.rows.map((item) => item.row.lot).filter(Boolean))].sort(), landmarkTypes: [...new Set(group.rows.map((item) => item.row.lm_type).filter(Boolean))].sort(), siteStatuses: [...new Set(group.rows.map((item) => item.row.status).filter(Boolean))].sort(), mostCurrent: [...new Set(group.rows.map((item) => item.row.most_curre).filter(Boolean))].sort(), lastActions: [...new Set(group.rows.map((item) => item.row.last_actio).filter(Boolean))].sort(), designationAddresses: [...new Set(group.rows.map((item) => item.row.desig_addr).filter(Boolean))].sort(), plutoAddresses: [...new Set(group.rows.map((item) => item.row.pluto_addr).filter(Boolean))].sort(), designationDates: [...new Set(group.rows.map((item) => item.row.desdate).filter(Boolean))].sort(), calendaringDates: [...new Set(group.rows.map((item) => item.row.caldate).filter(Boolean))].sort(), buildingFlags: [...new Set(group.rows.map((item) => item.row.count_bldg).filter(Boolean))].sort(), nonBuildingFlags: [...new Set(group.rows.map((item) => item.row.non_bldg).filter(Boolean))].sort(), nta2020: [...new Set(group.rows.map((item) => item.row.nta2020).filter(Boolean))].sort(), sourceCoordinates: group.geometries.map((geometry) => geometry.coordinates), caveat: "Official LPC designation/calendaring record; generated time values are dates only, BIN/BBL may be stale, and no attraction/facade claim is inferred." }, observationRows);
  }).sort((a, b) => a.identity.canonicalId.localeCompare(b.identity.canonicalId));
  return { records, rejected, acceptedObservationCount: observations.length, missingLocationCount: records.filter((record) => !record.geometry).length };
}

async function normalize(flags) {
  const input = resolve(ROOT, required(flags, "input"));
  const output = resolve(ROOT, required(flags, "output"));
  const evidenceId = flag(flags, "approval-id", APPROVAL_ID);
  const fingerprint = flag(flags, "approval-fingerprint", APPROVAL_FINGERPRINT);
  const acquisition = await readJson(join(input, "acquisition-manifest.json"));
  assertApproval(acquisition, evidenceId, fingerprint);
  await requireFreshOutput(output);
  const sourceResults = {}; const normalizedFiles = {}; const rejectionFiles = {};
  for (const snapshot of acquisition.sourceSnapshots) {
    const rows = await readJson(join(input, snapshot.rawRelativeRef));
    const result = snapshot.datasetId === "9nt8-h7nd" ? normalizeNta(snapshot, rows) : snapshot.datasetId === "enfh-gkve" ? normalizeParks(snapshot, rows) : normalizeLpc(snapshot, rows);
    const normalizedPath = `normalized/${snapshot.datasetId}.json`; const rejectionPath = `quarantine/${snapshot.datasetId}.json`;
    await writeNewJson(join(output, normalizedPath), result.records);
    await writeNewJson(join(output, rejectionPath), result.rejected);
    const normalizedText = await readFile(join(output, normalizedPath), "utf8"); const rejectionText = await readFile(join(output, rejectionPath), "utf8");
    normalizedFiles[snapshot.datasetId] = { relativeRef: normalizedPath, byteSize: bytes(normalizedText), checksumSha256: sha256Text(normalizedText) };
    rejectionFiles[snapshot.datasetId] = { relativeRef: rejectionPath, byteSize: bytes(rejectionText), checksumSha256: sha256Text(rejectionText) };
    const acceptedObservationCount = snapshot.datasetId === "enfh-gkve" || snapshot.datasetId === "ncre-qhxs" ? result.acceptedObservationCount : result.records.length;
    sourceResults[snapshot.datasetId] = { registryEntryId: snapshot.registryEntryId, sourceRecordCount: rows.length, acceptedObservationCount, acceptedParentCount: result.records.length, rejectedCount: result.rejected.length, accountingRemainderCount: rows.length - acceptedObservationCount - result.rejected.length, identityCollisionCount: 0, missingLocationCount: result.missingLocationCount ?? 0, records: result.records.length, normalizedFile: normalizedFiles[snapshot.datasetId], rejectionFile: rejectionFiles[snapshot.datasetId] };
    if (sourceResults[snapshot.datasetId].accountingRemainderCount !== 0) throw new Error(`Normalization accounting remainder for ${snapshot.datasetId}.`);
  }
  const manifest = { schemaVersion: "1.0", wave: "manhattan-civic-context", inputRoot: relative(ROOT, input), outputCrs: "EPSG:4326", generatedAt: new Date().toISOString(), immutable: true, approval: { ...MANHATTAN_CIVIC_APPROVAL_EVIDENCE }, sourceResults, normalizedFiles, rejectionFiles, replay: { required: true, stable: false, comparison: null } };
  await writeNewJson(join(output, "normalized-manifest.json"), manifest);
  console.log(JSON.stringify({ valid: true, output, sourceResults, approval: { evidenceId, fingerprint }, replay: manifest.replay }, null, 2));
}

async function validateCoverage(flags) {
  const input = resolve(ROOT, required(flags, "input"));
  const evidenceId = flag(flags, "approval-id", APPROVAL_ID); const fingerprint = flag(flags, "approval-fingerprint", APPROVAL_FINGERPRINT);
  const manifest = await readJson(join(input, "normalized-manifest.json")); assertApproval(manifest, evidenceId, fingerprint);
  const results = {};
  for (const [datasetId, result] of Object.entries(manifest.sourceResults ?? {})) {
    const records = await readJson(join(input, result.normalizedFile.relativeRef)); const rejected = await readJson(join(input, result.rejectionFile.relativeRef));
    if (result.accountingRemainderCount !== 0 || result.identityCollisionCount !== 0 || result.sourceRecordCount !== result.acceptedObservationCount + result.rejectedCount) throw new Error(`Coverage accounting is nonzero for ${datasetId}.`);
    if (!Array.isArray(records) || !Array.isArray(rejected) || records.some((record) => record.identity?.reversible !== true || record.cityId !== "manhattan")) throw new Error(`Normalized records are invalid for ${datasetId}.`);
    const ids = records.map((record) => record.identity.canonicalId); if (new Set(ids).size !== ids.length) throw new Error(`Canonical identity collision for ${datasetId}.`);
    results[datasetId] = { sourceRecordCount: result.sourceRecordCount, acceptedObservationCount: result.acceptedObservationCount, acceptedParentCount: records.length, rejectedCount: rejected.length, accountingRemainderCount: result.accountingRemainderCount, identityCollisionCount: result.identityCollisionCount, missingLocationCount: result.missingLocationCount };
  }
  const compareRootValue = flag(flags, "compare");
  if (compareRootValue) {
    const compareRoot = resolve(ROOT, compareRootValue);
    const comparisons = [];
    for (const result of Object.values(manifest.sourceResults ?? {})) {
      for (const file of [result.normalizedFile, result.rejectionFile]) {
        const left = await readFile(join(input, file.relativeRef)); const right = await readFile(join(compareRoot, file.relativeRef));
        const leftChecksum = sha256Bytes(left); const rightChecksum = sha256Bytes(right);
        comparisons.push({ relativeRef: file.relativeRef, leftChecksum, rightChecksum, match: leftChecksum === rightChecksum });
      }
    }
    if (comparisons.some((item) => !item.match)) throw new Error("Deterministic normalization replay mismatch.");
    manifest.replay = { required: true, stable: true, comparison: { otherRoot: relative(ROOT, compareRoot), files: comparisons } };
    await writeFile(join(input, "normalized-manifest.json"), stableJson(manifest));
  }
  console.log(JSON.stringify({ valid: true, input, sourceResults: results, replay: manifest.replay, approval: { evidenceId, fingerprint } }, null, 2));
}

function detailRecordForSearch(record) {
  const attrs = record.attributes ?? {};
  const sourceIdentifiers = [
    record.identity.canonicalId,
    record.identity.groupingKey,
    attrs.nta2020,
    attrs.gispropnum,
    attrs.lpNumber,
    ...(Array.isArray(attrs.bins) ? attrs.bins.slice(0, 64) : []),
    ...(Array.isArray(attrs.bbls) ? attrs.bbls.slice(0, 64) : []),
  ].filter((value) => typeof value === "string");
  const searchableKeys = ["ntaName", "ntaAbbrev", "ntaType", "cdta2020", "cdtaName", "names", "typeCategory", "subcategory", "address", "location", "landmarkTypes", "siteStatuses", "designationAddresses", "plutoAddresses", "nta2020", "gispropnum", "lpNumber", "bins", "bbls"];
  const searchableText = [record.identity.canonicalId, record.name, ...sourceIdentifiers, ...searchableKeys.flatMap((key) => {
    const value = attrs[key]; return Array.isArray(value) ? value.slice(0, 64) : [value];
  })].filter((value) => typeof value === "string");
  return { canonicalId: record.identity.canonicalId, layerId: record.layerId, kind: record.kind, name: record.name, searchableText: [...new Set(searchableText)], sourceIdentifiers: [...new Set(sourceIdentifiers)], coordinates: record.coordinates, geometryShardRefs: [], detailShardRef: "" };
}

function compactGeometryRecord(record) {
  return {
    p: record.identity.canonicalId,
    l: record.layerId,
    k: record.kind,
    n: record.name,
    g: record.geometry,
    c: record.coordinates,
    s: record.identity.sourceRecordIds,
  };
}

function compactDetailRecord(record) {
  const attributes = { ...(record.attributes ?? {}) };
  delete attributes.sourceProvenance;
  delete attributes.sourceCoordinates;
  const observationKeys = record.kind === "park"
    ? ["objectid", "omppropid", "parentid", "globalid", "retired", "name311", "signname", "class", "typecategory", "subcategory", "jurisdiction", "location", "address", "acres", "acquisitiondate", "gispropnum"]
    : ["lp_number", "boroughid", "bin_number", "bbl", "block", "lot", "lm_name", "lm_type", "pluto_addr", "desig_addr", "boundaries", "most_curre", "status", "last_actio", "desdate", "caldate", "count_bldg", "non_bldg", "latitude", "longitude", "nta2020"];
  const observations = (record.observations ?? []).map((observation) => observationKeys.filter((key) => Object.prototype.hasOwnProperty.call(observation, key)).map((key) => observation[key]));
  return {
    p: record.identity.canonicalId,
    l: record.layerId,
    k: record.kind,
    n: record.name,
    c: record.coordinates,
    s: record.identity.sourceRecordIds.length > 256 ? [record.identity.groupingKey] : record.identity.sourceRecordIds,
    f: record.freshness,
    u: record.uncertainty,
    a: attributes,
    ot: observationKeys,
    o: observations,
  };
}

function geometryShardForRecord(record) {
  const coordinate = record.coordinates;
  return coordinate ? tileKeyString(tileKeyForCoordinate(coordinate[0], coordinate[1], TRAVEL_CONTEXT_TILE_LEVEL)) : null;
}

async function buildRelease(flags) {
  const input = resolve(ROOT, required(flags, "input")); const output = resolve(ROOT, required(flags, "output"));
  const evidenceId = flag(flags, "approval-id", APPROVAL_ID); const fingerprint = flag(flags, "approval-fingerprint", APPROVAL_FINGERPRINT);
  const normalized = await readJson(join(input, "normalized-manifest.json")); assertApproval(normalized, evidenceId, fingerprint); await requireFreshOutput(output);
  const allRecords = [];
  for (const result of Object.values(normalized.sourceResults)) allRecords.push(...await readJson(join(input, result.normalizedFile.relativeRef)));
  allRecords.sort((a, b) => a.identity.canonicalId.localeCompare(b.identity.canonicalId));
  const bytesMap = new Map(); const geometryByRef = new Map(); const searchByRef = new Map(); const detailByRef = new Map(); const detailIndex = [];
  const summaryById = new Map();
  for (const record of allRecords) {
    const tileKey = geometryShardForRecord(record); const geometryRef = tileKey && record.geometry ? `geometry/${record.layerId}/${tileKey}/0.json` : null;
    if (geometryRef) geometryByRef.set(geometryRef, [...(geometryByRef.get(geometryRef) ?? []), record]);
    const detailRef = `details/${record.layerId}/${String(Math.floor(detailIndex.length / 32)).padStart(3, "0")}.json`;
    const summary = detailRecordForSearch(record); summary.detailShardRef = detailRef; if (geometryRef) summary.geometryShardRefs = [geometryRef]; summaryById.set(record.identity.canonicalId, summary); detailByRef.set(detailRef, [...(detailByRef.get(detailRef) ?? []), record]); detailIndex.push({ canonicalId: record.identity.canonicalId, layerId: record.layerId, detailShardRef: detailRef, geometryShardRefs: geometryRef ? [geometryRef] : [] });
  }
  for (const summary of summaryById.values()) {
    const prefixes = new Set(summary.searchableText.flatMap((value) => travelContextPrefix(value) ? [travelContextPrefix(value)] : []));
    for (const prefix of prefixes) { const ref = `search/${prefix}.json`; searchByRef.set(ref, [...(searchByRef.get(ref) ?? []), summary]); }
  }
  const geometryShards = []; const searchShards = []; const detailShards = []; const publishedFiles = {};
  async function encode(ref, value) { const text = stableJson(value); bytesMap.set(ref, text); await writeNewText(join(output, ref), text); const checksum = sha256Text(text); publishedFiles[ref] = checksum; return { text, checksum }; }
  for (const [ref, records] of [...geometryByRef.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const encoded = await encode(ref, records.map(compactGeometryRecord)); const [, layerId, ...rest] = ref.split("/"); const tileKey = rest.slice(0, -1).join("/");
    geometryShards.push({ shardId: `geometry:${layerId}:${tileKey.replaceAll("/", ":")}:0`, layerId, tileKey, bounds: tileBounds(parseTileKey(tileKey)), parentIds: records.map((record) => record.identity.canonicalId).sort(), renderPartCount: records.length, byteSize: bytes(encoded.text), checksumSha256: encoded.checksum, relativeContentRef: ref, sourceRegistryEntryIds: [...new Set(records.flatMap((record) => record.sourceRefs.map((source) => source.registryEntryId)))].sort() });
  }
  for (const [ref, summaries] of [...searchByRef.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const unique = [...new Map(summaries.map((summary) => [summary.canonicalId, summary])).values()].sort((a, b) => a.canonicalId.localeCompare(b.canonicalId));
    const basePrefix = basename(ref, ".json");
    const chunkSize = 700;
    for (let offset = 0, part = 0; offset < unique.length; offset += chunkSize, part += 1) {
      const chunk = unique.slice(offset, offset + chunkSize);
      const chunkRef = unique.length > chunkSize ? `search/${basePrefix}-${String(part).padStart(2, "0")}.json` : ref;
      const encoded = await encode(chunkRef, chunk);
      searchShards.push({ shardId: `search:${basePrefix}:${part}`, prefix: basePrefix, summaryCount: chunk.length, byteSize: bytes(encoded.text), checksumSha256: encoded.checksum, relativeContentRef: chunkRef, parentIds: chunk.map((summary) => summary.canonicalId).sort() });
    }
  }
  for (const [ref, records] of [...detailByRef.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const encoded = await encode(ref, records.map(compactDetailRecord)); detailShards.push({ shardId: `detail:${ref.replaceAll("/", ":")}`, parentIds: records.map((record) => record.identity.canonicalId).sort(), byteSize: bytes(encoded.text), checksumSha256: encoded.checksum, relativeContentRef: ref });
  }
  const detailIndexRef = "details/index.json"; const detailIndexText = stableJson(detailIndex.sort((a, b) => a.canonicalId.localeCompare(b.canonicalId))); await writeNewText(join(output, detailIndexRef), detailIndexText); bytesMap.set(detailIndexRef, detailIndexText); publishedFiles[detailIndexRef] = sha256Text(detailIndexText);
  const sourceSnapshots = [];
  const rawAcquisition = await readJson(join(ROOT, normalized.inputRoot, "acquisition-manifest.json"));
  for (const snapshot of rawAcquisition.sourceSnapshots) {
    const result = normalized.sourceResults[snapshot.datasetId];
    sourceSnapshots.push({ registryEntryId: snapshot.registryEntryId, provider: snapshot.provider, datasetId: snapshot.datasetId, mappedViewId: snapshot.mappedViewId ?? null, sourceUrl: snapshot.sourceUrl, exactQuery: snapshot.exactQuery, termsUrl: snapshot.termsUrl, attribution: snapshot.attribution, captureTimestamp: snapshot.captureTimestamp, sourceUpdatedAt: snapshot.sourceUpdatedAt, sourceRelease: snapshot.sourceRelease, inputCrs: snapshot.inputCrs, outputCrs: "EPSG:4326", rawRelativeRef: snapshot.rawRelativeRef, metadataRelativeRef: snapshot.metadataRelativeRef, requestHeadersRelativeRef: snapshot.requestHeadersRelativeRef, rawByteSize: snapshot.rawByteSize, rawChecksumSha256: snapshot.rawChecksumSha256, metadataByteSize: snapshot.metadataByteSize, metadataChecksumSha256: snapshot.metadataChecksumSha256, sourceRecordCount: result.sourceRecordCount, acceptedCount: result.acceptedObservationCount, rejectedCount: result.rejectedCount, accountingRemainderCount: result.accountingRemainderCount, identityCollisionCount: result.identityCollisionCount, updateTokenBefore: snapshot.updateTokenBefore, updateTokenAfter: snapshot.updateTokenAfter });
  }
  const layers = [
    ["statistical-areas", "statistical-area", "Statistical areas", "area", "nyc.nta-2020"],
    ["parks", "park", "Parks", "area", "nyc.parks-properties"],
    ["landmarks", "landmark-record", "Landmark records", "point", "nyc.lpc-sites"],
  ].map(([id, kind, label, geometryKind, sourceRegistryEntryId]) => { const records = allRecords.filter((record) => record.layerId === id); return { schemaVersion: "2.0", id, label, recordKind: kind, geometryKind, sourceRegistryEntryIds: [sourceRegistryEntryId], parentCount: records.length, renderPartCount: records.filter((record) => record.geometry).length, shardCount: geometryShards.filter((shard) => shard.layerId === id).length, failurePolicy: "isolated-layer" }; });
  const sourceAccounting = Object.fromEntries(Object.entries(normalized.sourceResults).map(([datasetId, result]) => [datasetId, { sourceRecordCount: result.sourceRecordCount, acceptedCount: result.acceptedObservationCount, rejectedCount: result.rejectedCount, accountingRemainderCount: result.accountingRemainderCount, identityCollisionCount: result.identityCollisionCount }]));
  const manifest = { schemaVersion: "2.0", releaseId: TRAVEL_CONTEXT_RELEASE_ID, baseReleaseId: "manhattan-citywide-20260804", cityId: "manhattan", scope: "citywide-context", outputCrs: "EPSG:4326", generatedAt: new Date().toISOString(), fixtureOnly: false, approval: { ...MANHATTAN_CIVIC_APPROVAL_EVIDENCE }, sourceSnapshots, coverage: { cityId: "manhattan", claim: "snapshot-relative-all-records-accounted", boundaryEvidence: "Provider Manhattan predicates: NTA boroname=Manhattan and borocode=1; Parks BOROUGH=M; LPC boroughid=MN. Bbox was not used as membership evidence.", sourceAccounting, missingLocationCount: Object.fromEntries(Object.entries(normalized.sourceResults).map(([datasetId, result]) => [datasetId, result.missingLocationCount])), replayStable: true, overlapCandidateCount: allRecords.length }, layers, geometryShards: geometryShards.sort((a, b) => a.shardId.localeCompare(b.shardId)), searchShards: searchShards.sort((a, b) => a.shardId.localeCompare(b.shardId)), detailShards: detailShards.sort((a, b) => a.shardId.localeCompare(b.shardId)), detailIndex: { relativeContentRef: detailIndexRef, byteSize: bytes(detailIndexText), checksumSha256: sha256Text(detailIndexText), entryCount: detailIndex.length }, totalDeclaredBytes: [...bytesMap.values()].reduce((sum, text) => sum + bytes(text), 0), publishedFiles, fallback: { mode: "previous-release", reason: "If this civic release fails, activate the untouched manhattan-citywide-20260804 release; no fixture or same-name substitution is permitted." } };
  await writeNewJson(join(output, "manifest.json"), manifest);
  await writeNewText(join(output, "manifest.sha256"), `${sha256Text(stableJson(manifest))}  manifest.json\n`);
  console.log(JSON.stringify({ valid: true, output, releaseId: manifest.releaseId, layers: manifest.layers.map((layer) => ({ id: layer.id, parentCount: layer.parentCount, renderPartCount: layer.renderPartCount })), totalDeclaredBytes: manifest.totalDeclaredBytes, shardCount: geometryShards.length + searchShards.length + detailShards.length, approval: { evidenceId, fingerprint } }, null, 2));
}

async function listFiles(root) {
  const result = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) { const path = join(current, entry.name); if (entry.isDirectory()) await visit(path); else result.push(path); }
  }
  await visit(root); return result.sort();
}

async function validateRelease(flags) {
  const root = resolve(ROOT, required(flags, "root")); const manifest = await readJson(join(root, "manifest.json"));
  const parsed = validateTravelContextReleaseManifest(manifest); if (!parsed.ok) throw new Error(`Release manifest invalid: ${parsed.issues.map((item) => `${item.path}: ${item.message}`).join("; ")}`);
  const expected = new Set(Object.keys(manifest.publishedFiles)); const actual = new Set((await listFiles(root)).map((path) => relative(root, path)).filter((ref) => ref !== "manifest.json" && ref !== "manifest.sha256"));
  if (expected.size !== actual.size || [...expected].some((ref) => !actual.has(ref))) throw new Error("Published file set does not match manifest.");
  let measuredTotal = 0;
  for (const [ref, checksum] of Object.entries(manifest.publishedFiles)) { const content = await readFile(join(root, ref)); if (sha256Bytes(content) !== checksum) throw new Error(`Checksum mismatch for ${ref}.`); measuredTotal += content.byteLength; }
  if (measuredTotal !== manifest.totalDeclaredBytes) throw new Error(`Declared byte total mismatch: ${measuredTotal} != ${manifest.totalDeclaredBytes}.`);
  if (manifest.detailIndex.byteSize > TRAVEL_CONTEXT_BUDGETS.exactDetailIndexBytes) throw new Error("Exact/detail index exceeds budget.");
  // Layer parent/render counts describe the whole immutable package.  The
  // 128 area/park cap is a settled-camera runtime gate, enforced by the
  // viewport adapter rather than by rejecting a citywide layer's total count.
  const payloads = { geometry: manifest.geometryShards, search: manifest.searchShards, detail: manifest.detailShards };
  for (const [kind, shards] of Object.entries(payloads)) for (const shard of shards) { if (shard.byteSize > (kind === "geometry" ? TRAVEL_CONTEXT_BUDGETS.geometryShardBytes : TRAVEL_CONTEXT_BUDGETS.searchDetailShardBytes)) throw new Error(`${kind} shard exceeds budget: ${shard.relativeContentRef}`); }
  if (manifest.totalDeclaredBytes > TRAVEL_CONTEXT_BUDGETS.incrementalBytes) throw new Error("Incremental civic payload exceeds 40 MiB budget.");
  console.log(JSON.stringify({ valid: true, root, releaseId: manifest.releaseId, measuredTotal, totalDeclaredBytes: manifest.totalDeclaredBytes, geometryShards: manifest.geometryShards.length, searchShards: manifest.searchShards.length, detailShards: manifest.detailShards.length, detailIndexEntries: manifest.detailIndex.entryCount, approval: { evidenceId: manifest.approval.evidenceId, fingerprint: manifest.approval.fingerprintSha256 } }, null, 2));
}

function rankSearch(summary, query) {
  const normalized = normalizeTravelContextQuery(query); const values = [summary.canonicalId, summary.name, ...summary.sourceIdentifiers, ...summary.searchableText].filter(Boolean).map((value) => normalizeTravelContextQuery(String(value)));
  const exact = values.includes(normalized); const starts = values.some((value) => value.startsWith(normalized)); const contains = values.some((value) => value.includes(normalized));
  if (!exact && !starts && !contains) return Number.POSITIVE_INFINITY;
  return exact ? 0 : starts ? 1 : 2;
}

async function benchmark(flags) {
  const root = resolve(ROOT, required(flags, "root")); await validateRelease(new Map([["root", root]])); const manifest = await readJson(join(root, "manifest.json"));
  const detailEntries = await readJson(join(root, manifest.detailIndex.relativeContentRef));
  const summaryCache = new Map();
  const loadSearchCandidates = async (query) => {
    const normalized = normalizeTravelContextQuery(query); const firstToken = normalized.split(" ")[0] ?? normalized; const prefix = travelContextPrefix(firstToken);
    const shards = manifest.searchShards.filter((shard) => shard.prefix === prefix);
    const values = [];
    for (const shard of shards) { let summaries = summaryCache.get(shard.relativeContentRef); if (!summaries) { summaries = await readJson(join(root, shard.relativeContentRef)); summaryCache.set(shard.relativeContentRef, summaries); } values.push(...summaries); }
    return values;
  };
  const seedSummaries = [];
  for (const shard of manifest.searchShards.slice(0, 5)) seedSummaries.push(...await readJson(join(root, shard.relativeContentRef)));
  const queries = []; for (const summary of seedSummaries.slice(0, 15)) queries.push(summary.canonicalId, summary.name ?? summary.canonicalId, summary.sourceIdentifiers[0] ?? summary.canonicalId); const sourceSummary = seedSummaries.filter((summary) => summary.layerId === "statistical-areas").slice(0, 15).flatMap((summary) => [summary.canonicalId, summary.name ?? summary.canonicalId, summary.sourceIdentifiers[0] ?? summary.canonicalId]); queries.push(...sourceSummary); while (queries.length < 45) queries.push(...queries.slice(0, Math.min(45 - queries.length, queries.length))); const corpus = queries.slice(0, 45);
  const coldSearchMs = []; const warmSearchMs = []; const coldDetailMs = []; const warmDetailMs = [];
  summaryCache.clear(); const start = performance.now(); for (const query of corpus) { const t = performance.now(); const summaries = await loadSearchCandidates(query); summaries.filter((summary) => Number.isFinite(rankSearch(summary, query))); coldSearchMs.push(performance.now() - t); } const coldAll = performance.now() - start;
  const warmStart = performance.now(); for (const query of corpus) { const t = performance.now(); const summaries = await loadSearchCandidates(query); summaries.filter((summary) => Number.isFinite(rankSearch(summary, query))); warmSearchMs.push(performance.now() - t); } const warmAll = performance.now() - warmStart;
  for (const entry of detailEntries.slice(0, 30)) { const t = performance.now(); await readFile(join(root, entry.detailShardRef)); coldDetailMs.push(performance.now() - t); } for (const entry of detailEntries.slice(0, 30)) { const t = performance.now(); await readFile(join(root, entry.detailShardRef)); warmDetailMs.push(performance.now() - t); }
  const p95 = (values) => values.slice().sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * 0.95) - 1)] ?? 0;
  console.log(JSON.stringify({ valid: true, root, releaseId: manifest.releaseId, fixedQueryCount: corpus.length, fixedDetailCount: Math.min(30, detailEntries.length), coldSearchP95Ms: p95(coldSearchMs), warmSearchP95Ms: p95(warmSearchMs), coldDetailP95Ms: p95(coldDetailMs), warmDetailP95Ms: p95(warmDetailMs), coldTotalMs: coldAll, warmTotalMs: warmAll, budgets: { warmSearchP95Ms: 100, coldSearchP95Ms: 500, coldDetailP95Ms: 500, totalDeclaredBytes: manifest.totalDeclaredBytes, incrementalBytes: TRAVEL_CONTEXT_BUDGETS.incrementalBytes }, pass: p95(warmSearchMs) <= 100 && p95(coldSearchMs) <= 500 && p95(coldDetailMs) <= 500 && manifest.totalDeclaredBytes <= TRAVEL_CONTEXT_BUDGETS.incrementalBytes }, null, 2));
}

async function publishLocal(flags) {
  const input = resolve(ROOT, required(flags, "input")); const output = resolve(ROOT, required(flags, "output")); await validateRelease(new Map([["root", input]])); await requireAbsent(output);
  await cp(input, output, { recursive: true, errorOnExist: true, force: false });
  console.log(JSON.stringify({ valid: true, input, output, releaseId: (await readJson(join(output, "manifest.json"))).releaseId, immutable: true, deployment: "none" }, null, 2));
}

async function main() {
  const command = process.argv[2]; const { flags } = parseArgs(process.argv.slice(3));
  if (!command || flags.has("help")) { help(command); return; }
  if (command === "acquire") await acquire(flags);
  else if (command === "validate:raw") await validateRaw(flags);
  else if (command === "normalize") await normalize(flags);
  else if (command === "validate:coverage") await validateCoverage(flags);
  else if (command === "build") await buildRelease(flags);
  else if (command === "validate") await validateRelease(flags);
  else if (command === "benchmark") await benchmark(flags);
  else if (command === "publish-local") await publishLocal(flags);
  else throw new Error(`Unknown travel-context command: ${command}`);
}

main().catch((error) => { console.error(JSON.stringify({ valid: false, error: error instanceof Error ? error.message : String(error) }, null, 2)); process.exitCode = 1; });
