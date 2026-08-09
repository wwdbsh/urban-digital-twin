# Decision 0020: deterministic provider-neutral facade plans

Date: 2026-08-10

Status: accepted for deterministic domain plans and synthetic validation;
asset authoring, rendering, publication, and citywide rollout remain deferred.

## Decision

The first facade generator produces a provider-neutral, renderer-neutral plan,
not a Blender scene, mesh file, GLB, 3D Tile, Cesium primitive, or published
release. Its input and output use schema version `1.0` and bounded integer local
millimeters. WGS84 positioning remains outside this contract and under Cesium's
existing authority.

Inputs carry a bounded building ID and seed, canonical UTC generation time,
tool ID/version, one rectangular hole-free footprint, integer base elevation
and height, canonical footprint and height source anchors, and exact integer
generation parameters. Footprint ring start, winding, and source-anchor order
are canonicalized before fingerprinting. V1 rejects holes, non-rectangular or
crossing rings, controls and oversized IDs, noncanonical timestamps, unsafe or
floating parameters, inconsistent floor height, and plans exceeding 512
floors, 256 bays, or 50,000 placements.

All hashes use the existing synchronous SHA-256 implementation moved unchanged
to a provider-neutral domain utility. Stable serialization remains key-sorted,
and catalog-release continues to re-export both functions without changing its
public API. Input, parameter, choice, and plan hashes use separate textual
domains. The plan hash covers the complete canonical plan except its own
`planHashSha256` field.

The output separates:

- canonical local-mm ground, roof, and four facade surface rings;
- integer local-surface placement bounds for windows, ground openings,
  cornices, and roof equipment;
- a six-material bounded PBR palette with integer byte colors and permille
  factors, distinct colors, and non-repeating adjacent facade materials;
- closed topology with explicit surface ownership, adjacency, and integer part
  bounds; and
- the complete T002 exterior component inventory.

The T002 inventory retains the required 15-kind order. Entries are only
`generated` or `absent`; signage is always absent in V1 with wording that means
no representation was produced, never that real-world signage is absent.
Generated entries share the fixed procedural uncertainty statement, canonical
constraint source IDs, generator ID/version, input fingerprint, parameter hash,
and generation timestamp. No tenant, brand, text, accuracy, confidence, or
real-world facade claim is accepted or emitted.

## Validation and determinism

Input, plan, and nested records use exact-key validation. IDs and every numeric
parameter, coordinate, material factor, topology bound, and placement bound are
bounded safe integers. V1 caps topology at 64 parts and 2,048 surface vertices.
Surface rings must be simple canonical rectangles; topology must uniquely own
all surfaces and cannot contain overlapping part volumes. Placements must close
over declared surfaces and materials, remain within surface bounds, avoid
overlap, and preserve ground-opening and roof-equipment anchoring.

Generation uses no random source, wall clock, floating output, trigonometry,
mutable cache, provider request, or shared result state. Integer subdivision
uses exact `BigInt` ratios before converting bounded results to safe integers.
Repeated, reordered, concurrent, and synthetic-corpus generation therefore
produces byte-identical canonical plans for equivalent input.

## Consequences and deferrals

The plan is a procedural representation and deterministic validation evidence;
it is not proof of architectural, geographic, factual, visual, accessibility,
or performance fidelity. Source anchors constrain inputs but do not launder a
generated component into observed truth.

Blender MCP authoring, geometry realization, GLB or 3D Tiles production,
runtime rendering and caching, Cesium wiring, acquisition, release assembly,
publication, and deployment are explicitly outside this decision and require
their later bounded tasks and approvals.
