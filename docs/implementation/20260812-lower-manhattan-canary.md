# Lower-Manhattan textured canary (T015)

Durable implementation record for
`manhattan-lower-manhattan-cells-20260812`, wave `w02` of the
provider-neutral Manhattan exterior configuration and the first textured
exterior release. See ADR 0034 for the decisions; this file is what was built,
what it measured, and how to reproduce it.

## What shipped

| fact | value |
| --- | --- |
| release id | `manhattan-lower-manhattan-cells-20260812` |
| wave | `w02` / `lower-manhattan`, ledger `manhattan-exterior-wave-ledger-20260804` |
| owned | 126 cells, 6,425 canonical buildings |
| renderable | 2 cells, 62 owned buildings, 41 materialized assets |
| tombstoned | 124 cells |
| textures | `procedural-texture-v1`, LOD 0 only, `LINEAR` / `LINEAR_MIPMAP_LINEAR` |
| admission | `procedural-replay` on both emitted roots |
| predecessor | `manhattan-midtown-core-cells-20260811-v3` (root + snapshot pins) |
| promoted | **no** — pinned for explicit `?exteriorCells=` opt-in only |

## Reproducing it

```sh
pnpm install --frozen-lockfile

# Stage 1 — kill switch. Build both variants of the heaviest renderable cell.
pnpm lower-manhattan:pipeline probe

# Serve the probe and capture it in the shipping renderer.
VITE_T028_SAMPLER_PROBE=1 VITE_SAMPLER_PROBE_DIRECTORY=lower-manhattan-20260812-probe pnpm build
VITE_T028_SAMPLER_PROBE=1 VITE_SAMPLER_PROBE_DIRECTORY=lower-manhattan-20260812-probe pnpm preview --port 4173
# Chrome, headful, with precise memory info:
#   --remote-debugging-port=9222 --enable-precise-memory-info
pnpm lower-manhattan:probe-capture --preview http://localhost:4173 --port 9222

# Stages 2-5, only once the kill switch has passed.
pnpm lower-manhattan:pipeline plans
pnpm lower-manhattan:pipeline glbs
pnpm lower-manhattan:pipeline gates
pnpm lower-manhattan:pipeline graph
pnpm lower-manhattan:pipeline sample
```

Then the Blender pass, through Blender MCP, running
`scripts/blender/lower_manhattan_sample.py`.

Every stage writes a receipt fingerprinting its inputs, so an interrupted run
resumes. `--force` re-runs one regardless.

## Kill-switch measurement (stage 1)

The heaviest cell of the renderable subset —
`manhattan-exterior-cell-w02-000151-15-9646-8976`, 52 owned, 33 materialized — in
two variants differing only in whether LOD 0 carries tiles. Three fixed stations,
identical cameras, 240 timed frames after a 120-frame settle.

| station | p50 ratio | p95 ratio | heap delta |
| --- | --- | --- | --- |
| facade-detail (60 m) | 0.99 | 1.03 | +6.0 MB |
| street-approach (190 m) | 1.00 | 1.01 | +4.2 MB |
| far-silhouette (640 m) | 1.00 | 1.01 | +4.2 MB |

Worst observed frame either variant: 10.6 ms, against a 16.7 ms 60 Hz budget.
Shipped bytes for the cell: 1.72 MB untextured, 4.04 MB textured (2.36x).

Verdict `proceed-textured`, recorded in
`data/lower-manhattan-20260812/kill-switch-verdict.json`, which cites
`kill-switch-evidence.json` by checksum.

**A measurement error is recorded there deliberately.** The first run reused one
Chrome tab across six navigations; the post-collection heap still climbed about
10 MB per load, and a variant-major capture order rendered that accumulation as
roughly 35 MB of apparent texture cost. Each capture now opens a fresh page
target and reads its heap after a forced collection, and the capture order is
station-major as a second guard. The corrected delta is 4–6 MB.

## Refusal census (stage 2)

All 6,425 owned buildings through the V3 grammar over their real sourced rings.
6,425 resolved, 6,291 materialized, **134 refused (2.09%)**.

| stop code | count |
| --- | --- |
| `source-height-below-grammar-minimum` | 61 |
| `ring-vertex-count-unsupported` | 33 |
| `ring-area-below-floor` | 25 |
| `ring-neck-below-grammar-minimum` | 7 |
| `volume-identity-failed` | 7 |
| `ring-not-simple` | 1 |

2,545 materialized buildings ship `setbacks` **absent** with a stated reason. The
census generated 12,582 GLBs totalling 0.737 GB, all measured, none retained.

The renderable subset's own rate is far higher — 21 of 62, 34%, almost all
`source-height-below-grammar-minimum` — because the two highest-priority cells
are low-rise harbour structures. No tolerance was adjusted to improve either
figure.

Committed at `data/lower-manhattan-20260812/wave-census.json`.

## Renderable-subset derivation (stage 3)

```
maxCacheEntries        256   (EXTERIOR_RUNTIME_BUDGETS)
- block835 V3           28   (counted from the committed payload)
- midtown-core V3      156   (counted from the committed inventory)
= entry budget          72
```

Cells admitted whole, in priority order, while the subset still fits: 62 owned,
10 entries spare. 41 assets actually materialize, so 31 entries are spare in
practice. Sized to coexist with both promoted waves so promotion needs no re-cut.

## Blender re-import (stage 5)

All 41 shipped assets, opened read-only.

| check | result |
| --- | --- |
| triangle delta, declared vs measured | 0 |
| material mismatches | 0 |
| bounds deviation (Y-up) | 0.0 m |
| Z-up control hypothesis | 4.854 m — the diff discriminates |
| worst volume deviation | 7.9e-7 against a 1e-6 tolerance |
| not-solid meshes | 0 |
| embedded images | 122 across 41 assets |
| image-count mismatches | 0 |
| **unreachable textures** | **0** |
| minimum UV layers | 1 |

The last two are new for this wave and are the checks a checksum cannot make: an
asset can embed a valid PNG, declare it, pass every byte gate and still render
flat if nothing samples it. The pass walks each imported material's node tree and
requires a UV layer, an image-bound material, and every embedded image
referenced.

Report at `artifacts/lower-manhattan-20260812/blender/inspection.json`, pinned by
`data/lower-manhattan-20260812/evidence-inventory.json`.

## Committed records

`data/lower-manhattan-20260812/` — additions only, no frozen record edited.

| file | what it keeps checkable |
| --- | --- |
| `derivation.json` | the subset derivation and its digest reconciliation |
| `payload-inventory.json` | every emitted byte of the untracked payload |
| `wave-census.json` | the full-wave stop-code census and texture pins |
| `kill-switch-evidence.json` | the six captures, their stills' checksums, the comparison |
| `kill-switch-verdict.json` | the decision, citing the evidence by checksum |
| `evidence-inventory.json` | the gitignored work root |
| `probe-evidence-inventory.json` | the gitignored kill-switch scratch root |

Payloads stay ignored: `public/data/` by the existing rule,
`artifacts/lower-manhattan-20260812{,-probe}/` by new ones.

## Verification gaps, stated

- **`verifyPromotedExteriorPin` does not run for this release.** It reads the
  promotion record; a non-promoted pin has no entry there. Verification rests on
  release-graph validation, artifact-integrity replay, assembly replay under this
  release's own admission, and the committed checksum inventory. That is
  narrower than a promoted wave's guarantee. Closing it is promotion's work, and
  the promotion machinery was deliberately not modified here.
- **Drift tests never skip.** Both new suites read committed records only, so
  they run on a fresh clone with no payload directory present. A test that
  disappears when the payload does is not a drift test.
- **The wave ledger's "visual priority" is south-to-north tile order.** For this
  wave that puts harbour and Governors Island low-rise ahead of the Financial
  District. The ordering was followed rather than overridden; see ADR 0034.
- **One pre-existing test flake.** `App.test.tsx > closes details with Escape and
  returns focus to the located-pick trigger` fails under full-suite parallelism
  and passes in isolation. Verified against the pre-task baseline commit
  `540811e`, where it fails identically. Not introduced here and not fixed here.
