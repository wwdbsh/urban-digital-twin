# ADR 0009: bounded visitor navigation

Date: 2026-08-04

Status: accepted for fixture-only implementation; real-world navigation and
asset integration remain approval-gated.

> **Current-state note (2026-08-04):** Decision 0013 preserves this validated
> camera/deep-link/navigation contract for OTI/DOHMH real releases. Directions
> and itinerary previews remain synthetic/offline, while unknown releases and
> parents fail closed without fixture substitution. No live navigation, transit,
> traffic, or street imagery was added.

## Decision

Keep one Cesium camera with explicit overview/explore modes and a validated
camera-pose URL contract composed with canonical feature/query links. Apply
finite-value bounds before any camera mutation, ignore malformed poses, and
allow keyboard camera movement only from a focused viewport. Use local,
versioned, deterministic saved-place and saved-journey state keyed by canonical
IDs; stale or corrupt records are discarded.

## Consequences

Visitors can navigate a synthetic city slice, restore a shared camera and
selection, save local places/journeys, and step through an offline itinerary
without confusing this with live navigation or Street View. Browser storage is
intentionally local and unsynchronized. Real data, hosted services, credentials,
and Blender MCP remain separate approval gates.
