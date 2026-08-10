import { describe, expect, it } from "vitest";
import {
  multiLodAssemblyFingerprint,
  parseGlbV2,
  replayMultiLodAssembly,
  serializeMultiLodAssembly,
  validateMultiLodAssembly,
  type MultiLodAssemblyManifest,
} from "./multi-lod-assembly.ts";

const H = "a".repeat(64);
const PLAN = "b".repeat(64);
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const BOX = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];

async function digest(bytes: Uint8Array): Promise<string> {
  const value = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(value)].map((part) => part.toString(16).padStart(2, "0")).join("");
}
function chunk(value: Uint8Array, pad = 0x20): Uint8Array {
  const result = new Uint8Array(Math.ceil(value.byteLength / 4) * 4); result.fill(pad); result.set(value); return result;
}
function glb(metadata: Record<string, unknown>, options: { indexCount?: number; externalBuffer?: boolean; emptyRanges?: boolean; outOfRangeIndex?: boolean; nulPadding?: boolean; invalidStride?: boolean; extension?: boolean } = {}): Uint8Array {
  const indexCount = options.indexCount ?? 3;
  const json = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: 48, ...(options.externalBuffer ? { uri: "bad.bin" } : {}) }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: options.emptyRanges ? 0 : 36, ...(options.invalidStride ? { byteStride: 14 } : {}) }, { buffer: 0, byteOffset: options.emptyRanges ? 0 : 36, byteLength: options.emptyRanges ? 0 : 12 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 1, componentType: 5125, count: indexCount, type: "SCALAR" },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4, material: 0 }] }],
    materials: [{}], textures: [], extras: { urbanDigitalTwin: metadata }, ...(options.extension ? { extensionsUsed: ["EXT_meshopt_compression"] } : {}),
  };
  if (options.nulPadding) { const asset = json.asset as { version: string; generator?: string }; while (new TextEncoder().encode(JSON.stringify(json)).byteLength % 4 === 0) asset.generator = `${asset.generator ?? ""}x`; }
  const jsonBytes = chunk(new TextEncoder().encode(JSON.stringify(json)), options.nulPadding ? 0 : 0x20); const bin = new Uint8Array(48); if (options.outOfRangeIndex) new DataView(bin.buffer).setUint32(36, 3, true); const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const result = new Uint8Array(total); const view = new DataView(result.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.length, true); view.setUint32(16, 0x4e4f534a, true); result.set(jsonBytes, 20);
  const offset = 20 + jsonBytes.length; view.setUint32(offset, bin.length, true); view.setUint32(offset + 4, 0x004e4942, true); result.set(bin, offset + 8);
  return result;
}
function metadata(lodId: string): Record<string, unknown> {
  return {
    canonicalFeatureId: "building:1", lodId, ownerCellId: "cell:1", inventoryId: "inventory:1", inventoryHashSha256: H,
    evidenceShardId: "evidence:1", truthTiers: ["generated"], sourceDates: { capturedAt: "2026-01-01T00:00:00.000Z", updatedAt: null },
    predecessor: { id: "asset:v0", checksumSha256: H }, uncertainty: "Generated geometry is not observed truth.", planHashSha256: PLAN,
  };
}
function tileset(refs: string[], transform = IDENTITY, leafError = 0): Uint8Array {
  const chain = refs.reduce((child, uri, index) => ({ boundingVolume: { box: BOX }, geometricError: index === 0 ? leafError : index * 2, refine: "REPLACE", content: { uri }, ...(child ? { children: [child] } : {}) }), null as Record<string, unknown> | null);
  return new TextEncoder().encode(JSON.stringify({
    asset: { version: "1.1" }, geometricError: 10,
    root: { boundingVolume: { box: BOX }, geometricError: 10, refine: "REPLACE", transform, children: [chain] },
  }));
}
async function fixture(overrides: { tileset?: Uint8Array; lod0?: Uint8Array; lod1?: Uint8Array; audience?: "private" | "public" } = {}): Promise<{ manifest: MultiLodAssemblyManifest; contents: Map<string, Uint8Array> }> {
  const audience = overrides.audience ?? "private"; const prefix = audience;
  const lod0 = overrides.lod0 ?? glb(metadata("lod-0")); const lod1 = overrides.lod1 ?? glb(metadata("lod-1"));
  const tiles = overrides.tileset ?? tileset(["../assets/building-1-lod0.glb", "../assets/building-1-lod1.glb"]);
  const artifacts = [
    { logicalId: "tileset:1", role: "tileset-json" as const, relativeRef: `${prefix}/tiles/tileset.json`, byteSize: tiles.byteLength, checksumSha256: await digest(tiles), ownerCellId: null },
    { logicalId: "glb:0", role: "glb" as const, relativeRef: `${prefix}/assets/building-1-lod0.glb`, byteSize: lod0.byteLength, checksumSha256: await digest(lod0), ownerCellId: "cell:1" },
    { logicalId: "glb:1", role: "glb" as const, relativeRef: `${prefix}/assets/building-1-lod1.glb`, byteSize: lod1.byteLength, checksumSha256: await digest(lod1), ownerCellId: "cell:1" },
  ];
  const manifest: MultiLodAssemblyManifest = {
    schemaVersion: "1.0", packageId: "fixture-package", audience, generatedAt: "2026-08-10T00:00:00.000Z", immutable: true,
    release: { rootId: `${audience}:root`, rootChecksumSha256: H, releaseId: "release:1", cityId: "city:fixture", configId: "config:fixture", privatePredecessor: audience === "public" ? { id: "private:root", checksumSha256: H } : null },
    baseIdentitySet: { id: "base:1", checksumSha256: H }, ownershipLedger: { id: "ledger:1", checksumSha256: H },
    cells: [{ cellId: "cell:1", cellRelease: { id: "cell-release:1", checksumSha256: H }, predecessor: { id: "cell-release:0", checksumSha256: H }, buildingIds: ["building:1"], membershipChecksumSha256: H }],
    assets: [{
      canonicalFeatureId: "building:1", ownerCellId: "cell:1", inventoryId: "inventory:1", inventoryHashSha256: H, evidenceShardId: "evidence:1", truthTiers: ["generated"],
      sourceDates: { capturedAt: "2026-01-01T00:00:00.000Z", updatedAt: null }, predecessor: { id: "asset:v0", checksumSha256: H }, uncertainty: "Generated geometry is not observed truth.",
      source: { kind: "facade-plan", planId: "plan:1", planHashSha256: PLAN },
      lods: [
        { lodId: "lod-0", artifactRef: `${prefix}/assets/building-1-lod0.glb`, geometricErrorMeters: 0, maxDistanceMeters: 100, eligible: true, quality: { triangleCount: 1, materialCount: 1, textureCount: 0, budgets: { maxTriangles: 2, maxMaterials: 1, maxTextures: 0 } }, silhouette: null },
        { lodId: "lod-1", artifactRef: `${prefix}/assets/building-1-lod1.glb`, geometricErrorMeters: 2, maxDistanceMeters: null, eligible: true, quality: { triangleCount: 1, materialCount: 1, textureCount: 0, budgets: { maxTriangles: 1, maxMaterials: 1, maxTextures: 0 } }, silhouette: { status: "authoring-declared", method: "projected-silhouette-ratio", metricVersion: "1.0", planHashSha256: PLAN, viewIds: ["north", "south"], deviationRatio: 0.015, maximumRatio: 0.02 } },
      ],
    }], artifacts, tilesetRef: `${prefix}/tiles/tileset.json`, declaredTotalBytes: artifacts.reduce((sum, artifact) => sum + artifact.byteSize, 0),
  };
  return { manifest, contents: new Map([[artifacts[0]!.relativeRef, tiles], [artifacts[1]!.relativeRef, lod0], [artifacts[2]!.relativeRef, lod1]]) };
}
function clone<T>(value: T): T { return structuredClone(value); }

describe("multi-LOD immutable assembly", () => {
  it("replays raw GLB and 3D Tiles bytes deterministically with complete accounting", async () => {
    const { manifest, contents } = await fixture(); const first = await replayMultiLodAssembly(manifest, contents);
    const reverse = await replayMultiLodAssembly(manifest, new Map([...contents].reverse()));
    expect(first.ok).toBe(true); expect(reverse.ok).toBe(true);
    if (!first.ok || !reverse.ok) return;
    expect(first.value.fingerprintSha256).toBe(reverse.value.fingerprintSha256);
    expect(first.value.totalBytes).toBe(manifest.declaredTotalBytes);
    expect(first.value.verifiedArtifacts).toHaveLength(3);
    expect(first.value.cellBytes["cell:1"]).toBe(manifest.artifacts.filter((item) => item.role === "glb").reduce((sum, item) => sum + item.byteSize, 0));
  });

  it("canonicalizes unordered manifest collections", async () => {
    const { manifest } = await fixture(); const reordered = { ...manifest, artifacts: [...manifest.artifacts].reverse(), cells: [...manifest.cells].reverse(), assets: [...manifest.assets].reverse() };
    expect(multiLodAssemblyFingerprint(reordered)).toBe(multiLodAssemblyFingerprint(manifest));
    expect(serializeMultiLodAssembly(reordered)).toBe(serializeMultiLodAssembly(manifest));
    const first = clone(manifest); first.cells.push({ ...first.cells[0]!, cellId: "é", buildingIds: [] });
    const second = clone(first); second.cells.push({ ...second.cells[0]!, cellId: "é", buildingIds: [] }); second.cells.reverse();
    const third = clone(second); third.cells.reverse();
    expect(multiLodAssemblyFingerprint(second)).toBe(multiLodAssemblyFingerprint(third));
    const viewsReordered = clone(manifest); viewsReordered.assets[0]!.lods[1]!.silhouette!.viewIds.reverse();
    expect(multiLodAssemblyFingerprint(viewsReordered)).toBe(multiLodAssemblyFingerprint(manifest));
  });

  it("fails closed on unsafe/cross-audience paths and undeclared bytes", async () => {
    const { manifest, contents } = await fixture(); const unsafe = clone(manifest); unsafe.artifacts[1]!.relativeRef = "private/%2e%2e/asset.glb";
    expect(validateMultiLodAssembly(unsafe).ok).toBe(false);
    contents.set("private/assets/orphan.glb", new Uint8Array()); expect((await replayMultiLodAssembly(manifest, contents)).ok).toBe(false);
    const publicFixture = await fixture({ audience: "public" }); const leaked = clone(publicFixture.manifest); leaked.artifacts[1]!.relativeRef = "private/assets/building.glb";
    expect(validateMultiLodAssembly(leaked).ok).toBe(false);
  });

  it("fails closed on missing content and byte/hash drift", async () => {
    const { manifest, contents } = await fixture(); contents.delete(manifest.artifacts[1]!.relativeRef);
    expect((await replayMultiLodAssembly(manifest, contents)).ok).toBe(false);
    const next = await fixture(); const corrupt = next.contents.get(next.manifest.artifacts[2]!.relativeRef)!; corrupt[0] = (corrupt[0] ?? 0) ^ 1;
    expect((await replayMultiLodAssembly(next.manifest, next.contents)).ok).toBe(false);
  });

  it("rejects malformed GLB structure, external content and invalid topology", async () => {
    const good = glb(metadata("lod-0")); const malformed = good.slice(); malformed[0] = 0;
    expect(() => parseGlbV2(malformed)).toThrow(/header/iu);
    expect(() => parseGlbV2(glb(metadata("lod-0"), { externalBuffer: true }))).toThrow(/embedded|external/iu);
    expect(() => parseGlbV2(glb(metadata("lod-0"), { indexCount: 2 }))).toThrow(/topology/iu);
    expect(() => parseGlbV2(glb(metadata("lod-0"), { emptyRanges: true }))).toThrow(/range/iu);
    expect(() => parseGlbV2(glb(metadata("lod-0"), { outOfRangeIndex: true }))).toThrow(/index/iu);
    expect(() => parseGlbV2(glb(metadata("lod-0"), { nulPadding: true }))).toThrow();
    expect(() => parseGlbV2(glb(metadata("lod-0"), { invalidStride: true }))).toThrow(/bufferView|stride/iu);
    expect(() => parseGlbV2(glb(metadata("lod-0"), { extension: true }))).toThrow(/unsupported/iu);
  });

  it("binds canonical identity, truth, source dates and predecessors to each GLB", async () => {
    const wrong = metadata("lod-0"); wrong.canonicalFeatureId = "building:other";
    const built = await fixture({ lod0: glb(wrong) }); expect((await replayMultiLodAssembly(built.manifest, built.contents)).ok).toBe(false);
    const invalidTruth = clone(built.manifest); invalidTruth.assets[0]!.truthTiers = ["unknown" as never]; expect(validateMultiLodAssembly(invalidTruth).ok).toBe(false);
  });

  it("rejects invalid transforms, topology and geometric error hierarchy", async () => {
    const singular = [...IDENTITY]; singular[0] = 0;
    const transformed = await fixture({ tileset: tileset(["../assets/building-1-lod0.glb", "../assets/building-1-lod1.glb"], singular) });
    expect((await replayMultiLodAssembly(transformed.manifest, transformed.contents)).ok).toBe(false);
    const leafError = await fixture({ tileset: tileset(["../assets/building-1-lod0.glb", "../assets/building-1-lod1.glb"], IDENTITY, 1) });
    expect((await replayMultiLodAssembly(leafError.manifest, leafError.contents)).ok).toBe(false);
    const siblings = new TextEncoder().encode(JSON.stringify({ asset: { version: "1.1" }, geometricError: 10, root: { boundingVolume: { box: BOX }, geometricError: 10, refine: "REPLACE", children: ["../assets/building-1-lod0.glb", "../assets/building-1-lod1.glb"].map((uri) => ({ boundingVolume: { box: BOX }, geometricError: 0, refine: "REPLACE", content: { uri } })) } }));
    const siblingFixture = await fixture({ tileset: siblings }); expect((await replayMultiLodAssembly(siblingFixture.manifest, siblingFixture.contents)).ok).toBe(false);
    const leakedValue = JSON.parse(new TextDecoder().decode(tileset(["../assets/building-1-lod0.glb", "../assets/building-1-lod1.glb"]))) as { root: { children: Array<Record<string, unknown>> } };
    leakedValue.root.children[0]!.contents = [{ uri: "../../private/secret.glb" }]; const leakedTiles = new TextEncoder().encode(JSON.stringify(leakedValue));
    const publicLeak = await fixture({ audience: "public", tileset: leakedTiles }); expect((await replayMultiLodAssembly(publicLeak.manifest, publicLeak.contents)).ok).toBe(false);
  });

  it("rejects LOD membership drift and silhouette budget promotion", async () => {
    const { manifest } = await fixture(); const drift = clone(manifest); drift.assets[0]!.ownerCellId = "cell:other"; expect(validateMultiLodAssembly(drift).ok).toBe(false);
    const silhouette = clone(manifest); silhouette.assets[0]!.lods[1]!.silhouette!.deviationRatio = 0.021; expect(validateMultiLodAssembly(silhouette).ok).toBe(false);
    const duplicateLod = clone(manifest); duplicateLod.assets[0]!.lods[1]!.lodId = duplicateLod.assets[0]!.lods[0]!.lodId; expect(validateMultiLodAssembly(duplicateLod).ok).toBe(false);
    const duplicateArtifact = clone(manifest); duplicateArtifact.artifacts[1]!.logicalId = duplicateArtifact.artifacts[0]!.logicalId; expect(validateMultiLodAssembly(duplicateArtifact).ok).toBe(false);
  });
});
