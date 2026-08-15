# T003 — Grammar extensions for the recoverable refusals

Date: 2026-08-15
Decision record: [ADR 0048](../decisions/0048-grammar-extension-recovery.md)
Evidence: `data/grammar-extension-20260815/extension-census.json` (+ `.sha256`)

## What shipped

Two conditional extensions inside `src/domain/deterministic-facade-generator-v3.ts`,
following the `styleOverride` additive precedent — no sibling module, no new stop
code, no simplification pass — plus one measured refusal that ships no code.

**Neither extension is active.** Both are reached through `V3GrammarOptions`,
whose defaults are the shipped grammar exactly. See ADR 0048, "What is NOT
decided here".

| constant | file:line | before | after |
| --- | --- | --- | --- |
| `DETERMINISTIC_FACADE_V3_LIMITS.maxRingVertices` | `deterministic-facade-generator-v3.ts:137` | 64 | **64 (unchanged)** |
| `V3_EXTENDED_MAX_RING_VERTICES` | `:801` | — | **384** (new, not a default) |
| `V3_NOMINAL_FLOOR_HEIGHT_MM` | `:809` | 3,600 (inline) | 3,600 (named) |
| `V3_LOW_RISE_HEIGHT_THRESHOLD_MM` | `:835` | — | **3,600** (new) |
| `V3_EXTENDED_GRAMMAR_OPTIONS` | `:879` | — | `{ maxRingVertices: 384, lowRiseFloorHeight: true }` |
| `DETERMINISTIC_FACADE_V3_GENERATOR_VERSION` | `:50` | 3.0.0 | **3.0.0 (deliberately NOT bumped)** |
| `DETERMINISTIC_FACADE_V3_LIMITS.maxAssetTriangles` | `:164` | 200,000 | 200,000 (out of scope) |
| `MIDTOWN_CORE_V3_STOP_CODES` | `midtown-core-v3-materialization.ts:196` | 12 codes | **12 codes (unchanged)** |

Line numbers are post-change.

## The seam

`V3GrammarOptions` threads an optional envelope through five entry points, each
defaulting to the shipped grammar:

- `deriveV3Parameters(geometry, options?)` — the one extension-B conditional
- `validateV3Input(value, options?)` — the ring-vertex admission gate
- `generateV3FacadePlan(value, options?)`
- `validateV3Plan(value, options?)`
- `buildMidtownCoreV3Plan(source, checksum, profile?, grammar?)` and the two
  classifiers

It exists because the differential had to run both states **in one process**, and
a differential that compared them by mutating module state would prove nothing
about the module anybody ships.

`validateV3Plan` needed the envelope for a non-obvious reason found during
implementation: it re-runs the input contract, so a plan legitimately generated
under the wider cap was refused by its own validator. Left unthreaded, all 319
recovered many-vertex buildings would have been mislabelled
`plan-validation-failed` in the census. Pinned both ways by unit test.

## Measurements

Run: `node scripts/grammar-extension-census-cli.mjs run` (Node 24; ~11 min).
Verify: `node scripts/grammar-extension-census-cli.mjs check`.

The CLI plans all 45,194 parents twice and writes both canonical GLBs for every
accepted parent, counting and dropping the bytes. It acquires nothing, publishes
nothing, and writes only under `data/grammar-extension-20260815/`.

### Determinism instrument

Domain-separated SHA-256 over the sorted `buildingId \t planHashSha256` list of
every parent the shipped envelope accepts (44,295 of them):

```
shipped  fd22c08a19fe0a225cd81301fb0e485f6a1851b0b8054a58eab393aa32077667
extended fd22c08a19fe0a225cd81301fb0e485f6a1851b0b8054a58eab393aa32077667
```

Byte-equal; `movedPlanHashCount = 0`. Cardinality equality is not identity and is
not what is asserted — the digest covers each building's own hash. The census was
run twice end to end (once before and once after a correction to the UV metric)
and reproduced both digests and all counts identically.

The same pass re-derives **44,295 materialized / 899 refused**, in exact
agreement with the committed goal reconciliation it never writes to.

### Outcome

| | count |
| --- | --- |
| refused before | 899 |
| **recovered** | **694** |
| still refused | 205 |
| of which reclassified under a different code | 14 |
| stop codes added | **0** |

Per-extension: A recovered 319 of 324; B recovered 375 of 384 (265 of 272 in
[3.0, 3.6) m, 110 of 112 below 3.0 m); C recovered 0 of 114 by design.

Against T001's projection: 694 measured versus 821 implied by its full-city asset
count of 45,116 — **T001's projection was optimistic by 127**. The corrected
full-city ceiling is **44,989** buildings. ADR 0046 carries an append-only forward
note recording this; its byte rows are conservative by 127 buildings and every
verdict survives. Measured incremental payload of the 694: 81.3 MiB at the shipped
single LOD, 119.9 MiB at both LODs — 1.78% and 2.62% of the 4.471 GiB untextured
row.

### Cost of the 694 (texture-free, both LODs)

median 40,028 B / p95 783,348 B / max 3,268,380 B per building; 125,738,128 B
total across 1,388 assets. Worst LOD-0 triangle count 65,260, under a third of
the 200,000 budget, so no recovery refuses under `asset-budget-exceeded`.
Per-building plan wall clock median 5 ms, p95 105 ms, max 584 ms.

Ring predicates timed at the observed maximum n = 362 (`doitt:17224`):
`ringIsSimple` 1.05 ms, `earClipRing` 40.3 ms, `ringLocalThicknessMm` 50.0 ms.

## Blender

Extension A ships no designed massing, so no Blender pass was run for it.
Extension B: eight buildings re-imported through Blender MCP, four per height
band. Wall massing exact on all eight (X/Y extents equal the sourced ring, crown
elevation equals the sourced height). Two pre-existing defects surfaced and are
recorded in ADR 0048 as activation blockers: the designed rooftop cluster scales
with crown clearance and never with building height (rendered silhouette top over
sourced height, across all 694: median 1.38×, p95 2.61×, max 18.7×), and
`buildPrisms` drops a water tank while keeping its legs on **117 of 694**
buildings.

## Guards added

- `deterministic-facade-generator-v3.test.ts` — the disjointness pin
  (`deriveV3Parameters` byte-identical at and above 3,600 mm over the boundary, a
  sweep, and all fourteen real footprints), the "branch does fire at 3,599 mm"
  counter-pin, plan-hash neutrality on four real footprints, single-band massing
  over the sourced ring, cap admission at 65 and refusal at 385, and byte
  identity for a ring inside the old cap.
- `midtown-core-v3-materialization.test.ts` — `MIDTOWN_CORE_V3_STOP_CODES` pinned
  verbatim as twelve codes in order, so a thirteenth fails in the domain suite
  rather than in the goal-acceptance suite.
- `goal-integration-reconciliation.test.mjs` — SHA-256 of all six wave censuses,
  so a future recovery cannot rewrite the 899 it is measured against.
- `grammar-extension-census.test.mjs` — sidecar hashes for both records, the
  CLI's own invariants, the 899 reconciliation, byte-equal digests, no added stop
  codes, recovery recomputed from the per-building rows (not from the record's own
  summary tables) and proved disjoint from reclassification, a gate vector on every
  refusal, extension C carried as a decision with its measured basis, and the
  Blender sample's one-floor/one-tier/crown-at-sourced-height claim.
- `deterministic-facade-generator-v3.test.ts` — a STATIC inertness guard: no
  module outside the generator, its tests and the census CLI may reference
  `V3_EXTENDED_GRAMMAR_OPTIONS` or `V3_EXTENDED_MAX_RING_VERTICES`. One test
  closes all five waves.

## Corrections recorded

1. The task contract's "plan hashes do not embed generator version" is **false**;
   proved by experiment before acting on it. The version is not bumped.
2. The extensions are **not** release-neutral. Activating either by constant edit
   breaks four assertions in `midtown-core-v3-release.test.ts` and would silently
   drift four other frozen wave releases.
3. The contract's expected ~244 / ~140 low-rise split is **272 / 112** when
   measured against the 384 rather than against the whole island.
4. Scope: the contract named three *generating* extensions. C generates nothing,
   by adjudicated design — its contract form was attempt-and-name-the-outcome, so
   refusal is a permitted result, but the deviation is stated rather than inferred.

## Not done

- No wave was re-materialized and no release was emitted. Criterion 1 stays
  NOT-MET.
- The rooftop-scale and orphan-leg defects are recorded, not fixed.
- The choice between R1 (envelope in `V3WaveProfile`) and R2 (envelope at the
  call site) is left to adjudication, as a named T004 hand-off item.
- `serializeV3Plan` still takes no envelope, so a plan generated under the extended
  cap cannot round-trip through it. Deliberately not threaded while the extensions
  are inert (it would be dead code); named in ADR 0048 as an activation task.
