# Manhattan streaming and dense-rendering architecture

Evidence checked 2026-08-03 (Asia/Seoul). This note records the implementation
decision for a reusable multi-city runtime. Its fixture-only current-state
description is historical; the delivered runtime also loads an approved local
OTI/DOHMH JSON/shard release. No provider request occurs during this
documentation catch-up.

## Delivered streaming state (2026-08-04)

`src/runtime/citywide-release-runtime.ts` performs bounded, lazy viewport
geometry loading and on-demand search/detail shard loading for
`manhattan-citywide-20260804`. Stable parent IDs connect Cesium picks, search,
deep links, and detail records; cache/concurrency metrics are exposed in the
UI and benchmark. The release remains local JSON/shard delivery rather than
production OGC 3D Tiles, and the bounded pilot continues to use its separate
local partitions and protected landmark GLBs. Existing synthetic harness
claims below remain valid for the fixture mode only.

## Evidence and what it means

| Primary source | Dated observation | Runtime consequence |
| --- | --- | --- |
| [CesiumJS Entity/Primitive guidance](https://cesium.com/learn/cesiumjs-learn/cesiumjs-creating-entities/) (accessed 2026-08-03) | Cesium describes Entity as a high-level data-driven API and Primitive as the lower-level rendering API with different performance characteristics. | Keep sparse semantic objects (areas, transit, selected details, route overlays) as entities; use batched primitives for dense buildings and point collections for dense POIs. |
| [Cesium `Primitive`](https://cesium.com/learn/cesiumjs/ref-doc/Primitive.html) and [`PrimitiveCollection`](https://cesium.com/learn/cesiumjs/ref-doc/PrimitiveCollection.html) (accessed 2026-08-03) | A primitive accepts geometry instances and per-instance attributes/IDs, and collections own the renderable resources. | Batch polygon geometry by layer/tile, retain canonical feature IDs as instance IDs, and remove only the app-owned child collection during reload/unmount. Never call `scene.primitives.removeAll()`: that can destroy Cesium visualizer resources owned by entities. |
| [Cesium `PointPrimitiveCollection`](https://cesium.com/learn/cesiumjs/ref-doc/PointPrimitiveCollection.html) (accessed 2026-08-03) | Cesium recommends a few collections with many points; adding points rewrites a vertex buffer and is best done in batches. | One collection per loaded dense POI batch is the fixture baseline. Production adapters should batch updates at tile boundaries and use visibility rather than per-point churn when possible. |
| [Cesium 3D Tiles guide](https://cesium.com/learn/3d-tiling/) (accessed 2026-08-03) | Cesium positions 3D Tiles as a hierarchical, view-dependent delivery format for large 3D geospatial content. | The provider-neutral `CityTilePackage` contract is the local pre-tiles boundary. A future approved adapter can emit OGC 3D Tiles without changing search/detail IDs or layer contracts. |
| [OGC 3D Tiles 1.1, 22-025r4](https://docs.ogc.org/cs/22-025r4/22-025r4.html) (approved 2022-12-17, published 2023-01-12; accessed 2026-08-03) | The standard defines hierarchical tiles, bounding volumes, geometric error and content refinement; glTF 2.0 is the primary tile format. | Preserve tile bounds, quadtree key, LOD, geometric error, checksum and provenance in manifests. Do not treat a fixture JSON tile as an OGC 3D Tiles claim. The production conversion remains a later adapter decision. |
| [Khronos glTF registry](https://registry.khronos.org/glTF/) (accessed 2026-08-03) | The registry identifies glTF 2.0 as the current runtime 3D asset format and describes patch-level clarifications. | Use approved GLB/glTF only for detailed landmark assets or 3D Tiles content; do not add Blender or Three.js to the runtime foundation. Asset rights and attribution remain per source group. |
| [MDN WebGL context loss](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/isContextLost) and [WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices) (accessed 2026-08-03) | Browsers can lose a WebGL context under GPU/resource pressure; guidance calls out memory, context loss, synchronous stalls and eager resource cleanup. | Budget bytes, tile count and concurrency; abort stale requests; evict by LRU; destroy app-owned primitives and viewers; report a responsiveness proxy rather than claiming universal FPS. |
| [NYC Open Data Building Footprints `jh45-qr5r`](https://data.cityofnewyork.us/d/jh45-qr5r) (official portal metadata accessed 2026-08-03) | The official page describes citywide building footprint outlines, exposes multipolygon geometry and fields including BIN, DOITT_ID, BASE_BBL, Ground Elevation and Height Roof; the page displayed “Updated July 18, 2026” and a portal row count of 1,082,974 at access time. | This was order-of-magnitude planning evidence only, not a benchmark. At that evidence checkpoint the source registry was pending; the later approved immutable snapshot and its exact validation facts are recorded in Decision 0013. |

The Cesium and OGC documents are normative or first-party engine documentation;
MDN is implementation guidance rather than a performance guarantee. The NYC
portal count and displayed update date are time-sensitive metadata, not copied
records and not a claim that the app currently covers Manhattan.

## Runtime contract

`src/runtime/tile-package.ts` defines version `1.0` `CityTilePackage` and
`TileContentManifest`. Each manifest carries WGS84 geodetic quadtree key and
bounds, layer, supported LOD, geometric error, feature/byte counts, SHA-256,
safe relative local content reference, source registry groups, freshness,
schema version and an explicit `fixtureOnly` claim. Package validation fails
closed for absolute paths, URLs, traversal, malformed keys/bounds, duplicate
content IDs, unsupported LODs, missing children/roots, invalid checksums or
missing provenance/freshness. The validator is intentionally provider-neutral:
license and terms obligations are represented by source registry groups rather
than inferred from a file path.

`src/runtime/tile-stream.ts` implements camera-driven selection and loading.
Distance selects a supported LOD clamped to explicit minimum/maximum; a camera
position maps deterministically to a WGS84 tile, with deterministic nearest
fallback when a fixture package has no exact tile. Requests are priority-ordered
by stable manifest order, deduplicated by content ID, bounded by concurrency,
cancelled with `AbortController` when no longer selected, fenced by generation,
and retained in a byte/tile bounded LRU. Metrics expose generation, selected
LOD, visible/requested/loaded/evicted/failed counts, bytes, active/max
concurrency, deduplicated requests, stale results and rendered feature count.
The loader accepts a function supplied by the caller; the app supplies only a
local `Map` lookup, so this layer has no URL or network fallback.

## Rendering choice

The normal viewer remains CesiumJS. Dense synthetic buildings are batched into
an app-owned `PrimitiveCollection` using `PolygonGeometry` and stable instance
IDs; dense synthetic POIs use `PointPrimitiveCollection` with stable IDs. A
screen-space pick maps primitive IDs back to canonical `Feature` records, then
the existing detail/search contract supplies source IDs and provenance. Dense
collections are filtered by runtime layer visibility. Areas, stations, entrances,
schematic routes, route overlays and selected semantic details remain entities
because their count is sparse and their labels/relationships matter more than
draw-call minimization.

3D Tiles is the intended production delivery format once approved source data
and hosting/storage terms exist. Cesium primitives are the current intermediate
path for local dense fixture batches. Entities are not replaced wholesale: they
remain the semantic interaction layer. glTF/GLB is reserved for approved
individual landmark assets or as 3D Tiles content. Three.js adds no demonstrated
capability here and is deliberately not introduced; Blender/MCP is not part of
this runtime streaming task.

## Synthetic harness and measurable limits

`src/runtime/synthetic-tile-harness.ts` generates stable, Manhattan-like but
invented buildings and POIs across every supported LOD (8/10/12/14), with four
distinct regional WGS84 tile keys per layer and spatially valid parent/child
links. It emits mixed known/unknown building heights, categories and fixture
provenance without real addresses or landmarks. The UI stress mode keeps one
stream for its lifetime, listens to Cesium camera changes with a 120 ms
debounce, selects the camera tile/LOD, publishes loaded features and metrics,
and destroys the stream/listener on toggle or unmount. `pnpm tile:benchmark` is
a developer-only local harness; its JSON metrics are reproducible but are not a
full-Manhattan benchmark.

Dense selected buildings change per-instance color and selected POIs enlarge
with a bright outline; both retain canonical primitive IDs for exact picking.
The app-owned primitive collection is the only collection modified by stress
reloads, so Cesium's internal entity visualizer resources remain intact.

Acceptance gates for this fixture are: no duplicate content loads, at most two
active requests, loaded cache no larger than four tiles/1 MB, deterministic LRU
eviction and checksums, distinct tile selection across three synthetic anchors,
LOD movement from 10 to 14, cancellation/stale generation fencing, zero
failures in the normal run, exact source-ID search/pick mapping, and zero
pending requests after destroy/unmount. Browser verification records a
practical interaction/console proxy (including empty `warn`/`error` logs), not
a universal FPS or production city-scale claim.

## Production path and approvals

The next real-data step is approval of a specific immutable source snapshot,
its license/terms and retention/derivative policy, followed by this
non-destructive local validation command before any renderer sees it:

```sh
pnpm tile:validate -- --input data/approved/manhattan-city-tile-package.json --content-root data/approved/manhattan-city-tile-content
```

The command checks the package registry gate, safe relative references, byte
sizes and SHA-256 values, writes no output, and makes no network request; a
separate approved source adapter can then normalize the validated content. No
provider URL should be accepted by the runtime. Required approvals remain:
legal/terms acceptance for each NYC or other provider source and derived 3D
content, permission to retain/cache and redistribute derivatives, any hosted
object storage or tile service, and any credentialed or paid provider. None is
assumed by this fixture-only change.
Stress diagnostics expose synthetic Center/West/North tile and Zoom closer
camera controls for deterministic browser verification; they are labeled as
fixture controls and do not represent real geographic coverage.
