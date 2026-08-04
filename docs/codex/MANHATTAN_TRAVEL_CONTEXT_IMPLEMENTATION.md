# Manhattan civic-context wave implementation record

Date: 2026-08-05 (Asia/Seoul)
Status: **CP0–CP6 complete; Root review complete; this commit is the scoped
CP7 delivery; push verification follows/is recorded in Git history**
Rollback: baseline `179305c507312e74d7f2b67398a96bec43c02736` and untouched
`manhattan-citywide-20260804`

This record is the evidence handoff for the approved Manhattan civic-context
wave and its scoped CP7 delivery. The explicitly reviewed paths define this
commit; push verification follows/is recorded in Git history, while local
artifacts remain intentionally untracked and excluded.

## 1. Approval, scope, and exclusions

Durable approval evidence ID:
`codex-user-turn:2026-08-04:manhattan-civic-context-local-v1`
Canonical scope SHA-256:
`7860f0c6c867488935443df1f1f1bb6fefa950646fa7cd1cd32d5a3d0c1eda58`

Canonical scope JSON (the exact UTF-8 string hashed above):

```json
{"approvalDate":"2026-08-04","approvalSource":"current Codex user turn","captureScope":"dated Manhattan-filtered local snapshots","datasets":[{"agency":"DCP","baseId":"9nt8-h7nd","mappedViewId":"4hft-v355","name":"2020 NTAs"},{"agency":"NYC Parks","datasetId":"enfh-gkve","name":"Parks Properties"},{"agency":"LPC","datasetId":"ncre-qhxs","name":"Designated and Calendared Buildings and Sites"}],"derivedUse":["local WGS84 geometry","search","detail","source relationships","browser UI"],"licenseAcceptance":"portal metadata license unspecified","localRawRetention":true,"metadataRetention":true,"obligations":["DCP/Parks/LPC attribution","NYC Open Data terms","City modified-data disclaimer","capture/update dates","uncertainty"],"publicDeployment":false,"redistribution":false,"expectedFee":false,"credentials":false}
```

The approval permits dated Manhattan-filtered snapshots, local raw/metadata
retention, local WGS84 geometry/search/detail/source-relationship/browser
derivatives, DCP/Parks/LPC attribution, NYC Open Data terms, the City
modified-data disclaimer, capture/update dates, and explicit uncertainty. The
portal metadata's unspecified license is accepted only for this local use.
Excluded are public deployment/redistribution, any provider beyond the three
listed datasets, credentials, fees, imagery/facades/textures, Google, OSM,
Overture, MTA, Facilities, shops, routing, live status, and stronger
completeness/fidelity claims. No Orca message ID was invented.

## 2. Checkpoint status

| Checkpoint | Result | Evidence |
| --- | --- | --- |
| CP0 | Complete | Approval fingerprint, baseline, protected hashes, old-release hash, package/lock/provider/path partition checked; evidence is embedded in this record and Decision 0014. Local `artifacts/**` captures are intentionally untracked and excluded. |
| CP1 | Complete | Generic v2 schema, typed layer/record/release contracts, identity/accounting/path/checksum/budget/failure/URL/overlap tests. |
| CP2 | Complete | Bounded no-overwrite acquisition, before/after metadata pins, raw/header checksums, WGS84 normalization, reversible grouping, quarantine accounting, replay A/B. |
| CP3 | Complete | Immutable sibling release, validated staging and local publish, no old-release mutation; release evidence is embedded in this record and Decision 0014. Local `artifacts/**` captures are intentionally untracked and excluded. |
| CP4 | Complete | Lazy Cesium layers/search/details, deep links/history/bookmarks, source facets, overlap ordering, focus/accessibility, per-layer fault isolation. |
| CP5 | Complete with known harness limitation | Full deterministic loop, local release benchmarks, focused-page rAF evidence, desktop/mobile/reduced-motion/fault/old-mode journeys, and the known seven-anchor harness issue are recorded below. Local `artifacts/**` captures are intentionally untracked and excluded. |
| CP6 | Complete | Exact documentation set synchronized and audited in the matrix below; local evidence files are intentionally untracked and excluded. |
| CP7 | Root review complete; this commit is the scoped CP7 delivery; push verification follows/is recorded in Git history | The reviewed path set is the one scoped delivery; Git records the commit and push result without a pre-guessed SHA. |

## 3. Source acquisition and accounting

Capture time for all three snapshots: `2026-08-04T14:47:42.642Z`. Input and
output CRS: `EPSG:4326`. Manhattan membership used source predicates, not a
bbox: NTA `boroname=Manhattan and borocode=1`, Parks `borough=M`, and LPC
`boroughid=MN`. Before/after update tokens and metadata checksums matched.

| Source / registry ID | Exact dataset query and predicate | Source update / token | Rows / accepted / rejected / remainder / collisions | Missing location | Raw bytes / SHA-256 | Metadata bytes / SHA-256 |
| --- | --- | --- | --- | ---: | --- | --- |
| DCP NTA / `nyc.nta-2020` (`9nt8-h7nd`, mapped `4hft-v355`) | `https://data.cityofnewyork.us/resource/9nt8-h7nd.json?$select=borocode,boroname,countyfips,nta2020,ntaname,ntaabbrev,ntatype,cdta2020,cdtaname,shape_leng,shape_area,the_geom&$where=boroname='Manhattan'&$order=nta2020&$limit=50000` | `2026-05-28T15:11:19.000Z`; token `1779981079` before/after; release `26b` | 38 / 38 / 0 / 0 / 0 | 0 | 372,694 / `2f74399bcb2c13f4384376398ec315d895d03715108299bab2047966378b9ab7` | 21,824 / `025e79ffc3ec72d615ec60af877bc182d0430a551ee3b26cd92cf4f0da381439` |
| NYC Parks / `nyc.parks-properties` (`enfh-gkve`) | `https://data.cityofnewyork.us/resource/enfh-gkve.json?$select=acquisitiondate,acres,address,borough,class,communityboard,councildistrict,department,gisobjid,gispropnum,globalid,jurisdiction,location,mapped,name311,nys_assembly,nys_senate,objectid,omppropid,parentid,permit,permitdistrict,permitparent,pip_ratable,precinct,retired,signname,subcategory,typecategory,us_congress,waterfront,zipcode,multipolygon&$where=borough='M'&$order=gispropnum,objectid&$limit=50000` | `2026-07-17T13:40:16.000Z`; token `1784295616` before/after | 395 / 395 / 0 / 0 / 0 | 0 | 1,377,396 / `bb99c2aa85c7db48c543592da1a8570d779475a89cde4d07822452211625252b` | 53,309 / `30b269c1c99e694c0b26024519076ce5ee0330f3e263151ad48b8a85804733f5` |
| LPC / `nyc.lpc-sites` (`ncre-qhxs`) | `https://data.cityofnewyork.us/resource/ncre-qhxs.json?$select=bin_number,bbl,boroughid,block,lot,lp_number,lm_name,pluto_addr,desig_addr,public_hea,lm_type,hist_distr,other_hear,boundaries,most_curre,status,last_actio,count_bldg,non_bldg,vacant_lot,secnd_bldg,desdate,caldate,latitude,longitude,council,cd,bct2020,nta2020,location&$where=boroughid='MN'&$order=lp_number,bin_number,bbl,block,lot&$limit=50000` | `2026-06-18T14:42:53.000Z`; token `1781793773` before/after | 15,313 / 15,313 / 0 / 0 / 0 | 10 | 10,448,592 / `b8fb4beafe91d3613e26b071c85ff21baf4925eff2b06d06b0900ad7b3c23fdf` | 58,415 / `3e068caf0f7f3db696d909665abd011a8d583c502553106af24259da1c1b3d22` |

The raw response, request headers, before/after metadata, acquisition manifest,
and checksums are retained under ignored
`data/raw/travel-context-wave-20260804/`. The acquisition was immutable,
bounded to 100,000,000 bytes and 60,000 ms, explicit about dataset IDs and
predicates, and refused overwrite.

Normalization A/B both emitted EPSG:4326 records with these stable checksums:

| Dataset | Normalized bytes | Normalized SHA-256 | Quarantine bytes / SHA-256 | Parent result |
| --- | ---: | --- | --- | --- |
| `9nt8-h7nd` | 463,762 | `2570bb1b83f8ef172e5142cf9f5231382279e609e5d91e0a6d1adce76c1bfb1b` | 2 / `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 38 statistical areas |
| `enfh-gkve` | 3,612,648 | `db1eff082895f57093cdc57b3c64b687309f7e0b0f4a8996931b28127e040aa5` | 2 / `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 395 park parents keyed by `GISPROPNUM` |
| `ncre-qhxs` | 23,856,125 | `5aaf95732948b842a4092e755813e9eeb057e91e2b9c583771a9cec88cad1a45` | 2 / `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 1,140 reversible LPC parents; 10 no-location observations |

The normalized quarantine arrays are empty (`[]`); the 2-byte files are their
stable JSON representation. For every source, input rows equal accepted plus
rejected, with zero unexplained remainder and zero identity collisions.

## 4. Immutable release

| Field | Value |
| --- | --- |
| Release / base | `manhattan-civic-context-20260804` / `manhattan-citywide-20260804` |
| Schema / city / CRS | v2.0 / Manhattan / EPSG:4326 |
| Declared incremental bytes | 22,424,795 (40 MiB cap) |
| Shards | 114 geometry, 307 search, 52 detail; 473 total content shards |
| Detail index | 1,573 entries; 294,861 bytes; SHA `1228fbcd1e9e9ab4eec56d2fa454aea92bf723adfd3a4083fc390d55d645deb8` |
| Published manifest | SHA `225aba4efb041b26c38932b265f927373ec8974f0fb4a5e63e34baefd07da2a2`; `fixtureOnly=false` |
| Layers | statistical areas 38/38; Parks 395/395; LPC 1,140 parents/1,130 placed render parts |
| Coverage | snapshot-relative all-records-accounted; overlap candidates 1,573; replay stable |

Every manifest path is local and checksum-addressed. Staging validation and the
published copy both pass; publish-local refused overwrite and left the old
release unchanged. The new package stays under the 256 KiB root-manifest,
2 MiB geometry-shard, 1 MiB search/detail-shard, 4 MiB detail-index, 640-shard,
48 MiB cache, and 40 MiB incremental payload limits. The old citywide manifest
remains `acb5a9b52014f86535c8478e7d4e516efc03f6dff95c17e9896dfea4413c203c`.

Published benchmark (fixed 45 search queries and 30 detail lookups): cold
search p95 `10.901416 ms`, warm search p95 `9.911334 ms`, cold detail p95
`0.229749 ms`, warm detail p95 `0.148958 ms`, cold total `311.900 ms`, warm
total `289.432 ms`. Initial local civic browser load was 24 requested/loaded
shards, 0 failures, 479,388 bytes, and 568 decoded features; the runtime keeps
layer loads independent and caps its shared cache.

## 5. Runtime, UX, and truth behavior

The implementation adds generic v2 typed contracts in `src/domain/schema.ts`,
source registry evidence in `src/data/source-registry.ts`, release validation
and deterministic ordering in `src/release/travel-context-release.ts`, and
lazy local-only loading/fault isolation in
`src/runtime/travel-context-release-runtime.ts`. `src/runtime/layers.ts` keeps
the original layer keys while adding statistical areas, Parks, and landmarks.
`App.tsx` and `CesiumViewport.tsx` expose the civic mode, source facets,
source-ID/name search, canonical detail URLs, release-pinned bookmarks,
Back/Forward restoration, overlap chooser, focus return, and layer status.

Verified examples:

- `MN6491` / `Central Park` → `udt:manhattan:nta:MN6491`, labelled `2020 NTA
  (statistical)`;
- `M001` / `Abingdon Square` → `udt:manhattan:park:M001`, labelled `NYC
  Parks-managed property`;
- `LP-00006` / `Old Merchant's House (Seabury Tredwell House)` →
  `udt:manhattan:lpc:LP-00006`, labelled `LPC landmark record`.

Details preserve source IDs, relationships, capture/update dates, attribution,
and unknown values. They explicitly avoid claims about vernacular-neighborhood
authority, current condition/use, public access, hours, amenities, ratings,
reviews, photos, shops completeness, live transit/status, routing, or facade
fidelity. Missing-location LPC observations remain detail/search records and do
not receive invented map geometry. Faults are injected only through a local
test seam: a missing Parks geometry shard announces `Layer failures isolated:
parks`; an LPC detail fault announces `Layer failures isolated: landmarks` and
does not substitute another record.

## 6. Browser and accessibility evidence

All civic browser resources were app-origin local files; provider domains were
not requested and clean/fault/reduced-motion journeys had no application
errors/warnings. A Vite debug HMR line appeared only after the documentation
edit. Durable page/session references and metrics from the Orca run are embedded
in the journey matrix below; any local browser captures under `artifacts/**`
are diagnostic only and intentionally untracked/excluded.

| Journey | Evidence |
| --- | --- |
| Cold civic desktop, 1440×900 | Page `680129a7-2bdf-4b0e-ac6a-65dd756aa6cd`; 24/24 shards, 0 failures, 479,388 bytes, 568 features; three civic controls and old Buildings/Restaurants remain visible. |
| NTA search, name/source ID, cold URL/history | `MN6491` and `Central Park` resolved to the same canonical ID; URL reload and Back/Forward retained release/feature state and statistical caveat. |
| Parks search/pick/toggle/bookmark | `M001` and `Abingdon Square` matched the same canonical ID; layer toggle removed/reloaded only Parks; bookmark retained release ID. |
| LPC search/detail/deep-link | `LP-00006` and official name resolved to the same canonical ID; detail preserved LPC caveat and release-pinned URL. |
| Overlap/focus | Deterministic candidate ordering and keyboard-accessible chooser are covered by runtime/domain tests; closing the inspector returned focus to `Search Manhattan` in the desktop run. |
| Parks fault | Page `ae0522b5-b7f4-4ff7-a26e-8f34f315c351`; isolated Parks status, 463 unaffected loaded features, no console/provider request. |
| LPC detail fault | Page `0c0dec41-e309-493d-b1be-dfae9c0a05f8`; LP-00006 stayed a real LPC record with unknown/loading detail, isolated landmarks alert, and no substitute. |
| Mobile 390×844 | Page `fd8063ef-cc56-4523-bbb5-0aa105feb9c1`; no horizontal overflow, semantic controls/search, 24/24/0 metrics, 479,388 bytes. |
| Reduced motion | Page `cf32460d-c596-4201-ab7d-18889febeff5`; `prefers-reduced-motion` matched true, no overflow/errors/network violations. |
| Old-mode regression | Page `9be33f60-b1e5-4579-b989-de79456b75e3`; `manhattan-citywide-20260804`, 8,192 decoded/features, 0 failures, no civic facets, old labels intact. Fixture smoke `50ee2bb3-be4a-476e-a333-a2747e43360c` retained its synthetic disclaimer; valid pilot smoke `e5f3df96-e945-4bb4-a71d-212bdc0d36f4` retained bounded pilot labeling and three approved assets. |

### CP5 frame evidence and known validation issue

The accepted performance measurement is a direct focused-page
`requestAnimationFrame` probe after a 3-second settle: visible/focused page,
340 frames, median 8.3 ms, p95 16.6 ms. This is the evidence used for the CP5
frame budget. The unchanged seven-anchor harness was also run twice and emitted
11 frames over approximately 1008 ms per anchor; page visibility/focus were
confirmed true and the direct probe remained healthy. This discrepancy is a
known harness-validation artifact and is documented rather than “fixed” by
changing the unchanged harness or weakening the product budget.

## 7. Automated checks and protected proofs

The final validation results are embedded in this record and Decision 0014. They
include:

- `pnpm typecheck`, `pnpm lint`, `pnpm test -- --run` (29 files, 165 tests),
  `pnpm build`, `pnpm citywide:validate`, and `pnpm citywide:benchmark`;
- every focused command named by the plan, plus both civic release test files;
- all eight civic aliases with `--help`, raw validation, normalization A/B,
  coverage replay, staging/public release validation, and staging/public
  benchmarks;
- `git diff --check`, path/secret/generated scans, no staged paths, and no
  package dependency or lockfile change;
- old citywide manifest SHA and protected landmark hashes.

Protected landmark SHA-256 values were unchanged:

```text
41fd7e909fc82c5910308da1955ed9f81cc84902fb338224b1a2cf8cce0604e  manifest.json
1062622b08d456d2011b744da83dd6d6ccfda399f0a8e5635436cea6ed2a4d80  empire-state-building/lod0.glb
ccbd194969405a2bfdff734e089de8528ef7c382729c459c570e64823ba39511  empire-state-building/lod1.glb
89ea83cff781dc52bdd853fb855c7fa61c0617442429c4334e2ad5b42c602db2  flatiron-building/lod0.glb
7a7c2c7467966d8ca77e4fb0a7ffad73418fcd0ae19a7ea5d2e38fb6aac5e38c  flatiron-building/lod1.glb
70723b90da12a30fdbc5306897ba957ab439178a6ce51d819edf1c656422ae01  theodore-roosevelt-birthplace/lod0.glb
3d76db1a843ebf59bb62499591d86e44daa0c023e904955d118be060008f2a32c  theodore-roosevelt-birthplace/lod1.glb
```

## 8. Documentation audit matrix

The exact affected set is listed below. Every row is linked to the approval,
release manifest, source registry, code/tests, or browser evidence above; no
new source or unsupported current-state claim was added.

| Document | Audit/update purpose | Evidence anchor |
| --- | --- | --- |
| `README.md` | Current civic release setup, counts, caveats, validation, rollback links | Sections 1, 3, 4, 7 |
| `docs/PROJECT_BRIEF.md` | Current real-release state and product limits | Sections 1, 5 |
| `docs/design/PRIMARY_SCREEN.md` | Civic controls, detail truth, accessibility | Section 5 and browser matrix |
| `docs/research/MANHATTAN_AREA_RESEARCH.md` | DCP approval, predicate, CRS, statistical caveat | NTA source row |
| `docs/research/MANHATTAN_POI_RESEARCH.md` | Parks/LPC approval, corrected update times, terms/unknowns | Parks/LPC source rows |
| `docs/research/PLACE_TRUTH_SOURCE_MATRIX.md` | Scope, attribution, exclusions, limitations | Sections 1, 5 |
| `docs/research/MANHATTAN_CATALOG_RELEASE_ARCHITECTURE.md` | v2 manifest/shards/budget/accounting | Section 4 |
| `docs/research/MANHATTAN_STREAMING_ARCHITECTURE.md` | Lazy local streaming/cache/fault isolation | Sections 4–6 |
| `docs/research/RUNTIME_SLICE_FOUNDATION.md` | Generic adapter and old-mode coexistence | Section 5 |
| `docs/research/EXPLORATION_INTERACTION_CONTRACT.md` | Search/URL/overlap/failure semantics | Sections 5–6 |
| `docs/research/VISITOR_NAVIGATION_CONTRACT.md` | Back/Forward/bookmark/focus semantics | Section 6 |
| `docs/research/REAL_DATA_RUNBOOK.md` | Exact aliases, bounded acquisition/replay/publish | Sections 1, 3, 7 |
| `docs/codex/PLACE_TRUTH_IMPLEMENTATION.md` | Civic runtime and evidence cross-link | Sections 4–6 |
| `docs/codex/MANHATTAN_TRAVEL_EXPERIENCE_NEXT_WAVE_PLAN.md` | CP0–CP6 status, rAF evidence, harness issue, CP7 boundary | This record and Decision 0014 |
| `docs/codex/AGENT_WORKFLOW.md` | Visible-agent/review state for this work unit | CP7 status |
| `docs/decisions/0014-nyc-civic-context-wave.md` | Decision, approval, exclusions, rollback | Sections 1 and 4 |

## 9. Work-unit paths and exclusions

The scoped CP7 delivery set is the explicit coordinator-confirmed list of civic
code/tests/scripts/package aliases and the exact documentation set outside
`artifacts/**`. Local civic evidence files and any raw/normalized/published
payloads remain ignored, intentionally untracked, and never delivery
candidates; the required evidence is embedded in this record and Decision
0014. Push verification follows/is recorded in Git history.

The following current dirty paths are explicitly excluded from this work unit:
`docs/research/MANHATTAN_TRANSIT_RESEARCH.md` (pre-existing user change), all
local/new and pre-existing `artifacts/**` (including `artifacts/blender/**`),
protected
`public/assets/landmarks/**`, existing `public/data/manhattan-citywide-20260804/**`,
OTI/DOHMH raw/normalized/quarantine roots, lockfiles, `AGENTS.md`, and all
unrelated user files. No destructive Git command was used.
