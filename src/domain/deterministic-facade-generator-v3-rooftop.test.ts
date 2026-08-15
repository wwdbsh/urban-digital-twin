/**
 * The two T004 rooftop rules, measured against the real Block 835 footprints.
 *
 * They are stated against real rings for the same reason the V3 pin tests are:
 * the orphan-leg defect is a CONTAINMENT interaction between a tank ring and a
 * parapet, and a rectangle never produces it. Fourteen real footprints do —
 * four of them, which is the prevalence the shipped city carries.
 *
 * Every assertion here is about the OPTIONS-ON path. The default path is
 * asserted to be byte-identical, which is the property that keeps five frozen
 * wave releases and the committed Block 835 packages untouched.
 */
import { describe, expect, it } from "vitest";
import releaseJson from "../../public/data/manhattan-esb-block-exterior-pilot-20260805/release.json";
import { enuFrame, readPilotBuildings, toEnuMeters, type PilotBuildingSource } from "../release/block835-reference-package.ts";
import { stableSerialize } from "./deterministic-hash.ts";
import {
  V3_NOMINAL_FLOOR_HEIGHT_MM,
  V3_ROOFTOP_HONESTY_OPTIONS,
  V3_SHIPPED_GRAMMAR_OPTIONS,
  deriveV3Parameters,
  generateV3FacadePlan,
  ringSignedAreaMm2,
  serializeV3Plan,
  v3EffectiveGrammarOptions,
  v3GrammarOptionsDifferFromShipped,
  validateV3Plan,
  type Point2Mm,
  type V3GrammarOptions,
  type V3Plan,
} from "./deterministic-facade-generator-v3.ts";

const buildings = readPilotBuildings(releaseJson as unknown);

function footprintMm(building: PilotBuildingSource): Point2Mm[] {
  const frame = enuFrame(building.anchor);
  const ring = building.footprint.map((point) => {
    const [east, north] = toEnuMeters(frame, point);
    return [Math.round(east * 1_000), Math.round(north * 1_000)] as Point2Mm;
  });
  return ringSignedAreaMm2(ring) < 0 ? [...ring].reverse() : ring;
}

function inputFor(outer: Point2Mm[], heightMm: number, buildingId: string, grammar: V3GrammarOptions): unknown {
  return {
    schemaVersion: "3.0",
    buildingId,
    generatedAt: "2026-08-11T00:00:00.000Z",
    seed: "block-835-reference-v3",
    tool: { id: "urban-digital-twin:block835-v3", version: "3.0.0" },
    geometry: { unit: "millimeter", footprint: { outer }, baseElevationMm: 0, heightMm },
    sourceAnchors: [
      { id: "anchor:footprint", kind: "footprint", sourceRefId: "source-ref:jh45-qr5r", fingerprintSha256: "a".repeat(64) },
      { id: "anchor:height", kind: "height", sourceRefId: "source-ref:oti-height", fingerprintSha256: "b".repeat(64) },
    ],
    parameters: deriveV3Parameters({ footprintOuterMm: outer, heightMm }, grammar),
  };
}

function planFor(building: PilotBuildingSource, grammar: V3GrammarOptions): V3Plan {
  const outer = footprintMm(building);
  const heightMm = Math.round(building.heightMeters * 1_000);
  const result = generateV3FacadePlan(inputFor(outer, heightMm, building.canonicalBuildingId, grammar), grammar);
  if (!result.ok) throw new Error(`V3 plan refused for ${building.canonicalBuildingId}: ${stableSerialize(result.issues)}`);
  return result.value;
}

const SQUARE: Point2Mm[] = [[0, 0], [30_000, 0], [30_000, 30_000], [0, 30_000]];
function lowRisePlan(heightMm: number, grammar: V3GrammarOptions): V3Plan {
  const options = { lowRiseFloorHeight: true, ...grammar };
  const result = generateV3FacadePlan(inputFor(SQUARE, heightMm, "doitt:low-rise", options), options);
  if (!result.ok) throw new Error(`low-rise plan refused: ${stableSerialize(result.issues)}`);
  return result.value;
}

const kindsOf = (plan: V3Plan): string[] => plan.prisms.map((prism) => prism.kind);
const crownTopMm = (plan: V3Plan): number => plan.tiers[plan.tiers.length - 1]!.topZMm;
const clusterTopMm = (plan: V3Plan): number => Math.max(crownTopMm(plan), ...plan.prisms.map((prism) => prism.topZMm));

describe("the grammar-options seam leaves the shipped grammar byte-identical", () => {
  it("produces the same plan bytes for every Block 835 footprint whether the rooftop rules are omitted or explicitly off", () => {
    for (const building of buildings) {
      const omitted = planFor(building, {});
      const explicitlyOff = planFor(building, { rooftopGroupContainment: false, rooftopClusterHeightClamp: false });
      expect(stableSerialize(explicitlyOff)).toBe(stableSerialize(omitted));
      // The plan hash is the release-facing consequence, so it is asserted
      // separately rather than left implicit in the serialization.
      expect(explicitlyOff.planHashSha256).toBe(omitted.planHashSha256);
    }
  });

  it("names the shipped grammar by value, so `differs` is a comparison rather than a memory of four defaults", () => {
    expect(v3EffectiveGrammarOptions(undefined)).toEqual(V3_SHIPPED_GRAMMAR_OPTIONS);
    expect(v3EffectiveGrammarOptions({})).toEqual(V3_SHIPPED_GRAMMAR_OPTIONS);
    expect(v3GrammarOptionsDifferFromShipped(undefined)).toBe(false);
    expect(v3GrammarOptionsDifferFromShipped({ rooftopGroupContainment: false })).toBe(false);
    expect(v3GrammarOptionsDifferFromShipped({ rooftopGroupContainment: true })).toBe(true);
    expect(v3GrammarOptionsDifferFromShipped({ rooftopClusterHeightClamp: true })).toBe(true);
    expect(v3GrammarOptionsDifferFromShipped(V3_ROOFTOP_HONESTY_OPTIONS)).toBe(true);
  });

  it("moves the shipped bytes for at least one real footprint once the rules are on, so the seam is live rather than inert", () => {
    const moved = buildings.filter((building) =>
      stableSerialize(planFor(building, V3_ROOFTOP_HONESTY_OPTIONS)) !== stableSerialize(planFor(building, {})));
    expect(moved.length).toBeGreaterThan(0);
  });
});

describe("the plan validator re-derives under the SAME grammar state", () => {
  it("accepts a rooftop-rule plan under its own options and refuses it under the shipped ones", () => {
    const building = buildings.find((candidate) => candidate.canonicalBuildingId === "doitt:498980")!;
    const successor = planFor(building, V3_ROOFTOP_HONESTY_OPTIONS);
    expect(validateV3Plan(successor, V3_ROOFTOP_HONESTY_OPTIONS).ok).toBe(true);
    // Without the threading this would pass, and a successor plan would be
    // validated against a canonical form nobody generated.
    const underShipped = validateV3Plan(successor, {});
    expect(underShipped.ok).toBe(false);
    expect(underShipped.ok === false && underShipped.issues.some((issue) => issue.path === "$")).toBe(true);
  });

  it("serializes a successor plan when the envelope is threaded, and refuses it when it is not", () => {
    const building = buildings.find((candidate) => candidate.canonicalBuildingId === "doitt:498980")!;
    const successor = planFor(building, V3_ROOFTOP_HONESTY_OPTIONS);
    expect(serializeV3Plan(successor, V3_ROOFTOP_HONESTY_OPTIONS).ok).toBe(true);
    expect(serializeV3Plan(successor).ok).toBe(false);
  });
});

describe("rule 1: a water-tank leg cannot outlive the tank it carries", () => {
  /**
   * MEASURED, not assumed. Four of the fourteen real Block 835 footprints ship a
   * rooftop cluster whose tank was dropped by the containment filter while its
   * legs survived — 28.6%, in the band the T003/T004 reviewer measured over the
   * shipped city (~26-30%).
   */
  it("reproduces the shipped orphan-leg defect on the real footprints", () => {
    const orphaned = buildings.filter((building) => {
      const kinds = kindsOf(planFor(building, {}));
      return !kinds.includes("water-tank") && kinds.includes("water-tank-leg");
    });
    expect(orphaned.map((building) => building.canonicalBuildingId).sort()).toEqual([
      "doitt:102705", "doitt:498980", "doitt:835659", "doitt:982383",
    ]);
  });

  it("drops the legs with the tank, and leaves a contained tank's legs alone", () => {
    let tankDroppedCases = 0;
    let tankKeptCases = 0;
    for (const building of buildings) {
      const fixed = planFor(building, { rooftopGroupContainment: true });
      const kinds = kindsOf(fixed);
      const legCount = kinds.filter((kind) => kind === "water-tank-leg").length;
      if (kinds.includes("water-tank")) {
        tankKeptCases += 1;
        // The legs sit inside the tank's own footprint, so a contained tank
        // always keeps all four. Anything less would mean the rule had started
        // dropping geometry it was never asked to touch.
        expect(legCount).toBe(4);
      } else {
        tankDroppedCases += 1;
        expect(legCount).toBe(0);
      }
    }
    expect(tankKeptCases).toBeGreaterThan(0);
    expect(tankDroppedCases).toBeGreaterThan(0);
  });

  it("leaves the tankless buildings carrying nothing but the roof-equipment box", () => {
    for (const id of ["doitt:498980", "doitt:835659"]) {
      const building = buildings.find((candidate) => candidate.canonicalBuildingId === id)!;
      expect(kindsOf(planFor(building, {}))).toEqual(["roof-equipment", "water-tank-leg", "water-tank-leg", "water-tank-leg"]);
      expect(kindsOf(planFor(building, { rooftopGroupContainment: true }))).toEqual(["roof-equipment"]);
    }
  });
});

describe("rule 2: the rooftop cluster tops out one nominal storey above the crown", () => {
  it("bounds a 305 mm building's cluster, which the shipped grammar tops out at 18.7x its own height", () => {
    const unclamped = lowRisePlan(305, {});
    const clamped = lowRisePlan(305, { rooftopClusterHeightClamp: true });
    // The defect, restated as a number: 5,400 mm of designed rooftop on a
    // 305 mm sourced building.
    expect(clusterTopMm(unclamped) - crownTopMm(unclamped)).toBe(5_400);
    expect(clusterTopMm(clamped) - crownTopMm(clamped)).toBeLessThanOrEqual(V3_NOMINAL_FLOOR_HEIGHT_MM);
    expect(clusterTopMm(clamped)).toBeLessThanOrEqual(crownTopMm(clamped) + V3_NOMINAL_FLOOR_HEIGHT_MM);
  });

  it("holds the bound across the whole low-rise band and on every real footprint", () => {
    for (const heightMm of [1, 305, 999, 2_400, 3_599]) {
      const clamped = lowRisePlan(heightMm, { rooftopClusterHeightClamp: true });
      expect(clusterTopMm(clamped) - crownTopMm(clamped)).toBeLessThanOrEqual(V3_NOMINAL_FLOOR_HEIGHT_MM);
    }
    for (const building of buildings) {
      const clamped = planFor(building, { rooftopClusterHeightClamp: true });
      expect(clusterTopMm(clamped) - crownTopMm(clamped)).toBeLessThanOrEqual(V3_NOMINAL_FLOOR_HEIGHT_MM);
    }
  });

  /**
   * MEASURED, and it corrects the obvious guess. The clamp is NOT monotone in
   * the observed cluster top, because the cluster has one scale and that scale
   * also sets the cluster's FOOTPRINT: shrinking it can bring a tank that the
   * parapet was clipping back inside the crown, and a building that shipped
   * three orphan legs 2,304 mm tall then carries a complete tank 3,596 mm tall.
   *
   * That is a taller cluster and a truer one, and it is recorded here as a
   * number rather than described in a comment, because "the clamp only ever
   * lowers things" is the kind of claim a reader would otherwise assume.
   */
  it("can RAISE an observed cluster top, by admitting a tank the parapet was clipping", () => {
    const raised: string[] = [];
    for (const building of buildings) {
      const shipped = planFor(building, {});
      const clamped = planFor(building, { rooftopClusterHeightClamp: true });
      const shippedAbove = clusterTopMm(shipped) - crownTopMm(shipped);
      const clampedAbove = clusterTopMm(clamped) - crownTopMm(clamped);
      // The bound holds unconditionally; only the DIRECTION of the change does not.
      expect(clampedAbove).toBeLessThanOrEqual(V3_NOMINAL_FLOOR_HEIGHT_MM);
      if (clampedAbove > shippedAbove) {
        raised.push(building.canonicalBuildingId);
        // Every such case is a building whose shipped cluster was incomplete.
        expect(kindsOf(shipped)).not.toContain("water-tank");
        expect(kindsOf(clamped)).toContain("water-tank");
      }
    }
    expect(raised.sort()).toEqual(["doitt:102705", "doitt:982383"]);
  });
});
