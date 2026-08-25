/**
 * What a draped zone draws, decided without a renderer (T013).
 *
 * ## The drape is a texture-coordinate decision, not a geometry decision
 *
 * The T012 contract is explicit: each texture is a RECTANGULAR image covering
 * its ownership cell's full WGS84 rectangle, nothing is masked at build time,
 * and the zone polygon is the display mask. So the drawn geometry is exactly
 * the geometry the flat pass already computed — same rings, same holes, same
 * pick ids — and the ONLY thing this module adds is the planar bounding-box
 * mapping from each vertex's position to a point in the texture:
 *
 *     s = (longitude - west) / (east - west)
 *     t = (latitude - south) / (north - south)
 *
 * over the CELL's bounds, never the polygon's. Cesium's default polygon st
 * mapping normalizes to the polygon's own bounding rectangle, which would
 * stretch a cell-sized photograph onto whatever fraction of the cell the zone
 * happens to occupy — a picture of the wrong ground, at the wrong scale, drawn
 * confidently. Supplying explicit `textureCoordinates` is what makes the drape
 * geographically registered instead of merely decorative.
 *
 * The mapping is planar in degrees, matching how the texture was reprojected;
 * it inherits the release's disclosed ~1 px NAD83/WGS84 misregistration and
 * adds no correction of its own, because inventing one would be inventing a
 * geodetic claim this pipeline never measured.
 *
 * ## What this module refuses to decide
 *
 * It does not decide WHETHER a zone is draped — that is the index, the
 * checksums and the visible set. It does not colour anything: an undraped zone
 * keeps the flat pass's colour, untouched. And it never rewrites a pick id.
 */

import type { GroundBounds } from "../../release/ground-release";
import type { GroundRenderPolygon } from "./ground-render-plan";

/**
 * The exact sentence the release's own disclaimer makes about registration,
 * restated in the shortest form a details panel can carry.
 *
 * It is a CONSTANT rather than a computed string because it is a claim, and a
 * claim that varies by call site is a claim nobody reviewed.
 */
export const ZONE_IMAGERY_MISREGISTRATION_STATEMENT =
  "Reprojection from EPSG:2263 treats NAD83 as equivalent to WGS84. The horizontal difference here is under one metre — roughly one pixel at this texture resolution — so a drape may be misregistered against its polygon by about a pixel from that cause alone.";

/**
 * The sentence that says what a drape IS, so nobody reads a photograph as a
 * survey. Delivered at 1.2 m/px, downsampled from the source's 0.152 m.
 */
export const ZONE_IMAGERY_DRAPE_STATEMENT =
  "This surface is drawn with 2024 orthoimagery draped over its verified source polygon. The polygon is the mask: pixels outside it are not drawn. The imagery depicts the capture window and nothing later, and it is not a survey of current paving, planting, access or shoreline.";

export interface ZoneImageryTextureCoordinates {
  /** Interleaved s,t pairs for the outer ring, in the ring's own vertex order. */
  outer: number[];
  /** One interleaved s,t array per hole, in the polygon's own hole order. */
  holes: number[][];
}

/**
 * Planar bounding-box texture coordinates for one flattened ring.
 *
 * `positions` is the flat `[longitude, latitude, …]` array the flat pass
 * already built for `Cartesian3.fromDegreesArray`, so the st array is
 * index-aligned with the position array by construction and no second traversal
 * of the geometry can disagree with the first.
 *
 * Values are clamped to [0, 1]: a clipped ring's vertex can sit a rounding
 * step outside its own cell rectangle, and sampling past the edge of a texture
 * would repeat or mirror a strip of pixels from the far side of the cell rather
 * than showing the edge pixel that is actually there.
 */
export function zoneImageryRingTextureCoordinates(positions: readonly number[], bounds: GroundBounds): number[] {
  const width = bounds.east - bounds.west;
  const height = bounds.north - bounds.south;
  if (!(width > 0) || !(height > 0)) throw new Error("Zone imagery texture coordinates need a positive cell rectangle.");
  const coordinates: number[] = [];
  for (let index = 0; index + 1 < positions.length; index += 2) {
    const s = (positions[index]! - bounds.west) / width;
    const t = (positions[index + 1]! - bounds.south) / height;
    coordinates.push(Math.min(1, Math.max(0, s)), Math.min(1, Math.max(0, t)));
  }
  return coordinates;
}

/** The st hierarchy for one drawn polygon, mirroring its position hierarchy. */
export function zoneImageryPolygonTextureCoordinates(polygon: GroundRenderPolygon, bounds: GroundBounds): ZoneImageryTextureCoordinates {
  return {
    outer: zoneImageryRingTextureCoordinates(polygon.outer.positions, bounds),
    holes: polygon.holes.map((hole) => zoneImageryRingTextureCoordinates(hole.positions, bounds)),
  };
}

/**
 * One zone this renderer declined to drape, and the sentence it says so with.
 *
 * Kept separate from `GroundRenderRefusal`: that type is about a PART of a
 * feature that was not drawn at all, and conflating "no polygon" with "polygon
 * drawn, photograph withheld" would tell a reader the surface is missing when
 * it is fully present in its verified cartographic form.
 */
export interface ZoneImageryDrapeRefusal {
  zoneRef: string;
  cellId: string;
  groundClass: string;
  statement: string;
}

export function zoneImageryDrapeRefusal(cellId: string, groundClass: string, detail: string): ZoneImageryDrapeRefusal {
  return {
    zoneRef: `${cellId}/${groundClass}`,
    cellId,
    groundClass,
    statement: `No orthoimagery is draped over the ${groundClass} in cell ${cellId}: ${detail} The verified flat polygon is drawn instead.`,
  };
}

export interface GroundZoneImageryRenderSummary {
  /** Zones (cell, class) currently drawn WITH a verified texture. */
  drapedZones: number;
  /** Distinct cells contributing at least one drape. */
  drapedCells: number;
  /** Visible zones the index ships no texture for; these draw flat by design. */
  undrapedZones: number;
  /** Visible zones whose texture failed verification at runtime. */
  failedZones: number;
  /** Resident verified texture bytes, against the shared ground byte ceiling. */
  textureBytes: number;
  captureYear: number;
  releaseId: string;
}

/**
 * The segment the ground status line grows when any drape is on screen.
 *
 * Appended to the flat ground's line rather than replacing it, exactly as the
 * near-tier curb segment is, so an imagery failure can never read as a ground
 * failure. It NAMES THE VINTAGE — "imagery 2024" — which is the on-screen
 * accessible statement of capture year that AC3 requires: it is present in the
 * status region of every session where a texture is visible, without a click.
 * Counts, never adjectives, and nothing at all when nothing is draped.
 */
export function groundZoneImageryStatusSegment(summary: GroundZoneImageryRenderSummary | null): string {
  if (!summary || (summary.drapedZones === 0 && summary.failedZones === 0)) return "";
  const failed = summary.failedZones > 0
    ? ` · ${summary.failedZones} zone texture${summary.failedZones === 1 ? "" : "s"} refused (verification failed)`
    : "";
  if (summary.drapedZones === 0) return failed;
  const flat = summary.undrapedZones > 0
    ? ` · ${summary.undrapedZones} zone${summary.undrapedZones === 1 ? "" : "s"} in view drawn flat (no texture shipped)`
    : "";
  return ` · imagery ${summary.captureYear}: ${summary.drapedZones} zone${summary.drapedZones === 1 ? "" : "s"} draped across ${summary.drapedCells} cell${summary.drapedCells === 1 ? "" : "s"}${flat}${failed}`;
}

/**
 * The always-on attribution line, shown while any drape is visible.
 *
 * The licence and the capture window travel WITH the credit, in one sentence,
 * because CC BY 4.0 is an attribution obligation and an obligation split across
 * two surfaces is one a reader can meet only by finding both.
 */
export function zoneImageryAttributionLine(input: { attribution: string; captureYear: number; sourceEpoch: string }): string {
  return `Orthoimagery ${input.captureYear} (captured ${input.sourceEpoch}) · ${input.attribution}`;
}
