import { describe, expect, it } from "vitest";
import { REQUIRED_EXTERIOR_COMPONENT_KINDS } from "./exterior-contract";
import {
  DETERMINISTIC_FACADE_V2_GENERATOR_ID,
  DETERMINISTIC_FACADE_V2_SIGNAGE_UNCERTAINTY,
  DETERMINISTIC_FACADE_V2_UNCERTAINTY,
  calculateV2PlanHash,
  generateV2FacadePlan,
  validateV2Plan,
  type V2Input,
} from "./deterministic-facade-generator-v2";
import {
  DETERMINISTIC_FACADE_UNCERTAINTY,
  generateDeterministicFacadePlan,
} from "./deterministic-facade-generator";

const HASH = "a".repeat(64);

function input(overrides: Partial<V2Input["parameters"]> = {}, heightOverride?: { floorCount: number; floorHeightMm: number }): V2Input {
  const floorCount = heightOverride?.floorCount ?? 12;
  const floorHeightMm = heightOverride?.floorHeightMm ?? 3_600;
  return {
    schemaVersion: "2.0",
    buildingId: "doitt:39969",
    generatedAt: "2026-08-11T00:00:00.000Z",
    seed: "block-835-reference-20260811",
    tool: { id: "urban-digital-twin:block835-reference", version: "2.0.0" },
    geometry: { unit: "millimeter", footprint: { outer: [[-13_500, -16_400], [13_500, -16_400], [13_500, 16_400], [-13_500, 16_400]], holes: [] }, baseElevationMm: 0, heightMm: floorCount * floorHeightMm },
    sourceAnchors: [
      { id: "doitt:39969:anchor:footprint", kind: "footprint", sourceRefId: "source-ref:jh45-qr5r:39969", fingerprintSha256: HASH },
      { id: "doitt:39969:anchor:height", kind: "height", sourceRefId: "source-ref:jh45-qr5r:39969", fingerprintSha256: HASH },
    ],
    parameters: {
      floorCount, bayCount: 6, floorHeightMm,
      windowWidthMm: 2_200, windowHeightMm: 1_900, windowSillMm: 900, openingInsetMm: 200,
      entranceWidthMm: 2_000, entranceHeightMm: 2_800, storefrontHeightMm: 2_500,
      corniceHeightMm: 280, roofEquipmentSizeMm: 6_000,
      tierCount: 3, setbackInsetMm: 1_200,
      balconyDepthMm: 900, balconyHeightMm: 300, balconyFloorInterval: 3,
      fireEscapeWidthMm: 2_400, fireEscapeDepthMm: 1_100, fireEscapePlatformHeightMm: 220,
      waterTankSides: 8, waterTankRadiusMm: 1_800, waterTankHeightMm: 3_000, waterTankLegHeightMm: 2_400, waterTankLegSizeMm: 300,
      signBandHeightMm: 600, signBandDepthMm: 180, bladeSignWidthMm: 900, bladeSignHeightMm: 1_800, bladeSignDepthMm: 900,
      ...overrides,
    },
  };
}

describe("deterministic facade generator V2", () => {
  it("generates every required component kind with no absent state", () => {
    const generated = generateV2FacadePlan(input());
    expect(generated.ok ? null : generated.issues).toBeNull();
    const plan = generated.ok ? generated.value : null;
    if (!plan) return;
    expect(plan.inventory.components).toHaveLength(REQUIRED_EXTERIOR_COMPONENT_KINDS.length);
    expect(plan.inventory.components.map((component) => component.kind).sort()).toEqual([...REQUIRED_EXTERIOR_COMPONENT_KINDS].sort());
    // The whole point of V2: the five V1-absent kinds are now generated.
    for (const component of plan.inventory.components) {
      expect(component.state).toBe("generated");
      expect(component.state === "generated" ? component.generator.id : "").toBe(DETERMINISTIC_FACADE_V2_GENERATOR_ID);
    }
  });

  it("emits real geometry for each formerly absent kind", () => {
    const generated = generateV2FacadePlan(input());
    const plan = generated.ok ? generated.value : null;
    expect(plan).not.toBeNull();
    if (!plan) return;
    // setbacks: stepped massing with a deck surface at every tier boundary
    expect(plan.tiers.length).toBe(3);
    expect(plan.surfaces.filter((surface) => surface.kind === "setback-deck")).toHaveLength(8);
    for (let index = 1; index < plan.tiers.length; index += 1) {
      expect(plan.tiers[index]!.maxX - plan.tiers[index]!.minX).toBeLessThan(plan.tiers[index - 1]!.maxX - plan.tiers[index - 1]!.minX);
    }
    // balconies, fire escapes, blank signage
    expect(plan.placements.some((placement) => placement.kind === "balcony")).toBe(true);
    expect(plan.placements.some((placement) => placement.kind === "fire-escape")).toBe(true);
    expect(plan.placements.filter((placement) => placement.kind === "sign-band")).toHaveLength(1);
    expect(plan.placements.filter((placement) => placement.kind === "blade-sign")).toHaveLength(1);
    // water tanks: an even-sided prism on four legs
    expect(plan.prisms.filter((prism) => prism.kind === "water-tank")).toHaveLength(1);
    expect(plan.prisms.filter((prism) => prism.kind === "water-tank-leg")).toHaveLength(4);
    expect(plan.prisms[0]!.ring).toHaveLength(8);
    for (const prism of plan.prisms) expect(prism.topZMm).toBeGreaterThan(prism.baseZMm);
  });

  it("states signage honestly and carries zero text, brand or tenant content", () => {
    const generated = generateV2FacadePlan(input());
    const plan = generated.ok ? generated.value : null;
    if (!plan) return;
    const signage = plan.inventory.components.find((component) => component.kind === "signage")!;
    expect(signage.uncertainty).toBe(DETERMINISTIC_FACADE_V2_SIGNAGE_UNCERTAINTY);
    expect(signage.uncertainty).toContain("No real-world sign presence");
    expect(signage.uncertainty).toContain("no glyph, logo or lettering is generated");
    expect(plan.uncertainty).toBe(DETERMINISTIC_FACADE_V2_UNCERTAINTY);
    // Sign geometry is pure massing: bounds only, never a label or text payload.
    const serialized = JSON.stringify(plan).toLowerCase();
    for (const forbidden of ["\"text\"", "\"label\"", "\"brand\"", "\"tenant\"", "\"glyph\"", "\"logo\"", "\"caption\""]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("is deterministic and rejects any non-canonical mutation", () => {
    const first = generateV2FacadePlan(input());
    const second = generateV2FacadePlan(input());
    expect(first.ok && second.ok ? first.value.planHashSha256 === second.value.planHashSha256 : false).toBe(true);
    const plan = first.ok ? first.value : null;
    if (!plan) return;
    expect(validateV2Plan(plan).ok).toBe(true);
    expect(calculateV2PlanHash(plan)).toBe(plan.planHashSha256);

    const tampered = structuredClone(plan);
    tampered.placements = tampered.placements.filter((placement) => placement.kind !== "balcony");
    expect(validateV2Plan(tampered).ok).toBe(false);

    const rehashed = structuredClone(plan);
    rehashed.planHashSha256 = "0".repeat(64);
    expect(validateV2Plan(rehashed).ok).toBe(false);
  });

  it("rejects inputs whose setbacks or tiers would leave no usable crown", () => {
    expect(generateV2FacadePlan(input({ tierCount: 1 })).ok).toBe(false);
    expect(generateV2FacadePlan(input({ setbackInsetMm: 9_000 })).ok).toBe(false);
    expect(generateV2FacadePlan(input({ waterTankSides: 7 })).ok).toBe(false);
    expect(generateV2FacadePlan(input({ signBandHeightMm: 40_000 })).ok).toBe(false);
  });

  it("leaves the frozen V1 generator untouched", () => {
    // V1 must keep declaring the five kinds absent; the 20260810 package is a
    // drift-tested artifact of exactly this behaviour.
    const v1 = generateDeterministicFacadePlan({
      schemaVersion: "1.0",
      buildingId: "doitt:39969",
      generatedAt: "2026-08-10T00:00:00.000Z",
      seed: "block-835-reference-20260810",
      tool: { id: "urban-digital-twin:block835-reference", version: "1.0.0" },
      geometry: { unit: "millimeter", footprint: { outer: [[-13_500, -16_400], [13_500, -16_400], [13_500, 16_400], [-13_500, 16_400]], holes: [] }, baseElevationMm: 0, heightMm: 43_200 },
      sourceAnchors: input().sourceAnchors,
      parameters: {
        floorCount: 12, bayCount: 6, floorHeightMm: 3_600,
        windowWidthMm: 2_200, windowHeightMm: 1_900, windowSillMm: 900, openingInsetMm: 200,
        entranceWidthMm: 2_000, entranceHeightMm: 2_800, storefrontHeightMm: 2_500,
        corniceHeightMm: 280, roofEquipmentSizeMm: 6_000,
      },
    });
    expect(v1.ok).toBe(true);
    if (!v1.ok) return;
    const absent = v1.value.inventory.components.filter((component) => component.state === "absent").map((component) => component.kind).sort();
    expect(absent).toEqual(["balconies", "fire-escapes", "setbacks", "signage", "water-tanks"]);
    expect(v1.value.uncertainty).toBe(DETERMINISTIC_FACADE_UNCERTAINTY);
    expect(v1.value.uncertainty).not.toBe(DETERMINISTIC_FACADE_V2_UNCERTAINTY);
  });
});
