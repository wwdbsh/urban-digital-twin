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
 *
 * WHAT MOVED UNDER IT SINCE. This record measured the six CURATED releases at a
 * 512-entry cache cap. T005 promoted six `-s1` serving successors over them and
 * raised the live cap to 1,024 in the same commit. Neither fact changes what was
 * measured, and neither is allowed to quietly re-point an assertion here: the
 * composition is compared against the live records' PREDECESSOR chain, which is
 * what this record is about, and the cap is held to the literal it ran at while
 * the raise is asserted separately against the live constant.
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
  note: string;
  crossCheck: { samplesMatchedToInventory: number; checksumMismatchCount: number; renderCount: number; shippedAssetCount: number; sampledShareOfShipped: number; statement: string };
  summary: { sampleCount: number; texturedSampleCount: number; maximumTriangleDelta: number; materialMismatchCount: number; notSolidCount: number; texturesUnreachableCount: number; minimumUvLayerCount: number; maximumVolumeDeviation: number };
  samples: { buildingId: string; volumeDeviation: number }[];
}

const inventory = readJson<Inventory>(`${RECORD_ROOT}/payload-inventory.json`);
const acceptance = readJson<Acceptance>(`${RECORD_ROOT}/acceptance-evidence.json`);
const journeys = readJson<Journeys>(`${RECORD_ROOT}/journey-evidence.json`);
const blender = readJson<BlenderRecord>(`${RECORD_ROOT}/blender-sample.json`);
const census = readJson<{ releaseId: string; volumeIdentity: Record<string, number | string> }>(`${RECORD_ROOT}/wave-census.json`);

/**
 * The cache entry cap in force WHEN THIS MEASUREMENT RAN, as a literal. T005
 * raised the live cap after capture; see the module docblock.
 */
const CACHE_ENTRY_CAP_AT_MEASUREMENT = 512;

/**
 * The composition this record measured: the six CURATED releases, derived from
 * the live promotion set rather than hand-typed.
 *
 * Every live record is a T005 serving promotion whose `predecessor` is the
 * curated record it replaced, so the predecessor chain IS the measured set. A
 * seventh wave, or a curated record swapped underneath a serving one, still
 * moves this list and still fails here — which is the property the original
 * comparison against the promotion set was protecting.
 */
// T001 promoted the two-LOD releases over the -s1 serving set, so the curated
// rung this record measured is now TWO links down the predecessor chain.
const CURATED_PROMOTION_SET = EXTERIOR_DEFAULT_ACTIVATIONS.flatMap((record) => {
  if (!record.enabled || !record.predecessor.enabled) return [];
  const serving = record.predecessor;
  return serving.predecessor.enabled ? [serving.predecessor.releaseId] : [serving.releaseId];
});

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
    // The list is still derived from the build's own records rather than
    // hand-typed — but from the PREDECESSOR chain, because the promotion set
    // itself now names the six `-s1` serving successors, which this record did
    // not measure and must not be said to have measured.
    expect(acceptance.promotedReleaseIds).toEqual(CURATED_PROMOTION_SET);
    expect(CURATED_PROMOTION_SET).toHaveLength(6);
    // And the successors are genuinely different releases, so the substitution
    // above is a real distinction rather than two names for one thing.
    const servingSet = EXTERIOR_DEFAULT_ACTIVATIONS.flatMap((record) => (record.enabled ? [record.releaseId] : []));
    expect(servingSet).toHaveLength(6);
    expect(servingSet.every((releaseId) => !acceptance.promotedReleaseIds.includes(releaseId))).toBe(true);
  });

  it("was taken at the cap in force that day, and the raise since is stated", () => {
    expect(acceptance.capAtMeasurement.maxCacheEntries).toBe(CACHE_ENTRY_CAP_AT_MEASUREMENT);
    expect(acceptance.runtimeBudgets.maxCacheEntries).toBe(CACHE_ENTRY_CAP_AT_MEASUREMENT);
    expect(CACHE_ENTRY_CAP_AT_MEASUREMENT).toBe(512);
    // T005 doubled the live entry cap AFTER this reading. Asserting the record
    // against the live constant would date the reading to a cap that did not
    // exist when it ran, so the move is stated instead.
    expect(EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries).toBe(1_024);
    expect(EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries).toBe(CACHE_ENTRY_CAP_AT_MEASUREMENT * 2);
    // The byte cap did not move, so it is still compared live.
    expect(acceptance.capAtMeasurement.maxCachedBytes).toBe(EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes);
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
    // Entries are judged against the cap of the day; bytes against the live cap,
    // which is the same number it was.
    expect(acceptance.cacheResidency.worstObserved.entries).toBeLessThanOrEqual(CACHE_ENTRY_CAP_AT_MEASUREMENT);
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
  /**
   * THE PROSE MAY NOT NAME A COUNT THE RECORD DOES NOT CARRY.
   *
   * This record's note used to be assembled from a suffix shared with the canary,
   * so the promoted successor shipped with prose claiming a 69-of-76 sample and
   * SIXTEEN refusals beside a summary stating 24 samples and zero refusals. Every
   * machine-readable field was correct; the sentences a human actually reads were
   * about a different release. Checksums cannot see that, and neither could any
   * gate that existed.
   *
   * So every number in the human-readable prose is required to be a number this
   * record — or the committed inventory and census it is about — actually carries.
   * Identifier-shaped tokens are stripped first and named here rather than
   * silently skipped: `T022`, `w05`, `LOD 0`, `SHA-256`, `P1`, and the schema
   * version, and any `…Sha256` field name. What is left is claims, and claims
   * must be checkable.
   */
  it("names no count in its prose that its own numbers do not support", () => {
    const prose = `${blender.note} ${blender.crossCheck.statement}`;
    const stripped = prose
      .replace(/\bT\d+\b/gu, "")
      .replace(/\bw\d+\b/gu, "")
      .replace(/SHA-256/gu, "")
      .replace(/[A-Za-z]*[Ss]ha256/gu, "")
      .replace(/\bP\d\b/gu, "")
      .replace(/\bLOD \d\b/gu, "")
      .replace(/\bv?\d+\.\d+\.\d+\b/gu, "");
    const allowed = new Set<string>();
    const admit = (value: unknown) => {
      if (typeof value !== "number" || !Number.isFinite(value)) return;
      allowed.add(String(value));
      allowed.add(String(Math.round(value)));
      allowed.add(value.toFixed(4));
      allowed.add(value.toFixed(4).replace(/0+$/u, "").replace(/\.$/u, ""));
    };
    for (const value of Object.values(blender.summary)) admit(value);
    for (const value of Object.values(blender.crossCheck)) admit(value);
    for (const value of Object.values(inventory.stats)) admit(value);
    for (const value of Object.values(census.volumeIdentity)) admit(value);
    admit(1);

    const named = stripped.match(/\d+(?:\.\d+)?/gu) ?? [];
    expect(named.length).toBeGreaterThan(0);
    for (const token of named) {
      expect({ token, supported: allowed.has(token) }).toEqual({ token, supported: true });
    }

    // And the sampling language must match the share the record computed. A
    // record whose strata selected everything must not describe a remainder.
    expect(blender.crossCheck.sampledShareOfShipped).toBe(1);
    // Not the WORD — this record uses it to say there is no remainder — but a
    // COUNTED remainder, which is what a record whose share is 1 cannot have.
    expect(prose).not.toMatch(/\d+ unsampled/u);
    expect(prose).not.toMatch(/is a SAMPLE and is described as one/u);
    expect(prose).toMatch(/CENSUS/u);
  });

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
    expect(census.volumeIdentity.worstDeviationAsFractionOfTolerance as number).toBeGreaterThan(0.9);

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
