import { describe, expect, it } from "vitest";
import { REQUIRED_EXTERIOR_COMPONENT_KINDS, validateExteriorComponentInventory } from "./exterior-contract";
import {
  calculateDeterministicFacadePlanHash,
  DETERMINISTIC_FACADE_LIMITS,
  DETERMINISTIC_FACADE_SCHEMA_VERSION,
  DETERMINISTIC_FACADE_UNCERTAINTY,
  DETERMINISTIC_SETBACKS_ABSENCE_REASON,
  DETERMINISTIC_SIGNAGE_ABSENCE_REASON,
  generateDeterministicFacadePlan,
  serializeDeterministicFacadePlan,
  validateDeterministicFacadeInput,
  validateDeterministicFacadePlan,
  type DeterministicFacadeInput,
  type DeterministicFacadePlan,
} from "./deterministic-facade-generator";
import { domainSeparatedSha256, sha256HexSync, stableSerialize } from "./deterministic-hash";
import { sha256HexSync as catalogSha256, stableSerialize as catalogSerialize } from "../release/catalog-release";

const HASH = "a".repeat(64);
const NOW = "2026-08-10T00:00:00.000Z";

function input(): DeterministicFacadeInput {
  return {
    schemaVersion: DETERMINISTIC_FACADE_SCHEMA_VERSION,
    buildingId: "building:fixture:1",
    generatedAt: NOW,
    seed: "seed:fixture:1",
    tool: { id: "tool:fixture", version: "1.0.0" },
    geometry: {
      unit: "millimeter",
      footprint: { outer: [[0, 0], [24_000, 0], [24_000, 16_000], [0, 16_000]], holes: [] },
      baseElevationMm: 0,
      heightMm: 18_000,
    },
    sourceAnchors: [
      { id: "anchor:height", kind: "height", sourceRefId: "source:height", fingerprintSha256: HASH },
      { id: "anchor:footprint", kind: "footprint", sourceRefId: "source:footprint", fingerprintSha256: HASH },
    ],
    parameters: {
      floorCount: 6,
      bayCount: 4,
      floorHeightMm: 3_000,
      windowWidthMm: 1_800,
      windowHeightMm: 1_400,
      windowSillMm: 800,
      openingInsetMm: 300,
      entranceWidthMm: 1_800,
      entranceHeightMm: 2_400,
      storefrontHeightMm: 2_200,
      corniceHeightMm: 400,
      roofEquipmentSizeMm: 3_000,
    },
  };
}

function mustGenerate(value: unknown = input()): DeterministicFacadePlan {
  const result = generateDeterministicFacadePlan(value);
  if (!result.ok) throw new Error(result.issues.map((entry) => `${entry.path}: ${entry.message}`).join("\n"));
  return result.value;
}

function allNumbersAreIntegers(value: unknown): boolean {
  if (typeof value === "number") return Number.isSafeInteger(value);
  if (Array.isArray(value)) return value.every(allNumbersAreIntegers);
  if (value && typeof value === "object") return Object.values(value).every(allNumbersAreIntegers);
  return true;
}

function rectangleTraversals(points: DeterministicFacadeInput["geometry"]["footprint"]["outer"]): Array<DeterministicFacadeInput["geometry"]["footprint"]["outer"]> {
  const traversals: Array<DeterministicFacadeInput["geometry"]["footprint"]["outer"]> = [];
  for (const direction of [points, [...points].reverse()] as const) {
    for (let offset = 0; offset < direction.length; offset += 1) traversals.push([...direction.slice(offset), ...direction.slice(0, offset)]);
  }
  return traversals;
}

describe("deterministic facade plan generator", () => {
  it("preserves the shared hash API and produces the golden plan", () => {
    expect(sha256HexSync("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(catalogSha256("abc")).toBe(sha256HexSync("abc"));
    expect(catalogSerialize({ b: 2, a: 1 })).toBe(stableSerialize({ a: 1, b: 2 }));
    const first = mustGenerate();
    const second = mustGenerate();
    expect(first).toEqual(second);
    expect(first.planHashSha256).toBe("e84a3907674083c98cec3b9ff4e9564eaba3d4b419a3d521ced080898bda2c34");
    expect(validateDeterministicFacadePlan(first).ok).toBe(true);
  });

  it("canonicalizes ring and anchor reorderings before fingerprinting", () => {
    const original = mustGenerate();
    const corners: DeterministicFacadeInput["geometry"]["footprint"]["outer"] = [[0, 0], [24_000, 0], [24_000, 16_000], [0, 16_000]];
    for (const traversal of rectangleTraversals(corners)) {
      const reordered = input();
      reordered.sourceAnchors.reverse();
      reordered.geometry.footprint.outer = traversal;
      expect(mustGenerate(reordered)).toEqual(original);
    }
    expect(original.anchors.map((anchor) => anchor.id)).toEqual(["anchor:footprint", "anchor:height"]);
  });

  it("rejects both bow-tie traversal classes under every rotation and reversal", () => {
    const bowTies: Array<DeterministicFacadeInput["geometry"]["footprint"]["outer"]> = [
      [[0, 0], [24_000, 0], [0, 16_000], [24_000, 16_000]],
      [[0, 0], [24_000, 16_000], [24_000, 0], [0, 16_000]],
    ];
    for (const bowTie of bowTies) for (const traversal of rectangleTraversals(bowTie)) {
      const value = input();
      value.geometry.footprint.outer = traversal;
      expect(validateDeterministicFacadeInput(value).ok).toBe(false);
    }
  });

  it("changes domain-separated plan hashes for bounded input perturbations", () => {
    const baseline = mustGenerate().planHashSha256;
    const variants = Array.from({ length: 6 }, () => input());
    variants[0]!.seed = "seed:fixture:2";
    variants[1]!.buildingId = "building:fixture:2";
    variants[2]!.sourceAnchors[0]!.fingerprintSha256 = "b".repeat(64);
    variants[3]!.tool.version = "1.0.1";
    variants[4]!.generatedAt = "2026-08-10T00:00:01.000Z";
    variants[5]!.parameters.windowWidthMm = 1_700;
    for (const variant of variants) expect(mustGenerate(variant).planHashSha256).not.toBe(baseline);
    expect(domainSeparatedSha256("one", { value: 1 })).not.toBe(domainSeparatedSha256("two", { value: 1 }));
  });

  it("emits the exact T002 vocabulary with generated/absent truth only", () => {
    const plan = mustGenerate();
    expect(validateExteriorComponentInventory(plan.inventory).ok).toBe(true);
    expect(plan.inventory.components.map((component) => component.kind)).toEqual(REQUIRED_EXTERIOR_COMPONENT_KINDS);
    expect(plan.inventory.components.every((component) => component.state === "generated" || component.state === "absent")).toBe(true);
    const signage = plan.inventory.components.find((component) => component.kind === "signage")!;
    expect(signage).toEqual(expect.objectContaining({ state: "absent", representation: "none", reason: DETERMINISTIC_SIGNAGE_ABSENCE_REASON, uncertainty: DETERMINISTIC_FACADE_UNCERTAINTY }));
    const setbacks = plan.inventory.components.find((component) => component.kind === "setbacks")!;
    expect(setbacks).toEqual(expect.objectContaining({ state: "absent", representation: "none", reason: DETERMINISTIC_SETBACKS_ABSENCE_REASON, uncertainty: DETERMINISTIC_FACADE_UNCERTAINTY }));
    const generated = plan.inventory.components.filter((component) => component.state === "generated");
    expect(generated.every((component) => component.generator.constraintSourceIds.join(",") === "source:footprint,source:height")).toBe(true);
  });

  it("rejects holes, non-simple rings, floats, controls, oversized IDs, and noncanonical time", () => {
    const mutations: Array<(value: DeterministicFacadeInput) => void> = [
      (value) => { value.geometry.footprint.holes = [[[1, 1], [2, 1], [2, 2], [1, 2]]] as never; },
      (value) => { value.geometry.footprint.outer = [[0, 0], [24_000, 0], [10_000, 8_000], [0, 16_000]]; },
      (value) => { value.parameters.floorHeightMm = 3_000.5; },
      (value) => { value.seed = "seed\u0000bad"; },
      (value) => { value.buildingId = `b${"x".repeat(DETERMINISTIC_FACADE_LIMITS.maxInputIdLength)}`; },
      (value) => { value.generatedAt = "2026-08-10T00:00:00Z"; },
    ];
    for (const mutate of mutations) {
      const value = input(); mutate(value);
      expect(validateDeterministicFacadeInput(value).ok).toBe(false);
      expect(generateDeterministicFacadePlan(value).ok).toBe(false);
    }
  });

  it("enforces floor, bay, placement, part, and vertex caps", () => {
    const oversized = input();
    oversized.parameters.floorCount = 512;
    oversized.parameters.bayCount = 256;
    oversized.parameters.floorHeightMm = 3_000;
    oversized.geometry.heightMm = 1_536_000;
    oversized.geometry.footprint.outer = [[0, 0], [1_024_000, 0], [1_024_000, 1_024_000], [0, 1_024_000]];
    expect(generateDeterministicFacadePlan(oversized).ok).toBe(false);

    const parts = structuredClone(mustGenerate());
    parts.topology.parts = Array.from({ length: 65 }, (_, index) => ({ ...structuredClone(parts.topology.parts[0]!), id: `part:${index}` }));
    expect(validateDeterministicFacadePlan(parts).ok).toBe(false);

    const vertices = structuredClone(mustGenerate());
    vertices.surfaces[0]!.ring = Array.from({ length: 2_049 }, (_, index) => [index, 0, 0]);
    expect(validateDeterministicFacadePlan(vertices).ok).toBe(false);
  });

  it("validates closed topology and rejects duplicate ownership or overlapping parts", () => {
    const duplicate = structuredClone(mustGenerate());
    duplicate.topology.parts[0]!.surfaceIds.push(duplicate.topology.parts[0]!.surfaceIds[0]!);
    expect(validateDeterministicFacadePlan(duplicate).ok).toBe(false);

    const overlap = structuredClone(mustGenerate());
    overlap.topology.parts.push({ ...structuredClone(overlap.topology.parts[0]!), id: "part:overlap" });
    expect(validateDeterministicFacadePlan(overlap).ok).toBe(false);

    const open = structuredClone(mustGenerate());
    open.topology.closedManifold = false as true;
    expect(validateDeterministicFacadePlan(open).ok).toBe(false);
  });

  it("emits and independently validates the exact rectangular-prism adjacency graph", () => {
    const first = mustGenerate();
    const second = mustGenerate();
    expect(first.topology.adjacency).toHaveLength(12);
    expect(first.topology.adjacency[0]).not.toBe(second.topology.adjacency[0]);
    const degrees = new Map(first.surfaces.map((surface) => [surface.id, 0]));
    for (const [left, right] of first.topology.adjacency) {
      degrees.set(left, degrees.get(left)! + 1);
      degrees.set(right, degrees.get(right)! + 1);
    }
    expect([...degrees.values()]).toEqual([4, 4, 4, 4, 4, 4]);

    const reversedDuplicate = structuredClone(first);
    reversedDuplicate.topology.adjacency.push([...reversedDuplicate.topology.adjacency[0]!].reverse() as [string, string]);
    expect(validateDeterministicFacadePlan(reversedDuplicate).ok).toBe(false);

    const dangling = structuredClone(first);
    dangling.topology.adjacency[0]![0] = "surface:missing";
    expect(validateDeterministicFacadePlan(dangling).ok).toBe(false);

    const roofGround = structuredClone(first);
    roofGround.topology.adjacency[0] = ["surface:ground", "surface:roof"];
    expect(validateDeterministicFacadePlan(roofGround).ok).toBe(false);

    const missing = structuredClone(first);
    missing.topology.adjacency.pop();
    expect(validateDeterministicFacadePlan(missing).ok).toBe(false);
  });

  it("keeps placements closed, bounded, non-overlapping, and ground/roof anchored", () => {
    const plan = mustGenerate();
    const surfaces = new Map(plan.surfaces.map((surface) => [surface.id, surface]));
    const materials = new Set(plan.materials.map((material) => material.id));
    expect(plan.placements).toHaveLength(89);
    expect(plan.placements.every((placement) => surfaces.has(placement.surfaceId) && materials.has(placement.materialId))).toBe(true);
    expect(plan.placements.filter((placement) => placement.kind === "entrance" || placement.kind === "storefront").every((placement) => placement.anchor === "ground" && placement.bounds.vMinMm === 0)).toBe(true);
    expect(plan.placements.find((placement) => placement.kind === "roof-equipment")).toEqual(expect.objectContaining({ anchor: "roof", surfaceId: "surface:roof" }));

    const escaped = structuredClone(plan); escaped.placements[0]!.bounds.uMaxMm = escaped.surfaces[0]!.uLengthMm + 1;
    expect(validateDeterministicFacadePlan(escaped).ok).toBe(false);
    const dangling = structuredClone(plan); dangling.placements[0]!.surfaceId = "surface:missing";
    expect(validateDeterministicFacadePlan(dangling).ok).toBe(false);
    const overlapping = structuredClone(plan); overlapping.placements.push({ ...structuredClone(overlapping.placements[0]!), id: "placement:overlap" });
    expect(validateDeterministicFacadePlan(overlapping).ok).toBe(false);
  });

  it("uses half-open placement bounds and bounds overlap diagnostics at the 50,000-placement cap", () => {
    const touching = structuredClone(mustGenerate());
    touching.placements[1]!.bounds.uMinMm = touching.placements[0]!.bounds.uMaxMm;
    touching.planHashSha256 = calculateDeterministicFacadePlanHash(touching);
    const touchingResult = validateDeterministicFacadePlan(touching);
    expect(touchingResult.ok).toBe(false);
    if (!touchingResult.ok) expect(touchingResult.issues.filter((issue) => issue.message.includes("overlap"))).toEqual([]);

    const oneMillimeterOverlap = structuredClone(touching);
    oneMillimeterOverlap.placements[1]!.bounds.uMinMm -= 1;
    oneMillimeterOverlap.planHashSha256 = calculateDeterministicFacadePlanHash(oneMillimeterOverlap);
    const overlapResult = validateDeterministicFacadePlan(oneMillimeterOverlap);
    expect(overlapResult.ok).toBe(false);
    if (!overlapResult.ok) expect(overlapResult.issues.filter((issue) => issue.message.includes("overlap"))).toHaveLength(1);

    const maximum = input();
    maximum.parameters.floorCount = 127;
    maximum.parameters.bayCount = 99;
    maximum.geometry.heightMm = 381_000;
    maximum.geometry.footprint.outer = [[0, 0], [990_000, 0], [990_000, 990_000], [0, 990_000]];
    const maximumPlan = mustGenerate(maximum);
    expect(maximumPlan.placements).toHaveLength(DETERMINISTIC_FACADE_LIMITS.maxPlacements);
    expect(validateDeterministicFacadePlan(maximumPlan).ok).toBe(true);

    maximumPlan.placements[1]!.bounds = { ...maximumPlan.placements[0]!.bounds };
    maximumPlan.planHashSha256 = calculateDeterministicFacadePlanHash(maximumPlan);
    const maximumOverlap = validateDeterministicFacadePlan(maximumPlan);
    expect(maximumOverlap.ok).toBe(false);
    if (!maximumOverlap.ok) {
      expect(maximumOverlap.issues.filter((issue) => issue.message.includes("overlap"))).toHaveLength(1);
      expect(maximumOverlap.issues).toHaveLength(2);
    }
  });

  it("uses a distinct bounded PBR palette with adjacent facade non-repeat", () => {
    const plan = mustGenerate();
    expect(plan.materials).toHaveLength(6);
    expect(new Set(plan.materials.map((material) => stableSerialize(material.baseColorSrgb))).size).toBe(6);
    expect(plan.materials.every((material) => material.metallicPermille >= 0 && material.metallicPermille <= 1_000 && material.roughnessPermille >= 0 && material.roughnessPermille <= 1_000)).toBe(true);
    const facadeMaterials = plan.surfaces.slice(0, 4).map((surface) => surface.materialId);
    for (let index = 0; index < facadeMaterials.length; index += 1) expect(facadeMaterials[index]).not.toBe(facadeMaterials[(index + 1) % facadeMaterials.length]);
    expect(allNumbersAreIntegers(plan)).toBe(true);
  });

  it("excludes only planHashSha256 from the plan hash and serializes canonically", () => {
    const plan = mustGenerate();
    expect(calculateDeterministicFacadePlanHash(plan)).toBe(plan.planHashSha256);
    const changedDeclaration = { ...plan, planHashSha256: "f".repeat(64) };
    expect(calculateDeterministicFacadePlanHash(changedDeclaration)).toBe(plan.planHashSha256);
    expect(validateDeterministicFacadePlan(changedDeclaration).ok).toBe(false);
    const serialized = serializeDeterministicFacadePlan(plan);
    expect(serialized).toEqual({ ok: true, value: stableSerialize(plan) });
  });

  it("does not mutate inputs or share state across concurrent calls", async () => {
    const value = input(); const before = structuredClone(value);
    const plans = await Promise.all(Array.from({ length: 24 }, async () => mustGenerate(value)));
    expect(value).toEqual(before);
    expect(Object.isFrozen(value.parameters)).toBe(false);
    expect(Object.isFrozen(plans[0]!.input.parameters)).toBe(true);
    expect(plans[0]!.input.parameters).not.toBe(value.parameters);
    expect(plans[0]!.input.parameters).not.toBe(plans[1]!.input.parameters);
    expect(plans.every((plan) => plan.planHashSha256 === plans[0]!.planHashSha256)).toBe(true);
    value.parameters.windowWidthMm = 1_700;
    expect(plans[0]!.input.parameters.windowWidthMm).toBe(1_800);
    expect(calculateDeterministicFacadePlanHash(plans[0]!)).toBe(plans[0]!.planHashSha256);
    expect(() => { plans[0]!.input.parameters.windowWidthMm = 1_700; }).toThrow(TypeError);
    plans[0]!.materials[0]!.baseColorSrgb[0] = 0;
    expect(plans[1]!.materials[0]!.baseColorSrgb[0]).not.toBe(0);
  });

  it("rejects truth laundering fields and non-generated evidence states", () => {
    const plan = structuredClone(mustGenerate()) as unknown as Record<string, unknown>;
    const inventory = plan.inventory as { components: Array<Record<string, unknown>> };
    inventory.components[0]!.accuracy = 1;
    inventory.components[1]!.tenant = "Example";
    inventory.components[2]!.brand = "Example";
    inventory.components[3]!.text = "Example";
    inventory.components[4]!.confidence = 1;
    expect(validateDeterministicFacadePlan(plan).ok).toBe(false);
  });

  it("replays a synthetic corpus deterministically within all caps", () => {
    const hashes = new Set<string>();
    for (let index = 0; index < 128; index += 1) {
      const value = input();
      value.buildingId = `building:corpus:${index}`;
      value.seed = `seed:corpus:${index % 17}`;
      value.geometry.footprint.outer = [[0, 0], [24_000 + index * 10, 0], [24_000 + index * 10, 16_000 + index * 10], [0, 16_000 + index * 10]];
      const first = mustGenerate(value); const second = mustGenerate(value);
      expect(first).toEqual(second);
      expect(validateDeterministicFacadePlan(first).ok).toBe(true);
      expect(first.topology.parts.length).toBeLessThanOrEqual(DETERMINISTIC_FACADE_LIMITS.maxParts);
      expect(first.placements.length).toBeLessThanOrEqual(DETERMINISTIC_FACADE_LIMITS.maxPlacements);
      hashes.add(first.planHashSha256);
    }
    expect(hashes.size).toBe(128);
  });
});
