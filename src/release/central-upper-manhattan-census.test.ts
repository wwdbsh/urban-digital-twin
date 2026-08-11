import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { V3T_QUALITY_BUDGETS } from "./block835-v3-package.ts";
import { MIDTOWN_CORE_V3_VOLUME_TOLERANCE } from "./midtown-core-v3-materialization.ts";
import { CENTRAL_UPPER_MANHATTAN_BUILDING_COUNT, CENTRAL_UPPER_MANHATTAN_RELEASE_ID } from "./central-upper-manhattan-package.ts";

/**
 * The committed wave census, checked for internal consistency.
 *
 * `payload-inventory.json` is checked elsewhere and describes the SHIPPED subset.
 * This file is the statement about all 11,721 owned buildings, and it is the only
 * place the wave's refusal distribution survives once the untracked work root is
 * gone. Nothing re-derives it — it would take a full census to do so — but a
 * census that does not add up is checkable without re-running anything, and an
 * arithmetic error in it would otherwise be permanent.
 *
 * Never skipped: the record is committed, so an absent payload directory is no
 * excuse, and a pipeline change that moved the distribution has to move this file
 * to stay green.
 */
const RECORD_ROOT = "data/central-upper-manhattan-20260812";

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
  shipped: { requestedBuildingCount: number; materializedBuildingCount: number; refusedBuildingCount: number };
}

function readText(path: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(readFileSync(path)));
}

const census = JSON.parse(readText(`${RECORD_ROOT}/wave-census.json`)) as WaveCensusRecord;

/** The one stop code the writer raises and the plan stage cannot. */
const WRITER_STAGE_STOP_CODE = "volume-identity-failed";

describe("central-upper-manhattan committed wave census", () => {
  it("describes the release this module names", () => {
    expect(census.releaseId).toBe(CENTRAL_UPPER_MANHATTAN_RELEASE_ID);
    expect(census.wave.requestedBuildingCount).toBe(CENTRAL_UPPER_MANHATTAN_BUILDING_COUNT);
  });

  /** Every refused building is accounted for by exactly one named stop code. */
  it("has a stop-code distribution that sums to its own refusal count", () => {
    const summed = Object.values(census.wave.refusalsByCode).reduce((total, count) => total + count, 0);
    expect(summed).toBe(census.wave.refusedBuildingCount);
    expect(Object.values(census.wave.refusalsByCode).every((count) => count > 0)).toBe(true);
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
    expect(ratio).toBeCloseTo(0.0152, 4);
  });

  /**
   * THE RELATIONSHIP BETWEEN THE TWO DISTRIBUTIONS, AND WHY THIS WAVE'S ANSWER
   * DIFFERS FROM THE PREVIOUS WAVE'S.
   *
   * `waveRefusals` is the plan stage: the grammar reading a sourced polygon.
   * `wave.refusalsByCode` is the asset stage: the same plans, plus the writer's
   * mesh-versus-analytic volume identity check, which can only fail AFTER a plan
   * has been accepted and geometry generated. So the asset distribution is always
   * a superset and the only key that can appear in it alone is the writer's.
   *
   * For wave w03 that difference was 11 buildings and its census test asserted the
   * difference was non-empty. THIS TEST DOES NOT COPY THAT ASSERTION, because for
   * wave w04 the writer rejected nothing and the two distributions are equal.
   * Asserting a non-empty difference here would have forced either a false claim
   * or a moved tolerance. What is invariant — and what is checked — is the
   * SUBSET relationship and the identity of the only key that may differ.
   */
  it("carries a plan-stage distribution the asset-stage one can only extend by the writer's own code", () => {
    for (const [code, count] of Object.entries(census.waveRefusals)) {
      expect(census.wave.refusalsByCode[code]).toBe(count);
    }
    expect(census.waveRefusals[WRITER_STAGE_STOP_CODE]).toBeUndefined();

    const planTotal = Object.values(census.waveRefusals).reduce((total, count) => total + count, 0);
    const assetTotal = census.wave.refusedBuildingCount;
    expect(assetTotal - planTotal).toBe(census.wave.refusalsByCode[WRITER_STAGE_STOP_CODE] ?? 0);

    // The codes may differ by at most that one key, and never in the other
    // direction: a plan-stage code missing from the asset stage would mean a
    // refused plan silently became an asset.
    const planCodes = new Set(Object.keys(census.waveRefusals));
    const assetCodes = new Set(Object.keys(census.wave.refusalsByCode));
    expect([...assetCodes].filter((code) => !planCodes.has(code)).every((code) => code === WRITER_STAGE_STOP_CODE)).toBe(true);
    expect([...planCodes].filter((code) => !assetCodes.has(code))).toEqual([]);
  });

  /**
   * The equality above is only trustworthy if the writer's check actually ran, and
   * two equal totals cannot show that on their own — a check that never executed
   * produces exactly the same two numbers. So the census records the check as a
   * MEASUREMENT and this pins it.
   */
  it("shows the writer's volume check ran on every materialized building and rejected none", () => {
    expect(census.volumeIdentity.stopCode).toBe(WRITER_STAGE_STOP_CODE);
    expect(census.volumeIdentity.buildingsChecked).toBe(census.wave.materializedBuildingCount);
    expect(census.volumeIdentity.buildingsRejected).toBe(0);
    expect(census.wave.refusalsByCode[WRITER_STAGE_STOP_CODE]).toBeUndefined();
    // Ran, rather than trivially reported: a non-zero worst deviation over the
    // whole wave is only producible by comparing geometry that was generated.
    expect(census.volumeIdentity.worstVolumeDeviation).toBeGreaterThan(0);
    expect(census.volumeIdentity.worstVolumeDeviation).toBe(census.wave.worstVolumeDeviation);
    expect(census.volumeIdentity.tolerance).toBe(MIDTOWN_CORE_V3_VOLUME_TOLERANCE);
  });

  /**
   * THE NARROW MARGIN, PINNED RATHER THAN LEFT TO BE NOTICED.
   *
   * This wave passed the volume identity check at more than nine tenths of the
   * tolerance. "Zero rejections" is therefore true and is not the same as "ample
   * headroom", and the difference matters to anyone deciding whether this wave's
   * geometry is sound enough to promote. The bound is asserted from BELOW as well
   * as above so that a future change which quietly widened the tolerance, making
   * the margin look comfortable, fails here instead of passing.
   */
  it("discloses that the volume check passed with under a tenth of the tolerance to spare", () => {
    expect(census.volumeIdentity.worstDeviationAsFractionOfTolerance)
      .toBeCloseTo(census.volumeIdentity.worstVolumeDeviation / census.volumeIdentity.tolerance, 12);
    expect(census.volumeIdentity.worstDeviationAsFractionOfTolerance).toBeLessThan(1);
    expect(census.volumeIdentity.worstDeviationAsFractionOfTolerance).toBeGreaterThan(0.9);
    expect(census.volumeIdentity.statement).toContain("THE MARGIN IS NARROW AND IS REPORTED RATHER THAN ROUNDED AWAY");
    expect(census.volumeIdentity.statement).toContain("No tolerance was moved");
  });

  /**
   * The note has to explain the relationship, because a reader who finds two
   * refusal totals in one file and no explanation will reasonably conclude one of
   * them is wrong — and a reader who knows the previous wave's record will
   * reasonably conclude the check did not run.
   */
  it("explains the plan/writer stage relationship in its own note, and corrects its predecessor", () => {
    expect(census.note).toContain("TWO REFUSAL DISTRIBUTIONS ARE RECORDED AND FOR THIS WAVE THEY ARE EQUAL");
    expect(census.note).toContain("`waveRefusals` is the PLAN stage");
    expect(census.note).toContain("`wave.refusalsByCode` is the ASSET stage");
    expect(census.note).toContain("THE PREVIOUS WAVE'S RECORD SAID EQUAL TOTALS WOULD MEAN THE IDENTITY CHECK HAD NEVER RUN. THAT IS NOT TRUE OF THIS WAVE AND THE SENTENCE IS NOT CARRIED OVER.");
    expect(census.note).toContain("the check ran on every one of the 11,543 materialized buildings and rejected none");
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
    expect(census.shipped.requestedBuildingCount).toBe(78);
  });

  /**
   * The shipped subset refuses a HIGHER share of its buildings than the wave does
   * — 3 of 78 against 178 of 11,721 — and that is recorded rather than smoothed.
   * A canary's subset is order-derived, so it has no reason to be representative,
   * and reporting only the wave rate would let a reader assume it was.
   */
  it("does not hide that the shipped subset refuses at a higher rate than the wave", () => {
    const waveRate = census.wave.refusedBuildingCount / census.wave.requestedBuildingCount;
    const shippedRate = census.shipped.refusedBuildingCount / census.shipped.requestedBuildingCount;
    expect(census.shipped.refusedBuildingCount).toBe(3);
    expect(shippedRate).toBeGreaterThan(waveRate);
  });

  /**
   * The honest half of the census. A building whose massing collapses to one
   * effective tier ships `setbacks` absent with a stated reason rather than an
   * invented offset, and the count is large enough that hiding it would be a
   * material omission — here it is very nearly half the wave.
   */
  it("discloses absent setbacks as a first-class count", () => {
    expect(census.wave.tierCollapseAbsentSetbackCount).toBeGreaterThan(0);
    expect(census.wave.tierCollapseAbsentSetbackCount).toBeLessThanOrEqual(census.wave.materializedBuildingCount);
    expect(census.wave.tierCollapseAbsentSetbackCount).toBe(5_374);
    // Stated as a share, because "5,374" alone reads as a footnote and "46.6% of
    // the materialized buildings ship no setback" does not.
    expect(census.wave.tierCollapseAbsentSetbackCount / census.wave.materializedBuildingCount).toBeGreaterThan(0.45);
  });
});
