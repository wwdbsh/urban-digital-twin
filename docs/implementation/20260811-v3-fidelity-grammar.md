# 2026-08-11 — V3 footprint-faithful facade grammar (T025, Issue #43)

Decision record: `docs/decisions/0031-v3-footprint-faithful-facade-grammar.md`.

Landed in nine commits. All phases are now complete: P5's
Blender proof and P6's successor package are recorded below. No pre-existing
release tree and no byte of `src/runtime/exterior-default-activation.ts` or the
canary graph were touched.

## What changed

| File | Purpose |
| --- | --- |
| `src/features/explorer/CesiumViewport.tsx` | One draw-precedence rule — exterior wave > pilot asset > procedural extrusion — consulted by the dense primitive plan, the semantic entity groups, the commercial overlay's direct pilot-model path and the selected-feature re-add. Coverage read synchronously from the `exteriorOverlay` prop. Separate effect applies a selection silhouette to exterior entities. |
| `src/features/explorer/exterior-coverage-precedence.test.ts` | New. Fail-open-to-base, precedence, and unchanged non-exterior selection. |
| `src/release/canonical-glb.ts` | `CanonicalGlbTri`, written after each material bucket's quads so quad-only input is byte-identical. |
| `src/release/canonical-glb.test.ts` | New. Golden hash from the pre-change writer, triangle grouping, fail-closed cases. |
| `src/domain/deterministic-facade-generator-v3.ts` | New. The V3 kernel: input contract, ring predicates, mitered offset with four refusal causes, ear clipping, corner clearance, thickness gate, tiers, surfaces, placements, prisms, style classes, base/shaft zoning, plan validation, tessellation. |
| `src/domain/deterministic-facade-generator-v3.test.ts` | New. Pin tests (19)–(22) plus the volume identity (23a), all against the fourteen real footprints. |
| `src/release/block835-v3-package.ts` | New. `V3_QUALITY_BUDGETS`, `V3_REGISTRATION_TOLERANCE`, `V3_REGISTRATION_METHOD`. |
| `src/release/block835-v3-package.test.ts` | New. Pins the new budget AND that `BLOCK835_QUALITY_BUDGETS` did not move. |
| `scripts/blender/block835_v3_author.py` | New. Transliterated tessellation, shoelace volume identity, up-axis-asserting re-import diff, renders. |

## Measured results

| Building | Ring vertices | Genuine reflex | Tiers | LOD0 triangles | Style |
| --- | --- | --- | --- | --- | --- |
| `doitt:778052` (ESB) | 14 | 3 | 4 | 102,988 | masonry-light |
| `doitt:131170` | 19 | 1 | 1 (refused) | 16,232 | curtain-cool |
| `doitt:982383` | 8 | 2 | 4 | 5,022 | stone-neutral |
| `doitt:584049` | 6 | 0 | 2 | 1,832 | stone-neutral |
| `doitt:925937` | 4 | 0 | 2 | 1,208 | masonry-light |

Worst case is the ESB at 102,988 triangles. Five of fourteen refuse their tier
offset and declare `setbacks` absent. Volume identity deviation is below 1.2e-7
for all fourteen at both levels of detail.

## P5 — the Blender proof (executed 2026-08-11)

Blender MCP reconnected and the pass ran to completion on a fresh default scene.
Fourteen buildings were authored per-building and dropped after measurement; the
scene never held more than one at a time.

### (23) Mesh-integral volume vs the analytic shoelace identity

Blender integrates each authored mesh with the divergence form
`sum(center . normal * area) / 3` and compares it against the analytic identity:
shoelace ring area times tier height, less every recess box, plus every
protrusion box and rooftop prism. Corner clearance is what makes the box terms a
plain sum — no two placement boxes can meet inside a corner.

| | Value |
| --- | --- |
| Assets measured | 14 buildings x 2 LODs = **28** |
| Relative tolerance | **1e-6** |
| Worst relative deviation | **1.88e-7** (`doitt:812702` LOD 0) |
| `boundsASolid` | 28 / 28 |
| `outwardNormalsConsistent` | 28 / 28 |

The measure is deliberately *not* combinatorial 2-manifoldness. Row strips meet
piers at T-junctions — geometrically coincident, combinatorially unmatched — and
shipped GLBs duplicate every vertex per face anyway. The volume identity is what
actually catches a hole, an inverted normal, a self-overlapping tier ring, a
placement punched through a neck, or a doubly tiled wall row.

### The up-axis re-import diff, corrected

The P5 draft asserted "the tallest world extent came back as Z". **That is not
an up-axis test.** Most of Block 835 is wider than it is tall, so a low-rise
satisfies or fails it for reasons unrelated to the file's axis convention — the
first run reported `upAxisIsYUpInFile: false` for `doitt:102705`, a correct
answer to the wrong question. It was replaced with a coordinate diff.

Each shipped GLB is re-imported with **no compensation applied**. The file is
+Y-up `(east, height, -north)`; Blender's importer applies `(x, y, z) -> (x, -z,
y)`. Composed, the two recover the ENU authoring frame exactly, so imported
world coordinates must equal authored ones.

| | Value |
| --- | --- |
| Files diffed | **28** |
| Worst bounds deviation | **0.000 m** (tolerance 1e-3 m) |
| Vertex-count mismatches | 0 |
| Position-set mismatches | 0 |
| Minimum **control** deviation | **15.455 m** |

The control column is what stops the agreement being vacuous: it reports where
the same bytes would have landed had the writer emitted Z-up. Fifteen metres off
at minimum, so the diff discriminates.

### Renders

Four fixed perspective views per building (56) plus the two-LOD orthographic
silhouette pairs (112) — **168 PNGs**. The silhouette pairs double as the LOD 1
transition evidence: worst measured deviation **0.00183** against the 0.02
contract bound. It is not exactly zero because a recess at a grazing edge can
flip a boundary pixel; that is rasterisation, and it is reported rather than
rounded away.

### Evidence

Written under `artifacts/blender/manhattan-esb-block-reference-20260811-v3/`,
which is gitignored. Three records are promoted into `data/` so the numbers stay
checkable after that tree is gone, and
`src/release/block835-v3-package.test.ts` re-asserts each against its own stated
gate — including that every promoted measurement still binds the current plan
hash:

| Committed file | Contents |
| --- | --- |
| `blender-volume-identity.json` | Per-building, per-LOD volumes, deviations and topology counts |
| `blender-reimport-up-axis.json` | Per-file re-import diff with the Z-up control column |
| `blender-evidence-inventory.json` | SHA-256 of all **186** raw evidence files |

## P6 — the V3 successor package

`public/data/manhattan-esb-block-reference-20260811-v3/`, 29 artifacts,
7,042,937 declared bytes, assembly fingerprint
`18582f59281346f586e137a89392250bdec83465d75e527a1004ba74eabdbbcf`.

The `-v3` suffix is not decoration. The V2 successor already owns the plain
`20260811` stamp and is byte-frozen, so a same-day V3 package needs its own
directory rather than a collision with a package it must not edit.

### Census — all fourteen

| Building | Ring vtx | Reflex | Tiers | Setbacks | Style | LOD0 tri | LOD1 tri | Vol dev LOD0 | Per-vertex shape (mm) |
| --- | ---: | ---: | ---: | --- | --- | ---: | ---: | ---: | ---: |
| `doitt:102705` | 11 | 2 | 2 | generated | stone-neutral | 1,026 | 390 | 6.89e-08 | 0.597 |
| `doitt:131170` | 19 | 1 | 1 | **absent** | stone-neutral | 16,232 | 6,340 | 2.96e-08 | 0.676 |
| `doitt:147902` | 6 | 1 | 2 | generated | masonry-light | 1,962 | 786 | 4.32e-08 | 0.574 |
| `doitt:262867` | 9 | 0 | 1 | **absent** | masonry-warm | 632 | 288 | 5.18e-08 | 0.560 |
| `doitt:39969` | 7 | 1 | 1 | **absent** | masonry-light | 1,980 | 788 | 6.18e-09 | 0.603 |
| `doitt:460555` | 8 | 0 | 2 | generated | masonry-light | 1,560 | 672 | 2.40e-08 | 0.577 |
| `doitt:498980` | 7 | 0 | 2 | generated | stone-neutral | 1,020 | 404 | 7.75e-08 | 0.537 |
| `doitt:502491` | 7 | 0 | 2 | generated | masonry-light | 1,256 | 496 | 8.92e-08 | 0.551 |
| `doitt:584049` | 6 | 1 | 2 | generated | masonry-light | 1,832 | 728 | 5.74e-08 | 0.444 |
| `doitt:778052` (ESB) | 14 | 3 | 4 | generated | curtain-cool | 102,988 | 36,032 | 5.53e-08 | 0.626 |
| `doitt:812702` | 9 | 1 | 1 | **absent** | masonry-light | 1,268 | 544 | 1.88e-07 | 0.605 |
| `doitt:835659` | 7 | 0 | 1 | **absent** | stone-neutral | 1,490 | 602 | 1.18e-07 | 0.573 |
| `doitt:925937` | 4 | 0 | 2 | generated | masonry-light | 1,208 | 484 | 1.75e-07 | 0.559 |
| `doitt:982383` | 8 | 0 | 4 | generated | curtain-cool | 5,022 | 1,846 | 2.96e-08 | 0.510 |

Style classes here differ from the interim P3/P4 table above: style is drawn
from the plan hash, and the shipped package seeds with
`block-835-reference-20260811-v3` rather than the test harness's
`block-835-reference-v3`. Nothing geometric moved — ring counts, reflex counts,
tier counts and triangle counts are identical across both seeds. **The ESB
drawing `curtain-cool` does not resemble the real Empire State Building.** That
is the grammar working as designed and as disclosed: V3 follows the sourced
polygon and height, and invents everything about appearance.

### Gates

| Gate | Result |
| --- | --- |
| Buildings shipped | **14 / 14** |
| Distinct plan hashes | **14** — no two buildings ship identical geometry |
| Double-run byte-identical replay | **32 files**, identical trees, identical fingerprint |
| Worst LOD0 triangles vs `V3_QUALITY_BUDGETS.maxTriangles` | 102,988 / 200,000 = **51.5 %** |
| Materials vs budget | max 9 / 12 |
| Textures | 0 / 0, every asset |
| `replayMultiLodAssembly` with `requireTextureFreeAssembly` | pass |
| Predecessor pins | cell + all 14 assets pinned to `manhattan-esb-block-reference-20260811` LOD 0 checksums |

### Registration — the claim actually changed

V1 and V2 registered the minimum-area oriented bounding **rectangle** of the
DOITT footprint, so their report measured pipeline drift and explicitly
disclaimed shape. V3 carries the true ring, so `registration.json` compares
**sourced footprint vertices** against shipped ground-ring vertices.

| Measure | Worst | Tolerance |
| --- | ---: | ---: |
| Per-vertex shape deviation (symmetric, ring only) | **0.68 mm** | 50 mm |
| Whole-asset horizontal placement drift | **0.28 mm** | 250 mm |
| Vertical | **0.46 mm** | 500 mm |
| Ring-vertex presence in shipped bytes | **0.000 mm** | 1 mm |

**Direction and candidate set, stated with the number.** The shape figure is
`max(sourceToRing, ringToSource)` — the worse of (worst sourced vertex to its
nearest shipped ring vertex) and (worst shipped ring vertex to its nearest
sourced vertex). Its candidate set is the **tier-0 ring alone**, not every
vertex on the ground plane; the ground plane also carries entrance and
storefront recess corners, and searching that superset would let an unrelated
detail vertex stand in for a ring vertex. `ringVertexPresenceMeters` is reported
separately and proves the measured ring is the ring written into the bytes.

Both directions agree exactly on all fourteen footprints and the presence proof
is 0.000 m, so stating the measure in the stronger form changed **no published
number**. Only `registration.json` changed; every GLB, the manifest, the
ownership ledger and the tileset are byte-identical and the assembly fingerprint
is unmoved. The data simply did not exercise the failure modes the weaker form
allowed.

The two horizontal numbers are different measures and are never summed. Both are
**pipeline** tolerances: they bound this pipeline's error against the sourced
polygon and assert nothing about how well that polygon matches the real
building, and nothing at all about facade, colour or material.

### `absent` setbacks ship honestly

Five of fourteen refuse their tier offset outright and declare `setbacks`
absent with the refusal cause attached. The V2 assembler threw on anything but a
lone `generated` tier; **only the V3 assembler path was changed** to accept
`absent`, and only for the one component kind and the one cause the V3 plan
validator admits. `v3TruthTiers` throws on anything else.

## Frame-time re-check — what it does and does not prove

The triangle-budget raise from 75,000 to 200,000 is only legitimate once
measured frame time has been re-checked. Two things were measured, and they are
not the same thing.

**1. No-regression on the served wave.** The canary probe measures the release
the app actually streams, and the canary graph plus
`EXTERIOR_DEFAULT_ACTIVATION` still point at V2 this cycle (Decision 11). So
this run is a no-regression check on V2, taken after the V3 package landed in
the tree:

| | Value |
| --- | --- |
| Build / server | production `vite build`, `vite preview` on `localhost:4311` |
| Browser | desktop Chrome 151.0.7922.76, CDP-driven, `Page.bringToFront` |
| WebGL renderer | `ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro)` |
| Viewport / DPR | 1200 x 876 CSS px, DPR 2 |
| Path / poses | `block835-canary-facade-v1`, 8 poses x 4 repeats, closest 13 m |
| Frame samples | **1,920** |
| Median | **8.3 ms** (budget 16.7) — pass |
| p95 | **10.2 ms** (budget 25) — pass |
| Max | 17.1 ms |
| Display | 149 Hz, dropped-frame ratio 0.060 |
| Peak concurrency / cache | 4 / 8 requests, 15.5 MB / 256 MB |
| Console + window errors | 0 |
| Network hosts | `localhost:4311` only |

The viewport is not 1440p-class, so this does not assert the Goal's device
target.

**2. Static triangle gate on V3.** Every V3 asset is measured against
`V3_QUALITY_BUDGETS` at build time and the worst case uses 51.5 % of the raised
triangle budget.

**What is still missing.** Neither of these is a rendered-frame-time measurement
of V3 geometry, because nothing serves V3 yet. A full V3 renderer performance
run belongs to T026, when the canary graph is re-pointed. Until then
`V3_QUALITY_BUDGETS` gates the V3 package's own build and nothing that renders,
and this record claims no V3 frame-time evidence.

## Known unrelated conditions observed during this work

- **Issue #46 (camera roll=180).** Reproduced incidentally: a deep link built
  with `roll=0` was rewritten by the app to `roll=180.000000`. Pre-existing,
  outside these phases, not touched.
- **Flaky test, pre-existing.** `src/app/App.test.tsx > "closes details with
  Escape and returns focus to the located-pick trigger"` fails in roughly two of
  three full-suite runs and passes 58/58 in isolation. It **also flakes with the
  new V3 test file excluded**, so it is independent of this work. Not fixed here:
  it is an unrelated change.

## Defects this work found
1. **Duplicated Block 835 geometry (Issue #41).** Each building was drawn up to
   three times. Three separate draw paths each needed the same exclusion.
2. **Transposed term in the point-in-ring crossing test.** Every inward tier
   offset was reported as escaping its own ring, so every building silently
   collapsed to a single tier. Caught by the pin test on tier counts.
3. **Line-line miter on near-collinear vertices.** A 0/0 that threw vertices
   kilometres away on the nineteen-vertex ring. Replaced with the bisector form.
4. **Neck measure mistook a 51 mm digitising sliver for a 375 mm neck** and
   refused a real building.
5. **Protrusion boxes open at the back**, with the wall behind them still drawn.
6. **Rooftop prisms emitted at both LODs but counted in the identity at one.**
7. **Ground-floor entrance taller than its storefronts**, splitting the row into
   two overlapping v-bands and tiling the same wall twice.
8. **The P5 up-axis check tested the wrong proposition** (see P5 above). It was
   written while Blender was down and had never been executed; running it was
   what exposed it. A gate that has never run is not a gate.

Defects 5–7 were found by the volume identity alone. Every other gate — types,
lint, the full test suite, the plan hash round-trip — passed while they were
present. Defect 8 was found only by executing the pass.

## Still open

- **Nothing serves V3.** The canary graph and `EXTERIOR_DEFAULT_ACTIVATION` are
  byte-untouched and continue to serve V2. Re-pointing them, and the rendered
  frame-time run that requires, is T026.
- **Rendered V3 frame time is unmeasured**, as set out above.
- **No style override exists, and the first one has a boundary.** ADR 0031
  Decision 12 draws it before any override table is written: an override is
  legitimate only as a documented designer stylistic choice asserting nothing
  about a real address. An override justified by real-world appearance knowledge
  is an unsourced factual claim and must go through the ADR 0022 evidence intake
  with a real source ref instead.
- **The CLI has no stage-receipt caching, by design.** Every stage recomputes
  from the committed plans, so the T013 stale-resume defect class cannot arise.
  Anyone adding resumability must bind each receipt to the plan hash and input
  fingerprint it was computed from.
- **Style class is drawn, not observed.** The ESB shipping `curtain-cool` is the
  clearest illustration that V3's appearance layer asserts nothing about a real
  address. It is disclosed in every asset's uncertainty statement, but a viewer
  who does not read that statement will still see a blue-grey Empire State
  Building.
