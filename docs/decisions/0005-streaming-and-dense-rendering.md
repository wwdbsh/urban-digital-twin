# Decision 0005: bounded tile streaming and dense Cesium rendering

Date: 2026-08-03

Status: accepted for the fixture-only runtime foundation; production data and
hosting remain approval-pending.

## Decision

Keep CesiumJS as the sole geospatial renderer. Establish a versioned,
provider-neutral `CityTilePackage`/`TileContentManifest` contract and load
local content through `RuntimeTileStream`, which provides deterministic WGS84
tile selection, explicit LOD bounds, request cancellation/deduplication,
generation fencing and byte/tile bounded LRU caching. Render dense building
polygons as batched Cesium `Primitive` geometry instances and dense POIs as
`PointPrimitiveCollection`; retain entities for sparse semantic layers and
route/camera overlays.

The stress mode and `pnpm tile:benchmark` use generated fixtures only. The
permanent UI warning and package `fixtureOnly` flag prevent synthetic output
from being presented as real Manhattan coverage.

## Why

Cesium’s official guidance distinguishes high-level entities from lower-level
primitives and recommends a few large point collections for performance. OGC
3D Tiles 1.1 provides the eventual hierarchical city-scale delivery model,
with glTF as its primary tile content. The current package contract lets an
approved source adapter move from local JSON fixtures to 3D Tiles without
changing feature IDs, provenance, search, picking or layer toggles.

The implementation uses explicit budgets because browser WebGL contexts and GPU
memory are finite and can be lost. Metrics are observable, deterministic and
testable; they are not claims about all devices or full-Manhattan production
performance. Three.js, Blender and Blender MCP add no needed runtime capability
to this slice and are not introduced.

## Consequences

- Dense batches need an app-owned primitive collection and a canonical-ID pick
  map; the Cesium scene’s root primitive collection must not be cleared.
- A tile loader cannot resolve a URL. Approved ingestion must first produce a
  checksum-pinned local package with complete source/license/freshness groups.
- Sparse feature detail remains entity-backed, so semantic click behavior is
  consistent across normal and stress modes.
- Production 3D Tiles conversion, hosting, source caching and license handling
  each require a separate approval gate.

Evidence: [Cesium Entity/Primitive guidance](https://cesium.com/learn/cesiumjs-learn/cesiumjs-creating-entities/),
[`Primitive`](https://cesium.com/learn/cesiumjs/ref-doc/Primitive.html),
[`PointPrimitiveCollection`](https://cesium.com/learn/cesiumjs/ref-doc/PointPrimitiveCollection.html),
[OGC 3D Tiles 1.1](https://docs.ogc.org/cs/22-025r4/22-025r4.html),
[Khronos glTF registry](https://registry.khronos.org/glTF/), and [WebGL guidance](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices),
all accessed 2026-08-03.
