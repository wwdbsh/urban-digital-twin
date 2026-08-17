/**
 * Drift gate for the Southern-remainder P1 curated promotion record.
 *
 * The P1 curated release is no longer the promoted default: T005 promoted this
 * wave's `-s1` serving release, which carries the P1 record as its
 * `predecessor`. This gate is retained over that curated record, unchanged in
 * what it checks.
 *
 * This test is NEVER skipped. Every value it checks is recomputed from the
 * committed `data/southern-remainder-20260812-p1/payload-inventory.json`, which
 * is in the repository, so the gate does not depend on the untracked payload
 * directory being present on the machine that runs it. A promotion record whose
 * only check is `skipIf(payloadPresent)` is unchecked on CI and on every fresh
 * clone, which is exactly where drift survives.
 *
 * It additionally proves the three things ADR 0035 named as preconditions on
 * promotion and could not itself check: that the cache ceiling was resolved and
 * the response recorded, that the promoted subset is NOT the canary's, and that
 * its local refusal rate sits near the wave rate.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EXTERIOR_DEFAULT_ACTIVATIONS,
  SOUTHERN_REMAINDER_BASE_ONLY_PREDECESSOR,
  SOUTHERN_REMAINDER_MEMBERSHIP_BUILDING_IDS,
  SOUTHERN_REMAINDER_P1_EXTERIOR_ACTIVATION,
  exteriorAcceptedCellsDigest,
  exteriorRolledBackReleaseNotice,
  exteriorUnavailableDetail,
  verifyPromotedExteriorMembership,
  verifyPromotedExteriorPin,
  type ExteriorAcceptedCell,
} from "./exterior-default-activation";
import { EXTERIOR_RUNTIME_BUDGETS } from "./exterior-cell-runtime";
import { sha256HexSync } from "../domain/deterministic-hash";
import {
  SOUTHERN_REMAINDER_CANARY_RENDERABLE_CELL_IDS,
  SOUTHERN_REMAINDER_CURATED_CELLS,
  SOUTHERN_REMAINDER_CURATION_BASIS,
  SOUTHERN_REMAINDER_WAVE_REFUSAL_RATE,
} from "../release/southern-remainder-curation";

interface InventoryFile { path: string; byteSize: number; checksumSha256: string }
interface PayloadInventory {
  releaseId: string;
  note: string;
  predecessor: { releaseId: string; inventoryChecksumSha256: string; publicRootChecksumSha256: string; snapshotChecksumSha256: string };
  ownershipLedgerId: string;
  occupancy: { maxCacheEntries: number; promotedAssetEntries: number; alongsidePromotedHeadroom: number; curatedSubsetCeiling: number; entryBudget: number };
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
  refusedBuildingIds: string[];
  files: InventoryFile[];
}

const RELEASE_ID = "manhattan-southern-remainder-cells-20260812-p1";
const CANARY_RELEASE_ID = "manhattan-southern-remainder-cells-20260812";
/** The T005 serving release this wave's promotion slot now holds. */
const SERVING_RELEASE_ID = "manhattan-southern-remainder-cells-20260812-s1";
const INVENTORY_PATH = "data/southern-remainder-20260812-p1/payload-inventory.json";
const CANARY_INVENTORY_PATH = "data/southern-remainder-20260812/payload-inventory.json";

const inventoryText = new TextDecoder().decode(readFileSync(INVENTORY_PATH));
const inventory = JSON.parse(inventoryText) as PayloadInventory;
const RECORD = SOUTHERN_REMAINDER_P1_EXTERIOR_ACTIVATION.enabled ? SOUTHERN_REMAINDER_P1_EXTERIOR_ACTIVATION : null;

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

describe("Southern-remainder promotion record versus the committed payload inventory", () => {
  it("is enabled, is the fourth slot's predecessor, and names the successor rather than the canary", () => {
    expect(RECORD).not.toBeNull();
    expect(RECORD!.releaseId).toBe(inventory.releaseId);
    expect(RECORD!.releaseId).toBe(RELEASE_ID);
    expect(RECORD!.releaseId).not.toBe(CANARY_RELEASE_ID);
    expect(RECORD!.approvalRef).toBe("Issue #19 gate approval 2026-08-12 (T018 Southern-remainder curated promotion)");
    expect(RECORD!.rolledBackReleaseId ?? null).toBeNull();
    // Its POSITION is what this record owns, not the length of the set: T020
    // promoted a fifth wave and appended it, and T005 promoted this wave's
    // serving release into the same fourth slot with this record as its
    // predecessor. So the assertion that stays true of this record is that the
    // fourth slot is still this wave's, one link further back.
    expect(EXTERIOR_DEFAULT_ACTIVATIONS.length).toBeGreaterThanOrEqual(4);
    const promoted = EXTERIOR_DEFAULT_ACTIVATIONS[3]!;
    expect(promoted.enabled).toBe(true);
    if (!promoted.enabled) throw new Error("expected the fourth promoted default to be enabled");
    expect(promoted.predecessor.enabled && promoted.predecessor.releaseId).toBe(SERVING_RELEASE_ID);
    expect(promoted.predecessor.enabled && promoted.predecessor.predecessor).toBe(SOUTHERN_REMAINDER_P1_EXTERIOR_ACTIVATION);
  });

  it("pins the rollout snapshot and assembly package the inventory recorded", () => {
    const snapshotFile = inventory.files.find((file) => file.path.startsWith("public/rollout-snapshot/"));
    expect(snapshotFile).toBeDefined();
    expect(snapshotFile!.path).toBe(`public/rollout-snapshot/snapshot-${RELEASE_ID}-v1.json`);
    expect(RECORD!.snapshotChecksumSha256).toBe(snapshotFile!.checksumSha256);
    expect(RECORD!.snapshotId).toBe(`snapshot:${RELEASE_ID}:v1`);
    expect(RECORD!.assemblyPackageIds).toEqual([`assembly:${RELEASE_ID}:v1`]);
  });

  it("recomputes the accepted cell digest from the inventory's 176 cell releases", async () => {
    const cells = cellsFromInventory();
    expect(cells).toHaveLength(inventory.stats.cellCount!);
    expect(cells).toHaveLength(176);
    expect(RECORD!.membership.cellCount).toBe(cells.length);
    expect(RECORD!.membership.cells).toEqual([]);
    expect(RECORD!.membership.cellsDigestSha256).toBe(await exteriorAcceptedCellsDigest(cells));
    expect(cells.every((cell) => cell.cellId.startsWith("manhattan-exterior-cell-w03-"))).toBe(true);
    // A successor must not reuse the canary's cell-release identities, or a
    // resolve against the wrong release would satisfy the pin gate.
    expect(cells.every((cell) => cell.cellReleaseId.includes(RELEASE_ID))).toBe(true);
    expect(cells.every((cell) => !cell.cellReleaseId.includes(`${CANARY_RELEASE_ID}:`))).toBe(true);
  });

  it("recomputes the 179 accepted building identities from the shipped assets", () => {
    const ids = buildingIdsFrom(inventory.files);
    expect(ids).toHaveLength(inventory.stats.availableBuildingCount!);
    expect(ids).toHaveLength(179);
    expect([...RECORD!.membership.buildingIds].sort()).toEqual(ids);
    expect(SOUTHERN_REMAINDER_MEMBERSHIP_BUILDING_IDS).toHaveLength(179);
    expect(inventory.stats.shippedAssetCount).toBe(179);
  });

  it("keeps the bounded-availability shape and the truthful tombstones", () => {
    expect(inventory.stats.cellCount).toBe(176);
    expect(inventory.stats.renderableCellCount).toBe(4);
    expect(inventory.stats.notShippedCellCount).toBe(172);
    expect(inventory.stats.renderableCellCount! + inventory.stats.notShippedCellCount!).toBe(inventory.stats.cellCount);
    expect(inventory.stats.ownedBuildingCount).toBe(9603);
    expect(inventory.stats.availableBuildingCount! + inventory.stats.unavailableBuildingCount!).toBe(9603);
    // The one refused building is OUTSIDE the accepted membership, on purpose.
    expect(inventory.refusedBuildingIds).toEqual(["doitt:938827"]);
    expect(RECORD!.membership.buildingIds).not.toContain("doitt:938827");
  });

  it("ships the procedural tiles under the replay-gated admission and the decided sampler pair", () => {
    expect(inventory.textureAdmission.policy).toBe("procedural-replay");
    expect(inventory.textureAdmission.profile).toBe("procedural-texture-v1");
    // ADR 0032 amendment A1's decided filtering: LINEAR / LINEAR_MIPMAP_LINEAR.
    expect(inventory.textureAdmission.samplerFilter).toEqual({ magFilter: 9729, minFilter: 9987 });
    expect(inventory.census.maximumTextureCount).toBeGreaterThan(0);
    expect(inventory.census.maximumTextureCount).toBeLessThanOrEqual(inventory.census.textureBudget!);
  });
});

describe("ADR 0035 preconditions on promotion, checked rather than asserted", () => {
  /**
   * (a) The cache ceiling. The release's own committed record states the RAISED
   * cap it was derived against, so the response taken is legible from the bytes
   * rather than only from an ADR.
   */
  it("(a) derives its occupancy against the RAISED cache cap, and fits it", () => {
    expect(inventory.occupancy.maxCacheEntries).toBe(512);
    // The record states the cap that was IN FORCE WHEN IT WAS DERIVED, and this
    // gate no longer ties that frozen 512 to the live constant. It used to, and
    // the coupling was right while the cap stood still: it caught a build that
    // moved the cap and left a promoted wave sized against the old one.
    //
    // The T005 serving promotion raised the live cap to 1,024, and re-pointing
    // this equality at the new value would claim this release was derived
    // against a cap that did not exist when it was cut. So the frozen figure
    // stays a literal, and what is checked against the live constant is the
    // property that still has to hold: the occupancy this record declares must
    // still FIT the cache the build actually ships. A cap that fell below it
    // would still fail here.
    expect(inventory.occupancy.maxCacheEntries).toBeLessThanOrEqual(EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries);
    expect(EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries).toBe(1_024);
    expect(inventory.occupancy.promotedAssetEntries).toBe(255);
    expect(inventory.occupancy.alongsidePromotedHeadroom).toBe(257);
    expect(inventory.occupancy.curatedSubsetCeiling).toBe(200);
    expect(inventory.occupancy.entryBudget).toBe(200);
    expect(inventory.stats.shippedAssetCount).toBeLessThanOrEqual(inventory.occupancy.entryBudget);
    // The whole four-wave promoted set fits the ONE shared exterior cache, and
    // what it leaves for waves w04 and w05 is stated rather than implied.
    const resident = inventory.occupancy.promotedAssetEntries + inventory.stats.shippedAssetCount!;
    expect(resident).toBe(434);
    expect(resident).toBeLessThanOrEqual(inventory.occupancy.maxCacheEntries);
    expect(inventory.occupancy.maxCacheEntries - resident).toBe(78);
    expect(inventory.note).toContain("RAISED 512-entry cap");
  });

  it("(b) does not inherit the canary's renderable subset, and records the curation it used", () => {
    const canary = JSON.parse(new TextDecoder().decode(readFileSync(CANARY_INVENTORY_PATH))) as PayloadInventory & { renderableCellIds: string[] };
    expect(canary.renderableCellIds).toEqual(SOUTHERN_REMAINDER_CANARY_RENDERABLE_CELL_IDS);
    // Disjoint: not one canary cell is promoted, and not one promoted cell is
    // the canary's.
    for (const cellId of canary.renderableCellIds) expect(inventory.renderableCellIds).not.toContain(cellId);
    expect(inventory.renderableCellIds).toEqual(SOUTHERN_REMAINDER_CURATED_CELLS.map((record) => record.cellId));
    expect(inventory.curation.basis).toBe(SOUTHERN_REMAINDER_CURATION_BASIS);
    expect(inventory.curation.cells.map((cell) => cell.cellId)).toEqual(inventory.renderableCellIds);
    // Every admitted cell carries a written reason, not a placeholder.
    for (const cell of inventory.curation.cells) expect(cell.rationale.length).toBeGreaterThan(120);
    expect(inventory.curation.statement).toContain("EXPLICIT CURATED LIST");
  });

  it("(b) recomputes the local refusal rate and keeps it near the 1.00% wave rate", () => {
    const refusal = inventory.curation.refusal;
    expect(refusal.ownedBuildingCount).toBe(180);
    expect(refusal.materializedBuildingCount).toBe(179);
    expect(refusal.refusedBuildingCount).toBe(1);
    expect(refusal.materializedBuildingCount + refusal.refusedBuildingCount).toBe(refusal.ownedBuildingCount);
    expect(refusal.localRefusalRate).toBeCloseTo(1 / 180, 12);
    expect(refusal.waveRefusalRate).toBeCloseTo(SOUTHERN_REMAINDER_WAVE_REFUSAL_RATE, 12);
    expect(refusal.ok).toBe(true);
    // The point of the precondition: at or below the wave rate rather than far
    // above it. The canary's own cell refused 1 of 77 = 1.30%.
    expect(refusal.localRefusalRate).toBeLessThan(refusal.waveRefusalRate);
    expect(refusal.localRefusalRate).toBeLessThan(1 / 77);
  });
});

describe("Southern-remainder lineage and rollback semantics", () => {
  it("pins the T017 canary as its graph predecessor, by that release's own committed record", () => {
    const canaryText = new TextDecoder().decode(readFileSync(CANARY_INVENTORY_PATH));
    expect(inventory.predecessor.releaseId).toBe(CANARY_RELEASE_ID);
    // The canary's BYTE FREEZE, proven rather than promised: the successor's
    // committed record carries the canary inventory's own checksum, so a canary
    // that had been re-emitted would break this pin.
    expect(inventory.predecessor.inventoryChecksumSha256).toBe(sha256HexSync(canaryText));
    const canary = JSON.parse(canaryText) as PayloadInventory & { roots: Record<string, { rootChecksumSha256: string }> };
    expect(inventory.predecessor.publicRootChecksumSha256).toBe(canary.roots.public!.rootChecksumSha256);
    // Same wave, same ownership ledger identity: a successor of a DIFFERENT wave
    // would not share it.
    expect(inventory.ownershipLedgerId).toBe(canary.ownershipLedgerId);
  });

  it("rolls back to BASE MASSING, refusing the successor's link and honouring the canary's", () => {
    expect(SOUTHERN_REMAINDER_BASE_ONLY_PREDECESSOR.enabled).toBe(false);
    expect(SOUTHERN_REMAINDER_BASE_ONLY_PREDECESSOR.releaseId).toBeNull();
    expect(RECORD!.predecessor).toBe(SOUTHERN_REMAINDER_BASE_ONLY_PREDECESSOR);
    expect(SOUTHERN_REMAINDER_BASE_ONLY_PREDECESSOR.rolledBackReleaseId).toBe(RELEASE_ID);
    expect(exteriorRolledBackReleaseNotice(RELEASE_ID, SOUTHERN_REMAINDER_BASE_ONLY_PREDECESSOR))
      .toContain(`${RELEASE_ID} was rolled back in this build`);
    // The canary was never promoted, so a rollback of the successor says nothing
    // about it and its opt-in link keeps resolving.
    expect(exteriorRolledBackReleaseNotice(CANARY_RELEASE_ID, SOUTHERN_REMAINDER_BASE_ONLY_PREDECESSOR)).toBeNull();
    const statement = exteriorUnavailableDetail({
      streaming: false,
      override: null,
      activeRealBaseReleaseId: "manhattan-citywide-20260804",
      record: SOUTHERN_REMAINDER_BASE_ONLY_PREDECESSOR,
    });
    expect(statement).toContain(RELEASE_ID);
    expect(statement).toContain("base massing from release manhattan-citywide-20260804 is shown");
  });
});

describe("the promotion gates now run for this wave", () => {
  it("verifies the pin against the accepted hashes and the recomputed cell digest", async () => {
    const cells = cellsFromInventory();
    const resolved = {
      releaseId: RECORD!.releaseId,
      snapshotId: RECORD!.snapshotId,
      snapshotChecksumSha256: RECORD!.snapshotChecksumSha256,
      assemblyPackageIds: [...RECORD!.assemblyPackageIds],
      cells,
      cellsDigestSha256: await exteriorAcceptedCellsDigest(cells),
    };
    expect(verifyPromotedExteriorPin(resolved, RECORD!)).toEqual({ ok: true });
    // A digest-form record with no computed digest is a failure, never a pass by
    // omission.
    expect(verifyPromotedExteriorPin({ ...resolved, cellsDigestSha256: null }, RECORD!).ok).toBe(false);
    // One cell-release checksum differing changes the digest and fails closed.
    const tampered = [...cells];
    tampered[0] = { ...tampered[0]!, checksumSha256: "f".repeat(64) };
    expect(verifyPromotedExteriorPin({ ...resolved, cells: tampered, cellsDigestSha256: await exteriorAcceptedCellsDigest(tampered) }, RECORD!).ok).toBe(false);
  });

  it("verifies rendered identities against the accepted membership", () => {
    expect(verifyPromotedExteriorMembership([...SOUTHERN_REMAINDER_MEMBERSHIP_BUILDING_IDS], RECORD!)).toEqual({ ok: true });
    // The refused building must fail closed if a scene somehow drew it.
    const outcome = verifyPromotedExteriorMembership(["doitt:938827"], RECORD!);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected the identity gate to fail closed");
    expect(outcome.message).toContain("doitt:938827");
    expect(outcome.message).toContain(RELEASE_ID);
  });
});
