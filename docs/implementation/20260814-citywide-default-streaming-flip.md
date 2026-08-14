# T006 — the citywide default flip

Date: 2026-08-14 · Issue #71 · ADR: `docs/decisions/0045-citywide-default-streaming-flip.md`

Two independently rollback-able commits. Step 1 fixed and instrumented the
renderer and the notice behind the opt-in flag and was measured; Step 2 flipped
the default only after those measurements came in inside the fixed budgets.

## Step 1 — `0374005`

| file | why |
| --- | --- |
| `src/features/explorer/CesiumViewport.tsx` | D-2 via show-attribute suppression; the `featureId -> Primitive` index; `denseRenderPlanDelta`; the four unconditional double-draw timestamps; the two flip counters; `denseSuppressedInstanceCount` |
| `src/features/explorer/CesiumViewport.test.ts` | the trigger taxonomy, pinned in both directions |
| `src/app/App.tsx` | the notice population split; the metrics equality gate extended so a flip-served crossing is not invisible |
| `src/app/ExteriorFallbackNotice.tsx` | three populations; `dismissalKey` keyed on release facts only |
| `src/runtime/exterior-wave-attribution.ts` | fixed-scope not-shipped summary; the deferred and evicted sentences |
| `src/runtime/exterior-cell-runtime.ts` | `declaredNotShippedCellCount()` — the release-scoped numerator |

## Step 2 — `bd71a1a`

| file | why |
| --- | --- |
| `src/app/App.tsx` | `EXTERIOR_SCHEDULER_DEFAULT_ON`; the URL polarity inversion; the B2 split; the F2/F3 citywide gates |
| `src/app/App.test.tsx` | the inverted URL contract, the rollback constant, the split hatches |
| `src/runtime/exterior-cell-scheduling.test.ts` | the B4 mirror, recorded honestly as content-stable and not reference-identical |

## Campaign — `scripts/citywide-default-flip-campaign-cli.mjs`

```
node scripts/citywide-default-flip-campaign-cli.mjs vsync    --port 9222
node scripts/citywide-default-flip-campaign-cli.mjs stations --dev http://localhost:4212 --port 9222 --arm default
node scripts/citywide-default-flip-campaign-cli.mjs crossing --dev http://localhost:4212 --port 9222
node scripts/citywide-default-flip-campaign-cli.mjs stations --dev … --arm dense-only
node scripts/citywide-default-flip-campaign-cli.mjs stations --dev … --arm rolled-back
node scripts/citywide-default-flip-campaign-cli.mjs control  --dev … --radius 1200
```

Evidence: `data/citywide-default-flip-20260814/`.

## Notes for a successor

- **The preview server must be your own.** A leftover `vite preview` from the
  T005 worktree still held port 4211 and served a *different worktree's* bundle;
  the first station run measured that bundle and timed out on a probe the build
  did not contain. The served-bundle hash is what caught it. Bind your own port.
- **Headful means foreground.** Chrome throttles background tabs: rAF is clamped
  and compositing stops, so a capture taken in a background tab measures the
  throttle. Every capture calls `Page.bringToFront`.
- **The first crossing pose was wrong and the data said so.** Six 180 px drags
  from a 6 km camera carried the camera off Manhattan: the plan ended at 25
  buildings, which measures a departure and not a crossing. Four 40 px drags
  from the 52 km overview keep the island plan resident.
- **Anchoring only the notice denominator made it worse**, and it took a live
  capture to see it: "11 of 149" at a street camera asserts that 138 declared
  cells ship geometry. Both terms come from the release now.
