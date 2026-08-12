# Urban Digital Twin

Urban Digital Twin is a reusable React/TypeScript/Vite/CesiumJS web
application for inspecting source-backed city features. Manhattan is the first
city configuration; the application keeps platform contracts provider-neutral
so another city can supply its own adapters, identifiers, provenance, and
uncertainty.

## Current foundation

As of 2026-08-05 (Asia/Seoul), the repository contains four explicit data
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
- **Civic composition** — the canonical
  `manhattan-civic-context-20260804` URL/runtime root, composed over the
  civic manifest's exact `baseReleaseId`, `manhattan-citywide-20260804`. It
  shows citywide procedural footprint/height massing beneath statistical
  areas, Parks properties, and LPC records with mixed search/detail/picking;
  bounded-pilot GLBs remain inactive.

The durable implementation record, exact manifests, audit matrix, validation
transcript, and remaining limitations are in
[`docs/codex/MANHATTAN_CITYWIDE_FOUNDATION_IMPLEMENTATION.md`](docs/codex/MANHATTAN_CITYWIDE_FOUNDATION_IMPLEMENTATION.md).
The delivery decision is [`Decision 0013`](docs/decisions/0013-manhattan-citywide-foundation-delivery.md).
The runtime composition decision is [`Decision 0015`](docs/decisions/0015-manhattan-civic-runtime-composition.md), with its evidence in
[`MANHATTAN_CIVIC_RUNTIME_COMPOSITION_IMPLEMENTATION.md`](docs/codex/MANHATTAN_CIVIC_RUNTIME_COMPOSITION_IMPLEMENTATION.md).

## Stage 3 block 835 exterior/commercial overlay (2026-08-05)

The optional local-only Stage 3 overlay is an additive sibling of the
citywide/civic releases. It is enabled explicitly, without relabelling the
base release, for example:

```text
/?data=citywide&release=manhattan-civic-context-20260804&exterior=manhattan-esb-block-exterior-pilot-20260805&commercial=1
```

The release contains exactly the 14 OTI parents in NYC tax block 835 and 28
per-building GLBs (LOD0/LOD1). Empire State Building (`doitt:778052`) and
Herald Towers (`doitt:131170`) carry licensed-near-real claims only for the
visible evidence-backed portions; the other twelve are
source-constrained massing with explicitly estimated general/storefront
geometry. The commercial layer has eight neutral text-only signs, 144
metadata-only records, 12 ambiguous candidates, and 72 unknown candidates;
unknown or ambiguous occupants never become signs or pick proxies.

NYC OTI, DOHMH, AddressPoint, and DCWP records remain in the independent NYC
partition. OSM-derived observations and association edges are isolated in the
ODbL 1.0 partition, with visible `OpenStreetMap` attribution and the exact
local query/response retained for reproducibility. No Google content, external
textures/fonts/logos, provider request, or runtime network access is used.
The source packet, evidence matrix, Blender/browser validation paths, and
remaining limitations are recorded in
[`docs/implementation/20260805-stage3-commercial-frontage.md`](docs/implementation/20260805-stage3-commercial-frontage.md)
and [`Decision 0016`](docs/decisions/0016-stage3-commercial-frontage.md).

The bounded validation aliases are:

```sh
pnpm exterior-pilot:validate:raw -- --raw-root data/raw/manhattan-esb-block-commercial-20260805
pnpm exterior-pilot:validate -- --root public/data/manhattan-esb-block-exterior-pilot-20260805
pnpm exterior-pilot:benchmark -- --root public/data/manhattan-esb-block-exterior-pilot-20260805
```

## Block 835 public-realm overlay (2026-08-06)

The approved public-realm work unit is an opt-in, local-only sibling overlay
for the Block 835 roadbed, sidewalks, estimated curb profiles, and estimated
crosswalks. Its canonical compatible local URL is
`/?data=citywide&release=manhattan-civic-context-20260804&exterior=manhattan-esb-block-exterior-pilot-20260805&commercial=1&publicRealm=manhattan-esb-block-public-realm-20260806`.
Append `&publicRealmFeature=crosswalk%3Aw33-broadway` for a verified deep link.
A bare `publicRealm` query deliberately does not activate the overlay: runtime
activation requires both a real compatible base and the active Stage 3
exterior/commercial overlay. Buildings and accepted storefronts remain
independently selectable and the runtime status surface can disable only this
overlay.

The release is built from exactly NYC OTI Planimetrics Sidewalk `vfx9-tbb6`,
Roadbed `xgwd-7vhd`, and Pavement Edge `x9uq-u3qs`, clipped to the Block 835
union plus four adjacent approaches. Roadbed/sidewalk geometry is
source-backed; curb vertical profile and crosswalk placement/striping are
deterministic estimates and are not current-paint or survey-grade truth. The
loader is fail-closed, verifies local SHA-256-pinned JSON/GLB content, uses
only Cesium WGS84/ENU positioning, and never performs runtime external
requests. See [`Decision 0017`](docs/decisions/0017-block835-public-realm.md)
and [`20260806-block835-public-realm.md`](docs/implementation/20260806-block835-public-realm.md)
for the source packet, bounds, hashes, Blender MCP evidence, corrected
hole/concavity-preserving triangulation validation, and validation limits.

The Stage 3 runtime and source payloads remain local-only, and public
deployment, hosting, redistribution, and other public conveyance remain
excluded. The local-runtime implementation is validated by the recorded
checks below. The 2026-08-06 approval
`codex-user-turn:2026-08-06:stage3-private-repo-commit-push-approval` authorizes
this separately authorized release task to commit and push this work unit to
the existing private GitHub repository only. It does not expand the original
2026-08-05 acquisition approval, whose commit/push exclusions may remain as the
scope of that acquisition request; public deployment or conveyance still
requires separate approval.

Focused external-browser performance evidence was captured in one visible,
focused Google Chrome session against the unchanged local Vite PID 19129. The
same six-pose deterministic path settled for 1 second and collected 600
`requestAnimationFrame` samples per condition at 1721×878 CSS pixels / DPR 2:
Stage 3-only measured 8.30 ms median, 9.20 ms p95, and 24.90 ms maximum;
Stage 3 plus public realm measured 8.30 ms median, 8.90 ms p95, and 17.50 ms
maximum. The overlay p95 delta was -0.30 ms (-3.26%), so the required median
≤12 ms, p95 ≤30 ms, and p95-regression ≤20% gates passed; both samples record
focused/visible documents, no console or window errors, only `localhost:5173`
network hosts, and a live Cesium-entity proof of 14/14 buildings plus 8/8
storefront proxies. The retained local source artifact is
`/tmp/udt-block835-public-realm-20260806/external-chrome-performance-evidence.json`;
the durable checksum-validated embedded evidence is in
`public/data/manhattan-esb-block-public-realm-20260806/benchmark.json`.

The camera-stabilized `b192253` acceptance replay now closes the local Stage 3
proof: all 8/8 accepted storefronts were selected through native Cesium canvas
pointer actions with exact storefront and canonical `doitt:` identity, details,
URL/history/reload persistence, all four typed fault journeys, normal
Fixture→Citywide→Civic transitions, desktop/iPhone 14 layout, reduced motion,
local-only network, and frame-pacing gates. Fresh evidence is retained under
`/tmp/udt-stage3-acceptance-proof-20260806/`; the implementation record names
the exact files. This is a source-constrained, local-only validation baseline,
not a claim of photorealism, current occupancy, survey-grade geometry, or a
complete Manhattan model; no public deployment or conveyance is included.

## Manhattan generated building exteriors (2026-08-12)

Six exterior waves are now promoted as the **default** composition over the
unchanged, immutable `manhattan-citywide-20260804` base. An ordinary session —
no URL parameter of any kind — streams all six.

| wave | promoted release | cells | owned buildings | shipped |
| --- | --- | --- | --- | --- |
| Block 835 | `manhattan-exterior-cells-20260811-v3` | 1 | 14 | 14 buildings / 28 GLBs |
| Midtown core | `manhattan-midtown-core-cells-20260811-v3` | 149 | 7,201 | 156 |
| Lower Manhattan | `manhattan-lower-manhattan-cells-20260812-p1` | 126 | 6,425 | 71 |
| Southern remainder | `manhattan-southern-remainder-cells-20260812-p1` | 176 | 9,603 | 179 |
| Central & upper | `manhattan-central-upper-manhattan-cells-20260812-p1` | 249 | 11,721 | 40 |
| Northern Manhattan | `manhattan-northern-manhattan-cells-20260812-p1` | 182 | 10,230 | 24 |

**Read the last column before the third.** Coverage is complete in the sense
that every wave the immutable ledger declares has a promoted default record.
It is **not** complete in the sense that Manhattan is modelled:

- **484 of 45,194 canonical building parents — 1.07%, about one in ninety-three
  — carry a generated exterior by default**, shipped as 498 GLB artifacts.
- **870 of the 883 spatial cells ship no exterior geometry at all.** Their
  buildings render as the base source-backed footprint/height massing and the
  runtime says so: each release carries a tombstone notice of the form
  "181 of 182 exterior cells ship no exterior geometry in this release; no
  substitute was selected for them."
- Each promoted wave ships a **bounded renderable subset** of its own
  partition, curated or order-derived. The bound is the 512-entry exterior
  cache contract: the six subsets occupy 498 of 512 entries and 121.81 MiB of
  256 MiB. Breadth inside a wave cannot grow without raising the cap or
  evicting another wave's ground.

### What the geometry is, and what it is not

Every shipped exterior is **generated and designed, not observed**. The V3
footprint-faithful grammar derives setbacks, facade bays, windows, entrances,
ground-floor divisions, cornices, roof form, roof equipment and water-tank
classes from the sourced OTI footprint ring and height. Four waves additionally
carry **procedural facade textures** rasterized from named constants and
re-verified byte-for-byte by the release validator.

**No shipped component asserts a real building's facade.** Component presence
is style- and geometry-derived; every component carries a machine-readable
truth tier (`generated`, or `absent` with a stated reason) and an uncertainty
statement, and generated components carry no real-world accuracy score. No
tenant name, logo, trade dress, occupancy, operating status or signage text is
generated — the packages are glyph-free by construction. Zero pixels, geometry,
textures, training inputs or acceptance evidence come from Google Maps, Street
View, unlicensed web photographs, or platform-restricted imagery.

The grammar **refuses** 899 of the 45,194 owned parents outright rather than
inventing geometry for them, each under a named stop code
(`source-height-below-grammar-minimum` 384, `ring-vertex-count-unsupported`
324, `ring-area-below-floor` 113, `ring-neck-below-grammar-minimum` 39,
`volume-identity-failed` 35, `ring-not-simple` 4).

### Opt-in canaries

Every wave shipped first as an **opt-in canary** that an ordinary session never
loads. A canary is selected — not added — by naming its release explicitly:

```text
/?exteriorCells=manhattan-northern-manhattan-cells-20260812
```

`?exteriorStreaming=off` disables all six promoted waves and returns the city
to base massing without touching identity, selection, details or deep links.

### Rollback

Each wave is withdrawn **independently** by swapping its one default activation
record in `src/runtime/exterior-default-activation.ts` for its recorded
predecessor:

- Block 835 and Midtown core roll back to their **V2 predecessor releases**,
  which stay byte-identical to the releases they name.
- Lower Manhattan, southern remainder, central & upper, and northern Manhattan
  roll back to **base massing** — they have never been promoted in any earlier
  form.

A rollback deletes and modifies no immutable release, never substitutes a
same-name or fixture feature, restores the predecessor cell mapping atomically,
leaves the other five waves streaming, and makes any promotion-era
`?exteriorCells=` bookmark into the withdrawn release fail closed by name. The
six rehearsals live in `src/runtime/exterior-multiwave-activation.test.ts`; the
Block 835 rollback additionally has committed browser journeys.

### Public showcase candidate — assembled, and LOCAL ONLY

`manhattan-public-showcase-20260812` is an **inventory** of the six separately
approved local releases, not a new redistributable whole. It grants no verb,
adds no source and widens no audience. **Every wave's approval instrument
excludes public internet deployment, and so does the candidate.** It has not
been deployed and this repository does not authorize deploying it.

```sh
pnpm build             # prunes every private partition from dist/
pnpm partitions:audit  # proves dist/ carries no private byte
pnpm showcase:audit    # differential audit — see the caveat below before running
```

`showcase:audit` **overwrites** its own committed record
`data/public-showcase-20260812/differential-audit.json`, and one of the totals it
counts is the number of working-record directories under `data/`. Any later task
that adds a `data/` record therefore changes that count on the next run. The
committed record is a snapshot taken at T023 and is the authority; re-run the
audit only when you intend to re-emit it, and check `git status` afterwards.

The private full-fidelity releases and the public candidate use **distinct
roots, allowlists, checksums and approval envelopes**. Restricted artifacts
cannot be requested from the public build: a fresh audit finds zero private-path
findings over 6,070 built files, and a real-browser smoke fetches every declared
private path and receives the SPA shell rather than the private bytes.

### Known gaps

The Goal's own integration acceptance leaves **six criteria unmet**, recorded
with stop reports in
[`data/goal-integration-acceptance-20260812/reconciliation.json`](data/goal-integration-acceptance-20260812/reconciliation.json)
and summarized in [`Decision 0039`](docs/decisions/0039-goal-integration-acceptance.md):
Manhattan-wide exterior coverage (484 of 45,194), the 1440p-class capture, the
**mobile path (not implemented)**, the coverage envelope's exterior tier,
accessibility keyboard/reduced-motion behaviour, and a retained-memory
growth verdict for the shipped six-wave composition.

The decisions are [`0031`](docs/decisions/0031-v3-footprint-faithful-facade-grammar.md)
(grammar), [`0032`](docs/decisions/0032-procedural-facade-textures.md)
(textures), [`0033`](docs/decisions/0033-block835-v3-wave-repromotion.md)–[`0037`](docs/decisions/0037-northern-manhattan-textured-canary.md)
(the six waves), [`0038`](docs/decisions/0038-public-showcase-candidate.md)
(showcase candidate) and [`0039`](docs/decisions/0039-goal-integration-acceptance.md)
(integration acceptance).

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
  state, layer controls, and explicit failure/fallback messages. Civic mode
  activates the runtime-only composition of the civic context over its pinned
  citywide base; the civic URL remains canonical.
- CesiumJS in `src/features/explorer/CesiumViewport.tsx` owns WGS84 globe
  positioning, camera behavior, rendering, and feature picking.
- `src/runtime/fixture-adapter.ts` is the deterministic synthetic adapter.
  `src/runtime/real-pilot-manifest.ts` loads the bounded pilot, while
  `src/runtime/citywide-release-runtime.ts` loads validated local citywide
  shards on demand. `src/runtime/composed-release-runtime.ts` joins the two
  immutable citywide/civic adapters with a shared 24-entry/48 MiB cache and
  four-request aggregate budget without emitting a new release.
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

### Camera and viewport behavior (2026-08-06)

Citywide and civic release loading now use the same ground footprint that
Cesium uses to filter dense geometry, with a last-valid fallback at the
horizon/dateline boundary. Primary drag orbits, middle/Ctrl+primary drag tilts,
and right drag, wheel, or pinch zooms; dense replacement preserves the visible
component-owned layer until its asynchronous successor is ready. The native
browser replay, environment limitations, and raw frame-pacing comparison are
recorded in
[`20260806-camera-visibility-performance-runtime-fix.md`](docs/implementation/20260806-camera-visibility-performance-runtime-fix.md);
the final three traces materially reduce the prior pathological tail stalls,
while retaining the raw measurements and their comparability limits.

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

The civic manifest is a runtime composition root, not a replacement release:
`manhattan-civic-context-20260804` declares `baseReleaseId` exactly equal to
`manhattan-citywide-20260804`. Its 38 statistical areas, 395 Parks parents,
and 1,140 LPC parents (1,130 placed parts) use 114 geometry, 307 search, and
52 detail shards with 22,424,795 declared bytes. The exact immutable manifest
hashes are citywide
`acb5a9b52014f86535c8478e7d4e516efc03f6dff95c17e9896dfea4413c203c` and civic
`225aba4efb041b26c38932b265f927373ec8974f0fb4a5e63e34baefd07da2a2`.

In civic mode, one shared runtime cache is capped at 24 entries and 48 MiB
(`50,331,648` bytes), active shard requests are capped at 4, and rendering
uses independent caps of 6,000 citywide base features and 128 civic context
parts. The current 1440×900 direct frame probe measured 1,158 samples after a
3-second settle (median 8.3 ms, p95 10.3 ms). See
[`MANHATTAN_CIVIC_RUNTIME_COMPOSITION_IMPLEMENTATION.md`](docs/codex/MANHATTAN_CIVIC_RUNTIME_COMPOSITION_IMPLEMENTATION.md)
for the browser journey and validation evidence.

## Accessibility and performance evidence

The current UI has keyboard combobox/listbox behavior, focus-aware viewport
keyboard controls, visible layer/data controls, and a responsive 390×844 layout
path. Reduced-motion handling remains in the camera journey code and CSS; the
connected Orca environment reported success setting media emulation but
`matchMedia('(prefers-reduced-motion: reduce)')` stayed false, so no forced
browser observation is claimed. Browser console/network evidence and exact
current benchmark output are recorded in the composition implementation
record; deterministic tests are not a substitute for visual, accessibility,
or device-performance validation.

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
- Civic composition keeps this procedural massing beneath statistical-area,
  Parks, and LPC source geometry/metadata; it does not turn those records into
  facade imagery or photorealistic models. Bounded-pilot GLBs remain inactive.
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

The app exposes the immutable local sibling release
`manhattan-civic-context-20260804` as the canonical civic composition root. It
streams generic v2 statistical-area, Parks property, and LPC landmark-record
layers through Cesium over the pinned citywide base, with mixed source-ID/name
search, source-typed details, deterministic overlap choices, URL layer/facet
state, cold deep links, local bookmarks pinned transitively to the base, and
per-layer failure isolation. The release is local-only; it is not a public
deployment or a claim of complete neighborhood, park, landmark, access, hours,
amenity, facade, rating, review, or transit coverage.

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
Runtime composition evidence is in
[`docs/codex/MANHATTAN_CIVIC_RUNTIME_COMPOSITION_IMPLEMENTATION.md`](docs/codex/MANHATTAN_CIVIC_RUNTIME_COMPOSITION_IMPLEMENTATION.md)
and [Decision 0015](docs/decisions/0015-manhattan-civic-runtime-composition.md).
