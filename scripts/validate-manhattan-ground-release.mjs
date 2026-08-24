/* global URL, console, process */

/**
 * Fail-closed validator for the citywide cartographic ground release (T006).
 *
 * This is the second phase of `pnpm citywide:validate`. It does NOT restate the
 * T005 rules: `validateGroundReleaseGraph` is imported and run against the
 * published documents, exactly as `validate-manhattan-citywide-release.mjs`
 * imports `validateCitywideReleaseManifest`. What it adds is everything a pure
 * document validator cannot see — the bytes on disk.
 *
 * Five on-disk obligations, each of which fails the whole run:
 *
 * 1. Every declared tier artifact exists and hashes to its declared checksum.
 * 2. The artifact tree contains NOTHING that is not declared. A stray file is
 *    as much a release defect as a missing one, because it is unhashed content
 *    inside a checksum-pinned root.
 * 3. Every part in the ledger has geometry in exactly one artifact, and every
 *    part in an artifact is declared by the ledger and owned by that artifact's
 *    own cell. This is the exactly-once ownership contract, checked against the
 *    materialized bytes rather than against the ledger's own bookkeeping.
 * 4. Every shipped coordinate is already at the declared precision, and no part
 *    escapes its owning cell by more than one rounding step.
 * 5. The ownership ledger is REBUILT from the published features and parts and
 *    must reproduce the same ledger id, and the asset list must be exactly
 *    re-derivable from the artifact tree. Those two make almost all of
 *    release.json content-anchored rather than merely well-formed.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { GROUND_BASE_CLASSES, sortGroundIds } from "../src/domain/ground.ts";
import {
  GROUND_PARTITION_SCHEME_ID,
  MANHATTAN_GROUND_CITY_ID,
  MANHATTAN_GROUND_CONFIG_ID,
  MANHATTAN_GROUND_EXTENT,
  buildGroundOwnershipLedger,
  groundAssetContentSha256,
  groundCellTileKey,
  validateGroundReleaseGraph,
} from "../src/release/ground-release.ts";
import { GROUND_COORDINATE_STEP, quantizeCoordinate } from "../src/release/ground-geometry.ts";
import { tileKeyString } from "../src/runtime/spatial.ts";

const RELEASE_ID = "manhattan-ground-20260824";
const EXPECTED_CELL_COUNT = 140;
const ARTIFACT_SCHEMA_VERSION = "manhattan-ground-artifact-1";

function parseArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) continue;
    const equals = token.indexOf("=");
    if (equals > 2) output[token.slice(2, equals)] = token.slice(equals + 1);
    else {
      output[token.slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  return output;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
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

function run() {
  const values = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(new URL("..", import.meta.url).pathname);
  const releaseRoot = resolve(repoRoot, String(values["release-root"] ?? `public/data/${RELEASE_ID}`));

  const document = readJson(join(releaseRoot, "release.json"));
  const ledger = readJson(join(releaseRoot, "ledger.json"));
  const features = readJson(join(releaseRoot, "features.json"));
  const parts = readJson(join(releaseRoot, "parts.json"));

  // 1. The T005 contract itself, imported rather than restated.
  const graph = validateGroundReleaseGraph({ ledger, document, features, parts });
  assert(
    graph.ok,
    `Ground release graph failed the T005 contract: ${graph.ok ? "" : graph.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`,
  );

  // 2. Release identity and the invariants this city's release must hold.
  assert(document.releaseId === RELEASE_ID, `Unexpected ground release id ${document.releaseId}.`);
  assert(document.cityId === MANHATTAN_GROUND_CITY_ID && document.configId === MANHATTAN_GROUND_CONFIG_ID, "Ground release city or configuration identity does not match the Manhattan constants.");
  assert(document.partitionSchemeId === GROUND_PARTITION_SCHEME_ID, "Ground release partition scheme does not match the pinned scheme.");
  assert(ledger.cells.length === EXPECTED_CELL_COUNT, `Ground ledger declares ${ledger.cells.length} cells; the Manhattan extent tiles to ${EXPECTED_CELL_COUNT}.`);
  assert(document.immutable === true && ledger.immutable === true, "Ground release and ledger must both declare immutability.");
  assert(document.provenance.localOnly === true && document.provenance.runtimeExternalNetwork === false, "The ground release is local-only and must not declare runtime external network use.");
  for (const asset of document.assets) {
    assert(GROUND_BASE_CLASSES.includes(asset.class), `Asset ${asset.assetId} ships class ${asset.class}, which is not a flat cartographic base class. Curb and crosswalk embellishments are not part of this release.`);
    assert(typeof document.claimCeilings[asset.class] === "string" && document.claimCeilings[asset.class].length > 0, `Shipped class ${asset.class} has no claim ceiling.`);
  }

  // 3. Rebuild the ownership ledger from the published identity set. A ledger id
  //    that no longer follows from its own features and parts is a tampered one.
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

  // 4. Declared artifacts against the bytes on disk, and the tree against the
  //    declarations. Both directions, so neither a missing nor a stray file passes.
  const declaredRefs = new Map();
  for (const asset of document.assets) {
    assert(asset.contentSha256 === groundAssetContentSha256(asset.tiers), `Asset ${asset.assetId} content digest does not match its declared tiers.`);
    const unbounded = asset.tiers.filter((tier) => tier.maxDistanceMeters === null && tier.kind === "flat");
    assert(unbounded.length === 1, `Asset ${asset.assetId} must declare exactly one always-covering flat tier.`);
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

  // 5. Content: checksums, exactly-once part ownership, precision, containment.
  const seenParts = new Map();
  const partById = new Map(parts.map((part) => [part.partId, part]));
  let coordinateCount = 0;
  let maxExcursion = 0;
  let totalArtifactBytes = 0;

  for (const [reference, { asset, tier }] of [...declaredRefs].sort((left, right) => (left[0] < right[0] ? -1 : 1))) {
    const bytes = readFileSync(join(releaseRoot, reference));
    totalArtifactBytes += bytes.byteLength;
    assert(sha256(bytes) === tier.checksumSha256, `Artifact checksum mismatch: ${reference}.`);
    const artifact = JSON.parse(bytes.toString("utf8"));
    assert(artifact.schemaVersion === ARTIFACT_SCHEMA_VERSION, `Unsupported artifact schema in ${reference}.`);
    assert(artifact.releaseId === RELEASE_ID, `Artifact ${reference} names another release.`);
    assert(artifact.cellId === asset.cellId && artifact.class === asset.class, `Artifact ${reference} does not agree with the asset that declares it.`);
    assert(reference === `artifacts/${asset.cellId}/${asset.class}.json`, `Artifact reference ${reference} is not the canonical path for its cell and class.`);

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
      assert(part.geometry?.type === "MultiPolygon" && Array.isArray(part.geometry.coordinates) && part.geometry.coordinates.length > 0, `Part ${part.partId} has no MultiPolygon geometry.`);

      for (const polygon of part.geometry.coordinates) {
        for (const ring of polygon) {
          assert(ring.length >= 4, `Part ${part.partId} holds a ring with fewer than four positions.`);
          const first = ring[0];
          const last = ring[ring.length - 1];
          assert(first[0] === last[0] && first[1] === last[1], `Part ${part.partId} holds an unclosed ring.`);
          for (const position of ring) {
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
  }

  const missing = parts.filter((part) => !seenParts.has(part.partId));
  assert(missing.length === 0, `${missing.length} declared parts have no geometry on disk, starting with ${missing[0]?.partId}.`);
  assert(seenParts.size === parts.length, `Materialized ${seenParts.size} parts against ${parts.length} declared.`);

  console.log(
    JSON.stringify(
      {
        releaseRoot: relative(repoRoot, releaseRoot),
        valid: true,
        releaseId: document.releaseId,
        ledgerId: ledger.ledgerId,
        cells: ledger.cells.length,
        features: features.length,
        parts: parts.length,
        assets: document.assets.length,
        artifacts: onDisk.length,
        totalArtifactBytes,
        coordinatesChecked: coordinateCount,
        maxCellExcursionDegrees: maxExcursion,
        quantizationStepDegrees: GROUND_COORDINATE_STEP,
        maxObservedRelativeAreaError: document.geometryValidation.maxObservedRelativeAreaError,
      },
      null,
      2,
    ),
  );
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
}
