# ADR 0035: The Southern-remainder wave, and the cache ceiling that now binds

- Status: Accepted
- Date: 2026-08-12
- Task: T017 (Issue #18)
- Supersedes: nothing
- Related: ADR 0024 (wave ledger), ADR 0029 (Midtown-core wave), ADR 0031 (V3
  grammar), ADR 0032 (procedural facade textures), ADR 0034 (Lower-Manhattan
  wave and the first textured release)

## Why a new ADR rather than another section of ADR 0034

The wave-chain ADRs follow one shape: **one ADR per wave, opened by the wave's
canary and extended in place by the wave's promotion.** ADR 0029 is wave `w01`,
ADR 0034 is wave `w02` and carries T016's promotion decision under a second
heading. This document is wave `w03` and follows that shape: T018 extends it
rather than opening a fourth.

Extending 0034 instead would have put two waves' promotion preconditions in one
document, and 0034's preconditions are already discharged. A reader of that
document should find a closed question, not a new open one.

## Context

Wave `w03` (`southern-remainder`) of the committed exterior wave ledger
`manhattan-exterior-wave-ledger-20260804` owns **176 ownership cells and 9,603
canonical buildings** of the pinned `manhattan-citywide-20260804` base. Three
waves are promoted: Block 835 V3, Midtown-core V3, and the Lower-Manhattan P1
successor.

This task materializes `w03` as an opt-in private canary with a public-audience
candidate root, textured, following the machinery ADR 0034 proved. It does not
promote it, and — as Decision 3 records — it could not have.

## Decision 1 — the wave-generic machinery is reused, and the registry is extended

Nothing was copied. `exterior-wave-subset.ts` already parameterizes everything
that differs between waves, and `southern-remainder-package.ts` supplies only
this wave's release id, declared shape, two hash domains and excluded waves.

Its row was added to the **closed-table domain registry**, under the
`udt.<wave-slug>.*` scheme the ledger's own `waveId` supplies:

```
udt.southern-remainder.subset-ledger-id.v1
udt.southern-remainder.subset-base-identity.v1
```

The registry is a closed table rather than an import-time registry precisely so
that a wave written in isolation is still checked, and the row was added the way
that guard is meant to be exercised: **the three registry tests that now cover it
were written first and were watched to fail** with the row removed —
`expected undefined to be defined` for the module-agreement check, and
`expected [Function] to throw an error` for both borrow checks. Before the row
existed, a fourth wave could have taken either of this wave's strings silently.

**Review then found that the guard did not enforce the table it exists for.**
`assertDistinctWaveDomains` refused a borrow, a self-collision and a silent
reassignment, but a wave with **no row at all and perfectly fresh domains
collided with nothing and passed** — so the closed table's completeness was
enforced by whoever remembered to add a row, and by nothing else. That is the
exact case a closed table is chosen over an import-time registry to catch. It now
fails closed, checked **last** so that a module copied from another wave still
reports the borrow, which names the wave to fix rather than merely the missing
row. Pre-fix repro recorded: with the check removed the new test reads
`expected [Function] to throw an error`.

One test file changed rather than only grew. `exterior-wave-subset.test.ts`
carried a hypothetical "third wave written by copying the wave above it", and
that hypothetical was **named `southern-remainder`**. A hypothetical that names a
now-registered wave stops testing what it says it tests: the registry would have
two reasons to refuse it — the borrow, and the reassignment of the wave's own
registered strings — and which error surfaced would depend on the order of the
rows rather than on the defect. The hypothetical was repointed to wave `w04`
(`central-upper-manhattan`), which has no row of its own, so the borrow is again
the only thing wrong with it.

### The excluded set widened to all three promoted waves

Wave `w02` excluded waves 0 and 1, the two promoted when it was derived. This
wave excludes 0, 1 **and** 2 — 276 parent cells, every one of them proven to
share zero buildings with this subset. Wave 2 is excluded by its *parent* cells,
which are exactly the buildings the promoted `-p1` successor owns: that successor
changed which cells retain bytes, never which buildings the wave owns.

## Decision 2 — the kill switch is INHERITED, and the inheritance is stated

There is no `probe` stage in this pipeline. That is a decision, not an omission,
and it is recorded here so that no reader concludes a kill switch was run.

The kill switch asked one question: *are procedural detail tiles affordable in
the shipping renderer at all?* T015 answered it PASS on this exact tile system —
`procedural-texture-v1`, rasterizer `1.0.0`, parameters hash
`121fb53e…438ff`, LINEAR/LINEAR_MIPMAP_LINEAR, tiles on LOD 0 alone — with p50
frame-time ratios of 0.99–1.00 and p95 of 1.01–1.03 against its own untextured
baseline. T016 then re-measured the promoted composition **off the vsync floor**
and read p50 1.5–3.6 ms and p95 3.9–9.7 ms inside both budgets.

Wave `w03` changes **which buildings carry those tiles, not the tiles**. The
catalogue pin in this release's committed inventory is byte-identical to the one
those measurements were taken against, and a test asserts it. Re-running the
switch would have measured the same catalogue a second time while presenting the
result as a fresh decision.

What this inheritance does **not** cover is stated in the same breath: it is a
statement about the tile system's cost, not about this wave's composition under
a promoted default. That measurement is promotion's instrument and belongs to
T018.

## Decision 3 — the entry budget could not be derived the way `w02`'s was, and the arithmetic says so

ADR 0034 Decision 4 sized the Lower-Manhattan subset to fit **alongside** the
promoted waves, so it would not need re-cutting at promotion:

```
256 cache entries - 28 (Block 835 V3) - 156 (Midtown-core V3) = 72
```

That derivation does not survive a third promotion. ADR 0034's own closing
precondition said so, and it is now the operative constraint:

```
256 - 28 - 156 - 71 (Lower-Manhattan P1) = 1 entry
```

**One entry.** The record states precisely what one entry admits rather than
rounding it to "nothing", because rounding would have been false: this wave owns
**two single-building cells**, so two of its 176 cells do fit. Its median cell
owns **50** buildings and its leading cell owns **77**. So the committed field is
named for its criterion — `admitsMedianCellAlongsidePromoted: false` — rather
than being called "admissible", which would have been a lie by a technicality.
Both numbers ship: `cellsFittingAlongsidePromoted: 2` and
`medianCellBuildingCount: 50`.

**This blocks PROMOTION. It does not block a canary**, and the difference is a
browser fact rather than an argument: `?exteriorCells=` **selects** the named
release rather than adding it. Journey `canary-opt-in` measures exactly that —
76 GLBs fetched from this release and **zero** from any promoted wave — so an
opt-in session's cache holds this release alone and the binding ceiling is the
cache itself. That journey additionally requires its still to **differ** from the
promoted default's still at the identical pose, so the assets are shown to be
drawn and not merely fetched.

The cache alone would admit 235 entries of this wave's leading cells, which would
make a "canary" occupying 92% of the runtime cache. So a **second, deliberately
chosen ceiling** applies, and it is recorded as a judgement rather than dressed
up as a derivation:

`SOUTHERN_REMAINDER_MODEST_SUBSET_CEILING = 80`

80 is a little under a third of the cache and is the smallest round ceiling that
admits this wave's leading cell whole. A cell is never split, because a partially
renderable cell could never finish loading. Choosing 72 to echo the
Lower-Manhattan budget would have admitted **nothing** — a fact about this wave's
cell sizes, not about its cost.

`EXTERIOR_RUNTIME_BUDGETS` is **not changed by this release.** Raising the cap is
exactly the promotion decision this canary exists to inform, and making that
change here would be deciding it without the evidence.

### What the subset came out as, and where it departs from the task's estimate

The task anticipated roughly two to three cells within an 80-asset ceiling. The
ledger's leading `w03` cells own **77 and 76** buildings, so any two-cell subset
costs 153 entries — nearly twice that ceiling. The two constraints could not both
hold. The asset ceiling was kept and the cell-count estimate was not, because 80
was the precise number and "~2-3" was the approximate one:

**1 cell, 77 owned, 76 shipped assets, 3 spare entries.** The other 175 cells
ship as truthful tombstones.

This is a *larger* asset subset than the Lower-Manhattan canary's 41, so nothing
about the evidence is thinner for it; what is genuinely weaker is that a
single-cell subset exercises no cell-boundary behaviour, which two promoted
multi-cell waves and the T015 two-cell canary already do.

## Decision 4 — the subset is ORDER-DERIVED, and curation is left to promotion

The renderable cells are a walk of the ledger's declared priority order under the
entry budget, exactly as the T015 canary's were. The walk **stops** at the first
cell that does not fit rather than skipping it: skipping would reorder the wave's
declared visual priority to fill a budget, which is a curation nobody recorded.

A canary's subset may be order-derived because it is proving that the wave
materializes at all. Choosing cells for what they look like is a curation
decision that belongs where it can be recorded and defended as one, which is
promotion.

The seam is nonetheless already built, unused, and that is deliberate. The
pipeline carries the `RELEASE_VARIANTS` table, the optional
`renderableCellDigestSha256` fingerprint component and the fail-closed
gates-receipt rule from the T016 review round, all inert for a variant with no
curation. Both of those exist because their absence was a real defect: a curated
list is a constant in this repository, so editing it moves nothing hashed and
every stage reports `skipped: true` on the previous curation's bytes; and a
curated variant that reaches its committed inventory without a gates receipt
emits its refusal census as `null`, which reads as "not applicable" rather than
"never checked". Adding the seam after the successor exists would repeat both.

The canary's committed inventory carries **no `curation` key at all** rather than
`"curation": null` — the same byte-level care that caught a moved checksum in
T016.

## Decision 5 — the rights instrument is NEW, and says it rests on no fresh signature

Neither live instrument can be borrowed. The Midtown-core V3 scope declares its
release TEXTURE-FREE and excludes "runtime textures of any kind", which stays
true of that release. The Lower-Manhattan instrument does admit tiles, but its
operative first sentence enumerates **wave w02's 126 cells and 6,425 buildings**
— a partition this release does not own. Neither can be read onto wave `w03`
without saying something false about what was approved.

So a new instrument is authored, fingerprint-pinned by test at
`c4ba50b33490e619fa2662e312d796fb82db47c3561a73c65da9f8fef6054ac4`, and no frozen
approval text is edited — a test asserts the Lower-Manhattan fingerprint is still
`ff8da10f…`.

Its operative content is the Lower-Manhattan instrument verbatim-adapted:
geometry may be delivered locally, displayed, conveyed as a derivative and
redistributed; **tiles get local application display and derivative conveyance
ONLY, and their redistribution is excluded outright**; public internet deployment
is excluded; captured or source-derived texture imagery is excluded; and any
claim that a designed tile reports on a real building's facade is excluded. The
exclusion list is asserted by test to be **exactly** the predecessor wave's, so
this instrument grants no permission that wave did not have.

The addition this wave makes is an honesty clause, and it exists because a
per-wave instrument invites a reader to assume a per-wave approval event:

> THIS INSTRUMENT RESTS ON NO FRESH SIGNATURE. No approval was sought or given
> for wave w03 specifically.

Its authority is exactly the two recorded items ADR 0034 named — the user's
recorded texture direction of 2026-08-11, which directed reference-only
calibration with no image data ingested, and the recorded standing autonomy
directive — applied to a further wave of the same configuration. A separate
instrument exists because the operative text enumerates a partition, **not
because new permission was obtained**, and the note says so in those words.

## Decision 6 — the wave census is untextured, and that is a true statement

The census over all 9,603 buildings runs on `SOUTHERN_REMAINDER_CENSUS_PROFILE`,
which shares this wave's release id, seed, tool and generated instant with the
shipped profile and differs only in carrying no tile catalogue. Tiles are a
writer-stage concern that touches no plan field, so **every plan hash is
identical between the two passes** and the census is a true statement about the
buildings that ship. A test pins that field-by-field. Rasterizing tiles for nine
thousand buildings whose bytes are then discarded would buy nothing but hours.

### The wave census failed open, and now does not

Emitting the committed census read its stage receipts with `?? null`, so a
missing or stale receipt would have published `"wave": null` — a census that
reads as "not applicable" rather than "never run" — **twelve lines after** the
curated path had been made to fail closed for exactly that reason. Both paths now
go through one `requireFreshReceipt` helper that refuses a missing receipt AND a
receipt written against different inputs, naming the command that fixes each.
Repro recorded: removing the `glbs` receipt now errors "the glbs stage has not
run … would be emitted as null"; corrupting the `plans` fingerprint errors "was
written against different inputs than this run".

The census note was also extended, because a reader who finds **two refusal
totals** in one file and no explanation will reasonably conclude one is wrong.
`waveRefusals` is the plan stage and `wave.refusalsByCode` is the asset stage;
the second is a superset of the first and the difference is exactly
`volume-identity-failed`. A committed test asserts that relationship key by key,
in both directions, rather than trusting the prose.

## The refusal census, reported rather than tuned

Over all 9,603 owned buildings, untextured, `census-only` retention:

| | count |
|---|---|
| owned | 9,603 |
| resolved from the pinned base shards | 9,603 |
| materialized | 9,507 |
| refused | **96 (1.00%)** |
| materialized with `setbacks` ABSENT and a stated reason | **3,960** |

Stop-code distribution, every refusal named:

| stop code | count | stage |
|---|---|---|
| `source-height-below-grammar-minimum` | 33 | plan |
| `ring-vertex-count-unsupported` | 22 | plan |
| `ring-area-below-floor` | 20 | plan |
| `volume-identity-failed` | **11** | writer |
| `ring-neck-below-grammar-minimum` | 10 | plan |

`volume-identity-failed` appears only in the asset census, never in the plan
census, because it is the writer's own mesh-versus-analytic identity check
failing after a plan was accepted. The plan stage reports 85 refusals and the
asset stage reports 96; that is a stage boundary, not a discrepancy, and both
numbers are committed.

**1.00% against a 15% STOP.** No tolerance was moved to reach it. For comparison
wave `w02` refused 2.09%, so this wave's polygons are, if anything, easier for
the grammar to carry.

The **3,960 absent setbacks** are the honest half of that number. A building whose
massing collapses to a single effective tier ships `setbacks` absent with a stated
reason rather than an invented offset, and every one of the 35 such buildings in
the renderable cell is re-imported in Blender rather than sampled.

## Consequences

- `manhattan-southern-remainder-cells-20260812` is pinned in
  `PINNED_EXTERIOR_CELL_RELEASE_IDS` and **absent from the promotion record**. It
  resolves by explicit `?exteriorCells=` opt-in and by nothing else. Journey
  `promoted-default-unchanged` measures that a clean load fetches **zero** bytes
  of it even with the camera standing inside its renderable cell — a pose derived
  in code from that cell's committed ledger bounds and asserted to lie within
  them before any capture runs.
- Because it is not promoted, `verifyPromotedExteriorPin` does not run for it —
  that check reads the promotion record. Its verification rests on the
  release-graph and checksum validation the emitter and its committed inventory
  carry, which is the same narrower guarantee the T015 canary has and is stated
  as narrower.
- 22.6 MB of payload across 410 files, of which 76 are textured LOD 0 GLBs.
- The payload tree is untracked; `data/southern-remainder-20260812/` carries the
  derivation, the wave census, the checksum inventory, the Blender evidence and
  the journey evidence.

## Preconditions on T018 (promotion)

Three, in the ADR 0034 pattern. They are named here so a promotion cannot inherit
them by silence.

### (a) The cache ceiling must be resolved, and which response was taken recorded

This is the hard one and it is unavoidable: **255 of 256 entries are occupied**,
and the median `w03` cell owns 50. ADR 0034 named three responses. This canary's
groundwork anticipates **response 1 — raise
`EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries`** — and deliberately did not take it,
because the entry cap is a contract the whole exterior runtime is sized against
and raising it is a promotion decision with its own evidence.

Whichever response T018 takes, it must:

- record the response by number and the reasoning;
- if raising the cap, **re-measure the byte ceiling against the raised cap.**
  Byte residency was 62.0 MiB of 256 MiB at T016's worst station, so bytes are
  not near binding — but "not near binding at 255 entries" is not a measurement
  at a larger cap, and this wave's assets are heavier per asset than
  Lower-Manhattan's;
- re-derive occupancy from the four promoted waves' committed inventories, not
  from a remembered number. The pipeline already reads three; adding a fourth is
  a table row.

### (b) The promoted subset must be an explicit CURATED list, near the wave refusal rate

Promotion must NOT inherit this canary's renderable subset. A release is
immutable and its subset is baked into its snapshot, cell releases, assembly
package and every asset checksum, so the promoted release is a **successor**, as
`-p1` was for wave `w02`.

The curated list must be recorded as curation — the `curation` block, the
`renderableCellDigestSha256` fingerprint component and the fail-closed
gates-receipt rule are already built and inert, so this is a table row rather
than a redesign — and its **local refusal rate must be justified against the
1.00% wave rate**, with no tolerance moved to reach it.

The skyline argument is available and unused here on purpose: `w03` covers the
lower West Side and the southern remainder of the island, and the canary's
order-derived cell is simply the wave's first. A curated subset chosen for what
it looks like is exactly what promotion is for.

For calibration, the canary's own single cell refused **1 of 77 = 1.30%**,
already close to the wave rate — so a curated subset that lands far above 1.00%
is a signal about the cells chosen rather than about the grammar.

### (c) Cost must be measured OFF the vsync floor, with GPU memory named

The T016 instrument, unchanged, because this wave is not exempt from it merely
because the tile system is inherited: a promoted `w03` composition is a **fourth**
wave resident at once, which is a composition nobody has measured.

- a second Chrome **without** the uncapping flags must read the present interval,
  so a floor-pinned p50 is recognisable as a floor rather than reported as a
  result;
- p50 and p95 at fixed stations against both budgets, with isolated slow frames
  **stated rather than smoothed**;
- GPU texture memory **NAMED and COMPUTED** (`128*128*4*1.33*N`, not deduplicated
  across models) and never presented as measured;
- cache residency in entries and MiB against whatever cap response (a) settled
  on.

## Three things the evidence got wrong before it got them right

None of these is erased, because each is a failure mode a journey suite is
structurally bad at noticing about itself.

**The camera was outside the cell it claimed to stand inside.** The first version
of this suite typed the pose by hand: latitude `40.73520`, about **81 m SOUTH**
of this cell's committed south bound `40.735931396484375`. The
`promoted-default-unchanged` claim — and an earlier draft of this ADR — said "the
camera standing inside its renderable cell", and it was not. Review caught it.
The pose is now **derived in code from the cell's bounds in the committed
membership digest**, and `assertPoseInsideCell` fails the run before a single
capture if it is not contained on both axes. The assertion and the cell's bounds
are recorded in `capturedWith.poseContainment`, so the claim is checkable rather
than trusted.

**Correcting the pose broke the picture, and the fix for that is also a check.**
The first corrected pose stood at the cell centre, 260 m up, pitched 40° down —
inside the bounds, and looking at rooftops. Three of the four stills came out
**byte-identical**, which meant opting into 76 textured assets changed nothing
visible: facades are vertical, and a top-down view cannot show them. The camera
now stands low in the cell's south-west quadrant looking north-east at a shallow
pitch, and `canary-opt-in` **requires its still to differ from the promoted
default's still at the identical pose** as part of passing. The network count
proves the assets were fetched; only that difference proves they were drawn — at
this pose the promoted default shows flat base massing (`a35064e8…`) and the
opt-in shows textured facades, windows, roof plant and water tanks
(`a72fc3cd…`).

**A stale preview server was measured once, and its "pass" was meaningless.** The
first run reached a `vite preview` left listening on port 4174 by another
worktree, serving a bundle in which this release was not pinned;
`promoted-default-unchanged` passed against it correctly and vacuously, because a
release that is not pinned obviously fetches nothing. That reading was discarded.
An earlier draft of this document then disclosed the incident in prose and said
the re-run was "verified by bundle hash" — which was true and **entirely
unfalsifiable from the record**. The served bundle's identity is now MEASURED
before any capture and recorded in `capturedWith.servedBundle`: the served
`index.html` checksum, the entry script's path, size and checksum, and the local
`dist/index.html` checksum they are compared against. Three conditions abort the
run rather than being noted — the served bytes cannot be read, they differ from
this repository's `dist/`, or the entry script does not name this release.
