import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  EPSG_2263,
  US_SURVEY_FOOT_METERS,
  epsg2263ScaleFactor,
  epsg2263ToWgs84,
  wgs84ToEpsg2263,
} from "./ortho-projection.ts";

/**
 * The acquisition snapshot records, for all 258 tiles, BOTH the EPSG:2263 corner
 * bounds read from the shipped tile-index shapefile AND the WGS84 envelope the
 * acquisition step derived from them. That is 1032 independent control-point
 * pairs produced by a different implementation of the same published formulas,
 * which is a far stronger check than any round-trip this module can run against
 * itself.
 */
interface TileInventoryEntry {
  image: string;
  spcsFeetEpsg2263: { xmin: number; ymin: number; xmax: number; ymax: number };
  wgs84Bounds: { west: number; south: number; east: number; north: number };
}

const inventory: { tiles: TileInventoryEntry[] } = JSON.parse(
  new TextDecoder("utf-8", { fatal: true }).decode(
    readFileSync("data/raw/nyc-ortho-2024-manhattan/tile-inventory.json"),
  ),
);

/** Every tile corner as a (feet, expected-degrees) pair. */
function controlPoints(): { x: number; y: number; longitude: number; latitude: number }[] {
  return inventory.tiles.flatMap((tile) => {
    const { xmin, ymin, xmax, ymax } = tile.spcsFeetEpsg2263;
    const { west, south, east, north } = tile.wgs84Bounds;
    // Round-trip tests only need points spread across the real working area,
    // so the recorded degrees are used as representative WGS84 LOCATIONS, not
    // as ground truth for these particular corners: the recorded envelope is a
    // four-corner hull, and on a conic the westernmost corner is not the
    // southernmost. Envelope agreement is asserted separately, hull to hull.
    return [
      { x: xmin, y: ymin, longitude: west, latitude: south },
      { x: xmax, y: ymax, longitude: east, latitude: north },
    ];
  });
}

describe("EPSG:2263 defining parameters", () => {
  it("places the false easting at exactly 300000 metres", () => {
    expect(EPSG_2263.falseEastingFeet * US_SURVEY_FOOT_METERS).toBe(300000);
  });

  it("maps the projection origin to the false origin exactly", () => {
    const origin = wgs84ToEpsg2263(
      EPSG_2263.centralMeridianDegrees,
      EPSG_2263.latitudeOfOriginDegrees,
    );
    // Sub-micron in feet. Anything looser would hide a wrong cone constant.
    expect(origin.x).toBeCloseTo(EPSG_2263.falseEastingFeet, 6);
    expect(origin.y).toBeCloseTo(EPSG_2263.falseNorthingFeet, 6);
  });

  it("is true to scale on both standard parallels and contracted between them", () => {
    expect(epsg2263ScaleFactor(EPSG_2263.standardParallelSouthDegrees)).toBeCloseTo(1, 12);
    expect(epsg2263ScaleFactor(EPSG_2263.standardParallelNorthDegrees)).toBeCloseTo(1, 12);
    const between =
      (EPSG_2263.standardParallelSouthDegrees + EPSG_2263.standardParallelNorthDegrees) / 2;
    expect(epsg2263ScaleFactor(between)).toBeLessThan(1);
    // Outside the parallels the cone expands away from the sphere.
    expect(epsg2263ScaleFactor(EPSG_2263.latitudeOfOriginDegrees)).toBeGreaterThan(1);
  });
});

describe("round-trip fidelity", () => {
  it("returns every recorded tile corner to itself within a millimetre", () => {
    let worstFeet = 0;
    for (const point of controlPoints()) {
      const wgs84 = epsg2263ToWgs84(point.x, point.y);
      const back = wgs84ToEpsg2263(wgs84.longitude, wgs84.latitude);
      worstFeet = Math.max(worstFeet, Math.hypot(back.x - point.x, back.y - point.y));
    }
    // One millimetre expressed in US survey feet.
    const oneMillimetreFeet = 0.001 / US_SURVEY_FOOT_METERS;
    expect(worstFeet).toBeLessThan(oneMillimetreFeet);
  });

  it("returns WGS84 points to themselves within a millimetre", () => {
    let worstMeters = 0;
    for (const point of controlPoints()) {
      const feet = wgs84ToEpsg2263(point.longitude, point.latitude);
      const back = epsg2263ToWgs84(feet.x, feet.y);
      // Degrees -> metres, latitude-corrected, so the bar is a real distance.
      const metersPerDegreeLat = 111132;
      const metersPerDegreeLon = metersPerDegreeLat * Math.cos(point.latitude * (Math.PI / 180));
      worstMeters = Math.max(
        worstMeters,
        Math.hypot(
          (back.longitude - point.longitude) * metersPerDegreeLon,
          (back.latitude - point.latitude) * metersPerDegreeLat,
        ),
      );
    }
    expect(worstMeters).toBeLessThan(0.001);
  });
});

describe("agreement with the recorded acquisition mapping", () => {
  it("reproduces every recorded tile WGS84 envelope", () => {
    let worstMeters = 0;
    let worstImage = "";
    for (const tile of inventory.tiles) {
      const { xmin, ymin, xmax, ymax } = tile.spcsFeetEpsg2263;
      // The recorded envelope is the axis-aligned hull of all FOUR projected
      // corners, not the projection of the two extreme corners. On a conic the
      // grid is rotated by the convergence angle, so the westernmost point of a
      // tile is a different corner from the southernmost. Comparing hull to
      // hull is what makes this an external agreement check; comparing corner
      // to bound would measure the conic's rotation (~0.85 m here) instead.
      const corners = [
        epsg2263ToWgs84(xmin, ymin),
        epsg2263ToWgs84(xmax, ymin),
        epsg2263ToWgs84(xmin, ymax),
        epsg2263ToWgs84(xmax, ymax),
      ];
      const actual = {
        west: Math.min(...corners.map((corner) => corner.longitude)),
        east: Math.max(...corners.map((corner) => corner.longitude)),
        south: Math.min(...corners.map((corner) => corner.latitude)),
        north: Math.max(...corners.map((corner) => corner.latitude)),
      };
      const metersPerDegreeLat = 111132;
      const metersPerDegreeLon =
        metersPerDegreeLat * Math.cos(tile.wgs84Bounds.south * (Math.PI / 180));
      const error = Math.max(
        Math.abs(actual.west - tile.wgs84Bounds.west) * metersPerDegreeLon,
        Math.abs(actual.east - tile.wgs84Bounds.east) * metersPerDegreeLon,
        Math.abs(actual.south - tile.wgs84Bounds.south) * metersPerDegreeLat,
        Math.abs(actual.north - tile.wgs84Bounds.north) * metersPerDegreeLat,
      );
      if (error > worstMeters) {
        worstMeters = error;
        worstImage = tile.image;
      }
    }
    // Millimetre agreement with the independently produced acquisition mapping.
    expect(worstMeters, `worst tile ${worstImage}`).toBeLessThan(0.001);
  });
});
