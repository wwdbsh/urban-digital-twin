/**
 * The bar's arithmetic, pinned before anything is measured against it.
 *
 * These cases are synthetic on purpose. The point of committing them ahead of
 * the capture is that the pass rule is fixed and readable now — so when the
 * numbers arrive, the only question left is what they are, never what counts as
 * passing.
 */
import { describe, expect, it } from "vitest";

import {
  EXTERIOR_SERVING_FRAME_BAR,
  exteriorServingFrameVerdict,
  framePercentile,
  type ExteriorServingFrameSample,
} from "./exterior-serving-frame-bar.ts";

function sample(poseId: string, ms: number, options: { spike?: number; residentAssetCount?: number; decodedTextureCount?: number; count?: number } = {}): ExteriorServingFrameSample {
  const count = options.count ?? EXTERIOR_SERVING_FRAME_BAR.minimumFrameSamples;
  const frameMs = Array.from({ length: count }, (_value, index) => (index >= count - Math.ceil(count * 0.10) ? options.spike ?? ms : ms));
  return { poseId, frameMs, residentAssetCount: options.residentAssetCount ?? 40, decodedTextureCount: options.decodedTextureCount ?? 4 };
}

describe("framePercentile", () => {
  it("is nearest-rank, with no interpolation", () => {
    expect(framePercentile([1, 2, 3, 4], 50)).toBe(2);
    expect(framePercentile([1, 2, 3, 4], 95)).toBe(4);
    expect(framePercentile([], 50)).toBeNaN();
  });
});

describe("the pre-registered frame bar", () => {
  it("passes a serving arm inside the tolerance", () => {
    const verdict = exteriorServingFrameVerdict({
      promotedDefault: [sample("street", 8)],
      servingWave: [sample("street", 9)],
    });
    expect(verdict.pass).toBe(true);
    expect(verdict.measurablePoseCount).toBe(1);
    expect(verdict.poses[0]!.admittedP95Ms).toBe(EXTERIOR_SERVING_FRAME_BAR.p95AbsoluteToleranceMs);
  });

  it("admits the larger of the relative and the absolute tolerance", () => {
    // 40 ms baseline: 20% is 8 ms, which is the larger, so +6 ms passes.
    const relative = exteriorServingFrameVerdict({ promotedDefault: [sample("overview", 40)], servingWave: [sample("overview", 46)] });
    expect(relative.poses[0]!.admittedP95Ms).toBeCloseTo(8, 6);
    expect(relative.pass).toBe(true);
    // …and +9 ms does not.
    expect(exteriorServingFrameVerdict({ promotedDefault: [sample("overview", 40)], servingWave: [sample("overview", 49)] }).pass).toBe(false);
  });

  it("fails a p95 regression the p50 hides", () => {
    const verdict = exteriorServingFrameVerdict({
      promotedDefault: [sample("street", 8, { spike: 9 })],
      servingWave: [sample("street", 8, { spike: 40 })],
    });
    expect(verdict.poses[0]!.p50Pass).toBe(true);
    expect(verdict.poses[0]!.p95Pass).toBe(false);
    expect(verdict.pass).toBe(false);
  });

  it("refuses a pose where the serving arm rendered nothing", () => {
    const verdict = exteriorServingFrameVerdict({
      promotedDefault: [sample("far", 8)],
      servingWave: [sample("far", 2, { residentAssetCount: 0 })],
    });
    expect(verdict.poses[0]!.measurable).toBe(false);
    expect(verdict.poses[0]!.unmeasurableReason).toContain("rendered no asset");
    expect(verdict.pass).toBe(false);
  });

  it("refuses an under-sampled pose rather than judging it", () => {
    const verdict = exteriorServingFrameVerdict({
      promotedDefault: [sample("street", 8, { count: 10 })],
      servingWave: [sample("street", 8, { count: 10 })],
    });
    expect(verdict.poses[0]!.measurable).toBe(false);
    expect(verdict.pass).toBe(false);
  });

  it("reports resident-asset equality without making it a pass condition", () => {
    const verdict = exteriorServingFrameVerdict({
      promotedDefault: [sample("street", 8, { residentAssetCount: 40 })],
      servingWave: [sample("street", 9, { residentAssetCount: 512 })],
    });
    expect(verdict.poses[0]!.residentAssetsEqual).toBe(false);
    expect(verdict.likeForLikePoseCount).toBe(0);
    expect(verdict.pass).toBe(true);
  });

  it("bounds decoded textures at the declared class catalogue", () => {
    const verdict = exteriorServingFrameVerdict({
      promotedDefault: [sample("street", 8)],
      servingWave: [sample("street", 8, { decodedTextureCount: 5 })],
    });
    expect(verdict.poses[0]!.decodedTexturePass).toBe(false);
    expect(verdict.pass).toBe(false);
  });

  it("is never a pass with no measurable pose", () => {
    expect(exteriorServingFrameVerdict({ promotedDefault: [], servingWave: [] }).pass).toBe(false);
    expect(exteriorServingFrameVerdict({ promotedDefault: [], servingWave: [sample("street", 8)] }).pass).toBe(false);
  });
});
