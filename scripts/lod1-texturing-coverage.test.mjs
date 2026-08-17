import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { EXTERIOR_WAVE_LEDGER_RELEASE_ID } from "../src/release/exterior-wave-ledger.ts";
import { ISLAND_OWNED_PARENTS } from "./lod1-texturing-coverage-cli.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "data", "lod1-texturing-20260817");
const coverageText = readFileSync(join(dir, "coverage.json"), "utf8");
const coverage = JSON.parse(coverageText);
const ledger = JSON.parse(readFileSync(join(root, "data", "normalized", EXTERIOR_WAVE_LEDGER_RELEASE_ID, "ledger.json"), "utf8"));

describe("the T009 textured-lod_1 coverage record", () => {
  it("matches its committed sidecar", () => {
    expect(sha256HexSync(coverageText)).toBe(readFileSync(join(dir, "coverage.sha256"), "utf8").trim().split(/\s+/u)[0]);
  });

  it("closes the island against the IMMUTABLE ledger, not against itself", () => {
    const owned = ledger.cells.reduce((t, c) => t + c.buildingIds.length, 0);
    expect(owned).toBe(ISLAND_OWNED_PARENTS);
    expect(coverage.island.owned).toBe(owned);
    expect(coverage.island.texturedLod1 + coverage.island.tombstoned).toBe(owned);
    expect(coverage.island.texturedPlusTombstonedEqualsOwned).toBe(true);
    expect(coverage.island.texturedLod1).toBe(44_989);
    expect(coverage.island.texturedFallbacks).toBe(424);
    expect(coverage.island.tombstoned).toBe(205);
  });

  it("sums its rows to its island totals", () => {
    const sum = (k) => coverage.waves.reduce((t, r) => t + r[k], 0);
    expect(sum("texturedLod1")).toBe(coverage.island.texturedLod1);
    expect(sum("tombstoned")).toBe(coverage.island.tombstoned);
    expect(sum("texturedFallbacks")).toBe(coverage.island.texturedFallbacks);
    expect(sum("cellManifests")).toBe(coverage.island.cellManifests);
    expect(sum("totalBytes")).toBe(coverage.measuredStorage.totalBytes);
  });

  it("keeps every -c1 count untouched, which is what a re-texturing must not move", () => {
    for (const row of coverage.waves) {
      const c1 = JSON.parse(readFileSync(join(root, "data", row.c1ReleaseId, "wave-census.json"), "utf8"));
      expect(row.texturedLod1).toBe(c1.generatedBuildingCount);
      expect(row.tombstoned).toBe(c1.tombstonedBuildingCount);
      expect(row.texturedFallbacks).toBe(c1.lod1FallbackCount);
    }
  });

  it("verified every copied lod_0 twice, on every wave", () => {
    for (const row of coverage.waves) {
      expect(row.lod0Copy.matchedC1Inventory).toBe(row.lod0Copy.copied);
      expect(row.lod0Copy.matchedReemission).toBe(row.lod0Copy.copied);
      expect(row.lod0Copy.copied).toBe(row.texturedLod1);
    }
  });

  it("validated every declared cell manifest and replayed byte-identically", () => {
    for (const row of coverage.waves) {
      expect(row.validation.validatedCellCount).toBe(row.validation.declaredCellCount);
      expect(row.validation.silhouetteRecords).toBe(row.texturedLod1);
      expect(row.validation.completenessSources).toContain("payload-inventory");
      expect(row.determinismReplay.byteIdentical).toBe(row.determinismReplay.compared);
      expect(row.c1Immutability.identical).toBe(row.c1Immutability.sampled);
    }
  });

  it("pins every wave record it cites by checksum", () => {
    for (const row of coverage.waves) {
      const d = join(root, "data", row.c2ReleaseId);
      expect(sha256HexSync(readFileSync(join(d, "wave-census.json"), "utf8"))).toBe(row.waveCensusSha256);
      expect(sha256HexSync(readFileSync(join(d, "payload-inventory.json"), "utf8"))).toBe(row.payloadInventorySha256);
      expect(sha256HexSync(readFileSync(join(d, "retention-validation.json"), "utf8"))).toBe(row.retentionValidationSha256);
      expect(sha256HexSync(readFileSync(join(d, "verification.json"), "utf8"))).toBe(row.verificationSha256);
    }
  });

  it("accounts every tombstone under the closed stop-code vocabulary", () => {
    expect(Object.values(coverage.tombstoneCategories).reduce((a, b) => a + b, 0)).toBe(coverage.island.tombstoned);
    expect(Object.keys(coverage.tombstoneCategories).sort()).toEqual([
      "ring-area-below-floor", "ring-neck-below-grammar-minimum", "ring-not-simple", "volume-identity-failed",
    ]);
  });

  it("reports the appearance sampling MISS rather than a summary that hides it", () => {
    expect(coverage.appearanceSampling.fallbackCell).toBe("PASS");
    expect(coverage.appearanceSampling.shedCell).toBe("MISS");
    expect(coverage.appearanceSampling.statement).toMatch(/stands as a MISS/u);
  });

  it("states that nothing served, pinned, promoted or predecessor changed", () => {
    expect(coverage.rights.servingSurfaceChange).toBe("none");
    expect(coverage.rights.pinnedReleaseIdChange).toBe("none");
    expect(coverage.rights.promotedDefaultChange).toBe("none");
    expect(coverage.rights.predecessorMutation).toMatch(/^none/u);
  });

  it("carries the E adjudication forward as a non-claim", () => {
    expect(coverage.notClaimedHere.join(" ")).toMatch(/maxDistanceMeters null at both levels/u);
    expect(coverage.notClaimedHere.join(" ")).toMatch(/T001 owns -s2/u);
  });
});
