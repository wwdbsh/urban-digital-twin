# ADR 0039: Integration acceptance — the Goal reconciled criterion by criterion, and the six it does not close

- Status: Accepted
- Date: 2026-08-12
- Task: T024 (Issue #25)
- Supersedes: nothing. Reads ADRs 0018–0038 as evidence and closes the Goal's
  documentation impact.

## What this ADR is for

Every earlier ADR in this series argued about one wave, one grammar, or one
package. This one asks a different question, once: **does the delivered work
satisfy the approved Goal, criterion by criterion, and where it does not, what
exactly is owed?**

It is deliberately not a completion narrative. The verdicts below were assigned
before the summary was written, from a closed set of three, and the count of
unmet criteria was allowed to land wherever the evidence put it. It landed on
six.

## The method, and why it is shaped this way

### One of exactly three verdicts, and the two that must justify themselves

- **MET** — direct evidence cited: a file, a test name, a committed measurement,
  a checksum.
- **MET-AS-ADJUDICATED** — the criterion as literally written was narrowed, or
  made vacuous, by a recorded decision. The verdict is only admissible with the
  **delta stated in its own words**: what the criterion asked for, and what was
  actually proven instead.
- **NOT-MET** — with a **stop report** naming what would close it. A stop report
  that says "more work" is not a stop report.

`scripts/goal-integration-reconciliation.test.mjs` enforces the second half of
each of those two definitions mechanically: a `MET-AS-ADJUDICATED` entry with no
`adjudicationDelta` and a `NOT-MET` entry with no `stopReport` both fail the
suite, and so does an `adjudicationDelta` on a plain `MET`. The rule that keeps
the table honest is a test, not a review convention.

### The coverage arithmetic is COMPUTED, not restated

Goal criterion 12 asks for four zeroes. A record that simply asserts them would
be indistinguishable from one that hoped for them, so
`scripts/goal-integration-reconciliation-cli.mjs` recomputes all four from the
committed ledger and the six committed wave censuses, and the suite recomputes
them again on every test run and requires the committed record to be equal.
Two further closure counts ship beside the four, because the four are only
meaningful if nothing escaped classification:

- `ownedBuildingsAccountedByNeither` — an owned building that is neither
  materialized nor refused;
- `stopCodesOutsideClosedVocabulary` — a refusal under a code the grammar does
  not declare.

### Where the criterion texts came from, and how to check them

The Goal ledger lives in `.codex/codex-control-plane/goals/manhattan-high-fidelity-exteriors/`,
**outside this repository**, and is deliberately not vendored here — a copy
would become a second authority that could drift from the first. So no test can
read it, and the record carries the 31 criterion texts itself plus a digest over
them.

That digest catches a criterion reworded *inside* the record. To catch one
reworded in the Goal, re-run this against the live ledger and compare with
`criteriaDerivation.digest` in the record:

```sh
cd .codex/codex-control-plane/goals/manhattan-high-fidelity-exteriors
python3 -c "import json,hashlib; print(hashlib.sha256('\n'.join(json.load(open('goal.json'))['acceptanceCriteria']).encode()).hexdigest())"
# 2ffd46691bb3982e1e0b47c2139a8f8221611d34630c091a9d52498d3402f61c
```

SHA-256 over the 31 strings joined by single newlines, in declared order, no
trailing newline. The record states the method, the path, the field and the
command, so the check is reproducible without reading this ADR.

### Cheap things were re-run; expensive things were cited

Re-run fresh on 2026-08-12 in this worktree: the full suite, typecheck, lint,
build, the partition audit against the resulting `dist/`, the public-showcase
differential audit, the public-build smoke in a real Chrome, and the citywide
release validator. Cited with checksums, never re-run: every Blender re-import
census, every frame-time and heap campaign, and every wave's committed browser
journeys. Re-running a measurement campaign here would have produced a second
set of numbers with no committed predecessor to compare them against, which is
worse evidence than citing the first.

## The verdict table

17 MET · 8 MET-AS-ADJUDICATED · 6 NOT-MET. The full evidence lists, deltas and
stop reports are in `data/goal-integration-acceptance-20260812/reconciliation.json`;
this table is the index.

| # | Criterion (abbreviated) | Verdict | One line |
| --- | --- | --- | --- |
| 1 | Every accepted parent has a generated exterior; missing are zero | **NOT-MET** | 484 of 45,194 ship one; 899 are refused outright |
| 2 | Evidence-supported components use the verified real representation | MET-AS-ADJ | The antecedent set is empty — one text-only intake, zero evidence-backed components |
| 3 | Durable ownership/licence proof per evidence-backed component | MET-AS-ADJ | Vacuous; contract exists and is tested, attestation is operator-asserted |
| 4 | Zero pixels from Maps/Street View/unlicensed/platform imagery | MET | Closed denylist + fresh `dist/` audit: 0 release-data findings over 6,070 files |
| 5 | Block 835 demonstrates the full reference contract | MET-AS-ADJ | All seven sub-claims evidenced; the umbrella row stays partial on mobile (#8) |
| 6 | All-Manhattan path replays deterministically before broad release | MET | 45,194 planned / 0 stopped; `diff -qr` empty over 889 files; ran before every wave |
| 7 | 10 m+ views on the 1440p-class desktop target | **NOT-MET** | The 10 m half passes 8/8; a 1440p-class viewport was never captured |
| 8 | Mobile path retains navigation, picking, details, deep links, LOD status | **NOT-MET** | Not implemented; every capture is `mobile: false`; the project already recorded this failure |
| 9 | Exploration ≤16.7/25 ms, inspection ≤33.3/45 ms | MET | Six-wave p50 2.30–3.60, p95 5.60–13.00, against a capped control of 8.30 |
| 10 | Profile switch preserves identity, URL, details, provenance, pick owner | MET | Before/after captures identical but for profile and LOD; ambiguous ids are deleted, not overwritten |
| 11 | Immutable rollout ledger records bounds, membership, deps, status, eligibility | MET | 883 cells, six waves, per-cell membership checksums, `immutable: true` |
| 12 | Zero missing cells / parents / duplicate owners / unclassified components | MET | Computed, not asserted — a ledger-partition reading; all four zero, plus two closure counts |
| 13 | Deterministic change-impact to exact IDs and cells | MET-AS-ADJ | Implemented and tested over synthetic ledger pairs; no real source update ever occurred |
| 14 | Unchanged cells byte-identical; changed cells keep predecessors and a diff | MET-AS-ADJ | Two real V2→V3 refreshes kept their predecessors byte-identical; neither left any cell *unchanged* |
| 15 | Component inventory with machine-readable status per class | MET | 15 required classes, closed state vocabulary, release throws on an inadmissible state |
| 16 | No placeholder blank wall at 10 m+ where the grammar requires detail | MET | Block-835-scoped by the Goal's own reference-cell design; PASS at all 8 poses |
| 17 | Zero unsupported tenant/logo/occupancy/signage claims | MET | Serialized plans assert-free of text/brand/glyph; packages are glyph-free by construction |
| 18 | Registration ≤0.25 m horizontal / ≤0.5 m vertical, no tighter-than-source claim | MET | Worst 0.00047 m / 0.00050 m wave-scale; the record sets `contractual: false` |
| 19 | 2% facade projection for evidence-backed components; ≤2% silhouette | MET-AS-ADJ | Silhouette measured at 0.0018 against 0.02; the facade half is vacuous |
| 20 | Zero contract-violating defects; no accuracy score on generated components | MET-AS-ADJ | Volume identity + Blender re-import; combinatorial manifold and z-fighting are NOT claimed |
| 21 | Machine-readable fidelity and evidence tier everywhere; zero unsupported claims | MET | Four levels of tier; `unexplainedFallbacks: 0` over 44,710 unavailable details |
| 22 | The coverage envelope reaches its user-approved exterior tier | **NOT-MET** | Ledger coverage completed; the exterior tier did not — 1.07% of the envelope |
| 23 | Immutable checksum-pinned multi-LOD artifacts, deterministic replay, geo validation | MET | GLB 2 / 3D Tiles 1.1 raw-byte validators; byte-identical rebuilds across processes |
| 24 | Visual/picking/accessibility/streaming/memory/frame-time on approved device classes | **NOT-MET** | Accessibility partial; memory uncertified; neither approved device class measured |
| 25 | Licensing and public-conveyance evidence complete for every partition | MET-AS-ADJ | Six fingerprinted instruments, all recorded; none rests on a fresh third-party signature |
| 26 | Separate manifests, allowlists, checksums, envelopes; restricted unreachable | MET | Fresh build: 0 private paths in `dist/`; 10 live private probes returned the SPA shell |
| 27 | Rollback disables a wave independently and restores the previous representation | MET | Six per-wave rehearsals, each proving the other five keep streaming |
| 28 | Every wave opt-in first; default only after acceptance and explicit approval | MET | Six canaries measured at 0 artifacts on a default load; six named approval refs |
| 29 | Rollback exercise: atomic, identity-preserving, explicit unavailable, no immutable change | MET | 14/14 predecessor pins, `git diff` empty, committed browser journeys |
| 30 | Security: private roots, undeclared assets, fail-closed, ≤8 requests, ≤256 MiB, no memory growth | **NOT-MET** | Four conjuncts proven fresh; the retained-memory conjunct FAILED as first measured and has no committed verdict since |
| 31 | Documentation impact complete | MET | This ADR, the implementation record, README and the project brief |

## Three verdicts whose reasoning does not fit in a table cell

### Criterion 14 is adjudicated, not MET, and criterion 13 is why

Criterion 14 has two halves. The **changed-cell** half — predecessor links,
source dates, an auditable diff — is exercised by two real refreshes: Block 835
V2→V3 and Midtown-core V2→V3, both of which kept their predecessor records
byte-identical to the releases they name.

The **unchanged-cell** half is not. Both refreshes were *grammar* changes, and a
grammar change regenerates every renderable cell of the wave by construction, so
**no committed refresh ever carried a cell across a version untouched.** What
exists is the contract that would catch it — `exterior-release.ts:660` refuses
unchanged-hash drift, and four per-wave fingerprint suites prove a derived
subset re-derives byte-identically — but a contract is not an exercise.

That is exactly the shape of criterion 13, which was adjudicated for exactly
this reason: the machinery is proven, the real event it exists for never
happened. Grading 14 as MET while grading 13 as adjudicated would have been an
inconsistency in the table itself, so 14 moved rather than 13.

### Criterion 12 is MET and criterion 1 is NOT-MET over the same 45,194 parents

This looks like a contradiction and is not, so the record says which question
each is answering.

Criterion 12 is a **ledger-partition** reading: every declared cell belongs to
exactly one wave, and every accepted parent is owned exactly once. It is a
statement about the immutable ownership partition. It says nothing whatever
about whether a parent's exterior was built, retained, or shipped.

Criterion 1 asks the **missing-exterior** question over the same set, and the
answer is 484 shipped and 899 refused. Ownership closure and exterior presence
are different properties of the same 45,194 ids, and both readings are true at
once.

One further scope note, because the metric name used to overstate itself: the
computed count is `buildingsWithoutStyleClass`, which is what a census can
count. Criterion 12's "zero unclassified exterior **components**" half is
carried by criterion 15's contract instead — a component outside the closed
`generated` / `evidence-backed` / `absent` / `not-applicable` vocabulary makes
`v3TruthTiers()` throw, so an unclassified component cannot reach a release for
a census to find. The zero is enforced upstream rather than measured downstream,
and the metric no longer claims to have looked for one.

### Criterion 30's memory conjunct FAILED when it was first measured

The evidence for criterion 30 now leads with the reading that failed, because
listing only the later, kinder numbers would let a reader infer a trajectory
that the record does not support.

**T009 row 18** measured retained heap **growing 28.8% and 32.4%** across
repeated deterministic camera paths and recorded the conjunct as **NOT SATISFIED
AS WRITTEN**. The row carries its own method caveat: the readings were taken
*without* a forced collection, so a rising `usedJSHeapSize` is equally
consistent with garbage that had not yet been collected. That caveat is why the
reading was superseded rather than treated as a defect — and it is also why the
superseding readings had to force collection to say anything at all.

The superseding readings, both with forced collection: Block 835 V3 heap
**shrank** 13.3% and 12.0%; Midtown −0.107 and −0.105 against a 0.10 band. Both
are prose over untracked raw files rather than committed records, and both
predate the four textured waves. So the sequence is: measured and failed,
re-measured with a better method and passed on two waves, never measured again
on the four waves that carry textures or on the composition that ships.

## The six stop reports, in the order they would be worth doing

### 1. Criterion 30 — the memory conjunct (smallest, and purely a measurement)

`grep -rn "monoton" data/` returns **zero hits**. No committed record for any of
the six waves carries a first-half/second-half growth ratio, a noise band, or a
pass/fail. The twelve `heapAfterGcBytes` readings in each acceptance record are
three repeats across four *different* camera stations — not repeats of one
deterministic path, which is what the criterion asks about.

The full sequence — the failing T009 reading, its method caveat, and the two
superseding forced-collection readings — is above. Nothing covers the four
textured waves or the six-wave composition, which is what ships.

**To close:** run the existing `block835CanaryHeapVerdict` method over a
*repeated* deterministic camera path on the six-wave composition with
`HeapProfiler.collectGarbage` between repeats and commit the ratio. The
acceptance CLIs already force collection and read `usedJSHeapSize`; only the
repeated-single-path shape and the verdict are missing. Record the measured peak
concurrent exterior request count in the same run — `grep -rn "peakConcurren"
data/` also returns zero, and the four acceptance records carry
`maxConcurrentRequests` as a *configuration* value, not a measurement.

### 2. Criterion 7 — the 1440p-class capture (a re-capture, nothing new)

The 10-metre half is fully evidenced: `facade-path.json` declares a 10 m
contract floor, the closest pose sits at 13 m, all 8 poses render 14/14
buildings, and no grammar-required blank wall appears. Only the *viewport* is
wrong. Every capture in this Goal ran at 1097×894, 1280×800 dpr 1, or 1728×920
dpr 2, and the T009 record says in its own words that this "is not a 1440p-class
2560×1440 CSS viewport" and marks every scale-dependent row partial.

**To close:** re-capture the committed `block835-canary-facade-v1` path at
2560×1440 CSS. The path, the poses and the reading procedure are already
committed.

### 3. Criterion 24 — accessibility behaviour (independent of the other two)

The structural probe passed: 26 focusable elements, 23 buttons, **0 unlabeled**,
8 landmarks, correctly toggling `aria-pressed`, and a `prefers-reduced-motion`
rule in the shipped stylesheet. Real keyboard traversal and reduced-motion
*behaviour* were never proven — blocked by a CDP focus limitation, not by a
design gap.

**To close:** drive the traversal in a browser that can hold focus. The probe
already enumerates the elements to traverse.

### 4. Criterion 8 — the mobile path (a build, not a capture)

This is the only criterion with **no evidence of any kind**. `overlayLayoutPolicy`
exists and is unit-tested, but has no production caller and there is no
`matchMedia` in `App.tsx`. Responsive CSS exists at 900 px and 680 px but was
never measured in this Goal. The T009 record already classified this as an
"EXPLICIT FAILURE — unmet, not implemented" and as "an unstarted Goal
obligation", and nothing since changed that.

One clarification, so the record is not read as worse than it is: the 2026-08-06
Stage 3 overlay work did validate an iPhone 14 *layout*. That is a different
release and a different claim; it says nothing about an exterior lower-LOD
policy or its disclosure.

**To close:** implement the mobile lower-LOD policy and its explicit status
disclosure, wire `overlayLayoutPolicy` to a real viewport signal, and capture
one mobile-emulated journey proving navigation, picking, details, provenance and
deep links survive with the lower-LOD status shown and no parity claim.

### 5 and 6. Criteria 1 and 22 — the same structural gap, stated twice

These are the two that decide whether the Goal is finished, and they are one
problem wearing two criteria.

**Criterion 1** asks for zero missing exterior representations. Two things stand
between the delivered work and that:

- **Retention.** The six censuses *materialized* 44,295 of 45,194 parents — the
  geometry was generated, measured and validated — but at `retention:
  "census-only"`. Those bytes were discarded. Only 484 parents ship a retained
  exterior.
- **Refusal.** 899 parents are refused outright by the grammar under named stop
  codes, dominated by `source-height-below-grammar-minimum` (384) and
  `ring-vertex-count-unsupported` (324). Each is tombstoned with a reason, which
  is the honest behaviour; it is not zero.

**Criterion 22** asks the coverage envelope to reach its approved exterior tier.
What was reached is *ledger coverage* — every declared wave has a promoted
default — at 484 of 45,194, or 1.07%. ADR 0037 already said this in its own
words: "It is completeness of COVERAGE, not of the city."

**To close, and why it is not a small task:** the binding constraint is the
512-entry all-resident exterior cache contract. The six promoted subsets occupy
498 of 512 entries. ADR 0024's cell scheduling is the named structural
prerequisite that would make breadth a function of what the camera can see
rather than of a fixed resident budget. **Until it exists, "promote more of a
wave" and "raise the cache cap" are the same decision**, and no amount of
further curation moves 1.07% materially.

The refusal half is a separate choice, and it is the user's rather than an
implementer's: either close the 899 refusals by extending the grammar, or record
an adjudication that a tombstoned refusal under a named stop code satisfies
criterion 1. This ADR does not make that choice.

## What the reconciliation FOUND that was not already written down

Three things, all reported rather than repaired.

### The T023 smoke journey is not reproducible from a clean browser profile

`scripts/public-showcase-smoke-cli.mjs` was re-run against a fresh build in both
headless and headed Chrome with fresh profiles. Its `six-wave-default` journey
**failed both times**: a fresh profile issues `/favicon.ico`, which the
showcase allowlist classifier does not categorise, so `everyRequestClassified`
reads `false` (554 distinct URLs against the committed record's 553).

The substance is unaffected and was verified: zero external hosts, all six waves
streaming their exact expected GLB counts (14/156/71/179/40/24 = 484), and every
declared private path returning the SPA-shell hash rather than private bytes.
The preview answers `/favicon.ico` with a 404 of zero bytes, which is failing
closed. But the committed pass depended on browser-profile state, which is not a
property of the release.

**Not repaired here.** The classifier is T023's, and editing it would make the
committed `smoke-evidence.json` non-reproducible in the other direction. It is
recorded as a residual risk and **registered as a follow-up task**, together
with the audit self-rewrite below.

### The wave ledger's `eligibility.json` now reads stale, correctly

It declares all 883 cells private-eligible and **0 public-eligible**, on a basis
stating that no cell is public-eligible until a promotion supplies per-cell
rights-cleared evidence. Six promotions have since shipped public roots under
per-wave instruments. The artifact is v1, pinned to the ledger checksum, and was
correctly *not* mutated. The live eligibility authority is the six approval
instruments; this file is a frozen v1 statement and should be read as one.

### The showcase audit rewrites its own committed record, and this task tripped it

`pnpm showcase:audit` writes to `data/public-showcase-20260812/differential-audit.json`
in place, and one of its totals — `workingRecordDirectories` — is a count of the
working-record directories under `data/`. Re-running it fresh at the start of
this task reproduced the committed bytes **exactly**, which is good evidence and
is cited under criterion 25.

Re-running it *after* this task created `data/goal-integration-acceptance-20260812/`
raised the count from 19 to 20 and changed the record's checksum. **The file was
restored to its committed bytes and was not re-emitted.** No drift suite broke:
`src/release/public-showcase-evidence-consistency.test.ts` reads the committed
record but does not recompute that total.

The general shape is worth naming: an evidence record whose contents depend on
the *presence* of later evidence records is self-invalidating by construction.
The committed record is a T023 snapshot and is the authority; the README now
carries the caveat next to the command, and the repair is **registered as a
follow-up task** rather than made here.

### Two prose drifts between ADR 0038 and its own committed audit

ADR 0038 says 18 working-record directories where the audit records 19, and
describes a 14-versus-19 app-shell request split the audit does not carry. The
committed records are authoritative; the ADR text is the stale side. Left
uncorrected, because editing a merged ADR's numbers to match a record is exactly
how a record stops being the thing that gets checked.

## Residual risks carried forward

1. **The volume-margin pattern is still unexplained.** The wave-scale worst
   accepted volume-identity deviation was 0.988 of tolerance for
   central-upper-Manhattan and 0.9895 for northern-Manhattan, which refused 16
   buildings for exceeding it. Two waves in a row above ninety-eight hundredths
   is a pattern, not a coincidence. No tolerance was moved; ADR 0037 precondition
   (e) recorded that the explanation is owed, and it is still owed.
2. **Load-dependent test flakes, isolated to worker contention.**
   `src/release/midtown-core-v3-release.test.ts` and `src/app/App.test.tsx` time
   out against vitest's 5,000 ms default under CPU load and pass in isolation.
   These are timeouts, not assertion failures. The isolating measurement:
   `npx vitest run --no-file-parallelism` passed **1,535 of 1,535 twice in a
   row** at ~72 s, while the default parallel run intermittently drops exactly
   one of these two files. The trigger is therefore worker CPU contention, not
   test order or shared state; `--no-file-parallelism` is a reliable workaround
   and a raised `testTimeout` would close it properly.
   `midtown-core-v3-release.test.ts` alone takes about 20 s for 20 tests, so it
   is the first to go.
3. **The T023 smoke reproducibility gap**, above.
4. **The stale immutable `eligibility.json`**, above.
5. **Structural validation is not visual, geographic or production proof.** A
   signed-volume identity, a checksum and a passing suite do not prove a facade
   looks right or that a building sits where the real one does. The near-field
   visual reading is Block-835-scoped, and the isolated slow frames of 116.2 ms
   and 140.0 ms are recorded rather than smoothed.
6. **The privacy and evidence machinery has only ever run on synthetic
   fixtures.** No self-captured evidence exists in the repository, no committed
   record carries a `redactedArtifactRef`, and ADR 0022 records that the privacy
   review is attestation-only.

## Consequences

- The Goal has a committed, machine-checked criterion-by-criterion record, and
  the record's rules are enforced by a suite rather than by review.
- Criterion 12's four zeroes are computed from the committed ledger and censuses
  on every test run and cannot drift from them.
- 17 MET, 8 MET-AS-ADJUDICATED. **Six criteria are NOT-MET with stop reports.
  The Goal is not complete**, and
  this ADR does not recommend declaring it complete. Whether to close the six,
  to re-scope them, or to accept them as recorded gaps is a Goal-level decision
  and is not made here.
- Documentation now agrees with the accepted release behaviour, including the
  parts that are unflattering: 484 of 45,194, no mobile path, and a public
  candidate that is local only.

## What this ADR does not claim

- It does not claim the delivered exteriors resemble, reproduce or report on any
  real building's facade.
- It does not claim Manhattan is modelled. It claims 484 of 45,194 parents carry
  a generated exterior by default and says so wherever the number appears.
- It does not claim the six unmet criteria are unimportant, or that the
  adjudicated eight were satisfied in the sense their authors meant.
- It does not claim the reconciliation is a substitute for the measurements it
  cites. It is arithmetic over committed records plus a reading of them.
- It does not authorize deployment, publication, acquisition, or any widening of
  an approval envelope.
