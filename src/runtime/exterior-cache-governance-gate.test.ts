import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { sha256HexBytes } from "../domain/deterministic-hash";
import type { CameraPose } from "../domain/visitor-navigation";
import { CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE } from "./citywide-overview-cell-extents";
import { EXTERIOR_CELL_STATIC_UNITS } from "./exterior-cell-scheduling";
import { EXTERIOR_RUNTIME_BUDGETS } from "./exterior-cell-runtime";
import { EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY, EXTERIOR_CELL_SCHEDULER_POLICY, selectResidentUnits, type SchedulerCarry } from "./exterior-visibility-scheduler";
import type { ViewportFootprint } from "./viewport-footprint";

/**
 * The T003 residency baseline: the SINGLE-POOL configuration, separately named.
 *
 * `exterior-scheduler-thrash-gate.test.ts` keeps replaying the T002
 * configuration — cap 96, one pool — unchanged, and it stays green. This file is
 * a SECOND baseline for the configuration T003 actually ships (cap 128, one
 * pool over the static 883-row table). Re-baselining the first file would have
 * been the easy move and would have destroyed the only regression evidence this
 * task has; a re-baseline is not a pass.
 *
 * ## The traces
 *
 * The two T002 paths are each ONE monotone motion from a cold start, so their
 * peak residency is a cold-window reading rather than a bound. T003 captured a
 * third path with the same tool and the same CDP pattern — `midtown-roam-v1`,
 * six legs on two axes over 58 settled camera samples, 220 m to 2,106 m, 5.5 km
 * east-west and 3.8 km north-south — precisely so a peak taken over it is a peak
 * over a SESSION. All three are replayed here.
 *
 * ## The honest mixed result, stated before the numbers
 *
 * Raising the cap from 96 to 128 does NOT improve every figure. On the zoom-out
 * path, re-entries inside the hysteresis horizon go UP (13 -> 15) while
 * re-entries inside the wider 8-decision window go DOWN (30 -> 25): a larger cap
 * admits more cells into the band-edge churn zone, and more of them come back
 * quickly, but fewer of them come back at all. On the roaming path — the one
 * that is actually a session — the horizon count falls sharply (45 -> 32 at the
 * same trace) and that is the result the cap was chosen against. Both are
 * recorded. Neither is averaged into the other.
 */

const T002_TRACE_PATH = "data/exterior-scheduler-traces-20260814/camera-traces.json";
const ROAM_TRACE_PATH = "data/exterior-cache-governance-20260814/roam-trace.json";
const ROAM_TRACE_SIDECAR = "data/exterior-cache-governance-20260814/roam-trace.sha256";

const RE_ENTRY_WINDOW_DECISIONS = EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY.hysteresisDecisions;
const WIDE_WINDOW_DECISIONS = 8;

/**
 * The per-cell cache cost, taken from ADR 0041's committed opt-in evidence at
 * the 2,400 m overview camera: 110 resident cells cost 210 cache entries and
 * 37,164,596 B.
 *
 * These are DERIVED figures, not measurements: they price a residency count
 * using a measured ratio. They are stated as a ratio and applied to a peak so
 * that "does the peak residency fit the cache ceilings" has an answer at all —
 * ADR 0040 D7's rule is that nothing here claims to be a byte measurement of a
 * session that was never run.
 */
const MEASURED_OVERVIEW_RESIDENT_CELLS = 110;
const MEASURED_OVERVIEW_CACHE_ENTRIES = 210;
const MEASURED_OVERVIEW_CACHE_BYTES = 37_164_596;

interface TraceSample { index: number; camera: CameraPose; heightBucket: number; footprint: ViewportFootprint }
interface TracePath { pathId: string; sampleCount: number; samples: TraceSample[] }

function readTrace(path: string): { paths: TracePath[]; bytes: Uint8Array; record: Record<string, unknown> } {
  const bytes = new Uint8Array(readFileSync(path));
  const record = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as { paths: TracePath[] } & Record<string, unknown>;
  return { paths: record.paths, bytes, record };
}

const t002 = readTrace(T002_TRACE_PATH);
const roam = readTrace(ROAM_TRACE_PATH);
const PATHS = new Map<string, TracePath>([...t002.paths, ...roam.paths].map((path) => [path.pathId, path]));

interface ReplayResult {
  decisionCount: number;
  reEntryCount: number;
  wideReEntryCount: number;
  peakResidentCount: number;
  totalLoadCount: number;
  totalEvictCount: number;
  /** The largest single-decision eviction, which is the release seam's peak workload. */
  peakEvictionsPerDecision: number;
  heldDecisionCount: number;
}

function replay(path: TracePath, policy: { maxResidentUnits: number; distanceBandEdgesMeters: readonly number[]; hysteresisDecisions: number }): ReplayResult {
  let carry: SchedulerCarry | null = null;
  const evictedAt = new Map<string, number>();
  const result: ReplayResult = { decisionCount: path.samples.length, reEntryCount: 0, wideReEntryCount: 0, peakResidentCount: 0, totalLoadCount: 0, totalEvictCount: 0, peakEvictionsPerDecision: 0, heldDecisionCount: 0 };

  path.samples.forEach((sample, decisionIndex) => {
    const decision = selectResidentUnits(EXTERIOR_CELL_STATIC_UNITS, { footprint: sample.footprint, camera: sample.camera, heightBucket: sample.heightBucket }, {
      ...policy,
      metersPerDegreeLongitude: CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE.metersPerDegreeLongitude,
      metersPerDegreeLatitude: CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE.metersPerDegreeLatitude,
      previous: carry,
    });
    if (decision.hold === "held-previous") result.heldDecisionCount += 1;
    for (const unitId of decision.load) {
      const evicted = evictedAt.get(unitId);
      if (evicted !== undefined && decisionIndex - evicted <= WIDE_WINDOW_DECISIONS) {
        result.wideReEntryCount += 1;
        if (decisionIndex - evicted <= RE_ENTRY_WINDOW_DECISIONS) result.reEntryCount += 1;
      }
      evictedAt.delete(unitId);
    }
    for (const unitId of decision.evict) evictedAt.set(unitId, decisionIndex);
    result.totalLoadCount += decision.load.length;
    result.totalEvictCount += decision.evict.length;
    result.peakEvictionsPerDecision = Math.max(result.peakEvictionsPerDecision, decision.evict.length);
    result.peakResidentCount = Math.max(result.peakResidentCount, decision.resident.length);
    carry = decision.carry;
  });

  return result;
}

describe("the roam trace this baseline is measured over", () => {
  it("is committed with a checkable digest and the same capture provenance as T002", () => {
    const sidecar = new TextDecoder().decode(new Uint8Array(readFileSync(ROAM_TRACE_SIDECAR))).trim().split(/\s+/u)[0];
    expect(sha256HexBytes(roam.bytes)).toBe(sidecar);
    expect(roam.record.recordId).toBe("exterior-cache-governance-roam-20260814");
    expect(roam.record.taskId).toBe("T003");
    const capture = roam.record.capture as Record<string, string>;
    expect(capture.renderer).toContain("shipping CesiumJS viewport");
    expect(capture.transport).toContain("Chrome DevTools Protocol");
    // Camera geometry only, exactly as T002. The residency is produced offline.
    expect(capture.exteriorStreaming).toBe("off");
  });

  it("has a checkable sidecar beside every T003 evidence record, not only the replayed one", () => {
    // The trace is the only record this suite replays, but all four are quoted
    // in ADR 0042. A record quoted in a decision with no verifiable digest is a
    // number nobody can re-derive.
    for (const name of ["roam-trace", "roam-evidence", "governance-evidence", "request-latency"]) {
      const bytes = new Uint8Array(readFileSync(`data/exterior-cache-governance-20260814/${name}.json`));
      const sidecar = new TextDecoder().decode(new Uint8Array(readFileSync(`data/exterior-cache-governance-20260814/${name}.sha256`))).trim().split(/\s+/u)[0];
      expect(sha256HexBytes(bytes), name).toBe(sidecar);
    }
  });

  /**
   * The seam freeing bytes, as it was observed in a real browser rather than as
   * it replays offline. Pinned here so the headline row of ADR 0042 is a test.
   */
  it("observed the release seam freeing 22,258,480 B in a roaming browser session", () => {
    const evidence = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(readFileSync("data/exterior-cache-governance-20260814/roam-evidence.json")))) as {
      samples: { label: string; cacheEntries: number; cachedBytes: number; releasedArtifactCount: number; releasedArtifactBytes: number }[];
    };
    const byLabel = new Map(evidence.samples.map((sample) => [sample.label, sample]));
    // Residency climbed as the camera rose...
    expect(byLabel.get("settled-at-street")!.cacheEntries).toBe(14);
    expect(byLabel.get("zoom-out-through-band")!.cacheEntries).toBe(43);
    expect(byLabel.get("zoom-out-through-band")!.releasedArtifactBytes).toBe(0);
    // ...and a lateral move at altitude released it. Before T003 these bytes
    // stayed cached for the life of the session.
    expect(byLabel.get("altitude-pan-east")!.releasedArtifactCount).toBe(79);
    expect(byLabel.get("altitude-pan-east")!.releasedArtifactBytes).toBe(22_258_480);
    expect(byLabel.get("altitude-pan-east")!.cachedBytes).toBe(0);
    // Coming back down re-fetched and settled at Block 835's own 14 assets.
    expect(byLabel.get("zoom-back-in")!.cacheEntries).toBe(14);
  });

  it("is a roam and not a longer version of the T002 paths", () => {
    const path = PATHS.get("midtown-roam-v1")!;
    const heights = path.samples.map((sample) => sample.camera.height);
    expect(path.samples.length).toBe(58);
    expect(Math.min(...heights)).toBeLessThan(250);
    expect(Math.max(...heights)).toBeGreaterThan(2_000);
    // Both axes, which is what makes leaving and returning possible at all.
    const longitudes = path.samples.map((sample) => sample.camera.longitude);
    const latitudes = path.samples.map((sample) => sample.camera.latitude);
    expect((Math.max(...longitudes) - Math.min(...longitudes)) * 84_600).toBeGreaterThan(1_000);
    expect((Math.max(...latitudes) - Math.min(...latitudes)) * 111_000).toBeGreaterThan(1_000);
    // Real ground-ray footprints, not modelled ones.
    expect(path.samples.filter((sample) => sample.footprint.source === "ground-rays").length).toBe(56);
  });
});

/**
 * Budgets at the MEASURED value with no headroom, exactly as the T002 gate
 * states its own, so any policy change that makes any path worse fails here.
 */
const GLOBAL_BUDGET = {
  "midtown-street-pan-v1": { reEntryCount: 0, wideReEntryCount: 0, peakResidentCount: 91, totalEvictCount: 92 },
  "midtown-zoom-out-v1": { reEntryCount: 15, wideReEntryCount: 25, peakResidentCount: 128, totalEvictCount: 62 },
  "midtown-roam-v1": { reEntryCount: 32, wideReEntryCount: 75, peakResidentCount: 128, totalEvictCount: 362 },
} as const;

describe("the single-pool residency baseline at the global cap", () => {
  for (const pathId of ["midtown-street-pan-v1", "midtown-zoom-out-v1", "midtown-roam-v1"] as const) {
    it(`holds ${pathId} at its measured re-entry, residency and eviction figures`, () => {
      const result = replay(PATHS.get(pathId)!, EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY);
      expect({
        reEntryCount: result.reEntryCount,
        wideReEntryCount: result.wideReEntryCount,
        peakResidentCount: result.peakResidentCount,
        totalEvictCount: result.totalEvictCount,
      }).toEqual(GLOBAL_BUDGET[pathId]);
      // Reported together: a policy that never evicted would score zero
      // re-entries for free, and one that evicted everything would score a tiny
      // resident set for free.
      expect(result.peakResidentCount).toBeLessThanOrEqual(EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY.maxResidentUnits);
      expect(result.totalEvictCount).toBeGreaterThan(0);
    });
  }

  it("is deterministic", () => {
    for (const path of PATHS.values()) expect(replay(path, EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY)).toEqual(replay(path, EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY));
  });
});

/**
 * The comparison, reported rather than spun.
 *
 * The same three traces replayed at the T002 cap and at the T003 cap. The zoom
 * path gets WORSE at the hysteresis horizon and BETTER over the wider window;
 * the roaming path — the only one of the three that is a session — gets clearly
 * better at the horizon. That is the whole result.
 */
describe("cap 96 against cap 128, on all three paths", () => {
  it("records the mixed zoom-out result and the roam improvement side by side", () => {
    const table = ["midtown-street-pan-v1", "midtown-zoom-out-v1", "midtown-roam-v1"].map((pathId) => {
      const at96 = replay(PATHS.get(pathId)!, EXTERIOR_CELL_SCHEDULER_POLICY);
      const at128 = replay(PATHS.get(pathId)!, EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY);
      return { pathId, reEntry: [at96.reEntryCount, at128.reEntryCount], wide: [at96.wideReEntryCount, at128.wideReEntryCount], peak: [at96.peakResidentCount, at128.peakResidentCount] };
    });
    expect(table).toEqual([
      { pathId: "midtown-street-pan-v1", reEntry: [0, 0], wide: [0, 0], peak: [91, 91] },
      // WORSE at the horizon, BETTER over the wider window. Not averaged.
      { pathId: "midtown-zoom-out-v1", reEntry: [13, 15], wide: [30, 25], peak: [96, 128] },
      // The roaming session: a 29% fall in horizon re-entries.
      { pathId: "midtown-roam-v1", reEntry: [45, 32], wide: [76, 75], peak: [96, 128] },
    ]);
  });
});

describe("steady-state residency against the cache ceilings", () => {
  /**
   * The peak the roam certifies, priced against both ceilings.
   *
   * The pricing is DERIVED from a measured ratio, and the derivation is written
   * out rather than asserted so a reader can see it is arithmetic and not a
   * measurement of a session nobody ran.
   */
  it("certifies a session peak of 128 cells and shows neither ceiling binds at it", () => {
    const peak = replay(PATHS.get("midtown-roam-v1")!, EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY).peakResidentCount;
    expect(peak).toBe(128);

    const entriesPerCell = MEASURED_OVERVIEW_CACHE_ENTRIES / MEASURED_OVERVIEW_RESIDENT_CELLS;
    const bytesPerCell = MEASURED_OVERVIEW_CACHE_BYTES / MEASURED_OVERVIEW_RESIDENT_CELLS;
    const derivedEntries = Math.round(peak * entriesPerCell);
    const derivedBytes = Math.round(peak * bytesPerCell);
    expect(derivedEntries).toBe(244);
    expect(derivedBytes).toBe(43_246_075);

    expect(derivedEntries).toBeLessThan(EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries);
    expect(derivedBytes).toBeLessThan(EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes);
    // Where each ceiling WOULD bind, in cells. Both are far above the cap, which
    // is the arithmetic behind "neither ceiling binds today".
    expect(Math.floor(EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries / entriesPerCell)).toBe(268);
    expect(Math.floor(EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes / bytesPerCell)).toBe(794);
  });

  /**
   * The release seam's peak workload, which is why the LRU's byte counter had to
   * stop being an O(n) reduce inside an O(k) eviction loop.
   */
  it("reports the largest single-decision eviction the roam produces", () => {
    const roamResult = replay(PATHS.get("midtown-roam-v1")!, EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY);
    expect(roamResult.peakEvictionsPerDecision).toBe(43);
    expect(roamResult.totalEvictCount).toBe(362);
    // Eviction is ROUTINE on a roaming path: it happens on most decisions, which
    // is the fact that turns a rare backstop into a hot loop.
    expect(roamResult.totalEvictCount / roamResult.decisionCount).toBeGreaterThan(5);
  });
});

describe("the T003 cap, pinned with its arithmetic", () => {
  it("is 128, above the measured six-pool overview residency and far below the shape it replaces", () => {
    expect(EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY.maxResidentUnits).toBe(128);
    // Floor: the six-pool configuration's measured residency at 2,400 m.
    expect(EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY.maxResidentUnits).toBeGreaterThan(MEASURED_OVERVIEW_RESIDENT_CELLS);
    // Still a bound: 4.5x tighter than 6 x 96, and 6.9x below the 883 declared.
    expect(6 * EXTERIOR_CELL_SCHEDULER_POLICY.maxResidentUnits).toBe(576);
    expect(EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY.maxResidentUnits).toBeLessThan(576);
    expect(EXTERIOR_CELL_STATIC_UNITS.length).toBe(883);
    // Everything else about the policy is unchanged from T002.
    expect(EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY.distanceBandEdgesMeters).toEqual(EXTERIOR_CELL_SCHEDULER_POLICY.distanceBandEdgesMeters);
    expect(EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY.hysteresisDecisions).toBe(EXTERIOR_CELL_SCHEDULER_POLICY.hysteresisDecisions);
  });

  it("leaves EXTERIOR_RUNTIME_BUDGETS untouched", () => {
    // T003 changed no cache constant. The injected-cap tests in
    // `exterior-cache-eviction-correctness.test.ts` prove the mechanics instead.
    expect(EXTERIOR_RUNTIME_BUDGETS).toEqual({ maxCacheEntries: 512, maxCachedBytes: 256 * 1024 * 1024, maxConcurrentRequests: 4 });
  });
});
