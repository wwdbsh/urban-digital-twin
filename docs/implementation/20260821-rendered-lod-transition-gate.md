# The rendered LOD-transition gate: one honest stop, and two real failures

Task: T006 (Issue #106)
Branch: `fcp/106-lod-transition`
Date: 2026-08-21
Status: **measurement half HONEST-STOPPED with arithmetic; shed-tone half RUN, 2 FAIL / 3 INCONCLUSIVE**

## The bar is carried. The instrument is not.

The 2% deviation bar comes from criterion 19 and is enforced by
`multi-lod-assembly.ts`. Every 2% number in this repository was produced by
`block835_v3_author.py::measure_silhouette`: Blender, orthographic, four
axis-aligned views, the subject **isolated** with `hide_render`, `ortho_scale`
set from the subject's own bounds so it fills the frame.

T006's instrument is CesiumJS in the shipped app: perspective, no isolation
available, magnification pinned by the ring. No part of this task presents the
second as the instrument the first was written against, and a test pins that
distinction so a later edit cannot blur it.

The repository had already ruled on this class of instrument at this bar.
`midtown-core-v3-silhouette.ts` abandoned rasterization for an exact integer
sweep because "a 512-pixel raster's own quantization is the same order as the
ratios being compared against a 2% cap" — and that was an *orthographic* view
with the subject *filling the frame*.

## The measurement half: one honest stop

| term | what it is | value |
| --- | --- | --- |
| T1 | boundary quantization, perimeter × 1px / area | size-dependent |
| T2 | ring scale delta, 1 − (399/401)² | **0.995%**, identical for every building |
| T3 | registration residual, perimeter × 0.5px / area | size-dependent |
| T4 | isolation | **unbounded**, deliberately unnumbered |

| stratum | budget min | median | max | under 2% |
| --- | --- | --- | --- | --- |
| measured-fallback census (424) | 5.98% | 10.89% | 35.06% | **0 / 424** |
| near-cap, deviation ∈ [0.0185, 0.02) (53) | 6.57% | 10.64% | 20.65% | **0 / 53** |
| sky-silhouette availability | — | — | — | stopped; see below |

The emitted total omits T4 and computes area from the bounding rectangle, which
overstates area and understates the ratio. It is an **optimistic lower bound**: a
pessimistic budget cannot rescue a bar the optimistic one already fails.

**The structural reason is that magnification is pinned by the thing being
tested.** The frozen instrument chooses its own scale; the in-app instrument
cannot, because the level only flips at the ring, and moving closer to gain
pixels destroys the transition under test. A target needs ~40,000 device px² — a
projected 2,112 m², say 46 m × 46 m — before the boundary term alone clears 2%.
The largest member of the census projects 931 m².

A bigger viewport does not rescue it: 0/424 at 1×, 2× and 4×; only at 8×
(12,640 vertical device px) do 97/424 clear, and that subset is selected by
**size**, so it is a biased stratum and not the census.

The sky-silhouette stratum was defined to buy back T4 by choosing targets whose
outline meets sky. It cannot: the census tops out at 47.2 m and the near-cap set
at 26.3 m, and buildings that size in Manhattan are enclosed by taller
neighbours. Even granting perfect isolation, T1 and T3 alone already exceed the
bar for every member. Its selection bias — tall, isolated, corner buildings,
exactly the population most likely to pass — is recorded even though the stratum
is stopped.

**No sample was drawn and no seed burned.** Feeding an instrument that cannot
resolve the bar would manufacture the appearance of a measurement. The frame is
committed and checksummed so a successor inherits it ready to use.

**Named missing capability:** a forced-LOD and isolation hook — the ability to
render a named building at a chosen level, alone, from a camera the measurement
picks rather than the ring dictates. That is a `src/` runtime change this task is
forbidden to make, so it is named instead of quietly added.

## The census: 424, dual-derived, agreeing

- (i) **424** from the six shipped `-s2` assembly packages, by
  `lod_0.maxDistanceMeters === null AND lod_1.eligible === false`, over 44,989
  assets scanned.
- (ii) **425** over-cap buildings in the T004 island pass, minus **1**
  asset-stage `volume-identity-failed` tombstone.

Intersection 424; nothing in the manifests outside the island pass. The single
difference is `doitt:263078`, removed from the **frame** in Stage 0, before any
draw — never pruned after a reading.

## The shed-tone half: what ADR 0056 handed forward

ADR 0056 owns the flaw in its own pre-registered shed measure — it conflated
silhouette **area** with tone — and asked its successor for an instrument that
separates the two **by construction**, under the shipped renderer.

The area half of that conflation is exactly what is honest-stopped above. The
tone half is a different measure with a different error structure: a mean Rec.709
luminance over the **intersection of both arms' surface masks, eroded 3 px from
every boundary**. With the boundary removed, neither antialiasing, nor the
sub-pixel registration residual, nor the scale edge can reach the number. That is
the separation, as a property of the instrument rather than an argument about it.

### The straddle: the pre-registration was wrong about the mechanism

Pre-registration assumed the arms differ by the **cell** distance crossing 400 m.
Measured: at a 120 m / −60° oblique pose the scheduler probe reported the target
cell at **65,287 m**, because `unitDistanceMeters` measures from the viewport
footprint's **ground centre**, which for an oblique view sits tens of km ahead.

What actually governs is the fallback: `lodDistanceFor` returns
`exteriorCameraHeightBucketMeters = max(50, round(height/100)*100)` when the cell
is absent from the measured map, and that bucket crosses 400 → 500 at **450 m of
camera height**. The straddle used is **449 m and 450 m**, same ground position,
same heading, same pitch, verified **at the wire**: 449 fetched `__lod_0.glb` and
not `__lod_1.glb`; 450 the reverse.

This is *better* than what was pre-registered — the residual scale delta is
1/450 = 0.22% rather than 0.50%, and only height changes — but it is a departure
and it is recorded as one rather than quietly used.

It does **not** soften the honest stop: at 449 m and −60° the slant depth is
518 m and the scale is 3.4 device px/m, *worse* than the 4.35 the budget assumed.

### The negative control

Two arms are two captures, so something differs even when nothing should. A
measured-fallback parent has **no eligible `lod_1`** and therefore serves `lod_0`
at both heights — any difference it shows is instrument and nothing else.

**`doitt:401323`: instrument error 0.591%**, on 2,520 interior pixels, with
**zero** surface disagreement between arms. That is the floor a shed reading must
clear, and it sits comfortably inside the 2% bar.

The treatment CLI refuses any pair whose far arm did not fetch `lod_1`. The
control cannot satisfy that rule by construction — and **the rule was not relaxed
to let it through**. It is run separately, on the same code path, with the
expectation that is correct for it.

### Results

| pair | verdict | interior px | ratio | deviation | note |
| --- | --- | --- | --- | --- | --- |
| `doitt:10049` | **FAIL** | 2,368 | 0.962206 | **3.78%** | 6.4× the instrument floor |
| `doitt:147902` | **FAIL** | 1,008 | 0.811494 | **18.85%** | 32× the floor; not marginal |
| `doitt:100749` | INCONCLUSIVE | 560 | — | — | interior below the 1,000 px threshold fixed before capture |
| `doitt:100368` | INCONCLUSIVE | 320 | — | — | far arm fetched **both** levels; wire cannot say which drew |
| `doitt:100176` | INCONCLUSIVE | 520 | — | — | both refusals apply |
| *control* `doitt:401323` | — | 2,520 | 0.994087 | 0.591% | instrument floor |

**The 1,000-pixel threshold was not relaxed after seeing that it refused three
pairs.** Relaxing a pre-registered threshold to rescue a reading is the exact
failure this task exists to avoid.

Every capture: settled under T005's rule verbatim (48 s dwell, then four
consecutive identical reads at 6 s spacing), canvas-visibility control passed
(canvas visible, chrome hidden), single attempt per arm, no re-captures.

## What this settles, and what it does not

**Two of the five ADR 0056 shed pairs are settled as FAILS** under the shipped
renderer, with a measured instrument floor. Three remain open. The residue is
smaller and better characterised; it is **not closed**.

## Not claimed here

- Not an island bound. 424 is a census; the shed work is five named pairs.
- Not a per-wave bound. No confidence interval, anywhere.
- Not visual acceptance. ADR 0050: "A coarse level inside a 2% area ratio can
  still read wrongly on screen, and a fallback level is not evidence about the
  other 99%."
- The honest stop is about **this instrument at this bar**. It is not a claim
  that the shipped LOD transition is wrong, nor that it is right.
- One control on one building bounds this campaign at this pose. It is not a
  distribution.
- No T007 reading (frame time, residency, eviction, double-draw) was used as a
  T006 verdict.

## Follow-ups

- **The three INCONCLUSIVE shed pairs** carry forward on the ADR 0056 residue
  entry, with the reason each was refused.
- **The forced-LOD and isolation hook** is the follow-up for the honest-stopped
  half. Until a runtime affords it, the rendered silhouette gate at 2% is not
  measurable in-app.
- **The ring's dual keying** (`measuredDistances` versus the height bucket) is
  recorded in the ADR 0057 amendment; the next gate designed against the ring
  should know which quantity it is actually testing.
