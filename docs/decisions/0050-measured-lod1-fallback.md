# ADR 0050 — The measured LOD-1 fallback

Status: accepted for the T004 mass-generation retention waves, inert in the
shipped grammar and in every frozen wave. It changes no approved release, no
serving surface and no runtime default.
Date: 2026-08-16
Task: T004
Supersedes: nothing. Amends nothing. Decides the question ADR 0049's Stage-0
gate put on the table and deliberately did not answer.

## Context

`multi-lod-assembly.ts` refuses any coarse level whose declared silhouette
deviation exceeds **2%** of the fine level's projected area. The V3 LOD-1
contract is "emit the massing and the rooftop cluster, drop every outward
placement". For a large building those placements are a rounding error on the
silhouette. For a small, narrow one they are not.

Stage 0 measured it. On a 1-in-20 stride of the ledger order, **19 of 2,250**
buildings sat at or over the cap, worst 5.618%. All nineteen were small and
narrow — 3.96 m to 23.16 m tall, 4 to 11 ring vertices — and their edge-on
silhouette is small enough that the fire escape (1,000 mm deep, one per floor)
and the blade sign (600 × 2,400 mm) are 2.7% and 2.9% of it on their own.

That stride was then replaced by an **exhaustive island pass**: every one of the
45,032 owned parents the mass-generation envelope admits, measured. **425**
(0.944%) are at or over the cap. Attribution, in three disjoint buckets:

| bucket | count |
| --- | --- |
| already over the cap under the SHIPPED grammar | 415 |
| refused outright by the shipped grammar (T003 low-rise recoveries) | 9 |
| crossed the cap because of the T004 rooftop rules | **1** |

The single crossing is `doitt:401323`: 0.019780 → 0.020410. So this is a
pre-existing property of the LOD-1 definition that had never been measured
outside Block 835's fourteen buildings, every one of which is large enough that
none could exhibit it.

A per-building decision has to key on a **measurement**, not on a projected
share. "About 380 buildings" cannot name which building, and the wave has to
decide for each. That is why the island pass exists and why the ~380 projection
it replaces is not evidence.

## Decision

**LOD 1 sheds protrusions only where the measured deviation is within the cap.
Otherwise LOD 1 is FULL GEOMETRY, and its deviation is zero.**

Expressed as `V3WaveProfile.lod1Policy`, defaulting to `shed-protrusions` — the
contract every frozen wave was built under — with `measured-fallback` selected
per wave. The key enters `midtownCoreV3StageFingerprint` only when it differs
from that default, so no frozen wave's resumable-stage receipts move.

Five things follow, and each is a rule rather than an intention:

1. **The cap is not relaxed.** No coarse level above 2% ships. The buildings the
   cap excludes stop having a coarse level; they do not get a waiver.
2. **The deviation of a fallback level is zero because it dropped nothing.** The
   coarse tessellation is the same `tessellateV3Plan` call as the fine one, so
   the two silhouettes are the same set of rectangles. `midtownCoreV3SilhouetteRecord`
   takes an explicit `lod1` variant argument and returns 0 for `full-geometry`;
   it keeps its fail-closed throw for a `shed-protrusions` level over the cap.
3. **The declared geometric error is derived from the emitted geometry.** The
   writer compares the two emitted tessellations element for element and corner
   for corner, and declares 0 only when they are identical; a `full-geometry`
   claim whose bytes differ from the fine level's is an error, not a fallback.
   It is never read off the wave's LOD-1 constant.
4. **A fallback coarse level is `eligible: false`.** The schema has the field and
   `exterior-render-profiles.ts` honours it, so this is how a release says "never
   select this level". It is not decoration: the level is a byte-for-byte copy of
   the fine one, and selecting it at range would pay a second decode to draw the
   same triangles. The fine level therefore takes `maxDistanceMeters: null` for
   those buildings, because a bounded fine level under an ineligible coarse one
   would leave the asset with no eligible representation at all.
5. **The record-builder is the enforcer.** `midtownCoreV3AssemblyLods` is the only
   route to a coarse LOD descriptor and it always goes through the record
   builder, so a successor stage cannot forget the fail-closed half. The writer
   MEASURES; the record-builder ENFORCES.

## What it costs

Measured over the 2,250-building stride: LOD-1 triangles rise from **1,761,930**
to **1,767,066**, or **+0.29%**. Only the 19 fallback buildings differ, and each
pays exactly its own LOD-0 count — which is small, because these are small
buildings. That is the whole cost of the rule at stride scale.

## The honest runtime statement

**All five frozen waves serve `lod_0` only.** Every building of every shipped
wave renders its fine level at every distance today. So a fallback building at
range renders exactly as every building renders today: its triangles-at-range are
**unchanged against the status quo**, not worsened by this rule. What the LOD
system buys is the other ~99% of the population, which gains a coarse level it
did not have.

Cache-ceiling and streaming-benchmark behaviour against a two-LOD population is
**not** claimed here. Those re-runs belong to **T005/T006** and are routed there
explicitly; this ADR decides what LOD 1 is, not what a two-LOD city costs to
stream.

## Alternatives rejected

- **Keep protrusions at LOD 1 for every building.** It is the most direct fix and
  it discards the coarse level for the 99% that does not need it, for a defect
  that affects 0.944%.
- **Ship one LOD for the buildings that fail the cap.** Nearly this decision, and
  weaker: an asset with a single LOD says nothing about a transition, while a
  fallback asset states a measured zero and declares its coarse level ineligible.
  The second is a checkable claim; the first is an absence.
- **Re-derive the 2% cap against measured screen error at the 250 m transition
  distance.** The largest change, needs its own evidence, and would amend an
  approved contract rather than satisfy it. Not taken.

## Rights and retention

Nothing here acquires, publishes, conveys or redistributes anything. The rule is
inert in the shipped grammar and in all thirteen frozen wave profiles. No
approval envelope is widened, serving and promotion are untouched, and the
runtime rollback surface of this ADR is zero.

## What is not decided here

- Whether any two-LOD wave is PROMOTED to serving. These waves are retention
  artifacts; `PINNED_EXTERIOR_CELL_RELEASE_IDS` is untouched.
- Any visual acceptance. A coarse level inside a 2% area ratio can still read
  wrongly on screen, and a fallback level is not evidence about the other 99%.
- The streaming, cache-ceiling and frame-time behaviour of a two-LOD city.
