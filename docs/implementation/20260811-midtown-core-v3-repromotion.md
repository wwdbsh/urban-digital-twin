# Midtown-core V3 wave repromotion (untextured) — P3

Date: 2026-08-11 (Asia/Seoul) · Task T026 — Issue #44 · Decision record:
[ADR 0033](../decisions/0033-block835-v3-wave-repromotion.md)

Release built: `manhattan-midtown-core-cells-20260811-v3`
(`defaultHead` = `snapshot:manhattan-midtown-core-cells-20260811-v3:v1`,
`638be88afb71f3d761af58ccf901c5f375643e9df100d8968549e20f870c167e`), 623 files,
35,684,593 B.

Predecessor, retained and byte-untouched: `manhattan-midtown-core-cells-20260811`.

Committed records: [`data/midtown-core-20260811-v3/`](../../data/midtown-core-20260811-v3/)
— `payload-inventory.json`, `derivation.json`, `v3-census.json`,
`evidence-inventory.json` (172 files). Raw evidence is untracked under
`artifacts/midtown-core-20260811-v3/`.

## STOP: this promotion is NOT shippable as it stands

**The frame gate could not be certified, and the reason is a contract limitation
rather than a frame-time result.** The measured numbers below are real, but the
scene they were measured over contained **no Midtown geometry at all**, so they
certify nothing about this wave. Read the finding before the numbers.

### The finding

A renderable cell that contains a REFUSED building is not representable by the
current assembly + runtime contract. Two independent gates, each correct on its
own, are jointly unsatisfiable in that case:

| Gate | Rule | Where |
| --- | --- | --- |
| Assembly validator | every building listed in `manifest.cells[].buildingIds` must have a packaged asset | `multi-lod-assembly.ts:342` |
| Cell runtime | the assembly cell's `buildingIds` and `membershipChecksumSha256` must equal the OWNERSHIP cell's, exactly | `exterior-cell-runtime.ts:524-527` |

The first forbids listing a building with no asset. The second forbids listing
anything other than the full owned membership. A cell owning 77 buildings of
which the grammar can draw 75 therefore has no legal assembly representation.

This build lists the packaged membership, which satisfies the assembly validator
and is refused by the runtime. Measured directly on the emitted bytes:

| Cell | Assembly members | Owned members | Verdict |
| --- | ---: | ---: | --- |
| `…w01-000001-14-4823-4482` | 75 | 77 | membership checksum mismatch |
| `…w01-000002-16-19296-17928` | 21 | 22 | membership checksum mismatch |
| `…w01-000003-16-19297-17928` | 60 | 61 | membership checksum mismatch |

All three renderable cells are rejected with
`No assembly package binds cell release … Rejected: … cell membership checksum
mismatch`, so the wave streams its index, graph and assemblies and then requests
**zero** GLBs.

### How it was caught

Not by the frame numbers — they looked fine. By the anti-F2 residency check the
P2 record established as load-bearing. The probe reported **14 cache entries /
1,910,784 B**, which matches neither Block 835 V3's fourteen assets
(5,126,332 B) nor any plausible Midtown subset. A CDP run with
`Network.enable` then measured the fact directly:

| Requests during the probe run | Count |
| --- | ---: |
| `manhattan-midtown-core-cells-20260811-v3` — any | 3 (index, graph, assemblies) |
| `manhattan-midtown-core-cells-20260811-v3` — `.glb` | **0** |
| `manhattan-exterior-cells-20260811-v3` — `.glb` | 15 |

T014 measured the V2 wave at 15.9 MB / 174 combined cache entries over the same
camera path, so this is a regression introduced by P3, not a pre-existing
condition.

### The two ways out, both of which need authorization

1. **Refine the contract** so an assembly may package a strict subset of an
   owned cell, provided the runtime verifies that the unpackaged remainder is
   exactly the set the cell release marks `unavailable`. This preserves the
   guarantee both gates exist for — nothing silently missing — while admitting
   the honest case. It is a platform-wide change to `multi-lod-assembly.ts` and
   `exterior-cell-runtime.ts`, both shared with Block 835, and is the same class
   of decision as ADR 0033 Decision B.
2. **Choose renderable cells that contain no refusal.** No platform change, but
   it abandons "the same three priority cells as V2", which is what made the
   V2→V3 availability delta attributable to the grammar alone, and it changes
   the cache-safety rationale the bounded renderable set was justified by.

Nothing was papered over to reach a green run: the release is emitted, every
validator and replay passes, and the defect is a runtime binding refusal that
only a real browser (or the runtime suite, had it covered this shape) exposes.

## The V3 census — the number this phase exists to produce

V2's census does not transfer. V2 planned over an oriented bounding RECTANGLE,
so every footprint was representable and its refusals were size-driven. V3 plans
over the sourced DOITT ring vertex for vertex, so a real polygon can be refused
for properties a rectangle could never have.

All 7,201 owned buildings of wave `w01`:

| Outcome | Count | Share |
| --- | ---: | ---: |
| Materialized | 7,091 | 98.47 % |
| Refused | 110 | 1.53 % |
| — `source-height-below-grammar-minimum` | 49 | sourced height below one floor of the 3,600 mm target |
| — `ring-vertex-count-unsupported` | 41 | ring above the 64-vertex V3 limit |
| — `ring-area-below-floor` | 17 | below the 20 m² footprint area floor |
| — `ring-neck-below-grammar-minimum` | 2 | legal ring, too pinched to place openings without punching through |
| — `volume-identity-failed` | 1 | emitted mesh missed its own analytic volume |
| Materialized with `setbacks` **absent** | 3,405 | 48.0 % of materialized — tier offset refused, disclosed with a reason |

Refusal codes are classified from the generator's own `issue.path` values, never
from message text: paths are part of its validation contract, wording is not.

**The one volume-identity refusal is reported rather than absorbed.**
`doitt:627278` measures 607.8078 m³ against an analytic 607.8087 m³ — a relative
deviation of 1.397e-6 against a 1e-6 bound. The tolerance was not loosened to
admit it; the building is refused. It lies outside the renderable cells, so it
changes no shipped byte. Its existence is the evidence that the gate bites.

**3,405 tier collapses is the largest single fact in this census.** Nearly half
of Midtown's real footprints cannot carry an inward tier offset without
self-intersecting, and V3 refuses the offset rather than repairing it. Those
buildings ship a single-tier massing with `setbacks` declared `absent` and the
refusal reason attached, promoted under the conditionally-applicable admission
ADR 0033 Decision B added. On Block 835 that rule admitted five of fourteen
buildings; at wave scale it admits 3,405 of 7,091, which is a much larger
reliance on the same rule than Block 835 gave any reason to expect.

Wave-scale measurements, all on emitted bytes:

| Measure | Worst across 7,091 buildings | Bound |
| --- | ---: | ---: |
| Analytic volume deviation | 9.381e-7 | 1e-6 |
| Per-vertex shape deviation vs the sourced ring | 0.71 mm | 50 mm |
| Horizontal placement deviation | 0.45 mm | 250 mm |
| Vertical placement deviation | 0.50 mm | 500 mm |
| LOD triangles | 132,536 | 200,000 |
| Materials | 9 | 12 |
| Textures | 0 | 0 |
| Unique plan hashes | 7,091 of 7,091 | — |

Every sourced ring is clockwise (7,091 of 7,091 reversed to CCW); the reversal is
recorded per building, never silent. 21 buildings carry a disclosed fallback
height. Style classes: `masonry-warm` 2,441, `masonry-light` 2,204,
`stone-neutral` 1,401, `curtain-cool` 1,045 — all the grammar's own designed
draw, since no Midtown building carries a cited facade fact.

## Availability: 160 → 156

The renderable set is unchanged — the same three priority cells V2 shipped — so
the delta is attributable to the grammar alone.

| Withdrawn building | Code | Sourced fact the grammar could not carry |
| --- | --- | --- |
| `doitt:88101` | `ring-vertex-count-unsupported` | ring above 64 vertices |
| `doitt:749711` | `ring-vertex-count-unsupported` | ring above 64 vertices |
| `doitt:399990` | `source-height-below-grammar-minimum` | height below one floor |
| `doitt:555676` | `source-height-below-grammar-minimum` | height below one floor |

All four ship as explicit `unavailable` details carrying their refusal text. No
building is added; the successor may withdraw what it cannot honestly draw and
may never invent what the predecessor did not own. 146 tombstone cells as
before. Of the 156 shipped, **65 carry an absent `setbacks` component**.

## Blender stratified sample — 81 buildings

`scripts/blender/midtown_core_v3_sample.py`, driven through Blender MCP into a
disposable scene (`udt_t026_midtown_core_v3_sample`). Selection is a derivation
from release bytes: ten V3 strata × 4 (most/fewest ring vertices, tallest,
shortest, largest/smallest footprint area, most/fewest triangles, fallback
height, most tiers), each ordering ending in ascending building id, plus **every**
tier-collapse case in the renderable cells rather than a sample of them. 40 by
strata, 65 tier-collapse, 24 shared, 81 distinct.

| Measure | Result |
| --- | --- |
| Triangle delta vs declared assembly quality | **0** |
| Material-count mismatches | **0** |
| GLB-embedded images | **0** |
| Y-up re-import bounds deviation | **0.0 m** |
| Z-up control hypothesis (minimum across samples) | **3.668 m** |
| Worst analytic volume deviation | **7.591e-7** (bound 1e-6) |
| Surfaces failing the solid test | **0** |
| Re-imported triangles | 404,356 |

The Z-up control is what makes the bounds diff worth reporting: at 0.0 m against
a control that never falls below 3.668 m, the diff discriminates rather than
agreeing with whatever it is handed.

Two measurement bugs were found and fixed during the pass, and both had produced
a flattering number. `bpy.data.images` was counted after rendering, so Blender's
own "Render Result" datablock reported one embedded image per texture-free asset
(81 → 0). And the T013 camera scale crops a 200 m tower whose diagonal overruns
the frustum at 2.6× its own bounding-sphere radius, so a fit floor was added that
only ever moves the camera back — every sample T013's scale already framed keeps
that framing exactly.

## Frame gate — RUN, NOT CERTIFIED

Production build (`VITE_BLOCK835_PROBE=1`), `vite preview` on `localhost:4311`,
dedicated desktop Chrome 151 launched with `--remote-debugging-port` /
`--user-data-dir` / `--js-flags=--expose-gc`, driven over CDP with
`Page.bringToFront`. Viewport 1728×826 CSS px at devicePixelRatio 2, ~149 Hz.
1 s settle, 8 poses × 60 samples × 4 repeats = 1,920 accepted samples.
`documentHasFocus` true before and after, 0 console errors, `localhost:4311` the
only host contacted. Camera path: `midtown-core-canary-facade-v1-oblique` — the
T014-era footprint-framed Midtown path, unchanged, since its poses are framed on
base footprint bounding boxes and sourced heights that V3 does not move.

| Profile | Median | p95 | Budget | Frame-time verdict |
| --- | ---: | ---: | --- | --- |
| exploration | 8.30 ms | 10.00 ms | 16.7 / 25 | within budget |

**These numbers are not a pass.** The residency check fails: 14 cache entries /
1,910,784 B and **0 Midtown GLB requests**, so the camera flew a Midtown path
over a scene with no Midtown geometry in it. An empty scene measures fast and
proves nothing. The inspection profile was not run, because a second measurement
of the same empty scene would add nothing.

Peak concurrency 4 (limit 8); peak exterior cache 1,910,784 B (limit 256 MiB);
0 evictions; JS heap with forced collection shrank 1.3 % across repeats. All of
those are also statements about the wrong scene.

## Gates

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | Pass |
| `pnpm lint` | Pass, 0 problems |
| `pnpm test` | 88 files / **948 tests**, all pass. Baseline before P3: 85 files / 899 tests. |
| `pnpm build` (default) | Pass; probe absent; 4 private partitions pruned |
| `VITE_BLOCK835_PROBE=1 pnpm build` | Pass |
| `git diff --check` | Clean |
| V2 midtown byte-freeze | `midtown-core-release.test.ts` 18/18, including its committed-inventory replay — the V2 wave reproduces byte for byte through the now-two-profile emitter |
| Double-run determinism | V3 payload inventory byte-identical across two `graph --force` runs |
| Graph / assembly / index validation | All three clean on the emitted successor bytes |
| Artifact replay | 623 emitted files verified against their declared checksums and byte sizes |
| Anti-leak | 0 `private/`-prefixed paths emitted; private root declares exactly 1 artifact, never written |
| Immutability | `data/midtown-core-20260811/` and every frozen `public/data/` directory untouched; only additions |
| **Runtime cell binding** | **FAIL — see the STOP section** |
| Renderer journeys | **Not run** — with no Midtown geometry loading, every journey would document the defect rather than the wave |
| Rollback rehearsal (browser) | **Not run** — same reason. The record-level rehearsal IS covered by test |

### Test changes, enumerated

| File | Change | Why |
| --- | --- | --- |
| `exterior-midtown-promotion-record.test.ts` | Re-bound to the RETAINED V2 record; assertions otherwise unchanged; + `rolledBackReleaseId` is null while it is only a predecessor | A rollback target that stopped being verified is a rollback target nobody can trust |
| `exterior-midtown-v3-promotion-record.test.ts` (new) | 13 tests | The active record's own never-skipped gate: every pin recomputed from the committed inventory, the 160→156 drift derived from both waves' inventories, the V2 digest proven NOT to satisfy the V3 pin, the withdrawn-link refusal rehearsed both ways |
| `exterior-multiwave-activation.test.ts` | Release ids → `-v3`; "rolls one wave back" rewritten for the enabled predecessor; + a new test keeping the base-only withdrawal covered | Midtown's predecessor changed shape by design; the notice text for a base-only withdrawal still exists and would otherwise stop being exercised |
| `App.test.tsx` | Pinned-allowlist assertion gains the successor id; `MIDTOWN_CORE_EXTERIOR_RELEASE_ID` → `-v3` | The promoted default moved; V2 opt-in paths deliberately still tested |
| `midtown-core-v3-materialization.test.ts` (new) | 15 tests, all synthetic so they run on a fresh clone | New materializer |
| `midtown-core-v3-release.test.ts` (new) | 20 tests | New release, profile and predecessor derivation |

No test was deleted or weakened.

## Carried forward

1. The runtime cell-binding contract limitation above, which blocks promotion.
2. The **3,405** wave-scale tier collapses. ADR 0033 Decision B was accepted on
   evidence of five buildings in fourteen. Whether it should still read the same
   way at 48 % of a wave is a decision this record raises and does not make.
3. Textured public admission (P4) remains unmeasured and ungated.
