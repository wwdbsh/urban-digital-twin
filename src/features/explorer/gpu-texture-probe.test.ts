/**
 * The GPU texture probe, validated as an INSTRUMENT before it is used as one.
 *
 * The claim the campaign rests on is arithmetic: an uncompressed 128 x 128 RGBA
 * base level is 65,536 bytes, so N unique tiles are N x 65,536. If the reading
 * disagrees with that on a scene whose N is known, the reading is measuring
 * something other than what this module says it measures, and no delta taken
 * with it means anything.
 */
import { describe, expect, it } from "vitest";
import {
  PROBE_MIP_CHAIN_MULTIPLIER,
  PROBE_TILE_WIRE_BYTES,
  baseLevelByteLength,
  predictedTextureByteLength,
  projectTextureByteLength,
  readGpuTextureProbe,
  validateGpuTextureProbe,
} from "./gpu-texture-probe";

describe("the GPU texture probe", () => {
  it("states the wire-versus-GPU expansion rather than conflating them", () => {
    // 16,580 PNG bytes on the wire; 65,536 as an RGBA base level; 87,381 with
    // the pyramid Cesium accounts for. The last of those is the MEASURED
    // per-texture cost on both campaign arms and is pinned here.
    expect(baseLevelByteLength(1)).toBe(65_536);
    expect(predictedTextureByteLength(1)).toBe(87_381);
    expect(predictedTextureByteLength(1) - baseLevelByteLength(1)).toBe(21_845);
    expect(predictedTextureByteLength(1) / PROBE_TILE_WIRE_BYTES).toBeCloseTo(5.27, 2);
    // The two campaign readings, reproduced from arithmetic alone.
    expect(predictedTextureByteLength(4)).toBe(349_524);
    expect(predictedTextureByteLength(174)).toBe(15_204_294);
    expect(predictedTextureByteLength(941)).toBe(82_225_521);
  });

  it("reads Cesium's statistics defensively and returns null rather than a zero", () => {
    // A null reading and a zero reading mean opposite things; a probe that
    // reported 0 for "the export moved" would report a spectacular saving.
    expect(readGpuTextureProbe(null)).toBeNull();
    expect(readGpuTextureProbe({})).toBeNull();
    expect(readGpuTextureProbe({ statistics: { geometryByteLength: 1 } })).toBeNull();
    expect(readGpuTextureProbe({ statistics: { texturesByteLength: 262_144, geometryByteLength: 4_096 }, cacheEntries: { a: 1, b: 2 } }))
      .toStrictEqual({ texturesByteLength: 262_144, geometryByteLength: 4_096, resourceCacheEntryCount: 2 });
  });

  it("validates exactly, with no tolerance to hide a disagreement in", () => {
    // The LIVE `-t1` reading, validated against its known resident count of 4.
    const reading = { texturesByteLength: 349_524, geometryByteLength: 6_971_032, resourceCacheEntryCount: 1_546 };
    expect(validateGpuTextureProbe(reading, 4)).toStrictEqual({
      uniqueTextureCount: 4,
      predictedTextureByteLength: 349_524,
      measuredTextureByteLength: 349_524,
      deltaByteLength: 0,
      agrees: true,
    });
    // One texture out is a failed validation, not a rounding difference. This
    // exactness is what refuted the module's original base-level-only claim.
    expect(validateGpuTextureProbe(reading, 5).agrees).toBe(false);
    // And the `-p1` reading at the same pose, validated against 174.
    expect(validateGpuTextureProbe({ texturesByteLength: 15_204_294, geometryByteLength: 6_971_032, resourceCacheEntryCount: 1_716 }, 174).agrees).toBe(true);
  });

  it("labels a projection as a projection and shows its arithmetic", () => {
    const projection = projectTextureByteLength({ measuredTextureCount: 4, measuredByteLength: 349_524, projectedTextureCount: 941 });
    expect(projection.perTextureByteLength).toBe(87_381);
    expect(projection.projectedByteLength).toBe(82_225_521);
    expect(projection.basis).toContain("Projection, not a measurement");
    expect(projection.basis).toContain("mip chain included");
    expect(PROBE_MIP_CHAIN_MULTIPLIER).toBeCloseTo(1.333, 3);
  });
});
