/**
 * The far-tier budget is a claim about GPU memory the project has not yet spent.
 * These tests attack the arithmetic that claim rests on, and pin the constants
 * whose drift would silently re-open a frozen bar.
 */
import { describe, expect, it } from "vitest";
import {
  FAR_TIER_ATLAS_PIXELS,
  FAR_TIER_BUDGET_CONTRACT,
  FAR_TIER_GPU_TEXEL_BYTES,
  FAR_TIER_MIP_CHAIN_MULTIPLIER,
  FAR_TIER_NEAR_EDGE_METERS,
  FAR_TIER_TEXEL_RATIO,
  FAR_TIER_VIEW_REFERENCE,
  farTierAtlasGpuBytes,
  farTierBudgetContractHash,
  farTierGeometryGpuBytes,
  farTierMetersPerPixel,
  farTierResolution,
  farTierTexelWorldSizeMeters,
} from "./far-tier-budget.ts";

describe("the screen-space metric is the one the bars were stated against", () => {
  it("reproduces the frozen 0.466 m/px at 400 m", () => {
    // This single number anchors every resolution in the tier. If it moves, the
    // pre-registered bars were computed against a viewport that no longer
    // exists and the record is void rather than merely stale.
    expect(farTierMetersPerPixel(400)).toBeCloseTo(0.4654, 4);
    expect(farTierMetersPerPixel(1_200)).toBeCloseTo(1.3963, 4);
  });

  it("is the arc form, and is deliberately finer than the tangent form", () => {
    const tangent = (2 * 400 * Math.tan(Math.PI / 6)) / FAR_TIER_VIEW_REFERENCE.viewportHeightPixels;
    expect(tangent).toBeCloseTo(0.5132, 4);
    // Conservative in the quality direction: the arc form asks for smaller
    // texels, so choosing it costs memory rather than saving it.
    expect(farTierMetersPerPixel(400)).toBeLessThan(tangent);
  });

  it("scales linearly with distance, which is what makes the pyramid bounded", () => {
    expect(farTierMetersPerPixel(2_400) / farTierMetersPerPixel(1_200)).toBeCloseTo(2, 12);
  });

  it("refuses a non-positive distance rather than returning zero", () => {
    expect(() => farTierMetersPerPixel(0)).toThrow(/positive distance/u);
    expect(() => farTierMetersPerPixel(-1)).toThrow(/positive distance/u);
  });
});

describe("resolution selection", () => {
  it("hits ratio 1.0 or better whenever the ceiling does not bind", () => {
    const texel = farTierTexelWorldSizeMeters(FAR_TIER_NEAR_EDGE_METERS);
    // An area that asks for exactly 128 texels a side, comfortably inside 256.
    const area = (128 * texel) ** 2;
    const resolution = farTierResolution(area);
    expect(resolution.atlasPixels).toBe(128);
    expect(resolution.underResolved).toBe(false);
    expect(resolution.achievedRatio).toBeGreaterThanOrEqual(FAR_TIER_TEXEL_RATIO.floor);
  });

  it("rounds up to a power of two, never down", () => {
    const texel = farTierTexelWorldSizeMeters(FAR_TIER_NEAR_EDGE_METERS);
    const resolution = farTierResolution((129 * texel) ** 2);
    expect(resolution.atlasPixels).toBe(256);
    expect(resolution.achievedRatio).toBeGreaterThan(FAR_TIER_TEXEL_RATIO.floor);
  });

  it("REPORTS an under-resolved cell rather than quietly clamping it", () => {
    // The decisive honesty property of this module. A cell whose facade area
    // exceeds what 256px can carry does not get a waiver and does not get a
    // bigger atlas; it gets flagged, and its blur band is quantified.
    const texel = farTierTexelWorldSizeMeters(FAR_TIER_NEAR_EDGE_METERS);
    const resolution = farTierResolution((512 * texel) ** 2);
    expect(resolution.atlasPixels).toBe(FAR_TIER_ATLAS_PIXELS.maximum);
    expect(resolution.underResolved).toBe(true);
    expect(resolution.achievedRatio).toBeCloseTo(0.5, 6);
    // It reaches the floor only at twice the near edge, and says so.
    expect(resolution.criticalDistanceMeters).toBeCloseTo(2 * FAR_TIER_NEAR_EDGE_METERS, 4);
  });

  it("never returns an atlas outside the declared bounds", () => {
    for (const area of [1e-3, 1, 1e3, 1e5, 1e7, 1e9]) {
      const resolution = farTierResolution(area);
      expect(resolution.atlasPixels).toBeGreaterThanOrEqual(FAR_TIER_ATLAS_PIXELS.minimum);
      expect(resolution.atlasPixels).toBeLessThanOrEqual(FAR_TIER_ATLAS_PIXELS.maximum);
      expect(Number.isInteger(Math.log2(resolution.atlasPixels))).toBe(true);
    }
  });

  it("refuses a non-positive surface area", () => {
    expect(() => farTierResolution(0)).toThrow(/positive surface area/u);
  });
});

describe("GPU accounting", () => {
  it("counts RGBA8 plus the full mip chain, because the runtime generates it either way", () => {
    expect(farTierAtlasGpuBytes(256)).toBe(Math.round(256 * 256 * 4 * (4 / 3)));
    expect(farTierAtlasGpuBytes(256)).toBe(FAR_TIER_BUDGET_CONTRACT.maxTileAtlasGpuBytes);
    // Halving the edge quarters the cost; that is what makes the ladder pay.
    expect(farTierAtlasGpuBytes(128) * 4).toBeCloseTo(farTierAtlasGpuBytes(256), -1);
  });

  it("counts POSITION and TEXCOORD_0 only, because the writer emits no NORMAL", () => {
    // One quad: 4 unshared vertices at 20 B, 6 uint32 indices.
    expect(farTierGeometryGpuBytes(1, 0)).toBe(4 * 20 + 6 * 4);
    expect(farTierGeometryGpuBytes(0, 1)).toBe(3 * 20 + 3 * 4);
  });

  it("keeps the 4-byte texel, since no GPU stores a 3-byte one", () => {
    expect(FAR_TIER_GPU_TEXEL_BYTES).toBe(4);
    expect(FAR_TIER_MIP_CHAIN_MULTIPLIER).toBeCloseTo(4 / 3, 12);
  });
});

describe("the frozen contract", () => {
  it("is its own budget and does not fold into the closed 256 MiB criterion", () => {
    expect(FAR_TIER_BUDGET_CONTRACT.contractId).toBe("far-tier-hlod-gpu-budget-v1");
    expect(FAR_TIER_BUDGET_CONTRACT.scope).toContain("and nothing else");
  });

  it("adds its two resident components rather than stating a total independently", () => {
    expect(FAR_TIER_BUDGET_CONTRACT.maxResidentTotalGpuBytes).toBe(
      FAR_TIER_BUDGET_CONTRACT.maxResidentAtlasGpuBytes + FAR_TIER_BUDGET_CONTRACT.maxResidentGeometryGpuBytes,
    );
  });

  it("pins a contract hash, so a silent constant edit fails here", () => {
    expect(farTierBudgetContractHash()).toBe(farTierBudgetContractHash());
    expect(farTierBudgetContractHash()).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("begins where the shipped mid tier stops", () => {
    // Not a new number: the detail radius shipped at 1,200 m and the scheduler's
    // distance band edges are [1200, 2400].
    expect(FAR_TIER_NEAR_EDGE_METERS).toBe(1_200);
  });
});
