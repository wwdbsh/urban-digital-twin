/* global Buffer, process */

/**
 * Fail-closed evidence for the T009 embellishment CLI.
 *
 * The build path reads a 126 MB pinned snapshot and is exercised for real by the
 * task's own build+validate run; what a test suite can own cheaply, and must, is
 * the VALIDATOR — the thing that decides whether a materialized release is
 * allowed to be believed. Each case below writes a complete, valid, synthetic
 * embellishment release, breaks exactly one thing about it, and asserts that
 * `validate` refuses with the message that names the breakage.
 *
 * The fixture assembles the release document itself rather than shelling out to
 * `build`. That is a deliberate duplication of shape, confined to a fixture: it
 * is what lets a single-cell release exist at all, and every rule it must
 * satisfy is imported from the contracts rather than restated.
 */

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { stableSerialize } from "../src/domain/deterministic-hash.ts";
import { sha256HexSync } from "../src/domain/deterministic-hash.ts";
import {
  CURB_DERIVATION_ALGORITHM,
  CURB_INPUT_DATASET_ID,
  CURB_UNCERTAINTY,
  CURB_VERTICAL_PROFILE,
  GROUND_EMBELLISHMENT_NEAR_TIER_MAX_DISTANCE_METERS,
  curbCanonicalFeatureId,
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
} from "../src/release/ground-release.ts";
import { GROUND_COORDINATE_DECIMALS } from "../src/release/ground-geometry.ts";
import { tileBounds, tileKeyString } from "../src/runtime/spatial.ts";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const CLI = join(REPO_ROOT, "scripts/manhattan-embellishment-cli.mjs");
const RELEASE_ID = "manhattan-ground-embellishment-20260825";
const ARTIFACT_SCHEMA_VERSION = "manhattan-ground-embellishment-artifact-1";

function runCli(args) {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", CLI, ...args], { cwd: REPO_ROOT, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function writeDocument(path, value) {
  const contents = `${stableSerialize(value)}\n`;
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, contents);
  return { bytes: Buffer.byteLength(contents), sha256: sha256HexSync(contents) };
}

/**
 * A complete one-curb, one-cell embellishment release.
 *
 * Every identity value is derived from the same contracts the builder uses, so
 * the fixture cannot drift into a shape the real release would never have.
 */
function writeFixtureRelease(root) {
  const identity = {
    cityId: MANHATTAN_GROUND_CITY_ID,
    configId: MANHATTAN_GROUND_CONFIG_ID,
    partitionSchemeId: GROUND_PARTITION_SCHEME_ID,
    extent: MANHATTAN_GROUND_EXTENT,
    baseIdentitySetId: "fixture-embellishment-identity",
  };
  const skeleton = buildGroundOwnershipLedger({ ...identity, features: [], occupancy: [] });
  // A midtown-ish cell, chosen by order so the fixture does not depend on a
  // hand-copied tile index.
  const cell = skeleton.ledger.cells[30];
  const bounds = tileBounds(groundCellTileKey(cell.cellId));
  const west = Math.round((bounds.west + 0.001) * 1e7) / 1e7;
  const south = Math.round((bounds.south + 0.001) * 1e7) / 1e7;
  const lines = [[[west, south], [Math.round((west + 0.0002) * 1e7) / 1e7, Math.round((south + 0.0001) * 1e7) / 1e7]]];

  const source = { sourceRecordId: "12226000354", properties: { source_id: "12226000354" }, lines };
  const canonicalFeatureId = curbCanonicalFeatureId("manhattan", source);
  const feature = {
    canonicalFeatureId,
    cityId: MANHATTAN_GROUND_CITY_ID,
    class: "curb",
    claimLevel: "estimated",
    sourceRefs: [
      {
        schemaVersion: "1.0",
        id: `fixture:${CURB_INPUT_DATASET_ID}:12226000354`,
        registryEntryId: "nyc.oti-planimetrics-pavement-edge-block835",
        provider: "NYC Office of Technology and Innovation (OTI) Planimetrics",
        datasetId: CURB_INPUT_DATASET_ID,
        sourceRecordId: "12226000354",
        sourceUrl: "https://data.cityofnewyork.us/resource/vs44-rznx.geojson",
        licenseRefId: "nyc-open-data-terms",
        role: "primary",
        capturedAt: "2026-08-24T02:41:06.563Z",
        updatedAt: "2024-04-26T20:48:18.000Z",
        observedAt: "2026-08-24T02:41:06.563Z",
        release: null,
      },
    ],
    uncertainty: { horizontalMeters: CURB_UNCERTAINTY.horizontalMeters, verticalMeters: CURB_UNCERTAINTY.verticalMeters, temporal: CURB_UNCERTAINTY.temporal },
    identityOrigin: { kind: "ground-owned" },
  };

  const built = buildGroundOwnershipLedger({
    ...identity,
    features: [feature],
    occupancy: [{ canonicalFeatureId, occupancy: { kind: "declared-cells", tileKeys: [tileKeyString(groundCellTileKey(cell.cellId))] } }],
  });
  const part = built.parts[0];
  const relativeRef = `artifacts/${cell.cellId}/curb.json`;
  const written = writeDocument(join(root, relativeRef), {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    releaseId: RELEASE_ID,
    cellId: cell.cellId,
    cellBounds: bounds,
    class: "curb",
    claimLevel: "estimated",
    coordinateDecimals: GROUND_COORDINATE_DECIMALS,
    derivation: { algorithm: CURB_DERIVATION_ALGORITHM, inputDataset: CURB_INPUT_DATASET_ID, profile: CURB_VERTICAL_PROFILE, note: "fixture" },
    partCount: 1,
    parts: [
      {
        partId: part.partId,
        canonicalFeatureId,
        clipped: false,
        boundaryCoincident: false,
        sourceProperties: source.properties,
        geometry: { type: "MultiLineString", coordinates: lines },
      },
    ],
  });

  const tiers = [
    {
      tierId: `${cell.cellId}:curb:near-3d`,
      kind: "near-3d",
      maxDistanceMeters: GROUND_EMBELLISHMENT_NEAR_TIER_MAX_DISTANCE_METERS,
      artifactRef: relativeRef,
      checksumSha256: written.sha256,
    },
  ];
  const document = {
    schemaVersion: GROUND_RELEASE_SCHEMA_VERSION,
    releaseId: RELEASE_ID,
    cityId: MANHATTAN_GROUND_CITY_ID,
    configId: MANHATTAN_GROUND_CONFIG_ID,
    partitionSchemeId: GROUND_PARTITION_SCHEME_ID,
    ownershipLedgerId: built.ledger.ledgerId,
    generatedAt: "2026-08-25T00:00:00.000Z",
    immutable: true,
    sourceSnapshots: [{ datasetId: CURB_INPUT_DATASET_ID, mappedViewId: "vs44-rznx", rawSha256: sha256HexSync("fixture-page"), sourceFeatureCount: 1 }],
    clip: { sourceExtent: built.ledger.coverage, clipBounds: built.ledger.coverage, bufferMeters: 0, rule: "fixture" },
    geometryValidation: { method: "fixture", areaResidualToleranceRelative: 1e-6, maxObservedRelativeAreaError: 0, status: "pass" },
    assets: [{ assetId: `ground-asset:${cell.cellId}:curb`, cellId: cell.cellId, class: "curb", tiers, contentSha256: groundAssetContentSha256(tiers) }],
    claimCeilings: { curb: "Estimated curb alignment; not a survey of current curb geometry." },
    zoneImagery: null,
    provenance: {
      sourceEpoch: "fixture",
      termsUrl: "https://opendata.cityofnewyork.us/overview/",
      attribution: "fixture",
      disclaimer: "fixture",
      localOnly: true,
      runtimeExternalNetwork: false,
    },
    fallback: "fixture",
  };

  writeDocument(join(root, "release.json"), document);
  writeDocument(join(root, "ledger.json"), built.ledger);
  writeDocument(join(root, "features.json"), [feature]);
  writeDocument(join(root, "parts.json"), built.parts);
  return { cellId: cell.cellId, relativeRef, document, feature, ledger: built.ledger, parts: built.parts };
}

describe("manhattan-embellishment-cli validate", () => {
  let base;
  let fixture;

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "udt-embellishment-"));
    fixture = writeFixtureRelease(join(base, "valid"));
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  /** A pristine copy of the valid fixture, for one mutation. */
  function copy(name) {
    const root = join(base, name);
    cpSync(join(base, "valid"), root, { recursive: true });
    return root;
  }

  function patchDocument(root, mutate) {
    const path = join(root, "release.json");
    const document = JSON.parse(readFileSync(path, "utf8"));
    mutate(document);
    writeFileSync(path, `${stableSerialize(document)}\n`);
  }

  it("accepts the fixture release", () => {
    const result = runCli(["validate", "--release-root", join(base, "valid")]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.valid).toBe(true);
    expect(report.releaseId).toBe(RELEASE_ID);
    expect(report.nearTierMaxDistanceMeters).toBe(GROUND_EMBELLISHMENT_NEAR_TIER_MAX_DISTANCE_METERS);
    expect(report.parts).toBe(1);
  });

  it("refuses a single corrupted byte inside an artifact", () => {
    const root = copy("corrupt-byte");
    const path = join(root, fixture.relativeRef);
    const bytes = readFileSync(path, "utf8");
    // One digit of one coordinate: still valid JSON, still valid geometry, and
    // exactly the kind of silent corruption a checksum exists to catch.
    const corrupted = bytes.replace(/(\[-\d+\.\d{6})(\d)/u, (_match, head, digit) => `${head}${(Number(digit) + 1) % 10}`);
    expect(corrupted).not.toBe(bytes);
    writeFileSync(path, corrupted);
    const result = runCli(["validate", "--release-root", root]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Artifact checksum mismatch/u);
  });

  it("refuses a missing artifact", () => {
    const root = copy("missing-artifact");
    rmSync(join(root, fixture.relativeRef));
    const result = runCli(["validate", "--release-root", root]);
    expect(result.status).toBe(1);
    // The tree-against-declarations check catches it before the read does,
    // which is the stronger failure: a release is defective the moment its file
    // count disagrees with its manifest, not only when a reader trips over it.
    expect(result.stderr).toMatch(/The artifact tree holds 0 files but 1 are declared|ENOENT/u);
  });

  it("refuses an undeclared file inside the checksum-pinned root", () => {
    const root = copy("stray-file");
    writeFileSync(join(root, `artifacts/${fixture.cellId}/crosswalk.json`), "{}\n");
    const result = runCli(["validate", "--release-root", root]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Undeclared file inside the checksum-pinned release root/u);
  });

  it("refuses a tampered release document whose ledger pin no longer matches", () => {
    const root = copy("tampered-document");
    patchDocument(root, (document) => {
      document.ownershipLedgerId = `${document.ownershipLedgerId}-tampered`;
    });
    const result = runCli(["validate", "--release-root", root]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/must pin the ownership ledger it was built against/u);
  });

  it("refuses a tampered identity set that no longer hashes to its pinned checksum", () => {
    const root = copy("tampered-identity");
    const path = join(root, "features.json");
    const features = JSON.parse(readFileSync(path, "utf8"));
    features[0].claimLevel = "source-backed";
    writeFileSync(path, `${stableSerialize(features)}\n`);
    const result = runCli(["validate", "--release-root", root]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/always estimated|Pinned identity checksum/u);
  });

  /**
   * The T009 schema amendment, proven end to end.
   *
   * A flat tier on an embellishment asset is exactly the failure the amendment
   * exists to make impossible: estimated curb linework standing in as the
   * always-covering cartographic base.
   */
  it("refuses an embellishment asset that declares a flat tier", () => {
    const root = copy("embellishment-with-flat-tier");
    patchDocument(root, (document) => {
      const asset = document.assets[0];
      asset.tiers = [
        ...asset.tiers,
        { tierId: `${asset.cellId}:curb:flat`, kind: "flat", maxDistanceMeters: null, artifactRef: asset.tiers[0].artifactRef, checksumSha256: asset.tiers[0].checksumSha256 },
      ];
      asset.contentSha256 = groundAssetContentSha256(asset.tiers);
    });
    const result = runCli(["validate", "--release-root", root]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/must not declare a flat tier/u);
  });

  it("refuses a near tier at a distance other than the pinned exterior near ring", () => {
    const root = copy("wrong-near-ring");
    patchDocument(root, (document) => {
      const asset = document.assets[0];
      asset.tiers[0].maxDistanceMeters = GROUND_EMBELLISHMENT_NEAR_TIER_MAX_DISTANCE_METERS + 100;
      asset.contentSha256 = groundAssetContentSha256(asset.tiers);
    });
    const result = runCli(["validate", "--release-root", root]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/near-tier distance other than/u);
  });
});

describe("manhattan-embellishment-cli build", () => {
  it("refuses to run without a pinned --generated-at", () => {
    const result = runCli(["build", "--release-root", join(tmpdir(), "udt-embellishment-never")]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--generated-at is required/u);
  });

  it("refuses an unknown command", () => {
    const result = runCli(["publish"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Unknown command publish/u);
  });
});
