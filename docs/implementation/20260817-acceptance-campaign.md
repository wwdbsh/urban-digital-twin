# T006 — the exterior acceptance campaign

Measures the shipped six-wave serving arrangement against bars that were
committed **before any capture existed**, and reports every verdict — including
the one that failed, the one that was pre-registered as unreachable, and the one
this campaign's instrument could not decide.

No file under `src/` changes. The work is three instrument commits, eight
committed capture records with sidecars, twenty-seven rendered stills, two drift
tests, an ADR and this record.

| # | commit | what it changes |
| --- | --- | --- |
| 1 | `[T006] Pre-register the acceptance campaign` | `scripts/exterior-acceptance-campaign-constants.mjs`, `scripts/exterior-acceptance-campaign-constants.test.mjs`, `scripts/exterior-acceptance-preregister-cli.mjs`, `scripts/exterior-acceptance-preregistration.test.mjs`, `data/exterior-acceptance-20260817/pre-registration.json` + `.sha256`. **Zero captures at this commit.** |
| 2 | `[T006] Instrument the acceptance campaign` | `scripts/exterior-serving-evidence-cli.mjs` (six `campaign-*` commands, `--out`, the selector fix, the vsync arm, `Performance.getMetrics`, the texture probe, the served-bundle pre-flight, the storm port), `scripts/citywide-heap-repeat-cli.mjs` (`--out`, M2, the raised lap cap), new `scripts/exterior-serving-journeys-cli.mjs` |
| 3 | `[T006] Capture the campaign and record its verdicts` | the eight capture records + sidecars + `captures/`, `scripts/exterior-acceptance-campaign-record-cli.mjs`, `scripts/exterior-acceptance-campaign-record.test.mjs`, the extended frozen-record list, `docs/decisions/0053-exterior-acceptance-campaign.md`, this record |

---

## 1 — Why the bars were committed first

The failure mode of an acceptance campaign is not a missed bar. It is a bar that
moves after the number is seen, in a way nobody can detect afterwards because the
only record of the bar is the record that also contains the measurement.

So the bars live in `scripts/exterior-acceptance-campaign-constants.mjs`, in one
module, committed at `314cb8f` — a commit that contains no capture at all — with
`exterior-acceptance-campaign-constants.test.mjs` pinning the load-bearing values
byte-for-byte. Changing a bar after that commit breaks a committed test, which is
a visible act rather than a silent one.

Three things in that module are inherited rather than chosen, with their sources
named so the inheritance can be checked: the strict 16.7 / 25 ms pair and the
45 s settle (ADR 0045's flip campaign), D-11's 4,000 ms leg-Y bar (ADR 0045
§5.2), and the runtime's own cache and concurrency ceilings (imported from
`EXTERIOR_RUNTIME_BUDGETS`, not retyped).

---

## 2 — The instruments, and the defects finding them exposed

### 2.1 The selector that matched nothing

`READ_SELECTION` in `exterior-serving-evidence-cli.mjs` used
`[role="complementary"]`. The details panel is
`<aside class="inspector" aria-label="Selected feature details">`. An `<aside>`
carries the complementary role **implicitly** — it has no `role` attribute — so a
CSS attribute selector cannot match it.

The consequence is on T005's record: `selectionDigestFirstVisit: null`,
`selectionDigestAfterReEntry: null`, `selectionStableAcrossEviction: false`. That
was the instrument reading nothing, not the app losing a selection.

It is also why E-1e's bar is written as EQUAL **and BOTH NON-NULL**. Two nulls
are equal; an equality-only rule would have been silently satisfied by exactly
this defect. The non-null conjunct is what makes the gate capable of failing.

Selector now: `aside.inspector[aria-label="Selected feature details"]`. First
non-null digests in this gate's history: `a39e251b` at e1, `a39e251b` at e8.

### 2.2 `--out`, and the records that were nearly overwritten

Two instruments wrote to roots holding evidence this campaign is **judged
against**:

- `exterior-serving-evidence-cli.mjs` wrote `data/exterior-serving-20260817/`,
  which holds `eviction-at-scale.json` — the record E-1a's comparison condition
  is byte-identical to — and `default-session-residency.json`, whose stationary
  stops the forcing argument quotes.
- `citywide-heap-repeat-cli.mjs` wrote `data/citywide-heap-repeat-20260815/`,
  frozen T008 evidence.

Both now take `--out`, both default to their historical root so nothing that ran
before behaves differently, and the campaign commands **refuse to run without
it**. `exterior-acceptance-preregistration.test.mjs` asserts the checksums of all
six baseline records are unchanged, so the refusal is checked rather than trusted.

### 2.3 The served-bundle pre-flight

Every campaign command fetches the served `index.html`, compares it byte-for-byte
to this worktree's `dist/index.html`, and then reads the three probe attribute
markers out of the **served entry-script bytes**.

The second limb is the one that matters. A bundle built without
`VITE_EXTERIOR_SCHEDULER_PROBE=1 VITE_CITYWIDE_OVERVIEW_PROBE=1
VITE_EXTERIOR_TEXTURE_PROBE=1` does not fail loudly — the probes tree-shake out,
every read returns `null`, and the capture produces a record full of absences
that looks like a measurement. Reading the marker out of the served bytes is the
only check an environment variable set in the wrong shell cannot satisfy. Both
limbs fail closed, before Chrome is launched.

### 2.4 The storm, ported rather than re-invented

Twelve drags, byte-identical to
`scripts/citywide-default-flip-campaign-cli.mjs`: same centre, same
`dx = step % 2 === 0 ? -220 : 220`, same `dy = step % 3 === 0 ? 120 : -120`, same
ten interpolated steps 30 ms apart, same `Input.dispatchMouseEvent` transport.
Two storms are comparable only if the gesture is the same gesture. The four zoom
excursions and six cross-wave translations come from the pre-registration, which
committed the waypoints rather than generating them at capture time — a storm
that picks its own waypoints can wander into a cheap corner and a reader cannot
tell that it did.

### 2.5 M2

`citywide-heap-repeat-cli.mjs` now READS `activeRequests === 0` before every heap
sample instead of implying quiescence from the 45 s settle. A violation is an
INSTRUMENT-FAILURE ABORT that writes no record, and explicitly not a heap
failure: a sample taken while artifacts are in flight measures a transient rather
than what survives a cycle, so recording it as a FAIL would be reporting the
wrong quantity.

---

## 3 — Capture discipline

Single attempt per capture; `attemptCount` recorded on every record. Seven of the
eight captures are **attempt 1**. The heap capture is **attempt 2**: attempt 1
aborted at lap 2 with `focus/visibility changed mid-run (hasFocus true -> false)`
and, by design, wrote no record at all, so it cannot have become evidence. That
is a NAMED instrument failure, which is the only thing the policy allows a repeat
for — never because a series looked wrong, and no series from attempt 1 was
compared against a bar. A scratch Chrome per session on its
own debugging port with its own scratch profile, launched and killed by the
instrument, with the surviving-process count **read** by `pgrep` after the kill
and appended to `data/exterior-acceptance-20260817/chrome-cleanup.json`. Every
session recorded `survivingChromeProcessCount: 0`.

Sessions, in the order they ran: control (both vsync modes) → F+G → H → S-1 storm
→ E-1 eviction → L1 → journeys → M heap. Serial by necessity: two browser
sessions on one machine would contaminate every frame and residency reading in
both.

---

## 4 — The results

The gate-by-gate table with its numbers is
`data/exterior-acceptance-20260817/campaign-record.json`, generated by
`scripts/exterior-acceptance-campaign-record-cli.mjs`, which is a **join over the
capture records and computes no verdict of its own**. `ADR 0053` reads it in
prose. The three results that need the most care are summarised here.

**L2 — HONEST-STOP.** All six promoted `-s1` serving waves ship `lod_0` only, and
the pre-registration machine-checked that before any capture. There is no
rendered `lod_0`-to-`lod_1` transition anywhere in the served set, so criterion
#4's per-wave stratified 2% rendered gate is structurally unreachable. L1
demonstrates the transition MECHANISM on the 14-building Block 835 opt-in and
explicitly does not discharge #4.

**J4 — FAIL.** The deep-link and interactive arms agree on all 13 rows they
share, including `Feature ID`, `Coordinates`, `Confidence` and `Geometry`. They
differ because the interactive arm's building was resident and the deep-link
arm's was not — the two arms were not camera-matched, so the whole-panel digest
compared two different resident scenes. It is recorded as a FAIL against the rule
the instrument registered, with the diagnosis, and was **not re-run to a nicer
number**.

**The E-1 forcing argument — UNDECIDED.** The capture's detector reported the
pre-registered falsifying condition satisfied. That report is superseded:
`cacheEvictions` is cumulative and session-wide, so once any eviction has
happened — including in transit, where the argument predicts it — every later
settled stop reads non-zero while holding the scheduler's cap of 8. The condition
is satisfied by a session behaving exactly as the argument says. The detector was
fixed afterwards to return an explicitly undecided verdict, and the capture was
left as measured.

---

## 5 — Drift protection

`scripts/exterior-acceptance-campaign-record.test.mjs` asserts four things:

1. Every committed record matches its own `.sha256` sidecar, and the campaign's
   heap record is the campaign's, not the frozen T008 one.
2. The roll-up did not invent a verdict: F1, G1, E-1e, L2 and the request ceiling
   are re-derived from the capture records and compared, and each station's own
   `pass` is re-checked as the conjunction of the three F1 bars.
3. No gate went missing: all 34 registered gate ids appear, each with a verdict
   from the closed set, and a gate with no capture must say `NOT-CAPTURED` rather
   than be absent.
4. Every still the roll-up cites exists on disk and matches the checksum cited.

`scripts/exterior-acceptance-preregistration.test.mjs` additionally pins the
pre-registration's own checksum, asserts it contains no measurement, and now
pins the six prior-task records the campaign's gates are defined against.

---

## 6 — Open, and named

- Criterion #4 does not close. Two reachability routes are recorded in ADR 0053
  §7; both are changes rather than measurements.
- J4 needs a camera-matched comparison or an identity-scoped digest. New cycle.
- The forcing argument needs two probe reads at one stationary pose. The
  instrument names the reading; it does not yet take it.
- E-1f: no canvas pick on re-admitted exterior geometry has ever been captured.
  Every selection in this campaign is a search result or a `?feature=` deep link.
- G2 passed without ever being pressed at its own assumption: the 24-tile budget
  assumes six co-resident waves and the scheduler's 8-unit cap kept the observed
  maximum at three.
- D-11 is carried at 7,122.2 ms, larger than the 5,746 ms D-11 itself records.
- The Blender agreement is inherited by a byte-copy argument over 94 sampled
  buildings and says nothing about the other 44,895.

---

## 7 — A pre-existing test flake, found and not fixed here

`src/app/App.test.tsx > App overlay and selection regressions > closes details
with Escape and returns focus to the located-pick trigger` fails under full-suite
load and passes when `src/app/App.test.tsx` is run on its own. It **reproduces
with the entire campaign working tree stashed**, at both the pre-registration
commit and the instrument commit, so it is **pre-existing and unrelated to this
task**: nothing this task touches is imported by `src/`. The test's `waitFor`
uses Testing Library's 1,000 ms default and the failing run took 1,401 ms; it
passed once, on an idle machine, early in the session.

**The `pnpm test` gate therefore does not pass at this commit, and that is
reported rather than worked around.** It did not pass before this task either.

It is recorded here rather than fixed because this task's scope is `scripts/`,
`data/` and `docs/` only. It should be given a real timeout, or the assertion
should be made deterministic, in a task that is allowed to touch `src/`.
