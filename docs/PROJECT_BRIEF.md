# Urban Digital Twin

## Mission

Create a reusable web platform that reconstructs real cities as navigable 3D
digital twins. Manhattan is the first implementation and validation city. Later
cities must be addable through data and configuration rather than a rewrite.

## First-city outcome

The Manhattan release should let a user:

1. Move smoothly from city scale to street and building scale.
2. Select a building, parcel, landmark, road, or supported map feature.
3. Open a details panel showing sourced facts, freshness, and uncertainty.
4. Search for supported places and move the camera to them.
5. Distinguish authoritative geometry and metadata from inferred or generated
   detail.

“As-is” means evidence-backed reconstruction at the best available resolution.
It does not mean inventing unseen facades, interiors, live occupancy, or traffic
and presenting them as ground truth.

## Proposed technical baseline

| Concern | Baseline |
|---|---|
| Web application | React + TypeScript + Vite |
| Geospatial 3D runtime | CesiumJS |
| City-scale delivery | 3D Tiles with hierarchical LOD and streaming |
| Reusable detailed assets | glTF/GLB, with texture and mesh compression |
| Authoring and procedural generation | Blender through Blender MCP |
| Custom rendering | Three.js only when a validated requirement exceeds CesiumJS |
| Information interaction | Stable feature IDs, picking, and a sourced details panel |

CesiumJS is the primary runtime because it supplies a high-precision WGS84 globe
and a 3D Tiles streaming engine with level-of-detail selection, caching, and
asynchronous loading. Cesium documents 3D Tiles as the intended format for
massive datasets and supports picking selected objects. Three.js is a rendering
library rather than the overall application framework; it remains useful for
specialized rendering and glTF assets, but does not by itself provide the full
geospatial and city-streaming stack.

Primary technical references:

- <https://cesium.com/platform/>
- <https://cesium.com/platform/cesium-ion/3d-tiling-pipeline/>
- <https://cesium.com/learn/cesiumjs-learn/cesiumjs-creating-entities/>
- <https://threejs.org/docs/pages/GLTFLoader.html>
- <https://threejs.org/docs/pages/Raycaster.html>

## Data and fidelity principles

- Every dataset needs a license record, attribution rule, source URL, geographic
  coverage, resolution, and capture/update date before ingestion.
- Maintain stable internal city and feature identifiers so geometry, metadata,
  search, and selection stay linked across dataset updates.
- Keep raw, normalized, generated, and published data in separate pipeline
  stages. Outputs must be reproducible from versioned inputs and parameters.
- Model several levels of detail. Stream only what the camera needs; never load
  the entire city at maximum detail.
- Generated geometry or textures must carry an explicit confidence/provenance
  label and must not overwrite authoritative source data.

## Reference prototype

The initial inspiration is the Roundtable post at
<https://x.com/RoundtableSpace/status/2084032743843803219?s=20>. It describes a
Blender MCP workflow that produced approximately 45,000 real buildings,
landmarks, and street-grid traffic in about 2.5 hours. This project uses that as
a rapid-prototyping benchmark, then adds the production requirements the post
does not establish: source licensing, measurable accuracy, repeatable builds,
metadata interaction, browser performance, and multi-city reuse.

## Decisions that require user confirmation

- Blender MCP installation or connection method.
- Authoritative and commercial data providers, including their cost and license.
- Whether Cesium ion may be used or all tiling and hosting must be self-managed.
- Target device classes and measurable frame-time, memory, and loading budgets.
- Whether “traffic” means a visual simulation, historical data, or licensed live
  data.
- Whether interiors are out of scope, selectively modeled, or a later phase.

Do not choose these implicitly. Present concrete options and ask the user before
the affected implementation begins.
