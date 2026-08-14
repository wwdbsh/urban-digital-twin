# Decision 0040: citywide overview representation

Date: 2026-08-14

Status: **accepted as the measurement base** for T002/T004/T005 — the
distributions, extents, candidate costs and sample proof below are committed
evidence and stand on their own.

The representation choice in D1 is **RECOMMENDED, PENDING A GOAL AMENDMENT AND
RENEWED USER APPROVAL**. It is not in force. Goal acceptance criteria #2 and #4
were approved by the user (planning decision Q1, 2026-08-14, which chose
"overview must show real shapes from the start -> coarse-LOD regeneration for all
six waves is in scope"), and no ADR written inside a task can repeal a
user-approved acceptance criterion. D1 is a recommendation to amend those
criteria, handled the way D6 handles the rights envelope: named, routed to the
user, and blocking until answered.

No release was assembled, no artifact was published, no wave was materialized,
and no runtime budget was changed by this task.

## Context

The goal `manhattan-citywide-default-streaming` asks for one outcome: a default
session shows the whole island's real building shapes, coarse at overview zoom
and textured V3 detail near the camera. Its scope item 2 says that needs a
"citywide coarse-LOD tier — deterministic successor releases for all six waves".

Task T001 was rewritten after an adversarial architecture review from "build the
tier" to "measure, then decide, with a kill switch". This decision is that
deliverable. It compares three candidates on measured numbers and recommends one.

Two premises the goal states are **wrong**, and correcting them is most of the
finding:

### Corrected premise 1 — there is no committed plan corpus to build from

The goal says "all six wave payloads (44,295 textured V3 buildings, 883 cells)
already exist, validated and checksum-pinned". Only **474 promoted asset
entries** are committed. The 44,295 figure is *census-only retention*: five of
the six waves ran a pass that generated every asset, gated it, measured its
bytes, and then **dropped the bytes**. `wave.retention: "census-only"` and
`wave.shippedAssetCount: 0` sit in each wave's own committed record beside a
non-zero `shippedAssetBytes`, which is a retention mode and not a contradiction.

Nothing about the six waves is one artifact-copy away from shipping. Every wave
regenerates deterministically from the pinned snapshot, which is exactly why the
snapshot-availability gate below is the first deliverable of this task.

### Corrected premise 2 — cell extents were never committed

ADR 0024 D6 reported that 9,944 of 45,194 buildings overhang their assigned cell
rectangle by up to 248.2 m, and it committed **no code and no artifact** for
either number. The ledger's cells carry `bounds`, `buildingIds` and a membership
checksum; they carry no footprint, no height and no render extent. A
visibility-driven scheduler cannot be built on what is committed today.

## Deliverable 1 — the snapshot-availability gate

`src/release/citywide-snapshot-gate.ts` decides; `scripts/citywide-snapshot-gate.mjs`
performs the I/O; `pnpm citywide:snapshot-gate` runs it.

Every deterministic constant in this repository is defined relative to one set of
source bytes, `manhattan-citywide-20260804` at manifest checksum
`acb5a9b52014f86535c8478e7d4e516efc03f6dff95c17e9896dfea4413c203c`. Those bytes
are gitignored and are reached through a **symlink** in every Orca worktree. A
dangling link reads exactly like an absent snapshot, and both read exactly like a
successful run that measured nothing.

The gate reports nine stop codes with an operator action each, and it never
acquires, repairs or regenerates anything. Two decisions inside it are worth
naming:

- **It also refuses a self-consistent snapshot that is not the pinned one.** A
  manifest whose `manifest.sha256` agrees with its own bytes is internally
  consistent and still wrong if those bytes are a different snapshot. The stop's
  operator action says so: a different snapshot needs a new pin and a recorded
  decision, not a re-run.
- **It refuses an intact manifest beside an empty geometry tree.** A checksum
  check alone passes that case, and a census cannot run on it.

Verified in this worktree, through the symlink: PASS, 56 building shards.

## Deliverable 2 — committed distributions

`pnpm citywide-overview:census plans` runs every one of the 45,194 accepted
parents through the **same V3 plan stage the wave CLIs run**, counts, and drops
the plans. Committed to `data/citywide-overview-census-20260814/distributions.json`.

**Cost, re-derived honestly.** The pass is 225-254 s of wall clock at a
**sampled peak RSS of 501-661 MiB** (RSS is read once per ledger cell, so it is
the largest of 883 samples and not a continuous peak). Earlier full passes were
invoked with `--max-old-space-size=8192`. The measured requirement is under
700 MiB, so that flag is insurance rather than a requirement — and the
`citywide-overview:census` script in `package.json` still passes it, because
leaving a working invocation alone is cheaper than proving a tighter one is safe
on every host. The T001 stop condition was ~3 hours; the whole seven-stage census
is about 14 minutes.

| distribution | count | min | median | p95 | p99 | max | mean |
| --- | --- | --- | --- | --- | --- | --- | --- |
| source outer-ring vertices | 45,194 | 3 | 9 | 32 | 58 | 362 | 13.18 |
| planned outer-ring vertices | 44,330 | 3 | 9 | 30 | 48 | 64 | 12.59 |
| floors | 44,330 | 1 | 5 | 16 | 35 | 131 | 6.52 |

Ring vertex counts are **distinct** vertices: the closing duplicate is dropped,
as the grammar drops it. Counting it would have added ~45,000 phantom vertices to
every geometry estimate below.

**Effective tier counts** — the massing the grammar actually produced, not the
massing it requested:

| effective tiers | buildings | share |
| --- | --- | --- |
| 1 | 21,203 | 47.83% |
| 2 | 22,467 | 50.68% |
| 4 | 660 | 1.49% |

Nearly half the island is **already a single prism** at V3. That is the single
most important number in this decision, and it is a consequence of
`tier-offset-collapse`: the grammar refuses an inward offset it cannot make
rather than repairing one.

**Reconciliation.** The plan stage reconciles **exactly** against all five waves
that committed a wave-scale census:

| wave | owned | committed plan-stage refusals | observed | committed asset-stage total | `volume-identity-failed` |
| --- | --- | --- | --- | --- | --- |
| w01 midtown-core | 7,201 | 109 | 109 | 110 | 1 |
| w02 lower-manhattan | 6,425 | 127 | 127 | 134 | 7 |
| w03 southern-remainder | 9,603 | 85 | 85 | 96 | 11 |
| w04 central-upper | 11,721 | 178 | 178 | 178 | 0 |
| w05 northern | 10,230 | 365 | 365 | 381 | 16 |

Plan-stage refusals total 864; the 35 asset-stage `volume-identity-failed`
refusals bring it to the goal's 899, and 44,330 planned less those 35 is exactly
the 44,295 materialized (44,281 across w01–w05 plus Block 835's 14). Exact
agreement across five independently-run waves is also the evidence that
plan-stage refusal is a function of the sourced polygon alone and not of a wave's
seed, which is what lets one census profile speak for all six waves.

**Per-building bytes by wave** (`wave-bytes.json`), read from each wave's OWN
committed measurement rather than regenerated:

| wave | materialized | lod_0 B/bldg | lod_1 B/bldg | tri/bldg |
| --- | --- | --- | --- | --- |
| w01 midtown-core | 7,091 | 123,101 | 52,106 | 3,214 |
| w02 lower-manhattan | 6,291 | 80,620 | 36,470 | 2,036 |
| w03 southern-remainder | 9,507 | 63,599 | 29,827 | 1,563 |
| w04 central-upper | 11,543 | 63,419 | 30,435 | 1,555 |
| w05 northern | 9,849 | 50,678 | 26,026 | 1,202 |
| **island (w01–w05)** | **44,281** | **72,625** | **33,652** | **1,812** |

Island totals: **lod_0 3.216 GB, lod_1 1.490 GB.** Wave w00 (Block 835, 14
reference-authored textured buildings at 366,167 B/building for lod_0) is
excluded from the means and reported separately; including 14 buildings would
move an island mean that describes 0.03% of the city.

**`lod_1` is not a coarse tier.** It is `lod_0` without wall recesses and without
texture, and it costs **46% of `lod_0`**. Island-wide it is 1.49 GB. "Ship the
tier that already exists" was never an option, and that is why this task exists.

## Deliverable 3 — committed per-cell render extents

`cell-extents.json` carries one row per ledger cell:
`{cellId, order, buildingCount, assignmentBounds, renderBounds, maxOverhangMeters,
maxOverhangBuildingId, overhangBuildingCount, maxTopMeters, maxTopBuildingId,
maxTopSource, unknownHeightCount, outerRingVertexCount}`.

The **overhang metric is stated**, because ADR 0024 never stated one: a vertex is
outside when it is strictly outside the closed assignment rectangle; its overhang
is the Euclidean distance from that rectangle with degrees converted by the
frozen ADR 0025 citywide scale pair; a building's overhang is the maximum over
its outer-ring vertices. Metric id `rect-euclidean-frozen-scale-v1`.

Re-derivation against ADR 0024:

| claim | ADR 0024 | re-derived | agrees |
| --- | --- | --- | --- |
| buildings with a vertex outside their cell | 9,944 | **9,944** | yes |
| of total | 45,194 | **45,194** | yes |
| worst-overhang building | `doitt:308707` | **`doitt:308707`** | yes |
| worst overhang | 248.2 m | **249.3 m** | **no, by 1.09 m (0.44%)** |

The count and the identity reproduce exactly. The magnitude differs by 0.44%,
which is the size of a scale-convention difference and not of a geometric one:
this census uses one frozen city-wide scale pair at reference latitude 40.78125,
and `doitt:308707` sits well north of that. **The discrepancy is recorded, not
resolved.** ADR 0024 committed no code, so there is nothing to compare against
except a number in prose; adjusting this metric until it reproduced that number
would have been fitting to a figure rather than measuring a city.

`maxTopSource` distinguishes a sourced tallest member from one whose height was
substituted at the stated 10.5 m, so a cell can never report a substitute as a
measurement.

`deriveCellExtent` is unit-tested on synthetic fixtures including a 248 m
overhang case, which also shows the consequence: **one** member overhanging by
248 m widens a 10-millidegree cell's render extent by 29%.

## Deliverable 4 — candidates, costed on measured numbers

Everything below is measured except two figures that are labelled where they
appear. The coarse prisms were written through the **real** canonical GLB writer
and the bytes were then dropped; nothing was modelled.

| | (a) per-cell aggregated GLB | (b) per-building GLB | **(c) NO NEW TIER** |
| --- | --- | --- | --- |
| artifacts | 883 | 44,330 | 0 new |
| wire bytes | 58.23 MiB *(projected)* | **108.31 MiB** *(measured)* | **43.78 MiB raw / 10.52 MiB gzip** *(already exist)* |
| decoded GPU bytes | 101.45 MiB | 101.45 MiB | 59.80 MiB *(POSITION-only floor)* |
| draw calls at overview | 883 *(floor)* | 44,330 | **30** |
| requests | 883 | 44,330 | **56** |
| concurrency-4 waves | 221 | 11,083 | **14** |
| cache entries | 883 | 44,330 | 56 |
| vs the cap it meets | `maxCacheEntries` 512 — **FAILS** | `maxCacheEntries` 512 — **FAILS 86.6×** | `maxLoadedShards` 24 — **FAILS; shared byte ceiling contended** |
| validator exemptions needed | 3 | 3 | **none** |
| rights envelope | 883 cells | 883 cells + 44,330 assets | **none** |

**Container overhead, measured.** Two whole cells were aggregated and written for
real: the largest (119 buildings) at 121,312 B against 256,908 B as separate
files, and the median (48 buildings) at 82,284 B against 136,464 B. The container
and metadata cost **46.24%** of the per-building total — 52.5 MiB island-wide,
paid 44,330 times instead of 883. That is the whole of candidate (a)'s advantage
over (b), and it does not save (a) from the cache-entry cap.

**All three pick strategies for candidate (a), priced:**

- **a1, one Model per cell, no feature ids** — 883 draw calls and *no
  per-building pick identity*. Selection, deep links and the details panel all
  break. Rejected: the product contract is that a user can select a building.
- **a2, one Model per building** — pick identity is free and everything else is
  not: 44,330 draw calls, 1,478x the batched path, for the same pixels.
- **a3, feature ids via a profile change** — 883 draw calls with per-feature
  picking needs `EXT_mesh_features` or an equivalent. The multi-LOD glTF profile
  is **closed** and validates an exact key set. Admitting an extension widens
  what every future artifact may carry and has to be argued on its own; it must
  not arrive as a rendering detail.

**Candidate (c) in detail.** `denseBuildingInstance` in
`src/features/explorer/CesiumViewport.tsx` already builds one `GeometryInstance`
per building from the citywide snapshot's real polygon ring, extruded to the
sourced height, batched 1,500 to a `Primitive`, with `id: feature.id`. The
runtime already sets `Feature.id = summary.parentId`, which is the same
`doitt:NNNNNN` identity the exterior assets carry as `canonicalFeatureId`. So
selection, deep links, provenance and attribution survive **unchanged**; nothing
has to be invented.

Four recorded count raises bound it:

- `maxRenderedDenseFeatures` 6,000 → 45,194
- `maxDecodedFeatures` 8,192 → 45,194
- `maxDecodedSummaries` 8,192 → 45,194
- `maxLoadedShards` 24 → 56

### The shared cache, corrected

**An earlier draft of this record claimed the byte ceiling already admitted
island-wide residency, because the building shards are 43.78 MiB against a 48 MiB
cap. That claim was wrong, and the error was measuring one shard class against a
ceiling shared by four.**

`CitywideLruCache` is constructed once per runtime with `maxLoadedShards` entries
and `maxLoadedBytes` bytes (`citywide-release.ts:436-471`). Building geometry,
restaurant geometry, search shards and detail shards all load through the same
pool into the same map (`citywide-release-runtime.ts:343, 417-425, 538-544,
758`), evicted by **global recency with no per-class reservation**, over
`cache: "no-store"` fetches the browser cannot serve again.

| shard class | shards | bytes | largest shard |
| --- | --- | --- | --- |
| geometry: buildings | 56 | 43.78 MiB | 2,096,314 B |
| geometry: restaurants | 47 | 13.62 MiB | 1,487,908 B |
| search | 214 | 98.16 MiB | 558,788 B |
| detail | 134 | 131.99 MiB | 1,048,527 B |
| **all four** | **451** | **287.55 MiB** | |

Island-wide building residency alone consumes **91.20%** of the shared byte
ceiling and **233%** of the entry ceiling (56 shards against 24), leaving
**4.22 MiB** for the search and detail shards the very first query or building
selection needs. Under global recency eviction those loads evict building shards,
which re-fetch and force a Cesium Primitive rebuild.

**This is an open T002 contract change, and it is not a constant bump.** The
shared cache has no reservation mechanism at all today, so guaranteeing
island-wide building residency is a *design* change to the cache. The
"recency-only, no reservation" disclosure ADR 0030 made for the exterior loader
applies here and is widened by anything that makes one class permanently
resident. What T002 has to decide, recorded so it starts from measured numbers:

- a **reserved** building-class budget of at least 45,903,404 B and 56 entries,
  so search and detail cannot evict the overview;
- a shared ceiling above that reservation for the other three classes, whose full
  extent is 243.78 MiB (255,619,340 B) across 395 demand-loaded shards;
- `maxShards` (512) is *not* the binding constraint: the release declares 451
  shards in total.

### The un-modelled cost

**Cesium Primitive rebuild on shard stream-in and eviction-driven refetch is not
modelled in any figure in this record.** Every change to the dense feature set
sends `scheduleDensePrimitiveBuild` around again: new `GeometryInstance`
allocation, asynchronous polygon tessellation in Cesium's workers, and GPU
re-upload. A shared cache without reservation is exactly what multiplies it.
**T002 must measure it** — it is the most likely way candidate (c) fails in
practice while looking free on paper.

## The fidelity claim, stated honestly

**Candidate (c) is not a weaker representation than (a) or (b). It is the same
representation.** All three draw the sourced outer ring extruded flat to the
sourced height. There is no fidelity argument for generating (a) or (b),
because there is no fidelity difference between them and what already renders.

What all three lose against V3 tiered massing is the setback steps, measured with
metric `prism-vs-tiered-orthographic-staircase-v1` — eight horizontal
orthographic azimuths, exact rather than rasterized, because both shapes are
unions of axis-aligned rectangles in every such view:

| | value |
| --- | --- |
| buildings within the schema's 0.02 cap | **21,361 of 44,330 (48.19%)** |
| median deviation ratio | **0.0452** |
| p95 / p99 / max | 0.248 / 0.307 / 0.629 |
| median / p95 / max horizontal error | 1.319 m / 2.527 m / **11.083 m** |

**More than half the island cannot satisfy the multi-LOD schema's
`maximumRatio: 0.02` as a declared coarse LOD.** That is not a detail to be
waived quietly; for candidates (a) and (b) it is a schema exemption covering
22,969 assets.

## Deliverable 5 — sample proof

Two-part gate, plus an aggregate. Committed in `sample-proof.json`.

Worst-case buildings, **selected by measurement** over the whole island rather
than hand-picked:

| case | building | what makes it extreme | deviation ratio | horiz. error | within 0.02 | SSE at overview |
| --- | --- | --- | --- | --- | --- | --- |
| widest ring | `doitt:171911` | 64-gon ring, the grammar's cap, 23.8 m tall, 1 tier | **0.000** | 0.00 m | **yes** | 0.000 px |
| tallest | `doitt:1277275` | 472.4 m, 4 tiers — the maximum-tier case | 0.102 | 7.35 m | no | 0.862 px |
| worst deviation | `doitt:118472` | 5-gon, 16.1 m, 2 tiers with a deep setback | 0.629 | 2.54 m | no | 0.298 px |
| **worst horizontal error** | **`doitt:1269947`** | 11-gon, 111.6 m, 4 tiers — the island's largest absolute setback inset | 0.236 | **11.083 m** | no | **1.296 px** |

The last row was **added after review**. The first three extrema were selected by
area ratio, ring size and height, and none of them is the building that costs the
most pixels: an area ratio is dimensionless and the screen-space statement is
made in metres, so a sample set chosen only by ratio cannot contain the
worst-pixel case by construction. Selecting on absolute horizontal error finds
`doitt:1269947` at 11.083 m, which is **1.296 px at the stated overview view —
over the 1-pixel budget.**

The 64-gon case is worth naming: the building with the most ring vertices on the
island deviates by **exactly zero**, because ring complexity is carried vertex
for vertex by the prism and is not what a coarse tier loses. What it loses is
tier steps, and that building has one tier.

Sample cells, with the **aggregate skyline check** — the cell's combined rendered
profile unioned across members, so mutual occlusion counts:

| cell | planned members | single-tier members | per-building median / max | aggregate skyline deviation | within 0.02 | SSE at overview |
| --- | --- | --- | --- | --- | --- | --- |
| Block 835 `…-w00-000000-block-00835` | 14 | 6 | 0.0756 / 0.1516 | **0.0668** | no | 0.859 px |
| midtown densest `…-w01-000083-16-19299-17926` | 110 | 51 | 0.0513 / 0.2950 | **0.0245** | no | 0.955 px |
| northern high-collapse `…-w05-000858-15-9655-8946` | 20 | 20 | 0.0000 / 0.0000 | **0.0000** | yes | 0.000 px |

The midtown cell is the case that shows why an aggregate check was required: its
per-building median deviation is 0.0513 and its per-building worst is 0.2950, and
the cell's combined profile deviates by **0.0245** — occlusion between 110
neighbours absorbs most of it. Summing per-building deviations would have
overstated what a viewer is exposed to by a factor of two.

The screen-space-error statement, with its inputs named: at an **8,000 m**
overview distance (the height at which the island's ~21.6 km extent fits a
60-degree vertical field of view), on a **1,080** device-pixel viewport, against
a stated budget of **1 device pixel**.

**Corrected claim: the collapse is sub-pixel at p95, not sub-pixel everywhere.**
The island's worst horizontal error is 1.296 px at the overview distance, over
budget. Every *sample cell* is under a pixel (worst 0.955 px), and the p95 of the
island distribution is 0.295 px, but a single-building worst case exceeds the
bar.

### Screen-space error against distance

From the committed island-wide horizontal-error distribution, at 60 degrees
vertical FOV and 1,080 device pixels. Pixels, with the 1-pixel budget in bold
where it is exceeded:

| statistic | error | 500 m | 1 km | 2 km | 3 km | 8 km | crosses 1 px at |
| --- | --- | --- | --- | --- | --- | --- | --- |
| median | 1.319 m | **2.467** | **1.234** | 0.617 | 0.411 | 0.154 | ~1,234 m |
| p95 | 2.527 m | **4.727** | **2.364** | **1.182** | 0.788 | 0.295 | ~2,364 m |
| max | 11.083 m | **20.732** | **10.366** | **5.183** | **3.455** | **1.296** | ~10,366 m |

**Open question for T002, named rather than answered here: at what camera
distance does the coarse representation stop being acceptable?** The p95 crosses
one pixel at about 2.4 km and the median at about 1.2 km. That band — not the
overview distance — is where the detail radius has to be chosen.

And it cannot be chosen in isolation from the goal's own transition gate.
Acceptance criterion #3 asks for a 2% transition bar, and **51.81% of the island
exceeds a 0.02 silhouette deviation** (committed in `coarse-tier.json`). So the
swap band and the transition gate constrain each other: any radius inside which
the transition must meet 2% must lie where the coarse representation is not yet
in use. The two have to be decided together, with numbers, in T002.

So the two halves of the gate disagree, and that disagreement is the finding:
**the geometry deviates by up to 6.7% of a cell's profile and by up to 62.9% of a
single building's, and at overview distance that is sub-pixel for the p95 and
1.30 px for the worst case.** The 0.02 area-ratio cap is a near-field instrument
being read at 8 km — and the near field is precisely where it will bind.

**Schema compliance is not visual acceptance, and neither is this.** Everything
above is arithmetic over committed geometry. No frame was rendered and nothing
was looked at. **A rendered A/B still at overview distance is an unmet gate**,
and it is named for T002 rather than quietly dropped.

## Decision

**D1 — RECOMMEND candidate (c), PENDING A GOAL AMENDMENT AND RENEWED USER
APPROVAL. This decision does not put it in force.**

The recommendation is that the island's overview representation become the
existing citywide dense path, bounded by visibility rather than by a flat feature
cap, and that no new coarse tier be generated for overview.

**This contradicts goal acceptance criteria #2 and #4, which the user approved.**
Planning decision Q1 (user, 2026-08-14) chose "overview must show real shapes
from the start → coarse-LOD regeneration for all six waves is in scope (option
2)". This task's measurements say that regeneration buys no fidelity the shipping
renderer does not already produce — but an ADR written inside a task cannot
repeal a user-approved acceptance criterion, and this one does not try to. D1 is
a **request to amend** AC #2 and AC #4, routed to the user exactly the way D6
routes the rights envelope.

Required before any work proceeds on D1's basis:

1. The user is shown this record's candidate table, the shared-cache correction
   and the screen-space table.
2. AC #2 and AC #4 are amended by a recorded goal-contract change.
3. The user re-approves the amended goal.

Until all three happen, the goal's approved scope stands as written, and T002
must treat D1 as an open question rather than as settled.

**D2 — The kill switch did not fire.** A candidate fits. It does not fit
"comfortably": candidate (c) meets every ceiling this task priced it against
except the shared shard cache, where island-wide building residency needs a
reservation mechanism that does not exist yet (see "The shared cache,
corrected"). That is an open T002 contract change, not a passed gate.

**D2a — The silhouette figures are an eight-azimuth sampled maximum, not a
true supremum.** `prism-vs-tiered-orthographic-staircase-v1` is exact *at each
view it evaluates*: both shapes are unions of axis-aligned rectangles there, so
the symmetric difference is computed and not rasterized. But it evaluates eight
horizontal azimuths, and the worst azimuth for a given footprint need not be one
of them. Every deviation ratio and horizontal error in this record is therefore a
lower bound on the true worst case over all azimuths, tight to the sampling
interval. Denser sampling can only move these numbers **up**, which means it can
only strengthen the finding that the 0.02 cap is exceeded and weaken the
sub-pixel claim — so the direction of the residual error is stated rather than
left for a reader to work out.

**D3 — A coarse GLB tier is rejected as the OVERVIEW answer, not killed as an
idea.** If a mid-distance need appears between V3 `lod_1` and the dense path,
this measurement stands ready and D1 does not forbid it.

**D4 — The kill-switch condition is named forward.** If T002 measures a decoded
GPU or frame-time result that candidate (c) cannot hold island-wide with the
dense cap raised, the fallback is **not** (a) or (b) — their GPU cost is equal or
higher for the same pixels. The fallback is to bound (c) by visibility instead of
by a flat cap, and the kill switch fires only if a visibility-bounded (c) also
fails.

**D5 — Validator exemptions, stated rather than omitted.**

Candidate (c) as recommended needs **none**: it assembles no release and declares
no LOD, so no multi-LOD gate applies to it at all. What it does inherit is the
citywide release's own validators, which already pass on the pinned snapshot.

Had (a) or (b) been adopted, these would have been required, and they are
recorded so a future revisit starts from the true list:

- **Volume identity — EXEMPT.** The coarse prism omits its floor cap (invisible
  above grade, ~500,000 island-wide triangles saved), so it is not a closed mesh
  and a signed mesh volume is undefined for it. Even closed, its analytic volume
  is the prism's, not the V3 massing's, so the identity would compare a shape
  against itself and prove nothing about the collapse.
- **Silhouette `maximumRatio` 0.02 — EXEMPT for 22,969 of 44,330 assets
  (51.81%).** Measured, not asserted.
- **Non-increasing triangles — PASSES.** A coarse prism is strictly coarser than
  `lod_1`, so appending it last keeps the chain non-increasing.
- **Nondecreasing `geometricError` and `maxDistanceMeters` — PASSES**, provided
  the tier is declared last.
- **`lodsPerAsset` — PASSES.** 3 against a cap of 8.
- **Texture-free — PASSES.** One material, zero textures.
- **`MULTI_LOD_ASSEMBLY_LIMITS.assets` 50,000 — candidate (b) BREACHES it.**
  ADR 0025 D6 measured 9.61% headroom at one asset per parent and named a
  multi-asset-per-building scheme as the thing that breaks it. Candidate (b) is
  that scheme.

**D6 — The 883-cell rights envelope is a NAMED USER GATE.** Every one of the 883
ledger cells is `publicEligible: false` pending per-cell rights evidence. Any
future path that ships per-cell or per-building artifacts island-wide must clear
that gate **with the user, explicitly, before T004/T005 mass shipping** — not as
a step inside an implementation task. Candidate (c) does not touch this gate,
because it ships nothing; it is recorded because adopting (c) must not be allowed
to make the gate look resolved.

**D7 — Two measurements are NOT measurements, and are labelled.**

- **Decoded GPU bytes inside Cesium are not observable from this task.**
  `exterior-cell-runtime.ts` already declares decoded GPU memory out of scope for
  its byte ceiling. The 59.80 MiB quoted for (c) is a POSITION-only structural
  floor. T002 must measure the real figure before any frame budget is claimed.
- **The per-request round-trip rate is an assumption.** No committed acceptance
  evidence records one; the recorded network evidence is request *counts*. Times
  are stated at 5 ms and 20 ms. The request *count* — 56 against 883 against
  44,330 — is exact, and it is the part that separates the candidates.

## Consequences

**Unconditional — these hold whatever the user decides about D1:**

- **T002 (scheduler)** can now be built against committed evidence:
  `cell-extents.json` gives it the render extents the ledger never carried. Cull
  on `renderBounds`, never on `assignmentBounds`.
- **T002 inherits four measurement obligations** this task could not discharge:
  decoded GPU bytes inside Cesium; per-request latency; Cesium Primitive rebuild
  cost on shard stream-in and eviction-driven refetch; and a rendered A/B still
  at overview distance.
- **T002 inherits two open contract questions**: the shared-cache reservation
  (above), and the detail-radius / transition-gate pair — the p95 crosses one
  pixel at ~2.4 km while AC #3's 2% transition bar is exceeded by 51.81% of the
  island, so neither can be chosen alone.
- **The 899 refusals stay disclosed**, and this task added their exact stage
  split: 864 at the plan stage, 35 at the asset stage.
- **The corrected premises hold regardless**: there is no committed plan corpus
  (474 promoted entries), and extents were not previously committed.

**Conditional on D1 being approved through a goal amendment:**

- T002 would schedule *shard* residency for overview rather than cell-asset
  residency.
- **T004/T005** would assume there is no overview tier to build and that their
  promotion work concerns near-field V3 detail only. **Until the amendment
  lands, they must plan against the approved goal as written** — AC #2 and AC #4,
  coarse-LOD regeneration for all six waves — and treat this record as evidence
  submitted against those criteria, not as their repeal.

## Reversal

D1 is not in force, so there is nothing to reverse until the goal amendment it
asks for is approved. Once it is, D1 is reversed by a recorded decision citing a
measured result — a frame-time, GPU or cache-thrash figure that a
visibility-bounded candidate (c) cannot meet. It is not reversed by preference
for a tier that has been built before.

If the user declines the amendment, this record stands as the measurement base
and AC #2 and AC #4 proceed as approved; the numbers here then become the cost
estimate for building the tier rather than the argument against it.
