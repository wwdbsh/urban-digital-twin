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

T002 rendered its two subjects with both resident and hid one per render using
`hide_render`. **A hidden object still participates in EEVEE's lighting.** It casts
shadows onto the measured subject, and its mere presence brightens it.

| arrangement at 1200 m / az 235 | baked mean | ratio |
| --- | --- | --- |
| both resident, other hidden by `hide_render` | 0.04230319 | **1.072801** |
| as above, hidden subject not casting shadows | 0.04292261 | 1.088509 |
| other subject's collection excluded from view layer | 0.03951735 | 1.002152 |
| other subject deleted | 0.03951735 | 1.002152 |

T002 committed **0.042303** and **1.072801**. The first row reproduces both to six
decimals. **T002's MISS was an artifact of its own arrangement.**

That the second row is *brighter* than the first is the tell: the hidden objects
were casting shadows, and removing that casting lifts the reading further. So
`hide_render` suppresses camera visibility and nothing else.

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

Seven of seven deliberate perturbations were refused, each naming the right
setting. Two capture cycles separated by a deliberate whole-instrument
perturbation reproduced **exactly**: worst delta **0.0** at every pose, against a
pre-registered tolerance of 0.001.

**Limitation, disclosed:** a true process restart was not performed, because
restarting Blender drops the MCP channel this session runs over. The test is
purge-and-rebuild in one process. It exercises every pinned setting but cannot
exclude a defect only a fresh process would clear.

## Two findings that survive pinning

Both are **tile properties**, not artifacts — they reproduce exactly under the
pinned spec.

**4,000 m / azimuth 235 reads 5.7% dark.** The evidence points at the *source*
moving, not the tile: between 1.2 km and 4 km the source brightens 7.0%
(0.039432 → 0.042190) while the tile is nearly flat (0.039517 → 0.039774).
Attributed to sub-pixel rooftop geometry the prism does not carry — which is what
T011's ablation independently found. **Mechanism inferred from the distance trend,
not demonstrated by a controlled ablation at 4 km**, and labelled as an inference.

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
