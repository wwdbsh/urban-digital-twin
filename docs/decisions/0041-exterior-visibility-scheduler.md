# Decision 0041: the visibility-driven residency scheduler

Date: 2026-08-14

Status: **accepted, behind an opt-in flag**. The scheduler ships in this build
and is off. A session without `?exteriorScheduler=on` loads exactly what it
loaded before — same cell array, same order, same URL string, same effect
cadence — and the identity is pinned by tests rather than asserted here.

No release was assembled, no artifact was published, no wave was materialized,
and no runtime budget constant was changed by this task.

## Context

The six promoted exterior waves declare **883 cells between them, and the
default requests every one of them on every load**, because `App.tsx` maps
`runtime.cellIds()` straight into `Promise.all`. Where the camera is has never
entered that decision. ADR 0040 measured what the island costs and handed this
task the one thing that made a visibility decision possible: `cell-extents.json`,
a committed per-cell render extent for all 883 cells, with the instruction *cull
on `renderBounds`, never on `assignmentBounds`*.

An adversarial architecture review adjudicated the design before implementation
and froze several corrections. This record is the contract that came out of it.

## The scheduler contract

`src/runtime/exterior-visibility-scheduler.ts` exports one pure function:

```
selectResidentUnits(units, { footprint, camera, heightBucket }, policy)
  -> { resident, load, evict, order, carry, hold, reserved, visibleCount, deferredCount, retainedCount }
```

**Units are generic, not cells.** A unit is `{ unitId, class, bounds, order,
tieBreakKey }`. Cells are the unit class T002 ships; **citywide shards are the
unit class T004 hands the same function** when `refreshViewport` is refactored
onto it. That refactor is NOT done here. The module imports nothing from Cesium
and must never, because the whole value of the contract is that a decision
replays offline from a recorded camera trace.

**Inputs are the existing quantized triple**, not new state: the
`ViewportFootprint` from `viewport-footprint.ts` (six-decimal signature,
`source`/`valid` flags), the `CameraPose`, and
`exteriorCameraHeightBucketMeters`. Nothing new is sampled from the camera.

**The frozen policy order**, applied in this sequence:

1. **Camera-cell reservation.** Every unit whose rectangle contains the camera
   ground point is resident, ahead of everything else and exempt from the cap.
   This is the T009 F2 lesson restated for cells: a distance-ranked cut dropped
   the shard the camera was standing on and a street-level view rendered
   nothing. Overlapping units mean there can be several containing units, and
   **all** of them are reserved.
2. **Footprint intersection** on `renderBounds`.
3. **Distance band**, nearest-point distance from the footprint ground centre in
   the census's own frozen planar metric. Edges at **1,200 m and 2,400 m**, both
   taken from ADR 0040's measured transition figures rather than chosen for
   roundness.
4. **Explicit order**, then `tieBreakKey`, then id. The input array's order is
   never consulted; a shuffled input yields an identical decision, and the
   lexicographic cell-id ordering that used to decide everything becomes
   incidental.
5. **Hysteresis, then a hard cap.** A unit that has left the footprint stays
   resident for `hysteresisDecisions` (3) further decisions at lower priority
   than anything visible. Output length is bounded by construction at
   `max(maxResidentUnits, |reserved|)`.

**There is no behind-camera prefetch in this cycle.** Retaining recently-visible
cells is the whole anti-thrash mechanism. Prefetch is a named follow-up below.

**Untrusted footprints never evict.** Anything whose source is not a live
ground-ray sample — `camera-fallback`, `view-rectangle`, `last-valid` — is not
evidence about what ground the camera can see. With a previous decision the
scheduler HOLDS it verbatim (`hold: "held-previous"`, `load` and `evict` both
empty); with none there is nothing to hold, so the decision is computed and
marked `"bootstrap-untrusted-footprint"`. Both cases are test-pinned, and both
occur in the committed camera traces.

**Two properties of the hold that are stated rather than fixed this cycle.**
First, **there is no bound on consecutive holds**: a session whose ground rays
stop reaching the globe holds its last resident set indefinitely, and nothing
in the scheduler notices that the held set is old. Second, **the camera
reservation does not run during a hold** — the held set is returned verbatim, so
if the camera has meanwhile travelled into a cell the previous decision did not
admit, that cell is not reserved. That is the T009 F2 shape again, one level up:
a street-level view could sit over a cell nothing loaded. Neither is a defect
introduced here — a held decision is by definition the last decision that had
evidence — and both are bounded in practice by the app supplying a ground-ray
footprint on essentially every settled camera move. A bound on hold length, or a
reservation that runs even while holding, is a code change this cycle
deliberately did not make; it is recorded so the next task starts from it rather
than rediscovering it.

**The height bucket does not change WHICH cells are resident.** It rides in the
carry so a bucket flip is visible to the scheduler and changes nothing about
residency — which is precisely what makes the abort-and-reload path (App.tsx,
height-bucket flips abort wave loads) cost only the reload it already cost,
rather than a residency churn on top of it. The bucket decides which LOD each
resident cell loads. Height still reaches the decision, through the footprint:
at a fixed ground centre a higher camera sees more ground, so the resident count
is monotone non-decreasing in height. That is an invariant, and it is tested.

## The delivery-path decision

**Decided: a build-time-generated source module,
`src/runtime/citywide-overview-cell-extents.ts`, emitted from the committed
census by `scripts/emit-citywide-overview-cell-extents.mjs`
(`pnpm citywide-overview:extents`), with the census digest frozen into the module
and re-checked by a test.** The alternative — serving `cell-extents.json` under
`public/` — was rejected on three grounds:

1. **Rights and provenance.** The census is a 691 KiB provenance document
   carrying per-cell membership counts and tallest-member building ids, inside an
   envelope whose 883 cells are all `publicEligible: false` pending per-cell
   rights evidence (ADR 0040 D6). The scheduler needs six numbers per cell.
   Publishing the whole document to buy them is an argument this task would have
   had to win for no scheduling gain.
2. **Local-only.** Exterior release modes must introduce no runtime provider
   requests. A build-time module adds none; a fetched asset is a request.
3. **Provability.** `citywide-overview-cell-extents.test.ts` re-hashes the
   census, compares that digest against both the committed `.sha256` sidecar and
   the digest frozen into the module, and re-derives all 883 rows. A drifted
   census fails the suite instead of silently culling against stale rectangles.
   The generator also has a `--check` mode.

**`assignmentBounds` is not merely discouraged, it is absent.** The generated
module emits `renderBounds` only, and a test asserts the string
`assignmentBounds` does not occur in the generated file. A future caller cannot
reach for the wrong rectangle because there is nothing to reach for. This
matters: 870 of 883 cells extend beyond their assignment rectangle (median
1.257x area, max 2.064x), and the worst case is a 249.29 m overhang.

**One alias, proven rather than assumed.** Block 835 shipped before the wave
ledger existed, so its release names the cell `cell:manhattan:block-835` while
the ledger and census name it
`manhattan-exterior-cell-w00-000000-block-00835`. The generator proves the
mapping from the committed release graph — same `order`, same 14 building ids,
and a census render extent that contains the release's own declared bounds —
and refuses to emit if any of the three fails.

**The cost of this choice, measured rather than waved past.** The generated
module is 175,977 bytes of source, and a default session downloads it whether or
not it ever enables the flag. Measured on `pnpm build` at this commit against
the same build at the branch point: **4,892,346 -> 5,054,172 bytes raw
(+161,826, +3.3%) and 1,295,779 -> 1,333,029 bytes gzipped (+37,250, +2.9%)**
for the main chunk. That is the honest price of a static import; a dynamic
import would move it behind the flag at the cost of making the load path async
in a way the default currently is not, and it is a change T004 can make once it
knows whether shards need the same table. It is recorded here so nobody
rediscovers it as a surprise.

**Cells with no committed extent are always loaded.** The fixture release's
`c1`/`c2` are the live example. A cell whose extent is unknown cannot be proven
invisible, and the fail-closed direction for a visibility scheduler is to keep
geometry, never to withhold it on an assumption.

## The opt-in, and what makes the default identical

`?exteriorScheduler=on`, one accepted value. Three properties carry the identity
claim, each pinned by a test rather than argued:

1. **`scheduleExteriorCells` returns the caller's own array by reference** when
   the flag is off. The test uses `toBe`, not `toEqual`: a filtered copy that
   happens to keep every element would pass a contents comparison and would still
   be a different array, and a later change to the filter could start dropping
   elements while the test kept passing.
2. **The effect's dependency array does not move.** The new dependency,
   `exteriorSchedulerSignature`, is the constant empty string whenever the flag
   is off, so a default session's cell reconciliation runs exactly as often as
   before and a camera move never triggers it.
3. **The URL is character-identical.** The flag is a member of the exterior URL
   state, written back by `appendExteriorProfileUrl`. The review found the defect
   this prevents: every settled camera move rewrites the whole URL through
   `navigationUrlForApp` -> `replaceState`, so a parameter that is only read at
   boot is dropped on the first mouse drag. The round-trip was then confirmed in
   a real browser — after a real CDP mouse drag the flagged session's
   `location.href` still carries `exteriorScheduler=on`, and the default
   session's still carries nothing.

**The scheduler filters LOADS ONLY.** It never touches `runtime.snapshot.cells`,
so `verifyPromotedExteriorPin` still gates the whole resolved membership. This
separation is not cosmetic: the pin compares `resolved.cells.length` against the
accepted `cellCount`, so a build that ever fed it the scheduled subset would fail
every promoted wave closed the moment the camera moved. A test proves that
failure is real.

Cell loading became a **per-cell reconciliation**: a live wave entry now carries
the set of cells it has already requested and their outcomes, and the scheduler
adds and removes cells against it without aborting loads in flight. The abort
test is untouched — it still fires only on a runtime, profile or bucket change.

## The measured opt-in win

Two numbers — artifacts requested, and cache entries/bytes resident — at two
cameras over the same ground point, both variants running the real promoted
default under a fixed 75 s settle window, captured over CDP and committed at
`data/exterior-scheduler-traces-20260814/optin-evidence.json`:

| camera | | default | `exteriorScheduler=on` |
| --- | --- | --- | --- |
| **street, 260 m** (centre of Block 835's extent, pitch -20) | cells scheduled / deferred of 883 | 883 / 0 | **12 / 871** |
| | **artifacts requested** | **484** | **14** |
| | **cache entries / bytes resident** | **484 / 122,601,292 B** | **14 / 1,910,784 B** |
| | `.glb` responses / encoded bytes | 490 / 122,878,678 B | 20 / 2,058,296 B |
| **overview, 2,400 m** (same ground point, pitch -60) | cells scheduled / deferred of 883 | 883 / 0 | **110 / 773** |
| | **artifacts requested** | **484** | **210** |
| | **cache entries / bytes resident** | **484 / 122,601,292 B** | **210 / 37,164,596 B** |
| | `.glb` responses / encoded bytes | 490 / 122,878,678 B | 216 / 37,366,170 B |

No external host was contacted in any of the four sessions. The default is
identical at both cameras, which is the point: it has never known where the
camera is.

**The `.glb` columns are network observations and carry an HTTP-cache caveat the
app-level columns do not.** `Network.setCacheDisabled` was never called and all
four sessions shared one Chrome profile — each variant ran in a fresh page
target, which is not the same thing as a fresh cache. What makes the columns
usable anyway is that the exterior fetcher passes `cache: "no-store"`
(`exterior-cell-runtime.ts`), so an exterior `.glb` cannot be served from the
HTTP cache, and the columns filter to `.glb` only. Non-exterior resources in the
same sessions — the base release, Cesium's own assets — could well have been
cache hits, and no number here counts them. The two headline rows, artifacts
requested and cache entries/bytes, are read from the runtime's own counters and
are unaffected by any of this. The committed evidence record is left exactly as
the capture tool wrote it; this caveat is stated here and in the tool, not
back-edited into a capture.

**These are artifact-request and cache-residency numbers and nothing else. No
frame-time, GPU-memory or rendered-fidelity claim is made or implied** (ADR 0040
D7). At street level the four waves outside the camera's view requested zero
artifacts while the Block 835 wave requested all 14 of its assets, because the
camera is standing in it — the reservation working.

**The cap is applied PER WAVE, not per session, and the overview figure is where
that becomes visible.** Reconciliation runs per wave runtime, so each of the six
waves gets its own decision, its own carry and its own `maxResidentUnits`. At
2,400 m the midtown wave scheduled exactly 96 — the cap, binding — while Central
Upper scheduled 13 and three waves scheduled none, for 110 in total. The session
bound is therefore 6 x 96 = 576 of 883, not 96. That is a real limitation of
this shape and it is stated rather than left to be discovered: **a session-wide
residency budget is T003's byte-governed cache work**, and the generic
`selectResidentUnits` already accepts a mixed unit list, so a single decision
over all six waves' units is a call-site change and not a contract change.

## The thrash gate

Split, as the review required. The CAPTURE happened once, in Chrome, against the
shipping Cesium viewport, driving real `Input.dispatchMouseEvent` drags and
recording the pose and the ground-ray footprint at every `moveEnd`. The GATE is a
deterministic offline replay of that recording through the pure scheduler, with
no browser and no network. Both traces are committed with capture provenance and
checksum sidecars.

| path | decisions | re-entry @3 (budget) | re-entry @8 | peak resident (ceiling 104) |
| --- | --- | --- | --- | --- |
| `midtown-street-pan-v1` — street-level eastward pan across the order-31/order-32 cell boundary | 13 | **0** (0) | 0 | 91 |
| `midtown-zoom-out-v1` — zoom-out from 400 m through the 1.2-2.4 km band to 3,585 m | 17 | **13** (13) | 30 | 96 |

Re-entry is a cell evicted and re-admitted within a bounded decision window. The
gated window is the hysteresis horizon (3 decisions) — a re-admission inside the
horizon is something the policy undertook to prevent and did not; past it, the
camera genuinely came back. **Both budgets are stated at the measured value with
no headroom, so any policy change that makes either path worse fails the gate.**
Re-entry is reported alongside peak resident count against a residency ceiling,
so a policy cannot buy a zero by never evicting.

**The gate replays ONE pool of 883 units; the app runs SIX pools.** The offline
replay hands every ledger cell to a single decision with a single cap, while the
app reconciles each wave separately against its own cap and its own carry. The
two differ, and the difference runs in the conservative direction for this gate:
one pool of 883 against a cap of 96 truncates harder than six pools do, so it
churns at least as much as the app does at the same camera. The gate therefore
bounds the app's thrash rather than reproducing it, and the numbers above should
be read as an upper bound and not as a measurement of the shipped configuration.
Making the app match the replay — one decision over all six waves' units — is the
same call-site change the per-wave cap disclosure above hands to T003.

**The zoom-out does not reach zero, and the reason is a finding about the cap,
not about hysteresis.** Up to ~1.2 km the visible set fits under the cap and
there is no churn at all — zero evictions across four consecutive decisions.
From the decision where the visible set crosses 96, every decision loads and
evicts a handful (10/10, 9/9, 5/5, 4/4, 2/2, 8/8, 8/8). Those cells never left
the footprint, so hysteresis does not cover them: hysteresis retains cells that
stopped being visible, and a cap-truncated cell is visible and unaffordable. The
churn is cells crossing the 1,200 m band edge while the cap boundary sits
mid-band. **The cap is the part of this policy T003 replaces with byte-governed
residency**, and that is where the fix belongs.

## The ADR 0040 obligation re-assignment

ADR 0040 handed T002 four measurement obligations and two open contract
questions. T002 discharged neither set wholesale, and pretending otherwise would
be the failure mode D7 exists to prevent. Each is re-assigned by number, with an
owner:

| ADR 0040 obligation | status after T002 | owner |
| --- | --- | --- |
| Four-class shared-cache reservation (building / restaurant / search / detail; 45,903,404 B and 56 entries reserved) | **not addressed.** T002 changed no cache constant and added no reservation mechanism. It reduced the exterior cell pool's *demand* at one pose; it did not partition anything. | **T003** — "Adopt byte-governed cache residency with proven eviction correctness" |
| Decoded GPU bytes inside Cesium | **not measured.** Still not observable from outside Cesium; T002 observes nothing about the renderer at all. | **T005** (near-field transition band) — the first task with a rendered A/B in scope |
| Per-request round-trip latency | **not measured.** T002's evidence is request *counts* and *bytes*, as ADR 0040's was. | **T003**, alongside the cache work whose cost it prices |
| Cesium Primitive rebuild cost on stream-in and eviction-driven refetch | **not measured**, but its *driver* is now bounded and reported: the thrash gate's re-entry count is exactly the number of eviction-driven refetches on the two recorded paths. | **T005** for the cost; T002 supplies the count |
| Rendered A/B still at overview distance | **not produced.** T002 shipped no assets and changed no rendering. | **T005** |
| Detail-radius / transition-gate pair | **not resolved.** T002 adopted 1,200 m and 2,400 m as *band edges for ranking*, which is not the same decision as a detail radius. | **T005** |
| `refreshViewport` refactor onto the generic scheduler | **not done, deliberately.** The signature was designed to serve shards; the refactor is a separate change to a separate runtime. | **T004** |

### The citywide-shard-pool clarification

ADR 0040's cache arithmetic is about `CitywideLruCache`, constructed once per
citywide runtime for building / restaurant / search / detail shards. **The
exterior cell runtime does not use that pool.** `App.tsx` holds two distinct
caches: `exteriorCacheRef` (`EXTERIOR_RUNTIME_BUDGETS`, shared across all six
exterior waves) and `aggregateCacheRef` (`CITYWIDE_BUDGETS`, the four shard
classes). They are separate instances with separate ceilings and separate
eviction. **The 122,601,292 resident bytes this task measured are the exterior
pool, not the shard pool**, and no number in this record bears on ADR 0040's
four-class reservation arithmetic. Any future reading that adds them together is
wrong.

### Named follow-ups this task deliberately did not do

- **Behind-camera prefetch.** Excluded by the frozen policy for this cycle.
  Hysteresis stands in for it. Revisit only with a measured result showing
  retention is insufficient.
- **Cap-boundary churn on zoom-out** (13 re-entries within the hysteresis
  horizon), diagnosed above and owned by T003.
- **A tuned cap.** `maxResidentUnits: 96` and `hysteresisDecisions: 3` are
  stated starting values, not measured optima. Every measured number in this
  record is measured AT those values and moves if they move.
- **A session-wide residency budget.** The cap is per wave today; see the
  overview measurement above. Owned by **T003**.
- **A user-visible notice for deferred cells, unresolved and named.** At 2,400 m
  the midtown wave deferred **53 cells that were inside the footprint** — visible
  ground the session decided not to load — and the UI says nothing about it. Every
  other way exterior geometry can be missing has words attached: a wave that
  fails closed, a cell the release ships empty, an anchor withheld. A cell the
  scheduler declined is currently indistinguishable from a cell that has no
  geometry, and that sits against the project invariant that failure states are
  explicit. Nothing is built for it this cycle, deliberately: the flag is opt-in
  and off, so no default session can encounter it, and inventing notice wording
  for a behaviour whose residency policy T003 is about to change would be
  wording written twice. The plumbing is in place —
  `ExteriorRuntimeMetrics.deferredCellCount` is set per wave on every
  reconciliation, and it is the value a notice would read. **Deciding the wording
  and the threshold belongs to T003 (which changes the residency policy) and to
  T006 (which would ship it as a default).** It must not become a default without
  an answer.

## Rollback

Removing the flag restores identity, including the URL. Concretely: delete
`EXTERIOR_SCHEDULER_PARAM`/`EXTERIOR_SCHEDULER_ON_VALUE`, the `scheduler` field
on `ExteriorStreamingUrlState` and `ExteriorStreamingUrlWrite` **and its two
lines in `appendExteriorProfileUrl` — the URL appender field is part of the
rollback and leaving it behind would keep writing a parameter nothing reads** —
the `exteriorSchedulerRequested`/`Ref`/`CarryRef` bindings,
`exteriorSchedulerSignature` from the effect's dependency array, and the
`scheduleExteriorCells` call. **The trace probe goes with them**:
`EXTERIOR_SCHEDULER_PROBE_ENABLED`, `EXTERIOR_SCHEDULER_TRACE_LIMIT`, the trace
effect and its two bindings, and the hidden `data-exterior-scheduler-probe`
element — it is already absent from a normal build, but a flag nobody can set
has nothing to trace. The per-cell reconciliation may stay or go: with the flag
gone, `fresh` is the whole declared list on the first run and empty after, which
is the batch it replaced. `exterior-cell-reconciliation.ts` is pure and keeps
its own suite either way.

`src/runtime/exterior-visibility-scheduler.ts`,
`src/runtime/exterior-cell-scheduling.ts` and
`src/runtime/citywide-overview-cell-extents.ts` are pure and unreferenced once
the call site is gone; they can be left in place for T004 or deleted with their
suites. `scheduledCellCount` / `deferredCellCount` on `ExteriorRuntimeMetrics`
are additive and read by nothing but the probe.

This decision is reversed by a measured result — a residency, request-count or
thrash figure the policy cannot meet — not by preference.
