# Decision 0004: approval-safe synthetic routing foundation

Date: 2026-08-03

Status: Proposed; real network source approval pending

## Decision

Use a provider-neutral WGS84 route graph with source-aware nodes, directed edges, walking/transit mode constraints, deterministic shortest-path tie-breaking, explicit snapping uncertainty, and itinerary/step contracts. CesiumJS remains the viewer: route geometry is a highlighted synthetic overlay and camera controls provide a cancellable waypoint preview.

## Safety boundary

Only the invented `fixture.local.route-graph` source is approved for test-only use. Overture Transportation, OpenStreetMap, NYC DCP/DOT products, MTA static/transfer data, and Google Routes remain pending. The UI must never call a provider or claim live service, sidewalk accessibility, exact travel time, exact underground geometry, or Street View.

## Consequences

An approved local graph can be ingested with `pnpm route:ingest` without changing the existing feature/search/detail contracts. Real routing engines, pedestrian accessibility inference, live closures, and multimodal schedule logic are intentionally deferred until source, legal, credential, cost, and retention decisions are approved.
