# ADR 0053 — The exterior acceptance campaign, and what it does and does not discharge

Status: accepted. Records a MEASUREMENT campaign and its verdicts, not a runtime
change. No file under `src/` moves because of this ADR.
Date: 2026-08-17
Task: T006
Relates to: ADR 0045 (frame budgets, D-11), ADR 0047 (shared class textures),
ADR 0052 (the full-city serving shape). **Amends nothing.** It records one gate
whose bar was pre-registered as unreachable (L2), one gate that FAILED (J4), and
one pre-registered argument this campaign could not decide (the E-1 forcing
argument).

## Context

T005 promoted six serving waves and made the full city the default. What it did
not do — and said so — was measure the shipped arrangement against the goal's own
acceptance criteria. Five of those criteria (#3 texture architecture, #4 the LOD
chain, #5 frame budgets, #6 heap and GPU memory, #7 cache and streaming
governance, #8 visual verification) were either unmeasured at six-wave scale or
measured against a composition that no longer exists.

The hazard in a campaign like this is not that a bar is missed. It is that the
bar moves after the number is seen. So the campaign was **pre-registered**: every
station, window, budget, storm step, eviction pose and pass condition was
committed in `scripts/exterior-acceptance-campaign-constants.mjs` and
`data/exterior-acceptance-20260817/pre-registration.json` at commit `314cb8f`, a
commit that contains **no capture at all**, with a pinning test that turns
editing a bar into a visibly broken test rather than a silent edit.

This ADR records what the campaign then measured.

---

## 1. The decision

**Accept the six-wave serving arrangement against the pre-registered bars, and
record three things it does not establish.**

The gating results, in full:

| | gates | outcome |
| --- | --- | --- |
| PASS | F1, S-1a, S-1b, S-1c, S-1e, G1, G2, G3, E-1a, E-1b, E-1c, E-1d, E-1e, M1, M2, J1, J2, J3, J5, L1, `REQUEST_CEILINGS` | 21 |
| FAIL | J4 | 1 |
| REPORTED, non-gating | F2, F4, H1, H2, S-1d, G4, M3, M4, VISUAL | 9 |
| HONEST-STOP, pre-registered unreachable | L2 | 1 |
| Cross-reference / carried | E-1f, J6 | 2 |

Machine-readable: `data/exterior-acceptance-20260817/campaign-record.json`.

---

## 2. What the frame numbers say, and the control that stops them saying more

Five stations, 45 s settle, a 12 s `requestAnimationFrame` window, the strict
16.7 / 25 ms pair inherited from ADR 0045:

| station | p50 | p95 | frames | resident assets | resident waves |
| --- | --- | --- | --- | --- | --- |
| overview-52km-island | 16.7 | 24.9 | 704 | 431 | 1 |
| overview-2400m-anchor | 8.4 | 16.9 | 1183 | 269 | 2 |
| transition-1200m-anchor | 16.5 | 18.2 | 846 | 348 | 2 |
| street-260m-midtown | 8.4 | 16.8 | 1169 | 277 | 2 |
| street-260m-w02-lower | 8.3 | 10.2 | 1440 | 401 | 3 |

F1 PASSES at every station. Two qualifications belong in the same breath.

**The nadir overview passes by 0.1 ms on both halves of the pair.** 16.7 against
a 16.7 bar and 24.9 against a 25 bar is not headroom; it is the bar. A reader who
takes "F1 passed" as "the island overview is comfortable" has read it wrong.

**The 600-frame floor was reachable only because the window is 12 s.** That was
worked out before the run, not after a short sample: a 10 s window on a 60 Hz
display yields 599 usable deltas by construction — one short, every time. This
machine's display runs at ~120 Hz (the vsync-on control's p50 is 8.3 ms), so the
floor was met with room; on a 60 Hz machine the 704-frame overview reading would
have been marginal.

### F2 — the control, and why it is a rule about conclusions

The instrument's own floor was captured on `about:blank` in the same browser:
**vsync-on p50 8.3 ms / p95 9.9 ms**. No station's p95 sits at or below 9.9, so
no station verdict is instrument-limited. That is the only reason the p95 column
above may be read as a statement about the scene at all, and it is the reason the
control was registered as a gate rather than as a footnote.

### F4 — D-11 is carried, with a larger number than D-11 recorded

At the stations, the maximum dense-plan `doubleDrawMs` was **7,122.2 ms**,
against ADR 0045's 4,000 ms leg-Y bar. This is a **NAMED CARRY of deferral D-11**
and not a new failure: D-11 already records 5,746 ms measured and ADR 0052
carried it forward unchanged. The pre-registration fixed that treatment in
advance, precisely so that a large number here could not be spun either way. The
measured value is larger than D-11's own, and that is stated rather than
averaged: at six promoted waves the island-scale bounds rebuild D-11 names costs
more than it did when D-11 was written.

During the storm the same counter read **599.1 ms**, below the bar. That does not
close D-11 either — one storm is not the island-scale rebuild D-11 names.

---

## 3. Headroom: the instrument, not the scene

H1 and H2 were registered NON-GATING before the run, and H1 carried a
pre-registered detectability condition. Uncapped (`--disable-gpu-vsync
--disable-frame-rate-limit`) the two compared stations read p50 **2.8 ms**
(street-260m-w02-lower) and **11.2 ms** (overview-2400m-anchor), a separation of
**8.4 ms** against a **vsync-off control p95 of 18.8 ms**. The full uncapped
row, for the record: 16.6 / 11.2 / 12.5 / 9.8 / 2.8 ms across the five stations
in station order.

**The registered finding is therefore INSTRUMENT-STILL-SATURATED.** The loop is
bounded by something other than the scene and no scene conclusion may be drawn
from it. That is a real result, it was named before the capture, and it is not
massaged into a signal.

Worth recording because it is counter-intuitive: the vsync-OFF control was
**slower** than the vsync-on one (18.3 ms p50 versus 8.3 ms). Removing the
frame limiter did not uncap an empty document's loop on this machine; whatever
those flags did, they did not make `about:blank` faster. Any future campaign that
plans to lean on an uncapped arm should read that number first.

---

## 4. Texture architecture: no atlas, and the measurement that replaces it

Acceptance criterion #3 asks for a shared atlas "or measured equivalent". **This
build ships no atlas, by decision.** ADR 0047 declined one because the maximum
observed `|UV|` is 1210.1 and an atlas cannot repeat-wrap a tile across that
range. The equivalent shipped instead is shared per-class URI delivery, and the
criterion is discharged by MEASUREMENT rather than by the argument.

**G1 — instrument validation first.** On a scene whose unique class-tile count is
known two independent ways (the committed payload inventory declares 4; the
document fetched 4 distinct tile URLs), `validateGpuTextureProbe` returned
`deltaByteLength` **exactly 0** — 349,524 measured against 349,524 predicted.
G1's bar is exact equality, not a tolerance, because a probe that disagrees with
arithmetic on a four-tile scene has not earned the right to be quoted on a
twenty-four-tile one.

**G3 is the architecture claim, and it is the interesting one.**

| reading | resident assets | resident waves | texture bytes | implied tiles |
| --- | --- | --- | --- | --- |
| single-wave Block 835 opt-in | 14 | 1 | 349,524 | 4 |
| overview-52km-island | 431 | 1 | 349,524 | 4 |
| street-260m-midtown | 277 | 2 | 699,048 | 8 |
| street-260m-w02-lower | 401 | 3 | 699,048 | 8 |

**Fourteen buildings and four hundred and thirty-one buildings cost the same four
tiles.** That is the claim of shared per-class delivery, measured rather than
argued: texture cost tracks the resident WAVE count and is flat in building
count. Only per-building duplication would make the number move with population,
and it does not move.

Two readings carried **7** tiles for 2 resident waves rather than the arithmetic
8. That is recorded rather than rounded up: a wave whose resident cells use only
three of the four style classes uploads three tiles. The registered sentence has
two clauses — a four-per-wave ceiling and "explained by the resident WAVE count,
never by the asset count" — and the verdict is taken on the second, with the
first checked beside it and its shortfall named.

**G2 passed, and passed weakly, and that is stated rather than banked.** The bar
is 2,097,144 + one tile = 2,184,525 bytes, and it assumes all 24 unique tiles
co-resident, i.e. all six waves holding cells at once. The highest reading
anywhere in the campaign was **699,048 bytes (8 tiles)**, because the scheduler's
8-resident-unit cap keeps the co-resident wave count at 3 or fewer at every pose
visited. G2 says the budget was not exceeded. **It does not say the budget was
tested at its own assumption**, and no reading in this campaign presses it.

**G4** restates the committed counterfactual from
`data/shared-class-textures-20260815/gpu-campaign.json` — 15,204,294 B over 174
distinct textures embedded, against 349,524 B over 4 shared — as a CITATION of an
earlier measurement, labelled as such. It is not a new capture.

---

## 5. Cache and streaming governance

**The request ceiling is 4, not 8, and the two probes are never summed.** The
contract's "≤ 8 active requests" is superseded by a stricter provable 4: `App.tsx`
constructs one `AggregateRequestBudget` and hands the same instance to the
citywide adapter, the civic adapter and every exterior wave runtime, so the
exterior and composed probes report the SAME semaphore's peak. Adding them would
double-count one number and would not measure any instant either. **Every probe
read in every session — five stations, the whole storm, all eight eviction stops
— reported peak 4.**

### The storm, judged more strictly than T005 judged its own

ADR 0045's flip campaign explicitly EXCLUDED its during-storm window from the
frame budgets and judged only the post-storm steady state. This campaign applied
the full strict pair to the during-storm window itself, decided in advance:

- **S-1a PASS** — during-storm p50 **8.4 ms**, p95 **17.4 ms** over 1,102 frames
  spanning 12 flip-identical drags, 4 zoom excursions and 6 cross-wave
  translations (25.4 s of storm). Post-storm settled: p50 8.3 / p95 10.2.
- **S-1b PASS** — peak concurrency 4; **cacheEntries reached exactly 1,024**, the
  cap itself; `cachedBytes` peaked at 183,056,897 (68% of the byte ceiling).
- **S-1c PASS** — `fallbackCellCount`, `failedCellCount` and
  `failedArtifactCount` all **0** at every probe read. This is the T005
  cancellation-defect regression gate and zero is the only passing value. Four
  `net::ERR_ABORTED` entries appear in the network log at the stations, all with
  `canceled: true`: they are dense shards the camera moved out from under, and
  they are correctly accounted as cancellations rather than failures.
- **S-1d REPORTED** — 1,253 cache evictions, 2,608 released artifacts,
  376,540,840 released bytes. The entry cap being reached exactly is where those
  evictions come from.
- **S-1e PASS** — zero external hosts.

### Eviction, and the defect the selector fix exposed

The eight-pose closed loop through midtown, on the six-wave default, with a
`?feature=` deep link applied **before** the roam:

- **E-1a PASS** — evictions observed (0 at e1/e2, 46 from e3 onward). T005's
  byte-identical condition observed none.
- **E-1b PASS** — the return stop is clean: zero failed cells, zero fallback
  cells, zero failed artifacts. Every re-admitted byte is re-verified against the
  same declared size and SHA-256, so a clean re-entry IS a byte-identical
  re-entry.
- **E-1c / E-1d PASS** — peak 4; 515 entries and 181,452,451 bytes at the worst
  stop, inside both caps.
- **E-1e PASS** — and this is the gate that was previously unmeasurable. T005
  recorded `selectionDigestFirstVisit: null`, `selectionDigestAfterReEntry: null`
  and `selectionStableAcrossEviction: false`. **That was the instrument reading
  nothing**: the selector was `[role="complementary"]`, and the details panel is
  an `<aside>`, which carries the complementary role IMPLICITLY and has no `role`
  attribute for a CSS attribute selector to match. Two nulls are equal, which is
  exactly why the pre-registration wrote the bar as EQUAL **and BOTH NON-NULL**.
  With the fixed selector the digests are `a39e251b` at e1 and `a39e251b` at e8 —
  equal, both non-null, gate capable of failing and passing.
- **E-1f CARRIED VERBATIM, not closed** — a canvas pick on the re-admitted mesh
  was still not captured. Every selection in this campaign is reached through
  search or a `?feature=` deep link.

### 5.1 The forcing argument is UNDECIDED, and the detector that said otherwise was wrong

The pre-registration argued that a stationary anchor cannot force an eviction —
the heaviest reachable 8-cell neighbourhood charges 92% of the byte cap and FITS
— so eviction is reachable only in transit. It registered a falsifier: "a
STATIONARY STOP with `cacheEvictions > 0` and a `scheduledCellCount` at or below
8".

The capture's detector reported that condition satisfied. **That report is
superseded, and the reason is a property of the counter rather than of the
scene.** `cacheEvictions` is CUMULATIVE and SESSION-WIDE: once any eviction has
occurred anywhere — including in transit, which is precisely where the argument
predicts it — every later settled stop reads non-zero while holding the
scheduler's cap of 8. The literal condition is therefore satisfied by a session
that behaves exactly as the argument says it will, and it decides nothing in
either direction.

The recorded verdict is **UNDECIDED-BY-THIS-INSTRUMENT**. What would decide it:
two probe reads at ONE stationary pose, separated by a dwell, asking whether the
counter moved BETWEEN them. The instrument now says so in its own record; it does
not yet do it. What the capture does support is weaker and is stated as such:
every settled stop sat inside both caps with margin, which is CONSISTENT with the
argument's central claim. Consistency is not proof.

The capture record was **not re-run** to obtain a tidier flag. The detector was
fixed afterwards and the sequence is recorded rather than the result.

---

## 6. Heap

The T008 instrument, re-run at six-wave scale against this campaign's own
evidence root. Two changes, both recorded before the run:

- **`--out`**, because the historical root `data/citywide-heap-repeat-20260815/`
  is frozen evidence of the T008 run and a re-run would have silently
  overwritten it. The drift test asserts its checksum is unchanged.
- **M2, a new validity condition**: every heap sample must be taken with
  `activeRequests === 0`, READ rather than implied by the settle. A violation is
  an INSTRUMENT-FAILURE ABORT that writes no record — not a heap failure, because
  a sample taken mid-flight is not a reading of the quantity the gate is about.
  T008 relied on a 45 s settle to imply quiescence; at six-wave scale that
  implication is no longer self-evident, so the implication is replaced by a
  reading.

The lap-phase wall-clock cap was raised from 50 to 75 minutes **in the
pre-registration commit, before any lap ran**, with its arithmetic recorded: the
floor at six promoted waves is ~37.5 minutes before any re-dispatch, and a cap
that fires on a healthy slow run is an instrument failure masquerading as a
result.

**M1 PASSES.** Eight sampled repeats at the midtown street trough, each read from
`performance.memory` after an in-page `window.gc()`: first-half median
602,454,881 B against second-half median 624,464,911 B, **growthRatio 0.0365**
against the 0.10 band, `monotonicGrowthDetected` false.

**M2 PASSES, and it passes fail-closed rather than by judgement.** All 18 heap
samples were taken with `activeRequests === 0`; the distinct set of readings at
sample time is `[0]`. A non-zero value would have aborted the run and written no
record, so the record's existence is the evidence — and the per-sample readings
are published so that is checkable rather than trusted.

**M4 records attemptCount 2, and the reason is a named instrument failure.**
Attempt 1 aborted at lap 2 with `focus/visibility changed mid-run (hasFocus true
-> false)`: the scratch Chrome lost window focus, which the instrument treats as
fatal because an unfocused renderer is throttled. It wrote **no record**, so the
aborted attempt cannot become evidence. Attempt 2 ran to completion. The
re-run is inside the pre-registered policy — repeat only for a NAMED instrument
failure, never because a series looked wrong — and no series from attempt 1 was
ever seen against a bar.

**The raised lap cap was not exercised, and that is worth saying.** The sampling
phase took **2,256,592 ms (37.6 min)**, comfortably inside both the raised 75-min
cap and the original 50-min one. The raise was made in the pre-registration
commit before any lap ran, so it could not have been fitted to the result; it
turned out not to be needed.

**What M1 bounds, and what it does not.** The detectable retention floor is
15,061,372 B per lap (0.10 × first-half median ÷ 4), so a PASS **bounds**
retention at that floor rather than excluding it. The instrument's own
monotonicity columns, which the pass formula does not compute, are reported
whether or not they agree with the boolean: longest strictly increasing run 4,
6 positive deltas of 7, OLS slope 4,703,921 B per lap, r² 0.685. A positive slope
under the detection floor is exactly the situation the floor exists to name.

The full series, the disclosed secondary series at the 52 km overview (M3) and
the un-warmed nine-lap convention are in
`data/exterior-acceptance-20260817/heap-repeat-evidence.json`.

---

## 7. LOD: one gate passes, the criterion does not close

**L1 PASSES.** On the Block 835 `-v3` opt-in — 14 buildings, the only
distinguished `lod_0`/`lod_1` pair addressable by the running app — under the
INSPECTION profile, with a feature selected: `lod_0` at a bucketed 200 m,
`lod_1` at a bucketed 300 m, two rendered stills differing by checksum.

Three things about that gate are part of the method rather than footnotes:

1. **The heights are 200 and 300, not 260 and 300.** `selectExteriorLod` is not
   fed a camera-to-asset distance; `App.tsx` feeds it
   `Math.max(50, Math.round(height / 100) * 100)`. A 260 m pose buckets to 300
   and lands on the SAME side of the 250 m seam as 300 would, so a 260/300 pair
   would have shown one LOD twice.
2. **The profile is part of the frozen method.** `exterior-render-profiles.test.ts`
   pins EXPLORATION to `lod_1` at 100, 250 and 251 m — it never selects `lod_0`
   at all. A still pair taken in exploration would have shown one LOD twice and
   could have been mistaken for a working transition.
3. **The `lodId` is a DOM scrape, and that is a recorded negative result.** No
   probe payload and no `data-*` attribute exposes the selected LOD. The only
   surface is the details panel's "Active asset" row. The campaign records that
   rather than adding a probe in order to be measured.

**L2 is an HONEST-STOP, registered before any capture was attempted.** Acceptance
criterion #4 asks for a per-wave stratified 2% key-silhouette gate on RENDERED
evidence. All six promoted `-s1` serving waves ship **`lod_0` only** — that is
machine-checked in the pre-registration, not asserted. There is no rendered
`lod_0`-to-`lod_1` transition anywhere in the served set, so **no capture this
campaign could run would produce the evidence #4 asks for.**

L1 explicitly does NOT discharge #4: fourteen buildings in one opt-in release is
not a per-wave stratified sample of six waves.

Two routes make #4 reachable, and both are changes rather than measurements:

- **Route 1 — serve both LODs.** Re-cut the six serving waves to ship `lod_0` and
  `lod_1` per building and let the runtime select between them. A release-shape
  change, ADR 0052 territory.
- **Route 2 — measure on the retained set.** The `-c1` retention packages carry
  both LODs for all 44,989 buildings. A per-wave stratified gate could be
  rendered from them directly, outside the serving path. **That measures the
  ARTIFACTS rather than what the app draws**, and any record taking this route
  must say so.

---

## 8. Visual verification, and the journey that failed

Twenty-seven rendered stills at the five stations, the GPU-validation pose, the
headroom arm, the storm end, all eight eviction stops, both LOD heights and every
journey are committed and checksummed. **What a still proves is that pixels were
produced at a stated pose from a stated release.** It is not evidence of likeness
or of geographic accuracy, and no gate here upgrades it into one.

The Blender re-import agreement (94 of 94 sampled buildings, T004) is **inherited,
not re-run**, and the inheritance is an argument rather than a measurement: the
`-s1` serving releases are BYTE COPIES of the `-c1` GLBs, the serving cut changes
which artifacts a release declares and where class tiles live rather than the
geometry bytes, and every served byte is re-verified at load against the same
declared size and SHA-256. A re-import of a byte-identical GLB is arithmetically
guaranteed to reproduce the same measurement. **The inheritance carries the
94-SAMPLE agreement; it does not extend the sample to the population.** Neither
the source record nor this campaign claims anything about the 44,895 buildings
the sample did not open.

Journeys J1, J2, J3 and J5 pass: a cold default session activates all six
promoted waves and boots 18 documents with no exterior parameter; search resolves
a served building and the panel carries cell/release, active asset, truth tiers
and uncertainty; the Block 835 opt-in still resolves and renders; and with
streaming off the app STATES what is unavailable rather than drawing less
quietly.

**J3's registered claim needed a correction and got one.** The claim says the
opt-in "renders beside the promoted default". It does not:
`resolveExteriorActivationSet` takes the `?exteriorCells=` branch and returns
exactly ONE target, so an explicit opt-in REPLACES the promoted six-wave set. The
journey establishes that the opt-in resolves, activates and renders over the
citywide base — not that two exterior sets are co-resident.

### J4 FAILED, and what the failure is

`?feature=doitt:100022` round-trips in the URL and the panel opens, but the
whole-panel digest does not equal the digest of the same building selected
interactively in J2. The diagnosis is in the record:

- **13 shared rows, 13 agreeing.** `Feature ID`, `Coordinates`, `Confidence`,
  `Geometry`, the base provenance and uncertainty rows are IDENTICAL across the
  two arms.
- The interactive arm carries five rows the deep-link arm does not: `Release
  origin`, `Cell / release`, `Active asset`, `Truth tiers`, `Source dates`.
- The deep-link arm carries one row the interactive arm does not: `Selected
  feature` — **"No verified exterior representation is active for this record."**

The building sits ~1.5 km from the midtown anchor. At a 260 m street pose its
exterior cell is not in the resident set, so the app said so. **The two arms were
not camera-matched, so the comparison was not like-for-like.** The gate as
implemented conflates identity with residency, and the failure is a defect of the
comparison rather than evidence that a deep link resolves a different building.

**It is recorded as a FAIL and was not re-run to a nicer number.** A correct J4
would either match the camera state across both arms or restrict the digest to
the identity and provenance rows. That is an amendment for a new cycle; this
campaign measures and reports.

---

## 9. Consequences

**Accepted.**

1. Criterion #3 is discharged by measurement, through ADR 0047's
   measured-equivalent clause, with G2's weakness stated: the byte budget was
   never pressed at its own assumption.
2. Criterion #5 is discharged at these five stations and through the storm, off
   the vsync floor, with the nadir overview passing by 0.1 ms and D-11 carried at
   a larger measured value than D-11 itself records.
3. Criterion #7 is discharged: eviction is reachable and correct, re-entry is
   clean, selection identity survives an eviction cycle, and the request ceiling
   is a provable 4 everywhere.
4. Criterion #8 is discharged for four of five journeys, with J4's failure and
   its diagnosis on the record.

**Not discharged, and named.**

5. **Criterion #4 does not close.** L2 is a pre-registered HONEST-STOP with two
   stated reachability routes. L1 demonstrates the mechanism on 14 buildings and
   claims nothing more.
6. **J4 fails** and its amendment belongs to a new cycle.
7. **The E-1 forcing argument is undecided** by this instrument, and the reading
   that would decide it is named.
8. **E-1f stays open**: no canvas pick on re-admitted geometry has ever been
   captured.

**Carried, unchanged.** D-11 (double-draw), and the limit of the Blender
inheritance (94 sampled buildings, not 44,989).

---

## 10. What this campaign is not

Passing these gates is not visual, geographic, factual, accessibility or
performance acceptance. Every reading is one session, on one machine
(Chrome/151.0.7922.138, Cesium 1.143.0, a ~120 Hz display), at the poses named in
the pre-registration, against a bundle carrying three probes an ordinary
production build compiles out. Nothing here generalises past that, and the
records say so in their own words rather than leaving it to be inferred.
