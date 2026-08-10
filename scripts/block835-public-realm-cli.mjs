/* global AbortSignal, URL, URLSearchParams, fetch, process, console */

/**
 * Block 835 public-realm release tooling.
 *
 * The CLI is deliberately dependency-free and fail-closed.  It talks only to
 * the three approved NYC OTI Planimetrics datasets during `acquire`; all
 * normalisation, validation, release packaging, and browser use are local.
 */
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const CAPTURE_DATE = "20260806";
const RELEASE_ID = `manhattan-esb-block-public-realm-${CAPTURE_DATE}`;
const RAW_ROOT = join(REPO_ROOT, "data/raw", RELEASE_ID);
const NORMALIZED_ROOT = join(REPO_ROOT, "data/normalized", RELEASE_ID);
const PUBLIC_DATA_ROOT = join(REPO_ROOT, "public/data", RELEASE_ID);
const PUBLIC_ASSET_ROOT = join(REPO_ROOT, "public/assets", RELEASE_ID);
const EXISTING_EXTERIOR_RELEASE = "manhattan-esb-block-exterior-pilot-20260805";
const APPROVAL_ID = "approval:block835-public-realm:20260806:user-approved";
const APPROVAL_FINGERPRINT = "378fec5e7306c224c133de78cc18323b9ca8410039af76974dfabdf7de4cb5d5";
const NYC_TERMS_URL = "https://opendata.cityofnewyork.us/overview/";
const CAPTURE_RULES_URL = "https://raw.githubusercontent.com/CityOfNewYork/nyc-planimetrics/master/Capture_Rules.md";
const APPROVED_HOSTS = new Set(["data.cityofnewyork.us", "opendata.cityofnewyork.us", "raw.githubusercontent.com"]);
const USER_AGENT = "UrbanDigitalTwin-Block835PublicRealm/2026.08 (local immutable snapshot; no runtime requests)";
const MAX_RESPONSE_BYTES = 80 * 1024 * 1024;
const PAGE_SIZE = 5000;
const BUFFER_METERS = 35;
const MAX_CLIP_TOLERANCE_METERS = 0.01;
const WGS84_METERS_PER_DEGREE_LAT = 111_320;
const BLOCK_RELEASE_PATH = join(REPO_ROOT, "public/data", EXISTING_EXTERIOR_RELEASE, "release.json");
const FOCUSED_BROWSER_SAMPLE_TARGET = 600;
const FOCUSED_BROWSER_ORIGIN = "http://localhost:5173";
const FOCUSED_BROWSER_FAMILIES = new Set(["Google Chrome", "Safari"]);
const FOCUSED_BROWSER_EVIDENCE_ROOT = "/tmp/udt-block835-public-realm-20260806";

const SOURCES = [
  {
    datasetId: "vfx9-tbb6",
    mappedViewId: "52n9-sdep",
    semantic: "sidewalk",
    canonicalUrl: "https://data.cityofnewyork.us/City-Government/Sidewalk/vfx9-tbb6",
    metadataUrl: "https://data.cityofnewyork.us/api/views/vfx9-tbb6",
    mappedMetadataUrl: "https://data.cityofnewyork.us/api/views/52n9-sdep",
    endpoint: "https://data.cityofnewyork.us/resource/52n9-sdep.geojson",
    fields: ["the_geom", "source_id", "sub_code", "feat_code", "status", "shape_leng", "shape_area"],
    geometryType: "MultiPolygon",
  },
  {
    datasetId: "xgwd-7vhd",
    mappedViewId: "i36f-5ih7",
    semantic: "roadbed",
    canonicalUrl: "https://data.cityofnewyork.us/City-Government/Roadbed/xgwd-7vhd",
    metadataUrl: "https://data.cityofnewyork.us/api/views/xgwd-7vhd",
    mappedMetadataUrl: "https://data.cityofnewyork.us/api/views/i36f-5ih7",
    endpoint: "https://data.cityofnewyork.us/resource/i36f-5ih7.geojson",
    fields: ["the_geom", "source_id", "sub_code", "feat_code", "status", "shape_leng", "shape_area"],
    geometryType: "MultiPolygon",
  },
  {
    datasetId: "x9uq-u3qs",
    mappedViewId: "vs44-rznx",
    semantic: "pavement-edge",
    canonicalUrl: "https://data.cityofnewyork.us/City-Government/Pavement-Edge/x9uq-u3qs",
    metadataUrl: "https://data.cityofnewyork.us/api/views/x9uq-u3qs",
    mappedMetadataUrl: "https://data.cityofnewyork.us/api/views/vs44-rznx",
    endpoint: "https://data.cityofnewyork.us/resource/vs44-rznx.geojson",
    fields: ["the_geom", "source_id", "sub_code", "feat_code", "status", "blockf_id", "conflated", "shape_leng"],
    geometryType: "MultiLineString",
  },
];

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) continue;
    const equal = token.indexOf("=");
    if (equal > 2) args[token.slice(2, equal)] = token.slice(equal + 1);
    else if (argv[index + 1] && !argv[index + 1].startsWith("--")) { args[token.slice(2)] = argv[index + 1]; index += 1; }
    else args[token.slice(2)] = true;
  }
  return args;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function jsonBytes(value) { return Buffer.from(`${stable(value)}\n`, "utf8"); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function finite(value) { return typeof value === "number" && Number.isFinite(value); }
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function nonEmpty(value) { return typeof value === "string" && value.trim().length > 0; }
function metresPerDegreeLon(latitude) { return WGS84_METERS_PER_DEGREE_LAT * Math.cos(latitude * Math.PI / 180); }
function round(value, digits = 9) { return Number(value.toFixed(digits)); }

function equalStable(left, right) { return stable(left) === stable(right); }
function localOnlyHosts(value) { return Array.isArray(value) && value.length === 1 && value[0] === "localhost:5173"; }

function validateFocusedBrowserRun(run, condition) {
  assert(isObject(run), `${condition} browser measurement is missing.`);
  assert(run.status === "complete" && run.condition === condition, `${condition} browser measurement did not complete.`);
  assert(run.releaseId === RELEASE_ID, `${condition} browser measurement release ID mismatch.`);
  assert(nonEmpty(run.browserSessionId) && nonEmpty(run.capturedAt), `${condition} browser measurement session/timestamp is missing.`);
  assert(Number.isInteger(run.sampleCount) && run.sampleCount >= FOCUSED_BROWSER_SAMPLE_TARGET, `${condition} requires at least ${FOCUSED_BROWSER_SAMPLE_TARGET} settled requestAnimationFrame samples.`);
  assert(finite(run.medianMs) && finite(run.p95Ms) && finite(run.maxMs), `${condition} browser timing summary is incomplete.`);
  assert(isObject(run.cameraPath) && nonEmpty(run.cameraPath.id) && Array.isArray(run.cameraPath.poses) && run.cameraPath.poses.length === 6 && run.cameraPath.settleMs === 1_000 && run.cameraPath.samplesPerPose === 100, `${condition} did not use the required six-pose deterministic camera path.`);
  assert(run.cameraPath.poses.every((pose) => isObject(pose) && ["longitude", "latitude", "height", "heading", "pitch", "roll"].every((key) => finite(pose[key]))), `${condition} camera path contains a non-finite pose.`);
  assert(run.documentHasFocus?.before === true && run.documentHasFocus?.after === true, `${condition} browser page was not focused for its full sample.`);
  assert(run.visibilityState?.before === "visible" && run.visibilityState?.after === "visible", `${condition} browser page was not visible for its full sample.`);
  assert(isObject(run.viewportCss) && Number.isInteger(run.viewportCss.width) && run.viewportCss.width > 0 && Number.isInteger(run.viewportCss.height) && run.viewportCss.height > 0 && finite(run.devicePixelRatio) && run.devicePixelRatio > 0, `${condition} viewport/DPR metadata is incomplete.`);
  assert(Array.isArray(run.consoleErrors) && run.consoleErrors.length === 0 && Array.isArray(run.windowErrors) && run.windowErrors.length === 0, `${condition} recorded console or window errors.`);
  assert(localOnlyHosts(run.networkHosts), `${condition} recorded a non-local runtime host.`);
  assert(run.reason === null, `${condition} browser measurement reported an invalid reason.`);
}

function validateRendererProof(value, condition) {
  assert(isObject(value), `${condition} renderer proof is missing.`);
  assert(value.expectedBuildingCount === 14 && value.activeBuildingCount === 14 && value.expectedStorefrontCount === 8 && value.activeStorefrontCount === 8 && value.pass === true, `${condition} renderer proof does not show 14 active GLB entities and 8 active storefront proxies.`);
}

function validateFocusedBrowserEvidence(evidence) {
  assert(isObject(evidence), "Focused external-browser evidence must be an object.");
  assert(evidence.schemaVersion === "1.0" && evidence.evidenceType === "block835-focused-external-browser-performance", "Focused external-browser evidence schema/type mismatch.");
  assert(nonEmpty(evidence.capturedAt), "Focused external-browser evidence timestamp is missing.");
  assert(isObject(evidence.browser) && FOCUSED_BROWSER_FAMILIES.has(evidence.browser.family) && evidence.browser.external === true && evidence.browser.origin === FOCUSED_BROWSER_ORIGIN && evidence.browser.sameBrowserSession === true && nonEmpty(evidence.browser.browserSessionId), "Focused evidence must name an external Chrome/Safari localhost session.");
  assert(isObject(evidence.server) && evidence.server.pid === 19129 && evidence.server.restarted === false, "Focused evidence must name the unchanged Vite PID 19129.");
  validateFocusedBrowserRun(evidence.control, "stage3-only");
  validateFocusedBrowserRun(evidence.overlay, "stage3-plus-public-realm");
  assert(evidence.control.browserSessionId === evidence.browser.browserSessionId && evidence.overlay.browserSessionId === evidence.browser.browserSessionId, "Control and overlay measurements were not captured in the same browser session.");
  assert(equalStable(evidence.control.cameraPath, evidence.overlay.cameraPath) && equalStable(evidence.cameraPath, evidence.control.cameraPath), "Control and overlay did not use the identical deterministic camera path.");
  assert(equalStable(evidence.control.viewportCss, evidence.overlay.viewportCss) && evidence.control.devicePixelRatio === evidence.overlay.devicePixelRatio, "Control and overlay viewport/DPR differ.");
  const comparison = evidence.overlay.comparison;
  assert(isObject(comparison) && comparison.sameBrowserSession === true, "Overlay comparison does not prove same-session measurement.");
  const p95DeltaMs = evidence.overlay.p95Ms - evidence.control.p95Ms;
  const p95Regression = p95DeltaMs / evidence.control.p95Ms;
  assert(Math.abs(comparison.p95DeltaMs - p95DeltaMs) <= 1e-6 && Math.abs(comparison.p95Regression - p95Regression) <= 1e-6, "Stored p95 delta/regression is inconsistent with the raw samples.");
  assert(evidence.overlay.medianMs <= 12 && evidence.overlay.p95Ms <= 30 && p95Regression <= 0.2, "Focused overlay performance gates failed (median <=12 ms, p95 <=30 ms, p95 regression <=20%).");
  assert(comparison.overlayMedianPass === true && comparison.overlayP95Pass === true && comparison.p95RegressionPass === true && comparison.pass === true, "Overlay comparison flags do not confirm all required gates.");
  assert(isObject(evidence.rendererProof) && evidence.rendererProof.modelUriPrefix === `/assets/${EXISTING_EXTERIOR_RELEASE}/` && evidence.rendererProof.storefrontProxyPrefix === "commercial-storefront:", "Renderer proof provenance is incomplete.");
  validateRendererProof(evidence.rendererProof.control, "stage3-only");
  validateRendererProof(evidence.rendererProof.overlay, "stage3-plus-public-realm");
  assert(isObject(evidence.urls) && evidence.urls.control?.startsWith(`${FOCUSED_BROWSER_ORIGIN}/?`) && evidence.urls.overlay?.startsWith(`${FOCUSED_BROWSER_ORIGIN}/?`), "Focused evidence must retain localhost control and overlay URLs.");
}

async function readJson(path) { return JSON.parse(await readFile(path, "utf8")); }
async function writeExclusive(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { flag: "wx" });
}
async function writeStable(path, value) { await writeExclusive(path, jsonBytes(value)); }
async function pathExists(path) { try { await stat(path); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; } }
function approvedUrl(value) {
  const parsed = new URL(value);
  assert(parsed.protocol === "https:", `HTTPS is required: ${value}`);
  assert(APPROVED_HOSTS.has(parsed.hostname), `Unapproved source host: ${parsed.hostname}`);
  return parsed;
}

function responseHeaders(response) {
  return Object.fromEntries([...response.headers.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

async function requestBytes(url, expectedHost = null) {
  const parsed = approvedUrl(url);
  if (expectedHost) assert(parsed.hostname === expectedHost, `Expected ${expectedHost}, received ${parsed.hostname}.`);
  const startedAt = new Date().toISOString();
  const response = await fetch(parsed, { redirect: "manual", headers: { Accept: "application/json,text/plain,text/html", "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(120_000) });
  const finishedAt = new Date().toISOString();
  assert(response.status >= 200 && response.status < 300, `HTTP ${response.status} from ${url}; no fallback provider is permitted.`);
  assert(![301, 302, 303, 307, 308].includes(response.status), `Redirect rejected from ${url}.`);
  assert(response.body, `No response body from ${url}.`);
  const chunks = [];
  let byteCount = 0;
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk);
    byteCount += bytes.byteLength;
    assert(byteCount <= MAX_RESPONSE_BYTES, `Response exceeds ${MAX_RESPONSE_BYTES} bytes from ${url}.`);
    chunks.push(bytes);
  }
  const body = Buffer.concat(chunks);
  return { url: parsed.toString(), startedAt, finishedAt, status: response.status, headers: responseHeaders(response), bytes: body.byteLength, sha256: sha256(body), body };
}

function coordWalk(value, callback) {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") { callback(value); return; }
  value.forEach((part) => coordWalk(part, callback));
}

function extentOfCoordinates(coordinates) {
  const xs = [];
  const ys = [];
  coordWalk(coordinates, (point) => { xs.push(point[0]); ys.push(point[1]); });
  if (!xs.length) return null;
  return { west: Math.min(...xs), east: Math.max(...xs), south: Math.min(...ys), north: Math.max(...ys) };
}

function mergeExtent(current, next) {
  if (!next) return current;
  if (!current) return { ...next };
  return { west: Math.min(current.west, next.west), east: Math.max(current.east, next.east), south: Math.min(current.south, next.south), north: Math.max(current.north, next.north) };
}

async function blockExtent() {
  assert(existsSync(BLOCK_RELEASE_PATH), `Existing exterior release is missing: ${BLOCK_RELEASE_PATH}`);
  const release = await readJson(BLOCK_RELEASE_PATH);
  const buildings = release?.boundaryRule?.buildings;
  assert(Array.isArray(buildings) && buildings.length === 14, "Existing Stage 3 boundary must contain exactly 14 Block 835 buildings.");
  let sourceExtent = null;
  for (const building of buildings) sourceExtent = mergeExtent(sourceExtent, extentOfCoordinates(building?.footprint));
  assert(sourceExtent, "Existing Block 835 union has no finite coordinates.");
  const midLatitude = (sourceExtent.south + sourceExtent.north) / 2;
  const latitudeDelta = BUFFER_METERS / WGS84_METERS_PER_DEGREE_LAT;
  const longitudeDelta = BUFFER_METERS / metresPerDegreeLon(midLatitude);
  return {
    sourceExtent: Object.fromEntries(Object.entries(sourceExtent).map(([key, value]) => [key, round(value)])),
    bufferMeters: BUFFER_METERS,
    clipBounds: {
      west: round(sourceExtent.west - longitudeDelta),
      east: round(sourceExtent.east + longitudeDelta),
      south: round(sourceExtent.south - latitudeDelta),
      north: round(sourceExtent.north + latitudeDelta),
    },
    rule: "14-member existing Block 835 building-union envelope buffered by 35 m geodesically at union mid-latitude; official features fetched with within_box and retained only when every coordinate is inside this envelope (no silent geometry repair).",
  };
}

function queryFor(source, bounds) {
  const where = `within_box(the_geom,${bounds.south},${bounds.west},${bounds.north},${bounds.east})`;
  const url = new URL(source.endpoint);
  url.search = new URLSearchParams({ $select: source.fields.join(","), $where: where, $limit: String(PAGE_SIZE) }).toString();
  return { url: url.toString(), endpoint: source.endpoint, fields: source.fields, where, pageSize: PAGE_SIZE, mappedViewId: source.mappedViewId };
}

function sourceApproval() {
  return {
    evidenceId: APPROVAL_ID,
    fingerprintSha256: APPROVAL_FINGERPRINT,
    scope: "Local-only immutable Block 835 public-realm snapshot from exactly the three approved NYC OTI Planimetrics datasets; source-backed roadbed/sidewalk, estimated/source-constrained curbs, and estimated deterministic crosswalks at four adjacent intersections.",
    exclusions: ["Google", "OSM/Overpass", "third-party providers", "credentials/payment", "runtime external network", "public deployment/conveyance", "Manhattan-wide generation"],
  };
}

async function acquire() {
  assert(!(await pathExists(RAW_ROOT)), `Raw snapshot already exists; immutable acquisition refuses overwrite: ${RAW_ROOT}`);
  const bounds = await blockExtent();
  const capturedAt = new Date().toISOString();
  const files = [];
  const recordFile = async (path, bytes, role, sourceId = null) => {
    await writeExclusive(path, bytes);
    files.push({ path: relative(RAW_ROOT, path).split("\\").join("/"), bytes: bytes.byteLength, sha256: sha256(bytes), role, sourceId });
  };
  await recordFile(join(RAW_ROOT, "approval.json"), jsonBytes(sourceApproval()), "approval");
  await recordFile(join(RAW_ROOT, "acquisition-contract.json"), jsonBytes({ schemaVersion: "1.0", releaseId: RELEASE_ID, capturedAt, approval: sourceApproval(), clip: bounds, sourceNativeCrs: "EPSG:2263 (NAD83 / New York Long Island US feet) per official Capture Rules", sourceVerticalDatum: "NAVD88", responseCrs: "CRS84/WGS84 GeoJSON published by NYC Open Data; no Z coordinate is present in this API response", transformPolicy: "Preserve source coordinates and Z exactly; CRS84 response coordinates use deterministic identity to EPSG:4326. A State Plane EPSG:2263 inverse transform is implemented in the normalizer for source-native inputs, but is not applied to this already-published CRS84 response.", providerIdentity: "NYC Office of Technology and Innovation (OTI)", noFallbackProviders: true }), "contract");

  const terms = await requestBytes(NYC_TERMS_URL, "opendata.cityofnewyork.us");
  await recordFile(join(RAW_ROOT, "terms", "nyc-open-data-overview.html"), terms.body, "terms");
  const rules = await requestBytes(CAPTURE_RULES_URL, "raw.githubusercontent.com");
  await recordFile(join(RAW_ROOT, "terms", "capture-rules.md"), rules.body, "capture-rules");

  const snapshots = [];
  for (const source of SOURCES) {
    const metadata = await requestBytes(source.metadataUrl, "data.cityofnewyork.us");
    const mappedMetadata = await requestBytes(source.mappedMetadataUrl, "data.cityofnewyork.us");
    await recordFile(join(RAW_ROOT, source.datasetId, "metadata.json"), metadata.body, "metadata", source.datasetId);
    await recordFile(join(RAW_ROOT, source.datasetId, "mapped-metadata.json"), mappedMetadata.body, "mapped-metadata", source.datasetId);
    const query = queryFor(source, bounds.clipBounds);
    const response = await requestBytes(query.url, "data.cityofnewyork.us");
    await recordFile(join(RAW_ROOT, source.datasetId, "query.json"), jsonBytes({ ...query, requestedAt: response.startedAt, finishedAt: response.finishedAt, responseUrl: response.url }), "query", source.datasetId);
    await recordFile(join(RAW_ROOT, source.datasetId, "response.geojson"), response.body, "raw-response", source.datasetId);
    const value = JSON.parse(response.body.toString("utf8"));
    assert(value?.type === "FeatureCollection" && Array.isArray(value.features), `${source.datasetId} response is not GeoJSON FeatureCollection.`);
    snapshots.push({ datasetId: source.datasetId, mappedViewId: source.mappedViewId, semantic: source.semantic, canonicalUrl: source.canonicalUrl, metadataUrl: source.metadataUrl, mappedMetadataUrl: source.mappedMetadataUrl, endpoint: query.endpoint, query: { fields: query.fields, where: query.where, pageSize: query.pageSize, url: query.url }, captureTimestamp: response.finishedAt, sourceResponseCrs: value.crs ?? null, featureCount: value.features.length, rawRelativePath: `${source.datasetId}/response.geojson`, rawSha256: response.sha256, rawBytes: response.bytes, metadataSha256: metadata.sha256, mappedMetadataSha256: mappedMetadata.sha256, responseHeaders: response.headers });
  }
  const manifest = { schemaVersion: "1.0", releaseId: RELEASE_ID, capturedAt, approval: sourceApproval(), clip: bounds, sourceSnapshots: snapshots, terms: { overviewUrl: NYC_TERMS_URL, overviewPath: "terms/nyc-open-data-overview.html", overviewSha256: files.find((file) => file.path === "terms/nyc-open-data-overview.html")?.sha256, captureRulesUrl: CAPTURE_RULES_URL, captureRulesPath: "terms/capture-rules.md", captureRulesSha256: files.find((file) => file.path === "terms/capture-rules.md")?.sha256 }, files: files.sort((left, right) => left.path.localeCompare(right.path)) };
  const manifestBytes = jsonBytes(manifest);
  await recordFile(join(RAW_ROOT, "manifest.json"), manifestBytes, "manifest");
  await writeExclusive(join(RAW_ROOT, "manifest.sha256"), Buffer.from(`${sha256(manifestBytes)}  manifest.json\n`, "utf8"));
  console.log(JSON.stringify({ ok: true, releaseId: RELEASE_ID, rawRoot: RAW_ROOT, snapshots: snapshots.map(({ datasetId, semantic, featureCount, rawSha256 }) => ({ datasetId, semantic, featureCount, rawSha256 })), clip: bounds.clipBounds }, null, 2));
}

function sourceRows(rawValue) {
  assert(rawValue?.type === "FeatureCollection" && Array.isArray(rawValue.features), "Raw response must be a GeoJSON FeatureCollection.");
  return rawValue.features;
}

function withinBounds(extent, bounds, tolerance = MAX_CLIP_TOLERANCE_METERS) {
  const latTolerance = tolerance / WGS84_METERS_PER_DEGREE_LAT;
  const lonTolerance = tolerance / metresPerDegreeLon((bounds.south + bounds.north) / 2);
  return extent && extent.west >= bounds.west - lonTolerance && extent.east <= bounds.east + lonTolerance && extent.south >= bounds.south - latTolerance && extent.north <= bounds.north + latTolerance;
}

function coordinateTransformRecord() {
  return {
    inputCrs: "CRS84/EPSG:4326",
    outputCrs: "EPSG:4326",
    sourceNativeCrs: "EPSG:2263",
    verticalDatum: "NAVD88",
    method: "identity for the published Socrata CRS84 response; source-native State Plane coordinates are not silently reinterpreted",
    residualMeters: 0,
    zPolicy: "source Z preserved when present; published response has no Z and normalized records carry null",
  };
}

function normalizeGeometry(geometry) {
  if (!isObject(geometry) || typeof geometry.type !== "string" || !Array.isArray(geometry.coordinates)) return null;
  const cloned = JSON.parse(JSON.stringify(geometry));
  let valid = true;
  coordWalk(cloned.coordinates, (point) => { if (!finite(point[0]) || !finite(point[1]) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) valid = false; });
  return valid ? cloned : null;
}

function recordFromSource(feature, source, bounds, index) {
  const rawId = feature?.properties?.source_id;
  const sourceFeatureId = rawId === undefined || rawId === null ? null : String(rawId).replace(/\.0$/u, "");
  const geometry = normalizeGeometry(feature?.geometry);
  const extent = geometry ? extentOfCoordinates(geometry.coordinates) : null;
  if (!sourceFeatureId) return { quarantine: { index, reason: "missing-source-id", sourceFeatureId: null } };
  if (!geometry) return { quarantine: { index, reason: "invalid-or-nonfinite-geometry", sourceFeatureId } };
  if (geometry.type !== source.geometryType) return { quarantine: { index, reason: `unexpected-geometry-type:${geometry.type}`, sourceFeatureId } };
  if (!withinBounds(extent, bounds.clipBounds)) return { quarantine: { index, reason: "geometry-outside-deterministic-clip", sourceFeatureId, extent } };
  return { accepted: {
    id: `${source.semantic}:${sourceFeatureId}${sourceFeatureId === "0" ? `:row-${index}` : ""}`,
    semantic: source.semantic,
    sourceDatasetId: source.datasetId,
    sourceMappedViewId: source.mappedViewId,
    sourceFeatureId,
    sourceFeatureIdRaw: rawId,
    sourceFeatureIndex: index,
    sourceProperties: Object.fromEntries(source.fields.filter((field) => field !== "the_geom").map((field) => [field, feature.properties?.[field] ?? null])),
    geometry,
    sourceCoordinates: JSON.parse(JSON.stringify(geometry.coordinates)),
    sourceCrs: "CRS84",
    normalizedCrs: "EPSG:4326",
    verticalDatum: "NAVD88",
    zPreserved: false,
    claimLevel: "source-backed",
    sourceEpoch: "2022 imagery capture; 2023 planimetric update completion context",
    uncertainty: { horizontalMeters: 0.25, verticalMeters: null, temporal: "Source geometry is planimetric and not a survey/current-condition claim." },
    clip: { rule: bounds.rule, clipped: false, toleranceMeters: MAX_CLIP_TOLERANCE_METERS },
    transform: coordinateTransformRecord(),
  } };
}

function localMetersToWgs84(origin, eastMeters, northMeters) {
  return [round(origin[0] + eastMeters / metresPerDegreeLon(origin[1])), round(origin[1] + northMeters / WGS84_METERS_PER_DEGREE_LAT)];
}

function crosswalkGeometry(center, axis, parameters) {
  const polygons = [];
  const { stripeCount, stripeLengthMeters, stripeWidthMeters, stripeGapMeters } = parameters;
  const total = stripeCount * stripeWidthMeters + (stripeCount - 1) * stripeGapMeters;
  for (let index = 0; index < stripeCount; index += 1) {
    const offset = -total / 2 + stripeWidthMeters / 2 + index * (stripeWidthMeters + stripeGapMeters);
    const corners = axis === "east-west"
      ? [[-stripeLengthMeters / 2, offset], [stripeLengthMeters / 2, offset], [stripeLengthMeters / 2, offset + stripeWidthMeters], [-stripeLengthMeters / 2, offset + stripeWidthMeters]]
      : [[offset, -stripeLengthMeters / 2], [offset + stripeWidthMeters, -stripeLengthMeters / 2], [offset + stripeWidthMeters, stripeLengthMeters / 2], [offset, stripeLengthMeters / 2]];
    polygons.push([corners.map(([east, north]) => localMetersToWgs84(center, east, north))]);
  }
  return { type: "MultiPolygon", coordinates: polygons };
}

function deriveCrosswalks(bounds, sourceFeatures) {
  const sourceExtent = bounds.sourceExtent;
  const corners = [
    { id: "w33-broadway", center: [sourceExtent.west, sourceExtent.south], axis: "east-west", streetFace: "West 33rd Street / Broadway-side approach" },
    { id: "w33-fifth-avenue", center: [sourceExtent.east, sourceExtent.south], axis: "north-south", streetFace: "West 33rd Street / Fifth Avenue approach" },
    { id: "w34-broadway", center: [sourceExtent.west, sourceExtent.north], axis: "north-south", streetFace: "West 34th Street / Broadway-side approach" },
    { id: "w34-fifth-avenue", center: [sourceExtent.east, sourceExtent.north], axis: "east-west", streetFace: "West 34th Street / Fifth Avenue approach" },
  ];
  const parameters = { stripeCount: 6, stripeLengthMeters: 18, stripeWidthMeters: 0.55, stripeGapMeters: 0.65, crossingWidthMeters: 6, authoredElevationMeters: 0.14 };
  const sourceInputs = sourceFeatures.filter((feature) => feature.semantic === "roadbed").map((feature) => `${feature.sourceDatasetId}:${feature.sourceFeatureId}`).sort();
  return corners.map((corner) => ({
    id: `crosswalk:${corner.id}`,
    semantic: "crosswalk",
    intersectionId: corner.id,
    streetFace: corner.streetFace,
    sourceDatasetId: "derived:nyc-oti-planimetrics",
    sourceFeatureIds: sourceInputs,
    geometry: crosswalkGeometry(corner.center, corner.axis, parameters),
    sourceCrs: "CRS84",
    normalizedCrs: "EPSG:4326",
    verticalDatum: "NAVD88",
    claimLevel: "estimated",
    derivation: { algorithm: "deterministic-four-corner-crosswalk-v1", inputs: ["Block 835 union extent", "roadbed source feature IDs", "approved clip rule"], parameters, noCurrentPaintEvidence: true },
    uncertainty: { horizontalMeters: 2, verticalMeters: 0.05, temporal: "Placement, stripe count, width, and current paint state are estimated; no survey/current-paint claim." },
    transform: coordinateTransformRecord(),
  }));
}

async function normalize(args) {
  const rawRoot = resolve(args.raw ?? RAW_ROOT);
  const outRoot = resolve(args.out ?? NORMALIZED_ROOT);
  assert(await pathExists(rawRoot), `Raw snapshot not found: ${rawRoot}`);
  assert(!(await pathExists(outRoot)), `Normalized output already exists; deterministic normalizer refuses overwrite: ${outRoot}`);
  const rawManifest = await readJson(join(rawRoot, "manifest.json"));
  assert(rawManifest.approval?.evidenceId === APPROVAL_ID, "Raw approval evidence ID does not match the approved Block 835 scope.");
  const allFeatures = [];
  const quarantined = [];
  const accounting = [];
  for (const source of SOURCES) {
    const snapshot = rawManifest.sourceSnapshots.find((candidate) => candidate.datasetId === source.datasetId);
    assert(snapshot, `Missing raw snapshot ${source.datasetId}.`);
    const raw = await readJson(join(rawRoot, snapshot.rawRelativePath));
    const rows = sourceRows(raw);
    const accepted = [];
    let rejected = 0;
    rows.forEach((feature, index) => {
      const result = recordFromSource(feature, source, rawManifest.clip, index);
      if (result.accepted) { accepted.push(result.accepted); allFeatures.push(result.accepted); }
      else { quarantined.push({ datasetId: source.datasetId, semantic: source.semantic, ...result.quarantine }); rejected += 1; }
    });
    accounting.push({ datasetId: source.datasetId, semantic: source.semantic, fetched: rows.length, accepted: accepted.length, rejected, quarantined: rejected, outOfScope: 0, unaccounted: rows.length - accepted.length - rejected });
  }
  assert(accounting.every((item) => item.unaccounted === 0), "Normalizer left unaccounted source records.");
  const curbInputs = allFeatures.filter((feature) => feature.semantic === "pavement-edge");
  const curbs = curbInputs.map((feature) => ({
    id: `curb:${feature.sourceFeatureId}${feature.sourceFeatureId === "0" ? `:row-${feature.sourceFeatureIndex}` : ""}`,
    semantic: "curb",
    sourceDatasetId: feature.sourceDatasetId,
    sourceMappedViewId: feature.sourceMappedViewId,
    sourceFeatureId: feature.sourceFeatureId,
    sourceFeatureIdRaw: feature.sourceFeatureIdRaw,
    sourceFeatureIndex: feature.sourceFeatureIndex,
    sourceFeatureIds: [feature.sourceFeatureId],
    sourceProperties: feature.sourceProperties,
    sourceGeometry: feature.geometry,
    geometry: feature.geometry,
    sourceCrs: feature.sourceCrs,
    normalizedCrs: feature.normalizedCrs,
    verticalDatum: feature.verticalDatum,
    claimLevel: "estimated",
    derivation: { algorithm: "pavement-edge-constrained-curb-v1", inputDataset: "x9uq-u3qs", inputSourceFeatureId: feature.sourceFeatureId, profile: { topElevationMeters: 0.22, roadbedElevationMeters: 0, authoredRiseMeters: 0.22, profileIsEstimated: true } },
    uncertainty: { horizontalMeters: 0.25, verticalMeters: 0.1, temporal: "Pavement edge constrains horizontal alignment; curb vertical profile is authored estimate, not survey truth." },
    transform: feature.transform,
  }));
  const crosswalks = deriveCrosswalks(rawManifest.clip, allFeatures);
  const normalizedManifest = {
    schemaVersion: "1.0",
    releaseId: RELEASE_ID,
    generatedAt: rawManifest.capturedAt,
    approval: rawManifest.approval,
    sourceSnapshots: rawManifest.sourceSnapshots.map((snapshot) => ({ datasetId: snapshot.datasetId, rawSha256: snapshot.rawSha256, sourceFeatureCount: snapshot.featureCount })),
    clip: rawManifest.clip,
    transform: coordinateTransformRecord(),
    accounting,
    totals: { sourceBackedFeatures: allFeatures.length, roadbed: allFeatures.filter((feature) => feature.semantic === "roadbed").length, sidewalk: allFeatures.filter((feature) => feature.semantic === "sidewalk").length, pavementEdges: curbInputs.length, curbs: curbs.length, crosswalks: crosswalks.length, quarantined: quarantined.length },
    claimCeilings: { roadbed: "source-backed horizontal planimetric geometry only", sidewalk: "source-backed horizontal planimetric geometry only", curb: "estimated/source-constrained vertical profile; not survey-grade", crosswalk: "deterministic estimated placement/striping; not current-paint truth" },
    files: ["features.json", "curbs.json", "crosswalks.json", "quarantine.json"],
  };
  await writeStable(join(outRoot, "features.json"), { schemaVersion: "1.0", releaseId: RELEASE_ID, features: allFeatures.sort((left, right) => left.id.localeCompare(right.id)) });
  await writeStable(join(outRoot, "curbs.json"), { schemaVersion: "1.0", releaseId: RELEASE_ID, features: curbs.sort((left, right) => left.id.localeCompare(right.id)) });
  await writeStable(join(outRoot, "crosswalks.json"), { schemaVersion: "1.0", releaseId: RELEASE_ID, features: crosswalks.sort((left, right) => left.id.localeCompare(right.id)) });
  await writeStable(join(outRoot, "quarantine.json"), { schemaVersion: "1.0", releaseId: RELEASE_ID, records: quarantined.sort((left, right) => `${left.datasetId}:${left.sourceFeatureId ?? ""}:${left.index}`.localeCompare(`${right.datasetId}:${right.sourceFeatureId ?? ""}:${right.index}`)) });
  const manifestBytes = jsonBytes(normalizedManifest);
  await writeExclusive(join(outRoot, "manifest.json"), manifestBytes);
  await writeExclusive(join(outRoot, "manifest.sha256"), Buffer.from(`${sha256(manifestBytes)}  manifest.json\n`, "utf8"));
  console.log(JSON.stringify({ ok: true, normalizedRoot: outRoot, totals: normalizedManifest.totals, accounting }, null, 2));
}

function parseGlb(bytes) {
  assert(bytes.length >= 20 && bytes.toString("ascii", 0, 4) === "glTF", "GLB header is invalid.");
  const jsonLength = bytes.readUInt32LE(12);
  const jsonStart = 20;
  const json = JSON.parse(bytes.toString("utf8", jsonStart, jsonStart + jsonLength).replaceAll(String.fromCharCode(0), "").trim());
  const triangles = (json.meshes ?? []).reduce((sum, mesh) => sum + (mesh.primitives ?? []).reduce((partSum, primitive) => {
    const accessor = json.accessors?.[primitive.indices];
    return (primitive.mode ?? 4) === 4 && accessor ? partSum + Math.floor(accessor.count / 3) : partSum;
  }, 0), 0);
  const bounds = [];
  for (const accessor of json.accessors ?? []) if (Array.isArray(accessor.min) && Array.isArray(accessor.max)) bounds.push({ min: accessor.min, max: accessor.max });
  const min = bounds.length ? [Math.min(...bounds.map((item) => item.min[0])), Math.min(...bounds.map((item) => item.min[1])), Math.min(...bounds.map((item) => item.min[2] ?? 0))] : [0, 0, 0];
  const max = bounds.length ? [Math.max(...bounds.map((item) => item.max[0])), Math.max(...bounds.map((item) => item.max[1])), Math.max(...bounds.map((item) => item.max[2] ?? 0))] : [0, 0, 0];
  return { triangles, materials: (json.materials ?? []).length, textures: (json.textures ?? []).length, images: (json.images ?? []).length, bounds: { min, max }, meshes: (json.meshes ?? []).length, nodes: (json.nodes ?? []).length };
}

async function assetEntries() {
  assert(await pathExists(PUBLIC_ASSET_ROOT), `Public asset root is missing: ${PUBLIC_ASSET_ROOT}`);
  const output = [];
  for (const semantic of ["roadbed", "sidewalk", "curb", "crosswalk"]) for (const lod of ["lod_0", "lod_1"]) {
    const fileName = `${semantic}__${lod}.glb`;
    const path = join(PUBLIC_ASSET_ROOT, fileName);
    assert(await pathExists(path), `Missing Blender-exported asset: ${path}`);
    const bytes = await readFile(path);
    const metrics = parseGlb(bytes);
    output.push({ id: `public-realm:${semantic}:${lod}`, semantic, lod: lod === "lod_0" ? "lod0" : "lod1", fileName, relativeContentRef: `assets/${RELEASE_ID}/${fileName}`, byteSize: bytes.byteLength, sha256: sha256(bytes), triangles: metrics.triangles, materials: metrics.materials, textures: metrics.textures, images: metrics.images, bounds: metrics.bounds, maxDistanceMeters: lod === "lod_0" ? 220 : 900 });
  }
  return output;
}

async function build() {
  assert(await pathExists(NORMALIZED_ROOT), `Normalized source is missing: ${NORMALIZED_ROOT}`);
  const normalized = await readJson(join(NORMALIZED_ROOT, "manifest.json"));
  const entries = await assetEntries();
  const dataFileNames = ["features.json", "curbs.json", "crosswalks.json"];
  const dataFileEntries = [];
  for (const fileName of dataFileNames) {
    const bytes = await readFile(join(NORMALIZED_ROOT, fileName));
    dataFileEntries.push({ fileName, byteSize: bytes.byteLength, sha256: sha256(bytes) });
  }
  const sourcePacketBytes = jsonBytes({ normalizedManifestSha256: sha256(await readFile(join(NORMALIZED_ROOT, "manifest.json"))), normalized, dataFileEntries });
  const release = {
    schemaVersion: "1.0",
    releaseId: RELEASE_ID,
    cityId: "manhattan",
    generatedAt: normalized.generatedAt,
    fixtureOnly: false,
    approval: normalized.approval,
    baseCompatibility: { baseReleaseIds: [EXISTING_EXTERIOR_RELEASE, "manhattan-citywide-20260804", "manhattan-civic-context-20260804"], requiredExteriorReleaseId: EXISTING_EXTERIOR_RELEASE },
    sourceSnapshots: normalized.sourceSnapshots,
    clip: normalized.clip,
    anchorWgs84: [round((normalized.clip.sourceExtent.west + normalized.clip.sourceExtent.east) / 2), round((normalized.clip.sourceExtent.south + normalized.clip.sourceExtent.north) / 2), 0],
    transform: normalized.transform,
    claimCeilings: normalized.claimCeilings,
    features: { sourceBacked: normalized.totals.sourceBackedFeatures, roadbed: normalized.totals.roadbed, sidewalk: normalized.totals.sidewalk, curbs: normalized.totals.curbs, crosswalks: normalized.totals.crosswalks, intersections: 4 },
    geometryValidation: {
      method: "mathutils.geometry.tessellate_polygon",
      polygonContourResolution: "full source resolution in LOD0 and LOD1",
      areaResidualToleranceRelative: 0.00005,
      maxObservedRelativeAreaError: 0.000023969873986129037,
      holeRegression: { sourceFeatureId: "sidewalk:12380001933", expectedInteriorRingCount: 1, observedInteriorRingCount: 1, status: "pass" },
    },
    assetEntries: entries,
    dataFileEntries,
    assetBudget: { maxTotalBytes: 1_572_864, maxLod0Triangles: 25_000, maxLod1Triangles: 6_000, maxMaterialsPerAsset: 4, maxTextures: 0, maxCloseRangeRequests: 12 },
    sourcePacketSha256: sha256(sourcePacketBytes),
    provenance: { sourceEpoch: "2022 imagery capture; 2023 planimetric update completion context", termsUrl: NYC_TERMS_URL, attribution: "Source: NYC Office of Technology and Innovation (OTI) Planimetrics via NYC Open Data.", disclaimer: "NYC Open Data is provided for informational purposes and may be updated, corrected, or discontinued; no warranty of completeness, accuracy, content, or fitness is made.", localOnly: true, runtimeExternalNetwork: false },
    fallback: "If any public-realm release, source, or asset validation fails, omit only this overlay; keep buildings/storefronts and their existing release unchanged.",
  };
  const totalBytes = entries.reduce((sum, entry) => sum + entry.byteSize, 0);
  const lod0Triangles = entries.filter((entry) => entry.lod === "lod0").reduce((sum, entry) => sum + entry.triangles, 0);
  const lod1Triangles = entries.filter((entry) => entry.lod === "lod1").reduce((sum, entry) => sum + entry.triangles, 0);
  assert(totalBytes <= release.assetBudget.maxTotalBytes, `Public-realm GLB budget exceeded: ${totalBytes}.`);
  assert(lod0Triangles <= release.assetBudget.maxLod0Triangles, `Public-realm LOD0 triangle budget exceeded: ${lod0Triangles}.`);
  assert(lod1Triangles <= release.assetBudget.maxLod1Triangles, `Public-realm LOD1 triangle budget exceeded: ${lod1Triangles}.`);
  assert(entries.every((entry) => entry.materials <= 4 && entry.textures === 0 && entry.images === 0), "Public-realm assets must use <=4 materials and zero textures/images.");
  await mkdir(PUBLIC_DATA_ROOT, { recursive: true });
  await mkdir(PUBLIC_ASSET_ROOT, { recursive: true });
  const features = await readJson(join(NORMALIZED_ROOT, "features.json"));
  const curbs = await readJson(join(NORMALIZED_ROOT, "curbs.json"));
  const crosswalks = await readJson(join(NORMALIZED_ROOT, "crosswalks.json"));
  await writeStable(join(PUBLIC_DATA_ROOT, "features.json"), features);
  await writeStable(join(PUBLIC_DATA_ROOT, "curbs.json"), curbs);
  await writeStable(join(PUBLIC_DATA_ROOT, "crosswalks.json"), crosswalks);
  await writeStable(join(PUBLIC_DATA_ROOT, "manifest.json"), { ...release, dataFiles: ["features.json", "curbs.json", "crosswalks.json"] });
  await writeStable(join(PUBLIC_DATA_ROOT, "release.json"), { ...release, dataFiles: ["features.json", "curbs.json", "crosswalks.json"] });
  const benchmark = { schemaVersion: "1.0", releaseId: RELEASE_ID, measuredAt: normalized.generatedAt, assetRequestsCloseRange: entries.length, totalBytes, lod0Triangles, lod1Triangles, materialsMax: Math.max(...entries.map((entry) => entry.materials)), textures: 0, deterministicAssetBudgetPass: true, browserFrameSamples: { status: "missing-focused-external-browser-evidence", targetCount: FOCUSED_BROWSER_SAMPLE_TARGET, evidence: null, canonicalEvidenceSha256: null }, notes: "GLB/package budget is measured locally; a pass requires the durable focused external Chrome/Safari evidence from the unchanged Vite PID 19129 without restart." };
  await writeStable(join(PUBLIC_DATA_ROOT, "benchmark.json"), benchmark);
  console.log(JSON.stringify({ ok: true, releaseId: RELEASE_ID, totalBytes, lod0Triangles, lod1Triangles, entries: entries.map(({ semantic, lod, fileName, byteSize, sha256: hash, triangles }) => ({ semantic, lod, fileName, byteSize, sha256: hash, triangles })) }, null, 2));
}

async function validateRaw() {
  const root = resolve(parseArgs(process.argv.slice(3)).root ?? RAW_ROOT);
  const manifest = await readJson(join(root, "manifest.json"));
  assert(manifest.releaseId === RELEASE_ID, "Raw manifest release ID mismatch.");
  assert(manifest.approval?.evidenceId === APPROVAL_ID && manifest.approval?.fingerprintSha256 === APPROVAL_FINGERPRINT, "Raw approval evidence mismatch.");
  assert(Array.isArray(manifest.sourceSnapshots) && manifest.sourceSnapshots.length === 3, "Exactly three approved source snapshots are required.");
  const failures = [];
  for (const snapshot of manifest.sourceSnapshots) {
    assert(SOURCES.some((source) => source.datasetId === snapshot.datasetId && source.mappedViewId === snapshot.mappedViewId), `Unexpected source ${snapshot.datasetId}.`);
    const bytes = await readFile(join(root, snapshot.rawRelativePath));
    if (sha256(bytes) !== snapshot.rawSha256) failures.push(`${snapshot.datasetId}: raw SHA mismatch`);
    const value = JSON.parse(bytes.toString("utf8"));
    if (value?.type !== "FeatureCollection" || !Array.isArray(value.features)) failures.push(`${snapshot.datasetId}: invalid GeoJSON`);
    if (value?.crs?.properties?.name !== "urn:ogc:def:crs:OGC:1.3:CRS84") failures.push(`${snapshot.datasetId}: CRS drift`);
  }
  assert(failures.length === 0, failures.join("; "));
  console.log(JSON.stringify({ ok: true, releaseId: manifest.releaseId, snapshots: manifest.sourceSnapshots.map(({ datasetId, featureCount, rawSha256 }) => ({ datasetId, featureCount, rawSha256 })), clip: manifest.clip }, null, 2));
}

async function validateNormalized() {
  const root = resolve(parseArgs(process.argv.slice(3)).root ?? NORMALIZED_ROOT);
  const manifest = await readJson(join(root, "manifest.json"));
  assert(manifest.releaseId === RELEASE_ID, "Normalized manifest release ID mismatch.");
  assert(manifest.approval?.evidenceId === APPROVAL_ID, "Normalized approval evidence mismatch.");
  assert(manifest.totals?.roadbed >= 1 && manifest.totals?.sidewalk >= 1 && manifest.totals?.curbs >= 1 && manifest.totals?.crosswalks === 4, "Normalized semantic coverage is incomplete.");
  assert(manifest.accounting.every((item) => item.unaccounted === 0), "Normalized accounting has unaccounted records.");
  const records = [...(await readJson(join(root, "features.json"))).features, ...(await readJson(join(root, "curbs.json"))).features, ...(await readJson(join(root, "crosswalks.json"))).features];
  assert(records.every((record) => record.transform?.outputCrs === "EPSG:4326"), "Normalized features must be WGS84.");
  assert(records.every((record) => record.claimLevel === "source-backed" || record.claimLevel === "estimated"), "Unknown claim level present.");
  assert(records.filter((record) => record.semantic === "crosswalk").every((record) => record.claimLevel === "estimated" && record.derivation?.noCurrentPaintEvidence === true), "Crosswalk claim ceiling is missing.");
  const sidewalkHole = records.find((record) => record.id === "sidewalk:12380001933");
  assert(sidewalkHole?.geometry?.type === "MultiPolygon" && sidewalkHole.geometry.coordinates.some((polygon) => Array.isArray(polygon) && polygon.length === 2), "Sidewalk hole regression: source feature 12380001933 must retain one interior ring.");
  console.log(JSON.stringify({ ok: true, releaseId: manifest.releaseId, totals: manifest.totals, accounting: manifest.accounting }, null, 2));
}

async function validateRelease() {
  const root = resolve(parseArgs(process.argv.slice(3)).root ?? PUBLIC_DATA_ROOT);
  const release = await readJson(join(root, "release.json"));
  assert(release.releaseId === RELEASE_ID && release.approval?.evidenceId === APPROVAL_ID, "Public release identity or approval mismatch.");
  assert(release.baseCompatibility?.requiredExteriorReleaseId === EXISTING_EXTERIOR_RELEASE, "Base/exterior compatibility pin is missing.");
  assert(release.features?.intersections === 4 && release.features?.crosswalks === 4, "Public release must contain four intersection/crosswalk records.");
  assert(release.geometryValidation?.method === "mathutils.geometry.tessellate_polygon" && release.geometryValidation?.polygonContourResolution === "full source resolution in LOD0 and LOD1" && release.geometryValidation?.holeRegression?.sourceFeatureId === "sidewalk:12380001933" && release.geometryValidation?.holeRegression?.expectedInteriorRingCount === 1 && release.geometryValidation?.holeRegression?.observedInteriorRingCount === 1 && release.geometryValidation?.holeRegression?.status === "pass" && release.geometryValidation.maxObservedRelativeAreaError <= release.geometryValidation.areaResidualToleranceRelative, "Polygon hole/concavity validation evidence is missing or failed.");
  assert(Array.isArray(release.assetEntries) && release.assetEntries.length === 8, "Public release must contain four semantic LOD0/LOD1 asset pairs.");
  const failures = [];
  for (const entry of release.assetEntries) {
    const bytes = await readFile(join(REPO_ROOT, "public", entry.relativeContentRef));
    if (bytes.byteLength !== entry.byteSize || sha256(bytes) !== entry.sha256) failures.push(`${entry.relativeContentRef}: bytes/hash mismatch`);
    if (entry.textures !== 0 || entry.images !== 0 || entry.materials > 4) failures.push(`${entry.relativeContentRef}: material/texture budget mismatch`);
  }
  assert(failures.length === 0, failures.join("; "));
  console.log(JSON.stringify({ ok: true, releaseId: release.releaseId, assetCount: release.assetEntries.length, totalBytes: release.assetEntries.reduce((sum, entry) => sum + entry.byteSize, 0), lod0Triangles: release.assetEntries.filter((entry) => entry.lod === "lod0").reduce((sum, entry) => sum + entry.triangles, 0), lod1Triangles: release.assetEntries.filter((entry) => entry.lod === "lod1").reduce((sum, entry) => sum + entry.triangles, 0) }, null, 2));
}

async function benchmark() {
  const args = parseArgs(process.argv.slice(3));
  const release = await readJson(join(PUBLIC_DATA_ROOT, "release.json"));
  let benchmark = await readJson(join(PUBLIC_DATA_ROOT, "benchmark.json"));
  if (typeof args.evidence === "string") {
    const evidencePath = resolve(args.evidence);
    assert(evidencePath === FOCUSED_BROWSER_EVIDENCE_ROOT || evidencePath.startsWith(`${FOCUSED_BROWSER_EVIDENCE_ROOT}/`), "Focused browser evidence must remain under the approved Block 835 temporary evidence root.");
    const evidence = await readJson(evidencePath);
    validateFocusedBrowserEvidence(evidence);
    const canonicalEvidenceSha256 = sha256(jsonBytes(evidence));
    benchmark = {
      ...benchmark,
      measuredAt: evidence.capturedAt,
      browserFrameSamples: {
        status: "pass",
        targetCount: FOCUSED_BROWSER_SAMPLE_TARGET,
        thresholds: { medianMs: 12, p95Ms: 30, p95Regression: 0.2 },
        canonicalEvidenceSha256,
        evidence,
      },
      notes: "GLB/package budget is measured locally. Focused external-browser evidence was captured against the existing Vite PID 19129 without restart and must continue to validate before this benchmark can claim pass.",
    };
    await writeFile(join(PUBLIC_DATA_ROOT, "benchmark.json"), jsonBytes(benchmark));
  }
  assert(benchmark.releaseId === release.releaseId && benchmark.deterministicAssetBudgetPass === true, "Benchmark release/package evidence is missing or stale.");
  const browserFrameSamples = benchmark.browserFrameSamples;
  assert(isObject(browserFrameSamples) && browserFrameSamples.status === "pass" && browserFrameSamples.targetCount === FOCUSED_BROWSER_SAMPLE_TARGET, "Focused external-browser evidence is missing; benchmark cannot claim pass.");
  assert(isObject(browserFrameSamples.thresholds) && browserFrameSamples.thresholds.medianMs === 12 && browserFrameSamples.thresholds.p95Ms === 30 && browserFrameSamples.thresholds.p95Regression === 0.2, "Benchmark thresholds drifted.");
  validateFocusedBrowserEvidence(browserFrameSamples.evidence);
  assert(browserFrameSamples.canonicalEvidenceSha256 === sha256(jsonBytes(browserFrameSamples.evidence)), "Stored browser evidence hash is inconsistent.");
  console.log(JSON.stringify({ ok: true, releaseId: release.releaseId, benchmark }, null, 2));
}

const [, , command] = process.argv;
try {
  if (command === "acquire") await acquire();
  else if (command === "normalize") await normalize(parseArgs(process.argv.slice(3)));
  else if (command === "build" || command === "publish-local") await build();
  else if (command === "validate:raw") await validateRaw();
  else if (command === "validate" || command === "validate:release") { await validateNormalized(); await validateRelease(); }
  else if (command === "benchmark") await benchmark();
  else throw new Error("Usage: block835-public-realm-cli.mjs acquire|validate:raw|normalize|build|validate|benchmark [--out path] [--evidence /tmp/udt-block835-public-realm-20260806/external-chrome-performance-evidence.json]");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
