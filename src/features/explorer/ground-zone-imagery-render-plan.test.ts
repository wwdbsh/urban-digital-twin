import { describe, expect, it } from "vitest";
import {
  ZONE_IMAGERY_DRAPE_STATEMENT,
  ZONE_IMAGERY_MISREGISTRATION_STATEMENT,
  groundZoneImageryStatusSegment,
  zoneImageryAttributionLine,
  zoneImageryPolygonTextureCoordinates,
  zoneImageryRingTextureCoordinates,
} from "./ground-zone-imagery-render-plan";
import type { GroundRenderPolygon } from "./ground-render-plan";

const BOUNDS = { west: -74, south: 40.5, east: -73.9, north: 40.6 };

describe("zone imagery texture coordinates", () => {
  // The mapping is over the CELL rectangle. A zone occupying the north-east
  // quarter of its cell must sample the north-east quarter of the texture — if
  // the mapping used the polygon's own bbox this would read 0,0 to 1,1 and the
  // whole photograph would be squeezed into the quarter.
  it("maps a corner-anchored ring to that corner of the cell texture", () => {
    const st = zoneImageryRingTextureCoordinates([-73.95, 40.55, -73.9, 40.55, -73.9, 40.6], BOUNDS);
    // Compared to 10 decimal places, not exactly: the mapping is a division of
    // degree doubles and asserting bit equality would be asserting the IEEE
    // result rather than the geographic one.
    for (const [index, expected] of [0.5, 0.5, 1, 0.5, 1, 1].entries()) expect(st[index]).toBeCloseTo(expected, 10);
  });

  it("puts the cell's south-west corner at the texture origin", () => {
    expect(zoneImageryRingTextureCoordinates([-74, 40.5], BOUNDS)).toEqual([0, 0]);
    expect(zoneImageryRingTextureCoordinates([-73.9, 40.6], BOUNDS)).toEqual([1, 1]);
  });

  // A clipped ring's vertex can land a rounding step outside its own cell.
  // Sampling past the edge would wrap or mirror a strip from the far side.
  it("clamps a vertex that rounds outside its own cell rather than wrapping", () => {
    expect(zoneImageryRingTextureCoordinates([-74.000001, 40.499999, -73.899999, 40.600001], BOUNDS)).toEqual([0, 0, 1, 1]);
  });

  it("mirrors the position hierarchy, holes included", () => {
    const polygon: GroundRenderPolygon = {
      pickId: "ground:udt:manhattan:park:M010",
      canonicalFeatureId: "udt:manhattan:park:M010",
      partId: "part-1",
      outer: { positions: [-74, 40.5, -73.9, 40.5, -73.9, 40.6] },
      holes: [{ positions: [-73.95, 40.55, -73.94, 40.55, -73.94, 40.56] }],
    };
    const st = zoneImageryPolygonTextureCoordinates(polygon, BOUNDS);
    expect(st.outer).toHaveLength(polygon.outer.positions.length);
    expect(st.holes).toHaveLength(1);
    expect(st.holes[0]).toHaveLength(polygon.holes[0]!.positions.length);
    expect(st.holes[0]![0]).toBeCloseTo(0.5, 10);
  });

  it("refuses a degenerate cell rectangle rather than dividing by zero", () => {
    expect(() => zoneImageryRingTextureCoordinates([-74, 40.5], { ...BOUNDS, east: -74 })).toThrow(/positive cell rectangle/i);
  });
});

describe("zone imagery status and attribution", () => {
  const summary = { drapedZones: 6, drapedCells: 4, undrapedZones: 3, failedZones: 0, textureBytes: 4_200_000, captureYear: 2024, releaseId: "manhattan-ground-zone-imagery-20260826" };

  it("names the vintage in the status line whenever a drape is on screen", () => {
    const segment = groundZoneImageryStatusSegment(summary);
    expect(segment).toContain("imagery 2024");
    expect(segment).toContain("6 zones draped across 4 cells");
    expect(segment).toContain("3 zones in view drawn flat (no texture shipped)");
  });

  it("says nothing at all when nothing is draped and nothing failed", () => {
    expect(groundZoneImageryStatusSegment(null)).toBe("");
    expect(groundZoneImageryStatusSegment({ ...summary, drapedZones: 0, undrapedZones: 9 })).toBe("");
  });

  it("reports a refused texture even when no drape survived", () => {
    expect(groundZoneImageryStatusSegment({ ...summary, drapedZones: 0, failedZones: 2 })).toContain("2 zone textures refused");
  });

  it("carries vintage, capture window, both agencies and the licence in one sentence", () => {
    const line = zoneImageryAttributionLine({
      attribution: "Source: NYC Office of Technology and Innovation (OTI) / NYS Statewide Digital Orthoimagery Program, 2024 6-inch true orthoimagery, Manhattan borough. Licensed CC BY 4.0.",
      captureYear: 2024,
      sourceEpoch: "2024-03-14/2024-03-24",
    });
    expect(line).toContain("Orthoimagery 2024");
    expect(line).toContain("2024-03-14/2024-03-24");
    expect(line).toContain("NYC Office of Technology and Innovation");
    expect(line).toContain("NYS Statewide Digital Orthoimagery Program");
    expect(line).toContain("CC BY 4.0");
  });

  it("keeps the registration and drape claims as reviewed constants", () => {
    expect(ZONE_IMAGERY_MISREGISTRATION_STATEMENT).toContain("roughly one pixel");
    expect(ZONE_IMAGERY_DRAPE_STATEMENT).toContain("The polygon is the mask");
    expect(ZONE_IMAGERY_DRAPE_STATEMENT).toContain("not a survey");
  });
});
