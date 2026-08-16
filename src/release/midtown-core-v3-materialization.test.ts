/**
 * V3 midtown-core materializer.
 *
 * Everything here is synthetic and runs on a fresh clone with no payload
 * directory: the sourced rings are built in this file, so the grammar's
 * behaviour on a real polygon is exercised without depending on the untracked
 * citywide snapshot. The wave-scale census that DOES depend on it is committed
 * under `data/midtown-core-20260811-v3/` and checked by the release test.
 */
import { describe, expect, it } from "vitest";

import {
  DETERMINISTIC_FACADE_V3_UNCERTAINTY,
  V3_ROOFTOP_HONESTY_OPTIONS,
  V3_SHIPPED_GRAMMAR_OPTIONS,
} from "../domain/deterministic-facade-generator-v3.ts";
import { V3_QUALITY_BUDGETS, v3GeometryForGlb } from "./block835-v3-package.ts";
import { tessellateV3Plan } from "../domain/deterministic-facade-generator-v3.ts";
import { MIDTOWN_CORE_RELEASE_ID } from "./midtown-core-package.ts";
import type { MidtownCoreBuildingSource } from "./midtown-core-materialization.ts";
import {
  MIDTOWN_CORE_V3_LOD_IDS,
  MIDTOWN_CORE_V3_PREDECESSOR_RELEASE_ID,
  MIDTOWN_CORE_V3_RELEASE_ID,
  MIDTOWN_CORE_V3_SEED,
  MIDTOWN_CORE_V3_STOP_CODES,
  MIDTOWN_CORE_V3_UNCERTAINTY,
  MIDTOWN_CORE_V3_VOLUME_TOLERANCE,
  MIDTOWN_CORE_V3_WAVE_PROFILE,
  MidtownCoreV3Stop,
  buildMidtownCoreV3Plan,
  classifyMidtownCoreV3Generation,
  classifyMidtownCoreV3Ring,
  midtownCoreV3AnalyticVolumeCubicMeters,
  midtownCoreV3AssetRef,
  midtownCoreV3EvidenceShardId,
  midtownCoreV3InventoryId,
  midtownCoreV3MeshVolumeCubicMeters,
  writeMidtownCoreV3Assets,
} from "./midtown-core-v3-materialization.ts";

const BASE_MANIFEST = "b".repeat(64);
const ANCHOR: [number, number] = [-73.9857, 40.7484];
/**
 * A SUCCESSOR envelope: one that differs from the shipped grammar.
 *
 * The two rooftop rules rather than the T003 admission envelope, deliberately.
 * What the cross-check is about is a plan and a profile disagreeing about ANY
 * envelope, the admission half is pinned inert by the domain suite's own
 * reference guard, and naming it here would make this file an exception to that
 * guard for no gain.
 */
const SUCCESSOR_GRAMMAR = { ...V3_ROOFTOP_HONESTY_OPTIONS };

/** Metres east/north of the anchor, converted to WGS84 degrees. */
function offsetDegrees(eastMeters: number, northMeters: number): [number, number] {
  const latitudeRadians = (ANCHOR[1] * Math.PI) / 180;
  return [
    ANCHOR[0] + eastMeters / (111_320 * Math.cos(latitudeRadians)),
    ANCHOR[1] + northMeters / 110_540,
  ];
}

function source(options: {
  buildingId?: string;
  ringMeters: ReadonlyArray<readonly [number, number]>;
  heightMeters?: number | null;
  heightUnknown?: boolean;
}): MidtownCoreBuildingSource {
  const ring = options.ringMeters.map(([east, north]) => offsetDegrees(east, north));
  return {
    buildingId: options.buildingId ?? "doitt:900001",
    representative: ANCHOR,
    outerRing: [...ring, ring[0]!],
    heightMeters: options.heightMeters === undefined ? 48 : options.heightMeters,
    heightUnknown: options.heightUnknown ?? false,
    sourceRefId: "source-ref:nyc.building-footprints:900001",
    sourceRecordId: "900001",
  };
}

/** An L-shaped footprint: concave, so no oriented rectangle could describe it. */
const L_SHAPE: ReadonlyArray<readonly [number, number]> = [
  [-18, -14], [16, -14], [16, 2], [2, 2], [2, 16], [-18, 16],
];

describe("midtown-core V3 identity", () => {
  it("is a successor release that never collides with the wave it supersedes", () => {
    expect(MIDTOWN_CORE_V3_RELEASE_ID).toBe("manhattan-midtown-core-cells-20260811-v3");
    expect(MIDTOWN_CORE_V3_PREDECESSOR_RELEASE_ID).toBe(MIDTOWN_CORE_RELEASE_ID);
    expect(MIDTOWN_CORE_V3_RELEASE_ID).not.toBe(MIDTOWN_CORE_RELEASE_ID);
    expect(midtownCoreV3InventoryId("doitt:1")).toBe(`inventory:${MIDTOWN_CORE_V3_RELEASE_ID}:doitt:1`);
    expect(midtownCoreV3EvidenceShardId("doitt:1")).toBe(`evidence-shard:${MIDTOWN_CORE_V3_RELEASE_ID}:doitt:1`);
    // The asset path is the only id shared with V2 by design: the two waves live
    // in different payload directories, so the same relative ref inside each is
    // unambiguous and keeps the runtime's URL derivation unchanged.
    expect(midtownCoreV3AssetRef("doitt:1", "lod_0")).toBe("public/assets/doitt-1__lod_0.glb");
    // A distinct seed, so no V3 plan hash can collide with a V2 one.
    expect(MIDTOWN_CORE_V3_SEED).toBe("manhattan-midtown-core-20260811-v3");
    expect(MIDTOWN_CORE_V3_UNCERTAINTY).toBe(DETERMINISTIC_FACADE_V3_UNCERTAINTY);
  });
});

describe("midtown-core V3 refusal classification", () => {
  it("names each of the generator's own ring-admission rules", () => {
    expect(classifyMidtownCoreV3Ring([[0, 0], [0, 0], [0, 0]])).toBe("degenerate-footprint");
    const many: [number, number][] = [];
    for (let index = 0; index < 80; index += 1) {
      const angle = (2 * Math.PI * index) / 80;
      many.push([Math.round(30_000 * Math.cos(angle)), Math.round(30_000 * Math.sin(angle))]);
    }
    expect(classifyMidtownCoreV3Ring(many)).toBe("ring-vertex-count-unsupported");
    // Bow tie: simple-ring test must reject it before the area floor is reached.
    expect(classifyMidtownCoreV3Ring([[0, 0], [10_000, 10_000], [10_000, 0], [0, 10_000]])).toBe("ring-not-simple");
    expect(classifyMidtownCoreV3Ring([[0, 0], [1_000, 0], [1_000, 1_000], [0, 1_000]])).toBe("ring-area-below-floor");
    expect(classifyMidtownCoreV3Ring([[0, 0], [20_000, 0], [20_000, 20_000], [0, 20_000]])).toBeNull();
  });

  it("classifies a generation refusal on the generator's issue PATHS, not its wording", () => {
    const admissible: [number, number][] = [[0, 0], [20_000, 0], [20_000, 20_000], [0, 20_000]];
    expect(classifyMidtownCoreV3Generation(admissible, [{ path: "geometry.heightMm", message: "anything at all" }]))
      .toBe("source-height-below-grammar-minimum");
    expect(classifyMidtownCoreV3Generation(admissible, [{ path: "geometry.footprint.outer", message: "anything at all" }]))
      .toBe("ring-neck-below-grammar-minimum");
    expect(classifyMidtownCoreV3Generation(admissible, [{ path: "parameters.tierCount", message: "x" }]))
      .toBe("plan-generation-failed");
    // A ring that fails admission is named by the admission rule even when the
    // generator also complains about something later.
    expect(classifyMidtownCoreV3Generation([[0, 0], [1_000, 0], [1_000, 1_000], [0, 1_000]], [{ path: "geometry.heightMm", message: "x" }]))
      .toBe("ring-area-below-floor");
  });

  it("refuses a real sourced polygon rather than repairing it, with a closed stop code", () => {
    // 2.4 m of sourced height: below one floor of the requested floor height.
    let stop: MidtownCoreV3Stop | null = null;
    try {
      buildMidtownCoreV3Plan(source({ ringMeters: L_SHAPE, heightMeters: 2.4 }), BASE_MANIFEST);
    } catch (error) {
      stop = error as MidtownCoreV3Stop;
    }
    expect(stop).toBeInstanceOf(MidtownCoreV3Stop);
    expect(stop!.code).toBe("source-height-below-grammar-minimum");
    expect(MIDTOWN_CORE_V3_STOP_CODES).toContain(stop!.code);
    expect(stop!.message).toContain("doitt:900001");
  });
});

describe("midtown-core V3 plans over the real sourced ring", () => {
  it("carries the sourced polygon vertex for vertex instead of a bounding rectangle", () => {
    const context = buildMidtownCoreV3Plan(source({ ringMeters: L_SHAPE }), BASE_MANIFEST);
    // Six vertices survive: a V2 oriented rectangle would have collapsed them to
    // four and drawn a solid box over the notch.
    expect(context.ringMm).toHaveLength(6);
    expect(context.plan.tiers[0]!.ring).toHaveLength(6);
    expect(context.plan.schemaVersion).toBe("3.0");
    expect(context.plan.buildingId).toBe("doitt:900001");
    expect(context.plan.uncertainty).toBe(MIDTOWN_CORE_V3_UNCERTAINTY);
    // No cited facade fact exists for any Midtown building, so no plan of this
    // wave may carry a style override.
    expect(context.plan.input.styleOverride).toBeUndefined();
  });

  it("binds both source anchors to the pinned base manifest", () => {
    const first = buildMidtownCoreV3Plan(source({ ringMeters: L_SHAPE }), BASE_MANIFEST);
    const other = buildMidtownCoreV3Plan(source({ ringMeters: L_SHAPE }), "c".repeat(64));
    expect(first.plan.anchors.map((anchor) => anchor.fingerprintSha256))
      .not.toEqual(other.plan.anchors.map((anchor) => anchor.fingerprintSha256));
    expect(first.plan.planHashSha256).not.toBe(other.plan.planHashSha256);
  });

  it("discloses a fallback height instead of asserting one", () => {
    const known = buildMidtownCoreV3Plan(source({ ringMeters: L_SHAPE }), BASE_MANIFEST);
    const unknown = buildMidtownCoreV3Plan(source({ ringMeters: L_SHAPE, heightMeters: null }), BASE_MANIFEST);
    expect(known.heightSource).toBe("source");
    expect(unknown.heightSource).toBe("fallback");
    expect(unknown.plan.input.geometry.heightMm).toBe(10_000);
    // The height anchor's fingerprint covers the fallback decision, so a
    // fallback plan can never be mistaken for a sourced-height plan.
    expect(unknown.plan.anchors[1]!.fingerprintSha256).not.toBe(known.plan.anchors[1]!.fingerprintSha256);
  });

  it("is deterministic: the same source produces the same plan hash and the same bytes", () => {
    const write = () => writeMidtownCoreV3Assets(
      buildMidtownCoreV3Plan(source({ ringMeters: L_SHAPE }), BASE_MANIFEST),
      { ownerCellId: "cell:test", capturedAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", predecessor: null },
    );
    const left = write();
    const right = write();
    expect(left.assets.map((asset) => asset.checksumSha256)).toEqual(right.assets.map((asset) => asset.checksumSha256));
    expect(left.assets[0]!.bytes).toEqual(right.assets[0]!.bytes);
  });
});

describe("midtown-core V3 per-asset census gates", () => {
  const context = buildMidtownCoreV3Plan(source({ ringMeters: L_SHAPE }), BASE_MANIFEST);
  const written = writeMidtownCoreV3Assets(context, {
    ownerCellId: "cell:test",
    capturedAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    predecessor: { id: `${MIDTOWN_CORE_RELEASE_ID}:doitt:900001:lod_0`, checksumSha256: "a".repeat(64) },
  });

  it("emits both LODs inside the V3 budgets and ships no imagery", () => {
    expect(written.assets.map((asset) => asset.lodId)).toEqual([...MIDTOWN_CORE_V3_LOD_IDS]);
    for (const asset of written.assets) {
      expect(asset.counts.triangleCount).toBeLessThanOrEqual(V3_QUALITY_BUDGETS.maxTriangles);
      expect(asset.counts.materialCount).toBeLessThanOrEqual(V3_QUALITY_BUDGETS.maxMaterials);
      expect(asset.counts.textureCount).toBe(0);
    }
  });

  it("closes the analytic volume identity on the bytes it just emitted", () => {
    for (const asset of written.assets) {
      expect(asset.meshVolumeCubicMeters).toBeGreaterThan(0);
      expect(asset.volumeDeviation).toBeLessThan(MIDTOWN_CORE_V3_VOLUME_TOLERANCE);
    }
  });

  it("has an identity that DISCRIMINATES: a punctured surface fails it", () => {
    const tessellation = tessellateV3Plan(context.plan, { includeRecesses: true });
    const geometry = v3GeometryForGlb(context.plan, tessellation, { yUp: false });
    const analytic = midtownCoreV3AnalyticVolumeCubicMeters(context.plan, true);
    expect(Math.abs(midtownCoreV3MeshVolumeCubicMeters(geometry) - analytic) / analytic).toBeLessThan(MIDTOWN_CORE_V3_VOLUME_TOLERANCE);
    // Remove one quad: the surface is no longer closed and the identity breaks.
    const punctured = { quads: geometry.quads.slice(1), triangles: geometry.triangles };
    expect(Math.abs(midtownCoreV3MeshVolumeCubicMeters(punctured) - analytic) / analytic)
      .toBeGreaterThan(MIDTOWN_CORE_V3_VOLUME_TOLERANCE);
  });

  it("registers the shipped ring against the SOURCED polygon, vertex for vertex", () => {
    expect(written.registration.withinTolerance).toBe(true);
    expect(written.registration.sourceVertexCount).toBe(6);
    expect(written.registration.ringVertexCount).toBe(6);
    // A millimetre of rounding, not a shape claim: the bound is 50 mm and the
    // measured deviation sits far below it.
    expect(written.registration.perVertexShapeDeviationMeters).toBeLessThan(0.005);
    expect(written.registration.ringVertexPresenceMeters).toBeLessThan(1e-3);
    // This synthetic ring is already counter-clockwise, so nothing is reversed.
    expect(written.registration.ringOrientationReversed).toBe(false);
  });

  it("records the reversal a clockwise sourced ring needs, and lands on the same shape", () => {
    const clockwise = buildMidtownCoreV3Plan(source({ ringMeters: [...L_SHAPE].reverse() }), BASE_MANIFEST);
    expect(clockwise.reversed).toBe(true);
    const writtenClockwise = writeMidtownCoreV3Assets(clockwise, {
      ownerCellId: "cell:test", capturedAt: null, updatedAt: null, predecessor: null,
    });
    expect(writtenClockwise.registration.ringOrientationReversed).toBe(true);
    expect(writtenClockwise.registration.withinTolerance).toBe(true);
    // The reversal is an orientation fix, not a shape change: the shipped ring
    // still measures against the sourced polygon within the pipeline tolerance.
    expect(writtenClockwise.registration.perVertexShapeDeviationMeters).toBeLessThan(0.005);
  });

  it("pins the predecessor asset it supersedes, and states null when there is none", () => {
    const withoutPredecessor = writeMidtownCoreV3Assets(context, {
      ownerCellId: "cell:test", capturedAt: null, updatedAt: null, predecessor: null,
    });
    // Package identity and the predecessor pin both live in the GLB metadata, so
    // the two differ in bytes; the plan hash is unaffected by either.
    expect(withoutPredecessor.assets[0]!.checksumSha256).not.toBe(written.assets[0]!.checksumSha256);
  });
});

describe("midtown-core V3 tier-collapse disclosure", () => {
  it("ships an absent setbacks component with a stated reason rather than inventing one", () => {
    // A short, small footprint: two tiers are requested, the inward offset
    // cannot be taken, and the massing genuinely has no setback.
    const context = buildMidtownCoreV3Plan(source({ ringMeters: [[-3, -3], [3, -3], [3, 3], [-3, 3]], heightMeters: 12 }), BASE_MANIFEST);
    const written = writeMidtownCoreV3Assets(context, {
      ownerCellId: "cell:test", capturedAt: null, updatedAt: null, predecessor: null,
    });
    if (!written.setbacksAbsent) {
      // The grammar carried a setback here after all, which is a legitimate
      // outcome; assert the positive case instead of pretending otherwise.
      expect(context.plan.massing.effectiveTierCount).toBeGreaterThan(1);
      return;
    }
    expect(written.truthTiers).toContain("absent");
    expect(written.setbackDisclosure.trim().length).toBeGreaterThan(0);
    const setbacks = context.plan.inventory.components.find((component) => component.kind === "setbacks")!;
    expect(setbacks.state).toBe("absent");
    expect(setbacks.state === "absent" && setbacks.reason.trim().length).toBeGreaterThan(0);
  });
});

/**
 * (T003) The closed refusal vocabulary is a GOAL-LEVEL contract.
 *
 * `computeCensusClosure` in `scripts/goal-integration-reconciliation-cli.mjs`
 * checks every observed stop code against this array, and the committed
 * goal-integration reconciliation record asserts that no observed code falls
 * outside it. A thirteenth code added here would therefore surface first as a
 * failure of the goal-acceptance suite, which is the wrong place to learn it:
 * that suite is a record of a completed adjudication, not a design review.
 *
 * So the vocabulary is pinned HERE, beside the codes, verbatim and in order. The
 * twelve cover every residual a wider admission envelope can produce — a
 * recovered building that then blows the asset budget is
 * `asset-budget-exceeded`, one whose mesh misses its analytic volume is
 * `volume-identity-failed` — so widening the envelope needs no new code, and
 * anything that seems to need one is a design change rather than a constant.
 */
describe("(T003) the closed stop-code vocabulary", () => {
  it("is exactly these twelve codes, in this order", () => {
    expect(MIDTOWN_CORE_V3_STOP_CODES).toEqual([
      "absent-from-base-shards",
      "degenerate-footprint",
      "ring-vertex-count-unsupported",
      "ring-not-simple",
      "ring-area-below-floor",
      "ring-neck-below-grammar-minimum",
      "source-height-below-grammar-minimum",
      "plan-generation-failed",
      "plan-validation-failed",
      "asset-budget-exceeded",
      "volume-identity-failed",
      "registration-out-of-tolerance",
    ]);
    expect(MIDTOWN_CORE_V3_STOP_CODES).toHaveLength(12);
  });
});

/**
 * (T004 F1) THE PLAN'S ENVELOPE AND THE WAVE'S DECLARED ENVELOPE ARE ONE FACT.
 *
 * Before this cross-check the two were independent and nothing ever compared
 * them: `buildMidtownCoreV3Plan`'s explicit `grammar` argument silently won over
 * `profile.admissionEnvelope`, the plan context carried no record of what it had
 * actually run under, and `writeMidtownCoreV3Assets` accepted whatever profile
 * it was handed. The Stage-0 CLI ran exactly that disagreeing path — planning
 * under the extended envelope plus the two rooftop rules, writing under wave
 * `w01`'s profile, which declares the shipped grammar — so an emitted asset's
 * provenance named an envelope its geometry had not come from.
 *
 * The refusal is a plain `Error` rather than a `MidtownCoreV3Stop` on purpose:
 * a stop code says this grammar cannot carry some property of ONE sourced
 * polygon, and this says the repository is contradicting itself about every
 * building at once.
 */
describe("(T004) grammar agreement between plan and wave profile", () => {
  const options = { ownerCellId: "cell:test", capturedAt: null, updatedAt: null, predecessor: null } as const;

  it("records the EFFECTIVE envelope the plan was materialized under", () => {
    const shipped = buildMidtownCoreV3Plan(source({ ringMeters: L_SHAPE }), BASE_MANIFEST);
    expect(shipped.grammar).toEqual(V3_SHIPPED_GRAMMAR_OPTIONS);
    const extended = buildMidtownCoreV3Plan(source({ ringMeters: L_SHAPE }), BASE_MANIFEST, undefined, SUCCESSOR_GRAMMAR);
    expect(extended.grammar).toEqual({ ...V3_SHIPPED_GRAMMAR_OPTIONS, ...SUCCESSOR_GRAMMAR });
    // Stored EFFECTIVE, so a partially-spelled envelope and a fully-spelled one
    // that mean the same thing are one value rather than two.
    const partial = buildMidtownCoreV3Plan(source({ ringMeters: L_SHAPE }), BASE_MANIFEST, undefined, { lowRiseFloorHeight: false });
    expect(partial.grammar).toEqual(V3_SHIPPED_GRAMMAR_OPTIONS);
  });

  it("REFUSES to write a plan whose envelope disagrees with the profile's", () => {
    const extended = buildMidtownCoreV3Plan(source({ ringMeters: L_SHAPE }), BASE_MANIFEST, undefined, SUCCESSOR_GRAMMAR);
    // The exact Stage-0 disagreement: extended plan, shipped-grammar profile.
    expect(() => writeMidtownCoreV3Assets(extended, { ...options }))
      .toThrowError(/Grammar disagreement for doitt:900001/u);
    expect(() => writeMidtownCoreV3Assets(extended, { ...options }))
      .not.toThrowError(MidtownCoreV3Stop);
    // And the mirror: a shipped plan written into a wave declaring the extended
    // envelope is refused just as hard, so the check is not one-directional.
    const shipped = buildMidtownCoreV3Plan(source({ ringMeters: L_SHAPE }), BASE_MANIFEST);
    expect(() => writeMidtownCoreV3Assets(shipped, {
      ...options,
      profile: { ...MIDTOWN_CORE_V3_WAVE_PROFILE, admissionEnvelope: SUCCESSOR_GRAMMAR },
    })).toThrowError(/Grammar disagreement for doitt:900001/u);
  });

  it("accepts the agreeing pair, and an equivalent envelope spelled differently", () => {
    const extended = buildMidtownCoreV3Plan(source({ ringMeters: L_SHAPE }), BASE_MANIFEST, undefined, SUCCESSOR_GRAMMAR);
    const written = writeMidtownCoreV3Assets(extended, {
      ...options,
      profile: { ...MIDTOWN_CORE_V3_WAVE_PROFILE, admissionEnvelope: SUCCESSOR_GRAMMAR },
    });
    expect(written.assets).toHaveLength(2);
    // The comparison is by EFFECTIVE value, not by reference or by key set.
    expect(() => writeMidtownCoreV3Assets(extended, {
      ...options,
      profile: {
        ...MIDTOWN_CORE_V3_WAVE_PROFILE,
        admissionEnvelope: { ...V3_SHIPPED_GRAMMAR_OPTIONS, ...SUCCESSOR_GRAMMAR },
      },
    })).not.toThrow();
    // A profile that names NO envelope means the shipped grammar, and therefore
    // still disagrees with an extended plan rather than waiving the check.
    const silent = { ...MIDTOWN_CORE_V3_WAVE_PROFILE };
    delete silent.admissionEnvelope;
    expect(() => writeMidtownCoreV3Assets(extended, { ...options, profile: silent }))
      .toThrowError(/Grammar disagreement for doitt:900001/u);
  });
});
