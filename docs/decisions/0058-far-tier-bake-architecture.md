# ADR 0058 — The far-tier bake: a textured prism, its own budget, and one honest miss

Date: 2026-08-18
Task: T002 (Goal `manhattan-hlod-far-tier`, Issue #102)
Branch: `fcp/102-bake-prototype`
Status: Accepted for the prototype. **As written, the appearance bar was MISSED at one
pose and the mass bake was BLOCKED pending a user decision. BOTH HAVE SINCE MOVED —
see the T013 amendment (adopted gate set, `A3'' = 0.035`) and the T004 amendment
(recipe `v4` adopted, island baked at 840 tiles). This header is the T002 status and
is kept as written rather than edited, because the amendments below are the record of
what changed.**
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

---

## Amendment — T012: the appearance instrument is pinned, and the supersession chain

Date: 2026-08-18 · Task: T012 (Issue #116) · Branch: `fcp/116-instrument-pin`
Evidence: `data/far-tier-hlod-instrument-20260818/`

Everything above about GEOMETRY, PACKING, GAMMA and BUDGET stands unchanged. What
changes is the standing of every **appearance** number this ADR and its successors
quoted.

### The supersession chain, in order

1. **T002** captured the prototype tile and recorded a tone MISS at 1,200 m /
   azimuth 235 (ratio 1.072801) and a hue PASS at 6 of 6 poses.
2. **T010** measured the same tile at 0.03957 where T002 had 0.042303, and
   attributed the ~6.5% gap to a difference of masks.
3. **T011** used T002's own union mask, reproduced its pixel count exactly, and
   still measured 0.0395 — excluding the mask explanation — then halted.
4. **T011 re-baselined** under isolated subjects and reproduced T002's *source*
   bit-exactly while its *baked* reading sat 6% low — which is what excluded the
   mask explanation and forced the attribution work.
5. **T012 attributed it.** T002 held both subjects in the scene and toggled
   `hide_render` per render. Because every arrangement's ratio divides by the
   isolated source mean, and T011 reproduced T002's source bit-exactly under
   isolation, the arrangement was necessarily **asymmetric in consequence**: the
   source was measured effectively alone, while the baked subject was measured
   with 48 hidden source meshes resident. **Scene residency moves the reading by
   +7.0%.** That arrangement B (1.088509, hidden companion not casting shadows)
   exceeds A (1.072801) shows the hidden meshes were casting shadows onto the
   measured subject; beyond that the **mechanism is not traced** into EEVEE's
   internals, and with ray tracing and fast GI off and the world at strength zero
   there is no obvious indirect-light path for the remainder. Reproducing the
   arrangement returns **1.072801** — T002's committed value to six decimals.
   Isolating returns **1.002152**.

**T002's baked-tile readings and both its verdicts are therefore SUPERSEDED BY
STATEMENT.** Its record is not edited. T010's admissible band and predicted MISS,
and T011's 5.32 attribution gate, all descend from the superseded figure and are
not current.

### What is now pinned

`src/release/far-tier-instrument.ts` carries the spec — Blender version,
engine, ray tracing, fast GI, sample count, filter size, the full colour-management
chain, output format and depth, camera, sun, world, **user preferences**, mask
semantics and **subject isolation**. The capture harness is **generated from that
spec** and reads every value back out of Blender immediately before capture,
failing closed on any mismatch. **Nine of nine** deliberate perturbations were
refused, each naming the right setting, including the two isolation controls. Two
full capture cycles separated by **five named settings** (exposure, ray tracing,
sample count, filter size, anisotropy) reproduced **exactly** — worst delta 0.0 at
all six poses. The baseline was then **re-captured under spec v2** and reproduced
exactly again, which is how the added pins were shown to have been at their pinned
values during the v1 capture rather than merely asserted.

Stronger still, and previously unstated: T011's `rebaseline-results.json`
raytracing-off column is **numerically identical to this baseline at all six
poses** — a cross-task, cross-rebuild exact reproduction.

Note the harness cannot enforce everything: the pose list, mask semantics, the
recorded GPU backend and the procedural clearing steps are **prose-only and
unenforced**, and are labelled so in the record.

`hide_render` is forbidden. Subjects are rendered alone.

### The operative baseline, and two open items

| pose | ratio | hue spread |
| --- | --- | --- |
| 400/55 | 1.040478 | 0.015976 |
| 400/235 | 1.019942 | 0.025771 |
| 1200/55 | 1.023193 | 0.020598 |
| 1200/235 | 1.002152 | 0.025470 |
| 4000/55 | 1.020074 | 0.022754 |
| 4000/235 | **0.942736** | **0.033819** |

Two findings survive pinning and are **tile properties, not artifacts**:

- **4,000 m / azimuth 235 reads 5.7% dark.** Attributed to the tile; **mechanism
  unattributed.** An earlier version of this amendment blamed sub-pixel rooftop
  geometry and cited T011's ablation as consistent. **That was refuted by the very
  same ablation**, which points the other way: deleting rooftop mass makes the
  *source brighter*, the roof-free source still rises +5.8% from 1.2 km to 4 km
  against +7.0% with rooftops, and the tile's deficit against a roof-free source
  *widens* to 8.4%. A named but untested candidate is the atlas's 14.67% unused
  black area averaging in under progressive minification, which matches the
  monotone 1.0199 → 1.0022 → 0.9427 trend. **Candidate, not conclusion.**
- **Hue spread exceeds 0.02 at five of six poses**, grows with distance, and red is
  consistently the deficit channel. A tile property; the **mechanism is left
  unattributed** rather than guessed. Previously masked by the residency artifact.

### Consequence for §1's coarse-tier identity

Unchanged by this amendment — the far tier is still the census's coarse prism. But
note that the silhouette figures §1 quotes (median 0.045221, max 0.628806) are
geometric measurements from the citywide census and were never appearance readings,
so nothing in this supersession touches them.

---

## Amendment — T013 (Issue #118, branch `fcp/118-hue-integrity`, 2026-08-19)

**Status of this amendment: the hue mechanism is ATTRIBUTED, a colour-only recipe
`v3` exists and replays, and its confirming capture MISSES two pre-registered bars.
`v3` is NOT promoted. The mass bake stays blocked.**

Evidence: `data/far-tier-hlod-hue-20260819/` — `atlas-arithmetic.json`,
`albedo-mix.json`, `pinned-capture.json`, `hue-attribution.json`,
`instrument-mask-semantics-note.json`, `fix-pre-registration.json`,
`fix-capture-verdict.json`, each with a `.sha256`.

### The hue mechanism, attributed

The amendment above left it unattributed. It is now attributed, and **not to the
colour path**, every part of which is excluded by exact arithmetic on the shipped
bytes: black atlas dilution moves the channel ratios by 1.1e-16 (mixing with black
in linear light is a per-channel-equal scale); sRGB quantization spreads the
channels by 0.00079 against measured 0.0160–0.0338; the calibrated factor is a
per-channel-uniform scale to fifteen decimals and no texel reaches the encoder
clamp; and gamma-space filtering is rejected **by sign** — it attenuates the
widest-encoded-contrast channel hardest, which in this atlas is *blue*.

The decisive observation is that at 400 m the atlas is drawn at **0.9368 texels per
pixel** — magnified, not minified — and the spread is already 0.0160 and 0.0258.
Between 47% and 76% of the worst spread exists before any minification, which
retires the black-area candidate for the *hue* finding specifically.

What remains is **surface composition**: which surfaces exist and how much of each
is seen. Measured in two terms on log(R/B), with a controlled instrumentation
variant whose geometry is byte-identical to the source: material absorption
14.1–36.4%, geometric simplification 63.6–85.9%.

### The representation choice this amendment records

Recipe **v3** (`far-tier-hlod-bake-v3`) makes a wall zone's colour the
**area-weighted linear-light aggregate** of the vertical facade, glazing and trim
surfaces that wall stands in for, carried as the zone's factor divided through its
own class-tile linear mean. It derives from **v1**, not v2 — exactly one field
differs and nine are added — and the same code path with `facade-only` reproduces
the committed v1 atlas byte for byte, enforced rather than asserted.

`material:metal` is **excluded**. Rooftop tanks, their legs and fire escapes are
geometric omissions of the prism, not materials a wall absorbs; the scope is what
the *wall* replaces on the wall's own footprint. 2.22% of source area.

ADR 0047 / T006-G2 handling is **unchanged** by this amendment.

### The confirming capture, and why it stops

Pre-registered before any v3 render existed: per-pose point predictions, an
agreement bar of 0.01, and **A3' = 0.032**, derived from the measured irreducible
geometric term (0.030863) plus the instrument's own cross-session tolerance (0.001).

| pose | v1 spread | v3 spread | 0.02 bar | A3' |
| --- | --- | --- | --- | --- |
| 400/55 | 0.015976 | **0.007363** | PASS | PASS |
| 400/235 | 0.025772 | 0.025406 | MISS | PASS |
| 1200/55 | 0.020627 | **0.011732** | PASS | PASS |
| 1200/235 | 0.025436 | 0.025436 | MISS | PASS |
| 4000/55 | 0.022772 | **0.013714** | PASS | PASS |
| 4000/235 | 0.033824 | 0.033824 | MISS | **MISS** |

A1 and A2 **pass at every applicable pose**, and A1's agreement *improved* at all
three rather than degrading as the pre-registration warned it might. Byte replay
passes in-process and in a fresh child.

**Two bars are missed.** A3' misses at 4,000 m / azimuth 235 at 0.033824, and the
prediction bar misses at five of six poses on the per-channel *levels* (worst
0.023051) while the *spreads* agreed everywhere to 0.0047.

### Why the worst pose did not move at all — measured, not inferred

Relative energy change between the v1 and v3 renders over the tile's own
silhouette: **4.81% / 4.73% / 4.62%** at the three azimuth-55 poses, and **0.197% /
1e-8 / 8e-8** at the three azimuth-235 poses. At the two far azimuth-235 poses
exactly **one pixel** moves by more than 1e-6.

The pinned poses sit on the sun's terminator — the sun is at compass azimuth 145
and the pose azimuths are its ±90°. At azimuth 235 the visible walls are the unlit
ones, so the tile's visible signal is almost entirely its **lit roof cap**, which
v3 does not touch. A wall correction cannot move a roof-dominated image.

**The azimuth-235 hue spread is therefore not a wall-colour finding at all.** The
attribution's own caution — that the geometric term's internal mechanism was *not*
established — is exactly what this capture lands on. The roof cap is now the named
next candidate, and it is named rather than measured.

### What was not done

No bar was widened after the capture, no pose was set aside as roof-dominated after
the fact, and no second recipe was tried. v3 is neither withdrawn nor promoted.

---

## Amendment — T013 closure (Issue #118, 2026-08-19)

**Status: recipe `v3` is ADOPTED as the far-tier recipe. The operative hue bar is
`A3'' = 0.035`, adopted BY USER DECISION on 2026-08-19 *after* the measurement.
The legacy `0.02` bar is retired as operative and recorded as UNREACHABLE.
Extending the aggregate to the roof is REJECTED on measured numbers.**

Evidence: `data/far-tier-hlod-hue-20260819/gate-adoption.json`,
`final-verdict.json`, `roof-term.json`, each with a `.sha256`.

### The representation choice

`FAR_TIER_BAKE_RECIPE_V3` — `far-tier-hlod-bake-v3`, recipe sha256
`e73206429c496c28c707120769eee5f4a6155f44442eccb9b19fe2fdcfbc24c8`. A wall zone's
colour is the **area-weighted linear-light aggregate** of the vertical facade,
glazing and trim surfaces that wall stands in for, carried as the zone's factor
divided through its own class-tile linear mean. It derives from **v1**, not v2;
the facade-only path through the same code reproduces the committed v1 atlas
`c159e050…` byte for byte and the bake refuses if it does not. `material:metal`
is **excluded** — 77.03% of this cell's metal is wall fire escapes and the rest
is rooftop tanks and legs, which are geometric omissions rather than absorbed
materials. ADR 0047 / T006-G2 handling is unchanged.

### The adopted gate set

| gate | statement | status |
| --- | --- | --- |
| A1 | \|union mean luminance ratio − 1\| ≤ 0.05 where source mean luminance ≥ 0.10 | unchanged |
| A2 | \|baked − source\| union mean luminance ≤ 0.010 at every pose | unchanged |
| **A3''** | per-pose channel spread ≤ **0.035** | **adopted after measurement** |

`A3''` is derived as the measured v3 worst spread **0.033824** plus the pinned
instrument's own cross-session tolerance **0.001**, rounded up to **0.035**.

**It is a post-hoc bar and the record says so at every claim site.** It was chosen
knowing the score. Its purpose is to codify a limit that was *established by
measurement* — what a solid prism can achieve standing in for a tiered, recessed
envelope once every colour-path defect is excluded and the palette term corrected
— not to test the tile. The control is the disclosure, plus the
**prediction-agreement discipline**: any future recipe change must pre-register
per-pose point predictions and stop on a miss, exactly as T013 did when its own
prediction bar missed at five of six poses and the task halted rather than widen it.

`A3' = 0.032` is **superseded by statement, never edited**. Its derivation basis
did not transfer: it came from a variant that substituted materials across the
whole source, while v3 substitutes only on walls, and at the roof-dominated poses
those are not the same substitution. Its MISS stands in `fix-capture-verdict.json`.

### The measured floor, and why 0.02 is retired

With **both** palette terms corrected — walls to the facade colour and the roof
region to the roof colour the prism bakes — the residual is **0.027301** at the
worst pose (bracket 0.027301–0.030863; the metal record cannot be split, so the
two variants err in opposite directions). That is the geometry term, and it sits
**above 0.02 before any recipe is chosen**. Holding 0.02 would be holding a bar no
available change can meet. It is retained as a reported figure at every pose.

This does **not** claim 0.02 is unreachable in principle; a tier carrying the
source's setbacks and rooftop groups would be a different tier.

### The roof extension, rejected

An area-correct roof aggregate widens the hue spread at **all six poses** (+0.0038
to +0.0097) and takes 4,000 m / azimuth 235 to **0.043074** — past 0.02, 0.032 and
0.035 alike. It buys no A2 benefit, because A2 already passes everywhere under v3
including that pose at 0.00242, and it introduces **new failures at 400 m /
azimuth 55**: A1 at 0.054069 over the 0.05 allowance, A2 at 0.011666 over 0.010.
Rejected as a hue fix and as a package — not dismissed as a phenomenon, since it
remains the largest measured lever on that pose's tone (ratio 0.942687 → 1.004432).

### Final verdict against the adopted gates

Six poses, existing capture re-scored, no new render: **A1 3/3 applicable PASS,
A2 6/6 PASS, A3'' 6/6 PASS**, tightest A3'' margin 0.001176. The legacy 0.02 bar
passes at 3 of 6, against 1 of 6 under v1.

Passing a bar derived from this tile's own worst pose is close to arithmetic and
is not evidence of accuracy. What the capture earns is the wall term's correction,
measured at 4.6–4.8% of the signal where walls are visible and 1e-8 where they are
not. The azimuth-235 spreads are unchanged from v1 and `A3''` accommodates that
rather than closing it.

### Post-adoption corrections (2026-08-19, same day)

Three fixes from the closing review, none of which moves a verdict:

- **The measured floor's bracket was wrong.** It had been computed as the lowest
  low across all six poses to the highest high, giving `[0.006848, 0.030863]` —
  a lower end taken from 400/55, three times below the 0.02 bar that evidence is
  used to retire. Corrected to the **worst pose's own bracket, `[0.027301,
  0.030863]`**, which is what this ADR already stated in prose. A test now
  asserts the lower end sits above 0.02.
- **A silent degradation path was found, counted and disclosed.** In aggregate
  mode a wall zone with no attributed surface fell back to v1's facade-only
  colour with nothing recorded. The adopted tile contains **four such zones on
  one building — 51.198 of 86,964.275 m² of wall, 0.059%** — because the
  attribution sends those short edges' surfaces to a neighbour. **The tile's
  digests are unchanged** (`e154561c…` / `368c863c…`): the guard revealed
  existing behaviour rather than changing it, so every captured reading and
  verdict stands. The bake now **refuses** the fallback unless a caller accepts
  it by name and reports the count, the zones and the area. A mass bake must
  report it per cell and treat a large count as a stop.
- **The adoption is now expressible as a check.** `FAR_TIER_ADOPTED_RECIPE` and
  `assertFarTierAdoptedRecipe()` are exported so the T004 mass-bake path can fail
  closed in one line. **Nothing enforces it today** — `farTierEffectiveParameters`
  deliberately falls back to v1 so v1's byte replay cannot break, which means a
  caller that forgets v3 gets a v1 tile silently. Recorded as a residual risk in
  the handoff rather than assumed away.

---

## Amendment — T004, the mass bake campaign (Issue #104, 2026-08-19)

**Status: recipe `v4` ADOPTED through a pre-registered Stage 0 cycle; the island
is baked at 840 tiles with 43 named honest stops; NO serving surface changed.**

Evidence: `data/far-tier-hlod-mass-20260819/` — `v4-pre-registration.json`,
`v4-adoption-verdict.json`, `campaign-pre-registration.json`, `telemetry-w00..w05`,
`inventory-w00..w05`, `campaign-summary.json`, `characterization-plan.json`,
`characterization-results.json`, each with a `.sha256`.

### Recipe v4

`far-tier-hlod-bake-v4`, sha256 `fd950a77f1c57cb2b7238b588aa11cd020ace1f15c1448438dfd0f235e10412c`
— v3's area-correct wall aggregate over v2's packing. v1, v2 and v3 keep their
ids, hashes and frozen artifacts.

It exists because the census measured v1/v3 packing at **172 of 883 cells
unpackable at any scale** and a median applied scale of 0.5. Under v1 a face
costs `(4 + 2×2)² = 64` texels, so a 256px atlas holds 1,024 faces; under v4 a
flat face costs `(1 + 2×1)² = 9` and it holds 7,281. The island's largest cell
is 1,853 faces.

**Adopted through the discipline T013 made a condition of A3''.** Predictions
and bars were committed before any v4 render existed; the capture agreed to
**0.001999** against a 0.01 allowance, and A1, A2, A3'' and byte replay all
passed. A3'' = 0.035 is inherited unchanged: the cycle certified a recipe, not
a bar. `assertFarTierAdoptedRecipe` now names v4 and carries what it superseded.

### Campaign results

| | |
| --- | --- |
| Ledger cells | 883 |
| Tiles built and sealed | **840** |
| Named honest stops | **43**, all `fallback-share-over-bar` |
| `packing-infeasible` | **0** |
| Coverage arithmetic | **CLOSES** (840 + 43 = 883), machine-checked |
| Byte replay | 840 cells, **0 mismatches**, batched fresh child processes |
| Median applied scale | **0.707107** (0.5 under v1 packing) |
| Under-resolved cells | 764 of 840 (90.95%) |
| Payload | 246.7 MiB, mean 307,911 B/tile |

The campaign's prototype-cell tile is **byte-identical** to the one Stage 0
adopted, which is what makes the adoption evidence about the campaign.

The byte-replay claim is reproduction **across a process boundary on one
machine, one Node build and one architecture**. Cross-machine reproduction is
not claimed and was not tested.

### The appearance characterization is DESCRIPTIVE, and it found something

Six cells by extreme across five strata, 36 poses, pre-registered before any
capture with a population prediction of 0.039 (A3'' plus the width of T013's
geometric-term bracket).

**The prediction was EXCEEDED and the finding is not the one that was expected.**

- **A3'' held at 33 of 36 poses.** All three misses are ONE cell — the island's
  smallest, four faces and one building — with spreads to 0.120272 at its dark
  azimuth-235 poses. Two of its poses have five intersection pixels; those
  ratios are reported and are evidence of nothing.
- **The systematic failure is LUMINANCE, not hue.** A1 passes 8 of 18 applicable
  poses and A2 passes 24 of 36, and **every miss is the tile reading brighter**,
  ratios 1.04 to 1.21. Not one pose fails by being too dark.
- The two cells that pass everything are the **largest** (3,836 faces) and the
  **median** (671). The prototype T013 measured has 764 faces and sits with the
  passing group, so **the prototype is not representative of the population for
  luminance** — and this campaign is the first evidence of that.

No mechanism is claimed. The obvious candidate is that a prism carries no
self-shadowing or inter-building occlusion while the source does; that is a
hypothesis, not a result, and it belongs to T007 with a sample designed for it.

A cell-level miss is recorded at stratum level and stops nothing, exactly as
pre-registered. **Acceptance remains T007's.**

### Zero serving change, and one obligation named

The payloads live in a new gitignored root, `artifacts/far-tier-hlod-mass-20260819/payloads/`,
FLAT, with the runtime's expected names. `src/runtime/`, `src/features/explorer/`,
`src/app/`, `data/far-tier-hlod-runtime-20260818/` and `public/far-tier/` are
byte-for-byte untouched, proven by an empty diff against the branch base plus
green T003 runtime-record and serving pin tests. The runtime pins ONE inventory
digest for the whole tier and fails closed on a mismatch; writing 840 tiles into
it would have broken the tier.

**The deferred eviction obligation is now arithmetic.** `FAR_TIER_RUNTIME_BUDGETS`
declares `maxCacheEntries` 256, `maxCachedBytes` 64 MiB and `evictionPolicy`
NONE, and says the question is deferred to mass-bake scale. At the campaign's
mean of 307,911 bytes a tile the **byte ceiling admits 217 tiles and binds
before the entry ceiling**, so with no eviction an island-scale camera gets
`over-budget` refusals as a routine outcome rather than the exceptional one a
single staged cell produced. Named for T005 with its numbers; not fixed here.

---

## Amendment — T005, the promotion (Issue #105, 2026-08-19 / 2026-08-21)

**Status: ACTIVATED. `FAR_TIER_DEFAULT_ON` is `true`.**

**It took two sweeps, and the first one's FAIL is not withdrawn.** Sweep-1
failed at P2 and this amendment was written, below, saying the promotion was not
activated. That text is left standing rather than rewritten, because what
changed was not the scene — it was the explanation of a number. The correction
is at the end of this amendment, under *Sweep-2*.

Evidence: `data/far-tier-hlod-promotion-20260819/` — `promoted-inventory.json`,
`sweep-exemptions.json`, `sweep-poses.json`, `sweep-results.json`, each with a
`.sha256`.

### What was built

- **The promoted inventory**: six sealed wave inventories merged into one —
  840 entries, 43 honest stops, 883 against the ledger, 44,076 members with the
  143 refusals kept. The merge refuses a duplicated cell, a cell that is both
  baked and stopped, and any total that disagrees with the ledger.
- **One serializer, and the staged bytes are the committed bytes.** The runtime
  pins one digest and fails closed; a staged copy differing by a space takes the
  whole tier down in every session. The stage CLI copies rather than
  re-serializes, and the identity is asserted.
- **The pin swapped** to `cf8e2648…`, predecessor `9c46f62a…` kept as a constant.
- **Budgets v2**: 288 MiB against a measured **258,644,848 declared file bytes**,
  16.8% headroom, entries 1,024 ≥ 840. The unit is stated because it is within a
  factor of 1.5 of the GPU bars. Justified in GPU units: island resident ≤
  **382,457,884 B** against the frozen **390,295,058** — a **2.0% margin**.
- **Eviction discharged, not deferred.** `release()` frees under the same
  predicate that decides drawing; at a ceiling admitting the island there is no
  pose that selects a cell it cannot afford, so a policy would have no reachable
  branch.
- **Two defects the island exposed**: `attempted` was set before the admission
  check, so an over-budget refusal was permanent for that cell; and the fill was
  one uninterruptible chain, so a camera move waited for 840 loads.

### The sweep, and why it fails

Executed in the **Orca embedded browser** — the Chrome extension browser could
not reach this host in any tested configuration (four addresses, two ports,
three binding modes, no proxy) while reaching the public internet.

| pose | states | massing suppressible / covered / uncovered | verdict |
| --- | --- | --- | --- |
| P1 1,400 m ⊥ | all clean | 2,514 / 2,514 / **0** | PASS |
| **P2 2,400 m oblique** | all clean | 23,959 / 12,092 / **11,867** | **FAIL** |
| P3 honest-stop cell | all clean | 1 / 1 / **0** | PASS |
| P4 densest cell | all clean | 3,751 / 3,751 / **0** | PASS |
| P5 12 km ⊥ | all clean | 29,031 / 29,031 / **0** | PASS |
| P6-OFF rollback | — | — (0 far-tier requests) | PASS |

`absent = checksum-mismatch = build-failure = over-budget = 0` at **every** pose.
`notDeclared = 1` throughout is the Block 835 alias, a committed exemption.

**P2 is the only oblique pose and the one reconstructed from the user's own
session.** Its uncovered count did not converge across three readings — 12,485,
then 26, then 11,867 — and that instability is the finding. The buildings
involved cannot be exemptions: `suppressibleBuildingIds` is built from members
with `included: true`. The code already flags the hazard this points at, around
`denseDesiredFarTierCoveredRef` and the dense-layer rebuild racing the
covered-set write.

**Two instrument defects were found by the sweep and are disclosed in full** in
`sweep-results.json`: a member metric that compared against buildings with no
massing loaded at all (reading 41,405 where the true answer was 0), and a settle
rule that fired during a rebuild plateau. Both were corrected; P2 failed under
all three instruments.

### Numbers, no bar

First far-tier attribute 4.5–7.5 s; covered set converges up to ~48 s at wide
poses. Frame time median **8.3 ms**, p95 16.7–198 ms (foreground samples; one
pose was rAF-throttled and excluded). 1,053–1,255 far-tier requests per ON pose,
**0** on the OFF arm.

### What a rollback means, stated because the scheduler taught it

`FAR_TIER_DEFAULT_ON = false` restores the pre-HLOD **composition** and nothing
else: the raised ceilings, the swapped pin and the merged inventory stay in the
build. That is a third configuration nobody measured, exactly as ADR 0045 names
it for `EXTERIOR_SCHEDULER_DEFAULT_ON`. It was the configuration this branch
shipped after sweep-1; after sweep-2 the branch ships `true`, and the sentence
above is what a rollback would leave behind.

### Sweep-2 — the P2 failure was a stale publish, not a lost write

The section above points at "the dense-layer rebuild racing the covered-set
write" around `denseDesiredFarTierCoveredRef`. **That hypothesis was tested and
is wrong.** Instrumenting the seam produced four facts that exclude it:

- the selection pass itself reported **`passUncovered` = 0** at the same instant
  the published attribute read thousands;
- **`desiredCovered` == `appliedCovered`** throughout, so not one alpha write was
  ever skipped;
- every uncovered id classified as **`notDesired`** — the covered set never
  contained it — with `uncoveredDesired` and `uncoveredHidden` both 0;
- the **published** drawn-cell count (839) exceeded the drawn set the last pass
  had actually **selected over** (776).

The cause is one call site. `publishFarTierState()` ran at the moment the drawn
set advanced — before `farTierCovered` was computed and long before
`applyFarTierAlpha` wrote anything — so a reading paired a NEW drawn set with the
PREVIOUS pass's applied-alpha set, and the pass never published again. At a wide
oblique pose, where tiles become ready in large batches, the gap was thousands of
buildings wide. On a cold cache it reproduced as **6,145 uncovered, stable for
80 s and never healing**: a stuck stale reading, not an intermittent race.

**The scene was correct at P2 the entire time.** This was the metric's **third**
instrument defect, and that history is why the reading is now the pure function
`farTierCoverageReading` — classifying every uncovered id as `hidden`, `desired`
or `notDesired` — with `data-far-tier-pass-uncovered` published beside it as a
selection-time control. Fixed in `200446c`; the drawn set still advances at
selection, the publish moved after the alpha write, and the rebuild commit
publishes again after re-applying.

Sweep-2 re-ran the **same six registered poses** — **pre-registered in `3c5c64f`**
along with their URLs, the exemption set, the attempt policy and the verdict
rule, before any screen was looked at, and reused unchanged rather than re-chosen
after sweep-1's failure.

The settle rule is **blind to the verdict** (dense layer committed, and the
triple `active/suppressible/covered` identical across three reads 8 s apart; it
never inspects `uncovered`) and was **fixed before any accepted capture** — which
is not the same as before any pose was read, and the difference is stated rather
than blurred: **the rule was written after the first capture pass was
discarded**, then applied uniformly to all six accepted captures. The sweep-2
prose in `sweeps[]` was likewise authored after the captures; an earlier revision
claiming otherwise is withdrawn in the record itself.

| pose | states | massing suppressible / covered / uncovered | verdict |
| --- | --- | --- | --- |
| P1 1,400 m ⊥ | all clean | 2,520 / 2,520 / **0** | PASS |
| **P2 2,400 m oblique** | all clean | 23,973 / 23,973 / **0** | **PASS** |
| P3 honest-stop cell | all clean | 1 / 1 / **0** | PASS |
| P4 densest cell | all clean | 3,757 / 3,757 / **0** | PASS |
| P5 12 km ⊥ | all clean | 29,064 / 29,064 / **0** | PASS |
| P6-OFF rollback | no far-tier UI at all | 25,021 active, 0 suppressible | PASS |

`absent = checksum-mismatch = build-failure = over-budget = 0` at every ON pose;
`notDeclared = 1` throughout is the Block 835 alias exemption. All six settled
within 32 s.

**Disclosed against the single-attempt policy.** One capture pass was discarded
before any verdict was taken: P1 produced no far-tier element and P2 read
`active = 0` with `appliedCovered = 0` — the dense layer had not committed, so
the reading measured an unloaded scene. That discarded P2 reading had
`uncovered = 0`; **accepting it would have been a false PASS in the direction
being sought**, so discarding it moved the reading away from the desired answer,
not toward it. No pose was re-read after a verdict was seen.

### The `<!doctype` errors, diagnosed

Sweep-1 recorded six repeated `Unexpected token '<', "<!doctype "` notices as
undiagnosed. They are six exterior **serving** releases declared by
`src/release/exterior-serving-waves.ts` whose packages do not exist on disk in
this worktree or the main checkout — generated, gitignored local data. The SPA
fallback answers `/data/<id>/release.json` with `index.html`. Six declared
packages, six errors. **Not the far tier and not introduced by T005**; producing
them needs an approved operator workflow and none was run.

**This is material to both sweeps and is not glossed:** the exterior LOD-0 wave
tier was **absent from the vehicle**. Both sweeps measure the dense massing tier,
the far tier and their interaction. Neither clears the three-tier composition
with exterior waves present.

**Correction (2026-08-21).** The generation named above is wrong: the effective
default is the six **`-s2`** two-LOD releases returned by
`exteriorDefaultActivations()`, not the `-s1` set declared by
`exterior-serving-waves.ts` — `-s1` is their superseded predecessor. The
illustrative URL `/data/<id>/release.json` is also wrong; the served manifest is
`index.json`. Both errors were this agent's. The count, the mechanism and the
materiality are unchanged and were confirmed by staging the packages locally:
all six errors disappeared and the near tier now draws facades.

### Vehicle difference between the sweeps

Sweep-1 ran on `vite dev`; sweep-2 ran on a **production build** via
`vite preview`. The comparison between the two sweeps is therefore not
vehicle-controlled. The production build is what a user receives.


---

## Amendment — T007, the three-tier acceptance campaign (Issue #107, 2026-08-22)

**Status: the three-tier default is NOT accepted. ONE product gate FAILs, two
instruments fail for scope, and SEVEN gates could not be captured.**

The single product FAIL is **not the far tier's**: it reproduces with the far
tier wholly disarmed. Nothing in this campaign is attributed to the far tier —
the one station that might have carried a cost could not be measured, twice.

Evidence: `data/three-tier-acceptance-20260821/`, **sixteen** records with
sidecars, all bound by digest from `campaign-summary.json`.

### What the far tier is answerable for: on this evidence, nothing at F1

**CORRECTED AFTER REVIEW.** An earlier revision of this amendment reported an F1
FAIL at `overview-52km-island` and called it the far tier's. Both claims are
**withdrawn**.

The capture carried `landed: false, dispatchCount: 12`, and the campaign's own
pre-registration classifies a landing failure as an instrument-failure abort that
writes no verdict. A verdict was written from it anyway, and the landing failure
was not disclosed. Re-running the registered instrument **reproduced** the
landing failure at that station and only that station, at the same dispatch
count, while the other four landed on the first dispatch in both attempts. The
station is **NOT-CAPTURED**, and F1 as an every-station gate is NOT-CAPTURED with
four PASSes of seven registered stations.

The attribution is withdrawn for three independent reasons. The station never
landed. The **two-tier baseline at the same station was already p50 16.7 / p95
24.9** — at the bar before the far tier existed. And the isolation could not be
completed: the far-tier-OFF arm captured cleanly and passed (p50 16.6, p95 18.2,
n=796), but three ON arms were refused because the far tier had declared **zero**
cells within F1's registered 45 s settle at that pose. With no valid ON arm there
is no controlled pair, and the OFF reading may not be differenced against a
different instrument's ON reading from a different session.

The pre-declaration that far-tier stations *may* fail F1 is recorded as **unused**
rather than claimed as borne out.

### What the far tier is NOT answerable for

**J2 fails, and it is not the far tier's.** A searched building's details panel
carries one of four rows — cell/release, active asset and truth tiers absent —
where the frozen T006 baseline carried all four at the same query and pose. The
panel is honest about why ("its cell is not streamed at this camera yet"). Re-run
at the same pose with `farTier=off`, the loss reproduces exactly. The cause is
the `-s1` → `-s2` two-LOD promotion changing residency, recorded against ADR 0057.

**Flipping the far tier off would not fix the one user-visible failure this
campaign found.**

### G1-far, and the mip question settled by measurement

The GPU texture probe had never been validated against a far-tier tile. It was,
first, and the B-series was gated behind it passing at exactly zero:

| hypothesis | bytes | delta |
| --- | --- | --- |
| no mips | 212,467,712 | short 70,822,291 |
| **truncated 4/3** | **283,290,003** | **0** |
| exact mip pyramid | 283,289,164 | short exactly 839 |

Cesium **generates** the chain and accounts for it with the **truncated 4/3**
approximation — the exact-pyramid hypothesis being short by precisely one byte
per tile identifies the convention rather than bounding it. The repository's
existing `PROBE_MIP_CHAIN_MULTIPLIER` was right and is now measured.

**B3/B4/B5 all PASS**, in decoded GPU bytes and compared with nothing in file
bytes: 283,290,003 / 291,984,434 · 95,302,992 / 98,310,624 · 378,592,995 /
390,295,058, each about 3% inside. The v2 runtime justification's predicted
382,457,884 — "inside, and not comfortably" — comes in 3,864,889 bytes high.

Nothing was evicted: the 1,024-entry ceiling admits the island, so **no eviction
pressure was exercised** and the 839-atlas residency is REPORTED, not offered as
a B-series verdict.

An earlier revision added that the 840th atlas "reconciles to the byte". That was
a **tautology** — the island figure is itself the sum over all 840 with the same
formula, so subtracting the 839-atlas sum can only return the missing term — and
it is withdrawn. G1-far's exact-zero result is unaffected: it compares the probe
against an independent computation from the shipped PNG headers.

### The acceptance instruments are far-tier-blind, and it shows

The committed G1/G2/G3 gates FAIL for **scope, not regression**. G1 predicts
`texturesByteLength` from a known count of wave class tiles and attributes every
texture byte to them; it cannot see a far-tier atlas at all, so with the far tier
armed the measurement exceeds the prediction and the gate fails.

The load-bearing figure is **G2's**, because it does not reduce to a restatement
of the harness's own delta: a bar of 2,184,525 bytes against an independently
measured 283,552,146 implies **3,245 class tiles where 25 were expected**. (The
subtraction this section previously offered — measurement minus reported delta
returning the four-tile prediction — is the tautology withdrawn above, and is not
repeated.)

J1's boot-document filter is pinned to `-s1` ids the default no longer serves.
Neither is evidence about the product.

### Not measured

**M1 heap is NOT-CAPTURED**, not failed. Three instrument-failure aborts; no
attempt reached lap 3 of the 9 it needs; the instrument wrote no record on any of
them. Its guard — "focus/visibility changed mid-run" — fired twice from different
laps on a machine simultaneously running another browser under agent control.
That is a vehicle limitation, stated rather than retried past: NOT-CAPTURED is
the difference between "the city leaks" and "this vehicle could not measure
whether it leaks".

### Rollback

A campaign FAIL does **not** flip `FAR_TIER_DEFAULT_ON`, as registered before any
reading. `false` restores the pre-HLOD composition and nothing else — the raised
ceilings and swapped pin stay — which is a third configuration nobody has
measured. And J2 reproduces with the far tier off, so the rollback would not buy
the one user-visible fix on offer.

---

## Amendment — T008, the goal closes (Issue #108, 2026-08-22)

**Status: the goal ships its acceptance record with 2 MET, 5
MET-AS-ADJUDICATED, 4 NOT-MET, and a fourteen-item residual register. The
completion decision is presented to the user, not taken here.**

Record: `data/manhattan-hlod-far-tier-acceptance-20260822/reconciliation.json`.

### D-19 is characterised, not closed

The prior goal's criterion-4 NOT-MET verdict is amended **by statement**. The
amended record —
`data/exterior-completion-acceptance-20260817/reconciliation.json` — is **not
edited**: its bytes and its sidecar are unchanged, and a test binds that. It is
cited by path and task only, never by hash, because it embeds successor hashes in
its own closures and a hash citation would be circular. That is the convention
the record itself established for the earlier T008/Issue-90 amendment.

**The verdict does not change.** What changes is the reason, and the old one was
resting on a premise that has since become false:

> the original stop: "all six promoted `-s1` serving releases declare
> `shippedLodIds ['lod_0']` only. There is no rendered lod_0-to-lod_1 transition
> anywhere in the served set."

Two-LOD serving is now the default. **44,565 of 44,989 shipped assets declare an
eligible `lod_1`**, and the transition exists in the served set. The gate is
still not met, for a different and newly measured reason: the in-app
instrument's error budget exceeds the 2% bar for every building in every
realistic stratum — 5.98%–35.06% across the 424-parent census, 6.57%–20.65%
across the 53 near-cap buildings, **zero under the bar in either**. Magnification
is pinned by the 400 m ring, so moving closer to gain resolution destroys the
transition being tested.

**What T006 actually established** — and the amendment says this rather than
implying more: an arithmetic honest stop, a dual-derived census of 424, and five
shed-tone pairs that are INCONCLUSIVE-BY-INSTRUMENT. **Not a met 2% gate.**

Half of the original stop survives untouched: the 424 measured-fallback parents
have no `lod_1` at all by construction, so for them there is no transition to
render and never will be under this grammar.

Three successor paths are named: a forced-LOD and isolation hook; render-target
resolution (which clears the bar for 97 of 424 at 8× and 382 at 16×, but selects
a size-biased stratum, not the census); and an identity check that works from
outside the renderer.

### What this ADR should not be read as saying

The far tier is built, measured and pinned. It does **not** have a rendered
transition gate, a frame-time result at its most demanding station, or an
identical journey suite — and the last of those three is not its fault: the one
user-visible regression reproduces with the far tier disarmed.

The acceptance campaign's **NOT ACCEPTED** verdict stands unchanged.
