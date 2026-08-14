# T002 — the visibility-driven cell scheduler, behind an opt-in flag

Task T002 of goal `manhattan-citywide-default-streaming` (Issue #67), branch
`fcp/67-visibility-scheduler`. The contract is ADR 0041; this record is what was
built, what it measured, and what it did not do.

## What was added

| path | purpose |
| --- | --- |
| `src/runtime/exterior-visibility-scheduler.ts` | The pure decision. Generic over bounded units, no Cesium imports, no I/O. |
| `src/runtime/exterior-visibility-scheduler.test.ts` | 17 tests: the frozen policy order, overlap, the render-extent fixture, the invariants, untrusted footprints, hysteresis. |
| `src/runtime/exterior-cell-scheduling.ts` | The exterior-cell binding. The only module that knows a unit is a cell. |
| `src/runtime/exterior-cell-reconciliation.ts` | Per-cell load reconciliation: the three sets, the drop-during-flight ordering, and the cross-wave abort predicate. Synchronous, no React, no I/O. |
| `src/runtime/exterior-cell-reconciliation.test.ts` | 17 tests: add / remove / remove-during-flight / re-admit-during-flight / publish order / batch failure / the abort property. |
| `src/runtime/exterior-cell-scheduling.test.ts` | 9 tests: the identity-by-reference claim, the alias, the unschedulable fail-closed rule, the pin-gate separation. |
| `src/runtime/citywide-overview-cell-extents.ts` | GENERATED. 883 render extents and the ledger alias, from the committed T001 census. |
| `src/runtime/citywide-overview-cell-extents.test.ts` | 7 tests: the census digest gate, verbatim re-derivation, the absence of `assignmentBounds`, the alias proof. |
| `src/runtime/exterior-scheduler-thrash-gate.test.ts` | 8 tests: the offline replay of the two committed camera traces, budgets and residency ceiling. |
| `scripts/emit-citywide-overview-cell-extents.mjs` | The generator, with `--check`. `pnpm citywide-overview:extents`. |
| `scripts/exterior-scheduler-trace-capture-cli.mjs` | The CDP capture: `trace` (camera paths) and `evidence` (the opt-in's two numbers). |
| `data/exterior-scheduler-traces-20260814/camera-traces.json` | Two real Cesium camera traces with capture provenance, plus `.sha256`. |
| `data/exterior-scheduler-traces-20260814/optin-evidence.json` | The default-vs-flag measurement at one pose, plus `.sha256`. |
| `docs/decisions/0041-exterior-visibility-scheduler.md` | The decision. |

## What was modified

| path | change |
| --- | --- |
| `src/app/App.tsx` | `?exteriorScheduler=on` added to the exterior URL state (parse and append); the flag, its refs and the scheduler carry; `exteriorSchedulerSignature` as a conditional effect dependency; the cell-loading effect turned into a per-cell reconciliation delegating to `exterior-cell-reconciliation.ts`; a build-time-gated trace probe. |
| `src/runtime/exterior-cell-runtime.ts` | `scheduledCellCount` / `deferredCellCount` on `ExteriorRuntimeMetrics`, set by `noteCellSchedule`. Purely additive. |
| `src/app/App.test.tsx` | Three new URL tests; six existing assertions extended with the new `scheduler` field. |
| `package.json` | Three scripts. |

No release was assembled, no artifact was published, no wave was materialized,
and no runtime budget constant was changed.

## Measurements

**The opt-in win**, at two cameras over the centre of Block 835's render extent,
both variants running the real promoted default under a 75 s settle window:

| camera | artifacts requested | cache entries / bytes resident | cells scheduled of 883 |
| --- | --- | --- | --- |
| street 260 m, default | 484 | 484 / 122,601,292 B | 883 |
| street 260 m, flag on | **14** | **14 / 1,910,784 B** | **12** |
| overview 2,400 m, default | 484 | 484 / 122,601,292 B | 883 |
| overview 2,400 m, flag on | **210** | **210 / 37,164,596 B** | **110** |

No external host was contacted in any of the four sessions. The default is
identical at both cameras. The street-level figures reproduced exactly across
two separate capture runs.

Artifact-request and cache-residency numbers only. No frame-time, GPU-memory or
rendered-fidelity claim (ADR 0040 D7).

**The thrash gate**, replayed offline from the committed traces:

| path | decisions | re-entry @3 (budget) | re-entry @8 | peak resident (ceiling 104) |
| --- | --- | --- | --- | --- |
| `midtown-street-pan-v1` | 13 | 0 (0) | 0 | 91 |
| `midtown-zoom-out-v1` | 17 | 13 (13) | 30 | 96 |

**Default bundle cost of the flag nobody enabled:** 4,892,346 -> 5,054,172 bytes
raw (+161,826, +3.3%) and 1,295,779 -> 1,333,029 gzipped (+37,250, +2.9%) on the
main chunk, essentially all of it the 883-row extents table.

## Host observations

- **The trace capture needed two corrections before it recorded anything.** A
  1.2 s post-drag settle recorded three samples for fourteen drags: Cesium's
  camera keeps moving on inertia after the pointer is released and `moveEnd` —
  the event the footprint is sampled on — fires after that decays. The window is
  2.6 s for left-drag and 1.8 s for right-drag, both measured. Separately, the
  mouse wheel was tried for the zoom path and rejected on its own evidence: one
  notch took the camera from 220 m to 27,843 m, which jumps the 1.2-2.4 km band
  rather than traversing it. Right-drag zoom at 12 px per step traverses it with
  six samples inside the band.
- **The capture CLI refuses a trace that does not do what its name says.** The
  pan asserts samples inside both named cells before writing; the zoom asserts
  at least three samples inside the band. Neither assertion is in the committed
  record as a claim — they are preconditions of the record existing.

## What did not get done

- **`refreshViewport` was not refactored onto the generic scheduler.** The
  signature was designed to serve shards; the refactor is T004's.
- **No cache reservation, no GPU measurement, no latency measurement, no
  rendered A/B.** ADR 0041 re-assigns each ADR 0040 obligation by number.
- **No behind-camera prefetch**, by the frozen policy for this cycle.
- **The cap was not tuned**, and it is applied PER WAVE rather than per session:
  at 2,400 m the midtown wave alone hit the cap of 96 exactly. The session bound
  is 6 x 96, not 96. Disclosed in ADR 0041 and owned by T003.

## The defect review found, and how it was closed

The first version of per-cell reconciliation had a real ordering bug. A cell
admitted at decision N and evicted at decision N+1 had its outcome written back
**unconditionally** when the load issued at N settled. Replaying the committed
`midtown-zoom-out-v1` trace with a two-decision load latency: **16 cells
resurrected into residency after eviction, 13 of them permanently un-evictable**
(absent from `requested`, so no later reconciliation could list them as dropped),
and a rendered set of **97 against a cap of 96**. A re-visible cell in that state
also issued a duplicate `loadCell`.

The logic was extracted to `exterior-cell-reconciliation.ts` — where an ordering
can be written down as a test instead of reasoned about in an effect — and fixed
in two places: an outcome is accepted only for a cell that is **still requested**
when its load returns, and a third set, `inFlight`, stops a cell re-admitted
before its original load settles from being requested twice. Five tests fail
against the pre-fix logic and pass against this one; they are listed in the final
report.

## Known-failing before this task, still failing

**Zero deterministic failures. One flaky test, and the flakiness is measured
rather than assumed.**

`src/app/App.test.tsx` "closes details with Escape and returns focus to the
located-pick trigger" (line 486) fails under FULL-SUITE PARALLELISM on this host
and passes on its own. Measured at HEAD: the whole file alone, 78/78 pass; the
test alone, passes; three consecutive full-suite runs gave 1686/1686 pass,
1685/1686, 1685/1686. It also failed in a full-suite run at the branch point
commit `3c4e67d` with every T002 change stashed, so it is not introduced here.

An earlier draft of this record called it deterministic. That was wrong, and the
reason is worth recording because it would mislead anyone repeating the check:
`pnpm test -- <path>` does NOT filter to that path — it runs the whole suite —
so what looked like an isolation run was another full-suite run. Isolating
requires `npx vitest run <path>`.

`src/release/midtown-core-v3-release.test.ts` and
`src/domain/deterministic-facade-generator.test.ts` behave the same way, and
`midtown-core-v3` takes 20.85 s against a 5 s timeout when run alone, which is
what the failures are. None of the three was fixed here and no test timeout was
changed, because either would put an unrelated repair inside this diff.
