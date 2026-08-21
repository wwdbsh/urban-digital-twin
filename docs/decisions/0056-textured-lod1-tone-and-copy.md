# ADR 0056 — Textured LOD 1: tone carry-over, and copy rather than re-emit

Status: accepted for the T009 `-c2` retention campaign. It changes no approved
release, no serving surface and no runtime default.
Date: 2026-08-17
Task: T009
Supersedes: the DISPOSITION of `data/lod1-texturing-20260817/stage0-gate.json`,
whose `verdict` reads "NO-GO FOR THE CAMPAIGN AS CONTRACTED; RESCOPE-RECOMMENDED"
and whose `amendment2026_08_17.verdict` reads "RESCOPE". Neither is retracted —
both remain the correct reading of the evidence that stage gathered, and the
sequence is readable in that record's own `supersededBy` and
`finalDisposition2026_08_17` fields, which carry the user's decision. This ADR
records what was DONE and why; Stage 0 records what the evidence RECOMMENDED, and
they disagree on the disposition rather than on any measurement.

Amends nothing. Records the decision history that ADR 0048 through 0055 left open
for the coarse level's appearance.

## The decision history, preserved rather than smoothed

**Stage 0 recommended RESCOPE, and it was right on the evidence.** The campaign
was contracted on the premise that lod_1 is untextured and therefore visibly
deficient at mid ring. Measurement confirmed the first half island-wide — 0 of
44,989 lod_1 assets carried any image or `TEXCOORD_0` — and contradicted the
second. lod_1 was never uncoloured: all 341,634 of its materials declared a
`baseColorFactor`, every one exactly `k/255`.

**The decisive finding was that the two levels were on two palettes.** lod_0
carried 306,918 CONTINUOUS factors (the tile tint) plus 89,978 quantized ones
(the untextured caps, exactly two per building); lod_1 carried 341,634 quantized
and zero continuous. Because the class tiles are GRAYSCALE with means 0.8387 to
0.8894, a faithfully reconciled lod_1 would satisfy `factor_lod1 = factor_lod0 x
tileMean` with the same scalar on all three channels. The measured ratios varied
12.3% ACROSS channels, which a grayscale tile cannot produce — so the defect was
a HUE error, and the visible mid-ring problem was TONE, not missing detail.

**The render confirmed it.** One screen pixel spans 12.8 to 44.9 texels at 350 m
and 4.4 to 15.4 at 120 m, so the tile is sub-pixel at both distances tested. The
decisive frame was `lod0flat` — lod_0 with the tile REMOVED but its mean tone
preserved — which rendered very close to shipped lod_0, while shipped lod_1 was
visibly bleached and cooler.

**The user chose the campaign anyway**, on a maximum-completeness posture rather
than a dispute with the measurement, and that is recorded as a DECISION rather
than re-argued as a finding. Nothing Stage 0 measured is withdrawn: the tile
remains sub-pixel, the tone gap remains the visible defect, and the rescope
remains the cheaper remedy for it.

## Decision 1 — the coarse level carries lod_0's continuous palette

Binding: textured lod_1 must carry lod_0's CONTINUOUS tile-tint palette, not
lod_1's quantized one. `factor x grayscale tile` then reproduces lod_0's exact
rendered appearance and the 11-16% tone gap closes BY CONSTRUCTION. Binding the
tile to the quantized palette would have darkened an already-cooler surface by
the tile mean and made the discontinuity WORSE — the outcome Stage 0 warned about.

**No code change was required, and that was verified rather than assumed.**
`v3GeometryForGlb` derives every factor from `options.texture` plus
`V3T_CALIBRATED_PALETTE[plan.styleClass][material.id]` and the tile mean. Nothing
in that derivation reads the level of detail, and both levels are tessellations
of the SAME plan. Verified from emitted bytes two ways over 58 buildings across
all six waves: set CONTAINMENT of lod_1's factors in lod_0's, 446/446 with 0
uncontained; and element-for-element equality of the plan-ordered material arrays
at the seam, 58/58 at exact equality. The retained `-c1` lod_1 is the control at
446/446 quantized.

The quantized residue is the untextured caps and nothing else — exactly 2 per
building — and the drift test asserts that exact figure rather than "mostly
continuous", because a looser assertion would let a textured surface slip back
onto the old palette unnoticed.

## Decision 2 — lod_0 is COPIED, never re-emitted

Every GLB embeds `inventoryId` and `evidenceShardId` in its canonical metadata,
both derived from `profile.releaseId`, and the assembly replay compares those
embedded strings to the manifest asset FIELD FOR FIELD. So a GLB emitted under a
`-c2` releaseId can never sit beside a lod_0 copied from `-c1`.

**The campaign keeps ONE identity across both levels.** The emission profile
carries the `-c1` releaseId, exactly as gate 2b ran it, and `-c2` names the
release WRAPPER only. That is also the truthful reading: `inventoryId` names a
building's component inventory, which is derived from the plan and is identical
between the two releases. Only the coarse level's material binding changed.

Copying is done by READING AND WRITING BYTES, never `cpSync`, which can reproduce
a symlink instead of its target — the w00 corruption incident. The retention
validator refuses symlinked artifacts outright, so a symlink fails the wave
rather than shipping. Every copy is verified twice: against the `-c1` inventory
and against what the writer still emits. 44,989 of 44,989 on both, across six
waves.

## Decision 3 — the E adjudication, carried forward verbatim

> `-c2` keeps `maxDistanceMeters: null` both levels and `eligible: false` for the
> 424; T001 owns distinct thresholds in `-s2` (or the ADR 0052 tie rule collapses
> the mid ring to lod_0).

Honoured and checked in the bytes: every declared level across all 883 cell
manifests carries `maxDistanceMeters: null`, and exactly 424 lod_1 levels carry
`eligible: false` — the same fallback parents `-c1` declared. Texturing an
ineligible coarse level does not make it selectable.

## What the appearance sampling did and did not establish

Pre-registered before any still existed. **The FALLBACK cell passes outright:
15/15 pairs at a luminance ratio of exactly 1.000000 with a per-channel spread of
exactly 0.0.** That cell holds geometry constant, so it isolates the material
binding, and it is the cell that settles the palette question.

**The SHED cell MISSES its pre-registered bar on 12 of 24 pairs.** A post-hoc
intersection measure attributes most of the dip to the pre-registered measure
conflating silhouette AREA with tone — a flaw in the measure, owned here — and
recovers 19/24, but 5 pairs remain unexplained and the pre-registered result
stands as a MISS. The campaign therefore does NOT establish that every shed lod_1
matches its lod_0 in tone at mid distance.

**The shed result is RENDERER-DEPENDENT and the fallback result is not.** EEVEE is
not the shipped renderer — CesiumJS draws the app — and what transfers from a
Blender comparison is the geometry of the comparison and the pixel arithmetic,
not an absolute appearance claim. That caveat binds the shed MISS. It does NOT
bind the fallback PASS, which holds by construction: a fallback pair is the SAME
geometry with the SAME UVs referencing the SAME tile, and the palette check
proved the two levels' `baseColorFactor`s equal at exact equality, so any
renderer that is a function of its inputs must draw them identically. The 15/15
confirms the emitted bytes rather than the rasterizer.

## What is NOT decided here

- **The shed-tone residue is NOT settled, and T006 remains its owner.** T006
  ran a campaign under the shipped renderer, **withdrew it**, re-ran it, and
  returns **INCONCLUSIVE-BY-INSTRUMENT on all five pairs**.

  An earlier revision of this entry claimed two settled FAILs — `doitt:10049` at
  3.78% and `doitt:147902` at 18.85%, against a 0.591% instrument floor. **Those
  numbers are withdrawn.** They came from a campaign that applied canvas-space
  regions of interest to whole-window captures with no origin correction, and so
  measured a patch 184 px left and 120 px above every target.

  The corrected campaign fixes that and still cannot produce verdicts, for a
  reason worth recording: **the wire-level control proves a byte arrived, not
  that it was rasterized.** At the near arm of two pairs the target's GLB was
  fetched while its own projected bounding box renders 99–100% procedural
  massing. One pair produced a 0.008% "PASS" that turns out to be massing
  compared against massing. The identity check that would have caught this — pick
  the pose and read which feature the app reports — returned **no feature at all
  twelve poses**.

  What it would take is the same capability T006's Stage 0 honest stop names: a
  runtime hook that renders a named building at a chosen level, isolated, from a
  camera the measurement picks. See
  `data/far-tier-lod-transition-20260821/shed-tone-results-v2.json`.

- **The shed-tone residue as originally handed to T006:** Five shed pairs remain outside 2% even
  under the post-hoc intersection measure, and settling them needs an instrument
  that separates geometry from tone BY CONSTRUCTION, agreed in advance, under
  the shipped renderer rather than EEVEE. The five are named here so the
  successor gate can target them instead of re-sampling the island:
  `doitt:100749`, `doitt:10049`, `doitt:147902`, `doitt:100368`,
  `doitt:100176`.
- Whether any `-c2` package is ever served. It is not, and nothing in
  `src/runtime/` can reach one.
- Distinct LOD distance thresholds, which belong to T001's `-s2`.
- Any visual, geographic, architectural, accessibility or performance acceptance.
