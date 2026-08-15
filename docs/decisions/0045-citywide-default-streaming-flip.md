# Decision 0045: the citywide default flip — show-attribute suppression, one rollback constant, and the split escape hatches

Date: 2026-08-14

Status: **accepted**. Shipped as two independently rollback-able steps.

No release was assembled, no artifact was published, no wave was materialized,
and **no frozen byte changed**. `CITYWIDE_BUDGETS`,
`CITYWIDE_OVERVIEW_BUDGETS`, `EXTERIOR_CELL_SCHEDULER_POLICY`,
`EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY`, both distance-band edges
(1,200 m / 2,400 m), the 128 cap and the 883-cell extents census are
byte-identical to what T005 left.

---

## Part 0 — why this is two steps

The adversarial architecture review re-cut this task as a two-step ship, and the
reason is worth keeping: ADR 0044 §4.1 named the incremental dense-plan update
as a **blocking prerequisite** of the flip and predicted, before measuring, that
every band crossing would pay a multi-second double-draw. Flipping the default
on top of that defect would have made the defect the default.

So **Step 1 fixes the renderer, instruments it, and fixes the notice — all still
behind the opt-in flag** — and is measured. **Step 2 is the mechanical
inversion**, and it was only allowed to happen because Step 1's measurements
came in inside the fixed budgets. Each step is its own commit and each is
revertable without the other.

---

## Part 1 — D-2: suppression is a `show` attribute, not a rebuild

### 1.1 — The mechanism (A1), and the two designs it is not

`denseBuildingInstance` now carries `show: new ShowGeometryInstanceAttribute(...)`
and the layer is built over its **membership** — every base feature the camera
footprint and the group caps admit — rather than over the already-filtered
"who draws" set. An ownership change is then one attribute write per affected
instance against a `featureId -> Primitive` index.

**Not group partitioning.** Splitting the layer into an "owned by dense" group
and an "owned by V3" group would move a building between two live
`PrimitiveCollection`s, which is a remove and an add — i.e. a re-tessellation of
the batch it leaves and the batch it joins, plus a window in which both draw.
That is the cost being removed, re-spelled.

**Not a per-instance add/remove against the live collection.** Cesium's
`Primitive` is immutable in its instance set once constructed; "add one
instance" means rebuilding the batch. The `show` attribute is the only
per-instance mutation the batched path actually supports.

**Picking is covered, and it is not an accident.** `Primitive._appendShowToShader`
runs BEFORE `appendPickToVertexShader` in `createShaderProgram`, and both the
colour and the pick pass use the one compiled program (`primitive._sp`). A
hidden instance is multiplied to a degenerate `gl_Position` in both passes, so
it is unpickable as well as invisible. That matters: a hidden extrusion that
still picked would compete with the V3 model for the same click and the details
panel would sometimes attribute a building to the wrong renderer.

### 1.2 — The trigger taxonomy (A4), stated as the contract

| trigger | what moved | what the renderer does | cost |
| --- | --- | --- | --- |
| **membership** | the camera moved, a shard arrived, a cap bound | full rebuild through `shouldReplaceDenseRenderPlan`, unchanged | a build + a double-draw window |
| **ownership** | a V3 cell went live or was evicted; a pilot asset swapped | `show` writes against the live layer | O(1) per affected instance, no new layer in the scene |
| **neither** | a settled camera | `planReuseCount += 1` | nothing |

`shouldReplaceDenseRenderPlan` is **byte-identical** and remains the sole
rebuild authority — the frozen thrash and reuse baselines are measured against
it, and its committed test (*"rebuilds the whole dense plan when exactly one of
45,154 features changes"*) still passes unchanged. What changed is the quantity
it is fed. `denseRenderPlanDelta {added, removed}` (A5) is consulted **only**
when the membership compare says the membership is reference-identical, and it
never decides a rebuild, so it cannot retain stale geometry.

### 1.3 — What the layer now allocates, and how the counts reconcile

The layer holds instances for buildings it does not currently draw. In the
promoted composition that is at most the 484-building V3 overlay plus the 14
Block 835 pilot assets — about 1.1 % of a 45,154-instance island plan.

`buildingFeatureCount`, `pointFeatureCount` and `featureCount` keep their
established meaning: **what the dense pass DRAWS**. `instanceCount` reports what
was allocated. The two reconcile through the new
`denseSuppressedInstanceCount`. Measured at the 52 km overview: 54,847 instances
allocated, 41,841 buildings drawn, 40 suppressed.

> **Footnote added by T007 (append-only; the paragraph above is unchanged).** The
> `54,847` figure disagrees with §3.2 and with the committed record, which both
> read `53,115`. See the T007 addendum at the end of this document. The drawn
> count of 41,841 is unaffected and agrees in both places.

### 1.4 — C1: the double-draw window, measured against its own definition

ADR 0044 §4.2 could not decide leg Y because `totalBuildMs` measures only the
COMMITTED build, while the window opens at the **first** pending-layer add of an
uncommitted chain — and a cancelled build's add is strictly earlier. The proxy
was structurally biased low against its own definition.

Four fields now carry it, and they are **unconditional `DenseRenderTelemetry`
fields, not probe-gated**, because the measured bundle must be the served
bundle:

- `pendingLayerAddedAt` — the current build's pending-layer add;
- `doubleDrawOpenedAt` — the FIRST such add of the current uncommitted chain,
  **retained across cancellations**, which is the Y-undercount cause;
- `previousLayerRemovedAt` — the commit-time removal of the old layer;
- `doubleDrawMs` — the closed window.

The window is only opened when an old layer exists: a boot build has nothing to
double-draw against, and reporting one would inflate the series with a number
that is definitionally zero.

### 1.5 — A6: the flip counters

`planSuppressionUpdateCount` and `planSuppressionFlipCount` exist because
without them the cheap path is **invisible**: a crossing served by flips
advances no build counter and changes no plan fingerprint that a rebuild-shaped
probe would notice. They are in `publishCitywideDenseMetrics`'s equality check
for the same reason.

---

## Part 2 — E1/E2: three populations, fixed denominators, and a dismiss that stays dismissed

### 2.1 — The defect, and the half-fix that would have been worse

The notice reported ONE population against a denominator that moved with the
camera: `exteriorNotShippedSummary` was passed the cells the last reconciliation
touched, so under the visibility scheduler the same release read "121 of 123" at
one pose and "11 of 12" at the next. A release fact moved when the user panned.

The obvious fix — anchor the denominator to the release's declared cell count —
was implemented, measured, and **found to be worse than the defect**. At a
street camera it produced *"11 of 149 exterior cells declared by this release
ship no exterior geometry"*, which asserts that 138 declared cells DO ship
geometry, for a release that declares 146 of its 149 empty. A camera-scoped
numerator with a release-scoped denominator is false in both directions.

**Both terms now come from the release, or neither does.**
`ExteriorCellRuntime.declaredNotShippedCellCount()` evaluates the same
all-unavailable test the not-shipped branch already applies, over every declared
cell instead of over the reconciled ones. It costs no request: those
`buildingDetails` are already resident in the verified release graph.

### 2.2 — The three populations

| population | scope | recoverable? | source |
| --- | --- | --- | --- |
| **not shipped** | the RELEASE | no — it is what the release declares | `declaredNotShippedCellCount()` of `snapshot.cells.length` |
| **deferred** | THIS camera | yes, by moving the camera | `ExteriorRuntimeMetrics.deferredCellCount` |
| **evicted** | the session's byte budget | yes, on re-entry | `ExteriorRuntimeMetrics.releasedArtifactCount` |

Each states its own recovery in its own sentence. ADR 0044 D-3 recorded that the
old line "reports a data fact in the register of a fault"; the two populations a
reader can actually act on were not reported at all.

**One consequence, recorded rather than discovered later: a single-cell
not-shipped notice loses its cell identity.** Before this change a release with
exactly one unshipped cell stated it by name ("Exterior cell w01-c07 ships no
exterior geometry…"); now that release reports "1 of N exterior cells declared
by this release…" like any other. That is intentional — the numerator and
denominator have to come from the same scope, and the per-cell sentence is
camera-scoped — but it is a real loss of specificity for small releases. The
per-cell text is NOT recoverable from the aggregate, because the aggregate is
computed from the release and not from the reconciled outcomes. Restoring it
would mean emitting the release-scoped aggregate plus a named line for the one
declared cell, which is a notice-shape decision and belongs with T007's notice
work (D-15).

`releasedArtifactCount` is session-wide and is read from the FIRST active wave
only — the app sets the same session totals on every live runtime, so summing
across waves would multiply one pool by the number of promotions.

### 2.3 — E2: dismissal keys on the release facts only

Two of the three populations change on nearly every settled camera move. Keying
dismissal on the whole notice set — which is what `digest.key` is — would
resurrect a dismissed box on every pan, forever. `digest.dismissalKey` is
composed of the not-shipped lines, the residency lines and the verbatim lines,
and deliberately excludes the camera-scoped counts, which still update **in
place** inside an undismissed notice. A release fact changing still re-arms it,
so this is not a dismissal that silences everything.

---

## Part 3 — the campaign

Captured 2026-08-14 on a **reference MacBook, headful Chrome 151**, real GPU,
1440×900 @1, zero external hosts in every capture. Headful is not a convenience:
ADR 0043 recorded that a headless rAF is not vsync-locked, so a headless frame
percentile is not a display-locked number.

### 3.1 — The capped control

`data/citywide-default-flip-20260814/vsync-control.json` — a bare rAF loop on
`about:blank` in the same browser: **p50 7.8 ms, p95 12.4 ms, max 15.5 ms,
implied 128 Hz**.

This is the floor every percentile below must be read against. It matters that
it is 128 Hz and not 60: at 60 Hz a p50 of 16.7 ms would be indistinguishable
from "the renderer was never the limit", and the 16.7 ms budget would have been
unfalsifiable. At 128 Hz the budget has room to fail in, and it did not.

### 3.2 — The default session, and the fixed budgets

**Bundle identity.** The station, crossing, dense-only and rollback records were
all captured on the served bundle `5c71eb62a05…`
(`data/citywide-default-flip-20260814/served-bundle.json`), which is the
default-on build. The D-10 control was captured on the Step-1 bundle
`eede9d2e26d…`; that is stated in §3.4 and carried as D-16 rather than
smoothed over.

**A leftover preview server from the T005 worktree held port 4211 and served a
different worktree's bundle.** The first station run measured it and timed out
on a probe that build did not contain. The served-bundle hash is what caught it,
which is the whole reason the discipline exists.

#### Fixed budgets, steady state only

**Boot builds and crossing transients are reported as durations against the X/Y
bars, separately, and are never folded into a percentile.** Every frame window
opens AFTER the settle completes.

`data/citywide-default-flip-20260814/stations-default.json`. The **default**
arm's URL is the whole claim, so it is quoted verbatim from the record:

```
?data=real-pilot&release=manhattan-citywide-20260804&view=free&lon=…&lat=…&height=…
```

There is **no exterior parameter of any kind**. This is a cold session that
names nothing and streams the island.

| station | p50 | p95 | p99 | max | drawn | allocated | V3 | flips / updates | builds | heap after GC | ext. hosts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| street 260 m | 8.3 | 10.0 | 10.4 | 10.4 | 235 | 395 | 14 | 0 / 0 | 4 | 110.6 MB | none |
| transition 1.2 km | 8.3 | 10.0 | 10.3 | 10.4 | 5,659 | 8,554 | 66 | **57 / 1** | 2 | 199.0 MB | none |
| overview 52 km | 8.3 | **9.8** | 10.2 | 10.4 | **41,841** | 53,115 | 40 | **40 / 1** | 2 | 266.3 MB | none |
| pan storm (settled) | 8.3 | 15.9 | 16.7 | 16.8 | 6,807 | 11,298 | 253 | **284 / 2** | 3 | 296.1 MB | none |
| pan storm (during, 12 drags) | 8.3 | 8.7 | 9.1 | 9.3 | — | — | — | — | — | — | none |

**Against the fixed budgets: every station passes, on the tighter pair.** The
bar is p50 ≤ 16.7 ms and p95 ≤ 25 ms; the worst p50 is 8.3 ms and the worst p95
is 15.9 ms. The relaxed pair (33.3 / 45) is not needed anywhere. The vsync floor
is 7.8 ms, so a p50 of 8.3 ms is the display cap and not the renderer.

Four readings:

1. **The default session renders the island.** 41,841 real extrusions drawn at
   the 52 km overview from a URL that names nothing.
2. **The show-attribute path is doing the work, and it is not marginal.** 57
   flips at the transition station and 284 across the pan storm, against 2 and 3
   builds. Before Step 1 every one of those 341 ownership changes was a
   whole-island rebuild with a double-draw window; now they are attribute
   writes. This is the single largest behavioural difference the flip depends on.
3. **The pan storm is cheaper DURING the storm than after it** (p95 8.7 ms vs
   15.9 ms). That is not a paradox: the drags keep the camera unsettled, so the
   dense plan is not rebuilt while the user is dragging, and the settled window
   afterwards contains the rebuild the storm queued. The budget is met in both.
4. **Zero external hosts at every station.** The local-only invariant holds
   under the default, which is the first time it has been asserted about a
   session nobody had to configure.

**Boot builds, reported separately and never folded in:** 242.9 ms (street),
8.8 ms (transition), 7.2 ms (overview) `totalBuildMs`, with time-to-first-dense
of 1.27 s / 2.21 s / 5.81 s. All are far inside the 8,000 ms leg-X bar. Contrast
ADR 0044's software-rasteriser boot builds of 18,026 ms and 27,552 ms: those
were SwiftShader numbers and this ADR does not compare against them.

**Heap after forced GC** rises 110.6 -> 296.1 MB with scene size, which is what
a growing resident scene should do. This is a per-station reading, NOT the
repeated-path monotonicity verdict goal AC #7 asks for; that verdict is not
claimed here.

### 3.3 — D-9: the island-scale crossing

`data/citywide-default-flip-20260814/island-crossing.json`. Four 40 px drags
from the 52 km overview, in ONE document, on a **41,881-building island plan in
478 chunks** — 8.7× the 4,803-feature plan every ADR 0044 crossing number was
measured on.

**Pre-registered (C2) before the capture: legs X and Y are evaluated against the
V3-SUPPRESSION crossing.** That is the crossing the show-attribute path exists
to serve and the one ADR 0044 §4.1 named as the flip's prerequisite.
Bounds-membership rebuilds are a real and separate cost and are reported as
their own series below, not folded into the same bar.

#### The V3-suppression crossing — the evaluated series

One isolated crossing, `planBuildCountUnchanged: true`, **80 instance flips** on
the 41,881-building plan.

| leg | bar | measured | fires? |
| --- | --- | --- | --- |
| **X** — rebuild wall clock | > 8,000 ms | **0 ms — no rebuild occurred** | **no** |
| **Y** — double-draw window | > 4,000 ms | **0 ms — no second layer entered the scene** | **no** |
| **AND** not fixable incrementally | — | it WAS fixed incrementally; that is this ADR | **no** |

**Recorded verdict: the per-cell coarse-GLB revival does NOT fire.** ADR 0044
recorded the same verdict on the AND clause alone, with leg Y not established
and the note that "the verdict would be unchanged if Y were later established as
fired". The cheap fix it named as un-attempted has now been attempted and
works: at island scale, an ownership change costs **zero** rebuild and **zero**
double-draw, where ADR 0044 measured 3,557.9 ms and a window bounded in
[2,821 ms, 4,084 ms] on a plan an eighth the size.

#### The bounds-membership series — reported, and it exceeds the Y bar

| rebuild | features | chunks | `totalBuildMs` | `doubleDrawMs` (measured, own definition) |
| --- | --- | --- | --- | --- |
| boot | 0 | — | 12.4 ms | none — no old layer to double-draw against |
| the drag | **41,881** | 478 | **5,746.2 ms** | **5,746.2 ms** |

**Leg Y's 4,000 ms bar is exceeded on this series, and that is a real finding,
not a rounding.** Two things follow, and neither is hidden:

1. **Leg Y is now measured against its own definition**, which ADR 0044 §4.2
   could not do. `doubleDrawOpenedAt` is the first pending-layer add of the
   uncommitted chain and survives cancellations, so this 5,746.2 ms is the
   window, not a build-duration proxy known to undercount it. ADR 0044's open
   question is closed — with a number above the bar.
2. **It still does not revive the coarse GLB, and the reason is the AND
   clause.** An earlier draft argued the point structurally — that a coarse
   tier streamed by the same footprint is rebuilt by the same event. **That
   argument is wrong and is withdrawn:** a pre-baked per-cell GLB is LOADED,
   not tessellated, so a membership change would swap already-built meshes
   rather than re-extruding 41,881 polygons, and the cost profile genuinely
   would differ.

   The clause that actually decides it is the one ADR 0044 §1.3 pre-registered
   and that §5.2 D-11 names: **a strictly cheaper, named, un-attempted fix
   exists** — an incremental MEMBERSHIP reconciliation (add/remove batches
   against the live layer, instead of building a whole replacement layer and
   swapping it). It attacks the same cost, inside the renderer, without
   reviving an asset pipeline. Reviving one while that is untried would be
   reviving it for the wrong reason, which is exactly what the AND clause is
   for. The verdict is unchanged; only its justification is.

**What this bounds series does NOT do is violate the flip's acceptance.** The
fixed budgets are frame-time percentiles and they pass at every station,
including the pan storm that drives exactly these rebuilds (p95 8.7 ms during,
15.9 ms settled). The 5,746 ms window is a memory-and-overdraw transient, and
ADR 0043's arithmetic for it (≈190 MB dual-layer) is unchanged. It is carried
forward as **D-11**.

### 3.4 — D-10: the radius control ADR 0044 never ran

`data/citywide-default-flip-20260814/radius-control.json`. Same flag, same
budgets, same overlay, radius `null` against radius 1,200 m. Both arms have the
raised citywide budgets, so a difference in these rows is the RADIUS and not the
residency raise — which is exactly what ADR 0044 §3.1 reading 8 said no row of
its table could separate.

| pose | arm | visible | deferred | V3 drawn | dense buildings |
| --- | --- | --- | --- | --- | --- |
| 500 m | radius null | 62 | 0 | 14 | 2,910 |
| 500 m | radius 1,200 | 61 | 0 | 14 | 2,920 |
| 1 km | radius null | 108 | 0 | **29** | 4,335 |
| 1 km | radius 1,200 | 84 | 0 | **14** | 4,335 |
| 2 km | radius null | 204 | **76** | 54 | 9,103 |
| 2 km | radius 1,200 | 84 | **0** | 54 | 9,100 |
| 3 km | radius null | 303 | **175** | **104** | 14,333 |
| 3 km | radius 1,200 | 93 | **0** | **54** | 14,378 |

`hold === "none"` in all eight decisions.

Three readings:

1. **The radius is the thing that keeps the cap from binding.** At 2 km and
   3 km the radius-null arm defers 76 and 175 cells — the 128 cap binding — and
   the radiused arm defers **zero**. ADR 0044 §3.1 measured `deferredCount = 0`
   at all four poses and concluded the footprint binds and not the cap; that
   conclusion was an artifact of measuring only the radiused arm. The cap does
   bind at 2–3 km without a radius.
2. **The radius costs V3 coverage, and the cost is now visible.** At 3 km it
   halves the drawn overlay (104 -> 54); at 1 km it more than halves it
   (29 -> 14). ADR 0044 could not see this because its control had no overlay at
   all, which made the column tautological.
3. **The dense plan is untouched by the radius** (4,335 vs 4,335; 9,103 vs
   9,100; 14,333 vs 14,378 — the last two differ by ordinary camera-settle
   jitter, not by the knob). The radius governs V3 residency and nothing else.

**The ADR 0044 recommendation stands, for a corrected reason.** Ship
`maxUnitDistanceMeters = null`. Not because "there is no cost to bound" — this
control shows the cap does bind at 2–3 km — but because at those poses the
radius buys budget headroom by **deleting half the verified V3 geometry the user
came for**, and the frame budgets are met without it (§3.2). A radius becomes
the right trade only when the cap binding actually costs something measurable,
and at 128 Hz with p95 inside 10 ms it does not.

### 3.5 — D-5: the clean dense-only arm, reachable at last

`data/citywide-default-flip-20260814/stations-dense-only.json`, `?exteriorStreaming=off`.

ADR 0044 §3.1 reading 6 recorded the confound in its own words: its dense-only
arm reached that state through a URL that ALSO withdrew the citywide residency
raise, so "the `dense buildings` column is **not** comparable between arms".
The B2 split removes the confound: `exteriorStreaming=off` now disables the wave
and says nothing about the budget, so both arms carry the same raised budgets
and differ in exactly one thing.

| station | arm | p50 | p95 | dense buildings drawn | V3 drawn |
| --- | --- | --- | --- | --- | --- |
| street 260 m | default | 8.3 | 10.0 | 235 | 14 |
| street 260 m | dense-only | 8.3 | 9.0 | 235 | **0** |
| transition 1.2 km | default | 8.3 | 10.0 | **5,659** | 66 |
| transition 1.2 km | dense-only | 8.3 | 9.3 | **5,716** | **0** |
| overview 52 km | default | 8.3 | 9.8 | 41,841 | 40 |
| overview 52 km | dense-only | 8.3 | 8.9 | 43,021 | **0** |

**The transition row is the one that proves the arm is clean, and it is exact.**
5,659 drawn + 57 flipped-off = **5,716**, which is precisely what the dense-only
arm draws. The two arms account for the same buildings; the only difference is
who draws the 57 the V3 overlay owns. Under the old conflation this row could
not have been written, because the dense-only arm would have been drawing a
different island.

The overview row differs by 1,180 rather than by 40, which is camera-settle
jitter in the shard membership at a 52 km footprint and not a suppression
accounting error — the suppression column is 40 and the flip counter agrees.
It is recorded rather than explained away.

Dense-only is consistently a little cheaper (p95 8.9–9.3 vs 9.8–10.0 ms), which
is the honest price of the V3 overlay: about 1 ms of p95 for 14–66 textured
buildings. Both arms are far inside the budget.

### 3.6 — The rollback rehearsal

`data/citywide-default-flip-20260814/stations-rolled-back.json`,
`?exteriorScheduler=off` — the per-session spelling of the same switch
`EXTERIOR_SCHEDULER_DEFAULT_ON` throws globally.

| station | arm | p95 | dense buildings drawn | residency active | `maxRenderedDenseFeatures` | `maxLoadedShards` / bytes |
| --- | --- | --- | --- | --- | --- | --- |
| street 260 m | default | 10.0 | 235 | **true** | 57,547 | 112 / 83,886,080 |
| street 260 m | rolled back | 8.8 | 235 | **false** | **6,000** | **24 / 50,331,648** |
| transition 1.2 km | default | 10.0 | **5,659** | true | 57,547 | 112 / 83,886,080 |
| transition 1.2 km | rolled back | 8.9 | **3,983** | false | 6,000 | 24 / 50,331,648 |
| overview 52 km | default | 9.8 | **41,841** | true | 57,547 | 112 / 83,886,080 |
| overview 52 km | rolled back | 8.7 | **5,289** | false | 6,000 | 24 / 50,331,648 |
| pan storm | rolled back | 9.6 | 3,123 | — | 6,000 | 24 / 50,331,648 |

**The rehearsal restores the promoted-subset behaviour, and the record shows it
in three independent ways at once:** the drawn island collapses from 41,841 to
5,289, `overviewResidencyActive` goes false, and the session resolves
`maxRenderedDenseFeatures: 6000` / `maxLoadedShards: 24` /
`maxLoadedBytes: 50331648` — the UNRAISED `CITYWIDE_BUDGETS`, the exact values
T004's raise replaced. A rollback that only restored the scheduler would show
the first and not the third.

Two further readings:

- **The rolled-back session draws MORE V3, not less** (95 suppressed at the
  street pose against 14 in the default arm). That is the promoted-subset
  behaviour by definition: with no visibility scheduling every declared cell is
  asked for, so the whole 484-building overlay is resident. It is the same
  observation ADR 0044 §1.5 made when it refused to use flag-off as an A/B
  control, now confirmed under the inverted default.
- **It is cheaper on frame time** (p95 8.7–9.6 ms) because it draws an eighth of
  the island. Frame budget is not the reason to prefer the default; coverage is.

The rehearsal is a session-level proof of the constant's first half. The second
half — that the budgets resolve byte-identically to `CITYWIDE_BUDGETS` when the
constant is `false` — is a deterministic test rather than a capture, because a
byte comparison is not a thing a screenshot can establish (§4.1).

---

## Part 4 — the flip mechanics

### 4.1 — B3: one rollback constant

`EXTERIOR_SCHEDULER_DEFAULT_ON` is read in exactly two places — the URL parse
default, and (through the parsed value) `resolveCitywideOverviewResidency`.
Flipping that one token restores the promoted-subset behaviour.

The test pins **both halves**, and the second half is the one that would have
been missed: a rollback that restores the scheduler but leaves the raised
budgets in place is not a rollback, it is a third configuration nobody measured.
`resolveCitywideOverviewResidency(false, true).budgets` must be `toEqual`
`CITYWIDE_BUDGETS`, and the counterfactual (`true, true` resolves something
else) is asserted so the test cannot pass by the gate being dead.

### 4.2 — B1/F5: the URL contract, inverted

| URL | scheduler | exterior wave |
| --- | --- | --- |
| *(nothing)* | **on** (the default) | promoted default |
| `?exteriorScheduler=off` | off — the per-session rollback | promoted default |
| `?exteriorScheduler=on` | on (legacy spelling, still honoured) | promoted default |
| `?exteriorStreaming=off` | **on** | none |
| `?exteriorCells=<typo>` | **on** | none (fails closed) |
| `?exteriorCells=<pinned>` | **on** | that release |

Absence means the default; exactly two spellings are accepted and everything
else is silence, which is the default — the same fail-direction the "on"-only
parser had. A default session serializes **no exterior parameter at all**, so a
shared default link stays reproducible against whatever the build defaults to
rather than freezing today's answer into every copied URL.

**The opt-out is written first and unconditionally.** T002's defect was a flag
read at boot and dropped by the first camera-driven `replaceState`; its mirror
is an opt-out that silently re-arms the default on the first pan, and a session
that stops being opted out halfway through is worse than one that never was. A
test drives the full parse -> write -> parse cycle.

The radius gate rides the resolved scheduler value rather than the literal
`=on` (F5), so `?exteriorScheduler=off&exteriorDetailRadius=1200` resolves to no
radius rather than to a radius on an unscheduled session.

### 4.3 — B2: the conflated boolean, split

`exteriorStreaming=off` used to disable the exterior wave AND withdraw
visibility scheduling, and with it T004's citywide overview residency raise. Two
unrelated things hung off one boolean. Consequences, both now gone:

- ADR 0044 §3.1's A/B had a confound it recorded but could not remove: its
  "dense-only" arm also lost the raised budgets, so the two arms differed in two
  ways at once. That is D-5, and §3.5 is the arm the split makes reachable.
- **F4: a MISTYPED `exteriorCells` silently downgraded the render budget.** A
  link nobody intended as a performance instruction quietly halved what the
  session would draw. It now fails closed on the WAVE and says nothing about the
  budget.

**Decision, pinned:** a pinned single-release link (`exteriorCells=<pinned>`) is
**default-scheduled**. It names which wave to stream, not how to budget.

### 4.4 — F2/F3: both gates are the citywide gate

`schedulerEnabled` and `exteriorSchedulerSignature` are now gated on citywide
mode as well as on the flag — deliberately the same expression as
`resolveCitywideOverviewResidency`. With scheduling on by default, an ungated
flag would begin filtering the CIVIC session's cell loads and would turn the
fixture session's dependency signature into a live footprint. Neither cadence
was measured by this goal and neither changes.

**B4, honestly:** ADR 0041 claimed the cell-loading effect "runs exactly as
often as before" because a default session's signature was the constant empty
string. **That claim inverted at the flip.** A default citywide session now
re-runs the effect on every settled camera move — the intended cost of
visibility scheduling, and what §3.2 measured. Non-citywide sessions keep the
constant signature, which is what the gate protects. The `toBe` identity test is
mirrored onto the enabled path and records that it is **content-stable but not
reference-identical**: the enabled path is a filter and allocates. That is
stated rather than hidden, because the effect reconciles on
`exteriorCellLoadInputsUnchanged` — runtime, profile and height bucket, blind to
the footprint — so a content-stable decision costs no additional load work.

---

## Part 5 — deferred and unresolved

### 5.1 — Goal acceptance references this flip discharges

| goal AC | status after T006 | evidence |
| --- | --- | --- |
| 1 — no unconditional all-cell load | **discharged** | every station records `deferredCellCount` > 0 under the default; `stations-default.json`, plus the committed scheduler unit tests |
| 2 — island overview renders real geometry | **discharged for the default session** | 41,841 extrusions at 52 km from a parameter-free URL. The 899 grammar-refused buildings remain tombstoned; unchanged |
| 3 — 2 % silhouette on eligible transitions | **carried from ADR 0044 §3.3**, unchanged (worst 0.001834, 10.9× inside) | not re-measured; nothing in this task touched LOD declarations |
| 4 — reversible by one switch + revival clause | **discharged** | §4.1 and §3.3; revival does not fire |
| 5 — frame budgets off the vsync floor with a capped control | **discharged** | §3.1, §3.2 |
| 6 — byte-based cache governance, eviction correctness | **partial** | residency and class sizes recorded at every station; **no eviction was observed** (`classEvictions: {}` everywhere) so evict/refetch and identity-under-eviction were NOT exercised. See D-12 |
| 7 — repeated-path heap non-monotonic under forced GC | **NOT discharged** | per-station forced-GC readings only. The repeated-single-path monotonicity verdict is not claimed. See D-13 |
| 8 — ≤ 8 concurrent exterior requests | **not measured here** | `peakConcurrentRequests` is in the probe payload but was not asserted by this campaign. See D-14 |
| 9 — picking, details, deep links, attribution unchanged | **partial** | the committed journey suite passes (1,789 tests); the extended eviction/identity journeys were not run, see D-12 |
| 10 — rollback rehearsed with evidence + ADR | **discharged** | §3.6, §4.1, this document |
| 11 — the notice reflects the new reality | **NOT discharged, by design** | the three-population split shipped, but the default session still reports 146/149-shaped by-design tombstones. "Zero by-design cell tombstones" is a judgement about whether an exterior cell that ships nothing is a gap at all when the dense shard draws the building — and T007 owns "notice reality". See D-15 |

### 5.2 — Deferred by number

- **D-11: the island-scale bounds-membership double-draw is 5,746 ms and exceeds
  the 4,000 ms leg-Y bar** (§3.3). It does not revive the coarse GLB (structural
  reason recorded) and it does not breach the frame budgets, but it is the
  largest measured transient in the system and it is now a DEFAULT-session cost
  rather than an opt-in one. The candidate fixes are a chunked membership
  reconciliation (add/remove batches rather than a whole-layer swap) or
  deferring the pending-layer add until the first batch is ready. Neither was
  attempted here: both change the commit path this campaign measured.
- **D-12: eviction was never exercised.** `classEvictions` is empty at every
  station and `releasedArtifactCount` stayed 0, so the evicted population of the
  notice is shipped and unit-tested but has never been seen live, and goal AC
  #6/#9's eviction journeys are unmet. A station that forces eviction needs a
  camera path that exceeds the byte cap, which at 58 MB of 99 entries the
  measured paths do not approach.
- **D-13: the repeated-camera-path heap verdict** (goal AC #7) is not claimed.
  Per-station forced-GC readings are committed; the repeated-single-path ratio
  and noise band are not.
- **D-14: peak concurrent requests** (goal AC #8) was not asserted by this
  campaign, though the field is in the probe payload.
- **D-15: "zero by-design cell tombstones"** is a notice-semantics decision
  belonging to T007, whose title carries "notice reality". This task delivered
  the three-population split it was contracted for and deliberately did not also
  decide whether a not-shipped exterior cell is a tombstone at all in a session
  where the dense shard draws the building.
- **D-16: two committed records were captured on the Step-1 bundle**
  (`eede9d2e…`), before the Step-2 URL inversion: `radius-control.json` (D-10,
  §3.4) and **`stations-scheduler-on.json`**. The radius semantics under an
  enabled scheduler are unchanged by the inversion, so §3.4 is cited as
  measured. **`stations-scheduler-on.json` is SUPERSEDED and is cited nowhere
  in this ADR**: it is the same station set under the pre-flip
  `?exteriorScheduler=on` spelling, retained only because deleting captured
  evidence to tidy a bundle list is the wrong direction. §3.2's sentence
  ("the station, crossing, dense-only and rollback records were all captured on
  `5c71eb62a05…`") refers to the records this ADR cites; the superseded file is
  named here so the directory listing does not contradict it.
- **D-4 (from ADR 0044): band-internal ranking prefers wave order over
  distance.** §3.4 now shows the cap DOES bind at 2–3 km without a radius
  (`deferredCount` 76 and 175), which is exactly the condition under which that
  ranking defect becomes reachable. It was unreachable when ADR 0044 handed it
  on; it is reachable now. Not taken here — it changes `compareRanked`, which
  both frozen thrash baselines were measured against.
- **D-17: the commit gate's WIRING is unguarded, only its arithmetic is.** The
  three tests added for the review (`CesiumViewport.test.ts`) exercise the same
  pure functions the commit gate calls — `denseRenderPlanDelta`,
  `applyDenseSuppressionDelta`, `denseAppliedSuppressionSet` — over a synthetic
  `featureId -> Primitive` index, and they pin those functions' contracts. They
  never render the component, so they cannot observe whether the component still
  CALLS them. Deleting the commit-path reconciliation would leave the suite
  green.

  The unguarded surface is `applyDenseOwnership`, defined at
  `src/features/explorer/CesiumViewport.tsx:2044`, and its two call sites: the
  commit-path reconciliation at **`:2132`** (ownership that moved while a build
  was running) and the settled-camera flip at **`:2144`**. Between them they are
  the entire path by which a V3 cell going live or being evicted reaches the
  screen without a rebuild — the mechanism this whole ADR rests on.

  The closing instrument already exists as an obligation: **ADR 0044 D-6, the
  React harness**, whose stated condition was "needed only if a cycle changes
  the cell-loading effect's call order". This cycle did not change that order,
  but it did add a new effect-resident decision with no way to test it, which is
  the same need arriving by a different route. **Routed to T007.**

- **D-8: the 484 / 474 discrepancy remains unresolved**, carried unchanged.

## Rollback

**Step 2 alone:** set `EXTERIOR_SCHEDULER_DEFAULT_ON` to `false`. The URL
default, the residency gate and the budget resolution all follow, and a
URL-silent session returns to the promoted-subset behaviour with byte-identical
`CITYWIDE_BUDGETS`. Rehearsed in §3.6.

**Step 2 as a commit:** revert `bd71a1a`. The renderer fix, the instrumentation
and the notice stay.

**Step 1:** revert `0374005`. `denseBuildingInstance` loses its `show`
attribute, the layer is rebuilt over the filtered plan again, and the four
double-draw timestamps and two flip counters disappear from
`DenseRenderMetrics`. Nothing outside the viewport and the notice reads them.

---

## Addendum (T007, Issue #72) — the D-15 disposition

*Appended by T007. No section above was rewritten; this records what the task
D-15 was routed to decided.*

**D-15 asked whether a not-shipped exterior cell is a tombstone at all in a
session where the dense shard draws the building.** The disposition is: **it is
still a real property of the build, so the line stays — and it was WRONG about
what the reader sees, so the line was reworded.**

Before the flip, "*N of M exterior cells declared by this release ship no
exterior geometry; no substitute was selected for them*" was true in both
halves: nothing was drawn for those cells. After the flip the first half is
still true and the second is false by omission — those buildings draw, as
sourced base massing. The reword states both:

> N of M exterior cells declared by this release ship no **generated** exterior
> geometry; **where the citywide base tier is active**, their buildings draw as
> **sourced base massing (footprint extruded to sourced height)**, which is not
> a generated exterior.

**The second clause is CONDITIONAL, and the condition is not hedging.** Review
caught that an unconditional promise is affirmatively FALSE in the rollback arm:
under `?exteriorScheduler=off` the overview residency is withdrawn
(`overviewResidencyActive` false, 5,289 drawn rather than 41,841), so telling the
reader that those ~41k buildings draw as massing would be a claim about a screen
that does not show them. "Where the citywide base tier is active" makes one
sentence true in every arm.

**The condition is expressed in WORDS, not plumbed from a session flag.** That
choice was frozen deliberately and the reasons are recorded here rather than
left implicit:

- **No plumbing.** Reading the arm to select a wording adds session state to a
  pure composer and gives the digest two strings to recognize instead of one.
- **No camera or configuration dependence.** `notShippedLines` feeds
  `dismissalKey`; a line that varies with configuration re-arms a notice the
  reader already dismissed — the same defect class §2.1 fixed.
- **A single stable string.** The seven journey CLIs assert a live predicate on
  this sentence. One invariant string means one substring to assert on, which is
  the sentence's **first clause** — a pure release fact, true in every arm.
  Those seven predicates previously matched `no substitute was selected`, which
  the reword removes; T007 updated all seven to `no generated exterior geometry`
  and left every committed `journey-evidence.json` capture byte-identical.

Three properties were preserved deliberately, and each of them rules out a
design that looked simpler:

1. **It is UNCONDITIONAL.** The line is not gated on dense residency and takes
   no camera-dependent input. `notShippedLines` feeds `dismissalKey` (§2.3), so
   a residency-conditioned line would re-arm a notice the reader had already
   dismissed — the exact defect §2.1 fixed. Both counts stay release facts.
2. **Three sites move together or the line falls through to verbatim.** The
   composer, `NOT_SHIPPED_PATTERN` and the build-level aggregate template are
   coupled by nothing but a test, and a stale pattern does not throw — it
   silently restores the six-wave wall of text this digest replaced. That
   failure mode is now asserted directly.
3. **The single-cell path is byte-identical.** One not-shipped cell still states
   itself in its own words and still falls through to verbatim rather than being
   restated as an aggregate of one, and real per-cell failures still outrank the
   aggregates in render order.

**Goal AC #11 is therefore graded MET-AS-ADJUDICATED, not MET.** "Zero by-design
cell tombstones" is not literally delivered: the count of by-design cell lines is
unchanged, because the cells genuinely ship no generated exterior and deleting
the line would hide a real property of the build. What changed is the line's
meaning, not its existence. The full verdict, with its delta, is in
`data/citywide-goal-acceptance-20260815/reconciliation.json`.

**Records and scripts that quote the OLD sentence are left byte-identical**, in
this ADR and everywhere else. They are captured evidence of what was on screen
at the time, and rewriting them to match today's wording would be falsifying a
capture. `data/citywide-default-flip-20260814/stations-default.json` therefore
still reads "*146 of 149 exterior cells declared by this build ship no exterior
geometry (by design; no substitute was selected).*" — and that record is the
evidence base for why the reword was needed.

**One correction owed, and not made here.** §1.3 states "54,847 instances
allocated" at the 52 km overview; §3.2 and the committed record it cites both
state 53,115 (`stations-default.json`: `instanceCount` 53115,
`buildingFeatureCount` 41841, `denseSuppressedInstanceCount` 40). The evidence
supports 53,115. T007 did not rewrite §1.3 — it does not rewrite ADR sections —
and carries the discrepancy as a residual risk in the acceptance record instead.
The drawn count of 41,841 is unaffected and agrees in both places.

### The single-cell branch is dormant, which is why preserving it is cheap

Point 3 above says the single-cell path is byte-identical. That is worth stating
accurately rather than as pure virtue: **with the live runtime the branch is
effectively unreachable.** `exteriorNotShippedSummary` consults `cells` only
when no `declared` fact is supplied, and the application always supplies one
(`exterior-cell-runtime.ts` derives the declared not-shipped count per release),
so the reconciled path — and with it the one-cell branch that returns the cell's
own notice verbatim — is exercised by tests and by a hypothetical unqualified
caller rather than by a session. Preserving it therefore cost nothing and proves
nothing about the shipped notice; it is kept because a dormant branch that still
compiles and still passes its tests is the cheapest possible option value, not
because it was a hard constraint the reword had to satisfy.

### §5.1's grades are campaign-scoped; this ADR is not superseded, it is narrower

§5.1 grades goal AC #6 **partial** and AC #8 **not measured here**, and both are
correct *about this campaign*: `classEvictions` is empty at every station and the
pan-storm capture carries no concurrency block. The goal-level record
`data/citywide-goal-acceptance-20260815/reconciliation.json` reads the whole
committed evidence base — including T003's injected-cap eviction proofs, its live
browser roam, and the 2026-08-12 cold-load concurrency measurement — and grades
both **MET**, each disclosing the half this campaign did not reach. Where the two
documents differ, **the difference is scope, not fact**: §5.1 answers "what did
T006 measure", the acceptance record answers "what does the goal's evidence base
support". Neither number was changed to agree with the other.

---

## Addendum (T008, Issue #80) — §5.1 row 7 and §5.2 D-13 are discharged by capture

*Appended by T008. **No section above was rewritten.** §5.1 row 7 still reads
"NOT discharged" and §5.2 D-13 still reads "not claimed" because that is what
was true of **this campaign**, and this ADR records what T006 measured. What
follows is the later evidence those two entries pointed at, recorded here so a
reader who reaches row 7 is not left at a dead end.*

**The verdict now exists.**
`data/citywide-heap-repeat-20260815/heap-repeat-evidence.json` (sha256
`6c3ef7c38118dcc1630a1da73ae2224592b5c4fbd94c60c4488a07ddc925eb9a`) captures the
repeated-single-path monotonicity reading row 7 declined to claim: one
deterministic island-scale path — 52 km overview, 2,400 m and 1,200 m on the
scheduler's band edges, a 260 m midtown street pose, a 260 m lower-Manhattan
street pose — repeated as one unsampled warmup lap plus **8 sampled laps in a
single document**, 45 s settle per pose, with an explicit in-page `window.gc()`
before every heap sample. It **PASSES** the rule that was pre-registered before
it ran: `growthRatio` **−0.0650829356922181** against a 0.1 noise band,
`monotonicGrowthDetected` **false**, over 8 repeats ≥ the floor of 6. The
arithmetic is `block835CanaryHeapVerdict` **imported** from
`src/runtime/block835-canary-probe.ts`, and a colocated test recomputes it from
the committed series and demands byte-equality.

**Row 7's own caution is preserved, because the pass is narrow.** Three bounds
travel with it and are recorded in the capture rather than in prose only:

1. The pass rule's two conjuncts are **one measurement reported twice** —
   `monotonicGrowthDetected` is literally `growthRatio > noiseBandRatio`
   (`block835-canary-probe.ts:322`), a restatement of the median ratio test and
   not an independent monotonicity test. The capture therefore carries real
   monotonicity columns: a strictly increasing run of **5** of the 8 sampled
   repeats, rising 1,041,736 B before two collections drop the series, and an
   OLS slope of −7,373,936 B/lap at `rSquared` 0.431 — that negative slope is
   the two drops, not a trend.
2. The **detection floor is 7,952,260.75 B per lap** (`0.10 ×
   firstHalfMedianBytes / 4`, the two medians being centred four laps apart), so
   the pass **bounds** retention rather than excluding it.
3. **Half of the pressure the closure was asked for is structurally
   unreachable.** The 128-cell exterior pool *is* pressed (`residentCount` 128
   against `visibleCount` 883, `deferredCount` 755, every lap), and the release
   seam freed 472 artifacts / 144,610,620 B across the run — where §5.1 row 6
   and D-12 correctly record that this campaign forced nothing. But the citywide
   **dense shard** pool cannot be made to evict by any camera: it is capped at
   112 shards / 83,886,080 B (`src/release/citywide-release.ts:79-80`) and the
   whole island fits under both, measured here at 103 entries / 62,598,581 B
   with `cacheEvictions` 0 by design.

**Scope note, in the spirit of the section above this addendum.** Row 6 and D-12
are *not* discharged by this. What T008 exercised is the scheduler's artifact
**release** seam on a default path; an **LRU eviction** from the exterior cell
cache still did not occur (40 entries / 14,369,372 B against 512-entry, 256 MiB
caps). The goal-level record
`data/citywide-goal-acceptance-20260815/reconciliation.json` grades criterion 7
**MET** on this capture and carries the bounds above; where that record and this
ADR differ, the difference is scope, not fact.

**One finding travelled the other way.** Building the instrument surfaced a
defect this ADR's campaign could not have seen, because T006 navigated a fresh
document per station: a routed pose change applies the camera but does **not**
refresh the viewport footprint, so Back/Forward can leave the scheduler on a
stale resident set. It is carried as **D-18** in the goal-level record, with the
symbol, the lines, the mechanism, the observed consequence and the closing
instrument. It is recorded, not fixed — fixing it is a runtime change to the
camera commit path, and changing it would have changed the behaviour the capture
was measuring.
