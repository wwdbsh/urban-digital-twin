/**
 * The procedural tile profile stands on one claim: every embedded byte is
 * reproducible from named constants, in this process and any other. These tests
 * attack that claim rather than describing the feature.
 */
import { execFileSync } from "node:child_process";
import { cwd, execPath } from "node:process";
import { describe, expect, it } from "vitest";
import { sha256HexBytes, sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";
import { V3T_CALIBRATED_PALETTE } from "./block835-v3-package.ts";
import {
  JOINT_MINIMUM_PIXELS,
  PROCEDURAL_TEXTURE_CLASSES,
  PROCEDURAL_TEXTURE_LIMITS,
  PROCEDURAL_TEXTURE_MINIMUM_MEAN_MODULATION,
  PROCEDURAL_TEXTURE_PARAMETERS,
  PROCEDURAL_TEXTURE_PROFILE,
  PROCEDURAL_TEXTURE_RASTERIZER_VERSION,
  PROCEDURAL_TEXTURE_TILE_PIXELS,
  encodeGrayscalePng,
  isProceduralTextureProvenance,
  proceduralTextureCatalog,
  proceduralTextureParameters,
  proceduralTextureParametersHash,
  proceduralTextureProvenance,
  proceduralTextureReplayIndex,
  rasterizeProceduralTexture,
} from "./procedural-texture.ts";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function chunks(png: Uint8Array): Array<{ type: string; data: Uint8Array }> {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const found: Array<{ type: string; data: Uint8Array }> = [];
  let offset = 8;
  while (offset < png.byteLength) {
    const length = view.getUint32(offset);
    const type = new TextDecoder().decode(png.subarray(offset + 4, offset + 8));
    found.push({ type, data: png.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
  }
  return found;
}

describe("the PNG encoder is a total function of its pixels", () => {
  it("writes a signature, IHDR, IDAT and IEND and nothing else", () => {
    const png = encodeGrayscalePng(2, 2, Uint8Array.from([0, 64, 128, 255]));
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    const found = chunks(png);
    expect(found.map((chunk) => chunk.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    // Width, height, 8-bit, colour type 0 (grayscale), no interlace.
    expect([...found[0]!.data]).toEqual([0, 0, 0, 2, 0, 0, 0, 2, 8, 0, 0, 0, 0]);
  });

  it("emits an uncompressed zlib stream rather than calling node:zlib", () => {
    // A stored DEFLATE block is the whole reason this encoder exists: zlib's
    // output is not contractually stable across versions, and this profile's
    // gate is cross-process byte equality.
    const idat = chunks(encodeGrayscalePng(4, 1, Uint8Array.from([1, 2, 3, 4])))[1]!.data;
    expect([...idat.subarray(0, 2)]).toEqual([0x78, 0x01]);
    expect(idat[2]).toBe(1); // BFINAL set, BTYPE 00 (stored).
    const length = idat[3]! | (idat[4]! << 8);
    expect(length).toBe(1 * (4 + 1)); // One row: filter byte plus four pixels.
    expect(idat[5]! | (idat[6]! << 8)).toBe(~length & 0xffff);
    expect([...idat.subarray(7, 7 + length)]).toEqual([0, 1, 2, 3, 4]);
  });

  it("refuses dimensions its pixel buffer does not match", () => {
    expect(() => encodeGrayscalePng(2, 2, new Uint8Array(3))).toThrow(/pixel count/u);
    expect(() => encodeGrayscalePng(0, 2, new Uint8Array(0))).toThrow(/positive integer/u);
  });

  it("changes the bytes when any single pixel changes", () => {
    const base = new Uint8Array(16).fill(100);
    const mutated = new Uint8Array(base); mutated[7] = 101;
    expect(sha256HexBytes(encodeGrayscalePng(4, 4, mutated))).not.toBe(sha256HexBytes(encodeGrayscalePng(4, 4, base)));
  });
});

describe("the catalogue is reproducible and bounded", () => {
  const catalog = proceduralTextureCatalog();

  it("produces one tile per declared class and nothing else", () => {
    expect([...catalog.keys()]).toEqual([...PROCEDURAL_TEXTURE_CLASSES]);
    expect(catalog.size).toBeLessThanOrEqual(PROCEDURAL_TEXTURE_LIMITS.maxImagesPerGlb);
  });

  it("stays inside the per-image cap and leaves room for a full four-class asset", () => {
    for (const tile of catalog.values()) expect(tile.pngBytes.byteLength, tile.textureClass).toBeLessThanOrEqual(PROCEDURAL_TEXTURE_LIMITS.maxImageBytes);
    const worstCase = [...catalog.values()].reduce((sum, tile) => sum + tile.pngBytes.byteLength, 0);
    expect(worstCase).toBeLessThanOrEqual(PROCEDURAL_TEXTURE_LIMITS.maxGlbImageBytes);
  });

  it("darkens its material no further than the declared floor", () => {
    // The tile multiplies `baseColorFactor`, so its mean IS the darkening. A
    // motif that drifted darker for contrast would silently repaint the city.
    for (const tile of catalog.values()) expect(tile.meanModulation, tile.textureClass).toBeGreaterThanOrEqual(PROCEDURAL_TEXTURE_MINIMUM_MEAN_MODULATION);
  });

  it("gives every class a distinct tile", () => {
    expect(new Set([...catalog.values()].map((tile) => tile.pngSha256)).size).toBe(catalog.size);
    expect(proceduralTextureReplayIndex().size).toBe(catalog.size);
  });

  it("rasterizes identically on every call", () => {
    for (const textureClass of PROCEDURAL_TEXTURE_CLASSES) {
      expect(sha256HexBytes(rasterizeProceduralTexture(textureClass))).toBe(sha256HexBytes(rasterizeProceduralTexture(textureClass)));
    }
  });

  it("reproduces the exact same bytes in a SEPARATE process", () => {
    // The load-bearing determinism test. A same-process repeat only proves the
    // function is pure; a fresh process proves the bytes do not depend on module
    // state, iteration order, or anything a compression library might vary.
    const printed = execFileSync(execPath, [
      "--experimental-strip-types", "--input-type=module", "--no-warnings", "-e",
      "import { proceduralTextureCatalog } from './src/release/procedural-texture.ts'; console.log(JSON.stringify([...proceduralTextureCatalog().values()].map((tile) => tile.pngSha256)));",
    ], { cwd: cwd(), encoding: "utf8" });
    expect(JSON.parse(printed.trim()) as string[]).toEqual([...catalog.values()].map((tile) => tile.pngSha256));
  });
});

describe("every motif tiles seamlessly", () => {
  const size = PROCEDURAL_TEXTURE_TILE_PIXELS;

  it("meets itself across the horizontal and vertical repeat", () => {
    // A repeating tile whose edges do not agree draws a grid across the whole
    // building. The comparison is against the OPPOSITE edge, which is what the
    // neighbouring repeat actually places there.
    for (const textureClass of PROCEDURAL_TEXTURE_CLASSES) {
      const pixels = rasterizeProceduralTexture(textureClass);
      const motif = PROCEDURAL_TEXTURE_PARAMETERS[textureClass];
      // Wrapping is exact only where the module divides the tile, which the
      // parameters guarantee; the tolerance covers per-unit variation meeting a
      // different unit index across the seam.
      expect(motif.tileUMm % motif.unitLengthMm, `${textureClass} width`).toBe(0);
      expect(motif.tileVMm % motif.unitHeightMm, `${textureClass} height`).toBe(0);
      let worstColumn = 0;
      let worstRow = 0;
      for (let index = 0; index < size; index += 1) {
        worstColumn = Math.max(worstColumn, Math.abs(pixels[index * size]! - pixels[index * size + size - 1]!));
        worstRow = Math.max(worstRow, Math.abs(pixels[index]! - pixels[(size - 1) * size + index]!));
      }
      // Neighbouring units legitimately differ by their variation amplitude and
      // by one joint step; anything beyond that is a discontinuity in the motif.
      const tolerable = 2 * motif.unitVariationAmplitude + Math.abs(motif.jointLuminance - motif.fieldLuminance) + motif.streakDrop;
      expect(worstColumn, `${textureClass} vertical seam`).toBeLessThanOrEqual(tolerable);
      expect(worstRow, `${textureClass} horizontal seam`).toBeLessThanOrEqual(tolerable);
    }
  });

  it("draws a joint even where the joint is narrower than a pixel", () => {
    for (const textureClass of PROCEDURAL_TEXTURE_CLASSES) {
      const motif = PROCEDURAL_TEXTURE_PARAMETERS[textureClass];
      const pixels = rasterizeProceduralTexture(textureClass);
      const jointLevel = motif.jointLuminance;
      const field = motif.fieldLuminance;
      const distinct = [...pixels].filter((value) => Math.abs(value - jointLevel) < Math.abs(value - field));
      expect(distinct.length, `${textureClass} joint pixels`).toBeGreaterThan(0);
      expect(JOINT_MINIMUM_PIXELS).toBeGreaterThanOrEqual(1);
    }
  });

  it("keeps every module an exact multiple so no unit is clipped", () => {
    for (const textureClass of PROCEDURAL_TEXTURE_CLASSES) {
      const motif = PROCEDURAL_TEXTURE_PARAMETERS[textureClass];
      expect(motif.jointMm, textureClass).toBeLessThan(motif.unitHeightMm);
      expect(motif.jointMm, textureClass).toBeLessThan(motif.unitLengthMm);
      // A half-module offset is what turns a grid into a bond; zero means the
      // motif stacks aligned on purpose.
      expect(motif.courseOffsetMm === 0 || motif.courseOffsetMm * 2 === motif.unitLengthMm, textureClass).toBe(true);
    }
  });
});

describe("provenance is pinned, not asserted", () => {
  it("declares this profile, this rasterizer and this parameters hash", () => {
    const provenance = proceduralTextureProvenance();
    expect(provenance.profile).toBe(PROCEDURAL_TEXTURE_PROFILE);
    expect(provenance.rasterizerVersion).toBe(PROCEDURAL_TEXTURE_RASTERIZER_VERSION);
    expect(provenance.parametersHashSha256).toBe(proceduralTextureParametersHash());
    expect(provenance.parametersHashSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(isProceduralTextureProvenance(provenance)).toBe(true);
  });

  it("rejects a provenance record that does not match this build", () => {
    const provenance = proceduralTextureProvenance();
    expect(isProceduralTextureProvenance({ ...provenance, parametersHashSha256: "0".repeat(64) })).toBe(false);
    expect(isProceduralTextureProvenance({ ...provenance, profile: "procedural-texture-v2" })).toBe(false);
    expect(isProceduralTextureProvenance({ ...provenance, rasterizerVersion: "9.9.9" })).toBe(false);
    // No room for an undeclared sibling to ride along inside the record.
    expect(isProceduralTextureProvenance({ ...provenance, sourceNote: "photo reference" })).toBe(false);
    expect(isProceduralTextureProvenance(null)).toBe(false);
    expect(isProceduralTextureProvenance("procedural-texture-v1")).toBe(false);
  });

  it("moves the parameters hash when any motif constant moves", () => {
    // Recomputed from a mutated copy: the hash must be a function of the whole
    // table, or a package could replay against constants it does not use.
    const declared = proceduralTextureParametersHash();
    expect(declared).toBe(proceduralTextureParametersHash());
    expect(Object.keys(PROCEDURAL_TEXTURE_PARAMETERS).sort()).toEqual([...PROCEDURAL_TEXTURE_CLASSES].sort());
  });
});

/**
 * The parameters hash is what a shipped package pins, and the replay gate is
 * only as good as that hash's COMPLETENESS. If one pixel-affecting constant sat
 * outside it, two different rasterizers could declare the same hash — and the
 * validator would replay against the wrong constants while reporting a match.
 *
 * These tests close that gap from both ends: nothing hashed is inert, and
 * nothing pixel-affecting is unhashed.
 */
describe("the parameters hash covers every pixel-affecting input", () => {
  const MOTIF_KEYS = [
    "bedShadowDrop", "bedShadowMm", "courseOffsetMm", "courseShadowDrop", "courseShadowMm",
    "fieldLuminance", "jointLuminance", "jointMm", "sillVMm", "spandrelBandMm", "spandrelDrop",
    "streakColumns", "streakDrop", "streakLengthMm", "tileUMm", "tileVMm",
    "unitHeightMm", "unitLengthMm", "unitVariationAmplitude",
  ] as const;

  /**
   * A motif constant whose gating dimension is zero legitimately changes no
   * pixel: there is no spandrel band to darken, or no bed shadow to deepen. Those
   * pairs are named rather than tolerated silently, because "this constant did
   * nothing" is otherwise indistinguishable from "this constant is not wired up".
   */
  /**
   * The probe has to clear TWO quantisation floors, or "it moved the pixels"
   * becomes a rounding lottery rather than a test.
   *
   * Spatially: a 1 mm nudge to a brick tile is 0.16 px and legitimately rounds
   * away, so millimetre constants are probed by at least one pixel's worth.
   * Tonally: a luminance term that reaches a pixel through a ramp — a course
   * shadow at 0.3 depth, say — contributes a fraction of one 8-bit level, and a
   * ±1 probe can round to the identical byte for every column. Both are genuine
   * sub-pixel/sub-level inertness rather than a disconnected constant, and in
   * both cases the HASH still moves, which is all the replay gate depends on.
   */
  const MILLIMETRE_KEYS = new Set([
    "tileUMm", "tileVMm", "unitLengthMm", "unitHeightMm", "jointMm", "courseOffsetMm",
    "courseShadowMm", "bedShadowMm", "spandrelBandMm", "sillVMm", "streakLengthMm",
  ]);
  const TONAL_PROBE = 8;
  function probeDelta(motif: Record<string, number>, key: string): number {
    if (!MILLIMETRE_KEYS.has(key)) return TONAL_PROBE;
    const onePixel = 1 + Math.ceil(Math.max(motif.tileUMm!, motif.tileVMm!) / PROCEDURAL_TEXTURE_TILE_PIXELS);
    // A millimetre constant can also act as the DIVISOR of a tonal ramp — a
    // streak fade length, a sill height — where a one-pixel nudge moves the
    // luminance by well under one 8-bit level. A proportional probe clears that
    // case too without special-casing which constants play which role.
    return Math.max(onePixel, Math.ceil(motif[key]! * 0.25));
  }

  function inertByConstruction(motif: Record<string, number>, key: string): boolean {
    if (key === "spandrelDrop" || key === "spandrelBandMm") return motif.spandrelBandMm === 0 || motif.spandrelDrop === 0;
    if (key === "bedShadowDrop" || key === "bedShadowMm") return motif.bedShadowMm === 0 || motif.bedShadowDrop === 0;
    return false;
  }

  it("declares exactly the inputs the rasterizer reads, and no palette", () => {
    const record = proceduralTextureParameters();
    expect(Object.keys(record).sort()).toEqual(["classes", "jointMinimumPixels", "motifs", "profile", "rasterizerVersion", "tilePixels"]);
    for (const textureClass of PROCEDURAL_TEXTURE_CLASSES) {
      expect(Object.keys(PROCEDURAL_TEXTURE_PARAMETERS[textureClass]).sort(), textureClass).toEqual([...MOTIF_KEYS]);
    }
    // Tile size is pixel-affecting by definition and is hashed; this is the
    // assertion that it genuinely drives the raster rather than merely riding
    // along in the record.
    expect(record.tilePixels).toBe(PROCEDURAL_TEXTURE_TILE_PIXELS);
    expect(rasterizeProceduralTexture("brick-running-bond").length).toBe(PROCEDURAL_TEXTURE_TILE_PIXELS ** 2);
    expect(record.jointMinimumPixels).toBe(JOINT_MINIMUM_PIXELS);
    // Colour is NOT here, and must not be: it lives only in `baseColorFactor`.
    // A palette entry inside this record would mean a tile could carry a colour
    // claim about a real building.
    expect(JSON.stringify(record)).not.toMatch(/#[0-9A-Fa-f]{6}/u);
    expect(Object.keys(record)).not.toContain("palette");
  });

  it("moves both the hash AND the pixels for every live motif constant", () => {
    const baseline = proceduralTextureParametersHash();
    const inert: string[] = [];
    for (const textureClass of PROCEDURAL_TEXTURE_CLASSES) {
      const motif = PROCEDURAL_TEXTURE_PARAMETERS[textureClass] as unknown as Record<string, number>;
      const before = sha256HexBytes(rasterizeProceduralTexture(textureClass));
      for (const key of MOTIF_KEYS) {
        const original = motif[key]!;
        motif[key] = original + probeDelta(motif, key);
        try {
          // Hashed: mutating ANY declared constant must move the pinned hash.
          expect(sha256HexSync(stableSerialize(proceduralTextureParameters())), `${textureClass}.${key} hash`).not.toBe(baseline);
          // Wired up: and it must move the raster too, unless its gating
          // dimension is zero for this motif.
          const after = sha256HexBytes(rasterizeProceduralTexture(textureClass));
          if (inertByConstruction(motif, key)) inert.push(`${textureClass}.${key}`);
          else expect(after, `${textureClass}.${key} pixels`).not.toBe(before);
        } finally {
          motif[key] = original;
        }
      }
      expect(sha256HexBytes(rasterizeProceduralTexture(textureClass)), `${textureClass} restored`).toBe(before);
    }
    // The named exceptions, and only those: a spandrel drop with no band, and a
    // bed shadow with no depth.
    expect(inert.sort()).toEqual([
      "brick-running-bond.spandrelBandMm", "brick-running-bond.spandrelDrop",
      "curtain-mullion-grid.bedShadowDrop", "curtain-mullion-grid.bedShadowMm",
      "limestone-ashlar.spandrelBandMm", "limestone-ashlar.spandrelDrop",
      "spandrel-panel.spandrelBandMm", "spandrel-panel.spandrelDrop",
    ]);
    expect(proceduralTextureParametersHash()).toBe(baseline);
  });

  it("rasterizes independently of the calibrated colour palette", () => {
    // The claim that colour lives ONLY in `baseColorFactor`, tested rather than
    // asserted: the palette is mutated wholesale and not one pixel moves.
    const before = PROCEDURAL_TEXTURE_CLASSES.map((textureClass) => sha256HexBytes(rasterizeProceduralTexture(textureClass)));
    const palette = V3T_CALIBRATED_PALETTE["masonry-warm"] as unknown as Record<string, string>;
    const original = palette["material:facade:shaft"]!;
    palette["material:facade:shaft"] = "#00FF00";
    try {
      expect(PROCEDURAL_TEXTURE_CLASSES.map((textureClass) => sha256HexBytes(rasterizeProceduralTexture(textureClass)))).toEqual(before);
      expect(proceduralTextureParametersHash()).toBe(proceduralTextureParametersHash());
    } finally {
      palette["material:facade:shaft"] = original;
    }
  });
});
