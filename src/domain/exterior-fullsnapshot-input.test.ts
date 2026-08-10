import { describe, expect, it } from "vitest";
import {
  generateDeterministicFacadePlan,
  validateDeterministicFacadeInput,
  validateDeterministicFacadePlan,
  DETERMINISTIC_FACADE_GENERATOR_ID,
  DETERMINISTIC_FACADE_GENERATOR_VERSION,
} from "./deterministic-facade-generator";
import { stableSerialize } from "./deterministic-hash";
import {
  EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
  EXTERIOR_FULLSNAPSHOT_FOOTPRINT_ANCHOR_ID,
  EXTERIOR_FULLSNAPSHOT_GENERATED_AT,
  EXTERIOR_FULLSNAPSHOT_HEIGHT_ANCHOR_ID,
  EXTERIOR_FULLSNAPSHOT_HEIGHT_FALLBACK_ANCHOR_ID,
  EXTERIOR_FULLSNAPSHOT_HEIGHT_RULES,
  EXTERIOR_FULLSNAPSHOT_PROJECTION,
  assertFullSnapshotRunRecord,
  buildExteriorFullSnapshotInput,
  degreesToNanodegrees,
  fullSnapshotPlacementCount,
  type FullSnapshotBuildingSource,
  type FullSnapshotRunRecord,
} from "./exterior-fullsnapshot-input";

const OPTIONS = { baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256 };

/** Builds a closed WGS84 ring from local metre offsets around an origin. */
function ringFromMeters(origin: readonly [number, number], offsets: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  const metersPerDegreeLongitude = EXTERIOR_FULLSNAPSHOT_PROJECTION.millimetersPerDegreeLongitude / 1000;
  const metersPerDegreeLatitude = EXTERIOR_FULLSNAPSHOT_PROJECTION.millimetersPerDegreeLatitude / 1000;
  const ring = offsets.map(([east, north]) => [
    origin[0] + east / metersPerDegreeLongitude,
    origin[1] + north / metersPerDegreeLatitude,
  ] as [number, number]);
  return [...ring, ring[0]!];
}

const ORIGIN: [number, number] = [-73.98, 40.75];

function source(overrides: Partial<FullSnapshotBuildingSource> = {}): FullSnapshotBuildingSource {
  return {
    buildingId: "doitt:1014719",
    representative: ORIGIN,
    outerRing: ringFromMeters(ORIGIN, [[-20, -10], [20, -10], [20, 10], [-20, 10]]),
    holeRings: [],
    heightMeters: 17.7,
    heightUnknown: false,
    sourceRefId: "source-ref:nyc.building-footprints:1014719",
    ...overrides,
  };
}

function expectOk(result: ReturnType<typeof buildExteriorFullSnapshotInput>) {
  if (!result.ok) throw new Error(`Adapter refused the input: ${JSON.stringify(result.issues)}`);
  return result;
}

describe("exterior full-snapshot input adapter", () => {
  it("produces an input the accepted V1 schema validates and the generator accepts", () => {
    const { input, record } = expectOk(buildExteriorFullSnapshotInput(source(), OPTIONS));
    const validation = validateDeterministicFacadeInput(input);
    expect(validation.ok ? [] : validation.issues).toEqual([]);
    const plan = generateDeterministicFacadePlan(input);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const planValidation = validateDeterministicFacadePlan(plan.value);
    expect(planValidation.ok ? [] : planValidation.issues).toEqual([]);
    expect(record.placementCount).toBe(plan.value.placements.length);
    expect(fullSnapshotPlacementCount(input.parameters)).toBe(plan.value.placements.length);
  });

  it("pins the generation instant to the base manifest instead of a wall clock", () => {
    const first = expectOk(buildExteriorFullSnapshotInput(source(), OPTIONS));
    expect(first.input.generatedAt).toBe(EXTERIOR_FULLSNAPSHOT_GENERATED_AT);
    expect(EXTERIOR_FULLSNAPSHOT_GENERATED_AT).not.toBe(new Date().toISOString());
    const refused = buildExteriorFullSnapshotInput(source(), { baseManifestChecksumSha256: "0".repeat(64) });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.issues[0]!.code).toBe("unsupported-base-manifest");
  });

  it("is byte-identical on replay and independent of source ring rotation direction", () => {
    const first = expectOk(buildExteriorFullSnapshotInput(source(), OPTIONS));
    const second = expectOk(buildExteriorFullSnapshotInput(source(), OPTIONS));
    expect(stableSerialize(second.input)).toBe(stableSerialize(first.input));
    expect(stableSerialize(second.record)).toBe(stableSerialize(first.record));

    const outer = source().outerRing;
    const open = outer.slice(0, -1);
    const rotated = [...open.slice(2), ...open.slice(0, 2)];
    const spun = expectOk(buildExteriorFullSnapshotInput(source({ outerRing: [...rotated, rotated[0]!] }), OPTIONS));
    expect(spun.record.widthMm).toBe(first.record.widthMm);
    expect(spun.record.depthMm).toBe(first.record.depthMm);
    expect(spun.record.orientationXMm).toBe(first.record.orientationXMm);
    expect(spun.record.orientationYMm).toBe(first.record.orientationYMm);

    const reversed = [...open].reverse();
    const wound = expectOk(buildExteriorFullSnapshotInput(source({ outerRing: [...reversed, reversed[0]!] }), OPTIONS));
    expect(wound.record.widthMm).toBe(first.record.widthMm);
    expect(wound.record.orientationXMm).toBe(first.record.orientationXMm);
    expect(wound.record.orientationYMm).toBe(first.record.orientationYMm);
  });

  it("uses the exact minimum-area rotated rectangle, not the axis-aligned bounding box", () => {
    // A 40 m x 20 m rectangle rotated 45 degrees: its AABB is ~42.4 m square
    // (1,800 m2), its minimum-area rectangle is the original 800 m2.
    const diagonal = ringFromMeters(ORIGIN, [[0, 0], [20 * Math.SQRT2, 20 * Math.SQRT2], [10 * Math.SQRT2, 30 * Math.SQRT2], [-10 * Math.SQRT2, 10 * Math.SQRT2]]);
    const { record } = expectOk(buildExteriorFullSnapshotInput(source({ outerRing: diagonal }), OPTIONS));
    expect(record.widthMm).toBeGreaterThan(record.depthMm);
    expect(record.widthMm / record.depthMm).toBeCloseTo(2, 2);
    // Area ratio stays near 1.0 because the proxy recovers the true rectangle.
    expect(record.areaRatioPartsPerMillion).toBeGreaterThan(999_000);
    expect(record.areaRatioPartsPerMillion).toBeLessThan(1_001_000);
    // The axis-aligned box on the same ring is ~2.25x worse, and the record
    // carries that comparison so it never has to be re-measured offline.
    expect(record.axisAlignedAreaRatioPartsPerMillion).toBeGreaterThan(2_200_000);
    // The +u axis is canonicalized into the x > 0 half plane and gcd-reduced.
    expect(record.orientationXMm).toBeGreaterThan(0);
  });

  it("orients the rectangle without trigonometry and reports the axis as exact integers", () => {
    const axisAligned = expectOk(buildExteriorFullSnapshotInput(source(), OPTIONS));
    expect(Number.isInteger(axisAligned.record.orientationXMm)).toBe(true);
    expect(Number.isInteger(axisAligned.record.orientationYMm)).toBe(true);
    expect(axisAligned.record.orientationYMm).toBe(0);
    expect(axisAligned.record.orientationXMm).toBe(1);
  });

  it("quantizes every height exactly and discloses the residual", () => {
    // 5.7912 m is a 19 ft source height: no floorCount divides it exactly.
    const { input, record } = expectOk(buildExteriorFullSnapshotInput(source({ heightMeters: 5.7912 }), OPTIONS));
    expect(record.unquantizedHeightMm).toBe(5791);
    expect(input.parameters.floorCount * input.parameters.floorHeightMm).toBe(input.geometry.heightMm);
    expect(record.quantizedHeightMm).toBe(input.geometry.heightMm);
    expect(record.heightResidualMm).toBe(record.unquantizedHeightMm - record.quantizedHeightMm);
    expect(record.heightResidualMm).toBeGreaterThanOrEqual(0);
    expect(record.heightResidualMm).toBeLessThan(record.floorCount);
    expect(record.forcedTwoFloor).toBe(false);
    expect(record.heightSource).toBe("source");
  });

  it("raises sub-5.25 m buildings to the two-floor grammar floor and flags every one", () => {
    const low = expectOk(buildExteriorFullSnapshotInput(source({ heightMeters: 4 }), OPTIONS));
    expect(low.record.forcedTwoFloor).toBe(true);
    expect(low.record.floorCount).toBe(EXTERIOR_FULLSNAPSHOT_HEIGHT_RULES.minimumFloorCount);
    expect(low.record.floorHeightMm).toBe(2_000);
    // The boundary: 5.25 m is exactly the first height the rule does not raise.
    const boundary = expectOk(buildExteriorFullSnapshotInput(source({ heightMeters: 5.25 }), OPTIONS));
    expect(boundary.record.forcedTwoFloor).toBe(false);
  });

  it("raises buildings under a 12 m short side to the two-bay grammar floor and flags every one", () => {
    // The default 40 m x 20 m fixture already has a 20 m short side.
    const wide = expectOk(buildExteriorFullSnapshotInput(source(), OPTIONS));
    expect(wide.record.bayCount).toBe(3);
    expect(wide.record.forcedTwoBay).toBe(false);
    // A 25 ft (7.62 m) Manhattan lot: floor(7620/6000) is 1, so the floor fires.
    const lot = expectOk(buildExteriorFullSnapshotInput(source({
      outerRing: ringFromMeters(ORIGIN, [[0, 0], [30, 0], [30, 7.62], [0, 7.62]]),
    }), OPTIONS));
    expect(lot.record.bayCount).toBe(2);
    expect(lot.record.forcedTwoBay).toBe(true);
  });

  it("substitutes a stated fallback height for unknown heights and says so in the anchor", () => {
    const { input, record } = expectOk(buildExteriorFullSnapshotInput(source({ heightMeters: null, heightUnknown: true }), OPTIONS));
    expect(record.heightSource).toBe("fallback");
    expect(record.unquantizedHeightMm).toBe(EXTERIOR_FULLSNAPSHOT_HEIGHT_RULES.unknownHeightFallbackMm);
    expect(input.sourceAnchors.map((anchor) => anchor.id)).toContain(EXTERIOR_FULLSNAPSHOT_HEIGHT_FALLBACK_ANCHOR_ID);
    expect(input.sourceAnchors.map((anchor) => anchor.id)).not.toContain(EXTERIOR_FULLSNAPSHOT_HEIGHT_ANCHOR_ID);
    const known = expectOk(buildExteriorFullSnapshotInput(source(), OPTIONS));
    expect(known.input.sourceAnchors.map((anchor) => anchor.id)).toContain(EXTERIOR_FULLSNAPSHOT_HEIGHT_ANCHOR_ID);
    // A substituted height must never hash the same as a measured one.
    expect(known.input.sourceAnchors[1]!.fingerprintSha256).not.toBe(input.sourceAnchors[1]!.fingerprintSha256);
  });

  it("names the footprint substitution in the anchor id and measures its magnitude", () => {
    const lShape = ringFromMeters(ORIGIN, [[0, 0], [40, 0], [40, 10], [10, 10], [10, 30], [0, 30]]);
    const { input, record } = expectOk(buildExteriorFullSnapshotInput(source({ outerRing: lShape }), OPTIONS));
    expect(input.sourceAnchors[0]!.id).toBe(EXTERIOR_FULLSNAPSHOT_FOOTPRINT_ANCHOR_ID);
    expect(input.sourceAnchors[0]!.kind).toBe("footprint");
    // True L area is 600 m2; the enclosing rectangle is strictly larger, and
    // the run record carries the inflation rather than hiding it.
    expect(record.trueAreaMm2).toBeGreaterThan(599_000_000);
    expect(record.trueAreaMm2).toBeLessThan(601_000_000);
    expect(record.areaRatioPartsPerMillion).toBeGreaterThan(1_000_000);
    expect(record.proxyAreaMm2).toBe(record.widthMm * record.depthMm);
  });

  it("drops interior rings, counts them, and measures the area it dropped", () => {
    const outer = ringFromMeters(ORIGIN, [[-30, -30], [30, -30], [30, 30], [-30, 30]]);
    const hole = ringFromMeters(ORIGIN, [[-5, -5], [5, -5], [5, 5], [-5, 5]]);
    const { input, record } = expectOk(buildExteriorFullSnapshotInput(source({ outerRing: outer, holeRings: [hole] }), OPTIONS));
    expect(input.geometry.footprint.holes).toEqual([]);
    expect(record.holeRingsDropped).toBe(1);
    expect(record.holeAreaMm2).toBeGreaterThan(99_000_000);
    expect(record.holeAreaMm2).toBeLessThan(101_000_000);
  });

  it("carries the accepted generator identity so the inventory's hard-coded tool matches", () => {
    const { input } = expectOk(buildExteriorFullSnapshotInput(source(), OPTIONS));
    expect(input.tool).toEqual({ id: DETERMINISTIC_FACADE_GENERATOR_ID, version: DETERMINISTIC_FACADE_GENERATOR_VERSION });
    const plan = generateDeterministicFacadePlan(input);
    if (!plan.ok) throw new Error("generation failed");
    for (const component of plan.value.inventory.components) {
      if (component.state !== "generated") continue;
      expect(component.generator.id).toBe(input.tool.id);
      expect(component.generator.version).toBe(input.tool.version);
      expect(component.generator.generatedAt).toBe(EXTERIOR_FULLSNAPSHOT_GENERATED_AT);
    }
  });

  it("separates seeds by building so two identical shapes cannot share a plan", () => {
    const first = expectOk(buildExteriorFullSnapshotInput(source({ buildingId: "doitt:1" }), OPTIONS));
    const second = expectOk(buildExteriorFullSnapshotInput(source({ buildingId: "doitt:2" }), OPTIONS));
    expect(second.input.seed).not.toBe(first.input.seed);
    const planA = generateDeterministicFacadePlan(first.input);
    const planB = generateDeterministicFacadePlan(second.input);
    if (!planA.ok || !planB.ok) throw new Error("generation failed");
    expect(planB.value.planHashSha256).not.toBe(planA.value.planHashSha256);
  });

  it("refuses degenerate footprints and unsafe identities instead of inventing a building", () => {
    const collinear = ringFromMeters(ORIGIN, [[0, 0], [10, 0], [20, 0]]);
    const flat = buildExteriorFullSnapshotInput(source({ outerRing: collinear }), OPTIONS);
    expect(flat.ok).toBe(false);
    if (!flat.ok) expect(flat.issues[0]!.code).toBe("degenerate-footprint");

    // The documented minimum short side is enforced, not merely declared.
    const belowMinimum = EXTERIOR_FULLSNAPSHOT_HEIGHT_RULES.minimumRectangleSideMm / 1000 - 0.1;
    const sliver = ringFromMeters(ORIGIN, [[0, 0], [40, 0], [40, belowMinimum], [0, belowMinimum]]);
    const thin = buildExteriorFullSnapshotInput(source({ outerRing: sliver }), OPTIONS);
    expect(thin.ok).toBe(false);
    if (!thin.ok) {
      expect(thin.issues[0]!.code).toBe("degenerate-rectangle");
      expect(thin.issues[0]!.detail).toContain(String(EXTERIOR_FULLSNAPSHOT_HEIGHT_RULES.minimumRectangleSideMm));
    }
    const atMinimum = ringFromMeters(ORIGIN, [[0, 0], [40, 0], [40, EXTERIOR_FULLSNAPSHOT_HEIGHT_RULES.minimumRectangleSideMm / 1000], [0, EXTERIOR_FULLSNAPSHOT_HEIGHT_RULES.minimumRectangleSideMm / 1000]]);
    expect(buildExteriorFullSnapshotInput(source({ outerRing: atMinimum }), OPTIONS).ok).toBe(true);

    const unsafe = buildExteriorFullSnapshotInput(source({ buildingId: "doitt/1014719" }), OPTIONS);
    expect(unsafe.ok).toBe(false);
    if (!unsafe.ok) expect(unsafe.issues[0]!.code).toBe("invalid-identity");
  });

  it("fails closed on a cap instead of clamping the grammar", () => {
    // 2,000 m tall is far outside Manhattan, so the 512-floor cap must refuse
    // the building rather than silently trimming it to a valid plan.
    const tall = buildExteriorFullSnapshotInput(source({ heightMeters: 2_000 }), OPTIONS);
    expect(tall.ok).toBe(false);
    if (!tall.ok) expect(tall.issues[0]!.code).toBe("cap-exceeded");
  });

  it("projects with integers only, so a nanodegree step maps to a fixed millimetre step", () => {
    expect(degreesToNanodegrees(-73.98)).toBe(-73_980_000_000);
    expect(Number.isSafeInteger(degreesToNanodegrees(40.8786959203305))).toBe(true);
    const wide = expectOk(buildExteriorFullSnapshotInput(source({
      outerRing: ringFromMeters(ORIGIN, [[0, 0], [100, 0], [100, 50], [0, 50]]),
    }), OPTIONS));
    // 100 m and 50 m survive the degree round trip to within a millimetre.
    expect(Math.abs(wide.record.widthMm - 100_000)).toBeLessThanOrEqual(2);
    expect(Math.abs(wide.record.depthMm - 50_000)).toBeLessThanOrEqual(2);
  });

  it("forbids undefined fields in a run record", () => {
    const { record } = expectOk(buildExteriorFullSnapshotInput(source(), OPTIONS));
    expect(() => assertFullSnapshotRunRecord(record)).not.toThrow();
    const corrupted = { ...record, widthMm: undefined } as unknown as FullSnapshotRunRecord;
    expect(() => assertFullSnapshotRunRecord(corrupted)).toThrow(/undefined/u);
    // The hazard the guard exists for: stableSerialize cannot tell the two apart.
    expect(stableSerialize({ widthMm: undefined })).toBe(stableSerialize({ widthMm: null }));
  });
});
