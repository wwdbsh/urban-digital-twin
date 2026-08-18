/**
 * The shading term's whole claim is that it is derived, not chosen. These tests
 * attack that: they check the arithmetic, the exclusions, the order-independence
 * and — most importantly — that nothing in the derivation can see a measurement.
 */
import { describe, expect, it } from "vitest";
import {
  FAR_TIER_ROOF_OCCUPYING_PRISM_KINDS,
  farTierRoofOccupancy,
  farTierRoofScalarBand,
  farTierShadingTerm,
} from "./far-tier-shading.ts";
import type { V3Plan } from "../domain/deterministic-facade-generator-v3.ts";

const square = (size: number): Array<[number, number]> => [[0, 0], [size, 0], [size, size], [0, size]];

function plan(buildingId: string, roofSize: number, prisms: Array<{ kind: string; size: number }>): V3Plan {
  return {
    buildingId,
    tiers: [{ ring: square(roofSize) }],
    prisms: prisms.map((entry, index) => ({ id: `p${index}`, kind: entry.kind, ring: square(entry.size) })),
  } as unknown as V3Plan;
}

describe("roof occupancy", () => {
  it("is the occupying footprint over the roof plane", () => {
    const occupancy = farTierRoofOccupancy(plan("doitt:1", 100, [{ kind: "water-tank", size: 10 }]));
    expect(occupancy.roofPlaneAreaMm2).toBe(10_000);
    expect(occupancy.occupiedAreaMm2).toBe(100);
    expect(occupancy.occupiedFraction).toBeCloseTo(0.01, 12);
  });

  it("EXCLUDES water-tank legs, which sit beneath the tank they support", () => {
    // Counting the legs would charge the roof twice for one piece of hardware
    // and inflate the term — in the direction that would make it easier to pass.
    const withLegs = farTierRoofOccupancy(plan("doitt:1", 100, [
      { kind: "water-tank", size: 10 },
      { kind: "water-tank-leg", size: 3 }, { kind: "water-tank-leg", size: 3 },
      { kind: "water-tank-leg", size: 3 }, { kind: "water-tank-leg", size: 3 },
    ]));
    expect(withLegs.occupiedAreaMm2).toBe(100);
    expect(FAR_TIER_ROOF_OCCUPYING_PRISM_KINDS).not.toContain("water-tank-leg");
  });

  it("cannot report a roof as more than fully occupied", () => {
    const occupancy = farTierRoofOccupancy(plan("doitt:1", 10, [{ kind: "roof-equipment", size: 50 }]));
    expect(occupancy.occupiedFraction).toBe(1);
    expect(occupancy.occupiedAreaMm2).toBe(occupancy.roofPlaneAreaMm2);
  });

  it("is sign-independent, so ring winding cannot change the answer", () => {
    const clockwise = { ...plan("doitt:1", 100, [{ kind: "water-tank", size: 10 }]) };
    (clockwise as unknown as { tiers: Array<{ ring: Array<[number, number]> }> }).tiers[0]!.ring = [...square(100)].reverse();
    expect(farTierRoofOccupancy(clockwise).roofPlaneAreaMm2).toBe(10_000);
  });
});

describe("the cell term", () => {
  const plans = [
    plan("doitt:2", 100, [{ kind: "water-tank", size: 20 }]),
    plan("doitt:1", 10, [{ kind: "roof-equipment", size: 5 }]),
  ];

  it("is AREA weighted, not a mean of per-building fractions", () => {
    // The small roof is 25% occupied and the large one 4%. A mean of fractions
    // would say 14.5%; the area-weighted answer is what the pixels see.
    const term = farTierShadingTerm(plans);
    const meanOfFractions = (0.25 + 0.04) / 2;
    expect(term.occupiedFraction).toBeCloseTo((400 + 25) / (10_000 + 100), 12);
    expect(term.occupiedFraction).not.toBeCloseTo(meanOfFractions, 3);
    expect(term.roofScalar).toBeCloseTo(1 - term.occupiedFraction, 12);
  });

  it("does not depend on the order the caller supplies", () => {
    expect(farTierShadingTerm([...plans].reverse()).roofScalar).toBe(farTierShadingTerm(plans).roofScalar);
  });

  it("darkens, never brightens", () => {
    expect(farTierShadingTerm(plans).roofScalar).toBeLessThanOrEqual(1);
    expect(farTierShadingTerm(plans).roofScalar).toBeGreaterThanOrEqual(0);
  });
});

describe("the admissible band", () => {
  it("brackets what a roof-only scalar can and must do", () => {
    const band = farTierRoofScalarBand({
      roofLuminanceShadow: 0.03957231, roofLuminanceLit: 0.04319247,
      requiredShadowReduction: 0.000899, permittedLitReduction: 0.013226,
    });
    expect(band.feasible).toBe(true);
    expect(band.maximum).toBeCloseTo(0.977279, 5);
    expect(band.minimum).toBeCloseTo(0.693789, 5);
  });
});

describe("the derivation cannot see a measurement", () => {
  it("takes luminance ONLY in the band helper, which is disclosure and not derivation", () => {
    // `farTierRoofScalarBand` does take measured luminances — that is the point
    // of publishing the band. What matters is that the SCALAR does not.
    const term = farTierShadingTerm([plan("doitt:1", 100, [{ kind: "water-tank", size: 10 }])]);
    expect(term.roofScalar).toBeCloseTo(0.99, 12);
    // Same inputs, same answer, with no reference to any pose or ratio.
    expect(farTierShadingTerm([plan("doitt:1", 100, [{ kind: "water-tank", size: 10 }])]).roofScalar).toBe(term.roofScalar);
  });
});
