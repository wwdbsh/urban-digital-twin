/**
 * T009 Block 835 canary validation harness: the pure, testable half.
 *
 * This module is a **sibling** of the Stage 3 probe in `src/app/App.tsx`, not a
 * revision of it. `block835PerformanceGate` encodes the Stage 3 public-realm
 * contract — an overlay-versus-control comparison with its own 12 ms / 30 ms /
 * +20 % thresholds — and the Stage 3 probe deliberately refuses to certify a
 * scene that also streams exterior cells. Neither is touched here. The canary
 * scene is a different scene and gets its own condition axis and its own
 * evaluator, which measures the Goal's **absolute** frame-time budgets instead
 * of a relative regression.
 *
 * Everything in here is a plain function over plain data so the arithmetic that
 * produces an acceptance verdict is unit-testable without a browser.
 */
import facadePathFixture from "../../data/block835-canary-validation-20260811/facade-path.json";
import obliqueFacadePathFixture from "../../data/block835-canary-validation-20260811/facade-path-oblique.json";

export const BLOCK835_CANARY_PROBE_QUERY = "block835CanaryPerformance";
export const BLOCK835_CANARY_PROBE_MODES = ["exploration", "inspection"] as const;
export type Block835CanaryProbeMode = (typeof BLOCK835_CANARY_PROBE_MODES)[number];

/**
 * Absolute Goal budgets (GOAL.md:191-193). Exploration targets 60 FPS,
 * exterior inspection targets 30 FPS, both measured after one second of camera
 * settling at each pose.
 */
export const BLOCK835_CANARY_FRAME_BUDGETS = {
  exploration: { medianMs: 16.7, p95Ms: 25 },
  inspection: { medianMs: 33.3, p95Ms: 45 },
} as const satisfies Record<Block835CanaryProbeMode, { medianMs: number; p95Ms: number }>;

export const BLOCK835_CANARY_SETTLE_MS = 1_000;
export const BLOCK835_CANARY_SAMPLES_PER_POSE = 60;
export const BLOCK835_CANARY_REPEATS = 4;

/** Goal runtime ceilings (GOAL.md:229-230). */
export const BLOCK835_CANARY_MAX_ACTIVE_REQUESTS = 8;
export const BLOCK835_CANARY_MAX_CACHED_BYTES = 256 * 1024 * 1024;

/**
 * Retained-heap noise band. A JS heap reading without a forced collection is a
 * sawtooth, so a verdict of "monotonic growth" is only claimed when the
 * second-half median exceeds the first-half median by more than this fraction.
 */
export const BLOCK835_CANARY_HEAP_NOISE_BAND = 0.1;

export interface Block835CanaryFacadePose {
  poseId: string;
  buildingId: string;
  facade: string;
  framing: string;
  cameraToFacadeMeters: number;
  cameraToBuildingCentreMeters: number;
  tier0HalfExtentMeters: number;
  buildingHeightMeters: number;
  rooflineInFrame: boolean;
  referenceVerticalExtentMeters: number;
  pose: { longitude: number; latitude: number; height: number; heading: number; pitch: number; roll: number };
  anchor: { longitude: number; latitude: number; source: Record<string, unknown> };
  plan: { file: string; planHashSha256: string; fileSha256: string; tier0BoundsMm: Record<string, number>; heightMm: number };
}

export interface Block835CanaryFacadePath {
  schemaVersion: string;
  pathId: string;
  generator: string;
  minimumCameraToFacadeMeters: number;
  closestCameraToFacadeMeters: number;
  framingReference: { note: string; aspect: string; verticalHalfAngleDegrees: number };
  poses: Block835CanaryFacadePose[];
}

/** Derived from committed release bytes by `scripts/block835-canary-facade-path-cli.mjs`. */
export const BLOCK835_CANARY_FACADE_PATH = facadePathFixture as Block835CanaryFacadePath;

/**
 * Mitigation path. See the note carried in the fixture: the level path is the
 * criterion path, but the citywide base does not serve the camera's own shard
 * at a level attitude, so nothing renders there. This variant keeps the
 * identical perpendicular camera-to-facade distance and exists purely so
 * frame-time, memory and request evidence can be measured against a scene that
 * actually contains the canary geometry.
 */
export const BLOCK835_CANARY_FACADE_PATH_OBLIQUE = obliqueFacadePathFixture as Block835CanaryFacadePath;

export const BLOCK835_CANARY_PATH_VARIANTS = ["level", "oblique"] as const;
export type Block835CanaryPathVariant = (typeof BLOCK835_CANARY_PATH_VARIANTS)[number];

export function parseBlock835CanaryPathVariant(search: string): Block835CanaryPathVariant {
  const value = new URLSearchParams(search).get("block835CanaryPath");
  return value === "oblique" ? "oblique" : "level";
}

export function block835CanaryFacadePath(variant: Block835CanaryPathVariant): Block835CanaryFacadePath {
  return variant === "oblique" ? BLOCK835_CANARY_FACADE_PATH_OBLIQUE : BLOCK835_CANARY_FACADE_PATH;
}

export function parseBlock835CanaryProbeMode(search: string): Block835CanaryProbeMode | null {
  const value = new URLSearchParams(search).get(BLOCK835_CANARY_PROBE_QUERY);
  return (BLOCK835_CANARY_PROBE_MODES as readonly string[]).includes(value ?? "") ? value as Block835CanaryProbeMode : null;
}

export interface Block835CanaryFrameSummary {
  sampleCount: number;
  medianMs: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

export function summarizeCanaryFrames(samples: readonly number[]): Block835CanaryFrameSummary {
  const sorted = samples.filter((value) => Number.isFinite(value) && value > 0).sort((left, right) => left - right);
  if (!sorted.length) return { sampleCount: 0, medianMs: null, p95Ms: null, maxMs: null };
  const middle = Math.floor(sorted.length / 2);
  const medianMs = sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle] ?? null;
  return {
    sampleCount: sorted.length,
    medianMs,
    p95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? null,
    maxMs: sorted.at(-1) ?? null,
  };
}

export interface Block835CanaryDisplayEstimate {
  intervalMs: number | null;
  refreshHz: number | null;
  droppedFrameRatio: number | null;
  quantizationCaveat: string;
}

/**
 * requestAnimationFrame cannot report an interval shorter than the display
 * refresh, so the floor of the observed distribution is the display interval.
 * The 5th percentile is used rather than the minimum so one anomalous short
 * callback cannot set the floor.
 *
 * This matters for honesty: on a 60 Hz display a *perfect* renderer produces a
 * ~16.67 ms median, which sits on top of the 16.7 ms exploration budget. A
 * passing exploration median therefore proves "no frame was dropped at 60 Hz",
 * not "the renderer had headroom". The dropped-frame ratio is the discriminating
 * measurement and must be read alongside the median.
 */
export function estimateCanaryDisplay(samples: readonly number[]): Block835CanaryDisplayEstimate {
  const sorted = samples.filter((value) => Number.isFinite(value) && value > 0).sort((left, right) => left - right);
  const caveat = "requestAnimationFrame is quantized to the display refresh, so a median at the refresh interval means zero dropped frames rather than measured headroom. Read the median together with droppedFrameRatio.";
  if (sorted.length < 20) return { intervalMs: null, refreshHz: null, droppedFrameRatio: null, quantizationCaveat: caveat };
  const intervalMs = sorted[Math.max(0, Math.ceil(sorted.length * 0.05) - 1)] ?? null;
  if (intervalMs === null || intervalMs <= 0) return { intervalMs: null, refreshHz: null, droppedFrameRatio: null, quantizationCaveat: caveat };
  const dropped = sorted.filter((value) => value > intervalMs * 1.5).length;
  return {
    intervalMs,
    refreshHz: Math.round(1000 / intervalMs),
    droppedFrameRatio: dropped / sorted.length,
    quantizationCaveat: caveat,
  };
}

export interface Block835CanaryBudgetVerdict {
  profile: Block835CanaryProbeMode;
  medianBudgetMs: number;
  p95BudgetMs: number;
  medianPass: boolean;
  p95Pass: boolean;
  pass: boolean;
  reason: string | null;
}

/**
 * Absolute budget evaluation. A missing measurement is a failure, never a pass:
 * an unproven budget is an explicit failure row in the evidence record.
 */
export function block835CanaryBudgetVerdict(
  profile: Block835CanaryProbeMode,
  summary: Pick<Block835CanaryFrameSummary, "medianMs" | "p95Ms">,
): Block835CanaryBudgetVerdict {
  const budget = BLOCK835_CANARY_FRAME_BUDGETS[profile];
  const medianPass = summary.medianMs !== null && summary.medianMs <= budget.medianMs;
  const p95Pass = summary.p95Ms !== null && summary.p95Ms <= budget.p95Ms;
  const missing = summary.medianMs === null || summary.p95Ms === null;
  return {
    profile,
    medianBudgetMs: budget.medianMs,
    p95BudgetMs: budget.p95Ms,
    medianPass,
    p95Pass,
    pass: medianPass && p95Pass,
    reason: missing
      ? "No settled frame samples were retained, so neither budget is proven."
      : medianPass && p95Pass
        ? null
        : `Measured median ${summary.medianMs?.toFixed(2)} ms / p95 ${summary.p95Ms?.toFixed(2)} ms against ${budget.medianMs} ms / ${budget.p95Ms} ms.`,
  };
}

export interface Block835CanaryHeapVerdict {
  available: boolean;
  sampleCount: number;
  firstHalfMedianBytes: number | null;
  secondHalfMedianBytes: number | null;
  growthBytes: number | null;
  growthRatio: number | null;
  noiseBandRatio: number;
  monotonicGrowthDetected: boolean | null;
  boundedClaim: string;
}

function median(values: readonly number[]): number | null {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : sorted[middle] ?? null;
}

/**
 * First-half versus second-half medians over the repeated paths.
 *
 * The claim this can support is deliberately narrow: `performance.memory`
 * reports the JS heap only, there is no way to force a collection from page
 * script, and native GPU/texture retention is invisible here. A verdict of
 * "no monotonic growth" therefore means "JS heap did not grow beyond the noise
 * band across repeats", not "nothing was retained".
 */
export function block835CanaryHeapVerdict(
  heapBytesPerRepeat: readonly (number | null)[],
  noiseBandRatio = BLOCK835_CANARY_HEAP_NOISE_BAND,
): Block835CanaryHeapVerdict {
  const boundedClaim = "JS heap only, sampled via performance.memory with no forced collection. Native GPU and decoded-texture retention are not observable here.";
  const values = heapBytesPerRepeat.filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  if (values.length < 2) {
    return {
      available: false,
      sampleCount: values.length,
      firstHalfMedianBytes: null,
      secondHalfMedianBytes: null,
      growthBytes: null,
      growthRatio: null,
      noiseBandRatio,
      monotonicGrowthDetected: null,
      boundedClaim,
    };
  }
  const half = Math.floor(values.length / 2);
  const firstHalfMedianBytes = median(values.slice(0, half));
  const secondHalfMedianBytes = median(values.slice(values.length - half));
  const growthBytes = firstHalfMedianBytes !== null && secondHalfMedianBytes !== null ? secondHalfMedianBytes - firstHalfMedianBytes : null;
  const growthRatio = growthBytes !== null && firstHalfMedianBytes ? growthBytes / firstHalfMedianBytes : null;
  return {
    available: true,
    sampleCount: values.length,
    firstHalfMedianBytes,
    secondHalfMedianBytes,
    growthBytes,
    growthRatio,
    noiseBandRatio,
    monotonicGrowthDetected: growthRatio === null ? null : growthRatio > noiseBandRatio,
    boundedClaim,
  };
}

export interface Block835CanaryRuntimeVerdict {
  peakConcurrentRequests: number | null;
  maxActiveRequests: number;
  concurrencyPass: boolean;
  peakCachedBytes: number | null;
  maxCachedBytes: number;
  cachePass: boolean;
  measurementNote: string;
}

/**
 * Concurrency is a **measured** peak from `AggregateRequestBudget.peakConcurrency()`
 * and the exterior runtime's own peak, never the configured `maxConcurrentRequests`
 * constant: a configured ceiling is a declaration, not evidence.
 */
export function block835CanaryRuntimeVerdict(
  peakConcurrentRequests: number | null,
  peakCachedBytes: number | null,
): Block835CanaryRuntimeVerdict {
  return {
    peakConcurrentRequests,
    maxActiveRequests: BLOCK835_CANARY_MAX_ACTIVE_REQUESTS,
    concurrencyPass: peakConcurrentRequests !== null && peakConcurrentRequests <= BLOCK835_CANARY_MAX_ACTIVE_REQUESTS,
    peakCachedBytes,
    maxCachedBytes: BLOCK835_CANARY_MAX_CACHED_BYTES,
    cachePass: peakCachedBytes !== null && peakCachedBytes <= BLOCK835_CANARY_MAX_CACHED_BYTES,
    measurementNote: "peakConcurrentRequests is the observed peak of the shared aggregate request budget and the exterior runtime, not the configured maxConcurrentRequests ceiling.",
  };
}

export interface Block835CanaryRepeatSample {
  repeatIndex: number;
  summary: Block835CanaryFrameSummary;
  cacheEntries: number | null;
  cachedBytes: number | null;
  cacheEvictions: number | null;
  peakConcurrentRequests: number | null;
  jsHeapBytes: number | null;
}

export interface Block835CanaryProbeResult {
  schemaVersion: "1.0";
  status: "waiting-for-prerequisites" | "waiting-for-focus" | "running" | "invalid" | "complete";
  profile: Block835CanaryProbeMode;
  pathId: string;
  exteriorReleaseId: string | null;
  exteriorSnapshotId: string | null;
  baseReleaseId: string | null;
  capturedAt: string | null;
  repeats: number;
  settleMs: number;
  samplesPerPose: number;
  poseCount: number;
  closestCameraToFacadeMeters: number;
  perRepeat: Block835CanaryRepeatSample[];
  aggregate: Block835CanaryFrameSummary;
  display: Block835CanaryDisplayEstimate;
  budget: Block835CanaryBudgetVerdict;
  heap: Block835CanaryHeapVerdict;
  runtime: Block835CanaryRuntimeVerdict;
  disclosures: {
    buildMode: "development" | "production";
    viewportCss: { width: number; height: number };
    devicePixelRatio: number;
    documentHasFocus: { before: boolean; after: boolean };
    visibilityState: { before: string; after: string };
    userAgent: string;
    consoleErrors: readonly string[];
    windowErrors: readonly string[];
    networkHosts: readonly string[];
  };
  reason: string | null;
}
