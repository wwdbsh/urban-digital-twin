# Decision 0042: three-layer exterior cache governance

Date: 2026-08-14

Amended by ADR 0052 §1 (the 29% re-entry figure is retracted). The cap decision
below stands on its residency floor; the cited comparison does not.

Status: **accepted, behind the same opt-in flag as ADR 0041**. The release seam
and the single-decision pool ship in this build and are off. A session without
`?exteriorScheduler=on` loads exactly what it loaded before, evicts nothing, and
releases nothing — and the identity is pinned by tests rather than asserted here.

No release was assembled, no artifact was published, no wave was materialized,
and **no runtime budget constant was changed**. `EXTERIOR_RUNTIME_BUDGETS` is
byte-identical to what T018 left: 512 entries, 256 MiB, 4 concurrent requests.

## The problem ADR 0041 left open, stated exactly

T002 shipped a scheduler that decides which cells are resident and stops asking
for the rest. What it could not do is **give any of it back**. A cell the
scheduler evicted left its verified GLB bytes sitting in the shared exterior LRU,
and the eviction decision was invisible to the cache. The measured consequence:
scheduler-driven residency reduced *demand* at a pose and reduced nothing at all
over a session, because a session accumulates.

ADR 0041 also disclosed that the cap was applied **per wave**, so six promoted
waves gave every wave its own copy of the cap and a session was bounded by
6 x 96 = 576 of 883 rather than by 96 — while the wave the camera was looking at
truncated 53 cells that were inside the footprint and four other waves held
budget they could not spend.

## The governance model: THREE LAYERS, and only one of them is doing work today

1. **The scheduler governs RESIDENCY.** One `selectResidentUnits` decision per
   camera sample decides which cells a session holds. This is the layer that
   actually bounds the session, and after this task it is the only one that ever
   fires in practice.
2. **Bytes are the CONTRACT CEILING.** `maxCachedBytes` (256 MiB) is the promise
   the release contract makes about how much verified compressed GLB the loader
   may retain. It is a ceiling, not a policy.
3. **Entries are the BACKSTOP.** `maxCacheEntries` (512) catches a composition
   whose artifacts are individually small enough that bytes would not catch it.

**With measured evidence, NEITHER ceiling binds today, and saying otherwise
would be the thing this record exists to prevent.** ADR 0041 measured the whole
promoted composition resident at once — all 883 declared cells, every wave, no
scheduler — at **484 entries and 122,601,292 B**. That is 28 entries and
145,834,164 B of headroom. There is no camera in Manhattan at which the shipped
caps evict. The scheduler is therefore not "helping" the ceilings; it is the only
thing governing residency at all, and layers 2 and 3 are contracts waiting for a
composition that does not exist yet.

Two consequences follow and both are taken:

- **The eviction-correctness proofs run under an INJECTED LOWERED byte cap**,
  per cache instance, in `exterior-cache-eviction-correctness.test.ts`. A proof
  against the shipped caps would prove nothing because the caps would never fire.
- **No constant moves.** The mechanics are proved at a cap that binds; the
  constants stay where the measured evidence put them.

## The release seam

### Four things hold a verified exterior GLB; this seam handles three

| # | holder | freed by |
| --- | --- | --- |
| 1 | the shared `CitywideLruCache` entry, keyed `${artifactRef}#${sha256}` | this seam |
| 2 | the OUTCOME — `ExteriorCellRenderPlan.assets[].bytes` is the same `Uint8Array` | this seam (the reconciliation drops it) |
| 3 | the **Blob URL** — `exteriorModelObjectUrl` (`CesiumViewport.tsx:483`) builds a `Blob`, an INDEPENDENT copy of the bytes, alive until `URL.revokeObjectURL` | the viewport, reported to this seam |
| 4 | Cesium's decoded GPU buffers | **nothing here.** Out of scope by contract: ADR 0040 D7 records that decoded GPU bytes are not observable from outside Cesium |

Holder 3 is the one that makes naive cache eviction a lie. Deleting a cache entry
while a Blob URL for the same bytes is alive frees the cache's reference and
nothing else, while producing a smaller `cache.bytes()` reading that looks like a
win. That is why the seam waits for the revoke instead of assuming it.

### The four gates

A cache key is releasable only when all four hold:

- **(a) the scheduler evicted its cell.** The only door into the release queue is
  a `dropped` cell from `reconcileExteriorCellLoads`, plus the second door below.
- **(b) no in-flight load references it.** `reconcileExteriorCellLoads` leaves
  `inFlight` deliberately uncleared on a drop, because the load is still on the
  wire; a release racing a settling load must not delete bytes a `Promise.all` is
  about to verify.
- **(c) its outcome is unpublished.** No live wave outcome anywhere still names
  the key. This is the refcount — **recomputed each pass from the outcomes rather
  than maintained beside them**, over a set of a few hundred assets. A maintained
  counter can drift from the thing it counts, and drift between a counter and the
  outcomes it counts is exactly the class of defect the T002 review found in the
  outcome ordering.
- **(d) its Blob URL is revoked.** `CesiumViewport` gained one callback,
  `onExteriorCellsRetired`, fired **after** `URL.revokeObjectURL` for exactly the
  cells the pass removed. Reported after the revoke, never before: a
  notification sent ahead of the revoke would be a promise rather than evidence.
  The four mutations a retirement performs are emitted as an ordered step list
  by the exported `exteriorRetirementSteps`, which the effect executes verbatim,
  so the revoke-before-report ordering is asserted against the viewport itself
  rather than against a test's restatement of it.

Gate (b) is **cell-scoped** while the thing released is **artifact-scoped**: a
key is held when the cell that queued it is in flight, not when some other
in-flight cell wants the same artifact. Owner-cell enforcement makes that
sharing effectively impossible today, and the worst case if it ever arose is a
redundant refetch — never a wrong render, since the refetch re-verifies against
the same pin.

**A candidate is checked for RE-ADMISSION first**, ahead of gate (c), so a cell
the camera came back to leaves the queue rather than being held forever by its
own republished outcome. Its scene-retired marker leaves with it, so the next
eviction of the same cell waits for its own revoke.

**That gate reads the APPLIED per-wave `requested` sets, not the decision** —
and naming which state it reads is the whole of the correction below.

### WHERE the release pass runs, and why it is a decision

The pass used to run **inside** the per-wave loop. That was wrong. Gate 1 unions
the `requested` sets the waves have already applied, so a pass firing during
wave `w00`'s iteration cannot see that the same global decision re-admits a cell
belonging to `w05`. The candidate was released microseconds before its own wave
asked for the key back: a redundant refetch, `releasedArtifactBytes` counting
bytes that came straight back, and the "re-admission first" property above true
only *within one wave*.

**Fixed by hoisting to ONE pass after the loop**, rather than by feeding the
just-computed decision into the plan input. Both were available; hoisting was
chosen because the invariant it establishes — *the release pass never observes a
partially applied decision* — also covers the other two call sites for free. The
settled-batch `.then` and the viewport's retirement callback are separate tasks
that JavaScript cannot interleave with a synchronous loop, so they already read
a complete state. Feeding the decision in would instead have required a second
rule about how long that decision stays authoritative, since those two callbacks
fire later and could be handed a stale one.

`exterior-global-residency.test.ts` gates the structural property directly —
**zero release passes under a partially applied decision** for the shipped
placement, 238 for the mid-loop one. Its honest limit is recorded in the
test: on the committed roam trace the mid-loop placement produces no observed
*symptom*, because the retirement pass at the end of each decision drains the
queue before the next loop begins. The hazard is structural and the symptom is
trace-dependent, so the gate is on the structure; the seam-level demonstration
that a partially applied `requestedCellIds` really does release a candidate the
complete one keeps is in `exterior-cache-release.test.ts`.

**One residual race is counted, not fixed.** A batch that settles *between* two
decisions is discarded against the current decision, which genuinely does not
want the cell, and the next decision may re-admit it. No placement can consult a
decision that has not been taken. Over the 58-sample roam this costs **2
refetches** — under 1% of the session's releases, about 44 ms of localhost
transport at the measured p50 — and is pinned by a test.

### The second door: discarded outcomes

A cell dropped while its load is in flight has no outcome yet, so at drop time it
holds nothing to release. Its bytes are queued when the load settles and
`acceptExteriorCellOutcomes` **discards** it. Those bytes were verified, cached,
and found to belong to a cell the scheduler had already evicted — they were never
published, so they never became a Blob, and `reachedScene: false` is a fact about
that path rather than an optimistic reading of it. It is the only way a discarded
outcome can exist.

### One known residue, stated as what it actually is

On the drop path the app queues candidates with `reachedScene: true`. **That is
ASSERTED, not observed.** The app knows the outcome was published; it has no
signal telling it the viewport actually built a Blob, and it does not track
scene membership. The assertion is the conservative direction — wait for a
revoke rather than free bytes a live Blob might hold — and its cost is precise:

> **Any dropped outcome that never reached the scene waits on gate (d) for a
> retirement that will never arrive, and its bytes stay cached until recency
> evicts them.**

The known way that happens is a cell accepted into `outcomes` whose wave then
fails its promoted-membership gate inside the same `publish()` call: it is never
drawn, so the viewport never owns it and never retires it. That instance is
bounded — one wave, once, on a wave that has already failed closed — but the
statement above is the general one and is the one to carry forward. It fails in
the safe direction (bytes retained, never freed while live).

Closing it does not need new plumbing, only use of plumbing that now exists:
`onExteriorCellsRetired` tells the app which cells left the scene, and a
symmetrical signal for which cells *entered* it would let `reachedScene` be
observed instead of asserted. `exterior-global-residency.test.ts` already models
exactly that with its `sceneCells` set. Not done here; named for whoever needs
the last of these bytes.

### The seam is tied to the T002 flag

Nothing enqueues without `?exteriorScheduler=on`: the app gates the enqueue on
the flag explicitly, and an unflagged session's reconciliation drops no cell in
the first place. **Removing the flag removes the seam.** The rollback list below
is updated accordingly — an unflagged session must not acquire eviction
behaviour by accident.

## The single-decision pool, and the cap arithmetic

`scheduleExteriorCellsGlobally` replaces six per-wave decisions with **one**.

**The unit list is the STATIC 883-row census table, always** — never "the cells
of the waves loaded so far". A pool built from loaded waves would hand the first
wave to arrive the entire cap, so a wave's residency would depend on the order
the waves' indexes happened to come back, and the decision would stop being
reproducible from a camera trace. Reproducibility from a camera trace is the one
property the scheduler contract exists to have. Loaded runtimes **intersect** the
standing decision; they do not shrink it. A test pins that a wave gets the same
cells whether it loaded alone or beside the other five.

**The cap is 128**, in `EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY`, and
`EXTERIOR_CELL_SCHEDULER_POLICY` is left at 96 unchanged because the T002 thrash
baseline was measured at it. The arithmetic, from ADR 0041's committed opt-in
evidence at the 2,400 m overview camera:

| term | value | source |
| --- | --- | --- |
| six-pool residency at the measured overview camera | **110 cells** | measured |
| entries per resident cell | 210 / 110 = **1.909** | measured |
| bytes per resident cell | 37,164,596 / 110 = **337,859.96 B** | measured |
| cap floor | 110 | one pool must not hold fewer than six pools did |
| **chosen cap** | **128** | next power of two above the floor — a stated rounding convention, not a measurement |
| entries at the cap | 128 x 1.909 = **244** of 512 (47.7%) | derived |
| bytes at the cap | 128 x the unrounded ratio = **43,246,075 B** of 256 MiB (16.1%) | derived |
| entry ceiling would bind at | **268 cells** | derived |
| byte ceiling would bind at | **794 cells** | derived, above the 883 the ledger declares |
| session bound before | 6 x 96 = **576** | ADR 0041 |
| session bound after | **128** | 4.5x tighter, 6.9x below 883 |

**Residency at the measured overview camera RISES, from 110 to at most 128, and
that is the intended direction.** The per-wave cap was deferring 53 cells inside
the footprint while four waves held unspendable budget; one pool spends that
budget where the camera is looking. What FALLS is the session bound.

## The measurements, each labelled with what it is

### Steady-state residency over a MULTI-CAMERA trace

T002's two paths are each ONE monotone motion from a cold start, so their peak
residency is a **cold-window reading, not a bound**. T003 captured a third path
with the same tool and the same CDP pattern:
`data/exterior-cache-governance-20260814/roam-trace.json`,
**`midtown-roam-v1`** — six legs on two axes, 58 settled camera samples, 220 m to
2,106 m, 5.5 km east-west and 3.8 km north-south, 56 of 58 footprints real
ground-ray samples. Camera geometry only, exterior streaming off, exactly as
T002; the residency is produced by replaying it offline through the pure
scheduler, which is what makes the certification deterministic.

Replayed at the shipped cap of 128, one pool of 883 units:

| path | decisions | re-entry @3 | re-entry @8 | peak resident | total evictions | peak evictions in one decision |
| --- | --- | --- | --- | --- | --- | --- |
| `midtown-street-pan-v1` | 13 | **0** | 0 | 91 | 92 | 47 |
| `midtown-zoom-out-v1` | 17 | **15** | 25 | 128 | 62 | 19 |
| `midtown-roam-v1` | 58 | **32** | 75 | **128** | 362 | **43** |

**Certified session peak residency: 128 cells**, the cap, binding. Priced at the
measured per-cell ratio that is **244 entries and 43,246,075 B** — 47.7% and
16.1% of the two ceilings. Neither binds. The pricing is DERIVED from a measured
ratio and is not itself a byte measurement of a session nobody ran.

### The shipped configuration, measured in a real browser

`data/exterior-cache-governance-20260814/governance-evidence.json`, the same two
cameras and the same 75 s settle window as ADR 0041's record, which is left
untouched beside it. Runtime counters, no external host contacted in either
session:

| camera | | T002: six pools, cap 96 | T003: one pool, cap 128 |
| --- | --- | --- | --- |
| **street, 260 m** | cells scheduled / deferred | 12 / 871 | **12 / 871** |
| | artifacts / entries / bytes | 14 / 14 / 1,910,784 | **14 / 14 / 1,910,784** |
| **overview, 2,400 m** | cells scheduled / deferred | 110 / 773 | **121 / 762** |
| | midtown wave scheduled / deferred | 96 / 53 (**cap-truncated**) | **107 / 42** (not truncated) |
| | artifacts / entries / bytes | 210 / 210 / 37,164,596 | 210 / 210 / 37,164,596 |

Two things to read carefully rather than quickly:

- **At street level the two configurations are identical**, because the camera
  sees so little that no cap binds either way. The single pool is not a win at
  every camera; it is a win where the per-wave cap was truncating.
- **At overview the midtown wave stops being truncated** — 96 was the cap, 107 is
  what it actually wanted — and the session holds 121, which is BELOW the global
  cap of 128. So at the measured overview camera the global cap does not bind at
  all; what changed is that the *per-wave* cap stopped binding.
- **Artifact count and bytes did not move** with the 11 extra cells. The likely
  reason, stated as an inference and not a measurement: the promoted midtown
  subset ships geometry for only three of its 149 cells, so most midtown cells
  resolve `not-shipped` and cost no artifact. That is consistent with the release
  but was not separately verified here.

**`releasedArtifactCount` is 0 in both sessions, and that is correct rather than
broken.** The capture holds one pose; the scheduler never evicts a cell whose
outcome had settled, so the seam has nothing to release.

### The seam freeing bytes, observed in a browser

`data/exterior-cache-governance-20260814/roam-evidence.json`: exterior streaming
ON, scheduler ON, the roam legs driven by real drags, the runtime's own counters
sampled after each leg with a 20 s settle so a reading is never taken mid-flight.

| after leg | scheduled | artifacts requested (cumulative) | cache entries | cache bytes | released artifacts / bytes |
| --- | --- | --- | --- | --- | --- |
| settled at street | 12 | 14 | 14 | 1,910,784 | 0 / 0 |
| zoom out through the band | 12 | 43 | 43 | 11,144,780 | 0 / 0 |
| pan east at altitude | 16 | 79 | **0** | **0** | **79 / 22,258,480** |
| zoom back in | 11 | 93 | 14 | 1,910,784 | 79 / 22,258,480 |
| pan north at street | 11 | 93 | 14 | 1,910,784 | 79 / 22,258,480 |

**This is the whole task in one row.** Residency climbed to 43 entries and 11.1 MB
as the camera rose, and then a lateral move at altitude released **79 artifacts
and 22,258,480 B** — bytes that, before this change, would have stayed in the
cache for the life of the session because the scheduler's eviction decisions were
invisible to it. The subsequent descent re-fetched (79 -> 93 requested) and
settled at exactly Block 835's 14 assets, which is the cell the camera came home
to.

Two readings to keep honest. **Zero entries with 16 cells scheduled is not a
contradiction**: the promoted midtown subset ships geometry for three of its 149
cells, so a resident set at altitude over midtown can be almost entirely
`not-shipped` cells that hold no bytes at all. And **the re-fetch is the cost
side of the ledger** — 14 artifacts re-requested on the way back down is exactly
the re-entry the thrash gate counts, priced by the latency table below.

The same behaviour is proved deterministically by
`exterior-cache-eviction-correctness.test.ts` against the real runtime under an
injected cap, and by the 58-sample replay in
`exterior-global-residency.test.ts`, which asserts at every decision that no
artifact named by a published outcome has been released.

### The honest mixed result on the cap change

Raising the cap from 96 to 128 does not improve every figure:

| path | re-entry @3 (96 -> 128) | re-entry @8 (96 -> 128) |
| --- | --- | --- |
| pan | 0 -> 0 | 0 -> 0 |
| zoom-out | **13 -> 15 (worse)** | **30 -> 25 (better)** |
| roam | **45 -> 32 (better)** | 76 -> 75 |

A larger cap admits more cells into the band-edge churn zone, so more of them
come back quickly; fewer of them come back at all. On the roaming path — the only
one of the three that is a session — the horizon count falls 29%, and that is the
result the cap was chosen against. Both are recorded; neither is averaged into
the other, and the frozen cap-96 baseline stays green in its own file.

### Per-request latency: a LOCALHOST AND DISK price

`data/exterior-cache-governance-20260814/request-latency.json`. Wall time from
`Network.requestWillBeSent` to `Network.loadingFinished` for exterior `.glb`
responses served by a local `vite preview` from local disk, plus the app-side
SHA-256 cost the network timing excludes, measured in the same browser over the
median artifact size. Captured on the T003 bundle at the Block 835 street pose
with the scheduler on, over 20 exterior artifact requests:

| quantity | value |
| --- | --- |
| transport, min / p50 / p95 / max | **2.41 / 21.96 / 55.96 / 55.96 ms** |
| encoded bytes, min / median / max | 2,733 / 28,335 / 1,306,059 B |
| SHA-256 of the median artifact (20 runs, same browser) | **0.02 ms** |

The hash is **three orders of magnitude cheaper than the fetch** even on
localhost, so the cost of a re-entry is a transport-and-disk cost and the
verification the release seam forces on every refetch is not what makes eviction
expensive. That is the one design-relevant conclusion in the table.

**This is not a deployment latency and must never be quoted as one.** There is no
CDN, no TLS handshake, no contended link and no cold cache tier in it, and a
deployed figure would be dominated by terms that are absent here. What it does
price is the thing eviction actually costs *this* build on *this* machine: the
refetch a re-entry pays for.

### Predecessor-fallback double cost: FAULT-INJECTED

Measured in `exterior-cache-eviction-correctness.test.ts` by deliberately
corrupting a head package so the single-hop fallback runs. Result: **two requests
and two SHA-256 digests for one rendered cell, and ONE cache entry** — the pool
never admits an artifact that failed verification, so the double cost is paid in
requests and hashing, not in residency. No promoted wave is known to take this
path; what is measured is the cost of the path when it is taken, which ADR 0041
handed here as an unmeasured item.

## The incremental byte counter, and a desync warning

`CitywideLruCache.bytes()` was a full reduce over every entry, and `evict()`
called it **inside its own `while` condition** — so one saturating `set()` that
had to drop k entries walked the whole map k times. That was tolerable while
eviction was a rare backstop nobody expected to fire. **Eviction is now routine**:
the roam replay evicts on most decisions, 362 times over 58 decisions, with a
peak of 43 in a single decision. The counter is therefore maintained incrementally
by the three mutators, and a test re-derives it by full reduce after a mixed
workload (overwrite, delete, absent delete, entry eviction, byte eviction) rather
than trusting that the mutators agree.

**A warning for whoever adds the per-class ceiling ADR 0040 proposed.** `set()`
THROWS for an entry larger than `maxBytes`, and callers PRECHECK the same
condition before fetching — `ExteriorCellRuntime.loadVerifiedArtifact` reads
`cache.maxBytes` and fails closed with `artifact-exceeds-cache-budget`. The two
agree today only because both read the same `maxBytes`. A per-class reservation
that gave one class a smaller effective ceiling would desync them: the precheck
would pass against the pool ceiling and `set()` would throw against the class
ceiling, from inside a settled request promise, surfacing as an unrelated failure
code. **Any per-class ceiling must be readable by the precheck, not merely
enforced at `set()`.**

## FINDING, recorded and NOT fixed: band-internal ranking prefers wave order over visibility

The frozen policy ranks by tier, then distance BAND, then the census `order`.
`order` is the ledger's wave-and-position index — Block 835 is 0, midtown runs
from 1, northern runs to 882. So **within one band, up to 1,200 m wide, a cell
the camera is nearly standing next to can be deferred in favour of a cell 1,100 m
away that belongs to an earlier wave.** A demonstration test finds a real such
inversion in the committed census at a real camera and is marked as documenting
current behaviour, so a silent change to the ordering fails.

This is not fixed here. Changing the rank order changes both frozen thrash
baselines and every residency figure this task measured, and T003's contract is
cache governance, not ranking policy. **The candidate fix is to rank by
`unitDistanceMeters` before `order` inside a band, and it belongs to T005**, the
first task with a rendered A/B in scope and therefore the first that can see what
the change does to what is drawn.

## What eviction looks like to a user, and the notice question

When a resident cell is evicted, its entities are removed, its `exteriorPickMap`
entries are deleted, its object URLs are revoked, and the **dense base massing
returns** — `exteriorRenderedCanonicalFeatureIds` drives the base pass's
coverage, so a canonical feature that stops being exterior-rendered stops being
suppressed. The user sees the flat extruded footprint again, not an empty lot.

**Selection and the deep link survive.** `selectFeature` stores a VALUE COPY
(`setSelectedFeature(toCityFeature(feature))`, `App.tsx:2398`), not a reference
into the overlay, so the details panel keeps its sourced record and the URL keeps
its `featureId` while the geometry is gone. Re-admission restores the entity, the
pick-map entry and the selection silhouette. All four are pinned by tests.

**This makes ADR 0041's deferred-cell notice question live for a SECOND reason**
and it is still not answered. A deferred cell was already indistinguishable from
a cell that ships no geometry; now an *evicted* cell is too, and an evicted cell
is one the session previously showed. Nothing is built for it here, deliberately:
the flag is opt-in and off, so no default session can encounter it. **Deciding the
wording and the threshold remains with T006**, which would ship it as a default,
and it must not become a default without an answer.

One further item shares that boundary (review finding, recorded here): the
release-pass **placement in `App.tsx` is proven to matter (238 vs 0 partially
applied passes in the replay) but is not itself pinned by a test** — moving the
call back inside the wave loop leaves every suite green, because pinning the real
effect's call order needs a React harness for the cell-loading effect that no
test in this area has had since T002. The same missing harness blocks the
`reachedScene` observation signal proposed above. **Building that harness (or an
equivalent structural pin) belongs to T005/T006**, before the flag becomes a
default.

## Deferred to T004, by number

- **The citywide four-class reservation** (ADR 0040's building / restaurant /
  search / detail arithmetic; 45,903,404 B and 56 entries). **NOTHING citywide
  ships this cycle**, not even the primitive. The reservation needs the
  `maxLoadedShards` raise that belongs to T004's contract, and shipping half of
  it would leave a mechanism nothing could use.
- **Two corrections to ADR 0040's F6/F7 framing, recorded here so T004 starts
  from them rather than rediscovering them:**
  - **F6.** A reservation buys **refetch and re-parse avoidance**, not Cesium
    **Primitive-rebuild** avoidance. A shard whose bytes are retained still has
    its Primitive rebuilt when it re-enters the render set; the cache reservation
    cannot reach that, and the ADR 0040 framing implied it could.
  - **F7.** "Four-class" **understates** the pool. `aggregateCacheRef` is one
    `CitywideLruCache` serving the citywide shard classes AND the composed
    civic-context namespaces through `ComposedReleaseAdapter`, so a reservation
    sized for four classes would be sized for a fraction of its own tenants.
- **The `refreshViewport` refactor onto the generic scheduler.**
  `selectResidentUnits` was designed to serve shards and
  `scheduleExteriorCellsGlobally` is the pattern to copy, but the refactor is a
  change to a different runtime and is not done here.

## Rollback

Removing `?exteriorScheduler=on` removes the seam as well as the scheduler. In
addition to ADR 0041's rollback list, delete:

- `src/runtime/exterior-cache-release.ts` and its suite;
- `runExteriorCacheRelease`, `handleExteriorCellsRetired` and
  `exteriorCacheReleaseRef` from `App.tsx`, the `schedulerEnabled` enqueue blocks
  in the cell-loading effect, and the `outcomesBeforeDrop` snapshot;
- `onExteriorCellsRetired` from `CesiumViewportProps`, its ref, and the
  `report-retired` step of `exteriorRetirementSteps` (the applier itself may
  stay: it is a faithful extraction of loops the effect already ran);
- `releasedArtifactCount` / `releasedArtifactBytes` and `noteArtifactRelease` on
  `ExteriorRuntimeMetrics` (additive; read only by the probe);
- `EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY`, `scheduleExteriorCellsGlobally` and
  `EXTERIOR_CELL_STATIC_UNITS`, restoring the per-wave
  `scheduleExteriorCells` call and the per-release carry map at the call site.

**Two things deliberately survive a rollback.** `exteriorArtifactCacheKey` and
`exteriorOutcomeCacheKeys` are the loader's own key derivation and belong there
whether or not anything releases; and `CitywideLruCache`'s incremental byte
counter is a strict improvement to a shared class with an invariant test, unrelated
to the flag.

This decision is reversed by a measured result — a residency, request-count,
re-entry or byte figure the policy cannot meet — not by preference.
