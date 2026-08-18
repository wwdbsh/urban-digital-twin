# Far-tier hue: attribution, recipe v3, and the bar it does not reach

Task: T013 (Goal `manhattan-hlod-far-tier`, Issue #118)
Branch: `fcp/118-hue-integrity`
Date: 2026-08-19
Status: **Attribution complete. Recipe v3 implemented and captured. TWO
pre-registered bars MISSED; the task stops and reports.**

## What was open

T012 pinned the instrument and left two tile properties attributed but
**unexplained**: a 5.7% darkness at 4,000 m / azimuth 235, and a per-channel hue
spread over the 0.02 bar at five of six poses with **red always the deficit
channel** and the spread growing with distance. Its named untested candidate was
the atlas's 14.67% unused black area averaging in under minification.

## The colour path is exonerated, with arithmetic rather than argument

Every mechanism that could bend one channel between the palette and the
framebuffer was tested on the byte-identical v1 atlas, regenerated from the pinned
snapshot first (GLB `2f859925…`, atlas `c159e050…`).

| # | Hypothesis | Verdict | Number |
| --- | --- | --- | --- |
| H1 | Black atlas dilution | REJECTED | hue spread **1.11e-16**; linear pyramid preserves every channel mean exactly at all 8 levels |
| H2 | sRGB quantization | REJECTED (small, right sign area-weighted) | spread **0.00079**, 20–43× too small; green is lowest in the unweighted census |
| H3 | Zone-factor colour path | REJECTED | per-channel scale spread **0** to 15 decimals; **0** clamped texels |
| H4 | Source-side distance behaviour | CONFIRMED for the *growth* only | source R/B +3.33% az55; tile +2.62% |
| H5 | Instrument-side filtering | Structural asymmetry CONFIRMED, cause REJECTED | source hue is filter-invariant by construction |
| H6 | Gamma-space filtering (added) | REJECTED **by sign** | ratios run R>G>B at every level; would redden, not deplete |
| H7 | Source self-shadowing (added) | REJECTED, opposite direction | shadows off *widens* the gap, −2.57%→−5.44% |
| H8 | Material absorption (added) | CONFIRMED, minority | **14.1–36.4%** of the log(R/B) gap |
| H9 | Geometric simplification (added, residual) | CONFIRMED, majority | **63.6–85.9%** |

The observation that decided it: at 400 m the atlas is at **0.9368 texels per
pixel** — magnified — and the spread is already 0.0160/0.0258.

## The correction that was adjudicated, and what it did

Recipe **v3**: a wall zone's colour becomes the area-weighted linear-light
aggregate of the vertical facade, glazing and trim it stands in for. Additive over
**v1**; the facade-only path through the same code reproduces the committed v1
atlas byte for byte, and the bake refuses if it does not. The out-of-range guard
fired on the first run; the overshoot was one unit in the last place (2.22e-16) and
those ten zones are snapped and counted, with anything above 1e-9 still refused.
Attribution is total — 92,918.491 of 92,918.491 in-scope square metres.

Where the wall is visible it works: azimuth-55 spreads fall 0.015976→0.007363,
0.020627→0.011732, 0.022772→0.013714, and **3 of 6 poses now pass the legacy 0.02
bar against 1 of 6 before**. A1 and A2 pass everywhere and A1 *improved* at all
three applicable poses.

## Where it stops

**A3' (0.032) is missed at 4,000 m / azimuth 235 at 0.033824 — unchanged from v1 to
eight decimal places.** The prediction bar is missed at five of six poses on the
per-channel levels (worst 0.023051) while the spreads agreed to 0.0047 everywhere.

The reason is measured: the relative energy change between the v1 and v3 renders is
**4.6–4.8% at azimuth 55 and 1e-8 at the far azimuth-235 poses**, where exactly one
pixel moves by more than 1e-6. Those poses sit on the sun's terminator; their
visible signal is the **lit roof cap**, and v3 corrects walls.

So the azimuth-235 hue spread is not a wall-colour finding. The roof cap is the
named next candidate — **named, not measured**.

## Two process failures worth keeping

1. **A metric-transfer error survived the first attribution.** A share computed on
   log(R/B) was applied to a three-channel spread, producing a ceiling of ~0.027
   that both understated the worst case and hid a sign flip between the azimuths.
   The measurement was already on disk. Tests now recompute every decision number
   from the per-channel means beside it.
2. **A first draft of the pre-registration carried a non-regression clause its own
   prediction would have failed.** The clause was wrong, not the prediction; A1 is
   now stated as the bar it actually is, with the predicted regression declared in
   advance — and in the event it did not materialise.

## Also found

The pinned instrument spec's `maskSemantics` prose says per-channel ratios average
over the **union**; only the **intersection** reproduces the committed baseline, to
1.05e-4 against 0.023 for the next candidate. Recorded as a note beside the frozen
records, which are **not** edited. It moves no verdict: under the union domain every
spread is larger and the same five of six poses miss.
