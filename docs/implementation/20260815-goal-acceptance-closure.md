# T007 (Issue #72) — goal acceptance closure, notice reality, and the prior-goal amendment

Closes the `manhattan-citywide-default-streaming` Goal with a criterion-by-criterion
record, corrects the one user-visible sentence the flip made untrue, and amends
the prior goal's reconciliation on a user decision. No feature work, no new
measurement campaign, and no deployment.

Five commits, deliberately separable. The notice reword is a runtime change; the
two records are evidence; the documentation is prose. Each can be reverted
without the others. The fifth closes an independent review — see §6.

| # | commit | what it changes |
| --- | --- | --- |
| 1 | `[T007] Notice reality: the not-shipped sentence states what draws` | `src/runtime/exterior-wave-attribution.ts`, `src/app/ExteriorFallbackNotice.tsx`, and their tests |
| 2 | `[T007] Citywide goal acceptance record` | new `data/citywide-goal-acceptance-20260815/reconciliation.json` + `scripts/citywide-goal-acceptance.test.mjs` |
| 3 | `[T007] Prior-goal reconciliation: #22 closed by adjudication, #1 honestly retained` | `data/goal-integration-acceptance-20260812/reconciliation.json` + its pinning test |
| 4 | `[T007] Docs closure: README, PROJECT_BRIEF, residual risks` | `README.md`, `docs/PROJECT_BRIEF.md`, an ADR 0045 addendum, this record |
| 5 | `[T007] Close review: journey predicates, ceiling pairing, rollback-arm truth` | seven journey CLIs, both records, both documents, the ADR addendum, `exterior-cache-eviction-correctness.test.ts`, and the notice's second clause |

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
> geometry; **where the citywide base tier is active**, their buildings draw as
> **sourced base massing (footprint extruded to sourced height)**, which is not
> a generated exterior.

with the build-level aggregate saying the same thing across releases.

**Two clauses, load-bearing in different ways.** The **first** —
"ship no generated exterior geometry" — is a pure release fact, true in every arm
and at every camera; it is the substring the seven journey CLIs assert on. The
**second** is **conditional**, and review is why: under the rollback arm
(`?exteriorScheduler=off`) overview residency is withdrawn and only 5,289
buildings draw, so an unconditional "their buildings draw as sourced base
massing" is *affirmatively false* there — it would claim ~41k buildings are on
screen that are not. "Where the citywide base tier is active" makes one sentence
true in both arms.

**What the fix deliberately is not.** The condition is **words, not plumbing**:
no session flag is read, no state is added to `App.tsx`, and nothing is gated on
dense residency or on the camera. Reading the arm would make the string vary with
configuration, and `notShippedLines` feeds the notice's `dismissalKey`, so a
configuration-dependent line re-arms a notice the reader already dismissed (the
defect PR #64 fixed) and gives the digest two shapes to recognize instead of one.
Both counts remain release facts read from the release declaration.

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
| 6 | MET | eviction correctness, asserted pick identity and no-stale-render from T003, hysteresis from T002, residency from T006 — and it separates the two caches' ceilings |
| 7 | **NOT-MET** | the repeated-camera-path heap verdict was never captured at citywide scale |
| 8 | MET | `peakConcurrentRequests` 4 on the shared aggregate at every settled station, pool-enforced — with the pan-storm hole named inside the verdict |
| 9 | MET-AS-ADJUDICATED | the committed journeys passed on the pre-reword build; the two extended eviction journeys exist as real-runtime proofs, not as browser journeys |
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
**cell** cap binds and produced the observed eviction, that the **exterior byte**
cap does not bind at today's data volume, and that the **dense entry** budget —
a different ceiling belonging to a different cache — sits at 88.4 % and is the
tightest reading in the build. #8 discloses that the pan-storm capture, the campaign's
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
  cells of 883 visible), and the text states that the **cell** cap is what binds.
- **The two caches are separated, because pairing the wrong residency with the
  wrong ceiling understated the pressure.** The exterior cell cache (512 entries
  / 256 MiB) measured 40 entries / 14,369,372 B at the overview — 7.8 % and
  5.3 %, so its byte cap does not bind. The citywide dense shard cache is a
  different pool with its own resolved budget of 112 shards / 83,886,080 B, and
  it measured 58,243,420 B / 99 entries — 69.4 % of bytes and **88.4 % of
  entries**, which is pressure, not headroom.
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

**What was left byte-identical, and what turned out NOT to be inert.** *(This
paragraph is corrected from its first draft — see §6.)* Historical
implementation records under `docs/implementation/`, the descriptive tombstone
prose in `scripts/goal-bounded-gaps-cli.mjs:352` and `:485`, and every committed
`journey-evidence.json` capture that quotes the old sentence are left
**byte-identical**. They are evidence of what was on screen at the time, and
rewriting them to match today's wording would be falsifying a capture.

**But seven of those files also contained an EXECUTABLE assertion, not just
prose**, and the first draft of this record missed the distinction — it cited
only the prose `claim:` line and described the whole set as safely inert. Seven
journey CLIs computed a live pass predicate
`waveNotice.includes("no substitute was selected")`, which the reword deletes
from the sentence; left alone they would have failed every future live run
against a notice that is *more* truthful, not less. All seven predicates now
assert the sentence's arm-independent **first clause**
(`no generated exterior geometry`), and the `claim:` prose beside each was
updated to describe what the predicate now checks:

`lower-manhattan-journeys-cli.mjs`, `northern-manhattan-journeys-cli.mjs`,
`northern-manhattan-journeys-p1-cli.mjs`,
`southern-remainder-journeys-cli.mjs`,
`southern-remainder-journeys-p1-cli.mjs`,
`central-upper-manhattan-journeys-cli.mjs`,
`central-upper-manhattan-journeys-p1-cli.mjs`.

The committed captures those CLIs produced are untouched. **No post-reword
journey campaign was run**, and the acceptance record's criterion 9 says so
rather than implying the suite was re-captured.

**ADR 0045** receives an **addendum section** recording the D-15 disposition and
the conditional-wording decision, plus an **append-only footnote** at §1.3
pointing at the 54,847-vs-53,115 discrepancy. No existing section was rewritten.

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

---

## 6 — Review closure (same task, one commit)

Independent review returned REQUEST-CHANGES with three blocking findings. All
three were real, all three are closed in
`[T007] Close review: journey predicates, ceiling pairing, rollback-arm truth`.

**B1 — seven live journey predicates, not seven prose quotes.** The first draft
of §4 treated every old-sentence occurrence as inert captured evidence. Seven of
them were **executable**: `waveNotice.includes("no substitute was selected")`
in seven journey CLIs, which the reword breaks. All seven now assert the
arm-independent first clause; the `claim:` prose beside each was aligned; every
committed capture is byte-identical; and criterion 9 of the acceptance record was
rescoped to say the committed journeys were captured *pre*-reword and that **no
post-reword campaign was run**.

**B2 — the ceiling pairing was wrong in four places.** 58,243,420 B / 99 entries
was described as "well inside" a 256 MiB / 512-entry ceiling. It is not that
cache's residency at all: those bytes belong to the **citywide dense shard**
pool, whose resolved budget is 112 shards / 83,886,080 B — **69.4 % of bytes and
88.4 % of entries**. The 256 MiB / 512-entry ceiling belongs to the **exterior
cell** cache, which measured 40 entries / 14,369,372 B (7.8 % / 5.3 %) and is the
cache the "byte cap does not bind" claim is actually about. ADR 0041 warned in
its own words that the two pools have separate ceilings and separate eviction and
that adding them together is wrong; this is that error in the other direction.
Corrected in the acceptance record's criterion 6, the prior record's criterion 1
stop report, `README.md` and `docs/PROJECT_BRIEF.md`. The "cell cap binds" fact
is unchanged and is now stated beside the two byte ceilings rather than in place
of them.

**B3 — the sentence was false in the rollback arm.** Closed by conditional
wording rather than session-flag plumbing, for the reasons recorded in the ADR
0045 addendum. The journey predicates from B1 match the *first* clause precisely
so that they hold in both arms.

**Optionals, all six taken.** O1 — a pick-identity assertion (release → refetch →
compare the outcome's canonical feature id set, required equal and non-empty) now
exists in `exterior-cache-eviction-correctness.test.ts`, and criterion 6's
disclosure is upgraded from "by construction" to "asserted". O2 — criteria 6 and
8 each name ADR 0045 §5.1's contrary campaign-scoped grade, and the addendum
records that §5.1 is campaign-scoped and narrower rather than superseded. O3 —
"four of the six" waves at `requestedArtifactCount` 0 corrected to **five of
six** (only central-upper requested anything at 52 km, 40 artifacts). O4 — the
acceptance test now checks the prior record carries a T007 amendment closing 22
with `remainingNotMet` `[1]`, and that both documents carry the two-tier framing.
O5 — the addendum records that the preserved single-cell branch is **dormant**
with the live runtime (the app always supplies `declared`), so preserving it was
cheap option value rather than a hard constraint met. O6 — an append-only
footnote at ADR 0045 §1.3 points at the 54,847-vs-53,115 note.

**Live check, scoped exactly.** A street-level real-release session on the
**default arm** rendered the new aggregate sentence correctly, in the `notShipped`
slot, with Dismiss present. That is a single-arm, single-camera confirmation that
the reword reaches the screen; it is not a journey campaign and asserts nothing
about the rollback arm.
