# 0002: Manhattan data and rendering strategy

- **Status:** Proposed; implementation is approval-gated
- **Date:** 2026-08-03
- **Owners:** Urban Digital Twin implementation owner/coordinator
- **Related:** [Manhattan data strategy](../research/MANHATTAN_DATA_STRATEGY.md), [project foundation](0001-project-foundation.md)

## Context

Manhattan needs a navigable, clickable 3D city experience with buildings, neighbourhoods, businesses, landmarks, parks, streets, facilities and transit, while the data model must support other cities. The current application is a Cesium/React/TypeScript scaffold with a metadata-aware inspector and a generated validation marker; it has no authoritative city ingestion or 3D Tiles dataset yet.

The benchmark inspiration is not evidence of geographic accuracy, source rights, current business facts, or production performance. A single Blender scene would make source updates, provenance, streaming and multi-city reuse difficult. A Google-like detail experience also cannot be implemented by scraping Google Maps or silently caching Google content.

## Decision

Adopt a source-labelled, versioned ingestion pipeline and use CesiumJS + 3D Tiles as the city-scale rendering baseline:

1. Use NYC civic data as the first-party baseline for building footprints/heights, PLUTO parcels/land use, DCP streets, NYC terrain/elevation, LPC assets, parks, facilities and statistical divisions.
2. Use Overture/OSM snapshots as complementary cross-city sources for places, addresses and routable networks, retaining per-record licensing and attribution. Use NYC DCA/DOHMH/MTA data as typed authoritative enrichments where appropriate.
3. Assign platform-owned canonical IDs while retaining BIN/BBL, LPC, MTA, Overture GERS, OSM and other provider IDs in source-reference/link tables. Preserve geometry, source epoch, update/capture date, confidence, uncertainty and status.
4. Self-host versioned 3D Tiles and search data by default. Evaluate Cesium ion only after approving token, hosting, usage, subscription and terms; it is not an implicit dependency.
5. Keep Blender offline for deterministic hero-asset authoring, conversion and QA. Do not use Blender as the runtime city container. Blender MCP is not installed; any future installation or connection requires approval because candidate servers can execute arbitrary Blender Python.
6. Do not add Google to the canonical dataset. A future Google Places/Routes adapter is request-time and approval-gated for API credentials, billing, attribution, UI, Terms/Privacy Policy and no-cache constraints. No Google scraping or Google-derived geometry is permitted.
7. Keep Three.js optional and subordinate to Cesium. Add it only for a demonstrated hero/interior/custom shader need, with Cesium remaining the sole world camera and picking authority.

## Initial geographic and engineering gate

The first vertical slice is approximately W 14th–W 34th Street, Hudson River–3rd Avenue (Flatiron–NoMad–Union Square). It deliberately combines ordinary and tall buildings, dense business/restaurant POIs, parks, LPC assets, facilities, transit and a complex road graph. The exact clip polygon and tile buffer are data inputs, not a hard-coded city branch.

The slice must pass geometry validity, source-accounting, platform-ID, 100-feature click/pick, search, provenance, streaming and frame-time targets defined in the research strategy. These are targets to measure, not claims about the current scaffold. Do not call the model “current,” “complete,” or “survey-grade” when the source epoch or coverage does not support that description.

## Consequences

Positive consequences:

- The same `CityAdapter`, source registry, canonical feature schema, alias table, PostGIS search, 3D Tiles partitioning and provenance UI can serve cities beyond New York.
- Cesium handles WGS84, globe/terrain, visibility, LOD, streaming and tile-feature picking; the browser does not load a monolithic scene.
- Open/civic data supports a useful baseline without making Google billing, caching and map-display policy a runtime requirement.
- Source conflicts and uncertainty are explicit, so a business status, regulatory restaurant grade, landmark designation and vernacular neighbourhood are not conflated.

Costs and risks:

- Multiple sources require licence-aware manifests, conflation evidence and update jobs; NYC terms disclaim completeness and may not retain history.
- Overture combines source-specific CDLA, Apache and ODbL obligations; the release manifest must drive filtering and attribution.
- Self-hosting needs approved storage/CDN/operations. Cesium ion, Google, MTA realtime, 511NY and live traffic add credentials, legal review or spend.
- A realistic citywide experience will still have uncertainty: NYC's 3D baseline has a stated aerial-survey epoch, open POI data is not complete, and live traffic is not implied by road geometry.

## Approval gates before implementation

No provider installation or integration should occur until the coordinator resolves:

- NYC terms, required application disclaimer/notification and legal compatibility of derived tiles.
- Overture/OSM licence composition, attribution and retention; whether ODbL derivatives are acceptable.
- Cesium ion versus approved self-hosted storage/CDN and budget.
- MTA static/realtime feed, logo/IP, Bus Time key and commercial-use decisions.
- NYC DOT/511NY traffic access, key/agreement, privacy and whether traffic is live, simulated or historical.
- Google Places/Routes/Map Tiles credentials, billing ceilings, map/attribution UI and caching restrictions, if desired.
- File-level rights for optional landmark photos.
- Blender MCP server/revision, arbitrary-code risk, filesystem/network scope, credential isolation and review process.
- Hero/interior/Three.js scope and agreed device/network/memory/frame-time baseline.

## First implementation task

Create the source registry and offline Flatiron–NoMad–Union Square ingest described in [the research strategy](../research/MANHATTAN_DATA_STRATEGY.md#first-implementation-task-specification). The task must emit immutable manifests, normalized provenance-bearing features, explicit join/conflict reports, a small metadata-bearing 3D Tiles set, Cesium pick-to-detail behavior, search fixtures and deterministic acceptance captures. It must not call Google, traffic/realtime APIs or unapproved hosted services, and must not install Blender MCP.

## Evidence

Primary references supporting this decision are linked in the research strategy, including NYC Open Data terms and dataset metadata, MTA developer documentation, NYC DOT/511NY developer terms, OSM/Overture licensing and guides, CesiumJS/3D Tiles documentation, Blender's glTF exporter documentation, and Google Places/Routes/Maps Platform policies. Re-check all terms and prices immediately before integration because they are changeable external conditions.
