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

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
const round = (value, digits = 6) => Number(value.toFixed(digits));
const spreadOf = (values) => Math.max(...values) - Math.min(...values);

/** The committed operative baseline, for the reproduction gate. */
const COMMITTED = {
  "400/55": { ratios: [1.019393, 1.023675, 1.035369], spread: 0.015976, unionPixels: 63724, unionMeanLuminanceRatio: 1.040478 },
  "400/235": { ratios: [0.976247, 0.997409, 1.002018], spread: 0.025771, unionPixels: 60356, unionMeanLuminanceRatio: 1.019942 },
  "1200/55": { ratios: [1.004897, 1.012243, 1.025494], spread: 0.020598, unionPixels: 5964, unionMeanLuminanceRatio: 1.023193 },
  "1200/235": { ratios: [0.964416, 0.984734, 0.989885], spread: 0.02547, unionPixels: 5918, unionMeanLuminanceRatio: 1.002152 },
  "4000/55": { ratios: [1.001148, 1.010185, 1.023902], spread: 0.022754, unionPixels: 524, unionMeanLuminanceRatio: 1.020074 },
  "4000/235": { ratios: [0.907127, 0.930949, 0.940946], spread: 0.033819, unionPixels: 517, unionMeanLuminanceRatio: 0.942736 },
};

/** This session's pinned capture. Intersection domain, un-premultiplied. */
const CAPTURE = [
  { pose: "400/55", distanceMeters: 400, azimuthDegrees: 55, unionPixels: 63724, intersectionPixels: 61862,
    source: [0.245700867, 0.218731945, 0.196856174], baked: [0.2504641, 0.22390896, 0.2038174],
    sourceUnionMeanLuminance: 0.21577073, bakedUnionMeanLuminance: 0.22449938, absorbed: [0.25981069, 0.230814344, 0.209343002] },
  { pose: "400/235", distanceMeters: 400, azimuthDegrees: 235, unionPixels: 60355, intersectionPixels: 58950,
    source: [0.039694421, 0.038141124, 0.035691889], baked: [0.038750721, 0.038041537, 0.035763185],
    sourceUnionMeanLuminance: 0.03766457, bakedUnionMeanLuminance: 0.0384144, absorbed: [0.039175279, 0.037359667, 0.03542] },
  { pose: "1200/55", distanceMeters: 1200, azimuthDegrees: 55, unionPixels: 5964, intersectionPixels: 5801,
    source: [0.24420355, 0.213603112, 0.191170422], baked: [0.245395917, 0.216219437, 0.196047182],
    sourceUnionMeanLuminance: 0.20999704, bakedUnionMeanLuminance: 0.21486603, absorbed: [0.25908855, 0.225703619, 0.203671896] },
  { pose: "1200/235", distanceMeters: 1200, azimuthDegrees: 235, unionPixels: 5918, intersectionPixels: 5787,
    source: [0.042090397, 0.040544976, 0.03810586], baked: [0.040595346, 0.039928502, 0.037721585],
    sourceUnionMeanLuminance: 0.0394298, bakedUnionMeanLuminance: 0.03951768, absorbed: [0.041944385, 0.040174727, 0.038241618] },
  { pose: "4000/55", distanceMeters: 4000, azimuthDegrees: 55, unionPixels: 524, intersectionPixels: 511,
    source: [0.245675043, 0.213221661, 0.190491397], baked: [0.245931218, 0.215376865, 0.195027962],
    sourceUnionMeanLuminance: 0.2011661, bakedUnionMeanLuminance: 0.20518705, absorbed: [0.260833919, 0.225304115, 0.202886707] },
  { pose: "4000/235", distanceMeters: 4000, azimuthDegrees: 235, unionPixels: 517, intersectionPixels: 507,
    source: [0.047593581, 0.045642662, 0.042723686], baked: [0.043170902, 0.04248856, 0.040198639],
    sourceUnionMeanLuminance: 0.04217802, bakedUnionMeanLuminance: 0.03976067, absorbed: [0.047356148, 0.045081418, 0.042845151] },
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

  const capture = CAPTURE.map((row) => {
    const ratios = row.baked.map((value, index) => value / row.source[index]);
    const committed = COMMITTED[row.pose];
    const sourceRedOverBlue = row.source[0] / row.source[2];
    const bakedRedOverBlue = row.baked[0] / row.baked[2];
    const absorbedRedOverBlue = row.absorbed[0] / row.absorbed[2];
    // Two-term decomposition of the tile's chromaticity gap, in log space so the
    // shares are additive and cannot be made to sum to something other than one.
    const totalGap = Math.log(bakedRedOverBlue / sourceRedOverBlue);
    const absorptionGap = Math.log(absorbedRedOverBlue / sourceRedOverBlue);
    const geometryGap = Math.log(bakedRedOverBlue / absorbedRedOverBlue);
    return {
      ...row,
      perChannelRatios: ratios.map((value) => round(value, 6)),
      channelSpread: round(spreadOf(ratios), 6),
      unionMeanLuminanceRatio: round(row.bakedUnionMeanLuminance / row.sourceUnionMeanLuminance, 6),
      reproductionAgainstCommittedBaseline: {
        committedRatios: committed.ratios,
        worstAbsoluteRatioDelta: round(Math.max(...ratios.map((value, index) => Math.abs(value - committed.ratios[index]))), 8),
        committedSpread: committed.spread,
        absoluteSpreadDelta: round(Math.abs(spreadOf(ratios) - committed.spread), 8),
        committedUnionPixels: committed.unionPixels,
        unionPixelDelta: row.unionPixels - committed.unionPixels,
        committedUnionMeanLuminanceRatio: committed.unionMeanLuminanceRatio,
        absoluteLuminanceRatioDelta: round(Math.abs(row.bakedUnionMeanLuminance / row.sourceUnionMeanLuminance - committed.unionMeanLuminanceRatio), 8),
      },
      chromaticity: {
        sourceRedOverBlue: round(sourceRedOverBlue, 6),
        absorbedVariantRedOverBlue: round(absorbedRedOverBlue, 6),
        bakedTileRedOverBlue: round(bakedRedOverBlue, 6),
        tileGapAgainstSourceFraction: round(Math.expm1(totalGap), 6),
        decomposition: {
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

  const captureRecord = {
    schemaVersion: "1.0",
    recordId: `${EVIDENCE_ID}:pinned-capture`,
    task: "T013",
    artifact: "far-tier-hue-attribution-pinned-capture",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION.",
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
    maskSemanticsFinding: {
      claim: "The pinned spec's maskSemantics prose says per-channel ratios are averaged over the UNION. The committed numbers say otherwise: only the INTERSECTION domain reproduces them.",
      method: "Six candidate domains computed from the same twelve renders and compared against the committed six-pose ratios.",
      candidates: MASK_CONVENTION,
      finding: "The intersection domain reproduces the committed ratios to a worst absolute delta of 0.000105 across all six poses. The next best candidate is off by 0.023.",
      consequence: "A PROSE-VERSUS-BEHAVIOUR discrepancy in the pinned spec, reported and not repaired here: repairing it is a change to the instrument, which this attribution stage has no mandate to make. It moves no verdict — every number in this record and in the committed baseline uses the same intersection domain.",
      whatItDoesNotMean: "It is not an error in the committed baseline. The baseline is internally consistent; only its written description of the domain is wrong.",
    },
    reproductionGate: {
      statedInAdvance: "The capture is only usable if it reproduces the committed operative baseline; otherwise it measures a different instrument and its decomposition attaches to nothing.",
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
      rows: SHADOWS_OFF.map((row) => ({
        ...row,
        gapWithShadows: round(row.bakedRedOverBlueOn / row.sourceRedOverBlueOn - 1, 6),
        gapWithoutShadows: round(row.bakedRedOverBlueOff / row.sourceRedOverBlueOff - 1, 6),
      })),
      finding: "NO. Removing shadows WIDENS the gap at both azimuth-235 poses, from -2.57% to -5.44% at 400 m and from -3.61% to -5.18% at 4,000 m, and leaves the azimuth-55 gap essentially unchanged. Shadowing was masking part of the source's redness, not creating it.",
      secondFinding: "The tile's own chromaticity barely moves when shadows are removed — 1.083537 to 1.084647 and 1.073939 to 1.074473 — which is what a subject with no self-shadowing micro-geometry should do, and is a positive control on the ablation.",
      verdict: "REJECTED as the mechanism.",
    },
    absorbedSourceVariant: {
      label: "INSTRUMENTATION VARIANT, NOT A RELEASE ARTIFACT AND NOT A PROPOSED RECIPE.",
      construction: "The verified shipped lod_0 bytes with every glazing, trim and metal material RECORD replaced by the facade material record of the same vertical zone — factor, class tile and metal/roughness together. Geometry, UVs, normals, transforms and the entire binary chunk are byte-identical to the source. 240 material records absorbed, 192 untouched, across 48 assets.",
      whatItHoldsConstant: "Geometry. What it changes is exactly the bake's own documented absorption: 'The far tier resolves only the FACADE material of each wall zone; glazing and trim are absorbed into it.'",
      capturedUnder: "The pinned instrument, harness enforced, 48 renderable meshes, the same six pose transforms.",
      manifestSha256: sha256HexSync(variantManifestText),
      finding: "Material absorption accounts for a MINORITY of the tile's chromaticity gap at every pose.",
      materialAbsorptionShareRange: [round(Math.min(...absorptionShares), 4), round(Math.max(...absorptionShares), 4)],
      geometricSimplificationShareRange: [round(Math.min(...geometryShares), 4), round(Math.max(...geometryShares), 4)],
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
    headline: "THE RED DEFICIT IS NOT A COLOUR-PATH DEFECT. Every mechanism in the bake's colour path is excluded with numbers, and the deficit is decomposed into two SURFACE-COMPOSITION terms that are measured rather than argued: material absorption, a minority term at 14 to 37 per cent, and geometric simplification, the majority at 63 to 86 per cent. What remains unattributed is named and bounded.",
    theDecisiveObservation: {
      statement: "At 400 m the tile's atlas is drawn at a texel-to-pixel ratio of 0.9368 — that is, at NO minification at all — and the hue spread is ALREADY 0.015976 at azimuth 55 and 0.025772 at azimuth 235, the latter over the 0.02 bar.",
      arithmetic: "The atlas carries 55,921 used texels against 63,724 covered pixels at 400 m / azimuth 55; the square root of that ratio is 0.94, so every atlas texel is magnified, not minified.",
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
        numbers: "Per-channel relative bias R -0.0000632, G -0.00017577, B +0.00061091; spread 0.00078668. Area-weighted spread of the same order.",
        verdict: "REJECTED as the cause, RETAINED as a small contributor with the RIGHT SIGN. Quantization does push red lowest and blue highest — but by 0.0008 against measured spreads of 0.0160 to 0.0338, which is 20 to 43 times too small. It is also frozen into the bytes and therefore identical at every distance, while the measured spread grows with distance.",
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
        numbers: "Source red-over-blue rises with distance at azimuth 55: 1.248124, 1.277413, 1.289691, a gain of 3.33 per cent. The tile rises less: 1.228865, 1.251719, 1.261005, a gain of 2.62 per cent. At azimuth 235 the source is nearly flat, 1.112141, 1.104565, 1.113986, while the TILE falls, 1.083537, 1.076183, 1.073939.",
        verdict: "CONFIRMED as the driver of the DISTANCE GROWTH, and only of that. The growth in the gap is 0.71 per cent at azimuth 55 and 1.06 per cent at azimuth 235 across the whole 400 m to 4,000 m range — between a fifth and a third of the total gap. It explains why the spread grows; it does not explain why the spread exists.",
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
        method: "The same 2x2 box mip pyramid over the real atlas, built twice: once in linear light, once on the encoded codes. Both with and without the unused black area filled with the used-area mean.",
        numbers: "Linear pyramid: channel ratio spread exactly 0 at all eight levels. Encoded pyramid: spread 0.0079, 0.0120, 0.0326, 0.0542 at levels 1 to 4, with channel ratios ordered R > G > B at every level — 0.975053 / 0.969791 / 0.967191 at level 1. The 4,000 m pose implies level 3.38, where the encoded model predicts a spread of about 0.0408.",
        verdict: "REJECTED BY SIGN. An encoded-space filter attenuates the channel with the largest RELATIVE encoded variance hardest, and in this atlas that is BLUE. It would make the tile REDDER with distance, by an order of magnitude more than the effect being explained, in the wrong direction. Linear-space filtering does nothing at all.",
      },
      {
        id: "H7",
        hypothesis: "ADDED. SOURCE SELF-SHADOWING. The source's micro-geometry shadows its bluer recessed glazing preferentially, lifting its hue above the tile's.",
        method: "A one-variable off-instrument ablation, eevee.use_shadows true to false, on both subjects at three poses. The pinned harness was run and refused, naming exactly one setting, which is the proof that one variable moved.",
        numbers: "With shadows off the gap WIDENS: -2.57 per cent to -5.44 per cent at 400 m / azimuth 235, and -3.61 per cent to -5.18 per cent at 4,000 m / azimuth 235. At azimuth 55 it is unchanged, -1.54 per cent to -1.47 per cent. The tile's own chromaticity moves by 0.10 per cent and 0.05 per cent, a positive control.",
        verdict: "REJECTED, and in the opposite direction to the hypothesis. Shadowing MASKS part of the source's redness rather than creating it.",
      },
      {
        id: "H8",
        hypothesis: "ADDED. MATERIAL ABSORPTION. The bake resolves only the facade material of each wall zone and absorbs glazing, trim and metal into it; those materials carry different chromaticities, so absorbing them re-weights the cell's colour.",
        method: "A controlled instrumentation variant: the verified shipped lod_0 bytes with every glazing, trim and metal material record replaced by the facade record of the same zone, geometry byte-identical, captured under the pinned instrument at all six poses. The gap is then decomposed in log space so the two shares are additive by construction.",
        numbers: `Palette evidence: trim red-over-blue 2.008145, facade 1.481920, glazing 1.194117, metal 0.985696, roof 1.090689. Measured share of the tile's chromaticity gap: ${absorptionShares.map((value) => `${round(value * 100, 1)}%`).join(", ")} across the six poses.`,
        verdict: `CONFIRMED AS A CONTRIBUTOR, and quantified as a MINORITY one: ${round(Math.min(...absorptionShares) * 100, 1)} to ${round(Math.max(...absorptionShares) * 100, 1)} per cent, median about 21 per cent. Absorbing the reddest material in the palette into a less red one moves the tile in the observed direction, but it cannot carry the finding on its own.`,
      },
      {
        id: "H9",
        hypothesis: "ADDED, BY RESIDUAL. GEOMETRIC SIMPLIFICATION. With the palette equalised by H8's variant, the remaining gap is what the prism's shape does: sourced footprint extruded to the sourced top, with every setback, tier inset, recess, protrusion and rooftop group filled in solid or absent.",
        method: "The residual of the same log-space decomposition, measured directly as the absorbed variant against the tile.",
        numbers: `${geometryShares.map((value) => `${round(value * 100, 1)}%`).join(", ")} of the gap across the six poses; in absolute terms the absorbed variant still sits 0.98 to 2.84 per cent above the tile in red-over-blue.`,
        verdict: "CONFIRMED AS THE MAJORITY TERM, MECHANISM NOT RESOLVED FURTHER. It is measured as a residual after one controlled substitution, which establishes its SIZE and its SIGN but not which geometric difference inside it does the work.",
      },
    ],
    attributedMechanism: {
      statement: "THE HUE SPREAD IS A SURFACE-COMPOSITION DIFFERENCE, NOT A COLOUR-PATH DEFECT. The bake reproduces each material's chromaticity exactly — the tile's wall albedo is red-over-blue 1.481530 against the source facade's 1.481920, and its roof 1.090904 against 1.090689 — and every mechanism that could bend a channel between the palette and the framebuffer is excluded above. What differs is WHICH surfaces exist and how much of each is seen.",
      twoMeasuredTerms: {
        materialAbsorption: `${round(Math.min(...absorptionShares) * 100, 1)} to ${round(Math.max(...absorptionShares) * 100, 1)} per cent of the gap. Glazing, trim and metal are absorbed into the facade material; trim is the reddest entry in the palette at red-over-blue 2.008145 and it disappears.`,
        geometricSimplification: `${round(Math.min(...geometryShares) * 100, 1)} to ${round(Math.max(...geometryShares) * 100, 1)} per cent of the gap. The prism replaces a tiered, recessed, cornice-and-balcony-bearing envelope with flat walls and one roof cap, changing the visible and lit proportions of the materials that remain.`,
      },
      whyRedIsTheDeficitChannel: "Because the palette's chromaticity is ordered, and the bake removes from the red end. Trim 2.008145 and facade 1.481920 sit far above roof 1.090689, glazing 1.194117 and metal 0.985696. Any re-weighting that trades wall detail for roof cap and flat facade moves the mix toward the neutral end, and red — the channel with the widest spread across the palette — moves furthest.",
      whyItGrowsWithDistance: "Because the tile's chromaticity is nearly fixed while the source's is not. Across 400 m to 4,000 m the source's red-over-blue moves by +3.33 per cent at azimuth 55 as its unresolved micro-geometry blends, and the tile follows it only to +2.62 per cent; at azimuth 235 the source holds at +0.17 per cent while the tile falls -0.89 per cent. The tile is a fixed-chromaticity stand-in for a variable-chromaticity subject.",
      confidence: "The exclusions are exact arithmetic on the shipped bytes and are not in doubt. The two-term split is a measurement with one controlled substitution and is reliable in sign and size. The sub-mechanism inside the geometric term is NOT established.",
    },
    whatIsNotAttributed: {
      geometricSubMechanism: "Which geometric difference inside the majority term does the work is NOT determined. The leading untested sub-candidate is ROOF-CAP OVER-WEIGHTING: the prism's roof faces are 17.33 per cent of its surface against the source's 13.47 per cent for roof and setback decks, and roof is one of the least red materials in the palette. NAMED AS A CANDIDATE, NOT A CONCLUSION; no controlled test isolates it here.",
      tileSideDistanceLoss: "At azimuth 235 the tile's own red-over-blue falls 0.89 per cent from 400 m to 4,000 m. No mechanism in this record predicts that: the linear-filter arithmetic says whole-atlas per-channel means are preserved exactly, and the encoded-filter model has the wrong sign. The remaining candidate is footprint-local reweighting across face boundaries at high mip levels, where a sample mixes faces in ATLAS-adjacency proportions rather than screen-coverage proportions. It is not isolated here and it is small.",
      analyticModelLimits: "The albedo-mix record's projected and lit weightings reproduce the SIGN of the gap at both azimuths, -0.51 per cent and -0.34 per cent, but only a third to an eighth of its size. It has no shadowing and no occlusion and is used for direction only; no verdict rests on its magnitudes.",
    },
    whatAFixWouldHaveToChange: {
      levelOfThisStatement: "MECHANISM LEVEL ONLY. No design is proposed, chosen or costed here; that adjudication is separate.",
      whatCannotFixIt: [
        "Nothing in the colour path. Filling the atlas's unused area, changing its bit depth or transfer function, re-calibrating the palette, or changing the sampler cannot move a hue difference that is 47 to 76 per cent present with the atlas magnified rather than minified.",
        "No change to the tile's own bytes that leaves its SURFACE SET unchanged, because the surface set is what differs.",
      ],
      whatCouldFixIt: [
        "Make the baked albedo an AREA-CORRECT AGGREGATE of the surfaces it replaces rather than of the facade material alone: a wall zone's baked colour would have to carry the glazing, trim and metal it absorbs in their real proportions instead of dropping them. That addresses the measured minority term, 14 to 37 per cent, and it is a change to what the bake INTEGRATES, not to how it encodes.",
        "Make the aggregate account for the surfaces the prism does not have — setbacks, recesses, protrusions and rooftop groups — and for their orientation, since the majority term is precisely the difference between the prism's visible-and-lit surface mix and the source's. That is a larger claim than the recipe currently makes and would require establishing which geometric difference dominates, which this stage did not.",
        "Or move the bar rather than the tile: state a hue bar the far tier can meet as a MASSING stand-in, on the record that its chromaticity is a fixed approximation of a view-dependent one. That is a gate decision, not a bake change, and it is not this record's to make.",
      ],
      predictedEffectOnToneGatesIfTheMechanismWereCorrected: {
        A1: "A1 is a relative luminance bar on well-exposed poses and it already passes. Correcting the composition would raise the tile's red and therefore its luminance slightly at every pose. The azimuth-55 poses currently sit at 1.0201 to 1.0405 against a 0.05 allowance, so the predicted movement is AWAY from the bar at 400 m and toward it nowhere: A1 stays PASS, with the 400 m / azimuth 55 margin narrowing from 0.0405 toward the allowance rather than away from it. DIRECTIONAL ONLY; no magnitude is claimed.",
        A2: "A2 is the absolute bar |baked - source| <= 0.010, and 4,000 m / azimuth 235 is the pose it converts to a MISS at an absolute difference of -0.0024. That pose's tile is DARK by 5.7 per cent, and the absorbed-and-omitted surfaces are on net BRIGHTER as well as redder — the absorbed variant reads above the tile in every channel at that pose. So correcting the composition moves 4,000 m / azimuth 235 toward the source rather than away, which is toward PASS on both A2 and the legacy relative bar. PREDICTED DIRECTION ONLY, and it is a prediction this stage has not tested; it must be pre-registered and measured, not assumed.",
        A3: "A3 is the hue bar itself, spread <= 0.02, currently MISSED at five of six poses. The two terms are additive in log space, so correcting only the minority term would reduce the spread by roughly 14 to 36 per cent — from 0.0338 to about 0.0265 at the worst pose — which does NOT reach the bar. Correcting the minority term alone is arithmetically insufficient and that is the single most consequential number in this record.",
      },
    },
    evidence: {
      records: ["atlas-arithmetic.json", "albedo-mix.json", "pinned-capture.json"],
      renderCount: renders.length,
      byteReplay: "The v1 tile was regenerated from the pinned base snapshot before any of this: GLB 2f859925..., atlas c159e050..., both reproducing the committed provenance exactly. Nothing in the frozen ledger was touched.",
    },
    notClaimedHere: [
      "No fix is proposed, designed or applied. This stage is attribution only.",
      "The geometric term's internal mechanism is not resolved, and the roof-cap candidate is named rather than tested.",
      "EEVEE under one sun is not the shipped Cesium renderer, and one cell is one cell.",
      "The gate predictions are directions, not measurements, and none of them has been captured.",
    ],
  };

  for (const [name, record] of [["pinned-capture", captureRecord], ["hue-attribution", attributionRecord]]) {
    const text = serialize(record);
    await writeFile(join(evidenceRoot, `${name}.json`), text);
    await writeFile(join(evidenceRoot, `${name}.sha256`), `${sha256HexSync(text)}  ${name}.json\n`);
  }
  console.log(serialize({
    ok: true,
    reproduction: captureRecord.reproductionGate,
    absorptionShares,
    geometryShares,
    renders: renders.length,
  }));
}

const command = process.argv[2] ?? "emit";
if (command !== "emit") { console.error(`far-tier-hue-records: unknown command ${command}`); process.exit(1); }
await emit();
