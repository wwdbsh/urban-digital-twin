/* global Buffer, TextDecoder, URL, console, process */

/**
 * Zone imagery release builder (Task T012).
 *
 * Clips the retained 2024 orthoimagery snapshot into one texture per (ownership
 * cell, zone class) for park, plaza and water, and emits a checksum-pinned
 * release that the T005 `zoneImagery` seam can point at.
 *
 * Four decisions about HOW, stated once:
 *
 * 1. **This release OVERLAYS T006; it does not supersede it.** The `assets`
 *    array mirrors T006's 162 zone assets VERBATIM — same asset ids, tier ids,
 *    artifact refs and checksums — and those refs resolve against the base
 *    release named in `sourceSnapshots`, not against this root. That mirror is
 *    a deliberate COMPATIBILITY PIN: the zone-to-tile mapping was derived from
 *    T006's geometry, so if the base release is ever regenerated the mirrored
 *    checksums stop matching and this release fails validation instead of
 *    draping 2024 imagery over polygons it was never registered against.
 *
 * 2. **Decode through `sips`, encode through `sips`.** macOS ImageIO is the
 *    only JPEG 2000 decoder on hand, and it is bit-stable across repeat runs on
 *    this machine. It is NOT claimed to be stable across machines or OS
 *    versions; what the release pins is the CONTENT, by SHA-256, at build time.
 *
 * 3. **Per-pixel inverse mapping, not tile mosaicking.** Every output pixel
 *    centre is projected WGS84 -> EPSG:2263 and sampled bilinearly from the
 *    decoded mosaic. Source tiles decode to exactly 4.0 ft per texel, so the
 *    mosaic is seamless and a sample near a tile edge draws its four
 *    neighbours from whichever tiles own them.
 *
 * 4. **Refusals are recorded, never silent.** A cell with no overlapping tile,
 *    or with less imagery coverage than the declared bar, produces a refusal
 *    entry with a reason and NO artifact. The polygon base still draws there.
 *
 * Determinism is a build obligation: `--generated-at` is required, every
 * document goes through `stableSerialize`, every collection is sorted by a byte
 * comparator, tiles are visited in ascending id order, and `--replace` is the
 * only way to overwrite an existing root.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { compareGroundIds } from "../src/domain/ground.ts";
import { stableSerialize } from "../src/domain/deterministic-hash.ts";
import { GROUND_RELEASE_SCHEMA_VERSION, validateGroundReleaseStructure } from "../src/release/ground-release.ts";
import {
  ZONE_IMAGERY_CLASSES,
  ZONE_IMAGERY_INDEX_SCHEMA_VERSION,
  ZONE_IMAGERY_MOSAIC_FEET_PER_TEXEL,
  ZONE_IMAGERY_TARGET_GSD_METERS,
  ZONE_IMAGERY_TILE_DECODE_PIXELS,
  ZONE_IMAGERY_TILE_FEET,
  decodeBmp24,
  encodeBmp24,
  feetBoundsOverlap,
  feetHullOfWgs84Rect,
  validateZoneImageryIndex,
  zoneImageryPixelCentre,
  zoneImageryPixelGrid,
  zoneRef,
} from "../src/release/zone-imagery.ts";
import { wgs84ToEpsg2263 } from "../src/release/ortho-projection.ts";

const RELEASE_ID = "manhattan-ground-zone-imagery-20260826";
const BASE_RELEASE_ID = "manhattan-ground-20260824";
const BASE_RELEASE_ROOT = "public/data/manhattan-ground-20260824";
const ORTHO_ROOT = "data/raw/nyc-ortho-2024-manhattan";
const DECODE_CACHE_ROOT = "data/generated/nyc-ortho-2024-manhattan/decoded-625";
const BUILD_REPORT_SCHEMA_VERSION = "manhattan-zone-imagery-build-report-1";

const CAPTURE_YEAR = 2024;
const JPEG_QUALITY = 85;

/**
 * Minimum fraction of a cell's pixels that must come from real imagery.
 *
 * Set to 1.0 deliberately. The ground partition extends past the orthoimagery
 * footprint on three sides, so partially covered cells exist and are REAL. An
 * artifact that is 90% photograph and 10% synthesized fill would be
 * indistinguishable, once draped, from one that is entirely photograph — the
 * black fill would read as water or shadow. Refusing the whole texture and
 * falling back to the polygon base is the honest outcome, and the refusal
 * records exactly how much coverage was available.
 */
const MINIMUM_COVERED_FRACTION = 1;

/** In-memory decoded-tile budget. 96 tiles at 625^2 RGB is about 112 MB. */
const TILE_CACHE_LIMIT = 96;

function parseArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) continue;
    const equals = token.indexOf("=");
    if (equals > 2) output[token.slice(2, equals)] = token.slice(equals + 1);
    else {
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) {
        output[token.slice(2)] = next;
        index += 1;
      } else output[token.slice(2)] = true;
    }
  }
  return output;
}

function readJson(path) {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path)));
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fail(message) {
  console.error(`zone-imagery build FAILED: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Source tiles
// ---------------------------------------------------------------------------

/**
 * Decoded-tile provider.
 *
 * Extraction and decode are cached on disk because they dominate wall time and
 * are byte-stable: the determinism re-run reuses them instead of spending four
 * minutes reproducing identical bytes. The cache is keyed by tile id and its
 * contents are verified against the inventory CRC at extraction time.
 */
class TileMosaic {
  constructor(repoRoot, tiles) {
    this.repoRoot = repoRoot;
    this.zipPath = join(repoRoot, ORTHO_ROOT, "boro_manhattan_sp24.zip");
    this.cacheRoot = join(repoRoot, DECODE_CACHE_ROOT);
    this.byId = new Map();
    this.byGridKey = new Map();
    for (const tile of tiles) {
      this.byId.set(tile.image, tile);
      const bounds = tile.spcsFeetEpsg2263;
      // Keyed off the tile's own south-west corner nudged inside itself, so the
      // key is derived by the same floor arithmetic a sample coordinate uses.
      this.byGridKey.set(TileMosaic.gridKey(bounds.xmin + 1, bounds.ymin + 1), tile);
    }
    this.memory = new Map();
    this.decodedCount = 0;
    // Fast path. Samples arrive in raster order, so consecutive lookups land in
    // the same source tile almost every time; memoizing the last hit turns the
    // common case into two integer compares. Without it the four neighbour
    // lookups per output pixel dominate the entire build.
    this.lastKey = Number.NaN;
    this.lastTile = null;
    this.lastDecoded = null;
    this.touched = new Set();
  }

  /**
   * Numeric key for the 2500 ft tile grid.
   *
   * Integer rather than a template string on purpose: this runs about a billion
   * times per build, and string keys would allocate on every call.
   */
  static gridKey(xFeet, yFeet) {
    return Math.floor(xFeet / ZONE_IMAGERY_TILE_FEET) * 65536 + Math.floor(yFeet / ZONE_IMAGERY_TILE_FEET);
  }

  tileAtFeet(xFeet, yFeet) {
    return this.byGridKey.get(TileMosaic.gridKey(xFeet, yFeet)) ?? null;
  }

  beginCell() {
    this.touched = new Set();
  }

  ensureDecoded(tileId) {
    const cached = this.memory.get(tileId);
    if (cached) return cached;

    const bmpPath = join(this.cacheRoot, `${tileId}.bmp`);
    if (!existsSync(bmpPath)) {
      mkdirSync(this.cacheRoot, { recursive: true });
      const scratch = join(this.cacheRoot, ".jp2");
      mkdirSync(scratch, { recursive: true });
      const jp2Path = join(scratch, `${tileId}.jp2`);
      execFileSync("unzip", ["-o", "-j", this.zipPath, `${tileId}.jp2`, "-d", scratch], { stdio: "ignore" });
      if (!existsSync(jp2Path)) fail(`source tile ${tileId}.jp2 is absent from the retained archive`);
      execFileSync(
        "sips",
        [
          "-s", "format", "bmp",
          "-z", String(ZONE_IMAGERY_TILE_DECODE_PIXELS), String(ZONE_IMAGERY_TILE_DECODE_PIXELS),
          jp2Path, "--out", bmpPath,
        ],
        { stdio: "ignore" },
      );
      rmSync(jp2Path, { force: true });
      this.decodedCount += 1;
    }

    const decoded = decodeBmp24(readFileSync(bmpPath));
    if (decoded.width !== ZONE_IMAGERY_TILE_DECODE_PIXELS || decoded.height !== ZONE_IMAGERY_TILE_DECODE_PIXELS) {
      fail(`decoded tile ${tileId} is ${decoded.width}x${decoded.height}; expected ${ZONE_IMAGERY_TILE_DECODE_PIXELS} square`);
    }
    if (this.memory.size >= TILE_CACHE_LIMIT) this.memory.delete(this.memory.keys().next().value);
    this.memory.set(tileId, decoded);
    return decoded;
  }

  /** One texel of the global mosaic. False where no retained tile covers it. */
  texel(column, row, out) {
    const xFeet = (column + 0.5) * ZONE_IMAGERY_MOSAIC_FEET_PER_TEXEL;
    const yFeet = -(row + 0.5) * ZONE_IMAGERY_MOSAIC_FEET_PER_TEXEL;

    const key = TileMosaic.gridKey(xFeet, yFeet);
    let tile;
    let decoded;
    if (key === this.lastKey) {
      tile = this.lastTile;
      decoded = this.lastDecoded;
      if (!tile) return false;
    } else {
      tile = this.byGridKey.get(key) ?? null;
      this.lastKey = key;
      this.lastTile = tile;
      this.lastDecoded = null;
      if (!tile) return false;
      decoded = this.ensureDecoded(tile.image);
      this.lastDecoded = decoded;
      this.touched.add(tile.image);
    }

    const bounds = tile.spcsFeetEpsg2263;
    const localColumn = Math.floor((xFeet - bounds.xmin) / ZONE_IMAGERY_MOSAIC_FEET_PER_TEXEL);
    const localRow = Math.floor((bounds.ymax - yFeet) / ZONE_IMAGERY_MOSAIC_FEET_PER_TEXEL);
    if (localColumn < 0 || localRow < 0 || localColumn >= decoded.width || localRow >= decoded.height) return false;
    const offset = (localRow * decoded.width + localColumn) * 3;
    out[0] = decoded.rgb[offset];
    out[1] = decoded.rgb[offset + 1];
    out[2] = decoded.rgb[offset + 2];
    return true;
  }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

const NEIGHBOUR = new Uint8Array(3);

/**
 * Assembles one cell texture.
 *
 * A pixel counts as covered only when all four bilinear neighbours are real
 * texels. That erodes coverage by one pixel at the imagery boundary, which is
 * the conservative direction: it can only turn a marginal pixel into a refusal,
 * never into fabricated content.
 */
function assembleCellTexture(mosaic, bounds, grid) {
  const rgb = new Uint8Array(grid.width * grid.height * 3);
  let covered = 0;
  mosaic.beginCell();

  for (let row = 0; row < grid.height; row += 1) {
    for (let column = 0; column < grid.width; column += 1) {
      const centre = zoneImageryPixelCentre(bounds, grid, column, row);
      const feet = wgs84ToEpsg2263(centre.longitude, centre.latitude);

      const u = feet.x / ZONE_IMAGERY_MOSAIC_FEET_PER_TEXEL - 0.5;
      const v = -feet.y / ZONE_IMAGERY_MOSAIC_FEET_PER_TEXEL - 0.5;
      const c0 = Math.floor(u);
      const r0 = Math.floor(v);
      const fx = u - c0;
      const fy = v - r0;

      let red = 0;
      let green = 0;
      let blue = 0;
      let complete = true;
      for (let dy = 0; dy < 2 && complete; dy += 1) {
        for (let dx = 0; dx < 2 && complete; dx += 1) {
          if (!mosaic.texel(c0 + dx, r0 + dy, NEIGHBOUR)) {
            complete = false;
            break;
          }
          const weight = (dx === 0 ? 1 - fx : fx) * (dy === 0 ? 1 - fy : fy);
          red += NEIGHBOUR[0] * weight;
          green += NEIGHBOUR[1] * weight;
          blue += NEIGHBOUR[2] * weight;
        }
      }

      const offset = (row * grid.width + column) * 3;
      if (complete) {
        // Round half-up; the same arithmetic must reproduce byte for byte.
        rgb[offset] = Math.min(255, Math.round(red));
        rgb[offset + 1] = Math.min(255, Math.round(green));
        rgb[offset + 2] = Math.min(255, Math.round(blue));
        covered += 1;
      }
    }
  }

  return {
    rgb,
    coveredPixelFraction: covered / (grid.width * grid.height),
    contributing: mosaic.touched,
  };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = typeof args["generated-at"] === "string" ? args["generated-at"] : null;
  if (!generatedAt || Number.isNaN(Date.parse(generatedAt))) {
    fail("--generated-at <iso8601> is required so the release is reproducible");
  }

  const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
  const requestedOut = typeof args.out === "string" ? args.out : `public/data/${RELEASE_ID}`;
  // An absolute --out must NOT be re-rooted at the repo; joining it would write
  // a mirror of the whole path inside the working tree.
  const outputRoot = isAbsolute(requestedOut) ? requestedOut : join(repoRoot, requestedOut);
  if (existsSync(outputRoot)) {
    if (args.replace !== true) fail(`${outputRoot} already exists; pass --replace to overwrite`);
    rmSync(outputRoot, { recursive: true, force: true });
  }

  const started = Date.now();
  const ledger = readJson(join(repoRoot, BASE_RELEASE_ROOT, "ledger.json"));
  const baseDocument = readJson(join(repoRoot, BASE_RELEASE_ROOT, "release.json"));
  const inventory = readJson(join(repoRoot, ORTHO_ROOT, "tile-inventory.json"));
  const orthoManifest = readJson(join(repoRoot, ORTHO_ROOT, "manifest.json"));

  const boundsByCell = new Map(ledger.cells.map((cell) => [cell.cellId, cell.bounds]));
  const imageryClasses = new Set(ZONE_IMAGERY_CLASSES);

  // The mirror, and therefore the work list: exactly T006's zone assets.
  const mirroredAssets = baseDocument.assets
    .filter((asset) => imageryClasses.has(asset.class))
    .sort((left, right) => compareGroundIds(left.assetId, right.assetId));

  const mosaic = new TileMosaic(repoRoot, inventory.tiles);
  const entries = [];
  const refusals = [];
  const scratchBmp = join(repoRoot, DECODE_CACHE_ROOT, ".assemble.bmp");

  for (const asset of mirroredAssets) {
    const { cellId } = asset;
    const imageryClass = asset.class;
    const ref = zoneRef(cellId, imageryClass);
    const bounds = boundsByCell.get(cellId);
    if (!bounds) {
      refusals.push({ zoneRef: ref, cellId, class: imageryClass, reason: "The ownership ledger declares no bounds for this cell." });
      continue;
    }

    const hull = feetHullOfWgs84Rect(bounds);
    const overlapping = inventory.tiles
      .filter((tile) => feetBoundsOverlap(hull, tile.spcsFeetEpsg2263))
      .map((tile) => tile.image)
      .sort();
    if (overlapping.length === 0) {
      refusals.push({
        zoneRef: ref,
        cellId,
        class: imageryClass,
        reason: "No retained 2024 orthoimagery tile overlaps this cell; the ground partition extends beyond the imagery footprint here.",
      });
      continue;
    }

    const grid = zoneImageryPixelGrid(bounds);
    const cellStarted = Date.now();
    const assembled = assembleCellTexture(mosaic, bounds, grid);
    // Progress on stderr so stdout stays a single machine-readable report.
    process.stderr.write(
      `[${entries.length + refusals.length + 1}/${mirroredAssets.length}] ${ref} ${grid.width}x${grid.height} ` +
        `covered=${(assembled.coveredPixelFraction * 100).toFixed(2)}% ${((Date.now() - cellStarted) / 1000).toFixed(1)}s\n`,
    );
    if (assembled.coveredPixelFraction < MINIMUM_COVERED_FRACTION) {
      refusals.push({
        zoneRef: ref,
        cellId,
        class: imageryClass,
        reason: `Only ${(assembled.coveredPixelFraction * 100).toFixed(3)}% of this cell is covered by retained orthoimagery; a partially synthesized texture would be indistinguishable from a photographed one once draped, so the whole texture is refused and the polygon base draws instead.`,
      });
      continue;
    }

    const artifactRef = `artifacts/${cellId}/${imageryClass}.jpg`;
    const artifactPath = join(outputRoot, artifactRef);
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(scratchBmp, encodeBmp24(grid.width, grid.height, assembled.rgb));
    execFileSync(
      "sips",
      ["-s", "format", "jpeg", "-s", "formatOptions", String(JPEG_QUALITY), scratchBmp, "--out", artifactPath],
      { stdio: "ignore" },
    );
    const jpegBytes = readFileSync(artifactPath);

    entries.push({
      zoneRef: ref,
      cellId,
      class: imageryClass,
      artifactRef,
      checksumSha256: sha256Hex(jpegBytes),
      byteSize: jpegBytes.length,
      pixelWidth: grid.width,
      pixelHeight: grid.height,
      bounds,
      sourceTiles: [...assembled.contributing].sort(),
      coveredPixelFraction: assembled.coveredPixelFraction,
    });
  }
  rmSync(scratchBmp, { force: true });
  rmSync(join(repoRoot, DECODE_CACHE_ROOT, ".jp2"), { recursive: true, force: true });

  entries.sort((left, right) => compareGroundIds(left.zoneRef, right.zoneRef));
  refusals.sort((left, right) => compareGroundIds(left.zoneRef, right.zoneRef));

  const attribution = orthoManifest.license.attribution;
  const index = {
    schemaVersion: ZONE_IMAGERY_INDEX_SCHEMA_VERSION,
    releaseId: RELEASE_ID,
    baseReleaseId: BASE_RELEASE_ID,
    partitionSchemeId: baseDocument.partitionSchemeId,
    generatedAt,
    captureYear: CAPTURE_YEAR,
    attribution,
    targetGroundSampleDistanceMeters: ZONE_IMAGERY_TARGET_GSD_METERS,
    entries,
    refusals,
  };
  const indexCheck = validateZoneImageryIndex(index);
  if (!indexCheck.ok) fail(`index is not well formed: ${JSON.stringify(indexCheck.issues.slice(0, 5))}`);

  const indexBytes = Buffer.from(stableSerialize(index), "utf8");
  writeFileSync(join(outputRoot, "zone-imagery.json"), indexBytes);
  const indexChecksum = sha256Hex(indexBytes);

  const document = {
    schemaVersion: GROUND_RELEASE_SCHEMA_VERSION,
    releaseId: RELEASE_ID,
    cityId: baseDocument.cityId,
    configId: baseDocument.configId,
    partitionSchemeId: baseDocument.partitionSchemeId,
    ownershipLedgerId: baseDocument.ownershipLedgerId,
    generatedAt,
    immutable: true,
    sourceSnapshots: [
      ...baseDocument.sourceSnapshots,
      {
        datasetId: orthoManifest.sourceId,
        mappedViewId: null,
        rawSha256: orthoManifest.integrity.archiveSha256,
        sourceFeatureCount: orthoManifest.dataset.tileCount,
      },
    ],
    clip: baseDocument.clip,
    geometryValidation: baseDocument.geometryValidation,
    assets: mirroredAssets,
    claimCeilings: Object.fromEntries(
      [...ZONE_IMAGERY_CLASSES].sort().map((entry) => [entry, baseDocument.claimCeilings[entry]]),
    ),
    zoneImagery: {
      zoneRef: `${BASE_RELEASE_ID}:park+plaza+water@${baseDocument.partitionSchemeId}`,
      artifactRef: "zone-imagery.json",
      checksumSha256: indexChecksum,
      captureYear: CAPTURE_YEAR,
      attribution,
    },
    provenance: {
      sourceEpoch: `${orthoManifest.dataset.captureWindow.start}/${orthoManifest.dataset.captureWindow.end}`,
      termsUrl: orthoManifest.license.basisSource,
      attribution: `${attribution} Zone polygon geometry and ownership are unchanged from ${BASE_RELEASE_ID}: ${baseDocument.provenance.attribution}`,
      disclaimer: [
        `Imagery is the 2024 6-inch orthoimagery lot captured ${orthoManifest.dataset.captureWindow.start} to ${orthoManifest.dataset.captureWindow.end}; it depicts that window and nothing later.`,
        `Delivered at ${ZONE_IMAGERY_TARGET_GSD_METERS} m/px, a deliberate downsample from the source's 0.5 ft (0.152 m) ground sample distance, chosen to fit the citywide byte budget for a tier viewed at 400 m and beyond. Fine detail present in the source is not present here.`,
        "Each artifact is a RECTANGULAR texture covering its ownership cell's full WGS84 bounds. Nothing is masked at build time; the zone polygon shipped by the base release is the display mask. Pixels outside the zone polygon are real imagery of whatever else occupies the cell and must not be drawn.",
        "Reprojection EPSG:2263 -> WGS84 treats NAD83 as equivalent to WGS84. The horizontal difference in this region is under one metre, which is immaterial at tile granularity but is roughly one pixel at this texture resolution: a drape may be misregistered against its polygon by about a pixel from this cause alone.",
        "Decode and JPEG encode both run through macOS ImageIO via sips. Output was verified bit-identical across repeat runs ON THIS MACHINE; byte-reproducibility on a different macOS or ImageIO version is NOT claimed. What is pinned is the content, by SHA-256, recorded at build time.",
        `JPEG is lossy and was chosen because the polygon acts as the mask so no alpha channel is needed, and because the source is already lossy JPEG 2000. Quality ${JPEG_QUALITY}.`,
        "Imagery fails closed: an absent, unverified or mismatched index removes the entire imagery layer, and a mismatched artifact removes one cell's drape. In every case the base release's flat polygon tier still draws.",
      ].join(" "),
      localOnly: true,
      runtimeExternalNetwork: false,
    },
    fallback:
      "Imagery is additive over the flat cartographic tier declared by the mirrored base assets, which covers every distance and is unchanged by this release. The assets array mirrors the base release verbatim as a compatibility pin: its tier artifact refs resolve against the base release root, not this one, and if the base release is regenerated the mirrored checksums stop matching and this release fails validation rather than draping 2024 imagery over geometry it was never registered against.",
  };

  const documentCheck = validateGroundReleaseStructure(document);
  if (!documentCheck.ok) fail(`release document is invalid: ${JSON.stringify(documentCheck.issues.slice(0, 5))}`);

  writeFileSync(join(outputRoot, "release.json"), Buffer.from(stableSerialize(document), "utf8"));

  const totalBytes = entries.reduce((sum, entry) => sum + entry.byteSize, 0);
  const perClass = {};
  for (const entry of entries) {
    const bucket = (perClass[entry.class] ??= { artifacts: 0, bytes: 0 });
    bucket.artifacts += 1;
    bucket.bytes += entry.byteSize;
  }
  for (const refusal of refusals) (perClass[refusal.class] ??= { artifacts: 0, bytes: 0 }).refused = ((perClass[refusal.class].refused ?? 0) + 1);

  const report = {
    schemaVersion: BUILD_REPORT_SCHEMA_VERSION,
    releaseId: RELEASE_ID,
    generatedAt,
    jpegQuality: JPEG_QUALITY,
    targetGroundSampleDistanceMeters: ZONE_IMAGERY_TARGET_GSD_METERS,
    minimumCoveredFraction: MINIMUM_COVERED_FRACTION,
    candidates: mirroredAssets.length,
    artifacts: entries.length,
    refused: refusals.length,
    perClass,
    totalArtifactBytes: totalBytes,
    largestArtifactBytes: entries.reduce((max, entry) => Math.max(max, entry.byteSize), 0),
    indexChecksumSha256: indexChecksum,
  };
  writeFileSync(join(outputRoot, "build-report.json"), Buffer.from(stableSerialize(report), "utf8"));

  console.log(stableSerialize(report));
  // Wall time and decode counts are REAL build facts but they vary run to run,
  // so they stay out of the checksum-pinned root: a release whose bytes changed
  // because a cache was warm would defeat the determinism check entirely.
  process.stderr.write(
    `tilesDecodedThisRun=${mosaic.decodedCount} wallClockSeconds=${((Date.now() - started) / 1000).toFixed(1)}\n`,
  );
}

main();
