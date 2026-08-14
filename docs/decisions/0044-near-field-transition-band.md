# Decision 0044: the near-field transition band, its detail radius, and the recorded mid-distance verdict

Date: 2026-08-14

Status: **pre-registration accepted 2026-08-14, before any capture. Verdict
appended below after measurement.**

No release was assembled, no artifact was published, no wave was materialized,
and **no frozen byte changed**. `CITYWIDE_BUDGETS`,
`EXTERIOR_CELL_SCHEDULER_POLICY`, `EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY`, both
distance-band edges (1,200 m / 2,400 m) and the 128 cap are byte-identical to
what T004 left. The one code lever this task adds defaults to `null`, which is
the decision the scheduler made before the field existed.

---

## Part 1 — pre-registration

Everything in Part 1 was written and committed **before the first capture ran**.
It exists because two of this task's questions have arithmetically pre-determined
answers, and answering them after looking at the stills would have been a
post-hoc rationalisation dressed as a measurement.

### 1.1 — The lever, and the two dead ends that are not levers

The task needs one knob that bounds how far from the camera the textured V3
overlay is allowed to reach. Three candidates existed. Two do not work, and the
reasons are recorded here so no successor spends the cycle rediscovering them.

**Dead end A — the distance-band edges are sort keys, not admission tests.**
`bandIndexOf` in `src/runtime/exterior-visibility-scheduler.ts` feeds
`compareRanked`, and nothing else. A unit in band 2 is ranked *after* band 1, not
refused. Admission is decided one step earlier, by
`viewportBoundsIntersect(unit.bounds, view.footprint.bounds)` — a
footprint-intersection test with no distance term in it at all. The bands
therefore change **who gets cut only once the cap binds**, and at the near-field
poses this task measures the cap does not bind: the footprint does. Moving
1,200/2,400 cannot move a near-field decision. (This is also why the ADR 0042
finding handed to T005 — band-internal ranking prefers wave `order` over distance
— is a *ranking* defect that only manifests at capped poses; see §3.4.)

**Dead end B — the manifest `maxDistanceMeters` is a different quantity.**
`AssemblyLod.maxDistanceMeters` selects *which LOD of an already-admitted asset*
to fetch. It is evaluated against `lodDistanceMeters`, which the app supplies as
a **bucketed camera ellipsoid height**, not a camera-to-unit distance
(`ExteriorCellRuntime.loadCell`, and its own doc comment says so). And it lives
inside checksum-pinned immutable release manifests that this goal may not edit.
It is unusable as a detail radius on both counts: wrong quantity, frozen bytes.

**The lever — `SchedulerPolicy.maxUnitDistanceMeters`.** One optional field,
default `null`, applied in exactly one place: the footprint-intersection branch
of `selectResidentUnits`. Properties that make it safe to add:

- Absent and `null` are the same policy. The field is read nowhere else, so a
  caller that omits it gets the decision T003 froze, and the frozen thrash and
  cache-governance baselines stay green unchanged.
- The **camera reservation is exempt by construction**. It is decided first and
  `continue`s, so no radius, however small, can drop the unit the camera is
  standing in. That is the T009 F2 defect, and a radius must not reintroduce it.
- A unit that leaves the radius **falls through to the retained tier** and decays
  over `hysteresisDecisions`. Tightening the radius is a fade-out, not a cliff.
- The by-reference identity guarantee of `scheduleExteriorCells` /
  `scheduleExteriorCellsGlobally` is untouched: with `enabled: false` the
  caller's own array comes back, radius or not, and the test pins it with `toBe`.

`?exteriorDetailRadius=<metres>` carries it into a live session, beside
`?exteriorScheduler=on` and only ever beside it. It is a **measurement knob in
this cycle, not a shipped default**: the same build serves both A/B arms and only
the URL differs.

### 1.2 — PRE-REGISTERED CRITERION (a): which LOD transition the 2 % gate applies to

**The 2 % silhouette gate does NOT apply to the dense→V3 swap, and applying it
would be a pre-determined fail.** Two independent reasons, both committed before
this task began:

1. **It is not an eligible LOD transition under the frozen schema.** ADR 0040 D5
   records that the accepted overview candidate (c) — the committed dense
   shards — **declares no LODs at all**. The 2 % gate is defined over a pair of
   declared LODs of one asset. Dense-shard extrusion and V3 `lod_0` are two
   different *representations* produced by two different pipelines, not two LODs
   of one assembly, so the gate has no pair to compare.
2. **The arithmetic is already committed and already fails.** 51.81 % of the
   island exceeds 0.02 key deviation between the dense extrusion and V3 by
   committed arithmetic. Measuring a quantity whose answer is committed, and
   whose answer is "fail", is not a gate — it is a formality with a
   pre-determined outcome.

**What is measured instead:** the only eligible LOD transition in the shipping
composition — **Block 835 `lod_0` ↔ `lod_1` at 250 m**. That is a real pair of
declared LODs of one assembly, with a declared `maxDistanceMeters` threshold, and
it is the transition the 2 % gate was written for.

### 1.3 — PRE-REGISTERED CRITERION (b): the revival clause is void on the fidelity axis

Goal AC #4 keeps the per-cell coarse-GLB path alive as a conditional
mid-distance fallback, to be revived if the 1–3 km band fails acceptance. **On
the fidelity axis that clause is arithmetically void**, and ADR 0040 says so in
its own words (lines 309–312):

> the per-cell coarse GLB would be built by extruding the same sourced footprint
> to the same sourced height that the dense path already extrudes. **There is no
> fidelity argument**: it is the same representation, produced twice.

A representation identical to the one already shipping **cannot move any SSE or
legibility metric**. Reviving it on a fidelity finding would be incoherent.
Pre-registering "the band fails on fidelity → revive the coarse GLB" would be
pre-registering a conclusion that cannot follow from its premise.

**Revival is therefore pre-registered as a PERFORMANCE-axis condition only.**
The honest content of AC #4 is that the per-cell coarse GLB is a *pre-baked*
representation: its value is that it is not rebuilt, not that it looks different.
So the condition is about rebuild cost:

> **REVIVAL FIRES** if, at a measured band crossing, EITHER
>
>   - **(X)** the dense plan rebuild exceeds **8,000 ms** wall clock, OR
>   - **(Y)** the double-draw window — the interval during which the old
>     full-island dense layer and the new one are both in
>     `rootDenseCollection` — exceeds **4,000 ms**,
>
> **AND** neither can be fixed by an incremental dense-plan update (a targeted
> add/remove of the affected instances instead of a whole-island rebuild).

**Where X and Y come from.** Both are read off T004's committed baseline
(`data/citywide-overview-streaming-20260814/overview-probe.json`), not chosen for
roundness:

- The island plan builds 57,273 features in **478 chunks** of
  `DENSE_BUILD_CHUNK_SIZE = 120`. T004 measured `allocationMs` 131.4 ms and
  `totalBuildMs` 48.5 ms for a *settled* build, but those are the allocation and
  commit phases only; the observed wall clock for a full island refresh in the
  same record is `refreshMs` **1,358.7 ms** at the first island move. **X =
  8,000 ms** is ~6× that observed island refresh — a bar that a rebuild has to be
  badly pathological to cross, chosen deliberately high so that firing it means
  something.
- **Y = 4,000 ms** is half of X. The double-draw window is bounded above by the
  rebuild it brackets, so a threshold at half the rebuild bar means "the
  transient is not a brief artifact of a fast rebuild but the dominant part of a
  slow one".

**The AND clause is load-bearing.** The incremental dense-plan update is a known,
named, cheaper fix that attacks the same cost. Reviving a whole asset pipeline
without first establishing that the cheap fix cannot work would be reviving it
for the wrong reason.

### 1.4 — PRE-REGISTERED: what "no popping" is allowed to mean

The honest statement, fixed before capture:

> **"No popping" means: no double-draw and no island rebuild visible at a band
> crossing.**

Not "the stills look similar". Not "the diff is small". The check is a
consecutive-frame diff plus a settle series at t = 0/1/2/4/8 s at a recorded
crossing, each still reported beside the `planBuildCount` / `planCancellationCount`
/ `planSwapCount` that produced it.

**This statement is predicted to FAIL on current code**, and the prediction is
recorded here before the capture so that the failure is a measurement and not a
discovery. The mechanism, read out of `src/features/explorer/CesiumViewport.tsx`:

1. `shouldReplaceDenseRenderPlan` (line 730) is a **reference-sequence compare**:
   `previousFeatures.some((feature, index) => feature !== nextFeatures[index])`.
   One building entering or leaving the V3 overlay changes one element of
   `primitiveDenseFeatures`, which is enough.
2. A **new empty** `PrimitiveCollection` is added to the scene at line 1771,
   **before** any of its geometry exists.
3. The old layer is removed at line 1797, inside `commitDenseLayer`, which
   returns early at line 1796 until `pendingBuild.complete &&
   primitiveLayerReady(nextDenseLayer)`.
4. The V3 entity is added by the exterior pass of the **same** commit, which the
   code comment at line 1736 confirms runs *before* this continuation resumes.

So at every band crossing: the V3 entity appears immediately, the old
full-island dense layer keeps drawing that same building as an extrusion, and
both stay in the scene for the whole rebuild. **That is a multi-second
double-draw at every crossing, for a one-building change.**

### 1.5 — PRE-REGISTERED: the A/B design, and the trap it avoids

Four poses at 500 m / 1 km / 2 km / 3 km, byte-identical between arms except the
URL.

- **Arm (i)** — scheduler on, at the candidate radius.
- **Arm (ii)** — scheduler on, exterior overlay disabled (`exteriorStreaming=off`):
  the **dense-only** counterfactual.

**Arm (ii) is NOT flag-off.** Flag-off is the 484-artifact all-resident
composition, which has *more* V3 than arm (i), not less. An A/B whose "control"
has more of the thing under test measures nothing. The dense-only arm is the
honest counterfactual for "what does the detail radius buy".

**The honest rendered unit** is `exteriorSuppressedFeatureCount`
(= `exteriorRenderedCanonicalFeatureIds(...).size`, the canonical features that
are live V3 entities and are therefore suppressed from the dense pass) together
with `DenseRenderMetrics.buildingFeatureCount`. **Not** scheduled cell counts:
those describe residency intent, and §3.1 below records exactly how far intent
and reality diverge in this composition.

Per pose the capture records `SchedulerDecision.visibleCount` / `deferredCount` /
`reserved`, and **asserts `hold === "none"`** in every captured decision — a
held or bootstrap decision is a decision about a footprint the app did not
trust, and reporting one as evidence would be reporting the previous pose's
answer. `deferredCount > 0` is the only condition under which the 128 cap is
implicated at all; at near poses the footprint binds.

### 1.6 — PRE-REGISTERED: the served-bundle and external-host disciplines

The capture serves the **built bundle** (`pnpm build` → `vite preview`), records
the served bundle's own hash, and asserts **zero external hosts** in the network
log. A local-only release mode that reaches the network is a broken invariant,
not a slow session.

---

## Part 2 — the scheduled-11 / requested-0 explanation, established before the A/B

ADR 0041's committed opt-in evidence carries an unexplained pair: at
`block835-street-260m` with the scheduler on, wave
`manhattan-midtown-core-cells-20260811-v3` reports `scheduledCellCount: 11` and
`requestedArtifactCount: 0`. No A/B could be published without knowing whether
that is a scheduler defect or a data fact.

**It is a data fact, and it is the single most important thing this task found.**

Counted directly from the promoted composition's own committed cell releases
(`payload.buildingDetails[].status`, all six waves):

| wave | declared cells | cells with ≥1 `available` building | available buildings |
| --- | --- | --- | --- |
| `manhattan-exterior-cells-20260811-v3` (Block 835) | 1 | 1 | 14 |
| `manhattan-midtown-core-cells-20260811-v3` | 149 | **3** | 156 |
| `manhattan-lower-manhattan-cells-20260812-p1` | 126 | **2** | 71 |
| `manhattan-southern-remainder-cells-20260812-p1` | 176 | **4** | 179 |
| `manhattan-central-upper-manhattan-cells-20260812-p1` | 249 | **2** | 40 |
| `manhattan-northern-manhattan-cells-20260812-p1` | 182 | **1** | 24 |
| **total** | **883** | **13** | **484** |

The 484 canonical feature ids are **distinct** — no wave duplicates another's
building.

**The pipeline cause**, in one line of the runtime: a cell whose every owned
building is declared `unavailable` returns `kind: "not-shipped"` from
`ExteriorCellRuntime.loadCell` **before any fetch**, by design and with its own
comment ("It costs no request, no cache entry and no fallback"). 870 of the 883
declared cells are such cells.

So the pair resolves exactly:

- At the **street** pose the scheduler admitted 11 midtown cells, **none of which
  is one of the 3 that ship anything** → 0 artifacts. Correct behaviour, zero
  cost, no defect.
- At the **2,400 m overview** pose it admitted 96 midtown cells, which **do**
  include all 3 shipping cells → 156 artifacts, i.e. the wave's entire payload.
  The 53 cells the cap deferred there shipped nothing anyway.

This agrees with ADR 0040's corrected premise ("only 474 promoted asset entries
are committed"; the 44,295 figure is census-only retention with
`wave.retention: "census-only"` and `shippedAssetCount: 0`). The direct count
here is **484**, which matches ADR 0041's measured `requestedArtifactCount: 484`
and 490 GLB responses exactly; the 10-entry difference from ADR 0040's 474 is
**not resolved by this task** and is carried as a discrepancy in §4.

### What this does to the detail-radius question

It changes it. A detail radius exists to bound a cost that grows with distance.
In this composition the **entire V3 overlay is 484 buildings in 13 cells**, all
resident measures 484 cache entries / 122,601,292 B, and ADR 0042 already records
that neither cache ceiling binds anywhere in Manhattan. **There is no cost for a
radius to bound.** The radius is real, tested and ready; the corpus it would
govern is not there yet. §3 records what the captures then measured, and §4
records the verdict that follows.

---

## Part 2b — what the promoted composition means for the poses

Two consequences of §2 shape every number below, and both are properties of the
data rather than of the scheduler:

1. **The V3 overlay is small and coarse-grained.** 484 buildings in 13 cells,
   and those 13 are z14–z16 tiles up to ~2.2 km across. A radius measured to a
   rectangle's NEAREST EDGE therefore has very little to discriminate: a z14
   cell 2 km wide has its nearest edge inside 1.2 km from a great many camera
   positions.
2. **Fetched is not drawn.** At the 1 km pose 54 artifacts are fetched and only
   14 buildings are suppressed from the dense pass. The app says why, in its own
   notice: *"Exterior geometry for 40 verified buildings is not drawn: the
   matching base building record is not loaded, so there is no verified WGS84
   anchor for it."* That is the 40 central-upper assets. It is the reason
   `exteriorSuppressedFeatureCount` and not `requestedArtifactCount` is the
   honest rendered unit.

## Part 3 — measurements

Captured 2026-08-14 on the served bundle
`cd8920d38f36a5d8ccfbbae09afa05eae1373b84010836719585cf176fdd89dd`
(`data/transition-band-20260814/served-bundle.json`), Chrome 151 headless,
1440×900 @1, ANGLE/SwiftShader.

> **Environment label, applied to every millisecond below.** This is a SOFTWARE
> rasteriser. Frame times and build times are not reference-MacBook numbers and
> are not offered as any. What transfers is the ORDERING of events —
> `planBuildCount` advancing while `planSwapCount` does not — because that
> ordering is a property of the code, not of the renderer. Per ADR 0040 D7,
> decoded GPU bytes remain unobservable and nothing here claims them.

### 3.1 — The A/B (`data/transition-band-20260814/ab-evidence.json`)

Candidate radius **1,200 m**. Settle 45 s per capture. Each pose is a fresh tab.

| pose | arm | `hold` | visible | deferred | retained | resident | reserved | V3 drawn | dense buildings | artifacts | ext. hosts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 500 m | radius | `none` | 66 | **0** | 0 | 66 | 2 | **14** | 3,064 | 14 | none |
| 500 m | dense-only | — | — | — | — | — | — | **0** | 2,981 | 0 | none |
| 1 km | radius | `none` | 95 | **0** | 29 | 124 | 2 | **14** | 5,197 | 54 | none |
| 1 km | dense-only | — | — | — | — | — | — | **0** | 4,163 | 0 | none |
| 2 km | radius | `none` | 102 | **0** | 13 | 115 | 2 | **54** | 11,315 | 54 | none |
| 2 km | dense-only | — | — | — | — | — | — | **0** | 4,123 | 0 | none |
| 3 km | radius | `none` | **2** | **0** | 91 | 93 | 2 | **54** | 19,004 | 54 | none |
| 3 km | dense-only | — | — | — | — | — | — | **0** | 4,563 | 0 | none |

Six readings, in order of importance:

1. **`hold === "none"` in all four radius-arm decisions**, on `ground-rays`
   footprints. The pre-registered assertion holds; no captured decision is a
   held or bootstrap answer about a footprint the app did not trust.
2. **`deferredCount === 0` at ALL FOUR poses.** The 128 cap never binds
   anywhere in the near field. This is the pre-registered dead-end A, now
   measured rather than argued: the band edges cannot have influenced any of
   these decisions, because bands only decide who is cut and nothing was cut.
   **The footprint — and now the radius — is what binds.**
3. **The radius does bound residency, and the fade-out is visible in the data.**
   At 3 km the 1,200 m radius admits only the 2 reserved cells (`visibleCount`
   2) while 91 of the 93 resident cells are hysteresis-retained and decaying.
   That is exactly the designed behaviour — a tightening radius is a fade, not
   a cliff — captured live rather than only in a unit test.
4. **The camera reservation survives every pose** (`reserved` = 2 at all four),
   so no radius dropped the cell the camera stands in.
5. **Zero external hosts in every capture.** The local-only invariant holds.
6. **The A/B has a confound, and it is recorded rather than smoothed.** Arm (ii)
   is reached by `exteriorStreaming=off`, and `parseExteriorStreamingUrl`
   deliberately drops the scheduler flag for a session with no exterior wave.
   That also withdraws T004's citywide overview residency raise, so the
   `dense buildings` column is **not** comparable between arms — the radius arm
   is drawing more dense geometry because it has the raised budgets, not because
   of the radius. The comparable columns are `V3 drawn` (14/54 vs 0) and the
   artifact/host columns. **A clean dense-only arm at the raised budgets is not
   reachable from the shipping URL contract**, and building one would mean
   decoupling the flag from the overlay — a behaviour change outside this
   cycle's frozen scope. It is handed to T006 with the default flip, where the
   flag stops being the discriminator anyway.

### 3.2 — The transition artifact (`data/transition-band-20260814/crossing-evidence.json`)

One crossing, driven by **six real 180 px left-drags in ONE document**. (The
first attempt drove the crossing with a URL change; that is a full page reload
which destroys the execution context, so it measures a boot and not a
transition. The finding is recorded because the mistake is easy to repeat.)

| moment | t from drag start | `planBuildCount` | `planSwapCount` | `planCancellationCount` | plan fingerprint | frame diff vs before |
| --- | --- | --- | --- | --- | --- | --- |
| before | — | 6 | 1 | 5 | `5496:e3cb3f75` | — |
| frame #0 | 6,238 ms | 6 | 1 | 5 | `5496:e3cb3f75` | 0.4750 |
| frame #1 | 6,818 ms | **8** | **1** | **6** | `4803:519ed533` | 0.4750 |
| frame #2 | 7,455 ms | 8 | 1 | 6 | `4803:519ed533` | 0.4780 |
| frame #3 | 8,244 ms | 8 | 1 | 6 | `4803:519ed533` | 0.4780 |
| settle t=0 s | 8,968 ms | 8 | **1** | 6 | `4803:519ed533` | 0.4780 |
| settle t=1 s | 9,639 ms | 8 | **1** | 6 | `4803:519ed533` | 0.4780 |
| settle t=2 s | 10,322 ms | 8 | **2** | 6 | `4803:519ed533` | 0.4780 |
| settle t=4 s | 11,086 ms | 8 | 2 | 6 | `4803:519ed533` | **0.3043** |
| settle t=8 s | 11,758 ms | 8 | 2 | 6 | `4803:519ed533` | 0.3043 |

`hold === "none"` and `deferredCount === 0` at every settle sample. Zero
external hosts.

**The double-draw window, read off the counters.** The new plan starts between
frame #0 and frame #1 (`planBuildCount` 6→8, fingerprint changes), and the swap
completes between the t=1 s and t=2 s samples (`planSwapCount` 1→2). So the
window during which the old full-island layer and the new partial one were both
in `rootDenseCollection` is bounded by

  [9,639 − 6,818, 10,322 − 6,238] = **[2,821 ms, 4,084 ms]**,

and the renderer's own `totalBuildMs` for the committed build — **3,557.9 ms** —
sits inside that interval and is the point estimate.

**And the frame really does change after the interaction ends.** The pixel diff
holds at 0.478 through the whole window and then drops to 0.304 at t = 4 s:
`differenceFromPrevious` = **0.2176**, i.e. **21.8 % of the frame changed ~4
seconds after the user stopped dragging**. That is not an antialiasing wobble.
It is the island being redrawn.

**Six builds and five cancellations before the crossing even started.** The
`before` state already reads `planBuildCount: 6, planSwapCount: 1,
planCancellationCount: 5`: bootstrapping this session threw away five dense
plans to commit one.

**The deterministic half of the same finding** is
`CesiumViewport.test.ts` → *"rebuilds the whole dense plan when exactly one of
45,154 features changes"*: `shouldReplaceDenseRenderPlan` returns `true` for an
array differing in one element, and also for one whose element is replaced by an
equal-but-not-identical object. One building entering or leaving the V3 overlay
is sufficient. The browser measured what that costs; the test pins that it is
what happens.

**Memory at the crossing — arithmetic, labelled (ADR 0040 D7).** ADR 0043's
committed figure: ≈ 97 MB decoded GPU-side for one island layer, and "the layer
swap holds the old and new layers simultaneously, so the transient is ≈ 190 MB".
What this task adds is the **frequency**: ADR 0043's swap happened when the
resident SHARD set changed; a detail radius makes the plan change whenever a
BUILDING crosses the radius, so the ≈ 190 MB dual-layer transient becomes a
**per-crossing** cost rather than a per-shard-set-change one. No GPU byte was
measured; this is arithmetic over a committed arithmetic.

### 3.3 — The 2 % gate, applied to the transition it actually covers

Per pre-registered criterion (a), measured on **Block 835 `lod_0` ↔ `lod_1` at
250 m** — the only eligible LOD transition in the shipping composition. Block
835's assembly declares exactly `lod_0` (geometric error 0 m,
`maxDistanceMeters` 250) and `lod_1` (0.2 m, unbounded) for all 14 assets.

The gate is `projected-silhouette-ratio` v1 over four azimuths
(`view:east/north/south/west`) against `maximumRatio: 0.02`, and it is enforced
by `validateMultiLodAssembly` at release time, so these are checksum-pinned
declarations and not a fresh measurement by this task:

| statistic | deviation ratio | against the 2 % bar |
| --- | --- | --- |
| worst (`doitt:925937`) | **0.001834** | **10.9× inside** |
| mean over 14 assets | 0.000721 | 27.7× inside |
| best (`doitt:102705`, `doitt:262867`) | 0.000000 | — |

**PASS, with an order of magnitude of margin.** All 14 assets are inside the bar.

For contrast, and confirming why the dense→V3 swap was excluded: ADR 0040
measured the prism-vs-V3 comparison — which is precisely the dense→V3 pair,
because the dense shards draw the same prism — and recorded *"Silhouette
`maximumRatio` 0.02 — EXEMPT for 22,969 of 44,330 assets (51.81 %). Measured,
not asserted."* Applying the gate there would have been a pre-determined fail.

### 3.4 — Rendered stills, and what they are worth

`data/transition-band-20260814/captures/` holds all 8 pose stills, 4 consecutive
crossing frames, the 5 settle-series stills, and before/after.

**Honest limit.** The stills are headless-SwiftShader renders at a near-top-down
framing over an imagery-free globe, so V3 textured roofs are distinguishable
from plain dense extrusions but building SIDES largely are not. They are
adequate as evidence of *what is drawn*, and they are the source of the pixel
diffs above, which are quantitative. They are **not** adequate as a subjective
"does it look right" judgement, and the verdict below does not rest on one.

## Part 4 — the verdict

### 4.1 — The no-popping check: **FAILS, exactly as pre-registered**

The pre-registered statement was "no double-draw and no island rebuild visible
at a band crossing". Both halves fail:

- **Double-draw:** measured window **[2,821 ms, 4,084 ms]**, point estimate
  **3,557.9 ms**, with `planBuildCount` advanced and `planSwapCount` unmoved
  across four consecutive frames and two settle samples.
- **Island rebuild visible:** **21.8 % of the frame changed at t = 4 s**, after
  the drag had ended.

This is a **measured defect of the current renderer**, not a defect of the
detail radius, and not a reason to reject the radius. The radius is what makes
the crossing happen at a chosen distance instead of an arbitrary one; the cost
of the crossing is owned by `shouldReplaceDenseRenderPlan`.

**The named prerequisite for T006 is the incremental dense-plan update.** A
crossing changes one building's owner. The renderer's answer is to rebuild all
of them. Until that is an add/remove against the live layer, every crossing —
and therefore every default session that streams — pays a multi-second
double-draw. **T006 must not flip the default before this is fixed.**

### 4.2 — The revival clause: **DOES NOT FIRE**

Against the criteria pre-registered in §1.3, before any capture:

| condition | bar | measured | fires? |
| --- | --- | --- | --- |
| (X) dense plan rebuild at a crossing | > 8,000 ms | **3,557.9 ms** | **no** |
| (Y) double-draw window | > 4,000 ms | **3,557.9 ms** (interval ≤ 4,084 ms) | **no** |
| AND not fixable incrementally | — | an incremental update is a named, un-attempted, strictly cheaper fix | **no** |

**Recorded verdict: the per-cell coarse-GLB revival does NOT fire.** All three
legs fail, and the third would defeat it alone.

Two honesty notes that do not change the verdict:

- **Y is under its bar by 11 %.** 3,557.9 ms against 4,000 ms is not a
  comfortable pass, and the measured interval's upper bound (4,084 ms) is above
  the bar outright. The verdict rests on the point estimate and on the AND
  clause.
- **This crossing rebuilt 5,496 features in 46 chunks, not the island's 57,273
  in 478.** The same pose set measured boot builds of 18,026 ms (2 km, 133
  chunks) and 27,552 ms (3 km, 212 chunks) in this environment. A crossing at
  island scale would plausibly exceed X — but **this task did not measure one**,
  and per the D7 discipline a plausible number is not a measured one. If T006's
  campaign measures an island-scale crossing above 8,000 ms, condition (X) is
  met and the revival question returns — still gated by the AND clause, which
  the incremental update is expected to settle.

### 4.3 — The detail radius: recommended value

**Recommendation for T006's default flip: keep `maxUnitDistanceMeters` at
`null`, and do not ship a detail radius in this composition.**

The reasoning is the arithmetic in §2, confirmed by §3.1:

1. **There is no cost to bound.** The whole V3 overlay is 484 buildings in 13
   cells. Wholly resident it measures 484 cache entries / 122,601,292 B, and
   ADR 0042 already records that neither cache ceiling binds at any camera in
   Manhattan. `deferredCount` was **0 at all four poses**: nothing was refused
   for want of budget.
2. **The knob barely discriminates at this granularity.** The 13 shipping cells
   are z14–z16 tiles up to ~2.2 km across, and the metric is nearest-edge
   distance. A 1,200 m radius admitted or refused whole multi-kilometre tiles.
3. **It costs crossings, and crossings are currently expensive.** Every radius
   boundary is a place where §3.2's multi-second double-draw fires. Adding
   crossings before the incremental dense-plan update exists is adding cost for
   no measured benefit.
4. **It is ready when there is something to bound.** The field, its tests, its
   URL parameter, its fade-out behaviour and its reservation exemption are all
   in place and measured. When a wave ships its full census (the ADR 0040
   `census-only` retention reversed), the radius is one URL parameter away from
   being measurable again, and §3.1's table is the baseline to compare against.

**If T006 nonetheless needs a radius**, 1,200 m is the value with evidence
behind it: it is the near edge of ADR 0040's measured 1.2–2.4 km transition band
(p95 SSE crossing one pixel at ~2.4 km, median at ~1.2 km), it is the value the
§3.1 table was captured at, and at that value the camera reservation, the
hysteresis fade and `hold === "none"` were all confirmed live.

## Part 5 — deferred by number

- **D-1 (from ADR 0041/0043 C-1): the `refreshViewport` → `selectResidentUnits`
  refactor is RETIRED, not deferred again.** ADR 0043 handed it here with its
  own retirement condition: *"should be retired outright there unless the
  near-field band needs a mixed unit list."* The near-field band does not need
  one. This cycle's lever is a scalar bound inside the existing cell decision;
  nothing in §3 required ranking cells and shards in one pool, and no
  measurement was blocked by their being separate. Retired with that reason
  recorded. Reviving it needs a new finding, not this obligation.
- **D-2: the incremental dense-plan update → T006, as a NAMED PREREQUISITE of
  the default flip** (§4.1). Not attempted here: it is not trivial (it needs
  per-instance add/remove against a live `PrimitiveCollection` plus the
  cancellation and generation guards that the current whole-layer swap gets for
  free), and attempting it inside a measurement cycle would have meant measuring
  a renderer this task had just changed.
- **D-3: the deferred/evicted fallback-notice wording → T006**, unchanged from
  ADR 0043. §3.4's stills show the notice reading *"121 of 123 exterior cells
  ship no exterior geometry in this build (by design; no substitute was
  selected)"*, which is accurate but reports a data fact in the register of a
  fault.
- **D-4: the ADR 0042 band-internal ranking finding is NOT taken here.** The
  committed test *"FINDING for T005: band-internal ranking prefers wave order
  over distance"* still documents current behaviour and still passes. Two
  reasons it is not this cycle's lever: it changes `compareRanked`, which both
  frozen thrash baselines were measured against; and §3.1 shows it is
  **unreachable in the near field**, because band-internal ranking only decides
  who is cut and `deferredCount` was 0 at every pose. It matters where the cap
  binds — an island-overview concern — and belongs with T006's campaign.
- **D-5: a clean dense-only arm at the raised citywide budgets** (§3.1 reading
  6) → T006.
- **D-6: the React harness was NOT taken.** ADR 0043's condition was that it is
  needed only if a cycle changes the cell-loading effect's call order. This
  cycle does not: the radius is one more field on the input object that
  `scheduleExteriorCellsGlobally` already received, and the effect's dependency
  array, abort test and reconciliation are untouched.
- **D-7: the 100 %-of-the-island viewpoint search stays out of the pose set.**
  It is a framing question about the overview tier and is orthogonal to a
  near-field radius.
- **D-8: the 484 / 474 discrepancy is UNRESOLVED.** This task counted 484
  distinct available buildings across the six promoted waves' committed cell
  releases, matching ADR 0041's measured `requestedArtifactCount: 484` and 490
  GLB responses. ADR 0040 states *"only 474 promoted asset entries are
  committed"*. The 10-entry difference is not explained here and is carried as a
  discrepancy rather than silently reconciled to whichever number is convenient.

## Part 6 — drift notes

- **`maxUnitDistanceMeters` is optional and unread by default.** No committed
  policy sets it. `EXTERIOR_CELL_SCHEDULER_POLICY` and
  `EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY` are byte-identical to T003's, the
  thrash and cache-governance baselines pass unchanged, and
  `emit-citywide-overview-cell-extents.mjs --check` reports the 883-cell census
  up to date at its committed digest.
- **`exteriorSuppressedFeatureCount` is additive telemetry.** It is
  `exteriorRenderedCanonicalFeatureIds(...).size`, published through the
  existing `DenseRenderMetrics` channel and read by the diagnostics and the
  probe. It is included in `publishCitywideDenseMetrics`'s equality check
  because a building entering or leaving the V3 overlay moves only that field
  until the plan rebuilds.
- **`?exteriorDetailRadius` writes nothing when absent.** A default session's
  URL is character-identical to what it was before this parameter existed, and
  the parameter is deleted whenever the scheduler flag is.

## Rollback

Delete `SchedulerPolicy.maxUnitDistanceMeters` and its one use in the
footprint-intersection branch, `ExteriorCellScheduleInput.maxUnitDistanceMeters`
and its two pass-throughs, and the `exteriorDetailRadius` URL member. Nothing
else reads any of them. The default path never did.
