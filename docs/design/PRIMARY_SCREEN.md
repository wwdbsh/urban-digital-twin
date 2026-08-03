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

## Setup-milestone deviations

The initial implementation intentionally uses only a local Cesium grid and a
generated Manhattan runtime marker. It does not use the photorealistic Manhattan
imagery shown in the concept because a data provider, license, and credential
have not been approved. The concept remains the target for the first sourced-data
milestone.
