/**
 * Drift gate for the Midtown-core promotion record.
 *
 * This test is NEVER skipped. Every value it checks is recomputed from the
 * committed `data/midtown-core-20260811/payload-inventory.json`, which is in
 * the repository, so the gate does not depend on the untracked payload
 * directory being present on the machine that runs it. That is the whole point:
 * a promotion record whose only check is `skipIf(payloadPresent)` is unchecked
 * on CI and on every fresh clone, which is exactly where drift survives.
 *
 * Runtime behaviour that genuinely requires the payload bytes keeps its own
 * `skipIf` tests elsewhere; those prove loading, not acceptance.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MIDTOWN_CORE_EXTERIOR_ACTIVATION,
  exteriorAcceptedCellsDigest,
  verifyPromotedExteriorMembership,
  verifyPromotedExteriorPin,
  type ExteriorAcceptedCell,
} from "./exterior-default-activation";

interface InventoryFile { path: string; byteSize: number; checksumSha256: string }
interface PayloadInventory {
  releaseId: string;
  stats: Record<string, number>;
  files: InventoryFile[];
}

const INVENTORY_PATH = "data/midtown-core-20260811/payload-inventory.json";
const inventory = JSON.parse(new TextDecoder().decode(readFileSync(INVENTORY_PATH))) as PayloadInventory;
const RECORD = MIDTOWN_CORE_EXTERIOR_ACTIVATION.enabled ? MIDTOWN_CORE_EXTERIOR_ACTIVATION : null;

const CELL_RELEASE_PREFIX = "public/cell-release/cell-release-manhattan-midtown-core-cells-20260811-";
const ASSET_PATTERN = /^public\/assets\/(doitt-\d+)__lod_\d+\.glb$/;

/**
 * Rebuild the accepted cell set from the inventory alone. The cell id and its
 * version are carried in the artifact file NAME, and the file's own checksum is
 * the cell-release checksum the snapshot pins, so the whole triple is
 * recoverable without opening the payload.
 */
function cellsFromInventory(): ExteriorAcceptedCell[] {
  return inventory.files
    .filter((file) => file.path.startsWith(CELL_RELEASE_PREFIX))
    .map((file) => {
      const stem = file.path.slice(CELL_RELEASE_PREFIX.length, -".json".length);
      const match = /^(.*)-(v\d+)$/.exec(stem);
      if (!match) throw new Error(`Unrecognised cell-release artifact name: ${file.path}`);
      const [, cellId, version] = match;
      return {
        cellId: cellId!,
        cellReleaseId: `cell-release:manhattan-midtown-core-cells-20260811:${cellId}:${version}`,
        checksumSha256: file.checksumSha256,
      };
    });
}

function buildingIdsFromInventory(): string[] {
  const ids = new Set<string>();
  for (const file of inventory.files) {
    const match = ASSET_PATTERN.exec(file.path);
    if (match) ids.add(match[1]!.replace("doitt-", "doitt:"));
  }
  return [...ids].sort();
}

/**
 * The digest is computed through the SHIPPED helper, not a local reimplementation:
 * a test that hashes the join its own way would keep passing if the runtime's
 * canonical form drifted.
 */
const cellsDigest = exteriorAcceptedCellsDigest;

describe("Midtown-core promotion record versus the committed payload inventory", () => {
  it("is enabled and names the inventory's release", () => {
    expect(RECORD).not.toBeNull();
    expect(RECORD!.releaseId).toBe(inventory.releaseId);
    expect(RECORD!.approvalRef).toBe("Issue #15 gate approval 2026-08-11");
    expect(RECORD!.predecessor).toEqual({ enabled: false, releaseId: null, rolledBackReleaseId: RECORD!.releaseId });
  });

  it("pins the rollout snapshot the inventory recorded", () => {
    const snapshotFile = inventory.files.find((file) => file.path.startsWith("public/rollout-snapshot/"));
    expect(snapshotFile).toBeDefined();
    expect(RECORD!.snapshotChecksumSha256).toBe(snapshotFile!.checksumSha256);
    // The snapshot id is the artifact's own name, so a pin naming a different
    // snapshot than the bytes it points at cannot pass.
    expect(snapshotFile!.path).toBe(`public/rollout-snapshot/snapshot-${RECORD!.releaseId}-v1.json`);
    expect(RECORD!.snapshotId).toBe(`snapshot:${RECORD!.releaseId}:v1`);
  });

  it("recomputes the accepted cell digest from the inventory's 149 cell releases", async () => {
    const cells = cellsFromInventory();
    expect(cells).toHaveLength(inventory.stats.cellCount!);
    expect(cells).toHaveLength(149);
    expect(RECORD!.membership.cellCount).toBe(cells.length);
    expect(RECORD!.membership.cellsDigestSha256).toBe(await cellsDigest(cells));
    // Cell ids are namespaced by wave, so no promoted wave can claim another's
    // cell and have the scene merge their owned collections.
    expect(cells.every((cell) => cell.cellId.startsWith("manhattan-exterior-cell-w01-"))).toBe(true);
    expect(cells.some((cell) => cell.cellId === "cell:manhattan:block-835")).toBe(false);
  });

  it("recomputes the 160 accepted building identities from the shipped assets", () => {
    const ids = buildingIdsFromInventory();
    expect(ids).toHaveLength(inventory.stats.availableBuildingCount!);
    expect(ids).toHaveLength(160);
    expect([...RECORD!.membership.buildingIds].sort()).toEqual(ids);
    expect(inventory.stats.shippedAssetCount).toBe(160);
  });

  it("matches the bounded-availability stats the wave was approved with", () => {
    expect(inventory.stats.cellCount).toBe(149);
    expect(inventory.stats.renderableCellCount).toBe(3);
    expect(inventory.stats.notShippedCellCount).toBe(146);
    expect(inventory.stats.availableBuildingCount).toBe(160);
    expect(inventory.stats.refusedBuildingCount).toBe(0);
    expect(inventory.stats.renderableCellCount! + inventory.stats.notShippedCellCount!).toBe(inventory.stats.cellCount);
  });

  it("accepts exactly the inventory's cells through the pin gate, and nothing else", async () => {
    const cells = cellsFromInventory();
    const digest = await cellsDigest(cells);
    const resolved = {
      releaseId: RECORD!.releaseId,
      snapshotId: RECORD!.snapshotId,
      snapshotChecksumSha256: RECORD!.snapshotChecksumSha256,
      assemblyPackageIds: [...RECORD!.assemblyPackageIds],
      cells,
      cellsDigestSha256: digest,
    };
    expect(verifyPromotedExteriorPin(resolved, RECORD!)).toEqual({ ok: true });

    // One changed cell checksum changes the digest and fails closed.
    const drifted = cells.map((cell, index) => (index === 0 ? { ...cell, checksumSha256: "0".repeat(64) } : cell));
    const driftedResult = verifyPromotedExteriorPin({ ...resolved, cells: drifted, cellsDigestSha256: await cellsDigest(drifted) }, RECORD!);
    expect(driftedResult.ok).toBe(false);
    expect(driftedResult.ok === false && driftedResult.message).toContain("cell membership digest");

    // A caller that computed no digest has verified nothing, so it fails too:
    // the digest form must never pass by omission.
    const undigested = verifyPromotedExteriorPin({ ...resolved, cellsDigestSha256: null }, RECORD!);
    expect(undigested.ok).toBe(false);
    expect(undigested.ok === false && undigested.message).toContain("membership was never verified");

    // A truncated resolve is named as a count mismatch before any digest work.
    const truncated = verifyPromotedExteriorPin({ ...resolved, cells: cells.slice(0, 148), cellsDigestSha256: digest }, RECORD!);
    expect(truncated.ok).toBe(false);
    expect(truncated.ok === false && truncated.message).toContain("cell count");
  });

  it("accepts exactly the 160 identities through the identity gate", () => {
    expect(verifyPromotedExteriorMembership(RECORD!.membership.buildingIds, RECORD!)).toEqual({ ok: true });
    // A degraded render that drew nothing is not a membership failure.
    expect(verifyPromotedExteriorMembership([], RECORD!)).toEqual({ ok: true });
    const outside = verifyPromotedExteriorMembership(["doitt:105916", "doitt:778052"], RECORD!);
    expect(outside.ok).toBe(false);
    // Block 835's own building is outside the Midtown wave's accepted set, and
    // the message names the release whose membership refused it.
    expect(outside.ok === false && outside.message).toContain("doitt:778052");
    expect(outside.ok === false && outside.message).toContain(RECORD!.releaseId);
  });
});

/**
 * Payload-dependent cross-check. This one may skip — it opens the untracked
 * release graph — but everything it proves about ACCEPTANCE is already proven
 * above from the committed inventory. It exists to show the two agree.
 */
const RELEASE_GRAPH = "public/data/manhattan-midtown-core-cells-20260811/release-graph.json";
describe.skipIf(!existsSync(RELEASE_GRAPH))("Midtown-core record versus the emitted release graph", () => {
  it("digests the same cell set the published snapshot carries", async () => {
    const graph = JSON.parse(new TextDecoder().decode(readFileSync(RELEASE_GRAPH))) as {
      snapshots: { snapshotId: string; audience: string; cells: ExteriorAcceptedCell[] }[];
    };
    const snapshot = graph.snapshots.find((entry) => entry.snapshotId === RECORD!.snapshotId && entry.audience === "public");
    expect(snapshot).toBeDefined();
    expect(snapshot!.cells).toHaveLength(149);
    expect(await cellsDigest(snapshot!.cells)).toBe(RECORD!.membership.cellsDigestSha256);
    expect(await cellsDigest(snapshot!.cells)).toBe(await cellsDigest(cellsFromInventory()));
  });
});
