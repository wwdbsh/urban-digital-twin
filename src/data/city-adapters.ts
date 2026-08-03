import type { CityAdapter } from "../domain/schema.ts";
import { DOMAIN_SCHEMA_VERSION } from "../domain/schema.ts";

/**
 * Approximate research boundary for the first offline pipeline slice. It is
 * intentionally a local, reviewable polygon and not a claim of an official
 * neighborhood boundary or source-data coverage.
 */
export const manhattanAdapter: CityAdapter = {
  schemaVersion: DOMAIN_SCHEMA_VERSION,
  id: "city-adapter:manhattan",
  cityId: "manhattan",
  displayName: "Manhattan, New York",
  purpose: "Reusable first-city adapter for an offline Flatiron–NoMad–Union Square pipeline slice.",
  boundary: {
    type: "Polygon",
    coordinates: [[
      [-74.010, 40.735],
      [-73.976, 40.735],
      [-73.976, 40.755],
      [-74.010, 40.755],
      [-74.010, 40.735],
    ]],
  },
  boundaryProvenance: {
    source: "Project-documented approximate study boundary",
    sourceUrl: "docs/research/MANHATTAN_DATA_STRATEGY.md#vertical-slice-and-acceptance-criteria",
    capturedAt: "2026-08-03T00:00:00Z",
    notes: "Approximate Hudson River–3rd Avenue and W 14th–W 34th Street envelope; replace or clip against approved source polygons during ingest.",
  },
  defaultInputCrs: "EPSG:4326",
  outputCrs: "EPSG:4326",
  verticalDatum: "unknown-until-source-product-metadata-is-approved",
  sourceRegistryEntryIds: [
    "fixture.local.manhattan-slice",
    "nyc.building-footprints",
    "nyc.mappluto",
    "nyc.dcp-centerline",
    "nyc.nta-2020",
    "nyc.community-districts",
    "nyc.cdta-2020",
    "nyc.borough-boundaries",
    "nyc.census-tracts-2020",
    "nyc.lpc-sites",
    "nyc.parks-properties",
    "nyc.facilities",
    "nyc.dca-businesses",
    "nyc.dohmh-restaurant-inspections",
    "mta.gtfs-static",
    "mta.gtfs-realtime",
    "mta.subway-station-complexes",
    "mta.subway-entrances-2024",
    "mta.station-amenities-2026",
    "fixture.local.transit",
    "fixture.local.route-graph",
    "overture.transportation-routing",
    "osm.nyc-routing",
    "overture.places",
    "overture.transportation",
    "osm.nyc-extract",
  ],
  supportedFeatureKinds: [
    "building",
    "parcel",
    "street",
    "park",
    "landmark",
    "facility",
    "poi",
    "transit-stop",
    "neighborhood",
    "area",
    "transit-station",
    "transit-entrance",
    "transit-route",
  ],
};
