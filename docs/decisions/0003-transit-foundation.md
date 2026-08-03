# Decision 0003: provider-neutral transit foundation

Date: 2026-08-03

Status: Proposed; external source approval pending

## Decision

Use provider-neutral transit records and CesiumJS runtime layers for stations, entrances, and schematic routes. Local immutable snapshots are normalized to WGS84, checksum-pinned, clipped to the documented Manhattan vertical slice, tiled by the existing runtime cache, and exposed through canonical feature IDs and source-aware detail/search contracts.

## Boundaries

The implementation deliberately does not claim live arrivals, routing, exact underground alignment, or current elevator availability. MTA static GTFS, GTFS-Realtime, station complexes, entrances, and amenities remain pending in the source registry; only invented `fixture.local.transit` records are approved for tests/browser validation.

## Consequences

The first approved real adapter can use `TransitSnapshotAdapter` and `pnpm transit:ingest` without changing the UI contract. Approval must cover terms, attribution, retention, redistribution, derivatives, keys, rate limits, and accessibility semantics before any real file is acquired or enabled.
