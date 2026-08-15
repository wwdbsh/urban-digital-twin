/**
 * The GPU TEXTURE PROBE (T002, ADR 0047).
 *
 * ## What it reads, and what that number is NOT
 *
 * `ResourceCache.statistics.texturesByteLength` and `.geometryByteLength` are
 * Cesium's OWN accounting of what it has uploaded, maintained on the CPU side as
 * loaders add and remove resources. Four things have to be said about it before
 * any figure derived from it is quoted:
 *
 *   1. **IT INCLUDES THE MIP CHAIN, and this was established by MEASUREMENT
 *      rather than assumed.** This module first claimed the reading was
 *      base-level only. Instrument validation against a scene with a known
 *      texture count refuted that in one step: the reading divides EXACTLY by
 *      87,381 bytes per texture, not by the 65,536 an uncompressed 128 x 128
 *      RGBA base level costs. 87,381 is `65,536 * 4 / 3` truncated — Cesium adds
 *      a third for the pyramid when a texture is mipmapped, which the shipped
 *      LINEAR_MIPMAP_LINEAR sampler is. The base level is therefore 75% of the
 *      figure and the pyramid 25% of it, and both halves are stated below rather
 *      than folded together. This correction is the whole reason instrument
 *      validation runs before any delta is quoted.
 *   2. **CPU-SIDE ACCOUNTING, not a driver query.** It is what Cesium believes it
 *      uploaded, not what the GPU reports. Driver-side padding, alignment and
 *      format promotion are invisible to it.
 *   3. **A CESIUM-INTERNAL EXPORT.** `ResourceCache.statistics` is not part of the
 *      public API contract. The reading is pinned at the installed version
 *      (cesium 1.143.0 / @cesium/engine 26.1.0) and a version bump invalidates it
 *      rather than adjusting it.
 *   4. **WIRE BYTES ARE NOT GPU BYTES.** A tile is 16,580 PNG bytes on the wire
 *      128 x 128 x 4 = 65,536 bytes as an uncompressed RGBA base level, and
 *      87,381 bytes as Cesium accounts for it with mips — a 5.27x expansion
 *      from the wire. Any sentence that mixes the three is wrong.
 *
 * ADR 0040 D7 recorded that decoded GPU bytes are "not observable from outside
 * Cesium". That is too strong in exactly this one place, and ADR 0047 records the
 * correction. It stays true of the exterior cache release seam, which frees no
 * GPU byte and measures none.
 *
 * ## Instrument validation comes FIRST
 *
 * `predictedTextureByteLength` states what the reading SHOULD be for a known
 * scene, from the tile dimensions and count alone. The campaign compares
 * prediction against reading on a small scene BEFORE believing any delta on a
 * large one. An instrument that disagrees with arithmetic on four textures has
 * not earned the right to be quoted on 941.
 */

/** The shipped tile: 128 x 128 grayscale PNG, uploaded as RGBA8. */
export const PROBE_TILE_PIXELS = { width: 128, height: 128 } as const;
export const PROBE_TILE_WIRE_BYTES = 16_580 as const;
export const PROBE_TEXEL_BYTES = 4 as const;
/**
 * Cesium adds a third for a mipmapped texture, truncated. Confirmed against the
 * live reading, which divides exactly by the result on both campaign arms.
 */
export const PROBE_MIP_CHAIN_MULTIPLIER = 4 / 3;

/** The uncompressed base level alone: what the pyramid is a third on top of. */
export function baseLevelByteLength(uniqueTextureCount: number, pixels: { width: number; height: number } = PROBE_TILE_PIXELS): number {
  return uniqueTextureCount * pixels.width * pixels.height * PROBE_TEXEL_BYTES;
}

/**
 * What `texturesByteLength` SHOULD read for a known count of mipmapped tiles.
 *
 * The truncation is Cesium's and is reproduced rather than rounded away: an
 * approximation here would turn an exact agreement into a near-agreement and
 * cost the validation all of its force.
 */
export function predictedTextureByteLength(uniqueTextureCount: number, pixels: { width: number; height: number } = PROBE_TILE_PIXELS): number {
  return uniqueTextureCount * Math.trunc((pixels.width * pixels.height * PROBE_TEXEL_BYTES * 4) / 3);
}

export interface GpuTextureProbeReading {
  /**
   * Cesium's own CPU-side accounting of uploaded texture bytes, MIP CHAIN
   * INCLUDED — 87,381 per 128 x 128 RGBA tile, of which 65,536 is the base
   * level. Established by instrument validation, not assumed; see the header.
   */
  texturesByteLength: number;
  geometryByteLength: number;
  /** Live entries in the resource cache, as a residency witness. */
  resourceCacheEntryCount: number;
}

/**
 * Reads the statistics off whatever `ResourceCache` object is handed in.
 *
 * The cache is passed rather than imported so this module has no Cesium import
 * at all: the reading is then testable without a renderer, and the one place
 * that names a Cesium internal is the call site in the app.
 */
export function readGpuTextureProbe(resourceCache: unknown): GpuTextureProbeReading | null {
  const statistics = (resourceCache as { statistics?: { texturesByteLength?: unknown; geometryByteLength?: unknown } } | null)?.statistics;
  const entries = (resourceCache as { cacheEntries?: Record<string, unknown> } | null)?.cacheEntries;
  if (!statistics || typeof statistics.texturesByteLength !== "number" || typeof statistics.geometryByteLength !== "number") return null;
  return {
    texturesByteLength: statistics.texturesByteLength,
    geometryByteLength: statistics.geometryByteLength,
    resourceCacheEntryCount: entries && typeof entries === "object" ? Object.keys(entries).length : -1,
  };
}

export interface GpuTextureProbeVerdict {
  uniqueTextureCount: number;
  predictedTextureByteLength: number;
  measuredTextureByteLength: number;
  /** Measured minus predicted; zero is the only clean result on a known scene. */
  deltaByteLength: number;
  agrees: boolean;
}

/**
 * The instrument-validation verdict, on a scene whose unique texture count is
 * KNOWN. `agrees` is exact equality, not a tolerance: the arithmetic is
 * `count * w * h * 4` and Cesium's own accounting does the same arithmetic, so
 * anything but zero means the probe is measuring something other than what this
 * module claims it measures.
 */
export function validateGpuTextureProbe(reading: GpuTextureProbeReading, uniqueTextureCount: number): GpuTextureProbeVerdict {
  const predicted = predictedTextureByteLength(uniqueTextureCount);
  return {
    uniqueTextureCount,
    predictedTextureByteLength: predicted,
    measuredTextureByteLength: reading.texturesByteLength,
    deltaByteLength: reading.texturesByteLength - predicted,
    agrees: reading.texturesByteLength === predicted,
  };
}

/**
 * The labelled PROJECTION for a population the campaign did not have resident.
 *
 * It is arithmetic over a measured per-texture cost, and it is labelled a
 * projection everywhere it appears. `measuredTextureCount` is what was actually
 * resident when `measuredByteLength` was read; the projection restates that cost
 * over a stated larger count. It measures nothing.
 */
export function projectTextureByteLength(options: { measuredTextureCount: number; measuredByteLength: number; projectedTextureCount: number }): { perTextureByteLength: number; projectedByteLength: number; basis: string } {
  const perTexture = options.measuredTextureCount === 0 ? 0 : options.measuredByteLength / options.measuredTextureCount;
  return {
    perTextureByteLength: perTexture,
    projectedByteLength: perTexture * options.projectedTextureCount,
    basis: `Projection, not a measurement: ${options.measuredByteLength} bytes measured over ${options.measuredTextureCount} resident textures (${perTexture} each, mip chain included), restated over ${options.projectedTextureCount} textures. It assumes every projected texture costs what the measured ones cost, which is true for this catalogue because all four tiles are the same dimensions and format.`,
  };
}
