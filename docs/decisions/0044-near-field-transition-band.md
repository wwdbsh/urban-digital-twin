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
