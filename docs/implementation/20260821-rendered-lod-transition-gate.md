# The rendered LOD-transition gate: one honest stop, and two real failures

Task: T006 (Issue #106)
Branch: `fcp/106-lod-transition`
Date: 2026-08-21
Status: **measurement half HONEST-STOPPED with arithmetic; shed-tone half RUN, WITHDRAWN, RE-RUN — all six INCONCLUSIVE-BY-INSTRUMENT**

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
pixels destroys the transition under test. A target needs ~**356,440** device px² before the *total* budget clears 2% —
T2 spends 0.995% of the bar before any pixel is counted and T3 rides the same
perimeter as T1, so the requirement is 6/√A < 0.02 − T2. (The often-quoted
40,000 px² is T1 **alone** and is not the operative figure.) At 4.3627 device
px/m at the near arm that is a projected **18,724 m²**; the largest member of the
census projects 931 m².

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

### The first campaign was withdrawn

The first shed-tone campaign emitted regions of interest in **canvas** device
coordinates and applied them to **whole-window** captures (2194×1788, canvas box
at origin 184,120) with no origin correction. Every reading measured a patch
(−184, −120) away from its target. Its verdicts — a 3.78% FAIL, an 18.85% FAIL
and a 0.591% instrument floor — are **withdrawn**. The record is kept unedited
with a supersession statement so the defect stays inspectable; the compare tool
now carries `canvasOrigin`/`canvasSize`/`imageSize` and **refuses** when a
capture is not the registered window, when the canvas box does not fit inside
it, or when the region leaves the canvas. Four tests hold those refusals shut.

### The corrected campaign, and why it still yields no verdicts

| pair | wire (near → far) | ROI massing share (near / far) | identity | verdict |
| --- | --- | --- | --- | --- |
| `doitt:401323` *(control)* | lod_0 → lod_0 | 0.000 / 0.000 | ✗ | INCONCLUSIVE-BY-INSTRUMENT |
| `doitt:100749` | lod_0 → lod_1 | **1.000** / 0.000 | ✗ | INCONCLUSIVE-BY-INSTRUMENT |
| `doitt:10049` | lod_0 → lod_1 | **0.992** / 0.000 | ✗ | INCONCLUSIVE-BY-INSTRUMENT |
| `doitt:147902` | lod_0 → lod_1 | **1.000** / **1.000** | ✗ | INCONCLUSIVE-BY-INSTRUMENT |
| `doitt:100368` | lod_0 → lod_0 | 0.000 / 0.000 | ✗ | INCONCLUSIVE-BY-INSTRUMENT |
| `doitt:100176` | lod_0 → both | 0.000 / 0.000 | ✗ | INCONCLUSIVE-BY-INSTRUMENT |

Three findings, and the first is the one that matters beyond this task:

1. **The wire-level control is necessary and not sufficient.** It proves a byte
   *arrived*; it cannot prove that byte was *rasterized* at the region measured.
   At the near arm of `doitt:100749` and `doitt:10049` the target GLB was fetched
   while the pixels inside its own projected bounding box are 99–100% procedural
   massing. `doitt:147902` produced a **0.008% "PASS"** that is massing compared
   against massing — a false pass that only the composition check exposes.
2. **The pick validation failed everywhere.** The pre-registered identity check
   returned **no feature at all twelve poses**, and a further grid of eight
   probes across the viewport returned none either.
3. **The mask control is structurally inert.** `surfaceInBothArms` equals the
   full region for all six pairs: massing and facade both sit far above the
   background luminance ceiling, so the mask separates nothing and the occlusion
   refusal cannot fire. Isolation here is by **region placement alone**, with the
   pick as the identity check — and the pick did not answer.

The control's corrected floor is **0.869%** (the withdrawn campaign said 0.591%).
It is reported, not promoted to a verdict: the treatment rule refuses the control
by construction and **the rule was not relaxed** to admit it.

**Disclosed deviation.** The pre-registration budgeted 5,400–28,546 interior
pixels at 4.35 device px/m. The pose the ring forces gives 3.41–3.48 px/m at a
518 m slant depth, and realised interiors were 1,470–9,480 px. The first campaign
compounded this by shrinking each region to 55% of the projected extents
(320–2,520 px) and did not disclose it. The corrected campaign uses full extents,
and the gap is disclosed here.

## What this settles, and what it does not

**Nothing of the ADR 0056 residue is settled.** All five pairs are
INCONCLUSIVE-BY-INSTRUMENT, and T006 remains the owner. What T006 adds is a
sharper account of *why*: identity cannot be established from outside the
renderer, and the wire-level control that looked sufficient is not.

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

- **All five shed pairs** carry forward on the ADR 0056 residue entry, with the
  identity failure recorded as the reason none could be scored.
- **An identity check that works from outside the renderer.** The pick returned
  no feature at any pose, and without it the wire-level control cannot
  distinguish "the byte arrived" from "the byte was drawn here". Any successor
  gate needs this before it needs a better camera.
- **The forced-LOD and isolation hook** is the follow-up for the honest-stopped
  half. Until a runtime affords it, the rendered silhouette gate at 2% is not
  measurable in-app.
- **The ring's dual keying** (`measuredDistances` versus the height bucket) is
  recorded in the ADR 0057 amendment; the next gate designed against the ring
  should know which quantity it is actually testing.
