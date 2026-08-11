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

## The contract refinement this phase required

A renderable cell containing a REFUSED building had no legal representation.
`multi-lod-assembly.ts:342` forbids listing a building with no packaged asset;
`exterior-cell-runtime.ts:524` required an assembly cell's membership to equal
the OWNERSHIP cell's exactly. A cell owning 77 buildings of which 75 are
drawable satisfied neither together, so all three renderable Midtown cells were
refused at runtime binding and the wave loaded **zero** GLBs.

**It was caught by the anti-F2 residency check, not by the frame numbers, which
looked fine** — 8.30 / 10.00 ms over a scene with no Midtown geometry in it. The
probe reported 14 cache entries / 1,910,784 B, matching neither Block 835 V3's
fourteen assets nor any plausible Midtown subset; a CDP run with `Network.enable`
then measured 3 Midtown requests and 0 Midtown GLBs. That first run was reported
as a **non-result**, not a pass.

`assemblyCellCoverage` (new, in `multi-lod-assembly.ts`, applied by
`exterior-cell-runtime.ts`) replaces equality with the property equality was a
proxy for: every owned building is either **packaged** or **explicitly
unavailable with a stated reason**, the two sets are disjoint, and together they
are exactly the owned set — set equality both ways. The membership checksum is
re-derived over the packaged list so it always describes the list beside it.

Byte-neutral for fully packaged cells: an empty unavailable set reduces the rule
to the original equality, so Block 835 V2/V3 and the fixture releases pass with
their suites unmodified, and re-emitting the Midtown V3 release under the refined
rule reproduced the **identical** payload inventory checksum
`435a4bd6a1b351656acfffcf1bcaa68d341f955e72b4af55fe1d83635b924b55`, so no
promotion pin moved. See ADR 0033 Decision G.

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

## Frame gate — CERTIFIED

Production build (`VITE_BLOCK835_PROBE=1`), `vite preview` on `localhost:4311`,
dedicated desktop Chrome 151 launched with `--remote-debugging-port` /
`--user-data-dir` / `--js-flags=--expose-gc`, driven over CDP with
`Page.bringToFront`. Viewport 1728x826 CSS px at devicePixelRatio 2, ~145 Hz.
1 s settle, 8 poses x 60 samples x 4 repeats = **1,920 accepted samples per
profile**. `documentHasFocus` true before and after both runs, 0 console errors,
0 window errors, `localhost:4311` the only host contacted. Camera path:
`midtown-core-canary-facade-v1-oblique` — the T014-era footprint-framed Midtown
path, unchanged, because its poses are framed on base footprint bounding boxes
and sourced heights that V3 does not move.

| # | Criterion | Verdict | Evidence |
| ---: | --- | --- | --- |
| 1 | Exploration median <=16.7 ms / p95 <=25 ms | **pass — measured** | **8.30 / 10.00 ms**, `droppedFrameRatio` 0.0042 (`json/p0-exploration.json`) |
| 2 | Inspection median <=33.3 ms / p95 <=45 ms | **pass — measured** | **8.30 / 10.00 ms**, `droppedFrameRatio` 0.0036 (`json/p0-inspection.json`) |
| 3 | <=8 active exterior requests | **pass** | measured peak **4** |
| 4 | <=256 MiB exterior cache | **pass** | peak **22,795,224 B**, 0 evictions |
| 5 | No monotonic retained growth | **pass, with forced collection** | JS heap with `window.gc()` shrank -9.4 % (exploration), -5.2 % (inspection) |

**Residency — the load-bearing anti-F2 check.** 170 cache entries, stable across
all four repeats of both profiles, decomposing exactly:

| Contribution | Entries | Bytes |
| --- | ---: | ---: |
| Midtown V3 `lod_0` (the promoted wave) | 156 | 20,884,440 |
| Block 835 V3 `lod_1` (coarsest verified LOD in exploration) | 14 | 1,910,784 |
| **Total** | **170** | **22,795,224** |

157 Midtown GLB requests were observed on the wire (156 distinct, one repeat).
An empty scene measures fast and proves nothing; this one contained every
building the promotion claims.

## Renderer journeys

All against the production build in the same focused Chrome. Screenshots under
`artifacts/midtown-core-20260811-v3/screenshots/`.

| Journey | Result | Evidence |
| --- | --- | --- |
| Default cold load, both V3 waves | 156 Midtown V3 + 14 Block 835 V3 GLBs, 0 console errors; two status lines, each naming its OWN snapshot | `forward-default-cold-load.png` |
| Cross-release attribution | `?feature=doitt:1294316` shows badge `LOCAL · MANHATTAN-MIDTOWN-CORE-CELLS-20260811-V3`, release origin `snapshot:…-v3:v1`, the `…-v3:…` cell-release id, and active asset `lod_0` with its checksum | `forward-attribution-midtown.png` |
| Tombstone truthful line | "Exterior release manhattan-midtown-core-cells-20260811-v3: 146 of 149 exterior cells ship no exterior geometry in this release; no substitute was selected for them." | `forward-default-cold-load.png` |
| Withdrawn building | `?feature=doitt:88101` (refused, >64 ring vertices): "No verified exterior representation is active for this record." — truthful; see the follow-up below | `forward-tombstone-refused.png` |
| Explicit opt-in narrows to one wave | `?exteriorCells=…midtown…-v3` streams that release **alone** (Block 835 drops to 0 GLBs) | `forward-optin-midtown-v3.png` |
| Per-wave disable | `?exteriorStreaming=off` → 0 exterior GLBs, no exterior status lines | `forward-disable.png` |
| Fixture silence | A fixture-mode session claims no exterior wave and reports none; 0 exterior GLBs | `forward-fixture-silence.png` |
| **Rollback rehearsal** | Exporting the predecessor puts **V2 back on** — 160 V2 GLBs, 0 V3 — with Block 835 V3 unaffected (14 GLBs) | `rollback-v2-default.png` |
| Rollback refuses the withdrawn link | `?exteriorCells=…-v3` → "Exterior streaming release manhattan-midtown-core-cells-20260811-v3 was rolled back in this build, so this link streamed no exterior geometry; no substitute exterior release was selected." | `rollback-withdrawn-link-refused.png` |
| Roll forward again | The restored record streams 156 Midtown V3 + 14 Block 835 V3 again | verified after restore |

The rollback rehearsal was performed by actually exporting the predecessor
record, rebuilding, and driving the browser — then restoring the forward record
(byte-identical to the committed file) and rebuilding. It is not a simulated
swap.

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
| `-v3e` package drift | Pass — rebuilt manifest fingerprint `7acd2a15…` matches the committed bytes, all 29 artifacts byte-for-byte |
| Cited-style admission at emit | Pass — re-derived from the rights-cleared admission, never copied from the input manifest |
| Runtime cell binding | Pass — 170 resident cache entries, 157 Midtown GLB requests |
| Renderer journeys | Pass — 10 journeys, 0 console errors |
| Rollback rehearsal (browser) | Pass — real record swap, rebuild, drive, restore |

### Test changes, enumerated

| File | Change | Why |
| --- | --- | --- |
| `exterior-midtown-promotion-record.test.ts` | Re-bound to the RETAINED V2 record; assertions otherwise unchanged; + `rolledBackReleaseId` is null while it is only a predecessor | A rollback target that stopped being verified is a rollback target nobody can trust |
| `exterior-midtown-v3-promotion-record.test.ts` (new) | 13 tests | The active record's own never-skipped gate: every pin recomputed from the committed inventory, the 160→156 drift derived from both waves' inventories, the V2 digest proven NOT to satisfy the V3 pin, the withdrawn-link refusal rehearsed both ways |
| `exterior-multiwave-activation.test.ts` | Release ids → `-v3`; "rolls one wave back" rewritten for the enabled predecessor; + a new test keeping the base-only withdrawal covered | Midtown's predecessor changed shape by design; the notice text for a base-only withdrawal still exists and would otherwise stop being exercised |
| `App.test.tsx` | Pinned-allowlist assertion gains the successor id; `MIDTOWN_CORE_EXTERIOR_RELEASE_ID` → `-v3` | The promoted default moved; V2 opt-in paths deliberately still tested |
| `midtown-core-v3-materialization.test.ts` (new) | 15 tests, all synthetic so they run on a fresh clone | New materializer |
| `midtown-core-v3-release.test.ts` (new) | 20 tests | New release, profile and predecessor derivation |
| `block835-v3-canary-release.test.ts` | + 2 tests: a forged `citedStyle` on a non-admitted building, and a dropped one on the admitted building, are both refused at the emit gate | `citedStyle` was the one trust-bearing field on that path that was copied from the private manifest rather than re-derived; both tests fail without the fix |
| `block835-v3e-package.test.ts` (new) | 6 tests | The committed `-v3e` package — the one this build actually promotes — had no rebuild-versus-committed drift gate; its determinism fingerprint existed only in prose. The fingerprint constant was obtained by rebuild, not transcribed |
| `assembly-cell-coverage.test.ts` (new) | 8 tests | The refined coverage rule: the honest subset is admitted, and every way of losing the anti-silent-omission property is refused — a building neither packaged nor unavailable, a building that is both, a foreign building from either side, a subset, a superset, a repeat, and a checksum describing a different set |

No test was deleted or weakened.

## Carried forward

1. **A refused building's details panel does not name its refusal reason.** The
   release graph carries it verbatim, and the cell-level tombstone line is
   truthful, but `?feature=doitt:88101` says only "No verified exterior
   representation is active for this record." That is true and not misleading;
   it is also less than the release knows. Surfacing the per-building reason is
   a small, self-contained UI follow-up and was left out of this phase rather
   than bundled into a promotion.
2. The **3,405** wave-scale tier collapses, now recorded in ADR 0033
   Decision B with the visual consequence and the note that broader setback
   support is future grammar work rather than a claim.
3. Textured public admission (P4) remains unmeasured and ungated.
4. Waves w02–w05 will exercise Decision G at ~38,000 buildings; at the measured
   1.53 % refusal rate, refusals in renderable cells become the normal case
   rather than the exception.
