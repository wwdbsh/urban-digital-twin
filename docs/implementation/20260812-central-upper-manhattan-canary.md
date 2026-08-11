# Central-and-upper-Manhattan textured canary (T019)

Implementation record for `manhattan-central-upper-manhattan-cells-20260812`,
wave `w04` of the committed exterior wave ledger. Decisions and their reasoning
are in [ADR 0036](../decisions/0036-central-upper-manhattan-textured-canary.md);
this file is what was run, what came out, and what is not covered.

**This release is a CANARY.** It is pinned for `?exteriorCells=` opt-in and is
absent from the promotion record, so an ordinary session never loads it.

## What shipped

| | |
| --- | --- |
| Release id | `manhattan-central-upper-manhattan-cells-20260812` |
| Wave | `w04` `central-upper-manhattan` — 249 cells, 11,721 buildings (largest of six) |
| Base | `manhattan-citywide-20260804`, manifest pinned |
| Predecessor | `manhattan-southern-remainder-cells-20260812-p1` (root + snapshot, by checksum) |
| Renderable cells | 3 of 249; 78 owned, 75 materialized, 3 refused |
| Tombstoned cells | 246 |
| Payload | 480 files, 28,763,378 bytes (untracked; inventory committed) |
| Shipped assets | 75 GLBs, 11,527,144 bytes, LOD 0, textured |
| Public root | `cb9c420f203e1bb64e8c524275079502b879c2cb0698bab29cb25ee47b9499f9` |
| Private root | `7e90e1aaa92dcc631775ae3d5ac535877689fa00f7d97a0f06f288559fb83bfd` |
| Assembly fingerprint | `166610924cb8316dbac81a5d9cc997679dc0e8946d7c30307ea8d4be8369e235` |
| Approval fingerprint | `81ba0879fbc956c912db7548ff7650a3364fd0bf1ab117a7926cf75d0714df5e` |
| Texture catalogue | `procedural-texture-v1`, rasterizer `1.0.0`, params `121fb53e9b3b08ce3b7fa00ec5d370466c5ae2861b8966cccbfa19861ab438ff` |

## Reproducing it

The pipeline acquires nothing, replaces no retained snapshot, and writes only
under the two directories it owns. Each stage writes a receipt fingerprinting its
inputs, so an interrupted run resumes rather than restarting.

```sh
pnpm install --frozen-lockfile

# Five stages. `all` runs them in order; each is independently resumable.
pnpm central-upper-manhattan:pipeline plans     # ~52 s
pnpm central-upper-manhattan:pipeline glbs      # ~81 s, 23,086 assets generated
pnpm central-upper-manhattan:pipeline gates
pnpm central-upper-manhattan:pipeline graph
pnpm central-upper-manhattan:pipeline sample

# Blender re-import over the stratified sample (Blender MCP, scene reset per asset),
# then the committed record with its inventory cross-check.
#   scripts/blender/central_upper_manhattan_sample.py
pnpm central-upper-manhattan:blender-record

# Renderer journeys. Build FIRST: the suite refuses to capture against a preview
# that is not serving this tree's dist.
pnpm build
npx vite preview --port 4176 --strictPort
# Chrome: --remote-debugging-port=9222 --user-data-dir=<scratch>
pnpm central-upper-manhattan:journeys --preview http://localhost:4176 --port 9222
```

`graph --force` rebuilds `payload-inventory.json` byte-identically; this was
checked during the run after the census note was corrected, and the inventory
checksum did not move.

## Refusal census (stages `plans` and `glbs`)

Over all 11,721 owned buildings, UNTEXTURED — the census asks which sourced
polygons the grammar can carry, and tiles touch no plan field.

| | |
| --- | --- |
| Materialized | 11,543 |
| Refused | 178 (**1.52%**, against a 15% STOP) |
| Generated assets | 23,086 (two canonical LODs each), 1,083,362,332 bytes measured |
| Retention | `census-only` — measured, then dropped |
| Unique plan hashes | 11,543 (one per materialized building) |
| Absent setbacks | 5,374 (**46.6%** of materialized) |
| Max triangles | 48,388 (budget 200,000) |
| Max textures | 0 (untextured by design) |

| Stop code | Count |
| --- | --- |
| `source-height-below-grammar-minimum` | 77 |
| `ring-vertex-count-unsupported` | 64 |
| `ring-area-below-floor` | 25 |
| `ring-neck-below-grammar-minimum` | 10 |
| `ring-not-simple` | 2 |

Style classes: `masonry-warm` 4,580, `masonry-light` 3,618, `stone-neutral`
2,147, `curtain-cool` 1,198.

### The plan and asset distributions are EQUAL, and that needed evidence

Unlike wave `w03`, the plan-stage and asset-stage refusal distributions are
identical: the writer's mesh-versus-analytic volume identity check ran and
rejected nothing. Because equal totals are also what a check that never ran would
produce, the census records the check as a measurement:

| | |
| --- | --- |
| Buildings checked | 11,543 |
| Buildings rejected | 0 |
| Worst volume deviation | 9.882970279185346e-7 |
| Tolerance | 1e-6 (unchanged) |
| **Fraction of tolerance** | **0.988** |

**The check passed at 98.8% of tolerance.** That is disclosed as a finding, not
buried: `central-upper-manhattan-census.test.ts` bounds the fraction from below as
well as above, so quietly widening the tolerance fails the suite instead of making
the margin look comfortable. ADR 0035's sentence claiming equal totals would imply
the check never ran is explicitly retracted in this wave's census note.

### The shipped subset refuses at a higher rate

3 of 78 (3.85%) against the wave's 1.52%. An order-derived subset has no reason to
be representative; the census suite asserts the inequality rather than reporting
only the wave rate.

## Renderable-subset derivation (stage `gates`)

```
maxCacheEntries                                     512   (raised at T018)
promotedWaves                                         4
  manhattan-exterior-cells-20260811-v3               28
  manhattan-midtown-core-cells-20260811-v3          156
  manhattan-lower-manhattan-cells-20260812-p1        71
  manhattan-southern-remainder-cells-20260812-p1    179
promotedAssetEntries                                434
alongsidePromotedHeadroom                            78
waveCellCount / smallest / median            249 / 1 / 48
admitsMedianCellAlongsidePromoted                  true
remainingUnpromotedWaves       w04 median 48, w05 median 55
medianCellsOfAllRemainingWaves                      103
headroomAdmitsMedianCellOfEveryRemainingWaveTogether  false
optInSoloCeiling                                    512
modestSubsetCeiling                                  80   (judgement, carried from w03)
entryBudget                                          80
```

Order-derived walk, whole cells only:

| Cell | Owned | Cumulative |
| --- | --- | --- |
| `…-w04-000452-17-38598-35840` | 25 | 25 |
| `…-w04-000453-17-38599-35840` | 51 | 76 |
| `…-w04-000454-16-19298-17920` | 2 | 78 |
| `…-w04-000455-17-38598-35841` | 50 | does not fit |

78 owned, 75 shipped, 2 spare entries. **78 shipped-cell buildings and 78 free
cache entries are a coincidence, not a derivation** — one is 25 + 51 + 2 under an
80-entry ceiling fixed before the promoted set was counted, the other is 512 − 434
— and a test pins both so the canary is never read as having been sized to the
promotion headroom.

Ownership: subset ledger passes the accepted release-graph checks, reconciles
exactly against the committed membership digest (0 missing owners, 0 duplicate
owners), and shows 0 overlap across all 452 excluded parent cells of waves 0–3.

## Blender re-import (stage `sample`)

67 sampled assets — 4 per stratum across 11 strata, plus **every one of the 42
disclosed tier collapses** rather than a sample of them. All 67 carry tiles.
Blender inspects and measures; the Node writer owns the shipped bytes and nothing
in the pass authors geometry.

| | |
| --- | --- |
| Samples | 67 (all textured) |
| Triangle delta | 0 |
| Material mismatches | 0 |
| Bounds deviation | 0.0 m — against an 8.729 m Z-up control hypothesis |
| Bounds within tolerance | 67 / 67 |
| Worst volume deviation | 6.635364464323122e-7 (independent re-import) |
| Not-solid count | 0 |
| Embedded images | 200 |
| Image-count mismatches | 0 |
| Textures unreachable | 0 |
| Minimum UV layers | 1 |
| Re-imported triangles | 130,234 |

The Z-up control matters: if pretending the file were authored Z-up ALSO produced
~0 deviation, the diff would be measuring nothing. It produces 8.729 m.

`texturesUnreachable: 0` is the check a checksum cannot do — an asset can embed a
valid PNG, declare it, pass every byte gate and still render flat if no material
samples it. Every sample carries a UV layer and materials that reference the
imported images.

**Every sampled checksum is cross-checked against the committed payload inventory
before it is recorded**, so the report is provably about the bytes that shipped. A
mismatch fails the record script rather than being noted.

### The render engine string was checked rather than copied

The earlier waves' Blender records say `renderEngine: "first available real-time
engine (EEVEE Next on this build)"`. On the Blender that ran THIS pass — 5.2.0
LTS, Python 3.13.13, the versions those records also name — the engine enum offers
only `BLENDER_EEVEE`, so the pass's first-available selection resolved to that and
`BLENDER_EEVEE_NEXT` was never available to select. This record therefore says
`BLENDER_EEVEE` and says why.

**That casts doubt on the earlier records' engine string, and they were NOT
edited.** They are frozen bytes whose checksums other releases pin, the engine
name is not load-bearing for any measurement in them, and correcting another
task's committed evidence is outside this task's scope. It is named here so the
discrepancy is on the record rather than silently reproduced.

### A deviation in HOW the pass was driven

The pass was executed through Blender MCP in four batches rather than one call,
because MCP call namespaces do not persist between calls and 67 renders exceed a
single call's practical budget. Partial results were checkpointed to a scratch
file, then aggregated with the committed script's own aggregation applied
verbatim, and the checkpoint was deleted. `boundsWithinToleranceCount` was added
to the committed script's `run()` so a single-call re-run reproduces the same
report shape. The per-sample measurements are the committed `inspect()` function's
output, unmodified.

## Renderer journeys

Four journeys, **all passed**, against the production preview on a port owned by
this run and the real pinned citywide base.

The bundle was identified BEFORE any capture — the T017 fail-closed pattern, which
exists because a stale `vite preview` from another worktree once made a journey
pass meaninglessly. Served `index.html` byte-identical to this tree's
`dist/index.html`; entry script `/assets/index-BDXyc--A.js`,
`5af56ae62954df88…`, contains this release id.

Camera pose derived from committed ledger bounds and asserted inside them before
any capture: `-73.984351, 40.780042`, height 70 m, heading 45°, pitch −6°, inside
`manhattan-exterior-cell-w04-000453-17-38599-35840`.

**Which cell is framed is derived, not typed.** This canary renders three cells,
so the suite picks the one owning the most buildings (51), ties broken by cell id.
The pick target is likewise derived: the heaviest LOD 0 asset the committed
inventory declares inside that cell, `doitt:120741`.

| Journey | Reading | Still |
| --- | --- | --- |
| `promoted-default-unchanged` | 14 / 156 / 71 / 179 GLBs from the four promoted waves; **0 GLBs and 0 bytes** from this release; 0 external hosts | `4da4afaf…` |
| `canary-opt-in` | **75 GLBs** from this release, 12,611,129 bytes; **0 GLBs from every promoted wave**; 0 external hosts; still DIFFERS from promoted default at the identical pose | `5952d0e4…` |
| `textured-pick` | badge `Local · manhattan-central-upper-manhattan-cells-20260812`; rows Release origin, Render profile, Cell / release, Active asset (64-hex checksum), Truth tiers, Source dates, Uncertainty | `16baae90…` |
| `tombstone-truth` | "246 of 249 exterior cells ship no exterior geometry in this release; no substitute was selected for them." | `5952d0e4…` |

**`tombstone-truth`'s still is byte-identical to `canary-opt-in`'s** — same pose,
same parameters, same rendered frame. That is stated because it is true, not
presented as an independent capture.

**Block 835 fetched 14 GLBs, not the 28 the occupancy derivation counts.** Both
are correct: the derivation counts every shipped artifact because the cache is
keyed per artifact, while a session fetches only the LODs its pose needs. 434 is
an upper bound on residency, not a measurement of it.

`canary-opt-in` is load-bearing beyond its own claim — the entry budget rests on
`?exteriorCells=` SELECTING rather than ADDING, and this measures it directly. The
stills-differ requirement is part of passing rather than a note beside it, because
a network count proves assets were fetched and not that they were drawn.

Visual confirmation: at this pose the promoted default shows only flat base
massing, while the opt-in still shows materialized buildings with window-grid
facades, water towers and rooftop detail.

## Committed records

`data/central-upper-manhattan-20260812/`:

| File | SHA-256 |
| --- | --- |
| `payload-inventory.json` | `57fc5b31996776c576e887e7a617d8408212d7c7fba5ff5bca9f47655d4b8448` |
| `derivation.json` | `845d082da3478d18ba1032e995cb30361842389898b3bde5bd5044ae0734dcb9` |
| `wave-census.json` | `064d3ba19aa25ba6601096d332b95a67d0efb7fe47c30e24d939bc7f4b6fc6a8` |
| `blender-sample.json` | `39cfb82e906d547ea30ac173d1d6f8aa36d97e1535d7197cb744906df8125606` |
| `journey-evidence.json` | `d7af843a7b07f3eea1602528010e48b553296d843d0025eb1347e976e61909cf` |

The work root `artifacts/central-upper-manhattan-20260812/` and the journey
captures are gitignored; every hash that matters is above. Drift suites read these
committed files and are never skipped when the payload directory is absent.

## Verification gaps, stated

- **No frame-time, heap, GPU-memory or cache-residency measurement was taken for
  this wave.** Those are promotion's instrument; this release is not promoted. The
  tile system's own cost is INHERITED from T015 / T016 / T018 on the same pinned
  catalogue.
- **The volume-identity margin is corroborated only on the sample.** The 0.988
  figure is the writer's own arithmetic over 11,543 buildings; Blender's
  independent recomputation covers 67 of the 75 shipped assets.
- **No still is taken from inside the two renderable cells the camera does not
  stand in.** They ship and are counted by the opt-in journey's 75 GLBs.
- **No rollback rehearsal and no fault isolation.** No URL expresses a build-time
  promotion-record swap, this release has no promotion record, and the fault
  injector is behind a `VITE_BLOCK835_PROBE=1` build that is not the production
  preview.
- **No facade-fidelity claim.** The tiles are designed motifs that reproduce,
  resemble and report on nothing real.
