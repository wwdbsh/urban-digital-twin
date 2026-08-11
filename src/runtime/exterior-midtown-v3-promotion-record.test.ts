/**
 * Drift gate for the ACTIVE Midtown-core V3 promotion record.
 *
 * This test is NEVER skipped. Every value it checks is recomputed from the
 * committed `data/midtown-core-20260811-v3/payload-inventory.json`, which is in
 * the repository, so the gate does not depend on the untracked payload
 * directory being present on the machine that runs it. A promotion record whose
 * only check is `skipIf(payloadPresent)` is unchecked on CI and on every fresh
 * clone, which is exactly where drift survives.
 *
 * The V2 predecessor keeps its own, equally unskipped gate in
 * `exterior-midtown-promotion-record.test.ts`: a rollback target that stopped
 * being verified is a rollback target nobody can trust.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MIDTOWN_CORE_EXTERIOR_ACTIVATION,
  MIDTOWN_CORE_V2_EXTERIOR_ACTIVATION,
  MIDTOWN_CORE_V2_EXTERIOR_ROLLBACK,
  exteriorAcceptedCellsDigest,
  exteriorRolledBackReleaseNotice,
  verifyPromotedExteriorMembership,
  verifyPromotedExteriorPin,
  type ExteriorAcceptedCell,
  type ExteriorDefaultActivationEnabled,
} from "./exterior-default-activation";

interface InventoryFile { path: string; byteSize: number; checksumSha256: string }
interface PayloadInventory {
  releaseId: string;
  predecessor: { releaseId: string; inventoryChecksumSha256: string; publicRootChecksumSha256: string; snapshotChecksumSha256: string; assetPinCount: number };
  stats: Record<string, number>;
  census: Record<string, number>;
  absentSetbackBuildingIds: string[];
  refusedBuildingIds: string[];
  files: InventoryFile[];
}

const RELEASE_ID = "manhattan-midtown-core-cells-20260811-v3";
const INVENTORY_PATH = "data/midtown-core-20260811-v3/payload-inventory.json";
const V2_INVENTORY_PATH = "data/midtown-core-20260811/payload-inventory.json";
const inventory = JSON.parse(new TextDecoder().decode(readFileSync(INVENTORY_PATH))) as PayloadInventory;
const RECORD = MIDTOWN_CORE_EXTERIOR_ACTIVATION.enabled ? MIDTOWN_CORE_EXTERIOR_ACTIVATION : null;

const CELL_RELEASE_PREFIX = `public/cell-release/cell-release-${RELEASE_ID}-`;
const ASSET_PATTERN = /^public\/assets\/(doitt-\d+)__lod_\d+\.glb$/;

function cellsFromInventory(): ExteriorAcceptedCell[] {
  return inventory.files
    .filter((file) => file.path.startsWith(CELL_RELEASE_PREFIX))
    .map((file) => {
      const stem = file.path.slice(CELL_RELEASE_PREFIX.length, -".json".length);
      const match = /^(.*)-(v\d+)$/.exec(stem);
      if (!match) throw new Error(`Unrecognised cell-release artifact name: ${file.path}`);
      return {
        cellId: match[1]!,
        cellReleaseId: `cell-release:${RELEASE_ID}:${match[1]!}:${match[2]!}`,
        checksumSha256: file.checksumSha256,
      };
    });
}

function buildingIdsFrom(files: InventoryFile[]): string[] {
  const ids = new Set<string>();
  for (const file of files) {
    const match = ASSET_PATTERN.exec(file.path);
    if (match) ids.add(match[1]!.replace("doitt-", "doitt:"));
  }
  return [...ids].sort();
}

describe("Midtown-core V3 promotion record versus the committed payload inventory", () => {
  it("is enabled and names the inventory's successor release", () => {
    expect(RECORD).not.toBeNull();
    expect(RECORD!.releaseId).toBe(inventory.releaseId);
    expect(RECORD!.releaseId).toBe(RELEASE_ID);
    expect(RECORD!.approvalRef).toBe("Issue #44 gate approval 2026-08-11 (T026 P3 Midtown V3 promotion)");
    // A record may never name its own release as withdrawn.
    expect(RECORD!.rolledBackReleaseId ?? null).toBeNull();
  });

  it("pins the rollout snapshot the inventory recorded", () => {
    const snapshotFile = inventory.files.find((file) => file.path.startsWith("public/rollout-snapshot/"));
    expect(snapshotFile).toBeDefined();
    expect(RECORD!.snapshotChecksumSha256).toBe(snapshotFile!.checksumSha256);
    expect(snapshotFile!.path).toBe(`public/rollout-snapshot/snapshot-${RELEASE_ID}-v1.json`);
    expect(RECORD!.snapshotId).toBe(`snapshot:${RELEASE_ID}:v1`);
    expect(RECORD!.assemblyPackageIds).toEqual([`assembly:${RELEASE_ID}:v1`]);
  });

  it("recomputes the accepted cell digest from the inventory's 149 cell releases", async () => {
    const cells = cellsFromInventory();
    expect(cells).toHaveLength(inventory.stats.cellCount!);
    expect(cells).toHaveLength(149);
    expect(RECORD!.membership.cellCount).toBe(cells.length);
    expect(RECORD!.membership.cellsDigestSha256).toBe(await exteriorAcceptedCellsDigest(cells));
    expect(cells.every((cell) => cell.cellId.startsWith("manhattan-exterior-cell-w01-"))).toBe(true);
    // A successor must not reuse the predecessor's cell-release identities, or a
    // resolve against the wrong release would satisfy the pin gate.
    expect(cells.every((cell) => cell.cellReleaseId.includes(RELEASE_ID))).toBe(true);
    expect(RECORD!.membership.cellsDigestSha256)
      .not.toBe(MIDTOWN_CORE_V2_EXTERIOR_ACTIVATION.membership.cellsDigestSha256);
  });

  it("recomputes the 156 accepted building identities from the shipped assets", () => {
    const ids = buildingIdsFrom(inventory.files);
    expect(ids).toHaveLength(inventory.stats.availableBuildingCount!);
    expect(ids).toHaveLength(156);
    expect([...RECORD!.membership.buildingIds].sort()).toEqual(ids);
    expect(inventory.stats.shippedAssetCount).toBe(156);
  });

  it("states the availability drift this promotion carries, and never invents a building", () => {
    const v2 = JSON.parse(new TextDecoder().decode(readFileSync(V2_INVENTORY_PATH))) as PayloadInventory;
    const v2Ids = buildingIdsFrom(v2.files);
    const v3Ids = buildingIdsFrom(inventory.files);
    expect(v2Ids).toHaveLength(160);
    expect(v3Ids).toHaveLength(156);
    // A successor may WITHDRAW a building it cannot honestly draw...
    const withdrawn = v2Ids.filter((id) => !v3Ids.includes(id));
    expect(withdrawn).toEqual(["doitt:399990", "doitt:555676", "doitt:749711", "doitt:88101"]);
    expect(withdrawn.sort()).toEqual([...inventory.refusedBuildingIds].sort());
    // ...and may never ADD one the predecessor did not own.
    expect(v3Ids.filter((id) => !v2Ids.includes(id))).toEqual([]);
    expect(inventory.stats.refusedBuildingCount).toBe(4);
    // The refused four ship as explicit unavailable details, not as silence.
    expect(inventory.stats.availableBuildingCount! + 4).toBe(160);
    // The V2 record's membership is unchanged and still names all 160.
    expect(MIDTOWN_CORE_V2_EXTERIOR_ACTIVATION.membership.buildingIds).toHaveLength(160);
  });

  it("keeps the bounded-availability shape the wave was approved with", () => {
    expect(inventory.stats.cellCount).toBe(149);
    expect(inventory.stats.renderableCellCount).toBe(3);
    expect(inventory.stats.notShippedCellCount).toBe(146);
    expect(inventory.stats.renderableCellCount! + inventory.stats.notShippedCellCount!).toBe(inventory.stats.cellCount);
    expect(inventory.stats.ownedBuildingCount).toBe(7201);
    expect(inventory.stats.availableBuildingCount! + inventory.stats.unavailableBuildingCount!).toBe(7201);
  });

  it("records the disclosed tier-collapse absences rather than hiding them", () => {
    // 65 of the 156 shipped buildings genuinely cannot carry a setback, declare
    // `setbacks` absent with a stated reason, and are promoted under the
    // conditionally-applicable admission rather than being given an invented one.
    expect(inventory.absentSetbackBuildingIds).toHaveLength(65);
    expect(inventory.census.tierCollapseAbsentSetbackCount).toBe(65);
    expect(inventory.absentSetbackBuildingIds.every((id) => RECORD!.membership.buildingIds.includes(id))).toBe(true);
    expect(inventory.census.maximumTriangleCount).toBeLessThanOrEqual(200_000);
    expect(inventory.census.materialBudget).toBe(12);
    expect(inventory.census.maximumMaterialCount).toBeLessThanOrEqual(12);
  });

  it("pins the V2 predecessor it supersedes, by that wave's own committed record", () => {
    expect(inventory.predecessor.releaseId).toBe(MIDTOWN_CORE_V2_EXTERIOR_ACTIVATION.releaseId);
    expect(inventory.predecessor.snapshotChecksumSha256).toBe(MIDTOWN_CORE_V2_EXTERIOR_ACTIVATION.snapshotChecksumSha256);
    expect(inventory.predecessor.assetPinCount).toBe(160);
    // The successor's own record rolls back to the V2 record verbatim, plus the
    // one statement a withdrawal has to make.
    expect(RECORD!.predecessor).toBe(MIDTOWN_CORE_V2_EXTERIOR_ROLLBACK);
    expect(MIDTOWN_CORE_V2_EXTERIOR_ROLLBACK.rolledBackReleaseId).toBe(RELEASE_ID);
    // Identical in every other operative field: the rollback target IS the
    // retained record, plus the one statement a withdrawal has to make.
    const withoutWithdrawal = (record: ExteriorDefaultActivationEnabled): Record<string, unknown> => {
      const copy: Record<string, unknown> = { ...record };
      delete copy.rolledBackReleaseId;
      return copy;
    };
    expect(withoutWithdrawal(MIDTOWN_CORE_V2_EXTERIOR_ROLLBACK)).toEqual(withoutWithdrawal(MIDTOWN_CORE_V2_EXTERIOR_ACTIVATION));
  });

  it("accepts exactly the inventory's cells through the pin gate, and nothing else", async () => {
    const cells = cellsFromInventory();
    const digest = await exteriorAcceptedCellsDigest(cells);
    const resolved = {
      releaseId: RECORD!.releaseId,
      snapshotId: RECORD!.snapshotId,
      snapshotChecksumSha256: RECORD!.snapshotChecksumSha256,
      assemblyPackageIds: [...RECORD!.assemblyPackageIds],
      cells,
      cellsDigestSha256: digest,
    };
    expect(verifyPromotedExteriorPin(resolved, RECORD!)).toEqual({ ok: true });

    // The predecessor's own resolved cells must NOT satisfy the successor's pin.
    const v2Digest = MIDTOWN_CORE_V2_EXTERIOR_ACTIVATION.membership.cellsDigestSha256!;
    const v2Resolved = verifyPromotedExteriorPin({ ...resolved, cellsDigestSha256: v2Digest }, RECORD!);
    expect(v2Resolved.ok).toBe(false);
    expect(v2Resolved.ok === false && v2Resolved.message).toContain("cell membership digest");

    const undigested = verifyPromotedExteriorPin({ ...resolved, cellsDigestSha256: null }, RECORD!);
    expect(undigested.ok).toBe(false);
    expect(undigested.ok === false && undigested.message).toContain("membership was never verified");

    const truncated = verifyPromotedExteriorPin({ ...resolved, cells: cells.slice(0, 148), cellsDigestSha256: digest }, RECORD!);
    expect(truncated.ok).toBe(false);
    expect(truncated.ok === false && truncated.message).toContain("cell count");
  });

  it("refuses the four withdrawn identities through the identity gate", () => {
    expect(verifyPromotedExteriorMembership(RECORD!.membership.buildingIds, RECORD!)).toEqual({ ok: true });
    expect(verifyPromotedExteriorMembership([], RECORD!)).toEqual({ ok: true });
    // A building the V3 wave refused is outside its accepted membership, so a
    // scene that somehow drew one fails closed instead of passing on the V2 set.
    const outside = verifyPromotedExteriorMembership(["doitt:88101"], RECORD!);
    expect(outside.ok).toBe(false);
    expect(outside.ok === false && outside.message).toContain("doitt:88101");
    expect(outside.ok === false && outside.message).toContain(RELEASE_ID);
  });

  it("makes a rollback refuse promotion-era links into the withdrawn successor", () => {
    // Forward: nothing is withdrawn, so a link into the successor is honoured.
    expect(exteriorRolledBackReleaseNotice(RELEASE_ID, RECORD!)).toBeNull();
    // Rolled back: the same link fails closed, in the same single record swap.
    const notice = exteriorRolledBackReleaseNotice(RELEASE_ID, MIDTOWN_CORE_V2_EXTERIOR_ROLLBACK);
    expect(notice).not.toBeNull();
    expect(notice).toContain(RELEASE_ID);
    expect(notice).toContain("no substitute exterior release was selected");
    // Rolling Midtown back says nothing about any other wave's release.
    expect(exteriorRolledBackReleaseNotice("manhattan-exterior-cells-20260811-v3", MIDTOWN_CORE_V2_EXTERIOR_ROLLBACK)).toBeNull();
  });
});

/**
 * Payload-dependent cross-check. This one may skip — it opens the untracked
 * release graph — but everything it proves about ACCEPTANCE is already proven
 * above from the committed inventory. It exists to show the two agree.
 */
const RELEASE_GRAPH = `public/data/${RELEASE_ID}/release-graph.json`;
describe.skipIf(!existsSync(RELEASE_GRAPH))("Midtown-core V3 record versus the emitted release graph", () => {
  it("digests the same cell set the published snapshot carries", async () => {
    const graph = JSON.parse(new TextDecoder().decode(readFileSync(RELEASE_GRAPH))) as {
      snapshots: { snapshotId: string; audience: string; cells: ExteriorAcceptedCell[] }[];
    };
    const snapshot = graph.snapshots.find((entry) => entry.snapshotId === RECORD!.snapshotId && entry.audience === "public");
    expect(snapshot).toBeDefined();
    expect(snapshot!.cells).toHaveLength(149);
    expect(await exteriorAcceptedCellsDigest(snapshot!.cells)).toBe(RECORD!.membership.cellsDigestSha256);
  });

  it("states a refusal reason on every withdrawn building rather than dropping it", () => {
    const graph = JSON.parse(new TextDecoder().decode(readFileSync(RELEASE_GRAPH))) as {
      cellReleases: { cellId: string; buildingDetails: { buildingId: string; status: string; reason?: string }[] }[];
    };
    const details = new Map(graph.cellReleases.flatMap((cell) => cell.buildingDetails.map((detail) => [detail.buildingId, detail])));
    for (const buildingId of inventory.refusedBuildingIds) {
      const detail = details.get(buildingId);
      expect(detail?.status).toBe("unavailable");
      expect(detail?.reason).toContain("Refused by the footprint-faithful V3 exterior grammar");
      expect(detail?.reason).toContain("No geometry was invented for this building");
    }
  });
});
