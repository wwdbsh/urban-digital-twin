import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { stableSerialize } from "../domain/deterministic-hash.ts";
import {
  BLOCK835_CANARY_APPROVAL,
  BLOCK835_CANARY_APPROVAL_EXCLUSIONS,
  BLOCK835_CANARY_APPROVAL_NOTE,
  BLOCK835_CANARY_APPROVAL_SCOPE,
  BLOCK835_CANARY_APPROVED_AT,
  BLOCK835_CANARY_INPUT_PACKAGE_DIRECTORY,
  BLOCK835_CANARY_OUTPUT_DIRECTORY,
  BLOCK835_CANARY_PILOT_RELEASE_PATH,
  BLOCK835_CANARY_RELEASE_ID,
  block835CanaryApprovalFingerprint,
  buildBlock835CanaryRelease,
  type Block835CanaryInput,
} from "./block835-canary-release.ts";
import { replayExteriorArtifactIntegrity, validateExteriorReleaseGraph } from "./exterior-release.ts";
import { validateMultiLodAssembly, type MultiLodAssemblyManifest } from "./multi-lod-assembly.ts";

function readText(path: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
}

function loadInput(): Block835CanaryInput {
  const manifest = JSON.parse(readText(`${BLOCK835_CANARY_INPUT_PACKAGE_DIRECTORY}/manifest.json`)) as MultiLodAssemblyManifest;
  const packageBytes = new Map<string, Uint8Array>();
  for (const artifact of manifest.artifacts) {
    packageBytes.set(artifact.relativeRef, readFileSync(`${BLOCK835_CANARY_INPUT_PACKAGE_DIRECTORY}/${artifact.relativeRef}`));
  }
  return { manifest, packageBytes, pilotRelease: JSON.parse(readText(BLOCK835_CANARY_PILOT_RELEASE_PATH)) };
}

/** Exact on-disk byte map of the emitted release, keyed by relative path. */
function emittedFiles(): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  for (const entry of readdirSync(BLOCK835_CANARY_OUTPUT_DIRECTORY, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    // `parentPath` is reported relative to the directory passed in on some Node
    // builds and absolute on others; normalize both to a release-relative path.
    const parent = entry.parentPath.split("\\").join("/");
    const index = parent.indexOf(BLOCK835_CANARY_OUTPUT_DIRECTORY);
    const directory = (index < 0 ? parent : parent.slice(index + BLOCK835_CANARY_OUTPUT_DIRECTORY.length)).replace(/^\/+/u, "");
    const path = directory.length === 0 ? entry.name : `${directory}/${entry.name}`;
    files.set(path, readFileSync(`${BLOCK835_CANARY_OUTPUT_DIRECTORY}/${path}`));
  }
  return files;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

describe("block 835 canary exterior release", () => {
  it("derives the approval fingerprint from the exact scope, exclusions, timestamp and note", () => {
    expect(BLOCK835_CANARY_APPROVAL.fingerprintSha256).toBe(block835CanaryApprovalFingerprint());
    expect(BLOCK835_CANARY_APPROVAL.approvedAt).toBe("2026-08-11T00:00:00.000Z");
    // Public deployment stays outside the broadened conveyance envelope.
    expect(BLOCK835_CANARY_APPROVAL_EXCLUSIONS).toContain("public deployment");
    expect(BLOCK835_CANARY_APPROVAL_NOTE).toContain("public deployment remains excluded");
    expect(BLOCK835_CANARY_APPROVAL_SCOPE.length).toBeGreaterThan(0);
    expect(BLOCK835_CANARY_APPROVED_AT).toBe(BLOCK835_CANARY_APPROVAL.approvedAt);
  });

  it("builds byte-identical output on repeated runs", () => {
    const input = loadInput();
    const first = buildBlock835CanaryRelease(input);
    const second = buildBlock835CanaryRelease(loadInput());
    expect([...second.files.keys()].sort()).toEqual([...first.files.keys()].sort());
    for (const [path, bytes] of first.files) expect(bytesEqual(bytes, second.files.get(path)!), `drift in ${path}`).toBe(true);
    expect(stableSerialize(second.graph)).toBe(stableSerialize(first.graph));
    expect(stableSerialize(second.assemblies)).toBe(stableSerialize(first.assemblies));
    expect(stableSerialize(second.index)).toBe(stableSerialize(first.index));
  });

  it("matches the emitted release directory byte for byte", () => {
    const built = buildBlock835CanaryRelease(loadInput());
    const onDisk = emittedFiles();
    expect([...onDisk.keys()].sort()).toEqual([...built.files.keys()].sort());
    for (const [path, bytes] of built.files) expect(bytesEqual(bytes, onDisk.get(path)!), `drift in ${path}`).toBe(true);
  });

  it("emits a valid exterior release graph", () => {
    const built = buildBlock835CanaryRelease(loadInput());
    const emitted = JSON.parse(readText(`${BLOCK835_CANARY_OUTPUT_DIRECTORY}/release-graph.json`));
    for (const graph of [built.graph, emitted]) {
      const result = validateExteriorReleaseGraph(graph);
      expect(result.ok ? [] : result.issues).toEqual([]);
    }
    expect(built.graph.cellReleases).toHaveLength(1);
    expect(built.graph.cellReleases[0]!.predecessor).toBeNull();
    expect(built.graph.cellReleases[0]!.fallback.mode).toBe("pinned-base");
    expect(built.graph.inventoryShards).toHaveLength(14);
    expect(built.graph.evidenceShards).toHaveLength(14);
    expect(built.graph.cellReleases[0]!.buildingDetails).toHaveLength(14);
    for (const detail of built.graph.cellReleases[0]!.buildingDetails) {
      expect(detail.status).toBe("available");
      if (detail.status === "available") expect(detail.runtimeTexture).toBe(false);
    }
    for (const shard of built.graph.evidenceShards) {
      expect(shard.graph.sources).toHaveLength(1);
      expect(shard.graph.licenses).toHaveLength(1);
      expect(shard.graph.approvals).toHaveLength(1);
      expect(shard.graph.evidence).toEqual([]);
      const source = shard.graph.sources[0]!;
      expect(source.datasetId).toBe("jh45-qr5r");
      expect(source.id.startsWith("source-ref:jh45-qr5r:")).toBe(true);
      for (const field of ["sourceDate", "observedAt", "capturedAt", "updatedAt"] as const) {
        expect(Date.parse(source[field])).toBeLessThanOrEqual(Date.parse(BLOCK835_CANARY_APPROVED_AT));
      }
      expect(shard.graph.licenses[0]!.retention.expiresAt).toBeNull();
      expect(shard.graph.licenses[0]!.allowedUse.runtimeTexture).toBe(false);
      expect(shard.graph.licenses[0]!.allowedUse.redistribution).toBe(true);
      expect(shard.graph.licenses[0]!.personalDataRestricted).toBe(false);
    }
  });

  it("replays every declared artifact against the emitted public bytes", async () => {
    const built = buildBlock835CanaryRelease(loadInput());
    const onDisk = emittedFiles();
    const supplied = new Map<string, Uint8Array>();
    for (const root of built.graph.roots) for (const artifact of root.artifacts) {
      // The private ledger blob is declared but never written to disk, so its
      // bytes come from the builder while every public byte comes from disk.
      const bytes = onDisk.get(artifact.relativeRef) ?? built.rootArtifactBytes.get(artifact.relativeRef)!;
      if (root.audience === "public") expect(onDisk.has(artifact.relativeRef), `${artifact.relativeRef} is not on disk`).toBe(true);
      supplied.set(artifact.relativeRef, bytes);
    }
    const replay = await replayExteriorArtifactIntegrity(built.graph, supplied);
    expect(replay.ok ? [] : replay.issues).toEqual([]);
  });

  it("declares exactly one private artifact and writes no private byte", () => {
    const built = buildBlock835CanaryRelease(loadInput());
    const privateRoot = built.graph.roots.find((root) => root.audience === "private")!;
    const publicRoot = built.graph.roots.find((root) => root.audience === "public")!;
    expect(privateRoot.artifacts).toHaveLength(1);
    expect(privateRoot.artifacts[0]!.kind).toBe("ownership-ledger");
    expect(privateRoot.artifacts[0]!.logicalId).toBe(built.graph.ownershipLedger.ledgerId);
    expect(privateRoot.privatePredecessor).toBeNull();
    expect(publicRoot.privatePredecessor).toEqual({ rootId: privateRoot.rootId, rootChecksumSha256: privateRoot.rootChecksumSha256 });

    // Same ledgerId on both roots, different bytes, therefore different hashes.
    const publicLedger = publicRoot.artifacts.find((artifact) => artifact.kind === "ownership-ledger")!;
    expect(publicLedger.logicalId).toBe(privateRoot.artifacts[0]!.logicalId);
    expect(publicLedger.checksumSha256).not.toBe(privateRoot.artifacts[0]!.checksumSha256);
    expect(bytesEqual(
      built.rootArtifactBytes.get(publicLedger.relativeRef)!,
      built.rootArtifactBytes.get(privateRoot.artifacts[0]!.relativeRef)!,
    )).toBe(false);

    for (const path of [...built.files.keys(), ...emittedFiles().keys()]) expect(path.startsWith("private/")).toBe(false);
    expect([...emittedFiles().keys()].some((path) => path.toLowerCase().includes("private"))).toBe(false);
  });

  it("fails closed when a public assembly artifact ref names a private partition", () => {
    const built = buildBlock835CanaryRelease(loadInput());
    expect(validateMultiLodAssembly(built.assemblies[0]!).ok).toBe(true);

    const poisoned = structuredClone(built.assemblies[0]!);
    const target = poisoned.assets[0]!.lods[0]!;
    const poisonedRef = target.artifactRef.replace("public/assets/", "public/Private-assets/");
    poisoned.artifacts.find((artifact) => artifact.relativeRef === target.artifactRef)!.relativeRef = poisonedRef;
    target.artifactRef = poisonedRef;
    const result = validateMultiLodAssembly(poisoned);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.message.includes("audience-rooted"))).toBe(true);
  });

  it("pins the emitted assembly to this graph's public root, ledger and base identity", () => {
    const built = buildBlock835CanaryRelease(loadInput());
    const emitted = JSON.parse(readText(`${BLOCK835_CANARY_OUTPUT_DIRECTORY}/assemblies.json`)) as MultiLodAssemblyManifest[];
    expect(emitted).toHaveLength(1);
    const result = validateMultiLodAssembly(emitted[0]!);
    expect(result.ok ? [] : result.issues).toEqual([]);

    const assembly = emitted[0]!;
    const publicRoot = built.graph.roots.find((root) => root.audience === "public")!;
    const ledgerArtifact = publicRoot.artifacts.find((artifact) => artifact.kind === "ownership-ledger")!;
    expect(assembly.audience).toBe("public");
    expect(assembly.release.configId).toBe("manhattan-esb-block-835");
    expect(assembly.release.rootId).toBe(publicRoot.rootId);
    expect(assembly.release.rootChecksumSha256).toBe(publicRoot.rootChecksumSha256);
    expect(assembly.ownershipLedger).toEqual({ id: built.graph.ownershipLedger.ledgerId, checksumSha256: ledgerArtifact.checksumSha256 });
    expect(assembly.baseIdentitySet).toEqual({
      id: built.graph.ownershipLedger.baseIdentitySet.id,
      checksumSha256: built.graph.ownershipLedger.baseIdentitySet.checksumSha256,
    });
    expect(assembly.artifacts).toHaveLength(29);

    const onDisk = emittedFiles();
    for (const artifact of assembly.artifacts) {
      expect(artifact.relativeRef.startsWith("public/")).toBe(true);
      const bytes = onDisk.get(artifact.relativeRef);
      expect(bytes, `${artifact.relativeRef} is missing`).toBeDefined();
      expect(bytes!.byteLength).toBe(artifact.byteSize);
    }
  });

  it("keeps the runtime index local-only and pinned to the emitted snapshot", () => {
    const built = buildBlock835CanaryRelease(loadInput());
    const emitted = JSON.parse(readText(`${BLOCK835_CANARY_OUTPUT_DIRECTORY}/index.json`));
    expect(emitted).toEqual(built.index);
    expect(built.index.releaseId).toBe(BLOCK835_CANARY_RELEASE_ID);
    expect(built.index.localOnly).toBe(true);
    expect(built.index.runtimeExternalNetwork).toBe(false);
    expect(built.index.canaryHeads).toEqual([]);
    expect(built.index.defaultHead.assemblyPackageIds).toEqual(["manhattan-esb-block-reference-20260811"]);
    const snapshotArtifact = built.graph.roots
      .find((root) => root.audience === "public")!
      .artifacts.find((artifact) => artifact.kind === "rollout-snapshot")!;
    expect(built.index.defaultHead.snapshotId).toBe(snapshotArtifact.logicalId);
    expect(built.index.defaultHead.checksumSha256).toBe(snapshotArtifact.checksumSha256);
  });
});
