import type { Feature, Position } from "../domain/schema.ts";
import { runtimeFixtureFeatures } from "../domain/features.ts";
import { makeCanonicalFeatureId, sha256Hex } from "../ingestion/offline.ts";
import { tileBounds, tileKeyForCoordinate, tileKeyString, type TileKey } from "./spatial.ts";
import { tileManifestContentId, type CityTilePackage, type TileContentManifest, type SupportedTileLod } from "./tile-package.ts";

export interface SyntheticTileContent { manifest: TileContentManifest; features: Feature[]; }
export interface SyntheticTileHarnessResult { package: CityTilePackage; contents: Map<string, SyntheticTileContent>; }

const generatedAt = "2026-08-03T00:00:00Z";
/** Deliberately invented stress anchors; these are not real records or coverage. */
export const SYNTHETIC_TILE_ANCHORS: readonly Position[] = [
  [-73.991, 40.744],
  [-74.8, 40.4],
  [-74.8, 41.1],
  [-73.2, 41.1],
];

function generatedFeature(kind: "building" | "poi", sourceRecordId: string, coordinates: [number, number], heightMeters: number | null): Feature {
  const base = runtimeFixtureFeatures.find((feature) => feature.kind === kind)!;
  const source = base.sourceRefs[0]!; const sourceRefId = `source-ref:fixture.synthetic.tiles:${sourceRecordId}`;
  const geometry: Feature["geometry"] = kind === "building" ? { type: "Polygon", coordinates: [[
    [coordinates[0] - 0.00022, coordinates[1] - 0.00018], [coordinates[0] + 0.00022, coordinates[1] - 0.00018], [coordinates[0] + 0.00022, coordinates[1] + 0.00018], [coordinates[0] - 0.00022, coordinates[1] + 0.00018], [coordinates[0] - 0.00022, coordinates[1] - 0.00018],
  ]] as Position[][] } : { type: "Point", coordinates };
  return { ...base, id: makeCanonicalFeatureId("manhattan", kind, { provider: "Urban Digital Twin synthetic tile harness", datasetId: "city-scale-stress-v1", sourceId: sourceRecordId }), name: kind === "building" ? `Synthetic Massing ${sourceRecordId}` : `Synthetic POI ${sourceRecordId}`, geometry, coordinates, sourceRefs: [{ ...source, id: sourceRefId, sourceRecordId, registryEntryId: "fixture.local.manhattan-slice", provider: "Urban Digital Twin synthetic tile harness", datasetId: "city-scale-stress-v1", sourceUrl: "https://example.invalid/udt/synthetic-tiles", licenseRefId: "license:fixture.local.manhattan-slice" }], geometryProvenance: { ...base.geometryProvenance, sourceRefId: sourceRefId, height: { ...base.geometryProvenance.height, sourceRefId: sourceRefId, valueMeters: heightMeters, method: heightMeters === null ? "unknown" : "source", verticalDatum: heightMeters === null ? "unknown" : "fixture-illustrative-height" }, notes: "Generated synthetic stress fixture; not real Manhattan coverage." }, uncertainty: { ...base.uncertainty, horizontalMeters: 8, verticalMeters: heightMeters === null ? null : 3, notes: "Synthetic stress fixture uncertainty; not production coverage." }, freshness: { capturedAt: generatedAt, updatedAt: null, observedAt: generatedAt, ingestedAt: generatedAt }, attributes: { ...base.attributes, fixtureOnly: true, stressFixture: true, stressHeightKnown: heightMeters !== null, fixturePurpose: "Generated city-scale performance fixture; not real Manhattan coverage." } };
}

function isDescendant(parent: TileKey, child: TileKey): boolean {
  if (child.level <= parent.level) return false;
  const factor = 2 ** (child.level - parent.level);
  return Math.floor(child.x / factor) === parent.x && Math.floor(child.y / factor) === parent.y;
}

export async function generateSyntheticTileHarness(options: { lods?: readonly SupportedTileLod[]; featuresPerLayerPerLod?: number } = {}): Promise<SyntheticTileHarnessResult> {
  const lods = options.lods ?? [8, 10, 12, 14]; const count = options.featuresPerLayerPerLod ?? 12; const contents = new Map<string, SyntheticTileContent>(); const manifests: TileContentManifest[] = [];
  for (const lod of lods) {
    for (const layer of ["buildings", "pois"] as const) {
      const anchorsByKey = new Map<string, Position>();
      SYNTHETIC_TILE_ANCHORS.forEach((anchor) => { const tileKey = tileKeyForCoordinate(anchor[0], anchor[1], lod); anchorsByKey.set(tileKeyString(tileKey), anchor); });
      for (const [tileKeyValue, anchor] of anchorsByKey) {
        const tileKey = tileKeyValue.split("/");
        const tile = { scheme: "wgs84-geodetic", level: Number(tileKey[1]), x: Number(tileKey[2]), y: Number(tileKey[3]) } as TileKey;
        const features = Array.from({ length: count }, (_, index) => { const offset = (index - count / 2) * 0.00042; const coordinates: [number, number] = [anchor[0] + offset, anchor[1] + offset * 0.7]; return layer === "buildings" ? generatedFeature("building", `stress-building-${lod}-${tile.x}-${tile.y}-${index}`, coordinates, index % 3 === 0 ? null : 18 + (index % 7) * 4) : generatedFeature("poi", `stress-poi-${lod}-${tile.x}-${tile.y}-${index}`, [coordinates[0], anchor[1] - offset * 0.7], null); });
        const contentId = tileManifestContentId(layer, tile, lod); const payload = JSON.stringify({ schemaVersion: "1.0", contentId, features }); const checksumSha256 = await sha256Hex(payload); const manifest: TileContentManifest = { schemaVersion: "1.0", contentId, layer, tileKey: tile, bounds: tileBounds(tile), lod, geometricErrorMeters: 2 ** (14 - lod), featureCount: features.length, byteSize: new TextEncoder().encode(payload).byteLength, checksumSha256, relativeContentRef: `synthetic/${layer}/${lod}/${tile.x}/${tile.y}.json`, sourceRegistryEntryIds: ["fixture.local.manhattan-slice"], freshness: { capturedAt: generatedAt, updatedAt: null, observedAt: generatedAt, ingestedAt: generatedAt }, fixtureOnly: true, children: [] }; manifests.push(manifest); contents.set(contentId, { manifest, features });
      }
    }
  }
  const sortedLods = [...lods].sort((left, right) => left - right);
  for (const manifest of manifests) { const nextLod = sortedLods.find((lod) => lod > manifest.lod); if (nextLod === undefined) continue; manifest.children = manifests.filter((candidate) => candidate.layer === manifest.layer && candidate.lod === nextLod && isDescendant(manifest.tileKey, candidate.tileKey)).map((candidate) => candidate.contentId).sort(); }
  const packageValue: CityTilePackage = { schemaVersion: "1.0", packageId: "synthetic-manhattan-like-city-scale-v1", cityId: "manhattan", outputCrs: "EPSG:4326", generatedAt, fixtureOnly: true, rootContentIds: manifests.filter((manifest) => manifest.lod === Math.min(...lods)).map((manifest) => manifest.contentId).sort(), tiles: manifests.sort((a, b) => a.lod - b.lod || a.layer.localeCompare(b.layer)) };
  return { package: packageValue, contents };
}
