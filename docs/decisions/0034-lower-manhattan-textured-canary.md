# ADR 0034: The Lower-Manhattan wave, and the first textured exterior release

- Status: accepted
- Date: 2026-08-12
- Supersedes: nothing. Extends ADR 0029 (wave materialization), ADR 0031 (V3
  grammar), ADR 0032 and its amendment A1 (procedural textures and the decided
  sampler filter).

## Context

Wave `w02` (`lower-manhattan`) is 126 ownership cells and 6,425 canonical
buildings of the committed exterior wave ledger. Two waves are already promoted:
Block 835 (`w00`) and Midtown-core (`w01`), both texture-free.

This wave is the first to ship procedural facade detail tiles. ADR 0032 built the
`procedural-texture-v1` catalogue and its rasterizer-replay gate but deliberately
did not adopt it in any public release; ADR 0032 amendment A1 decided the sampler
filtering (`LINEAR` / `LINEAR_MIPMAP_LINEAR`) from T028's measured evidence and
said, equally deliberately, that the frozen `-v3t` package would not adopt it
because adopting it would move bytes that package's committed census pins.

So four questions had to be answered together, and the order mattered.

## Decision 1 — the materializer is wave-generic, and midtown proves it

`midtown-core-package.ts` hard-coded wave `w01`'s hash domains, and
`midtown-core-v3-materialization.ts` hard-coded that wave's identity, seed, tool,
uncertainty, its texture-free emission and the zero-texture `V3_QUALITY_BUDGETS`.
A second wave could have been written beside it. It was not, because two copies
of a derivation drift.

The derivation moved into `exterior-wave-subset.ts`, parameterized by an
`ExteriorWaveSubsetIdentity`, and the materializer gained a `V3WaveProfile` — the
same device `V3PackageProfile` already uses in `block835-v3-package.ts`. Every
entry point defaults to wave `w01`'s profile, so that wave travels the identical
code path with the identical constants.

**Per-wave hash domains are mandatory.** Both derived ids are domain-separated
and each wave supplies its own strings. Wave `w02` uses
`udt.lower-manhattan.subset-ledger-id.v1` and
`udt.lower-manhattan.subset-base-identity.v1`. Borrowing another wave's domain
would let two different partitions collide in id space, which is the entire
reason the separation exists.

The extraction is proven byte-neutral rather than asserted to be:
`midtown-core-package.test.ts` re-derives the **committed**
`data/midtown-core-20260811-v3/derivation.json` record — the ledger id, both base
identity set ids, the coverage rectangle, the wave-0 exclusion and all 149 order
mappings — from the committed parent ledger and compares the serialization. A
parameterization that quietly changed a domain, an excluded wave, or a key order
fails that test.

### The excluded set widened, and why that is not a drift

Wave `w01` excluded wave 0 alone, because the Block 835 cell was the only other
partition that existed when it was derived. Wave `w02` excludes waves 0 **and**
1. The App holds ONE exterior cache across every promoted wave, so a building
owned by two releases would be an ownership contradiction and a cache-identity
hazard at once. The excluded set is a per-wave input precisely so widening it
here cannot move wave `w01`'s committed `exclusions` array.

## Decision 2 — the kill switch runs before the mass build, not after it

Texturing 6,425 buildings and then discovering the result is unaffordable would
waste hours and, worse, would create pressure to accept a bad result because it
already exists. So the first thing built was the heaviest cell of the renderable
subset, in two variants that differ **only** in whether LOD 0 carries tiles, and
it was measured in the shipping CesiumJS renderer.

The T028 harness was reused, not rebuilt. It gained a measurement phase after its
settle phase — 240 timed frames and a heap reading — and the dev/preview
middleware's scratch root became an environment variable so two investigations
cannot overwrite each other's trees. There was no CDP capture CLI to reuse: T028's
Chrome session was driven by hand, and its script only ever planned variants and
hashed stills a human had already taken. A number a human reads off a screen is
not replayable, so the session is now driven over the DevTools Protocol.

**Measured, at three stations (60 m, 190 m, 640 m):** frame-time p50 ratio
0.99–1.00, p95 ratio 1.01–1.03, worst observed frame 10.6 ms against a 16.7 ms
60 Hz budget. Heap: +4.2 to +6.0 MB across 33 assets. Visually the textured
variant is strictly more legible close in — courses, reveals and openings read as
construction rather than flat panels — and past the LOD 0 cut-off, at maximum
tile repeats per screen pixel, the facades stay even: no speckle, no horizontal
clumping, no moiré. That is exactly the defect T028 measured under unspecified
sampler filtering, and not seeing it here is the amendment A1 filter doing its
job in a second, independent package.

**Both measures are floor tests, not cost measurements, and the record says so.**
Every mean across all six captures is 8.33 ms — that is the 120 Hz present
interval, not a rendering measurement. The scene is vsync-bound in both variants,
so the p50 comparison carries no information at all and the p95 spread (ratios
0.99–1.03) is inside run-to-run noise. What the frame-time evidence honestly
supports is that tiles do not push this scene off the vsync floor. It cannot
quantify headroom, because a measurement pinned to the presentation clock never
reveals how much work was left over. That is **adequate for a canary**, whose
question is only whether tiles make this unusable, and **inadequate for
promotion**, which needs an uncapped measurement.

Likewise the heap figure is `usedJSHeapSize` and nothing else. **GPU texture
memory is unmeasured**: decoded images, their mip chains, and the vertex and
index buffers live in driver memory this instrument cannot see. Four 128×128
grayscale tiles are small and their mip chains smaller, so the GPU cost is
expected to be modest — but expected is not measured, and neither this ADR nor
the committed verdict claims otherwise.

**The first heap measurement was wrong, and the record says so.** Reusing one tab
across six navigations accumulated roughly 10 MB per load, and a variant-major
capture order turned three navigations of accumulation into an apparent 35 MB of
"texture cost". Each capture now runs in a fresh page target and reads its heap
after a forced collection. The corrected figure is 4–6 MB. The wrong number is
kept in `kill-switch-verdict.json` because a measurement method that can mislead
is worth naming.

The verdict lives beside the measurements, not inside them, and cites the
evidence file by checksum — so re-running the capture cannot silently rewrite a
verdict, and the verdict names the exact bytes it was formed from.

## Decision 3 — the rights instrument is NEW, and no frozen approval is edited

The Midtown-core V3 scope says the release is `TEXTURE-FREE` and its exclusions
forbid "runtime textures of any kind, procedural or captured". That is true of
that release and stays true. A scope that excludes textures cannot admit them, so
this wave could not borrow it, and editing it would falsify what was approved.

`LOWER_MANHATTAN_APPROVAL_SCOPE` therefore claims the minimum that is actually
true:

- the tiles are procedurally generated in this repository, a pure function of
  named constants, and the release validator re-rasterizes the whole catalogue
  and demands byte equality with every embedded PNG. A tile derived from a
  photograph is unreproducible by that gate **by definition**, so it fails closed
  rather than by policy;
- the motif dimensions were calibrated by **viewing** public reference imagery
  and nothing else. No image was ingested, decoded, traced, sampled or
  reproduced, and no pixel of any photograph is present in or derivable from the
  shipped bytes;
- display is local, inside the conveyance envelope the base geometry already has.
  This instrument broadens nothing about the NYC OTI source data.

The blanket texture exclusion is replaced by the two narrower things that remain
false: captured or source-derived imagery of any kind, and any claim that a
designed tile reproduces, resembles or reports on a real facade. Public internet
deployment stays excluded.

The evidence is exactly two recorded items — the user's texture direction of
2026-08-11, which was explicitly reference-only, and the recorded standing
autonomy directive — and the note says in terms that neither is a licence grant
from a third party. The scope is pinned by fingerprint like the midtown scope.

**No runtime change was needed.** `exterior-cell-runtime.ts` reads
`textureAdmission` identically for an opt-in load and a promoted one.

## Decision 4 — the renderable subset is derived from ENTRIES, not bytes

`EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries` is 256. Bytes are not the binding
constraint — the per-cell cap's own derivation records that 120 buildings at both
LODs is roughly 8% of the byte ceiling — so the subset is sized against entries.

It is sized to fit **alongside** both promoted waves, not merely alone. A subset
that only fits alone would have to be re-cut at promotion, which is the one thing
an immutable release cannot do. Block 835 V3 ships 28 GLBs and Midtown-core V3
ships 156, so the budget is 256 − 184 = 72 entries. Cells are admitted whole, in
visual-priority order, while the subset still fits: 2 cells, 62 owned buildings,
41 materialized assets, 10 entries spare against the owned count.

Whole cells only — a cell loads atomically, so a partially renderable cell is a
cell that can never finish loading.

The promoted occupancy is counted from the committed payloads, not remembered. A
first attempt read Block 835's root manifest and got zero, because that release
declares its GLBs in its assembly package rather than on the root; it would have
handed this wave 28 entries that are not free.

The remaining 124 cells ship as truthful tombstones.

## Decision 5 — the wave census is untextured, and that is a true statement

The census asks which sourced polygons this grammar can carry. That is a question
about geometry, and tiles are a writer-stage concern that touches no plan field.
The census profile shares this wave's seed, tool and generated instant with the
shipped profile, so **every plan hash is identical between the two passes** and
the census is a true statement about the buildings that ship. Rasterizing tiles
for six thousand buildings whose bytes are then discarded would buy nothing but
hours.

## The refusal census, reported rather than tuned

Over all 6,425 owned buildings: 6,425 resolved, 6,291 materialized, 134 refused —
**2.09%**.

| stop code | count |
| --- | --- |
| `source-height-below-grammar-minimum` | 61 |
| `ring-vertex-count-unsupported` | 33 |
| `ring-area-below-floor` | 25 |
| `ring-neck-below-grammar-minimum` | 7 |
| `volume-identity-failed` | 7 |
| `ring-not-simple` | 1 |

A higher refusal rate was expected on colonial-era lots and did not materialize
at wave scale. It did locally: the renderable subset refuses 21 of 62 (34%),
almost all `source-height-below-grammar-minimum`, because the two
highest-priority cells are low-rise harbour structures. No tolerance was moved to
improve either number.

2,545 of the 6,291 materialized buildings ship `setbacks` **absent** with a
stated reason rather than an invented inward offset. That is a disclosed hole,
not a refusal, and it is counted separately.

## Consequences

- The release is **pinned but not promoted**. It is reachable by an explicit
  `?exteriorCells=` opt-in and nothing else.
- **`verifyPromotedExteriorPin` does not run for it.** That check reads the
  promotion record and this release has no entry there, so its verification rests
  on release-graph and checksum validation alone. That is a narrower guarantee
  than a promoted wave gets. It is stated in the constant's own comment and in
  the implementation record, and closing it is promotion's job.
- "Composes over its predecessors" is met as **graph lineage**: the promoted
  Midtown-core V3 public root and snapshot are pinned by the checksums that wave
  published, and each cell falls back to pinned base massing. It is not runtime
  co-rendering: `?exteriorCells=` selects one release alone by design.
- No building of this wave was shipped by an earlier wave, so per-building
  predecessor pins are `null`. Inventing a pin for geometry that never existed
  would be false lineage.

## Preconditions on T016 (promotion)

This canary deliberately leaves three things undone. They are named here so
promotion cannot inherit them by silence.

### (a) Promotion must NOT inherit this renderable subset

This subset was derived from the ledger's cell `order`, which is documented as
"global visual-priority order" but is in fact a south-to-north tile-row
traversal. That is a legitimate basis for a canary — it is a derivation, not a
curation — and it is **not** a legitimate basis for what a user sees first.

Promotion must do one of two things, and record which:

1. **Redefine wave order** so "visual priority" is a stated, computed property —
   building count, built volume, landmark presence, whatever is chosen — and
   re-derive the subset from it; or
2. **Record an explicit curated subset**, with the curation stated as curation
   and the reason for each admitted cell written down.

Silently reusing cells 150–151 is excluded either way.

### (b) The promoted subset must include Financial District cells and justify its refusal rate

The current subset refuses 21 of 62 (34%), against a wave rate of 2.09%, because
its two cells are harbour and Governors Island low-rise dominated by
`source-height-below-grammar-minimum`. A promoted subset must include Financial
District cells and must demonstrate a local refusal rate **materially closer to
the 2.09% wave rate**. A promoted set that refuses a third of what it owns is not
representative of the wave it is promoting, whatever its cells are called.

### (c) Cost must be re-measured off the vsync floor, with GPU memory named

The canary's frame-time evidence is a floor test on a 120 Hz display (see above).
Promotion needs:

- an **uncapped** frame-time measurement — vsync disabled, or a deliberately
  oversubscribed scene — so actual headroom is stated rather than inferred from
  the absence of dropped frames; and
- **GPU texture memory named explicitly**, not `usedJSHeapSize` standing in for
  it, at wave scale rather than for one cell.

## Known gap worth naming

The wave ledger documents its `order` field as "global visual-priority order",
but it is derived from a south-to-north tile-row traversal. For wave `w01` that
landed on dense Midtown cells and the label held. For wave `w02` the two
highest-priority cells are harbour and Governors Island low-rise, **not** the
Financial District skyline. The ordering was followed as specified rather than
overridden, because it is a derivation and overriding it would make the
renderable subset a curated choice. But "visual priority" currently means
"southernmost first", and a wave whose south end is water gets a weaker visual
canary than the label promises. Defining visual priority properly is a decision
for promotion, not for this canary.

---

# Promotion decision (T016), 2026-08-12

The three preconditions above were the whole of what promotion owed. This
section records what was done about each, what was measured, and the two things
promotion changed that the canary did not anticipate.

## The promoted release is a SUCCESSOR, and it had to be

Precondition (a) forbids promoting the canary's renderable subset. A release is
immutable and its renderable subset is baked into its snapshot, its 126 cell
releases, its assembly package and every asset checksum, so "ship different
cells" is not an edit an immutable release can absorb. The promoted bytes are
therefore `manhattan-lower-manhattan-cells-20260812-p1`, built by the same wave
CLI from the same immutable plans, on the Midtown-core V3 successor mechanics:
same wave, same wave-scoped ownership ledger
(`ownership-ledger:manhattan-lower-manhattan-cells-20260812:44ec889a556ece19`,
unchanged), same two hash domains from the closed-table registry, new release
id, predecessor pinned by the canary's own committed inventory checksum.

"The same immutable plans" is checkable rather than asserted: the release id is
not an input to any plan hash, and the P1 wave profile differs from the canary's
in the `releaseId` field and in nothing else — `lower-manhattan-curation.test.ts`
diffs the two profiles and requires exactly that one key. The P1 plans stage
reproduced the canary's plan census byte for byte: 6,298 planned, 127 refused,
identical per-cell and per-building refusal lists.

The canary keeps every byte it had. It was rebuilt through the refactored CLI as
a regression and its committed inventory, derivation and wave census came back
identical. The one thing that did move, and was reverted, is recorded below.

## (a) — an explicit CURATED subset, recorded as curation

Promotion took the ADR's **second** option. `lower-manhattan-curation.ts` states
the subset as a list with a written reason per cell, and
`LOWER_MANHATTAN_CURATION_STATEMENT` says in terms that visual priority for the
promoted subset is a stated property whose value is that list, not a
re-derivation of the ledger order under a new name.

| cell | full-city order | owned | materialized | refused |
| --- | --- | --- | --- | --- |
| `manhattan-exterior-cell-w02-000160-16-19294-17945` | 160 | 32 | 32 | 0 |
| `manhattan-exterior-cell-w02-000157-16-19294-17944` | 157 | 40 | 39 | 1 |
| **total** | | **72** | **71** | **1** |

The two cells are vertically adjacent and share their full east–west extent, so
the promoted subset renders as one contiguous column over the World Trade Center
site rather than two textured islands. Cell 157 owns the tallest sourced
structure in the entire wave at 429.3 m, 105.0 m taller than anything else `w02`
owns; cell 160 owns the wave's second and third tallest at 324.3 m and 298.2 m.
Those are sourced `heightMeters` of the pinned citywide base and nothing more —
the NYC OTI footprint dataset carries no building names, its `name` field is the
literal string `Building <id>`, so no rationale here identifies a building by
name and none is implied. The place names are geographic: the cell bounds
provably cover that ground.

The choice is also the OPTIMUM, computed rather than asserted. Over every
combination of Financial District cells that fits the 72-entry budget, the pair
(157, 160) is the unique maximum at 71 materialized assets; the next best is a
single cell at 65. Every gate that could make this curation false — a cell the
ledger does not own, a cell whose bounds leave the stated Financial District
envelope, a cell the canary already shipped, a subset that overflows the budget —
refuses the build, and each refusal is exercised by test.

Cells 150 and 151 are not reused, and the drift gate proves the two renderable
sets are disjoint from the two releases' own committed inventories.

## (b) — a local refusal rate near the wave rate

**1 refusal in 72 owned buildings: 1.39%**, against the 2.09% wave rate and the
canary's 34%. The distance from the wave rate is a fortieth of the canary's. The
single refusal is `doitt:602678`, whose sourced ring carries more than the 64
distinct vertices the V3 grammar supports; it ships as an explicit unavailable
detail naming that refusal, is outside the accepted membership, and no tolerance
was moved to admit it.

The ceiling the gate enforces is 4.18%, twice the wave rate. It is stated as a
ceiling rather than as a distance because the defect the precondition names is a
promoted set that refuses a third of what it owns; refusing *less* than the wave
does is not that defect.

## (c) — measured OFF the vsync floor, with GPU memory named

The canary's evidence was a floor test and said so. This measurement is not, and
it proves it rather than claiming it.

**The control is a second browser, not a blank page.** The first attempt spun the
same rAF loop on an empty page in the same uncapped Chrome, on the theory that an
empty page would read the present interval. It read 18 ms — slower than every
loaded station — because Chrome throttles rAF on a page with nothing to draw. It
would have been published as a vsync reading. The control that answers the
question is the same station in a second Chrome launched **without**
`--disable-gpu-vsync --disable-frame-rate-limit`.

**Capped control: p50 8.30 ms.** That is the 120 Hz present interval, and it is
exactly the floor the canary was pinned to. Every station below sits far under
it, so these are headroom measurements.

Measured over 3 repeats × 240 timed frames after a 180-frame settle, at 1280×800,
on the promoted composition — Block 835 V3, Midtown-core V3 and the P1 successor
streaming together over the pinned citywide base:

| station | profile | p50 | p95 | worst frame | budget p50/p95 | p50 used | JS heap after GC |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `fidi-facade` | inspection | 3.6 ms | 9.7 ms | 73.3 ms | 33.3 / 45 | 11% | 185.8 MB |
| `fidi-street` | exploration | 3.6 ms | 9.3 ms | 39.7 ms | 16.7 / 25 | 22% | 183.6 MB |
| `harbour-skyline` | exploration | 3.3 ms | 9.0 ms | 39.3 ms | 16.7 / 25 | 20% | 181.6 MB |
| `midtown-cross` | exploration | 1.5 ms | 3.9 ms | 15.9 ms | 16.7 / 25 | 9% | 146.9 MB |

Every p50 and every p95 is inside its budget with large margin. **The worst
single frames are not**, and that is stated rather than smoothed: isolated frames
of 39–73 ms occur at the Financial District stations. They are single outliers in
720 timed frames per station, they sit after the settle window, and this record
does not claim to have attributed them. What the p95 shows is that they are rare;
what the maximum shows is that they exist.

**GPU texture memory is NAMED and COMPUTED, not measured.** Following the ADR
0032 precedent: the shipped subset embeds 213 images (3 per GLB × 71 assets), all
128×128, so decoded at RGBA8 with a full mip chain the arithmetic is
`128 × 128 × 4 × 1.33 × 213` = **17.71 MiB** (13.31 MiB before mips). Every term
is stated in the evidence file, including that the count is NOT deduplicated
across models — the catalogue has four motifs, but each GLB is its own glTF and
CesiumJS uploads per model, so an all-resident scene holds one upload per
embedded image and deduplicating would understate the ceiling. The other two
promoted waves are texture-free, so this is the whole of the composition's
texture memory. It is an upper bound and it is arithmetic. No instrument
reachable from this session reports texture VRAM, `usedJSHeapSize` does not stand
in for it, and neither this ADR nor the committed evidence claims a measurement.

**Cache residency, worst observed: 243 entries and 62.0 MiB**, against the
256-entry and 256 MiB runtime caps. It is DERIVED from the per-release network
measurement — one fetched GLB is one LRU entry — rather than read from the cache
counter, because that counter only reaches the DOM in a `VITE_BLOCK835_PROBE`
build and this measurement is deliberately against the ordinary production
preview a user gets. **Zero external hosts** were contacted in any capture.

### The entry budget was conservative, and here is by how much

The release-time budget of 72 counts GLB *files on disk* for the promoted waves:
28 for Block 835 V3, which ships two LODs per building, and 156 for Midtown-core
V3, which ships one. At runtime the session fetched **14** Block 835 GLBs,
because only the selected LOD is requested. The derivation therefore reserved 14
more entries than Block 835 occupies. That is conservative, not wrong — it made
the promoted subset smaller than it strictly had to be — and the curated subset
fits under either count.

## Rollback semantics: this wave rolls back to BASE MASSING

Block 835 and Midtown-core each roll back to a previously promoted release,
because each has one. Wave `w02` does not. Its only other release is the T015
canary, which was pinned but never a default, and there is no untextured `w02`
release at all. So `LOWER_MANHATTAN_EXTERIOR_ACTIVATION.predecessor` is the
DISABLED base-only record — the T010 shape — and rolling this wave back returns
its area to the pinned base massing. A reader looking for "the older
Lower-Manhattan exterior" will not find one, because there is not one.

Two consequences are recorded because neither is obvious:

- The rollback names the **P1 successor** as withdrawn, so promotion-era
  `?exteriorCells=manhattan-lower-manhattan-cells-20260812-p1` bookmarks fail
  closed in the same single record swap.
- It deliberately does **not** name the canary. That release was never promoted,
  its opt-in link is not a promotion-era bookmark, and it stays reachable exactly
  as it was before this promotion and after a rollback of it. A browser journey
  confirms the canary link still resolves to the canary alone, streaming its 41
  assets and no P1 asset.

Block 835 and Midtown-core keep streaming through a `w02` rollback; the per-record
rules were already per-wave, and the rehearsal exercises that through the
record's own injection seam.

## The stated gap closes, for the successor only

ADR 0034's consequences recorded that `verifyPromotedExteriorPin` does not run
for the canary, because that check reads the promotion record and the canary has
no entry there, and named closing it as promotion's job. **The P1 successor has
an entry, so both the pin gate and the identity gate now run for it on every
load.** The canary keeps its narrower guarantee, because it is still only an
opt-in and still has no promotion record. The gap was closed for the promoted
release; it was not closed for the canary, and the comment in
`PINNED_EXTERIOR_CELL_RELEASE_IDS` says exactly that.

## Two things that went wrong, kept because they are worth naming

**The inventory schema nearly moved a frozen byte.** Adding the `curation` field
to the payload inventory first emitted `"curation": null` for the canary too. The
canary's committed inventory is frozen bytes and its checksum is what the P1
predecessor pin is taken over, so the extra key moved both. The canary
regression caught it. The field is now spread in only for a release that has a
curation, and a release that derived its subset from the ledger order carries no
curation record at all — which is also the truer statement.

**The first cold-load journey failed on a sampling mistake, not a defect.** It
asserted all 71 `w02` assets had been fetched at the instant the third wave went
active, and read 7: the loader is progressive and wave activation is not asset
completion. The journey now waits for the fetch count to reach its shipped total
or stop growing, so the claim is about what the session streams rather than about
when it was sampled.
