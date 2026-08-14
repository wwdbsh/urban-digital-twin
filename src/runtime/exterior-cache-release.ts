/**
 * The exterior cache RELEASE SEAM.
 *
 * T002 shipped a scheduler that decides which cells are resident and stops
 * asking for the rest. What it could not do is give any of it back: a cell the
 * scheduler evicted left its verified GLB bytes sitting in the shared exterior
 * LRU until recency pushed them out, and — with the caps measured where they are
 * — recency never does. This module is the seam that makes an evict decision
 * actually free bytes.
 *
 * ## FOUR things hold a verified exterior GLB, and this seam handles THREE
 *
 *   1. **The cache.** `exteriorCacheRef`, a `CitywideLruCache<Uint8Array>` keyed
 *      `${artifactRef}#${checksumSha256}` by `exteriorArtifactCacheKey`. One
 *      entry per artifact, shared by every promoted wave.
 *   2. **The outcome.** `ExteriorCellRenderPlan.assets[].bytes` is the SAME
 *      `Uint8Array` the cache holds, retained by the wave's load state and by
 *      the published overlay. Deleting the cache entry while an outcome holds
 *      the array frees nothing at all.
 *   3. **The Blob URL.** `exteriorModelObjectUrl` (CesiumViewport.tsx) builds a
 *      `Blob` from the bytes and hands Cesium an object URL. That Blob is a
 *      SEPARATE copy of the bytes, alive until `URL.revokeObjectURL`, and it is
 *      the holder that makes "release the cache entry" the smallest of the three
 *      wins rather than the whole one.
 *   4. **Cesium's decoded GPU buffers.** Out of scope, explicitly and by
 *      contract: ADR 0040 D7 records that decoded GPU bytes are not observable
 *      from outside Cesium. Nothing here claims to free them, and nothing here
 *      measures them.
 *
 * A release therefore requires FOUR conditions, and every one of them is a
 * separate gate below rather than an assumption:
 *
 *   (a) the SCHEDULER evicted the cell — the only thing that may enqueue a
 *       candidate is a `dropped` cell from `reconcileExteriorCellLoads`;
 *   (b) NO IN-FLIGHT LOAD references it. `reconcileExteriorCellLoads` leaves
 *       `inFlight` deliberately uncleared on a drop, precisely because the load
 *       is still on the wire; a release racing a settling load must not delete
 *       bytes a `Promise.all` is about to verify. **Gate (b) is CELL-scoped
 *       while the thing released is ARTIFACT-scoped**: a key is held only when
 *       the cell that queued it is in flight, not when some other in-flight
 *       cell happens to want the same artifact. Owner-cell enforcement makes
 *       that sharing effectively impossible today, and the worst case if it
 *       ever happened is a redundant refetch — never a wrong render, because
 *       the refetch re-verifies against the same pin;
 *   (c) its outcome is UNPUBLISHED — no live wave outcome anywhere still names
 *       the key. This is the refcount, computed rather than tracked, over a set
 *       small enough (hundreds of assets) that computing it is cheaper than
 *       maintaining a counter nobody can prove correct;
 *   (d) its BLOB URL is revoked. The viewport owns that revoke, so the viewport
 *       reports it: `onExteriorCellsRetired` fires for exactly the cells whose
 *       object URLs it has just revoked. A candidate that never reached the
 *       scene never had a Blob, and says so with `reachedScene: false` rather
 *       than waiting for a retirement that will never come.
 *
 * ## The seam is tied to the T002 flag
 *
 * Nothing here runs for a session without `?exteriorScheduler=on`, because
 * nothing enqueues: an unflagged session's reconciliation never drops a cell.
 * The app gates the enqueue on the flag explicitly as well, so removing the flag
 * removes the seam and an unflagged session cannot acquire eviction behaviour by
 * accident. ADR 0042 carries it in the rollback list.
 *
 * Everything in this module is synchronous, free of React, free of I/O, and free
 * of the cache itself: `planExteriorCacheRelease` decides and mutates nothing,
 * `commitExteriorCacheRelease` applies. That split is what lets the orderings —
 * which are the whole risk — be written down as tests.
 */

export type ExteriorReleaseHoldReason = "in-flight" | "blob-url-live" | "outcome-published";

export interface ExteriorReleaseCandidate {
  readonly releaseId: string;
  readonly cellId: string;
  /** Cache keys this cell's settled outcome was holding, from `exteriorOutcomeCacheKeys`. */
  readonly cacheKeys: readonly string[];
  /** Declared bytes those keys occupy. Declared, because that is what the cache was charged. */
  readonly byteSize: number;
  /**
   * Whether the outcome was ever PUBLISHED to the overlay, and so whether a Blob
   * URL was ever built from its bytes.
   *
   * A cell dropped while its load was in flight has its outcome DISCARDED by
   * `acceptExteriorCellOutcomes` — it never entered `outcomes`, so
   * `publishedExteriorCellOutcomes` never returned it, so the viewport never saw
   * it and no Blob was ever created. That is not an optimistic reading; it is
   * the only path by which a discarded outcome can exist.
   */
  readonly reachedScene: boolean;
}

export interface ExteriorCacheReleaseState {
  /** Candidates awaiting their gates, keyed by release and cell. */
  readonly pending: Map<string, ExteriorReleaseCandidate>;
  /** Cells the viewport has removed AND whose object URLs it has revoked. */
  readonly sceneRetired: Set<string>;
  releasedArtifactCount: number;
  releasedArtifactBytes: number;
  /** Candidates dropped because the scheduler re-admitted the cell before release. */
  readmittedCandidateCount: number;
}

export interface ExteriorCacheReleaseInput {
  /** Cells with a `loadCell` promise outstanding, across every live wave. */
  readonly inFlightCellIds: ReadonlySet<string>;
  /** Cells the latest decision wants resident, across every live wave. */
  readonly requestedCellIds: ReadonlySet<string>;
  /** Cache keys named by a live published outcome, across every live wave. */
  readonly publishedCacheKeys: ReadonlySet<string>;
}

export interface ExteriorCacheReleasePlan {
  /** Cache keys to delete, in candidate order then key order. */
  readonly releaseKeys: readonly string[];
  readonly releasedCells: readonly { releaseId: string; cellId: string; byteSize: number }[];
  readonly releasedByteSize: number;
  /** Candidates the scheduler re-admitted; they leave the queue without releasing. */
  readonly readmittedCells: readonly { releaseId: string; cellId: string }[];
  /** Candidates a gate refused this pass, with the gate that refused them. */
  readonly held: readonly { releaseId: string; cellId: string; reason: ExteriorReleaseHoldReason }[];
}

function candidateKey(releaseId: string, cellId: string): string {
  // "\u0000" as an ESCAPE, never a literal NUL: a raw NUL in the source makes
  // git treat the whole file as binary and stop producing a reviewable diff.
  return `${releaseId}\u0000${cellId}`;
}

export function createExteriorCacheReleaseState(): ExteriorCacheReleaseState {
  return { pending: new Map(), sceneRetired: new Set(), releasedArtifactCount: 0, releasedArtifactBytes: 0, readmittedCandidateCount: 0 };
}

/**
 * Gate (a), as the only door into the queue.
 *
 * A candidate with no cache keys is not enqueued at all. A cell that failed
 * closed, shipped nothing, or degraded to base massing fetched no artifact, so
 * there is nothing to release and a queue entry for it would be a permanent
 * resident of a queue that is supposed to drain.
 */
export function queueExteriorCacheRelease(state: ExteriorCacheReleaseState, candidate: ExteriorReleaseCandidate): void {
  if (candidate.cacheKeys.length === 0) return;
  const key = candidateKey(candidate.releaseId, candidate.cellId);
  const existing = state.pending.get(key);
  // A cell dropped twice without ever being released keeps the FIRST candidate's
  // scene reachability: if any version of it reached the scene, a Blob existed.
  state.pending.set(key, existing && existing.reachedScene && !candidate.reachedScene ? { ...candidate, reachedScene: true } : candidate);
}

/** Gate (d)'s evidence, reported by the only component that can know it. */
export function noteExteriorSceneRetired(state: ExteriorCacheReleaseState, cellIds: readonly string[]): void {
  for (const cellId of cellIds) state.sceneRetired.add(cellId);
}

/**
 * Decide, mutating nothing.
 *
 * The gate order is deliberate and is itself a claim: re-admission is checked
 * FIRST so a cell the camera came back to leaves the queue instead of being held
 * forever by gate (c) against its own republished outcome; in-flight is checked
 * before the Blob gate so a cell whose load is still settling is never reported
 * as waiting on the scene.
 */
export function planExteriorCacheRelease(state: ExteriorCacheReleaseState, input: ExteriorCacheReleaseInput): ExteriorCacheReleasePlan {
  const releaseKeys: string[] = [];
  /** Deduplication set, so a k-key plan is O(k) rather than an O(k^2) `includes` scan. */
  const releaseKeySet = new Set<string>();
  const releasedCells: { releaseId: string; cellId: string; byteSize: number }[] = [];
  const readmittedCells: { releaseId: string; cellId: string }[] = [];
  const held: { releaseId: string; cellId: string; reason: ExteriorReleaseHoldReason }[] = [];
  let releasedByteSize = 0;

  for (const candidate of state.pending.values()) {
    const { releaseId, cellId } = candidate;
    if (input.requestedCellIds.has(cellId)) { readmittedCells.push({ releaseId, cellId }); continue; }
    if (input.inFlightCellIds.has(cellId)) { held.push({ releaseId, cellId, reason: "in-flight" }); continue; }
    if (candidate.reachedScene && !state.sceneRetired.has(cellId)) { held.push({ releaseId, cellId, reason: "blob-url-live" }); continue; }
    if (candidate.cacheKeys.some((key) => input.publishedCacheKeys.has(key))) { held.push({ releaseId, cellId, reason: "outcome-published" }); continue; }
    for (const key of candidate.cacheKeys) {
      if (releaseKeySet.has(key)) continue;
      releaseKeySet.add(key);
      releaseKeys.push(key);
    }
    releasedCells.push({ releaseId, cellId, byteSize: candidate.byteSize });
    releasedByteSize += candidate.byteSize;
  }

  return { releaseKeys, releasedCells, releasedByteSize, readmittedCells, held };
}

/**
 * Apply a plan: drop the released and re-admitted candidates from the queue,
 * forget their scene retirement, and hand every key to the caller's deleter.
 *
 * `deleteKey` is a callback rather than a cache reference so this module has no
 * dependency on the cache class, and so a test can assert on exactly which keys
 * were deleted rather than inferring it from a byte total.
 */
export function commitExteriorCacheRelease(
  state: ExteriorCacheReleaseState,
  plan: ExteriorCacheReleasePlan,
  deleteKey: (cacheKey: string) => void,
): void {
  for (const entry of [...plan.releasedCells, ...plan.readmittedCells]) {
    state.pending.delete(candidateKey(entry.releaseId, entry.cellId));
    state.sceneRetired.delete(entry.cellId);
  }
  state.readmittedCandidateCount += plan.readmittedCells.length;
  for (const key of plan.releaseKeys) deleteKey(key);
  state.releasedArtifactCount += plan.releaseKeys.length;
  state.releasedArtifactBytes += plan.releasedByteSize;
}
