# ADR 0055 — Closing the exterior-completion goal

Status: accepted. Records a CLOSURE and a licensing posture, not a runtime
change. No file under `src/` moves because of this ADR.
Date: 2026-08-17
Task: T008 (Issue #90)
Relates to: ADR 0039 (goal-integration acceptance), ADR 0050 (measured lod_1
fallback), ADR 0052 (full-city serving shape), ADR 0053 (the acceptance
campaign), ADR 0054 (refusal transparency). **Amends** the criterion #1 verdict
in `data/goal-integration-acceptance-20260812/reconciliation.json`.

## Context

The exterior-completion goal set out to generate the whole city, serve it,
measure it, and then close the criterion the previous goal had deliberately left
open. Everything except the closure had shipped by T007. This task does four
things: states the licensing posture, updates the documents that still described
a 484-building textured tier, ships this goal's own acceptance record, and
amends the prior goal's criterion #1.

## Decisions

### D-1 — Licensing: proprietary over what we made, silent over what we did not

`LICENSE` is proprietary, all rights reserved, scoped **explicitly** to project
code and generated artifacts. The half that took the work is section 2: it makes
no claim over third-party source data and carves out, by name, the NYC Open
Data / OTI datasets (including `jh45-qr5r`), the ODbL 1.0 share-alike partition,
the CC BY-SA 4.0 photographic references, provider-terms services, and the
sources whose licence class is recorded as `unknown`.

The plan required two carve-outs; five are recorded. **CC BY-SA 4.0 is also
share-alike**, and an unqualified proprietary claim over it would be the same
category of rights misstatement as one over ODbL — carving out only the two
named classes would have left a real share-alike obligation sitting inside a
proprietary claim.

`NOTICE` is **derived from the source registry**, not authored beside it: 45
entries across 8 licence classes with their attribution strings, source ids and
terms URLs. A committed test asserts every one of them still appears, so
ingesting a source without attributing it breaks the build. Where the two
disagree, the registry governs.

No `license` field was added to `package.json`: it is `"private": true` and
nothing reads one.

### D-2 — The amendment, and why it is MET-AS-ADJUDICATED

Prior criterion #1 — "every accepted building parent has a detailed, visually
complete generated exterior; missing exterior representations are zero" — is
closed as **MET-AS-ADJUDICATED**, never MET.

Both halves its stop report named are done: 44,989 of 45,194 parents now ship a
textured exterior (it was 484), and the 899 grammar refusals were adjudicated
into 694 recovered plus 205 named-stop-code tombstones.

**The adjudication instrument is the goal contract's own clause** that *only
degenerate-data refusals may remain tombstoned* — and it is not fully satisfied.
43 of the surviving 205 are `volume-identity-failed`: the generator's own
signed-mesh-volume self-check, **not** a property of the source footprint and
therefore not a degenerate-data refusal in the sense the clause requires.

The criterion is graded on the ground that every parent resolves to either a
shipped exterior or an honest, named, user-visible refusal, and that no geometry
was invented for any of them. It is **not** graded on the ground that the
contract's wording was met. The prior verdict, the original stop report
(`priorStopReport`) and an `adjudicationDelta` are all preserved rather than
deleted.

The largest surviving cohort, `ring-area-below-floor` at 114, is described as
**the floor at this grammar's constants** rather than "the honest floor": the
sub-20 m² area floor is a grammar constant that extension C measured and
deliberately left in place, so a different constant yields a different count.
Calling it a property of the data would be wrong.

### D-3 — The 899 → 205 mapping is derived, never re-measured

`refusal-code-mapping.json` re-aggregates the per-building vectors already
committed in `data/grammar-extension-20260815/`. It shows the whole partition
(694 recovered + 205 refused = 899, with 14 reclassified-but-still-refused as a
**subset** of the 205), and it explains the one figure that looks like a
regression: `ring-area-below-floor` reads **114 after** extension having read
**113 before**. The classifier is priority-ordered, so raising the vertex cap let
exactly one building past that gate and into the area-floor gate. It moved
between codes; it did not become newly refusable.

### D-4 — Criterion 4 is NOT-MET, and stays that way

The per-wave rendered 2% key-silhouette gate is the one criterion this goal does
not meet, and it is recorded with a stop report rather than adjudicated into
something softer. All six serving releases ship `shippedLodIds: ["lod_0"]`, so
the transition cannot be sampled on rendered evidence at all. On the retained
set, where both LODs exist, **424 buildings fall back** (per wave
0/4/114/289/3/14) and five of six waves carry a worst measured deviation ratio
above 0.02 (worst: w03 at 0.09160; the at-cap crossing is `doitt:401323` at
0.020413). Two reachability routes are named verbatim from the campaign record:
re-cut the serving waves to carry both LODs, or render a stratified per-wave
sample from the retention packages and say plainly that it measures artifacts
rather than what the app draws.

### D-5 — The grade split, and a contradiction in the plan

Shipped: **4 MET / 7 MET-AS-ADJUDICATED / 1 NOT-MET**, one stop report.

The frozen plan's summary line said 3 / 8 / 1, but its own itemized per-AC table
names AC2, AC9, AC11 and AC12 as MET — four. The two halves disagreed by one.
This record follows the itemized table and **derives** `verdictCounts` from the
verdicts array, because reaching 3/8 would have meant regrading a clean MET
downward with no delta to justify it: inventing an adjudication to hit a number,
which is the exact failure the record exists to prevent. A committed test
asserts the counts follow from the table.

## Consequences

- The prior goal's record has **no NOT-MET criteria left**: verdict counts
  17 MET / 14 MET-AS-ADJUDICATED / 0 NOT-MET, `remainingNotMet` empty,
  `closedCriteria` [1, 7, 8, 22, 24, 30].
- **14 of 31 closed criteria are adjudicated.** That ratio is the honest summary
  of this project: it works, it is measured, and nearly half of what it claims
  carries a stated delta between the contract's wording and what was achieved.
- Ten residual risks (D-19…D-28) are carried into the closing record, each
  citable to a committed artifact.

## What this closure does not claim

- That criterion 4 is deferred or acceptable. It is NOT-MET.
- That MET-AS-ADJUDICATED means the contract's wording was satisfied. In every
  case it means the opposite, and the delta is stated.
- That the licence resolves any share-alike obligation. It disclaims them.
