/**
 * The V3 budget is a NEW gate, and the V1/V2 gate must be provably untouched by
 * it. These tests are the tripwire for both.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import releaseJson from "../../public/data/manhattan-esb-block-exterior-pilot-20260805/release.json";
import {
  DETERMINISTIC_FACADE_V3_LIMITS,
  DETERMINISTIC_FACADE_V3_UNCERTAINTY,
  V3_STYLE_CLASSES,
  deriveV3Parameters,
  generateV3FacadePlan,
  ringSignedAreaMm2,
  selectV3StyleClass,
  tessellateV3Plan,
  v3StyleMaterials,
  v3StyleWeights,
  validateV3Plan,
  type Point2Mm,
  type V3Plan,
} from "../domain/deterministic-facade-generator-v3.ts";
import { sha256HexBytes } from "../domain/deterministic-hash.ts";
import { BLOCK835_QUALITY_BUDGETS, enuFrame, readPilotBuildings, toEnuMeters, type SilhouetteMeasurementFile } from "./block835-reference-package.ts";
import {
  V3_QUALITY_BUDGETS,
  V3_REGISTRATION_METHOD,
  V3_REGISTRATION_TOLERANCE,
  assembleBlock835V3Package,
  v3EvidenceShardId,
  v3PredecessorPins,
  type AssembledV3,
} from "./block835-v3-package.ts";
import {
  multiLodAssemblyFingerprint,
  replayMultiLodAssembly,
  serializeMultiLodAssembly,
  type MultiLodAssemblyManifest,
} from "./multi-lod-assembly.ts";

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

// ---------------------------------------------------------------------------
// Committed-package drift gate
//
// The tests above prove the grammar. These prove the SHIPPED bytes are what the
// grammar currently produces, that the two packages this one supersedes are
// untouched, and that the Blender evidence promoted into `data/` still passes
// its own stated gates.
// ---------------------------------------------------------------------------

const V3_ROOT = "public/data/manhattan-esb-block-reference-20260811-v3/";
const V2_ROOT = "public/data/manhattan-esb-block-reference-20260811/";
const V1_ROOT = "public/data/manhattan-esb-block-reference-20260810/";
const V3_DATA = "data/manhattan-esb-block-reference-20260811-v3/";
/** Frozen fingerprints of the two packages this one supersedes without editing. */
const V2_FINGERPRINT = "6155a41de1d5f42a5a512d0efc8dedcc14b1fe6cb34bfb00269152e996b5a0f5";
const V1_FINGERPRINT = "8b0bd07b94b74a0e62ffb6657c76aecf4d638fa0178a40bfe8a1342679d4f26c";

function readBytes(path: string): Uint8Array { return new Uint8Array(readFileSync(path)); }
function readText(path: string): string { return new TextDecoder("utf-8", { fatal: true }).decode(readBytes(path)); }
function committedManifest(root: string): MultiLodAssemblyManifest {
  return JSON.parse(readText(`${root}manifest.json`)) as MultiLodAssemblyManifest;
}

const RELEASE_CHECKSUM = sha256HexBytes(readBytes("public/data/manhattan-esb-block-exterior-pilot-20260805/release.json"));

let cachedV3: AssembledV3 | null = null;
function assembled(): AssembledV3 {
  cachedV3 ??= assembleBlock835V3Package({
    release: releaseJson as unknown,
    releaseChecksumSha256: RELEASE_CHECKSUM,
    measurements: JSON.parse(readText(`${V3_DATA}silhouette-measurements.json`)) as SilhouetteMeasurementFile,
    predecessor: v3PredecessorPins(committedManifest(V2_ROOT)),
  });
  return cachedV3;
}

describe("Block 835 footprint-faithful V3 package", () => {
  it("ships all fourteen buildings and admits `absent` setbacks honestly", () => {
    const manifest = assembled().manifest;
    expect(manifest.assets).toHaveLength(14);
    const absent = manifest.assets.filter((asset) => asset.truthTiers.includes("absent"));
    // Five real footprints refuse the tier offset outright. The V2 assembler
    // threw on anything but a lone `generated` tier; the V3 path must carry the
    // refusal into the manifest instead of hiding it.
    expect(absent.map((asset) => asset.canonicalFeatureId).sort()).toEqual(
      ["doitt:131170", "doitt:262867", "doitt:39969", "doitt:812702", "doitt:835659"],
    );
    for (const asset of manifest.assets) {
      expect(asset.uncertainty).toBe(DETERMINISTIC_FACADE_V3_UNCERTAINTY);
      expect(asset.source.kind).toBe("facade-plan");
      expect(asset.truthTiers).not.toContain("evidence-backed");
      expect(asset.truthTiers).not.toContain("not-applicable");
      expect(asset.evidenceShardId).toBe(v3EvidenceShardId(asset.canonicalFeatureId));
    }
    // Every plan is distinct: fourteen buildings, fourteen plan hashes.
    expect(new Set(assembled().plans.map((plan) => plan.planHashSha256)).size).toBe(14);
  });

  it("registers the shipped ring against the SOURCED polygon vertex for vertex", () => {
    for (const entry of assembled().registration) {
      expect(entry.withinTolerance, entry.canonicalBuildingId).toBe(true);
      expect(entry.perVertexShapeDeviationMeters).toBeLessThanOrEqual(V3_REGISTRATION_TOLERANCE.perVertexShapeMeters);
      expect(entry.horizontalDeviationMeters).toBeLessThanOrEqual(V3_REGISTRATION_TOLERANCE.horizontalMeters);
      expect(entry.verticalDeviationMeters).toBeLessThanOrEqual(V3_REGISTRATION_TOLERANCE.verticalMeters);
      // Every sourced vertex is accounted for; a rectangle would have had four.
      expect(entry.shippedGroundVertexCount).toBeGreaterThanOrEqual(entry.sourceVertexCount);
    }
    expect(assembled().registration).toHaveLength(14);
  });

  it("keeps every LOD inside the V3 budgets and pins the V2 package as predecessor", () => {
    const previous = committedManifest(V2_ROOT);
    for (const asset of assembled().manifest.assets) {
      expect(asset.lods.map((lod) => lod.lodId)).toEqual(["lod_0", "lod_1"]);
      for (const lod of asset.lods) {
        expect(lod.quality.triangleCount).toBeLessThanOrEqual(V3_QUALITY_BUDGETS.maxTriangles);
        expect(lod.quality.materialCount).toBeLessThanOrEqual(V3_QUALITY_BUDGETS.maxMaterials);
        expect(lod.quality.textureCount).toBe(0);
        expect(lod.quality.budgets).toEqual(V3_QUALITY_BUDGETS);
      }
      expect(asset.lods[1]!.quality.triangleCount).toBeLessThanOrEqual(asset.lods[0]!.quality.triangleCount);
      const previousAsset = previous.assets.find((entry) => entry.canonicalFeatureId === asset.canonicalFeatureId);
      const previousLod0 = previousAsset?.lods.find((lod) => lod.lodId === "lod_0");
      const previousArtifact = previous.artifacts.find((entry) => entry.relativeRef === previousLod0?.artifactRef);
      expect(asset.predecessor?.id).toBe(`manhattan-esb-block-reference-20260811:${asset.canonicalFeatureId}:lod_0`);
      expect(asset.predecessor?.checksumSha256).toBe(previousArtifact!.checksumSha256);
    }
    expect(assembled().manifest.cells[0]!.predecessor).toEqual(previous.cells[0]!.cellRelease);
  });

  it("keeps the committed V3 package on disk identical to a fresh deterministic build", () => {
    const built = assembled();
    const committed = committedManifest(V3_ROOT);
    expect(multiLodAssemblyFingerprint(committed)).toBe(multiLodAssemblyFingerprint(built.manifest));
    expect(serializeMultiLodAssembly(committed)).toBe(serializeMultiLodAssembly(built.manifest));
    expect(committed.artifacts).toHaveLength(29);
    for (const artifact of committed.artifacts) {
      const bytes = readBytes(`${V3_ROOT}${artifact.relativeRef}`);
      expect(bytes.byteLength).toBe(artifact.byteSize);
      expect(sha256HexBytes(bytes)).toBe(artifact.checksumSha256);
      expect(sha256HexBytes(built.contents.get(artifact.relativeRef)!)).toBe(artifact.checksumSha256);
    }
    expect(committed.declaredTotalBytes).toBe(committed.artifacts.reduce((sum, artifact) => sum + artifact.byteSize, 0));
  });

  it("replays through the multi-LOD assembly contract with texture-free enforced", async () => {
    const built = assembled();
    const replay = await replayMultiLodAssembly(built.manifest, built.contents, { requireTextureFreeAssembly: true });
    expect(replay.ok ? null : replay.issues).toBeNull();
  });

  it("leaves both superseded packages byte-frozen", () => {
    for (const [root, fingerprint] of [[V1_ROOT, V1_FINGERPRINT], [V2_ROOT, V2_FINGERPRINT]] as const) {
      const previous = committedManifest(root);
      expect(multiLodAssemblyFingerprint(previous)).toBe(fingerprint);
      const serialized = serializeMultiLodAssembly(previous);
      // No V3 identifier may leak backwards into a frozen package.
      expect(serialized).not.toContain("20260811-v3");
      expect(serialized).not.toContain(DETERMINISTIC_FACADE_V3_UNCERTAINTY);
    }
  });

  it("validates all 14 committed V3 plans through the full V3 validator", () => {
    const index = JSON.parse(readText(`${V3_DATA}plan-index.json`)) as { plans: Array<{ canonicalBuildingId: string; planHashSha256: string }> };
    expect(index.plans).toHaveLength(14);
    for (const entry of index.plans) {
      const plan = JSON.parse(readText(`${V3_DATA}plans/${entry.canonicalBuildingId.replace(":", "-")}.json`)) as { planHashSha256: string };
      expect(plan.planHashSha256).toBe(entry.planHashSha256);
      const validated = validateV3Plan(plan);
      expect(validated.ok ? null : { file: entry.canonicalBuildingId, issues: validated.issues }).toBeNull();
    }
  });

  it("holds the promoted Blender evidence to the gates it states for itself", () => {
    // The raw evidence tree is gitignored, so these promoted records are the
    // only thing keeping the P5 proof checkable in CI.
    const volume = JSON.parse(readText(`${V3_DATA}blender-volume-identity.json`)) as {
      relativeTolerance: number; worstRelativeDeviation: number;
      buildings: Array<{ canonicalBuildingId: string; planHashSha256: string; lods: Record<string, { volumeDeviation: number; boundsASolid: boolean; outwardNormalsConsistent: boolean }> }>;
    };
    expect(volume.buildings).toHaveLength(14);
    expect(volume.worstRelativeDeviation).toBeLessThanOrEqual(volume.relativeTolerance);
    const planHashById = new Map(assembled().plans.map((plan) => [plan.buildingId, plan.planHashSha256]));
    for (const building of volume.buildings) {
      // A measurement taken against a stale plan is not evidence for this one.
      expect(planHashById.get(building.canonicalBuildingId), building.canonicalBuildingId).toBe(building.planHashSha256);
      expect(Object.keys(building.lods).sort()).toEqual(["lod_0", "lod_1"]);
      for (const lod of Object.values(building.lods)) {
        expect(lod.boundsASolid).toBe(true);
        expect(lod.outwardNormalsConsistent).toBe(true);
        expect(lod.volumeDeviation).toBeLessThanOrEqual(volume.relativeTolerance);
      }
    }

    const reimport = JSON.parse(readText(`${V3_DATA}blender-reimport-up-axis.json`)) as {
      toleranceMeters: number; files: Array<{ upAxisIsYUpInFile: boolean; maxBoundsDeviationMeters: number; zUpHypothesisDeviationMeters: number; positionsOnlyInAuthored: number; positionsOnlyInImported: number }>;
    };
    expect(reimport.files).toHaveLength(28);
    for (const file of reimport.files) {
      expect(file.upAxisIsYUpInFile).toBe(true);
      expect(file.maxBoundsDeviationMeters).toBeLessThanOrEqual(reimport.toleranceMeters);
      expect(file.positionsOnlyInAuthored + file.positionsOnlyInImported).toBe(0);
      // The control: a Z-up file would have landed nowhere near this, which is
      // what stops the agreement above from being vacuous.
      expect(file.zUpHypothesisDeviationMeters).toBeGreaterThan(reimport.toleranceMeters);
    }

    const inventory = JSON.parse(readText(`${V3_DATA}blender-evidence-inventory.json`)) as { fileCount: number; files: Array<{ path: string; sha256: string }> };
    expect(inventory.files).toHaveLength(inventory.fileCount);
    expect(inventory.files.every((entry) => /^[a-f0-9]{64}$/u.test(entry.sha256))).toBe(true);
    // Four fixed views per building plus the two-LOD silhouette pairs.
    expect(inventory.files.filter((entry) => entry.path.endsWith(".png"))).toHaveLength(14 * 4 * 3);
  });
});
