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
import { sha256HexSync } from "../src/domain/deterministic-hash.ts";
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

// ---------------------------------------------------------------------------
// The DECISION numbers, tested against the measurements they claim to summarise.
//
// The first draft of these records carried a metric-transfer error: a share
// computed on log(R/B) was applied to the three-channel hue spread, and the
// resulting ceiling understated the worst case AND hid a sign flip between the
// two azimuths. Nothing in the record itself could have caught that, because
// the record reported the derived number and not the measurement. These tests
// recompute every decision number from the per-channel means beside it.
// ---------------------------------------------------------------------------

const captureRecord = JSON.parse(readFileSync(join(repositoryRoot, "data/far-tier-hlod-hue-20260819/pinned-capture.json"), "utf8"));
const attribution = JSON.parse(readFileSync(join(repositoryRoot, "data/far-tier-hlod-hue-20260819/hue-attribution.json"), "utf8"));
const atlasCensus = record.atlasCensus;

describe("the post-correction hue spreads are the measurement, not a scaled share", () => {
  for (const row of captureRecord.results) {
    it(`${row.pose} recomputes its palette-equalised spread from the recorded channel means`, () => {
      const ratios = row.bakedChannelMeans.map((value, index) => value / row.absorbedVariantChannelMeans[index]);
      expect(row.palletteEqualisedComparison.channelSpread).toBeCloseTo(spreadOf(ratios), 6);
    });
  }

  it("carries the same six numbers into the decision section", () => {
    const decision = attribution.whatColourOnlyCorrectionWouldActuallyDo.perPose;
    expect(decision).toHaveLength(6);
    for (const [index, row] of captureRecord.results.entries()) {
      expect(decision[index].pose).toBe(row.pose);
      expect(decision[index].spreadAfterAColourOnlyCorrection).toBe(row.palletteEqualisedComparison.channelSpread);
      expect(decision[index].measuredSpreadToday).toBe(row.channelSpread);
    }
  });

  it("splits by azimuth the way the prose says: 55 crosses the bar, 235 gets worse", () => {
    const decision = attribution.whatColourOnlyCorrectionWouldActuallyDo.perPose;
    const at55 = decision.filter((row) => row.pose.endsWith("/55"));
    const at235 = decision.filter((row) => row.pose.endsWith("/235"));
    expect(at55).toHaveLength(3);
    expect(at235).toHaveLength(3);
    for (const row of at55) {
      expect(row.spreadAfterAColourOnlyCorrection).toBeLessThan(row.measuredSpreadToday);
      expect(row.legacyBarVerdictAfter).toBe("PASS");
    }
    for (const row of at235) expect(row.legacyBarVerdictAfter).toBe("MISS");
    // The sign flip the retired estimate hid: azimuth 235 is not uniformly
    // improved, and two of its three poses are made WORSE.
    const worsened = at235.filter((row) => row.spreadAfterAColourOnlyCorrection > row.measuredSpreadToday);
    expect(worsened).toHaveLength(2);
    expect(attribution.whatColourOnlyCorrectionWouldActuallyDo.perAzimuthSplit.azimuth235).toContain("WORSE at 400 m and 1,200 m");
  });

  it("states a worst case that is the actual maximum and is still above the bar", () => {
    const decision = attribution.whatColourOnlyCorrectionWouldActuallyDo;
    const worst = Math.max(...decision.perPose.map((row) => row.spreadAfterAColourOnlyCorrection));
    expect(decision.worstPoseAfter).toBe(worst);
    expect(worst).toBeGreaterThan(0.02);
    // The retired estimate must not survive as a LIVE figure. It is allowed to
    // appear once, inside the sentence that supersedes it, because deleting a
    // wrong number without saying it was wrong is how it comes back.
    expect(decision.worstPoseAfter).not.toBe(0.0265);
    expect(JSON.stringify(attribution)).not.toContain("14 to 36 per cent");
    expect(decision.conclusion).toContain("supersedes an earlier draft");
  });
});

describe("the chromaticity shares are labelled as chromaticity shares", () => {
  for (const row of captureRecord.results) {
    it(`${row.pose} recomputes both shares from log(R/B) and they sum to one`, () => {
      const rb = (triple) => triple[0] / triple[2];
      const total = Math.log(rb(row.bakedChannelMeans) / rb(row.sourceChannelMeans));
      const absorption = Math.log(rb(row.absorbedVariantChannelMeans) / rb(row.sourceChannelMeans));
      const geometry = Math.log(rb(row.bakedChannelMeans) / rb(row.absorbedVariantChannelMeans));
      expect(row.chromaticity.decomposition.materialAbsorptionShare).toBeCloseTo(absorption / total, 4);
      expect(row.chromaticity.decomposition.geometricSimplificationShare).toBeCloseTo(geometry / total, 4);
      expect(row.chromaticity.decomposition.materialAbsorptionShare + row.chromaticity.decomposition.geometricSimplificationShare)
        .toBeCloseTo(1, 3);
    });
  }

  it("says out loud that the split is not an A3 split", () => {
    expect(captureRecord.results[0].chromaticity.metric).toContain("log(R/B)");
    expect(captureRecord.results[0].chromaticity.decomposition.doesNotApplyTo).toContain("A3");
    expect(attribution.attributedMechanism.twoMeasuredTerms.caution).toContain("NOT A3 SHARES");
  });

  it("holds the case that proves the two terms do not partition the spread", () => {
    // 400/235: absorption-only spread and palette-equalised spread do not sum
    // to anything like the measured spread. Asserting it keeps the caution honest.
    const row = captureRecord.results.find((entry) => entry.pose === "400/235");
    const parts = row.palletteEqualisedComparison.absorptionOnlyChannelSpread + row.palletteEqualisedComparison.channelSpread;
    expect(Math.abs(parts - row.channelSpread)).toBeGreaterThan(0.005);
    expect(row.palletteEqualisedComparison.channelSpread).toBeGreaterThan(row.channelSpread);
  });
});

describe("the absorbed variant is a controlled substitution", () => {
  it("has a silhouette identical to the source's at every pose", () => {
    const control = captureRecord.absorbedSourceVariant.positiveControl;
    expect(control.worstAbsoluteDelta).toBe(0);
    expect(control.sourceSilhouettePixels).toEqual(control.absorbedSilhouettePixels);
    expect(control.verdict).toContain("PASS");
  });

  it("declares its mask domain, because the domain moves ratios more than the effect does", () => {
    expect(captureRecord.absorbedSourceVariant.measurementDomain).toContain("intersection");
    expect(captureRecord.measurementDomain.perChannelMeans).toContain("INTERSECTION");
  });

  it("documents the metal judgement call and its direction", () => {
    const judgement = captureRecord.absorbedSourceVariant.metalJudgementCall;
    expect(judgement.decision).toContain("material:metal");
    expect(judgement.size).toContain("2.22 per cent");
    expect(judgement.size).toContain("upper bound");
  });
});

describe("prose and fields agree", () => {
  it("quotes the used-texel count it computed", () => {
    const observation = attribution.theDecisiveObservation;
    expect(observation.atlasUsedTexels).toBe(atlasCensus.contentTexels + atlasCensus.gutterTexels);
    expect(observation.arithmetic).toContain(observation.atlasUsedTexels.toLocaleString("en-US"));
    expect(observation.arithmetic).toContain(atlasCensus.contentTexels.toLocaleString("en-US"));
    expect(observation.arithmetic).toContain(atlasCensus.gutterTexels.toLocaleString("en-US"));
    expect(observation.arithmetic).toContain(String(observation.texelPerPixelAt400Az55));
    expect(observation.texelPerPixelAt400Az55).toBeLessThan(1);
  });

  it("reads the committed baseline from the frozen record rather than a transcription", () => {
    const baselineText = readFileSync(join(repositoryRoot, "data/far-tier-hlod-instrument-20260818/pinned-baseline.json"), "utf8");
    expect(captureRecord.reproductionGate.baselineSha256).toBe(sha256HexSync(baselineText));
    const baseline = JSON.parse(baselineText);
    for (const row of captureRecord.results) {
      const committed = baseline.results.find((entry) => entry.distanceMeters === row.distanceMeters && entry.azimuthDegrees === row.azimuthDegrees);
      expect(row.reproductionAgainstCommittedBaseline.committedSpread).toBe(committed.channelSpread);
    }
  });

  it("qualifies the quantization sign claim to the weighting that supports it", () => {
    const h2 = attribution.hypotheses.find((entry) => entry.id === "H2");
    const census = record.hypotheses.H2_srgbQuantization.evidence.perChannelRelativeBias;
    const weighted = record.hypotheses.H2_srgbQuantization.evidence.areaWeightedPerChannelRelativeBias;
    // The census triple's lowest channel is GREEN; the area-weighted one's is RED.
    expect(census.indexOf(Math.min(...census))).toBe(1);
    expect(weighted.indexOf(Math.min(...weighted))).toBe(0);
    expect(h2.signQualification).toContain("AREA-WEIGHTED");
  });

  it("puts the roof-cap candidate on a like-for-like denominator and names the counterweight", () => {
    const open = attribution.whatIsNotAttributed;
    expect(open.geometricSubMechanism).toContain("15.50 per cent");
    expect(open.geometricSubMechanism).toContain("17.33 per cent");
    expect(open.theLargerUnlabelledSurfaceSetDifference).toContain("13.10 per cent");
    expect(open.theLargerUnlabelledSurfaceSetDifference).toContain("OTHER WAY");
  });

  it("names BOTH unexplained tile-side distance movements", () => {
    const open = attribution.whatIsNotAttributed.tileSideDistanceMovements;
    expect(open).toContain("2.62 per cent");
    expect(open).toContain("0.89 per cent");
    expect(open).toContain("NOT treated as confirmation");
  });

  it("reports the analytic model overstating as well as understating", () => {
    const limits = attribution.whatIsNotAttributed.analyticModelLimits;
    expect(limits).toContain("OVERSTATES");
    expect(limits).toContain("12.35 per cent");
  });

  it("records that the mask-domain discrepancy moves no verdict, with the union numbers", () => {
    const finding = captureRecord.maskSemanticsFinding.doesItMoveAnyVerdict;
    expect(finding.answer).toContain("NO");
    let missesUnion = 0;
    let missesIntersection = 0;
    for (const row of captureRecord.results) {
      expect(row.maskDomainSensitivity.unionDomainSpread).toBeGreaterThanOrEqual(row.maskDomainSensitivity.intersectionDomainSpread);
      if (row.maskDomainSensitivity.missesTheLegacyHueBarUnderUnion) missesUnion += 1;
      if (row.maskDomainSensitivity.missesTheLegacyHueBarUnderIntersection) missesIntersection += 1;
    }
    expect(missesUnion).toBe(5);
    expect(missesIntersection).toBe(5);
  });
});
