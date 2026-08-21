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

Run over the **same six poses** sweep-1 was judged against — unchanged, and not
re-chosen after a failure. Those poses, their URLs, the exemption set, the
attempt policy and the verdict rule were **pre-registered in commit `3c5c64f`**,
before any screen was looked at. Run on a production build (`pnpm build` +
`pnpm preview`) of the fix plus the flip, in the Orca embedded browser.

The settle rule is **blind to the verdict** — a capture is accepted only when the
dense layer has committed (`active > 0`) and the triple
`active / suppressible / covered` is identical across three reads 8 s apart, and
it never inspects `uncovered` — and it was **fixed before any accepted capture**.
Said that way deliberately: **it was written after the first capture pass was
discarded**, not before the first pose was ever read. It was then applied
uniformly to all six accepted captures. A settle rule decides only *when* a
reading is taken; this one cannot be tuned toward a number it is structurally
unable to see.

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
explicitly approved operator workflow; **none was run** at the time of writing.

**Correction (2026-08-21), after an approved operator staging workflow.** The
generation named above is wrong. `exteriorDefaultActivations()` returns the six
`*_TWO_LOD_*` records, so a default session streams the six **`-s2`** two-LOD
releases; the `-s1` set is their superseded predecessor. The illustrative URL
`/data/<id>/release.json` is wrong too — the served manifest is `index.json`, and
`release.json` was a path this agent constructed rather than one the app
requests. Both mistakes were mine and neither was caught by the earlier check,
because six absent packages and six errors matched without the path ever being
confirmed against the app's own traffic. The count, the mechanism, and the
material consequence for both sweeps are unchanged, and staging the packages
confirmed them: all six errors gone, near/mid tier drawing facades.

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

## Review corrections (T005 review, 2026-08-21)

Two required record fixes, applied without re-measurement — no pose was re-read
and no number changed.

**B1 — the emit path would have destroyed this evidence.**
`scripts/far-tier-sweep-registry-cli.mjs` regenerates `sweep-poses.json` from the
ledger and rewrites its sidecar. It does not derive `sweeps[]`, and it never
could: the settle rule, the vehicle note and the discarded-capture disclosure are
facts about how a sweep was RUN, not about the ledger. A routine `emit` would
have overwritten all of it and re-pinned the sidecar to the sweep-1-era digest,
leaving a record that verified cleanly and had silently lost the only durable
account of sweep-2. **Mechanism chosen: fail closed.** The tool now refuses any
write whose bytes differ from what is on disk, names the top-level keys that
would be lost, and offers `--force` as the deliberate override — which still
prints what it is about to destroy. The guard covers `sweep-exemptions.json` on
the same path. Ten tests in `scripts/far-tier-sweep-registry.test.mjs`.

**B2 — the settle rule was not "fixed before any pose was read".** It was written
*after* the first capture pass was discarded, and the adjacent disclosure said so
while the claim above it did not. Both are corrected, in the pose registry and
here. An earlier revision of `sweeps[1].registeredBefore` also claimed the whole
sweep-2 section was written before any pose was read; **that was false and is
withdrawn in the record.** The commit message of `08b708a` repeats the same
overstatement; it is corrected in `sweep-results.json` →
`sweep2.settleRuleHonesty` rather than in immutable commit text.

What *was* genuinely pre-registered, in commit `3c5c64f` and before any screen was
looked at, is everything that decides a verdict: the six poses, their URLs, the
exemption set, the attempt policy and the verdict rule. Those pose definitions
were reused **unchanged** for sweep-2 and were not re-chosen after sweep-1's
failure — verifiable against `3c5c64f`.

**Serialization note.** Commit `08b708a` re-serialized `sweep-poses.json` and
`sweep-results.json` at indent 1; the emitter writes indent 2. The review commit
restores indent 2, so the only difference between emitted and committed bytes is
the amendment itself. Sweep-1's values were verified **unchanged key-by-key**
across both re-serializations: every original top-level key present, byte-equal
in value, additions only.

**Instrument hardening carried in the same pass.** `data-far-tier-publish-seq` is
a monotonic publish counter, so a frozen publish is distinguishable from a
settled scene — the residual of the sweep-1 defect class. The publish is now
edge-triggered on the drawn set *and* the desired and applied covered sets, since
the covered set can grow while the drawn set holds steady. Disarm paths delete
the `data-far-tier-*` attributes and emit a zeroed summary, so a session with no
far tier stops advertising one. The "does not retry a failure that freeing bytes
cannot fix" arm now asserts the request count is unchanged across the second
reconcile instead of a state disjunction satisfied by both outcomes it was trying
to separate.

Scope of the disarm clear, stated precisely rather than overclaimed: it fires on
the far-tier effect's **teardown**, which is the armed → disarmed transition. The
app exposes no in-session far-tier toggle — the flag is parsed once per load — so
that path is reachable via unmount or a `dataMode` change, and it was verified by
construction rather than driven in a browser. A *fresh* `?farTier=off` load never
flips: it publishes honest zeros (`suppressible 0`, `drawn 0`) alongside the dense
`massing-active` count, which is what sweep-2's P6-OFF reading recorded, and that
reading remains reproducible. Verified after the change: P2 still reads 0
uncovered with `publish-seq` advancing, and the OFF arm still shows no far-tier
status element.

### Named follow-ups, not fixed here

Recorded so they are tracked rather than lost. None affects a sweep-2 number.

- **N3** — the unstaged-machine UI wording.
- **N4** — a classification test for the no-detail path.
- **N6** — qualify the grep-pin in the coverage-reading test.
- **N7 / N8** — comment placement, and the denominator it cites.
- **N10** — the histogram tie.
- **N11** — commit the capture harness rather than leaving it in a scratch path.
- **N12** — the no-bar numbers.
- **N13** — mitigation note for registration landing in the same commit as its
  captures.

## Not claimed here

- A passing pose is not visual acceptance; that is T007's, and the
  bright-luminance caveat it owns is unaffected.
- Six passes do not generalise to poses that were not registered.
- Sweep-1 ran on `vite dev` and sweep-2 on a production build. The comparison
  between the two sweeps is **not vehicle-controlled**.
- The v1 → v4 recipe change beneath P1's tile is disclosed in the pose registry:
  a reader comparing sweep stills with T003's is comparing different bytes.
