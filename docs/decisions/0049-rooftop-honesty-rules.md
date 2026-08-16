# ADR 0049 — Rooftop honesty rules for the mass-generation envelope

Status: accepted as a BUG FIX and a designed rule, both inert in the shipped
grammar. Activation is scoped to the T004 mass-generation envelope and is
gated on the Stage-0 evidence, not granted here.
Date: 2026-08-16
Task: T004 (Stage 0)
Supersedes: nothing. Amends nothing. Extends the `V3GrammarOptions` seam that
ADR 0048 introduced, and takes that ADR's reasoning about why an extension
cannot be a default as given.

## Context

The V3 grammar tops every building with a rooftop cluster: one roof-equipment
box, one water tank, and four legs holding the tank up. The cluster is scaled by
a single permille factor derived from the crown's interior clearance, and
anything that still will not fit inside the crown ring is DROPPED rather than
clipped — the module's own comment says why:

> Anything that could not be placed inside the crown is dropped rather than
> clipped: a rooftop object hanging over the parapet is a false claim.

T004 must decide what grammar the six mass-generation waves run under. Two
properties of that cluster were measured before the decision, and both failed.

### Defect 1 — orphan legs (a bug by the code's own standard)

The containment filter is applied PER PRISM. The four legs sit at 0.7 of the
tank radius from the tank's centre and are a few hundred millimetres across, so
they lie strictly inside the tank's own footprint. A tank whose ring crosses the
parapet is therefore dropped while all four of its legs survive, and the asset
ships **four metal posts holding nothing**.

That is the same false claim the comment already forbids, one level down: the
legs are not rooftop objects in their own right, they are the support of a tank
that is not there. Nothing in the grammar ever decided to ship them; the filter's
granularity did.

**Measured prevalence.** Four of the fourteen real Block 835 footprints —
`doitt:102705`, `doitt:498980`, `doitt:835659`, `doitt:982383`, or **28.6%** —
ship a cluster with orphan legs and no tank. That sits inside the **~26-30%**
band the T003/T004 reviewer measured over the shipped city. This is not a rare
corner: roughly one shipped building in four carries it.

### Defect 2 — an unbounded cluster over a bounded building

The cluster's scale is bounded by the crown's CLEARANCE and by nothing else. The
unscaled cluster is 5,400 mm tall (2,400 mm of leg plus a 3,000 mm tank), and
the scale saturates at 1,000 permille as soon as the crown has about 4.5 m of
interior clearance — which nearly every real building has. So nearly every
building carries 5,400 mm of designed rooftop, regardless of how tall the
sourced building is.

Measured as the ratio of the cluster's top to the crown's own height:

| set | median | p95 | max |
| --- | --- | --- | --- |
| shipped city (reviewer) | 1.11 | 1.36 | 2.46 |
| T003-recovered set (reviewer) | — | — | **18.7** |

The 18.7x is reproduced exactly by this repository's own generator: a 305 mm
sourced building — a real DOITT parent, admitted only under the T003 low-rise
extension — gets 5,400 mm of rooftop over 305 mm of building, and the asset is
94.7% designed rooftop by height. The uncertainty statement this grammar ships
says the sourced ring is carried at the sourced height. It cannot also carry an
object nearly nineteen times the sourced height and stay true.

The T003 extension did not create this. It EXPOSED it: the shipped envelope
refused every building below 3,600 mm, so the worst cases never reached an
asset. Activating the extended envelope for the waves without this rule would
ship them.

## Decision

Two rules, both behind `V3GrammarOptions`, both defaulting to OFF, both threaded
`buildPlan` → `buildPrisms` AND through `validateV3Plan`'s re-derivation.

### D1 — `rooftopGroupContainment`: a leg cannot outlive its tank

Rooftop candidates now carry the cluster member they depend on. The tank and the
roof-equipment box depend on nothing; each leg depends on the tank. After the
per-prism containment filter, any candidate whose dependency did not survive is
dropped.

This is a **bug fix**, not a design choice, and the argument is the code's own:
the containment filter exists so that no rooftop object makes a claim the
building does not support. A leg is not an independent claim. It is a load path
to a tank, and a load path to nothing is exactly the false claim the filter was
written to prevent.

The converse — a contained tank whose legs were individually clipped — is NOT
introduced, because it cannot occur: the legs lie inside the tank's footprint,
so a contained tank always keeps all four. That is asserted as an invariant
rather than assumed.

### D2 — `rooftopClusterHeightClamp`: one nominal storey above the crown

The cluster may top out at most `V3_NOMINAL_FLOOR_HEIGHT_MM` (3,600 mm) above
the crown.

**Vocabulary.** The bound is the grammar's own designed storey, the same
constant `V3_LOW_RISE_HEIGHT_THRESHOLD_MM` equals, read a third way: a rooftop
cluster that is taller than a floor of the building is no longer a rooftop
detail, it is a storey the source did not report. No new number enters the
grammar, and no new geometry rule does either — the rule is expressed as one
additional `Math.min` on the **single scale the cluster already has**:

```
heightBoundPermille = floor(3_600 * 1_000 / (legHeight + tankHeight))
scalePermille       = min(clearanceScalePermille, heightBoundPermille)
```

The raw cluster height is read from the parameters rather than written down, so
a parameter change cannot leave the bound behind. With the shipped parameters
the bound is 666 permille and the clamped cluster stands 3,596 mm above the
crown.

**Measured, and NOT monotone.** The clamp scales the cluster uniformly, so it
also shrinks the cluster's FOOTPRINT — which can bring a tank the parapet was
clipping back inside the crown. Two of the fourteen Block 835 buildings
therefore end up with a TALLER observed cluster (2,304 mm of orphan legs becomes
3,596 mm of complete tank) and a truer one. This is recorded as a pinned test
rather than left as a surprise, because "a clamp only ever lowers things" is
what a reader would otherwise assume.

## Why neither rule is a default

Exactly ADR 0048's reasoning, unchanged. Both rules change the geometry of
buildings the five frozen V3 wave releases and the Block 835 packages already
shipped. Those releases are re-derived from this grammar and pinned byte for
byte against committed payload inventories, so turning either rule on by default
would move committed checksums and break "local releases remain checksum-pinned,
immutable once approved". A rule that improves an asset still needs a successor
release, not a constant edit.

## Blast radius

- **Default path**: byte-identical. Asserted for all fourteen real footprints,
  plan bytes and plan hash, with the options omitted and with them explicitly
  off; and at city scale by the T003 differential plan-hash set digest re-run
  over all 45,194 accepted parents (Stage-0 evidence item 1).
- **Frozen releases**: untouched. No release, inventory, census or reconciliation
  record changes.
- **Serving and promotion**: untouched. Nothing here reaches the runtime, so the
  runtime rollback surface of this ADR is zero.
- **Successor output only**: the geometry that moves is the geometry of assets
  nobody has generated yet.

## The re-measurement this decision REQUIRES

A fix that is argued and not re-measured is a claim. Activation for the waves is
conditional on all of the following being measured after the fix, over a
1-in-20 stride of the ledger order (~2,250 buildings) under the extended
envelope plus both rooftop rules:

1. **Orphan-leg count: MUST be 0.** Not "reduced".
2. **Cluster-top ratio quantiles, pre-fix and post-fix**, over the same stride,
   measured rather than projected from the fourteen.
3. **The LOD 0 / LOD 1 projected-silhouette deviation** of every strided
   building against the multi-LOD schema's 2% cap, with the count at or over
   0.02 stated explicitly. Any building over it stops the waves.
4. The six sub-1 m buildings named, with sourced heights and post-clamp ratios.

Those measurements are the Stage-0 gate record under
`data/mass-generation-20260816/`, and the numbers are quoted in
`docs/implementation/20260816-mass-generation-stage0.md`.

## Measured outcome

Run over a 1-in-20 stride of the ledger order, 2,250 buildings materialized at
both levels of detail under the extended envelope plus both rules.

| | pre-fix | post-fix |
| --- | --- | --- |
| buildings with orphan legs | **573 (25.47%)** | **0** |
| orphan legs total | **1,653** | **0** |
| cluster-top ratio median | 1.1075 | 1.0961 |
| cluster-top ratio p95 | 1.4061 | 1.3260 |
| cluster-top ratio max | 2.8342 | 2.2240 |
| cluster above crown, max | 5,400 mm | **3,596 mm** |

The 25.47% orphan prevalence is inside the ~26-30% band the reviewer measured
over the shipped city, so the fourteen-footprint 28.6% was not a small-sample
artefact. The clamp's bound holds on every building. **70** buildings gained a
complete water tank because the clamp brought a clipped one back inside the
parapet — the non-monotonicity above, at city scale.

### The bound is the building's own storey

Rule 2 first bounded the cluster at `V3_NOMINAL_FLOOR_HEIGHT_MM` for every
building. On a building that HAS a 3.6 m storey that is the grammar's own
designed number and the right one. On a 305 mm parent it is not — the grammar
asserts a storey the building does not have, and the clamped asset was still 92%
designed rooftop by height. The bound is therefore `parameters.targetFloorHeightMm`:
the nominal storey at and above 3.6 m, the sourced height below it. The floor is
80 permille, the same lower bound the cluster's plan scale already carries,
because below it the cluster degenerates into millimetre prisms and a rule that
produced sub-millimetre geometry to satisfy a height bound would trade one false
claim for another.

At and above 3.6 m it is a **byte-identical no-op**, algebraically —
`targetFloorHeightMm` IS 3,600 there and `floor(3,600,000 / 5,400) = 666`, well
above the 80-permille floor — and empirically: all fourteen real Block 835
clamped plan hashes are pinned unchanged.

Six parents of 45,194 carry a sub-metre sourced height. All six are named rather
than summarized, because an earlier draft of this section claimed "all six
behave the same way" and that was false of the nominal-storey bound: five ratios
fell and `doitt:408121` ROSE, 3.14 to 4.93. Under the storey-aware bound all six
fall, and the reason the sentence was wrong is still live and is pinned as a
test rather than deleted with the number that exposed it.

| parent | sourced height | pre-fix ratio | nominal-storey bound | storey-aware bound | above crown |
| --- | --- | --- | --- | --- | --- |
| `doitt:1261650` | 0.3048 m | 18.7049 | 12.7902 | **2.4164** | 432 mm |
| `doitt:1303611` | 0.6085 m | 9.8670 | 6.9048 | **1.9934** | 605 mm |
| `doitt:1305414` | 0.6096 m | 9.8525 | 6.8951 | **1.9918** | 605 mm |
| `doitt:1302036` | 0.9144 m | 6.9081 | 4.9344 | **1.9989** | 913 mm |
| `doitt:1302037` | 0.9144 m | 6.9081 | 4.9344 | **1.9989** | 913 mm |
| `doitt:408121` | 0.9144 m | 3.1400 | **4.9344** | **1.9989** | 913 mm |

The 305 mm parent lands at 432 mm rather than at 305 mm because its own storey
asks for 56 permille and the scale floor is 80. That is a stated cost, not a
rounding: 1.4x its sourced height of designed rooftop rather than 11.8x.

### The clamp is a bound, not a reduction

`doitt:408121` under the NOMINAL-STOREY bound is the property at its most
visible, and it is measured rather than argued:

- **pre-fix**: `roof-equipment` 978 mm and **three water-tank legs** 1,956 mm
  tall holding **nothing** — the tank crossed the parapet and was dropped, and
  the fourth leg with it. 1,956 mm above the crown, 3.14 crown-heights.
- **under the nominal-storey bound**: a **complete water tank** 1,998 mm on four
  1,598 mm legs, 3,596 mm above the crown, 4.93 crown-heights.

The ratio rose because the clamp shrank the cluster's FOOTPRINT along with its
height, which brought the clipped tank back inside the crown; the recovered tank
stands taller than the orphan legs that were the tallest surviving prism. The
asset went from four metal posts holding nothing to a bounded, complete cluster,
and its cluster-top ratio went UP. The storey-aware bound shrinks it further, so
this row now falls like the others — but the non-monotonicity is a property of
the rule and not of one number, and it is pinned by two of the fourteen real
Block 835 footprints (`doitt:102705`, `doitt:982383`), which recover a tank under
the clamp at any bound.

The clamp bounds all six; it does not make a 305 mm building under 432 mm of
designed rooftop a good claim, which is Decision 3's problem and not this ADR's.

**Neither rule materially affects the LOD-transition silhouette OF THE OVER-CAP
SET, and the exception is named.** Rooftop prisms are emitted at both levels of
detail, so they cancel. The 7.75e-5 bound below is measured over the 19 stride
buildings that sit at or over the multi-LOD 2% cap, and it is a statement about
THOSE buildings only — it is not a bound on the deviation change across the
whole population, which this ADR did not measure and does not claim. All
nineteen are already over the cap under the shipped grammar.

Scoped the same way at island scale: among the **425** over-cap parents the
exhaustive pass found, exactly **one** (`doitt:401323`) crosses the cap
*because* of these rules.

The EXHAUSTIVE island pass, which supersedes that stride as evidence, records
425 over-cap parents of 45,032 measured (0.944%), and attributes every one:

- **415** were already over the cap under the shipped grammar;
- **9** are buildings the shipped grammar REFUSES outright
  (`source-height-below-grammar-minimum`) — T003 low-rise recoveries, which have
  no shipped-grammar deviation to be over or under, so their presence is a
  building that did not exist rather than a building that got worse;
- **1**, `doitt:401323`, genuinely crosses because of these rules: 0.019780 to
  0.020410, a delta of 6.3e-4.

One building of 45,032 is the honest residual, and it is named rather than
absorbed into an "already over the cap" count. The largest deviation change
either rule makes anywhere on the island is 1.394e-3. The over-cap set is not a
gate failure any more: ADR 0050 decides what LOD 1 IS for those buildings.

## Rights and retention

Nothing here acquires, publishes, conveys or redistributes anything. The rules
are inert code plus tests; the Stage-0 measurement that follows retains bytes
locally only (gitignored payloads, committed inventories and summaries), conveys
nothing, widens no approval envelope, and touches neither serving nor promotion.

## What is not decided here

- Whether the waves run under the extended admission envelope at all. ADR 0048
  withheld that and this ADR does not grant it.
- Whether a two-LOD wave ships. That depends on Stage-0 evidence item 4.
- Anything about the rooftop cluster's visual acceptability. A bounded, complete
  cluster is not a validated one; these rules remove two provable falsehoods and
  claim nothing further.
