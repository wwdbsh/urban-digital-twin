# Manhattan civic runtime composition implementation record

Date: 2026-08-05 (Asia/Seoul)
Status: Root Sol High review accepted; delivery authorized
Rollback: `77aab1a3835c22ff314ba824a9b5893535148984`

This record covers work unit 2 only: composing the existing immutable civic
context over the existing immutable citywide release in the current civic mode.
It does not create or alter a release and does not change the canonical URL
shape.

## Release identity and immutable proof

| Role | Exact release | Manifest SHA-256 |
| --- | --- | --- |
| Base citywide | `manhattan-citywide-20260804` | `acb5a9b52014f86535c8478e7d4e516efc03f6dff95c17e9896dfea4413c203c` |
| Civic context / canonical URL root | `manhattan-civic-context-20260804` | `225aba4efb041b26c38932b265f927373ec8974f0fb4a5e63e34baefd07da2a2` |

The civic manifest's `baseReleaseId` is exactly
`manhattan-citywide-20260804`. The browser remains local-only and requests
only app-origin static files; no provider, credential, fee, external data
acquisition, public deployment, Blender state, or dependency was added.

The immutable manifests were inspected before and after the implementation;
no new release directory or manifest was created. The pre-existing dirty
transit research note and `artifacts/**` were preserved and excluded.

## Implementation

`src/runtime/composed-release-runtime.ts` provides the provider-neutral runtime
composition. It validates the exact civic/base identity, merges base/context
features with collision failure, preserves feature origin, routes known cold
IDs by release prefix, probes both child indexes only for otherwise unknown
IDs, owns one viewport/search generation and abort path, delegates layer loads,
and exposes child plus aggregate metrics. `AggregateRequestBudget` is injected
into both existing child request pools, while a namespaced shared LRU prevents
cross-release content-reference collisions without changing payloads.

`App.tsx` activates the composition only after both immutable roots validate and
match. Civic URLs keep `data=manhattan-civic-context-20260804` and
`release=manhattan-civic-context-20260804`; a selected `doitt:`/`dohmh:` parent
still displays the citywide origin release and cold-loads through the pinned
base. Civic root failure falls back only to a validated standalone citywide
mode with a rewritten truthful citywide URL; base-root failure and mismatches
remain fail-closed fixture fallback. Development-only `travelFault` seams
exercise root and layer failure behavior without touching immutable data.

The composition borrows the separately owned child adapters. Its `destroy()`
aborts only composition-owned viewport/search work, so React StrictMode cleanup
can recreate the composition around the still-live children without producing
an empty viewport; a direct regression test covers this lifecycle contract.

`CesiumViewport.tsx` accepts role-grouped dense features. It filters each group
by the active layer visibility, selects deterministic camera-near base/context
groups under independent caps, collision-checks the combined pick map, draws
base geometry before context, and appends selected feedback last. Source WGS84
geometry is not offset or rewritten.

The safe `DEFAULT_CAMERA_POSE` is a steep `-75°` overview so a bare civic
canonical URL centers the Manhattan massing; Explore remains the explicit
oblique `-35°` pose. No-pose navigation starts in `overview`, while an explicit
URL `view` or pose remains authoritative and is serialized back deterministically.
The first Cesium request is issued from the normalized URL pose or this default
as soon as the viewer is ready. Ordinary dense POI markers are bounded to a
small 5px treatment (with 6px ordinary context points) and the selected marker
retains the larger highlighted treatment. The runtime note has a fixed-height
single-line ellipsis lane; full release identity remains in the footer, Data
surface, and accessible DOM text.

## Release facts and runtime measurements

The citywide manifest declares 45,194 building parents, 12,439 restaurant
parents, 103 geometry shards, 214 search shards, 134 detail shards, and 57,633
detail-index entries (`304,382,520` declared bytes). The civic manifest declares
38 statistical areas, 395 Parks parents, 1,140 LPC parents/1,130 placed parts,
114 geometry shards, 307 search shards, 52 detail shards, and 1,573
detail-index entries (`22,424,795` declared bytes).

The composition's observable limits are:

| Metric | Limit | Browser evidence |
| --- | ---: | --- |
| Shared cached shard entries | 24 | fresh civic page displayed `24` |
| Shared declared cached bytes | 50,331,648 (48 MiB) | fresh civic page displayed `9,541,735`–`14,666,885` |
| Aggregate active shard requests | 4 | fresh civic page displayed `0` settled; code/test semaphore peak is 4 |
| Base dense render group | 6,000 | diagnostics displayed `6,000` before layer filtering |
| Civic context render parts | 128 | diagnostics displayed `128` before layer filtering |
| Focused 1440×900 frame median / p95 | ≤33.3 / ≤50 ms | 1,158 samples after 3-second settle: `8.3` / `10.3` ms |

The selected feature is permitted outside its group's bulk cap and remains
pickable. A layer-filtered run reduced the base/context groups to `111 / 85`
while retaining the independent caps. A Parks fault run displayed
`Degraded layers isolated: parks` without disabling citywide or other civic
layers.

## Automated checks

The focused composition/domain/Cesium command passed; the final repository
suite passed all 31 discovered test files (187 tests), including the lifecycle,
stale-refresh, default-camera-mode, and marker regressions. The exact required
final commands are:

```sh
pnpm typecheck
pnpm test -- --run
pnpm lint
pnpm build
pnpm citywide:validate
pnpm citywide:benchmark
pnpm travel-context:validate -- --root public/data/manhattan-civic-context-20260804
pnpm travel-context:benchmark -- --root public/data/manhattan-civic-context-20260804
git diff --check
shasum -a 256 public/data/manhattan-citywide-20260804/manifest.json public/data/manhattan-civic-context-20260804/manifest.json
```

Final results after the last code and documentation changes:

| Check | Result |
| --- | --- |
| `pnpm typecheck` | pass |
| `pnpm test -- --run` | pass, 31 files / 187 tests |
| `pnpm lint` | pass |
| `pnpm build` | pass; Vite emitted only the existing >500 kB chunk advisory |
| `pnpm citywide:validate` | pass; 452 files, 304,382,520 declared/measured bytes |
| `pnpm citywide:benchmark` | pass; 30 fixed queries, exact no-result samples zero, cold search p95 16.3497 ms, cold pick p95 4.9046 ms |
| civic validate / benchmark | pass; 22,424,795 bytes, 45 fixed queries, 30 details, `pass=true` |
| `git diff --check` | pass |
| immutable manifest hashes | pass; exact hashes recorded above |

The final handoff also includes the protected-path review against the allowed
work-unit list; no public data/assets, provider, dependency, script, Blender,
credential, deployment, transit research note, or artifact was changed.

## Fresh Orca browser evidence

Evidence summary and page-scoped checks are retained at
`/tmp/urban-digital-twin-composition-browser-evidence.md`; transient snapshots
are in `/tmp` only. Pages used for fresh checks included:

| Journey | Result |
| --- | --- |
| Civic desktop cold view | Canonical civic URL showed both exact release IDs in status/footer/Data; 24-entry aggregate cache and 6,000/128 diagnostics were visible. |
| Mixed search/detail | `MN6491`, `M001`, `LP-00006`, and `doitt:103646` returned typed results and exact IDs; citywide detail retained `origin release manhattan-citywide-20260804`, civic details retained civic origin. `Central Park` showed mixed NTA, Parks, LPC, and base-building results capped at 8. |
| Cold base deep link | Fresh civic page with `feature=doitt:103646` loaded the exact citywide parent while retaining civic URL root and composition footer. |
| Civic root fault | `travelFault=civic-root` rewrote to truthful standalone citywide mode and URL. |
| Base root fault | `travelFault=citywide-root` stayed fixture-only with no civic label or same-name substitute. |
| Civic layer fault | `travelFault=parks-geometry` kept composition active and reported isolated Parks degradation. |
| Canonical no-pose overview | Fresh page `5767d0be-3a5c-4318-9a96-3eac829c4a06` rewrote the bare civic URL to `view=overview`, highlighted Overview, applied `pitch=-75`, showed centered massing, and retained the ellipsized runtime lane. |
| Layers/facets | Civic layer controls exposed only Buildings, Points of interest, Statistical areas, Parks, and Landmark records; unsupported fixture transit/route controls were absent. Base/context dense groups responded independently to layer state. |
| Mobile | Fresh 390×844 page had `scrollWidth=clientWidth=390`; civic search/selection and details remained available with no horizontal overflow. |
| Reduced motion | Runtime camera code and CSS retain the reduced-motion branch; Orca's `set media` command reported success but `matchMedia('(prefers-reduced-motion: reduce)')` stayed false in this environment, so no forced browser claim is made. |
| Console/network | Page-scoped console was empty on the fresh cold deep-link page; local app-origin static release URLs were used. |

The reduced-motion control limitation is an environment observation, not a
product substitution. The implementation still uses the existing
`prefers-reduced-motion` branch and deterministic tests; Root should decide
whether an environment that cannot expose the media emulation is sufficient
for the final acceptance record.

## Known limitations

- Procedural citywide footprint/height massing is not real facade imagery,
  textures, roofs, interiors, entrances, or photorealistic building models.
- Civic records are dated snapshot-relative source geometry/metadata and do
  not claim complete neighborhoods, current park access/hours/amenities, legal
  survey accuracy, attractions, or facade/photo/model fidelity.
- The composition remains local JSON/shard streaming, not a deployed 3D Tiles
  service or public city host.
- Orca's reduced-motion media emulation could not be observed through
  `matchMedia` despite the CLI reporting success; no unsupported claim is made.
- A full repeated seven-anchor heap comparison requires the established
  citywide harness and was not silently inferred from the composition frame
  probe; cache/request/render caps and the direct 10-second frame probe were
  measured instead.

## Scope and delivery authorization

Root Sol High accepted the implementation and authorized delivery as one
documentation-complete commit on `main`. No immutable release, provider,
dependency, lockfile, data, asset, Blender state, script, credential, or
protected transit research file was changed; the pre-existing transit note and
`artifacts/**` remain user-owned and outside the delivery set.
