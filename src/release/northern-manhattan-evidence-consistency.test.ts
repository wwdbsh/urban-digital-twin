import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The committed EVIDENCE records, checked against the release they claim to be
 * about.
 *
 * The journey capture needs a browser and the Blender pass needs Blender, so
 * neither can be re-run in CI. What CAN be checked, on every run and without
 * either, is that the readings describe THIS release: the same release id, the
 * same shipped asset count, the same renderable cell, the same tombstone count,
 * and — for Blender — the same asset checksums the payload inventory declares.
 *
 * That is the difference between "a browser once passed four journeys" and "a
 * browser passed four journeys against the bytes this repository still ships". A
 * rebuild that moved the subset would leave these records describing a release
 * that no longer exists, and this suite is what turns that into a failure instead
 * of a stale file nobody opens.
 */
import { MIDTOWN_CORE_V3_VOLUME_TOLERANCE } from "./midtown-core-v3-materialization.ts";
import { NORTHERN_MANHATTAN_RELEASE_ID } from "./northern-manhattan-package.ts";
import { NORTHERN_MANHATTAN_PREDECESSOR_RELEASE_ID } from "./northern-manhattan-release.ts";

const RECORD_ROOT = "data/northern-manhattan-20260812";

function readText(path: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(readFileSync(path)));
}
function readJson<T>(path: string): T {
  return JSON.parse(readText(path)) as T;
}

interface Inventory {
  releaseId: string;
  renderableCellIds: string[];
  stats: { cellCount: number; notShippedCellCount: number; shippedAssetCount: number };
  census: { requestedBuildingCount: number; materializedBuildingCount: number };
  files: { path: string; byteSize: number; checksumSha256: string }[];
}

interface JourneyEvidence {
  releaseId: string;
  capturedWith: {
    servedBundle: { matchesLocalDist: boolean; entryScriptNamesRelease: boolean; indexHtmlChecksumSha256: string; localDistIndexHtmlChecksumSha256: string };
    subject: { framedCellId: string; renderableCells: { cellId: string; buildingCount: number }[]; assetCount: number; ownedCellCount: number; tombstonedCellCount: number };
    poseContainment: { cellId: string; containment: string };
  };
  journeys: {
    journeyId: string;
    passed: boolean;
    network?: { perRelease: Record<string, { glbCount: number; encodedBytes: number }>; externalHosts: string[] };
    stillDiffersFromPromotedDefault?: boolean;
    stillMatchesCanaryOptIn?: boolean;
    waveNotice?: string | null;
    detail?: { badge: string | null; rows: Record<string, string> } | null;
    still: { checksumSha256: string };
  }[];
  allPassed: boolean;
}

interface BlenderEvidence {
  releaseId: string;
  crossCheck: { samplesMatchedToInventory: number; checksumMismatchCount: number; renderCount: number; shippedAssetCount: number; sampledShareOfShipped: number };
  summary: {
    sampleCount: number;
    texturedSampleCount: number;
    embeddedImageCount: number;
    imageCountMismatchCount: number;
    texturesUnreachableCount: number;
    minimumUvLayerCount: number;
    maximumTriangleDelta: number;
    materialMismatchCount: number;
    maximumBoundsDeviationMeters: number;
    minimumZUpControlDeviationMeters: number;
    maximumVolumeDeviation: number;
    notSolidCount: number;
    tierCollapseSampleCount: number;
  };
  samples: { buildingId: string; checksumSha256: string; payloadRelativeRef: string; volumeDeviation: number; measuredImageCount: number; declaredTextureCount: number }[];
}

const inventory = readJson<Inventory>(`${RECORD_ROOT}/payload-inventory.json`);
const journeys = readJson<JourneyEvidence>(`${RECORD_ROOT}/journey-evidence.json`);
const blender = readJson<BlenderEvidence>(`${RECORD_ROOT}/blender-sample.json`);
const census = readJson<{ volumeIdentity: { worstVolumeDeviation: number; worstDeviationAsFractionOfTolerance: number } }>(`${RECORD_ROOT}/wave-census.json`);

const PROMOTED_RELEASE_IDS = [
  "manhattan-exterior-cells-20260811-v3",
  "manhattan-midtown-core-cells-20260811-v3",
  "manhattan-lower-manhattan-cells-20260812-p1",
  "manhattan-southern-remainder-cells-20260812-p1",
  NORTHERN_MANHATTAN_PREDECESSOR_RELEASE_ID,
];

describe("every committed T021 evidence record is about THIS release", () => {
  it("names this release and no other", () => {
    expect(inventory.releaseId).toBe(NORTHERN_MANHATTAN_RELEASE_ID);
    expect(journeys.releaseId).toBe(NORTHERN_MANHATTAN_RELEASE_ID);
    expect(blender.releaseId).toBe(NORTHERN_MANHATTAN_RELEASE_ID);
  });

  /**
   * The stale-server failure, pinned. A previous task's journey run once reached a
   * preview left listening by another worktree and passed meaninglessly against a
   * bundle in which the release was not pinned. The capture now identifies the
   * served bundle before measuring anything, and this asserts it did.
   */
  it("was captured against a bundle identified BEFORE capture, and against this tree's build", () => {
    const bundle = journeys.capturedWith.servedBundle;
    expect(bundle.matchesLocalDist).toBe(true);
    expect(bundle.entryScriptNamesRelease).toBe(true);
    expect(bundle.indexHtmlChecksumSha256).toBe(bundle.localDistIndexHtmlChecksumSha256);
  });
});

describe("the journeys agree with the release they exercised", () => {
  it("all passed, and the opt-in load streamed exactly the shipped asset count", () => {
    expect(journeys.allPassed).toBe(true);
    expect(journeys.journeys.map((journey) => journey.journeyId)).toEqual([
      "promoted-default-unchanged", "canary-opt-in", "textured-pick", "tombstone-truth",
    ]);
    expect(journeys.capturedWith.subject.assetCount).toBe(inventory.census.materializedBuildingCount);
    expect(journeys.capturedWith.subject.assetCount).toBe(inventory.stats.shippedAssetCount);

    const optIn = journeys.journeys.find((journey) => journey.journeyId === "canary-opt-in")!;
    expect(optIn.network!.perRelease[NORTHERN_MANHATTAN_RELEASE_ID]!.glbCount).toBe(inventory.stats.shippedAssetCount);
    // SELECTS rather than ADDS: no promoted wave fetched a byte.
    for (const releaseId of PROMOTED_RELEASE_IDS) {
      expect(optIn.network!.perRelease[releaseId]!.glbCount).toBe(0);
      expect(optIn.network!.perRelease[releaseId]!.encodedBytes).toBe(0);
    }
    expect(optIn.network!.externalHosts).toEqual([]);
  });

  /**
   * THE PROMOTED DEFAULT IS NOW THE WHOLE PROMOTED CITY, AND IT STILL DOES NOT
   * REACH THIS RELEASE.
   *
   * Five waves are promoted, which is every wave the ledger declares except this
   * one, so this is the first canary whose "changed nothing" claim is measured
   * against a complete promoted composition rather than a partial one.
   */
  it("shows an ordinary session streaming all five promoted waves and none of this one", () => {
    const clean = journeys.journeys.find((journey) => journey.journeyId === "promoted-default-unchanged")!;
    for (const releaseId of PROMOTED_RELEASE_IDS) {
      expect(clean.network!.perRelease[releaseId]!.glbCount).toBeGreaterThan(0);
    }
    expect(clean.network!.perRelease[NORTHERN_MANHATTAN_RELEASE_ID]!.glbCount).toBe(0);
    expect(clean.network!.perRelease[NORTHERN_MANHATTAN_RELEASE_ID]!.encodedBytes).toBe(0);
    expect(clean.network!.externalHosts).toEqual([]);
  });

  /**
   * FETCHED IS NOT DRAWN, and a top-down pose once produced a still byte-identical
   * to the promoted default's — a whole textured wave opted into, and nothing
   * visible changed. The still must differ at the IDENTICAL pose.
   */
  it("proves the tiles were DRAWN, by a still that differs at the identical pose", () => {
    const optIn = journeys.journeys.find((journey) => journey.journeyId === "canary-opt-in")!;
    const clean = journeys.journeys.find((journey) => journey.journeyId === "promoted-default-unchanged")!;
    expect(optIn.stillDiffersFromPromotedDefault).toBe(true);
    expect(optIn.still.checksumSha256).not.toBe(clean.still.checksumSha256);
  });

  it("stands the camera inside the cell it frames, asserted before capture", () => {
    const subject = journeys.capturedWith.subject;
    expect(subject.renderableCells.map((cell) => cell.cellId)).toEqual(inventory.renderableCellIds);
    expect(subject.framedCellId).toBe(inventory.renderableCellIds[0]);
    expect(journeys.capturedWith.poseContainment.cellId).toBe(subject.framedCellId);
    expect(journeys.capturedWith.poseContainment.containment).toContain("asserted before capture");
  });

  it("reports the tombstone count the inventory actually shipped", () => {
    const tombstone = journeys.journeys.find((journey) => journey.journeyId === "tombstone-truth")!;
    expect(journeys.capturedWith.subject.tombstonedCellCount).toBe(inventory.stats.notShippedCellCount);
    expect(journeys.capturedWith.subject.ownedCellCount).toBe(inventory.stats.cellCount);
    expect(tombstone.waveNotice).toContain(`${inventory.stats.notShippedCellCount} of ${inventory.stats.cellCount}`);
    expect(tombstone.waveNotice).toContain("no substitute was selected");
  });

  /**
   * Two journeys load the same URL at the same pose in separate pages and produce
   * byte-identical stills. That is renderer determinism across sessions, it is
   * RECORDED rather than required, and this asserts the record says which it is —
   * because two equal checksums in one evidence file otherwise read as a reused
   * capture.
   */
  it("explains the two equal still checksums instead of leaving them to be doubted", () => {
    const tombstone = journeys.journeys.find((journey) => journey.journeyId === "tombstone-truth")!;
    const optIn = journeys.journeys.find((journey) => journey.journeyId === "canary-opt-in")!;
    expect(tombstone.stillMatchesCanaryOptIn).toBe(tombstone.still.checksumSha256 === optIn.still.checksumSha256);
    expect(readText(`${RECORD_ROOT}/journey-evidence.json`)).toContain("Observed, not asserted.");
  });

  it("shows a picked building naming its own release, cell, cell release and asset checksum", () => {
    const pick = journeys.journeys.find((journey) => journey.journeyId === "textured-pick")!;
    expect(pick.detail!.badge).toContain(NORTHERN_MANHATTAN_RELEASE_ID);
    expect(pick.detail!.rows["Cell / release"]).toContain(inventory.renderableCellIds[0]!);
    expect(pick.detail!.rows["Active asset"]).toMatch(/[0-9a-f]{64}/u);
    expect(pick.detail!.rows["Truth tiers"]!.length).toBeGreaterThan(0);
    expect(pick.detail!.rows["Uncertainty"]!.length).toBeGreaterThan(0);
  });
});

describe("the Blender pass measured the bytes this release shipped", () => {
  /**
   * Every measured checksum is one the committed inventory declares, re-derived
   * here rather than trusted: the record's own cross-check ran at capture time,
   * and this is the check that it still holds against the bytes in the tree today.
   */
  it("re-imported only assets this release declares, and states that it sampled a subset", () => {
    const declared = new Map(inventory.files.map((file) => [file.path, file.checksumSha256]));
    for (const sample of blender.samples) {
      expect(declared.get(sample.payloadRelativeRef), sample.buildingId).toBe(sample.checksumSha256);
    }
    expect(blender.crossCheck.checksumMismatchCount).toBe(0);
    expect(blender.crossCheck.samplesMatchedToInventory).toBe(blender.summary.sampleCount);
    expect(blender.crossCheck.renderCount).toBe(blender.summary.sampleCount);
    // A SAMPLE, and the record says so with the arithmetic rather than implying
    // whole coverage.
    expect(blender.crossCheck.shippedAssetCount).toBe(inventory.stats.shippedAssetCount);
    expect(blender.summary.sampleCount).toBeLessThan(inventory.stats.shippedAssetCount);
    expect(blender.crossCheck.sampledShareOfShipped)
      .toBeCloseTo(blender.summary.sampleCount / inventory.stats.shippedAssetCount, 12);
  });

  /**
   * The textured-wave checks the untextured waves had no use for. An asset can
   * embed a perfectly good PNG, declare it, pass every byte gate and still render
   * flat if nothing samples it — which is why UV layers and material-to-image
   * bindings are measured rather than the image count alone.
   */
  it("found every declared tile embedded, and every embedded tile reachable", () => {
    expect(blender.summary.texturedSampleCount).toBe(blender.summary.sampleCount);
    expect(blender.summary.texturedSampleCount).toBeGreaterThanOrEqual(10);
    expect(blender.summary.embeddedImageCount).toBeGreaterThan(0);
    expect(blender.summary.imageCountMismatchCount).toBe(0);
    expect(blender.summary.texturesUnreachableCount).toBe(0);
    expect(blender.summary.minimumUvLayerCount).toBeGreaterThan(0);
    for (const sample of blender.samples) {
      expect(sample.measuredImageCount, sample.buildingId).toBe(sample.declaredTextureCount);
    }
  });

  it("agrees with the writer about triangles, materials, bounds and solidity", () => {
    expect(blender.summary.maximumTriangleDelta).toBe(0);
    expect(blender.summary.materialMismatchCount).toBe(0);
    expect(blender.summary.maximumBoundsDeviationMeters).toBeLessThanOrEqual(1e-3);
    expect(blender.summary.notSolidCount).toBe(0);
    // The control hypothesis has to be far from zero, or the up-axis diff is
    // measuring nothing.
    expect(blender.summary.minimumZUpControlDeviationMeters).toBeGreaterThan(1);
  });

  /**
   * THE INDEPENDENT READING OF THE NARROW MARGIN.
   *
   * The writer's own worst ACCEPTED volume deviation across this wave sits at
   * 0.9895 of the tolerance and it refused 16 buildings for exceeding it. A margin
   * that narrow is where a systematic writer-side error would hide, because the
   * writer would be grading its own arithmetic.
   *
   * Blender recomputes the identity from an independently imported mesh. Its worst
   * over the sample must be inside the same tolerance — and, being a different
   * implementation over a different (sampled) set, it is not expected to equal the
   * writer's number. What would be alarming is agreement that was too good to be a
   * second measurement, or a disagreement that crossed the tolerance; neither
   * happened.
   */
  it("recomputes the volume identity independently and stays inside the same tolerance", () => {
    expect(blender.summary.maximumVolumeDeviation).toBeLessThan(MIDTOWN_CORE_V3_VOLUME_TOLERANCE);
    for (const sample of blender.samples) {
      expect(sample.volumeDeviation, sample.buildingId).toBeLessThan(MIDTOWN_CORE_V3_VOLUME_TOLERANCE);
    }
    // The wave-scale figure the census recorded, for contrast rather than for
    // equality: the census measures 9,849 buildings and this pass measures 69.
    expect(census.volumeIdentity.worstDeviationAsFractionOfTolerance).toBeGreaterThan(0.98);
    expect(blender.summary.maximumVolumeDeviation / MIDTOWN_CORE_V3_VOLUME_TOLERANCE)
      .toBeLessThan(census.volumeIdentity.worstDeviationAsFractionOfTolerance);
  });

  /** Every disclosed tier collapse in the renderable cell is inspected, not a sample of them. */
  it("inspected every disclosed tier collapse in the shipped cell", () => {
    const shippedCollapse = readJson<{ shippedAbsentSetbackBuildingIds: string[] }>(`${RECORD_ROOT}/wave-census.json`).shippedAbsentSetbackBuildingIds;
    expect(blender.summary.tierCollapseSampleCount).toBe(shippedCollapse.length);
    const sampled = new Set(blender.samples.map((sample) => sample.buildingId));
    expect(shippedCollapse.every((buildingId) => sampled.has(buildingId))).toBe(true);
  });
});
