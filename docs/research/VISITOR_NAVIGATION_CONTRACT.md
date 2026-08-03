# Visitor navigation contract (2026-08-04)

The current navigation experience is an offline, synthetic fixture journey.
Cesium remains the world camera and selection authority; no street-level
imagery, collision model, live navigation, current traffic, or real Manhattan
coverage is implied.

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
