# Manhattan transit data decision note

Evidence checked 2026-08-03 against official publisher documentation only. No record, feed, archive, API response, credential, or provider download was used.

## Semantics and recommended source roles

The runtime keeps these concepts separate: GTFS static is a dated schedule/network baseline; GTFS-Realtime is operational trip updates, vehicle positions, and alerts; an MTA station complex is a grouped inventory point; a GTFS stop/platform is a boarding location; an entrance/exit is a surface access point; and a route line is schematic network visualization. A schematic line is never presented as an exact tunnel path, routing graph, or live service claim.

| Source | Official evidence and coverage | Cadence / fields | License, retention, and decision |
| --- | --- | --- | --- |
| MTA GTFS static | MTA open-data catalog and [official open-data landing page](https://www.mta.info/open-data); [catalog listing](https://www.mta.info/document/152191). GTFS supplies routes, trips, stop/platform/station relationships, service dates, and route colors. | Feed-specific; catalog does not establish one release cadence. GTFS `routes.route_id`, `route_color`, `stops.stop_id`, `location_type`, `parent_station`, and `wheelchair_boarding` are defined by the [official GTFS reference](https://gtfs.org/documentation/schedule/reference/). | MTA catalog license is unspecified in the checked record. Keep pending: request written terms for snapshot retention, redistribution, derived tiles, attribution, and rate limits before ingest. Recommended static baseline after approval. |
| MTA Subway GTFS-Realtime | [MTA GTFS-RT guide PDF](https://api.mta.info/GTFS.pdf) documents the NYC Subway feed and GTFS-Realtime format. | Operational and time-sensitive; feed behavior/update interval must be measured after authorization. Carries trip updates, vehicle positions, and alerts, not a static station geometry replacement. | API access/key and current terms require approval; no key or caching is configured. Do not retain/replay live records or imply current arrivals until explicit retention, redistribution, rate-limit, and service-level decisions exist. |
| MTA station complexes | [MTA Subway Stations and Complexes, dataset 5f5g-n3cz](https://data.ny.gov/Transportation/MTA-Subway-Stations-and-Complexes/5f5g-n3cz/data). Official portal describes station/complex IDs, GTFS stop IDs, borough, daytime routes, structure type, centroid coordinates, and ADA field. | Portal checked as updated 2026-07-24 and posting as needed (445 rows shown in portal metadata at check time). It is an inventory/centroid source, not platform, entrance, or tunnel geometry. | Portal license was not identified as an explicit reusable license. Pending terms review; preserve dataset version, source date, attribution, and ADA uncertainty. Recommended station-complex adapter after approval. |
| MTA subway entrances/exits 2024 | [MTA Subway Entrances and Exits 2024, dataset i9wp-a4ja](https://data.ny.gov/Transportation/MTA-Subway-Entrances-and-Exits-2024/i9wp-a4ja), [official data dictionary](https://data.ny.gov/api/views/i9wp-a4ja/files/aa69cf4f-41d5-47f0-b421-aade8737ae93?download=true&filename=MTA_SubwayEntrancesAndExits_DataDictionary.pdf). | Point-in-time 2024 product; portal checked as 2,120 rows, static/not updated, portal update 2025-12-05. Includes entrance/exit type, entry/exit permission, complex/station/GTFS IDs, routes, line/division. Data dictionary caveat: georeference may be a platform-generated centroid of address components and may not be exact when address is missing. | Portal license unspecified; no reuse or retention inferred from public visibility. Keep pending; preserve source date and georeference uncertainty. Recommended entrance layer after approval. |
| MTA station amenities | [Station Amenities Beginning May 2026, dataset 6yjv-fk7g](https://data.ny.gov/Transportation/MTA-Subway-Station-Amenities-Beginning-May-2026/6yjv-fk7g). | Monthly beginning May 2026; amenity classes include elevator, escalator, help point, restroom, OMNY vending, and turnstile. Presence is not live outage state. | License/redistribution terms were not explicit in checked portal metadata. Pending; join by approved station IDs only and retain unknown/outage distinction. Optional static accessibility enrichment. |
| MTA station envelopes | [MTA Subway and Rail Station Envelopes, dataset vkng-7ivg](https://data.ny.gov/Transportation/MTA-Subway-and-Rail-Station-Envelopes/vkng-7ivg). | Polygon envelopes intended to capture publicly accessible station areas under NYC zoning semantics. | Treat as a coarse public-area envelope, never internal station/tunnel geometry; terms remain pending. Optional visualization only. |
| NYC Open Data alternatives | NYC Open Data is a catalog/portal, not blanket permission. The official [NYC Open Data terms/overview](https://opendata.cityofnewyork.us/overview/) must be checked per dataset. | NYC alternatives may add facility or accessibility context but do not replace MTA identifiers, GTFS service semantics, or live operational status. | No NYC alternative should be enabled until its specific terms, attribution, retention, derivatives, and update behavior are recorded in the source registry. |

## Contract and safety conclusions

The approved-safe default is CesiumJS entities: Point station complexes, smaller Point entrances, and colored LineString/MultiLineString schematic route segments. Every feature carries a stable canonical ID, source record ID, registry entry, terms URL, attribution, license class, CRS, capture/update/observation timestamps, service date, schema version, and explicit uncertainty. Accessibility defaults to unknown; a static ADA/amenity field is not an outage or current step-free routing assertion.

The repository's production registry entries for MTA static, GTFS-Realtime, complexes, entrances, and amenities remain `pending`. The local adapter accepts only an explicitly supplied immutable file and an approved registry entry; pending entries fail before output creation. Synthetic fixture entries are approved `test-only` and are visibly labelled as not real Manhattan coverage.

## Approval questions

1. May the project download and retain a dated MTA static GTFS snapshot, and under what written terms may it redistribute normalized features, tiles, route colors, and source IDs?
2. May the project use MTA GTFS-Realtime with an API key, what rate limits/cache window apply, and is any live-derived state allowed in hosted/runtime output?
3. May the project retain and derive station-complex, entrance, and amenities layers from datasets `5f5g-n3cz`, `i9wp-a4ja`, and `6yjv-fk7g`, with their unspecified portal licenses and documented coordinate/ADA caveats?
4. Should accessibility be displayed only as a dated static source claim, with live elevator status and routing explicitly out of scope until a separately approved operational source exists?

## Exact post-approval command

After the first written approval, place the approved local snapshot at `data/approved/mta-transit-snapshot.geojson`, record its SHA-256 and terms metadata, then run (no URL or overwrite):

```sh
pnpm transit:ingest -- --input data/approved/mta-transit-snapshot.geojson --output data/normalized/mta-transit-<sha256-prefix> --checksum <64-hex-sha256> --ingested-at 2026-08-03T00:00:00Z
```

The registry entry must be changed from `pending` to `approved` by an authorized project decision before this command can write output; no provider is contacted by the command.
