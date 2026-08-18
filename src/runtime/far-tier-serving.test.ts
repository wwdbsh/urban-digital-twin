import { describe, expect, it } from "vitest";
import { sha256HexBytes } from "../domain/deterministic-hash";
import { EXTERIOR_RUNTIME_BUDGETS } from "./exterior-cell-runtime";
import { FAR_TIER_BUDGET_CONTRACT } from "../release/far-tier-budget";
import {
  farTierAtlasRef, farTierFailureDetail, farTierStatusLine, farTierSuppressibleBuildingIds, farTierTileRef,
  FAR_TIER_CELL_STATES, FAR_TIER_RUNTIME_BUDGETS, loadVerifiedFarTierTile, summarizeFarTierState,
  type FarTierInventoryEntry,
} from "./far-tier-serving";

const CELL = "manhattan-exterior-cell-w05-000747-17-38610-35822";

/** A synthetic tile: real bytes, real digest, so verification is genuine. */
function syntheticEntry(bytes: Uint8Array, members?: FarTierInventoryEntry["members"]): FarTierInventoryEntry {
  return {
    cellId: CELL,
    glbSha256: sha256HexBytes(bytes),
    glbByteSize: bytes.byteLength,
    atlasSha256: sha256HexBytes(new Uint8Array([1, 2, 3])),
    atlasByteSize: 3,
    members: members ?? [{ buildingId: "doitt:778052", included: true }, { buildingId: "doitt:982383", included: true }],
  };
}

const TILE_BYTES = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00]);

describe("far-tier serving layout", () => {
  it("serves from its own root, not a release audience/kind path", () => {
    // Extending ExteriorArtifactKind would change on-disk layout and every
    // declared checksum of releases that are already immutable.
    expect(farTierTileRef(CELL)).toBe(`far-tier/${CELL}.far_0.glb`);
    expect(farTierAtlasRef(CELL)).toBe(`far-tier/${CELL}.atlas.png`);
    expect(farTierTileRef(CELL)).not.toMatch(/^(public|private)\//u);
  });
});

describe("criterion #30 isolation", () => {
  it("keeps far-tier bytes out of the closed exterior cache budget", () => {
    // The NO-GO condition. The far tier carries its own ceiling; the two are
    // ADDED when a total is needed, never merged.
    expect(EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes).toBe(256 * 1024 * 1024);
    expect(EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries).toBe(1_024);
    expect(EXTERIOR_RUNTIME_BUDGETS.maxConcurrentRequests).toBe(4);
    // Far tier's own cap is a DIFFERENT object with DIFFERENT numbers.
    expect(FAR_TIER_RUNTIME_BUDGETS.maxCachedBytes).not.toBe(EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes);
    expect(FAR_TIER_RUNTIME_BUDGETS.maxCacheEntries).not.toBe(EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries);
    expect(FAR_TIER_RUNTIME_BUDGETS.additiveTo).toContain("criterion #30");
    expect(FAR_TIER_RUNTIME_BUDGETS.additiveTo).toContain("Never merged");
  });

  it("does not widen the frozen far-tier budget contract either", () => {
    // B3-B5 bound one selected cut; a retained cache is additive to them, which
    // is exactly what FAR_TIER_BOUND_EXCLUSIONS already records.
    expect(FAR_TIER_BUDGET_CONTRACT.maxResidentTotalGpuBytes).toBe(390_295_058);
    expect(FAR_TIER_RUNTIME_BUDGETS.maxCachedBytes).toBeLessThan(FAR_TIER_BUDGET_CONTRACT.maxResidentTotalGpuBytes);
  });
});

describe("loadVerifiedFarTierTile", () => {
  it("accepts bytes that match the declaration", async () => {
    const entry = syntheticEntry(TILE_BYTES);
    const { outcome, bytes } = await loadVerifiedFarTierTile(entry, async () => TILE_BYTES);
    expect(outcome.state).toBe("declared");
    expect(bytes).toEqual(TILE_BYTES);
  });

  it("reports a missing tile as ABSENT", async () => {
    const entry = syntheticEntry(TILE_BYTES);
    const { outcome, bytes } = await loadVerifiedFarTierTile(entry, async () => { throw new Error("404"); });
    expect(outcome.state).toBe("absent");
    expect(bytes).toBeUndefined();
  });

  it("reports corrupted bytes as CHECKSUM-MISMATCH, never as absent", async () => {
    // THE NO-GO CONDITION. Absence is a staging gap and is ordinary. A mismatch
    // is an integrity failure: bytes exist and are not the declared bytes.
    // Collapsing the second into the first would turn the loudest signal this
    // path can produce into routine background noise.
    const entry = syntheticEntry(TILE_BYTES);
    const corrupted = new Uint8Array(TILE_BYTES);
    corrupted[0] = corrupted[0]! ^ 0xff;
    const { outcome, bytes } = await loadVerifiedFarTierTile(entry, async () => corrupted);
    expect(outcome.state).toBe("checksum-mismatch");
    expect(outcome.state).not.toBe("absent");
    expect(bytes).toBeUndefined();
    expect(outcome.detail).toContain("SHA-256");
  });

  it("names a truncated response for what it is, before hashing it", async () => {
    const entry = syntheticEntry(TILE_BYTES);
    const { outcome } = await loadVerifiedFarTierTile(entry, async () => TILE_BYTES.slice(0, 4));
    expect(outcome.state).toBe("checksum-mismatch");
    expect(outcome.detail).toContain("4 bytes");
  });
});

describe("suppression is by member building id", () => {
  it("suppresses only the buildings the tile actually contains", () => {
    // A V3-refused building keeps its massing and keeps its refusal panel entry.
    // Suppressing per CELL would erase those refusals and make the panel
    // describe buildings the user can no longer see.
    const entry = syntheticEntry(TILE_BYTES, [
      { buildingId: "doitt:778052", included: true },
      { buildingId: "doitt:tombstoned", included: false },
      { buildingId: "doitt:982383", included: true },
    ]);
    expect(farTierSuppressibleBuildingIds(entry)).toEqual(["doitt:778052", "doitt:982383"]);
    expect(farTierSuppressibleBuildingIds(entry)).not.toContain("doitt:tombstoned");
  });

  it("suppresses nothing when the bake refused every member", () => {
    const entry = syntheticEntry(TILE_BYTES, [{ buildingId: "doitt:tombstoned", included: false }]);
    expect(farTierSuppressibleBuildingIds(entry)).toEqual([]);
  });
});

describe("aggregate state", () => {
  it("has five states, and mismatch is its own", () => {
    expect([...FAR_TIER_CELL_STATES]).toEqual(["declared", "drawn", "not-declared", "absent", "checksum-mismatch"]);
  });

  it("counts checksum mismatches in their own column", () => {
    const summary = summarizeFarTierState([
      { cellId: "a", state: "drawn" },
      { cellId: "b", state: "absent", detail: "gone" },
      { cellId: "c", state: "checksum-mismatch", detail: "bad digest" },
      { cellId: "d", state: "checksum-mismatch", detail: "bad digest" },
    ]);
    expect(summary.absent).toBe(1);
    expect(summary.checksumMismatch).toBe(2);
  });

  it("renders ONE line, not one per cell", () => {
    const line = farTierStatusLine(summarizeFarTierState([
      { cellId: "a", state: "drawn" },
      { cellId: "b", state: "absent", detail: "gone" },
      { cellId: "c", state: "checksum-mismatch", detail: "bad" },
    ]));
    expect(line.split("\n")).toHaveLength(1);
    expect(line).toContain("1 drawn");
    expect(line).toContain("1 absent");
    // Named distinctly so it does not read as another kind of absence.
    expect(line).toContain("checksum-mismatch");
    expect(line).toContain("fail-closed");
  });

  it("says nothing about absence or mismatch when there is none", () => {
    const line = farTierStatusLine(summarizeFarTierState([{ cellId: "a", state: "drawn" }]));
    expect(line).not.toContain("absent");
    expect(line).not.toContain("checksum-mismatch");
  });

  it("puts per-cell detail in the dataset string, absent when nothing failed", () => {
    // Mirrors the data-exterior-verified-resource-failures idiom: the attribute
    // is deleted rather than emptied, so an ordinary session's DOM is unchanged.
    expect(farTierFailureDetail([{ cellId: "a", state: "drawn" }])).toBeNull();
    const detail = farTierFailureDetail([
      { cellId: "a", state: "absent", detail: "no bytes" },
      { cellId: "b", state: "checksum-mismatch", detail: "bad digest" },
    ]);
    expect(detail).toBe("a: absent: no bytes | b: checksum-mismatch: bad digest");
  });
});
