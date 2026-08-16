# T004 Stage 0 — the pre-generation gate

Date: 2026-08-16
Decision record: [ADR 0049](../decisions/0049-rooftop-honesty-rules.md)
Evidence: `data/mass-generation-20260816/` (`stage0-gate.json`,
`stage0-differential-digest.json`, `stage0-preflight-stride.json`,
`stage0-frozen-fingerprints.json`, `stage0-textured-write-cost.json`, each with
a `.sha256`), plus `data/citywide-overview-census-20260814/generation-replay.json`

## The headline

**Stage 0 does not pass. The waves must not start.**

Nine of the ten gate items are green. The tenth is not: **19 of the 2,250
strided buildings (0.844%) sit at or over the multi-LOD assembly schema's 2%
silhouette cap**, with a worst deviation of **5.618%**. The schema refuses any
coarse level above that ratio, so a two-LOD wave would refuse those assets at
assembly time.

**The 19 are not T004's doing.** All nineteen are admitted by the shipped
admission envelope and all nineteen are **already over the cap under the shipped
grammar**; the largest change either rooftop rule makes to any of their
deviations is 7.75e-5. What Stage 0 found is a pre-existing property of the V3
LOD-1 definition that had never been measured outside Block 835's fourteen
buildings — all of which are large, and none of which could exhibit it.

## What is measured, item by item

### 1. Differential plan-hash set digest — GREEN

T003's own instrument, re-run over all 45,194 accepted parents after the rooftop
threading, writing off the committed T003 record.

| | |
| --- | --- |
| shipped-envelope digest | `fd22c08a19fe0a225cd81301fb0e485f6a1851b0b8054a58eab393aa32077667` |
| extended-envelope digest | `fd22c08a19fe0a225cd81301fb0e485f6a1851b0b8054a58eab393aa32077667` |
| committed T003 digest | `fd22c08a19fe0a225cd81301fb0e485f6a1851b0b8054a58eab393aa32077667` |
| byte-equal | `true` |
| **movedPlanHashCount** | **0** |
| accepted set size | 44,295 |

Counts reproduce T003 exactly: 45,194 enumerated / 44,295 shipped-planned / 899
shipped-refused / 44,989 extended-planned / 694 recovered / 205 residual. The
rooftop threading moved nothing on the default path.

### 2. Shipped-GLB byte replay (Proof 3) — GREEN

T001's full-city generation replay, re-run after both T004 commits.
**498/498** shipped GLBs byte-identical to their committed SHA-256; Block 835
per-building plan-hash replay `AGREES`; disagreement count 0.

### 3. Frozen stage fingerprints — GREEN

All **13** committed wave profiles' stage fingerprints are byte-identical to the
values computed at `9e120e1`, before the grammar-envelope and texture-delivery
keys existed. The four `-t1` shared-URI variants all move, which is the point.

### 4. Pre-flight silhouette stride — **RED**

1-in-20 over ledger order: 2,260 selected, **2,250 materialized** (10 refusals:
6 `ring-area-below-floor`, 1 `ring-neck-below-grammar-minimum`, 3
`volume-identity-failed`). Every one written at **both** levels of detail
through the real canonical writer, then dropped.

| quantile | LOD 0 / LOD 1 deviation |
| --- | --- |
| min | 0 |
| median | ~0 (3.9e-16) |
| p95 | 0.00329 |
| p99 | 0.01838 |
| max | **0.05618** |

| threshold | buildings |
| --- | --- |
| ≥ 0.005 | 89 |
| ≥ 0.010 | 50 |
| ≥ 0.015 | 28 |
| **≥ 0.020 (the cap)** | **19** |
| ≥ 0.030 | 11 |
| ≥ 0.050 | 2 |

**The 19, and what produces them.** They are small, narrow, low-to-mid-rise
buildings: heights 3.96 m to 23.16 m (median 13.17 m, against a stride median of
17.77 m), 4 to 11 ring vertices, 232 to 988 LOD-0 triangles. Their edge-on
silhouette is small, so a fixed-size protrusion is a large fraction of it. Per
placement kind, on each building's worst view:

| kind | outward depth | share on the worst view |
| --- | --- | --- |
| fire escape | 1,000 mm, one per floor above ground, per tier | up to 2.74% alone |
| blade sign | 600 mm × 2,400 mm, one per building | up to 2.94% alone |
| balcony | 1,200 mm | up to 1.22% alone |
| cornice | 250 mm, per band per tier | up to 0.72% alone |
| sign band | 150 mm | ≤ 0.19% |

`tessellateV3Plan` emits every one of these only when `includeRecesses` is true —
that is, at LOD 0 alone. LOD 1 drops all of them, which is what the deviation
measures.

### 5. Post-fix rooftop re-measurement — GREEN

Same 2,250 buildings, measured twice in one process.

| | pre-fix | post-fix |
| --- | --- | --- |
| buildings with orphan legs | **573 (25.47%)** | **0** |
| orphan legs total | **1,653** | **0** |
| cluster-top ratio median | 1.1075 | 1.0961 |
| cluster-top ratio p95 | 1.4061 | 1.3260 |
| cluster-top ratio max | 2.8342 | 2.2240 |
| cluster above crown, max | 5,400 mm | **3,596 mm** |

The 25.47% orphan-leg prevalence lands inside the reviewer's measured ~26-30%
band. The clamp's bound holds on every building: no cluster stands more than
3,596 mm above its crown, against the 3,600 mm limit. **70** buildings gained a
complete water tank because the clamp shrank the cluster enough to bring it
inside the parapet — the non-monotonicity ADR 0049 records.

The two refusal maps are deliberately not symmetric: the pre-fix pass only
plans, so it sees plan-stage codes only; the post-fix pass also writes both
assets, so it sees the writer's codes too. Both stages are labelled in the
record.

### 6. Textured shared-URI write cost — GREEN (measured)

100 buildings through the real `manhattan-southern-remainder-cells-20260812-t1`
profile (`textureDelivery: "shared-uri"`), both LODs, bytes dropped.

| | median | p95 | max |
| --- | --- | --- | --- |
| per asset, textured | 2.371 ms | 15.853 ms | 117.584 ms |
| both LODs, textured | 4.743 ms | 31.706 ms | 235.168 ms |
| both LODs, untextured | 2.880 ms | 22.347 ms | 146.134 ms |
| both LODs, bytes | 124,040 B | 1,088,764 B | 6,669,604 B |

Ninety-seven of the 100 reference three shared tiles, three reference two.

**Six-wave projection: 214.3 s to 1,432.9 s — 3.6 to 23.9 minutes** of
single-threaded writer time for all 45,194 owned parents at both LODs. It is a
projection from the measured median and p95, and it is a floor on the writer
stage alone: it excludes plan derivation, snapshot verification, release
assembly, checksums and disk I/O.

### 7. The sub-metre parents — GREEN (enumerated, not sampled)

Six of the 45,194 carry a sourced height below one metre. All six are recovered
only by the T003 low-rise extension; all six pass the 2% silhouette cap.

| building | sourced height | pre-fix cluster ratio | post-fix ratio | above crown |
| --- | --- | --- | --- | --- |
| `doitt:1261650` | 0.3048 m | **18.7049** | 12.7902 | 3,596 mm |
| `doitt:1303611` | 0.6085 m | 9.8670 | 6.9048 | 3,596 mm |
| `doitt:1305414` | 0.6096 m | 9.8525 | 6.8951 | 3,596 mm |
| `doitt:1302036` | 0.9144 m | 6.9081 | 4.9344 | 3,596 mm |

(The full six, with owner cells, source refs and silhouette ratios, are in
`stage0-preflight-stride.json` → `subMetreParents`.)

The reviewer's 18.7x is reproduced exactly, on a named building. Even clamped,
`doitt:1261650` is a 305 mm building under 3,596 mm of designed rooftop — 92% of
the asset's height is grammar, not source. The clamp bounds it; it does not make
it a good claim, and that is a Decision 3 input, not a Stage-0 pass.

### 8. Rights and retention

Recorded in `stage0-gate.json` → `rights`, and restated here: T004 Stage 0
retains bytes **locally only**. Every GLB it produced was in memory, counted,
timed and dropped; the only retained artifacts are the committed JSON summaries
under `data/mass-generation-20260816/`. Nothing is conveyed, redistributed or
published. No external data was acquired and no retained snapshot replaced. **No
approval envelope is widened** — every committed release, its approval scope,
licensing and retention terms are exactly as they were. Serving and promotion
are untouched, so the **runtime rollback surface of this stage is zero**.

## The silhouette instrument, and why it can be trusted

The measurement is computed, not rendered. Under an axis-aligned horizontal
orthographic view every V3 solid part projects to an axis-aligned rectangle (a
tier and a rooftop prism are vertical extrusions; a placement is a box) or to
nothing (every cap and deck is horizontal), so the silhouette is a union of a
few hundred rectangles and its area is an exact sweep. Recesses are correctly
absent: an opening is cut 200 mm into a wall the 600 mm neck gate keeps thicker
than that, so it is interior and cannot cast.

That reasoning is validated twice rather than asserted:

- against an independent 2,048-pixel rasterization of the **real emitted
  tessellation** of both LODs, agreeing on all fourteen Block 835 buildings;
- against the **committed Blender measurements** — a different tessellator, a
  different machine, a hand-run authoring pass — to a worst absolute difference
  of **2.027e-4**, about 1% of the cap. Pinned as a test, with the same plan
  hash asserted on both sides.

A 512-pixel raster's own quantization is the same order as the ratios being
compared against the cap, which is why the exact method was worth building.

## What Stage 0 does not decide

- Whether the waves run under the extended admission envelope. ADR 0048 withheld
  that; this gate does not grant it.
- Whether a two-LOD wave ships. That is precisely what item 4 has put back on
  the table.
- Any visual, geographic, architectural, accessibility or performance
  acceptance. A building inside a 2% area ratio can still read wrongly on
  screen.

## The re-decision item 4 forces

The LOD-1 contract is "drop every outward placement". For a 6 m × 13 m, 10 m
building that removes a fire-escape stack and a blade sign from a silhouette
small enough that they were 5.6% of it. Options, none of which Stage 0 chooses:

1. **Keep protrusions at LOD 1** for buildings whose silhouette is small, or for
   all buildings. It raises LOD-1 triangle counts (stride median 400, p95 2,518)
   and is the most direct fix.
2. **Ship one LOD** for the buildings that fail the cap, as the five frozen
   waves already do for every building. Costs nothing and refuses nothing.
3. **Re-derive the 2% cap** against measured screen error at the 250 m
   transition distance rather than treating it as given. This is the largest
   change and needs its own evidence.

Option 2 is the smallest step that lets waves start, and it is a decision about
an approved LOD contract, so it is not one this task may take on its own.
