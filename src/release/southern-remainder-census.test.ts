import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { V3T_QUALITY_BUDGETS } from "./block835-v3-package.ts";
import { SOUTHERN_REMAINDER_BUILDING_COUNT, SOUTHERN_REMAINDER_RELEASE_ID } from "./southern-remainder-package.ts";

/**
 * The committed wave census, checked for internal consistency.
 *
 * `payload-inventory.json` is checked elsewhere and describes the SHIPPED
 * subset. This file is the statement about all 9,603 owned buildings, and it is
 * the only place the wave's refusal distribution survives once the untracked
 * work root is gone. Nothing re-derives it — it would take a full census to do
 * so — but a census that does not add up is checkable without re-running
 * anything, and an arithmetic error in it would otherwise be permanent.
 *
 * Never skipped: the record is committed, so an absent payload directory is no
 * excuse, and a pipeline change that moved the distribution has to move this
 * file to stay green.
 */
const RECORD_ROOT = "data/southern-remainder-20260812";

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
    refusalsByCode: Record<string, number>;
    styleClassCounts: Record<string, number>;
  };
  waveRefusals: Record<string, number>;
  shipped: { requestedBuildingCount: number; materializedBuildingCount: number; refusedBuildingCount: number };
}

function readText(path: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(readFileSync(path)));
}

const census = JSON.parse(readText(`${RECORD_ROOT}/wave-census.json`)) as WaveCensusRecord;

/** The one stop code the writer raises and the plan stage cannot. */
const WRITER_STAGE_STOP_CODE = "volume-identity-failed";

describe("southern-remainder committed wave census", () => {
  it("describes the release this module names", () => {
    expect(census.releaseId).toBe(SOUTHERN_REMAINDER_RELEASE_ID);
    expect(census.wave.requestedBuildingCount).toBe(SOUTHERN_REMAINDER_BUILDING_COUNT);
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

  /**
   * The two distributions are DIFFERENT SIZES on purpose, and this pins the
   * exact shape of the difference.
   *
   * `waveRefusals` is the plan stage: the grammar reading a sourced polygon.
   * `wave.refusalsByCode` is the asset stage: the same plans, plus the writer's
   * mesh-versus-analytic volume identity check, which can only fail AFTER a plan
   * has been accepted and geometry generated. So the asset distribution is a
   * superset, and the difference is exactly the writer-stage code. A run in
   * which the two totals matched would mean the identity check never ran.
   */
  it("carries a plan-stage distribution that is the asset-stage one minus the writer's own check", () => {
    for (const [code, count] of Object.entries(census.waveRefusals)) {
      expect(census.wave.refusalsByCode[code]).toBe(count);
    }
    expect(census.waveRefusals[WRITER_STAGE_STOP_CODE]).toBeUndefined();
    expect(census.wave.refusalsByCode[WRITER_STAGE_STOP_CODE]).toBeGreaterThan(0);

    const planTotal = Object.values(census.waveRefusals).reduce((total, count) => total + count, 0);
    const assetTotal = census.wave.refusedBuildingCount;
    expect(assetTotal - planTotal).toBe(census.wave.refusalsByCode[WRITER_STAGE_STOP_CODE]);

    // The codes differ by exactly that one key, in both directions.
    const planCodes = new Set(Object.keys(census.waveRefusals));
    const assetCodes = new Set(Object.keys(census.wave.refusalsByCode));
    expect([...assetCodes].filter((code) => !planCodes.has(code))).toEqual([WRITER_STAGE_STOP_CODE]);
    expect([...planCodes].filter((code) => !assetCodes.has(code))).toEqual([]);
  });

  /**
   * The note has to explain the split, because a reader who finds two refusal
   * totals in one file and no explanation will reasonably conclude one of them
   * is wrong.
   */
  it("explains the plan/writer stage split in its own note", () => {
    expect(census.note).toContain("TWO REFUSAL DISTRIBUTIONS ARE RECORDED AND THEY ARE DELIBERATELY DIFFERENT SIZES");
    expect(census.note).toContain("`waveRefusals` is the PLAN stage");
    expect(census.note).toContain("`wave.refusalsByCode` is the ASSET stage");
    expect(census.note).toContain(`the difference is exactly the \`${WRITER_STAGE_STOP_CODE}\` entries`);
    expect(census.note).toContain("Neither number is the other's correction");
  });

  /**
   * `shippedAssetCount: 0` beside a non-zero `shippedAssetBytes` is a retention
   * mode, not a contradiction, and the note has to say so before the numbers
   * are read.
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
  });

  /**
   * The honest half of the census. A building whose massing collapses to one
   * effective tier ships `setbacks` absent with a stated reason rather than an
   * invented offset, and the count is large enough that hiding it would be a
   * material omission.
   */
  it("discloses absent setbacks as a first-class count", () => {
    expect(census.wave.tierCollapseAbsentSetbackCount).toBeGreaterThan(0);
    expect(census.wave.tierCollapseAbsentSetbackCount).toBeLessThanOrEqual(census.wave.materializedBuildingCount);
  });
});
