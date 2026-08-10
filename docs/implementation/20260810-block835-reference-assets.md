# Block 835 generated-exterior reference assets implementation

Date: 2026-08-10 (Asia/Seoul)

Package: `manhattan-esb-block-reference-20260810`

Decision record: [ADR 0023](../decisions/0023-block835-reference-asset-authoring.md)

Source of truth: the pinned pilot release
`manhattan-esb-block-exterior-pilot-20260805`
(`release.json` SHA-256 `4a84ddbb5b46dcc5ad84fc618922cc2c2225f9a86ee0373e9f3cec4246d1b38a`).
No pinned byte was modified, no external source was contacted, and no file
under `src/runtime/` was touched — runtime integration is T008.

## Pipeline

All five stages are pure functions of the pinned release plus the committed
Blender measurement, driven by
[`scripts/block835-reference-plan-cli.mjs`](../../scripts/block835-reference-plan-cli.mjs).

| Command | Output |
| --- | --- |
| `plans` | 14 canonical facade plans + plan index under `data/manhattan-esb-block-reference-20260810/plans/` |
| `authoring` | Per-building Blender inputs (plan path, ENU frame, tessellation constants) |
| `measurements` | Promotes Blender silhouette evidence to the committed build input |
| `build` | Manifest, ownership ledger, registration report and `private/` content |
| `registration` / `determinism` | The two release gates |

### Facade plans

Each building's WGS84 footprint is projected to a local ENU metre frame anchored
at its pilot centroid, reduced to its minimum-area oriented bounding rectangle
by monotone-chain hull plus rotating calipers, and quantised to local
millimetres. Storey height is chosen so `floorCount × floorHeightMm` equals the
sourced height exactly rather than rounding up to a nominal storey, which keeps
the shipped roof plane inside the vertical registration tolerance.

Every plan carries all fifteen `REQUIRED_EXTERIOR_COMPONENT_KINDS`, ten
`generated` and five `absent` (`setbacks`, `balconies`, `fire-escapes`,
`water-tanks`, `signage`), and the verbatim
`DETERMINISTIC_FACADE_UNCERTAINTY` statement. No component anywhere in the
package is `evidence-backed`; see ADR 0023 Decision 2.

### Canonical GLB writer

[`src/release/canonical-glb.ts`](../../src/release/canonical-glb.ts) emits the
closed profile directly: `asset` carries only `version`, nothing has a `name`,
there are no extensions, images, textures or samplers, indices are `TRIANGLES`
with `UNSIGNED_INT`, one bufferView per accessor laid out contiguously from
offset zero, and `buffers[0].byteLength` equals the covered extent rounded up to
four. Accessor `min`/`max` are rounded through `Math.fround` so the declared
bounds equal the stored float32 values exactly.

Surfaces are tessellated by decomposing each surface into v-bands at every
placement boundary, emitting wall quads in the gaps, then emitting each opening
once as an inner face plus four reveal quads. A signed depth flips the reveal
windings together: positive recesses windows, entrances and storefronts by the
plan's 200 mm opening inset; negative extrudes the rooftop appurtenance.
Cornices are flush trim bands, so they make no silhouette claim.

`lod_0` is the full detail set. `lod_1` keeps the massing envelope and the
rooftop appurtenance and drops all facade detail, which is why its measured
silhouette deviation is exactly zero.

### Package

`audience: "private"`, one cell `cell:manhattan:block-835` owning all 14
buildings, one tileset artifact plus 28 GLBs, 2,603,565 bytes total, assembly
fingerprint `f76e07eea092d6d246d1a74481b5bed2c8cbe945170a09ee5fdac5d230cddd17`.

The base identity checksum uses the exact ownership rule at
`src/release/exterior-release.ts` —
`sha256HexSync(stableSerialize([...buildingIds].sort()))` — giving
`98a7c50abc157fb4f2e52f23e2a129274b7273cace496929406bbbff448a8dfa`; a focused
test asserts membership equals the 14 `BLOCK_835_DOITT_IDS`. The ownership
ledger is committed alongside the package and pinned at
`b32928adc65288903f6f7a55bcd9a24e3f3f2f4ee305ec404c93ad3fa86ad236`. Each asset
pins its pilot LOD0 predecessor by that release's immutable checksum.

## Per-asset results

Horizontal deviation is the worst corner offset of the exported massing from the
source-derived oriented rectangle; vertical is roof plane against sourced
`heightMeters`. Tolerances are 250 mm and 500 mm.

| Building | LOD0 tris | LOD1 tris | Materials | Source height (m) | Exported roof (m) | Δ horiz (mm) | Δ vert (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `doitt:102705` | 558 | 28 | 6 | 14.79 | 14.79 | 0.31 | 2.2 |
| `doitt:131170` | 10938 | 28 | 6 | 99.22 | 99.23 | 0.45 | 10.5 |
| `doitt:147902` | 1382 | 28 | 6 | 22.82 | 22.82 | 0.60 | 0.7 |
| `doitt:262867` | 238 | 28 | 6 | 8.17 | 8.17 | 0.22 | 0.3 |
| `doitt:39969` | 1038 | 28 | 6 | 23.50 | 23.50 | 0.91 | 2.0 |
| `doitt:460555` | 878 | 28 | 6 | 21.89 | 21.89 | 0.53 | 3.3 |
| `doitt:498980` | 514 | 28 | 6 | 17.61 | 17.61 | 0.13 | 0.2 |
| `doitt:502491` | 514 | 28 | 6 | 19.37 | 19.37 | 0.69 | 0.0 |
| `doitt:584049` | 1130 | 28 | 6 | 23.34 | 23.34 | 0.54 | 1.6 |
| `doitt:778052` | 41738 | 28 | 6 | 377.58 | 377.58 | 0.28 | 3.3 |
| `doitt:812702` | 514 | 28 | 6 | 16.86 | 16.86 | 0.22 | 0.4 |
| `doitt:835659` | 626 | 28 | 6 | 23.13 | 23.14 | 0.57 | 1.7 |
| `doitt:925937` | 514 | 28 | 6 | 16.26 | 16.26 | 0.42 | 1.1 |
| `doitt:982383` | 8038 | 28 | 6 | 115.69 | 115.68 | 0.50 | 13.1 |

Worst case: 0.91 mm horizontal, 13.1 mm vertical. Budgets are 75,000 triangles,
8 materials and 0 textures per asset; the largest asset uses 41,738 triangles
and every asset uses 6 materials at `lod_0` and 4 at `lod_1`.

## Blender authoring and evidence

Blender MCP built a disposable metric Z-up ENU scene from the committed plans,
one `execute_blender_code` call per building with an object or scene checkpoint
after each. Nothing was downloaded; Polyhaven, Sketchfab, Hyper3D and Hunyuan
were not used.
[`scripts/blender/block835_reference_author.py`](../../scripts/blender/block835_reference_author.py)
is an independent Python port of the plan tessellation rules, so its agreement
with the TypeScript writer is a genuine cross-check.

**Watertightness.** For each of the 28 meshes the divergence-theorem volume was
compared against the analytic solid volume (box, minus every recess, plus the
appurtenance). All 28 agree to a relative deviation below 1e-7, which no mesh
with a hole can achieve, and all have consistently outward normals and zero
degenerate faces. The tessellation intentionally leaves T-junctions where a
subdivided surface meets an unsubdivided neighbour, so the raw boundary-edge
count is non-zero; the volume identity is the closure proof, not the edge count.

**This check found a real defect.** The first run reported a 3.8 % volume error
at `lod_0` and a mesh whose recessed volume was *larger* than its coarse LOD.
The cause was an inside-out winding on the top reveal quad of every recessed
opening — structurally valid indexed geometry that the glTF profile check
cannot detect. It was fixed in both the TypeScript and Python tessellators and
the package was rebuilt.

**Silhouette.** `lod_1` deviation was measured, not asserted: 512×512
orthographic Workbench renders from four fixed compass views per building, alpha
thresholded at 0.5, ratio = symmetric-difference pixels over `lod_0` covered
pixels. All 14 buildings measured exactly 0.0 across all four views, against
covered areas of 36,150–146,238 pixels, so the zero is a real match rather than
an empty render. The measured value is bound to each plan hash in the committed
measurement file, and the builder refuses to run if a measurement's plan hash
does not match the plan it is building.

**Re-import diff.** All 28 shipped GLBs were imported back into Blender and
compared with the authored meshes: 138,024 vertices total, identical vertex
counts, identical unique-position sets, zero positions present in only one side,
and 0.0 m bounds deviation for every asset.

**Visual validation.** The 14 buildings were laid out using the shipped
tileset's per-building transforms and inspected in the viewport. Recessed window
grids, per-orientation facade materials, flush cornice bands, roof planes and
rooftop appurtenances all read correctly at street level and in overview.

### Evidence inventory

Worktree-local and untracked, under
`artifacts/blender/manhattan-esb-block-reference-20260810/`:

| File | SHA-256 |
| --- | --- |
| `scene-inspection.json` | `7f9ccc88efa8fdc2e6b9ba6d1dbd38d5917d952bda5ddfe3ee46d42461ba612a` |
| `silhouette-measurement.json` | `ca97575616387f9a6c8b417106e67d4829b36e0eca9d44c8e83099793c994621` |
| `reimport-diff.json` | `dc824d4c4fbb6f6d135a36d6186304acb9192c079ddad366a5b3a3a68a5b1098` |
| `evidence-inventory.json` | `f5642fd2b029a79ca02a0dbf8e35e91f0d3e666e4331ffbfcb8d10625938d019` |
| `block835-reference-authoring.blend` | `85741b45fdbdf9997f5d266c811c429519000544066d4a084060c0636b4f4667` |

Plus `renders/` (112 silhouette PNGs and 2 viewport screenshots) and `inputs/`
(15 authoring input files). `evidence-inventory.json` hashes all 133 files.

## Verification

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | Pass for all changed files; 3 pre-existing failures unrelated to this task (see risks) |
| `pnpm lint` | Pass |
| Focused tests (7 files, 66 tests) | Pass |
| `pnpm multi-lod:validate -- --manifest … --require-texture-free` | Pass, 29 artifacts, texture-free enforced |
| Registration gate | Pass, 0.91 mm / 13.1 mm worst |
| Double-run byte determinism | Pass, 32 files byte-identical, identical fingerprint |
| Blender watertightness | Pass, 28/28 below 1e-7 relative |
| Blender re-import diff | Pass, 28/28 exact, 0 mismatches |

## What this package does not claim

It does not show what these buildings look like. The massing is an oriented
bounding rectangle of the source footprint, the facade grammar is procedural,
the palette is arbitrary, and no tenant, brand, text or signage is asserted
anywhere. Passing every gate above proves pipeline determinism, geometric
closure and contract conformance — not architectural, material or visual
accuracy.
