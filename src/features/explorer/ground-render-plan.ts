/**
 * What the citywide ground canary draws, decided without a renderer (T007).
 *
 * Every decision a test can check lives here rather than inside the CesiumJS
 * effect: draw order, per-class height offsets, per-class colour, the pick
 * identity, and — the one that matters most — which parts are REFUSED.
 *
 * ## Refusal, not repair
 *
 * The clipper is documented to emit rings that touch themselves along a cell
 * boundary, and the release MEASURES them rather than repairing them
 * (`../../release/ground-geometry.ts`, `ringSimplicityCensus`). A triangulator
 * fed a self-touching ring produces a shape nobody authored, so this plan skips
 * the part and records why, using `ringIsSelfTouching` — the same predicate the
 * census counts with, imported rather than re-derived. Across the whole shipped
 * release that is 66 parts of 47,779 (roadbed 42, sidewalk 20, park 4); the
 * number the UI shows is the number for the cells actually drawn, never a
 * remembered total.
 *
 * ## Two-level identity survives the split
 *
 * A feature spanning several cells produces several parts and therefore several
 * geometry instances, and every one of them carries the SAME pick id, derived
 * from the canonical feature id alone. Picking any share of Central Park
 * selects Central Park once — the same identity philosophy as
 * `exteriorCellEntityId`, reached from the opposite direction: the exterior
 * scheme makes a per-cell entity id and maps it back to a canonical feature,
 * while ground never mints the per-cell id in the first place.
 */

import { GROUND_BASE_CLASSES, type GroundClass } from "../../domain/ground";
import { ringIsSelfTouching } from "../../release/ground-geometry";
import type { GroundCellArtifact } from "../../runtime/ground-release-runtime";

/**
 * Painter's order, bottom to top.
 *
 * Water is the datum every other surface sits on; sidewalk is last because it
 * is the surface a pedestrian stands on and it must win against the roadbed it
 * abuts.
 */
export const GROUND_CLASS_DRAW_ORDER: readonly GroundClass[] = ["water", "park", "plaza", "roadbed", "sidewalk"];

/**
 * Per-class height above the ellipsoid, in metres.
 *
 * Two centimetres apart in draw order. These are z-FIGHTING separations, not
 * elevations, and the release claims no vertical datum for this geometry: the
 * flat classes are cartographic extents, so any offset large enough to be
 * mistaken for a kerb height would be inventing a fact. The scale matches the
 * public-realm proxy offsets already in this viewport (0.05 / 0.16 / 0.32 m)
 * and stays underneath them, so enabling both overlays keeps the estimated
 * 3D curb and crosswalk visibly above the cartographic base.
 */
export const GROUND_CLASS_HEIGHT_METERS: Record<GroundClass, number> = {
  water: 0.02,
  park: 0.04,
  plaza: 0.06,
  roadbed: 0.08,
  sidewalk: 0.1,
};

/**
 * Per-class fill, harmonizing with the dark scene the grid imagery already
 * establishes (`#18252d` base, `#5b737d` graticule). Muted and desaturated on
 * purpose: this is a cartographic base under the massing, and a saturated
 * ground would read as data rather than as context. Opaque, because
 * translucent geometry costs a separate sorted pass for no informational gain.
 */
export const GROUND_CLASS_COLORS: Record<GroundClass, string> = {
  water: "#16303f",
  park: "#2c4634",
  plaza: "#4a453c",
  roadbed: "#28313a",
  sidewalk: "#3d4952",
};

export const GROUND_PICK_ID_PREFIX = "ground:" as const;

export function groundPickId(canonicalFeatureId: string): string {
  return `${GROUND_PICK_ID_PREFIX}${canonicalFeatureId}`;
}

export function parseGroundPickId(pickId: string | null | undefined): string | null {
  if (typeof pickId !== "string" || !pickId.startsWith(GROUND_PICK_ID_PREFIX)) return null;
  const canonicalFeatureId = pickId.slice(GROUND_PICK_ID_PREFIX.length);
  return canonicalFeatureId.length > 0 ? canonicalFeatureId : null;
}

export interface GroundRenderRing {
  /** Longitude, latitude pairs flattened for `Cartesian3.fromDegreesArray`. */
  positions: number[];
}

export interface GroundRenderPolygon {
  pickId: string;
  canonicalFeatureId: string;
  partId: string;
  outer: GroundRenderRing;
  holes: GroundRenderRing[];
}

export interface GroundRenderRefusal {
  partId: string;
  canonicalFeatureId: string;
  groundClass: GroundClass;
  reason: "non-simple-ring";
  selfTouchingRings: number;
  statement: string;
}

export interface GroundCellRenderPlan {
  cellId: string;
  groundClass: GroundClass;
  heightMeters: number;
  cssColor: string;
  polygons: GroundRenderPolygon[];
  refusals: GroundRenderRefusal[];
  /** Distinct canonical features with at least one drawn polygon. */
  drawnFeatureIds: string[];
}

function ringPositions(ring: readonly (readonly number[])[]): number[] {
  const positions: number[] = [];
  // The closing vertex is dropped: Cesium closes a polygon hierarchy itself, and
  // a repeated first/last position is exactly the duplicate a triangulator
  // treats as degenerate.
  for (let index = 0; index < ring.length - 1; index += 1) {
    positions.push(ring[index]![0]!, ring[index]![1]!);
  }
  return positions;
}

/**
 * Turns one verified per-cell artifact into drawable rings plus refusals.
 *
 * Refusal is per PART, not per polygon: a part is one canonical feature's share
 * of one cell, and drawing the simple half of a share while silently dropping
 * the rest would put unlabelled holes in a surface the panel still describes as
 * whole.
 */
export function planGroundCellRender(artifact: GroundCellArtifact): GroundCellRenderPlan {
  const groundClass = artifact.class;
  const polygons: GroundRenderPolygon[] = [];
  const refusals: GroundRenderRefusal[] = [];
  const drawn = new Set<string>();
  for (const part of artifact.parts) {
    let selfTouchingRings = 0;
    for (const polygon of part.geometry.coordinates) {
      for (const ring of polygon) if (ringIsSelfTouching(ring)) selfTouchingRings += 1;
    }
    if (selfTouchingRings > 0) {
      refusals.push({
        partId: part.partId,
        canonicalFeatureId: part.canonicalFeatureId,
        groundClass,
        reason: "non-simple-ring",
        selfTouchingRings,
        statement: `Not drawn in cell ${artifact.cellId}: ${selfTouchingRings} ring${selfTouchingRings === 1 ? "" : "s"} of this ${groundClass} share visit a position twice, which the cell clipper is documented to produce along cell boundaries. The release measures ring simplicity and does not repair it, so this share is refused rather than redrawn as a shape the source never had. The geometry remains verbatim in the release.`,
      });
      continue;
    }
    const pickId = groundPickId(part.canonicalFeatureId);
    for (const polygon of part.geometry.coordinates) {
      const outer = ringPositions(polygon[0] ?? []);
      if (outer.length < 6) continue;
      const holes = polygon.slice(1).map((ring) => ({ positions: ringPositions(ring) })).filter((ring) => ring.positions.length >= 6);
      polygons.push({ pickId, canonicalFeatureId: part.canonicalFeatureId, partId: part.partId, outer: { positions: outer }, holes });
      drawn.add(part.canonicalFeatureId);
    }
  }
  return {
    cellId: artifact.cellId,
    groundClass,
    heightMeters: GROUND_CLASS_HEIGHT_METERS[groundClass],
    cssColor: GROUND_CLASS_COLORS[groundClass],
    polygons,
    refusals,
    drawnFeatureIds: [...drawn].sort(),
  };
}

export interface GroundRenderSummary {
  drawnCells: number;
  visibleCells: number;
  drawnPolygons: number;
  skippedParts: number;
  failedCells: number;
  residentBytes: number;
}

/** The one status line the ground canary shows. Counts, never adjectives. */
export function groundRenderStatusLine(summary: GroundRenderSummary): string {
  const budget = summary.visibleCells > summary.drawnCells
    ? ` · ${summary.visibleCells - summary.drawnCells} cell${summary.visibleCells - summary.drawnCells === 1 ? "" : "s"} in view not yet drawn`
    : "";
  const failed = summary.failedCells > 0 ? ` · ${summary.failedCells} cell artifact${summary.failedCells === 1 ? "" : "s"} refused (verification failed)` : "";
  const skipped = summary.skippedParts > 0
    ? ` · ${summary.skippedParts} part${summary.skippedParts === 1 ? "" : "s"} skipped: non-simple rings`
    : " · 0 parts skipped";
  return `Ground canary · ${summary.drawnCells} cell${summary.drawnCells === 1 ? "" : "s"} drawn · ${summary.drawnPolygons} polygons${skipped}${failed}${budget}`;
}

/** Layer ids and classes in one place, so a toggle cannot address a class that is not shipped. */
export function groundClassesForVisibility(visibility: Partial<Record<GroundClass, boolean>>, shipped: readonly GroundClass[]): GroundClass[] {
  return GROUND_BASE_CLASSES.filter((groundClass) => shipped.includes(groundClass) && visibility[groundClass] !== false);
}
