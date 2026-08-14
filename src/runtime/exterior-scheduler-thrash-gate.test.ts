import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { sha256HexBytes } from "../domain/deterministic-hash";
import type { CameraPose } from "../domain/visitor-navigation";
import { CITYWIDE_OVERVIEW_CELL_EXTENTS, CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE } from "./citywide-overview-cell-extents";
import { acceptExteriorCellOutcomes, createExteriorCellLoadState, publishedExteriorCellOutcomes, reconcileExteriorCellLoads } from "./exterior-cell-reconciliation";
import { EXTERIOR_CELL_SCHEDULER_POLICY, selectResidentUnits, type SchedulableUnit, type SchedulerCarry } from "./exterior-visibility-scheduler";
import type { ViewportFootprint } from "./viewport-footprint";

/**
 * The thrash gate, in its split form.
 *
 * The CAPTURE happened once, in Chrome, against the shipping Cesium viewport:
 * `scripts/exterior-scheduler-trace-capture-cli.mjs trace` drove real mouse
 * drags and recorded the pose and the ground-ray footprint Cesium sampled at
 * every `moveEnd`. The GATE is this file: a deterministic offline replay of that
 * recording through the pure scheduler, with no browser and no network.
 *
 * The metric is RE-ENTRY COUNT: a cell that was evicted and then re-admitted
 * within a bounded decision window. Re-entry is the observable cost of a
 * badly-tuned residency policy — it is a refetch, a Primitive rebuild and a GPU
 * re-upload that a correctly hysteretic policy would not have paid.
 *
 * Re-entry alone can be gamed by never evicting, so it is reported ALONGSIDE
 * peak resident count against a residency ceiling. A policy that scores zero
 * re-entries by holding the whole island fails the ceiling instead.
 *
 * What this gate is NOT: a frame-time result, a GPU-memory result, or a claim
 * that the recorded paths are representative of how anyone uses the app. It is
 * two paths, named, with their capture provenance committed beside them.
 */

const TRACE_PATH = "data/exterior-scheduler-traces-20260814/camera-traces.json";
const TRACE_SIDECAR = "data/exterior-scheduler-traces-20260814/camera-traces.sha256";

/**
 * How far back an eviction still counts as the cause of a later admission.
 *
 * Set to the hysteresis horizon, not to a round number. Hysteresis promises a
 * unit `hysteresisDecisions` further decisions of residency after it stops being
 * visible; a re-admission INSIDE that horizon is therefore a thing the policy
 * undertook to prevent and did not. A wider window is reported beside it rather
 * than gated, because past the horizon a re-admission is the camera genuinely
 * coming back, which is not thrash.
 */
const RE_ENTRY_WINDOW_DECISIONS = EXTERIOR_CELL_SCHEDULER_POLICY.hysteresisDecisions;
const WIDE_WINDOW_DECISIONS = 8;

/**
 * Budgets, both stated at the MEASURED value with no headroom added, so any
 * policy change that makes either path worse fails here.
 *
 * The pan is monotone — the camera walks east at a fixed height and never
 * returns — so nothing it evicts can legitimately come back. Its budget is 0 and
 * it meets it, at every window width measured (0 re-entries even unbounded).
 *
 * The zoom-out does not meet 0, and the reason is worth stating rather than
 * absorbing into a round number. Up to ~1.2 km the visible set fits under the
 * cap and there is no churn at all: 0 evictions across decisions 5 to 8. From
 * decision 9 the visible set crosses 96 and the CAP starts truncating; from
 * there every decision loads and evicts a handful of cells (10/10, 9/9, 5/5,
 * 4/4, 2/2, 8/8, 8/8). Those cells never left the footprint, so hysteresis does
 * not cover them — hysteresis retains cells that stopped being visible, and a
 * cap-truncated cell is visible and unaffordable. The churn is cells crossing
 * the 1,200 m band edge while the cap boundary sits mid-band.
 *
 * That is a finding about the CAP, and the cap is the part of this policy T003
 * replaces with byte-governed residency. It is recorded as a named follow-up in
 * ADR 0041 rather than tuned away here.
 */
const RE_ENTRY_BUDGET = { "midtown-street-pan-v1": 0, "midtown-zoom-out-v1": 13 } as const;
const WIDE_RE_ENTRY_BUDGET = { "midtown-street-pan-v1": 0, "midtown-zoom-out-v1": 30 } as const;
/** Peak residency ceiling, so "never evict" cannot buy a zero. */
const RESIDENCY_CEILING = EXTERIOR_CELL_SCHEDULER_POLICY.maxResidentUnits + 8;

interface TraceSample {
  index: number;
  camera: CameraPose;
  heightBucket: number;
  footprint: ViewportFootprint;
}

interface TracePath {
  pathId: keyof typeof RE_ENTRY_BUDGET;
  sampleCount: number;
  samples: TraceSample[];
  crossing?: { fromSampleCount: number; toSampleCount: number };
  band?: { inBandSampleCount: number; minHeightMeters: number; maxHeightMeters: number };
}

interface TraceRecord {
  recordId: string;
  capture: { renderer: string; transport: string; exteriorStreaming: string; baseReleaseId: string };
  panBoundary: { fromCellId: string; toCellId: string };
  paths: TracePath[];
}

const traceBytes = new Uint8Array(readFileSync(TRACE_PATH));
const trace = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(traceBytes)) as TraceRecord;

const UNITS: readonly SchedulableUnit[] = CITYWIDE_OVERVIEW_CELL_EXTENTS.map((entry) => ({
  unitId: entry.cellId,
  class: "exterior-cell",
  bounds: entry.renderBounds,
  order: entry.order,
  tieBreakKey: entry.cellId,
}));

interface ReplayResult {
  decisionCount: number;
  reEntryCount: number;
  wideReEntryCount: number;
  reEntries: Array<{ unitId: string; evictedAt: number; readmittedAt: number }>;
  peakResidentCount: number;
  totalLoadCount: number;
  totalEvictCount: number;
  heldDecisionCount: number;
}

function replay(path: TracePath): ReplayResult {
  let carry: SchedulerCarry | null = null;
  const evictedAt = new Map<string, number>();
  const reEntries: ReplayResult["reEntries"] = [];
  let peakResidentCount = 0;
  let wideReEntryCount = 0;
  let totalLoadCount = 0;
  let totalEvictCount = 0;
  let heldDecisionCount = 0;

  path.samples.forEach((sample, decisionIndex) => {
    const decision = selectResidentUnits(UNITS, { footprint: sample.footprint, camera: sample.camera, heightBucket: sample.heightBucket }, {
      ...EXTERIOR_CELL_SCHEDULER_POLICY,
      metersPerDegreeLongitude: CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE.metersPerDegreeLongitude,
      metersPerDegreeLatitude: CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE.metersPerDegreeLatitude,
      previous: carry,
    });
    if (decision.hold === "held-previous") heldDecisionCount += 1;
    for (const unitId of decision.load) {
      const evicted = evictedAt.get(unitId);
      if (evicted !== undefined && decisionIndex - evicted <= WIDE_WINDOW_DECISIONS) {
        wideReEntryCount += 1;
        if (decisionIndex - evicted <= RE_ENTRY_WINDOW_DECISIONS) reEntries.push({ unitId, evictedAt: evicted, readmittedAt: decisionIndex });
      }
      evictedAt.delete(unitId);
    }
    for (const unitId of decision.evict) evictedAt.set(unitId, decisionIndex);
    totalLoadCount += decision.load.length;
    totalEvictCount += decision.evict.length;
    peakResidentCount = Math.max(peakResidentCount, decision.resident.length);
    carry = decision.carry;
  });

  return { decisionCount: path.samples.length, reEntryCount: reEntries.length, wideReEntryCount, reEntries, peakResidentCount, totalLoadCount, totalEvictCount, heldDecisionCount };
}

describe("exterior scheduler thrash gate", () => {
  it("replays a committed capture whose provenance is checkable", () => {
    const sidecar = new TextDecoder().decode(new Uint8Array(readFileSync(TRACE_SIDECAR))).trim().split(/\s+/u)[0];
    expect(sha256HexBytes(traceBytes)).toBe(sidecar);
    expect(trace.recordId).toBe("exterior-scheduler-traces-20260814");
    expect(trace.capture.renderer).toContain("shipping CesiumJS viewport");
    expect(trace.capture.transport).toContain("Chrome DevTools Protocol");
    expect(trace.paths.map((path) => path.pathId)).toEqual(["midtown-street-pan-v1", "midtown-zoom-out-v1"]);
  });

  it("replays real ground-ray footprints rather than modelled ones", () => {
    for (const path of trace.paths) {
      const groundRay = path.samples.filter((sample) => sample.footprint.source === "ground-rays");
      // The first samples of any session are the camera-fallback bootstrap and
      // the view-rectangle fallback; everything after is a real globe pick.
      expect(groundRay.length, path.pathId).toBeGreaterThanOrEqual(path.samples.length - 2);
      expect(groundRay.every((sample) => sample.footprint.valid), path.pathId).toBe(true);
    }
  });

  it("recorded a pan that actually crosses the named cell boundary", () => {
    const pan = trace.paths[0]!;
    expect(pan.crossing!.fromSampleCount).toBeGreaterThan(0);
    expect(pan.crossing!.toSampleCount).toBeGreaterThan(0);
    expect(trace.panBoundary.fromCellId).toBe("manhattan-exterior-cell-w01-000031-17-38598-35863");
    expect(trace.panBoundary.toCellId).toBe("manhattan-exterior-cell-w01-000032-17-38599-35863");
  });

  it("recorded a zoom-out that traverses the 1.2-2.4 km band rather than jumping it", () => {
    const zoom = trace.paths[1]!;
    expect(zoom.band!.inBandSampleCount).toBeGreaterThanOrEqual(3);
    expect(zoom.band!.minHeightMeters).toBeLessThan(1_200);
    expect(zoom.band!.maxHeightMeters).toBeGreaterThan(2_400);
  });

  for (const pathId of ["midtown-street-pan-v1", "midtown-zoom-out-v1"] as const) {
    it(`holds ${pathId} within its re-entry budget and its residency ceiling`, () => {
      const path = trace.paths.find((candidate) => candidate.pathId === pathId)!;
      const result = replay(path);
      // Reported together, always. Either number alone can be bought with the
      // other: zero re-entries is free if nothing is ever evicted, and a tiny
      // resident set is free if everything is re-fetched on every decision.
      expect({ pathId, reEntryCount: result.reEntryCount, wideReEntryCount: result.wideReEntryCount }).toEqual({
        pathId,
        reEntryCount: RE_ENTRY_BUDGET[pathId],
        wideReEntryCount: WIDE_RE_ENTRY_BUDGET[pathId],
      });
      expect(result.peakResidentCount).toBeLessThanOrEqual(RESIDENCY_CEILING);
      // A replay that evicted nothing would score zero re-entries for free. Both
      // paths move far enough that residency genuinely turns over.
      expect(result.totalEvictCount).toBeGreaterThan(0);
      expect(result.decisionCount).toBe(path.sampleCount);
    });
  }

  it("is deterministic: the same trace replays to the same decisions", () => {
    for (const path of trace.paths) {
      const first = replay(path);
      const second = replay(path);
      expect(second).toEqual(first);
    }
  });

  /**
   * The reviewer's repro, kept as a gate.
   *
   * The offline replay above decides residency instantly. The app does not: a
   * cell admitted at decision N has its bytes arrive some decisions later, and
   * the scheduler can evict it in between. Replaying the same committed trace
   * through the scheduler AND the real reconciliation with a two-decision load
   * latency is what exposed the resurrection defect — 16 cells written back into
   * residency after eviction, 13 of them permanently un-evictable, and a
   * rendered set of 97 against a cap of 96.
   *
   * The invariant is simple and absolute: what is rendered is a subset of what
   * the last decision asked for. Nothing may render because a request that
   * predates its eviction happened to land.
   */
  it("never renders a cell the scheduler evicted, at a two-decision load latency", () => {
    const path = trace.paths.find((candidate) => candidate.pathId === "midtown-zoom-out-v1")!;
    const state = createExteriorCellLoadState<string>();
    const declared = CITYWIDE_OVERVIEW_CELL_EXTENTS.map((entry) => entry.cellId).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    const pending: Array<{ landsAt: number; cellIds: readonly string[] }> = [];
    let carry: SchedulerCarry | null = null;
    let peakRendered = 0;
    let resurrected = 0;

    path.samples.forEach((sample, decisionIndex) => {
      for (const batch of pending.filter((entry) => entry.landsAt === decisionIndex)) {
        const verdict = acceptExteriorCellOutcomes(state, batch.cellIds, batch.cellIds.map((cellId) => cellId));
        resurrected += verdict.accepted.filter((cellId) => !state.requested.has(cellId)).length;
      }
      const decision = selectResidentUnits(UNITS, { footprint: sample.footprint, camera: sample.camera, heightBucket: sample.heightBucket }, {
        ...EXTERIOR_CELL_SCHEDULER_POLICY,
        metersPerDegreeLongitude: CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE.metersPerDegreeLongitude,
        metersPerDegreeLatitude: CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE.metersPerDegreeLatitude,
        previous: carry,
      });
      carry = decision.carry;
      const scheduled = declared.filter((cellId) => decision.resident.includes(cellId));
      const { fresh } = reconcileExteriorCellLoads(state, scheduled);
      if (fresh.length > 0) pending.push({ landsAt: decisionIndex + 2, cellIds: fresh });

      const rendered = publishedExteriorCellOutcomes(state, declared);
      peakRendered = Math.max(peakRendered, rendered.length);
      // The invariant, checked at every decision rather than at the end.
      for (const cellId of rendered) expect(state.requested.has(cellId), `decision ${decisionIndex} rendered unrequested ${cellId}`).toBe(true);
      expect(rendered.length, `decision ${decisionIndex}`).toBeLessThanOrEqual(scheduled.length);
    });

    expect(resurrected).toBe(0);
    expect(peakRendered).toBeLessThanOrEqual(EXTERIOR_CELL_SCHEDULER_POLICY.maxResidentUnits);
    // A latency replay that never rendered anything would satisfy the above for
    // free. It renders most of the resident set most of the time.
    expect(peakRendered).toBeGreaterThan(EXTERIOR_CELL_SCHEDULER_POLICY.maxResidentUnits / 2);
  });

  /**
   * ADR 0041 discloses that the cap is applied per wave, so a six-wave session
   * is bounded by 6 x `maxResidentUnits` and not by `maxResidentUnits`. Pinned
   * as a number here so the disclosure is a test and not only prose.
   */
  it("pins the six-wave session bound the ADR discloses", () => {
    const waveCount = 6;
    // FROZEN. Every budget in this file was measured at exactly this policy, so
    // the policy is pinned field by field rather than only by its cap. T003
    // introduced `EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY` as a SEPARATE constant
    // precisely so this one could stay where the measurements were taken; its
    // own baseline lives in `exterior-cache-governance-gate.test.ts`, and a
    // re-baseline of this file would destroy the only regression evidence the
    // scheduler has.
    expect(EXTERIOR_CELL_SCHEDULER_POLICY).toEqual({ maxResidentUnits: 96, distanceBandEdgesMeters: [1_200, 2_400], hysteresisDecisions: 3 });
    expect(EXTERIOR_CELL_SCHEDULER_POLICY.maxResidentUnits).toBe(96);
    expect(waveCount * EXTERIOR_CELL_SCHEDULER_POLICY.maxResidentUnits).toBe(576);
    // Still strictly below the ledger, which is the only reason the bound is a
    // bound at all rather than a restatement of "load everything".
    expect(waveCount * EXTERIOR_CELL_SCHEDULER_POLICY.maxResidentUnits).toBeLessThan(CITYWIDE_OVERVIEW_CELL_EXTENTS.length);
    expect(CITYWIDE_OVERVIEW_CELL_EXTENTS).toHaveLength(883);
  });

  it("never evicts on the untrusted bootstrap samples the capture recorded", () => {
    for (const path of trace.paths) {
      const untrusted = path.samples.filter((sample) => !sample.footprint.valid);
      expect(untrusted.length, path.pathId).toBeGreaterThan(0);
      expect(replay(path).heldDecisionCount).toBeGreaterThan(0);
    }
  });
});
