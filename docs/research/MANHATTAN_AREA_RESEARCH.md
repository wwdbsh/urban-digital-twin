# Manhattan area and region research

**Evidence date:** 2026-08-03. This note uses current NYC DCP/NYC Open Data primary documentation only. No boundary record or export was queried, downloaded, cached, or copied; all runtime areas in this repository are invented fixtures.

## Label vocabulary and semantics

The UI and canonical schema use an explicit `areaSemantics` value and never display an NTA as “the neighborhood” without qualification:

| Vocabulary | Meaning in this product | Safe display label |
| --- | --- | --- |
| `statistical` | A geography designed for data reporting or demographic aggregation, such as a 2020 NTA, CDTA, or census tract. | “Statistical area” / “2020 NTA (statistical)” |
| `administrative` | A legally or charter-defined service/governance unit, such as a Community District/community board boundary or borough. | “Community District (administrative)” / “Borough boundary” |
| `planning` | A DCP planning product or study geography whose purpose and vintage must be shown. | “Planning area (release YYYY)” |
| `colloquial` | A human label or project search alias without an official boundary claim. | “Colloquial label; boundary not official” |

The terms “Flatiron,” “NoMad,” “Union Square,” and similar names may be search aliases or fixture names, but must not be rendered as universally accepted polygon boundaries unless an approved source explicitly provides that semantics.

## Official products

### 2020 Neighborhood Tabulation Areas (NTAs)

The canonical NYC Open Data product is [2020 Neighborhood Tabulation Areas (NTAs) - Mapped, dataset `4hft-v355`](https://data.cityofnewyork.us/d/4hft-v355). The official portal describes NTA boundaries as DCP-created small areas originally designed for population projections and now used for Decennial Census and ACS reporting; the source metadata explains that population-size constraints can combine historical neighborhoods in ways that would not result from a purely historical-neighborhood boundary exercise. Therefore NTA IDs/names and `MULTIPOLYGON` geometry are statistical labels, not statutory or universally accepted neighborhood borders.

The portal supports Socrata/API and export views; the exact export file, CRS, row count, and null behavior must be recorded from the approved dated snapshot rather than inferred from public visibility. The existing registry keeps `4hft-v355` pending and expected CRS `varies` pending snapshot metadata. NYC Open Data agency terms/disclaimer and DCP source attribution apply; the product does not grant an implicit universal redistribution license.

### Community Districts (`nycd`) and Community District Tabulation Areas (CDTAs)

The DCP [Community District metadata 26B](https://s-media.nyc.gov/agencies/dcp/assets/files/pdf/data-tools/bytes/nycd_metadata.pdf) identifies the official feature class as `nycd`, a shoreline-clipped polygon dataset used for Community District/community-board governance. The metadata states that Community Districts are mandated by the City Charter to review and monitor quality-of-life issues, distinguishes them from statistical approximations, and records 71 polygons including joint-interest areas. It documents an ESRI Shapefile distribution, source CRS EPSG:2263 (NAD83 / New York Long Island feet), quarterly maintenance, free public availability, and DCP's informational-only/no-warranty limitations.

For ACS-compatible statistical reporting, DCP's [Community District Tabulation Areas page](https://www.nyc.gov/content/planning/pages/resources/datasets/community-district-tabulation) says CDTAs closely approximate the 59 Community Districts, are formed by aggregating whole 2020 census tracts, and are released quarterly; the current page lists release 26B dated May 2026 and archives earlier quarterly releases. A CDTA must therefore be labeled `statistical`, never substituted silently for an administrative Community District. The page offers REST, GeoJSON, metadata, and downloadable files; record the selected release and CRS from its metadata at ingest.

### Borough boundaries

The [NYC Borough Boundary metadata 26B](https://s-media.nyc.gov/agencies/dcp/assets/files/pdf/data-tools/bytes/nybb_metadata.pdf) names the ArcGIS feature class `nybb`, with five Polygon features (`BoroCode`, `BoroName`, and shape fields), quarterly maintenance, ESRI Shapefile distribution, source EPSG:2263, and DCP attribution. It explicitly says `nybb` includes water areas and directs users needing shoreline-clipped boundaries to `nybbwi`; that distinction is material for a globe/runtime slice. Borough boundaries are administrative/geographic products, not neighborhoods or statistical NTAs.

### 2020 census tracts

The canonical portal product is [2020 Census Tracts, dataset `63ge-mke6`](https://data.cityofnewyork.us/City-Government/2020-Census-Tracts/63ge-mke6). Current portal metadata reports a DCP-provided 2020 Census/TIGER-derived product clipped to the shoreline, current version 26B, 2,325 rows, `MultiPolygon` geometry, `GEOID` plus borough/tract fields, and a May 26, 2026 update with quarterly update frequency. DCP notes that tracts under water are omitted when not partially or totally on land. Census tracts are statistical geographies, not administrative districts or colloquial neighborhoods.

The portal's license field is unspecified; the source link points to DCP's census-tracts resource page. The adapter therefore requires an approved snapshot-specific terms decision, attribution, CRS, release, and retention policy. Do not infer a license or retain raw/derived data solely because the Socrata page is public.

### Related products and boundaries

NYC Planning's [resources page](https://www.nyc.gov/content/planning/pages/resources) describes downloadable datasets and distinguishes neighborhoods, political districts, census tracts, and other planning geographies. The [2020 Census statistical geography overview](https://www.nyc.gov/content/planning/pages/planning/population) explains that NYC geographies were updated with the 2020 Census and that NTAs, CDTAs, tracts, and blocks serve different scales and relationships. DCP also publishes [community district profiles](https://www.nyc.gov/content/planning/pages/resources/datasets/community-district-tabulation) and other planning products; each must retain its own vintage and semantics. A colloquial label such as “NoMad” may be useful as an alias, but no official boundary should be invented from a name.

## Source decision table

| Registry entry | Role | IDs / geometry / CRS | Cadence and export | License, attribution, uncertainty | Decision |
| --- | --- | --- | --- | --- | --- |
| `nyc.nta-2020` / `4hft-v355` | Statistical | NTA ID/name, MultiPolygon; CRS varies until snapshot metadata | Portal/API/export; verify release at ingest | NYC Open Data/DCP terms and disclaimer; historical-neighborhood mismatch is explicit | Approved only for the 2026-08-04 local civic wave; use only as “2020 NTA (statistical)” |
| `nyc.community-districts` / `yfnk-k7r4`, feature class `nycd` | Administrative | Community District codes/names, Polygon; source EPSG:2263 | Quarterly DCP metadata; Shapefile | DCP attribution, informational/no-warranty; includes joint-interest areas | Pending; label “Community District (administrative)” |
| `nyc.cdta-2020` / release `CDTA-2020-26B` | Statistical | CDTA IDs/names, Polygon/MultiPolygon; release metadata controls CRS | Quarterly, REST/GeoJSON/metadata/download; latest cited 26B May 2026 | DCP attribution and informational limitations; only approximates CDs | Pending; never conflate with `nycd` |
| `nyc.borough-boundaries` / `nybb` | Administrative | Five Polygon boroughs; source EPSG:2263; `nybb` includes water, `nybbwi` shoreline variant | Quarterly DCP metadata; Shapefile | DCP attribution and disclaimer; shoreline treatment affects clipping | Pending; use as borough context, not neighborhood |
| `nyc.census-tracts-2020` / `63ge-mke6` | Statistical | GEOID, borough/tract fields, MultiPolygon; CRS varies until snapshot | Quarterly portal metadata; current version 26B, GeoJSON/API/export available | Portal license unspecified; DCP source/disclaimer and snapshot-specific legal review required | Pending; use for statistical search/context only |

## First adapter contract and uncertainty

The local adapter accepts only a supplied immutable GeoJSON `FeatureCollection` containing Polygon/MultiPolygon geometry. It preserves ring holes, multipart polygons, source IDs, area type/level, official name, optional labels, CRS normalization to WGS84, freshness, per-source terms/license/attribution, and a deterministic label point. Its clipping boundary is the project-documented Flatiron–NoMad–Union Square slice, not an official NYC boundary. Records outside the slice are rejected; intersecting rings are clipped and remain explicitly source-derived.

Production remains fail-closed for registry entries outside this wave. Before
any new approved ingest, confirm the precise release, source CRS (including
EPSG:2263 to WGS84 transformation), shoreline/water variant, export format,
file size/API limits, terms/retention/derivative rights, expected ID/name/null
behavior, and whether labels are official or aliases.

## Implemented DCP NTA civic wave (2026-08-04)

The recorded user approval now authorizes one dated local snapshot of DCP 2020
Neighborhood Tabulation Areas, base dataset `9nt8-h7nd`, mapped view
`4hft-v355`, filtered to Manhattan (`boroname=Manhattan` and `borocode=1`).
The capture was made on 2026-08-04 at 14:47:42.642Z; the source update metadata
was pinned at 2026-05-28T15:11:19.000Z before and after capture. The snapshot
contains 38 records, all accepted, with 0 rejected rows, 0 accounting remainder,
0 identity collisions, and 0 missing locations. The normalized and published
geometry is WGS84 (EPSG:4326), retaining MultiPolygon rings and source IDs.

This source is a statistical geography, not a definitive or exhaustive
vernacular neighborhood authority. The UI labels it exactly “2020 NTA
(statistical)” and does not infer neighborhood identity, current boundaries,
resident counts, amenities, or completeness. Raw response, metadata, headers,
checksums, terms/disclaimer, and release provenance are retained only in the
ignored local evidence roots; see the civic implementation record for exact
checksums and the approval fingerprint.
