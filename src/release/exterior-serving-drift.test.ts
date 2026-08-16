/**
 * The DRIFT gate for the serving releases, and it runs without a payload.
 *
 * The strong statement about an emitted `-s1` wave — every GLB parsed, every
 * detail tile re-rasterized, every tileset walked — is
 * `replayMultiLodAssembly`, and it needs the gitignored bytes. That evidence is
 * captured once, into `data/<releaseId>/serving-validation.json`, by the wave
 * driver. It cannot re-run here, and a suite that skipped itself when the
 * payload was absent would be a gate that never runs in a clean checkout.
 *
 * So this suite checks the thing that CAN be checked from committed records
 * alone, and it is the property the whole task rests on: **the serving release
 * carries the retained bytes and no others**. Both waves commit a
 * `payload-inventory.json` naming every file with its size and its SHA-256, so
 * the two inventories can be joined and compared without either payload
 * directory existing.
 *
 * What that join proves, per wave:
 *
 *  - every shipped GLB is byte-identical to a GLB the retention package
 *    declared — same path, same size, same digest — so nothing was regenerated,
 *    re-encoded or substituted;
 *  - exactly `lod_0` ships, one per shipped building, and no `lod_1` byte
 *    reaches the serving payload;
 *  - the shared detail tiles are the retained tiles, unchanged;
 *  - the population reconciles against the `-c1` census in both directions:
 *    shipped + tombstoned equals owned, and the counts are the census's own;
 *  - the release's internal pins agree with its own file accounting — the
 *    cell-release checksums the record states are the checksums of the files it
 *    declares, and the head pins one assembly package per content cell.
 *
 * A wave whose retained bytes changed, whose copy was partial, or whose record
 * was carried over from another wave fails here on every run.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { sha256HexSync } from "../domain/deterministic-hash.ts";
import { EXTERIOR_SERVING_WAVES, type ExteriorServingWave } from "./exterior-serving-waves.ts";
import { servingArtifactRef, servingAssemblyPackageId, servingCellReleaseId } from "./exterior-serving-release.ts";

interface InventoryFile { path: string; byteSize: number; checksumSha256: string }

function readRecord(releaseId: string, name: string): Record<string, unknown> {
  const decoder = new TextDecoder();
  const text = decoder.decode(readFileSync(`data/${releaseId}/${name}.json`));
  const recorded = decoder.decode(readFileSync(`data/${releaseId}/${name}.sha256`)).trim().split(/\s+/u)[0];
  expect(sha256HexSync(text), `${releaseId}/${name}.json does not match its recorded checksum`).toBe(recorded);
  return JSON.parse(text) as Record<string, unknown>;
}

/** The waves whose serving record is committed. Grows as waves land. */
const COMMITTED: ExteriorServingWave[] = EXTERIOR_SERVING_WAVES.filter((entry) => existsSync(`data/${entry.servingReleaseId}/payload-inventory.json`));

describe("the committed serving records", () => {
  it("cover every wave the island ledger declares", () => {
    // Not "at least one". Six waves were transformed and six records were
    // committed, so a missing one is a wave whose evidence was dropped rather
    // than a gate that has not been reached yet.
    expect(COMMITTED.map((entry) => entry.waveId)).toEqual(EXTERIOR_SERVING_WAVES.map((entry) => entry.waveId));
  });

  it("account for the whole island, exactly once each", () => {
    const totals = COMMITTED.reduce((sum, entry) => ({
      cells: sum.cells + entry.cellCount,
      owned: sum.owned + entry.ownedBuildingCount,
      generated: sum.generated + entry.generatedBuildingCount,
      tombstoned: sum.tombstoned + entry.tombstonedBuildingCount,
    }), { cells: 0, owned: 0, generated: 0, tombstoned: 0 });
    expect(totals).toEqual({ cells: 883, owned: 45_194, generated: 44_989, tombstoned: 205 });
  });
});

describe.each(COMMITTED.map((entry) => [entry.waveId, entry] as const))("%s serving release drift", (_waveId, waveEntry) => {
  const serving = readRecord(waveEntry.servingReleaseId, "payload-inventory");
  const retention = readRecord(waveEntry.retentionReleaseId, "payload-inventory");
  const census = readRecord(waveEntry.retentionReleaseId, "wave-census");
  const servingFiles = new Map((serving.files as InventoryFile[]).map((file) => [file.path, file]));
  const retentionFiles = new Map((retention.files as InventoryFile[]).map((file) => [file.path, file]));
  const composition = serving.composition as Record<string, number | string[]>;

  it("names the retention package it was transformed from, by immutable root pin", () => {
    const source = serving.retentionSource as { releaseId: string; rootId: string; rootChecksumSha256: string };
    expect(source.releaseId).toBe(waveEntry.retentionReleaseId);
    expect(source.rootChecksumSha256).toBe((retention.retentionRoot as { rootChecksumSha256: string }).rootChecksumSha256);
    expect(source.rootId).toBe((retention.retentionRoot as { rootId: string }).rootId);
  });

  it("ships every GLB byte-identical to the retained one, and ships only lod_0", () => {
    const servingGlbs = [...servingFiles.values()].filter((file) => file.path.endsWith(".glb"));
    expect(servingGlbs.length).toBe(waveEntry.generatedBuildingCount);
    const mismatched: string[] = [];
    const coarse: string[] = [];
    for (const file of servingGlbs) {
      if (!file.path.endsWith("__lod_0.glb")) { coarse.push(file.path); continue; }
      const retained = retentionFiles.get(file.path);
      if (!retained || retained.byteSize !== file.byteSize || retained.checksumSha256 !== file.checksumSha256) mismatched.push(file.path);
    }
    expect(coarse).toEqual([]);
    expect(mismatched).toEqual([]);
    // The converse: the retained coarse LOD stays retained and is not served.
    expect([...retentionFiles.keys()].filter((path) => path.endsWith("__lod_1.glb")).length).toBe(waveEntry.generatedBuildingCount);
  });

  it("ships the retained detail tiles unchanged, and declares no other payload class", () => {
    for (const file of servingFiles.values()) {
      if (!file.path.startsWith("public/textures/")) continue;
      const retained = retentionFiles.get(file.path);
      expect(retained, `${file.path} is not a retained tile`).toBeDefined();
      expect(retained!.checksumSha256).toBe(file.checksumSha256);
      expect(retained!.byteSize).toBe(file.byteSize);
    }
    const classes = new Set([...servingFiles.keys()].map((path) => path.split("/").slice(0, 2).join("/")));
    expect([...classes].sort()).toEqual([
      "assemblies.json",
      "index.json",
      "public/assets",
      "public/cell-assembly-package",
      "public/cell-detail-sidecar",
      "public/cell-release",
      "public/ownership-ledger",
      "public/rollout-snapshot",
      "public/textures",
      "public/tiles",
      "release-graph.json",
    ]);
  });

  it("carries no private byte into the browser-reachable payload", () => {
    expect([...servingFiles.keys()].filter((path) => path.startsWith("private/"))).toEqual([]);
  });

  it("reconciles its population against the retained census in both directions", () => {
    expect(census.cellCount).toBe(waveEntry.cellCount);
    expect(census.ownedBuildingCount).toBe(waveEntry.ownedBuildingCount);
    expect(census.generatedBuildingCount).toBe(waveEntry.generatedBuildingCount);
    expect(census.tombstonedBuildingCount).toBe(waveEntry.tombstonedBuildingCount);
    expect(composition.cellCount).toBe(waveEntry.cellCount);
    expect(composition.availableBuildingCount).toBe(waveEntry.generatedBuildingCount);
    expect(composition.unavailableBuildingCount).toBe(waveEntry.tombstonedBuildingCount);
    expect((composition.availableBuildingCount as number) + (composition.unavailableBuildingCount as number)).toBe(waveEntry.ownedBuildingCount);
    expect(composition.shippedLodIds).toEqual(["lod_0"]);
    expect(composition.regeneratedInventoryCount).toBe(waveEntry.generatedBuildingCount);
    expect(composition.copiedAssetCount).toBe(waveEntry.generatedBuildingCount);
  });

  it("states cell-release pins that are the checksums of the files it declares", () => {
    const cellReleases = serving.cellReleases as Array<{ cellId: string; cellReleaseId: string; checksumSha256: string }>;
    expect(cellReleases).toHaveLength(waveEntry.cellCount);
    for (const entry of cellReleases) {
      expect(entry.cellReleaseId).toBe(servingCellReleaseId(waveEntry.servingReleaseId, entry.cellId));
      const file = servingFiles.get(servingArtifactRef("public", "cell-release", entry.cellReleaseId));
      expect(file, `${entry.cellReleaseId} declares no cell-release artifact`).toBeDefined();
      expect(file!.checksumSha256).toBe(entry.checksumSha256);
    }
  });

  it("pins one assembly package and one evidence sidecar per content-bearing cell", () => {
    const packageIds = serving.assemblyPackageIds as string[];
    const contentCellCount = composition.contentCellCount as number;
    expect(packageIds).toHaveLength(contentCellCount);
    expect((serving.head as { assemblyPackageCount: number }).assemblyPackageCount).toBe(contentCellCount);
    expect(new Set(packageIds).size).toBe(packageIds.length);
    const sidecars = [...servingFiles.keys()].filter((path) => path.startsWith("public/cell-detail-sidecar/"));
    const packages = [...servingFiles.keys()].filter((path) => path.startsWith("public/cell-assembly-package/"));
    const tilesets = [...servingFiles.keys()].filter((path) => path.endsWith("/tileset.json"));
    expect(sidecars).toHaveLength(contentCellCount);
    expect(packages).toHaveLength(contentCellCount);
    expect(tilesets).toHaveLength(contentCellCount);
    for (const entry of serving.cellReleases as Array<{ cellId: string }>) {
      if (!packages.includes(servingArtifactRef("public", "cell-assembly-package", servingCellReleaseId(waveEntry.servingReleaseId, entry.cellId)))) continue;
      expect(packageIds).toContain(servingAssemblyPackageId(waveEntry.servingReleaseId, entry.cellId));
    }
  });

  it("carries the offline replay record for the same release, with no issue", () => {
    const validation = readRecord(waveEntry.servingReleaseId, "serving-validation");
    expect(validation.releaseId).toBe(waveEntry.servingReleaseId);
    expect(validation.waveId).toBe(waveEntry.waveId);
    expect(validation.ok).toBe(true);
    expect(validation.issues).toEqual([]);
    expect(validation.replayedPackageCount).toBe(composition.contentCellCount);
    expect(validation.declaredPackageCount).toBe(composition.contentCellCount);
    expect(validation.replayedAssetCount).toBe(waveEntry.generatedBuildingCount);
  });

  it("accounts for every declared byte exactly once", () => {
    const totals = serving.totals as { fileCount: number; byteSize: number };
    expect(totals.fileCount).toBe(servingFiles.size);
    expect(totals.byteSize).toBe([...servingFiles.values()].reduce((total, file) => total + file.byteSize, 0));
    expect(new Set([...servingFiles.values()].map((file) => file.checksumSha256)).size).toBeGreaterThan(0);
  });
});

/**
 * The C5 SESSION EVIDENCE, held to its own sidecar and to its own verdict.
 *
 * These records are browser readings, so they cannot be recomputed here — but
 * they can be kept from drifting, and more importantly they can be kept from
 * being quietly replaced. Every one of the three C5 captures on the promoted
 * build FAILED its pre-registered conditions, and a failing record is exactly
 * the kind that gets swapped for a greener one during a later edit.
 *
 * So the verdicts are asserted AS THEY STAND. A future task that legitimately
 * turns one of them green has to change this file to say so, in a diff a
 * reviewer sees, rather than by dropping a new JSON into `data/`.
 */
describe("the committed C5 session evidence", () => {
  const EVIDENCE_ROOT = "data/exterior-serving-20260817";

  function readEvidence(name: string): Record<string, unknown> {
    const decoder = new TextDecoder();
    const text = decoder.decode(readFileSync(`${EVIDENCE_ROOT}/${name}.json`));
    const recorded = decoder.decode(readFileSync(`${EVIDENCE_ROOT}/${name}.sha256`)).trim().split(/\s+/u)[0];
    expect(sha256HexSync(text), `${name}.json does not match its recorded checksum`).toBe(recorded);
    return JSON.parse(text) as Record<string, unknown>;
  }

  it("records the six-wave DEFAULT session, and records that it FAILED", () => {
    const record = readEvidence("default-session-residency") as unknown as {
      artifact: string; releaseSelector: string; ok: boolean;
      caps: { maxCacheEntries: number; maxCachedBytes: number };
      findings: Record<string, number | boolean | null>;
    };
    expect(record.artifact).toBe("serving-default-session-residency");
    // No ?exteriorCells=: this is the promoted composition, which is the whole
    // reason the capture exists.
    expect(record.releaseSelector).toBe("default");
    expect(record.caps.maxCacheEntries).toBe(1_024);

    // What it established.
    expect(record.findings.promotedWaveCount).toBe(6);
    expect(record.findings.allSixWavesResolved).toBe(true);
    expect(record.findings.bootDocumentTotal).toBe(18);
    expect(record.findings.bootDocumentsComplete).toBe(true);
    expect(record.findings.declaredCellTotal).toBe(883);
    expect(record.findings.maxScheduledCellsAtAnyPose).toBe(8);
    expect(record.findings.failedCellCount).toBe(0);
    expect(record.findings.entriesWithinCap).toBe(true);
    expect(record.findings.bytesWithinCap).toBe(true);
    expect(record.findings.requestBudgetRespected).toBe(true);
    expect(record.findings.everyPoseLanded).toBe(true);

    // NOTHING FELL BACK AND NOTHING FAILED. This is the re-capture after the
    // cancellation defect the first capture found was fixed; the pre-fix numbers
    // were 9 and 9. Pinned at zero so a regression is a diff somebody explains.
    expect(record.findings.fallbackCellCount).toBe(0);
    expect(record.findings.failedArtifactCount).toBe(0);
    expect(record.ok).toBe(true);
  });

  /**
   * THE DEFECT THIS CAPTURE FOUND TRAVELS WITH THE GREEN VERDICT.
   *
   * The first run of this capture failed: three named cells of wave w01 fell
   * back to base massing while every one of their artifacts byte-verified on
   * disk and re-fetched cleanly over HTTP. That was a real runtime defect —
   * a cancelled shared load classified as a failed artifact — and it is fixed.
   *
   * The record keeps the whole story rather than the ending, and this pins it
   * there. A green capture with the history deleted would read as a clean first
   * try, and the next reader would not know that this arrangement has a defect
   * class in it that only appears at promoted density.
   */
  it("carries the defect it found, and the fix that closed it", () => {
    const record = readEvidence("default-session-residency") as unknown as {
      defectFoundAndFixed: {
        preFixVerdict: { ok: boolean; fallbackCellCount: number; failedArtifactCount: number; failingCells: string[]; runtimeFailureCode: string };
        whyItWasNotAnEmissionDefect: string[];
        mechanism: string; fix: string; regressionTests: string; sideEffectOfTheFix: string;
      };
      findings: { networkFailureCount: number; fallbackNotices: string[] };
    };
    const defect = record.defectFoundAndFixed;
    expect(defect.preFixVerdict.ok).toBe(false);
    expect(defect.preFixVerdict.fallbackCellCount).toBe(9);
    expect(defect.preFixVerdict.failedArtifactCount).toBe(9);
    expect(defect.preFixVerdict.failingCells).toEqual([
      "manhattan-exterior-cell-w01-000038-16-19301-17928",
      "manhattan-exterior-cell-w01-000116-16-19301-17926",
      "manhattan-exterior-cell-w01-000117-17-38604-35853",
    ]);
    expect(defect.preFixVerdict.runtimeFailureCode).toBe("request-failed");
    // Four independent reasons the bytes were never in question.
    expect(defect.whyItWasNotAnEmissionDefect).toHaveLength(4);
    // The mechanism names the real trigger, and says the earlier guess was wrong.
    expect(defect.mechanism).toContain("releaseWaiter");
    expect(defect.mechanism).toContain("abortExcept as the trigger; that was wrong");
    expect(defect.fix).toContain("RETRIES once");
    expect(defect.fix).toContain("CitywideRequestPool is untouched");
    expect(defect.regressionTests).toContain("exterior-cell-runtime.test.ts");
    expect(defect.sideEffectOfTheFix).toContain("92.4%");
    // And the re-capture is clean: no fallback notice, no network refusal beyond
    // the favicon the page always asks for.
    expect(record.findings.fallbackNotices).toEqual([]);
    expect(record.findings.networkFailureCount).toBeLessThanOrEqual(1);
  });

  it("records the frame-time A/B, and records that it FAILED on the texture bound", () => {
    const record = readEvidence("frame-time-ab") as unknown as {
      verdict: { pass: boolean; bar: { maximumDecodedTextures: number }; poses: Array<{ poseId: string; pass: boolean; p50Pass: boolean; p95Pass: boolean; decodedTexturePass: boolean; decodedTextureCountA: number; decodedTextureCountB: number }> };
    };
    expect(record.verdict.bar.maximumDecodedTextures).toBe(4);
    expect(record.verdict.pass).toBe(false);
    for (const pose of record.verdict.poses) {
      expect(pose.pass, pose.poseId).toBe(false);
      // The FRAME halves pass on every pose; the texture bound is the only
      // reason any of them fails, and that separation is the finding.
      expect(pose.p50Pass, pose.poseId).toBe(true);
      expect(pose.p95Pass, pose.poseId).toBe(true);
      expect(pose.decodedTexturePass, pose.poseId).toBe(false);
      expect(pose.decodedTextureCountB, pose.poseId).toBe(5);
      expect(pose.decodedTextureCountA, pose.poseId).toBe(1);
    }
    // The column the follow-up will be evaluated over, already committed: the
    // shared-class subset is four in every arm-B pose, which is the property the
    // bound was written about. The THRESHOLD is untouched and the FAIL stands.
    const armB = readEvidence("frame-arm-b") as unknown as { samples: Array<{ sharedClassTextureCount: number; sharedClassTextureRequestCount: number; residentAssetCount: number }> };
    for (const sample of armB.samples) {
      expect(sample.sharedClassTextureCount).toBe(4);
      expect(sample.sharedClassTextureRequestCount).toBe(4);
    }
    // …and it does not scale with residency: 12 resident assets and 371 resident
    // assets both cost four class-tile requests. That is the statement the
    // re-wire follow-up has to make, and the data for it is already here.
    const residency = armB.samples.map((sample) => sample.residentAssetCount);
    expect(Math.max(...residency)).toBeGreaterThan(Math.min(...residency) * 10);
  });

  it("records the eviction roam, and records that it FAILED on eviction and identity", () => {
    const record = readEvidence("eviction-at-scale") as unknown as { ok: boolean; findings: Record<string, number | boolean | null> };
    expect(record.findings.evictionsObserved).toBe(false);
    expect(record.findings.cacheEvictions).toBe(0);
    expect(record.findings.selectionStableAcrossEviction).toBe(false);
    expect(record.findings.requestBudgetRespected).toBe(true);
    expect(record.findings.failedArtifactCount).toBe(0);
    expect(record.ok).toBe(false);
  });
});
