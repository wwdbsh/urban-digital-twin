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

---

# PROMOTION (T018, 2026-08-12): wave `w03` is promoted as a curated successor

This section is APPENDED. Nothing above it is rewritten, because what is above it
was true of the canary it describes and its three preconditions are what this
promotion had to answer.

The promoted release is
**`manhattan-southern-remainder-cells-20260812-p1`**, the FOURTH wave in
`EXTERIOR_DEFAULT_ACTIVATIONS`. The T017 canary is untouched, still pinned, still
opt-in only, and still absent from the promotion record.

## Precondition (a): the cache ceiling — ADR 0034 response 1, executed

**Response 1 was taken.** `EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries` moved from
**256 to 512**; `maxCachedBytes` deliberately did not move. ADR 0034's own
discharge section carries the full record, including why responses 2 and 3 were
not taken. It is repeated here only far enough that this wave's reader does not
have to leave: response 2 buys entries by withdrawing already-verified promoted
geometry, and response 3 recovers 14 entries of conservatism in exchange for
having to prove a per-camera worst case.

### The byte ceiling, re-derived at the raised cap

Required by this precondition in stronger terms than ADR 0034's, because this
wave's assets are heavier per asset than Lower-Manhattan's. That premise turned
out to be **false and the conclusion survived anyway**, which is recorded because
a precondition that was right for the wrong reason is worth naming: `w03`'s
curated assets average **223,618 B**, and Lower-Manhattan P1's average **580,130 B**
— two and a half times more, because that release is textured LOD 0 over the
World Trade Center site where the sourced rings are large.

The derivation is code, not prose: `src/runtime/exterior-cache-ceiling.ts`
computes it and its suite recomputes it on every run from the four waves' own
committed records. Three bounds, deliberately not collapsed into one:

| bound | value | of 256 MiB |
| --- | --- | --- |
| **Reachable** — all four promoted waves resident at once | **109,138,496 B = 104.08 MiB** | 41% |
| Modelled — 512 entries of the heaviest wave's MEAN asset | 283.27 MiB | 111% |
| Modelled, unreachable — 512 of the largest single asset | 2.03 GiB | 813% |

Only the first is a fact. A cache cannot hold more of a fixed set of releases
than all of it, and all of it fits inside 512 entries, so **bytes are non-binding
and entries remain the binding constraint**. The second is why `maxCachedBytes`
was left at 256 MiB rather than raised alongside: a heavier future composition
would evict on bytes before reaching 512 entries, and that is the intended
behaviour.

The occupancy that matters, re-derived from the four committed inventories rather
than remembered: 28 (Block 835 V3) + 156 (Midtown-core V3) + 71 (Lower-Manhattan
P1) = **255**, plus this release's **179**, = **434 of 512**.

### The eviction disclosure still holds, and is now wider

Eviction in the shared exterior LRU is recency-only, with no per-wave reservation
— ADR 0030, unchanged. Raising the entry cap does not repair it; it **widens its
blast radius**, because four promoted waves can now be co-resident and therefore
four waves can evict each other's already-verified bytes under camera pressure.
Nothing renders wrongly: every evicted artifact is re-fetched and re-verified
against its pin. The cost is a silent re-fetch the published metrics do not
attribute. The statement is carried in code as
`EXTERIOR_CACHE_EVICTION_DISCLOSURE` and asserted, so it cannot quietly stop
being restated now that the number it was about has moved.

## Precondition (b): the promoted subset is an explicit CURATED list

The canary's cell 276 is **not** promoted. The promoted subset is four cells —
**379, 385, 386, 387** — recorded as curation in
`src/release/southern-remainder-curation.ts`, carried into the release's own
committed inventory, and gated on every emission.

### How they were chosen, and the enumeration that checks it

The candidate set is every `w03` cell inside a stated envelope
(`-73.9930, 40.7442, -73.9819, 40.7483`), which is the high-rise band immediately
below the Midtown-core wave boundary and is no larger than that band: the canary's
cell sits nine tile rows further south and cannot satisfy it. Eight candidates,
177 admissible combinations under the 200-entry budget.

**The decision rule is LEXICOGRAPHIC, and an earlier draft of this section stated
it wrongly.** That draft said the curated set was "the enumerated optimum on
skyline value over every admissible combination". It was not, and review caught
it: the enumeration behind the claim silently bounded combinations at four cells.
The rule that was actually applied, in the order it applies:

1. **Edge-contiguity is a PRECONDITION, not a tie-break.** A promoted subset must
   render as one continuous piece of city; scattered textured islands with
   untextured ground between them read as a rendering fault, not a skyline.
2. **At most four cells** — `SOUTHERN_REMAINDER_CURATION_MAX_CELLS` — a stated
   criterion whose reason is a bounded curation blast radius (four rationales are
   readable; a set that grows to fill the budget is a fill, not a curation) and a
   single coherent district.
3. **Maximize skyline value** — owned buildings whose SOURCED height reaches 90 m
   — under 1 and 2. Not owned-building count: "maximal fill" is explicitly not
   what this promotion is for.

Under that rule `{379, 385, 386, 387}` is the **unique maximum at 16**.

**What each constraint costs is recorded, because a constraint whose price is
unmeasured is indistinguishable from a rationalisation.**

- **Contiguity costs two skyline buildings.** Lift it and two combinations reach
  **18**, both inside the envelope and inside the budget:
  `{379, 380, 385, 387, 388}` at 196 owned and `{379, 381, 385, 387, 388}` at 198.
  Both are DISCONNECTED — in each, cell 385 shares only the corner point where
  the two tile rows meet — so promoting either would put a textured island beside
  a textured block with base massing between them. Under contiguity the maximum
  reachable score is **16 at any size**, which is what makes the give-up bounded
  and knowable rather than open-ended.
- **The four-cell bound costs nothing on score and buys uniqueness.** Lift it and
  five CONNECTED combinations tie at 16 — `{379,380,381,386,387}`,
  `{379,380,381,387,388}`, `{379,380,386,387,388}`, `{379,381,386,387,388}` and
  the curated set. Exactly one of the five respects the bound. It is the only
  thing that makes the promoted set determined rather than arbitrary among
  equals.

At four cells or fewer, three DISCONNECTED combinations also reach 16 —
`{379,380,385,387}`, `{379,381,385,387}`, `{379,385,387,388}` — so the
contiguity precondition is doing visible work at this size too. The best
CONNECTED alternative under the bound scores 14, so the rule's margin over its own
runner-up is 2, the same size as what contiguity gave up.

None of that is a number written into this document and left there.
`southern-remainder-curation-optimum.test.ts` enumerates WITHOUT hiding the size
bound, pins the rejected 18-scoring alternatives by name together with their
scores and their disconnectedness, pins the five connected combinations that tie
at 16 once the bound is lifted, and re-runs all of it on every test run over the
committed wave ledger and a committed per-cell `skyline-census.json` the pipeline
emits from the pinned base. The two refused alternatives are also carried in code
as `SOUTHERN_REMAINDER_REJECTED_ALTERNATIVES`, with the reason each was refused.

**"Skyline value" is measured rather than trusted.** The census is pinned to the
exact base it was derived from (`manhattan-citywide-20260804` by manifest
checksum) and its per-cell counts are checked for internal consistency
unconditionally; whenever the pinned snapshot is present on the machine, every
cell the decision turned on — the four curated and every cell named in a rejected
alternative — has its sourced-height count and tallest height recomputed from
that snapshot and required to agree exactly.

| cell | owned | materialized | skyline (>= 90 m) | tallest | why |
| --- | --- | --- | --- | --- | --- |
| 379 | 29 | 29 | 6 | 190.0 m | the wave's northern edge; its north bound `40.748291015625` is shared EXACTLY with promoted Midtown-core cell `w01-000030` |
| 385 | 65 | 65 | 4 | 137.2 m | the street wall; without it the subset ends in mid-air at a tile edge |
| 386 | 50 | 49 | 2 | 155.8 m | the hub — every other curated cell is edge-adjacent to this one |
| 387 | 36 | 36 | 4 | **245.4 m** | the tallest sourced structure in the whole of wave `w03`, and the second at 202.1 m |

The cross-wave adjacency is the part worth stating twice: the promoted waves now
**meet on the ground**, so a camera crossing `40.748291015625` crosses from one
promoted wave into another with no untextured gap between them.

### The local refusal rate, recomputed and not tuned

**180 owned, 179 materialized, 1 refused = 0.556%**, against the **1.00%** wave
rate (96 of 9,603, the asset-stage census). Below the wave rate, and below the
canary's own cell at 1 of 77 = 1.30%. **No tolerance was moved to reach it.** The
single refusal is `doitt:938827`, whose sourced height falls below the one-floor
minimum the V3 grammar can carry; it ships as an explicit unavailable detail and
is deliberately OUTSIDE the accepted membership, so a scene that somehow drew it
fails closed.

### The rights instrument is the canary's, unedited

Same approval id, scope text, exclusions, note and therefore the same
fingerprint. Amending it would move the fingerprint the canary's own committed
release graph pins and would falsify what was approved. Every operative clause
was checked against this release and holds — including the bounded-subset clause,
which is exactly what differs here and exactly what the instrument left bounded
rather than enumerated. The carry-over is stated in the release's own committed
inventory bytes, not only in a source comment, so a reader holding the record
learns that the instrument is borrowed rather than fresh. It rests on no fresh
signature; the authority is the two recorded items the canary's note names.

## Precondition (c): cost measured OFF the vsync floor, at the RAISED cap

`scripts/southern-remainder-acceptance-cli.mjs`, against the production preview,
Chrome with `--disable-gpu-vsync --disable-frame-rate-limit`, three repeats per
station, 240 timed frames after 180 settle frames.

**The served bundle was identified before any capture** — the T017 fail-closed
pattern, carried here because an acceptance measurement against the wrong bundle
is worse than none. The served `index.html` was byte-identical to this tree's
`dist/index.html` and the entry script `/assets/index-BLRu1W7M.js` named this
release.

**The raised cap was in force.** `capAtMeasurement` and `runtimeBudgets` are both
read from `EXTERIOR_RUNTIME_BUDGETS` in the tree the served bundle was built
from, so a reading taken at 256 cannot be presented as a reading at 512.

### The capped control, and therefore the floor

A **second Chrome without the uncapping flags**, same station, read a p50 of
**8.30 ms** — a 120 Hz present interval. Every uncapped station sits far below it,
which is what makes the numbers below headroom rather than floor readings.

| station | profile | p50 | budget | p95 | budget | worst frame | p50 / control |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `nomad-facade` | inspection | **2.60 ms** | 33.3 | **8.00 ms** | 45 | 31.4 ms | 0.313 |
| `nomad-skyline` | exploration | **2.30 ms** | 16.7 | **6.60 ms** | 25 | **140.0 ms** | 0.277 |
| `crosswave-wide` | exploration | **1.60 ms** | 16.7 | **4.80 ms** | 25 | 14.9 ms | 0.193 |
| `fidi-facade` | inspection | **3.80 ms** | 33.3 | **7.90 ms** | 45 | **70.3 ms** | 0.458 |

Every p50 and every p95 is inside both profile budgets. `fidi-facade` is the T016
station kept pose-for-pose UNCHANGED, so the fourth wave's cost to the third is a
comparison rather than an assertion. `crosswave-wide` is the station that holds
wave `w03`'s curated block and the promoted Midtown-core wave in one frame — a
four-wave composition nobody had measured before this run.

**Isolated slow frames are STATED, not smoothed.** The worst observed frames are
140.0 ms at `nomad-skyline` and 70.3 ms at `fidi-facade`. They are single frames
inside 240-frame windows whose p95 is 6.6 ms and 7.9 ms respectively, so they are
asset-upload and first-texture-decode spikes rather than sustained cost — but they
are real frames a user could see, and reporting only the percentiles would hide
them.

### Heap, residency, GPU, hosts

- **JS heap after forced GC**: 185.6 MiB (`crosswave-wide`) to 330.5 MiB
  (`nomad-facade`), medians across three repeats. `usedJSHeapSize` is a JS heap
  reading and stands in for nothing else.
- **Cache residency, worst observed: 420 entries and 100.45 MiB**, against the
  512-entry and 256 MiB caps. DERIVED per release from the network measurement —
  one fetched GLB is one LRU entry — because the in-app cache counter only
  reaches the DOM in a `VITE_BLOCK835_PROBE` build and this measurement is
  against the ordinary production preview. Per release at the worst station:
  14 / 156 / 71 / 179 GLBs. The release-time derivation budgets **434** because it
  counts Block 835's 28 files on disk rather than the 14 LODs a session resolves;
  it is conservative, not wrong, and both numbers are recorded.
- **GPU texture memory: 44.55 MiB, COMPUTED AND NOT MEASURED.**
  `128 * 128 * 4 * 1.33 * 536` over the 536 images embedded across this release's
  179 shipped GLBs, not deduplicated across models. No instrument reachable from
  this session reports texture VRAM. This figure is this release's share ALONE:
  Block 835 V3 and Midtown-core V3 are texture-free, but Lower-Manhattan P1 is
  not, and its own T016 record computes its share separately.
- **Zero external hosts** were contacted in any capture.

## Journeys

`scripts/southern-remainder-journeys-p1-cli.mjs`, five journeys, all passed,
against a bundle verified before the first capture.

- **`cold-default`** — a clean no-parameter load streams all four promoted waves
  and fetches all **179** curated `w03` assets, and **zero** bytes of the T017
  canary. The wait is on the fetch count reaching its shipped total or ceasing to
  grow, not on wave activation, because T017 records a journey that sampled at
  activation and read 7 of 71.
- **`cross-wave-pick`** — the tallest sourced structure in the wave,
  `doitt:1290754`, selected through the app's own search. The details panel names
  the release `manhattan-southern-remainder-cells-20260812-p1`, the cell and cell
  release `manhattan-exterior-cell-w03-000387-…`, the active asset's 64-hex
  checksum, truth tier `generated`, the source capture and update dates, and an
  uncertainty statement. With four waves resident this also proves the panel
  attributes to the RIGHT wave.
- **`canary-opt-in`** — the T017 canary's link still resolves to the canary
  ALONE: 76 canary GLBs, zero from the successor and zero from the other three
  waves, from a camera derived in code from that canary cell's own committed
  bounds and asserted inside them before capture.
- **`streaming-off`** — `exteriorStreaming=off` disables all four waves and
  fetches no exterior GLB at all. **Its still DIFFERS from `cold-default`'s at
  the identical pose** (`6c5360e5…` against `a0a0bc3f…`), which is the only
  evidence in this record that the curated assets are DRAWN rather than merely
  downloaded — the T017 discipline, kept, because network counts prove bytes
  arrived and nothing more.
- **`tombstone-truth`** — the notice reads "172 of 176 exterior cells ship no
  exterior geometry in this release; no substitute was selected for them."

**Rollback is not a browser journey and this record does not pretend it is.** No
URL expresses a build-time promotion-record swap, so it runs through the record's
own injection seam in `exterior-multiwave-activation.test.ts`: wave `w03` returns
to base massing, the other three keep streaming untouched, the withdrawn
successor's link is refused BY NAME, and the T017 canary's opt-in is deliberately
NOT refused because it was never promoted.

One reading is recorded as empty rather than dressed up: `streaming-off`'s
`unavailableStatements` array is `[]`, exactly as it was in the T016 record. That
selector does not capture the panel text in this flow; the journey's pass is
computed from the wave and network readings, not from that array, and the array
is left in the record showing what it actually returned.

## Blender

86 of the 179 curated assets re-imported, measured and rendered — the
deterministic stratified sample, every one of them textured, against a required
minimum of 10. Blender 5.2.0 LTS, Python 3.13.13, EEVEE Next.

Triangle delta 0, material mismatches 0, bounds deviation 0.0 m against a
**5.67 m** Z-up control hypothesis, worst volume deviation 5.92e-7, non-solid
meshes 0. On the texture side: **257 embedded images**, image-count mismatches 0,
**textures-unreachable 0**, minimum UV layer count 1 — an asset can embed a
perfectly good PNG, declare it, pass every byte gate and still render flat if
nothing samples it, and that is what those last two check. Every measured
checksum was cross-checked against this release's committed payload inventory
before it was recorded; a mismatch fails the writer rather than being reported.

## Rollback semantics: this wave rolls back to BASE MASSING

`SOUTHERN_REMAINDER_EXTERIOR_ACTIVATION.predecessor` is the DISABLED base-only
record — the `w02-p1` precedent for a first-promotion wave. Wave `w03` has never
been promoted in any form: its only other release is the T017 canary, which was
pinned but never a default. There is no untextured `w03` release and no earlier
`w03` default, so the previous verified representation of this area IS the pinned
base massing, and rolling back returns it there.

Two consequences, neither obvious:

- the rollback names the **P1 successor** as withdrawn, so promotion-era
  `?exteriorCells=manhattan-southern-remainder-cells-20260812-p1` bookmarks fail
  closed in the same single record swap;
- it deliberately does **not** name the canary, which was never promoted and
  stays reachable exactly as it was.

The other three waves keep streaming through a `w03` rollback; the per-record
rules were already per wave.

## Preconditions on the NEXT wave promotion (w04, w05)

Named here so a fifth wave cannot inherit them by silence, exactly as ADR 0034
named this wave's and this wave discharged them.

### (a) The headroom arithmetic, and it is tight

    512 - (255 + 179) = 78 entries

**78 entries remain for waves `w04` and `w05` together.** Wave `w04` owns 249
cells and `w05` owns 182; `w03`'s median cell alone owns 50. So 78 entries is
roughly one and a half ordinary cells, split between two waves — enough for a
token subset of one of them and not enough for both to promote anything anyone
would call a skyline.

**A fifth wave therefore faces the same decision this one did, one doubling
later.** ADR 0034's three responses are all still available and all still cost
what they cost. Response 1 again (512 to 1024) is the cheapest to execute and the
one that should be justified hardest, because it is now a pattern rather than a
one-off: the byte ceiling would have to be re-derived a THIRD time, and at 1024
entries the modelled mean fill is 566 MiB against an unchanged 256 MiB byte cap,
so bytes would very plausibly become binding and the cap would start evicting
inside the entry budget. Response 3 — counting what the runtime resolves rather
than what is on disk — is worth more than it was: the disk derivation now
over-reserves by 14 entries on Block 835 alone, and the T018 measurement puts
actual worst-observed residency at 420 against a budgeted 434.

### (b) Residual conditions carried forward unresolved

- **Per-wave residency policy is still deferred** against ADR 0024, and the ADR
  0030 disclosure is wider than it was. At four co-resident waves nothing evicts
  anything at the stations measured; at five or six on a smaller cache, it will,
  and the metrics will not say which wave paid.
- **A curated subset is a constant in this repository**, so it is covered by the
  stage fingerprint only through `renderableCellDigestSha256`. That seam is now
  load-bearing for `w03` as it already was for `w02`;
  `southern-remainder-fingerprint.test.ts` is what fails if it is removed.
- **The skyline threshold of 90 m is a judgement**, not a discovery. It is stated
  in `SOUTHERN_REMAINDER_SKYLINE_HEIGHT_METERS` and the enumeration is ranked on
  it and nothing else. A later wave choosing a different threshold must say so
  rather than quietly reusing this one where it does not fit.

## One thing that went wrong, kept because it is worth naming

**A latent tileset ordering defect surfaced, and it failed closed.**
`validateTileset` walks the assembly's root children in `canonicalFeatureId`
order; `buildMidtownCoreRelease` sorted them by the content URI instead. The two
agree only while no building id is a strict PREFIX of another, because the URI
appends `__lod_0.glb` and `7` sorts before `_`. Every release emitted before this
one happened to satisfy that. This 179-asset subset is the first that does not —
`doitt:615` is a prefix of `doitt:61531` — and the assembly replay REFUSED the
emitted tileset rather than shipping a chain the validator could not walk.

The fix sorts by the key the validator uses. No frozen byte moves with it, and
that is checked rather than asserted: `exterior-tileset-ordering.test.ts`
verifies that every already-emitted release's asset id set orders identically
under either key, and that this one does not.
