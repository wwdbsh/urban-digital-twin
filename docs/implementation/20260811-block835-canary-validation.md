# Block 835 canary end-to-end validation

Date: 2026-08-11 (Asia/Seoul)

Task: T009 — "Validate the Block 835 canary end to end" (Issue #10)

Release under validation: `manhattan-exterior-cells-20260811`
(`defaultHead` = `snapshot:manhattan-exterior-cells-20260811:v1`,
`18e1689e19264543d8aaacafe989769b5d74f04cf0f5ca9cfc6c5407632e0ae7`)

Predecessor record: [T008 canary implementation](20260811-block835-exterior-canary.md)
· Decision record: [ADR 0027](../decisions/0027-block835-generative-exterior-canary.md)

Committed evidence inventory:
[`data/block835-canary-validation-20260811/evidence-inventory.json`](../../data/block835-canary-validation-20260811/evidence-inventory.json)
(SHA-256 `3ea0defbfe9ba37482f6319377b6646912e001c4ebe3282723781c31b3595dad`,
21 files). The raw evidence lives untracked under
`artifacts/block835-canary-validation-20260811/`; the inventory keeps its hashes
checkable after that tree is removed.

## Why this task exists

T008 shipped a green suite — 536 to 549 tests — while three defects made the
canary render nothing in a browser. Every one was found only by real-browser
validation. This task therefore treats "a unit test passed" as *never*
sufficient evidence for a user-visible claim. Each row below cites a real
measurement or is an explicit failure.

**It found a fourth defect the green suite still misses.** See F1.

## Declared reference hardware

Measured in the run, not assumed:

| Property | Value |
| --- | --- |
| Browser | Orca embedded Chromium, `Chrome/150.0.7871.47` on macOS |
| WebGL renderer | `ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version)` |
| WebGL version | `WebGL 2.0 (OpenGL ES 3.0 Chromium)` |
| Viewport (CSS px) | **1097 × 894** |
| `devicePixelRatio` | 2 (2194 × 1788 device px) |
| Build | production `vite build` (`buildMode: "production"` recorded by the probe) |
| Server | `vite preview` on `http://localhost:4310` serving `dist/` |
| Network hosts contacted | `localhost:4310` only |

The Goal's device target is a **1440p-class desktop** (GOAL.md:189). The
attainable CSS viewport here is 1097 × 894, which is not 1440p-class. Every row
that depends on viewport scale is marked **partially met** and never asserts the
1440p target.

## Findings

### F1 — `private/` partitions were browser-resolvable from the build output

`public/` is copied verbatim into `dist/`, so
`public/data/manhattan-esb-block-reference-20260810/private/**` and
`-20260811/private/**` — 58 files — landed in `dist/` and were fetchable by path
from a production build. No manifest, release graph or allowlist referenced
them; the path simply resolved. The canary's own graph emitter is not the cause
(it writes no private bytes); the T007/T008 package emitters wrote
`private/`-prefixed content under `public/` and it was force-added past
`.gitignore`.

The audit classifies the two halves separately, because they are not equally
severe:

| Package | Files | Classification |
| --- | ---: | --- |
| `manhattan-esb-block-reference-20260811` | 29 | `duplicate-of-public-byte` — byte-identical to the canary's own `public/assets/**` |
| `manhattan-esb-block-reference-20260810` | 29 | `private-only-byte` — **no public counterpart anywhere in the tree** |

The 20260811 half is a pure partition/path violation: the exact bytes are
already public. The 20260810 half is **more than the frozen contract
anticipated** — those bytes are reachable and are not duplicated into any public
partition. They are generated geometry under the same `jh45-qr5r` envelope and
nothing was deployed (this is a local preview), so this is a partition/path
violation with a rights dimension rather than a demonstrated rights leak. It is
recorded as such and not softened.

**Corrected.** `scripts/prune-private-partitions.mjs` runs as the last step of
`pnpm build` and removes directories literally named `private` under
`dist/data/`. It never touches `public/data/` or `data/`. After the correction
the audit reports **0 private paths in `dist/` over 1478 scanned files**, and
the canary is unaffected because it references only `public/`-rooted artifacts.

### F2 — the level facade viewpoint renders nothing (product defect)

This is the most important finding, and it sits exactly on the Goal's accepted
facade viewpoint criterion.

At the derived ≥10 m facade poses the canary drew **zero** of its 14 buildings.
The cause is not the canary and not the pose derivation — it is **camera pitch**:

| Camera | Buildings drawn |
| --- | ---: |
| h = 40 m, pitch −30° | **14** |
| h = 40 m, pitch 0° | 0 |
| h = 12 m, pitch −30° | **14** |
| h = 12 m, pitch −28° | **14** |
| h = 12 m, pitch −25° | 10 |
| h = 12 m, pitch −20° | 0 |
| h = 12 m, pitch −15° / −10° / −5° / 0° | 0 |
| h = 4.086 m, pitch −30° | **14** |
| h = 4.086 m, pitch −10° | 0 |

Position is identical within each height; only pitch differs. So the canary
**can** render at facade distance — 4.086 m works — and the failure is
attitude-dependent, not distance-dependent.

Mechanism, measured rather than inferred. `cameraFootprintForViewer`
(`src/features/explorer/CesiumViewport.tsx:1127`) defines the streaming
footprint by nine globe pick-rays. At a level attitude those rays sweep to the
horizon, so the visible-shard set explodes. The diagnostics panel shows the
consequence directly:

| Pitch | Aggregate cache entries | Cached bytes | Evictions | Decoded base summaries |
| --- | ---: | ---: | ---: | ---: |
| −30° | 10 | 7,917,123 | **0** | 5,216 |
| −10° | **24 (at cap)** | 4,568,525 | **25** | 7,722 |
| 0° | **24 (at cap)** | 4,568,525 | **25** | 7,722 |

At a level attitude the shard set saturates the 24-shard cache budget and
eviction thrash drops the shard **under the camera**. With no base building
record there is no verified WGS84 anchor, so the exterior cells withhold
geometry — and say so, honestly:

> Exterior geometry for 14 verified buildings (…) is not drawn: the matching
> base building record is not loaded, so there is no verified WGS84 anchor for
> it. It will be drawn once that base record loads.

The app's failure messaging is correct and explicit. The defect is upstream, in
base viewport-footprint/shard selection at shallow camera attitudes.

**Not worked around silently.** The committed level path
`block835-canary-facade-v1` is unchanged and remains the criterion path. A
second, explicitly labelled path `block835-canary-facade-v1-oblique` was derived
at pitch −30° with the **identical perpendicular camera-to-facade distance**, so
that memory, request and component evidence could be gathered against a scene
that actually contains the canary geometry. Its fixture carries the disclosure
verbatim and no row below claims the level criterion from it.

A bounded correction is **proposed, not implemented** (it is outside T009's
scope): clamp or floor the ground-ray footprint at shallow pitch — for example,
bound the footprint to a maximum ground radius around the camera's own
sub-point, and always include the shard containing the camera position
regardless of eviction pressure. That second half alone would have prevented
this, and it is testable without a browser.

### F3 — honest frame-time evidence is unattainable in this environment

The Orca embedded browser never reports `document.hasFocus() === true`, and its
`requestAnimationFrame` is throttled accordingly. Measured directly, 120 samples:
**median 65.2 ms, p95 84.7 ms, max 1000.7 ms** with `documentHasFocus: false`
(`json/raf-throttle-evidence.json`).

That is the environment's background throttle, not the renderer. The probe
refuses to certify it by design and reported
`status: "waiting-for-focus"` (`json/perf-probe-exploration-refusal.json`).
Focus could not be obtained via `orca tab switch`, `orca click`, `window.focus()`
or `orca open`.

Publishing a frame time from a 15 FPS throttle would be a fabricated
measurement. Both frame-time rows below are therefore **explicit failures —
not measured**, and no median or p95 is quoted anywhere in this record.

## Criteria table

Twenty rows against the Goal. `pass` requires real evidence; anything unproven is
an explicit failure, never an assumed pass.

| # | Criterion (GOAL.md) | Verdict | Evidence |
| ---: | --- | --- | --- |
| 1 | Block 835 proves partition, generated-vs-real model, multi-LOD, native selection, comparison, performance, rollback (:180-182) | **partial — decomposed** | Umbrella row; it is exactly as strong as rows 2-20. Rows 2, 4 and 18(memory) fail, so the umbrella cannot pass. |
| 2 | Accepted facade composition, openings, entrances, material classes, roofline, truth labelling at ≈10 m or farther (:185-188) | **EXPLICIT FAILURE** | F2. At the derived ≥10 m level poses **0/14** buildings render. Committed path `block835-canary-facade-v1`, closest camera-to-facade **13 m**, every pose ≥10 m and recomputable from committed plan bytes. Geometry *is* correct when the camera pitches down: `screenshots/j03-canary-facade-0{1..4}-oblique.png` show setbacks, window recesses, cornices, entrances and a rooftop water tank. |
| 3 | Mobile keeps navigation/picking/details/provenance/deep links at lower LOD with explicit lower-LOD status (:189-190) | **EXPLICIT FAILURE — unmet, not implemented** | Confirmed absent from the codebase. No mobile LOD policy or disclosure exists. Not implemented here (out of scope); recorded as an open gap. |
| 4 | Exploration median ≤16.7 ms / p95 ≤25 ms; inspection median ≤33.3 ms / p95 ≤45 ms after 1 s settle (:191-193) | **EXPLICIT FAILURE — not measured** | F3. rAF throttled to a 65.2 ms median with `hasFocus:false`; the probe refused (`waiting-for-focus`). No frame-time number is claimed. Evaluator and budgets are implemented and unit-tested (`block835CanaryBudgetVerdict`), and a missing measurement is coded to fail, never pass. |
| 5 | Profile switch preserves feature ownership, URL, details, provenance, release identity (:194-195) | **pass** | `json/profile-switch-{before-exploration,after-inspection}.json`. Across the switch: `featureId` `doitt:102705`, release origin, `cell:manhattan:block-835 · cell-release:…:v1`, truth tier `generated` and confidence all identical. Only the profile and LOD changed — `lod_1 6bac3b59…` → `lod_0 16046eae…`, both matching `assemblies.json` exactly. URL gained `exteriorProfile=inspection`. |
| 6 | Component inventory per class; no grammar-required placeholder blank walls in the ≈10 m views (:204-206) | **pass with caveat** | `screenshots/j03-canary-facade-04-oblique.png` shows facade bands, window recesses, setback decks, cornices, roof equipment and a water-tank prism on legs; no blank wall appears on any visible surface. Caveat: observed on the oblique path (F2), so this is not evidence for the *level* viewpoint. |
| 7 | Generated storefronts expose zero tenant, logo, trade-dress, occupancy, operating-status or signage claims (:207-208) | **pass** | Details panel carries the V2 uncertainty verbatim: "…does not assert real-world facade, setback, balcony, fire-escape, water-tank or signage accuracy, nor any tenant, brand or text." Package is texture-free and glyph-free by construction (T008). No tenant or sign text appears in any screenshot. |
| 8 | No accuracy overstatement; generated components carry no real-world accuracy score (:209-212) | **pass** | The only numeric confidence shown is `high (0.96)` on the **base source record**, alongside "Snapshot-relative source record; no unsourced hours, ratings, routing, imagery, or facade claim." The exterior section exposes truth tier `generated` and an uncertainty statement, and no accuracy score. |
| 9 | Every included building/component has an evidence tier and zero unsupported truth claims (:213-214) | **pass** | Details expose `Truth tiers: generated` plus source dates ("captured 2026-08-04… · updated unknown" — unknown stated as unknown). All 14 cell `buildingDetails` carry `status: available` with an inventory and evidence shard id. |
| 10 | Stable ID, search, picking, deep links, details, failure states intact (:215-216) | **pass with caveat** | Picking through the real Cesium pick pipeline produced the deterministic overlap chooser ("Choose a source record; ordering is deterministic and no hidden first hit is selected") listing `doitt:102705` and `doitt:584049`; selecting one wrote `feature=doitt%3A102705` into the URL and opened full details. Back returned to the pre-selection URL, Forward restored `feature` **and** `exteriorProfile=inspection`. Caveat: the pointer events were dispatched into the canvas by script because the embedded tab takes no OS focus; the Cesium `ScreenSpaceEventHandler` path exercised is the real one, but this is not an OS-level pointer. |
| 11 | Accessibility: keyboard focus, prefers-reduced-motion, semantic controls (:218) | **partial** | `json/accessibility-probe.json`: 26 focusable elements, 23 buttons, **0 unlabeled buttons**, 8 landmarks (`main`/`header`/`nav`/4×`section`/`footer`), profile controls are real `<button>`s with correctly toggling `aria-pressed`, and a `prefers-reduced-motion` media rule is present in the shipped stylesheet. Not proven: real keyboard traversal and reduced-motion behaviour, both blocked by the focus limitation (F3). |
| 12 | Licensing and conveyance evidence for every shipped source and derivative partition (:219-220) | **pass** | 14 evidence shards each declare exactly 1 source (`source-ref:jh45-qr5r:<id>`), 1 licence (`license:nyc.building-footprints`), 1 approval and `evidence: []` — the honest statement that the shard records the rights basis, not admitted imagery. ADR 0027 Decision B envelope; public deployment remains excluded and nothing was deployed. |
| 13 | Separate private/public manifests, allowlists, checksums; the public build cannot request restricted artifacts (:221-223) | **pass with correction** | F1. Before: 58 browser-resolvable `private/` files in the build output. After the `pnpm build` prune step: **0 private paths in `dist/` over 1478 files** (`json/partition-audit-harness-build.json`). All 29 assembly artifact checksums verified against bytes on disk, 0 mismatches. The private root still declares exactly one artifact with a matching single-entry allowlist. |
| 14 | Prohibited evidence contributes zero pixels, geometry, textures, training inputs or acceptance evidence (:178-179) | **pass with disclosure** | Audit release-data findings: **0**. Two `vendor-runtime` findings are reported, not hidden: the CesiumJS bundle (`streetViewStaticApiEndpoint`, `maps.googleapis.com`) and `cesiumStatic/ThirdParty/google-earth-dbroot-parser.js`. Both are third-party library code that this app never constructs; the measured network hosts were `localhost:4310` only. No project-authored release byte carries a prohibited token. |
| 15 | Self-captured evidence with personal identifiers never ships in runtime textures or public artifacts (:97-99) | **N/A by construction** | The package is texture-free and imagery-free: 0 textures per asset, `runtimeTexture: false` on all 14 building details, `evidence: []` on every shard. No capture exists that could carry a face or plate. Cited from the T008 record rather than re-derived. |
| 16 | Each geographic wave can be disabled independently, restoring the previous verified representation (:225) | **pass** | `screenshots/j04-disabled-base-massing.png`. Removing `exteriorCells` removes the exterior streaming section entirely (`hasExteriorStreamingSection: false`), disables the profile controls, and the scene returns to plain flat-topped base massing with the base release note unchanged. |
| 17 | Canary, rollback, partition, cold load, deep links, Back/Forward and isolated failure journeys pass in a real browser (:228) | **pass with caveat** | Cold load: `screenshots/j01-cold-load-overview.png` — a first load with no toggle reaches the pinned default snapshot over the real citywide/civic base. Deep links + Back/Forward: row 10. Unknown canary deep link degrades loudly: "Exterior canary snapshot `snapshot` is not available: release … publishes no canary heads. The default pinned snapshot was used instead." (`canaryHeads` is empty by design; the opt-in mechanism is the `exteriorCells` parameter.) Isolated failure, three faults, app alive and search present in all three: `assembly-pin` → "Assembly package … failed closed: `$.cells[0].cellRelease.logicalId` Unexpected field. Exterior streaming was disabled; the existing base/exterior state was left unchanged."; `head-checksum` → "Pinned exterior snapshot … checksum does not match its public root declaration."; `one-glb` at inspection → "Exterior cell `cell:manhattan:block-835` failed verification (checksum-mismatch). Its pinned fallback is the base identity set …, which carries no exterior geometry, so the existing verified base massing is shown for this cell." Caveat: default activation is deferred to T010 and was not exercised. |
| 18 | ≤8 active exterior requests, ≤256 MiB compressed exterior cache, no monotonic retained-memory growth over repeated paths (:229-230) | **partial — 2 of 3 pass, memory FAILS** | `json/request-concurrency-breakdown.json`, from real `PerformanceResourceTiming` overlap: peak concurrency **6** across all release data (citywide 4, civic 1, exterior cells 3) — **≤8 pass**. Exterior bytes **3,708,440** (≈3.5 MiB) against 256 MiB — **pass**. Non-release browser load (bundle, Cesium workers) peaks at 44 and is outside this budget; it is reported, not counted. **Monotonic growth: EXPLICIT FAILURE — not measured**, because the repeated-path harness runs inside the probe, which refuses without focus (F3). A single-traverse heap reading of 149,720,843 bytes is recorded but proves nothing about growth. |
| 19 | Every wave starts as an opt-in canary; default only after gates and explicit promotion (:160-162) | **pass** | Opt-in preserved. Streaming activates only with `?exteriorCells=manhattan-exterior-cells-20260811`; without it there is no exterior state at all (row 16). `index.json` still has `canaryHeads: []`, `localOnly: true`, `runtimeExternalNetwork: false`. No default-activation change was made. |
| 20 | Rollback restores the previous verified mapping without deleting or mutating immutable releases (:164-166) | **pass — two truthfully-labelled halves** | **Browser half:** disabling the release restores base massing (row 16). The browser cannot resolve `20260810` as an active head and this is not pretended otherwise. **Ledger half:** `json/predecessor-checksum-verification.json` — all **14** per-asset predecessor pins `manhattan-esb-block-reference-20260810:doitt:*:lod_0` verified against the actual 20260810 bytes, **0 mismatches**; the cell predecessor `manhattan-esb-block-exterior-pilot-20260805` verified at `4a84ddbb…`; the head checksum recomputed from the snapshot file and matched. **Zero mutation:** `json/git-zero-mutation-proof.txt` — `git diff` over `public/data` and `data` is empty and no untracked file was added under `public/data`. |

### Tally

| Verdict | Count | Rows |
| --- | ---: | --- |
| pass | 8 | 5, 7, 8, 9, 12, 16, 19, 20 |
| pass with correction / caveat / disclosure | 5 | 6, 10, 13, 14, 17 |
| N/A with reason | 1 | 15 |
| partial | 3 | 1, 11, 18 |
| **EXPLICIT FAILURE** | **3** | **2 (facade views), 3 (mobile), 4 (frame-time budgets)** |

Row 18 additionally contains an explicit failure on its memory-growth third, and
row 1 cannot pass while rows 2, 4 and 18 do not.

## Honesty disclosures

- **Build mode.** All browser evidence comes from a production `vite build`
  served by `vite preview`, not from the dev server. The probe records
  `buildMode: "production"` itself.
- **Frame-time quantization.** The evaluator carries the caveat that
  `requestAnimationFrame` is quantized to the display refresh, so a 60 Hz median
  of ~16.67 ms would mean "no frame dropped", not "measured headroom" — the
  dropped-frame ratio is the discriminating number. This caveat is implemented
  and unit-tested even though F3 meant no frame time was ever recorded.
- **Heap claim is bounded.** `performance.memory` reports the JS heap only, with
  no way to force a collection from page script; native GPU and decoded-texture
  retention are invisible. The verdict type says so in a `boundedClaim` field.
- **Viewport.** 1097 × 894 CSS px, not 1440p-class. Every scale-dependent row is
  marked partial.
- **Pointer input.** Picking used script-dispatched pointer events into the real
  Cesium canvas, because the embedded tab takes no OS focus. The pick pipeline is
  the product's own; the input is not OS-level.
- **Oblique path.** Introduced only after F2, carries a mitigation note in its
  own fixture, and never substitutes for the level facade criterion.

## Why this task touched `src/`

T009's declared touch surface is docs, scripts and public data. Four `src/`
additions were nevertheless required, because without them the corresponding
criteria could only have been asserted, not measured:

| Addition | Why a measurement needs it |
| --- | --- |
| `src/runtime/block835-canary-probe.ts` | The Goal's **absolute** budgets have no evaluator. `block835PerformanceGate` encodes a different contract (Stage 3 overlay-vs-control, 12/30 ms, +20 % regression) and the Stage 3 probe refuses exterior scenes by design. Both are left **byte-unchanged**; this is a sibling on its own condition axis. |
| Probe effect in `src/app/App.tsx` | Frame time, cache bytes, measured peak concurrency and JS heap can only be sampled from inside the running app. Gated on `import.meta.env.VITE_BLOCK835_PROBE === "1"`; verified tree-shaken from a normal build (0 occurrences of `block835CanaryPerformance` in the default bundle). The existing `import.meta.env.DEV` guards were not weakened. |
| `src/runtime/exterior-cell-fault.ts` | The isolated-failure journey needs a fault that mutates **no** release byte. It mirrors `createExteriorPilotFaultFetcher`: cloned response bodies only, same-origin `/data/` paths only, rejected cross-origin unconditionally. |
| `src/vite-env.d.ts` | Types the new build-time flag. |

Deviation from the frozen architecture, recorded rather than hidden: the private
partition exclusion was specified "via Vite config". `vite.config.ts` is compiled
by `tsconfig.node.json`, which has no `@types/node`, so `node:fs` there does not
type-check and adding a dependency was out of scope. The correction is instead
`scripts/prune-private-partitions.mjs`, wired as the last step of `pnpm build` —
same outcome, same narrow scope, inside T009's declared `scripts/` surface.

The canary probe also uses its own query parameter
(`?block835CanaryPerformance=…`) instead of extending the Stage 3
`block835Performance` union, so the Stage 3 parse function and effect stay
literally byte-identical.

## Gates

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | Pass |
| `pnpm lint` | Pass, 0 problems |
| `pnpm test` | Pass — **65 files, 605 tests** (baseline before this task: 61 files, 551 tests) |
| `git diff --check` | Clean |
| `pnpm build` (default) | Pass; probe absent from the bundle; 2 private partitions pruned |
| `VITE_BLOCK835_PROBE=1 pnpm build` | Pass; probe and both camera-path fixtures present |
| Partition audit, harness `dist/` | F1 pass after correction (0 private paths / 1478 files); F2 release-data 0, vendor-runtime 2 |
| Facade path re-derivation | 8 poses, closest camera-to-facade 13 m, every pose ≥10 m |
| Predecessor checksums | 14/14 verified against 20260810 bytes, 0 mismatches |
| Assembly artifact checksums | 29/29 verified against bytes on disk |
| Blender evidence inventory | `artifacts/blender/` is not present in this worktree (it was worktree-local to ccp-9), so the 133 inner hashes are carried forward as committed evidence and the inventory's own integrity was verified instead: `data/manhattan-esb-block-reference-20260811/blender-evidence-inventory.json` = `9dce17ae67f817553548915509fa57d8df8d0481e3c53ed92297b3f934fd5125`, 133 files, and its recorded `.blend` hash `1594a29e…` matches the T008 record. |

## What this validation does not claim

It does not claim the Block 835 canary meets the Goal's facade-viewpoint
criterion — at a level camera it renders nothing (F2). It does not claim any
frame-time budget is met or missed, because no honest frame time was obtainable
(F3). It does not claim retained memory is stable across repeated paths. It does
not claim 1440p-class behaviour, mobile behaviour, real keyboard traversal, or
reduced-motion behaviour. It does not claim default activation works — that is
T010.

What it does establish is that the canary's identity, provenance, partition,
checksum, rollback, opt-in, isolated-failure and disable behaviour hold up under
a real production build in a real browser, and that two genuine defects (F1, F2)
existed behind a fully green 605-test suite.

## Recommended next actions

1. Fix F2 before promotion. Bound the shallow-pitch ground-ray footprint and
   always retain the shard containing the camera's sub-point regardless of
   eviction pressure. Both halves are unit-testable without a browser, and F2
   currently blocks the single criterion the canary exists to prove.
2. Re-run rows 2, 4 and 18(memory) on a focusable 1440p-class desktop browser.
   The harness is built, gated and tested; it needs an environment that grants
   `document.hasFocus()`.
3. Decide whether the 20260810 `private/` bytes should remain under `public/` at
   all. The build-output prune closes the browser-reachable path, but the source
   tree still stores a private partition inside the public root.
4. Treat row 3 (mobile lower-LOD disclosure) as an unstarted Goal obligation.
