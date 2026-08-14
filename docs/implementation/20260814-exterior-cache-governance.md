# T003 — byte-governed exterior cache residency with proven eviction correctness

Task: T003, Issue #68, goal `manhattan-citywide-default-streaming`.
Branch `fcp/68-cache-governance`, from `7e44b4d` (= `main`, T002).
Decision record: [ADR 0042](../decisions/0042-exterior-cache-governance.md).

Nothing was published, deployed, promoted or acquired. No release was assembled,
no wave was materialized, and **no runtime budget constant changed**.

## What shipped

| area | file | change |
| --- | --- | --- |
| release seam | `src/runtime/exterior-cache-release.ts` (new) | pure four-gate release planner; plan/commit split |
| key derivation | `src/runtime/exterior-cell-runtime.ts` | `exteriorArtifactCacheKey`, `exteriorOutcomeCacheKeys`, `noteArtifactRelease`, two additive metrics |
| single-decision pool | `src/runtime/exterior-cell-scheduling.ts` | `scheduleExteriorCellsGlobally`, `EXTERIOR_CELL_STATIC_UNITS` |
| global cap | `src/runtime/exterior-visibility-scheduler.ts` | `EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY` (128); T002's policy untouched |
| cache | `src/release/citywide-release.ts` | incremental byte counter; the desync warning |
| app wiring | `src/app/App.tsx` | one global decision, one carry, the release passes, the retirement handler |
| viewport | `src/features/explorer/CesiumViewport.tsx` | `onExteriorCellsRetired` + the exported `exteriorRetirementSteps` applier |
| capture | `scripts/exterior-scheduler-trace-capture-cli.mjs` | `roam`, `latency`, `governance-evidence`, `roam-evidence` commands |

## The defect a measurement caught, recorded rather than smoothed over

The global pool builds its units from the **census**, whose Block 835 cell id is
`manhattan-exterior-cell-w00-000000-block-00835`. The Block 835 **release** names
the same cell `cell:manhattan:block-835`. The per-wave binding never had a
problem with this because it built its units FROM the declared ids, so the alias
resolved on the way in. The global binding compares a declared id against a
resident set of census ids, and the first version compared them directly —
**deferring the whole of wave w00 at every camera, including the one it is
standing in.**

It was not caught by a test. It was caught by the per-request latency capture on
the real build: the street-level session requested **6 artifacts where the same
pose had requested 20**, and the 14 missing ones were exactly Block 835's. The
fix resolves each declared id through `citywideOverviewCellExtent` before
matching. `exterior-cell-scheduling.test.ts` now pins it, and the test **fails
against the pre-fix logic** (verified by reverting the one comparison).

The general lesson, which is why it is written here: the alias is a property of
the *release-to-census* mapping, and a decision that changes which side of that
mapping it compares on will get it wrong silently, because a deferred cell and an
absent cell look identical from every counter the app publishes.

## Tests

New suites:

| suite | tests | proves |
| --- | --- | --- |
| `src/runtime/exterior-cache-release.test.ts` | 18 | the four gates, re-admission, plan/commit purity, key-derivation anti-drift |
| `src/runtime/exterior-cache-eviction-correctness.test.ts` | 7 | (a) evict shrinks bytes and the seamless case does not, (b) refetch re-verifies, (c) predecessor double cost |
| `src/runtime/exterior-cache-governance-gate.test.ts` | 13 | the separately-named single-pool baseline over three traces incl. the roam |
| `src/app/exterior-global-residency.test.ts` | 4 | no stale render / no premature release through the effect's own module sequence over 58 real camera samples |
| `src/features/explorer/exterior-eviction-pick-identity.test.ts` | 6 | entity + pick-map removal, revoke-before-retire, selection and deep-link survival, re-admission |

Extended: `exterior-cell-scheduling.test.ts` (+9, incl. the alias regression and
the T005 ranking finding), `citywide-release.test.ts` (+2, the byte-counter
invariant and the desync warning), `exterior-scheduler-thrash-gate.test.ts`
(policy frozen field by field).

## Review round 2: two blocking findings closed

**B1 — the release pass ran inside the per-wave loop.** Gate 1 reads the applied
per-wave `requested` sets, so a pass firing during an early wave's iteration
could release a candidate the same decision re-admits for a later wave. Hoisted
to one pass after the loop (chosen over feeding the decision into the plan
input; ADR 0042 states why, and now names which state the gate reads).

**B2 — the replay modelled the release after the loop while the App ran it
inside**, which is why B1 survived both reviews. `replayEffect` is now
parameterised by `releaseTiming` and the suite asserts on both placements. The
gate is the *structural* property — **0 partially-applied release passes** for
the shipped placement, **238** for the mid-loop one.

An honest limit came out of B2 and is recorded in the test and the ADR rather
than smoothed over: on the committed roam trace the mid-loop placement produces
**no observed symptom**, because the retirement pass at the end of each decision
drains the queue before the next loop begins. The symptom is trace-dependent;
the hazard is structural. The seam-level demonstration that a partially applied
`requestedCellIds` releases a candidate the complete one keeps is in
`exterior-cache-release.test.ts`.

A **residual race** surfaced while measuring B2 and is counted, not fixed: a
batch settling *between* two decisions is discarded against a decision that
genuinely does not want the cell, and the next decision may re-admit it. Two
occurrences over 58 samples, <1% of session releases. Pinned by a test.

Nits adopted: N1 the residue is restated as *any dropped outcome that never
reached the scene*, with `reachedScene: true` labelled as asserted-not-observed
and the closing signal named; N2 the viewport's four retirement mutations are
now the exported pure `exteriorRetirementSteps`, executed verbatim by the effect
(ordering test verified failing when the steps are reordered); N3 the byte
figure is aligned on the test-derived 43,246,075; N4 gate (b) cell-scoped vs
artifact-scoped keys noted; N5 the O(k²) `includes` is a `Set`.

### Tests that fail against the pre-fix code

1. **`resolves the Block 835 release alias against the census unit pool`** —
   fails with the direct id comparison. Verified by reverting.
2. **`shrinks cache.bytes() with the seam, and does NOT shrink it without`** —
   its `withoutSeam` branch IS the pre-T003 behaviour, asserted in the same test,
   so the test cannot pass if the seam stops mattering.
3. **`grows without bound when nothing releases`** — the same, over 58 real
   camera samples.

## Measurements

- **Roam trace** `data/exterior-cache-governance-20260814/roam-trace.json`: 58
  settled samples, 220–2,106 m, 5.5 km x 3.8 km, 56/58 real ground-ray
  footprints. Captured over CDP with the T002 tool and pattern, exterior
  streaming off (camera geometry only).
- **Steady-state peak residency: 128 cells**, priced at the measured per-cell
  ratio as 244 entries / 43,246,075 B — 47.7% and 16.1% of the two ceilings.
- **Per-request latency**: transport p50 21.96 ms, p95 55.96 ms over 20
  artifacts; SHA-256 of the median artifact 0.02 ms. **Localhost + disk pricing,
  not a deployment claim.**
- **Cap 96 vs 128**: mixed on the zoom-out (13→15 at the horizon, 30→25 at the
  wider window), clearly better on the roam (45→32). Reported, not averaged.
- **The seam, in a real browser** (`roam-evidence.json`): residency climbed
  14 → 43 entries / 11.1 MB as the camera rose, then a lateral move at altitude
  **released 79 artifacts and 22,258,480 B**; the descent re-fetched and settled
  at Block 835's own 14 assets. Pinned by a test.
- **Shipped configuration at the two ADR 0041 cameras**
  (`governance-evidence.json`): street identical to T002 (12 cells / 14
  artifacts); overview 110 → **121** cells with the midtown wave no longer
  cap-truncated (96 → 107), at the same 210 artifacts / 37,164,596 B.

## Known-flaky, measured rather than asserted

Two suites fail intermittently under full-suite parallelism and pass alone:

- `src/app/App.test.tsx > closes details with Escape…` — the flake T002 already
  documented (T002 measured 1686/1686, 1685/1686, 1685/1686 across three runs).
- `src/release/midtown-core-v3-release.test.ts > passes the accepted
  release-graph and assembly validators` — a ~20 s suite; observed failing once
  under load in this task and passing alone. Same class, not the same test.

Neither is touched by this task's diff.

## Not done, named

- No citywide reservation, no `refreshViewport` refactor — T004 (ADR 0042).
- No band-internal distance ranking — T005 finding, pinned by a test.
- No user-visible notice for deferred **or evicted** cells — T006.
- No decoded-GPU measurement — still not observable (ADR 0040 D7).
