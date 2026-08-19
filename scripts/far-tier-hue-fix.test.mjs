/**
 * Recipe v3 must be ADDITIVE. These tests attack that claim from both ends: the
 * recipe object itself, and the artifact the same code path produces when told
 * to behave like v1.
 *
 * The failure they exist to catch is the quiet one. A "colour-only" change that
 * also moves a texel floor, a gutter width or a packing order would produce a
 * capture comparison that measures a rebuild while calling itself a measurement
 * of the colour.
 */
import { readFileSync } from "node:fs";
import { sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  FAR_TIER_ADOPTED_RECIPE,
  FAR_TIER_BAKE_RECIPE,
  FAR_TIER_BAKE_RECIPE_V2,
  FAR_TIER_BAKE_RECIPE_V3,
  FAR_TIER_BAKE_RECIPE_V4,
  assertFarTierAdoptedRecipe,
  farTierEffectiveParameters,
  farTierRecipeHash,
  farTierRecipeHashV3,
  farTierRecipeHashV4,
} from "../src/release/far-tier-bake.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const preRegistration = JSON.parse(readFileSync(join(repositoryRoot, "data/far-tier-hlod-hue-20260819/fix-pre-registration.json"), "utf8"));
const provenance = JSON.parse(readFileSync(join(repositoryRoot, "data/far-tier-hlod-20260818/prototype-provenance.json"), "utf8"));

describe("v3 is additive over v1", () => {
  it("leaves the v1 recipe object and its hash untouched", () => {
    // The committed v1 artifact's provenance names this hash. If v3's presence
    // in the same module moved it, every v1 replay claim in the ledger breaks.
    const declared = JSON.stringify(provenance);
    expect(declared).toContain(farTierRecipeHash());
    expect(FAR_TIER_BAKE_RECIPE.recipeId).toBe("far-tier-hlod-bake-v1");
    expect(FAR_TIER_BAKE_RECIPE).not.toHaveProperty("zoneColour");
  });

  it("carries every v1 field forward unchanged, and changes only its identity and its colour rule", () => {
    const changed = [];
    for (const [key, value] of Object.entries(FAR_TIER_BAKE_RECIPE)) {
      if (JSON.stringify(FAR_TIER_BAKE_RECIPE_V3[key]) !== JSON.stringify(value)) changed.push(key);
    }
    expect(changed).toEqual(["recipeId"]);
    const added = Object.keys(FAR_TIER_BAKE_RECIPE_V3).filter((key) => !(key in FAR_TIER_BAKE_RECIPE));
    expect(added.sort()).toEqual([
      "derivedFrom",
      "supersedes",
      "zoneAggregationAttribution",
      "zoneAggregationCarrier",
      "zoneAggregationExcludesRoles",
      "zoneAggregationIncludesRoles",
      "zoneAggregationSpace",
      "zoneAggregationSurfaceFilter",
      "zoneColour",
    ]);
  });

  it("derives from v1's packing and not from v2's", () => {
    expect(FAR_TIER_BAKE_RECIPE_V3.derivedFrom).toBe("far-tier-hlod-bake-v1");
    expect(FAR_TIER_BAKE_RECIPE_V3.flatFaceTexels).toBeUndefined();
    expect(FAR_TIER_BAKE_RECIPE_V3.gutterTexels).toBe(FAR_TIER_BAKE_RECIPE.gutterTexels);
    expect(FAR_TIER_BAKE_RECIPE_V3.faceTexelFloor).toBe(FAR_TIER_BAKE_RECIPE.faceTexelFloor);
  });

  it("keeps the guarded shading path closed", () => {
    expect(farTierEffectiveParameters(FAR_TIER_BAKE_RECIPE_V3).shadingScalar).toBe(1);
    expect(FAR_TIER_BAKE_RECIPE_V3).not.toHaveProperty("shading");
  });

  it("cannot be entered by omission", () => {
    expect(farTierEffectiveParameters().zoneColourMode).toBe("facade-only");
    expect(farTierEffectiveParameters(FAR_TIER_BAKE_RECIPE).zoneColourMode).toBe("facade-only");
    expect(farTierEffectiveParameters({ ...FAR_TIER_BAKE_RECIPE, recipeId: "anything" }).zoneColourMode).toBe("facade-only");
    expect(farTierEffectiveParameters(FAR_TIER_BAKE_RECIPE_V3).zoneColourMode).toBe("area-correct-aggregate");
  });

  it("excludes metal, roofs and the ground ring from the aggregate, by declaration", () => {
    expect([...FAR_TIER_BAKE_RECIPE_V3.zoneAggregationIncludesRoles]).toEqual(["facade", "glazing", "trim"]);
    expect([...FAR_TIER_BAKE_RECIPE_V3.zoneAggregationExcludesRoles]).toEqual(["metal", "roof", "ground"]);
  });
});

describe("the v3 bake proved its own additivity on the real cell", () => {
  const change = preRegistration.theChange;

  it("reproduced the committed v1 atlas through the same code path", () => {
    expect(change.additiveRegressionGate.verdict).toBe("PASS");
    expect(change.additiveRegressionGate.v1AtlasSha256).toBe(provenance.tile.atlasSha256);
  });

  it("changed no packing outcome", () => {
    for (const [key, value] of Object.entries(change.whatDidNotChange)) {
      expect(value, `packing changed: ${key}`).toBe(true);
    }
  });

  it("attributed every in-scope square metre", () => {
    expect(change.aggregation.attributionCompleteness).toBe(1);
    expect(change.aggregation.attributedAreaSquareMeters).toBe(change.aggregation.inScopeAreaSquareMeters);
    expect(change.aggregation.buildingsAggregated).toBe(48);
  });

  it("snapped only floating-point noise to the profile ceiling, and refuses anything larger", () => {
    const snaps = change.aggregation.unitySnaps;
    // One unit in the last place of a double near 1. Anything a human could
    // notice would have raised FarTierAggregateOutOfRangeError instead.
    expect(snaps.worstOvershoot).toBeLessThanOrEqual(2.220446049250313e-16);
    expect(snaps.count).toBeGreaterThan(0);
  });

  it("moved the wall colour in the direction the attribution measured", () => {
    const wall = change.wallAlbedo;
    // Absorbing glazing and trim BACK IN darkens the wall (both are darker than
    // facade) and reddens it (trim is the reddest entry in the palette).
    for (const shift of wall.perChannelShift) expect(shift).toBeLessThan(1);
    expect(wall.redOverBlueV3).toBeGreaterThan(wall.redOverBlueV1);
  });

  it("carries a recipe hash that is v3's and not v1's", () => {
    expect(change.recipeSha256).toBe(farTierRecipeHashV3());
    expect(change.v1RecipeSha256).toBe(farTierRecipeHash());
    expect(farTierRecipeHashV3()).not.toBe(farTierRecipeHash());
  });
});

describe("the pre-registration is a pre-registration", () => {
  it("has no capture timestamp and says why", () => {
    expect(preRegistration.capturedAt).toBeNull();
    expect(preRegistration.capturedAtStatement).toContain("NOTHING HAS BEEN CAPTURED");
  });

  it("derives A3' from the palette-equalised measurement plus the instrument tolerance", () => {
    const bar = preRegistration.bars.A3prime;
    const worstPredicted = Math.max(...preRegistration.poses.map((pose) => pose.predictedV3ChannelSpread));
    expect(bar.bar).toBe(Number((Math.ceil(worstPredicted * 1_000) / 1_000 + 0.001).toFixed(3)));
    expect(bar.whatItIsNotDerivedFrom).toContain("NOT from what the v3 tile scores");
    expect(bar.rawSpreadsKeepBeingReported).toContain("not a reporting change");
  });

  it("predicts the azimuth-235 outcome it will be judged on, including the misses", () => {
    const verdicts = preRegistration.bars.A3prime.legacyBarVerdictPredicted;
    const at235 = verdicts.filter((row) => row.pose.endsWith("/235"));
    const at55 = verdicts.filter((row) => row.pose.endsWith("/55"));
    expect(at235.every((row) => row.legacyBar002 === "MISS")).toBe(true);
    expect(at55.every((row) => row.legacyBar002 === "PASS")).toBe(true);
    expect(verdicts.every((row) => row.a3PrimeVerdict === "PASS")).toBe(true);
  });

  it("declares the A1 and A2 regressions in advance instead of discovering them after", () => {
    const a1 = preRegistration.bars.A1;
    const a2 = preRegistration.bars.A2;
    expect(a1.thePredictedRegressionIsDeclaredHereRatherThanDiscoveredLater).toContain("WORSE AT TWO OF ITS THREE POSES");
    // The declaration must match the numbers beside it.
    const worsened = a1.predicted.filter((row) => row.predictedDeviationChange > 0);
    expect(worsened).toHaveLength(2);
    expect(a1.predicted.every((row) => row.predictedVerdict === "PASS")).toBe(true);
    expect(a2.predicted.every((row) => row.predictedVerdict === "PASS")).toBe(true);
    expect(a2.thePredictedRegressionIsDeclaredHereToo).toContain("0.0027");
  });

  it("states a stop rule with no room to retune", () => {
    expect(preRegistration.stopRule).toContain("stops the task");
    expect(preRegistration.stopRule).toContain("No bar may be retuned");
  });

  it("binds itself to the records its predictions came from, by checksum", () => {
    expect(preRegistration.predictionModel.sourceRecord).toContain("pinned-capture.json");
    expect(preRegistration.predictionModel.sourceRecord).toMatch(/[0-9a-f]{64}/u);
    expect(preRegistration.predictionModel.knownImperfections.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// The verdict, tested against the bars as they were pre-registered.
//
// The failure mode this guards is the one that matters after a MISS: a bar
// quietly widened, a pose quietly dropped, or a verdict recomputed against
// something other than the number committed before the capture.
// ---------------------------------------------------------------------------

const verdict = JSON.parse(readFileSync(join(repositoryRoot, "data/far-tier-hlod-hue-20260819/fix-capture-verdict.json"), "utf8"));

describe("the verdict is judged against the pre-registered bars", () => {
  it("binds to the pre-registration by checksum and to the same recipe", () => {
    const preText = readFileSync(join(repositoryRoot, "data/far-tier-hlod-hue-20260819/fix-pre-registration.json"), "utf8");
    expect(verdict.boundTo.preRegistrationSha256).toBe(sha256HexSync(preText));
    expect(verdict.boundTo.recipeSha256MatchesPreRegistration).toBe(true);
    expect(verdict.boundTo.recipeSha256).toBe(farTierRecipeHashV3());
  });

  it("uses the bar values the pre-registration fixed, not new ones", () => {
    expect(verdict.barVerdicts.A3prime_hue.bar).toBe(preRegistration.bars.A3prime.bar);
    expect(verdict.barVerdicts.P1_predictionAgreement.allowance).toBe(preRegistration.bars.predictionAgreement.allowance);
  });

  it("keeps all six poses", () => {
    expect(verdict.poses).toHaveLength(6);
    expect(verdict.poses.map((pose) => pose.pose).sort()).toEqual(preRegistration.poses.map((pose) => pose.pose).sort());
  });

  it("recomputes every per-pose verdict from the channel means beside it", () => {
    for (const pose of verdict.poses) {
      const ratios = pose.v3ChannelMeans.map((value, index) => value / pose.sourceChannelMeans[index]);
      expect(pose.channelSpread).toBeCloseTo(Math.max(...ratios) - Math.min(...ratios), 6);
      expect(pose.A3primeVerdict).toBe(pose.channelSpread <= preRegistration.bars.A3prime.bar ? "PASS" : "MISS");
      expect(pose.A2Verdict).toBe(Math.abs(pose.absoluteLuminanceDifference) <= 0.01 ? "PASS" : "MISS");
    }
  });

  it("reports the two misses rather than a summary that hides them", () => {
    expect(verdict.barVerdicts.A3prime_hue.verdict).toBe("MISS");
    expect(verdict.barVerdicts.P1_predictionAgreement.verdict).toBe("MISS");
    expect(verdict.barVerdicts.A3prime_hue.missedPoses).toEqual(["4000/235"]);
    expect(verdict.barVerdicts.A1_relativeLuminance.verdict).toBe("PASS");
    expect(verdict.barVerdicts.A2_absoluteLuminance.verdict).toBe("PASS");
    expect(verdict.barVerdicts.R1_byteReplay.verdict).toBe("PASS");
    expect(verdict.headline).toContain("STOPS HERE");
    expect(verdict.theStop.applied).toContain("NOT widened");
  });

  it("holds the measurement that explains the miss", () => {
    // The correction is a WALL correction. Where the image is roof, it cannot act.
    const far235 = verdict.poses.filter((pose) => pose.azimuthDegrees === 235 && pose.distanceMeters >= 1200);
    for (const pose of far235) {
      expect(pose.relativeEnergyChangeAgainstV1).toBeLessThan(1e-6);
      expect(pose.pixelsMovedAbove1e6).toBeLessThanOrEqual(1);
      // Unchanged from v1 means exactly unchanged, not merely close.
      expect(Math.abs(pose.spreadChangeAgainstV1)).toBeLessThan(1e-5);
    }
    for (const pose of verdict.poses.filter((entry) => entry.azimuthDegrees === 55)) {
      expect(pose.relativeEnergyChangeAgainstV1).toBeGreaterThan(0.04);
      expect(pose.spreadChangeAgainstV1).toBeLessThan(0);
    }
  });

  it("keeps the domain control that makes the comparison legitimate", () => {
    for (const pose of verdict.poses) expect(pose.silhouetteControlAgainstV1).toBe(0);
  });

  it("records what did work without letting it stand in for the verdict", () => {
    const passes = verdict.poses.filter((pose) => pose.legacyHueBar002Verdict === "PASS").length;
    expect(passes).toBe(3);
    expect(verdict.whatDidWork.poseCount).toContain(`${passes} of 6`);
    expect(verdict.theStop.rule).toContain("no second recipe may be tried");
  });
});

// ---------------------------------------------------------------------------
// The roof term. Same guard as the wall stage: every decision number is
// recomputed from the measurements beside it, and the sign is asserted rather
// than described — the sign is the whole finding.
// ---------------------------------------------------------------------------

const roof = JSON.parse(readFileSync(join(repositoryRoot, "data/far-tier-hlod-hue-20260819/roof-term.json"), "utf8"));
const captureRecord = JSON.parse(readFileSync(join(repositoryRoot, "data/far-tier-hlod-hue-20260819/pinned-capture.json"), "utf8"));
const attributionRecord = JSON.parse(readFileSync(join(repositoryRoot, "data/far-tier-hlod-hue-20260819/hue-attribution.json"), "utf8"));

describe("the roof term is measured, and it moves hue the wrong way", () => {
  it("worsens the spread at every one of the six poses", () => {
    expect(roof.poses).toHaveLength(6);
    for (const pose of roof.poses) {
      expect(pose.roofAggregateChannelSpread).toBeGreaterThan(pose.v1ChannelSpread);
      expect(pose.roofTermDirection).toBe("WORSE");
      expect(pose.roofTermChangeInSpread).toBeCloseTo(pose.roofAggregateChannelSpread - pose.v1ChannelSpread, 6);
    }
    expect(roof.theRoofTerm.poseCountWorsened).toBe(6);
  });

  it("takes the deciding pose further from both bars, not closer", () => {
    const worst = roof.poses.find((pose) => pose.pose === "4000/235");
    expect(worst.v1ChannelSpread).toBe(0.033824);
    expect(worst.roofAggregateChannelSpread).toBe(0.043074);
    expect(worst.legacyBar002AfterRoofAggregate).toBe("MISS");
    expect(worst.a3PrimeAfterRoofAggregate).toBe("MISS");
  });

  it("has the arithmetic sign that predicted it, from the committed plan data", () => {
    const composition = roof.roofRegionComposition;
    // Rooftop metal is BLUER than the roof cap, so aggregating it in makes the
    // roof less red while the tile is already red-deficient.
    expect(composition.parts.rooftopMetal.redOverBlue).toBeLessThan(composition.prismRoofCapRedOverBlue);
    expect(composition.chromaticityShift).toBeLessThan(0);
    expect(composition.luminanceShift).toBeGreaterThan(0);
    const area = composition.parts.capsAndDecks.areaSquareMeters + composition.parts.equipmentAboveCrown.areaSquareMeters + composition.parts.rooftopMetal.areaSquareMeters;
    expect(composition.aggregateAreaSquareMeters).toBeCloseTo(area, 3);
  });

  it("records the trade rather than reporting only the half that flatters it", () => {
    const worst = roof.poses.find((pose) => pose.pose === "4000/235");
    // Tone is fixed at the pose that has blocked the mass bake.
    expect(Math.abs(worst.luminance.roofAggregateRatio - 1)).toBeLessThan(Math.abs(worst.luminance.v1Ratio - 1));
    expect(worst.luminance.A2AfterRoofAggregate).toBe("PASS");
    // And broken at the near azimuth-55 pose.
    const near = roof.poses.find((pose) => pose.pose === "400/55");
    expect(near.luminance.A1AfterRoofAggregate).toBe("MISS");
    expect(near.luminance.A2AfterRoofAggregate).toBe("MISS");
    // The sentence must carry BOTH halves, not just the flattering one.
    expect(roof.theRoofTerm.soItIsATrade).toContain("buys the tone finding");
    expect(roof.theRoofTerm.soItIsATrade).toContain("costs the hue finding");
    expect(roof.theRoofTerm.soItIsATrade).toContain("breaks two luminance bars");
  });

  it("refused the ambiguous variant and says which ambiguity", () => {
    const ambiguity = roof.theAmbiguityThatDecidedTheMethod;
    expect(ambiguity.theSplit).toContain("710.918");
    expect(ambiguity.theSplit).toContain("2,384.521");
    expect(ambiguity.whatWasBuiltInstead).toContain("INVERSE");
    // The excluded fire-escape metal must be listed, not quietly dropped.
    expect(roof.roofRegionComposition.parts.wallFireEscapeMetalExcluded.areaSquareMeters).toBe(2384.521);
  });
});

describe("the irreducible residual is bracketed, not asserted", () => {
  it("brackets every pose between the two metal assignments", () => {
    for (const pose of roof.poses) {
      const [low, high] = pose.residualBracket;
      expect(low).toBeLessThanOrEqual(high);
      expect([pose.residualAfterBothPaletteTermsEqualised, pose.residualAfterWallTermOnly].sort((a, b) => a - b)).toEqual([low, high]);
    }
  });

  it("names the trustworthy end by azimuth, because walls are what the bracket depends on", () => {
    for (const pose of roof.poses) {
      if (pose.azimuthDegrees === 235) expect(pose.trustworthyEndOfBracket).toContain("both-equalised");
      else expect(pose.trustworthyEndOfBracket).toContain("absorbed-wall");
    }
  });

  it("puts the worst residual above the legacy bar and below the roof aggregate's spread", () => {
    const worst = roof.theIrreducibleResidual.worstPoseResidual;
    expect(worst).toBe(Math.max(...roof.poses.map((pose) => pose.residualAfterBothPaletteTermsEqualised)));
    expect(worst).toBeGreaterThan(0.02);
    expect(worst).toBeLessThan(0.043074);
    expect(roof.theIrreducibleResidual.whatABarDerivationWouldRestOn).toContain("No bar is proposed here");
  });
});

describe("the roof stage kept its controls and its scope", () => {
  it("moved no geometry in either variant", () => {
    for (const pose of roof.poses) {
      expect(pose.silhouetteControlRoofAggregateAgainstV1).toBe(0);
      expect(pose.silhouetteControlBothEqualisedAgainstSource).toBe(0);
    }
  });

  it("verified the v1 baseline before repainting a texel", () => {
    expect(roof.positiveControls.v1BaselineVerifiedBeforeEditing)
      .toContain("c159e0508aeb7522620b799b83041461aecf34727f69209bd7efbf992f5c067a");
  });

  it("measured what each correction reaches, which is the wall stage's lesson applied", () => {
    for (const pose of roof.poses) {
      if (pose.azimuthDegrees === 235) {
        expect(pose.shareOfSignalTheRoofRepaintReached).toBeGreaterThan(pose.shareOfSignalTheWallCorrectionReached);
      } else {
        expect(pose.shareOfSignalTheWallCorrectionReached).toBeGreaterThan(pose.shareOfSignalTheRoofRepaintReached);
      }
    }
  });

  it("changed no recipe and captured no combined fix", () => {
    const text = JSON.stringify(roof.notClaimedHere);
    expect(text).toContain("NO recipe change");
    expect(text).toContain("NO combined wall-and-roof tile");
  });
});

// ---------------------------------------------------------------------------
// The adopted gate set and the final verdict.
//
// A post-hoc bar is only honest if it is labelled one, if its derivation is
// reproducible, and if the MISS it supersedes is still on the record. All three
// are asserted here, because all three are the kind of thing that quietly
// erodes between one task and the next.
// ---------------------------------------------------------------------------

const adoption = JSON.parse(readFileSync(join(repositoryRoot, "data/far-tier-hlod-hue-20260819/gate-adoption.json"), "utf8"));
const finalVerdict = JSON.parse(readFileSync(join(repositoryRoot, "data/far-tier-hlod-hue-20260819/final-verdict.json"), "utf8"));

describe("A3'' is adopted, derived, and disclosed as post-hoc", () => {
  it("reproduces its own derivation from the measured worst spread", () => {
    const derivation = adoption.theBar.derivation;
    const worst = Math.max(...verdict.poses.map((pose) => pose.channelSpread));
    expect(derivation.measuredWorstSpreadUnderV3).toBeCloseTo(worst, 6);
    expect(derivation.instrumentCrossSessionTolerance).toBe(0.001);
    expect(adoption.theBar.bar).toBe(Math.ceil((worst + 0.001) * 1_000) / 1_000);
    expect(derivation.derivedBarMatchesAdopted).toBe(true);
    expect(adoption.theBar.bar).toBe(0.035);
  });

  it("says plainly that it was chosen after the measurement", () => {
    expect(adoption.headline).toContain("AFTER THE MEASUREMENT");
    expect(adoption.decision.decidedBy).toBe("USER");
    expect(adoption.decision.decidedOn).toBe("2026-08-19");
    expect(adoption.decision.howThisDiffersFromAPreRegisteredBar.statement).toContain("POST-HOC");
    expect(finalVerdict.bars.A3doublePrime.status).toContain("AFTER MEASUREMENT");
  });

  it("keeps the raw spreads and the legacy verdict reported at every pose", () => {
    for (const pose of finalVerdict.poses) {
      expect(typeof pose.rawChannelSpread).toBe("number");
      expect(pose.rawPerChannelRatios).toHaveLength(3);
      expect(["PASS", "MISS"]).toContain(pose.legacyHueBar002.verdict);
      expect(pose.v1ChannelSpreadForComparison).toBeGreaterThan(0);
    }
    expect(adoption.theBar.rawSpreadsKeepBeingReported).toContain("not a reporting change");
  });

  it("records the legacy bar as unreachable on the measured floor, not on preference", () => {
    const legacy = adoption.theLegacyBarIsRecordedAsUNREACHABLE;
    expect(legacy.bar).toBe(0.02);
    expect(legacy.evidence.measuredFloorWithBothPaletteTermsCorrected).toBe(roof.theIrreducibleResidual.worstPoseResidual);
    expect(legacy.evidence.measuredFloorWithBothPaletteTermsCorrected).toBeGreaterThan(0.02);
    expect(legacy.whatIsNotClaimed).toContain("unreachable in principle");
    expect(legacy.whatIsNotClaimed).toContain("says nothing about it");
  });

  it("supersedes A3' by statement and cites the capture that broke its basis", () => {
    const superseded = adoption.a3PrimeSupersession;
    expect(superseded.supersededBar).toBe(preRegistration.bars.A3prime.bar);
    expect(superseded.statement).toContain("never edited");
    expect(superseded.citation).toContain(sha256HexSync(readFileSync(join(repositoryRoot, "data/far-tier-hlod-hue-20260819/fix-capture-verdict.json"), "utf8")));
    // The MISS it supersedes must still be on the record, unedited.
    expect(verdict.barVerdicts.A3prime_hue.verdict).toBe("MISS");
  });

  it("rejects the roof extension on the measured numbers", () => {
    const rejection = adoption.extensionToRoofRejected;
    expect(rejection.decision).toBe("REJECTED.");
    expect(rejection.measuredConsequences.join(" ")).toContain("WORSE at all six poses");
    expect(rejection.measuredConsequences.join(" ")).toContain("0.043074");
    expect(rejection.measuredConsequences.join(" ")).toContain("NEW FAILURES");
    expect(rejection.whatIsNotClaimed).toContain("largest measured lever");
  });
});

describe("the T004 handoff names one recipe and one gate set", () => {
  it("names the recipe it handed off, which T004 then superseded", () => {
    const handoff = adoption.t004GateHandoff;
    // The record is frozen evidence of what T013 handed over. Its hash is
    // compared as a LITERAL, not against a live call, because the live adopted
    // recipe is now v4 and this record must keep naming v3 forever.
    expect(handoff.recipe.recipeId).toBe("far-tier-hlod-bake-v3");
    expect(handoff.recipe.recipeSha256).toBe("e73206429c496c28c707120769eee5f4a6155f44442eccb9b19fe2fdcfbc24c8");
    expect(handoff.recipe.derivedFrom).toBe("far-tier-hlod-bake-v1");
    expect(FAR_TIER_ADOPTED_RECIPE.supersedes.recipeId).toBe(handoff.recipe.recipeId);
  });

  it("names exactly the three operative gates", () => {
    const ids = adoption.t004GateHandoff.operativeGates.map((gate) => gate.id);
    expect(ids).toEqual(["A1", "A2", "A3''"]);
    expect(adoption.t004GateHandoff.operativeGates[2].statement).toContain("0.035");
  });

  it("carries the prediction-agreement discipline that a post-hoc bar makes necessary", () => {
    const discipline = adoption.t004GateHandoff.predictionAgreementDiscipline;
    expect(discipline.statement).toContain("BEFORE its confirming capture");
    expect(discipline.statement).toContain("stop on a miss");
    expect(discipline.whyItIsPartOfTheHandoff).toContain("post-hoc");
  });

  it("warns the mass bake about the mask domain, which moves ratios more than the effect", () => {
    expect(adoption.t004GateHandoff.instrument.maskDomainWarning).toContain("MUST state its domain");
    expect(adoption.t004GateHandoff.instrument.maskDomainWarning).toContain("0.023");
  });

  it("says what the gates do not cover", () => {
    const uncovered = adoption.t004GateHandoff.whatTheGatesDoNotCover.join(" ");
    expect(uncovered).toContain("Silhouette");
    expect(uncovered).toContain("Cesium");
    expect(uncovered).toContain("One cell");
  });
});

describe("the final verdict re-scores an existing capture and says so", () => {
  it("takes no new measurement", () => {
    expect(finalVerdict.capturedAt).toBeNull();
    expect(finalVerdict.provenanceOfTheReadings.statement).toContain("THE READINGS ARE THE ONES ALREADY CAPTURED");
    expect(finalVerdict.provenanceOfTheReadings.whatChangedSinceThatRecordWasWritten).toContain("The BARS, and nothing else");
  });

  it("carries the same six spreads as the capture it re-scores", () => {
    expect(finalVerdict.poses).toHaveLength(6);
    for (const pose of finalVerdict.poses) {
      const captured = verdict.poses.find((entry) => entry.pose === pose.pose);
      expect(pose.rawChannelSpread).toBe(captured.channelSpread);
      expect(pose.absoluteLuminanceDifference).toBe(captured.absoluteLuminanceDifference);
    }
  });

  it("recomputes every per-pose verdict from the reading and the bar", () => {
    for (const pose of finalVerdict.poses) {
      expect(pose.A3doublePrime.verdict).toBe(pose.rawChannelSpread <= 0.035 ? "PASS" : "MISS");
      expect(pose.A3doublePrime.margin).toBeCloseTo(0.035 - pose.rawChannelSpread, 6);
      expect(pose.A2.verdict).toBe(Math.abs(pose.absoluteLuminanceDifference) <= 0.01 ? "PASS" : "MISS");
      // A1 applies only where the SOURCE is well exposed.
      expect(pose.A1.applies).toBe(pose.sourceUnionMeanLuminance >= 0.10);
      if (!pose.A1.applies) expect(pose.A1.verdict).toBe("not applicable");
    }
  });

  it("passes all three gates, and does not oversell it", () => {
    expect(finalVerdict.summary.A1.verdict).toBe("PASS");
    expect(finalVerdict.summary.A2.verdict).toBe("PASS");
    expect(finalVerdict.summary.A3doublePrime.verdict).toBe("PASS");
    expect(finalVerdict.summary.A3doublePrime.passed).toBe(6);
    expect(finalVerdict.summary.legacyHueBar002.passed).toBe(3);
    expect(finalVerdict.honestReadingOfThisResult.whatIsNotEarned).toContain("close to arithmetic");
    expect(finalVerdict.honestReadingOfThisResult.theOpenFinding).toContain("roof-dominated");
  });
});


// ---------------------------------------------------------------------------
// The last review round: a bracket whose ends came from different poses, a
// silent fallback nobody was counting, and an adoption nothing enforced.
// ---------------------------------------------------------------------------

describe("the measured floor's bracket belongs to one pose", () => {
  it("is the WORST pose's own bracket, not the envelope of all six", () => {
    const floor = roof.theIrreducibleResidual;
    const worst = roof.poses.find((pose) => pose.pose === floor.worstPose);
    expect(floor.worstPose).toBe("4000/235");
    expect(floor.worstPoseResidualBracket).toEqual(worst.residualBracket);
    expect(floor.worstPoseResidual).toBe(worst.residualAfterBothPaletteTermsEqualised);
    // The envelope form would have taken 0.006848 from 400/55.
    const envelopeLow = Math.min(...roof.poses.map((pose) => Math.min(...pose.residualBracket)));
    expect(floor.worstPoseResidualBracket[0]).not.toBe(envelopeLow);
  });

  it("cannot present a lower end below the bar it is used to retire", () => {
    expect(roof.theIrreducibleResidual.worstPoseResidualBracket[0]).toBeGreaterThan(0.02);
    expect(adoption.theLegacyBarIsRecordedAsUNREACHABLE.evidence.floorBracket[0]).toBeGreaterThan(0.02);
    expect(adoption.theLegacyBarIsRecordedAsUNREACHABLE.evidence.floorBracket)
      .toEqual(roof.theIrreducibleResidual.worstPoseResidualBracket);
  });
});

describe("the facade-only fallback is counted, bounded and disclosed", () => {
  it("is reported with its zones and its area, not asserted away", () => {
    const disclosure = verdict.implementationDisclosure;
    expect(disclosure.extent.zoneCount).toBe(disclosure.extent.zones.length);
    expect(disclosure.extent.zoneCount).toBeGreaterThan(0);
    expect(disclosure.extent.shareOfWallArea)
      .toBeCloseTo(disclosure.extent.affectedWallAreaSquareMeters / disclosure.extent.totalWallAreaSquareMeters, 6);
    expect(disclosure.extent.shareOfWallArea).toBeLessThan(0.001);
  });

  it("did not move the artifact it was found in", () => {
    expect(disclosureDigestsMatch()).toBe(true);
    function disclosureDigestsMatch() {
      return verdict.implementationDisclosure.doesItChangeAnyNumberInThisRecord.includes(verdict.barVerdicts.R1_byteReplay.glbSha256.slice(0, 8))
        && verdict.implementationDisclosure.doesItChangeAnyNumberInThisRecord.includes(verdict.barVerdicts.R1_byteReplay.atlasSha256.slice(0, 8));
    }
  });

  it("is refused by default, so it cannot come back silently", () => {
    expect(verdict.implementationDisclosure.whyItIsNotSilentAnyMore).toContain("REFUSES");
    expect(adoption.t004GateHandoff.knownImplementationLimit.whatTheMassBakeMustDo).toContain("STOP");
  });
});

describe("the adoption is expressible as a check, and the gap is recorded", () => {
  it("exports the adopted recipe as a value, and records what it superseded", () => {
    // T004 moved the adoption to v4. T013's record correctly names v3, because
    // v3 IS what T013 adopted; the supersession is carried on the constant
    // rather than by rewriting a frozen record.
    expect(FAR_TIER_ADOPTED_RECIPE.recipeId).toBe("far-tier-hlod-bake-v4");
    expect(FAR_TIER_ADOPTED_RECIPE.supersedes.recipeId).toBe(FAR_TIER_BAKE_RECIPE_V3.recipeId);
    expect(FAR_TIER_ADOPTED_RECIPE.supersedes.gateRecord).toContain("gate-adoption.json");
    expect(FAR_TIER_ADOPTED_RECIPE.adoptedOn).toBe("2026-08-19");
  });

  it("accepts v4 and refuses v1, v2, v3 and a bare object", () => {
    expect(() => assertFarTierAdoptedRecipe(FAR_TIER_BAKE_RECIPE_V4)).not.toThrow();
    for (const superseded of [FAR_TIER_BAKE_RECIPE, FAR_TIER_BAKE_RECIPE_V2, FAR_TIER_BAKE_RECIPE_V3]) {
      expect(() => assertFarTierAdoptedRecipe(superseded)).toThrow(/far-tier-hlod-bake-v4/u);
    }
    expect(() => assertFarTierAdoptedRecipe({})).toThrow(/no recipeId/u);
    expect(() => assertFarTierAdoptedRecipe(FAR_TIER_BAKE_RECIPE_V3)).toThrow(new RegExp(farTierRecipeHashV4(), "u"));
  });

  it("records that nothing enforces it yet, rather than implying it is enforced", () => {
    const enforcement = adoption.t004GateHandoff.enforcement;
    expect(enforcement.theGapThisCloses).toContain("NOTHING IN THE CODE PREVENTS BAKING v1 BY DEFAULT");
    expect(enforcement.howToClose).toContain("assertFarTierAdoptedRecipe");
    expect(enforcement.residualRisk).toContain("a document rather than a constraint");
    expect(adoption.notClaimedHere.join(" ")).toContain("not enforced by any code path");
  });
});

describe("the absorbed variant's union control is derived from measurements", () => {
  it("carries the union counts it compares, and they agree to zero", () => {
    const control = captureRecord.absorbedSourceVariant.positiveControl;
    expect(control.unionWithBakedPixels).toHaveLength(6);
    expect(control.sourceUnionWithBakedPixels).toHaveLength(6);
    expect(control.worstUnionDelta).toBe(0);
    expect(control.unionWithBakedPixels).toEqual(control.sourceUnionWithBakedPixels);
    expect(control).not.toHaveProperty("unionWithBakedAlsoIdentical");
  });

  it("digests only the renders its own stage produced", () => {
    // An unfiltered directory listing made this inventory grow whenever a LATER
    // stage rendered anything, so the attribution record claimed renders taken
    // after it. Four subjects, six poses each.
    expect(captureRecord.renders.files).toHaveLength(24);
    const prefixes = new Set(captureRecord.renders.files.map((file) => file.name.split("-")[0]));
    expect([...prefixes].sort()).toEqual(["absorbed", "baked", "noshadow", "source"]);
    expect(attributionRecord.evidence.renderCount).toBe(captureRecord.renders.files.length);
  });

  it("records why its own checksum moved after the pre-registration cited it", () => {
    expect(captureRecord.reEmission.priorSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(captureRecord.reEmission.whatCitesThePriorHash).toContain("not re-emitted after a capture");
    expect(preRegistration.predictionModel.sourceRecord).toContain(captureRecord.reEmission.priorSha256);
  });
});
