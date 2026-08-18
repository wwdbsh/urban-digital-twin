/* global console, process */
/**
 * T010 Stage B: derive the shading term, publish the point predictions, and
 * record the verdict the derivation predicts BEFORE any v2 capture.
 *
 * This is the anti-fitting protocol made executable. The scalar is computed
 * from committed plan geometry by committed code; the predictions are computed
 * from it and from the disclosed decomposition; and the predicted verdict is
 * written down whatever it says. Nothing here reads a v2 capture, because at
 * the time this runs there is none.
 *
 * Usage: node --experimental-strip-types scripts/far-tier-v2-shading-cli.mjs predict [--cell <id>]
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { buildMidtownCoreV3Plan } from "../src/release/midtown-core-v3-materialization.ts";
import { farTierRoofScalarBand, farTierShadingTerm } from "../src/release/far-tier-shading.ts";
import { DEFAULT_CELL_ID, materializeCell } from "./far-tier-bake-cli.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_ID = "far-tier-hlod-v2-20260818";
const evidenceRoot = join(repositoryRoot, "data", EVIDENCE_ID);
const t002Root = join(repositoryRoot, "data/far-tier-hlod-20260818");

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
const fail = (message) => { console.error(`far-tier-v2-shading: ${message}`); process.exit(1); };
const round = (value, places = 8) => Number.parseFloat(value.toFixed(places));

/** The tone bar, unchanged from T002 and not amendable by this task. */
const TONE_BAR = 0.05;

/**
 * The decomposition, measured in Blender and transcribed here.
 *
 * DISCLOSED INSTRUMENTATION. Full geometry every time, with one surface class
 * forced to a black CONDUCTOR so it occludes without contributing. A black
 * dielectric was tried first and was wrong: glTF gives every dielectric a ~4%
 * specular floor, which returned 0.016708 of neutral grey over 3,131 pixels and
 * corrupted the shadow-pose split by more than the quantity being measured.
 */
const DECOMPOSITION = [
  { distanceMeters: 400, azimuthDegrees: 55, maskPixels: 63514, L_full: 0.22512126, W_wall: 0.1803481, R_roof: 0.04637752 },
  { distanceMeters: 400, azimuthDegrees: 235, maskPixels: 60153, L_full: 0.0384713, W_wall: 0.00215149, R_roof: 0.03761405 },
  { distanceMeters: 1200, azimuthDegrees: 55, maskPixels: 5945, L_full: 0.21535069, W_wall: 0.17392367, R_roof: 0.04319247 },
  { distanceMeters: 1200, azimuthDegrees: 235, maskPixels: 5889, L_full: 0.03957273, W_wall: 0.00134595, R_roof: 0.03957231 },
  { distanceMeters: 4000, azimuthDegrees: 55, maskPixels: 524, L_full: 0.20518977, W_wall: 0.16619937, R_roof: 0.04074548 },
  { distanceMeters: 4000, azimuthDegrees: 235, maskPixels: 516, L_full: 0.03985023, W_wall: 0.0013514, R_roof: 0.03984916 },
];

/** The committed T002 v1 union ratios these predictions are relative to. */
const V1_RATIOS = {
  "400/55": 1.027322, "400/235": 1.09607,
  "1200/55": 1.013019, "1200/235": 1.072801,
  "4000/55": 1.013554, "4000/235": 1.019795,
};
const BARRED = new Set(["1200/55", "1200/235", "4000/55", "4000/235"]);

async function commandPredict(cellId) {
  const context = await materializeCell(cellId);
  const plans = [];
  for (const buildingId of [...context.cell.buildingIds].sort()) {
    const source = context.sources.get(buildingId);
    if (!source) continue;
    try { plans.push(buildMidtownCoreV3Plan(source, context.planChecksumSha256, context.profile).plan); } catch { /* grammar refusal; tombstoned and ships nothing */ }
  }
  if (plans.length === 0) fail("the cell produced no plan; the term cannot be derived.");
  const term = farTierShadingTerm(plans);

  const shadow = DECOMPOSITION.find((row) => row.distanceMeters === 1_200 && row.azimuthDegrees === 235);
  const lit = DECOMPOSITION.find((row) => row.distanceMeters === 1_200 && row.azimuthDegrees === 55);
  // What the failing pose must lose, and what the lit pose may afford to lose,
  // both in absolute mean linear luminance, from the committed T002 readings.
  const requiredShadowReduction = round(0.042303 - 0.042303 * (1 + TONE_BAR) / V1_RATIOS["1200/235"]);
  const permittedLitReduction = round(0.212612 - 0.20988 * (1 - TONE_BAR));
  const band = farTierRoofScalarBand({
    roofLuminanceShadow: shadow.R_roof,
    roofLuminanceLit: lit.R_roof,
    requiredShadowReduction,
    permittedLitReduction,
  });

  const predictions = DECOMPOSITION.map((row) => {
    const key = `${row.distanceMeters}/${row.azimuthDegrees}`;
    // Darkening the roof by (1 - roofScalar) removes exactly that share of the
    // roof's own contribution, and nothing else changes.
    const gEff = (row.L_full - row.R_roof * (1 - term.roofScalar)) / row.L_full;
    const predicted = gEff * V1_RATIOS[key];
    const barred = BARRED.has(key);
    return {
      distanceMeters: row.distanceMeters, azimuthDegrees: row.azimuthDegrees, barred,
      roofShare: round(row.R_roof / row.L_full, 6),
      wallShare: round(row.W_wall / row.L_full, 6),
      gEff: round(gEff),
      unionMeanLuminanceRatioV1: V1_RATIOS[key],
      predictedUnionMeanLuminanceRatioV2: round(predicted),
      predictedVerdict: barred ? (Math.abs(predicted - 1) <= TONE_BAR ? "PASS" : "MISS") : "not barred",
    };
  });
  const predictedMisses = predictions.filter((entry) => entry.predictedVerdict === "MISS");

  const t002SamplingText = await readFile(join(t002Root, "sampling-results.json"), "utf8");
  const stageAPath = join(evidenceRoot, "stage-a-packing-census.json");
  const stageAText = await readFile(stageAPath, "utf8").catch(() => null);
  if (stageAText === null) fail("stage-a-packing-census.json is absent; Stage B's lineage must bind to the Stage A census it follows.");

  const record = {
    schemaVersion: "1.0",
    recordId: `${EVIDENCE_ID}:stage-b-decomposition-and-prediction`,
    task: "T010",
    artifact: "far-tier-v2-shading-derivation-and-point-predictions",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION. The decomposition transcribed here is a capture, but the derivation and every prediction below are arithmetic; a timestamp would be the only irreproducible field.",
    status: "PUBLISHED BEFORE ANY v2 CAPTURE. No v2 tile has been baked and no v2 still has been taken at the time this record is committed.",
    claim: "The roof/wall luminance decomposition of the far-tier tile, the shading term derived from committed plan geometry, and the six point predictions that term implies — all fixed before any measurement could confirm or refute them.",

    lineage: {
      stageARecord: "data/far-tier-hlod-v2-20260818/stage-a-packing-census.json",
      stageARecordSha256: sha256HexSync(stageAText),
      stageARelationship: "Stage A changed the PACKING and Stage B derives a SHADING term. They are independent: the term below is a property of plan geometry and would be the same number under either packing. The binding exists so the two halves of one task cannot drift apart unnoticed.",
      v1SamplingRecord: "data/far-tier-hlod-20260818/sampling-results.json",
      v1SamplingRecordSha256: sha256HexSync(t002SamplingText),
      v1RecordsAreImmutable: "The T002 records are not edited by this task. This record supersedes none of them; it adds to them.",
      v1RatiosUsed: V1_RATIOS,
    },

    decomposition: {
      purpose: "Decide whether a facade-only shading term can move the failing pose at all, before designing one.",
      method: "Full geometry every time, with one surface class forced to a black CONDUCTOR so it occludes without contributing. Union mask taken from the full variant and reused for all three, so the means are comparable.",
      blackMaterialCorrection: "A black DIELECTRIC was tried first and was wrong. glTF gives every dielectric a fixed ~4% specular reflectance, so a zero base colour still returned 0.016708 of neutral grey over 3,131 pixels — larger than the wall contribution being measured. A conductor's F0 is its base colour, so black metal reflects nothing.",
      additivityCaveat: "W + R does not sum exactly to L_full; the residual runs -0.7% to -3.4% of L_full. The variants therefore slightly OVERSTATE each class in isolation, which is the conservative direction for a feasibility test that asks whether walls carry enough light.",
      rows: DECOMPOSITION.map((row) => ({ ...row, roofShare: round(row.R_roof / row.L_full, 6), wallShare: round(row.W_wall / row.L_full, 6) })),
      finding: "THE SHADOW POSE IS ALMOST ENTIRELY ROOF. Roof share is 0.9777 at 400 m, 0.99999 at 1,200 m and 0.99997 at 4,000 m, against a wall share of 0.034 at the barred distances. The lit pose inverts it: walls carry 0.80. The T002 tone miss is therefore a ROOF brightness problem and was never a facade problem.",
    },

    facadeOnlyNoGo: {
      rule: "A facade-only term is viable iff W_sh / W_lit >= 0.06797, pre-registered before the decomposition was rendered.",
      derivation: "The shadow pose must lose 0.000899 of absolute mean linear luminance to reach the bar; the lit pose may lose at most 0.013226 before breaching it; a wall-only scalar t moves them by W_sh*(1-t) and W_lit*(1-t), so feasibility is W_sh/W_lit >= 0.000899/0.013226.",
      measured: { W_sh: shadow.W_wall, W_lit: lit.W_wall, ratio: round(shadow.W_wall / lit.W_wall, 6) },
      threshold: 0.06797,
      verdict: "NO-GO — FACADE-ONLY IS NOT VIABLE, by a factor of about nine. Darkening walls enough to move the shadow pose would destroy the lit pose long before it arrived.",
      consequence: "The model form was selected by this measurement and by nothing else, which is why the measurement was taken first.",
    },

    derivedTerm: {
      form: "ROOF-ONLY linear-light scalar. Every roof zone's factor is multiplied by `roofScalar`; wall zones are untouched.",
      mechanismApproximated: "The prism replaces a building's roof with one flat plane and omits the rooftop groups standing on it — the T002 frame check measured 3.59 m of rooftop mass present in the source and absent from the prism. A flat lit plane returns more light than the roof it stands in for.",
      syntheticDeviationDeclaration: "THIS IS AN INVENTED APPEARANCE, NOT A MEASUREMENT. No occlusion is computed, no shadow is traced, and nothing in the derivation observes a real building. It approximates a named mechanism with a geometric proxy and must be declared as a synthetic deviation wherever a baked artifact carries it.",
      closedForm: "roofScalar = 1 - (sum of roof-occupying prism footprint areas) / (sum of tier-0 ring areas), area-weighted across the cell's plans, with water-tank legs excluded.",
      legExclusionAssumption: {
        assumption: "Water-tank legs are assumed to lie INSIDE the footprint of the tank they support, so counting them would charge the roof twice for one piece of hardware.",
        status: "ASSUMED FROM THE GRAMMAR'S INTENT, NOT ASSERTED BY THIS CODE. Containment is not checked per building; the derivation simply omits the `water-tank-leg` kind.",
        directionIfWrong: "If some legs in fact protrude beyond their tank, the true occupied fraction is LARGER than derived, so the term is understated and the predicted miss would be by a smaller margin than reported. The assumption therefore cannot manufacture a pass.",
      },
      inputsAreCommittedGeometryOnly: "Plan rings and prism rings from the committed V3 plans. Nothing reads a rendered image, a luminance ratio, a camera or a light.",
      arithmeticRestriction: "Only + - * / are used, so no engine-dependent transcendental enters a byte-producing path. Aggregation is over an explicitly sorted building order.",
      occupyingPrismKinds: ["roof-equipment", "water-tank"],
      buildingCount: term.buildingCount,
      occupiedFraction: round(term.occupiedFraction),
      roofScalar: round(term.roofScalar),
    },

    admissibleBand: {
      disclosedOnPurpose: "The band was computable from published T002 readings and the decomposition BEFORE the derivation was run. Disclosing it is what makes the prediction a real test: a reader can check the derived value was not steered toward the middle of the band.",
      requiredShadowReduction, permittedLitReduction,
      roofScalarMinimum: round(band.minimum),
      roofScalarMaximum: round(band.maximum),
      derivedRoofScalar: round(term.roofScalar),
      derivedValueInsideBand: term.roofScalar >= band.minimum && term.roofScalar <= band.maximum,
      crossInstrumentScaleDisclosure: {
        problem: "The two quantities in this band come from DIFFERENT MASKS. `requiredShadowReduction` and `permittedLitReduction` are derived from T002's sampling record, whose means are taken over the union of the SOURCE and BAKED silhouettes. The decomposition's `L_full` and `R_roof` are taken over the FULL VARIANT's own alpha mask. The two differ, so the numbers are not on the same scale.",
        measuredGap: {
          t002BakedMeanLuminanceShadowPose: 0.042303,
          decompositionFullLuminanceShadowPose: shadow.L_full,
          ratio: round(0.042303 / shadow.L_full, 6),
        },
        restatedInDecompositionUnits: {
          requiredShadowReduction: round(requiredShadowReduction * (shadow.L_full / 0.042303)),
          deliveredShadowReduction: round(shadow.R_roof * (1 - term.roofScalar)),
          deliveredShareOfRequired: round((shadow.R_roof * (1 - term.roofScalar)) / (requiredShadowReduction * (shadow.L_full / 0.042303)), 6),
          roofScalarMaximum: round(1 - (requiredShadowReduction * (shadow.L_full / 0.042303)) / shadow.R_roof),
        },
        effectOnTheVerdict: "NONE. Rescaling moves the shortfall from about 61% to about 65% of what is required and the band maximum from 0.977280 to about 0.978747. The derived scalar of 0.986167 sits above both, so it is outside the band either way and the predicted MISS stands. The mismatch is disclosed because it is real, not because it changes the answer.",
      },
      shortfall: {
        deliveredShadowReduction: round(shadow.R_roof * (1 - term.roofScalar)),
        requiredShadowReduction,
        deliveredShareOfRequired: round((shadow.R_roof * (1 - term.roofScalar)) / requiredShadowReduction, 6),
        unitsCaveat: "Both figures are in the mixed units described in `crossInstrumentScaleDisclosure`. The rescaled versions are there.",
      },
    },

    pointPredictions: {
      publishedBeforeCapture: true,
      predictionAgreementBar: "|measured - predicted| <= 0.01.",
      barScope: "THE BAR IS ONLY MEANINGFUL FOR A TILE THAT DIFFERS FROM v1 BY THE SHADING TERM ALONE. The formula holds r_v1 fixed and multiplies it by a per-pose gain, so it assumes the packing is unchanged. It is NOT a prediction about a tile that also carries the Stage A flat-face change: that repacks the atlas, moves texel counts on individual faces, and would break the assumption without announcing it.",
      packingInvarianceAssumption: "If a v2 capture is ever taken on a tile carrying BOTH the packing fix and a shading term, this bar must be re-derived rather than reused, or a packing-induced difference will be scored as a shading-model error.",
      formula: "r_v2(pose) = r_v1(pose) * (L_full(pose) - R_roof(pose) * (1 - roofScalar)) / L_full(pose)",
      predictions,
    },

    predictedVerdict: {
      toneBar: TONE_BAR,
      barredPoses: predictions.filter((entry) => entry.barred).length,
      predictedPasses: predictions.filter((entry) => entry.predictedVerdict === "PASS").length,
      predictedMisses: predictedMisses.length,
      verdict: predictedMisses.length > 0 ? "PREDICTED MISS" : "PREDICTED PASS",
      missingPoses: predictedMisses.map((entry) => ({ distanceMeters: entry.distanceMeters, azimuthDegrees: entry.azimuthDegrees, predicted: entry.predictedUnionMeanLuminanceRatioV2 })),
    },

    noGoInvoked: {
      rule: "Derived gain outside the admissible band -> predicted MISS, report, do NOT retune.",
      invoked: predictedMisses.length > 0,
      whatWasNotDone: [
        "The term was NOT enlarged to reach the bar. A constant chosen to clear a threshold is a fitted constant however it is dressed up.",
        "The model was NOT swapped for one that happens to predict a pass. Selecting a model by its predicted verdict is the same defect as selecting a constant by it.",
        "No v2 tile was baked and no v2 capture was taken. There is nothing to report a tone verdict against, and that is the correct state at a halt.",
      ],
      whyTheGeometricProxyFallsShort: "The derivation counts only the roof area rooftop groups OCCUPY. It does not count the roof they SHADOW, which at any sun elevation is the larger quantity. Extending it to shadowed area would require a sun elevation, and a sun elevation is a property of the instrument rather than of the artifact — baking it in would calibrate a shipped tile to a test rig, which is precisely the coupling this goal's non-claims already warn against.",
      forkForTheUser: [
        "ACCEPT A SMALLER IMPROVEMENT. Ship the derived term anyway: it moves the failing pose from 1.0728 to a predicted 1.0580, still a miss but a 20% reduction in the excess, and it improves every other pose slightly.",
        "CHANGE THE GEOMETRY, NOT THE SHADING. Give the far-tier prism the rooftop groups it omits, at a triangle cost that must be measured against the tier's own budget. This attacks the mechanism rather than approximating it.",
        "ACCEPT AN INSTRUMENT-COUPLED TERM, KNOWINGLY. Derive the shadowed area from a declared nominal sun elevation, accepting that the constant is then calibrated to a lighting assumption the shipped renderer does not share.",
        "RE-EXAMINE THE INSTRUMENT. The shadow pose is 99.99% roof and five times darker than the lit pose, which makes the union ratio ill-conditioned there. Whether that pose should carry a 0.05 bar at all is a question about the instrument, and it is the user's to answer.",
      ],
    },

    notClaimedHere: [
      "No v2 tile exists and no v2 appearance measurement exists.",
      "The predictions are arithmetic over a disclosed decomposition; they are not a rendered result and could be wrong.",
      "The decomposition was measured in EEVEE under one sun. It is not a claim about the shipped Cesium renderer.",
      "One cell was decomposed. Nothing here generalizes to the island.",
    ],
  };

  await mkdir(evidenceRoot, { recursive: true });
  const text = serialize(record);
  await writeFile(join(evidenceRoot, "stage-b-decomposition-and-prediction.json"), text);
  await writeFile(join(evidenceRoot, "stage-b-decomposition-and-prediction.sha256"), `${sha256HexSync(text)}  stage-b-decomposition-and-prediction.json\n`);
  console.log(serialize({
    ok: true, checksum: sha256HexSync(text),
    roofScalar: round(term.roofScalar), band: { min: round(band.minimum), max: round(band.maximum) },
    insideBand: record.admissibleBand.derivedValueInsideBand,
    verdict: record.predictedVerdict.verdict,
    missing: record.predictedVerdict.missingPoses,
  }));
}

const command = process.argv[2];
const cellIndex = process.argv.indexOf("--cell");
const cellId = cellIndex > 0 ? process.argv[cellIndex + 1] : DEFAULT_CELL_ID;
if (command === "predict") await commandPredict(cellId);
else fail("usage: far-tier-v2-shading-cli.mjs predict [--cell <cellId>]");
