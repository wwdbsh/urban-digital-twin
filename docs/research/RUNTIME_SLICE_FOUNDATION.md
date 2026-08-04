# Runtime slice foundation

**Status:** historical fixture foundation; superseded by the bounded and
citywide local OTI/DOHMH adapters while the production 3D Tiles gap remains
open.

## Delivered runtime state (2026-08-04)

The original provider-neutral seams remain active, and the application now has
three explicit modes. `src/runtime/real-pilot-manifest.ts` loads the bounded
OTI/DOHMH pilot plus verified landmark assets; `src/runtime/citywide-release-runtime.ts`
loads the validated `manhattan-citywide-20260804` release from local JSON
geometry/search/detail shards. Citywide viewport requests are bounded and
lazy, exact source IDs drive search/detail, and unknown release/parent errors
fail closed without fixture substitution. The release is still not an OGC 3D
Tiles service, and the original fixture-only statements below describe the
pre-real-data checkpoint.

This slice establishes the runtime seams for city-scale data without changing the canonical `Feature` or detail-panel contracts:

- `src/runtime/spatial.ts` defines deterministic `wgs84-geodetic/{level}/{x}/{y}` keys, exact tile bounds, feature-to-tile indexing and distance-based LOD bands. It uses a geodetic WGS84 grid deliberately, so the first approved source adapter does not inherit an undocumented provider tile scheme.
- `src/runtime/layers.ts` defines `LayerManifest`, `RuntimeLayerId`, visibility state and deterministic per-layer versions/tile lists. Current fixture layers are `buildings` and `pois`; each manifest is explicitly `fixtureOnly`.
- `src/runtime/cache.ts` defines provider-neutral `TileCache` and `DeduplicatingTileLoader` contracts. Concurrent requests for one tile coalesce, successful values are cached, and a future approved adapter can supply filesystem/worker/3D Tiles loading without changing Cesium or the search UI.
- `src/runtime/fixture-adapter.ts` implements `RuntimeCityAdapter` locally from the normalized synthetic building/POI features. It indexes by layer/tile, searches canonical IDs/names/source-record IDs, applies visibility filters, and exposes layer manifests and lazy cached loads.
- `src/features/explorer/CesiumViewport.tsx` renders building polygons as extruded Cesium entities and POIs as distinct point/label entities. Entity IDs are canonical feature IDs, so Cesium selection resolves the exact feature and the detail panel receives the same source/freshness/confidence/rejection information as search results.
- `src/app/App.tsx` wires search, focus, entity selection and layer toggles to the adapter and viewport. Fixture mode retains explicit synthetic/fixture-only labels; bounded and citywide OTI/DOHMH modes instead expose their local release and source lineage in the map note/footer and inspector.

## Runtime invariants

- Geometry remains WGS84 at the domain boundary; the tile key is a deterministic indexing key, not a promise that production assets will be served in this scheme.
- LOD level decreases monotonically as camera distance increases: close views use level 14, then 12/10/8 at wider distances. A future 3D Tiles adapter can translate this selection into geometric-error/request-volume policy while retaining the same testable invariant.
- Layer visibility is a render input, not a cosmetic label: toggling a layer causes the viewport to lazy-load only enabled layer tiles and rebuild the corresponding Cesium entities.
- Feature IDs are not generated from screen position or array order. Building and POI clicks, source-record-ID searches and cache deduplication all use canonical IDs.
- Fixture manifests, layer manifests and detail records expose `fixtureOnly`; the OTI/DOHMH release adapters expose bounded or citywide local coverage only within their manifest, source, and uncertainty claims.

## Exact hook for the first approved real-data adapter

After a source approval gate is resolved, add a new class implementing `RuntimeCityAdapter` (for example `ApprovedNycBuildingAdapter`) in `src/runtime/` and leave the UI/Cesium props unchanged:

```ts
interface RuntimeCityAdapter {
  readonly city: CityAdapter;
  readonly fixtureOnly: boolean;
  getLayerManifest(layer: RuntimeLayerId): LayerManifest;
  getFeature(featureId: string): Feature | undefined;
  getFeatures(visibility?: LayerVisibility): Feature[];
  search(query: string): Feature[];
  loadLayerFeatures(layer: RuntimeLayerId): Promise<Feature[]>;
}
```

The adapter should read only an approved immutable local snapshot, convert records through the existing offline normalization/validation path, create per-layer manifests and tile indexes, set `fixtureOnly: false` only when the source registry and legal approval support that claim, and preserve source IDs/licences/freshness/uncertainty in every `Feature`. Replace the `fixtureAdapter` singleton in `App.tsx` through dependency injection or a city selection context; do not add provider fetches to `CesiumViewport`.

The first approved implementation task was therefore: **adapt one approved NYC Building Footprints snapshot into `RuntimeCityAdapter`, emit a building-only layer manifest for the documented Flatiron–NoMad–Union Square boundary, and prove geometry validity, height provenance, canonical IDs, WGS84 tile keys, Cesium click identity and source-rich search/detail behavior before enabling PLUTO or any POI/transit/traffic source.** The later citywide release extends this seam only for the separately approved OTI/DOHMH adapters; PLUTO and other pending sources remain disabled.

## Current civic-context adapter (2026-08-04)

The runtime now has a second generic local adapter for release
`manhattan-civic-context-20260804`. It validates the recorded approval ID and
fingerprint, manifest checksums, safe relative paths, WGS84 point/polygon/area
geometry, layer accounting, and incremental budgets before activation. It maps
statistical areas, Parks properties, and LPC records to source-typed
`RuntimeCityAdapter` features while preserving reversible observation/source
relationships and explicit uncertainty.

The adapter loads viewport geometry lazily, performs bounded prefix/exact search,
and loads details through an index only when requested. Per-layer corruption or
missing shards are isolated; no real ID falls back to fixtures. The older
fixture, bounded pilot, and citywide modes remain separately selectable, and
all browser requests remain immutable app-origin local files.
