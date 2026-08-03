# Runtime slice foundation

**Status:** local fixture only; no provider or network integration

This slice establishes the runtime seams for city-scale data without changing the canonical `Feature` or detail-panel contracts:

- `src/runtime/spatial.ts` defines deterministic `wgs84-geodetic/{level}/{x}/{y}` keys, exact tile bounds, feature-to-tile indexing and distance-based LOD bands. It uses a geodetic WGS84 grid deliberately, so the first approved source adapter does not inherit an undocumented provider tile scheme.
- `src/runtime/layers.ts` defines `LayerManifest`, `RuntimeLayerId`, visibility state and deterministic per-layer versions/tile lists. Current fixture layers are `buildings` and `pois`; each manifest is explicitly `fixtureOnly`.
- `src/runtime/cache.ts` defines provider-neutral `TileCache` and `DeduplicatingTileLoader` contracts. Concurrent requests for one tile coalesce, successful values are cached, and a future approved adapter can supply filesystem/worker/3D Tiles loading without changing Cesium or the search UI.
- `src/runtime/fixture-adapter.ts` implements `RuntimeCityAdapter` locally from the normalized synthetic building/POI features. It indexes by layer/tile, searches canonical IDs/names/source-record IDs, applies visibility filters, and exposes layer manifests and lazy cached loads.
- `src/features/explorer/CesiumViewport.tsx` renders building polygons as extruded Cesium entities and POIs as distinct point/label entities. Entity IDs are canonical feature IDs, so Cesium selection resolves the exact feature and the detail panel receives the same source/freshness/confidence/rejection information as search results.
- `src/app/App.tsx` wires search, focus, entity selection and layer toggles to the adapter and viewport. The map note/footer and inspector continue to label all displayed data as synthetic fixture-only data.

## Runtime invariants

- Geometry remains WGS84 at the domain boundary; the tile key is a deterministic indexing key, not a promise that production assets will be served in this scheme.
- LOD level decreases monotonically as camera distance increases: close views use level 14, then 12/10/8 at wider distances. A future 3D Tiles adapter can translate this selection into geometric-error/request-volume policy while retaining the same testable invariant.
- Layer visibility is a render input, not a cosmetic label: toggling a layer causes the viewport to lazy-load only enabled layer tiles and rebuild the corresponding Cesium entities.
- Feature IDs are not generated from screen position or array order. Building and POI clicks, source-record-ID searches and cache deduplication all use canonical IDs.
- Fixture manifests, layer manifests and detail records expose `fixtureOnly`; no visible state claims real Manhattan coverage.

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

The first approved implementation task is therefore: **adapt one approved NYC Building Footprints snapshot into `RuntimeCityAdapter`, emit a building-only layer manifest for the documented Flatiron–NoMad–Union Square boundary, and prove geometry validity, height provenance, canonical IDs, WGS84 tile keys, Cesium click identity and source-rich search/detail behavior before enabling PLUTO or any POI/transit/traffic source.**
