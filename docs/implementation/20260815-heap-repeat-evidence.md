# T008 (Issue #80) — repeated-camera-path heap evidence at citywide scale

Captures the one measurement the `manhattan-citywide-default-streaming` Goal was
missing, and closes or refuses criterion 7 on what that measurement says. No
runtime code changes: one new capture CLI, one captured record, one colocated
drift test, and the record amendments the verdict implies.

| # | commit | what it changes |
| --- | --- | --- |
| 1 | `[T008] Heap repeat instrument` | new `scripts/citywide-heap-repeat-cli.mjs`, `scripts/citywide-heap-repeat.test.mjs`, `data/citywide-heap-repeat-20260815/heap-repeat-evidence.json` + `.sha256` |
| 2 | `[T008] Acceptance record amendment` | `data/citywide-goal-acceptance-20260815/reconciliation.json`, `scripts/citywide-goal-acceptance.test.mjs`, `data/goal-integration-acceptance-20260812/reconciliation.json`, `README.md`, `docs/PROJECT_BRIEF.md`, this record |
| 3 | `[T008] Close review: D-18 carriage, ADR 0045 addendum, drawn-count reconciliation` | D-18 + the drawn-count risk in the acceptance record (and its re-pin), the ADR 0045 append-only addendum, §7's corrected causal claim, both documents' qualifying clause, three more drift assertions, `package.json` |

---

## 1 — What criterion 7 asked for, and what existed

> Repeated-camera-path heap is non-monotonic under forced GC at citywide scale;
> GPU texture memory is stated by arithmetic (and the shared atlas is
> implemented if the arithmetic exceeds budget, inheriting replay-gated
> procedural rules)

The GPU half was discharged by arithmetic in ADR 0043 and is not re-argued here.
The heap half had **no evidence at all** before this task, which T007 recorded
rather than papered over:

- `data/citywide-default-flip-20260814/stations-default.json` carries a
  forced-GC heap reading at each of four stations — but they are four different
  cameras, so the series is monotone by construction and says nothing about
  retention.
- `data/goal-bounded-gaps-20260812/heap-concurrency-evidence.json` is the right
  SHAPE — one path, repeated, forced GC before every sample — but its path
  "stays inside one midtown block", and its own `residency.statement` says it
  "does NOT certify behaviour at peak residency or under eviction pressure".

So the missing artifact was precise: the bounded-gaps shape, run over an
island-scale path, on the default six-wave composition.

## 2 — The instrument

`scripts/citywide-heap-repeat-cli.mjs`. Five disciplines are load-bearing.

**One document.** The T006 campaign opened a tab per station and navigated.
A heap series across nine fresh documents measures nine cold boots. Here
`Page.navigate` is called once, at boot, on a URL that names **no** exterior
parameter; every subsequent pose is `history.pushState` plus a synthetic
`PopStateEvent`, which `App.tsx:3209` routes through `applyUrl` →
`setCameraPose` → `setCameraRequest`, applied by `CesiumViewport.tsx:2529` as a
`setView` teleport. The document, the adapter and every cache survive the run.

**A real forced collection.** `HeapProfiler.collectGarbage` is a DevTools
request whose failure the T006 harness swallowed with `.catch(() => null)`, so a
reading after a silently failed collection looked exactly like one after a real
collection. Here the collection is `window.gc()` evaluated in the page under
`--js-flags=--expose-gc`, and a throw aborts the run.

**The verdict formula is imported, not re-implemented.** The CLI imports
`block835CanaryHeapVerdict` from `src/runtime/block835-canary-probe.ts` — the
same function that graded the prior goal's criterion 30 — and
`scripts/citywide-heap-repeat.test.mjs` recomputes the committed verdict from
the committed series with that same function and demands byte-equality. Node's
type stripping does not add the JSON import attribute the probe module's
fixtures need, so the CLI registers a `module.registerHooks` resolve hook rather
than copying the arithmetic into a second implementation.

**A fail-closed pre-flight.** Six limbs, all before lap 0, any one of them
aborting the run with **no record written**: `window.gc` is a function;
`performance.memory.usedJSHeapSize` is finite; two reads separated by a
deliberate allocation **differ** (the quantization tell — Chrome buckets
`performance.memory` to 100 kB without `--enable-precise-memory-info`, and a
quantized series can look flat for reasons that have nothing to do with
retention); the document is focused and visible; the served bundle is
byte-identical to this worktree's `dist/index.html`; no external host was
contacted. Mid-run, the run also aborts on two consecutive byte-identical heap
samples, a focus or visibility change, any external host, and a hard wall-clock
cap on the sampling phase.

**The lap presses the pool.** Five poses, 45 s settle each: the 52 km island
overview, then 2,400 m and 1,200 m at the midtown anchor — both **on** the
scheduler's `distanceBandEdgesMeters` `[1200, 2400]`, where admission flips —
then a 260 m midtown street pose, then a 260 m lower-Manhattan street pose ~5 km
away whose exterior resident set shares nothing with the fourth. The verdict is
sampled at the fourth pose, pre-declared before the run as the trough.

## 3 — A defect this task had to find before it could measure anything

The first mechanics check showed poses silently not applying: a teleport from
the midtown street pose to the lower-Manhattan street pose produced **no new
scheduler decision at all**, and a teleport from a street pose back to the 52 km
overview left the scheduler holding the **street** footprint — `residentCount`
13 against the 128 a booted overview records — unchanged over a 45 s poll.

The mechanism is in the app, not in the harness. `emitSettledCamera` derives the
footprint from `cameraFootprintForViewer` and falls back to
`lastValidFootprintRef` when that footprint is not valid
(`CesiumViewport.tsx:1923-1928`), and it is called synchronously right after the
`setView` (`CesiumViewport.tsx:2534`) — before a frame has rendered at the new
camera, when the footprint cannot yet be computed. Nothing re-emits afterwards,
because a `setView` fires no `camera.moveEnd`.

**This is a real Back/Forward defect, not a CDP artefact**: a user pressing Back
to a saved overview pose meets the same stale resident set. It is recorded here
and in the evidence record's `poseLandingDisclosure`, and it is **not fixed by
this task** — fixing it is a runtime change to the camera commit path, which is
out of this task's scope and would change the very behaviour being measured.

The instrument works around it in the only way that keeps the frozen mechanism
intact: it **re-dispatches the identical pose** every 5 s until the scheduler's
own `footprintSignature` changes, then starts the settle. A re-dispatch is the
same pushState with the same coordinates, so it moves the camera nowhere. Every
pose in the record carries its `dispatchCount`, and the settle is measured from
the moment the pose lands. With the landing loop the overview records
`residentCount` 128, `visibleCount` 883, `deferredCount` 755 — the pressed pool
the stop report asked for.

## 4 — The known limitation, stated rather than buried

`monotonicGrowthDetected` in `block835CanaryHeapVerdict` is literally
`growthRatio > noiseBandRatio` (`src/runtime/block835-canary-probe.ts:322`). It
is a **restatement** of the first-half-versus-second-half median ratio test, not
an independent monotonicity test: it never inspects the ordering, the run
lengths or the slope of the series. The pre-registered pass rule's two conjuncts
are therefore **one measurement reported twice**.

The record carries that sentence verbatim, and carries the monotonicity columns
the formula does not compute — `strictlyIncreasingRunLength`,
`positiveDeltaCount`, and an ordinary-least-squares `slopeBytesPerLap` with
`rSquared` — reported whether or not they agree with the boolean. It also states
its own **detection floor**: `0.10 × firstHalfMedianBytes / 4`, because the two
medians the verdict compares are centred four laps apart, so a steady per-lap
retention `r` moves the second-half median by `4r` and the ratio test fires only
when `4r` exceeds the band. A pass **bounds** retention at that floor; it does
not exclude retention below it.

## 5 — What was pressed, and what structurally cannot be

T007's stop report asked for a path that "presses the 128-cell cap and forces
eviction". **Half of that is unreachable**, and the record says so rather than
quietly satisfying the reachable half:

- The **128-cell exterior resident pool** is pressed. The overview records
  `residentCount` 128 against `visibleCount` 883 with `deferredCount` 755, and
  every lap drops to two disjoint 260 m street working sets and climbs back, so
  the pool is refilled and re-truncated once per repeat.
- The **citywide dense shard cache** is not pressed and **cannot be** by any
  camera. `CITYWIDE_OVERVIEW_BUDGETS` caps it at `maxLoadedShards` 112 and
  `maxLoadedBytes` 80 × 1024 × 1024 = 83,886,080 B
  (`src/release/citywide-release.ts:79-80`), and the whole island's dense shards
  fit under both caps, so `cacheEvictions` is 0 by design rather than by luck.

Native GPU memory and decoded-texture retention remain unobservable from
`performance.memory` and are claimed in neither direction.

## 6 — What it measured

One attempt. No pre-flight or mid-run abort fired, no re-run was taken, and the
record carries `attemptCount` 1. Focus was **real**, not emulated —
`documentHasFocusRaw` was already `true`, so the instrument never enabled
`Emulation.setFocusEmulationEnabled`, which is a stronger footing than the prior
goal's heap record had. Boot took 6,447 ms; the sampling phase took 2,342,884 ms
(39.0 min) against a 50-minute cap; 1,459 responses were served and
`externalHosts` is empty.

The verdict series, at the pre-declared 260 m midtown street pose, one sample per
sampled lap, each after `window.gc()`:

| lap | jsHeapBytes | Δ prev | ratio to first |
| ---: | ---: | ---: | ---: |
| 1 | 317,603,986 | — | 1.000000 |
| 2 | 318,060,550 | +456,564 | 1.001438 |
| 3 | 318,120,310 | +59,760 | 1.001626 |
| 4 | 318,398,857 | +278,547 | 1.002503 |
| 5 | 318,645,722 | +246,865 | 1.003280 |
| 6 | 276,130,620 | −42,515,102 | 0.869419 |
| 7 | 318,773,145 | +42,642,525 | 1.003681 |
| 8 | 246,568,075 | −72,205,070 | 0.776338 |

`firstHalfMedianBytes` 318,090,430 · `secondHalfMedianBytes` 297,388,171 ·
`growthBytes` −20,702,259 · **`growthRatio` −0.0650829356922181** against a 0.1
band · `monotonicGrowthDetected` **false** · `sampleCount` 8.

**PASS**, and read narrowly. The honest shape of that series is *not* "flat":
five of the eight sampled repeats form a strictly increasing run, rising
1,041,736 B in total, and only then do two collections drop it to its minimum.
The OLS slope is −7,373,936 B/lap at `rSquared` 0.431 — that negative number is
the two drops, not a downward trend, and the record says so. Against a detection
floor of 7,952,260.75 B per lap, a steady ~260 kB/lap drift is far below what the
instrument can resolve: the pass **bounds** retention, it does not exclude it.

Both disclosed series are published beside the verdict:

- **Un-warmed 9-lap**: `growthRatio` −0.0643235412459757, also passing. Note the
  formula drops the middle sample at odd lengths — 9 values give `half` = 4, so
  repeats 0–3 and 5–8 are compared and repeat 4 is discarded. Publishing it
  shows the warmup exclusion was not what produced the verdict.
- **Overview secondary** (peak residency, never the verdict): 588,598,254 →
  577,283,859 B, `growthRatio` +0.0285, also within the band. The overview heap
  runs ~1.9× the street heap, which is what a resident island should cost.

## 7 — Churn: the lap is a cycle, not a dwell

A flat heap over a path that never changed its resident set would prove nothing.
Per lap, every counter moves:

| pose | resident | visible | deferred | dense plan |
| --- | ---: | ---: | ---: | ---: |
| overview 52 km | 128 | 883 | 755 | 45,154 buildings |
| band 2,400 m | 128 | 298 | 170 | — |
| transition 1,200 m | 128 | 116 | 0 | — |
| street 260 m midtown | 12 | 12 | 0 | 235 buildings |
| street 260 m lower | 17 | 5 | 0 | — |

Over the run the scheduler's release seam freed **472 artifacts /
144,610,620 B** — where the flip campaign's four stations freed nothing at all —
and the dense plan rebuilt 64 times with 62 swaps and 2 cancellations. Peak
concurrent requests stayed at 4, against the criterion's ceiling of 8. Both
probe buffers stayed inside their caps.

**One disclosure a reader will otherwise trip over.** At the 52 km overview this
warmed session records `buildingFeatureCount` 45,154 — of 45,194 canonical
parents — where the flip campaign's cold single-station capture records 41,841 at
the same camera. Neither is wrong and this record does **not** amend the 41,841
figure the documentation quotes.

The tempting explanation is shard count: the cold capture held 99 dense shards
and this session held 103. **That explanation does not carry the difference, and
this record's own lap 0 is what disproves it.** Lap 0 holds **99** shards — the
same 99 — and draws **42,981**, which is neither figure:

| lap | dense entries | dense bytes | drawn buildings | instances | planBuildCount |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0 (warmup) | 99 | 59,103,270 | 42,981 | 54,024 | 2 |
| 1 | 103 | 62,598,581 | 45,154 | 57,313 | 11 |
| 2–8 | 103 | 62,598,581 | 45,154 | 57,313 | 18 → 60 |

So the four extra shards do not by themselves account for 3,313 buildings. The
second variable is **plan-fill state at the moment of reading**: lap 0 is read at
`planBuildCount` 2, lap 1 onward at 11 and above, and the count stabilises
exactly when the plan has been rebuilt enough times to have caught up with what
is loaded. **The drawn count at a camera is a function of what the session has
loaded *and* how far the dense plan has been rebuilt when the reading is taken —
not of the camera alone.**

The consequence for a reader is narrow: 41,841 is the honest figure for a **cold**
default session arriving at the overview, which is what the README and the brief
quote and what their cited record measured, and it is a **floor** rather than a
ceiling on what a roamed session draws at the same camera. Both documents now
carry a qualifying clause, and the discrepancy is carried in the acceptance
record's residual risks.

## 8 — What this closes, and what it does not

Criterion 7 moves NOT-MET → MET in
`data/citywide-goal-acceptance-20260815/reconciliation.json`; its `stopReport` is
removed because that record's own shape rule forbids one on a criterion that is
not NOT-MET, and the closure is recorded in a new `amendments` block instead. The
counts become 9 / 3 / 0 and `stopReportCount` 0. The prior goal's record re-pins
its criterion-22 evidence hash to the amended citywide record.

Two residual risks were rewritten rather than dropped, and two were added:

- **D-13** is now a closure, stated with everything the closure does not
  establish.
- **D-12** is updated with the distinction it turns on: a default path now
  demonstrably exercises the artifact **release** seam, but still does not force
  an **LRU eviction** from the exterior cell cache (40 entries / 14,369,372 B
  against 512-entry, 256 MiB caps), and the dense shard pool cannot be evicted at
  all.
- **D-18** is new: the Back/Forward camera defect of §3, carried by number with
  its symbol, lines, mechanism, observed consequence, user-visible failure mode
  and closing instrument, and held in place by the marker assertion in
  `scripts/citywide-goal-acceptance.test.mjs`.
- An **unnumbered drawn-count entry** carries §7's 45,154-versus-41,841 reading
  difference, per the T007 precedent for documentation-accuracy findings.

`docs/decisions/0045-citywide-default-streaming-flip.md` gains an **append-only
addendum**: §5.1 row 7 and §5.2 D-13 still read "NOT discharged" and "not
claimed", because that is what was true of the T006 campaign, and the addendum
records the later capture those entries pointed at rather than rewriting them.

Not closed, and not touched: the prior goal's criterion 1, the 899 grammar
refusals, D-17's unguarded commit-path wiring, D-11's 5,746 ms double-draw, and
D-18 itself — recorded but not fixed.

## 9 — Four things this record does not want a reader to over-read

**Probe accumulation is bounded, and here is the arithmetic rather than an
invitation to do it.** The two probe buffers did **not** saturate their caps
during the run — at the verdict pose `traceLength` grew 13 → 55 (cap 800) and
`denseSampleCount` 19 → 89 (cap 400) across the sampled laps — so probe growth is
a live contributor and not a settled one. A trace entry and a dense sample are
flat objects of roughly 10 and 30 numeric/string fields; at a deliberately
generous 1 kB each, the ~48 objects retained across laps 1–5 are **~48 kB against
the 1,041,736 B rise** in the same window, under 5%, and ~0.015% of the
318 MB heap. **The estimate is an upper bound from field counts, not a measured
retained-size figure** — nothing in this capture measured the objects' actual
retained size, and a reader who needs that number does not have it here.

**The overview series has an excursion nothing explains.** Lap 4's overview
sample is 649,252,759 B against a series that otherwise sits near 562–606 MB — a
~+87 MB excursion with **no correlate in any counter this record captured**:
resident, visible, deferred, released, dense entries, plan counts and peak
concurrency are all identical to the neighbouring laps. The peak pose's noise
amplitude therefore approaches the width of the 0.1 band itself, which is
precisely why the overview series is published as disclosure and the **trough**
pose was pre-declared as the verdict point.

**`attemptCount` is operator-supplied, not instrument-derived.** It is the
`--attempt` argument; the CLI cannot know how many times a human ran it. What
makes the 1 credible is structural rather than asserted: an aborted run writes
**no record at all**, so an unwritten attempt cannot become evidence — but the
field is a statement of good faith and should be read as one.

**"Disjoint street working sets" is geometric inference, not a set comparison.**
The two 260 m street poses are ~5 km apart and each records a resident set of 12
and 17 cells respectively, so overlap is implausible — but this record compares
`residentCount`s and footprint signatures, never the resident cell-ID sets
themselves, and therefore does not *prove* the sets are disjoint.
