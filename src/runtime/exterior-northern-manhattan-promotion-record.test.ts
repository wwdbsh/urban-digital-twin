/**
 * Drift gate for the Northern-Manhattan P1 curated promotion record — the SIXTH
 * and last curated wave.
 *
 * The P1 curated release is no longer the promoted default: T005 promoted this
 * wave's `-s1` serving release, which carries the P1 record as its
 * `predecessor`, and did the same for the five waves before it. This gate is
 * retained over the curated records, unchanged in what it checks; where it
 * reads the promotion set it now reads each promoted record's predecessor,
 * because a serving record states its membership as a digest and names no
 * building identity.
 *
 * This test is NEVER skipped. Every value it checks is recomputed from the
 * committed `data/northern-manhattan-20260812-p1/payload-inventory.json`, which is
 * in the repository, so the gate does not depend on the untracked payload
 * directory being present on the machine that runs it. A promotion record whose
 * only check is `skipIf(payloadPresent)` is unchecked on CI and on every fresh
 * clone, which is exactly where drift survives.
 *
 * It additionally proves the things ADR 0037 named as preconditions on promotion
 * and could not itself check: that the 36-entry RESERVATION was consumed rather
 * than re-cut and is recorded as consumed, that the promoted subset is an explicit
 * curated list and not the canary's, that the local refusal rate was recomputed
 * rather than inherited, that the curated subset's own volume-identity margin was
 * measured against the wave's narrow 0.9895, and that rollback semantics are
 * stated rather than assumed.
 *
 * AND ONE THING NO EARLIER PROMOTION RECORD COULD CHECK: that the promotion set is
 * now COMPLETE with respect to the committed wave ledger — every wave the ledger
 * declares has an enabled default record, each owning a disjoint partition. That
 * is derived from the ledger's own cells rather than from a count of six.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CENTRAL_UPPER_MANHATTAN_P1_EXTERIOR_ACTIVATION,
  EXTERIOR_DEFAULT_ACTIVATIONS,
  NORTHERN_MANHATTAN_BASE_ONLY_PREDECESSOR,
  NORTHERN_MANHATTAN_MEMBERSHIP_BUILDING_IDS,
  NORTHERN_MANHATTAN_P1_EXTERIOR_ACTIVATION,
  exteriorAcceptedCellsDigest,
  exteriorRolledBackReleaseNotice,
  exteriorUnavailableDetail,
  verifyPromotedExteriorMembership,
  verifyPromotedExteriorPin,
  type ExteriorAcceptedCell,
  type ExteriorDefaultActivationRecord,
} from "./exterior-default-activation";
import { EXTERIOR_RUNTIME_BUDGETS } from "./exterior-cell-runtime";
import { sha256HexSync } from "../domain/deterministic-hash";
import { EXTERIOR_WAVE_PLAN, cellWaveIndex } from "../release/exterior-wave-ledger";
import {
  NORTHERN_MANHATTAN_CANARY_RENDERABLE_CELL_IDS,
  NORTHERN_MANHATTAN_CURATED_CELLS,
  NORTHERN_MANHATTAN_CURATION_BASIS,
  NORTHERN_MANHATTAN_RESERVED_ENTRIES,
  NORTHERN_MANHATTAN_WAVE_REFUSAL_RATE,
  NORTHERN_MANHATTAN_WAVE_WORST_VOLUME_FRACTION,
  northernManhattanCellsAdjacent,
} from "../release/northern-manhattan-curation";

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
    reservation: { fromReleaseId: string; forWaveId: string; entries: number; splitResponse: number; splitFromHeadroomEntries: number; splitTakenByPredecessorEntries: number };
    reservationStatement: string;
    headroomExceedsReservationBy: number;
    reservationConsumed: boolean;
    isLastUnpromotedWave: boolean;
    remainingUnpromotedWaveIds: string[];
    promotedWaveCountAfterThisRelease: number;
    completesLedgerCoverage: boolean;
    entryBudget: number;
  };
  renderableCellIds: string[];
  renderableWalk?: unknown;
  curation: {
    basis: string;
    statement: string;
    cells: { cellId: string; parentOrder: number; rationale: string }[];
    refusal: { ownedBuildingCount: number; materializedBuildingCount: number; refusedBuildingCount: number; localRefusalRate: number; waveRefusalRate: number; maxRefusalRate: number; localRateExceedsWaveRate: boolean; refusalGranularity: number; ok: boolean };
    volumeMargin: { buildingsChecked: number; buildingsAccepted: number; buildingsRejected: number; worstVolumeDeviation: number; tolerance: number; worstDeviationAsFractionOfTolerance: number; waveWorstDeviationAsFractionOfTolerance: number; betterThanWave: boolean; ok: boolean };
  };
  textureAdmission: { policy: string; profile: string; rasterizerVersion: string; parametersHashSha256: string; samplerFilter: { magFilter: number; minFilter: number } };
  stats: Record<string, number>;
  census: Record<string, number>;
  refusedBuildingIds: string[];
  files: InventoryFile[];
}

const RELEASE_ID = "manhattan-northern-manhattan-cells-20260812-p1";
const CANARY_RELEASE_ID = "manhattan-northern-manhattan-cells-20260812";
/** The T005 serving releases the sixth and fifth promotion slots now hold. */
const SERVING_RELEASE_ID = "manhattan-northern-manhattan-cells-20260812-s1";
const CENTRAL_UPPER_MANHATTAN_SERVING_RELEASE_ID = "manhattan-central-upper-manhattan-cells-20260812-s1";
const INVENTORY_PATH = "data/northern-manhattan-20260812-p1/payload-inventory.json";
const CANARY_INVENTORY_PATH = "data/northern-manhattan-20260812/payload-inventory.json";
const LEDGER_PATH = "data/normalized/manhattan-exterior-wave-ledger-20260804/ledger.json";

const inventoryText = new TextDecoder().decode(readFileSync(INVENTORY_PATH));
const inventory = JSON.parse(inventoryText) as PayloadInventory;
const RECORD = NORTHERN_MANHATTAN_P1_EXTERIOR_ACTIVATION.enabled ? NORTHERN_MANHATTAN_P1_EXTERIOR_ACTIVATION : null;

const CELL_RELEASE_PREFIX = `public/cell-release/cell-release-${RELEASE_ID}-`;
const ASSET_PATTERN = /^public\/assets\/(doitt-\d+)__lod_\d+\.glb$/;

interface LedgerCell { cellId: string; bounds: { west: number; south: number; east: number; north: number }; buildingIds: string[] }
const ledger = JSON.parse(new TextDecoder().decode(readFileSync(LEDGER_PATH))) as { cells: LedgerCell[] };

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

/**
 * The curated record behind each promotion slot.
 *
 * T005 promoted a `-s1` serving release into every slot, each carrying the
 * curated record it superseded as its `predecessor`. A serving record states
 * its accepted membership as a digest and names no building identity, so the
 * ledger-coverage claims below — which are about building identities — read the
 * predecessors. The set is still walked rather than counted: a slot that lost
 * its curated predecessor, or a slot that went disabled, drops out here and the
 * coverage assertions fail.
 */
function curatedPredecessors(): readonly ExteriorDefaultActivationRecord[] {
  return EXTERIOR_DEFAULT_ACTIVATIONS.map((record) => (record.enabled ? record.predecessor : record));
}

describe("Northern-Manhattan promotion record versus the committed payload inventory", () => {
  it("is enabled, is the sixth slot's predecessor, and names the successor rather than the canary", () => {
    expect(RECORD).not.toBeNull();
    expect(RECORD!.releaseId).toBe(inventory.releaseId);
    expect(RECORD!.releaseId).toBe(RELEASE_ID);
    expect(RECORD!.releaseId).not.toBe(CANARY_RELEASE_ID);
    expect(RECORD!.approvalRef).toBe("Issue #23 gate approval 2026-08-12 (T022 Northern-Manhattan curated promotion)");
    expect(RECORD!.rolledBackReleaseId ?? null).toBeNull();
    expect(EXTERIOR_DEFAULT_ACTIVATIONS).toHaveLength(6);
    // T005 promoted this wave's serving release into the same sixth slot with
    // this record as its predecessor, so the slot is still this wave's, one
    // link further back.
    const promoted = EXTERIOR_DEFAULT_ACTIVATIONS[5]!;
    expect(promoted.enabled).toBe(true);
    if (!promoted.enabled) throw new Error("expected the sixth promoted default to be enabled");
    expect(promoted.releaseId).toBe(SERVING_RELEASE_ID);
    expect(promoted.predecessor).toBe(NORTHERN_MANHATTAN_P1_EXTERIOR_ACTIVATION);
    // The five earlier slots are untouched by this promotion, and the wave
    // immediately before it is asserted by identity rather than by shape.
    const previous = EXTERIOR_DEFAULT_ACTIVATIONS[4]!;
    expect(previous.enabled).toBe(true);
    if (!previous.enabled) throw new Error("expected the fifth promoted default to be enabled");
    expect(previous.releaseId).toBe(CENTRAL_UPPER_MANHATTAN_SERVING_RELEASE_ID);
    expect(previous.predecessor).toBe(CENTRAL_UPPER_MANHATTAN_P1_EXTERIOR_ACTIVATION);
  });

  it("pins the rollout snapshot and assembly package the inventory recorded", () => {
    const snapshotFile = inventory.files.find((file) => file.path.startsWith("public/rollout-snapshot/"));
    expect(snapshotFile).toBeDefined();
    expect(snapshotFile!.path).toBe(`public/rollout-snapshot/snapshot-${RELEASE_ID}-v1.json`);
    expect(RECORD!.snapshotChecksumSha256).toBe(snapshotFile!.checksumSha256);
    expect(RECORD!.snapshotId).toBe(`snapshot:${RELEASE_ID}:v1`);
    expect(RECORD!.assemblyPackageIds).toEqual([`assembly:${RELEASE_ID}:v1`]);
  });

  it("recomputes the accepted cell digest from the inventory's 182 cell releases", async () => {
    const cells = cellsFromInventory();
    expect(cells).toHaveLength(inventory.stats.cellCount!);
    expect(cells).toHaveLength(182);
    expect(RECORD!.membership.cellCount).toBe(cells.length);
    expect(RECORD!.membership.cells).toEqual([]);
    expect(RECORD!.membership.cellsDigestSha256).toBe(await exteriorAcceptedCellsDigest(cells));
    expect(cells.every((cell) => cell.cellId.startsWith("manhattan-exterior-cell-w05-"))).toBe(true);
    // A successor must not reuse the canary's cell-release identities, or a
    // resolve against the wrong release would satisfy the pin gate.
    expect(cells.every((cell) => cell.cellReleaseId.includes(RELEASE_ID))).toBe(true);
    expect(cells.every((cell) => !cell.cellReleaseId.includes(`${CANARY_RELEASE_ID}:`))).toBe(true);
  });

  it("recomputes the 24 accepted building identities from the shipped assets", () => {
    const ids = buildingIdsFrom(inventory.files);
    expect(ids).toHaveLength(inventory.stats.availableBuildingCount!);
    expect(ids).toHaveLength(24);
    expect([...RECORD!.membership.buildingIds].sort()).toEqual(ids);
    expect(NORTHERN_MANHATTAN_MEMBERSHIP_BUILDING_IDS).toHaveLength(24);
    expect(inventory.stats.shippedAssetCount).toBe(24);
    // The whole accepted membership is the curated cell's own ownership, exactly
    // — no building from anywhere else in the wave, and none of the cell's own
    // left out, because the grammar refused none of them.
    const curated = ledger.cells.find((cell) => cell.cellId === NORTHERN_MANHATTAN_CURATED_CELLS[0]!.cellId)!;
    expect([...curated.buildingIds].sort()).toEqual(ids);
  });

  it("keeps the bounded-availability shape and the truthful tombstones", () => {
    expect(inventory.stats.cellCount).toBe(182);
    expect(inventory.stats.renderableCellCount).toBe(1);
    expect(inventory.stats.notShippedCellCount).toBe(181);
    expect(inventory.stats.renderableCellCount! + inventory.stats.notShippedCellCount!).toBe(inventory.stats.cellCount);
    expect(inventory.stats.ownedBuildingCount).toBe(10230);
    expect(inventory.stats.availableBuildingCount! + inventory.stats.unavailableBuildingCount!).toBe(10230);
    // NO REFUSED BUILDING AT ALL on this curated ground, which is what makes the
    // accepted membership equal to the cell's whole ownership above. It is the
    // first promoted wave since Block 835 that ships no refusal of its own, and
    // it is asserted rather than described.
    expect(inventory.refusedBuildingIds).toEqual([]);
    expect(inventory.stats.refusedBuildingCount).toBe(0);
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

describe("ADR 0037 preconditions on promotion, checked rather than asserted", () => {
  /**
   * (a) The 36-entry reservation must be CONSUMED and recorded as consumed — not
   * re-cut, not silently enlarged to the 38 entries that happen to be free, and
   * not inherited on trust. The release's own committed record carries both halves
   * of the split it inherits, the arithmetic that produced them, what the surplus
   * is, and the ledger-wide end state.
   */
  it("(a) consumes the reservation by number, and does NOT move the cache cap", () => {
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
    expect(inventory.occupancy.promotedAssetEntries).toBe(474);
    expect(inventory.occupancy.promotedWaveCount).toBe(5);
    expect(inventory.occupancy.promotedWaves.reduce((sum, wave) => sum + wave.assetEntries, 0)).toBe(474);
    expect(inventory.occupancy.alongsidePromotedHeadroom).toBe(38);
    // THE SPLIT MUST ADD UP, read out of T020's bytes rather than retyped here.
    expect(inventory.occupancy.reservation.fromReleaseId).toBe("manhattan-central-upper-manhattan-cells-20260812-p1");
    expect(inventory.occupancy.reservation.forWaveId).toBe("northern-manhattan");
    expect(inventory.occupancy.reservation.entries).toBe(NORTHERN_MANHATTAN_RESERVED_ENTRIES);
    expect(inventory.occupancy.reservation.splitResponse).toBe(2);
    expect(inventory.occupancy.reservation.splitTakenByPredecessorEntries + inventory.occupancy.reservation.entries)
      .toBe(inventory.occupancy.reservation.splitFromHeadroomEntries);
    expect(inventory.occupancy.reservation.splitFromHeadroomEntries).toBe(78);
    expect(inventory.occupancy.entryBudget).toBe(36);
    expect(inventory.occupancy.reservationConsumed).toBe(true);
    // THE SURPLUS IS NAMED AND NOT TAKEN.
    expect(inventory.occupancy.headroomExceedsReservationBy).toBe(2);
    expect(inventory.stats.shippedAssetCount).toBeLessThanOrEqual(inventory.occupancy.entryBudget);
    expect(inventory.occupancy.entryBudget - inventory.stats.shippedAssetCount!).toBe(12);
    // No cap change accompanies this promotion, and the record says so.
    expect(inventory.occupancy.reservationStatement).toMatch(/THIS PROMOTION OPENS NO SPLIT; IT CONSUMES ONE/u);
    expect(inventory.occupancy.reservationStatement).toMatch(/The cache cap is UNCHANGED at 512 entries/u);
    expect(inventory.occupancy.reservationStatement).toMatch(/THE SURPLUS WOULD HAVE BOUGHT NOTHING/u);
    expect(inventory.note).toContain("UNCHANGED 512-entry cap");
  });

  /**
   * THE LEDGER-WIDE OCCUPANCY END-STATE, in cache arithmetic. This is the last
   * promotion the committed ledger can produce, so "what is left" has no wave to
   * be left for and the number is stated rather than implied.
   */
  it("(a) closes the ledger at 498 of 512 entries, with 14 free and nothing reserved", () => {
    const resident = inventory.occupancy.promotedAssetEntries + inventory.stats.shippedAssetCount!;
    expect(resident).toBe(498);
    expect(resident).toBeLessThanOrEqual(inventory.occupancy.maxCacheEntries);
    expect(inventory.occupancy.maxCacheEntries - resident).toBe(14);
    expect(inventory.occupancy.promotedWaveCountAfterThisRelease).toBe(6);
    expect(inventory.occupancy.completesLedgerCoverage).toBe(true);
    expect(inventory.occupancy.isLastUnpromotedWave).toBe(true);
    expect(inventory.occupancy.remainingUnpromotedWaveIds).toEqual(["northern-manhattan"]);
    expect(inventory.occupancy.reservationStatement).toContain("498 of 512");
  });

  it("(b) does not inherit the canary's renderable subset, and records the curation it used", () => {
    const canary = JSON.parse(new TextDecoder().decode(readFileSync(CANARY_INVENTORY_PATH))) as PayloadInventory & { renderableCellIds: string[] };
    expect(canary.renderableCellIds).toEqual(NORTHERN_MANHATTAN_CANARY_RENDERABLE_CELL_IDS);
    // Disjoint: not one canary cell is promoted, and not one promoted cell is the
    // canary's.
    for (const cellId of canary.renderableCellIds) expect(inventory.renderableCellIds).not.toContain(cellId);
    expect(inventory.renderableCellIds).toEqual(NORTHERN_MANHATTAN_CURATED_CELLS.map((record) => record.cellId));
    expect(inventory.curation.basis).toBe(NORTHERN_MANHATTAN_CURATION_BASIS);
    expect(inventory.curation.cells.map((cell) => cell.cellId)).toEqual(inventory.renderableCellIds);
    // Every admitted cell carries a written reason, not a placeholder.
    for (const cell of inventory.curation.cells) expect(cell.rationale.length).toBeGreaterThan(120);
    expect(inventory.curation.statement).toContain("EXPLICIT CURATED LIST");
    // A CURATED record carries NO renderable walk. The canary's record does, and
    // the two are different questions: a walk says where a budget ran out, a
    // curation says what was chosen and why.
    expect(inventory.renderableWalk).toBeUndefined();
    expect((canary as { renderableWalk?: unknown }).renderableWalk).toBeDefined();
  });

  /**
   * THE THRESHOLD ANSWER IS WEAKER HERE THAN IT WAS FOR WAVE w04, AND THE RECORD
   * SAYS SO IN ITS OWN BYTES.
   *
   * ADR 0036 precondition (b) made each wave state whether 90 m is right for it.
   * Wave `w04` could answer that the ranking did not depend on the threshold at
   * all. This wave cannot, and the failure mode that matters is a record that
   * borrows the stronger sentence. The shipped statement is required to carry the
   * weaker one, and the FULL enumeration behind it is re-run over committed bytes
   * in `northern-manhattan-curation-optimum.test.ts` rather than here.
   */
  it("(b) states the threshold sensitivity rather than borrowing wave w04's insensitivity claim", () => {
    expect(inventory.curation.statement).toMatch(/THE RANKING DOES DEPEND ON THE THRESHOLD HERE/u);
    expect(inventory.curation.statement).toMatch(/THE THRESHOLD WAS NOT MOVED AFTER THE ANSWER WAS KNOWN/u);
    expect(inventory.curation.statement).toMatch(/A THRESHOLD-FREE KEY AGREES/u);
    // The arbitrary fifth key is reached at two of the seven thresholds on this
    // wave, and the record says so rather than omitting it.
    expect(inventory.curation.statement).toMatch(/THE ARBITRARY FIFTH KEY IS REACHED AT TWO OF THE SEVEN THRESHOLDS/u);
    // And it must NOT claim the property wave w04 had.
    expect(inventory.curation.statement).not.toMatch(/the same cell wins at 60, 75, 90, 100 and 120/u);
  });

  /**
   * THE ADJACENCY CLAIM, COMPUTED RATHER THAN SPELLED — the T020 review closure
   * applied to this wave's own factual claims about geometry.
   *
   * The curation statement makes one claim about cells it did NOT promote: that
   * cell 727's four edge-neighbours own 40, 41, 53 and 89 buildings, and that this
   * is why no second cell fits inside the 36-entry reservation. A regex proves the
   * release says it; it cannot prove it is true. Both halves are derived here from
   * the committed wave ledger alone, so this gate needs no payload directory and
   * is never skipped.
   */
  it("(b) proves the neighbour sizes the curation's one-cell shape rests on", () => {
    const curated = ledger.cells.find((cell) => cell.cellId === NORTHERN_MANHATTAN_CURATED_CELLS[0]!.cellId);
    expect(curated).toBeDefined();
    const neighbours = ledger.cells
      .filter((cell) => cell.cellId !== curated!.cellId && northernManhattanCellsAdjacent(curated!.bounds, cell.bounds))
      .map((cell) => cell.buildingIds.length)
      .sort((left, right) => left - right);
    // Four edge-neighbours, and every one of them is larger than what the
    // reservation leaves after the curated cell's own 24 buildings.
    expect(neighbours).toEqual([40, 41, 53, 89]);
    const remaining = NORTHERN_MANHATTAN_RESERVED_ENTRIES - curated!.buildingIds.length;
    expect(remaining).toBe(12);
    expect(neighbours.every((count) => count > remaining)).toBe(true);
    // Which is exactly what the shipped statement asserts.
    expect(inventory.curation.statement).toContain("own 40, 41, 53 and 89 buildings");
    // Probed negative: the claim is about EDGE neighbours, so a cell that only
    // touches at a corner or not at all must not be one of them.
    expect(neighbours).toHaveLength(4);
  });

  it("(c) recomputes the local refusal rate and reports that it is BELOW the wave rate", () => {
    const refusal = inventory.curation.refusal;
    expect(refusal.ownedBuildingCount).toBe(24);
    expect(refusal.materializedBuildingCount).toBe(24);
    expect(refusal.refusedBuildingCount).toBe(0);
    expect(refusal.materializedBuildingCount + refusal.refusedBuildingCount).toBe(refusal.ownedBuildingCount);
    expect(refusal.localRefusalRate).toBe(0);
    expect(refusal.waveRefusalRate).toBeCloseTo(NORTHERN_MANHATTAN_WAVE_REFUSAL_RATE, 12);
    expect(refusal.waveRefusalRate).toBeCloseTo(381 / 10230, 12);
    expect(refusal.ok).toBe(true);
    // The finding, recorded rather than smoothed: 0% locally against 3.72% for
    // the wave, which is the opposite direction from wave w04's result.
    expect(refusal.localRateExceedsWaveRate).toBe(false);
    expect(refusal.localRefusalRate).toBeLessThan(refusal.waveRefusalRate);
    // AND HOW MUCH ROOM THE PASS ACTUALLY HAD. At 24 buildings the granularity is
    // 4.17 percentage points, so ONE refusal would still have passed the ceiling
    // and TWO would not. The record carries the granularity so a reader can see
    // that rather than infer a comfortable margin from a zero.
    expect(refusal.refusalGranularity).toBeCloseTo(1 / 24, 12);
    expect(refusal.refusalGranularity).toBeLessThanOrEqual(refusal.maxRefusalRate);
    expect(2 * refusal.refusalGranularity).toBeGreaterThan(refusal.maxRefusalRate);
  });

  /**
   * The precondition ADR 0037 carried forward: the curated subset's OWN worst
   * volume-identity margin, because the WAVE's sat at 0.9895 of tolerance and "the
   * check passed" and "the check passed comfortably" are different statements.
   *
   * The denominator is the T021 F1 form — accepted + rejected — and both halves
   * ship, so a record that used the materialized count as the denominator is
   * distinguishable from this one.
   */
  it("measures the curated subset's own volume-identity margin, and it is far better than the wave's", () => {
    const margin = inventory.curation.volumeMargin;
    expect(margin.buildingsChecked).toBe(24);
    expect(margin.buildingsAccepted).toBe(24);
    expect(margin.buildingsRejected).toBe(0);
    expect(margin.buildingsAccepted + margin.buildingsRejected).toBe(margin.buildingsChecked);
    expect(margin.tolerance).toBe(0.000001);
    expect(margin.worstDeviationAsFractionOfTolerance).toBeCloseTo(0.181820, 6);
    expect(margin.waveWorstDeviationAsFractionOfTolerance).toBeCloseTo(NORTHERN_MANHATTAN_WAVE_WORST_VOLUME_FRACTION, 12);
    expect(margin.waveWorstDeviationAsFractionOfTolerance).toBeCloseTo(0.989500, 6);
    expect(margin.betterThanWave).toBe(true);
    expect(margin.ok).toBe(true);
    // The shipped census agrees with the margin record: same worst deviation,
    // measured on the same 24 assets.
    expect(inventory.census.worstVolumeDeviation).toBe(margin.worstVolumeDeviation);
  });
});

describe("Northern-Manhattan lineage and rollback semantics", () => {
  it("pins the T021 canary as its graph predecessor, by that release's own committed record", () => {
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
    expect(NORTHERN_MANHATTAN_BASE_ONLY_PREDECESSOR.enabled).toBe(false);
    expect(NORTHERN_MANHATTAN_BASE_ONLY_PREDECESSOR.releaseId).toBeNull();
    expect(RECORD!.predecessor).toBe(NORTHERN_MANHATTAN_BASE_ONLY_PREDECESSOR);
    expect(NORTHERN_MANHATTAN_BASE_ONLY_PREDECESSOR.rolledBackReleaseId).toBe(RELEASE_ID);
    expect(exteriorRolledBackReleaseNotice(RELEASE_ID, NORTHERN_MANHATTAN_BASE_ONLY_PREDECESSOR))
      .toContain(`${RELEASE_ID} was rolled back in this build`);
    // The canary was never promoted, so a rollback of the successor says nothing
    // about it and its opt-in link keeps resolving.
    expect(exteriorRolledBackReleaseNotice(CANARY_RELEASE_ID, NORTHERN_MANHATTAN_BASE_ONLY_PREDECESSOR)).toBeNull();
    const statement = exteriorUnavailableDetail({
      streaming: false,
      override: null,
      activeRealBaseReleaseId: "manhattan-citywide-20260804",
      record: NORTHERN_MANHATTAN_BASE_ONLY_PREDECESSOR,
    });
    expect(statement).toContain(RELEASE_ID);
    expect(statement).toContain("base massing from release manhattan-citywide-20260804 is shown");
  });

  it("is a PER-RECORD rollback: the other five waves stay enabled and unwithdrawn", () => {
    const others = EXTERIOR_DEFAULT_ACTIVATIONS.slice(0, 5);
    expect(others).toHaveLength(5);
    for (const record of others) {
      expect(record.enabled).toBe(true);
      // A rollback of THIS wave refuses only THIS wave's link.
      expect(exteriorRolledBackReleaseNotice(
        record.enabled ? record.releaseId : "",
        NORTHERN_MANHATTAN_BASE_ONLY_PREDECESSOR,
      )).toBeNull();
    }
  });
});

/**
 * The claim only the LAST promotion can make, derived rather than counted.
 *
 * Every earlier promotion could say "one more wave is promoted". This one says
 * "every wave the ledger declares is promoted", and that is checked against the
 * ledger's own cells: each curated record's wave index is taken from the cell ids
 * its committed inventory ships, and the set of those indexes must be exactly the
 * declared plan. Six is never typed as a target — it falls out of the plan.
 *
 * The records walked here are the curated predecessors of the promoted serving
 * releases, because building identities are what these claims are made of and a
 * serving record carries only their digest.
 */
describe("the promotion set is COMPLETE with respect to the committed wave ledger", () => {
  it("covers every declared wave exactly once, with disjoint partitions", () => {
    const declared = EXTERIOR_WAVE_PLAN.map((wave) => wave.waveIndex).sort((left, right) => left - right);
    const enabled = curatedPredecessors().filter((record) => record.enabled);
    expect(enabled).toHaveLength(declared.length);

    // Block 835 is the one promoted release whose membership is not a wave-ledger
    // partition at all: it is a single named block that predates the ledger, and
    // its wave index is w00 by the plan rather than by a cell id. Every other
    // record's index is derived from the cells its own membership names.
    const indexes = new Set<number>();
    for (const record of enabled) {
      if (!record.enabled) continue;
      const owned = ledger.cells.filter((cell) => record.membership.buildingIds.some((buildingId) => cell.buildingIds.includes(buildingId)));
      if (owned.length === 0) { indexes.add(0); continue; }
      const waveIndexes = new Set(owned.map((cell) => cellWaveIndex(cell.cellId)));
      // A promoted release must own ground in exactly ONE wave, or the partition
      // claim is false.
      expect({ release: record.releaseId, waves: [...waveIndexes] }).toEqual({ release: record.releaseId, waves: [...waveIndexes].slice(0, 1) });
      expect(waveIndexes.size).toBe(1);
      indexes.add([...waveIndexes][0]!);
    }
    expect([...indexes].sort((left, right) => left - right)).toEqual(declared);

    // And the accepted memberships are pairwise disjoint, so "exactly once" is a
    // statement about buildings and not only about wave labels.
    const seen = new Set<string>();
    for (const record of enabled) {
      if (!record.enabled) continue;
      for (const buildingId of record.membership.buildingIds) {
        expect({ buildingId, duplicated: seen.has(buildingId) }).toEqual({ buildingId, duplicated: false });
        seen.add(buildingId);
      }
    }
    // 14 + 156 + 71 + 179 + 40 + 24, and the last term is this promotion.
    expect(seen.size).toBe(484);
  });

  /**
   * WHAT COMPLETENESS IS NOT, asserted so the record cannot be read as a fidelity
   * claim. Six of six waves have a default; that is 498 cache entries against a
   * pinned base of 45,194 canonical buildings, so roughly one building in ninety
   * is textured by default. The arithmetic is here rather than in prose because
   * prose about scope is exactly what drifts.
   */
  it("is completeness of COVERAGE, not of the city, and the arithmetic says so", () => {
    const enabled = curatedPredecessors().filter((record) => record.enabled);
    const promotedBuildings = enabled.reduce((sum, record) => sum + (record.enabled ? record.membership.buildingIds.length : 0), 0);
    const baseBuildings = new Set(ledger.cells.flatMap((cell) => cell.buildingIds)).size;
    expect(baseBuildings).toBe(45194);
    expect(promotedBuildings).toBe(484);
    expect(promotedBuildings / baseBuildings).toBeLessThan(0.012);
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
    expect(verifyPromotedExteriorMembership([...NORTHERN_MANHATTAN_MEMBERSHIP_BUILDING_IDS], RECORD!)).toEqual({ ok: true });
    // A building this wave OWNS but does not promote must fail closed if a scene
    // somehow drew it. `doitt:1123456` would be a made-up identity, so the probe
    // uses a real owned building from a tombstoned cell instead — the honest
    // negative for a wave that refused none of its curated ground.
    const outsider = ledger.cells
      .filter((cell) => cell.cellId.startsWith("manhattan-exterior-cell-w05-") && cell.cellId !== NORTHERN_MANHATTAN_CURATED_CELLS[0]!.cellId)
      .flatMap((cell) => cell.buildingIds)
      .find((buildingId) => !NORTHERN_MANHATTAN_MEMBERSHIP_BUILDING_IDS.includes(buildingId))!;
    expect(outsider).toBeDefined();
    const outcome = verifyPromotedExteriorMembership([outsider], RECORD!);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected the identity gate to fail closed");
    expect(outcome.message).toContain(outsider);
    expect(outcome.message).toContain(RELEASE_ID);
  });
});
