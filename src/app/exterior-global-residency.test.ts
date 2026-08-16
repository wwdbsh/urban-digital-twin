import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { CameraPose } from "../domain/visitor-navigation";
import { exteriorOverlayRenderEntries, type ExteriorCellOverlay } from "../features/explorer/CesiumViewport";
import { CitywideLruCache } from "../release/citywide-release";
import { CITYWIDE_OVERVIEW_CELL_EXTENTS } from "../runtime/citywide-overview-cell-extents";
import {
  commitExteriorCacheRelease,
  createExteriorCacheReleaseState,
  noteExteriorSceneRetired,
  planExteriorCacheRelease,
  queueExteriorCacheRelease,
} from "../runtime/exterior-cache-release";
import {
  acceptExteriorCellOutcomes,
  createExteriorCellLoadState,
  publishedExteriorCellOutcomes,
  reconcileExteriorCellLoads,
  type ExteriorCellLoadState,
} from "../runtime/exterior-cell-reconciliation";
import { scheduleExteriorCellsGlobally } from "../runtime/exterior-cell-scheduling";
import { exteriorArtifactCacheKey, exteriorOutcomeCacheKeys, type ExteriorCellOutcome } from "../runtime/exterior-cell-runtime";
import { EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY, type SchedulerCarry } from "../runtime/exterior-visibility-scheduler";
import type { ViewportFootprint } from "../runtime/viewport-footprint";

/**
 * (3c) NO STALE RENDER, through the App effect's own sequence, under a GLOBAL
 * decision and a real camera trace.
 *
 * ## What this replays, and what it does not
 *
 * It runs the App cell-loading effect's module sequence, in the effect's order,
 * with real promises and a modelled load latency:
 *
 *   one `scheduleExteriorCellsGlobally` over the static 883-row census table
 *     -> per-wave `reconcileExteriorCellLoads`
 *     -> queue the drops into the release seam
 *     -> loads settle two decisions later
 *     -> `acceptExteriorCellOutcomes`, queue the discards
 *     -> `publishedExteriorCellOutcomes` -> `exteriorOverlayRenderEntries`
 *     -> the viewport's retirement -> `planExteriorCacheRelease` / commit
 *
 * ## WHERE the release pass runs is modelled, because it is load-bearing
 *
 * An earlier version of this file ran the release pass only AFTER the wave
 * loop while the App ran it INSIDE, and that gap is exactly why the defect
 * below survived review of both. `releaseTiming` now models both placements and
 * the suite asserts on each:
 *
 *   `"after-loop"`  what the App ships. The pass never observes a decision that
 *                   is only partially applied.
 *   `"mid-loop"`    what the App used to do. Gate 1 (re-admission) reads the
 *                   APPLIED per-wave `requested` sets, so a pass firing during
 *                   an early wave's iteration cannot see that the same decision
 *                   re-admits a cell belonging to a LATER wave — and releases a
 *                   key that wave asks for microseconds afterwards.
 *
 * What it does NOT include is React: no component renders, no effect is
 * scheduled by the reconciler, and no Cesium viewer exists. Six real promoted
 * releases are also not loadable in a unit test, so the wave runtimes are
 * stubbed — REAL census cell ids and a real per-cell artifact, synthetic bytes.
 * That is stated plainly rather than implied by the file name: what is proved
 * here is the ORDERING of the real modules under real async latency at real
 * recorded cameras, which is where every defect this design has had so far has
 * lived.
 *
 * ## The invariants, checked at EVERY decision rather than at the end
 *
 *   1. what is published is a subset of what the last decision requested;
 *   2. what the overlay would draw names only published cells;
 *   3. every artifact a published outcome names is still IN the cache — the
 *      release seam never frees bytes something is still rendering;
 *   4. residency stays inside the global cap, so one pool really is one bound;
 *   5. **no key released at decision N is requested by any wave at decision N.**
 *      This is the invariant the mid-loop placement violates.
 */

const ROAM_TRACE_PATH = "data/exterior-cache-governance-20260814/roam-trace.json";
const LOAD_LATENCY_DECISIONS = 2;

interface TraceSample { camera: CameraPose; heightBucket: number; footprint: ViewportFootprint }
const roam = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(readFileSync(ROAM_TRACE_PATH)))) as { paths: { pathId: string; samples: TraceSample[] }[] };
const SAMPLES = roam.paths[0]!.samples;

/** The six promoted waves, partitioned out of the census by its own wave marker. */
const ALL_CELL_IDS = CITYWIDE_OVERVIEW_CELL_EXTENTS.map((entry) => entry.cellId).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
const WAVES = ["w00", "w01", "w02", "w03", "w04", "w05"].map((waveId) => ({
  releaseId: `manhattan-exterior-${waveId}`,
  declaredCellIds: ALL_CELL_IDS.filter((cellId) => cellId.includes(`-cell-${waveId}-`)),
}));

const ARTIFACT_BYTES = 4_096;

function stubOutcome(releaseId: string, cellId: string): ExteriorCellOutcome {
  return {
    kind: "rendered",
    cellId,
    cellReleaseId: `cell:${cellId}`,
    cellReleaseVersion: "1",
    assemblyPackageId: `pkg:${releaseId}`,
    representation: "head",
    notice: null,
    assets: [{
      canonicalFeatureId: `doitt:${cellId}`,
      ownerCellId: cellId,
      lodId: "lod_0",
      artifactRef: `public/assets/${cellId}__lod_0.glb`,
      byteSize: ARTIFACT_BYTES,
      checksumSha256: "c".repeat(64),
      bytes: new Uint8Array(ARTIFACT_BYTES),
      geometricErrorMeters: 1,
      maxDistanceMeters: null,
      provenance: {
        inventoryId: "inventory:x",
        inventoryHashSha256: "d".repeat(64),
        evidenceShardId: "evidence:x",
        truthTiers: [],
        sourceDates: { capturedAt: null, updatedAt: null },
        predecessor: null,
        uncertainty: "designed",
      },
    }],
  };
}

interface WaveState {
  releaseId: string;
  declaredCellIds: readonly string[];
  load: ExteriorCellLoadState<ExteriorCellOutcome>;
  published: ExteriorCellOutcome[];
}

/** The stub's cell-to-artifact mapping, so a requested CELL implies a known KEY. */
function cacheKeyForCell(cellId: string): string {
  return exteriorArtifactCacheKey(`public/assets/${cellId}__lod_0.glb`, "c".repeat(64));
}

type ReleaseTiming = "after-loop" | "mid-loop";

interface ReplayResult {
  peakResident: number;
  peakCacheEntries: number;
  releasedKeys: number;
  cacheEvictions: number;
  releasedArtifactBytes: number;
  /**
   * Keys released UNDER decision N — by the reconciliation or the retirement —
   * that some wave still wants at the end of decision N. This is B1's metric,
   * and the shipped placement holds it at zero.
   */
  releasedThenImmediatelyRequested: { decisionIndex: number; cacheKey: string }[];
  /**
   * Keys released by a SETTLING BATCH, which runs after decision N-1 was fully
   * applied and before decision N was taken, that decision N then asked for.
   *
   * A different thing entirely, and NOT fixed: at the moment the batch settles
   * the current decision genuinely does not want the cell, and no ordering of
   * the release pass can consult a decision that has not been taken. The cost
   * is one refetch, priced by ADR 0042's latency table. Counted so the number
   * is known rather than assumed to be zero.
   */
  releasedWhileSettlingThenRequested: { decisionIndex: number; cacheKey: string }[];
  /**
   * Release passes invoked while a decision was only PARTIALLY applied — some
   * waves had reconciled against it and some had not.
   *
   * This is B1 as a structural property rather than as a symptom count. Gate 1
   * reads the applied per-wave `requested` sets, so a pass invoked here is
   * reading a union that does not yet cover the session, and whether that
   * releases something depends on what happens to be queued at that instant.
   * The shipped placement holds this at zero; the mid-loop placement does not.
   */
  partiallyAppliedReleasePasses: number;
}

/**
 * The effect's sequence, with the release pass placed where `releaseTiming`
 * says. Every assertion the shipping configuration must hold runs inline; the
 * mid-loop variant is replayed by the same code so the two differ in exactly
 * one thing.
 */
async function replayEffect(releaseTiming: ReleaseTiming, options: { assertInvariants: boolean }): Promise<ReplayResult> {
    const cache = new CitywideLruCache<Uint8Array>(1_024, 64 * 1024 * 1024);
    const releaseState = createExteriorCacheReleaseState();
    const waves: WaveState[] = WAVES.map((wave) => ({ ...wave, load: createExteriorCellLoadState<ExteriorCellOutcome>(), published: [] }));
    /** Loads in flight, landing `LOAD_LATENCY_DECISIONS` decisions later. */
    const pending: { landsAt: number; releaseId: string; cellIds: readonly string[] }[] = [];
    /** Cells the viewport currently owns, so a retirement can be reported exactly once. */
    const sceneCells = new Set<string>();
    let carry: SchedulerCarry | null = null;
    let peakResident = 0;
    let peakCacheEntries = 0;
    let releasedKeys = 0;
    let releasedThisDecision: string[] = [];
    const releasedThenImmediatelyRequested: ReplayResult["releasedThenImmediatelyRequested"] = [];
    const releasedWhileSettlingThenRequested: ReplayResult["releasedWhileSettlingThenRequested"] = [];

    /** How many waves have applied the decision currently being applied, or null between decisions. */
    let wavesAppliedThisDecision: number | null = null;
    let partiallyAppliedReleasePasses = 0;

    // The App's release pass, gates (b) (c) (d) against live state.
    const runRelease = () => {
      // Checked before the early return: the hazard is that the pass RUNS at
      // this point at all, not that this particular queue happened to be empty.
      if (wavesAppliedThisDecision !== null && wavesAppliedThisDecision < waves.length) partiallyAppliedReleasePasses += 1;
      if (releaseState.pending.size === 0) return;
      const inFlightCellIds = new Set<string>();
      const requestedCellIds = new Set<string>();
      const publishedCacheKeys = new Set<string>();
      for (const wave of waves) {
        for (const cellId of wave.load.inFlight) inFlightCellIds.add(cellId);
        for (const cellId of wave.load.requested) requestedCellIds.add(cellId);
        for (const outcome of wave.load.outcomes.values()) for (const key of exteriorOutcomeCacheKeys(outcome).keys) publishedCacheKeys.add(key);
      }
      const plan = planExteriorCacheRelease(releaseState, { inFlightCellIds, requestedCellIds, publishedCacheKeys });
      commitExteriorCacheRelease(releaseState, plan, (key) => { cache.delete(key); });
      releasedKeys += plan.releaseKeys.length;
      releasedThisDecision.push(...plan.releaseKeys);
    };

    for (const [decisionIndex, sample] of SAMPLES.entries()) {
      // Releases from the settling batches below belong to the PREVIOUS
      // decision — they run while it is still the current one — so they are
      // accumulated separately from the ones the decision taken below causes.
      releasedThisDecision = [];
      // 1. Settle whatever landed. This is the App's `.then`.
      for (const batch of pending.filter((entry) => entry.landsAt === decisionIndex)) {
        const wave = waves.find((candidate) => candidate.releaseId === batch.releaseId)!;
        const outcomes = batch.cellIds.map((cellId) => stubOutcome(batch.releaseId, cellId));
        // The runtime caches every verified artifact as it loads it.
        for (const outcome of outcomes) for (const asset of (outcome as { assets: { artifactRef: string; checksumSha256: string; bytes: Uint8Array; byteSize: number }[] }).assets) {
          cache.set(exteriorArtifactCacheKey(asset.artifactRef, asset.checksumSha256), asset.bytes, asset.byteSize);
        }
        const verdict = acceptExteriorCellOutcomes(wave.load, batch.cellIds, outcomes);
        for (const cellId of verdict.discarded) {
          const outcome = outcomes[batch.cellIds.indexOf(cellId)]!;
          const { keys, byteSize } = exteriorOutcomeCacheKeys(outcome);
          queueExteriorCacheRelease(releaseState, { releaseId: batch.releaseId, cellId, cacheKeys: keys, byteSize, reachedScene: false });
        }
        wave.published = publishedExteriorCellOutcomes(wave.load, wave.declaredCellIds);
        runRelease();
      }
      pending.splice(0, pending.length, ...pending.filter((entry) => entry.landsAt > decisionIndex));
      // Everything released so far this iteration came from a SETTLING batch,
      // which ran while the previous decision was still the current one.
      const releasedWhileSettling = releasedThisDecision;
      releasedThisDecision = [];

      // 2. ONE decision over the static census table.
      const schedule = scheduleExteriorCellsGlobally(waves, { enabled: true, footprint: sample.footprint, camera: sample.camera, heightBucket: sample.heightBucket, previous: carry });
      carry = schedule.carry;
      peakResident = Math.max(peakResident, schedule.residentCellIds.length);

      // 3. Per-wave reconciliation, with the drops queued into the seam.
      wavesAppliedThisDecision = 0;
      for (const wave of waves) {
        const waveSchedule = schedule.byRelease.get(wave.releaseId)!;
        const outcomesBeforeDrop = new Map(wave.load.outcomes);
        const { fresh, dropped } = reconcileExteriorCellLoads(wave.load, waveSchedule.cellIds);
        for (const cellId of dropped) {
          const outcome = outcomesBeforeDrop.get(cellId);
          if (!outcome) continue;
          const { keys, byteSize } = exteriorOutcomeCacheKeys(outcome);
          queueExteriorCacheRelease(releaseState, { releaseId: wave.releaseId, cellId, cacheKeys: keys, byteSize, reachedScene: sceneCells.has(cellId) });
        }
        if (fresh.length > 0) pending.push({ landsAt: decisionIndex + LOAD_LATENCY_DECISIONS, releaseId: wave.releaseId, cellIds: fresh });
        wave.published = publishedExteriorCellOutcomes(wave.load, wave.declaredCellIds);
        wavesAppliedThisDecision += 1;
        // THE DEFECT, modelled. The App used to call the release pass in here,
        // where the waves after this one have not applied the decision yet.
        if (releaseTiming === "mid-loop" && fresh.length === 0) runRelease();
      }
      wavesAppliedThisDecision = null;
      // What the App ships: one pass, after every wave has applied the decision.
      if (releaseTiming === "after-loop") runRelease();

      // 4. The viewport pass: build the overlay, retire what left the scene.
      const overlays: ExteriorCellOverlay[] = waves.map((wave) => ({ releaseId: wave.releaseId, snapshotId: "snapshot:v1", origin: "default", profile: "exploration", cells: wave.published } as ExteriorCellOverlay));
      const renderedEntries = exteriorOverlayRenderEntries(overlays);
      const renderedCells = new Set(renderedEntries.map((entry) => entry.cellId));
      const retired = [...sceneCells].filter((cellId) => !renderedCells.has(cellId));
      sceneCells.clear();
      for (const cellId of renderedCells) sceneCells.add(cellId);
      noteExteriorSceneRetired(releaseState, retired);
      runRelease();

      // (5) nothing released this decision is wanted by this decision. Computed
      // at the END of the decision, when every wave has applied it — which is
      // exactly the state the mid-loop pass could not see.
      const requestedKeysNow = new Set<string>();
      for (const wave of waves) for (const cellId of wave.load.requested) requestedKeysNow.add(cacheKeyForCell(cellId));
      for (const cacheKey of releasedThisDecision) {
        if (requestedKeysNow.has(cacheKey)) releasedThenImmediatelyRequested.push({ decisionIndex, cacheKey });
      }
      for (const cacheKey of releasedWhileSettling) {
        if (requestedKeysNow.has(cacheKey)) releasedWhileSettlingThenRequested.push({ decisionIndex, cacheKey });
      }

      // --- invariants, every decision ---
      if (options.assertInvariants) {
        const publishedCells = new Set(waves.flatMap((wave) => wave.published.map((outcome) => outcome.cellId)));
        for (const wave of waves) {
          for (const outcome of wave.published) {
            // (1) nothing renders because a request that predates its eviction landed.
            expect(wave.load.requested.has(outcome.cellId), `decision ${decisionIndex} published unrequested ${outcome.cellId}`).toBe(true);
          }
        }
        // (2) the overlay draws only published cells.
        for (const cellId of renderedCells) expect(publishedCells.has(cellId), `decision ${decisionIndex} drew unpublished ${cellId}`).toBe(true);
        // (3) every artifact a published outcome names is still cached.
        for (const wave of waves) {
          for (const outcome of wave.published) {
            for (const key of exteriorOutcomeCacheKeys(outcome).keys) {
              expect(cache.has(key), `decision ${decisionIndex} released bytes still rendered by ${outcome.cellId}`).toBe(true);
            }
          }
        }
        // (4) one pool, one bound.
        expect(schedule.residentCellIds.length).toBeLessThanOrEqual(EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY.maxResidentUnits);
      }
      peakCacheEntries = Math.max(peakCacheEntries, cache.size());
      await Promise.resolve();
    }

  return { peakResident, peakCacheEntries, releasedKeys, cacheEvictions: cache.evictionCount(), releasedArtifactBytes: releaseState.releasedArtifactBytes, releasedThenImmediatelyRequested, releasedWhileSettlingThenRequested, partiallyAppliedReleasePasses };
}

describe("the App cell-loading effect under one global decision", () => {
  it("never renders a cell the scheduler evicted, and never frees bytes something still renders", async () => {
    const result = await replayEffect("after-loop", { assertInvariants: true });
    // The seam did real work over the session rather than sitting inert.
    expect(result.releasedKeys).toBeGreaterThan(100);
    expect(result.releasedArtifactBytes).toBe(result.releasedKeys * ARTIFACT_BYTES);
    expect(result.peakResident).toBe(EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY.maxResidentUnits);
    // And the cache stayed governed BY THE SCHEDULER rather than by the LRU:
    // the ceilings were never approached, and no recency eviction ever fired.
    expect(result.cacheEvictions).toBe(0);
    expect(result.peakCacheEntries).toBeLessThanOrEqual(EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY.maxResidentUnits * 2);
  });

  /**
   * B1's gate, and the reason the placement of the release pass is a decision
   * rather than an accident.
   *
   * Gate 1 reads the APPLIED per-wave `requested` sets. Run the pass after the
   * whole loop and it sees the decision the session actually took; run it
   * inside, and a candidate whose cell belongs to a wave later in iteration
   * order is released microseconds before that wave asks for it — a redundant
   * refetch, and `releasedArtifactBytes` counting bytes that came straight back.
   */
  it("never runs a release pass while a decision is only partially applied, which the mid-loop placement did", async () => {
    const shipped = await replayEffect("after-loop", { assertInvariants: true });
    // The structural property: no pass ever reads a `requested` union that
    // covers only the waves iterated so far.
    expect(shipped.partiallyAppliedReleasePasses).toBe(0);
    // And the symptom it rules out, over 58 real camera samples.
    expect(shipped.releasedThenImmediatelyRequested).toEqual([]);

    // The pre-fix placement, replayed by the same code. It reads a partially
    // applied decision hundreds of times per session.
    const midLoop = await replayEffect("mid-loop", { assertInvariants: false });
    // 238 before the T005 D-4 ranking, 243 after it, 248 at the T005 serving
    // cap of 8. The count is the number of times the pre-fix placement reads a
    // partially applied decision, so it tracks how many decisions have a
    // non-empty per-wave load at all — and a tighter residency cap means the
    // admitted set turns over on more decisions, so more of them load something.
    // It is re-derived at each configuration rather than relaxed, and it is
    // deliberately NOT the thing this test is about: the structural assertions
    // above are, and they are unchanged at 0 and [].
    expect(midLoop.partiallyAppliedReleasePasses).toBe(248);

    // HONEST LIMIT, stated rather than papered over: on THIS trace the mid-loop
    // placement produces no observed symptom, because the retirement pass at
    // the end of each decision drains the queue before the next decision's loop
    // begins, so no candidate survives into a loop for the early pass to get
    // wrong. That makes the symptom trace-dependent and the hazard structural,
    // which is why the assertion above is on the structure. The seam-level
    // demonstration that a partially applied `requestedCellIds` really does
    // release a candidate the complete one keeps lives in
    // `exterior-cache-release.test.ts`.
    expect(midLoop.releasedThenImmediatelyRequested).toEqual([]);
  });

  /**
   * The residual race, counted rather than claimed to be absent.
   *
   * A batch that settles between two decisions is discarded against the
   * CURRENT decision, which genuinely does not want the cell; the next decision
   * may re-admit it. No placement of the release pass can consult a decision
   * that has not been taken, so this is not fixable by ordering and is not
   * fixed.
   *
   * It cost 2 before the T005 D-4 ranking, 1 after it, and 0 on this trace at
   * the T005 serving cap of 8. ZERO IS NOT A FIX AND IS NOT CLAIMED AS ONE: the
   * race is structural and still unfixable by ordering. What changed is the
   * opportunity for it — a cell has to be admitted, settle late, be dropped, and
   * be re-admitted, and a cap of 8 admits so much less of the island per
   * decision that this trace never produces the sequence.
   *
   * So the assertion is written as a BOUND rather than as an equality: at most
   * one on this trace, and a vanishing fraction of the session's releases. An
   * equality on 0 would turn a trace-dependent absence into a claimed property
   * and would fail the moment a different trace produced the race that is still
   * there.
   */
  it("pays a bounded refetch for loads that settle between two decisions", async () => {
    const shipped = await replayEffect("after-loop", { assertInvariants: false });
    expect(shipped.releasedWhileSettlingThenRequested.length).toBeLessThanOrEqual(1);
    // Small against the session's total release volume rather than merely small.
    expect(shipped.releasedWhileSettlingThenRequested.length / shipped.releasedKeys).toBeLessThan(0.01);
    // The replay really did release a substantial number of keys, so the ratio
    // above is a measurement rather than a division by almost nothing.
    expect(shipped.releasedKeys).toBeGreaterThan(100);
  });

  /**
   * The same replay with the release seam removed, which is what an unflagged
   * session is: nothing enqueues, so nothing is ever freed. Residency in the
   * CACHE grows monotonically even though the scheduler is evicting, which is
   * precisely the state T002 shipped.
   */
  it("grows without bound when nothing releases, which is what the seam changes", async () => {
    const cache = new CitywideLruCache<Uint8Array>(4_096, 512 * 1024 * 1024);
    const waves: WaveState[] = WAVES.map((wave) => ({ ...wave, load: createExteriorCellLoadState<ExteriorCellOutcome>(), published: [] }));
    let carry: SchedulerCarry | null = null;
    let previousEntries = 0;
    let monotone = true;

    for (const sample of SAMPLES) {
      const schedule = scheduleExteriorCellsGlobally(waves, { enabled: true, footprint: sample.footprint, camera: sample.camera, heightBucket: sample.heightBucket, previous: carry });
      carry = schedule.carry;
      for (const wave of waves) {
        const { fresh } = reconcileExteriorCellLoads(wave.load, schedule.byRelease.get(wave.releaseId)!.cellIds);
        const outcomes = fresh.map((cellId) => stubOutcome(wave.releaseId, cellId));
        for (const outcome of outcomes) for (const asset of (outcome as { assets: { artifactRef: string; checksumSha256: string; bytes: Uint8Array; byteSize: number }[] }).assets) {
          cache.set(exteriorArtifactCacheKey(asset.artifactRef, asset.checksumSha256), asset.bytes, asset.byteSize);
        }
        acceptExteriorCellOutcomes(wave.load, fresh, outcomes);
      }
      if (cache.size() < previousEntries) monotone = false;
      previousEntries = cache.size();
      await Promise.resolve();
    }

    expect(monotone).toBe(true);
    // Far more than the cap ever held resident: the scheduler's evictions were
    // invisible to the cache.
    expect(cache.size()).toBeGreaterThan(EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY.maxResidentUnits * 2);
    expect(cache.evictionCount()).toBe(0);
  });
});
