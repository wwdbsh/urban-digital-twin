# 0029 — Midtown-core wave materialization and bounded availability

- Status: Accepted
- Date: 2026-08-11
- Related: 0019 (provider-neutral exterior contracts), 0021 (multi-LOD assembly
  packages), 0023 (exterior streaming dual profiles), 0024 (exterior wave
  ledger), 0025 (full-snapshot deterministic dry run), 0027 (Block 835
  generative exterior canary), 0028 (Block 835 exterior default activation)

## Context

ADR 0024 partitioned the whole 45,194-building Manhattan base into 883 ownership
cells across a wave plan, and ADR 0025 proved every one of those buildings can be
planned deterministically without materializing anything. ADR 0027 then shipped
exactly one cell — 14 Block 835 buildings — as real bytes, and ADR 0028 made it
the default.

The gap between "883 cells are planned" and "1 cell is shipped" is where every
remaining risk lives. T013 closes the first part of it: wave `w01`
(`midtown-core`), 149 cells and 7,201 buildings, becomes a real release
`manhattan-midtown-core-cells-20260811` whose bytes a browser can verify.

Four constraints shaped the result, and none of them were negotiable:

- The release-graph contract requires a release's ownership ledger to enumerate
  **exactly** the buildings that release owns, with contiguous cell orders.
- The exterior runtime retains at most 256 cache entries (`EXTERIOR_RUNTIME_BUDGETS`),
  and the App loads every cell the active snapshot maps, in parallel.
- Nothing may be asserted that was not measured, generated, or sourced.
- No pinned release byte, and no default-session behaviour, may change.

## Decision 1 — A wave ships as a derived-subset ledger, validated by the release-graph validator only

`src/release/midtown-core-package.ts` re-derives an ownership ledger that owns
only the 149 `w01` cells: stable parent cell ids are preserved verbatim so the
committed `membership-digest.json` still reconciles, orders are renumbered
contiguously `0..148`, coverage is recomputed as the exact union rectangle, and a
new `baseIdentitySet` is derived over exactly the 7,201 owned ids.

The subset is validated by `validateExteriorReleaseGraph`, **not** by
`validateExteriorWaveLedger`. That is a scoping decision, not an exemption. The
wave validator additionally requires that a cell id's embedded sequence equals
its `order`, and that exactly one wave-0 (Block 835) cell is present. Both are
properties of the *parent* full-city partition:

- renumbering to `0..148` is mandated by the release-graph contract, so the
  embedded-sequence rule cannot hold for a subset by construction;
- the Block 835 cell is excluded by design, and the derivation record proves
  `w00 ∩ w01 = {}` (0 shared buildings) rather than assuming it.

Preserving parent cell ids while renumbering orders is what lets the full-city
ledger and the subset ledger both stay true at once. Parent provenance cannot
live inside the ledger — the release-graph schema is closed — so it is emitted
beside it as a `MidtownCoreDerivationRecord`, committed at
`data/midtown-core-20260811/derivation.json`.

Rejected: relaxing either wave-validator rule so the subset could pass it. That
would weaken a validator to fit an artifact, which is exactly backwards.

## Decision 2 — Availability is bounded, stated, and not a failure

The release **owns** all 149 cells and all 7,201 buildings, and materializes
exterior geometry for the first 3 cells in priority order — 160 buildings. Every
other owned building ships as an explicit `unavailable` detail carrying a stated
reason and a tombstone id, so the cell map stays complete and closed.

Why 3 cells and not more: with one shipped LOD per building, 160 buildings
occupy 160 of the runtime's 256 cache entries. The next cell (order 3, 114
buildings) would take the working set to 274 and start evicting verified bytes
mid-session. The boundary is the measured cache ceiling, not a guess.

The runtime consequence is a new outcome in `exterior-cell-runtime.ts`:

```
if (cellRelease.buildingDetails.length > 0
    && cellRelease.buildingDetails.every((detail) => detail.status === "unavailable")) {
  return { kind: "not-shipped", ... };
}
```

It is decided **before any fetch**: zero requests, zero cache entries, no
fallback selected, and `notShippedCellCount` reported separately from
`failedCellCount`. Treating an empty render as a verification failure would
assert a failure that never happened; treating it as `base-massing` would claim a
fallback was chosen when none was. `not-shipped` is the only honest third state.

`exteriorStreamingNotices` correspondingly summarises the unshipped cells in one
truthful line ("146 of 149 exterior cells ship no exterior geometry in this
release; no substitute was selected for them") instead of 146 identical alarming
rows. Every genuine failure keeps its own per-cell line — the runtime regression
test drives one materialized cell into `base-massing` with `request-failed` while
a neighbouring owned cell still resolves `not-shipped` in the same session.

**Breadth is a deferred follow-up, not something this ADR absorbs.** Shipping the
remaining 146 cells needs the ADR 0024 wave scheduling work — visibility-driven
cell admission and eviction, so the working set is bounded by what the camera can
see rather than by what the snapshot maps. Until that exists, a wider wave would
thrash the cache rather than render more city. That prerequisite is named here so
it cannot be mistaken for something T013 delivered.

## Decision 3 — One shipped LOD, because the second one has no measurement

`validateMultiLodAssembly` requires every LOD after the finest to carry an
`authoring-declared` projected-silhouette measurement bound to the asset's plan
hash. Those measurements exist for the fourteen Block 835 buildings because they
were produced in Blender, one building at a time (ADR 0026).

There is no measurement for 160 buildings. Declaring `deviationRatio: 0` for them
would fabricate evidence of a comparison nobody performed, so this canary ships
`lod_0` only, with `maxDistanceMeters: null` so no camera distance can leave an
asset without an eligible representation.

Two consequences are worth stating plainly:

- Both LODs are still generated and budget-checked for all 7,200 planned
  buildings in the CLI census (14,400 canonical GLBs, 0.897 GiB, maximum 60,812
  of 75,000 triangles). Only *shipping* the coarse LOD is deferred.
- With one shipped LOD, the exploration and inspection profiles select the same
  artifact, so toggling the profile costs nothing. That is not an argument that
  the second LOD is free: shipping it would make 320 distinct cache keys for 160
  buildings, and a profile toggle would then exceed the 256-entry ceiling and
  thrash. Batch silhouette measurement and cache-aware LOD admission have to land
  together, not separately.

## Decision 4 — A footprint the grammar cannot describe is refused, never invented

The V2 rooftop guard requires a crown wider than `2 × tankRadius + 2,000 mm`.
`midtownCoreV2Parameters` adds two clamps that keep that satisfiable on small
footprints; both are provably non-binding above roughly a 2.2 m minimum footprint
dimension, which the test suite proves by reproducing all fourteen pinned Block
835 parameter sets exactly.

Measured over the wave: without the clamps 8 of 7,201 buildings fail the guard;
with them, 7 recover. The eighth, `doitt:1273172`, has a 1.108 m minimum
dimension and a 1,106 mm crown. No parameter choice clears the guard, so it is
refused with a deterministic stop code (`footprint-below-grammar-minimum`) and
ships as an `unavailable` detail whose reason names the refusal. It is the only
refusal in the wave.

## Decision 5 — The payload is untracked; the checksum inventory is committed

The emitted payload is 635 files and 29.1 MB. Following the citywide precedent,
it lives under the already-ignored `public/data/` and is not committed;
`data/midtown-core-20260811/payload-inventory.json` commits the path, byte size,
and SHA-256 of every emitted file, plus both root checksums and the assembly
fingerprint. `node scripts/midtown-core-cli.mjs graph --force` rebuilds it
byte-identically.

The caveat this creates is real and is handled explicitly rather than papered
over: **a fresh clone has no payload**, so the byte-level gates in
`midtown-core-release.test.ts` and `midtown-core-runtime.test.ts` have nothing to
compare against. Those suites do not silently pass. Each states, as an assertion,
why it is skipped and how to rebuild the bytes, and the deterministic in-memory
build gates run either way. Byte equality covers 100 % of the emitted manifests,
graph, index and artifact blobs plus a fixed-stride sample of the shipped GLBs.

## Decision 6 — The evidence fabric is templated, and the approval is asserted once

Each of the 160 available buildings carries one inventory shard and one evidence
shard, whose ids are baked into the shipped GLB's `extras`. Each evidence graph
carries exactly one source record — the citywide release's own
`sourceRefIds[0]`, which is also the V2 plan's constraint source id, so the
inventory and the evidence graph cite one identity — plus shared license and
approval bodies. `evidence: []` is explicit: every component ships at the
`generated` tier, so there is no claim evidence to cite.

The approval fingerprint is derived once from the exported scope, exclusions,
timestamp and note, and the release test asserts it is identical in all 160
shards. A drifting copy would mean two envelopes inside one release.

Anti-leak is unchanged from ADR 0027: the private root declares exactly one
artifact — its own audience-scoped ownership-ledger blob — and no private byte is
written to disk. The audience is part of each blob's hashed body, so the private
and public ledger blobs share one logical id and can never collide on checksum.

## Decision 7 — The pipeline is resumable and re-runs its own census

`scripts/midtown-core-cli.mjs` runs four stages (`plans`, `glbs`, `gates`,
`graph`), each writing a receipt fingerprinted over the pinned base manifest
checksum, the parent ledger checksum, the derived ledger id, and the stage's own
parameters. An unchanged fingerprint makes a stage a no-op unless `--force` is
given, so an interrupted 75-second asset census resumes instead of restarting.

The census is not a separate estimate from what ships: the same
`materializeMidtownCoreCells` function produces the censused wave and the shipped
subset, and the `graph` stage replays the emitted bytes through
`replayExteriorArtifactIntegrity` and `replayMultiLodAssembly` rather than
trusting the in-memory objects it just built.

## Consequences

- A second real wave exists, opt-in by `?exteriorCells=manhattan-midtown-core-cells-20260811`.
  `EXTERIOR_DEFAULT_ACTIVATION` and every previously pinned release are byte-untouched,
  and a default session issues no request into the new release root.
- `not-shipped` is now part of the exterior runtime's outcome vocabulary and must
  be handled by any future consumer of `ExteriorCellOutcome`.
- Widening the wave is blocked on ADR 0024 scheduling and on batch silhouette
  measurement. Neither is delivered here.
- The release graph is 7.5 MB because 7,041 tombstones each carry a stated
  reason. Measured cost: ~5 ms to parse and ~26 ms to revalidate; over a local
  origin it transfers as 303 KB gzipped in 83 ms. Truthfulness per tombstone was
  kept over byte count, on evidence rather than assumption.
