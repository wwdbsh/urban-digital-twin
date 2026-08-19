/**
 * Recipe v4 and the shared cell-bake the campaign runs.
 *
 * The load-bearing claim here is the one the v4 pre-registration rests its
 * predictions on: a flat face's baked BYTE is unchanged when its rect shrinks
 * from 4x4 to 1x1. `far-tier-bake.test.ts` pins the rect SIZES, which is a
 * different statement — a size test passes just as happily if the colour is
 * recomputed differently at a different size. This file pins the output.
 */
import { describe, expect, it } from "vitest";

import {
  FAR_TIER_BAKE_RECIPE,
  FAR_TIER_BAKE_RECIPE_V2,
  FAR_TIER_BAKE_RECIPE_V3,
  FAR_TIER_BAKE_RECIPE_V4,
  bakeFarTierAtlas,
  farTierEffectiveParameters,
  farTierRecipeHash,
  farTierRecipeHashV2,
  farTierRecipeHashV3,
  farTierRecipeHashV4,
  packFarTierAtlas,
} from "./far-tier-bake.ts";
import type { FarTierFace } from "./far-tier-bake.ts";
import { FarTierCellStop, bakeFarTierCell } from "./far-tier-campaign.ts";

/** A wall too small to resolve, so both packings treat it as flat. */
const flatFace = (): FarTierFace => ({
  buildingId: "doitt:test",
  faceIndex: 0,
  kind: "wall",
  areaSquareMeters: 80,
  cornersMm: [[0, 0, 0], [40_000, 0, 0], [40_000, 0, 2_000], [0, 0, 2_000]],
  offsetMeters: [0, 0],
  zones: [{ materialId: "material:facade:shaft", textureClass: "brick-running-bond", factor: [0.5, 0.4, 0.3], fromFraction: 0, toFraction: 1 }],
});

const texelAt = (rgb: Uint8Array, size: number, x: number, y: number): [number, number, number] => {
  const at = (y * size + x) * 3;
  return [rgb[at]!, rgb[at + 1]!, rgb[at + 2]!];
};

describe("a flat face's baked byte does not depend on its rect size", () => {
  it("writes the SAME colour under v1's 4x4 and v4's 1x1", () => {
    const size = 256;
    const v1 = packFarTierAtlas([flatFace()], size, 1, FAR_TIER_BAKE_RECIPE);
    const v4 = packFarTierAtlas([flatFace()], size, 1, FAR_TIER_BAKE_RECIPE_V4);
    expect(v1.faces[0]!.rect!.width).toBe(4);
    expect(v4.faces[0]!.rect!.width).toBe(1);

    const v1Rgb = bakeFarTierAtlas(v1);
    const v4Rgb = bakeFarTierAtlas(v4);
    const v1Rect = v1.faces[0]!.rect!;
    const v4Rect = v4.faces[0]!.rect!;
    const v1Colour = texelAt(v1Rgb, size, v1Rect.x, v1Rect.y);
    const v4Colour = texelAt(v4Rgb, size, v4Rect.x, v4Rect.y);

    // THE PREDICTION BASIS. Same bytes, not merely similar ones.
    expect(v4Colour).toEqual(v1Colour);

    // And v1's sixteen texels are all that one colour, which is why collapsing
    // them to one loses nothing.
    for (let row = 0; row < v1Rect.height; row += 1) {
      for (let column = 0; column < v1Rect.width; column += 1) {
        expect(texelAt(v1Rgb, size, v1Rect.x + column, v1Rect.y + row)).toEqual(v1Colour);
      }
    }
  });

  it("packs more faces into the same atlas, which is the whole point", () => {
    const many = Array.from({ length: 400 }, (_, index) => ({ ...flatFace(), faceIndex: index }));
    const v1 = packFarTierAtlas(many, 256, 1, FAR_TIER_BAKE_RECIPE);
    const v4 = packFarTierAtlas(many, 256, 1, FAR_TIER_BAKE_RECIPE_V4);
    expect(v4.occupancy).toBeLessThan(v1.occupancy);
    expect(v4.appliedScale).toBeGreaterThanOrEqual(v1.appliedScale);
  });
});

describe("v4 is v3's colour over v2's packing, and nothing else", () => {
  it("takes its colour fields from v3 and its packing fields from v2", () => {
    expect(FAR_TIER_BAKE_RECIPE_V4.zoneColour).toBe(FAR_TIER_BAKE_RECIPE_V3.zoneColour);
    expect(FAR_TIER_BAKE_RECIPE_V4.zoneAggregationIncludesRoles).toEqual(FAR_TIER_BAKE_RECIPE_V3.zoneAggregationIncludesRoles);
    expect(FAR_TIER_BAKE_RECIPE_V4.flatFaceTexels).toBe(FAR_TIER_BAKE_RECIPE_V2.flatFaceTexels);
    expect(FAR_TIER_BAKE_RECIPE_V4.flatFaceGutterTexels).toBe(FAR_TIER_BAKE_RECIPE_V2.flatFaceGutterTexels);
    expect(FAR_TIER_BAKE_RECIPE_V4.gutterTexels).toBe(FAR_TIER_BAKE_RECIPE.gutterTexels);
    expect(FAR_TIER_BAKE_RECIPE_V4.faceTexelFloor).toBe(FAR_TIER_BAKE_RECIPE.faceTexelFloor);
  });

  it("changes exactly the fields it claims to against v3", () => {
    const changed = Object.entries(FAR_TIER_BAKE_RECIPE_V3)
      .filter(([key, value]) => JSON.stringify((FAR_TIER_BAKE_RECIPE_V4 as Record<string, unknown>)[key]) !== JSON.stringify(value))
      .map(([key]) => key)
      .sort();
    expect(changed).toEqual(["derivedFrom", "recipeId", "supersedes"]);
    const added = Object.keys(FAR_TIER_BAKE_RECIPE_V4)
      .filter((key) => !(key in FAR_TIER_BAKE_RECIPE_V3))
      .sort();
    expect(added).toEqual(["flatFaceGutterTexels", "flatFaceTexels", "shading"]);
  });

  it("leaves v1, v2 and v3 and their hashes untouched", () => {
    expect(FAR_TIER_BAKE_RECIPE.recipeId).toBe("far-tier-hlod-bake-v1");
    expect(FAR_TIER_BAKE_RECIPE_V2.recipeId).toBe("far-tier-hlod-bake-v2");
    expect(FAR_TIER_BAKE_RECIPE_V3.recipeId).toBe("far-tier-hlod-bake-v3");
    expect(FAR_TIER_BAKE_RECIPE_V4.recipeId).toBe("far-tier-hlod-bake-v4");
    const hashes = new Set([farTierRecipeHash(), farTierRecipeHashV2(), farTierRecipeHashV3(), farTierRecipeHashV4()]);
    expect(hashes.size).toBe(4);
  });

  it("keeps the guarded shading path closed", () => {
    expect(FAR_TIER_BAKE_RECIPE_V4.shading).toBeNull();
    expect(farTierEffectiveParameters(FAR_TIER_BAKE_RECIPE_V4).shadingScalar).toBe(1);
  });

  it("cannot be entered by omission", () => {
    expect(farTierEffectiveParameters().flatFaceTexels).toBe(FAR_TIER_BAKE_RECIPE.faceTexelFloor);
    expect(farTierEffectiveParameters(FAR_TIER_BAKE_RECIPE_V4).flatFaceTexels).toBe(1);
    expect(farTierEffectiveParameters(FAR_TIER_BAKE_RECIPE_V4).zoneColourMode).toBe("area-correct-aggregate");
  });
});

describe("the shared cell bake refuses rather than crashes", () => {
  const emptyInput = { cellId: "cell:empty", buildingIds: ["a"], planFor: () => ({ refusal: "absent from the snapshot" }) };

  it("names a cell with no bakeable face", () => {
    let stop: unknown;
    try {
      bakeFarTierCell(emptyInput, { recipe: FAR_TIER_BAKE_RECIPE_V4, zoneColourMode: "area-correct-aggregate" });
    } catch (error) { stop = error; }
    expect(stop).toBeInstanceOf(FarTierCellStop);
    expect((stop as FarTierCellStop).code).toBe("no-bakeable-face");
    expect((stop as FarTierCellStop).cellId).toBe("cell:empty");
  });

  it("keeps every stop code distinct, so a campaign can count them apart", () => {
    const codes = ["no-bakeable-face", "packing-infeasible", "zone-aggregate-missing", "zone-aggregate-out-of-range", "fallback-share-over-bar"];
    expect(new Set(codes).size).toBe(codes.length);
  });
});
