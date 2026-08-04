# Manhattan place-truth source and layer matrix

Research checkpoint: 2026-08-04 (UTC). This is documentation research only: no
provider API was called, no bulk dataset, tile, image, credential, or account was
used, and no third-party payload is stored in this repository. The earlier
RoundtableSpace reference remains an inspiration-only note in
[`PROJECT_BRIEF.md`](../PROJECT_BRIEF.md); this repository has no independent
evidence for its reported build time, geographic completeness, or metadata
accuracy.

## Decision summary

The open baseline is a versioned, immutable, local snapshot pipeline with
record-level provenance and license separation. NYC civic data is preferred for
City-maintained geometry and regulated facilities; OSM/Overture are enrichment
sources whose coverage, source licenses, and conflation quality vary by release;
MTA static GTFS is a schedule/station baseline, not live service. Google Maps
Platform is an optional request-time augmentation only: Places content cannot be
treated as a persisted canonical database, and Google map/attribution and
non-Google-basemap restrictions require a separate paid/terms decision. The
current Terms also prohibit creating content based on Google Maps Content,
including 3D building models from 45-degree imagery, so Google Maps/Street View
is not a facade-reference source for this project.

## Delivered-state supersession (2026-08-04)

This research checkpoint remains historical policy and source-selection
provenance. The current approved runtime boundary is narrower than the
candidate matrix: local OTI `jh45-qr5r` building footprints and DOHMH
`43nn-pn8j` inspection observations only, under approval
`msg_91770ac6d098`. The citywide release records 45,194 accepted building
records and 109,386 accepted inspection observations grouped into 12,439 CAMIS
parents (12,353 located and 86 unlocated). Its JSON shards are local generated
artifacts, not a hosted 3D Tiles or public data release.

Every other candidate in this matrix remains `pending` or separately gated;
the registry is not permission to contact a provider. DOHMH grades/actions are
inspection history, not consumer ratings/reviews/opening status, and no broad
shops, parks, attractions, transit, routing, or live layer was added. The
citywide implementation and exact source hashes are in the
[foundation implementation record](../codex/MANHATTAN_CITYWIDE_FOUNDATION_IMPLEMENTATION.md).

| Layer / fields | Candidate official source and value | Snapshot, format, CRS, freshness | Persistence and legal decision |
| --- | --- | --- | --- |
| Building footprints, height, footprint identity | [NYC OTI citywide data sharing](https://www.nyc.gov/content/oti/pages/data-analytics/citywide-data-sharing), [NYC Building Footprints](https://data.cityofnewyork.us/City-Government/Building-Footprints-Map-/jh45-qr5r), [Overture Buildings](https://docs.overturemaps.org/guides/buildings/) | NYC GIS exports/geodatabase and portal release metadata; transform the documented source CRS to WGS84; Overture releases are GeoParquet and ODbL, with mixed upstream sources. City updates and Overture release dates must be pinned. | Persist after NYC terms/licence approval. Preserve BIN/feature IDs and uncertainty; do not infer architectural detail. Overture building derivatives need ODbL review and attribution. Render as 3D Tiles only after an approved geometry/height export. |
| Parcels, land use, tax-lot context | [MapPLUTO data dictionary](https://www.nyc.gov/assets/planning/download/pdf/data-maps/open-data/pluto_datadictionary.pdf?r=16v2), [PLUTO metadata](https://www.nyc.gov/assets/planning/download/pdf/data-maps/open-data/meta_mappluto.pdf) | NYC Planning release/readme, usually tabular/geospatial; source CRS varies by release and must be read from metadata. Biannual/release-specific, not live. | Persist only as contextual parcel/land-use observations after terms approval. Never use BBL as a building or business identity; keep parcel joins reversible. |
| Streets, address ranges, street geometry | [NYC OTI street centerline inventory](https://www.nyc.gov/content/oti/pages/data-analytics/citywide-data-sharing), [NYC Planning resources/GeoSupport](https://www.nyc.gov/content/planning/pages/resources), [Overture Transportation](https://docs.overturemaps.org/guides/transportation/) | NYC centerline/geodatabase and GeoSupport metadata; Overture transportation GeoParquet and release manifests; normalize to WGS84. Both are snapshots, not traffic. | Persist approved static geometry with source attribution. Reconcile by stable source IDs and geometry evidence; never call a centerline a lane, sidewalk, or route without evidence. OSM-derived/O​​verture ODbL output needs share-alike review. |
| Addresses, structured address and localization | NYC GeoSupport/address points via [NYC Planning resources](https://www.nyc.gov/content/planning/pages/resources); [Overture Addresses](https://docs.overturemaps.org/guides/addresses/) | Structured text/points, source-dependent CRS and accuracy; Overture is GeoParquet with source-dependent licences and GERS IDs. Pin release, capture, and source row. | Persist approved address observations and field lineage. Keep unit/entrance separate; no reverse-geocoder claim from a point alone. Overture source licence must be retained per record. |
| Statistical and administrative neighborhoods | [NYC Planning datasets](https://www.nyc.gov/content/planning/pages/resources/datasets), including NTA/CDTA/community-district/border metadata | Polygon releases, often EPSG:2263 or documented source CRS; release edition and update date are material. | Persist as typed boundaries only. Label “statistical”, “administrative”, or “shoreline” semantics; never launder a statistical area into a vernacular neighborhood. |
| Parks, plazas, recreation and managed public space | [NYC Parks Open Data](https://nycopendata.socrata.com/), [NYC POPS](https://www.nyc.gov/pops), [NYC facilities inventory](https://data.cityofnewyork.us/City-Government/Facilities-Database-Shapefile/2fpa-bnsx/about) | Polygon/point/tabular releases with source CRS documented per dataset; maintenance cadence varies. POPS publishes hours/amenity context but managed-property geometry is not a legal survey. | Persist after dataset-specific terms/attribution review. Keep park-managed property, POPS, and facility identities distinct; hours/amenities are dated observations, not universal access guarantees. |
| Facilities and public services | [NYC Facilities Database](https://data.cityofnewyork.us/City-Government/Facilities-Database-Shapefile/2fpa-bnsx/about), [NYC Planning CPE/facilities](https://www.nyc.gov/content/planning/pages/resources) | Points/polygons and agency/provider fields; release date and CRS vary. | Persist approved records with agency ownership/operation semantics. Facility coverage is not commercial-place coverage and does not prove opening hours. |
| Restaurants and inspection history | [NYC DOHMH Restaurant Inspection Results](https://data.cityofnewyork.us/Health/DOHMH-New-York-City-Restaurant-Inspection-Results/43nn-pn8j), [NYC DataPortal terms](https://www.nyc.gov/html/datamine/html/data/terms.html?dataSetJs=raw) | Socrata tabular observations with inspection dates, grades/violations, and address fields; geocode only through an approved deterministic local step. Historical rows and current status must remain separate. | Persist inspection observations only after City terms and disclaimer approval. Inspection grade is not a review/rating and must never be merged into popularity or consumer sentiment. |
| Shops, department stores, attractions and broad POIs | [Overture Places guide](https://docs.overturemaps.org/guides/places/), [NYC OTI points of interest inventory](https://www.nyc.gov/content/oti/pages/data-analytics/citywide-data-sharing), NYC LPC/facilities/parks sources | Overture Places is point GeoParquet with GERS IDs, source-dependent licences, and release-level records; NYC inventories are agency-specific. | Persist only an approved release, preserving each source's licence, source ID, and attribution. Overture Places is multi-license (including CDLA, Apache, CC0 and source-specific data), so never flatten all rows to one licence or one “truth”. |
| Subway stations, stops and entrances | [MTA Developer Resources](https://www.mta.info/developers), [MTA static GTFS catalog](https://data.ny.gov/Transportation/MTA-General-Transit-Feed-Specification-GTFS-Static/fgm6-ccue), [MTA station complexes](https://data.ny.gov/Transportation/MTA-Subway-Stations-and-Complexes/5f5g-n3cz/data), [MTA entrances/exits](https://data.ny.gov/Transportation/MTA-Subway-Entrances-and-Exits-2024/i9wp-a4ja) | GTFS ZIP of UTF-8 text files; stops may represent stops, stations, entrances, and exits; coordinates are WGS84. Source release/date, feed version, and MTA portal licence metadata must be captured. | Persist static station/entrance snapshots only after written terms decision. Keep station centroid, entrance point, platform, and route shape distinct. Presence of an entrance does not prove step-free access. |
| Static transit schedules and accessibility | [GTFS Schedule Reference](https://gtfs.org/documentation/schedule/reference/), MTA static feed plus station amenities when approved | `agency.txt`, `routes.txt`, `trips.txt`, `stop_times.txt`, calendar exceptions, optional pathways/levels/translations; agency timezone controls schedule interpretation. | Persist an approved immutable feed and source date. Derive schedule status deterministically; never label it “live”. Accessibility fields remain unknown unless an approved source makes the claim. |
| Opening hours, special hours, timezone | NYC/agency source fields, OSM `opening_hours` after ODbL approval, Overture Places source fields, or optional Google Places request-time result | Store source raw text plus normalized periods, IANA timezone, observed/published/valid intervals, and parser status. Overnight periods and DST need a timezone-aware evaluator. | Persist open-source observations with field-level lineage; retain Google hours only as request-time UI unless current terms explicitly allow otherwise. Unknown/stale is a valid result. |
| Contacts, website, phone, operator, brand | NYC agency/business records, Overture Places source fields, OSM tags, or optional request-time Google Places | Structured strings with source row and observation date; validate URLs/phone normalization without inventing a value. | Persist only approved open-source values and their licences. Do not combine a Google phone/name into a durable open-source record; expose conflicts rather than selecting a convenient value. |
| Amenities and accessibility | MTA station amenities, NYC Parks/POPS/facilities, OSM tags, Overture Places attributes | Field-specific booleans/enums plus notes, source date, and uncertainty; geometry and facility access may change independently. | Persist approved observations; status is “unknown” when source is absent/stale. Never infer accessible entrance from a nearby point or a generic amenity label. |
| Photos and street imagery | NYC agency assets with explicit rights; optional [Google Street View metadata](https://developers.google.com/maps/documentation/streetview/metadata) and [Street View policies](https://developers.google.com/maps/documentation/streetview/static-web-api-best-practices) | Google metadata requires a key and returns panorama/date/copyright; panorama IDs may be stored, images/content are policy restricted. Open imagery rights must be separately recorded. | Baseline stores references/attribution only, never invented blobs/URLs. Google imagery remains request-time and Google-attributed; no bulk download, scraping, or offline cache. |
| Popularity, reviews, ratings, business status | Optional [Google Places policies](https://developers.google.com/maps/documentation/places/web-service/policies), open source fields only when explicitly licensed | Google results require field masks, attribution, author links, source links, and policy-compliant freshness; place IDs are the specific durable exception. | Not part of the open canonical baseline. Keep rating/review/popularity absent unless a licensed source explicitly supplies it; no synthetic values. Google is request-time only until paid/terms approval. |
| Photorealistic 3D, basemap, imagery tiles | Optional [Google Map Tiles API overview](https://developers.google.com/maps/documentation/tile/overview), [Map Tiles policies](https://developers.google.com/maps/documentation/tile/policies); baseline Cesium/self-hosted 3D Tiles | Google requires API key/session token, per-tile attribution aggregation, and renderer attribution handling; tiles are network content, not a bulk snapshot. | Baseline uses Cesium with self-hosted approved tiles. Google Photorealistic 3D Tiles require paid project, credentials, billing, terms, attribution, and a Google-map-compatible display decision; do not combine Google content with this non-Google basemap by assumption. |
| Real-time traffic, transit status, closures | MTA GTFS-Realtime documentation, NYC DOT/511NY feeds, optional Google request-time services | Stream/protobuf/JSON feeds with provider-controlled cadence, API keys or agreements, and no immutable release by default. | Unsupported in this slice. Do not persist, replay, or render live status until a separate short-TTL and terms decision; a static feed cannot become real-time by interpolation. |

## Google visual-reference and reconstruction policy matrix

This is a policy decision for the project, not legal advice. The current
[Google Maps Platform Terms of Service](https://cloud.google.com/maps-platform/terms)
prohibit exporting/extracting/scraping Google Maps Content, pre-fetching,
indexing, storing or rehosting it outside the Services, creating content based
on it, and using Google Maps Core Services with or near a non-Google map. The
Terms give an explicit example: creating 3D building models from 45-degree
imagery is not permitted. The [Street View policies](https://developers.google.com/maps/documentation/streetview/policies),
[Places policies](https://developers.google.com/maps/documentation/places/web-service/policies),
[Map Tiles policies](https://developers.google.com/maps/documentation/tile/policies),
and [Google Maps Platform FAQ](https://developers.google.com/maps/faq) add
attribution, source-link, cache, image-delivery, and API-only access rules.

| Proposed activity | What the official evidence supports or leaves uncertain | Project decision |
| --- | --- | --- |
| Casual visual inspiration / personal orientation | Casual viewing is not automatically a published copy, but the service terms still govern use and do not grant a right to create project assets from Google Maps Content. | Incidental private inspiration only; no capture, measurement, transcription, systematic comparison, provenance claim, or asset derived from the view. |
| Systematic reference-led reconstruction | A repeated workflow that infers facade dimensions, window layouts, materials, or ornament from Street View/Maps is creating content based on Google Maps Content; the 45-degree 3D-building example makes a near-identical facade especially unsafe. | Do not do it. Treat manual reconstruction as prohibited for this project unless Google gives written permission and counsel approves the full workflow. |
| Screenshots, recordings, downloads, local caching, or archives | Current Terms prohibit export/extraction/scraping, pre-fetch/index/store outside the Services, and bulk downloads; the FAQ says Maps Platform images/content cannot be included in generated documents. | No Google screenshots, screen recordings, downloaded imagery/tiles, local caches, captured URLs-as-assets, or reference archives. |
| Texture extraction, tracing, masks, decals, or photometric sampling | These are extraction/copying and/or derivative-content workflows; attribution alone does not cure a prohibited use. | Prohibited; never bake Google imagery into textures, materials, geometry, or metadata. |
| Photogrammetry / multi-view reconstruction | Reconstructing a mesh from Google panoramas or tiles is systematic extraction and derived 3D content; manual cleanup or low polygon count does not change the source. | Prohibited from Google imagery. Consider photogrammetry only for photographs with written commercial/derivative permission, with per-asset provenance. |
| Automated capture, scraping, crawling, or bulk collection | The Terms explicitly prohibit scraping/export and bulk downloading; Street View and tile access must use the supported Google APIs and current terms. | Prohibited, including browser automation, unofficial endpoints, screenshot loops, panorama harvesting, tile harvesting, and third-party scrapers. |
| ML/AI training, testing, validation, fine-tuning, embeddings, or evaluation | Current Terms expressly prohibit using Google Maps Content to improve ML/AI models, including train/test/validate/fine-tune. The [U.S. Copyright Office AI initiative](https://www.copyright.gov/ai/) says AI copyright questions remain fact-specific and evolving. | Prohibited: no Google imagery, screenshots, extracted geometry, captions, labels, embeddings, or derived pairs enter prompts, datasets, evaluations, or model weights. |

## Independent facade-reference workflow

The safer first version uses [NYC open data](https://www.nyc.gov/content/oti/pages/data-analytics/citywide-data-sharing),
[NYC Landmarks Preservation Commission resources](https://www.nyc.gov/site/lpc/index.page),
public-domain or clearly [CC-licensed](https://creativecommons.org/cc-licenses/)
photographs, owner/photographer-authorized materials, and photographs taken
on-site where lawful. For every asset, retain the source ID/URL, photographer
or owner, rights/permission text, attribution, capture date, permitted
commercial/derivative uses, modifications, model author, review decision, and
takedown/expiry condition; preserve uncertainty and do not claim a verified
replica. Keep Google-derived observations entirely out of this provenance chain.

The U.S. Copyright Office says an original architectural work can include the
overall form and exterior elevations while excluding individual standard
features and purely functional elements ([architectural-works guidance](https://www.copyright.gov/register/va-architecture.html),
[Circular 41](https://copyright.gov/circs/circ41.pdf)); 17 U.S.C. § 120(a)
addresses certain pictorial representations of constructed buildings visible
from public places ([statute](https://www.copyright.gov/title17/92chap1.html)).
Those sources do not automatically authorize a near-identical 3D model, copy a
particular photograph, or resolve trademark, privacy, publicity, landmark,
contract, or jurisdictional issues. The project therefore fails closed when
rights, permission scope, source licence, or similarity is unclear and uses
generic synthetic or materially abstracted geometry until review is complete.

## Technical and reconciliation rules

- Every source row gets a registry entry, exact release/capture/observed dates,
  source record ID, source URL, licence/attribution, CRS/vertical reference,
  retention rule, and confidence/uncertainty. WGS84 is the runtime output CRS;
  source CRS is never discarded.
- Canonical IDs are platform IDs. Provider IDs remain observations and may be
  stored only under that provider's terms. Matching uses explicit source IDs,
  normalized address/name/category evidence, and spatial evidence with a
  reversible merge group; contradictory high-confidence IDs are quarantined.
- A field may be known, unknown, absent, stale, or conflicting. A missing field
  is not an empty string, a guessed value, or evidence that another source is
  correct. Inspection grade, transit accessibility, business status, rating,
  review count, popularity, photo, and street imagery are never cross-source
  laundering targets.
- GeoParquet/CSV/GeoJSON/GTFS are offline ingestion formats, not browser data
  contracts. Build deterministic manifests, checksums, rejection reports, and
  source attribution before producing search indexes or 3D Tiles.

## Official evidence accessed

All links above were reviewed on 2026-08-04 (UTC), without downloading provider
payloads. Primary evidence includes [NYC DataPortal Terms](https://www.nyc.gov/html/datamine/html/data/terms.html?dataSetJs=raw),
[NYC OTI data inventory](https://www.nyc.gov/content/oti/pages/data-analytics/citywide-data-sharing),
[Overture attribution/licensing](https://docs.overturemaps.org/attribution/),
[Overture Places](https://docs.overturemaps.org/guides/places/),
[Overture Buildings](https://docs.overturemaps.org/guides/buildings/),
[Overture Transportation](https://docs.overturemaps.org/guides/transportation/),
[OSM copyright and licence](https://www.openstreetmap.org/copyright),
[OSM API policy](https://operations.osmfoundation.org/policies/api/),
[Overpass documentation](https://wiki.openstreetmap.org/wiki/Overpass_API),
[MTA developer resources](https://www.mta.info/developers),
[GTFS reference](https://gtfs.org/documentation/schedule/reference/),
[Google Places policy](https://developers.google.com/maps/documentation/places/web-service/policies),
[Google Place IDs](https://developers.google.com/maps/documentation/places/web-service/place-id),
[Google Street View metadata](https://developers.google.com/maps/documentation/streetview/metadata),
[Google Map Tiles overview](https://developers.google.com/maps/documentation/tile/overview),
[Google Map Tiles policy](https://developers.google.com/maps/documentation/tile/policies),
and [Google Maps Platform service terms](https://cloud.google.com/maps-platform/terms/maps-service-terms).
Additional policy evidence reviewed on 2026-08-04 (UTC): [Google Maps Platform
Terms of Service](https://cloud.google.com/maps-platform/terms), [Street View
policies](https://developers.google.com/maps/documentation/streetview/policies),
[Places policies](https://developers.google.com/maps/documentation/places/web-service/policies),
[Map Tiles policies](https://developers.google.com/maps/documentation/tile/policies),
[Google Maps Platform FAQ](https://developers.google.com/maps/faq), [U.S.
Copyright Office architectural works](https://www.copyright.gov/register/va-architecture.html),
[17 U.S.C. § 120](https://www.copyright.gov/title17/92chap1.html), [Circular
41](https://copyright.gov/circs/circ41.pdf), and the [Copyright Office AI
initiative](https://www.copyright.gov/ai/). No provider imagery or payload was
downloaded, captured, cached, or stored.
