# Block 835 V3 wave repromotion (untextured)

Date: 2026-08-11 (Asia/Seoul) · Task T026 — Issue #44 · Decision record:
[ADR 0033](../decisions/0033-block835-v3-wave-repromotion.md)

Release promoted: `manhattan-exterior-cells-20260811-v3`
(`defaultHead` = `snapshot:manhattan-exterior-cells-20260811-v3:v1`,
`73e112f4080710f8a351c5cc22a826603e69af42d7b040e1769aa6e0540869cd`)

Predecessor, retained and byte-untouched: `manhattan-exterior-cells-20260811`.

Committed evidence inventory:
[`data/block835-v3-repromotion-20260811/evidence-inventory.json`](../../data/block835-v3-repromotion-20260811/evidence-inventory.json)
(SHA-256 `1c8d0ee5b2f39275cf9eb51c2b74752814c2565eef5a4eeb35d3bb601ad5426e`,
12 files). Raw evidence is untracked under
`artifacts/block835-v3-repromotion-20260811/`.

## Order of work: the frame gate came first

The V3 grammar raises block LOD-0 triangles from roughly 24,000 to **139,476**
(~5.8x), with `doitt:778052` alone at **102,988**. That is the change most likely
to break a budget, so no release byte was committed until it had been measured on
a real browser. Prior V2 evidence was explicitly **not** substituted for a
measurement.

### P0 result — both profiles pass

Production build (`VITE_BLOCK835_PROBE=1`), `vite preview` on
`localhost:4310`, dedicated desktop Chrome 151 launched with
`--remote-debugging-port` / `--user-data-dir` / `--js-flags=--expose-gc`, driven
over CDP with `Page.bringToFront`. Viewport 1728x913 CSS px at
devicePixelRatio 2, ~135 Hz. 1 s settle, 8 poses x 60 samples x 4 repeats =
**1,920 accepted samples per profile**. `documentHasFocus` true before and after
both accepted runs.

| # | Criterion | Verdict | Evidence |
| ---: | --- | --- | --- |
| 1 | Exploration median <=16.7 ms / p95 <=25 ms | **pass — measured** | **8.30 / 9.30 ms**, `droppedFrameRatio` 0 (`json/p0-exploration.json`, sha256 `d0614abe…`) |
| 2 | Inspection median <=33.3 ms / p95 <=45 ms | **pass — measured** | **8.30 / 9.30 ms**, `droppedFrameRatio` 0 (`json/p0-inspection.json`, sha256 `d3de7e81…`) |
| 3 | <=8 active exterior requests | **pass** | measured peak **4** |
| 4 | <=256 MiB exterior cache | **pass** | peak **1,910,044 bytes**; 14 cache entries, 0 evictions |
| 5 | No monotonic retained growth | **pass, with forced collection** | JS heap with `window.gc()` at each repeat **shrank**: -13.3 % (exploration), -12.0 % (inspection). This also closes the T009 row-18 item the earlier collection-free method could not certify either way. |

Row 4's **14 cache entries** is the load-bearing anti-F2 check: an empty scene
would have measured fast and proven nothing. All fourteen V3 assets were resident.

The 5.8x triangle rise cost no measurable frame time — the V2 median on
comparable hardware was also 8.3 ms. The rise is absorbed by GPU headroom, not by
the budget.

## Renderer journeys

All against the production build in the same focused Chrome.

| Journey | Result | Evidence |
| --- | --- | --- |
| Default cold load over the real citywide base | Block 835 renders V3; Midtown-core V2 still default; non-wave buildings stay flat-topped base massing | `screenshots/j-v3-block-overview.png` |
| Footprint-faithful massing at facade distance | Window grid, bay rhythm and a setback ledge visible on the ESB tower | `screenshots/j-v3-esb-200m.png`, `j-v3-esb-facade.png` |
| Picking / details / deep link | `?feature=doitt:778052` opens details naming release `manhattan-exterior-cells-20260811-v3`, `cell-release:…-v3:v1`, truth tier `generated`, source dates, and the V3 uncertainty statement | `screenshots/j-details-esb.png` |
| Explicit opt-in narrows to one wave | `?exteriorCells=…-v3` streams that release **alone** (Midtown drops out), 0 alerts | `screenshots/j-optin-v3.png` |
| Per-wave disable | `?exteriorStreaming=off` removes every exterior status line | `screenshots/j-disable.png` |
| Fixture silence | A fixture-mode session claims no exterior wave and reports none | `screenshots/j-fixture.png` |
| **Rollback rehearsal** | Exporting the predecessor puts **V2 back on as the default**, Midtown unaffected | `screenshots/j-rollback-v2.png` |
| Rollback refuses the withdrawn link | `?exteriorCells=…-v3` → "Exterior streaming release manhattan-exterior-cells-20260811-v3 was rolled back in this build… no substitute exterior release was selected. Base massing from release manhattan-citywide-20260804 is shown." | `screenshots/j-rollback-refused.png` |
| Roll forward again | The shipped record restores both waves | `screenshots/j-forward-again.png` |

The rollback rehearsal was performed by actually exporting
`BLOCK835_V2_EXTERIOR_ROLLBACK` as `EXTERIOR_DEFAULT_ACTIVATION`, rebuilding, and
driving the browser — then restoring the forward record and rebuilding. It is not
a simulated swap.

## What changed in `src/`

| Area | Change |
| --- | --- |
| `src/release/block835-canary-release.ts` | Parameterised by a `Block835CanaryReleaseProfile`. Every logical id derives from the release id; the V2 profile is the default, so `buildBlock835CanaryRelease(input)` keeps its original call shape and its bytes. |
| `src/release/block835-v3-canary-release.ts` (new) | V3 successor identity, approval scope/exclusions/note/fingerprint, profile instance. |
| `src/domain/exterior-contract.ts` | `CONDITIONALLY_APPLICABLE_EXTERIOR_COMPONENT_KINDS`; `isExteriorComponentReleaseEligible` admits an absent `setbacks` **with a reason**. Platform-wide — see ADR 0033 Decision B. |
| `src/domain/deterministic-facade-generator-v3.ts` | Optional cited `V3Input.styleOverride`; `selectV3StyleClass` untouched. |
| `src/release/block835-v3-package.ts` | `buildV3Plan(building, styleOverride?)`. |
| `src/runtime/exterior-default-activation.ts` | Enabled-predecessor rollback; `rolledBackReleaseId` readable on both shapes; Block 835 record swapped to V3; V2 record retained as `BLOCK835_V2_EXTERIOR_ACTIVATION` / `BLOCK835_V2_EXTERIOR_ROLLBACK`. |
| `src/runtime/block835-canary-probe.ts` | Block 835 probe target is the successor release. |
| `src/app/App.tsx` | The successor release id added to `PINNED_EXTERIOR_CELL_RELEASE_IDS`. |
| `scripts/emit-block835-canary-release.mjs` | `--profile v2\|v3`; the profile, not `--out`, decides the writable directory. |

## Immutability

- `public/data/manhattan-exterior-cells-20260811/` — **unchanged**. Re-emitting
  V2 through the now-two-profile emitter reproduced the committed bytes exactly
  (`git status` clean), and a test asserts it on every run.
- `public/data/manhattan-esb-block-reference-20260811-v3/` — opened read-only.
- All fourteen V3 plan hashes — **unchanged** (the override key is omitted, not
  `undefined`).
- Midtown-core release, package and promotion record — **unchanged**.
- Only new bytes: `public/data/manhattan-exterior-cells-20260811-v3/` (63 files).

## Gates

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | Pass |
| `pnpm lint` | Pass, 0 problems |
| `pnpm test` | 84 files / **890 tests**; 889 pass. Baseline before this task: 83 files / 874 tests. |
| Known failure | `App.test.tsx > closes details with Escape and returns focus to the located-pick trigger` — **pre-existing flake**, proven by stashing every change and failing 2/2 full runs at clean HEAD, while passing 3/3 in isolation. Not caused by this task and not repaired here. |
| `pnpm build` (default) | Pass; probe absent |
| `VITE_BLOCK835_PROBE=1 pnpm build` | Pass; 3 private partitions pruned from `dist/` |
| `git diff --check` | Clean |
| V2 byte-freeze | `block835-canary-release.test.ts` 9/9; V2 re-emit byte-identical |
| V3 package byte-freeze | `block835-v3-package.test.ts` + generator pins green; 14/14 plan hashes unchanged |
| Double-run determinism | V3 release rebuilds byte-identical |
| Graph / assembly / index validation | All three validators clean on the committed successor bytes |
| Artifact replay | 63 emitted public artifacts verified against their declared checksums and byte sizes |
| Anti-leak | 0 `private/`-prefixed paths emitted; private root declares exactly 1 artifact, never written |
| Membership drift | None — successor owns exactly V2's fourteen identities, 1 cell |

### Test changes, enumerated

| File | Change | Why |
| --- | --- | --- |
| `exterior-default-activation.test.ts` | `committed()` now reads the release the **record names** rather than a hard-coded path | A path-literal drift test silently stops testing the record the moment it is repromoted |
| " | Rollback assertions rewritten for the enabled predecessor; roll-forward added | The rollback target changed shape by design (ADR 0033 Decision C) |
| " | + `keeps the V2 predecessor byte-identical to the release it names`, + `promotes without availability drift` | New guarantees |
| `exterior-multiwave-activation.test.ts` | `ROLLED_BACK` is now an explicit base-only withdrawal; per-record predecessor assertion handles both shapes; V3 release ids | Block 835's own predecessor is no longer base-only |
| " | + `rehearses the Block 835 V3 rollback and roll-forward with Midtown untouched` | P2 requirement |
| `App.test.tsx` | Serves both Block 835 release roots; promoted-default assertions point at the successor | The promoted default moved; V2 opt-in paths deliberately still tested |
| `exterior-contract.test.ts` | + absent-component admission test | New contract rule |
| `deterministic-facade-generator-v3.test.ts` | + 4 style-override tests | New generator capability |
| `block835-v3-canary-release.test.ts` (new) | 8 tests | New release |

No test was deleted or weakened; every existing assertion either survived
unchanged or was re-pointed at the release this build actually promotes.

## Carried forward

1. **The ESB cited limestone override is not applied.** The grammar accepts it
   and it is fully test-pinned, but no plan uses it. Applying it needs: the
   rights-cleared intake record; a successor private package (it moves ESB's plan
   hash); a **Blender re-measure of ESB's two assets** under the new hash; the
   sibling `DETERMINISTIC_FACADE_V3_CITED_STYLE_UNCERTAINTY` with
   `validateV3Plan` accepting exactly the two constants; and a details-panel
   cited-fact line. Until then the Empire State Building renders in the designed
   `curtain-cool` class, which is visibly wrong for a limestone building — the
   mismatch is disclosed, not hidden.
2. **Midtown V3 (P3)** is untouched, as scoped.
3. **Textured public admission (P4)** remains unmeasured and ungated.
4. Midtown-core's pre-existing 146-of-149 empty-cell notice and one
   `request-failed` cell were observed during these journeys. They predate this
   task and are unrelated to it; they are recorded, not adopted.
