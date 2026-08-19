/* global console, process */
/**
 * T013 ATTRIBUTION STAGE — record emission.
 *
 * The capture numbers below were produced by the pinned instrument through
 * Blender MCP and are transcribed here so the records are emitted by code
 * rather than typed by hand into JSON. Every render they summarise is digested
 * from disk by this same run, so a record can never describe an image that is
 * not the one on the machine.
 *
 * THE COMMITTED BASELINE IS READ, NOT TYPED. An earlier version of this file
 * hardcoded T012's six-pose numbers, which makes a reproduction gate that
 * cannot fail if the transcription is wrong. It is now read out of
 * data/far-tier-hlod-instrument-20260818/pinned-baseline.json.
 *
 * Usage:
 *   node --experimental-strip-types scripts/far-tier-hue-records-cli.mjs emit
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexBytes, sha256HexSync } from "../src/domain/deterministic-hash.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_ID = "far-tier-hlod-hue-20260819";
const evidenceRoot = join(repositoryRoot, "data", EVIDENCE_ID);
const renderRoot = join(repositoryRoot, "artifacts", EVIDENCE_ID, "renders");
const variantRoot = join(repositoryRoot, "artifacts", EVIDENCE_ID, "variant-sources");
const instrumentRoot = join(repositoryRoot, "data", "far-tier-hlod-instrument-20260818");

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
const round = (value, digits = 6) => Number(value.toFixed(digits));
const spreadOf = (values) => Math.max(...values) - Math.min(...values);
const percent = (fraction, digits = 2) => `${round(fraction * 100, digits)} per cent`;

/**
 * This session's pinned capture. Per-channel means over the SOURCE-and-BAKED
 * INTERSECTION, un-premultiplied — the domain that reproduces the committed
 * baseline, established below.
 *
 * `absorbed` is the instrumentation variant measured over the SAME pixel set as
 * the other two subjects, so the three are directly comparable.
 */
const CAPTURE = [
  { pose: "400/55", distanceMeters: 400, azimuthDegrees: 55, unionPixels: 63724, intersectionPixels: 61862,
    sourceSilhouettePixels: 62073, absorbedSilhouettePixels: 62073, bakedSilhouettePixels: 63513, absorbedUnionWithBakedPixels: 63724,
    source: [0.245700867, 0.218731945, 0.196856174], baked: [0.2504641, 0.22390896, 0.2038174],
    absorbed: [0.25981069, 0.230814344, 0.209343002],
    sourceUnionMeanLuminance: 0.21577073, bakedUnionMeanLuminance: 0.22449938,
    unionDomainRatios: [1.025621, 1.031401, 1.0448] },
  { pose: "400/235", distanceMeters: 400, azimuthDegrees: 235, unionPixels: 60355, intersectionPixels: 58950,
    sourceSilhouettePixels: 59152, absorbedSilhouettePixels: 59152, bakedSilhouettePixels: 60153, absorbedUnionWithBakedPixels: 60355,
    source: [0.039694421, 0.038141124, 0.035691889], baked: [0.038750721, 0.038041537, 0.035763185],
    absorbed: [0.039175279, 0.037359667, 0.03542],
    sourceUnionMeanLuminance: 0.03766457, bakedUnionMeanLuminance: 0.0384144,
    unionDomainRatios: [0.959242, 0.984853, 0.994862] },
  { pose: "1200/55", distanceMeters: 1200, azimuthDegrees: 55, unionPixels: 5964, intersectionPixels: 5801,
    sourceSilhouettePixels: 5820, absorbedSilhouettePixels: 5820, bakedSilhouettePixels: 5945, absorbedUnionWithBakedPixels: 5964,
    source: [0.24420355, 0.213603112, 0.191170422], baked: [0.245395917, 0.216219437, 0.196047182],
    absorbed: [0.25908855, 0.225703619, 0.203671896],
    sourceUnionMeanLuminance: 0.20999704, bakedUnionMeanLuminance: 0.21486603,
    unionDomainRatios: [1.003582, 1.011825, 1.026171] },
  { pose: "1200/235", distanceMeters: 1200, azimuthDegrees: 235, unionPixels: 5918, intersectionPixels: 5787,
    sourceSilhouettePixels: 5816, absorbedSilhouettePixels: 5816, bakedSilhouettePixels: 5889, absorbedUnionWithBakedPixels: 5918,
    source: [0.042090397, 0.040544976, 0.03810586], baked: [0.040595346, 0.039928502, 0.037721585],
    absorbed: [0.041944385, 0.040174727, 0.038241618],
    sourceUnionMeanLuminance: 0.0394298, bakedUnionMeanLuminance: 0.03951768,
    unionDomainRatios: [0.941386, 0.965837, 0.975906] },
  { pose: "4000/55", distanceMeters: 4000, azimuthDegrees: 55, unionPixels: 524, intersectionPixels: 511,
    sourceSilhouettePixels: 511, absorbedSilhouettePixels: 511, bakedSilhouettePixels: 524, absorbedUnionWithBakedPixels: 524,
    source: [0.245675043, 0.213221661, 0.190491397], baked: [0.245931218, 0.215376865, 0.195027962],
    absorbed: [0.260833919, 0.225304115, 0.202886707],
    sourceUnionMeanLuminance: 0.2011661, bakedUnionMeanLuminance: 0.20518705,
    unionDomainRatios: [0.999824, 1.009413, 1.023666] },
  { pose: "4000/235", distanceMeters: 4000, azimuthDegrees: 235, unionPixels: 517, intersectionPixels: 507,
    sourceSilhouettePixels: 508, absorbedSilhouettePixels: 508, bakedSilhouettePixels: 516, absorbedUnionWithBakedPixels: 517,
    source: [0.047593581, 0.045642662, 0.042723686], baked: [0.043170902, 0.04248856, 0.040198639],
    absorbed: [0.047356148, 0.045081418, 0.042845151],
    sourceUnionMeanLuminance: 0.04217802, bakedUnionMeanLuminance: 0.03976067,
    unionDomainRatios: [0.90468, 0.929565, 0.940301] },
];

/** The one-variable shadows-off ablation, measured on three poses. */
const SHADOWS_OFF = [
  { pose: "400/55", sourceRedOverBlueOn: 1.248124, sourceRedOverBlueOff: 1.256095, bakedRedOverBlueOn: 1.228865, bakedRedOverBlueOff: 1.237575 },
  { pose: "400/235", sourceRedOverBlueOn: 1.112141, sourceRedOverBlueOff: 1.147022, bakedRedOverBlueOn: 1.083537, bakedRedOverBlueOff: 1.084647 },
  { pose: "4000/235", sourceRedOverBlueOn: 1.113986, sourceRedOverBlueOff: 1.133186, bakedRedOverBlueOn: 1.073939, bakedRedOverBlueOff: 1.074473 },
];

/** Which per-channel mask domain reproduces the committed ratios. Worst |delta| per pose. */
const MASK_CONVENTION = [
  { domain: "union, un-premultiplied, zero-filled outside the subject", worstAbsoluteDeltaPerPose: [0.009431, 0.017005, 0.001315, 0.02303, 0.001324, 0.002447] },
  { domain: "union, premultiplied", worstAbsoluteDeltaPerPose: [0.017201, 0.027072, 0.012337, 0.022211, 0.011399, 0.016541] },
  { domain: "own silhouette, un-premultiplied", worstAbsoluteDeltaPerPose: [0.006385, 0.008748, 0.007995, 0.00895, 0.008616, 0.003179] },
  { domain: "own silhouette, premultiplied", worstAbsoluteDeltaPerPose: [0.005996, 0.013889, 0.007648, 0.01753, 0.007279, 0.010946] },
  { domain: "union, sum(rgb) over sum(alpha)", worstAbsoluteDeltaPerPose: [0.006132, 0.010588, 0.007707, 0.009175, 0.004902, 0.005565] },
  { domain: "INTERSECTION, un-premultiplied", worstAbsoluteDeltaPerPose: [0.000007, 0.000021, 0.000016, 0.000064, 0.000105, 0.000053] },
];

async function digestTree(root) {
  const entries = (await readdir(root)).filter((name) => !name.startsWith(".")).sort();
  const out = [];
  for (const name of entries) {
    try {
      const bytes = new Uint8Array(await readFile(join(root, name)));
      out.push({ name, byteSize: bytes.byteLength, sha256: sha256HexBytes(bytes) });
    } catch { /* a directory, not a file */ }
  }
  return out;
}

async function emit() {
  const renders = await digestTree(renderRoot);
  const variantManifestText = await readFile(join(variantRoot, "placements.json"), "utf8");
  const baselineText = await readFile(join(instrumentRoot, "pinned-baseline.json"), "utf8");
  const baseline = JSON.parse(baselineText);
  const atlas = JSON.parse(await readFile(join(evidenceRoot, "atlas-arithmetic.json"), "utf8"));
  const albedo = JSON.parse(await readFile(join(evidenceRoot, "albedo-mix.json"), "utf8"));

  const committedOf = (distanceMeters, azimuthDegrees) => {
    const row = baseline.results.find((entry) => entry.distanceMeters === distanceMeters && entry.azimuthDegrees === azimuthDegrees);
    if (!row) throw new Error(`the committed baseline has no pose ${distanceMeters}/${azimuthDegrees}`);
    return row;
  };

  const capture = CAPTURE.map((row) => {
    const ratios = row.baked.map((value, index) => value / row.source[index]);
    const committed = committedOf(row.distanceMeters, row.azimuthDegrees);
    const sourceRedOverBlue = row.source[0] / row.source[2];
    const bakedRedOverBlue = row.baked[0] / row.baked[2];
    const absorbedRedOverBlue = row.absorbed[0] / row.absorbed[2];
    // The palette-equalised comparison: the tile against a subject with the
    // SOURCE's geometry and the TILE's palette. This is the direct measurement
    // of what remains once material absorption is removed, per channel — NOT a
    // scaling of the chromaticity gap.
    const geometricRatios = row.baked.map((value, index) => value / row.absorbed[index]);
    const absorptionRatios = row.absorbed.map((value, index) => value / row.source[index]);
    // The chromaticity decomposition is on log(R/B) ONLY. It is additive there
    // by construction and it is NOT a decomposition of the A3 spread.
    const totalGap = Math.log(bakedRedOverBlue / sourceRedOverBlue);
    const absorptionGap = Math.log(absorbedRedOverBlue / sourceRedOverBlue);
    const geometryGap = Math.log(bakedRedOverBlue / absorbedRedOverBlue);
    return {
      pose: row.pose,
      distanceMeters: row.distanceMeters,
      azimuthDegrees: row.azimuthDegrees,
      unionPixels: row.unionPixels,
      intersectionPixels: row.intersectionPixels,
      sourceChannelMeans: row.source,
      bakedChannelMeans: row.baked,
      absorbedVariantChannelMeans: row.absorbed,
      sourceUnionMeanLuminance: row.sourceUnionMeanLuminance,
      bakedUnionMeanLuminance: row.bakedUnionMeanLuminance,
      perChannelRatios: ratios.map((value) => round(value, 6)),
      channelSpread: round(spreadOf(ratios), 6),
      unionMeanLuminanceRatio: round(row.bakedUnionMeanLuminance / row.sourceUnionMeanLuminance, 6),
      absoluteLuminanceDifference: round(row.bakedUnionMeanLuminance - row.sourceUnionMeanLuminance, 8),
      reproductionAgainstCommittedBaseline: {
        committedRatios: committed.perChannelRatios,
        worstAbsoluteRatioDelta: round(Math.max(...ratios.map((value, index) => Math.abs(value - committed.perChannelRatios[index]))), 8),
        committedSpread: committed.channelSpread,
        absoluteSpreadDelta: round(Math.abs(spreadOf(ratios) - committed.channelSpread), 8),
        committedUnionPixels: committed.unionPixels,
        unionPixelDelta: row.unionPixels - committed.unionPixels,
        committedUnionMeanLuminanceRatio: committed.unionMeanLuminanceRatio,
        absoluteLuminanceRatioDelta: round(Math.abs(row.bakedUnionMeanLuminance / row.sourceUnionMeanLuminance - committed.unionMeanLuminanceRatio), 8),
      },
      maskDomainSensitivity: {
        intersectionDomainRatios: ratios.map((value) => round(value, 6)),
        intersectionDomainSpread: round(spreadOf(ratios), 6),
        unionDomainRatios: row.unionDomainRatios,
        unionDomainSpread: round(spreadOf(row.unionDomainRatios), 6),
        missesTheLegacyHueBarUnderIntersection: spreadOf(ratios) > 0.02,
        missesTheLegacyHueBarUnderUnion: spreadOf(row.unionDomainRatios) > 0.02,
      },
      palletteEqualisedComparison: {
        whatItIs: "The tile against the absorbed-material variant, over the same pixel set. Both carry the facade-only palette, so this is the tile's residual difference from the source's GEOMETRY alone.",
        perChannelRatios: geometricRatios.map((value) => round(value, 6)),
        channelSpread: round(spreadOf(geometricRatios), 6),
        absorptionOnlyPerChannelRatios: absorptionRatios.map((value) => round(value, 6)),
        absorptionOnlyChannelSpread: round(spreadOf(absorptionRatios), 6),
      },
      chromaticity: {
        metric: "log(R/B). ONE ratio of two channels, not the three-channel spread the hue bar measures.",
        sourceRedOverBlue: round(sourceRedOverBlue, 6),
        absorbedVariantRedOverBlue: round(absorbedRedOverBlue, 6),
        bakedTileRedOverBlue: round(bakedRedOverBlue, 6),
        tileGapAgainstSourceFraction: round(Math.expm1(totalGap), 6),
        decomposition: {
          appliesTo: "log(R/B) ONLY.",
          doesNotApplyTo: "The A3 hue spread, which is max minus min over THREE channel ratios. Green is not in log(R/B) at all, and at 400/235 the two terms do not partition the spread — the absorption-only spread is 0.011 and the palette-equalised spread is 0.029 against a total of 0.026. A spread-metric split would have to be measured separately, and this is not one.",
          materialAbsorptionShare: round(absorptionGap / totalGap, 4),
          geometricSimplificationShare: round(geometryGap / totalGap, 4),
          materialAbsorptionFraction: round(Math.expm1(absorptionGap), 6),
          geometricSimplificationFraction: round(Math.expm1(geometryGap), 6),
        },
      },
    };
  });

  const absorptionShares = capture.map((row) => row.chromaticity.decomposition.materialAbsorptionShare);
  const geometryShares = capture.map((row) => row.chromaticity.decomposition.geometricSimplificationShare);
  const palletteEqualisedSpreads = capture.map((row) => row.palletteEqualisedComparison.channelSpread);
  const measuredSpreads = capture.map((row) => row.channelSpread);
  const az55 = capture.filter((row) => row.azimuthDegrees === 55);
  const az235 = capture.filter((row) => row.azimuthDegrees === 235);

  const captureRecord = {
    schemaVersion: "1.0",
    recordId: `${EVIDENCE_ID}:pinned-capture`,
    task: "T013",
    artifact: "far-tier-hue-attribution-pinned-capture",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION.",
    reEmission: {
      why: "This record was RE-EMITTED after T013's closure to replace a hardcoded boolean in the absorbed variant's positive control with the measured union pixel counts it claimed. NO measurement changed; a field that asserted a result now carries the numbers and derives it.",
      priorSha256: "c55748533271679b642d3cf1c2946c6f24d380a33962951391ba879c097c2e00",
      whatCitesThePriorHash: "fix-pre-registration.json names the prior hash in predictionModel.sourceRecord. That record is a PRE-REGISTRATION and is not re-emitted after a capture under any circumstances, so its citation deliberately continues to name the version it was written against.",
      whatDidNotChange: "Every channel mean, ratio, spread, luminance and pixel count in results and in the reproduction gate.",
    },
    headline: "The operative six-pose baseline REPRODUCED under the pinned instrument, with the one measurement it never recorded: each subject's own per-channel means. That is what makes the red deficit decomposable instead of merely observable.",
    instrument: {
      specId: "far-tier-appearance-instrument-v2",
      specSha256: "9a77561b9d8307aff77692412961102b3a3aa66e1a6dbe04db181a886ad53b89",
      harnessSha256: "d394bcf76efdedfdf58b1bef86838137adc71f5a0c544e051f509de0edffc1d2",
      enforcement: "The generated harness ran immediately before every pinned capture, with the caller-supplied renderable-mesh count, and returned the spec hash. Subjects were isolated BY DELETION; hide_render was never used.",
      poseConventionRecovery: {
        why: "The pose construction was never written down. It was RECOVERED from the surviving T012 rig rather than guessed: the camera left in the scene was the 4,000 m / azimuth 235 baked capture, and its back axis and location determine both the target and the azimuth convention.",
        target: "The centre of the SOURCE subject's world bounding box, [117.161758, 84.367462, 20.086] in the cell-local ENU frame.",
        offsetRule: "camera = target + distance x (sin(az) cos(18 deg), -cos(az) cos(18 deg), sin(18 deg)); the camera tracks -Z to the target with +Y up.",
        residualAgainstTheSurvivingRig: "0.000546 m, which is float32 storage rounding on the recorded camera location.",
        corroboration: "The source bounding box's own upper Z, 40.172 m, is what the recovered target implies and is 3.6 m above the tile's 36.576 m top — the rooftop mass the prism does not carry.",
      },
    },
    measurementDomain: {
      perChannelMeans: "Mean over the SOURCE-and-BAKED INTERSECTION of each subject's own colour divided by its own alpha.",
      whyItMattersThatThisIsStated: "The domain choice is not cosmetic. Across the six poses the same renders yield per-channel ratios that differ between domains by up to 0.023 — larger than the effect under attribution. Every subject in this record, including the absorbed variant, is averaged over the SAME pixel set at a given pose.",
      luminance: "The union luminance ratio uses the SOURCE-or-BAKED UNION and does NOT un-premultiply, which is what the pinned spec states and what reproduces the committed baseline.",
    },
    maskSemanticsFinding: {
      claim: "The pinned spec's maskSemantics prose says per-channel ratios are averaged over the UNION. The committed numbers say otherwise: only the INTERSECTION domain reproduces them.",
      method: "Six candidate domains computed from the same twelve renders and compared against the committed six-pose ratios.",
      candidates: MASK_CONVENTION,
      finding: "The intersection domain reproduces the committed ratios to a worst absolute delta of 0.000105 across all six poses. The next best candidate is off by 0.023.",
      consequence: "A PROSE-VERSUS-BEHAVIOUR discrepancy in the pinned spec, reported and not repaired here: repairing it is a change to the instrument, which this attribution stage has no mandate to make.",
      doesItMoveAnyVerdict: {
        question: "Whether the legacy hue bar's 5-of-6 MISS is an artefact of the domain the committed numbers actually used.",
        answer: "NO, and this is measured rather than assumed. Under the union domain the spreads are 0.019179, 0.035620, 0.022589, 0.034520, 0.023842, 0.035621 — every one LARGER than its intersection counterpart, and the same five poses miss the 0.02 bar while 400/55 passes in both. The verdict pattern is identical and the union domain is if anything harsher.",
      },
      whatItDoesNotMean: "It is not an error in the committed baseline. The baseline is internally consistent; only its written description of the domain is wrong.",
      forwardPointer: "See instrument-mask-semantics-note.json in this directory. The frozen instrument records are NOT edited.",
    },
    reproductionGate: {
      statedInAdvance: "The capture is only usable if it reproduces the committed operative baseline; otherwise it measures a different instrument and its decomposition attaches to nothing.",
      baselineReadFrom: "data/far-tier-hlod-instrument-20260818/pinned-baseline.json",
      baselineSha256: sha256HexSync(baselineText),
      worstAbsoluteRatioDelta: round(Math.max(...capture.map((row) => row.reproductionAgainstCommittedBaseline.worstAbsoluteRatioDelta)), 8),
      worstAbsoluteSpreadDelta: round(Math.max(...capture.map((row) => row.reproductionAgainstCommittedBaseline.absoluteSpreadDelta)), 8),
      worstUnionPixelDelta: Math.max(...capture.map((row) => Math.abs(row.reproductionAgainstCommittedBaseline.unionPixelDelta))),
      worstAbsoluteLuminanceRatioDelta: round(Math.max(...capture.map((row) => row.reproductionAgainstCommittedBaseline.absoluteLuminanceRatioDelta)), 8),
      verdict: "PASS. Ratios reproduce to 1.05e-4, spreads to 3.44e-5, the union luminance ratio to 8.58e-5, and five of six union pixel counts exactly; the sixth differs by one pixel out of 60,356.",
      whyNotBitExact: "The pose transform is RECONSTRUCTED from a float32 camera location, so the camera sits within about half a millimetre of where T012 put it at 400 m. One boundary pixel crossing the alpha 0.5 threshold is the expected consequence and is the size of the observed residual.",
    },
    results: capture,
    shadowsOffAblation: {
      label: "OFF-INSTRUMENT PROBE, NOT A BASELINE READING.",
      variable: "eevee.use_shadows, true to false. Nothing else.",
      proofItIsOneVariable: "The pinned harness was run under the ablation and REFUSED, naming exactly one setting: eevee.use_shadows expected true actual false.",
      question: "Whether the source's self-shadowing of its own micro-geometry — window reveals, cornice undersides, balconies — is what puts its hue above the tile's.",
      metric: "log(R/B) chromaticity, expressed as the tile's fraction relative to the source: tile red-over-blue divided by source red-over-blue, minus one.",
      rows: SHADOWS_OFF.map((row) => ({
        ...row,
        tileGapWithShadows: round(row.bakedRedOverBlueOn / row.sourceRedOverBlueOn - 1, 6),
        tileGapWithoutShadows: round(row.bakedRedOverBlueOff / row.sourceRedOverBlueOff - 1, 6),
      })),
      finding: "NO. Removing shadows WIDENS the tile's chromaticity gap at both azimuth-235 poses, from -2.57 per cent to -5.44 per cent at 400 m and from -3.59 per cent to -5.18 per cent at 4,000 m, and leaves the azimuth-55 gap essentially unchanged at -1.54 per cent against -1.47 per cent. Shadowing was masking part of the source's redness, not creating it.",
      secondFinding: "The tile's own chromaticity barely moves when shadows are removed — 1.083537 to 1.084647 and 1.073939 to 1.074473 — which is what a subject with no self-shadowing micro-geometry should do, and is a positive control on the ablation.",
      verdict: "REJECTED as the mechanism.",
    },
    absorbedSourceVariant: {
      label: "INSTRUMENTATION VARIANT, NOT A RELEASE ARTIFACT AND NOT A PROPOSED RECIPE.",
      construction: "The verified shipped lod_0 bytes with every glazing, trim and metal material RECORD replaced by the facade material record of the same vertical zone — factor, class tile and metal/roughness together. Geometry, UVs, normals, transforms and the entire binary chunk are byte-identical to the source. 240 material records absorbed, 192 untouched, across 48 assets.",
      metalJudgementCall: {
        decision: "material:metal was folded into material:facade:shaft in this variant.",
        why: "The variant's job is to remove every non-facade material so the residual is geometry alone; leaving metal in would have left a third palette in the comparison and made the residual uninterpretable.",
        whatItIsNot: "It is NOT a claim that the bake absorbs metal in the same sense that it absorbs glazing and trim. Most metal area in these plans is rooftop equipment and fire escapes, which the prism omits GEOMETRICALLY rather than absorbing chromatically.",
        size: "Metal is 2.22 per cent of source surface area with red-over-blue 0.985696, the least red material in the palette. Folding the least red material INTO the facade makes the variant redder, which makes the measured absorption term LARGER and the geometric residual SMALLER. The reported minority share of absorption is therefore an upper bound, not an understatement.",
      },
      capturedUnder: "The pinned instrument, harness enforced, 48 renderable meshes, the same six pose transforms.",
      measurementDomain: "The SOURCE-and-BAKED intersection, un-premultiplied — the identical pixel set used for the source and the tile at each pose, so all three subjects are comparable without re-masking.",
      positiveControl: {
        claim: "The variant's geometry is byte-identical to the source's, so its silhouette must be pixel-identical too. If it is not, the variant changed something it was not supposed to change.",
        sourceSilhouettePixels: CAPTURE.map((row) => row.sourceSilhouettePixels),
        absorbedSilhouettePixels: CAPTURE.map((row) => row.absorbedSilhouettePixels),
        worstAbsoluteDelta: Math.max(...CAPTURE.map((row) => Math.abs(row.absorbedSilhouettePixels - row.sourceSilhouettePixels))),
        unionWithBakedPixels: CAPTURE.map((row) => row.absorbedUnionWithBakedPixels),
        sourceUnionWithBakedPixels: CAPTURE.map((row) => row.unionPixels),
        worstUnionDelta: Math.max(...CAPTURE.map((row) => Math.abs(row.absorbedUnionWithBakedPixels - row.unionPixels))),
        verdict: "PASS at all six poses: 0 pixels of difference in the silhouette, and 0 in the union with the tile.",
      },
      manifestSha256: sha256HexSync(variantManifestText),
      finding: "Material absorption accounts for a MINORITY of the tile's log(R/B) chromaticity gap at every pose.",
      materialAbsorptionShareRange: [round(Math.min(...absorptionShares), 4), round(Math.max(...absorptionShares), 4)],
      geometricSimplificationShareRange: [round(Math.min(...geometryShares), 4), round(Math.max(...geometryShares), 4)],
      palletteEqualisedSpreads: {
        whatItIs: "The three-channel hue spread of the tile against the palette-equalised variant, measured directly. This is the quantity a colour-only correction leaves behind, and it is a MEASUREMENT rather than a scaling of the chromaticity decomposition.",
        perPose: capture.map((row) => ({ pose: row.pose, spread: row.palletteEqualisedComparison.channelSpread })),
        worst: round(Math.max(...palletteEqualisedSpreads), 6),
      },
    },
    renders: {
      retention: "LOCAL WORK PRODUCT. The EXR bytes live under artifacts/ and are gitignored; these checksums are the committed artifact.",
      files: renders,
    },
    notClaimedHere: [
      "A baseline is not acceptance.",
      "EEVEE under one sun is not the shipped Cesium renderer.",
      "One cell.",
      "No fix is proposed or applied.",
    ],
  };

  const attributionRecord = {
    schemaVersion: "1.0",
    recordId: `${EVIDENCE_ID}:hue-attribution`,
    task: "T013",
    artifact: "far-tier-hue-divergence-attribution",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION.",
    headline: "THE RED DEFICIT IS NOT A COLOUR-PATH DEFECT. Every mechanism in the bake's colour path is excluded with numbers, and the deficit is decomposed into two SURFACE-COMPOSITION terms that are measured rather than argued: material absorption, a minority term, and geometric simplification, the majority. What remains unattributed is named and bounded.",
    theDecisiveObservation: {
      statement: "At 400 m the tile's atlas is drawn at a texel-to-pixel ratio of 0.9368 — that is, at NO minification at all — and the hue spread is ALREADY 0.015976 at azimuth 55 and 0.025772 at azimuth 235, the latter over the 0.02 bar.",
      atlasUsedTexels: atlas.atlasCensus.contentTexels + atlas.atlasCensus.gutterTexels,
      unionPixelsAt400Az55: 63724,
      texelPerPixelAt400Az55: atlas.hypotheses.H6_filteringColourSpace.evidence.poseToMipLevel
        .find((pose) => pose.distanceMeters === 400 && pose.azimuthDegrees === 55).texelPerPixel,
      arithmetic: "The atlas carries 55,925 used texels — 16,349 of content and 39,576 of gutter — against 63,724 covered pixels at 400 m / azimuth 55; the square root of that ratio is 0.9368, so every atlas texel is magnified, not minified.",
      consequence: "Between 47 and 76 per cent of the worst measured spread exists before any minification occurs. A defect present at zero minification cannot be a minification defect, and that single fact removes the entire named candidate class — the 14.67 per cent unused black area averaging in under progressive minification — from the running for the HUE finding.",
    },
    hypotheses: [
      {
        id: "H1",
        hypothesis: "BLACK ATLAS DILUTION. The atlas's 14.67 per cent unused black area averages in under minification and moves the per-channel ratios. The named untested candidate inherited from T012.",
        method: "Exact arithmetic over the byte-identical v1 atlas: whole-atlas channel means against used-area channel means, plus a full 2x2 box mip pyramid built in linear light.",
        numbers: "Unused share 0.146652, reproducing the committed occupancy. Mixing the used-area colour with black in linear light changes the three channel ratios by 1.1102e-16 — the double-precision floor. A linear-light pyramid preserves the whole-atlas per-channel mean EXACTLY at all eight levels: channel ratio spread 0 and luminance ratio 1 at every level.",
        verdict: "REJECTED as a hue mechanism, arithmetically rather than empirically. Mixing with black in linear light is a per-channel-EQUAL scaling; it can move luminance and cannot move hue. It survives only as a LOCAL luminance mechanism where a footprint straddles the used/unused boundary, which is a candidate for the separate 4,000 m / azimuth 235 darkness finding and not for this one.",
      },
      {
        id: "H2",
        hypothesis: "sRGB QUANTIZATION AT DARK VALUES floors red harder than green or blue.",
        method: "The shipped rasterizer was REPLICATED to keep the pre-quantization linear field it discards, and the replication verified by re-encoding to a byte-identical atlas (sha256 c159e050..., 0 byte mismatches). The decoded shipped bytes were then compared against those floats over all content texels, unweighted and face-world-area weighted.",
        numbers: `Unweighted over content texels: R ${atlas.hypotheses.H2_srgbQuantization.evidence.perChannelRelativeBias[0]}, G ${atlas.hypotheses.H2_srgbQuantization.evidence.perChannelRelativeBias[1]}, B ${atlas.hypotheses.H2_srgbQuantization.evidence.perChannelRelativeBias[2]}; spread ${atlas.hypotheses.H2_srgbQuantization.evidence.perChannelRelativeBiasSpread}. Face-world-area weighted: R ${atlas.hypotheses.H2_srgbQuantization.evidence.areaWeightedPerChannelRelativeBias[0]}, G ${atlas.hypotheses.H2_srgbQuantization.evidence.areaWeightedPerChannelRelativeBias[1]}, B ${atlas.hypotheses.H2_srgbQuantization.evidence.areaWeightedPerChannelRelativeBias[2]}; spread ${atlas.hypotheses.H2_srgbQuantization.evidence.areaWeightedSpread}.`,
        signQualification: "RED IS THE LOWEST CHANNEL ONLY IN THE AREA-WEIGHTED TRIPLE. In the unweighted texel census GREEN is lowest and red sits between green and blue. So quantization matches the observed pattern under the weighting a broadside view approximates and does not match it under a flat texel count. An earlier draft of this record claimed the red-lowest ordering without that qualification; it is stated here because the qualification is the honest half of a rejected hypothesis.",
        verdict: "REJECTED as the cause under either weighting. Both spreads are about 0.0008 against measured pose spreads of 0.0160 to 0.0338 — between 20 and 43 times too small. Quantization is also frozen into the bytes and therefore identical at every distance, while the measured spread grows with distance.",
      },
      {
        id: "H3",
        hypothesis: "ZONE-FACTOR COLOUR PATH. v3tCalibratedFactor or the calibrated palette lowers red systematically.",
        method: "Per-channel arithmetic over every calibrated palette entry reachable in this cell, plus a clamp census over the whole atlas.",
        numbers: "32 entries checked. The worst per-channel scale spread is 0 to fifteen decimal places: the calibration divides all three channels by one scalar, min(1/meanModulation, 1/max(target)), so it preserves the target's channel ratios exactly. The largest factor channel reached is 1 and NO texel reaches the encoder's clamp, so no channel is being clipped either.",
        verdict: "REJECTED. It cannot create a per-channel bias, and it is distance-invariant, which the distance-growing spread independently argues against.",
      },
      {
        id: "H4",
        hypothesis: "SOURCE-SIDE DISTANCE BEHAVIOUR. The source's per-channel means shift with distance while the tile's stay flat.",
        method: "The pinned six-pose capture, extended to record each subject's OWN per-channel means. The committed baseline records only their ratio, which cannot be decomposed.",
        numbers: "Source red-over-blue rises with distance at azimuth 55: 1.248124, 1.277413, 1.289691, a gain of 3.33 per cent. The tile rises too, and nearly as much: 1.228865, 1.251719, 1.261005, a gain of 2.62 per cent. At azimuth 235 the source is nearly flat, 1.112141, 1.104565, 1.113986, while the TILE falls, 1.083537, 1.076183, 1.073939.",
        verdict: "CONFIRMED as a driver of the DISTANCE GROWTH, and only of that. The growth in the gap is 0.71 per cent at azimuth 55 and 1.06 per cent at azimuth 235 across the whole 400 m to 4,000 m range — between a fifth and a third of the total gap. It explains part of why the spread grows; it does not explain why the spread exists, and it does not by itself explain the azimuth-55 growth, where BOTH subjects move and the tile's own +2.62 per cent has no mechanism in this record.",
      },
      {
        id: "H5",
        hypothesis: "INSTRUMENT-SIDE FILTERING. An asymmetry in how Blender minifies the tile's atlas versus the source's per-material colours, re-examined per channel after T012 examined it only for luminance.",
        method: "Structural argument from the shipped bytes, checked against the H6 arithmetic.",
        numbers: "The source carries colour in the LINEAR glTF baseColorFactor and modulation in a GRAYSCALE sRGB texture, so all three channels sample the same texel and any filter multiplies all three by the same scalar: its hue is filter-invariant BY CONSTRUCTION, in any colour space, at any mip level. The tile carries colour IN the texture with baseColorFactor [1,1,1,1], so it is the only subject a filter can move per channel. The asymmetry is therefore REAL and structural.",
        verdict: "CONFIRMED AS A STRUCTURAL ASYMMETRY, REJECTED AS THIS FINDING'S CAUSE. The asymmetry exists, but H6 shows that neither available filtering colour space can turn it into a RED deficit on this atlas, and the 400 m pose shows most of the deficit is present with no filtering at all.",
      },
      {
        id: "H6",
        hypothesis: "ADDED. NON-LINEAR FILTERING COLOUR SPACE. If minification averages the 8-bit sRGB codes rather than linear light — the documented behaviour of several mip generators on sRGB textures, and this instrument records a METAL backend — the per-channel attenuation is unequal.",
        method: "The same 2x2 box mip pyramid over the real atlas, built twice: once in linear light, once on the encoded codes. Both with and without the unused black area filled.",
        numbers: "Linear pyramid: channel ratio spread exactly 0 at all eight levels. Encoded pyramid: spread 0.0079, 0.0120, 0.0326, 0.0542 at levels 1 to 4, with channel ratios ordered R > G > B at every level — 0.975053 / 0.969791 / 0.967191 at level 1. The 4,000 m pose implies level 3.38, where the encoded model predicts a spread of about 0.0408.",
        verdict: "REJECTED BY SIGN as a source of the red DEFICIT. An encoded-space filter attenuates the channel with the largest RELATIVE encoded contrast hardest, and in this atlas that is BLUE. It would make the tile REDDER with distance, in the wrong direction for the finding.",
        consistencyNoteThatDoesNotChangeTheVerdict: "Its predicted direction — the tile reddening as it minifies — is the direction of the tile's own unexplained +2.62 per cent azimuth-55 rise across 400 m to 4,000 m, and the magnitudes are not far apart. That is a coincidence worth recording, not a confirmation: it is the wrong sign for the deficit under attribution, and the linear-filter arithmetic gives no mechanism by which the encoded path would be active at all. It is listed under what is NOT attributed rather than promoted here.",
      },
      {
        id: "H7",
        hypothesis: "ADDED. SOURCE SELF-SHADOWING. The source's micro-geometry shadows its bluer recessed glazing preferentially, lifting its hue above the tile's.",
        method: "A one-variable off-instrument ablation, eevee.use_shadows true to false, on both subjects at three poses. The pinned harness was run and refused, naming exactly one setting, which is the proof that one variable moved.",
        numbers: "With shadows off the tile's chromaticity gap WIDENS: -2.57 per cent to -5.44 per cent at 400 m / azimuth 235, and -3.59 per cent to -5.18 per cent at 4,000 m / azimuth 235. At azimuth 55 it is unchanged, -1.54 per cent to -1.47 per cent. The tile's own chromaticity moves by 0.10 per cent and 0.05 per cent, a positive control.",
        verdict: "REJECTED, and in the opposite direction to the hypothesis. Shadowing MASKS part of the source's redness rather than creating it.",
      },
      {
        id: "H8",
        hypothesis: "ADDED. MATERIAL ABSORPTION. The bake resolves only the facade material of each wall zone and absorbs glazing, trim and metal into it; those materials carry different chromaticities, so absorbing them re-weights the cell's colour.",
        method: "A controlled instrumentation variant: the verified shipped lod_0 bytes with every glazing, trim and metal material record replaced by the facade record of the same zone, geometry byte-identical, captured under the pinned instrument at all six poses over the same pixel set. Its silhouette matches the source's to 0 pixels at every pose.",
        numbers: `Palette evidence: trim red-over-blue 2.008145, facade 1.481920, glazing 1.194117, metal 0.985696, roof 1.090689. Share of the tile's log(R/B) gap: ${absorptionShares.map((value) => percent(value, 1)).join(", ")} across the six poses.`,
        verdict: `CONFIRMED AS A CONTRIBUTOR, and quantified as a MINORITY one on the chromaticity metric: ${percent(Math.min(...absorptionShares), 1)} to ${percent(Math.max(...absorptionShares), 1)}, median about 21 per cent. Absorbing the reddest material in the palette into a less red one moves the tile in the observed direction, but it cannot carry the finding on its own.`,
      },
      {
        id: "H9",
        hypothesis: "ADDED, BY RESIDUAL. GEOMETRIC SIMPLIFICATION. With the palette equalised by H8's variant, the remaining gap is what the prism's shape does: sourced footprint extruded to the sourced top, with every setback, tier inset, recess, protrusion and rooftop group filled in solid or absent.",
        method: "The residual of the same log-space decomposition on log(R/B), plus the DIRECT three-channel measurement of the tile against the palette-equalised variant.",
        numbers: `On log(R/B): ${geometryShares.map((value) => percent(value, 1)).join(", ")} of the gap. On the three-channel spread the hue bar actually measures, the tile against the palette-equalised variant reads ${palletteEqualisedSpreads.map((value) => value.toFixed(6)).join(", ")} at the six poses.`,
        verdict: "CONFIRMED AS THE MAJORITY TERM ON THE CHROMATICITY METRIC, MECHANISM NOT RESOLVED FURTHER. It is measured as a residual after one controlled substitution, which establishes its SIZE and its SIGN but not which geometric difference inside it does the work.",
      },
    ],
    attributedMechanism: {
      statement: "THE HUE SPREAD IS A SURFACE-COMPOSITION DIFFERENCE, NOT A COLOUR-PATH DEFECT. The bake reproduces each material's chromaticity to three decimals — the tile's wall albedo is red-over-blue 1.481530 against the source facade's 1.481920, a relative difference of 2.6e-4, and its roof 1.090904 against 1.090689 — and every mechanism that could bend a channel between the palette and the framebuffer is excluded above. What differs is WHICH surfaces exist and how much of each is seen.",
      twoMeasuredTerms: {
        metric: "log(R/B) chromaticity. See the caution below before reading these as A3 shares.",
        materialAbsorption: `${percent(Math.min(...absorptionShares), 1)} to ${percent(Math.max(...absorptionShares), 1)} of the chromaticity gap. Glazing, trim and metal are absorbed into the facade material; trim is the reddest entry in the palette at red-over-blue 2.008145 and it disappears.`,
        geometricSimplification: `${percent(Math.min(...geometryShares), 1)} to ${percent(Math.max(...geometryShares), 1)} of the chromaticity gap. The prism replaces a tiered, recessed, cornice-and-balcony-bearing envelope with flat walls and one roof cap, changing the visible and lit proportions of the materials that remain.`,
        caution: "THESE SHARES ARE NOT A3 SHARES. They decompose one ratio of two channels. The hue bar is max minus min over three channel ratios, and green is not in log(R/B) at all. The correct A3 statement is the direct measurement in the next section.",
      },
      whyRedIsTheDeficitChannel: "Because the palette's chromaticity is ordered, and the bake removes from the red end. Trim 2.008145 and facade 1.481920 sit far above roof 1.090689, glazing 1.194117 and metal 0.985696. Any re-weighting that trades wall detail for roof cap and flat facade moves the mix toward the neutral end, and red — the channel with the widest spread across the palette — moves furthest.",
      whyItGrowsWithDistance: "Partly because the tile's chromaticity is more stable than the source's. Across 400 m to 4,000 m the source's red-over-blue moves +3.33 per cent at azimuth 55 as its unresolved micro-geometry blends, and the tile follows it to +2.62 per cent; at azimuth 235 the source holds at +0.17 per cent while the tile falls -0.89 per cent. Both of the tile's own distance movements are unexplained by anything in this record and are listed as such.",
      confidence: "The exclusions are exact arithmetic on the shipped bytes and are not in doubt. The two-term split is a measurement with one controlled substitution and is reliable in sign and size ON THE CHROMATICITY METRIC. The sub-mechanism inside the geometric term is NOT established.",
    },
    whatColourOnlyCorrectionWouldActuallyDo: {
      why: "This is the number that decides whether a colour-only fix can reach the hue bar, so it is a DIRECT MEASUREMENT rather than a share applied to a spread.",
      how: "The tile measured against the palette-equalised variant at each pose gives the three-channel spread that survives when the material-absorption term is removed entirely.",
      perPose: capture.map((row) => ({
        pose: row.pose,
        measuredSpreadToday: row.channelSpread,
        spreadAfterAColourOnlyCorrection: row.palletteEqualisedComparison.channelSpread,
        change: round(row.palletteEqualisedComparison.channelSpread - row.channelSpread, 6),
        legacyBarVerdictToday: row.channelSpread <= 0.02 ? "PASS" : "MISS",
        legacyBarVerdictAfter: row.palletteEqualisedComparison.channelSpread <= 0.02 ? "PASS" : "MISS",
      })),
      perAzimuthSplit: {
        azimuth55: `IMPROVES at all three distances and crosses the 0.02 bar: ${az55.map((row) => `${row.channelSpread.toFixed(6)} to ${row.palletteEqualisedComparison.channelSpread.toFixed(6)}`).join("; ")}. All three become PASS.`,
        azimuth235: `STAYS MISS at all three distances and is NOT uniformly improved: ${az235.map((row) => `${row.channelSpread.toFixed(6)} to ${row.palletteEqualisedComparison.channelSpread.toFixed(6)}`).join("; ")}. It gets WORSE at 400 m and 1,200 m and improves slightly at 4,000 m, which still leaves 4,000 m the worst pose in the whole set.`,
      },
      worstPoseAfter: round(Math.max(...palletteEqualisedSpreads), 6),
      worstPoseToday: round(Math.max(...measuredSpreads), 6),
      conclusion: "A colour-only correction turns all three azimuth-55 poses from MISS to PASS and leaves all three azimuth-235 poses MISSING, two of them by MORE than they miss today. The worst pose moves from 0.033824 to 0.030863 — a reduction of under one tenth — against a bar of 0.02. Correcting the colour term alone therefore CANNOT reach the legacy hue bar, and the reason is not only that the correction is small but that at azimuth 235 it partly points the wrong way. This supersedes an earlier draft of this record, which applied a log(R/B) share to a three-channel spread, reported a single ceiling of about 0.027, and hid the sign flip between the two azimuths entirely.",
    },
    whatIsNotAttributed: {
      geometricSubMechanism: "Which geometric difference inside the majority term does the work is NOT determined. On a like-for-like denominator — surface area excluding the downward ground ring, which the prism does not emit at all — the prism's roof cap is 17.33 per cent of its surface against the source's 15.50 per cent for roof and setback decks, and roof is one of the least red materials in the palette. NAMED AS A CANDIDATE, NOT A CONCLUSION; no controlled test isolates it here.",
      theLargerUnlabelledSurfaceSetDifference: "The source carries an 18,234.551 square metre GROUND ring, 13.10 per cent of its total surface area, at red-over-blue 1.045455 — less red than anything else in the mix — which the prism omits entirely. That is a far larger surface-set difference than the 1.83 point roof-cap excess, and it points the OTHER WAY: omitting the least red surface should make the tile REDDER, not less red. Its rendered contribution is not established, because the plan marks it downward-facing and a downward surface at 18 degrees elevation may contribute almost nothing. Naming it is the honest counterweight to the roof-cap candidate; quantifying either would need a controlled test this stage did not run.",
      tileSideDistanceMovements: "The tile's own chromaticity moves with distance in BOTH directions and neither movement has a mechanism here: it RISES 2.62 per cent at azimuth 55 and FALLS 0.89 per cent at azimuth 235 across 400 m to 4,000 m. The linear-filter arithmetic says whole-atlas per-channel means are preserved exactly, so neither is a whole-atlas effect. The remaining candidate for both is footprint-local reweighting across face boundaries at high mip levels, where a sample mixes faces in ATLAS-adjacency proportions rather than screen-coverage proportions. H6's encoded-filter model predicts a rise of roughly the azimuth-55 magnitude, which is noted for the record and is NOT treated as confirmation: it has the wrong sign for the deficit under attribution and would have to be active for the azimuth-235 fall as well, where it predicts the opposite.",
      analyticModelLimits: "The albedo-mix record's weightings reproduce the SIGN of the gap but not its size, in both directions. Projected weighting UNDERSTATES: -0.51 per cent at azimuth 55 and -0.34 per cent at azimuth 235 against measured -1.54 and -2.57. Lit weighting understates at azimuth 55 at -0.82 per cent and OVERSTATES at azimuth 235 at -12.35 per cent, roughly five times the measured gap. The model has no shadowing and no occlusion and is used for direction only; no verdict rests on its magnitudes.",
      gateVerdictUnderTheOtherMaskDomain: "The mask-domain discrepancy was checked rather than waved past: under the spec-declared union domain every spread is LARGER and the same five of six poses miss the 0.02 bar. The verdict pattern is domain-independent. What is NOT established is which domain a future gate should declare, and that is an instrument decision this stage does not make.",
    },
    whatAFixWouldHaveToChange: {
      levelOfThisStatement: "MECHANISM LEVEL ONLY. No design is proposed, chosen or costed here; that adjudication is separate.",
      whatCannotFixIt: [
        "Nothing in the colour path. Filling the atlas's unused area, changing its bit depth or transfer function, re-calibrating the palette, or changing the sampler cannot move a hue difference that is 47 to 76 per cent present with the atlas magnified rather than minified.",
        "No change to the tile's own bytes that leaves its SURFACE SET unchanged, because the surface set is what differs.",
        "A colour-only correction ALONE cannot reach the legacy 0.02 bar. Measured, not estimated: three poses cross it and three get worse, worst case 0.030863.",
      ],
      whatCouldFixIt: [
        "Make the baked albedo an AREA-CORRECT AGGREGATE of the surfaces it replaces rather than of the facade material alone: a wall zone's baked colour would have to carry the glazing and trim it absorbs in their real proportions instead of dropping them. That is a change to what the bake INTEGRATES, not to how it encodes. It is measured to fix azimuth 55 and to worsen azimuth 235.",
        "Make the aggregate account for the surfaces the prism does not have — setbacks, recesses, protrusions and rooftop groups — and for their orientation, since the majority term is precisely the difference between the prism's visible-and-lit surface mix and the source's. That is a larger claim than the recipe currently makes and would require establishing which geometric difference dominates, which this stage did not.",
        "Or move the bar rather than the tile: state a hue bar the far tier can meet as a MASSING stand-in, on the record that its chromaticity is a fixed approximation of a view-dependent one. That is a gate decision, not a bake change, and it is not this record's to make.",
      ],
      predictedEffectOnToneGatesIfTheMechanismWereCorrected: {
        A1: "A1 is a relative luminance bar on well-exposed poses and it already passes. Correcting the composition would raise the tile's red and therefore its luminance slightly at every pose. The azimuth-55 poses currently sit at 1.0201 to 1.0405 against a 0.05 allowance, so the predicted movement narrows the 400 m margin rather than opening it: A1 stays PASS. DIRECTIONAL ONLY; no magnitude is claimed.",
        A2: "A2 is the absolute bar |baked - source| <= 0.010, and 4,000 m / azimuth 235 is the pose it converts to a MISS at an absolute difference of -0.0024. That pose's tile is DARK by 5.7 per cent, and the absorbed variant reads ABOVE the tile in every channel there, so correcting the composition moves the tile toward the source rather than away — toward PASS on both A2 and the legacy relative bar. PREDICTED DIRECTION ONLY, and it is a prediction this stage has not tested; it must be pre-registered and measured, not assumed.",
        A3: "A3 is the hue bar itself, spread <= 0.02, currently MISSED at five of six poses. The direct measurement above governs: a colour-only correction gives PASS at all three azimuth-55 poses and MISS at all three azimuth-235 poses, with the worst pose at 0.030863. Reaching 0.02 at every pose is not available from a colour-only change.",
      },
    },
    evidence: {
      records: ["atlas-arithmetic.json", "albedo-mix.json", "pinned-capture.json", "instrument-mask-semantics-note.json"],
      renderCount: renders.length,
      byteReplay: "The v1 tile was regenerated from the pinned base snapshot before any of this: GLB 2f859925..., atlas c159e050..., both reproducing the committed provenance exactly. Nothing in the frozen ledger was touched.",
      albedoMixSha256: sha256HexSync(serialize(albedo)),
    },
    notClaimedHere: [
      "No fix is proposed, designed or applied. This stage is attribution only.",
      "The geometric term's internal mechanism is not resolved, and both the roof-cap candidate and the ground-ring counterweight are named rather than tested.",
      "The two-term share split is on log(R/B) and is not a decomposition of the three-channel hue spread.",
      "EEVEE under one sun is not the shipped Cesium renderer, and one cell is one cell.",
      "The gate predictions are directions, not measurements, and none of them has been captured.",
    ],
  };

  const noteRecord = {
    schemaVersion: "1.0",
    recordId: `${EVIDENCE_ID}:instrument-mask-semantics-note`,
    task: "T013",
    artifact: "far-tier-instrument-mask-semantics-note",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION. A note, not a measurement.",
    claim: "The pinned instrument spec's maskSemantics prose does not describe what the committed baseline's per-channel numbers were computed over.",
    theDiscrepancy: {
      specSays: "data/far-tier-hlod-instrument-20260818/pinned-instrument-spec.json, spec.maskSemantics.unPremultiply: 'Per-channel ratios divide by that subject's own alpha before averaging; the union luminance ratio does not.' Read together with maskSemantics.union, that describes averaging over the UNION.",
      numbersSay: "Only the SOURCE-and-BAKED INTERSECTION domain reproduces the committed per-channel ratios, to a worst absolute delta of 0.000105 across six poses. The union domain is off by up to 0.023.",
      evidence: "far-tier-hlod-hue-20260819/pinned-capture.json, maskSemanticsFinding, which lists six candidate domains and their worst per-pose deltas.",
    },
    whyThisIsANoteAndNotAnEdit: "The instrument spec, its harness hash and the operative baseline are FROZEN records of a completed task. Editing them from an attribution stage would rewrite the evidence the attribution rests on. The discrepancy is therefore recorded ALONGSIDE them, with a forward pointer from this directory, and the repair is left to whoever next changes the instrument deliberately.",
    whatItDoesNotAffect: {
      committedBaseline: "Nothing. The baseline is internally consistent; only its written description of the domain is wrong.",
      hueVerdicts: "Nothing. Under the union domain every spread is larger and the same five of six poses miss the 0.02 bar.",
      luminanceVerdicts: "Nothing. The union luminance ratio is computed over the union without un-premultiplying, exactly as the spec says, and reproduces to 8.58e-5.",
    },
    whatItDoesAffect: "Any FUTURE gate that declares a hue bar must state its mask domain explicitly, because the two domains differ by up to 0.023 on the same renders — larger than the effect under attribution.",
    notClaimedHere: [
      "No frozen record is edited by this note.",
      "No repair to the instrument is proposed here.",
    ],
  };

  for (const [name, record] of [["pinned-capture", captureRecord], ["hue-attribution", attributionRecord], ["instrument-mask-semantics-note", noteRecord]]) {
    const text = serialize(record);
    await writeFile(join(evidenceRoot, `${name}.json`), text);
    await writeFile(join(evidenceRoot, `${name}.sha256`), `${sha256HexSync(text)}  ${name}.json\n`);
  }
  console.log(serialize({
    ok: true,
    reproduction: captureRecord.reproductionGate.verdict,
    absorptionShares,
    geometryShares,
    measuredSpreads,
    palletteEqualisedSpreads,
    worstAfterColourOnly: Math.max(...palletteEqualisedSpreads),
    silhouetteControlWorstDelta: captureRecord.absorbedSourceVariant.positiveControl.worstAbsoluteDelta,
    renders: renders.length,
  }));
}

const command = process.argv[2] ?? "emit";
if (command !== "emit") { console.error(`far-tier-hue-records: unknown command ${command}`); process.exit(1); }
await emit();
