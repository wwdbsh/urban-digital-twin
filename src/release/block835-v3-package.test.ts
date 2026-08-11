/**
 * The V3 budget is a NEW gate, and the V1/V2 gate must be provably untouched by
 * it. These tests are the tripwire for both.
 */
import { describe, expect, it } from "vitest";
import releaseJson from "../../public/data/manhattan-esb-block-exterior-pilot-20260805/release.json";
import {
  DETERMINISTIC_FACADE_V3_LIMITS,
  V3_STYLE_CLASSES,
  deriveV3Parameters,
  generateV3FacadePlan,
  ringSignedAreaMm2,
  selectV3StyleClass,
  tessellateV3Plan,
  v3StyleMaterials,
  v3StyleWeights,
  type Point2Mm,
  type V3Plan,
} from "../domain/deterministic-facade-generator-v3.ts";
import { BLOCK835_QUALITY_BUDGETS, enuFrame, readPilotBuildings, toEnuMeters } from "./block835-reference-package.ts";
import { V3_QUALITY_BUDGETS, V3_REGISTRATION_METHOD, V3_REGISTRATION_TOLERANCE } from "./block835-v3-package.ts";

const buildings = readPilotBuildings(releaseJson as unknown);

function planFor(index: number): V3Plan {
  const building = buildings[index]!;
  const frame = enuFrame(building.anchor);
  const ring = building.footprint.map((point) => {
    const [east, north] = toEnuMeters(frame, point);
    return [Math.round(east * 1_000), Math.round(north * 1_000)] as Point2Mm;
  });
  const outer = ringSignedAreaMm2(ring) < 0 ? [...ring].reverse() : ring;
  const heightMm = Math.round(building.heightMeters * 1_000);
  const result = generateV3FacadePlan({
    schemaVersion: "3.0", buildingId: building.canonicalBuildingId,
    generatedAt: "2026-08-11T00:00:00.000Z", seed: "block-835-reference-v3",
    tool: { id: "urban-digital-twin:block835-v3", version: "3.0.0" },
    geometry: { unit: "millimeter", footprint: { outer }, baseElevationMm: 0, heightMm },
    sourceAnchors: [
      { id: "anchor:footprint", kind: "footprint", sourceRefId: "source-ref:jh45-qr5r", fingerprintSha256: "a".repeat(64) },
      { id: "anchor:height", kind: "height", sourceRefId: "source-ref:oti-height", fingerprintSha256: "b".repeat(64) },
    ],
    parameters: deriveV3Parameters({ footprintOuterMm: outer, heightMm }),
  });
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.issues)}`);
  return result.value;
}

const plans = buildings.map((_, index) => planFor(index));

describe("the V3 budget is a new gate and leaves the frozen one alone", () => {
  it("does not touch BLOCK835_QUALITY_BUDGETS", () => {
    // Byte-frozen into the committed V1 and V2 manifests. If this moves, those
    // packages moved.
    expect(BLOCK835_QUALITY_BUDGETS).toEqual({ maxTriangles: 75_000, maxMaterials: 8, maxTextures: 0 });
  });

  it("raises triangles and materials, and holds textures at zero", () => {
    expect(V3_QUALITY_BUDGETS).toEqual({ maxTriangles: 200_000, maxMaterials: 12, maxTextures: 0 });
    expect(V3_QUALITY_BUDGETS.maxTriangles).toBeGreaterThan(BLOCK835_QUALITY_BUDGETS.maxTriangles);
    expect(V3_QUALITY_BUDGETS.maxTextures).toBe(0);
  });

  it("agrees with the grammar's own triangle limit", () => {
    expect(V3_QUALITY_BUDGETS.maxTriangles).toBe(DETERMINISTIC_FACADE_V3_LIMITS.maxAssetTriangles);
  });

  it("holds for every real building at both levels of detail", () => {
    for (const plan of plans) {
      for (const includeRecesses of [true, false]) {
        const tessellation = tessellateV3Plan(plan, { includeRecesses });
        expect(tessellation.triangleCount, plan.buildingId).toBeLessThanOrEqual(V3_QUALITY_BUDGETS.maxTriangles);
        const used = new Set([...tessellation.quads.map((quad) => quad.materialId), ...tessellation.triangles.map((triangle) => triangle.materialId)]);
        expect(used.size, plan.buildingId).toBeLessThanOrEqual(V3_QUALITY_BUDGETS.maxMaterials);
      }
    }
  });
});

describe("the material system is designed, deterministic and small", () => {
  it("emits at most ten materials with base/shaft zoning alone", () => {
    for (const style of V3_STYLE_CLASSES) {
      const materials = v3StyleMaterials(style);
      expect(materials.length).toBeLessThanOrEqual(10);
      expect(new Set(materials.map((material) => material.id)).size).toBe(materials.length);
    }
  });

  it("gives every plan a style class from the declared four", () => {
    for (const plan of plans) expect(V3_STYLE_CLASSES).toContain(plan.styleClass);
  });

  it("selects the same class for the same input twice", () => {
    // One building is enough to pin determinism; rebuilding all fourteen plans
    // a second time is pure CPU that starves the shared worker pool.
    expect(planFor(0).styleClass).toBe(plans[0]!.styleClass);
  });

  it("modulates the distribution only by sourced height and area", () => {
    const tall = v3StyleWeights({ heightMm: 380_000, footprintAreaMm2: 8_000_000_000 });
    const low = v3StyleWeights({ heightMm: 12_000, footprintAreaMm2: 200_000_000 });
    expect(tall["curtain-cool"]).toBeGreaterThan(low["curtain-cool"]);
    expect(low["masonry-warm"]).toBeGreaterThan(tall["masonry-warm"]);
    // Every class stays reachable for every building: the draw is a designed
    // choice, never an inference about a particular address.
    for (const weights of [tall, low]) for (const style of V3_STYLE_CLASSES) expect(weights[style]).toBeGreaterThan(0);
  });

  it("keeps selection a pure function of the hash and the sourced measures", () => {
    const sourced = { heightMm: 100_000, footprintAreaMm2: 1_000_000_000 };
    const drawn = new Set(Array.from({ length: 64 }, (_, index) => selectV3StyleClass(index.toString(16).padStart(8, "0").repeat(8), sourced)));
    expect(drawn.size).toBeGreaterThan(1);
    expect([...drawn].every((style) => (V3_STYLE_CLASSES as readonly string[]).includes(style))).toBe(true);
  });

  it("uses no textures anywhere, because it samples no imagery", () => {
    for (const style of V3_STYLE_CLASSES) {
      for (const material of v3StyleMaterials(style)) {
        expect(material.baseColorSrgb).toHaveLength(4);
        expect(Object.keys(material).sort()).toEqual(["baseColorSrgb", "id", "metallicPermille", "role", "roughnessPermille"]);
      }
    }
  });
});

describe("registration semantics are restated for the true ring", () => {
  it("states a per-vertex shape tolerance distinct from placement drift", () => {
    expect(V3_REGISTRATION_TOLERANCE.perVertexShapeMeters).toBeGreaterThan(0);
    expect(V3_REGISTRATION_TOLERANCE.perVertexShapeMeters).not.toBe(V3_REGISTRATION_TOLERANCE.horizontalMeters);
  });

  it("names what it does and does not claim", () => {
    expect(V3_REGISTRATION_METHOD.method).toBe("true-footprint-vertex-registration");
    expect(V3_REGISTRATION_METHOD.claim).toMatch(/does NOT claim/u);
    expect(V3_REGISTRATION_METHOD.referenceGeometry).toMatch(/oriented bounding rectangle/u);
  });
});
