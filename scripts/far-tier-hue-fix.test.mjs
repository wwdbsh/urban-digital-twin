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
