import type {
  Confidence,
  Feature,
  FeatureKind,
  Freshness,
  SourceRef,
  Position,
  Uncertainty,
} from "./schema.ts";

export type ProvenanceKind = "authoritative" | "derived" | "generated";

export interface GeographicCoordinates {
  longitude: number;
  latitude: number;
  heightMeters: number;
}

export interface ProvenanceRecord {
  label: string;
  sourceUrl: string | null;
  capturedAt: string | null;
  updatedAt: string | null;
}

export interface IngestionSummary {
  manifestVersion: string;
  manifestId: string;
  fixtureOnly: boolean;
  acceptedCount: number;
  rejectedCount: number;
  rejectionReport: string;
}

/**
 * UI-facing projection of the canonical Feature contract. The canonical
 * geometry and provenance remain available in sourceRefs/freshness; the
 * geometry label is deliberately human-readable for the existing inspector.
 */
export interface CityFeature {
  id: string;
  kind: FeatureKind;
  name: string;
  location: string;
  geometry: string;
  coordinates: GeographicCoordinates;
  provenance: ProvenanceKind;
  provenanceRecord: ProvenanceRecord;
  sourceRefs: SourceRef[];
  confidence: Confidence;
  uncertainty: string;
  uncertaintyDetail: Uncertainty;
  freshness: Freshness;
  ingestionSummary: IngestionSummary;
  attributes: Feature["attributes"];
}

function geometryLabel(feature: Feature): string {
  return `${feature.geometry.type} · normalized ${feature.geometryProvenance.outputCrs}`;
}

function heightFromFeature(feature: Feature): number {
  const height = feature.geometryProvenance.height.valueMeters;
  return height ?? 0;
}

export function projectFeatureToCityFeature(
  feature: Feature,
  location: string,
  ingestionSummary: IngestionSummary,
): CityFeature {
  const primarySource = feature.sourceRefs[0];
  return {
    id: feature.id,
    kind: feature.kind,
    name: feature.name,
    location,
    geometry: geometryLabel(feature),
    coordinates: {
      longitude: feature.coordinates[0],
      latitude: feature.coordinates[1],
      heightMeters: heightFromFeature(feature),
    },
    provenance: feature.provenance,
    provenanceRecord: {
      label: primarySource?.provider ?? "Local normalized fixture",
      sourceUrl: primarySource?.sourceUrl ?? null,
      capturedAt: feature.freshness.capturedAt,
      updatedAt: feature.freshness.updatedAt,
    },
    sourceRefs: feature.sourceRefs,
    confidence: feature.confidence,
    uncertainty: feature.uncertainty.notes,
    uncertaintyDetail: feature.uncertainty,
    freshness: feature.freshness,
    ingestionSummary,
    attributes: feature.attributes,
  };
}

const runtimeFixtureFeature: Feature = {
  schemaVersion: "1.0",
  id: "udt:manhattan:poi:urban%20digital%20twin%20local%20test%20fixture:manhattan-flatiron-v1:fixture-poi-001",
  cityId: "manhattan",
  kind: "poi",
  name: "Fixture Coffee Counter",
  geometry: {
    type: "Point",
    coordinates: [-73.9912, 40.7431],
  },
  coordinates: [-73.9912, 40.7431],
  geometryProvenance: {
    schemaVersion: "1.0",
    sourceRefId: "source-ref:fixture.local.manhattan-slice:fixture-poi-001",
    inputCrs: "EPSG:4326",
    outputCrs: "EPSG:4326",
    capturedAt: "2026-08-03T00:00:00Z",
    height: {
      schemaVersion: "1.0",
      valueMeters: null,
      verticalDatum: "fixture-illustrative-height",
      sourceRefId: "source-ref:fixture.local.manhattan-slice:fixture-poi-001",
      method: "unknown",
      uncertaintyMeters: null,
    },
    horizontalUncertaintyMeters: 8,
    notes: "Normalized by the local offline fixture harness; not production city coverage.",
  },
  sourceRefs: [{
    schemaVersion: "1.0",
    id: "source-ref:fixture.local.manhattan-slice:fixture-poi-001",
    registryEntryId: "fixture.local.manhattan-slice",
    provider: "Urban Digital Twin local test fixture",
    datasetId: "manhattan-flatiron-v1",
    sourceRecordId: "fixture-poi-001",
    sourceUrl: "https://example.invalid/udt/local-fixture",
    licenseRefId: "license:fixture.local.manhattan-slice",
    role: "fixture",
    capturedAt: "2026-08-03T00:00:00Z",
    updatedAt: null,
    observedAt: "2026-08-03T00:00:00Z",
    release: null,
  }],
  provenance: "derived",
  confidence: {
    score: 0.45,
    label: "low",
    rationale: "Synthetic point used to exercise low-confidence detail display.",
  },
  uncertainty: {
    horizontalMeters: 8,
    verticalMeters: null,
    temporalDays: null,
    notes: "Synthetic fixture uncertainty; replace with source metadata after approval.",
  },
  freshness: {
    capturedAt: "2026-08-03T00:00:00Z",
    updatedAt: null,
    observedAt: "2026-08-03T00:00:00Z",
    ingestedAt: "2026-08-03T00:00:00Z",
  },
  attributes: {
    fixtureId: "manhattan-flatiron-v1",
    fixturePurpose: "Synthetic local fixture; not real Manhattan coverage.",
    placeCategories: "cafe,restaurant",
    placeAddress: "100 Invented Fixture Way, Manhattan, NY 10010",
    placeWebsite: "https://example.invalid/fixture-coffee",
    placePhone: null,
    placeCuisine: "Coffee",
    placeBrand: null,
    placeOpeningHours: JSON.stringify(["Mon-Fri 08:00-17:00"]),
    placeAccessibility: "unknown",
    placeSourceRecordIds: JSON.stringify(["fixture-poi-001"]),
    placeConflicts: "[]",
    placeLicenses: JSON.stringify([{
      sourceRefId: "source-ref:fixture.local.manhattan-slice:fixture-poi-001",
      licenseClass: "fixture-only",
      termsUrl: "https://example.invalid/udt/local-fixture-terms",
      attribution: "Synthetic local fixture; not real Manhattan coverage.",
    }]),
  },
};

const runtimeFixtureBuilding: Feature = {
  schemaVersion: "1.0",
  id: "udt:manhattan:building:urban%20digital%20twin%20local%20test%20fixture:manhattan-flatiron-v1:fixture-building-001",
  cityId: "manhattan",
  kind: "building",
  name: "Fixture Flatiron Block",
  geometry: {
    type: "Polygon",
    coordinates: [[
      [-73.9945, 40.7415],
      [-73.9938, 40.7415],
      [-73.9938, 40.7422],
      [-73.9945, 40.7422],
      [-73.9945, 40.7415],
    ]],
  },
  coordinates: [-73.99422, 40.74178],
  geometryProvenance: {
    schemaVersion: "1.0",
    sourceRefId: "source-ref:fixture.local.manhattan-slice:fixture-building-001",
    inputCrs: "EPSG:4326",
    outputCrs: "EPSG:4326",
    capturedAt: "2026-08-03T00:00:00Z",
    height: {
      schemaVersion: "1.0",
      valueMeters: 31.2,
      verticalDatum: "fixture-illustrative-height",
      sourceRefId: "source-ref:fixture.local.manhattan-slice:fixture-building-001",
      method: "source",
      uncertaintyMeters: 3,
    },
    horizontalUncertaintyMeters: 5,
    notes: "Normalized by the local offline fixture harness; not production city coverage.",
  },
  sourceRefs: [{
    schemaVersion: "1.0",
    id: "source-ref:fixture.local.manhattan-slice:fixture-building-001",
    registryEntryId: "fixture.local.manhattan-slice",
    provider: "Urban Digital Twin local test fixture",
    datasetId: "manhattan-flatiron-v1",
    sourceRecordId: "fixture-building-001",
    sourceUrl: "https://example.invalid/udt/local-fixture",
    licenseRefId: "license:fixture.local.manhattan-slice",
    role: "fixture",
    capturedAt: "2026-08-03T00:00:00Z",
    updatedAt: "2026-08-03T00:00:00Z",
    observedAt: "2026-08-03T00:00:00Z",
    release: null,
  }],
  provenance: "derived",
  confidence: {
    score: 0.72,
    label: "medium",
    rationale: "Synthetic geometry used to exercise the source-aware contract.",
  },
  uncertainty: {
    horizontalMeters: 5,
    verticalMeters: 3,
    temporalDays: null,
    notes: "Synthetic fixture uncertainty; replace with source metadata after approval.",
  },
  freshness: {
    capturedAt: "2026-08-03T00:00:00Z",
    updatedAt: "2026-08-03T00:00:00Z",
    observedAt: "2026-08-03T00:00:00Z",
    ingestedAt: "2026-08-03T00:00:00Z",
  },
  attributes: {
    fixtureId: "manhattan-flatiron-v1",
    fixturePurpose: "Synthetic local fixture; not real Manhattan coverage.",
    fixtureClass: "building-massing",
  },
};

function runtimeFixturePlaceVariant(
  sourceRecordId: string,
  name: string,
  coordinates: [number, number],
  categories: string,
  address: string | null,
): Feature {
  const source = runtimeFixtureFeature.sourceRefs[0];
  const sourceRefId = `source-ref:fixture.local.manhattan-slice:${sourceRecordId}`;
  return {
    ...runtimeFixtureFeature,
    id: `udt:manhattan:poi:urban%20digital%20twin%20local%20test%20fixture:manhattan-flatiron-v1:${sourceRecordId}`,
    name,
    geometry: { type: "Point", coordinates },
    coordinates,
    geometryProvenance: {
      ...runtimeFixtureFeature.geometryProvenance,
      sourceRefId,
      capturedAt: "2026-08-03T00:00:00Z",
      height: { ...runtimeFixtureFeature.geometryProvenance.height, sourceRefId },
    },
    sourceRefs: source ? [{ ...source, id: sourceRefId, sourceRecordId, observedAt: null }] : [],
    attributes: {
      ...runtimeFixtureFeature.attributes,
      placeCategories: categories,
      placeAddress: address,
      placeWebsite: null,
      placePhone: null,
      placeCuisine: null,
      placeBrand: null,
      placeOpeningHours: null,
      placeAccessibility: "unknown",
      placeSourceRecordIds: JSON.stringify([sourceRecordId]),
      placeConflicts: "[]",
      placeLicenses: JSON.stringify([{ sourceRefId, licenseClass: "fixture-only", termsUrl: "https://example.invalid/udt/local-fixture-terms", attribution: "Synthetic local fixture; not real Manhattan coverage." }]),
    },
  };
}

const runtimeFixtureRetail = runtimeFixturePlaceVariant(
  "fixture-retail-001",
  "Fixture Market Shelf",
  [-73.994, 40.744],
  "retail,grocery",
  "101 Invented Fixture Way, Manhattan, NY 10010",
);

const runtimeFixtureAttraction = runtimeFixturePlaceVariant(
  "fixture-attraction-001",
  "Fixture Gallery Corner",
  [-73.989, 40.7445],
  "attraction,museum",
  null,
);

function runtimeFixtureAreaVariant(
  sourceRecordId: string,
  name: string,
  geometry: Feature["geometry"],
  coordinates: [number, number],
  areaType: string,
  semantics: string,
  labels: string[],
): Feature {
  const source = runtimeFixtureBuilding.sourceRefs[0];
  const sourceRefId = `source-ref:fixture.local.manhattan-slice:${sourceRecordId}`;
  return {
    ...runtimeFixtureBuilding,
    id: `udt:manhattan:area:urban%20digital%20twin%20local%20test%20fixture:manhattan-flatiron-v1:${sourceRecordId}`,
    kind: "area",
    name,
    geometry,
    coordinates,
    geometryProvenance: {
      ...runtimeFixtureBuilding.geometryProvenance,
      sourceRefId,
      height: { ...runtimeFixtureBuilding.geometryProvenance.height, sourceRefId },
      notes: "Synthetic area geometry; not an official NYC boundary.",
    },
    sourceRefs: source ? [{ ...source, id: sourceRefId, sourceRecordId }] : [],
    attributes: {
      fixtureId: "manhattan-flatiron-v1",
      fixturePurpose: "Synthetic local fixture; not real Manhattan coverage.",
      areaType,
      areaLevel: "vertical-slice",
      areaSemantics: semantics,
      areaLabels: JSON.stringify(labels),
      areaOfficialName: name,
      areaSourceRecordId: sourceRecordId,
      areaLicense: JSON.stringify({ licenseClass: "fixture-only", termsUrl: "https://example.invalid/udt/local-fixture-terms", attribution: "Synthetic local fixture; not real Manhattan coverage." }),
      areaUncertainty: "Invented fixture geometry; not an official neighborhood or boundary claim.",
      fixtureOnly: true,
    },
  };
}

const runtimeFixtureStatisticalArea = runtimeFixtureAreaVariant(
  "fixture-area-nta-001",
  "Fixture Flatiron Study Area",
  {
    type: "Polygon",
    coordinates: [[
      [-73.997, 40.740], [-73.986, 40.740], [-73.986, 40.748], [-73.997, 40.748], [-73.997, 40.740],
    ], [
      [-73.994, 40.742], [-73.990, 40.742], [-73.990, 40.745], [-73.994, 40.745], [-73.994, 40.742],
    ]],
  },
  [-73.9915, 40.744],
  "nta",
  "statistical",
  ["Flatiron-like fixture", "not a universally accepted neighborhood"],
);

const runtimeFixtureAdministrativeArea = runtimeFixtureAreaVariant(
  "fixture-area-cd-001",
  "Fixture NoMad Administrative Study Area",
  {
    type: "MultiPolygon",
    coordinates: [[[
      [-73.996, 40.748], [-73.988, 40.748], [-73.988, 40.753], [-73.996, 40.753], [-73.996, 40.748],
    ]], [[
      [-73.984, 40.748], [-73.981, 40.748], [-73.981, 40.751], [-73.984, 40.751], [-73.984, 40.748],
    ]]],
  },
  [-73.991, 40.750],
  "community-district",
  "administrative",
  ["NoMad-like fixture", "administrative semantics only"],
);

function runtimeFixtureTransitFeature(
  sourceRecordId: string,
  kind: "transit-station" | "transit-entrance" | "transit-route",
  name: string,
  geometry: Feature["geometry"],
  attributes: Feature["attributes"],
): Feature {
  const sourceRefId = `source-ref:fixture.local.transit:${sourceRecordId}`;
  const first: Position = geometry.type === "Point"
    ? geometry.coordinates
    : geometry.type === "LineString"
      ? geometry.coordinates[0] ?? [-73.99, 40.744]
      : geometry.type === "MultiLineString"
        ? geometry.coordinates[0]?.[0] ?? [-73.99, 40.744]
        : [-73.99, 40.744];
  const coordinates: [number, number] = [first[0], first[1]];
  return {
    schemaVersion: "1.0",
    id: `udt:manhattan:${kind}:urban%20digital%20twin%20local%20transit%20fixture:transit-v1:${sourceRecordId}`,
    cityId: "manhattan",
    kind,
    name,
    geometry,
    coordinates,
    geometryProvenance: {
      schemaVersion: "1.0",
      sourceRefId,
      inputCrs: "EPSG:4326",
      outputCrs: "EPSG:4326",
      capturedAt: "2026-08-03T00:00:00Z",
      height: { schemaVersion: "1.0", valueMeters: null, verticalDatum: "unknown", sourceRefId: null, method: "unknown", uncertaintyMeters: null },
      horizontalUncertaintyMeters: kind === "transit-route" ? 20 : 10,
      notes: kind === "transit-route" ? "Synthetic schematic centerline; not an exact tunnel alignment." : "Synthetic station fixture; not a real station location.",
    },
    sourceRefs: [{
      schemaVersion: "1.0", id: sourceRefId, registryEntryId: "fixture.local.transit", provider: "Urban Digital Twin local transit fixture",
      datasetId: "transit-v1", sourceRecordId, sourceUrl: "https://example.invalid/udt/local-transit", licenseRefId: "license:fixture.local.transit", role: "fixture",
      capturedAt: "2026-08-03T00:00:00Z", updatedAt: null, observedAt: "2026-08-03T00:00:00Z", release: "fixture-v1",
    }],
    provenance: "derived",
    confidence: { score: 0.4, label: "low", rationale: "Synthetic fixture only; no real transit coverage." },
    uncertainty: { horizontalMeters: kind === "transit-route" ? 20 : 10, verticalMeters: null, temporalDays: null, notes: "Invented fixture uncertainty; never infer live operation or accessibility." },
    freshness: { capturedAt: "2026-08-03T00:00:00Z", updatedAt: null, observedAt: "2026-08-03T00:00:00Z", ingestedAt: "2026-08-03T00:00:00Z" },
    attributes: { fixtureOnly: true, fixturePurpose: "Synthetic local fixture; not real Manhattan coverage.", ...attributes },
  };
}

const runtimeFixtureStation = runtimeFixtureTransitFeature(
  "fixture-station-001", "transit-station", "Fixture Union Square Station Complex",
  { type: "Point", coordinates: [-73.9903, 40.7358] },
  { transitMode: "subway", transitStationComplexId: "fixture-complex-001", transitRouteIds: "1,4", transitRouteNames: "Fixture 1 · Fixture 4", transitRouteColor: "#EE352E", transitServiceDate: "2026-08-03", transitServiceSemantics: "station-inventory", transitAccessibility: "partial", transitElevatorStatus: "unknown", transitSourceLicense: "fixture-only" },
);

const runtimeFixtureEntrance = runtimeFixtureTransitFeature(
  "fixture-entrance-001", "transit-entrance", "Fixture Union Square North Entrance",
  { type: "Point", coordinates: [-73.9900, 40.7362] },
  { transitMode: "subway", transitStationComplexId: "fixture-complex-001", transitParentStationId: "fixture-station-001", transitRouteIds: "1,4", transitServiceDate: "2026-08-03", transitServiceSemantics: "station-inventory", transitAccessibility: "unknown", transitElevatorStatus: "unknown", transitSourceLicense: "fixture-only" },
);

const runtimeFixtureRoute = runtimeFixtureTransitFeature(
  "fixture-route-001", "transit-route", "Fixture Route 1 (schematic)",
  { type: "MultiLineString", coordinates: [[[-74.001, 40.730], [-73.9903, 40.7358], [-73.982, 40.744]], [[-73.9903, 40.7358], [-73.986, 40.750]]] },
  { transitMode: "subway", transitRouteIds: "1", transitRouteNames: "Fixture 1", transitRouteColor: "#EE352E", transitRouteTextColor: "#FFFFFF", transitServiceDate: "2026-08-03", transitServiceSemantics: "schematic-route", transitGeometrySemantics: "schematic-route-centerline-not-tunnel", transitSourceLicense: "fixture-only" },
);

export const runtimeFixtureFeatures: readonly Feature[] = [runtimeFixtureBuilding, runtimeFixtureFeature, runtimeFixtureRetail, runtimeFixtureAttraction, runtimeFixtureStatisticalArea, runtimeFixtureAdministrativeArea, runtimeFixtureStation, runtimeFixtureEntrance, runtimeFixtureRoute];

export const runtimeMarker = projectFeatureToCityFeature(runtimeFixtureFeature, "Manhattan, New York", {
  manifestVersion: "1.0",
  manifestId: "offline-run:manhattan-flatiron-fixture-v1",
  fixtureOnly: true,
  acceptedCount: 9,
  rejectedCount: 1,
  rejectionReport: "1 rejected fixture record: fixture-invalid-001 (WGS84 latitude out of range).",
});

export function provenanceLabel(kind: ProvenanceKind): string {
  const labels: Record<ProvenanceKind, string> = {
    authoritative: "Authoritative",
    derived: "Derived",
    generated: "Generated",
  };

  return labels[kind];
}

export function featureMatchesQuery(feature: CityFeature, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  if (!normalizedQuery) {
    return false;
  }

  return [feature.id, feature.name, feature.location, feature.provenanceRecord.label, ...feature.sourceRefs.map((source) => source.sourceRecordId)]
    .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
}
