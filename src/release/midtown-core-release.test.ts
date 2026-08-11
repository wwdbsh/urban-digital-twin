import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { sha256HexBytes } from "../domain/deterministic-hash.ts";
import { EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256, EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID } from "../domain/exterior-fullsnapshot-input.ts";
import { validateExteriorReleaseGraph } from "./exterior-release.ts";
import { validateMultiLodAssembly } from "./multi-lod-assembly.ts";
import { buildMidtownCoreSubsetLedger, midtownCoreArtifactChecksum } from "./midtown-core-package.ts";
import { collectMidtownCoreSources, materializeMidtownCoreCells } from "./midtown-core-source.ts";
import {
  MIDTOWN_CORE_APPROVAL,
  MIDTOWN_CORE_DEFERRED_REASON,
  MIDTOWN_CORE_OUTPUT_DIRECTORY,
  MIDTOWN_CORE_PRIVATE_ROOT_ID,
  MIDTOWN_CORE_PUBLIC_ROOT_ID,
  MIDTOWN_CORE_SHIPPED_LOD_ID,
  buildMidtownCoreRelease,
  midtownCoreApprovalFingerprint,
  midtownCoreCellReleaseId,
} from "./midtown-core-release.ts";

const SNAPSHOT_ROOT = "public/data/manhattan-citywide-20260804";
const LEDGER_ROOT = "data/normalized/manhattan-exterior-wave-ledger-20260804";
const PAYLOAD_ROOT = `${MIDTOWN_CORE_OUTPUT_DIRECTORY}/`;
const RENDERABLE_CELL_COUNT = 3;

/**
 * The emitted payload is deliberately untracked (the citywide precedent), so a
 * fresh clone has no bytes to compare against. Byte-level gates therefore state
 * why they are skipped rather than silently passing.
 */
const PAYLOAD_PRESENT = existsSync(`${PAYLOAD_ROOT}release-graph.json`);
const PAYLOAD_SKIP_NOTE =
  `The midtown-core payload ${PAYLOAD_ROOT} is absent, so the byte-equality replay was skipped. `
  + "It is intentionally untracked; `node scripts/midtown-core-cli.mjs graph` rebuilds it, and "
  + "`data/midtown-core-20260811/payload-inventory.json` carries the committed checksums.";

function readJson(path: string): never {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(readFileSync(path)))) as never;
}

function build() {
  const parentLedger = readJson(`${LEDGER_ROOT}/ledger.json`);
  const subset = buildMidtownCoreSubsetLedger({
    parentLedger,
    parentLedgerChecksumSha256: midtownCoreArtifactChecksum(parentLedger),
    baseReleaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID,
    baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
  });
  const manifest = readJson(`${SNAPSHOT_ROOT}/manifest.json`) as unknown as {
    geometryShards: { layer: string; relativeContentRef: string }[];
    sourceSnapshots: { registryEntryId: string; captureTimestamp: string; sourceUpdatedAt: string }[];
  };
  const snapshot = manifest.sourceSnapshots.find((entry) => entry.registryEntryId === "nyc.building-footprints")!;
  const capture = { capturedAt: snapshot.captureTimestamp, updatedAt: snapshot.sourceUpdatedAt };
  const cells = subset.ledger.cells.slice(0, RENDERABLE_CELL_COUNT);
  const sources = collectMidtownCoreSources(
    manifest.geometryShards.filter((shard) => shard.layer === "buildings").map((shard) => readJson(`${SNAPSHOT_ROOT}/${shard.relativeContentRef}`)),
    new Set(cells.flatMap((cell) => cell.buildingIds)),
  );
  const shipped = materializeMidtownCoreCells({
    cells,
    sources,
    baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
    capture,
  });
  const release = buildMidtownCoreRelease({
    subset,
    renderableCellIds: cells.map((cell) => cell.cellId),
    materialized: shipped.buildings,
    refusals: shipped.refusals,
    capture,
  });
  return { subset, cells, capture, shipped, release };
}

const built = build();

describe("midtown-core canary release graph", () => {
  it("owns the whole wave while shipping geometry for a bounded set of cells", () => {
    expect(built.release.stats).toMatchObject({
      cellCount: 149,
      renderableCellCount: RENDERABLE_CELL_COUNT,
      notShippedCellCount: 146,
      ownedBuildingCount: 7_201,
      availableBuildingCount: 160,
      unavailableBuildingCount: 7_041,
      shippedAssetCount: 160,
    });
    // Every owned building carries exactly one detail status, and the union of
    // available and unavailable is the whole wave.
    expect(built.release.stats.availableBuildingCount + built.release.stats.unavailableBuildingCount).toBe(7_201);
  });

  it("passes the accepted release-graph, assembly, and runtime-index validators", () => {
    expect(validateExteriorReleaseGraph(built.release.graph).ok).toBe(true);
    expect(validateMultiLodAssembly(built.release.assemblies[0]).ok).toBe(true);
    expect(built.release.index.canaryHeads).toEqual([]);
    expect(built.release.index.localOnly).toBe(true);
    expect(built.release.index.runtimeExternalNetwork).toBe(false);
    expect(built.release.index.defaultHead.assemblyPackageIds).toEqual([built.release.assemblies[0]!.packageId]);
  });

  it("keeps every emitted byte inside the public audience root", () => {
    const privateRoot = built.release.graph.roots.find((root) => root.audience === "private")!;
    const publicRoot = built.release.graph.roots.find((root) => root.audience === "public")!;
    expect(privateRoot.rootId).toBe(MIDTOWN_CORE_PRIVATE_ROOT_ID);
    expect(publicRoot.rootId).toBe(MIDTOWN_CORE_PUBLIC_ROOT_ID);
    // Anti-leak: the private root declares exactly one artifact and none of its
    // bytes reach the emitted file map.
    expect(privateRoot.artifacts).toHaveLength(1);
    expect(privateRoot.artifacts[0]!.kind).toBe("ownership-ledger");
    expect([...built.release.files.keys()].filter((path) => path.startsWith("private/"))).toEqual([]);
    expect(built.release.rootArtifactBytes.has(privateRoot.artifacts[0]!.relativeRef)).toBe(true);
    expect(built.release.files.has(privateRoot.artifacts[0]!.relativeRef)).toBe(false);
    // The two ownership-ledger blobs share one logical id but never one hash.
    expect(publicRoot.artifacts.find((artifact) => artifact.kind === "ownership-ledger")!.logicalId).toBe(privateRoot.artifacts[0]!.logicalId);
    expect(publicRoot.artifacts.find((artifact) => artifact.kind === "ownership-ledger")!.checksumSha256).not.toBe(privateRoot.artifacts[0]!.checksumSha256);
  });

  it("declares one cell release per owned cell and a complete snapshot cell map", () => {
    expect(built.release.graph.cellReleases).toHaveLength(149);
    expect(built.release.graph.snapshots).toHaveLength(1);
    expect(built.release.graph.snapshots[0]!.cells).toHaveLength(149);
    expect(built.release.graph.snapshots[0]!.predecessor).toBeNull();
    expect(built.release.graph.snapshots[0]!.rollbackTarget).toBeNull();
    for (const cell of built.release.graph.cellReleases) {
      expect(cell.cellReleaseId).toBe(midtownCoreCellReleaseId(cell.cellId));
      expect(cell.fallback.mode).toBe("pinned-base");
      expect(cell.predecessor).toBeNull();
    }
  });

  it("states a reason for every unavailable building and never invents a predecessor inventory", () => {
    const unavailable = built.release.graph.cellReleases.flatMap((cell) => cell.buildingDetails).filter((detail) => detail.status === "unavailable");
    expect(unavailable).toHaveLength(7_041);
    for (const detail of unavailable) {
      expect(detail.status === "unavailable" && detail.reason.length).toBeGreaterThan(0);
      expect(detail.status === "unavailable" && detail.previousInventoryId).toBeNull();
    }
    expect(unavailable.every((detail) => detail.status === "unavailable" && detail.reason === MIDTOWN_CORE_DEFERRED_REASON)).toBe(true);
  });

  it("ships one inventory and one evidence shard per available building, all generated", () => {
    expect(built.release.graph.inventoryShards).toHaveLength(160);
    expect(built.release.graph.evidenceShards).toHaveLength(160);
    const fingerprint = midtownCoreApprovalFingerprint();
    expect(MIDTOWN_CORE_APPROVAL.fingerprintSha256).toBe(fingerprint);
    for (const shard of built.release.graph.evidenceShards) {
      expect(shard.audience).toBe("public");
      // Every component ships at the generated tier, so there is no claim
      // evidence and the list stays explicitly empty.
      expect(shard.graph.evidence).toEqual([]);
      expect(shard.graph.sources).toHaveLength(1);
      expect(shard.graph.approvals).toHaveLength(1);
      // The approval fingerprint is asserted once and must be identical in
      // every shard; a drifting copy would mean two envelopes in one release.
      expect(shard.graph.approvals[0]!.fingerprintSha256).toBe(fingerprint);
      expect(shard.graph.sources[0]!.capturedAt).toBe(built.capture.capturedAt);
      expect(shard.graph.sources[0]!.updatedAt).toBe(built.capture.updatedAt);
      expect(Date.parse(shard.graph.sources[0]!.capturedAt)).toBeLessThanOrEqual(Date.parse(MIDTOWN_CORE_APPROVAL.approvedAt));
    }
    for (const shard of built.release.graph.inventoryShards) {
      expect([...new Set(shard.inventory.components.map((component) => component.state))]).toEqual(["generated"]);
    }
  });

  it("ships exactly the finest LOD, unbounded, so no camera distance is left unrepresented", () => {
    const assembly = built.release.assemblies[0]!;
    expect(assembly.assets).toHaveLength(160);
    expect(assembly.cells).toHaveLength(RENDERABLE_CELL_COUNT);
    for (const asset of assembly.assets) {
      expect(asset.lods).toHaveLength(1);
      expect(asset.lods[0]!.lodId).toBe(MIDTOWN_CORE_SHIPPED_LOD_ID);
      expect(asset.lods[0]!.geometricErrorMeters).toBe(0);
      expect(asset.lods[0]!.maxDistanceMeters).toBeNull();
      expect(asset.lods[0]!.eligible).toBe(true);
      // Texture-free public package: no route by which imagery could ride along.
      expect(asset.lods[0]!.quality.textureCount).toBe(0);
      expect(asset.truthTiers).toEqual(["generated"]);
    }
  });

  it("is byte-deterministic across a full rebuild", () => {
    const again = build();
    expect(again.release.stats).toEqual(built.release.stats);
    for (const [path, bytes] of built.release.files) {
      expect(sha256HexBytes(again.release.files.get(path)!)).toBe(sha256HexBytes(bytes));
    }
    for (const [ref, bytes] of built.shipped.assetBytes) {
      expect(sha256HexBytes(again.shipped.assetBytes.get(ref)!)).toBe(sha256HexBytes(bytes));
    }
  }, 30_000);
});

describe("midtown-core emitted payload replay", () => {
  it("states why the byte-equality gates are skipped when the untracked payload is absent", () => {
    if (PAYLOAD_PRESENT) {
      expect(existsSync(`${PAYLOAD_ROOT}index.json`)).toBe(true);
      return;
    }
    expect(PAYLOAD_SKIP_NOTE).toContain("midtown-core-cli.mjs graph");
    expect(PAYLOAD_SKIP_NOTE).toContain("payload-inventory.json");
  });
});

describe.skipIf(!PAYLOAD_PRESENT)("midtown-core emitted payload byte equality", () => {
  it("reproduces every emitted manifest, graph, index, and artifact blob byte for byte", () => {
    for (const [path, bytes] of built.release.files) {
      const onDisk = new Uint8Array(readFileSync(`${PAYLOAD_ROOT}${path}`));
      expect(`${path}:${sha256HexBytes(onDisk)}`).toBe(`${path}:${sha256HexBytes(bytes)}`);
    }
  });

  it("reproduces a deterministic sample of the shipped GLB bytes", () => {
    const refs = [...built.shipped.assetBytes.keys()].sort();
    // Fixed by sorted artifact ref, so the sample never drifts between runs.
    const sample = refs.filter((_, index) => index % 20 === 0);
    expect(sample.length).toBeGreaterThanOrEqual(8);
    for (const ref of sample) {
      const onDisk = new Uint8Array(readFileSync(`${PAYLOAD_ROOT}${ref}`));
      expect(`${ref}:${sha256HexBytes(onDisk)}`).toBe(`${ref}:${sha256HexBytes(built.shipped.assetBytes.get(ref)!)}`);
    }
  });

  it("agrees with the committed checksum inventory", () => {
    const inventory = readJson("data/midtown-core-20260811/payload-inventory.json") as unknown as {
      files: { path: string; byteSize: number; checksumSha256: string }[];
      totals: { fileCount: number; byteSize: number };
      roots: Record<string, { rootChecksumSha256: string }>;
    };
    expect(inventory.totals.fileCount).toBe(inventory.files.length);
    for (const file of inventory.files) {
      const onDisk = new Uint8Array(readFileSync(`${PAYLOAD_ROOT}${file.path}`));
      expect(`${file.path}:${onDisk.byteLength}`).toBe(`${file.path}:${file.byteSize}`);
      expect(`${file.path}:${sha256HexBytes(onDisk)}`).toBe(`${file.path}:${file.checksumSha256}`);
    }
    for (const root of built.release.graph.roots) {
      expect(inventory.roots[root.audience]!.rootChecksumSha256).toBe(root.rootChecksumSha256);
    }
    // The private ledger blob is declared by the graph and must never appear on disk.
    expect(inventory.files.some((file) => file.path.startsWith("private/"))).toBe(false);
  });
});
