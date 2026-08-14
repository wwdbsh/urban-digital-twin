# T004 — citywide overview streaming over the committed dense shards

Issue #69. Branch `fcp/69-overview-streaming`. Behind `?exteriorScheduler=on`.
Decision record: `docs/decisions/0043-citywide-overview-streaming.md`.

## What was added

- `CITYWIDE_OVERVIEW_BUDGETS`, `resolveCitywideBudgets`, `CitywideBudgetRecord`,
  `citywideCacheClass`, `CitywideCacheFloors` and
  `CITYWIDE_OVERVIEW_CACHE_FLOORS` in `src/release/citywide-release.ts`.
- Per-class floors, per-class residency (`classSizes`) and per-class eviction
  counters (`classEvictionCounts`) on `CitywideLruCache`, with victim selection
  changed from a full sort per drop to one linear minimum scan.
- Shard-identity feature memoization in `CitywideReleaseAdapter`
  (`shardFeatureMemo`, `committedVisibleShards`, `visibleFeatureView`).
- `scripts/citywide-overview-streaming-evidence-cli.mjs` with two stages,
  `containment` (offline, deterministic) and `probe` (live Chrome over CDP).
- A build-time-gated overview probe in `App.tsx`
  (`VITE_CITYWIDE_OVERVIEW_PROBE=1`, `data-citywide-overview-probe`) recording
  per-move refresh cost, sequence retention and per-class cache state.
- Evidence under `data/citywide-overview-streaming-20260814/`:
  `dense-coverage-containment.json`, `overview-probe.json`, both with
  `.sha256`, and `captures/island-overview.png`.

## What was modified

- `src/runtime/citywide-release-runtime.ts`: `CitywideRuntimeOptions.budgets`,
  every `CITYWIDE_BUDGETS.*` read inside the adapter replaced by
  `this.budgets.*`, the `refreshViewport` decode path split into a visible-shard
  pass plus a memoized per-shard decode, `getFeatures` memoized and its
  redundant re-sort removed.
- `src/runtime/composed-release-runtime.ts`: `getBaseFeatures` and
  `getContextFeatures` copy before sorting; aggregate metrics report the live
  cache's caps and the base adapter's dense limit instead of the constant.
- `src/app/App.tsx`: session budget record resolved from the one flag, shared
  cache constructed from it with floors, `budgets` threaded to
  `loadCitywideRelease`, dense limits read from the record, DEV per-class cache
  residency line, two hard-coded diagnostics strings replaced by live values.
- `src/runtime/composed-release-runtime.test.ts`: fixture declares `budgets`
  and a real 48-MiB byte cap (see "defect found" below).

## Measurements

Headless Chrome 151, 1440x900, dev server with `VITE_CITYWIDE_OVERVIEW_PROBE=1`,
`data/citywide-overview-streaming-20260814/overview-probe.json`.

Per-move `refreshViewport`, recorded pan path:

| move | resident | ms | sequence |
| --- | --- | --- | --- |
| 0 | 0 entries | 73.0 | rebuilt |
| 1 | 15 entries | 520.7 | retained |
| 2 | 101 entries / 54,840 features | 1,653.8 | rebuilt |
| 3 | 105 entries / 57,313 features | 365.9 | rebuilt |
| 4 | unchanged | **2.9** | **retained** |
| 5 | unchanged | **2.6** | **retained** |

Per station (`buildings / POIs / primitives`, `planBuild/Reuse/Cancel/Swap`,
`allocationMaxSliceMs`, chunks, `totalBuildMs`):

| station | features | plans | slice | chunks | total |
| --- | --- | --- | --- | --- | --- |
| island-overview | 45,154 / 12,119 / 32 | 4 / 7 / 2 / 1 | 9.4 | 478 | 20.8 |
| overview-nudge-north | 45,154 / 12,119 / 32 | 4 / 10 / 2 / 1 | 14.5 | 478 | 23.2 |
| overview-nudge-east | 43,267 / 10,759 / 30 | 3 / 12 / 1 / 1 | 10.7 | 451 | 26.0 |
| overview-nudge-back | 45,154 / 12,119 / 32 | 4 / 8 / 2 / 1 | 9.8 | 478 | 20.7 |
| descend-midtown | 17,324 / 2,202 / 13 | 3 / 6 / 1 / 1 | 1.5 | 163 | 50.5 |
| return-overview | 45,154 / 12,119 / 32 | 4 / 11 / 2 / 1 | 8.1 | 478 | 56.4 |
| search-detail-storm | 45,154 / 12,119 / 32 | 4 / 11 / 2 / 1 | 7.3 | 478 | 55.1 |

`planReuseCount` is non-zero at every station. `totalBuildMs` here is **not** a
display-locked number; the recorded cold-build latency is 478 rAF ≈ 8.0 s at
60 Hz, and the chunk size is deliberately not raised (ADR 0043).

Reservation: ten-query storm, cache 103 → 105 entries, 62,598,581 →
63,272,260 B, `search` 0 → 2, buildings 56 → 56, `classEvictionCounts` empty
throughout. The floors were not exercised live; the mechanism is unit-proven.

Containment: union of 883 cells' `buildingIds` = 45,194; dense building parents
= 45,194; missing = 0.

## Tests

New, and failing before the change:

- `src/runtime/citywide-release-runtime.test.ts`
  "returns reference-identical features across a settled move that does not
  change the shard set" — fails on the pre-change runtime with
  `expected false to be true`.

New (API did not exist before):

- `src/release/citywide-release.test.ts` — 8 cases: the pinned constant, the
  resolved record, class derivation across namespaces, floor-respecting
  eviction, floor yielding, admission never refused by a floor, refused floor
  configurations, historical eviction order with no floors, and the whole dense
  island surviving a storm.
- `src/runtime/citywide-release-runtime.test.ts` — memo invalidation on shard
  re-fetch, and the threaded budget record.
- `src/features/explorer/CesiumViewport.test.ts` — dense selection preserves
  element identity so `shouldReplaceDenseRenderPlan` returns false, which is
  the branch that increments `planReuseCount`.

## The defect found in existing code

`ComposedReleaseAdapter.getMetrics` reported the shared **constant** as
`maxCacheEntries`/`maxCachedBytes` regardless of the cache it was handed. Its
own fixture had been constructing `new CitywideLruCache(24, 48)` — 48 bytes —
while asserting a 48-MiB cap, and the disagreement was unobservable. Reporting
the live cache exposed it; the fixture now declares the cap it asserts.

## Known-failing before this task, still failing

`src/app/App.test.tsx` > "closes details with Escape and returns focus to the
located-pick trigger" fails **only** when the app suite runs alongside
`src/runtime/` and `src/release/` in one vitest invocation, and fails
identically on the unmodified tree (verified by stashing the source changes and
re-running). It passes when `src/app/` runs on its own. Not caused by, and not
fixed by, this task.
