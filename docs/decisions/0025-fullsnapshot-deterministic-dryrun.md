# Decision 0025: full-snapshot deterministic generation dry run

Date: 2026-08-10

Status: accepted for deterministic generation, package estimation, and budget
proof over the whole Manhattan snapshot; asset authoring, artifact production,
publication, and release activation remain deferred.

## Context

Task T011 froze the ownership ledger: 883 cells owning the 45,194 accepted
building parents of `manhattan-citywide-20260804` exactly once. Task T003 froze
the deterministic facade plan contract (ADR 0020). Nothing had yet run the
generator over the whole snapshot, so three claims were untested at scale:
that every parent can receive a complete plan, that a replay is byte identical,
and that the resulting package stays inside `MULTI_LOD_ASSEMBLY_LIMITS`.

This decision covers the dry run that tests those three claims. It materializes
no wave, produces no GLB, and activates no release.

## Decision

### D1 - The generation instant is pinned to the snapshot, never to the clock

`EXTERIOR_FULLSNAPSHOT_GENERATED_AT` is the constant `2026-08-04T00:00:00.000Z`,
the pinned snapshot's own capture day at midnight UTC. The adapter refuses to
build anything unless the caller passes the pinned base manifest checksum
`acb5a9b52014f86535c8478e7d4e516efc03f6dff95c17e9896dfea4413c203c`, and the
dry-run script re-derives that checksum from `manifest.json` bytes and checks it
against both `manifest.sha256` and the pinned constant.

The instant is therefore a constant *of the snapshot*: it is defined only
relative to one set of source bytes, and a different snapshot cannot silently
reuse it. `generatedAt` reaches the plan hash through both the input and the
component inventory, so a wall clock here would have made replay fail by
construction.

### D2 - Projection is integer-only and trigonometry-free

ADR 0020 bans trigonometry from plan generation, and `Math.cos` is
implementation-approximated rather than correctly rounded, so it cannot appear
anywhere that feeds a hash. WGS84 degrees become integer nanodegrees via
`Math.round(value * 1e9)` - IEEE-754 multiplication and `Math.round` are exactly
specified by ECMA-262 - and everything after that is `BigInt`.

One city-wide rational scale pair converts nanodegrees to local millimetres:

| constant | value | unit |
| --- | --- | --- |
| reference latitude | 40.78125 | degrees (citywide coverage centre) |
| millimetres per degree of latitude | 111,049,654 | mm/deg |
| millimetres per degree of longitude | 84,412,702 | mm/deg |

Both were derived once, offline, from the standard degree-length series
(`111132.92 - 559.82 cos2f + 1.175 cos4f - 0.0023 cos6f` metres per degree of
latitude; `111412.84 cos f - 93.5 cos3f + 0.118 cos5f` metres per degree of
longitude) at the reference latitude, then frozen as integers in
`src/domain/exterior-fullsnapshot-input.ts`. No trigonometry runs at generation
time. Each building is projected around its own representative point, so the
scale error is a per-building *dimension* error over the footprint span, not an
absolute position error.

Disclosed residual, stated throughout in parts per million: across the
snapshot's 40.6843..40.8787 degree latitude band the true longitude scale varies
by 2,916 ppm, giving up to 1,463 ppm relative error; the latitude scale varies
by 17 ppm. Measured against the run: the median footprint span is 26.7 m (max
longitude error 39 mm), p95 is 65.8 m (96 mm), and the single largest footprint
spans 655.9 m (960 mm).

### D3 - Footprint is a minimum-area rotated rectangle, oriented by an exact
integer axis

The accepted V1 plan schema takes exactly one axis-aligned, hole-free rectangle
(`canonicalRectangle`, `deterministic-facade-generator.ts:157`) and carries no
georeference. The orientation of the plan's local frame is therefore the
adapter's free choice, and the best available choice is the *minimum-area*
rotated rectangle rather than the axis-aligned bounding box.

Rule: convex hull by monotone chain over integer millimetre points with `BigInt`
cross products; by the rotating-calipers theorem the minimum-area enclosing
rectangle has one side collinear with a hull edge, so the candidate set is
exactly the hull edges. For each edge every hull point is projected onto the
edge and its left normal with integer dot and cross products. Areas are compared
as exact rationals `spanU * spanV / |e|^2`. Side lengths are recovered as
`span * 10^6 / floor(|e| * 10^6)` using an exact integer square root, which keeps
recovered millimetre lengths accurate to well under a micrometre. The `+u` axis
is always the longer side, canonicalized into the half plane `x > 0 or (x = 0
and y > 0)` and gcd-reduced, so the same geometry yields the same descriptor
regardless of ring rotation or winding. Ties in area go to the smaller signed
yaw, compared as the exact rational slope `y/x`.

**The orientation is recorded as that exact integer direction pair, not as
quantized millidegrees.** Converting a hull-edge direction into an angle
requires `atan2`, which is the trigonometry ADR 0020 bans and the reason this
whole path is integer-only. An exact rational direction is strictly more
reproducible than any quantized angle and loses nothing: it is the same
information without a rounding step.

Measured effect over all 45,194 buildings: the proxy inflates true footprint
area by a median factor of 1.0462, p95 1.4178, maximum 6.0772. The axis-aligned
bounding box it replaces would inflate by a median factor of 2.2913 (p95 3.0704,
maximum 16.4228). Both figures are computed per building by the adapter itself
and aggregated into the committed evidence, so the comparison is reproducible
from committed code rather than from a one-off measurement script.

Sensitivity worth naming: the chosen orientation is a deterministic function of
the input, but it is decided by exact comparisons over millimetre-quantized
points. A sub-millimetre change in the source coordinates - a snapshot re-issue,
a coordinate precision change - can flip which hull edge wins on a near-tie and
therefore move far more plan hashes than the geometric change itself implies.
Plan-hash churn is not a proxy for geometric change across snapshots.

The substitution is named where a consumer cannot miss it: the plan's footprint
anchor id is `anchor:footprint:min-rect-proxy-v1`, and the per-building run
record carries the origin nanodegrees, the orientation axis, the rectangle
centre offset, both areas, the ratio in parts per million, the dropped interior
ring count, and the dropped interior ring area.

### D4 - Height quantization is universal, not a repair for unknowns

`validateDeterministicFacadeInput` requires `floorCount * floorHeightMm` to
equal `heightMm` exactly (`deterministic-facade-generator.ts:264`), and the
snapshot's heights are foot-derived (19 ft becomes 5,791.2 mm), so most have no
admissible factorization. Every height is therefore quantized, not only the
awkward ones:

- `floorCount = max(2, round(heightMm / 3500))`
- `floorHeightMm = floor(heightMm / floorCount)`
- the plan carries `floorCount * floorHeightMm`; the residual is disclosed.

Measured residuals: median 2 mm, mean 2.843 mm, maximum 87 mm.

Two stated substitutions:

- **Unknown heights.** 76 buildings carry `heightUnknown` and a null height.
  They receive a documented 10,500 mm (three nominal storeys) substitute, are
  flagged `heightSource: "fallback"` in the run record, and carry the distinct
  plan anchor id `anchor:height:fallback-v1` so a substituted height can never
  hash the same as a measured one.
- **Sub-5.25 m buildings.** 1,393 buildings (of which 140 are under 3 m) round
  to fewer than the schema's two-floor minimum and are raised to it. Every one
  is flagged `forcedTwoFloor` and counted in the committed evidence.
- **Narrow buildings.** The bay count is `max(2, floor(shortSide / 6000))`, so
  the same kind of grammar floor fires for any building whose shorter side is
  under 12 m - which includes the common 25 ft Manhattan lot and is therefore
  much more frequent than the height floor. It is disclosed on exactly the same
  footing: flagged `forcedTwoBay` per building and counted in the evidence.

**No generator cap is ever clamped.** Every cap is a fail-closed refusal with a
stop code, because a firing cap means the source data drifted outside the
envelope this task measured, not that the output should be quietly trimmed. The
run reached none of them: maximum floor count 135 of 512, bay count 39 of 256,
placements 8,308 of 50,000.

### D5 - The structural byte estimate gates; the pilot rate is a label

Two totals are reported for the same 90,388 planned artifacts:

| basis | total | share of the 8 GiB cap | gates |
| --- | --- | --- | --- |
| structural glTF accessor arithmetic | 1,212,845,412 B (1.130 GiB) | 14.1% | **yes** |
| Stage 3 pilot measured bytes per building | 7,932,980,295 B (7.388 GiB) | 92.4% | no |

The structural model counts what the plan actually describes: every planar quad
(a surface ring or a placement) becomes four unshared vertices and two
triangles; vertices carry POSITION, NORMAL, and TEXCOORD_0 as float32 (32 B);
indices widen from uint16 to uint32 past 65,535 vertices; one primitive per
referenced material; plus a documented JSON-chunk and container cost.

Back-tested against the pilot's 28 measured GLBs - feeding each asset's measured
triangle and material counts through the model - it predicts **85.5% of measured
bytes in aggregate, with a worst single asset at 73.7%**. It is therefore an
*under*-estimate, not a bound. That is acceptable here only because the gate it
feeds carries 85.9% headroom: even a 2x under-estimate still passes the 8 GiB
cap. It would not be acceptable for a gate with a narrow margin, and it must not
be reused as one.

The pilot *rate* nevertheless may not gate. The pilot is 14 Blender-authored
commercial-frontage buildings with real footprint outlines, storefront detail,
and signage; the full snapshot is generated rectangular massing with a median of
39 placements. Applying 171 KiB per building to 45,194 generated buildings would
report 92% of the package cap consumed for a product that does not exist. Both
numbers are published side by side, with the gating one named, so the difference
is visible rather than resolved by whichever is convenient.

### D6 - Budgets are checked before anything can be materialized

Eight ceilings are checked against the estimated package plan, and a single
failure throws before the package plan is written and long before any wave could
be built:

| check | observed | limit | headroom |
| --- | --- | --- | --- |
| total-bytes | 1,212,845,412 | 8,589,934,592 | 85.88% |
| artifact-bytes | 1,171,612 | 268,435,456 | 99.56% |
| assets | 45,194 | 50,000 | **9.61%** |
| artifacts | 90,388 | 200,000 | 54.81% |
| cells | 883 | 20,000 | 95.58% |
| lods-per-asset | 2 | 8 | 75.00% |
| placements-per-plan | 8,308 | 50,000 | 83.38% |
| cell-membership | 119 | 120 | **0.83%** |

The two tight ones are worth naming. The 50,000-asset cap leaves 9.61% headroom
against one asset per accepted parent: roughly 4,800 new buildings, or any move
to a multi-asset-per-building scheme, breaches it. The per-cell membership cap
is at 119 of 120 by construction, which is the T011 splitter working, not slack.

### D7 - Single threaded, streamed per cell

Generation is single threaded. Workers were rejected in ADR 0024's reasoning and
are rejected again here: the deliverable is determinism, and roughly 145 s per
full run (host observations for each invocation are tabulated in the
implementation record) is not a cost worth trading reproducibility for.

Plans are streamed one ledger cell at a time and discarded after their hashes
and run-record rows are written. Retaining all 45,194 plans costs about 2.8 GB
of resident memory for no benefit; streaming holds observed peak RSS in the
roughly 500-530 MiB range (per-invocation figures in the implementation
record).

### D8 - Output lives under one approved disposable root

Both runs write only under `/tmp/udt-t012-fullsnapshot-dryrun-20260810`, and the
script refuses any output path outside it. This diverges from the
`data/generated/…-replay-a` / `-replay-b` precedent used by the citywide catalog
replays: this run emits 66 MB per replay, twice, purely to be diffed and thrown
away, and it is a proof rather than an input to anything downstream. The
divergence was approved as part of this task's contract.

`data/generated/` is unused by this task. The only committed outputs are the
evidence artifact under `data/normalized/manhattan-exterior-fullsnapshot-dryrun-20260810/`
and this decision record; nothing under `public/data/` or `artifacts/` is
touched.

The committed `evidence.json` is **fully deterministic**: every field is a
function of the pinned snapshot, the committed ledger, and this repository's
code, so any later `--evidence` run rewrites byte-identical content and the
recorded `evidence.sha256` stays valid. Host wall clock, peak RSS, Node version,
and platform are deliberately excluded and written instead to an uncommitted
`observed-*.json` beside the run under the disposable root, and quoted in
`docs/implementation/20260810-exterior-fullsnapshot-dryrun.md`.

### D9 - What CI can and cannot prove

The vitest suite reads only the committed evidence artifact and the committed
ledger, never the gitignored `public/data/` snapshot. It can therefore prove
that the evidence is internally consistent, that it matches its checksum
sidecar, that it pins the same base-manifest checksum and ledger checksum the
adapter is compiled against, and that it contains no host-observed field. It
**cannot** prove that the run described actually occurred, because the dataset it
ran over is not in the repository. Re-running `pnpm exterior-fullsnapshot:dryrun`
against the local snapshot is the only thing that establishes that, and the
run digest is what makes the re-run checkable.

A related boundary applies inside the run itself. The zero counts the script
prints are gated by its own `planned === 45,194 && stopped === 0` check; the
reconciliation library's ability to *detect* a missing, duplicate, or
unclassified outcome is proven by synthetic-failure unit tests, not by a clean
run over real data. A clean run cannot demonstrate that a detector works.

## Truth preservation

The generated plan substitutes a rectangle for a real footprint and, for 76
buildings, a constant for a real height. Two things follow.

**What is preserved.** Every substitution is measured and recorded per building
in the run record (true area, proxy area, ratio, dropped hole count and area,
orientation, span, height source, residual, forced-grammar flag), aggregated in
the committed evidence, and named in the plan's own anchor ids
(`anchor:footprint:min-rect-proxy-v1`, `anchor:height:fallback-v1`). Source
identity, source reference ids, and the pinned snapshot lineage pass through
unchanged. No plan claims architectural, geographic, or facade accuracy.

**Forward finding for a T003 V1.1 amendment.** The frozen
`DETERMINISTIC_FACADE_UNCERTAINTY` text - "Procedural local-millimeter
representation only; it does not assert real-world facade accuracy, tenants,
brands, text, or signage" - covers *facade* substitution. It does not mention
footprint substitution, and a rectangle standing in for an L-shaped or
courtyard building is a shape claim, not a facade claim. The text is frozen by
ADR 0020 and pinned by committed artifacts, so this task did not change it. A
V1.1 amendment should extend it to say that the footprint is a proxy and that
interior rings were dropped. Until then the disclosure lives in the anchor id,
the run record, and this decision - which is weaker, because a consumer reading
only `plan.uncertainty` will not see it.

## Consequences and residual risks

- **Estimates are not measured bytes.** The package plan is explicitly
  `estimated: true`, is deliberately not shaped like a `MultiLodAssemblyManifest`,
  and carries no artifact checksums. It cannot discharge any T004 obligation. A
  built package must be re-measured.
- **Determinism is proven on one Node build.** Two full replays produced byte
  identical trees and equal run digests on Node v24.12.0 / darwin-arm64. Nothing
  here proves cross-version reproducibility directly; the trig-free, float-free
  integer projection is the reason to believe it, because the only
  implementation-approximated operations in the pipeline have been removed.
- **The 9.61% asset headroom is the real ceiling.** It is a snapshot-growth
  risk, not a today risk.
- **ADR 0024's forward findings remain unresolved.** Shared-cache pressure
  across simultaneously resident cells is still a T013+ runtime scheduling
  concern; the cache simulation here confirms D4's per-cell arithmetic against
  generator-derived sizes and discovers nothing new.
- **A different plan grammar changes the byte total.** The structural estimate
  is a function of this task's placement grammar. Any grammar change requires
  re-running the dry run before its budget conclusions can be reused.
- **The bay-grammar floor dominates the substitution profile.** 29,011 of 45,194
  buildings (64%) have their bay count raised to the two-bay minimum. That is a
  fidelity ceiling on narrow lots, not a defect, but it means most generated
  facades carry the minimum bay articulation regardless of their real frontage.

## Deferrals

Blender MCP authoring, geometry realization, GLB or 3D Tiles production, runtime
rendering, Cesium wiring, acquisition, release assembly, publication, and
deployment remain outside this decision.
