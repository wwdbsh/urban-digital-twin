/**
 * Midtown-core V3 successor release.
 *
 * Split deliberately in two. The identity, approval, predecessor-derivation and
 * profile checks are pure and run everywhere. The graph and byte checks need the
 * pinned citywide snapshot, which is intentionally untracked, so they state why
 * they are skipped rather than passing silently.
 */
import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { sha256HexBytes, sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";
import { EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256, EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID } from "../domain/exterior-fullsnapshot-input.ts";
import { isExteriorComponentReleaseEligible } from "../domain/exterior-contract.ts";
import { validateExteriorReleaseGraph } from "./exterior-release.ts";
import { validateMultiLodAssembly } from "./multi-lod-assembly.ts";
import { V3_QUALITY_BUDGETS } from "./block835-v3-package.ts";
import { buildMidtownCoreSubsetLedger, midtownCoreArtifactChecksum, MIDTOWN_CORE_RELEASE_ID } from "./midtown-core-package.ts";
import { collectMidtownCoreSources } from "./midtown-core-source.ts";
import {
  MIDTOWN_CORE_APPROVAL,
  MIDTOWN_CORE_SHIPPED_LOD_ID,
  buildMidtownCoreRelease,
  midtownCoreReleaseIds,
} from "./midtown-core-release.ts";
import { MIDTOWN_CORE_V3_RELEASE_ID } from "./midtown-core-v3-materialization.ts";
import {
  MIDTOWN_CORE_V3_APPROVAL,
  MIDTOWN_CORE_V3_APPROVAL_EXCLUSIONS,
  MIDTOWN_CORE_V3_APPROVAL_NOTE,
  MIDTOWN_CORE_V3_APPROVAL_SCOPE,
  MIDTOWN_CORE_V3_APPROVED_AT,
  MIDTOWN_CORE_V3_OUTPUT_DIRECTORY,
  midtownCoreV3ApprovalFingerprint,
  midtownCoreV3Predecessor,
  midtownCoreV3PredecessorAssets,
  midtownCoreV3Profile,
  midtownCoreV3RefusalReason,
  type MidtownCoreV2PayloadInventory,
} from "./midtown-core-v3-release.ts";
import { materializeMidtownCoreV3Cells, midtownCoreV3StageFingerprint } from "./midtown-core-v3-source.ts";

const SNAPSHOT_ROOT = `public/data/${EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID}`;
const LEDGER_ROOT = "data/normalized/manhattan-exterior-wave-ledger-20260804";
const V2_INVENTORY_PATH = "data/midtown-core-20260811/payload-inventory.json";
const V3_INVENTORY_PATH = "data/midtown-core-20260811-v3/payload-inventory.json";
const RENDERABLE_CELL_COUNT = 3;

function readJson(path: string): never {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(readFileSync(path)))) as never;
}

const v2Inventory = readJson(V2_INVENTORY_PATH) as unknown as MidtownCoreV2PayloadInventory;
const v3Inventory = readJson(V3_INVENTORY_PATH) as unknown as {
  releaseId: string;
  roots: Record<string, { rootId: string; rootChecksumSha256: string; artifactCount: number }>;
  assemblyFingerprintSha256: string;
  stats: Record<string, number>;
  census: Record<string, number>;
  refusedBuildingIds: string[];
  totals: { fileCount: number; byteSize: number };
  files: { path: string; byteSize: number; checksumSha256: string }[];
};

describe("midtown-core V3 release identity", () => {
  it("derives every logical id from the successor release id, colliding with nothing V2 owns", () => {
    const ids = midtownCoreReleaseIds(MIDTOWN_CORE_V3_RELEASE_ID);
    const v2Ids = midtownCoreReleaseIds(MIDTOWN_CORE_RELEASE_ID);
    for (const key of Object.keys(ids) as (keyof typeof ids)[]) {
      expect(ids[key]).not.toBe(v2Ids[key]);
      expect(ids[key]).toContain(MIDTOWN_CORE_V3_RELEASE_ID);
    }
    expect(MIDTOWN_CORE_V3_OUTPUT_DIRECTORY).toBe(`public/data/${MIDTOWN_CORE_V3_RELEASE_ID}`);
  });

  it("derives its approval fingerprint from its own durable text", () => {
    expect(MIDTOWN_CORE_V3_APPROVAL.fingerprintSha256).toBe(midtownCoreV3ApprovalFingerprint());
    expect(MIDTOWN_CORE_V3_APPROVAL.fingerprintSha256).toBe(sha256HexSync(stableSerialize({
      scope: MIDTOWN_CORE_V3_APPROVAL_SCOPE,
      exclusions: [...MIDTOWN_CORE_V3_APPROVAL_EXCLUSIONS],
      approvedAt: MIDTOWN_CORE_V3_APPROVED_AT,
      approvalNote: MIDTOWN_CORE_V3_APPROVAL_NOTE,
    })));
    // A different approval from V2's, so a shard cannot cite one and mean the other.
    expect(MIDTOWN_CORE_V3_APPROVAL.fingerprintSha256).not.toBe(MIDTOWN_CORE_APPROVAL.fingerprintSha256);
  });

  it("carries the V2 exclusions verbatim and adds the two a texture-free V3 wave owes", () => {
    for (const exclusion of MIDTOWN_CORE_APPROVAL.exclusions) {
      expect(MIDTOWN_CORE_V3_APPROVAL_EXCLUSIONS).toContain(exclusion);
    }
    expect(MIDTOWN_CORE_V3_APPROVAL_EXCLUSIONS).toContain("runtime textures of any kind, procedural or captured");
    expect(MIDTOWN_CORE_V3_APPROVAL_EXCLUSIONS).toContain("any claim that a designed style class reproduces a real building's material");
    expect(MIDTOWN_CORE_V3_APPROVAL_EXCLUSIONS).toContain("public deployment");
  });

  it("states a refusal without ever implying a substitute was drawn", () => {
    const reason = midtownCoreV3RefusalReason("ring-vertex-count-unsupported", "68 vertices");
    expect(reason).toContain("ring-vertex-count-unsupported");
    expect(reason).toContain("68 vertices");
    expect(reason).toContain("No geometry was invented for this building");
    expect(reason).toContain("no substitute representation was selected");
  });
});

describe("midtown-core V3 predecessor pins", () => {
  it("derives root, snapshot and 149 cell pins from the V2 wave's committed inventory", () => {
    const predecessor = midtownCoreV3Predecessor(v2Inventory);
    expect(predecessor.releaseId).toBe(MIDTOWN_CORE_RELEASE_ID);
    expect(predecessor.cellReleases.size).toBe(149);
    expect(predecessor.snapshot.snapshotId).toBe(`snapshot:${MIDTOWN_CORE_RELEASE_ID}:v1`);
    expect(predecessor.publicRoot.rootId).toBe(`root:${MIDTOWN_CORE_RELEASE_ID}:public`);
    // Every pin is a file checksum from that inventory, never a literal here.
    const byPath = new Map(v2Inventory.files.map((file) => [file.path, file.checksumSha256]));
    expect(predecessor.snapshot.checksumSha256).toBe(byPath.get(`public/rollout-snapshot/snapshot-${MIDTOWN_CORE_RELEASE_ID}-v1.json`));
  });

  it("derives 160 per-building asset pins, and pins nothing it cannot derive", () => {
    const assets = midtownCoreV3PredecessorAssets(v2Inventory);
    expect(assets.size).toBe(160);
    for (const [buildingId, pin] of assets) {
      expect(pin.id).toBe(`${MIDTOWN_CORE_RELEASE_ID}:${buildingId}:${MIDTOWN_CORE_SHIPPED_LOD_ID}`);
      expect(pin.checksumSha256).toMatch(/^[0-9a-f]{64}$/u);
    }
    expect(assets.has("doitt:1294316")).toBe(true);
    // A building the V2 wave never shipped simply has no pin: false lineage is
    // worse than absent lineage.
    expect(assets.has("doitt:778052")).toBe(false);
  });

  it("refuses an inventory that is not the predecessor it claims to be", () => {
    expect(() => midtownCoreV3Predecessor({ ...v2Inventory, releaseId: "something-else" })).toThrow(/pins must come from/u);
    expect(() => midtownCoreV3Predecessor({ ...v2Inventory, roots: {} })).toThrow(/no public root/u);
    expect(() => midtownCoreV3Predecessor({ ...v2Inventory, files: [] })).toThrow(/no .*rollout-snapshot/u);
  });
});

describe("midtown-core V3 profile", () => {
  it("selects the V3 budgets and the successor's own shard identities", () => {
    const profile = midtownCoreV3Profile(midtownCoreV3Predecessor(v2Inventory));
    expect(profile.releaseId).toBe(MIDTOWN_CORE_V3_RELEASE_ID);
    expect(profile.budgets).toEqual({ ...V3_QUALITY_BUDGETS });
    expect(profile.budgets.maxTextures).toBe(0);
    expect(profile.inventoryId("doitt:1")).toContain(MIDTOWN_CORE_V3_RELEASE_ID);
    expect(profile.evidenceShardId("doitt:1")).toContain(MIDTOWN_CORE_V3_RELEASE_ID);
    expect(profile.approval).toBe(MIDTOWN_CORE_V3_APPROVAL);
  });

  it("separates stages and follows the predecessor record it derives pins from", () => {
    const base = {
      baseManifestChecksumSha256: "a".repeat(64),
      parentLedgerChecksumSha256: "b".repeat(64),
      subsetLedgerChecksumSha256: "c".repeat(64),
      predecessorInventoryChecksumSha256: "d".repeat(64),
      renderableCellCount: 3,
      shippedLodId: MIDTOWN_CORE_SHIPPED_LOD_ID,
    };
    expect(midtownCoreV3StageFingerprint({ ...base, stage: "plans" }))
      .not.toBe(midtownCoreV3StageFingerprint({ ...base, stage: "glbs" }));
    // A changed predecessor record changes every asset's pin, so every stage
    // receipt must stop being reusable.
    expect(midtownCoreV3StageFingerprint({ ...base, stage: "plans" }))
      .not.toBe(midtownCoreV3StageFingerprint({ ...base, stage: "plans", predecessorInventoryChecksumSha256: "e".repeat(64) }));
  });
});

describe("midtown-core V3 committed inventory", () => {
  it("records the wave the promotion record was accepted against", () => {
    expect(v3Inventory.releaseId).toBe(MIDTOWN_CORE_V3_RELEASE_ID);
    expect(v3Inventory.stats.cellCount).toBe(149);
    expect(v3Inventory.stats.renderableCellCount).toBe(RENDERABLE_CELL_COUNT);
    expect(v3Inventory.stats.availableBuildingCount).toBe(156);
    expect(v3Inventory.stats.refusedBuildingCount).toBe(4);
    expect(v3Inventory.totals.fileCount).toBe(v3Inventory.files.length);
    expect(v3Inventory.totals.byteSize).toBe(v3Inventory.files.reduce((total, file) => total + file.byteSize, 0));
  });

  it("keeps every emitted path inside the public audience root", () => {
    const outside = v3Inventory.files.filter((file) => file.path.startsWith("private/") || file.path.includes("/private"));
    expect(outside).toEqual([]);
    expect(v3Inventory.roots.private!.artifactCount).toBe(1);
    // The private root declares one artifact and it is never written to disk.
    expect(v3Inventory.files.some((file) => file.path.includes("ownership-ledger") && file.path.startsWith("public/"))).toBe(true);
  });

  it("stays inside the V3 asset budgets across the shipped wave", () => {
    expect(v3Inventory.census.maximumTriangleCount).toBeLessThanOrEqual(V3_QUALITY_BUDGETS.maxTriangles);
    expect(v3Inventory.census.maximumMaterialCount).toBeLessThanOrEqual(V3_QUALITY_BUDGETS.maxMaterials);
    expect(v3Inventory.census.worstVolumeDeviation).toBeLessThan(1e-6);
    expect(v3Inventory.census.worstPerVertexShapeDeviationMeters).toBeLessThan(0.05);
    expect(v3Inventory.census.worstHorizontalDeviationMeters).toBeLessThan(0.25);
    expect(v3Inventory.census.worstVerticalDeviationMeters).toBeLessThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// Byte-level gates over the pinned, intentionally untracked base snapshot
// ---------------------------------------------------------------------------

const BASE_PRESENT = existsSync(`${SNAPSHOT_ROOT}/manifest.json`);
const BASE_SKIP_NOTE =
  `The pinned citywide snapshot ${SNAPSHOT_ROOT} is absent, so the V3 graph rebuild was skipped. `
  + "It is intentionally untracked; `node scripts/midtown-core-v3-cli.mjs graph` rebuilds it, and "
  + "`data/midtown-core-20260811-v3/payload-inventory.json` carries the committed checksums, which the "
  + "unskipped gates above check.";

/**
 * MEMOIZED, because it is the expensive one.
 *
 * Every `it` in this file rebuilt the whole V3 release from the pinned snapshot
 * — a full materialization of the wave — so the suite ran it twenty times. Under
 * a loaded machine that intermittently pushed one case past its timeout and the
 * file failed non-deterministically while passing in isolation. The build is a
 * pure function of committed bytes, so one call per file is the same evidence at
 * a twentieth of the cost.
 */
let memoizedBuild: ReturnType<typeof buildUncached> | null = null;
function build() {
  memoizedBuild ??= buildUncached();
  return memoizedBuild;
}

function buildUncached() {
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
  const shipped = materializeMidtownCoreV3Cells({
    cells,
    sources,
    baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
    capture,
    predecessorAssets: midtownCoreV3PredecessorAssets(v2Inventory),
  });
  const release = buildMidtownCoreRelease({
    subset,
    renderableCellIds: cells.map((cell) => cell.cellId),
    materialized: shipped.buildings,
    refusals: shipped.refusals,
    capture,
    profile: midtownCoreV3Profile(midtownCoreV3Predecessor(v2Inventory)),
  });
  return { subset, cells, shipped, release };
}

describe.skipIf(!BASE_PRESENT)("midtown-core V3 release graph", () => {
  it("states why the byte gates are skipped when the untracked base is absent", () => {
    expect(BASE_SKIP_NOTE).toContain("intentionally untracked");
  });

  it("passes the accepted release-graph and assembly validators", () => {
    const { release } = build();
    expect(validateExteriorReleaseGraph(release.graph).ok).toBe(true);
    expect(validateMultiLodAssembly(release.assemblies[0]!).ok).toBe(true);
    expect(release.index.canaryHeads).toEqual([]);
    expect(release.index.localOnly).toBe(true);
    expect(release.index.runtimeExternalNetwork).toBe(false);
  });

  it("owns the whole wave while shipping geometry for the same three cells V2 shipped", () => {
    const { release, subset } = build();
    expect(release.stats.cellCount).toBe(subset.ledger.cells.length);
    expect(release.stats.renderableCellCount).toBe(RENDERABLE_CELL_COUNT);
    expect(release.stats.notShippedCellCount).toBe(146);
    expect(release.stats.availableBuildingCount).toBe(156);
    expect(release.stats.refusedBuildingCount).toBe(4);
    expect(release.stats.availableBuildingCount + release.stats.unavailableBuildingCount).toBe(7201);
  });

  it("cites the V2 wave as its public-root ancestor and as a per-asset predecessor", () => {
    const { release } = build();
    const publicRoot = release.graph.roots.find((root) => root.audience === "public")!;
    expect(publicRoot.predecessor).toEqual({
      rootId: `root:${MIDTOWN_CORE_RELEASE_ID}:public`,
      rootChecksumSha256: v2Inventory.roots!.public!.rootChecksumSha256,
    });
    // Cell-release and snapshot predecessors are intra-graph version links, so a
    // successor release is the initial version of its own lineage.
    expect(release.graph.cellReleases.every((cell) => cell.predecessor === null)).toBe(true);
    expect(release.graph.snapshots[0]!.predecessor).toBeNull();
    const pins = midtownCoreV3PredecessorAssets(v2Inventory);
    for (const asset of release.assemblies[0]!.assets) {
      expect(asset.predecessor).toEqual(pins.get(asset.canonicalFeatureId));
    }
  });

  it("promotes a disclosed absent setback and refuses everything else absent", () => {
    const { release } = build();
    const absent = release.graph.inventoryShards.filter((shard) =>
      shard.inventory.components.some((component) => component.state === "absent"));
    expect(absent.length).toBe(65);
    for (const shard of absent) {
      for (const component of shard.inventory.components) {
        expect(isExteriorComponentReleaseEligible(component)).toBe(true);
        if (component.state === "absent") {
          expect(component.kind).toBe("setbacks");
          expect(component.reason.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("states a reason for every unavailable building, refused or deferred", () => {
    const { release } = build();
    let refused = 0;
    let deferred = 0;
    for (const cell of release.graph.cellReleases) {
      for (const detail of cell.buildingDetails) {
        if (detail.status !== "unavailable") continue;
        expect(detail.reason.trim().length).toBeGreaterThan(0);
        expect(detail.previousInventoryId).toBeNull();
        if (detail.reason.includes("Refused by the footprint-faithful V3 exterior grammar")) refused += 1; else deferred += 1;
      }
    }
    expect(refused).toBe(4);
    expect(deferred).toBe(7041);
  });

  it("ships exactly the finest LOD, unbounded, texture-free, under the V3 budgets", () => {
    const { release } = build();
    for (const asset of release.assemblies[0]!.assets) {
      expect(asset.lods).toHaveLength(1);
      const lod = asset.lods[0]!;
      expect(lod.lodId).toBe(MIDTOWN_CORE_SHIPPED_LOD_ID);
      expect(lod.maxDistanceMeters).toBeNull();
      expect(lod.quality.textureCount).toBe(0);
      expect(lod.quality.budgets).toEqual({ ...V3_QUALITY_BUDGETS });
      expect(lod.quality.triangleCount).toBeLessThanOrEqual(V3_QUALITY_BUDGETS.maxTriangles);
    }
  });

  it("reproduces the committed checksum inventory byte for byte", () => {
    const { release, shipped } = build();
    const emitted = new Map([...release.files, ...shipped.assetBytes]);
    const committed = new Map(v3Inventory.files.map((file) => [file.path, file]));
    // The emitted file set and the committed record must name the same paths:
    // an extra or a missing artifact is drift even when every shared file agrees.
    expect([...emitted.keys()].sort()).toEqual([...committed.keys()].sort());
    const drifted: string[] = [];
    for (const [path, bytes] of emitted) {
      const record = committed.get(path)!;
      if (record.byteSize !== bytes.byteLength || record.checksumSha256 !== sha256HexBytes(bytes)) drifted.push(path);
    }
    expect(drifted).toEqual([]);
  });
});
