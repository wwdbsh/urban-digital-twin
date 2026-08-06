/* global AbortSignal, Buffer, URL, URLSearchParams, console, fetch, process */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  ADDRESSPOINT_DATASET_ID,
  BLOCK_835_DOITT_IDS,
  COMMERCIAL_APPROVAL_ID,
  COMMERCIAL_RAW_RELEASE_ID,
  COMMERCIAL_RELEASE_ID,
  DCWP_DATASET_ID,
  DOHMH_CAPTURED_AT,
  DOHMH_DATASET_ID,
  DOHMH_RAW_SHA256,
  OSM_ENDPOINT,
  OTI_CAPTURED_AT,
  OTI_DATASET_ID,
  OTI_RAW_SHA256,
  displayCommercialName,
  deriveFacadeSegments,
  matchTenantToBuilding,
  normalizeCommercialName,
  placementForPoint,
  stableCommercialJson,
} from "../src/domain/commercial-frontage.ts";

const OTI_RAW_PATH = "data/raw/manhattan-citywide-20260804/buildings/manhattan-building-footprints.geojson";
const DOHMH_RAW_PATH = "data/raw/manhattan-citywide-20260804/dohmh-manhattan.snapshot.json";
const OTI_SOURCE_URL = "https://data.cityofnewyork.us/City-Government/Building-Footprints-Map-/jh45-qr5r";
const DOHMH_SOURCE_URL = "https://data.cityofnewyork.us/Health/DOHMH-New-York-City-Restaurant-Inspection-Results/43nn-pn8j";
const DCWP_SOURCE_URL = "https://data.cityofnewyork.us/Business/Issued-Licenses/w7w3-xahh";
const NYC_TERMS_URL = "https://opendata.cityofnewyork.us/overview/";
const OSM_POLICY_URL = "https://operations.osmfoundation.org/policies/api/";
const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";
const USER_AGENT = "UrbanDigitalTwin-Stage3Commercial/2026.08 (+local block-835 snapshot; no runtime requests)";
const MAX_NYC_BYTES = 80 * 1024 * 1024;
const MAX_OSM_BYTES = 25 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 90_000;
const OSM_TIMEOUT_MS = 45_000;
const APPROVED_HOSTS = new Set(["data.cityofnewyork.us", "opendata.cityofnewyork.us", "operations.osmfoundation.org", "www.openstreetmap.org", "overpass-api.de"]);
const RETRY_APPROVAL_ID = "codex-user-turn:2026-08-05:overpass-identical-single-retry-approval";
const PRIOR_OVERPASS_QUERY = "[out:json][timeout:35];(nwr(40.747707022744,-73.988192784289,40.749842609665,-73.984526949948););out meta geom;\n";
const PRIOR_OVERPASS_QUERY_SHA256 = "5ba65d622b8c8165d31d805d90fae3a00ab1e5f919282fdc4c7c6c56de135c62";
const PRIOR_FAILURE_REPORT = "/tmp/udt-stage3-commercial-20260805-worker-53806585fecf/commercial-osm-504-blocker-report.md";
const COMMERCIAL_POI_APPROVAL_ID = "codex-user-turn:2026-08-05:overpass-commercial-poi-single-query-approval";
const COMMERCIAL_POI_QUERY = `[out:json][timeout:35];
(
nwr["shop"](40.747707022744,-73.988192784289,40.749842609665,-73.984526949948);
nwr["amenity"~"^(restaurant|cafe|fast_food|bar|pub|food_court|ice_cream|bank|pharmacy|clinic|dentist|marketplace)$"](40.747707022744,-73.988192784289,40.749842609665,-73.984526949948);
nwr["office"](40.747707022744,-73.988192784289,40.749842609665,-73.984526949948);
nwr["craft"](40.747707022744,-73.988192784289,40.749842609665,-73.984526949948);
nwr["healthcare"](40.747707022744,-73.988192784289,40.749842609665,-73.984526949948);
nwr["tourism"~"^(hotel|hostel)$"](40.747707022744,-73.988192784289,40.749842609665,-73.984526949948);
nwr["leisure"="fitness_centre"](40.747707022744,-73.988192784289,40.749842609665,-73.984526949948);
);
out meta center;
`;
const COMMERCIAL_POI_QUERY_SHA256 = "ce61419f88fe87c2344cf45ecf1766a5a3d404c15f30c8903ea65a2dc28056e7";

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) continue;
    const equals = token.indexOf("=");
    if (equals > 2) values[token.slice(2, equals)] = token.slice(equals + 1);
    else { values[token.slice(2)] = argv[index + 1]; index += 1; }
  }
  return values;
}

function isoNow() { return new Date().toISOString(); }
function sha256Bytes(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function stable(value) { return stableCommercialJson(value); }
function jsonBytes(value) { return Buffer.from(`${stable(value)}\n`, "utf8"); }
function assert(condition, message) { if (!condition) throw new Error(message); }
async function exists(path) { try { await stat(path); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; } }
async function writeExclusive(path, value, encoding = undefined) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, value, { flag: "wx", encoding }); }
async function readJson(path) { return JSON.parse(await readFile(path, "utf8")); }

function headersFor(response) {
  return Object.fromEntries([...response.headers.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function assertApprovedUrl(url, expectedHost = null) {
  const parsed = new URL(url);
  assert(parsed.protocol === "https:", `Only HTTPS sources are allowed: ${url}`);
  assert(APPROVED_HOSTS.has(parsed.hostname), `Unapproved source host: ${parsed.hostname}`);
  if (expectedHost) assert(parsed.hostname === expectedHost, `Unexpected source host ${parsed.hostname}; expected ${expectedHost}.`);
  return parsed;
}

async function requestBytes(url, init = {}, timeoutMs = REQUEST_TIMEOUT_MS, maxBytes = MAX_NYC_BYTES, expectedHost = null) {
  const parsed = assertApprovedUrl(url, expectedHost);
  const startedAt = isoNow();
  const response = await fetch(parsed.toString(), {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const finishedAt = isoNow();
  assert(response.status >= 200 && response.status < 300, `HTTP ${response.status} from ${url}.`);
  assert(![301, 302, 303, 307, 308].includes(response.status), `Redirect rejected for ${url}.`);
  const chunks = [];
  let bytes = 0;
  if (!response.body) throw new Error(`Response body unavailable for ${url}.`);
  for await (const chunk of response.body) {
    const data = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    bytes += data.byteLength;
    if (bytes > maxBytes) throw new Error(`Response exceeds ${maxBytes} byte limit for ${url}.`);
    chunks.push(Buffer.from(data));
  }
  const body = Buffer.concat(chunks);
  return { url: parsed.toString(), startedAt, finishedAt, response, body, bytes: body.byteLength, sha256: sha256Bytes(body), headers: headersFor(response) };
}

function asString(value) { return value === null || value === undefined ? null : String(value); }
function pointFromRow(row, field = "the_geom") {
  const geometry = row?.[field];
  if (geometry && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2) return [Number(geometry.coordinates[0]), Number(geometry.coordinates[1])];
  if (Number.isFinite(Number(row?.longitude)) && Number.isFinite(Number(row?.latitude))) return [Number(row.longitude), Number(row.latitude)];
  return null;
}

function centroid(ring) {
  const points = ring.filter((part) => Array.isArray(part) && part.length >= 2);
  const sums = points.reduce(([x, y], [nextX, nextY]) => [x + Number(nextX), y + Number(nextY)], [0, 0]);
  return points.length ? [sums[0] / points.length, sums[1] / points.length] : [0, 0];
}

function buildingRowsFromOti(value) {
  assert(value?.type === "FeatureCollection" && Array.isArray(value.features), "Retained OTI snapshot must be a FeatureCollection.");
  const expected = new Set(BLOCK_835_DOITT_IDS);
  const selected = value.features.filter((feature) => {
    const id = String(feature?.properties?.DOITT_ID ?? "");
    const bbl = String(feature?.properties?.BASE_BBL ?? "");
    return expected.has(id) && bbl.startsWith("100835");
  });
  assert(selected.length === 14, `Expected 14 block-835 OTI features, got ${selected.length}.`);
  const ids = selected.map((feature) => String(feature.properties.DOITT_ID)).sort((a, b) => Number(a) - Number(b));
  assert(JSON.stringify(ids) === JSON.stringify([...BLOCK_835_DOITT_IDS]), "OTI block-835 DOITT membership differs from the pinned 14 IDs.");
  assert(new Set(ids).size === 14, "OTI block-835 DOITT membership contains duplicate identities.");
  return selected.sort((a, b) => Number(a.properties.DOITT_ID) - Number(b.properties.DOITT_ID)).map((feature) => {
    const geometry = feature.geometry;
    const ring = geometry.type === "Polygon" ? geometry.coordinates[0] : geometry.coordinates[0]?.[0];
    assert(Array.isArray(ring) && ring.length >= 4, `OTI building ${feature.properties.DOITT_ID} has no usable outer ring.`);
    const footprint = ring.map(([longitude, latitude]) => [Number(longitude), Number(latitude)]);
    const [longitude, latitude] = centroid(footprint);
    const feet = Number(feature.properties.HEIGHT_ROOF);
    return {
      canonicalBuildingId: `doitt:${String(feature.properties.DOITT_ID)}`,
      doittId: String(feature.properties.DOITT_ID),
      bin: asString(feature.properties.BIN),
      bbl: asString(feature.properties.BASE_BBL),
      name: asString(feature.properties.NAME) || `Building ${feature.properties.DOITT_ID}`,
      geometry: { type: geometry.type, coordinates: geometry.coordinates },
      footprint,
      centroid: [longitude, latitude],
      heightMeters: Number.isFinite(feet) ? feet * 0.3048 : null,
      rawHeightFeet: Number.isFinite(feet) ? feet : null,
      year: Number.isSafeInteger(Number(feature.properties.CONSTRUCTION_YEAR)) ? Number(feature.properties.CONSTRUCTION_YEAR) : null,
      geomSource: asString(feature.properties.GEOM_SOURCE),
      lastStatusType: asString(feature.properties.LAST_STATUS_TYPE),
      objectId: Number(feature.properties.OBJECTID),
      roofBasis: "oti-height-roof",
    };
  });
}

function bboxForBuildings(buildings) {
  const all = buildings.flatMap((building) => building.footprint);
  const west = Math.min(...all.map(([longitude]) => longitude));
  const east = Math.max(...all.map(([longitude]) => longitude));
  const south = Math.min(...all.map(([, latitude]) => latitude));
  const north = Math.max(...all.map(([, latitude]) => latitude));
  const midLatitude = (south + north) / 2;
  const latMetersPerDegree = 111_320;
  const lonMetersPerDegree = latMetersPerDegree * Math.cos(midLatitude * Math.PI / 180);
  const latDelta = 25 / latMetersPerDegree;
  const lonDelta = 25 / lonMetersPerDegree;
  const round = (value) => Number(value.toFixed(12));
  return { west: round(west - lonDelta), south: round(south - latDelta), east: round(east + lonDelta), north: round(north + latDelta), sourceExtent: { west, south, east, north }, bufferMeters: 25, method: "geodesic-25m-equirectangular-at-mid-latitude" };
}

function sourceFields() {
  return {
    [ADDRESSPOINT_DATASET_ID]: ["objectid", "addresspointid", "bin", "zipcode", "house_number", "house_number_suffix", "address_status", "validation", "boroughcode", "created_date", "modified_date", "street_name", "full_street_name", "the_geom"],
    [DCWP_DATASET_ID]: ["license_nbr", "business_name", "dba_trade_name", "business_unique_id", "business_category", "license_type", "license_status", "license_creation_date", "lic_expir_dd", "detail", "address_type", "address_building", "address_street_name", "address_street_name_2", "street3", "unit_type", "apt_suite", "address_city", "address_state", "address_zip", "address_borough", "bin", "bbl", "nta", "latitude", "longitude"],
  };
}

function quote(value) { return `'${String(value).replaceAll("'", "''")}'`; }

async function fetchSocrataDataset({ datasetId, fields, where, root, sourceUpdatedAt }) {
  const endpoint = `https://data.cityofnewyork.us/resource/${datasetId}.json`;
  const metadataUrl = `https://data.cityofnewyork.us/api/views/${datasetId}`;
  const metadata = await requestBytes(metadataUrl, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } }, REQUEST_TIMEOUT_MS, MAX_NYC_BYTES, "data.cityofnewyork.us");
  const metadataJson = JSON.parse(metadata.body.toString("utf8"));
  assert(metadataJson?.id === datasetId, `${datasetId} metadata ID drifted.`);
  const metadataRelative = `nyc/${datasetId}/metadata.json`;
  const metadataHeadersRelative = `nyc/${datasetId}/metadata.headers.json`;
  await writeExclusive(join(root, metadataRelative), metadata.body);
  await writeExclusive(join(root, metadataHeadersRelative), jsonBytes({ url: metadata.url, startedAt: metadata.startedAt, finishedAt: metadata.finishedAt, status: metadata.response.status, headers: metadata.headers, bytes: metadata.bytes, sha256: metadata.sha256 }));
  const metadataTimestamp = metadataJson.rowsUpdatedAt ? new Date(Number(metadataJson.rowsUpdatedAt) * 1000).toISOString() : null;
  const columnNames = (metadataJson.columns ?? []).map((column) => column.fieldName).filter(Boolean);
  assert(fields.every((field) => columnNames.includes(field)), `${datasetId} metadata is missing one or more pinned fields.`);
  const queryBase = new URL(endpoint);
  const query = new URLSearchParams({ $select: fields.join(","), $where: where, $order: fields[0], $limit: "5000" });
  const rows = [];
  const pageRecords = [];
  let offset = 0;
  while (true) {
    query.set("$offset", String(offset));
    queryBase.search = query.toString();
    const page = await requestBytes(queryBase.toString(), { headers: { Accept: "application/json", "User-Agent": USER_AGENT } }, REQUEST_TIMEOUT_MS, MAX_NYC_BYTES, "data.cityofnewyork.us");
    const value = JSON.parse(page.body.toString("utf8"));
    assert(Array.isArray(value), `${datasetId} page ${offset} is not a JSON array.`);
    assert(value.length <= 5000, `${datasetId} page exceeded the pinned page size.`);
    rows.push(...value);
    pageRecords.push({ offset, limit: 5000, count: value.length, url: page.url, startedAt: page.startedAt, finishedAt: page.finishedAt, status: page.response.status, headers: page.headers, bytes: page.bytes, sha256: page.sha256 });
    await writeExclusive(join(root, `nyc/${datasetId}/response-${String(pageRecords.length).padStart(3, "0")}.json`), page.body);
    if (value.length < 5000) break;
    offset += 5000;
    if (pageRecords.length > 100) throw new Error(`${datasetId} pagination exceeded 100 pages.`);
  }
  const normalizedRows = rows.map((row) => {
    const safe = {};
    for (const field of fields) safe[field] = Object.prototype.hasOwnProperty.call(row, field) ? row[field] : null;
    return safe;
  }).sort((left, right) => stable(left).localeCompare(stable(right)));
  const combined = jsonBytes(normalizedRows);
  const responseRelative = `nyc/${datasetId}/response.json`;
  await writeExclusive(join(root, responseRelative), combined);
  const queryRelative = `nyc/${datasetId}/query.json`;
  await writeExclusive(join(root, queryRelative), jsonBytes({ endpoint, fields, where, pageSize: 5000, pages: pageRecords.map(({ url, offset: pageOffset, limit }) => ({ url, offset: pageOffset, limit })) }));
  const capturedAt = pageRecords.at(-1)?.finishedAt ?? isoNow();
  return { datasetId, endpoint, metadataUrl, fields, where, rows: normalizedRows, rowCount: normalizedRows.length, captureTimestamp: capturedAt, sourceDatasetUpdatedAt: metadataTimestamp ?? sourceUpdatedAt ?? null, rawRelativeRef: responseRelative, rawBytes: combined.byteLength, rawSha256: sha256Bytes(combined), metadataRelative, queryRelative, pageRecords, metadataSha256: metadata.sha256 };
}

async function captureOsm(root, bbox) {
  assertApprovedUrl(OSM_ENDPOINT, "overpass-api.de");
  const query = `[out:json][timeout:35];(nwr(${bbox.south},${bbox.west},${bbox.north},${bbox.east}););out meta geom;`;
  const queryBytes = Buffer.from(`${query}\n`, "utf8");
  await writeExclusive(join(root, "osm/query.txt"), queryBytes);
  const startedAt = isoNow();
  const response = await fetch(OSM_ENDPOINT, { method: "POST", redirect: "manual", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "User-Agent": USER_AGENT }, body: new URLSearchParams({ data: query }).toString(), signal: AbortSignal.timeout(OSM_TIMEOUT_MS) });
  const finishedAt = isoNow();
  assert(response.status === 200, `The single approved Overpass request returned HTTP ${response.status}; do not retry.`);
  assert(!response.headers.get("location"), "Overpass redirect rejected; do not retry.");
  const chunks = [];
  let bytes = 0;
  if (!response.body) throw new Error("Overpass response body unavailable; do not retry.");
  for await (const chunk of response.body) {
    const data = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    bytes += data.byteLength;
    if (bytes > MAX_OSM_BYTES) throw new Error(`Overpass response exceeded ${MAX_OSM_BYTES} bytes; do not retry.`);
    chunks.push(Buffer.from(data));
  }
  const body = Buffer.concat(chunks);
  const parsed = JSON.parse(body.toString("utf8"));
  assert(Array.isArray(parsed?.elements), "Overpass response has no elements array; do not retry.");
  const bodySha256 = sha256Bytes(body);
  await writeExclusive(join(root, "osm/map-response.json"), body);
  await writeExclusive(join(root, "osm/map-response.headers.json"), jsonBytes({ endpoint: OSM_ENDPOINT, method: "POST", querySha256: sha256Bytes(queryBytes), queryRelativeRef: "osm/query.txt", startedAt, finishedAt, status: response.status, headers: headersFor(response), bytes: body.byteLength, sha256: bodySha256, elementCount: parsed.elements.length }));
  return { endpoint: OSM_ENDPOINT, method: "POST", query, querySha256: sha256Bytes(queryBytes), responseRelativeRef: "osm/map-response.json", responseHeadersRelativeRef: "osm/map-response.headers.json", startedAt, finishedAt, status: response.status, responseHeaders: headersFor(response), bytes: body.byteLength, sha256: bodySha256, elementCount: parsed.elements.length };
}

async function existingSocrataCapture(root, datasetId) {
  const metadata = await readJson(join(root, `nyc/${datasetId}/metadata.json`));
  const metadataHeaders = await readJson(join(root, `nyc/${datasetId}/metadata.headers.json`));
  const query = await readJson(join(root, `nyc/${datasetId}/query.json`));
  const responseRelative = `nyc/${datasetId}/response.json`;
  const responseBytes = await readFile(join(root, responseRelative));
  const rows = JSON.parse(responseBytes.toString("utf8"));
  const metadataTimestamp = metadata.rowsUpdatedAt ? new Date(Number(metadata.rowsUpdatedAt) * 1000).toISOString() : null;
  const pageRecords = (query.pages ?? []).map((page) => ({ ...page, count: page.offset === 0 ? rows.length : 0, bytes: page.offset === 0 ? responseBytes.byteLength : null, sha256: page.offset === 0 ? sha256Bytes(responseBytes) : null }));
  return { datasetId, endpoint: query.endpoint, metadataUrl: metadataHeaders.url, fields: query.fields, where: query.where, rows, rowCount: rows.length, captureTimestamp: metadataHeaders.finishedAt ?? null, sourceDatasetUpdatedAt: metadataTimestamp, rawRelativeRef: responseRelative, rawBytes: responseBytes.byteLength, rawSha256: sha256Bytes(responseBytes), metadataRelative: `nyc/${datasetId}/metadata.json`, queryRelative: `nyc/${datasetId}/query.json`, pageRecords, metadataSha256: metadataHeaders.sha256 };
}

async function rawFileRecord(root, relativePath, url = null) {
  const bytes = await readFile(join(root, relativePath));
  return { relativePath, url, status: 200, bytes: bytes.byteLength, sha256: sha256Bytes(bytes), capturedAt: null };
}

async function writeRawManifestFromRetry(rawRoot, osmAttempt, approvals) {
  const contract = await readJson(join(rawRoot, "acquisition-contract.json"));
  const otiBytes = await readFile(OTI_RAW_PATH);
  const dohmhBytes = await readFile(DOHMH_RAW_PATH);
  const buildings = buildingRowsFromOti(JSON.parse(otiBytes.toString("utf8")));
  const address = await existingSocrataCapture(rawRoot, ADDRESSPOINT_DATASET_ID);
  const dcwp = await existingSocrataCapture(rawRoot, DCWP_DATASET_ID);
  const terms = await rawFileRecord(rawRoot, "nyc/terms-overview.html", NYC_TERMS_URL);
  const policy = await rawFileRecord(rawRoot, "osm/policy.html", OSM_POLICY_URL);
  const copyright = await rawFileRecord(rawRoot, "osm/copyright.html", OSM_COPYRIGHT_URL);
  const osm = { endpoint: OSM_ENDPOINT, method: "POST", query: PRIOR_OVERPASS_QUERY.trimEnd(), querySha256: PRIOR_OVERPASS_QUERY_SHA256, responseRelativeRef: "osm/map-response.json", responseHeadersRelativeRef: "osm/map-response.headers.json", startedAt: osmAttempt.startedAt, finishedAt: osmAttempt.finishedAt, status: osmAttempt.status, responseHeaders: osmAttempt.headers, bytes: osmAttempt.bytes, sha256: osmAttempt.sha256, elementCount: osmAttempt.elementCount };
  const manifest = { schemaVersion: "1.0", releaseId: COMMERCIAL_RAW_RELEASE_ID, generatedAt: isoNow(), immutable: true, approvals, tool: { id: "exterior-pilot-cli", version: "1.1.0", node: process.version, userAgent: USER_AGENT }, membership: { predicate: "BASE_BBL[0] == '1' && BASE_BBL[1:6] == '00835'", doittIds: BLOCK_835_DOITT_IDS, parentCount: buildings.length, partCount: buildings.length, bbls: [...new Set(buildings.map((building) => building.bbl))].sort(), bbox: contract.bbox }, reusedInputs: [{ datasetId: OTI_DATASET_ID, path: OTI_RAW_PATH, captureTimestamp: OTI_CAPTURED_AT, bytes: otiBytes.byteLength, sha256: OTI_RAW_SHA256, recordCount: JSON.parse(otiBytes.toString("utf8")).features.length }, { datasetId: DOHMH_DATASET_ID, path: DOHMH_RAW_PATH, captureTimestamp: DOHMH_CAPTURED_AT, bytes: dohmhBytes.byteLength, sha256: DOHMH_RAW_SHA256, recordCount: JSON.parse(dohmhBytes.toString("utf8")).length }], sources: { nyc: { terms, addresspoint: address, dcwp }, osm: { policy, copyright, map: osm } }, sourceAccounting: { addressPointRows: address.rowCount, dcwpRows: dcwp.rowCount, osmElements: osm.elementCount, overpassRequestCount: 2, approvedRetryCount: 1, failedPriorAttempts: 1 }, attemptLineage: { firstFailureReport: PRIOR_FAILURE_REPORT, firstAttempt: { attempt: 1, approvalEvidenceId: COMMERCIAL_APPROVAL_ID, status: 504, queryRelativeRef: "osm/query.txt", querySha256: PRIOR_OVERPASS_QUERY_SHA256 }, secondAttempt: { attempt: 2, approvalEvidenceId: RETRY_APPROVAL_ID, queryRelativeRef: "osm/attempt-002-query.txt", querySha256: PRIOR_OVERPASS_QUERY_SHA256, status: osmAttempt.status, responseRelativeRef: "osm/map-response.json", responseHeadersRelativeRef: "osm/map-response.headers.json" } }, files: [] };
  manifest.files = await manifestFiles(rawRoot);
  await writeExclusive(join(rawRoot, "manifest.json"), jsonBytes(manifest));
  await writeExclusive(join(rawRoot, "manifest.sha256"), `${sha256Bytes(jsonBytes(manifest))}  manifest.json\n`);
  return manifest;
}

async function retryOverpass(values) {
  const rawRoot = resolve(String(values["raw-root"] ?? `data/raw/${COMMERCIAL_RAW_RELEASE_ID}`));
  assert(await exists(rawRoot), `Preserved raw root is missing: ${rawRoot}`);
  assert(!(await exists(join(rawRoot, "manifest.json"))), "Retry refuses a completed raw root; no second request is permitted.");
  assert(!(await exists(join(rawRoot, "osm/attempt-001.failure.json"))), "Retry lineage already exists; no second request is permitted.");
  assert(!(await exists(join(rawRoot, "osm/attempt-002.failure.json"))), "Retry failure is already recorded; no second request is permitted.");
  assert(!(await exists(join(rawRoot, "osm/map-response.json"))), "An OSM response already exists; no second request is permitted.");
  const approval = await readJson(join(rawRoot, "approval.json"));
  assert(approval.approvalEvidenceId === COMMERCIAL_APPROVAL_ID, "The preserved first approval is missing or changed.");
  const queryBytes = await readFile(join(rawRoot, "osm/query.txt"));
  assert(queryBytes.toString("utf8") === PRIOR_OVERPASS_QUERY, "The preserved query is not byte-identical to the approved retry query.");
  assert(sha256Bytes(queryBytes) === PRIOR_OVERPASS_QUERY_SHA256, "The preserved query hash differs from the approved retry hash.");
  await writeExclusive(join(rawRoot, "osm/attempt-001.failure.json"), jsonBytes({ attempt: 1, approvalEvidenceId: COMMERCIAL_APPROVAL_ID, endpoint: OSM_ENDPOINT, method: "POST", queryRelativeRef: "osm/query.txt", querySha256: PRIOR_OVERPASS_QUERY_SHA256, status: 504, responseHeaders: null, bytes: null, sha256: null, attemptedAt: "2026-08-05T12:42:32+0900", failureReport: PRIOR_FAILURE_REPORT, note: "Preserved HTTP 504 failure; no response body/headers were persisted by the first client path." }));
  await writeExclusive(join(rawRoot, "retry-approval.json"), jsonBytes({ schemaVersion: "1.0", approvalEvidenceId: RETRY_APPROVAL_ID, priorApprovalEvidenceId: COMMERCIAL_APPROVAL_ID, endpoint: OSM_ENDPOINT, method: "POST", queryRelativeRef: "osm/attempt-002-query.txt", querySha256: PRIOR_OVERPASS_QUERY_SHA256, scope: "Exactly one additional byte-identical bounded block-835 plus 25m request; no changed query, endpoint, provider, credentials, cookies, or further retry.", userAgent: USER_AGENT, timeoutMs: OSM_TIMEOUT_MS, maxResponseBytes: MAX_OSM_BYTES }));
  await writeExclusive(join(rawRoot, "osm/attempt-002-query.txt"), queryBytes);
  assertApprovedUrl(OSM_ENDPOINT, "overpass-api.de");
  const encodedBody = new URLSearchParams({ data: queryBytes.toString("utf8").trimEnd() }).toString();
  const startedAt = isoNow();
  let response;
  try {
    response = await fetch(OSM_ENDPOINT, { method: "POST", redirect: "manual", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "User-Agent": USER_AGENT }, body: encodedBody, signal: AbortSignal.timeout(OSM_TIMEOUT_MS) });
  } catch (error) {
    await writeExclusive(join(rawRoot, "osm/attempt-002.failure.json"), jsonBytes({ attempt: 2, approvalEvidenceId: RETRY_APPROVAL_ID, endpoint: OSM_ENDPOINT, method: "POST", queryRelativeRef: "osm/attempt-002-query.txt", querySha256: PRIOR_OVERPASS_QUERY_SHA256, startedAt, finishedAt: isoNow(), status: null, responseHeaders: null, bytes: null, sha256: null, error: String(error) }));
    throw error;
  }
  const finishedAt = isoNow();
  const headers = headersFor(response);
  const chunks = [];
  let bytes = 0;
  if (response.body) {
    for await (const chunk of response.body) {
      const data = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      bytes += data.byteLength;
      if (bytes > MAX_OSM_BYTES) break;
      chunks.push(Buffer.from(data));
    }
  }
  const body = Buffer.concat(chunks);
  const bodySha256 = sha256Bytes(body);
  const baseRecord = { attempt: 2, approvalEvidenceId: RETRY_APPROVAL_ID, endpoint: OSM_ENDPOINT, method: "POST", queryRelativeRef: "osm/attempt-002-query.txt", querySha256: PRIOR_OVERPASS_QUERY_SHA256, encodedRequestSha256: sha256Bytes(Buffer.from(encodedBody, "utf8")), startedAt, finishedAt, status: response.status, responseHeaders: headers, bytes: body.byteLength, sha256: bodySha256 };
  assert(bytes <= MAX_OSM_BYTES, `The approved retry response exceeded ${MAX_OSM_BYTES} bytes; stop without retry.`);
  if (response.status !== 200 || response.headers.get("location")) {
    await writeExclusive(join(rawRoot, "osm/attempt-002-response.bin"), body);
    await writeExclusive(join(rawRoot, "osm/attempt-002.failure.json"), jsonBytes({ ...baseRecord, responseBodyRelativeRef: "osm/attempt-002-response.bin", reason: response.headers.get("location") ? "redirect-rejected" : "http-status" }));
    throw new Error(`The approved identical Overpass retry returned HTTP ${response.status}; stop without retry.`);
  }
  let parsed;
  try { parsed = JSON.parse(body.toString("utf8")); } catch (error) {
    await writeExclusive(join(rawRoot, "osm/attempt-002-response.bin"), body);
    await writeExclusive(join(rawRoot, "osm/attempt-002.failure.json"), jsonBytes({ ...baseRecord, responseBodyRelativeRef: "osm/attempt-002-response.bin", reason: "invalid-json", error: String(error) }));
    throw new Error("The approved identical Overpass retry response was not valid JSON; stop without retry.", { cause: error });
  }
  assert(Array.isArray(parsed?.elements) && parsed.elements.length > 0, "The approved identical Overpass retry response is missing usable elements; stop without retry.");
  await writeExclusive(join(rawRoot, "osm/map-response.json"), body);
  await writeExclusive(join(rawRoot, "osm/map-response.headers.json"), jsonBytes({ ...baseRecord, queryRelativeRef: "osm/attempt-002-query.txt", responseRelativeRef: "osm/map-response.json", elementCount: parsed.elements.length }));
  await writeExclusive(join(rawRoot, "osm/attempts.json"), jsonBytes({ first: { attempt: 1, approvalEvidenceId: COMMERCIAL_APPROVAL_ID, status: 504, queryRelativeRef: "osm/query.txt", querySha256: PRIOR_OVERPASS_QUERY_SHA256, failureReport: PRIOR_FAILURE_REPORT }, second: { ...baseRecord, responseRelativeRef: "osm/map-response.json", responseHeadersRelativeRef: "osm/map-response.headers.json", elementCount: parsed.elements.length } }));
  const approvals = [approval, { schemaVersion: "1.0", approvalEvidenceId: RETRY_APPROVAL_ID, priorApprovalEvidenceId: COMMERCIAL_APPROVAL_ID, endpoint: OSM_ENDPOINT, method: "POST", queryRelativeRef: "osm/attempt-002-query.txt", querySha256: PRIOR_OVERPASS_QUERY_SHA256, scope: "Exactly one additional byte-identical bounded block-835 plus 25m request; no changed query, endpoint, provider, credentials, cookies, or further retry.", userAgent: USER_AGENT, timeoutMs: OSM_TIMEOUT_MS, maxResponseBytes: MAX_OSM_BYTES }];
  const manifest = await writeRawManifestFromRetry(rawRoot, { ...baseRecord, elementCount: parsed.elements.length }, approvals);
  console.log(JSON.stringify({ ok: true, rawRoot, status: response.status, bytes: body.byteLength, sha256: bodySha256, elementCount: parsed.elements.length, overpassRequestCount: manifest.sourceAccounting.overpassRequestCount, approvals: approvals.map((item) => item.approvalEvidenceId) }, null, 2));
}

async function writeRawManifestFromCommercialPoi(rawRoot, osmAttempt, approvals) {
  const contract = await readJson(join(rawRoot, "acquisition-contract.json"));
  const otiBytes = await readFile(OTI_RAW_PATH);
  const dohmhBytes = await readFile(DOHMH_RAW_PATH);
  const buildings = buildingRowsFromOti(JSON.parse(otiBytes.toString("utf8")));
  const address = await existingSocrataCapture(rawRoot, ADDRESSPOINT_DATASET_ID);
  const dcwp = await existingSocrataCapture(rawRoot, DCWP_DATASET_ID);
  const terms = await rawFileRecord(rawRoot, "nyc/terms-overview.html", NYC_TERMS_URL);
  const policy = await rawFileRecord(rawRoot, "osm/policy.html", OSM_POLICY_URL);
  const copyright = await rawFileRecord(rawRoot, "osm/copyright.html", OSM_COPYRIGHT_URL);
  const osm = { endpoint: OSM_ENDPOINT, method: "POST", query: COMMERCIAL_POI_QUERY.trimEnd(), querySha256: COMMERCIAL_POI_QUERY_SHA256, responseRelativeRef: "osm/map-response.json", responseHeadersRelativeRef: "osm/map-response.headers.json", startedAt: osmAttempt.startedAt, finishedAt: osmAttempt.finishedAt, status: osmAttempt.status, responseHeaders: osmAttempt.responseHeaders, bytes: osmAttempt.bytes, sha256: osmAttempt.sha256, elementCount: osmAttempt.elementCount, queryRelativeRef: "osm/attempt-003-query.txt" };
  const manifest = { schemaVersion: "1.0", releaseId: COMMERCIAL_RAW_RELEASE_ID, generatedAt: isoNow(), immutable: true, approvals, tool: { id: "exterior-pilot-cli", version: "1.2.0", node: process.version, userAgent: USER_AGENT }, membership: { predicate: "BASE_BBL[0] == '1' && BASE_BBL[1:6] == '00835'", doittIds: BLOCK_835_DOITT_IDS, parentCount: buildings.length, partCount: buildings.length, bbls: [...new Set(buildings.map((building) => building.bbl))].sort(), bbox: contract.bbox }, reusedInputs: [{ datasetId: OTI_DATASET_ID, path: OTI_RAW_PATH, captureTimestamp: OTI_CAPTURED_AT, bytes: otiBytes.byteLength, sha256: OTI_RAW_SHA256, recordCount: JSON.parse(otiBytes.toString("utf8")).features.length }, { datasetId: DOHMH_DATASET_ID, path: DOHMH_RAW_PATH, captureTimestamp: DOHMH_CAPTURED_AT, bytes: dohmhBytes.byteLength, sha256: DOHMH_RAW_SHA256, recordCount: JSON.parse(dohmhBytes.toString("utf8")).length }], sources: { nyc: { terms, addresspoint: address, dcwp }, osm: { policy, copyright, map: osm } }, sourceAccounting: { addressPointRows: address.rowCount, dcwpRows: dcwp.rowCount, osmElements: osmAttempt.elementCount, overpassRequestCount: 3, approvedCommercialPoiCount: 1, approvedRetryCount: 1, failedPriorAttempts: 2 }, attemptLineage: { firstAttempt: { attempt: 1, approvalEvidenceId: COMMERCIAL_APPROVAL_ID, status: 504, queryRelativeRef: "osm/query.txt", querySha256: PRIOR_OVERPASS_QUERY_SHA256, failureReport: PRIOR_FAILURE_REPORT }, secondAttempt: { attempt: 2, approvalEvidenceId: RETRY_APPROVAL_ID, status: "response-size-limit", queryRelativeRef: "osm/attempt-002-query.txt", querySha256: PRIOR_OVERPASS_QUERY_SHA256 }, thirdAttempt: { attempt: 3, approvalEvidenceId: COMMERCIAL_POI_APPROVAL_ID, status: osmAttempt.status, queryRelativeRef: "osm/attempt-003-query.txt", querySha256: COMMERCIAL_POI_QUERY_SHA256, responseRelativeRef: "osm/map-response.json", responseHeadersRelativeRef: "osm/map-response.headers.json" } }, files: [] };
  manifest.files = await manifestFiles(rawRoot);
  await writeExclusive(join(rawRoot, "manifest.json"), jsonBytes(manifest));
  await writeExclusive(join(rawRoot, "manifest.sha256"), `${sha256Bytes(jsonBytes(manifest))}  manifest.json\n`);
  return manifest;
}

async function commercialPoiOverpass(values) {
  const rawRoot = resolve(String(values["raw-root"] ?? `data/raw/${COMMERCIAL_RAW_RELEASE_ID}`));
  assert(await exists(rawRoot), `Preserved raw root is missing: ${rawRoot}`);
  assert(!(await exists(join(rawRoot, "manifest.json"))), "Commercial POI query refuses a completed raw root; no fourth request is permitted.");
  assert(!(await exists(join(rawRoot, "osm/attempt-003-query.txt"))), "Commercial POI query lineage already exists; no fourth request is permitted.");
  assert(!(await exists(join(rawRoot, "osm/attempt-003.failure.json"))), "Commercial POI query failure is already recorded; no fourth request is permitted.");
  const firstFailure = await readJson(join(rawRoot, "osm/attempt-001.failure.json"));
  const secondFailure = await readJson(join(rawRoot, "osm/attempt-002.failure.json"));
  assert(firstFailure.approvalEvidenceId === COMMERCIAL_APPROVAL_ID && firstFailure.status === 504, "Attempt 1 lineage changed; stop.");
  assert(secondFailure.approvalEvidenceId === RETRY_APPROVAL_ID && secondFailure.reason === "response-size-limit", "Attempt 2 lineage changed; stop.");
  const priorQuery = await readFile(join(rawRoot, "osm/query.txt"));
  const priorRetryQuery = await readFile(join(rawRoot, "osm/attempt-002-query.txt"));
  assert(sha256Bytes(priorQuery) === PRIOR_OVERPASS_QUERY_SHA256 && sha256Bytes(priorRetryQuery) === PRIOR_OVERPASS_QUERY_SHA256 && priorQuery.equals(priorRetryQuery), "Attempts 1-2 query bytes changed; stop.");
  const approval = { schemaVersion: "1.0", approvalEvidenceId: COMMERCIAL_POI_APPROVAL_ID, priorApprovalEvidenceIds: [COMMERCIAL_APPROVAL_ID, RETRY_APPROVAL_ID], endpoint: OSM_ENDPOINT, method: "POST", queryRelativeRef: "osm/attempt-003-query.txt", querySha256: COMMERCIAL_POI_QUERY_SHA256, scope: "Exactly one and only one commercial-POI Overpass request over the existing block-835 plus 25m bbox; no fourth request or retry.", userAgent: USER_AGENT, timeoutMs: OSM_TIMEOUT_MS, maxResponseBytes: MAX_OSM_BYTES, noCookiesOrCredentials: true };
  await writeExclusive(join(rawRoot, "commercial-poi-approval.json"), jsonBytes(approval));
  const queryBytes = Buffer.from(COMMERCIAL_POI_QUERY, "utf8");
  await writeExclusive(join(rawRoot, "osm/attempt-003-query.txt"), queryBytes);
  const persistedQuery = await readFile(join(rawRoot, "osm/attempt-003-query.txt"));
  assert(persistedQuery.equals(queryBytes) && sha256Bytes(persistedQuery) === COMMERCIAL_POI_QUERY_SHA256, "Commercial POI query file failed pre-request byte/hash verification.");
  const encodedBody = new URLSearchParams({ data: persistedQuery.toString("utf8") }).toString();
  const startedAt = isoNow();
  await writeExclusive(join(rawRoot, "osm/attempt-003.request.json"), jsonBytes({ ...approval, startedAt, encodedRequestSha256: sha256Bytes(Buffer.from(encodedBody, "utf8")) }));
  assertApprovedUrl(OSM_ENDPOINT, "overpass-api.de");
  let response;
  try {
    response = await fetch(OSM_ENDPOINT, { method: "POST", redirect: "manual", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "User-Agent": USER_AGENT }, body: encodedBody, signal: AbortSignal.timeout(OSM_TIMEOUT_MS) });
  } catch (error) {
    await writeExclusive(join(rawRoot, "osm/attempt-003.failure.json"), jsonBytes({ attempt: 3, approvalEvidenceId: COMMERCIAL_POI_APPROVAL_ID, endpoint: OSM_ENDPOINT, method: "POST", queryRelativeRef: "osm/attempt-003-query.txt", querySha256: COMMERCIAL_POI_QUERY_SHA256, startedAt, finishedAt: isoNow(), status: null, responseHeaders: null, bytes: null, sha256: null, reason: "request-error", error: String(error) }));
    throw error;
  }
  const finishedAt = isoNow();
  const responseHeaders = headersFor(response);
  const chunks = [];
  let bytes = 0;
  let overLimit = false;
  if (response.body) {
    for await (const chunk of response.body) {
      const data = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      bytes += data.byteLength;
      if (bytes > MAX_OSM_BYTES) { overLimit = true; break; }
      chunks.push(Buffer.from(data));
    }
  }
  const body = Buffer.concat(chunks);
  const bodySha256 = sha256Bytes(body);
  const baseRecord = { attempt: 3, approvalEvidenceId: COMMERCIAL_POI_APPROVAL_ID, endpoint: OSM_ENDPOINT, method: "POST", queryRelativeRef: "osm/attempt-003-query.txt", querySha256: COMMERCIAL_POI_QUERY_SHA256, encodedRequestSha256: sha256Bytes(Buffer.from(encodedBody, "utf8")), startedAt, finishedAt, status: response.status, responseHeaders, bytes: overLimit ? `>${MAX_OSM_BYTES}` : body.byteLength, sha256: overLimit ? null : bodySha256 };
  if (overLimit) {
    await writeExclusive(join(rawRoot, "osm/attempt-003.failure.json"), jsonBytes({ ...baseRecord, reason: "response-size-limit", maxResponseBytes: MAX_OSM_BYTES, responseBodyPersisted: false }));
    throw new Error(`The approved commercial-POI Overpass response exceeded ${MAX_OSM_BYTES} bytes; no fourth request is permitted.`);
  }
  if (response.status !== 200 || response.headers.get("location")) {
    await writeExclusive(join(rawRoot, "osm/attempt-003-response.bin"), body);
    await writeExclusive(join(rawRoot, "osm/attempt-003.failure.json"), jsonBytes({ ...baseRecord, responseBodyRelativeRef: "osm/attempt-003-response.bin", reason: response.headers.get("location") ? "redirect-rejected" : "http-status" }));
    throw new Error(`The approved commercial-POI Overpass request returned HTTP ${response.status}; no fourth request is permitted.`);
  }
  let parsed;
  try { parsed = JSON.parse(body.toString("utf8")); } catch (error) {
    await writeExclusive(join(rawRoot, "osm/attempt-003-response.bin"), body);
    await writeExclusive(join(rawRoot, "osm/attempt-003.failure.json"), jsonBytes({ ...baseRecord, responseBodyRelativeRef: "osm/attempt-003-response.bin", reason: "invalid-json", error: String(error) }));
    throw new Error("The approved commercial-POI Overpass response was not valid JSON; no fourth request is permitted.", { cause: error });
  }
  assert(Array.isArray(parsed?.elements) && parsed.elements.length > 0, "The approved commercial-POI response contained no usable elements; no fourth request is permitted.");
  await writeExclusive(join(rawRoot, "osm/map-response.json"), body);
  await writeExclusive(join(rawRoot, "osm/map-response.headers.json"), jsonBytes({ ...baseRecord, responseRelativeRef: "osm/map-response.json", responseHeadersRelativeRef: "osm/map-response.headers.json", elementCount: parsed.elements.length }));
  await writeExclusive(join(rawRoot, "osm/attempts.json"), jsonBytes({ first: firstFailure, second: secondFailure, third: { ...baseRecord, responseRelativeRef: "osm/map-response.json", responseHeadersRelativeRef: "osm/map-response.headers.json", elementCount: parsed.elements.length } }));
  const approvals = [await readJson(join(rawRoot, "approval.json")), await readJson(join(rawRoot, "retry-approval.json")), approval];
  const manifest = await writeRawManifestFromCommercialPoi(rawRoot, { ...baseRecord, elementCount: parsed.elements.length }, approvals);
  console.log(JSON.stringify({ ok: true, rawRoot, status: response.status, bytes: body.byteLength, sha256: bodySha256, elementCount: parsed.elements.length, overpassRequestCount: manifest.sourceAccounting.overpassRequestCount, approvals: approvals.map((item) => item.approvalEvidenceId) }, null, 2));
}

async function captureText(root, relativePath, url, expectedHost) {
  const record = await requestBytes(url, { headers: { Accept: "text/html, text/plain;q=0.9", "User-Agent": USER_AGENT } }, REQUEST_TIMEOUT_MS, 5 * 1024 * 1024, expectedHost);
  await writeExclusive(join(root, relativePath), record.body);
  return { relativePath, url: record.url, status: record.response.status, startedAt: record.startedAt, finishedAt: record.finishedAt, headers: record.headers, bytes: record.bytes, sha256: record.sha256 };
}

async function listFiles(root) {
  const output = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else output.push(path);
    }
  }
  await visit(root);
  return output.sort();
}

async function manifestFiles(root, exclude = new Set(["manifest.json", "manifest.sha256"])) {
  const files = await listFiles(root);
  const entries = [];
  for (const path of files) {
    const relativePath = relative(root, path).replaceAll("\\", "/");
    if (exclude.has(relativePath)) continue;
    const bytes = await readFile(path);
    entries.push({ relativePath, byteSize: bytes.byteLength, sha256: sha256Bytes(bytes) });
  }
  return entries;
}

async function acquire(values) {
  const rawRoot = resolve(String(values["raw-root"] ?? `data/raw/${COMMERCIAL_RAW_RELEASE_ID}`));
  assert(!(await exists(rawRoot)), `Refusing existing immutable raw root: ${rawRoot}`);
  await mkdir(rawRoot, { recursive: false, mode: 0o700 });
  const capturedAt = isoNow();
  const otiBytes = await readFile(OTI_RAW_PATH);
  const dohmhBytes = await readFile(DOHMH_RAW_PATH);
  assert(sha256Bytes(otiBytes) === OTI_RAW_SHA256, "Retained OTI snapshot hash differs; stop without acquisition.");
  assert(sha256Bytes(dohmhBytes) === DOHMH_RAW_SHA256, "Retained DOHMH snapshot hash differs; stop without acquisition.");
  const buildings = buildingRowsFromOti(JSON.parse(otiBytes.toString("utf8")));
  const bbox = bboxForBuildings(buildings);
  const approval = { schemaVersion: "1.0", approvalEvidenceId: COMMERCIAL_APPROVAL_ID, approvedAt: capturedAt, scope: "Local-only Stage 3 exact block-835 exterior/commercial frontage overlay.", routeOverride: "Exactly one POST https://overpass-api.de/api/interpreter query replaces the previously forbidden OSM main editing API route; no other OSM/Overpass/third-party endpoint is authorized.", sourceFamilies: ["NYC official Open Data", "OpenStreetMap ODbL 1.0 via one bounded Overpass snapshot", "retained OTI/DOHMH snapshots", "file-level reviewed CC/public-domain ESB/Herald evidence"], exclusions: ["Google products/data/imagery", "OSM main API", "OSM tiles", "Nominatim", "Overpass Turbo", "Geofabrik", "third-party extracts", "credentials", "cookies", "runtime network", "public deployment", "commit", "push"], claimCeiling: { esb: "licensed-near-real only for cited visible evidence", herald: "licensed-near-real only for cited visible evidence", remainingTwelve: "OTI source-constrained massing plus estimated residential/general facade/storefront geometry", commercial: "factual plain text signs only after deterministic gates; unknown otherwise" } };
  await writeExclusive(join(rawRoot, "approval.json"), jsonBytes(approval));
  await writeExclusive(join(rawRoot, "acquisition-contract.json"), jsonBytes({ schemaVersion: "1.0", releaseId: COMMERCIAL_RAW_RELEASE_ID, userAgent: USER_AGENT, maxBytes: { nyc: MAX_NYC_BYTES, osm: MAX_OSM_BYTES }, exactMembership: { predicate: "BASE_BBL[0] == '1' && BASE_BBL[1:6] == '00835'", parentCount: 14, partCount: 14, doittIds: BLOCK_835_DOITT_IDS }, bbox, requestPolicy: { nyc: "official data.cityofnewyork.us only; metadata pre-capture plus complete ordered pagination", osm: "one POST to overpass-api.de only; no retry; response cache only; no runtime" }, reusedInputs: [{ datasetId: OTI_DATASET_ID, path: OTI_RAW_PATH, capturedAt: OTI_CAPTURED_AT, sha256: OTI_RAW_SHA256 }, { datasetId: DOHMH_DATASET_ID, path: DOHMH_RAW_PATH, capturedAt: DOHMH_CAPTURED_AT, sha256: DOHMH_RAW_SHA256 }] }));
  const [nycTerms, osmPolicy, osmCopyright] = await Promise.all([
    captureText(rawRoot, "nyc/terms-overview.html", NYC_TERMS_URL, "opendata.cityofnewyork.us"),
    captureText(rawRoot, "osm/policy.html", OSM_POLICY_URL, "operations.osmfoundation.org"),
    captureText(rawRoot, "osm/copyright.html", OSM_COPYRIGHT_URL, "www.openstreetmap.org"),
  ]);
  const bins = buildings.map((building) => building.bin).filter(Boolean);
  const bbls = buildings.map((building) => building.bbl).filter(Boolean);
  const addressWhere = `bin in (${bins.join(",")})`;
  const dcwpWhere = `(bin in (${bins.map(quote).join(",")}) OR bbl in (${bbls.map(quote).join(",")}))`;
  const fields = sourceFields();
  const address = await fetchSocrataDataset({ datasetId: ADDRESSPOINT_DATASET_ID, fields: fields[ADDRESSPOINT_DATASET_ID], where: addressWhere, root: rawRoot, sourceUpdatedAt: null });
  const dcwp = await fetchSocrataDataset({ datasetId: DCWP_DATASET_ID, fields: fields[DCWP_DATASET_ID], where: dcwpWhere, root: rawRoot, sourceUpdatedAt: null });
  // This is intentionally the sole Overpass request in the acquisition workflow.
  const osm = await captureOsm(rawRoot, bbox);
  const manifest = { schemaVersion: "1.0", releaseId: COMMERCIAL_RAW_RELEASE_ID, generatedAt: isoNow(), immutable: true, approval, tool: { id: "exterior-pilot-cli", version: "1.0.0", node: process.version, userAgent: USER_AGENT }, membership: { predicate: "BASE_BBL[0] == '1' && BASE_BBL[1:6] == '00835'", doittIds: BLOCK_835_DOITT_IDS, parentCount: buildings.length, partCount: buildings.length, bbls: [...new Set(buildings.map((building) => building.bbl))].sort(), bbox }, reusedInputs: [{ datasetId: OTI_DATASET_ID, path: OTI_RAW_PATH, captureTimestamp: OTI_CAPTURED_AT, bytes: otiBytes.byteLength, sha256: OTI_RAW_SHA256, recordCount: JSON.parse(otiBytes.toString("utf8")).features.length }, { datasetId: DOHMH_DATASET_ID, path: DOHMH_RAW_PATH, captureTimestamp: DOHMH_CAPTURED_AT, bytes: dohmhBytes.byteLength, sha256: DOHMH_RAW_SHA256, recordCount: JSON.parse(dohmhBytes.toString("utf8")).length }], sources: { nyc: { terms: nycTerms, addresspoint: address, dcwp }, osm: { policy: osmPolicy, copyright: osmCopyright, map: osm } }, sourceAccounting: { addressPointRows: address.rowCount, dcwpRows: dcwp.rowCount, osmElements: osm.elementCount, overpassRequestCount: 1 }, files: [] };
  const files = await manifestFiles(rawRoot);
  manifest.files = files;
  await writeExclusive(join(rawRoot, "manifest.json"), jsonBytes(manifest));
  await writeExclusive(join(rawRoot, "manifest.sha256"), `${sha256Bytes(jsonBytes(manifest))}  manifest.json\n`);
  console.log(JSON.stringify({ ok: true, rawRoot, parentCount: buildings.length, addressPointRows: address.rowCount, dcwpRows: dcwp.rowCount, osmElements: osm.elementCount, osmBytes: osm.bytes, osmSha256: osm.sha256, overpassRequestCount: 1 }, null, 2));
}

function parseOsmElement(element) {
  const tags = element?.tags && typeof element.tags === "object" ? Object.fromEntries(Object.entries(element.tags).sort(([a], [b]) => a.localeCompare(b))) : {};
  const geometry = Array.isArray(element?.geometry) ? element.geometry.map((point) => [Number(point.lat), Number(point.lon)]) : null;
  const center = Number.isFinite(Number(element?.lon)) && Number.isFinite(Number(element?.lat)) ? [Number(element.lon), Number(element.lat)] : element?.center && Number.isFinite(Number(element.center.lat)) && Number.isFinite(Number(element.center.lon)) ? [Number(element.center.lon), Number(element.center.lat)] : null;
  return { sourceId: `osm:${element.type}:${element.id}@${element.version}`, type: element.type, id: String(element.id), version: Number(element.version), timestamp: element.timestamp ?? null, tags, geometry, center };
}

async function normalizeCommercialRows(rawRoot) {
  const manifest = await readJson(join(rawRoot, "manifest.json"));
  const oti = JSON.parse(readFileSync(OTI_RAW_PATH, "utf8"));
  const dohmh = JSON.parse(readFileSync(DOHMH_RAW_PATH, "utf8"));
  const buildings = buildingRowsFromOti(oti);
  const addressRaw = await readJson(join(rawRoot, "nyc/uf93-f8nk/response.json"));
  const dcwpRaw = await readJson(join(rawRoot, "nyc/w7w3-xahh/response.json"));
  const osmRaw = await readJson(join(rawRoot, "osm/map-response.json"));
  const addressPoints = addressRaw.map((row) => { const point = pointFromRow(row); return { source: "addresspoint", sourceId: `addresspoint:${asString(row.addresspointid) ?? asString(row.objectid) ?? "unknown"}`, bin: asString(row.bin), bbl: null, houseNumber: asString(row.house_number), street: asString(row.full_street_name) ?? asString(row.street_name), longitude: point?.[0] ?? NaN, latitude: point?.[1] ?? NaN, raw: row }; }).filter((row) => Number.isFinite(row.longitude) && Number.isFinite(row.latitude));
  const dohmhRows = dohmh.filter((row) => buildings.some((building) => building.bin === asString(row.bin) || building.bbl === asString(row.bbl))).map((row) => ({ observationId: `dohmh:${asString(row.camis)}:${asString(row.record_date) ?? "unknown"}:${asString(row.inspection_date) ?? "unknown"}`, source: "dohmh", sourceRecordId: asString(row.camis), rawName: asString(row.dba), nameKind: "dba", structuredAddress: { building: asString(row.building), street: asString(row.street), zipcode: asString(row.zipcode) }, bin: asString(row.bin), bbl: asString(row.bbl), coordinates: pointFromRow(row, "location"), categories: asString(row.cuisine_description), factualAttributes: { cuisine: asString(row.cuisine_description), action: asString(row.action), grade: asString(row.grade), score: asString(row.score), inspectionType: asString(row.inspection_type) }, rawStatus: asString(row.action), sourceCapturedAt: DOHMH_CAPTURED_AT, sourceDatasetUpdatedAt: manifest.reusedInputs.find((input) => input.datasetId === DOHMH_DATASET_ID)?.captureTimestamp ?? null, sourceRecordObservedAt: asString(row.record_date), statusObservedAt: asString(row.inspection_date), validFrom: null, validTo: null, normalizedName: normalizeCommercialName(row.dba), displayName: displayCommercialName(row.dba), sourceUrl: DOHMH_SOURCE_URL, licensePartition: "nyc-independent", raw: row }));
  const dcwpRows = dcwpRaw.map((row) => ({ observationId: `dcwp:${asString(row.license_nbr) ?? "unknown"}`, source: "dcwp", sourceRecordId: asString(row.license_nbr), rawName: asString(row.dba_trade_name) || asString(row.business_name), nameKind: asString(row.dba_trade_name) ? "dba" : "legal-name", structuredAddress: { building: asString(row.address_building), street: asString(row.address_street_name), city: asString(row.address_city), borough: asString(row.address_borough), zipcode: asString(row.address_zip), unit: asString(row.apt_suite) }, bin: asString(row.bin), bbl: asString(row.bbl), coordinates: pointFromRow(row), categories: asString(row.business_category), factualAttributes: { category: asString(row.business_category), licenseType: asString(row.license_type), detail: asString(row.detail) }, rawStatus: asString(row.license_status), sourceCapturedAt: manifest.sources.nyc.dcwp.captureTimestamp, sourceDatasetUpdatedAt: manifest.sources.nyc.dcwp.sourceDatasetUpdatedAt, sourceRecordObservedAt: asString(row.license_creation_date), statusObservedAt: asString(row.license_creation_date), validFrom: asString(row.license_creation_date), validTo: asString(row.lic_expir_dd), normalizedName: normalizeCommercialName(asString(row.dba_trade_name) || asString(row.business_name)), displayName: displayCommercialName(asString(row.dba_trade_name) || asString(row.business_name)), sourceUrl: DCWP_SOURCE_URL, licensePartition: "nyc-independent", raw: row })).filter((row) => !/individual/i.test(String(row.raw.license_type ?? "")) && row.raw.address_type !== "INDIVIDUAL");
  const osmFeatures = (osmRaw.elements ?? []).map(parseOsmElement).filter((element) => Object.keys(element.tags).some((key) => ["shop", "amenity", "office", "entrance", "name"].includes(key)));
  const osmObservations = osmFeatures.map((element) => ({ observationId: element.sourceId, source: "osm", sourceRecordId: element.sourceId, rawName: element.tags.name ?? null, nameKind: element.tags.name ? "osm-name" : null, structuredAddress: { housenumber: element.tags["addr:housenumber"] ?? null, street: element.tags["addr:street"] ?? null }, bin: null, bbl: null, coordinates: element.center ?? (element.geometry?.[0] ? [element.geometry[0][1], element.geometry[0][0]] : null), categories: Object.entries(element.tags).filter(([key]) => key === "shop" || key === "amenity" || key === "office").map(([, value]) => value).join(","), factualAttributes: { tags: element.tags, level: element.tags.level ?? null }, rawStatus: element.tags.disused === "yes" || element.tags.abandoned === "yes" ? "disused" : null, sourceCapturedAt: manifest.sources.osm.map.finishedAt, sourceDatasetUpdatedAt: null, sourceRecordObservedAt: element.timestamp, statusObservedAt: element.timestamp, validFrom: null, validTo: null, normalizedName: normalizeCommercialName(element.tags.name ?? null), displayName: displayCommercialName(element.tags.name ?? null), sourceUrl: "https://www.openstreetmap.org/", licensePartition: "odbl-derived", osmType: element.type, osmId: element.id, osmVersion: element.version, raw: element }));
  const allBuildings = buildings.map((building) => ({ ...building, facadeSegments: deriveFacadeSegments(building) }));
  const observations = [...dohmhRows, ...dcwpRows, ...osmObservations].sort((a, b) => a.observationId.localeCompare(b.observationId));
  const links = [];
  const placements = [];
  const tenants = new Map();
  for (const observation of observations) {
    const point = observation.coordinates && Number.isFinite(observation.coordinates[0]) && Number.isFinite(observation.coordinates[1]) ? [observation.coordinates[0], observation.coordinates[1]] : null;
    const match = matchTenantToBuilding({ longitude: point?.[0] ?? NaN, latitude: point?.[1] ?? NaN, bin: observation.bin, bbl: observation.bbl, sourceId: observation.sourceRecordId, source: observation.source }, allBuildings, addressPoints);
    const canonicalTenantId = observation.normalizedName ? `tenant:${observation.normalizedName}` : null;
    if (canonicalTenantId && !tenants.has(canonicalTenantId)) tenants.set(canonicalTenantId, { canonicalTenantId, displayName: observation.displayName || null, signText: null, observations: [], fieldProvenance: [], conflicts: [], status: "unknown", matchConfidence: 0, uncertainty: "Canonical tenant is a reversible view over source observations; current occupancy is not inferred." });
    if (canonicalTenantId) tenants.get(canonicalTenantId).observations.push(observation.observationId);
    const building = match.canonicalBuildingId ? allBuildings.find((candidate) => candidate.canonicalBuildingId === match.canonicalBuildingId) : null;
    links.push({ canonicalTenantId, canonicalBuildingId: match.canonicalBuildingId, decision: match.decision, confidence: match.confidence, reasons: match.reasons, candidates: match.candidates, sourceObservationId: observation.observationId, addressPointId: addressPoints.find((pointValue) => pointValue.bin === observation.bin)?.sourceId ?? null, effectiveAt: observation.validFrom ?? null, evidenceIds: [observation.observationId], reversible: true, licensePartition: observation.source === "osm" ? "odbl-derived" : "nyc-independent" });
    const groundFloorEvidence = observation.source === "osm" ? observation.raw?.tags?.level === undefined || observation.raw?.tags?.level === "0" : observation.source === "dcwp" ? !observation.structuredAddress.unit && !/floor|fl\.?\s*\d|suite|apt/i.test(String(observation.raw.detail ?? "")) : observation.source === "dohmh" ? true : false;
    const placement = placementForPoint({ storefrontId: `storefront:${observation.observationId}`, tenantId: canonicalTenantId, building, point, groundFloorEvidence, evidenceIds: [observation.observationId], otherPlacements: placements, sourceKind: observation.source === "osm" ? "osm" : observation.source === "addresspoint" ? "addresspoint" : "nyc" });
    placements.push({ ...placement, sourceObservationId: observation.observationId, rawName: observation.rawName, displayName: observation.displayName, status: observation.rawStatus, normalizedName: observation.normalizedName, licensePartition: observation.source === "osm" ? "odbl-derived" : "nyc-independent" });
    if (canonicalTenantId && placement.placementDecision.startsWith("storefront")) {
      const tenant = tenants.get(canonicalTenantId);
      tenant.signText = observation.displayName || null;
      tenant.matchConfidence = Math.max(tenant.matchConfidence, placement.confidence);
      tenant.status = observation.rawStatus ? "source-observed-no-status" : "unknown";
    }
  }
  const acceptedSigns = placements.filter((placement) => placement.signPolicy === "neutral-text-only" && placement.canonicalTenantId && placement.canonicalBuildingId && placement.placementDecision.startsWith("storefront") && displayCommercialName(placement.displayName));
  assert(acceptedSigns.length <= 32, `Accepted storefront signs exceed the hard limit: ${acceptedSigns.length}.`);
  const rejectionSummary = { observations: observations.length, acceptedTenantBuildingLinks: links.filter((link) => link.decision === "exact" || link.decision === "high").length, metadataOnlyLinks: links.filter((link) => link.decision === "medium" || link.decision === "candidate-only").length, ambiguousLinks: links.filter((link) => link.decision === "ambiguous").length, rejectedLinks: links.filter((link) => link.decision === "rejected").length, acceptedStorefronts: acceptedSigns.length, metadataOnlyStorefronts: placements.filter((placement) => placement.placementDecision === "metadata-only").length, unknownStorefronts: placements.filter((placement) => placement.placementDecision === "unknown").length, ambiguousStorefronts: placements.filter((placement) => placement.placementDecision === "ambiguous").length, rejectedOrUnmatched: placements.filter((placement) => placement.canonicalBuildingId === null).length };
  return { manifest, buildings: allBuildings, addressPoints, observations, osmObservations, tenants: [...tenants.values()].sort((a, b) => a.canonicalTenantId.localeCompare(b.canonicalTenantId)), links: links.sort((a, b) => `${a.sourceObservationId}`.localeCompare(`${b.sourceObservationId}`)), placements: placements.sort((a, b) => a.storefrontId.localeCompare(b.storefrontId)), acceptedSigns, rejectionSummary };
}

async function buildNormalized(values) {
  const rawRoot = resolve(String(values["raw-root"] ?? `data/raw/${COMMERCIAL_RAW_RELEASE_ID}`));
  const normalizedRoot = resolve(String(values["normalized-root"] ?? `data/normalized/${COMMERCIAL_RAW_RELEASE_ID}`));
  assert(await exists(rawRoot), `Raw root is missing: ${rawRoot}`);
  assert(!(await exists(normalizedRoot)), `Refusing existing immutable normalized root: ${normalizedRoot}`);
  await mkdir(dirname(normalizedRoot), { recursive: true });
  await mkdir(normalizedRoot, { recursive: false, mode: 0o700 });
  const normalized = await normalizeCommercialRows(rawRoot);
  await writeExclusive(join(normalizedRoot, "nyc-observations.json"), jsonBytes({ schemaVersion: "1.0", partitionId: "nyc-independent", sourceLicense: "nyc-open-data-terms", observations: normalized.observations.filter((observation) => observation.licensePartition === "nyc-independent") }));
  await writeExclusive(join(normalizedRoot, "osm-observations.odbl.json"), jsonBytes({ schemaVersion: "1.0", partitionId: "odbl-derived", license: "ODbL-1.0", attribution: "Map data © OpenStreetMap contributors.", licenseUrl: OSM_COPYRIGHT_URL, databaseOffer: "The OSM-derived raw/normalized partition and reproducible build recipe are retained for future conveyance under ODbL 1.0.", observations: normalized.osmObservations }));
  await writeExclusive(join(normalizedRoot, "address-crosswalk.json"), jsonBytes({ schemaVersion: "1.0", partitionId: "nyc-independent", sourceDatasetId: ADDRESSPOINT_DATASET_ID, rows: normalized.addressPoints }));
  await writeExclusive(join(normalizedRoot, "tenant-building-links.json"), jsonBytes({ schemaVersion: "1.0", partitionId: "odbl-derived", license: "ODbL-1.0", rows: normalized.links }));
  await writeExclusive(join(normalizedRoot, "storefront-placements.json"), jsonBytes({ schemaVersion: "1.0", partitionId: "odbl-derived", license: "ODbL-1.0", rows: normalized.placements }));
  await writeExclusive(join(normalizedRoot, "rejection-conflict-report.json"), jsonBytes({ schemaVersion: "1.0", counts: normalized.rejectionSummary, conflicts: normalized.links.filter((link) => link.decision === "ambiguous" || link.decision === "rejected"), placements: normalized.placements.filter((placement) => placement.placementDecision === "ambiguous" || placement.placementDecision === "unknown" || placement.placementDecision === "metadata-only") }));
  const packet = { schemaVersion: "1.0", releaseId: COMMERCIAL_RELEASE_ID, generatedAt: isoNow(), approvalEvidenceId: COMMERCIAL_APPROVAL_ID, sourceHashes: { oti: OTI_RAW_SHA256, dohmh: DOHMH_RAW_SHA256, osm: normalized.manifest.sources.osm.map.sha256, addresspoint: normalized.manifest.sources.nyc.addresspoint.rawSha256, dcwp: normalized.manifest.sources.nyc.dcwp.rawSha256 }, membership: { doittIds: BLOCK_835_DOITT_IDS, buildings: normalized.buildings }, licensePartitions: [{ partitionId: "nyc-independent", license: "nyc-open-data-terms", sources: [OTI_DATASET_ID, DOHMH_DATASET_ID, ADDRESSPOINT_DATASET_ID, DCWP_DATASET_ID] }, { partitionId: "odbl-derived", license: "ODbL-1.0", sources: ["osm:block-835-overpass"], attribution: "Map data © OpenStreetMap contributors.", licenseUrl: OSM_COPYRIGHT_URL, databaseOffer: "Retain exact OSM query/response and reproducible normalization recipe for future conveyance." }], tenants: normalized.tenants, observations: normalized.observations, links: normalized.links, placements: normalized.placements, counts: normalized.rejectionSummary, blenderContract: { enuAnchor: normalized.buildings.reduce(([lon, lat], building) => [lon + building.centroid[0], lat + building.centroid[1]], [0, 0]).map((value) => value / normalized.buildings.length), canonicalPropertyNames: ["canonicalBuildingId", "facadeSegmentId", "evidenceIds", "visualEvidenceLevel", "sourceSnapshotHashes"], exportLods: 2, exportCount: 28 } };
  await writeExclusive(join(normalizedRoot, "source-packet.json"), jsonBytes(packet));
  const files = await manifestFiles(normalizedRoot);
  const manifest = { schemaVersion: "1.0", releaseId: COMMERCIAL_RAW_RELEASE_ID, generatedAt: isoNow(), immutable: true, sourceRoot: relative(process.cwd(), rawRoot), files, packetRef: "source-packet.json", partitionIds: ["nyc-independent", "odbl-derived"], replay: { stableSerializer: "stableCommercialJson-v1", inputManifestSha256: sha256Bytes(jsonBytes(normalized.manifest)), deterministic: true } };
  await writeExclusive(join(normalizedRoot, "manifest.json"), jsonBytes(manifest));
  await writeExclusive(join(normalizedRoot, "manifest.sha256"), `${sha256Bytes(jsonBytes(manifest))}  manifest.json\n`);
  console.log(JSON.stringify({ ok: true, normalizedRoot, counts: normalized.rejectionSummary, acceptedSigns: normalized.acceptedSigns.length, osmElements: normalized.osmObservations.length, packet: join(normalizedRoot, "source-packet.json") }, null, 2));
}

async function validateRaw(values) {
  const rawRoot = resolve(String(values["raw-root"] ?? `data/raw/${COMMERCIAL_RAW_RELEASE_ID}`));
  assert(await exists(rawRoot), `Raw root is missing: ${rawRoot}`);
  const manifest = await readJson(join(rawRoot, "manifest.json"));
  const approvalIds = (manifest.approvals ?? []).map((approval) => approval.approvalEvidenceId);
  assert(approvalIds.includes(COMMERCIAL_APPROVAL_ID) && approvalIds.includes(RETRY_APPROVAL_ID) && approvalIds.includes(COMMERCIAL_POI_APPROVAL_ID), "Raw approval evidence IDs are incomplete.");
  assert(manifest.sourceAccounting?.overpassRequestCount === 3 && manifest.sourceAccounting?.approvedCommercialPoiCount === 1 && manifest.sourceAccounting?.approvedRetryCount === 1 && manifest.sourceAccounting?.failedPriorAttempts === 2, "Raw manifest must record exactly two failed prior Overpass attempts plus exactly one approved commercial-POI request.");
  assert(JSON.stringify(manifest.membership?.doittIds) === JSON.stringify([...BLOCK_835_DOITT_IDS]), "Raw member ID matrix mismatch.");
  for (const file of manifest.files ?? []) {
    const safe = file.relativePath && !file.relativePath.includes("..") && !file.relativePath.startsWith("/") && !file.relativePath.includes("\\");
    assert(safe, `Unsafe raw manifest path: ${file.relativePath}`);
    const bytes = await readFile(join(rawRoot, file.relativePath));
    assert(bytes.byteLength === file.byteSize && sha256Bytes(bytes) === file.sha256, `Raw file checksum mismatch: ${file.relativePath}`);
  }
  const osmHeaders = await readJson(join(rawRoot, "osm/map-response.headers.json"));
  assert(osmHeaders.endpoint === OSM_ENDPOINT && osmHeaders.status === 200 && osmHeaders.queryRelativeRef === "osm/attempt-003-query.txt" && osmHeaders.querySha256 === COMMERCIAL_POI_QUERY_SHA256, "OSM request evidence is incomplete or wrong endpoint/query.");
  const response = await readJson(join(rawRoot, "osm/map-response.json"));
  assert(Array.isArray(response.elements), "OSM response elements are missing.");
  assert(manifest.attemptLineage?.firstAttempt?.status === 504 && manifest.attemptLineage?.secondAttempt?.approvalEvidenceId === RETRY_APPROVAL_ID && manifest.attemptLineage?.thirdAttempt?.approvalEvidenceId === COMMERCIAL_POI_APPROVAL_ID, "Overpass attempt lineage is incomplete.");
  console.log(JSON.stringify({ ok: true, rawRoot, files: manifest.files.length, parentCount: manifest.membership.doittIds.length, overpassRequestCount: manifest.sourceAccounting.overpassRequestCount, approvedRetryCount: manifest.sourceAccounting.approvedRetryCount, approvedCommercialPoiCount: manifest.sourceAccounting.approvedCommercialPoiCount, osmElements: response.elements.length }, null, 2));
}

async function buildRelease(values) {
  const rawRoot = resolve(String(values["raw-root"] ?? `data/raw/${COMMERCIAL_RAW_RELEASE_ID}`));
  const stageRoot = resolve(String(values["stage-root"] ?? "/tmp/udt-stage3-commercial-20260805/release"));
  assert(await exists(rawRoot), `Raw root is missing: ${rawRoot}`);
  assert(!(await exists(stageRoot)), `Refusing existing stage root: ${stageRoot}`);
  const normalizedRoot = resolve(String(values["normalized-root"] ?? `data/normalized/${COMMERCIAL_RAW_RELEASE_ID}`));
  assert(await exists(normalizedRoot), `Normalized root is missing: ${normalizedRoot}`);
  const packet = await readJson(join(normalizedRoot, "source-packet.json"));
  assert(JSON.stringify(packet.membership.doittIds) === JSON.stringify([...BLOCK_835_DOITT_IDS]), "Normalized packet membership mismatch.");
  assert(packet.licensePartitions.some((partition) => partition.partitionId === "odbl-derived" && partition.license === "ODbL-1.0"), "Normalized packet is missing ODbL partition.");
  assert((packet.links ?? []).every((link) => link.decision !== "ambiguous" || !link.canonicalBuildingId), "Ambiguous building links cannot be attached.");
  const assetRoot = resolve(String(values["asset-root"] ?? join(dirname(stageRoot), "blender/exports")));
  assert(await exists(assetRoot), `Blender export root is missing: ${assetRoot}`);
  const reimportReportPath = resolve(String(values["reimport-report"] ?? join(dirname(stageRoot), "blender/reimport.json")));
  assert(await exists(reimportReportPath), `Blender clean-reimport report is missing: ${reimportReportPath}`);
  const reimportReport = await readJson(reimportReportPath);
  assert(reimportReport.assetCount === 28 && reimportReport.canonicalIds?.length === 14, "Blender clean-reimport report must contain exactly 28 LOD assets and 14 canonical IDs.");
  assert(reimportReport.textures === 0, "Blender clean-reimport report contains textures; the Stage 3 package is texture-free.");
  const reimportByFile = new Map((reimportReport.records ?? []).map((record) => [record.file, record]));
  assert(reimportByFile.size === 28, "Blender clean-reimport report has duplicate or missing file metrics.");
  const assetDir = join(stageRoot, "assets");
  await mkdir(assetDir, { recursive: true, mode: 0o700 });
  const assetEntries = [];
  for (const id of BLOCK_835_DOITT_IDS) {
    for (const lod of [0, 1]) {
      const fileName = `doitt-${id}__lod_${lod}.glb`;
      const sourcePath = join(assetRoot, fileName);
      assert(await exists(sourcePath), `Missing Blender GLB ${fileName}.`);
      const bytes = await readFile(sourcePath);
      assert(bytes.byteLength > 20 && bytes.subarray(0, 4).toString("ascii") === "glTF", `Invalid GLB header ${fileName}.`);
      const metrics = reimportByFile.get(fileName);
      assert(metrics && metrics.canonicalId === `doitt:${id}` && metrics.lod === lod, `Missing clean-reimport metrics for ${fileName}.`);
      assert(metrics.triangles > 0 && metrics.triangles <= (id === "778052" || id === "131170" ? 150000 : 75000), `Triangle budget exceeded for ${fileName}.`);
      assert(metrics.materials > 0 && metrics.materials <= 8 && metrics.textures === 0, `Material/texture budget exceeded for ${fileName}.`);
      const destinationRelative = `assets/${fileName}`;
      await writeExclusive(join(stageRoot, destinationRelative), bytes);
      assetEntries.push({ id, lod, fileName, relativeContentRef: `assets/${COMMERCIAL_RELEASE_ID}/${fileName}`, bytes: bytes.byteLength, sha256: sha256Bytes(bytes), triangles: metrics.triangles, materials: metrics.materials, textures: metrics.textures, bounds: metrics.bounds });
    }
  }
  const assetsById = new Map();
  for (const entry of assetEntries) { const bucket = assetsById.get(entry.id) ?? []; bucket.push(entry); assetsById.set(entry.id, bucket); }
  const sourceRef = (id, dataset, record, url, license, role = "primary") => ({ schemaVersion: "1.0", id: `source-ref:${dataset}:${record}`, registryEntryId: id, provider: id.startsWith("osm") ? "OpenStreetMap contributors via Overpass API" : id.startsWith("nyc") ? "City of New York Open Data" : "Reviewed architectural evidence", datasetId: dataset, sourceRecordId: record, sourceUrl: url, licenseRefId: `license:${id}`, role, capturedAt: null, updatedAt: null, observedAt: null, release: COMMERCIAL_RELEASE_ID });
  const makeAsset = (building, files) => {
    const nearReal = building.doittId === "778052" || building.doittId === "131170";
    const sortedFiles = [...files].sort((a, b) => a.lod - b.lod);
    const metricBounds = sortedFiles.map((file) => file.bounds).filter((bounds) => bounds?.min?.length === 3 && bounds?.max?.length === 3);
    assert(metricBounds.length === 2, `Missing bounds metrics for ${building.canonicalBuildingId}.`);
    const bounds = { min: [0, 1, 2].map((axis) => Math.min(...metricBounds.map((value) => Number(value.min[axis])))), max: [0, 1, 2].map((axis) => Math.max(...metricBounds.map((value) => Number(value.max[axis])))) };
    const maxTriangles = Math.max(...sortedFiles.map((file) => file.triangles));
    const maxMaterials = Math.max(...sortedFiles.map((file) => file.materials));
    const maxTextures = Math.max(...sortedFiles.map((file) => file.textures));
    const lodVariants = sortedFiles.map((file) => ({ id: `lod${file.lod}`, geometricErrorMeters: file.lod === 0 ? 0.1 : 1, selection: { maxDistanceMeters: file.lod === 0 ? 180 : 900, maxScreenSpaceError: file.lod === 0 ? 1 : 4 }, content: { relativeContentRef: file.relativeContentRef, format: "glb", sha256: file.sha256, byteSize: file.bytes, contentStatus: "verified", triangleCount: file.triangles, materialCount: file.materials, textureCount: file.textures, bounds: file.bounds } }));
    return { canonicalFeatureId: `doitt:${building.doittId}`, featureKind: "building", lineage: { sourceRegistryEntryIds: ["nyc.building-footprints", ...(nearReal ? [building.doittId === "778052" ? "commons.empire-state-photo-cc-by-sa-4" : "commons.herald-towers-photo-cc-by-sa-4"] : [])], sourceRefIds: [sourceRef("nyc.building-footprints", OTI_DATASET_ID, building.doittId, OTI_SOURCE_URL, "nyc-open-data-terms").id], licenseRefIds: ["license:nyc.building-footprints", ...(nearReal ? [building.doittId === "778052" ? "license:commons.empire-state-photo-cc-by-sa-4" : "license:commons.herald-towers-photo-cc-by-sa-4"] : [])], attribution: nearReal ? (building.doittId === "778052" ? "OTI footprint/roof plus individually reviewed ESB CC BY-SA facade references; no source pixels shipped." : "OTI footprint/roof plus individually reviewed Herald Towers CC BY-SA facade references; no source pixels shipped.") : "Source: NYC OTI GIS Building Footprints; facade/storefront treatment is estimated-procedural." }, capture: { capturedAt: OTI_CAPTURED_AT, authoredAt: isoNow(), updatedAt: null }, approval: { fixtureOnly: false, state: "approved", scope: "runtime", reviewedAt: isoNow(), note: nearReal ? "Licensed-near-real only for cited visible evidence; unseen sides/roof remain unknown." : "Source-constrained massing with estimated residential/general facade; no unsupported near-real claim." }, wgs84Anchor: { longitude: building.centroid[0], latitude: building.centroid[1], heightMeters: 0 }, transform: { coordinateFrame: "ENU", units: "meters", origin: "wgs84-anchor", matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], orientationConvention: "heading-degrees-clockwise-from-north;local+x-east;local+y-north;local+z-up;right-handed" }, bounds, lodVariants, quality: { triangleCount: maxTriangles, materialCount: maxMaterials, textureCount: maxTextures, budgets: { maxTriangles: nearReal ? 150000 : 75000, maxMaterials: 8, maxTextures: 0 } }, uncertaintyNotes: nearReal ? "Visible evidence-backed architectural observations only; roof/occluded sides remain unknown; OTI roof height is distinct from ESB DCP pinnacle." : "OTI footprint/height source-constrained massing; estimated residential/general facade and unknown roof/occluded details.", visualEvidenceLevel: nearReal ? "licensed-near-real" : "source-constrained-massing", facadeVerified: nearReal, roofVerified: false, verifiedSides: nearReal ? ["evidence-backed-visible-portions"] : [], commercialSignCount: packet.placements.filter((placement) => placement.canonicalBuildingId === building.canonicalBuildingId && placement.signPolicy === "neutral-text-only").length };
  };
  const assets = packet.membership.buildings.map((building) => makeAsset(building, assetsById.get(building.doittId) ?? []));
  const commercial = { schemaVersion: "1.0", releaseId: COMMERCIAL_RELEASE_ID, cityId: "manhattan", baseReleaseId: "manhattan-citywide-20260804", exteriorAssetPackageId: COMMERCIAL_RELEASE_ID, boundaryRule: packet.membership, sourceSnapshots: [{ datasetId: OTI_DATASET_ID, rawSha256: packet.sourceHashes.oti }, { datasetId: DOHMH_DATASET_ID, rawSha256: packet.sourceHashes.dohmh }, { datasetId: ADDRESSPOINT_DATASET_ID, rawSha256: packet.sourceHashes.addresspoint }, { datasetId: DCWP_DATASET_ID, rawSha256: packet.sourceHashes.dcwp }, { datasetId: "osm:block-835-overpass", rawSha256: packet.sourceHashes.osm }], licensePartitions: packet.licensePartitions, memberBuildingIds: BLOCK_835_DOITT_IDS.map((id) => `doitt:${id}`), tenantObservations: packet.observations.map((observation) => Object.fromEntries(Object.entries(observation).filter(([key]) => key !== "raw"))), tenantEntities: packet.tenants, buildingOccupancyLinks: packet.links, storefrontPlacements: packet.placements, rejectionConflictSummary: packet.counts, totals: { buildings: 14, parts: 14, lodAssets: assetEntries.length, acceptedSigns: packet.counts.acceptedStorefronts, storefrontPickProxies: packet.counts.acceptedStorefronts }, budgets: { maxSigns: 32, maxProxies: 32, maxCompressedMetadataBytes: 512 * 1024 }, fallback: "Per-building GLB errors restore that building's procedural source-constrained massing; release/base/hash errors disable only this optional overlay." };
  const release = { schemaVersion: "1.0", releaseId: COMMERCIAL_RELEASE_ID, cityId: "manhattan", generatedAt: isoNow(), fixtureOnly: false, approval: { evidenceId: COMMERCIAL_APPROVAL_ID, scope: "Local-only additive block-835 exterior/commercial overlay; no runtime provider requests." }, baseReleaseId: "manhattan-citywide-20260804", boundaryRule: packet.membership, sourceSnapshots: commercial.sourceSnapshots, licensePartitions: commercial.licensePartitions, commercialRelease: commercial, assets: { schemaVersion: "1.0", manifestId: COMMERCIAL_RELEASE_ID, cityId: "manhattan", generatedAt: isoNow(), fixtureOnly: false, assets }, assetEntries, sourcePacketSha256: sha256Bytes(jsonBytes(packet)), validation: { stage: true, reimportEvidence: reimportReportPath, renderEvidence: `/tmp/udt-stage3-commercial-20260805/renders` } };
  await writeExclusive(join(stageRoot, "release.json"), jsonBytes(release));
  await writeExclusive(join(stageRoot, "manifest.json"), jsonBytes({ schemaVersion: "1.0", releaseId: COMMERCIAL_RELEASE_ID, baseReleaseId: commercial.baseReleaseId, memberBuildingIds: commercial.memberBuildingIds, assetCount: assets.length, lodAssetCount: assetEntries.length, sourcePacketSha256: release.sourcePacketSha256, files: await manifestFiles(stageRoot) }));
  await writeExclusive(join(stageRoot, "commercial-frontage.json"), jsonBytes(commercial));
  console.log(JSON.stringify({ ok: true, stageRoot, assetCount: assets.length, lodAssetCount: assetEntries.length, acceptedSigns: packet.counts.acceptedStorefronts }, null, 2));
}

async function validateRelease(values) {
  const root = resolve(String(values.root ?? "/tmp/udt-stage3-commercial-20260805/release"));
  assert(await exists(root), `Release root is missing: ${root}`);
  const release = await readJson(join(root, "release.json"));
  assert(release.releaseId === COMMERCIAL_RELEASE_ID, "Release ID mismatch.");
  assert(JSON.stringify(release.boundaryRule.doittIds) === JSON.stringify([...BLOCK_835_DOITT_IDS]), "Release member IDs differ from exact block-835 matrix.");
  assert(release.assets?.assets?.length === 14, "Release must contain exactly 14 building assets.");
  assert(release.assetEntries?.length === 28, "Release must contain exactly 28 LOD content entries.");
  assert(release.commercialRelease?.licensePartitions?.some((partition) => partition.partitionId === "odbl-derived" && partition.license === "ODbL-1.0"), "Release ODbL partition missing.");
  const refs = new Set();
  for (const asset of release.assets.assets) {
    assert(asset.canonicalFeatureId.startsWith("doitt:"), `Unexpected asset identity ${asset.canonicalFeatureId}.`);
    assert(asset.bounds?.min?.length === 3 && asset.bounds?.max?.length === 3, `Missing bounds for ${asset.canonicalFeatureId}.`);
    assert(asset.bounds.max[2] > asset.bounds.min[2] && asset.bounds.min[2] >= -0.1, `Invalid ground/bounds for ${asset.canonicalFeatureId}.`);
    assert(asset.quality?.triangleCount > 0 && asset.quality?.materialCount > 0 && asset.quality?.textureCount === 0, `Missing clean-reimport quality metrics for ${asset.canonicalFeatureId}.`);
    assert(asset.quality.triangleCount <= asset.quality.budgets.maxTriangles && asset.quality.materialCount <= asset.quality.budgets.maxMaterials && asset.quality.textureCount <= asset.quality.budgets.maxTextures, `Asset quality budget exceeded for ${asset.canonicalFeatureId}.`);
    for (const lod of asset.lodVariants) {
      assert(!refs.has(lod.content.relativeContentRef), `Duplicate asset content ref ${lod.content.relativeContentRef}.`);
      refs.add(lod.content.relativeContentRef);
      const fileName = basename(lod.content.relativeContentRef);
      const staged = join(root, "assets", fileName);
      const published = join(process.cwd(), "public", "assets", COMMERCIAL_RELEASE_ID, fileName);
      const contentPath = await exists(staged) ? staged : published;
      assert(await exists(contentPath), `Missing staged/published content ${staged}.`);
      const bytes = await readFile(contentPath);
      assert(bytes.byteLength === lod.content.byteSize && sha256Bytes(bytes) === lod.content.sha256, `GLB hash/byte mismatch ${lod.content.relativeContentRef}.`);
      assert(lod.content.triangleCount > 0 && lod.content.triangleCount <= asset.quality.budgets.maxTriangles, `LOD triangle budget exceeded ${lod.content.relativeContentRef}.`);
      assert(lod.content.materialCount > 0 && lod.content.materialCount <= asset.quality.budgets.maxMaterials && lod.content.textureCount === 0, `LOD material/texture budget exceeded ${lod.content.relativeContentRef}.`);
      assert(lod.content.bounds?.min?.length === 3 && lod.content.bounds?.max?.length === 3, `LOD bounds missing ${lod.content.relativeContentRef}.`);
    }
  }
  assert(refs.size === 28, "Release must expose 28 unique LOD content refs.");
  const placements = release.commercialRelease.storefrontPlacements ?? [];
  const accepted = placements.filter((placement) => placement.signPolicy === "neutral-text-only" && placement.placementDecision.startsWith("storefront"));
  assert(accepted.length <= 32, "Storefront signs/proxies exceed 32.");
  console.log(JSON.stringify({ ok: true, root, assets: release.assets.assets.length, lodAssets: refs.size, acceptedSigns: accepted.length, memberBuildingIds: release.boundaryRule.doittIds }, null, 2));
}

async function benchmark(values) {
  const root = resolve(String(values.root ?? "/tmp/udt-stage3-commercial-20260805/release"));
  const release = await readJson(join(root, "release.json"));
  const totalBytes = (release.assetEntries ?? []).reduce((sum, entry) => sum + entry.bytes, 0);
  const lod0 = (release.assetEntries ?? []).filter((entry) => entry.lod === 0).reduce((sum, entry) => sum + entry.bytes, 0);
  const lod1 = (release.assetEntries ?? []).filter((entry) => entry.lod === 1).reduce((sum, entry) => sum + entry.bytes, 0);
  const result = { releaseId: release.releaseId, lodAssetCount: release.assetEntries?.length ?? 0, totalBytes, lod0Bytes: lod0, lod1Bytes: lod1, maxBytes: 80 * 1024 * 1024, runtimeEntities: 14, activeOverlayRequests: 4, storefrontProxyCeiling: 32, frameTimeEvidence: "/tmp/udt-stage3-commercial-20260805/browser/performance.json", status: totalBytes <= 80 * 1024 * 1024 ? "pass" : "fail" };
  assert(result.status === "pass", "GLB package exceeds 80 MiB.");
  const benchmarkPath = join(root, "benchmark.json");
  if (await exists(benchmarkPath)) {
    const existing = await readJson(benchmarkPath);
    assert(stable(existing) === stable(result), "Existing immutable benchmark differs from the deterministic result.");
  } else {
    await writeExclusive(benchmarkPath, jsonBytes(result));
  }
  console.log(JSON.stringify(result, null, 2));
}

async function publishLocal(values) {
  const root = resolve(String(values.root ?? "/tmp/udt-stage3-commercial-20260805/release"));
  const destination = resolve(String(values.destination ?? `public/data/${COMMERCIAL_RELEASE_ID}`));
  const assetDestination = resolve(String(values["asset-destination"] ?? `public/assets/${COMMERCIAL_RELEASE_ID}`));
  assert(await exists(root), `Staging root is missing: ${root}`);
  assert(!(await exists(destination)) && !(await exists(assetDestination)), "Refusing an existing immutable publish destination.");
  const release = await readJson(join(root, "release.json"));
  assert(release.validation?.stage === true, "Release staging replay flag is missing.");
  await mkdir(destination, { recursive: true });
  await mkdir(assetDestination, { recursive: true });
  const releaseBytes = await readFile(join(root, "release.json"));
  await writeExclusive(join(destination, "release.json"), releaseBytes);
  await writeExclusive(join(destination, "commercial-frontage.json"), await readFile(join(root, "commercial-frontage.json")));
  await writeExclusive(join(destination, "manifest.json"), await readFile(join(root, "manifest.json")));
  for (const entry of release.assetEntries) {
    const source = join(root, "assets", entry.fileName);
    await writeExclusive(join(assetDestination, entry.fileName), await readFile(source));
  }
  console.log(JSON.stringify({ ok: true, destination, assetDestination, releaseId: release.releaseId, assetCount: release.assets.assets.length, lodAssetCount: release.assetEntries.length }, null, 2));
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  const values = parseArgs(argv);
  if (command === "acquire") return acquire(values);
  if (command === "overpass-retry") return retryOverpass(values);
  if (command === "commercial-poi-overpass") return commercialPoiOverpass(values);
  if (command === "validate:raw") return validateRaw(values);
  if (command === "normalize") return buildNormalized(values);
  if (command === "build") return buildRelease(values);
  if (command === "validate") return validateRelease(values);
  if (command === "benchmark") return benchmark(values);
  if (command === "publish-local") return publishLocal(values);
  throw new Error("Usage: exterior-pilot-cli.mjs <acquire|overpass-retry|commercial-poi-overpass|validate:raw|normalize|build|validate|benchmark|publish-local> [--key value]");
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
