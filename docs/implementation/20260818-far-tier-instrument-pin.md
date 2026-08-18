# T012 — pinning the appearance instrument, and finding what actually drifted

Date: 2026-08-18
Task: T012 (Goal `manhattan-hlod-far-tier`, Issue #116)
Branch: `fcp/116-instrument-pin`
Decision record: [ADR 0058 amendment](../decisions/0058-far-tier-bake-architecture.md)
Evidence: `data/far-tier-hlod-instrument-20260818/` (`pinned-instrument-spec.json`,
`divergence-attribution.json`, `pinned-baseline.json`,
`t004-gate-pre-registration.json`, each with a `.sha256`)

This branch also carries T011's four evidence commits, which the PR lands.

## The finding

Three tasks and four sessions disagreed about a byte-identical tile. The cause was
not a render setting. It was the **scene arrangement**.

T002 held both subjects in the scene and hid one per render with `hide_render`.
Because every arrangement's ratio divides by the isolated source mean, and T011
reproduced T002's *source* bit-exactly under isolation, the arrangement was
**asymmetric in consequence**: the source was measured effectively alone, the baked
subject with 48 hidden source meshes resident. **Scene residency moves the reading
by +7.0%.**

| arrangement at 1200 m / az 235 | baked mean | ratio |
| --- | --- | --- |
| both resident, other hidden by `hide_render` | 0.04230319 | **1.072801** |
| as above, hidden subject not casting shadows | 0.04292261 | 1.088509 |
| other subject's collection excluded from view layer | 0.03951735 | 1.002152 |
| other subject deleted | 0.03951735 | 1.002152 |

T002 committed **0.042303** and **1.072801**. The first row reproduces both to six
decimals. **T002's MISS was an artifact of its own arrangement.**

That the second row is *brighter* than the first shows the hidden meshes were
casting shadows onto the measured subject. Beyond that the **mechanism is not
traced** into EEVEE's internals — and with ray tracing and fast GI off and the world
at strength zero there is no obvious indirect-light path for the remainder. The
effect is measured, bounded and eliminated; it is not explained.

## What the hypotheses actually showed

Four of my five candidates were wrong, and being wrong cheaply was the point.

| # | hypothesis | result | verdict |
| --- | --- | --- | --- |
| H1 | anisotropic filtering | identical to 8 dp across FILTER_0/2/8/16 | rejected |
| H2 | `gl_texture_limit` | no effect beyond the 8th dp | rejected |
| H3 | atlas colour space | ratio 1.002 → **2.322** under Non-Color | rejected — wrong sign and 2 orders too large |
| H4 | sample count | ~0.1% | rejected |
| H5 | scene residency | **+7.0%, reproduces T002 exactly** | **confirmed** |

H1 and H2 are still pinned despite being inert. A setting proven inert under one
engine version is not guaranteed inert under the next, and pinning costs nothing.

H3 is retained in the record as a reminder: loading the atlas as Non-Color is the
single most destructive misconfiguration available here, worth 132%.

## The pin

`src/release/far-tier-instrument.ts` holds the spec, and the capture harness is
**generated from it** — so the two cannot drift, which was the failure mode one
level up. It covers Blender version, engine, ray tracing, fast GI, samples, filter
size, the whole colour-management chain, output format and depth, camera, sun,
world, **user preferences**, mask semantics, and **subject isolation**.

The harness reads every value back out of Blender before capture and fails closed.
It earned its keep during construction by refusing two of my own errors: a
`FILTER_1` enum value that does not exist, and a 1e-6 tolerance on a camera angle
that cannot survive a degrees↔radians round trip.

**Nine of nine** deliberate perturbations were refused, each naming the right
setting — including the two isolation controls (a mesh left with `hide_render`, and
a wrong renderable-mesh count). Two capture cycles separated by **five named
settings** (exposure 0.7, ray tracing on, 8 samples, filter size 3.0, anisotropy
FILTER_16 — not the *entire* instrument, as an earlier draft overstated) reproduced
**exactly**: worst delta **0.0** at every pose against a pre-registered 0.001.

The baseline was then re-captured under **spec v2** and reproduced exactly again,
which is how the newly added pins were shown to have been at their pinned values
during the v1 capture rather than merely asserted. And T011's
`rebaseline-results.json` raytracing-off column is **numerically identical at all
six poses** — a cross-task, cross-rebuild exact reproduction, and the strongest
stability evidence this goal holds.

Not everything is enforceable: the pose list, mask semantics, the recorded GPU
backend and the procedural clearing steps are **prose-only and unenforced**, and
the record labels them so rather than letting a blanket "everything is enforced"
claim stand.

**Limitation, disclosed:** a true process restart was not performed, because
restarting Blender drops the MCP channel this session runs over. The test is
purge-and-rebuild in one process. It exercises every pinned setting but cannot
exclude a defect only a fresh process would clear.

## Two findings that survive pinning

Both are **tile properties**, not artifacts — they reproduce exactly under the
pinned spec.

**4,000 m / azimuth 235 reads 5.7% dark.** Attributed to the tile; **mechanism
unattributed** — the same restraint applied to hue.

I first blamed sub-pixel rooftop geometry and cited T011's ablation as consistent.
**The ablation says the opposite**, and it was co-landed on this very branch:
deleting rooftop mass makes the *source brighter* at every pose. The roof-free
source still rises **+5.8%** from 1.2 km to 4 km against +7.0% with rooftops — so
rooftops account for only ~1.2 of the 7.0 points — and the tile's deficit against a
roof-free source **widens from 5.7% to 8.4%**. Rooftop mass cannot explain a source
that is brighter than the tile at distance. The claim is withdrawn.

Named as a **candidate, not a conclusion**: the atlas's 14.67% unused black area
averaging in under progressive minification, which matches the monotone azimuth-235
trend 1.0199 → 1.0022 → 0.9427. No controlled test isolates it here.

The lesson is not subtle: the refuting data was on the same branch and I did not
consult it before writing the claim.

**Hue spread exceeds 0.02 at five of six poses**, grows with distance at both
azimuths, and red is consistently the deficit channel (0.907/0.931/0.941 at
4000/235). Previously *masked* by the residency artifact, which pulled channel
ratios toward unity. Attribution to the tile is well supported; **the mechanism is
left unattributed rather than guessed**.

## The gate proposal, and what I refused to decide

The inherited union-ratio bar is ill-conditioned on dark poses: source luminance is
~5× lower at azimuth 235, so a fixed *relative* bar admits five times less absolute
error there for no stated reason. At 4000/235 an absolute difference of 0.0024 —
among the smallest measured — becomes a 5.7% MISS, while 0.0087 at 400/55, over
three times larger, is a 4.0% PASS.

Proposed: **A1** relative 0.05 on poses with source mean ≥ 0.10; **A2** absolute
|baked − source| ≤ 0.010 at every pose; **A3** hue spread ≤ 0.02 at every pose.

A1 and A3 are inherited unchanged. A2 is *derived* — 0.05 × 0.21 = 0.0105 → 0.010,
what the inherited bar means in absolute terms on a well-exposed pose. None was
chosen by reference to what the tile scores; the scores were computed afterwards.

**And that is exactly why it is flagged.** Adopting A2 converts 4000/235 from the
only surviving tone failure into a pass. A gate change that flips the one failing
verdict must not be made by the party measuring it. Four options are laid out in
the record; the decision is the user's.

Hue is unaffected by that question and misses at five of six poses under every form
considered. It needs an owner.

## Risks

1. **No process-restart reproduction.** Disclosed above.
2. **The red deficit has no mechanism.** It is real, reproducible and growing with
   distance, and nothing here explains it.
3. **Every appearance number older than this baseline is superseded**, including
   ones quoted in T010's and T011's committed records. Those records stay as
   written; readers must follow the supersession chain in the ADR amendment.
4. **The instrument is pinned, not validated.** Nothing here says EEVEE under one
   sun predicts the shipped Cesium renderer.
