# Manhattan citywide buildings and restaurants wave

Status: implementation handoff for Luna Max; planning only, 2026-08-04

Required scope: all-Manhattan coverage from NYC OTI Building Footprints
`jh45-qr5r` and NYC DOHMH Restaurant Inspection Results `43nn-pn8j` only

Approval state: **approved for this exact local citywide wave** by the user's
Orca decision-gate reply `msg_91770ac6d098`. The approval extends the two named
sources to local all-Manhattan acquisition, retention, derived spatial/search/
detail artifacts, and local browser display; it does not approve a new provider,
Google-derived data, public deployment, or unrelated datasets. Luna must retain
this message ID in the acquisition/release evidence rather than rewriting the
older pilot decision as if it had always been citywide.

This wave replaces the bounded-only delivery path with a provider-neutral,
multi-city release contract. It does not add a provider, claim a complete
business directory, add routing/transit/facades, or produce photorealistic
Manhattan. It preserves the verified landmark package and uses procedural massing
for all other buildings.

## 1. Requirements

### 1.1 Functional requirements

1. A separately versioned, immutable release must cover every Manhattan record
   accounted for by the approved, dated captures of the two named datasets. It
   must not redefine success as the existing pilot bbox.
2. At any supported Manhattan camera anchor, panning/zooming must load only the
   geometry partitions needed for the viewport and bounded prefetch ring.
   Full-Manhattan geometry must never be parsed into one browser array.
3. A citywide search contract must find DOHMH restaurants by CAMIS, name, source
   ID, address token/prefix, cuisine, and category, and buildings by canonical
   ID, DOITT_ID, BIN, BBL where supplied, and non-placeholder source name.
   Search summaries and exact-ID lookup must not require geometry downloads.
4. Search result, Cesium pick, and deep link must resolve the same stable parent
   canonical ID. Selection may lazily fetch a checksum-pinned detail shard.
5. Back, Forward, reload, mode switch, layer toggle, and an unavailable release,
   tile, shard, or feature must behave deterministically. No missing real ID may
   resolve to a fixture or same-name substitute.
6. Buildings render as source-footprint procedural massing with source height
   when supported and an explicit unknown/minimum visual fallback otherwise.
   The six verified landmark GLBs retain their existing package selection path.
7. DOHMH points render as a dense Cesium point collection. Only the selected
   place receives a semantic entity/label. Building instances and points retain
   stable pick IDs.
8. The app must expose release ID, scope, source attribution, capture/update
   dates, coverage/accounting counts, and failure/fallback state.
9. Runtime files are local static release artifacts. The browser must make no
   NYC, Google, OSM, Overture, MTA, or other provider request.

### 1.2 Data-truth requirements

1. `DOITT_ID` is the stable building parent identity. `OBJECTID` is acquisition
   bookkeeping only; BIN/BASE_BBL/MAPPLUTO_BBL are searchable evidence, not
   substitutes for building identity. Multipart render parts must resolve to the
   stable DOITT parent.
2. `CAMIS` is the stable DOHMH permit/place group identity. DBA, address,
   coordinates, cuisine, grade, action, and dates are observations that may
   change or conflict. Row digests remain source-observation IDs.
3. Inspection grade/score/action is regulatory inspection history—not a user
   rating, review, popularity measure, opening hour, current open/closed status,
   or proof of business existence. The UI must never use rating stars, “open
   now,” or directory-completeness copy for DOHMH.
4. Preserve raw source values, capture timestamp, provider truth/update
   timestamp, observation date, terms URL, attribution, dataset ID, source IDs,
   checksum, CRS, height unit, vertical-datum uncertainty, and rejection reason.
5. `HEIGHT_ROOF` remains a feet-equivalent source value normalized by `0.3048`;
   `GROUND_ELEVATION` remains raw with unknown numeric unit and no invented meter
   value. Missing height, name, coordinates, or inspection fields stay unknown.
6. A restaurant with valid Manhattan/CAMIS evidence but no usable point remains
   in search/details as `location unavailable`; it is counted as unlocated and
   gets no map marker. Do not silently drop it or invent a geocode.
7. Omission is not deletion. A later release may tombstone an identity only from
   explicit authoritative source evidence, never because a page/tile was absent.
8. The citywide claim is snapshot-relative: “all Manhattan records accounted
   for in these captures,” not all buildings/businesses existing in reality.

### 1.3 UX and accessibility requirements

1. Replace bounded-pilot copy only in citywide mode. Keep Fixture and bounded
   pilot labels truthful and independently selectable until the citywide release
   passes every gate.
2. Search begins after two normalized characters except exact canonical/source
   ID lookup. It exposes loading, no-result-with-coverage-caveat, unavailable,
   and stale-release states without blocking keyboard navigation.
3. Search remains a labelled combobox/listbox with deterministic result order,
   Arrow key navigation, Enter selection, Escape dismissal, visible focus, and
   screen-reader status for shard loading/result count.
4. Selection moves focus to the details heading; close returns focus to the
   invoking result/map control. Map-only information must also exist as text.
5. Honor `prefers-reduced-motion`; mobile controls at 390x844 must not cover the
   selected marker/details action, and desktop at 1440x900 must avoid overflow.
6. Unknown/stale/unlocated/source-backed facts use text, not color alone.

### 1.4 Performance requirements

Measured baseline evidence is in section 2. The following are conservative
**provisional citywide budgets**. Luna must record Checkpoint 0 pilot measurements
and may tighten them; exceeding them requires stopping and reporting, not silently
raising a constant.

| Budget | Gate |
| --- | --- |
| Root release manifest | <= 256 KiB uncompressed |
| Any geometry content shard | <= 2 MiB uncompressed and <= 2,000 features |
| Any search/detail shard | <= 1 MiB uncompressed |
| Total local citywide runtime release | <= 300 MiB uncompressed; generated/raw evidence is separate |
| Partition count | <= 512 total content shards; otherwise report architecture/hosting implications |
| First fixed-camera citywide load | <= 12 MiB release data, <= 16 release requests after manifest, <= 4 concurrent |
| Runtime cache | <= 24 content shards and <= 48 MiB declared bytes; eviction leaves no stale rendered primitives |
| Rendered dense features | <= 6,000 at a settled fixed camera; split/refine selection if exceeded |
| Search | warm p95 <= 100 ms; cold local-shard p95 <= 500 ms over 30 fixed queries |
| Pick/details | cached p95 <= 100 ms; cold local-shard p95 <= 500 ms over 30 fixed picks |
| Fixed-camera render proxy | after 3 s settle, median frame interval <= 33.3 ms and p95 <= 50 ms over 10 s, with no >20% regression versus measured pilot on the same machine |
| Heap, where Chromium exposes it | settled used-heap increase <= 128 MiB over pre-citywide mode and second six-anchor tour ends within 20% of the first tour; otherwise record “unsupported” and enforce cache metrics |

The initial Vite bundle is a separate baseline: current build output is
4,523.27 kB minified / 1,218.41 kB gzip and already emits the >500 kB chunk
warning. This wave must not materially increase it (>5% raw or gzip) without a
measured code-splitting explanation.

### 1.5 Licensing, provenance, and regression requirements

1. Provider calls require the citywide approval gate in section 4. Public
   deployment/redistribution is a separate gate; local approval does not imply it.
2. Preserve the City/agency disclaimer, terms URL, agency/dataset attribution,
   application-notification obligation recorded by prior research, correction/
   discontinuation caveat, capture/checksum, and conditional retention/derivative
   policy in source and release manifests.
3. No Google Maps, imagery, Street View, Places, reviews, ratings, screenshots,
   extraction, or derived commercial content. No new provider, package, paid or
   credentialed service.
4. Existing Fixture mode, bounded real pilot, routes, navigation state, details,
   dense synthetic stress harness, and landmark package must keep passing.
5. Generated datasets remain ignored. The scoped Git diff contains code/tests
   and intentional manifests/contracts only, never raw or generated production
   payloads.

### 1.6 Required scope versus follow-ups

Required in this wave: both named citywide snapshots; stable normalization;
accounting/coverage evidence; compact versioned release; WGS84 spatial geometry
shards; sharded search and details; camera-driven loading; selection/deep links;
truthful UI; deterministic tests and browser evidence.

Optional later stages, not acceptance substitutes: official borough polygon
source after separate approval, other POI categories, MTA/transit, streets and
routing, facade/imagery work, true OGC 3D Tiles multi-LOD production publishing,
worker/IndexedDB optimization, hosted object storage/CDN, and other cities. The
release schema must keep `cityId`, `boundaryEvidence`, layer IDs, CRS, LOD, and
source groups generic so those stages do not require a Manhattan rewrite.

## 2. Authoritative current-state inventory

### 2.1 Approval and decisions

- `AGENTS.md` requires visible Sol planning -> Luna Max implementation/test/fix
  loops -> root Sol High orchestration/final or high-risk review. Root must not
  implement. Claude remains disabled.
- `docs/decisions/0012-real-data-wave-20260804.md` approves an immutable pilot at
  west `-74.005`, south `40.738`, east `-73.982`, north `40.752`. It explicitly
  says not to rerun the 133-batch Manhattan building envelope without a new
  budget/review and denies citywide completeness/redistribution clearance.
- `src/data/source-registry.ts` marks both entries `approved` only because their
  notes narrow approval to that bounded pilot. Both retain conditional raw
  snapshot/derivative policy and legal-review access constraints.
- `docs/research/REAL_DATA_RUNBOOK.md` is pilot-only and requires a new full-city
  budget, deterministic replay evidence, and quarantine of partials.
- `docs/decisions/0010-place-truth-contract-and-approval-gates.md` preserves
  provider-specific truth states and forbids Google-derived content.

### 2.2 Immutable pilot evidence and counts

| Evidence | Current authoritative local value |
| --- | --- |
| Building raw snapshot | `data/raw/real-wave-20260804/manhattan-building-pilot-20260804.geojson`; 3,532 records; 2,788,919 bytes; SHA-256 `cf311cd757564fe9cc75f8dc6a60d42c643bb402db4d811f448338ff5f6a18fb` |
| Building acquisition | 15 POST batches of 250, 30 s timeout; capture `2026-08-04T03:06:16.621Z`–`03:08:28.735Z`; 0 missing IDs |
| DOHMH raw snapshot | `data/raw/real-wave-20260804/dohmh-restaurant-pilot-20260804.socrata.json`; 13,727 observations; 12,553,266 bytes; SHA-256 `6cfbbfaa08c7505ccfecd3fe34742ba31e94c98e4a71d959e9816c0faabb1dea` |
| DOHMH normalized | 1,653 CAMIS groups, 0 rejected; records SHA-256 `cfec0c148d438dd1ecde5e5bb0ed1b1cfc8ff9851b360df63e79745b79ebf011` |
| Browser pilot | manifest 1,146 bytes; buildings 10,973,921 bytes / 3,532; restaurants 4,972,010 bytes / 1,653; all eagerly loaded |
| Catalog pilot | 5,185 canonical entities, 17,259 observations, four LOD-12 partitions; `catalog-release.json` 91,164,392 bytes, `search-index.json` 47,785,145 bytes |
| Saved candidate envelope IDs | `data/raw/real-wave-20260804/building-ids.json`; 132,410 unique OBJECTIDs for envelope `-74.03,40.68,-73.91,40.88`; candidate evidence only, not an accepted Manhattan boundary |
| Quarantine | ~241 MiB aborted/partial building and unrelated oversized DOHMH terms files under `data/raw/real-wave-20260804/quarantine/`; excluded from every manifest |

The browser payload expands a 2.79 MB raw building snapshot to 10.97 MB and a
single pilot eagerly parses ~15.95 MB. Linear citywide reuse is therefore
disallowed. The 91 MB release and 47.8 MB recursively flattened search index
already fail the citywide shape despite having only 5,185 entities.

### 2.3 Existing reusable seams and bottlenecks

- `scripts/acquire-nyc-building-snapshot.mjs` already sorts/deduplicates supplied
  OBJECTIDs, batches POST requests, retries, refuses overwrite, requires complete
  ID replay, hashes the snapshot, and records a manifest. Its defaults, hard-coded
  release name/query URL, and envelope-clipping claim are pilot-bound.
- `scripts/normalize-dohmh-pilot.mjs` creates stable sorted-row digests and CAMIS
  match keys but assumes every row has coordinates and has no acquisition or
  pagination contract. The pilot order key has many ties: 3,395 of 4,330
  `(camis, inspection_date, record_date)` groups contain duplicates (max 17).
- `scripts/run-nyc-building-ingest.mjs` and
  `src/ingestion/nyc-building-footprints.ts` enforce checksum/terms/schema,
  normalize heights, preserve provenance, and build stable parent IDs. They
  clip every feature to the approximate pilot `manhattanAdapter` rectangle and
  emit verbose whole-layer JSON.
- `scripts/build-real-wave-artifacts.mjs` and
  `scripts/build-browser-pilot-partitions.mjs` hard-code release ID, pilot scope,
  two whole-layer partitions, and eager browser paths.
- `src/release/catalog-release.ts` and
  `docs/research/MANHATTAN_CATALOG_RELEASE_ARCHITECTURE.md` provide deterministic
  stable serialization, safe paths, checksums, source gates, WGS84 tile keys,
  exact/search indexes, journal/replay, and atomic publication. The current
  release embeds too much feature/provenance data and only emits LOD 12.
- `src/runtime/tile-package.ts`, `src/runtime/tile-stream.ts`, and tests provide
  fail-closed package validation, WGS84 tile selection, concurrency, abort,
  generation fencing, and byte/tile LRU metrics. Selection currently picks only
  a center tile per layer (or nearest fallback), not viewport-intersecting tiles.
- `src/runtime/real-pilot-manifest.ts` validates local path/schema/count/byte
  size/SHA/source IDs and rejects full DOHMH history, but fetches both entire
  partitions with `Promise.all`.
- `src/runtime/fixture-adapter.ts` stores every feature, performs linear
  `find`/filter/search, and `loadLayerFeatures` walks every tile. App construction
  passes all real records to this adapter; this is pilot-only.
- `src/domain/exploration.ts` rebuilds DOHMH search documents and scans every
  feature on each query. It has truthful ranking but no citywide index seam.
- `src/features/explorer/CesiumViewport.tsx` already batches ordinary buildings
  in one `Primitive` and POIs in one `PointPrimitiveCollection`, maps pick IDs,
  and keeps a selected POI entity. Any dense feature change currently removes
  and rebuilds all app-owned primitives synchronously (`asynchronous: false`).
- `src/app/App.tsx` eagerly loads the pilot on mount even in Fixture mode, creates
  an all-feature adapter, and passes all dense features to Cesium. It already has
  truthful mode/deep-link fallback, keyboard search, details, Data panel, and
  landmark integration to preserve.
- `public/assets/landmarks/landmark-wave-20260804/manifest.json` and its six GLBs
  are verified and immutable. Their protected SHA-256 values are:
  `89ea83...c602db2`, `7a7c2c...ac5e38c`, `106262...2a4d80`,
  `ccbd19...39511`, `70723b...2ae01`, and `3d76db...f2a32` (use the full values
  from the manifest during validation).

### 2.4 Baseline validation and dirty boundary

Planning validation on this authoritative dirty tree passed:

```text
pnpm typecheck                         pass
pnpm test -- --run                    23 files / 110 tests pass
pnpm lint                              pass
pnpm build                             pass; existing >500 kB bundle warning
git diff --check                       pass
```

The worktree already contains authorized modified and untracked work across
`AGENTS.md`, research/decisions, app/runtime/ingestion, public pilot data,
landmarks, and Blender evidence. Luna must capture `git status --short` at each
checkpoint and never reset, clean, checkout, blanket-format, or overwrite it.
Only section 6 is authorized.

## 3. Ranked risk analysis

| Rank | Risk | Severity | Likelihood | Mitigation | Stop/escalation condition |
| --- | --- | --- | --- | --- | --- |
| 1 | Narrow citywide approval is accidentally treated as broader provider/public-deployment clearance | Critical | High | Cite `msg_91770ac6d098` in manifests and preserve its exact two-source, local-only exclusions; keep public deployment and every new source separately gated | Stop if the durable reply is unavailable/ambiguous or work would cross its stated limits |
| 2 | Envelope is mistaken for authoritative Manhattan | Critical | High | Treat 132,410 IDs as candidates only; compare same-source Manhattan-coded BIN/BBL sets, candidate envelope set, accepted/quarantined sets; record all differences | Stop if source-internal fields are absent/ambiguous/conflicting or any candidate cannot be classified; a borough polygon would be a new gated source |
| 3 | Mutable acquisition is incomplete/non-reproducible | Critical | Medium/High | Pin query/fields/order, pre/post source truth, count, headers, pages, checksums; exclusive-create outputs; replay locally; no offset pagination without stable unique order | Stop on metadata drift, count drift, duplicate/missing page IDs, no stable DOHMH pagination key, unavailable endpoint, or partial output |
| 4 | DOHMH semantics become consumer truth | High | High | Typed observation/place separation, sentinel/missing states, copy tests, inspection labels, unlocated records | Stop if UI needs rating/hours/status/popularity or source dictionary cannot support a field |
| 5 | Identity churn or false merge | High | Medium | DOITT parent and CAMIS parent; deterministic child parts; row digest observations; no cross-provider merge; collision reports | Stop on duplicate DOITT parent, conflicting CAMIS identity, parent ID change from pilot replay, or order-dependent multipart IDs |
| 6 | Monolithic artifacts overwhelm repository/browser | Critical | High | Compact transport separate from domain record, <=2 MiB geometry shards, <=1 MiB index/detail shards, ignored immutable release, pre-publication size gate | Stop at >200k building candidates, >250k DOHMH rows, any raw source >300 MiB, generated release >300 MiB, any shard over budget, or >512 shards; report measurements |
| 7 | Cesium main-thread/frame/picking degradation | High | High | Viewport tile selection, bounded concurrency/cache, per-tile primitive ownership, incremental add/remove, async geometry where possible, stable parent pick map | Stop on WebGL/console errors, stale/duplicate picks, >6k visible dense features, budget failure, or need for a new rendering engine/service |
| 8 | Search index is globally eager or slow | High | High | Prefix/exact-ID sharded compact index; minimum two characters; cached summaries; fixed corpus latency tests | Stop if implementation requires loading every feature/detail, a >1 MiB shard, >32 MiB total search assets without review, or misses stable ID lookup |
| 9 | Missing/stale facts or failed shards are hidden | High | Medium | Explicit release/source dates and unknown/unlocated states; checksum every payload; shard-scoped unavailable UI; fixture fallback only at mode boundary | Stop if a failed real tile/detail silently substitutes fixture data or a stale release appears current |
| 10 | Shared dirty-worktree changes are overwritten | Critical | High | Per-checkpoint scoped status/diff, new versioned paths, reverse only Luna-owned hunks, quarantine new outputs | Stop on unexplained overlap, changed protected hash, baseline failure outside scope, or rollback that would touch prior work |
| 11 | City-specific shortcut blocks later cities | Medium/High | Medium | Generic release contracts keyed by city/layer/CRS/source; Manhattan membership is build evidence, not renderer logic | Stop if runtime imports NYC query/schema or hard-codes the pilot bbox/provider URL |

## 4. Source and approval decision

No source research or provider browsing is needed to make this decision; local
primary evidence and accepted decisions are sufficient.

| Source | Current decision | Citywide implication |
| --- | --- | --- |
| NYC OTI Building Footprints `jh45-qr5r` | **Accept for this local citywide wave** | Pilot approval alone was insufficient, but the user resolved the new budget/scope gate in Orca reply `msg_91770ac6d098`. The accepted scope is all-Manhattan capture, raw retention, derived compact geometry/search/detail artifacts, and local browser display. Preserve OTI attribution, NYC terms/disclaimer, capture/source update, checksum, IDs, CRS and height/vertical uncertainty. Conditional retention and derivative review remain; no public deployment/redistribution is approved. |
| NYC DOHMH Restaurant Inspection Results `43nn-pn8j` | **Accept for this local citywide wave** | The same reply approves `boro='Manhattan'` capture, all observations including unlocated records, raw retention, derived index/detail/point artifacts, and local browser display. Preserve DOHMH/dataset attribution, DataMine terms and prescribed disclaimer/application-notification obligations recorded locally, capture/source dates, CAMIS, observation history, checksum, and correction/discontinuation caveat. No directory completeness/current status/ratings/hours and no public deployment/redistribution are approved. |
| Any other source, including NYC borough boundaries | **Reject for this wave** | Do not query, download, import, or use it to patch coverage. If the two approved source schemas cannot prove Manhattan membership, stop and request a separately scoped source/architecture decision. |

The coordinator-facing decision gate is resolved by `msg_91770ac6d098`. Luna
must cite that ID in raw and release evidence and may update only the two registry
notes to reflect the newly accepted scope; Luna must not broaden it. Public
deployment/redistribution remains excluded.

## 5. Ordered implementation checkpoints

Every checkpoint ends with its tests, scoped diff, and rollback record before
the next begins. The approval prerequisite for Checkpoint 2 is satisfied only by
the exact limits in `msg_91770ac6d098`; all other gates remain.

### Checkpoint 0 — freeze baseline, ownership, and gate

1. Re-read `AGENTS.md`, this plan, Decision 0012, the runbook, both registry
   entries, architecture notes, and current status/diff.
2. Save text evidence under `artifacts/citywide-wave-<release>/baseline/`
   (ignored or untracked evidence only): status, diff stat/check, four validation
   outputs, pilot file sizes/hashes/counts, landmark manifest hashes, and build
   bundle sizes. Do not copy datasets.
3. Record decision-gate reply `msg_91770ac6d098` in baseline evidence and verify
   the working brief still excludes new providers, Google data, public deployment,
   and unrelated datasets. Any ambiguity or unavailable durable record reactivates
   the stop condition; do not infer a broader approval.
4. Run the pilot browser journeys in section 8 and record console/network/frame/
   pick/search measurements on the same machine used for final comparison.

Completion evidence: all current checks pass or unrelated failures are reported;
dirty paths and protected hashes are recorded; citywide approval message
`msg_91770ac6d098` and its exclusions are quoted exactly in evidence.

Rollback point: no product files change. Remove only newly created baseline text
evidence by moving its invocation-owned directory to an external task-specific
temporary directory; never delete prior artifacts.

### Checkpoint 1 — citywide release contract with synthetic scale fixtures

1. Add a versioned provider-neutral contract for: release root; source snapshot
   evidence; boundary/accounting evidence; layer/tile/shard declarations; compact
   search summaries; detail references; content byte size/SHA-256; freshness;
   fixture flag; and explicit fallback state.
2. Define compact transport records separate from verbose domain `Feature`:
   building parent/part geometry, restaurant marker summary, search summary, and
   detail record. Hydrate full domain/detail data only on demand.
3. Require safe relative POSIX paths under the selected release root, no URL,
   traversal, duplicate IDs/content refs, count mismatch, unrecognized source,
   unsupported CRS, oversized shard, or missing checksum.
4. Add deterministic synthetic fixtures spanning at least Battery/Financial
   District, Chelsea/Midtown, Upper West, Upper East, Harlem, Inwood/Marble Hill,
   and Roosevelt Island-like anchors. They are invented and labelled fixture.
5. Extend tile selection from one center tile to viewport-intersecting L14 tiles
   plus at most one bounded prefetch ring. Allow deterministic sub-shards for a
   dense tile. Keep supported layer IDs generic.
6. Add sharded exact-ID/token-prefix search: query normalization and ranking are
   pure; two-character token prefix selects declared shards; exact canonical,
   DOITT/BIN/BBL/CAMIS lookup selects deterministic ID shards. Results carry
   summary and detail/tile refs, not full geometry/history.
7. Tests must generate the same byte-for-byte release twice, exercise malformed
   manifests/shards, cache/abort/eviction, dense tile split, stable search order,
   stable picking IDs, and no provider URL.

Completion evidence: synthetic all-anchor release validates, no shard exceeds
budgets, deterministic hashes match, runtime loads only selected shards, and the
full existing suite remains green.

Rollback point: preserve a scoped diff of Checkpoint 1. Reverse only those
Luna-owned hunks with `apply_patch`; move newly created fixture-release directory
to `artifacts/citywide-wave-<release>/rollback/cp1/`. Do not restore whole dirty
files from Git.

### Checkpoint 2 — deterministic citywide acquisition (approval-gated)

1. Create **new** citywide acquisition scripts; do not repurpose or overwrite
   pilot snapshots/scripts. Use release root
   `data/raw/manhattan-citywide-<YYYYMMDD>/` with `wx`/exclusive staging.
2. Buildings: obtain same-source candidate OBJECTIDs for the documented superset
   envelope `-74.03,40.68,-73.91,40.88` and same-source Manhattan identity sets
   using documented BIN/BASE_BBL/MAPPLUTO_BBL borough coding. Record exact query,
   field schema, server count, IDs, timestamp/headers, and set differences.
   Never call the envelope an authoritative boundary. Acquire sorted unique IDs
   in bounded POST batches; verify every requested ID appears exactly once.
3. Building membership rule: accept only when non-placeholder source identity
   fields consistently assert borough code `1`; quarantine missing/conflicting
   codes and any geometry outside the candidate envelope. Require zero unresolved
   records before the “all Manhattan captured” claim. If zero is impossible,
   stop—do not add the pending borough-boundary source.
4. DOHMH: first capture metadata/schema and confirm a stable unique pagination
   key. Query only `boro='Manhattan'`, with an explicit field list and deterministic
   total order including that unique key. Record count and source truth before
   and after. Preserve pages independently, combine only after page key ranges,
   row count, and hash validation. If no unique key exists, stop rather than use
   offset over tied `(camis, inspection_date, record_date)` ordering.
5. Reject any provider truth/count change during capture. Keep `.partial` output
   in the new release's quarantine and never concatenate/resume it.
6. Generate raw manifests with request count/duration/retries, record/ID counts,
   byte size/hash, fields/query/order, source truth, captured/finished times,
   terms/attribution, membership evidence, and immutable paths.

Completion evidence: provider counts reconcile exactly; building requested IDs
are unique/complete; DOHMH page key ranges do not overlap/gap; pre/post truth is
unchanged; all raw bytes/hash/query evidence is immutable; no old file changed.

Rollback point: stop consumers and move the entire new invocation-owned raw
release to its own `quarantine/cp2-<timestamp>/` sibling. Never delete it, merge
partials, or alter `real-wave-20260804`.

### Checkpoint 3 — normalization and citywide accounting

1. Parameterize building ingest with an explicit scope/membership strategy while
   preserving the current pilot default/tests. Do not clip citywide geometry to
   `manhattanAdapter`. Normalize source polygons to WGS84 and stable DOITT parent
   IDs; deterministically order multipart render parts while every part points to
   the stable parent.
2. Normalize every DOHMH row as an observation and every CAMIS as one parent
   detail/search record. Located CAMIS groups produce marker summaries; unlocated
   groups remain search/detail only. Preserve conflicting names/addresses/points
   as dated observations; choose display fields by the documented deterministic
   rule already used by place truth, never by input order.
3. Emit source-specific manifests with input/output counts, unique parent and
   render-part counts, located/unlocated counts, accepted/rejected/quarantined
   counts, reason histograms, min/max coordinates, per-latitude-band counts,
   identity collisions, freshness, and input/output hashes.
4. Require accounting invariants:
   - buildings: `raw records = accepted parent records + quarantined/rejected
     records`, and accepted source IDs exactly equal the approved Manhattan ID set;
   - DOHMH: `raw observations = normalized observations + rejected observations`,
     and every valid CAMIS observation belongs to exactly one CAMIS parent;
   - no canonical parent collision and no pilot replay ID drift.
5. Replay the pilot through the generalized code and require identical semantic
   identities/counts/heights; byte identity is required unless an intentional
   compact transport version change is documented and tested.

Completion evidence: zero unexplained records; all citywide metrics and hashes
exist; all latitude/anchor bands expected from the source set are represented;
pilot regression is green.

Rollback point: move only the new generated normalization root to a checkpoint
quarantine; reverse only generalized-ingest hunks from the Checkpoint 3 scoped
patch. Pilot raw/generated files remain untouched.

### Checkpoint 4 — deterministic compact release generation

1. Publish to a new invocation-owned staging directory under
   `data/generated/catalog/manhattan-citywide-<YYYYMMDD>/`, then atomically rename
   only after every validation passes. Refuse an existing destination.
2. Emit L14 WGS84 building geometry partitions and restaurant point partitions,
   splitting dense tile content deterministically by stable parent ID until both
   feature and byte budgets pass. Do not duplicate a parent across shards except
   building parts that truly intersect multiple content bounds; deduplicate by
   parent for search/details/picking.
3. Emit compact prefix/ID search shards and deterministic detail shards. Keep
   full inspection history out of marker/search/geometry payloads; detail shards
   may contain bounded source-backed inspection summaries/observations as the
   truth contract permits.
4. Emit root/source/coverage/layer/search/detail manifests with every file's
   safe ref, exact bytes, SHA-256, schema, counts, bounds, source groups, and
   freshness. Include a build journal and input fingerprint.
5. Rebuild twice from the same normalized inputs into different temporary roots;
   require identical published file list, bytes, checksums, counts, and release
   fingerprint. Validate every declared content file and no undeclared file.
6. Copy to a **new** `public/data/manhattan-citywide-<YYYYMMDD>/` only after size
   and validation gates pass; refuse overwrite. Generated runtime data stays
   ignored and out of Git.

Completion evidence: all release/checksum/accounting/budget invariants pass;
two builds are byte-identical; no monolith or undeclared payload exists.

Rollback point: before publication, abandon by moving the staging directory to
checkpoint quarantine. After publication, move only the new public/generated
release roots to quarantine and restore the prior app default release ID; never
delete/overwrite the pilot.

### Checkpoint 5 — runtime streaming, search, details, and failure modes

1. Add a citywide mode that initially fetches only the root manifest. Do not
   initialize an all-feature `LocalFixtureCityAdapter`; create a release-backed
   adapter with O(1) parent-summary/detail maps only for loaded/cached shards.
2. Camera changes (120 ms debounce is reusable) compute viewport bounds, refresh
   selected tile shards, abort stale requests, enforce <=4 concurrency and cache
   budgets, then incrementally add/remove per-tile app-owned Cesium primitives.
   Do not rebuild unaffected tiles.
3. Search loads only manifest-declared prefix/ID shards, returns stable summaries,
   and fetches a detail shard on selection. Selecting an unloaded result flies to
   summary coordinates when available and lets camera streaming fetch geometry;
   unlocated restaurant results open details without map flight.
4. Parent IDs are the only URL selection IDs. A building part pick maps to its
   DOITT parent; a restaurant point maps to its CAMIS parent. Preserve query,
   camera, mode, release, and feature across history/reload.
5. Fail closed at the narrowest scope: invalid root -> Fixture mode with alert;
   invalid/missing tile -> visible real-data unavailable region, no substitute;
   invalid search/detail shard -> unavailable result/detail, no substitute;
   unknown release/feature -> no selection, no same-name fallback.
6. Keep Data/details copy explicit about source-relative Manhattan coverage,
   capture/freshness, procedural massing, DOHMH limitations, unlocated records,
   and deferred categories/transit/facades.

Completion evidence: synthetic and real local release paths satisfy unit tests;
network audit contains only app-origin static requests; history/fallback/picking
are stable; Fixture and pilot remain usable.

Rollback point: keep citywide mode behind its release availability/default-mode
switch until final evidence. Reverse only Checkpoint 5 hunks to return the app to
pilot/fixture behavior; leave the validated new release quarantined and intact.

### Checkpoint 6 — Cesium scale and browser evidence

1. Test the fixed camera matrix and six-anchor tour in section 8 on desktop and
   mobile. Record frame intervals, picks, search, network, cache and heap where
   supported after a 3-second settle.
2. Resolve failures only inside the approved architecture: tile/shard sizing,
   viewport selection, concurrency/cache, incremental primitive lifecycle,
   search shard compactness, and React memoization. Repeat the full relevant
   loop after each fix.
3. Compare with Checkpoint 0 and the budgets. No acceptance threshold may be
   weakened. If meeting it requires 3D Tiles hosting, worker/IndexedDB, a new
   package, renderer replacement, or source change, stop and report the evidence.

Completion evidence: every budget passes at every anchor; zero stale/duplicate
picks; zero console errors/warnings attributable to the wave; repeat tour does
not grow cache/primitive/request counts; fixed screenshots and JSON metrics saved.

Rollback point: revert only the last performance hunk when a fix regresses truth,
identity, or another anchor; use the last passing checkpoint patch/evidence as
the active implementation. Do not change budgets.

### Checkpoint 7 — final deterministic evidence and handoff

1. Run the full command matrix, browser journeys, manifest invariant check, scoped
   diff, protected hashes, and generated-data Git exclusion.
2. Record exact source counts rather than planned estimates; include located/
   unlocated restaurants, building parent/part counts, tile/shard counts, bytes,
   rejected/quarantine reasons, six-band coverage, performance samples, browser
   requests/bytes, and failures/fallback tests.
3. Root Sol High reviews only the source/coverage proof, performance evidence,
   protected hashes, and final scoped diff. Luna fixes findings and repeats tests.

Completion evidence: section 7 and section 11 are fully checked with artifact
paths; root can decide from observable evidence without reconstructing the work.

Rollback point: keep citywide mode non-default if any final gate fails; reverse
only the failing checkpoint's hunks and retain immutable release/evidence for
diagnosis. No destructive Git command.

## 6. Exact allowed and prohibited areas

### Allowed for Luna

- New citywide scripts/tests under `scripts/`, preferably
  `scripts/*manhattan-citywide*.mjs`, plus narrowly scoped reusable helpers.
- `package.json` only for named citywide validate/build/benchmark scripts. No
  dependency or lockfile change.
- `src/ingestion/nyc-building-footprints.ts` and its tests only to parameterize
  scope without changing pilot defaults; `src/ingestion/poi-snapshot.ts` and
  tests only for located/unlocated citywide truth; new citywide ingestion files.
- Provider-neutral contracts/builders under `src/release/` and tests.
- `src/runtime/tile-package.ts`, `tile-stream.ts`, `layers.ts`, `spatial.ts`,
  new `citywide-*` runtime files, and corresponding tests.
- `src/domain/exploration.ts`, `visitor-navigation.ts`, schema/place-truth seams,
  and tests only as needed for sharded summaries, citywide mode, unlocated truth,
  and stable parent IDs.
- `src/app/App.tsx`, `src/features/explorer/CesiumViewport.tsx`, `src/styles.css`,
  and their tests only for the citywide mode/streaming/search/details/accessibility.
- Append a separate citywide runtime adapter/config in
  `src/data/city-adapters.ts` if necessary; preserve the existing pilot adapter
  export and do not use its rectangle as authoritative membership.
- New ignored immutable roots only:
  `data/raw/manhattan-citywide-<date>/`,
  `data/generated/**/manhattan-citywide-<date>/`, and
  `public/data/manhattan-citywide-<date>/`.
- New ignored evidence under `artifacts/citywide-wave-<date>/`.
- `src/data/source-registry.ts` **only after** durable citywide approval exists,
  and only the exact two entries' approval notes/scope evidence. Luna must not
  create the approval itself.

### Do not touch

- `AGENTS.md`, this plan, other `docs/**`, decisions, research, or runbooks.
- `.gitignore`, `pnpm-lock.yaml`, dependencies, Vite/Cesium versions, CI/deploy
  configuration, environment/credentials.
- Existing `data/raw/real-wave-20260804/**`, including quarantine;
  `data/generated/**/manhattan-pilot-20260804*` and
  `data/generated/catalog/real-wave-20260804*`;
  `public/data/real-wave-20260804*/**`.
- `artifacts/blender/landmark-wave-20260804/**`,
  `public/assets/landmarks/landmark-wave-20260804/**`, protected hashes, Blender
  files, `src/runtime/landmark-assets.*`, or asset semantics except a strictly
  necessary call-site integration test.
- Fixture/transit/route data and semantics unrelated to citywide mode.
- Any Google, OSM, Overture, MTA, borough-boundary, imagery, review, rating,
  traffic, routing, facade, or new-provider integration.
- Any raw/generated production dataset in the Git diff. No reset, clean,
  checkout, force operation, commit, or push.

## 7. Observable completion conditions

All conditions are mandatory; an unresolved approval gate means acquisition and
real citywide completion remain incomplete, even if synthetic contracts pass.

1. Durable evidence cites `msg_91770ac6d098`, which extends both registry IDs
   from pilot to a new all-Manhattan local snapshot/derivative/display scope and
   excludes new providers, Google data, public deployment, and unrelated data.
2. Raw building manifest reports exact candidate-envelope set, source-internal
   Manhattan identity set, intersection/differences, unique requested/returned
   IDs, byte/hash/times/query. Every accepted record has consistent borough code
   `1`; unresolved membership count is zero. The saved 132,410 set is comparison
   evidence, never silently accepted as the final count.
3. Raw DOHMH manifest reports `boro='Manhattan'`, stable unique page order, pre/
   post equal source count/truth, non-overlapping page ranges, row bytes/hash,
   and exact observation count. All rows are accounted as normalized/rejected.
4. Normalized evidence reports exact unique DOITT parents/render parts and CAMIS
   parents/observations/located/unlocated groups. Parent collision count is zero;
   unexplained/remainder count is zero; pilot canonical ID replay is stable.
5. Coverage report lists accepted counts and tile coverage for at least these
   bands/anchors: Financial/Battery, Chelsea/Midtown, Upper West, Upper East,
   Harlem, Inwood/Marble Hill, and Roosevelt Island. Each source-backed anchor
   query/pick returns the same parent ID. Empty source-backed bands require stop,
   not a fabricated minimum-count threshold.
6. Release rebuild is byte-identical. Every declared file exists once, every
   byte size/SHA matches, every safe ref stays under release root, every content
   file is declared, and no partial/absolute URL/path appears.
7. Root/shard/total size, shard count, first-camera network, concurrency, cache,
   rendered-feature, search, pick, frame, bundle, and practical heap budgets in
   section 1.4 pass with raw measurements.
8. Camera motion causes bounded tile requests and eviction; it never loads all
   Manhattan geometry. Settled repeat tours have no stale primitives, duplicate
   requests/picks, leaked collections, or unbounded cache/heap growth.
9. Search exact IDs and fixed name/address/cuisine queries resolve citywide
   summaries; selection loads truthful details. An unlocated CAMIS result is
   searchable/deep-linkable and explicitly cannot fly to a marker.
10. Invalid root, tile checksum, search shard, detail shard, release ID, and
    feature ID each fail closed exactly as section 5 states, with no fixture or
    same-name substitution inside citywide mode.
11. Desktop/mobile keyboard, focus, reduced-motion, Back/Forward/reload, mode/
    layer toggle, details copy, source/freshness/unknown states, and zero console
    errors pass.
12. Browser network contains only the app origin: **no external runtime request**
    is permitted, and grep/evidence finds no request to NYC/provider/Google
    domains. The Git diff contains no generated datasets and no protected/
    unrelated file changes.
13. Full `typecheck`, 110 existing tests plus new tests, lint, build, diff check,
    manifest validation, and browser journeys pass without lowered criteria.

## 8. Exact commands and Orca browser journeys

Replace `<release>` once with the approved immutable ID, for example
`manhattan-citywide-20260804`; never point it at `real-wave-20260804`.

### 8.1 Baseline and protected evidence

```sh
pwd
orca status --json
orca worktree current --json
git status --short
git diff --stat
git diff --check
rg -n "bounded.*pilot|do not rerun|citywide|approvalNote" \
  docs/decisions/0012-real-data-wave-20260804.md \
  docs/research/REAL_DATA_RUNBOOK.md src/data/source-registry.ts
wc -c public/data/real-wave-20260804/{manifest,buildings,restaurants}.json
shasum -a 256 public/data/real-wave-20260804/{manifest,buildings,restaurants}.json
shasum -a 256 public/assets/landmarks/landmark-wave-20260804/*
pnpm typecheck
pnpm test -- --run
pnpm lint
pnpm build
```

Use an Orca-visible server terminal:

```sh
orca terminal create --worktree active --title citywide-wave-dev --command "pnpm dev -- --host 127.0.0.1" --json
orca terminal wait --terminal <server-handle> --for output --timeout-ms 60000 --json
```

If this Orca version does not support `--for output`, read the terminal and use
the exact printed Vite URL; do not guess the port.

### 8.2 Approval-gated acquisition commands Luna must implement

Run only after the durable approval is recorded:

```sh
pnpm citywide:acquire:buildings -- \
  --release <release> \
  --output-root data/raw/<release> \
  --candidate-envelope=-74.03,40.68,-73.91,40.88 \
  --batch-size 250 --timeout-ms 30000

pnpm citywide:acquire:dohmh -- \
  --release <release> \
  --output-root data/raw/<release> \
  --where "boro='Manhattan'" \
  --page-size 50000 --timeout-ms 30000

pnpm citywide:validate:raw -- --root data/raw/<release>
```

The DOHMH command must refuse to start data pages until metadata proves the
unique order key; the exact discovered key must be written into its manifest.
Do not add an undocumented guessed `:id` to this plan or implementation.

### 8.3 Normalize, build, validate, and deterministic replay

```sh
pnpm citywide:normalize -- \
  --release <release> \
  --raw-root data/raw/<release> \
  --output-root data/generated/<release>

pnpm citywide:validate:coverage -- \
  --raw-root data/raw/<release> \
  --normalized-root data/generated/<release>

pnpm citywide:build -- \
  --release <release> \
  --normalized-root data/generated/<release> \
  --output-root data/generated/catalog/<release>-replay-a

pnpm citywide:build -- \
  --release <release> \
  --normalized-root data/generated/<release> \
  --output-root data/generated/catalog/<release>-replay-b

diff -qr data/generated/catalog/<release>-replay-a \
  data/generated/catalog/<release>-replay-b

pnpm citywide:validate -- \
  --release-root data/generated/catalog/<release>-replay-a \
  --raw-root data/raw/<release> \
  --normalized-root data/generated/<release>

pnpm citywide:publish-local -- \
  --validated-root data/generated/catalog/<release>-replay-a \
  --output-root public/data/<release>

find public/data/<release> -type f -print0 | sort -z | xargs -0 wc -c
find public/data/<release> -type f -print0 | sort -z | xargs -0 shasum -a 256
du -sh data/raw/<release> data/generated/<release> \
  data/generated/catalog/<release>-replay-a public/data/<release>
```

The new package script names are part of the handoff contract. If Luna chooses
different names, it must update this plan first—which is prohibited—so use these
names exactly.

### 8.4 Deterministic tests and scoped checks

```sh
pnpm typecheck
pnpm test -- --run
pnpm lint
pnpm build
pnpm citywide:validate -- --release-root public/data/<release> \
  --raw-root data/raw/<release> --normalized-root data/generated/<release>
pnpm citywide:benchmark -- --release-root public/data/<release> \
  --queries scripts/fixtures/manhattan-citywide-search-queries.json
git diff --check
git status --short
git diff --stat -- package.json scripts src
git diff -- package.json scripts src
git status --short | rg "(^| )((data/(raw|generated))|public/data/)" && \
  { echo "ERROR: generated data entered Git status"; exit 1; } || true
shasum -a 256 public/assets/landmarks/landmark-wave-20260804/*
```

Do not use the final `|| true` pattern for validation failures generally; it is
limited to expressing the expected empty `rg` result above.

### 8.5 Orca browser journey

1. Open the exact Vite URL and start capture:

   ```sh
   orca tab create --url <vite-url> --json
   orca wait --load networkidle --json
   orca capture start --json
   orca snapshot --json
   orca console --limit 200 --json
   orca network --limit 500 --json
   ```

2. Baseline pilot: choose Real open-data pilot, wait for its ready text, use
   desktop 1440x900, search a known restaurant by CAMIS/name and building by
   DOITT_ID, select each, click the same marker/building, copy the deep link,
   reload, Back, Forward, toggle buildings/places, and save screenshot/network/
   console/frame/search/pick measurements. This is the comparison, not citywide
   acceptance.
3. Citywide load: choose Manhattan citywide. Before moving the camera, run
   `orca network`; assert root manifest plus only fixed-camera shards and the
   landmark manifest/assets are requested. No whole-city building/restaurant
   JSON and no provider domain may appear.
4. At each fixed anchor below, use the app's deterministic camera/deep-link
   control or `orca eval` only against app-owned debug measurement hooks. Wait
   three seconds, record 10 seconds of `requestAnimationFrame` intervals,
   runtime tile metrics, request count/bytes, declared cache bytes, rendered
   feature count, and `performance.memory.usedJSHeapSize` when available:

   | Anchor | Longitude | Latitude | Camera height |
   | --- | ---: | ---: | ---: |
   | Financial/Battery | -74.012 | 40.706 | 1,200 m |
   | Chelsea/Midtown | -73.992 | 40.748 | 1,200 m |
   | Upper West | -73.975 | 40.787 | 1,200 m |
   | Upper East | -73.956 | 40.773 | 1,200 m |
   | Harlem | -73.944 | 40.817 | 1,200 m |
   | Inwood/Marble Hill | -73.922 | 40.871 | 1,200 m |
   | Roosevelt Island | -73.949 | 40.762 | 1,200 m |

   Run the tour twice. Metrics must obey section 1.4 and settle after the second
   tour. Capture a fixed screenshot at Financial, Midtown, Harlem, and Inwood.
5. Picking: at each anchor select one declared building test ID and one located
   CAMIS test ID from the generated evidence corpus by search, then click its
   primitive. Assert search ID = pick parent ID = detail ID = URL ID. Repeat 30
   fixed picks for p95. Do not rely on screen-coordinate clicks for automation;
   the release test corpus must provide deterministic focus/pick targets.
6. Search: run 30 committed **synthetic query definitions** whose expected real
   IDs are generated into ignored evidence after acquisition (exact DOITT, BIN,
   BBL, CAMIS, names, address tokens, cuisine, Unicode/diacritic case, no result,
   unlocated CAMIS). Measure cold and warm p95; verify keyboard/focus/listbox.
   Do not commit real addresses as fixture data.
7. Failure matrix: in a temporary copied release root, corrupt one byte of one
   tile, search shard, and detail shard separately; request an unknown release
   and unknown parent ID. Each must show scoped unavailable state and select
   nothing else. Restore by switching back to the immutable validated root, not
   by editing it in place.
8. History: from a citywide restaurant and building, reload then Back/Forward;
   verify query/camera/mode/release/parent selection. Test an unlocated CAMIS:
   details open, “location unavailable” is read, no camera flight/marker occurs.
9. Accessibility/mobile: resize the Orca browser through the supported browser
   command or app debug viewport to 390x844, repeat search/selection/details,
   then 1440x900. Keyboard-only Tab/Arrows/Enter/Escape, focus return, screen-
   reader status text, 200% zoom, and reduced-motion must remain usable.
10. Finish with:

   ```sh
   orca snapshot --json
   orca screenshot --json
   orca console --limit 500 --json
   orca network --limit 1000 --json
   ```

   Console must have no wave-attributable warning/error; network hostnames must
   be app-origin only. Save capture IDs and JSON metrics under the new ignored
   evidence root.

## 9. Rollback matrix

| Checkpoint | Safe rollback point |
| --- | --- |
| 0 | Move only the newly created baseline evidence directory aside; no product state changed |
| 1 | Reverse only the saved Luna-owned contract/test hunks with `apply_patch`; move the new synthetic release to checkpoint quarantine |
| 2 | Move the whole invocation-owned raw release to its own quarantine; never delete, resume, concatenate, or touch pilot/quarantine evidence |
| 3 | Move the new normalized root to quarantine and reverse only generalized-ingest hunks; pilot adapter/default remains intact |
| 4 | Before atomic publish, move staging aside; after publish, move only the new generated/public release roots aside and restore prior app release selection |
| 5 | Disable/remove only citywide mode hunks so Fixture/pilot remain active; retain validated release for diagnosis |
| 6 | Reverse only the last measured performance hunk to the last passing scoped patch; never raise budgets or remove truth/accessibility checks |
| 7 | Keep citywide non-default and hand root the failing evidence; do not commit/push or destructively clean |

At every checkpoint, save `git status --short`, `git diff --check`, and a scoped
patch of Luna-owned work. Because the tree was dirty before Luna started, never
restore a whole file from `HEAD` or a blanket backup if it would erase prior or
concurrent changes.

## 10. Stop and report instead of guessing

Luna must stop the affected checkpoint and report exact command/output/counts
when any of these occurs:

1. Citywide approval for either source, raw retention, derived artifacts, local
   display, attribution/disclaimer, or request budget is absent/unclear.
2. Any new provider/source, paid/credentialed service, public redistribution,
   hosting/CDN, package, worker database, service worker, or materially different
   renderer/storage architecture appears necessary.
3. Official endpoint is unavailable, schema/fields/terms/source truth differ
   from local evidence, DOHMH has no stable unique page key, or source changes
   during capture.
4. Building candidate/attribute sets disagree and any record cannot be resolved
   from documented same-source Manhattan semantics; a polygon boundary would be
   required; geometry lies outside the candidate superset; source IDs collide.
5. Candidate building count exceeds 200,000; DOHMH rows exceed 250,000; either
   raw source exceeds 300 MiB; runtime release exceeds 300 MiB; any shard/count/
   request/cache/render/search/pick/frame/bundle budget fails; partition count
   exceeds 512; Git-tracked size would materially expand.
6. Raw/normalized/accounting/checksum/deterministic replay has a remainder,
   duplicate, gap, unexpected rejection, conflicting identity, or output drift.
7. Full city requires eager all-record JSON, an all-feature adapter, monolithic
   Blender/Cesium scene, or browser provider request.
8. A truth field would be inferred; inspection becomes rating/status/hours; an
   unlocated place would be dropped/geocoded; missing real data would fall back
   to a fixture/same-name record.
9. Protected landmark hash changes, existing pilot artifact changes, required
   hunk overlaps unexplained dirty work, rollback would erase prior work, or an
   unrelated baseline failure prevents attribution.
10. Console/WebGL error, stale/duplicate pick, primitive/cache leak, accessibility
    regression, or deep-link identity mismatch persists after a bounded fix/test
    loop within this plan.

The report must state the last passing checkpoint, exact blocker, measured
expected/actual evidence, affected files/artifacts, whether outputs are safely
quarantined, and the smallest decision needed. Do not propose lower acceptance
criteria as the fix.

## 11. Luna pre-exit checklist

### Goal and scope

- [ ] Goal is a new all-Manhattan, snapshot-relative release for only OTI
  buildings and DOHMH restaurants; no bbox redefinition or new provider.
- [ ] Required citywide approval is quoted and linked in evidence; otherwise
  acquisition/real completion is reported blocked.
- [ ] Only section 6 allowed files/areas changed; no do-not-touch path changed.
- [ ] Existing pilot, Fixture mode, routes, navigation, and landmarks remain.

### Steps and completion evidence

- [ ] Checkpoints 0-7 completed in order; each has tests, scoped diff, evidence,
  and rollback point before the next began.
- [ ] Building source-internal Manhattan/accounting evidence has zero unresolved
  records; DOHMH `boro='Manhattan'` pagination/count evidence is stable/complete.
- [ ] Exact DOITT parent/part and CAMIS observation/located/unlocated counts are
  recorded; all records accounted; no identity collisions or pilot ID drift.
- [ ] All seven geographic anchors have source-backed coverage/search/pick
  evidence; search/pick/detail/URL parent IDs agree.
- [ ] New release is immutable, versioned, byte-identical on replay, checksum-
  complete, compact/sharded, and within every size/count budget.
- [ ] Runtime loads manifest/search/detail/viewport tiles lazily, enforces abort/
  concurrency/cache, incrementally owns primitives, and never loads all city data.
- [ ] Failure matrix, unlocated truth, no-substitute behavior, and no external
  runtime request pass.
- [ ] Desktop/mobile, keyboard/focus/reduced-motion, history/reload, console,
  network, search/pick/frame/cache/heap measurements meet section 7.

### Tests, rollback, and report gates

- [ ] `pnpm typecheck`, full tests, lint, build, citywide raw/coverage/release
  validation, benchmark, deterministic replay diff, and `git diff --check` pass.
- [ ] Existing baseline remains at least 23 files / 110 tests plus new tests;
  no test was removed/weakened and no budget was raised.
- [ ] Protected landmark files match every full SHA-256 in their manifest.
- [ ] Git status has no raw/generated/public citywide data, lockfile, AGENTS/docs,
  pilot, landmark, Blender, or unrelated change from Luna.
- [ ] Rollback for every checkpoint is non-destructive, scoped to Luna-owned
  hunks/new versioned roots, and will not erase dirty-tree work.
- [ ] Every stop/report condition was checked; any triggered condition is reported
  with exact evidence rather than inferred around.
- [ ] Final handoff lists release ID, approval record, source counts/hashes,
  coverage report, performance/browser artifact paths, commands run, scoped diff,
  remaining limitations (other POIs/transit/routing/facades/true 3D Tiles), and
  whether citywide mode is default or intentionally held back.
- [ ] Luna has not committed or pushed. Root Sol High receives only the high-risk
  evidence and final scoped diff for review; Luna remains responsible for fixes
  and repeated test loops until the gates pass or a stop condition is reported.
