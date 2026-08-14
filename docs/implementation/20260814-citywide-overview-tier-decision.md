# T001 — citywide overview-tier measurement and decision

Task T001 of goal `manhattan-citywide-default-streaming` (Issue #66), branch
`fcp/66-coarse-lod-design`. The decision itself is ADR 0040; this record is what
was built, what it cost, and what did not get done.

## What was added

| path | purpose |
| --- | --- |
| `src/release/citywide-snapshot-gate.ts` | Fail-closed decision logic for the pinned-snapshot availability gate. No I/O, so it is testable against synthetic bytes. |
| `src/release/citywide-snapshot-gate.test.ts` | 11 tests: every stop code, the cascade suppression, the default pin. |
| `scripts/citywide-snapshot-gate.mjs` | The gate's I/O and CLI. `pnpm citywide:snapshot-gate`. |
| `src/release/citywide-overview-census.ts` | Overhang metric, per-cell render-extent derivation, integer histograms. |
| `src/release/citywide-overview-census.test.ts` | 13 tests, including a synthetic 248 m overhang case. |
| `src/release/citywide-overview-tier-candidates.ts` | Coarse-prism geometry, analytic projected-silhouette deviation, cell skyline union, screen-space error, candidate costing. |
| `src/release/citywide-overview-tier-candidates.test.ts` | 22 tests, all exact-value. |
| `scripts/citywide-overview-census-cli.mjs` | The seven-stage resumable census. `pnpm citywide-overview:census <stage>`. |
| `data/citywide-overview-census-20260814/` | Six committed records with checksum sidecars. |
| `docs/decisions/0040-citywide-overview-tier-decision.md` | The decision. |

`package.json` gained two scripts. `.gitignore` gained the census work root.
Nothing else was modified; no existing file's behaviour changed.

## Host observations

Not part of any committed artifact's deterministic body. Apple Silicon, Node with
`--experimental-strip-types`.

| stage | wall clock | peak RSS | what it does |
| --- | --- | --- | --- |
| `gate` | ~1.5 s | — | Snapshot gate plus 56 verified shard reads. |
| `extents` | 1.8 s | — | 883 render extents over 45,194 footprints. |
| `plans` | 225–254 s | 501–661 MiB | 45,194 buildings through the V3 plan stage. |
| `bytes` | ~2 s | — | Six waves' committed records; 28 tracked GLBs stat'd. |
| `coarse` | 227–261 s | 629 MiB | 44,330 coarse prisms written through the real GLB writer and dropped, plus 2 full aggregated cells. |
| `sample` | 308 s | — | Two full island passes for extremum selection and three cell skylines. |
| `decide` | ~8 s | — | Costing; gzips all 56 shards. |
| **total** | **~14 min** | **≤661 MiB** | |

Ranges are across repeated invocations on the same host; the committed records
did not move between them.

The T001 stop condition was a ~3 hour wall clock. The whole census is 14 minutes,
so no partial-plus-projection report was needed.

**`--max-old-space-size=8192` was not needed.** The task brief carried it forward
from earlier full passes; measured peak RSS is 501 MiB. The npm script still
passes it, because leaving a working invocation alone is cheaper than proving a
tighter one is safe on every host, but the record should say the flag is
insurance and not a requirement.

## Decisions taken inside the implementation

**The census reuses the wave CLIs' plan stage rather than reimplementing it.**
`buildMidtownCoreV3Plan` is the same function `scripts/*-cli.mjs` `stagePlans`
calls. That is what makes the exact five-wave refusal reconciliation meaningful:
if the census had its own copy of the grammar, agreement would prove only that
two copies agree.

**One census profile speaks for all six waves, and the reconciliation is the
proof.** A wave profile supplies `generatedAt`, `seed` and `tool`, which reach
the plan hash and the style class but not the geometry. Rather than asserting
profile-independence, the census runs one profile and reconciles against five
waves that each ran their own; exact agreement on all five is the evidence.

**Silhouette deviation is computed analytically, not rasterized.** Both shapes
are unions of axis-aligned rectangles in every horizontal orthographic view, and
`planTiers` guarantees tier containment, so the symmetric difference is exactly
`prismArea - massingArea`. No rasterizer, no sampling error, no tolerance.

**The cell skyline uses a rectangle union, not a sum.** Summing per-building
deviations overstates what a viewer sees by roughly 2x on the midtown sample
(0.0513 median per building against 0.0245 for the cell), because neighbours
occlude each other's setback steps. A sum would have made the coarse collapse
look worse than it is, which is the opposite of a conservative error but is still
a wrong number.

**Coarse-prism bytes are measured through the real writer, not modelled.** An
early structural model was abandoned once it disagreed with the writer at the
third decimal place. `writeCanonicalGlb` was called 44,330 times and the bytes
were counted and dropped.

**Container overhead is measured on two whole cells, not extrapolated from one.**
The largest (119 members) saves 52.8% and the median (48 members) saves 39.7%;
the island projection uses their mean, 46.24%. That spread is disclosed rather
than averaged away silently, because a projection from one cell would have been
a guess with a decimal point.

## Contradictions and corrections recorded

1. **The goal's "44,295 already exist" is census-only retention.** Reconciled
   exactly: 44,281 across w01–w05 plus Block 835's 14. Only 474 promoted asset
   entries are committed.
2. **ADR 0024's overhang magnitude does not reproduce.** Count (9,944), total
   (45,194) and building identity (`doitt:308707`) reproduce exactly; the
   magnitude is 249.3 m against 248.2 m, a 0.44% scale-convention gap. Recorded,
   not resolved. ADR 0024 committed no metric, so there is nothing to reconcile
   to except prose.
3. **`lod_1` is not a coarse tier.** 46% of `lod_0`, 1.49 GB island-wide.
4. **The dense citywide path already renders the shape the goal asks for.** Its
   silhouette is identical to any coarse prism tier, at 30 draw calls and zero
   new bytes.
5. **A coarse prism tier fails the multi-LOD schema's 0.02 silhouette cap for
   51.81% of the island.** Measured, not asserted.

## What was NOT done

- **No rendered A/B still at overview distance.** The visual gate was satisfied
  in its arithmetic form (deviation ratio plus screen-space error plus an
  aggregate skyline check) and *not* in its rendered form. ADR 0040 names this as
  an unmet gate for T002. Nothing in this task looked at a frame.
- **No decoded-GPU measurement inside Cesium.** Not observable from a Node
  census; the figure quoted for candidate (c) is a POSITION-only structural
  floor. Named for T002.
- **No per-request latency measurement.** No committed acceptance evidence in
  this repository records one. Completion times are stated at two assumed rates
  and labelled; the request counts are exact.
- **No runtime budget was changed.** ADR 0040 lists the four raises candidate (c)
  needs; making them is T002's work under its own recorded contract response.
- **Blender MCP and Chrome were not used.** Neither was needed for arithmetic
  over committed geometry, and neither was used to manufacture a visual claim.

## Determinism

The committed records carry no host facts. A first draft put wall clock and peak
RSS in `distributions.json` and `coarse-tier.json`, which would have changed
their checksums on every re-run; that was moved to the untracked stage receipts
and to this record, following ADR 0025 D8. Verified afterwards by replay:

- `cell-extents.json` — byte-identical on `extents --force`.
- `distributions.json` — byte-identical on `plans --force`.
- `candidate-costs.json` — unchanged checksum across a `coarse` rewrite,
  because the fields it quotes are the deterministic ones.

All six records' committed `.sha256` sidecars verify against their bytes.

## Verification

- Focused: `citywide-snapshot-gate` 11/11, `citywide-overview-census` 13/13,
  `citywide-overview-tier-candidates` 22/22.
- Full suite, typecheck, lint, build: see the task's final report.
- `git diff --check`: clean.
- Frozen release directories: untouched. This task wrote only under
  `data/citywide-overview-census-20260814/`, `src/release/`, `scripts/`,
  `docs/`, `package.json` and `.gitignore`.
