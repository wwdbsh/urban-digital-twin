import { GROUND_BASE_CLASSES, type GroundClass } from "../domain/ground.ts";
import type { Feature, FeatureKind } from "../domain/schema.ts";
import { tileKeyForFeature, tileKeyString } from "./spatial.ts";

/**
 * The five citywide-ground layer ids (T007).
 *
 * Derived from `GROUND_BASE_CLASSES` rather than written out, so a class added
 * to the ground contract cannot silently miss its toggle. They are members of
 * `RuntimeLayerId` because they are user-facing runtime layers with labels and
 * toggles — but they are deliberately ABSENT from `DEFAULT_LAYER_VISIBILITY`,
 * see the note on that constant.
 */
export const GROUND_LAYER_IDS = GROUND_BASE_CLASSES.map((groundClass) => `ground-${groundClass}` as const);

export type GroundLayerId = `ground-${GroundClass}`;

export function groundLayerId(groundClass: GroundClass): GroundLayerId {
  return `ground-${groundClass}`;
}

export type RuntimeLayerId = "buildings" | "pois" | "areas" | "stations" | "entrances" | "routes" | "statistical-areas" | "parks" | "landmarks" | GroundLayerId;

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

/** Optional keys preserve v1 callers that only know the original six layers;
 * an omitted key means hidden for a layer-specific adapter and defaults to the
 * shared visibility map when a complete runtime state is needed. */
export type LayerVisibility = Partial<Record<RuntimeLayerId, boolean>>;

/**
 * The default visibility of the CATALOG layers, and only those.
 *
 * The five `ground-*` layers are intentionally not here. This object is the key
 * set that seeds `layerVisibility` state, that `parseNavigationUrl` restores
 * against, and that is serialized into every canonical `layers=` URL — so a
 * ground key present here would appear in every ordinary session's URL and in
 * every adapter's `supportedVisibleLayers` probe, in sessions that never asked
 * for the ground release. Ground visibility is seeded from
 * `DEFAULT_GROUND_LAYER_VISIBILITY` by the ground canary only.
 */
export const DEFAULT_LAYER_VISIBILITY: LayerVisibility = {
  buildings: true,
  pois: true,
  areas: true,
  stations: true,
  entrances: true,
  routes: true,
  "statistical-areas": true,
  parks: true,
  landmarks: true,
};

export const LAYER_LABELS: Record<RuntimeLayerId, string> = {
  buildings: "Buildings",
  pois: "Points of interest",
  areas: "Areas",
  stations: "Stations",
  entrances: "Entrances",
  routes: "Routes",
  "statistical-areas": "Statistical areas",
  parks: "Parks",
  landmarks: "Landmark records",
  "ground-roadbed": "Ground · roadbed",
  "ground-sidewalk": "Ground · sidewalk",
  "ground-park": "Ground · park",
  "ground-plaza": "Ground · plaza",
  "ground-water": "Ground · water",
};

/** Ground layer visibility, applied only while the ground canary is active. */
export type GroundLayerVisibility = Record<GroundClass, boolean>;

export const DEFAULT_GROUND_LAYER_VISIBILITY: GroundLayerVisibility = Object.fromEntries(
  GROUND_BASE_CLASSES.map((groundClass) => [groundClass, true]),
) as GroundLayerVisibility;

export function layerForFeature(feature: Feature): RuntimeLayerId | null {
  if (feature.kind === "building") return "buildings";
  if (feature.kind === "poi") return "pois";
  if (feature.kind === "area" && (feature.attributes.areaSemantics === "statistical-area" || feature.attributes.areaSemantics === "statistical")) return "statistical-areas";
  if (feature.kind === "area") return "areas";
  if (feature.kind === "park") return "parks";
  if (feature.kind === "landmark") return "landmarks";
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
    featureKinds: id === "buildings" ? ["building"] : id === "pois" ? ["poi"] : id === "areas" || id === "statistical-areas" ? ["area"] : id === "parks" ? ["park"] : id === "landmarks" ? ["landmark"] : id === "stations" ? ["transit-station"] : id === "entrances" ? ["transit-entrance"] : ["transit-route"],
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
