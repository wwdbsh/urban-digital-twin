import type { Feature, SourceRef } from "./schema.ts";
import type { PlaceAccessibility, PlaceAddress, PlaceCategory, PlaceContact, PlaceSourceLicense } from "./places.ts";
import {
  PLACE_TRUTH_SCHEMA_VERSION,
  type LocalizedPlaceName,
  type PlaceFieldLineage,
  type PlaceTruthAmenity,
  type PlaceTruthCommercialFacts,
  type PlaceTruthHours,
  type PlaceTruthImageryReference,
  type PlaceTruthRecord,
  type TruthField,
  type TruthStatus,
} from "./place-truth.ts";
import { runtimeFixtureFeatures } from "./features.ts";

const fixtureTerms = "https://example.invalid/udt/local-fixture-terms";
const fixtureAttribution = "Synthetic local fixture; not real Manhattan coverage.";

function requiredFeature(suffix: string): Feature {
  const feature = runtimeFixtureFeatures.find((item) => item.id.endsWith(suffix));
  if (!feature) throw new Error(`Missing fixture feature ${suffix}.`);
  return feature;
}

function sourceOf(feature: Feature): SourceRef {
  const source = feature.sourceRefs[0];
  if (!source) throw new Error(`Missing fixture source for ${feature.id}.`);
  return source;
}

function field<T>(feature: Feature, value: T | null, status: TruthStatus, note: string, observationId = `truth:${feature.sourceRefs[0]?.sourceRecordId ?? feature.id}`): TruthField<T> {
  const source = sourceOf(feature);
  const hasValue = status === "known" || status === "stale" || status === "conflict";
  return {
    status,
    value: hasValue ? value : null,
    sourceRefIds: hasValue ? [source.id] : [],
    observationIds: hasValue ? [observationId] : [],
    observedAt: hasValue ? feature.freshness.observedAt : null,
    publishedAt: hasValue ? feature.freshness.updatedAt : null,
    validFrom: hasValue ? feature.freshness.capturedAt : null,
    validTo: null,
    confidence: hasValue ? feature.confidence.score : 0,
    uncertainty: note,
  };
}

function absent<T>(feature: Feature, note: string): TruthField<T> {
  return field<T>(feature, null, "absent", note);
}

function address(formatted: string): PlaceAddress {
  const parts = formatted.split(",").map((part) => part.trim());
  const line1 = parts[0] ?? null;
  const locality = parts[1] ?? "Manhattan";
  const region = parts[2] ?? "NY 10010";
  return { formatted, line1, line2: null, locality, region, postalCode: null, countryCode: "US" };
}

function contact(website: string | null, phone: string | null): PlaceContact {
  return { website, phone, email: null };
}

function accessibility(wheelchair: PlaceAccessibility["wheelchair"], entrance: PlaceAccessibility["entrance"], notes: string): PlaceAccessibility {
  return { wheelchair, entrance, notes };
}

function licenses(source: SourceRef): PlaceSourceLicense[] {
  return [{ sourceRefId: source.id, licenseClass: "fixture-only", termsUrl: fixtureTerms, attribution: fixtureAttribution }];
}

function localized(value: string, source: SourceRef, language: string | null = "en"): LocalizedPlaceName {
  return { value, language, sourceRefIds: [source.id] };
}

function lineage(feature: Feature, fields: Array<[string, TruthStatus, TruthField<unknown>]>, observationId: string): PlaceFieldLineage[] {
  return fields.map(([name, status, envelope]) => ({
    field: name,
    status,
    sourceRefIds: envelope.sourceRefIds,
    observationIds: envelope.observationIds.length ? envelope.observationIds : [observationId],
    observedAt: envelope.observedAt,
    publishedAt: envelope.publishedAt,
    confidence: envelope.confidence,
    uncertainty: envelope.uncertainty,
  }));
}

function commercial(feature: Feature): PlaceTruthCommercialFacts {
  return {
    priceLevel: absent(feature, "No fixture price observation."),
    rating: absent(feature, "No fixture rating observation; ratings are not invented."),
    reviewCount: absent(feature, "No fixture review count observation."),
    popularity: absent(feature, "No fixture popularity observation."),
    businessStatus: absent(feature, "No fixture business-status observation."),
  };
}

function fixturePlace(input: {
  feature: Feature;
  names: LocalizedPlaceName[];
  aliases: string[];
  categories: PlaceCategory[];
  facets: string[];
  address: TruthField<PlaceAddress>;
  contact: TruthField<PlaceContact>;
  hours: PlaceTruthHours;
  amenities: TruthField<PlaceTruthAmenity[]>;
  accessibility: TruthField<PlaceAccessibility>;
}): PlaceTruthRecord {
  const source = sourceOf(input.feature);
  const observationId = `truth:${source.sourceRecordId}`;
  const brand = absent<string>(input.feature, "No brand supplied by the fixture.");
  const operator = absent<string>(input.feature, "No operator supplied by the fixture.");
  const commercialFacts = commercial(input.feature);
  const imagery = absent<PlaceTruthImageryReference[]>(input.feature, "No photo or street imagery reference is supplied; no image URL is invented.");
  const allFields: Array<[string, TruthStatus, TruthField<unknown>]> = [
    ["name", "known", field(input.feature, input.feature.name, "known", "Synthetic name; not a real-world identity.", observationId)],
    ["address", input.address.status, input.address as TruthField<unknown>],
    ["contact", input.contact.status, input.contact as TruthField<unknown>],
    ["hours", input.hours.status, input.hours.periods as TruthField<unknown>],
    ["amenities", input.amenities.status, input.amenities as TruthField<unknown>],
    ["accessibility", input.accessibility.status, input.accessibility as TruthField<unknown>],
    ["brand", brand.status, brand as TruthField<unknown>],
    ["operator", operator.status, operator as TruthField<unknown>],
    ["commercial.priceLevel", commercialFacts.priceLevel.status, commercialFacts.priceLevel as TruthField<unknown>],
    ["commercial.rating", commercialFacts.rating.status, commercialFacts.rating as TruthField<unknown>],
    ["commercial.reviewCount", commercialFacts.reviewCount.status, commercialFacts.reviewCount as TruthField<unknown>],
    ["commercial.popularity", commercialFacts.popularity.status, commercialFacts.popularity as TruthField<unknown>],
    ["commercial.businessStatus", commercialFacts.businessStatus.status, commercialFacts.businessStatus as TruthField<unknown>],
    ["imagery", imagery.status, imagery as TruthField<unknown>],
  ];
  return {
    schemaVersion: PLACE_TRUTH_SCHEMA_VERSION,
    canonicalId: `place-truth:${input.feature.id}`,
    cityId: input.feature.cityId,
    name: field(input.feature, input.feature.name, "known", "Synthetic name; not a real-world identity.", observationId),
    localizedNames: input.names,
    aliases: input.aliases.map((value) => ({ value, language: "en", sourceRefIds: [source.id] })),
    categories: input.categories,
    facets: input.facets,
    coordinates: input.feature.coordinates,
    address: input.address,
    entrances: [],
    brand,
    operator,
    contact: input.contact,
    hours: input.hours,
    amenities: input.amenities,
    accessibility: input.accessibility,
    commercial: commercialFacts,
    imagery,
    freshness: input.feature.freshness,
    validFrom: input.feature.freshness.capturedAt,
    validTo: null,
    sourceRefs: [source],
    sourceLicenses: licenses(source),
    lineage: lineage(input.feature, allFields, observationId),
    conflicts: [],
    uncertainty: "Synthetic fixture only; no real Manhattan fact is asserted.",
    fixtureOnly: true,
    runtimeFeatureId: input.feature.id,
  };
}

const coffee = requiredFeature("fixture-poi-001");
const market = requiredFeature("fixture-retail-001");
const gallery = requiredFeature("fixture-attraction-001");

const coffeeHours: PlaceTruthHours = {
  status: "known",
  timezone: "America/New_York",
  raw: "Mon-Fri 08:00-17:00",
  periods: field(coffee, [0, 1, 2, 3, 4].map((day) => ({ day, opens: "08:00", closes: "17:00" })), "known", "Synthetic schedule for evaluator tests."),
  specialDates: field(coffee, [{ date: "2026-08-08", kind: "closed", periods: [], note: "Fixture maintenance closure." }], "known", "Synthetic special-hours fixture."),
};

const marketHours: PlaceTruthHours = {
  status: "stale",
  timezone: "America/New_York",
  raw: "Historical fixture hours; current schedule unknown",
  periods: field(market, [{ day: 0, opens: "22:00", closes: "02:00" }], "stale", "Historical overnight hours are retained but not current."),
  specialDates: field(market, [], "known", "No dated special-hours fixture supplied."),
};

const galleryHours: PlaceTruthHours = {
  status: "known",
  timezone: "America/New_York",
  raw: "Tue-Sun 10:00-18:00",
  periods: field(gallery, [0, 1, 2, 3, 4, 5].map((day) => ({ day, opens: "10:00", closes: "18:00" })), "known", "Synthetic attraction schedule for status display."),
  specialDates: field(gallery, [{ date: "2026-08-07", kind: "closed", periods: [], note: "Fixture exhibit changeover." }], "known", "Synthetic special-hours fixture."),
};

export const placeTruthFixtures: readonly PlaceTruthRecord[] = [
  fixturePlace({
    feature: coffee,
    names: [localized(coffee.name, sourceOf(coffee)), localized("카페 픽스처", sourceOf(coffee), "ko")],
    aliases: ["Coffee Counter", "Cafe Fixture"],
    categories: ["cafe", "restaurant"],
    facets: ["food-and-drink", "coffee", "fixture"],
    address: field(coffee, address("100 Invented Fixture Way, Manhattan, NY 10010"), "known", "Synthetic address only."),
    contact: field(coffee, contact("https://example.invalid/fixture-coffee", null), "known", "Synthetic website reference only."),
    hours: coffeeHours,
    amenities: field<PlaceTruthAmenity[]>(coffee, [{ id: "wifi", label: "Wi-Fi", value: "yes", note: "Synthetic amenity; not a real claim.", sourceRefIds: [sourceOf(coffee).id] }], "known", "Synthetic amenity only."),
    accessibility: field(coffee, accessibility("yes", "yes", "Synthetic accessible-entrance claim for UI tests."), "known", "Synthetic accessibility only."),
  }),
  fixturePlace({
    feature: market,
    names: [localized(market.name, sourceOf(market))],
    aliases: ["Fixture Market"],
    categories: ["retail", "grocery"],
    facets: ["shopping", "grocery", "fixture"],
    address: field(market, address("101 Invented Fixture Way, Manhattan, NY 10010"), "known", "Synthetic address only."),
    contact: absent(market, "No fixture contact observation."),
    hours: marketHours,
    amenities: field<PlaceTruthAmenity[]>(market, [], "known", "No synthetic amenity supplied."),
    accessibility: field(market, accessibility("unknown", "unknown", "Accessibility was not supplied by this fixture."), "known", "Explicit unknown accessibility state."),
  }),
  fixturePlace({
    feature: gallery,
    names: [localized(gallery.name, sourceOf(gallery))],
    aliases: ["Gallery Corner"],
    categories: ["attraction", "museum"],
    facets: ["arts", "attraction", "fixture"],
    address: absent(gallery, "No fixture address observation."),
    contact: absent(gallery, "No fixture contact observation."),
    hours: galleryHours,
    amenities: field<PlaceTruthAmenity[]>(gallery, [{ id: "step-free-entrance", label: "Step-free entrance", value: "limited", note: "Synthetic limited-accessibility fixture.", sourceRefIds: [sourceOf(gallery).id] }], "known", "Synthetic amenity only."),
    accessibility: field(gallery, accessibility("limited", "limited", "Synthetic limited accessibility state."), "known", "Synthetic accessibility only."),
  }),
];

export const placeTruthByRuntimeFeatureId = new Map(placeTruthFixtures.map((place) => [place.runtimeFeatureId, place]));
