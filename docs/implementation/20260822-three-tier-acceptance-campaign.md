# The three-tier acceptance campaign: two failures, and they belong to different changes

Task: T007 (Issue #107)
Branch: `fcp/107-acceptance`
Date: 2026-08-22
Status: **the three-tier default is NOT accepted**

| | count |
| --- | --- |
| PASS | 10 |
| FAIL (product) | 2 |
| FAIL (instrument scope) | 2 |
| NOT-CAPTURED | 3 |
| REPORTED | 5 |

## The two failures, and whose they are

**F1 fails at one station of five, and it is the far tier's.**
`overview-52km-island` — the maximum-residency pose, where the far tier holds
essentially the whole island — read **p50 16.8 ms** against 16.7 and **p95
25.2 ms** against 25, over 621 rAF deltas. Both percentiles missed by a tenth or
two of a millisecond, and it is recorded as a FAIL rather than rounded into a
pass. A bar with a tolerance nobody registered is not a bar.

It was **pre-declared before any capture** that far-tier-dominated stations may
fail F1, citing T005's p95 of 198 ms. The bar was not moved when the pre-declared
outcome arrived.

**J2 fails, and it is not.** A searched building's details panel carries one of
four rows where the frozen T006 baseline carried all four, at the same query and
the same pose. Re-run with `farTier=off` and the loss reproduces exactly. The
cause is the `-s1` → `-s2` two-LOD promotion changing which cells are resident,
recorded against ADR 0057.

The consequence for rollback is sharp: **flipping the far tier off would not fix
the one user-visible failure this campaign found.**

## G1-far: the mip question, settled to the byte

The GPU texture probe had never been validated against a far-tier tile, so the
B-series was gated behind it passing at exactly zero:

| hypothesis | bytes | delta vs probe |
| --- | --- | --- |
| no mips | 212,467,712 | short 70,822,291 |
| **truncated 4/3** | **283,290,003** | **0** |
| exact mip pyramid | 283,289,164 | short exactly **839** |

Cesium generates the chain, and accounts for it with the truncated 4/3
approximation — the exact pyramid being short by precisely one byte per tile
identifies the convention rather than merely bounding it.

The isolation was unusually clean: with `exteriorStreaming=off` in both arms, the
far-tier-off arm read **0** texture and **0** geometry bytes, so the "delta" is
not a subtraction at all. And 839 atlases rather than 840 — the absent one is the
Block 835 alias T005 recorded as `notDeclared` — reconciles to the byte:
283,639,528 − 283,290,003 = **349,525 = exactly B2** for one 256² atlas.

**B3/B4/B5 PASS** at ~3% headroom each, in decoded GPU bytes, compared with
nothing in file bytes. Nothing was evicted, so no eviction pressure was
exercised; the residency is REPORTED, not offered as a B-series verdict.

## The acceptance instruments are far-tier-blind, and it shows

The committed G1/G2/G3 gates FAIL for **scope**. G1 attributes every texture byte
to a known count of wave class tiles; with the far tier armed it is short by
exactly the far-tier residency — **263,367,077 − 263,017,553 = 349,524 =
4 × 87,381**, the four-tile prediction to the byte. G2 implies 3,245 class tiles
where 24 were expected. J1's boot-document filter is pinned to `-s1` ids. None of
these is evidence about the product; all three are instruments left behind by a
composition change.

This is what the pre-registration meant when it required a new harness: the three
committed acceptance harnesses do not read one `data-far-tier-*` attribute
between them.

## What was not measured

**M1 heap: NOT-CAPTURED**, three instrument-failure aborts, no attempt past lap 2
of 9, no record written by the instrument on any of them. Its own guard —
*focus/visibility changed mid-run* — fired twice from different laps on a machine
simultaneously running another browser under agent control. The stopping rule was
stated before the outcome was known. NOT-CAPTURED is the difference between "the
city leaks" and "this vehicle could not measure whether it leaks", and only the
second is supported.

The interim samples are published and labelled: retained heap oscillated 952.7 →
993.0 → 959.2 → 981.5 MB within about 4%, resident cells steady at 8, `released`
rising monotonically. **That is not a pass** — M1 needs eight sampled laps.

**J6 and J7: NOT-CAPTURED.** J6 cross-references an eviction record this campaign
did not produce; J7's separate invocation was pre-empted.

## Three-tier composition: verified, never assumed

Both 260 m street stations carry all three tiers at once — massing 251/154,
exterior resident 8, far tier drawn 738/811, publish sequences advancing.

The counter-finding matters more: the three **overview** stations and the P2
oblique pose are **two-tier**, `massingActive` 0. A campaign that inferred
composition from geometry would have called them three-tier and been wrong at
four poses of six. The ring is dual-keyed; composition is read or it is not known.

## Aborts, disclosed

Seven instrument-failure aborts across the campaign, none of them a verdict:

- frames ×2 — the harness's G1 scene opts into `-s1`, unstaged; then, with all
  six `-s1` staged and verified, **staged-after-build data is invisible to the
  browser** (`vite preview` serves `dist/`, and `public/data` is copied in at
  build time). Diagnosed by asking the page which URL failed rather than guessing
  a third time.
- journeys ×1 — a re-run that **falsified my own warm-profile hypothesis** for J1
  and is recorded as falsified rather than dropped.
- heap ×3 — no dedicated Chrome; then the focus guard twice.
- pre-flight ×1 — **it aborted on its own uncommitted state**, the first thing it
  was pointed at.

## The pre-registration held

Nothing was measured before it was committed; no bar moved after a capture; the
frozen 20260817 and 20260815 evidence is byte-identical at **both** ends of the
campaign, checked by the same pre-flight that opened it.

## Not claimed

- One machine, one session, AC power. No distribution, no confidence interval.
- Passing gates are not visual, geographic or accessibility acceptance.
- **D-11 is not closed**, in either direction: max `doubleDrawMs` 6,165.2 ms is a
  named carry, and a value below the bar would not have closed it either.
- Criterion #30 is closed elsewhere, reported in its own units, added to nothing.
- Load times are warm-cache readings and are **not** comparable with T005's cold
  4,511–7,529 ms.
