# T005 — near-field transition band: the detail radius and the recorded verdict

Task T005 of goal `manhattan-citywide-default-streaming` (Issue #70), branch
`fcp/70-transition-band`. The decision is ADR 0044; this record is what was
built, what it cost, and what deliberately did not get done.

## What was added or changed

| path | purpose |
| --- | --- |
| `src/runtime/exterior-visibility-scheduler.ts` | **The lever.** One optional `SchedulerPolicy.maxUnitDistanceMeters` (default `null`) read in exactly one place: the footprint-intersection branch of `selectResidentUnits`. |
| `src/runtime/exterior-visibility-scheduler.test.ts` | 8 new tests for the radius: the null limit case, refusal beyond it, inclusive boundary, reservation exemption at radius 1 m, the hysteresis fade-out, filter-not-re-rank, island monotonicity, and the untrusted-footprint hold. |
| `src/runtime/exterior-cell-scheduling.ts` | Pass-through only, on both bindings. No default of its own, so "the caller said nothing" and "today's behaviour" stay one statement. |
| `src/runtime/exterior-cell-scheduling.test.ts` | 4 new tests, incl. the by-reference identity guarantee holding with a radius set, and Block 835 resident at radius 1 m. |
| `src/app/App.tsx` | `?exteriorDetailRadius=<metres>` URL member (parse, write-back, fail-closed to `null`); the radius reaches `scheduleExteriorCellsGlobally`; the scheduler probe gains `detailRadiusMeters`, the live `SchedulerDecision` counters and `denseMetrics`. |
| `src/app/App.test.tsx` | 2 new URL-contract tests; existing `parseExteriorStreamingUrl` expectations gained the new field. |
| `src/features/explorer/CesiumViewport.tsx` | `DenseRenderMetrics.exteriorSuppressedFeatureCount` — `exteriorRenderedCanonicalFeatureIds(...).size`, the honest rendered unit. |
| `src/features/explorer/CesiumViewport.test.ts` | 1 test: one changed element of 45,154 rebuilds the whole dense plan. |
| `scripts/transition-band-evidence-cli.mjs` | Three stages: `bundle`, `poses`, `crossing`. Includes a minimal PNG decoder so "the stills differ" becomes a fraction. |
| `data/transition-band-20260814/` | Served-bundle record, A/B evidence, crossing evidence, 19 stills, checksum sidecars. |
| `docs/decisions/0044-near-field-transition-band.md` | The decision, with Part 1 committed BEFORE any capture. |

No frozen byte changed. No release was assembled, no artifact published, no wave
materialized. `EXTERIOR_CELL_SCHEDULER_POLICY`,
`EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY`, both band edges and the 128 cap are
byte-identical to what T004 left.

## The discipline that shaped the cycle

**Part 1 of ADR 0044 was written and committed in its own commit before the
first capture ran.** Two of this task's questions have arithmetically
pre-determined answers — the 2 % gate's inapplicability to the dense→V3 swap,
and the revival clause's void-ness on the fidelity axis — and deciding them
after seeing the stills would have been rationalisation. The revival thresholds
X = 8,000 ms and Y = 4,000 ms were fixed in that commit, from T004's committed
baseline, before anything was measured against them.

## Host observations

- **Headless Chrome needs its tabs closed.** The first crossing attempt timed
  out and left five live Cesium scenes in one browser; the next run was starved
  by them. Each pose capture now closes its own target.
- **A URL change is not a camera move.** The crossing was first driven by
  assigning `window.location.href`, which is a full page reload: the execution
  context dies and what gets measured is a boot. It is now six real
  `Input.dispatchMouseEvent` drags in one document, the T002 shape, with the
  same 2.6 s inertia settle.
- **The preview server binds IPv6 `localhost` only**; `127.0.0.1:4211` refuses.

## What was measured, in one paragraph

Four poses × two arms on one served bundle, plus one drag-driven crossing.
`hold === "none"` and `deferredCount === 0` in every captured decision — the
128 cap never binds in the near field, so the distance bands cannot have
influenced any of it. The camera reservation held at every pose. Zero external
hosts throughout. The Block 835 `lod_0`↔`lod_1` transition at 250 m passes the
2 % silhouette gate with 10.9× margin (worst 0.001834). The crossing showed
`planBuildCount` advancing while `planSwapCount` did not, for a double-draw
window bounded at 2,821–4,084 ms (the 3,557.9 ms build-duration proxy
undercounts it — see D-9), and 21.8 % of the frame changing four seconds after
the drag ended. The crossing rebuild was **4,803 features in 41 chunks**; the
5,496-feature / 46-chunk / 6,359.6 ms build in the same record is the **boot**
build that settled before the first drag, and at 79.5 % of the X bar it is the
strongest single reason D-9 exists.

## The verdict, in one paragraph

Revival does not fire, **on the AND clause**. Leg X does not fire on the
measured crossing (3,557.9 ms for 4,803 features in 41 chunks). Leg Y is **NOT
ESTABLISHED**: `totalBuildMs` measures only the committed build, while the §1.4
window opens at the earlier build's pending-layer add, so the proxy is
structurally biased low, and the unbiased counter bounds are [2,821 ms,
4,084 ms] — an upper bound above the 4,000 ms bar. Leg AND fails outright and is
sufficient alone, so the verdict would be unchanged if Y were later established
as fired. The no-popping check fails exactly as pre-registered, as a defect of
`shouldReplaceDenseRenderPlan` rather than of the radius. The recommendation for T006's default flip is **`null` — no detail
radius in this composition** — because the entire V3 overlay is 484 buildings in
13 cells, `deferredCount` was 0 everywhere, and adding radius crossings before
the incremental update exists buys nothing and costs a multi-second double-draw
each. If a radius is nonetheless wanted, 1,200 m is the value with evidence
behind it.

## What did not get done, and why

The ten numbered deferrals are in ADR 0044 Part 5. The ones that matter to the
next cycle:

- **D-1 is a RETIREMENT, not a deferral.** The `refreshViewport` →
  `selectResidentUnits` refactor met ADR 0043's own retirement condition
  ("unless the near-field band needs a mixed unit list") and the near-field band
  did not need one.
- **D-2 is a BLOCKING PREREQUISITE of the flip.** T006 must not flip the default
  before the incremental dense-plan update exists, because every crossing in a
  streaming default session pays the measured double-draw.
- **D-9 is the SECOND BLOCKING PREREQUISITE of the flip, with the same force as
  D-2.** Every crossing number in this cycle was measured on a **4,803-feature**
  plan; the island plan is 57,273 features in 478 chunks (**11.9×**), and the
  boot build immediately before the crossing already reached **79.5 % of the X
  bar** at only 14.4 % more features. T006 must measure an **island-scale**
  crossing and re-evaluate legs X and Y against the unchanged §1.3 thresholds,
  after adding timestamps at the pending-layer add (`CesiumViewport.tsx:1771`)
  and the commit (`:1797`) so leg Y is measured against its own definition
  rather than by a build-duration proxy that is known to undercount it.
- **D-10** is the A/B control this cycle never ran — scheduler on, overlay on,
  radius `null` — and it must be run first if a radius is ever reconsidered.
  §3.1's table is explicitly **not** that baseline.

## Reproducing the evidence

```
VITE_EXTERIOR_SCHEDULER_PROBE=1 VITE_CITYWIDE_OVERVIEW_PROBE=1 pnpm build
pnpm preview --port 4211 --strictPort
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --remote-debugging-port=9222 --remote-allow-origins='*' \
  --use-angle=swiftshader --enable-unsafe-swiftshader --window-size=1440,900 about:blank
node --experimental-strip-types scripts/transition-band-evidence-cli.mjs poses \
  --dev http://localhost:4211 --port 9222 --radius 1200
node --experimental-strip-types scripts/transition-band-evidence-cli.mjs crossing \
  --dev http://localhost:4211 --port 9222 --radius 1200
```

Timings will not reproduce — they are software-rasteriser numbers on one host.
The counter ORDERING (`planBuildCount` advancing while `planSwapCount` does not)
will, because it is a property of the code.
