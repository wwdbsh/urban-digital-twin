# Refusal transparency (T007)

Date: 2026-08-17
Task: T007
Decision record: ADR 0054
Evidence: `data/refusal-ui-20260817/`

## What changed

| File | Change |
| --- | --- |
| `src/runtime/exterior-cell-runtime.ts` | `refusedBuildings()` / `refusedBuilding()` — one memoized synchronous accessor over `status: "unavailable"` rows; `ExteriorRefusedBuilding`; the closed `EXTERIOR_REFUSAL_STOP_CODES` vocabulary; `exteriorRefusalStopCode()`; `exteriorRefusalStatement()` (H1). |
| `src/app/App.tsx` | `ExteriorSelectedFeatureDetail` — the three-way selected-feature row; `exteriorSortedIdsInclude()` binary-search membership. |
| `scripts/exterior-refusal-journey-constants.mjs` | J7's frozen subjects, arms and gate rules, committed before the capture. |
| `scripts/exterior-serving-journeys-cli.mjs` | J7 `--journey=j7`, writing to its own dated root; `schedulerOff` pose option. |
| `scripts/exterior-refusal-census.test.mjs` | Census integrity, J7 subject verification, payload-gated real-graph accessor test. |
| `src/runtime/exterior-refusal-statement.test.ts` | Stop-code and H1 unit tests. |
| `src/app/ExteriorSelectedFeatureDetail.test.tsx` | The three JSDOM panel cases plus H1 in the rendered DOM. |
| `src/runtime/exterior-cell-runtime.test.ts` | Two accessor tests (no request; refusals and available buildings stay disjoint). |

## Why the accessor, and not a manifest

`release-graph.json` is already fetched whole at boot per wave and already
carries the 205 refusals verbatim. A refusal manifest would have added an
artifact, a checksum, a validator and a release re-emission to surface data the
client had downloaded and parsed a moment earlier. See ADR 0054 D-1.

## The three cases

The row previously answered every non-rendered selection with *"No verified
exterior representation is active for this record."* — true of a **refused**
building, a **not-yet-streamed** one, and an **unowned** one alike, which is
precisely the distinction a user needs. Now:

- refused → permanent, with release, tombstone id, stop code and reason;
- not resident → recoverable, "Move closer to load it";
- not owned → the original wording, unchanged.

The lookup walks the active wave runtimes **directly**. `exteriorWaveForSelection`
attributes by rendered outcome and returns `null` for exactly these selections,
so routing the refusal lookup through it would have produced a feature that
silently did nothing at six-wave scale.

## H1, and why it needed a browser to settle

Every reason ends *"…; base massing from the pinned citywide release is what
remains on screen"* — false under `?exteriorScheduler=off`. The app asserts the
sentence **truncated at that clause** and quotes the full sentence beside it,
attributed to the release.

J7 captures each subject in **both** arms. The measured result: the asserted
statement is byte-identical across arms for all four subjects, carries neither
`base massing` nor `what remains on screen`, and the quotation carries the full
clause in both. That is the evidence that the truncation is a property of the
component and not an accident of the default arm.

## J7 — measured

Single attempt, `attemptCount: 1`, Chrome/151.0.7922.138, viewport 1440x900,
served from this worktree's own `dist` (pre-flight checksum match), 8 stills
committed with checksums, `survivingChromeProcessCount: 0`.

| Stop code | Building | J7-a | J7-b | J7-c | J7-d | J7-e | J7-f |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ring-area-below-floor` | `doitt:1290701` | PASS | PASS | PASS | PASS | PASS | PASS |
| `ring-neck-below-grammar-minimum` | `doitt:510821` | PASS | PASS | PASS | PASS | PASS | PASS |
| `ring-not-simple` | `doitt:819435` | PASS | PASS | PASS | PASS | PASS | PASS |
| `volume-identity-failed` | `doitt:1269491` | PASS | PASS | PASS | PASS | PASS | PASS |

24 of 24 gate checks pass across both arms.

## Findings recorded rather than smoothed

- **Zero fully-tombstoned cells** across all six serving waves. The not-shipped
  coverage sentence's numerator is structurally 0 on the shipped default, so no
  coverage string is currently false because none is currently emitted. The
  notice half of criterion #9 is exercised today only by fixtures and docs, and
  is left untouched. See ADR 0054 D-4.
- **Three of four J7 cell ids were invented on first writing** and were wrong.
  They were plausible, and a journey navigating to an invented cell would still
  have produced a screenshot that looked fine. Every field is now re-read from
  the shipped graph by a committed test, which is what caught them.
- The census carries its own `stopCode` field *and* the code embedded in the
  prose; the tests assert the two agree, so a divergence cannot pass silently.

## Not claimed

- Criterion #9's first half is discharged for the four codes J7 selected, not for
  the 201 refused parents it did not select in a browser. The accessor is tested
  over all 205 through the real graphs.
- No canvas pick: every J7 selection is a `?feature=` deep link.
- No visual or geographic acceptance; a still shows pixels were produced.
