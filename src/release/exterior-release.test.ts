import { describe, expect, it } from "vitest";
import {
  EXTERIOR_COMPONENT_SCHEMA_VERSION,
  REQUIRED_EXTERIOR_COMPONENT_KINDS,
  type ExteriorComponentInventory,
  type ExteriorEvidenceGraph,
} from "../domain/exterior-contract";
import { sha256HexSync, stableSerialize } from "./catalog-release";
import {
  EXTERIOR_RELEASE_SCHEMA_VERSION,
  replayExteriorArtifactIntegrity,
  validateExteriorCellDetailSidecar,
  validateExteriorReleaseGraph,
  validateExteriorReleaseStructure,
  type ExteriorArtifactKind,
  type ExteriorArtifactRef,
  type ExteriorCellDetailSidecar,
  type ExteriorReleaseGraph,
} from "./exterior-release";

const HASH = "a".repeat(64);
const NOW = "2026-08-09T00:00:00.000Z";
const approval = () => ({ id: "approval:fixture", fingerprintSha256: HASH, scope: "Synthetic exterior contract tests.", exclusions: ["real-world use"], approvedAt: NOW });

function inventory(buildingId: string, observedWindows = false): ExteriorComponentInventory {
  return {
    schemaVersion: EXTERIOR_COMPONENT_SCHEMA_VERSION,
    buildingId,
    components: REQUIRED_EXTERIOR_COMPONENT_KINDS.map((kind) => observedWindows && kind === "windows" ? {
      componentId: `${buildingId}:${kind}`,
      kind,
      state: "evidence-backed" as const,
      basis: "source-observed" as const,
      evidenceIds: [`claim:${buildingId}`],
      uncertainty: "Synthetic observation.",
    } : {
      componentId: `${buildingId}:${kind}`,
      kind,
      state: "generated" as const,
      uncertainty: "Procedural fixture; no real-world claim.",
      generator: { id: "fixture", version: "1", inputFingerprintSha256: HASH, seed: `${buildingId}:${kind}`, generatedAt: NOW, constraintSourceIds: [] },
    }),
  };
}

function evidence(buildingId: string, used: boolean): ExteriorEvidenceGraph {
  if (!used) return { schemaVersion: EXTERIOR_COMPONENT_SCHEMA_VERSION, sources: [], licenses: [], approvals: [], evidence: [] };
  return {
    schemaVersion: EXTERIOR_COMPONENT_SCHEMA_VERSION,
    sources: [{ id: `source:${buildingId}`, provider: "Fixture", datasetId: "fixture", sourceRecordId: buildingId, sourceUrl: "https://example.invalid/source", sourceDate: NOW, observedAt: NOW, capturedAt: NOW, updatedAt: NOW, attribution: "Synthetic fixture.", licenseId: `license:${buildingId}`, approvalId: `approval:${buildingId}` }],
    licenses: [{
      id: `license:${buildingId}`,
      termsUrl: "https://example.invalid/terms",
      attribution: "Synthetic fixture.",
      retention: { mode: "permanent", expiresAt: null, conditions: "Fixture only." },
      allowedUse: { privateDerivative: true, publicDisplay: true, derivativeConveyance: true, redistribution: true, runtimeTexture: true, trainingInput: false, generationInput: false, validationOnly: false },
      personalDataRestricted: false,
    }],
    approvals: [{ id: `approval:${buildingId}`, fingerprintSha256: HASH, scope: "Synthetic public fixture.", exclusions: [], approvedAt: NOW }],
    evidence: [{ id: `claim:${buildingId}`, sourceId: `source:${buildingId}`, basis: "source-observed", uncertainty: "Synthetic fixture." }],
  };
}

function fixture(): { graph: ExteriorReleaseGraph; bytes: Map<string, string> } {
  const bytes = new Map<string, string>();
  const makeArtifact = (audience: "private" | "public", kind: ExteriorArtifactKind, logicalId: string): ExteriorArtifactRef => {
    const relativeRef = `${audience}/${kind}/${logicalId.replaceAll(":", "-")}.json`;
    const content = stableSerialize({ audience, kind, logicalId });
    bytes.set(relativeRef, content);
    return { logicalId, kind, relativeRef, byteSize: new TextEncoder().encode(content).byteLength, checksumSha256: sha256HexSync(content) };
  };
  const privateArtifacts = [makeArtifact("private", "ownership-ledger", "ledger:city")];
  const publicArtifacts = [
    makeArtifact("public", "ownership-ledger", "ledger:city"),
    makeArtifact("public", "cell-release", "cell:c1:v1"),
    makeArtifact("public", "cell-release", "cell:c1:v2"),
    makeArtifact("public", "cell-release", "cell:c2:v1"),
    makeArtifact("public", "inventory", "inventory:b1"),
    makeArtifact("public", "inventory", "inventory:b2"),
    makeArtifact("public", "evidence", "evidence:b1"),
    makeArtifact("public", "evidence", "evidence:b2"),
    makeArtifact("public", "rollout-snapshot", "snapshot:v1"),
    makeArtifact("public", "rollout-snapshot", "snapshot:v2"),
  ];
  const artifact = (id: string, kind: ExteriorArtifactKind) => publicArtifacts.find((entry) => entry.logicalId === id && entry.kind === kind)!;
  const c1Bounds = { west: -74.1, south: 40.6, east: -73.95, north: 40.9 };
  const c2Bounds = { west: -73.95, south: 40.6, east: -73.8, north: 40.9 };
  const baseIds = ["b1", "b2"];
  const baseChecksum = sha256HexSync(stableSerialize(baseIds));
  const graph: ExteriorReleaseGraph = {
    schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
    roots: [{
      schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
      audience: "private",
      rootId: "root:private:v1",
      rootChecksumSha256: "b".repeat(64),
      releaseId: "release:private:v1",
      cityId: "city:fixture",
      configId: "config:fixture",
      generatedAt: NOW,
      immutable: true,
      artifactAllowlist: privateArtifacts.map((entry) => entry.relativeRef),
      artifacts: privateArtifacts,
      approval: approval(),
      predecessor: null,
      privatePredecessor: null,
    }, {
      schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
      audience: "public",
      rootId: "root:public:v1",
      rootChecksumSha256: "c".repeat(64),
      releaseId: "release:public:v1",
      cityId: "city:fixture",
      configId: "config:fixture",
      generatedAt: NOW,
      immutable: true,
      artifactAllowlist: publicArtifacts.map((entry) => entry.relativeRef),
      artifacts: publicArtifacts,
      approval: approval(),
      predecessor: null,
      privatePredecessor: { rootId: "root:private:v1", rootChecksumSha256: "b".repeat(64) },
    }],
    ownershipLedger: {
      schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
      ledgerId: "ledger:city",
      cityId: "city:fixture",
      configId: "config:fixture",
      immutable: true,
      baseIdentitySet: { id: "identity:base:v1", checksumSha256: baseChecksum, buildingCount: 2 },
      coverage: { west: -74.1, south: 40.6, east: -73.8, north: 40.9 },
      cells: [
        { cellId: "c1", order: 0, bounds: c1Bounds, buildingIds: ["b1"], membershipChecksumSha256: sha256HexSync(stableSerialize(["b1"])) },
        { cellId: "c2", order: 1, bounds: c2Bounds, buildingIds: ["b2"], membershipChecksumSha256: sha256HexSync(stableSerialize(["b2"])) },
      ],
    },
    cellReleases: [{
      schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
      cellReleaseId: "cell:c1:v1", version: "v1", audience: "public", artifactRef: artifact("cell:c1:v1", "cell-release").relativeRef,
      cityId: "city:fixture", configId: "config:fixture", cellId: "c1", bounds: c1Bounds, ownershipLedgerId: "ledger:city", baseIdentitySetId: "identity:base:v1", baseIdentitySetChecksumSha256: baseChecksum,
      buildingIds: ["b1"], predecessor: null, promotion: approval(), fallback: { mode: "pinned-base", baseIdentitySetId: "identity:base:v1", checksumSha256: baseChecksum },
      buildingDetails: [{ buildingId: "b1", status: "available", inventoryId: "inventory:b1", evidenceShardId: "evidence:b1", runtimeTexture: false }], immutable: true,
    }, {
      schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
      cellReleaseId: "cell:c1:v2", version: "v2", audience: "public", artifactRef: artifact("cell:c1:v2", "cell-release").relativeRef,
      cityId: "city:fixture", configId: "config:fixture", cellId: "c1", bounds: c1Bounds, ownershipLedgerId: "ledger:city", baseIdentitySetId: "identity:base:v1", baseIdentitySetChecksumSha256: baseChecksum,
      buildingIds: ["b1"], predecessor: { cellReleaseId: "cell:c1:v1", checksumSha256: artifact("cell:c1:v1", "cell-release").checksumSha256 }, promotion: approval(), fallback: { mode: "predecessor", cellReleaseId: "cell:c1:v1", checksumSha256: artifact("cell:c1:v1", "cell-release").checksumSha256 },
      buildingDetails: [{ buildingId: "b1", status: "unavailable", tombstoneId: "tombstone:b1:v2", reason: "Exterior detail removed; use predecessor.", previousInventoryId: "inventory:b1" }], immutable: true,
    }, {
      schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
      cellReleaseId: "cell:c2:v1", version: "v1", audience: "public", artifactRef: artifact("cell:c2:v1", "cell-release").relativeRef,
      cityId: "city:fixture", configId: "config:fixture", cellId: "c2", bounds: c2Bounds, ownershipLedgerId: "ledger:city", baseIdentitySetId: "identity:base:v1", baseIdentitySetChecksumSha256: baseChecksum,
      buildingIds: ["b2"], predecessor: null, promotion: approval(), fallback: { mode: "pinned-base", baseIdentitySetId: "identity:base:v1", checksumSha256: baseChecksum },
      buildingDetails: [{ buildingId: "b2", status: "available", inventoryId: "inventory:b2", evidenceShardId: "evidence:b2", runtimeTexture: true }], immutable: true,
    }],
    inventoryShards: [
      { schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION, shardId: "inventory:b1", audience: "public", artifactRef: artifact("inventory:b1", "inventory").relativeRef, inventoryId: "inventory:b1", inventory: inventory("b1") },
      { schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION, shardId: "inventory:b2", audience: "public", artifactRef: artifact("inventory:b2", "inventory").relativeRef, inventoryId: "inventory:b2", inventory: inventory("b2", true) },
    ],
    evidenceShards: [
      { schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION, shardId: "evidence:b1", audience: "public", artifactRef: artifact("evidence:b1", "evidence").relativeRef, inventoryId: "inventory:b1", graph: evidence("b1", false) },
      { schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION, shardId: "evidence:b2", audience: "public", artifactRef: artifact("evidence:b2", "evidence").relativeRef, inventoryId: "inventory:b2", graph: evidence("b2", true) },
    ],
    snapshots: [{
      schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION, snapshotId: "snapshot:v1", audience: "public", artifactRef: artifact("snapshot:v1", "rollout-snapshot").relativeRef,
      cityId: "city:fixture", configId: "config:fixture", ownershipLedgerId: "ledger:city", baseIdentitySetId: "identity:base:v1", baseIdentitySetChecksumSha256: baseChecksum,
      predecessor: null, rollbackTarget: null, cells: [
        { cellId: "c1", cellReleaseId: "cell:c1:v1", checksumSha256: artifact("cell:c1:v1", "cell-release").checksumSha256 },
        { cellId: "c2", cellReleaseId: "cell:c2:v1", checksumSha256: artifact("cell:c2:v1", "cell-release").checksumSha256 },
      ], promotion: approval(), generatedAt: NOW, immutable: true,
    }, {
      schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION, snapshotId: "snapshot:v2", audience: "public", artifactRef: artifact("snapshot:v2", "rollout-snapshot").relativeRef,
      cityId: "city:fixture", configId: "config:fixture", ownershipLedgerId: "ledger:city", baseIdentitySetId: "identity:base:v1", baseIdentitySetChecksumSha256: baseChecksum,
      predecessor: { snapshotId: "snapshot:v1", checksumSha256: artifact("snapshot:v1", "rollout-snapshot").checksumSha256 },
      rollbackTarget: { snapshotId: "snapshot:v1", checksumSha256: artifact("snapshot:v1", "rollout-snapshot").checksumSha256 },
      cells: [
        { cellId: "c1", cellReleaseId: "cell:c1:v2", checksumSha256: artifact("cell:c1:v2", "cell-release").checksumSha256 },
        { cellId: "c2", cellReleaseId: "cell:c2:v1", checksumSha256: artifact("cell:c2:v1", "cell-release").checksumSha256 },
      ], promotion: approval(), generatedAt: NOW, immutable: true,
    }],
  };
  return { graph, bytes };
}

describe("provider-neutral exterior release graph", () => {
  it("validates separate immutable roots, canonical ownership, repeated version membership, and complete rollout", () => {
    const { graph } = fixture();
    expect(validateExteriorReleaseStructure(graph).ok).toBe(true);
    expect(validateExteriorReleaseGraph(graph).ok).toBe(true);
    expect(graph.cellReleases.filter((entry) => entry.buildingIds.includes("b1"))).toHaveLength(2);
  });

  it("fails closed on ownership membership, count, checksum, and order drift", () => {
    for (const mutate of [
      (graph: ExteriorReleaseGraph) => { graph.ownershipLedger.cells[1]!.buildingIds = ["b1", "b2"]; },
      (graph: ExteriorReleaseGraph) => { graph.ownershipLedger.cells[0]!.buildingIds = []; },
      (graph: ExteriorReleaseGraph) => { graph.ownershipLedger.baseIdentitySet.buildingCount = 3; },
      (graph: ExteriorReleaseGraph) => { graph.ownershipLedger.baseIdentitySet.checksumSha256 = HASH; },
      (graph: ExteriorReleaseGraph) => { graph.ownershipLedger.cells[1]!.order = 0; },
    ]) {
      const { graph } = fixture(); mutate(graph);
      expect(validateExteriorReleaseGraph(graph).ok).toBe(false);
    }
  });

  it("rejects missing, cyclic, and cross-cell cell predecessors and absent promotion", () => {
    const missing = fixture().graph;
    missing.cellReleases[1]!.predecessor = { cellReleaseId: "missing", checksumSha256: HASH };
    missing.cellReleases[1]!.fallback = { mode: "predecessor", cellReleaseId: "missing", checksumSha256: HASH };
    expect(validateExteriorReleaseGraph(missing).ok).toBe(false);

    const cyclic = fixture().graph;
    const v2Hash = cyclic.roots[1]!.artifacts.find((entry) => entry.logicalId === "cell:c1:v2")!.checksumSha256;
    cyclic.cellReleases[0]!.predecessor = { cellReleaseId: "cell:c1:v2", checksumSha256: v2Hash };
    cyclic.cellReleases[0]!.fallback = { mode: "predecessor", cellReleaseId: "cell:c1:v2", checksumSha256: v2Hash };
    expect(validateExteriorReleaseGraph(cyclic).ok).toBe(false);

    const crossCell = fixture().graph;
    const c2Hash = crossCell.roots[1]!.artifacts.find((entry) => entry.logicalId === "cell:c2:v1")!.checksumSha256;
    crossCell.cellReleases[1]!.predecessor = { cellReleaseId: "cell:c2:v1", checksumSha256: c2Hash };
    crossCell.cellReleases[1]!.fallback = { mode: "predecessor", cellReleaseId: "cell:c2:v1", checksumSha256: c2Hash };
    expect(validateExteriorReleaseGraph(crossCell).ok).toBe(false);

    const wrongTombstone = fixture().graph;
    const removed = wrongTombstone.cellReleases[1]!.buildingDetails[0];
    if (removed?.status !== "unavailable") throw new Error("fixture detail must be unavailable");
    removed.previousInventoryId = "inventory:wrong";
    expect(validateExteriorReleaseGraph(wrongTombstone).ok).toBe(false);

    const missingApproval = structuredClone(fixture().graph) as unknown as Record<string, unknown>;
    delete ((missingApproval.cellReleases as Array<Record<string, unknown>>)[0]!).promotion;
    expect(validateExteriorReleaseStructure(missingApproval).ok).toBe(false);
  });

  it("rejects incomplete waves, discontinuity, unchanged hash drift, cycles, and invalid rollback", () => {
    const incomplete = fixture().graph;
    incomplete.snapshots[1]!.cells.pop();
    expect(validateExteriorReleaseGraph(incomplete).ok).toBe(false);

    const discontinuous = fixture().graph;
    discontinuous.cellReleases[1]!.predecessor = null;
    discontinuous.cellReleases[1]!.fallback = { mode: "pinned-base", baseIdentitySetId: discontinuous.ownershipLedger.baseIdentitySet.id, checksumSha256: discontinuous.ownershipLedger.baseIdentitySet.checksumSha256 };
    expect(validateExteriorReleaseGraph(discontinuous).ok).toBe(false);

    const drift = fixture().graph;
    drift.snapshots[1]!.cells[1]!.checksumSha256 = HASH;
    expect(validateExteriorReleaseGraph(drift).ok).toBe(false);

    const cyclic = fixture().graph;
    const snapshotV2Hash = cyclic.roots[1]!.artifacts.find((entry) => entry.logicalId === "snapshot:v2")!.checksumSha256;
    cyclic.snapshots[0]!.predecessor = { snapshotId: "snapshot:v2", checksumSha256: snapshotV2Hash };
    expect(validateExteriorReleaseGraph(cyclic).ok).toBe(false);

    const rollback = fixture().graph;
    const snapshotV2 = rollback.roots[1]!.artifacts.find((entry) => entry.logicalId === "snapshot:v2")!;
    rollback.snapshots[1]!.rollbackTarget = { snapshotId: "snapshot:v2", checksumSha256: snapshotV2.checksumSha256 };
    expect(validateExteriorReleaseGraph(rollback).ok).toBe(false);
  });

  it("rejects public/private path leakage, insufficient rights, personal data, and promoted absent entries", () => {
    const leakage = fixture().graph;
    const publicEvidence = leakage.roots[1]!.artifacts.find((entry) => entry.kind === "evidence")!;
    publicEvidence.relativeRef = "private/evidence/leak.json";
    leakage.roots[1]!.artifactAllowlist = leakage.roots[1]!.artifacts.map((entry) => entry.relativeRef);
    expect(validateExteriorReleaseGraph(leakage).ok).toBe(false);

    const denied = fixture().graph;
    denied.evidenceShards[1]!.graph.licenses[0]!.allowedUse.redistribution = false;
    expect(validateExteriorReleaseGraph(denied).ok).toBe(false);

    const personal = fixture().graph;
    personal.evidenceShards[1]!.graph.licenses[0]!.personalDataRestricted = true;
    expect(validateExteriorReleaseGraph(personal).ok).toBe(false);

    const absent = fixture().graph;
    const component = absent.inventoryShards[0]!.inventory.components[0]!;
    absent.inventoryShards[0]!.inventory.components[0] = { componentId: component.componentId, kind: component.kind, state: "absent", representation: "none", reason: "Not produced.", uncertainty: "No real-world absence claim." };
    expect(validateExteriorReleaseGraph(absent).ok).toBe(false);
  });

  it("returns issues instead of throwing when a cell predecessor or snapshot mapping has no audience root", () => {
    const graph = fixture().graph;
    graph.roots = graph.roots.filter((root) => root.audience === "public");
    graph.cellReleases[0]!.audience = "private";

    expect(() => validateExteriorReleaseGraph(graph)).not.toThrow();
    const result = validateExteriorReleaseGraph(graph);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("malformed graph must fail closed");
    expect(result.issues).toEqual(expect.arrayContaining([
      {
        path: "cellReleases.cell:c1:v2.predecessor",
        message: "Cell predecessor audience root is missing.",
      },
      {
        path: "snapshots.snapshot:v1.cells.c1",
        message: "Snapshot cell-release audience root is missing.",
      },
    ]));
  });

  it("returns issues instead of throwing for cross-partition and rootless snapshot ancestry", () => {
    const crossPartition = fixture().graph;
    crossPartition.cellReleases[0]!.audience = "private";
    expect(() => validateExteriorReleaseGraph(crossPartition)).not.toThrow();
    const crossPartitionResult = validateExteriorReleaseGraph(crossPartition);
    expect(crossPartitionResult.ok).toBe(false);
    if (crossPartitionResult.ok) throw new Error("cross-partition graph must fail closed");
    expect(crossPartitionResult.issues).toEqual(expect.arrayContaining([
      {
        path: "cellReleases.cell:c1:v2.predecessor",
        message: "Cell predecessor must exist in the same audience/city/cell/base identity.",
      },
    ]));

    const rootlessSnapshot = fixture().graph;
    rootlessSnapshot.roots = rootlessSnapshot.roots.filter((root) => root.audience === "public");
    rootlessSnapshot.snapshots[0]!.audience = "private";
    expect(() => validateExteriorReleaseGraph(rootlessSnapshot)).not.toThrow();
    const snapshotResult = validateExteriorReleaseGraph(rootlessSnapshot);
    expect(snapshotResult.ok).toBe(false);
    if (snapshotResult.ok) throw new Error("rootless snapshot graph must fail closed");
    expect(snapshotResult.issues).toEqual(expect.arrayContaining([
      {
        path: "snapshots.snapshot:v2.predecessor",
        message: "Snapshot predecessor audience root is missing.",
      },
      {
        path: "snapshots.snapshot:v2.rollbackTarget",
        message: "Rollback target audience root is missing.",
      },
    ]));
  });

  it("structurally rejects malformed nested inventory and evidence payloads without throwing", () => {
    const malformedInventories: unknown[] = [
      null,
      [],
      {},
      { schemaVersion: EXTERIOR_COMPONENT_SCHEMA_VERSION, buildingId: "b1", components: null },
    ];
    for (const payload of malformedInventories) {
      const graph = fixture().graph;
      (graph.inventoryShards[0] as unknown as Record<string, unknown>).inventory = payload;
      expect(() => validateExteriorReleaseGraph(graph)).not.toThrow();
      const result = validateExteriorReleaseGraph(graph);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("malformed inventory must fail closed");
      expect(result.issues.some((entry) => entry.path.startsWith("inventoryShards[0].inventory"))).toBe(true);
    }

    const malformedEvidence: unknown[] = [
      null,
      [],
      {},
      { schemaVersion: EXTERIOR_COMPONENT_SCHEMA_VERSION, sources: null, licenses: [], approvals: [], evidence: [] },
    ];
    for (const payload of malformedEvidence) {
      const graph = fixture().graph;
      (graph.evidenceShards[0] as unknown as Record<string, unknown>).graph = payload;
      expect(() => validateExteriorReleaseGraph(graph)).not.toThrow();
      const result = validateExteriorReleaseGraph(graph);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("malformed evidence must fail closed");
      expect(result.issues.some((entry) => entry.path.startsWith("evidenceShards[0].graph"))).toBe(true);
    }
  });

  it("binds unique inventory shard IDs to their inventory/artifact logical identity", () => {
    const mismatch = fixture().graph;
    mismatch.inventoryShards[0]!.shardId = "inventory:other";
    const mismatchResult = validateExteriorReleaseGraph(mismatch);
    expect(mismatchResult.ok).toBe(false);
    if (mismatchResult.ok) throw new Error("mismatched shard identity must fail closed");
    expect(mismatchResult.issues).toContainEqual({ path: "inventoryShards.inventory:b1.shardId", message: "Inventory shard ID must equal its audited inventory/artifact logical ID." });

    const duplicate = fixture().graph;
    duplicate.inventoryShards[1]!.shardId = duplicate.inventoryShards[0]!.shardId;
    const duplicateResult = validateExteriorReleaseGraph(duplicate);
    expect(duplicateResult.ok).toBe(false);
    if (duplicateResult.ok) throw new Error("duplicate shard identity must fail closed");
    expect(duplicateResult.issues).toContainEqual({ path: "inventoryShardIds", message: "Logical IDs must be unique." });
  });

  it("evaluates public evidence retention and freshness at the cell promotion timestamp", () => {
    const expired = fixture().graph;
    expired.evidenceShards[1]!.graph.licenses[0]!.retention = { mode: "expires", expiresAt: "2000-01-01T00:00:00.000Z", conditions: "Expired fixture evidence." };
    expect(validateExteriorReleaseGraph(expired).ok).toBe(false);

    const future = fixture().graph;
    future.evidenceShards[1]!.graph.sources[0]!.observedAt = "2027-01-01T00:00:00.000Z";
    expect(validateExteriorReleaseGraph(future).ok).toBe(false);
  });

  it("replays exact bytes and rejects duplicate or malformed declarations and byte mismatches", async () => {
    const valid = fixture();
    expect((await replayExteriorArtifactIntegrity(valid.graph, valid.bytes)).ok).toBe(true);

    const duplicate = fixture().graph;
    duplicate.roots[1]!.artifacts[1]!.checksumSha256 = duplicate.roots[1]!.artifacts[0]!.checksumSha256;
    expect(validateExteriorReleaseGraph(duplicate).ok).toBe(false);

    const malformed = fixture().graph;
    malformed.roots[1]!.artifacts[0]!.checksumSha256 = "bad";
    expect(validateExteriorReleaseStructure(malformed).ok).toBe(false);

    const missing = fixture();
    missing.bytes.delete(missing.graph.roots[1]!.artifacts[0]!.relativeRef);
    expect((await replayExteriorArtifactIntegrity(missing.graph, missing.bytes)).ok).toBe(false);

    const mismatched = fixture();
    mismatched.bytes.set(mismatched.graph.roots[1]!.artifacts[0]!.relativeRef, "wrong bytes");
    expect((await replayExteriorArtifactIntegrity(mismatched.graph, mismatched.bytes)).ok).toBe(false);

    const unexpected = fixture();
    unexpected.bytes.set("public/extra.json", "extra");
    expect((await replayExteriorArtifactIntegrity(unexpected.graph, unexpected.bytes)).ok).toBe(false);
  });
});

/**
 * Move ONE cell's shards out of the graph and into a sidecar document.
 *
 * Deliberately one cell and not all of them: the form is per cell, so a graph
 * where `c1` keeps its shards inline and `c2` sharded them out is a legal
 * release, and it is the case that would break if the seam had been written as a
 * whole-graph mode flag instead of a per-cell decision.
 */
function sidecarForm(): { graph: ExteriorReleaseGraph; bytes: Map<string, string>; sidecar: ExteriorCellDetailSidecar; sidecarRef: string } {
  const { graph, bytes } = fixture();
  const publicRoot = graph.roots.find((root) => root.audience === "public")!;
  const sidecarRef = "public/cell-detail-sidecar/cell-c2-v1.json";
  const inventoryShard = { ...graph.inventoryShards.find((shard) => shard.inventoryId === "inventory:b2")!, artifactRef: sidecarRef };
  const evidenceShard = { ...graph.evidenceShards.find((shard) => shard.shardId === "evidence:b2")!, artifactRef: sidecarRef };
  const sidecar: ExteriorCellDetailSidecar = {
    schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
    sidecarId: "cell:c2:v1",
    audience: "public",
    artifactRef: sidecarRef,
    cellReleaseId: "cell:c2:v1",
    inventoryShards: [inventoryShard],
    evidenceShards: [evidenceShard],
  };
  // The shards leave the graph entirely, and so do their root declarations.
  graph.inventoryShards = graph.inventoryShards.filter((shard) => shard.inventoryId !== "inventory:b2");
  graph.evidenceShards = graph.evidenceShards.filter((shard) => shard.shardId !== "evidence:b2");
  for (const ref of ["public/inventory/inventory-b2.json", "public/evidence/evidence-b2.json"]) bytes.delete(ref);
  const content = stableSerialize(sidecar);
  bytes.set(sidecarRef, content);
  publicRoot.artifacts = [
    ...publicRoot.artifacts.filter((artifact) => !(artifact.kind === "inventory" && artifact.logicalId === "inventory:b2") && !(artifact.kind === "evidence" && artifact.logicalId === "evidence:b2")),
    { logicalId: "cell:c2:v1", kind: "cell-detail-sidecar", relativeRef: sidecarRef, byteSize: new TextEncoder().encode(content).byteLength, checksumSha256: sha256HexSync(content) },
  ];
  publicRoot.artifactAllowlist = publicRoot.artifacts.map((artifact) => artifact.relativeRef);
  return { graph, bytes, sidecar, sidecarRef };
}

describe("per-cell detail sidecars", () => {
  it("accepts a graph that shards ONE cell's evidence out while another keeps it inline", async () => {
    const { graph, bytes } = sidecarForm();
    expect(validateExteriorReleaseGraph(graph)).toEqual({ ok: true, value: graph });
    expect((await replayExteriorArtifactIntegrity(graph, bytes)).ok).toBe(true);
    // The seam's whole point, stated as arithmetic the test can see: the shard
    // bodies are no longer part of the document a runtime must fetch and parse
    // before it can decide anything.
    expect(graph.inventoryShards.map((shard) => shard.inventoryId)).toEqual(["inventory:b1"]);
    expect(graph.evidenceShards.map((shard) => shard.shardId)).toEqual(["evidence:b1"]);
  });

  it("refuses a cell that carries its evidence in BOTH places", () => {
    const { graph, sidecar } = sidecarForm();
    graph.inventoryShards = [...graph.inventoryShards, { ...sidecar.inventoryShards[0]!, artifactRef: "public/inventory/inventory-b2.json" }];
    const result = validateExteriorReleaseGraph(graph);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.issues.some((entry) => entry.message.includes("may not also carry its inventory shard"))).toBe(true);
  });

  it("refuses a sidecar declared for a cell release the graph does not decode", () => {
    const { graph } = sidecarForm();
    const publicRoot = graph.roots.find((root) => root.audience === "public")!;
    publicRoot.artifacts = publicRoot.artifacts.map((artifact) => (artifact.kind === "cell-detail-sidecar" ? { ...artifact, logicalId: "cell:absent:v9" } : artifact));
    expect(validateExteriorReleaseGraph(graph).ok).toBe(false);
  });

  it("binds a fetched sidecar to the exact cell release and artifact it was verified as", () => {
    const { graph, sidecar, sidecarRef } = sidecarForm();
    const cell = graph.cellReleases.find((entry) => entry.cellReleaseId === "cell:c2:v1")!;
    expect(validateExteriorCellDetailSidecar(sidecar, { cell, artifactRef: sidecarRef })).toEqual({ ok: true, value: sidecar });

    // A sidecar handed to the wrong cell is refused even though every shard in
    // it is individually well-formed: the pairing is the claim being checked.
    const otherCell = graph.cellReleases.find((entry) => entry.cellReleaseId === "cell:c1:v1")!;
    expect(validateExteriorCellDetailSidecar(sidecar, { cell: otherCell, artifactRef: sidecarRef }).ok).toBe(false);

    // A sidecar claiming an artifact other than the one whose checksum was just
    // verified is refused, so the document cannot rename itself after the fact.
    expect(validateExteriorCellDetailSidecar(sidecar, { cell, artifactRef: "public/cell-detail-sidecar/other.json" }).ok).toBe(false);
  });

  it("runs the SAME per-building evidence binding the in-graph form runs", () => {
    const { graph, sidecar, sidecarRef } = sidecarForm();
    const cell = graph.cellReleases.find((entry) => entry.cellReleaseId === "cell:c2:v1")!;
    // `b2` is the runtimeTexture: true building, whose evidence graph must admit
    // texture use. Flipping the evidence to the non-texture form must fail in the
    // sidecar exactly as it fails in the graph — this is the check that would
    // have silently disappeared if the resolution had been reimplemented here.
    const weakened: ExteriorCellDetailSidecar = { ...sidecar, evidenceShards: [{ ...sidecar.evidenceShards[0]!, graph: evidence("b2", false) }] };
    expect(validateExteriorCellDetailSidecar(weakened, { cell, artifactRef: sidecarRef }).ok).toBe(false);

    // And an inventory for a different building is refused by identity, not by
    // luck of the evidence check.
    const misbound: ExteriorCellDetailSidecar = { ...sidecar, inventoryShards: [{ ...sidecar.inventoryShards[0]!, inventory: inventory("b1", true) }] };
    expect(validateExteriorCellDetailSidecar(misbound, { cell, artifactRef: sidecarRef }).ok).toBe(false);
  });

  it("refuses a sidecar carrying a shard the cell release does not cite", () => {
    const { graph, sidecar, sidecarRef } = sidecarForm();
    const cell = graph.cellReleases.find((entry) => entry.cellReleaseId === "cell:c2:v1")!;
    const padded: ExteriorCellDetailSidecar = {
      ...sidecar,
      inventoryShards: [...sidecar.inventoryShards, { schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION, shardId: "inventory:b9", audience: "public", artifactRef: sidecarRef, inventoryId: "inventory:b9", inventory: inventory("b9") }],
    };
    expect(validateExteriorCellDetailSidecar(padded, { cell, artifactRef: sidecarRef }).ok).toBe(false);
  });

  it("refuses a contained shard that names an artifact other than the sidecar", () => {
    const { graph, sidecar, sidecarRef } = sidecarForm();
    const cell = graph.cellReleases.find((entry) => entry.cellReleaseId === "cell:c2:v1")!;
    const strayRef: ExteriorCellDetailSidecar = { ...sidecar, inventoryShards: [{ ...sidecar.inventoryShards[0]!, artifactRef: "public/inventory/inventory-b2.json" }] };
    expect(validateExteriorCellDetailSidecar(strayRef, { cell, artifactRef: sidecarRef }).ok).toBe(false);
  });
});
