# Visitor navigation contract (2026-08-04)

The fixture journey remains an offline synthetic mode. The delivered bounded
and citywide OTI/DOHMH modes reuse the same offline navigation contract;
Cesium remains the world camera and selection authority. No street-level
imagery, collision model, live navigation, current traffic, or unsupported
real-Manhattan category coverage is implied.

## Delivered release navigation (2026-08-04)

Citywide links retain the selected release ID, canonical building/restaurant
parent ID, query, and validated WGS84 camera pose. Reload, Back, Forward,
unknown-release, and unknown-parent handling remain fail-closed and never
replace a missing real entity with a fixture. Directions and itinerary
previews remain explicitly synthetic/offline in every mode; no real transit,
routing, traffic, or pedestrian guidance was added.

## Camera and links

`CameraPose` stores bounded WGS84 longitude/latitude, height, heading, pitch,
and roll. `overview` and `explore` are explicit modes. Navigation URLs retain
the existing canonical `feature` and query state and add `view`, `lon`, `lat`,
`height`, `heading`, `pitch`, and `roll`. Every pose value is finite and
clamped to safe bounds (longitude ±180°, latitude ±90°, height 80–500,000 m,
heading [0,360), pitch [-90,0], roll [-180,180]); malformed or partial poses
are ignored and show a truthful notice rather than moving the camera to an
unvalidated location.

Arrow-key exploration is handled only by the intentionally focused viewport,
so typing in search and assistive technology controls is not hijacked. North,
reset, overview, explore, and current-selection controls use bounded immediate
camera state. Reduced-motion preferences shorten Cesium flights and route
journey previews; camera flights and timers are cancelled on replacement,
clear, or unmount.

## Journeys and saved state

Itinerary steps expose start, previous, next, focus-step, pause, and stop
controls. Distances, durations, geometry, and camera previews remain labeled
synthetic/offline and are never represented as navigation guidance. Saved
places and journeys use schema `udt.visitor-navigation.v1`, canonical IDs,
deterministic ordering, and local browser storage only. Unsupported schema,
corrupt JSON, stale feature IDs, and unavailable storage recover to an empty
state; there is no remote sync claim.

Real catalog publication still requires source approvals, licensing and
attribution review, immutable release validation, and any Blender MCP approval
before offline asset authoring or runtime integration.

## Civic-context URL and bookmark state (2026-08-04)

Navigation schema remains backward-compatible while accepting
`data=civic-context` / `release=manhattan-civic-context-20260804`, visible layer
state, and civic facet state. Search and pointer/keyboard selection preserve
canonical NTA, Parks, or LPC IDs in cold-loadable URLs; browser Back/Forward
restores the previous query, feature, camera, layers, and facets. Bookmarks
retain the immutable civic release ID, so an unavailable detail produces an
explicit message rather than a fixture or same-name substitute.

Focus returns to the invoking search/result or control after closing details;
the mobile inspector retains semantic headings, status announcements, and
Escape handling. Civic source caveats and unknown values are rendered directly
from the release detail rather than inferred by navigation.
