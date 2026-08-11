import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { V3T_QUALITY_BUDGETS } from "./block835-v3-package.ts";
import { MIDTOWN_CORE_V3_VOLUME_TOLERANCE } from "./midtown-core-v3-materialization.ts";
import { NORTHERN_MANHATTAN_BUILDING_COUNT, NORTHERN_MANHATTAN_RELEASE_ID } from "./northern-manhattan-package.ts";

/**
 * The committed wave census, checked for internal consistency.
 *
 * `payload-inventory.json` is checked elsewhere and describes the SHIPPED subset.
 * This file is the statement about all 10,230 owned buildings, and it is the only
 * place the wave's refusal distribution survives once the untracked work root is
 * gone. Nothing re-derives it — it would take a full census to do so — but a census
 * that does not add up is checkable without re-running anything, and an arithmetic
 * error in it would otherwise be permanent.
 *
 * Never skipped: the record is committed, so an absent payload directory is no
 * excuse, and a pipeline change that moved the distribution has to move this file
 * to stay green.
 */
const RECORD_ROOT = "data/northern-manhattan-20260812";

interface WaveCensusRecord {
  releaseId: string;
  note: string;
  wave: {
    requestedBuildingCount: number;
    resolvedBuildingCount: number;
    materializedBuildingCount: number;
    refusedBuildingCount: number;
    tierCollapseAbsentSetbackCount: number;
    generatedAssetCount: number;
    uniquePlanHashCount: number;
    maximumTriangleCount: number;
    maximumTextureCount: number;
    retention: string;
    shippedAssetCount: number;
    shippedAssetBytes: number;
    worstVolumeDeviation: number;
    refusalsByCode: Record<string, number>;
    styleClassCounts: Record<string, number>;
  };
  waveRefusals: Record<string, number>;
  volumeIdentity: {
    stage: string;
    stopCode: string;
    buildingsChecked: number;
    buildingsRejected: number;
    worstVolumeDeviation: number;
    tolerance: number;
    worstDeviationAsFractionOfTolerance: number;
    statement: string;
  };
  shipped: { requestedBuildingCount: number; materializedBuildingCount: number; refusedBuildingCount: number; tierCollapseAbsentSetbackCount: number };
}

function readText(path: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(readFileSync(path)));
}

const census = JSON.parse(readText(`${RECORD_ROOT}/wave-census.json`)) as WaveCensusRecord;

/** The one stop code the writer raises and the plan stage cannot. */
const WRITER_STAGE_STOP_CODE = "volume-identity-failed";

describe("northern-manhattan committed wave census", () => {
  it("describes the release this module names", () => {
    expect(census.releaseId).toBe(NORTHERN_MANHATTAN_RELEASE_ID);
    expect(census.wave.requestedBuildingCount).toBe(NORTHERN_MANHATTAN_BUILDING_COUNT);
  });

  /** Every refused building is accounted for by exactly one named stop code. */
  it("has a stop-code distribution that sums to its own refusal count", () => {
    const summed = Object.values(census.wave.refusalsByCode).reduce((total, count) => total + count, 0);
    expect(summed).toBe(census.wave.refusedBuildingCount);
    expect(Object.values(census.wave.refusalsByCode).every((count) => count > 0)).toBe(true);
    // Six named codes, none of them a catch-all: a refusal that could not be named
    // would be a refusal this grammar could not explain.
    expect(Object.keys(census.wave.refusalsByCode).sort()).toEqual([
      "ring-area-below-floor",
      "ring-neck-below-grammar-minimum",
      "ring-not-simple",
      "ring-vertex-count-unsupported",
      "source-height-below-grammar-minimum",
      WRITER_STAGE_STOP_CODE,
    ]);
  });

  it("accounts for every owned building exactly once", () => {
    expect(census.wave.materializedBuildingCount + census.wave.refusedBuildingCount).toBe(census.wave.requestedBuildingCount);
    expect(census.wave.resolvedBuildingCount).toBe(census.wave.requestedBuildingCount);
    // One plan hash per materialized building, and two canonical LODs each.
    expect(census.wave.uniquePlanHashCount).toBe(census.wave.materializedBuildingCount);
    expect(census.wave.generatedAssetCount).toBe(census.wave.materializedBuildingCount * 2);
    const styled = Object.values(census.wave.styleClassCounts).reduce((total, count) => total + count, 0);
    expect(styled).toBe(census.wave.materializedBuildingCount);
  });

  /** The refusal STOP this task was given, checked against the committed record. */
  it("stays far below the 15% wave refusal ceiling, with no tolerance moved", () => {
    const ratio = census.wave.refusedBuildingCount / census.wave.requestedBuildingCount;
    expect(ratio).toBeLessThan(0.15);
    expect(ratio).toBeCloseTo(0.0372, 4);
    expect(census.wave.refusedBuildingCount).toBe(381);
  });

  /**
   * THE RELATIONSHIP BETWEEN THE TWO DISTRIBUTIONS.
   *
   * `waveRefusals` is the plan stage: the grammar reading a sourced polygon.
   * `wave.refusalsByCode` is the asset stage: the same plans, plus the writer's
   * mesh-versus-analytic volume identity check, which can only fail AFTER a plan
   * has been accepted and geometry generated. So the asset distribution is always a
   * superset and the only key that can appear in it alone is the writer's.
   *
   * WHAT IS ASSERTED IS THE SUBSET RELATIONSHIP AND THE IDENTITY OF THE ONLY KEY
   * THAT MAY DIFFER — not whether the two totals happen to be equal. Wave w03's
   * census asserted a non-empty difference and wave w04's could not, because for
   * that wave the writer rejected nothing. For this wave it rejected 16. Pinning
   * "equal" or "unequal" is pinning an accident of the partition; pinning the
   * relationship is pinning the contract.
   */
  it("carries a plan-stage distribution the asset-stage one can only extend by the writer's own code", () => {
    for (const [code, count] of Object.entries(census.waveRefusals)) {
      expect(census.wave.refusalsByCode[code]).toBe(count);
    }
    expect(census.waveRefusals[WRITER_STAGE_STOP_CODE]).toBeUndefined();

    const planTotal = Object.values(census.waveRefusals).reduce((total, count) => total + count, 0);
    const assetTotal = census.wave.refusedBuildingCount;
    expect(assetTotal - planTotal).toBe(census.wave.refusalsByCode[WRITER_STAGE_STOP_CODE] ?? 0);
    expect(planTotal).toBe(365);

    // The codes may differ by at most that one key, and never in the other
    // direction: a plan-stage code missing from the asset stage would mean a
    // refused plan silently became an asset.
    const planCodes = new Set(Object.keys(census.waveRefusals));
    const assetCodes = new Set(Object.keys(census.wave.refusalsByCode));
    expect([...assetCodes].filter((code) => !planCodes.has(code)).every((code) => code === WRITER_STAGE_STOP_CODE)).toBe(true);
    expect([...planCodes].filter((code) => !assetCodes.has(code))).toEqual([]);
  });

  /**
   * The writer's check recorded as a MEASUREMENT rather than inferred from two
   * totals. For this wave the two totals happen to differ, which is suggestive but
   * still not proof: the count checked and the worst deviation observed are what
   * distinguish a check that ran from one that did not.
   */
  it("shows the writer's volume check ran on every materialized building, and what it rejected", () => {
    expect(census.volumeIdentity.stage).toBe("asset-writer");
    expect(census.volumeIdentity.stopCode).toBe(WRITER_STAGE_STOP_CODE);
    expect(census.volumeIdentity.buildingsChecked).toBe(census.wave.materializedBuildingCount);
    expect(census.volumeIdentity.buildingsRejected).toBe(census.wave.refusalsByCode[WRITER_STAGE_STOP_CODE]);
    expect(census.volumeIdentity.buildingsRejected).toBe(16);
    // Ran, rather than trivially reported: a non-zero worst deviation over the
    // whole wave is only producible by comparing geometry that was generated.
    expect(census.volumeIdentity.worstVolumeDeviation).toBeGreaterThan(0);
    expect(census.volumeIdentity.worstVolumeDeviation).toBe(census.wave.worstVolumeDeviation);
    expect(census.volumeIdentity.tolerance).toBe(MIDTOWN_CORE_V3_VOLUME_TOLERANCE);
  });

  /**
   * THE NARROWEST MARGIN OF ANY WAVE SO FAR, PINNED RATHER THAN LEFT TO BE NOTICED.
   *
   * Wave w04 passed at 0.988 of the tolerance and ADR 0036 called that narrow. This
   * wave's worst ACCEPTED case sits higher still, and 16 buildings landed on the
   * other side of the line and were refused. So "inside tolerance" is true and is
   * not the same as "comfortably inside".
   *
   * The bound is asserted from BELOW as well as above so that a future change which
   * quietly widened the tolerance, making the margin look comfortable, fails here
   * instead of passing. Both directions matter: the upper bound is the correctness
   * claim, the lower bound is the honesty claim.
   */
  it("discloses that the volume check passed with under two hundredths of the tolerance to spare", () => {
    expect(census.volumeIdentity.worstDeviationAsFractionOfTolerance)
      .toBeCloseTo(census.volumeIdentity.worstVolumeDeviation / census.volumeIdentity.tolerance, 12);
    expect(census.volumeIdentity.worstDeviationAsFractionOfTolerance).toBeLessThan(1);
    expect(census.volumeIdentity.worstDeviationAsFractionOfTolerance).toBeGreaterThan(0.98);
    expect(census.volumeIdentity.statement).toContain("THE MARGIN IS NARROW AND IS REPORTED RATHER THAN ROUNDED AWAY");
    expect(census.volumeIdentity.statement).toContain("No tolerance was moved");
    // The statement describes THIS run: it names the rejections rather than
    // assuming there were none, which the predecessor wave's fixed prose did.
    expect(census.volumeIdentity.statement).toContain("It REJECTED 16 of them");
    expect(census.volumeIdentity.statement).toContain("the worst among the buildings it ACCEPTED");
  });

  /**
   * The note has to explain the relationship, because a reader who finds two
   * refusal totals in one file and no explanation will reasonably conclude one of
   * them is wrong.
   *
   * IT ALSO HAS TO STOP INHERITING ITS PREDECESSORS' CONCLUSIONS. ADR 0035 read a
   * meaning into equal totals; ADR 0036 retracted it; this note refuses to read a
   * meaning into either equality or inequality, and it is GENERATED from the
   * measurements so it cannot drift back.
   */
  it("explains the plan/writer stage relationship in its own note, and claims nothing from the totals", () => {
    expect(census.note).toContain("TWO REFUSAL DISTRIBUTIONS ARE RECORDED AND FOR THIS WAVE THEY DIFFER: 365 at the plan stage and 381 at the asset stage, a difference of 16, all of it `volume-identity-failed`.");
    expect(census.note).toContain("`waveRefusals` is the PLAN stage");
    expect(census.note).toContain("`wave.refusalsByCode` is the ASSET stage");
    expect(census.note).toContain("NEITHER EQUALITY NOR INEQUALITY OF THE TWO TOTALS IS EVIDENCE THAT THE WRITER'S CHECK RAN");
    expect(census.note).toContain("ADR 0035 inferred one thing from equal totals and ADR 0036 had to retract it");
    expect(census.note).toContain("This note is GENERATED from those measurements rather than written beside them");
    // The generated numbers agree with the fields they describe, which is what
    // makes the note a statement about this run rather than about a remembered one.
    expect(census.note).toContain(`the count checked (${census.volumeIdentity.buildingsChecked.toLocaleString("en-US")})`);
    expect(census.note).toContain(`the count rejected (${census.volumeIdentity.buildingsRejected.toLocaleString("en-US")})`);
  });

  /**
   * `shippedAssetCount: 0` beside a non-zero `shippedAssetBytes` is a retention
   * mode, not a contradiction, and the note has to say so before the numbers are
   * read.
   */
  it("states its retention mode rather than leaving a zero to be misread", () => {
    expect(census.wave.retention).toBe("census-only");
    expect(census.wave.shippedAssetCount).toBe(0);
    expect(census.wave.shippedAssetBytes).toBeGreaterThan(0);
    expect(census.note).toContain("READ `wave.retention` BEFORE `wave.shippedAssetCount`");
  });

  it("is an UNTEXTURED census inside the geometry budgets", () => {
    expect(census.wave.maximumTextureCount).toBe(0);
    expect(census.wave.maximumTriangleCount).toBeLessThanOrEqual(V3T_QUALITY_BUDGETS.maxTriangles);
  });

  it("accounts for the shipped subset the same way", () => {
    expect(census.shipped.materializedBuildingCount + census.shipped.refusedBuildingCount)
      .toBe(census.shipped.requestedBuildingCount);
    expect(census.shipped.requestedBuildingCount).toBe(86);
  });

  /**
   * The shipped subset refuses a MUCH higher share of its buildings than the wave
   * does — 10 of 86 against 381 of 10,230, which is 11.6% against 3.7% — and that
   * is recorded rather than smoothed. A canary's subset is order-derived, so it has
   * no reason to be representative, and reporting only the wave rate would let a
   * reader assume it was.
   *
   * The gap is WIDER here than in any earlier wave canary, and the ratio is
   * asserted rather than only the direction, so a future subset that quietly became
   * representative would have to say so.
   */
  it("does not hide that the shipped subset refuses at more than three times the wave rate", () => {
    const waveRate = census.wave.refusedBuildingCount / census.wave.requestedBuildingCount;
    const shippedRate = census.shipped.refusedBuildingCount / census.shipped.requestedBuildingCount;
    expect(census.shipped.refusedBuildingCount).toBe(10);
    expect(shippedRate).toBeGreaterThan(waveRate);
    expect(shippedRate / waveRate).toBeGreaterThan(3);
    expect(shippedRate).toBeCloseTo(0.1163, 4);
  });

  /**
   * The honest half of the census. A building whose massing collapses to one
   * effective tier ships `setbacks` absent with a stated reason rather than an
   * invented offset, and the count is large enough that hiding it would be a
   * material omission — here it is the MAJORITY of the wave, which is a first.
   */
  it("discloses absent setbacks as a first-class count, and they are now the majority", () => {
    expect(census.wave.tierCollapseAbsentSetbackCount).toBeGreaterThan(0);
    expect(census.wave.tierCollapseAbsentSetbackCount).toBeLessThanOrEqual(census.wave.materializedBuildingCount);
    expect(census.wave.tierCollapseAbsentSetbackCount).toBe(5_880);
    // Stated as a share, because "5,880" alone reads as a footnote and "60% of the
    // materialized buildings ship no setback" does not. Wave w04's share was 46.6%;
    // this one crosses a half.
    expect(census.wave.tierCollapseAbsentSetbackCount / census.wave.materializedBuildingCount).toBeGreaterThan(0.5);
    expect(census.wave.tierCollapseAbsentSetbackCount / census.wave.materializedBuildingCount).toBeCloseTo(0.597, 3);
    // The shipped subset discloses it too, at a similar share.
    expect(census.shipped.tierCollapseAbsentSetbackCount).toBe(53);
  });
});
