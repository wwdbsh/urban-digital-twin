/**
 * Regression pins for T009 finding F2: a level or near-level camera rendered
 * none of the Block 835 exterior geometry.
 *
 * Both halves are pinned here, and both fail against the pre-fix code:
 *
 *  (a) the nine-ray ground footprint stretched to the horizon at shallow pitch,
 *      so the shard set was unbounded and its centre sat far downrange;
 *  (b) shard selection ranked by distance from that displaced centre and then
 *      truncated to the shard budget, dropping the shard the camera stands on —
 *      which costs the base building records, the verified WGS84 anchors, and
 *      therefore every exterior cell that depends on them.
 *
 * Scope note: this covers one camera sample and the selection order for it.
 * Cross-cell cache pressure and cell-bounds culling stay where ADR 0024 put
 * them, forward to T013+.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_CAMERA_POSE, type CameraPose } from "../domain/visitor-navigation.ts";
import { retainCameraShards, shardContainsPoint } from "./citywide-release-runtime.ts";
import {
  HORIZON_STRETCH_PITCH_DEGREES,
  boundFootprintToCamera,
  fallbackViewportFootprint,
  isHorizonStretchedAttitude,
  viewportFootprintFromGroundPoints,
  type ViewportFootprint,
} from "./viewport-footprint.ts";

/** Block 835, the cell the canary ships. */
const BLOCK_835 = { longitude: -73.98675, latitude: 40.7488 };

const LEVEL_14_TILE_DEGREES = 360 / 2 ** 14;

function cameraAt(pitch: number, height: number): CameraPose {
  return { ...BLOCK_835, height, heading: 0, pitch, roll: 0 };
}

/**
 * Approximates what the nine globe pick-rays return at a given pitch: a steep
 * camera lands every ray in a tight patch near its own sub-point, while a
 * shallow one sends the upper rays kilometres downrange toward the horizon.
 */
function groundPointsForPitch(camera: CameraPose): Array<readonly [number, number]> {
  const nearMeters = camera.height / Math.tan((Math.abs(camera.pitch) * Math.PI) / 180);
  const horizonFactor = Math.abs(camera.pitch) >= 30 ? 3 : 900 / Math.max(1, Math.abs(camera.pitch));
  const farMeters = nearMeters * horizonFactor;
  const metersPerDegreeLatitude = 111_132;
  const metersPerDegreeLongitude = 84_400;
  const points: Array<readonly [number, number]> = [];
  for (const forward of [nearMeters, (nearMeters + farMeters) / 2, farMeters]) {
    for (const lateral of [-forward / 2, 0, forward / 2]) {
      points.push([
        camera.longitude + lateral / metersPerDegreeLongitude,
        camera.latitude + forward / metersPerDegreeLatitude,
      ]);
    }
  }
  return points;
}

function footprintForPitch(camera: CameraPose): ViewportFootprint {
  const sampled = viewportFootprintFromGroundPoints(groundPointsForPitch(camera));
  expect(sampled).not.toBeNull();
  return sampled!;
}

function spanDegrees(footprint: ViewportFootprint): number {
  return Math.max(footprint.bounds.north - footprint.bounds.south, footprint.bounds.east - footprint.bounds.west);
}

/** A level-14 shard grid across Manhattan, the grouping the citywide release freezes. */
function manhattanShards(): Array<{ relativeContentRef: string; shardId: string; bounds: { west: number; east: number; south: number; north: number } }> {
  const shards = [];
  for (let x = 0; x < 24; x += 1) {
    for (let y = 0; y < 24; y += 1) {
      const west = -74.05 + x * LEVEL_14_TILE_DEGREES;
      const south = 40.68 + y * LEVEL_14_TILE_DEGREES;
      const id = `shard-${x}-${y}`;
      shards.push({ relativeContentRef: `geometry/buildings/${id}.json`, shardId: id, bounds: { west, east: west + LEVEL_14_TILE_DEGREES, south, north: south + LEVEL_14_TILE_DEGREES } });
    }
  }
  return shards;
}

describe("(a) shallow-pitch footprint is bounded to the camera neighbourhood", () => {
  it("stretches to the horizon before the bound is applied", () => {
    // Establishes the defect the bound exists for: the raw sample at a shallow
    // attitude is more than an order of magnitude wider than at a steep one.
    const steep = spanDegrees(footprintForPitch(cameraAt(-30, 12)));
    const shallow = spanDegrees(footprintForPitch(cameraAt(-10, 12)));
    expect(shallow).toBeGreaterThan(steep * 10);
  });

  it.each([-10, -15, -20])("bounds the footprint at pitch %i deg", (pitch) => {
    const camera = cameraAt(pitch, 12);
    const raw = footprintForPitch(camera);
    const bounded = boundFootprintToCamera(raw, camera);
    // Pre-fix this is the raw horizon span and the assertion fails.
    expect(spanDegrees(bounded)).toBeLessThan(spanDegrees(raw));
    expect(spanDegrees(bounded)).toBeLessThanOrEqual(0.05);
    // A directional view legitimately sits downrange of the camera, so the
    // bound does not force the camera inside its own footprint — that is what
    // the camera-shard reservation in (b) guarantees instead. What the bound
    // does guarantee is that no edge runs away past the camera-anchored limit.
    const limit = fallbackViewportFootprint(camera).bounds;
    expect(bounded.bounds.north).toBeLessThanOrEqual(limit.north);
    expect(bounded.bounds.south).toBeGreaterThanOrEqual(limit.south);
    expect(bounded.bounds.east).toBeLessThanOrEqual(limit.east);
    expect(bounded.bounds.west).toBeGreaterThanOrEqual(limit.west);
  });

  it("keeps the ground centre near the camera instead of far downrange", () => {
    const camera = cameraAt(-10, 12);
    const raw = footprintForPitch(camera);
    const bounded = boundFootprintToCamera(raw, camera);
    const drift = (footprint: ViewportFootprint) => Math.abs(footprint.groundCenter.latitude - camera.latitude);
    expect(drift(bounded)).toBeLessThan(drift(raw));
    expect(drift(bounded)).toBeLessThan(0.01);
  });

  it("never widens a footprint that is already inside the bound", () => {
    const camera = cameraAt(-45, 12);
    const raw = footprintForPitch(camera);
    expect(boundFootprintToCamera(raw, camera)).toBe(raw);
  });

  it("bounds the shard set a shallow-pitch camera selects", () => {
    const camera = cameraAt(-10, 12);
    const shards = manhattanShards();
    const intersects = (footprint: ViewportFootprint) => shards.filter((shard) =>
      shard.bounds.west <= footprint.bounds.east && shard.bounds.east >= footprint.bounds.west &&
      shard.bounds.south <= footprint.bounds.north && shard.bounds.north >= footprint.bounds.south).length;
    const raw = footprintForPitch(camera);
    const boundedCount = intersects(boundFootprintToCamera(raw, camera));
    expect(boundedCount).toBeLessThan(intersects(raw));
    // Comfortably inside the 24-shard budget, so nothing has to be truncated.
    expect(boundedCount).toBeLessThanOrEqual(24);
    expect(boundedCount).toBeGreaterThan(0);
  });
});

/** Corners of a symmetric near-nadir sample: the ground a top-down camera actually covers. */
function nadirFootprint(camera: CameraPose, halfLongitudeDegrees: number, halfLatitudeDegrees: number): ViewportFootprint {
  const sampled = viewportFootprintFromGroundPoints([
    [camera.longitude - halfLongitudeDegrees, camera.latitude - halfLatitudeDegrees],
    [camera.longitude + halfLongitudeDegrees, camera.latitude - halfLatitudeDegrees],
    [camera.longitude - halfLongitudeDegrees, camera.latitude + halfLatitudeDegrees],
    [camera.longitude + halfLongitudeDegrees, camera.latitude + halfLatitudeDegrees],
  ]);
  expect(sampled).not.toBeNull();
  return sampled!;
}

/**
 * (c) pins the *selectivity* of the bound, which is what keeps it from becoming
 * a general viewport clamp. `fallbackViewportFootprint`'s extent is a pure
 * function of camera height, so intersecting with it unconditionally would also
 * narrow legitimate wide near-nadir views. Every case here fails against an
 * unconditional bound and passes against the gated one.
 */
describe("(c) the bound applies only to a horizon-stretched attitude", () => {
  it("treats pitch as the discriminator, at the boundary the F2 sweep measured", () => {
    // -28 deg was the shallowest attitude measured to draw 14/14; -25 deg drew
    // 10/14 and -20 deg drew 0/14, so the gate sits between them.
    expect(HORIZON_STRETCH_PITCH_DEGREES).toBe(-28);
    expect(isHorizonStretchedAttitude(cameraAt(-25, 12))).toBe(true);
    expect(isHorizonStretchedAttitude(cameraAt(-28, 12))).toBe(false);
    expect(isHorizonStretchedAttitude(cameraAt(-30, 12))).toBe(false);
    expect(isHorizonStretchedAttitude(cameraAt(Number.NaN, 12))).toBe(false);
  });

  it("bounds or spares one and the same sample purely on pitch", () => {
    // Identical bounds, identical position and height: only the attitude
    // differs, exactly as in the measured sweep.
    const raw = footprintForPitch(cameraAt(-10, 12));
    expect(boundFootprintToCamera(raw, cameraAt(-20, 12))).not.toBe(raw);
    expect(boundFootprintToCamera(raw, cameraAt(-30, 12))).toBe(raw);
  });

  it("leaves the app's default 4 km overview untouched", () => {
    const camera = DEFAULT_CAMERA_POSE;
    expect(camera.height).toBe(4_000);
    expect(camera.pitch).toBe(-75);
    const raw = footprintForPitch(camera);
    // Proof this case is not vacuous: the camera-anchored extent is narrower
    // than the ground this overview really covers, so an unconditional
    // intersection would clip the default view on first load.
    expect(raw.bounds.north).toBeGreaterThan(fallbackViewportFootprint(camera).bounds.north);
    expect(boundFootprintToCamera(raw, camera)).toBe(raw);
  });

  it("leaves a citywide near-nadir view able to see all of Manhattan", () => {
    // ~40 km, the altitude at which the whole island is framed.
    const camera: CameraPose = { longitude: -73.97, latitude: 40.78, height: 40_000, heading: 0, pitch: -80, roll: 0 };
    const raw = nadirFootprint(camera, 0.16, 0.11);
    const limit = fallbackViewportFootprint(camera).bounds;
    // The height-derived caps (0.12 / 0.078 deg) are narrower than Manhattan's
    // ~0.18 deg latitude span, so an unconditional bound clips the northern tip.
    expect(limit.north - limit.south).toBeLessThan(0.18);
    expect(limit.north).toBeLessThan(40.88);
    const bounded = boundFootprintToCamera(raw, camera);
    expect(bounded).toBe(raw);
    expect(bounded.bounds.north).toBeGreaterThanOrEqual(40.88);
    expect(bounded.bounds.south).toBeLessThanOrEqual(40.70);
  });

  it.each([-28, -30, -45, -60, -90])("leaves an oversized sample untouched at pitch %i deg", (pitch) => {
    const camera = cameraAt(pitch, 4_000);
    const raw = nadirFootprint(camera, 0.09, 0.06);
    expect(raw.bounds.north).toBeGreaterThan(fallbackViewportFootprint(camera).bounds.north);
    expect(boundFootprintToCamera(raw, camera)).toBe(raw);
  });
});

describe("(b) the camera's own shard survives budget truncation", () => {
  it("identifies the shard containing a point, edges inclusive", () => {
    const shard = { bounds: { west: -74, east: -73.9, south: 40.7, north: 40.8 } };
    expect(shardContainsPoint(shard, -73.95, 40.75)).toBe(true);
    expect(shardContainsPoint(shard, -74, 40.7)).toBe(true);
    expect(shardContainsPoint(shard, -73.8, 40.75)).toBe(false);
    expect(shardContainsPoint(shard, -73.95, 40.9)).toBe(false);
  });

  it("retains the camera shard when the ranking would truncate it away", () => {
    const shards = manhattanShards();
    const cameraShard = shards.find((shard) => shardContainsPoint(shard, BLOCK_835.longitude, BLOCK_835.latitude));
    expect(cameraShard).toBeDefined();
    // Reproduce the defect's ordering: rank the camera's shard last, exactly as
    // a ground centre displaced toward the horizon does.
    const ranked = [...shards.filter((shard) => shard !== cameraShard), cameraShard!];
    const limit = 24;
    expect(ranked.length).toBeGreaterThan(limit);
    // Pre-fix behaviour, kept explicit so the regression is visible.
    expect(ranked.slice(0, limit)).not.toContain(cameraShard);

    const bounded = retainCameraShards(ranked, BLOCK_835, limit);
    expect(bounded).toHaveLength(limit);
    expect(bounded).toContain(cameraShard);
    expect(bounded[0]).toBe(cameraShard);
  });

  it("saturates the budget without losing the camera shard or its anchors", () => {
    const shards = manhattanShards();
    const cameraShard = shards.find((shard) => shardContainsPoint(shard, BLOCK_835.longitude, BLOCK_835.latitude))!;
    const limit = 24;
    const bounded = retainCameraShards([...shards.filter((shard) => shard !== cameraShard), cameraShard], BLOCK_835, limit);
    expect(bounded).toHaveLength(limit);
    // Every Block 835 building anchors on a base record from this shard, so
    // retaining it is exactly what keeps the exterior cells anchorable.
    const anchorsAvailable = bounded.some((shard) => shardContainsPoint(shard, BLOCK_835.longitude, BLOCK_835.latitude));
    expect(anchorsAvailable).toBe(true);
    expect(new Set(bounded.map((shard) => shard.relativeContentRef)).size).toBe(limit);
  });

  it("preserves the distance ranking for everything except the reserved shard", () => {
    const shards = manhattanShards();
    const cameraShard = shards.find((shard) => shardContainsPoint(shard, BLOCK_835.longitude, BLOCK_835.latitude))!;
    const ranked = [...shards.filter((shard) => shard !== cameraShard), cameraShard];
    const bounded = retainCameraShards(ranked, BLOCK_835, 24);
    expect(bounded.slice(1)).toEqual(ranked.slice(0, 23));
  });

  it("does not disturb a selection that already fits the budget", () => {
    const shards = manhattanShards().slice(0, 10);
    expect(retainCameraShards(shards, BLOCK_835, 24)).toEqual(shards);
  });

  it("falls back to the plain ranking when the camera is outside every shard", () => {
    const shards = manhattanShards();
    const bounded = retainCameraShards(shards, { longitude: 2.35, latitude: 48.85 }, 24);
    expect(bounded).toEqual(shards.slice(0, 24));
  });
});
