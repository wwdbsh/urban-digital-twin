/* global TextDecoder */
/**
 * T006 Stage 0, held shut.
 *
 * These tests bind the three things a pre-registration is worth nothing without:
 * that the arithmetic which produced the honest stop is REPRODUCIBLE, that the
 * frame was fixed BEFORE any draw, and that the records still describe the
 * bytes actually under test.
 *
 * WHAT THEY DELIBERATELY DO NOT BIND: any PNG. A still is a checksummed input,
 * not a verdict, and a test that fails when an image re-encodes teaches its
 * readers to ignore it.
 */
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SERVING_RELEASE_IDS, SHED_TONE_PAIRS, VEHICLE, vehicleOptics, budgetFor } from "./lod-transition-stage0-cli.mjs";

const RECORD_ROOT = join("data", "far-tier-lod-transition-20260821");
const readText = (path) => new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
const readRecord = (name) => {
  const text = readText(join(RECORD_ROOT, `${name}.json`));
  const declared = readText(join(RECORD_ROOT, `${name}.sha256`)).trim().split(/\s+/u)[0];
  expect(createHash("sha256").update(text).digest("hex"), `${name}.json does not match its sidecar`).toBe(declared);
  return JSON.parse(text);
};

describe("the Stage 0 records are internally consistent", () => {
  it("every record matches its own sidecar", () => {
    for (const name of ["pre-registration", "error-budget", "census", "shed-tone-budget"]) expect(readRecord(name)).toBeTypeOf("object");
  });

  it("the pre-registration cites the exact digests of the records it rests on", () => {
    const pre = readRecord("pre-registration");
    const digestOf = (name) => createHash("sha256").update(readText(join(RECORD_ROOT, `${name}.json`))).digest("hex");
    expect(pre.stage0Arithmetic.errorBudgetSha256).toBe(digestOf("error-budget"));
    expect(pre.stage0Arithmetic.censusSha256).toBe(digestOf("census"));
  });
});

describe("the frame was fixed before any draw", () => {
  it("is 424, dual-derived, with the two derivations agreeing", () => {
    const census = readRecord("census");
    expect(census.buildingIds).toHaveLength(424);
    expect(census.dualDerivation.fromServingManifests.count).toBe(424);
    expect(census.dualDerivation.fromIslandPass.count).toBe(425);
    expect(census.dualDerivation.reconciliation.inManifestsOnly).toEqual([]);
    expect(census.dualDerivation.reconciliation.agreed).toBe(424);
  });

  it("removes the tombstone from the FRAME rather than pruning it after a reading", () => {
    const census = readRecord("census");
    expect(census.dualDerivation.reconciliation.inIslandPassOnly).toEqual(["doitt:263078"]);
    expect(census.buildingIds).not.toContain("doitt:263078");
    expect(census.exclusionDiscipline).toContain("before any draw");
  });

  it("pins the frame with its own checksum, so a later edit cannot pass as the original", () => {
    const census = readRecord("census");
    expect(census.frameChecksumSha256).toBe(createHash("sha256").update(`${JSON.stringify(census.buildingIds, null, 2)}\n`).digest("hex"));
  });
});

describe("the honest stop is arithmetic, not an opinion", () => {
  it("re-derives the budget from the committed vehicle constants", () => {
    const optics = vehicleOptics();
    // The single most favourable member of the census, from the record.
    const best = budgetFor(48.0, 19.4, optics);
    expect(best.total).toBeGreaterThan(0.02);
    // ...and the ring term alone already spends half the bar, for every building.
    expect(best.t2).toBeCloseTo(1 - (399 / 401) ** 2, 12);
    expect(best.t2).toBeGreaterThan(0.009);
  });

  it("records zero buildings under the bar in both measured strata", () => {
    const budget = readRecord("error-budget");
    expect(budget.strata.census.underBarCount).toBe(0);
    expect(budget.strata.census.population).toBe(424);
    expect(budget.strata.nearCap.underBarCount).toBe(0);
    expect(budget.strata.nearCap.population).toBe(53);
    expect(budget.verdict.overall).toContain("HONEST-STOP");
  });

  it("states the budget is an OPTIMISTIC bound, so a reader cannot mistake it for the worst case", () => {
    const budget = readRecord("error-budget");
    expect(budget.terms.direction).toContain("OPTIMISTIC LOWER BOUND");
    expect(budget.terms.t4Isolation).toContain("UNBOUNDED");
  });

  it("never calls the in-app instrument criterion-19's", () => {
    // The whole adjudication turns on this distinction, so it is pinned rather
    // than trusted to reviewer attention.
    for (const name of ["pre-registration", "error-budget"]) {
      const text = readText(join(RECORD_ROOT, `${name}.json`));
      expect(text).not.toMatch(/criterion[- ]19'?s? instrument/iu);
      expect(text).toMatch(/THE BAR IS CARRIED|bar is carried/iu);
    }
  });

  it("keeps INCONCLUSIVE in the verdict vocabulary", () => {
    const pre = readRecord("pre-registration");
    expect(Object.keys(pre.verdictVocabulary)).toContain("INCONCLUSIVE");
    expect(pre.verdictVocabulary.INCONCLUSIVE).toContain("error budget");
  });
});

describe("the shed-tone half is separated from the stopped half by construction", () => {
  it("carries all five ADR 0056 pairs and no others", () => {
    const shed = readRecord("shed-tone-budget");
    expect(shed.pairs.map((p) => p.buildingId).sort()).toEqual([...SHED_TONE_PAIRS].sort());
    expect(SHED_TONE_PAIRS).toHaveLength(5);
  });

  it("finds every pair present and two-LOD eligible, so a ring crossing can flip it", () => {
    const shed = readRecord("shed-tone-budget");
    for (const pair of shed.pairs) {
      expect(pair.present, pair.buildingId).toBe(true);
      expect(pair.twoLodEligible, pair.buildingId).toBe(true);
    }
  });

  it("erodes the outline away rather than arguing the boundary is small", () => {
    const shed = readRecord("shed-tone-budget");
    expect(shed.erosionPixels).toBe(3);
    expect(shed.whyThisIsNotTheHonestStoppedMeasure).toContain("no outline in it");
    for (const pair of shed.pairs) {
      expect(pair.interiorPixelsAfterErosion, pair.buildingId).toBeGreaterThan(1000);
      expect(pair.quantisationOfMeanLuminance, pair.buildingId).toBeLessThan(0.0001);
    }
  });

  it("keeps isolation named as a live residual instead of assumed away", () => {
    const shed = readRecord("shed-tone-budget");
    expect(shed.residualTermsNotInTheNumber.join(" ")).toContain("ISOLATION");
    expect(shed.residualTermsNotInTheNumber.join(" ")).toContain("INCONCLUSIVE");
  });
});

describe("the records describe the bytes actually under test", () => {
  it("binds the six serving manifest inventories by their committed checksums", () => {
    for (const releaseId of SERVING_RELEASE_IDS) {
      const inventoryPath = join("data", releaseId, "payload-inventory.json");
      expect(existsSync(inventoryPath), `${releaseId} inventory missing`).toBe(true);
      const text = readText(inventoryPath);
      const declared = readText(join("data", releaseId, "payload-inventory.sha256")).trim().split(/\s+/u)[0];
      expect(createHash("sha256").update(text).digest("hex"), releaseId).toBe(declared);
    }
  });

  it("pins the vehicle optics the budget was computed for", () => {
    const optics = vehicleOptics();
    expect(VEHICLE.ringMeters).toBe(400);
    expect(VEHICLE.nearArmMeters).toBe(399);
    expect(VEHICLE.farArmMeters).toBe(401);
    expect(optics.verticalDevicePixels).toBe(1580);
    expect(optics.fovyDegrees).toBeCloseTo(48.821, 2);
    expect(optics.pixelsPerMetreAt(400)).toBeCloseTo(4.3518, 3);
  });
});
