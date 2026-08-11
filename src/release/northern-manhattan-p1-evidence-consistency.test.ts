/**
 * The committed T022 EVIDENCE is checked against the release it claims to be
 * about — the T019-review hardening, carried forward and extended.
 *
 * A SIBLING of `northern-manhattan-evidence-consistency.test.ts`, which stays
 * exactly as it is and keeps checking the T021 CANARY's evidence against the
 * canary. Two releases of one wave carry two independent evidence sets, and one
 * suite that tried to cover both would have to be told which record it was
 * reading; two suites cannot be confused about it.
 *
 * Acceptance and journey evidence are captured by scripts that talk to a browser,
 * so nothing in the ordinary test run can re-take those readings. What CAN be
 * checked, on every run and without a browser, is that the readings describe THIS
 * release: the same release id, the same asset count, the same tombstone count,
 * the same curated cell, and a bundle that was identified before capture. A record
 * that drifted from the release — because the payload was re-emitted, or because
 * an evidence file was carried over from another wave — fails here rather than
 * sitting in the repository looking like evidence.
 *
 * It deliberately does NOT re-judge the measurements. Whether 3.60 ms is fast is
 * the ADR's statement; whether 3.60 ms was measured on these bytes is this
 * suite's.
 *
 * WHAT IS NEW HERE. Two things this wave's evidence has to say that no earlier
 * wave's did:
 *
 *  - the composition measured is SIX waves, and every one of them is named in
 *    the acceptance record and delivered assets in the cold-load journey, so
 *    "the whole ledger streams" is checked against the readings rather than
 *    asserted in prose;
 *  - RESIDENCY IS DERIVED FROM DISTINCT ARTIFACTS, not from responses. At six
 *    waves those stop being the same number, and a record that conflated them
 *    would overstate occupancy against a 512-entry cap it is close to.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NORTHERN_MANHATTAN_P1_RELEASE_ID } from "./northern-manhattan-p1-release";
import { NORTHERN_MANHATTAN_RELEASE_ID } from "./northern-manhattan-package";
import { NORTHERN_MANHATTAN_CURATED_CELLS } from "./northern-manhattan-curation";
import { EXTERIOR_RUNTIME_BUDGETS } from "../runtime/exterior-cell-runtime";
import { EXTERIOR_DEFAULT_ACTIVATIONS } from "../runtime/exterior-default-activation";

const RECORD_ROOT = "data/northern-manhattan-20260812-p1";

function readJson<T>(path: string): T {
  return JSON.parse(new TextDecoder().decode(readFileSync(path))) as T;
}

interface Inventory {
  releaseId: string;
  renderableCellIds: string[];
  stats: Record<string, number>;
  files: { path: string; byteSize: number; checksumSha256: string }[];
}
interface ServedBundle {
  previewBase: string;
  matchesLocalDist: boolean;
  entryScriptNamesRelease: boolean;
  entryScriptChecksumSha256: string;
}
interface Acceptance {
  releaseId: string;
  servedBundle: ServedBundle;
  capAtMeasurement: { maxCacheEntries: number; maxCachedBytes: number };
  runtimeBudgets: { maxCacheEntries: number; maxCachedBytes: number };
  promotedReleaseIds: string[];
  cappedControl: { frameMilliseconds?: { p50Milliseconds: number } };
  gpuTextureArithmetic: { basis: string; assetCount: number; imageCount: number };
  cacheResidency: {
    perRun: { entries: number; glbResponses: number; bytes: number }[];
    worstObserved: { entries: number; bytes: number };
    withinEntryBudget: boolean;
    withinByteBudget: boolean;
    releaseTimeDerivation: { residentAssetEntries: number; thisWaveAssetEntries: number; reservedForThisWaveEntries: number; unspentReservedEntries: number };
  };
  stations: { stationId: string; p50WithinBudget: boolean; p95WithinBudget: boolean; worstObservedFrameMilliseconds: number; p50OverCappedControlP50: number | null }[];
  captures: { network: { externalHosts: string[] } }[];
}
interface Journeys {
  releaseId: string;
  servedBundle: ServedBundle;
  allPassed: boolean;
  journeys: {
    journeyId: string;
    passed: boolean;
    perWaveGlbCounts?: Record<string, { responses: number; distinctArtifacts: number }>;
    network?: { perRelease: Record<string, { glbCount: number; distinctGlbCount: number }>; externalHosts: string[] };
    waveNotice?: string | null;
    texturedComparison?: { stillsDiffer: boolean };
    detail?: { rows: Record<string, string> } | null;
  }[];
}
interface BlenderRecord {
  releaseId: string;
  summary: { sampleCount: number; texturedSampleCount: number; maximumTriangleDelta: number; materialMismatchCount: number; notSolidCount: number; texturesUnreachableCount: number; minimumUvLayerCount: number; maximumVolumeDeviation: number };
  samples: { buildingId: string; volumeDeviation: number }[];
}

const inventory = readJson<Inventory>(`${RECORD_ROOT}/payload-inventory.json`);
const acceptance = readJson<Acceptance>(`${RECORD_ROOT}/acceptance-evidence.json`);
const journeys = readJson<Journeys>(`${RECORD_ROOT}/journey-evidence.json`);
const blender = readJson<BlenderRecord>(`${RECORD_ROOT}/blender-sample.json`);
const census = readJson<{ releaseId: string; volumeIdentity: { worstDeviationAsFractionOfTolerance: number } }>(`${RECORD_ROOT}/wave-census.json`);

describe("every committed evidence record is about THIS release", () => {
  it("names the same release id in all four records", () => {
    expect(inventory.releaseId).toBe(NORTHERN_MANHATTAN_P1_RELEASE_ID);
    expect(acceptance.releaseId).toBe(NORTHERN_MANHATTAN_P1_RELEASE_ID);
    expect(journeys.releaseId).toBe(NORTHERN_MANHATTAN_P1_RELEASE_ID);
    expect(blender.releaseId).toBe(NORTHERN_MANHATTAN_P1_RELEASE_ID);
    // ...and none of them is the canary's, which is the drift this catches.
    expect(blender.releaseId).not.toBe(NORTHERN_MANHATTAN_RELEASE_ID);
  });

  it("identified the SAME served bundle for both browser passes, before capture", () => {
    expect(acceptance.servedBundle.matchesLocalDist).toBe(true);
    expect(acceptance.servedBundle.entryScriptNamesRelease).toBe(true);
    expect(journeys.servedBundle.matchesLocalDist).toBe(true);
    expect(journeys.servedBundle.entryScriptNamesRelease).toBe(true);
    // One build, two passes: a journey run against a different bundle than the
    // acceptance run would make the two records incomparable.
    expect(journeys.servedBundle.entryScriptChecksumSha256).toBe(acceptance.servedBundle.entryScriptChecksumSha256);
  });
});

describe("the acceptance measurement describes the shipped bytes", () => {
  it("measured a SIX-wave composition, and names every promoted release", () => {
    expect(acceptance.promotedReleaseIds).toHaveLength(6);
    expect(acceptance.promotedReleaseIds.at(-1)).toBe(NORTHERN_MANHATTAN_P1_RELEASE_ID);
    // The list is the build's own promotion set, not a hand-typed one.
    expect(acceptance.promotedReleaseIds)
      .toEqual(EXTERIOR_DEFAULT_ACTIVATIONS.filter((record) => record.enabled).map((record) => (record.enabled ? record.releaseId : "")));
  });

  it("was taken at the cap this build actually carries, and the cap did not move", () => {
    expect(acceptance.capAtMeasurement.maxCacheEntries).toBe(EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries);
    expect(acceptance.capAtMeasurement.maxCachedBytes).toBe(EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes);
    expect(acceptance.runtimeBudgets.maxCacheEntries).toBe(512);
    expect(acceptance.runtimeBudgets.maxCachedBytes).toBe(256 * 1024 * 1024);
  });

  it("counted the images the shipped assets actually embed, and labels the figure COMPUTED", () => {
    expect(acceptance.gpuTextureArithmetic.basis).toBe("computed-not-measured");
    expect(acceptance.gpuTextureArithmetic.assetCount).toBe(inventory.stats.shippedAssetCount);
    expect(acceptance.gpuTextureArithmetic.assetCount).toBe(24);
    expect(acceptance.gpuTextureArithmetic.imageCount).toBe(blender.summary.sampleCount * 3);
  });

  it("is off the vsync floor, and says so as a comparison rather than a claim", () => {
    const control = acceptance.cappedControl.frameMilliseconds?.p50Milliseconds;
    expect(typeof control).toBe("number");
    expect(control!).toBeGreaterThan(7);
    for (const station of acceptance.stations) {
      expect({ stationId: station.stationId, offFloor: (station.p50OverCappedControlP50 ?? 1) < 0.75 })
        .toEqual({ stationId: station.stationId, offFloor: true });
    }
  });

  it("is inside both frame budgets at every station, and states its worst frames", () => {
    for (const station of acceptance.stations) {
      expect({ stationId: station.stationId, p50: station.p50WithinBudget, p95: station.p95WithinBudget })
        .toEqual({ stationId: station.stationId, p50: true, p95: true });
      // Isolated slow frames are STATED, not smoothed: every station carries a
      // worst-observed reading and it is larger than its p95 at least somewhere,
      // so the record cannot be read as "no frame ever exceeded the budget".
      expect(station.worstObservedFrameMilliseconds).toBeGreaterThan(0);
    }
    expect(acceptance.stations.some((station) => station.worstObservedFrameMilliseconds > 45)).toBe(true);
  });

  /**
   * RESIDENCY IS ABOUT ENTRIES, SO IT IS DERIVED FROM DISTINCT ARTIFACTS. The two
   * counts are recorded per run so a session that evicted and re-fetched is
   * visible rather than absorbed into an inflated occupancy figure.
   */
  it("derives residency from distinct artifacts and stays inside both cache budgets", () => {
    expect(acceptance.cacheResidency.withinEntryBudget).toBe(true);
    expect(acceptance.cacheResidency.withinByteBudget).toBe(true);
    expect(acceptance.cacheResidency.worstObserved.entries).toBeLessThanOrEqual(EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries);
    expect(acceptance.cacheResidency.worstObserved.bytes).toBeLessThanOrEqual(EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes);
    for (const run of acceptance.cacheResidency.perRun) {
      // Entries can never exceed responses: one artifact is fetched at least once.
      expect({ entries: run.entries, ok: run.entries <= run.glbResponses }).toEqual({ entries: run.entries, ok: true });
    }
  });

  it("carries the ledger-wide release-time end state, and it agrees with the inventory", () => {
    const derivation = acceptance.cacheResidency.releaseTimeDerivation;
    expect(derivation.thisWaveAssetEntries).toBe(inventory.stats.shippedAssetCount);
    expect(derivation.residentAssetEntries).toBe(498);
    expect(derivation.reservedForThisWaveEntries).toBe(36);
    expect(derivation.unspentReservedEntries).toBe(36 - derivation.thisWaveAssetEntries);
    expect(derivation.unspentReservedEntries).toBe(12);
  });

  it("reached no external host in any capture", () => {
    for (const capture of acceptance.captures) expect(capture.network.externalHosts).toEqual([]);
  });
});

describe("the journey evidence describes the shipped bytes", () => {
  it("passed every journey", () => {
    expect(journeys.allPassed).toBe(true);
    expect(journeys.journeys.map((journey) => journey.journeyId)).toEqual([
      "cold-default", "cross-wave-pick", "canary-opt-in", "streaming-off", "tombstone-truth",
    ]);
  });

  it("streamed all SIX waves cold, with every wave's delivered asset count named", () => {
    const cold = journeys.journeys.find((journey) => journey.journeyId === "cold-default")!;
    const counts = cold.perWaveGlbCounts!;
    expect(Object.keys(counts)).toHaveLength(6);
    for (const [releaseId, count] of Object.entries(counts)) {
      expect({ releaseId, delivered: count.distinctArtifacts > 0 }).toEqual({ releaseId, delivered: true });
      expect({ releaseId, ok: count.distinctArtifacts <= count.responses }).toEqual({ releaseId, ok: true });
    }
    // THIS release's count is exact, because every one of its assets is expected.
    expect(counts[NORTHERN_MANHATTAN_P1_RELEASE_ID]!.distinctArtifacts).toBe(inventory.stats.shippedAssetCount);
    // The canary is not promoted, so a clean load must fetch none of its bytes.
    expect(cold.network!.perRelease[NORTHERN_MANHATTAN_RELEASE_ID]!.glbCount).toBe(0);
    expect(cold.network!.externalHosts).toEqual([]);
  });

  it("picked a w05 building and read seven provenance rows off it", () => {
    const pick = journeys.journeys.find((journey) => journey.journeyId === "cross-wave-pick")!;
    const rows = pick.detail?.rows ?? {};
    expect(Object.keys(rows)).toEqual([
      "Release origin", "Render profile", "Cell / release", "Active asset", "Truth tiers", "Source dates", "Uncertainty",
    ]);
    expect(rows["Cell / release"]).toContain(NORTHERN_MANHATTAN_CURATED_CELLS[0]!.cellId);
  });

  it("proved the tiles are DRAWN, by a still that differs at the identical pose", () => {
    const off = journeys.journeys.find((journey) => journey.journeyId === "streaming-off")!;
    expect(off.texturedComparison?.stillsDiffer).toBe(true);
  });

  it("read the tombstone count this release actually ships", () => {
    const tombstone = journeys.journeys.find((journey) => journey.journeyId === "tombstone-truth")!;
    expect(tombstone.waveNotice).toContain(`${inventory.stats.notShippedCellCount} of ${inventory.stats.cellCount}`);
    expect(tombstone.waveNotice).toContain("181 of 182");
  });
});

describe("the Blender pass measured the assets this release shipped", () => {
  it("re-imported EVERY shipped asset, not a sample of them", () => {
    expect(blender.summary.sampleCount).toBe(inventory.stats.shippedAssetCount);
    expect(blender.summary.sampleCount).toBe(24);
    expect(blender.summary.texturedSampleCount).toBe(24);
  });

  it("agrees with the declared geometry and finds every tile reachable", () => {
    expect(blender.summary.maximumTriangleDelta).toBe(0);
    expect(blender.summary.materialMismatchCount).toBe(0);
    expect(blender.summary.notSolidCount).toBe(0);
    expect(blender.summary.texturesUnreachableCount).toBe(0);
    expect(blender.summary.minimumUvLayerCount).toBeGreaterThanOrEqual(1);
  });

  /**
   * THE VOLUME CORROBORATION ADR 0037 ASKED FOR.
   *
   * The wave's writer-side worst accepted deviation is 0.9895 of tolerance, which
   * is the narrowest the identity has ever passed. The curated subset's own is far
   * better — but "far better" measured by the same implementation that produced
   * the geometry is the writer grading its own arithmetic. So the check is that an
   * INDEPENDENT implementation, importing the shipped bytes into Blender, lands on
   * the same order of magnitude and picks out the same two worst buildings.
   *
   * It is NOT asserted that the two implementations agree on the ORDER of those
   * two. They do not: the writer ranks `doitt:514180` worst and Blender ranks
   * `doitt:365535` worst, by a margin far below either measurement's own noise
   * floor. Claiming agreement on the ranking would be claiming precision neither
   * has; what agreement there is — the set and the magnitude — is what is checked.
   */
  it("independently corroborates the curated subset's volume margin", () => {
    const tolerance = 0.000001;
    expect(blender.summary.maximumVolumeDeviation).toBeLessThan(tolerance);
    // Same order of magnitude as the writer's, and far below the WAVE's 0.9895.
    expect(blender.summary.maximumVolumeDeviation / tolerance).toBeLessThan(0.25);
    expect(census.volumeIdentity.worstDeviationAsFractionOfTolerance).toBeGreaterThan(0.9);

    const worstTwo = [...blender.samples]
      .sort((left, right) => Math.abs(right.volumeDeviation) - Math.abs(left.volumeDeviation))
      .slice(0, 2)
      .map((sample) => sample.buildingId)
      .sort();
    expect(worstTwo).toEqual(["doitt:365535", "doitt:514180"]);
    // The writer's own worst-margin building is among them, measured independently
    // at the same magnitude rather than merely present in the sample.
    const writerWorst = blender.samples.find((sample) => sample.buildingId === "doitt:514180")!;
    expect(Math.abs(writerWorst.volumeDeviation) / tolerance).toBeGreaterThan(0.1);
    expect(Math.abs(writerWorst.volumeDeviation) / tolerance).toBeLessThan(0.25);
  });
});
