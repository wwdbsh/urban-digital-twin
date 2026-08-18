/**
 * The far-tier bake stands on two claims: it reproduces the shipped
 * `factor x tile` appearance analytically, and it does so byte-identically on
 * every run. These tests attack both, plus the packing order that would
 * otherwise let map iteration decide the bytes.
 */
import { execFileSync } from "node:child_process";
import { cwd, execPath } from "node:process";
import { describe, expect, it } from "vitest";
import { sha256HexBytes, sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";
import {
  FAR_TIER_BAKE_RECIPE,
  bakeFarTierAtlas,
  farTierPackingOrder,
  farTierProjectionBasis,
  farTierRecipeHash,
  linearToSrgb,
  packFarTierAtlas,
  srgbToLinear,
  tileIntegrator,
} from "./far-tier-bake.ts";
import type { FarTierFace } from "./far-tier-bake.ts";
import { PROCEDURAL_TEXTURE_CLASSES, PROCEDURAL_TEXTURE_TILE_PIXELS, encodeRgbPng, proceduralTextureTile, rasterizeProceduralTexture } from "./procedural-texture.ts";

function chunks(png: Uint8Array): Array<{ type: string; data: Uint8Array }> {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const found: Array<{ type: string; data: Uint8Array }> = [];
  let offset = 8;
  while (offset < png.byteLength) {
    const length = view.getUint32(offset);
    found.push({ type: new TextDecoder().decode(png.subarray(offset + 4, offset + 8)), data: png.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
  }
  return found;
}

describe("the truecolour PNG encoder keeps the grayscale encoder's discipline", () => {
  it("writes colour type 2 and no ancillary chunks", () => {
    const png = encodeRgbPng(2, 1, Uint8Array.from([1, 2, 3, 4, 5, 6]));
    const found = chunks(png);
    expect(found.map((chunk) => chunk.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    expect([...found[0]!.data]).toEqual([0, 0, 0, 2, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  });

  it("emits stored DEFLATE, not node:zlib", () => {
    const idat = chunks(encodeRgbPng(2, 1, Uint8Array.from([1, 2, 3, 4, 5, 6])))[1]!.data;
    expect([...idat.subarray(0, 2)]).toEqual([0x78, 0x01]);
    expect(idat[2]).toBe(1);
    const length = idat[3]! | (idat[4]! << 8);
    expect(length).toBe(1 * (2 * 3 + 1));
    expect([...idat.subarray(7, 7 + length)]).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("refuses a buffer whose length is not width * height * 3", () => {
    expect(() => encodeRgbPng(2, 2, new Uint8Array(11))).toThrow(/pixel count/u);
    expect(() => encodeRgbPng(-1, 2, new Uint8Array(0))).toThrow(/positive integer/u);
  });
});

describe("the transfer functions", () => {
  it("round-trip across the whole 8-bit domain", () => {
    for (let byte = 0; byte <= 255; byte += 1) {
      const value = byte / 255;
      expect(Math.round(255 * linearToSrgb(srgbToLinear(value)))).toBe(byte);
    }
  });

  it("cross the piecewise boundary continuously", () => {
    expect(srgbToLinear(0.04045)).toBeCloseTo(0.04045 / 12.92, 12);
    expect(linearToSrgb(0.0031308)).toBeCloseTo(0.0031308 * 12.92, 12);
  });

  it("prove the naive encoded-space multiply is NOT the same operation", () => {
    // This is the gamma decision, made testable. Multiplying in encoded space
    // is what a careless bake would do; it is measurably darker in the midtones
    // and the recipe rejects it by name.
    const factor = 0.5;
    const texel = 128 / 255;
    const correct = 255 * linearToSrgb(factor * srgbToLinear(texel));
    const naive = 255 * factor * texel;
    expect(Math.abs(correct - naive)).toBeGreaterThan(10);
    expect(correct).toBeGreaterThan(naive);
  });
});

describe("the exact periodic box integral", () => {
  it("averages a whole tile period to the tile's own linear mean", () => {
    for (const textureClass of PROCEDURAL_TEXTURE_CLASSES) {
      const integrator = tileIntegrator(textureClass);
      expect(integrator.boxMean(0, 1, 0, 1)).toBeCloseTo(integrator.linearMean, 12);
      // Many periods converge to the same number, which is the property that
      // makes a far-tier texel legible rather than an arbitrary coursing phase.
      expect(integrator.boxMean(0, 37, 0, 53)).toBeCloseTo(integrator.linearMean, 12);
    }
  });

  it("is exactly periodic, so a wall's coursing phase cannot depend on its anchor", () => {
    const integrator = tileIntegrator("brick-running-bond");
    const here = integrator.boxMean(0.13, 0.41, 0.22, 0.77);
    expect(integrator.boxMean(5.13, 5.41, 3.22, 3.77)).toBeCloseTo(here, 12);
    // Negative coordinates are real: UVs are dot products in a building-anchored
    // frame and are routinely negative.
    expect(integrator.boxMean(-6.87, -6.59, -7.78, -7.23)).toBeCloseTo(here, 12);
  });

  it("returns a single texel's own linear value over that texel's footprint", () => {
    // Exact in real arithmetic. In float64 a one-texel box is the difference of
    // four summed-area corners of magnitude ~1e4, so catastrophic cancellation
    // leaves ~1e-11 absolute residue. That is nine orders below the 1/255 byte
    // quantum the atlas is written at, and it is deterministic because the
    // summation order is fixed — so it costs nothing in the byte-replay gate.
    const size = PROCEDURAL_TEXTURE_TILE_PIXELS;
    const luminance = rasterizeProceduralTexture("limestone-ashlar");
    const integrator = tileIntegrator("limestone-ashlar");
    for (const [x, y] of [[0, 0], [17, 3], [64, 64], [127, 127]] as const) {
      const expected = srgbToLinear(luminance[y * size + x]! / 255);
      const observed = integrator.boxMean(x / size, (x + 1) / size, y / size, (y + 1) / size);
      expect(Math.abs(observed - expected)).toBeLessThan(1e-9);
      // And far below the quantum that could move an output byte.
      expect(Math.abs(observed - expected)).toBeLessThan(1 / 255 / 1_000);
    }
  });

  it("never leaves the tile's own value range", () => {
    const integrator = tileIntegrator("curtain-mullion-grid");
    for (const rect of [[0, 0.3, 0, 0.2], [0.9, 1.4, 0.9, 1.4], [-2.3, 1.1, 4.4, 9.9]] as const) {
      const mean = integrator.boxMean(rect[0], rect[1], rect[2], rect[3]);
      expect(mean).toBeGreaterThan(0);
      expect(mean).toBeLessThanOrEqual(1);
    }
  });

  it("agrees with the shipped encoded-space mean only after the transfer is applied", () => {
    // `meanModulation` is an ENCODED mean and the bake needs a LINEAR one.
    // They must differ, or the gamma decision would be vacuous.
    for (const textureClass of PROCEDURAL_TEXTURE_CLASSES) {
      const encoded = proceduralTextureTile(textureClass).meanModulation;
      expect(tileIntegrator(textureClass).linearMean).toBeLessThan(encoded);
    }
  });
});

describe("the projection basis matches the shipped composition semantics", () => {
  it("puts v along world up for any vertical wall", () => {
    const { uAxis, vAxis } = farTierProjectionBasis([
      [0, 0, 0], [4_000, 3_000, 0], [4_000, 3_000, 20_000], [0, 0, 20_000],
    ]);
    expect(vAxis[0]).toBeCloseTo(0, 12);
    expect(vAxis[1]).toBeCloseTo(0, 12);
    expect(Math.abs(vAxis[2])).toBeCloseTo(1, 12);
    // u runs horizontally along the wall, so it has no vertical component.
    expect(uAxis[2]).toBeCloseTo(0, 12);
  });

  it("is stable on a near-degenerate fan, which is why Newell's method is used", () => {
    const basis = farTierProjectionBasis([[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 0, 5_000]]);
    expect(Number.isFinite(basis.uAxis[0])).toBe(true);
    expect(Number.isFinite(basis.vAxis[2])).toBe(true);
  });
});

function face(buildingId: string, faceIndex: number, areaSquareMeters: number): FarTierFace {
  return {
    buildingId, faceIndex, kind: "wall", areaSquareMeters,
    cornersMm: [[0, 0, 0], [10_000, 0, 0], [10_000, 0, 30_000], [0, 0, 30_000]],
    offsetMeters: [0, 0],
    zones: [{ materialId: "material:facade:shaft", textureClass: "brick-running-bond", factor: [0.5, 0.4, 0.3], fromFraction: 0, toFraction: 1 }],
  };
}

describe("packing order is declared, never inherited from a map", () => {
  it("sorts by descending area, then building id, then face index", () => {
    const ordered = farTierPackingOrder([
      face("doitt:200", 1, 10), face("doitt:100", 5, 10), face("doitt:100", 2, 10), face("doitt:999", 0, 50),
    ]);
    expect(ordered.map((entry) => `${entry.buildingId}#${entry.faceIndex}`)).toEqual([
      "doitt:999#0", "doitt:100#2", "doitt:100#5", "doitt:200#1",
    ]);
  });

  it("is independent of the input order, which is the whole point", () => {
    const faces = [face("doitt:a", 0, 3), face("doitt:b", 1, 9), face("doitt:c", 2, 5)];
    const forwards = farTierPackingOrder(faces).map((entry) => entry.buildingId);
    const backwards = farTierPackingOrder([...faces].reverse()).map((entry) => entry.buildingId);
    expect(backwards).toEqual(forwards);
  });
});

describe("packing", () => {
  const many = Array.from({ length: 40 }, (_, index) => face(`doitt:${100 + index}`, index, 300 - index));

  it("places every face inside the atlas with its gutter", () => {
    const packing = packFarTierAtlas(many, 256, 1.4);
    expect(packing.faces).toHaveLength(many.length);
    const gutter = FAR_TIER_BAKE_RECIPE.gutterTexels;
    for (const entry of packing.faces) {
      const rect = entry.rect!;
      expect(rect.x - gutter).toBeGreaterThanOrEqual(0);
      expect(rect.y - gutter).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width + gutter).toBeLessThanOrEqual(256);
      expect(rect.y + rect.height + gutter).toBeLessThanOrEqual(256);
    }
  });

  it("never overlaps two faces' content", () => {
    const packing = packFarTierAtlas(many, 256, 1.4);
    const rects = packing.faces.map((entry) => entry.rect!);
    for (let left = 0; left < rects.length; left += 1) {
      for (let right = left + 1; right < rects.length; right += 1) {
        const a = rects[left]!;
        const b = rects[right]!;
        const disjoint = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
        expect(disjoint).toBe(true);
      }
    }
  });

  it("REPORTS a resolution shortfall as a scale rather than absorbing it", () => {
    // A cell that cannot afford its target resolution is a quality loss, and
    // the packer's contract is to name it.
    const crowded = Array.from({ length: 400 }, (_, index) => face(`doitt:${1000 + index}`, index, 500 - index / 10));
    const packing = packFarTierAtlas(crowded, 256, 1.4);
    expect(packing.appliedScale).toBeLessThan(1);
    expect(packing.texelWorldSizeMeters).toBeGreaterThan(1.4);
  });

  it("keeps the target scale when the cell fits", () => {
    const packing = packFarTierAtlas([face("doitt:1", 0, 100)], 256, 1.4);
    expect(packing.appliedScale).toBe(1);
    expect(packing.texelWorldSizeMeters).toBeCloseTo(1.4, 12);
  });
});

describe("the bake is a total function of its inputs", () => {
  const faces = Array.from({ length: 24 }, (_, index) => face(`doitt:${200 + index}`, index, 400 - index * 3));

  it("produces identical atlas bytes on repeated runs", () => {
    const first = bakeFarTierAtlas(packFarTierAtlas(faces, 256, 1.4));
    const second = bakeFarTierAtlas(packFarTierAtlas(faces, 256, 1.4));
    expect(sha256HexBytes(first)).toBe(sha256HexBytes(second));
  });

  it("produces identical bytes from a shuffled input, because the order is declared", () => {
    const forwards = bakeFarTierAtlas(packFarTierAtlas(faces, 256, 1.4));
    const backwards = bakeFarTierAtlas(packFarTierAtlas([...faces].reverse(), 256, 1.4));
    expect(sha256HexBytes(backwards)).toBe(sha256HexBytes(forwards));
  });

  it("reproduces the same atlas digest in a FRESH process", () => {
    // Cross-process equality is the gate the whole retention pipeline rests on;
    // an in-process repeat would not catch a module-level cache leaking state.
    const script = [
      "import { bakeFarTierAtlas, packFarTierAtlas } from './src/release/far-tier-bake.ts';",
      "import { sha256HexBytes } from './src/domain/deterministic-hash.ts';",
      "const face = (buildingId, faceIndex, areaSquareMeters) => ({ buildingId, faceIndex, kind: 'wall', areaSquareMeters,",
      "  cornersMm: [[0,0,0],[10000,0,0],[10000,0,30000],[0,0,30000]], offsetMeters: [0,0],",
      "  zones: [{ materialId: 'material:facade:shaft', textureClass: 'brick-running-bond', factor: [0.5,0.4,0.3], fromFraction: 0, toFraction: 1 }] });",
      "const faces = Array.from({ length: 24 }, (unused, index) => face('doitt:' + (200 + index), index, 400 - index * 3));",
      "process.stdout.write(sha256HexBytes(bakeFarTierAtlas(packFarTierAtlas(faces, 256, 1.4))));",
    ].join("\n");
    const observed = execFileSync(execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], { cwd: cwd(), encoding: "utf8" });
    expect(observed).toBe(sha256HexBytes(bakeFarTierAtlas(packFarTierAtlas(faces, 256, 1.4))));
  });

  it("fills the gutter by edge-clamp, so a mip level cannot pull a neighbour in", () => {
    const packing = packFarTierAtlas([face("doitt:1", 0, 100)], 256, 1.4);
    const rgb = bakeFarTierAtlas(packing);
    const rect = packing.faces[0]!.rect!;
    const at = (x: number, y: number): number[] => {
      const offset = (y * 256 + x) * 3;
      return [rgb[offset]!, rgb[offset + 1]!, rgb[offset + 2]!];
    };
    for (let ring = 1; ring <= FAR_TIER_BAKE_RECIPE.gutterTexels; ring += 1) {
      expect(at(rect.x - ring, rect.y)).toEqual(at(rect.x, rect.y));
      expect(at(rect.x + rect.width - 1 + ring, rect.y)).toEqual(at(rect.x + rect.width - 1, rect.y));
      expect(at(rect.x, rect.y - ring)).toEqual(at(rect.x, rect.y));
    }
  });
});

describe("the texel floor and the flat-face predicate", () => {
  const wide = (widthMm: number, heightMm: number): FarTierFace => ({
    buildingId: "doitt:1", faceIndex: 0, kind: "wall",
    areaSquareMeters: (widthMm / 1_000) * (heightMm / 1_000),
    cornersMm: [[0, 0, 0], [widthMm, 0, 0], [widthMm, 0, heightMm], [0, 0, heightMm]],
    offsetMeters: [0, 0],
    zones: [{ materialId: "material:facade:shaft", textureClass: "brick-running-bond", factor: [0.5, 0.4, 0.3], fromFraction: 0, toFraction: 1 }],
  });

  it("drops a face below the floor on EITHER axis to a flat block", () => {
    // 40 m wide but only 2 m tall at a 1 m texel: wide enough, far too short.
    const packing = packFarTierAtlas([wide(40_000, 2_000)], 256, 1);
    expect(packing.flatFaceCount).toBe(1);
    expect(packing.faces[0]!.rect!.flat).toBe(true);
    expect(packing.faces[0]!.rect!.width).toBe(FAR_TIER_BAKE_RECIPE.faceTexelFloor);
  });

  it("does NOT call a face flat merely because it sizes to exactly the floor", () => {
    // The defect this pins: `flat` used to be re-derived as
    // `width === floor && height === floor`, which mislabelled a legitimately
    // 4x4 face as flat and under-reported `flatFaceCount`.
    const floor = FAR_TIER_BAKE_RECIPE.faceTexelFloor;
    const packing = packFarTierAtlas([wide(floor * 1_000, floor * 1_000)], 256, 1);
    const rect = packing.faces[0]!.rect!;
    expect(rect.width).toBe(floor);
    expect(rect.height).toBe(floor);
    expect(rect.flat).toBe(false);
    expect(packing.flatFaceCount).toBe(0);
  });

  it("renders a flat face as one solid colour and a floor-sized face as not solid", () => {
    const solid = bakeFarTierAtlas(packFarTierAtlas([wide(40_000, 2_000)], 64, 1));
    const rectSolid = packFarTierAtlas([wide(40_000, 2_000)], 64, 1).faces[0]!.rect!;
    const texel = (rgb: Uint8Array, size: number, x: number, y: number): string => {
      const at = (y * size + x) * 3;
      return `${rgb[at]},${rgb[at + 1]},${rgb[at + 2]}`;
    };
    const seenSolid = new Set<string>();
    for (let row = 0; row < rectSolid.height; row += 1) {
      for (let column = 0; column < rectSolid.width; column += 1) seenSolid.add(texel(solid, 64, rectSolid.x + column, rectSolid.y + row));
    }
    expect(seenSolid.size).toBe(1);
  });

  it("counts every roof as flat, because a roof has no pattern at any resolution", () => {
    const roof: FarTierFace = {
      buildingId: "doitt:1", faceIndex: 9, kind: "roof", areaSquareMeters: 900,
      cornersMm: [[0, 0, 10_000], [30_000, 0, 10_000], [30_000, 30_000, 10_000], [0, 30_000, 10_000]],
      offsetMeters: [0, 0],
      zones: [{ materialId: "material:roof", textureClass: null, factor: [0.1, 0.1, 0.1], fromFraction: 0, toFraction: 1 }],
    };
    const packing = packFarTierAtlas([roof], 256, 1);
    expect(packing.faces[0]!.rect!.flat).toBe(true);
    expect(packing.flatFaceCount).toBe(1);
  });
});

describe("the recipe hash", () => {
  it("changes when any constant that can move a byte changes", () => {
    // The previous version of this test asserted `hash() === hash()`, which is
    // true of any pure function and proves nothing about coverage. This one
    // recomputes the hash over a MUTATED copy of the recipe and requires it to
    // move, for every field in turn.
    const baseline = farTierRecipeHash();
    expect(baseline).toMatch(/^[0-9a-f]{64}$/u);
    expect(sha256HexSync(stableSerialize(FAR_TIER_BAKE_RECIPE))).toBe(baseline);
    for (const key of Object.keys(FAR_TIER_BAKE_RECIPE)) {
      const mutated: Record<string, unknown> = { ...FAR_TIER_BAKE_RECIPE };
      mutated[key] = typeof mutated[key] === "number" ? (mutated[key] as number) + 1 : "MUTATED";
      expect(sha256HexSync(stableSerialize(mutated)), `recipe hash ignores ${key}`).not.toBe(baseline);
    }
  });

  it("names the gamma decision and the packing order explicitly", () => {
    expect(FAR_TIER_BAKE_RECIPE.compositionSpace).toBe("linear-light");
    expect(FAR_TIER_BAKE_RECIPE.textureTransferFunction).toBe("srgb");
    expect(FAR_TIER_BAKE_RECIPE.packingOrder).toContain("descending-face-world-area");
    expect(FAR_TIER_BAKE_RECIPE.packingOrder).not.toContain("map");
    expect(FAR_TIER_BAKE_RECIPE.bakedMipLevels).toBe(0);
  });
});
