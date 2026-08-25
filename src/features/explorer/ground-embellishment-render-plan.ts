/**
 * What the near-tier curb canary draws, decided without a renderer (T010).
 *
 * The sibling of `./ground-render-plan.ts`, and deliberately shaped like it:
 * draw height, colour, pick identity and refusal all decided here where a test
 * can read them, with the CesiumJS effect left holding nothing but the call to
 * Cesium.
 *
 * ## The extrusion is a WALL, and that is a fidelity decision
 *
 * The release ships a curb as the source pavement-edge ALIGNMENT plus a
 * declared profile of `{ roadbedElevationMeters: 0, topElevationMeters: 0.22 }`
 * and nothing else. It declares no curb WIDTH, because no source in that
 * pipeline measured one; its own derivation note says a renderer "extrudes the
 * declared profile from this alignment".
 *
 * A `CorridorGeometry` would have to be given a width — 0.15 m, 0.3 m, some
 * number — and that number would be an invented fact rendered at full opacity
 * next to source-backed geometry, which is exactly what this project's
 * invariants forbid. `WallGeometry` extrudes the two quantities the release
 * actually declares and no third one: a vertical ribbon from the roadbed
 * elevation to the top elevation, along the alignment verbatim.
 *
 * It is also, by a wide margin, the cheaper primitive: a wall is 2 triangles
 * per segment, while a corridor is a top cap plus two side walls plus corner
 * geometry — roughly 8 triangles per segment before mitring. Across the canary
 * wave's 379,672 segments that is the difference between ~0.76 M and ~3 M
 * triangles. The honest choice and the economical one are the same choice here,
 * which is a good sign about the choice.
 *
 * ## Identity is not re-invented
 *
 * A curb part carries the same `ground:<canonicalFeatureId>` pick id the flat
 * surfaces carry, minted by the SAME `groundPickId` function. That is what
 * makes "the pick identity does not change when the near tier activates"
 * true by construction rather than by test: there is only one identity scheme
 * on the ground, and a curb is a ground feature.
 */

import type { GroundEmbellishmentClass } from "../../domain/ground";
import type { GroundEmbellishmentCellArtifact } from "../../runtime/ground-embellishment-runtime";
import { GROUND_CLASS_HEIGHT_METERS, groundPickId, type GroundRenderRefusal } from "./ground-render-plan";

/**
 * The elevation the curb's roadbed datum is drawn at.
 *
 * The release's `roadbedElevationMeters: 0` is relative to the roadbed, not to
 * the ellipsoid, and this application draws the cartographic roadbed at
 * `GROUND_CLASS_HEIGHT_METERS.roadbed`. Aliasing rather than restating means a
 * change to the flat z-fighting offsets carries the curb with it instead of
 * leaving it floating or buried.
 */
export const GROUND_EMBELLISHMENT_BASE_HEIGHT_METERS = GROUND_CLASS_HEIGHT_METERS.roadbed;

/**
 * Per-class fill for the near tier.
 *
 * One step lighter than the sidewalk it abuts (`#3d4952`), inside the same
 * desaturated family, and opaque for the same reason the flat classes are: a
 * curb should read as a change in the surface, not as highlighted data.
 */
export const GROUND_EMBELLISHMENT_COLORS: Record<GroundEmbellishmentClass, string> = {
  curb: "#4a5761",
  crosswalk: "#55636d",
};

export interface GroundEmbellishmentRenderWall {
  pickId: string;
  canonicalFeatureId: string;
  partId: string;
  /** Longitude, latitude pairs flattened for `Cartesian3.fromDegreesArray`. */
  positions: number[];
  /** Line segments in this wall; two triangles each. Reported, never estimated. */
  segments: number;
}

export interface GroundEmbellishmentCellRenderPlan {
  cellId: string;
  groundClass: GroundEmbellishmentClass;
  /** Ellipsoid height of the wall's base and top, in metres. */
  baseHeightMeters: number;
  topHeightMeters: number;
  cssColor: string;
  /** True when the release labels its own profile an estimate, which it always must. */
  profileIsEstimated: boolean;
  walls: GroundEmbellishmentRenderWall[];
  refusals: GroundRenderRefusal[];
  drawnFeatureIds: string[];
  /** Sum over `walls`; the triangle count is twice this. */
  segments: number;
}

/**
 * Drops positions repeated back-to-back.
 *
 * The release rounds every coordinate to 7 decimal degrees, which is about
 * 1 cm, and a clipped alignment can legitimately round two distinct source
 * vertices onto one position. A wall built across a zero-length segment
 * produces a degenerate quad whose normal is undefined, so the duplicate is
 * dropped rather than drawn. Nothing is moved and nothing is added: this only
 * ever removes a position identical to the one before it.
 */
function distinctPositions(line: readonly (readonly number[])[]): number[] {
  const positions: number[] = [];
  let previousLongitude = Number.NaN;
  let previousLatitude = Number.NaN;
  for (const position of line) {
    const longitude = position[0]!;
    const latitude = position[1]!;
    if (longitude === previousLongitude && latitude === previousLatitude) continue;
    positions.push(longitude, latitude);
    previousLongitude = longitude;
    previousLatitude = latitude;
  }
  return positions;
}

/**
 * Turns one verified per-cell embellishment artifact into drawable walls.
 *
 * Refusal is per PART, exactly as in the flat plan and for the same reason: a
 * part is one canonical curb's share of one cell, and drawing half of a share
 * while dropping the rest would put an unexplained gap in a curb the details
 * panel still describes as whole. The heights come off the ARTIFACT's declared
 * profile, so a release that ships a different rise draws a different curb with
 * no code change.
 */
export function planGroundEmbellishmentCellRender(artifact: GroundEmbellishmentCellArtifact): GroundEmbellishmentCellRenderPlan {
  const groundClass = artifact.class;
  const profile = artifact.derivation.profile;
  const walls: GroundEmbellishmentRenderWall[] = [];
  const refusals: GroundRenderRefusal[] = [];
  const drawn = new Set<string>();
  let segments = 0;
  for (const part of artifact.parts) {
    const pickId = groundPickId(part.canonicalFeatureId);
    const drawable = part.geometry.coordinates
      .map((line) => distinctPositions(line))
      .filter((positions) => positions.length >= 4);
    if (drawable.length === 0) {
      refusals.push({
        partId: part.partId,
        canonicalFeatureId: part.canonicalFeatureId,
        groundClass,
        reason: "degenerate-alignment",
        selfTouchingRings: 0,
        statement: `Not drawn in cell ${artifact.cellId}: every line of this ${groundClass} share collapses to a single position at the release's 7-decimal precision, so there is no alignment to extrude the estimated ${profile.topElevationMeters} m profile along. The alignment remains verbatim in the release; it is refused here rather than redrawn as a shape the source never had.`,
      });
      continue;
    }
    for (const positions of drawable) {
      const lineSegments = positions.length / 2 - 1;
      walls.push({ pickId, canonicalFeatureId: part.canonicalFeatureId, partId: part.partId, positions, segments: lineSegments });
      segments += lineSegments;
      drawn.add(part.canonicalFeatureId);
    }
  }
  return {
    cellId: artifact.cellId,
    groundClass,
    baseHeightMeters: GROUND_EMBELLISHMENT_BASE_HEIGHT_METERS + profile.roadbedElevationMeters,
    topHeightMeters: GROUND_EMBELLISHMENT_BASE_HEIGHT_METERS + profile.topElevationMeters,
    cssColor: GROUND_EMBELLISHMENT_COLORS[groundClass],
    profileIsEstimated: profile.profileIsEstimated,
    walls,
    refusals,
    drawnFeatureIds: [...drawn].sort(),
    segments,
  };
}

export interface GroundEmbellishmentRenderSummary {
  /** Cells the near tier is currently serving. */
  activeCells: number;
  /** Cells inside the canary wave that the camera is close enough to serve. */
  eligibleCells: number;
  drawnSegments: number;
  skippedParts: number;
  failedCells: number;
  residentBytes: number;
  /** The tier ceiling the release declared, echoed so the UI never asserts one. */
  nearTierMaxDistanceMeters: number | null;
}

/**
 * The segment the ground status line grows when the near tier is serving.
 *
 * Appended to the flat ground's own line rather than replacing it: the base is
 * still the base, and an embellishment that overwrote the base's reading would
 * make a curb failure look like a ground failure. Counts, never adjectives, and
 * nothing at all when no cell is active.
 */
export function groundEmbellishmentStatusSegment(summary: GroundEmbellishmentRenderSummary | null): string {
  if (!summary || (summary.activeCells === 0 && summary.failedCells === 0)) return "";
  const failed = summary.failedCells > 0
    ? ` · ${summary.failedCells} curb cell${summary.failedCells === 1 ? "" : "s"} refused (verification failed)`
    : "";
  const skipped = summary.skippedParts > 0
    ? ` · ${summary.skippedParts} curb part${summary.skippedParts === 1 ? "" : "s"} skipped: degenerate alignment`
    : "";
  if (summary.activeCells === 0) return `${failed}${skipped}`;
  const ring = summary.nearTierMaxDistanceMeters === null ? "" : ` within ${summary.nearTierMaxDistanceMeters} m`;
  return ` · near-tier curbs${ring}: ${summary.activeCells} cell${summary.activeCells === 1 ? "" : "s"} / ${summary.drawnSegments} segments${skipped}${failed}`;
}
