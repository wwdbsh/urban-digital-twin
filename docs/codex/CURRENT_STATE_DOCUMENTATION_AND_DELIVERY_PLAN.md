# Current-state documentation and delivery plan

Status: **implementation-ready catch-up plan; conditional on path-ownership review**
Evidence date: 2026-08-04 (Asia/Seoul)
Work unit: document, revalidate, review, and deliver the already implemented
Manhattan citywide foundation
Provider state: **no provider contact and no new data approval in this work unit**

This work unit comes before the proposed DCP NTA, NYC Parks, and LPC civic-data
wave. It neither implements that wave nor changes its approval gate. Its purpose
is to make the repository tell the truth about the substantial implementation
already present in the dirty shared worktree, prove that the corresponding code
and local release still pass their gates, and—only after Root Sol High's final
review—create one scoped commit and push it normally.

At planning time, `HEAD`, the local `origin/main`, and the remote
`refs/heads/main` all resolve to
`919ca5f76151b04f45fe91fc8188c7f0239a37d9`. That observation is not durable:
Luna must fetch and compare again immediately before staging and again before
pushing. Every dirty hunk is user work. Nothing in this plan authorizes Luna to
discard, rewrite, or silently absorb a path whose ownership is unclear.

## 1. Requirements

### 1.1 Scope and product truth

1. Describe the completed local Manhattan foundation as it exists: a
   React/TypeScript/Vite/CesiumJS application with fixture, bounded real-pilot,
   and citywide real-data modes; citywide NYC OTI building footprints; citywide
   DOHMH restaurant inspection observations; local lazy geometry/search/detail
   delivery; stable selection and navigation; and a protected three-landmark
   GLB package used by the bounded pilot.
2. Do not call this a complete Google-Maps-like travel product. Explicitly list
   missing real neighborhoods, parks, shops beyond DOHMH restaurants,
   attractions beyond the bounded landmark assets, transit, routing, hours,
   live status, reviews, ratings, photos, street imagery, facade imagery,
   photorealism, traffic, public hosting, and production 3D Tiles delivery.
3. Preserve the reusable multi-city and provider-neutral contracts. Do not
   describe Manhattan-specific source IDs as generic platform behavior.
4. Preserve truthful unknown states. A DOHMH grade/action is an inspection
   history observation, not a consumer rating, review, current opening state,
   or complete business directory. A footprint-derived extrusion is not a
   facade-accurate building.
5. Do not implement features, change runtime behavior, contact a provider,
   acquire or regenerate data, install dependencies, edit Blender assets, or
   expand an approval. Only documentation edits are authorized; any code,
   package-metadata, script, test, asset, or data correction is a new planned
   work unit and must stop this one.

### 1.2 Documentation policy

1. Before the work-unit commit, Luna must audit `README.md` and every existing
   project document whose setup, architecture, data sources, licensing,
   operation, validation, UX behavior, limitations, or release state changed.
2. Luna must create missing foundational documentation where an implemented
   system area was never documented. For this wave that means exactly:
   `README.md`,
   `docs/codex/MANHATTAN_CITYWIDE_FOUNDATION_IMPLEMENTATION.md`, and
   `docs/decisions/0013-manhattan-citywide-foundation-delivery.md`.
3. Luna must update every document in the **must update** table below, not just
   add a general README. Historical decisions and plans remain historical; use
   dated supersession/current-status notes rather than falsifying what was true
   when they were written.
4. Documentation accuracy is a release artifact. Every count, byte total,
   checksum, source scope, approval ID, command, mode description, screenshot,
   limitation, and release claim must be checked against code, generated release
   metadata, source approvals, runnable commands, preserved evidence, and known
   limitations. If those disagree, report the disagreement; do not choose the
   most favorable version.
5. Documentation must distinguish tracked reproducible code/assets from ignored
   local raw/generated data. A fresh clone does not contain the 304 MB citywide
   release, and README setup must say exactly which approved local prerequisites
   are required to validate or run citywide mode.

### 1.3 Delivery policy

1. Luna owns documentation, deterministic validation, fixes limited to the
   authorized documentation surface, and repeated checks. Root Sol High reviews
   the final diff and all high-risk boundaries before finalization.
2. Only after all Root findings are resolved may Luna create exactly one scoped
   work-unit commit and push it to the configured upstream branch.
3. Never commit ignored raw snapshots, generated release payloads not intended
   for Git, secrets, unrelated dirty changes, partial/recovery evidence,
   superseded screenshots, or an incomplete/failed checkpoint.
4. Verify every staged path and the complete staged diff. Record the resulting
   commit SHA, push output, and verified remote tip.
5. No force push, reset, clean, discard checkout, amend, rebase, history
   rewrite, or destructive Git operation is authorized.

## 2. Ranked risks and stop/escalation conditions

| Rank | Risk | Required control | Stop or escalate when |
| --- | --- | --- | --- |
| 1 | A broad commit captures unrelated user work from an extensively dirty tree. | Use the path inventory below, an explicit pathspec file, full staged-diff review, and Root authorization. Never use `git add .`, `git add -A`, or directory-wide staging. | Any candidate path contains a hunk from a different work unit, path ownership cannot be proven, or file-level staging cannot separate it safely. |
| 2 | Documentation claims a release that a clone cannot run because `public/data/` is ignored. | Document the local-only release prerequisite and deterministic approved-source build/publish commands; keep ignored payloads out of Git. | The documented path requires an unapproved provider call, a missing retained snapshot, or an unreproducible manual artifact. |
| 3 | Source rights or approval scope is overstated. | Cite approval `msg_91770ac6d098` only for local OTI/DOHMH acquisition, retention, derived artifacts, and browser display; preserve attribution, dates, IDs, hashes, uncertainty, and local-only status. | Documentation implies public redistribution/deployment, a new provider, Google content, or a license right not established by the approval/evidence. |
| 4 | Protected landmark binaries are changed or omitted from a commit needed by tracked runtime/tests. | Verify the seven published hashes before and after work. Treat GLBs/manifest as immutable candidate deliverables and `.blend*` as ignored source checkpoints. | Any protected hash differs, a GLB is regenerated, or Root cannot establish whether the seven runtime files belong in this work unit. |
| 5 | Old fixture/pilot documents remain presented as current truth. | Update the exact stale documents below with current-state sections or supersession notes. | Any searched statement still says the application is fixture-only, pilot-only, or lacks citywide ingestion without a dated historical qualifier. |
| 6 | Validation passes only because large local ignored state is present. | Run ordinary tests/build separately from citywide release validation; document prerequisites and exact release metadata. | Base tests require untracked raw/generated data, or citywide validation silently falls back to fixtures. |
| 7 | Current performance/accessibility evidence is overclaimed. | Re-run deterministic benchmark and validate only supported browser claims; retain reduced-motion and browser interception limitations. | Budgets regress, final evidence conflicts, or an unsupported capability is described as tested. |
| 8 | Remote changes between review and push. | Fetch/read-only compare before staging and immediately before push; require no upstream-only commits and unchanged reviewed staged diff. | `origin/main` moves, histories diverge, or push is non-fast-forward. Report the smallest integration decision; do not rebase/merge automatically. |
| 9 | Credentials or secret material enter the commit. | Review staged file names, binary paths, staged diff, and secret-like patterns. | A credential, token, `.env`, raw response header with secret, or unknown binary appears. |
| 10 | Workflow policy is coupled to product delivery without clear ownership. | Root explicitly decides whether `AGENTS.md` and `docs/codex/AGENT_WORKFLOW.md` are in this work unit. | Their changes cannot be attributed to the user's current completion policy, or conflict remains between them. |

## 3. Observable completion conditions

The work unit is complete only when all of the following are observable:

1. `README.md` exists and accurately covers prerequisites, setup, architecture,
   modes, approved data sources, ignored-data lifecycle, operation, validation,
   licensing/provenance, accessibility, performance evidence, and limitations.
2. The exact **must update** documents below no longer present superseded
   fixture/pilot statements as current truth; all **no change** documents have
   been audited and logged.
3. The two missing foundational records exist and agree with the final release
   manifest, approvals, code, validation output, and each other.
4. The release record states the observed immutable facts: 45,194 accepted OTI
   building parents/render parts; 109,386 DOHMH observations; 12,439 CAMIS
   parents, of which 12,353 are located and 86 are unlocated; 103 geometry, 214
   search, and 134 detail shards; 57,633 detail-index entries; 304,382,520
   declared bytes; zero accounted remainder and zero identity collisions.
5. It records the exact raw snapshot evidence without committing it: OTI
   41,739,923 bytes, SHA-256
   `52c841e388f8e56e6e3666d2ce8b6436ec10f9eeb2bbcad2b2452b51d58dafc7`;
   DOHMH 114,488,021 bytes, SHA-256
   `cb4cb6fce7a3744672882e63f2d3542674d7f76334d1a8aa2a7bfa76bd48b627`.
   Luna must still verify both values from the authoritative manifest.
6. The seven protected published landmark files match the hashes in section 6.
7. `pnpm typecheck`, the full `pnpm test`, `pnpm lint`, `pnpm build`,
   `pnpm citywide:validate`, and `pnpm citywide:benchmark` pass from the reviewed
   tree. The exact test-file/test counts and build sizes are recorded from this
   run, not copied from older plans.
8. Browser truth checks, if needed to support README claims, show fixture,
   bounded pilot, and citywide modes without provider network calls; building
   and restaurant search/selection/deep-link behavior; explicit provenance and
   unknown states; and zero unexpected console errors. If existing immutable
   evidence suffices for a statement, Luna may cite it instead of producing a
   duplicate screenshot.
9. Root Sol High signs off on truth, rights, protected paths, generated-data
   exclusion, docs accuracy, tests, and the complete staged diff.
10. Exactly one scoped commit is created after that review, pushed normally,
    and the remote branch tip is verified equal to the recorded commit SHA.

## 4. Completed capability and limitation inventory

### 4.1 Capabilities documentation must describe

| Area | Completed current behavior | Evidence Luna must use |
| --- | --- | --- |
| Web foundation | React 19, TypeScript, Vite, CesiumJS application; Cesium owns WGS84 globe/camera/picking. | `package.json`, `src/app/App.tsx`, `src/features/explorer/CesiumViewport.tsx`, build output. |
| Data modes | Synthetic fixture mode, bounded approved real-data pilot, and local citywide real-data mode coexist with explicit labels/failure isolation. | App/runtime adapters, pilot and citywide manifests, browser evidence. |
| Buildings | 45,194 accepted Manhattan OTI footprint parents and render parts, stable DOITT identity, provenance, feet-to-meters height conversion, explicit unknown-height fallback. | Citywide manifest, building ingest/normalization/tests, real-height regression fixture. |
| Restaurants | 109,386 inspection observations grouped under 12,439 stable CAMIS parents; 12,353 located and 86 unlocated. Located parents render; all accepted parents remain searchable/detail-addressable. | Citywide manifest, DOHMH adapter/tests. |
| Streaming | Geometry loads by viewport shard with bounded request/cache behavior; search and detail shards load lazily rather than preloading Manhattan. | `src/release`, `src/runtime/citywide-release-runtime*`, tile stream tests, benchmark. |
| Search/detail | Exact IDs and normalized text search, typed summaries, lazy details, source-backed values, explicit unknowns, no same-name/nearby fallback for missing IDs. | Runtime and view tests, app/browser evidence. |
| Map selection | Stable feature IDs connect Cesium pick, search result, and details; layer visibility and failure isolation are implemented. | Cesium viewport and runtime tests/browser evidence. |
| Navigation | Search/feature/camera state supports deep links, reload, Back/Forward, and deterministic restoration; unknown release/parent fails closed. | `visitor-navigation*`, `exploration*`, browser failure evidence. |
| Landmark package | Three procedurally authored landmarks—Flatiron Building, Empire State Building, Theodore Roosevelt Birthplace—have two protected GLB LODs each plus a manifest. The bounded pilot integrates them. | Asset manifest/hashes, landmark asset tests, Blender/browser evidence. |
| Accessibility | Keyboard combobox/listbox behavior, focus handling, visible controls, responsive 390x844 layout, and a reduced-motion implementation path exist. | tests and final mobile/accessibility evidence. |
| Performance | Fixed 30-sample, seven-anchor citywide benchmark previously recorded p95 cold/warm search 26.89/29.388 ms and cold/warm detail 14.016/0.116 ms. | Re-run benchmark and compare its current output; do not silently reuse numbers if they change. |
| Network isolation | Runtime uses local immutable assets/releases; final prior session observed 175 app-origin requests and no external provider requests. | Recheck network if claiming the current run; otherwise identify the dated evidence. |
| Provenance | Source registry/release records preserve source IDs, approval scope, capture/update timestamps, hashes, counts, licensing/attribution, uncertainty, and rejections/accounting. | registry, manifests, decisions, implementation record. |

### 4.2 Limitations documentation must describe

1. The release is local-first. `data/`, `public/data/`, and
   `artifacts/offline-ingest/` are ignored; the 304,382,520-byte citywide payload
   is not part of a fresh clone or the candidate Git commit.
2. The current citywide renderer is JSON/shard based, not a deployed 3D Tiles
   service. Public deployment, hosting, CDN behavior, and redistribution are not
   approved or validated.
3. Buildings are footprint massing with source-provided or fallback heights,
   not verified facades, interiors, roof geometry, entrances, imagery, or
   photoreal digital twins.
4. Citywide mode does not activate the three protected GLBs. Their verified
   runtime integration is in the bounded pilot. Documentation must not imply
   citywide landmark replacement unless code/evidence proves it.
5. DOHMH data is restaurant inspection history. It does not establish current
   opening state, hours, menu, booking, popularity, accessibility, phone/site,
   review, rating, photo, or complete shop/business coverage.
6. Synthetic routes, transit, and directions remain fixtures. No real MTA,
   DCP NTA, NYC Parks, LPC, OSM, Overture, Google, live traffic, or live service
   data is present.
7. No real citywide neighborhood, park, attraction, retail, department-store,
   entrance, pedestrian, or street-level experience has yet been implemented.
8. Reduced-motion code exists, but the connected browser could not force the
   enabled media-query path in prior evidence. State that browser-path
   limitation until a deterministic test proves it.
9. Unknown-release and unknown-parent browser failures were exercised. Browser
   interception for corrupted payloads was unavailable; corruption is covered
   by focused deterministic tests, not by that browser journey.
10. Prior frame captures include exploratory outliers/camera drift. Only the
    final fixed-session evidence and current rerun may support performance
    claims; do not summarize every saved JSON as a pass.
11. Source timestamps are capture/source-update observations, not guarantees of
    present real-world state. City data completeness and fitness are not
    warranted, and no City endorsement is implied.

## 5. Exact documentation audit

### 5.1 Missing documents to create

| Path | Required content |
| --- | --- |
| `README.md` | Canonical developer/user entry point: supported Node/pnpm versions; install/run/build/test commands; fixture/pilot/citywide modes; architecture; local ignored-data prerequisites and safe acquisition boundary; release counts/dates; source IDs/attribution/terms; protected landmark assets; accessibility/performance evidence; known limitations; no public-deployment claim. |
| `docs/codex/MANHATTAN_CITYWIDE_FOUNDATION_IMPLEMENTATION.md` | Durable implementation record: exact code paths, approval ID/scope, full source and release hashes/counts/bytes/timestamps, deterministic command transcript, test counts, benchmark output, browser evidence locations, failure/unknown behavior, protected hashes, exclusions, and rollback/reproduction notes. |
| `docs/decisions/0013-manhattan-citywide-foundation-delivery.md` | Accepted delivery decision superseding fixture/pilot-only current-state claims while preserving their historical validity; local-only/ignored-payload architecture, stable identity, streaming, rights boundary, protected assets, limitations, and next-provider approval boundary. |

### 5.2 Existing documents that must be updated

| Path | Stale or missing fact | Required edit |
| --- | --- | --- |
| `docs/PROJECT_BRIEF.md` | Treats real Manhattan ingestion and citywide behavior primarily as future state. | Add delivered-foundation/current-limitations section and link the implementation record/Decision 0013. Preserve end-state ambition. |
| `docs/design/PRIMARY_SCREEN.md` | Setup-era generated-grid/marker description does not reflect current modes, controls, search, detail, and responsive behavior. | Document current screen behavior and explicit remaining design gaps; do not present conceptual PNG as runtime proof. |
| `docs/codex/AGENT_WORKFLOW.md` | Conflicts with current `AGENTS.md` Sol Medium/Luna Max/Root policy and lacks final Root review plus one-commit/push rule. | Synchronize the operating summary if Root confirms policy paths belong in this work unit. Otherwise stop for a separate policy-doc work unit. |
| `docs/codex/PLACE_TRUTH_IMPLEMENTATION.md` | Says current UI records are synthetic. | Add current integration status: real DOHMH parents/observations, which place-truth fields remain unknown, and fixture/pilot/citywide boundaries. |
| `docs/research/MANHATTAN_DATA_STRATEGY.md` | Says the app lacks NYC ingestion/streaming/citywide data. | Add dated implemented-state section and distinguish present JSON shards from future 3D Tiles/other sources. |
| `docs/research/MANHATTAN_POI_RESEARCH.md` | Its bounded-pilot/default-fixture status predates citywide DOHMH delivery. | Add final citywide DOHMH scope/counts and explicitly retain other POI categories as pending. |
| `docs/research/NYC_BUILDING_FOOTPRINTS_RESEARCH.md` | Opening status still says no full-city envelope was published. | Replace only the current-status section with final approved citywide capture semantics/count/hash; retain source research and recovery history. |
| `docs/research/PLACE_TRUTH_SOURCE_MATRIX.md` | Its research-only/no-provider-call statement is historical and does not describe the later approved local OTI/DOHMH release. | Add a dated supersession note and current approved/pending matrix; do not broaden approval. |
| `docs/research/REAL_DATA_RUNBOOK.md` | Pilot-only commands and “full-city needs approval” are obsolete. | Add exact citywide local prerequisites/commands, immutable release checks, ignored-output policy, and no-provider browser operation. Keep pilot recovery history labelled. |
| `docs/research/RUNTIME_SLICE_FOUNDATION.md` | Says local fixture only. | Add current adapter/release modes, lazy citywide seams, and known production 3D Tiles gap. |
| `docs/research/OFFLINE_INGEST_FOUNDATION.md` | Its status says no external provider is connected and only the fixture registry entry is approved. | Add a dated current-state note for approved local OTI/DOHMH adapters and keep the original fixture foundation/command semantics intact. |
| `docs/research/MANHATTAN_CATALOG_RELEASE_ARCHITECTURE.md` | Describes pre-real-release state. | Record which catalog/release contracts are implemented and where citywide design differs/remains incomplete. |
| `docs/research/MANHATTAN_STREAMING_ARCHITECTURE.md` | Says all current content is invented fixtures. | Record current citywide JSON shard implementation, budgets/evidence, and future 3D Tiles limitation. |
| `docs/research/EXPLORATION_INTERACTION_CONTRACT.md` | Calls the current journey synthetic and real catalog pending. | Add implemented real search/pick/detail/unknown behavior and remaining categories. |
| `docs/research/VISITOR_NAVIGATION_CONTRACT.md` | Calls all current navigation synthetic. | Record real entity/camera/deep-link restoration while retaining synthetic route/direction limitation. |
| `docs/research/BLENDER_MCP.md` | Must clearly separate completed asset-authoring provenance from this non-asset work unit. | Verify hashes/evidence references and state Blender MCP is conditional on a future asset-authoring/editing work unit; it is not needed for this civic-data-free documentation catch-up. |
| `docs/decisions/0001-project-foundation.md` | Its accepted owner/escalation workflow predates the current Sol Medium/Luna Max/Root contract. | Add a dated workflow-supersession note linking current `AGENTS.md`; do not rewrite the historical decision body. |
| `docs/decisions/0002-manhattan-data-and-rendering-strategy.md` | Its context calls the app a marker scaffold with no authoritative ingestion. | Add a dated implementation-status note pointing to Decision 0013 and preserve still-pending source/3D Tiles decisions. |
| `docs/decisions/0005-streaming-and-dense-rendering.md` | Historical fixture-only current-state wording is superseded. | Add a short dated status note pointing to Decision 0013; retain the original decision. |
| `docs/decisions/0006-multi-source-reconciliation.md` | Its milestone status says the only connected catalog is synthetic. | Add a dated note distinguishing the still-synthetic reconciliation subsystem from the connected OTI/DOHMH citywide adapters; retain future-provider gates. |
| `docs/decisions/0007-catalog-release-assembly.md` | Historical fixture-only current-state wording is superseded. | Add a short dated status note pointing to Decision 0013; retain the original decision. |
| `docs/decisions/0008-exploration-interaction.md` | Historical synthetic-only current-state wording is superseded. | Add a short dated status note pointing to Decision 0013; retain the original decision. |
| `docs/decisions/0009-visitor-navigation.md` | Historical synthetic-only current-state wording is superseded. | Add a short dated status note pointing to Decision 0013; retain the original decision. |
| `docs/decisions/0010-place-truth-contract-and-approval-gates.md` | Predates the approved OTI/DOHMH wave. | Add a dated implementation-status note linking Decisions 0012/0013; preserve unapproved-provider gates. |
| `docs/decisions/0011-blender-mcp-install-and-threat-model.md` | Says asset authoring had not begun. | Add a dated note that protected assets were authored/validated and that Blender remains conditional on asset work. Do not revise the threat model historically. |
| `docs/decisions/0012-real-data-wave-20260804.md` | Records the bounded pilot, not the later citywide approved release. | Add a dated supersession link to Decision 0013 and preserve pilot approval/history unchanged. |

### 5.3 Existing documents audited as accurate; no change expected

These files still describe either active pending constraints or accurately
labelled historical work. Luna must read/check them and record “no change” in
the documentation audit; do not edit merely to create churn.

| Path(s) | Why no change is expected |
| --- | --- |
| `docs/decisions/0003-transit-foundation.md`, `0004-routing-foundation.md` | These remain pending/synthetic constraints and were not completed by the citywide building/restaurant wave. |
| `docs/research/MANHATTAN_AREA_RESEARCH.md` | Real area/NTA data remains unapproved and absent. |
| `docs/research/MANHATTAN_TRANSIT_RESEARCH.md` | MTA remains pending and no real transit was added. Its currently dirty diff must still be ownership-reviewed; accuracy alone does not authorize staging. |
| `docs/research/MANHATTAN_RECONCILIATION_STRATEGY.md`, `MANHATTAN_ROUTING_STRATEGY.md` | Provider-neutral/synthetic-only future strategies remain accurate. |
| `docs/research/MANHATTAN_LANDMARK_ASSET_WAVE_20260804.md` | Accurate asset-wave record if and only if its hashes match section 6 and its evidence links are retained. |
| `docs/codex/MANHATTAN_CITYWIDE_WAVE_PLAN.md`, `OTI_CITYWIDE_BUILDING_RECOVERY_PLAN.md`, `DOHMH_CITYWIDE_ACQUISITION_RECOVERY_PLAN.md`, `MANHATTAN_REAL_POI_WAVE_PLAN.md` | Historical plans/recovery records remain evidence, not current operation guides. Whether these untracked files belong in the scoped commit is a separate Root path-ownership decision. |
| `docs/codex/MANHATTAN_TRAVEL_EXPERIENCE_NEXT_WAVE_PLAN.md` | Accurate future conditional plan; NTA/Parks/LPC approval remains unresolved. Explicitly exclude it from this catch-up commit unless it was already separately accepted for delivery. |
| `docs/concepts/primary-desktop.png` | Tracked concept asset is unchanged and must not be represented as a current screenshot. |

No documentation file may remain unclassified. Luna must rerun
`find docs -type f | sort` and reconcile any path added or missed after this
planning snapshot.

## 6. Exact candidate Git path inventory

This is a planning classification, not permission to stage. Root must approve
the final include list after Luna proves ownership and validation.

### 6.1 Include candidate: coherent completed foundation

Include the whole file only after confirming no post-foundation mixed hunk:

```text
.gitignore
package.json
scripts/run-nyc-building-ingest.mjs
scripts/acquire-manhattan-citywide-buildings.mjs
scripts/acquire-manhattan-citywide-dohmh-snapshot.mjs
scripts/acquire-nyc-building-snapshot.mjs
scripts/benchmark-manhattan-citywide.mjs
scripts/build-browser-pilot-partitions.mjs
scripts/build-manhattan-citywide.mjs
scripts/build-real-wave-artifacts.mjs
scripts/fixtures/manhattan-citywide-search-queries.json
scripts/normalize-dohmh-pilot.mjs
scripts/normalize-manhattan-citywide.mjs
scripts/publish-manhattan-citywide-local.mjs
scripts/validate-manhattan-citywide-coverage.mjs
scripts/validate-manhattan-citywide-raw.mjs
scripts/validate-manhattan-citywide-release.mjs
src/app/App.tsx
src/data/source-registry.ts
src/domain/exploration.test.ts
src/domain/exploration.ts
src/domain/place-truth-fixtures.ts
src/domain/place-truth.test.ts
src/domain/place-truth.ts
src/domain/places.ts
src/domain/schema.ts
src/domain/visitor-navigation.test.ts
src/domain/visitor-navigation.ts
src/features/explorer/CesiumViewport.test.ts
src/features/explorer/CesiumViewport.tsx
src/ingestion/dohmh-citywide-snapshot.test.ts
src/ingestion/dohmh-citywide-snapshot.ts
src/ingestion/fixtures/nyc-building-footprints.real-height-regression.geojson
src/ingestion/fixtures/nyc-building-footprints.real-height-regression.md
src/ingestion/nyc-building-footprints.test.ts
src/ingestion/nyc-building-footprints.ts
src/ingestion/nyc-citywide-building-proof.test.ts
src/ingestion/nyc-citywide-building-proof.ts
src/ingestion/poi-snapshot.ts
src/node-fs.d.ts
src/release/citywide-release.test.ts
src/release/citywide-release.ts
src/runtime/citywide-release-runtime.test.ts
src/runtime/citywide-release-runtime.ts
src/runtime/fixture-adapter.ts
src/runtime/landmark-assets.test.ts
src/runtime/landmark-assets.ts
src/runtime/real-pilot-manifest.test.ts
src/runtime/real-pilot-manifest.ts
src/runtime/real-place-view.test.ts
src/runtime/real-place-view.ts
src/runtime/tile-stream.test.ts
src/styles.css
```

Documentation include candidates after Luna performs section 5:

```text
README.md
docs/PROJECT_BRIEF.md
docs/design/PRIMARY_SCREEN.md
docs/codex/CURRENT_STATE_DOCUMENTATION_AND_DELIVERY_PLAN.md
docs/codex/MANHATTAN_CITYWIDE_FOUNDATION_IMPLEMENTATION.md
docs/codex/PLACE_TRUTH_IMPLEMENTATION.md
docs/decisions/0001-project-foundation.md
docs/decisions/0002-manhattan-data-and-rendering-strategy.md
docs/decisions/0005-streaming-and-dense-rendering.md
docs/decisions/0006-multi-source-reconciliation.md
docs/decisions/0007-catalog-release-assembly.md
docs/decisions/0008-exploration-interaction.md
docs/decisions/0009-visitor-navigation.md
docs/decisions/0010-place-truth-contract-and-approval-gates.md
docs/decisions/0011-blender-mcp-install-and-threat-model.md
docs/decisions/0012-real-data-wave-20260804.md
docs/decisions/0013-manhattan-citywide-foundation-delivery.md
docs/research/BLENDER_MCP.md
docs/research/EXPLORATION_INTERACTION_CONTRACT.md
docs/research/MANHATTAN_CATALOG_RELEASE_ARCHITECTURE.md
docs/research/MANHATTAN_DATA_STRATEGY.md
docs/research/MANHATTAN_POI_RESEARCH.md
docs/research/MANHATTAN_STREAMING_ARCHITECTURE.md
docs/research/NYC_BUILDING_FOOTPRINTS_RESEARCH.md
docs/research/OFFLINE_INGEST_FOUNDATION.md
docs/research/PLACE_TRUTH_SOURCE_MATRIX.md
docs/research/REAL_DATA_RUNBOOK.md
docs/research/RUNTIME_SLICE_FOUNDATION.md
docs/research/VISITOR_NAVIGATION_CONTRACT.md
```

### 6.2 Protected candidate deliverables

These seven untracked runtime assets are likely required for a fresh clone to
pass the landmark package tests and run the bounded pilot. They may be included
only as byte-identical protected deliverables; Luna may not open/save/regenerate
them with Blender:

| Path | Expected SHA-256 |
| --- | --- |
| `public/assets/landmarks/landmark-wave-20260804/manifest.json` | `41fd7e909fc82c5910308da1955ed9f81cc84902fb338224b1a2cf8cce0604e1` |
| `public/assets/landmarks/landmark-wave-20260804/flatiron-building__lod_0.glb` | `89ea83cff781dc52bdd853fb855c7fa61c0617442429c4334e2ad5b42c602db2` |
| `public/assets/landmarks/landmark-wave-20260804/flatiron-building__lod_1.glb` | `7a7c2c7467966d8ca77e4fb0a7ffad73418fcd0ae19a7ea5d2e38fb6aac5e38c` |
| `public/assets/landmarks/landmark-wave-20260804/empire-state-building__lod_0.glb` | `1062622b08d456d2011b744da83dd6d6ccfda399f0a8e5635436cea6ed2a4d80` |
| `public/assets/landmarks/landmark-wave-20260804/empire-state-building__lod_1.glb` | `ccbd194969405a2bfdff734e089de8528ef7c382729c459c570e64823ba39511` |
| `public/assets/landmarks/landmark-wave-20260804/theodore-roosevelt-birthplace__lod_0.glb` | `70723b90da12a30fdbc5306897ba957ab439178a6ce51d819edf1c656422ae01` |
| `public/assets/landmarks/landmark-wave-20260804/theodore-roosevelt-birthplace__lod_1.glb` | `3d76db1a843ebf59bb62499591d86e44daa0c023e904955d118be060008f2a32` |

Blender MCP is not needed for this documentation/civic-data-free work unit. It
becomes mandatory only for a later work unit that authors, edits, inspects, or
exports 3D assets.

### 6.3 Exclude: generated, raw, ignored, partial, or superseded

Never stage these paths or contents:

```text
data/**                         # ~5.4 GiB raw/generated/quarantine state
public/data/**                  # ~395 MiB ignored local runtime releases
public/tiles/**                 # generated tiles
artifacts/offline-ingest/**     # ignored validation/run evidence
dist/**
node_modules/**
coverage/**
**/*.blend
**/*.blend1
artifacts/citywide-wave-20260804/baseline/**
artifacts/citywide-wave-20260804/checkpoint-1/**
artifacts/citywide-wave-20260804/checkpoint-2/**
artifacts/citywide-wave-20260804/recovery-cp2a/**
artifacts/citywide-wave-20260804/recovery-cp2b/**
artifacts/citywide-wave-20260804/recovery-cp2c/**
artifacts/browser/landmark-wave-20260804/empire-runtime.png
artifacts/browser/landmark-wave-20260804/flatiron-runtime.png
artifacts/browser/landmark-wave-20260804/procedural-building-runtime.png
```

The citywide artifact folders are valuable local history but include baseline,
stopped, or recovery checkpoints rather than the final reproducible release.
The uncorrected runtime screenshots are superseded by height-corrected captures.

### 6.4 Investigate before Root chooses include or exclude

| Path(s) | Ambiguity and decision needed |
| --- | --- |
| `AGENTS.md`, `docs/codex/AGENT_WORKFLOW.md` | The modified completion policy is user-authorized and the latter is stale, but workflow-policy delivery is separable from product delivery. Root must decide whether both belong in this single catch-up or must be a separate scoped policy commit. Never stage only one while they conflict. |
| `docs/codex/MANHATTAN_CITYWIDE_WAVE_PLAN.md`, `OTI_CITYWIDE_BUILDING_RECOVERY_PLAN.md`, `DOHMH_CITYWIDE_ACQUISITION_RECOVERY_PLAN.md`, `MANHATTAN_REAL_POI_WAVE_PLAN.md` | Untracked historical planning/recovery evidence supports the implementation but is not operational documentation. Root decides whether preserving that provenance is part of this delivery. |
| `docs/research/MANHATTAN_LANDMARK_ASSET_WAVE_20260804.md` | Its content is accurate if protected hashes match, but it is untracked historical asset provenance. Root decides whether it and any referenced evidence are delivered together or retained only as local evidence. |
| `artifacts/blender/landmark-wave-20260804/*.png` | Untracked binary authoring evidence (~review material). Include only if the implementation record references it and repository evidence-retention policy accepts binary captures. |
| `artifacts/browser/landmark-wave-20260804/README.md`, `*-height-corrected.png` | Corrected browser evidence may be useful, but the repository has no settled rule that screenshots belong in Git. Include all referenced final evidence or keep all such references explicitly local/ignored; do not create broken links. |
| `docs/research/MANHATTAN_TRANSIT_RESEARCH.md` | Dirty but no transit was implemented. Identify whether its diff belongs completed prerequisite research or unrelated pending-provider work. Accuracy does not make it part of this commit automatically. |
| `src/data/source-registry.ts`, `docs/research/MANHATTAN_POI_RESEARCH.md`, `docs/research/PLACE_TRUTH_SOURCE_MATRIX.md` | Same files contain completed OTI/DOHMH truth and pending future-provider entries. Whole-file inclusion is safe only if pending entries remain explicitly `pending`, no payload/provider contact occurred, and no new approval is implied. If hunks cannot be partitioned without changing semantics, stop. |
| `src/app/App.tsx`, `src/features/explorer/CesiumViewport.tsx`, `src/styles.css` | These combine fixture, pilot, landmark, and citywide UI changes. That is coherent only if all four are the already validated foundation. If any hunk belongs an unfinished later feature, file-level staging is unsafe; do not use partial staging to guess. |
| `package.json` | The citywide scripts belong to this wave, but its existing formatting is outside this documentation-only edit scope. If lint/build rejects it or its diff contains any unrelated script/dependency change, stop for a separately planned correction; do not edit it here. |

### 6.5 Unrelated and forbidden current/future work

```text
docs/codex/MANHATTAN_TRAVEL_EXPERIENCE_NEXT_WAVE_PLAN.md
any future DCP NTA, NYC Parks, or LPC source payload, adapter, test, release, UI
any MTA, OSM, Overture, Google, paid/credentialed service, or public deployment
any new/edited 3D source or exported asset
any secret, local environment file, or unrelated user change
```

The future-wave plan remains an unresolved decision artifact, not part of this
delivery unless Root has independent evidence that the user asked to commit it.

### 6.6 Mixed-hunk staging rule

The tree's central files intentionally integrate several completed stages, so
whole-file staging is expected for coherent foundation files. Partial staging is
not a tool for inventing ownership. Luna must inspect `git diff -- <path>` and
compare every hunk to the implementation record. If one file mixes completed
foundation work with abandoned, incomplete, new-provider, or unrelated work and
the boundary is not mechanically certain, Luna stops and reports the file and
smallest required ownership decision. Do not edit the foreign hunk, use
interactive patch staging, or create a synthetic reconstruction from `HEAD`.

## 7. Luna Max handoff

### 7.1 Goal

In one pass, document the already completed local Manhattan citywide foundation,
revalidate it without acquiring data or changing application behavior, prepare
a precise scoped staged diff, obtain Root Sol High final approval, then create
one normal commit and push it to the configured upstream branch.

### 7.2 Allowed areas

- Read the full repository, ignored release manifests/evidence, Git history,
  current upstream state, and Orca browser/runtime state.
- Edit/create only the documentation paths in sections 5.1 and 5.2.
- Stage only Root-approved paths from sections 6.1/6.2 plus explicitly approved
  investigate paths.
- Run existing deterministic tests/build/validation/benchmark commands and a
  local browser preview that makes no external provider request.
- After Root approval only, create one commit and normal push.

### 7.3 Do not touch

- Application source, tests, scripts, dependencies, lockfile, raw/generated
  data, `.blend*`, GLB/manifest bytes, next-wave plan, new-provider work, or any
  unrelated dirty change.
- Do not acquire/regenerate/publish data, contact providers, use Blender/Blender
  MCP, install packages, deploy, or call paid/credentialed services.
- Do not commit/stage/push before the Root gate.
- Do not use destructive or history-rewriting Git operations.

### 7.4 Ordered checkpoints and rollback points

#### Checkpoint 0 — freeze evidence and ownership

1. Load `AGENTS.md` and the version-matched Orca CLI guide.
2. Record current branch, `HEAD`, upstream, dirty paths, untracked paths, ignored
   categories, disk sizes, and `git diff --check`.
3. Record the authoritative release manifest and protected hashes without
   modifying them.
4. Classify every path using section 6 and present investigate decisions to
   Root before editing if they alter the feasible documentation set.

Rollback: no mutations have occurred. If evidence differs from this plan,
report the delta and amend the plan/documentation scope before proceeding.

#### Checkpoint 1 — documentation audit and drafting

1. Create README and the two foundational records.
2. Update every must-update document, using dated status/supersession notes for
   historical records.
3. Produce a documentation audit matrix inside the implementation record with
   every repository doc, result (`updated`/`created`/`no change`), reason, and
   evidence checked.
4. Cross-check counts/hashes/approval scope against the generated manifest,
   source registry, approval decision, code, commands, and evidence.
5. Run stale-claim searches and resolve all unqualified matches.

Rollback: revert only Luna's new documentation edits using a saved patch or
precise `apply_patch`; never discard pre-existing user changes with Git.

#### Checkpoint 2 — deterministic validation

1. Run focused tests, full test/type/lint/build, protected hashes, citywide
   release validation, and benchmark in section 8.
2. Record exact outputs/counts/sizes in the implementation record.
3. If documentation makes an interactive claim not already supported by clear
   final evidence, start a local preview and execute the minimal Orca journeys.
4. Re-audit documentation against the results. Any discrepancy is a docs fix or
   a stop report—not authorization to change application code.

Rollback: remove only newly generated validation outputs under the already
ignored evidence location if necessary; never remove source/raw/release data.
Keep a failed validation report for Root.

#### Checkpoint 3 — Root Sol High final review

1. Provide Root with the unstaged scoped diff, docs audit, test/benchmark/browser
   evidence, protected hashes, excluded-path proof, and proposed pathspec.
2. Resolve documentation-only findings and re-run affected checks.
3. Root explicitly authorizes or rejects the exact path list for staging. This
   is not yet commit authorization.

Rollback: keep the worktree unstaged. If Root requests code/data/asset changes,
stop and require a new Sol Medium plan rather than broadening this unit.

#### Checkpoint 4 — staged-diff review, one commit, and normal push

1. Recheck upstream, stage exactly the authorized pathspec, inspect the full
   staged diff and secret/binary list, and rerun final validation.
2. Give Root the exact staged names, complete staged diff, binary hashes, and
   validation result. Resolve documentation-only findings, restage only the
   approved paths, and repeat until Root explicitly authorizes the commit.
3. Commit once with the scoped message only after that staged-diff approval.
4. Fetch/compare again, push normally, and verify the upstream tip equals the
   recorded commit SHA.

Rollback: before commit, unstage only the exact staged pathspec with
`git restore --staged --pathspec-from-file=...` if Root withdraws approval; this
preserves working-tree content. After commit, do not amend/reset/rebase. If push
fails, keep the local commit, report the failure and exact smallest decision.

### 7.5 Report instead of guessing

Stop and report when any of these occurs:

- a required doc's intended truth cannot be reconciled among code, manifest,
  approval, commands, evidence, and known limitations;
- any full source hash/count/time is unavailable or differs;
- a protected asset hash differs;
- the current full suite, build, release validator, or benchmark fails;
- the local citywide prerequisite is missing and recreating it would contact a
  provider or overwrite an immutable output;
- a dirty path or same-file hunk cannot be partitioned safely;
- the intended treatment of policy files, historical plans, or binary evidence
  remains unclear after Root review;
- `origin/main` moved, histories diverged, or the reviewed base changed;
- staging captures ignored/generated/raw/secret/unrelated content;
- authentication fails or push would overwrite/non-fast-forward;
- completing the task would require code behavior, data acquisition,
  dependency installation, provider contact, Blender, public deployment, or a
  new license/retention commitment.

## 8. Exact commands and checks

Run from `/Users/sangheonlee/dev/games/urban-digital-twin`. Large outputs go
under an ignored task-specific directory such as
`artifacts/offline-ingest/current-state-delivery/`; do not create evidence with
shell redirection into a tracked path.

### 8.1 Documentation/preflight audit

```bash
pwd
orca skills get orca-cli
orca status --json
sed -n '1,260p' AGENTS.md
git branch --show-current
git rev-parse HEAD
git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}'
git rev-parse origin/main
git ls-remote --heads origin refs/heads/main
git status --short
git diff --name-status HEAD
git diff --check
git ls-files --others --exclude-standard | sort
git status --ignored --short
find docs -type f | sort
test ! -e README.md || sed -n '1,260p' README.md
rg -n "fixture only|fixture-only|synthetic fixture|pilot only|pilot-only|no provider|no real|not ingest|full-city.*approval|has no authoritative|asset authoring.*not begun" README.md docs
rg -n "msg_91770ac6d098|jh45-qr5r|43nn-pn8j|45,194|109,386|12,439|12,353|304,382,520" README.md docs package.json src scripts public/assets
git diff -- AGENTS.md docs package.json src scripts .gitignore
```

After docs edits, create a complete audit list from `find docs -type f | sort`
and verify every path appears in the implementation record's documentation
matrix. Search matches are not automatically defects; historical text is valid
only when its date/status or a visible supersession note prevents it from being
mistaken for current truth.

### 8.2 Release and protected evidence

```bash
node -e "const fs=require('node:fs');const p='public/data/manhattan-citywide-20260804/manifest.json';const m=JSON.parse(fs.readFileSync(p,'utf8'));console.log(JSON.stringify(m,null,2))"
du -sh data public/data artifacts/offline-ingest
find public/assets/landmarks/landmark-wave-20260804 -maxdepth 1 -type f -print0 | xargs -0 shasum -a 256 | sort
git check-ignore -v data/raw data/generated public/data artifacts/offline-ingest
git check-ignore -v artifacts/blender/landmark-wave-20260804/urban-digital-twin-landmarks.blend artifacts/blender/landmark-wave-20260804/urban-digital-twin-landmarks.blend1
```

Compare all seven hashes byte-for-byte with section 6.2. Do not open the Blender
source checkpoints.

### 8.3 Deterministic validation

```bash
pnpm exec vitest run src/release/citywide-release.test.ts src/runtime/citywide-release-runtime.test.ts src/features/explorer/CesiumViewport.test.ts src/runtime/landmark-assets.test.ts src/domain/visitor-navigation.test.ts src/ingestion/dohmh-citywide-snapshot.test.ts src/ingestion/nyc-citywide-building-proof.test.ts
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm citywide:validate
pnpm citywide:benchmark
git diff --check
```

Do not run acquisition, normalization, build, or publish-local scripts in this
catch-up; those would mutate raw/generated/public data. `citywide:validate` and
`citywide:benchmark` must be read-only. If code inspection or before/after
hashes show otherwise, stop before invoking them.

### 8.4 Conditional Orca browser journeys

Run only when existing final evidence is insufficient for a statement being
committed. Use the local ignored release; no provider requests are permitted.

```bash
orca terminal create --worktree active --title current-state-doc-verify --command "pnpm dev -- --host 127.0.0.1 --port 4174" --json
orca goto --url http://127.0.0.1:4174 --json
orca snapshot --json
orca console --limit 500 --json
orca network --limit 1000 --json
```

Then use Orca snapshot-derived refs, never guessed DOM selectors, to perform:

1. Fixture journey: load fixture mode, search/select a synthetic building, and
   verify it remains clearly labelled synthetic.
2. Pilot journey: enable the bounded real pilot, select a protected landmark and
   a DOHMH place, and verify provenance/unknown wording and landmark LOD display.
3. Citywide journey: enable release `manhattan-citywide-20260804`; search one
   exact building ID and one restaurant/CAMIS; select from search and map; copy a
   deep link; reload; use Back then Forward; verify the same canonical entity.
4. Failure journey only if its docs claim is current: unknown release and
   unknown parent fail closed without fixture substitution. Cite deterministic
   corruption tests rather than claiming unsupported browser interception.
5. At 390x844, verify search/details/layer controls remain usable. Do not claim
   the browser-tested reduced-motion enabled path unless Orca can actually force
   and observe it.
6. Inspect console and network after journeys: zero unexpected errors and zero
   external provider requests. Record the exact app-origin request count only if
   the session was cleanly reset and the count is reproducible.

Use `orca skills get orca-cli` for the installed command spelling if the
version-matched guide differs. A dead existing preview is not a product failure;
start the local server as above and report if it cannot start.

### 8.5 Read-only upstream comparison before staging

```bash
git remote -v
git rev-parse HEAD
git rev-parse origin/main
git ls-remote --heads origin refs/heads/main
git fetch --prune origin
git rev-list --left-right --count origin/main...HEAD
git merge-base --is-ancestor origin/main HEAD
git status --short
git diff --check
```

For the expected pre-commit state, the left/right count must be `0 0`. If it is
not, stop. Fetch updates remote-tracking refs but does not integrate history; no
merge/rebase is authorized.

### 8.6 Exact scoped staging and staged review

After Root approves the final paths, Luna writes their newline-delimited names
to the ignored file
`artifacts/offline-ingest/current-state-delivery/work-unit-paths.txt`, with no
glob and no directory entry. Then:

```bash
git add --pathspec-from-file=artifacts/offline-ingest/current-state-delivery/work-unit-paths.txt
git status --short
git diff --cached --name-status
git diff --cached --stat
git diff --cached --check
git diff --cached --no-ext-diff -- . ':(exclude)public/assets/landmarks/landmark-wave-20260804/*.glb'
git diff --cached --numstat
git diff --cached --name-only | rg '(^|/)(data|public/data|artifacts/offline-ingest|node_modules|dist|coverage)/|\.blend1?$|(^|/)\.env($|\.)'
git diff --cached --no-color | rg -n '(BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|api[_-]?key|access[_-]?token|client[_-]?secret|password)[[:space:]]*[:=]'
find public/assets/landmarks/landmark-wave-20260804 -maxdepth 1 -type f -print0 | xargs -0 shasum -a 256 | sort
```

The two `rg` commands must return no suspicious match; because no-match exits
1, evaluate their output rather than interpreting exit 1 as a validation
failure. Root must inspect the full text diff and binary name/size/hash list.
If anything extra is staged, unstage only the explicit path with
`git restore --staged -- <exact-path>` and preserve the working-tree file.

Re-run the complete section 8.3 validation against the exact staged/worktree
state. Confirm there are no post-review documentation edits before committing:

```bash
git diff --cached --check
git diff --check
git status --short
```

### 8.7 One commit, push, and remote-tip verification

Only after Root's explicit finalization authorization:

```bash
git commit -m "Document and deliver Manhattan citywide foundation"
work_unit_commit_sha=$(git rev-parse HEAD)
git show --stat --oneline --decorate "$work_unit_commit_sha"
git status --short
git fetch --prune origin
git rev-list --left-right --count origin/main...HEAD
git merge-base --is-ancestor origin/main HEAD
test "$(git rev-list --count HEAD..origin/main)" -eq 0
git push --porcelain origin HEAD:main
remote_main_sha=$(git ls-remote --heads origin refs/heads/main | awk '{print $1}')
test "$remote_main_sha" = "$work_unit_commit_sha"
printf '%s\n' "commit=$work_unit_commit_sha" "remote_main=$remote_main_sha"
```

Immediately before push, `origin/main` must be an ancestor of the one local
work-unit commit and `HEAD..origin/main` must be zero. If upstream moved,
authentication fails, or push is rejected, do not retry with force or integrate
history. Report the local commit SHA, remote SHA, exact error, and smallest
decision required.

## 9. Root Sol High final-review gate

Root must review and explicitly answer each gate first for the proposed path
list, then again against the exact staged diff before authorizing the commit:

1. **Truth:** Do README/current-state docs match code, current release manifest,
   command output, final evidence, and limitations with no unsupported claims?
2. **Data rights:** Is approval `msg_91770ac6d098` represented as local-only OTI
   and DOHMH scope, with no public redistribution/new-provider inference and
   correct attribution/terms?
3. **Protected paths:** Do all seven landmark hashes match, are `.blend*` files
   excluded, and is no asset edit hidden in the diff?
4. **Generated/raw exclusion:** Are `data/**`, `public/data/**`,
   `artifacts/offline-ingest/**`, partial/recovery artifacts, build outputs, and
   secrets absent from the staged paths?
5. **Documentation completeness:** Are README, the implementation record, and
   Decision 0013 present; is every document classified; and are all must-update
   files accurate?
6. **Validation:** Did focused/full tests, typecheck, lint, build, citywide
   validator, benchmark, and any necessary browser truth checks pass on the
   exact candidate tree with exact counts/results recorded?
7. **Partition safety:** Are the policy files, historical plans, binary
   evidence, and mixed source/UI/research files intentionally included or
   excluded with ownership evidence?
8. **Staged diff:** Does the exact path list represent one coherent completed
   foundation, with no incomplete, failed, future-provider, or unrelated hunk?
9. **Upstream:** Is the reviewed base still the configured upstream tip with no
   divergence?

Any “no” blocks finalization. Root reviews; Luna resolves documentation findings
and revalidates. A code/data/asset finding requires a new planned work unit.

## 10. Measurable delivery budgets

| Budget | Gate |
| --- | --- |
| Commits | Exactly 1 after Root approval. |
| Pushes | Exactly 1 normal push attempt after final upstream comparison; a credential/non-fast-forward failure is reported, not bypassed. |
| New providers/data | 0 provider calls, 0 new datasets, 0 acquired/generated/published payloads. |
| Dependencies | 0 additions/updates; lockfile unchanged. |
| Application behavior | 0 intentional code/runtime/test behavior changes. |
| Protected assets | 7 published files, byte-identical to listed SHA-256 values; 0 Blender source/export changes. |
| Ignored/raw/generated data staged | 0 files and 0 bytes. |
| Documentation classification | 100% of `find docs -type f` plus README. |
| Required docs | 3 created; every must-update path updated; all no-change paths audited. |
| Deterministic checks | 100% pass; exact test counts/build sizes/benchmark output recorded. |
| Unresolved stale current-state claims | 0 unqualified claims after documented search/review. |
| External runtime requests in any new browser run | 0 provider requests. |

## 11. Pre-exit checklist

Before Luna reports completion:

- [ ] Full `AGENTS.md` and Orca CLI guide read.
- [ ] Current `HEAD`, upstream, dirty/untracked/ignored inventories recorded.
- [ ] No provider contacted and no data acquired/regenerated/published.
- [ ] README, implementation record, and Decision 0013 created.
- [ ] Every must-update doc updated and every no-change doc logged.
- [ ] Documentation facts reconciled with manifest, approval, code, commands,
      evidence, and limitations.
- [ ] Full raw snapshot hashes copied in full from authoritative metadata; no
      placeholder/abbreviated hash remains.
- [ ] All seven protected hashes match; `.blend*` excluded; Blender unused.
- [ ] Focused tests, full tests, typecheck, lint, build, citywide validate, and
      benchmark pass with exact results recorded.
- [ ] Conditional browser journeys run only where needed; any claims match the
      observed evidence, including reduced-motion/corruption limitations.
- [ ] Root resolved all investigate paths and mixed-hunk ownership.
- [ ] Root completed the nine-part final review and explicitly authorized the
      exact pathspec and finalization.
- [ ] Fresh fetch shows no upstream change/divergence.
- [ ] Staged names, stat, text diff, binary hashes, secret scan, and
      raw/generated exclusions reviewed.
- [ ] Exactly one scoped commit created and its SHA recorded.
- [ ] Normal push succeeded and remote `main` tip equals that SHA.
- [ ] Remaining dirty paths are reported and preserved, not described as errors
      or discarded.

## 12. Feasibility and unresolved gate

A safe catch-up commit appears **conditionally feasible**: the completed code,
tests, scripts, local release metadata, protected runtime assets, and final
evidence form a coherent Manhattan citywide foundation, and the remote tip had
not moved at planning time. It is not yet safe to stage. Root must first resolve
whether workflow-policy files, historical plan/recovery records, and binary
evidence belong in this commit, and must confirm that the mixed registry/UI/
research files contain no unfinished later-wave hunks.

The DCP 2020 NTA, NYC Parks Properties, and LPC designated/calendared-sites
approval gate remains unresolved. This catch-up retains no new source data,
incurs no new license/attribution/retention commitment or cost, and authorizes
no action on that future wave. Luna may work only on the documentation,
validation, review, and finalization described here; real civic-data work can
begin only after the user separately approves the three named sources and their
documented local retention/derivative/attribution scope.
