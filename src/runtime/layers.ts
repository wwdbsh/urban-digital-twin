import type { Feature, FeatureKind } from "../domain/schema.ts";
import { tileKeyForFeature, tileKeyString } from "./spatial.ts";

export type RuntimeLayerId = "buildings" | "pois" | "areas" | "stations" | "entrances" | "routes";

export interface LayerManifest {
  schemaVersion: "1.0";
  id: RuntimeLayerId;
  version: string;
  label: string;
  fixtureOnly: boolean;
  featureKinds: FeatureKind[];
  featureIds: string[];
  tileLevel: number;
  tileKeys: string[];
  sourceRegistryEntryIds: string[];
  acceptedCount: number;
  generatedAt: string;
}

export type LayerVisibility = Record<RuntimeLayerId, boolean>;

export const DEFAULT_LAYER_VISIBILITY: LayerVisibility = {
  buildings: true,
  pois: true,
  areas: true,
  stations: true,
  entrances: true,
  routes: true,
};

export const LAYER_LABELS: Record<RuntimeLayerId, string> = {
  buildings: "Buildings",
  pois: "Points of interest",
  areas: "Areas",
  stations: "Stations",
  entrances: "Entrances",
  routes: "Routes",
};

export function layerForFeature(feature: Feature): RuntimeLayerId | null {
  if (feature.kind === "building") return "buildings";
  if (feature.kind === "poi") return "pois";
  if (feature.kind === "area") return "areas";
  if (feature.kind === "transit-station") return "stations";
  if (feature.kind === "transit-entrance") return "entrances";
  if (feature.kind === "transit-route") return "routes";
  return null;
}

export function buildLayerManifest(
  id: RuntimeLayerId,
  features: readonly Feature[],
  options: { tileLevel: number; generatedAt: string; fixtureOnly: boolean },
): LayerManifest {
  const relevant = features.filter((feature) => layerForFeature(feature) === id).sort((left, right) => left.id.localeCompare(right.id));
  const featureIds = relevant.map((feature) => feature.id);
  const tileKeys = [...new Set(relevant.map((feature) => tileKeyString(tileKeyForFeature(feature, options.tileLevel))))].sort();
  const sourceRegistryEntryIds = [...new Set(relevant.flatMap((feature) => feature.sourceRefs.map((source) => source.registryEntryId)))].sort();
  const versionMaterial = `${id}|${options.tileLevel}|${featureIds.join("|")}|${tileKeys.join("|")}`;
  return {
    schemaVersion: "1.0",
    id,
    version: `fixture-${simpleChecksum(versionMaterial)}`,
    label: LAYER_LABELS[id],
    fixtureOnly: options.fixtureOnly,
    featureKinds: id === "buildings" ? ["building"] : id === "pois" ? ["poi"] : id === "areas" ? ["area"] : id === "stations" ? ["transit-station"] : id === "entrances" ? ["transit-entrance"] : ["transit-route"],
    featureIds,
    tileLevel: options.tileLevel,
    tileKeys,
    sourceRegistryEntryIds,
    acceptedCount: relevant.length,
    generatedAt: options.generatedAt,
  };
}

function simpleChecksum(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
