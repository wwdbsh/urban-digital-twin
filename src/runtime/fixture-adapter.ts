import type { CityAdapter, Feature } from "../domain/schema";
import { manhattanAdapter } from "../data/city-adapters";
import { runtimeFixtureFeatures } from "../domain/features";
import { DeduplicatingTileLoader, MemoryTileCache } from "./cache";
import {
  buildLayerManifest,
  DEFAULT_LAYER_VISIBILITY,
  type LayerManifest,
  type LayerVisibility,
  type RuntimeLayerId,
  layerForFeature,
} from "./layers";
import { tileKeyForFeature, tileKeyString } from "./spatial";
import { buildMetadataOnlyFixtureAssetManifest, CityAssetResolver, type CityAssetResolution, type CityAssetManifest } from "./city-asset-manifest";

export interface RuntimeCityAdapter {
  readonly city: CityAdapter;
  readonly fixtureOnly: boolean;
  getLayerManifest(layer: RuntimeLayerId): LayerManifest;
  getFeature(featureId: string): Feature | undefined;
  getFeatures(visibility?: LayerVisibility): Feature[];
  search(query: string): Feature[];
  loadLayerFeatures(layer: RuntimeLayerId): Promise<Feature[]>;
  getAssetResolution?(featureId: string, distanceMeters?: number, screenSpaceError?: number): CityAssetResolution;
  getAssetDiagnostics?(): { registered: number; approved: number; verified: number; fallback: number };
  readonly assetResolver?: CityAssetResolver;
}

export class LocalFixtureCityAdapter implements RuntimeCityAdapter {
  readonly fixtureOnly: boolean;
  readonly releaseId: string | null;
  readonly city: CityAdapter;
  private readonly features: readonly Feature[];
  private readonly layerManifests = new Map<RuntimeLayerId, LayerManifest>();
  private readonly tileIndex = new Map<string, Feature[]>();
  private readonly cache = new MemoryTileCache<Feature[]>();
  private readonly loader = new DeduplicatingTileLoader(this.cache);
  readonly assetManifest: CityAssetManifest;
  readonly assetResolver: CityAssetResolver;

  constructor(
    features: readonly Feature[] = runtimeFixtureFeatures,
    city: CityAdapter = manhattanAdapter,
    assetManifest: CityAssetManifest = buildMetadataOnlyFixtureAssetManifest(features),
    fixtureOnly = true,
    verifiedContentRefs: ReadonlySet<string> = new Set<string>(),
    releaseId: string | null = null,
  ) {
    this.features = [...features];
    this.city = city;
    this.fixtureOnly = fixtureOnly;
    this.releaseId = releaseId;
    this.assetManifest = assetManifest;
    this.assetResolver = new CityAssetResolver(assetManifest, { verifiedContentRefs });
    for (const layer of ["buildings", "pois", "areas", "stations", "entrances", "routes"] as const) {
      this.layerManifests.set(layer, buildLayerManifest(layer, this.features, {
        tileLevel: 12,
        generatedAt: "2026-08-03T00:00:00Z",
        fixtureOnly,
      }));
    }
    for (const feature of this.features) {
      const layer = layerForFeature(feature);
      if (!layer) continue;
      const key = `${layer}/${tileKeyString(tileKeyForFeature(feature, 12))}`;
      const bucket = this.tileIndex.get(key) ?? [];
      bucket.push(feature);
      this.tileIndex.set(key, bucket);
    }
  }

  getLayerManifest(layer: RuntimeLayerId): LayerManifest {
    const manifest = this.layerManifests.get(layer);
    if (!manifest) throw new Error(`Unknown runtime layer: ${layer}`);
    return manifest;
  }

  getFeature(featureId: string): Feature | undefined {
    return this.features.find((feature) => feature.id === featureId);
  }

  getFeatures(visibility: LayerVisibility = DEFAULT_LAYER_VISIBILITY): Feature[] {
    return this.features.filter((feature) => {
      const layer = layerForFeature(feature);
      return layer ? visibility[layer] : false;
    });
  }

  search(query: string): Feature[] {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return [];
    return this.features
      .map((feature) => ({
        feature,
        score: this.searchScore(feature, normalized),
      }))
      .filter((result) => result.score < Number.POSITIVE_INFINITY)
      .sort((left, right) => left.score - right.score || left.feature.id.localeCompare(right.feature.id))
      .map((result) => result.feature);
  }

  async loadLayerFeatures(layer: RuntimeLayerId): Promise<Feature[]> {
    const manifest = this.getLayerManifest(layer);
    const loaded = await Promise.all(manifest.tileKeys.map((tileKey) => this.loader.load(`${layer}/${tileKey}`, async (cacheKey) => {
      return this.tileIndex.get(cacheKey) ?? [];
    })));
    const byId = new Map<string, Feature>();
    loaded.flat().forEach((feature) => byId.set(feature.id, feature));
    return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  getAssetResolution(featureId: string, distanceMeters = 240, screenSpaceError = 1): CityAssetResolution {
    return this.assetResolver.resolve(featureId, distanceMeters, screenSpaceError);
  }

  getAssetDiagnostics(): { registered: number; approved: number; verified: number; fallback: number } {
    return this.assetResolver.countByStatus();
  }

  cacheSize(): number {
    return this.cache.size();
  }

  private searchScore(feature: Feature, query: string): number {
    const sourceIds = feature.sourceRefs.map((source) => source.sourceRecordId.toLocaleLowerCase());
    if (sourceIds.includes(query)) return 0;
    const fields = [
      feature.id,
      feature.name,
      ...feature.sourceRefs.map((source) => source.sourceRecordId),
      ...Object.values(feature.attributes).filter((value): value is string => typeof value === "string"),
    ].map((value) => value.toLocaleLowerCase());
    if (fields[0] === query) return 0;
    if (feature.name.toLocaleLowerCase() === query) return 1;
    if (feature.name.toLocaleLowerCase().startsWith(query)) return 2;
    if (fields.some((field) => field.includes(query))) return 3;
    return Number.POSITIVE_INFINITY;
  }
}
