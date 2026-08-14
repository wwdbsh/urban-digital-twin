import { describe, expect, it } from "vitest";

import {
  commitExteriorCacheRelease,
  createExteriorCacheReleaseState,
  noteExteriorSceneRetired,
  planExteriorCacheRelease,
  queueExteriorCacheRelease,
  type ExteriorCacheReleaseState,
} from "./exterior-cache-release";
import { exteriorArtifactCacheKey, exteriorOutcomeCacheKeys, type ExteriorCellOutcome, type ExteriorRenderedAsset } from "./exterior-cell-runtime";

/**
 * The release seam's four gates, one at a time, plus the orderings between them.
 *
 * Every test here is about a SEQUENCE — evict, then settle; evict, then revoke;
 * evict, then come back — because a release seam is entirely a question of
 * ordering and none of the risk is in any single step. The module is pure so the
 * orderings can be written down rather than reasoned about inside an effect,
 * which is the same reason `exterior-cell-reconciliation.ts` exists.
 */

function asset(ref: string, checksum: string, byteSize: number): ExteriorRenderedAsset {
  return {
    canonicalFeatureId: `doitt:${ref}`,
    ownerCellId: "cell-a",
    lodId: "lod_0",
    artifactRef: `public/assets/${ref}.glb`,
    byteSize,
    checksumSha256: checksum,
    bytes: new Uint8Array(byteSize),
    geometricErrorMeters: 1,
    maxDistanceMeters: null,
    provenance: {
      inventoryId: "inventory:x",
      inventoryHashSha256: "a".repeat(64),
      evidenceShardId: "evidence:x",
      truthTiers: [],
      sourceDates: { capturedAt: null, updatedAt: null },
      predecessor: null,
      uncertainty: "designed",
    },
  };
}

function renderedOutcome(cellId: string, assets: readonly ExteriorRenderedAsset[]): ExteriorCellOutcome {
  return { kind: "rendered", cellId, cellReleaseId: `cell:${cellId}`, cellReleaseVersion: "1", assemblyPackageId: "pkg", representation: "head", assets: [...assets], notice: null };
}

const A0 = asset("a0", "0".repeat(64), 1_000);
const A1 = asset("a1", "1".repeat(64), 2_000);
const B0 = asset("b0", "2".repeat(64), 4_000);

function queued(state: ExteriorCacheReleaseState, cellId: string, assets: readonly ExteriorRenderedAsset[], reachedScene: boolean): void {
  const { keys, byteSize } = exteriorOutcomeCacheKeys(renderedOutcome(cellId, assets));
  queueExteriorCacheRelease(state, { releaseId: "wave-1", cellId, cacheKeys: keys, byteSize, reachedScene });
}

const NOTHING = { inFlightCellIds: new Set<string>(), requestedCellIds: new Set<string>(), publishedCacheKeys: new Set<string>() };

describe("the exterior cache key, derived in exactly one place", () => {
  it("is what a rendered asset resolves to and what the loader stores under", () => {
    // The whole anti-drift property in one assertion: the key the release plan
    // reads is character-identical to the key the loader wrote. A release that
    // derived its own format would silently delete nothing.
    expect(exteriorOutcomeCacheKeys(renderedOutcome("cell-a", [A0, A1])).keys).toEqual([
      exteriorArtifactCacheKey(A0.artifactRef, A0.checksumSha256),
      exteriorArtifactCacheKey(A1.artifactRef, A1.checksumSha256),
    ]);
    expect(exteriorArtifactCacheKey("public/assets/a0.glb", "0".repeat(64))).toBe(`public/assets/a0.glb#${"0".repeat(64)}`);
  });

  it("reports nothing for an outcome that never fetched an artifact", () => {
    // A cell that failed closed, shipped nothing, or fell back to base massing
    // holds no bytes. Returning an empty result is a fact about those paths, not
    // a default, so a queue entry can never be created for one.
    const kinds: ExteriorCellOutcome[] = [
      { kind: "base-massing", cellId: "c", cellReleaseId: "r", code: "glb-invalid", message: "m", notice: "n" },
      { kind: "failed", cellId: "c", cellReleaseId: "r", code: "cell-missing", message: "m", notice: "n" },
      { kind: "not-shipped", cellId: "c", cellReleaseId: "r", unavailableBuildingCount: 2, notice: "n" },
    ];
    for (const outcome of kinds) expect(exteriorOutcomeCacheKeys(outcome)).toEqual({ keys: [], byteSize: 0 });
  });

  it("counts an artifact shared by two assets of one cell once", () => {
    // Two LODs of one building are two artifacts; two assets citing the SAME
    // artifact are one cache entry, and charging its bytes twice would make the
    // released-byte total a number nobody could reconcile with the cache.
    const shared = { ...A0, canonicalFeatureId: "doitt:other" };
    expect(exteriorOutcomeCacheKeys(renderedOutcome("cell-a", [A0, shared]))).toEqual({ keys: [exteriorArtifactCacheKey(A0.artifactRef, A0.checksumSha256)], byteSize: 1_000 });
  });
});

describe("gate (a): only a scheduler eviction enqueues", () => {
  it("refuses a candidate with no cache keys rather than queueing a permanent resident", () => {
    const state = createExteriorCacheReleaseState();
    queueExteriorCacheRelease(state, { releaseId: "wave-1", cellId: "cell-a", cacheKeys: [], byteSize: 0, reachedScene: true });
    expect(state.pending.size).toBe(0);
  });

  it("releases nothing at all when nothing was evicted", () => {
    const state = createExteriorCacheReleaseState();
    const deleted: string[] = [];
    const plan = planExteriorCacheRelease(state, NOTHING);
    commitExteriorCacheRelease(state, plan, (key) => deleted.push(key));
    expect(deleted).toEqual([]);
    expect(state.releasedArtifactBytes).toBe(0);
  });
});

describe("gate (b): a load still on the wire is never released out from under", () => {
  it("holds a cell whose load has not settled, and releases it once it has", () => {
    // This is the race the T002 reconciliation deliberately leaves open:
    // `inFlight` is NOT cleared on a drop, because the load is still coming. A
    // release that ignored it would delete bytes a `Promise.all` is about to
    // verify.
    const state = createExteriorCacheReleaseState();
    queued(state, "cell-a", [A0, A1], false);

    const held = planExteriorCacheRelease(state, { ...NOTHING, inFlightCellIds: new Set(["cell-a"]) });
    expect(held.releaseKeys).toEqual([]);
    expect(held.held).toEqual([{ releaseId: "wave-1", cellId: "cell-a", reason: "in-flight" }]);

    const settled = planExteriorCacheRelease(state, NOTHING);
    expect(settled.releaseKeys).toHaveLength(2);
    expect(settled.releasedByteSize).toBe(3_000);
  });

  it("keeps the candidate queued while it is held, so the hold is a delay and not a loss", () => {
    const state = createExteriorCacheReleaseState();
    queued(state, "cell-a", [A0], false);
    const plan = planExteriorCacheRelease(state, { ...NOTHING, inFlightCellIds: new Set(["cell-a"]) });
    commitExteriorCacheRelease(state, plan, () => { throw new Error("nothing may be deleted while a load is in flight"); });
    expect(state.pending.size).toBe(1);
  });
});

describe("gate (d): a live Blob URL means releasing the cache entry frees nothing", () => {
  it("holds a cell that reached the scene until the viewport reports the revoke", () => {
    const state = createExteriorCacheReleaseState();
    queued(state, "cell-a", [A0, A1], true);

    expect(planExteriorCacheRelease(state, NOTHING).held).toEqual([{ releaseId: "wave-1", cellId: "cell-a", reason: "blob-url-live" }]);

    noteExteriorSceneRetired(state, ["cell-a"]);
    const plan = planExteriorCacheRelease(state, NOTHING);
    expect(plan.releasedCells).toEqual([{ releaseId: "wave-1", cellId: "cell-a", byteSize: 3_000 }]);
  });

  it("does not wait for a retirement that can never come", () => {
    // A discarded outcome never entered `outcomes`, so it was never published,
    // so the viewport never built a Blob for it and will never retire it. This
    // is the only path by which a discarded outcome exists, which is why
    // `reachedScene: false` is a fact and not an assumption.
    const state = createExteriorCacheReleaseState();
    queued(state, "cell-a", [A0], false);
    expect(planExteriorCacheRelease(state, NOTHING).releaseKeys).toHaveLength(1);
  });

  it("keeps the stricter reading when a cell is evicted twice and reached the scene once", () => {
    const state = createExteriorCacheReleaseState();
    queued(state, "cell-a", [A0], true);
    queued(state, "cell-a", [A0], false);
    expect(planExteriorCacheRelease(state, NOTHING).held).toEqual([{ releaseId: "wave-1", cellId: "cell-a", reason: "blob-url-live" }]);
  });
});

describe("gate (c): bytes a live outcome still names are not released", () => {
  it("holds a candidate whose artifact another resident outcome also cites", () => {
    const state = createExteriorCacheReleaseState();
    queued(state, "cell-a", [A0, A1], false);
    const shared = new Set([exteriorArtifactCacheKey(A1.artifactRef, A1.checksumSha256)]);
    expect(planExteriorCacheRelease(state, { ...NOTHING, publishedCacheKeys: shared }).held).toEqual([{ releaseId: "wave-1", cellId: "cell-a", reason: "outcome-published" }]);
  });

  it("is a refcount recomputed from the outcomes rather than a counter maintained beside them", () => {
    const state = createExteriorCacheReleaseState();
    queued(state, "cell-a", [A0], false);
    const key = exteriorArtifactCacheKey(A0.artifactRef, A0.checksumSha256);
    expect(planExteriorCacheRelease(state, { ...NOTHING, publishedCacheKeys: new Set([key]) }).releaseKeys).toEqual([]);
    expect(planExteriorCacheRelease(state, NOTHING).releaseKeys).toEqual([key]);
  });
});

describe("re-admission: a cell the camera came back to leaves the queue without releasing", () => {
  it("drops the candidate and deletes nothing", () => {
    // Checked FIRST, ahead of gate (c), so a re-admitted cell cannot be held
    // forever by its own republished outcome.
    const state = createExteriorCacheReleaseState();
    queued(state, "cell-a", [A0, A1], true);
    noteExteriorSceneRetired(state, ["cell-a"]);
    const deleted: string[] = [];
    const plan = planExteriorCacheRelease(state, { ...NOTHING, requestedCellIds: new Set(["cell-a"]) });
    commitExteriorCacheRelease(state, plan, (key) => deleted.push(key));
    expect(deleted).toEqual([]);
    expect(state.pending.size).toBe(0);
    expect(state.readmittedCandidateCount).toBe(1);
    // The scene-retired marker goes with it: the cell is about to be re-rendered
    // and a stale retirement would let the NEXT eviction skip gate (d).
    expect(state.sceneRetired.has("cell-a")).toBe(false);
  });

  it("makes the next eviction of the same cell wait for its own revoke", () => {
    const state = createExteriorCacheReleaseState();
    queued(state, "cell-a", [A0], true);
    noteExteriorSceneRetired(state, ["cell-a"]);
    commitExteriorCacheRelease(state, planExteriorCacheRelease(state, { ...NOTHING, requestedCellIds: new Set(["cell-a"]) }), () => {});
    queued(state, "cell-a", [A0], true);
    expect(planExteriorCacheRelease(state, NOTHING).held).toEqual([{ releaseId: "wave-1", cellId: "cell-a", reason: "blob-url-live" }]);
  });
});

describe("the plan and the commit, kept apart", () => {
  it("planning mutates nothing", () => {
    const state = createExteriorCacheReleaseState();
    queued(state, "cell-a", [A0], false);
    const before = { pending: state.pending.size, released: state.releasedArtifactCount, bytes: state.releasedArtifactBytes };
    planExteriorCacheRelease(state, NOTHING);
    planExteriorCacheRelease(state, NOTHING);
    expect({ pending: state.pending.size, released: state.releasedArtifactCount, bytes: state.releasedArtifactBytes }).toEqual(before);
  });

  it("accumulates session totals across passes and never double-counts a key within one", () => {
    const state = createExteriorCacheReleaseState();
    queued(state, "cell-a", [A0], false);
    queued(state, "cell-b", [B0], false);
    const deleted: string[] = [];
    commitExteriorCacheRelease(state, planExteriorCacheRelease(state, NOTHING), (key) => deleted.push(key));
    expect(deleted).toHaveLength(2);
    expect(state.releasedArtifactCount).toBe(2);
    expect(state.releasedArtifactBytes).toBe(5_000);
    expect(state.pending.size).toBe(0);

    queued(state, "cell-c", [A1], false);
    commitExteriorCacheRelease(state, planExteriorCacheRelease(state, NOTHING), (key) => deleted.push(key));
    expect(state.releasedArtifactCount).toBe(3);
    expect(state.releasedArtifactBytes).toBe(7_000);
  });

  it("emits one delete for an artifact two evicted cells both held", () => {
    const state = createExteriorCacheReleaseState();
    queued(state, "cell-a", [A0], false);
    queued(state, "cell-b", [A0], false);
    const deleted: string[] = [];
    commitExteriorCacheRelease(state, planExteriorCacheRelease(state, NOTHING), (key) => deleted.push(key));
    expect(deleted).toEqual([exteriorArtifactCacheKey(A0.artifactRef, A0.checksumSha256)]);
  });
});
