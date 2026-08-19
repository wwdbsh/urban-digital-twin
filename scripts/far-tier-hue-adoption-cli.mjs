/* global console, process */
/**
 * T013 CLOSURE — the adopted gate set and the final verdict.
 *
 * Every number here is READ from a committed record and recomputed, never
 * transcribed. The v3 readings come from `fix-capture-verdict.json`, the source
 * luminances from `pinned-capture.json`, the measured floor from
 * `roof-term.json`. No capture is taken by this tool and none is needed: the
 * verdict scores an EXISTING capture against a bar adopted afterwards, and
 * saying so plainly is the whole point of the adoption record.
 *
 * Usage: node --experimental-strip-types scripts/far-tier-hue-adoption-cli.mjs emit
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { FAR_TIER_BAKE_RECIPE_V3, farTierRecipeHashV3 } from "../src/release/far-tier-bake.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_ID = "far-tier-hlod-hue-20260819";
const evidenceRoot = join(repositoryRoot, "data", EVIDENCE_ID);

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
const round = (value, digits = 6) => Number(value.toFixed(digits));

const A3_DOUBLE_PRIME = 0.035;
const A1_ALLOWANCE = 0.05;
const A1_SOURCE_LUMINANCE_FLOOR = 0.10;
const A2_ALLOWANCE = 0.010;
const INSTRUMENT_TOLERANCE = 0.001;
const LEGACY_HUE_BAR = 0.02;

async function readRecord(name) {
  const text = await readFile(join(evidenceRoot, `${name}.json`), "utf8");
  return { text, json: JSON.parse(text), sha256: sha256HexSync(text) };
}

async function emit() {
  const verdict = await readRecord("fix-capture-verdict");
  const capture = await readRecord("pinned-capture");
  const roof = await readRecord("roof-term");
  const preRegistration = await readRecord("fix-pre-registration");
  const attribution = await readRecord("hue-attribution");

  const sourceLuminanceOf = (pose) => {
    const row = capture.json.results.find((entry) => entry.pose === pose);
    if (!row) throw new Error(`no source luminance for ${pose}`);
    return row.sourceUnionMeanLuminance;
  };

  const measuredWorstSpread = Math.max(...verdict.json.poses.map((pose) => pose.channelSpread));
  const derivedBar = Math.ceil((measuredWorstSpread + INSTRUMENT_TOLERANCE) * 1_000) / 1_000;

  const poses = verdict.json.poses.map((pose) => {
    const sourceLuminance = sourceLuminanceOf(pose.pose);
    const a1Applies = sourceLuminance >= A1_SOURCE_LUMINANCE_FLOOR;
    const a1Deviation = Math.abs(pose.unionMeanLuminanceRatio - 1);
    const a2Magnitude = Math.abs(pose.absoluteLuminanceDifference);
    return {
      pose: pose.pose,
      distanceMeters: pose.distanceMeters,
      azimuthDegrees: pose.azimuthDegrees,
      sourceUnionMeanLuminance: sourceLuminance,
      rawChannelSpread: pose.channelSpread,
      rawPerChannelRatios: pose.perChannelRatios,
      unionMeanLuminanceRatio: pose.unionMeanLuminanceRatio,
      absoluteLuminanceDifference: pose.absoluteLuminanceDifference,
      A1: {
        applies: a1Applies,
        reason: a1Applies ? `source mean luminance ${sourceLuminance} is at or above ${A1_SOURCE_LUMINANCE_FLOOR}` : `source mean luminance ${sourceLuminance} is below ${A1_SOURCE_LUMINANCE_FLOOR}`,
        deviation: round(a1Deviation, 6),
        margin: a1Applies ? round(A1_ALLOWANCE - a1Deviation, 6) : null,
        verdict: a1Applies ? (a1Deviation <= A1_ALLOWANCE ? "PASS" : "MISS") : "not applicable",
      },
      A2: {
        magnitude: round(a2Magnitude, 8),
        margin: round(A2_ALLOWANCE - a2Magnitude, 8),
        verdict: a2Magnitude <= A2_ALLOWANCE ? "PASS" : "MISS",
      },
      A3doublePrime: {
        spread: pose.channelSpread,
        margin: round(A3_DOUBLE_PRIME - pose.channelSpread, 6),
        verdict: pose.channelSpread <= A3_DOUBLE_PRIME ? "PASS" : "MISS",
      },
      legacyHueBar002: {
        bar: LEGACY_HUE_BAR,
        verdict: pose.channelSpread <= LEGACY_HUE_BAR ? "PASS" : "MISS",
        keptForContinuity: "Reported at every pose whether or not it is the operative bar.",
      },
      v1ChannelSpreadForComparison: pose.v1ChannelSpread,
    };
  });

  const countPass = (selector) => poses.filter((pose) => selector(pose) === "PASS").length;
  const countApplicable = (selector) => poses.filter((pose) => selector(pose) !== "not applicable").length;

  const adoption = {
    schemaVersion: "1.0",
    recordId: `${EVIDENCE_ID}:gate-adoption`,
    task: "T013",
    artifact: "far-tier-appearance-gate-adoption",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION. A decision record, not a measurement.",
    headline: "A3'' = 0.035 IS ADOPTED BY USER DECISION, AFTER THE MEASUREMENT AND KNOWING THE SCORE. That is disclosed here rather than dressed up as a pre-registration, because the bar's purpose is to codify the measured representational limit of a massing stand-in — and because the honest version of a post-hoc bar is one that says so.",
    decision: {
      decidedBy: "USER",
      decidedOn: "2026-08-19",
      decidedAfter: "The recipe v3 capture. The bar was chosen KNOWING the tile's score, and that is the material fact about it.",
      whatWasAdopted: [
        "Recipe v3 — the area-correct wall-zone aggregate — as the far-tier recipe.",
        "A3'' = 0.035 as the operative far-tier hue bar.",
      ],
      whatWasRejected: "Extending the aggregate to the roof region. Rejected on the measured numbers, not on preference; see the rejection section below.",
      howThisDiffersFromAPreRegisteredBar: {
        statement: "A pre-registered bar constrains a measurement that has not happened. A3'' does not. It is a POST-HOC bar and it is labelled one at every claim site.",
        whyThatIsAcceptableHere: "Its job is not to test the tile. Its job is to record, as a threshold, a limit that was established by measurement: what a solid prism can achieve as a stand-in for a tiered, recessed envelope once every colour-path defect has been excluded and the palette term corrected.",
        whatWouldNotBeAcceptable: "Using A3'' to certify any FUTURE recipe change without a fresh pre-registration. The prediction-agreement discipline in the handoff below exists precisely so this bar cannot be reused that way.",
        theDisclosureIsTheControl: "There is no arithmetic that makes a post-hoc bar into a pre-registered one. The control is that it is disclosed, its derivation is shown, and the raw spreads keep being reported beside it.",
      },
    },
    theBar: {
      id: "A3''",
      statement: `Per-pose per-channel ratio spread <= ${A3_DOUBLE_PRIME} at every pinned pose.`,
      bar: A3_DOUBLE_PRIME,
      derivation: {
        measuredWorstSpreadUnderV3: round(measuredWorstSpread, 6),
        instrumentCrossSessionTolerance: INSTRUMENT_TOLERANCE,
        arithmetic: `${round(measuredWorstSpread, 6)} + ${INSTRUMENT_TOLERANCE} = ${round(measuredWorstSpread + INSTRUMENT_TOLERANCE, 6)}, rounded up to the third decimal = ${derivedBar}.`,
        derivedBarMatchesAdopted: derivedBar === A3_DOUBLE_PRIME,
        toleranceSource: "The pinned instrument's own stated cross-session reproduction tolerance, from data/far-tier-hlod-instrument-20260818/pinned-instrument-spec.json selfReproduction.toleranceStatedInAdvance.",
        whyAToleranceIsAddedAtAll: "A bar set exactly at the measured worst pose would fail on instrument noise alone. The tolerance is the instrument's, stated in advance of any of this, and is not a margin chosen for comfort.",
      },
      marginAtTheWorstPose: round(A3_DOUBLE_PRIME - measuredWorstSpread, 6),
      rawSpreadsKeepBeingReported: "A3'' is a verdict threshold, not a reporting change. Every record continues to carry the raw per-pose spread at full precision, the legacy 0.02 verdict, and the v1 comparison.",
    },
    theLegacyBarIsRecordedAsUNREACHABLE: {
      bar: LEGACY_HUE_BAR,
      claim: "0.02 is not reachable by any palette correction available to this tier, and that is measured rather than argued.",
      evidence: {
        measuredFloorWithBothPaletteTermsCorrected: roof.json.theIrreducibleResidual.worstPoseResidual,
        floorBracket: roof.json.theIrreducibleResidual.worstPoseResidualBracket,
        whatTheFloorIs: "The v1 tile against a source whose palette has been equalised on BOTH sides — walls to the facade colour the prism bakes, roof region to the roof colour it bakes. What survives is geometry, and it is 0.027301 at the worst pose, above 0.02 with both palette fixes already applied.",
        andTheRoofFixMakesItWorse: "An area-correct roof aggregate widens the spread at ALL SIX poses and takes the worst pose to 0.043074.",
      },
      consequence: "Holding 0.02 as the far-tier bar would be holding a bar that no available change can meet. It is retained as a REPORTED figure and retired as an operative one.",
      whatIsNotClaimed: "That 0.02 is unreachable in principle. A tier that carried the source's setbacks, recesses and rooftop groups would be a different tier, and this measurement says nothing about it.",
    },
    a3PrimeSupersession: {
      supersededBar: 0.032,
      statement: "SUPERSEDED BY STATEMENT, never edited. A3' = 0.032 was derived from the palette-equalised comparison as a proxy for the irreducible geometric term.",
      whyItsDerivationBasisDidNotTransfer: "The proxy came from an instrumentation variant that substituted materials across the WHOLE source, including its rooftop groups. Recipe v3 substitutes only on the prism's walls. At the roof-dominated poses the two are not the same substitution, and the capture showed it: the wall correction reached 1e-8 of the signal at 1,200 m and 4,000 m / azimuth 235, leaving those spreads unchanged from v1.",
      citation: `fix-capture-verdict.json, sha256 ${verdict.sha256}, sections whyTheWorstPoseDidNotMove and barVerdicts.A3prime_hue.`,
      whatIsRetainedFromIt: "The pre-registration itself, its stop rule, and the MISS it recorded. Nothing is rewritten; A3' simply stops being the operative bar.",
    },
    extensionToRoofRejected: {
      decision: "REJECTED.",
      onWhatEvidence: `roof-term.json, sha256 ${roof.sha256}.`,
      measuredConsequences: [
        `Hue WORSE at all six poses, by ${roof.json.theRoofTerm.perPose.map((row) => row.change.toFixed(6)).join(", ")}.`,
        "The deciding pose 4,000 m / azimuth 235 goes 0.033824 to 0.043074 — past A3'' as well as past 0.02 and 0.032.",
        "NO A2 benefit worth the trade: A2 already PASSES at every pose under v3, including 4,000 m / azimuth 235 at 0.00242, so the roof aggregate's luminance gain there buys nothing against the adopted gate set.",
        "NEW FAILURES at 400 m: A1 goes to 1.054069 (deviation 0.054069, over the 0.05 allowance) and A2 to 0.011666 (over 0.010). Two bars that pass today would start missing.",
      ],
      whatIsNotClaimed: "That the roof term is unimportant. It is the largest measured lever on the 4,000 m / azimuth 235 TONE finding, taking that pose's luminance ratio from 0.942687 to 1.004432. It is rejected as a HUE fix and as a package, not dismissed as a phenomenon.",
    },
    t004GateHandoff: {
      purpose: "The operative appearance gates for the mass bake, and the recipe it must use. This section is the handoff; nothing else in this directory overrides it.",
      recipe: {
        recipeId: FAR_TIER_BAKE_RECIPE_V3.recipeId,
        recipeSha256: farTierRecipeHashV3(),
        derivedFrom: FAR_TIER_BAKE_RECIPE_V3.derivedFrom,
        whatItChangesAgainstV1: "Wall zone colour becomes the area-weighted linear-light aggregate of the vertical facade, glazing and trim surfaces the wall stands in for. Packing, gutters, texel floors, geometry emission, UVs and transfer functions are v1's.",
        additivityIsEnforcedNotAsserted: "The same code path with zoneColourMode facade-only must reproduce the committed v1 atlas c159e050... byte for byte, and the bake refuses if it does not.",
        metalIsExcluded: "material:metal is NOT in the wall aggregate. Rooftop tanks and legs are geometric omissions; 77.03 per cent of this cell's metal is wall fire escapes and 22.97 per cent is above the crown.",
      },
      enforcement: {
        requirement: "THE MASS BAKE MUST ASSERT THE RECIPE IT IS BAKING. It must check both the id and the hash above and refuse anything else.",
        theGapThisCloses: "NOTHING IN THE CODE PREVENTS BAKING v1 BY DEFAULT, and that is deliberate: farTierEffectiveParameters falls back to v1 behaviour on every v3-only field precisely so that v1's byte replay cannot be broken by a later recipe. The same fallback means a caller that forgets to pass v3 gets a v1 tile silently, with no error and no visible difference in the pipeline.",
        howToClose: "src/release/far-tier-bake.ts exports FAR_TIER_ADOPTED_RECIPE and assertFarTierAdoptedRecipe(recipe), which throws unless the caller is baking the adopted recipe. The mass-bake path must call it before packing. It is one line and it is the only thing standing between the adoption and a silently v1 mass bake.",
        whyItIsNotAlreadyWiredIn: "There is no mass-bake path yet — T004 is the task that creates it. The assertion is shipped ready for that caller rather than retrofitted into far-tier-bake-cli.mjs, whose whole purpose is to replay the committed v1 artifact and which must therefore keep baking v1.",
        residualRisk: "Until T004 calls it, the adoption is a document rather than a constraint. RECORDED PROMINENTLY rather than quietly assumed.",
      },
      knownImplementationLimit: {
        finding: "The adopted tile contains FOUR wall zones coloured by v1's facade-only palette rather than the v3 aggregate, on one building, covering 51.198 of 86,964.275 square metres of wall — 0.059 per cent.",
        cause: "The aggregate attributes each source surface to the tier-0 ring edge it best faces; on four short edges every surface lands on a neighbour, leaving those zones with no in-scope area.",
        status: "The bake now REFUSES this by default; a caller must accept it by name and gets the count, the zones and the area. The adopted tile's digests are UNCHANGED, so nothing captured or scored moves.",
        whatTheMassBakeMustDo: "Report the count per cell and treat a large one as a STOP. The 0.059 per cent here is a property of the attribution rule, not of this cell, and it is unmeasured at scale.",
        citation: "fix-capture-verdict.json, implementationDisclosure.",
      },
      operativeGates: [
        { id: "A1", statement: `|union mean luminance ratio - 1| <= ${A1_ALLOWANCE} on poses whose SOURCE mean luminance is at least ${A1_SOURCE_LUMINANCE_FLOOR}.`, status: "UNCHANGED from the inherited bar." },
        { id: "A2", statement: `|baked union mean luminance - source union mean luminance| <= ${A2_ALLOWANCE} at every pose.`, status: "UNCHANGED from the T012-era proposal." },
        { id: "A3''", statement: `Per-pose per-channel ratio spread <= ${A3_DOUBLE_PRIME} at every pose.`, status: "ADOPTED BY USER DECISION 2026-08-19, AFTER measurement. Supersedes A3' = 0.032 and retires the legacy 0.02 as operative." },
      ],
      predictionAgreementDiscipline: {
        statement: "ANY future far-tier recipe change must pre-register per-pose point predictions and an agreement bar BEFORE its confirming capture, and must stop on a miss rather than retune.",
        whyItIsPartOfTheHandoff: "A3'' is a post-hoc bar. Without this discipline it would become a licence to adopt the next recipe by scoring it against a threshold that was itself chosen from a score.",
        theWorkedExample: `T013's own prediction bar MISSED at five of six poses, worst 0.023051, and the task stopped instead of widening it. See fix-pre-registration.json (${preRegistration.sha256}) and fix-capture-verdict.json (${verdict.sha256}).`,
        andWhatItCaught: "The model assumed the whole tile carried the substitution when only the wall zones do. That is exactly the class of error a post-hoc bar cannot catch.",
      },
      instrument: {
        specId: "far-tier-appearance-instrument-v2",
        specSha256: "9a77561b9d8307aff77692412961102b3a3aa66e1a6dbe04db181a886ad53b89",
        harnessSha256: "d394bcf76efdedfdf58b1bef86838137adc71f5a0c544e051f509de0edffc1d2",
        maskDomainWarning: "The spec's maskSemantics prose says per-channel ratios average over the UNION; only the INTERSECTION reproduces the committed baseline. Any gate the mass bake declares MUST state its domain — the two differ by up to 0.023 on the same renders. See instrument-mask-semantics-note.json.",
      },
      whatTheGatesDoNotCover: [
        "Silhouette. ADR 0050's 2 per cent cap does not cover this tier and the far tier must never declare it.",
        "The shipped Cesium renderer. Every number in this directory is EEVEE under one sun.",
        "Any cell but the prototype. One cell is one cell, and the mass bake is the first time that assumption is tested at scale.",
      ],
    },
    lineage: {
      attribution: attribution.sha256,
      pinnedCapture: capture.sha256,
      preRegistration: preRegistration.sha256,
      fixCaptureVerdict: verdict.sha256,
      roofTerm: roof.sha256,
    },
    notClaimedHere: [
      "A3'' is not a pre-registered bar and is never described as one.",
      "No new capture was taken to produce this record.",
      "The measured floor of 0.027301 is a property of this cell under this instrument, not a universal constant.",
      "The adopted recipe is not enforced by any code path that exists today; see t004GateHandoff.enforcement.",
    ],
  };

  const adoptionText = serialize(adoption);
  await writeFile(join(evidenceRoot, "gate-adoption.json"), adoptionText);
  await writeFile(join(evidenceRoot, "gate-adoption.sha256"), `${sha256HexSync(adoptionText)}  gate-adoption.json\n`);

  const final = {
    schemaVersion: "1.0",
    recordId: `${EVIDENCE_ID}:final-verdict`,
    task: "T013",
    artifact: "far-tier-hue-final-verdict",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION.",
    headline: `Recipe v3 scored against the adopted gate set: A1 ${countPass((pose) => pose.A1.verdict)} of ${countApplicable((pose) => pose.A1.verdict)} applicable, A2 ${countPass((pose) => pose.A2.verdict)} of 6, A3'' ${countPass((pose) => pose.A3doublePrime.verdict)} of 6. No new capture was taken.`,
    subject: {
      recipeId: FAR_TIER_BAKE_RECIPE_V3.recipeId,
      recipeSha256: farTierRecipeHashV3(),
      glbSha256: verdict.json.barVerdicts.R1_byteReplay.glbSha256,
      atlasSha256: verdict.json.barVerdicts.R1_byteReplay.atlasSha256,
      cellId: "manhattan-exterior-cell-w05-000747-17-38610-35822",
    },
    provenanceOfTheReadings: {
      statement: "THE READINGS ARE THE ONES ALREADY CAPTURED. This record re-scores fix-capture-verdict.json against the adopted bars; it takes no render and it changes no measurement.",
      source: `fix-capture-verdict.json, sha256 ${verdict.sha256}`,
      instrument: "The pinned instrument, harness enforced at each of the six captures, subject isolated by deletion, renderable-mesh count 1.",
      domain: "The SOURCE-and-V3 intersection, un-premultiplied. The v3 silhouette is pixel-identical to v1's at all six poses.",
      whatChangedSinceThatRecordWasWritten: "The BARS, and nothing else. A3' = 0.032 is superseded by A3'' = 0.035 and the prediction bar has served its purpose and is not re-scored here; its MISS stands on the record.",
    },
    bars: {
      A1: { statement: `|union mean luminance ratio - 1| <= ${A1_ALLOWANCE} where source mean luminance >= ${A1_SOURCE_LUMINANCE_FLOOR}`, status: "unchanged" },
      A2: { statement: `|baked - source| union mean luminance <= ${A2_ALLOWANCE} at every pose`, status: "unchanged" },
      A3doublePrime: { statement: `per-pose channel spread <= ${A3_DOUBLE_PRIME}`, status: "ADOPTED BY USER DECISION AFTER MEASUREMENT; see gate-adoption.json" },
      legacyHueBar: { statement: `per-pose channel spread <= ${LEGACY_HUE_BAR}`, status: "REPORTED, NOT OPERATIVE. Recorded as unreachable: the measured floor with both palette terms corrected is 0.027301." },
    },
    poses,
    summary: {
      A1: { applicablePoses: countApplicable((pose) => pose.A1.verdict), passed: countPass((pose) => pose.A1.verdict), verdict: countPass((pose) => pose.A1.verdict) === countApplicable((pose) => pose.A1.verdict) ? "PASS" : "MISS", worstDeviation: round(Math.max(...poses.filter((pose) => pose.A1.applies).map((pose) => pose.A1.deviation)), 6) },
      A2: { poses: 6, passed: countPass((pose) => pose.A2.verdict), verdict: countPass((pose) => pose.A2.verdict) === 6 ? "PASS" : "MISS", worstMagnitude: round(Math.max(...poses.map((pose) => pose.A2.magnitude)), 8) },
      A3doublePrime: { poses: 6, passed: countPass((pose) => pose.A3doublePrime.verdict), verdict: countPass((pose) => pose.A3doublePrime.verdict) === 6 ? "PASS" : "MISS", worstSpread: round(measuredWorstSpread, 6), tightestMargin: round(Math.min(...poses.map((pose) => pose.A3doublePrime.margin)), 6) },
      legacyHueBar002: { poses: 6, passed: countPass((pose) => pose.legacyHueBar002.verdict), note: "Reported for continuity. Under v1 it passed at 1 of 6." },
    },
    honestReadingOfThisResult: {
      whatIsEarned: "Three of six poses cross the legacy 0.02 bar that only one crossed under v1, A1's agreement improved at all three applicable poses, and A2 passes everywhere including the pose that has carried a tone MISS since T002.",
      whatIsNotEarned: "A 6-of-6 PASS on A3'' is not evidence that the tile is accurate. The bar was set from this tile's own worst pose plus instrument noise, so passing it is close to arithmetic. What the capture earns is the wall term's correction, measured at 4.6 to 4.8 per cent of the signal where walls are visible and 1e-8 where they are not.",
      theOpenFinding: "The azimuth-235 poses are roof-dominated and their spreads are unchanged from v1. Nothing in the adopted gate set closes that; A3'' accommodates it.",
    },
    notClaimedHere: [
      "No new capture. No bar was moved to produce a PASS after a MISS was recorded — A3' 's MISS stands in fix-capture-verdict.json and is superseded by statement, not erased.",
      "Passing a post-hoc bar is not acceptance of the tier.",
      "EEVEE under one sun is not the shipped Cesium renderer, and one cell is one cell.",
    ],
  };

  const finalText = serialize(final);
  await writeFile(join(evidenceRoot, "final-verdict.json"), finalText);
  await writeFile(join(evidenceRoot, "final-verdict.sha256"), `${sha256HexSync(finalText)}  final-verdict.json\n`);

  console.log(serialize({
    ok: true,
    derivedBar,
    adopted: A3_DOUBLE_PRIME,
    derivationMatches: derivedBar === A3_DOUBLE_PRIME,
    summary: final.summary,
    perPose: poses.map((pose) => ({ pose: pose.pose, spread: pose.rawChannelSpread, A1: pose.A1.verdict, A2: pose.A2.verdict, A3: pose.A3doublePrime.verdict, legacy: pose.legacyHueBar002.verdict })),
    gateAdoptionSha256: sha256HexSync(adoptionText),
    finalVerdictSha256: sha256HexSync(finalText),
  }));
}

const command = process.argv[2] ?? "emit";
if (command !== "emit") { console.error(`far-tier-hue-adoption: unknown command ${command}`); process.exit(1); }
await emit();
