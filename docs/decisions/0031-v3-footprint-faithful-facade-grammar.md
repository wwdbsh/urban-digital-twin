# 0031 — V3 footprint-faithful facade grammar

- Status: Partially accepted — kernel, writer and material system accepted; the
  V3 asset budget is NOT yet cleared, and no V3 package is built. See
  "Not yet decided" at the end.
- Date: 2026-08-11
- Related: 0020 (deterministic facade plans), 0021 (multi-LOD assembly
  packages), 0026 (Block 835 reference asset authoring), 0027 (Block 835
  generative exterior canary), 0028 and 0030 (exterior default activation)

## Context

`validateV2Input` rejects any footprint that is not a four-vertex ring. Every
Block 835 asset shipped to date is therefore the minimum-area oriented bounding
RECTANGLE of its DOITT footprint, and the V1/V2 registration report says so
explicitly: it measures pipeline drift of that rectangle and disclaims any claim
of shape fidelity to the polygon.

Measured on the fourteen pinned footprints: thirteen carry more than four
vertices, one carries nineteen, edges run down to 0.05 m, and the Empire State
Building carries fourteen vertices, a 415 m perimeter and three ~270-degree
reflex corners. The rectangle is a large, visible abstraction on exactly the
buildings a viewer will look at.

Two claims in the task contract did not survive measurement, and this ADR
records the corrections because later work will otherwise inherit them:

- Not all fourteen footprints are concave. `doitt:925937` is a convex
  quadrilateral. The grammar must stay correct on a convex ring.
- `doitt:131170` carries ONE genuine reflex vertex (182.63 degrees), not four.
  Eleven of its nineteen vertices sit within 0.02 degrees of straight. Counting
  those as reflex is what produces the larger number, and the same
  near-collinearity is a live numerical hazard for the tier offset.

## Decision 1 — V3 is a sibling module, and V2 stays byte-frozen

`src/domain/deterministic-facade-generator-v3.ts` has its own schema version,
generator id, generator version, limits and uncertainty statements, and imports
no V2 behaviour. The committed V1 and V2 packages are drift-tested artifacts;
nothing in this work may move their bytes.

## Decision 2 — The sourced ring is carried verbatim

There is no simplification pass and no vertex budget beyond a bounded 64-vertex
cap. The only vertices that disappear are exactly duplicated consecutive
millimetre coordinates. A simplification pass would reintroduce the same class of
silent abstraction the rectangle already is, and it would do so invisibly.

Winding is normalised to counter-clockwise. Every DOITT ring in the pinned pilot
release is clockwise as sourced.

## Decision 3 — Holes are forbidden, not ignored

The V3 input type has no `holes` key, and a footprint carrying one is REFUSED
rather than having it dropped. Silently dropping a hole would ship a solid
building over a courtyard — an unknown becoming asserted truth.

## Decision 4 — Reject, don't repair

An inward tier offset is refused on any of four grounds: orientation flip, area
floor, self-intersection, or — added on measured evidence — the offset ring not
being contained in the ring below it. Positive area and simplicity are NOT
sufficient: a miter offset far past the inscribed circle turns a ring inside out
into a new simple, positively oriented ring that sits outside the building.

The planner's documented response to a refusal is to drop setbacks entirely and
disclose it in `massing.setbackDisclosure`, never to nudge a vertex back into
validity. Five of the fourteen buildings take that path on their real rings, and
they declare the `setbacks` component **absent** with the refusal as its reason
rather than claiming generated geometry they do not have. That is the one and
only non-`generated` component state V3 admits, and the plan validator enforces
exactly that.

The offset itself uses the bisector form rather than a line-line intersection.
With eleven near-collinear vertices on one real ring, the two offset lines are
almost parallel and almost coincident, and solving for their crossing is a 0/0
that throws the vertex kilometres away.

## Decision 5 — Corner clearance

Placements keep clear of both ends of their edge by `depth / tan(theta/2)` below
90 degrees and by a flat `depth` from 90 degrees up, including every reflex
corner. Clearance is charged against the deepest placement the grammar attaches
to any wall, which is conservative and uniform per edge.

Bays are derived from the clearance-corrected usable span, not the raw edge
length: with the raw length the invariant is unsatisfiable. **Zero bays is
legal** and produces a blank wall, which is what makes a 0.05 m edge safe.

Corner clearance is also what makes the volume identity in Decision 8 a plain
sum: no two placement boxes can meet inside a corner, so none is double counted.

## Decision 6 — Local thickness gate

A ring whose narrowest neck is thinner than two opposed recesses plus a wall is
refused at input, because those recesses would punch through the massing.

A neck is measured vertex-to-edge AND vertex-to-vertex — the waist of a dumbbell
lot is bounded by two facing corners, so the vertex-to-edge form alone misses
the one shape the gate exists for. A candidate only counts as a neck if its
midpoint has real clearance from the boundary. Without that discriminator the
gate mistook a 51 mm digitising sliver on `doitt:584049` for a 375 mm neck and
refused a real building.

## Decision 7 — The canonical GLB writer gains a triangle path, additively

A concave cap does not decompose into quads. `CanonicalGlbTri` rides in the same
material buckets and is written AFTER that bucket's quads, so quad-only input
produces byte-identical output. Pinned by a golden hash taken from the
pre-change writer and by the untouched V1/V2/Midtown drift and replay tests.

Ear clipping runs on integer millimetres with ties broken by the lowest original
vertex index, so the index buffer depends on the ring alone and is byte-identical
across runs. Setback decks are ring-to-ring annuli; V2's four-deck box assumes an
axis-aligned rectangle and does not generalise.

## Decision 8 — The volume identity generalises to shoelace areas

V2's identity multiplied a rectangle's width by its depth. V3's is the shoelace
area of each concave tier ring times its height, less every recess box, plus
every protrusion box and rooftop prism.

This identity is the single highest-value gate in the work. It caught three
defects that every other gate passed over: protrusion boxes emitted open at the
back while the wall behind them was still drawn; rooftop prisms emitted at both
levels of detail but counted at one; and a ground-floor entrance with a different
height from its storefronts, which grouped the row into two overlapping v-bands
and tiled the same wall twice. It is pinned in the TypeScript suite so it guards
every run, not only the Blender pass.

Remaining unmatched edges are T-junctions where a full-width row strip meets the
piers above it. They are named as such and not as holes: the surface bounds a
solid, the shipped GLB duplicates every vertex per face, and no stage of this
pipeline claims a combinatorial 2-manifold.

## Decision 9 — Appearance is designed, and says so

Four style classes — masonry-warm, masonry-light, stone-neutral, curtain-cool —
selected by `domainSeparatedSha256("udt.facade.style.v3", …)`. The distribution
is modulated by sourced height and sourced footprint area and by nothing else,
and every class stays reachable for every building, so the draw reads as a
designed choice rather than an inference about an address. The names describe a
look the grammar invents.

Zoning is base/shaft only this cycle. A crown zone and horizontal banding are
deferred to T026 rather than landed in the same cycle that raises the triangle
budget; each is worth measuring on its own. Nine materials result.

`DETERMINISTIC_FACADE_V3_UNCERTAINTY` separates what the geometry follows from
what the grammar invents. The V2 signage statement is carried verbatim.

## Decision 10 — Registration compares true footprint vertices

V1 and V2 registered the oriented bounding rectangle. V3 registers the ring
itself and can make the stronger claim, with a per-vertex shape tolerance that
is deliberately a DIFFERENT measure from placement drift. The disclosure states
that the claim covers this pipeline's reproduction of the sourced polygon and
says nothing about how well that polygon matches the real building, and nothing
at all about appearance.

**The shape measure is symmetric, and its candidate set is the ring alone.**
The published number is `max(sourceToRing, ringToSource)`: the worse of (worst
sourced vertex to its nearest shipped ring vertex) and (worst shipped ring
vertex to its nearest sourced vertex). Both are stated because a one-directional
measure is weaker than it looks — it bounds only how far a sourced vertex sits
from *something* shipped, and a shipped vertex that wandered off is never the
argument of the minimum, so it cannot be seen.

The candidate set is the tier-0 ring, **not** every vertex on the ground plane.
The ground plane also carries entrance and storefront recess corners, so
searching it is searching a superset in which an unrelated detail vertex can
stand in for a ring vertex. `ringVertexPresenceMeters` is reported separately
and proves the ring being measured is the ring actually written into the bytes,
so the comparison is against an artifact rather than an intention.

On the fourteen Block 835 footprints both directions agree exactly and the
presence proof is 0.000 m, so tightening the measure moved no published number.
That is the data not exercising the failure modes, not the failure modes being
impossible; the measure is stated in the stronger form regardless.

## Decision 11 — V2 keeps serving

`src/runtime/exterior-default-activation.ts` and every committed release tree are
untouched by this work. The canary graph and the promoted activation set continue
to serve V2 this cycle; re-pointing them is T026.

## Decision 12 — The boundary any future style override must respect

No per-landmark style override exists today, and this paragraph is written
before one does, because the tempting justification for the first one is exactly
the one that must never be used.

A per-landmark style override is legitimate **only** as a documented designer
stylistic choice carrying no real-world assertion — the same standing as every
other V3 appearance decision, disclosed by the same uncertainty statement.

An override justified by real-world appearance knowledge is a different thing
entirely. "The real Empire State Building is limestone, so override it to
`stone-neutral`" is an **unsourced factual claim about a real address**, and
writing it into a style table launders it into the product as though it were
designed. If the appearance of a real building is to be asserted, it must enter
through the ADR 0022 evidence intake with a real source ref, licence and capture
date, and ship as `evidence-backed` — not as a designer's override.

The distinction is not the geometry that results; both routes can produce the
same colour. It is what the package then claims, and whether that claim has a
source behind it.

**Also noted for whoever adds resumability.** The V3 CLI has no stage-receipt
caching, by design: every stage recomputes from the committed plans, so the
T013 stale-resume defect class cannot arise here. A future author adding
resumability inherits that lesson rather than a cache — any receipt must bind
the plan hash and the input fingerprint it was computed from, or a stale receipt
will outlive the plan that justified it.

## Consequences — recorded after P5 and P6 completed (2026-08-11)

**The budget raise is now cleared, with a stated limit.** Blender re-proved the
volume identity on all 28 shipped meshes (worst relative deviation 1.88e-7
against a 1e-6 tolerance) and the shipped package's worst asset uses 51.5 % of
the raised triangle budget. A frame-time run on the served wave shows no
regression (median 8.3 ms, p95 10.2 ms against 16.7 / 25). **That run measures
V2, because V2 is what the canary still serves.** `V3_QUALITY_BUDGETS`
therefore gates the V3 package's own build and nothing that renders; a rendered
V3 frame-time measurement is T026's, and this ADR claims none.

**Decision 4 (reject, don't repair) has a manifest cost, and it is paid.** Five
of fourteen buildings refuse their tier offset and ship `setbacks` as `absent`
with the cause attached. The V2 assembler asserted a lone `generated` truth
tier; the V3 assembler path accepts `absent` for that one kind and that one
cause only. Refusing to carry the refusal into the manifest would have been the
dishonesty the decision exists to prevent.

**Decision 10 is now measured, not just stated.** Worst per-vertex shape
deviation against the sourced polygon is 0.68 mm against a 50 mm tolerance,
with whole-asset placement drift reported separately at 0.28 mm. Both remain
pipeline tolerances and neither says anything about the real building.

**A gate that has never run is not a gate.** The P5 script's up-axis assertion
was written while Blender MCP was down; executing it showed it tested whether a
building is taller than it is wide, not what axis the file uses. It was replaced
with an uncompensated coordinate diff carrying an explicit Z-up control column
(worst deviation 0.000 m, minimum control deviation 15.455 m). Future authoring
scripts should not be committed as evidence-producing until they have produced
evidence.

**Decision 11 holds unchanged.** `src/runtime/exterior-default-activation.ts`,
the canary release graph and every pre-existing committed release tree are
byte-identical to the task's base commit. This package is added beside them.

## Still not decided

- **Whether V3 should serve at all, and when.** Nothing points at the V3
  package. That is T026, and it requires the rendered frame-time run this cycle
  could not produce.
- **Whether a drawn style class is acceptable in a product surface.** The ESB
  shipping `curtain-cool` is faithful to the grammar and disclosed by every
  asset's uncertainty statement, but it is visibly unlike the real building. If
  V3 is ever served, that tension needs an explicit product decision rather than
  reliance on a metadata field.
