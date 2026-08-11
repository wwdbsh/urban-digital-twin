# ADR 0037: The Northern-Manhattan wave — the last one, and the reservation it inherits

- Status: Accepted
- Date: 2026-08-12
- Task: T021 (Issue #22)
- Supersedes: nothing. Extends ADR 0024 (wave ledger), ADR 0031 (V3 grammar),
  ADR 0032 (procedural facade textures), ADR 0034, ADR 0035 and ADR 0036.

## Why a new ADR rather than another section of ADR 0036

ADR 0036 is the record of wave `w04`: its census, its canary, and the 78-entry
headroom split T020 took inside it. This wave's facts are its own — a different
partition, a different census, a different ceiling, and a promotion budget that
was decided by somebody else before this task began. Appending them to 0036 would
make one document the record of two waves and would blur which measurement
belongs to which partition, which is precisely the confusion ADR 0035 and ADR 0036
had to spend paragraphs undoing.

It is also the last of these. Wave `w05` is the sixth and final wave the committed
ledger declares, so this ADR closes the sequence 0029 → 0034 → 0035 → 0036 → 0037.
That is a fact about coverage and about nothing else, and the sections below take
some care to say what it does NOT mean.

## Context

The committed exterior wave ledger `manhattan-exterior-wave-ledger-20260804`
partitions the pinned `manhattan-citywide-20260804` base into six waves. Five are
now materialized AND promoted:

| wave | id | cells | buildings | promoted release | cache entries |
| --- | --- | --- | --- | --- | --- |
| w00 | `block-835` | 1 | 14 | `manhattan-exterior-cells-20260811-v3` | 28 |
| w01 | `midtown-core` | 149 | 7,201 | `manhattan-midtown-core-cells-20260811-v3` | 156 |
| w02 | `lower-manhattan` | 126 | 6,425 | `manhattan-lower-manhattan-cells-20260812-p1` | 71 |
| w03 | `southern-remainder` | 176 | 9,603 | `manhattan-southern-remainder-cells-20260812-p1` | 179 |
| w04 | `central-upper-manhattan` | 249 | 11,721 | `manhattan-central-upper-manhattan-cells-20260812-p1` | 40 |
| w05 | `northern-manhattan` | 182 | 10,230 | — | — |

This task materializes `w05` as `manhattan-northern-manhattan-cells-20260812`: an
opt-in textured private canary with a public-audience candidate root. It is NOT
promoted. Promotion is T022.

## Decision 1 — the wave-generic machinery is reused, and the registry is now COMPLETE

`northern-manhattan-package.ts` supplies only what is this wave's own: its release
id, its declared shape (182 cells, 10,230 buildings, read out of the committed
digest rather than restated), its two hash domains under the `udt.<wave-slug>.*`
scheme, and the set of predecessor waves it must be proven disjoint from. The
derivation itself is the shared `exterior-wave-subset.ts`.

Its row was added to the closed-table domain registry and the three tests covering
it were watched to FAIL with the row removed:

- `covers every wave the committed plan declares` — "expected [ …(3) ] to deeply
  equal [ …(4) ]";
- `agrees with what the five live wave modules declare` — the same, in the other
  direction;
- `refuses borrowing from the northern-manhattan wave` — "expected [Function] to
  throw error matching /borrows hash domain "udt\.northern-m…/ but got 'Wave
  hypothetical-wave-w06 is not in …'";
- `refuses a registered wave that arrives with different domains` — "got 'Wave
  northern-manhattan is not in the…'".

That last pair matters more here than at any earlier wave, because
`udt.northern-manhattan.*` was this suite's own STANDING EXAMPLE of a fresh,
unowned domain. Every previous wave's borrow test used one of those two strings as
the half of the identity that was fine. Until this row existed, either could have
been copied into a real sixth wave module and the registry would have said
nothing.

### The registry's completeness is now ASSERTED, not noted

A new test requires the registry's wave ids to be exactly the declared plan's,
minus wave `w00` (Block 835 predates this machinery and derives no subset id). It
fails in BOTH directions: a future ledger declaring a seventh wave goes red until
that wave has a row, and a row invented for a wave the plan does not contain goes
red too.

The second direction is what keeps Decision 1's other half honest. "Closed table"
now means closed in two senses, and they are different: the guard is still open to
any wave a future ledger might declare and would refuse it for having no row,
exactly as it refuses one today. What is complete is THIS ledger's coverage, not
the mechanism.

### The hypothetical was made FICTIONAL, which ADR 0036 (f) required

ADR 0036 precondition (f) said the domain registry's unregistered-wave
hypothetical runs out at this task. It had been repointed three times — `w03`,
then `w04`, then `w05` — because a hypothetical that names a REGISTERED wave stops
testing what it says: the registry would then have two reasons to refuse it, and
which error surfaced would depend on row order rather than on the defect.

`w05` is now registered and there is no `w06`. The two wrong ways out were
refused: inventing a seventh wave the ledger does not declare, and leaving the
hypothetical on a registered `w05`. The id is now `hypothetical-wave-w06`, a
string no plan contains and no module will claim, so the test stays about an
UNREGISTERED wave permanently without asserting that a seventh wave exists. Its
declared shape is zero cells and zero buildings — a wave that does not exist owns
nothing — and neither number is ever read, because the guard refuses the identity
before the builder selects a cell. The completeness test above is what makes
"registering it" a failure rather than a fix.

### The excluded set widened to all FIVE promoted waves — and it is now COMPLETE

Wave `w04` excluded waves 0–3. This wave excludes 0–4, because all five are
promoted and the App shares ONE exterior cache across every promoted wave; a
building owned twice would be an ownership contradiction and a cache-identity
hazard at once. Waves 2, 3 and 4 are excluded over their PARENT cells, which are
the same buildings their `-p1` successors own.

Every earlier wave's exclusion list was complete-for-now, with a later wave it
said nothing about. This one has no remainder, and a test asserts the stronger
claim that only the last wave can make: **this subset's cells plus its exclusions
are the whole 883-cell parent ledger, and its buildings plus the excluded waves'
buildings are the whole 45,194-building base identity set, with no overlap.** After
this release every building of the pinned base is owned by exactly one wave
release, none left over and none owned twice.

### The order-derived walk was EXTRACTED rather than copied a fourth time

Waves `w02`, `w03` and `w04` each carry a private copy of the renderable-cell walk
in their own release module — the exact drift `exterior-wave-subset.ts` was
extracted to prevent, repeated three times. This task did not write a fourth. The
walk is now `deriveExteriorWaveRenderableCells` in the shared module, and this
wave delegates to it.

The three existing copies are NOT edited. They are the code three shipped releases
were emitted by, and rewriting them to delegate would change modules that describe
frozen bytes for no behavioural reason. The anti-drift guarantee is supplied by
assertion instead: a suite runs every copy beside the generic function over the
same cells at every budget from 1 to 200 and requires agreement on the cells
chosen, the buildings owned, the spare entries, and on whether the budget is
refusable at all. Only the error TEXT may differ, and does — see Decision 4.

## Decision 2 — the kill switch is INHERITED, and the inheritance is stated

No `probe` stage was run. The kill switch asks one question — are procedural
detail tiles affordable in the shipping renderer at all — and it has been answered
four times on this exact tile catalogue, sampler filter and LOD placement: T015
PASS, T016 off the vsync floor, T018 on a four-wave composition at the raised cap,
T020 on a five-wave composition. This wave changes which buildings carry the tiles,
not the tiles.

This is written down as an INHERITANCE rather than implied by the absence of a
stage. What has NOT been measured is a SIX-wave composition, and nothing in this
release implies one: an opt-in session loads this release alone, so no capture here
observes six waves resident together. That measurement is T022's.

## Decision 3 — the promotion budget was already DECIDED, and this release states what it buys

Every earlier wave canary derived a headroom and then said the headroom was not yet
anybody's to spend. For this wave the question is settled before the task begins.
T020 took ADR 0036 Decision 3's response 2, split the 78-entry headroom
proportional to canonical buildings — 42 to `w04`, **36 RESERVED for
`northern-manhattan`** — and wrote both numbers into its own committed
`payload-inventory.json`.

So this release does not open a split. It INHERITS a number, and what it owes the
record is to say what that number does and does not buy. The reservation is READ
from T020's committed bytes rather than retyped here, and the derivation refuses a
reservation that is missing, that names a different wave, that reserves nothing, or
that comes from the wrong release.

### Two numbers are recorded because they DIFFER

    512 - 28 - 156 - 71 - 179 - 40 = 38 entries actually free
                              36   entries T020 reserved
                               2   difference

The 2-entry surplus is what wave `w04`'s promotion did not spend of its own
42-entry share: its curated subset owned 41 buildings and the grammar refused one,
so it shipped 40. **T022 is bound by the 36 it was PROMISED, not by the 38 that
happen to be free**, because the promise is a recorded decision and the surplus is
an artifact of a refusal. A promotion that wants the extra 2 must re-open the split
and say that it did. Both numbers ship in this release's own bytes, because
recording only the 38 reads as a licence and recording only the 36 hides that the
promoted set under-spent.

The derivation also fails closed the other way: a reservation that no longer fits
what is actually free is not the decision that was recorded, and honouring it at a
smaller size would be re-cutting a split nobody re-opened. A simulated sixth
promotion turns that into "the reservation no longer fits the cache it was split
out of and must be re-decided rather than silently re-cut".

**And the split must ADD UP.** Reading `reservedForNextWaveEntries` alone would
inherit a number without ever checking it against the decision that produced it: a
predecessor re-emitted with a different share, a different headroom, or a
reservation edited on its own would all leave the inherited number looking exactly
as authoritative as a coherent one. So the two halves are read as well — 42 taken,
36 reserved — and required to reconstitute the 78-entry headroom they were split
out of. A record that omits either half is refused rather than trusted.

One field in the occupancy record is TAUTOLOGICAL BY CONSTRUCTION and says so in
its own comment: `reservationStillFitsHeadroom` can only ever be `true`, because
the guard throws first. It ships because a record carrying the headroom and the
reservation side by side invites the question "was that compared?", and it is
written as a literal rather than recomputed so that nothing dresses a tautology up
as a check. The interesting number beside it is `headroomExceedsReservationBy`,
which is a real measurement.

### THE RESERVATION DOES NOT ADMIT AN ORDINARY CELL OF THIS WAVE

This is the finding T022 inherits, and it is a measurement rather than a warning.

| quantity | value |
| --- | --- |
| median cell of `w05` | 55 buildings |
| reservation | 36 entries |
| whole measured headroom | 38 entries |
| cells fitting the reservation | 50 of 182 |
| cells fitting the headroom | 54 of 182 |
| `admitsMedianCellWithinReservation` | **false** |
| `admitsMedianCellAlongsidePromoted` | **false** |

Wave `w04`'s canary could report `admitsMedianCellAlongsidePromoted: true` and had
to add a second boolean to stop that reading as a clearance. This wave reports
false to both. A promoted subset here must be curated BELOW median cell size, or
the split must be re-opened explicitly. Neither is decided in a canary.

### The last-wave premise is enforced, not assumed

Every reservation sentence above rests on there being no other unpromoted wave. The
derivation takes the remaining-unpromoted list — derived by subtracting the promoted
list from the declared plan, never written down twice — and records
`isLastUnpromotedWave` from it. A rolled-back promotion makes that `false` and the
record says so, instead of continuing to describe a reservation as uncontested. A
list that omits this wave fails the run outright.

## Decision 4 — the subset is ORDER-DERIVED, and the ceiling MOVED

The renderable subset is chosen by walking the wave's own ledger priority order and
admitting a cell only while the whole subset still fits the entry budget. Whole
cells only; the walk STOPS at the first cell that does not fit rather than skipping
it, because skipping would reorder the wave's declared visual priority to fill a
budget — a curation nobody recorded. Curation belongs to promotion, where it can be
defended.

### 80 was tried first and admits NOTHING here

Three canaries in a row used an 80-entry self-imposed ceiling. It selects zero
cells for this wave, and the walk throws by design:

    Wave northern-manhattan: no cell fits the 80-entry renderable budget;
    the first cell in priority order, manhattan-exterior-cell-w05-000701-15-9651-8954,
    owns 86 buildings.

That is a fact about the wave, not about the walk. `w05` has the LARGEST median
cell of the six — 55 against `w04`'s 48 — and its leading cells are among its
largest. Both halves are asserted against the committed digest so this account
cannot drift from the partition it describes.

### The ceiling is 100, and the move is recorded as a decision

100 is the smallest round ceiling that admits the wave's leading cell. At 512
entries it is under a fifth of the cache, so this canary remains cheaper in
relative terms than the `w03` canary was at 80 of 256. It is deliberately not
re-scaled to anything else, and `EXTERIOR_RUNTIME_BUDGETS` is unchanged.

### What it admits is ONE cell, and that is also a fact about the wave

    cell w05-000701   86 owned   → admitted, total 86
    cell w05-000702   42 owned   → would total 128, above 100 → walk stops
    → 1 cell, 86 owned, 14 spare

A subset of two or three cells — the shape the earlier canaries had — is not
reachable here without either doubling the ceiling to 128 or skipping cells. The
task sketch asked for roughly two to three cells AND at most 100 assets; those two
are not simultaneously satisfiable for this partition, and the asset bound was
treated as binding over the cell-count sketch. This is recorded as a deviation
rather than presented as the intended shape.

The walk now emits WHY it stopped, and the release's committed record carries it:
`renderableWalk.stoppedAt` names cell `w05-000702`, its 42 buildings, and the 128
the subset would have totalled. A one-cell list alone cannot distinguish "the
budget ran out" from "the wave ran out", and for this wave that distinction is the
whole story of its size.

### The canary's budget is LARGER than the reservation, deliberately

`entryBudgetFitsReservation` is **false**, and recording it is the point.
`?exteriorCells=` SELECTS the named release and only it — measured, not assumed,
see Journeys — so an opt-in session holds this release's assets and nothing else
and is budgeted against the cache. The canary's 100-entry ceiling and T022's
36-entry reservation are incomparable quantities. Nobody may read this canary's
size as a promotion rehearsal.

For this wave that isolation is not merely convenient, it is what makes the subset
possible at all: 38 entries are free beside the promoted waves and this subset
ships 76 assets, so a session holding both could not be resident.

## Decision 5 — the rights instrument is NEW, and says it rests on no fresh signature

A new approval scope was authored, on exactly the terms the `w04` instrument was
authored on. No frozen approval text was edited. The Block 835 and Midtown-core
scopes exclude "runtime textures of any kind"; each textured wave's scope
enumerates its own partition in its operative first sentence. None can be read onto
`w05` without saying something false about what was approved.

The exclusion list is BYTE-EQUAL to the `w04` list, in the same order, and a test
asserts that in both directions: a canary that quietly dropped an exclusion would
be broadening an envelope, and one that reordered it would move a fingerprint for
no reason. The tile verbs stay narrower than the geometry's — local application
display and derivative conveyance only, redistribution excluded outright — because
no recorded item broadened anything to permit redistributing generated tiles.

**THIS INSTRUMENT RESTS ON NO FRESH SIGNATURE.** Nobody was asked to approve wave
`w05` specifically and nobody did. Its authority is exactly the two recorded items
every textured wave's instrument has named: the user's texture direction of
2026-08-11 and the recorded standing autonomy directive. A separate instrument was
authored because the operative text enumerates a partition, not because permission
was obtained.

### The clause this wave needs and its predecessors did not

This instrument is the one that makes the ledger's whole partition covered by
approved releases. "The whole city is covered now" is exactly the sentence a reader
could mistake for a broader permission, and the specific mistake worth pre-empting
is the assembly one. So the note says, in its own words, that being the last wave
broadens nothing; that an envelope is a set of verbs over a set of sources for a
stated audience and none of the three moved; and that **nothing in it authorizes
assembling the six waves into a redistributable whole that no single wave's
instrument would permit.** Public internet deployment is excluded here exactly as it
is excluded in every predecessor.

## Decision 6 — the wave census is untextured, and the note is GENERATED

The census over all 10,230 owned buildings runs on the untextured profile. The
question is about GEOMETRY — which sourced polygons this grammar can carry — and
tiles are a writer-stage concern that touches no plan field. The census profile
shares this wave's seed, tool and generated instant with the shipped profile, so
every plan hash is identical between the two passes and the census is a true
statement about the buildings that ship.

The committed note is a FUNCTION of the measurements rather than prose written
beside them. That is a direct response to a defect this ADR series has already had
to repair once: ADR 0035 asserted a meaning for equal plan-stage and asset-stage
totals, and ADR 0036 had to retract it. A generated note cannot keep asserting a
previous wave's finding, and this one does not — it states the relationship between
the two distributions, and refuses to read anything into whether their totals
happen to be equal.

## The refusal census, reported rather than tuned

Census over all 10,230 owned buildings. **365 refused at the plan stage, 381 at the
asset stage, 3.72% against a 15% STOP.** Every refusal is named by stop code and no
tolerance was moved.

| stop code | plan stage | asset stage |
| --- | --- | --- |
| `ring-vertex-count-unsupported` | 164 | 164 |
| `source-height-below-grammar-minimum` | 164 | 164 |
| `ring-area-below-floor` | 26 | 26 |
| `ring-neck-below-grammar-minimum` | 10 | 10 |
| `ring-not-simple` | 1 | 1 |
| `volume-identity-failed` | — | **16** |
| total | 365 | 381 |

The asset distribution is always a superset of the plan distribution and the only
key that can appear in it alone is the writer's, because the volume identity can
only fail after a plan has been accepted and geometry generated. What the census
suite asserts is that RELATIONSHIP and the identity of the only key that may differ
— not whether the totals happen to be equal. Wave `w03`'s suite asserted a
non-empty difference; wave `w04`'s could not, because its writer rejected nothing.
Pinning either is pinning an accident of the partition.

### The volume margin is the narrowest yet, and 16 buildings fell the other side

| | value |
| --- | --- |
| buildings checked | 9,865 |
| buildings accepted | 9,849 |
| buildings rejected | 16 |
| worst ACCEPTED deviation | 9.895 × 10⁻⁷ |
| tolerance | 1 × 10⁻⁶ |
| worst as fraction of tolerance | **0.9895** |

The denominator is accepted + rejected, not `materializedBuildingCount`. A building
this check rejects never becomes a materialized building, so the materialized count
is the count that PASSED; an earlier draft of the record used it as
`buildingsChecked` and produced the contradiction "ran on 9,849 buildings and
rejected 16 of them" with the 16 outside the 9,849. Both halves now ship, the
generated statement explains which is which, and the curated-variant path was fixed
in the same change so T022's successor cannot inherit the wrong denominator.

ADR 0036 called `w04`'s 0.988 narrow and left it unexplained. This wave sits higher
still AND refuses 16 buildings for exceeding the line. "Inside tolerance" is true
and is not the same as "comfortably inside", and the census suite bounds the
fraction from BELOW as well as above so that quietly widening the tolerance fails
rather than looks comfortable. No tolerance was moved.

The margin is corroborated INDEPENDENTLY rather than by a second reading of the
writer's own arithmetic — see the Blender pass below — which is the only kind of
evidence worth having when the writer would otherwise be grading itself.

### Absent setbacks are now the MAJORITY of the wave

5,880 of 9,849 materialized buildings — **59.7%** — ship `setbacks` absent with a
stated reason rather than an invented offset. Wave `w04`'s share was 46.6%; this is
the first wave to cross a half. It is disclosed as a first-class count, and stated
as a share as well as a total, because "5,880" alone reads as a footnote and "three
buildings in five ship no setback" does not.

### The shipped subset refuses at more than THREE TIMES the wave rate

10 of the 86 buildings the single renderable cell owns were refused — 11.6% against
the wave's 3.7%. A canary's subset is order-derived, so it has no reason to be
representative, and reporting only the wave rate would let a reader assume it was.
The gap is wider here than in any earlier wave canary and the RATIO is asserted,
not only the direction, so a future subset that quietly became representative would
have to say so.

## The Blender pass

69 of the 76 shipped assets, drawn from twelve deterministic strata including one
that selects for the most distinct tile motifs, plus every one of the cell's 53
disclosed tier collapses.

| check | result |
| --- | --- |
| samples / renders | 69 / 69 |
| textured samples | 69 (206 embedded images) |
| declared-vs-measured image count mismatches | 0 |
| textures unreachable (no UV layer or no material binding) | 0 |
| minimum UV layer count | 1 |
| triangle delta, material mismatches | 0, 0 |
| bounds deviation (Y-up remap) | 0.0 m |
| Z-up control hypothesis | 6.28 m — the diff measures something |
| worst volume deviation, recomputed from the imported mesh | 1.57 × 10⁻⁷ (0.157 of tolerance) |
| not-solid count | 0 |

Every measured checksum was cross-checked against this release's committed payload
inventory before being recorded, so the report is provably about the bytes that
shipped rather than whatever was on disk.

It is a SAMPLE of 69 of 76 and is described as one, with the share stated in the
record so nobody has to divide two numbers in different files to learn it. The
release's own gates ran on all 76.

## A latent defect in the pipeline template, found by this wave

The sample stage of the three earlier waves' pipelines caught grammar stops around
the PLAN call and called the asset WRITER unguarded. That was survivable only
because no building inside those waves' renderable cells ever failed the writer's
volume identity. Two do here, and the stage crashed with an uncaught
`volume-identity-failed` rather than sampling the wave.

Fixed in this wave's pipeline: a writer-stage stop excludes the building from the
candidate pool, exactly as the materializer already refuses it, and the two ids are
COUNTED into the receipt so the exclusion is visible. A silent `continue` would
have made the sample quietly smaller than the shipped set for a reason no record
stated. The three earlier pipelines are not edited — they emitted frozen bytes and
their waves cannot hit the path — and this ADR records the defect rather than
leaving the divergence unexplained.

## Journeys

Four, in a real Chrome against the production preview and the real pinned citywide
base, with the served bundle identified BEFORE any capture and required to be
byte-identical to this tree's `dist/`. All four passed.

| journey | reading |
| --- | --- |
| `promoted-default-unchanged` | a clean load streams 14/156/71/179/40 GLBs from the five promoted waves and **0** from this release, at a pose inside this release's own framed cell |
| `canary-opt-in` | the opt-in link streams **76** GLBs from this release and **0** from every promoted wave; the still DIFFERS from the promoted default's at the identical pose |
| `textured-pick` | a picked building names its release, cell, cell release, the SHA-256 of the asset on screen, its truth tiers and an uncertainty statement |
| `tombstone-truth` | "181 of 182 exterior cells ship no exterior geometry in this release; no substitute was selected for them" |

`promoted-default-unchanged` is the first such journey measured against a COMPLETE
promoted composition: five waves is every wave the ledger declares except this one.

`canary-opt-in` is load-bearing beyond its own claim, and more so for this wave than
for any before it. The entry budget rests on `?exteriorCells=` SELECTING rather than
ADDING, and here the promoted waves occupy 474 of 512 entries while this subset ships
76 — a session holding both could not be resident. The still-differs check exists
because a top-down pose once produced a byte-identical still, in which opting into a
whole textured wave changed nothing visible.

Two journeys load the same URL at the same pose in separate pages and produce
byte-identical stills. That is renderer determinism across sessions; it is RECORDED
with an explanation and deliberately NOT part of `passed`, because progressive
streaming could legitimately settle differently and neither outcome bears on the
tombstone sentence.

## Consequences

- Wave `w05` is materialized, checksum-pinned, and reachable only by explicit
  opt-in. Nothing an ordinary session loads has changed, and a browser measured it.
- Every wave the committed ledger declares now has an approved release. The
  partition is fully covered for the first time, and the rights instrument says in
  its own text that this grants nothing.
- The order-derived renderable-cell walk exists once in the shared module, and the
  three per-wave copies are pinned to it by an equivalence suite rather than left
  free to drift.
- The domain registry covers every wave this ledger declares, asserts that it does,
  and refuses a row for a wave the plan does not contain.
- T022 inherits a 36-entry reservation that does not admit an ordinary cell of this
  wave.

## Preconditions on T022 (promotion)

### (a) The 36-entry reservation is the budget, and it BINDS

The promoted subset must fit 36 entries. 38 are momentarily free; the extra 2 are
what `w04`'s promotion did not spend of its own share and are not this wave's. A
promotion that needs more than 36 must re-open ADR 0036 Decision 3's split
EXPLICITLY, state that it did, and record the new numbers in its own committed
bytes — the same standard T020 was held to.

### (b) The subset must be an explicit CURATED list at a rate near the wave's

36 is below this wave's median cell of 55, so a curated subset here is a
below-median subset by construction and the curation must say so. The canary's
order-derived cell `w05-000701` must not be inherited by silence: it is the wave's
FIRST ground, not its best, and it refuses at 11.6% against the wave's 3.7%. The
promoted subset's local refusal rate must be RECOMPUTED from its own shipped census
and reported against the wave rate, and a subset whose rate sits far above the wave's
must be defended or replaced rather than shipped with the wave figure quoted beside
it.

### (c) The volume margin must be checked on the curated subset, not inherited

The wave-scale worst accepted deviation is 0.9895 of tolerance and 16 buildings were
refused outright. The curated subset's own margin is a different measurement over a
different set and must be measured, recorded as a measurement — checked, rejected,
worst deviation, tolerance — and gated fail-closed, exactly as ADR 0036 required of
T020. It may not be emitted as `null`.

### (d) Cost must be measured on a SIX-wave composition, off the vsync floor

No six-wave measurement exists. T020's was five. The promotion must measure frame
time and heap off the vsync floor with a measured control rather than a command-line
claim, name GPU texture memory over exactly the shipped assets, and derive residency
from its own shipped asset count against both caps.

### (e) The narrow wave-scale volume margin is still unexplained

0.988 at `w04`, 0.9895 here, with 16 refusals. Two waves in a row at more than
ninety-eight hundredths of the tolerance is a pattern, not a coincidence, and no
task has yet explained it. T022 is not required to explain it, but it MAY NOT widen
the tolerance, and if its curated subset's margin is also near the line that fact
must be reported rather than absorbed.

### (f) There is no next wave, so no hypothetical needs moving

The pattern ADR 0036 (f) handed forward is closed. `hypothetical-wave-w06` is
fictional by construction and the registry-completeness test refuses to let it be
registered. T022 must not add a registry row, must not invent a seventh wave, and
must leave the hypothetical exactly where it is.

## What this ADR does not claim

- It does not claim wave `w05` is promotable at any particular size. It measures
  that the reservation does not admit an ordinary cell of it and stops there.
- It does not claim the 76 shipped assets are representative of the wave. They are
  one order-derived cell and they refuse at more than three times the wave rate,
  which is recorded rather than smoothed.
- It does not claim any tile resembles, reproduces or reports on a real building's
  facade. The tiles are generated from named constants and the release validator
  re-rasterizes them.
- It does not claim a six-wave composition is affordable. Nothing here measured one.
- It does not claim that completing the ledger's coverage grants any permission
  that no single wave's instrument carries.
- It does not claim the narrow volume margin is understood.

---

# T022 — PROMOTION of wave `w05` (amendment, 2026-08-12)

Wave `w05` is promoted as `manhattan-northern-manhattan-cells-20260812-p1`, the
SIXTH and last default exterior record. Everything above stays as written: it
describes the canary, and the canary is unchanged, byte-frozen and still opt-in
only. This section records what the promotion decided, what it measured, and what
it does not claim.

## The curation, and the enumeration behind it

The promoted renderable subset is ONE ownership cell — 727, a roughly 231 by
152 metre block band in central Harlem whose bounds cover the West 125th Street
corridor between approximately Frederick Douglass Boulevard and Adam Clayton
Powell Jr. Boulevard. It owns 24 buildings; all 24 materialize; none is refused.

The decision rule is wave `w04`'s, applied unchanged and stated in the order it
was applied:

1. **Edge-contiguity**, a PRECONDITION.
2. **Fit the 36-entry inherited reservation**, a PRECONDITION.
3. **Maximize skyline value** — owned buildings whose SOURCED height reaches 90 m.
4. **Tie-break: more whole cells.** NEVER REACHED here.
5. **Lexicographic fallback on the parent-order sequence.** Never reached at the
   stated threshold.

`northern-manhattan-curation-optimum.test.ts` re-runs the whole rule over the
committed ledger and the committed 182-cell skyline census on every test run. It
enumerates every connected admissible subset by expansion with no size bound,
computes the connectivity-ignoring optimum exactly, and pins each rejected
alternative by name, score, owned count, connectedness and budget fit.

### What each precondition costs, measured separately

Wave `w04` recorded contiguity as its expensive precondition. **On this wave
contiguity costs NOTHING on score.** Dropping key 1 and applying keys 3 to 5
unchanged selects `{711, 727, 836, 838, 850}` — the same score of 1, on 35 of the
36 reserved entries, in FIVE separate pieces scattered from central Harlem to
Washington Heights. Contiguity gave up four skyline buildings for `w04` and two
for `w03`; here it gives up none and decides only the shape.

**THE RESERVATION IS WHAT COSTS.** The wave's best skyline cell is 778, which
carries FIVE owned buildings at 90 m or more — every one of them at 102.4 m — and
is refused for one reason: it owns 79 buildings against a 36-entry reservation. So
the reservation gives up FOUR skyline buildings, and that is stated at full
strength rather than folded into a general remark about small subsets.

The canary's own cell 701 is inadmissible TWICE OVER — precondition (b) forbids
inheriting it, and it owns 86 against a 36-entry reservation — and is recorded
with both reasons so neither constraint's cost is overstated.

### The 90 m threshold: the answer is WEAKER than `w04`'s and is not borrowed

ADR 0036 precondition (b) made each wave state whether 90 m is right for it. Wave
`w04` could answer that the ranking did not depend on the threshold at all. **That
answer is not available here and was not taken.**

- The threshold still discriminates, thinly: 19 of this wave's 10,214 sourced
  heights reach 90 m — 0.19%, against 1.20% for `w04` — across 9 of 182 cells and
  exactly ONE of the 50 cells that fit the reservation. Northern Manhattan is
  genuinely lower-rise; its tallest sourced structure is 123.1 m against `w04`'s
  219.2 m in a single admissible cell.
- **The ranking DOES depend on it**, and every other answer is named and pinned:
  `{714, 715}` at 30 m, `{852}` at 45 m, `{707}` at 60 and 75 m, `{727}` at 90 and
  100 m, and nothing at all at 120 m.
- **The threshold was NOT moved after the answer was known.** Choosing a threshold
  because of which cell it selects is the same defect as moving a tolerance to
  pass a gate, and it would be harder to see. 90 m is carried forward unchanged
  and the sensitivity is disclosed instead.
- **A threshold-free key agrees.** Cell 727 also carries the tallest sourced
  structure of any cell that fits the reservation — 101.5 m against 79.8 m for the
  next — so the selection is the maximum on a second criterion with no threshold
  in it. That is corroboration, not the rule.
- **Key 5 is reached at two of the seven thresholds**, which `w04` could say of
  none: a genuine two-way tie between cells 707 and 782 at 60 m, and nothing
  scoring at 120 m. Both are recorded rather than omitted. At the stated 90 m,
  key 3 alone leaves one candidate, so neither key 4 nor key 5 decides this
  promotion.

## The reservation: consumed, and recorded as consumed

Precondition (a) said the 36-entry reservation is the budget and that it binds.
This promotion **opens no split; it consumes one.**

- Both halves of T020's split are READ BACK out of that release's committed
  `payload-inventory.json` and required to reconstitute the 78-entry headroom they
  were split out of. A predecessor re-emitted with a different share, a different
  headroom, or a reservation edited on its own fails this build rather than
  quietly re-sizing this promotion.
- The derivation additionally refuses a reservation that disagrees with the 36 this
  curation was enumerated against, one read from a release that did not make it,
  one that no longer fits what is free, and a build in which this is not the last
  unpromoted wave.
- **The entry budget applied is 36, the subset ships 24, and 12 entries are left
  unspent.** That is not an oversight: cell 727's four edge-neighbours own 40, 41,
  53 and 89 buildings — proven from the committed ledger in the promotion-record
  suite, not merely asserted — so no second cell fits inside the reservation, and
  the only way to spend the remainder is a second, non-adjacent island that key 1
  refuses.
- **The 2-entry surplus is named and NOT taken.** 38 entries are free against 36
  promised. It would have bought nothing in any case, and that is measured rather
  than assumed: the four cells owning 37 or 38 buildings (753, 768, 795, 803) carry
  zero buildings at the stated threshold, so a 38-entry budget selects the same
  cell.

### The ledger-wide occupancy END STATE

The six promoted waves occupy **28 + 156 + 71 + 179 + 40 + 24 = 498 of 512**
exterior cache entries, leaving **14 entries** of headroom and **no unpromoted
wave to reserve them for**. The cache cap is UNCHANGED at 512 entries and 256 MiB;
`EXTERIOR_RUNTIME_BUDGETS` is not edited by this promotion. Every figure is a count
of shipped GLB artifacts on disk, on the accounting T020 adopted when it considered
and rejected ADR 0034's response 3.

The byte ceiling re-derived at six waves: 121.81 MiB of 256 MiB, still
entry-bound, heaviest per-asset wave unchanged. Wave `w05`'s curated subset is the
LIGHTEST per asset of the four textured waves — 175,823 B mean against `w04`'s
359,234 B — because central Harlem's stock is smaller-footprint and lower.

**The sixth-wave cache guard fired as designed.** Adding the record made
`exterior-cache-ceiling.test.ts` fail to load with "promoted release
manhattan-northern-manhattan-cells-20260812-p1 has no measured byte profile"
before its byte-profile row existed. It is recorded a second time rather than
assumed to still work, because a guard that fires once and is then quietly
satisfied is indistinguishable from one that stopped firing.

## The refusal rate and the volume margin

**Local refusal: 0 of 24 = 0%**, against the 3.72% wave rate — the OPPOSITE
direction from `w04`, whose curated ground refused more than its wave did. It is
not presented as an achievement: 24 buildings is a small sample and this wave
refuses 381 of 10,230 elsewhere. The record carries the granularity so the pass is
not read as comfort: at 24 buildings one refusal would be 4.17% and would still
pass the twice-the-wave-rate ceiling; **two would be 8.33% and would fail it.**

**Volume-identity margin (precondition (c)): 0.1818 of tolerance**, on 24 checked
and 0 rejected, against the WAVE's 0.9895 — the narrowest the identity has ever
passed. The denominator is the T021 F1 form, accepted + rejected, applied at the
curated site so it could not inherit the wrong one.

**The corroboration.** A margin measured by the implementation that produced the
geometry is the writer grading its own arithmetic, so the shipped bytes were
re-imported into Blender and the identity recomputed by an independent
implementation. It lands on the same order of magnitude — worst 1.6285e-07 against
the writer's 1.8182e-07 — and picks out the SAME TWO worst buildings,
`doitt:514180` and `doitt:365535`. It does **not** agree on their order, and that
is stated rather than smoothed: the writer ranks 514180 worst and Blender ranks
365535 worst, by a margin far below either measurement's own noise floor. Claiming
agreement on the ranking would be claiming precision neither has.

Precondition (e) — the wave-scale 0.9895 margin and the 16 buildings that fell the
other side of it — is **NOT closed by this promotion and is not claimed to be.**
The curated subset simply does not contain any of the narrow cases. The
explanation is still owed.

## The six-wave acceptance measurement (precondition (d))

Measured in the production preview build by the shipping CesiumJS renderer, with
Chrome's vsync and frame-rate limit disabled, at the UNCHANGED 512-entry cap.
Three repeats, 240 timed frames after 180 settle frames, 1280x800.

A second Chrome without the uncapping flags read a capped-control p50 of
**8.30 ms** — a 120 Hz present interval — and every uncapped station sits at 0.27
to 0.43 of it, which is what makes these headroom readings rather than floor
readings.

| Station | Profile | p50 | p95 | Budget p50/p95 | Worst frame |
| --- | --- | --- | --- | --- | --- |
| `harlem-125th-facade` | inspection | 3.60 ms | 11.80 ms | 33.3 / 45 | 41.2 ms |
| `harlem-125th-skyline` | exploration | 3.40 ms | 10.60 ms | 16.7 / 25 | 40.5 ms |
| `sixwave-wide` | exploration | 2.20 ms | 5.30 ms | 16.7 / 25 | 119.4 ms |
| `centralpark-west-facade` | inspection | 3.50 ms | 12.40 ms | 33.3 / 45 | 65.5 ms |

Every station is inside both budgets on p50 and p95. **The isolated slow frames
are STATED, not smoothed.** The 119.4 ms frame at `sixwave-wide` is the largest any
promotion has recorded; it is a single frame in a window whose p95 is 5.30 ms, and
it occurs at the station that brings the most simultaneously-visible geometry into
one frustum. It is reported because a p95 inside budget and a 119 ms frame are both
true and a reader deciding whether this composition is smooth needs both.

`centralpark-west-facade` is the T020 station kept POSE-FOR-POSE, so the sixth
wave's cost to the fifth is a comparison rather than an assertion.

**Residency**: worst observed **484 entries and 122.16 MiB** against 512 and
256 MiB. It is DERIVED from the network, per release, because the in-app cache
counter only reaches the DOM in a probe build — and at six waves it is derived
from DISTINCT ARTIFACTS rather than from responses, because a session this close
to the cap can evict and re-fetch an artifact, which would otherwise inflate
occupancy. Both numbers ship per run so the gap is visible.

**GPU texture memory: 5.99 MiB, COMPUTED and never presented as measured** — 72
embedded images at 128x128, four bytes per texel, 1.33 mip factor, not
deduplicated across models. No instrument reachable from this session reports
texture VRAM.

Heap after forced GC: 216–241 MiB across stations. **Zero external hosts** in every
capture.

## Journeys, all five passed

- **cold-default** — a clean load streams all SIX waves, and every wave's delivered
  count is NAMED rather than summarised: 14 / 110 / 71 / 154 / 40 / 24 distinct
  artifacts. The curated `w05` cell delivers all 24 of its assets; the T021 canary
  delivers zero, because it is not promoted; zero external hosts.
- **cross-wave-pick** — the curated cell's tallest building, `doitt:342401` at a
  sourced 101.5 m, names its release, cell and cell release, the checksum of the
  exact asset on screen, its truth tiers, source dates and uncertainty across
  SEVEN detail rows.
- **canary-opt-in** — the T021 canary's `?exteriorCells=` link still resolves to
  the canary ALONE at 76 assets, from a camera derived from that cell's own
  committed bounds, with every promoted wave at zero.
- **streaming-off** — `exteriorStreaming=off` disables all six, fetches no exterior
  GLB, and its still DIFFERS from the promoted default's at the identical pose,
  which is the only evidence here that the tiles are drawn rather than downloaded.
- **tombstone-truth** — the notice reads "181 of 182 exterior cells ship no
  exterior geometry in this release; no substitute was selected for them."

**The Blender pass re-imported ALL 24 shipped assets**, not a sample: the curated
cell owns 24 and the grammar refused none, so the deterministic strata select every
one and this is a census. Triangle delta 0, material mismatches 0, bounds deviation
0.0 m against a 13.097 m Z-up control hypothesis, non-solid 0, 72 embedded images
with 0 unreachable and a minimum of one UV layer.

## Rollback semantics

The predecessor is the DISABLED base-only record, on the `w02`, `w03` and `w04`
precedent: wave `w05` has never been promoted in any form, so **rolling it back
returns its area to base massing.** The rollback refuses the successor's link BY
NAME, leaves the T021 canary's opt-in honoured — that release was never promoted,
so its link is not a promotion-era bookmark — and leaves the other five waves
streaming. It is rehearsed through the record's own injection seam in
`exterior-multiwave-activation.test.ts`, because no URL expresses a build-time
record swap.

It is the one rollback in this build that also **un-completes the ledger's promoted
coverage**, and the mechanics are unchanged by that: five of six waves keep
streaming, exactly one statement names exactly this wave, and the swap is still a
single record.

## Goal-level completion, and exactly what remains bounded

**With this record every wave the committed exterior ledger declares has promoted
default coverage — six of six.** No wave is left with no default at all. That is
the whole of the claim.

**What it is NOT.** It is completeness of COVERAGE, not of the city, and the
arithmetic is asserted rather than described: the six promoted waves ship 498
assets against a pinned base of **45,194** canonical buildings, so roughly one
building in ninety is textured by default. What remains bounded, and by what:

- **Per-wave renderable subsets are bounded by the 512-entry cache contract.**
  Every promoted wave ships a curated or order-derived subset of its own partition,
  and the sum of those subsets is 498 of 512. Breadth inside a wave cannot grow
  without either raising the cap or evicting another wave's ground.
- **ADR 0024's cell scheduling is the structural follow-up** that would change
  that. It is what makes breadth a function of what the camera can see rather than
  of a fixed all-resident budget, and until it exists "promote more of a wave" and
  "raise the cache cap" are the same decision.
- **The narrow wave-scale volume margin (precondition (e)) is still unexplained.**
  Completing coverage does not close it.

No gate was relaxed because this is the last wave.

## What this amendment does not claim

- It does not claim Manhattan is textured. 498 of 45,194 buildings carry generated
  exterior detail by default.
- It does not claim the promoted subset is representative of wave `w05`. It is one
  cell of 182, chosen on a stated rule, and its 0% refusal rate is not the wave's
  3.72%.
- It does not claim the 90 m threshold is the right one for this wave. It claims
  the threshold was carried forward unchanged, that the ranking depends on it, and
  that a threshold-free key selects the same cell.
- It does not claim any tile resembles, reproduces or reports on a real building's
  facade.
- It does not claim the narrow wave-scale volume margin is understood.
- It does not claim that completing the ledger's coverage grants any permission no
  single wave's instrument carries. The verbs, the source and the audience are
  unchanged, and public internet deployment stays excluded.
