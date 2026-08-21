# The far-tier promotion: activated, on the second sweep

Task: T005 (Goal `manhattan-hlod-far-tier`, Issue #105)
Branch: `fcp/105-promotion`
Date: 2026-08-21
Status: **ACTIVATED. `FAR_TIER_DEFAULT_ON = true`.**

Supersedes, without correcting in place,
`docs/implementation/20260819-far-tier-promotion-attempt.md`.

## The one thing that changed

Sweep-1 failed at P2, the only oblique pose, reporting **11,867 of 23,959**
loaded massing buildings drawing at full alpha under drawn far-tier tiles, and
unstably so (12,485 → 26 → 11,867). The flip was reverted. That was the right
call on the evidence available, and the FAIL stands unedited in the record.

**It was a stale published reading, not unsuppressed massing.** The scene was
correct at P2 the entire time.

`publishFarTierState()` was called at the moment the drawn-cell set advanced —
before `farTierCovered` was computed, and long before `applyFarTierAlpha` wrote
anything. A reading therefore paired a **new** drawn set with the **previous**
pass's applied-alpha set, and because the pass never published again, that stale
pairing stood as the last word until some later pass happened to change the
drawn set. At a wide oblique pose, where tiles become ready in large batches, the
gap was thousands of buildings wide and looked exactly like lost alpha writes.

Four measurements exclude the race that was suspected:

| what was measured | reading | what it rules out |
| --- | --- | --- |
| `passUncovered` at selection time | **0**, while the published attribute read thousands | the selection pass is correct |
| `desiredCovered` vs `appliedCovered` | **equal**, always | no alpha write was ever skipped |
| classification of every uncovered id | 100% **`notDesired`** | not a lost write; the covered set never held them |
| drawn set: published vs pass | **839** vs **776** | the two halves were one pass apart |

On a cold cache it reproduced as **6,145 uncovered, stable for 80 s and never
healing** — a stuck stale reading, not an intermittent race.

## Why this keeps happening, and what was done about it

This is the **third** instrument defect on this one metric. Sweep-1 itself
disclosed two: a member metric that compared against buildings with no massing
loaded (reading 41,405 where the truth was 0), and a settle rule that fired on a
rebuild plateau. A metric with that history does not get another bare counter.

- The reading is now the pure function **`farTierCoverageReading`**, which
  classifies every uncovered id as `hidden` (ownership-suppressed — no massing on
  screen, not a defect), `desired` (an alpha write that did not land) or
  `notDesired` (drawn set and covered set disagree). The three are different
  bugs and used to be one number.
- **`data-far-tier-pass-uncovered`** publishes the same question asked at
  selection time. A published gap with `passUncovered` at 0 is staleness in the
  reading, never a lost write, and that is now one look instead of three
  revisions.
- The ordering itself is pinned by test: the drawn set advances at selection, the
  publish happens **after** the alpha write, and the rebuild commit publishes
  again after re-applying against the new index.

Fix commit `200446c`; tests in
`src/features/explorer/far-tier-coverage-reading.test.ts` (8 tests, including a
dense-rebuild-under-load case asserting no covered member is left at full alpha).

## Sweep-2

Registered in `sweep-poses.json` → `sweeps[]` **before any pose was read**, over
the **same six poses** sweep-1 was judged against — unchanged, not re-chosen
after a failure. Run on a production build (`pnpm build` + `pnpm preview`) of the
fix plus the flip, in the Orca embedded browser.

The settle rule is **blind to the verdict**: a capture is accepted only when the
dense layer has committed (`active > 0`) and the triple
`active / suppressible / covered` is identical across three reads 8 s apart. It
never inspects `uncovered`. Polling until a wanted number appears is not a settle
rule, and this one cannot do it.

| pose | states | suppressible / covered / uncovered | settled | verdict |
| --- | --- | --- | --- | --- |
| P1 1,400 m ⊥ | all clean | 2,520 / 2,520 / **0** | 32 s | PASS |
| **P2 2,400 m oblique** | all clean | 23,973 / 23,973 / **0** | 32 s | **PASS** |
| P3 honest-stop cell | all clean | 1 / 1 / **0** | 32 s | PASS |
| P4 densest cell | all clean | 3,757 / 3,757 / **0** | 32 s | PASS |
| P5 12 km ⊥ | all clean | 29,064 / 29,064 / **0** | 32 s | PASS |
| P6-OFF rollback | no far-tier UI at all | 25,021 active, 0 suppressible | 24 s | PASS |

`absent = checksum-mismatch = build-failure = over-budget = 0` at every ON pose.
`notDeclared = 1` throughout is the Block 835 alias cell, whose id encodes no
tile rectangle and which is named in the committed exemption set.

### Against the single-attempt policy

One capture pass was **discarded before any verdict was taken** and is disclosed
here rather than omitted: P1 produced no far-tier status element, and P2 read
`active = 0` with `appliedCovered = 0` — the dense layer had not committed, so
the reading measured an unloaded scene rather than the pose.

That discarded P2 reading had **`uncovered = 0`**. Accepting it would have been a
false PASS *in the direction being sought*; discarding it moved the reading away
from the desired answer, not toward it. The settle rule was then written to make
the precondition explicit and applied uniformly to all six poses. No pose was
re-read after a verdict was seen.

## The `<!doctype` errors, diagnosed

Sweep-1 recorded six repeated `Unexpected token '<', "<!doctype "` notices as
undiagnosed. `src/release/exterior-serving-waves.ts` declares six exterior
**serving** releases (`…-v3-s1`, `…-midtown-core-…-v3-s1`, `…-lower-manhattan-…-s1`,
`…-southern-remainder-…-s1`, `…-central-upper-manhattan-…-s1`,
`…-northern-manhattan-…-s1`). **None exists on disk** in this worktree or the
main checkout — they are generated, gitignored local data — and the SPA fallback
answers `/data/<id>/release.json` with `index.html`. Six declared packages, six
errors, one each. Verified by `curl` against the same server that served the
sweep.

Not the far tier, and not introduced by T005. Producing those packages means
running an acquisition/build/publish workflow, which `AGENTS.md` places behind an
explicitly approved operator workflow; **none was run**.

**This is a real limit on what both sweeps support.** The exterior LOD-0 wave
tier was absent from the vehicle. The sweeps measure the dense massing tier, the
far tier, and their interaction. Neither clears the three-tier composition with
exterior waves present.

## What ships, and what a rollback restores

Unchanged from the attempt record and repeated because it is the part a reader
needs: 840 tiles under one pinned inventory (`cf8e2648…`), budgets v2 at 288 MiB
of **declared file bytes** with a 2.0% margin in GPU units against the frozen
bar, eviction discharged rather than deferred, and the two island-scale defects
fixed (permanent over-budget refusal; the uninterruptible fill).

`FAR_TIER_DEFAULT_ON = false` restores the pre-HLOD **composition** — massing and
mid ring, no far-tier fetches — and **not** the raised ceilings, the swapped pin
or the merged inventory, which stay in the build. That is a third configuration
nobody has measured.

## Not claimed here

- A passing pose is not visual acceptance; that is T007's, and the
  bright-luminance caveat it owns is unaffected.
- Six passes do not generalise to poses that were not registered.
- Sweep-1 ran on `vite dev` and sweep-2 on a production build. The comparison
  between the two sweeps is **not vehicle-controlled**.
- The v1 → v4 recipe change beneath P1's tile is disclosed in the pose registry:
  a reader comparing sweep stills with T003's is comparing different bytes.
