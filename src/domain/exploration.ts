import { normalizeText, type CanonicalEntity, type ReconciliationResult } from "./reconciliation.ts";
import { travelContextPickPriority, type Feature, type FeatureKind, type TravelContextOverlapCandidate } from "./schema.ts";
import { buildRealPlaceSearchDocument, normalizeSearchText, type RealPlaceSearchDocument } from "../runtime/real-place-view.ts";
import type { PlaceCategory } from "./places.ts";

export interface ExplorationUrlState {
  featureId: string | null;
  query: string;
}

export interface UnifiedSearchResult {
  feature: Feature;
  entity: CanonicalEntity | null;
  group: "Buildings" | "Areas" | "Places" | "Transit" | "Addresses";
  typeLabel: string;
  score: number;
  matchedBy: "id" | "source" | "name" | "alias" | "address" | "category" | "cuisine" | "text";
}

export type ReleaseFeatureOrigin = "citywide" | "civic" | "unknown";

/** Keep composition identity separate from the civic URL/root identity. */
export function releaseFeatureOrigin(feature: Pick<Feature, "id" | "attributes">): ReleaseFeatureOrigin {
  if (feature.attributes.citywideReleaseId === "manhattan-citywide-20260804" || /^(?:doitt:|dohmh:)/iu.test(feature.id)) return "citywide";
  if (feature.attributes.civicReleaseId === "manhattan-civic-context-20260804" || /^udt:manhattan:(?:nta|park|lpc):/iu.test(feature.id)) return "civic";
  return "unknown";
}

export function releaseIdForFeature(feature: Pick<Feature, "id" | "attributes">): string | null {
  const origin = releaseFeatureOrigin(feature);
  if (origin === "citywide") return "manhattan-citywide-20260804";
  if (origin === "civic") return "manhattan-civic-context-20260804";
  return null;
}

export interface MixedSearchOptions {
  civicFacets?: readonly string[];
  limit?: number;
}

const MIXED_KIND_PRIORITY: Record<FeatureKind, number> = {
  building: 0,
  poi: 1,
  area: 2,
  park: 3,
  landmark: 4,
  parcel: 5,
  street: 6,
  facility: 7,
  neighborhood: 8,
  "fixture-point": 9,
  "transit-station": 10,
  "transit-entrance": 11,
  "transit-stop": 12,
  "transit-route": 13,
};

function mixedGroup(feature: Feature): UnifiedSearchResult["group"] {
  if (feature.kind === "building") return "Buildings";
  if (feature.kind === "area" && (feature.attributes.areaSemantics === "statistical" || feature.attributes.areaSemantics === "statistical-area")) return "Areas";
  if (feature.kind === "transit-station" || feature.kind === "transit-entrance" || feature.kind === "transit-stop" || feature.kind === "transit-route") return "Transit";
  return feature.kind === "neighborhood" ? "Areas" : "Places";
}

function mixedTypeLabel(feature: Feature): string {
  if (typeof feature.attributes.civicTypeLabel === "string") return feature.attributes.civicTypeLabel;
  if (feature.kind === "building") return "Building";
  if (feature.kind === "poi") return feature.attributes.placeCategories?.toString().includes("restaurant") ? "Restaurant" : "Place";
  if (feature.kind === "area") return "Area";
  if (feature.kind === "park") return "Park";
  if (feature.kind === "landmark") return "Landmark record";
  return TYPE_LABELS[feature.kind] ?? "Feature";
}

function mixedValues(feature: Feature): Array<{ value: string; matchedBy: UnifiedSearchResult["matchedBy"] }> {
  return [
    { value: feature.id, matchedBy: "id" },
    { value: feature.name, matchedBy: "name" },
    ...feature.sourceRefs.flatMap((source) => [
      { value: source.id, matchedBy: "source" as const },
      { value: source.sourceRecordId, matchedBy: "source" as const },
    ]),
    ...Object.entries(feature.attributes)
      .filter(([, value]) => typeof value === "string")
      .map(([key, value]) => ({ value: String(value), matchedBy: key.toLocaleLowerCase().includes("id") ? "source" as const : "text" as const })),
  ];
}

/**
 * Search the two immutable children as one deterministic catalog. Civic
 * facets apply only to civic-origin features; citywide buildings/restaurants
 * remain eligible under every civic facet selection.
 */
export function searchMixedReleaseFeatures(
  baseFeatures: readonly Feature[],
  civicFeatures: readonly Feature[],
  query: string,
  options: MixedSearchOptions = {},
): UnifiedSearchResult[] {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];
  const facets = options.civicFacets ?? [];
  const values = [...baseFeatures, ...civicFeatures].filter((feature) => {
    if (releaseFeatureOrigin(feature) !== "civic" || facets.length === 0) return true;
    return facets.includes(String(feature.attributes.civicRecordKind));
  });
  const ranked = values.flatMap((feature) => {
    const matches = mixedValues(feature)
      .map(({ value, matchedBy }) => ({ normalized: normalizeSearchText(value), matchedBy }))
      .filter((value) => value.normalized === normalized || value.normalized.startsWith(normalized) || value.normalized.includes(normalized));
    if (matches.length === 0) return [];
    const matchPriority: Record<UnifiedSearchResult["matchedBy"], number> = { id: 0, source: 1, name: 2, alias: 3, address: 4, category: 5, cuisine: 5, text: 6 };
    const best = matches.sort((left, right) => Number(left.normalized !== normalized) - Number(right.normalized !== normalized) || matchPriority[left.matchedBy] - matchPriority[right.matchedBy] || left.normalized.length - right.normalized.length || left.normalized.localeCompare(right.normalized))[0]!;
    const score = best.normalized === normalized ? matchPriority[best.matchedBy] : 10 + matchPriority[best.matchedBy];
    const origin = releaseFeatureOrigin(feature);
    return [{ feature, entity: null, group: mixedGroup(feature), typeLabel: mixedTypeLabel(feature), score, matchedBy: best.matchedBy, origin }];
  }).sort((left, right) => left.score - right.score || MIXED_KIND_PRIORITY[left.feature.kind] - MIXED_KIND_PRIORITY[right.feature.kind] || left.typeLabel.localeCompare(right.typeLabel) || left.origin.localeCompare(right.origin) || left.feature.name.localeCompare(right.feature.name) || left.feature.id.localeCompare(right.feature.id));
  return options.limit && options.limit > 0 ? ranked.slice(0, options.limit) : ranked;
}

/** Deterministic, keyboard-friendly order for overlapping source features. */
export function rankOverlapCandidates(candidates: readonly TravelContextOverlapCandidate[]): TravelContextOverlapCandidate[] {
  return [...candidates].sort((left, right) => left.priority - right.priority || travelContextPickPriority(left.kind) - travelContextPickPriority(right.kind) || left.label.localeCompare(right.label) || left.canonicalId.localeCompare(right.canonicalId));
}

const GROUPS: Record<FeatureKind, UnifiedSearchResult["group"]> = {
  building: "Buildings", parcel: "Addresses", street: "Addresses", park: "Places", landmark: "Places", facility: "Places", poi: "Places", "transit-stop": "Transit", "transit-station": "Transit", "transit-entrance": "Transit", "transit-route": "Transit", neighborhood: "Areas", area: "Areas", "fixture-point": "Places",
};

const TYPE_LABELS: Partial<Record<FeatureKind, string>> = { building: "Building", area: "Area", neighborhood: "Neighborhood", poi: "Place", park: "Park", landmark: "Landmark", facility: "Facility", "transit-station": "Station", "transit-entrance": "Entrance", "transit-route": "Route", "transit-stop": "Stop" };

function valuesFor(feature: Feature, entity: CanonicalEntity | null): { value: string; matchedBy: UnifiedSearchResult["matchedBy"] }[] {
  const values: { value: string; matchedBy: UnifiedSearchResult["matchedBy"] }[] = [];
  values.push({ value: feature.id, matchedBy: "id" });
  values.push({ value: feature.name, matchedBy: "name" });
  values.push(...feature.sourceRefs.flatMap((source) => [source.id, source.registryEntryId, source.provider, source.datasetId, source.sourceRecordId].map((value) => ({ value, matchedBy: "source" as const }))));
  values.push(...Object.values(feature.attributes).filter((value): value is string => typeof value === "string").map((value) => ({ value, matchedBy: "text" as const })));
  if (entity) {
    values.push(...entity.fields.aliases.map((value) => ({ value, matchedBy: "alias" as const })));
    values.push(...entity.fields.categories.map((value) => ({ value, matchedBy: "category" as const })));
    values.push(...entity.fields.rawCategories.map((value) => ({ value, matchedBy: "category" as const })));
    const address = entity.fields.address;
    values.push(...[address.formatted, address.houseNumber, address.street, address.unit, address.locality, address.region, address.postalCode].filter((value): value is string => Boolean(value)).map((value) => ({ value, matchedBy: "address" as const })));
    values.push(...entity.observationIds.map((value) => ({ value, matchedBy: "source" as const })));
  }
  return values;
}

export function searchUnifiedCatalog(features: readonly Feature[], catalog: ReconciliationResult, query: string): UnifiedSearchResult[] {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return [];
  const entityByFeature = new Map(catalog.entities.filter((entity) => entity.fields.runtimeFeatureId).map((entity) => [entity.fields.runtimeFeatureId!, entity]));
  return features.flatMap((feature) => {
    const entity = entityByFeature.get(feature.id) ?? null;
    const values = valuesFor(feature, entity);
    const matches = values.map(({ value, matchedBy }) => ({ normalized: normalizeText(value), matchedBy })).filter((item) => item.normalized === normalizedQuery || item.normalized.startsWith(normalizedQuery) || item.normalized.includes(normalizedQuery));
    if (matches.length === 0) return [];
    const matchPriority: Record<UnifiedSearchResult["matchedBy"], number> = { id: 0, source: 1, name: 2, alias: 3, address: 4, category: 5, cuisine: 5, text: 6 };
    const best = matches.sort((left, right) => (left.normalized === normalizedQuery ? 0 : 1) - (right.normalized === normalizedQuery ? 0 : 1) || matchPriority[left.matchedBy] - matchPriority[right.matchedBy] || left.normalized.length - right.normalized.length)[0]!;
    const score = best.matchedBy === "source" && best.normalized === normalizedQuery ? 0 : best.normalized === normalizedQuery ? 1 : best.matchedBy === "alias" ? 2 : best.matchedBy === "address" ? 3 : best.matchedBy === "category" || best.matchedBy === "cuisine" ? 4 : 5;
    return [{ feature, entity, group: GROUPS[feature.kind], typeLabel: TYPE_LABELS[feature.kind] ?? "Feature", score, matchedBy: best.matchedBy }];
  }).sort((left, right) => left.score - right.score || left.group.localeCompare(right.group) || left.feature.name.localeCompare(right.feature.name) || left.feature.id.localeCompare(right.feature.id));
}

interface RealSearchValue {
  value: string;
  matchedBy: UnifiedSearchResult["matchedBy"];
}

function realSearchValues(document: RealPlaceSearchDocument): RealSearchValue[] {
  return [
    { value: document.canonicalId, matchedBy: "id" },
    { value: document.name, matchedBy: "name" },
    ...document.address.map((value) => ({ value, matchedBy: "address" as const })),
    ...document.cuisine.map((value) => ({ value, matchedBy: "cuisine" as const })),
    ...document.categories.map((value) => ({ value, matchedBy: "category" as const })),
    ...document.rawCategories.map((value) => ({ value, matchedBy: "category" as const })),
    ...document.sourceIds.map((value) => ({ value, matchedBy: "source" as const })),
    ...document.sourceRecordIds.map((value) => ({ value, matchedBy: "source" as const })),
    ...(document.camis ? [{ value: document.camis, matchedBy: "source" as const }] : []),
  ];
}

/**
 * Search the active real browser partition directly. This deliberately does
 * not accept a reconciliation catalog: the lightweight DOHMH records are the
 * only visitor-search truth for the approved release.
 */
export function searchRealPlaceCatalog(features: readonly Feature[], query: string, selectedCategories: readonly PlaceCategory[] = []): UnifiedSearchResult[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];
  const documents = features
    .map(buildRealPlaceSearchDocument)
    .filter((document): document is RealPlaceSearchDocument => Boolean(document))
    .filter((document) => selectedCategories.length === 0 || selectedCategories.some((category) => document.categories.includes(category)));
  const priority: Record<UnifiedSearchResult["matchedBy"], number> = { id: 0, source: 1, name: 2, alias: 3, address: 4, cuisine: 5, category: 6, text: 7 };
  return documents.flatMap((document) => {
    const matches = realSearchValues(document)
      .map(({ value, matchedBy }) => ({ normalized: normalizeSearchText(value), matchedBy }))
      .filter(({ normalized }) => normalized === normalizedQuery || normalized.startsWith(normalizedQuery) || normalized.includes(normalizedQuery));
    if (matches.length === 0) return [];
    const best = matches.sort((left, right) => {
      const exact = Number(left.normalized !== normalizedQuery) - Number(right.normalized !== normalizedQuery);
      return exact || priority[left.matchedBy] - priority[right.matchedBy] || left.normalized.length - right.normalized.length || left.normalized.localeCompare(right.normalized);
    })[0]!;
    const score = best.normalized === normalizedQuery
      ? priority[best.matchedBy]
      : 10 + priority[best.matchedBy];
    return [{ feature: features.find((feature) => feature.id === document.featureId)!, entity: null, group: "Places" as const, typeLabel: document.canonicalCategory === "restaurant" ? "Restaurant" : "Place", score, matchedBy: best.matchedBy }];
  }).sort((left, right) => left.score - right.score || normalizeSearchText(left.feature.name).localeCompare(normalizeSearchText(right.feature.name)) || left.feature.id.localeCompare(right.feature.id));
}

export function parseExplorationUrl(value: string): ExplorationUrlState {
  try { const url = new URL(value); return { featureId: url.searchParams.get("feature"), query: url.searchParams.get("q") ?? "" }; } catch { return { featureId: null, query: "" }; }
}

export function explorationUrl(value: ExplorationUrlState, base: string): string {
  const url = new URL(base); if (value.featureId) url.searchParams.set("feature", value.featureId); else url.searchParams.delete("feature"); if (value.query) url.searchParams.set("q", value.query); else url.searchParams.delete("q"); return url.toString();
}
