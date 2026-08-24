# Public-realm licensing evidence and source selection (T001)

Task: `manhattan-citywide-public-realm` T001 (Issue #130).
Verified: 2026-08-24, via live browser session (NYC pages block automated
fetch with 403) plus web research. Quotes are verbatim from the cited pages
as read on that date.

## 1. NYC Open Data terms (governs Planimetrics, Hydrography, Plazas)

The legacy URL `nyc.gov/html/data/terms.html` cited in older project research
is dead ("You have reached an outdated or non-existing page"). The current
authoritative text lives on the portal.

**NYC Open Data Terms of Use** — <https://opendata.cityofnewyork.us/overview/>:

> "By accessing datasets and feeds available through NYC Open Data, the user
> agrees to all of the Terms of Use of NYC.gov as well as the Privacy Policy
> for NYC.gov. The user also agrees to any additional terms of use defined by
> the agencies, bureaus, and offices providing data. Public data sets made
> available on NYC Open Data are provided for informational purposes. The
> City does not warranty the completeness, accuracy, content, or fitness for
> any particular purpose or use of any public data set made available on NYC
> Open Data, nor are any such warranties to be implied or inferred with
> respect to the public data sets furnished therein."
>
> "Submitting City Agencies are the authoritative source of data available on
> NYC Open Data. These entities are responsible for data quality and retain
> version control of data sets and feeds accessed on the Site. Data may be
> updated, corrected, or refreshed at any time."

**NYC Open Data FAQ** — <https://opendata.cityofnewyork.us/faq/>:

> "Are there restrictions on how I can use Open Data?
> Open Data belongs to all New Yorkers. There are no restrictions on the use
> of Open Data. Refer to Terms of Use for more information."

**Incorporated NYC.gov Terms of Use** —
<https://www.nyc.gov/main/terms-of-use>, Section IV (Intellectual Property):

> "All other design, information, text, graphics, images, pages, interfaces,
> links, software, and other items and materials contained in or displayed on
> NYC.gov, and the selection and arrangements thereof, are the property of
> the City of New York. All rights are reserved."

Interpretation recorded for this project (not legal advice): the portal's
dataset-specific terms ("no restrictions on the use of Open Data") govern
dataset use; the NYC.gov IP clause governs the website's own design/content.
The project's existing posture already assumes the conservative reading:
local-only retention, derived rendering with attribution, **no public
deployment, no redistribution** (see `MANHATTAN_CIVIC_APPROVAL_EVIDENCE` and
`BLOCK835_PUBLIC_REALM_APPROVAL_EVIDENCE` in `src/data/source-registry.ts`).
Under that posture, every reading above permits the planned use. Any future
public deployment decision must revisit this section.

**Go/no-go: GO** for local-only ingestion of Planimetrics (Roadbed
`xgwd-7vhd`, Sidewalk `vfx9-tbb6`, Pavement Edge `x9uq-u3qs`), Hydrography,
and DOT Pedestrian Plazas, with NYC Open Data attribution, the City
modified-data disclaimer, and capture/update dates preserved.

## 2. Water source confirmation

- **NYC Planimetric Database: Hydrography** — dataset id **`pjs3-c3z5`**
  (<https://data.cityofnewyork.us/d/pjs3-c3z5>), last updated 2025-12-11 per
  the portal catalog. An older vintage (last updated 2024-04-26) and a
  separate "Hydrography Structures" layer exist; the current Hydrography
  polygon layer is the T002 registration target. Capture rules:
  <https://github.com/CityOfNewYork/nyc-planimetrics/blob/master/Capture_Rules.md>.
- Cross-check: shoreline-clipped borough boundary (already registered) for
  coastline validation only, not as a rendered class.

## 3. Plaza/open-space boundary source selection

| Attribute | DOT Pedestrian Plazas (Polygon) | DCP POPS |
|---|---|---|
| Dataset | **`k5k6-6jex`** | `qeta-4kqg` (map) |
| Geometry | Multipolygon | Point (no verified polygon boundaries) |
| Times Square | Yes — operated as 6 DOT plazas (Broadway 41st–47th) | No — POPS are zoning-bonus private spaces, unrelated |
| Cadence | Monthly (last updated 2025-01-09) | As needed (2024-06-13) |

**Selected: NYC DOT Pedestrian Plazas Polygon `k5k6-6jex`**
(<https://data.cityofnewyork.us/Transportation/NYC-DOT-Pedestrian-Plazas-Polygon/k5k6-6jex>).
Rationale: only candidate with polygon geometry and direct Times Square
coverage (DOT program page:
<https://www.nyc.gov/site/cecm/permitting/times-square.page>). POPS is **not
selected**; it is point-based and irrelevant to the Goal's named-place set.
A future privately-owned-plaza feature class may revisit POPS separately.

## 4. Orthoimagery license and vintage

**NYC's own metadata declares the license.** NYC OTI aerial-imagery metadata
(<https://github.com/CityOfNewYork/nyc-geo-metadata/blob/main/Metadata/Metadata_AerialImagery.md>):

> "**Use Limitations** | CC BY 4.0. See Terms of Use
> (https://creativecommons.org/licenses/by/4.0/legalcode)
> **Access Rights** | Public"

Same document, 2024 row: 6-inch resolution, New York City coverage, captured
March 14–24, 2024, "Full true orthoimagery", color-infrared available. The
imagery source is the New York State Statewide Digital Orthoimagery Program.

**Download channel (file-based, no credentials):** NYS GIS NYC downloads page
(<https://gis.ny.gov/new-york-city-orthoimagery-downloads>) lists Manhattan
zips for 2006–2024. 2024 Manhattan URL verified in-browser:
`https://gisdata.ny.gov/ortho/nysdop12/new_york_city/spcs/zips/boro_manhattan_sp24.zip`.
This resolves the earlier vintage uncertainty: **2024 Manhattan is
downloadable; select the 2024 vintage.**

**Honest gap.** NYS FGDC metadata for the 2024 NYC vintage was not located as
a standalone page. Older vintages (2001–2010) carry this boilerplate
(<https://www.orthos.dhses.ny.gov/content/metadata/2010/2010-6-inch-Resolution-4-band-Orthoimagery-Long-Island-Zone.htm>):

> "Access_Constraints: Some imagery tiles are classified and are only
> available to the public through a separate request procedure."
> "Use_Constraints: Use of sensitive imagery, if granted, is only for the use
> specified in the request."

This concerns classified/withheld tiles, not use restrictions on publicly
downloadable tiles. T004 must inspect the metadata shipped inside the 2024
zip before ingestion and record it; if it contradicts CC BY 4.0 for the
public tiles, stop and re-decide.

**Go/no-go: GO** for 2024 6-inch Manhattan orthoimagery under CC BY 4.0
obligations: attribution to NYC OTI / NYS Statewide Digital Orthoimagery
Program, capture-window display (March 2024), local-only retention consistent
with the project posture.

## 5. NAIP fallback rule

USGS/USDA NAIP is public domain with no use restrictions
(<https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-national-agriculture-imagery-program-naip>),
~60 cm–1 m resolution. **Trigger conditions for falling back to NAIP:**

1. The 2024 zip's embedded metadata imposes use constraints incompatible with
   local rendering plus attribution; or
2. the gis.ny.gov/gisdata.ny.gov download is unavailable or fails integrity
   verification; or
3. the user declines the CC BY 4.0 obligations at the T004 gate.

Fallback consequence recorded honestly: resolution drops from 6 inch to
~60 cm–1 m and park/plaza texture recognizability degrades accordingly.

## 6. Downstream registration targets (for T002)

| Layer | Dataset | Id | License basis |
|---|---|---|---|
| Water | NYC Planimetric Database: Hydrography | `pjs3-c3z5` | NYC Open Data terms (§1) |
| Plazas | NYC DOT Pedestrian Plazas Polygon | `k5k6-6jex` | NYC Open Data terms (§1) |
| Ortho | NYC 2024 orthoimagery, Manhattan borough zip | `boro_manhattan_sp24.zip` | CC BY 4.0 (§4) |
| Roads/sidewalks | Already registered (`xgwd-7vhd`, `vfx9-tbb6`, `x9uq-u3qs`) | — | NYC Open Data terms (§1); citywide clip needs the new envelope |

All acquisitions remain gated behind the T003/T004 user-approved envelopes;
nothing was downloaded during T001.
