/**
 * The shared external detail-tile gate (T002).
 *
 * The mechanism this suite guards is narrow and load-bearing: instead of
 * embedding the same 16,580-byte tile into every GLB that draws it, a release
 * declares the tile ONCE as a `role: "texture"` artifact and every GLB
 * references it by relative URI. Cesium keys an embedded image by the owning
 * model's absolute URL and an external image by its own resolved absolute URI,
 * so this is the difference between 941 GPU textures and four.
 *
 * Moving the bytes out of the GLB moves WHERE the honesty replay happens, and
 * this suite exists to prove it never moves WHETHER it happens. The claim is
 * carried in two halves that are each tested here and each tested negatively:
 * the URI must resolve to a declared texture artifact of this package, and that
 * artifact must be byte-identical to what this repository's rasterizer produces.
 * A one-byte mutation must fail closed.
 */
import { describe, expect, it } from "vitest";
import {
  ASSEMBLY_ISSUE_TEXTURE_ARTIFACT_ORPHAN,
  ASSEMBLY_ISSUE_TEXTURE_ARTIFACT_REPLAY_MISMATCH,
  ASSEMBLY_ISSUE_TEXTURE_URI_CONTAINMENT_FORBIDDEN,
  ASSEMBLY_ISSUE_TEXTURE_PROVENANCE_REQUIRED,
  ASSEMBLY_ISSUE_TEXTURE_SAMPLER_FILTER_REQUIRED,
  ASSEMBLY_ISSUE_TEXTURE_URI_SHAPE_FORBIDDEN,
  ASSEMBLY_ISSUE_TEXTURE_URI_UNDECLARED,
  parseGlbV2,
  replayMultiLodAssembly,
  replaySharedTextureArtifact,
  validateMultiLodAssembly,
  type MultiLodAssemblyManifest,
} from "./multi-lod-assembly.ts";
import { GLB_SAMPLER_FILTER_TRILINEAR, writeCanonicalGlb } from "./canonical-glb.ts";
import {
  PROCEDURAL_TEXTURE_CLASSES,
  proceduralTextureCatalog,
  proceduralTextureProvenance,
} from "./procedural-texture.ts";

const H = "a".repeat(64);
const PLAN = "b".repeat(64);
const BOX = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
const CELL = "cell:1";
const TILE_CLASS = PROCEDURAL_TEXTURE_CLASSES[0];
const TEXTURE_REF = "public/textures/brick-running-bond.png";
const TEXTURE_URI = "../textures/brick-running-bond.png";

async function digest(bytes: Uint8Array): Promise<string> {
  const value = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(value)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

function metadata(lodId: string, withProvenance = true): Record<string, unknown> {
  return {
    canonicalFeatureId: "building:1", lodId, ownerCellId: CELL, inventoryId: "inventory:1", inventoryHashSha256: H,
    evidenceShardId: "evidence:1", truthTiers: ["generated"], sourceDates: { capturedAt: "2026-01-01T00:00:00.000Z", updatedAt: null },
    predecessor: { id: "asset:v0", checksumSha256: H }, uncertainty: "Generated geometry is not observed truth.", planHashSha256: PLAN,
    ...(withProvenance ? { textureProvenance: proceduralTextureProvenance() } : {}),
  };
}

/** A real closed-profile GLB whose single material samples one EXTERNAL tile. */
function uriGlb(lodId: string, options: { uri?: string; provenance?: boolean; filter?: boolean } = {}): Uint8Array {
  return writeCanonicalGlb({
    quads: [{ materialIndex: 0, corners: [[0, 0, 0], [4, 0, 0], [4, 9, 0], [0, 9, 0]], uv: [[0, 0], [40, 0], [40, 90], [0, 90]] }],
    materials: [{ baseColorFactor: [0.73, 0.48, 0.38, 1], metallicFactor: 0, roughnessFactor: 0.76 }],
    metadata: metadata(lodId, options.provenance ?? true),
    uriTextures: {
      images: [{ mimeType: "image/png", uri: options.uri ?? TEXTURE_URI }],
      materialImage: [0],
      ...((options.filter ?? true) ? { filter: GLB_SAMPLER_FILTER_TRILINEAR } : {}),
    },
  }).bytes;
}

function tileset(refs: string[]): Uint8Array {
  const chain = refs.reduce((child, uri, index) => ({ boundingVolume: { box: BOX }, geometricError: index === 0 ? 0 : index * 2, refine: "REPLACE", content: { uri }, ...(child ? { children: [child] } : {}) }), null as Record<string, unknown> | null);
  return new TextEncoder().encode(JSON.stringify({
    asset: { version: "1.1" }, geometricError: 10,
    root: { boundingVolume: { box: BOX }, geometricError: 10, refine: "REPLACE", children: [chain] },
  }));
}

async function fixture(overrides: { lod0?: Uint8Array; lod1?: Uint8Array; tileBytes?: Uint8Array; declareTexture?: boolean; extraTexture?: boolean } = {}): Promise<{ manifest: MultiLodAssemblyManifest; contents: Map<string, Uint8Array> }> {
  const lod0 = overrides.lod0 ?? uriGlb("lod-0");
  const lod1 = overrides.lod1 ?? uriGlb("lod-1");
  const tiles = tileset(["../assets/building-1-lod0.glb", "../assets/building-1-lod1.glb"]);
  const tileBytes = overrides.tileBytes ?? proceduralTextureCatalog().get(TILE_CLASS)!.pngBytes;
  const artifacts = [
    { logicalId: "tileset:1", role: "tileset-json" as const, relativeRef: "public/tiles/tileset.json", byteSize: tiles.byteLength, checksumSha256: await digest(tiles), ownerCellId: null },
    { logicalId: "glb:0", role: "glb" as const, relativeRef: "public/assets/building-1-lod0.glb", byteSize: lod0.byteLength, checksumSha256: await digest(lod0), ownerCellId: CELL },
    { logicalId: "glb:1", role: "glb" as const, relativeRef: "public/assets/building-1-lod1.glb", byteSize: lod1.byteLength, checksumSha256: await digest(lod1), ownerCellId: CELL },
    ...((overrides.declareTexture ?? true) ? [{ logicalId: `texture:${TILE_CLASS}`, role: "texture" as const, relativeRef: TEXTURE_REF, byteSize: tileBytes.byteLength, checksumSha256: await digest(tileBytes), ownerCellId: null }] : []),
  ];
  const contents = new Map<string, Uint8Array>([
    ["public/tiles/tileset.json", tiles],
    ["public/assets/building-1-lod0.glb", lod0],
    ["public/assets/building-1-lod1.glb", lod1],
  ]);
  if (overrides.declareTexture ?? true) contents.set(TEXTURE_REF, tileBytes);
  if (overrides.extraTexture) {
    const spare = proceduralTextureCatalog().get(PROCEDURAL_TEXTURE_CLASSES[1])!.pngBytes;
    artifacts.push({ logicalId: "texture:spare", role: "texture" as const, relativeRef: "public/textures/limestone-ashlar.png", byteSize: spare.byteLength, checksumSha256: await digest(spare), ownerCellId: null });
    contents.set("public/textures/limestone-ashlar.png", spare);
  }
  const quality = { triangleCount: 2, materialCount: 1, textureCount: 1, budgets: { maxTriangles: 2, maxMaterials: 1, maxTextures: 1 } };
  const manifest: MultiLodAssemblyManifest = {
    schemaVersion: "1.0", packageId: "shared-texture-fixture", audience: "public", generatedAt: "2026-08-12T00:00:00.000Z", immutable: true,
    release: { rootId: "public:root", rootChecksumSha256: H, releaseId: "release:t1", cityId: "city:fixture", configId: "config:fixture", privatePredecessor: { id: "private:root", checksumSha256: H } },
    baseIdentitySet: { id: "base:1", checksumSha256: H }, ownershipLedger: { id: "ledger:1", checksumSha256: H },
    cells: [{ cellId: CELL, cellRelease: { id: "cell-release:1", checksumSha256: H }, predecessor: { id: "cell-release:0", checksumSha256: H }, buildingIds: ["building:1"], membershipChecksumSha256: H }],
    assets: [{
      canonicalFeatureId: "building:1", ownerCellId: CELL, inventoryId: "inventory:1", inventoryHashSha256: H, evidenceShardId: "evidence:1", truthTiers: ["generated"],
      sourceDates: { capturedAt: "2026-01-01T00:00:00.000Z", updatedAt: null }, predecessor: { id: "asset:v0", checksumSha256: H }, uncertainty: "Generated geometry is not observed truth.",
      source: { kind: "facade-plan", planId: "plan:1", planHashSha256: PLAN },
      lods: [
        { lodId: "lod-0", artifactRef: "public/assets/building-1-lod0.glb", geometricErrorMeters: 0, maxDistanceMeters: 100, eligible: true, quality, silhouette: null },
        { lodId: "lod-1", artifactRef: "public/assets/building-1-lod1.glb", geometricErrorMeters: 2, maxDistanceMeters: null, eligible: true, quality, silhouette: { status: "authoring-declared", method: "projected-silhouette-ratio", metricVersion: "1.0", planHashSha256: PLAN, viewIds: ["north", "south"], deviationRatio: 0.015, maximumRatio: 0.02 } },
      ],
    }],
    artifacts, tilesetRef: "public/tiles/tileset.json", declaredTotalBytes: artifacts.reduce((sum, artifact) => sum + artifact.byteSize, 0),
  };
  return { manifest, contents };
}

const POLICY = { textureAdmission: "procedural-replay" as const };

function messages(result: Awaited<ReturnType<typeof replayMultiLodAssembly>>): string {
  return result.ok ? "" : result.issues.map((entry) => `${entry.path}: ${entry.message}`).join("\n");
}

describe("the shared external detail-tile gate", () => {
  it("admits a package whose GLBs reference one declared, replayed texture artifact", async () => {
    const { manifest, contents } = await fixture();
    expect(validateMultiLodAssembly(manifest, POLICY).ok).toBe(true);
    const replay = await replayMultiLodAssembly(manifest, contents, POLICY);
    expect(messages(replay)).toBe("");
    expect(replay.ok).toBe(true);
  });

  it("carries no image bytes in any GLB, which is the whole point", async () => {
    const parsed = parseGlbV2(uriGlb("lod-0"), { allowExternalImageUri: true });
    expect(parsed.json.images).toStrictEqual([{ uri: TEXTURE_URI, mimeType: "image/png" }]);
    // Every bufferView is read by an accessor: no image view exists, so the
    // 16,580-byte tile appears exactly once per RELEASE rather than per asset.
    const views = (parsed.json.bufferViews as unknown[]).length;
    const referenced = new Set((parsed.json.accessors as Array<{ bufferView: number }>).map((accessor) => accessor.bufferView));
    expect(referenced.size).toBe(views);
    expect(parsed.bin.byteLength).toBeLessThan(proceduralTextureCatalog().get(TILE_CLASS)!.pngBytes.byteLength);
  });

  it("refuses a URI image when the caller has not opted in, so every frozen path is unchanged", () => {
    expect(() => parseGlbV2(uriGlb("lod-0"))).toThrow(/image/iu);
  });

  it("refuses a URI that escapes the audience root", async () => {
    // `public/assets/` + `../../elsewhere/` lands outside `public/` entirely.
    const { manifest, contents } = await fixture({ lod0: uriGlb("lod-0", { uri: "../../elsewhere/tile.png" }) });
    const replay = await replayMultiLodAssembly(manifest, contents, POLICY);
    expect(replay.ok).toBe(false);
    expect(messages(replay)).toContain(ASSEMBLY_ISSUE_TEXTURE_URI_CONTAINMENT_FORBIDDEN);
  });

  it("refuses a contained URI that names no declared texture artifact", async () => {
    for (const uri of ["../textures/not-declared.png", "tile.png", "../assets/building-1-lod0.glb"]) {
      const { manifest, contents } = await fixture({ lod0: uriGlb("lod-0", { uri }) });
      const replay = await replayMultiLodAssembly(manifest, contents, POLICY);
      expect(replay.ok).toBe(false);
      expect(messages(replay)).toContain(ASSEMBLY_ISSUE_TEXTURE_URI_UNDECLARED);
    }
  });

  it("fails closed on a ONE-BYTE mutation of the declared texture artifact", async () => {
    const clean = proceduralTextureCatalog().get(TILE_CLASS)!.pngBytes;
    // Mutate a byte deep inside the IDAT stream: the PNG still parses, the
    // length is unchanged, and only replay can tell the difference.
    const tampered = new Uint8Array(clean);
    tampered[clean.byteLength - 8] = tampered[clean.byteLength - 8]! ^ 0x01;
    expect(tampered.byteLength).toBe(clean.byteLength);
    expect(() => replaySharedTextureArtifact(tampered)).toThrow(ASSEMBLY_ISSUE_TEXTURE_ARTIFACT_REPLAY_MISMATCH);
    const { manifest, contents } = await fixture({ tileBytes: tampered });
    const replay = await replayMultiLodAssembly(manifest, contents, POLICY);
    expect(replay.ok).toBe(false);
    expect(messages(replay)).toContain("artifact-replay-mismatch");
  });

  it("replays every catalogue class and refuses anything else", () => {
    for (const textureClass of PROCEDURAL_TEXTURE_CLASSES) {
      expect(replaySharedTextureArtifact(proceduralTextureCatalog().get(textureClass)!.pngBytes)).toBe(textureClass);
    }
    // A real, well-formed PNG that this rasterizer did not produce.
    expect(() => replaySharedTextureArtifact(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toThrow(ASSEMBLY_ISSUE_TEXTURE_ARTIFACT_REPLAY_MISMATCH);
  });

  it("refuses a declared texture artifact no GLB draws", async () => {
    const { manifest, contents } = await fixture({ extraTexture: true });
    const replay = await replayMultiLodAssembly(manifest, contents, POLICY);
    expect(replay.ok).toBe(false);
    expect(messages(replay)).toContain(ASSEMBLY_ISSUE_TEXTURE_ARTIFACT_ORPHAN);
  });

  it("still requires provenance and the declared sampler pair", async () => {
    const noProvenance = await fixture({ lod0: uriGlb("lod-0", { provenance: false }) });
    expect(messages(await replayMultiLodAssembly(noProvenance.manifest, noProvenance.contents, POLICY))).toContain(ASSEMBLY_ISSUE_TEXTURE_PROVENANCE_REQUIRED);
    const noFilter = await fixture({ lod0: uriGlb("lod-0", { filter: false }) });
    expect(messages(await replayMultiLodAssembly(noFilter.manifest, noFilter.contents, POLICY))).toContain(ASSEMBLY_ISSUE_TEXTURE_SAMPLER_FILTER_REQUIRED);
  });

  it("refuses a GLB that mixes an embedded tile into the shared profile", async () => {
    const mixed = writeCanonicalGlb({
      quads: [{ materialIndex: 0, corners: [[0, 0, 0], [4, 0, 0], [4, 9, 0], [0, 9, 0]], uv: [[0, 0], [40, 0], [40, 90], [0, 90]] }],
      materials: [{ baseColorFactor: [0.73, 0.48, 0.38, 1], metallicFactor: 0, roughnessFactor: 0.76 }],
      metadata: metadata("lod-0"),
      textures: { images: [{ mimeType: "image/png", bytes: proceduralTextureCatalog().get(TILE_CLASS)!.pngBytes }], materialImage: [0], filter: GLB_SAMPLER_FILTER_TRILINEAR },
    }).bytes;
    const { manifest, contents } = await fixture({ lod0: mixed });
    const replay = await replayMultiLodAssembly(manifest, contents, POLICY);
    expect(replay.ok).toBe(false);
    expect(messages(replay)).toContain(ASSEMBLY_ISSUE_TEXTURE_URI_SHAPE_FORBIDDEN);
  });

  it("keeps a shared texture out of every cell byte budget", async () => {
    const { manifest, contents } = await fixture();
    const replay = await replayMultiLodAssembly(manifest, contents, POLICY);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    const glbBytes = manifest.artifacts.filter((artifact) => artifact.role === "glb").reduce((sum, artifact) => sum + artifact.byteSize, 0);
    // The tile belongs to the release, not to the cell that happens to draw it
    // first; charging it per cell would double-count it across every cell.
    expect(replay.value.cellBytes[CELL]).toBe(glbBytes);
  });

  it("refuses a texture artifact that claims a cell", async () => {
    const { manifest } = await fixture();
    const owned = { ...manifest, artifacts: manifest.artifacts.map((artifact) => artifact.role === "texture" ? { ...artifact, ownerCellId: CELL } : artifact) };
    const result = validateMultiLodAssembly(owned, POLICY);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((entry) => entry.message.includes("Shared texture ownerCellId must be null."))).toBe(true);
  });
});
