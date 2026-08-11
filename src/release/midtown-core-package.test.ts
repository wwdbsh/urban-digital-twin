import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256, EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID } from "../domain/exterior-fullsnapshot-input.ts";
import { validateExteriorReleaseGraph } from "./exterior-release.ts";
import { EXTERIOR_CELL_MAX_BUILDINGS, EXTERIOR_WAVE_LEDGER_CITY_ID, EXTERIOR_WAVE_LEDGER_CONFIG_ID, membershipChecksum } from "./exterior-wave-ledger.ts";
import {
  MIDTOWN_CORE_BUILDING_COUNT,
  MIDTOWN_CORE_CELL_COUNT,
  MIDTOWN_CORE_WAVE_ID,
  buildMidtownCoreSubsetLedger,
  midtownCoreArtifactChecksum,
  reconcileMidtownCoreAgainstDigest,
  validateMidtownCoreSubsetLedger,
} from "./midtown-core-package.ts";

const LEDGER_ROOT = "data/normalized/manhattan-exterior-wave-ledger-20260804";

function readText(path: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(readFileSync(path)));
}

function readJson(fileName: string): never {
  return JSON.parse(readText(`${LEDGER_ROOT}/${fileName}`)) as never;
}

const parentLedger = readJson("ledger.json");
const parentLedgerChecksumSha256 = midtownCoreArtifactChecksum(parentLedger);

function build() {
  return buildMidtownCoreSubsetLedger({
    parentLedger,
    parentLedgerChecksumSha256,
    baseReleaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID,
    baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
  });
}

describe("midtown-core derived-subset ownership ledger", () => {
  it("pins the committed parent ledger by its own recorded checksum", () => {
    const recorded = readText(`${LEDGER_ROOT}/ledger.sha256`).trim().split(/\s+/u)[0];
    expect(parentLedgerChecksumSha256).toBe(recorded);
  });

  it("owns exactly the declared midtown-core wave", () => {
    const subset = build();
    expect(subset.ledger.cells).toHaveLength(MIDTOWN_CORE_CELL_COUNT);
    expect(subset.buildingIds).toHaveLength(MIDTOWN_CORE_BUILDING_COUNT);
    expect(new Set(subset.buildingIds).size).toBe(MIDTOWN_CORE_BUILDING_COUNT);
    expect(subset.ledger.cells.every((cell) => cell.cellId.includes(`-w0${1}-`))).toBe(true);
  });

  it("renumbers cell orders contiguously from zero while preserving priority", () => {
    const subset = build();
    expect(subset.ledger.cells.map((cell) => cell.order)).toEqual([...Array(MIDTOWN_CORE_CELL_COUNT).keys()]);
    // Lexicographic cell-id order is what the accepted runtime sorts by, so it
    // must still equal the renumbered order.
    const lexicographic = [...subset.ledger.cells].sort((left, right) => (left.cellId < right.cellId ? -1 : 1));
    expect(lexicographic.map((cell) => cell.cellId)).toEqual(subset.ledger.cells.map((cell) => cell.cellId));
    // Parent orders are strictly increasing across the renumbering.
    const parentOrders = subset.derivation.orderMap.map((entry) => entry.parentOrder);
    expect([...parentOrders].sort((left, right) => left - right)).toEqual(parentOrders);
  });

  it("preserves the parent cell ids verbatim so the committed digest still reconciles", () => {
    const subset = build();
    const parentIds = new Set((parentLedger as { cells: { cellId: string }[] }).cells.map((cell) => cell.cellId));
    expect(subset.ledger.cells.every((cell) => parentIds.has(cell.cellId))).toBe(true);
  });

  it("derives a new base identity set over exactly the owned membership", () => {
    const subset = build();
    const base = subset.ledger.baseIdentitySet;
    expect(base.buildingCount).toBe(MIDTOWN_CORE_BUILDING_COUNT);
    expect(base.checksumSha256).toBe(membershipChecksum(subset.buildingIds));
    // Must never alias the full-city base identity the parent pins.
    expect(base.id).not.toBe((parentLedger as { baseIdentitySet: { id: string } }).baseIdentitySet.id);
    expect(base.checksumSha256).not.toBe((parentLedger as { baseIdentitySet: { checksumSha256: string } }).baseIdentitySet.checksumSha256);
  });

  it("uses the wave-ledger vocabulary, not the Block 835 config", () => {
    const subset = build();
    expect(subset.ledger.cityId).toBe(EXTERIOR_WAVE_LEDGER_CITY_ID);
    expect(subset.ledger.configId).toBe(EXTERIOR_WAVE_LEDGER_CONFIG_ID);
    expect(subset.ledger.configId).not.toBe("manhattan-esb-block-835");
  });

  it("recomputes coverage as the exact union of its own cells", () => {
    const subset = build();
    const union = subset.ledger.cells.reduce((accumulator, cell) => ({
      west: Math.min(accumulator.west, cell.bounds.west),
      south: Math.min(accumulator.south, cell.bounds.south),
      east: Math.max(accumulator.east, cell.bounds.east),
      north: Math.max(accumulator.north, cell.bounds.north),
    }), { ...subset.ledger.cells[0]!.bounds });
    expect(subset.ledger.coverage).toEqual(union);
    // Strictly inside the parent full-city coverage.
    const parentCoverage = (parentLedger as { coverage: { west: number; east: number } }).coverage;
    expect(subset.ledger.coverage.west).toBeGreaterThan(parentCoverage.west);
    expect(subset.ledger.coverage.east).toBeLessThan(parentCoverage.east);
  });

  it("re-derives every per-cell membership checksum and honours the runtime cap", () => {
    const subset = build();
    for (const cell of subset.ledger.cells) {
      expect(cell.membershipChecksumSha256).toBe(membershipChecksum(cell.buildingIds));
      expect(cell.buildingIds.length).toBeGreaterThan(0);
      expect(cell.buildingIds.length).toBeLessThanOrEqual(EXTERIOR_CELL_MAX_BUILDINGS);
      expect(cell.buildingIds).toEqual([...cell.buildingIds].sort());
    }
    expect(subset.derivation.subset.maxObservedCellBuildings).toBe(114);
  });

  it("passes the accepted release-graph ownership checks", () => {
    const result = validateMidtownCoreSubsetLedger(build().ledger);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("reconciles against the committed membership digest with zero missing or duplicate owners", () => {
    const subset = build();
    const report = reconcileMidtownCoreAgainstDigest(subset, readJson("membership-digest.json"));
    expect(report.findings).toEqual([]);
    expect(report.counts).toEqual({
      digestCells: MIDTOWN_CORE_CELL_COUNT,
      subsetCells: MIDTOWN_CORE_CELL_COUNT,
      digestBuildings: MIDTOWN_CORE_BUILDING_COUNT,
      subsetBuildings: MIDTOWN_CORE_BUILDING_COUNT,
      missingOwners: 0,
      duplicateOwners: 0,
    });
    expect(report.ok).toBe(true);
    expect(report.waveId).toBe(MIDTOWN_CORE_WAVE_ID);
  });

  it("excludes the wave-0 Block 835 cell and shares no building with it", () => {
    const subset = build();
    expect(subset.derivation.exclusions).toEqual([
      { cellId: "manhattan-exterior-cell-w00-000000-block-00835", buildingCount: 14, overlapWithSubset: 0 },
    ]);
    expect(subset.ledger.cells.some((cell) => cell.cellId.includes("block-00835"))).toBe(false);
  });

  it("is byte-deterministic across rebuilds", () => {
    expect(midtownCoreArtifactChecksum(build().ledger)).toBe(midtownCoreArtifactChecksum(build().ledger));
    expect(midtownCoreArtifactChecksum(build().derivation)).toBe(midtownCoreArtifactChecksum(build().derivation));
  });

  it("fails closed when the parent partition does not match the declared wave shape", () => {
    const truncated = {
      ...(parentLedger as object),
      cells: (parentLedger as { cells: unknown[] }).cells.filter((cell) => !(cell as { cellId: string }).cellId.includes("-w01-000149-")),
    };
    expect(() => buildMidtownCoreSubsetLedger({
      parentLedger: truncated as never,
      parentLedgerChecksumSha256,
      baseReleaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID,
      baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
    })).toThrow(/holds 148 cells/u);
  });

  it("keeps the subset ledger small enough to ship inside a release graph", () => {
    // 149 cells x up to 114 ids: the ledger is the graph's fixed overhead, so
    // its size is recorded rather than assumed.
    const bytes = new TextEncoder().encode(JSON.stringify(build().ledger, null, 2)).byteLength;
    expect(bytes).toBeLessThan(300_000);
  });

  it("is rejected by the full graph validator until roots and snapshots exist", () => {
    // Guards the Phase C contract: the ledger alone is not a release.
    const result = validateExteriorReleaseGraph({
      schemaVersion: "1.0",
      roots: [],
      ownershipLedger: build().ledger,
      cellReleases: [],
      inventoryShards: [],
      evidenceShards: [],
      snapshots: [],
    });
    expect(result.ok).toBe(false);
  });
});
