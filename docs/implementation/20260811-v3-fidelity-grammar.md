# 2026-08-11 — V3 footprint-faithful facade grammar (T025, Issue #43)

Decision record: `docs/decisions/0031-v3-footprint-faithful-facade-grammar.md`.

Landed in five commits, one per phase. **Phases P6 and P7's package work are not
done**; see "Not done" below. No release tree, no committed package and
`src/runtime/exterior-default-activation.ts` were touched.

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

Defects 5–7 were found by the volume identity alone. Every other gate — types,
lint, 806 tests, the plan hash round-trip — passed while they were present.

## Not done

- **P6 in full.** No V3 successor package, no census gates, no double-run replay,
  no committed inventory, no predecessor pins.
- **The Blender re-proof, the re-import diff and the renders.** Blender MCP
  dropped its connection mid-phase and did not recover. Per `AGENTS.md` the
  affected 3D task stops rather than being replaced by other automation.
- **The measured frame-time re-check** at the raised triangle count. Until it is
  run, `V3_QUALITY_BUDGETS` is a declared constant that gates nothing shipped.
