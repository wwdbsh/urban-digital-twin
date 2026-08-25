/* global Buffer, TextDecoder, URL, console, process */

/**
 * Fail-closed validator for the zone imagery release (Task T012).
 *
 * Third phase of `pnpm citywide:validate`. Like the ground validator it does
 * NOT restate the T005 rules — `validateGroundReleaseStructure` and
 * `validateZoneImageryIndex` are imported and run against the published
 * documents. What it adds is everything a document validator cannot see.
 *
 * Seven on-disk obligations, each of which fails the whole run:
 *
 * 1. The release document is structurally valid under the unmodified T005
 *    ground schema, including its single `zoneImagery` seam.
 * 2. `zoneImagery.checksumSha256` matches the bytes of `zone-imagery.json`.
 *    This is THE gate: one mismatch removes the entire imagery layer, and the
 *    polygon base draws exactly as it did before imagery existed.
 * 3. Every indexed texture exists and hashes to its declared checksum and size.
 * 4. The artifact tree contains NOTHING undeclared. A stray file inside a
 *    checksum-pinned root is unhashed content, which is as much a defect as a
 *    missing one.
 * 5. Every entry's pixel grid is RE-DERIVED from the base ledger's cell bounds
 *    rather than trusted, so a doctored index cannot claim a grid the build
 *    rule would not have produced.
 * 6. The COMPATIBILITY PIN holds: the mirrored assets are byte-identical to the
 *    base release's zone assets, and each mirrored tier artifact still exists
 *    in the base release at its declared checksum. If T006 is ever regenerated
 *    this fails, which is the intended coupling — the imagery was registered
 *    against that geometry and no other.
 * 7. Coverage is accounted for exactly: every candidate zone asset in the base
 *    release is either textured or refused with a reason. A silent gap is the
 *    defect this check exists to prevent.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { validateGroundReleaseStructure } from "../src/release/ground-release.ts";
import { stableSerialize } from "../src/domain/deterministic-hash.ts";
import {
  ZONE_IMAGERY_CLASSES,
  validateZoneImageryIndex,
  zoneImageryPixelGrid,
  zoneRef,
} from "../src/release/zone-imagery.ts";

const RELEASE_ID = "manhattan-ground-zone-imagery-20260826";
const BASE_RELEASE_ROOT = "public/data/manhattan-ground-20260824";

const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
  return condition;
}

function readJson(path) {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path)));
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function walk(root) {
  const found = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory).sort()) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) visit(path);
      else found.push(relative(root, path));
    }
  };
  visit(root);
  return found;
}

function main() {
  const repoRoot = resolve(new URL("..", import.meta.url).pathname);
  const releaseRoot = join(repoRoot, "public/data", RELEASE_ID);
  const baseRoot = join(repoRoot, BASE_RELEASE_ROOT);

  // ---- 1. document structure, unmodified T005 schema -----------------------
  const documentBytes = readFileSync(join(releaseRoot, "release.json"));
  const document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(documentBytes));
  const structural = validateGroundReleaseStructure(document);
  check(
    structural.ok,
    `release.json fails the T005 ground schema: ${JSON.stringify(structural.issues?.slice(0, 5) ?? [])}`,
  );
  check(document.releaseId === RELEASE_ID, `release id is ${document.releaseId}, expected ${RELEASE_ID}`);
  check(document.immutable === true, "release does not declare immutability");
  check(document.provenance?.localOnly === true, "release must declare local-only retention");
  check(
    document.provenance?.runtimeExternalNetwork === false,
    "release must declare no runtime external network use",
  );

  // ---- 2. the one gate that fails the whole imagery layer closed -----------
  const seam = document.zoneImagery;
  if (!check(seam && typeof seam === "object", "release.json declares no zoneImagery seam")) {
    return report();
  }
  check(seam.artifactRef === "zone-imagery.json", `zoneImagery.artifactRef is ${seam.artifactRef}`);
  const indexBytes = readFileSync(join(releaseRoot, seam.artifactRef));
  check(
    sha256Hex(indexBytes) === seam.checksumSha256,
    "zone-imagery.json does not match the checksum pinned in release.json; the entire imagery layer fails closed to the polygon base",
  );

  const index = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(indexBytes));
  const indexCheck = validateZoneImageryIndex(index);
  check(
    indexCheck.ok,
    `zone-imagery.json is not well formed: ${JSON.stringify(indexCheck.issues.slice(0, 5))}`,
  );
  check(
    Buffer.compare(indexBytes, Buffer.from(stableSerialize(index), "utf8")) === 0,
    "zone-imagery.json is not in canonical stable-serialized form, so its checksum is not reproducible",
  );
  check(index.captureYear === seam.captureYear, "index and seam disagree on capture year");
  check(index.attribution === seam.attribution, "index and seam disagree on attribution");

  // ---- 3 + 5. every texture: bytes, checksum, and a re-derived grid --------
  const ledger = readJson(join(baseRoot, "ledger.json"));
  const boundsByCell = new Map(ledger.cells.map((cell) => [cell.cellId, cell.bounds]));
  const declaredRefs = new Set(["release.json", "zone-imagery.json", "build-report.json"]);

  for (const entry of index.entries ?? []) {
    declaredRefs.add(entry.artifactRef);
    let bytes;
    try {
      bytes = readFileSync(join(releaseRoot, entry.artifactRef));
    } catch {
      failures.push(`${entry.zoneRef}: declared texture ${entry.artifactRef} is absent`);
      continue;
    }
    check(
      sha256Hex(bytes) === entry.checksumSha256,
      `${entry.zoneRef}: texture bytes do not match the declared checksum`,
    );
    check(bytes.length === entry.byteSize, `${entry.zoneRef}: texture byte size does not match`);
    check(
      bytes[0] === 0xff && bytes[1] === 0xd8,
      `${entry.zoneRef}: texture is not a JPEG (missing SOI marker)`,
    );

    const bounds = boundsByCell.get(entry.cellId);
    if (!check(bounds, `${entry.zoneRef}: no such cell in the base ownership ledger`)) continue;
    check(
      stableSerialize(bounds) === stableSerialize(entry.bounds),
      `${entry.zoneRef}: declared bounds differ from the base ledger's cell bounds`,
    );
    const grid = zoneImageryPixelGrid(bounds);
    check(
      grid.width === entry.pixelWidth && grid.height === entry.pixelHeight,
      `${entry.zoneRef}: declared grid ${entry.pixelWidth}x${entry.pixelHeight} is not what the pinned build rule derives (${grid.width}x${grid.height})`,
    );
  }

  // ---- 4. nothing undeclared inside a checksum-pinned root ------------------
  for (const path of walk(releaseRoot)) {
    check(declaredRefs.has(path), `undeclared file inside the release root: ${path}`);
  }

  // ---- 6. the compatibility pin --------------------------------------------
  const baseDocument = readJson(join(baseRoot, "release.json"));
  const imageryClasses = new Set(ZONE_IMAGERY_CLASSES);
  const baseZoneAssets = baseDocument.assets.filter((asset) => imageryClasses.has(asset.class));
  const baseById = new Map(baseZoneAssets.map((asset) => [asset.assetId, asset]));

  check(
    (document.assets ?? []).length === baseZoneAssets.length,
    `mirrored asset count ${document.assets?.length} does not match the base release's ${baseZoneAssets.length} zone assets`,
  );
  for (const asset of document.assets ?? []) {
    const source = baseById.get(asset.assetId);
    if (!check(source, `mirrored asset ${asset.assetId} does not exist in the base release`)) continue;
    check(
      stableSerialize(asset) === stableSerialize(source),
      `mirrored asset ${asset.assetId} is not byte-identical to the base release; the compatibility pin is broken`,
    );
    for (const tier of asset.tiers ?? []) {
      let tierBytes;
      try {
        tierBytes = readFileSync(join(baseRoot, tier.artifactRef));
      } catch {
        failures.push(`${asset.assetId}: base polygon artifact ${tier.artifactRef} is absent`);
        continue;
      }
      check(
        sha256Hex(tierBytes) === tier.checksumSha256,
        `${asset.assetId}: base polygon artifact ${tier.artifactRef} no longer matches its checksum; the imagery was registered against different geometry`,
      );
    }
  }

  // ---- 7. exact accounting: textured or refused, never silently absent -----
  const textured = new Set((index.entries ?? []).map((entry) => entry.zoneRef));
  const refused = new Set((index.refusals ?? []).map((entry) => entry.zoneRef));
  for (const asset of baseZoneAssets) {
    const ref = zoneRef(asset.cellId, asset.class);
    const inTextured = textured.has(ref);
    const inRefused = refused.has(ref);
    check(
      inTextured !== inRefused,
      inTextured
        ? `${ref} is both textured and refused`
        : `${ref} is neither textured nor refused; every candidate zone must be accounted for`,
    );
  }
  check(
    textured.size + refused.size === baseZoneAssets.length,
    `index accounts for ${textured.size + refused.size} zones; the base release has ${baseZoneAssets.length}`,
  );

  return report(index);
}

function report(index) {
  if (failures.length > 0) {
    console.error(`zone imagery validation FAILED (${failures.length}):`);
    for (const failure of failures.slice(0, 25)) console.error(`  - ${failure}`);
    process.exit(1);
  }
  const entries = index?.entries ?? [];
  const bytes = entries.reduce((sum, entry) => sum + entry.byteSize, 0);
  console.log(
    `zone imagery validation PASSED: ${entries.length} textures, ${(index?.refusals ?? []).length} recorded refusals, ` +
      `${(bytes / 1048576).toFixed(1)} MiB.`,
  );
}

main();
