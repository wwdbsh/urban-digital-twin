/**
 * The wave silhouette instrument, measured against the shape it has to agree
 * with: the multi-LOD assembly schema's own gate.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import releaseJson from "../../public/data/manhattan-esb-block-exterior-pilot-20260805/release.json";
import {
  V3_ROOFTOP_HONESTY_OPTIONS,
  deriveV3Parameters,
  generateV3FacadePlan,
  ringSignedAreaMm2,
  type Point2Mm,
  type V3GrammarOptions,
  type V3Plan,
} from "../domain/deterministic-facade-generator-v3.ts";
import { stableSerialize } from "../domain/deterministic-hash.ts";
import { enuFrame, readPilotBuildings, toEnuMeters, type PilotBuildingSource, type SilhouetteMeasurementFile } from "./block835-reference-package.ts";
import { buildV3Plan } from "./block835-v3-package.ts";
import {
  MIDTOWN_CORE_V3_SILHOUETTE_MAXIMUM_RATIO,
  MIDTOWN_CORE_V3_SILHOUETTE_VIEW_IDS,
  midtownCoreV3SilhouetteMeasurement,
  midtownCoreV3SilhouetteRecord,
  rectangleUnionAreaMm2,
} from "./midtown-core-v3-silhouette.ts";

const buildings = readPilotBuildings(releaseJson as unknown);

function footprintMm(building: PilotBuildingSource): Point2Mm[] {
  const frame = enuFrame(building.anchor);
  const ring = building.footprint.map((point) => {
    const [east, north] = toEnuMeters(frame, point);
    return [Math.round(east * 1_000), Math.round(north * 1_000)] as Point2Mm;
  });
  return ringSignedAreaMm2(ring) < 0 ? [...ring].reverse() : ring;
}

function planFor(building: PilotBuildingSource, grammar: V3GrammarOptions = {}): V3Plan {
  const outer = footprintMm(building);
  const heightMm = Math.round(building.heightMeters * 1_000);
  const result = generateV3FacadePlan({
    schemaVersion: "3.0",
    buildingId: building.canonicalBuildingId,
    generatedAt: "2026-08-11T00:00:00.000Z",
    seed: "block-835-reference-v3",
    tool: { id: "urban-digital-twin:block835-v3", version: "3.0.0" },
    geometry: { unit: "millimeter", footprint: { outer }, baseElevationMm: 0, heightMm },
    sourceAnchors: [
      { id: "anchor:footprint", kind: "footprint", sourceRefId: "source-ref:jh45-qr5r", fingerprintSha256: "a".repeat(64) },
      { id: "anchor:height", kind: "height", sourceRefId: "source-ref:oti-height", fingerprintSha256: "b".repeat(64) },
    ],
    parameters: deriveV3Parameters({ footprintOuterMm: outer, heightMm }, grammar),
  }, grammar);
  if (!result.ok) throw new Error(`refused: ${stableSerialize(result.issues)}`);
  return result.value;
}

/**
 * A plan-shaped value carrying only what the instrument reads.
 *
 * The same device `citywide-overview-tier-candidates.test.ts` uses, for the same
 * reason: the metric is a function of a few solid parts, and a degraded coarse
 * level has to be constructible without a grammar that would refuse to build it.
 */
function syntheticPlan(options: {
  heightMm: number;
  halfMm: number;
  attachmentDepthMm: number;
  attachmentHeightMm: number;
}): V3Plan {
  const { halfMm, heightMm } = options;
  const ring: Point2Mm[] = [[-halfMm, -halfMm], [halfMm, -halfMm], [halfMm, halfMm], [-halfMm, halfMm]];
  return {
    buildingId: "doitt:synthetic",
    planHashSha256: "1".repeat(64),
    tiers: [{ index: 0, ring, baseZMm: 0, topZMm: heightMm }],
    prisms: [],
    surfaces: [{
      id: "surface:facade:0:0",
      kind: "facade",
      startMm: [-halfMm, -halfMm] as Point2Mm,
      endMm: [halfMm, -halfMm] as Point2Mm,
      uLengthMm: 2 * halfMm,
      baseZMm: 0,
      vLengthMm: heightMm,
    }],
    placements: [{
      id: "placement:balcony:0:0:1:0",
      kind: "balcony",
      surfaceId: "surface:facade:0:0",
      bounds: { uMinMm: 0, vMinMm: 0, uMaxMm: 2 * halfMm, vMaxMm: options.attachmentHeightMm },
      depthMm: options.attachmentDepthMm,
    }],
  } as unknown as V3Plan;
}

describe("the exact rectangle-union area", () => {
  it("adds disjoint rectangles and never double counts overlapping ones", () => {
    expect(rectangleUnionAreaMm2([{ uMinMm: 0, uMaxMm: 10, zMinMm: 0, zMaxMm: 10 }])).toBe(100);
    expect(rectangleUnionAreaMm2([
      { uMinMm: 0, uMaxMm: 10, zMinMm: 0, zMaxMm: 10 },
      { uMinMm: 20, uMaxMm: 30, zMinMm: 0, zMaxMm: 10 },
    ])).toBe(200);
    // Two 10x10 squares overlapping on a 5x10 strip.
    expect(rectangleUnionAreaMm2([
      { uMinMm: 0, uMaxMm: 10, zMinMm: 0, zMaxMm: 10 },
      { uMinMm: 5, uMaxMm: 15, zMinMm: 0, zMaxMm: 10 },
    ])).toBe(150);
    // Fully contained.
    expect(rectangleUnionAreaMm2([
      { uMinMm: 0, uMaxMm: 10, zMinMm: 0, zMaxMm: 10 },
      { uMinMm: 2, uMaxMm: 4, zMinMm: 2, zMaxMm: 4 },
    ])).toBe(100);
    expect(rectangleUnionAreaMm2([])).toBe(0);
  });
});

describe("the LOD 0 / LOD 1 projected-silhouette measurement", () => {
  it("declares the metric identity the committed Block 835 measurement files declare", () => {
    const measurement = midtownCoreV3SilhouetteMeasurement(planFor(buildings[0]!));
    expect(measurement.method).toBe("projected-silhouette-ratio");
    expect(measurement.metricVersion).toBe("1.0");
    expect(measurement.maximumRatio).toBe(0.02);
    expect([...measurement.viewIds]).toEqual([...MIDTOWN_CORE_V3_SILHOUETTE_VIEW_IDS]);
    expect(measurement.perView).toHaveLength(4);
  });

  it("passes every real Block 835 footprint, under the shipped grammar and under the rooftop rules", () => {
    for (const building of buildings) {
      for (const grammar of [{}, V3_ROOFTOP_HONESTY_OPTIONS]) {
        const measurement = midtownCoreV3SilhouetteMeasurement(planFor(building, grammar));
        expect(measurement.deviationRatio).toBeGreaterThanOrEqual(0);
        expect(measurement.withinBound).toBe(true);
        expect(measurement.deviationRatio).toBeLessThanOrEqual(MIDTOWN_CORE_V3_SILHOUETTE_MAXIMUM_RATIO);
      }
    }
  });

  it("agrees with itself across mirrored views, which is what makes four view ids honest", () => {
    const measurement = midtownCoreV3SilhouetteMeasurement(planFor(buildings[0]!));
    const byView = new Map(measurement.perView.map((view) => [view.viewId, view.deviationRatio]));
    expect(byView.get("view:north")).toBeCloseTo(byView.get("view:south")!, 12);
    expect(byView.get("view:east")).toBeCloseTo(byView.get("view:west")!, 12);
  });

  it("reports zero for a plan whose coarse level drops nothing", () => {
    const measurement = midtownCoreV3SilhouetteMeasurement(
      syntheticPlan({ heightMm: 40_000, halfMm: 10_000, attachmentDepthMm: 0, attachmentHeightMm: 1_100 }),
    );
    expect(measurement.deviationRatio).toBe(0);
    expect(measurement.withinBound).toBe(true);
  });

  it("FAILS the 2% bound for a deliberately degraded coarse level", () => {
    // A 3 m band running the full width of a 6 m square, 40 m-tall building.
    // From the grazing view it adds a 3 m x 3 m rectangle OUTSIDE a 6 m x 40 m
    // silhouette: 9 m^2 over 249 m^2, or 3.6145%. Pinned to that number rather
    // than to "over the cap", so the instrument is asserted to be measuring the
    // right area and not merely producing a large one. From the perpendicular
    // view the same band is entirely inside the silhouette and reads zero,
    // which is why the WORST view is the one reported.
    const degraded = syntheticPlan({ heightMm: 40_000, halfMm: 3_000, attachmentDepthMm: 3_000, attachmentHeightMm: 3_000 });
    const measurement = midtownCoreV3SilhouetteMeasurement(degraded);
    expect(measurement.deviationRatio).toBeCloseTo(9 / 249, 12);
    expect(measurement.worstViewId).toBe("view:east");
    expect(measurement.perView.find((view) => view.viewId === "view:north")!.deviationRatio).toBe(0);
    expect(measurement.deviationRatio).toBeGreaterThan(MIDTOWN_CORE_V3_SILHOUETTE_MAXIMUM_RATIO);
    expect(measurement.withinBound).toBe(false);
    expect(() => midtownCoreV3SilhouetteRecord(degraded, { expectedPlanHashSha256: degraded.planHashSha256 }))
      .toThrow(/outside the approved 0\.02 bound/u);
  });
});

/**
 * THE CROSS-CHECK THAT MAKES THE INSTRUMENT USABLE.
 *
 * The wave measurement is computed; the fourteen committed Block 835
 * measurements were RENDERED, in Blender, through a different tessellator, on a
 * different machine, by a hand-run authoring pass. If the two agree on the only
 * fourteen buildings where both exist, then the computed number is the same
 * quantity the approved 2% contract was written about — and if they did not, no
 * amount of internal consistency would make it so.
 *
 * The comparison is against the SHIPPED grammar through the Block 835 package's
 * own plan entrypoint, so it is the same plan on both sides.
 */
describe("the computed metric agrees with the committed Blender measurements", () => {
  it("matches all fourteen to well inside the 2% cap", () => {
    const measurements = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(readFileSync("data/manhattan-esb-block-reference-20260811-v3/silhouette-measurements.json")),
    ) as SilhouetteMeasurementFile;
    expect(measurements.method).toBe("projected-silhouette-ratio");
    expect(measurements.metricVersion).toBe("1.0");
    expect(measurements.buildings).toHaveLength(14);
    let worstAbsoluteDifference = 0;
    for (const entry of measurements.buildings) {
      const building = buildings.find((candidate) => candidate.canonicalBuildingId === entry.canonicalBuildingId)!;
      const { plan } = buildV3Plan(building);
      // Same plan on both sides, asserted rather than assumed.
      expect(plan.planHashSha256).toBe(entry.planHashSha256);
      const computed = midtownCoreV3SilhouetteMeasurement(plan);
      worstAbsoluteDifference = Math.max(worstAbsoluteDifference, Math.abs(computed.deviationRatio - entry.deviationRatio));
    }
    // MEASURED: 2.027e-4, on doitt:498980 — about 1% of the cap. The bound is
    // set at 2.5% of the cap: tight enough that a systematic disagreement
    // between the computed and rendered metrics would fail it, loose enough not
    // to fail on the rendered side's own pixel quantization.
    expect(worstAbsoluteDifference).toBeLessThan(MIDTOWN_CORE_V3_SILHOUETTE_MAXIMUM_RATIO / 40);
    // And the agreement is not merely "inside a loose bound": state the order.
    expect(worstAbsoluteDifference).toBeLessThan(2.5e-4);
  });
});

describe("the record the assembly schema demands", () => {
  it("carries exactly the schema's key set, bound to the plan hash", () => {
    const plan = planFor(buildings[0]!);
    const record = midtownCoreV3SilhouetteRecord(plan, { expectedPlanHashSha256: plan.planHashSha256 });
    expect(Object.keys(record).sort()).toEqual([
      "deviationRatio", "maximumRatio", "method", "metricVersion", "planHashSha256", "status", "viewIds",
    ]);
    expect(record.status).toBe("authoring-declared");
    expect(record.planHashSha256).toBe(plan.planHashSha256);
    expect(record.deviationRatio).toBeLessThanOrEqual(0.02);
  });

  it("REFUSES a measurement bound to a different plan hash", () => {
    const plan = planFor(buildings[0]!);
    expect(() => midtownCoreV3SilhouetteRecord(plan, { expectedPlanHashSha256: "f".repeat(64) }))
      .toThrow(/would bind plan hash/u);
  });

  it("binds the ROOFTOP-RULE plan's hash, not the shipped plan's, for the same building", () => {
    const building = buildings.find((candidate) => candidate.canonicalBuildingId === "doitt:498980")!;
    const shipped = planFor(building);
    const successor = planFor(building, V3_ROOFTOP_HONESTY_OPTIONS);
    expect(successor.planHashSha256).not.toBe(shipped.planHashSha256);
    expect(() => midtownCoreV3SilhouetteRecord(successor, { expectedPlanHashSha256: shipped.planHashSha256 }))
      .toThrow(/would bind plan hash/u);
  });
});
