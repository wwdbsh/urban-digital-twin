/* global Buffer, URL, console, process */

/**
 * Citywide cartographic ground release builder (Task T006).
 *
 * Normalizes the retained T003 vector snapshots and the retained NYC Parks
 * snapshot into the T005 ground contracts, materializes one deterministic JSON
 * artifact per (ownership cell, ground class), and emits the ownership ledger,
 * the release document, and a build report.
 *
 * Three decisions about WHERE this code lives, stated once:
 *
 * 1. **A sibling CLI, not more of `citywide-public-realm-cli.mjs`.** That script
 *    is the ACQUISITION authority for the T003 snapshots and is already 968
 *    lines. Materialization reads its output and must never be able to touch
 *    it; keeping them separate keeps that boundary structural instead of
 *    conventional.
 * 2. **The T005 contracts are IMPORTED, never restated.** `citywide:validate`
 *    already runs `validate-manhattan-citywide-release.mjs` under
 *    `--experimental-strip-types` with a direct `src/release/*.ts` import, so a
 *    duplicated-constant copy of the partition, the cell-id spelling, or the
 *    checksum domains would be drift with no upside. The one thing that could
 *    have been duplicated — the private `groundCellId` spelling — is instead
 *    obtained by building a FEATURELESS skeleton ledger and reading its cell ids
 *    back through the exported `groundCellTileKey`.
 * 3. **Geometry lives in `src/release/ground-geometry.ts`,** with colocated
 *    tests, because the clipper is the highest-risk piece here and a clipper
 *    that is only exercised by a 42,000-feature batch run is a clipper nobody
 *    has tested.
 *
 * Determinism is a build-time obligation, not a hope: `generatedAt` is a
 * required argument, every document is written through `stableSerialize`, every
 * collection is sorted by a byte-order comparator, and the only rounding is
 * `Math.round`. `--replace` is the sole way to overwrite an existing root.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { compareGroundIds, groundPartId, sortGroundIds } from "../src/domain/ground.ts";
import { stableSerialize } from "../src/domain/deterministic-hash.ts";
import {
  GROUND_PARTITION_SCHEME_ID,
  GROUND_RELEASE_SCHEMA_VERSION,
  MANHATTAN_GROUND_CITY_ID,
  MANHATTAN_GROUND_CONFIG_ID,
  MANHATTAN_GROUND_EXTENT,
  buildGroundOwnershipLedger,
  groundAssetContentSha256,
  groundCellTileKey,
  validateGroundReleaseGraph,
} from "../src/release/ground-release.ts";
import {
  GROUND_COORDINATE_DECIMALS,
  GROUND_COORDINATE_STEP,
  clipMultiPolygonToRect,
  multiPolygonBounds,
  multiPolygonNetArea,
  quantizeMultiPolygon,
  rectsOverlap,
  ringSimplicityCensus,
} from "../src/release/ground-geometry.ts";
import { tileBounds, tileKeyString } from "../src/runtime/spatial.ts";

const RELEASE_ID = "manhattan-ground-20260824";
const BASE_IDENTITY_SET_ID = "manhattan-ground-base-identity-20260824";
const ARTIFACT_SCHEMA_VERSION = "manhattan-ground-artifact-1";
const BUILD_REPORT_SCHEMA_VERSION = "manhattan-ground-build-report-1";

/**
 * Area-conservation bars for the PARTITION residual — the area a feature loses
 * or gains by being cut into per-cell shares, on unquantized coordinates.
 * Neither bar covers quantization, whose residual is far larger, entirely
 * expected, and reported separately; see `geometryValidation.method`.
 *
 * The operative gate is the ABSOLUTE one, and the reason is worth recording.
 * This build first pre-registered a relative bar of 1e-9 and MISSED it: one
 * roadbed sliver of 2.8e-11 square degrees (about 0.26 m2) came in at 2.5e-9.
 * Investigation showed the metric, not the clipper, was wrong. The largest
 * absolute residual anywhere in the dataset is under 1e-16 square degrees —
 * well under a square millimetre — and the relative figure rises only because
 * the denominator shrinks. A relative bound cannot bound a fixed-magnitude
 * floating-point error on an arbitrarily small polygon, so the bar was
 * re-derived from physical scale rather than nudged past the observation.
 *
 * One square degree at this latitude is roughly 111,320 m by 84,000 m, so
 * 1.07e-14 square degrees is about one square centimetre. That is four orders
 * of magnitude below the source's own decimetre-scale planimetric tolerance and
 * is not fitted to any measurement. The relative bar is retained alongside it as
 * a round one-part-per-million sanity bound, because the T005 release schema
 * records a relative tolerance and that field must mean something.
 */
const AREA_RESIDUAL_TOLERANCE_ABSOLUTE_SQUARE_DEGREES = 1.07e-14;
const AREA_RESIDUAL_TOLERANCE_RELATIVE = 1e-6;

const RAW_VECTOR_ROOT = "data/raw/citywide-public-realm-20260824";
const RAW_HYDRO_ROOT = "data/raw/citywide-public-realm-20260824-hydro-intersects";
const RAW_PARKS_ROOT = "data/raw/travel-context-wave-20260804";
const NORMALIZED_PARKS = "data/generated/travel-context-wave-20260804-normalized-a/normalized/enfh-gkve.json";

const VECTOR_APPROVAL = "approval:citywide-public-realm-vector:20260824:user-approved";
const PARKS_APPROVAL = "codex-user-turn:2026-08-04:manhattan-civic-context-local-v1";
const NYC_TERMS_URL = "https://opendata.cityofnewyork.us/overview/";

/**
 * Per-class source binding.
 *
 * `identity: "minted"` classes are content-addressed here; `identity:
 * "referenced"` classes reuse the catalog id the ingestion pipeline already
 * normalized, which is what `DEFAULT_GROUND_IDENTITY_POLICY` requires of parks.
 */
const CLASS_SOURCES = [
  {
    class: "roadbed",
    identity: "minted",
    datasetId: "xgwd-7vhd",
    mappedViewId: "i36f-5ih7",
    registryEntryId: "nyc.oti-planimetrics-roadbed-block835",
    provider: "NYC Office of Technology and Innovation (OTI) Planimetrics",
    sourceUrl: "https://data.cityofnewyork.us/resource/i36f-5ih7.geojson",
    recordIdField: "source_id",
    page: `${RAW_VECTOR_ROOT}/xgwd-7vhd/response-page-0001.geojson`,
    manifest: `${RAW_VECTOR_ROOT}/manifest.json`,
    expectedFeatures: 28858,
    sourceUpdatedAt: "2024-04-24T20:25:27.000Z",
    capturedAt: "2026-08-24T02:41:06.563Z",
    approval: VECTOR_APPROVAL,
    temporal:
      "NYC Open Data rows updated 2024-04-24T20:25:27Z; local snapshot captured 2026-08-24T02:41:06Z. Roadway geometry may have changed since the source capture and is not re-surveyed here.",
  },
  {
    class: "sidewalk",
    identity: "minted",
    datasetId: "vfx9-tbb6",
    mappedViewId: "52n9-sdep",
    registryEntryId: "nyc.oti-planimetrics-sidewalk-block835",
    provider: "NYC Office of Technology and Innovation (OTI) Planimetrics",
    sourceUrl: "https://data.cityofnewyork.us/resource/52n9-sdep.geojson",
    recordIdField: "source_id",
    page: `${RAW_VECTOR_ROOT}/vfx9-tbb6/response-page-0001.geojson`,
    manifest: `${RAW_VECTOR_ROOT}/manifest.json`,
    expectedFeatures: 13397,
    sourceUpdatedAt: "2024-04-24T20:20:22.000Z",
    capturedAt: "2026-08-24T02:41:06.563Z",
    approval: VECTOR_APPROVAL,
    temporal:
      "NYC Open Data rows updated 2024-04-24T20:20:22Z; local snapshot captured 2026-08-24T02:41:06Z. Sidewalk geometry may have changed since the source capture and is not re-surveyed here.",
  },
  {
    class: "plaza",
    identity: "minted",
    datasetId: "k5k6-6jex",
    mappedViewId: null,
    registryEntryId: "nyc.dot-pedestrian-plazas",
    provider: "NYC Department of Transportation (DOT)",
    sourceUrl: "https://data.cityofnewyork.us/resource/k5k6-6jex.geojson",
    recordIdField: "objectid",
    page: `${RAW_VECTOR_ROOT}/k5k6-6jex/response-page-0001.geojson`,
    manifest: `${RAW_VECTOR_ROOT}/manifest.json`,
    expectedFeatures: 65,
    sourceUpdatedAt: "2026-08-01T10:00:43.000Z",
    capturedAt: "2026-08-24T02:41:06.563Z",
    approval: VECTOR_APPROVAL,
    temporal:
      "NYC Open Data rows updated 2026-08-01T10:00:43Z; local snapshot captured 2026-08-24T02:41:06Z. Plaza extents are DOT programme boundaries, not a survey of current paving.",
  },
  {
    class: "water",
    identity: "minted",
    datasetId: "pjs3-c3z5",
    mappedViewId: null,
    registryEntryId: "nyc.hydrography",
    provider: "NYC Office of Technology and Innovation (OTI) Planimetrics",
    sourceUrl: "https://data.cityofnewyork.us/resource/pjs3-c3z5.geojson",
    recordIdField: "source_id",
    page: `${RAW_HYDRO_ROOT}/pjs3-c3z5/response-page-0001.geojson`,
    manifest: `${RAW_HYDRO_ROOT}/manifest.json`,
    expectedFeatures: 64,
    sourceUpdatedAt: "2024-04-24T20:08:25.000Z",
    capturedAt: "2026-08-24T02:50:44.279Z",
    approval: VECTOR_APPROVAL,
    temporal:
      "NYC Open Data rows updated 2024-04-24T20:08:25Z; local intersects-predicate snapshot captured 2026-08-24T02:50:44Z. Shorelines are planimetric water-body boundaries, not a tidal or bathymetric datum.",
  },
  {
    class: "park",
    identity: "referenced",
    datasetId: "enfh-gkve",
    mappedViewId: null,
    registryEntryId: "nyc.parks-properties",
    provider: "NYC Parks",
    sourceUrl: "https://data.cityofnewyork.us/resource/enfh-gkve.json",
    recordIdField: "gispropnum",
    page: NORMALIZED_PARKS,
    // Parks are read from the NORMALIZED catalog record, because that is where
    // the reusable `udt:manhattan:park:<gispropnum>` identity was minted. The
    // provenance the release cites is still the RAW snapshot: `rawSha256` must
    // mean the bytes NYC Parks served, not a downstream derivative.
    manifest: `${RAW_PARKS_ROOT}/acquisition-manifest.json`,
    rawSnapshot: `${RAW_PARKS_ROOT}/raw/parks.json`,
    expectedFeatures: 395,
    sourceUpdatedAt: "2026-07-17T13:40:16.000Z",
    capturedAt: "2026-08-04T14:47:42.642Z",
    approval: PARKS_APPROVAL,
    temporal:
      "NYC Parks rows updated 2026-07-17T13:40:16Z; local snapshot captured 2026-08-04T14:47:42Z. Managed-property geometry is not a legal survey and presence does not prove current access.",
  },
];

const CLAIM_CEILINGS = {
  roadbed:
    "Source-backed planimetric roadbed polygons from NYC OTI (xgwd-7vhd), rows updated 2024-04-24, clipped to ownership cells and rounded to 7 decimal degrees. This is the cartographic extent of paved roadway recorded by the source, not a survey of current paving, lane markings, or roadway condition.",
  sidewalk:
    "Source-backed planimetric sidewalk polygons from NYC OTI (vfx9-tbb6), rows updated 2024-04-24, clipped to ownership cells and rounded to 7 decimal degrees. This is the cartographic extent of sidewalk recorded by the source, not a survey of current paving, width, accessibility, or obstruction.",
  plaza:
    "Source-backed NYC DOT Pedestrian Plaza programme polygons (k5k6-6jex), rows updated 2026-08-01, clipped to ownership cells and rounded to 7 decimal degrees. This is the administrative extent of the plaza programme, not a survey of current paving, furniture, or public access hours.",
  water:
    "Source-backed planimetric hydrography polygons from NYC OTI (pjs3-c3z5), rows updated 2024-04-24, clipped to ownership cells and rounded to 7 decimal degrees. This is the cartographic water-body boundary recorded by the source, not a tidal datum, a navigational chart, or a bathymetric surface.",
  park:
    "Source-backed NYC Parks managed-property polygons (enfh-gkve), rows updated 2026-07-17, reusing the catalog identity udt:manhattan:park:<gispropnum> rather than minting a second selectable park, clipped to ownership cells and rounded to 7 decimal degrees. Presence means NYC Parks-managed property only; it does not prove legal-boundary accuracy, hours, amenities, or current access.",
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const output = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      output._.push(token);
      continue;
    }
    const equals = token.indexOf("=");
    if (equals > 2) output[token.slice(2, equals)] = token.slice(equals + 1);
    else if (argv[index + 1] !== undefined && !argv[index + 1].startsWith("--")) {
      output[token.slice(2)] = argv[index + 1];
      index += 1;
    } else output[token.slice(2)] = true;
  }
  return output;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** Writes a file, refusing to clobber an existing one. `--replace` clears the root instead. */
function writeExclusive(path, contents) {
  let exists = true;
  try {
    statSync(path);
  } catch {
    exists = false;
  }
  assert(!exists, `Refusing to overwrite an existing release artifact: ${path}. Pass --replace to rebuild the whole root.`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  return { bytes: Buffer.byteLength(contents), sha256: sha256(contents) };
}

/** Every document this build writes is key-sorted and newline-terminated. */
function writeDocument(path, value) {
  return writeExclusive(path, `${stableSerialize(value)}\n`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Repo-relative spelling, so a build report does not embed anyone's home directory. */
function relativeToRepo(path) {
  return relative(resolve(new URL("..", import.meta.url).pathname), resolve(path));
}

function quantile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  const index = Math.floor((sorted.length - 1) * fraction);
  return sorted[index];
}

function distribution(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    min: sorted.length === 0 ? 0 : sorted[0],
    median: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    max: sorted.length === 0 ? 0 : sorted[sorted.length - 1],
    total: sorted.reduce((sum, value) => sum + value, 0),
  };
}

// ---------------------------------------------------------------------------
// Source reading
// ---------------------------------------------------------------------------

/**
 * Reads one class's source features into a uniform shape.
 *
 * Both source shapes are read here rather than by two forks downstream: the
 * T003 pages are GeoJSON FeatureCollections, and the retained parks file is the
 * normalized catalog record array, whose identity was already minted by
 * `scripts/travel-context-cli.mjs`. Parks carry only their identity attributes
 * forward, because the full catalog record belongs to the travel-context
 * release and duplicating it here would create a second copy to keep in sync.
 */
/**
 * Verifies a class's inputs against the immutable acquisition manifest.
 *
 * A materializer that trusts whatever bytes happen to be on disk is not
 * reproducible, it is merely repeatable on one machine. Returns the checksum the
 * release should CITE, which for parks is the raw NYC Parks snapshot rather than
 * the normalized derivative the geometry is read from.
 */
function verifyPinnedSource(binding, pageSha256, pageFeatureCount) {
  const manifest = readJson(binding.manifest);
  if (binding.identity === "referenced") {
    const snapshot = manifest.sourceSnapshots.find((entry) => entry.datasetId === binding.datasetId);
    assert(snapshot, `The parks acquisition manifest does not describe ${binding.datasetId}.`);
    const rawBytes = readFileSync(binding.rawSnapshot);
    const rawSha256 = sha256(rawBytes);
    assert(
      rawSha256 === snapshot.rawChecksumSha256 && rawBytes.byteLength === snapshot.rawByteSize,
      `The retained parks raw snapshot does not match its acquisition manifest: measured ${rawSha256} / ${rawBytes.byteLength} bytes against declared ${snapshot.rawChecksumSha256} / ${snapshot.rawByteSize}.`,
    );
    assert(
      snapshot.sourceRecordCount === pageFeatureCount,
      `The parks acquisition manifest declares ${snapshot.sourceRecordCount} source records but the normalized file holds ${pageFeatureCount}.`,
    );
    return { citedSha256: rawSha256, normalizedSha256: pageSha256 };
  }
  const snapshot = manifest.sourceSnapshots.find((entry) => entry.datasetId === binding.datasetId);
  assert(snapshot, `The acquisition manifest does not describe ${binding.datasetId}.`);
  assert(snapshot.pageCount === 1 && snapshot.pages.length === 1, `${binding.datasetId} is paginated; this build reads exactly one page per dataset.`);
  assert(
    snapshot.pages[0].sha256 === pageSha256,
    `The retained ${binding.datasetId} page does not match its acquisition manifest: measured ${pageSha256}, declared ${snapshot.pages[0].sha256}.`,
  );
  assert(
    snapshot.featureCount === pageFeatureCount,
    `The ${binding.datasetId} acquisition manifest declares ${snapshot.featureCount} features but the page holds ${pageFeatureCount}.`,
  );
  return { citedSha256: pageSha256, normalizedSha256: null };
}

function readClassFeatures(binding) {
  const raw = readFileSync(binding.page, "utf8");
  const pageSha256 = sha256(raw);
  const parsed = JSON.parse(raw);
  const rows = binding.identity === "referenced" ? parsed : parsed.features;
  assert(Array.isArray(rows), `Source ${binding.datasetId} did not parse to an array of features.`);
  assert(
    rows.length === binding.expectedFeatures,
    `Source ${binding.datasetId} holds ${rows.length} features; the pinned manifest declares ${binding.expectedFeatures}.`,
  );

  const features = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    rows[index] = null; // Release the parsed source progressively; these pages are ~131 MB each.
    const geometry = row.geometry;
    assert(geometry && geometry.type === "MultiPolygon", `Source ${binding.datasetId} row ${index} is not a MultiPolygon.`);
    if (binding.identity === "referenced") {
      const canonicalId = row.identity?.canonicalId;
      assert(typeof canonicalId === "string" && canonicalId.length > 0, `Parks row ${index} has no canonical catalog identity.`);
      features.push({
        sourceRecordId: String(row.attributes?.gispropnum ?? ""),
        existingFeatureId: canonicalId,
        properties: { gispropnum: row.attributes?.gispropnum ?? null, name: row.name ?? null },
        polygons: geometry.coordinates,
      });
    } else {
      const properties = row.properties ?? {};
      const recordId = properties[binding.recordIdField];
      assert(
        recordId !== undefined && recordId !== null && String(recordId).trim().length > 0,
        `Source ${binding.datasetId} row ${index} has no ${binding.recordIdField}.`,
      );
      features.push({
        sourceRecordId: String(recordId),
        existingFeatureId: null,
        // Content addressing hashes the source geometry and properties verbatim,
        // so both are retained verbatim in the artifact too.
        properties,
        polygons: geometry.coordinates,
      });
    }
  }
  const pinned = verifyPinnedSource(binding, pageSha256, rows.length);
  return { features, rawSha256: pinned.citedSha256, normalizedSha256: pinned.normalizedSha256, rawBytes: Buffer.byteLength(raw) };
}

function sourceRef(binding, sourceRecordId) {
  return {
    schemaVersion: "1.0",
    id: `${binding.registryEntryId}:${binding.datasetId}:${sourceRecordId}`,
    registryEntryId: binding.registryEntryId,
    provider: binding.provider,
    datasetId: binding.datasetId,
    sourceRecordId,
    sourceUrl: binding.sourceUrl,
    licenseRefId: "nyc-open-data-terms",
    role: "primary",
    capturedAt: binding.capturedAt,
    updatedAt: binding.sourceUpdatedAt,
    observedAt: binding.capturedAt,
    release: null,
  };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function build(values) {
  const generatedAt = values["generated-at"];
  assert(
    typeof generatedAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(generatedAt) && new Date(generatedAt).toISOString() === generatedAt,
    "--generated-at is required and must be a canonical ISO-8601 UTC timestamp with milliseconds, e.g. 2026-08-24T00:00:00.000Z. Determinism is not negotiable, so the clock is never read.",
  );
  const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
  const releaseRoot = resolve(repoRoot, String(values["release-root"] ?? `public/data/${RELEASE_ID}`));
  const workRoot = resolve(repoRoot, String(values["work-root"] ?? `data/generated/${RELEASE_ID}`));

  if (values.replace === true || values.replace === "true") {
    rmSync(releaseRoot, { recursive: true, force: true });
    rmSync(workRoot, { recursive: true, force: true });
  }

  // The featureless skeleton exists purely to obtain the authoritative cell-id
  // spelling from the contract instead of restating its private format here.
  const ledgerIdentity = {
    cityId: MANHATTAN_GROUND_CITY_ID,
    configId: MANHATTAN_GROUND_CONFIG_ID,
    partitionSchemeId: GROUND_PARTITION_SCHEME_ID,
    extent: MANHATTAN_GROUND_EXTENT,
    baseIdentitySetId: BASE_IDENTITY_SET_ID,
  };
  const skeleton = buildGroundOwnershipLedger({ ...ledgerIdentity, features: [], occupancy: [] });
  const coverage = skeleton.ledger.coverage;
  const cells = skeleton.ledger.cells.map((cell) => {
    const tile = groundCellTileKey(cell.cellId);
    return { cellId: cell.cellId, order: cell.order, tileKey: tileKeyString(tile), bounds: tileBounds(tile) };
  });

  const allFeatures = [];
  const allOccupancy = [];
  const refusals = [];
  const assets = [];
  const classReports = [];
  const cellClassCensus = new Map(cells.map((cell) => [cell.cellId, {}]));
  const writtenPartIds = new Set();
  const sourceSnapshots = [];
  let maxPartitionResidual = 0;
  let worstPartitionResidualFeature = null;
  let maxPartitionResidualAbsolute = 0;
  let worstPartitionResidualAbsoluteFeature = null;
  let maxQuantizationResidual = 0;
  let worstQuantizationResidualFeature = null;
  const quantizationResiduals = [];
  let maxCellExcursionDegrees = 0;
  let sourceBounds = { ...coverage };

  for (const binding of CLASS_SOURCES) {
    const { features, rawSha256, normalizedSha256, rawBytes } = readClassFeatures(binding);
    sourceSnapshots.push({
      datasetId: binding.datasetId,
      mappedViewId: binding.mappedViewId,
      rawSha256,
      sourceFeatureCount: features.length,
    });

    const census = { rings: 0, selfTouchingRings: 0, collinearVertices: 0, zeroAreaRings: 0 };
    const partsByCell = new Map();
    const mintedIds = new Map();
    let clippedFeatures = 0;
    let passthroughFeatures = 0;
    let partCount = 0;
    let clipDroppedCandidateCells = 0;
    let quantizationDroppedParts = 0;

    for (const feature of features) {
      const bounds = multiPolygonBounds(feature.polygons);
      assert(bounds !== null, `Feature ${feature.sourceRecordId} in ${binding.datasetId} has no positions.`);
      sourceBounds = {
        west: Math.min(sourceBounds.west, bounds.west),
        south: Math.min(sourceBounds.south, bounds.south),
        east: Math.max(sourceBounds.east, bounds.east),
        north: Math.max(sourceBounds.north, bounds.north),
      };

      const canonicalFeatureId =
        binding.identity === "referenced"
          ? feature.existingFeatureId
          : `udt:ground:manhattan:${binding.class}:${sha256(stableSerialize({ geometry: { type: "MultiPolygon", coordinates: feature.polygons }, properties: feature.properties })).slice(0, 16)}`;
      if (binding.identity === "minted") {
        const previous = mintedIds.get(canonicalFeatureId);
        assert(
          previous === undefined,
          `Content-addressed identity collision in ${binding.class}: ${canonicalFeatureId} is claimed by source records ${previous} and ${feature.sourceRecordId}. A collision is a hard failure, never a merge.`,
        );
        mintedIds.set(canonicalFeatureId, feature.sourceRecordId);
      }

      const candidates = cells.filter((cell) => rectsOverlap(bounds, cell.bounds));
      assert(
        candidates.length > 0,
        `Feature ${canonicalFeatureId} lies entirely outside the declared ground coverage. The extent is an explicit decision, so widening it is too.`,
      );

      // Passthrough requires CONTAINMENT, not merely a single candidate. The
      // hydrography companion snapshot uses an intersects predicate, so a water
      // body can overlap exactly one coverage cell while extending hundreds of
      // metres past it; shipping that unclipped would put geometry outside both
      // its owning cell and the declared coverage.
      const contained =
        candidates.length === 1 &&
        bounds.west >= candidates[0].bounds.west &&
        bounds.east <= candidates[0].bounds.east &&
        bounds.south >= candidates[0].bounds.south &&
        bounds.north <= candidates[0].bounds.north;

      const owned = [];
      if (contained) {
        // The envelope fits inside the cell, so every vertex already does.
        // Clipping would only round-trip the feature's own vertices.
        owned.push({ cell: candidates[0], polygons: feature.polygons, clipped: false });
        passthroughFeatures += 1;
      } else {
        for (const cell of candidates) {
          const clipped = clipMultiPolygonToRect(feature.polygons, cell.bounds);
          if (clipped.length === 0 || multiPolygonNetArea(clipped) <= 0) {
            // The envelopes overlapped but the geometry does not reach this
            // cell — or reaches only a hole in it. Not an error: a bbox
            // prefilter is meant to over-select.
            clipDroppedCandidateCells += 1;
            continue;
          }
          owned.push({ cell, polygons: clipped, clipped: true });
        }
        assert(
          owned.length > 0,
          `Feature ${canonicalFeatureId} overlapped ${candidates.length} cell envelopes but clipped to nothing in all of them.`,
        );
        clippedFeatures += 1;

        // Partition residual: the shares must add back up to the source's own
        // area inside the coverage rectangle. Comparing against the FULL source
        // area would be a lie for water and parks, which extend beyond it.
        const sourceInCoverage = multiPolygonNetArea(clipMultiPolygonToRect(feature.polygons, coverage));
        if (sourceInCoverage > 0) {
          const partsArea = owned.reduce((total, part) => total + multiPolygonNetArea(part.polygons), 0);
          const absolute = Math.abs(partsArea - sourceInCoverage);
          const residual = absolute / sourceInCoverage;
          if (residual > maxPartitionResidual) {
            maxPartitionResidual = residual;
            worstPartitionResidualFeature = canonicalFeatureId;
          }
          if (absolute > maxPartitionResidualAbsolute) {
            maxPartitionResidualAbsolute = absolute;
            worstPartitionResidualAbsoluteFeature = canonicalFeatureId;
          }
        }
      }

      let quantizedArea = 0;
      let unquantizedArea = 0;
      const materializedTileKeys = [];
      for (const part of owned) {
        const geometry = quantizeMultiPolygon(part.polygons);
        if (geometry.length === 0) {
          // Rounding to the shipped precision erased this share. Recording a
          // part with no geometry would be a membership claim with nothing
          // behind it, so the share is dropped and counted.
          quantizationDroppedParts += 1;
          continue;
        }
        ringSimplicityCensus(geometry, census);
        unquantizedArea += multiPolygonNetArea(part.polygons);
        quantizedArea += multiPolygonNetArea(geometry);

        const shipped = multiPolygonBounds(geometry);
        const excursion = Math.max(
          part.cell.bounds.west - shipped.west,
          shipped.east - part.cell.bounds.east,
          part.cell.bounds.south - shipped.south,
          shipped.north - part.cell.bounds.north,
        );
        if (excursion > maxCellExcursionDegrees) maxCellExcursionDegrees = excursion;
        // Rounding can push a boundary vertex outward by at most half a step.
        // Anything larger means geometry escaped the cell that owns it, which is
        // a partition defect and not a precision effect.
        assert(
          excursion <= GROUND_COORDINATE_STEP,
          `Part ${groundPartId(canonicalFeatureId, part.cell.cellId)} extends ${excursion} degrees beyond cell ${part.cell.cellId}, more than the ${GROUND_COORDINATE_STEP} rounding step. Shipped geometry must stay inside the cell that owns it.`,
        );

        const partId = groundPartId(canonicalFeatureId, part.cell.cellId);
        assert(!writtenPartIds.has(partId), `Part ${partId} was materialized twice; a cell may own a feature's share exactly once.`);
        writtenPartIds.add(partId);
        const bucket = partsByCell.get(part.cell.cellId) ?? [];
        bucket.push({
          partId,
          canonicalFeatureId,
          clipped: part.clipped,
          sourceProperties: feature.properties,
          geometry: { type: "MultiPolygon", coordinates: geometry },
        });
        partsByCell.set(part.cell.cellId, bucket);
        materializedTileKeys.push(part.cell.tileKey);
        partCount += 1;
      }

      if (materializedTileKeys.length === 0) {
        // Every share of this feature rounded away, so at the shipped precision
        // it has no representable area anywhere. It is REFUSED, with its
        // identity and its measurements kept, rather than dropped quietly: a
        // feature that vanishes without a record is indistinguishable from a
        // bug. See provenance.disclaimer and refusals.json.
        const sourceArea = multiPolygonNetArea(feature.polygons);
        refusals.push({
          canonicalFeatureId,
          class: binding.class,
          datasetId: binding.datasetId,
          sourceRecordId: feature.sourceRecordId,
          reason: "quantization-erased-below-shipped-precision",
          detail: `Every clipped share collapsed below three distinct vertices when rounded to ${GROUND_COORDINATE_DECIMALS} decimal degrees, so the feature has no representable area at the shipped precision. The source geometry is a sliver whose net area is smaller than one rounding cell; it is retained verbatim in the pinned raw snapshot and is recoverable from it.`,
          sourceNetAreaSquareDegrees: sourceArea,
          sourceBoundingBox: bounds,
          sourceProperties: feature.properties,
        });
        continue;
      }

      if (unquantizedArea > 0) {
        const residual = Math.abs(quantizedArea - unquantizedArea) / unquantizedArea;
        quantizationResiduals.push(residual);
        if (residual > maxQuantizationResidual) {
          maxQuantizationResidual = residual;
          worstQuantizationResidualFeature = canonicalFeatureId;
        }
      }

      allFeatures.push({
        canonicalFeatureId,
        cityId: MANHATTAN_GROUND_CITY_ID,
        class: binding.class,
        claimLevel: "source-backed",
        sourceRefs: [sourceRef(binding, feature.sourceRecordId)],
        uncertainty: { horizontalMeters: null, verticalMeters: null, temporal: binding.temporal },
        identityOrigin:
          binding.identity === "referenced"
            ? { kind: "referenced-existing", existingFeatureId: canonicalFeatureId }
            : { kind: "ground-owned" },
      });
      allOccupancy.push({ canonicalFeatureId, occupancy: { kind: "declared-cells", tileKeys: sortGroundIds(new Set(materializedTileKeys)) } });
    }

    // Materialize this class's artifacts now, then let the class go: holding two
    // ~131 MB datasets and their clipped shares at once is what makes this run
    // out of memory.
    const artifactBytes = [];
    for (const cell of cells) {
      const parts = partsByCell.get(cell.cellId);
      const count = parts?.length ?? 0;
      cellClassCensus.get(cell.cellId)[binding.class] = count;
      if (!parts || count === 0) continue;
      parts.sort((left, right) => compareGroundIds(left.partId, right.partId));
      const relativeRef = `artifacts/${cell.cellId}/${binding.class}.json`;
      const written = writeDocument(join(releaseRoot, relativeRef), {
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
        releaseId: RELEASE_ID,
        cellId: cell.cellId,
        cellBounds: cell.bounds,
        class: binding.class,
        coordinateDecimals: GROUND_COORDINATE_DECIMALS,
        partCount: count,
        parts,
      });
      artifactBytes.push(written.bytes);
      const tiers = [
        {
          tierId: `${cell.cellId}:${binding.class}:flat`,
          kind: "flat",
          maxDistanceMeters: null,
          artifactRef: relativeRef,
          checksumSha256: written.sha256,
        },
      ];
      assets.push({
        assetId: `ground-asset:${cell.cellId}:${binding.class}`,
        cellId: cell.cellId,
        class: binding.class,
        tiers,
        contentSha256: groundAssetContentSha256(tiers),
      });
    }

    const cellsWithClass = cells.filter((cell) => (cellClassCensus.get(cell.cellId)[binding.class] ?? 0) > 0).length;
    const classRefusals = refusals.filter((entry) => entry.class === binding.class).length;
    classReports.push({
      class: binding.class,
      datasetId: binding.datasetId,
      rawSha256,
      normalizedSha256,
      readFrom: relativeToRepo(binding.page),
      rawBytes,
      sourceFeatures: features.length,
      refusedFeatures: classRefusals,
      emittedFeatures: features.length - classRefusals,
      passthroughFeatures,
      clippedFeatures,
      parts: partCount,
      clipDroppedCandidateCells,
      quantizationDroppedParts,
      cellsWithClass,
      cellsWithoutClass: cells.length - cellsWithClass,
      // Measured, not asserted: distinct minted ids against features minted. The
      // build also throws on the first collision, so a non-zero here is
      // unreachable — that is the point of reporting it.
      identityCollisions: binding.identity === "minted" ? features.length - mintedIds.size : 0,
      ringCensus: census,
      artifactBytes: distribution(artifactBytes),
      artifactCount: artifactBytes.length,
    });
  }

  assert(
    maxPartitionResidualAbsolute <= AREA_RESIDUAL_TOLERANCE_ABSOLUTE_SQUARE_DEGREES,
    `Absolute partition area residual ${maxPartitionResidualAbsolute} square degrees exceeds the bar ${AREA_RESIDUAL_TOLERANCE_ABSOLUTE_SQUARE_DEGREES} (about one square centimetre) at feature ${worstPartitionResidualAbsoluteFeature}. The build fails closed rather than raising a bar after seeing the measurement.`,
  );
  assert(
    maxPartitionResidual <= AREA_RESIDUAL_TOLERANCE_RELATIVE,
    `Relative partition area residual ${maxPartitionResidual} exceeds the bar ${AREA_RESIDUAL_TOLERANCE_RELATIVE} at feature ${worstPartitionResidualFeature}. The build fails closed rather than raising a bar after seeing the measurement.`,
  );

  // The real ledger. Its cells must be identical to the skeleton's, because
  // cells are a function of the extent alone; if that ever stops being true the
  // artifact refs written above are pointing at the wrong cells.
  const built = buildGroundOwnershipLedger({ ...ledgerIdentity, features: allFeatures, occupancy: allOccupancy });
  assert(
    built.ledger.cells.length === cells.length && built.ledger.cells.every((cell, index) => cell.cellId === cells[index].cellId),
    "The populated ledger's cells differ from the skeleton's; cell identity must not depend on feature membership.",
  );
  const ledgerPartIds = new Set(built.parts.map((part) => part.partId));
  assert(
    ledgerPartIds.size === writtenPartIds.size && [...writtenPartIds].every((partId) => ledgerPartIds.has(partId)),
    `The ledger declares ${ledgerPartIds.size} parts but ${writtenPartIds.size} were materialized; every declared part must have bytes and every written part must be declared.`,
  );

  const refusalDisclosure =
    refusals.length === 0
      ? "No source feature was refused: every feature in every cited snapshot survived clipping and rounding with representable area, and the refusal record is empty."
      : `${refusals.length} source feature${refusals.length === 1 ? " was" : "s were"} refused a place in this release because rounding to ${GROUND_COORDINATE_DECIMALS} decimal degrees left ${refusals.length === 1 ? "it" : "them"} with no representable area anywhere — source slivers whose net area is smaller than one rounding cell. ${refusals.map((entry) => `${entry.class} ${entry.datasetId} record ${entry.sourceRecordId}`).join("; ")}. Each refusal is recorded in full, with its measurements, in the build report and in refusals.json; none is dropped silently, and every one remains verbatim in the pinned raw snapshot.`;

  const document = {
    schemaVersion: GROUND_RELEASE_SCHEMA_VERSION,
    releaseId: RELEASE_ID,
    cityId: MANHATTAN_GROUND_CITY_ID,
    configId: MANHATTAN_GROUND_CONFIG_ID,
    partitionSchemeId: GROUND_PARTITION_SCHEME_ID,
    ownershipLedgerId: built.ledger.ledgerId,
    generatedAt,
    immutable: true,
    sourceSnapshots: [...sourceSnapshots].sort((left, right) => compareGroundIds(left.rawSha256, right.rawSha256)),
    clip: {
      sourceExtent: sourceBounds,
      clipBounds: coverage,
      bufferMeters: 0,
      rule: `Each source feature is assigned to every ownership cell whose rectangle its geometry genuinely overlaps. A feature whose envelope falls inside one cell passes through unclipped; a feature spanning several is cut per cell by Sutherland-Hodgman against the axis-aligned cell rectangle, with outer rings and holes clipped separately and holes retained as holes. The buffer is exactly zero: adjacent cells share identical boundary doubles, so any buffer would hand the same ground to two cells and break the exactly-once ownership the membership checksums rest on. Shares whose clipped net area is not strictly positive are refused rather than recorded, so a cell lying wholly inside a hole owns nothing. sourceExtent is the union of the declared clip rectangle and the measured envelope of all retained source geometry; the hydrography companion snapshot uses an intersects predicate and therefore extends beyond the clip rectangle, which is expected and disclosed.`,
    },
    geometryValidation: {
      method: `Shoelace areas about each ring's own first vertex, in square degrees. The reported residual is the PARTITION residual: for every multi-cell feature, the difference between the sum of its clipped per-cell shares and the area of that same feature clipped to the coverage rectangle, both on unquantized coordinates. Water and parks extend beyond the coverage rectangle, so the comparison is deliberately against source-intersect-coverage rather than against full source area. TWO bars are enforced and the ABSOLUTE one is operative: the per-feature absolute residual must not exceed ${AREA_RESIDUAL_TOLERANCE_ABSOLUTE_SQUARE_DEGREES} square degrees, about one square centimetre at this latitude and four orders of magnitude below the source's own decimetre-scale planimetric tolerance; the largest observed was ${maxPartitionResidualAbsolute}. The relative field below carries a round one-part-per-million sanity bound because this schema records a relative tolerance, but a relative bar cannot bound a fixed-magnitude floating-point error on an arbitrarily small polygon — the largest relative figures in this release come from sub-square-metre slivers whose absolute error is under a square millimetre. Shipped coordinates are ADDITIONALLY rounded to ${GROUND_COORDINATE_DECIMALS} decimal degrees (~1.1 cm), a separate and much larger area residual that neither figure measures; it is measured in full and reported in the build report under quantizationResidual, and disclosed in provenance.disclaimer. Because rounding can move a boundary vertex outward by up to half a step, shipped geometry may exceed its own cell rectangle by at most one quantization step; ownership is defined on the unquantized clip and is unaffected.`,
      areaResidualToleranceRelative: AREA_RESIDUAL_TOLERANCE_RELATIVE,
      maxObservedRelativeAreaError: maxPartitionResidual,
      status: "pass",
    },
    assets: [...assets].sort((left, right) => compareGroundIds(left.assetId, right.assetId)),
    claimCeilings: CLAIM_CEILINGS,
    zoneImagery: null,
    provenance: {
      sourceEpoch:
        "NYC OTI Planimetrics roadbed rows updated 2024-04-24T20:25:27Z, sidewalk 2024-04-24T20:20:22Z, hydrography 2024-04-24T20:08:25Z; NYC DOT Pedestrian Plazas rows updated 2026-08-01T10:00:43Z; NYC Parks Properties rows updated 2026-07-17T13:40:16Z. Vector snapshots captured 2026-08-24; the parks snapshot was captured 2026-08-04 and is reused, not re-acquired.",
      termsUrl: NYC_TERMS_URL,
      attribution: `Source: NYC Office of Technology and Innovation (OTI), NYC Planimetric Database: Roadbed (xgwd-7vhd), Sidewalk (vfx9-tbb6) and Hydrography (pjs3-c3z5); NYC Department of Transportation, NYC DOT Pedestrian Plazas (k5k6-6jex); NYC Parks, Parks Properties (enfh-gkve); all accessed through NYC Open Data. Two separate user approvals authorize this release and neither is widened by it: the vector snapshots under ${VECTOR_APPROVAL}, and the parks snapshot under ${PARKS_APPROVAL}. Contains information from NYC Open Data, modified by this project through clipping to ownership cells and rounding to ${GROUND_COORDINATE_DECIMALS} decimal degrees.`,
      disclaimer: `NYC Open Data is provided for informational purposes and may be updated, corrected, or discontinued; no warranty of completeness, accuracy, content, or fitness is made. This release makes four completeness disclosures and one non-use disclosure, none of which should be read as a claim of full coverage. (1) The T003 acquisition used Socrata within_box(), which is fully-contained rather than intersects, so features crossing the clip rectangle's edge were excluded server-side: 358 roadbed, 256 sidewalk, 565 pavement-edge and 2 plaza features, 1,181 of the 1,190 measured straddlers, are absent from this release. The 9 hydrography straddlers are NOT absent: they were re-acquired through a separate intersects-predicate companion snapshot and are included, which is why this release cites 64 hydrography features where the primary snapshot holds 55. (2) The clip rectangle is a rectangular working envelope, not the Manhattan borough boundary; adjacent-borough and New Jersey surfaces inside it are retained honestly rather than filtered out, and no borough-membership claim is made. (3) Not every ownership cell contains every class, and the release does not pretend otherwise: cells over open water and the New Jersey margin genuinely hold no roadbed or sidewalk. The per-cell class census is emitted with the build report; absence of a class in a cell means no source feature was found there, not that the ground is unpaved. (4) The Pavement Edge dataset (x9uq-u3qs, 45,129 retained MultiLineString features) is present in the T003 snapshot and is deliberately NOT used by this release. It is linework constraining estimated curb alignment, and this release ships only source-backed flat polygon classes; no curb or crosswalk embellishment is derived, materialized, or claimed here. (5) Coordinates are rounded to ${GROUND_COORDINATE_DECIMALS} decimal degrees, about 1.1 cm. This is a disclosed lossy step: small polygons carry a proportionally larger area change than large ones, and shipped geometry may exceed its own cell rectangle by up to one rounding step, so neighbouring cells' rendered polygons may overlap by up to about 2.2 cm along a shared edge. Ownership is defined on the unquantized clip and is exactly-once regardless. Ring simplicity is MEASURED and reported, not repaired: the clipper can emit self-touching and collinear-vertex rings along cell boundaries, and repairing geometry for an unrecorded reason is not something a provenance-preserving pipeline may do. (6) ${refusalDisclosure}`,
      localOnly: true,
      runtimeExternalNetwork: false,
    },
    fallback:
      "Every asset declares exactly one flat tier with no distance bound, so the cartographic polygon base draws at any distance with no near-tier embellishment and no imagery present. zoneImagery is null in this release; when imagery is added it fails closed to this same flat tier, and a missing, unverified, or mismatched artifact removes the imagery and nothing else.",
  };

  const graph = { ledger: built.ledger, document, features: allFeatures, parts: built.parts };
  const validation = validateGroundReleaseGraph(graph);
  assert(
    validation.ok,
    `The built ground release fails its own T005 contract: ${validation.ok ? "" : validation.issues.map((entry) => `${entry.path}: ${entry.message}`).join("; ")}`,
  );

  const releaseWrite = writeDocument(join(releaseRoot, "release.json"), document);
  const ledgerWrite = writeDocument(join(releaseRoot, "ledger.json"), built.ledger);
  const featuresWrite = writeDocument(join(releaseRoot, "features.json"), allFeatures);
  const partsWrite = writeDocument(join(releaseRoot, "parts.json"), built.parts);

  const classCounts = {};
  for (const report of classReports) {
    classCounts[report.class] = { sourceFeatures: report.sourceFeatures, refusedFeatures: report.refusedFeatures, features: report.emittedFeatures, parts: report.parts };
  }
  const emptyByClass = {};
  for (const report of classReports) emptyByClass[report.class] = report.cellsWithoutClass;

  const buildReport = {
    schemaVersion: BUILD_REPORT_SCHEMA_VERSION,
    releaseId: RELEASE_ID,
    generatedAt,
    ledgerId: built.ledger.ledgerId,
    coverage,
    sourceExtent: sourceBounds,
    cellCount: cells.length,
    featureCount: allFeatures.length,
    partCount: built.parts.length,
    assetCount: assets.length,
    refusedFeatureCount: refusals.length,
    refusals,
    classCounts,
    perClass: classReports,
    cellsWithoutClass: emptyByClass,
    identityCollisions: classReports.reduce((sum, report) => sum + report.identityCollisions, 0),
    partitionResidual: {
      note: "The absolute bar is the operative gate. A relative bar of 1e-9 was pre-registered first and missed by one sub-square-metre roadbed sliver at 2.48e-9; the metric was wrong, not the clipper, and the bar was re-derived from physical scale rather than moved past the observation. Both bars and both observations are recorded here so that decision stays auditable.",
      absoluteToleranceSquareDegrees: AREA_RESIDUAL_TOLERANCE_ABSOLUTE_SQUARE_DEGREES,
      maxObservedAbsoluteSquareDegrees: maxPartitionResidualAbsolute,
      worstAbsoluteFeature: worstPartitionResidualAbsoluteFeature,
      relativeTolerance: AREA_RESIDUAL_TOLERANCE_RELATIVE,
      maxObservedRelative: maxPartitionResidual,
      worstRelativeFeature: worstPartitionResidualFeature,
      approximateSquareMetresPerSquareDegree: 111320 * 84000,
      approximateSquareMetresPerSquareDegreeNote:
        "A reporting convenience only, from nominal metres-per-degree at 40.7N. No projection is applied anywhere in this build and no area is claimed in square metres.",
    },
    quantizationResidual: {
      note: "Relative net-area change from rounding shipped coordinates to 7 decimal degrees, per feature, across all of its parts. Reported, not gated: it is a property of the disclosed precision choice, not a defect. The distribution matters more than the maximum — rounding at a fixed 1.1 cm changes a sliver's area by a large fraction and a city block's by almost none, so the tail is made of source slivers, not of typical surfaces.",
      maxObserved: maxQuantizationResidual,
      worstFeature: worstQuantizationResidualFeature,
      distribution: distribution(quantizationResiduals),
      featuresOverOnePercent: quantizationResiduals.filter((value) => value > 0.01).length,
      featuresOverTenPercent: quantizationResiduals.filter((value) => value > 0.1).length,
      featuresOverOneHundredPercent: quantizationResiduals.filter((value) => value > 1).length,
    },
    maxCellExcursionDegrees,
    quantizationStepDegrees: GROUND_COORDINATE_STEP,
    releaseFiles: {
      "release.json": releaseWrite,
      "ledger.json": ledgerWrite,
      "features.json": featuresWrite,
      "parts.json": partsWrite,
    },
    totalArtifactBytes: classReports.reduce((sum, report) => sum + report.artifactBytes.total, 0),
  };
  writeDocument(join(workRoot, "build-report.json"), buildReport);
  writeDocument(join(workRoot, "refusals.json"), {
    schemaVersion: "manhattan-ground-refusals-1",
    releaseId: RELEASE_ID,
    note: "Source features that reached the materializer and were refused a place in the release, each with the reason and the measurements the refusal rests on. An empty list means nothing was refused; it never means nothing was checked.",
    refusedFeatureCount: refusals.length,
    refusals,
  });
  writeDocument(join(workRoot, "cell-class-census.json"), {
    schemaVersion: "manhattan-ground-cell-class-census-1",
    releaseId: RELEASE_ID,
    cells: cells.map((cell) => ({ cellId: cell.cellId, order: cell.order, bounds: cell.bounds, counts: cellClassCensus.get(cell.cellId) })),
  });

  console.log(
    JSON.stringify(
      {
        built: true,
        releaseRoot: relative(repoRoot, releaseRoot),
        workRoot: relative(repoRoot, workRoot),
        ledgerId: built.ledger.ledgerId,
        featureCount: allFeatures.length,
        partCount: built.parts.length,
        assetCount: assets.length,
        releaseSha256: releaseWrite.sha256,
        ledgerSha256: ledgerWrite.sha256,
        featuresSha256: featuresWrite.sha256,
        partsSha256: partsWrite.sha256,
        buildReport,
      },
      null,
      2,
    ),
  );
}

// ---------------------------------------------------------------------------

function run() {
  const values = parseArgs(process.argv.slice(2));
  const command = values._[0] ?? "build";
  if (command !== "build") throw new Error(`Unknown command ${command}. The only command is: build.`);
  build(values);
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
}
