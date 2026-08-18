/**
 * Which far-tier cells the camera is far enough away to draw.
 *
 * THE FAR TIER IS A DISTANCE TIER, and without this it is not one. Loading a
 * baked tile for every declared cell regardless of where the camera is draws
 * merged, roof-capped, texture-atlased geometry directly under the viewer's
 * nose, which is precisely what the 1,200 m near edge exists to prevent.
 */

import { FAR_TIER_NEAR_EDGE_METERS } from "../release/far-tier-budget";
import { FAR_TIER_METERS_PER_DEGREE_LATITUDE, FAR_TIER_METERS_PER_DEGREE_LONGITUDE } from "./far-tier-anchor";

/**
 * THE METRIC, stated so nobody has to infer it from the arithmetic.
 *
 * Horizontal distance from the camera's ground track to the NEAREST POINT of
 * the cell's tile rectangle — each axis clamped into the rectangle, so a camera
 * inside the rectangle scores zero — combined with the camera's height by
 * `hypot`. Distances are the frozen planar metric the bake and the census both
 * use (`rect-euclidean-frozen-scale-v1`), not geodesics.
 *
 * NEAREST POINT, NOT CENTRE, and that choice is the conservative one for the
 * question being asked. The test is "is the whole cell far enough away to be
 * drawn coarsely", so it must be answered with the distance to the closest part
 * of the cell. Centre-minus-half-diagonal was considered and rejected: it is a
 * cheaper approximation of the same bound that is loose on non-square
 * rectangles, and the clamped form is barely more arithmetic.
 *
 * WHAT IT DOES NOT MODEL: building height. The rectangle is a ground footprint,
 * so a tall building in a cell is nearer to a high camera than this distance
 * says. The exit band below absorbs that, and it is named here rather than left
 * for someone to discover.
 */
export const FAR_TIER_SELECTION_METRIC = "nearest-point-of-tile-rectangle-plus-camera-height, frozen planar scale, ground footprint only" as const;

/**
 * How far INSIDE the near edge a drawn cell must come before it is dropped.
 *
 * A single threshold makes a camera hovering at 1,200 m flip a cell between
 * baked tile and tan massing every frame it jitters across the line. The cell
 * is drawn at or beyond 1,200 m and is not dropped until it is nearer than
 * 1,080 m.
 *
 * 120 m is 10 percent of the near edge. IT IS AN ARITHMETIC CHOICE, NOT A
 * MEASURED ONE — no flicker rate was recorded and no band was compared against
 * another. It is stated that way in the record too, so a later reader does not
 * inherit it as evidence.
 */
export const FAR_TIER_EXIT_BAND_METERS = 120 as const;

/** Beyond this, a cell may be drawn. Restated from the tier's pre-registered edge. */
export const FAR_TIER_ENTER_METERS = FAR_TIER_NEAR_EDGE_METERS;
/** Nearer than this, a drawn cell is dropped back to massing. */
export const FAR_TIER_EXIT_METERS = FAR_TIER_NEAR_EDGE_METERS - FAR_TIER_EXIT_BAND_METERS;

export interface FarTierCameraPose {
  readonly longitude: number;
  readonly latitude: number;
  readonly heightMeters: number;
}

export interface FarTierRectangle {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

/** Distance from the camera to the nearest point of a cell's tile rectangle. */
export function farTierCellDistanceMeters(camera: FarTierCameraPose, bounds: FarTierRectangle): number {
  const clampedLongitude = Math.min(Math.max(camera.longitude, bounds.west), bounds.east);
  const clampedLatitude = Math.min(Math.max(camera.latitude, bounds.south), bounds.north);
  const eastMeters = (camera.longitude - clampedLongitude) * FAR_TIER_METERS_PER_DEGREE_LONGITUDE;
  const northMeters = (camera.latitude - clampedLatitude) * FAR_TIER_METERS_PER_DEGREE_LATITUDE;
  return Math.hypot(eastMeters, northMeters, camera.heightMeters);
}

/**
 * Should this cell's tile be drawn, given whether it is drawn now?
 *
 * The previous state is an argument rather than internal state so the predicate
 * stays pure and the hysteresis is visible at the call site.
 */
export function farTierCellInRange(distanceMeters: number, drawnNow: boolean): boolean {
  return drawnNow ? distanceMeters >= FAR_TIER_EXIT_METERS : distanceMeters >= FAR_TIER_ENTER_METERS;
}
