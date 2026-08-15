# T007 (Issue #72) — goal acceptance closure, notice reality, and the prior-goal amendment

Closes the `manhattan-citywide-default-streaming` Goal with a criterion-by-criterion
record, corrects the one user-visible sentence the flip made untrue, and amends
the prior goal's reconciliation on a user decision. No feature work, no new
measurement campaign, and no deployment.

Four commits, deliberately separable. The notice reword is a runtime change; the
two records are evidence; the documentation is prose. Each can be reverted
without the others.

| # | commit | what it changes |
| --- | --- | --- |
| 1 | `[T007] Notice reality: the not-shipped sentence states what draws` | `src/runtime/exterior-wave-attribution.ts`, `src/app/ExteriorFallbackNotice.tsx`, and their tests |
| 2 | `[T007] Citywide goal acceptance record` | new `data/citywide-goal-acceptance-20260815/reconciliation.json` + `scripts/citywide-goal-acceptance.test.mjs` |
| 3 | `[T007] Prior-goal reconciliation: #22 closed by adjudication, #1 honestly retained` | `data/goal-integration-acceptance-20260812/reconciliation.json` + its pinning test |
| 4 | `[T007] Docs closure: README, PROJECT_BRIEF, residual risks` | `README.md`, `docs/PROJECT_BRIEF.md`, an ADR 0045 addendum, this record |

---

## 1 — The notice was false by omission, and the fix is one sentence

The composed release-fact line read:

> N of M exterior cells declared by this release ship no exterior geometry; no
> substitute was selected for them.

Before the citywide default flip that was true in both halves. After it, those
cells' buildings **draw** — as sourced base massing from the committed citywide
dense shards — so the sentence reads as "nothing is there" about buildings the
reader can see on screen. It now reads:

> N of M exterior cells declared by this release ship no **generated** exterior
> geometry; their buildings draw as **sourced base massing (footprint extruded
> to sourced height)**, which is not a generated exterior.

with the build-level aggregate saying the same thing across releases.

**What the fix deliberately is not.** It is not conditioned on dense residency,
adds no state to `App.tsx`, and takes no camera-dependent input. `notShippedLines`
feeds the notice's `dismissalKey`, so a residency-conditioned line would blink
with the camera and re-arm a notice the reader had already dismissed — the defect
PR #64 fixed. Both counts remain release facts read from the release declaration.

**Three sites had to move together**, because a stale pattern does not throw:

| site | file |
| --- | --- |
| composer, declared path and reconciled path | `src/runtime/exterior-wave-attribution.ts` |
| `NOT_SHIPPED_PATTERN` | `src/app/ExteriorFallbackNotice.tsx` |
| build-level aggregate template | `src/app/ExteriorFallbackNotice.tsx` |

A regex left behind would have routed every tombstone into `verbatim` and
restored the six-wave wall of text the digest exists to replace, silently and
with a green suite. A test now asserts the real producer's output is still
digested. **Run against the pre-fix pattern it fails on exactly that
assertion** — `expected [ { …(2) } ] to deeply equal []`, the line sitting in
`verbatim` — which is how the guard was shown to be load-bearing rather than
decorative.

Preserved byte-identical: the ADR 0029 single-cell path (one cell still states
itself in its own words and still falls through to verbatim), the T006
three-population split (deferred and evicted keep their own recoverable
register), and verbatim-first ordering so a real per-cell failure still outranks
a by-design line.

---

## 2 — The citywide goal acceptance record

`data/citywide-goal-acceptance-20260815/reconciliation.json`, with
`scripts/citywide-goal-acceptance.test.mjs` beside it.

**No CLI ships with it, and that is the design.** The prior goal's T024 record
carried a `coverage` block that was arithmetic over a committed ledger, so a CLI
could recompute it and a test could demand byte-equality. Nothing in this goal's
completion argument is recomputable — every verdict is a judgement over capture
records. The test is therefore the whole instrument.

**Verdicts: 8 MET, 3 MET-AS-ADJUDICATED, 1 NOT-MET.**

| # | verdict | the short of it |
| --- | --- | --- |
| 1 | MET | visibility scheduling, frozen priority policy, deterministic unit tests, and network/cache evidence at three cameras of one parameter-free session |
| 2 | MET | 41,841 extrusions at the 52 km overview; no cell empty by design; the 899 refusals stay tombstoned, which this criterion explicitly accepts |
| 3 | MET-AS-ADJUDICATED | Block 835 `lod_0`↔`lod_1` PASS at 10.9× margin — the only *eligible* transition; the dense→V3 swap carries no 2 % guarantee by pre-registered decision |
| 4 | MET | ADR 0040 arithmetic re-derived, ADR 0043 raises recorded, rebuild cost measured at two scales, revival clause exercised and did not fire |
| 5 | MET | every station passes the **tighter** pair (worst p50 8.3 ms, worst p95 15.9 ms), off a measured 7.8 ms vsync floor, pan storm included |
| 6 | MET | eviction correctness and no-stale-render from T003, hysteresis from T002, byte residency from T006 — and it names which cap binds |
| 7 | **NOT-MET** | the repeated-camera-path heap verdict was never captured at citywide scale |
| 8 | MET | `peakConcurrentRequests` 4 on the shared aggregate at every settled station, pool-enforced — with the pan-storm hole named inside the verdict |
| 9 | MET-AS-ADJUDICATED | the journey suite passes; the two extended eviction journeys exist as real-runtime proofs, not as browser journeys |
| 10 | MET | rollback rehearsed live, shown three independent ways at once |
| 11 | MET-AS-ADJUDICATED | the notice now says what draws; "zero by-design tombstones" is not literally delivered |
| 12 | MET | ADRs, README, brief, prior-goal amendment, and this record |

**Why #7 is NOT-MET rather than partial.** Per-station forced-GC heap readings
exist — 110.6 / 199.0 / 266.3 / 296.1 MB — but they are **four different
cameras**, so the series is monotone by construction and cannot be re-read as a
retention verdict. The criterion's GPU half **is** discharged (ADR 0043 states
decoded GPU memory by labelled arithmetic; no shared atlas was needed because no
arithmetic exceeded a budget), and the verdict says so rather than letting one
refusal cover both halves. The stop report names the closing instrument: a
repeated-path capture shaped like `heap-concurrency-evidence.json`
(`heapVerdict.growthRatio` against a noise band) but at island scale, crossing
the band edges and pressing the 128-cell cap so eviction is actually forced.

**Where the record is deliberately uncomfortable.** #6 states that the scheduler
**cell** cap binds and produced the observed eviction while the **byte** cap does
not bind at today's data volume — citing only the byte cap would report a ceiling
nothing presses against. #8 discloses that the pan-storm capture, the campaign's
highest-load camera, carries no concurrency reading at all, so the storm's bound
is structural rather than observed.

**What the test holds.** Twelve verdicts in index order; the closed
three-value vocabulary; counts and `stopReportCount` agreeing with the table; the
headline split pinned as a literal; the unmet list pinned as `[7]`; an
adjudication without a delta and a NOT-MET without a stop report both refused;
`criteriaSha256` re-derived from the criterion texts; **all 37 cited artifacts
re-hashed**; an unchecksummed `data/…` citation hiding in prose refused; the
superseded `stations-scheduler-on.json` (D-16) asserted to be cited nowhere; and
each carried deferral named by number.

**No ledger path appears anywhere in the record**, asserted by a test. The
`.claude/` and `.codex/` trees are untracked on a clean checkout, so a record
citing them would cite something a fresh clone cannot open. The approved contract
is referenced in prose and pinned by its own digest
(`a7987cfcb27990ce479704c99b248862c84c79e1e7e7d75c0b13a8bcd5817b43`).

---

## 3 — The prior-goal amendment, and the user decision behind it

**USER DECISION, recorded 2026-08-15: close criterion 22 only. Criterion 1
remains NOT-MET.**

Criterion 22 — "the approved Manhattan coverage envelope reaches its
user-approved exterior tier without stable-ID, selection, deep-link, provenance,
or failure-state regressions" — closes as **MET-AS-ADJUDICATED**. The tier is
defined by the user-approved Goal contract for the closing goal, which names the
two-tier composition (dense massing island-wide plus textured V3 near-camera) as
what the envelope was to reach; the default session reaches it at 41,841 drawn,
with no regression in identity, selection, deep links, provenance or failure
states. It is adjudicated rather than MET because the criterion's own words are
ambiguous between two readings and the reading that closes it is the one the user
approved, not the one the record originally applied.

**Criterion 1 stays open, and the reason is arithmetic.** Of the 41,841
buildings drawn, 484 carry a generated exterior; the other **41,357** draw as
sourced base massing — real geometry, and not what criterion 1 asks for. Its
stop report is amended in place, because the record's own shape rule forbids a
`priorStopReport` on a still-NOT-MET entry, so the amended text states what the
original said and which half of it closed:

- **(a) retention — structurally closed.** The gap the 512-entry all-resident
  cache contract bounded is gone: the scheduler shipped, is default-on, holds 128
  resident cells against 883 visible, and the entry cap is no longer the binder.
- **(b) generated exteriors — open.** 41,357 parents still have none.
- **(c) the 899 refusals — open, and still a user decision.** No adjudication
  record exists in this repository and T007 did not create one.

**The T029 discipline is kept in full.** Criterion 22 carries `priorVerdict`,
`priorStopReport` and `closedBy`; nothing was rewritten to look as though it had
always passed. Counts move to **17 MET / 13 MET-AS-ADJUDICATED / 1 NOT-MET**,
`remainingNotMet` to `[1]`.

**The pinning assertions were rewritten rather than relaxed**, because they exist
precisely to make this a deliberate reviewed edit: the headline split is
re-pinned with its history in the comment; the unmet list is re-pinned at `[1]`
and now also asserts criterion 1's stop report still names both open halves;
closure attribution is **per criterion**, built from the record's own
declarations and checked to cover the closed set exactly, so a closure attributed
to a task that declares nothing fails; and the evidence-path regex **enumerates**
the second directory rather than widening to `data/`.

**The `coverage` block is byte-untouched.** `pnpm goal:reconcile` rewrites the
file byte-identically to the hand edit, and `--check` reports `drift: false`.

---

## 4 — Documentation closure

**`README.md` and `docs/PROJECT_BRIEF.md`** are rewritten to the citywide-default
reality. The changes that matter:

- The default session is described as **two tiers**, and the 484 / 45,194 (1.07 %)
  figure is re-framed as the **textured V3 tier** rather than as "what renders".
  Conflating those two numbers is the easiest way to overstate this project.
- The 512-entry bound is replaced by the **scheduler-pool bound** (128 resident
  cells of 883 visible) plus the measured residency (58,243,420 B / 99 entries
  against 256 MiB), and the text states that the **cell** cap is what binds.
- `?exteriorStreaming=off` is corrected to what
  `stations-dense-only.json` **measured**: it disables the six promoted V3 waves
  and says nothing about the citywide overview — the island still draws
  island-wide as base massing, at 43,021 buildings at the 52 km overview. The
  earlier sentence is not described as false; it described a build in which the
  two behaviours hung off one boolean, and T006 split them.
- `?exteriorScheduler=off` is documented as the **full opt-out and the rollback**,
  with the rehearsal figures and the single constant behind it.
- Reconciliation status is stated for both goals: **30 of 31** prior criteria
  closed with criterion 1 open and its stop report summarized, and **11 of 12** of
  this goal's criteria MET or adjudicated with criterion 7 open.
- One line records that the notice **wording changed at T007** and why.

**What was deliberately NOT touched.** Historical implementation records under
`docs/implementation/`, the tombstone quotes in the journey CLIs
(`scripts/central-upper-manhattan-journeys-p1-cli.mjs:524`,
`scripts/goal-bounded-gaps-cli.mjs:352` and `:485`, and their siblings), and every
committed capture that quotes the old sentence are left **byte-identical**. They
are evidence of what was on screen at the time; rewriting them to match today's
wording would be falsifying a capture.

**ADR 0045** receives an **addendum section** recording the D-15 disposition. No
existing section was rewritten.

---

## 5 — What remains open after this task

- **Citywide goal criterion 7** — the repeated-camera-path heap verdict at
  citywide scale. The only NOT-MET of that goal, with a stop report.
- **Exteriors goal criterion 1** — generated exteriors for 41,357 parents, and
  the 899 grammar refusals' adjudication. The only NOT-MET of that goal.
- **D-17**, routed to T007 by ADR 0045 and **not closed here**: the commit gate's
  wiring is unguarded. `applyDenseOwnership`
  (`src/features/explorer/CesiumViewport.tsx:2044`) and its call sites at `:2132`
  and `:2144` sit in no `try`/`catch` and behind no error boundary, and the
  committed `CesiumViewport` tests never render the component — deleting the
  commit-path reconciliation entirely would leave the suite green. The closing
  instrument is the ADR 0044 D-6 React harness. The user-visible failure mode is
  concrete: a V3 cell goes live or is evicted and never reaches the screen, with
  no error anywhere. It is carried as a residual risk with all four of those
  facts asserted by test, because T007's scope is acceptance closure and building
  a rendering harness is feature work.
- **D-4, D-8, D-11, D-12, D-16** are carried by number in the acceptance record.
  D-4's status **changed**: band-internal wave-order-before-distance ranking was
  unreachable when ADR 0044 handed it on and is reachable now that the cap binds
  at 2–3 km.
- **A documentation-accuracy finding new in T007**: ADR 0045 §1.3 says "54,847
  instances allocated" at the overview where §3.2 and the committed record both
  say 53,115. The evidence supports 53,115; the drawn count of 41,841 is
  unaffected. Recorded rather than silently repaired, because T007 does not
  rewrite ADR sections.
