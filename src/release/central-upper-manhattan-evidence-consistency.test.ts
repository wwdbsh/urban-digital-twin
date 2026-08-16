/**
 * The committed T020 EVIDENCE is checked against the release it claims to be
 * about — the hardening the T019 review suggested and no earlier wave carried.
 *
 * Acceptance and journey evidence are captured by scripts that talk to a browser,
 * so nothing in the ordinary test run can re-take those readings. What CAN be
 * checked, on every run and without a browser, is that the readings describe THIS
 * release: the same release id, the same asset count, the same tombstone count,
 * the same curated cells, and a bundle that was identified before capture. A
 * record that drifted from the release — because the payload was re-emitted, or
 * because an evidence file was carried over from another wave — fails here rather
 * than sitting in the repository looking like evidence.
 *
 * It deliberately does NOT re-judge the measurements. Whether 3.30 ms is fast is
 * the ADR's statement; whether 3.30 ms was measured on these bytes is this
 * suite's.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID } from "./central-upper-manhattan-p1-release";
import { CENTRAL_UPPER_MANHATTAN_RELEASE_ID } from "./central-upper-manhattan-package";
import { CENTRAL_UPPER_MANHATTAN_CURATED_CELLS } from "./central-upper-manhattan-curation";
import { EXTERIOR_RUNTIME_BUDGETS } from "../runtime/exterior-cell-runtime";

const RECORD_ROOT = "data/central-upper-manhattan-20260812-p1";

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
    worstObserved: { entries: number; bytes: number };
    withinEntryBudget: boolean;
    withinByteBudget: boolean;
    releaseTimeDerivation: { residentAssetEntries: number; thisWaveAssetEntries: number; reservedForNorthernManhattanEntries: number };
  };
  stations: { stationId: string; p50WithinBudget: boolean; p95WithinBudget: boolean; p50OverCappedControlP50: number | null }[];
  captures: { network: { externalHosts: string[] } }[];
}
interface Journeys {
  releaseId: string;
  servedBundle: ServedBundle;
  allPassed: boolean;
  journeys: { journeyId: string; passed: boolean; network?: { perRelease: Record<string, { glbCount: number }>; externalHosts: string[] }; waveNotice?: string | null; texturedComparison?: { stillsDiffer: boolean } }[];
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

const SHIPPED_ASSET_COUNT = inventory.stats.shippedAssetCount!;

/**
 * The cache entry cap that was in force WHEN THIS MEASUREMENT RAN, as a literal.
 *
 * It used to be read from `EXTERIOR_RUNTIME_BUDGETS`, which was true while the
 * two agreed. T005 raised the live cap to 1,024 after this record was captured,
 * and re-pointing the assertions below at the live constant would claim a past
 * reading was taken at a cap that did not exist when it ran. So the historical
 * cap is named here and the record is held to it, while the RAISE is asserted
 * separately against the live constant — the record says "taken at 512, and the
 * build now ships 1,024" rather than silently tracking a moving number.
 */
const CACHE_ENTRY_CAP_AT_MEASUREMENT = 512;

describe("every committed T020 evidence record is about THIS release", () => {
  it("names the promoted release, never the canary", () => {
    for (const record of [inventory, acceptance, journeys, blender]) {
      expect(record.releaseId).toBe(CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID);
      expect(record.releaseId).not.toBe(CENTRAL_UPPER_MANHATTAN_RELEASE_ID);
    }
  });

  it("was captured against a bundle identified BEFORE capture, and the same one twice", () => {
    for (const bundle of [acceptance.servedBundle, journeys.servedBundle]) {
      expect(bundle.matchesLocalDist).toBe(true);
      expect(bundle.entryScriptNamesRelease).toBe(true);
      expect(bundle.entryScriptChecksumSha256).toMatch(/^[0-9a-f]{64}$/u);
    }
    // The acceptance run and the journey run measured the SAME build. Two
    // records taken against different bundles would each be internally honest
    // and jointly meaningless.
    expect(journeys.servedBundle.entryScriptChecksumSha256).toBe(acceptance.servedBundle.entryScriptChecksumSha256);
  });
});

describe("the acceptance measurement agrees with the release it measured", () => {
  it("states the cap that was in force when it ran, and names the raise that came after", () => {
    // Both halves of the record agree with each other and with the cap of the day.
    expect(acceptance.capAtMeasurement.maxCacheEntries).toBe(CACHE_ENTRY_CAP_AT_MEASUREMENT);
    expect(acceptance.runtimeBudgets.maxCacheEntries).toBe(CACHE_ENTRY_CAP_AT_MEASUREMENT);
    // The live build has moved, by exactly one doubling, and that is stated here
    // rather than absorbed: this evidence was taken at 512 and the build ships 1,024.
    expect(EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries).toBe(1_024);
    expect(EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries).toBe(CACHE_ENTRY_CAP_AT_MEASUREMENT * 2);
    // The BYTE cap did not move at all, so that half still reads live.
    expect(acceptance.capAtMeasurement.maxCachedBytes).toBe(EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes);
    expect(acceptance.capAtMeasurement.maxCachedBytes).toBe(256 * 1024 * 1024);
  });

  it("attributes FIVE promoted releases and ends with this one", () => {
    expect(acceptance.promotedReleaseIds).toHaveLength(5);
    expect(acceptance.promotedReleaseIds[4]).toBe(CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID);
  });

  it("is OFF the vsync floor, by a measured control rather than by the command line", () => {
    const control = acceptance.cappedControl.frameMilliseconds?.p50Milliseconds;
    expect(typeof control).toBe("number");
    for (const station of acceptance.stations) {
      // Every station read well under the capped control's present interval.
      expect({ stationId: station.stationId, ok: (station.p50OverCappedControlP50 ?? 1) < 0.75 })
        .toEqual({ stationId: station.stationId, ok: true });
      expect({ stationId: station.stationId, p50: station.p50WithinBudget, p95: station.p95WithinBudget })
        .toEqual({ stationId: station.stationId, p50: true, p95: true });
    }
  });

  it("derives residency from the same asset count the inventory shipped, and inside both caps", () => {
    expect(acceptance.cacheResidency.releaseTimeDerivation.thisWaveAssetEntries).toBe(SHIPPED_ASSET_COUNT);
    expect(acceptance.cacheResidency.withinEntryBudget).toBe(true);
    expect(acceptance.cacheResidency.withinByteBudget).toBe(true);
    // Held to the cap the derivation was computed under, not to the raised one.
    // Judging a 512-cap derivation against 1,024 would be a looser test wearing
    // the name of the original.
    expect(acceptance.cacheResidency.worstObserved.entries).toBeLessThanOrEqual(CACHE_ENTRY_CAP_AT_MEASUREMENT);
    // The reserve survives the promotion in cache arithmetic, not only in prose.
    const reserved = acceptance.cacheResidency.releaseTimeDerivation.reservedForNorthernManhattanEntries;
    expect(reserved).toBe(36);
    expect(CACHE_ENTRY_CAP_AT_MEASUREMENT - acceptance.cacheResidency.releaseTimeDerivation.residentAssetEntries)
      .toBeGreaterThanOrEqual(reserved);
  });

  it("counts GPU texture cost over exactly the shipped assets, and labels it COMPUTED", () => {
    expect(acceptance.gpuTextureArithmetic.basis).toBe("computed-not-measured");
    expect(acceptance.gpuTextureArithmetic.assetCount).toBe(SHIPPED_ASSET_COUNT);
    expect(acceptance.gpuTextureArithmetic.imageCount).toBeGreaterThan(0);
  });

  it("reached no external host in any capture", () => {
    expect(acceptance.captures.flatMap((capture) => capture.network.externalHosts)).toEqual([]);
  });
});

describe("the journeys agree with the release they exercised", () => {
  it("all passed, and the cold load streamed exactly the shipped asset count", () => {
    expect(journeys.allPassed).toBe(true);
    expect(journeys.journeys.map((journey) => journey.journeyId)).toEqual([
      "cold-default", "cross-wave-pick", "canary-opt-in", "streaming-off", "tombstone-truth",
    ]);
    const cold = journeys.journeys.find((journey) => journey.journeyId === "cold-default")!;
    expect(cold.network!.perRelease[CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID]!.glbCount).toBe(SHIPPED_ASSET_COUNT);
    // Zero canary bytes on a promoted-default load: promotion did not promote
    // the canary.
    expect(cold.network!.perRelease[CENTRAL_UPPER_MANHATTAN_RELEASE_ID]!.glbCount).toBe(0);
    expect(cold.network!.externalHosts).toEqual([]);
  });

  it("proves the tiles were DRAWN, by a still that differs at the identical pose", () => {
    const off = journeys.journeys.find((journey) => journey.journeyId === "streaming-off")!;
    expect(off.texturedComparison!.stillsDiffer).toBe(true);
    expect(off.network!.perRelease[CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID]!.glbCount).toBe(0);
  });

  it("reports the tombstone count the inventory actually shipped", () => {
    const tombstone = journeys.journeys.find((journey) => journey.journeyId === "tombstone-truth")!;
    expect(tombstone.waveNotice).toContain(`${inventory.stats.notShippedCellCount} of ${inventory.stats.cellCount}`);
    expect(tombstone.waveNotice).toContain("no substitute was selected");
  });
});

describe("the Blender pass measured the bytes this release shipped", () => {
  it("re-imported every shipped asset, all of them textured", () => {
    expect(blender.summary.sampleCount).toBe(SHIPPED_ASSET_COUNT);
    expect(blender.summary.texturedSampleCount).toBe(SHIPPED_ASSET_COUNT);
    expect(blender.summary.maximumTriangleDelta).toBe(0);
    expect(blender.summary.materialMismatchCount).toBe(0);
    expect(blender.summary.notSolidCount).toBe(0);
    // An asset can embed a good PNG, declare it, pass every byte gate and still
    // render flat. These two are what say otherwise.
    expect(blender.summary.texturesUnreachableCount).toBe(0);
    expect(blender.summary.minimumUvLayerCount).toBeGreaterThanOrEqual(1);
  });

  /**
   * The corroboration ADR 0036 asked for: the worst volume margin recomputed
   * from an INDEPENDENTLY imported mesh must agree with the writer's about
   * WHICH asset is worst, and must stay inside the tolerance.
   */
  it("agrees with the writer about the worst-margin building, independently", () => {
    const worstIndependent = blender.samples.reduce((worst, sample) => (sample.volumeDeviation > worst.volumeDeviation ? sample : worst), blender.samples[0]!);
    const curationMargin = (readJson<{ curation: { volumeMargin: { worstVolumeDeviation: number; tolerance: number } } }>(`${RECORD_ROOT}/payload-inventory.json`)).curation.volumeMargin;
    expect(worstIndependent.buildingId).toBe("doitt:659449");
    expect(blender.summary.maximumVolumeDeviation).toBe(worstIndependent.volumeDeviation);
    expect(worstIndependent.volumeDeviation).toBeLessThan(curationMargin.tolerance);
    // Same order of magnitude as the writer's own worst, which is what makes the
    // two implementations agreeing evidence rather than coincidence.
    expect(worstIndependent.volumeDeviation / curationMargin.worstVolumeDeviation).toBeGreaterThan(0.5);
    expect(worstIndependent.volumeDeviation / curationMargin.worstVolumeDeviation).toBeLessThan(2);
  });
});

describe("the curated cells are the same list everywhere", () => {
  it("agrees across the curation module, the inventory and the release id", () => {
    const curated = CENTRAL_UPPER_MANHATTAN_CURATED_CELLS.map((record) => record.cellId);
    expect(inventory.renderableCellIds).toEqual(curated);
    expect(inventory.stats.renderableCellCount).toBe(curated.length);
    expect(inventory.files.some((file) => file.path.includes(CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID))).toBe(true);
  });
});
