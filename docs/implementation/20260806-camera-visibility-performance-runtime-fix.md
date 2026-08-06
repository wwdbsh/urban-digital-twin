# Camera, viewport visibility, and renderer lifecycle repair (2026-08-06)

## Scope

This work unit repairs the Cesium runtime seam used by the local citywide and
civic releases. It does not change any immutable release payload, public data,
manifest, provenance claim, GLB package, provider, renderer family, or the
Stage 3 storefront proof semantics.

## Root causes addressed

1. The release runtimes inferred a rectangle from the aerial camera position,
   while the renderer independently clipped dense geometry with a Cesium view
   rectangle. Oblique views could therefore intersect two different windows and
   leave a diagonal band or no dense geometry.
2. Repeated camera callbacks could refresh or abort equivalent release work,
   and the viewer lifecycle was coupled to changing React props during a data
   mode transition.
3. Dense rendering cleared app-owned geometry and rebuilt a full synchronous
   primitive before a replacement was ready.

## Implementation

- `viewport-footprint.ts` defines one dateline-aware `ViewportFootprint` and
  refresh request. Cesium samples center, corners, and edge midpoints with
  globe pick rays; a view rectangle is a fallback and the last valid ground
  footprint is retained through a temporary all-miss state.
- Citywide, travel-context, and composed adapters consume that same footprint
  for shard intersection and ground-center ordering. They deduplicate active
  and committed refresh signatures before aborting a prior waiter.
- `CesiumViewport` emits runtime work on settled `camera.moveEnd`, applies an
  individual programmatic request only once, and keeps viewer creation scoped
  to component mount/unmount. This prevents the normal Fixture to Citywide
  transition from destroying and recreating the viewer due to prop identity.
- Dense selection uses the same footprint. A render plan is reused only when
  every immutable feature reference is unchanged; an ID-only match can no
  longer hide an updated geometry, detail, or content record. Changed content
  is allocated in 120-feature animation-frame slices, grouped into 1,500-
  instance asynchronous Cesium primitives, and atomically swaps only the
  component-owned child layer after it is ready.
- Flat citywide massing requests Cesium's `VertexFormat.POSITION_ONLY`, the
  minimum format compatible with `PerInstanceColorAppearance({ flat: true })`.
  This avoids generating unused normal, texture, and tangent attributes for
  every procedural building.
- The dense-plan fingerprint is now compact and linear instead of sorting and
  joining all features on every effect. Local diagnostics expose plan build,
  reuse, cancellation, and swap counts plus selection, fingerprint, allocation,
  worker-ready, and total timing phases. The civic group-limit object is stable
  across unrelated React updates, so these diagnostics cannot cause a viewport
  effect feedback loop.
- A selected building or POI is now an owned semantic overlay rather than a
  dense-plan input, so changing selection does not rebuild the unchanged
  citywide primitive set.
- Native controller bindings are explicit: primary drag rotates/orbits,
  middle or Ctrl+primary drag tilts, Shift+primary free-looks, and right drag,
  wheel, or pinch zooms.

## Deterministic verification

Completed after the final source change:

```text
pnpm exec vitest run src/runtime/viewport-footprint.test.ts \
  src/features/explorer/CesiumViewport.test.ts src/app/App.test.tsx \
  src/runtime/citywide-release-runtime.test.ts \
  src/runtime/travel-context-release-runtime.test.ts \
  src/runtime/composed-release-runtime.test.ts src/runtime/tile-stream.test.ts
7 files / 77 tests passed

pnpm typecheck  passed
pnpm lint       passed
pnpm test       38 files / 230 tests passed
pnpm build      passed (existing Vite >500 kB bundle-size advisory only)
```

The focused tests cover oblique/zoom-out ground bounds, last-valid fallback,
antimeridian wrapping, runtime request dedupe, composed forwarding, one-time
camera requests, native controller bindings, stable dense plans, and wrapped
dense filtering.

Release checks completed without modifying any release payload:

| Check | Result |
| --- | --- |
| `pnpm citywide:validate` | Passed; 45,194 buildings, 103 geometry shards, and 304,382,520 declared bytes validated. |
| `pnpm citywide:benchmark` | Passed; cold/warm search p95 `16.82` / `16.41 ms`, cold/warm pick p95 `4.97` / `2.69 ms`. |
| `pnpm exterior-pilot:validate` | Passed; 14 assets, 28 LOD assets, and 8 accepted signs. |
| `pnpm exterior-pilot:benchmark` | Passed; `2,457,444` bytes and its recorded frame-time evidence status is `pass`. |
| `pnpm travel-context:validate` | The literal bare command exits `1`: its existing CLI requires `--root`; no package-script/config change was in scope. |
| `pnpm travel-context:benchmark` | The literal bare command has the same existing `--root` contract failure. |
| README-documented travel-context commands with `--root public/data/manhattan-civic-context-20260804` | Both passed; validation measured `22,424,795` bytes and benchmark passed with cold/warm search p95 `11.23` / `10.39 ms`, cold/warm detail p95 `0.30` / `0.27 ms`. |

`git diff --check` passed after the final documentation update.

## Browser replay evidence

Environment: existing user-owned Vite server at `localhost:5173`, Chromium
WebGL, and exactly one Orca browser tab at a time. The available desktop host
surface was `1097 x 899` CSS pixels at DPR `2`; Orca did not expose an
arbitrary `1440 x 900` desktop preset, so that exact requested size is not
claimed. No server was started, stopped, or restarted.

- Native canvas input from the default overview changed the settled URL from
  `(-73.991000, 40.744000, 4000 m, -75 deg)` to approximately
  `(-73.990284, 40.741491, 3968.6 m, -70.995 deg)` after the same primary,
  middle, and right-pointer sequence. This directly proves horizontal orbit
  and vertical tilt; the controller's right-drag/wheel/pinch zoom contract is
  unit-tested. Isolated right-drag attempts on this Orca surface did not
  produce an additional URL delta, so a fresh isolated browser zoom proof is
  not claimed.
- The normal UI path **Data -> Fixture catalog -> Citywide local release**
  completed with the React tree, Cesium canvas, citywide label, and source
  panel intact. Searching and selecting Empire State Building rendered the
  sourced `doitt:778052` details and provenance; returning to Overview at
  `4000 m` retained `6,000 / 6,000 / 4` dense features/instances/primitives.
- The desktop and mobile replays had no runtime console errors. Network capture
  showed local app-origin release, worker, and GLB requests with status `200`;
  no failed release or GLB request was observed.
- The iPhone 14 preset produced the representative `390 x 844` CSS-pixel
  surface at DPR `3`; its canvas was `390 x 746` and document width equalled
  client width (`390`), so no horizontal overflow occurred. Orca accepted the
  reduced-motion request, but `matchMedia` still returned false, so forced
  reduced-motion behavior is an environment limitation rather than a pass.

## Frame-pacing evidence

The root-cause pass used the same existing machine/browser and citywide URL.
Each final run reset to Overview, waited for full dense readiness, then used
the same small native primary-orbit, middle-tilt, and right-pointer sequence;
the observer recorded only long tasks delivered during that run (not buffered
page-load tasks). The prior three samples below are the immediately preceding
400-feature/one-primitive-per-chunk implementation, so the command envelopes
are not byte-for-byte identical (`~16 s` before versus `~13 s` after) and are
reported as a bounded comparative signal rather than a laboratory benchmark.

| Run | Duration / rAF count | rAF avg / median / p95 / max (ms) | Long tasks (count / total / max ms) |
| --- | --- | --- | --- |
| Pre-root 1 | 16,608.0 / 257 | 63.9 / 10.3 / 199.7 / 1008.4 | 10 / 1649 / 316 |
| Pre-root 2 | 16,088.7 / 16 | 1005.2 / 1008.0 / 1008.4 / 1008.4 | 39 / 10253 / 2187 |
| Pre-root 3 | 16,015.3 / 157 | 102.0 / 15.8 / 1006.7 / 1008.6 | 60 / 14803 / 2187 |
| Final 1 | 12,966.6 / 264 | 37.8 / 9.9 / 183.1 / 1008.4 | 5 / 1451 / 413 |
| Final 2 | 13,234.7 / 211 | 47.3 / 10.0 / 183.4 / 1008.4 | 4 / 1400 / 423 |
| Final 3 | 13,332.8 / 199 | 45.4 / 15.5 / 34.3 / 1007.7 | 4 / 1494 / 471 |

The final traces remove the prior pathological B/C tail: p95 is at most
`183.4 ms` instead of `1006.7--1008.4 ms`, and B/C long-task totals fall from
`10.25 / 14.80 s` to `1.40 / 1.49 s` (about `86% / 90%` lower). A one-second
maximum remains an Orca/browser scheduling outlier, but it no longer controls
the p95 or long-task total. Dense telemetry at settled desktop/mobile points
showed `6,000` instances in four building primitives, allocation slices at or
below `3.3 ms`, and retained active geometry until worker readiness; no
clear-before-ready replacement was observed during the replay.

## Rollback boundary

All changes are confined to the React/Cesium viewport, app callback seam, and
runtime selection code. Reverting this work unit means reverting only its new
hunks; it must not reset the pre-existing Stage 3 hunks, transit research, or
untracked artifacts.
