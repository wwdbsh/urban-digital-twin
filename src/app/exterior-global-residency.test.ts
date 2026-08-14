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
 *   4. residency stays inside the global cap, so one pool really is one bound.
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

describe("the App cell-loading effect under one global decision", () => {
  it("never renders a cell the scheduler evicted, and never frees bytes something still renders", async () => {
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

    // The App's release pass, gates (b) (c) (d) against live state.
    const runRelease = () => {
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
    };

    for (const [decisionIndex, sample] of SAMPLES.entries()) {
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

      // 2. ONE decision over the static census table.
      const schedule = scheduleExteriorCellsGlobally(waves, { enabled: true, footprint: sample.footprint, camera: sample.camera, heightBucket: sample.heightBucket, previous: carry });
      carry = schedule.carry;
      peakResident = Math.max(peakResident, schedule.residentCellIds.length);

      // 3. Per-wave reconciliation, with the drops queued into the seam.
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
      }

      // 4. The viewport pass: build the overlay, retire what left the scene.
      const overlays: ExteriorCellOverlay[] = waves.map((wave) => ({ releaseId: wave.releaseId, snapshotId: "snapshot:v1", origin: "default", profile: "exploration", cells: wave.published } as ExteriorCellOverlay));
      const renderedEntries = exteriorOverlayRenderEntries(overlays);
      const renderedCells = new Set(renderedEntries.map((entry) => entry.cellId));
      const retired = [...sceneCells].filter((cellId) => !renderedCells.has(cellId));
      sceneCells.clear();
      for (const cellId of renderedCells) sceneCells.add(cellId);
      noteExteriorSceneRetired(releaseState, retired);
      runRelease();

      // --- invariants, every decision ---
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
      peakCacheEntries = Math.max(peakCacheEntries, cache.size());
      await Promise.resolve();
    }

    // The seam did real work over the session rather than sitting inert.
    expect(releasedKeys).toBeGreaterThan(100);
    expect(releaseState.releasedArtifactBytes).toBe(releasedKeys * ARTIFACT_BYTES);
    expect(peakResident).toBe(EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY.maxResidentUnits);
    // And the cache stayed governed BY THE SCHEDULER rather than by the LRU:
    // the ceilings were never approached, and no recency eviction ever fired.
    expect(cache.evictionCount()).toBe(0);
    expect(peakCacheEntries).toBeLessThanOrEqual(EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY.maxResidentUnits * 2);
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
