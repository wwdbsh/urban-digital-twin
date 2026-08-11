# 2026-08-11 — Midtown-core exterior wave promoted to the default (T014, Issue #15)

Decision record: `docs/decisions/0030-multi-wave-exterior-default-activation.md`.
Predecessor wave: `docs/implementation/20260811-midtown-core-canary.md`.
Prior promotion: `docs/implementation/20260811-block835-promotion.md`.

Landed in two commits on purpose: a behaviour-neutral generalization to an
ordered promotion set containing only Block 835, then the Midtown record and its
evidence.

## What changed

| File | Purpose |
| --- | --- |
| `src/runtime/exterior-default-activation.ts` | Ordered promotion set; per-record refusal, restore, pin and identity rules; set-level resolver with the two URL rules; digest membership form; Midtown record. |
| `src/runtime/exterior-multiwave-activation.test.ts` | New. One-record behaviour-neutrality proof, per-wave rules, shipped-set behaviour, disjointness. |
| `src/runtime/exterior-midtown-promotion-record.test.ts` | New. Never-skipped drift gate against the committed payload inventory. |
| `src/runtime/exterior-cell-fault.ts` | New wave-agnostic per-asset fault seam, harness-gated. |
| `src/runtime/exterior-asset-fault.test.ts` | New. Seam validation and isolation. |
| `src/runtime/block835-canary-probe.ts` | Probe target parameterized by wave + camera path; forced-collection heap claim. |
| `src/runtime/midtown-core-canary-facade-path.ts` | New. Footprint-framed Midtown camera path derived from committed base bytes. |
| `src/features/explorer/CesiumViewport.tsx` | Overlay SET; entry-level release attribution; attribution in the cell signature. |
| `src/features/explorer/exterior-overlay-attribution.test.ts` | New. Entry-level attribution across waves. |
| `src/app/App.tsx` | Per-release runtimes, gated loads, shared cache, per-wave notices/status/unavailable, selected-feature attribution, per-release cell loads, set-level deep-link refusal. |
| `src/app/exterior-multiwave-deep-link.test.ts` | New. Per-wave deep-link refusal regression. |
| `src/app/App.test.tsx` | One superseded T013 expectation rewritten (below). |

No release byte changed. `git diff --stat` over `public/data/` and `data/`
against the task base commit `5e5ea00` is empty — the graph stage did not
re-emit, and the Midtown payload is byte-identical to the canary that was
approved.

## Existing-test changes

Exactly one, and it is the promotion itself:

- **`App.test.tsx` — "issues no midtown-core request in a default session, so
  the canary stays strictly opt-in"** asserted the T013 premise that a default
  session must issue ZERO midtown requests. Promotion reverses that premise by
  definition. Rewritten as "streams the whole promoted set in a default session,
  naming each wave", which keeps what the test was actually protecting: a
  default session streams exactly the promoted set, each wave announces itself
  by name, and no exterior parameter is serialized. Every other assertion in the
  file is untouched.

Notice qualification became unconditional in the same change (`Exterior release
<id>: <notice>`). No existing assertion depended on the unqualified strings, so
that switch changed no existing test.

## Two-phase landing

Phase 1 generalized the singular record to an ordered set containing exactly the
one Block 835 record, with a stated acceptance bar: every existing test passes
unchanged. It did. The neutrality proof is kept as a permanent test — over the
full URL matrix (4 overrides x 4 explicit-release values x 2 base states) the set
resolver over a ONE-record set is byte-equal to the single-record resolver, and
`exteriorUnavailableStatements` returns exactly what `exteriorUnavailableDetail`
returned.

Two compatibility shapes exist because of that bar and are recorded here rather
than hidden: the ordered set is composed through a function taking the per-wave
records as parameters (so a build or rehearsal that swapped a record orders the
record it holds), and the viewport prop accepts one overlay or an ordered set.

## Defect found and fixed during journey validation

The first cold-load journey away from both waves showed Block 835's cell failing
with `request-failed` after exactly one asset, while Midtown loaded normally.
The same camera with `exteriorCells=manhattan-exterior-cells-20260811` (Block 835
alone) loaded all 14 assets cleanly, which isolated it to wave interaction.

Cause: the cell-loading effect used one effect-scoped `AbortController` and
re-ran whenever ANY wave changed state. The moment the second wave finished
loading its index, the effect cleanup aborted the first wave's in-flight asset
requests, and that wave's cell failed closed with a request error it had no
reason to have.

Fix: cell loads are keyed by release and outlive the effect run that started
them. A load is cancelled only when its OWN inputs change — its runtime, the
render profile, or the camera LOD bucket — or when the component unmounts. After
the fix the same journey loads 17 Block 835 requests and reports no verification
failure. This was a two-wave-only defect; it could not occur while one wave was
promoted, which is why Phase 1's neutrality bar did not catch it.

A second gap surfaced in the rollback journey: `exteriorDeepLinkMessage` still
evaluated the rolled-back refusal against a single record, so a bookmark into a
withdrawn SECOND wave was accepted in silence while the resolver refused to
stream it — the link rendered nothing and said nothing. It now checks the whole
set, with a regression test.

## Validation evidence

Production build (`VITE_BLOCK835_PROBE=1` for the harness), served by
`vite preview`, driven through CDP in desktop Google Chrome launched with
`--js-flags=--expose-gc` and a fresh user-data-dir, `Page.bringToFront` before
every sample. `window.gc` was available in both runs, so the heap claim is made
against COLLECTED heap.

### Frame time, concurrency, cache, memory — Midtown facade path

| Measure | Exploration | Inspection | Budget |
| --- | --- | --- | --- |
| Median frame interval | 8.30 ms | 8.30 ms | 16.7 / 33.3 ms |
| p95 frame interval | 10.00 ms | 10.20 ms | 25 / 45 ms |
| Max | 10.50 ms | 10.40 ms | — |
| Settled samples | 1920 | 1920 | — |
| Display interval / dropped-frame ratio | 6.8 ms (147 Hz) / 0.031 | 6.7 ms (149 Hz) / 0.058 | — |
| Peak concurrent requests (measured) | 4 | 4 | <= 8 |
| Peak combined exterior + base cache | 15.9 MB / 174 entries | 15.4 MB / 160 entries | <= 256 MiB / 256 |
| JS heap after forced GC, per repeat | 172.2 / 137.3 / 138.1 / 138.2 MB | 169.3 / 135.5 / 136.4 / 136.4 MB | no monotonic growth |
| Heap growth ratio (2nd half vs 1st) | −0.107 | −0.105 | <= 0.10 noise band |
| Console / window errors | none | none | none |
| Network hosts | localhost only | localhost only | local-only |

The Midtown release ships a single LOD (`lod_0`) for all 160 buildings, so the
exploration and inspection profiles resolve the SAME asset. The profile axis is
therefore a label, not a different scene, and the ~0.2 ms p95 difference is
noise. Both budgets are measured and reported because both are claimed.

The camera path (`src/runtime/midtown-core-canary-facade-path.ts`) is
FOOTPRINT-framed, not plan-framed: Block 835 ships per-building tier-0 facade
plans and its path is framed against them, and the Midtown release ships no
equivalent, so the framing half-extent comes from the citywide base footprint
bounding box. Each pose records the base shard and its SHA-256. It is committed
as source rather than under `data/` because the promotion's immutability gate
requires `data/` and `public/data/` to be byte-identical to the pre-promotion
tree.

### Cold-load cost, camera away from both waves

Default session at the lower-Manhattan pose (lon −74.014, lat 40.703, 1200 m):

| Measure | Value |
| --- | --- |
| DOMContentLoaded / load | 392 ms |
| Both wave status lines present | 1.24 s |
| Block 835 exterior requests / bytes | 17 / 573 KB |
| Midtown-core exterior requests / bytes | 97 / 11.0 MB |
| Base release requests / bytes | 12 / 2.38 MB |
| Total requests in the page | 250 |

Measured at 46 s of settling. The Midtown figure is what the session had
requested in that window, not the full wave: the settled full-wave ceiling
observed in the probe runs is 160 assets / 15.39 MB. No scheduling or
prioritization work was done here; it is deferred to the ADR-0024 follow-up.

### Renderer journeys — production build, desktop Chrome via CDP

| Journey | Outcome |
| --- | --- |
| Default cold load over the real base, camera at Block 835 | Both waves stream, each with its own status line naming its own snapshot; URL carries no exterior parameter; details attribute the selected ESB building to `manhattan-exterior-cells-20260811`. |
| Default cold load, camera at Midtown | Both waves stream; the same panel attributes the selected Midtown building to `manhattan-midtown-core-cells-20260811`, cell `manhattan-exterior-cell-w01-000001-14-4823-4482`, asset `lod_0`. |
| Cross-release pick/details round-trip, ONE session | Midtown building selected first names the Midtown release/snapshot/cell; selecting the ESB building afterwards flips the panel to the Block 835 release/snapshot/cell; both waves keep streaming. |
| Aggregated tombstone attribution | "Exterior release manhattan-midtown-core-cells-20260811: 146 of 149 exterior cells ship no exterior geometry in this release; no substitute was selected for them." |
| Anchor residency | Camera at Block 835: 102 verified Midtown buildings withheld with an explicit by-identity notice. Camera away from both: 174 (14 + 160) withheld. Camera at Midtown: none withheld for that wave. |
| Per-wave rollback (Midtown predecessor injected, rebuilt) | Block 835 stays default-on and renders; ZERO Midtown requests; the details panel shows BOTH an Unavailable section naming `manhattan-midtown-core-cells-20260811` and the active Block 835 provenance section. |
| Rolled-back Midtown opt-in link | Refused with its own notice naming the Midtown wave; zero requests for either release (the link selects Midtown ALONE, and Midtown is withdrawn). |
| `exteriorStreaming=off` | Kills both waves: zero exterior requests, no wave status line, one deduplicated unavailable statement. |
| Disable then Enable | Disable writes `exteriorStreaming=off` and drops both waves; Enable restores the FULL set (both waves) with no `exteriorCells` pinned. |
| Per-asset fault isolation (`?exteriorAssetFault=doitt-1294316__lod_0.glb`) | The owning Midtown cell fails verification with a release-attributed checksum-mismatch notice; the other Midtown cell still renders the selected building; Block 835 keeps streaming; the base scene is intact; no unavailable section. |
| Fixture-mode session with two records promoted | Completely quiet: zero exterior requests, no status line, no unavailable section, no failure banner. |

The pre-promotion default-session equivalence journey does not apply: promotion
IS the change to the default session. Its replacement is the fixture-mode row
above plus the rewritten App test.

## Promotion criteria

| Criterion | Verdict | Basis |
| --- | --- | --- |
| 1. Frame-time budgets on the promoted scene | PASS | Exploration 8.30 / 10.00 ms and inspection 8.30 / 10.20 ms against 16.7 / 25 and 33.3 / 45, 1920 settled samples each, production build, focused and visible throughout. |
| 2. Bounded memory | PASS | JS heap sampled after an explicit `window.gc()` at every repeat did not grow (−0.107 / −0.105 against a 0.10 band). Native GPU and decoded-texture retention remain unobservable and are not claimed. |
| 3. Runtime request and cache ceilings | PASS | Measured peak concurrency 4 (ceiling 8); combined exterior cache 15.9 MB / 174 entries against 256 MiB / 256, with ONE cache shared by both waves. |
| 4. Provenance and attribution | PASS | Entry-level attribution; per-selection release/snapshot/cell/asset rows proven to flip between waves in one session. |
| 5. Fail-closed and isolation | PASS | Per-asset fault isolates one cell of one wave; the pin gate recomputes the 149-cell digest and refuses drift, an absent digest, and a truncated resolve; the identity gate refuses an identity outside the wave. |
| 6. Reversibility | PASS | Injected predecessor withdraws only the Midtown wave, refuses its promotion-era links by name, and leaves Block 835 default-on. |
| 7. Record integrity | PASS | Never-skipped drift gate recomputes the pin, the digest, the 160 identities and the stats from the committed inventory. |
| 8. No release mutation | PASS | `git diff` over `public/data/` and `data/` against `5e5ea00` is empty. |

## Review follow-up

Four review nits and one coverage gap were closed after the promotion commit:

- The shared-LRU limitation is disclosed in ADR 0030: eviction is recency-only
  with no per-wave reservation, so under future pressure a larger wave can evict
  a smaller one's entries and cause silent re-fetches. Per-wave residency policy
  belongs with the deferred cell-scheduling work under ADR 0024.
- The cell-load reconciliation effect now depends on `exteriorTargetKey`, so a
  change to WHICH releases are targeted always re-runs reconciliation.
- A wave leaving the target set drops its cell outcomes alongside its abort,
  instead of retaining a withdrawn wave's verified bytes for the session.
- `primaryReleaseId` is documented as the URL-serialization primary, NOT
  necessarily a streaming release.
- `src/runtime/exterior-wave-attribution.ts` (new) holds the per-wave
  attribution rules — which wave answers for a selection, notice qualification,
  and the bounded-availability aggregate — with
  `exterior-wave-attribution.test.ts` covering both directions of the
  cross-release selection, the ambiguous and single-wave fallbacks, and the
  tombstone line's exact shipped form. All three behaviours were mutation-checked.

Why those rules live outside `App.tsx`: a second test file that merely IMPORTS
`App` pulls its Cesium-bearing module graph into another vitest worker and
intermittently fails the pre-existing, timing-sensitive focus test "closes
details with Escape and returns focus to the located-pick trigger" in
`App.test.tsx` — measured at roughly one run in four, with a probe file whose
own body was a single trivial assertion. A trivial file that does not import
`App` does not perturb it. That existing test could not be modified under this
task's terms, so the rules were extracted rather than the test adjusted. The
extraction is recorded here because it is a real, unresolved latent flake in
that test, not a property of the new coverage.

## Probe refusal messages

The T009-era canary probe waited on "the pinned exterior-cell release", which
with two promoted waves pointed a reader at the wrong one. The probe now names
the wave it measures and the path it drives, states which releases stream by
default, and warns that `?exteriorCells=` selects a release ALONE.
