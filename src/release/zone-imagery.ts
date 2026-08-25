/**
 * Zone imagery contracts (Task T012).
 *
 * The T005 ground schema reserves exactly ONE `zoneImagery` seam per release
 * document — a single `{zoneRef, artifactRef, checksumSha256, captureYear,
 * attribution}` record, not a list. This module supplies what that one record
 * points AT: a checksum-pinned INDEX listing every per-cell, per-class texture
 * in the release, plus every refusal.
 *
 * That shape is deliberate, not a workaround. One checksum gates the entire
 * imagery layer, so a tampered or truncated index removes imagery WHOLE and the
 * polygon base draws exactly as it did before the imagery existed. Per-entry
 * checksums then gate each texture individually, so one corrupt JPEG costs one
 * cell's drape rather than the layer.
 *
 * WHAT A TEXTURE IS: a rectangular image covering an ownership cell's full
 * WGS84 bounds, NOT a cut-out of the zone polygon. Nothing is masked at build
 * time. The zone polygon that T006 already ships IS the display mask, and T013
 * drapes the rectangle through it. Masking here would bake a second, redundant,
 * and silently divergent copy of the geometry into the pixels.
 */

import {
  US_SURVEY_FOOT_METERS,
  wgs84ToEpsg2263,
  type Epsg2263Point,
} from "./ortho-projection.ts";

export const ZONE_IMAGERY_INDEX_SCHEMA_VERSION = "manhattan-zone-imagery-index-1" as const;

/**
 * The three ground classes that get imagery.
 *
 * Roadbed and sidewalk are excluded on purpose: at the flat tier's 400 m+
 * viewing distance they read as the cartographic base they are, and orthophoto
 * roadbed is dominated by parked cars and shadow that would date the release
 * far more visibly than a flat fill. Curb and crosswalk are embellishment
 * classes with no flat tier at all.
 */
export const ZONE_IMAGERY_CLASSES = ["park", "plaza", "water"] as const;
export type ZoneImageryClass = (typeof ZONE_IMAGERY_CLASSES)[number];

export function isZoneImageryClass(value: unknown): value is ZoneImageryClass {
  return typeof value === "string" && (ZONE_IMAGERY_CLASSES as readonly string[]).includes(value);
}

/**
 * Target ground sample distance, metres per pixel.
 *
 * Chosen by measurement against `CITYWIDE_BUDGETS.totalBytes` (300 MiB), not by
 * preference. At 0.61 m/px the 162 textures cost ~2.9 GB as stored-deflate PNG
 * and ~540 MiB as JPEG; at 1.2 m/px they cost ~135 MiB as JPEG, which leaves
 * real headroom under a budget that may not be re-baselined without explicit
 * approval. 1.2 m/px is the coarse end of the useful band for a tier viewed at
 * 400 m and beyond, and it is the end that fits.
 */
export const ZONE_IMAGERY_TARGET_GSD_METERS = 1.2;

/**
 * Source tile geometry, from the acquisition snapshot.
 *
 * 2500 ft square, decoded to 625 px, which is 4.0 ft per texel EXACTLY. The
 * exactness is load-bearing: it makes the decoded tiles a single seamless
 * mosaic on a global 4 ft grid, so a sample near a tile edge can take its four
 * bilinear neighbours from whichever tiles actually own them instead of
 * clamping inside one tile and leaving a visible seam.
 */
export const ZONE_IMAGERY_TILE_FEET = 2500;
export const ZONE_IMAGERY_TILE_DECODE_PIXELS = 625;
export const ZONE_IMAGERY_MOSAIC_FEET_PER_TEXEL =
  ZONE_IMAGERY_TILE_FEET / ZONE_IMAGERY_TILE_DECODE_PIXELS;

export interface ZoneBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface FeetBounds {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

export interface PixelGrid {
  width: number;
  height: number;
}

/**
 * The EPSG:2263 hull of a WGS84 rectangle, from ALL FOUR corners.
 *
 * Projecting only the min and max corner is wrong by ~0.85 m at this tile size:
 * a conic rotates the grid by its convergence angle, so a rectangle's
 * westernmost point and its southernmost point are DIFFERENT corners. That
 * error is under a metre, which is exactly what makes it dangerous — it never
 * looks broken, it just silently drops an edge tile that a cell genuinely
 * overlaps and leaves a hole in the drape.
 */
export function feetHullOfWgs84Rect(bounds: ZoneBounds): FeetBounds {
  const corners: Epsg2263Point[] = [
    wgs84ToEpsg2263(bounds.west, bounds.south),
    wgs84ToEpsg2263(bounds.east, bounds.south),
    wgs84ToEpsg2263(bounds.west, bounds.north),
    wgs84ToEpsg2263(bounds.east, bounds.north),
  ];
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  return {
    xmin: Math.min(...xs),
    ymin: Math.min(...ys),
    xmax: Math.max(...xs),
    ymax: Math.max(...ys),
  };
}

/** Half-open overlap of two feet rectangles. Shared edges do not overlap. */
export function feetBoundsOverlap(left: FeetBounds, right: FeetBounds): boolean {
  return (
    left.xmin < right.xmax &&
    right.xmin < left.xmax &&
    left.ymin < right.ymax &&
    right.ymin < left.ymax
  );
}

/**
 * Output pixel grid for a cell.
 *
 * RULE, stated once so the validator can recompute it: project the cell's four
 * WGS84 corners to EPSG:2263, take the hull, convert its width and height to
 * metres, divide by the target GSD, and round half-up to an integer with a
 * floor of 1. Deterministic from the ledger's cell bounds alone — the validator
 * derives the same grid without trusting the index.
 */
export function zoneImageryPixelGrid(bounds: ZoneBounds): PixelGrid {
  const hull = feetHullOfWgs84Rect(bounds);
  const widthMeters = (hull.xmax - hull.xmin) * US_SURVEY_FOOT_METERS;
  const heightMeters = (hull.ymax - hull.ymin) * US_SURVEY_FOOT_METERS;
  return {
    width: Math.max(1, Math.round(widthMeters / ZONE_IMAGERY_TARGET_GSD_METERS)),
    height: Math.max(1, Math.round(heightMeters / ZONE_IMAGERY_TARGET_GSD_METERS)),
  };
}

/**
 * Global mosaic texel index for a feet coordinate.
 *
 * Column grows east, row grows SOUTH (image order), both on the exact 4 ft
 * grid. Negative row indices are fine and expected; the row axis is anchored at
 * y = 0, which is far south of the data, purely so the mapping needs no origin
 * constant to agree between the builder and the validator.
 */
export function mosaicTexelColumn(xFeet: number): number {
  return Math.floor(xFeet / ZONE_IMAGERY_MOSAIC_FEET_PER_TEXEL);
}

export function mosaicTexelRow(yFeet: number): number {
  return Math.floor(-yFeet / ZONE_IMAGERY_MOSAIC_FEET_PER_TEXEL);
}

/** Centre of a mosaic texel, in feet. Inverse of the two functions above. */
export function mosaicTexelCentreFeet(column: number, row: number): Epsg2263Point {
  return {
    x: (column + 0.5) * ZONE_IMAGERY_MOSAIC_FEET_PER_TEXEL,
    y: -(row + 0.5) * ZONE_IMAGERY_MOSAIC_FEET_PER_TEXEL,
  };
}

/**
 * Centre of output pixel (column, row) in WGS84.
 *
 * Pixel centres, not corners: a texture sampled at its corners is half a pixel
 * off in both axes, which at 1.2 m/px is a 0.6 m registration error against the
 * polygon it drapes onto.
 */
export function zoneImageryPixelCentre(
  bounds: ZoneBounds,
  grid: PixelGrid,
  column: number,
  row: number,
): { longitude: number; latitude: number } {
  return {
    longitude: bounds.west + ((column + 0.5) / grid.width) * (bounds.east - bounds.west),
    latitude: bounds.north - ((row + 0.5) / grid.height) * (bounds.north - bounds.south),
  };
}

// ---------------------------------------------------------------------------
// BMP
// ---------------------------------------------------------------------------

export const BMP_HEADER_BYTES = 54;

/**
 * 24-bit BI_RGB BMP, bottom-up.
 *
 * BMP because it is the one raster format that is both trivially exact to write
 * from JavaScript and readable by `sips`, which does the JPEG encode. Writing
 * JPEG here instead would mean shipping a DCT encoder; writing PNG would mean
 * either an uncompressed stored-deflate file (the repo's deliberate choice in
 * `procedural-texture.ts`, ~3 bytes/px) or `node:zlib`, whose output that same
 * module documents as not stable across versions.
 *
 * Bottom-up (positive height) rather than the top-down form `sips` itself
 * emits, because bottom-up is the universally supported orientation.
 */
export function encodeBmp24(width: number, height: number, rgb: Uint8Array): Uint8Array {
  if (!Number.isSafeInteger(width) || width <= 0) throw new Error("BMP width must be a positive integer.");
  if (!Number.isSafeInteger(height) || height <= 0) throw new Error("BMP height must be a positive integer.");
  if (rgb.length !== width * height * 3) throw new Error("BMP pixel buffer must be width * height * 3 bytes.");

  const stride = (width * 3 + 3) & ~3;
  const pixelBytes = stride * height;
  const output = new Uint8Array(BMP_HEADER_BYTES + pixelBytes);
  const view = new DataView(output.buffer);

  output[0] = 0x42;
  output[1] = 0x4d;
  view.setUint32(2, output.length, true);
  view.setUint32(10, BMP_HEADER_BYTES, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelBytes, true);
  // 2835 px/m is 72 dpi. Any constant works; a constant is what determinism needs.
  view.setUint32(38, 2835, true);
  view.setUint32(42, 2835, true);

  for (let row = 0; row < height; row += 1) {
    const sourceRow = height - 1 - row;
    let target = BMP_HEADER_BYTES + row * stride;
    let source = sourceRow * width * 3;
    for (let column = 0; column < width; column += 1) {
      output[target] = rgb[source + 2] as number;
      output[target + 1] = rgb[source + 1] as number;
      output[target + 2] = rgb[source] as number;
      target += 3;
      source += 3;
    }
  }
  return output;
}

export interface DecodedBmp {
  width: number;
  height: number;
  /** Tightly packed RGB, top-down. */
  rgb: Uint8Array;
}

/**
 * Reads the 24-bit BMPs `sips` produces, in either orientation.
 *
 * Deliberately narrow: uncompressed 24bpp only, which is what
 * `sips -s format bmp` emits for these tiles. Anything else throws rather than
 * guessing, because a silently misread raster becomes wrong pixels in a
 * checksum-pinned artifact.
 */
export function decodeBmp24(bytes: Uint8Array): DecodedBmp {
  if (bytes.length < BMP_HEADER_BYTES || bytes[0] !== 0x42 || bytes[1] !== 0x4d) {
    throw new Error("Not a BMP file.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dataOffset = view.getUint32(10, true);
  const width = view.getInt32(18, true);
  const rawHeight = view.getInt32(22, true);
  const bitsPerPixel = view.getUint16(28, true);
  const compression = view.getUint32(30, true);
  if (bitsPerPixel !== 24) throw new Error(`Unsupported BMP depth ${bitsPerPixel}; expected 24.`);
  if (compression !== 0) throw new Error(`Unsupported BMP compression ${compression}; expected BI_RGB.`);
  if (width <= 0 || rawHeight === 0) throw new Error("Degenerate BMP dimensions.");

  const topDown = rawHeight < 0;
  const height = Math.abs(rawHeight);
  const stride = (width * 3 + 3) & ~3;
  if (bytes.length < dataOffset + stride * height) throw new Error("BMP pixel data is truncated.");

  const rgb = new Uint8Array(width * height * 3);
  for (let row = 0; row < height; row += 1) {
    const sourceRow = topDown ? row : height - 1 - row;
    let source = dataOffset + sourceRow * stride;
    let target = row * width * 3;
    for (let column = 0; column < width; column += 1) {
      rgb[target] = bytes[source + 2] as number;
      rgb[target + 1] = bytes[source + 1] as number;
      rgb[target + 2] = bytes[source] as number;
      source += 3;
      target += 3;
    }
  }
  return { width, height, rgb };
}

// ---------------------------------------------------------------------------
// Index document
// ---------------------------------------------------------------------------

export interface ZoneImageryEntry {
  zoneRef: string;
  cellId: string;
  class: ZoneImageryClass;
  artifactRef: string;
  checksumSha256: string;
  byteSize: number;
  pixelWidth: number;
  pixelHeight: number;
  bounds: ZoneBounds;
  sourceTiles: string[];
  coveredPixelFraction: number;
}

export interface ZoneImageryRefusal {
  zoneRef: string;
  cellId: string;
  class: ZoneImageryClass;
  reason: string;
}

export interface ZoneImageryIndex {
  schemaVersion: typeof ZONE_IMAGERY_INDEX_SCHEMA_VERSION;
  releaseId: string;
  baseReleaseId: string;
  partitionSchemeId: string;
  generatedAt: string;
  captureYear: number;
  attribution: string;
  targetGroundSampleDistanceMeters: number;
  entries: ZoneImageryEntry[];
  refusals: ZoneImageryRefusal[];
}

export interface ZoneImageryIssue {
  path: string;
  message: string;
}

export function zoneRef(cellId: string, imageryClass: ZoneImageryClass): string {
  return `${cellId}/${imageryClass}`;
}

const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Structural validation of the index.
 *
 * Structure only — on-disk bytes, checksums and grid re-derivation are the
 * validator script's job, because those need the filesystem and the base
 * release. Splitting it this way lets the build, the validator and the tests
 * share one definition of "well formed" without any of them restating it.
 */
export function validateZoneImageryIndex(value: unknown): {
  ok: boolean;
  issues: ZoneImageryIssue[];
} {
  const issues: ZoneImageryIssue[] = [];
  const issue = (path: string, message: string): void => {
    issues.push({ path, message });
  };

  if (!isRecord(value)) return { ok: false, issues: [{ path: "$", message: "Index must be an object." }] };

  if (value.schemaVersion !== ZONE_IMAGERY_INDEX_SCHEMA_VERSION) {
    issue("schemaVersion", "Unsupported zone imagery index schema.");
  }
  for (const field of ["releaseId", "baseReleaseId", "partitionSchemeId", "generatedAt", "attribution"] as const) {
    if (!isNonEmptyString(value[field])) issue(field, "Identity field is required.");
  }
  if (!Number.isSafeInteger(value.captureYear)) issue("captureYear", "Capture year must be a safe integer.");
  if (value.targetGroundSampleDistanceMeters !== ZONE_IMAGERY_TARGET_GSD_METERS) {
    issue("targetGroundSampleDistanceMeters", "Declared GSD must match the pinned build constant.");
  }

  if (!Array.isArray(value.entries)) issue("entries", "Entries must be an array.");
  else {
    const seen = new Set<string>();
    value.entries.forEach((entry, index) => {
      const path = `entries[${index}]`;
      if (!isRecord(entry)) return issue(path, "Entry must be an object.");
      if (!isNonEmptyString(entry.cellId)) issue(`${path}.cellId`, "Cell id is required.");
      if (!isZoneImageryClass(entry.class)) issue(`${path}.class`, "Unknown imagery class.");
      if (isNonEmptyString(entry.cellId) && isZoneImageryClass(entry.class)) {
        const expected = zoneRef(entry.cellId, entry.class);
        if (entry.zoneRef !== expected) issue(`${path}.zoneRef`, "Zone ref must be `<cellId>/<class>`.");
        if (seen.has(expected)) issue(`${path}.zoneRef`, "Zone refs must be unique.");
        else seen.add(expected);
      }
      if (!isNonEmptyString(entry.artifactRef) || (entry.artifactRef as string).includes("..")) {
        issue(`${path}.artifactRef`, "Artifact ref must be a safe relative path.");
      }
      if (typeof entry.checksumSha256 !== "string" || !CHECKSUM_PATTERN.test(entry.checksumSha256)) {
        issue(`${path}.checksumSha256`, "Checksum must be lowercase SHA-256.");
      }
      for (const field of ["byteSize", "pixelWidth", "pixelHeight"] as const) {
        const numeric = entry[field];
        if (!Number.isSafeInteger(numeric) || (numeric as number) <= 0) {
          issue(`${path}.${field}`, "Must be a positive integer.");
        }
      }
      const fraction = entry.coveredPixelFraction;
      if (typeof fraction !== "number" || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
        issue(`${path}.coveredPixelFraction`, "Covered pixel fraction must lie in [0, 1].");
      }
      if (!isRecord(entry.bounds)) issue(`${path}.bounds`, "Bounds are required.");
      if (!Array.isArray(entry.sourceTiles) || entry.sourceTiles.length === 0) {
        issue(`${path}.sourceTiles`, "At least one contributing source tile must be recorded.");
      }
    });
  }

  if (!Array.isArray(value.refusals)) issue("refusals", "Refusals must be an array; an empty array is the claim that nothing was refused.");
  else {
    value.refusals.forEach((refusal, index) => {
      const path = `refusals[${index}]`;
      if (!isRecord(refusal)) return issue(path, "Refusal must be an object.");
      if (!isNonEmptyString(refusal.cellId)) issue(`${path}.cellId`, "Cell id is required.");
      if (!isZoneImageryClass(refusal.class)) issue(`${path}.class`, "Unknown imagery class.");
      if (!isNonEmptyString(refusal.reason)) issue(`${path}.reason`, "A refusal must carry a reason; a silent gap is the defect this field exists to prevent.");
    });
  }

  return { ok: issues.length === 0, issues };
}
