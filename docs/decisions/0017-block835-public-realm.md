# Decision 0017: Block 835 public-realm overlay

Date: 2026-08-06 (Asia/Seoul)

Status: approved and implemented as a local-only opt-in release.

## Decision

Add a separately versioned Block 835 public-realm overlay for the existing
Cesium application. The overlay contains source-backed roadbed and sidewalk
geometry plus pavement-edge-constrained estimated curbs and deterministic
estimated crosswalks at the four adjacent intersections. It is independently
removable from the existing building/storefront overlays, but activates only
when `publicRealm=manhattan-esb-block-public-realm-20260806` is requested
alongside a genuinely active compatible real base and the active Stage 3
exterior/commercial overlay. The canonical compatible local URL is
`/?data=citywide&release=manhattan-civic-context-20260804&exterior=manhattan-esb-block-exterior-pilot-20260805&commercial=1&publicRealm=manhattan-esb-block-public-realm-20260806`.

## Boundaries

- The immutable local snapshot contains exactly NYC OTI Planimetrics Sidewalk
  `vfx9-tbb6`, Roadbed `xgwd-7vhd`, and Pavement Edge `x9uq-u3qs`.
- The request is clipped to the existing 14-building Block 835 union buffered
  by 35 m, with only four adjacent roadbed/intersection approaches retained.
- Source coordinates and source IDs are retained; the published CRS84 response
  is normalized to WGS84 (`EPSG:4326`) with source-native State Plane
  (`EPSG:2263`) and NAVD88 documented. No silent geometry repair is allowed.
- Curb vertical profile and crosswalk placement/striping remain explicitly
  estimated and source-constrained; neither is current-paint or survey-grade
  truth.
- Blender MCP authors and reimports a disposable metric ENU scene. Assets use
  flat materials, no textures/images/fonts, and separate semantic LOD0/LOD1
  GLBs. Polygon contours use Blender's
`mathutils.geometry.tessellate_polygon` with explicit exterior/interior ring
winding and polygon `step=1` (full source contour resolution) in both LODs;
area residual and a one-interior-ring sidewalk regression are release
evidence. The existing
  `Stage3CommercialBlock835` scene is read-only.
- There is no Google, OSM/Overpass, paid or credentialed service, runtime
  external request, public deployment, or Manhattan-wide generation.

## Compatibility and fallback

The release pins the existing exterior pilot and records citywide/civic
compatibility IDs without changing those releases. A bare public-realm URL,
fixture mode, an inactive/mismatched base, or an inactive Stage 3 exterior
fails closed with an explicit prerequisite message; it must not treat the
public-realm release as its own base. Manifest, normalized data, or asset
checksum failure omits only this overlay; buildings/storefronts and their
existing release remain active.

The focused-browser acceptance gate is durable rather than declarative: a
benchmark may pass only with same-session external Chrome/Safari evidence
against `localhost:5173`, 600 settled `requestAnimationFrame` samples per
Stage 3-only and Stage 3-plus-public-realm condition, a focused visible
document, identical viewport/DPR/camera path, clean console/window errors and
local-only observed network hosts, and live Cesium proof of 14 buildings and 8
storefronts in both conditions. The measured overlay must remain at or below
12 ms median, 30 ms p95, and 20% p95 regression; invalid, missing, or stale
evidence makes the benchmark fail.

Durable user approval evidence: `approval:block835-public-realm:20260806:user-approved`.
