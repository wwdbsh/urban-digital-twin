# Decision 0043: citywide overview streaming over the committed dense shards

Date: 2026-08-14

Status: **accepted, behind the same opt-in flag as ADR 0041 and ADR 0042**
(`?exteriorScheduler=on`). A session without the flag resolves the unchanged
`CITYWIDE_BUDGETS`, gets a shared cache with no class floors, and selects,
caches and evicts exactly what it selected, cached and evicted before. The
constant is now pinned byte-for-byte by a test, which is the only reason that
sentence is checkable.

No release was assembled, no artifact was published, no wave was materialized,
and **no frozen byte changed**. `CITYWIDE_BUDGETS` is byte-identical to what
T003 left: 24 entries, 48 MiB, 6,000 dense features, 8,192 decoded summaries
and features, 512 decoded details.

## The problem, stated as the measurement that found it

`refreshViewport` reconstructed **every visible parent** on **every settled
camera move**, whether or not the shard set behind them had changed: a fresh
`Feature` object plus `validateFeature` for each. The objects were therefore
never reference-equal, `preserveFeatureSequence` produced a new array, and
`shouldReplaceDenseRenderPlan` — which compares by reference sequence — rebuilt
the whole Cesium instance set. At island overview that is 45,194 decodes and
45,194 instances per move, for bytes that had not moved.

Measured in the shipping renderer, on the recorded pan path (headless Chrome
151, 1440x900, dev server with `VITE_CITYWIDE_OVERVIEW_PROBE=1`, artifact
`data/citywide-overview-streaming-20260814/overview-probe.json`):

| move | shard set | `refreshViewport` | sequence |
| --- | --- | --- | --- |
| 0 | cold, 0 resident | 40.4 ms | rebuilt |
| 1 | 14 entries | 461.4 ms | retained (trivially — 0 features) |
| 2 | 101 entries, 54,066 features | 1,241.2 ms | rebuilt |
| 3 | 105 entries, 57,313 features | 352.1 ms | rebuilt |
| 4 | unchanged | **2.1 ms** | **retained** |
| 5 | unchanged | **2.0 ms** | **retained** |

Move 1's retention is trivial — the sequence was still empty — so moves 4 and
5 are the only non-vacuous retentions in the table. They are the fix: a settled
camera move over an unchanged shard set
costs ~2 ms and hands the renderer the same array, so `planReuseCount`
increments instead of a rebuild. `planReuseCount` was 6–11 at every station of
the pan path and never zero.

## The memoization, and why shard identity is the right key

Two levels, both keyed on object identity rather than on a hash:

1. **Per shard.** `WeakMap<LoadedShard, readonly Feature[]>`.
   `CitywideRequestPool.loadShared` resolves `cache.get(key)`, so the cache
   hands back the *same* `LoadedShard` object for as long as the entry is
   resident. A re-fetch after eviction produces a new object and correctly
   misses. `WeakMap` means an evicted shard's decoded features become
   collectable with it **as long as nothing else holds the shard**. That
   qualifier is real: `committedVisibleShards` holds strong references to the
   shard objects of the last committed visible set, so up to
   `maxLoadedShards` parsed payloads and their decoded features stay reachable
   after the LRU has evicted them, until the next commit replaces the list.
   The retention is bounded by the same cap the cache is bounded by, and it is
   a second bound, not none.
2. **Per plan.** The list of visible `LoadedShard` objects that produced the
   current `visibleFeatures`. Equal **as a set** means skip the merge, the id
   sort and the decoded-feature LRU writes entirely. Order-insensitive on
   purpose: the visible list is distance-ranked, so a camera nudge can permute
   an unchanged set, and an order-sensitive comparison paid the full ~352 ms
   class rebuild for a set that had not changed. Sound because the merge is
   keyed by parent id and the release carries exactly one geometry part per
   building parent (45,194 parts for 45,194 parents), so no permutation can
   change which record wins.

`getFeatures` is memoized on `visibleFeatures` identity plus the visibility
key, so two consecutive calls return the *same* array. The historical re-sort
there was redundant — `visibleFeatures` is assigned sorted and `filter`
preserves order — and it was re-paying an O(n log n) `localeCompare` pass per
call over 45,194 ids.

The memo is keyed per visibility, not a single slot: `loadLayerFeatures` asks
for one layer at a time between viewport refreshes, and a one-slot memo was
measured being evicted by exactly those calls, handing the render path a fresh
array for an unchanged sequence (one of the six moves above regressed to
`rebuilt` before this was fixed).

`ComposedReleaseAdapter.getBaseFeatures` and `getContextFeatures` sorted the
adapter's returned array **in place**. That was invisible while every adapter
returned a fresh copy; it is a real aliasing hazard now, and both copy first.

## The budget record, not a constant mutation

`CITYWIDE_BUDGETS` is read by `build-manhattan-citywide.mjs`, by
`validate-manhattan-citywide-release.mjs`, by the civic and composed runtimes,
and is the default `CitywideLruCache` argument. Raising a field on it raises it
for sessions that never asked for citywide overview residency. So T004 resolves
a **record** per session, selected by the one existing flag, and threads it
through `CitywideRuntimeOptions.budgets`. Nothing writes the constant.

`CITYWIDE_OVERVIEW_BUDGETS`, every number arithmetic over the committed
`manifest.json`:

- **`maxLoadedShards` 24 → 112.** 56 building geometry shards + 47 restaurant
  geometry shards = 103, the whole committed dense island. At exactly 103 the
  first search or detail shard evicts geometry, so the cap carries the four
  class floors (56 + 47 + 2 + 2 = 107) plus 5 entries of working headroom. A
  cap equal to the sum of the floors would leave the evictor no legal
  candidate; the constructor refuses that configuration rather than silently
  ignoring the floors.
- **`maxLoadedBytes` 48 MiB → 80 MiB (83,886,080 B).** The floor a working
  overview session cannot go below is
  45,903,404 (buildings) + 14,279,876 (restaurants) + 2,633,218 (detail index)
  + 558,788 (largest search shard) + 1,048,527 (largest detail shard)
  = **64,423,813 B**. 80 MiB leaves 19,462,267 B — about 18 further
  search/detail shards — so ordinary querying does not push the byte ceiling
  into the geometry. These are **wire** bytes (cached JSON text).
- **`maxRenderedDenseFeatures` 6,000 → 57,547.** 45,194 building parents +
  12,353 restaurant parents *present in the geometry shards*. Deliberately not
  57,633: the release declares 12,439 restaurant parents, but 86 are
  `location-unavailable` and never appear in a geometry shard, so they can
  never reach the dense path. **One combined limit, not a split
  building/POI pair**: at the full renderable census the limit cannot truncate,
  so a split would add a second selection axis no measurement could
  distinguish from this one.

**`maxDecodedSummaries`, `maxDecodedFeatures` and `maxDecodedDetails` are NOT
raised**, against the census CLI's suggestion. The render source is the
adapter's visible-feature sequence, not those maps; raising them buys no
rendered building and costs the heap expansion recorded below.

## The residency gate: why the flag alone is not the condition

The shared `aggregateCacheRef` has several tenants — the citywide adapter, the
civic-context adapter, and `ComposedReleaseAdapter` over both — and the
citywide adapter is itself the composed session's **base**. Applying the
overview record on the flag alone therefore reconfigured sessions that never
asked for it, in three measurable ways:

1. **Cache floors starved the tenant on screen.** Civic refs derive to class
   `other`, which has no floor, so a civic session with the flag on pinned 103
   citywide shards nobody was looking at and evicted the most recently used
   civic shards. Reproduced by review and now pinned by a test.
2. **The composed base dense cap** rose 6,000 to 57,547 in a civic mode that
   has never been measured at the overview census.
3. **The base shard-selection bound** rose 24 to 112 for composed refreshes,
   because the adapter's record was fixed at construction.

**Mode gating was chosen over namespace-qualified floors.** Qualifying the
floors by namespace fixes none of the three: a `citywide:`-qualified floor
still pins 103 entries while civic is on screen, and (2) and (3) are not cache
concerns at all. The condition is not "whose refs are these" but "which mode is
this session actually in", so that is what is gated and what is tested.

`resolveCitywideOverviewResidency(schedulerRequested, citywideMode)` is the one
place the condition lives, and it feeds all three sites. Two mechanisms make it
live rather than mount-time:

- `CitywideRuntimeOptions.budgets` accepts a **supplier**, so the adapter reads
  the record the active mode is entitled to per access rather than the one the
  session happened to boot in.
- `CitywideLruCache.configure` re-points the shared cache between the two
  **recorded** configurations as the mode changes. Only those two are ever
  applied, and both byte caps exceed every declared shard size (2 MiB geometry,
  1 MiB search/detail), so no re-configuration can make an already-legal
  artifact inadmissible — the admission invariant below is preserved across
  reconfiguration, not merely at construction.

## Per-class cache floors: a permission to keep, not a reservation

Class is derived from the ref prefix (`geometry/buildings/`,
`geometry/restaurants/`, `search/`, `details/`, else `other`) after stripping
the namespace, so it works for `citywide:` and `civic:` alike — ADR 0042's F7
correction is why the derivation is namespace-blind rather than four-class.

`CITYWIDE_OVERVIEW_CACHE_FLOORS` = buildings 56, restaurants 47, search 2,
details 2.

Three properties, each of which is a test:

- **Floors never touch admission.** There is no citywide precheck anywhere on
  the load path: `set` runs inside the pooled loader promise, *after* the
  fetch, the checksum and the JSON parse. A class ceiling enforced at `set`
  would throw from inside a settled request promise and surface as an unrelated
  failure code — precisely the desync the existing
  "throws rather than silently refusing an entry larger than its byte cap" test
  warns about. Floors are consulted **only** when `evict` chooses a victim.
- **Floors yield rather than deadlock.** `evict` restricts candidates to
  classes that are over their own floor; when no class is over its floor the
  restriction lifts, because eviction must make progress or the cap bounds
  nothing.
- **Floors cost less than the code they replace.** Victim selection is one
  linear minimum scan, replacing a full `[...entries].sort()` per drop. With no
  floors configured the scan selects exactly what the sort's first element
  selected — lowest `used`, ties by key — so every unflagged session is
  unchanged (pinned by test).

Buildings shrink naturally: nothing is held back for a class that is not using
it, and the shard classes have no third holder, so no refcount is needed.

## Measurements, each labelled with what it is

**Offline set containment** (`dense-coverage-containment.json`, deterministic,
no browser). The union of all 883 committed ledger cells' `buildingIds` is
45,194 ids; the dense building shards carry 45,194 parent ids; **missing = 0**.
One containment over 45,194 ids, not 883 assertions. Dense coverage is a
**superset** of what the exterior facade path renders: the 899 grammar refusals
apply to facade generation and remove nothing from the dense extrusion set
(45,194 ≥ 44,295).

**Live render, approved island viewpoint** (lon −73.9773, lat 40.7825, height
52,000 m, heading 90°, pitch −90°, 1440x900). `DenseRenderMetrics`:
**45,154 building features, 12,119 POI points, 32 primitives**, 102 of 103
geometry shards visible, 57,313 features resident, shared cache 103 entries /
62,598,581 B with **all 56 building shards resident and zero evictions of any
class**.

**45,154, not 45,194.** All 56 building shards are resident, so every committed
building is streamed; 40 buildings (0.09%) fall outside the ground footprint at
this fixed framing and are therefore not drawn in this frame. That is the
viewport-bounds filter doing its job, not a streaming or residency gap. A
single fixed frame containing 100% of the island's buildings was **not**
established this cycle — the viewpoint search plateaued at 45,154 across
45–52 km altitude and degraded above it. **Handed to T005/T006** as a camera
framing question, not a streaming one.

**Reservation evidence.** A ten-query search/detail storm at the overview
viewpoint moved the cache from 103 entries / 62,598,581 B to 105 entries /
63,272,260 B, `search` class 0 → 2, buildings **56 → 56**, and
`classEvictionCounts` stayed **empty**. Stated honestly: the floors were never
exercised in the live session, because the raised caps made the whole working
set fit. The floor *mechanism* is proven by unit test (a saturating storm
against a floored cache evicts only the over-floor class), not by live
eviction. That is the weaker of the two claims and it is the one the live
evidence supports.

**Build cadence — measured, chosen, recorded.** At `DENSE_BUILD_CHUNK_SIZE`
120 the island build takes 478 chunks with `allocationMaxSliceMs` 6.1–7.8 ms
per slice across the re-run stations (8.1–14.5 ms in an earlier run on the same
host). **The chunk size is not raised.** A slice already consumes a
significant part of a 16.7 ms frame and was measured as high as 14.5 ms;
240 instances/rAF would put it over. The recorded cold-build
latency is therefore 478 rAF ≈ **8.0 s on a display-locked 60 Hz session**, and
any camera move during it restarts the build (2 cancellations were observed per
overview station). Measured `totalBuildMs` in the capture environment was
16–70 ms, which is **not** a display-locked number — headless rAF is not vsync
bound — and must not be read as the user-visible latency. Reducing the 8.0 s is
a larger-primitives-or-worker change and is T005/T006 work.

## Decoded arithmetic (labelled, per ADR 0040 D7) — arithmetic, not measurement

At the mean 13.18 outer-ring vertices per building (595,560 vertices over
45,194 buildings, ADR 0040's census), an extruded prism per building is
~2 × 13.18 wall vertices plus caps. Per rendered vertex Cesium carries
POSITION (3 × f32 = 12 B), the per-instance colour attribute (4 B), the batch
id (4 B) and index data (~6 B amortised): ≈ 26 B/vertex. Over ~3.7 M rendered
vertices that is **≈ 97 MB decoded GPU-side**, and the layer swap holds the old
and new layers simultaneously, so the transient is **≈ 190 MB**. JS-heap note:
the wire JSON is 45.9 MB for buildings; a JS object graph expands that 3–5×, so
raising `maxDecoded*` to 45,194 would add roughly 140–230 MB of retained heap
for no rendered building. That is the arithmetic behind not raising them.

## Deferred by number

- **C-1: the `refreshViewport` → `selectResidentUnits` refactor is NOT done
  this cycle.** ADR 0041 handed it to T004 ("`refreshViewport` refactor onto
  the generic scheduler | not done, deliberately | T004") and ADR 0042 repeated
  it. It buys the overview acceptance criteria nothing — the viability fix was
  decode memoization, not selection policy — and it is a change to the runtime
  that also serves the civic and composed sessions. **The ADR 0041 obligation
  moves to T005/T006**, and should be retired outright there unless the
  near-field band needs a mixed unit list.
- **The 40 out-of-frame buildings** and the search for a single frame that
  contains 100% of the island (above).
- **Live floor exercise.** A session that actually forces eviction under the
  raised caps would need a byte cap below the working set; that is a fault
  injection T006's acceptance campaign can carry.

## Drift notes

- `scripts/citywide-overview-census-cli.mjs` **reports**
  `CITYWIDE_BUDGETS.maxLoadedShards` in its candidate arithmetic. It stays
  coherent: it is describing the *default* record, which is unchanged, and its
  "does not fit at all" conclusion about the 24-entry cap remains true of the
  default and is exactly what the overview record answers.
- **No validator reads `maxLoadedShards` or `maxLoadedBytes`.**
  `validate-manhattan-citywide-release.mjs` reads only `totalBytes` and
  `rootBytes`; `build-manhattan-citywide.mjs` reads the shard-size, shard-count
  and total-byte budgets. Nothing in `scripts/` gates on the residency caps, so
  the record cannot drift a validator.
- `ComposedReleaseAdapter.getMetrics` reported `CITYWIDE_BUDGETS.maxLoadedShards`
  and `maxLoadedBytes` as the aggregate caps regardless of the cache it was
  actually given. It now reports the live cache. This exposed a fixture that
  had been declaring a 48-**byte** cache while asserting a 48-MiB cap.

## Rollback

Removing `?exteriorScheduler=on` — **or simply not being in citywide mode** —
selects `CITYWIDE_BUDGETS` and an unfloored cache; nothing else in this
decision is reachable. To remove it from the build,
delete `CITYWIDE_OVERVIEW_BUDGETS`, `CITYWIDE_OVERVIEW_CACHE_FLOORS`,
`resolveCitywideBudgets`, `resolveCitywideOverviewResidency`, the `floors`
constructor argument, `configure` and the class counters on
`CitywideLruCache`, the `budgets` option on the citywide runtime,
`scripts/citywide-overview-streaming-evidence-cli.mjs`, and the
`VITE_CITYWIDE_OVERVIEW_PROBE` block in `App.tsx`. The feature memoization is
**not** flag-gated and is not part of the rollback: it is a correctness-neutral
identity improvement that benefits every citywide session.
