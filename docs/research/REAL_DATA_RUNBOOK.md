# Real-data first-wave and citywide local-release runbook

This runbook preserves the bounded 2026-08-04 pilot procedure below and adds
the later approved citywide local-release operation. Neither mode calls a
provider from the browser, uses Google data, or accepts raw partials.

## Current citywide local release (2026-08-04)

The explicit release ID is `manhattan-citywide-20260804`. A local operator must
already possess the immutable, approval-scoped inputs and outputs at:

```text
data/raw/manhattan-citywide-20260804/
data/generated/manhattan-citywide-20260804/
data/generated/catalog/manhattan-citywide-20260804-replay-a/
public/data/manhattan-citywide-20260804/
```

The first three locations support validation/replay; the last is the ignored
browser payload. Do not recreate them, overwrite them, or contact a provider
as part of browser operation. The release manifest is validated against OTI
`jh45-qr5r` and DOHMH `43nn-pn8j` under approval `msg_91770ac6d098`.

Run only read-only release checks after the local prerequisites are present:

```sh
pnpm citywide:validate
pnpm citywide:benchmark
```

The current release facts are 45,194 building parents/render parts, 109,386
DOHMH observations, 12,439 CAMIS parents (12,353 located and 86 unlocated),
103 geometry shards, 214 search shards, 134 detail shards, 57,633 detail-index
entries, and 304,382,520 declared bytes. The runtime loads viewport geometry
and search/detail shards lazily, fails closed for unknown/corrupt releases,
and never substitutes a same-name fixture for a missing real parent.

## Historical bounded pilot procedure

1. The historical bounded-pilot artifacts lived in ignored `data/raw/real-wave-20260804/` and `data/generated/`; only review-approved normalized partitions were copied into ignored `public/data/real-wave-20260804/` for local browser work. After the height-unit correction, that browser payload was partitioned into `buildings.json` (10,973,921 bytes, SHA-256 `0b07d46b51f07d89c0b5940440156cbcf7f2cb7c5a787576c29f88af0e803571`) and a 4,972,010-byte restaurant summary partition (SHA-256 `141f0a05904e5f70df6903ac365bcfb613a1cad55437aeca5d0ac9039cc83f75`), plus a 1,146-byte manifest (SHA-256 `3cf97db3425f64370720e31450c102e50ef7d733126860b2d7b588aecafb4d45`); it intentionally excluded full inspection history and kept that only in ignored ingestion output.
2. Verify the source manifest, response headers, byte size, and SHA-256 before running an adapter. Use the exact commands in [Decision 0012](../decisions/0012-real-data-wave-20260804.md).
3. Run `pnpm nyc:building-ingest` and `pnpm poi:ingest`; each refuses pending source IDs, checksum mismatch, unsafe paths, malformed CRS/geometry, duplicate source identities, and existing output directories.
4. The historical procedure built source artifacts with `node --experimental-strip-types scripts/build-real-wave-artifacts.mjs`, then ran `pnpm catalog:build` with explicit artifact checksums. That procedure emitted partitioned local catalog/tile metadata and required fixture-only fallback when files were missing or invalid.
5. The web app's Data panel starts in Fixture catalog mode. It fetches the versioned manifest first, validates schema/release/source IDs/CRS/declared byte size and SHA-256 for every partition, rejects restaurant payloads containing `placeInspectionObservations`, and falls back to fixtures on any failure. If both local real partitions load and validate, it enables Real open-data pilot; the panel labels the bounded scope, dates, IDs, attribution, and missing/unknown fields. Routes remain synthetic and no MTA/OSM/Overture payload is implied.
6. Quarantine aborted `.partial` files; do not resume or concatenate them. Full-city acquisition needs a new bounded budget review and deterministic replay evidence.

Known first-wave gaps: no MTA because official license metadata is unspecified; no OSM or Overture payload; no real routing, live status, photos, ratings, reviews, hours, or consumer business status. The next approval checklist is: written NYC/MTA retention and derivative terms; OSM ODbL extract/attribution/share-alike treatment; Overture per-source license retention; then optional separately approved paid Google augmentation with credentials/terms/billing and no scraping.
