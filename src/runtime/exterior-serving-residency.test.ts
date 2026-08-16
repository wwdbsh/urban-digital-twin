import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXTERIOR_RUNTIME_BUDGETS } from "./exterior-cell-runtime.ts";
import { EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY } from "./exterior-visibility-scheduler.ts";
import {
  EXTERIOR_SERVING_ASSEMBLY_BYTES_PER_ASSET,
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
    // One entry per served GLB PLUS the TWO per-cell documents a serving release
    // fetches: the evidence sidecar and, since ADR 0052 §2, the cell's own
    // assembly manifest. If either stopped being charged, this notices.
    expect(cells.reduce((sum, cell) => sum + cell.entries, 0)).toBe(44_989 + 2 * 883);
    const assetBytes = cells.reduce((sum, cell) => sum + cell.assetBytes, 0);
    expect(assetBytes).toBe(4_679_223_068);
    expect(cells.reduce((sum, cell) => sum + cell.sidecarBytes, 0)).toBe(844_263_574);
    expect(cells.reduce((sum, cell) => sum + cell.assemblyBytes, 0)).toBe(124_034_673);
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

  it("re-derives the assembly per-asset weight from the committed retention packages", () => {
    // Same discipline as the sidecar constant above: a MEASUREMENT, re-measured
    // from the committed `-c1` per-cell manifests transformed to the single-LOD
    // form a serving release ships. Guarded on payload presence, because the
    // manifests live in the untracked retention tree; the bound itself needs no
    // payload and is asserted unguarded.
    const measured: number[] = [];
    for (const releaseId of ["manhattan-lower-manhattan-cells-20260812-c1", "manhattan-central-upper-manhattan-cells-20260812-c1", "manhattan-northern-manhattan-cells-20260812-c1"]) {
      const root = `public/data/${releaseId}`;
      if (!existsSync(`${root}/retention-root.json`)) continue;
      // The release's OWN declared manifest list, not a directory listing: a
      // stray file in the tree cannot join the measurement.
      const { cellManifests } = readJson(`${root}/retention-root.json`) as { cellManifests: { relativeRef: string }[] };
      let bytes = 0;
      let assets = 0;
      for (const { relativeRef } of cellManifests) {
        const manifest = readJson(`${root}/${relativeRef}`) as { assets: { lods: { lodId: string; artifactRef: string }[] }[]; artifacts: { role: string; relativeRef: string; byteSize: number }[]; declaredTotalBytes: number };
        const kept = new Set<string>();
        for (const asset of manifest.assets) {
          asset.lods = asset.lods.filter((lod) => lod.lodId === "lod_0");
          kept.add(asset.lods[0]!.artifactRef);
          assets += 1;
        }
        manifest.artifacts = manifest.artifacts.filter((artifact) => artifact.role !== "glb" || kept.has(artifact.relativeRef));
        manifest.declaredTotalBytes = manifest.artifacts.reduce((sum, artifact) => sum + artifact.byteSize, 0);
        bytes += new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`).byteLength;
      }
      if (assets > 0) measured.push(Math.round(bytes / assets));
    }
    if (measured.length === 0) return;
    // At least the worst measured wave, never below it.
    expect(EXTERIOR_SERVING_ASSEMBLY_BYTES_PER_ASSET).toBeGreaterThanOrEqual(Math.max(...measured));
    // The constant is w00's ratio, which is high because Block 835 is ONE cell
    // of 14 buildings and its fixed manifest header amortises over almost
    // nothing. That makes it an over-statement for real serving cells rather
    // than a typical value — the conservative direction — so the tolerance here
    // is wider than the sidecar's 5%.
    expect(EXTERIOR_SERVING_ASSEMBLY_BYTES_PER_ASSET).toBeLessThanOrEqual(Math.max(...measured) * 1.2);
  });

  /**
   * The result this task turns on, and it CONTRADICTS the arithmetic the plan
   * was frozen against. The plan's grounds were "worst-8 cells = 950 entries,
   * ~130 MiB (51% of the byte cap)", and concluded that the binding constraint
   * inverts from bytes to entries at serving scale.
   *
   * Measured, it does not. The reachable worst 8-cell neighbourhood is 599
   * entries and 235.56 MiB: entries sit at 58.5% of a raised 1,024 cap while
   * BYTES sit at 92.0% of the unchanged 256 MiB cap. Bytes stay the binding
   * constraint and get TIGHTER, not looser. The plan's ~950-entry figure has the
   * shape of the UNREACHABLE heaviest-set model, which this module also computes
   * so the two can be told apart rather than conflated.
   *
   * The plan's CONCLUSIONS survive — 8 is the right cap and 1,024 is the right
   * entry cap — but they survive for the opposite reason, and a promotion sized
   * against "bytes are at 51%" would have half the headroom it thought it had.
   *
   * ## Re-derived under the ADR 0052 §2 assembly seam
   *
   * Making the per-cell assembly manifest a separately fetched artifact adds one
   * cache entry and its bytes to EVERY resident cell. The bound moved:
   * 591 -> 599 entries and 234.02 -> 235.56 MiB, so byte headroom fell from 8.6%
   * to 8.0%. It is re-derived rather than assumed to be absorbed, because at 92%
   * of the cap there is no room for a term nobody counted.
   */
  it("measures the reachable 8-cell bound, and finds BYTES binding rather than entries", () => {
    const bound = exteriorServingResidencyBound({ cells: servedCells(), cap: 8, maxCacheEntries: 1_024, maxCachedBytes: 256 * MIB });

    expect(bound.reachable.entries).toBe(599);
    expect(bound.reachable.bytes).toBe(247_000_877);
    expect(bound.reachableAnchorCellId).toBe("manhattan-exterior-cell-w01-000037-16-19300-17928");

    expect(bound.fitsEntryCap).toBe(true);
    expect(bound.fitsByteCap).toBe(true);
    expect(bound.bindingConstraint).toBe("bytes");
    expect(Number((bound.entryRatio * 100).toFixed(1))).toBe(58.5);
    expect(Number((bound.byteRatio * 100).toFixed(1))).toBe(92.0);
    // The headroom, stated as the number it is. 8% of the byte cap is what
    // stands between the promoted island and eviction at the worst anchor.
    expect(256 * MIB - bound.reachable.bytes).toBe(21_434_579);

    // The unreachable model, kept beside the reachable bound so the difference
    // between "the 8 heaviest cells" and "the 8 cells a camera can see" is a
    // number rather than an argument.
    expect(bound.heaviestSet.entries).toBe(756);
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
    // And the entry cap genuinely has to rise: 599 does not fit the current 512.
    expect(at(8).reachable.entries).toBeGreaterThan(512);
    expect(at(8).reachable.entries).toBeLessThanOrEqual(1_024);
    // 16 does not merely overflow bytes; it overflows the raised entry cap too.
    expect(at(16).reachable.entries).toBeGreaterThan(1_024);
  });

  it("states the ratio between what is served and what is ever resident", () => {
    const bound = exteriorServingResidencyBound({ cells: servedCells(), cap: 8, maxCacheEntries: 1_024, maxCachedBytes: 256 * MIB });
    // 5.65 GB of served documents against ~236 MiB ever resident. The point is
    // not the ratio itself but that the composition is NOT a cache bound at this
    // scale, which is the fact that makes a residency cap load-bearing where it
    // previously was not.
    expect(bound.composition.entries).toBe(46_755);
    expect(bound.composition.bytes).toBe(5_647_521_315);
    expect(bound.composition.bytes / bound.reachable.bytes).toBeGreaterThan(22);
  });

  /**
   * THE FLIP LANDED, and this test is the reason it could only land here.
   *
   * Until the promotion commit this case asserted the OPPOSITE — cap 128, 512
   * entries — and said so deliberately: flipping the caps before the serving
   * releases were promoted would have capped the CURATED composition at 8 cells,
   * which ADR 0052 §3 measured as rendering NOTHING at the overview camera,
   * because the nearest 8 of 883 dense census cells almost never coincide with
   * 13 sparse content cells.
   *
   * It now asserts the flip, in the same shape and for the same reason: the two
   * halves are pinned TOGETHER so they cannot drift apart silently, which is
   * ADR 0045 4.1's both-halves lesson. Each half is also tied to the measurement
   * that justifies it, so neither can be moved without moving a bound.
   */
  it("records the caps this build ships, both halves of the flip in one place", () => {
    const bound = exteriorServingResidencyBound({ cells: servedCells(), cap: 8, maxCacheEntries: 1_024, maxCachedBytes: 256 * MIB });

    // Half one: the residency cap IS the cap the bound was measured at.
    expect(EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY.maxResidentUnits).toBe(8);

    // Half two: the entry cap had to rise because 599 does not fit 512, and it
    // rose to exactly one doubling rather than to a number nobody sized.
    expect(EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries).toBe(1_024);
    expect(bound.reachable.entries).toBeGreaterThan(512);
    expect(bound.reachable.entries).toBeLessThanOrEqual(EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries);

    // And the byte cap did NOT move, which is the third fact and the one most
    // easily lost: it is now the live backstop at 92.0% of the worst anchor,
    // and it is what makes a cap of 16 impossible rather than merely tight.
    expect(EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes).toBe(256 * MIB);
    expect(bound.bindingConstraint).toBe("bytes");

    // The bound is recomputed here against the LIVE constants, not against the
    // literals above, so a later edit to either constant is measured rather
    // than merely noticed.
    const live = exteriorServingResidencyBound({
      cells: servedCells(),
      cap: EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY.maxResidentUnits,
      maxCacheEntries: EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries,
      maxCachedBytes: EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes,
    });
    expect(live.fitsEntryCap).toBe(true);
    expect(live.fitsByteCap).toBe(true);
    expect(live.reachable.entries).toBe(599);
    expect(live.reachable.bytes).toBe(247_000_877);
  });
});
