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
  FAR_TIER_BAKE_RECIPE,
  FAR_TIER_BAKE_RECIPE_V3,
  farTierEffectiveParameters,
  farTierRecipeHash,
  farTierRecipeHashV3,
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
