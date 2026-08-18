import { describe, expect, it } from "vitest";
import {
  farTierCellDistanceMeters, farTierCellInRange,
  FAR_TIER_ENTER_METERS, FAR_TIER_EXIT_BAND_METERS, FAR_TIER_EXIT_METERS, FAR_TIER_SELECTION_METRIC,
} from "./far-tier-selection";
import { FAR_TIER_NEAR_EDGE_METERS } from "../release/far-tier-budget";
import { farTierTileAnchor, FarTierAnchorError } from "./far-tier-anchor";

const PROTOTYPE_CELL = "manhattan-exterior-cell-w05-000747-17-38610-35822";
const BOUNDS = farTierTileAnchor(PROTOTYPE_CELL).bounds;
/** A point inside the rectangle, so horizontal distance is zero. */
const INSIDE = { longitude: (BOUNDS.west + BOUNDS.east) / 2, latitude: (BOUNDS.south + BOUNDS.north) / 2 };

describe("the thresholds", () => {
  it("enters at the tier's own pre-registered near edge, not a new number", () => {
    expect(FAR_TIER_ENTER_METERS).toBe(FAR_TIER_NEAR_EDGE_METERS);
    expect(FAR_TIER_ENTER_METERS).toBe(1_200);
  });

  it("exits one band inside the edge", () => {
    expect(FAR_TIER_EXIT_BAND_METERS).toBe(120);
    expect(FAR_TIER_EXIT_METERS).toBe(1_080);
    // The band must be a band, or there is no hysteresis at all.
    expect(FAR_TIER_EXIT_METERS).toBeLessThan(FAR_TIER_ENTER_METERS);
  });

  it("names the metric rather than leaving it to be inferred", () => {
    expect(FAR_TIER_SELECTION_METRIC).toContain("nearest-point-of-tile-rectangle");
    expect(FAR_TIER_SELECTION_METRIC).toContain("ground footprint only");
  });
});

describe("farTierCellDistanceMeters", () => {
  it("is the camera height when the camera is directly over the cell", () => {
    // Clamping puts the horizontal term at zero, so the distance is the height.
    expect(farTierCellDistanceMeters({ ...INSIDE, heightMeters: 800 }, BOUNDS)).toBeCloseTo(800, 6);
  });

  it("measures to the NEAREST edge, not to the centre", () => {
    // A camera just west of the rectangle at zero height is a short hop from the
    // west edge, but a long way from the centre. Centre-based selection would
    // over-report the distance and draw a tile that is right in front of you.
    const westOfIt = { longitude: BOUNDS.west - 0.001, latitude: INSIDE.latitude, heightMeters: 0 };
    const toNearest = farTierCellDistanceMeters(westOfIt, BOUNDS);
    const halfWidthMeters = ((BOUNDS.east - BOUNDS.west) / 2) * 84_412.702;
    expect(toNearest).toBeLessThan(halfWidthMeters);
    expect(toNearest).toBeCloseTo(0.001 * 84_412.702, 3);
  });

  it("grows with horizontal offset and with height alike", () => {
    const flat = farTierCellDistanceMeters({ ...INSIDE, longitude: BOUNDS.west - 0.01, heightMeters: 0 }, BOUNDS);
    const raised = farTierCellDistanceMeters({ ...INSIDE, longitude: BOUNDS.west - 0.01, heightMeters: 500 }, BOUNDS);
    expect(raised).toBeGreaterThan(flat);
  });
});

describe("farTierCellInRange", () => {
  it("draws a cell that is beyond the near edge", () => {
    expect(farTierCellInRange(1_400, false)).toBe(true);
    expect(farTierCellInRange(FAR_TIER_ENTER_METERS, false)).toBe(true);
  });

  it("refuses to draw a cell nearer than the near edge", () => {
    // THE NO-GO CONDITION: nothing is drawn at under 1,200 m by default.
    expect(farTierCellInRange(1_199, false)).toBe(false);
    expect(farTierCellInRange(400, false)).toBe(false);
    expect(farTierCellInRange(0, false)).toBe(false);
  });

  it("holds a drawn cell across the band instead of flickering", () => {
    // Already drawn and drifting inward: it stays drawn down to the exit line.
    expect(farTierCellInRange(1_150, true)).toBe(true);
    expect(farTierCellInRange(FAR_TIER_EXIT_METERS, true)).toBe(true);
    // The same distances would NOT start it drawing from cold.
    expect(farTierCellInRange(1_150, false)).toBe(false);
    expect(farTierCellInRange(FAR_TIER_EXIT_METERS, false)).toBe(false);
  });

  it("drops a drawn cell once it comes inside the exit line", () => {
    expect(farTierCellInRange(FAR_TIER_EXIT_METERS - 1, true)).toBe(false);
    expect(farTierCellInRange(0, true)).toBe(false);
  });

  it("is stable under a camera jittering across the edge", () => {
    // The property the band exists for: crossing 1,200 m repeatedly must not
    // toggle the tile on every sample.
    let drawn = false;
    const states: boolean[] = [];
    for (const distance of [1_205, 1_195, 1_205, 1_190, 1_210, 1_185]) {
      drawn = farTierCellInRange(distance, drawn);
      states.push(drawn);
    }
    expect(states).toEqual([true, true, true, true, true, true]);
  });
});

describe("interplay with the Block 835 refusal", () => {
  it("never gets a chance to select a cell that cannot be anchored", () => {
    // Selection measures against a tile rectangle. Block 835 has none, so the
    // anchor refuses first and the cell never reaches this predicate — which is
    // why there is no "distance to a cell with no rectangle" case to answer.
    expect(() => farTierTileAnchor("manhattan-exterior-cell-w00-000000-block-00835")).toThrow(FarTierAnchorError);
    expect(() => farTierTileAnchor("cell:manhattan:block-835")).toThrow(FarTierAnchorError);
  });

  it("selects an anchorable cell from the same ledger normally", () => {
    const anchor = farTierTileAnchor(PROTOTYPE_CELL);
    const distance = farTierCellDistanceMeters({ longitude: anchor.bounds.west, latitude: anchor.bounds.south, heightMeters: 1_400 }, anchor.bounds);
    expect(farTierCellInRange(distance, false)).toBe(true);
  });
});
