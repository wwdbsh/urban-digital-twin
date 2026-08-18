# ADR 0058 — The far-tier bake: a textured prism, its own budget, and one honest miss

Date: 2026-08-18
Task: T002 (Goal `manhattan-hlod-far-tier`, Issue #102)
Branch: `fcp/102-bake-prototype`
Status: Accepted for the prototype. **The appearance bar is MISSED at one pose and the
mass bake is BLOCKED pending a user decision.**
Evidence: `data/far-tier-hlod-20260818/` (`stage0-hierarchy.json`,
`bake-pre-registration.json`, `prototype-provenance.json`, `sampling-results.json`,
each with a `.sha256`)

## Context

The goal replaces the untextured tan massing tier with a far tier that carries the
generated facade appearance. The question this ADR settles is what that far tier
actually *is*.

The obvious answer — merge each cell's shipped `lod_1` assets into one tile — was
costed and refused before this task began. The island ships 80,253,286 triangles
across `lod_0`+`lod_1` (`data/citywide-overview-census-20260814/wave-bytes.json`).
The coarse prism tier is 1,696,292. That is a factor of forty-seven, and no texture
saving recovers it.

## Decision

### 1. The far tier is the coarse prism plus a baked facade atlas

Geometry is the sourced outer ring extruded from grade to the sourced height, roof
cap only — byte-for-byte the representation
`data/citywide-overview-census-20260814/coarse-tier.json` already measured. What is
new is that it carries a per-cell baked atlas instead of one flat designed grey.

**The silhouette cost is real, it is large, and it is its own error class.** The
census measured this prism against the massing it replaces at a median deviation of
0.045221, a p95 of 0.248387 and a maximum of 0.628806, with only 48.19% of buildings
inside 2%. **ADR 0050's 2% cap does not cover this and the far tier must never
declare it.** Setbacks, tier insets and rooftop groups are filled in solid. On the
prototype cell the source massing reaches 40.17 m and the prism 36.58 m; that 3.59 m
of missing rooftop is visible in every still.

### 2. Composition is analytic, on the CPU, in linear light

The `factor x tile` multiply the shipped assets perform at render time is performed
once, at bake time, and written into the atlas.

**Gamma, settled before any byte was baked.** glTF decodes a base-colour texture from
sRGB before multiplying it by a linear factor. So:

```
linear[c] = factor[c] * srgbToLinear(tileTexel / 255)
atlas[c]  = round(255 * linearToSrgb(clamp(linear[c], 0, 1)))
```

consumed with `baseColorFactor = [1,1,1,1]`. The naive encoded-space multiply is
rejected by name; a test proves the two differ by more than ten 8-bit levels in the
midtones. What this deliberately does **not** fix: the repository derives factors from
hex by dividing by 255 with no decode, putting an sRGB-ish number in a linear slot.
Reproducing that is correct for a bake whose job is to match the shipped appearance.
Correcting it would make the far tier disagree with the near tier.

**Sampling.** `NEAREST` names the *reconstruction* — the tile is piecewise constant
over its texel grid, no interpolation. It does not mean one tap per destination texel:
a brick module is 800 x 268 mm against a ~1.4 m far-tier texel, so a single tap
returns an arbitrary coursing phase and the wall reads as noise. Aggregation is the
**exact area-weighted integral** of that reconstruction over the texel's source
footprint, in closed form from a summed-area table with periodic decomposition. There
is no sample-count parameter to tune.

**Blender is validation only.** It is never on the bake path and has no way to
influence a byte.

### 3. The resolution ladder is derived, and it is bounded

Texel sizing is stated against a reference viewport — 1440x900, 60 degree vertical
field — using the arc form `d * fov / H`. That gives 0.4654 m/px at 400 m against the
tangent form's 0.5132, so it asks for *finer* texels and is conservative in the
quality direction.

The far tier begins at **1,200 m**, which is not a new number: it is where the shipped
detail radius stops. Atlas edges are powers of two in **[64, 256]**. The ladder is
the ledger's own quadtree — cell ids already carry tile coordinates at zooms 14-18 —
so the hierarchy is adopted, not invented. A parent covers 4x the area at 2x the
texel size, so texel count per node is constant across levels and only the node
*count* falls with distance.

### 4. The far tier gets its OWN budget contract

`far-tier-hlod-gpu-budget-v1` is deliberately **not** folded into the closed 256 MiB
criterion #30. That criterion was frozen against a measurement this tier did not exist
for; adding to a closed criterion would silently reopen it. The two are added when a
total is needed, never merged.

| Bar | Value |
| --- | --- |
| B1 atlas edge | power of two in [64, 256] |
| B2 per tile | 349,525 GPU bytes (256² x 4 x 4/3) |
| B3 resident texture | 291,984,434 B (278.5 MiB) |
| B4 resident geometry | 98,310,624 B (93.8 MiB) |
| B5 resident total | 390,295,058 B (372.2 MiB) |

**B3–B5 bound ONE SELECTED CUT** — the instantaneous, steady-state residency of the
antichain a pose selects. They are *not* a peak bound for a streaming runtime.
Transitional double residency (holding an outgoing node while its replacement uploads),
retained eviction caches, and upload staging are all **outside** the bound and become
named T003 constraints; an integration doing any of them must state its own peak on top.

**They are bounds, not sampled maxima, and that distinction cost a correction.** An
earlier version of this ADR took the maximum of a 13×13 camera sweep and called it a
figure never exceeded at any pose. It is not: a sampled grid can only *miss* a peak,
never invent one, so refining it kept finding worse poses — 133,190,868 atlas bytes at
12 steps creeping to 136,686,118 at 192 — and never converged. The claim that "every
conservatism enlarges the bound" was also wrong: grid coarseness shrinks it.

The committed values come instead from a theorem about the tree. Every camera pose
selects some **antichain** of nodes, minus whatever the 1,200 m boundary excludes, and
excluding only subtracts — so the maximum over all antichains dominates every pose, and
that maximum is one bottom-up pass: `maxCut(node) = max(cost(node), Σ maxCut(children))`.
"All leaves resident" was considered as a simpler bound and **rejected**: 3 internal
nodes of this tree cost more than their children, because of power-of-two rounding and
the 64-texel floor.

The 256 ceiling is chosen against the same bound computed at other ceilings: **72.2 MiB
at 128, 278.5 MiB at 256, 640.0 MiB at 512, 861.7 MiB at 1024.**

**The ceiling also decides feasibility, not only sharpness.** Every face costs at least
`(faceTexelFloor + 2·gutterTexels)² = 64` texels however far resolution is reduced, so an
atlas has a fixed maximum face count. Measured with the **real packer** over all 883
cells, the cells that cannot be baked at any scale are:

| ceiling | cut-independent atlas bound | unpackable cells | of which atlas < ceiling |
| --- | --- | --- | --- |
| 128 | 72.2 MiB | 774 | 2 |
| **256** | **278.5 MiB** | **172** | 16 |
| 512 | 640.0 MiB | **57** | 57 |
| 1024 | 861.7 MiB | **57** | 57 |

**Raising the ceiling does not fix this**, and an earlier version of this ADR wrongly
said a 512 ceiling removed the limit entirely. That came from *estimating* infeasibility
as `faceCount > ceiling²/64` — the same 100%-utilisation idealisation B6 had just been
corrected for. The mechanism is structural: **atlas edge is chosen from a cell's surface
area, not from the ceiling**, so a low-area, high-face-count cell keeps a small atlas
however high the ceiling goes. At 512 and 1024 *every* surviving cell already has an
atlas below the ceiling, so more ceiling cannot reach it.

The remedies that actually bite are: a smaller gutter (costs mip-level-1 bleed), a lower
texel floor (costs aliasing), splitting leaves below the ledger cell, or **decoupling the
per-cell atlas floor from surface area** so a face-dense cell can be granted a larger
atlas than its area earns — the only one that targets the measured mechanism. T004 must
choose; this prototype does not.

### 5. ADR 0047's no-atlas finding is reversed FOR THE FAR TIER ONLY

ADR 0047 refused an atlas because the near tier's maximum observed |UV| is 1210.1 and
an atlas cannot repeat. The far tier bakes the repetition *into* the patch at far-tier
resolution, so its UVs are inside [0,1] by construction and the repeat problem does
not arise. **ADR 0047 continues to govern the near and mid tiers unchanged.**

### 6. T006's G2 bar is superseded BY STATEMENT, for the far tier only

G2 counted shared 128px class tiles bound once per release, where 24 co-resident tiles
is the whole budget. Far-tier atlases are per-cell derivatives of different size, count
and lifetime. **G2 is not regenerated**;
`data/exterior-acceptance-20260817/pre-registration.json` and its checksum
`132adaf5…` are untouched, and a test asserts they still reproduce.

### 7. Rights travel with the derivative

The tile is a derivative of retention-only assets. **The narrower envelope travels.**
Retention and local display only; no publication, no redistribution, no public
conveyance. Baking does not widen an approval envelope.

## What was measured

**Byte replay: PASS, across processes.** The parent run and a fresh **child process**
both produced `2f8599256ac45ee509dc7d7ce0da6a56964bac8e3ca66b77e795c1435ff7930b` (GLB)
and `c159e0508aeb7522620b799b83041461aecf34727f69209bd7efbf992f5c067a` (atlas). The
child process matters: this module memoizes the tile integrator and the texture
catalogue, so a same-process repeat would exercise the caches rather than the
computation.

**Source provenance: PASS, and proved rather than asserted.** The `-c2` payload bytes
are gitignored and absent from this machine. All 96 of the prototype cell's assets
were regenerated from the pinned base snapshot through the shipped emitter and every
one reproduced its committed `-c2` inventory checksum byte for byte before anything
was baked or rendered.

**Hue: PASS at all six poses**, channel spread 0.0060-0.0160 against a 0.02 bar. This
settles that the gamma decision and the palette lookup are correct.

**Silhouette (reported, not barred):** IoU 0.9715-0.9799. The prism covers *more* at
every pose — the setback fill, seen directly.

## THE MISS

**Tone bar `|unionMeanLuminanceRatio - 1| <= 0.05`: MISSED at 1 of 4 barred poses.**
1,200 m / azimuth 235 measured **1.0728**, an excess of 0.0228. This was measured
**twice** — once on the pre-fix bytes and again, after independent review required the
frozen evidence to describe the shipped bytes, on the committed tile `2f859925…` under
the unchanged instrument. Both captures return **1.072801**; union and intersection
pixel counts, IoU and channel spreads are identical, and no ratio moved by more than
1e-06. **The MISS is a property of the tier, not of a build.** The other three barred
poses passed at 1.0130, 1.0136 and 1.0198. The baked tile measures brighter than the
source at **every** pose without exception; the sign is consistent and is not noise.

The diagnosis — which explains the miss and does **not** retract it — is that azimuth
235 is the shadow side. Mean source luminance there is ~0.039 against ~0.210 on the
lit side, while the *absolute* luminance delta is essentially azimuth-independent
(0.002732 lit against 0.002871 shadowed at 1,200 m). The same absolute error over a
five times smaller denominator is the whole of the miss. Mechanically: the prism has
no recesses, so it self-shadows less than the source massing, and that matters most
where nearly all the light is indirect.

The intersection measure would have passed all four barred poses. **It is not
substituted.** Swapping to the friendlier of two pre-declared measures after seeing the
numbers is exactly what pre-registration exists to prevent.

**Consequence: the pre-registered stop rule is invoked and the mass bake is blocked.**
Fork options for the user are enumerated in `sampling-results.json`.

## Known shortfalls, stated rather than buried

1. **B6 was pre-registered as already missed, and by more than first stated.** Measured
   against the *ideal* ladder — a 100%-full atlas, which no packer achieves — it is 360
   of 883 leaves (40.8%). Measured against **the resolution the packer actually
   delivers**, it is **650 of the 711 packable leaves (73.6% of all cells)**, worst
   delivered ratio **0.044**, plus **172 cells that cannot be packed at all**. Packing
   overhead — gutters and shelf waste — is the dominant term, not a correction to it.
   The prototype cell itself packs at scale 0.5, i.e. half the intended sharpness.
2. **The hierarchy does not reduce geometry residency at all.** A parent is the
   concatenation of its children's prisms, not a simplified massing, so coarsening the
   cut moves texture bytes and leaves geometry bytes alone. Affordable at 93.8 MiB;
   parent-node simplification is a prerequisite for any larger city.
3. **84.8% of the prototype cell's faces fell to flat average colour.** At the applied
   texel size a face needs ~11 m on both axes to earn interior detail. **The far tier
   delivers the generated palette and the base/shaft tone split, not visible
   coursing**, and must not be described as carrying facade pattern.
4. **The gutter is expensive.** Two-texel gutters around 764 faces forced a global
   resolution scale of 0.5 on the prototype cell.
5. **`Math.pow` is the one primitive whose cross-engine bit-exactness is not
   contractually guaranteed.** Replay is proven cross-process on the pinned toolchain;
   cross-engine is not claimed. `Math.hypot` has been removed from every byte-producing
   path in favour of `Math.sqrt`, per `block835-v3-package.ts`'s own policy.
6. **The appearance readings were re-taken against the committed bytes**, on
   adjudication that frozen evidence must describe what shipped. The instrument was not
   altered in any respect. Both captures are retained in `sampling-results.json`, the
   superseded one under `supersededCapture`, so the re-capture can be checked rather
   than trusted. The measured difference between them is at most 1e-06 in any ratio,
   which confirms — after the fact, as predicted before it — that the
   `Math.hypot` → `Math.sqrt` fix had no appearance consequence.

## What this ADR does not decide

Runtime integration (T003), the mass bake (T004) and serving promotion (T005). It also
makes no visual-acceptance claim: **agreement is not likeness**, and a luminance ratio
near 1.0 says the tile puts roughly the same light on screen, not that it looks right.
