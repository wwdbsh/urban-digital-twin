# Urban Digital Twin

Urban Digital Twin is a reusable React/TypeScript/Vite/CesiumJS web
application for inspecting source-backed city features. Manhattan is the first
city configuration; the application keeps platform contracts provider-neutral
so another city can supply its own adapters, identifiers, provenance, and
uncertainty.

## Current foundation

As of 2026-08-04 (Asia/Seoul), the repository contains three explicit data
modes:

- **Fixture catalog** — deterministic synthetic buildings, places, transit,
  routes, and place-truth records. It is visibly fixture-only and makes no
  real-Manhattan coverage claim.
- **Bounded real pilot** — the approved local `real-wave-20260804` release for
  the Flatiron/NoMad/Union Square envelope. It includes OTI building footprints,
  DOHMH inspection observations, and the bounded landmark package; ordinary
  buildings use source-backed procedural massing and unknown states remain
  explicit.
- **Citywide local release** — the explicitly selected
  `manhattan-citywide-20260804` snapshot-relative release. It streams local
  JSON geometry, search, and detail shards lazily; it does not contact a
  provider and it does not activate the three landmark GLBs.

The durable implementation record, exact manifests, audit matrix, validation
transcript, and remaining limitations are in
[`docs/codex/MANHATTAN_CITYWIDE_FOUNDATION_IMPLEMENTATION.md`](docs/codex/MANHATTAN_CITYWIDE_FOUNDATION_IMPLEMENTATION.md).
The delivery decision is [`Decision 0013`](docs/decisions/0013-manhattan-citywide-foundation-delivery.md).

## Prerequisites and setup

- Node.js `>=22.12.0`
- pnpm `11.15.1` (the version pinned in `package.json`)
- A browser with WebGL for the Cesium viewport

Install dependencies from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The default Vite development server is local. Open the URL printed by Vite and
use the **Data** panel to choose a mode. The default fixture mode is safe to
run from a fresh clone.

Useful deterministic checks are:

```sh
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm citywide:validate
pnpm citywide:benchmark
```

The citywide validator and benchmark are local, read-only checks. Acquisition,
normalization, build, and publish commands are not setup commands for a fresh
clone; they can create or replace ignored data and require a separately
approved operator workflow.

## Local-only citywide prerequisites

The raw snapshots, normalized artifacts, replay release, and published
citywide payload are ignored by Git. A fresh clone does **not** contain the
304,382,520-byte citywide payload and cannot truthfully claim citywide mode
until an authorized operator supplies the exact retained local evidence:

```text
data/raw/manhattan-citywide-20260804/
data/generated/manhattan-citywide-20260804/
data/generated/catalog/manhattan-citywide-20260804-replay-a/
public/data/manhattan-citywide-20260804/
```

The release manifest must remain checksum-pinned and must identify approval
`msg_91770ac6d098`. Do not download a replacement, call a provider from the
browser, or overwrite an existing immutable output as part of ordinary setup.
The exact source snapshots are:

| Source | Dataset | Capture / source update | Raw bytes | SHA-256 |
| --- | --- | --- | ---: | --- |
| NYC Office of Technology and Innovation GIS | `jh45-qr5r` | `2026-08-04T08:25:05.580Z` / `2026-08-02T02:17:27.174Z` | 41,739,923 | `52c841e388f8e56e6e3666d2ce8b6436ec10f9eeb2bbcad2b2452b51d58dafc7` |
| NYC Department of Health and Mental Hygiene | `43nn-pn8j` | `2026-08-04T07:41:56.726Z` / `2026-08-03T22:06:07.000Z` | 114,488,021 | `cb4cb6fce7a3744672882e63f2d3542674d7f76334d1a8aa2a7bfa76bd48b627` |

These approvals cover local OTI/DOHMH snapshot retention, derived local
spatial/search/detail artifacts, and local browser display only. They do not
authorize a public deployment, redistribution, a new provider, Google-derived
content, or unrelated data.

## Architecture

- `src/app/App.tsx` owns the mode switch, search, details, deep links, camera
  state, layer controls, and explicit failure/fallback messages.
- CesiumJS in `src/features/explorer/CesiumViewport.tsx` owns WGS84 globe
  positioning, camera behavior, rendering, and feature picking.
- `src/runtime/fixture-adapter.ts` is the deterministic synthetic adapter.
  `src/runtime/real-pilot-manifest.ts` loads the bounded pilot, while
  `src/runtime/citywide-release-runtime.ts` loads validated local citywide
  shards on demand.
- `src/ingestion/` contains provider-neutral validation and the approved OTI
  and DOHMH snapshot adapters. `src/data/source-registry.ts` keeps source IDs,
  terms, attribution, approval scope, freshness, retention, and uncertainty.
- The citywide release uses local JSON geometry/search/detail shards and stable
  parent IDs. It is not a deployed OGC 3D Tiles service; production 3D Tiles,
  hosting, CDN behavior, and public streaming are future approval gates.
- The three protected landmark assets are reusable GLB LOD packages for the
  bounded pilot only: Flatiron Building, Empire State Building, and Theodore
  Roosevelt Birthplace. Their manifest and six GLBs are immutable candidate
  deliverables; the `.blend` source checkpoints and screenshots are local
  evidence and are not runtime dependencies.

Cesium remains the sole world camera and picking authority. Three.js is not
needed by this foundation. Blender MCP is an offline authoring/inspection tool
for a separate asset work unit and was not used for this documentation task.

## Release facts

The `manhattan-citywide-20260804` manifest records snapshot-relative coverage:

- 45,194 accepted OTI building parents and 45,194 render parts.
- 109,386 accepted DOHMH inspection observations grouped into 12,439 CAMIS
  parents; 12,353 parents are located and 86 are unlocated.
- 103 geometry shards, 214 search shards, 134 detail shards, and 57,633 detail
  index entries.
- 304,382,520 declared bytes, zero accounting remainder, and zero identity
  collisions; the manifest also records a stable pilot replay.

The OTI source uses stable DOITT identity and preserves source height
provenance. Positive `HEIGHT_ROOF` values are feet-equivalent and converted to
meters; an unknown ground-elevation unit remains source-only. A footprint
extrusion is massing, not a facade-accurate building. A DOHMH grade/action is
inspection history, not a consumer rating, review, current opening state, or
complete business directory. Unlocated CAMIS parents remain searchable and
detail-addressable without invented geometry.

## Accessibility and performance evidence

The current UI has keyboard combobox/listbox behavior, focus-aware viewport
keyboard controls, visible layer/data controls, and a responsive 390×844 layout
path. Reduced-motion handling exists in the camera journey code, but this
documentation does not claim that the connected browser forced and observed the
enabled media-query path. Browser console/network evidence and exact current
benchmark output are recorded in the implementation record; deterministic
tests are not a substitute for visual, accessibility, or device-performance
validation. The accepted CP5 focused-page `requestAnimationFrame` probe used a
3-second settle and 340 frames (median 8.3 ms, p95 16.6 ms). The unchanged
seven-anchor harness emitted 11 frames over about 1008 ms per anchor; that is a
known validation issue, not a product-frame result.

## Overlay interaction behavior (2026-08-05)

The desktop map owns the complete main region between the 60 px top bar, the
navigation rail, and the status bar. Opening or closing feature details does not
add or remove a grid track: the warm-white inspector is an absolute, scrollable
overlay inside that map region. At mobile widths the same inspector becomes a
scrollable bottom sheet, so the map remains the underlying navigation surface.

Every locatable selection path (Cesium pick, search, deterministic overlap
choice, related entity, nearby transit, or saved-place restore) goes through one
selection/focus transaction. The transaction opens or updates details and owns
one camera focus request; source records explicitly marked locationless remain
selectable and open details without a camera flight. Focus accounts for the
inspector occlusion so the selected feature is settled toward the unobscured
visual center. URL feature and camera state, source IDs, release semantics, and
unknown/provenance wording remain unchanged.

Diagnostics, directions, and layer controls start as compact accessible launchers.
Diagnostics and directions are mutually exclusive when expanded, while the
responsive placement policy keeps expanded surfaces clear of the camera,
inspector, and category controls. Dense civic and overview rendering suppresses
unselected label clutter but keeps the selected feature's highlight and label
feedback; geometry and Cesium picking remain available for all visible records.

## Known limitations

- Raw/generated `data/**`, ignored `public/data/**`, and local validation
  evidence are not part of a fresh clone or the documentation commit.
- The citywide renderer is JSON/shard based, not a deployed 3D Tiles service;
  there is no public hosting, CDN, production tile endpoint, or redistribution
  claim.
- Buildings are footprint massing with source or unknown fallback heights, not
  verified facades, interiors, entrances, roofs, imagery, or photorealism.
- Citywide mode does not activate the three protected landmark GLBs; verified
  landmark integration is bounded-pilot behavior.
- Real neighborhoods, parks, shops beyond DOHMH restaurant observations,
  attractions beyond the bounded assets, transit, routing, hours, live status,
  reviews, ratings, photos, street imagery, traffic, and pedestrian/street-level
  experience are not implemented. Transit and directions in the fixture mode
  are synthetic.
- Unknown-release and unknown-parent failure behavior is covered by code and
  deterministic tests. Browser interception for corrupted payloads was not
  available, so that case is not claimed as a browser journey.
- Prior exploratory frame captures contain outliers/camera drift. Only the
  fixed benchmark and final evidence in the implementation record support
  performance statements.
- Source timestamps are capture/source-update observations, not guarantees of
  present real-world state. No City endorsement or completeness/fitness
  warranty is implied.

## Provenance and future work

The current approved source boundary is deliberately narrow. OTI and DOHMH
remain local-only and source-labelled. The 2026-08-04 civic-context wave adds
dated local DCP NTA, NYC Parks, and LPC records under its recorded approval;
MTA, OSM, Overture, Google, paid services, and public deployment remain
separately gated. Do not contact any other provider or add data without a new
documented approval and work unit.

See [`docs/codex/AGENT_WORKFLOW.md`](docs/codex/AGENT_WORKFLOW.md) for the
current visible-agent/review workflow, and the research/decision documents for
historical planning provenance and source-specific uncertainty.

## Current civic-context local release (2026-08-04)

The app now exposes one immutable local sibling release,
`manhattan-civic-context-20260804`, in addition to the existing citywide and
fixture modes. It streams generic v2 statistical-area, Parks property, and LPC
landmark-record layers through Cesium, with source-ID/name search, source-typed
details, deterministic overlap choices, URL layer/facet state, cold deep links,
local bookmarks pinned to the release, and per-layer failure isolation. The
release is local-only; it is not a public deployment or a claim of complete
neighborhood, park, landmark, access, hours, amenity, facade, rating, review,
or transit coverage.

The recorded approval is
`codex-user-turn:2026-08-04:manhattan-civic-context-local-v1` with canonical
scope SHA-256
`7860f0c6c867488935443df1f1f1bb6fefa950646fa7cd1cd32d5a3d0c1eda58`.
The retained local source snapshots are DCP NTA `9nt8-h7nd` (mapped view
`4hft-v355`), NYC Parks Properties `enfh-gkve`, and LPC designated/calendared
sites `ncre-qhxs`; source attribution, NYC Open Data terms, the City modified-
data disclaimer, capture/update dates, and uncertainty are preserved in the
release details and evidence record.

Captured input was 38 NTA records, 395 Parks records, and 15,313 LPC
observations. Normalization accepted all observations with zero rejected rows,
zero accounting remainder, and zero identity collisions; LPC grouping yielded
1,140 parent records, including 10 records without a usable location that are
retained as detail/search data but are not placed on the map. The published
release contains 22,424,795 declared bytes, 114 geometry shards, 307 search
shards, 52 detail shards, and 1,573 detail-index entries; its deterministic
benchmark passes the 40 MiB incremental budget (latest local run: cold search
p95 10.90 ms, warm search p95 9.91 ms, cold detail p95 0.23 ms).

For local validation and replay, use the aliases in `package.json`, for example:

```sh
pnpm travel-context:validate:raw -- --input data/raw/travel-context-wave-20260804 \
  --approval-id codex-user-turn:2026-08-04:manhattan-civic-context-local-v1 \
  --approval-fingerprint 7860f0c6c867488935443df1f1f1bb6fefa950646fa7cd1cd32d5a3d0c1eda58
pnpm travel-context:validate -- --root public/data/manhattan-civic-context-20260804
pnpm travel-context:benchmark -- --root public/data/manhattan-civic-context-20260804
```

Raw, normalized, generated, and browser-capture payloads are ignored local
evidence and intentionally excluded from staging/commit; the browser may
request only immutable app-origin files. The complete checksums, metadata
pins, browser journeys, protected-hash proof, documentation matrix, rollback
target, and remaining limitations are recorded in
[`docs/codex/MANHATTAN_TRAVEL_CONTEXT_IMPLEMENTATION.md`](docs/codex/MANHATTAN_TRAVEL_CONTEXT_IMPLEMENTATION.md)
and [Decision 0014](docs/decisions/0014-nyc-civic-context-wave.md).
