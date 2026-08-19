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
import { FarTierCellStop, bakeFarTierCell, farTierAdditivityGate } from "./far-tier-campaign.ts";
import type { FarTierCellBake, FarTierCellInput, FarTierStopCode } from "./far-tier-campaign.ts";
import type { V3Plan } from "../domain/deterministic-facade-generator-v3.ts";
import { sha256HexBytes } from "../domain/deterministic-hash.ts";
import { encodeRgbPng } from "./procedural-texture.ts";

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
  const emptyInput: FarTierCellInput = { cellId: "cell:empty", buildingIds: ["a"], planFor: () => ({ refusal: "absent from the snapshot" }) };

  it("names a cell with no bakeable face", () => {
    let stop: unknown;
    try {
      bakeFarTierCell(emptyInput, { recipe: FAR_TIER_BAKE_RECIPE_V4, zoneColourMode: "area-correct-aggregate" });
    } catch (error) { stop = error; }
    expect(stop).toBeInstanceOf(FarTierCellStop);
    expect((stop as FarTierCellStop).code).toBe("no-bakeable-face");
    expect((stop as FarTierCellStop).cellId).toBe("cell:empty");
  });

  it("gives each refusal a code the caller can branch on, checked against a real throw", () => {
    // An earlier version of this test asserted that a hardcoded array of five
    // distinct strings had five distinct members, which is true of any such
    // array and says nothing about the module. This one makes the module throw
    // and reads the code off the error.
    let stop: FarTierCellStop | undefined;
    try {
      bakeFarTierCell(emptyInput, { recipe: FAR_TIER_BAKE_RECIPE_V4, zoneColourMode: "area-correct-aggregate" });
    } catch (error) { stop = error as FarTierCellStop; }
    expect(stop?.code).toBe("no-bakeable-face");
    // The code is a discriminated member of the declared union, not free text.
    const declared: FarTierStopCode[] = ["no-bakeable-face", "packing-infeasible", "zone-aggregate-missing", "zone-aggregate-out-of-range", "fallback-share-over-bar"];
    expect(declared).toContain(stop!.code);
  });
});

describe("v1 and v4 atlas capacities", () => {
  it("knows the two capacities the gate is reasoning about", () => {
    const v1Cost = (FAR_TIER_BAKE_RECIPE.faceTexelFloor + 2 * FAR_TIER_BAKE_RECIPE.gutterTexels) ** 2;
    const v4Cost = (FAR_TIER_BAKE_RECIPE_V4.flatFaceTexels + 2 * FAR_TIER_BAKE_RECIPE_V4.flatFaceGutterTexels) ** 2;
    expect(v1Cost).toBe(64);
    expect(v4Cost).toBe(9);
    expect(Math.floor((256 * 256) / v1Cost)).toBe(1_024);
    expect(Math.floor((256 * 256) / v4Cost)).toBe(7_281);
  });

  it("packs a 1,400-face cell under v4 and refuses it under v1", () => {
    const faces = Array.from({ length: 1_400 }, (_, index) => ({ ...flatFace(), faceIndex: index }));
    expect(() => packFarTierAtlas(faces, 256, 1, FAR_TIER_BAKE_RECIPE)).toThrow(/could not pack 1400 faces/u);
    const v4 = packFarTierAtlas(faces, 256, 1, FAR_TIER_BAKE_RECIPE_V4);
    expect(v4.faces).toHaveLength(1_400);
  });
});

/**
 * A synthetic plan whose outer ring has `sides` edges, so it emits `sides` wall
 * faces plus one roof cap.
 *
 * It exists because the gate can only be exercised through REAL plans:
 * `farTierAdditivityGate` calls `bakeFarTierCell`, which calls
 * `farTierFacesForBuilding`. An earlier test tried to reach the gate with a
 * `planFor` that returned a refusal, which makes the bake throw
 * `no-bakeable-face` long before any packing happens — so the not-applicable
 * branch this file is named for was never entered by anything.
 */
function densePlan(buildingId: string, sides: number, radiusMm = 60_000): V3Plan {
  const ring = Array.from({ length: sides }, (_, index) => {
    const angle = (2 * Math.PI * index) / sides;
    return [Math.round(radiusMm * Math.cos(angle)), Math.round(radiusMm * Math.sin(angle))] as [number, number];
  });
  return {
    buildingId,
    styleClass: "masonry-warm",
    tiers: [{ index: 0, ring, baseZMm: 0, topZMm: 20_000, areaMm2: 0, perimeterMm: 0 }],
    surfaces: [],
    placements: [],
    materials: [
      { id: "material:facade:shaft", role: "facade", baseColorSrgb: [156, 74, 52, 255], metallicPermille: 0, roughnessPermille: 780 },
      { id: "material:facade:base", role: "facade", baseColorSrgb: [122, 58, 44, 255], metallicPermille: 0, roughnessPermille: 780 },
      { id: "material:roof", role: "roof", baseColorSrgb: [28, 27, 25, 255], metallicPermille: 0, roughnessPermille: 900 },
    ],
  } as unknown as V3Plan;
}

const denseInput = (sides: number): FarTierCellInput => ({
  cellId: "cell:dense",
  buildingIds: ["doitt:dense"],
  planFor: () => ({ plan: densePlan("doitt:dense", sides), offsetMeters: [0, 0] as const }),
});

const atlasDigest = (bake: FarTierCellBake): string =>
  sha256HexBytes(encodeRgbPng(bake.packing.atlasPixels, bake.packing.atlasPixels, bake.rgb));

describe("farTierAdditivityGate", () => {
  it("PASSES on a cell v1 can pack, and returns that cell's own v1 digest", () => {
    const gate = farTierAdditivityGate(denseInput(40), FAR_TIER_BAKE_RECIPE_V4, atlasDigest);
    expect(gate.applicable).toBe(true);
    expect(gate.verdict).toBe("PASS");
    expect(gate.v1AtlasSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(gate.reason).toBeNull();
  });

  it("reports NOT-APPLICABLE, and does not throw, when v1 cannot pack the cell", () => {
    // 1,100 walls + 1 roof cap = 1,101 faces, over v1's 1,024 and under v4's 7,281.
    const input = denseInput(1_100);
    // The premise: v1 really cannot pack it, and v4 really can.
    expect(() => bakeFarTierCell(input, { recipe: FAR_TIER_BAKE_RECIPE, zoneColourMode: "facade-only" }))
      .toThrow(FarTierCellStop);
    const underV4 = bakeFarTierCell(input, { recipe: FAR_TIER_BAKE_RECIPE_V4, zoneColourMode: "facade-only" });
    expect(underV4.packing.faces).toHaveLength(1_101);

    const gate = farTierAdditivityGate(input, FAR_TIER_BAKE_RECIPE_V4, atlasDigest);
    expect(gate.applicable).toBe(false);
    expect(gate.verdict).toBe("not-applicable");
    expect(gate.v1AtlasSha256).toBeNull();
    expect(gate.reason).not.toBeNull();
    expect(gate.reason).toContain("v1 cannot pack this cell");
    expect(gate.reason).toContain("NOT refused");
  });

  it("still PROPAGATES any other refusal from the v1 reference bake", () => {
    // The tolerance is exactly one stop code. A cell with nothing to bake must
    // come back as a refusal, not as a quietly not-applicable gate.
    const input: FarTierCellInput = {
      cellId: "cell:empty",
      buildingIds: ["doitt:absent"],
      planFor: () => ({ refusal: "absent from the snapshot" }),
    };
    let stop: FarTierCellStop | undefined;
    try { farTierAdditivityGate(input, FAR_TIER_BAKE_RECIPE_V4, atlasDigest); } catch (error) { stop = error as FarTierCellStop; }
    expect(stop).toBeInstanceOf(FarTierCellStop);
    expect(stop?.code).toBe("no-bakeable-face");
  });

  it("FAILS when the adopted recipe's facade-only path diverges from v1", () => {
    // The gate must be capable of failing, or a PASS means nothing. A digest
    // function that lies about the second leg stands in for a real divergence.
    let call = 0;
    const divergingDigest = (bake: FarTierCellBake): string => {
      call += 1;
      return call === 1 ? atlasDigest(bake) : "0".repeat(64);
    };
    const gate = farTierAdditivityGate(denseInput(40), FAR_TIER_BAKE_RECIPE_V4, divergingDigest);
    expect(gate.applicable).toBe(true);
    expect(gate.verdict).toBe("FAIL");
    expect(gate.reason).toContain("both switches off");
  });
});
