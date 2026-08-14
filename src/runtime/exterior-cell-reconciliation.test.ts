import { describe, expect, it } from "vitest";

import {
  acceptExteriorCellOutcomes,
  createExteriorCellLoadState,
  exteriorCellLoadInputsUnchanged,
  failExteriorCellBatch,
  publishedExteriorCellOutcomes,
  reconcileExteriorCellLoads,
  type ExteriorCellLoadState,
} from "./exterior-cell-reconciliation";

/**
 * These tests are about ORDERING, not about arithmetic.
 *
 * The load of a cell is asynchronous and the scheduling decision that admitted
 * it is not, so between the two there is a window in which the scheduler can
 * change its mind. Every interesting defect in per-cell reconciliation lives in
 * that window, and the whole reason this logic was lifted out of the effect is
 * that a window cannot be tested through a React effect and a Cesium runtime
 * without testing everything else at the same time.
 *
 * The drop-during-flight suite below fails against the first version of this
 * logic, which wrote settled outcomes back unconditionally.
 */

type Outcome = { cellId: string; tag: string };

function outcome(cellId: string, tag = "v1"): Outcome {
  return { cellId, tag };
}

function seeded(cellIds: readonly string[]): ExteriorCellLoadState<Outcome> {
  const state = createExteriorCellLoadState<Outcome>();
  const { fresh } = reconcileExteriorCellLoads(state, cellIds);
  acceptExteriorCellOutcomes(state, fresh, fresh.map((cellId) => outcome(cellId)));
  return state;
}

describe("reconcileExteriorCellLoads: the ordinary paths", () => {
  it("admits the whole scheduled list on the first reconciliation, in the caller's order", () => {
    const state = createExteriorCellLoadState<Outcome>();
    const result = reconcileExteriorCellLoads(state, ["c", "a", "b"]);
    expect(result.fresh).toEqual(["c", "a", "b"]);
    expect(result.dropped).toEqual([]);
    expect(result.idle).toBe(false);
    expect([...state.requested].sort()).toEqual(["a", "b", "c"]);
    expect([...state.inFlight].sort()).toEqual(["a", "b", "c"]);
  });

  it("is idle when the decision repeats, so a settled wave issues no further requests", () => {
    const state = seeded(["a", "b"]);
    const result = reconcileExteriorCellLoads(state, ["a", "b"]);
    expect(result).toEqual({ fresh: [], dropped: [], idle: true });
    expect(state.inFlight.size).toBe(0);
  });

  it("adds only the cells that are new", () => {
    const state = seeded(["a", "b"]);
    const result = reconcileExteriorCellLoads(state, ["a", "b", "c"]);
    expect(result.fresh).toEqual(["c"]);
    expect(result.dropped).toEqual([]);
  });

  it("removes a dropped cell from residency and from what is rendered", () => {
    const state = seeded(["a", "b", "c"]);
    const result = reconcileExteriorCellLoads(state, ["a", "c"]);
    expect(result.dropped).toEqual(["b"]);
    expect(result.fresh).toEqual([]);
    expect(result.idle).toBe(false);
    expect(state.outcomes.has("b")).toBe(false);
    expect(publishedExteriorCellOutcomes(state, ["a", "b", "c"]).map((entry) => entry.cellId)).toEqual(["a", "c"]);
  });

  it("publishes in the runtime's declared order, not in scheduled or admission order", () => {
    const declared = ["a", "b", "c", "d"];
    const state = createExteriorCellLoadState<Outcome>();
    const first = reconcileExteriorCellLoads(state, ["d", "b"]);
    acceptExteriorCellOutcomes(state, first.fresh, first.fresh.map((cellId) => outcome(cellId)));
    const second = reconcileExteriorCellLoads(state, ["d", "b", "a"]);
    acceptExteriorCellOutcomes(state, second.fresh, second.fresh.map((cellId) => outcome(cellId)));
    expect(publishedExteriorCellOutcomes(state, declared).map((entry) => entry.cellId)).toEqual(["a", "b", "d"]);
  });

  it("skips a cell whose load produced nothing rather than publishing a hole", () => {
    const state = createExteriorCellLoadState<Outcome>();
    const { fresh } = reconcileExteriorCellLoads(state, ["a", "b"]);
    acceptExteriorCellOutcomes(state, fresh, [outcome("a"), undefined]);
    expect(publishedExteriorCellOutcomes(state, ["a", "b"]).map((entry) => entry.cellId)).toEqual(["a"]);
    expect(state.inFlight.size).toBe(0);
  });
});

/**
 * The defect this module was extracted to fix.
 *
 * A cell is admitted at decision N, the scheduler evicts it at decision N+1, and
 * the load issued at decision N settles at N+2. The pre-fix logic wrote the
 * outcome back unconditionally, and every assertion in this block failed:
 * replaying the committed `midtown-zoom-out-v1` trace with a two-decision load
 * latency resurrected 16 cells, left 13 of them permanently un-evictable, and
 * pushed the resident set to 97 against a cap of 96.
 */
describe("reconcileExteriorCellLoads: a drop while the load is in flight", () => {
  it("discards the outcome of a cell evicted before its bytes came back", () => {
    const state = createExteriorCellLoadState<Outcome>();
    const first = reconcileExteriorCellLoads(state, ["a", "b"]);
    expect(first.fresh).toEqual(["a", "b"]);

    // The scheduler changes its mind while the batch is still on the wire.
    const second = reconcileExteriorCellLoads(state, ["a"]);
    expect(second.dropped).toEqual(["b"]);
    expect(state.requested.has("b")).toBe(false);

    const verdict = acceptExteriorCellOutcomes(state, first.fresh, [outcome("a"), outcome("b")]);
    expect(verdict.accepted).toEqual(["a"]);
    expect(verdict.discarded).toEqual(["b"]);
    expect(state.outcomes.has("b")).toBe(false);
    expect(publishedExteriorCellOutcomes(state, ["a", "b"]).map((entry) => entry.cellId)).toEqual(["a"]);
  });

  it("leaves an evicted cell evictable again rather than permanently stuck resident", () => {
    const state = createExteriorCellLoadState<Outcome>();
    const first = reconcileExteriorCellLoads(state, ["a", "b"]);
    reconcileExteriorCellLoads(state, ["a"]);
    acceptExteriorCellOutcomes(state, first.fresh, [outcome("a"), outcome("b")]);

    // Pre-fix, `b` was back in `outcomes` but absent from `requested`, so it
    // rendered although nothing had asked for it and no later reconciliation
    // could list it as dropped.
    expect(state.outcomes.has("b")).toBe(false);
    expect(publishedExteriorCellOutcomes(state, ["a", "b"]).map((entry) => entry.cellId)).toEqual(["a"]);
    const readmit = reconcileExteriorCellLoads(state, ["a", "b"]);
    expect(readmit.fresh).toEqual(["b"]);
    const drop = reconcileExteriorCellLoads(state, ["a"]);
    expect(drop.dropped).toEqual(["b"]);
  });

  it("keeps residency bounded by the scheduled set after a drop-during-flight", () => {
    const state = createExteriorCellLoadState<Outcome>();
    const first = reconcileExteriorCellLoads(state, ["a", "b", "c"]);
    reconcileExteriorCellLoads(state, ["a"]);
    acceptExteriorCellOutcomes(state, first.fresh, first.fresh.map((cellId) => outcome(cellId)));
    expect(state.requested.size).toBe(1);
    expect(state.outcomes.size).toBe(1);
    expect(publishedExteriorCellOutcomes(state, ["a", "b", "c"]).length).toBe(1);
  });

  /**
   * The duplicate-load path, handled rather than left to a race. A cell dropped
   * and re-admitted before its original load settles is NOT re-requested: the
   * request already on the wire delivers it, and by the time it lands the cell
   * is requested again so the outcome is accepted.
   */
  it("does not issue a second request for a cell re-admitted while still in flight", () => {
    const state = createExteriorCellLoadState<Outcome>();
    const first = reconcileExteriorCellLoads(state, ["a", "b"]);
    reconcileExteriorCellLoads(state, ["a"]);
    const readmit = reconcileExteriorCellLoads(state, ["a", "b"]);
    expect(readmit.fresh).toEqual([]);
    expect(readmit.idle).toBe(false);
    expect(state.requested.has("b")).toBe(true);
    expect(state.inFlight.has("b")).toBe(true);

    acceptExteriorCellOutcomes(state, first.fresh, [outcome("a"), outcome("b")]);
    expect(state.outcomes.get("b")).toEqual(outcome("b"));
    expect(state.inFlight.size).toBe(0);
  });

  it("re-requests a cell re-admitted after its load already settled", () => {
    const state = createExteriorCellLoadState<Outcome>();
    const first = reconcileExteriorCellLoads(state, ["a", "b"]);
    reconcileExteriorCellLoads(state, ["a"]);
    acceptExteriorCellOutcomes(state, first.fresh, [outcome("a"), outcome("b")]);
    expect(reconcileExteriorCellLoads(state, ["a", "b"]).fresh).toEqual(["b"]);
  });

  it("clears in-flight and residency for a batch that failed", () => {
    const state = createExteriorCellLoadState<Outcome>();
    const { fresh } = reconcileExteriorCellLoads(state, ["a", "b"]);
    failExteriorCellBatch(state, fresh);
    expect(state.inFlight.size).toBe(0);
    expect(state.outcomes.size).toBe(0);
    // Still requested — the scheduler's decision did not change because a
    // request failed — so a re-reconciliation retries rather than forgetting it.
    expect([...state.requested].sort()).toEqual(["a", "b"]);
    expect(reconcileExteriorCellLoads(state, ["a", "b"]).fresh).toEqual([]);
  });
});

describe("exteriorCellLoadInputsUnchanged: the cross-wave abort property", () => {
  const runtimeA = { id: "A" };
  const runtimeB = { id: "B" };
  const live = { runtime: runtimeA, profile: "exploration", bucket: 300 };

  it("leaves a wave's loads alone when its own inputs are untouched", () => {
    expect(exteriorCellLoadInputsUnchanged(live, { runtime: runtimeA, profile: "exploration", bucket: 300 })).toBe(true);
  });

  /**
   * The incident this guards. The effect re-runs whenever ANY wave changes
   * state, so wave B finishing its index must not abort wave A's in-flight
   * cells. Wave A's inputs are compared to wave A's inputs and to nothing else.
   */
  it("leaves wave A alone when wave B's runtime is what changed", () => {
    const waveBChanged = { runtime: runtimeB, profile: "exploration", bucket: 300 };
    expect(exteriorCellLoadInputsUnchanged(live, { runtime: runtimeA, profile: "exploration", bucket: 300 })).toBe(true);
    expect(exteriorCellLoadInputsUnchanged(waveBChanged, { runtime: runtimeB, profile: "exploration", bucket: 300 })).toBe(true);
  });

  it("cancels only on a runtime, profile or bucket change of its own", () => {
    expect(exteriorCellLoadInputsUnchanged(live, { runtime: runtimeB, profile: "exploration", bucket: 300 })).toBe(false);
    expect(exteriorCellLoadInputsUnchanged(live, { runtime: runtimeA, profile: "inspection", bucket: 300 })).toBe(false);
    expect(exteriorCellLoadInputsUnchanged(live, { runtime: runtimeA, profile: "exploration", bucket: 400 })).toBe(false);
  });

  it("cancels a wave that is no longer targeted", () => {
    expect(exteriorCellLoadInputsUnchanged(live, undefined)).toBe(false);
    expect(exteriorCellLoadInputsUnchanged(undefined, { runtime: runtimeA, profile: "exploration", bucket: 300 })).toBe(false);
  });

  /**
   * The property that is easy to lose by accident: the scheduler's footprint
   * signature is a dependency of the EFFECT but must never be an input to the
   * abort decision, or every camera move would cancel the loads it just asked
   * for. This function cannot see it, and that is the guarantee.
   */
  it("cannot see the footprint signature at all", () => {
    const withSignature = { runtime: runtimeA, profile: "exploration", bucket: 300, signature: "different" };
    expect(exteriorCellLoadInputsUnchanged(live, withSignature)).toBe(true);
  });
});
