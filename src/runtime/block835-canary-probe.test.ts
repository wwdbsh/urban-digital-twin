import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  BLOCK835_CANARY_FACADE_PATH,
  BLOCK835_CANARY_FACADE_PATH_OBLIQUE,
  BLOCK835_CANARY_FRAME_BUDGETS,
  BLOCK835_CANARY_MAX_ACTIVE_REQUESTS,
  BLOCK835_CANARY_MAX_CACHED_BYTES,
  block835CanaryBudgetVerdict,
  block835CanaryFacadePath,
  block835CanaryHeapVerdict,
  block835CanaryRuntimeVerdict,
  estimateCanaryDisplay,
  parseBlock835CanaryPathVariant,
  parseBlock835CanaryProbeMode,
  summarizeCanaryFrames,
} from "./block835-canary-probe.ts";

const PLAN_DIR = "data/manhattan-esb-block-reference-20260811/plans";

const readUtf8 = (path: string): string => new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));

describe("block835 canary probe mode", () => {
  it("accepts only the two declared canary conditions", () => {
    expect(parseBlock835CanaryProbeMode("?block835CanaryPerformance=exploration")).toBe("exploration");
    expect(parseBlock835CanaryProbeMode("?block835CanaryPerformance=inspection")).toBe("inspection");
    expect(parseBlock835CanaryProbeMode("?block835CanaryPerformance=stage3-only")).toBeNull();
    expect(parseBlock835CanaryProbeMode("?block835Performance=stage3-only")).toBeNull();
    expect(parseBlock835CanaryProbeMode("")).toBeNull();
  });
});

describe("absolute frame budget evaluator", () => {
  it("encodes the Goal budgets rather than the Stage 3 regression contract", () => {
    expect(BLOCK835_CANARY_FRAME_BUDGETS.exploration).toEqual({ medianMs: 16.7, p95Ms: 25 });
    expect(BLOCK835_CANARY_FRAME_BUDGETS.inspection).toEqual({ medianMs: 33.3, p95Ms: 45 });
  });

  it("passes only when both absolute thresholds are met", () => {
    expect(block835CanaryBudgetVerdict("exploration", { medianMs: 16.67, p95Ms: 20 }).pass).toBe(true);
    expect(block835CanaryBudgetVerdict("exploration", { medianMs: 16.8, p95Ms: 20 }).pass).toBe(false);
    expect(block835CanaryBudgetVerdict("exploration", { medianMs: 16.0, p95Ms: 25.1 }).pass).toBe(false);
    expect(block835CanaryBudgetVerdict("inspection", { medianMs: 33.3, p95Ms: 45 }).pass).toBe(true);
  });

  it("treats a missing measurement as a failure, never a pass", () => {
    const verdict = block835CanaryBudgetVerdict("exploration", { medianMs: null, p95Ms: null });
    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toMatch(/neither budget is proven/);
  });
});

describe("frame summary and display estimate", () => {
  it("summarises median, p95 and max over retained samples", () => {
    const summary = summarizeCanaryFrames([16.6, 16.7, 16.7, 33.4, 16.7, 16.7]);
    expect(summary.sampleCount).toBe(6);
    expect(summary.medianMs).toBeCloseTo(16.7, 5);
    expect(summary.maxMs).toBeCloseTo(33.4, 5);
  });

  it("discards non-positive and non-finite samples", () => {
    expect(summarizeCanaryFrames([0, -1, Number.NaN, Number.POSITIVE_INFINITY]).sampleCount).toBe(0);
  });

  it("recovers a 60 Hz display interval and reports the dropped-frame ratio", () => {
    const samples = [...Array<number>(95).fill(16.67), ...Array<number>(5).fill(33.4)];
    const estimate = estimateCanaryDisplay(samples);
    expect(estimate.refreshHz).toBe(60);
    expect(estimate.droppedFrameRatio).toBeCloseTo(0.05, 5);
    expect(estimate.quantizationCaveat).toMatch(/quantized/);
  });

  it("refuses a display estimate from too few samples", () => {
    expect(estimateCanaryDisplay([16.7, 16.7]).refreshHz).toBeNull();
  });
});

describe("bounded heap verdict", () => {
  it("reports no monotonic growth inside the noise band", () => {
    const verdict = block835CanaryHeapVerdict([100_000_000, 104_000_000, 103_000_000, 105_000_000]);
    expect(verdict.available).toBe(true);
    expect(verdict.monotonicGrowthDetected).toBe(false);
    expect(verdict.boundedClaim).toMatch(/JS heap only/);
  });

  it("detects growth beyond the noise band", () => {
    expect(block835CanaryHeapVerdict([100_000_000, 101_000_000, 150_000_000, 160_000_000]).monotonicGrowthDetected).toBe(true);
  });

  it("declares the measurement unavailable rather than passing when the heap API is absent", () => {
    const verdict = block835CanaryHeapVerdict([null, null, null]);
    expect(verdict.available).toBe(false);
    expect(verdict.monotonicGrowthDetected).toBeNull();
  });
});

describe("runtime ceiling verdict", () => {
  it("uses the measured peak and fails closed when nothing was measured", () => {
    const measured = block835CanaryRuntimeVerdict(4, 12 * 1024 * 1024);
    expect(measured.concurrencyPass).toBe(true);
    expect(measured.cachePass).toBe(true);
    expect(measured.maxActiveRequests).toBe(BLOCK835_CANARY_MAX_ACTIVE_REQUESTS);
    expect(measured.maxCachedBytes).toBe(BLOCK835_CANARY_MAX_CACHED_BYTES);
    expect(measured.measurementNote).toMatch(/observed peak/);
    const unmeasured = block835CanaryRuntimeVerdict(null, null);
    expect(unmeasured.concurrencyPass).toBe(false);
    expect(unmeasured.cachePass).toBe(false);
  });

  it("fails a peak above the Goal ceiling", () => {
    expect(block835CanaryRuntimeVerdict(9, 1).concurrencyPass).toBe(false);
    expect(block835CanaryRuntimeVerdict(1, BLOCK835_CANARY_MAX_CACHED_BYTES + 1).cachePass).toBe(false);
  });
});

describe("committed facade camera path", () => {
  it("carries the declared path identity and 6-8 poses", () => {
    expect(BLOCK835_CANARY_FACADE_PATH.pathId).toBe("block835-canary-facade-v1");
    expect(BLOCK835_CANARY_FACADE_PATH.poses.length).toBeGreaterThanOrEqual(6);
    expect(BLOCK835_CANARY_FACADE_PATH.poses.length).toBeLessThanOrEqual(8);
  });

  it("keeps every camera-to-facade distance at or beyond the 10 m contract floor", () => {
    for (const pose of BLOCK835_CANARY_FACADE_PATH.poses) {
      expect(pose.cameraToFacadeMeters).toBeGreaterThanOrEqual(10);
    }
    expect(BLOCK835_CANARY_FACADE_PATH.closestCameraToFacadeMeters).toBeGreaterThanOrEqual(10);
  });

  it("recomputes every facade distance and building extent from the committed plan bytes", () => {
    const plans = new Map<string, { heightMm: number; tier0: Record<string, number>; planHashSha256: string }>();
    for (const entry of readdirSync(PLAN_DIR, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const plan = JSON.parse(readUtf8(`${PLAN_DIR}/${entry.name}`)) as {
        input: { buildingId: string; geometry: { heightMm: number } };
        planHashSha256: string;
        tiers: Array<{ index: number; minX: number; maxX: number; minY: number; maxY: number }>;
      };
      const tier0 = plan.tiers.find((tier) => tier.index === 0);
      expect(tier0).toBeDefined();
      plans.set(plan.input.buildingId, {
        heightMm: plan.input.geometry.heightMm,
        tier0: { minX: tier0!.minX, maxX: tier0!.maxX, minY: tier0!.minY, maxY: tier0!.maxY },
        planHashSha256: plan.planHashSha256,
      });
    }
    for (const pose of BLOCK835_CANARY_FACADE_PATH.poses) {
      const plan = plans.get(pose.buildingId);
      expect(plan, `no committed plan for ${pose.buildingId}`).toBeDefined();
      expect(pose.plan.planHashSha256).toBe(plan!.planHashSha256);
      expect(pose.plan.heightMm).toBe(plan!.heightMm);
      expect(pose.buildingHeightMeters).toBeCloseTo(plan!.heightMm / 1000, 3);
      const halfExtentMm = (pose.facade === "east" || pose.facade === "west" ? plan!.tier0.maxX : plan!.tier0.maxY) ?? Number.NaN;
      expect(pose.tier0HalfExtentMeters).toBeCloseTo(halfExtentMm / 1000, 3);
      // The recomputable identity a reader checks: centre distance minus the
      // tier-0 half extent is the perpendicular camera-to-facade distance.
      expect(pose.cameraToBuildingCentreMeters - pose.tier0HalfExtentMeters).toBeCloseTo(pose.cameraToFacadeMeters, 2);
    }
  });

  it("points every camera back at the facade it names", () => {
    const headings: Record<string, number> = { east: 270, west: 90, north: 180, south: 0 };
    for (const pose of BLOCK835_CANARY_FACADE_PATH.poses) {
      expect(pose.pose.heading).toBe(headings[pose.facade]);
      const eastOffset = pose.facade === "east" ? 1 : pose.facade === "west" ? -1 : 0;
      const northOffset = pose.facade === "north" ? 1 : pose.facade === "south" ? -1 : 0;
      if (eastOffset !== 0) expect(Math.sign(pose.pose.longitude - pose.anchor.longitude)).toBe(eastOffset);
      if (northOffset !== 0) expect(Math.sign(pose.pose.latitude - pose.anchor.latitude)).toBe(northOffset);
    }
  });

  it("only claims a roofline is in frame when the declared framing supports it", () => {
    for (const pose of BLOCK835_CANARY_FACADE_PATH.poses) {
      if (!pose.rooflineInFrame) continue;
      expect(pose.framing).toBe("full-facade");
      expect(pose.referenceVerticalExtentMeters).toBeGreaterThanOrEqual(pose.buildingHeightMeters);
    }
  });
});

describe("oblique mitigation path", () => {
  it("selects the level path unless the oblique variant is explicitly requested", () => {
    expect(parseBlock835CanaryPathVariant("")).toBe("level");
    expect(parseBlock835CanaryPathVariant("?block835CanaryPath=level")).toBe("level");
    expect(parseBlock835CanaryPathVariant("?block835CanaryPath=oblique")).toBe("oblique");
    expect(block835CanaryFacadePath("level")).toBe(BLOCK835_CANARY_FACADE_PATH);
    expect(block835CanaryFacadePath("oblique")).toBe(BLOCK835_CANARY_FACADE_PATH_OBLIQUE);
  });

  it("preserves the perpendicular camera-to-facade distance of every level pose", () => {
    const level = BLOCK835_CANARY_FACADE_PATH.poses;
    const oblique = BLOCK835_CANARY_FACADE_PATH_OBLIQUE.poses;
    expect(oblique).toHaveLength(level.length);
    for (const [index, pose] of oblique.entries()) {
      expect(pose.cameraToFacadeMeters).toBe(level[index]!.cameraToFacadeMeters);
      expect(pose.cameraToFacadeMeters).toBeGreaterThanOrEqual(10);
      expect(pose.pose.longitude).toBe(level[index]!.pose.longitude);
      expect(pose.pose.latitude).toBe(level[index]!.pose.latitude);
      expect(pose.pose.heading).toBe(level[index]!.pose.heading);
    }
  });

  it("looks down steeply enough for the base to serve the camera's own shard, and claims no roofline", () => {
    for (const pose of BLOCK835_CANARY_FACADE_PATH_OBLIQUE.poses) {
      expect(pose.pose.pitch).toBe(-30);
      expect(pose.pose.pitch).toBeLessThanOrEqual(-28);
      expect(pose.rooflineInFrame).toBe(false);
    }
  });

  it("carries the mitigation disclosure so no reader can mistake it for the criterion path", () => {
    const fixture = BLOCK835_CANARY_FACADE_PATH_OBLIQUE as unknown as { mitigationNote: string; variantOf: string };
    expect(fixture.variantOf).toBe("block835-canary-facade-v1");
    expect(fixture.mitigationNote).toMatch(/does not satisfy the level facade viewpoint criterion/);
  });
});
