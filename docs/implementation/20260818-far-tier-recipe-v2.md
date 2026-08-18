# T010 — recipe v2: the packing fix landed, the shading term halted

Date: 2026-08-18
Task: T010 (Goal `manhattan-hlod-far-tier`, Issue #113)
Branch: `fcp/113-recipe-v2`
Status: **Stage A complete. Stage B HALTED at a pre-registered NO-GO, before any v2
capture.**
Evidence: `data/far-tier-hlod-v2-20260818/` (`stage-a-packing-census.json`,
`stage-b-decomposition-and-prediction.json`, each with a `.sha256`)

The T002 records under `data/far-tier-hlod-20260818/` are **not touched**. Their own
amendments block forbids it, and this task's records live in a separate directory with
explicit lineage back to them.

## Stage A — the packing fix

v1 gave a flat, constant-colour face a 4×4 content rect. That was never a quality
decision: `faceTexelFloor` was doing two jobs — "below this, stop resolving detail" and
"this is how big a resolved-away face is" — and a constant colour needs exactly one
texel. v2 separates them.

Sampling is unaffected, and that is provable rather than hopeful. `farTierGeometry`
already samples texel centres, so at width 1 the two u coordinates collapse and all four
corners address the single texel — the trick the roof fan has used since T002. A test
pins that the 1×1 renders the identical colour the 4×4 block carried.

**The gutter decision.** A flat face's four corners carry the *same* uv, so its uv
derivative is identically zero and the hardware selects mip 0 for it. One texel protects
the bilinear tap.

The residual is larger than that argument makes it sound, and it is worth stating
plainly. Derivatives are computed per 2×2 pixel quad, so a quad straddling a face seam
sees a false derivative and can select a high mip. **Gutter width does not decide whether
that bleeds — only which mip level it starts bleeding at**; two texels buys one more
level than one, and nothing more. **And the effect is unmeasured at this tier's own
serving distances**, where it is least comfortable: the whole cell covers 5,889 pixels at
1,200 m and 516 at 4,000 m against a median 650 faces per leaf, so most covered pixels
are at or near a face boundary and the cross-primitive case is the common case rather
than the edge case. What bounds the damage is the *content* — every flat face carries its
own area average, so a bleed mixes two similar constants. That is an argument about
magnitude, not absence, and no still has been captured to check it.

Both widths were measured rather than argued.

**The census now packs all 1,221 nodes, not 883.** T002 packed leaves only and therefore
could not see that the hierarchy above the leaf level barely existed.

| unpackable | leaves (883) | internal (338) |
| --- | --- | --- |
| v1 | 172 | 325 |
| v2, flat gutter 2 | 10 | 226 |
| **v2, flat gutter 1** | **0** | **94** |

Per level, which is what decides whether a distance ladder exists at all: v1 packed 104
of 351 z16 nodes. v2 with gutter 1 packs **z18, z17 and z16 completely** (16/16, 628/628,
351/351), breaks at z15 (91/128) and degrades above. **The far tier gains a real
three-level ladder where v1 had essentially none, and the levels above z15 remain
infeasible — recorded, not hidden.**

Delivered resolution improves where it was worst: median delivered texel ratio over
leaves moves **0.5 → 0.707107**, and all 172 previously unbakeable cells now pack.

B1–B5 do not move. No ceiling change, no memory bar touched.

## Stage B — measured first, and stopped

### The decomposition changed the question

The plan required measuring the roof/wall luminance split *before* designing a term. It
was the right order, because the answer inverted the problem.

| pose | wall share | roof share |
| --- | --- | --- |
| 400 m / az 55 | 0.801 | 0.206 |
| 400 m / az 235 | 0.056 | 0.978 |
| 1200 m / az 55 | 0.808 | 0.201 |
| **1200 m / az 235** | **0.034** | **0.99999** |
| 4000 m / az 55 | 0.810 | 0.199 |
| 4000 m / az 235 | 0.034 | 0.99997 |

**The failing pose is almost entirely roof.** The T002 tone miss was never a facade
problem — at the shadow azimuth the walls are in shadow and carry 3% of the light, while
the flat lit roof plane carries essentially all of it.

The pre-registered facade-only threshold was `W_sh/W_lit ≥ 0.06797`. Measured:
**0.007739**. NO-GO by a factor of about nine, and the model form was chosen by that
measurement rather than by preference.

### One instrumentation bug, caught by its own sanity check

The first decomposition did not sum: W + R exceeded L_full by more than the wall term
itself. The cause was that **a black dielectric is not black** — glTF gives every
dielectric a fixed ~4% specular floor, so a zero base colour still returned 0.016708 of
neutral grey over 3,131 pixels. A conductor's F0 *is* its base colour, so the occluder
material became `metallicFactor: 1`. Without the additivity check this would have
produced a confident, precise, wrong split.

A residual of −0.7% to −3.4% remains, which makes each class slightly overstated in
isolation — the conservative direction for a test asking whether walls carry enough.

### The derived term, and why it halts

Model: a roof-only linear-light scalar, approximating the rooftop groups the prism omits
(T002's frame check measured 3.59 m of rooftop mass present in the source and absent from
the prism).

```
roofScalar = 1 − (roof-occupying prism footprint area) / (tier-0 ring area),
             area-weighted across the cell, water-tank legs excluded
```

Water-tank legs sit beneath the tank they support; counting them would double-charge one
piece of hardware — in the direction that would have made passing *easier*.

- Derived `roofScalar` = **0.98616742** (occupied fraction 0.01383)
- Pre-registered admissible band for a roof-only scalar: **[0.693789, 0.977280]**
- **Derived value is outside the band.** It delivers 0.000547 of the 0.000899 absolute
  shadow-pose reduction required — **61% of what is needed**.

The band and the delivered figure come from **different masks** — T002's means are over
the union of source and baked silhouettes, the decomposition's over the full variant's
own alpha — a ~6.9% scale gap. Restated in one set of units the shortfall is **65%** and
the band maximum **0.978746**. The derived 0.986167 sits above both, so **the verdict is
unaffected**; the mismatch is disclosed because it is real, not because it matters here.

Six point predictions were published before any capture. The four **barred** poses are
tabulated; the two unbarred 400 m poses are omitted here and are in the record
(predicted 1.024394 at az 55 and 1.081246 at az 235):

| pose | g_eff | r_v1 | **predicted r_v2** | verdict |
| --- | --- | --- | --- | --- |
| 1200 / 55 | 0.997226 | 1.013019 | 1.010209 | PASS |
| **1200 / 235** | 0.986168 | 1.072801 | **1.057962** | **MISS** |
| 4000 / 55 | 0.997253 | 1.013554 | 1.010770 | PASS |
| 4000 / 235 | 0.986168 | 1.019795 | 1.005689 | PASS |

**PREDICTED MISS. No v2 tile was baked and no v2 capture was taken.**

### What was deliberately not done

- The term was **not enlarged** to reach the bar. A constant chosen to clear a threshold
  is a fitted constant however it is dressed up.
- The model was **not swapped** for one that predicts a pass. Selecting a model by its
  predicted verdict is the same defect as selecting a constant by it.
- The obvious extension — counting the roof area rooftop groups *shadow* rather than
  merely occupy — needs a sun elevation, and a sun elevation is a property of the
  **instrument**, not of the artifact. Baking it in would calibrate a shipped tile to a
  test rig, which is exactly the coupling this goal's own non-claims warn against.

## Scope decision

The shading term is **derived and tested but not wired into the bake path**. Integrating
a model that predicts a miss would be speculative work on a parameterization the user may
well replace. `farTierEffectiveParameters` already carries `shadingScalar` with a v1-safe
default of 1, so the integration point exists and is unused.

## Residuals and risks

1. **94 of 338 internal nodes remain unpackable** at z15 and above. The tier is usable to
   three levels and no further without another change.
2. **The decomposition's additivity residual** (−0.7% to −3.4%) is unexplained beyond the
   specular fix. It is small and conservative in direction, but it is not zero.
3. **One cell.** The shading term is derived per cell; 0.0138 is this cell's number and
   nothing here says the island's is similar.
4. **EEVEE under one sun is not the shipped Cesium renderer**, and the lod_1/far-tier
   boundary tone step remains a runtime-visible effect the Blender instrument cannot see.
   Both are T003 concerns and neither is discharged here.
