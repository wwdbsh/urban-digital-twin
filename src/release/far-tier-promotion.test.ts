/**
 * The promotion's own invariants: the merged inventory, the pin it swaps, the
 * ceilings it raises, and the byte identity the whole tier depends on.
 *
 * The failure this file exists to prevent is not subtle and is not recoverable
 * at run time: the runtime pins ONE digest and fails closed on a mismatch, so
 * a staged inventory that differs from the committed one by a single space
 * takes the entire far tier down in every session on every machine, and the
 * only symptom is a message about a checksum.
 */
import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { sha256HexSync } from "../domain/deterministic-hash";
import {
  FarTierMergeError,
  farTierInventoryDigest,
  mergeFarTierWaveInventories,
  serializeFarTierInventory,
  type FarTierPromotedInventory,
} from "./far-tier-promoted-inventory";
import {
  FAR_TIER_FAILURE_DETAIL_LIMIT,
  FAR_TIER_PAYLOAD_INVENTORY_SHA256,
  FAR_TIER_PAYLOAD_INVENTORY_SHA256_PREDECESSORS,
  FAR_TIER_RUNTIME_BUDGETS,
  FAR_TIER_RUNTIME_BUDGETS_V2,
  FAR_TIER_RUNTIME_BUDGETS_V3,
  farTierEntryByteCost,
  farTierFailureDetail,
} from "../runtime/far-tier-serving";
import { FAR_TIER_BUDGET_CONTRACT } from "./far-tier-budget";

const readText = (path: string): string => new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
const COMMITTED_PATH = "data/far-tier-hlod-promotion-20260823/promoted-inventory.json";
const STAGED_PATH = "public/far-tier/payload-inventory.json";
const committedText = readText(COMMITTED_PATH);
const committed = JSON.parse(committedText) as FarTierPromotedInventory;

describe("the promoted inventory is what the runtime pins", () => {
  it("re-derives the shipped pin from the committed bytes", () => {
    expect(sha256HexSync(committedText)).toBe(FAR_TIER_PAYLOAD_INVENTORY_SHA256);
  });

  it("moved the pin, and says what it moved from", () => {
    // The tier has been re-declared twice, and BOTH earlier pins are still
    // re-derivable from their committed files, so neither swap can be dropped.
    expect(FAR_TIER_PAYLOAD_INVENTORY_SHA256_PREDECESSORS).not.toContain(FAR_TIER_PAYLOAD_INVENTORY_SHA256);
    expect(sha256HexSync(readText("data/far-tier-hlod-runtime-20260818/payload-inventory.json")))
      .toBe(FAR_TIER_PAYLOAD_INVENTORY_SHA256_PREDECESSORS[0]);
    expect(sha256HexSync(readText("data/far-tier-hlod-promotion-20260819/promoted-inventory.json")))
      .toBe(FAR_TIER_PAYLOAD_INVENTORY_SHA256_PREDECESSORS[1]);
  });

  it("carries 883 unique cells and closes 883 + 0 against the ledger", () => {
    // The 43 that used to be honest stops now bake, so the coverage that used
    // to read 840 + 43 reads 883 + 0. The ledger total is unchanged.
    expect(committed.entries).toHaveLength(883);
    expect(new Set(committed.entries.map((entry) => entry.cellId)).size).toBe(883);
    const coverage = committed.coverage as Record<string, number | boolean | readonly string[]>;
    expect(coverage.bakedCells).toBe(883);
    expect(coverage.honestStopCells).toBe(0);
    expect(coverage.accountedFor).toBe(883);
    expect(coverage.ledgerCellCount).toBe(883);
    expect((coverage.honestStopCellIds as readonly string[])).toHaveLength(0);
    // A stop that is also an entry would be a cell counted twice.
    const stops = new Set(coverage.honestStopCellIds as readonly string[]);
    for (const entry of committed.entries) expect(stops.has(entry.cellId)).toBe(false);
  });

  it("keeps every refused member, because the massing still has to explain itself", () => {
    const members = committed.entries.flatMap((entry) => entry.members);
    expect(members).toHaveLength(45_194);
    expect(members.filter((member) => !member.included)).toHaveLength(162);
  });
});

describe("one serializer, and the staged bytes are the committed bytes", () => {
  it("round-trips the committed record byte for byte", () => {
    // If this fails, ANY writer that re-serializes instead of copying produces
    // a file the runtime will reject. It is the property the copy relies on.
    expect(serializeFarTierInventory(committed)).toBe(committedText);
    expect(farTierInventoryDigest(committed)).toBe(FAR_TIER_PAYLOAD_INVENTORY_SHA256);
  });

  it("stages bytes identical to the committed record", () => {
    if (!existsSync(STAGED_PATH)) {
      // The serving root is gitignored operator work product, so a fresh clone
      // has nothing staged. The round-trip above is the unconditional half of
      // this guarantee; this half runs wherever staging has happened.
      expect(existsSync(COMMITTED_PATH)).toBe(true);
      return;
    }
    expect(readText(STAGED_PATH)).toBe(committedText);
    expect(sha256HexSync(readText(STAGED_PATH))).toBe(FAR_TIER_PAYLOAD_INVENTORY_SHA256);
  });
});

describe("the merge refuses rather than papering over", () => {
  const entry = (cellId: string) => ({ cellId, glbSha256: "a".repeat(64), glbByteSize: 1, atlasSha256: "b".repeat(64), atlasByteSize: 1, members: [] });
  const base = {
    honestStopCellIds: [] as string[],
    ledgerCellCount: 2,
    ledgerChecksumSha256: "c".repeat(64),
    recipeId: "far-tier-hlod-bake-v4",
    recipeSha256: "d".repeat(64),
    inventoryId: "far-tier-hlod-promotion-test",
    derivedFromRecord: { path: "data/test/derived-from.json", sha256: "e".repeat(64) },
  };
  const wave = (waveId: string, cellIds: string[]) => ({
    waveId,
    entries: cellIds.map(entry),
    recordPath: `data/test/inventory-${waveId}.json`,
    recordSha256: "f".repeat(64),
  });

  it("refuses a cell declared by two waves", () => {
    expect(() => mergeFarTierWaveInventories({
      ...base,
      waves: [
        wave("w01", ["cell:a"]),
        wave("w02", ["cell:a"]),
      ],
    })).toThrow(FarTierMergeError);
  });

  it("refuses a cell that is both baked and an honest stop", () => {
    expect(() => mergeFarTierWaveInventories({
      ...base,
      honestStopCellIds: ["cell:a"],
      waves: [wave("w01", ["cell:a", "cell:b"])],
    })).toThrow(/both baked and recorded as honest stops/u);
  });

  it("refuses a total that disagrees with the ledger", () => {
    expect(() => mergeFarTierWaveInventories({
      ...base,
      ledgerCellCount: 99,
      waves: [wave("w01", ["cell:a", "cell:b"])],
    })).toThrow(/coverage it does not have/u);
  });

  it("accepts the well-formed case, so the refusals above are not vacuous", () => {
    const merged = mergeFarTierWaveInventories({
      ...base,
      waves: [wave("w01", ["cell:a", "cell:b"])],
    });
    expect(merged.entries).toHaveLength(2);
    expect(merged.inventoryId).toBe("far-tier-hlod-promotion-test");
  });

  it("PAIRS every declared path with the digest of that same path's bytes", () => {
    // The defect this shape exists to prevent: an earlier version hardcoded
    // T004's campaign-summary path while the caller passed a different record's
    // digest, so a pinned artifact named one record and hashed another. Both
    // fields were individually well-formed, so nothing could catch it.
    const merged = mergeFarTierWaveInventories({ ...base, waves: [wave("w01", ["cell:a", "cell:b"])] });
    const derivedFrom = merged.derivedFrom as {
      record: string; recordSha256: string;
      waves: Array<{ inventoryRecord: string; inventorySha256: string }>;
    };
    expect(derivedFrom.record).toBe("data/test/derived-from.json");
    expect(derivedFrom.recordSha256).toBe("e".repeat(64));
    expect(derivedFrom.waves[0]!.inventoryRecord).toBe("data/test/inventory-w01.json");
    expect(derivedFrom.waves[0]!.inventorySha256).toBe("f".repeat(64));
  });
});

describe("budgets v3 is derived, additive, and stated in its own unit", () => {
  it("sums to the declared file bytes of the promoted island", () => {
    const total = committed.entries.reduce((sum, entry) => sum + farTierEntryByteCost(entry), 0);
    expect(total).toBe(266_051_784);
    expect(FAR_TIER_RUNTIME_BUDGETS_V3.derivation.declaredFileBytesAllTiles).toBe(total);
    expect(FAR_TIER_RUNTIME_BUDGETS_V3.derivation.glbBytes + FAR_TIER_RUNTIME_BUDGETS_V3.derivation.atlasBytes).toBe(total);
  });

  it("keeps v2 in place as the record of the 840-tile island", () => {
    // V2 is superseded, NOT deleted, and it still has to be true about the
    // island it described. If this drifts, the supersession has been faked.
    expect(FAR_TIER_RUNTIME_BUDGETS_V2.derivation.promotedTiles).toBe(840);
    expect(FAR_TIER_RUNTIME_BUDGETS_V2.derivation.declaredFileBytesAllTiles).toBe(258_644_848);
    expect(FAR_TIER_RUNTIME_BUDGETS_V3.supersedes.constant).toBe("FAR_TIER_RUNTIME_BUDGETS_V2");
    expect(FAR_TIER_RUNTIME_BUDGETS_V3.supersedes.declaredFileBytesAllTiles).toBe(FAR_TIER_RUNTIME_BUDGETS_V2.derivation.declaredFileBytesAllTiles);
    // The CEILING did not move. The 43 restored tiles fit in headroom v2 had.
    expect(FAR_TIER_RUNTIME_BUDGETS_V3.maxCachedBytes).toBe(FAR_TIER_RUNTIME_BUDGETS_V2.maxCachedBytes);
    expect(FAR_TIER_RUNTIME_BUDGETS_V3.supersedes.ceilingMoved).toBe(false);
  });

  it("meets the frozen GPU bar TERM BY TERM, in the bar's own unit", () => {
    // The bar's geometry term was derived with farTierGeometryGpuBytes, which
    // counts decoded vertices and indices. V2's justification substituted GLB
    // FILE bytes for it -- a looser quantity in a different unit. On 883 tiles
    // that proxy goes OVER the bar while the real measurement stays inside, so
    // the substitution is not merely conservative and is not repeated.
    const gpu = FAR_TIER_RUNTIME_BUDGETS_V3.gpuJustification;
    expect(gpu.islandAtlasGpuBytes).toBeLessThan(gpu.islandAtlasModelledBound);
    expect(gpu.islandGeometryGpuBytes).toBeLessThan(gpu.islandGeometryModelledBound);
    expect(gpu.islandAtlasGpuBytes + gpu.islandGeometryGpuBytes).toBe(gpu.islandResidentGpuBytes);
    expect(gpu.islandResidentGpuBytes).toBeLessThan(FAR_TIER_BUDGET_CONTRACT.maxResidentTotalGpuBytes);
    expect(gpu.frozenMaxResidentTotalGpuBytes).toBe(FAR_TIER_BUDGET_CONTRACT.maxResidentTotalGpuBytes);
    expect(gpu.v2ProxyCorrection.sameProxyOn883).toBeGreaterThan(FAR_TIER_BUDGET_CONTRACT.maxResidentTotalGpuBytes);
    // The margin is thin and must be stated as such, not rounded up to v2's.
    expect(gpu.marginShare).toBeLessThan(0.002);
  });

  it("admits the whole island with the stated headroom", () => {
    const total = FAR_TIER_RUNTIME_BUDGETS_V3.derivation.declaredFileBytesAllTiles;
    expect(FAR_TIER_RUNTIME_BUDGETS_V3.maxCachedBytes).toBeGreaterThan(total);
    expect(FAR_TIER_RUNTIME_BUDGETS_V3.maxCachedBytes - total).toBe(FAR_TIER_RUNTIME_BUDGETS_V3.derivation.headroomBytes);
    expect(FAR_TIER_RUNTIME_BUDGETS_V3.maxCacheEntries).toBeGreaterThanOrEqual(committed.entries.length);
  });

  it("names its unit as DECLARED FILE BYTES and refuses to be read as a GPU bar", () => {
    expect(FAR_TIER_RUNTIME_BUDGETS_V2.unit).toContain("DECLARED FILE BYTES");
    expect(FAR_TIER_RUNTIME_BUDGETS_V2.unit).toContain("NOT decoded GPU bytes");
    expect(FAR_TIER_RUNTIME_BUDGETS_V2.additiveTo).toContain("Never merged");
  });

  it("justifies the raise against the frozen GPU bar, which it stays inside", () => {
    const gpu = FAR_TIER_RUNTIME_BUDGETS_V2.gpuJustification;
    expect(gpu.islandAtlasGpuBytes + gpu.islandGeometryGpuBytesUpperBound).toBe(gpu.islandResidentGpuBytesUpperBound);
    expect(gpu.frozenMaxResidentTotalGpuBytes).toBe(FAR_TIER_BUDGET_CONTRACT.maxResidentTotalGpuBytes);
    expect(gpu.islandResidentGpuBytesUpperBound).toBeLessThan(gpu.frozenMaxResidentTotalGpuBytes);
    expect(gpu.insideFrozenBar).toBe(true);
  });

  it("supersedes v1 without deleting it, and says why v1 was wrong for this", () => {
    expect(FAR_TIER_RUNTIME_BUDGETS.maxCachedBytes).toBe(64 * 1024 * 1024);
    expect(FAR_TIER_RUNTIME_BUDGETS_V2.supersedes.maxCachedBytes).toBe(FAR_TIER_RUNTIME_BUDGETS.maxCachedBytes);
    expect(FAR_TIER_RUNTIME_BUDGETS_V2.supersedes.whySuperseded).toContain("ONE staged cell");
    // v1 could not hold the island; v2 can. That is the whole change.
    const total = FAR_TIER_RUNTIME_BUDGETS_V2.derivation.declaredFileBytesAllTiles;
    expect(FAR_TIER_RUNTIME_BUDGETS.maxCachedBytes).toBeLessThan(total);
  });

  it("discharges the eviction obligation rather than deferring it again", () => {
    expect(FAR_TIER_RUNTIME_BUDGETS_V2.evictionPolicy).toContain("NONE IS OWED");
    expect(FAR_TIER_RUNTIME_BUDGETS_V2.evictionPolicy).not.toContain("Deferred to mass-bake scale");
  });
});

describe("the failure detail cannot become a hundred-kilobyte DOM attribute", () => {
  const failing = (count: number) => Array.from({ length: count }, (_, index) => ({
    cellId: `cell:${index}`,
    state: "absent" as const,
    detail: "far-tier/cell.far_0.glb: staged bytes are absent",
  }));

  it("returns null when nothing failed", () => {
    expect(farTierFailureDetail([{ cellId: "cell:a", state: "drawn" }])).toBeNull();
  });

  it("spells out up to the limit and then summarises the rest", () => {
    const detail = farTierFailureDetail(failing(840));
    expect(detail).not.toBeNull();
    const clauses = detail!.split(" | ");
    expect(clauses).toHaveLength(FAR_TIER_FAILURE_DETAIL_LIMIT + 1);
    expect(clauses[clauses.length - 1]).toContain(`+${840 - FAR_TIER_FAILURE_DETAIL_LIMIT} more of 840 failing cells`);
    // Small enough to read, and bounded no matter how bad the stage is.
    expect(detail!.length).toBeLessThan(2_000);
  });

  it("does not summarise when it does not have to", () => {
    const detail = farTierFailureDetail(failing(3));
    expect(detail).not.toContain("more of");
    expect(detail!.split(" | ")).toHaveLength(3);
  });
});
