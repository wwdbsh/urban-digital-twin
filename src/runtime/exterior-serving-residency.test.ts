import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXTERIOR_RUNTIME_BUDGETS } from "./exterior-cell-runtime.ts";
import { EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY } from "./exterior-visibility-scheduler.ts";
import {
  EXTERIOR_SERVING_SIDECAR_BYTES_PER_ASSET,
  exteriorServingCellOccupancy,
  exteriorServingResidencyBound,
  type ExteriorServingCellOccupancy,
  type ExteriorServingInventoryFile,
} from "./exterior-serving-residency.ts";

const MIB = 1024 * 1024;

/** The six committed retention inventories, one per wave of the full ledger. */
const RETENTION_RECORDS = [
  "manhattan-exterior-cells-20260811-v3-c1",
  "manhattan-midtown-core-cells-20260811-v3-c1",
  "manhattan-lower-manhattan-cells-20260812-c1",
  "manhattan-southern-remainder-cells-20260812-c1",
  "manhattan-central-upper-manhattan-cells-20260812-c1",
  "manhattan-northern-manhattan-cells-20260812-c1",
] as const;

function readJson(path: string): unknown {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(readFileSync(path))));
}

function ownerByBuildingId(): Map<string, string> {
  const ledger = readJson("data/normalized/manhattan-exterior-wave-ledger-20260804/ledger.json") as { cells: Array<{ cellId: string; buildingIds: string[] }> };
  const owner = new Map<string, string>();
  for (const cell of ledger.cells) for (const buildingId of cell.buildingIds) owner.set(buildingId, cell.cellId);
  return owner;
}

function servedCells(): ExteriorServingCellOccupancy[] {
  const owner = ownerByBuildingId();
  const files: ExteriorServingInventoryFile[] = [];
  for (const releaseId of RETENTION_RECORDS) {
    const inventory = readJson(`data/${releaseId}/payload-inventory.json`) as { files: ExteriorServingInventoryFile[] };
    files.push(...inventory.files);
  }
  return exteriorServingCellOccupancy({ files, ownerByBuildingId: owner });
}

/**
 * The residency arithmetic for the full-city serving composition, recomputed on
 * every run from the committed retention inventories and the committed extents
 * census. No payload directory is required, which is what keeps this gate from
 * being the one that quietly stops running on a fresh clone.
 */
describe("full-city serving residency bound", () => {
  it("folds every committed retention inventory into per-cell occupancy", () => {
    const cells = servedCells();
    expect(cells).toHaveLength(883);
    expect(cells.reduce((sum, cell) => sum + cell.buildingCount, 0)).toBe(44_989);
    // One entry per served GLB PLUS one sidecar per cell. If the sidecar ever
    // stopped being charged, this is the assertion that would notice.
    expect(cells.reduce((sum, cell) => sum + cell.entries, 0)).toBe(44_989 + 883);
    const assetBytes = cells.reduce((sum, cell) => sum + cell.assetBytes, 0);
    expect(assetBytes).toBe(4_679_223_068);
  });

  it("re-derives the sidecar per-asset weight from the committed release graphs", () => {
    // The constant is a MEASUREMENT, so it is re-measured here rather than
    // trusted. Each `-p1` graph carries its shipped assets' inventory and
    // evidence shards inline, which is exactly what a sidecar will carry.
    const measured: number[] = [];
    for (const releaseId of ["manhattan-lower-manhattan-cells-20260812-p1", "manhattan-central-upper-manhattan-cells-20260812-p1", "manhattan-southern-remainder-cells-20260812-p1"]) {
      const path = `public/data/${releaseId}/release-graph.json`;
      if (!existsSync(path)) continue;
      const graph = readJson(path) as { inventoryShards: unknown[]; evidenceShards: unknown[] };
      const bytes = JSON.stringify(graph.inventoryShards).length + JSON.stringify(graph.evidenceShards).length;
      measured.push(Math.round(bytes / graph.inventoryShards.length));
    }
    expect(measured.length).toBeGreaterThan(0);
    // The constant must be at least the worst measured pair, never below it: a
    // bound built from an understated per-asset weight understates every wave.
    expect(EXTERIOR_SERVING_SIDECAR_BYTES_PER_ASSET).toBeGreaterThanOrEqual(Math.max(...measured));
    // ...and not wildly above it either, or the bound stops being a measurement.
    expect(EXTERIOR_SERVING_SIDECAR_BYTES_PER_ASSET).toBeLessThanOrEqual(Math.max(...measured) * 1.05);
  });

  /**
   * The result this task turns on, and it CONTRADICTS the arithmetic the plan
   * was frozen against. The plan's grounds were "worst-8 cells = 950 entries,
   * ~130 MiB (51% of the byte cap)", and concluded that the binding constraint
   * inverts from bytes to entries at serving scale.
   *
   * Measured, it does not. The reachable worst 8-cell neighbourhood is 591
   * entries and 234.02 MiB: entries sit at 57.7% of a raised 1,024 cap while
   * BYTES sit at 91.4% of the unchanged 256 MiB cap. Bytes stay the binding
   * constraint and get TIGHTER, not looser. The plan's ~950-entry figure has the
   * shape of the UNREACHABLE heaviest-set model, which this module also computes
   * so the two can be told apart rather than conflated.
   *
   * The plan's CONCLUSIONS survive — 8 is the right cap and 1,024 is the right
   * entry cap — but they survive for the opposite reason, and a promotion sized
   * against "bytes are at 51%" would have half the headroom it thought it had.
   */
  it("measures the reachable 8-cell bound, and finds BYTES binding rather than entries", () => {
    const bound = exteriorServingResidencyBound({ cells: servedCells(), cap: 8, maxCacheEntries: 1_024, maxCachedBytes: 256 * MIB });

    expect(bound.reachable.entries).toBe(591);
    expect(bound.reachable.bytes).toBe(245_393_546);
    expect(bound.reachableAnchorCellId).toBe("manhattan-exterior-cell-w01-000037-16-19300-17928");

    expect(bound.fitsEntryCap).toBe(true);
    expect(bound.fitsByteCap).toBe(true);
    expect(bound.bindingConstraint).toBe("bytes");
    expect(Number((bound.entryRatio * 100).toFixed(1))).toBe(57.7);
    expect(Number((bound.byteRatio * 100).toFixed(1))).toBe(91.4);

    // The unreachable model, kept beside the reachable bound so the difference
    // between "the 8 heaviest cells" and "the 8 cells a camera can see" is a
    // number rather than an argument.
    expect(bound.heaviestSet.entries).toBe(709);
    expect(bound.heaviestSet.bytes).toBeGreaterThan(256 * MIB);
  });

  it("shows 8 is the LARGEST cap the unchanged byte ceiling admits", () => {
    const cells = servedCells();
    const at = (cap: number) => exteriorServingResidencyBound({ cells, cap, maxCacheEntries: 1_024, maxCachedBytes: 256 * MIB });
    // This is the whole justification for 8 rather than 16 or 32, and it is the
    // half of the argument the frozen plan did not have: the next step up does
    // not merely reduce headroom, it exceeds the byte cap outright, so a larger
    // cap would evict on bytes at the worst anchor by construction.
    expect(at(8).fitsByteCap).toBe(true);
    expect(at(16).fitsByteCap).toBe(false);
    expect(at(32).fitsByteCap).toBe(false);
    // And the entry cap genuinely has to rise: 591 does not fit the current 512.
    expect(at(8).reachable.entries).toBeGreaterThan(512);
    expect(at(8).reachable.entries).toBeLessThanOrEqual(1_024);
    // 16 does not merely overflow bytes; it overflows the raised entry cap too.
    expect(at(16).reachable.entries).toBeGreaterThan(1_024);
  });

  it("states the ratio between what is served and what is ever resident", () => {
    const bound = exteriorServingResidencyBound({ cells: servedCells(), cap: 8, maxCacheEntries: 1_024, maxCachedBytes: 256 * MIB });
    // 5.52 GB of served documents against ~234 MiB ever resident. The point is
    // not the ratio itself but that the composition is NOT a cache bound at this
    // scale, which is the fact that makes a residency cap load-bearing where it
    // previously was not.
    expect(bound.composition.entries).toBe(45_872);
    expect(bound.composition.bytes).toBe(5_523_486_642);
    expect(bound.composition.bytes / bound.reachable.bytes).toBeGreaterThan(22);
  });

  it("records the caps this build still ships, so a flip is a deliberate edit", () => {
    // T005 does NOT change these here. The bound above says what they must
    // become when the serving releases are promoted, and flipping them before
    // the serving payload exists would cap the CURATED composition at 8 cells
    // for no benefit. The pairing is asserted so the two halves cannot drift
    // apart silently — ADR 0045 4.1's both-halves lesson.
    expect(EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY.maxResidentUnits).toBe(128);
    expect(EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries).toBe(512);
    expect(EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes).toBe(256 * MIB);
  });
});
