/* global Buffer, URL, console, process */

/**
 * Citywide curb embellishment builder and validator (Task T009).
 *
 * Reads the retained T003 Pavement Edge snapshot, clips its linework to the
 * T005/T006 ownership cells, and emits a SEPARATE ground release —
 * `manhattan-ground-embellishment-20260825` — carrying one near-3d curb asset
 * per cell. The shipped flat release `manhattan-ground-20260824` is not read for
 * geometry, not modified, and not re-derived; the two releases share a partition
 * scheme and nothing else.
 *
 * Four decisions about scope and shape, stated once:
 *
 * 1. **CURBS ONLY.** Crosswalks are deliberately absent. Block 835 derives four
 *    crosswalks from a hand-named four-corner intersection model; citywide there
 *    is no intersection ground truth in any retained snapshot, and inventing one
 *    would put ~10,000 estimated crossings on the map with nothing behind them.
 *    That is recorded as a pending user decision, not as a gap this build filled.
 * 2. **A separate release, not a second class in T006's.** T006's release is
 *    published, checksum-pinned and immutable, and its every asset is a flat
 *    source-backed polygon tier. Adding an estimated near-tier class to it would
 *    rewrite an immutable root and mix claim strengths inside one document. A
 *    sibling release with its own ledger, its own identity set and its own
 *    ceilings keeps both properties.
 * 3. **The derivation lives in TypeScript, not here.** `deriveCurb` in
 *    `../src/release/ground-embellishment.ts` is the algorithm, with colocated
 *    tests including a record-level equivalence fixture against the promoted
 *    Block 835 release. This file is I/O, provenance, accounting and gates.
 * 4. **Budgets are referenced, never restated.** The byte ceilings below are
 *    fields of `CITYWIDE_BUDGETS`; no number is copied out of it.
 *
 * Determinism is a build-time obligation: `--generated-at` is required, every
 * document is written through `stableSerialize`, every collection is sorted by a
 * byte-order comparator, the only rounding is `Math.round`, and `--replace` is
 * the sole way to overwrite an existing root.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { GROUND_EMBELLISHMENT_CLASSES, compareGroundIds, groundPartId, sortGroundIds } from "../src/domain/ground.ts";
import { stableSerialize } from "../src/domain/deterministic-hash.ts";
import { CITYWIDE_BUDGETS } from "../src/release/citywide-release.ts";
import {
  CURB_DERIVATION_ALGORITHM,
  CURB_INPUT_DATASET_ID,
  CURB_UNCERTAINTY,
  CURB_VERTICAL_PROFILE,
  GROUND_EMBELLISHMENT_NEAR_TIER_MAX_DISTANCE_METERS,
  deriveCurb,
} from "../src/release/ground-embellishment.ts";
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
  clipMultiLineStringToRect,
  multiLineStringL1Length,
  quantizeCoordinate,
} from "../src/release/ground-geometry.ts";
import { tileBounds, tileKeyString } from "../src/runtime/spatial.ts";

const RELEASE_ID = "manhattan-ground-embellishment-20260825";
const BASE_IDENTITY_SET_ID = "manhattan-ground-embellishment-base-identity-20260825";
const ARTIFACT_SCHEMA_VERSION = "manhattan-ground-embellishment-artifact-1";
const BUILD_REPORT_SCHEMA_VERSION = "manhattan-ground-embellishment-build-report-1";
const EMBELLISHMENT_CLASS = "curb";
const EXPECTED_CELL_COUNT = 140;

const RAW_VECTOR_ROOT = "data/raw/citywide-public-realm-20260824";
const VECTOR_MANIFEST = `${RAW_VECTOR_ROOT}/manifest.json`;

/**
 * The T003 acquisition manifest this release is pinned to.
 *
 * Pinned by CONTENT, not by path: the manifest is what makes every page checksum
 * in this build meaningful, so a build that read a rewritten manifest would be
 * verifying bytes against a moved target. Recorded in `sourceSnapshots` as well,
 * so the pin survives into the published document.
 */
const VECTOR_MANIFEST_SHA256 = "da4653767ff95581c5840b5aeeffe2cf9495670fd9d8f56670ed0c131665d997";
const VECTOR_APPROVAL = "approval:citywide-public-realm-vector:20260824:user-approved";
const NYC_TERMS_URL = "https://opendata.cityofnewyork.us/overview/";

/** Straddler counts re-disclosed from the T003 manifest's own `clipSemantics`. */
const PAVEMENT_EDGE_STRADDLERS_EXCLUDED = 565;
const SIDEWALK_STRADDLERS_EXCLUDED = 256;

const CURB_SOURCE = {
  class: EMBELLISHMENT_CLASS,
  datasetId: CURB_INPUT_DATASET_ID,
  mappedViewId: "vs44-rznx",
  registryEntryId: "nyc.oti-planimetrics-pavement-edge-block835",
  provider: "NYC Office of Technology and Innovation (OTI) Planimetrics",
  sourceUrl: "https://data.cityofnewyork.us/resource/vs44-rznx.geojson",
  recordIdField: "source_id",
  page: `${RAW_VECTOR_ROOT}/${CURB_INPUT_DATASET_ID}/response-page-0001.geojson`,
  expectedFeatures: 45129,
  sourceUpdatedAt: "2024-04-26T20:48:18.000Z",
  capturedAt: "2026-08-24T02:41:06.563Z",
  approval: VECTOR_APPROVAL,
  temporal:
    "Pavement edge constrains horizontal alignment; curb vertical profile is authored estimate, not survey truth. NYC Open Data rows updated 2024-04-26T20:48:18Z; local snapshot captured 2026-08-24T02:41:06Z. Kerb lines may have changed since the source capture and are not re-surveyed here.",
};

const CLAIM_CEILINGS = {
  curb:
    `Estimated curb embellishment derived from NYC OTI Planimetrics Pavement Edge linework (${CURB_INPUT_DATASET_ID}), rows updated 2024-04-26, clipped to ownership cells and rounded to ${GROUND_COORDINATE_DECIMALS} decimal degrees. The horizontal alignment is the source pavement edge verbatim; the ${CURB_VERTICAL_PROFILE.authoredRiseMeters} m vertical rise is authored and estimated, and no source in this pipeline measures curb height. This is not a survey of current curb geometry, height, condition, ramps, or drop-offs, and pavement edge is not itself a curb: it is the edge of paving the source recorded, which this release treats as a constraint on where a curb may run. No crosswalk is derived, materialized, or claimed anywhere in this release.`,
};

/**
 * Byte ceilings, by REFERENCE.
 *
 * `CITYWIDE_BUDGETS.totalBytes` is the shipped ceiling for one local release
 * root, and it is the gate this build fails closed on.
 * `CITYWIDE_BUDGETS.geometryShardBytes` is the per-shard figure the citywide
 * streaming release sizes a single fetched geometry payload against; a curb cell
 * artifact is the same kind of object, so it is the right yardstick to REPORT
 * per-artifact size against. It is deliberately reported rather than gated: no
 * per-cell serving ceiling for embellishments has been measured yet, that
 * measurement is T010's, and a gate nobody sized would be a bar invented here.
 */
const TOTAL_ARTIFACT_BYTE_CEILING = CITYWIDE_BUDGETS.totalBytes;
const PER_ARTIFACT_REFERENCE_BYTES = CITYWIDE_BUDGETS.geometryShardBytes;

/**
 * Clip-conservation bar for LINEWORK, in L1 degrees.
 *
 * The per-cell pieces of a line must sum back to the same line clipped to the
 * whole coverage rectangle. The bar is ONE quantization step
 * (`GROUND_COORDINATE_STEP`, ~1.1 cm), derived by reference rather than chosen:
 * clipping arithmetic that disagreed by as much as the rounding this release
 * already discloses would be a defect, and anything below it is invisible in the
 * shipped bytes. Two exclusions are counted rather than absorbed: features whose
 * clip is duplicated along a shared cell edge (see `clipSegmentToRect`), and
 * quantization, which is a separate and much larger residual reported in full.
 */
const LENGTH_RESIDUAL_TOLERANCE_ABSOLUTE_DEGREES = GROUND_COORDINATE_STEP;
const LENGTH_RESIDUAL_TOLERANCE_RELATIVE = 1e-6;

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

function repoRoot() {
  return resolve(dirname(new URL(import.meta.url).pathname), "..");
}

function relativeToRepo(path) {
  return relative(repoRoot(), resolve(path));
}

/** Every regular file under a root, as POSIX-relative references. */
function listFiles(root, prefix = "") {
  const out = [];
  let entries;
  try {
    entries = readdirSync(join(root, prefix), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const reference = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listFiles(root, reference));
    else out.push(reference);
  }
  return out;
}

/** Total bytes of every regular file under a root. */
function directoryBytes(root) {
  return listFiles(root).reduce((sum, reference) => sum + statSync(join(root, reference)).size, 0);
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

function sourceRef(sourceRecordId) {
  return {
    schemaVersion: "1.0",
    id: `${CURB_SOURCE.registryEntryId}:${CURB_SOURCE.datasetId}:${sourceRecordId}`,
    registryEntryId: CURB_SOURCE.registryEntryId,
    provider: CURB_SOURCE.provider,
    datasetId: CURB_SOURCE.datasetId,
    sourceRecordId,
    sourceUrl: CURB_SOURCE.sourceUrl,
    licenseRefId: "nyc-open-data-terms",
    role: "primary",
    capturedAt: CURB_SOURCE.capturedAt,
    updatedAt: CURB_SOURCE.sourceUpdatedAt,
    observedAt: CURB_SOURCE.capturedAt,
    release: null,
  };
}

/**
 * The ownership cells, obtained from the contract rather than restated.
 *
 * A featureless skeleton ledger is built purely to read the authoritative cell
 * id spelling back through the exported `groundCellTileKey`, exactly as the T006
 * builder does.
 */
function partitionCells() {
  const identity = {
    cityId: MANHATTAN_GROUND_CITY_ID,
    configId: MANHATTAN_GROUND_CONFIG_ID,
    partitionSchemeId: GROUND_PARTITION_SCHEME_ID,
    extent: MANHATTAN_GROUND_EXTENT,
    baseIdentitySetId: BASE_IDENTITY_SET_ID,
  };
  const skeleton = buildGroundOwnershipLedger({ ...identity, features: [], occupancy: [] });
  const cells = skeleton.ledger.cells.map((cell) => {
    const tile = groundCellTileKey(cell.cellId);
    return { cellId: cell.cellId, id: cell.cellId, order: cell.order, tileKey: tileKeyString(tile), bounds: tileBounds(tile) };
  });
  return { identity, coverage: skeleton.ledger.coverage, cells };
}

/**
 * Verifies the pinned inputs before a single byte of them is used.
 *
 * Two checksums, both required: the acquisition manifest against the pin in this
 * file, and the page against the pin in that manifest. Either alone is a chain
 * with a loose end.
 */
function readPavementEdgeSource() {
  const manifestBytes = readFileSync(VECTOR_MANIFEST);
  const manifestSha256 = sha256(manifestBytes);
  assert(
    manifestSha256 === VECTOR_MANIFEST_SHA256,
    `The T003 acquisition manifest does not match its pin: measured ${manifestSha256}, pinned ${VECTOR_MANIFEST_SHA256}. This build reads no source it cannot anchor.`,
  );
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  assert(manifest.approval?.evidenceId === VECTOR_APPROVAL, "The T003 acquisition manifest does not carry the approval this release is built under.");
  const snapshot = manifest.sourceSnapshots.find((entry) => entry.datasetId === CURB_SOURCE.datasetId);
  assert(snapshot, `The T003 acquisition manifest does not describe ${CURB_SOURCE.datasetId}.`);
  assert(snapshot.pageCount === 1 && snapshot.pages.length === 1, `${CURB_SOURCE.datasetId} is paginated; this build reads exactly one page.`);

  const raw = readFileSync(CURB_SOURCE.page, "utf8");
  const pageSha256 = sha256(raw);
  assert(
    pageSha256 === snapshot.pages[0].sha256,
    `The retained ${CURB_SOURCE.datasetId} page does not match its acquisition manifest: measured ${pageSha256}, declared ${snapshot.pages[0].sha256}.`,
  );
  const parsed = JSON.parse(raw);
  assert(Array.isArray(parsed.features), `Source ${CURB_SOURCE.datasetId} did not parse to a GeoJSON FeatureCollection.`);
  assert(
    parsed.features.length === snapshot.featureCount && parsed.features.length === CURB_SOURCE.expectedFeatures,
    `Source ${CURB_SOURCE.datasetId} holds ${parsed.features.length} features; the manifest declares ${snapshot.featureCount} and this build expects ${CURB_SOURCE.expectedFeatures}.`,
  );

  const rows = parsed.features;
  const features = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    rows[index] = null; // Release the parsed source progressively; this page is ~126 MB.
    const geometry = row.geometry;
    assert(geometry && geometry.type === "MultiLineString", `Source ${CURB_SOURCE.datasetId} row ${index} is not a MultiLineString.`);
    const properties = row.properties ?? {};
    const recordId = properties[CURB_SOURCE.recordIdField];
    assert(
      recordId !== undefined && recordId !== null && String(recordId).trim().length > 0,
      `Source ${CURB_SOURCE.datasetId} row ${index} has no ${CURB_SOURCE.recordIdField}.`,
    );
    features.push({ sourceRecordId: String(recordId), properties, lines: geometry.coordinates });
  }
  return {
    features,
    pageSha256,
    manifestSha256,
    rawBytes: Buffer.byteLength(raw),
    manifestFeatureCount: manifest.sourceSnapshots.reduce((sum, entry) => sum + entry.featureCount, 0),
  };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function build(values) {
  const generatedAt = values["generated-at"];
  assert(
    typeof generatedAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(generatedAt) && new Date(generatedAt).toISOString() === generatedAt,
    "--generated-at is required and must be a canonical ISO-8601 UTC timestamp with milliseconds, e.g. 2026-08-25T00:00:00.000Z. Determinism is not negotiable, so the clock is never read.",
  );
  const root = repoRoot();
  const releaseRoot = resolve(root, String(values["release-root"] ?? `public/data/${RELEASE_ID}`));
  const workRoot = resolve(root, String(values["work-root"] ?? `data/generated/${RELEASE_ID}`));

  if (values.replace === true || values.replace === "true") {
    rmSync(releaseRoot, { recursive: true, force: true });
    rmSync(workRoot, { recursive: true, force: true });
  }

  const { identity, coverage, cells } = partitionCells();
  const cellById = new Map(cells.map((cell) => [cell.cellId, cell]));
  assert(cells.length === EXPECTED_CELL_COUNT, `The ground partition produced ${cells.length} cells; the Manhattan extent tiles to ${EXPECTED_CELL_COUNT}.`);

  const source = readPavementEdgeSource();
  const allFeatures = [];
  const allOccupancy = [];
  const refusals = [];
  const partsByCell = new Map();
  const cellPartCensus = new Map(cells.map((cell) => [cell.cellId, 0]));
  const mintedIds = new Map();
  const writtenPartIds = new Set();

  let clippedFeatures = 0;
  let passthroughFeatures = 0;
  let clipDroppedCandidateCells = 0;
  let boundaryCoincidentParts = 0;
  let boundaryDuplicatedFeatures = 0;
  let boundaryDuplicatedL1Length = 0;
  let maxLengthResidualAbsolute = 0;
  let worstLengthResidualAbsoluteFeature = null;
  let maxLengthResidualRelative = 0;
  let worstLengthResidualRelativeFeature = null;
  let maxQuantizationResidual = 0;
  let worstQuantizationResidualFeature = null;
  const quantizationResiduals = [];
  let maxCellExcursionDegrees = 0;
  let sourceBounds = { ...coverage };
  let shippedVertexCount = 0;

  for (const feature of source.features) {
    const derived = deriveCurb("manhattan", feature, cells);
    sourceBounds = {
      west: Math.min(sourceBounds.west, derived.sourceBounds.west),
      south: Math.min(sourceBounds.south, derived.sourceBounds.south),
      east: Math.max(sourceBounds.east, derived.sourceBounds.east),
      north: Math.max(sourceBounds.north, derived.sourceBounds.north),
    };

    const previous = mintedIds.get(derived.canonicalFeatureId);
    assert(
      previous === undefined,
      `Content-addressed identity collision in ${EMBELLISHMENT_CLASS}: ${derived.canonicalFeatureId} is claimed by source records ${previous} and ${feature.sourceRecordId}. A collision is a hard failure, never a merge.`,
    );
    mintedIds.set(derived.canonicalFeatureId, feature.sourceRecordId);
    clipDroppedCandidateCells += derived.droppedCandidateRects;

    if (derived.parts.length === 0) {
      // Either the linework reached no cell of the declared coverage, or every
      // share rounded below two distinct vertices. Both are refusals with the
      // identity and the measurements kept: a feature that vanishes without a
      // record is indistinguishable from a bug.
      refusals.push({
        canonicalFeatureId: derived.canonicalFeatureId,
        class: EMBELLISHMENT_CLASS,
        datasetId: CURB_SOURCE.datasetId,
        sourceRecordId: feature.sourceRecordId,
        reason: "no-representable-share-in-any-cell",
        detail: `The source alignment either reached no ownership cell of the declared coverage or collapsed below two distinct vertices in every cell when rounded to ${GROUND_COORDINATE_DECIMALS} decimal degrees. It is retained verbatim in the pinned raw snapshot and is recoverable from it.`,
        sourceL1LengthDegrees: derived.sourceL1Length,
        sourceBoundingBox: derived.sourceBounds,
        sourceProperties: feature.properties,
      });
      continue;
    }

    const anyClipped = derived.parts.some((part) => part.clipped);
    if (anyClipped) clippedFeatures += 1;
    else passthroughFeatures += 1;

    const duplicated = derived.parts.some((part) => part.boundaryCoincident);
    if (duplicated) {
      boundaryDuplicatedFeatures += 1;
      boundaryDuplicatedL1Length += derived.parts.filter((part) => part.boundaryCoincident).reduce((total, part) => total + part.clippedL1Length, 0);
    } else if (anyClipped) {
      // Clip conservation, measured on unquantized coordinates and only where
      // the shared-edge duplication cannot inflate the sum.
      const inCoverage = multiLineStringL1Length(clipMultiLineStringToRect(feature.lines, coverage));
      if (inCoverage > 0) {
        const partsLength = derived.parts.reduce((total, part) => total + part.clippedL1Length, 0);
        const absolute = Math.abs(partsLength - inCoverage);
        if (absolute > maxLengthResidualAbsolute) {
          maxLengthResidualAbsolute = absolute;
          worstLengthResidualAbsoluteFeature = derived.canonicalFeatureId;
        }
        const relative = absolute / inCoverage;
        if (relative > maxLengthResidualRelative) {
          maxLengthResidualRelative = relative;
          worstLengthResidualRelativeFeature = derived.canonicalFeatureId;
        }
      }
    }

    let clippedLength = 0;
    let quantizedLength = 0;
    const materializedTileKeys = [];
    for (const part of derived.parts) {
      const cell = cellById.get(part.rectId);
      assert(cell, `Derived part names cell ${part.rectId}, which is not in the partition.`);
      clippedLength += part.clippedL1Length;
      quantizedLength += part.quantizedL1Length;
      if (part.boundaryCoincident) boundaryCoincidentParts += 1;

      for (const line of part.lines) {
        for (const position of line) {
          shippedVertexCount += 1;
          const excursion = Math.max(
            cell.bounds.west - position[0],
            position[0] - cell.bounds.east,
            cell.bounds.south - position[1],
            position[1] - cell.bounds.north,
          );
          if (excursion > maxCellExcursionDegrees) maxCellExcursionDegrees = excursion;
          // Rounding can push a boundary vertex outward by at most half a step.
          // Anything larger means linework escaped the cell that owns it, which
          // is a partition defect and not a precision effect.
          assert(
            excursion <= GROUND_COORDINATE_STEP,
            `Part ${groundPartId(derived.canonicalFeatureId, cell.cellId)} extends ${excursion} degrees beyond cell ${cell.cellId}, more than the ${GROUND_COORDINATE_STEP} rounding step. Shipped geometry must stay inside the cell that owns it.`,
          );
        }
      }

      const partId = groundPartId(derived.canonicalFeatureId, cell.cellId);
      assert(!writtenPartIds.has(partId), `Part ${partId} was materialized twice; a cell may own a feature's share exactly once.`);
      writtenPartIds.add(partId);
      const bucket = partsByCell.get(cell.cellId) ?? [];
      bucket.push({
        partId,
        canonicalFeatureId: derived.canonicalFeatureId,
        clipped: part.clipped,
        boundaryCoincident: part.boundaryCoincident,
        sourceProperties: feature.properties,
        geometry: { type: "MultiLineString", coordinates: part.lines },
      });
      partsByCell.set(cell.cellId, bucket);
      cellPartCensus.set(cell.cellId, (cellPartCensus.get(cell.cellId) ?? 0) + 1);
      materializedTileKeys.push(cell.tileKey);
    }

    if (clippedLength > 0) {
      const residual = Math.abs(quantizedLength - clippedLength) / clippedLength;
      quantizationResiduals.push(residual);
      if (residual > maxQuantizationResidual) {
        maxQuantizationResidual = residual;
        worstQuantizationResidualFeature = derived.canonicalFeatureId;
      }
    }

    allFeatures.push({
      canonicalFeatureId: derived.canonicalFeatureId,
      cityId: MANHATTAN_GROUND_CITY_ID,
      class: EMBELLISHMENT_CLASS,
      claimLevel: derived.claimLevel,
      sourceRefs: [sourceRef(feature.sourceRecordId)],
      uncertainty: { horizontalMeters: CURB_UNCERTAINTY.horizontalMeters, verticalMeters: CURB_UNCERTAINTY.verticalMeters, temporal: CURB_SOURCE.temporal },
      identityOrigin: { kind: "ground-owned" },
    });
    allOccupancy.push({ canonicalFeatureId: derived.canonicalFeatureId, occupancy: { kind: "declared-cells", tileKeys: sortGroundIds(new Set(materializedTileKeys)) } });
  }

  assert(
    maxLengthResidualAbsolute <= LENGTH_RESIDUAL_TOLERANCE_ABSOLUTE_DEGREES,
    `Absolute clip length residual ${maxLengthResidualAbsolute} L1 degrees exceeds the bar ${LENGTH_RESIDUAL_TOLERANCE_ABSOLUTE_DEGREES} (one quantization step) at feature ${worstLengthResidualAbsoluteFeature}. The build fails closed rather than raising a bar after seeing the measurement.`,
  );
  assert(
    maxLengthResidualRelative <= LENGTH_RESIDUAL_TOLERANCE_RELATIVE,
    `Relative clip length residual ${maxLengthResidualRelative} exceeds the bar ${LENGTH_RESIDUAL_TOLERANCE_RELATIVE} at feature ${worstLengthResidualRelativeFeature}. The build fails closed rather than raising a bar after seeing the measurement.`,
  );

  // Artifacts, one per cell that genuinely holds curb linework.
  const assets = [];
  const artifactBytes = [];
  const artifactSizes = [];
  for (const cell of cells) {
    const parts = partsByCell.get(cell.cellId);
    if (!parts || parts.length === 0) continue;
    parts.sort((left, right) => compareGroundIds(left.partId, right.partId));
    const relativeRef = `artifacts/${cell.cellId}/${EMBELLISHMENT_CLASS}.json`;
    const written = writeDocument(join(releaseRoot, relativeRef), {
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      releaseId: RELEASE_ID,
      cellId: cell.cellId,
      cellBounds: cell.bounds,
      class: EMBELLISHMENT_CLASS,
      claimLevel: "estimated",
      coordinateDecimals: GROUND_COORDINATE_DECIMALS,
      derivation: {
        algorithm: CURB_DERIVATION_ALGORITHM,
        inputDataset: CURB_INPUT_DATASET_ID,
        profile: CURB_VERTICAL_PROFILE,
        note: "Geometry is the source pavement-edge alignment, clipped to this cell and rounded to the declared precision. No curb solid is baked here: a renderer extrudes the declared profile from this alignment, so the estimate stays labelled as one.",
      },
      partCount: parts.length,
      parts,
    });
    artifactBytes.push(written.bytes);
    artifactSizes.push({ cellId: cell.cellId, bytes: written.bytes, parts: parts.length });
    const tiers = [
      {
        tierId: `${cell.cellId}:${EMBELLISHMENT_CLASS}:near-3d`,
        kind: "near-3d",
        maxDistanceMeters: GROUND_EMBELLISHMENT_NEAR_TIER_MAX_DISTANCE_METERS,
        artifactRef: relativeRef,
        checksumSha256: written.sha256,
      },
    ];
    assets.push({
      assetId: `ground-asset:${cell.cellId}:${EMBELLISHMENT_CLASS}`,
      cellId: cell.cellId,
      class: EMBELLISHMENT_CLASS,
      tiers,
      contentSha256: groundAssetContentSha256(tiers),
    });
  }

  const totalArtifactBytes = artifactBytes.reduce((sum, value) => sum + value, 0);
  // Fail fast on the artifacts alone, before the documents are written, so an
  // over-budget build leaves as little behind as possible. The whole-root check
  // below is the one that actually bounds what a consumer must host.
  assert(
    totalArtifactBytes <= TOTAL_ARTIFACT_BYTE_CEILING,
    `Curb artifacts total ${totalArtifactBytes} bytes, over the CITYWIDE_BUDGETS.totalBytes ceiling of ${TOTAL_ARTIFACT_BYTE_CEILING}.`,
  );

  const built = buildGroundOwnershipLedger({ ...identity, features: allFeatures, occupancy: allOccupancy });
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
      ? "No source feature was refused: every pavement-edge feature in the cited snapshot survived clipping and rounding with representable linework, and the refusal record is empty."
      : `${refusals.length} source feature${refusals.length === 1 ? " was" : "s were"} refused a place in this release because ${refusals.length === 1 ? "its" : "their"} alignment reached no ownership cell or collapsed below two distinct vertices at ${GROUND_COORDINATE_DECIMALS} decimal degrees. Each refusal is recorded in full, with its measurements, in the build report and in refusals.json; none is dropped silently, and every one remains verbatim in the pinned raw snapshot.`;

  const document = {
    schemaVersion: GROUND_RELEASE_SCHEMA_VERSION,
    releaseId: RELEASE_ID,
    cityId: MANHATTAN_GROUND_CITY_ID,
    configId: MANHATTAN_GROUND_CONFIG_ID,
    partitionSchemeId: GROUND_PARTITION_SCHEME_ID,
    ownershipLedgerId: built.ledger.ledgerId,
    generatedAt,
    immutable: true,
    sourceSnapshots: [
      {
        datasetId: CURB_SOURCE.datasetId,
        mappedViewId: CURB_SOURCE.mappedViewId,
        rawSha256: source.pageSha256,
        sourceFeatureCount: source.features.length,
      },
      {
        // The acquisition manifest itself, pinned by content. It is what makes
        // the page checksum above verifiable, and citing the page without it
        // would leave the chain of custody with a loose end.
        datasetId: "manifest:citywide-public-realm-20260824",
        mappedViewId: null,
        rawSha256: source.manifestSha256,
        sourceFeatureCount: source.manifestFeatureCount,
      },
    ].sort((left, right) => compareGroundIds(left.rawSha256, right.rawSha256)),
    clip: {
      sourceExtent: sourceBounds,
      clipBounds: coverage,
      bufferMeters: 0,
      rule: `Each source pavement-edge feature is assigned to every ownership cell whose rectangle its linework genuinely reaches. A feature whose envelope fits inside one cell passes through unclipped; a feature spanning several is cut per cell by Liang-Barsky against the axis-aligned cell rectangle, ported from the ingestion route-graph clipper. Clipping is boundary-INCLUSIVE and the surviving pieces are never joined across a gap: a line that leaves a cell and returns yields two pieces rather than one with an invented connector. A piece running exactly along a shared cell edge is therefore retained by BOTH neighbouring cells, which is measured (boundaryCoincidentParts) and disclosed rather than resolved by a tie-break — a line has no interior with which to decide which side owns it. The buffer is exactly zero.`,
    },
    geometryValidation: {
      method: `This release ships LINEWORK, and the schema's shared area fields carry the LENGTH residual; the schema is common to every ground release and does not gain a field for one of them, so the meaning is stated here rather than implied. Lengths are L1 (taxicab) sums in degrees, used only for ratios: clipping splits a segment at a point on the segment, along which x and y are each monotone, so L1 is exactly additive across the split, while Math.sqrt is implementation-approximated in ECMA-262 and would put an engine-dependent number into a recorded measurement. No projection is applied and no metre is claimed. The reported residual is the CLIP residual: for every multi-cell feature, the difference between the sum of its per-cell pieces and the same line clipped to the coverage rectangle, on unquantized coordinates. TWO bars are enforced and the ABSOLUTE one is operative: the per-feature absolute residual must not exceed ${LENGTH_RESIDUAL_TOLERANCE_ABSOLUTE_DEGREES} L1 degrees, one quantization step (~1.1 cm), derived by reference to the shipped precision rather than fitted to any measurement; the largest observed was ${maxLengthResidualAbsolute}. Features whose clip is duplicated along a shared cell edge are EXCLUDED from the residual and counted separately (boundaryDuplicatedFeatures), because the duplication is a disclosed property of a boundary-inclusive line clip and would otherwise be reported as clipper error. Shipped coordinates are ADDITIONALLY rounded to ${GROUND_COORDINATE_DECIMALS} decimal degrees (~1.1 cm), a separate residual that neither figure measures; it is measured in full in the build report under quantizationResidual and disclosed in provenance.disclaimer.`,
      areaResidualToleranceRelative: LENGTH_RESIDUAL_TOLERANCE_RELATIVE,
      maxObservedRelativeAreaError: maxLengthResidualRelative,
      status: "pass",
    },
    assets: [...assets].sort((left, right) => compareGroundIds(left.assetId, right.assetId)),
    claimCeilings: CLAIM_CEILINGS,
    zoneImagery: null,
    provenance: {
      sourceEpoch:
        "NYC OTI Planimetrics Pavement Edge rows updated 2024-04-26T20:48:18Z; local snapshot captured 2026-08-24T02:41:06Z as part of the T003 vector acquisition. No source was re-acquired for this release.",
      termsUrl: NYC_TERMS_URL,
      attribution: `Source: NYC Office of Technology and Innovation (OTI), NYC Planimetric Database: Pavement Edge (${CURB_SOURCE.datasetId}), accessed through NYC Open Data. Built under ${VECTOR_APPROVAL}, which this release does not widen: the snapshot is local-only, is not redistributed, and no new data was acquired. Contains information from NYC Open Data, modified by this project through clipping to ownership cells, rounding to ${GROUND_COORDINATE_DECIMALS} decimal degrees, and reinterpretation as estimated curb alignment.`,
      disclaimer: `NYC Open Data is provided for informational purposes and may be updated, corrected, or discontinued; no warranty of completeness, accuracy, content, or fitness is made. This release makes six disclosures, none of which should be read as a claim of full coverage. (1) A curb here is an ESTIMATE constrained by pavement edge, not a surveyed curb. Pavement edge is the edge of paving the source recorded; the ${CURB_VERTICAL_PROFILE.authoredRiseMeters} m rise and the flat roadbed reference at ${CURB_VERTICAL_PROFILE.roadbedElevationMeters} m are authored, are identical everywhere, and are not measured anywhere. (2) NO CROSSWALK is derived, materialized, or claimed. The Block 835 release derives four crosswalks from a hand-named four-corner intersection model; citywide there is no intersection ground truth in any retained snapshot, and auto-detecting crossings from roadbed and pavement-edge geometry would put thousands of estimated crossings on the map with nothing behind them. Whether to acquire an intersection or crossing source is an open user decision, deliberately left open by this release rather than answered by inference. (3) The T003 acquisition used Socrata within_box(), which is fully-contained rather than intersects, so features crossing the clip rectangle's edge were excluded server-side: ${PAVEMENT_EDGE_STRADDLERS_EXCLUDED} pavement-edge features are absent from the snapshot this release is derived from, and are therefore absent from the curbs here. The same acquisition excluded ${SIDEWALK_STRADDLERS_EXCLUDED} sidewalk straddlers, which matters here because sidewalk and curb bound the same ground: the flat sidewalk release and this curb release share that gap at the clip edge. Both counts are the T003 manifest's own measurements, re-disclosed rather than re-derived. (4) The clip rectangle is a rectangular working envelope, not the Manhattan borough boundary; adjacent-borough and New Jersey linework inside it is retained honestly rather than filtered out, and no borough-membership claim is made. (5) Coordinates are rounded to ${GROUND_COORDINATE_DECIMALS} decimal degrees, about 1.1 cm. This is a disclosed lossy step. A piece running exactly along a shared cell edge is retained by both neighbouring cells, so a renderer that draws two adjacent cells will draw that curb twice; ownership of the FEATURE is exactly-once regardless, and the duplication is counted in the build report. (6) ${refusalDisclosure}`,
      localOnly: true,
      runtimeExternalNetwork: false,
    },
    fallback: `Every asset in this release declares near-3d tiers only, with a finite ${GROUND_EMBELLISHMENT_NEAR_TIER_MAX_DISTANCE_METERS} m distance and no flat tier, because a curb is additive over a base that already covers the ground. A consumer that cannot load, verify, or afford a curb artifact draws the flat cartographic base of manhattan-ground-20260824 alone: the embellishment is absent and nothing else changes. That release is not modified, not re-derived, and not required to change by this one.`,
  };

  const graph = { ledger: built.ledger, document, features: allFeatures.sort((left, right) => compareGroundIds(left.canonicalFeatureId, right.canonicalFeatureId)), parts: built.parts };
  const validation = validateGroundReleaseGraph(graph);
  assert(
    validation.ok,
    `The built embellishment release fails its own T005 contract: ${validation.ok ? "" : validation.issues.map((entry) => `${entry.path}: ${entry.message}`).join("; ")}`,
  );

  const releaseWrite = writeDocument(join(releaseRoot, "release.json"), document);
  const ledgerWrite = writeDocument(join(releaseRoot, "ledger.json"), built.ledger);
  const featuresWrite = writeDocument(join(releaseRoot, "features.json"), graph.features);
  const partsWrite = writeDocument(join(releaseRoot, "parts.json"), built.parts);

  const totalReleaseBytes = directoryBytes(releaseRoot);
  assert(
    totalReleaseBytes <= TOTAL_ARTIFACT_BYTE_CEILING,
    `The release root totals ${totalReleaseBytes} bytes, over the CITYWIDE_BUDGETS.totalBytes ceiling of ${TOTAL_ARTIFACT_BYTE_CEILING}. Artifacts alone were ${totalArtifactBytes}; the identity documents are the rest.`,
  );

  const cellsWithCurbs = artifactSizes.length;
  const buildReport = {
    schemaVersion: BUILD_REPORT_SCHEMA_VERSION,
    releaseId: RELEASE_ID,
    generatedAt,
    ledgerId: built.ledger.ledgerId,
    coverage,
    sourceExtent: sourceBounds,
    cellCount: cells.length,
    cellsWithCurbs,
    cellsWithoutCurbs: cells.length - cellsWithCurbs,
    featureCount: graph.features.length,
    partCount: built.parts.length,
    assetCount: assets.length,
    refusedFeatureCount: refusals.length,
    refusals,
    shippedVertexCount,
    source: {
      datasetId: CURB_SOURCE.datasetId,
      mappedViewId: CURB_SOURCE.mappedViewId,
      readFrom: relativeToRepo(CURB_SOURCE.page),
      rawBytes: source.rawBytes,
      pageSha256: source.pageSha256,
      acquisitionManifest: relativeToRepo(VECTOR_MANIFEST),
      acquisitionManifestSha256: source.manifestSha256,
      sourceFeatures: source.features.length,
    },
    clipping: {
      passthroughFeatures,
      clippedFeatures,
      clipDroppedCandidateCells,
      boundaryCoincidentParts,
      boundaryDuplicatedFeatures,
      boundaryDuplicatedL1LengthDegrees: boundaryDuplicatedL1Length,
      note: "passthroughFeatures fit inside a single cell and were not clipped. clipDroppedCandidateCells counts cells whose envelope overlapped but whose rectangle the linework never reached, which a bbox prefilter is meant to over-select. boundaryCoincidentParts are pieces lying exactly along a shared cell edge and therefore held by both neighbours.",
    },
    identityCollisions: source.features.length - mintedIds.size,
    lengthResidual: {
      note: "Clip conservation on unquantized coordinates, in L1 degrees, excluding features duplicated along a shared cell edge. The absolute bar is the operative gate and is one quantization step, derived by reference to the shipped precision.",
      absoluteToleranceDegrees: LENGTH_RESIDUAL_TOLERANCE_ABSOLUTE_DEGREES,
      maxObservedAbsoluteDegrees: maxLengthResidualAbsolute,
      worstAbsoluteFeature: worstLengthResidualAbsoluteFeature,
      relativeTolerance: LENGTH_RESIDUAL_TOLERANCE_RELATIVE,
      maxObservedRelative: maxLengthResidualRelative,
      worstRelativeFeature: worstLengthResidualRelativeFeature,
    },
    quantizationResidual: {
      note: "Relative L1 length change from rounding shipped coordinates to 7 decimal degrees, per feature across all of its parts. Reported, not gated: it is a property of the disclosed precision choice, not a defect. A short segment loses a larger fraction than a long one, so the tail is made of source slivers.",
      maxObserved: maxQuantizationResidual,
      worstFeature: worstQuantizationResidualFeature,
      distribution: distribution(quantizationResiduals),
      featuresOverOnePercent: quantizationResiduals.filter((value) => value > 0.01).length,
      featuresOverTenPercent: quantizationResiduals.filter((value) => value > 0.1).length,
    },
    maxCellExcursionDegrees,
    quantizationStepDegrees: GROUND_COORDINATE_STEP,
    budget: {
      note: "Ceilings are referenced from CITYWIDE_BUDGETS, never restated. totalBytes is the gate; geometryShardBytes is a yardstick this build reports against and does not enforce, because no per-cell embellishment serving ceiling has been measured yet.",
      totalArtifactBytes,
      totalReleaseBytes,
      totalArtifactByteCeiling: TOTAL_ARTIFACT_BYTE_CEILING,
      totalReleaseByteHeadroom: TOTAL_ARTIFACT_BYTE_CEILING - totalReleaseBytes,
      perArtifactReferenceBytes: PER_ARTIFACT_REFERENCE_BYTES,
      artifactsOverPerArtifactReference: artifactSizes.filter((entry) => entry.bytes > PER_ARTIFACT_REFERENCE_BYTES).map((entry) => entry.cellId),
      artifactBytes: distribution(artifactBytes),
      largestArtifacts: [...artifactSizes].sort((left, right) => right.bytes - left.bytes).slice(0, 5),
    },
    releaseFiles: {
      "release.json": releaseWrite,
      "ledger.json": ledgerWrite,
      "features.json": featuresWrite,
      "parts.json": partsWrite,
    },
  };

  writeDocument(join(workRoot, "build-report.json"), buildReport);
  writeDocument(join(workRoot, "refusals.json"), {
    schemaVersion: "manhattan-ground-embellishment-refusals-1",
    releaseId: RELEASE_ID,
    note: "Source features that reached the materializer and were refused a place in the release, each with the reason and the measurements the refusal rests on. An empty list means nothing was refused; it never means nothing was checked.",
    refusedFeatureCount: refusals.length,
    refusals,
  });
  writeDocument(join(workRoot, "cell-curb-census.json"), {
    schemaVersion: "manhattan-ground-embellishment-cell-census-1",
    releaseId: RELEASE_ID,
    note: "Curb parts per ownership cell. A zero means no pavement-edge feature reached that cell — open water, the New Jersey margin, or park interior — not that the ground there has no kerb.",
    cells: cells.map((cell) => ({ cellId: cell.cellId, order: cell.order, bounds: cell.bounds, curbParts: cellPartCensus.get(cell.cellId) ?? 0 })),
  });

  console.log(
    JSON.stringify(
      {
        built: true,
        releaseRoot: relative(root, releaseRoot),
        workRoot: relative(root, workRoot),
        ledgerId: built.ledger.ledgerId,
        featureCount: graph.features.length,
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
// Validate
// ---------------------------------------------------------------------------

/**
 * Fail-closed validation of a materialized embellishment release.
 *
 * Mirrors `validate-manhattan-ground-release.mjs` — the T005 contract is
 * imported and run, never restated — and adds what a document validator cannot
 * see: the bytes on disk, the near-tier obligations of an embellishment release,
 * and the budget the build claimed to respect.
 */
function validate(values) {
  const root = repoRoot();
  const releaseRoot = resolve(root, String(values["release-root"] ?? `public/data/${RELEASE_ID}`));

  const document = readJson(join(releaseRoot, "release.json"));
  const ledger = readJson(join(releaseRoot, "ledger.json"));
  const features = readJson(join(releaseRoot, "features.json"));
  const parts = readJson(join(releaseRoot, "parts.json"));

  // 1. The T005 contract, imported.
  const graph = validateGroundReleaseGraph({ ledger, document, features, parts });
  assert(
    graph.ok,
    `Embellishment release graph failed the T005 contract: ${graph.ok ? "" : graph.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`,
  );

  // 2. Identity, and the invariants an EMBELLISHMENT release must hold.
  assert(document.releaseId === RELEASE_ID, `Unexpected embellishment release id ${document.releaseId}.`);
  assert(document.cityId === MANHATTAN_GROUND_CITY_ID && document.configId === MANHATTAN_GROUND_CONFIG_ID, "Release city or configuration identity does not match the Manhattan constants.");
  assert(document.partitionSchemeId === GROUND_PARTITION_SCHEME_ID, "Release partition scheme does not match the pinned scheme.");
  assert(ledger.cells.length === EXPECTED_CELL_COUNT, `Ledger declares ${ledger.cells.length} cells; the Manhattan extent tiles to ${EXPECTED_CELL_COUNT}.`);
  assert(document.immutable === true && ledger.immutable === true, "Release and ledger must both declare immutability.");
  assert(document.provenance.localOnly === true && document.provenance.runtimeExternalNetwork === false, "This release is local-only and must not declare runtime external network use.");
  for (const feature of features) {
    assert(feature.claimLevel === "estimated", `Feature ${feature.canonicalFeatureId} claims ${feature.claimLevel}; every embellishment is estimated.`);
    assert(GROUND_EMBELLISHMENT_CLASSES.includes(feature.class), `Feature ${feature.canonicalFeatureId} ships class ${feature.class}, which is not an embellishment class.`);
    assert(feature.class !== "crosswalk", "This release derives no crosswalk; a crosswalk feature here is a scope breach.");
  }
  for (const asset of document.assets) {
    assert(GROUND_EMBELLISHMENT_CLASSES.includes(asset.class), `Asset ${asset.assetId} ships class ${asset.class}, which is not an embellishment class. Flat base classes belong to manhattan-ground-20260824.`);
    assert(asset.class !== "crosswalk", "This release ships no crosswalk asset; curbs only.");
    assert(typeof document.claimCeilings[asset.class] === "string" && document.claimCeilings[asset.class].length > 0, `Shipped class ${asset.class} has no claim ceiling.`);
    assert(asset.tiers.length >= 1 && asset.tiers.every((tier) => tier.kind === "near-3d"), `Asset ${asset.assetId} declares a non-near-3d tier; an embellishment must never carry the always-covering flat tier.`);
    assert(
      asset.tiers.every((tier) => tier.maxDistanceMeters === GROUND_EMBELLISHMENT_NEAR_TIER_MAX_DISTANCE_METERS),
      `Asset ${asset.assetId} declares a near-tier distance other than the ${GROUND_EMBELLISHMENT_NEAR_TIER_MAX_DISTANCE_METERS} m exterior near ring this release is pinned to.`,
    );
  }

  // 3. Rebuild the ownership ledger from the published identity set.
  const occupancyByFeature = new Map();
  const cellById = new Map(ledger.cells.map((cell) => [cell.cellId, cell]));
  for (const part of parts) {
    const cell = cellById.get(part.ownerCellId);
    assert(cell, `Part ${part.partId} names cell ${part.ownerCellId}, which is not in the ledger.`);
    const bucket = occupancyByFeature.get(part.canonicalFeatureId) ?? [];
    bucket.push(tileKeyString(groundCellTileKey(part.ownerCellId)));
    occupancyByFeature.set(part.canonicalFeatureId, bucket);
  }
  const rebuilt = buildGroundOwnershipLedger({
    cityId: MANHATTAN_GROUND_CITY_ID,
    configId: MANHATTAN_GROUND_CONFIG_ID,
    partitionSchemeId: GROUND_PARTITION_SCHEME_ID,
    extent: MANHATTAN_GROUND_EXTENT,
    baseIdentitySetId: ledger.baseIdentitySet.id,
    features,
    occupancy: [...occupancyByFeature].map(([canonicalFeatureId, tileKeys]) => ({
      canonicalFeatureId,
      occupancy: { kind: "declared-cells", tileKeys: sortGroundIds(new Set(tileKeys)) },
    })),
  });
  assert(
    rebuilt.ledger.ledgerId === ledger.ledgerId,
    `The ownership ledger does not follow from its own features and parts: rebuilt ${rebuilt.ledger.ledgerId}, declared ${ledger.ledgerId}.`,
  );
  assert(document.ownershipLedgerId === ledger.ledgerId, "The release document does not pin the ledger it ships beside.");

  // 4. Declared artifacts against the bytes on disk, and the tree against the declarations.
  const declaredRefs = new Map();
  for (const asset of document.assets) {
    assert(asset.contentSha256 === groundAssetContentSha256(asset.tiers), `Asset ${asset.assetId} content digest does not match its declared tiers.`);
    for (const tier of asset.tiers) {
      assert(!declaredRefs.has(tier.artifactRef), `Artifact ${tier.artifactRef} is claimed by more than one tier.`);
      declaredRefs.set(tier.artifactRef, { asset, tier });
    }
  }
  const onDisk = listFiles(releaseRoot).filter((reference) => reference.startsWith("artifacts/"));
  const declaredSet = new Set(declaredRefs.keys());
  for (const reference of onDisk) {
    assert(declaredSet.has(reference), `Undeclared file inside the checksum-pinned release root: ${reference}.`);
  }
  assert(onDisk.length === declaredSet.size, `The artifact tree holds ${onDisk.length} files but ${declaredSet.size} are declared.`);

  // 5. Content: checksums, exactly-once ownership, precision, containment.
  const seenParts = new Map();
  const partById = new Map(parts.map((part) => [part.partId, part]));
  let coordinateCount = 0;
  let maxExcursion = 0;
  let totalArtifactBytes = 0;
  let boundaryCoincidentParts = 0;
  const artifactBytes = [];

  for (const [reference, { asset, tier }] of [...declaredRefs].sort((left, right) => (left[0] < right[0] ? -1 : 1))) {
    const bytes = readFileSync(join(releaseRoot, reference));
    totalArtifactBytes += bytes.byteLength;
    artifactBytes.push(bytes.byteLength);
    assert(sha256(bytes) === tier.checksumSha256, `Artifact checksum mismatch: ${reference}.`);
    const artifact = JSON.parse(bytes.toString("utf8"));
    assert(artifact.schemaVersion === ARTIFACT_SCHEMA_VERSION, `Unsupported artifact schema in ${reference}.`);
    assert(artifact.releaseId === RELEASE_ID, `Artifact ${reference} names another release.`);
    assert(artifact.cellId === asset.cellId && artifact.class === asset.class, `Artifact ${reference} does not agree with the asset that declares it.`);
    assert(reference === `artifacts/${asset.cellId}/${asset.class}.json`, `Artifact reference ${reference} is not the canonical path for its cell and class.`);
    assert(artifact.claimLevel === "estimated", `Artifact ${reference} does not carry the estimated claim level.`);
    assert(
      artifact.derivation?.algorithm === CURB_DERIVATION_ALGORITHM && artifact.derivation?.inputDataset === CURB_INPUT_DATASET_ID,
      `Artifact ${reference} does not declare the ${CURB_DERIVATION_ALGORITHM} derivation over ${CURB_INPUT_DATASET_ID}.`,
    );
    for (const [key, value] of Object.entries(CURB_VERTICAL_PROFILE)) {
      assert(artifact.derivation?.profile?.[key] === value, `Artifact ${reference} declares a curb profile that differs from the shared one at ${key}.`);
    }

    const cell = cellById.get(asset.cellId);
    assert(cell, `Artifact ${reference} names a cell that is not in the ledger.`);
    assert(
      artifact.cellBounds.west === cell.bounds.west && artifact.cellBounds.east === cell.bounds.east && artifact.cellBounds.south === cell.bounds.south && artifact.cellBounds.north === cell.bounds.north,
      `Artifact ${reference} restates its cell bounds incorrectly.`,
    );
    assert(Array.isArray(artifact.parts) && artifact.parts.length === artifact.partCount && artifact.partCount > 0, `Artifact ${reference} has an inconsistent or empty part list.`);

    for (const part of artifact.parts) {
      const declared = partById.get(part.partId);
      assert(declared, `Artifact ${reference} holds part ${part.partId}, which the ledger does not declare.`);
      assert(declared.ownerCellId === asset.cellId, `Part ${part.partId} is owned by ${declared.ownerCellId} but has geometry in ${asset.cellId}.`);
      assert(declared.canonicalFeatureId === part.canonicalFeatureId, `Part ${part.partId} names a different parent feature than the ledger does.`);
      const previous = seenParts.get(part.partId);
      assert(previous === undefined, `Part ${part.partId} has geometry in both ${previous} and ${reference}; ownership is exactly once.`);
      seenParts.set(part.partId, reference);
      if (part.boundaryCoincident === true) boundaryCoincidentParts += 1;
      assert(
        part.geometry?.type === "MultiLineString" && Array.isArray(part.geometry.coordinates) && part.geometry.coordinates.length > 0,
        `Part ${part.partId} has no MultiLineString geometry. An embellishment release ships alignment, not polygons.`,
      );

      for (const line of part.geometry.coordinates) {
        assert(line.length >= 2, `Part ${part.partId} holds a line with fewer than two positions.`);
        for (const position of line) {
          coordinateCount += 2;
          assert(
            quantizeCoordinate(position[0]) === position[0] && quantizeCoordinate(position[1]) === position[1],
            `Part ${part.partId} ships a coordinate that is not at the declared precision: ${position[0]}, ${position[1]}.`,
          );
          const excursion = Math.max(cell.bounds.west - position[0], position[0] - cell.bounds.east, cell.bounds.south - position[1], position[1] - cell.bounds.north);
          if (excursion > maxExcursion) maxExcursion = excursion;
          assert(
            excursion <= GROUND_COORDINATE_STEP,
            `Part ${part.partId} ships a coordinate ${excursion} degrees outside cell ${asset.cellId}, beyond the ${GROUND_COORDINATE_STEP} rounding step.`,
          );
        }
      }
    }
  }

  const missing = parts.filter((part) => !seenParts.has(part.partId));
  assert(missing.length === 0, `${missing.length} declared parts have no geometry on disk, starting with ${missing[0]?.partId}.`);
  assert(seenParts.size === parts.length, `Materialized ${seenParts.size} parts against ${parts.length} declared.`);
  const totalReleaseBytes = directoryBytes(releaseRoot);
  assert(
    totalReleaseBytes <= TOTAL_ARTIFACT_BYTE_CEILING,
    `The release root totals ${totalReleaseBytes} bytes, over the CITYWIDE_BUDGETS.totalBytes ceiling of ${TOTAL_ARTIFACT_BYTE_CEILING}.`,
  );

  console.log(
    JSON.stringify(
      {
        releaseRoot: relative(root, releaseRoot),
        valid: true,
        releaseId: document.releaseId,
        ledgerId: ledger.ledgerId,
        cells: ledger.cells.length,
        features: features.length,
        parts: parts.length,
        assets: document.assets.length,
        artifacts: onDisk.length,
        boundaryCoincidentParts,
        totalArtifactBytes,
        totalReleaseBytes,
        totalArtifactByteCeiling: TOTAL_ARTIFACT_BYTE_CEILING,
        artifactBytes: distribution(artifactBytes),
        perArtifactReferenceBytes: PER_ARTIFACT_REFERENCE_BYTES,
        coordinatesChecked: coordinateCount,
        maxCellExcursionDegrees: maxExcursion,
        quantizationStepDegrees: GROUND_COORDINATE_STEP,
        nearTierMaxDistanceMeters: GROUND_EMBELLISHMENT_NEAR_TIER_MAX_DISTANCE_METERS,
        maxObservedRelativeLengthError: document.geometryValidation.maxObservedRelativeAreaError,
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
  if (command === "build") build(values);
  else if (command === "validate") validate(values);
  else throw new Error(`Unknown command ${command}. The commands are: build, validate.`);
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
}
