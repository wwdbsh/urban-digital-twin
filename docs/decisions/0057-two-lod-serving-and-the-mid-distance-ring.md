# Decision 0057: two-LOD serving, the mid-distance ring, and the default selection semantics

Date: 2026-08-17

Status: **pre-registration accepted 2026-08-17, before any capture and before
any `-s2` release was assembled.** Parts 1–4 were written and committed first.
The measured verdict is appended by T007.

Task: T001 of goal `manhattan-hlod-far-tier` (Issue #101). Contract hash
`d29ffdca04143977d567d48b8ccc263149358a2e32b89cae394450a6dc05e540`.

No release was assembled and no frozen byte changed by the commit that
introduced this document.

---

## Part 0 — the correction this ADR exists to record

The task's binding plan carried a correction (#1) which said: encode the tier in
the release thresholds, `lod_0` bounded and `lod_1` unbounded, and the default
session will serve `lod_0` near and `lod_1` beyond.

**That is not what the code does, and the plan was corrected against the code
rather than the code against the plan.**

`DEFAULT_EXTERIOR_RENDER_PROFILE` is `exploration`
(`src/runtime/exterior-render-profiles.ts:10`), and `exploration` selects the
COARSEST eligible level that covers the distance. Executed against the real
`selectExteriorLod`:

```
PLAN SHAPE  lod_0=1200, lod_1=null | exploration -> 100m:lod_1  500m:lod_1  1200m:lod_1  5000m:lod_1
PLAN SHAPE  lod_0=1200, lod_1=null | inspection  -> 100m:lod_0  500m:lod_0  1200m:lod_0  5000m:lod_1
```

The prescribed threshold shape puts `lod_1` — the protrusion-SHED level — in
front of the camera at 100 m. It is not a ring; it is the near field getting
coarser, which is the opposite of the contract.

The impossibility is exhaustive rather than incidental. `covers()` is an upper
bound only (`exterior-render-profiles.ts:44`), `isMonotoneAssemblyLodOrder`
forces `lod_1`'s threshold to be ≥ `lod_0`'s, and `exploration` returns the
finest member of the coarsest DISTINGUISHED group. With two levels there are
only two reachable behaviours: thresholds differ, so `lod_1` is coarsest and
always covers → `lod_1` everywhere; or thresholds tie → `lod_0` everywhere.
Neither is a ring. `AssemblyLod` has no near bound, so "`lod_1` only beyond X"
is inexpressible under a coarsest-preferring profile.

**Adjudicated resolution: the DEFAULT SELECTION SEMANTICS move to
finest-that-covers; the tier stays encoded in release thresholds.** The
alternatives were considered and rejected on the record:

- **Add `minDistanceMeters` to `AssemblyLod`.** Rejected for schema blast
  radius: the assembly schema, its validator and every committed release record
  would move to express one tier boundary.
- **Choose the profile per cell at the LOD call site.** Rejected as the
  two-authorities defect: LOD choice would then be decided in two places that
  can disagree, and a cell could flip its authority mid-session.

Recording this matters because the first plan's premise was reasonable and
wrong, and a successor reading only the outcome would assume the selector always
preferred the fine level.

---

## Part 1 — the threshold, derived

### 1.1 What the threshold is measured against

Correction #2 stands and is a precondition, not a detail. `App.tsx:1771` feeds
the selector `Math.max(50, Math.round(height / 100) * 100)` — a bucketed camera
ELLIPSOID HEIGHT. A threshold compared against a height is not a ring: it says
"how high is the camera", not "how far is this building". The selector must be
fed the scheduler's own per-cell camera-to-cell distance
(`exterior-visibility-scheduler.ts:466`) before any threshold means anything.

### 1.2 Why the distance-band edges are NOT the anchor

Correction #1 suggested deriving the boundary from the scheduler's
`distanceBandEdgesMeters` of `[1_200, 2_400]`. ADR 0044 §1.1 already recorded
why that lever is a dead end: **the band edges are sort keys, not admission
tests.** `bandIndexOf` feeds `compareRanked` and nothing else; admission is a
footprint intersection with no distance term. They also sit at the wrong scale —
see the arithmetic below, where a 1,200 m boundary yields a mid ring containing
**zero** resident cells.

### 1.3 The geometry, from the committed extents census

883 cells, measured from `CITYWIDE_OVERVIEW_CELL_EXTENTS`:

| quantity | median | p95 | max |
| --- | --- | --- | --- |
| cell width | 258.2 m | | |
| cell height | 184.8 m | | |
| cell diagonal | 316.5 m | | |
| distance to 1st-nearest cell centre | 152 m | 497 m | 1,220 m |
| distance to 3rd-nearest cell centre | 234 m | 550 m | 1,675 m |
| distance to 8th-nearest cell centre | 361 m | 833 m | 2,905 m |

### 1.4 The rule, and the rounding convention named as one

**The near ring is the camera's own cell plus its adjacent ring.** The adjacent
ring's outer edge sits one cell diagonal from the camera cell's centre: a median
of **316.5 m**. Rounded UP to the next 100 m — a stated convention, the same one
ADR 0041 used for 128, and not a measurement —

> **THRESHOLD = 400 m.** `-s2` declares `lod_0` `maxDistanceMeters: 400` and
> `lod_1` `maxDistanceMeters: null`.

### 1.5 The honest limitation

A threshold is a distance, not a topology. At the p95 anchor the 3rd-nearest
cell centre is 550 m away, so where the island's cells are sparse — its edges —
the first neighbour ring falls OUTSIDE 400 m and serves `lod_1`. This is stated
rather than engineered away: making the near ring topological would require the
selector to know the cell graph, which is a larger change than this tier is
worth. T007 captures a sparse-edge pose specifically to show what it looks like.

### 1.6 The exception, unchanged

The **424 measured-fallback parents** (ADR 0050) keep `lod_0`
`maxDistanceMeters: null` and `lod_1` `eligible: false`. Bounding their `lod_0`
would leave them resolving NOTHING beyond 400 m — `lod-unavailable`, a blank
building. `exterior-two-lod-selection.test.ts` pins that this shape resolves
`lod_0` at every distance under BOTH profiles, before and after the flip.

---

## Part 2 — the flip is a no-op for the city as it ships today, proven

The tie-rule docblock argued its own safety with the sentence "the serving
releases this goal emits are single-LOD by construction". That sentence is false
the moment `-s2` exists, so it cannot keep carrying the argument. It is replaced
by the property it was gesturing at:

> For any LOD list in which no two ELIGIBLE levels are DISTINGUISHED by their
> declared `maxDistanceMeters`, every profile resolves the same level at every
> distance.

Every shape the promoted city serves today satisfies the antecedent:

| shape | where | why the profiles agree |
| --- | --- | --- |
| single-LOD, `shippedLodIds: ["lod_0"]` | all six `-s1` serving releases | one candidate; nothing to prefer |
| null-at-both | all `-c1`/`-c2` retained packages, 44,989 buildings | one tie; the tie rule sends both profiles to the finest |
| `lod_0` null + `lod_1` ineligible | the 424 fallback parents | one eligible candidate |

`src/runtime/exterior-two-lod-selection.test.ts` pins all three at thirteen
distances under both profiles, **and pins the antecedent itself**, so a future
frozen shape that distinguished its levels would fail here rather than silently
change what a promoted session renders.

**The tie rule is unchanged and remains correct.** Ties→finest was never the
problem; the coarsest-preference was.

### 2.1 Block 835, the one release whose behaviour DOES change

Block 835 declares 250 m on `lod_0` and unbounded on `lod_1` — the only promoted
release with two DISTINGUISHED levels. Under the old default it served `lod_1`
everywhere; under the new default it serves `lod_0` within 250 m and `lod_1`
beyond. **This is the classically correct direction** and it is a real change.

Treatment, per the forward-annotation discipline: the frozen L1 and serving
records are NOT rewritten. They remain a true record of what was measured under
the then-default. A forward note is added there and here, and T007 captures the
new behaviour at a pre-registered Block 835 pose. The release is reachable only
by explicit deep link, not by default serving, which is why this is an
annotation rather than a re-measurement of a promoted default.

### 2.2 Mobile

`App.tsx:611` pins mobile to `exploration`. That clamp was a performance policy
written when serving was single-LOD, which made it **vacuous** — it selected the
same level either way, as Part 2 proves. Under two-LOD serving it would stop
being vacuous and start forcing shed geometry at street level on exactly the
devices least able to hide it. Mobile therefore follows the new default.

The frame-time consequence is NOT claimed here. T007's campaign owns the mobile
measurement, and `exploration` remains the documented fallback arm if T007
measures a miss.

---

## Part 3 — the budgets, re-derived

All figures computed in code from the committed inventories, the committed
ownership ledger and the committed extents census — no payload directory
required. Three bounds, the same idiom as `exterior-serving-residency.ts`.

### 3.1 What two-LOD serving costs, per building

| level | source | island bytes | mean/asset |
| --- | --- | --- | --- |
| `lod_0` | `-c1` | 4,679,223,068 | 104,008 B |
| `lod_1` textured | `-c2` | 2,120,167,144 | 47,126 B |

**`lod_1` is 45.31% of `lod_0`.** The mid ring is a byte SAVING, not a cost. The
cache holds one level per building — `selectExteriorLod` picks one and only that
artifact is fetched — so entries are unchanged at one per building.

### 3.2 The reachable bound, at the live cap of 8

Worst `cap`-cell neighbourhood over every one of the 883 anchors:

| threshold | bytes | % of 256 MiB | entries | % of 1,024 | mid cells of 8 |
| --- | --- | --- | --- | --- | --- |
| `lod_0` only (today) | 247,000,877 | 92.0% | 599 | 58.5% | 0 |
| 1,200 m | 247,000,877 | 92.0% | 599 | 58.5% | **0** |
| 800 m | 247,000,877 | 92.0% | 599 | 58.5% | **0** |
| 600 m | 247,000,877 | 92.0% | 599 | 58.5% | **0** |
| **400 m** | **158,382,700** | **59.0%** | **676** | **66.0%** | **5** |
| 300 m | 123,910,336 | 46.2% | 676 | 66.0% | 7 |

**The resident radius at cap 8 is 546 m.** Any threshold at or above it produces
a mid ring with no resident cells in it — the contract outcome would be
unobservable, not merely small. This is the arithmetic that rules out the band
edges.

At 400 m the byte pressure that forced `maxResidentUnits` down to 8 **falls from
92.0% to 59.0%**.

### 3.3 The binding constraint, stated honestly

Correction #3 anticipated that entries would bind and that a
`maxCacheEntries` raise (1,024 → ?) would be the recorded contract change.
**At the unchanged resident cap of 8 that raise is not needed, and it is not
taken.** Both caps fit with wide headroom, and the goal's own change relieves the
constraint that was actually binding.

The raise WOULD be needed if `maxResidentUnits` rose, and the arithmetic is
recorded here so a successor does not re-derive it:

| resident cap | threshold | bytes | % of 256 MiB | entries | % of 1,024 | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| 12 | 400 m | 200,870,287 | 74.8% | 953 | 93.1% | fits, entries tight |
| 16 | 400 m | 241,108,434 | 89.8% | 1,186 | 115.8% | **entries bind**; needs 2,048 |
| 24 | 400 m | 269,588,238 | 100.4% | 1,518 | 148.2% | **bytes bind** — refused, cap immutable |

So correction #3's premise is vindicated as a CONDITIONAL: past a resident cap
of 12, entries bind before bytes do. `maxResidentUnits` stays at 8 in this task;
raising it is a separate recorded contract change with its own measurement, and
ADR 0052 §3's sizing argument would have to be re-argued at the new composition.

`maxCachedBytes` remains 256 MiB, unchanged and immutable — closed prior-goal
criterion #30.

### 3.4 The modelled bound that does not bind

The `cap` heaviest cells anywhere on the island remain MODELLED and UNREACHABLE
for the same reason `exterior-serving-residency.ts` records: they are scattered
across six waves and several kilometres and no camera admits them together.

---

## Part 4 — pre-registration

### 4.1 D-11: what counts as amplification

Registered BEFORE any capture, because the reading is otherwise decidable after
the fact.

A cell crossing the 400 m boundary re-fetches its buildings at the other level.
Eviction is recency-only with no per-wave reservation (ADR 0030), so the level it
is leaving stays cached until it is evicted.

> **AMPLIFICATION** is a reading in which ONE cell's TWO levels are
> simultaneously resident.
>
> **CARRY-FORWARD** is a reading in which the cache holds a level for a cell that
> is no longer resident. Carry-forward is the eviction policy working as
> disclosed and is NOT amplification.

The distinction is the cell's residency, not the byte count, and it is decided
per reading rather than per session.

**The modelled ceiling, stated so nobody re-derives it:** every resident cell
holding both levels at once is 338,182,457 B (126.0% of the byte cap) and 1,182
entries (115.4% of the entry cap), at anchor
`manhattan-exterior-cell-w01-000037-16-19300-17928`. It is MODELLED and not
reachable by translation: the 8 resident cells sit at distinct distances spread
over 0–546 m and a single threshold crosses them one at a time.

**The registered allowance, which is the falsifiable part:**

> Steady state at cap 8 / 400 m leaves 110,052,756 B and 348 entries of
> headroom. The mean resident cell's second level costs 22,474,970 B and 82.5
> entries. **Up to 4 of the 8 resident cells may hold both levels simultaneously
> before either cap binds** — 4.90 cells on bytes, 4.22 on entries.
>
> A capture showing ≤ 4 doubled cells is WITHIN the registered bound. A capture
> showing ≥ 5 is an EXCEEDANCE and must be reported as one, whether or not the
> caps were observed to hold.

Because the caps are enforced by eviction, an exceedance does not appear as
overflow. Its observable symptom is eviction churn and re-entry, which is what
T007 must count. Carrying `7,122.2 ms` forward as the bounds-rebuild double-draw
figure is a CARRY-FORWARD reading unless the cell that rebuilt was resident at
both levels at the moment of the reading.

### 4.2 Poses, registered before capture

Six default-session poses. Every one is a fresh tab; no pose is captured twice
into the same evidence row.

| # | pose | registered gate |
| --- | --- | --- |
| P1 | street level, dense midtown, camera inside a cell | camera's own cell and its adjacent ring draw `lod_0`; no shed silhouette in the near field |
| P2 | 400 m boundary straddle, dense midtown | at least one cell each side; the near side `lod_0`, the far side `lod_1` |
| P3 | mid ring, dense midtown, camera above 400 m from every resident cell | every resident cell draws `lod_1`; zero fallback-to-massing |
| P4 | sparse island edge (§1.5 limitation) | records what the sparse-edge first ring does; **no pass/fail** — this pose exists to show the limitation, not to gate it |
| P5 | a cell containing measured-fallback parents (w03 carries 289 of the 424) | fallback parents draw `lod_0` at range while their neighbours draw `lod_1` |
| P6 | Block 835 by explicit deep link (§2.1) | draws `lod_0` within 250 m where it previously drew `lod_1`; recorded as a forward annotation |

**Gates that apply to every pose:** zero failed cells, zero fallback-to-massing
regressions, request concurrency ≤ 4 + 4, and byte-identical re-entry.

**T009 handoff (correction #9):** the 5 shed-tone residual pairs named in ADR
0056 are owned by T006. If one lands in a captured pose its appearance is
RECORDED and NOT judged, and it does not gate any pose here.

---

## Part 4.3 — what the capture returned

Added 2026-08-18, after the six registered poses were captured against the
promoted `-s2` composition and after P2 and P3 were re-taken under the
instrument-defect convention. Evidence:
`data/exterior-two-lod-serving-20260818/pose-captures.json`.

**Universal gates PASS at all six poses**: zero failed cells, zero
fallback-to-massing, zero failed artifacts, peak concurrency 4 against a ceiling
of 4, zero external hosts.

| pose | registered gate | result |
| --- | --- | --- |
| P1 street 180 m | finest level resolves close in | **WEAK** — few resident cells at this height; recorded as captured, not argued up |
| P2 400 m straddle | named cells both sides of the ring; crossing is a reload | **PROVEN (straddle)**, after a re-capture — see below |
| P3 mid ring 1,100 m | coarse level dominates | **PASS** — 61 distinct `lod_1` against 3 `lod_0` |
| P4 sparse island edge | ungated (section 1.5 limitation) | records only |
| P5 w03 measured-fallback parents | fallback parents resolve | **PASS** |
| P6 Block 835 deep link | the one release whose behaviour changes | **PASS** |

### P2 has TWO readings, and both are on the record

The first capture recorded **zero** resident cells and **zero** per-cell
distances at all six poses. The probe payload never carried `residentUnitIds` or
`distanceMetersByUnitId`, and the latter is a `Map`, which `JSON.stringify`
renders as `{}` even when present. That is an INSTRUMENT defect, not a finding
about the scheduler — the request-level LOD readings in the same captures show it
resolving cells throughout.

P2 and P3 were re-taken under the **instrument-defect re-run** convention, single
attempt, with the four unaffected poses left alone. The defective zero reading is
retained under `instrumentDefectAndReRun.supersededReadings`; the drift test pins
**both**.

**The straddle is now PROVEN.** At P2, 8 resident cells split **6 at or below**
400 m and **2 above**. The nearest below is
`manhattan-exterior-cell-w01-000051-16-19301-17930` at 207.96 m; the nearest
above is `manhattan-exterior-cell-w00-000000-block-00835` at 886.02 m.

**Crossing-is-reload is proven at BUILDING granularity and refused at cell
granularity.** 15 buildings were fetched as `__lod_0.glb` at P2 and as
`__lod_1.glb` at P3 — the same building, re-loaded at the other level once the
camera moved out. What was *not* observed is a **cell** changing ring side: only
3 cells are resident at both poses and all three stayed on the same side. The
building-level evidence stands on its own; the cell-level claim does not, and is
not made.

One metric caveat, because it would otherwise be over-read:
`distanceMetersByUnitId` is a **ground-plane** distance from the camera ground
point. At P3, 1,100 m up, it still reports 6 cells at or below 400 m. It must not
be read as the quantity that routes the level — the LOD request sets are that
evidence.

### 4.3.1 D-11 disposition — WITHIN ALLOWANCE

Section 4.1 registered an allowance of **4 of 8** resident cells holding both
levels at once. Measured: **3 buildings** held both levels at P2 and **3** at P3,
against 8 resident cells at each. Those buildings sit in at most 3 cells, so
cells-holding-both is **at most 3 against an allowance of 4**.

The reading is per **building**, because the request log is per building; the
cell figure is therefore an upper bound rather than a direct count. It is under
the allowance either way, so the bound does not need tightening to reach the
disposition.

### 4.3.2 Instrument coverage

| claim | how it is covered |
| --- | --- |
| threshold arithmetic, band edges, rounding | **suite-covered** — deterministic tests |
| per-building byte cost, budget inversion | **suite-covered** |
| finest-that-covers routing per cell | **suite-covered** |
| revert is one unit, both directions | **suite-covered**, rehearsed at `c2a07ce` |
| universal gates under a real browser | **live** — six poses |
| which level a document actually fetched | **live**, request-level only |
| ring-side membership per named cell | **live**, P2/P3 only, after the instrument fix |
| what a building LOOKS like at any ring | **not covered by anything here** |

The last row is the honest boundary of the whole part: every live reading is a
request or a counter. No pose claims a building looks coarse, and none can.

### 4.3.3 T009 shed pairs

The five T009 shed pairs named in ADR 0056 were not identified in the
re-captured poses' request sets, and no appearance claim is made about them here.
Their treatment is T009's.

---

## Part 5 — what this ADR does not claim

- No visual, geographic, architectural, accessibility or performance acceptance.
  The threshold is derived from cell geometry and byte arithmetic; whether 400 m
  reads correctly on screen is T007's measurement, not this document's claim.
- No frame-time claim, on desktop or mobile.
- Nothing about the far-tier bake (T002+) or the rendered 2% gate (T006).
- No claim about decoded GPU memory, which is not observable from the loader.

## Frozen records and the promotion that moved past them

The promoted default moved past the committed goal-integration reconciliation
(`data/goal-integration-acceptance-20260812/`) and the Northern-Manhattan P1
acceptance evidence in T001; their tests assert the historical composition per
the curated-comparison precedent (`computePromotedCoverage` over the
composition each record describes, read off the predecessor chain — now two
links down: `-s2` -> `-s1` -> curated). No frozen record was edited.

Two module-shape corrections landed with the promotion commit rather than
after it: the six `*_TWO_LOD_ROLLBACK` constants originally spread the `-s2`
activation itself (a record that would restore the very release it refuses —
not a rollback); they now spread the `-s1` predecessor record with the `-s2`
release withdrawn, the same shape every `-s1` rollback uses. The `-s2` pin
derivation in `App.tsx` consequently moved from the rollback list to the
promoted set itself. Parameterless defaults of the single-record activation
helpers moved from the `-s1` record to the promoted two-LOD record.
