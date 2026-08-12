/**
 * Drift gate for the ACTIVE Central-and-upper-Manhattan promotion record.
 *
 * This test is NEVER skipped. Every value it checks is recomputed from the
 * committed `data/central-upper-manhattan-20260812-p1/payload-inventory.json`,
 * which is in the repository, so the gate does not depend on the untracked
 * payload directory being present on the machine that runs it. A promotion
 * record whose only check is `skipIf(payloadPresent)` is unchecked on CI and on
 * every fresh clone, which is exactly where drift survives.
 *
 * It additionally proves the five things ADR 0036 named as preconditions on
 * promotion and could not itself check: that the 78-entry split was DECIDED and
 * recorded by number, that the promoted subset is an explicit curated list and
 * not the canary's, that the local refusal rate was recomputed rather than
 * inherited, that the curated subset's own volume-identity margin was measured,
 * and that rollback semantics are stated rather than assumed.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CENTRAL_UPPER_MANHATTAN_BASE_ONLY_PREDECESSOR,
  CENTRAL_UPPER_MANHATTAN_EXTERIOR_ACTIVATION,
  CENTRAL_UPPER_MANHATTAN_MEMBERSHIP_BUILDING_IDS,
  EXTERIOR_DEFAULT_ACTIVATIONS,
  SOUTHERN_REMAINDER_EXTERIOR_ACTIVATION,
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
  CENTRAL_UPPER_MANHATTAN_CANARY_RENDERABLE_CELL_IDS,
  CENTRAL_UPPER_MANHATTAN_CURATED_CELLS,
  CENTRAL_UPPER_MANHATTAN_CURATION_BASIS,
  CENTRAL_UPPER_MANHATTAN_W05_RESERVED_ENTRIES,
  CENTRAL_UPPER_MANHATTAN_WAVE_REFUSAL_RATE,
} from "../release/central-upper-manhattan-curation";

interface InventoryFile { path: string; byteSize: number; checksumSha256: string }
interface PayloadInventory {
  releaseId: string;
  note: string;
  predecessor: { releaseId: string; inventoryChecksumSha256: string; publicRootChecksumSha256: string; snapshotChecksumSha256: string };
  ownershipLedgerId: string;
  occupancy: {
    maxCacheEntries: number;
    promotedWaves: { releaseId: string; assetEntries: number }[];
    promotedWaveCount: number;
    promotedAssetEntries: number;
    alongsidePromotedHeadroom: number;
    splitResponse: number;
    splitBasis: string;
    splitStatement: string;
    curatedSubsetCeiling: number;
    reservedForNextWaveEntries: number;
    reservedForNextWaveId: string;
    entryBudget: number;
  };
  renderableCellIds: string[];
  curation: {
    basis: string;
    statement: string;
    cells: { cellId: string; parentOrder: number; rationale: string }[];
    refusal: { ownedBuildingCount: number; materializedBuildingCount: number; refusedBuildingCount: number; localRefusalRate: number; waveRefusalRate: number; maxRefusalRate: number; localRateExceedsWaveRate: boolean; ok: boolean };
    volumeMargin: { buildingsChecked: number; buildingsRejected: number; worstVolumeDeviation: number; tolerance: number; worstDeviationAsFractionOfTolerance: number; waveWorstDeviationAsFractionOfTolerance: number; betterThanWave: boolean; ok: boolean };
  };
  textureAdmission: { policy: string; profile: string; rasterizerVersion: string; parametersHashSha256: string; samplerFilter: { magFilter: number; minFilter: number } };
  stats: Record<string, number>;
  census: Record<string, number>;
  refusedBuildingIds: string[];
  files: InventoryFile[];
}

const RELEASE_ID = "manhattan-central-upper-manhattan-cells-20260812-p1";
const CANARY_RELEASE_ID = "manhattan-central-upper-manhattan-cells-20260812";
const INVENTORY_PATH = "data/central-upper-manhattan-20260812-p1/payload-inventory.json";
const CANARY_INVENTORY_PATH = "data/central-upper-manhattan-20260812/payload-inventory.json";
const LEDGER_PATH = "data/normalized/manhattan-exterior-wave-ledger-20260804/ledger.json";
const MIDTOWN_INVENTORY_PATH = "data/midtown-core-20260811-v3/payload-inventory.json";
/** The promoted Midtown-core ownership cell both curated cells share an edge with. */
const MIDTOWN_NEIGHBOUR_CELL_ID = "manhattan-exterior-cell-w01-000106-15-9650-8962";

const inventoryText = new TextDecoder().decode(readFileSync(INVENTORY_PATH));
const inventory = JSON.parse(inventoryText) as PayloadInventory;
const RECORD = CENTRAL_UPPER_MANHATTAN_EXTERIOR_ACTIVATION.enabled ? CENTRAL_UPPER_MANHATTAN_EXTERIOR_ACTIVATION : null;

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

describe("Central-and-upper-Manhattan promotion record versus the committed payload inventory", () => {
  it("is enabled, is the fifth record, and names the successor rather than the canary", () => {
    expect(RECORD).not.toBeNull();
    expect(RECORD!.releaseId).toBe(inventory.releaseId);
    expect(RECORD!.releaseId).toBe(RELEASE_ID);
    expect(RECORD!.releaseId).not.toBe(CANARY_RELEASE_ID);
    expect(RECORD!.approvalRef).toBe("Issue #21 gate approval 2026-08-12 (T020 Central-and-upper-Manhattan curated promotion)");
    expect(RECORD!.rolledBackReleaseId ?? null).toBeNull();
    // Its POSITION is what this record owns, not the length of the set: T022
    // promoted a sixth wave and appended it, so the assertion that stays true of
    // this record is that it is still the fifth and still the same object. Same
    // correction the southern-remainder gate took at T020, for the same reason.
    expect(EXTERIOR_DEFAULT_ACTIVATIONS.length).toBeGreaterThanOrEqual(5);
    expect(EXTERIOR_DEFAULT_ACTIVATIONS[4]).toBe(CENTRAL_UPPER_MANHATTAN_EXTERIOR_ACTIVATION);
    // The four earlier records are untouched by this promotion, and the one
    // immediately before it is asserted by identity rather than by shape.
    expect(EXTERIOR_DEFAULT_ACTIVATIONS[3]).toBe(SOUTHERN_REMAINDER_EXTERIOR_ACTIVATION);
  });

  it("pins the rollout snapshot and assembly package the inventory recorded", () => {
    const snapshotFile = inventory.files.find((file) => file.path.startsWith("public/rollout-snapshot/"));
    expect(snapshotFile).toBeDefined();
    expect(snapshotFile!.path).toBe(`public/rollout-snapshot/snapshot-${RELEASE_ID}-v1.json`);
    expect(RECORD!.snapshotChecksumSha256).toBe(snapshotFile!.checksumSha256);
    expect(RECORD!.snapshotId).toBe(`snapshot:${RELEASE_ID}:v1`);
    expect(RECORD!.assemblyPackageIds).toEqual([`assembly:${RELEASE_ID}:v1`]);
  });

  it("recomputes the accepted cell digest from the inventory's 249 cell releases", async () => {
    const cells = cellsFromInventory();
    expect(cells).toHaveLength(inventory.stats.cellCount!);
    expect(cells).toHaveLength(249);
    expect(RECORD!.membership.cellCount).toBe(cells.length);
    expect(RECORD!.membership.cells).toEqual([]);
    expect(RECORD!.membership.cellsDigestSha256).toBe(await exteriorAcceptedCellsDigest(cells));
    expect(cells.every((cell) => cell.cellId.startsWith("manhattan-exterior-cell-w04-"))).toBe(true);
    // A successor must not reuse the canary's cell-release identities, or a
    // resolve against the wrong release would satisfy the pin gate.
    expect(cells.every((cell) => cell.cellReleaseId.includes(RELEASE_ID))).toBe(true);
    expect(cells.every((cell) => !cell.cellReleaseId.includes(`${CANARY_RELEASE_ID}:`))).toBe(true);
  });

  it("recomputes the 40 accepted building identities from the shipped assets", () => {
    const ids = buildingIdsFrom(inventory.files);
    expect(ids).toHaveLength(inventory.stats.availableBuildingCount!);
    expect(ids).toHaveLength(40);
    expect([...RECORD!.membership.buildingIds].sort()).toEqual(ids);
    expect(CENTRAL_UPPER_MANHATTAN_MEMBERSHIP_BUILDING_IDS).toHaveLength(40);
    expect(inventory.stats.shippedAssetCount).toBe(40);
  });

  it("keeps the bounded-availability shape and the truthful tombstones", () => {
    expect(inventory.stats.cellCount).toBe(249);
    expect(inventory.stats.renderableCellCount).toBe(2);
    expect(inventory.stats.notShippedCellCount).toBe(247);
    expect(inventory.stats.renderableCellCount! + inventory.stats.notShippedCellCount!).toBe(inventory.stats.cellCount);
    expect(inventory.stats.ownedBuildingCount).toBe(11721);
    expect(inventory.stats.availableBuildingCount! + inventory.stats.unavailableBuildingCount!).toBe(11721);
    // The one refused building is OUTSIDE the accepted membership, on purpose.
    expect(inventory.refusedBuildingIds).toEqual(["doitt:996078"]);
    expect(RECORD!.membership.buildingIds).not.toContain("doitt:996078");
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

describe("ADR 0036 preconditions on promotion, checked rather than asserted", () => {
  /**
   * (a) The 78-entry split must be DECIDED and recorded by number. The release's
   * own committed record carries the response number, the basis, the arithmetic
   * and what it costs the other wave, so the decision is legible from the bytes
   * rather than only from an ADR.
   */
  it("(a) records the split by number, takes response 2, and does NOT move the cache cap", () => {
    expect(inventory.occupancy.maxCacheEntries).toBe(512);
    expect(inventory.occupancy.maxCacheEntries).toBe(EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries);
    expect(inventory.occupancy.promotedAssetEntries).toBe(434);
    expect(inventory.occupancy.promotedWaveCount).toBe(4);
    expect(inventory.occupancy.promotedWaves.reduce((sum, wave) => sum + wave.assetEntries, 0)).toBe(434);
    expect(inventory.occupancy.alongsidePromotedHeadroom).toBe(78);
    expect(inventory.occupancy.splitResponse).toBe(2);
    expect(inventory.occupancy.splitBasis).toBe("proportional-to-canonical-buildings");
    expect(inventory.occupancy.curatedSubsetCeiling).toBe(42);
    expect(inventory.occupancy.reservedForNextWaveEntries).toBe(CENTRAL_UPPER_MANHATTAN_W05_RESERVED_ENTRIES);
    expect(inventory.occupancy.reservedForNextWaveId).toBe("northern-manhattan");
    expect(inventory.occupancy.curatedSubsetCeiling + inventory.occupancy.reservedForNextWaveEntries)
      .toBe(inventory.occupancy.alongsidePromotedHeadroom);
    expect(inventory.occupancy.entryBudget).toBe(42);
    expect(inventory.stats.shippedAssetCount).toBeLessThanOrEqual(inventory.occupancy.entryBudget);
    // RESPONSE 1 was not taken: the whole headroom is not consumed.
    expect(inventory.stats.shippedAssetCount).toBeLessThan(inventory.occupancy.alongsidePromotedHeadroom);
    // RESPONSE 3 was not taken: no cap change accompanies this promotion.
    expect(inventory.occupancy.splitStatement).toMatch(/RESPONSE 3 WAS NOT TAKEN/u);
    expect(inventory.occupancy.splitStatement).toMatch(/RESPONSE 1 WAS NOT TAKEN/u);
    // ADR 0034's response 3 — resolved rather than disk counting — was
    // considered at this task and rejected, and the reason is in the bytes.
    expect(inventory.occupancy.splitStatement).toMatch(/ADR 0034's admissible response 3/u);
    expect(inventory.occupancy.splitStatement).toMatch(/BOTH of those levels can be resident/u);
    // The five-wave promoted composition, and the reserve that survives it.
    const resident = inventory.occupancy.promotedAssetEntries + inventory.stats.shippedAssetCount!;
    expect(resident).toBe(474);
    expect(resident).toBeLessThanOrEqual(inventory.occupancy.maxCacheEntries);
    expect(inventory.occupancy.maxCacheEntries - resident).toBeGreaterThanOrEqual(CENTRAL_UPPER_MANHATTAN_W05_RESERVED_ENTRIES);
    expect(inventory.note).toContain("UNCHANGED 512-entry cap");
  });

  it("(b) does not inherit the canary's renderable subset, and records the curation it used", () => {
    const canary = JSON.parse(new TextDecoder().decode(readFileSync(CANARY_INVENTORY_PATH))) as PayloadInventory & { renderableCellIds: string[] };
    expect(canary.renderableCellIds).toEqual(CENTRAL_UPPER_MANHATTAN_CANARY_RENDERABLE_CELL_IDS);
    // Disjoint: not one canary cell is promoted, and not one promoted cell is
    // the canary's.
    for (const cellId of canary.renderableCellIds) expect(inventory.renderableCellIds).not.toContain(cellId);
    expect(inventory.renderableCellIds).toEqual(CENTRAL_UPPER_MANHATTAN_CURATED_CELLS.map((record) => record.cellId));
    expect(inventory.curation.basis).toBe(CENTRAL_UPPER_MANHATTAN_CURATION_BASIS);
    expect(inventory.curation.cells.map((cell) => cell.cellId)).toEqual(inventory.renderableCellIds);
    // Every admitted cell carries a written reason, not a placeholder.
    for (const cell of inventory.curation.cells) expect(cell.rationale.length).toBeGreaterThan(120);
    expect(inventory.curation.statement).toContain("EXPLICIT CURATED LIST");
    // The 90 m threshold question ADR 0036 (b) asked, answered in the bytes.
    expect(inventory.curation.statement).toMatch(/CHECKED AGAINST THIS WAVE RATHER THAN REUSED/u);
    // The textured-adjacency claim is stated at its true strength in the shipped
    // bytes; the sentence is checked here and the FACT it asserts is checked
    // computationally in its own case below.
    expect(inventory.curation.statement).toMatch(/TOMBSTONE IN THE MIDTOWN-CORE RELEASE/u);
  });

  /**
   * THE ADJACENCY CLAIM, COMPUTED RATHER THAN SPELLED.
   *
   * The curation statement makes one claim about ANOTHER release's geometry: that
   * both curated cells share an edge with Midtown-core ownership cell
   * `w01-000106`, and that this cell is a TOMBSTONE there — so the two waves abut
   * on owned ground while their TEXTURED patches do not touch. A regex over the
   * statement proves the release says it; it cannot prove it is true, and this was
   * the only factual claim in the release bytes with no gate behind it.
   *
   * Both halves are derived here from committed bytes alone: the shared edge from
   * the committed wave ledger, and the tombstone from the Midtown-core V3
   * inventory's own shipped assets. Neither needs a payload directory, so this
   * gate is never skipped.
   */
  it("proves the shared edge and the tombstone, from the committed ledger and Midtown's own inventory", () => {
    interface LedgerCell { cellId: string; bounds: { west: number; south: number; east: number; north: number }; buildingIds: string[] }
    const ledger = JSON.parse(new TextDecoder().decode(readFileSync(LEDGER_PATH))) as { cells: LedgerCell[] };
    const neighbour = ledger.cells.find((cell) => cell.cellId === MIDTOWN_NEIGHBOUR_CELL_ID);
    expect(neighbour).toBeDefined();
    expect(inventory.curation.statement).toContain(MIDTOWN_NEIGHBOUR_CELL_ID);

    // (1) A FULL-SPAN shared edge, not a corner and not a partial overlap: the
    // neighbour's north bound is exactly each curated cell's south bound, and the
    // longitude overlap is the whole of that curated cell's longitude span.
    for (const record of CENTRAL_UPPER_MANHATTAN_CURATED_CELLS) {
      const curated = ledger.cells.find((cell) => cell.cellId === record.cellId)!;
      const overlap = Math.min(neighbour!.bounds.east, curated.bounds.east) - Math.max(neighbour!.bounds.west, curated.bounds.west);
      expect({
        cell: record.parentOrder,
        sharesLatitudeEdge: neighbour!.bounds.north === curated.bounds.south,
        overlapIsFullSpan: overlap === curated.bounds.east - curated.bounds.west,
      }).toEqual({ cell: record.parentOrder, sharesLatitudeEdge: true, overlapIsFullSpan: true });
    }
    // The two curated cells together cover the neighbour's whole northern edge,
    // which is what makes "this subset abuts a promoted wave's owned ground" a
    // statement about the boundary rather than about a fragment of it.
    const curatedBounds = CENTRAL_UPPER_MANHATTAN_CURATED_CELLS
      .map((record) => ledger.cells.find((cell) => cell.cellId === record.cellId)!.bounds);
    expect(Math.min(...curatedBounds.map((bounds) => bounds.west))).toBe(neighbour!.bounds.west);
    expect(Math.max(...curatedBounds.map((bounds) => bounds.east))).toBe(neighbour!.bounds.east);

    // (2) The neighbour is a TOMBSTONE in the Midtown-core release. Its
    // renderable cells are derived from the assets that release actually
    // shipped — one GLB per accepted building — rather than from a list, so a
    // Midtown release that later materialized this cell would fail here.
    const midtown = JSON.parse(new TextDecoder().decode(readFileSync(MIDTOWN_INVENTORY_PATH))) as PayloadInventory;
    const shipped = new Set(buildingIdsFrom(midtown.files));
    expect(shipped.size).toBe(156);
    const midtownRenderable = ledger.cells
      .filter((cell) => cell.cellId.startsWith("manhattan-exterior-cell-w01-") && cell.buildingIds.some((buildingId) => shipped.has(buildingId)))
      .map((cell) => cell.cellId);
    expect(midtownRenderable).toHaveLength(3);
    expect(midtownRenderable).not.toContain(MIDTOWN_NEIGHBOUR_CELL_ID);
    // It owns buildings — it is a real cell that ships none, which is what a
    // tombstone IS — so the claim is not true merely because the cell is empty.
    expect(neighbour!.buildingIds.length).toBeGreaterThan(0);
    expect(neighbour!.buildingIds.every((buildingId) => !shipped.has(buildingId))).toBe(true);
  });

  it("(c) recomputes the local refusal rate and reports that it EXCEEDS the wave rate", () => {
    const refusal = inventory.curation.refusal;
    expect(refusal.ownedBuildingCount).toBe(41);
    expect(refusal.materializedBuildingCount).toBe(40);
    expect(refusal.refusedBuildingCount).toBe(1);
    expect(refusal.materializedBuildingCount + refusal.refusedBuildingCount).toBe(refusal.ownedBuildingCount);
    expect(refusal.localRefusalRate).toBeCloseTo(1 / 41, 12);
    expect(refusal.waveRefusalRate).toBeCloseTo(CENTRAL_UPPER_MANHATTAN_WAVE_REFUSAL_RATE, 12);
    expect(refusal.ok).toBe(true);
    // The finding, recorded rather than smoothed: 2.44% locally against 1.52%
    // for the wave. One refusal in 41 buildings is the smallest non-zero rate
    // this subset can have, and the record says which way the comparison went.
    expect(refusal.localRefusalRate).toBeGreaterThan(refusal.waveRefusalRate);
    expect(refusal.localRateExceedsWaveRate).toBe(true);
    expect(refusal.localRefusalRate).toBeLessThanOrEqual(refusal.maxRefusalRate);
  });

  /**
   * The precondition ADR 0036 added that no earlier wave had: the curated
   * subset's OWN worst volume-identity margin, because the wave's sat at 0.988
   * of tolerance and "the check passed" and "the check passed comfortably" are
   * different statements.
   */
  it("measures the curated subset's own volume-identity margin, and it is better than the wave's", () => {
    const margin = inventory.curation.volumeMargin;
    expect(margin.buildingsChecked).toBe(40);
    expect(margin.buildingsRejected).toBe(0);
    expect(margin.tolerance).toBe(0.000001);
    expect(margin.worstDeviationAsFractionOfTolerance).toBeCloseTo(0.365379, 6);
    expect(margin.waveWorstDeviationAsFractionOfTolerance).toBeCloseTo(0.988297, 6);
    expect(margin.betterThanWave).toBe(true);
    expect(margin.ok).toBe(true);
    // The shipped census agrees with the margin record: same worst deviation,
    // measured on the same 40 assets.
    expect(inventory.census.worstVolumeDeviation).toBe(margin.worstVolumeDeviation);
  });
});

describe("Central-and-upper-Manhattan lineage and rollback semantics", () => {
  it("pins the T019 canary as its graph predecessor, by that release's own committed record", () => {
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
    expect(CENTRAL_UPPER_MANHATTAN_BASE_ONLY_PREDECESSOR.enabled).toBe(false);
    expect(CENTRAL_UPPER_MANHATTAN_BASE_ONLY_PREDECESSOR.releaseId).toBeNull();
    expect(RECORD!.predecessor).toBe(CENTRAL_UPPER_MANHATTAN_BASE_ONLY_PREDECESSOR);
    expect(CENTRAL_UPPER_MANHATTAN_BASE_ONLY_PREDECESSOR.rolledBackReleaseId).toBe(RELEASE_ID);
    expect(exteriorRolledBackReleaseNotice(RELEASE_ID, CENTRAL_UPPER_MANHATTAN_BASE_ONLY_PREDECESSOR))
      .toContain(`${RELEASE_ID} was rolled back in this build`);
    // The canary was never promoted, so a rollback of the successor says nothing
    // about it and its opt-in link keeps resolving.
    expect(exteriorRolledBackReleaseNotice(CANARY_RELEASE_ID, CENTRAL_UPPER_MANHATTAN_BASE_ONLY_PREDECESSOR)).toBeNull();
    const statement = exteriorUnavailableDetail({
      streaming: false,
      override: null,
      activeRealBaseReleaseId: "manhattan-citywide-20260804",
      record: CENTRAL_UPPER_MANHATTAN_BASE_ONLY_PREDECESSOR,
    });
    expect(statement).toContain(RELEASE_ID);
    expect(statement).toContain("base massing from release manhattan-citywide-20260804 is shown");
  });

  it("is a PER-RECORD rollback: the other four waves stay enabled and unwithdrawn", () => {
    const others = EXTERIOR_DEFAULT_ACTIVATIONS.slice(0, 4);
    for (const record of others) {
      expect(record.enabled).toBe(true);
      // A rollback of THIS wave refuses only THIS wave's link.
      expect(exteriorRolledBackReleaseNotice(
        record.enabled ? record.releaseId : "",
        CENTRAL_UPPER_MANHATTAN_BASE_ONLY_PREDECESSOR,
      )).toBeNull();
    }
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
    expect(verifyPromotedExteriorMembership([...CENTRAL_UPPER_MANHATTAN_MEMBERSHIP_BUILDING_IDS], RECORD!)).toEqual({ ok: true });
    // The refused building must fail closed if a scene somehow drew it.
    const outcome = verifyPromotedExteriorMembership(["doitt:996078"], RECORD!);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected the identity gate to fail closed");
    expect(outcome.message).toContain("doitt:996078");
    expect(outcome.message).toContain(RELEASE_ID);
  });
});
