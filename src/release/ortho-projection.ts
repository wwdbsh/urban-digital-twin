/**
 * EPSG:2263 (NAD83 / New York Long Island, US survey feet) <-> WGS84.
 *
 * The 2024 orthoimagery snapshot is delivered as axis-aligned tiles in
 * EPSG:2263; every zone polygon this project owns is in WGS84. Draping one onto
 * the other needs the conversion in BOTH directions, so both are here:
 *
 *   - `wgs84ToEpsg2263` is the one the assembler calls per output pixel. Zone
 *     textures are rasterized on a WGS84 grid, and each output pixel asks "which
 *     source feet-coordinate do I sample?". That is the FORWARD direction here
 *     and the INVERSE mapping in resampling terms.
 *   - `epsg2263ToWgs84` converts tile footprints to WGS84 envelopes, which is
 *     how `zone-tile-mapping.json` selected its tiles in the first place.
 *
 * Implemented as plain arithmetic rather than pulled from a projection library:
 * the parameter set is fixed and small, the formulas are Snyder's published
 * Lambert Conformal Conic 2SP, and a dependency that could silently change its
 * datum handling between versions is a poor trade for a checksum-pinned release
 * whose artifacts must stay reproducible.
 *
 * DATUM: NAD83 and WGS84 are treated as equivalent, matching the recorded
 * acquisition method. The horizontal difference in this region is well under one
 * metre. That is immaterial at 2500 ft tile granularity but is NOT negligible at
 * the sub-metre pixel scale of the imagery itself, so it is disclosed rather
 * than hidden: a zone texture may be misregistered against its polygon by an
 * amount on the order of a pixel from this cause alone.
 */

/** Exact US survey foot. Not the international foot; EPSG:2263 is ftUS. */
export const US_SURVEY_FOOT_METERS = 1200 / 3937;

/**
 * GRS80, the NAD83 ellipsoid.
 *
 * Inverse flattening is GRS80's defining 298.257222101, not WGS84's
 * 298.257223563. The two differ far below the precision anything here claims,
 * but the source declares NAD83 and so does this.
 */
export const GRS80_SEMI_MAJOR_AXIS_METERS = 6378137;
export const GRS80_INVERSE_FLATTENING = 298.257222101;

/**
 * EPSG:2263 defining parameters.
 *
 * `falseEastingFeet` is 984250 ftUS, which is exactly 300000 m
 * (984250 * 1200 / 3937 = 1181100000 / 3937 = 300000). The exactness matters:
 * it is the assertion the round-trip test pins the origin against.
 */
export const EPSG_2263 = {
  standardParallelSouthDegrees: 40 + 40 / 60,
  standardParallelNorthDegrees: 41 + 2 / 60,
  latitudeOfOriginDegrees: 40 + 10 / 60,
  centralMeridianDegrees: -74,
  falseEastingFeet: 984250,
  falseNorthingFeet: 0,
} as const;

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

const FLATTENING = 1 / GRS80_INVERSE_FLATTENING;
const ECCENTRICITY_SQUARED = 2 * FLATTENING - FLATTENING * FLATTENING;
const ECCENTRICITY = Math.sqrt(ECCENTRICITY_SQUARED);

/** Snyder (14-15): m = cos(phi) / sqrt(1 - e^2 sin^2(phi)). */
function conformalM(latitudeRadians: number): number {
  const sin = Math.sin(latitudeRadians);
  return Math.cos(latitudeRadians) / Math.sqrt(1 - ECCENTRICITY_SQUARED * sin * sin);
}

/** Snyder (15-9): t = tan(pi/4 - phi/2) / ((1 - e sin phi) / (1 + e sin phi))^(e/2). */
function conformalT(latitudeRadians: number): number {
  const sin = Math.sin(latitudeRadians);
  const eSin = ECCENTRICITY * sin;
  return (
    Math.tan(Math.PI / 4 - latitudeRadians / 2) /
    Math.pow((1 - eSin) / (1 + eSin), ECCENTRICITY / 2)
  );
}

const PHI_1 = EPSG_2263.standardParallelSouthDegrees * DEG_TO_RAD;
const PHI_2 = EPSG_2263.standardParallelNorthDegrees * DEG_TO_RAD;
const PHI_0 = EPSG_2263.latitudeOfOriginDegrees * DEG_TO_RAD;
const LAMBDA_0 = EPSG_2263.centralMeridianDegrees * DEG_TO_RAD;

const M_1 = conformalM(PHI_1);
const M_2 = conformalM(PHI_2);
const T_1 = conformalT(PHI_1);
const T_2 = conformalT(PHI_2);

/** Cone constant, Snyder (15-8). */
const N = (Math.log(M_1) - Math.log(M_2)) / (Math.log(T_1) - Math.log(T_2));
/** Snyder (15-10). */
const BIG_F = M_1 / (N * Math.pow(T_1, N));
/** Radius to the latitude of origin, Snyder (15-7) evaluated at phi0. */
const RHO_0 = GRS80_SEMI_MAJOR_AXIS_METERS * BIG_F * Math.pow(conformalT(PHI_0), N);

const FALSE_EASTING_METERS = EPSG_2263.falseEastingFeet * US_SURVEY_FOOT_METERS;
const FALSE_NORTHING_METERS = EPSG_2263.falseNorthingFeet * US_SURVEY_FOOT_METERS;

export interface Wgs84Point {
  longitude: number;
  latitude: number;
}

export interface Epsg2263Point {
  /** Easting in US survey feet. */
  x: number;
  /** Northing in US survey feet. */
  y: number;
}

/**
 * Grid scale factor at a latitude.
 *
 * Exposed because it is the cheapest independent check that the cone constants
 * are right: an LCC 2SP is true to scale exactly on its two standard parallels,
 * so this must return 1 there and nowhere else between them.
 */
export function epsg2263ScaleFactor(latitudeDegrees: number): number {
  const phi = latitudeDegrees * DEG_TO_RAD;
  const rho = GRS80_SEMI_MAJOR_AXIS_METERS * BIG_F * Math.pow(conformalT(phi), N);
  return (rho * N) / (GRS80_SEMI_MAJOR_AXIS_METERS * conformalM(phi));
}

/** WGS84 -> EPSG:2263 US survey feet. Snyder (15-1), (15-2), (14-4). */
export function wgs84ToEpsg2263(longitudeDegrees: number, latitudeDegrees: number): Epsg2263Point {
  const phi = latitudeDegrees * DEG_TO_RAD;
  const lambda = longitudeDegrees * DEG_TO_RAD;
  const rho = GRS80_SEMI_MAJOR_AXIS_METERS * BIG_F * Math.pow(conformalT(phi), N);
  const theta = N * (lambda - LAMBDA_0);
  const easting = FALSE_EASTING_METERS + rho * Math.sin(theta);
  const northing = FALSE_NORTHING_METERS + RHO_0 - rho * Math.cos(theta);
  return { x: easting / US_SURVEY_FOOT_METERS, y: northing / US_SURVEY_FOOT_METERS };
}

/**
 * Maximum iterations for the inverse latitude series, Snyder (7-9).
 *
 * At this eccentricity the series converges to double precision in about four
 * passes. The cap exists so a pathological input cannot spin forever inside a
 * per-pixel loop; reaching it returns the best estimate rather than throwing,
 * because the caller's own tolerance check is the real gate.
 */
const INVERSE_MAX_ITERATIONS = 12;
const INVERSE_TOLERANCE_RADIANS = 1e-14;

/** EPSG:2263 US survey feet -> WGS84. Snyder (15-5) through (15-11) plus (7-9). */
export function epsg2263ToWgs84(xFeet: number, yFeet: number): Wgs84Point {
  const easting = xFeet * US_SURVEY_FOOT_METERS - FALSE_EASTING_METERS;
  const northing = RHO_0 - (yFeet * US_SURVEY_FOOT_METERS - FALSE_NORTHING_METERS);

  // rho carries the sign of n so southern-cone parameter sets stay correct.
  const rho = Math.sign(N) * Math.hypot(easting, northing);
  const theta = Math.atan2(Math.sign(N) * easting, Math.sign(N) * northing);
  const t = Math.pow(rho / (GRS80_SEMI_MAJOR_AXIS_METERS * BIG_F), 1 / N);

  let phi = Math.PI / 2 - 2 * Math.atan(t);
  for (let iteration = 0; iteration < INVERSE_MAX_ITERATIONS; iteration += 1) {
    const eSin = ECCENTRICITY * Math.sin(phi);
    const next =
      Math.PI / 2 - 2 * Math.atan(t * Math.pow((1 - eSin) / (1 + eSin), ECCENTRICITY / 2));
    const delta = Math.abs(next - phi);
    phi = next;
    if (delta < INVERSE_TOLERANCE_RADIANS) break;
  }

  return { longitude: (theta / N + LAMBDA_0) * RAD_TO_DEG, latitude: phi * RAD_TO_DEG };
}
