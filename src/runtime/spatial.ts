import type { Feature, Position } from "../domain/schema.ts";

export interface TileKey {
  scheme: "wgs84-geodetic";
  level: number;
  x: number;
  y: number;
}

export interface TileBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface LodBand {
  level: number;
  maxDistanceMeters: number;
}

export interface LodSelection {
  level: number;
  distanceMeters: number;
  reason: "near" | "mid" | "far" | "horizon";
}

export const DEFAULT_LOD_BANDS: readonly LodBand[] = [
  { level: 14, maxDistanceMeters: 900 },
  { level: 12, maxDistanceMeters: 3_500 },
  { level: 10, maxDistanceMeters: 12_000 },
  { level: 8, maxDistanceMeters: Number.POSITIVE_INFINITY },
];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeLongitude(longitude: number): number {
  const wrapped = ((longitude + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 && longitude > 0 ? 180 : wrapped;
}

export function tileKeyForCoordinate(longitude: number, latitude: number, level: number): TileKey {
  if (!Number.isInteger(level) || level < 0 || level > 30) {
    throw new Error("WGS84 tile level must be an integer between 0 and 30.");
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error("Longitude must be a finite WGS84 value between -180 and 180.");
  }
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error("Latitude must be a finite WGS84 value between -90 and 90.");
  }
  const dimension = 2 ** level;
  const normalizedLongitude = normalizeLongitude(longitude);
  const x = clamp(Math.floor(((normalizedLongitude + 180) / 360) * dimension), 0, dimension - 1);
  const y = clamp(Math.floor(((90 - latitude) / 180) * dimension), 0, dimension - 1);
  return { scheme: "wgs84-geodetic", level, x, y };
}

export function tileKeyString(tile: TileKey): string {
  return `${tile.scheme}/${tile.level}/${tile.x}/${tile.y}`;
}

export function parseTileKey(value: string): TileKey {
  const parts = value.split("/");
  if (parts.length !== 4 || parts[0] !== "wgs84-geodetic") throw new Error("Invalid WGS84 tile key.");
  const level = Number(parts[1]); const x = Number(parts[2]); const y = Number(parts[3]);
  if (!Number.isInteger(level) || !Number.isInteger(x) || !Number.isInteger(y)) throw new Error("Tile key coordinates must be integers.");
  const dimension = 2 ** level;
  if (level < 0 || level > 30 || x < 0 || x >= dimension || y < 0 || y >= dimension) throw new Error("Tile key is outside supported quadtree bounds.");
  return { scheme: "wgs84-geodetic", level, x, y };
}

export function tileBounds(tile: TileKey): TileBounds {
  const dimension = 2 ** tile.level;
  const west = (tile.x / dimension) * 360 - 180;
  const east = ((tile.x + 1) / dimension) * 360 - 180;
  const north = 90 - (tile.y / dimension) * 180;
  const south = 90 - ((tile.y + 1) / dimension) * 180;
  return { west, south, east, north };
}

export function tileKeyForFeature(feature: Feature, level: number): TileKey {
  const [longitude, latitude] = feature.coordinates;
  return tileKeyForCoordinate(longitude, latitude, level);
}

export function selectLod(distanceMeters: number, bands: readonly LodBand[] = DEFAULT_LOD_BANDS): LodSelection {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    throw new Error("LOD distance must be a finite non-negative number.");
  }
  if (bands.length === 0) throw new Error("At least one LOD band is required.");
  const sorted = [...bands].sort((left, right) => left.maxDistanceMeters - right.maxDistanceMeters);
  const firstBand = sorted[0];
  const lastBand = sorted[sorted.length - 1];
  if (!firstBand || !lastBand) throw new Error("LOD bands did not produce a selection.");
  const selected = sorted.find((band) => distanceMeters <= band.maxDistanceMeters) ?? lastBand;
  if (!selected) throw new Error("LOD bands did not produce a selection.");
  const reason: LodSelection["reason"] = distanceMeters <= firstBand.maxDistanceMeters
    ? "near"
    : distanceMeters >= (lastBand.maxDistanceMeters === Number.POSITIVE_INFINITY ? 12_000 : lastBand.maxDistanceMeters)
      ? "horizon"
      : selected.level >= 12
        ? "mid"
        : "far";
  return { level: selected.level, distanceMeters, reason };
}

export function positionWithinBounds(position: Position, bounds: TileBounds): boolean {
  const [longitude, latitude] = position;
  return longitude >= bounds.west && longitude <= bounds.east && latitude >= bounds.south && latitude <= bounds.north;
}
