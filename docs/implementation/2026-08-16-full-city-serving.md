# The full city, served — T005 implementation record

Date: 2026-08-16
Task: T005
Branch: `fcp/87-serving`
Decision record: ADR 0052 (amended here, sections 4–8)

## What exists now that did not before

Every ownership cell the committed island ledger declares has a serving release.
Six `-s1` releases carry 44,989 of the island's 45,194 canonical buildings; the
205 the T004 grammar refused ship as explicit unavailable details with the
deterministic refusal reason the retention census recorded.

| wave | area | cells | shipped | tombstoned | files | payload bytes |
| --- | --- | --- | --- | --- | --- | --- |
| w00 | Block 835 | 1 | 14 | 0 | 27 | 7,945,145 |
| w01 | Midtown core | 149 | 7,179 | 22 | 7,784 | 1,428,801,392 |
| w02 | Lower Manhattan | 126 | 6,382 | 43 | 6,895 | 883,358,732 |
| w03 | Southern remainder | 176 | 9,560 | 43 | 10,273 | 1,083,927,081 |
| w04 | Central and upper | 249 | 11,682 | 39 | 12,687 | 1,322,239,520 |
| w05 | Northern Manhattan | 182 | 10,172 | 58 | 10,909 | 965,577,026 |
| | | **883** | **44,989** | **205** | **48,575** | **5,691,848,896** |

Against the promoted composition's 498 assets across 13 content-bearing cells,
that is roughly 90 times the geometry — but it is not yet what a session loads.
**Nothing here is promoted.** All six releases are reachable by explicit
`?exteriorCells=` opt-in only.

## How it was built

`src/release/exterior-serving-release.ts` is a transform, not a builder. It
regenerates no geometry: the per-cell assembly manifest T004 wrote is re-pinned
to the new release, reduced to `lod_0`, its tileset chain unwrapped to the
innermost tile, and the GLB bytes copied. ADR 0052 §4 records why — the `-c1`
bytes are the ones T004 validated and committed an inventory for, and the island
took nine hours to generate.

What is regenerated is the evidence a retention package never had: inventories,
re-run through `buildMidtownCoreV3Plan` under the same successor profile, then
hashed and compared against what the retained manifest declared. All 44,989
matched, as did every plan id and plan hash.

`scripts/exterior-serving-wave-cli.mjs` drives it: `emit`, `validate`,
`fingerprint`, `boot-cost`, `activation`.

## What is proven, and by what

**Structural and byte acceptance, over the real payload.** Every cell of every
wave through `replayMultiLodAssembly`: every GLB parsed under the shared-texture
gate, all four detail tiles re-rasterized and byte-compared, every tileset walked
against its manifest's LOD chain. 883/883 packages, 44,989/44,989 assets, zero
issues. Recorded per wave in `data/<releaseId>/serving-validation.json`.

**Copy fidelity, without a payload.** `exterior-serving-drift.test.ts` joins the
committed `-s1` and `-c1` inventories on every run and proves every shipped GLB
is byte-identical to a retained one, that only `lod_0` ships, that the detail
tiles are the retained tiles, that shipped + tombstoned equals owned against the
census's own numbers, that the record's pins are the checksums of the files it
declares, and that no `private/` byte reaches the browser-reachable payload.

**The retention packages are untouched.** The full fingerprint — all 91,774
files the six `-c1` inventories declare, re-hashed — ran after every wave and
passed six times. `data/exterior-serving-20260817/retention-fingerprint.json`.

**Boot cost (C5 c).** Derived rather than measured, because the quantity is
three file sizes: 980,000,860 blocking bytes before the seam against 24,068,957
after it island-wide, and 44,989 assets structurally validated before the first
frame against 0. `data/exterior-serving-20260817/boot-cost.json`.

**The frame-time bar (C5 a), pre-registered.** `exterior-serving-frame-bar.ts`
landed in its own commit ahead of any capture, with nine synthetic cases pinning
its arithmetic. The capture itself has not been taken.

## What is NOT done, and what a reader must not conclude

- **No promotion.** No `-s1` release is in `EXTERIOR_DEFAULT_ACTIVATIONS`. An
  ordinary session loads exactly what it loaded before this branch.
- **No budget flip.** `maxResidentUnits` is 128 and `maxCacheEntries` is 512.
  ADR 0052 §8 records the attempt, the cap-8 scheduler baselines it produced,
  and why the ~25 committed assertions it turns over are promotion's work.
- **No session evidence.** The frame-time A/B, the eviction-at-scale roam and
  the D-18 landing-loop reading were not captured; the harness exists
  (`scripts/exterior-serving-evidence-cli.mjs`) and has not been run.
- **No rollback rehearsal**, because there is no promotion to roll back.
- **Passing every gate here is not visual, architectural, geographic or
  performance acceptance.** It is a statement that the bytes are the retained
  bytes, that they validate, and that the release shape is what it claims. The
  per-building uncertainty statement continues to say what the geometry does and
  does not claim about any real facade.

## Where things are

- Transform and release parts: `src/release/exterior-serving-release.ts`
- Wave table, approval, texture admission: `src/release/exterior-serving-waves.ts`
- Emitter and validators: `scripts/exterior-serving-wave-cli.mjs`
- Session-evidence harness (unrun): `scripts/exterior-serving-evidence-cli.mjs`
- Pre-registered frame bar: `src/runtime/exterior-serving-frame-bar.ts`
- Digest-form acceptance: `src/runtime/exterior-default-activation.ts`
- Per-wave records: `data/<releaseId>-s1/`
- Task evidence: `data/exterior-serving-20260817/`
