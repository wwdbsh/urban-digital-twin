# Manhattan travel experience: NYC civic context wave

Status: **CP0–CP6 complete; Root review complete; this commit is the scoped
CP7 delivery; push verification follows/is recorded in Git history**
Planning evidence date: 2026-08-04 (Asia/Seoul)
Selected wave: **citywide statistical neighborhoods, NYC Parks-managed properties, and LPC-designated/calendared sites**

This is the next substantial milestone after the completed citywide building and
DOHMH restaurant release. It does not redefine success around those two layers.
It adds three kinds of source-backed context people use to understand and visit
Manhattan: where they are in DCP's statistical geography, which spaces NYC Parks
manages, and which buildings/sites have an official LPC designation record. The
wave is deliberately truthful: a 2020 NTA is not a universally accepted
neighborhood, a Parks property is not proof of current hours or amenities, and
an LPC record is not automatically a tourist attraction or a faithful 3D model.

The current Codex user turn on 2026-08-04 explicitly approves the three selected
NYC Open Data datasets for the local-only scope recorded below. Luna may perform
the ordered provider work only within that scope. Any later need for broader or
different approval is a mandatory stop: Luna must return to Root so the user is
interviewed before the affected task continues; it may not silently defer the
question or continue past the gate.

Execution status as of 2026-08-05: CP0 approval/baseline, CP1 generic contracts,
CP2 bounded acquisition/normalization, CP3 immutable sibling release, CP4
runtime/UX integration, CP5 deterministic validation, and CP6 documentation
audit are complete. The user-approved recommendation 1 focused-page probe is
the CP5 frame evidence: after a 3-second settle it collected 340 visible-page
requestAnimationFrame samples with median 8.3 ms and p95 16.6 ms. The unchanged
seven-anchor harness artifact reports 11 frames over about 1008 ms per anchor;
that is recorded as a known harness-validation issue, not substituted for the
focused-page measurement and not fixed by changing the harness. Root review is
complete; this commit is the scoped CP7 delivery; push verification follows/is
recorded in Git history.

### Approved source-use evidence

- Durable approval evidence ID:
  `codex-user-turn:2026-08-04:manhattan-civic-context-local-v1`.
- Evidence origin: the current Codex user turn dated 2026-08-04. This is not an
  Orca message ID, and registry/release/docs must not invent one.
- Canonical approval-scope JSON (UTF-8, one line, no trailing newline):

```json
{"approvalDate":"2026-08-04","approvalSource":"current Codex user turn","captureScope":"dated Manhattan-filtered local snapshots","datasets":[{"agency":"DCP","baseId":"9nt8-h7nd","mappedViewId":"4hft-v355","name":"2020 NTAs"},{"agency":"NYC Parks","datasetId":"enfh-gkve","name":"Parks Properties"},{"agency":"LPC","datasetId":"ncre-qhxs","name":"Designated and Calendared Buildings and Sites"}],"derivedUse":["local WGS84 geometry","search","detail","source relationships","browser UI"],"licenseAcceptance":"portal metadata license unspecified","localRawRetention":true,"metadataRetention":true,"obligations":["DCP/Parks/LPC attribution","NYC Open Data terms","City modified-data disclaimer","capture/update dates","uncertainty"],"publicDeployment":false,"redistribution":false,"expectedFee":false,"credentials":false}
```

- SHA-256 of that exact canonical JSON:
  `7860f0c6c867488935443df1f1f1bb6fefa950646fa7cd1cd32d5a3d0c1eda58`.
- Approved scope: dated Manhattan-filtered local snapshots and local raw/
  metadata retention for DCP base `9nt8-h7nd` with mapped view `4hft-v355`,
  Parks `enfh-gkve`, and LPC `ncre-qhxs`; derived local WGS84 geometry, search,
  detail, source relationships, and browser UI; DCP/Parks/LPC attribution, NYC
  Open Data terms, City modified-data disclaimer, capture/update dates, and
  uncertainty; explicit acceptance of unspecified portal license metadata;
  local use only, with no public deployment/redistribution, expected fee, or
  credentials.
- Registry, raw metadata, normalized manifests, release manifests, Decision
  0014, implementation evidence, and release-facing docs must carry both the
  durable ID and fingerprint plus the human-readable scope and exclusions.

## 1. Requirements, in required order

### 1.1 Product requirements

1. Extend the practical local Manhattan explorer from two real layers
   (buildings and restaurant inspection-backed places) to a coherent travel
   context release with:
   - 2020 Neighborhood Tabulation Areas (NTAs), explicitly labelled
     **statistical areas**;
   - property managed partially or solely by NYC Parks, explicitly labelled
     **NYC Parks-managed property**;
   - LPC designated/calendared buildings and non-building sites, explicitly
     labelled **official landmark designation records**.
2. Preserve a provider-neutral, multi-city release model. Layer and record
   contracts use `cityId`, source registry IDs, generic area/place kinds, and
   field-level semantics; Manhattan dataset IDs must not leak into generic UI or
   runtime algorithms.
3. Users can discover, select, inspect, deep-link, reload, and navigate Back/
   Forward to every accepted entity without loading all geometry or all details.
4. The existing release remains a complete rollback target. The new wave emits
   a new immutable sibling release and never rewrites
   `public/data/manhattan-citywide-20260804/`.
5. No claim of directory completeness, live status, current hours, accessibility,
   attraction popularity, architectural fidelity, or legal-boundary accuracy is
   inferred from these sources.

### 1.2 Data requirements

1. Pin metadata bytes, exact source query/export, headers, capture time, source
   update time, row count, byte count, SHA-256, schema, and all rejection/
   quarantine reasons for each approved immutable snapshot.
2. Acquire only Manhattan rows through documented source fields, then account
   for every returned row. A bbox is candidate evidence, not Manhattan
   membership. If a record intersects Manhattan but has missing/conflicting
   borough evidence, quarantine it; do not silently discard or accept it.
3. NTA identity is `NTA2020`; preserve `NTAName`, `NTAAbbrev`, `NTAType`, CDTA
   fields, source geometry, source release `26B` (or the approved current value
   at capture), and source/update/capture timestamps. Use the canonical base
   dataset `9nt8-h7nd`; record that mapped view `4hft-v355` is a presentation
   view, not a second source. NTA geometry is WGS84 at runtime, with input CRS
   explicitly recorded from the captured response.
4. Park parent identity is `GISPROPNUM`; acquisition/record observations keep
   `OBJECTID`, `OMPPROPID`, `PARENTID`, `GlobalID`, `RETIRED`, names, property
   classifications, jurisdiction, location/address, acres, acquisition date,
   and geometry. Multiple acquisition rows/geometries may belong to one park
   parent and must not become false duplicate parks. Retired records remain
   source observations and do not display as current without an explicit state.
5. LPC observations preserve at least `LP_NUMBER`, borough, BIN, BBL, block,
   lot, landmark name/type, designation and PLUTO addresses, boundaries,
   `MOST_CURRENT`, site status, last action, designation/calendaring dates,
   building/non-building flags, coordinates, and NTA code. Identity grouping
   must be reversible: one LP number may cover many sites and one site may have
   multiple designations. Never collapse solely on name, BIN, BBL, or point.
6. Source geometry and feature identity are separate. An LPC point may link to
   an existing OTI building only through explicit BIN/BBL/geometry evidence,
   preserving both identities and conflicts. No link changes the protected GLB
   package or claims facade accuracy.
7. Missing names, hours, contact data, entrances, amenities, accessibility,
   business status, photos, ratings, and reviews remain explicit unknowns.
8. Regeneration is deterministic from the exact approved snapshots. Stable
   serialization and checksums must match on a second clean staging build.

### 1.3 UX requirements

1. Add first-class layer controls for **Statistical areas**, **Parks**, and
   **Landmark records**, with an always-visible active-source/snapshot state.
2. Areas render as low-emphasis translucent boundaries/fills and labels that do
   not obscure buildings. Parks render as distinct ground polygons. LPC sites
   render as sparse selectable markers or verified building highlights; they do
   not replace procedural building geometry.
3. Search result groups and chips use truthful names: `2020 NTA (statistical)`,
   `NYC Parks-managed property`, and `LPC landmark record`. Do not label every
   LPC record `Attraction` and do not expose a generic `Neighborhood` polygon
   without the statistical qualifier.
4. Selecting a map feature and selecting its search result open the same stable
   record. Overlapping park/area/building/LPC geometry uses deterministic pick
   priority and provides a keyboard-accessible candidate list rather than a
   hidden first-hit choice.
5. Empty/error/loading/stale states are layer-specific. A failed parks shard
   must not remove buildings, restaurants, areas, or LPC records.
6. Existing Fixture, bounded pilot, and citywide controls remain truthful.
   Synthetic directions remain labelled synthetic; this wave adds no routing.

### 1.4 Search requirements

1. Extend the sharded citywide index without loading geometry. Search NTA by
   `NTA2020`, official name, abbreviation, and CDTA name/code; parks by
   `GISPROPNUM`, official/sign/311 name, location/address, type/subcategory;
   LPC records by canonical ID, `LP_NUMBER`, official name, address, BIN, BBL,
   type, and current status.
2. Exact canonical/source-ID queries work from one deterministic exact index;
   normalized text queries start after two characters and return deterministic
   ranking, grouping, and tie-breaking.
3. Category/facet selection must be encoded in URL state and restored on reload
   and Back/Forward. Filters list only categories present in the active release.
4. Search summaries carry enough typed information to render a useful result
   without fetching geometry/details, but do not duplicate full source records.
5. A missing release/entity fails closed. Never resolve a missing real ID to a
   fixture, same-name entity, or nearby geometry.

### 1.5 Map requirements

1. CesiumJS continues to own WGS84 placement, camera, globe, streaming, and
   picking. No Three.js, replacement map engine, or monolithic Blender scene.
2. Generalize the citywide manifest/runtime from the hard-coded
   `buildings | restaurants` union to typed layer descriptors supporting point,
   polygon, and area payloads without dataset-specific runtime branches.
3. Geometry is viewport-selected at the existing geodetic tiling seam with a
   bounded prefetch ring. Large polygons may reference multiple tiles but retain
   one stable parent pick ID; clipping/render parts never become new entities.
4. Toggling a layer aborts stale requests, removes only that layer's primitives,
   and leaves no stale pick IDs. Context loss/unmount destroys app-owned
   primitives.
5. Rendering order/depth behavior makes area and park fills legible without
   z-fighting or covering selected buildings/restaurants. A selected source
   feature receives a visible non-color-only state and equivalent text.

### 1.6 Detail requirements

1. NTA detail shows official ID/name/type, CDTA relationship, source release,
   statistical-purpose caveat, source/update/capture dates, attribution, terms,
   and geometry uncertainty.
2. Park detail shows parent ID, source names, management/jurisdiction wording,
   location/address, type/subcategory, acres if supplied, retired/current source
   state, acquisition observations, source/update/capture dates, attribution,
   terms, and field uncertainty. It states that source presence does not prove
   hours, amenities, legal survey accuracy, or current access.
3. LPC detail shows LP number, official name/type, site status/current flag,
   designation/calendaring dates when supplied, designation/PLUTO addresses as
   separately labelled observations, BIN/BBL caveats, last action, source dates,
   attribution, terms, and relationship to an OTI building when evidence exists.
4. Every absent value renders `Unknown / not provided`, not an empty field or a
   guess. Dates described by LPC as auto-generated time values are rendered as
   dates only; no unsupported official action time is claimed.
5. Details load by checksum-pinned shard on selection/deep link and do not
   require a geometry download for an unlocated/point-only record.

### 1.7 Navigation requirements

1. URLs encode data mode, immutable release ID, canonical feature ID, camera,
   visible layers, and active category/facet state.
2. Reload, fresh-tab open, Back, and Forward restore the same release and
   entity. A cold polygon deep link loads only the exact/detail index plus the
   needed geometry shard(s), then frames the source geometry.
3. Keyboard search selection focuses the detail heading; closing returns focus
   to the invoking result or map control. Map pick selection exposes the same
   focus and history behavior.
4. Bookmark records pin release and canonical ID. An entity absent from a newer
   release is `unavailable in this release`; omission is not deletion unless an
   authoritative tombstone exists.

### 1.8 Performance requirements

The existing release is already near its total budget: manifest-declared bytes
are `304,382,520` (290.28 MiB) against a 300 MiB cap, and the current Orca browser
snapshot showed 24 loaded shards, 21,777,618 bytes, 6,000 rendered features, and
8,192 decoded summaries/features at the current overview camera. Therefore the
new wave must not append blindly to that package.

| Budget | Required gate |
| --- | --- |
| New release root manifest | <= 256 KiB uncompressed |
| Any geometry shard | <= 2 MiB and <= 2,000 render parts |
| Any search/detail shard | <= 1 MiB |
| Exact/detail index | <= 4 MiB; split if projected >4 MiB |
| Total new three-layer incremental payload | <= 40 MiB uncompressed |
| Total combined immutable runtime release | <= 340 MiB uncompressed; if the existing 300 MiB invariant is intended to remain absolute, stop and compact before integration rather than raising it silently |
| Total content shards | <= 640 combined; record why this expands the prior 512 cap, or compact to remain <=512 |
| First fixed-camera incremental load | <= 3 MiB, <= 6 additional requests, <= 4 concurrent |
| Cache | <= 24 loaded shards and <= 48 MiB declared bytes across all layers; new layers do not get a second cache budget |
| Dense rendering | <= 6,000 ordinary building/point features plus <= 128 area/park render parts at a settled camera; selection remains outside bulk cap only while active |
| Search | warm p95 <= 100 ms; cold local-shard p95 <= 500 ms across a fixed 45-query corpus (15 per source) |
| Pick/detail | cached p95 <= 100 ms; cold p95 <= 500 ms across 30 fixed entities, including overlaps and cold polygon links |
| Frame proxy | after 3 s settle, median frame interval <= 33.3 ms and p95 <= 50 ms over 10 s, and no >20% regression against the same-machine citywide baseline |
| Heap | second seven-anchor tour ends within 20% of the first; if heap API is unavailable, mark unsupported and enforce cache/primitive counts |
| Initial JS bundle | <= 5% increase in raw and gzip bytes from the recorded current build; no new runtime dependency |

Budget changes require a written report with measurements and user approval; a
constant must never be raised merely to make a release validate.

### 1.9 Accessibility requirements

1. Layer controls and result filters are labelled controls with visible focus,
   pressed/checked state, and 44 CSS-pixel minimum targets at 390x844.
2. Search remains a standards-compliant combobox/listbox with Arrow navigation,
   Enter, Escape, deterministic active descendant, result-count/loading status,
   and no pointer-only entity.
3. Area/park/LPC visual distinctions use text/pattern/outline in addition to
   color and meet WCAG 2.2 AA contrast for controls and text.
4. A screen reader can hear selected entity kind, source, uncertainty, layer
   failure, and overlapping pick alternatives. Polygon geometry is summarized
   in text rather than exposed as thousands of vertices.
5. Respect `prefers-reduced-motion`; camera focus becomes an immediate bounded
   move. At 1440x900 and 390x844, details/search remain usable without controls
   obscuring the selected action.

### 1.10 Provenance requirements

1. Every normalized observation keeps registry ID, provider, dataset/view ID,
   source record ID, canonical URL, exact query/export URL or request body,
   terms URL, attribution, capture/update/release times, raw checksum/bytes,
   input/output CRS, and uncertainty.
2. Release manifests include source accounting, all rejections, parent/render
   counts, identity collision count, missing-location count, the durable source-
   approval evidence ID/fingerprint/scope/exclusions above, and checksums for
   every published file.
3. The UI Data panel exposes source scope, dataset IDs, capture/update dates,
   coverage/accounting, attribution, terms, City disclaimer, and local-only
   status. It must not imply City endorsement.
4. Provider calls never occur in the browser. Only checksum-pinned local static
   release files are fetched at runtime.

### 1.11 Licensing requirements

1. The official NYC Open Data overview says users accept NYC.gov Terms and any
   additional agency terms, datasets are informational, completeness/accuracy/
   fitness are not warranted, submitting agencies retain version control, and
   data can change. The legacy Data Mine terms additionally require application
   notification and the supplied modified-data disclaimer, permit provider
   termination requests, and say historical datasets are not retained by the
   portal. These obligations must be preserved in registry, release, and UI.
2. The Socrata metadata for all three selected datasets currently has no
   explicit `license` value. The user has explicitly accepted that uncertainty
   for the documented local retention/derivative posture only. Public
   visibility and this approval do not authorize public deployment or
   redistribution.
3. Approval for OTI building footprints and DOHMH restaurants
   (`msg_91770ac6d098`) does not cover these unrelated datasets.
4. This wave has no paid service, credential, API key, public deployment, or
   expected provider fee. Public hosting/redistribution remains a separate gate.
5. No Google Maps, Places, reviews, ratings, photos, imagery, Street View,
   screenshots, facade measurements, derived textures, or Google-trained/
   validated assets. No OSM, Overture, MTA, or other provider is added.

## 2. Current-state evidence and requirement-by-requirement gap audit

### 2.1 Authoritative evidence

- Git HEAD, local `main`, and `origin/main` are aligned at
  `179305c507312e74d7f2b67398a96bec43c02736`. The intentional dirty state at
  this rebaseline is this untracked plan, modified
  `docs/research/MANHATTAN_TRANSIT_RESEARCH.md`, local untracked/ignored
  `artifacts/**` evidence intentionally excluded from the work unit, and
  ignored `data/**`, `public/data/**`, Blender state, build output, and
  dependencies. Every pre-existing change and ignored artifact is user work and
  must be preserved.
- `public/data/manhattan-citywide-20260804/manifest.json` validates a local,
  immutable release containing 45,194 OTI building parents and 12,439 DOHMH
  CAMIS parents (12,353 located, 86 unlocated), 109,386 inspection observations,
  zero accounting remainder/collisions, 103 geometry, 214 search, and 134 detail
  shards, plus a 2,633,218-byte/57,633-entry detail index.
- `src/runtime/citywide-release-runtime.ts` and
  `src/release/citywide-release.ts` are hard-coded to two record kinds and two
  layer IDs. `App.tsx` labels all citywide POI results as Restaurant and exposes
  only Restaurant in the citywide category control.
- The Orca browser at `http://127.0.0.1:4174/` showed the real citywide release,
  lazy tile diagnostics, existing layer buttons, synthetic directions, and
  local-only status. At the observed overview camera it had 24 loaded shards,
  53 evictions, 21,777,618 loaded bytes, 6,000 rendered features, and no failed
  request, but Areas/Stations/Entrances/Routes were not real citywide layers.
- `src/ingestion/area-snapshot.ts`, `src/ingestion/poi-snapshot.ts`, generic
  source/provenance schemas, URL navigation, search UI, Cesium point/polygon
  rendering, cache/request pool, and fixture tests are reusable foundations.
  The area adapter still clips to the old approximate pilot rectangle and has no
  production citywide release integration.
- The protected six GLBs and their manifest under
  `public/assets/landmarks/landmark-wave-20260804/` are verified. They must not be
  regenerated or used as evidence that other LPC records have facade fidelity.
- Previous recorded deterministic baseline evidence passed typecheck, lint,
  build, `git diff --check`, and the then-current suites. This planning run did
  not rerun build/tests because it was authorized to edit only this plan and
  must not mutate build artifacts; Luna must establish the current baseline at
  Checkpoint 0.

### 2.2 Gap audit

| Requirement | What is real now | Gap to close in this wave |
| --- | --- | --- |
| Product breadth | Real buildings + DOHMH restaurants citywide | No real neighborhoods, parks, or official designation layer |
| Data truth | Strong source/accounting contracts for two sources; three-dataset local source use is now approved | Registry still needs the approved evidence ID/fingerprint; no snapshots, exact counts, normalization, grouping, or release evidence |
| UX | Search, layers, details, Data panel, Cesium picking exist | Citywide UI is restaurant-specific; Areas/LPC/Parks are absent or fixture-only; overlap chooser absent |
| Search | Lazy building/restaurant prefix and exact lookup | Runtime union and result labels reject new kinds; no typed facets/URL filters for the wave |
| Map | WGS84 Cesium viewport streaming and dense primitives | Manifest/runtime only understand buildings/restaurants; citywide polygon tiling and draw-order behavior unproved |
| Detail | Rich citywide building/restaurant detail | No NTA/Parks/LPC semantics or unknown-state panels; no reversible LPC-to-building relationship |
| Navigation | Release/feature/camera deep links and history exist | Layer/filter URL state incomplete; cold deep links for multipart polygons/linked designation records unproved |
| Performance | Bounded requests/cache/render cap; 290.28 MiB declared release | Existing release has little headroom; current 21.8 MB viewport observation exceeds the old 12 MiB target; no incremental three-layer measurements |
| Accessibility | Keyboard search, focus paths, status semantics exist | Overlap selection, polygon text summaries, mobile multi-filter controls, and new layer failure announcements unproved |
| Provenance | Source snapshots/checksums/approval embedded for OTI/DOHMH | Civic approval now exists, but registry/raw/release evidence must embed its durable ID/fingerprint and current dataset metadata |
| Licensing | Existing OTI/DOHMH approval and the new civic-context local approval are explicit | All three civic sources still show unspecified portal license; every artifact/UI surface must preserve the accepted uncertainty, City terms/disclaimer, attribution, and local-only exclusion |
| Travel realism | Users can explore real massing/restaurants and 3 landmarks | No citywide place context beyond restaurants; no facade/street imagery, live transit, broad shopping directory, or real routing |

Fixture-only foundations remain fixture-only: transit stations/entrances/routes,
route graph/directions, synthetic catalog/reconciliation records, fixture areas,
and broad place categories not supplied by DOHMH. UI controls being present is
not evidence that those real datasets exist.

## 3. Ranked risks and stop/escalation conditions

| Rank | Risk | Severity / likelihood | Mitigation | Stop or escalate when |
| --- | --- | --- | --- | --- |
| 1 | Scope drift beyond approved retention/derivatives from license-unspecified datasets | Critical / High | Enforce the durable three-dataset approval ID/fingerprint and preserve City/agency terms and disclaimer | Evidence ID/fingerprint/scope is absent or mismatched, agency-specific terms appear, or public deployment/redistribution is requested; stop and interview the user |
| 2 | False semantic claims (`NTA=neighborhood`, `LPC=attraction`, `park=open`) | Critical / High | Typed semantics and mandatory caveat tests/copy | A product requirement needs an unsupported label, hour, access, popularity, or official-boundary claim |
| 3 | Existing near-cap release grows unsafely | High / High | New sibling release, incremental budgets, compact schemas, split indexes | Increment >40 MiB, combined >340 MiB, viewport increment >3 MiB/6 requests, or old budgets require silent increases |
| 4 | Parent identity/grouping loses records | Critical / Medium | Full row accounting; source-specific parent/observation models; reversible links | Duplicate canonical ID, count mismatch, ambiguous grouping, or omission without quarantine reason |
| 5 | Polygon streaming/rendering damages interaction | High / Medium | Bounded tiling, stable parent IDs, deterministic overlap chooser, fixed cameras | Z-fighting/occlusion, stale picks, >128 context render parts, or a polygon requires whole-city loading |
| 6 | Source changes during acquisition | High / Medium | Pin metadata before/after; immutable staged capture; refuse mutation/overwrite | Schema/update token/count changes, partial response, retry concatenation, or non-deterministic replay |
| 7 | LPC-to-building joins overclaim identity | High / Medium | Explicit BIN/BBL/spatial evidence, conflicts visible, no name-only match | Contradictory IDs, dummy/outdated BBL/BIN, one-to-many ambiguity without reversible representation |
| 8 | Dirty shared tree or protected assets are overwritten | Critical / Medium | Path-scoped status/diffs, new output roots, no destructive Git | Any unrelated diff, protected GLB/manifest hash change, reset/clean/checkout, or existing release mutation |
| 9 | Accessibility regresses under added controls | High / Medium | Keyboard/AT/mobile journeys and focused component tests | Pointer-only entity, focus loss, unlabeled control/status, obscured 390x844 action, or color-only meaning |
| 10 | Scope expands into facade/transit/business directory work | High / Medium | Explicit forbidden areas and later-stage evidence gates | New provider/package/Blender work, Google content, MTA/Overture/OSM, or broad-directory claim is needed |

## 4. Primary-source decision table

All URLs below are direct official sources. Counts are portal-wide display
counts where available, not pre-approved Manhattan counts; exact Manhattan
counts must be measured only during the approved acquisition and pinned in
acquisition evidence.

| Source / current official evidence | Fields, count, update semantics | Terms / retention / attribution | Decision and approval state |
| --- | --- | --- | --- |
| [DCP 2020 NTAs base `9nt8-h7nd`](https://data.cityofnewyork.us/City-Government/2020-Neighborhood-Tabulation-Areas-NTAs-/9nt8-h7nd), [mapped view `4hft-v355`](https://data.cityofnewyork.us/d/4hft-v355) | `NTA2020`, names/abbreviation/type, CDTA, MultiPolygon; current metadata says release 26B, quarterly automated updates, source rows updated 2026-05-28. DCP explicitly says NTAs are statistical and not definitive/exhaustive neighborhoods. Citywide product is approximately 262 areas; exact current/Manhattan count is acquisition evidence. | Metadata license value is unspecified. NYC Open Data Terms + DCP attribution/disclaimer; retain raw only under the approved local policy and keep release/capture. | **Approved, local-only.** Dated Manhattan-filtered raw/metadata retention and derived local WGS84 geometry/search/detail/source relationships/browser UI are authorized under the recorded evidence ID/fingerprint; no public deployment/redistribution. |
| [NYC Parks Properties `enfh-gkve`](https://nycopendata.socrata.com/Recreation/Parks-Properties/enfh-gkve) | Each record is an acquisition; `GISPROPNUM`, IDs/parent, names, type/subcategory, jurisdiction, retired, acres/date/address, MultiPolygon. Metadata says monthly automated updates and was updated 2026-07-17. The prior portal display showed 2,015 citywide records; exact current/Manhattan count is acquisition evidence. Accuracy is limited by source scale; field verification is advised. | Metadata license value is unspecified. NYC Open Data Terms + NYC Parks attribution/disclaimer; managed property is not a legal survey or access/hours claim. | **Approved, local-only.** The same evidence explicitly retains acquisition/retired semantics and prohibits legal-boundary/current-access claims and public deployment/redistribution. |
| [LPC Designated and Calendared Buildings and Sites `ncre-qhxs`](https://data.cityofnewyork.us/Housing-Development/Designated-and-Calendared-Buildings-and-Sites/ncre-qhxs) | Portal shows ~39.4K citywide rows/30 public columns, updated 2026-06-18, `as needed`; fields include LP number, name/type, status/current, action/dates, addresses, BIN/BBL, building/non-building flags and WGS84 point. Multiple records per property/designation are expected; BIN/tax-lot data can be stale; generated times are not official action times. | Metadata license value is unspecified. NYC Open Data Terms + LPC attribution/disclaimer; no facade/photo/model rights are inferred. | **Approved, local-only.** The same evidence allows designation observations and reversible OTI joins but no attraction/facade claim or public deployment/redistribution. |
| [NYC Facilities Database `2fpa-bnsx`](https://data.cityofnewyork.us/City-Government/Facilities-Database-Shapefile/2fpa-bnsx/about) | 30,000+ facilities/program sites, annual non-automated update; portal updated 2024-12-23. Shapefile packaging and analytical limitations add ingestion scope. | License unspecified; DCP terms/disclaimer. | **Defer.** Valuable public-service/museum/library layer, but stale packaging and schema need their own bounded plan/approval after this release. |
| [DCWP CRD Licenses `hu58-6zik`](https://data.cityofnewyork.us/Business/CRD-Licenses/hu58-6zik) (successor to old `hs5f-ecrb`) | ~69.9K citywide license rows, weekly automated; updated 2026-04-24. Only businesses/individuals requiring a DCWP license; not a complete shop directory. | License unspecified; City/DCWP terms. Legal/status data is time-sensitive. | **Defer.** It cannot supply broad shops/department stores and would invite completeness/current-status confusion. Reconsider only as a labelled licensed-business supplement. |
| [MTA Open Data](https://www.mta.info/open-data) and [static GTFS catalog](https://data.ny.gov/Transportation/MTA-General-Transit-Feed-Specification-GTFS-Static/fgm6-ccue) | Static service/stops; station/entrance products are separate. Existing research records unspecified license and unresolved retention/derivatives. | Separate provider/terms and possibly credentials for real-time. | **Defer.** Requires its own explicit source and licensing decision. No transit claim in this wave. |
| [Overture Places](https://docs.overturemaps.org/guides/places/) and [attribution](https://docs.overturemaps.org/attribution/) | Broad shops, department stores, attractions and other POIs; per-record mixed source licenses and release retention semantics. | New provider; CDLA/Apache/CC0/source-specific obligations and release availability. | **Defer.** Strong candidate for the following commercial-place breadth wave, but requires separate user/legal approval and an acquisition/size design. |
| OpenStreetMap / Google sources | OSM would introduce ODbL adapted-database obligations. Google content is prohibited for this project workflow and not an open canonical source. | New provider/license; Google also adds billing/credentials/display/caching restrictions. | **Reject for this wave.** No calls, captures, extraction, derived assets, or content. |

## 5. Selected required wave and why

The **NYC civic context wave** is the strongest aligned next step because it adds
three citywide, visually and semantically complementary travel layers through
one already-understood portal/terms family and existing area/POI/runtime seams.
Users gain orientation (statistical areas), outdoor destinations/context (parks),
and official cultural/designation context (LPC sites), all searchable and
deep-linkable. It is substantial enough to force the platform's two-source,
two-kind citywide runtime into a reusable multi-layer release without taking on
the much larger licensing and taxonomy risk of Overture or the unresolved MTA
terms. It also makes failure isolation and truth semantics real product features.

This wave does **not** satisfy broad shopping, department stores, live transit,
routing, hours, photos, or near-photoreal facades. Those remain explicit later
milestones; passing this wave cannot be described as the full Google-Maps-like
end state.

## 6. Exact implementation boundary

### Allowed files/areas for Luna Max

- `src/data/source-registry.ts`
- `src/domain/{schema,areas,places,exploration,visitor-navigation}.ts` and their
  directly corresponding `*.test.ts` files
- `src/ingestion/{area-snapshot,poi-snapshot}.ts` and corresponding tests; new
  narrowly named source adapters/tests under `src/ingestion/`
- `src/release/{citywide-release}.ts` and tests; new versioned generic travel
  release modules/tests under `src/release/`
- `src/runtime/{citywide-release-runtime,layers,spatial,path-security}.ts` and
  directly corresponding tests
- `src/features/explorer/CesiumViewport.tsx` and its test
- `src/app/App.tsx`, `src/styles.css`
- New narrowly named scripts for metadata/acquisition/normalization/build/
  validation/publish/benchmark under `scripts/`, plus deterministic fixtures
  under `scripts/fixtures/`
- `package.json` only for new script aliases; **no dependency changes** and no
  lockfile change
- `docs/codex/MANHATTAN_TRAVEL_EXPERIENCE_NEXT_WAVE_PLAN.md` for a final
  implemented-status/evidence-link update before the work-unit commit; this
  approved handoff itself must be included in the reviewed stage set
- New `docs/decisions/0014-nyc-civic-context-wave.md`; checkpoint evidence is
  embedded in the implementation record and Decision 0014. Any local evidence
  under `artifacts/**` remains intentionally untracked and excluded from the
  reviewed/staged work unit.
- Documentation is part of the work unit, not optional handoff prose. The exact
  documentation audit/update set for this wave is:
  - update the existing root `README.md` with the implemented civic-context
    setup/architecture/data/operation/validation state and limitations;
  - update `docs/PROJECT_BRIEF.md` for the implemented real release state and
    remaining product limitations;
  - update `docs/design/PRIMARY_SCREEN.md` for the implemented layer controls,
    overlap selection, detail behavior, and desktop/mobile accessibility;
  - update `docs/research/MANHATTAN_AREA_RESEARCH.md` with the approved NTA base/
    mapped-view relationship, exact capture/release/count/CRS evidence, and
    statistical-area limitations;
  - update `docs/research/MANHATTAN_POI_RESEARCH.md` and
    `docs/research/PLACE_TRUTH_SOURCE_MATRIX.md` with the approved Parks/LPC
    source states, capture/update/count evidence, license/retention/attribution
    decision, and categories explicitly still missing;
  - update `docs/research/MANHATTAN_CATALOG_RELEASE_ARCHITECTURE.md`,
    `docs/research/MANHATTAN_STREAMING_ARCHITECTURE.md`, and
    `docs/research/RUNTIME_SLICE_FOUNDATION.md` for the implemented versioned
    multi-kind release, polygon streaming, failure isolation, budgets, and the
    fact that the runtime is no longer fixture-only;
  - update `docs/research/EXPLORATION_INTERACTION_CONTRACT.md` and
    `docs/research/VISITOR_NAVIGATION_CONTRACT.md` for source-typed search,
    overlap choices, layer/filter URL state, cold polygon links, focus, and
    truthful failure behavior;
  - update `docs/research/REAL_DATA_RUNBOOK.md` with the exact approved civic-
    context commands, immutable paths, validation, rollback, and local publish
    procedure;
  - update `docs/codex/PLACE_TRUTH_IMPLEMENTATION.md` so its historical
    fixture-only statement does not describe the current app, create
    `docs/codex/MANHATTAN_TRAVEL_CONTEXT_IMPLEMENTATION.md` as the missing
    implementation/evidence record for this wave, and create
    `docs/decisions/0014-nyc-civic-context-wave.md` for the exact approval
    evidence ID/fingerprint,
    sources, license posture, architecture, release, and exclusions;
  - update `docs/codex/AGENT_WORKFLOW.md` with the user-authorized final Root
    review -> one scoped work-unit commit -> configured-upstream push policy.
    Audit `AGENTS.md` for conflicts but do not edit it under this handoff; if a
    durable `AGENTS.md` change is needed, stop and ask the coordinator.
- Under the recorded approval only: new immutable ignored raw/normalized roots
  under `data/` and a new ignored sibling runtime release under `public/data/`;
  never edit the existing citywide release in place

Any additional code file requires root review before editing. If a dependency,
provider, credential, or architecture change is needed, report instead of
guessing.

### Forbidden files/areas

- `AGENTS.md` (read-only throughout), this plan except its authorized final
  status/evidence-link synchronization before commit, and research/decision
  documents outside the exact documentation set above
- All existing files under `public/data/manhattan-citywide-20260804/`
- `public/assets/landmarks/landmark-wave-20260804/**` and
  `artifacts/blender/**`
- Existing raw/normalized/quarantine evidence for OTI/DOHMH and all unrelated
  dirty worktree paths
- `pnpm-lock.yaml`, dependency additions, Cesium replacement, Three.js,
  non-Cesium map engines, hosted/CDN deployment, public publication, paid/
  credentialed services
- Blender or Blender MCP work, 3D asset authoring/editing/export, Google/OSM/
  Overture/MTA requests, imagery/photos/facade textures, live traffic/status,
  broad routing, or a monolithic Manhattan scene
- Any commit or push before Checkpoint 7, more than one work-unit commit, force
  push, destructive Git (`reset`, `clean`, `checkout` used to discard work),
  blanket formatting, history rewrite, or deletion of user work

Blender MCP remains mandatory only for a later work unit that authors or edits
3D assets. This civic-data wave does not author/edit an asset, does not run
Blender, and does not need Blender MCP availability to proceed.

## 7. Ordered checkpoints, completion evidence, and rollback

### Checkpoint 0 — approval and immutable baseline

1. Recompute the SHA-256 of the exact canonical approval JSON in this plan and
   require it to equal
   `7860f0c6c867488935443df1f1f1bb6fefa950646fa7cd1cd32d5a3d0c1eda58`;
   carry the paired durable ID into the initial registry/evidence fixtures. Do
   not substitute or invent an Orca message ID.
2. Capture `git status --short`, protected release/landmark hashes, current
   manifest counts/bytes, exact suite count, build sizes, and Orca browser
   diagnostics at the seven existing anchors.
3. Confirm `HEAD`, `main`, and `origin/main` start at the recorded
   `179305c507312e74d7f2b67398a96bec43c02736` baseline or record the reviewed
   successor before editing. If the canonical approval evidence cannot be
   reproduced, the scope is narrower than required, or a later approval need
   appears, stop before the affected work and have Root interview the user.

Completion: baseline artifact contains the approval ID, fingerprint, canonical
scope, and reproducible repository state; all baseline commands in section 9
pass or unrelated failures are reported.

Rollback: no code/data mutation; baseline is the rollback point.

### Checkpoint 1 — generic release/schema contract with fixtures only

1. Replace two-kind assumptions with a backward-compatible typed layer/record
   descriptor supporting buildings, restaurants, statistical areas, parks, and
   landmark records. Keep schema v1 loader intact; introduce v2 rather than
   mutating v1 semantics.
2. Add stable identity/grouping, source-accounting, local-path, checksum,
   per-layer failure, geometry kind, and budget validation using synthetic
   fixtures only.
3. Add URL layer/filter state and deterministic overlap candidate contract.

Completion: focused tests prove old manifest compatibility, new typed fixture
validation, invalid-source failure, deterministic serialization, and no fixture
substitution.

Rollback: revert only Checkpoint-1 Luna hunks; no source data exists.

### Checkpoint 2 — approved acquisition and truth accounting

1. Preflight official metadata and schema for `9nt8-h7nd`/mapped relationship,
   `enfh-gkve`, and `ncre-qhxs`; pin bytes/checksum/update tokens before capture.
2. Capture exact Manhattan-filtered responses to new `wx` staging files with
   request/time/headers/bytes/SHA evidence and bounded retry. Recheck metadata
   after capture. Never append/resume a partial response.
3. Normalize deterministically to WGS84, preserve raw values and observations,
   group source-specific parents, quarantine every invalid/ambiguous row, and
   prove input = accepted + rejected with zero unexplained remainder.
4. Run the same normalization twice into separate temporary staging roots and
   require identical normalized checksums.

Completion: exact current counts/null rates/bytes/checksums/update timestamps
are recorded; every row is accounted; all report-instead conditions are clear.

Rollback: quarantine/delete only incomplete new staging paths using explicit
validated paths; retain evidence. Never touch old datasets/releases.

### Checkpoint 3 — immutable compact release

1. Build a new sibling release with spatial geometry shards, prefix/exact search,
   lazy detail shards, parent/render mapping, typed source descriptors, approval
   evidence, and failure isolation.
2. Enforce section-1.8 budgets; split indexes/shards instead of raising caps.
3. Validate every declared path/byte count/SHA, stable replay, source accounting,
   parent identity, Manhattan coverage, and absence of raw observations from
   search summaries.
4. Atomically publish locally only after validation; refuse overwrite.

Completion: validator and deterministic rebuild pass; existing v1 release and
landmark hashes are unchanged.

Rollback: remove only the unpromoted new staging root. If already promoted,
switch the app back to the existing immutable release; do not delete evidence.

### Checkpoint 4 — runtime, search, map, detail, navigation

1. Load the new typed release lazily and independently per layer. Implement
   controls/facets, truthful result labels, details, cold deep links, bookmarks,
   URL restoration, and overlap candidate selection.
2. Render bounded NTA/park polygons and LPC markers/highlights with stable parent
   picks, selected-state text, cancellation/eviction cleanup, and no asset
   replacement.
3. Keep fixture/pilot/current citywide experiences and failure fallbacks
   deterministic. Simulate one missing/checksum-invalid shard per new layer.

Completion: focused unit/component/runtime tests and every browser journey in
section 10 pass without new provider/browser network calls.

Rollback: revert Checkpoint-4 UI/runtime hunks and point the app to the old
release; the validated new release may remain isolated for diagnosis.

### Checkpoint 5 — deterministic validation and evidence

1. Run all commands in section 9, then the exact Orca journeys in section 10 at
   desktop and mobile sizes.
2. Record request/byte/cache/render/search/detail/frame/heap measurements and
   compare to Checkpoint 0 and section 1.8.
3. Inspect scoped diff/status, generated-file exclusion, protected hashes,
   console/network, accessibility semantics, and all truth copy. Repeat the
   deterministic test loop after every fix until all gates pass or a report-
   instead condition is reached.

Completion: all observable gates pass and evidence points to exact release
checksums/counts. No acceptance criterion is weakened.

Rollback: revert only the failing checkpoint's Luna-owned hunks to the last
passing checkpoint. Never use destructive Git.

### Checkpoint 6 — mandatory documentation audit and synchronization

1. Before the work-unit commit, audit the existing root `README.md`, read-only
   `AGENTS.md`, this plan, and every existing document in the exact section-6
   documentation set against the implemented code, source approval evidence
   ID/fingerprint, raw/normalized/release manifests, generated checksums/counts,
   executable command `--help`,
   automated results, Orca screenshots/snapshots/network evidence, and known
   limitations.
2. Update `README.md` and this plan, create the new implementation record and
   Decision 0014, and update every affected existing document listed in section
   6 before the work-unit commit. A historical plan or decision may remain
   immutable only when it is clearly dated and still
   accurate as history; current-state claims such as “fixture only,” pending
   selected sources, old commands, or old release behavior must be corrected or
   explicitly scoped as historical.
3. For every setup command in documentation, compare it to `package.json` and
   the command's real `--help`; for every architecture/UX statement, compare it
   to the relevant code/tests and browser evidence; for every count/date/hash/
   license/release statement, compare it to the approved metadata and immutable
   manifests. Record this matrix in the implementation evidence document.
4. Run link/path/code-span checks with `rg`, the full validation loop, and a
   path-scoped documentation diff. Any undocumented implemented system area or
   contradiction is a failed completion gate, not post-commit cleanup.

Completion: the documentation matrix names every audited document, why it was
updated or why no change was needed, and the exact evidence supporting its
current claims; this plan, `README.md`, Decision 0014, the implementation
record, and every affected document are synchronized before commit, and all
changed behaviors/limitations are discoverable from the root guide and links.

Rollback: revert only inaccurate Checkpoint-6 documentation hunks. Never remove
required documentation to make the diff smaller.

### Checkpoint 7 — Root review, one scoped commit, and upstream push

1. After Checkpoints 0–6 and full validation pass, Luna supplies the complete
   unstaged work-unit diff, documentation audit matrix, source/release evidence,
   validation results, and browser evidence to Root Sol High. Root reviews the
   high-risk areas (source approval/license truth, accounting/identity, release
   integrity/budgets, failure isolation, accessibility/navigation, documentation
   accuracy, protected paths, and final diff).
2. Luna resolves every Root finding, reruns the affected focused checks and the
   full deterministic loop, refreshes documentation/evidence, and returns the
   revised diff to Root. Do not stage, commit, or push until Root explicitly
   records that review findings are resolved and authorizes finalization.
3. Recheck upstream, partition the dirty shared tree using the explicit
   work-unit path list, and stage only the reviewed work-unit paths. Review the
   full staged diff and staged file list; raw ignored data, unintended generated
   payloads, secrets, unrelated pre-existing changes, and incomplete checkpoint
   work are forbidden.
4. Create exactly one scoped work-unit commit, push it normally to the currently
   configured upstream (`origin/main` at planning time), and record the commit
   SHA plus porcelain push result. Never force-push or rewrite history.

Completion: Root's resolved-review record exists; the one commit contains only
reviewed paths; its SHA is shown; normal push succeeds; the upstream branch tip
matches that SHA; the remaining worktree status is reported and contains no
unexplained Luna-owned change.

Rollback: before commit, unstage only Luna's explicit paths with a non-destructive
index operation approved by the coordinator or stop and report; after commit,
do not amend/reset/rebase/revert or retry a divergent push by guessing—report to
Root with the commit SHA and exact Git output.

## 8. Observable completion conditions

The wave is complete only when all are true:

1. The durable user-turn approval evidence ID, SHA-256 fingerprint, canonical
   scope, and exclusions are embedded in registry/raw/release/docs evidence;
   they exactly cover the three selected datasets for local retention,
   derivatives, and display, with no fabricated Orca message ID.
2. Exact captured Manhattan counts, raw/normalized/published counts, rejected
   counts, byte sizes, checksums, update/capture times, CRS, and terms are
   recorded; accounting remainder and identity collisions are zero.
3. A new immutable sibling release validates and deterministic rebuilds match;
   old release and protected landmark hashes are unchanged.
4. At least one entity from each source is discoverable by official name and
   source ID, pickable, detail-loadable, bookmarkable, and cold-deep-linkable.
5. NTA, Parks, and LPC text uses the exact caveats above; no false attraction,
   neighborhood, access, hours, facade, rating, review, or completeness claim.
6. Layer-specific missing/corrupt shards fail only that layer; no real ID falls
   back to fixtures or a same-name substitute.
7. Desktop/mobile keyboard and pointer journeys pass with correct focus,
   announcements, controls, overlap selection, and reduced motion.
8. All automated checks pass, all budgets pass, browser console has no new app
   error/warning, and browser network contains only app-origin static assets.
9. No dependency/lockfile change, no provider outside the approved three, no
   Blender/Google work, and no public deployment.
10. Documentation accuracy passes Checkpoint 6: this plan, `README.md`, Decision
    0014, and every affected document named in section 6 match code, approved
    source/release metadata, executable commands, validation/browser evidence,
    and known limitations before the work-unit commit.
11. Root Sol High has reviewed the high-risk areas and final diff, Luna has
    resolved every finding and rerun validation, and this commit is the scoped
    CP7 delivery; push verification follows/is recorded in Git history.

## 9. Exact automated commands and checks

Run from the repository root. Provider-contacting command names/options do not
exist yet; Luna must implement the bounded aliases below, print `--help`, and
record the exact commands and approval evidence ID/fingerprint before first
contact.

```sh
git status --short
git diff --check

pnpm typecheck
pnpm test -- --run
pnpm lint
pnpm build

pnpm test -- --run src/domain/exploration.test.ts
pnpm test -- --run src/ingestion/area-snapshot.test.ts
pnpm test -- --run src/ingestion/poi-snapshot.test.ts
pnpm test -- --run src/release/citywide-release.test.ts
pnpm test -- --run src/runtime/citywide-release-runtime.test.ts
pnpm test -- --run src/features/explorer/CesiumViewport.test.ts
pnpm test -- --run src/domain/visitor-navigation.test.ts

pnpm citywide:validate
pnpm citywide:benchmark

node --input-type=module -e 'import fs from "node:fs"; const p="public/data/manhattan-citywide-20260804/manifest.json"; const m=JSON.parse(fs.readFileSync(p,"utf8")); console.log(JSON.stringify({releaseId:m.releaseId,totalDeclaredBytes:m.totalDeclaredBytes,layers:m.layers.map(x=>({id:x.id,parentCount:x.parentCount,renderPartCount:x.renderPartCount,shardCount:x.shardCount})),shards:{geometry:m.geometryShards.length,search:m.searchShards.length,detail:m.detailShards.length},detailIndex:m.detailIndex},null,2))'

shasum -a 256 public/assets/landmarks/landmark-wave-20260804/manifest.json public/assets/landmarks/landmark-wave-20260804/*.glb
git diff --check -- src scripts package.json docs/decisions
git status --short
```

Luna must add and run explicit new script aliases, without dependencies:

```sh
pnpm travel-context:acquire -- --help
pnpm travel-context:validate:raw -- --input <new-approved-raw-root>
pnpm travel-context:normalize -- --input <new-approved-raw-root> --output <new-staging-normalized-root>
pnpm travel-context:validate:coverage -- --input <new-staging-normalized-root>
pnpm travel-context:build -- --input <new-staging-normalized-root> --output <new-staging-release-root>
pnpm travel-context:validate -- --root <new-staging-release-root>
pnpm travel-context:benchmark -- --root <new-staging-release-root>
pnpm travel-context:publish-local -- --input <new-staging-release-root> --output <new-immutable-public-root>
pnpm travel-context:validate -- --root <new-immutable-public-root>
```

The first acquisition invocation must use explicit dataset IDs, Manhattan
predicate, output paths, durable approval evidence ID and fingerprint,
request/time/byte limits, and no overwrite. If the implemented `--help` cannot
express those controls, stop.

### Mandatory documentation-audit commands before the work-unit commit

Run these after implementation/full validation and again after resolving Root's
review findings. `README.md` must exist by then.

```sh
test -f README.md
sed -n '1,260p' README.md
sed -n '1,260p' AGENTS.md

for doc in \
  docs/PROJECT_BRIEF.md \
  docs/design/PRIMARY_SCREEN.md \
  docs/research/MANHATTAN_AREA_RESEARCH.md \
  docs/research/MANHATTAN_POI_RESEARCH.md \
  docs/research/PLACE_TRUTH_SOURCE_MATRIX.md \
  docs/research/MANHATTAN_CATALOG_RELEASE_ARCHITECTURE.md \
  docs/research/MANHATTAN_STREAMING_ARCHITECTURE.md \
  docs/research/RUNTIME_SLICE_FOUNDATION.md \
  docs/research/EXPLORATION_INTERACTION_CONTRACT.md \
  docs/research/VISITOR_NAVIGATION_CONTRACT.md \
  docs/research/REAL_DATA_RUNBOOK.md \
  docs/codex/PLACE_TRUTH_IMPLEMENTATION.md \
  docs/codex/MANHATTAN_TRAVEL_EXPERIENCE_NEXT_WAVE_PLAN.md \
  docs/codex/MANHATTAN_TRAVEL_CONTEXT_IMPLEMENTATION.md \
  docs/codex/AGENT_WORKFLOW.md \
  docs/decisions/0014-nyc-civic-context-wave.md
do
  test -f "$doc" && sed -n '1,320p' "$doc"
done

rg -n "fixture only|fixture-only|pending|citywide|NTA|statistical|Parks|LPC|license|retention|attribution|capture|checksum|release|travel-context|Blender MCP|commit|push" \
  README.md docs/PROJECT_BRIEF.md docs/design/PRIMARY_SCREEN.md \
  docs/research/MANHATTAN_AREA_RESEARCH.md \
  docs/research/MANHATTAN_POI_RESEARCH.md \
  docs/research/PLACE_TRUTH_SOURCE_MATRIX.md \
  docs/research/MANHATTAN_CATALOG_RELEASE_ARCHITECTURE.md \
  docs/research/MANHATTAN_STREAMING_ARCHITECTURE.md \
  docs/research/RUNTIME_SLICE_FOUNDATION.md \
  docs/research/EXPLORATION_INTERACTION_CONTRACT.md \
  docs/research/VISITOR_NAVIGATION_CONTRACT.md \
  docs/research/REAL_DATA_RUNBOOK.md \
  docs/codex/PLACE_TRUTH_IMPLEMENTATION.md \
  docs/codex/MANHATTAN_TRAVEL_EXPERIENCE_NEXT_WAVE_PLAN.md \
  docs/codex/MANHATTAN_TRAVEL_CONTEXT_IMPLEMENTATION.md \
  docs/codex/AGENT_WORKFLOW.md \
  docs/decisions/0014-nyc-civic-context-wave.md

pnpm travel-context:acquire -- --help
pnpm travel-context:validate:raw -- --help
pnpm travel-context:normalize -- --help
pnpm travel-context:validate:coverage -- --help
pnpm travel-context:build -- --help
pnpm travel-context:validate -- --help
pnpm travel-context:benchmark -- --help
pnpm travel-context:publish-local -- --help

git diff --check
git diff --name-status
git diff -- README.md docs/PROJECT_BRIEF.md docs/design/PRIMARY_SCREEN.md \
  docs/research/MANHATTAN_AREA_RESEARCH.md \
  docs/research/MANHATTAN_POI_RESEARCH.md \
  docs/research/PLACE_TRUTH_SOURCE_MATRIX.md \
  docs/research/MANHATTAN_CATALOG_RELEASE_ARCHITECTURE.md \
  docs/research/MANHATTAN_STREAMING_ARCHITECTURE.md \
  docs/research/RUNTIME_SLICE_FOUNDATION.md \
  docs/research/EXPLORATION_INTERACTION_CONTRACT.md \
  docs/research/VISITOR_NAVIGATION_CONTRACT.md \
  docs/research/REAL_DATA_RUNBOOK.md \
  docs/codex/PLACE_TRUTH_IMPLEMENTATION.md \
  docs/codex/MANHATTAN_TRAVEL_EXPERIENCE_NEXT_WAVE_PLAN.md \
  docs/codex/MANHATTAN_TRAVEL_CONTEXT_IMPLEMENTATION.md \
  docs/codex/AGENT_WORKFLOW.md \
  docs/decisions/0014-nyc-civic-context-wave.md
```

The implementation record must contain the document-by-document evidence
matrix. A successful command is not enough if its output contradicts the prose.

### Exact scoped pre-commit, commit, and push commands

Before staging, Root confirms an explicit reviewed repository-relative path list
containing only the approved code/tests/scripts/package aliases and exact
documentation set. No `artifacts/**` path, raw ignored data, secret, generated
payload, or unrelated path may enter that list; local evidence remains
intentionally untracked and excluded. Because this checkout is already dirty,
Root must confirm whether each pre-existing hunk on those paths belongs to this
work unit; if file-level staging would capture an unrelated hunk, stop rather
than using an improvised partial-history rewrite.

```sh
git status --short
git diff --name-status
git diff --check
pnpm typecheck
pnpm test -- --run
pnpm lint
pnpm build
pnpm citywide:validate
pnpm citywide:benchmark
pnpm travel-context:validate -- --root <new-immutable-public-root>
pnpm travel-context:benchmark -- --root <new-immutable-public-root>
git diff --check

git fetch --prune origin
git rev-parse --abbrev-ref HEAD
git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}'
git rev-parse origin/main
git rev-list --left-right --count origin/main...HEAD
test "$(git rev-list --count HEAD..origin/main)" -eq 0

# Root supplies only the reviewed code/docs paths; never include artifacts/**.
git add -- <Root-confirmed-code-and-documentation-paths-only>
git diff --cached --name-status
git diff --cached --stat
git diff --cached --check
git diff --cached
git status --short

git commit -m "Add Manhattan civic travel context"
git rev-parse HEAD
git log -1 --oneline --decorate
git push --porcelain origin HEAD:main
git ls-remote --heads origin refs/heads/main
git status --short
```

The pre-push left/right count must show no upstream-only commit. The configured
upstream is `origin/main` at planning time; if branch/upstream configuration has
changed, do not substitute a destination—stop and report. The hash returned by
`git ls-remote` must equal the recorded local commit SHA. Any unexpected staged
path, secret, raw/ignored dataset, unintended generated payload, unrelated dirty
change, upstream movement/divergence, non-fast-forward result, authentication
failure, or ambiguous path ownership is a mandatory stop with exact output.

## 10. Exact Orca browser journeys

Use the version-matched Orca CLI, JSON output, the existing local preview, a
snapshot-interact-re-snapshot loop, and app-origin network inspection.

1. **Cold release activation (1440x900):** open a fresh tab at the new release
   URL; wait for `Real NYC` status; snapshot. Assert no fixture geometry is shown
   under the real label, Buildings/Restaurants remain available, and the three
   new labelled layers are controls. Inspect `orca console --limit 100 --json`
   and `orca network --limit 300 --json`; assert no provider-domain request.
2. **NTA exact/text search:** fill `Search Manhattan` with a captured Manhattan
   `NTA2020`, select via keyboard, snapshot detail, copy URL, reload, Back and
   Forward. Repeat by official NTA name. Assert `2020 NTA (statistical)` and the
   not-definitive-neighborhood caveat.
3. **Park search/pick:** search a captured park by `GISPROPNUM` and official
   name, keyboard-select, then navigate to its map polygon and pick it. Both
   paths must yield the same canonical ID/detail. Toggle Parks off/on and assert
   only parks disappear/reload. Detail must not claim open hours/access.
4. **LPC link/overlap:** exact-search an `LP_NUMBER`, open detail, follow its
   reversible OTI building relationship when present, then return Back to the
   LPC record. At an overlapping building/LPC/area location, map selection must
   present keyboard-accessible alternatives with deterministic order.
5. **Failure isolation:** using a Luna-controlled test-only local fault seam,
   make one parks geometry shard unavailable, then one LPC detail shard checksum
   invalid. Snapshot announced layer-specific failures. Buildings, restaurants,
   NTA, navigation, and real release identity remain intact; no fixture/same-name
   substitution occurs. Restore without modifying immutable published files.
6. **Seven-anchor tour:** activate all three layers and visit Financial/Battery,
   Chelsea/Midtown, Upper West, Upper East, Harlem, Inwood/Marble Hill, and
   Roosevelt Island twice. Record added requests/bytes, loaded/evicted/failed/
   active, render parts, search/detail p95, frame proxy, and heap/cache behavior.
7. **Keyboard/accessibility:** Tab from search through layer/facet controls,
   results, overlap chooser, detail close, and map; use Arrow/Enter/Escape;
   verify focus return and live-region messages. Repeat with reduced motion.
8. **Mobile 390x844:** repeat search/select/detail/close and layer toggle for one
   entity per source. Assert no horizontal overflow or obscured selected action,
   and minimum target size.
9. **Old-mode regression:** load Fixture, bounded pilot, and
   `manhattan-citywide-20260804`; verify truthful labels and existing building/
   restaurant/landmark flows. The new release failure must not mutate old modes.

For each journey, record the final URL, snapshot/screenshot when useful,
network/console extract, metrics, and expected canonical/source IDs in the
implementation record and Decision 0014. Any local browser capture under
`artifacts/**` is diagnostic only and intentionally untracked/excluded.

## 11. Report-instead-of-guessing conditions

Luna must stop the affected checkpoint and report when:

- the durable approval evidence ID/fingerprint cannot be reproduced, the
  approved scope is narrower than the affected operation, or it does not cover
  local raw retention and derived search/geometry/detail artifacts;
- any later approval is required for any reason: stop the affected task, report
  the exact decision and evidence needed to Root, and interview the user before
  continuing; never silently defer the decision, substitute an assumption, or
  continue past the approval gate;
- an additional provider/agency term, credential, token, fee, package,
  notification action, or public-deployment decision is required;
- metadata adds a license/term that conflicts with or is not covered by the
  explicit local-only risk/terms acceptance;
- source schema/update token/count changes during capture, response is partial,
  Manhattan predicate is ambiguous, or exact row accounting/replay fails;
- NTA/Parks/LPC identity or status semantics cannot be represented without a
  false claim or irreversible merge;
- the release exceeds any budget, current citywide baseline fails for unrelated
  reasons, protected hashes change, or old release mutation becomes necessary;
- browser behavior requires a new map engine, dependency, worker, service,
  architecture, or provider;
- accessibility/failure-isolation gates cannot be met deterministically;
- facade/photorealism acceptance is introduced without approved independent
  reference rights and Blender MCP availability;
- `README.md` or an affected document is missing/unclear, an implemented system
  area has no foundational documentation, or prose cannot be reconciled with
  code, manifests, source approval, commands, evidence, and known limitations;
- Root review is absent, a high-risk/final-diff finding remains unresolved, or a
  post-review fix has not completed the required validation/documentation loop;
- the dirty shared tree cannot be partitioned safely at file/hunk ownership,
  the explicit stage set includes unrelated/pre-existing work not accepted into
  this work unit, or staged paths contain raw data, unintended generated output,
  secrets, protected files, or an incomplete checkpoint;
- the configured upstream is not the reviewed target, upstream moved/diverged,
  a normal fast-forward push would not succeed, authentication fails, or remote
  state cannot be verified. Never force-push, amend, reset, rebase, or guess.

### Evidence required before a near-photoreal exterior stage

That later stage is not part of this wave. It requires, per modeled asset:
written commercial/derivative permission or a clearly compatible public-domain/
CC source; source URL/ID, creator/rightsholder, license text, attribution,
capture/publication date, permitted modifications, expiry/takedown terms;
independent geometry/dimension evidence (survey, approved drawings, lidar or
photogrammetry from authorized photographs); texture rights; Blender MCP
connection; model/texture/triangle/LOD budgets; geospatial alignment and
height/datum validation; fixed-view visual comparison against the authorized
references; and a review that separates factual massing from copyrighted
expression/trademarks. Google Maps/Street View/imagery/screenshots/tiles may not
enter the reference, modeling, prompt, texture, validation, or training chain.

## 12. Luna-ready handoff checklist

### Goal

- [ ] Deliver one immutable local Manhattan travel-context release containing
      approved DCP 2020 NTAs, NYC Parks properties, and LPC designation records,
      integrated into search/map/detail/navigation with truthful semantics and
      no regression to existing real releases.

### Allowed areas

- [ ] Use only the exact files/roots listed in section 6; add no dependency.
- [ ] Create new staged/immutable data roots only under the recorded approval.
- [ ] Update this plan and the existing root README; create/update the exact
      section-6 documentation set, implementation evidence record, and Decision
      0014 before commit.

### Do-not-touch areas

- [ ] Preserve existing citywide release, protected GLBs/manifest, Blender
      evidence, OTI/DOHMH raw data, AGENTS.md, unrelated dirty work, lockfile,
      providers, and deployment state.

### Ordered steps

- [ ] CP0 approval-evidence/baseline -> CP1 generic fixture contract -> CP2 acquisition/
      accounting -> CP3 release -> CP4 runtime/UX -> CP5 full deterministic loop
      -> CP6 documentation audit -> CP7 Root review/one commit/push.

### Completion conditions

- [ ] Satisfy all eleven observable conditions in section 8 with exact evidence.
- [ ] Documentation accuracy is verified against code, approvals, release
      metadata, commands, validation, browser evidence, and limitations.
- [ ] Root findings are resolved before exactly one scoped commit and normal
      configured-upstream push; record commit SHA and push verification.

### Tests/checks

- [ ] Run every command in section 9 and every Orca journey in section 10;
      repeat after fixes; record exact suite counts, bytes, checksums, IDs,
      console/network, and budgets.

### Rollback

- [ ] At failure, revert only Luna-owned hunks from the current checkpoint or
      switch activation to the old immutable release; never reset/clean/checkout.
- [ ] After commit/push begins, do not amend/rewrite/revert by assumption; report
      the SHA, staged/committed paths, and exact local/remote result to Root.

### Uncertainty conditions

- [ ] Stop on any section-11 condition. Quarantine ambiguous records with an
      explicit reason; never guess a semantic, identity, license, or value.
- [ ] If any later approval is required, stop the affected task and have Root
      interview the user before resuming; never silently defer or proceed.

### Pre-exit checks

- [x] `git status --short` and path-scoped diffs show only authorized changes;
      excluded user paths remain outside the delivery.
- [x] `git diff --check`, typecheck, full tests, lint, build, both release
      validators/benchmarks, deterministic replay, protected hashes, and all
      browser/accessibility/failure journeys pass.
- [x] The mandatory documentation audit matrix is complete; README/setup,
      architecture, source/license, operation, validation, UX, limitations, and
      release-state claims match the implementation evidence.
- [x] Root Sol High's high-risk/final-diff review is recorded and all findings
      are resolved; staged name/status, stat, check, and full diff were reviewed.
- [x] Root review complete; this commit is the scoped CP7 delivery; push
      verification follows/is recorded in Git history without a pre-guessed SHA.
- [x] No generated/raw payload is accidentally tracked; no secret, unrelated
      dirty change, provider-domain browser request, new package, Blender/Google
      work, force push, destructive Git, or public deployment occurred.
- [x] Evidence states every remaining limitation: no vernacular-neighborhood
      authority, hours/access/amenity guarantee, broad shop directory, real
      transit/routing, photos/ratings/reviews, or near-photoreal facade claim.

## 13. Recorded user approval and remaining gates

The current Codex user turn on 2026-08-04 approved the following exact
local-only source use:

> Allow the project to query and retain dated, Manhattan-filtered snapshots of
> NYC DCP 2020 Neighborhood Tabulation Areas (`9nt8-h7nd`, mapped view
> `4hft-v355`), NYC Parks Properties (`enfh-gkve`), and NYC LPC Designated and
> Calendared Buildings and Sites (`ncre-qhxs`); retain their raw records and
> metadata locally; derive local WGS84 geometry tiles, search indexes, detail
> shards, source relationships, and browser UI; display DCP/NYC Parks/LPC
> attribution, NYC Open Data terms, the required City modified-data disclaimer,
> capture/update dates and uncertainty; accept that the portal metadata does not
> state an explicit license; keep use local with no public deployment or
> redistribution; and incur no expected provider fee or credential use.

Luna may contact these datasets, retain local data, mark the three registry
entries approved for this exact scope, build local derived artifacts, and
activate the new local real layers only while carrying the durable ID and
fingerprint defined at the top of this plan. Public deployment/redistribution,
facilities, shops/Overture, MTA/transit, OSM, paid services, credentials, or any
facade/imagery source remain unapproved. If implementation would require any of
them or any other new approval, stop the affected task and have Root interview
the user before continuing; never silently defer or pass the gate.

## 14. Execution checklist (2026-08-05)

- [x] CP0 approval ID/fingerprint, baseline, old-release hash, protected
      landmark hashes, dependency/lockfile state, and dirty-tree exclusions
      rechecked.
- [x] CP1 generic v2 typed contracts, identity/accounting/path/checksum/budget/
      failure/URL/overlap contracts and focused tests completed.
- [x] CP2 three-source bounded acquisition, before/after metadata pins, raw
      headers/checksums, WGS84 normalization, quarantine accounting, and A/B
      replay completed with zero remainder/collisions.
- [x] CP3 immutable `manhattan-civic-context-20260804` sibling validated and
      locally published without changing the old release.
- [x] CP4 lazy Cesium layers, source-ID/name search, details, facets, URLs,
      history/bookmarks, overlap chooser, focus handling, and isolated faults
      validated while fixture/pilot/citywide modes remain available.
- [x] CP5 typecheck, lint, full/focused tests, build, citywide validation and
      benchmark, civic alias help/validation/benchmark, browser journeys,
      accessibility, reduced motion, and protected/path scans completed.
- [x] CP5 performance evidence uses the approved focused-page rAF result:
      3-second settle, 340 frames, median 8.3 ms, p95 16.6 ms.
- [x] The unchanged seven-anchor harness result (11 frames/about 1008 ms per
      anchor) is documented as a known validation issue, without changing the
      harness or weakening the focused-page evidence.
- [x] CP6 README, exact affected documents, Decision 0014, implementation
      record, documentation matrix, and exclusions synchronized; any local
      evidence files under `artifacts/**` are intentionally untracked and
      excluded from staging/commit.
- [x] No public deployment, provider expansion, dependency/lockfile change,
      generated/raw tracking, or protected-path mutation.
- [x] Root review complete; this commit is the scoped CP7 delivery; push
      verification follows/is recorded in Git history.
