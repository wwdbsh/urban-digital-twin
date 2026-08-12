# T024 — Manhattan exterior integration acceptance (2026-08-12)

- Task: T024, Issue [#25](https://github.com/wwdbsh/urban-digital-twin/issues/25)
- Kind: operations. Risk: high. Branch: `ccp/25-integration-acceptance`, based on `4bf820b`.
- Decision: [ADR 0039](../decisions/0039-goal-integration-acceptance.md)
- Committed record: `data/goal-integration-acceptance-20260812/reconciliation.json`

## Outcome, stated first

**The Goal is NOT complete.** 17 of its 31 acceptance criteria are MET, 8 are
MET-AS-ADJUDICATED with the delta stated, and **6 are NOT-MET with stop
reports**: criteria 1, 7, 8, 22, 24 and 30.

Nothing was deployed, published, acquired, or authorized. No approval envelope
widened. No immutable release changed.

## What was built

| File | Purpose |
| --- | --- |
| `scripts/goal-integration-reconciliation-cli.mjs` | Recomputes the Goal's coverage reconciliation from the committed ledger and the six committed wave censuses. `--check` compares against the committed record so it cannot drift. Exposed as `pnpm goal:reconcile`. |
| `package.json` | Adds the `goal:reconcile` alias. |
| `scripts/goal-integration-reconciliation.test.mjs` | 26 tests: recomputes the coverage block, asserts the four zero-violation counts one at a time plus two closure counts, pins the 17/8/6 split, and enforces the verdict table's own rules. |
| `data/goal-integration-acceptance-20260812/reconciliation.json` | The committed record: 31 criterion texts, 31 verdicts with evidence, 8 adjudication deltas, 6 stop reports, 7 residual risks, the criterion-digest derivation, and the computed `coverage` block. |
| `docs/decisions/0039-goal-integration-acceptance.md` | The method, the verdict table, the six stop reports in priority order, three findings, and the residual risks. |
| `README.md` | New "Manhattan generated building exteriors" section: six promoted waves, 484 of 45,194, tombstoned cells, textured V3, opt-in canaries, rollback, local-only showcase, known gaps. |
| `docs/PROJECT_BRIEF.md` | New "Generated building exteriors" section: the same facts at brief altitude, including the device-class status. |

## The reconciliation method

Three verdicts, and two of them must justify themselves:

- **MET** — direct evidence cited.
- **MET-AS-ADJUDICATED** — narrowed or made vacuous by a recorded decision, with
  the delta stated. **A missing `adjudicationDelta` fails the suite.**
- **NOT-MET** — with a stop report naming what would close it. **A missing
  `stopReport` fails the suite.**

The coverage half is arithmetic and is treated as such: computed from committed
bytes, recomputed on every test run, and required to equal the committed record.
The judgement half is a reading, and is labelled as one.

## Coverage reconciliation — criterion 12

Computed from `data/normalized/manhattan-exterior-wave-ledger-20260804/`
(checksum `62e093d2ca50b54b49fd8bbad9d0b11f6301b2b197623deb343f9ea915e59016`)
and the six committed wave censuses.

| Quantity | Value |
| --- | --- |
| Declared spatial cells / observed / assigned to a wave | 883 / 883 / 883 |
| **Missing spatial cells** | **0** |
| Declared canonical parents / distinct ids across the 883 cells | 45,194 / 45,194 |
| **Missing accepted building parents** | **0** |
| **Duplicate canonical owners** | **0** |
| Materialized parents (six censuses) | 44,295 |
| Refused parents, all under named stop codes | 899 (1.9892%) |
| Owned buildings accounted for by neither | 0 |
| Stop codes outside the closed vocabulary | 0 |
| **Buildings without a style class** | **0** (criterion 12's *component* half is carried by criterion 15's contract throw, not by a count) |

Refusals by stop code: `source-height-below-grammar-minimum` 384,
`ring-vertex-count-unsupported` 324, `ring-area-below-floor` 113,
`ring-neck-below-grammar-minimum` 39, `volume-identity-failed` 35,
`ring-not-simple` 4.

Promoted default coverage, which is a different question and is kept separate:

| Quantity | Value |
| --- | --- |
| Promoted waves | 6 of 6 declared |
| **Promoted canonical buildings** | **484 of 45,194 (1.0709%)** |
| Shipped GLB artifacts | 498 (the 14-entry gap is Block 835's second LOD) |
| Renderable cells / tombstoned cells | 13 / 870 |
| Exterior cache occupancy | 498 of 512 entries, 14 free |
| Runtime concurrency ceiling | 4, against the Goal's limit of 8 |

## Integration verification — what was re-run, and the exact outcomes

Re-run fresh in this worktree on 2026-08-12:

| Check | Result |
| --- | --- |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm build` | PASS; `prune-private-partitions` removed 4 private partition directories |
| `pnpm test` (full) | **128 files / 1,534 tests PASS** on a quiet machine — see the flake note below |
| `scripts/goal-integration-reconciliation.test.mjs` | 1 file / 26 tests PASS |
| `node scripts/audit-partition-tree.mjs` (pre-build) | `AUDIT: clean`; `dist/` absent |
| `node scripts/audit-partition-tree.mjs` (post-build) | `dist/` F1 private-path findings **0 over 6,070 files**; F2 release-data findings **0**, vendor-runtime 2 (bundled CesiumJS, classified and disclosed) |
| `pnpm showcase:audit` | Reproduced the committed record **byte-identically** (`git status` clean afterwards). See the self-invalidation finding below. |
| `pnpm showcase:smoke` (real Chrome, CDP, production preview) | build partition PASS; `private-paths-unreachable` PASS; `pick-provenance` PASS; **`six-wave-default` FAILED on `/favicon.ico`** — see below |
| `pnpm citywide:validate` | `valid: true`, 452 declared files, 304,382,520 bytes, 45,194 buildings, 109,386 restaurants |
| `git diff --check` | clean |

`pnpm citywide:validate` is not runnable inside this worktree — it reads
`data/generated/catalog/…`, which is gitignored and not present here. It was run
**read-only** against the main working tree, whose `git status` was captured
before and after and was byte-identically unchanged. The script contains no
write call.

Not re-run, cited with checksums instead, exactly as the task contract requires:
every Blender re-import census, every frame-time and heap campaign, and every
wave's committed browser journeys.

### The full-suite flake, reported rather than smoothed

The first full-suite run finished **1 failed / 1,508 passed** and a second
finished **2 failed / 1,507 passed**, both while four subagents were saturating
the machine. The failures were `src/app/App.test.tsx:482` (a `waitFor` timeout)
and `src/release/midtown-core-v3-release.test.ts:252`. Both files pass in
isolation on an unloaded machine — App 58/58 in 3.68 s, midtown-core-v3 20/20 in
20.23 s. These are vitest 5,000 ms default timeouts under CPU contention, not
assertion failures. `midtown-core-v3-release.test.ts` averages a second per test
and is the first to go. Carried as a residual risk rather than papered over.

The flake recurred once during the nit-closing pass — `App.test.tsx > closes
details with Escape and returns focus to the located-pick trigger`, at 1,280 ms
— and the same file then passed 58/58 in isolation in 2.98 s and the full suite
passed 128 files / **1,535 tests** on the immediate retry. Recorded because a
flake that is only ever mentioned once reads as a one-off.

It was then isolated rather than left as an observation: `npx vitest run
--no-file-parallelism` passed **1,535 / 1,535 twice in a row** at ~72 s each.
The trigger is worker CPU contention, not test order or shared state.
`--no-file-parallelism` is a reliable workaround; raising `testTimeout` would
close it properly. Not changed here — altering the test runner's configuration
is outside this task's scope.

### The public-build smoke re-run FAILED one journey, and the reason matters

Re-run against a fresh build in **both headless and headed Chrome with fresh
profiles**. Both runs failed the `six-wave-default` journey identically: a fresh
Chrome profile issues `/favicon.ico`, the showcase allowlist classifier has no
category for it, and `everyRequestClassified` reads `false` — 554 distinct URLs
against the committed record's 553.

Everything the journey substantively claims was verified and passed:

- **zero external hosts**;
- all six waves streamed their exact expected GLB counts — 14 / 156 / 71 / 179 /
  40 / 24, summing to the 484 promoted buildings;
- all 10 declared private-path probes returned the SPA-shell body hash
  `62c5ebf071b713fe8e872b20981ef8811a386364d08c48764921dc410626ff34` and never a
  declared private artifact checksum;
- `/favicon.ico` itself answers **404 with zero bytes** — failing closed.

So the release behaviour is sound and the committed T023 pass depended on
browser-profile state (Chrome caches favicon failures per origin). **Not
repaired**: the classifier is T023's, and changing it would make the committed
`smoke-evidence.json` non-reproducible in the other direction. Recorded as a
residual risk with the reproduction steps.

### The showcase audit invalidated its own committed record when re-run late

`showcase:audit` writes its record in place and counts working-record
directories under `data/`. Run at the start of this task it was byte-identical.
Run again after this task created `data/goal-integration-acceptance-20260812/`
it raised `workingRecordDirectories` from 19 to 20 and changed the checksum.
**The file was restored with `git checkout --` and was not re-emitted.** No
drift suite broke; `src/release/public-showcase-evidence-consistency.test.ts`
reads the record without recomputing that total. The README now carries the
caveat beside the command.

## Deviations from the task contract

1. **`pnpm citywide:benchmark` was not run.** It has the same `data/generated`
   dependency as `citywide:validate` and would have had to run against the main
   working tree. The validator is read-only and was safe to run there; a
   benchmark is a measurement whose numbers would belong to a different tree,
   and running it would produce a reading with no committed predecessor to
   compare against. The citywide base is unmodified by this Goal.
2. **No new real-browser final journeys were captured beyond the smoke re-run.**
   The task contract directs citing the committed measurement campaigns rather
   than re-running them; the smoke CLI was re-run because it is cheap and
   deterministic, and its one failure is reported above.
3. **The Blender evidence audit was a citation, not a re-run.** Blender MCP was
   not invoked. Every Blender figure in the reconciliation is quoted from a
   committed record whose checksums were cross-checked against the shipped
   payload inventories at the time it was written.
4. **The stop-report list reached exactly six**, which is the contract's
   reporting threshold. It is reported rather than trimmed, and the Goal-level
   handling is left to the orchestrator.

## What did not change

- No immutable release artifact, manifest, checksum, ownership ledger, approval
  instrument or frozen data record was modified. `data/` additions are the one
  new directory.
- No `public/data` payload byte changed.
- No existing test was modified, skipped or relaxed. All drift suites ran
  unmodified.
- No unrelated file changed; the pre-existing main-tree modifications are
  untouched and were verified unchanged after the one read-only command run
  there.
