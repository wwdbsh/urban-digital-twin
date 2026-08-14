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
| 0 | 0 entries | 40.4 | rebuilt |
| 1 | 14 entries | 461.4 | retained (trivially, empty sequence) |
| 2 | 101 entries / 54,066 features | 1,241.2 | rebuilt |
| 3 | 105 entries / 57,313 features | 352.1 | rebuilt |
| 4 | unchanged | **2.1** | **retained** |
| 5 | unchanged | **2.0** | **retained** |

Per station (`buildings / POIs / primitives`, `planBuild/Reuse/Cancel/Swap`,
`allocationMaxSliceMs`, chunks):

| station | features | plans | slice | chunks |
| --- | --- | --- | --- | --- |
| island-overview | 45,154 / 12,119 / 32 | 4 / 7 / 2 / 1 | 7.1 | 478 |
| overview-nudge-north | 45,154 / 12,119 / 32 | 4 / 7 / 2 / 1 | 7.4 | 478 |
| overview-nudge-east | 42,029 / 10,747 / 30 | 3 / 6 / 1 / 1 | 6.1 | 440 |
| overview-nudge-back | 45,154 / 12,119 / 32 | 4 / 7 / 2 / 1 | 7.8 | 478 |
| descend-midtown | 17,324 / 2,202 / 13 | 3 / 9 / 1 / 1 | 1.6 | 163 |
| return-overview | 45,154 / 12,119 / 32 | 4 / 6 / 2 / 1 | 6.6 | 478 |
| search-detail-storm | 45,154 / 12,119 / 32 | 4 / 11 / 2 / 1 | 6.4 | 478 |

`planReuseCount` is non-zero at every station. The probe also records
`overviewResidencyActive: true` with caps 112 / 83,886,080 and the four floors,
confirming the gate resolved for citywide mode. `totalBuildMs` is **not** a
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
  re-fetch, the threaded budget record and its supplier form, and
  "treats a reordered but unchanged visible shard set as unchanged", which
  fails on the order-sensitive comparison with `expected false to be true`.
- `src/app/App.test.tsx` — "gates citywide overview residency on citywide
  mode, not on the flag alone", covering the flag-on civic path and asserting
  byte-identical civic budgets and empty floors.
- `src/release/citywide-release.test.ts` — the B1 starvation hazard as an
  executable statement (floored cache evicts the unfloored civic tenant;
  withdrawing the record restores plain recency), reconfiguration admissibility
  and the frozen records.
- `src/features/explorer/CesiumViewport.test.ts` — dense selection preserves
  element identity so `shouldReplaceDenseRenderPlan` returns false, which is
  the branch that increments `planReuseCount`.

## Review round 2 (B1 blocking + six optionals)

- **B1.** `?exteriorScheduler=on` reconfigured civic-context and composed
  sessions: floors starved the on-screen civic tenant (civic refs derive to
  class `other`, floor 0), the composed base dense cap rose 6,000 → 57,547, and
  the composed base shard-selection bound rose 24 → 112. Overview residency is
  now **live-gated on citywide being the active mode** through one exported
  predicate, `resolveCitywideOverviewResidency`, feeding all three sites.
  `CitywideRuntimeOptions.budgets` accepts a supplier so the adapter follows
  the active mode; `CitywideLruCache.configure` re-points the shared cache
  between the two recorded configurations. Mode gating chosen over
  namespace-qualified floors, which fixes none of the three (ADR 0043).
- **O1.** `sameVisibleShards` compares as a set, not in order.
- **O2.** ADR corrected: `committedVisibleShards` strongly retains up to
  `maxLoadedShards` parsed payloads past LRU eviction — a second bound, not
  none.
- **O3.** `CITYWIDE_BUDGETS`, `CITYWIDE_OVERVIEW_BUDGETS` and
  `CITYWIDE_OVERVIEW_CACHE_FLOORS` are `Object.freeze`d.
- **O4.** `RuntimeCityAdapter.getFeatures` narrowed to `readonly Feature[]`.
  Exactly one call site needed adjusting (`visibleFor`), confirming the
  copy-before-sort fix had already closed the only in-place sort.
- **O5.** `citywideSequenceRef` assignment moved inside the probe guard.
- **O6.** Probe move 1 annotated in the ADR as trivial (empty-sequence)
  retention.

Round 3 (approve-with-nits):

- **N1.** The residency ref is published from the reconfiguration effect, not
  during render; the residency value is memoized so its identity changes only
  with the mode.
- **N2.** ADR discloses the one-tick supplier-vs-cache disagreement window on a
  mode transition as self-correcting and invariant-preserving.
- **N3.** `sameVisibleShards` checks both sides for distinctness rather than
  inheriting it from the selection's de-duplication.
- **N4.** `readonly Feature[]` completed through `CitywideReleaseAdapter`'s
  `getFeatures`, `refreshViewport` and `loadLayerFeatures`, the
  `RuntimeCityAdapter` interface, and the composed runtime's `baseFeatures`
  and `loadLayerFeatures`.
- **N5.** Cross-shard parent uniqueness re-verified and recorded for **both**
  layers: buildings 45,194 parts / 45,194 parents, restaurants 12,353 parts /
  12,353 parents, zero parents served by more than one shard in either.

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
