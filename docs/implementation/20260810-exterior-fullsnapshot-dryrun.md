# 2026-08-10 - Full-snapshot deterministic generation dry run (T012)

Narrative run record for the dry run decided in
[ADR 0025](../decisions/0025-fullsnapshot-deterministic-dryrun.md). Nothing here
was published, activated, or written under `public/data/`.

## What ran

```
pnpm exterior-fullsnapshot:dryrun -- /tmp/udt-t012-fullsnapshot-dryrun-20260810/run-a --evidence
pnpm exterior-fullsnapshot:dryrun -- /tmp/udt-t012-fullsnapshot-dryrun-20260810/run-b --evidence
```

Each invocation reads the gitignored `manhattan-citywide-20260804` snapshot
through its manifest-declared shard references, verifies every shard against its
declared SHA-256 and byte size, reads the committed T011 ledger, then streams
generation one ledger cell at a time: adapt to a deterministic facade input,
generate the plan, validate the plan against the accepted V1 schema, record its
hash and truth record, and discard the plan.

The committed `data/normalized/manhattan-exterior-fullsnapshot-dryrun-20260810/evidence.json`
was written by the **run-a invocation** (the later of the two), and is byte
identical to the one the run-b invocation wrote immediately before it (verified
by `diff`, exit 0). `--evidence` is idempotent by construction: no host-observed
value enters the artifact, so re-running never invalidates the checksum sidecar.

Host: Node v24.12.0, darwin (arm64).

Producing code, for reference when re-running:

| file | SHA-256 |
| --- | --- |
| `scripts/exterior-fullsnapshot-dryrun.mjs` | `809956ba616ccb8709980439b266f702cd6c2423719c8dea942b51923c8a6443` |
| `src/domain/exterior-fullsnapshot-input.ts` | `6aa718efd577cbf60f4e5109fd1af2e6ff92f1f63df5b72547fe1e588ff52a88` |
| `src/release/exterior-fullsnapshot-plan.ts` | `94c91777feed917ec51e27a023ec2c5003a965eef3eae0e1c674365b5311640e` |

## Result

Both runs passed all 27 cross-checks.

```
  runDigestSha256       05a47492ed50c3b9a8c540683d97630c37628608e1750363dea357c09f81bf32
  baseManifest.sha256   acb5a9b52014f86535c8478e7d4e516efc03f6dff95c17e9896dfea4413c203c
  ledger.sha256         62e093d2ca50b54b49fd8bbad9d0b11f6301b2b197623deb343f9ea915e59016
  planned / stopped     45194 / 0
  cells                 883 (max membership 119)
  heightUnknown         76  forcedTwoFloor 1393  holeRingsDropped 1048 over 797 buildings
  grammar maxima        floors 135 / bays 39 / placements 8308 (zero caps reached)
  structural bytes      1212845412 (1.130 GiB) -- GATES
  pilot cross-check     7932980295 (7.388 GiB) -- non-gating label only
  reconciliation        {"missing":0,"duplicate":0,"unclassified":0}
```

### Host observations

Timings and memory are observations of a run, not replayed values, and are
deliberately absent from the checksummed evidence artifact. Each run writes them
to an uncommitted `observed-<run>.json` beside itself under the disposable root.
Every invocation executed against this implementation:

| invocation | wall clock | peak RSS | run digest | notes |
| --- | --- | --- | --- | --- |
| run1 | 146.0 s | 524 MiB | `05a47492…` | first full run of this implementation |
| run-b (`--evidence`) | 145.2 s | 506 MiB | `05a47492…` | wrote evidence first |
| run-a (`--evidence`) | 145.5 s | 526 MiB | `05a47492…` | rewrote it byte identically; this is the committed artifact |
| run-failclosed | n/a (stopped) | n/a | none | deliberate budget breach, see below |

An earlier pre-review implementation was also run: run-a at 145.6 s / 478 MiB,
run-b at 146.6 s / 641 MiB, and a verifier run-c. Those runs used a different run
record - they predate the `forcedTwoBay`, `subThreeMeterHeight`, and
axis-aligned-ratio fields, and their evidence artifact still embedded host
timings - so their digest `43e5fb29…` and their evidence checksums do not apply
to the current code. They are listed only so the run history is complete. Peak
RSS varies between runs because of GC timing, not retained state; all are far
below the ~2.8 GB a plan-retaining implementation costs.

### Replay proof

```
$ diff -qr /tmp/udt-t012-fullsnapshot-dryrun-20260810/run-a \
           /tmp/udt-t012-fullsnapshot-dryrun-20260810/run-b
$ echo $?
0
```

Empty output over the complete 889-file tree (883 per-cell plan-hash manifests
plus `summary.json`, `package-plan.json`, `budget-table.json`,
`cache-simulation.json`, `reconciliation.json`, `run-digest.json`), and both
`run-digest.json` files carry the same
`05a47492ed50c3b9a8c540683d97630c37628608e1750363dea357c09f81bf32`.

The committed evidence artifact was independently confirmed byte identical
across the two `--evidence` invocations, which is what keeps its checksum
sidecar valid over time.

### Budget table

| check | observed | limit | headroom |
| --- | --- | --- | --- |
| total-bytes | 1,212,845,412 | 8,589,934,592 | 85.88% |
| artifact-bytes | 1,171,612 | 268,435,456 | 99.56% |
| assets | 45,194 | 50,000 | 9.61% |
| artifacts | 90,388 | 200,000 | 54.81% |
| cells | 883 | 20,000 | 95.58% |
| lods-per-asset | 2 | 8 | 75.00% |
| placements-per-plan | 8,308 | 50,000 | 83.38% |
| cell-membership | 119 | 120 | 0.83% |

The gating structural estimate under-predicts: back-tested against the Stage 3
pilot's 28 measured GLBs it lands at 85.5% of measured bytes, worst asset 73.7%.
The 85.88% headroom on `total-bytes` is what makes that acceptable here - even a
2x under-estimate passes - and is why it must not be reused as a gate with a
narrow margin.

### Fail-closed proof

Acceptance (c) was exercised directly, not only in unit tests. The
`placements-per-plan` ceiling was temporarily lowered to 1 in a local working
copy of the script and the dry run re-executed:

```
T012 dry run FAILED CLOSED before wave materialization.
  every multi-LOD assembly budget check passes on the gating structural estimate
  ([{"id":"placements-per-plan","limit":1,"observed":8308,...,"ok":false,...}])
  stop report: /tmp/udt-t012-fullsnapshot-dryrun-20260810/stop-report-2026-08-10T12-48-40-795Z.md
exit=1
```

The run exited non-zero, wrote a timestamped stop report listing every check
that had passed up to the failure, and left its output directory
`run-failclosed` **non-existent**: the stop happens before any emission, so
nothing partial reaches disk. The temporary edit was reverted immediately
afterwards; the script's current content hashes to the value in the table above.

## Truth substitutions this run made

Recorded per building in the cell manifests and aggregated in the committed
evidence:

| substitution | count | magnitude |
| --- | --- | --- |
| footprint replaced by a minimum-area rotated rectangle | 45,194 | area ratio median 1.0462, p95 1.4178, max 6.0772 |
| interior rings dropped | 797 buildings, 1,048 rings | dropped area recorded per building |
| height quantized to `floorCount x floorHeightMm` | 45,194 | residual median 2 mm, mean 2.843 mm, max 87 mm |
| unknown height replaced by a 10,500 mm constant | 76 | flagged `heightSource: "fallback"`, distinct plan anchor id |
| sub-5.25 m building raised to the two-floor grammar | 1,393 (140 under 3 m) | flagged `forcedTwoFloor` |
| short side under 12 m raised to the two-bay grammar | **29,011** | flagged `forcedTwoBay` |
| longitude scale frozen at 40.78125 deg | 45,194 | <= 1,463 ppm; median span 26.7 m -> 39 mm, max span 655.9 m -> 960 mm |

The bay-grammar floor is by far the most frequent substitution - 64% of all
buildings, because the common 25 ft Manhattan lot is under the 12 m threshold -
and had been undisclosed before review. It is now flagged per building and
counted like every other substitution.

The minimum-area rectangle is compared against the axis-aligned bounding box it
replaces **from the same committed evidence**, not from a one-off script: the
adapter computes both ratios per building. Over the 45,194 buildings the AABB
inflates footprint area by a median factor of 2.2913 (p95 3.0704, max 16.4228)
against the rotated rectangle's 1.0462 - roughly 2.2x closer to true area.

## Committed evidence

`data/normalized/manhattan-exterior-fullsnapshot-dryrun-20260810/`

| file | SHA-256 |
| --- | --- |
| `evidence.json` | `f4907661dba1e4f384e0808d233008bed533c6af151d0a6bf3026cbb2484d8c9` |
| `evidence.sha256` | sidecar recording the line above against `evidence.json` |

`src/release/exterior-fullsnapshot-plan.test.ts` reads only this committed
artifact. It never imports from the gitignored `public/data/` tree; the
pre-existing hazard in `exterior-pilot-assets.test.ts` was deliberately not
extended.

## What this run does not prove

- It does not produce or measure a single artifact byte. The package plan is an
  estimate, under-predicts against the pilot, and cannot discharge any
  `MultiLodAssemblyManifest` obligation.
- CI can prove the evidence is internally consistent, matches its checksum, and
  pins the same base-manifest and ledger checksums the code is compiled against.
  It **cannot** prove the run occurred: the dataset is gitignored. Re-running the
  script against the local snapshot is the only thing that establishes that.
- The zero counts printed by the script are gated by its own
  `planned === 45,194 && stopped === 0` check. The reconciliation library's
  ability to *detect* a missing, duplicate, or unclassified outcome is proven by
  synthetic-failure unit tests, not by a clean run.
- It proves byte-identical replay on one Node build, not across engines.
- It makes no visual, geographic, architectural, or performance claim.
