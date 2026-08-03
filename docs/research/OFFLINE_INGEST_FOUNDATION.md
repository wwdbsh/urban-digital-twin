# Offline ingest foundation

**Status:** local-only implementation foundation; no external provider is connected.

This foundation establishes the contracts required before an approved NYC/Overture/OSM snapshot is introduced:

- `src/domain/schema.ts` defines versioned runtime-validated contracts for `Feature`, `SourceRef`, `LicenseRef`, `CityAdapter`, `IngestionRun`, `FeatureLink`, aliases, tombstones, geometry/height provenance, confidence, uncertainty and freshness. Validation is dependency-free handwritten parsing so the browser and local Node harness share the same rules without installing a schema package.
- `src/data/source-registry.ts` is the typed, versioned registry. Every recommended source class has provider/dataset IDs, canonical/terms URLs, licence/attribution, release/capture/update timestamps, cadence, retention/caching/derivative policy, access requirement, scope, CRS/vertical datum and explicit approval state. External entries remain `pending`; only the synthetic local fixture is `approved` with `test-only` scope.
- `src/data/city-adapters.ts` defines Manhattan's reusable adapter and the approximate, reviewable WGS84 Flatiron–NoMad–Union Square polygon. It is a study boundary, not an official neighborhood polygon or coverage claim.
- `src/ingestion/offline.ts` reads fixture text only, canonicalizes JSON for a SHA-256 checksum, validates each record, normalizes EPSG:4326/EPSG:3857 geometry to WGS84, preserves source IDs and provenance, and emits an immutable manifest with accepted features, rejected-record indices and detailed rejection issues.
- `src/ingestion/fixtures/manhattan-slice.fixture.json` is synthetic and deliberately contains one invalid record. It must never be presented as real Manhattan coverage.
- `scripts/run-offline-ingest.mjs` writes a manifest, normalized feature JSON and adapter JSON with exclusive-create (`wx`) semantics under ignored `artifacts/offline-ingest/...`; rerunning the same output path intentionally refuses to overwrite the immutable result.

## Commands

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm offline:ingest
```

`pnpm offline:ingest` performs no network access. It should report two accepted fixture records, one rejected record (the out-of-range latitude), a deterministic SHA-256 checksum and the output directory. Delete the ignored local artifact directory manually only when intentionally starting a new local run; do not overwrite an existing manifest in place.

## Exact next approved-data ingest task

After the coordinator resolves the approval questions in [ADR 0002](../decisions/0002-manhattan-data-and-rendering-strategy.md#approval-gates-before-implementation), implement one offline source adapter at a time:

1. Record the approved dataset release, terms snapshot, attribution, CRS/vertical datum and permitted retention in `source-registry.ts`; change only that entry's approval state and note after approval evidence exists.
2. Place the approved local download under an ignored raw-snapshot directory and record its checksum in a new `IngestionRun`; do not add credentials, runtime fetches or hosted services.
3. Map that source into the existing `RawFixtureFeature`-equivalent adapter, retaining provider IDs and source-level licence data; add source-specific validation/rejection fixtures before joining it to any other source.
4. Run the Manhattan adapter clip, source accounting, geometry/height provenance checks, canonical-ID stability checks and detail/search projection tests. Resolve conflicts through explicit `FeatureLink` records rather than overwriting fields.
5. Only after the first approved open dataset passes deterministic offline QA should the next source (building geometry → PLUTO/land use → streets → landmarks/parks/facilities → POIs → static transit) be enabled. Live traffic, Google, hosted tiles, MTA realtime and Blender MCP remain separate approval-gated tasks.
