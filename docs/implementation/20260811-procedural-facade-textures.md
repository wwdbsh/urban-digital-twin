# T027 — Procedural facade detail tiles (Block 835 V3T)

Implementation record for ADR 0032. Task T027, Issue #45, branch
`ccp/45-procedural-textures`.

## What shipped

A new PRIVATE package `manhattan-esb-block-reference-20260811-v3t`: the V3
footprint-faithful geometry, unchanged vertex for vertex, with procedurally
rasterized grayscale detail tiles on LOD 0. LOD 1 stays texture-free.

| surface | file |
| --- | --- |
| rasterizer, PNG encoder, catalogue, provenance | `src/release/procedural-texture.ts` |
| optional texture path in the canonical writer | `src/release/canonical-glb.ts` |
| policy layer, procedural validator, replay gate | `src/release/multi-lod-assembly.ts` |
| UV generation, palette, V3T profile | `src/release/block835-v3-package.ts` |
| V3T uncertainty successor | `src/domain/deterministic-facade-generator-v3.ts` |
| operator entrypoint | `scripts/block835-v3t-texture-cli.mjs` |
| Blender re-import and stills | `scripts/blender/block835_v3t_reimport.py` |

## Gate results

All commands run from the worktree root.

| gate | result |
| --- | --- |
| `block835-v3t:tiles` | 4 tiles, 16,580 B each, parameters hash `121fb53e…` |
| `block835-v3t:build` | 14 assets, 29 artifacts, 9,998,469 B, fingerprint `0257164b…` |
| `block835-v3t:census` | 14/14 buildings, every plan hash identical to frozen V3, LOD 0 texture count 3, LOD 1 texture count 0 |
| `block835-v3t:replay` | accepted under the procedural policy; **refused** under `requireTextureFreeAssembly` (14 refusals) |
| `block835-v3t:determinism` | 32 files, byte-identical across two runs, identical fingerprint |
| `pnpm typecheck` | clean |
| `pnpm lint` | clean |
| `pnpm build` | clean; `prune-private-partitions` removed the V3T private partition from the build output, confirming the private boundary |
| `pnpm test` | 866 tests, 856 passing, 10 skipped, **1 pre-existing failure** (see below) |

### Pre-existing test failure

`src/app/App.test.tsx > closes details with Escape and returns focus to the
located-pick trigger` fails intermittently under full-suite load. **It reproduces
at HEAD with this branch stashed**: 3 baseline runs on this machine produced 2
failures. It passes when the file is run alone. The mechanism is a
`waitFor` on a DOM removal with testing-library's default 1 s budget, exercised
while eight vitest workers saturate the CPU.

It is not caused by T027 and was deliberately not fixed here — it is an unrelated
file and an unrelated concern. It did influence one design choice, recorded
honestly in the test file: the V3T package tests assemble a four-building subset
rather than the full block, because adding another 650 ms of avoidable CPU to a
worker pool already at its limit is a bad trade for coverage the subset already
gives. The full fourteen-building gates live in the CLI, and the committed census
they produce is checked by the test suite.

## Blender round (Blender 5.2.0 LTS via MCP)

The independent-reader gate. Blender's own glTF importer read all 28 shipped GLBs.

| check | result |
| --- | --- |
| imported without error | 28/28 |
| UV layer present exactly where expected | 28/28 (LOD 0 yes, LOD 1 no) |
| images bound per LOD 0 asset | 3, each 128×128 |
| images bound per LOD 1 asset | 0 |
| volume identity against the committed plan | worst deviation 2.14e-7, tolerance 1e-6 |
| bounds a solid / outward normals | 28/28 |
| positions differing from the frozen untextured V3 file | **0** |
| up-axis Y-up confirmed | 28/28, worst bounds deviation 0.0 m |
| Z-up control hypothesis | minimum 15.45 m, i.e. the diff discriminates |

The volume identity here is **stronger than the V3 pass ran**: V3 measured a
Blender-authored copy of the plan, while this measures the SHIPPED bytes against
the analytic expectation derived from the committed plan. A texture stage that
perturbed a vertex or dropped a face would surface as a volume deviation.

### Visual verdict on tile size

**64 pixels was tried and refused; 128 is adequate.** At 64, a tile wide enough to
resolve a 10 mm mortar joint holds one brick, so per-unit variation collapsed into
whole-course banding and the wall read as stripes. Orthographic EEVEE stills at
14–20 m facade spans confirm 128 reads as material:

- `doitt:262867` (masonry-warm) — brick red with legible running bond, bronze
  trim, panel reveals on the water tank;
- `doitt:498980` (stone-neutral) — limestone ashlar coursing clearly legible
  against teal glazing and cornice bands;
- `doitt:982383` (curtain-cool) — mullion grid with streaked spandrel bands over
  a limestone ashlar base, i.e. the intended base-to-shaft transition.

All renders are generated geometry with designed appearance and are labelled as
such by the package uncertainty statement.

## Evidence

Raw tree `artifacts/blender/manhattan-esb-block-reference-20260811-v3t/` is
gitignored; the hashed record and the two headline proofs are promoted to
`data/manhattan-esb-block-reference-20260811-v3t/`:

- `texture-catalog.json` — motif parameters, palette, per-tile PNG hashes
- `census.json` — all 14 buildings, byte cost, budgets, plan-hash identity
- `blender-evidence-inventory.json` — 17 files, SHA-256 each (10 renders, 4 tiles)
- `blender-volume-identity.json`, `blender-reimport-up-axis.json`,
  `blender-texture-reimport.json`

`block835-v3t-package.test.ts` holds each promoted record to its own stated gate
and re-derives what it can from live sources rather than from copied numbers.

## Negative tests

| attack | outcome |
| --- | --- |
| untextured writer output | byte-identical to the frozen pre-texture digest |
| texture set no used material references | image dropped; bytes identical to never passing one |
| PNG encoder in a separate process | identical hashes, all four tiles |
| one mutated byte inside an embedded IDAT, all checksums repaired | fails `ASSEMBLY_ISSUE_TEXTURE_REPLAY_MISMATCH` |
| embedded image with `textureProvenance` stripped, **no policy argument** | fails `ASSEMBLY_ISSUE_TEXTURE_PROVENANCE_REQUIRED` |
| private package with an unprovenanced image (previously admitted) | fails `ASSEMBLY_ISSUE_TEXTURE_PROVENANCE_REQUIRED` |
| every motif constant mutated in turn | hash moves for all; pixels move for all but eight named inert-by-construction pairs |
| calibrated palette mutated wholesale | zero rasterized pixels move |
| textured package under the texture-free policy | refused at the manifest AND at the bytes |
| textured package as a public audience | refused unconditionally |
| V1 / V2 / V3 fingerprints | unchanged |

## Byte math

Images 696,360 B; UV + JSON 2,259,172 B; package 7,042,937 → 9,998,469 B (+42.0%).
**UVs are 76% of the added cost, not the images.** Worst single asset is the
Empire State Building at +1,698,076 B on LOD 0.

## Known risks

- UV byte cost scales with vertex count and is the dominant term at citywide
  scale. The fullsnapshot estimator (`exterior-fullsnapshot-plan.ts:113-132`) has
  no term for either images or UVs.
- Per-GLB image embedding does not scale to ~14,000 buildings (~2.7 GB of decoded
  texture memory naively). A shared atlas is the T026 answer.
- The tile darkens its material by 10–18% in the mean; the calibrated palette
  compensates but clamps rather than exceeding the closed `[0,1]` factor range.
