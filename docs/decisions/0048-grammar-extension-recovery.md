# ADR 0048 — Grammar extensions for the recoverable refusals

Status: accepted as a MEASUREMENT and a design. **Activation is NOT decided
here** and is explicitly withheld — see "What is not decided".
Date: 2026-08-15
Task: T003
Supersedes: nothing. Amends nothing. Corrects two premises of its own task
contract and one figure in ADR 0046's T001 projection.

## Context

899 of the 45,194 canonical parents ship no exterior. The goal's acceptance
criterion 1 is NOT-MET on exactly that number, and its stated bar is that **only
degenerate-data refusals may remain tombstoned**. The 899 are not one problem:
the six committed wave censuses decompose them into 864 plan-stage refusals and
35 asset-stage volume-identity failures, and the plan-stage half decomposes
further by which admission rule of the grammar the sourced polygon failed.

| shipped stop code | count | what it says |
| --- | --- | --- |
| `source-height-below-grammar-minimum` | 384 | the grammar's requested floor is taller than the building |
| `ring-vertex-count-unsupported` | 324 | the ring is more finely traced than a cap allows |
| `ring-area-below-floor` | 113 | the footprint is under 20 m² |
| `ring-neck-below-grammar-minimum` | 39 | the ring is too pinched to carry two opposed recesses |
| `volume-identity-failed` | 35 | the emitted mesh missed its analytic volume |
| `ring-not-simple` | 4 | the ring self-intersects after millimetre rounding |
| **total** | **899** | |

The first two describe the GRAMMAR. The last four describe the SOURCE. That
split is the whole design.

### The naive plan, and why it is wrong

The task was first shaped as "three new grammars" — a many-vertex grammar, a
low-rise grammar and a small-structure grammar — each a sibling module in the
V2/V3 style. Architectural review found four reasons that shape is wrong, and all
four survived measurement:

1. **The grammar already self-clamps.** A low-rise needs no new massing code.
   `planTiers` clamps `floorCount` to at least 1
   (`deterministic-facade-generator-v3.ts:1218`), clamps `requestedTierCount` to
   `min(tierCount, floorCount)` (`:1233`), returns a single-tier massing when
   that is 1 (`:1247`), and `validateV3Plan` already admits `setbacks: absent` at
   a single tier (`:1732`). `buildPlacements` already skips a cornice that will
   not fit (`:1432`) and an opening whose row is too short (`:1441-1447`). The
   single-band massing a "low-rise grammar" would have been written to produce is
   what the existing code produces once it is asked for one floor.
2. **The 64-vertex cap carried no documented rationale.** Every neighbouring
   limit in `DETERMINISTIC_FACADE_V3_LIMITS` states the fact it derives from —
   `maxRingMillimeters` from exactness of the orientation predicate in doubles,
   `minRingAreaMm2` from what a footprint has to be to be a building,
   `maxAssetTriangles` from a measured frame-time re-check. `maxRingVertices`
   stated nothing. It is not a budget, not a measured cost and not a property of
   the source.
3. **Simplification is foreclosed by the module charter.** The module header
   states that V3 "carries the sourced ring VERBATIM. There is no simplification
   pass" (`:11-13`). A many-vertex grammar that decimated rings would contradict
   the module's own reason for existing, and would falsify the massing sentence
   of `DETERMINISTIC_FACADE_V3_UNCERTAINTY`.
4. **The refusal vocabulary is frozen.** `MIDTOWN_CORE_V3_STOP_CODES` is pinned
   verbatim by the goal's committed reconciliation record through
   `computeCensusClosure`. A new grammar wanting a new code would move a
   goal-level contract.

So the corrected design is **two conditional extensions inside the existing
generator, following the `styleOverride` additive precedent, plus one measured
refusal** — no sibling module, no new stop code, no simplification.

## Decision

### Extension A — ring-vertex admission cap

`V3_EXTENDED_MAX_RING_VERTICES = 384`, against the active
`DETERMINISTIC_FACADE_V3_LIMITS.maxRingVertices = 64`
(`deterministic-facade-generator-v3.ts:120-137`).

Bounded by measured input rather than chosen. The committed citywide histogram
(`data/citywide-overview-census-20260814/distributions.json`) records exactly
324 parents above 64 distinct ring vertices out of 45,194, with a maximum of
**362**. 384 is that observed maximum plus headroom, and it remains a bounded cap
— 385 vertices is still refused.

The raise is safe because nothing in the ring pipeline assumes 64: every stage is
generically `O(outer.length)`. The superlinear predicates were **timed at the
observed maximum rather than assumed cheap**, on the 362-vertex ring of
`doitt:17224`:

| predicate | complexity | measured at n = 362 |
| --- | --- | --- |
| `ringIsSimple` | O(n²) | 1.05 ms |
| `earClipRing` | O(n³) worst case | 40.3 ms |
| `ringLocalThicknessMm` | O(n³) via its interior-midpoint test | 50.0 ms |

End to end, the recovered set's per-building plan wall clock is median 5 ms, p95
104 ms, max 582 ms. That worst case is the 362-vertex ring, and it is bounded.

A cap is read only by the admission gate and by the text of the refusal that gate
writes. No plan content depends on it, so it ships **no designed massing**: the
same sourced ring is carried vertex for vertex at the same sourced height. The
massing sentence of `DETERMINISTIC_FACADE_V3_UNCERTAINTY` stays literally true
and no Blender pass is owed for A.

### Extension B — low-rise floor-height derivation

One conditional in `deriveV3Parameters`. Below
`V3_LOW_RISE_HEIGHT_THRESHOLD_MM` (3,600 mm, which IS the nominal floor height
restated), `targetFloorHeightMm` becomes the sourced height itself, so
`floorCount` is exactly 1 and the clamps listed above produce the single band.

**The tombstone-exclusion proof.** The 384 are not missing data. The full-city
dry run (`data/normalized/manhattan-exterior-fullsnapshot-dryrun-20260810/evidence.json`)
records `stopsByCode.invalid-height = 0` over all 45,194 parents: every one of
the 384 carries a real sourced height. The 76 `heightUnknown` parents take the
10 m `MIDTOWN_CORE_FALLBACK_HEIGHT_METERS` fallback and are therefore not in the
set — and the census re-measures this rather than assuming it:
`fallbackHeightAmongThem = 0`. Their measured heights run from 305 mm to
3,596 mm, median 3,154 mm.

**The disjointness proof — mandatory, and it holds.**
`validateV3Input:1048` refuses any input with
`heightMm < parameters.targetFloorHeightMm`. The only floor height
`deriveV3Parameters` has ever produced is 3,600 mm. Therefore **every input this
grammar has ever accepted satisfies `heightMm >= 3,600`**, and a branch taken
strictly below 3,600 mm cannot reach a single accepted plan. The branch is
consequently disjoint from every committed plan hash by construction, not by
luck. It is pinned three ways: a unit test asserting `deriveV3Parameters` is
byte-identical at and above the threshold (boundary, sweep, and all fourteen real
Block 835 footprints at their real heights); a unit test asserting the branch does
fire at 3,599 mm, so the pin is disjointness and not a dead branch; and the
city-scale differential digest below.

**No massing is substituted.** `floorBoundaryZMm` divides the sourced height into
`floorCount` bands, so one band spans it exactly. The ring is still the sourced
ring and the extrusion is still the sourced height; only the interior banding
changes. Verified by unit test (`tiers[0].ring` equals the sourced ring,
`topZMm - baseZMm` equals the sourced height) and by Blender re-import (below).
**No third uncertainty statement is added, and none is owed.**

### Blender sampling — what it confirmed, and what it caught

Extension A ships no designed massing at all, so no Blender pass is owed for it
and none was run; that is stated rather than skipped silently. Extension B does
change what renders on 375 real buildings, so eight were re-imported through
Blender MCP — four from each height band, taken at an even stride through the
recovered set.

**The wall massing is exact on all eight.** Every building's imported X and Y
extents equal the sourced ring's own extents to the printed precision, and the
crown elevation equals the sourced height exactly (`roofZ == heightMm`, per-vertex
shape deviation ≤ 0.67 mm, ring-vertex presence 0.0 m, vertical deviation
≤ 0.26 mm). The claim that B changes only interior banding survives measurement.

**But the imported Z extent did not equal the sourced height, on any of them** —
and the reason is a pre-existing V3 rule that extension B exposes at scale. The
designed rooftop cluster (`buildPrisms`) is scaled by the crown's HORIZONTAL
clearance and never by the building's height, so on a low-rise it is not small:

| building | sourced height | rendered silhouette top | ratio |
| --- | --- | --- | --- |
| `doitt:1288665` | 2.743 m | 8.143 m (3.0 m water tank on 2.4 m legs) | 2.97× |
| `doitt:589985` | 3.286 m | 6.337 m | 1.93× |
| `doitt:1008967` | 3.048 m | 5.078 m | 1.67× |

Measured across all 694 recovered buildings, the rendered silhouette top over the
sourced height is median 1.38×, p95 2.61×, **max 18.7×**; restricted to the 375
low-rise recoveries it is median 1.68×, p95 2.81×, max 18.7×. A garage under a
water tower nearly nineteen times its own height is not a truth claim — the
uncertainty statement already discloses water tanks as designed and asserting
nothing — but it is a fidelity failure a viewer would read as one.

A second defect surfaced in the same pass: `buildPrisms` filters each prism for
crown containment INDIVIDUALLY, so a water tank can be dropped while its legs
survive. **117 of the 694** recovered buildings ship water-tank legs holding up
no tank. This is pre-existing and affects the shipped waves too; it is recorded
here because this is where it was found.

Neither defect is caused by extension B and neither is fixed here — fixing them
is designed geometry and belongs to its own task. Both are **activation blockers**
for B: shipping it as-is would put absurd rooftop clusters on 375 real buildings.

### Extension C — sub-20 m² footprints: REFUSED BY DESIGN

Measured first, decided second, exactly as required. The area distribution of the
114 rings below the floor (113 priority-coded `ring-area-below-floor`; one more
that the priority-ordered classifier reports as `ring-vertex-count-unsupported`):

| area band (m²) | 4–6 | 6–8 | 8–10 | 10–12 | 12–14 | 14–16 | 16–18 | 18–20 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| count | 2 | 2 | 4 | 8 | 18 | 26 | 26 | 28 |

min 4.67 m², median 15.80 m², p95 19.25 m², max 19.82 m².

**The decision is to refuse all 114, and the reason is the shape of that
distribution.** It is a monotone ramp rising toward the threshold with no gap and
no second mode — the signature of a cut through a continuum, not of a separable
population of plausible small structures sitting near the floor. There is no
boundary anywhere in [4.67, 19.82] m² that the data itself nominates. Choosing
one — "recover 15–20 m²" — would be asserting where the digitising-artefact
boundary lies with no source evidence for it, which is precisely the failure the
invariant "unknown or ambiguous source facts must never become asserted truth"
forbids.

Two further measurements support the refusal rather than contradicting it. The
neck gate is **not** what blocks these rings — local thickness runs 2,062 mm to
4,302 mm and **zero** of the 114 are below the grammar's 600 mm minimum — so
recovery would not be blocked downstream; it would genuinely ship 114 assertions
that a 4.67 m² polygon is a building. And **68 of the 114 are also below the
nominal floor height**, i.e. tiny in plan AND under 3.6 m tall, which is what a
sliver or a traced appurtenance looks like, not a garage.

The code's own recorded rationale already says this, at
`deterministic-facade-generator-v3.ts:156-157`: "Twenty square metres. Below this
a 'building footprint' is a digitising artefact." Blanket recovery would have
overridden a documented source judgement with nothing.

**Adjudication.** Leaving these 114 tombstoned is CONSISTENT with the goal's
acceptance criterion, which permits degenerate-data refusals to remain. The
grammar's own recorded rationale classifies them as data artefacts, so they are
degenerate-data refusals by the repository's own standing definition. This is
stated as an adjudication rather than assumed.

## Evidence

### The determinism instrument: differential plan-hash set digest

All 45,194 parents were planned **twice in one process**, once under each
envelope, through the `V3GrammarOptions` seam rather than by mutating module
state — a differential that mutated the module would prove nothing about the
module anybody ships. A domain-separated SHA-256 was taken over the sorted
`buildingId \t planHashSha256` list of every parent the shipped envelope accepts.

Cardinality equality is **not** identity, per T001's own adjudication note, and
is not what is asserted here: the digest covers each building's own hash.

| envelope | accepted set | digest |
| --- | --- | --- |
| shipped (64 / low-rise off) | 44,295 | `fd22c08a19fe0a225cd81301fb0e485f6a1851b0b8054a58eab393aa32077667` |
| extended (384 / low-rise on) | 44,295 | `fd22c08a19fe0a225cd81301fb0e485f6a1851b0b8054a58eab393aa32077667` |

Byte-equal. `movedPlanHashCount = 0`.

The same pass re-derives the goal ledger end to end from the pinned snapshot:
**44,295 materialized / 899 refused**, in exact agreement with the committed
reconciliation record it never writes to.

### Recovery, and reclassification, kept apart

The shipped classifier is priority-ordered, so raising a gate exposes the next
one. A building that changes code but stays refused is **not progress**, and the
census counts the two separately.

| shipped stop code | refused | RECOVERED | still refused |
| --- | --- | --- | --- |
| `source-height-below-grammar-minimum` | 384 | **375** | 9 |
| `ring-vertex-count-unsupported` | 324 | **319** | 5 |
| `ring-area-below-floor` | 113 | 0 (by design) | 113 |
| `ring-neck-below-grammar-minimum` | 39 | 0 | 39 |
| `volume-identity-failed` | 35 | 0 | 35 |
| `ring-not-simple` | 4 | 0 | 4 |
| **total** | **899** | **694** | **205** |

Reclassifications — refused before, refused after, under a different code — total
**14**, and every one is legible:

| transition | count |
| --- | --- |
| `source-height-below-grammar-minimum` → `volume-identity-failed` | 8 |
| `ring-vertex-count-unsupported` → `ring-neck-below-grammar-minimum` | 4 |
| `ring-vertex-count-unsupported` → `ring-area-below-floor` | 1 |
| `source-height-below-grammar-minimum` → `ring-neck-below-grammar-minimum` | 1 |

Residual by post-extension code: `ring-area-below-floor` 114,
`ring-neck-below-grammar-minimum` 44, `volume-identity-failed` 43,
`ring-not-simple` 4. **Zero stop codes were added**; the existing twelve absorb
every residual, which is what the frozen vocabulary was asserted to do.

Extension B's split, reported at 3.0 m because a 3.2 m storey and a 2.1 m
bulkhead are different claims about what the source describes:

| band | in the 384 | recovered |
| --- | --- | --- |
| [3.0 m, 3.6 m) | 272 | 265 |
| below 3.0 m | 112 | 110 |

This **corrects the task contract's expected ~244 / ~140 split.** The 140 came
from the V1/V2 dry run's `subThreeMeterHeight` count over all 45,194 parents
under a different height rule, not from the 384; measured against the 384 itself
the split is 272 / 112.

### Measured cost of the 694 recovered

Texture-free, both canonical LODs, from the real GLB writer.

| metric | median | p95 | max |
| --- | --- | --- | --- |
| ring vertices | 19 | 154 | 362 |
| placements | 23 | 1,057 | 4,963 |
| LOD-0 triangles | 512 | 15,000 | 65,260 |
| LOD-1 triangles | 276 | 6,112 | 25,316 |
| both-LOD bytes | 40,028 | 783,348 | 3,268,380 |
| plan wall clock | 5 ms | 104 ms | 582 ms |

Total 125,738,128 B (≈ 119.9 MiB) across 1,388 assets. The worst LOD-0 triangle
count, 65,260, is **under a third** of the 200,000 `V3_QUALITY_BUDGETS` ceiling,
which is why no recovered building refuses under `asset-budget-exceeded` and why
that budget is untouched by this ADR — it stays pinned by
`block835-v3-package.test.ts:83`.

**UV byte consequence, if a future wave ships these textured.** A projection from
T001's committed per-vertex regression (`uv-delta.json`: 7.9648 B per LOD-0 GLB
vertex + 592.7 B), applied to the recovered set's **measured GLB vertex counts**
(median 1,088, p95 30,400, max 130,756) rather than to its ring vertex counts —
the two differ by roughly two orders of magnitude, and projecting from the ring
would understate the answer by that factor.

| | median | p95 | max |
| --- | --- | --- | --- |
| recovered set, projected UV + JSON delta | 9,258 B | 242,723 B | 1,042,038 B |
| T001's worst measured stratum (`ring-41-64`) | 42,236 B | 238,900 B | 425,260 B |

The **median** recovered building is far cheaper than T001's worst stratum, but
the **tail is not**: the recovered p95 already exceeds that stratum's p95, and the
worst single building is 2.4× its max. That is expected — extension A recovers
precisely the most finely traced rings in the city — and it is recorded as a
finding for whoever decides to ship these textured, not resolved here.

### R7 — T001's projection was optimistic

ADR 0046 / T001 projected a full-city asset count of **45,116**, which implies
45,116 − 44,295 = **821** of the 899 recoverable. The measured figure is **694**.

**T001's projection was optimistic by 127 buildings.** It is recorded here rather
than quietly superseded: the projection assumed the height and vertex refusals
recovered cleanly and did not account for the 14 reclassifications, the 39
neck refusals, the 35 asset-stage volume failures, or the 113 sub-area rings this
ADR refuses by design.

## What is NOT decided here, and why

**Neither extension is active.** Both travel through `V3GrammarOptions`, whose
defaults are the shipped grammar exactly. This is a deliberate withholding, not
an oversight, and it corrects a premise of the task contract.

The contract assumed the extensions were hash-neutral, and at the PLAN layer they
are — the digest above proves it. They are **not** neutral at the RELEASE layer.
The V3 wave releases are re-derived from this grammar and pinned byte for byte
against committed payload inventories:
`src/release/midtown-core-v3-release.test.ts` rebuilds the whole midtown-core V3
release from these constants and asserts its emitted artifact set and every
checksum. Turning either extension on by default made **four** of its assertions
fail, because the release then emits inventory shards and assets the frozen
inventory does not name.

The blast radius is not one wave. Five committed V3 wave releases carry
shipped-subset buildings that a wider envelope would admit:

| wave | shipped-subset refusal | code | recovered by |
| --- | --- | --- | --- |
| midtown-core | `doitt:399990`, `doitt:555676` | `source-height-below-grammar-minimum` | B |
| midtown-core | `doitt:749711`, `doitt:88101` | `ring-vertex-count-unsupported` | A |
| lower-manhattan | `doitt:602678` | `ring-vertex-count-unsupported` | A |
| southern-remainder | `doitt:938827` | `source-height-below-grammar-minimum` | B |
| central-upper-manhattan | `doitt:996078` | `ring-vertex-count-unsupported` | A |

Only midtown-core has a test that re-derives its bytes, so the other four would
have drifted silently. Activating by constant edit would therefore break "local
releases remain checksum-pinned, immutable once approved" and would broaden the
contents of an approved release without authorization.

The rooftop-scale and orphan-leg defects found by the Blender pass are a second,
independent reason not to activate B yet.

**The resolution is a successor release, not a constant edit**, and it is left to
be adjudicated. Two candidates, both consistent with this repository's own
precedent:

- **R1 — envelope in the wave profile.** Add the admission envelope to
  `V3WaveProfile` and pin the six frozen wave profiles to the shipped envelope,
  so a new approved wave selects the extended one. This is the device the module
  already uses for exactly this purpose ("everything that differs between waves is
  collected here and nowhere else"). Note that `midtownCoreV3StageFingerprint`
  enumerates profile fields explicitly, so whether the new field enters that
  fingerprint is itself a decision with a committed pin behind it.
- **R2 — extended envelope selected per wave at the call site**, exactly as the
  seam already allows, with the frozen waves passing nothing.

## Corrections to the task contract

Two premises did not survive measurement and are recorded rather than worked
around.

1. **"Plan hashes do NOT embed generator version; bump 3.0.0 → 3.1.0, it moves no
   hash."** FALSE, and proved false before acting on it.
   `DETERMINISTIC_FACADE_V3_GENERATOR_VERSION` is written into every plan through
   `buildInventory` → `inventory.components[].generator.version`
   (`deterministic-facade-generator-v3.ts:1630`), and `inventory` is part of the
   hashed body (`:1673`). A direct experiment on a synthetic plan moved the hash
   from `700717d9…` to `73b13df3…` on the version field alone. Bumping it would
   have moved every committed plan hash, including the fourteen in Block 835's
   `plan-index.json` and the `planHashSha256` metadata of every shipped GLB.
   **The generator version is NOT bumped.**
2. **The extensions are release-neutral.** False, as set out above.

One further finding, from implementation rather than from the contract:
`validateV3Plan` re-runs the input contract, so a plan legitimately generated
under a wider cap was refused by its own validator — and would have been
mislabelled `plan-validation-failed` for all 319 recovered many-vertex buildings.
The validator now takes the envelope, and the behaviour is pinned both ways.

## Consequences

- The grammar carries both extensions, fully measured, inert.
- 694 of 899 refusals are demonstrably recoverable; 205 are not.
- Of the 205, the 114 sub-area rings are refused **by design** with a stated
  rationale; 44 neck, 43 volume-identity and 4 non-simple refusals remain
  source-shaped.
- Criterion 1 cannot close on this task alone. It needs a successor release built
  under the extended envelope, which needs the approval this ADR withholds.
- New evidence lives in `data/grammar-extension-20260815/`. The six wave
  censuses, `data/goal-integration-acceptance-20260812/reconciliation.json` and
  `data/citywide-overview-census-20260814/` are unchanged, and the six censuses
  are now pinned by SHA-256 in the goal-reconciliation suite so a future
  recovery cannot rewrite the 899 it is measured against.
