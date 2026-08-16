/**
 * The frame-time bar for the full-city serving composition, WRITTEN BEFORE THE
 * MEASUREMENT.
 *
 * This module exists in its own commit, ahead of any capture, because a
 * threshold chosen after seeing the numbers is not a threshold — it is a
 * description. The capture CLI imports `exteriorServingFrameVerdict` and reports
 * whatever it returns; it does not re-implement the arithmetic and it does not
 * get to choose the constants.
 *
 * ## What is being compared
 *
 * Two arms, in one scratch browser, at identical camera poses:
 *
 *  - **A, the promoted default.** Six curated waves, 498 shipped assets across
 *    13 content-bearing cells of 883, at the caps this build ships today.
 *  - **B, one serving wave.** `w02` at full population — 6,382 buildings across
 *    126 content cells — loaded through an explicit `?exteriorCells=` opt-in,
 *    at the caps ADR 0052 §3 sizes for a dense composition.
 *
 * ## What the bar is, and what it deliberately is not
 *
 * It is a NON-REGRESSION bar. Serving a wave in full puts roughly 160 times as
 * many buildings inside the release and, under a residency cap of 8 dense cells,
 * a few hundred inside the frustum where the promoted composition had a handful.
 * The claim under test is not "B is as fast as A at equal geometry" — B renders
 * far more geometry, and a frame-time equality would be surprising rather than
 * reassuring. The claim is that the SERVING SHAPE does not cost frames beyond a
 * stated tolerance: the per-cell assembly fetch, the sidecar fetch, the larger
 * cache and the denser residency must not show up as a frame-time cliff.
 *
 * The tolerance is therefore absolute-or-relative, whichever is more generous,
 * because at a 4 ms baseline a 20% relative bound is 0.8 ms and would fail on
 * scheduler jitter alone, while at a 40 ms baseline an absolute 4 ms bound would
 * be indistinguishable from noise.
 *
 * ## Resident-asset equality is a REPORTED FACT, not a pass condition
 *
 * A pose where the two arms have different resident asset counts is still a
 * legitimate reading — it is what the two compositions actually do at that
 * camera — but it is not a like-for-like frame-time comparison, and the verdict
 * says which poses are which rather than averaging them together. A pose where
 * ARM B RENDERS NOTHING is not a frame-time result at all and is refused as a
 * measurement, because an empty scene is fast for the wrong reason.
 *
 * ## The decoded-texture bound
 *
 * Under shared-URI delivery a release declares four class tiles and every GLB
 * references them by relative URI. If decoding scaled with population — one
 * decode per building rather than one per class — the serving composition would
 * pay 6,382 PNG decodes where the curated one paid four, and that would be a
 * defect the frame numbers might not show. So the count is bounded directly.
 */

export const EXTERIOR_SERVING_FRAME_BAR = {
  /** Frames sampled per arm per pose after the settle. Below this, no verdict. */
  minimumFrameSamples: 120,
  /** p95 tolerance: the larger of these two is the admitted regression. */
  p95RelativeTolerance: 0.20,
  p95AbsoluteToleranceMs: 4.0,
  /** p50 tolerance, same rule, tighter absolute floor. */
  p50RelativeTolerance: 0.20,
  p50AbsoluteToleranceMs: 2.0,
  /**
   * One decode per declared class tile, and no more. Four is the whole
   * `procedural-texture-v1` catalogue.
   */
  maximumDecodedTextures: 4,
} as const;

export interface ExteriorServingFrameSample {
  poseId: string;
  /** Frame durations in milliseconds, in capture order. */
  frameMs: readonly number[];
  residentAssetCount: number;
  decodedTextureCount: number;
}

export interface ExteriorServingFrameArms {
  promotedDefault: readonly ExteriorServingFrameSample[];
  servingWave: readonly ExteriorServingFrameSample[];
}

export interface ExteriorServingFramePoseVerdict {
  poseId: string;
  sampleCountA: number;
  sampleCountB: number;
  p50A: number;
  p50B: number;
  p95A: number;
  p95B: number;
  residentAssetCountA: number;
  residentAssetCountB: number;
  residentAssetsEqual: boolean;
  decodedTextureCountA: number;
  decodedTextureCountB: number;
  admittedP50Ms: number;
  admittedP95Ms: number;
  /** Whether this pose is a measurement at all. */
  measurable: boolean;
  unmeasurableReason: string | null;
  p50Pass: boolean;
  p95Pass: boolean;
  decodedTexturePass: boolean;
  pass: boolean;
}

export interface ExteriorServingFrameVerdict {
  bar: typeof EXTERIOR_SERVING_FRAME_BAR;
  poses: readonly ExteriorServingFramePoseVerdict[];
  measurablePoseCount: number;
  likeForLikePoseCount: number;
  pass: boolean;
  /** Stated in the record so a reader never has to reconstruct it. */
  statement: string;
}

/** Nearest-rank percentile over a copy; no interpolation, no smoothing. */
export function framePercentile(values: readonly number[], percentile: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1));
  return sorted[rank]!;
}

export function exteriorServingFrameVerdict(arms: ExteriorServingFrameArms): ExteriorServingFrameVerdict {
  const byPoseA = new Map(arms.promotedDefault.map((sample) => [sample.poseId, sample]));
  const poses: ExteriorServingFramePoseVerdict[] = [];
  for (const sampleB of arms.servingWave) {
    const sampleA = byPoseA.get(sampleB.poseId);
    const frameMsA = sampleA?.frameMs ?? [];
    const p50A = framePercentile(frameMsA, 50);
    const p95A = framePercentile(frameMsA, 95);
    const p50B = framePercentile(sampleB.frameMs, 50);
    const p95B = framePercentile(sampleB.frameMs, 95);
    const admittedP50Ms = Math.max(p50A * EXTERIOR_SERVING_FRAME_BAR.p50RelativeTolerance, EXTERIOR_SERVING_FRAME_BAR.p50AbsoluteToleranceMs);
    const admittedP95Ms = Math.max(p95A * EXTERIOR_SERVING_FRAME_BAR.p95RelativeTolerance, EXTERIOR_SERVING_FRAME_BAR.p95AbsoluteToleranceMs);
    let unmeasurableReason: string | null = null;
    if (!sampleA) unmeasurableReason = "the promoted default arm recorded no sample at this pose";
    else if (frameMsA.length < EXTERIOR_SERVING_FRAME_BAR.minimumFrameSamples || sampleB.frameMs.length < EXTERIOR_SERVING_FRAME_BAR.minimumFrameSamples) {
      unmeasurableReason = `fewer than ${EXTERIOR_SERVING_FRAME_BAR.minimumFrameSamples} frames were sampled in one of the arms`;
    } else if (sampleB.residentAssetCount === 0) {
      unmeasurableReason = "the serving arm rendered no asset at this pose, so its frame time is not a reading about serving";
    }
    const measurable = unmeasurableReason === null;
    const p50Pass = measurable && p50B - p50A <= admittedP50Ms;
    const p95Pass = measurable && p95B - p95A <= admittedP95Ms;
    const decodedTexturePass = sampleB.decodedTextureCount <= EXTERIOR_SERVING_FRAME_BAR.maximumDecodedTextures
      && (sampleA?.decodedTextureCount ?? 0) <= EXTERIOR_SERVING_FRAME_BAR.maximumDecodedTextures;
    poses.push({
      poseId: sampleB.poseId,
      sampleCountA: frameMsA.length,
      sampleCountB: sampleB.frameMs.length,
      p50A, p50B, p95A, p95B,
      residentAssetCountA: sampleA?.residentAssetCount ?? 0,
      residentAssetCountB: sampleB.residentAssetCount,
      residentAssetsEqual: (sampleA?.residentAssetCount ?? -1) === sampleB.residentAssetCount,
      decodedTextureCountA: sampleA?.decodedTextureCount ?? 0,
      decodedTextureCountB: sampleB.decodedTextureCount,
      admittedP50Ms,
      admittedP95Ms,
      measurable,
      unmeasurableReason,
      p50Pass,
      p95Pass,
      decodedTexturePass,
      pass: measurable && p50Pass && p95Pass && decodedTexturePass,
    });
  }
  const measurablePoses = poses.filter((pose) => pose.measurable);
  return {
    bar: EXTERIOR_SERVING_FRAME_BAR,
    poses,
    measurablePoseCount: measurablePoses.length,
    likeForLikePoseCount: poses.filter((pose) => pose.residentAssetsEqual).length,
    // A capture with no measurable pose is a failed capture, never a pass.
    pass: measurablePoses.length > 0 && measurablePoses.every((pose) => pose.pass),
    statement: "A NON-REGRESSION bar, not an equality. The serving arm renders far more geometry than the promoted default at the same camera, so equal frame times would be surprising rather than reassuring; what is under test is that the serving SHAPE — per-cell assembly fetch, per-cell evidence sidecar, larger cache, denser residency — costs no more than the stated tolerance. Resident asset counts are reported per arm and per pose; poses where they differ are still readings, but they are not like-for-like comparisons and the record says which is which. A pose where the serving arm renders nothing is refused as a measurement, because an empty scene is fast for the wrong reason.",
  };
}
