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
import { readFileSync, existsSync, readdirSync } from "node:fs";
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

describe("the viewport-scaling model is not inert", () => {
  it("scales BOTH axes, so resolution actually moves", () => {
    // The first revision scaled only the height. That changed the aspect, which
    // changed the derived vertical FOV by the compensating amount, so
    // pixels-per-metre came out invariant and the table read "0 under the bar"
    // at every multiple -- self-refuting, since T2 alone is 0.995% and a large
    // enough target must clear 2%.
    const budget = readRecord("error-budget");
    const rows = budget.viewportScaling.rows;
    expect(rows.map((r) => r.multiple)).toEqual([1, 2, 4, 8, 16, 32]);
    expect(rows[0].censusUnderBar).toBe(0);
    // The non-1x rows are the point: pin one that must be non-zero.
    const eightX = rows.find((r) => r.multiple === 8);
    expect(eightX.verticalDevicePixels).toBe(12640);
    expect(eightX.censusUnderBar).toBeGreaterThan(0);
    expect(rows.find((r) => r.multiple === 32).censusUnderBar).toBeGreaterThan(eightX.censusUnderBar);
  });

  it("uses the OPERATIVE threshold, not the boundary term alone", () => {
    const budget = readRecord("error-budget");
    const t = budget.resolutionThreshold;
    expect(t.boundaryTermAloneAreaDevicePixels).toBeCloseTo(40000, 0);
    // T1+T3 = 6/sqrt(A) against the bar less T2.
    expect(t.operativeAreaDevicePixelsNeeded).toBeGreaterThan(300000);
    expect(t.boundaryTermAloneStatement).toContain("NOT the operative one");
  });

  it("switches the FOV axis when the target is taller than it is wide", () => {
    const portrait = vehicleOptics({ ...VEHICLE, canvasCssWidth: 790, canvasCssHeight: 1005 });
    // Cesium applies `fov` to the wider axis; portrait means it IS the vertical.
    expect(portrait.fovyDegrees).toBeCloseTo(60, 6);
  });
});

describe("every committed record is bound to its sidecar", () => {
  it("covers all of them, not just the ones a test happened to name", () => {
    // The verifier found shed-tone-plan, shed-tone-results and
    // staging-provenance unguarded, and no discovery scan reaching this
    // directory. This is the local equivalent: the list is derived from the
    // directory, so a new record cannot be added without being bound.
    const names = readdirSync(RECORD_ROOT).filter((n) => n.endsWith(".json")).map((n) => n.replace(/\.json$/u, ""));
    expect(names.length).toBeGreaterThanOrEqual(8);
    for (const name of names) expect(readRecord(name), name).toBeTypeOf("object");
  });

  it("keeps the withdrawn campaign withdrawn, and unedited in its verdicts", () => {
    const withdrawn = readRecord("shed-tone-results");
    expect(withdrawn.supersededBy.record).toBe("shed-tone-results-v2.json");
    expect(withdrawn.supersededBy.statement).toContain("WITHDRAWN");
    expect(withdrawn.supersededBy.theDefect).toContain("184");
    // The numbers it recorded are still there to be inspected.
    expect(withdrawn.summary.fail).toBe(2);
  });

  it("records the corrected campaign as attributable to nothing", () => {
    const v2 = readRecord("shed-tone-results-v2");
    expect(v2.summary.pass).toBe(0);
    expect(v2.summary.fail).toBe(0);
    expect(v2.summary.inconclusiveByInstrument).toBe(6);
    for (const pair of v2.pairs) {
      expect(pair.verdict, pair.buildingId).toBe("INCONCLUSIVE-BY-INSTRUMENT");
      expect(pair.identityConfirmed, pair.buildingId).toBe(false);
    }
    expect(v2.whyNotVerdicts.theWireControlIsNecessaryAndNOTSufficient).toContain("RASTERIZED");
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
