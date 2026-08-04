# Place-truth implementation record

Implementation date: 2026-08-04 (UTC)

## Delivered

- Added [`src/domain/place-truth.ts`](../../src/domain/place-truth.ts), a
  provider-neutral multi-city contract with canonical ID, localized names and
  aliases, taxonomy/facets, WGS84 point, structured address, entrances,
  brand/operator, contact, timezone-aware hours, special dates, amenities,
  accessibility, commercial facts, imagery references, validity, freshness,
  source licences, conflicts, uncertainty, and field-level lineage.
- Added strict validation: `known`, `unknown`, `absent`, `stale`, and `conflict`
  are explicit; known/stale/conflict values require source lineage; unknown and
  absent values cannot carry an asserted value; inline imagery blobs and
  unsourced ratings are rejected.
- Added deterministic hours evaluation for IANA timezones, Monday=0 periods,
  overnight windows, special closures/openings, DST-local display, invalid time,
  unknown, and stale results.
- Added three invented fixture places (restaurant/cafe, shop/grocery, and
  attraction/museum) in [`place-truth-fixtures.ts`](../../src/domain/place-truth-fixtures.ts).
  Existing Cesium selection, unified search, category filters, deep links,
  routes, bookmarks, camera controls, and stress mode remain the authorities;
  the detail panel now adds fixture-only place truth, honest status/hours,
  localized names, facets, source/licence, missing-data, and field-lineage UI.
- Added focused tests in [`place-truth.test.ts`](../../src/domain/place-truth.test.ts)
  for schema rejection, Unicode, overnight/DST, special closures, stale and
  unknown states, localization, and absent commercial/imagery/address facts.

## Current integration status (2026-08-04)

The provider-neutral place-truth contract remains fixture-backed for names,
hours, accessibility, commercial facts, imagery, and other general place
fields. The approved real integration is narrower: citywide DOHMH inspection
observations are grouped by stable CAMIS parents, and their source-backed
inspection fields remain separate from consumer ratings, reviews, current
opening state, or a complete business directory. The bounded pilot and
citywide release expose OTI building parents and DOHMH restaurant parents with
source IDs, capture/update dates, attribution, unknown states, and local
release provenance; unlocated DOHMH parents remain searchable/detail-addressable
without invented geometry. Other categories and providers remain pending.

The citywide release contains 12,439 CAMIS parents, 12,353 located and 86
unlocated, from 109,386 accepted observations. This is a release fact, not a
claim that all Manhattan places or businesses are represented.

## Evidence and limits

Official NYC, Overture, OSM/Overpass, MTA/GTFS, and Google documentation was
reviewed on 2026-08-04 (UTC) without API calls or provider payloads. The source
decision matrix and exact A/B/C approval checklist are in
[`PLACE_TRUTH_SOURCE_MATRIX.md`](../research/PLACE_TRUTH_SOURCE_MATRIX.md) and
[`0010-place-truth-contract-and-approval-gates.md`](../decisions/0010-place-truth-contract-and-approval-gates.md).
No real Manhattan hours, reviews, photos, popularity, or business status were
added. General place-truth fixture records remain synthetic; the separate
OTI/DOHMH adapters expose only the approved source-backed building and
inspection observations described above.
