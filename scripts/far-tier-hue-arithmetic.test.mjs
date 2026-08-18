/**
 * The arithmetic behind T013's exclusions, tested independently of the record
 * that reports it.
 *
 * Three of the four rejected hypotheses are rejected by ARITHMETIC rather than
 * by measurement, which makes them exactly the claims a reader cannot check by
 * re-running a render. So each is re-derived here from first principles on
 * synthetic inputs, and only then cross-checked against the committed record's
 * numbers. A test that only read the record back would prove the record is
 * self-consistent and nothing else.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { linearToSrgb, srgbToLinear } from "../src/release/far-tier-bake.ts";
import { V3T_CALIBRATED_PALETTE, v3TextureClassFor, v3tCalibratedFactor } from "../src/release/block835-v3-package.ts";
import { proceduralTextureTile } from "../src/release/procedural-texture.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const record = JSON.parse(readFileSync(join(repositoryRoot, "data/far-tier-hlod-hue-20260819/atlas-arithmetic.json"), "utf8"));

const spreadOf = (values) => Math.max(...values) - Math.min(...values);

/** One 2x2 box reduction of an RGB field, in a declared colour space. */
function reduce(field, size, space) {
  const next = new Float64Array((size / 2) * (size / 2) * 3);
  for (let y = 0; y < size / 2; y += 1) {
    for (let x = 0; x < size / 2; x += 1) {
      for (let c = 0; c < 3; c += 1) {
        const taps = [
          field[((2 * y) * size + 2 * x) * 3 + c],
          field[((2 * y) * size + 2 * x + 1) * 3 + c],
          field[((2 * y + 1) * size + 2 * x) * 3 + c],
          field[((2 * y + 1) * size + 2 * x + 1) * 3 + c],
        ];
        next[(y * (size / 2) + x) * 3 + c] = space === "linear"
          ? (taps[0] + taps[1] + taps[2] + taps[3]) / 4
          : srgbToLinear((linearToSrgb(taps[0]) + linearToSrgb(taps[1]) + linearToSrgb(taps[2]) + linearToSrgb(taps[3])) / 4);
      }
    }
  }
  return next;
}

function channelMeans(field, count) {
  const sums = [0, 0, 0];
  for (let index = 0; index < count; index += 1) for (let c = 0; c < 3; c += 1) sums[c] += field[index * 3 + c];
  return sums.map((sum) => sum / count);
}

describe("H1 — mixing with black cannot move hue in linear light", () => {
  it("scales all three channels by exactly the same factor", () => {
    // A deliberately lopsided colour, so a per-channel effect would be obvious.
    const colour = [0.61, 0.24, 0.09];
    for (const blackShare of [0.0146652, 0.146652, 0.5, 0.9]) {
      const mixed = colour.map((value) => value * (1 - blackShare));
      const ratios = mixed.map((value, index) => value / colour[index]);
      expect(spreadOf(ratios)).toBeLessThan(1e-15);
    }
  });

  it("is what the committed record measured on the real atlas", () => {
    expect(record.hypotheses.H1_blackAtlasDilution.evidence.blackMixHueSpread).toBeLessThan(1e-12);
    expect(record.hypotheses.H1_blackAtlasDilution.verdict).toContain("REJECTED");
    // And the unused share is the one the provenance record already declared.
    expect(record.atlasCensus.unusedShare).toBeCloseTo(0.146652, 6);
  });
});

describe("H6 — a linear box filter preserves every channel mean; an encoded one does not", () => {
  // A 4x4 field with strong per-channel contrast, built by hand so the expected
  // behaviour is arguable from the numbers rather than from the atlas.
  const size = 4;
  const field = new Float64Array(size * size * 3);
  for (let index = 0; index < size * size; index += 1) {
    const dark = index % 2 === 0;
    field[index * 3] = dark ? 0.02 : 0.86;
    field[index * 3 + 1] = dark ? 0.05 : 0.32;
    field[index * 3 + 2] = dark ? 0.06 : 0.14;
  }
  const base = channelMeans(field, size * size);

  it("preserves the per-channel mean exactly at every linear level", () => {
    let current = field;
    let currentSize = size;
    while (currentSize > 1) {
      current = reduce(current, currentSize, "linear");
      currentSize /= 2;
      const means = channelMeans(current, currentSize * currentSize);
      for (let c = 0; c < 3; c += 1) expect(means[c]).toBeCloseTo(base[c], 12);
    }
  });

  it("darkens every channel under an encoded filter, ordered by ENCODED CONTRAST and not by mean", () => {
    const level1 = channelMeans(reduce(field, size, "encoded"), (size / 2) ** 2);
    const attenuation = level1.map((value, index) => value / base[index]);
    for (const value of attenuation) expect(value).toBeLessThan(1);
    // The governing quantity is Jensen's gap, which grows with the spread of
    // the ENCODED values inside the footprint. The synthetic field above gives
    // red the widest encoded contrast, so red must be attenuated HARDEST here —
    // the opposite of the real atlas, where blue carries the widest contrast.
    // Asserting the RULE rather than one instance of it is what makes this a
    // test of the arithmetic instead of a restatement of the record.
    const encodedContrast = [0, 1, 2].map((c) => {
      const values = [];
      for (let index = 0; index < size * size; index += 1) values.push(linearToSrgb(field[index * 3 + c]));
      return Math.max(...values) - Math.min(...values);
    });
    const byContrast = [0, 1, 2].sort((left, right) => encodedContrast[right] - encodedContrast[left]);
    const byAttenuation = [0, 1, 2].sort((left, right) => attenuation[left] - attenuation[right]);
    expect(byAttenuation).toEqual(byContrast);
  });

  it("matches the sign the committed record found on the real atlas", () => {
    const linear = record.hypotheses.H6_filteringColourSpace.evidence.pyramidLinear;
    const encoded = record.hypotheses.H6_filteringColourSpace.evidence.pyramidEncoded;
    for (const level of linear) expect(level.channelRatioSpread).toBe(0);
    for (const level of encoded.slice(1)) {
      const [red, green, blue] = level.ratioToLevel0;
      expect(red).toBeGreaterThan(green);
      expect(green).toBeGreaterThan(blue);
    }
    expect(record.hypotheses.H6_filteringColourSpace.verdict).toContain("REJECTED BY SIGN");
  });
});

describe("H3 — the calibrated factor is a per-channel-uniform scale", () => {
  it("divides all three channels by one scalar for every palette entry", () => {
    for (const [styleClass, palette] of Object.entries(V3T_CALIBRATED_PALETTE)) {
      for (const [materialId, hex] of Object.entries(palette)) {
        const target = [
          Number.parseInt(hex.slice(1, 3), 16) / 255,
          Number.parseInt(hex.slice(3, 5), 16) / 255,
          Number.parseInt(hex.slice(5, 7), 16) / 255,
        ];
        const textureClass = v3TextureClassFor(styleClass, materialId);
        const mean = textureClass === null ? 1 : proceduralTextureTile(textureClass).meanModulation;
        const factor = v3tCalibratedFactor(hex, mean);
        const scales = [factor[0] / target[0], factor[1] / target[1], factor[2] / target[2]];
        expect(spreadOf(scales), `${styleClass}/${materialId}`).toBeLessThan(1e-12);
        // And it never pushes a channel past the closed glTF profile's ceiling,
        // so the bake's encoder clamp can never clip one channel before another.
        expect(Math.max(factor[0], factor[1], factor[2])).toBeLessThanOrEqual(1 + 1e-12);
      }
    }
  });

  it("reaches the clamp nowhere in the real atlas", () => {
    expect(record.hypotheses.H3_zoneFactorColourPath.evidence.clampedTexelChannelCount).toBe(0);
    expect(record.hypotheses.H3_zoneFactorColourPath.evidence.worstPerChannelScaleSpread).toBe(0);
  });
});

describe("H2 — quantization has the right sign and the wrong size", () => {
  it("biases red below blue, by far too little to matter", () => {
    const bias = record.hypotheses.H2_srgbQuantization.evidence.perChannelRelativeBias;
    expect(bias[0]).toBeLessThan(bias[2]);
    const spread = record.hypotheses.H2_srgbQuantization.evidence.perChannelRelativeBiasSpread;
    // The smallest spread measured at any pinned pose is 0.015976.
    expect(spread).toBeLessThan(0.015976 / 15);
  });
});

describe("the record describes the shipped tile and nothing else", () => {
  it("reproduces the committed atlas checksum and the shipped rasterizer's bytes", () => {
    expect(record.subject.atlasReproducesProvenance).toBe(true);
    expect(record.replicationGate.byteMismatchesAgainstShippedRasterizer).toBe(0);
    expect(record.replicationGate.verdict).toBe("PASS");
  });

  it("places the 400 m pose at or below one texel per pixel, which is what removes minification", () => {
    const near = record.hypotheses.H6_filteringColourSpace.evidence.poseToMipLevel
      .filter((pose) => pose.distanceMeters === 400);
    expect(near).toHaveLength(2);
    for (const pose of near) {
      expect(pose.texelPerPixel).toBeLessThan(1);
      expect(pose.impliedMipLevel).toBe(0);
    }
  });
});
