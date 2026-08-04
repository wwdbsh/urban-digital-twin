# Primary screen design specification

Accepted concept: `docs/concepts/primary-desktop.png`
Native size: 1586 × 992
Generated: 2026-08-03 using the built-in Image Gen tool

## Direction

The city is the product. A full-bleed geospatial canvas owns most of the screen,
while compact navigation and a warm-white inspector support search, layers,
selection, and provenance. The interface is an editorial GIS tool, not a game or
science-fiction dashboard.

## Layout inventory

- 60 px graphite top bar: brand, centered search, Data and Time controls.
- 92 px graphite navigation rail: Explore, Layers, Bookmarks, Help, Settings.
- Flexible CesiumJS canvas: dominant area, oblique city view, cyan selection.
- 390 px warm-white inspector: selected feature, overview, sources, actions.
- 44 px graphite status bar: city, delivery format, data status.
- Mobile continuation: canvas stays full-screen and inspector becomes a bottom
  sheet; the desktop navigation rail is removed.

## Design tokens

| Token | Value |
|---|---|
| Chrome background | `#0d151b` |
| Chrome elevated | `#18242a` |
| Inspector background | `#f7f8f7` |
| Primary dark text | `#141719` |
| Muted light text | `#aab8be` |
| Divider dark | `#28343b` |
| Divider light | `#cfd5d6` |
| Selection accent | `#42d8df` |
| Warning/pending | `#d5a94e` |
| Radius | 6–8 px |
| Base spacing | 8 px |

Typography uses a neutral system sans-serif with compact 11–14 px controls,
15–16 px section and brand labels, and a 21–27 px inspector title. Surfaces use
thin borders and almost no shadow.

## Component families

- `AppShell`: fixed grid and responsive mobile stack.
- `TopBar`: brand, search form, quiet utility buttons.
- `NavigationRail`: icon/label actions with one cyan active indicator.
- `CesiumViewport`: real WebGL canvas; never substitute the concept image.
- `Inspector`: open divider sections rather than nested cards.
- `ProvenanceLegend`: authoritative, derived, and generated states.
- `StatusBar`: current city, stream format, and data freshness state.

## Interaction contract

- Search focuses known supported features.
- Selecting rendered geometry opens or updates the inspector.
- Focus flies the camera to the selected feature.
- Layers and navigation have visible selected states.
- Generated placeholder geometry is labeled as generated and never presented as
  authoritative.
- Compare remains disabled until two compatible sourced records exist.

## Current implementation (2026-08-04)

The running screen now supports three explicit data modes through the Data
panel: synthetic fixture, bounded real OTI/DOHMH pilot, and the local
`manhattan-citywide-20260804` OTI/DOHMH release. The search combobox, result
listbox, Cesium pick, detail/provenance panel, layer controls, deep links,
camera controls, and failure notices use stable feature IDs. Citywide mode
loads viewport geometry and global search/detail shards lazily; its status text
states that the release is local snapshot-relative and that no provider,
imagery, live routing, or public deployment is connected.

The responsive layout keeps the full-bleed Cesium canvas and turns the desktop
inspector/navigation into a mobile continuation. Keyboard focus behavior,
visible controls, and source/unknown wording are runtime behavior; the concept
PNG below remains design direction, not a screenshot or proof of visual
fidelity. The three protected landmark GLB pairs are shown only by the bounded
pilot; ordinary and citywide buildings remain procedural footprint massing.

Remaining design gaps are real neighborhoods/parks/shops/attractions beyond
the approved records, transit, routing, live status, hours, reviews, ratings,
photos, street imagery, traffic, facades, photorealism, public hosting, and
production 3D Tiles delivery.

## Setup-milestone deviations (historical, 2026-08-03)

The initial implementation intentionally used only a local Cesium grid and a
generated Manhattan runtime marker. It did not use the photorealistic Manhattan
imagery shown in the concept because a data provider, license, and credential
had not been approved. That statement describes the setup checkpoint; the
current bounded/citywide local OTI/DOHMH modes are documented above and do not
claim photorealism or public imagery.

## Civic-context controls and accessibility (2026-08-04)

The current Explore surface also supports the immutable local
`manhattan-civic-context-20260804` release. Runtime layer controls expose
Statistical areas, Parks, and Landmark records independently; civic facets filter
the same record kinds and persist in `layers`/`facets` URL state. Search results
show the source type and match method, and details retain the canonical source
ID, source relationship, dates, attribution, uncertainty, and explicit unknowns.

Cesium pointer picks use WGS84 geometry and a deterministic drill-pick ordering.
When records overlap, the UI presents an accessible chooser rather than silently
selecting the first hit. Search and detail selections update cold-loadable URLs;
Back/Forward and release-pinned bookmarks never substitute a fixture or a
same-name record when a civic detail is missing.

The mobile layout remains usable at 390x844: controls are semantic buttons,
search is a combobox/listbox, details are keyboard reachable, Escape closes the
inspector, and focus returns to the triggering control or search input. The
layout honors the existing reduced-motion CSS behavior. Civic layer faults are
announced as isolated status messages and leave unaffected sources searchable;
no provider-domain requests are made by the browser.
