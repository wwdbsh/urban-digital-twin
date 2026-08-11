# ADR 0036: The Central-and-upper-Manhattan wave, and the headroom that is not one wave's to spend

- Status: Accepted
- Date: 2026-08-12
- Task: T019 (Issue #20)
- Release: `manhattan-central-upper-manhattan-cells-20260812` (CANARY, opt-in only)
- Supersedes nothing. Extends ADR 0029, 0031, 0032, 0034, 0035.
- Promotion of this wave is **not** decided here. See *Preconditions on T020*.

## Why a new ADR rather than another section of ADR 0035

ADR 0035 is a closed record of wave `w03`: its canary, the cache ceiling that
blocked its promotion, the response taken, and the curated successor that
discharged it. Wave `w04` is a different partition with a different answer to
almost every question that ADR asked, and the one place where the two waves
genuinely differ — what the promoted headroom now means — cannot be written as a
footnote to a document whose whole thesis was that the headroom was one entry.

## Context

The committed wave ledger `manhattan-exterior-wave-ledger-20260804` partitions
the pinned `manhattan-citywide-20260804` base into six waves. Four are promoted:
Block 835 (`w00`), Midtown-core (`w01`), the Lower-Manhattan P1 successor
(`w02`), and the Southern-remainder P1 successor (`w03`).

This task materializes `w04`, `central-upper-manhattan`: **249 ownership cells
and 11,721 canonical buildings.** It is the LARGEST wave of the six on both axes
— more cells than `w03`'s 176 and more buildings than its 9,603 — and
`central-upper-manhattan-package.test.ts` asserts that against the committed
digest rather than leaving "largest" as a claim in prose.

Nothing here promotes it. It is reachable only by an explicit
`?exteriorCells=manhattan-central-upper-manhattan-cells-20260812` deep link
against a build that pins the id.

## Decision 1 — the wave-generic machinery is reused, and the registry is extended

`exterior-wave-subset.ts` derives the subset ledger for every wave.
`central-upper-manhattan-package.ts` supplies only what is this wave's own: its
release id, its declared shape, its two hash domains under the `udt.<wave-slug>.*`
scheme the ledger's own `waveId` gives, and the set of predecessor waves it must
be proven disjoint from.

Its row was added to `EXTERIOR_WAVE_DOMAIN_REGISTRY`, and the row was checked the
only way that means anything — by watching the tests that cover it FAIL with the
row removed:

| Test | Failure with the row removed |
| --- | --- |
| `agrees with what the four live wave modules declare` | `expected undefined to be defined` |
| `refuses borrowing from the central-upper-manhattan wave, naming central-upper-manhattan` | `expected [Function] to throw error matching /borrows hash domain "udt\.central-up…/ but got 'Wave northern-manhattan is not in the…'` |
| `refuses a registered wave that arrives with different domains` | `expected [Function] to throw error matching /differ from its registered ones/ but got 'Wave central-upper-manhattan is not i…'` |

Before the row existed, both of this wave's domain strings were unowned and a
fifth wave could have taken either one silently.

### One test changed rather than only grew

`exterior-wave-subset.test.ts` carries a hypothetical — "a further wave written
by copying the wave above it" — whose entire job is to be UNREGISTERED, so that a
borrowed domain is the only thing wrong with it. That hypothetical was named
`w04`. A hypothetical naming a now-registered wave stops testing what it says:
the registry would have two reasons to refuse it, and which error surfaced would
depend on row order rather than on the defect.

It is repointed to `w05` (`northern-manhattan`), which has no row. Its declared
shape moved with it — 182 cells and 10,230 buildings, `w05`'s real numbers from
the same committed digest. Carrying `w04`'s counts forward would have been a
second copy-paste defect sitting inside the test for copy-paste defects.

### The excluded set widened to all four promoted waves

`w03` excluded waves 0, 1 and 2 because those were the three promoted when it was
derived. `w03` has since been promoted through its `-p1` successor, so `w04`
excludes 0, 1, 2 and 3. The App holds ONE exterior cache across every promoted
wave, so a building owned twice would be an ownership contradiction and a
cache-identity hazard at once. Zero overlap across all 452 excluded parent cells
is recorded in `derivation.json`.

Wave `w05` is deliberately NOT in the exclusion list, and the package suite says
why in a test rather than by omission: `w05` has never been promoted, owns no
shipped byte and occupies no cache entry. Its disjointness from `w04` is a
property of the parent partition, and it is asserted directly.

## Decision 2 — the kill switch is INHERITED, and the inheritance is stated

There is no `probe` stage. The kill switch asked one question — are procedural
detail tiles affordable in the shipping renderer at all — and it has now been
answered three times on this exact catalogue, sampler filter and LOD placement:
T015 PASS on the `w02` canary, T016 re-measured off the vsync floor, T018
re-measured a four-wave composition at the raised cache cap.

Wave `w04` changes which buildings carry the tiles, not the tiles. Re-running the
switch would measure the same catalogue a fourth time while pretending to decide
something. **This is an INHERITANCE and this ADR says so rather than implying a
measurement was taken.** The committed record pins the catalogue those readings
were taken against — `procedural-texture-v1`, rasterizer `1.0.0`, parameters hash
`121fb53e…` — so a catalogue change breaks the pin rather than silently
invalidating the inheritance.

## Decision 3 — the headroom is real, and it is not this wave's to spend

This is where `w04` and `w03` genuinely differ, and the difference is easy to
misreport in either direction.

Wave `w03`'s canary had to state that three promoted waves occupied 255 of 256
cache entries, so no subset anyone would promote could fit. T018 cleared that by
taking ADR 0034's admissible response 1 — `maxCacheEntries` is 512 — and then
promoted `w03`'s curated successor into it. Four waves are promoted now:

    512 - 28 (Block 835) - 156 (Midtown-core) - 71 (Lower-Manhattan P1)
        - 179 (Southern-remainder P1) = 78 entries

**78 entries is a real headroom, and this wave's median cell owns 48.** So
`admitsMedianCellAlongsidePromoted` is `true` here where it was `false` for `w03`.
That is the honest reading and it is deliberately not the end of the statement.

**Two waves remain unpromoted, and they share one headroom.** `w04`'s median cell
owns 48; `w05`'s owns 55. They sum to 103. The 78-entry headroom admits an
ordinary cell of EITHER wave and not one of each:

```
alongsidePromotedHeadroom                          78
remainingUnpromotedWaves      w04 (249 cells, median 48)
                              w05 (182 cells, median 55)
medianCellsOfAllRemainingWaves                    103
headroomAdmitsMedianCellOfEveryRemainingWaveTogether  false
```

Both booleans ship in the release's own `payload-inventory.json`. Recording only
the first would read as a promotion clearance for this wave; recording only the
second would read as a blocker. Neither is true on its own.

**So the decision T020 faces is a SPLIT decision, not a fit-check, and this
release names it without making it.** Three responses are admissible and none is
chosen here, because choosing would be deciding a promotion inside a canary with
none of promotion's evidence:

1. **T020 takes the headroom for `w04` and T022 gets nothing** without a further
   cap change. Cheapest to execute, and it silently decides `w05`'s fate.
2. **The two waves split 78 at sub-median scale** — roughly 39 entries each, which
   is below a median cell of either wave, so both promotions would ship
   deliberately small curated sets and both would have to say so.
3. **The cap moves again.** ADR 0035 already argued this one should be justified
   hardest: at 1024 entries the modelled mean fill is 566 MiB against an unchanged
   256 MiB byte cap, so bytes would plausibly become binding and the cache would
   start evicting inside the entry budget.

### The occupancy list is a list now, not four named fields

The three earlier waves' budget records carried one field per promoted wave
(`block835AssetEntries`, `midtownAssetEntries`, …), growing by a field and a
parameter at every promotion. This release records `promotedWaves` as an
enumerated list of `{ releaseId, assetEntries }` plus `promotedWaveCount`.

**This is a deliberate departure from the verbatim T017 shape.** It states the
same thing, is still fully named — each row carries the release id it was counted
from — and cannot silently omit a wave, because the row count is committed beside
the sum and `central-upper-manhattan-release.test.ts` asserts all four rows
against those waves' own committed records. The derivation refuses an empty list,
a duplicated release id, and a wave declaring zero assets.

### 78 shipped buildings and 78 free entries are a coincidence

The renderable cells own 78 buildings (25 + 51 + 2) and the promoted headroom is
78 entries (512 − 434). **These are the same number and not the same quantity.**
One is three whole cells under an 80-entry self-imposed ceiling fixed before the
promoted set was counted; the other is cache arithmetic. A test pins both so
nobody later reads the canary as having been sized to the promotion headroom.

### What 434 does and does not mean

The occupancy derivation counts every shipped GLB ARTIFACT, both LODs included,
because the runtime cache is keyed per artifact and a resident coarse level
occupies an entry exactly as a fine one does. It is an upper bound on residency,
not a measurement of it. The `promoted-default-unchanged` journey fetched 14
Block 835 GLBs, not 28, because a session fetches only the levels its pose needs.
Both numbers are true and this ADR states the difference rather than letting 434
read as "always resident".

## Decision 4 — the subset is ORDER-DERIVED, and curation is left to promotion

The renderable subset is the ledger-order walk under the entry budget, admitting
whole cells only — a cell loads atomically, so a partially renderable cell could
never finish loading. Three cells fit and the fourth (50 buildings) does not:

| Cell | Owned | Cumulative |
| --- | --- | --- |
| `…-w04-000452-17-38598-35840` | 25 | 25 |
| `…-w04-000453-17-38599-35840` | 51 | 76 |
| `…-w04-000454-16-19298-17920` | 2 | 78 |
| `…-w04-000455-17-38598-35841` | 50 | *does not fit* |

**78 owned, 75 materialized, 3 refused, 2 spare entries under an 80-entry
ceiling.** The other 246 cells ship as truthful tombstones.

A canary's subset MAY be order-derived because it is proving the wave
materializes at all. Choosing cells for what they look like is a curation
decision that belongs to promotion, where it can be recorded and defended as one
— which is exactly what T018 did for `w03` on a stated skyline basis.

### The ceiling is 80, carried forward rather than re-derived

`CENTRAL_UPPER_MANHATTAN_MODEST_SUBSET_CEILING = 80`, unchanged from the `w03`
canary. It is a judgement and is recorded as one. Two reasons to keep it fixed:

- two canaries of adjacent waves then cost the same, so anything that differs
  between them is about the WAVES rather than about how much cache each was
  allowed to take;
- **it is deliberately not re-scaled to the raised cap.** T018 doubled the cache
  to make a fourth PROMOTION representable. Spending part of that raise on a
  canary would quietly consume a decision taken for a different purpose. At 512
  entries this ceiling is under a sixth of the cache rather than the under-a-third
  it was at 256, which makes this canary cheaper in relative terms than its
  predecessor — stated here rather than presented as a fresh derivation.

## Decision 5 — the rights instrument is NEW, and says it rests on no fresh signature

A new approval scope is authored. No frozen approval text is edited. The
Midtown-core scope excludes "runtime textures of any kind", which stays true of
that release; the Lower-Manhattan and Southern-remainder scopes admit tiles but
each names its own wave's partition in its operative first sentence. An instrument
that enumerates another wave's partition cannot describe this one.

The instrument carries the established shape:

- geometry: local delivery, display, derivative conveyance AND redistribution,
  under the 2026-08-11 broadening of the NYC OTI envelope;
- tiles: **local application display and derivative conveyance ONLY, expressly
  not redistribution**, because no recorded item broadened anything to permit
  redistributing generated tiles;
- exclusions identical to the predecessor wave's, asserted equal by test, so it
  grants nothing that wave lacked;
- the honesty clause: **THIS INSTRUMENT RESTS ON NO FRESH SIGNATURE.** Nobody was
  asked to approve wave `w04` and nobody did. Its authority is the same two
  recorded items — the user's texture direction of 2026-08-11 and the recorded
  standing autonomy directive.

Fingerprint `81ba0879fbc956c912db7548ff7650a3364fd0bf1ab117a7926cf75d0714df5e`,
pinned by test.

### One clause the earlier instruments did not need

This is the largest partition any instrument has covered, and "largest" is exactly
the word that invites a reader to think the envelope grew with it. The note says
otherwise in its own text:

> THAT THIS IS THE LARGEST WAVE BROADENS NOTHING: an envelope is a set of verbs
> over a set of sources, and covering more buildings of the same pinned source
> under the same verbs is not a wider envelope.

## Decision 6 — the wave census is untextured, and that is a true statement

The census runs over all 11,721 owned buildings and answers a question about
GEOMETRY. Tiles are a writer-stage concern that touches no plan field, so
`CENTRAL_UPPER_MANHATTAN_CENSUS_PROFILE` shares this wave's seed, tool, release id
and generated instant with the shipped profile — every plan hash is identical
between the two passes, asserted by test. Rasterizing tiles for eleven thousand
buildings whose bytes are then discarded would buy nothing but hours.

## The refusal census, reported rather than tuned

**11,543 materialized, 178 refused = 1.52%, against a 15% STOP that was not
approached and no tolerance moved.**

| Stop code | Count |
| --- | --- |
| `source-height-below-grammar-minimum` | 77 |
| `ring-vertex-count-unsupported` | 64 |
| `ring-area-below-floor` | 25 |
| `ring-neck-below-grammar-minimum` | 10 |
| `ring-not-simple` | 2 |

Every refused building ships as an explicit unavailable detail with a stated
deterministic reason. No geometry was invented and no substitute selected.

**5,374 materialized buildings ship `setbacks` absent** — 46.6% of them — because
their massing collapses to one effective tier. That is nearly half the wave and is
recorded as a first-class count rather than a footnote.

### The two refusal distributions are EQUAL here, and the previous wave's explanation is retracted

ADR 0035's census note said, of `w03`:

> a plan-stage total that equalled the asset-stage total would mean the writer's
> identity check had never run.

**That sentence is false of this wave and is not carried over.** For `w04` the
plan-stage and asset-stage distributions are identical: the writer's
mesh-versus-analytic volume identity check ran on all 11,543 materialized
buildings and rejected none. `w03` happened to contain 11 buildings it rejected;
`w04` contains zero.

Equal totals cannot show that on their own — a check that never executed produces
exactly the same two numbers. So the census records the check as a MEASUREMENT:

```json
"volumeIdentity": {
  "buildingsChecked": 11543,
  "buildingsRejected": 0,
  "worstVolumeDeviation": 9.882970279185346e-7,
  "tolerance": 0.000001,
  "worstDeviationAsFractionOfTolerance": 0.9882970279185347
}
```

### The margin is narrow, and that is the finding

**The worst volume deviation across the wave sits at 0.988 of the tolerance.** The
check passed; it did not pass comfortably. "Zero rejections" and "ample headroom"
are different statements and only the first is true here.

`central-upper-manhattan-census.test.ts` bounds the fraction from BELOW as well as
above, so a future change that quietly widened the tolerance — making the margin
look comfortable — fails rather than passes. The Blender pass then recomputes the
identity from an INDEPENDENTLY imported mesh, so a narrow margin produced by a
systematic writer error would show as a disagreement instead of being confirmed by
the thing that caused it. It did not: the worst INDEPENDENT deviation over the 67
sampled assets is 6.635e-07, against the writer's own worst of 6.716e-07 over all
75 shipped assets. The two figures are over different sets — 67 sampled versus 75
shipped — so they are consistent rather than equal, and neither is over the whole
wave. **No independent check covers all 11,543 buildings**; the 0.988 figure is
the writer's own arithmetic and the Blender pass corroborates it only on the
sample.

### The shipped subset refuses at a higher rate than the wave

3 of 78 (3.85%) against 178 of 11,721 (1.52%). An order-derived subset has no
reason to be representative, and reporting only the wave rate would let a reader
assume it was. The census test asserts the inequality rather than smoothing it.

## Consequences

- `PINNED_EXTERIOR_CELL_RELEASE_IDS` gains one entry. `EXTERIOR_DEFAULT_ACTIVATIONS`
  is untouched, asserted by test, and the `promoted-default-unchanged` journey
  measures it in a browser: zero GLBs and zero bytes of this release on a clean
  load.
- `EXTERIOR_RUNTIME_BUDGETS` is NOT changed. Raising the cap again is the promotion
  decision this canary exists to inform.
- This release is the first wave canary whose renderable cells are PARTIALLY
  packaged (75 of 78 owned), so it exercises the refined `assemblyCellCoverage`
  subset rule rather than the equality it replaced. The graph stage's
  `replayMultiLodAssembly` gate proves it on the emitted bytes.
- Untracked payload, committed inventory. Re-emitting is byte-identical: a
  `graph --force` re-run reproduced `payload-inventory.json` byte for byte.

## Preconditions on T020 (promotion)

Named here so they cannot be inherited by silence.

### (a) The 78-entry split must be DECIDED and recorded by number

The three admissible responses are enumerated in Decision 3. T020 must take one,
say which by number, and state what it costs `w05`. **A promotion that quietly
consumes the whole headroom without naming response 1 has decided `w05`'s fate
without recording that it did.** If the cap is raised instead, the byte ceiling
must be re-derived at the new cap in CODE, as `exterior-cache-ceiling.ts` does
today, because at 1024 entries the modelled mean fill exceeds the unchanged byte
cap.

### (b) The promoted subset must be an explicit CURATED list

ADR 0035 precondition (b) forbade promoting the T017 canary's order-derived
subset, and the same holds here. A release is immutable, so the promoted bytes are
a successor (`-p1`), emitted through the `RELEASE_VARIANTS` seam this pipeline
carries forward unused. The curation must:

- be an explicit list of cell ids with a stated basis, not an order walk;
- have its optimality claim RE-ENUMERABLE from committed bytes on every test run,
  as `southern-remainder-curation-optimum.test.ts` does over a committed skyline
  census — not a number written into a document;
- reach the committed inventory only through a fresh `gates` receipt, or its
  refusal census is emitted as `null`. The fail-closed edge is already in this
  pipeline's `graph` stage and is inert for the canary;
- be covered by `renderableCellDigestSha256` in the stage fingerprint, or editing
  the curated list to a different set of the same length leaves every stage
  `skipped: true` on the previous curation's bytes.

**The skyline threshold of 90 m is `w03`'s judgement, not a discovery.** If T020
ranks on skyline value it must state whether 90 m is right for a wave whose cells
sit north of Midtown, rather than reusing the constant because it exists.

### (c) The local refusal rate must be recomputed, not inherited

This canary's order-derived subset refuses 3.85% locally against a 1.52% wave
rate. A curated subset will have its own rate, it must be computed from that run's
own shipped census, and no tolerance may be moved to improve it.

### (d) Cost must be measured OFF the vsync floor, with GPU memory named

A FIVE-wave composition has never been measured. T018's readings are for four
waves at 420 worst-observed residency against a budgeted 434; a fifth wave changes
both terms. The capped control must be captured in a second browser so the
readings are provably headroom rather than floor, GPU texture memory must be
labelled COMPUTED if it is computed, and isolated slow frames must be stated, not
smoothed.

### (e) Rollback semantics must be stated

`w03`'s successor pinned the disabled base-only record, so a rollback returns the
area to base massing and refuses the successor's link by name while leaving the
canary's opt-in alone. `w04` has never been promoted in any form, so the same
precedent applies and must be recorded rather than assumed.

## What this ADR does not claim

- **No frame-time, heap, GPU or residency measurement was taken for this wave.**
  Those are promotion's instrument and this release is not promoted.
- **No fault-isolation or rollback rehearsal.** The fault injector is behind a
  `VITE_BLOCK835_PROBE=1` build, which is not the production preview.
- **No visual claim about the two renderable cells the camera does not stand in.**
  They ship and are streamed by the opt-in journey's asset count; no still is taken
  from inside them.
- **No facade-fidelity claim of any kind.** The tiles are designed motifs. They
  reproduce, resemble and report on nothing real, and the instrument excludes any
  claim that they do.
