/**
 * Per-cell load reconciliation for one exterior wave.
 *
 * Extracted from `App.tsx` because the interesting behaviour is entirely in the
 * ORDERING between a scheduling decision and an asset load that has not come
 * back yet, and ordering is not something a comment can be trusted about. Every
 * function here is synchronous, free of React, free of I/O, and operates on a
 * plain state object the caller owns, so the orderings can be written down as
 * tests instead of reasoned about.
 *
 * ## The three sets, and why there are three rather than two
 *
 *   `requested`  cells that SHOULD be resident right now.
 *   `inFlight`   cells whose `loadCell` promise has not settled.
 *   `outcomes`   cells that have an outcome and are rendered.
 *
 * An earlier version of this logic kept only `requested` and `outcomes`, and it
 * had a real defect that a replay of the committed `midtown-zoom-out-v1` trace
 * exposed once a load latency of two decisions was modelled. A cell scheduled at
 * decision N and dropped at decision N+1 had its entry removed from both sets —
 * and then the batch from decision N settled and wrote the outcome back
 * unconditionally. The cell was resurrected into `outcomes` while absent from
 * `requested`, which made it:
 *
 *   - rendered although the scheduler had evicted it;
 *   - permanently un-evictable, because `dropped` is computed from `requested`
 *     and the cell was no longer in it;
 *   - liable to a duplicate `loadCell` the moment it became visible again.
 *
 * `inFlight` is what fixes the third one and `acceptExteriorCellOutcomes`'s
 * guard fixes the first two. A cell that is re-admitted while its original load
 * is still in flight is NOT re-requested: the load already on the wire will
 * deliver it, and by then it is in `requested` again so the outcome is accepted.
 */

export interface ExteriorCellLoadState<TOutcome> {
  /** Cells that should be resident. The scheduler's decision, as applied. */
  readonly requested: Set<string>;
  /** Cells with a `loadCell` promise outstanding. */
  readonly inFlight: Set<string>;
  readonly outcomes: Map<string, TOutcome>;
}

export interface ExteriorCellReconciliation {
  /** Cells to hand to `loadCell` now, in the caller's own order. */
  readonly fresh: readonly string[];
  /** Cells removed from residency by this reconciliation. */
  readonly dropped: readonly string[];
  /** True when this reconciliation changed nothing and the caller may skip it. */
  readonly idle: boolean;
}

export function createExteriorCellLoadState<TOutcome>(): ExteriorCellLoadState<TOutcome> {
  return { requested: new Set<string>(), inFlight: new Set<string>(), outcomes: new Map<string, TOutcome>() };
}

/**
 * Apply a scheduling decision to a live wave's load state.
 *
 * Mutates `state` and returns what the caller must do about it. Called on every
 * reconciliation, including the very first for a wave, where `requested` is
 * empty and `fresh` is therefore the whole scheduled list in the caller's order
 * — which on the default path is the whole declared list, producing exactly the
 * single batch this replaced.
 */
export function reconcileExteriorCellLoads<TOutcome>(
  state: ExteriorCellLoadState<TOutcome>,
  scheduledCellIds: readonly string[],
  /**
   * Cells that are still scheduled but whose LOADED FORM is stale (T001).
   *
   * A cell that crossed the near-ring bound is still resident and still wanted,
   * but the level it holds is no longer the level its distance selects. Dropping
   * it from `requested` here is what puts it back into `fresh`, so the crossing
   * becomes a reload rather than being absorbed.
   *
   * A cell already IN FLIGHT is deliberately left alone: its load has not
   * settled, re-requesting it would put two loads on the wire for one cell, and
   * the next reconciliation catches it once it has settled.
   */
  invalidatedCellIds: readonly string[] = [],
): ExteriorCellReconciliation {
  for (const cellId of invalidatedCellIds) {
    if (state.inFlight.has(cellId)) continue;
    state.requested.delete(cellId);
    state.outcomes.delete(cellId);
  }
  const scheduled = new Set(scheduledCellIds);
  const dropped = [...state.requested].filter((cellId) => !scheduled.has(cellId));
  for (const cellId of dropped) {
    state.requested.delete(cellId);
    state.outcomes.delete(cellId);
    // `inFlight` is deliberately NOT cleared. The load is still on the wire and
    // will settle; leaving the marker is what stops a re-admission before it
    // settles from issuing a second identical request.
  }
  // A cell already in flight is already coming. Re-requesting it would put two
  // loads on the wire for one cell and make which outcome wins a race.
  const fresh = scheduledCellIds.filter((cellId) => !state.requested.has(cellId) && !state.inFlight.has(cellId));
  const admitted = scheduledCellIds.filter((cellId) => !state.requested.has(cellId));
  for (const cellId of admitted) state.requested.add(cellId);
  for (const cellId of fresh) state.inFlight.add(cellId);
  return { fresh, dropped, idle: fresh.length === 0 && dropped.length === 0 && admitted.length === 0 };
}

/**
 * Record what a settled batch produced.
 *
 * The guard is the whole point: an outcome is accepted only for a cell that is
 * STILL requested when its load comes back. A cell the scheduler evicted while
 * its bytes were in flight stays evicted, and its outcome is discarded rather
 * than resurrecting it into a residency nothing asked for.
 *
 * `inFlight` is cleared for every cell in the batch whatever the verdict,
 * because the load did settle.
 */
export function acceptExteriorCellOutcomes<TOutcome>(
  state: ExteriorCellLoadState<TOutcome>,
  cellIds: readonly string[],
  outcomes: readonly (TOutcome | undefined)[],
): { accepted: readonly string[]; discarded: readonly string[] } {
  const accepted: string[] = [];
  const discarded: string[] = [];
  cellIds.forEach((cellId, index) => {
    state.inFlight.delete(cellId);
    const outcome = outcomes[index];
    if (outcome === undefined) return;
    if (!state.requested.has(cellId)) { discarded.push(cellId); return; }
    state.outcomes.set(cellId, outcome);
    accepted.push(cellId);
  });
  return { accepted, discarded };
}

/** A batch that failed: the cells are no longer in flight and hold no outcome. */
export function failExteriorCellBatch<TOutcome>(state: ExteriorCellLoadState<TOutcome>, cellIds: readonly string[]): void {
  for (const cellId of cellIds) {
    state.inFlight.delete(cellId);
    state.outcomes.delete(cellId);
  }
}

/**
 * The outcome array to hand to the overlay, in the RUNTIME's own declared order.
 *
 * Declared order rather than scheduled order, so the array is element-for-element
 * what a single whole-wave `Promise.all` over `runtime.cellIds()` produced before
 * per-cell reconciliation existed.
 */
export function publishedExteriorCellOutcomes<TOutcome>(
  state: ExteriorCellLoadState<TOutcome>,
  declaredCellIds: readonly string[],
): TOutcome[] {
  return declaredCellIds.flatMap((cellId) => {
    const outcome = state.outcomes.get(cellId);
    return outcome === undefined ? [] : [outcome];
  });
}

export interface ExteriorCellLoadInputs<TRuntime, TProfile> {
  runtime: TRuntime;
  profile: TProfile;
  bucket: number;
}

/**
 * Whether a live wave's load may continue uninterrupted.
 *
 * This is the cross-wave abort property, as a value rather than as a comment.
 * The effect that owns it re-runs whenever ANY wave changes state — and once
 * upon a time its cleanup aborted every wave's in-flight requests, so the moment
 * a second wave finished loading its index the first wave's cells failed closed
 * with a request error they had no reason to have. A load is cancelled only when
 * its OWN inputs change, and "its own inputs" is exactly these three. Note what
 * is NOT here: the scheduler's footprint signature. A camera move re-decides
 * residency; it must never abort a load.
 */
export function exteriorCellLoadInputsUnchanged<TRuntime, TProfile>(
  live: ExteriorCellLoadInputs<TRuntime, TProfile> | undefined,
  next: ExteriorCellLoadInputs<TRuntime, TProfile> | undefined,
): boolean {
  if (!live || !next) return false;
  return live.runtime === next.runtime && live.profile === next.profile && live.bucket === next.bucket;
}
