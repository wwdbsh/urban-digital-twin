/**
 * The far-tier baked shading term, and its derivation.
 *
 * WHAT IT APPROXIMATES, AND WHAT IT INVENTS. The far-tier prism replaces a
 * building's roof with one flat plane. The source massing carries rooftop
 * groups on that plane — water tanks, their legs, roof equipment — which the
 * prism omits entirely: the T002 frame check measured 3.59 m of rooftop mass
 * present in the source and absent from the prism. A flat lit plane therefore
 * returns more light than the roof it stands in for.
 *
 * The term below darkens the roof by the fraction of the roof plane those
 * rooftop groups occupy. THAT IS A SYNTHETIC DEVIATION, NOT A MEASUREMENT: no
 * occlusion is computed, no shadow is traced, and nothing here is derived from
 * any observation of a real building. It is an invented appearance chosen to
 * approximate a named mechanism, and it must be declared as such wherever a
 * baked artifact carries it.
 *
 * ANTI-FITTING. Every input is committed plan geometry. Nothing in this file
 * reads a rendered image, a luminance ratio, a camera, a light, or any
 * measurement taken from the appearance instrument. The scalar is what the
 * geometry says it is, and if that is not enough to move a failing pose then
 * the honest outcome is a predicted miss rather than a larger constant.
 *
 * DETERMINISM. Only +, -, *, / are used. No `Math.pow`, `exp`, `log` or
 * trigonometry, so no engine-dependent transcendental enters a byte-producing
 * path. Aggregation is over an explicitly sorted building order.
 */

import type { V3Plan, V3Prism } from "../domain/deterministic-facade-generator-v3.ts";

/**
 * Rooftop prism kinds that stand ON the roof plane and occupy it.
 *
 * `water-tank-leg` is deliberately EXCLUDED. The legs sit underneath the tank
 * they support, so their footprints lie inside the tank's; counting both would
 * double-count one piece of roof and inflate the term. Excluding them is the
 * conservative direction — it makes the derived scalar smaller, not larger.
 */
export const FAR_TIER_ROOF_OCCUPYING_PRISM_KINDS: readonly string[] = ["roof-equipment", "water-tank"];

/** Twice the signed area of a closed ring, by the shoelace sum. */
function doubleSignedRingArea(ring: readonly (readonly [number, number])[]): number {
  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index]!;
    const next = ring[(index + 1) % ring.length]!;
    total += current[0] * next[1] - next[0] * current[1];
  }
  return total;
}

function ringArea(ring: readonly (readonly [number, number])[]): number {
  const doubled = doubleSignedRingArea(ring);
  return (doubled < 0 ? -doubled : doubled) / 2;
}

export interface FarTierRoofOccupancy {
  buildingId: string;
  roofPlaneAreaMm2: number;
  occupiedAreaMm2: number;
  /** Occupied over roof plane, clamped to [0,1]. */
  occupiedFraction: number;
}

/** One building's roof occupancy, from its committed plan and nothing else. */
export function farTierRoofOccupancy(plan: V3Plan): FarTierRoofOccupancy {
  const roofPlaneAreaMm2 = ringArea(plan.tiers[0]!.ring);
  let occupiedAreaMm2 = 0;
  // Prisms are traversed in the plan's own committed order, which is fixed.
  for (const prism of plan.prisms as readonly V3Prism[]) {
    if (!FAR_TIER_ROOF_OCCUPYING_PRISM_KINDS.includes(prism.kind)) continue;
    occupiedAreaMm2 += ringArea(prism.ring);
  }
  // A roof cannot be more than fully occupied, whatever the footprints sum to.
  if (occupiedAreaMm2 > roofPlaneAreaMm2) occupiedAreaMm2 = roofPlaneAreaMm2;
  const occupiedFraction = roofPlaneAreaMm2 === 0 ? 0 : occupiedAreaMm2 / roofPlaneAreaMm2;
  return { buildingId: plan.buildingId, roofPlaneAreaMm2, occupiedAreaMm2, occupiedFraction };
}

export interface FarTierShadingTerm {
  /** The scalar multiplying every ROOF zone's factor, in linear light. */
  roofScalar: number;
  /** Area-weighted mean occupied fraction across the cell. */
  occupiedFraction: number;
  buildingCount: number;
  totalRoofPlaneAreaMm2: number;
  totalOccupiedAreaMm2: number;
  perBuilding: readonly FarTierRoofOccupancy[];
}

/**
 * The cell's shading term.
 *
 * AREA WEIGHTED, not a mean of fractions: a large roof contributes more of the
 * cell's roof pixels than a small one, so weighting by building would let a
 * shed with a big water tank speak for a tower.
 *
 * `plans` is sorted by building id here rather than trusted from the caller, so
 * the sum order — and therefore the last bit of the result — cannot depend on
 * how the caller happened to iterate a map.
 */
export function farTierShadingTerm(plans: readonly V3Plan[]): FarTierShadingTerm {
  const ordered = [...plans].sort((left, right) => (left.buildingId < right.buildingId ? -1 : left.buildingId > right.buildingId ? 1 : 0));
  const perBuilding = ordered.map((plan) => farTierRoofOccupancy(plan));
  let totalRoofPlaneAreaMm2 = 0;
  let totalOccupiedAreaMm2 = 0;
  for (const entry of perBuilding) {
    totalRoofPlaneAreaMm2 += entry.roofPlaneAreaMm2;
    totalOccupiedAreaMm2 += entry.occupiedAreaMm2;
  }
  const occupiedFraction = totalRoofPlaneAreaMm2 === 0 ? 0 : totalOccupiedAreaMm2 / totalRoofPlaneAreaMm2;
  return {
    roofScalar: 1 - occupiedFraction,
    occupiedFraction,
    buildingCount: perBuilding.length,
    totalRoofPlaneAreaMm2,
    totalOccupiedAreaMm2,
    perBuilding,
  };
}

/**
 * The pre-registered admissible band for a ROOF-ONLY scalar, from the committed
 * T002 readings and the decomposition.
 *
 * DISCLOSED ON PURPOSE. The band was computable from published numbers before
 * the derivation was run, and saying so is what makes the prediction bar a real
 * test rather than a formality: a reader can check that the derived value was
 * not steered toward the middle of the band.
 */
export function farTierRoofScalarBand(input: {
  /** Absolute mean linear luminance the roof contributes at each pose. */
  roofLuminanceShadow: number;
  roofLuminanceLit: number;
  /** Absolute reduction the shadow pose needs to reach the tone bar. */
  requiredShadowReduction: number;
  /** Absolute reduction the lit pose may absorb before it breaches the bar. */
  permittedLitReduction: number;
}): { minimum: number; maximum: number; feasible: boolean } {
  const maximum = 1 - input.requiredShadowReduction / input.roofLuminanceShadow;
  const minimum = 1 - input.permittedLitReduction / input.roofLuminanceLit;
  return { minimum, maximum, feasible: minimum <= maximum };
}
