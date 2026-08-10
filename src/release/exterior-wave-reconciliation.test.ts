import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTileKey, tileBounds } from "../runtime/spatial";
import { stableSerialize } from "./catalog-release";
import type { ExteriorOwnershipLedger } from "./exterior-release";
import {
  BLOCK_835_TILE_KEY,
  EXTERIOR_WAVE_BASE_BUILDING_COUNT,
  EXTERIOR_WAVE_BASE_RELEASE_ID,
  block835BuildingIds,
  buildExteriorWaveLedger,
  exteriorArtifactChecksum,
  membershipChecksum,
  type ExteriorBaseShardGroup,
} from "./exterior-wave-ledger";
import {
  EXTERIOR_LEDGER_RECONCILIATION_CODES,
  diffExteriorWaveLedgers,
  exteriorLedgerOwnerIndex,
  reconcileExteriorWaveLedger,
  type ExteriorLedgerReconciliationReport,
} from "./exterior-wave-reconciliation";

const BASE_CHECKSUM = "d".repeat(64);
const LEDGER_CHECKSUM = "e".repeat(64);

function syntheticGroup(tileKey: string, count: number, idPrefix: string, extraIds: readonly string[] = []): ExteriorBaseShardGroup {
  const bounds = tileBounds(parseTileKey(tileKey));
  const ids = [...extraIds, ...Array.from({ length: count }, (_, index) => `${idPrefix}${index}`)];
  const span = Math.ceil(Math.sqrt(ids.length)) || 1;
  return {
    tileKey,
    buildings: ids.map((buildingId, index) => ({
      buildingId,
      longitude: bounds.west + ((bounds.east - bounds.west) * (index % span + 0.5)) / span,
      latitude: bounds.south + ((bounds.north - bounds.south) * (Math.floor(index / span) + 0.5)) / span,
    })),
  };
}

function fixtureLedger(midtownCount = 300, extraGroups: readonly ExteriorBaseShardGroup[] = []): ExteriorOwnershipLedger {
  return buildExteriorWaveLedger({
    baseReleaseId: EXTERIOR_WAVE_BASE_RELEASE_ID,
    baseManifestChecksumSha256: BASE_CHECKSUM,
    shardGroups: [
      syntheticGroup(BLOCK_835_TILE_KEY, midtownCount, "doitt:mid-", block835BuildingIds()),
      syntheticGroup("wgs84-geodetic/14/4823/4486", 40, "doitt:low-"),
      syntheticGroup("wgs84-geodetic/14/4827/4472", 8, "doitt:north-"),
      ...extraGroups,
    ],
  }).ledger;
}

function idsOf(ledger: ExteriorOwnershipLedger): string[] {
  return ledger.cells.flatMap((cell) => cell.buildingIds).sort();
}

function clone(ledger: ExteriorOwnershipLedger): ExteriorOwnershipLedger {
  return JSON.parse(JSON.stringify(ledger)) as ExteriorOwnershipLedger;
}

function reconcile(ledger: ExteriorOwnershipLedger, baseBuildingIds: readonly string[]): ExteriorLedgerReconciliationReport {
  return reconcileExteriorWaveLedger(ledger, {
    baseBuildingIds,
    baseReleaseId: EXTERIOR_WAVE_BASE_RELEASE_ID,
    ledgerChecksumSha256: LEDGER_CHECKSUM,
  });
}

describe("reconcileExteriorWaveLedger", () => {
  it("closes the reason-code vocabulary", () => {
    expect([...EXTERIOR_LEDGER_RECONCILIATION_CODES]).toEqual(["missing", "duplicate", "cross-cell-duplicate", "stale", "changed"]);
  });

  it("reports zero findings for a ledger that matches its base snapshot", () => {
    const ledger = fixtureLedger();
    const report = reconcile(ledger, idsOf(ledger));
    expect(report.ok).toBe(true);
    expect(report.findings).toEqual([]);
    expect(report.counts).toEqual({ missing: 0, duplicate: 0, "cross-cell-duplicate": 0, stale: 0, changed: 0 });
    expect(report.ownedBuildingCount).toBe(report.observedBuildingCount);
    expect(report.ledgerId).toBe(ledger.ledgerId);
    expect(report.baseIdentitySetChecksumSha256).toBe(ledger.baseIdentitySet.checksumSha256);
  });

  it("detects a base building that no cell owns", () => {
    const ledger = fixtureLedger();
    const report = reconcile(ledger, [...idsOf(ledger), "doitt:new-building"]);
    expect(report.ok).toBe(false);
    expect(report.counts.missing).toBe(1);
    expect(report.findings[0]).toEqual({
      code: "missing",
      buildingId: "doitt:new-building",
      cellId: null,
      detail: "Base snapshot building is owned by no ledger cell.",
    });
  });

  it("detects a duplicate inside a single cell", () => {
    const ledger = clone(fixtureLedger());
    const target = ledger.cells[1]!;
    const repeated = target.buildingIds[0]!;
    target.buildingIds = [...target.buildingIds, repeated];
    target.membershipChecksumSha256 = membershipChecksum(target.buildingIds);
    const report = reconcile(ledger, idsOf(fixtureLedger()));
    expect(report.counts.duplicate).toBe(1);
    expect(report.findings.find((finding) => finding.code === "duplicate")).toMatchObject({ buildingId: repeated, cellId: target.cellId });
  });

  it("surfaces cross-cell duplication with its own code", () => {
    const ledger = clone(fixtureLedger());
    const [first, second] = [ledger.cells[1]!, ledger.cells[2]!];
    const shared = first.buildingIds[0]!;
    second.buildingIds = [...second.buildingIds, shared].sort();
    second.membershipChecksumSha256 = membershipChecksum(second.buildingIds);
    const report = reconcile(ledger, idsOf(fixtureLedger()));
    expect(report.counts["cross-cell-duplicate"]).toBe(1);
    expect(report.findings.find((finding) => finding.code === "cross-cell-duplicate")).toMatchObject({ buildingId: shared, cellId: second.cellId });
  });

  it("detects a stale member that left the base snapshot", () => {
    const ledger = fixtureLedger();
    const dropped = ledger.cells[1]!.buildingIds[0]!;
    const report = reconcile(ledger, idsOf(ledger).filter((buildingId) => buildingId !== dropped));
    expect(report.counts.stale).toBe(1);
    expect(report.findings.find((finding) => finding.code === "stale")).toMatchObject({ buildingId: dropped, cellId: ledger.cells[1]!.cellId });
  });

  it("detects a cell whose declared membership checksum drifted", () => {
    const ledger = clone(fixtureLedger());
    ledger.cells[3]!.membershipChecksumSha256 = "f".repeat(64);
    const report = reconcile(ledger, idsOf(ledger));
    expect(report.counts.changed).toBe(1);
    expect(report.findings.find((finding) => finding.code === "changed")).toMatchObject({ buildingId: null, cellId: ledger.cells[3]!.cellId });
  });

  it("orders findings deterministically regardless of cell order", () => {
    const ledger = clone(fixtureLedger());
    ledger.cells[2]!.membershipChecksumSha256 = "f".repeat(64);
    ledger.cells[4]!.membershipChecksumSha256 = "f".repeat(64);
    const base = idsOf(ledger).filter((_, index) => index !== 5);
    const forward = reconcile(ledger, base);
    const reversed = clone(ledger);
    reversed.cells = [...reversed.cells].reverse();
    const backward = reconcile(reversed, [...base].reverse());
    expect(stableSerialize(backward.findings)).toBe(stableSerialize(forward.findings));
  });

  it("attributes duplicate and cross-cell-duplicate to the same cells regardless of input order", () => {
    const ledger = clone(fixtureLedger());
    // A within-cell duplicate in one cell and a cross-cell duplicate between two
    // others, so both order-sensitive codes are exercised at once.
    const repeated = ledger.cells[6]!.buildingIds[0]!;
    ledger.cells[6]!.buildingIds = [...ledger.cells[6]!.buildingIds, repeated];
    const shared = ledger.cells[1]!.buildingIds[0]!;
    ledger.cells[3]!.buildingIds = [...ledger.cells[3]!.buildingIds, shared].sort();
    const base = idsOf(fixtureLedger());

    const forward = reconcile(ledger, base);
    const reversed = clone(ledger);
    reversed.cells = [...reversed.cells].reverse();
    const backward = reconcile(reversed, [...base].reverse());

    expect(forward.counts.duplicate).toBe(1);
    expect(forward.counts["cross-cell-duplicate"]).toBe(1);
    // The lower-order cell keeps ownership; the higher-order cell is the offender.
    expect(forward.findings.find((finding) => finding.code === "cross-cell-duplicate")).toMatchObject({
      buildingId: shared,
      cellId: ledger.cells[3]!.cellId,
      detail: `Building is already owned by ${ledger.cells[1]!.cellId}.`,
    });
    expect(stableSerialize(backward.findings)).toBe(stableSerialize(forward.findings));
    expect(stableSerialize(backward.counts)).toBe(stableSerialize(forward.counts));
  });
});

describe("change-impact index v1", () => {
  it("maps every building to its owning cell", () => {
    const ledger = fixtureLedger();
    const index = exteriorLedgerOwnerIndex(ledger);
    expect(index.size).toBe(idsOf(ledger).length);
    for (const cell of ledger.cells) for (const buildingId of cell.buildingIds) expect(index.get(buildingId)).toBe(cell.cellId);
    expect([...index.keys()]).toEqual([...index.keys()].sort());
  });

  it("reports no impact when the ledger is unchanged", () => {
    const impact = diffExteriorWaveLedgers(fixtureLedger(), fixtureLedger());
    expect(impact.unchanged).toBe(true);
    expect(impact.impactedCellIds).toEqual([]);
    expect(impact.addedBuildingIds).toEqual([]);
    expect(impact.removedBuildingIds).toEqual([]);
    expect(impact.movedBuildings).toEqual([]);
  });

  it("names the cells impacted by an added building", () => {
    const from = fixtureLedger();
    const to = fixtureLedger(300, [syntheticGroup("wgs84-geodetic/14/4825/4479", 3, "doitt:added-")]);
    const impact = diffExteriorWaveLedgers(from, to);
    expect(impact.addedBuildingIds).toEqual(["doitt:added-0", "doitt:added-1", "doitt:added-2"]);
    expect(impact.removedBuildingIds).toEqual([]);
    expect(impact.impactedCellIds.length).toBeGreaterThan(0);
    for (const buildingId of impact.addedBuildingIds) {
      expect(impact.impactedCellIds).toContain(exteriorLedgerOwnerIndex(to).get(buildingId));
    }
    expect(impact.addedCellIds.length).toBeGreaterThan(0);
    expect(impact.unchanged).toBe(false);
  });

  it("names the cells impacted by a removed building", () => {
    const from = fixtureLedger(300, [syntheticGroup("wgs84-geodetic/14/4825/4479", 3, "doitt:added-")]);
    const to = fixtureLedger();
    const impact = diffExteriorWaveLedgers(from, to);
    expect(impact.removedBuildingIds).toEqual(["doitt:added-0", "doitt:added-1", "doitt:added-2"]);
    expect(impact.addedBuildingIds).toEqual([]);
    expect(impact.removedCellIds.length).toBeGreaterThan(0);
  });

  it("names both cells when a building moves between cells", () => {
    const from = fixtureLedger();
    const to = clone(from);
    const moved = to.cells[1]!.buildingIds[0]!;
    to.cells[1]!.buildingIds = to.cells[1]!.buildingIds.filter((buildingId) => buildingId !== moved);
    to.cells[1]!.membershipChecksumSha256 = membershipChecksum(to.cells[1]!.buildingIds);
    to.cells[2]!.buildingIds = [...to.cells[2]!.buildingIds, moved].sort();
    to.cells[2]!.membershipChecksumSha256 = membershipChecksum(to.cells[2]!.buildingIds);
    const impact = diffExteriorWaveLedgers(from, to);
    expect(impact.movedBuildings).toEqual([{ buildingId: moved, fromCellId: from.cells[1]!.cellId, toCellId: from.cells[2]!.cellId }]);
    expect(impact.impactedCellIds).toEqual([from.cells[1]!.cellId, from.cells[2]!.cellId].sort());
    expect(impact.addedBuildingIds).toEqual([]);
    expect(impact.removedBuildingIds).toEqual([]);
  });

  it("flags a cell whose declared checksum changed without any id crossing a boundary", () => {
    const from = fixtureLedger();
    const to = clone(from);
    to.cells[3]!.membershipChecksumSha256 = "f".repeat(64);
    const impact = diffExteriorWaveLedgers(from, to);
    expect(impact.impactedCellIds).toEqual([from.cells[3]!.cellId]);
  });
});

describe("committed reconciliation report", () => {
  const artifactRoot = "data/normalized/manhattan-exterior-wave-ledger-20260804";
  const read = (name: string) => new TextDecoder().decode(readFileSync(`${artifactRoot}/${name}`));
  const ledger = JSON.parse(read("ledger.json")) as ExteriorOwnershipLedger;
  const report = JSON.parse(read("reconciliation-report.json")) as ExteriorLedgerReconciliationReport;

  it("records a zero-finding reconciliation pinned to the committed ledger", () => {
    expect(report.ok).toBe(true);
    expect(report.findings).toEqual([]);
    expect(report.counts).toEqual({ missing: 0, duplicate: 0, "cross-cell-duplicate": 0, stale: 0, changed: 0 });
    expect(report.ledgerId).toBe(ledger.ledgerId);
    expect(report.ledgerChecksumSha256).toBe(exteriorArtifactChecksum(ledger));
    expect(report.baseReleaseId).toBe(EXTERIOR_WAVE_BASE_RELEASE_ID);
    expect(report.observedBuildingCount).toBe(EXTERIOR_WAVE_BASE_BUILDING_COUNT);
    expect(report.ownedBuildingCount).toBe(EXTERIOR_WAVE_BASE_BUILDING_COUNT);
    expect(report.cellCount).toBe(ledger.cells.length);
  });

  it("reproduces the committed zero-finding result from the committed ledger alone", () => {
    const replayed = reconcileExteriorWaveLedger(ledger, {
      baseBuildingIds: ledger.cells.flatMap((cell) => cell.buildingIds),
      baseReleaseId: EXTERIOR_WAVE_BASE_RELEASE_ID,
      ledgerChecksumSha256: report.ledgerChecksumSha256,
    });
    expect(stableSerialize(replayed)).toBe(stableSerialize(report));
  });
});
