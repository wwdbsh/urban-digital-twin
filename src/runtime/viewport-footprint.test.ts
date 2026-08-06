import { describe, expect, it } from "vitest";
import {
  fallbackViewportFootprint,
  normalizeViewportRefreshRequest,
  viewportBoundsCrossesAntimeridian,
  viewportBoundsFromGroundPoints,
  viewportBoundsIntersect,
  viewportFootprintFromGroundPoints,
} from "./viewport-footprint";

describe("viewport footprint", () => {
  it("uses oblique ground samples instead of the camera-air position", () => {
    const footprint = viewportFootprintFromGroundPoints([
      [-73.992, 40.746], [-73.981, 40.746], [-73.982, 40.752], [-73.994, 40.752],
    ]);
    expect(footprint).toMatchObject({ valid: true, source: "ground-rays" });
    expect(footprint?.groundCenter.longitude).toBeCloseTo(-73.9875, 6);
    expect(footprint?.groundCenter.latitude).toBeCloseTo(40.749, 6);
    expect(footprint?.bounds.west).toBeCloseTo(-73.994, 6);
    expect(footprint?.bounds.east).toBeCloseTo(-73.981, 6);
    expect(footprint?.bounds.south).toBeCloseTo(40.746, 6);
    expect(footprint?.bounds.north).toBeCloseTo(40.752, 6);
  });

  it("widens naturally when zooming out samples reach a larger ground extent", () => {
    const near = viewportFootprintFromGroundPoints([[-73.991, 40.747], [-73.985, 40.75]])!;
    const far = viewportFootprintFromGroundPoints([[-74.02, 40.72], [-73.94, 40.79]])!;
    expect(far.bounds.east - far.bounds.west).toBeGreaterThan(near.bounds.east - near.bounds.west);
    expect(far.signature).not.toBe(near.signature);
  });

  it("keeps a usable footprint when only some corner rays reach the globe", () => {
    const footprint = viewportFootprintFromGroundPoints([[Number.NaN, 0], [-73.99, 40.74], [-73.98, 40.75]]);
    expect(footprint?.valid).toBe(true);
    expect(footprint?.bounds.west).toBeCloseTo(-73.99, 6);
    expect(footprint?.bounds.east).toBeCloseTo(-73.98, 6);
    expect(footprint?.bounds.south).toBeCloseTo(40.74, 6);
    expect(footprint?.bounds.north).toBeCloseTo(40.75, 6);
  });

  it("retains the last valid ground footprint when every current ray misses", () => {
    const valid = viewportFootprintFromGroundPoints([[-73.99, 40.74], [-73.98, 40.75]])!;
    const retained = viewportFootprintFromGroundPoints([], { lastValid: valid });
    expect(retained).toMatchObject({ valid: false, source: "last-valid", bounds: valid.bounds, signature: valid.signature });
  });

  it("uses wrapped bounds across the antimeridian without treating the world as a small middle interval", () => {
    const bounds = viewportBoundsFromGroundPoints([[179.8, 10], [-179.7, 11], [179.9, 12]])!;
    expect(viewportBoundsCrossesAntimeridian(bounds)).toBe(true);
    expect(viewportBoundsIntersect(bounds, { west: 179.7, east: 180, south: 9, north: 13 })).toBe(true);
    expect(viewportBoundsIntersect(bounds, { west: -180, east: -179.6, south: 9, north: 13 })).toBe(true);
    expect(viewportBoundsIntersect(bounds, { west: -10, east: 10, south: 9, north: 13 })).toBe(false);
  });

  it("keeps refresh signatures stable and accepts legacy camera-only runtime callers", () => {
    const first = viewportFootprintFromGroundPoints([[-73.99, 40.74], [-73.98, 40.75]])!;
    const second = viewportFootprintFromGroundPoints([[-73.99, 40.74], [-73.98, 40.75]])!;
    expect(second.signature).toBe(first.signature);
    const legacy = normalizeViewportRefreshRequest({ longitude: -73.99, latitude: 40.744, height: 700, heading: 0, pitch: -35, roll: 0 });
    expect(legacy.footprint).toEqual(fallbackViewportFootprint(legacy.camera));
  });
});
