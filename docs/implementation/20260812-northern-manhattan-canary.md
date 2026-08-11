# T021 — Northern-Manhattan exterior canary (wave `w05`, the last wave)

- Date: 2026-08-12
- Task: T021 (Issue #22)
- Decision record: `docs/decisions/0037-northern-manhattan-textured-canary.md`
- Release: `manhattan-northern-manhattan-cells-20260812` (opt-in canary; NOT promoted)
- Predecessor in the wave sequence: `manhattan-central-upper-manhattan-cells-20260812-p1`

## What shipped

| | |
| --- | --- |
| wave | `w05` `northern-manhattan` — 182 cells, 10,230 buildings |
| renderable cells | 1 (`manhattan-exterior-cell-w05-000701-15-9651-8954`, 86 owned) |
| tombstoned cells | 181 |
| shipped assets | 76 textured LOD-0 GLBs, 17,290,972 bytes |
| payload | 416 files, 32,330,732 bytes, untracked under `public/data/` |
| public root | `1bbd97abbc36ae5fffdce7ee27317f3842afb7dfc22dec1bb72775d693d9831a` |
| private root | `310075c076b831a21351ba3a571d8cf24480aea1fe6904b38ebc6c5ad416320c` (1 artifact, 0 emitted) |
| assembly fingerprint | `515b158f9c8e1b43b1d4750bf981aa2abf84334b20d03ea1124b6117daabbbf3` |

## Files by stage

### Wave identity and the shared machinery

- `src/release/northern-manhattan-package.ts` — release id, declared shape, hash
  domains, exclusion set (waves 0–4).
- `src/release/exterior-wave-subset.ts` — added the `northern-manhattan` registry
  row and EXTRACTED `deriveExteriorWaveRenderableCells`, the order-derived walk
  that waves `w02`–`w04` each carry a private copy of. Those copies are unedited.
- `src/release/exterior-wave-subset.test.ts` — hypothetical repointed to the
  construction-fictional `hypothetical-wave-w06`; registry-completeness test
  against the declared plan; northern-manhattan borrow test; walk-equivalence
  suite over all three copies.
- `src/release/northern-manhattan-package.test.ts`

### Release identity, rights instrument, budget

- `src/release/northern-manhattan-release.ts` — approval scope, exclusions
  (byte-equal to the `w04` list), approval note, texture admission, emission
  profiles, predecessor derivation, `northernManhattanReservation`,
  `northernManhattanRenderableEntryBudget`, the 100-entry modest ceiling.
- `src/release/northern-manhattan-release.test.ts`

### Pipeline

- `scripts/northern-manhattan-cli.mjs` — five stages, `RELEASE_VARIANTS` seam,
  `requireFreshReceipt` fail-closed rule, generated census note and generated
  volume-identity statement, writer-stage refusal handling in the sample stage.
- `package.json` — `northern-manhattan:pipeline`, `:journeys`, `:blender-record`.
- `.gitignore` — the two untracked work roots.

### Committed records — `data/northern-manhattan-20260812/`

`payload-inventory.json`, `derivation.json`, `wave-census.json`,
`journey-evidence.json`, `blender-sample.json`.

### Drift and consistency suites

- `src/release/northern-manhattan-census.test.ts`
- `src/release/northern-manhattan-evidence-consistency.test.ts`

### Browser and Blender

- `scripts/northern-manhattan-journeys-cli.mjs`
- `scripts/blender/northern_manhattan_sample.py`
- `scripts/northern-manhattan-blender-record-cli.mjs`

### App

- `src/app/App.tsx`, `src/app/App.test.tsx` — the release id added to
  `PINNED_EXTERIOR_CELL_RELEASE_IDS`, with assertions that it is absent from the
  promotion record.

## Census

Over all 10,230 owned buildings, untextured.

- 9,849 materialized, **381 refused (3.72%)** against a 15% STOP.
- Plan stage 365, asset stage 381; the 16-building difference is entirely
  `volume-identity-failed`.
- Stop codes: `ring-vertex-count-unsupported` 164,
  `source-height-below-grammar-minimum` 164, `ring-area-below-floor` 26,
  `ring-neck-below-grammar-minimum` 10, `ring-not-simple` 1,
  `volume-identity-failed` 16.
- Absent setbacks: **5,880 of 9,849 (59.7%)** — the first wave where they are the
  majority.
- Volume identity: 9,849 checked, 16 rejected, worst accepted deviation
  9.895 × 10⁻⁷ against a 1 × 10⁻⁶ tolerance = **0.9895**, the narrowest yet. No
  tolerance was moved.
- Shipped subset: 86 requested, 76 materialized, **10 refused (11.6%)** — more
  than three times the wave rate, disclosed and asserted as a ratio.

## Canary subset record

    modest ceiling 100 (raised from 80, which admits nothing here)
    cell w05-000701   86 owned  → admitted, total 86
    cell w05-000702   42 owned  → would total 128 → walk stops
    → 1 cell, 86 owned, 76 shipped, 14 spare entries

Occupancy, in the release's own bytes:

    promoted 28 + 156 + 71 + 179 + 40 = 474 of 512   → 38 free
    reservation recorded by T020                      = 36
    surplus (w04's unspent share)                     =  2
    median cell of w05 = 55  → admits neither 36 nor 38
    cells fitting 36: 50 of 182 · cells fitting 38: 54 of 182
    entryBudgetFitsReservation = false (opt-in loads alone)

## Journey evidence

`data/northern-manhattan-20260812/journey-evidence.json`, `allPassed: true`.
Served bundle identified before capture and byte-identical to this tree's `dist/`.
Camera pose derived from the framed cell's committed bounds and asserted inside
them before any capture.

| journey | reading |
| --- | --- |
| `promoted-default-unchanged` | 14/156/71/179/40 promoted GLBs, **0** from this release, no external host |
| `canary-opt-in` | **76** from this release, **0** from every promoted wave, still differs from the promoted default at the identical pose |
| `textured-pick` | `doitt:224542` — badge, cell release, `lod_0 · a01e2b76…`, truth tiers, uncertainty |
| `tombstone-truth` | "181 of 182 exterior cells ship no exterior geometry in this release; no substitute was selected for them" |

## Blender

69 of 76 shipped assets across twelve strata, every one of the cell's 53 tier
collapses included. Blender 5.2.0 LTS, Python 3.13.13, BLENDER_EEVEE.

- 69 textured, 206 embedded images, 0 image-count mismatches, 0 unreachable
  textures, minimum UV layer count 1.
- Triangle delta 0, material mismatches 0, bounds deviation 0.0 m, Z-up control
  6.28 m, not-solid 0.
- Worst volume deviation recomputed from the imported mesh: 1.57 × 10⁻⁷ =
  **0.157 of tolerance** — an independent reading of the wave's narrow margin.

## Pipeline defect found and fixed

The sample stage inherited from the three earlier waves caught grammar stops
around the PLAN call only and invoked the asset WRITER unguarded. Two of this
cell's buildings fail the writer's volume identity, and the stage crashed. Fixed
here: a writer-stage stop excludes the building from the candidate pool and both
ids are counted into the receipt. The earlier pipelines are unedited.

## Gates

`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `git diff --check`, and
every pre-existing drift suite, unmodified and green.
