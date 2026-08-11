# Lower-Manhattan curated promotion (T016)

Durable implementation record for `manhattan-lower-manhattan-cells-20260812-p1`,
the release wave `w02` is PROMOTED as, and the third record in
`EXTERIOR_DEFAULT_ACTIVATIONS`. See ADR 0034's promotion section for the
decisions; this file is what was built, what it measured, and how to reproduce
it.

## What shipped

| fact | value |
| --- | --- |
| release id | `manhattan-lower-manhattan-cells-20260812-p1` |
| wave | `w02` / `lower-manhattan`, ledger `manhattan-exterior-wave-ledger-20260804` |
| ownership ledger | `ownership-ledger:manhattan-lower-manhattan-cells-20260812:44ec889a556ece19` (the wave's, unchanged) |
| owned | 126 cells, 6,425 canonical buildings |
| renderable | 2 **curated** cells, 72 owned buildings, 71 materialized assets |
| tombstoned | 124 cells |
| local refusal rate | 1 of 72 = **1.39%** (wave rate 2.09%; canary subset 34%) |
| textures | `procedural-texture-v1`, LOD 0 only, `LINEAR` / `LINEAR_MIPMAP_LINEAR` |
| admission | `procedural-replay` on both emitted roots |
| rights instrument | `LOWER_MANHATTAN_APPROVAL`, **unedited**, fingerprint `ff8da10f…` |
| predecessor | `manhattan-lower-manhattan-cells-20260812` (the T015 canary; root + snapshot + inventory pins) |
| snapshot checksum | `2d22395668709e6bc616eabce132ce4865dd000d85603bfd48d003ca401ef527` |
| cells digest | `3d9d0154fe66183d557247815036a0406619d6470b0c24554792070a64bead5d` |
| assembly package | `assembly:manhattan-lower-manhattan-cells-20260812-p1:v1` |
| promoted | **yes** — third record, `predecessor` is base-only |

## The curated subset

| cell | full-city order | owned | materialized | refused |
| --- | --- | --- | --- | --- |
| `manhattan-exterior-cell-w02-000160-16-19294-17945` | 160 | 32 | 32 | 0 |
| `manhattan-exterior-cell-w02-000157-16-19294-17944` | 157 | 40 | 39 | 1 |

Adjacent cells sharing their full east–west extent, over the World Trade Center
site. Cell 157 owns the wave's tallest sourced structure (429.3 m, 105.0 m taller
than anything else `w02` owns); cell 160 owns the wave's second and third
tallest (324.3 m, 298.2 m). The one refusal is `doitt:602678`,
`ring-vertex-count-unsupported`, shipped as an explicit unavailable detail.

The reason each cell is admitted is written into
`LOWER_MANHATTAN_CURATED_CELLS[].rationale` and copied into the release's own
`payload-inventory.json` under `curation`, so the curation travels with the
bytes rather than living only in an ADR.

## Reproducing it

```sh
pnpm install --frozen-lockfile

# The P1 successor. The canary path is the DEFAULT variant and is untouched;
# `--release p1` selects the curated subset and the successor identity.
pnpm lower-manhattan:pipeline plans --release p1
pnpm lower-manhattan:pipeline glbs  --release p1
pnpm lower-manhattan:pipeline gates --release p1
pnpm lower-manhattan:pipeline graph --release p1
pnpm lower-manhattan:pipeline sample --release p1

# Canary regression: the frozen release, rebuilt through the same refactored CLI.
# `git status data/lower-manhattan-20260812/` must come back clean.
pnpm lower-manhattan:pipeline plans --force
pnpm lower-manhattan:pipeline glbs  --force
pnpm lower-manhattan:pipeline graph --force

# Acceptance measurement, against the ORDINARY production preview.
pnpm build
pnpm preview --port 4174

# Two Chromes. The first is the measurement, UNCAPPED:
#   --remote-debugging-port=9222 --disable-gpu-vsync --disable-frame-rate-limit
#     --enable-precise-memory-info --disable-background-timer-throttling
#     --disable-renderer-backgrounding --disable-backgrounding-occluded-windows
# The second is the control, with NO uncapping flags:
#   --remote-debugging-port=9223 (same throttling flags, nothing else)
pnpm lower-manhattan:acceptance --preview http://localhost:4174 --port 9222 \
  --capped-port 9223 --repeats 3
pnpm lower-manhattan:journeys   --preview http://localhost:4174 --port 9222

# GPU texture arithmetic alone, no browser needed.
pnpm lower-manhattan:acceptance --gpu-arithmetic
```

Blender spot sample: `artifacts/lower-manhattan-20260812-p1/blender/inputs/`
carries one authoring input per sampled building; the twelve re-imported for this
record are listed in `data/lower-manhattan-20260812-p1/blender-spot-sample.json`.

## Committed records

| file | what it pins |
| --- | --- |
| `data/lower-manhattan-20260812-p1/payload-inventory.json` | every emitted byte, the predecessor pins, the occupancy derivation, and the curation record |
| `data/lower-manhattan-20260812-p1/derivation.json` | the subset derivation and its digest reconciliation |
| `data/lower-manhattan-20260812-p1/wave-census.json` | the wave-scale stop-code census and the shipped-subset census |
| `data/lower-manhattan-20260812-p1/acceptance-evidence.json` | the uncapped frame-time, heap, network and residency captures, the capped control, and the GPU arithmetic |
| `data/lower-manhattan-20260812-p1/journey-evidence.json` | the five browser journeys, the DOM text each read, and its checksummed still |
| `data/lower-manhattan-20260812-p1/blender-spot-sample.json` | the twelve independent re-imports |

The payload directory stays untracked, following the citywide precedent; the
inventory keeps every byte checkable after the local tree is removed.

## What was measured

Uncapped Chrome, 3 repeats × 240 timed frames after a 180-frame settle, 1280×800,
on the promoted composition over the pinned citywide base. **Capped control:
p50 8.30 ms** — the 120 Hz present interval, and the floor the T015 canary was
pinned to.

| station | profile | p50 | p95 | worst frame | budget | JS heap after GC |
| --- | --- | --- | --- | --- | --- | --- |
| `fidi-facade` | inspection | 3.6 ms | 9.7 ms | 73.3 ms | 33.3 / 45 | 185.8 MB |
| `fidi-street` | exploration | 3.6 ms | 9.3 ms | 39.7 ms | 16.7 / 25 | 183.6 MB |
| `harbour-skyline` | exploration | 3.3 ms | 9.0 ms | 39.3 ms | 16.7 / 25 | 181.6 MB |
| `midtown-cross` | exploration | 1.5 ms | 3.9 ms | 15.9 ms | 16.7 / 25 | 146.9 MB |

Every p50 and p95 is inside budget. The worst single frames are not, and the
record says so: isolated 39–73 ms frames occur at the Financial District
stations, they are rare enough not to move p95, and they are not attributed here.

- **Cache residency, worst observed: 243 entries, 62.0 MiB** of 256 / 256 MiB.
  Derived from the per-release network measurement (one fetched GLB is one LRU
  entry), not read from the cache counter, which only reaches the DOM in a
  `VITE_BLOCK835_PROBE` build.
- **Network per release, cold default load:** Block 835 V3 14 GLBs, Midtown-core
  V3 144–156 GLBs, P1 71 GLBs, T015 canary **0**, external hosts **0**.
- **GPU texture memory: 17.71 MiB, COMPUTED, not measured.**
  `128 × 128 × 4 × 1.33 × 213 images`, not deduplicated across models. The other
  two promoted waves are texture-free.

## Browser journeys

All five pass; each records the DOM text it read and a checksummed still in
`journey-evidence.json`.

| journey | what it proves |
| --- | --- |
| `cold-default` | a no-param load streams all three waves; 71 P1 GLBs, 0 canary GLBs, 0 external hosts |
| `cross-release-pick` | a picked building names release `…-p1`, cell `…w02-000157…`, its cell release, asset `lod_0 · 6a2c3f99…`, truth tier `generated`, and its uncertainty statement |
| `canary-opt-in` | `?exteriorCells=<canary>` still streams the canary's 41 assets ALONE — 0 P1, 0 Midtown |
| `streaming-off` | `exteriorStreaming=off` fetches **no** exterior GLB from any of the three waves |
| `tombstone-truth` | the release states "124 of 126 exterior cells ship no exterior geometry in this release; no substitute was selected for them" |

Two things are **not** browser journeys, and the evidence file says so rather
than leaving a reader to assume otherwise:

- the per-wave **rollback rehearsal**, because no URL expresses a build-time
  promotion-record swap. It runs through the record's own injection seam in
  `exterior-multiwave-activation.test.ts`;
- single-cell **fault isolation**, because the exterior-cell fault injector is
  gated behind a `VITE_BLOCK835_PROBE=1` build, which is not the production
  preview a user gets.

## Blender spot sample

Twelve shipped LOD 0 assets — the first entry of every geometry stratum of the
deterministic sample, plus a second texture-stratum entry — re-imported into
Blender 5.2.0 LTS through Blender MCP and measured independently of the writer:

- triangle counts match the declared counts on **all 12**;
- material counts match on **all 12**;
- image counts match the declared texture counts on **all 12**, and every one
  carries 3 tiles — no sampled asset shipped untextured;
- worst relative volume deviation between the re-imported signed mesh volume and
  the plan's analytic volume: **5.03e-07**, inside the 1e-06 tolerance the
  materializer gates on.

## Gates

- focused: `lower-manhattan-curation.test.ts` (13),
  `exterior-lower-manhattan-promotion-record.test.ts` (14),
  `exterior-multiwave-activation.test.ts` (21);
- full: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`;
- canary regression: `git status data/lower-manhattan-20260812/` clean after a
  forced rebuild through the refactored CLI.
