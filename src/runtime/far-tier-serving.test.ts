import { describe, expect, it } from "vitest";
import { sha256HexBytes } from "../domain/deterministic-hash";
import { EXTERIOR_RUNTIME_BUDGETS } from "./exterior-cell-runtime";
import { FAR_TIER_BUDGET_CONTRACT } from "../release/far-tier-budget";
import {
  createFarTierFetcher, farTierAdmission, farTierAtlasRef, farTierEntryByteCost, farTierFailureDetail,
  farTierStatusLine, farTierSuppressibleBuildingIds, farTierTileRef, parseVerifiedFarTierInventory,
  FAR_TIER_CELL_STATES, FAR_TIER_PAYLOAD_INVENTORY_SHA256, FAR_TIER_RUNTIME_BUDGETS,
  loadVerifiedFarTierAtlas, loadVerifiedFarTierTile, summarizeFarTierState,
  type FarTierHttpResponse, type FarTierInventoryEntry,
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

describe("the far tier's ceiling is enforced, not merely declared", () => {
  const budgets = { maxCacheEntries: 3, maxCachedBytes: 1_000 };

  it("admits a cell that fits, and says so with no message", () => {
    expect(farTierAdmission({ entries: 1, bytes: 400 }, 600, budgets)).toBeNull();
  });

  it("REFUSES a cell that would take the resident bytes past the ceiling", () => {
    // The finding this replaces: `FAR_TIER_RUNTIME_BUDGETS` had zero non-test
    // consumers, so two tests green-lit a constant nothing enforced while the
    // runtime record described "its own accounting". A budget with no admission
    // decision is a comment.
    const refusal = farTierAdmission({ entries: 1, bytes: 400 }, 601, budgets);
    expect(refusal).toContain("would exceed the far-tier ceiling of 1000 bytes");
  });

  it("refuses on the entry ceiling independently of bytes", () => {
    expect(farTierAdmission({ entries: 3, bytes: 0 }, 1, budgets)).toContain("far-tier ceiling is 3");
  });

  it("charges GLB and atlas bytes alike, because both are resident", () => {
    const entry = syntheticEntry(TILE_BYTES);
    expect(farTierEntryByteCost(entry)).toBe(entry.glbByteSize + entry.atlasByteSize);
  });

  it("records that it has NO eviction policy rather than implying one", () => {
    // A ceiling with refusal and no eviction is a real, bounded design. Calling
    // it a cache with an eviction policy it does not have would not be.
    expect(FAR_TIER_RUNTIME_BUDGETS.evictionPolicy).toContain("NONE");
    expect(FAR_TIER_RUNTIME_BUDGETS.evictionPolicy).toContain("refused rather than evicted");
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

describe("loadVerifiedFarTierAtlas", () => {
  const ATLAS_BYTES = new Uint8Array([1, 2, 3]);

  it("returns the bytes when they match the declaration", async () => {
    const { outcome, bytes } = await loadVerifiedFarTierAtlas(syntheticEntry(TILE_BYTES), async () => ATLAS_BYTES);
    expect(outcome).toBeUndefined();
    expect(bytes).toEqual(ATLAS_BYTES);
  });

  it("FAILS CLOSED when the atlas bytes are not the declared bytes", async () => {
    // Never texture from unverified bytes. The atlas carries the whole visible
    // point of this tier, and its digest is declared in the same inventory
    // entry as the geometry's.
    const flipped = new Uint8Array([1, 2, 4]);
    const { outcome, bytes } = await loadVerifiedFarTierAtlas(syntheticEntry(TILE_BYTES), async () => flipped);
    expect(outcome?.state).toBe("checksum-mismatch");
    expect(outcome?.detail).toContain(".atlas.png");
    expect(bytes).toBeUndefined();
  });

  it("treats an atlas that cannot be fetched as absence, not as mismatch", async () => {
    const { outcome, bytes } = await loadVerifiedFarTierAtlas(syntheticEntry(TILE_BYTES), async () => { throw new Error("404"); });
    expect(outcome).toBeUndefined();
    expect(bytes).toBeUndefined();
  });
});

describe("createFarTierFetcher", () => {
  const response = (overrides: Partial<FarTierHttpResponse> & { contentType?: string; body?: Uint8Array }): FarTierHttpResponse => ({
    ok: overrides.ok ?? true,
    status: overrides.status ?? 200,
    statusText: overrides.statusText ?? "OK",
    headers: { get: () => overrides.contentType ?? "model/gltf-binary" },
    arrayBuffer: async () => (overrides.body ?? TILE_BYTES).buffer as ArrayBuffer,
  });

  it("REFUSES a single-page-app shell served at an artifact path", async () => {
    // MEASURED, NOT HYPOTHESISED: the dev server answers 200 with the
    // application shell for a path that does not exist, and those 691 bytes
    // reached the digest check and were reported as CHECKSUM-MISMATCH — a
    // staging gap wearing the costume of an integrity failure. This refusal is
    // what makes the state vocabulary keep meaning what it says, and it now
    // lives where a test can reach it rather than inside a viewport closure.
    const fetcher = createFarTierFetcher(async () => response({ contentType: "text/html; charset=utf-8" }));
    await expect(fetcher("far-tier/x.far_0.glb")).rejects.toThrow("application shell");
  });

  it("passes an artifact content-type straight through", async () => {
    const fetcher = createFarTierFetcher(async () => response({}));
    expect(await fetcher("far-tier/x.far_0.glb")).toEqual(TILE_BYTES);
  });

  it("reports a non-OK status as the failure it is", async () => {
    const fetcher = createFarTierFetcher(async () => response({ ok: false, status: 404, statusText: "Not Found" }));
    await expect(fetcher("far-tier/x.far_0.glb")).rejects.toThrow("404 Not Found");
  });

  it("asks for the path under the served root, with one leading slash", async () => {
    const asked: string[] = [];
    const fetcher = createFarTierFetcher(async (url) => { asked.push(url); return response({}); });
    await fetcher("far-tier/x.far_0.glb");
    expect(asked).toEqual(["/far-tier/x.far_0.glb"]);
  });
});

describe("the staged inventory is a cache of the committed one", () => {
  it("refuses a staged inventory that is not the committed text", () => {
    // Without this pin, a swapped staged file declares its own checksums and
    // every per-tile verification below faithfully confirms them.
    expect(() => parseVerifiedFarTierInventory('{"inventoryId":"forged","entries":[]}')).toThrow("is not the committed");
  });

  it("names the digest it expected, so the failure is diagnosable", () => {
    expect(() => parseVerifiedFarTierInventory("{}")).toThrow(FAR_TIER_PAYLOAD_INVENTORY_SHA256);
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
  it("keeps every class in its own name; mismatch, build-failure and near are three things", () => {
    expect([...FAR_TIER_CELL_STATES]).toEqual(["declared", "drawn", "near", "not-declared", "absent", "checksum-mismatch", "build-failure", "over-budget"]);
  });

  it("counts a near cell as declared, and never as a failure", () => {
    // A tile the camera is too close to draw is the tier working, not a fault.
    // Folding it into absent or mismatch would make an ordinary close-up
    // session look like a broken far tier.
    const summary = summarizeFarTierState([
      { cellId: "a", state: "drawn" },
      { cellId: "b", state: "near" },
      { cellId: "c", state: "near" },
    ]);
    expect(summary.drawn).toBe(1);
    expect(summary.near).toBe(2);
    expect(summary.declared).toBe(3);
    expect(summary.absent).toBe(0);
    expect(summary.checksumMismatch).toBe(0);
  });

  it("counts DECLARED as the inventory's own count, not as drawn plus near", () => {
    // It used to read "declared" and mean "verified", and under distance-bounded
    // loading it would have meant neither: a near cell is now a cell that was
    // never fetched. Every other column is a partition of this one.
    const summary = summarizeFarTierState([
      { cellId: "a", state: "drawn" },
      { cellId: "b", state: "near" },
      { cellId: "c", state: "absent", detail: "gone" },
      { cellId: "d", state: "checksum-mismatch", detail: "bad" },
      { cellId: "e", state: "build-failure", detail: "would not build" },
      { cellId: "f", state: "over-budget", detail: "refused" },
      { cellId: "g", state: "not-declared", detail: "no anchor" },
    ]);
    expect(summary.declared).toBe(7);
    expect(summary.drawn + summary.near + summary.absent + summary.checksumMismatch + summary.buildFailure + summary.overBudget + summary.notDeclared).toBe(summary.declared);
  });

  it("gives build-failure and over-budget their own columns and their own words", () => {
    const line = farTierStatusLine(summarizeFarTierState([
      { cellId: "a", state: "build-failure", detail: "would not build" },
      { cellId: "b", state: "over-budget", detail: "refused" },
      { cellId: "c", state: "checksum-mismatch", detail: "bad" },
    ]));
    expect(line).toContain("1 build-failure (fail-closed, drawing massing)");
    expect(line).toContain("1 over-budget (refused, drawing massing)");
    expect(line).toContain("1 checksum-mismatch (fail-closed, drawing massing)");
    // Still ONE line, however many classes are in play.
    expect(line.split("\n")).toHaveLength(1);
  });

  it("explains a build-failure and a refusal per cell, not only in the aggregate", () => {
    const detail = farTierFailureDetail([
      { cellId: "a", state: "build-failure", detail: "verified bytes did not build a model" },
      { cellId: "b", state: "over-budget", detail: "refused: ceiling" },
    ]);
    expect(detail).toBe("a: build-failure: verified bytes did not build a model | b: over-budget: refused: ceiling");
  });

  it("names the near count for what the user is looking at", () => {
    const line = farTierStatusLine(summarizeFarTierState([{ cellId: "a", state: "near" }]));
    expect(line).toContain("1 near (massing drawing)");
    expect(line).not.toContain("absent");
    expect(line).not.toContain("checksum-mismatch");
  });

  it("keeps a near cell out of the per-cell failure detail", () => {
    expect(farTierFailureDetail([{ cellId: "a", state: "near" }])).toBeNull();
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
