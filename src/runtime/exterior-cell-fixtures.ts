import { sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";
import {
  EXTERIOR_COMPONENT_SCHEMA_VERSION,
  REQUIRED_EXTERIOR_COMPONENT_KINDS,
  type ExteriorApprovalEvidence,
  type ExteriorComponentInventory,
  type ExteriorEvidenceGraph,
} from "../domain/exterior-contract.ts";
import {
  EXTERIOR_RELEASE_SCHEMA_VERSION,
  type ExteriorArtifactKind,
  type ExteriorArtifactRef,
  type ExteriorReleaseGraph,
} from "../release/exterior-release.ts";
import type { AssemblyAsset, MultiLodAssemblyManifest } from "../release/multi-lod-assembly.ts";
import type { ExteriorArtifactFetcher, ExteriorBaseIdentity, ExteriorCellReleaseIndex } from "./exterior-cell-runtime.ts";

/**
 * Synthetic, obviously-fixture exterior release graph, multi-LOD assembly
 * packages, and tiny valid texture-free public GLBs. Nothing here is named like
 * a production release, so no fixture can ever substitute for one by name.
 */
export const EXTERIOR_FIXTURE_RELEASE_ID = "udt-fixture-exterior-cells";
/**
 * The base releases the running app actually loads. The fixture package is
 * synthetic geometry, but it is pinned to real base building identities so the
 * profile, canary, fallback, and picking behavior is exercisable in the app.
 */
export const EXTERIOR_FIXTURE_BASE_RELEASE_IDS = ["manhattan-citywide-20260804", "manhattan-civic-context-20260804"] as const;
export const EXTERIOR_FIXTURE_BASE_RELEASE_ID = EXTERIOR_FIXTURE_BASE_RELEASE_IDS[0];
export const EXTERIOR_FIXTURE_CITY_ID = "city:udt-fixture";
export const EXTERIOR_FIXTURE_CONFIG_ID = "config:udt-fixture";
const NOW = "2026-08-09T00:00:00.000Z";
const PLAN_HASH = "b".repeat(64);

export interface ExteriorCellFixture {
  index: ExteriorCellReleaseIndex;
  graph: ExteriorReleaseGraph;
  assemblies: MultiLodAssemblyManifest[];
  contents: Map<string, Uint8Array>;
  buildingIds: { c1: string; c2: string };
  cellReleaseIds: { c1v1: string; c1v2: string; c2v1: string; c2v2: string };
  snapshotIds: { v1: string; v2: string; v3: string };
  assemblyPackageIds: { c1v1: string; c1v2: string; c2v1: string; c2v2: string };
}

function approval(id: string): ExteriorApprovalEvidence {
  return { id, fingerprintSha256: sha256HexSync(id), scope: "Synthetic exterior streaming fixture; no real-world claim.", exclusions: ["real-world use"], approvedAt: NOW };
}

function inventoryFor(buildingId: string, version: string): ExteriorComponentInventory {
  return {
    schemaVersion: EXTERIOR_COMPONENT_SCHEMA_VERSION,
    buildingId,
    components: REQUIRED_EXTERIOR_COMPONENT_KINDS.map((kind) => ({
      componentId: `${buildingId}:${version}:${kind}`,
      kind,
      state: "generated" as const,
      uncertainty: "Procedural fixture geometry; no real-world claim.",
      generator: { id: "udt-fixture", version: "1", inputFingerprintSha256: sha256HexSync(`${buildingId}:${version}:${kind}`), seed: `${buildingId}:${version}:${kind}`, generatedAt: NOW, constraintSourceIds: [] },
    })),
  };
}

function emptyEvidenceGraph(): ExteriorEvidenceGraph {
  return { schemaVersion: EXTERIOR_COMPONENT_SCHEMA_VERSION, sources: [], licenses: [], approvals: [], evidence: [] };
}

/** Approval-only graph carrying a projected exclusion that blocks public conveyance. */
export function blockingEvidenceGraph(exclusion: string): ExteriorEvidenceGraph {
  return {
    schemaVersion: EXTERIOR_COMPONENT_SCHEMA_VERSION,
    sources: [],
    licenses: [],
    approvals: [{ id: "approval:fixture:restricted", fingerprintSha256: sha256HexSync("approval:fixture:restricted"), scope: "Restricted synthetic evidence.", exclusions: [exclusion], approvedAt: NOW }],
    evidence: [],
  };
}

function padded(value: Uint8Array): Uint8Array {
  const result = new Uint8Array(Math.ceil(value.byteLength / 4) * 4);
  result.fill(0x20);
  result.set(value);
  return result;
}

/** Minimal valid, texture-free GLB 2.0 with the closed canonical metadata block. */
export function buildFixtureGlb(metadata: Record<string, unknown>, mutateJson?: (json: Record<string, unknown>) => void): Uint8Array {
  const json: Record<string, unknown> = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: 48 }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 12 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 1, componentType: 5125, count: 3, type: "SCALAR" },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4, material: 0 }] }],
    materials: [{}],
    textures: [],
    extras: { urbanDigitalTwin: metadata },
  };
  mutateJson?.(json);
  const jsonBytes = padded(new TextEncoder().encode(JSON.stringify(json)));
  const bin = new Uint8Array(48);
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const result = new Uint8Array(total);
  const view = new DataView(result.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  result.set(jsonBytes, 20);
  const offset = 20 + jsonBytes.length;
  view.setUint32(offset, bin.length, true);
  view.setUint32(offset + 4, 0x004e4942, true);
  result.set(bin, offset + 8);
  return result;
}

const BOX = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];

function buildFixtureTileset(fineRef: string, coarseRef: string, coarseError: number): Uint8Array {
  const leaf = { boundingVolume: { box: BOX }, geometricError: 0, refine: "REPLACE", content: { uri: `../assets/${fineRef}` } };
  const chain = { boundingVolume: { box: BOX }, geometricError: coarseError, refine: "REPLACE", content: { uri: `../assets/${coarseRef}` }, children: [leaf] };
  return new TextEncoder().encode(JSON.stringify({
    asset: { version: "1.1" },
    geometricError: 10,
    root: { boundingVolume: { box: BOX }, geometricError: 10, refine: "REPLACE", children: [chain] },
  }));
}

function slug(value: string): string { return value.replaceAll(":", "-"); }

export interface ExteriorCellFixtureOptions {
  buildingIds?: { c1: string; c2: string };
  baseReleaseIds?: readonly string[];
}

export function buildExteriorCellFixture(options: ExteriorCellFixtureOptions = {}): ExteriorCellFixture {
  // Real canonical DOITT building IDs carried by the citywide/civic base and by
  // the Block 835 exterior pilot, so base-identity membership is genuine.
  const buildingIds = options.buildingIds ?? { c1: "doitt:778052", c2: "doitt:982383" };
  const baseReleaseIds = [...(options.baseReleaseIds ?? EXTERIOR_FIXTURE_BASE_RELEASE_IDS)];
  const contents = new Map<string, Uint8Array>();
  const artifactBytes = new Map<string, string>();
  const makeArtifact = (audience: "private" | "public", kind: ExteriorArtifactKind, logicalId: string): ExteriorArtifactRef => {
    const relativeRef = `${audience}/${kind}/${slug(logicalId)}.json`;
    const content = stableSerialize({ audience, kind, logicalId });
    artifactBytes.set(relativeRef, content);
    return { logicalId, kind, relativeRef, byteSize: new TextEncoder().encode(content).byteLength, checksumSha256: sha256HexSync(content) };
  };

  const cellReleaseIds = { c1v1: "cell:c1:v1", c1v2: "cell:c1:v2", c2v1: "cell:c2:v1", c2v2: "cell:c2:v2" } as const;
  const snapshotIds = { v1: "snapshot:v1", v2: "snapshot:v2", v3: "snapshot:v3" } as const;
  const inventoryIds = { c1v1: "inventory:b1:v1", c1v2: "inventory:b1:v2", c2v1: "inventory:b2:v1", c2v2: "inventory:b2:v2" } as const;
  const evidenceIds = { c1v1: "evidence:b1:v1", c1v2: "evidence:b1:v2", c2v1: "evidence:b2:v1", c2v2: "evidence:b2:v2" } as const;

  const privateArtifacts = [makeArtifact("private", "ownership-ledger", "ledger:udt-fixture")];
  const publicArtifacts = [
    makeArtifact("public", "ownership-ledger", "ledger:udt-fixture"),
    ...Object.values(cellReleaseIds).map((id) => makeArtifact("public", "cell-release", id)),
    ...Object.values(inventoryIds).map((id) => makeArtifact("public", "inventory", id)),
    ...Object.values(evidenceIds).map((id) => makeArtifact("public", "evidence", id)),
    ...Object.values(snapshotIds).map((id) => makeArtifact("public", "rollout-snapshot", id)),
  ];
  const publicArtifact = (kind: ExteriorArtifactKind, logicalId: string): ExteriorArtifactRef =>
    publicArtifacts.find((entry) => entry.kind === kind && entry.logicalId === logicalId)!;

  // Synthetic ownership bounds over the Manhattan working area. They partition
  // the coverage deterministically; they are not derived from base footprints.
  const c1Bounds = { west: -74.02, south: 40.70, east: -73.9857, north: 40.80 };
  const c2Bounds = { west: -73.9857, south: 40.70, east: -73.93, north: 40.80 };
  const baseIdentityChecksum = sha256HexSync(stableSerialize([buildingIds.c1, buildingIds.c2].sort()));
  const ledgerCells = [
    { cellId: "c1", order: 0, bounds: c1Bounds, buildingIds: [buildingIds.c1], membershipChecksumSha256: sha256HexSync(stableSerialize([buildingIds.c1])) },
    { cellId: "c2", order: 1, bounds: c2Bounds, buildingIds: [buildingIds.c2], membershipChecksumSha256: sha256HexSync(stableSerialize([buildingIds.c2])) },
  ];

  const privateRootChecksum = "c".repeat(64);
  const publicRootChecksum = "d".repeat(64);

  const cellRelease = (
    cellReleaseId: string,
    version: string,
    cellId: "c1" | "c2",
    buildingId: string,
    inventoryId: string,
    evidenceShardId: string,
    predecessorId: string | null,
  ) => ({
    schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
    cellReleaseId,
    version,
    audience: "public" as const,
    artifactRef: publicArtifact("cell-release", cellReleaseId).relativeRef,
    cityId: EXTERIOR_FIXTURE_CITY_ID,
    configId: EXTERIOR_FIXTURE_CONFIG_ID,
    cellId,
    bounds: cellId === "c1" ? c1Bounds : c2Bounds,
    ownershipLedgerId: "ledger:udt-fixture",
    baseIdentitySetId: "identity:udt-fixture-base",
    baseIdentitySetChecksumSha256: baseIdentityChecksum,
    buildingIds: [buildingId],
    predecessor: predecessorId ? { cellReleaseId: predecessorId, checksumSha256: publicArtifact("cell-release", predecessorId).checksumSha256 } : null,
    promotion: approval(`approval:${cellReleaseId}`),
    fallback: predecessorId
      ? { mode: "predecessor" as const, cellReleaseId: predecessorId, checksumSha256: publicArtifact("cell-release", predecessorId).checksumSha256 }
      : { mode: "pinned-base" as const, baseIdentitySetId: "identity:udt-fixture-base", checksumSha256: baseIdentityChecksum },
    buildingDetails: [{ buildingId, status: "available" as const, inventoryId, evidenceShardId, runtimeTexture: false }],
    immutable: true as const,
  });

  const snapshot = (
    snapshotId: string,
    cells: Array<{ cellId: string; cellReleaseId: string }>,
    predecessorId: string | null,
    rollbackId: string | null,
  ) => ({
    schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
    snapshotId,
    audience: "public" as const,
    artifactRef: publicArtifact("rollout-snapshot", snapshotId).relativeRef,
    cityId: EXTERIOR_FIXTURE_CITY_ID,
    configId: EXTERIOR_FIXTURE_CONFIG_ID,
    ownershipLedgerId: "ledger:udt-fixture",
    baseIdentitySetId: "identity:udt-fixture-base",
    baseIdentitySetChecksumSha256: baseIdentityChecksum,
    predecessor: predecessorId ? { snapshotId: predecessorId, checksumSha256: publicArtifact("rollout-snapshot", predecessorId).checksumSha256 } : null,
    rollbackTarget: rollbackId ? { snapshotId: rollbackId, checksumSha256: publicArtifact("rollout-snapshot", rollbackId).checksumSha256 } : null,
    cells: cells.map((entry) => ({ cellId: entry.cellId, cellReleaseId: entry.cellReleaseId, checksumSha256: publicArtifact("cell-release", entry.cellReleaseId).checksumSha256 })),
    promotion: approval(`approval:${snapshotId}`),
    generatedAt: NOW,
    immutable: true as const,
  });

  const graph: ExteriorReleaseGraph = {
    schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
    roots: [{
      schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
      audience: "private",
      rootId: "root:udt-fixture:private",
      rootChecksumSha256: privateRootChecksum,
      releaseId: "release:udt-fixture:private",
      cityId: EXTERIOR_FIXTURE_CITY_ID,
      configId: EXTERIOR_FIXTURE_CONFIG_ID,
      generatedAt: NOW,
      immutable: true,
      artifactAllowlist: privateArtifacts.map((entry) => entry.relativeRef),
      artifacts: privateArtifacts,
      approval: approval("approval:udt-fixture:private-root"),
      predecessor: null,
      privatePredecessor: null,
    }, {
      schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
      audience: "public",
      rootId: "root:udt-fixture:public",
      rootChecksumSha256: publicRootChecksum,
      releaseId: "release:udt-fixture:public",
      cityId: EXTERIOR_FIXTURE_CITY_ID,
      configId: EXTERIOR_FIXTURE_CONFIG_ID,
      generatedAt: NOW,
      immutable: true,
      artifactAllowlist: publicArtifacts.map((entry) => entry.relativeRef),
      artifacts: publicArtifacts,
      approval: approval("approval:udt-fixture:public-root"),
      predecessor: null,
      privatePredecessor: { rootId: "root:udt-fixture:private", rootChecksumSha256: privateRootChecksum },
    }],
    ownershipLedger: {
      schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
      ledgerId: "ledger:udt-fixture",
      cityId: EXTERIOR_FIXTURE_CITY_ID,
      configId: EXTERIOR_FIXTURE_CONFIG_ID,
      immutable: true,
      baseIdentitySet: { id: "identity:udt-fixture-base", checksumSha256: baseIdentityChecksum, buildingCount: 2 },
      coverage: { west: -74.02, south: 40.70, east: -73.93, north: 40.80 },
      cells: ledgerCells,
    },
    cellReleases: [
      cellRelease(cellReleaseIds.c1v1, "v1", "c1", buildingIds.c1, inventoryIds.c1v1, evidenceIds.c1v1, null),
      cellRelease(cellReleaseIds.c1v2, "v2", "c1", buildingIds.c1, inventoryIds.c1v2, evidenceIds.c1v2, cellReleaseIds.c1v1),
      cellRelease(cellReleaseIds.c2v1, "v1", "c2", buildingIds.c2, inventoryIds.c2v1, evidenceIds.c2v1, null),
      cellRelease(cellReleaseIds.c2v2, "v2", "c2", buildingIds.c2, inventoryIds.c2v2, evidenceIds.c2v2, cellReleaseIds.c2v1),
    ],
    inventoryShards: [
      { schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION, shardId: inventoryIds.c1v1, audience: "public", artifactRef: publicArtifact("inventory", inventoryIds.c1v1).relativeRef, inventoryId: inventoryIds.c1v1, inventory: inventoryFor(buildingIds.c1, "v1") },
      { schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION, shardId: inventoryIds.c1v2, audience: "public", artifactRef: publicArtifact("inventory", inventoryIds.c1v2).relativeRef, inventoryId: inventoryIds.c1v2, inventory: inventoryFor(buildingIds.c1, "v2") },
      { schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION, shardId: inventoryIds.c2v1, audience: "public", artifactRef: publicArtifact("inventory", inventoryIds.c2v1).relativeRef, inventoryId: inventoryIds.c2v1, inventory: inventoryFor(buildingIds.c2, "v1") },
      { schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION, shardId: inventoryIds.c2v2, audience: "public", artifactRef: publicArtifact("inventory", inventoryIds.c2v2).relativeRef, inventoryId: inventoryIds.c2v2, inventory: inventoryFor(buildingIds.c2, "v2") },
    ],
    evidenceShards: [
      { schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION, shardId: evidenceIds.c1v1, audience: "public", artifactRef: publicArtifact("evidence", evidenceIds.c1v1).relativeRef, inventoryId: inventoryIds.c1v1, graph: emptyEvidenceGraph() },
      { schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION, shardId: evidenceIds.c1v2, audience: "public", artifactRef: publicArtifact("evidence", evidenceIds.c1v2).relativeRef, inventoryId: inventoryIds.c1v2, graph: emptyEvidenceGraph() },
      { schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION, shardId: evidenceIds.c2v1, audience: "public", artifactRef: publicArtifact("evidence", evidenceIds.c2v1).relativeRef, inventoryId: inventoryIds.c2v1, graph: emptyEvidenceGraph() },
      { schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION, shardId: evidenceIds.c2v2, audience: "public", artifactRef: publicArtifact("evidence", evidenceIds.c2v2).relativeRef, inventoryId: inventoryIds.c2v2, graph: emptyEvidenceGraph() },
    ],
    snapshots: [
      snapshot(snapshotIds.v1, [{ cellId: "c1", cellReleaseId: cellReleaseIds.c1v1 }, { cellId: "c2", cellReleaseId: cellReleaseIds.c2v1 }], null, null),
      snapshot(snapshotIds.v2, [{ cellId: "c1", cellReleaseId: cellReleaseIds.c1v2 }, { cellId: "c2", cellReleaseId: cellReleaseIds.c2v1 }], snapshotIds.v1, snapshotIds.v1),
      snapshot(snapshotIds.v3, [{ cellId: "c1", cellReleaseId: cellReleaseIds.c1v2 }, { cellId: "c2", cellReleaseId: cellReleaseIds.c2v2 }], snapshotIds.v2, snapshotIds.v2),
    ],
  };

  const ledgerArtifactChecksum = publicArtifact("ownership-ledger", "ledger:udt-fixture").checksumSha256;

  const assemblyFor = (
    cellReleaseId: string,
    cellId: "c1" | "c2",
    buildingId: string,
    inventoryId: string,
    evidenceShardId: string,
    predecessorId: string | null,
  ): MultiLodAssemblyManifest => {
    const packageId = `assembly:${cellReleaseId}`;
    const base = `public/assemblies/${slug(cellReleaseId)}`;
    const inventoryHash = sha256HexSync(stableSerialize(graph.inventoryShards.find((shard) => shard.inventoryId === inventoryId)!.inventory));
    const shared = {
      canonicalFeatureId: buildingId,
      ownerCellId: cellId,
      inventoryId,
      inventoryHashSha256: inventoryHash,
      evidenceShardId,
      truthTiers: ["generated"] as AssemblyAsset["truthTiers"],
      sourceDates: { capturedAt: NOW, updatedAt: null },
      predecessor: predecessorId ? { id: predecessorId, checksumSha256: publicArtifact("cell-release", predecessorId).checksumSha256 } : null,
      uncertainty: "Generated exterior geometry; not observed real-world truth.",
    };
    const glbFor = (lodId: string) => buildFixtureGlb({ ...shared, lodId, truthTiers: [...shared.truthTiers], sourceDates: { ...shared.sourceDates }, planHashSha256: PLAN_HASH });
    const fineName = `${slug(buildingId)}-lod0.glb`;
    const coarseName = `${slug(buildingId)}-lod1.glb`;
    const fine = glbFor("lod-0");
    const coarse = glbFor("lod-1");
    const tiles = buildFixtureTileset(fineName, coarseName, 2);
    const fineRef = `${base}/assets/${fineName}`;
    const coarseRef = `${base}/assets/${coarseName}`;
    const tilesetRef = `${base}/tiles/tileset.json`;
    contents.set(fineRef, fine);
    contents.set(coarseRef, coarse);
    contents.set(tilesetRef, tiles);
    const artifacts = [
      { logicalId: `${packageId}:tileset`, role: "tileset-json" as const, relativeRef: tilesetRef, byteSize: tiles.byteLength, checksumSha256: sha256HexSync(new TextDecoder().decode(tiles)), ownerCellId: null },
      { logicalId: `${packageId}:lod0`, role: "glb" as const, relativeRef: fineRef, byteSize: fine.byteLength, checksumSha256: "", ownerCellId: cellId },
      { logicalId: `${packageId}:lod1`, role: "glb" as const, relativeRef: coarseRef, byteSize: coarse.byteLength, checksumSha256: "", ownerCellId: cellId },
    ];
    return {
      schemaVersion: "1.0",
      packageId,
      audience: "public",
      generatedAt: NOW,
      immutable: true,
      release: { rootId: "root:udt-fixture:public", rootChecksumSha256: publicRootChecksum, releaseId: "release:udt-fixture:public", cityId: EXTERIOR_FIXTURE_CITY_ID, configId: EXTERIOR_FIXTURE_CONFIG_ID, privatePredecessor: { id: "root:udt-fixture:private", checksumSha256: privateRootChecksum } },
      baseIdentitySet: { id: "identity:udt-fixture-base", checksumSha256: baseIdentityChecksum },
      ownershipLedger: { id: "ledger:udt-fixture", checksumSha256: ledgerArtifactChecksum },
      cells: [{
        cellId,
        cellRelease: { id: cellReleaseId, checksumSha256: publicArtifact("cell-release", cellReleaseId).checksumSha256 },
        predecessor: predecessorId ? { id: predecessorId, checksumSha256: publicArtifact("cell-release", predecessorId).checksumSha256 } : null,
        buildingIds: [buildingId],
        membershipChecksumSha256: ledgerCells.find((entry) => entry.cellId === cellId)!.membershipChecksumSha256,
      }],
      assets: [{
        ...shared,
        source: { kind: "facade-plan", planId: `plan:${cellReleaseId}`, planHashSha256: PLAN_HASH },
        lods: [
          { lodId: "lod-0", artifactRef: fineRef, geometricErrorMeters: 0, maxDistanceMeters: 220, eligible: true, quality: { triangleCount: 1, materialCount: 1, textureCount: 0, budgets: { maxTriangles: 2, maxMaterials: 1, maxTextures: 0 } }, silhouette: null },
          { lodId: "lod-1", artifactRef: coarseRef, geometricErrorMeters: 2, maxDistanceMeters: null, eligible: true, quality: { triangleCount: 1, materialCount: 1, textureCount: 0, budgets: { maxTriangles: 1, maxMaterials: 1, maxTextures: 0 } }, silhouette: { status: "authoring-declared", method: "projected-silhouette-ratio", metricVersion: "1.0", planHashSha256: PLAN_HASH, viewIds: ["north", "south"], deviationRatio: 0.01, maximumRatio: 0.02 } },
        ],
      }],
      artifacts,
      tilesetRef,
      declaredTotalBytes: artifacts.reduce((sum, entry) => sum + entry.byteSize, 0),
    };
  };

  const assemblies = [
    assemblyFor(cellReleaseIds.c1v1, "c1", buildingIds.c1, inventoryIds.c1v1, evidenceIds.c1v1, null),
    assemblyFor(cellReleaseIds.c1v2, "c1", buildingIds.c1, inventoryIds.c1v2, evidenceIds.c1v2, cellReleaseIds.c1v1),
    assemblyFor(cellReleaseIds.c2v1, "c2", buildingIds.c2, inventoryIds.c2v1, evidenceIds.c2v1, null),
    assemblyFor(cellReleaseIds.c2v2, "c2", buildingIds.c2, inventoryIds.c2v2, evidenceIds.c2v2, cellReleaseIds.c2v1),
  ];

  const assemblyPackageIds = {
    c1v1: `assembly:${cellReleaseIds.c1v1}`,
    c1v2: `assembly:${cellReleaseIds.c1v2}`,
    c2v1: `assembly:${cellReleaseIds.c2v1}`,
    c2v2: `assembly:${cellReleaseIds.c2v2}`,
  };

  const index: ExteriorCellReleaseIndex = {
    schemaVersion: "1.0",
    releaseId: EXTERIOR_FIXTURE_RELEASE_ID,
    audience: "public",
    cityId: EXTERIOR_FIXTURE_CITY_ID,
    configId: EXTERIOR_FIXTURE_CONFIG_ID,
    defaultHead: { snapshotId: snapshotIds.v2, checksumSha256: publicArtifact("rollout-snapshot", snapshotIds.v2).checksumSha256, assemblyPackageIds: [assemblyPackageIds.c1v1, assemblyPackageIds.c1v2, assemblyPackageIds.c2v1] },
    canaryHeads: [{ snapshotId: snapshotIds.v3, checksumSha256: publicArtifact("rollout-snapshot", snapshotIds.v3).checksumSha256, assemblyPackageIds: [assemblyPackageIds.c1v1, assemblyPackageIds.c1v2, assemblyPackageIds.c2v1, assemblyPackageIds.c2v2] }],
    baseCompatibility: { baseReleaseIds },
    localOnly: true,
    runtimeExternalNetwork: false,
  };

  for (const [ref, text] of artifactBytes) contents.set(ref, new TextEncoder().encode(text));
  return { index, graph, assemblies, contents, buildingIds, cellReleaseIds, snapshotIds, assemblyPackageIds };
}

/** Replaces the placeholder GLB checksums with the real digests of the fixture bytes. */
export async function finalizeExteriorCellFixture(fixture: ExteriorCellFixture): Promise<ExteriorCellFixture> {
  for (const assembly of fixture.assemblies) {
    for (const artifact of assembly.artifacts) {
      if (artifact.role !== "glb") continue;
      const bytes = fixture.contents.get(artifact.relativeRef)!;
      const digest = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
      artifact.checksumSha256 = [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
    }
  }
  return fixture;
}

export async function exteriorCellFixture(options: ExteriorCellFixtureOptions = {}): Promise<ExteriorCellFixture> {
  return finalizeExteriorCellFixture(buildExteriorCellFixture(options));
}

export function exteriorFixtureBaseIdentity(fixture: ExteriorCellFixture): ExteriorBaseIdentity {
  const ids = new Set([fixture.buildingIds.c1, fixture.buildingIds.c2]);
  return { releaseId: fixture.index.baseCompatibility.baseReleaseIds[0]!, has: (featureId) => ids.has(featureId) };
}

/**
 * Exact byte map of the emitted local fixture release, keyed by path relative
 * to the release root. Emission and the drift test share this one definition so
 * the checked-in release cannot silently diverge from the generator.
 */
export function exteriorCellFixtureReleaseFiles(fixture: ExteriorCellFixture): Map<string, Uint8Array> {
  const encoder = new TextEncoder();
  const files = new Map<string, Uint8Array>([
    ["index.json", encoder.encode(`${JSON.stringify(fixture.index, null, 2)}\n`)],
    ["release-graph.json", encoder.encode(`${JSON.stringify(fixture.graph, null, 2)}\n`)],
    ["assemblies.json", encoder.encode(`${JSON.stringify(fixture.assemblies, null, 2)}\n`)],
  ]);
  // Private-audience artifacts are never emitted into a browser-reachable root.
  for (const [relativeRef, bytes] of [...fixture.contents].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))) {
    if (!relativeRef.startsWith("public/")) continue;
    files.set(relativeRef, bytes);
  }
  return files;
}

export function exteriorFixtureFetcher(fixture: ExteriorCellFixture, options: { onRequest?: (relativeRef: string) => Promise<void> | void } = {}): ExteriorArtifactFetcher {
  return async (relativeRef, signal) => {
    if (signal?.aborted) throw new DOMException("Request was aborted.", "AbortError");
    await options.onRequest?.(relativeRef);
    const bytes = fixture.contents.get(relativeRef);
    if (!bytes) throw new Error(`Fixture exterior artifact ${relativeRef} is absent.`);
    return bytes;
  };
}

/** Substitutes GLB bytes for one LOD and re-pins the declared size/checksum. */
export async function replaceExteriorFixtureGlb(fixture: ExteriorCellFixture, packageId: string, lodId: string, bytes: Uint8Array): Promise<void> {
  const assembly = fixture.assemblies.find((entry) => entry.packageId === packageId);
  if (!assembly) throw new Error(`Fixture assembly ${packageId} is absent.`);
  const lod = assembly.assets[0]!.lods.find((entry) => entry.lodId === lodId);
  if (!lod) throw new Error(`Fixture LOD ${lodId} is absent.`);
  const artifact = assembly.artifacts.find((entry) => entry.relativeRef === lod.artifactRef)!;
  fixture.contents.set(artifact.relativeRef, bytes);
  artifact.byteSize = bytes.byteLength;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  artifact.checksumSha256 = [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
  assembly.declaredTotalBytes = assembly.artifacts.reduce((sum, entry) => sum + entry.byteSize, 0);
}

/** Flips one byte of every GLB in a package so its declared SHA-256 no longer matches. */
export function corruptExteriorFixturePackage(fixture: ExteriorCellFixture, packageId: string): void {
  const assembly = fixture.assemblies.find((entry) => entry.packageId === packageId);
  if (!assembly) throw new Error(`Fixture assembly ${packageId} is absent.`);
  for (const artifact of assembly.artifacts) {
    if (artifact.role !== "glb") continue;
    const bytes = fixture.contents.get(artifact.relativeRef)!;
    const corrupted = new Uint8Array(bytes);
    corrupted[corrupted.length - 1] = (corrupted[corrupted.length - 1] ?? 0) ^ 0xff;
    fixture.contents.set(artifact.relativeRef, corrupted);
  }
}
