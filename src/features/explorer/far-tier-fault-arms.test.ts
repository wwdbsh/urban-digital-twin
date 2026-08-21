/**
 * The promotion's fault arms, at island scale.
 *
 * T003 armed four faults against ONE staged cell. Two of its conclusions do not
 * transfer without being re-armed: "the whole tier fails closed" was observed
 * where the whole tier was one cell, and "one bad cell does not cascade" was
 * observed where there was nothing to cascade INTO. Both are re-armed here
 * against 840, plus the two arms promotion adds — a stale pin and a partial
 * stage.
 *
 * These exercise the REAL code paths: `parseVerifiedFarTierInventory` is the
 * function the runtime calls, and the residency below is the residency the
 * viewport builds. Nothing here is a mock of the thing under test.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { sha256HexBytes } from "../../domain/deterministic-hash";
import { createFarTierResidency, type FarTierPrimitive } from "./far-tier-layer";
import {
  FAR_TIER_PAYLOAD_INVENTORY_SHA256,
  farTierAtlasRef,
  farTierTileRef,
  parseVerifiedFarTierInventory,
  type FarTierInventory,
  type FarTierInventoryEntry,
} from "../../runtime/far-tier-serving";
import { farTierTileAnchor } from "../../runtime/far-tier-anchor";

const readText = (path: string): string => new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
const PROMOTED = readText("data/far-tier-hlod-promotion-20260819/promoted-inventory.json");
const STALE_ONE_CELL = readText("data/far-tier-hlod-runtime-20260818/payload-inventory.json");

const TILE_BYTES = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00]);
const ATLAS_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

function fakeScene() {
  const added: FarTierPrimitive[] = [];
  const removed: FarTierPrimitive[] = [];
  return {
    added, removed,
    resident: () => added.filter((primitive) => !removed.includes(primitive)),
    primitives: {
      add: (primitive: unknown) => { added.push(primitive as FarTierPrimitive); return primitive; },
      remove: (primitive: unknown) => { removed.push(primitive as FarTierPrimitive); return true; },
    },
  };
}

/**
 * An island-sized inventory of anchorable cells with synthetic bytes.
 *
 * The REAL 840 payloads are 246 MiB and their digests are verified by the stage
 * CLI against the same committed inventory this file reads; loading them here
 * would prove the same thing again, slowly. What this fixture is for is the
 * SCALE property — that one bad cell among many does not take the others down —
 * and that property is about the residency's control flow, not about bytes.
 */
function islandFixture(count: number): { entries: FarTierInventoryEntry[]; bytes: Record<string, Uint8Array> } {
  const entries: FarTierInventoryEntry[] = [];
  const bytes: Record<string, Uint8Array> = {};
  let emitted = 0;
  for (let index = 0; emitted < count && index < count * 4; index += 1) {
    const cellId = `manhattan-exterior-cell-w05-${String(index).padStart(6, "0")}-17-${38_500 + (index % 200)}-${35_800 + Math.floor(index / 200)}`;
    try { farTierTileAnchor(cellId); } catch { continue; }
    entries.push({
      cellId,
      glbSha256: sha256HexBytes(TILE_BYTES), glbByteSize: TILE_BYTES.byteLength,
      atlasSha256: sha256HexBytes(ATLAS_BYTES), atlasByteSize: ATLAS_BYTES.byteLength,
      members: [{ buildingId: `doitt:${index}`, included: true }],
    });
    bytes[farTierTileRef(cellId)] = TILE_BYTES;
    bytes[farTierAtlasRef(cellId)] = ATLAS_BYTES;
    emitted += 1;
  }
  return { entries, bytes };
}

const fetcherFor = (bytes: Record<string, Uint8Array>) => async (ref: string): Promise<Uint8Array> => {
  const found = bytes[ref];
  if (!found) throw new Error(`404 ${ref}`);
  return found;
};

const poseOver = (cellId: string, heightMeters: number) => {
  const bounds = farTierTileAnchor(cellId).bounds;
  return { longitude: (bounds.west + bounds.east) / 2, latitude: (bounds.south + bounds.north) / 2, heightMeters };
};

describe("ARM 1 — a stale pin takes the whole tier down, not one cell", () => {
  it("refuses the superseded one-cell inventory that the promotion replaced", () => {
    // The realistic operator error: a serving root left over from T003. The
    // bytes are perfectly valid and internally consistent — they are simply not
    // the inventory this build declares.
    expect(() => parseVerifiedFarTierInventory(STALE_ONE_CELL)).toThrow(/is not the committed/u);
    expect(() => parseVerifiedFarTierInventory(STALE_ONE_CELL)).toThrow(/payload-inventory\.json/u);
  });

  it("accepts the promoted inventory, so the refusal above is about the pin and not the parser", () => {
    const inventory = parseVerifiedFarTierInventory(PROMOTED) as FarTierInventory;
    expect(inventory.entries).toHaveLength(840);
    expect(sha256HexBytes(new TextEncoder().encode(PROMOTED))).toBe(FAR_TIER_PAYLOAD_INVENTORY_SHA256);
  });

  it("refuses a ONE-CHARACTER edit of the promoted inventory", () => {
    // The failure mode a shared serializer exists to prevent: a re-serialized
    // staged copy that means the same thing and hashes differently.
    const reindented = `${JSON.stringify(JSON.parse(PROMOTED), null, 2)}\n`;
    expect(reindented).not.toBe(PROMOTED);
    expect(() => parseVerifiedFarTierInventory(reindented)).toThrow(/is not the committed/u);
  });
});

describe("ARM 2 — a partial stage costs exactly the cells that are missing", () => {
  it("reports exactly one absent cell among 840, and draws the rest", async () => {
    const { entries, bytes } = islandFixture(840);
    expect(entries).toHaveLength(840);
    // Exactly one tile missing from the staged tree: 839 of 840.
    const missing = entries[400]!.cellId;
    delete bytes[farTierTileRef(missing)];

    const residency = createFarTierResidency({
      scene: fakeScene(), entries, fetcher: fetcherFor(bytes),
      modelFactory: async () => ({ show: true, ready: true }),
      budgets: { maxCacheEntries: 1_024, maxCachedBytes: 1_000_000_000 },
    });
    await residency.reconcile(poseOver(entries[0]!.cellId, 40_000));

    const absent = residency.outcomes().filter((outcome) => outcome.state === "absent");
    expect(absent.map((outcome) => outcome.cellId)).toEqual([missing]);
    // NO CASCADE: every other selected cell drew.
    expect(residency.tiles()).toHaveLength(839);
    for (const state of ["checksum-mismatch", "build-failure", "over-budget"]) {
      expect(residency.outcomes().filter((outcome) => outcome.state === state)).toHaveLength(0);
    }
  });
});

describe("ARM 3 — the ceiling admits the island, so nothing is refused for budget", () => {
  it("draws all 840 under the promoted ceilings", async () => {
    const { entries, bytes } = islandFixture(840);
    const residency = createFarTierResidency({
      scene: fakeScene(), entries, fetcher: fetcherFor(bytes),
      modelFactory: async () => ({ show: true, ready: true }),
      // The DEFAULT budgets — the point of the arm is that the shipped ceiling
      // is the one that admits the island.
    });
    await residency.reconcile(poseOver(entries[0]!.cellId, 40_000));
    expect(residency.tiles()).toHaveLength(840);
    expect(residency.outcomes().filter((outcome) => outcome.state === "over-budget")).toHaveLength(0);
  });
});

describe("ARM 4 — the T003 per-cell arms still fail closed at scale", () => {
  it("keeps a mismatched tile, an unbuildable tile and a missing atlas to their own cells", async () => {
    const { entries, bytes } = islandFixture(60);
    const mismatched = entries[10]!.cellId;
    const unbuildable = entries[20]!.cellId;
    const atlasless = entries[30]!.cellId;
    bytes[farTierTileRef(mismatched)] = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x01]);
    delete bytes[farTierAtlasRef(atlasless)];

    const residency = createFarTierResidency({
      scene: fakeScene(), entries, fetcher: fetcherFor(bytes),
      modelFactory: async (options: { url: string }) => {
        if (options.url.includes(unbuildable)) throw new Error("synthetic build failure");
        return { show: true, ready: true };
      },
      budgets: { maxCacheEntries: 1_024, maxCachedBytes: 1_000_000_000 },
    });
    await residency.reconcile(poseOver(entries[0]!.cellId, 40_000));

    const byState = (state: string) => residency.outcomes().filter((outcome) => outcome.state === state).map((outcome) => outcome.cellId);
    expect(byState("checksum-mismatch")).toEqual([mismatched]);
    expect(byState("build-failure")).toEqual([unbuildable]);
    // A missing atlas is NOT a mismatch and does not fail its tile: the tile
    // draws untextured. That distinction is T003's and it still holds.
    expect(byState("checksum-mismatch")).not.toContain(atlasless);
    expect(residency.tiles().map((tile) => tile.cellId)).toContain(atlasless);
    // 60 selected, 2 failed, 58 drawn. One bad cell costs one cell.
    expect(residency.tiles()).toHaveLength(58);
  });
});
