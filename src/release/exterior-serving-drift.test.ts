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
  it("cover at least one wave, so this gate is never vacuous", () => {
    expect(COMMITTED.length).toBeGreaterThan(0);
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
