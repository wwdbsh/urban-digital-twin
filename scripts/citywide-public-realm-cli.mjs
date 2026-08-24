/* global AbortSignal, URL, URLSearchParams, fetch, process, console */

/**
 * Citywide public-realm VECTOR acquisition tooling (goal
 * `manhattan-citywide-public-realm`, task T003).
 *
 * Dependency-free and fail-closed, mirroring
 * `./block835-public-realm-cli.mjs`. `acquire` is the only subcommand that
 * touches the network, and it talks to exactly one approved host. Normalization
 * and release packaging belong to T006 and are deliberately absent here rather
 * than stubbed, so nothing downstream can mistake a stub for a contract.
 *
 * Imagery is NOT in this envelope. `nyc.orthoimagery-2024-manhattan` remains
 * gated on the ungranted T004 approval and this CLI never requests it.
 */
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { readFile, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const CAPTURE_DATE = "20260824";
const SNAPSHOT_ID = `citywide-public-realm-${CAPTURE_DATE}`;
const RAW_ROOT = join(REPO_ROOT, "data/raw", SNAPSHOT_ID);
const HYDRO_INTERSECTS_SNAPSHOT_ID = `citywide-public-realm-${CAPTURE_DATE}-hydro-intersects`;
const HYDRO_INTERSECTS_RAW_ROOT = join(REPO_ROOT, "data/raw", HYDRO_INTERSECTS_SNAPSHOT_ID);
const SOURCE_REGISTRY_PATH = join(REPO_ROOT, "src/data/source-registry.ts");

/**
 * The user turn that granted this envelope, duplicated verbatim from
 * `CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_STATEMENT` in
 * `src/data/source-registry.ts`.
 *
 * This CLI is dependency-free and cannot import a TypeScript module, so the
 * Block 835 precedent of duplicating approval constants applies. The duplicate
 * is not trusted on its own: `assertApprovalGate()` recomputes the fingerprint
 * from this string AND re-reads the registry source to prove the same statement
 * and fingerprint are still recorded there. Drift in either direction refuses
 * the run before a socket is opened.
 */
const APPROVAL_STATEMENT =
  "User turn 2026-08-24: authorized T005-then-T003 sequential execution with the same full-auto-through-merge envelope; T003 vector acquisition envelope approved as presented: citywide->Manhattan clip of Roadbed xgwd-7vhd, Sidewalk vfx9-tbb6, Pavement Edge x9uq-u3qs, plus Hydrography pjs3-c3z5 and DOT Pedestrian Plazas k5k6-6jex; local-only immutable snapshots, no redistribution, no public deployment";
const APPROVAL_ID = "approval:citywide-public-realm-vector:20260824:user-approved";
const APPROVAL_FINGERPRINT = "b4977f62687c29d0d4dfc43fbbe2237f579da7622bc5725fd9d3df7511cfcff7";
const APPROVAL_EXCLUSIONS = [
  "Google products/data/imagery",
  "OSM/Overpass/third-party extracts",
  "paid or credentialed services",
  "runtime external network",
  "public deployment or conveyance",
  "current-paint or survey-grade crosswalk/curb claims",
  "street furniture/landscaping/traffic/lighting/signs/facades",
];

/** The single host this task is authorized to contact. */
const APPROVED_HOSTS = new Set(["data.cityofnewyork.us"]);
const USER_AGENT = "UrbanDigitalTwin-CitywidePublicRealm/2026.08 (local immutable snapshot; no runtime requests)";
const MAX_RESPONSE_BYTES = 512 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 900_000;
const PAGE_SIZE = 50_000;
const MAX_PAGES = 40;
const MAX_CLIP_TOLERANCE_METERS = 0.01;
const WGS84_METERS_PER_DEGREE_LAT = 111_320;
const EXPECTED_CRS_NAME = "urn:ogc:def:crs:OGC:1.3:CRS84";

/**
 * The snapped Manhattan ground coverage, restated verbatim.
 *
 * AUTHORITY: `groundPartitionTiles(MANHATTAN_GROUND_EXTENT,
 * GROUND_PARTITION_SCHEME_ID).coverage` in `src/release/ground-release.ts` —
 * the T005 snapped rectangle, i.e. `MANHATTAN_GROUND_EXTENT.requested`
 * (-74.03, 40.68, -73.9, 40.89) snapped OUTWARD to whole partition tiles.
 * These numbers are a restatement, not a second source of truth: this file is
 * `.mjs` and the authority is TypeScript, so the equality is pinned TS-side by
 * `src/release/ground-release.test.ts` ("snapped Manhattan ground coverage is
 * the clip envelope recorded in the T003 acquisition CLI") and by
 * `CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_EVIDENCE.scope`, which repeats the
 * same four bounds. If the ground extent or partition scheme ever changes, that
 * test fails rather than this snapshot silently clipping to a stale rectangle.
 *
 * The rectangle is an ENVELOPE, not a borough boundary. Adjacent-borough and
 * New Jersey features fall inside it and are retained honestly.
 */
const CLIP_BOUNDS = { west: -74.0478515625, south: 40.67138671875, east: -73.89404296875, north: 40.89111328125 };
const CLIP_AUTHORITY =
  "groundPartitionTiles(MANHATTAN_GROUND_EXTENT, GROUND_PARTITION_SCHEME_ID).coverage in src/release/ground-release.ts (T005 snapped ground coverage; MANHATTAN_GROUND_EXTENT.requested snapped outward to whole ground-partition-v1-level14 tiles).";
const CLIP_RULE =
  "Server-side Socrata within_box(<geometryField>,south,west,north,east) against the snapped Manhattan ground coverage rectangle, then a client-side per-feature bounding-box re-check with a 0.01 m tolerance. Features whose bounding box escapes the rectangle are RECORDED in quarantine.json and left byte-verbatim in the raw pages; they are never silently dropped, clipped, or repaired.";
const CLIP_ENVELOPE_NOTE =
  "The clip rectangle is a rectangular envelope, not the Manhattan borough boundary. Features in Brooklyn, Queens, the Bronx, Staten Island's northern water margin, and New Jersey fall inside it and ARE retained. That is expected: the bbox is the acquisition envelope authority, and the rendered scope is governed by the ground ledger downstream, not by this snapshot.";

/**
 * The five approved datasets.
 *
 * `mappedViewId` is the Socrata resource view that actually serves rows for the
 * three planimetrics catalog entries, whose catalog pages are map
 * visualizations. `acquire` verifies the mapped view and the catalog id report
 * an identical total row count before trusting the mapping, and records both.
 * Hydrography and Pedestrian Plazas are plain tables whose catalog id is its own
 * resource id, so `mappedViewId` is null for them rather than invented.
 */
const SOURCES = [
  {
    semantic: "roadbed",
    registryEntryId: "nyc.oti-planimetrics-roadbed-block835",
    datasetId: "xgwd-7vhd",
    mappedViewId: "i36f-5ih7",
    provider: "NYC Office of Technology and Innovation (OTI) Planimetrics",
    canonicalUrl: "https://data.cityofnewyork.us/City-Government/Roadbed/xgwd-7vhd",
    expectedGeometryTypes: ["Polygon", "MultiPolygon"],
    approvalCitation: "note",
  },
  {
    semantic: "sidewalk",
    registryEntryId: "nyc.oti-planimetrics-sidewalk-block835",
    datasetId: "vfx9-tbb6",
    mappedViewId: "52n9-sdep",
    provider: "NYC Office of Technology and Innovation (OTI) Planimetrics",
    canonicalUrl: "https://data.cityofnewyork.us/City-Government/Sidewalk/vfx9-tbb6",
    expectedGeometryTypes: ["Polygon", "MultiPolygon"],
    approvalCitation: "note",
  },
  {
    semantic: "pavement-edge",
    registryEntryId: "nyc.oti-planimetrics-pavement-edge-block835",
    datasetId: "x9uq-u3qs",
    mappedViewId: "vs44-rznx",
    provider: "NYC Office of Technology and Innovation (OTI) Planimetrics",
    canonicalUrl: "https://data.cityofnewyork.us/City-Government/Pavement-Edge/x9uq-u3qs",
    expectedGeometryTypes: ["LineString", "MultiLineString"],
    approvalCitation: "note",
  },
  {
    semantic: "hydrography",
    registryEntryId: "nyc.hydrography",
    datasetId: "pjs3-c3z5",
    mappedViewId: null,
    provider: "NYC Office of Technology and Innovation (OTI) Planimetrics",
    canonicalUrl: "https://data.cityofnewyork.us/Environment/NYC-Planimetric-Database-Hydrography/pjs3-c3z5",
    expectedGeometryTypes: ["Polygon", "MultiPolygon"],
    approvalCitation: "evidence",
  },
  {
    semantic: "pedestrian-plazas",
    registryEntryId: "nyc.dot-pedestrian-plazas",
    datasetId: "k5k6-6jex",
    mappedViewId: null,
    provider: "NYC Department of Transportation (DOT)",
    canonicalUrl: "https://data.cityofnewyork.us/Transportation/NYC-DOT-Pedestrian-Plazas-Polygon/k5k6-6jex",
    expectedGeometryTypes: ["Polygon", "MultiPolygon"],
    approvalCitation: "evidence",
  },
];

/** Geometry column candidates probed with `$limit=1`, in preference order. */
const GEOMETRY_FIELD_CANDIDATES = ["the_geom", "geom", "the_geom_webmercator", "multipolygon", "shape"];

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
function metresPerDegreeLon(latitude) { return WGS84_METERS_PER_DEGREE_LAT * Math.cos(latitude * Math.PI / 180); }

async function readJson(path) { return JSON.parse(await readFile(path, "utf8")); }
async function pathExists(path) { try { await stat(path); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; } }

/** Immutable write: refuses to overwrite an existing path. */
async function writeExclusive(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { flag: "wx" });
}

function approvedUrl(value) {
  const parsed = new URL(value);
  assert(parsed.protocol === "https:", `HTTPS is required: ${value}`);
  assert(APPROVED_HOSTS.has(parsed.hostname), `Unapproved source host: ${parsed.hostname}. This task is authorized for data.cityofnewyork.us only; no fallback provider is permitted.`);
  return parsed;
}

function responseHeaders(response) {
  return Object.fromEntries([...response.headers.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

async function requestBytes(url) {
  const parsed = approvedUrl(url);
  const startedAt = new Date().toISOString();
  const response = await fetch(parsed, {
    redirect: "manual",
    headers: { Accept: "application/json,application/geo+json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const finishedAt = new Date().toISOString();
  assert(![301, 302, 303, 307, 308].includes(response.status), `Redirect rejected from ${url}.`);
  assert(response.status >= 200 && response.status < 300, `HTTP ${response.status} from ${url}; no fallback provider is permitted.`);
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

async function requestJson(url) {
  const response = await requestBytes(url);
  return { ...response, value: JSON.parse(response.body.toString("utf8")) };
}

function resourceUrl(source, extension, params) {
  const url = new URL(`https://data.cityofnewyork.us/resource/${source.mappedViewId ?? source.datasetId}.${extension}`);
  if (params) url.search = new URLSearchParams(params).toString();
  return url.toString();
}

function metadataUrl(id) { return `https://data.cityofnewyork.us/api/views/${id}.json`; }

/** The clip rectangle as a WKT polygon. Identical geometry to the within_box rectangle. */
function clipPolygonWkt() {
  const { west, south, east, north } = CLIP_BOUNDS;
  return `POLYGON((${west} ${south},${east} ${south},${east} ${north},${west} ${north},${west} ${south}))`;
}

/**
 * The server-side clip predicate, over the SAME rectangle either way.
 *
 * `within_box` is fully-contained: a feature crossing the rectangle edge is
 * excluded server-side. `intersects` is the superset: it returns the contained
 * features PLUS the edge straddlers.
 */
function whereClause(geometryField, predicate = "within_box") {
  if (predicate === "intersects") return `intersects(${geometryField},'${clipPolygonWkt()}')`;
  assert(predicate === "within_box", `Unknown clip predicate: ${predicate}`);
  return `within_box(${geometryField},${CLIP_BOUNDS.south},${CLIP_BOUNDS.west},${CLIP_BOUNDS.north},${CLIP_BOUNDS.east})`;
}

/**
 * `within_box` is FULLY-CONTAINED, not intersects.
 *
 * A feature whose geometry crosses the rectangle edge is excluded by the server
 * before this CLI ever sees it, so a zero quarantine count means "nothing
 * straddling survived the server filter", NOT "nothing straddles". Measured and
 * recorded per dataset so the snapshot states what it is missing instead of
 * implying completeness. Verified 2026-08-24: this materially affects
 * hydrography, where EAST RIVER and HUDSON RIVER extend beyond the rectangle and
 * are therefore absent.
 */
const CLIP_SEMANTICS_NOTE =
  "Socrata within_box() is fully-contained, not intersects. Features whose geometry crosses the clip rectangle's edge are excluded SERVER-SIDE and never reach this snapshot. serverExcludedStraddlerCount below measures exactly how many such features exist per dataset (count of `intersects(clipPolygon) AND NOT within_box(clipBox)`). A quarantinedCount of 0 therefore means no straddler survived the server filter — it does NOT mean no feature straddles the envelope. This is a known and disclosed limitation of the approved clip predicate, not a validated claim of completeness.";
const STRADDLER_IDENTITY_LIMIT = 25;

/**
 * Why hydrography — and ONLY hydrography — is re-acquired with `intersects`.
 *
 * The approved envelope is a "citywide->Manhattan clip of Hydrography". The
 * EAST RIVER and HUDSON RIVER polygons straddle the clip rectangle's edge, so
 * `within_box` excluded exactly the water that defines Manhattan's shoreline —
 * the opposite of what the envelope asked for. `intersects` over the SAME
 * rectangle returns the contained features plus those straddlers. This widens
 * no approval: same host, same dataset, same rectangle, same local-only
 * immutable posture. The ground ledger, not the acquisition bbox, remains the
 * rendered-scope authority and clips downstream.
 */
const HYDRO_INTERSECTS_RATIONALE =
  "Hydrography is re-acquired with intersects() over the identical clip rectangle because within_box() excluded EAST RIVER (source_id 10262000010) and HUDSON RIVER (12262000008) — the shoreline water the approved 'Manhattan clip of Hydrography' envelope exists to capture. Same host, same dataset, same rectangle, same immutability and CRS discipline; only the containment predicate differs. The ground ledger remains the rendered-scope authority and performs the real clip downstream. This companion snapshot is ADDITIVE: the primary within_box snapshot is untouched and remains the record of what that predicate delivered.";

/**
 * The deliberate non-decision, recorded because a silent omission is not a
 * decision anyone can audit later.
 *
 * Roadbed (358), sidewalk (256), pavement-edge (565), and pedestrian-plaza (2)
 * straddlers stay EXCLUDED. Those datasets are made of small features and
 * Manhattan's land surface is fully interior to the clip rectangle, so every
 * straddler is an adjacent-borough or New Jersey edge feature — not Manhattan
 * content the envelope was meant to capture. Unlike a river polygon, none of
 * them is an intrinsic part of the Manhattan surface being modelled.
 */
const NON_HYDRO_STRADDLER_NON_DECISION =
  "Roadbed, sidewalk, pavement-edge, and pedestrian-plaza edge straddlers remain excluded by within_box and were NOT re-acquired. Rationale: those datasets consist of small features and the Manhattan land surface lies fully interior to the clip rectangle, so their straddlers are adjacent-borough (Brooklyn/Queens/Bronx) or New Jersey edge features rather than Manhattan content. Hydrography differs because a single river polygon is one large intrinsic Manhattan-shoreline feature that the rectangle bisects. This is a recorded decision, not an oversight; reversing it needs a new operator run, not a code change.";

/** Acquisition profiles. Each owns its own snapshot root, predicate, and dataset set. */
function acquisitionProfiles() {
  const hydrography = SOURCES.find((source) => source.datasetId === "pjs3-c3z5");
  assert(hydrography, "Hydrography source definition is missing.");
  return {
    primary: {
      key: "primary",
      snapshotId: SNAPSHOT_ID,
      rawRoot: RAW_ROOT,
      predicate: "within_box",
      sources: SOURCES,
      companionOfSnapshotId: null,
      rationale: null,
    },
    "hydro-intersects": {
      key: "hydro-intersects",
      snapshotId: HYDRO_INTERSECTS_SNAPSHOT_ID,
      rawRoot: HYDRO_INTERSECTS_RAW_ROOT,
      predicate: "intersects",
      sources: [hydrography],
      companionOfSnapshotId: SNAPSHOT_ID,
      rationale: HYDRO_INTERSECTS_RATIONALE,
    },
  };
}

function acquisitionProfile(key) {
  const profile = acquisitionProfiles()[key];
  assert(profile, `Unknown acquisition profile: ${key}`);
  return profile;
}

// ---------------------------------------------------------------------------
// Approval gate
// ---------------------------------------------------------------------------

function approvalRecord() {
  return {
    evidenceId: APPROVAL_ID,
    fingerprintSha256: APPROVAL_FINGERPRINT,
    approvalStatement: APPROVAL_STATEMENT,
    scope: "Local-only immutable Manhattan-clipped snapshots of five NYC Open Data vector datasets (Roadbed xgwd-7vhd, Sidewalk vfx9-tbb6, Pavement Edge x9uq-u3qs, Hydrography pjs3-c3z5, DOT Pedestrian Plazas k5k6-6jex). Imagery is NOT in this envelope.",
    exclusions: APPROVAL_EXCLUSIONS,
  };
}

/**
 * Splits `sourceRegistry` into per-entry text blocks so the gate can read the
 * live registry rather than trusting this file's duplicated constants.
 */
function registryEntryBlocks(text) {
  const blocks = new Map();
  const pattern = /^ {2}(approvedEntry|pendingEntry|approvedAssetReferenceEntry)\(\{$/gmu;
  const starts = [...text.matchAll(pattern)];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index].index;
    const end = index + 1 < starts.length ? starts[index + 1].index : text.length;
    const body = text.slice(start, end);
    const id = /^ {4}id: "([^"]+)",$/mu.exec(body)?.[1];
    if (id) blocks.set(id, { constructor: starts[index][1], body });
  }
  return blocks;
}

/**
 * Fail-closed approval gate. Runs BEFORE any network call.
 *
 * Three independent things must agree: this file's duplicated statement must
 * hash to the recorded fingerprint; the registry source must still record the
 * same statement and fingerprint under the same evidence id; and all five
 * datasets must be registered as approved and cite that evidence.
 */
async function assertApprovalGate() {
  const recomputed = sha256(Buffer.from(APPROVAL_STATEMENT, "utf8"));
  assert(recomputed === APPROVAL_FINGERPRINT, `Approval fingerprint mismatch: the recorded statement hashes to ${recomputed}, not ${APPROVAL_FINGERPRINT}.`);

  const registrySource = await readFile(SOURCE_REGISTRY_PATH, "utf8");
  assert(registrySource.includes(APPROVAL_STATEMENT), `Approval statement drift: ${SOURCE_REGISTRY_PATH} no longer records the statement this CLI duplicates.`);
  assert(registrySource.includes(`evidenceId: "${APPROVAL_ID}"`), `Approval evidence id ${APPROVAL_ID} is not recorded in ${SOURCE_REGISTRY_PATH}.`);
  assert(registrySource.includes(`fingerprintSha256: "${APPROVAL_FINGERPRINT}"`), `Approval fingerprint is not recorded in ${SOURCE_REGISTRY_PATH}.`);

  const blocks = registryEntryBlocks(registrySource);
  const failures = [];
  for (const source of SOURCES) {
    const entry = blocks.get(source.registryEntryId);
    if (!entry) { failures.push(`${source.registryEntryId}: not registered`); continue; }
    if (entry.constructor !== "approvedEntry") failures.push(`${source.registryEntryId}: registered with ${entry.constructor}, not approvedEntry`);
    if (!entry.body.includes(`datasetId: "${source.datasetId}"`)) failures.push(`${source.registryEntryId}: does not pin datasetId ${source.datasetId}`);
    if (source.approvalCitation === "evidence") {
      if (!entry.body.includes("approvalEvidence: CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_EVIDENCE")) failures.push(`${source.registryEntryId}: does not cite CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_EVIDENCE`);
    } else if (!entry.body.includes(APPROVAL_ID)) {
      failures.push(`${source.registryEntryId}: approval note does not cite ${APPROVAL_ID}`);
    }
  }
  assert(failures.length === 0, `Approval gate refused (registry state does not authorize this acquisition): ${failures.join("; ")}`);
  return { checkedAt: new Date().toISOString(), registryPath: relative(REPO_ROOT, SOURCE_REGISTRY_PATH), registrySha256: sha256(Buffer.from(registrySource, "utf8")), entriesChecked: SOURCES.map((source) => source.registryEntryId) };
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function coordWalk(value, callback) {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") { callback(value); return; }
  value.forEach((part) => coordWalk(part, callback));
}

function extentOfCoordinates(coordinates) {
  let west = Infinity; let east = -Infinity; let south = Infinity; let north = -Infinity;
  let count = 0;
  let nonFinite = false;
  coordWalk(coordinates, (point) => {
    count += 1;
    if (!finite(point[0]) || !finite(point[1])) { nonFinite = true; return; }
    west = Math.min(west, point[0]); east = Math.max(east, point[0]);
    south = Math.min(south, point[1]); north = Math.max(north, point[1]);
  });
  if (!count || nonFinite) return null;
  return { west, east, south, north };
}

function withinClip(extent, tolerance = MAX_CLIP_TOLERANCE_METERS) {
  if (!extent) return false;
  const latTolerance = tolerance / WGS84_METERS_PER_DEGREE_LAT;
  const lonTolerance = tolerance / metresPerDegreeLon((CLIP_BOUNDS.south + CLIP_BOUNDS.north) / 2);
  return extent.west >= CLIP_BOUNDS.west - lonTolerance
    && extent.east <= CLIP_BOUNDS.east + lonTolerance
    && extent.south >= CLIP_BOUNDS.south - latTolerance
    && extent.north <= CLIP_BOUNDS.north + latTolerance;
}

/** Does the feature's bounding box overlap the clip rectangle at all? */
function overlapsClip(extent, tolerance = MAX_CLIP_TOLERANCE_METERS) {
  if (!extent) return false;
  const latTolerance = tolerance / WGS84_METERS_PER_DEGREE_LAT;
  const lonTolerance = tolerance / metresPerDegreeLon((CLIP_BOUNDS.south + CLIP_BOUNDS.north) / 2);
  return extent.west <= CLIP_BOUNDS.east + lonTolerance
    && extent.east >= CLIP_BOUNDS.west - lonTolerance
    && extent.south <= CLIP_BOUNDS.north + latTolerance
    && extent.north >= CLIP_BOUNDS.south - latTolerance;
}

function featureSourceId(feature) {
  const raw = feature?.properties?.source_id ?? feature?.properties?.objectid ?? null;
  return raw === null || raw === undefined ? null : String(raw).replace(/\.0$/u, "");
}

/**
 * Client-side re-validation of one page against the clip rectangle.
 *
 * Nothing is dropped or repaired: the raw page bytes stay verbatim on disk and
 * this only produces a record of which features escaped the envelope and by how
 * much.
 */
function revalidatePage(source, features, pageNumber, predicate = "within_box") {
  const quarantine = [];
  const straddlers = [];
  const geometryTypes = new Map();
  let inside = 0;
  features.forEach((feature, index) => {
    const geometry = feature?.geometry;
    const type = isObject(geometry) ? geometry.type : null;
    geometryTypes.set(type, (geometryTypes.get(type) ?? 0) + 1);
    if (!isObject(geometry) || !Array.isArray(geometry.coordinates)) {
      quarantine.push({ page: pageNumber, index, sourceFeatureId: featureSourceId(feature), reason: "missing-or-invalid-geometry", extent: null });
      return;
    }
    if (!source.expectedGeometryTypes.includes(type)) {
      quarantine.push({ page: pageNumber, index, sourceFeatureId: featureSourceId(feature), reason: `unexpected-geometry-type:${type}`, extent: null });
      return;
    }
    const extent = extentOfCoordinates(geometry.coordinates);
    if (!extent) {
      quarantine.push({ page: pageNumber, index, sourceFeatureId: featureSourceId(feature), reason: "non-finite-or-empty-coordinates", extent: null });
      return;
    }
    if (!withinClip(extent)) {
      // Under `intersects` a bbox that escapes the rectangle is the EXPECTED
      // shape of a straddler, not an anomaly — but it must still genuinely
      // touch the rectangle, or the server returned something unexplained.
      if (predicate === "intersects" && overlapsClip(extent)) {
        straddlers.push({ page: pageNumber, index, sourceFeatureId: featureSourceId(feature), name: feature?.properties?.name ?? null, classification: "expected-straddler-retained-under-intersects-predicate", extent });
        return;
      }
      quarantine.push({ page: pageNumber, index, sourceFeatureId: featureSourceId(feature), reason: predicate === "intersects" ? "bounding-box-does-not-touch-clip-envelope" : "bounding-box-escapes-clip-envelope", extent });
      return;
    }
    inside += 1;
  });
  return { inside, straddlers, quarantine, geometryTypes: Object.fromEntries([...geometryTypes.entries()].map(([type, count]) => [String(type), count]).sort(([a], [b]) => a.localeCompare(b))) };
}

// ---------------------------------------------------------------------------
// acquire
// ---------------------------------------------------------------------------

/** Probes `$limit=1` to learn which column actually holds the geometry. */
async function probeGeometryField(source) {
  const attempts = [];
  for (const candidate of GEOMETRY_FIELD_CANDIDATES) {
    const url = resourceUrl(source, "json", { $select: candidate, $limit: "1" });
    try {
      const probe = await requestJson(url);
      const rows = probe.value;
      if (!Array.isArray(rows)) { attempts.push({ candidate, outcome: "non-array-response" }); continue; }
      attempts.push({ candidate, outcome: "ok", rows: rows.length, probedAt: probe.finishedAt });
      return { geometryField: candidate, attempts };
    } catch (error) {
      attempts.push({ candidate, outcome: "rejected", detail: error instanceof Error ? error.message.slice(0, 240) : String(error) });
    }
  }
  return { geometryField: null, attempts };
}

async function countRows(id, where) {
  const url = new URL(`https://data.cityofnewyork.us/resource/${id}.json`);
  url.search = new URLSearchParams(where ? { $select: "count(*) as n", $where: where } : { $select: "count(*) as n" }).toString();
  const response = await requestJson(url.toString());
  const raw = response.value?.[0]?.n;
  assert(typeof raw === "string" || typeof raw === "number", `Row count probe returned no count for ${id}.`);
  return Number(raw);
}

/**
 * Measures what the approved `within_box` predicate excludes at the rectangle
 * edge. This only counts and identifies; it acquires no additional features and
 * does not widen the clip.
 */
async function measureStraddlers(source, geometryField) {
  const resourceId = source.mappedViewId ?? source.datasetId;
  const where = `intersects(${geometryField},'${clipPolygonWkt()}') AND NOT ${whereClause(geometryField)}`;
  try {
    const count = await countRows(resourceId, where);
    let identities = null;
    let identitiesOmittedReason = count > STRADDLER_IDENTITY_LIMIT ? `count exceeds ${STRADDLER_IDENTITY_LIMIT}; identities not enumerated` : null;
    if (count > 0 && count <= STRADDLER_IDENTITY_LIMIT) {
      // Column names differ per dataset, so identity enumeration is best-effort
      // and its failure must not discard the count, which is the load-bearing fact.
      for (const select of ["source_id,name,feat_code", "objectid,plazaname", "objectid"]) {
        try {
          const url = new URL(`https://data.cityofnewyork.us/resource/${resourceId}.json`);
          url.search = new URLSearchParams({ $select: select, $where: where, $order: ":id", $limit: String(STRADDLER_IDENTITY_LIMIT) }).toString();
          const listed = await requestJson(url.toString());
          if (Array.isArray(listed.value)) { identities = listed.value; identitiesOmittedReason = null; break; }
        } catch (error) {
          identitiesOmittedReason = `identity enumeration failed for every known column set; last error: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`;
        }
      }
    }
    return { measured: true, straddlerProbeWhere: where, edgeStraddlerCount: count, identities, identitiesOmittedReason };
  } catch (error) {
    return { measured: false, straddlerProbeWhere: where, edgeStraddlerCount: null, identities: null, failure: error instanceof Error ? error.message.slice(0, 240) : String(error) };
  }
}

async function acquireSource(source, recordFile, profile) {
  const { rawRoot, predicate } = profile;
  const started = new Date().toISOString();
  const metadata = await requestJson(metadataUrl(source.datasetId));
  await recordFile(join(rawRoot, source.datasetId, "metadata.json"), metadata.body, "metadata", source.datasetId);
  let mappedMetadata = null;
  if (source.mappedViewId) {
    mappedMetadata = await requestJson(metadataUrl(source.mappedViewId));
    await recordFile(join(rawRoot, source.datasetId, "mapped-metadata.json"), mappedMetadata.body, "mapped-metadata", source.datasetId);
  }

  const probe = await probeGeometryField(source);
  if (!probe.geometryField) {
    return { datasetId: source.datasetId, semantic: source.semantic, status: "failed", failure: "geometry-field-probe-failed", geometryFieldProbe: probe, startedAt: started };
  }
  const where = whereClause(probe.geometryField, predicate);

  // The mapped view is only trusted once it agrees with the catalog id on the
  // total row count; a disagreement means the mapping is not a faithful view.
  const catalogRowCount = await countRows(source.datasetId);
  const mappedRowCount = source.mappedViewId ? await countRows(source.mappedViewId) : catalogRowCount;
  if (source.mappedViewId && catalogRowCount !== mappedRowCount) {
    return { datasetId: source.datasetId, semantic: source.semantic, status: "failed", failure: `mapped-view-row-count-mismatch:${catalogRowCount}!=${mappedRowCount}`, geometryFieldProbe: probe, startedAt: started };
  }
  const clippedRowCount = await countRows(source.mappedViewId ?? source.datasetId, where);
  const straddlers = await measureStraddlers(source, probe.geometryField);
  if (clippedRowCount === 0) {
    return { datasetId: source.datasetId, semantic: source.semantic, status: "failed", failure: "zero-features-inside-clip-envelope", geometryFieldProbe: probe, clippedRowCount, clipSemantics: straddlers, startedAt: started };
  }

  const pages = [];
  const quarantine = [];
  const retainedStraddlers = [];
  const geometryTypes = new Map();
  let featureCount = 0;
  let insideCount = 0;
  let offset = 0;
  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
    const params = { $select: "*", $where: where, $order: ":id", $limit: String(PAGE_SIZE), $offset: String(offset) };
    const url = resourceUrl(source, "geojson", params);
    const response = await requestBytes(url);
    const value = JSON.parse(response.body.toString("utf8"));
    assert(value?.type === "FeatureCollection" && Array.isArray(value.features), `${source.datasetId} page ${pageNumber} is not a GeoJSON FeatureCollection.`);
    assert(value?.crs?.properties?.name === EXPECTED_CRS_NAME, `${source.datasetId} page ${pageNumber} declares CRS ${value?.crs?.properties?.name ?? "none"}, expected ${EXPECTED_CRS_NAME}.`);
    const relativePath = `${source.datasetId}/response-page-${String(pageNumber).padStart(4, "0")}.geojson`;
    await recordFile(join(rawRoot, relativePath), response.body, "raw-response", source.datasetId);
    const check = revalidatePage(source, value.features, pageNumber, predicate);
    for (const [type, count] of Object.entries(check.geometryTypes)) geometryTypes.set(type, (geometryTypes.get(type) ?? 0) + count);
    quarantine.push(...check.quarantine);
    retainedStraddlers.push(...check.straddlers);
    featureCount += value.features.length;
    insideCount += check.inside;
    pages.push({ page: pageNumber, relativePath, url, offset, limit: PAGE_SIZE, featureCount: value.features.length, bytes: response.bytes, sha256: response.sha256, requestedAt: response.startedAt, finishedAt: response.finishedAt });
    if (value.features.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    assert(pageNumber < MAX_PAGES, `${source.datasetId} exceeded ${MAX_PAGES} pages; refusing to page further.`);
  }

  const quarantinePath = `${source.datasetId}/quarantine.json`;
  await recordFile(join(rawRoot, quarantinePath), jsonBytes({
    schemaVersion: "1.0",
    snapshotId: profile.snapshotId,
    profile: profile.key,
    clipPredicate: predicate,
    datasetId: source.datasetId,
    semantic: source.semantic,
    clip: { bounds: CLIP_BOUNDS, toleranceMeters: MAX_CLIP_TOLERANCE_METERS, rule: CLIP_RULE },
    policy: "Quarantine is a RECORD, not a filter. Every feature listed here remains byte-verbatim in its raw response page; nothing was dropped, clipped, or repaired. Downstream normalization (T006) decides what to do with these.",
    serverSideClipSemantics: CLIP_SEMANTICS_NOTE,
    edgeStraddlerCountInDataset: straddlers.edgeStraddlerCount,
    serverExcludedStraddlerCount: predicate === "within_box" ? straddlers.edgeStraddlerCount : 0,
    retainedStraddlerPolicy: predicate === "intersects"
      ? "Features listed under retainedStraddlers were RETAINED, not quarantined: under the intersects predicate a bounding box crossing the rectangle edge is the expected shape of a straddler. Each was still checked to genuinely touch the rectangle."
      : "The within_box predicate excludes straddlers server-side, so retainedStraddlers is empty by construction.",
    retainedStraddlers,
    records: quarantine,
  }), "quarantine", source.datasetId);

  return {
    datasetId: source.datasetId,
    semantic: source.semantic,
    registryEntryId: source.registryEntryId,
    provider: source.provider,
    canonicalUrl: source.canonicalUrl,
    status: "acquired",
    mappedViewId: source.mappedViewId,
    resourceId: source.mappedViewId ?? source.datasetId,
    mappedViewVerification: source.mappedViewId
      ? { catalogRowCount, mappedRowCount, identical: catalogRowCount === mappedRowCount, note: "The catalog id serves a map visualization; the mapped view id is the row-serving resource. Both were counted and agree." }
      : { catalogRowCount, mappedRowCount: null, identical: null, note: "Catalog id is its own resource id for this table dataset; no mapped view exists or was invented." },
    geometryField: probe.geometryField,
    geometryFieldProbe: probe.attempts,
    query: { endpointTemplate: resourceUrl(source, "geojson", null), select: "*", where, predicate, order: ":id", pageSize: PAGE_SIZE },
    pageCount: pages.length,
    pages,
    featureCount,
    serverReportedClippedCount: clippedRowCount,
    featureCountMatchesServerCount: featureCount === clippedRowCount,
    insideClipCount: insideCount,
    quarantinedCount: quarantine.length,
    retainedStraddlerCount: retainedStraddlers.length,
    retainedStraddlerIdentities: retainedStraddlers.map(({ sourceFeatureId, name }) => ({ sourceFeatureId, name })),
    clipPredicate: predicate,
    clipSemantics: { note: CLIP_SEMANTICS_NOTE, predicate, ...straddlers },
    quarantineRelativePath: quarantinePath,
    unaccounted: featureCount - insideCount - quarantine.length - retainedStraddlers.length,
    geometryTypes: Object.fromEntries([...geometryTypes.entries()].sort(([a], [b]) => a.localeCompare(b))),
    totalBytes: pages.reduce((sum, page) => sum + page.bytes, 0),
    sourceResponseCrs: EXPECTED_CRS_NAME,
    portalMetadata: {
      metadataRelativePath: `${source.datasetId}/metadata.json`,
      metadataSha256: metadata.sha256,
      mappedMetadataRelativePath: mappedMetadata ? `${source.datasetId}/mapped-metadata.json` : null,
      mappedMetadataSha256: mappedMetadata?.sha256 ?? null,
      name: metadata.value?.name ?? null,
      attribution: metadata.value?.attribution ?? null,
      attributionLink: metadata.value?.attributionLink ?? null,
      license: metadata.value?.license?.name ?? null,
      licenseId: metadata.value?.licenseId ?? null,
      rowsUpdatedAt: metadata.value?.rowsUpdatedAt ?? null,
      rowsUpdatedAtIso: finite(metadata.value?.rowsUpdatedAt) ? new Date(metadata.value.rowsUpdatedAt * 1000).toISOString() : null,
      createdAt: metadata.value?.createdAt ?? null,
    },
    startedAt: started,
    finishedAt: new Date().toISOString(),
  };
}

/**
 * Records the primary snapshot's identity inside the companion.
 *
 * The linkage can only ever point one way: the primary manifest is already
 * written and immutable, so it cannot be edited to mention a companion that did
 * not exist when it was sealed. The companion therefore carries the primary's
 * manifest sha256, and `validate:raw` re-derives that sha from the primary on
 * disk and refuses if the two disagree.
 */
async function companionLinkage(profile) {
  if (!profile.companionOfSnapshotId) return null;
  const primaryRoot = join(REPO_ROOT, "data/raw", profile.companionOfSnapshotId);
  assert(await pathExists(join(primaryRoot, "manifest.json")), `Companion profile requires the primary snapshot to exist first: ${primaryRoot}`);
  const primaryBytes = await readFile(join(primaryRoot, "manifest.json"));
  return {
    snapshotId: profile.companionOfSnapshotId,
    manifestSha256: sha256(primaryBytes),
    relationship: "This snapshot is an ADDITIVE companion to the primary within_box snapshot named above. It does not supersede or invalidate it. The primary is immutable and was not modified, so the cross-reference exists only in this direction; validate:raw re-derives the primary manifest sha256 from disk and fails on disagreement.",
  };
}

async function acquire(profileKey = "primary") {
  const profile = acquisitionProfile(profileKey);
  const { rawRoot } = profile;
  assert(!(await pathExists(rawRoot)), `Raw snapshot already exists; immutable acquisition refuses overwrite: ${rawRoot}`);
  const gate = await assertApprovalGate();
  const capturedAt = new Date().toISOString();
  const files = [];
  const recordFile = async (path, bytes, role, sourceId = null) => {
    await writeExclusive(path, bytes);
    files.push({ path: relative(rawRoot, path).split("\\").join("/"), bytes: bytes.byteLength, sha256: sha256(bytes), role, sourceId });
  };
  const companionOf = await companionLinkage(profile);

  await recordFile(join(rawRoot, "approval.json"), jsonBytes({ ...approvalRecord(), gate }), "approval");
  await recordFile(join(rawRoot, "acquisition-contract.json"), jsonBytes({
    schemaVersion: "1.0",
    snapshotId: profile.snapshotId,
    profile: profile.key,
    clipPredicate: profile.predicate,
    companionOf,
    predicateRationale: profile.rationale,
    nonHydroStraddlerNonDecision: profile.predicate === "intersects" ? NON_HYDRO_STRADDLER_NON_DECISION : null,
    capturedAt,
    approval: approvalRecord(),
    clip: { bounds: CLIP_BOUNDS, authority: CLIP_AUTHORITY, rule: CLIP_RULE, toleranceMeters: MAX_CLIP_TOLERANCE_METERS, envelopeNote: CLIP_ENVELOPE_NOTE, semanticsNote: CLIP_SEMANTICS_NOTE, predicate: profile.predicate, predicateWkt: profile.predicate === "intersects" ? clipPolygonWkt() : null },
    approvedHosts: [...APPROVED_HOSTS].sort(),
    sourceNativeCrs: "EPSG:2263 (NAD83 / New York Long Island US feet) per the official NYC Planimetrics Capture Rules",
    responseCrs: `${EXPECTED_CRS_NAME}; the Socrata GeoJSON response is 2D and carries no Z coordinate`,
    transformPolicy: "Raw bytes are preserved exactly as served. No reprojection, simplification, clipping, or repair is applied at acquisition time.",
    scopeBoundary: "Vector datasets only. nyc.orthoimagery-2024-manhattan is NOT acquired here; its T004 imagery approval has not been granted.",
    noFallbackProviders: true,
    localOnly: true,
    runtimeExternalNetwork: false,
  }), "contract");

  const snapshots = [];
  const failures = [];
  for (const source of profile.sources) {
    let result;
    try {
      result = await acquireSource(source, recordFile, profile);
    } catch (error) {
      result = { datasetId: source.datasetId, semantic: source.semantic, status: "failed", failure: error instanceof Error ? error.message : String(error) };
    }
    if (result.status !== "acquired") {
      failures.push(`${source.datasetId} (${source.semantic}): ${result.failure}`);
      console.error(`STOPPED dataset ${source.datasetId} (${source.semantic}): ${result.failure}`);
    }
    snapshots.push(result);
  }

  const acquired = snapshots.filter((snapshot) => snapshot.status === "acquired");
  const manifest = {
    schemaVersion: "1.0",
    snapshotId: profile.snapshotId,
    profile: profile.key,
    clipPredicate: profile.predicate,
    companionOf,
    predicateRationale: profile.rationale,
    nonHydroStraddlerNonDecision: profile.predicate === "intersects" ? NON_HYDRO_STRADDLER_NON_DECISION : null,
    capturedAt,
    approval: approvalRecord(),
    approvalGate: gate,
    clip: { bounds: CLIP_BOUNDS, authority: CLIP_AUTHORITY, rule: CLIP_RULE, toleranceMeters: MAX_CLIP_TOLERANCE_METERS, envelopeNote: CLIP_ENVELOPE_NOTE, semanticsNote: CLIP_SEMANTICS_NOTE, predicate: profile.predicate, predicateWkt: profile.predicate === "intersects" ? clipPolygonWkt() : null },
    expectedDatasetCount: profile.sources.length,
    acquiredDatasetCount: acquired.length,
    failedDatasets: snapshots.filter((snapshot) => snapshot.status !== "acquired").map((snapshot) => ({ datasetId: snapshot.datasetId, semantic: snapshot.semantic, failure: snapshot.failure })),
    complete: acquired.length === profile.sources.length,
    totals: {
      features: acquired.reduce((sum, snapshot) => sum + snapshot.featureCount, 0),
      insideClip: acquired.reduce((sum, snapshot) => sum + snapshot.insideClipCount, 0),
      quarantined: acquired.reduce((sum, snapshot) => sum + snapshot.quarantinedCount, 0),
      retainedStraddlers: acquired.reduce((sum, snapshot) => sum + (snapshot.retainedStraddlerCount ?? 0), 0),
      pages: acquired.reduce((sum, snapshot) => sum + snapshot.pageCount, 0),
      bytes: acquired.reduce((sum, snapshot) => sum + snapshot.totalBytes, 0),
      serverExcludedStraddlers: acquired.reduce((sum, snapshot) => sum + (profile.predicate === "within_box" ? (snapshot.clipSemantics?.edgeStraddlerCount ?? 0) : 0), 0),
    },
    sourceSnapshots: snapshots,
    terms: {
      note: "Terms and attribution are captured from each dataset's own NYC Open Data portal metadata document, retained under <datasetId>/metadata.json. This task is authorized for data.cityofnewyork.us only, so the opendata.cityofnewyork.us overview page and the GitHub capture-rules document were deliberately NOT fetched; their URLs are recorded as references instead.",
      referencedTermsUrl: "https://opendata.cityofnewyork.us/overview/",
      referencedCaptureRulesUrl: "https://github.com/CityOfNewYork/nyc-planimetrics/blob/master/Capture_Rules.md",
      disclaimer: "NYC Open Data is provided for informational purposes and may be updated, corrected, or discontinued; no warranty of completeness, accuracy, content, or fitness is made.",
      localOnly: true,
      redistribution: false,
      publicDeployment: false,
    },
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
  };
  const manifestBytes = jsonBytes(manifest);
  await writeExclusive(join(rawRoot, "manifest.json"), manifestBytes);
  await writeExclusive(join(rawRoot, "manifest.sha256"), Buffer.from(`${sha256(manifestBytes)}  manifest.json\n`, "utf8"));

  console.log(JSON.stringify({
    ok: failures.length === 0,
    snapshotId: profile.snapshotId,
    profile: profile.key,
    clipPredicate: profile.predicate,
    rawRoot,
    manifestSha256: sha256(manifestBytes),
    companionOf,
    clip: CLIP_BOUNDS,
    failures,
    snapshots: acquired.map((snapshot) => ({ datasetId: snapshot.datasetId, semantic: snapshot.semantic, mappedViewId: snapshot.mappedViewId, geometryField: snapshot.geometryField, featureCount: snapshot.featureCount, pageCount: snapshot.pageCount, bytes: snapshot.totalBytes, quarantined: snapshot.quarantinedCount, retainedStraddlers: snapshot.retainedStraddlerCount, pageSha256: snapshot.pages.map((page) => page.sha256) })),
  }, null, 2));
  assert(failures.length === 0, `Acquisition finished with ${failures.length} stopped dataset(s): ${failures.join("; ")}`);
}

// ---------------------------------------------------------------------------
// validate:raw
// ---------------------------------------------------------------------------

async function validateProfile(profile, overrideRoot = null) {
  const root = resolve(overrideRoot ?? profile.rawRoot);
  const manifest = await readJson(join(root, "manifest.json"));
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  const predicate = manifest.clipPredicate ?? "within_box";
  const expectedSources = profile.sources;

  check(manifest.snapshotId === profile.snapshotId, `Manifest snapshot id ${manifest.snapshotId} != ${profile.snapshotId}.`);
  check(predicate === profile.predicate, `Manifest clip predicate ${predicate} != ${profile.predicate}.`);
  check(manifest.approval?.evidenceId === APPROVAL_ID, "Manifest approval evidence id mismatch.");
  check(manifest.approval?.fingerprintSha256 === APPROVAL_FINGERPRINT, "Manifest approval fingerprint mismatch.");
  check(sha256(Buffer.from(manifest.approval?.approvalStatement ?? "", "utf8")) === APPROVAL_FINGERPRINT, "Manifest approval statement does not hash to the recorded fingerprint.");
  check(stable(manifest.clip?.bounds) === stable(CLIP_BOUNDS), "Manifest clip bounds drifted from the snapped Manhattan ground coverage.");
  check(manifest.complete === true, "Manifest reports an incomplete acquisition.");
  check(Array.isArray(manifest.sourceSnapshots) && manifest.sourceSnapshots.length === expectedSources.length, `Expected ${expectedSources.length} source snapshots.`);

  // A companion must still point at the primary that is actually on disk.
  if (profile.companionOfSnapshotId) {
    const primaryManifestPath = join(REPO_ROOT, "data/raw", profile.companionOfSnapshotId, "manifest.json");
    if (!(await pathExists(primaryManifestPath))) {
      failures.push(`Companion references primary snapshot ${profile.companionOfSnapshotId}, which is not on disk.`);
    } else {
      const primarySha = sha256(await readFile(primaryManifestPath));
      check(manifest.companionOf?.snapshotId === profile.companionOfSnapshotId, "Companion manifest does not name the primary snapshot.");
      check(manifest.companionOf?.manifestSha256 === primarySha, `Companion cross-reference is stale: recorded primary manifest sha256 ${manifest.companionOf?.manifestSha256} != on-disk ${primarySha}.`);
    }
  } else {
    check(manifest.companionOf == null, "Primary manifest must not claim to be a companion of anything.");
  }

  // The manifest's own recorded manifest.sha256 sibling must still match.
  const manifestBytes = await readFile(join(root, "manifest.json"));
  const siblingText = await readFile(join(root, "manifest.sha256"), "utf8");
  check(siblingText.trim() === `${sha256(manifestBytes)}  manifest.json`, "manifest.sha256 does not match manifest.json on disk.");

  // Every recorded file must still hash to its recorded digest.
  for (const file of manifest.files ?? []) {
    const bytes = await readFile(join(root, file.path));
    if (bytes.byteLength !== file.bytes) { failures.push(`${file.path}: byte length ${bytes.byteLength} != recorded ${file.bytes}`); continue; }
    if (sha256(bytes) !== file.sha256) failures.push(`${file.path}: sha256 mismatch`);
  }

  const summary = [];
  for (const source of expectedSources) {
    const snapshot = (manifest.sourceSnapshots ?? []).find((candidate) => candidate.datasetId === source.datasetId);
    if (!snapshot) { failures.push(`${source.datasetId}: missing from manifest`); continue; }
    if (snapshot.status !== "acquired") { failures.push(`${source.datasetId}: recorded status ${snapshot.status} (${snapshot.failure})`); continue; }
    check(snapshot.mappedViewId === source.mappedViewId, `${source.datasetId}: mapped view id drifted.`);
    check(snapshot.semantic === source.semantic, `${source.datasetId}: semantic drifted.`);
    check(snapshot.query?.where === whereClause(snapshot.geometryField, predicate), `${source.datasetId}: recorded where clause does not match the clip envelope under the ${predicate} predicate.`);
    check(snapshot.featureCountMatchesServerCount === true, `${source.datasetId}: recorded feature count does not match the server's own clipped count.`);
    check(snapshot.unaccounted === 0, `${source.datasetId}: ${snapshot.unaccounted} features are unaccounted for.`);

    let features = 0;
    let inside = 0;
    let quarantined = 0;
    let straddlers = 0;
    const straddlerIds = new Set();
    for (const page of snapshot.pages ?? []) {
      const bytes = await readFile(join(root, page.relativePath));
      if (sha256(bytes) !== page.sha256) { failures.push(`${page.relativePath}: sha256 mismatch`); continue; }
      const value = JSON.parse(bytes.toString("utf8"));
      if (value?.type !== "FeatureCollection" || !Array.isArray(value.features)) { failures.push(`${page.relativePath}: not a GeoJSON FeatureCollection`); continue; }
      if (value?.crs?.properties?.name !== EXPECTED_CRS_NAME) failures.push(`${page.relativePath}: CRS drift (${value?.crs?.properties?.name ?? "none"})`);
      if (value.features.length !== page.featureCount) failures.push(`${page.relativePath}: feature count ${value.features.length} != recorded ${page.featureCount}`);
      const recheck = revalidatePage(source, value.features, page.page, predicate);
      features += value.features.length;
      inside += recheck.inside;
      quarantined += recheck.quarantine.length;
      straddlers += recheck.straddlers.length;
      for (const straddler of recheck.straddlers) if (straddler.sourceFeatureId) straddlerIds.add(straddler.sourceFeatureId);
    }
    check(features === snapshot.featureCount, `${source.datasetId}: recomputed feature count ${features} != recorded ${snapshot.featureCount}.`);
    check(inside === snapshot.insideClipCount, `${source.datasetId}: recomputed in-clip count ${inside} != recorded ${snapshot.insideClipCount}.`);
    check(quarantined === snapshot.quarantinedCount, `${source.datasetId}: recomputed quarantine count ${quarantined} != recorded ${snapshot.quarantinedCount}.`);
    check(straddlers === (snapshot.retainedStraddlerCount ?? 0), `${source.datasetId}: recomputed retained-straddler count ${straddlers} != recorded ${snapshot.retainedStraddlerCount ?? 0}.`);

    const quarantineRecord = await readJson(join(root, snapshot.quarantineRelativePath));
    check(Array.isArray(quarantineRecord.records) && quarantineRecord.records.length === snapshot.quarantinedCount, `${source.datasetId}: quarantine file record count disagrees with the manifest.`);
    check(stable(quarantineRecord.clip?.bounds) === stable(CLIP_BOUNDS), `${source.datasetId}: quarantine file clip bounds drifted.`);

    summary.push({ datasetId: source.datasetId, semantic: source.semantic, mappedViewId: source.mappedViewId, geometryField: snapshot.geometryField, features, insideClip: inside, retainedStraddlers: straddlers, retainedStraddlerIds: [...straddlerIds].sort(), quarantined, pages: snapshot.pageCount, bytes: snapshot.totalBytes });
  }

  if (failures.length > 0) return { ok: false, profile: profile.key, rawRoot: root, failures };
  return {
    ok: true,
    profile: profile.key,
    snapshotId: manifest.snapshotId,
    clipPredicate: predicate,
    rawRoot: root,
    manifestSha256: sha256(manifestBytes),
    companionOf: manifest.companionOf ?? null,
    clip: manifest.clip.bounds,
    clipAuthority: manifest.clip.authority,
    filesVerified: (manifest.files ?? []).length,
    totals: manifest.totals,
    snapshots: summary,
  };
}

/**
 * Validates the primary snapshot and, when it exists on disk, the companion
 * too. `--profile`/`--root` narrow it to one. A companion that exists but fails
 * is a hard failure; a companion that has simply not been acquired is not.
 */
async function validateRaw() {
  const args = parseArgs(process.argv.slice(3));
  const profiles = acquisitionProfiles();
  const results = [];

  if (args.profile || args.root) {
    const profile = acquisitionProfile(args.profile ?? "primary");
    results.push(await validateProfile(profile, typeof args.root === "string" ? args.root : null));
  } else {
    for (const profile of Object.values(profiles)) {
      if (!(await pathExists(join(profile.rawRoot, "manifest.json")))) {
        results.push({ ok: true, profile: profile.key, rawRoot: profile.rawRoot, skipped: "not acquired" });
        continue;
      }
      results.push(await validateProfile(profile));
    }
  }

  const failed = results.filter((result) => !result.ok);
  const companion = results.find((result) => result.profile === "hydro-intersects" && !result.skipped);
  // The note must describe what actually happened, not what a passing run would
  // have shown, or a failing run reads as reassurance.
  const note = !companion
    ? "Only the primary within_box snapshot was validated; the hydro-intersects companion is not on disk."
    : companion.ok
      ? "The hydro-intersects companion is an ADDITIVE snapshot validated against the same clip rectangle under the intersects predicate; its cross-reference to the primary manifest sha256 was re-derived from the primary on disk and matched. The primary within_box snapshot is unmodified."
      : "The hydro-intersects companion FAILED validation; see its failures below. No claim is made about its cross-reference to the primary.";
  console.log(JSON.stringify({ ok: failed.length === 0, note, results }, null, 2));
  assert(failed.length === 0, `validate:raw failed:\n  - ${failed.flatMap((result) => result.failures.map((failure) => `[${result.profile}] ${failure}`)).join("\n  - ")}`);
}

const [, , command] = process.argv;
try {
  if (command === "acquire") await acquire("primary");
  else if (command === "acquire:hydro-intersects") await acquire("hydro-intersects");
  else if (command === "validate:raw") await validateRaw();
  else throw new Error("Usage: citywide-public-realm-cli.mjs acquire|acquire:hydro-intersects|validate:raw [--profile primary|hydro-intersects] [--root path]\n(normalize/build belong to T006 and are deliberately not implemented here.)");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
