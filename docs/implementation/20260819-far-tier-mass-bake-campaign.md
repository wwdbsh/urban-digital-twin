# The far-tier mass bake: 840 tiles, 43 named stops, and a bug that refused 22 cells

Task: T004 (Goal `manhattan-hlod-far-tier`, Issue #104)
Branch: `fcp/104-mass-bake`
Date: 2026-08-19
Status: **Campaign complete. Coverage closes. No serving surface changed.**

## Stage 0 — v4, adopted the hard way

v4 is v3's colour over v2's packing. It went through a pre-registered cycle
because T013's gate adoption made that a condition of using A3'' — a post-hoc
bar cannot certify a new recipe.

The prediction was that flat-face colours are identical by construction and only
the atlas layout moves. **That claim needed a test that did not exist**:
`far-tier-bake.test.ts` pinned the rect SIZES (1×1 vs 4×4), which passes just as
happily if the colour is recomputed differently at a different size. The new test
pins the BYTES, and the pre-registration cites it.

Result: agreement to **0.001999** against a 0.01 allowance; A1, A2, A3'' and byte
replay all PASS. Applied scale on the prototype went 0.5 → 0.7071.

## The bug that mattered

w01's first run recorded **22 cells as `packing-infeasible`** — a class the
pre-registration predicted zero of. The counts alone looked like a finding about
v4. The MESSAGE said otherwise: *"each face costs at least 64 texels, so this
atlas holds at most 1024"*. Those are v1's numbers.

The per-cell additivity gate bakes a **v1 reference first**, and I let its
refusal propagate as the cell's refusal. Midtown has cells of 1,031–1,853 faces
that v4 packs comfortably and v1 cannot pack at all. Twenty-two real cells were
recorded as infeasible under a recipe that handles them. **The tiles were never
wrong — they were never built.**

The fix distinguishes the two cases: where v1 can pack, the gate runs and a
mismatch still fails the cell; where it cannot, the gate reports NOT-APPLICABLE
with its reason. The tolerance is exactly one stop code and no wider. Telemetry
now counts "checked" (681) apart from "could not be checked" (159).

**The lesson is cheap and general: read the refusal text, not the refusal count.**

## Campaign

840 tiles, 43 honest stops (all `fallback-share-over-bar`), every other class
zero, coverage arithmetic closes machine-checked, 840 cells byte-replayed with
0 mismatches. Median applied scale 0.707107 against 0.5 under v1 packing;
90.95% still under-resolved and reported as such.

Ordering is structural: `run-wave` cannot write an inventory and `seal` cannot
bake, so "no wave inventory before that wave's replay" is a property of the tool.

## Characterization — and a second bug

A single-building cell rendered **zero pixels for both subjects** at 400 m while
showing 102 at 1,200 m, which is geometrically impossible for a correctly aimed
camera. Cause: `matrix_world` was read immediately after setting `o.location`,
before the depsgraph updated, so the camera was aimed at the subject's
**untranslated** bounds. On a 48-building cell that error is invisible — the
subject is 267 m across; on a one-building cell it aims at empty space. Fixed
with an explicit `view_layer.update()` and every sample render redone.

The measurements are **read from a file Blender writes**, not hand-transcribed:
72 channel triples with no check between the instrument and the record is a
transcription error waiting to happen.

**The result exceeded its prediction, and the interesting part is which gate
failed.** A3'' held at 33/36 with all misses on the smallest cell. A1 passes 8 of
18 and A2 24 of 36, and **every miss is the tile reading brighter**. The largest
and median cells pass everything; the prototype sits with them. The prototype is
not representative for luminance, and that is the campaign's finding for T007.

## What was not done

No serving surface changed. No eviction policy written — named for T005 with its
arithmetic: at 307,911 bytes a tile the 64 MiB ceiling admits 217 and binds first.
