/**
 * V3T is a successor, not an edit. These tests exist to prove three things that
 * are easy to claim and easy to break: the grammar did not move, the frozen
 * packages did not move, and an embedded image that this repository cannot
 * regenerate cannot get into a package.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import releaseJson from "../../public/data/manhattan-esb-block-exterior-pilot-20260805/release.json";
import {
  DETERMINISTIC_FACADE_V3T_UNCERTAINTY,
  DETERMINISTIC_FACADE_V3_UNCERTAINTY,
  V3_STYLE_CLASSES,
  tessellateV3Plan,
} from "../domain/deterministic-facade-generator-v3.ts";
import { sha256HexBytes } from "../domain/deterministic-hash.ts";
import { writeCanonicalGlb, type CanonicalGlbMaterial, type CanonicalGlbQuad } from "./canonical-glb.ts";
import { BLOCK835_V3T_PACKAGE_ID, BLOCK835_V3_PACKAGE_ID, readPilotBuildings, type SilhouetteMeasurementFile } from "./block835-reference-package.ts";
import {
  BLOCK835_V3T_PROFILE,
  V3T_CALIBRATED_PALETTE,
  V3T_QUALITY_BUDGETS,
  V3_QUALITY_BUDGETS,
  assembleBlock835V3Package,
  buildV3Plan,
  v3EvidenceShardId,
  v3GeometryForGlb,
  v3PredecessorPins,
  v3TextureClassFor,
  type AssembledV3,
} from "./block835-v3-package.ts";
import {
  ASSEMBLY_ISSUE_DECLARED_TEXTURE_FORBIDDEN,
  ASSEMBLY_ISSUE_EMBEDDED_IMAGE_FORBIDDEN,
  ASSEMBLY_ISSUE_TEXTURE_PROVENANCE_REQUIRED,
  ASSEMBLY_ISSUE_TEXTURE_REPLAY_MISMATCH,
  multiLodAssemblyFingerprint,
  replayMultiLodAssembly,
  type MultiLodAssemblyManifest,
} from "./multi-lod-assembly.ts";
import {
  PROCEDURAL_TEXTURE_CLASSES,
  PROCEDURAL_TEXTURE_LIMITS,
  PROCEDURAL_TEXTURE_PROFILE,
  PROCEDURAL_TEXTURE_TILE_PIXELS,
  proceduralTextureCatalog,
  proceduralTextureParametersHash,
} from "./procedural-texture.ts";

const V3_ROOT = "public/data/manhattan-esb-block-reference-20260811-v3/";
const V2_ROOT = "public/data/manhattan-esb-block-reference-20260811/";
const V1_ROOT = "public/data/manhattan-esb-block-reference-20260810/";
const V3_DATA = "data/manhattan-esb-block-reference-20260811-v3/";

/**
 * Frozen fingerprints of every package V3T must leave alone. V1 and V2 are
 * copied from the V3 drift gate; V3 is the package this one supersedes and is
 * pinned here for the first time.
 */
const V1_FINGERPRINT = "8b0bd07b94b74a0e62ffb6657c76aecf4d638fa0178a40bfe8a1342679d4f26c";
const V2_FINGERPRINT = "6155a41de1d5f42a5a512d0efc8dedcc14b1fe6cb34bfb00269152e996b5a0f5";

function readBytes(path: string): Uint8Array { return new Uint8Array(readFileSync(path)); }
function readText(path: string): string { return new TextDecoder("utf-8", { fatal: true }).decode(readBytes(path)); }
function committedManifest(root: string): MultiLodAssemblyManifest { return JSON.parse(readText(`${root}manifest.json`)) as MultiLodAssemblyManifest; }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

const RELEASE_CHECKSUM = sha256HexBytes(readBytes("public/data/manhattan-esb-block-exterior-pilot-20260805/release.json"));
const MEASUREMENTS = JSON.parse(readText(`${V3_DATA}silhouette-measurements.json`)) as SilhouetteMeasurementFile;

/**
 * Four buildings, one per style class, and deliberately NOT all fourteen.
 *
 * Assembling the whole block a second time inside vitest — the V3 drift test
 * already assembles it once — costs another 650 ms of pure CPU in the shared
 * worker pool, and this suite already contains a load-sensitive jsdom test that
 * fails intermittently at HEAD without any of this. Adding avoidable load to a
 * pool that is already at its limit is not a trade worth making for coverage
 * this subset already provides: it exercises every style class, every texture
 * class, both levels of detail and the whole writer path at a twentieth of the
 * triangle count. The full fourteen-building gates live where the contract puts
 * them — `block835-v3t-texture-cli.mjs census`, `replay` and `determinism` —
 * and the census they produce is checked below.
 */
const SUBSET = ["doitt:262867", "doitt:39969", "doitt:498980", "doitt:982383"] as const;

function subsetRelease(): unknown {
  const full = clone(releaseJson as Record<string, unknown>) as { boundaryRule: { buildings: Array<{ canonicalBuildingId: string }> } };
  full.boundaryRule.buildings = full.boundaryRule.buildings.filter((building) => (SUBSET as readonly string[]).includes(building.canonicalBuildingId));
  return full;
}

let cached: AssembledV3 | null = null;
function assembled(): AssembledV3 {
  cached ??= assembleBlock835V3Package({
    release: subsetRelease(),
    releaseChecksumSha256: RELEASE_CHECKSUM,
    measurements: MEASUREMENTS,
    predecessor: v3PredecessorPins(committedManifest(V3_ROOT), BLOCK835_V3_PACKAGE_ID),
    profile: BLOCK835_V3T_PROFILE,
  });
  return cached;
}

interface V3tCensus {
  packageId: string; predecessorPackageId: string; parametersHashSha256: string;
  budgets: typeof V3T_QUALITY_BUDGETS;
  summary: { buildings: number; planHashesUnchangedFromV3: boolean; distinctTextureClasses: string[]; worstLod0TextureCount: number; worstLod0ImageBytes: number; declaredTotalBytes: number; v3DeclaredTotalBytes: number };
  buildings: Array<{ canonicalBuildingId: string; planHashSha256: string; styleClass: string; textureClasses: string[]; lods: Array<{ lodId: string; textureCount: number; imageByteTotal: number; triangleCountUnchanged: boolean; withinBudget: boolean }> }>;
}
const CENSUS = JSON.parse(readText("data/manhattan-esb-block-reference-20260811-v3t/census.json")) as V3tCensus;

describe("the V3T budget and uncertainty are successors, never edits", () => {
  it("leaves the V3 budget alone and raises only textures", () => {
    expect(V3_QUALITY_BUDGETS).toEqual({ maxTriangles: 200_000, maxMaterials: 12, maxTextures: 0 });
    expect(V3T_QUALITY_BUDGETS).toEqual({ maxTriangles: 200_000, maxMaterials: 12, maxTextures: 4 });
    expect(V3T_QUALITY_BUDGETS.maxTextures).toBe(PROCEDURAL_TEXTURE_LIMITS.maxImagesPerGlb);
    expect(V3T_QUALITY_BUDGETS.maxTriangles).toBe(V3_QUALITY_BUDGETS.maxTriangles);
  });

  it("states what the pattern is and, verbatim, what it is not", () => {
    expect(DETERMINISTIC_FACADE_V3T_UNCERTAINTY).not.toBe(DETERMINISTIC_FACADE_V3_UNCERTAINTY);
    expect(DETERMINISTIC_FACADE_V3T_UNCERTAINTY).toContain("designed repeating motif");
    expect(DETERMINISTIC_FACADE_V3T_UNCERTAINTY).toContain("calibrated by human and agent viewing of public reference imagery");
    expect(DETERMINISTIC_FACADE_V3T_UNCERTAINTY).toContain("no image data was ingested, traced, sampled or reproduced");
    expect(DETERMINISTIC_FACADE_V3T_UNCERTAINTY).toContain("no material, colour, age, condition or cladding of the real building is asserted");
    // The V3 statement is pinned by the V3 plan validator and frozen into every
    // committed V3 plan; the successor must not have disturbed it.
    expect(DETERMINISTIC_FACADE_V3_UNCERTAINTY).toContain("Footprint-faithful procedural exterior in local millimetres. The massing follows");
    // Signage honesty is carried forward, not silently dropped.
    expect(DETERMINISTIC_FACADE_V3T_UNCERTAINTY).toContain("nor any tenant, brand or text");
  });
});

describe("the texture mapping is closed and small", () => {
  it("keeps every style inside the four-image ceiling and never textures roof or ground", () => {
    for (const style of V3_STYLE_CLASSES) {
      const materials = Object.keys(V3T_CALIBRATED_PALETTE[style]);
      const classes = new Set(materials.map((id) => v3TextureClassFor(style, id)).filter((value) => value !== null));
      expect(classes.size, style).toBeLessThanOrEqual(V3T_QUALITY_BUDGETS.maxTextures);
      expect(v3TextureClassFor(style, "material:roof"), style).toBeNull();
      expect(v3TextureClassFor(style, "material:ground"), style).toBeNull();
      for (const textureClass of classes) expect(PROCEDURAL_TEXTURE_CLASSES).toContain(textureClass);
    }
  });

  it("keeps every calibrated factor inside the closed glTF range with its hue intact", () => {
    for (const style of V3_STYLE_CLASSES) {
      for (const [materialId] of Object.entries(V3T_CALIBRATED_PALETTE[style])) {
        expect(typeof materialId).toBe("string");
      }
    }
    for (const asset of assembled().manifest.assets) expect(asset.canonicalFeatureId).toMatch(/^doitt:/u);
  });
});

describe("Block 835 V3T package", () => {
  it("keeps every asset's plan hash IDENTICAL to the frozen V3 package", () => {
    // The whole claim of this task in one assertion: the surface changed and the
    // geometry did not.
    const previous = committedManifest(V3_ROOT);
    const built = assembled().manifest;
    expect(built.assets).toHaveLength(SUBSET.length);
    for (const asset of built.assets) {
      const before = previous.assets.find((entry) => entry.canonicalFeatureId === asset.canonicalFeatureId)!;
      expect(asset.source, asset.canonicalFeatureId).toEqual(before.source);
      expect(asset.lods.map((lod) => lod.quality.triangleCount)).toEqual(before.lods.map((lod) => lod.quality.triangleCount));
      expect(asset.uncertainty).toBe(DETERMINISTIC_FACADE_V3T_UNCERTAINTY);
      expect(asset.evidenceShardId).toBe(v3EvidenceShardId(asset.canonicalFeatureId, BLOCK835_V3T_PACKAGE_ID));
      expect(asset.predecessor?.id).toBe(`${BLOCK835_V3_PACKAGE_ID}:${asset.canonicalFeatureId}:lod_0`);
    }
    expect(built.packageId).toBe(BLOCK835_V3T_PACKAGE_ID);
    expect(built.audience).toBe("private");
  });

  it("textures LOD 0 only and keeps LOD 1 texture-free", () => {
    for (const asset of assembled().manifest.assets) {
      const [fine, coarse] = asset.lods;
      expect(fine!.quality.textureCount, asset.canonicalFeatureId).toBeGreaterThan(0);
      expect(fine!.quality.textureCount).toBeLessThanOrEqual(V3T_QUALITY_BUDGETS.maxTextures);
      expect(coarse!.quality.textureCount, asset.canonicalFeatureId).toBe(0);
      expect(fine!.quality.budgets).toEqual(V3T_QUALITY_BUDGETS);
    }
  });

  it("keeps every asset's embedded image bytes inside the per-GLB cap", () => {
    const catalog = proceduralTextureCatalog();
    const worst = Math.max(...[...catalog.values()].map((tile) => tile.pngBytes.byteLength)) * V3T_QUALITY_BUDGETS.maxTextures;
    expect(worst).toBeLessThanOrEqual(PROCEDURAL_TEXTURE_LIMITS.maxGlbImageBytes);
  });

  it("replays through the procedural policy, regenerating every embedded PNG", async () => {
    const built = assembled();
    const replay = await replayMultiLodAssembly(built.manifest, built.contents, { proceduralTextureProfile: PROCEDURAL_TEXTURE_PROFILE });
    expect(replay.ok ? null : replay.issues).toBeNull();
  });

  it("is REFUSED by the texture-free gate that guards public packages", async () => {
    const built = assembled();
    // First refusal, at the manifest: a texture-free package may not even
    // DECLARE a nonzero texture count.
    const refused = await replayMultiLodAssembly(built.manifest, built.contents, { requireTextureFreeAssembly: true });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("a textured package must never pass the texture-free gate");
    expect(refused.issues.some((entry) => entry.message === ASSEMBLY_ISSUE_DECLARED_TEXTURE_FORBIDDEN)).toBe(true);

    // Second refusal, at the bytes, and the one that matters: a manifest that
    // LIES about its texture count clears the declaration check, and the
    // structural gate still finds the embedded image.
    const lying = clone(built.manifest);
    for (const asset of lying.assets) for (const lod of asset.lods) lod.quality = { ...lod.quality, textureCount: 0, budgets: { ...lod.quality.budgets, maxTextures: 0 } };
    const byteRefusal = await replayMultiLodAssembly(lying, built.contents, { requireTextureFreeAssembly: true });
    expect(byteRefusal.ok).toBe(false);
    if (byteRefusal.ok) throw new Error("a lying manifest must still be caught at the bytes");
    expect(byteRefusal.issues.some((entry) => entry.message === ASSEMBLY_ISSUE_EMBEDDED_IMAGE_FORBIDDEN)).toBe(true);

    // And the same package as a PUBLIC audience, where the gate is unconditional
    // and needs no policy flag at all.
    const asPublic = clone(built.manifest); asPublic.audience = "public";
    expect((await replayMultiLodAssembly(asPublic, built.contents)).ok).toBe(false);
  });

  it("rejects a hand-mutated image byte even with the checksums rewritten to match", async () => {
    // The attack this gate exists for: swap the generated tile for something
    // else and repair every accounting field. Only regeneration catches it.
    const built = assembled();
    const target = built.manifest.artifacts.find((artifact) => artifact.relativeRef.endsWith("__lod_0.glb"))!;
    const original = built.contents.get(target.relativeRef)!;
    const tampered = new Uint8Array(original);
    const marker = proceduralTextureCatalog().get("brick-running-bond")!.pngBytes.subarray(0, 8);
    let start = -1;
    for (let index = 0; index + marker.length <= tampered.length && start === -1; index += 1) {
      if (marker.every((byte, offset) => tampered[index + offset] === byte)) start = index;
    }
    expect(start).toBeGreaterThan(-1);
    // One pixel byte, deep inside the IDAT payload of an embedded tile.
    tampered[start + 2_000] = (tampered[start + 2_000]! + 1) & 0xff;

    const manifest = clone(built.manifest);
    const artifact = manifest.artifacts.find((entry) => entry.relativeRef === target.relativeRef)!;
    artifact.checksumSha256 = sha256HexBytes(tampered);
    artifact.byteSize = tampered.byteLength;
    const contents = new Map(built.contents); contents.set(target.relativeRef, tampered);

    const replay = await replayMultiLodAssembly(manifest, contents, { proceduralTextureProfile: PROCEDURAL_TEXTURE_PROFILE });
    expect(replay.ok).toBe(false);
    if (replay.ok) throw new Error("a mutated tile must fail the rasterizer replay");
    expect(replay.issues.some((entry) => entry.message === ASSEMBLY_ISSUE_TEXTURE_REPLAY_MISMATCH)).toBe(true);
  });

  it("rejects an embedded image that declares no provenance, with or without a policy", async () => {
    const built = assembled();
    const target = built.manifest.artifacts.find((artifact) => artifact.relativeRef.endsWith("__lod_0.glb"))!;
    const original = built.contents.get(target.relativeRef)!;
    const view = new DataView(original.buffer, original.byteOffset, original.byteLength);
    const jsonLength = view.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(original.subarray(20, 20 + jsonLength))) as { extras: { urbanDigitalTwin: Record<string, unknown> } };
    delete json.extras.urbanDigitalTwin.textureProvenance;

    const raw = new TextEncoder().encode(JSON.stringify(json));
    const padded = new Uint8Array(Math.ceil(raw.byteLength / 4) * 4); padded.fill(0x20); padded.set(raw);
    const bin = original.subarray(20 + jsonLength + 8);
    const total = 12 + 8 + padded.byteLength + 8 + bin.byteLength;
    const stripped = new Uint8Array(total);
    const out = new DataView(stripped.buffer);
    out.setUint32(0, 0x46546c67, true); out.setUint32(4, 2, true); out.setUint32(8, total, true);
    out.setUint32(12, padded.byteLength, true); out.setUint32(16, 0x4e4f534a, true); stripped.set(padded, 20);
    out.setUint32(20 + padded.byteLength, bin.byteLength, true); out.setUint32(24 + padded.byteLength, 0x004e4942, true);
    stripped.set(bin, 28 + padded.byteLength);

    const manifest = clone(built.manifest);
    const artifact = manifest.artifacts.find((entry) => entry.relativeRef === target.relativeRef)!;
    artifact.checksumSha256 = sha256HexBytes(stripped); artifact.byteSize = stripped.byteLength;
    manifest.declaredTotalBytes = manifest.artifacts.reduce((sum, entry) => sum + entry.byteSize, 0);
    const contents = new Map(built.contents); contents.set(target.relativeRef, stripped);

    // Replayed with NO POLICY ARGUMENT AT ALL, which is the case that matters:
    // the browser runtime passes none. If this rule were conditional on the
    // procedural policy, these bytes would be admitted here with no replay and
    // no account of what the image contains.
    const replay = await replayMultiLodAssembly(manifest, contents);
    expect(replay.ok).toBe(false);
    if (replay.ok) throw new Error("an image without provenance must fail closed with no policy in force");
    expect(replay.issues.some((entry) => entry.message === ASSEMBLY_ISSUE_TEXTURE_PROVENANCE_REQUIRED)).toBe(true);

    // And it fails identically under the procedural policy, so the two paths
    // cannot diverge later.
    const underPolicy = await replayMultiLodAssembly(manifest, contents, { proceduralTextureProfile: PROCEDURAL_TEXTURE_PROFILE });
    expect(underPolicy.ok).toBe(false);
  });

  it("leaves V1, V2 and V3 byte-frozen", () => {
    for (const [root, fingerprint] of [[V1_ROOT, V1_FINGERPRINT], [V2_ROOT, V2_FINGERPRINT]] as const) {
      expect(multiLodAssemblyFingerprint(committedManifest(root))).toBe(fingerprint);
    }
    const v3 = committedManifest(V3_ROOT);
    // The V3 package must contain no trace of the successor, and must still be
    // the untextured package its own drift test pins.
    for (const asset of v3.assets) {
      expect(asset.uncertainty).toBe(DETERMINISTIC_FACADE_V3_UNCERTAINTY);
      for (const lod of asset.lods) {
        expect(lod.quality.textureCount).toBe(0);
        expect(lod.quality.budgets).toEqual(V3_QUALITY_BUDGETS);
      }
    }
    for (const artifact of v3.artifacts) {
      const bytes = readBytes(`${V3_ROOT}${artifact.relativeRef}`);
      expect(sha256HexBytes(bytes)).toBe(artifact.checksumSha256);
    }
  });

  it("pins the parameters hash the shipped provenance records declare", () => {
    expect(proceduralTextureParametersHash()).toMatch(/^[a-f0-9]{64}$/u);
    const catalog = proceduralTextureCatalog();
    expect([...catalog.values()].every((tile) => tile.widthPixels === tile.heightPixels)).toBe(true);
  });
});

/**
 * The committed census is the full-fourteen-building record the CLI gate
 * produces. It is checked here rather than recomputed because recomputing it
 * means assembling the whole block a second time inside vitest; the checks below
 * are the ones that would go stale, and they are re-derived from live sources
 * (the frozen V3 manifest and this build's rasterizer) rather than copied.
 */
describe("the committed V3T census covers the whole block and is not stale", () => {
  it("covers all fourteen buildings against the frozen V3 plan hashes", () => {
    const v3 = committedManifest(V3_ROOT);
    expect(CENSUS.packageId).toBe(BLOCK835_V3T_PACKAGE_ID);
    expect(CENSUS.predecessorPackageId).toBe(BLOCK835_V3_PACKAGE_ID);
    expect(CENSUS.buildings).toHaveLength(14);
    expect(CENSUS.summary.buildings).toBe(14);
    expect(new Set(CENSUS.buildings.map((row) => row.planHashSha256)).size).toBe(14);
    for (const row of CENSUS.buildings) {
      const asset = v3.assets.find((entry) => entry.canonicalFeatureId === row.canonicalBuildingId);
      expect(asset, row.canonicalBuildingId).toBeDefined();
      // The census claims the grammar did not move. This is where that is checked
      // against the frozen package rather than taken on trust.
      expect(asset!.source.kind === "facade-plan" ? asset!.source.planHashSha256 : null, row.canonicalBuildingId).toBe(row.planHashSha256);
      for (const lod of row.lods) {
        expect(lod.triangleCountUnchanged, `${row.canonicalBuildingId} ${lod.lodId}`).toBe(true);
        expect(lod.withinBudget, `${row.canonicalBuildingId} ${lod.lodId}`).toBe(true);
        if (lod.lodId === "lod_1") expect(lod.textureCount).toBe(0);
        else expect(lod.textureCount).toBeGreaterThan(0);
      }
    }
  });

  it("was produced by THIS build's rasterizer, not an older one", () => {
    // A census pinned to a stale parameters hash would be describing tiles the
    // repository no longer produces.
    expect(CENSUS.parametersHashSha256).toBe(proceduralTextureParametersHash());
    expect(CENSUS.budgets).toEqual(V3T_QUALITY_BUDGETS);
    expect(CENSUS.summary.distinctTextureClasses.sort()).toEqual([...PROCEDURAL_TEXTURE_CLASSES].sort());
    expect(CENSUS.summary.worstLod0TextureCount).toBeLessThanOrEqual(V3T_QUALITY_BUDGETS.maxTextures);
    expect(CENSUS.summary.worstLod0ImageBytes).toBeLessThanOrEqual(PROCEDURAL_TEXTURE_LIMITS.maxGlbImageBytes);
    // Recomputed from the live catalogue: the recorded per-asset image cost must
    // still be the sum of the tiles that asset actually uses.
    const catalog = proceduralTextureCatalog();
    for (const row of CENSUS.buildings) {
      const expected = row.textureClasses.reduce((sum, textureClass) => sum + catalog.get(textureClass as never)!.pngBytes.byteLength, 0);
      expect(row.lods.find((lod) => lod.lodId === "lod_0")!.imageByteTotal, row.canonicalBuildingId).toBe(expected);
    }
  });

  it("holds the promoted Blender evidence to the gates it states for itself", () => {
    // The raw evidence tree is gitignored, so these promoted records are the only
    // thing keeping the textured re-import proof checkable after the worktree is
    // gone. Each is checked against ITS OWN stated gate, not against a number
    // copied into this file.
    const root = "data/manhattan-esb-block-reference-20260811-v3t/";
    const volume = JSON.parse(readText(`${root}blender-volume-identity.json`)) as {
      packageId: string; relativeTolerance: number; worstRelativeDeviation: number;
      buildings: Array<{ canonicalBuildingId: string; planHashSha256: string; lods: Record<string, { volumeDeviation: number; boundsASolid: boolean; outwardNormalsConsistent: boolean }> }>;
    };
    expect(volume.packageId).toBe(BLOCK835_V3T_PACKAGE_ID);
    expect(volume.buildings).toHaveLength(14);
    expect(volume.worstRelativeDeviation).toBeLessThanOrEqual(volume.relativeTolerance);
    const v3 = committedManifest(V3_ROOT);
    for (const building of volume.buildings) {
      const asset = v3.assets.find((entry) => entry.canonicalFeatureId === building.canonicalBuildingId)!;
      // A measurement taken against a stale plan is not evidence for this one.
      expect(asset.source.kind === "facade-plan" ? asset.source.planHashSha256 : null).toBe(building.planHashSha256);
      expect(Object.keys(building.lods).sort()).toEqual(["lod_0", "lod_1"]);
      for (const lod of Object.values(building.lods)) {
        expect(lod.boundsASolid).toBe(true);
        expect(lod.outwardNormalsConsistent).toBe(true);
        expect(lod.volumeDeviation).toBeLessThanOrEqual(volume.relativeTolerance);
      }
    }

    const reimport = JSON.parse(readText(`${root}blender-reimport-up-axis.json`)) as {
      toleranceMeters: number; files: Array<{ upAxisIsYUpInFile: boolean; maxBoundsDeviationMeters: number; zUpHypothesisDeviationMeters: number; positionsOnlyInTextured: number; positionsOnlyInUntextured: number }>;
    };
    expect(reimport.files).toHaveLength(28);
    for (const file of reimport.files) {
      expect(file.upAxisIsYUpInFile).toBe(true);
      expect(file.maxBoundsDeviationMeters).toBeLessThanOrEqual(reimport.toleranceMeters);
      // Adding TEXCOORD_0 moved no vertex: the textured file lands on exactly the
      // points its byte-frozen untextured predecessor lands on.
      expect(file.positionsOnlyInTextured + file.positionsOnlyInUntextured).toBe(0);
      // The control: a Z-up file would have landed nowhere near this.
      expect(file.zUpHypothesisDeviationMeters).toBeGreaterThan(reimport.toleranceMeters);
    }

    const textures = JSON.parse(readText(`${root}blender-texture-reimport.json`)) as {
      profile: string; files: Array<{ lodId: string; importedWithoutError: boolean; expectsUvLayer: boolean; uvLayerPresent: boolean; sampledImages: Array<{ widthPixels: number; heightPixels: number }> }>;
    };
    expect(textures.profile).toBe(PROCEDURAL_TEXTURE_PROFILE);
    expect(textures.files).toHaveLength(28);
    for (const file of textures.files) {
      // An INDEPENDENT reader — Blender's own glTF importer — accepted the file.
      expect(file.importedWithoutError, file.lodId).toBe(true);
      expect(file.uvLayerPresent, file.lodId).toBe(file.expectsUvLayer);
      expect(file.sampledImages.length > 0, file.lodId).toBe(file.lodId === "lod_0");
      for (const image of file.sampledImages) {
        expect(image.widthPixels).toBe(PROCEDURAL_TEXTURE_TILE_PIXELS);
        expect(image.heightPixels).toBe(PROCEDURAL_TEXTURE_TILE_PIXELS);
      }
    }

    const inventory = JSON.parse(readText(`${root}blender-evidence-inventory.json`)) as { fileCount: number; files: Array<{ path: string; sha256: string }> };
    expect(inventory.files).toHaveLength(inventory.fileCount);
    expect(inventory.files.every((entry) => /^[a-f0-9]{64}$/u.test(entry.sha256))).toBe(true);
    expect(inventory.files.filter((entry) => entry.path.includes("/renders/")).length).toBeGreaterThanOrEqual(6);
  });

  it("reports the byte cost texturing actually adds", () => {
    // Texturing is not free and the record says so out loud. The image bytes are
    // the minority of the cost; TEXCOORD_0 is the majority. See ADR 0032.
    const images = CENSUS.buildings.reduce((sum, row) => sum + row.lods.reduce((inner, lod) => inner + lod.imageByteTotal, 0), 0);
    const delta = CENSUS.summary.declaredTotalBytes - CENSUS.summary.v3DeclaredTotalBytes;
    expect(delta).toBeGreaterThan(0);
    expect(images).toBeLessThan(delta / 2);
  });
});

/**
 * One mid-size building, tessellated ONCE and shared by both UV tests.
 *
 * The Empire State Building would exercise the same code with 102,338 triangles
 * and starve the shared vitest worker pool; a 961-quad neighbour proves the same
 * two properties, because both are about how any two coplanar faces relate.
 */
let cachedGeometry: ReturnType<typeof v3GeometryForGlb> | null = null;
let cachedPlan: ReturnType<typeof buildV3Plan>["plan"] | null = null;
function texturedGeometry(): { geometry: ReturnType<typeof v3GeometryForGlb>; plan: NonNullable<typeof cachedPlan> } {
  if (!cachedGeometry || !cachedPlan) {
    const building = readPilotBuildings(releaseJson as unknown).find((entry) => entry.canonicalBuildingId === "doitt:39969")!;
    cachedPlan = buildV3Plan(building).plan;
    cachedGeometry = v3GeometryForGlb(cachedPlan, tessellateV3Plan(cachedPlan, { includeRecesses: true }), { yUp: false, texture: PROCEDURAL_TEXTURE_PROFILE });
  }
  return { geometry: cachedGeometry, plan: cachedPlan };
}

describe("UV projection is continuous across the faces of one wall", () => {
  it("gives a shared vertex the same UV in every coplanar face that touches it", () => {
    // The failure this guards against is the obvious implementation: project
    // each face from its own first corner. That restarts the pattern at every
    // quad, which on this grammar means a visible seam at every bay and every
    // floor. Projecting from ABSOLUTE coordinates makes the shared vertices of
    // two coplanar faces agree exactly, which is what this measures.
    const textured = texturedGeometry().geometry.quads.filter((quad) => quad.uv !== undefined);
    expect(textured.length).toBeGreaterThan(500);

    // Grouped on the EXACT plane, not a rounded one: two faces whose normals
    // differ in the ninth decimal are different planes and legitimately get
    // different projections, so bucketing them together would measure the test's
    // own rounding instead of the writer's continuity.
    const key = (values: readonly number[]): string => values.map((value) => value.toFixed(9)).join(",");
    const seen = new Map<string, [number, number]>();
    let shared = 0;
    let worst = 0;
    for (const quad of textured) {
      const [a, b, c] = quad.corners;
      const edge1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const;
      const edge2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as const;
      const normal = [edge1[1] * edge2[2] - edge1[2] * edge2[1], edge1[2] * edge2[0] - edge1[0] * edge2[2], edge1[0] * edge2[1] - edge1[1] * edge2[0]] as const;
      const length = Math.sqrt(normal[0] ** 2 + normal[1] ** 2 + normal[2] ** 2);
      if (length === 0) continue;
      const unit = normal.map((value) => value / length);
      const plane = key([...unit, unit[0]! * a[0] + unit[1]! * a[1] + unit[2]! * a[2]]);
      quad.corners.forEach((corner, index) => {
        const uv = quad.uv![index]!;
        // Compared at SHIPPED precision. The writer quantises UVs to float32, so
        // agreement there is agreement in the bytes; comparing the doubles would
        // measure arithmetic that never reaches the file.
        const shippedU = Math.fround(uv[0]);
        const shippedV = Math.fround(uv[1]);
        const identity = `${quad.materialIndex}|${plane}|${key(corner)}`;
        const previous = seen.get(identity);
        if (previous) { shared += 1; worst = Math.max(worst, Math.abs(previous[0] - shippedU), Math.abs(previous[1] - shippedV)); }
        else seen.set(identity, [shippedU, shippedV]);
      });
    }
    expect(shared).toBeGreaterThan(100);
    // Exact agreement in the shipped bytes: the basis is a function of the face
    // normal alone, so two faces in the identical plane project a shared vertex
    // onto the identical float32 UV and the coursing runs straight across.
    expect(worst).toBe(0);
  });

  it("keeps the projection to real scale: one UV unit is exactly one tile module", () => {
    // The projection is an isometry into the face's plane, so a face edge and
    // the UV edge it produces must measure the same length once the UV is scaled
    // back by the tile's millimetre extent. If they diverge, the motif is being
    // stretched and its stated module size is a fiction.
    const { geometry, plan } = texturedGeometry();
    const classPerMaterial = plan.materials.map((material) => v3TextureClassFor(plan.styleClass, material.id));
    const checked = geometry.quads.filter((quad) => quad.uv !== undefined).slice(0, 200);
    expect(checked.length).toBeGreaterThan(20);
    for (const quad of checked) {
      const tile = proceduralTextureCatalog().get(classPerMaterial[quad.materialIndex]!)!;
      for (const [from, to] of [[0, 1], [1, 2], [2, 3], [3, 0]] as const) {
        const edgeMm = Math.sqrt([0, 1, 2].reduce((sum, axis) => sum + ((quad.corners[to]![axis]! - quad.corners[from]![axis]!) * 1_000) ** 2, 0));
        const uvMm = Math.hypot((quad.uv![to]![0] - quad.uv![from]![0]) * tile.tileUMm, (quad.uv![to]![1] - quad.uv![from]![1]) * tile.tileVMm);
        expect(uvMm).toBeCloseTo(edgeMm, 6);
      }
    }
  });
});

describe("the writer's untextured path is untouched by the texture branch", () => {
  const MATERIALS: readonly CanonicalGlbMaterial[] = [
    { baseColorFactor: [0.73, 0.48, 0.38, 1], metallicFactor: 0, roughnessFactor: 0.76 },
    { baseColorFactor: [0.44, 0.53, 0.58, 1], metallicFactor: 0.08, roughnessFactor: 0.18 },
  ];
  const QUADS: readonly CanonicalGlbQuad[] = [
    { materialIndex: 0, corners: [[0, 0, 0], [3, 0, 0], [3, 4, 0], [0, 4, 0]] },
    { materialIndex: 1, corners: [[3, 0, 0], [6, 0, 0], [6, 4, 0], [3, 4, 0]] },
  ];

  it("drops a texture set that no used material references, byte for byte", () => {
    // An image nothing draws must not ride along. The strongest form of that
    // claim is that the output is IDENTICAL to never having passed one.
    const plain = writeCanonicalGlb({ quads: QUADS, materials: MATERIALS, metadata: { note: "plain" } });
    const orphan = writeCanonicalGlb({
      quads: QUADS, materials: MATERIALS, metadata: { note: "plain" },
      textures: { images: [{ mimeType: "image/png", bytes: proceduralTextureCatalog().get("brick-running-bond")!.pngBytes }], materialImage: [null, null] },
    });
    expect(sha256HexBytes(orphan.bytes)).toBe(sha256HexBytes(plain.bytes));
    expect(orphan.counts.textureCount).toBe(0);
  });

  it("refuses a textured material whose faces carry no UVs", () => {
    expect(() => writeCanonicalGlb({
      quads: QUADS, materials: MATERIALS, metadata: {},
      textures: { images: [{ mimeType: "image/png", bytes: proceduralTextureCatalog().get("brick-running-bond")!.pngBytes }], materialImage: [0, null] },
    })).toThrow(/no UV coordinates/u);
  });

  it("writes REPEAT wrapping and a FLOAT VEC2 TEXCOORD_0 when it does texture", () => {
    const uvQuads: readonly CanonicalGlbQuad[] = [{ ...QUADS[0]!, uv: [[0, 0], [1, 0], [1, 1], [0, 1]] }];
    const written = writeCanonicalGlb({
      quads: uvQuads, materials: MATERIALS, metadata: {},
      textures: { images: [{ mimeType: "image/png", bytes: proceduralTextureCatalog().get("limestone-ashlar")!.pngBytes }], materialImage: [0, null] },
    });
    const view = new DataView(written.bytes.buffer, written.bytes.byteOffset, written.bytes.byteLength);
    const json = JSON.parse(new TextDecoder().decode(written.bytes.subarray(20, 20 + view.getUint32(12, true)))) as {
      samplers: Array<Record<string, number>>; textures: Array<Record<string, number>>; images: Array<Record<string, unknown>>;
      accessors: Array<Record<string, unknown>>; meshes: Array<{ primitives: Array<{ attributes: Record<string, number> }> }>;
      bufferViews: Array<Record<string, number>>;
    };
    expect(json.samplers).toEqual([{ wrapS: 10497, wrapT: 10497 }]);
    expect(json.textures).toEqual([{ sampler: 0, source: 0 }]);
    expect(json.images[0]!.mimeType).toBe("image/png");
    const uvAccessor = json.accessors[json.meshes[0]!.primitives[0]!.attributes.TEXCOORD_0!]!;
    expect(uvAccessor.componentType).toBe(5126);
    expect(uvAccessor.type).toBe("VEC2");
    // The image view carries neither a geometry target nor a stride, and sits
    // after every geometry view.
    const imageView = json.bufferViews[json.images[0]!.bufferView as number]!;
    expect(imageView.target).toBeUndefined();
    expect(imageView.byteStride).toBeUndefined();
    expect(imageView.byteOffset).toBe(Math.max(...json.bufferViews.filter((candidate) => candidate.target !== undefined).map((candidate) => candidate.byteOffset! + candidate.byteLength!)));
    expect(written.counts.textureCount).toBe(1);
  });
});
