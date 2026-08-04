# Manhattan citywide foundation implementation record

Evidence date: 2026-08-04 (Asia/Seoul)
Work unit: documentation catch-up, CP0 through CP3 only
Provider state: no provider contact and no new data approval in this work unit
Owner: Luna Max; Root Sol High owns final review and any later staging/commit/push gate

## Scope and ownership freeze

This record documents the already present Manhattan foundation. It does not
implement features or change code, tests, scripts, package metadata, raw data,
generated releases, Blender assets, or browser evidence. `AGENTS.md` was read
and left read-only; `docs/codex/AGENT_WORKFLOW.md` was synchronized because
Root explicitly included the workflow policy in this catch-up.

At CP0 the repository was on branch `main` at `919ca5f76151b04f45fe91fc8188c7f0239a37d9`.
The configured upstream was `origin/main`; local `origin/main` and
`refs/heads/main` both resolved to the same SHA. `git diff --check` passed
before documentation edits. The worktree already contained tracked source,
package, script, policy, and research changes plus untracked plans, assets,
and ignored release state. Every pre-existing non-documentation path remains
outside this Luna documentation diff and must be Root-reviewed separately.

### CP0 path classification

| Classification | Paths and treatment |
| --- | --- |
| Documentation created/updated by this task | `README.md`; `docs/codex/MANHATTAN_CITYWIDE_FOUNDATION_IMPLEMENTATION.md`; `docs/decisions/0013-manhattan-citywide-foundation-delivery.md`; all `updated` paths in the audit matrix below. |
| Read-only policy candidate | `AGENTS.md` was pre-existing user-authorized work and was not edited; `docs/codex/AGENT_WORKFLOW.md` was updated to agree. Root decides final staging as one policy pair. |
| Pre-existing completed-foundation candidates, not edited here | `.gitignore`, `package.json`, `scripts/**` citywide additions, `src/**` fixture/pilot/citywide code and tests, and `src/styles.css` listed in plan section 6.1. Package diff adds citywide scripts only; no dependency/lockfile change was made by this task. |
| Historical provenance retained, not edited | `docs/codex/MANHATTAN_CITYWIDE_WAVE_PLAN.md`, `OTI_CITYWIDE_BUILDING_RECOVERY_PLAN.md`, `DOHMH_CITYWIDE_ACQUISITION_RECOVERY_PLAN.md`, `MANHATTAN_REAL_POI_WAVE_PLAN.md`; `docs/research/MANHATTAN_LANDMARK_ASSET_WAVE_20260804.md`; Decision 0012 pilot record. Root decisions include these as historical candidates only. |
| Explicitly excluded | `docs/codex/MANHATTAN_TRAVEL_EXPERIENCE_NEXT_WAVE_PLAN.md`; `docs/research/MANHATTAN_TRANSIT_RESEARCH.md` dirty pending-provider work; screenshots and Blender `.blend*`/binary evidence; all `data/**`, `public/data/**`, `public/tiles/**`, `artifacts/**`, build/coverage/node_modules, secrets, and unrelated paths. |
| Protected candidate binaries | Seven files under `public/assets/landmarks/landmark-wave-20260804/`, hash-checked below and never opened, edited, regenerated, or exported in this task. |

The source registry was checked for later civic implementation. Only OTI and
DOHMH are `approved` for the local real-data wave, fixture entries are
`approved` with `test-only` scope, and DCP/NTA, Parks, LPC sites, Facilities,
MTA, OSM, Overture, Google, traffic, hosting, and other future entries remain
explicitly `pending` or separately gated. The pending entries imply no
provider contact or approval.

### Pre-existing dirty paths at CP0

Tracked modified paths were: `.gitignore`, `AGENTS.md`,
`docs/research/BLENDER_MCP.md`, `docs/research/MANHATTAN_POI_RESEARCH.md`,
`docs/research/MANHATTAN_TRANSIT_RESEARCH.md`,
`docs/research/NYC_BUILDING_FOOTPRINTS_RESEARCH.md`, `package.json`,
`scripts/run-nyc-building-ingest.mjs`, `src/app/App.tsx`,
`src/data/source-registry.ts`, `src/domain/exploration.test.ts`,
`src/domain/exploration.ts`, `src/domain/places.ts`, `src/domain/schema.ts`,
`src/domain/visitor-navigation.test.ts`, `src/domain/visitor-navigation.ts`,
`src/features/explorer/CesiumViewport.tsx`,
`src/ingestion/nyc-building-footprints.test.ts`,
`src/ingestion/nyc-building-footprints.ts`, `src/ingestion/poi-snapshot.ts`,
`src/runtime/fixture-adapter.ts`, `src/runtime/tile-stream.test.ts`, and
`src/styles.css`. Nonignored untracked paths at CP0 were the `artifacts/`
evidence tree, historical/current docs and plans, `public/` runtime assets,
citywide acquisition/build/validation scripts and fixtures, and the new
citywide/real-place source/runtime/test files listed by `git status --short`.
No path was staged, committed, or pushed.

Ignored local state at CP0 measured approximately `5.4G data`, `395M
public/data`, and `2.8M artifacts/offline-ingest`. The ignored roots are
protected from staging by `.gitignore`; their contents are not part of a fresh
clone. No `.blend` source checkpoint was opened.

## Release and source evidence

The authoritative manifest is
`public/data/manhattan-citywide-20260804/manifest.json` (ignored local
release). It records:

| Field | Observed value |
| --- | --- |
| `releaseId` / `scope` / `outputCrs` | `manhattan-citywide-20260804` / `citywide` / `EPSG:4326` |
| `generatedAt` | `2026-08-04T00:00:00.000Z` |
| Approval | `msg_91770ac6d098`, local snapshot-relative OTI/DOHMH; excludes new providers, Google-derived data, public deployment, unrelated datasets |
| OTI source | `jh45-qr5r`; capture `2026-08-04T08:25:05.580Z`; source update `2026-08-02T02:17:27.174Z`; 41,739,923 bytes; SHA-256 `52c841e388f8e56e6e3666d2ce8b6436ec10f9eeb2bbcad2b2452b51d58dafc7`; 45,194 source/accepted records |
| DOHMH source | `43nn-pn8j`; capture `2026-08-04T07:41:56.726Z`; source update `2026-08-03T22:06:07.000Z`; 114,488,021 bytes; SHA-256 `cb4cb6fce7a3744672882e63f2d3542674d7f76334d1a8aa2a7bfa76bd48b627`; 109,386 source/accepted observations |
| Building layer | 45,194 parents; 45,194 render parts; 56 layer shards |
| Restaurant layer | 12,439 parents; 12,353 located render parts; 47 layer shards; 86 unlocated parents remain in details/search |
| Shards | 103 geometry; 214 search; 134 detail |
| Detail index | 57,633 unique parent entries |
| Release accounting | `totalDeclaredBytes=304382520`; remainder `0`; identity collisions `0`; `pilotReplayStable=true` |

The release is local JSON/shard delivery. The application does not call OTI or
DOHMH at runtime and fails closed rather than substituting a fixture for a
missing real parent. OTI positive `HEIGHT_ROOF` values preserve feet-equivalent
source provenance and convert to meters; unknown ground-elevation units remain
unknown. DOHMH inspection grade/action is not a rating or current status.

## Protected landmark hash evidence

Hashing the seven candidate runtime files at CP0 matched the historical asset
wave and plan section 6.2 exactly:

| Path | SHA-256 |
| --- | --- |
| `public/assets/landmarks/landmark-wave-20260804/manifest.json` | `41fd7e909fc82c5910308da1955ed9f81cc84902fb338224b1a2cf8cce0604e1` |
| `public/assets/landmarks/landmark-wave-20260804/flatiron-building__lod_0.glb` | `89ea83cff781dc52bdd853fb855c7fa61c0617442429c4334e2ad5b42c602db2` |
| `public/assets/landmarks/landmark-wave-20260804/flatiron-building__lod_1.glb` | `7a7c2c7467966d8ca77e4fb0a7ffad73418fcd0ae19a7ea5d2e38fb6aac5e38c` |
| `public/assets/landmarks/landmark-wave-20260804/empire-state-building__lod_0.glb` | `1062622b08d456d2011b744da83dd6d6ccfda399f0a8e5635436cea6ed2a4d80` |
| `public/assets/landmarks/landmark-wave-20260804/empire-state-building__lod_1.glb` | `ccbd194969405a2bfdff734e089de8528ef7c382729c459c570e64823ba39511` |
| `public/assets/landmarks/landmark-wave-20260804/theodore-roosevelt-birthplace__lod_0.glb` | `70723b90da12a30fdbc5306897ba957ab439178a6ce51d819edf1c656422ae01` |
| `public/assets/landmarks/landmark-wave-20260804/theodore-roosevelt-birthplace__lod_1.glb` | `3d76db1a843ebf59bb62499591d86e44daa0c023e904955d118be060008f2a32` |

The seven values matched section 6.2 at CP0 and will be rechecked after
validation. Blender source checkpoints and screenshots are intentionally
excluded.

## Browser evidence boundary

Existing ignored evidence under
`artifacts/offline-ingest/citywide-wave-20260804/evidence/` was reused rather
than regenerated. It records fixture/pilot mode preservation, citywide
activation, exact building and CAMIS search/focus, reload/Back/Forward,
unlocated CAMIS detail without a marker, mobile 390×844 keyboard/details
behavior, zero unexpected console errors, and zero external provider requests
(175 app-origin requests in that clean capture). It explicitly records that
reduced-motion enabled-path override, exact 200% zoom, and corrupt-shard
browser interception were unsupported; corruption and unknown-release/parent
behavior are covered by deterministic tests. The evidence files and images
remain ignored/local and are not linked as tracked artifacts.

## Deterministic validation transcript

CP2 was rerun after the final documentation-only stale-claim corrections. All
required commands exited zero; the only emitted warning was Vite's existing
large JavaScript chunk advisory. The command transcript and measured release
facts are:

```sh
pnpm exec vitest run src/release/citywide-release.test.ts src/runtime/citywide-release-runtime.test.ts src/features/explorer/CesiumViewport.test.ts src/runtime/landmark-assets.test.ts src/domain/visitor-navigation.test.ts src/ingestion/dohmh-citywide-snapshot.test.ts src/ingestion/nyc-citywide-building-proof.test.ts
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm citywide:validate
pnpm citywide:benchmark
git diff --check
```

```text
pnpm exec vitest run src/release/citywide-release.test.ts src/runtime/citywide-release-runtime.test.ts src/features/explorer/CesiumViewport.test.ts src/runtime/landmark-assets.test.ts src/domain/visitor-navigation.test.ts src/ingestion/dohmh-citywide-snapshot.test.ts src/ingestion/nyc-citywide-building-proof.test.ts
  Test Files  7 passed (7)
       Tests  51 passed (51)
pnpm typecheck
  $ tsc -b --pretty false
pnpm test
  Test Files  27 passed (27)
       Tests  152 passed (152)
pnpm lint
  $ eslint .
pnpm build
  $ tsc -b && vite build
  3247 modules transformed
  dist/index.html                     0.51 kB | gzip:     0.32 kB
  dist/assets/index-mShHJ15H.css    41.93 kB | gzip:     9.25 kB
  dist/assets/index-N4rC67Dg.js  4,573.15 kB | gzip: 1,230.93 kB
  built in 1.42s
  warning: some chunks are larger than 500 kB after minification
pnpm citywide:validate
  valid=true; declaredFiles=452; measuredTotal=304382520; rootBytes=226558
  buildings bytes=41739923 sha256=52c841e388f8e56e6e3666d2ce8b6436ec10f9eeb2bbcad2b2452b51d58dafc7 count=45194
  restaurants bytes=114488021 sha256=cb4cb6fce7a3744672882e63f2d3542674d7f76334d1a8aa2a7bfa76bd48b627 count=109386
  detailParents=57633 detailBuildingParts=45194 detailRestaurantObservations=109386 detailUnlocated=86
  searchParents=57633 geometryBuildings=45194 geometryRestaurants=12353
  geometryShardCount=103 searchShardCount=214 detailShardCount=134
  totalDeclaredBytes=304382520
pnpm citywide:benchmark
  releaseId=manhattan-citywide-20260804; queryDefinitionCount=30
  queryKinds=exact-id:4, bin:2, bbl:4, name:4, address-token:3, cuisine:3,
    unicode:4, unlocated-camis:2, camis:2, no-result:2
  searchSamples=30 pickSamples=30; unicodeSourceValuesAreNonAscii=true
  noResultSamplesAreExactlyZero=true; coldSearchShardLoads=117
  warmSearchShardLoads=78; coldDetailShardLoads=30; warmDetailShardLoads=2
  coldSearchP95Ms=16.15695800000003; warmSearchP95Ms=16.538583000000017
  coldPickP95Ms=4.36324999999988; warmPickP95Ms=2.2633749999999964
  searchCacheEntries=78; detailCacheEntries=2; boundedReleaseShards=451
  totalDeclaredBytes=304382520
git diff --check
  passed
```

The benchmark printed 30 query samples; each sample's `matchedExpectedIds`
equalled `expectedIds`, including exact source IDs, BIN/BBL, Unicode, unlocated
CAMIS, and no-result cases. The latency values are observations from this run,
not a universal frame-time or fresh-clone performance claim. The build output
was written to the already ignored `dist/` directory and is excluded below;
the release validator and benchmark were read-only and did not emit an
evidence file.

Protected hashes were rechecked after validation and remained exactly the seven
values listed above. Generated/raw exclusion checks also passed: `data/raw/`,
`data/generated/`, `public/data/`, and `artifacts/offline-ingest/` matched the
expected ignore rules; `git ls-files` contained no `data/`, `public/data/`,
`artifacts/`, `dist/`, or `coverage/` payload; and no untracked raw/generated
top-level path was present. `find docs -type f | sort` returned 42 files, and
the audit-row check covered all 42 paths.

No acquisition, normalization, build, publish-local, provider, Blender, or
browser-provider command is permitted in this work unit. The validator and
benchmark must be run against the retained local release without writing an
evidence file.

## Complete documentation audit matrix

Every path returned by `find docs -type f | sort` at CP0 is classified here;
the PNG is a tracked concept asset and not a runtime screenshot.

| Document | Result | Reason/evidence checked |
| --- | --- | --- |
| `docs/PROJECT_BRIEF.md` | updated | Added delivered foundation, local-only release, and limitations; preserved product ambition. |
| `docs/codex/AGENT_WORKFLOW.md` | updated | Synchronized with user-authorized `AGENTS.md` visible Root/Sol Medium/Luna Max workflow and final commit gate. |
| `docs/codex/CURRENT_STATE_DOCUMENTATION_AND_DELIVERY_PLAN.md` | no change | Authoritative historical/active plan read completely; preserved as plan provenance. |
| `docs/codex/DOHMH_CITYWIDE_ACQUISITION_RECOVERY_PLAN.md` | no change | Historical acquisition/recovery provenance; not an operation guide. |
| `docs/codex/MANHATTAN_CITYWIDE_WAVE_PLAN.md` | no change | Historical citywide plan retained per Root decision. |
| `docs/codex/MANHATTAN_REAL_POI_WAVE_PLAN.md` | no change | Historical future-wave planning record; pending sources remain pending. |
| `docs/codex/MANHATTAN_TRAVEL_EXPERIENCE_NEXT_WAVE_PLAN.md` | no change/excluded | Future conditional DCP/Parks/LPC plan explicitly excluded from this catch-up. |
| `docs/codex/OTI_CITYWIDE_BUILDING_RECOVERY_PLAN.md` | no change | Historical OTI recovery evidence retained per Root decision. |
| `docs/codex/PLACE_TRUTH_IMPLEMENTATION.md` | updated | Reconciled fixture place-truth with real OTI/DOHMH scope and unknown-state limits. |
| `docs/concepts/primary-desktop.png` | no change | Tracked concept asset; not opened or represented as runtime evidence. |
| `docs/decisions/0001-project-foundation.md` | updated | Added dated workflow supersession note; historical body preserved. |
| `docs/decisions/0002-manhattan-data-and-rendering-strategy.md` | updated | Added delivered local release status and preserved future gates. |
| `docs/decisions/0003-transit-foundation.md` | no change | Transit remains synthetic/pending and was not implemented. |
| `docs/decisions/0004-routing-foundation.md` | no change | Routing remains synthetic/pending and was not implemented. |
| `docs/decisions/0005-streaming-and-dense-rendering.md` | updated | Added citywide JSON/shard status without claiming production 3D Tiles. |
| `docs/decisions/0006-multi-source-reconciliation.md` | updated | Distinguished synthetic reconciliation from approved OTI/DOHMH adapters. |
| `docs/decisions/0007-catalog-release-assembly.md` | updated | Added local citywide release implementation status and preserved gates. |
| `docs/decisions/0008-exploration-interaction.md` | updated | Added real-release search/pick/detail/fail-closed behavior. |
| `docs/decisions/0009-visitor-navigation.md` | updated | Added real-release deep-link/camera status and synthetic routing limit. |
| `docs/decisions/0010-place-truth-contract-and-approval-gates.md` | updated | Added narrow OTI/DOHMH place-truth integration note. |
| `docs/decisions/0011-blender-mcp-install-and-threat-model.md` | updated | Marked installation status historical and separated protected landmark wave. |
| `docs/decisions/0012-real-data-wave-20260804.md` | updated | Added dated supersession note; preserved bounded pilot provenance. |
| `docs/decisions/0013-manhattan-citywide-foundation-delivery.md` | created | New accepted delivery decision for the completed local foundation. |
| `docs/design/PRIMARY_SCREEN.md` | updated | Added current three-mode/search/details behavior and labeled concept/setup history. |
| `docs/research/BLENDER_MCP.md` | updated | Added protected landmark asset status; this task did not use Blender MCP. |
| `docs/research/EXPLORATION_INTERACTION_CONTRACT.md` | updated | Added OTI/DOHMH real-release interaction behavior and category limits. |
| `docs/research/MANHATTAN_AREA_RESEARCH.md` | no change | NTA/area sources remain pending; no real area data was added. |
| `docs/research/MANHATTAN_CATALOG_RELEASE_ARCHITECTURE.md` | updated | Added current release counts and local JSON/shard status. |
| `docs/research/MANHATTAN_DATA_STRATEGY.md` | updated | Marked scaffold description historical and linked Decision 0013. |
| `docs/research/MANHATTAN_LANDMARK_ASSET_WAVE_20260804.md` | no change | Historical asset provenance retained; hashes checked without opening files. |
| `docs/research/MANHATTAN_POI_RESEARCH.md` | updated | Added citywide DOHMH counts and pending-category boundary. |
| `docs/research/MANHATTAN_RECONCILIATION_STRATEGY.md` | no change | Provider-neutral future reconciliation strategy remains accurate. |
| `docs/research/MANHATTAN_ROUTING_STRATEGY.md` | no change | Real routing sources remain pending; fixture routing only. |
| `docs/research/MANHATTAN_STREAMING_ARCHITECTURE.md` | updated | Added local citywide lazy shard behavior and production 3D Tiles gap. |
| `docs/research/MANHATTAN_TRANSIT_RESEARCH.md` | no change/excluded | Dirty pending-provider research; Root explicitly excluded it. |
| `docs/research/NYC_BUILDING_FOOTPRINTS_RESEARCH.md` | updated | Added citywide OTI snapshot facts and bounded approval boundary. |
| `docs/research/OFFLINE_INGEST_FOUNDATION.md` | updated | Added approved OTI/DOHMH adapter state and pending-source limits. |
| `docs/research/PLACE_TRUTH_SOURCE_MATRIX.md` | updated | Added delivered source boundary and retained candidate approvals as pending. |
| `docs/research/REAL_DATA_RUNBOOK.md` | updated | Added local citywide prerequisites/checks and labeled pilot procedure historical. |
| `docs/research/RUNTIME_SLICE_FOUNDATION.md` | updated | Added current adapter/release modes and JSON/3D Tiles boundary. |
| `docs/research/VISITOR_NAVIGATION_CONTRACT.md` | updated | Added real-release camera/deep-link behavior and synthetic route limits. |

## Proposed pathspec split (unstaged)

This is an exact candidate split for Root's staged-diff review, not a staging
operation. No path was staged, and the split preserves the user's pre-existing
work while making the completed foundation reviewable as whole files.

### Include candidates

Policy and documentation candidates are:

```text
AGENTS.md
README.md
docs/PROJECT_BRIEF.md
docs/design/PRIMARY_SCREEN.md
docs/codex/AGENT_WORKFLOW.md
docs/codex/CURRENT_STATE_DOCUMENTATION_AND_DELIVERY_PLAN.md
docs/codex/DOHMH_CITYWIDE_ACQUISITION_RECOVERY_PLAN.md
docs/codex/MANHATTAN_CITYWIDE_FOUNDATION_IMPLEMENTATION.md
docs/codex/MANHATTAN_CITYWIDE_WAVE_PLAN.md
docs/codex/MANHATTAN_REAL_POI_WAVE_PLAN.md
docs/codex/OTI_CITYWIDE_BUILDING_RECOVERY_PLAN.md
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
docs/research/MANHATTAN_LANDMARK_ASSET_WAVE_20260804.md
docs/research/MANHATTAN_POI_RESEARCH.md
docs/research/MANHATTAN_STREAMING_ARCHITECTURE.md
docs/research/NYC_BUILDING_FOOTPRINTS_RESEARCH.md
docs/research/OFFLINE_INGEST_FOUNDATION.md
docs/research/PLACE_TRUTH_SOURCE_MATRIX.md
docs/research/REAL_DATA_RUNBOOK.md
docs/research/RUNTIME_SLICE_FOUNDATION.md
docs/research/VISITOR_NAVIGATION_CONTRACT.md
```

The completed foundation candidate is the whole-file section-6.1 set, verified
by focused/full validation and the pending-source audit:

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

The protected runtime asset candidates are exactly these seven byte-identified
files; they were never opened or edited:

```text
public/assets/landmarks/landmark-wave-20260804/manifest.json
public/assets/landmarks/landmark-wave-20260804/flatiron-building__lod_0.glb
public/assets/landmarks/landmark-wave-20260804/flatiron-building__lod_1.glb
public/assets/landmarks/landmark-wave-20260804/empire-state-building__lod_0.glb
public/assets/landmarks/landmark-wave-20260804/empire-state-building__lod_1.glb
public/assets/landmarks/landmark-wave-20260804/theodore-roosevelt-birthplace__lod_0.glb
public/assets/landmarks/landmark-wave-20260804/theodore-roosevelt-birthplace__lod_1.glb
```

### Exclude and remain dirty

The following paths remain local/dirty and are not in the proposed include
pathspec:

```text
docs/codex/MANHATTAN_TRAVEL_EXPERIENCE_NEXT_WAVE_PLAN.md
docs/research/MANHATTAN_TRANSIT_RESEARCH.md
data/**
public/data/**
public/tiles/**
artifacts/**
dist/**
node_modules/**
coverage/**
**/*.blend
**/*.blend1
```

This also excludes all screenshots, Blender authoring evidence, raw/generated
releases, secrets, local environment files, and any unexplained/unrelated path.
`MANHATTAN_TRANSIT_RESEARCH.md` is a pre-existing dirty pending-provider file;
the future-wave plan is an explicitly excluded untracked decision artifact.
The seven protected landmark files are the only exception to the broad asset
exclusion and are listed explicitly above.

The include candidates are still subject to Root's final ownership review:
whole-file inclusion is safe only for the section-6.1 foundation after Root
confirms the same pending-source and no-provider-contact boundary documented
here. This record does not stage a path or create a pathspec file.

### Final unstaged diff/stat evidence

The final tracked worktree diff remained exactly:

```text
40 files changed, 2087 insertions(+), 297 deletions(-)
```

That tracked stat includes the pre-existing source/package/script/policy dirty
paths listed in CP0; it does not include untracked files. The complete
untracked candidate list and the exact include/exclude split are shown above,
and the complete tracked name-status list is the CP0 dirty-path list plus the
updated documentation rows in the audit matrix. `git diff --check` passed,
the explicit documentation trailing-whitespace check passed, and
`git diff --cached --name-only` was empty. Root should inspect the full
unstaged `git diff` and each untracked include candidate before staging.

## Rollback and pre-exit status

Rollback is limited to Luna's documentation hunks using a saved diff or
precise `apply_patch`; no reset, clean, checkout, delete, or discard operation
is permitted. Before Root review, the working tree remains unstaged. Final
completion requires the validation transcript below to be green, unchanged
protected hashes, a clean documentation-only diff boundary, Root's nine-part
review, and an exact remaining-dirty-path report. Commit and push are outside
this task.
