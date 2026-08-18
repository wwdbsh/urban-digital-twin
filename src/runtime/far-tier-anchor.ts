/**
 * Where a baked far-tier tile sits on the globe.
 *
 * THE ANCHOR COMES FROM THE CELL ID, NOT FROM A RENDER EXTENT. A far-tier tile
 * is baked in cell-local metres against the cell's own tile rectangle, so the
 * only correct anchor is the rectangle that the cell id NAMES — the ledger's
 * invariant that `cell.bounds` is exactly `tileBounds(cellTileKey(cellId))`
 * (`exterior-wave-ledger.ts:785`).
 *
 * `CITYWIDE_OVERVIEW_CELL_EXTENTS.renderBounds` is the wrong rectangle BY
 * CONSTRUCTION and must never be used here. It is the union of the assignment
 * rectangle with every member building's outer ring, which is deliberately
 * LARGER than the tile: that module's own header records 870 of 883 cells
 * extending beyond their assignment rectangle, median 1.257x area and up to
 * 2.064x. Anchoring a tile on it would displace the geometry by the amount of
 * that overhang, differently for every cell, and the error would look like a
 * bake defect rather than a placement bug.
 */

import { cellTileKey } from "../release/exterior-wave-ledger";
import { tileBounds } from "./spatial";
import { CITYWIDE_OVERVIEW_CELL_ID_ALIASES } from "./citywide-overview-cell-extents";

/**
 * The bake's frozen planar scale, restated from the census that every far-tier
 * record already carries (`CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE`, metric id
 * `rect-euclidean-frozen-scale-v1`).
 *
 * These are NOT geodesics. The bake converts degrees to metres with these two
 * constants and nothing else, so the runtime must undo the conversion with the
 * identical constants or the tile lands somewhere the baker never put it. The
 * residual against true geodetic placement is measured, not assumed — see
 * `farTierPlanarPlacementResidual`.
 */
export const FAR_TIER_METERS_PER_DEGREE_LONGITUDE = 84_412.702 as const;
export const FAR_TIER_METERS_PER_DEGREE_LATITUDE = 111_049.654 as const;

/**
 * The bake frame, stated once so a reader never has to infer it from a matrix.
 *
 * Cell-local ENU metres, y-up, axes `[east, up, -north]`. The third axis is
 * NEGATED north because a y-up right-handed frame puts +z toward the viewer,
 * which is south when +y is up and +x is east.
 */
export const FAR_TIER_BAKE_FRAME = {
  units: "metres",
  origin: "the south-west corner of the cell's own WGS84 tile rectangle",
  upAxis: "y",
  axes: ["east", "up", "-north"],
  metricId: "rect-euclidean-frozen-scale-v1",
} as const;

export interface FarTierAnchor {
  readonly cellId: string;
  /** South-west corner of the cell's tile rectangle, in degrees. */
  readonly originLongitude: number;
  readonly originLatitude: number;
  /** The full tile rectangle, for culling and for the residual measurement. */
  readonly bounds: { west: number; south: number; east: number; north: number };
}

/**
 * WHERE THE FROZEN PLANAR SCALE IS ALLOWED TO BE USED AT ALL.
 *
 * `FAR_TIER_METERS_PER_DEGREE_*` are two Manhattan constants, not a projection.
 * They are wrong by a growing margin away from this latitude, and the selection
 * arithmetic that consumes them clamps longitudes without any ±180 wrap, so a
 * cell on the other side of the antimeridian would score a distance that is not
 * merely imprecise but meaningless. This band is the envelope the constants were
 * frozen for — the whole of New York City with room to spare — and a cell
 * outside it is REFUSED rather than placed with a scale nobody derived for it.
 *
 * It is a guard, not a feature: the ledger holds no such cell today, so nothing
 * in this repository can reach it. It exists so that the first cell of a second
 * city fails closed here, with a message naming the reason, instead of landing
 * silently in the wrong place.
 */
export const FAR_TIER_PLANAR_VALIDITY_BAND = { west: -74.3, east: -73.6, south: 40.4, north: 41.1 } as const;

export class FarTierAnchorError extends Error {
  constructor(readonly code: "block-835-alias" | "not-a-tile-cell" | "outside-planar-validity-band", message: string) {
    super(message);
    this.name = "FarTierAnchorError";
  }
}

/**
 * Resolve a cell id to its bake origin.
 *
 * REFUSES THE BLOCK 835 CELL, which is the one cell in the ledger whose id
 * encodes no tile. It shipped before the wave ledger existed and carries the
 * frozen `block-00835` suffix, so `cellTileKey` returns null for it and there
 * is no tile rectangle to anchor on. Its alias is listed in
 * `CITYWIDE_OVERVIEW_CELL_ID_ALIASES`, and both spellings are refused here
 * rather than silently anchored on the wrong rectangle.
 */
export function farTierTileAnchor(cellId: string): FarTierAnchor {
  const resolved = CITYWIDE_OVERVIEW_CELL_ID_ALIASES[cellId] ?? cellId;
  const tile = cellTileKey(resolved);
  if (tile === null) {
    throw new FarTierAnchorError(
      "block-835-alias",
      `Cell ${cellId} is the declared Block 835 cell, whose id encodes no tile rectangle. The far tier has no anchor for it and must fall back to massing rather than place a tile on a guessed origin.`,
    );
  }
  const bounds = tileBounds(tile);
  const band = FAR_TIER_PLANAR_VALIDITY_BAND;
  if (bounds.west < band.west || bounds.east > band.east || bounds.south < band.south || bounds.north > band.north) {
    throw new FarTierAnchorError(
      "outside-planar-validity-band",
      `Cell ${cellId} spans [${bounds.west}, ${bounds.south}] to [${bounds.east}, ${bounds.north}], outside the frozen planar scale's validity band [${band.west}, ${band.south}] to [${band.east}, ${band.north}]. The far tier's metres-per-degree constants were frozen for Manhattan and its selection arithmetic does not wrap at ±180, so this cell must fall back to massing rather than be placed with a scale nobody derived for it.`,
    );
  }
  return { cellId: resolved, originLongitude: bounds.west, originLatitude: bounds.south, bounds };
}

/**
 * How far the bake's frozen planar scale is from true geodetic placement, at
 * the far corner of one cell's tile rectangle, in metres.
 *
 * MEASURED ONCE AND RECORDED rather than asserted to be negligible. The bake
 * flattens degrees to metres with two constants; the globe does not. This
 * returns the disagreement so the record can state it as a number instead of a
 * hope. The comparison is against the same small-angle metric the near tier's
 * per-building anchors use, so it is a like-for-like residual and not a
 * different projection's error.
 */
export function farTierPlanarPlacementResidual(cellId: string): {
  readonly cellId: string;
  readonly eastMeters: number;
  readonly northMeters: number;
  readonly residualMeters: number;
} {
  const anchor = farTierTileAnchor(cellId);
  const deltaLongitude = anchor.bounds.east - anchor.bounds.west;
  const deltaLatitude = anchor.bounds.north - anchor.bounds.south;
  // The frozen planar scale the bake used.
  const frozenEast = deltaLongitude * FAR_TIER_METERS_PER_DEGREE_LONGITUDE;
  const frozenNorth = deltaLatitude * FAR_TIER_METERS_PER_DEGREE_LATITUDE;
  // True local scale at this latitude, on the WGS84 ellipsoid.
  const latitudeRadians = (anchor.originLatitude * Math.PI) / 180;
  const semiMajor = 6_378_137;
  const flattening = 1 / 298.257_223_563;
  const eccentricitySquared = flattening * (2 - flattening);
  const sinLatitude = Math.sin(latitudeRadians);
  const primeVertical = semiMajor / Math.sqrt(1 - eccentricitySquared * sinLatitude * sinLatitude);
  const meridional = (semiMajor * (1 - eccentricitySquared)) / Math.pow(1 - eccentricitySquared * sinLatitude * sinLatitude, 1.5);
  const trueEast = ((deltaLongitude * Math.PI) / 180) * primeVertical * Math.cos(latitudeRadians);
  const trueNorth = ((deltaLatitude * Math.PI) / 180) * meridional;
  const eastMeters = frozenEast - trueEast;
  const northMeters = frozenNorth - trueNorth;
  return { cellId: anchor.cellId, eastMeters, northMeters, residualMeters: Math.hypot(eastMeters, northMeters) };
}
