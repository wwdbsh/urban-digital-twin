# Manhattan real place-intelligence wave: implementation plan

Planning evidence date: 2026-08-04 (Asia/Seoul). This plan is for the current
dirty shared worktree at `919ca5f76151b04f45fe91fc8188c7f0239a37d9`. It does
not authorize a provider download, a new service, Blender work, a dependency
change, or a public deployment.

The requested restaurant + transit + park/public-space + shop + attraction
milestone is too broad for one safe implementation pass because only the
bounded DOHMH restaurant snapshot is currently approved and present. The
required first release is therefore the smallest coherent vertical slice:
turn the existing Flatiron/NoMad/Union Square DOHMH pilot into genuinely useful
place intelligence (search, click, stable link, truthful detail, provenance,
and scale-safe rendering) without changing its coverage or sources. Parks,
public facilities, broad shops/attractions, and transit remain explicitly
preserved as ordered follow-up stages behind separate source gates.

## 1. Requirements

### Functional requirements

1. A valid `real-wave-20260804` manifest must expose the existing 1,653 DOHMH
   restaurant-place groups and 3,532 buildings in the documented WGS84 pilot
   envelope (`west=-74.005`, `south=40.738`, `east=-73.982`, `north=40.752`). A
   missing, malformed, incomplete, wrong-source, wrong-size, or wrong-checksum
   artifact must fail closed to the labeled fixture experience.
2. In real mode, users must be able to find a restaurant by normalized name,
   address, cuisine, canonical ID, CAMIS/source-record ID, and the provider-
   neutral `restaurant` category. Search must not depend on the synthetic
   reconciliation catalog.
3. Restaurant filters must operate on categories actually present in the
   active release. Unsupported fixture categories must not look like populated
   real filters. An empty result must state both the active release and bounded
   coverage.
4. Every real restaurant must be selectable from Cesium picking and from an
   equivalent keyboard-accessible search result. Selection must open the same
   canonical details record and camera focus behavior.
5. A share/deep link must encode enough state to reopen the same release mode
   and canonical feature. Reload, browser Back/Forward, and a fresh tab must
   restore the real place when the pinned release exists. If it does not, the
   UI must say that the linked release/feature is unavailable and must not
   silently select a similarly named fixture.
6. The detail panel must show only present facts: public name, normalized
   address, cuisine, phone if sourced, CAMIS/source identity, snapshot/capture
   time, record update time, latest usable inspection summary, inspection-row
   count, terms/attribution, and uncertainty. It must explicitly label a DOHMH
   grade/score/action as administrative inspection data, never a consumer
   rating, review, popularity signal, opening status, or recommendation.
7. `1900-01-01` must render as “not yet inspected / no usable inspection date”
   according to the DOHMH field definition, never as a current or historical
   inspection. Missing hours, website, accessibility, brand, photos, reviews,
   price, and current business status must remain Unknown/Not provided.
8. Existing building selection, fixture mode, category behavior, camera
   controls, bookmarks, routes, layer toggles, stress harness, and the three
   verified landmark GLB fallbacks must continue to work.

### Data-truth requirements

- `CAMIS` is the source restaurant-permit identity, not the platform canonical
  ID and not proof that two future providers describe the same business.
- Each inspection is an observation. The place projection may publish a
  deterministic summary, but it must not overwrite or reinterpret source
  events. “Latest” means the latest valid inspection date, tie-broken by record
  date and stable source-ref ID; a record date alone is not an inspection date.
- DOHMH supplies inspections, address/phone/cuisine fields where present, and
  a geocoded point. It does not establish directory completeness, current
  opening, hours, entrance location, review sentiment, or travel quality.
- Preserve canonical ID, source record ID, provider, dataset ID, source URL,
  capture/update/observation timestamps, terms URL, attribution, license class,
  WGS84 coordinates, fixture flag, and uncertainty through normalized,
  browser, search, selection, and details representations.
- Never infer a missing field from a nearby building, another same-name place,
  a web search, Google content, or a visual match. Conflicts remain explicit.
- Release/source scope must be data, not conditionals tied to Manhattan names,
  so a later city can supply the same provider-neutral contracts.

### UX requirements

- Real mode must be visibly distinct from fixture mode at the top-level status,
  Data panel, search empty state, map note, and inspector source section.
- The release boundary and “not full Manhattan” qualifier must remain visible;
  the product must not imply coverage outside the pilot envelope.
- Search result rows must show a useful type/match reason and avoid raw JSON.
- Selecting a crowded POI must make it visually distinct without requiring all
  1,653 labels to be visible simultaneously. Only selected/actively focused
  labels need persistence.
- Copy-link feedback, invalid-link feedback, unavailable-release feedback, and
  fixture fallback must be announced as status/alert text.
- Required scope does not add ratings, photos, “open now,” directions, live
  transit, or Google-like claims the sources cannot support.

### Performance requirements

- Do not add another eager provider payload. The current browser pilot is
  already about 15.95 MB on disk (10,973,921-byte buildings partition plus a
  4,972,010-byte restaurant partition), and `loadRealPilot` currently fetches
  both in parallel before constructing one in-memory adapter.
- Normal real mode must not create a permanently labeled Cesium Entity for
  every restaurant. Use the existing app-owned `PointPrimitiveCollection`
  seam, stable primitive IDs, and semantic selected/search detail path; keep
  entities for sparse semantic overlays and selected detail where useful.
- Maintain checksum validation and cancellation/cleanup behavior. No provider
  network call is allowed at runtime.
- Record before/after artifact bytes, feature counts, browser request count,
  console output, and an identical fixed-camera interaction trace. Do not claim
  universal FPS or memory performance without an approved device budget.
- Any broader Stage 2 source must be spatially partitioned and camera/query
  selected before being enabled; it may not extend the current eager-loader
  pattern citywide.

### Accessibility requirements

- Preserve combobox/listbox semantics, `aria-activedescendant`, Arrow Up/Down,
  Enter selection, Escape dismissal, and focus transfer to the details heading.
- Every map-selectable restaurant must also be discoverable and selectable by
  keyboard search. Pointer-only access is a failure.
- Do not encode fixture/real, selection, freshness, or inspection meaning by
  color alone. Visible text and accessible names must carry the distinction.
- Preserve reduced-motion camera behavior and do not steal arrow keys from the
  search input or assistive-technology controls.
- Status text must use `role=status`; malformed/unavailable link failures must
  use `role=alert`. Run a keyboard-only journey at desktop and narrow/mobile
  viewport widths.

### Licensing and provenance requirements

- The required slice uses only the already approved registry entry
  `nyc.dohmh-restaurant-inspections` and the already published local immutable
  snapshot. No re-download is part of this pass.
- Preserve “Source: NYC Department of Health and Mental Hygiene, DOHMH New
  York City Restaurant Inspection Results (dataset 43nn-pn8j), accessed through
  NYC Open Data,” the exact terms link, capture date, and City/agency
  disclaimers in the UI and release metadata.
- NYC DataMine terms require an application using the data to notify the City,
  display the prescribed modified-source disclaimer, honor additional agency
  terms, and allow for data to be corrected/discontinued. Public deployment is
  blocked until the coordinator records how notification and the exact
  disclaimer are satisfied. The plan is not legal advice.
- Overture, OSM, MTA, Parks, Facilities, and DCWP registry entries remain
  pending. A planned source is not an approved source. Google Maps/Places/
  Street View extraction remains prohibited for this milestone.

### Regression requirements

- Keep all six GLBs and the landmark manifest byte-for-byte unchanged, and keep
  verified landmark selection/picking plus procedural fallback intact.
- Keep the published real pilot counts and checksums unchanged unless a new
  approved immutable release is deliberately created. Do not rewrite the
  current artifact in place.
- Preserve all 87 currently passing tests (21 files), plus typecheck and
  `git diff --check`; add focused tests for every new parser/search/link/render
  behavior. Lint and production build must also pass before handoff.
- No new dependency, Cesium ion, Three.js, hosted service, API credential,
  Blender operation, or architecture change is permitted in the required pass.

## 2. Current-state evidence

### What is real now

- Decision 0012 records one approved bounded real-data pilot. The checked-in
  browser manifest declares exactly `nyc.building-footprints` and
  `nyc.dohmh-restaurant-inspections`, WGS84, non-fixture content, 3,532
  buildings, and 1,653 restaurant groups derived from 13,727 inspection rows.
- `public/data/real-wave-20260804/manifest.json`, `buildings.json`, and
  `restaurants.json` are present. The restaurant browser partition retains one
  source ref, inspection observation count, and a deterministic latest-
  inspection summary; it deliberately omits full inspection history.
- `src/runtime/real-pilot-manifest.ts` performs no-store local fetches, validates
  release/source identity, byte sizes, SHA-256, count, schema/CRS, and fixture
  fallback. `App.tsx` constructs a non-fixture `LocalFixtureCityAdapter` only
  after successful validation and recognizes a real deep link by feature ID.
- The current real UI can load, search string-valued feature attributes, pick,
  focus, and deep-link restaurant features. It does not yet provide a typed
  real-place view or display the inspection summary/count.
- The six GLBs and `public/assets/landmarks/landmark-wave-20260804/manifest.json`
  are a separate validated landmark package. Cesium uses verified GLB content
  for those buildings and procedural massing for ordinary buildings.

### What is fixture-only or incomplete

- `placeTruthFixtures`, `placeTruthByRuntimeFeatureId`, the reconciled catalog,
  routes, transit, area examples, saved journeys, and stress tiles are synthetic.
  The rich place-truth inspector is therefore fixture-only.
- `searchUnifiedCatalog` receives real features but the synthetic reconciliation
  catalog. Real matches fall back to a generic scan of all string attributes,
  including serialized JSON, so the match reason/taxonomy is not a typed real
  search index.
- `RealPilotManifest` hard-codes one release ID and exactly two partitions. The
  loader fetches all partitions eagerly; that is acceptable only for the
  current bounded pilot and is not a citywide architecture.
- In normal mode Cesium creates point entities and labels for all POIs. The
  primitive path is currently enabled by the synthetic stress mode, providing
  a reusable seam but not production POI density handling.
- The renderer marks generic entity properties `fixtureOnly: true` in several
  branches even when the adapter is real. That metadata path must be audited so
  rendered/picked truth follows the feature/adapter rather than a constant.
- Transit shown by the app is synthetic. No MTA snapshot is downloaded or
  approved. Parks, facilities, shops, and attractions have registry/research
  entries only, not runtime records.

### Dirty shared-worktree evidence and reusable seams

- The worktree already contains material modified/untracked work in `App.tsx`,
  `CesiumViewport.tsx`, source registry, place schemas/ingest, building ingest,
  real-pilot loader/tests, landmark runtime/tests, scripts, public artifacts,
  research, decisions, and styles. These changes belong to prior validated
  work and must not be cleaned, reset, reformatted wholesale, or recommitted by
  assumption.
- Particularly reusable seams are `PlaceRecord`/`PlaceTruthRecord`,
  `PoiSnapshotAdapter`, `searchUnifiedCatalog`, `LocalFixtureCityAdapter`,
  `RealPilotManifest`, `RuntimeTileStream`, app-owned Cesium primitives,
  canonical `?feature=` navigation, field-level provenance, and the source
  registry approval gate.
- Local validation performed during planning: `pnpm typecheck`,
  `pnpm test -- --run` (21 files / 87 tests), and `git diff --check` all passed.
  This is a planning baseline, not evidence that lint/build/browser acceptance
  already passes after the future implementation.

## 3. Ranked risk analysis

| Rank | Risk | Impact | Likelihood | Mitigation | Stop/escalation condition |
| --- | --- | --- | --- | --- | --- |
| 1 | Shared dirty worktree overlap or accidental rollback | Critical | High | Inventory exact dirty paths before each checkpoint; edit only allowlisted hunks; no reset/checkout/clean/blanket formatter; review scoped diff after every checkpoint. | Stop if a required hunk overlaps unexplained user changes or rollback would remove pre-existing work. |
| 2 | Data-rights/attribution failure | Critical | Medium | Required slice uses only the already approved local DOHMH artifact; retain terms, attribution, source identity, disclaimer; treat every new registry entry as pending. | Stop before any new download, redistribution, or public deployment if approval, agency terms, City notification, or required disclaimer is unresolved. |
| 3 | Inspection fields presented as consumer/place truth | High | High | Typed parser and display labels; sentinel-date handling; tests that reject rating/open-now language and distinguish inspection vs record date. | Stop if field semantics cannot be supported by the official dictionary or source row. |
| 4 | False identity merging | High | High in later multi-source stages | Keep CAMIS, GERS, OSM, MTA, facility, park, BIN, and BBL identities separate; deterministic candidate links; never auto-merge solely by name/distance/address; expose conflicts. | Stop if a merge would change canonical identity without two independent strong signals and a reviewed rule/test. |
| 5 | Stale or missing facts appear current | High | High | Explicit known/unknown/stale/absent states, capture/update/observation dates, bounded coverage copy; no inferred hours/status/accessibility. | Stop when the UI requires a fact the approved source does not publish or the snapshot freshness policy is undefined. |
| 6 | Spatial scale and payload growth | High | High beyond pilot | Keep required slice bounded; measure existing bytes/requests; require spatial partitions and camera/query loading before Stage 2. | Stop if any plan loads full-Manhattan POIs/buildings eagerly, produces a monolithic city file, or exceeds an approved budget without measurements. |
| 7 | Cesium label/entity overload and degraded picking | High | Medium/High | Use one app-owned point collection for ordinary POIs, stable IDs, selected label/entity only, cleanup on mode/release switch, fixed-camera browser comparison. | Stop if console/WebGL errors, stale picks, duplicate primitives, leaked collections, or materially worse interaction appear. |
| 8 | Release/link identity drift | Medium/High | Medium | Add explicit data-mode/release URL state, validate release ID, fail closed on unavailable feature/release, test Back/Forward/reload. | Stop if a missing real ID resolves to any fixture or same-name substitute. |
| 9 | Source taxonomy churn | Medium | High for Overture | Pin release/schema, ingest `basic_category` and `taxonomy`, retain raw values/mapping version; do not build on deprecated `categories` alone. | Stop if a dated release/schema/mapping is not pinned or September 2026 removal is not handled. |
| 10 | Overclaiming visual/geographic fidelity | High | Medium | Preserve bounded coverage, source dates, uncertainty, and procedural/GLB labels; leave Blender assets untouched. | Stop if product copy says “full Manhattan,” “photorealistic,” exact facade/entrance, or live service without evidence. |

## 4. Source decisions from current primary evidence

“Accept” means usable within the stated checkpoint, not blanket legal clearance.
“Defer” means do not acquire or integrate in the required Luna Max pass.

| Candidate | Decision | Primary evidence and exact implications |
| --- | --- | --- |
| NYC DOHMH Restaurant Inspection Results `43nn-pn8j` | **Accept for required bounded slice** | The [official dataset](https://data.cityofnewyork.us/Health/DOHMH-New-York-City-Restaurant-Inspection-Results/43nn-pn8j) defines CAMIS as the stable permit ID, DBA as mutable public name, inspections as event rows, and `1900-01-01` as not yet inspected. The repo already records explicit user approval for the pinned pilot. Retain the immutable snapshot/checksum, dataset/agency attribution and all field dates; never convert grade/score/action into ratings, reviews, current status, or completeness. The [NYC DataMine terms](https://www.nyc.gov/html/datamine/html/data/terms.html?dataSetJs=raw) require City notification for an application, the prescribed modified-source disclaimer, compliance with agency terms, and acknowledge correction/discontinuation and no source-side historical retention. Public deployment remains gated on recording those obligations. |
| NYC Parks Properties | **Defer; preferred park geometry after approval and registry correction** | Current official NYC material points non-cartographic use to dataset `rjaj-zgq7`; the repository still names `enfh-gkve`, so the exact canonical artifact must be reconciled first. The official data dictionary distinguishes parks, triangles/plazas, managed sites, undeveloped land, and other semantics; geometry is not a legal survey and does not prove amenities or hours. NYC Open Data [terms](https://opendata.cityofnewyork.us/overview/) add City/agency terms, no warranty, mutable data, and informational-use limitations. Retain property ID, source edition, CRS, capture date, attribution, disclaimer, geometry uncertainty, and retired/management semantics. |
| NYC DCP Facilities Database `2fpa-bnsx` / source table `67g2-p84d` | **Defer; preferred public-service/attraction supplement after approval** | The [official catalog](https://data.cityofnewyork.us/City-Government/Facilities-Database-Shapefile/2fpa-bnsx/about) describes 30,000+ owned/operated/funded/licensed/certified facilities, annual non-automated updates, and required analytical caution. DCP documentation says it aggregates many sources, may have duplicates/missing records/conflicts, may substitute BIN/BBL centroids, and cannot verify public accessibility. Use only facility/provider semantics with source UID and geoprocessing method; do not infer public access, current hours, or commercial identity. NYC terms/disclaimer/notification obligations apply. |
| NYC DCWP Legally Operating Businesses `hs5f-ecrb` | **Defer; narrow shop/legal-status supplement only** | The [official dataset](https://data.cityofnewyork.us/Business/Legally-Operating-Businesses-By-Industry/hs5f-ecrb) covers businesses/individuals requiring DCWP licenses and explicitly omits some classes; it is not a complete shop directory. Preserve license/business unique IDs, status/expiration observation date, address/geocode provenance, NYC attribution/disclaimer, and unknown current opening/popularity. Do not map “license active” to “store open.” |
| Overture Places | **Defer; preferred broad Stage 2 shop/attraction/restaurant baseline after explicit approval** | The current [Places guide](https://docs.overturemaps.org/guides/places/) says July 2026 Places contains about 75M point entities, uses source-specific CC0 1.0, CDLA Permissive 2.0, or Apache 2.0, contains no OSM data, and has known duplicates, junk, and incomplete properties. Preserve each source and license; CDLA requires retention of notices, Apache requires license/notice obligations when applicable, and CC0 has no attribution requirement though provenance should remain. The guide says `categories` is deprecated and scheduled for removal in September 2026, so ingest `basic_category`/`taxonomy` with a pinned schema. [Release policy](https://docs.overturemaps.org/release-calendar/) removes public release files after at most 60 days/two monthly releases; pin release/checksum and define local retention/deletion/correction handling before download. GERS IDs aid continuity but July 2026 rematching causes elevated churn and is not proof of perfect identity. |
| OpenStreetMap NYC extract | **Defer; optional enrichment only after ODbL publication decision** | [OSM copyright](https://www.openstreetmap.org/copyright) and the [ODbL text](https://opendatacommons.org/licenses/odbl/1-0/) require visible OpenStreetMap-contributor attribution; publicly used adapted databases must be offered under ODbL with license notice/source access obligations, while a produced map still needs the required notice. Keep the OSM-derived database separable, source element/version IDs and extract timestamp intact, and decide whether reconciliation creates an adapted or collective database. Do not bulk-fetch standard OSM tiles or use the public API as the product backend. |
| MTA stations/complexes `5f5g-n3cz`, entrances `i9wp-a4ja`, static GTFS `fgm6-ccue` | **Defer pending written reuse terms** | Official [station metadata](https://data.ny.gov/api/views/5f5g-n3cz), [entrance metadata](https://data.ny.gov/api/views/i9wp-a4ja), and [GTFS metadata](https://data.ny.gov/api/views/fgm6-ccue) identify MTA attribution and useful IDs/fields but contain no license field; public read access is not a retention/redistribution/derivative grant. Keep complex centroid, station, platform/stop, entrance, ADA claim, and schedule semantics separate. Written terms must cover snapshot retention, derived indexes/tiles, attribution, redistribution, and update handling. |
| MTA GTFS-Realtime / live elevator or service state | **Reject for this milestone** | It is operational, credential/terms/freshness sensitive, and outside the bounded static place slice. No live status, caching, replay, or “open now” analogue may be inferred from static data. |
| Google Places, Maps, Street View, imagery, or Photorealistic 3D Tiles | **Reject for this milestone** | The user does not want Google extraction. Existing decision 0010 also records Google terms against scraping, bulk persistence, derivative reconstruction, and mixing assumptions. Do not call, capture, transcribe, scrape, cache, screenshot, train on, or derive place/visual assets from Google content. |
| User-contributed photos/reviews or other commercial directories | **Reject until a separately named provider and rights model are approved** | No source, moderation/privacy policy, takedown process, license, or retention model exists. Ratings, reviews, popularity, and photos remain absent. |

## 5. Ordered implementation checkpoints

### Required vertical slice (one Luna Max pass)

#### Checkpoint 0 — freeze evidence and ownership

- Re-read `AGENTS.md`, this plan, decision 0012, the source matrix, real-data
  runbook, and current scoped diffs. Record current HEAD, `git status --short`,
  published manifest/counts/checksums, and landmark manifest/GLB checksums.
- Establish a checkpoint journal in the handoff message, not a repository file.
  Identify every pre-existing dirty hunk in an allowlisted file before editing.
- Run the baseline validation commands in section 8.
- **Evidence:** exact status/count/hash output and 21 files / 87 tests baseline.
- **Rollback point:** no repository mutation; if baseline differs, stop before
  Checkpoint 1.

#### Checkpoint 1 — typed browser place projection

- Add a provider-neutral runtime projection/parser for browser place features.
  Parse structured categories, address, contact, source licenses, inspection
  count, and latest inspection from the lightweight partition; validate all
  JSON-bearing attributes and return explicit unknown/error states.
- Encode the DOHMH sentinel rule and deterministic latest-summary semantics in
  a pure function. Do not reintroduce 13,727-row full history into browser data.
- Audit `fixtureOnly` propagation so a real feature and picked primitive remain
  real, while synthetic records remain fixture-only.
- Add focused tests for ordinary inspection, no-inspection sentinel, missing
  phone/cuisine, malformed summary/license JSON, timestamp ordering, and source
  identity. Malformed record-level optional detail may show Unknown with a
  diagnostic; manifest/source/checksum failures still fail the release closed.
- **Evidence:** new focused tests pass; existing real manifest tests remain
  green; no public data file changes.
- **Rollback point:** remove only the new projection/test files and revert only
  Luna-owned fixture propagation hunks; the pre-existing manifest and artifact
  remain the exact prior boundary.

#### Checkpoint 2 — release-aware real search and links

- Build a typed search document/index from active adapter features, not the
  synthetic reconciliation catalog. Index canonical ID, source IDs/CAMIS,
  name, normalized address components, cuisine/raw category, and canonical
  category as separate fields so `matchedBy` is truthful.
- Preserve current synthetic catalog behavior in fixture mode. Make result
  ordering deterministic and Unicode-safe; do not index serialized license or
  inspection JSON as visitor text.
- Extend navigation state with explicit data mode and release ID while retaining
  backward compatibility for current `?feature=` links. A real link must never
  fall through to a fixture or same-name match.
- Add search/link tests for `DONUT PUB`, its address, `Donuts`, its CAMIS/source
  ID, category filtering, duplicate-name order, reload/Back/Forward state, and
  unavailable release/feature behavior.
- **Evidence:** exact expected result IDs and match reasons asserted; old fixture
  navigation tests still pass.
- **Rollback point:** revert only Luna-owned exploration/navigation tests and
  functions; Checkpoint 1 projection remains independently usable.

#### Checkpoint 3 — truthful details and source UX

- Render the typed real-place view in the existing inspector. Show the latest
  usable inspection date/grade/score/action/type and row count under a clearly
  titled “DOHMH inspection record” section with its administrative-data caveat.
- Render unknown facts without fake values. Add clickable source and terms links
  with the full attribution and the required City modified-source disclaimer in
  Data/Sources. Keep current coverage/capture language visible.
- Make category controls derive from the active release. The current real pilot
  shows Restaurant only; fixture mode retains its fixture categories.
- Ensure Data mode, fallback, empty-state, and stale/unavailable-link copy are
  specific and accessible. Do not add ratings, review stars, hours, or “open.”
- **Evidence:** component tests assert visible labels and absence of prohibited
  claims for both an inspected record and the `1900-01-01` record.
- **Rollback point:** revert only Luna-owned `App.tsx`/style/test hunks; typed
  data/search/link checkpoints remain testable without the UI addition.

#### Checkpoint 4 — scale-safe Cesium POI rendering

- Promote the existing app-owned point-primitive pattern from stress-only use
  to ordinary dense POIs in real mode. Keep stable canonical primitive IDs for
  picking; render a semantic selected/focused label separately; do not disturb
  verified landmark model entities or ordinary building primitives.
- Clean up collections/listeners on mode/release switch and unmount. Preserve
  feature filters, layer visibility, selection highlighting, focus, and exact
  canonical pick mapping.
- Add pure/render-mode tests for real POIs, fixture POIs, selected POI, hidden
  layer/filter, landmark asset model, and cleanup. Do not claim a 3D Tiles POI
  implementation; this is the bounded browser seam.
- **Evidence:** fixed-camera browser journey selects the same feature from map
  and search, no duplicate labels/primitives or console/WebGL errors, and no
  landmark manifest/content change.
- **Rollback point:** revert only Luna-owned Cesium rendering/test hunks; the UI
  can temporarily use the pre-checkpoint entity path without losing truth work.

#### Checkpoint 5 — integrated validation and handoff

- Run all commands and browser journeys in section 8. Capture counts, checksums,
  console/network evidence, responsive keyboard journey, and the scoped diff.
- Fix only regressions caused by this pass. If an unrelated baseline failure
  appears, record it and stop rather than changing unrelated code.
- **Evidence:** every completion condition in section 7 is directly satisfied.
- **Rollback point:** last independently passing checkpoint; revert only the
  failing checkpoint's Luna-owned hunks. Never reset the shared worktree.

### Optional follow-up stages (not part of the required pass)

1. **Stage 2A — Overture broad POIs:** only after explicit approval of the exact
   dated release, licenses, local retention/correction handling, and derived
   search/tile publication. Add shops and attractions (and broader restaurants)
   in the same pilot bbox first; pin `basic_category`/`taxonomy`, record each
   source/license, measure duplicates/nulls, and perform reviewable candidate
   linking to DOHMH without auto-merging. Roll back by removing only the new
   registry-approved adapter/artifact/release partition; keep DOHMH canonical
   IDs and UI unchanged.
2. **Stage 2B — Parks and civic public places:** only after the canonical Parks
   dataset ID is corrected and Parks + Facilities approvals/terms are recorded.
   Add park property geometry and selected facility points as separate feature
   kinds, preserving management/access/geoprocessing uncertainty. Roll back by
   disabling/removing those release partitions; do not alter restaurant IDs.
3. **Stage 2C — DCWP legal-business supplement:** only if the product explicitly
   needs licensed-business status. Keep legal status separate from place opening
   and use it to supplement, not define, the shop directory. Roll back the
   source partition/links without deleting the broad POI record.
4. **Stage 2D — static transit:** only after written MTA retention,
   redistribution, derivative, and attribution terms. Implement complexes,
   stations/stops, entrances, and static service as distinct contracts; no live
   arrival/elevator claim. Roll back MTA layers independently.
5. **Stage 3 — citywide expansion:** only after Stage 2 pilot quality and device
   budgets pass. Publish spatially partitioned search/point data and 3D Tiles;
   never scale by loading one Manhattan file.

## 6. Allowed and forbidden files/areas

### Required-slice allowlist

- `src/domain/exploration.ts` and its existing/new focused tests
- `src/domain/visitor-navigation.ts` and its focused tests only if release-aware
  URL state cannot remain in exploration/app code
- `src/domain/places.ts` / `src/domain/place-truth.ts` and focused tests only for
  provider-neutral projection semantics; do not restructure unrelated contracts
- one new `src/runtime/real-place-view.ts` plus
  `src/runtime/real-place-view.test.ts` (preferred isolated seam)
- `src/runtime/real-pilot-manifest.ts` and
  `src/runtime/real-pilot-manifest.test.ts` only if typed partition validation
  requires it; keep the approved release/source/checksum contract intact
- `src/runtime/fixture-adapter.ts` and focused tests only for truthful
  fixture/real propagation or typed search adapter seam
- `src/features/explorer/CesiumViewport.tsx` and focused rendering tests
- `src/app/App.tsx` and `src/styles.css`
- existing relevant tests under `src/domain`, `src/runtime`, or `src/app`; do not
  mass-update snapshots
- documentation only if implementation discovers an evidence-backed correction
  necessary for the shipped behavior; otherwise leave existing records alone

### Explicit do-not-touch areas

- `public/assets/landmarks/**`, `artifacts/blender/**`, `artifacts/browser/**`,
  `docs/research/BLENDER_MCP.md`, landmark manifests/tests, and all GLB files
- `scripts/acquire-nyc-building-snapshot.mjs`, building ingest code/tests,
  building raw/generated data, and the approved building partition
- `public/data/real-wave-20260804/**` in the required slice; consume it as the
  immutable published input, do not rewrite it
- backup-like `public/data/real-wave-20260804.lightweight-v1/**` and
  `public/data/real-wave-20260804.full-history-removed/**`
- all raw/generated/quarantine datasets and any production dataset download
- MTA, Overture, OSM, Parks, Facilities, DCWP, Google, routing, traffic, terrain,
  or imagery adapters/content before their stated gates
- `package.json`, `pnpm-lock.yaml`, Vite/Cesium dependency versions, CI, hosting,
  credentials, MCP configuration, `.gitignore`, and unrelated docs/decisions
- no Blender invocation, Blender MCP call, commit, push, reset, checkout, clean,
  destructive deletion, or repository-wide formatter

If implementation truly requires a file outside the allowlist, Luna Max must
stop and report the exact dependency and proposed minimal expansion.

## 7. Completion conditions (observable evidence)

- `pnpm typecheck`, `pnpm lint`, `pnpm test -- --run`, `pnpm build`, and
  `git diff --check` exit 0; all baseline tests plus focused new tests pass.
- The published manifest still validates exactly 3,532 buildings and 1,653
  restaurants from the two approved registry entries, with unchanged partition
  byte sizes and SHA-256 values.
- Landmark manifest and all six GLB SHA-256 values match Checkpoint 0.
- Searching “DONUT PUB,” “203 WEST 14 STREET,” “Donuts,” CAMIS `40365525`, and
  its exact source-record ID returns the same canonical feature with a truthful
  match reason in real mode.
- Selecting that result and picking its point open the same canonical details;
  selection/focus survives a copied URL, reload, Back, Forward, and fresh tab.
- The Donut Pub detail shows 24 inspection observations and the pinned latest
  inspection summary from the local artifact, clearly labeled administrative
  DOHMH data; it shows no review stars, popularity, “open now,” or invented
  hours/accessibility.
- `O & G GROCERIES` shows `1900-01-01` as not yet inspected/no usable inspection
  date, not as a current inspection.
- In real mode, only categories present in the release are enabled; a query
  outside the bbox reports bounded pilot coverage rather than “no Manhattan
  place exists.”
- Normal real mode does not create a permanent labeled Cesium Entity per
  restaurant. Search and map selection remain keyboard/pointer equivalent;
  selection is not color-only.
- Browser console has no error/warn attributable to the change, network shows
  no provider request and only approved local static assets, failed-checksum
  test falls back truthfully, and mode switching leaves no duplicate primitives.
- The final scoped diff contains only allowlisted files and no application data,
  dependency, Blender, building, landmark, or backup-directory changes.

## 8. Exact commands and browser journeys

Run from `/Users/sangheonlee/dev/games/urban-digital-twin`. Use Orca for Orca-
managed terminal/browser state and plain repository commands inside the Orca
terminal.

### Baseline and protected-content evidence

```sh
orca skills get orca-cli
orca status --json
orca worktree current --json
git rev-parse HEAD
git status --short
git diff --check
shasum -a 256 public/assets/landmarks/landmark-wave-20260804/manifest.json public/assets/landmarks/landmark-wave-20260804/*.glb
node --input-type=module -e 'import fs from "node:fs"; const m=JSON.parse(fs.readFileSync("public/data/real-wave-20260804/manifest.json","utf8")); console.log(JSON.stringify({releaseId:m.releaseId,sources:m.sourceRegistryEntryIds,partitions:m.partitions.map(p=>({id:p.id,count:p.featureCount,bytes:p.byteSize,sha256:p.sha256}))},null,2))'
pnpm typecheck
pnpm test -- --run
```

### Focused and full implementation validation

```sh
pnpm test -- --run src/runtime/real-pilot-manifest.test.ts src/runtime/real-place-view.test.ts src/domain/exploration.test.ts src/domain/visitor-navigation.test.ts src/runtime/landmark-assets.test.ts
pnpm typecheck
pnpm lint
pnpm test -- --run
pnpm build
git diff --check
git status --short
git diff -- src/domain/exploration.ts src/domain/visitor-navigation.ts src/domain/places.ts src/domain/place-truth.ts src/runtime/real-place-view.ts src/runtime/real-pilot-manifest.ts src/runtime/fixture-adapter.ts src/features/explorer/CesiumViewport.tsx src/app/App.tsx src/styles.css
shasum -a 256 public/assets/landmarks/landmark-wave-20260804/manifest.json public/assets/landmarks/landmark-wave-20260804/*.glb
```

If the implementation chooses a different test filename within the allowlist,
replace only that nonexistent path; do not omit the equivalent focused test.

### Start the fixed local app in Orca

```sh
orca terminal split --direction vertical --command "pnpm dev --host 127.0.0.1 --port 4173 --strictPort" --json
orca goto --url "http://127.0.0.1:4173/?data=real-wave-20260804&q=DONUT%20PUB" --json
orca wait --text "Real NYC pilot" --json
orca snapshot --json
orca console --limit 100 --json
orca network --limit 100 --json
```

Use the element refs from each fresh `orca snapshot --json`; never reuse refs
after navigation or a state-changing click.

### Browser journey A — search, keyboard, detail truth

1. Snapshot; focus the search input; use `orca keypress --key ArrowDown --json`
   then `orca keypress --key Enter --json` without a pointer click.
2. Snapshot and verify the selected title is `DONUT PUB`, the inspector reports
   address `203 WEST 14 STREET`, cuisine `Donuts`, CAMIS `40365525`, 24
   observations, latest usable inspection date `2025-08-11`, grade `A`, score
   `7`, and the administrative-inspection caveat.
3. Verify Unknown/Not provided for absent hours/accessibility and absence of
   review/popularity/open-now claims. Open Data/Sources and verify agency,
   dataset ID, capture/update dates, terms link, attribution, disclaimer, and
   bounded coverage text.
4. Repeat searches for `203 WEST 14 STREET`, `Donuts`, `40365525`, and
   `dohmh:40365525:0e6096543c6e29e12747eaf6`; each must select the same ID.
5. Search `O & G GROCERIES`; select it and verify the `1900-01-01` sentinel is
   rendered as not yet inspected/no usable date.

### Browser journey B — map pick, mode, and link identity

1. Return to Donut Pub from search and invoke Focus. Snapshot the selected map
   point and inspector; click the point using its current ref and verify the same
   canonical feature remains selected.
2. Copy the share link, record it with `orca eval --expression
   "window.location.href" --json`, reload with `orca reload --json`, wait for
   the title, and verify real mode plus the same feature. Navigate Back/Forward
   and repeat. Open the copied URL in a fresh Orca tab and repeat.
3. Change the release parameter to an unknown release and verify an alert plus
   no fixture/same-name substitution. Restore the valid URL.
4. Switch Fixture → Real → Fixture → Real from Data, taking a fresh snapshot
   after each switch. Verify truthful status, no duplicate point collections,
   preserved landmark availability, and no console/WebGL errors.

### Browser journey C — filters, empty state, responsive accessibility

1. In real mode inspect the category controls: Restaurant is available and
   unsupported fixture categories do not imply real records. Toggle Restaurant
   off/on and verify deterministic results and selection.
2. Search a deliberately absent string such as `NO-SUCH-PLACE-UDT-20260804`;
   verify the empty state says the active bounded pilot has no result, not that
   Manhattan has no such place.
3. Use keyboard only to open search, move results, select, close transient UI
   with Escape, open Data, and reach the details/source links. Verify focus is
   visible and moves to the detail heading.
4. Use `orca eval --expression
   "({w:document.documentElement.clientWidth,h:document.documentElement.clientHeight})" --json`
   to record the viewport. If Orca's current pane cannot be resized without a
   human operation, use the existing responsive automated test rather than
   desktop automation; do not claim manual mobile evidence.

### Browser journey D — network/performance/regression evidence

1. Reload the valid real URL, wait for load, then capture `orca network --limit
   200 --json` and `orca console --limit 200 --json`. Confirm no provider URL,
   no Google/MTA/OSM/Overture request, and no warning/error attributable to this
   work.
2. Record local manifest/building/restaurant/GLB request counts and transferred
   bytes. Compare to Checkpoint 0; explain any change instead of hiding it.
3. At the same camera pose, select Donut Pub, pan/zoom, select a second point,
   switch modes twice, and repeat the first selection. Confirm exact picking,
   one highlight, no duplicate labels, responsive controls, and landmark GLBs
   still resolve with procedural fallback for ordinary buildings.
4. Exercise the existing malformed/checksum loader test. Do not mutate the
   published artifact in the shared worktree to simulate failure.

## 9. Rollback map

| Checkpoint | Safe rollback point |
| --- | --- |
| 0 | No mutation. Stop on any unexplained baseline difference. |
| 1 | Remove the new typed projection/test and revert only Luna-owned truth/fixture-propagation hunks; keep artifacts and all pre-existing dirty changes. |
| 2 | Revert only Luna-owned search/navigation/link hunks and tests; Checkpoint 1 remains the last passing boundary. |
| 3 | Revert only Luna-owned inspector/category/status styles and UI tests; typed projection/search/link remain. |
| 4 | Revert only Luna-owned Cesium dense-POI/render tests; return to prior entity rendering while keeping truth/UI work. |
| 5 | Revert only the checkpoint that introduced the failing integrated behavior; do not reset, checkout, clean, or rewrite shared files wholesale. |
| Stage 2A | Remove/disable only the Overture artifact/partition/adapter and candidate links; DOHMH IDs/release stay intact. |
| Stage 2B | Remove/disable only Parks/Facilities partitions/layers; POI and building releases stay intact. |
| Stage 2C | Remove/disable the DCWP observation partition/links; broad place identity stays intact. |
| Stage 2D | Remove/disable MTA partitions/layers; never rewrite place identities to roll transit back. |

At each boundary, review a path-scoped diff and record the last passing command
set. Because the worktree is shared and already dirty, rollback must be manual,
hunk-scoped, and limited to Luna-owned edits; an automated Git reset is unsafe.

## 10. Mandatory stop/report conditions

Luna Max must stop and report, rather than infer, when:

- any new source download, API call, credential, paid service, MCP, hosted store,
  external runtime URL, license obligation, retention policy, or public
  redistribution would be introduced;
- NYC application notification/disclaimer handling is required for deployment
  and no recorded product/legal decision exists;
- Parks canonical dataset identity remains ambiguous, MTA reuse terms remain
  unspecified, or an Overture release/schema/license/retention decision is not
  pinned and approved;
- a new provider record would be merged with DOHMH using only a name, point,
  address approximation, building/parcel ID, or provider-supplied conflation
  result without the approved merge rule and conflict evidence;
- a field's official semantics, unit, date, sentinel, CRS, geometry meaning,
  freshness, or uncertainty cannot be established from the source/manifest;
- a useful UI design appears to require inventing hours, open status,
  accessibility, ratings, reviews, popularity, photos, entrance precision,
  service status, or full-Manhattan completeness;
- required work crosses the file allowlist, touches a protected artifact, needs
  a dependency/architecture change, or overlaps unexplained shared dirty work;
- browser scale requires full-city eager loading, a monolithic scene, or an
  unapproved memory/frame-time/network threshold;
- Blender or 3D authoring becomes necessary and Blender MCP is not explicitly
  connected/authorized (this plan requires no Blender work);
- baseline/required tests fail for an unrelated reason, artifact/checksum/count
  evidence changes unexpectedly, the real link resolves to fixtures, or
  Cesium/WebGL selection/resource cleanup cannot be made deterministic.

## 11. Final pre-handoff and pre-exit checklist

### Before handoff

- [ ] Confirm the required scope stayed on the existing DOHMH pilot; list all
      optional sources as deferred and all approval gates explicitly.
- [ ] Re-run every full validation command and all four browser journeys.
- [ ] Record exact test counts, build result, manifest counts/bytes/checksums,
      landmark checksums, network requests/bytes, and console warnings/errors.
- [ ] Confirm Donut Pub and O & G sentinel acceptance examples exactly.
- [ ] Confirm no provider call, dataset download, production-artifact rewrite,
      dependency change, Blender action, commit, push, reset, or cleanup ran.
- [ ] Review `git status --short` and the final scoped diff; distinguish
      pre-existing dirty files from Luna-owned files/hunks.
- [ ] Confirm protected GLBs/manifest/building partition and backup directories
      are unchanged.
- [ ] State residual limitations plainly: bounded pilot, no full Manhattan,
      no live transit/hours/status, no ratings/reviews/photos, and no citywide
      performance claim.

### Before exit

- [ ] Update the Orca worktree comment with the last passing checkpoint and any
      unresolved approval gate.
- [ ] Send the coordinator one concise handoff containing outcome, changed
      files, validation evidence, browser evidence, rollback boundary, and the
      exact next approved action.
- [ ] If blocked, report the first unmet stop condition and do not weaken tests,
      rewrite claims, or expand scope to obtain a green result.
- [ ] Do not leave a dev server or temporary agent running if Luna created it;
      stop only Luna-owned processes/terminals.
- [ ] Do not perform optional Stage 2 work in the same pass unless the
      coordinator returns with explicit source, rights, retention, and scope
      approval.
