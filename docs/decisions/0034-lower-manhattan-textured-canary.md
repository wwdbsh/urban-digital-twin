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
