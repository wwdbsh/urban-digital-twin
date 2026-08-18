# T002 — the far-tier bake prototype

Date: 2026-08-18
Task: T002 (Goal `manhattan-hlod-far-tier`, Issue #102)
Branch: `fcp/102-bake-prototype`
Decision record: [ADR 0058](../decisions/0058-far-tier-bake-architecture.md)
Evidence: `data/far-tier-hlod-20260818/` (`stage0-hierarchy.json`,
`bake-pre-registration.json`, `prototype-provenance.json`, `sampling-results.json`,
each with a `.sha256`)

This is the honest history, including the parts that went wrong and the one bar that
was missed. A record showing only the green would misrepresent how this arrived.

## What shipped

| Path | Purpose |
| --- | --- |
| `src/release/far-tier-bake.ts` | The frozen recipe, the exact periodic tile integrator, face enumeration, declared packing order, atlas rasterization, geometry emission |
| `src/release/far-tier-budget.ts` | Resolution ladder and GPU budget contract; pure and testable |
| `src/release/procedural-texture.ts` | `encodeRgbPng` added beside `encodeGrayscalePng` |
| `scripts/far-tier-stage0-cli.mjs` | Derives the hierarchy; emits the pre-registration |
| `scripts/far-tier-bake-cli.mjs` | `bake`, `replay`, `sources` |
| `src/release/far-tier-bake.test.ts`, `far-tier-budget.test.ts`, `scripts/far-tier-records.test.mjs` | 64 colocated tests |

## The thing that nearly stopped the task on day one

**The `-c2` payload bytes are not on this machine.** `public/data/` is gitignored and
contains no `-c1` or `-c2` directory. The task contract asks for provenance naming
"per-source-GLB sha256", and the obvious reading — read the GLBs, hash them — was
impossible.

What made it work is that the emitter is deterministic. The cell's assets were
regenerated from the pinned base snapshot through `materializeMidtownCoreV3Cells` and
compared against the committed `-c2` `payload-inventory.json`. The first attempt
matched **14 of 28** on block 835: every `lod_0`, no `lod_1`. The cause was the `-c2`
re-emission profile — `-c2` copies `lod_0` from `-c1` byte for byte and re-emits
`lod_1` with `textureLevels: "both"`. Adding that flag took it to **28 of 28**, and on
the prototype cell to **96 of 96**.

That turned a blocker into a stronger result than reading bytes would have been: the
provenance record does not merely *cite* checksums it read, it *proves* the bake
derives from the computation that produces exactly those bytes. A mismatch stops the
run.

Two traps found on the way, both of which silently produce plausible-but-wrong bytes:

- The retention pipeline hashes a **compact re-serialization** of the base manifest
  (`65e8fbee…`), not the file bytes (`acb5a9b5…`). That value enters every plan hash.
  Both are now recorded so neither can be mistaken for the other.
- The emission profile keeps the **`-c1`** release id even when producing `-c2`
  content, because the GLBs embed it in `inventoryId` and `evidenceShardId`.

## Where the frozen plan met evidence that contradicted it

**Sampling filter.** The plan froze "sampling filter = nearest". Taken as one tap per
destination texel that is wrong here: a brick module is 800 x 268 mm against a ~1.4 m
far-tier texel, so a single tap returns an arbitrary coursing phase and the wall reads
as noise rather than masonry. Rather than redesign or comply blindly, the constant was
kept and its meaning made precise: NEAREST is the *reconstruction* (piecewise
constant, no interpolation between tile texels), and aggregation is the exact
area-weighted integral of that reconstruction, computed in closed form from a
summed-area table with periodic decomposition. Same constant, no sample-count
parameter, and exactly periodic.

**Grayscale encoder reuse.** The plan said to reuse `encodeGrayscalePng`. A grayscale
image cannot carry the per-face hue the bake collapses into the texture, and the
plan's own ~11 MiB residency illustration is only consistent with RGBA8 plus a mip
chain. `encodeRgbPng` was added under the identical discipline — filter 0, stored
DEFLATE, no ancillary chunks — and the closed four-class grayscale catalogue gate is
untouched.

**Illustrative numbers were not adopted.** The plan's "256² leaves for ~32 resident
cells, ~11 MB" and "parents 128²" were treated as illustration, per its own
instruction to derive from real arithmetic. The derived answer is a constant 256
ceiling with a swept worst case of 220.8 MiB — an order of magnitude larger, because
the sweep counts a full cut with no frustum culling and no occlusion.

## What went wrong in the instrument, and was caught

The first Blender import placed the source assets by applying the glTF Y-up
translation directly to Blender's Z-up `location`. Bounds disagreed wildly
(source Z spanning −151 m). The fix is the importer's own mapping,
glTF `(x,y,z)` → Blender `(x, −z, y)`. After it, source and baked bounds agree
**exactly** in X and Y, and differ in Z by 3.59 m — which is not an error but the
prism's missing rooftop groups, visible in every still.

Had that gone uncaught it would have produced a confident, precise, meaningless
agreement number.

## Results

**Byte replay: PASS, across processes.** `2f859925…` (GLB) and `c159e050…` (atlas) from
the parent run and from a fresh child process.

**Hue: PASS at all six poses**, spread 0.0060-0.0160 against 0.02. This is the reading
that settles the gamma decision: a linear-light composition error would show as a
channel spread and does not.

**Tone: MISS at 1 of 4 barred poses.** 1,200 m / azimuth 235 measured 1.0728 against a
0.05 bar. The pre-registered stop rule was invoked; the bake was **not** tuned.

Measured twice. The `Math.hypot` fix moved the tile's bytes after the first capture, so
on adjudication the instrument was re-run — unchanged in every respect — against the
committed tile `2f859925…`. Both captures return **1.072801** at the missing pose, with
identical pixel counts, IoU and channel spreads and no ratio moving by more than 1e-06.
Both are retained in the record; the first is filed under `supersededCapture` rather
than deleted, so the re-capture is checkable instead of merely asserted.

The diagnosis is that azimuth 235 is the shadow side, where mean luminance is ~0.039
against ~0.210 lit, while the absolute delta is azimuth-independent (0.002732 against
0.002871 at 1,200 m). The prism self-shadows less because it has no recesses. That
explains the miss and does not retract it. The intersection measure would have passed
all four and is deliberately **not** substituted.

## The finding that most changes how this tier should be described

**84.8% of the prototype cell's 764 faces fell to flat average colour.** At the applied
texel size a face needs roughly 11 m on both axes to earn interior detail, and most
Manhattan wall segments are shorter.

The far tier therefore delivers the **generated palette and the base/shaft tone
split** — per building, per material zone — and **not visible coursing**. The goal's
framing ("every visible building renders with generated facade appearance at every
camera distance") is satisfied in tone and not in pattern, and saying so now is
cheaper than having it discovered on screen after a mass bake.

Two things drive it: the 2-texel gutter, which costs ~3x on small faces and forced a
global resolution scale of 0.5 on this cell; and the 256 ceiling.

## What independent review caught, after the first commit

Three quantitative claims did not hold, **all erring in the flattering direction**. They
are worth recording because each is a different way to be wrong with correct arithmetic.

1. **A sampled maximum was presented as a bound.** B3/B5 came from a 13×13 camera sweep
   and the record said the figures are never exceeded at any pose, and that every
   conservatism enlarged them. Both false: a grid can only *miss* a peak. Refining to
   24, 48, 96 and 192 steps kept finding worse poses and never converged, so the sweep
   cannot supply a bar at all. Replaced by an exact max-over-antichains DP —
   291,984,434 / 390,295,058 B, roughly **1.7× the figure first committed**. The
   tempting simpler bound, "all leaves resident", is *not* a bound: 3 internal nodes
   cost more than their children.
2. **The resolution ladder assumed a 100%-full atlas.** No packer achieves that, and the
   one baked cell had already shown a 0.5 scale. Running the real packer over all 883
   leaves moved B6's shortfall from 360 cells to 650 of 711 packable ones — and
   surfaced something the ideal ladder could not: **172 cells cannot be packed at any
   scale**, because the texel floor plus gutter caps an atlas at 1,024 faces. That is a
   feasibility blocker for T004, not a quality note, and it was invisible until the
   real packer ran.
3. **The prototype record reported pre-packing quality.** It stated ratio 1.102 and
   `underResolved: false` beside `appliedScale: 0.5`. The delivered ratio is 0.500 and
   the true critical distance 2,400 m — so the tile violated the very bar (B6) whose
   whole purpose is to force under-resolved leaves to be reported.

Also fixed: `Math.hypot` removed from byte paths (the repository's own policy, stated in
`block835-v3-package.ts`, and previously not followed here); the flat-face predicate is
carried from the packer rather than re-derived, which had mislabelled legitimately 4×4
faces; and the replay's second run now spawns a **child process**, which is what the
code comment had claimed all along while both runs shared one process and its caches.

The `Math.hypot` fix moved the tile's bytes, which briefly left the appearance readings
describing a superseded digest. I flagged that rather than deciding it, on the view that
re-running an instrument after seeing a MISS is what pre-registration exists to prevent.
The adjudication went the other way — frozen evidence must describe the shipped bytes —
and it was right: re-capturing under the unchanged instrument reproduced the MISS to six
decimals and turned a disclosure into a measurement. Both captures are retained.

## What a second review round caught

Three more, and the pattern repeated: a correction can carry its own flattering error.

1. **The per-ceiling feasibility column was an estimate wearing a measurement's name.**
   Having just corrected B6 for assuming a 100%-full atlas, I estimated infeasibility per
   ceiling as `faceCount > ceiling²/64` — the *same* idealisation — and published "a 512
   ceiling removes that limit entirely". The real packer says 774 / 172 / 57 / 57 at
   128 / 256 / 512 / 1024. **Raising the ceiling never gets below 57**, because atlas
   edge comes from surface area, not from the ceiling: a low-area, high-face-count cell
   keeps a small atlas however high the ceiling goes, and at 512+ *every* survivor is
   such a cell. The estimate is gone; the packer runs at each ceiling.
2. **"Never exceeds at any camera pose" over-claimed.** The theorem bounds one
   antichain's cost. A streaming runtime holding an outgoing node while its replacement
   uploads, or retaining evicted atlases, exceeds it momentarily. B3–B5 are now qualified
   as instantaneous steady-state bounds over the selected cut, with double residency,
   eviction caches and upload staging named as T003 constraints outside them.
3. **The pre-registration's status line still said it predated the bake.** True of the
   appearance instrument, false of the budget bars, which were amended afterwards. An
   `amendments` block now names exactly what moved and what did not — and the claim that
   the instrument never moved is *verified*, not asserted: its section hashes identically
   across all four commits of that record.

### A near-miss worth recording

Qualifying the bound by adding a `boundKind` field to `FAR_TIER_BUDGET_CONTRACT` moved
the contract hash — which every baked tile embeds in `extras.urbanDigitalTwin` — and so
silently rewrote the committed tile's bytes, invalidating the appearance capture taken
against them. Caught by the instructed digest check before commit, not by intent. The
qualification now lives outside the hashed object, and `farTierBudgetContractHash()` is
pinned to a literal so this cannot recur quietly. **Documentation about how to read a
bar must never be able to invalidate an artifact that is already correct.**

## Residuals and NOT-METs

1. **NOT MET — tone bar** at 1,200 m / azimuth 235. Mass bake blocked pending a user
   fork; four options are enumerated in `sampling-results.json`.
2. **NOT MET, and pre-registered as such — B6.** Against delivered resolution: 650 of
   711 packable leaves under-resolved, worst ratio 0.044; a further **172 cells cannot
   be baked at this ceiling at all**. The ideal-ladder figure of 360 is retained only so
   the packing penalty is visible as the difference.
3. **The hierarchy does not reduce geometry residency.** Parent nodes concatenate
   rather than simplify. 93.8 MiB, bounded and affordable; a prerequisite for any
   larger city.
3b. **57 cells cannot be baked at ANY atlas ceiling** without changing the gutter, the
   texel floor, the leaf size, or decoupling atlas size from surface area. This is a
   hard T004 blocker and no ceiling choice resolves it.
4. **`Math.pow` cross-engine bit-exactness** is not contractually guaranteed. Replay is
   proven cross-process on the pinned toolchain only.
5. **One cell.** Its IoU of 0.971-0.980 is better than the island median deviation of
   0.045221 and must not be read as typical.
6. **Occluded faces are baked.** The bake has no visibility information; inventing some
   would be a claim this task cannot support. It is pure cost, not error.

## What was deliberately not touched

T006's G2 record and checksum; `AUDITED_WORKING_RECORD_DIRECTORIES` (no entry added,
so the far-tier directory is invisible to `pnpm showcase:audit` — deliberate, and the
alternative would move a committed audit checksum); the `-c1`/`-c2` inventories. A test
asserts all three still reproduce.
