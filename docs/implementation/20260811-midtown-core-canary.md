# 2026-08-11 — Midtown-core exterior canary (T013, Issue #14)

Implementation record for `manhattan-midtown-core-cells-20260811`, wave `w01`
(`midtown-core`) of the committed exterior wave ledger. Decisions and their
rationale are in ADR 0029; this file records what was built, what was measured,
and what was left open.

## What shipped

| Artifact | Path |
| --- | --- |
| Derived-subset ownership ledger | `src/release/midtown-core-package.ts` |
| V2 plan + canonical GLB materialization | `src/release/midtown-core-materialization.ts` |
| Citywide source adapter and materializer | `src/release/midtown-core-source.ts` |
| Release graph, index, assembly package | `src/release/midtown-core-release.ts` |
| Resumable pipeline | `scripts/midtown-core-cli.mjs` |
| Runtime `not-shipped` outcome | `src/runtime/exterior-cell-runtime.ts` |
| Aggregated tombstone notice | `src/app/App.tsx` (`exteriorStreamingNotices`) |
| Committed payload checksum inventory | `data/midtown-core-20260811/payload-inventory.json` |
| Committed derivation + reconciliation record | `data/midtown-core-20260811/derivation.json` |
| Committed evidence checksum inventory | `data/midtown-core-20260811/evidence-inventory.json` |

The emitted payload (`public/data/manhattan-midtown-core-cells-20260811/`, 635
files, 29,107,107 bytes) and the raw evidence tree
(`artifacts/midtown-core-20260811/`, 55 files, 11,288,469 bytes) are untracked;
both are covered by committed checksum inventories.

## Census — reproduced through the CLI

`node scripts/midtown-core-cli.mjs plans` (50.4 s):

| Measure | Value |
| --- | --- |
| Declared building shards read and checksum-verified | 56 |
| Owned buildings | 7,201 |
| Resolved from the pinned base | 7,201 |
| Planned | 7,200 |
| Refused | 1 (`doitt:1273172`, `footprint-below-grammar-minimum`, 1,106 mm crown) |
| Unique plan hashes | 7,200 (one per planned building) |
| Disclosed fallback heights | 23 |
| Maximum floor count | 131 |

`node scripts/midtown-core-cli.mjs glbs` (76.5 s total, 73.9 s census):

| Measure | Value | Budget |
| --- | --- | --- |
| Materialized buildings | 7,200 | — |
| Generated canonical GLBs | 14,400 | — |
| Generated asset bytes | 963,059,744 (0.897 GiB) | — |
| Maximum triangle count | 60,812 | 75,000 |
| Maximum material count | 7 | 8 |
| Embedded textures | 0 | 0 |
| Shipped assets written | 160 | — |
| Shipped asset bytes | 15,388,572 | — |

`node scripts/midtown-core-cli.mjs gates` (0.4 s): ownership checks pass;
digest reconciliation is 149/149 cells and 7,201/7,201 buildings with 0 missing
and 0 duplicate owners; Block 835 non-divergence is 14 buildings with 0 parameter
mismatches and 0 ENU mismatches; largest cell membership 114 of the 256 cap.

`node scripts/midtown-core-cli.mjs graph` (3.7 s):

| Measure | Value |
| --- | --- |
| Owned cells / renderable / not-shipped | 149 / 3 / 146 |
| Owned buildings / available / unavailable | 7,201 / 160 / 7,041 |
| Emitted files / bytes | 635 / 29,107,107 |
| `release-graph.json` | 7,497,300 bytes |
| `assemblies.json` | 341,781 bytes |
| `index.json` | 674 bytes |
| Artifact blobs (471 public) | 5,826,556 bytes |
| Declared private artifacts / emitted private files | 1 / 0 |
| Public root checksum | `895c156ca1f1133960cda8b7e928741c16a7d3b3d66fa54e1bb6a50b0dcd50da` |
| Private root checksum | `78b43c55c04a5f22d76fa33e04901fdfe27718c1aa62868076f7e6732e471e45` |
| Assembly fingerprint | `2fc756138639ec8d2c067699d68a628ab72143dd2818da8c8cce099c4877e933` |
| Payload inventory checksum | `b63944e13bbfc94088c2b47b5c520e47e41d995124ceab15a561580b5f36427b` |
| Derivation record checksum | `a1509cc267f6bc17609dba71bac74ae18a62b19fedbb8c1247c3bb5a38b8f504` |
| Evidence inventory checksum | `4796b9f08f16b64bfd066ac5138327fd91d7069797ea9676bf262ae50995f175` |

The `graph` stage replays the emitted bytes — not the in-memory objects —
through `replayExteriorArtifactIntegrity` (all 472 declared artifacts, private
ledger blob included) and `replayMultiLodAssembly` (161 artifacts plus the 3D
Tiles tileset). Both passed.

The renderable cells are the first three in ledger priority order:

| Order | Cell | Buildings |
| --- | --- | --- |
| 0 | `manhattan-exterior-cell-w01-000001-14-4823-4482` | 77 |
| 1 | `manhattan-exterior-cell-w01-000002-16-19296-17928` | 22 |
| 2 | `manhattan-exterior-cell-w01-000003-16-19297-17928` | 61 |

## Replay gate

- CLI rebuild → inventory diff: `payload-inventory.json` is regenerated from the
  emitted tree each `graph` run and asserted against the on-disk bytes by
  `midtown-core-release.test.ts` (all 635 files, path, byte size, SHA-256).
- vitest byte equality: 100 % of the emitted manifests, release graph, runtime
  index, tileset and 471 artifact blobs, plus a fixed-stride sample of the
  shipped GLBs (every 20th artifact ref in sorted order, 8 assets).
- Fresh-clone behaviour: the payload is untracked, so both byte-level suites
  assert the explicit skip note rather than passing silently. The deterministic
  in-memory rebuild gate runs regardless and re-checks every emitted file's hash
  against a second full build.

## Runtime verification

`src/runtime/midtown-core-runtime.test.ts` drives the emitted bytes through
`createExteriorCellRuntime`, for both render profiles:

- 3 cells render, 146 resolve `not-shipped`, 0 other outcomes;
- 160 verified assets returned as bytes, all `truthTiers: ["generated"]`;
- exactly 160 artifact requests for the whole 149-cell pass — the unshipped
  cells cost no request and no cache entry;
- `cacheEntries` 160 of 256, 0 evictions, `failedCellCount` 0,
  `fallbackCellCount` 0;
- a fault fetcher on `.glb` drives one materialized cell to `base-massing` with
  code `request-failed` while a neighbouring owned cell still resolves
  `not-shipped` in the same session;
- an empty base identity set drives `base-incompatible` rather than rendering.

`src/app/App.test.tsx` adds migration invariant M1: a session naming no exterior
parameter resolves the promoted Block 835 default and issues zero requests into
`/data/manhattan-midtown-core-cells-20260811/`.

## Renderer journeys

Orca embedded browser against `vite preview` on `http://localhost:4173`.
Full record and screenshots: `artifacts/midtown-core-20260811/journeys/`
(`journeys.json`).

| Journey | Result |
| --- | --- |
| (a) Opt-in canary renders its three materialized cells | pass |
| (a-street) Street-level facade of a Midtown building | pass |
| (b) Picking, details, truth labels on `doitt:1272399` | pass |
| (c) Aggregated tombstone line, no false failure alerts | pass |
| (d) Default session unchanged, zero midtown-core requests | pass |
| (e) Injected `head-checksum` fault stays loud, base intact | pass |
| (f) Bootstrap wall clock and heap | recorded |

Journey (b) cross-check: the details panel's active-asset checksum
`2e72f8f2d3378dac8b0f1f99003b3c7cb460c99c5d23f26a016954eeeca74e58` is
byte-identical to the committed inventory entry for
`public/assets/doitt-1272399__lod_0.glb` (767,684 bytes).

Journey (f) measurements: DOMContentLoaded 100 ms, load 101 ms, `index.json`
requested at 127 ms, `release-graph.json` 83 ms over the wire (303 KB gzipped
from 7,497,300 raw bytes), `assemblies.json` 9 ms (30 KB), last midtown-core
response at 620 ms. Heap sampled ~45 s after load with the citywide base
streamed in: 177 MB used, 236 MB total, 4,192 MB limit. In Node the emitted
graph parses in 5 ms and revalidates in 26 ms.

Journey (e) used the `VITE_BLOCK835_PROBE=1` harness build because the fault seam
is compiled out of production; the production build was rebuilt afterwards. The
seam's `one-glb` fault targets a hard-pinned Block 835 asset path and is a no-op
against this release, so the per-cell isolated-failure case is proven in the
runtime suite rather than in the browser.

## Blender stratified sample

40 of the 160 shipped buildings, selected deterministically and re-imported into
a fresh disposable scene (`udt_t013_midtown_core_sample`) with Blender MCP.

Selection rule — ten strata, four samples each, taken in listed order; a
building already chosen by an earlier stratum is skipped and the next candidate
in that stratum's own total order is taken instead. Every ordering ends in
ascending building id, so the sample is fully determined by the release bytes:

1. `forced-two-bay` — bay count clamped to the minimum 2, smallest minimum
   footprint dimension first
2. `max-bay-count` — bay count at the cap of 8, largest minimum dimension first
3. `sub-three-metre-floor` — derived floor height below 3,000 mm, smallest first
4. `tallest` / 5. `shortest` — by quantized height
6. `largest-footprint-area` / 7. `smallest-footprint-area` — by oriented
   rectangle area
8. `most-axis-aligned` / 9. `least-axis-aligned` — by the oriented rectangle's
   axis sine, nearest 0 and nearest 45°
10. `largest-cell-membership` — from the 77-building cell of order 0, by id

Results (`artifacts/midtown-core-20260811/blender/inspection.json`):

| Measure | Value |
| --- | --- |
| Samples | 40 |
| Maximum triangle-count delta vs the declared assembly quality | 0 |
| Maximum per-axis bound deviation, Y-up, re-import vs shipped accessors | 0.0 m |
| Material-count mismatches | 0 |
| GLB-embedded images / textures | 0 / 0 |
| Imported objects per asset | 1 |
| Total re-imported triangles | 164,204 |

Blender's glTF importer maps Y-up to Z-up as `(x, -z, y)`; the measured Z-up
extent is mapped back to Y-up before comparison, so the diff is like-for-like
against the shipped POSITION accessors. Renders use one fixed view for every
sample — camera direction `(0.78, -0.58, 0.24)` normalised at 2.6× the sample's
own bounding-sphere radius, tracked to its bounding-box centre — so framing
scales with the building and the viewpoint never does. 40 renders are in
`artifacts/midtown-core-20260811/blender/renders/`.

## Gates

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | pass |
| `pnpm lint` | pass |
| `pnpm test` | 71 files, 712 tests, all pass (was 692) |
| `pnpm build` | pass; private partitions pruned as before |
| `git diff --check` | clean |
| Immutability vs `774407c` over `public/data/` and `data/` | additions only |

## Review follow-ups (2026-08-11)

Five nits closed after review; none changed an emitted byte — the payload
inventory is identical before and after (635 files, 29,107,107 B, inventory
checksum `b63944e1…` unchanged).

- **N1** `midtownCoreConveyanceRights` derives `publicDisplay`,
  `derivativeConveyance` and `redistribution` from the registry's own
  `derivativePolicy` clauses and pins the whole policy by fingerprint
  (`3d3e4a80…`) instead of hard-coding them. Four fail-closed paths are tested:
  reverted to the narrow `openDerivative` text, reworded, withdrawn
  (`allowed: "no"`), and the fingerprint pin itself.
- **N3** `buildMidtownCoreSubsetLedger` recomputes the parent ledger checksum and
  throws unless it matches the supplied value, so the Decision-1 inheritance
  argument rests on an attested pairing rather than a caller's word. Both the
  attested and the substituted pairing are tested.
- **N2** Stage fingerprints moved to the shared, testable
  `midtownCoreStageFingerprint` and extended with the V2 schema/generator
  versions, this wave's tool version, seed and generation instant, both parameter
  clamps, and the subset ledger's own checksum in place of its id. A test proves
  a clamp edit changes the fingerprint (and that restoring it restores the
  fingerprint).
- **N4** ADR 0029 Decision 1 now enumerates all eight wave-validator properties
  the scoping forgoes, states which are structurally impossible (embedded
  sequence) versus excluded by design (the Block 835 cell) versus **inherited**
  verbatim from an independently validated parent, and conditions that
  inheritance explicitly on the N3 check.
- **N5** ADR 0029 and this record disclose that with one shipped LOD the
  exploration profile buys no triangle reduction for midtown-core cells this
  cycle.

Because the fingerprint definition changed, all four stage receipts were
invalidated and every stage was re-run from scratch. Counts reproduced exactly
(7,201 / 7,200 / 1 refusal / 23 fallback heights / 14,400 GLBs / 963,059,744 B /
max 60,812 triangles), and `graph` emitted a byte-identical payload with
`removedStaleCount: 0` and unchanged root, assembly and inventory checksums.

## Open items

- Breadth: 146 of 149 owned cells ship no geometry. Widening needs the ADR 0024
  scheduling work (visibility-driven cell admission and eviction). Deferred, not
  absorbed.
- Coarse LOD: generated and budget-checked for all 7,200 planned buildings but
  not shipped, pending batch projected-silhouette measurement. Shipping it
  without cache-aware LOD admission would put 320 keys against a 256-entry
  ceiling.
- `doitt:1273172` remains unrepresentable by the V2 grammar and ships as an
  explicit tombstone carrying the refusal text.
- The `one-glb` fault seam is pinned to a Block 835 asset path and does not
  exercise this release; a wave-agnostic per-asset fault would make the browser
  journey match the runtime test.
