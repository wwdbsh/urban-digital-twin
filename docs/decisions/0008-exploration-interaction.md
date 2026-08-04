# ADR 0008: provider-neutral exploration interaction

Date: 2026-08-04

Status: accepted for fixture-only implementation; real catalog integration
remains approval-gated.

> **Current-state note (2026-08-04):** The same search/pick/detail/deep-link
> contract is now used by the approved bounded and citywide OTI/DOHMH modes.
> Unknown release/parent IDs fail closed and no same-name fixture is selected;
> unsupported categories, transit, routing, and consumer place facts remain
> outside the delivery. See [Decision 0013](0013-manhattan-citywide-foundation-delivery.md).

## Decision

Use one unified, deterministic search result contract over runtime features and
reconciled entities. Keep exact source identifiers in the canonical/source
lookup path, while Unicode names, aliases, categories, addresses, and raw
display fields feed visitor token search. URL state contains only a canonical
feature ID and query, so the same interaction survives replacing synthetic
fixtures with an approved catalog release.

Selection from Cesium and search uses the same feature callback, focus request,
detail projection, provenance panel, and synthetic route endpoint actions.
History/popstate and invalid-link states are explicit; optional fields are not
invented. Nearby transit is a bounded geometry-derived hint (valid WGS84 Point
geometry, great-circle metres, 1,000 m threshold, three-result maximum, stable
ID tie-break), never array-order evidence or a source relationship. Route
controls require an explicit graph link for an allowlisted building/place/stop
kind or a valid Point snap no farther than 150 metres; areas, neighborhoods,
streets, and routes are unsupported even if a stale or unrelated graph record
exists, and arbitrary polygons do not snap. Cesium remains
the world viewer and no Google branding, scraping, provider API, or new
rendering engine is introduced.

## Consequences

The fixture UI now demonstrates the intended journey and accessibility model,
but it is not evidence of real Manhattan coverage, live transit, authoritative
hours/ratings, or production-scale search latency. Real data must satisfy the
existing source registry, release, provenance, CRS, freshness, and licensing
gates before it can be displayed as production information.
