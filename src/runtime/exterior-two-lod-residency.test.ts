/**
 * Re-derives ADR 0057 Part 3 from the COMMITTED records, so the ADR's table is
 * checkable rather than asserted.
 *
 * It reads the committed ownership ledger, the six `-c1` payload inventories
 * (`lod_0` bytes), the six `-c2` payload inventories (textured `lod_1` bytes)
 * and the six `-c1` censuses (the measured-fallback set). It needs NO payload
 * directory: a budget gate that requires six gigabytes of local bytes is a
 * budget gate that gets skipped.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { EXTERIOR_RUNTIME_BUDGETS } from "./exterior-cell-runtime.ts";
import { EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY } from "./exterior-visibility-scheduler.ts";
import {
  EXTERIOR_TWO_LOD_NEAR_RING_METERS,
  exteriorTwoLodCellOccupancy,
  exteriorTwoLodResidencyBound,
  twoLodAmplificationCeiling,
} from "./exterior-two-lod-residency.ts";

interface InventoryDocument { files: Array<{ path: string; byteSize: number }> }
interface CensusDocument { lod1Decisions: Array<{ buildingId: string; variant: string }> }
interface LedgerDocument { cells: Array<{ cellId: string; buildingIds: string[] }> }

/** Same convention as `exterior-serving-residency.test.ts`: repo-relative, decoded strictly. */
function read<T>(path: string): T {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(readFileSync(path)))) as T;
}

const WAVE_BASES = [
  "manhattan-exterior-cells-20260811-v3",
  "manhattan-midtown-core-cells-20260811-v3",
  "manhattan-lower-manhattan-cells-20260812",
  "manhattan-southern-remainder-cells-20260812",
  "manhattan-central-upper-manhattan-cells-20260812",
  "manhattan-northern-manhattan-cells-20260812",
] as const;

const ledger = read<LedgerDocument>("data/normalized/manhattan-exterior-wave-ledger-20260804/ledger.json");
const ownerByBuildingId = new Map<string, string>();
for (const cell of ledger.cells) for (const buildingId of cell.buildingIds) ownerByBuildingId.set(buildingId, cell.cellId);

const lod0Files: Array<{ path: string; byteSize: number }> = [];
const lod1Files: Array<{ path: string; byteSize: number }> = [];
const fallbackBuildingIds = new Set<string>();
for (const base of WAVE_BASES) {
  lod0Files.push(...read<InventoryDocument>(`data/${base}-c1/payload-inventory.json`).files);
  lod1Files.push(...read<InventoryDocument>(`data/${base}-c2/payload-inventory.json`).files);
  for (const decision of read<CensusDocument>(`data/${base}-c1/wave-census.json`).lod1Decisions) {
    if (decision.variant === "full-geometry") fallbackBuildingIds.add(decision.buildingId);
  }
}

const cells = exteriorTwoLodCellOccupancy({ lod0Files, lod1Files, ownerByBuildingId, fallbackBuildingIds });

describe("the T001 two-LOD residency derivation (ADR 0057 Part 3)", () => {
  it("covers the whole committed composition", () => {
    expect(cells).toHaveLength(883);
    expect(cells.reduce((sum, cell) => sum + cell.buildingCount, 0)).toBe(44_989);
    expect(cells.reduce((sum, cell) => sum + cell.fallbackCount, 0)).toBe(424);
  });

  it("re-derives the island byte figures the ADR states", () => {
    const overhead = cells.reduce((sum, cell) => sum + cell.buildingCount, 0) * (18_766 + 2_757);
    const lod0 = cells.reduce((sum, cell) => sum + cell.nearBytes, 0) - overhead;
    expect(lod0).toBe(4_679_223_068);
    // The mid figure carries the 424 fallback parents at lod_0, so it is not the
    // bare -c2 island total; that term is the point of charging it explicitly.
    const mid = cells.reduce((sum, cell) => sum + cell.midBytes, 0) - overhead;
    expect(mid).toBeLessThan(lod0);
    expect(mid / lod0).toBeLessThan(0.5);
  });

  it("puts the LIVE configuration inside both caps, with the byte pressure FALLING", () => {
    const bound = exteriorTwoLodResidencyBound({
      cells,
      cap: EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY.maxResidentUnits,
      nearRingMeters: EXTERIOR_TWO_LOD_NEAR_RING_METERS,
      maxCacheEntries: EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries,
      maxCachedBytes: EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes,
    });
    expect(bound.cap).toBe(8);
    expect(bound.reachableBytes).toBe(158_382_700);
    expect(bound.reachableEntries).toBe(676);
    expect(bound.midRingCellCount).toBe(5);
    expect(bound.fitsByteCap).toBe(true);
    expect(bound.fitsEntryCap).toBe(true);
    // The lod_0-only composition sits at 92.0% of the byte cap. This must be
    // materially lower, or the mid ring is not buying what the ADR says it buys.
    expect(bound.byteRatio).toBeLessThan(0.6);
    expect(bound.entryRatio).toBeLessThan(0.7);
  });

  it("shows why the scheduler band edges are the wrong scale", () => {
    // At the live cap the resident neighbourhood has a radius of ~546 m, so a
    // 1,200 m boundary puts every resident cell in the near ring and the mid
    // ring is EMPTY. This is the arithmetic that rules the band edges out, and
    // it is pinned so a successor cannot quietly adopt them.
    const atBandEdge = exteriorTwoLodResidencyBound({
      cells,
      cap: EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY.maxResidentUnits,
      nearRingMeters: 1_200,
      maxCacheEntries: EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries,
      maxCachedBytes: EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes,
    });
    expect(atBandEdge.midRingCellCount).toBe(0);
    expect(atBandEdge.residentRadiusMeters).toBeLessThan(1_200);
    // And with no mid cell it degenerates to exactly the lod_0-only bound.
    expect(atBandEdge.reachableBytes).toBe(247_000_877);
  });

  it("states the conditional under which entries WOULD bind", () => {
    // Correction #3 expected an entries raise. At the unchanged resident cap it
    // is not needed; past cap 12 it is. Both are pinned so the claim is a
    // derivation rather than a recollection.
    const at12 = exteriorTwoLodResidencyBound({ cells, cap: 12, nearRingMeters: EXTERIOR_TWO_LOD_NEAR_RING_METERS, maxCacheEntries: 1_024, maxCachedBytes: EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes });
    expect(at12.fitsEntryCap).toBe(true);
    expect(at12.fitsByteCap).toBe(true);
    const at16 = exteriorTwoLodResidencyBound({ cells, cap: 16, nearRingMeters: EXTERIOR_TWO_LOD_NEAR_RING_METERS, maxCacheEntries: 1_024, maxCachedBytes: EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes });
    expect(at16.fitsByteCap).toBe(true);
    expect(at16.fitsEntryCap).toBe(false);
    // Entries are the constraint that is MET FIRST here — 115.8% of the entry
    // cap against 89.8% of the byte cap — which is precisely correction #3's
    // expectation, holding at cap 16 and not at the cap that ships.
    expect(at16.bindingConstraint).toBe("entries");
    expect(at16.reachableEntries).toBe(1_186);
  });

  it("registers the amplification ceiling as MODELLED, and it exceeds both caps", () => {
    const ceiling = twoLodAmplificationCeiling({ cells, cap: EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY.maxResidentUnits });
    expect(ceiling.reachable).toBe(false);
    expect(ceiling.bytes).toBe(338_182_457);
    expect(ceiling.entries).toBe(1_182);
    expect(ceiling.bytes).toBeGreaterThan(EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes);
    expect(ceiling.entries).toBeGreaterThan(EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries);
  });

  it("re-derives the registered amplification ALLOWANCE of 4 cells", () => {
    const bound = exteriorTwoLodResidencyBound({
      cells,
      cap: EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY.maxResidentUnits,
      nearRingMeters: EXTERIOR_TWO_LOD_NEAR_RING_METERS,
      maxCacheEntries: EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries,
      maxCachedBytes: EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes,
    });
    const ceiling = twoLodAmplificationCeiling({ cells, cap: bound.cap });
    const byteHeadroom = EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes - bound.reachableBytes;
    const entryHeadroom = EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries - bound.reachableEntries;
    const perCellBytes = (ceiling.bytes - bound.reachableBytes) / bound.cap;
    const perCellEntries = (bound.reachableEntries - bound.cap * 2) / bound.cap;
    // ADR 0057 §4.1: 4.90 cells on bytes, 4.22 on entries, so FOUR is the
    // registered allowance and the fifth doubled cell is an exceedance.
    expect(Math.floor(Math.min(byteHeadroom / perCellBytes, entryHeadroom / perCellEntries))).toBe(4);
  });
});
