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
  tessellateV3Plan,
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

/**
 * (T004 F2) THE RASTER CROSS-CHECK, COMMITTED AS A TEST RATHER THAN AS PROSE.
 *
 * The Blender comparison above validates the metric against a DIFFERENT
 * measurement of the same thing. This validates the ARGUMENT that makes the
 * exact method legitimate at all: that the silhouette of a V3 plan is exactly
 * the union of its solid parts' projected rectangles.
 *
 * It is an independent path in every respect that matters. The analytic
 * instrument reads the plan's SOLID PARTS — tiers, prisms, placement boxes —
 * and never touches a triangle. This rasterizes the REAL EMITTED TESSELLATION,
 * the same `tessellateV3Plan` output the GLB writer consumes, through a plain
 * point-in-triangle scan on a fixed grid. If the "every part projects to an
 * axis-aligned rectangle" reasoning were wrong — if a recess did punch through
 * a wall, if an attachment's projected footprint were not the interval of its
 * eight corners, if a horizontal deck contributed area — the two would part
 * company here.
 *
 * The bound is set by the RASTER's own quantization, not by the exact method's:
 * a 1,024-pixel grid resolves an edge to about 1/1,024 of the frame, so a
 * difference of that order is the instrument being read, not a disagreement.
 * This claim was previously carried only in the Stage-0 implementation record,
 * which is exactly the position the reviewer flagged: an argument nobody replays
 * is an argument nobody checks.
 */
describe("(T004) the exact metric agrees with an independent rasterization of the emitted tessellation", () => {
  /**
   * The horizontal screen axis per view, restated rather than imported.
   *
   * A cross-check that imported the instrument's own constant would agree with
   * it by construction on the one thing a wrong axis would break.
   */
  const RASTER_VIEW_AXIS: Record<string, readonly [number, number]> = {
    "view:east": [0, 1],
    "view:north": [-1, 0],
    "view:south": [1, 0],
    "view:west": [0, -1],
  };
  const RESOLUTION = 1_024;

  /** Every emitted triangle of one tessellation, projected into (u, z). */
  function projectedTriangles(plan: V3Plan, includeRecesses: boolean, axis: readonly [number, number]): Float64Array {
    const tessellation = tessellateV3Plan(plan, { includeRecesses });
    const out: number[] = [];
    const push = (a: readonly number[], b: readonly number[], c: readonly number[]): void => {
      out.push(
        a[0]! * axis[0] + a[1]! * axis[1], a[2]!,
        b[0]! * axis[0] + b[1]! * axis[1], b[2]!,
        c[0]! * axis[0] + c[1]! * axis[1], c[2]!,
      );
    };
    for (const quad of tessellation.quads) {
      push(quad.corners[0], quad.corners[1], quad.corners[2]);
      push(quad.corners[0], quad.corners[2], quad.corners[3]);
    }
    for (const triangle of tessellation.triangles) push(triangle.a, triangle.b, triangle.c);
    return Float64Array.from(out);
  }

  function rasterize(triangles: Float64Array, box: { uMin: number; uMax: number; zMin: number; zMax: number }, mask: Uint8Array): void {
    const du = (box.uMax - box.uMin) / RESOLUTION;
    const dz = (box.zMax - box.zMin) / RESOLUTION;
    for (let offset = 0; offset < triangles.length; offset += 6) {
      const ux = triangles[offset]!; const zx = triangles[offset + 1]!;
      const uy = triangles[offset + 2]!; const zy = triangles[offset + 3]!;
      const uz = triangles[offset + 4]!; const zz = triangles[offset + 5]!;
      const twiceArea = (uy - ux) * (zz - zx) - (uz - ux) * (zy - zx);
      // A horizontal cap, deck or prism lid projects to a segment and casts no
      // shadow. Skipping it is the RASTER's own statement of that, not the
      // analytic instrument's assumption imported.
      if (twiceArea === 0) continue;
      const inverse = 1 / twiceArea;
      const columnLow = Math.max(0, Math.floor((Math.min(ux, uy, uz) - box.uMin) / du));
      const columnHigh = Math.min(RESOLUTION - 1, Math.ceil((Math.max(ux, uy, uz) - box.uMin) / du));
      const rowLow = Math.max(0, Math.floor((Math.min(zx, zy, zz) - box.zMin) / dz));
      const rowHigh = Math.min(RESOLUTION - 1, Math.ceil((Math.max(zx, zy, zz) - box.zMin) / dz));
      for (let column = columnLow; column <= columnHigh; column += 1) {
        const u = box.uMin + (column + 0.5) * du;
        for (let row = rowLow; row <= rowHigh; row += 1) {
          const index = row * RESOLUTION + column;
          if (mask[index] === 1) continue;
          const z = box.zMin + (row + 0.5) * dz;
          const alpha = ((uy - u) * (zz - z) - (uz - u) * (zy - z)) * inverse;
          if (alpha < 0 || alpha > 1) continue;
          const beta = ((uz - u) * (zx - z) - (ux - u) * (zz - z)) * inverse;
          if (beta < 0 || beta > 1) continue;
          const gamma = 1 - alpha - beta;
          if (gamma < 0 || gamma > 1) continue;
          mask[index] = 1;
        }
      }
    }
  }

  function rasterDeviationRatio(plan: V3Plan, viewId: string): number {
    const axis = RASTER_VIEW_AXIS[viewId]!;
    const fine = projectedTriangles(plan, true, axis);
    const coarse = projectedTriangles(plan, false, axis);
    let uMin = Number.POSITIVE_INFINITY; let uMax = Number.NEGATIVE_INFINITY;
    let zMin = Number.POSITIVE_INFINITY; let zMax = Number.NEGATIVE_INFINITY;
    for (const source of [fine, coarse]) {
      for (let offset = 0; offset < source.length; offset += 2) {
        const u = source[offset]!; const z = source[offset + 1]!;
        if (u < uMin) uMin = u; if (u > uMax) uMax = u;
        if (z < zMin) zMin = z; if (z > zMax) zMax = z;
      }
    }
    // One pixel of slack on every side, so no edge lands exactly on the frame.
    const box = {
      uMin: uMin - (uMax - uMin) / RESOLUTION, uMax: uMax + (uMax - uMin) / RESOLUTION,
      zMin: zMin - (zMax - zMin) / RESOLUTION, zMax: zMax + (zMax - zMin) / RESOLUTION,
    };
    const fineMask = new Uint8Array(RESOLUTION * RESOLUTION);
    const coarseMask = new Uint8Array(RESOLUTION * RESOLUTION);
    rasterize(fine, box, fineMask);
    rasterize(coarse, box, coarseMask);
    let fineCount = 0;
    let symmetricDifference = 0;
    for (let index = 0; index < fineMask.length; index += 1) {
      if (fineMask[index] === 1) fineCount += 1;
      if (fineMask[index] !== coarseMask[index]) symmetricDifference += 1;
    }
    return fineCount === 0 ? Number.POSITIVE_INFINITY : symmetricDifference / fineCount;
  }

  it("agrees with the rasterized emitted tessellation on all fourteen Block 835 buildings, at every view", () => {
    let worstAbsoluteDifference = 0;
    let maxExact = 0;
    let comparisons = 0;
    for (const building of buildings) {
      const plan = planFor(building, V3_ROOFTOP_HONESTY_OPTIONS);
      const exact = midtownCoreV3SilhouetteMeasurement(plan);
      for (const view of exact.perView) {
        maxExact = Math.max(maxExact, view.deviationRatio);
        worstAbsoluteDifference = Math.max(worstAbsoluteDifference, Math.abs(rasterDeviationRatio(plan, view.viewId) - view.deviationRatio));
        comparisons += 1;
      }
    }
    // Not a vacuous pass: fourteen buildings at four views each.
    expect(comparisons).toBe(buildings.length * 4);
    expect(buildings).toHaveLength(14);
    // AND NOT A VACUOUS AGREEMENT ON ZEROS. The largest per-view deviation over
    // the fourteen is 1.8895e-3, so the two instruments are agreeing on a real
    // quantity roughly thirty times the difference between them.
    expect(maxExact).toBeGreaterThan(1e-3);
    // MEASURED at 5.681e-5 on a 1,024-pixel grid — the RASTER's own edge
    // quantization rather than a disagreement. A 1,024-pixel frame resolves an
    // edge to about 1e-3 of its width and the two silhouettes being differenced
    // agree everywhere but a thin band, so a difference of this order is what a
    // correct rasterization of a correct union looks like. Bounded at 1e-4,
    // which is still 200x inside the 0.02 cap the number is compared against.
    expect(worstAbsoluteDifference).toBeLessThan(1e-4);
  });

});
