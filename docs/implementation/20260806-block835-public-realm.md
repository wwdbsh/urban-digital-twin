# Block 835 public-realm implementation

Date: 2026-08-06 (Asia/Seoul)

Release: `manhattan-esb-block-public-realm-20260806`

Approval: `approval:block835-public-realm:20260806:user-approved`

## Snapshot and normalization

The dependency-free CLI in
[`scripts/block835-public-realm-cli.mjs`](../../scripts/block835-public-realm-cli.mjs)
freezes the exact official sources and metadata under
`data/raw/manhattan-esb-block-public-realm-20260806/`, then normalizes them
under `data/normalized/manhattan-esb-block-public-realm-20260806/`.

| Semantic | Dataset / mapped view | Features | Raw SHA-256 |
| --- | --- | ---: | --- |
| Sidewalk | `vfx9-tbb6` / `52n9-sdep` | 2 | `3a13ffd3d816c15df89f3d942d58dffb5b5b9090fda28c3fc7ab9ee9e6365fb7` |
| Roadbed | `xgwd-7vhd` / `i36f-5ih7` | 8 | `900b8b3740b17eae84d838c936d006df699913be666ae7334ca0e5ca41c25ae7` |
| Pavement Edge | `x9uq-u3qs` / `vs44-rznx` | 15 | `8a41c83861de30fe24cd4271a6829bd1245466f56d0deb1b5c27544c8a4db149` |

The frozen clip is `west=-73.988311361`, `east=-73.984408373`,
`south=40.747617192`, `north=40.749932441`; its unbuffered source extent is
`west=-73.987896343`, `east=-73.984823391`, `south=40.747931601`,
`north=40.749618032`. Normalization produced 8 roadbeds, 2 sidewalks, 15
pavement edges, 15 estimated curbs, and 4 estimated crosswalks, with zero
quarantined or unaccounted source records.

## Blender and release package

Blender MCP authored the disposable metric ENU scene and clean-scene reimport
evidence in `/tmp/udt-block835-public-realm-20260806/blender/`. The reimport
report records one mesh per semantic/LOD, no forbidden building/storefront
names, zero textures/images, one material per asset, finite local vertices,
documented Z tiers, and these corrected triangle counts:

| Semantic | LOD0 | LOD1 |
| --- | ---: | ---: |
| Roadbed | 711 | 711 |
| Sidewalk | 402 | 402 |
| Curb | 8,724 | 3,000 |
| Crosswalk | 48 | 48 |

The blocker fix replaced the unsafe first-vertex fan with Blender
`mathutils.geometry.tessellate_polygon`. Exterior/interior contour winding is
made explicit, every polygon uses `step=1` (full source contour resolution) in
both LODs,
and metric tessellated area is checked against the contour-area accounting.
The regression requires `sidewalk:12380001933` to retain its one interior ring;
its expected area is `3804.136250 m²`, tessellated area is `3804.136049 m²`, and
relative residual is `5.31e-8`. The maximum observed residual is
`2.39699e-5` on thin crosswalk stripes from Blender float round-off, below the
recorded `5e-5` tolerance; a hole fill or concavity shortcut fails authoring and
release validation.

The public package is 782,088 bytes across eight GLBs (below the 1.5 MiB
budget), with zero textures/images and no more than one material per asset.
The release records 9,885 LOD0 triangles and 4,161 LOD1 triangles. The
checksum-pinned asset evidence is:

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `roadbed__lod_0.glb` | 22,864 | `cfdf935f5b9d9ee8bb6c8a315c1c8f3838e694c161f01959b6720489c616c985` |
| `roadbed__lod_1.glb` | 22,868 | `67310814648914f8685c5cfe63f85c0433a2090ecf12b92a27c766805e7dfd4b` |
| `sidewalk__lod_0.glb` | 13,292 | `ece5351bb5e000d4c1ce00fe2b805d6a2962414a07e15c62edca325dcf45a859` |
| `sidewalk__lod_1.glb` | 13,296 | `c3e6a5939481f9450e40c04bd82129d46a2a7c79e01212d1d6e3dec132f19011` |
| `curb__lod_0.glb` | 524,980 | `833ef957c648b0868579e5fb0f813bdf3bce816c68a9fb96b794a4c6547aea77` |
| `curb__lod_1.glb` | 177,240 | `7eba1c5de7d93579897443bac1ba35eba1dbbb96e73f2f1633f89a764cd80f60` |
| `crosswalk__lod_0.glb` | 3,772 | `c264ef54043e66a766304134e5055f1646c2f6eb91c7f5ffaf6ebb8f86d97f05` |
| `crosswalk__lod_1.glb` | 3,776 | `b81c422ea0c687589ab095d8901aad2c0ca6e17021f4f2af2df77e859524da46` |

`public/data/manhattan-esb-block-public-realm-20260806/release.json` pins
these hashes, bounds, LOD distances, source snapshots, claim ceilings,
triangulation regression evidence, attribution, and fail-closed fallback.
The corrected clean-reimport renders are
`renders/clean-reimport-final-overview.png` and
`renders/clean-reimport-final-near-ground.png` (plus the four face renders);
the central sidewalk/building-block void is visibly open rather than filled by
a slab.

## Runtime behavior

`src/runtime/block835-public-realm-release.ts` validates the manifest, all three
normalized data files, and all eight GLBs with SHA-256 before activation. The
loader accepts only the local app-origin release path and never falls back to a
provider. Cesium renders the four semantic assets in a local ENU frame and
adds separate semantic pick proxies; building and accepted storefront picks
retain priority. App URL/history state carries `publicRealm` and optional
`publicRealmFeature`; a disable action removes only this overlay. A request
activates only if a genuinely active compatible real base and the active Stage
3 exterior/commercial overlay are both present. A bare public-realm query,
fixture mode, a mismatched base, or an inactive exterior remains inactive with
an honest prerequisite message; the public-realm release is never used as a
self-fallback base.

Selected records show dataset/source IDs, source date, CRS/vertical datum,
claim ceiling, uncertainty, derivation, asset hash, NYC Open Data terms,
attribution, and disclaimer. Curb and crosswalk claims stay visibly
estimated/source-constrained.

## Browser evidence

The existing Vite server (PID 19129, `localhost:5173`) was used without a
restart in one external, focus-capable Google Chrome session. The canonical
normal deep link was
`/?data=citywide&release=manhattan-civic-context-20260804&exterior=manhattan-esb-block-exterior-pilot-20260805&commercial=1&publicRealm=manhattan-esb-block-public-realm-20260806&publicRealmFeature=crosswalk%3Aw33-broadway&stage3Proof=storefront-picks`.
It selected `crosswalk:w33-broadway` with its source/uncertainty details, and
the live Cesium `EntityCollection` proof scanned 14/14 active Stage 3 GLB
model entities and 8/8 active storefront proxy entities rather than trusting
status text. The controlled `publicRealmFault=release` journey rejected only
the local public-realm manifest (503), kept the exterior/buildings/storefronts
active with the same 14/8 live proof, and displayed `The public-realm overlay
was disabled; the existing base/exterior state was left unchanged.` A bare
public-realm URL displayed the prerequisite message;
back/forward returned between that safe state and the fault state. A fresh
canonical reload had no console errors (apart from Chrome's informational React
DevTools notice), and the harness observed only `localhost:5173` as a runtime
network host.

Desktop layout recorded no horizontal overflow at 1054 CSS pixels
(`documentElement` and `body` scroll widths both equalled client widths); the
responsive 400×791 CSS-pixel mobile view likewise recorded scroll width equal
to client width, with the map/details controls visible. These are bounded
external-browser layout observations, not a claim of a physical-device test.

The retained local source artifact is
`/tmp/udt-block835-public-realm-20260806/external-chrome-performance-evidence.json`;
the durable checksum-validated embedded evidence is in
`public/data/manhattan-esb-block-public-realm-20260806/benchmark.json`. In the same
Chrome browser session (`14269e6c-a236-4158-a2b9-23908ea50f89`), both the
Stage 3-only control and Stage 3-plus-public-realm overlay ran the identical
six-pose `block835-stage3-six-pose-v1` camera path at 1721×878 CSS pixels / DPR
2, settling 1,000 ms at each pose then collecting 100 `requestAnimationFrame`
samples (600 per condition). Both samples began and ended with
`document.hasFocus=true` and `visibilityState=visible`, with no recorded
console/window errors and only `localhost:5173` hosts. Control measured 8.30
ms median, 9.20 ms p95, and 24.90 ms max; overlay measured 8.30 ms median,
8.90 ms p95, and 17.50 ms max. The overlay p95 delta was -0.30 ms (-3.26%),
so all required gates passed: median ≤12 ms, p95 ≤30 ms, and p95 regression
≤20%.

## Validation commands

```sh
pnpm public-realm:validate:raw
pnpm public-realm:normalize -- --out /tmp/udt-block835-public-realm-20260806/deterministic-replay-a
pnpm public-realm:normalize -- --out /tmp/udt-block835-public-realm-20260806/deterministic-replay-b
diff -ru /tmp/udt-block835-public-realm-20260806/deterministic-replay-a /tmp/udt-block835-public-realm-20260806/deterministic-replay-b
pnpm public-realm:validate
pnpm public-realm:benchmark
pnpm typecheck
pnpm lint
pnpm vitest run src/runtime/block835-public-realm-release.test.ts src/features/explorer/CesiumViewport.test.ts src/app/App.test.tsx
pnpm build
pnpm test
git diff --check
```

Browser proof uses the existing Vite PID 19129 on port 5173 only. It covers
compatible opt-in/local-only loading, semantic selection/deep-link/history,
fault isolation, actual Stage 3 renderer proof, desktop/mobile layout, and
local-only observed request evidence. The benchmark validator rejects missing
or invalid focused-browser evidence rather than inferring a pass from UI text
or an embedded-browser sample. No server lifecycle change or public deployment
is part of this work unit.
