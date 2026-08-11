/**
 * Drift gate for the ACTIVE Lower-Manhattan promotion record.
 *
 * This test is NEVER skipped. Every value it checks is recomputed from the
 * committed `data/lower-manhattan-20260812-p1/payload-inventory.json`, which is
 * in the repository, so the gate does not depend on the untracked payload
 * directory being present on the machine that runs it. A promotion record whose
 * only check is `skipIf(payloadPresent)` is unchecked on CI and on every fresh
 * clone, which is exactly where drift survives.
 *
 * It additionally proves the two things ADR 0034 named as preconditions on
 * promotion and could not itself check: that the promoted subset is NOT the
 * canary's, and that its local refusal rate sits near the wave rate.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LOWER_MANHATTAN_BASE_ONLY_PREDECESSOR,
  LOWER_MANHATTAN_EXTERIOR_ACTIVATION,
  LOWER_MANHATTAN_MEMBERSHIP_BUILDING_IDS,
  exteriorAcceptedCellsDigest,
  exteriorRolledBackReleaseNotice,
  exteriorUnavailableDetail,
  verifyPromotedExteriorMembership,
  verifyPromotedExteriorPin,
  type ExteriorAcceptedCell,
} from "./exterior-default-activation";
import { sha256HexSync } from "../domain/deterministic-hash";
import {
  LOWER_MANHATTAN_CANARY_RENDERABLE_CELL_IDS,
  LOWER_MANHATTAN_CURATED_CELLS,
  LOWER_MANHATTAN_CURATION_BASIS,
  LOWER_MANHATTAN_FINANCIAL_DISTRICT_ENVELOPE,
  LOWER_MANHATTAN_WAVE_REFUSAL_RATE,
} from "../release/lower-manhattan-curation";

interface InventoryFile { path: string; byteSize: number; checksumSha256: string }
interface PayloadInventory {
  releaseId: string;
  predecessor: { releaseId: string; inventoryChecksumSha256: string; publicRootChecksumSha256: string; snapshotChecksumSha256: string };
  ownershipLedgerId: string;
  occupancy: { maxCacheEntries: number; block835AssetEntries: number; midtownAssetEntries: number; promotedAssetEntries: number; entryBudget: number };
  renderableCellIds: string[];
  curation: {
    basis: string;
    statement: string;
    cells: { cellId: string; parentOrder: number; rationale: string }[];
    refusal: { ownedBuildingCount: number; materializedBuildingCount: number; refusedBuildingCount: number; localRefusalRate: number; waveRefusalRate: number; maxRefusalRate: number; ok: boolean };
  };
  textureAdmission: { policy: string; profile: string; rasterizerVersion: string; parametersHashSha256: string; samplerFilter: { magFilter: number; minFilter: number } };
  stats: Record<string, number>;
  census: Record<string, number>;
  absentSetbackBuildingIds: string[];
  refusedBuildingIds: string[];
  files: InventoryFile[];
}

const RELEASE_ID = "manhattan-lower-manhattan-cells-20260812-p1";
const CANARY_RELEASE_ID = "manhattan-lower-manhattan-cells-20260812";
const INVENTORY_PATH = "data/lower-manhattan-20260812-p1/payload-inventory.json";
const CANARY_INVENTORY_PATH = "data/lower-manhattan-20260812/payload-inventory.json";
const inventoryText = new TextDecoder().decode(readFileSync(INVENTORY_PATH));
const inventory = JSON.parse(inventoryText) as PayloadInventory;
const RECORD = LOWER_MANHATTAN_EXTERIOR_ACTIVATION.enabled ? LOWER_MANHATTAN_EXTERIOR_ACTIVATION : null;

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

describe("Lower-Manhattan promotion record versus the committed payload inventory", () => {
  it("is enabled and names the inventory's successor release, not the canary", () => {
    expect(RECORD).not.toBeNull();
    expect(RECORD!.releaseId).toBe(inventory.releaseId);
    expect(RECORD!.releaseId).toBe(RELEASE_ID);
    expect(RECORD!.releaseId).not.toBe(CANARY_RELEASE_ID);
    expect(RECORD!.approvalRef).toBe("Issue #17 gate approval 2026-08-12 (T016 Lower-Manhattan curated promotion)");
    expect(RECORD!.rolledBackReleaseId ?? null).toBeNull();
  });

  it("pins the rollout snapshot and assembly package the inventory recorded", () => {
    const snapshotFile = inventory.files.find((file) => file.path.startsWith("public/rollout-snapshot/"));
    expect(snapshotFile).toBeDefined();
    expect(snapshotFile!.path).toBe(`public/rollout-snapshot/snapshot-${RELEASE_ID}-v1.json`);
    expect(RECORD!.snapshotChecksumSha256).toBe(snapshotFile!.checksumSha256);
    expect(RECORD!.snapshotId).toBe(`snapshot:${RELEASE_ID}:v1`);
    expect(RECORD!.assemblyPackageIds).toEqual([`assembly:${RELEASE_ID}:v1`]);
  });

  it("recomputes the accepted cell digest from the inventory's 126 cell releases", async () => {
    const cells = cellsFromInventory();
    expect(cells).toHaveLength(inventory.stats.cellCount!);
    expect(cells).toHaveLength(126);
    expect(RECORD!.membership.cellCount).toBe(cells.length);
    expect(RECORD!.membership.cellsDigestSha256).toBe(await exteriorAcceptedCellsDigest(cells));
    expect(cells.every((cell) => cell.cellId.startsWith("manhattan-exterior-cell-w02-"))).toBe(true);
    // A successor must not reuse the canary's cell-release identities, or a
    // resolve against the wrong release would satisfy the pin gate.
    expect(cells.every((cell) => cell.cellReleaseId.includes(RELEASE_ID))).toBe(true);
    expect(cells.every((cell) => !cell.cellReleaseId.includes(`${CANARY_RELEASE_ID}:`))).toBe(true);
  });

  it("recomputes the 71 accepted building identities from the shipped assets", () => {
    const ids = buildingIdsFrom(inventory.files);
    expect(ids).toHaveLength(inventory.stats.availableBuildingCount!);
    expect(ids).toHaveLength(71);
    expect([...RECORD!.membership.buildingIds].sort()).toEqual(ids);
    expect(LOWER_MANHATTAN_MEMBERSHIP_BUILDING_IDS).toHaveLength(71);
    expect(inventory.stats.shippedAssetCount).toBe(71);
  });

  it("keeps the bounded-availability shape and the truthful tombstones", () => {
    expect(inventory.stats.cellCount).toBe(126);
    expect(inventory.stats.renderableCellCount).toBe(2);
    expect(inventory.stats.notShippedCellCount).toBe(124);
    expect(inventory.stats.renderableCellCount! + inventory.stats.notShippedCellCount!).toBe(inventory.stats.cellCount);
    expect(inventory.stats.ownedBuildingCount).toBe(6425);
    expect(inventory.stats.availableBuildingCount! + inventory.stats.unavailableBuildingCount!).toBe(6425);
    // The one refused building is OUTSIDE the accepted membership, on purpose.
    expect(inventory.refusedBuildingIds).toEqual(["doitt:602678"]);
    expect(RECORD!.membership.buildingIds).not.toContain("doitt:602678");
  });

  it("ships the procedural tiles under the replay-gated admission and the decided sampler pair", () => {
    expect(inventory.textureAdmission.policy).toBe("procedural-replay");
    expect(inventory.textureAdmission.profile).toBe("procedural-texture-v1");
    // ADR 0032 amendment A1's decided filtering: LINEAR / LINEAR_MIPMAP_LINEAR.
    expect(inventory.textureAdmission.samplerFilter).toEqual({ magFilter: 9729, minFilter: 9987 });
    expect(inventory.census.maximumTextureCount).toBeLessThanOrEqual(inventory.census.textureBudget!);
    expect(inventory.census.maximumTextureCount).toBeGreaterThan(0);
  });
});

describe("ADR 0034 preconditions on promotion, checked rather than asserted", () => {
  it("(a) does not inherit the canary's renderable subset, and records the curation it used", () => {
    const canary = JSON.parse(new TextDecoder().decode(readFileSync(CANARY_INVENTORY_PATH))) as PayloadInventory & { renderableCellIds: string[] };
    expect(canary.renderableCellIds).toEqual(LOWER_MANHATTAN_CANARY_RENDERABLE_CELL_IDS);
    // Disjoint: not one canary cell is promoted, and not one promoted cell is
    // the canary's. "Silently reusing cells 150-151" is excluded by measurement.
    for (const cellId of canary.renderableCellIds) expect(inventory.renderableCellIds).not.toContain(cellId);
    for (const cellId of inventory.renderableCellIds) expect(canary.renderableCellIds).not.toContain(cellId);
    // The curation is RECORDED, which is the half of (a) that is about honesty
    // rather than about which cells were picked.
    expect(inventory.curation.basis).toBe(LOWER_MANHATTAN_CURATION_BASIS);
    expect(inventory.curation.basis).toBe("curated-list");
    expect(inventory.curation.cells.map((cell) => cell.cellId)).toEqual(inventory.renderableCellIds);
    expect(inventory.curation.cells.map((cell) => cell.cellId).sort())
      .toEqual(LOWER_MANHATTAN_CURATED_CELLS.map((cell) => cell.cellId).sort());
    for (const cell of inventory.curation.cells) expect(cell.rationale.length).toBeGreaterThan(80);
    expect(inventory.curation.statement).toContain("EXPLICIT CURATED LIST");
    // The canary itself carries no curation record, because it did not curate.
    expect((canary as { curation?: unknown }).curation).toBeUndefined();
  });

  it("(b) promotes Financial District cells whose local refusal rate is near the wave rate", () => {
    const envelope = LOWER_MANHATTAN_FINANCIAL_DISTRICT_ENVELOPE;
    // Every promoted cell id encodes its full-city order, and every curated
    // record's parent order is one the ledger actually assigned.
    for (const record of LOWER_MANHATTAN_CURATED_CELLS) {
      expect(record.cellId).toContain(`-w02-${String(record.parentOrder).padStart(6, "0")}-`);
    }
    expect(envelope.north).toBeLessThan(40.716);
    expect(envelope.south).toBeGreaterThan(40.700);

    const refusal = inventory.curation.refusal;
    expect(refusal.ownedBuildingCount).toBe(72);
    expect(refusal.materializedBuildingCount).toBe(71);
    expect(refusal.refusedBuildingCount).toBe(1);
    expect(refusal.materializedBuildingCount + refusal.refusedBuildingCount).toBe(refusal.ownedBuildingCount);
    expect(refusal.localRefusalRate).toBeCloseTo(1 / 72, 12);
    expect(refusal.waveRefusalRate).toBeCloseTo(LOWER_MANHATTAN_WAVE_REFUSAL_RATE, 12);
    expect(refusal.ok).toBe(true);
    // The point of the precondition: materially closer to 2.09% than to 34%.
    const canaryLocalRate = 21 / 62;
    expect(Math.abs(refusal.localRefusalRate - refusal.waveRefusalRate))
      .toBeLessThan(Math.abs(canaryLocalRate - refusal.waveRefusalRate) / 10);
  });

  it("fits alongside both promoted waves against the pinned entry budget", () => {
    expect(inventory.occupancy.maxCacheEntries).toBe(256);
    expect(inventory.occupancy.block835AssetEntries).toBe(28);
    expect(inventory.occupancy.midtownAssetEntries).toBe(156);
    expect(inventory.occupancy.promotedAssetEntries).toBe(184);
    expect(inventory.occupancy.entryBudget).toBe(72);
    expect(inventory.stats.shippedAssetCount).toBeLessThanOrEqual(inventory.occupancy.entryBudget);
    // The whole promoted set fits the ONE shared exterior cache.
    expect(inventory.occupancy.promotedAssetEntries + inventory.stats.shippedAssetCount!)
      .toBeLessThanOrEqual(inventory.occupancy.maxCacheEntries);
  });
});

describe("Lower-Manhattan lineage and rollback semantics", () => {
  it("pins the T015 canary as its graph predecessor, by that release's own committed record", () => {
    const canaryText = new TextDecoder().decode(readFileSync(CANARY_INVENTORY_PATH));
    expect(inventory.predecessor.releaseId).toBe(CANARY_RELEASE_ID);
    // The predecessor pin is over the canary's committed inventory BYTES.
    const digest = sha256HexSync(canaryText);
    expect(inventory.predecessor.inventoryChecksumSha256).toBe(digest);
    // Same wave, so the ownership ledger id is the wave's and does not move.
    const canary = JSON.parse(canaryText) as PayloadInventory;
    expect(inventory.ownershipLedgerId).toBe(canary.ownershipLedgerId);
  });

  it("rolls back to BASE MASSING, because no earlier w02 default exists", () => {
    expect(RECORD!.predecessor).toBe(LOWER_MANHATTAN_BASE_ONLY_PREDECESSOR);
    expect(RECORD!.predecessor.enabled).toBe(false);
    expect(RECORD!.predecessor.releaseId).toBeNull();
    // The rollback withdraws the PROMOTED successor and says so by name...
    expect(LOWER_MANHATTAN_BASE_ONLY_PREDECESSOR.rolledBackReleaseId).toBe(RELEASE_ID);
    // ...and deliberately does NOT withdraw the canary, which was never promoted
    // and whose opt-in link is unaffected by this wave's rollback.
    expect(LOWER_MANHATTAN_BASE_ONLY_PREDECESSOR.rolledBackReleaseId).not.toBe(CANARY_RELEASE_ID);
    expect(exteriorRolledBackReleaseNotice(CANARY_RELEASE_ID, LOWER_MANHATTAN_BASE_ONLY_PREDECESSOR)).toBeNull();
  });

  it("makes a rollback refuse promotion-era links into the withdrawn successor", () => {
    expect(exteriorRolledBackReleaseNotice(RELEASE_ID, RECORD!)).toBeNull();
    const notice = exteriorRolledBackReleaseNotice(RELEASE_ID, LOWER_MANHATTAN_BASE_ONLY_PREDECESSOR);
    expect(notice).not.toBeNull();
    expect(notice).toContain(RELEASE_ID);
    expect(notice).toContain("no substitute exterior release was selected");
    // Rolling this wave back says nothing about the other two.
    expect(exteriorRolledBackReleaseNotice("manhattan-exterior-cells-20260811-v3", LOWER_MANHATTAN_BASE_ONLY_PREDECESSOR)).toBeNull();
    expect(exteriorRolledBackReleaseNotice("manhattan-midtown-core-cells-20260811-v3", LOWER_MANHATTAN_BASE_ONLY_PREDECESSOR)).toBeNull();
  });

  it("states the base-massing outcome in words when rolled back", () => {
    const statement = exteriorUnavailableDetail({
      streaming: false,
      override: null,
      activeRealBaseReleaseId: "manhattan-citywide-20260804",
      explicitReleaseId: null,
      record: LOWER_MANHATTAN_BASE_ONLY_PREDECESSOR,
    });
    expect(statement).toContain(RELEASE_ID);
    expect(statement).toContain("base massing from release manhattan-citywide-20260804 is shown");
    expect(statement).toContain("no substitute exterior was selected");
  });
});

describe("Lower-Manhattan promotion gates", () => {
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

    // The CANARY release must not satisfy the promoted pin, or promoting the
    // successor would have accepted the subset ADR 0034 forbade.
    const wrongRelease = verifyPromotedExteriorPin({ ...resolved, releaseId: CANARY_RELEASE_ID }, RECORD!);
    expect(wrongRelease.ok).toBe(false);
    expect(wrongRelease.ok === false && wrongRelease.message).toContain("release");

    const undigested = verifyPromotedExteriorPin({ ...resolved, cellsDigestSha256: null }, RECORD!);
    expect(undigested.ok).toBe(false);
    expect(undigested.ok === false && undigested.message).toContain("membership was never verified");

    const truncated = verifyPromotedExteriorPin({ ...resolved, cells: cells.slice(0, 125), cellsDigestSha256: digest }, RECORD!);
    expect(truncated.ok).toBe(false);
    expect(truncated.ok === false && truncated.message).toContain("cell count");
  });

  it("refuses the refused identity through the identity gate", () => {
    expect(verifyPromotedExteriorMembership(RECORD!.membership.buildingIds, RECORD!)).toEqual({ ok: true });
    expect(verifyPromotedExteriorMembership([], RECORD!)).toEqual({ ok: true });
    const outside = verifyPromotedExteriorMembership(["doitt:602678"], RECORD!);
    expect(outside.ok).toBe(false);
    expect(outside.ok === false && outside.message).toContain("doitt:602678");
    expect(outside.ok === false && outside.message).toContain(RELEASE_ID);
    // A building of ANOTHER promoted wave is also outside this wave's membership.
    const midtown = verifyPromotedExteriorMembership(["doitt:1001111"], RECORD!);
    expect(midtown.ok).toBe(false);
  });
});

/**
 * Payload-dependent cross-check. This one may skip — it opens the untracked
 * release graph — but everything it proves about ACCEPTANCE is already proven
 * above from the committed inventory. It exists to show the two agree.
 */
const RELEASE_GRAPH = `public/data/${RELEASE_ID}/release-graph.json`;
describe.skipIf(!existsSync(RELEASE_GRAPH))("Lower-Manhattan record versus the emitted release graph", () => {
  it("digests the same cell set the published snapshot carries", async () => {
    const graph = JSON.parse(new TextDecoder().decode(readFileSync(RELEASE_GRAPH))) as {
      snapshots: { snapshotId: string; audience: string; cells: ExteriorAcceptedCell[] }[];
    };
    const snapshot = graph.snapshots.find((entry) => entry.snapshotId === RECORD!.snapshotId && entry.audience === "public");
    expect(snapshot).toBeDefined();
    expect(snapshot!.cells).toHaveLength(126);
    expect(await exteriorAcceptedCellsDigest(snapshot!.cells)).toBe(RECORD!.membership.cellsDigestSha256);
  });

  it("states a refusal reason on the refused building and a tombstone reason on unshipped cells", () => {
    const graph = JSON.parse(new TextDecoder().decode(readFileSync(RELEASE_GRAPH))) as {
      cellReleases: { cellId: string; buildingDetails: { buildingId: string; status: string; reason?: string }[] }[];
    };
    const details = new Map(graph.cellReleases.flatMap((cell) => cell.buildingDetails.map((detail) => [detail.buildingId, detail])));
    const refused = details.get("doitt:602678");
    expect(refused?.status).toBe("unavailable");
    expect(refused?.reason).toContain("Refused by the footprint-faithful V3 exterior grammar");
    expect(refused?.reason).toContain("No geometry was invented for this building");

    // A tombstoned cell states why it ships no geometry rather than going quiet.
    const tombstoned = graph.cellReleases.find((cell) => !inventory.renderableCellIds.includes(cell.cellId));
    expect(tombstoned).toBeDefined();
    expect(tombstoned!.buildingDetails.every((detail) => detail.status === "unavailable")).toBe(true);
    expect(tombstoned!.buildingDetails[0]?.reason ?? "").not.toBe("");
  });
});
