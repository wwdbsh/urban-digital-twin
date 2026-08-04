# Exploration interaction contract (2026-08-04)

The explorer is provider-neutral: it consumes the existing `Feature`,
`CanonicalEntity`, `SourceRef`, and route contracts and does not assume that a
source is authoritative merely because a value is visible. The checked-in
journey remains available as synthetic fixture data, while the delivered
bounded and citywide OTI/DOHMH adapters use the same interaction contracts.

## Delivered real-release behavior (2026-08-04)

In the explicit citywide mode, exact OTI/DOHMH IDs, normalized source fields,
lazy search/detail shards, Cesium feature picks, and deep links resolve to the
same canonical parent identity. Unlocated DOHMH parents remain searchable and
detail-addressable without invented geometry. Unknown release or parent IDs
fail closed; the app does not choose a same-name or nearby fixture. DOHMH
inspection history remains distinct from consumer place truth. Real transit,
shops, parks, broad attractions, live routing, ratings/reviews, and hours were
not added.

## Unified discovery

`searchUnifiedCatalog` produces deterministic results grouped as Buildings,
Areas, Places, Transit, or Addresses. Names, Unicode aliases, structured
addresses, categories, raw feature attributes, source IDs, observation IDs,
and provider metadata are searchable; exact source identifiers remain distinct
from visitor-facing token search. Results expose a type label and match reason,
are keyboard navigable with Arrow Up/Down and Enter, and report empty states
without fabricating a result.

## Selection and links

Selection is represented by `?feature=<canonical feature id>&q=<query>` URL
parameters. Selecting from Cesium or search pushes a history entry, browser
back/popstate restores a valid feature, and an unknown or stale ID produces an
explicit invalid-release message without claiming a match. The detail panel
can copy the current URL; all related actions preserve the canonical feature
identity and focus request.

## Detail and journey semantics

Details retain the feature's source records, capture/update timestamps,
freshness, confidence, uncertainty, license/attribution, and catalog
relationships. Optional address/contact/hours/category/brand/accessibility
fields are rendered only when present; missing values stay absent or explicitly
Unknown where the contract itself requires an uncertainty state. Related
entities are source-linked. Nearby transit is a geometry-derived hint only:
the selected feature and candidate must have valid WGS84 Point geometry, the
Haversine great-circle distance is sorted by distance then stable ID, and the
result is limited to three candidates within an explicit 1,000 metre
threshold. Polygon, line, invalid, or missing geometry produces no proximity
claim; this is not a source-published transit relationship. Route controls are
enabled only for valid point features that resolve to an exact graph node or a
deterministic point snap no farther than 150 metres and that support the
selected mode. An explicit source/fixture graph link may resolve a non-point
feature such as the synthetic building node, but only the endpoint allowlist
(building, poi, transit stop/station/entrance, or fixture point) is eligible;
an otherwise-unlinked Point may snap no farther than 150 metres. Areas,
neighborhoods, streets, and transit routes are always unavailable, as are
arbitrary polygons, stale IDs, and unsupported modes.
Valid endpoints use the existing synthetic/offline graph with an explicit mode
and warning, and the result is never presented as live navigation.

Escape closes transient search/diagnostic/inspector surfaces, focus moves to
the selected detail heading, and reduced-motion behavior remains owned by the
Cesium journey implementation. The mobile layout collapses the navigation and
inspector while retaining semantic controls and search.

## Real-data gates

An approved catalog release must preserve these contracts without UI changes,
but it still requires source-by-source registry approval, licensing/terms and
attribution review, retention/derivative decisions, immutable checksums, CRS
and vertical-datum validation, freshness policy, and a production tile/search
publication review. No provider was contacted and no external data was added
for this interaction slice.

## Civic-context search and overlap contract (2026-08-04)

The immutable local civic release adds source-typed search summaries for NTA,
Parks, and LPC records. Queries support official names, canonical IDs, and
source IDs; results identify the source kind and whether the match was exact,
prefix, or text. Selecting a result loads only its release-pinned detail and
updates the canonical URL with `data`, `release`, `feature`, `q`, layer, facet,
and camera state. A cold URL first validates the release and then loads geometry
and detail; it never substitutes a fixture or same-name result.

Cesium drill-picks are ranked deterministically by layer/record identity. If
more than one civic record overlaps, the chooser exposes every candidate as a
keyboard-accessible option. Missing or corrupt geometry/detail shards report an
isolated layer status and leave unaffected source kinds available. NTA,
Parks, and LPC wording remains source-specific and does not imply neighborhood
authority, access/hours/amenities, current condition, ratings, reviews, or
completeness.
