/**
 * The far-tier records claim two things: that they are what they say they are,
 * and that producing them disturbed nothing that was already frozen. These
 * tests attack both, and the second matters more — a task that quietly moves a
 * committed checksum has broken the ledger even if its own numbers are right.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { FAR_TIER_BUDGET_CONTRACT, farTierBudgetContractHash, farTierDeliveredQuality } from "../src/release/far-tier-budget.ts";
import { farTierRecipeHash } from "../src/release/far-tier-bake.ts";
import { AUDITED_WORKING_RECORD_DIRECTORIES } from "./public-showcase-audit-cli.mjs";
import { EXPECTED_TEXTURE_BYTE_LENGTH } from "./exterior-acceptance-campaign-constants.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceRoot = join(repositoryRoot, "data", "far-tier-hlod-20260818");
const readRecord = (name) => readFileSync(join(evidenceRoot, `${name}.json`), "utf8");
const readJson = (name) => JSON.parse(readRecord(name));

const RECORDS = ["stage0-hierarchy", "bake-pre-registration", "prototype-provenance", "sampling-results"];

describe("every far-tier record matches its own sidecar", () => {
  for (const name of RECORDS) {
    it(`${name} reproduces its committed checksum`, () => {
      const declared = readFileSync(join(evidenceRoot, `${name}.sha256`), "utf8").trim().split(/\s+/u);
      expect(declared[1]).toBe(`${name}.json`);
      expect(sha256HexSync(readRecord(name))).toBe(declared[0]);
    });
  }
});

describe("the pre-registration really does predate the measurements", () => {
  it("carries no capture timestamp in any record", () => {
    // A timestamp is the one field a replay cannot reproduce, and in a
    // pre-registration it would also be a quiet lie about when the bars were set.
    for (const name of RECORDS) expect(readJson(name).capturedAt).toBeNull();
  });

  it("binds the results to the pre-registration by checksum, not by assertion", () => {
    const results = readJson("sampling-results");
    expect(results.preRegistration.sha256).toBe(sha256HexSync(readRecord("bake-pre-registration")));
  });

  it("derives the bars from the hierarchy record rather than typing them beside it", () => {
    const pre = readJson("bake-pre-registration");
    expect(pre.derivedFrom.sha256).toBe(sha256HexSync(readRecord("stage0-hierarchy")));
  });

  it("pins the recipe and contract hashes the code actually computes", () => {
    const pre = readJson("bake-pre-registration");
    expect(pre.recipe.recipeSha256).toBe(farTierRecipeHash());
    expect(pre.budgetBars.contractSha256).toBe(farTierBudgetContractHash());
    expect(readJson("prototype-provenance").provenance.recipeSha256).toBe(farTierRecipeHash());
  });
});

describe("the bars are reported against verbatim, including where they are missed", () => {
  it("records the tone bar as a MISS rather than rounding it into a pass", () => {
    const results = readJson("sampling-results");
    expect(results.result_tone.verdict).toBe("MISS");
    expect(results.result_tone.missingPoses).toHaveLength(1);
    // And the excess is stated as a number, not described.
    expect(results.result_tone.missingPoses[0].excess).toBeGreaterThan(0);
  });

  it("keeps every barred pose's reading, passing or not", () => {
    const barred = readJson("sampling-results").results.filter((entry) => entry.barred);
    expect(barred).toHaveLength(4);
    for (const entry of barred) expect(typeof entry.unionMeanLuminanceRatio).toBe("number");
  });

  it("does not silently swap the primary measure for the friendlier one", () => {
    // The intersection measure would have passed all four. The record must say
    // so AND must still report the union verdict as the outcome.
    const tone = readJson("sampling-results").result_tone;
    expect(tone.statedPlainly).toContain("NOT re-judged");
    expect(tone.verdict).toBe("MISS");
  });

  it("pre-registered B6 as already missed, and against the DELIVERED resolution", () => {
    const b6 = readJson("bake-pre-registration").budgetBars.B6;
    expect(b6.knownToBeMissed).toBe(true);
    // The bar must be judged on what the packer delivers, not on a 100%-full
    // atlas that no packer achieves. Deriving it from the ideal ladder alone
    // understated the shortfall by more than half, which is the defect this
    // assertion exists to stop recurring.
    expect(b6.rule).toContain("THE RESOLUTION THE PACKER ACTUALLY DELIVERS");
    expect(b6.measuredShortfallDelivered.underResolvedCellCount)
      .toBeGreaterThan(b6.measuredShortfallIdeal.underResolvedCellCount);
    expect(b6.measuredShortfallDelivered.cellsUnpackable).toBeGreaterThan(0);
  });
});

describe("the byte-replay proof", () => {
  it("compared two independent runs and found them identical", () => {
    const replay = readJson("prototype-provenance").byteReplay;
    expect(replay.runs).toBe(2);
    expect(replay.verdict).toBe("PASS");
    expect(replay.run1.glbSha256).toBe(replay.run2.glbSha256);
    expect(replay.run1.atlasSha256).toBe(replay.run2.atlasSha256);
  });

  it("ran the second bake in a FRESH PROCESS, not the same one", () => {
    // This module memoizes the tile integrator and the texture catalogue, so a
    // same-process repeat exercises the caches rather than the computation and
    // cannot catch one that leaks state.
    const replay = readJson("prototype-provenance").byteReplay;
    expect(replay.run1.process).toBe("parent");
    expect(replay.run2.process).toBe("child");
    expect(replay.method).toContain("FRESH CHILD PROCESS");
  });

  it("reports the DELIVERED resolution, consistent with the applied packing scale", () => {
    // The defect this catches: reporting the ideal ratio beside an applied
    // scale of 0.5 stated a sharpness the tile does not have, and B6 requires
    // an under-resolved leaf to be reported as under-resolved.
    const outcome = readJson("prototype-provenance").bakeOutcome;
    // Both operands are recorded to six decimals, so the identity is checked to
    // five; a real inconsistency is orders of magnitude larger than this.
    expect(outcome.appliedTexelWorldSizeMeters)
      .toBeCloseTo(outcome.targetTexelWorldSizeMeters / outcome.appliedResolutionScale, 5);
    const delivered = farTierDeliveredQuality(outcome.appliedTexelWorldSizeMeters);
    expect(outcome.achievedTexelRatio).toBeCloseTo(delivered.achievedRatio, 6);
    expect(outcome.underResolved).toBe(delivered.underResolved);
    expect(outcome.criticalDistanceMeters).toBe(Math.round(delivered.criticalDistanceMeters));
    // A scale below 1 is a real quality loss and must never read as fully resolved.
    if (outcome.appliedResolutionScale < 1) {
      expect(outcome.achievedTexelRatio).toBeLessThan(outcome.idealTexelRatio);
    }
  });

  it("discloses that the sampled tile is not the committed tile", () => {
    const supersession = readJson("sampling-results").subjectDigestSupersession;
    const replay = readJson("prototype-provenance").byteReplay;
    expect(supersession.committedTileGlbSha256).toBe(replay.run1.glbSha256);
    expect(supersession.measuredTileGlbSha256).not.toBe(supersession.committedTileGlbSha256);
    expect(supersession.status).toContain("HAVE NOT BEEN RE-TAKEN");
  });

  it("names every source it derives from by checksum", () => {
    const provenance = readJson("prototype-provenance").provenance;
    expect(provenance.sourceRelease.releaseId).toMatch(/-c2$/u);
    expect(provenance.parentLedger.checksumSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(provenance.cell.membershipChecksumSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(provenance.sourceAssets.length).toBeGreaterThan(0);
    for (const asset of provenance.sourceAssets) expect(asset.checksumSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(provenance.classTiles.length).toBeGreaterThan(0);
  });

  it("proves rather than asserts that the regenerated sources are the shipped bytes", () => {
    const verification = readJson("prototype-provenance").provenance.sourceAssetVerification;
    expect(verification.verdict).toBe("PASS");
    expect(verification.byteIdentical).toBe(verification.compared);
  });

  it("carries the narrower rights envelope onto the derivative", () => {
    const rights = readJson("prototype-provenance").rights;
    expect(rights.envelope).toContain("NARROWER");
    expect(rights.envelope).toContain("Retention and local display only");
    expect(rights.note).toContain("does not widen an approval envelope");
  });
});

describe("nothing already frozen was disturbed", () => {
  it("leaves T006's G2 bar and its committed record untouched", () => {
    // Superseded BY STATEMENT for the far tier only. The T006 record must still
    // reproduce its own committed checksum, and the constant must not have moved.
    const t006Root = join(repositoryRoot, "data", "exterior-acceptance-20260817");
    const text = readFileSync(join(t006Root, "pre-registration.json"), "utf8");
    const declared = readFileSync(join(t006Root, "pre-registration.sha256"), "utf8").trim().split(/\s+/u)[0];
    expect(sha256HexSync(text)).toBe(declared);
    expect(sha256HexSync(text)).toBe("132adaf5ffdb8558400e06d3650cb7b03db90976f12eeacdb183876d6404d2bf");
    expect(EXPECTED_TEXTURE_BYTE_LENGTH).toBe(2_097_144);
    expect(JSON.parse(text).gates.gpu.G2.expectedByteLength).toBe(2_097_144);

    const supersede = readJson("bake-pre-registration").supersedes.T006_G2.statement;
    expect(supersede).toContain("FOR THE FAR TIER ONLY");
    expect(supersede).toContain("IS NOT REGENERATED");
  });

  it("adds no AUDITED_WORKING_RECORD_DIRECTORIES entry", () => {
    // The far tier's evidence directory is deliberately NOT declared: adding one
    // would move the committed differential-audit checksum, which is exactly the
    // drift that constant exists to stop.
    expect(AUDITED_WORKING_RECORD_DIRECTORIES).not.toContain("far-tier-hlod-20260818");
    expect(AUDITED_WORKING_RECORD_DIRECTORIES).toHaveLength(21);
  });

  it("leaves the -c1 and -c2 payload inventories exactly as committed", () => {
    for (const releaseId of ["manhattan-exterior-cells-20260811-v3-c1", "manhattan-northern-manhattan-cells-20260812-c2"]) {
      const root = join(repositoryRoot, "data", releaseId);
      const text = readFileSync(join(root, "payload-inventory.json"), "utf8");
      const declared = readFileSync(join(root, "payload-inventory.sha256"), "utf8").trim().split(/\s+/u)[0];
      expect(sha256HexSync(text)).toBe(declared);
    }
  });

  it("reverses ADR 0047 for the far tier only, and says so", () => {
    const statement = readJson("bake-pre-registration").supersedes.ADR_0047.statement;
    expect(statement).toContain("FOR THE FAR TIER ONLY");
    expect(statement).toContain("continues to govern the near and mid tiers unchanged");
  });

  it("keeps the far tier's budget out of the closed criterion #30", () => {
    expect(FAR_TIER_BUDGET_CONTRACT.scope).toContain("and nothing else");
    expect(readJson("bake-pre-registration").budgetBars.separateFromCriterion30).toContain("NOT FOLDED INTO THE CLOSED 256 MiB CRITERION #30");
  });
});

describe("the derived budget bars and the code agree", () => {
  it("pins the CUT-INDEPENDENT bound, not the sampled sweep maximum", () => {
    const hierarchy = readJson("stage0-hierarchy");
    const bound = hierarchy.cutIndependentBound;
    expect(bound.atlasGpuBytes).toBe(FAR_TIER_BUDGET_CONTRACT.maxResidentAtlasGpuBytes);
    expect(bound.geometryGpuBytes).toBe(FAR_TIER_BUDGET_CONTRACT.maxResidentGeometryGpuBytes);
    expect(bound.totalGpuBytes).toBe(FAR_TIER_BUDGET_CONTRACT.maxResidentTotalGpuBytes);
    // And it must actually dominate the thing it replaced, or it is not a bound.
    expect(bound.totalGpuBytes).toBeGreaterThan(hierarchy.worstCaseResidency.totalGpuBytes);
  });

  it("does not claim the sweep is a bound, and shows why", () => {
    const worst = readJson("stage0-hierarchy").worstCaseResidency;
    expect(worst.quantifier).toContain("NOT a proven bound");
    // The ladder is the evidence. It must be a real ladder, and it must record
    // that refinement kept moving the answer rather than settling.
    expect(worst.refinementLadder.length).toBeGreaterThanOrEqual(4);
    const totals = worst.refinementLadder.map((entry) => entry.totalGpuBytes);
    expect(Math.max(...totals)).toBeGreaterThan(Math.min(...totals));
    expect(worst.stable).toBe(false);
    expect(worst.stabilityStatement).toContain("NOT STABLE");
  });

  it("rejects 'all leaves resident' as a bound, with its counterexample count", () => {
    const rejected = readJson("stage0-hierarchy").cutIndependentBound.allLeavesRejectedAsBound;
    expect(rejected.internalNodesCostlierThanTheirChildren).toBeGreaterThan(0);
  });

  it("states the geometry limitation rather than leaving it to be inferred", () => {
    const hierarchy = readJson("stage0-hierarchy");
    expect(hierarchy.hierarchy.geometryLimitation).toContain("DOES NOT REDUCE GEOMETRY RESIDENCY AT ALL");
    // The swept geometry worst case IS the whole island's, and that identity is
    // the evidence for the claim, so it must hold.
    expect(hierarchy.worstCaseResidency.geometryGpuBytes).toBe(hierarchy.allLeavesResidentUpperBound.geometryGpuBytes);
  });
});

describe("the sampling record's own arithmetic holds", () => {
  // A reading typed by hand, or a pose silently edited to look better, should
  // fail here rather than sit in a committed record looking plausible.
  const results = readJson("sampling-results").results;

  it("has every pose the instrument pre-registered, and no others", () => {
    const poses = readJson("bake-pre-registration").blenderAgreementInstrument.poses;
    const expected = poses.distancesMeters.flatMap((d) => poses.azimuthsDegrees.map((a) => `${d}/${a}`));
    expect(results.map((entry) => `${entry.distanceMeters}/${entry.azimuthDegrees}`).sort()).toEqual(expected.sort());
  });

  it("partitions the union silhouette exactly", () => {
    for (const entry of results) {
      expect(entry.unionPixels).toBe(entry.intersectionPixels + entry.sourceOnlyPixels + entry.bakedOnlyPixels);
      expect(entry.intersectionOverUnion).toBeCloseTo(entry.intersectionPixels / entry.unionPixels, 6);
    }
  });

  it("reproduces each channel spread from its own per-channel ratios", () => {
    for (const entry of results) {
      // Recorded to six decimals; a difference of two such values carries at
      // most that precision, so the identity is checked to five.
      expect(entry.channelSpread).toBeCloseTo(Math.max(...entry.perChannelRatios) - Math.min(...entry.perChannelRatios), 5);
    }
  });

  it("reproduces the union ratio from the absolute luminances it also records", () => {
    for (const entry of results) {
      expect(entry.unionMeanLuminanceRatio).toBeCloseTo(entry.bakedMeanLuminance / entry.sourceMeanLuminance, 4);
      expect(entry.absoluteLuminanceDelta).toBeCloseTo(entry.bakedMeanLuminance - entry.sourceMeanLuminance, 6);
    }
  });

  it("agrees with its own verdict about which barred poses missed", () => {
    const tone = readJson("sampling-results").result_tone;
    const bar = 0.05;
    const missed = results.filter((entry) => entry.barred && Math.abs(entry.unionMeanLuminanceRatio - 1) > bar);
    expect(missed).toHaveLength(tone.missingPoses.length);
    expect(tone.passed).toBe(results.filter((entry) => entry.barred).length - missed.length);
    expect(tone.verdict).toBe(missed.length > 0 ? "MISS" : "PASS");
    for (const entry of missed) {
      const declared = tone.missingPoses.find((pose) => pose.distanceMeters === entry.distanceMeters && pose.azimuthDegrees === entry.azimuthDegrees);
      expect(declared).toBeDefined();
      expect(declared.excess).toBeCloseTo(Math.abs(entry.unionMeanLuminanceRatio - 1) - bar, 6);
    }
  });

  it("names the unexplained residual rather than leaving it undiscussed", () => {
    const residual = readJson("sampling-results").diagnosis.unexplainedResidual;
    expect(residual.status).toContain("UNEXPLAINED");
    expect(residual.whatWouldSettleIt.length).toBeGreaterThan(0);
  });
});
