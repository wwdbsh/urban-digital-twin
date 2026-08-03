# NYC Building Footprints: dated adapter evidence

**Evidence checked:** 2026-08-03 (UTC)
**Scope:** official City of New York / NYC Office of Technology and Innovation (OTI) sources only. No NYC record was downloaded or queried for this note.

## Canonical source and release behavior

The current public catalog page is [Building Footprints (Map), dataset `jh45-qr5r`](https://data.cityofnewyork.us/City-Government/Building-Footprints-Map-/jh45-qr5r). The page identifies the dataset as NYC building footprint outlines, exposes a polygon map plus a centroid-point companion layer, and showed “Updated July 18, 2026” and 1,082,974 rows when checked. The stable machine-readable identifier recorded in the registry is therefore `jh45-qr5r`; older references to `5zhs-2jue` or `nqwf-w8eh` are not used as the first adapter target without a separate identity check.

The City-maintained [Building Footprints metadata](https://github.com/CityOfNewYork/nyc-geo-metadata/blob/main/Metadata/Metadata_BuildingFootprints.md) is dated 2025-10-09. It says OTI staff update features daily and release them publicly weekly, while its “Publication Dates” row says “Last Update: Weekly.” The portal’s July 18, 2026 page timestamp and the metadata’s daily-edit/weekly-release wording are different clocks, not a precise snapshot release timestamp; an ingest must record the exact downloaded release/capture metadata and retain this uncertainty.

The metadata says the dataset covers New York City and is publicly accessible through NYC Open Data and NYCMaps. It lists multiple download/service paths: NYCMaps GeoJSON and file geodatabase links are documented at EPSG:4326 in the table, while shapefile/service paths are shown at EPSG:3857; the NYC Open Data shapefile and GeoJSON links are both shown at EPSG:4326. The table’s formatting makes one NYCMaps file-geodatabase row appear as EPSG:4326 and another as EPSG:3857, so the adapter deliberately accepts an explicitly recorded GeoJSON CRS and chooses EPSG:4326; it does not infer a CRS from a filename or portal label.

The current page’s preview displays WKT beginning with `MULTIPOLYGON`, whereas the metadata describes the geometry type as polygon and the `SHAPE` field as a single outer polygon ring. This is a portal/export representation mismatch, not evidence that holes or multipart geometry can be discarded. The adapter accepts GeoJSON `Polygon` and `MultiPolygon`, preserves all rings, clips each part to the documented slice, and emits an explicit rejection when geometry is invalid.

The official [NYC Open Data overview and terms](https://opendata.cityofnewyork.us/overview/) state that users agree to NYC.gov terms, privacy policy, and any additional agency terms; datasets are informational and carry no City warranty for completeness, accuracy, content, or fitness. The submitting agency remains authoritative and may update, correct, or refresh datasets at any time. The registry remains `pending`: public visibility is not treated as prior approval for retaining raw files or shipping derivatives.

## Field contract used by the adapter

| Official field | Adapter meaning and behavior |
| --- | --- |
| `DOITT_ID` | OTI-consistent unique identifier. Required and used as the source-record ID and canonical-ID input. The metadata explicitly says to use it instead of synthetic `OBJECTID`. |
| `OBJECTID` | Synthetic internal key. Accepted only as an uninterpreted attribute if present; never used for identity. |
| `BIN` | Building Identification Number. Preserved as text. The first digit is the borough code; “million BINs” such as `1000000` indicate unassigned/unknown and BIN is not globally unique. It is not substituted for `DOITT_ID`. |
| `BASE_BBL` | Physical tax lot BBL associated with the footprint. Preserved as text; the metadata warns that temporary synchronization can associate a building with a different lot or no property-tax lot. |
| `MAPPLUTO_BBL` | BBL used for joining to MapPLUTO, especially condominium billing-BBL semantics. Preserved separately from `BASE_BBL`; it is not a building identity. |
| `GROUND_ELEVATION` / `GROUNDELEV` | Lowest elevation at building ground level, calculated from LiDAR or photogrammetry. Official metadata says modern/photogrammetric values use NAVD88. Retained as an attribute; it is not silently added to roof height. |
| `HEIGHT_ROOF` / `HEIGHTROOF` | Roof height above ground, explicitly not height above sea level. Zero or NULL means unavailable. A positive numeric value becomes the extruded height with `method: source`; missing/zero becomes `valueMeters: null`, `method: unknown`. Negative, non-finite, or non-numeric values reject the record. |
| `CONSTRUCTION_YEAR` / `CNSTRCT_YR` | Completed construction year. Zero/NULL means unavailable. Preserved as an attribute and never used to infer height. |
| `FEATURE_CODE` / `FEAT_CODE` | Official type code, including building, placeholder, skybridge, garage, and under-construction values. Preserved as an attribute; the first adapter emits the records as `building` features and does not claim every code is a conventional building. |
| `GEOM_SOURCE` | `Photogrammetric` indicates the highest stated positional quality; `Other (Manual)` is less accurate. The adapter records this source, gives photogrammetric geometry the documented ~0.6096 m horizontal uncertainty, and leaves roof-height uncertainty null because no numeric roof-height error was published. |
| `LAST_EDITED_DATE` / `LSTMODDATE` | Source feature modification date; preserved as a source attribute when present. Snapshot-level freshness comes from recorded metadata, not a fabricated current time. |
| `LAST_STATUS_TYPE` / `LSTSTATTYPE` | Status such as Constructed, Demolition, Alteration, or Geometry. Preserved as source text. |
| `NAME` | Limited building name; metadata says it has not been actively maintained since the original dataset. It is display text only, with `DOITT_ID` remaining authoritative for identity. |
| `SHAPE` / GeoJSON geometry | Footprint outline. Source metadata describes a State Plane/NAD83 US-foot collection system and published variants; this adapter requires explicit snapshot metadata and normalizes EPSG:4326 GeoJSON (or explicitly recorded EPSG:3857) to WGS84. |

The metadata says features include buildings over 400 square feet and taller than 12 feet, plus agency-maintained BIN structures. Interior divisions, temporary trailers/tents, movable jet bridges, awnings, scaffolds, and sidewalk sheds are excluded. Placeholder triangles and dummy BINs can exist, so visual footprint plausibility must not be promoted to factual building semantics.

## Adapter and fixture decisions

`NycBuildingFootprintsSnapshotAdapter` is in `src/ingestion/nyc-building-footprints.ts`. It is offline-only and requires:

1. Explicit local GeoJSON text containing a `FeatureCollection`.
2. A recorded SHA-256 checksum that matches the exact supplied bytes.
3. Snapshot metadata explicitly marked `immutable: true`, plus the registry terms URL and attribution recorded with the snapshot.
4. Explicit input CRS, release/capture/update timestamps, vertical-datum wording, and ingestion timestamp.
5. An `approved` `nyc.building-footprints` registry entry. The repository entry is intentionally still `pending`, so production construction fails closed.

`Polygon` and `MultiPolygon` source records are validated, reprojected to WGS84, clipped against the documented Flatiron–NoMad–Union Square rectangle, and represented as one or more canonical `Feature` records. Multipart parts receive deterministic `:part-###` suffixes while every part retains the same `DOITT_ID`, BIN, BBL fields, source reference, freshness, license reference, and height provenance. No height is fabricated when `HEIGHT_ROOF` is zero/NULL. Rejection reports account for every input record, including invalid height, invalid geometry, and records outside the slice; layer manifests count normalized output features.

The clearly invented fixture is [`nyc-building-footprints.schema.fixture.geojson`](../../src/ingestion/fixtures/nyc-building-footprints.schema.fixture.geojson). Its IDs and names are synthetic and it is marked fixture-only; it must not be described as Manhattan coverage.

## Exact approval and post-approval command

Approval is required for: (a) downloading and retaining one immutable NYC Building Footprints GeoJSON snapshot, (b) accepting the NYC Open Data/agency terms and disclaimer for derived normalized features and tiles, and (c) recording its exact release, capture, update, CRS, vertical-datum, checksum, and retention decision in the registry.

After approval, update only `nyc.building-footprints.approval` to the approved scope and place the authorized snapshot at a local path. Then run:

```sh
pnpm nyc:building-ingest -- \
  --input /absolute/path/nyc-building-footprints.geojson \
  --output /absolute/path/artifacts/nyc-building-footprints/<release-id> \
  --checksum <64-hex-sha256> \
  --terms-url https://opendata.cityofnewyork.us/overview/ \
  --input-crs EPSG:4326 \
  --release <ISO-or-null> \
  --capture <ISO-or-null> \
  --updated <ISO-or-null> \
  --ingested-at <ISO-8601> \
  --vertical-datum 'NAVD88 for documented GROUND_ELEVATION; HEIGHT_ROOF relative to source ground'
```

The CLI writes manifest, normalized features, and a building layer manifest with exclusive-create semantics and refuses to overwrite existing outputs. It never contacts NYC Open Data or any other network service; adding later PLUTO/POI/terrain adapters remains a separate approval and evidence task.
