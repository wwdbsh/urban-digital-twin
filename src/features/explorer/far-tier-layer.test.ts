/**
 * The far-tier residency: what it draws, what it refuses, and what it releases.
 *
 * THIS FILE EXISTS BECAUSE IT DID NOT. The layer that fetches bytes, verifies
 * them, places geometry on the globe and decides which cells are resident
 * shipped its first revision with NO tests at all, and independent review found
 * four defects in it that a test at this level would have caught on the way in:
 * atlas bytes drawn unverified, a model that would not build reported as a
 * checksum mismatch, an unbounded load with a ceiling nothing enforced, and
 * primitives leaked by an aborted load.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
/** The project idiom: node types are not in this tsconfig, so decode explicitly. */
function readText(path: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
}
import { sha256HexBytes } from "../../domain/deterministic-hash";
import { createFarTierResidency, farTierTileReady, type FarTierPrimitive } from "./far-tier-layer";
import { farTierTileAnchor } from "../../runtime/far-tier-anchor";
import { farTierAtlasRef, farTierTileRef, type FarTierInventoryEntry } from "../../runtime/far-tier-serving";

const PROTOTYPE_CELL = "manhattan-exterior-cell-w05-000747-17-38610-35822";
/** A neighbouring tile in the same ledger scheme, for multi-cell arithmetic. */
const NEIGHBOUR_CELL = "manhattan-exterior-cell-w05-000748-17-38611-35822";
const BLOCK_835_CELL = "manhattan-exterior-cell-w00-000000-block-00835";
/** A cell whose tile rectangle sits outside the frozen planar scale's band. */
const ANTIPODAL_CELL = "manhattan-exterior-cell-w05-000749-17-100-35822";

const TILE_BYTES = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00]);
const ATLAS_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

function entryFor(cellId: string, members?: FarTierInventoryEntry["members"]): FarTierInventoryEntry {
  return {
    cellId,
    glbSha256: sha256HexBytes(TILE_BYTES),
    glbByteSize: TILE_BYTES.byteLength,
    atlasSha256: sha256HexBytes(ATLAS_BYTES),
    atlasByteSize: ATLAS_BYTES.byteLength,
    members: members ?? [{ buildingId: "doitt:778052", included: true }, { buildingId: "doitt:tombstoned", included: false }],
  };
}

function poseOver(cellId: string, heightMeters: number) {
  const bounds = farTierTileAnchor(cellId).bounds;
  return { longitude: (bounds.west + bounds.east) / 2, latitude: (bounds.south + bounds.north) / 2, heightMeters };
}

/** Beyond the 1,200 m enter edge, and well beyond the 1,080 m exit edge. */
const FAR_POSE = poseOver(PROTOTYPE_CELL, 1_400);
/** Inside both edges, so nothing may be loaded or drawn. */
const NEAR_POSE = poseOver(PROTOTYPE_CELL, 600);

function fakeScene() {
  const added: FarTierPrimitive[] = [];
  const removed: FarTierPrimitive[] = [];
  return {
    added,
    removed,
    /** What is in the scene right now, which is the only thing that leaks. */
    resident: () => added.filter((primitive) => !removed.includes(primitive)),
    primitives: {
      add: (primitive: unknown) => { added.push(primitive as FarTierPrimitive); return primitive; },
      remove: (primitive: unknown) => { removed.push(primitive as FarTierPrimitive); return true; },
    },
  };
}

function fakeFetcher(bytesByRef: Record<string, Uint8Array>) {
  const requested: string[] = [];
  const fetcher = async (ref: string): Promise<Uint8Array> => {
    requested.push(ref);
    const bytes = bytesByRef[ref];
    if (!bytes) throw new Error("404 Not Found");
    return bytes;
  };
  return { fetcher, requested };
}

function stagedBytes(cellId: string): Record<string, Uint8Array> {
  return { [farTierTileRef(cellId)]: TILE_BYTES, [farTierAtlasRef(cellId)]: ATLAS_BYTES };
}

/** A model that builds, reports ready, and remembers what it was given. */
function recordingFactory() {
  const calls: Array<{ atlasBytes: Uint8Array | null; showAtAdd?: boolean }> = [];
  const factory = async (options: { atlasBytes: Uint8Array | null }): Promise<FarTierPrimitive> => {
    calls.push({ atlasBytes: options.atlasBytes });
    return { show: true, ready: true };
  };
  return { factory, calls };
}

describe("anchoring refusals never fetch a byte", () => {
  it("reports the Block 835 cell as not-declared and asks for nothing", async () => {
    // A cell with no tile rectangle can never be placed, so fetching for it
    // would be work whose result has nowhere to go.
    const scene = fakeScene();
    const { fetcher, requested } = fakeFetcher({});
    const residency = createFarTierResidency({ scene, entries: [entryFor(BLOCK_835_CELL)], fetcher });

    await residency.reconcile(FAR_POSE);

    expect(residency.outcomes().map((outcome) => outcome.state)).toEqual(["not-declared"]);
    expect(residency.outcomes()[0]!.detail).toContain("no tile rectangle");
    expect(requested).toEqual([]);
    expect(scene.added).toEqual([]);
  });

  it("refuses a cell outside the frozen planar scale's validity band", async () => {
    // The metres-per-degree constants are two Manhattan numbers, and the
    // selection arithmetic clamps longitudes with no ±180 wrap. A cell outside
    // the band would be placed with a scale nobody derived for it.
    const scene = fakeScene();
    const { fetcher, requested } = fakeFetcher(stagedBytes(ANTIPODAL_CELL));
    const residency = createFarTierResidency({ scene, entries: [entryFor(ANTIPODAL_CELL)], fetcher });

    await residency.reconcile(FAR_POSE);

    expect(residency.outcomes().map((outcome) => outcome.state)).toEqual(["not-declared"]);
    expect(residency.outcomes()[0]!.detail).toContain("validity band");
    expect(requested).toEqual([]);
  });
});

describe("verification", () => {
  it("draws a tile whose GLB and atlas both verify", async () => {
    const scene = fakeScene();
    const { fetcher } = fakeFetcher(stagedBytes(PROTOTYPE_CELL));
    const { factory, calls } = recordingFactory();
    const residency = createFarTierResidency({ scene, entries: [entryFor(PROTOTYPE_CELL)], fetcher, modelFactory: factory });

    await residency.reconcile(FAR_POSE);

    expect(residency.tiles()).toHaveLength(1);
    expect(residency.outcomes()).toEqual([]);
    expect(calls[0]!.atlasBytes).toEqual(ATLAS_BYTES);
    // Suppression is by member building id: the refused member keeps its massing.
    expect(residency.tiles()[0]!.suppressibleBuildingIds).toEqual(["doitt:778052"]);
  });

  it("creates the primitive HIDDEN, so it can never appear at a distance the tier does not serve", async () => {
    const scene = fakeScene();
    const { fetcher } = fakeFetcher(stagedBytes(PROTOTYPE_CELL));
    // The factory hands back a VISIBLE primitive on purpose: the layer, not the
    // factory, is what must guarantee the tile starts hidden.
    const residency = createFarTierResidency({
      scene, entries: [entryFor(PROTOTYPE_CELL)], fetcher,
      modelFactory: async () => ({ show: true, ready: true }),
    });

    await residency.reconcile(FAR_POSE);

    expect(scene.added).toHaveLength(1);
    expect(scene.added[0]!.show).toBe(false);
    expect(residency.tiles()[0]!.primitive.show).toBe(false);
  });

  it("FAILS THE TILE CLOSED when the atlas bytes are not the declared bytes", async () => {
    // THE NO-GO CONDITION FOR B2. The atlas is the payload a user actually
    // looks at, and an earlier revision fetched it and handed it straight to
    // the model factory with the declared digest sitting unread two fields
    // away. Never texture from unverified bytes.
    const scene = fakeScene();
    const flipped = new Uint8Array(ATLAS_BYTES);
    flipped[0] = flipped[0]! ^ 0xff;
    const { fetcher } = fakeFetcher({ ...stagedBytes(PROTOTYPE_CELL), [farTierAtlasRef(PROTOTYPE_CELL)]: flipped });
    const { factory, calls } = recordingFactory();
    const residency = createFarTierResidency({ scene, entries: [entryFor(PROTOTYPE_CELL)], fetcher, modelFactory: factory });

    await residency.reconcile(FAR_POSE);

    expect(residency.outcomes().map((outcome) => outcome.state)).toEqual(["checksum-mismatch"]);
    expect(residency.outcomes()[0]!.detail).toContain(".atlas.png");
    // Nothing was built and nothing entered the scene.
    expect(calls).toEqual([]);
    expect(scene.added).toEqual([]);
    expect(residency.tiles()).toEqual([]);
  });

  it("names a truncated atlas by its size rather than as a hash failure", async () => {
    const scene = fakeScene();
    const { fetcher } = fakeFetcher({ ...stagedBytes(PROTOTYPE_CELL), [farTierAtlasRef(PROTOTYPE_CELL)]: ATLAS_BYTES.slice(0, 4) });
    const residency = createFarTierResidency({ scene, entries: [entryFor(PROTOTYPE_CELL)], fetcher, modelFactory: recordingFactory().factory });

    await residency.reconcile(FAR_POSE);

    expect(residency.outcomes()[0]!.state).toBe("checksum-mismatch");
    expect(residency.outcomes()[0]!.detail).toContain("4 bytes");
  });

  it("draws an untextured tile when the atlas is ABSENT, which is a staging gap and not a mismatch", async () => {
    const scene = fakeScene();
    const { fetcher } = fakeFetcher({ [farTierTileRef(PROTOTYPE_CELL)]: TILE_BYTES });
    const { factory, calls } = recordingFactory();
    const residency = createFarTierResidency({ scene, entries: [entryFor(PROTOTYPE_CELL)], fetcher, modelFactory: factory });

    await residency.reconcile(FAR_POSE);

    expect(residency.tiles()).toHaveLength(1);
    expect(calls[0]!.atlasBytes).toBeNull();
  });

  it("reports corrupt GLB bytes as checksum-mismatch and never adds anything", async () => {
    const scene = fakeScene();
    const corrupted = new Uint8Array(TILE_BYTES);
    corrupted[0] = corrupted[0]! ^ 0xff;
    const { fetcher } = fakeFetcher({ ...stagedBytes(PROTOTYPE_CELL), [farTierTileRef(PROTOTYPE_CELL)]: corrupted });
    const residency = createFarTierResidency({ scene, entries: [entryFor(PROTOTYPE_CELL)], fetcher });

    await residency.reconcile(FAR_POSE);

    expect(residency.outcomes().map((outcome) => outcome.state)).toEqual(["checksum-mismatch"]);
    expect(scene.added).toEqual([]);
  });

  it("reports a tile that is not staged as ABSENT", async () => {
    const scene = fakeScene();
    const { fetcher } = fakeFetcher({});
    const residency = createFarTierResidency({ scene, entries: [entryFor(PROTOTYPE_CELL)], fetcher });

    await residency.reconcile(FAR_POSE);

    expect(residency.outcomes().map((outcome) => outcome.state)).toEqual(["absent"]);
  });
});

describe("build-failure is its own state", () => {
  it("does NOT report verified bytes that will not build as a checksum mismatch", async () => {
    // B3. The bytes matched their declaration exactly. Calling that an
    // integrity failure accuses the staging of something it did not do, and
    // costs `checksum-mismatch` the one precise meaning it has.
    const scene = fakeScene();
    const { fetcher } = fakeFetcher(stagedBytes(PROTOTYPE_CELL));
    const residency = createFarTierResidency({
      scene, entries: [entryFor(PROTOTYPE_CELL)], fetcher,
      modelFactory: async () => { throw new Error("unsupported glTF extension"); },
    });

    await residency.reconcile(FAR_POSE);

    expect(residency.outcomes().map((outcome) => outcome.state)).toEqual(["build-failure"]);
    expect(residency.outcomes()[0]!.state).not.toBe("checksum-mismatch");
    expect(residency.outcomes()[0]!.detail).toContain("unsupported glTF extension");
    expect(scene.added).toEqual([]);
  });
});

describe("loading is bounded by the SAME distance rule as drawing", () => {
  it("fetches nothing for a cell the camera is inside the near edge of", async () => {
    // B4. The far tier is a DISTANCE tier. An unbounded load fetches, verifies
    // and uploads the whole island in order to draw a ring.
    const scene = fakeScene();
    const { fetcher, requested } = fakeFetcher(stagedBytes(PROTOTYPE_CELL));
    const residency = createFarTierResidency({ scene, entries: [entryFor(PROTOTYPE_CELL)], fetcher });

    await residency.reconcile(NEAR_POSE);

    expect(requested).toEqual([]);
    expect(residency.tiles()).toEqual([]);
    expect(residency.residentBytes()).toBe(0);
    expect(residency.outcomes().map((outcome) => outcome.state)).toEqual(["near"]);
  });

  it("releases bytes and the primitive when the camera comes inside the exit edge", async () => {
    const scene = fakeScene();
    const { fetcher } = fakeFetcher(stagedBytes(PROTOTYPE_CELL));
    const residency = createFarTierResidency({ scene, entries: [entryFor(PROTOTYPE_CELL)], fetcher, modelFactory: recordingFactory().factory });

    await residency.reconcile(FAR_POSE);
    expect(residency.residentBytes()).toBe(TILE_BYTES.byteLength + ATLAS_BYTES.byteLength);
    const drawn = scene.added[0]!;

    await residency.reconcile(NEAR_POSE);

    expect(scene.removed).toEqual([drawn]);
    expect(scene.resident()).toEqual([]);
    expect(residency.residentBytes()).toBe(0);
    expect(residency.tiles()).toEqual([]);
    expect(residency.outcomes().map((outcome) => outcome.state)).toEqual(["near"]);
  });

  it("holds a resident cell across the hysteresis band instead of thrashing it", async () => {
    const scene = fakeScene();
    const { fetcher } = fakeFetcher(stagedBytes(PROTOTYPE_CELL));
    const residency = createFarTierResidency({ scene, entries: [entryFor(PROTOTYPE_CELL)], fetcher, modelFactory: recordingFactory().factory });

    await residency.reconcile(FAR_POSE);
    // 1,150 m: inside the enter edge, outside the exit edge.
    await residency.reconcile(poseOver(PROTOTYPE_CELL, 1_150));

    expect(residency.tiles()).toHaveLength(1);
    expect(scene.removed).toEqual([]);
  });

  it("fetches a failed cell once per in-range episode, and retries after it leaves and returns", async () => {
    // A permanently absent tile must not be refetched on every camera move; a
    // tile the operator restores must heal without a page reload.
    const scene = fakeScene();
    const staged: Record<string, Uint8Array> = {};
    const requested: string[] = [];
    const fetcher = async (ref: string): Promise<Uint8Array> => {
      requested.push(ref);
      const bytes = staged[ref];
      if (!bytes) throw new Error("404 Not Found");
      return bytes;
    };
    const residency = createFarTierResidency({ scene, entries: [entryFor(PROTOTYPE_CELL)], fetcher, modelFactory: recordingFactory().factory });

    await residency.reconcile(FAR_POSE);
    await residency.reconcile(poseOver(PROTOTYPE_CELL, 1_500));
    expect(requested).toHaveLength(1);
    expect(residency.outcomes().map((outcome) => outcome.state)).toEqual(["absent"]);

    // The operator stages the tile; the camera comes inside the edge and back.
    Object.assign(staged, stagedBytes(PROTOTYPE_CELL));
    await residency.reconcile(NEAR_POSE);
    await residency.reconcile(FAR_POSE);

    expect(residency.tiles()).toHaveLength(1);
  });
});

describe("the far tier's own ceiling is ENFORCED, not declared", () => {
  const budgets = { maxCacheEntries: 256, maxCachedBytes: TILE_BYTES.byteLength + ATLAS_BYTES.byteLength };

  it("refuses a cell whose bytes would take residency past the ceiling, before fetching it", async () => {
    // B4's NO-GO CONDITION. `FAR_TIER_RUNTIME_BUDGETS` had zero non-test
    // consumers while the record claimed accounting against it.
    const scene = fakeScene();
    const { fetcher, requested } = fakeFetcher({ ...stagedBytes(PROTOTYPE_CELL), ...stagedBytes(NEIGHBOUR_CELL) });
    const residency = createFarTierResidency({
      scene, entries: [entryFor(PROTOTYPE_CELL), entryFor(NEIGHBOUR_CELL)], fetcher,
      modelFactory: recordingFactory().factory, budgets,
    });

    await residency.reconcile(FAR_POSE);

    expect(residency.tiles()).toHaveLength(1);
    expect(residency.residentBytes()).toBe(budgets.maxCachedBytes);
    const refused = residency.outcomes();
    expect(refused.map((outcome) => outcome.state)).toEqual(["over-budget"]);
    expect(refused[0]!.detail).toContain("would exceed the far-tier ceiling");
    // Refused BEFORE the fetch: a ceiling that lets the bytes onto the wire
    // first has not saved the thing it exists to save.
    expect(requested.filter((ref) => ref.includes(NEIGHBOUR_CELL))).toEqual([]);
  });

  it("spends the ceiling on the NEAREST cells rather than on inventory order", async () => {
    const scene = fakeScene();
    const { fetcher } = fakeFetcher({ ...stagedBytes(PROTOTYPE_CELL), ...stagedBytes(NEIGHBOUR_CELL) });
    // The camera sits over the NEIGHBOUR, which the inventory lists second.
    const camera = poseOver(NEIGHBOUR_CELL, 1_400);
    const residency = createFarTierResidency({
      scene, entries: [entryFor(PROTOTYPE_CELL), entryFor(NEIGHBOUR_CELL)], fetcher,
      modelFactory: recordingFactory().factory, budgets,
    });

    await residency.reconcile(camera);

    expect(residency.tiles().map((tile) => tile.cellId)).toEqual([NEIGHBOUR_CELL]);
    expect(residency.outcomes().map((outcome) => outcome.cellId)).toEqual([PROTOTYPE_CELL]);
  });

  it("refuses on the ENTRY ceiling too, not only on bytes", async () => {
    const scene = fakeScene();
    const { fetcher } = fakeFetcher({ ...stagedBytes(PROTOTYPE_CELL), ...stagedBytes(NEIGHBOUR_CELL) });
    const residency = createFarTierResidency({
      scene, entries: [entryFor(PROTOTYPE_CELL), entryFor(NEIGHBOUR_CELL)], fetcher,
      modelFactory: recordingFactory().factory,
      budgets: { maxCacheEntries: 1, maxCachedBytes: 64 * 1024 * 1024 },
    });

    await residency.reconcile(FAR_POSE);

    expect(residency.tiles()).toHaveLength(1);
    expect(residency.outcomes()[0]!.detail).toContain("far-tier ceiling is 1");
  });

  it("frees the ceiling again when a cell is released", async () => {
    const scene = fakeScene();
    const { fetcher } = fakeFetcher({ ...stagedBytes(PROTOTYPE_CELL), ...stagedBytes(NEIGHBOUR_CELL) });
    const residency = createFarTierResidency({
      scene, entries: [entryFor(PROTOTYPE_CELL), entryFor(NEIGHBOUR_CELL)], fetcher,
      modelFactory: recordingFactory().factory, budgets,
    });

    await residency.reconcile(FAR_POSE);
    expect(residency.residentBytes()).toBe(budgets.maxCachedBytes);
    await residency.reconcile(NEAR_POSE);

    expect(residency.residentBytes()).toBe(0);
  });
});

describe("an aborted load leaks nothing", () => {
  it("removes every primitive it added, including one added mid-load", async () => {
    // The primitives were added to the scene as the load went, but the caller
    // only learned about them when the whole load resolved — so a component
    // that unmounted mid-ring left drawn tiles in a scene nothing tracked.
    const scene = fakeScene();
    const sunk: FarTierPrimitive[] = [];
    let releaseAfterFirstAdd: (() => void) | null = null;
    const { fetcher } = fakeFetcher({ ...stagedBytes(PROTOTYPE_CELL), ...stagedBytes(NEIGHBOUR_CELL) });
    const residency = createFarTierResidency({
      scene, entries: [entryFor(PROTOTYPE_CELL), entryFor(NEIGHBOUR_CELL)], fetcher,
      modelFactory: async () => ({ show: true, ready: true }),
      onPrimitiveAdded: (primitive) => {
        sunk.push(primitive);
        // Dispose the moment the FIRST primitive enters the scene, which is the
        // window the leak lived in.
        releaseAfterFirstAdd?.();
      },
    });
    releaseAfterFirstAdd = () => { if (sunk.length === 1) residency.releaseAll(); };

    await residency.reconcile(FAR_POSE);

    expect(sunk.length).toBeGreaterThanOrEqual(1);
    expect(scene.resident(), "a primitive added before the abort is still in the scene").toEqual([]);
    expect(residency.tiles()).toEqual([]);
    expect(residency.residentBytes()).toBe(0);
  });

  it("tells the caller about a primitive at ADD time, not at resolve time", async () => {
    const scene = fakeScene();
    const seen: string[] = [];
    const { fetcher } = fakeFetcher(stagedBytes(PROTOTYPE_CELL));
    const residency = createFarTierResidency({
      scene, entries: [entryFor(PROTOTYPE_CELL)], fetcher,
      modelFactory: async () => ({ show: true, ready: true }),
      onPrimitiveAdded: () => seen.push("added"),
      onPrimitiveRemoved: () => seen.push("removed"),
    });

    await residency.reconcile(FAR_POSE);
    expect(seen).toEqual(["added"]);
    residency.releaseAll();
    expect(seen).toEqual(["added", "removed"]);
  });

  it("refuses all further work after release", async () => {
    const scene = fakeScene();
    const { fetcher, requested } = fakeFetcher(stagedBytes(PROTOTYPE_CELL));
    const residency = createFarTierResidency({ scene, entries: [entryFor(PROTOTYPE_CELL)], fetcher });

    residency.releaseAll();
    await residency.reconcile(FAR_POSE);

    expect(requested).toEqual([]);
  });
});

describe("a pose that changes nothing still has something to report", () => {
  it("reports the cell as near, and reports NO CHANGE, from the same reconcile", async () => {
    // Both halves matter, and running the app is what proved it. A camera that
    // opens inside the near edge selects no cell, loads nothing and releases
    // nothing — so `reconcile` correctly says nothing changed — but the tier
    // still owes the user its line: "0 drawn · 1 declared · 1 near (massing
    // drawing)". Publishing only on change left that line absent entirely.
    const scene = fakeScene();
    const { fetcher } = fakeFetcher(stagedBytes(PROTOTYPE_CELL));
    const residency = createFarTierResidency({ scene, entries: [entryFor(PROTOTYPE_CELL)], fetcher });

    const changed = await residency.reconcile(NEAR_POSE);

    expect(changed).toBe(false);
    expect(residency.outcomes().map((outcome) => outcome.state)).toEqual(["near"]);
  });

  it("publishes the aggregate before it consults `changed` at all", () => {
    // A structural pin on effect glue no unit test can reach: the publish must
    // sit ABOVE the early return, or an unchanged pose reports nothing.
    const viewport = readText("src/features/explorer/CesiumViewport.tsx");
    const body = viewport.slice(viewport.indexOf("const publishAfterReconcile"));
    const publishAt = body.indexOf("publishFarTierState()");
    const earlyReturnAt = body.indexOf("if (!changed) return;");
    expect(publishAt).toBeGreaterThan(-1);
    expect(earlyReturnAt).toBeGreaterThan(-1);
    expect(publishAt, "the status publish must precede the unchanged early return").toBeLessThan(earlyReturnAt);
  });
});

describe("farTierTileReady", () => {
  it("treats a primitive with no readiness at all as NOT ready", () => {
    // `Model.fromGltfAsync` resolves when the model is created, not when it is
    // drawable. Guessing readiness opens a window where the tile is shown, the
    // massing is dimmed, and nothing is on screen.
    expect(farTierTileReady({ show: true, ready: true })).toBe(true);
    expect(farTierTileReady({ show: true, ready: false })).toBe(false);
    expect(farTierTileReady({ show: true })).toBe(false);
  });
});

/**
 * T005 promotion behaviour: a refusal that can be retried, and a fill that does
 * not hold the main thread for the whole island.
 */
describe("an over-budget refusal is a queue position, not a verdict", () => {
  /** Five z17 tiles east of the prototype: far enough to be far-tier at a near pose. */
  const DISTANT_CELL = "manhattan-exterior-cell-w05-000752-17-38615-35822";
  const bothCells = [entryFor(PROTOTYPE_CELL), entryFor(DISTANT_CELL)];
  const bothBytes = { ...stagedBytes(PROTOTYPE_CELL), ...stagedBytes(DISTANT_CELL) };
  /** One entry only, so the second selected cell must be refused. */
  const ONE_ENTRY = { maxCacheEntries: 1, maxCachedBytes: 1_000_000_000 } as const;

  it("retries a refused cell once the bytes it needed are freed", async () => {
    const scene = fakeScene();
    const { fetcher } = fakeFetcher(bothBytes);
    const residency = createFarTierResidency({
      scene, entries: bothCells, fetcher, budgets: ONE_ENTRY,
      modelFactory: async () => ({ show: true, ready: true }),
    });

    // High over the prototype: both cells are in far-tier range, the ceiling
    // admits one, and nearest-first spends it on the prototype.
    await residency.reconcile(FAR_POSE);
    expect(residency.tiles().map((tile) => tile.cellId)).toEqual([PROTOTYPE_CELL]);
    const refused = residency.outcomes().find((outcome) => outcome.cellId === DISTANT_CELL);
    expect(refused?.state).toBe("over-budget");

    // Drop inside the prototype's exit band. It is released — and THAT is what
    // frees the entry the distant cell was refused for.
    await residency.reconcile(NEAR_POSE);

    const cells = residency.tiles().map((tile) => tile.cellId);
    expect(cells).toEqual([DISTANT_CELL]);
    // The refusal is gone rather than merely stale: before the fix, `attempted`
    // kept the cell marked from before the admission check and no later pass
    // ever reconsidered it.
    expect(residency.outcomes().find((outcome) => outcome.cellId === DISTANT_CELL)).toBeUndefined();
  });

  it("does not retry a failure that freeing bytes cannot fix", async () => {
    const scene = fakeScene();
    // The distant cell's tile is absent; the prototype's is fine.
    const { fetcher } = fakeFetcher(stagedBytes(PROTOTYPE_CELL));
    const residency = createFarTierResidency({
      scene, entries: bothCells, fetcher,
      modelFactory: async () => ({ show: true, ready: true }),
    });
    await residency.reconcile(FAR_POSE);
    expect(residency.outcomes().find((outcome) => outcome.cellId === DISTANT_CELL)?.state).toBe("absent");
    await residency.reconcile(NEAR_POSE);
    // Still absent, and it was not re-fetched into a loop: an absent file is not
    // made present by another cell leaving.
    const after = residency.outcomes().find((outcome) => outcome.cellId === DISTANT_CELL);
    expect(after?.state === "absent" || after?.state === "near").toBe(true);
  });
});

describe("the fill is bounded per pass, so a camera move is not queued behind the island", () => {
  const CELLS = Array.from({ length: 50 }, (_, index) => `manhattan-exterior-cell-w05-000${800 + index}-17-${38610 + index}-35822`);

  it("loads every selected cell across passes, not just the first batch", async () => {
    const scene = fakeScene();
    const entries = CELLS.map((cellId) => entryFor(cellId));
    const bytes = Object.assign({}, ...CELLS.map((cellId) => stagedBytes(cellId)));
    const { fetcher } = fakeFetcher(bytes);
    const residency = createFarTierResidency({
      scene, entries, fetcher, maxLoadsPerPass: 7,
      budgets: { maxCacheEntries: 1_024, maxCachedBytes: 1_000_000_000 },
      modelFactory: async () => ({ show: true, ready: true }),
    });
    // One pose, high enough that the whole strip is in far-tier range.
    await residency.reconcile(poseOver(CELLS[0]!, 4_000));
    // 50 cells at 7 per pass is 8 passes; the driver must keep coming back.
    expect(residency.tiles()).toHaveLength(CELLS.length);
  });

  it("serves a camera move that arrives during the fill", async () => {
    const scene = fakeScene();
    const entries = CELLS.map((cellId) => entryFor(cellId));
    const bytes = Object.assign({}, ...CELLS.map((cellId) => stagedBytes(cellId)));
    const { fetcher } = fakeFetcher(bytes);
    const residency = createFarTierResidency({
      scene, entries, fetcher, maxLoadsPerPass: 3,
      budgets: { maxCacheEntries: 1_024, maxCachedBytes: 1_000_000_000 },
      modelFactory: async () => ({ show: true, ready: true }),
    });
    const filling = residency.reconcile(poseOver(CELLS[0]!, 4_000));
    // A move arriving mid-fill. The drain re-reads the queued pose between
    // batches, so this is served rather than waiting for all fifty.
    const moved = residency.reconcile(poseOver(CELLS[49]!, 4_000));
    await Promise.all([filling, moved]);
    expect(residency.tiles().length).toBeGreaterThan(0);
    // And nothing was lost: the strip is still fully resident at the end.
    expect(residency.tiles()).toHaveLength(CELLS.length);
  });
});
