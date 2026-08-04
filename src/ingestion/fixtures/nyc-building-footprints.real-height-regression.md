# OTI height regression subset

This committed two-record subset contains the authoritative raw OTI Building Footprints records for `DOITT_ID` 507159 (Flatiron) and 778052 (Empire State Building). It is a real-data regression fixture, not synthetic geometry; the complete pilot snapshot remains ignored under `data/raw/`.

- Source: NYC OTI GIS Building Footprints, dataset `jh45-qr5r`, [dataset page](https://data.cityofnewyork.us/City-Government/Building-Footprints-Map-/jh45-qr5r)
- Terms/attribution: NYC Open Data/agency terms; retain the source attribution and disclaimer recorded in the source registry.
- Snapshot capture: 2026-08-04; full input SHA-256 `cf311cd757564fe9cc75f8dc6a60d42c643bb402db4d811f448338ff5f6a18fb`.
- The source records publish `HEIGHT_ROOF` as feet-equivalent measurements for this pilot; ingestion converts them by `0.3048` and retains raw value/unit provenance.
- Official OTI metadata documents `GROUND_ELEVATION` as a NAVD88/LiDAR or photogrammetric elevation but does not publish its numeric field unit. The regression metadata therefore marks that unit `unknown`; ingestion preserves the raw value and leaves canonical `groundElevationMeters` null rather than guessing.
