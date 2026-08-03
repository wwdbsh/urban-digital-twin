import type { Freshness } from "../domain/schema.ts";
import { getSourceRegistryEntry } from "../data/source-registry.ts";
import type { RuntimeLayerId } from "./layers";
import { isSafeLocalReleaseReference } from "./path-security.ts";
import { parseTileKey, tileBounds, tileKeyString, type TileBounds, type TileKey } from "./spatial.ts";

export const TILE_PACKAGE_SCHEMA_VERSION = "1.0" as const;
export const SUPPORTED_TILE_LODS = [8, 10, 12, 14] as const;
export type SupportedTileLod = (typeof SUPPORTED_TILE_LODS)[number];

export interface TileContentManifest {
  schemaVersion: typeof TILE_PACKAGE_SCHEMA_VERSION;
  contentId: string;
  layer: RuntimeLayerId;
  tileKey: TileKey;
  bounds: TileBounds;
  lod: SupportedTileLod;
  geometricErrorMeters: number;
  featureCount: number;
  byteSize: number;
  checksumSha256: string;
  relativeContentRef: string;
  sourceRegistryEntryIds: string[];
  freshness: Freshness;
  fixtureOnly: boolean;
  children: string[];
}

export interface CityTilePackage {
  schemaVersion: typeof TILE_PACKAGE_SCHEMA_VERSION;
  packageId: string;
  cityId: string;
  outputCrs: "EPSG:4326";
  generatedAt: string;
  fixtureOnly: boolean;
  rootContentIds: string[];
  tiles: TileContentManifest[];
}

export interface TilePackageValidationIssue { path: string; message: string; }
export type TilePackageValidationResult<T> = { ok: true; value: T } | { ok: false; issues: TilePackageValidationIssue[] };

export function isSafeRelativeContentRef(value: unknown): value is string {
  return isSafeLocalReleaseReference(value);
}

export function tileManifestContentId(layer: RuntimeLayerId, tileKey: TileKey, lod: SupportedTileLod): string { return `tile:${layer}:${tileKeyString(tileKey)}:lod-${lod}`; }

function isTimestamp(value: unknown): value is string | null { return value === null || (typeof value === "string" && !Number.isNaN(Date.parse(value))); }
function sameBounds(left: TileBounds, right: TileBounds): boolean { return left.west === right.west && left.south === right.south && left.east === right.east && left.north === right.north; }

export function validateCityTilePackage(value: unknown): TilePackageValidationResult<CityTilePackage> {
  const issues: TilePackageValidationIssue[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, issues: [{ path: "$", message: "Expected a CityTilePackage object." }] };
  const pkg = value as Record<string, unknown>;
  if (pkg.schemaVersion !== TILE_PACKAGE_SCHEMA_VERSION) issues.push({ path: "schemaVersion", message: "Unsupported tile package schema version." });
  if (typeof pkg.packageId !== "string" || !pkg.packageId) issues.push({ path: "packageId", message: "Package ID is required." });
  if (pkg.outputCrs !== "EPSG:4326") issues.push({ path: "outputCrs", message: "Tile package output CRS must be WGS84." });
  if (typeof pkg.generatedAt !== "string" || Number.isNaN(Date.parse(pkg.generatedAt))) issues.push({ path: "generatedAt", message: "Package generation timestamp is required." });
  if (typeof pkg.fixtureOnly !== "boolean") issues.push({ path: "fixtureOnly", message: "Package fixture/production claim is required." });
  if (!Array.isArray(pkg.tiles)) return { ok: false, issues: [...issues, { path: "tiles", message: "Tile manifests are required." }] };
  const contentIds = new Set<string>(); const refs = new Set<string>();
  pkg.tiles.forEach((item, index) => {
    const tile = item as Record<string, unknown>; const path = `tiles[${index}]`;
    if (tile.schemaVersion !== TILE_PACKAGE_SCHEMA_VERSION) issues.push({ path: `${path}.schemaVersion`, message: "Unsupported tile manifest schema version." });
    if (typeof tile.contentId !== "string" || !tile.contentId || contentIds.has(tile.contentId)) issues.push({ path: `${path}.contentId`, message: "Tile content IDs must be unique and non-empty." });
    if (typeof tile.contentId === "string") contentIds.add(tile.contentId);
    if (!isSafeRelativeContentRef(tile.relativeContentRef)) issues.push({ path: `${path}.relativeContentRef`, message: "Tile content reference must be a safe relative local path." });
    if (typeof tile.relativeContentRef === "string") { if (refs.has(tile.relativeContentRef)) issues.push({ path: `${path}.relativeContentRef`, message: "Tile content references must be unique." }); refs.add(tile.relativeContentRef); }
    if (!SUPPORTED_TILE_LODS.includes(tile.lod as SupportedTileLod)) issues.push({ path: `${path}.lod`, message: "Unsupported tile LOD." });
    if (typeof tile.layer !== "string" || !["buildings", "pois", "areas", "stations", "entrances", "routes"].includes(tile.layer)) issues.push({ path: `${path}.layer`, message: "Unsupported tile layer." });
    if (!Number.isInteger(tile.featureCount) || (tile.featureCount as number) < 0) issues.push({ path: `${path}.featureCount`, message: "Feature count must be non-negative." });
    if (!Number.isInteger(tile.byteSize) || (tile.byteSize as number) < 0) issues.push({ path: `${path}.byteSize`, message: "Byte size must be non-negative." });
    if (typeof tile.geometricErrorMeters !== "number" || !Number.isFinite(tile.geometricErrorMeters) || tile.geometricErrorMeters < 0) issues.push({ path: `${path}.geometricErrorMeters`, message: "Geometric error must be non-negative." });
    if (typeof tile.checksumSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(tile.checksumSha256)) issues.push({ path: `${path}.checksumSha256`, message: "A SHA-256 checksum is required." });
    if (!Array.isArray(tile.sourceRegistryEntryIds) || tile.sourceRegistryEntryIds.length === 0 || tile.sourceRegistryEntryIds.some((id) => typeof id !== "string" || !id)) issues.push({ path: `${path}.sourceRegistryEntryIds`, message: "At least one provenance source group is required." });
    if (Array.isArray(tile.sourceRegistryEntryIds)) tile.sourceRegistryEntryIds.forEach((sourceId, sourceIndex) => {
      if (typeof sourceId !== "string" || !sourceId) return;
      const source = getSourceRegistryEntry(sourceId);
      if (!source) issues.push({ path: `${path}.sourceRegistryEntryIds[${sourceIndex}]`, message: `Unknown provenance source registry entry: ${sourceId}.` });
      else if (source.approval.state === "pending" && pkg.fixtureOnly !== true) issues.push({ path: `${path}.sourceRegistryEntryIds[${sourceIndex}]`, message: `Pending source cannot be used by a production tile package: ${sourceId}.` });
    });
    if (!Array.isArray(tile.children) || tile.children.some((id) => typeof id !== "string")) issues.push({ path: `${path}.children`, message: "Children must be content IDs." });
    const tileKey = tile.tileKey as Record<string, unknown>; if (!tileKey || tileKey.scheme !== "wgs84-geodetic" || !Number.isInteger(tileKey.level) || !Number.isInteger(tileKey.x) || !Number.isInteger(tileKey.y)) issues.push({ path: `${path}.tileKey`, message: "A valid WGS84 quadtree key is required." });
    if (tileKey && tileKey.scheme === "wgs84-geodetic" && Number.isInteger(tileKey.level) && Number.isInteger(tileKey.x) && Number.isInteger(tileKey.y)) { try { const expected = tileBounds(tileKey as unknown as TileKey); if (!sameBounds(tile.bounds as TileBounds, expected)) issues.push({ path: `${path}.bounds`, message: "Tile bounds must match its quadtree key." }); } catch { issues.push({ path: `${path}.tileKey`, message: "Tile key is outside supported bounds." }); } }
    const freshness = tile.freshness as Record<string, unknown>; if (!freshness || !isTimestamp(freshness.capturedAt) || !isTimestamp(freshness.updatedAt) || !isTimestamp(freshness.observedAt) || typeof freshness.ingestedAt !== "string") issues.push({ path: `${path}.freshness`, message: "Complete freshness provenance is required." });
  });
  const children = new Set<string>(); pkg.tiles.forEach((item) => { const tile = item as Record<string, unknown>; if (Array.isArray(tile.children)) tile.children.forEach((child) => children.add(String(child))); });
  children.forEach((child) => { if (!contentIds.has(child)) issues.push({ path: "tiles.children", message: `Missing child tile manifest: ${child}` }); });
  const tileById = new Map<string, Record<string, unknown>>(); pkg.tiles.forEach((item) => { const tile = item as Record<string, unknown>; if (typeof tile.contentId === "string") tileById.set(tile.contentId, tile); });
  pkg.tiles.forEach((item, index) => {
    const parent = item as Record<string, unknown>; const parentKey = parent.tileKey as Record<string, unknown>;
    if (!Array.isArray(parent.children) || !parentKey || parentKey.scheme !== "wgs84-geodetic") return;
    parent.children.forEach((childId) => {
      const child = tileById.get(String(childId)); if (!child) return;
      const childKey = child.tileKey as Record<string, unknown>;
      if (child.layer !== parent.layer || typeof childKey?.level !== "number" || typeof parentKey.level !== "number" || childKey.level <= parentKey.level) issues.push({ path: `tiles[${index}].children`, message: "Tile child must be a deeper tile in the same layer." });
      else {
        try {
          const parsedParent = parseTileKey(`wgs84-geodetic/${parentKey.level}/${parentKey.x}/${parentKey.y}`); const parsedChild = parseTileKey(`wgs84-geodetic/${childKey.level}/${childKey.x}/${childKey.y}`); const factor = 2 ** (parsedChild.level - parsedParent.level);
          if (Math.floor(parsedChild.x / factor) !== parsedParent.x || Math.floor(parsedChild.y / factor) !== parsedParent.y) issues.push({ path: `tiles[${index}].children`, message: "Tile child must be spatially nested beneath its parent." });
        } catch { issues.push({ path: `tiles[${index}].children`, message: "Tile parent/child keys must be valid WGS84 quadtree keys." }); }
      }
    });
  });
  if (Array.isArray(pkg.rootContentIds)) pkg.rootContentIds.forEach((id) => { if (typeof id !== "string" || !contentIds.has(id)) issues.push({ path: "rootContentIds", message: `Missing root tile manifest: ${String(id)}` }); }); else issues.push({ path: "rootContentIds", message: "Root tile content IDs are required." });
  if (issues.length) return { ok: false, issues }; return { ok: true, value: value as unknown as CityTilePackage };
}
