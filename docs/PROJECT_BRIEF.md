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

## Delivered Manhattan foundation (2026-08-04)

The repository now contains the completed local Manhattan foundation described
in [the implementation record](codex/MANHATTAN_CITYWIDE_FOUNDATION_IMPLEMENTATION.md)
and [Decision 0013](decisions/0013-manhattan-citywide-foundation-delivery.md):
synthetic fixture mode, a bounded approved OTI/DOHMH real-data pilot, and an
explicit local citywide OTI/DOHMH release with lazy geometry/search/detail
shards, stable identity, source provenance, and fail-closed navigation. The
citywide release is snapshot-relative and local-only; it is not a public
deployment or production 3D Tiles service. The three protected procedural
landmark GLB pairs are integrated into the bounded pilot only.

The delivered source scope does not add real neighborhoods, parks, retail or
general attractions, transit, routing, live status, reviews, ratings, photos,
street imagery, traffic, or facade-accurate/photorealistic building models.
DOHMH values remain inspection history observations, and OTI footprint
extrusions remain source-derived massing with explicit uncertainty.

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

## Implemented civic-context release (2026-08-04)

The bounded local Manhattan wave is implemented as the immutable sibling release
`manhattan-civic-context-20260804`. It adds generic v2 statistical-area, Parks
property, and LPC landmark-record layers while preserving the existing fixture,
bounded pilot, and citywide release modes. Cesium owns WGS84 positioning and
lazy geometry; local search/detail shards preserve source IDs, provenance,
capture/update dates, attribution, uncertainty, and explicit no-data caveats.

The approved source set is DCP NTA `9nt8-h7nd` / mapped view `4hft-v355`, NYC
Parks Properties `enfh-gkve`, and LPC designated/calendared sites `ncre-qhxs`.
The durable approval ID is
`codex-user-turn:2026-08-04:manhattan-civic-context-local-v1`; canonical scope
SHA-256 is
`7860f0c6c867488935443df1f1f1bb6fefa950646fa7cd1cd32d5a3d0c1eda58`.
This wave is local-only and does not authorize public deployment, redistribution,
new providers, credentials, fees, imagery, facade work, or live transit/status.

The release is navigable by source ID/name, supports pointer and keyboard
selection, deterministic overlap choices, URL layer/facet/deep-link state, and
bookmarks pinned to the immutable release. Statistical areas are not definitive
or exhaustive vernacular neighborhoods; Parks presence does not prove current
hours, amenities, legal survey accuracy, or access; LPC dates and designation
records do not prove current condition or use. See the implementation record for
exact counts, checksums, budgets, browser evidence, and the documentation audit.

## Runtime civic composition (2026-08-05)

The canonical civic URL/runtime root `manhattan-civic-context-20260804` now
composes the civic layers over its manifest-pinned base
`manhattan-citywide-20260804`. This is a runtime-only composition; neither
immutable manifest was rewritten and no composed release was emitted. Feature
origin remains separate from the composition root, so a selected citywide
building keeps citywide search/detail/provenance identity while the URL keeps
the civic root.

The composition uses one shared 24-entry/48 MiB cache and four-request
aggregate budget. Cesium receives independent deterministic groups capped at
6,000 citywide base features and 128 civic context parts, with collision-checked
picking and selected feedback retained outside a full group only when active.
The exact manifest hashes are citywide
`acb5a9b52014f86535c8478e7d4e516efc03f6dff95c17e9896dfea4413c203c` and civic
`225aba4efb041b26c38932b265f927373ec8974f0fb4a5e63e34baefd07da2a2`.

The implementation and browser evidence are recorded in
[`MANHATTAN_CIVIC_RUNTIME_COMPOSITION_IMPLEMENTATION.md`](codex/MANHATTAN_CIVIC_RUNTIME_COMPOSITION_IMPLEMENTATION.md)
and [Decision 0015](decisions/0015-manhattan-civic-runtime-composition.md).
Citywide procedural footprint/height massing remains explicitly distinct from
real facade imagery, textures, roofs, interiors, entrances, and photorealistic
models; bounded-pilot GLBs are inactive in the civic composition.

## Generated building exteriors (2026-08-12)

The exterior programme is complete as an accepted release behaviour and is
**not** complete as a model of Manhattan. Both halves belong in the brief.

**What ships by default.** Six exterior waves are promoted over the unchanged
immutable `manhattan-citywide-20260804` base, one for each wave the immutable
`manhattan-exterior-wave-ledger-20260804` declares. The ledger partitions 883
WGS84 cells and 45,194 canonical building parents with zero missing cells, zero
missing parents and zero duplicate canonical owners — recomputed on every test
run from the committed ledger rather than asserted.

**What a default session puts on screen (since the 2026-08-15 citywide flip):
41,841 real building extrusions at the 52 km island overview, from a URL that
names nothing.** These are the committed citywide dense shards — real OTI
footprints extruded to sourced heights, with per-building pick identity —
streamed by camera visibility. The island is drawn.

**What carries a generated, textured exterior: 484 of 45,194 parents (1.07%),
shipped as 498 GLB artifacts.** This is the **textured V3 tier**, promoted on
top of the massing within the near-camera radius — 14 buildings at a 260 m
street camera, 66 at 1.2 km, 40 at the overview — and it is **not** the answer
to "what renders". Conflating the two numbers is the single easiest way to
overstate this project, and the brief keeps them apart deliberately.

870 of 883 cells ship no *generated* exterior geometry. **Where the citywide
base tier is active** their buildings draw as sourced base massing rather than
being absent, and since T007 the runtime's notice says exactly that, with the
condition attached: the rollback arm (`?exteriorScheduler=off`) withdraws the
base tier, so an unconditional promise would be false there. The pre-flip
wording, which said no substitute was selected, was true when nothing was drawn
for those cells and became false by omission once they drew. **The binding constraint is no longer the 512-entry
all-resident exterior cache contract**: the visibility scheduler of Decision
0041 holds at most 128 resident cells against 883 visible, certified in Decision
0042, and it is that **cell cap** that binds. Two separate caches with two
separate ceilings must not be conflated: the **exterior cell cache** (512
entries / 256 MiB) measured 40 entries and 14,369,372 B at the island overview,
so its byte cap does not bind; the **citywide dense shard cache**, a different
pool with a resolved budget of 112 shards / 83,886,080 B, measured 58,243,420 B
over 99 entries — 69.4% of its bytes and 88.4% of its entries, which is pressure
rather than headroom and is the tightest reading in the build. Growing breadth
is now a data-production question (materialize and retain more generated
exteriors), not a runtime-scheduling one.

**Fidelity claim.** Exteriors are **generated and designed, not observed**. The
V3 grammar derives structure from the sourced footprint ring and height; four
waves add procedural facade textures rasterized from named constants and
re-verified byte-for-byte. No shipped component asserts a real building's
facade, material, entrance, signage or occupancy. Every component carries a
machine-readable truth tier and an uncertainty statement; generated components
carry no real-world accuracy score. The grammar refuses 899 parents outright
under named stop codes rather than inventing geometry for them.

**Evidence posture.** No rights-cleared building imagery was ever admitted as
geometry, texture, training or validation input. Zero components are
evidence-backed. Google Maps, Street View, unlicensed web photographs and
platform-restricted imagery contribute nothing, enforced by a closed
classification denylist and a procedural-replay gate that makes a
photograph-derived tile unreproducible by construction. The shipped geometry's
rights rest on NYC OTI Building Footprints.

**Conveyance.** The full-fidelity releases are local and private. The
`manhattan-public-showcase-20260812` candidate is an inventory of the six
separately approved local releases and is **local only** — every wave's
approval instrument excludes public internet deployment and so does the
candidate. Private and public partitions use distinct roots, allowlists,
checksums and approval envelopes, and the built public bundle carries no
private byte.

**Device-class status.** The desktop path is measured; the **mobile path is not
implemented** and has no evidence. Frame-time budgets pass on the measured
desktop composition, and they still pass at citywide scale on the tighter pair:
worst p50 8.3 ms and worst p95 15.9 ms against 16.7/25, off a measured 7.8 ms
vsync floor, across street, transition, island-overview and pan-storm stations.
Accessibility is proven structurally rather than behaviourally.

**Escape hatches, separated and separately measured.**
`?exteriorStreaming=off` disables the six promoted V3 waves and says nothing
about the citywide overview: the island still draws island-wide as base massing,
measured at 43,021 buildings at the 52 km overview. `?exteriorScheduler=off` is
the full opt-out and the rollback — it withdraws visibility scheduling and the
overview residency raise together, collapsing the drawn island to 5,289, and its
global form is the single constant `EXTERIOR_SCHEDULER_DEFAULT_ON`.

**Two goals, two records, one open criterion.** The exteriors goal's
reconciliation is in
[Decision 0039](decisions/0039-goal-integration-acceptance.md) and
`data/goal-integration-acceptance-20260812/reconciliation.json`: 30 of 31
criteria are closed, and criterion 1 remains NOT-MET because 41,357 of the
41,841 buildings drawn are sourced base massing rather than generated exteriors,
with the 899 grammar refusals still awaiting their adjudication. The citywide
default streaming goal's reconciliation is
`data/citywide-goal-acceptance-20260815/reconciliation.json`, summarized in
[Decision 0045](decisions/0045-citywide-default-streaming-flip.md): all 12
criteria are MET or adjudicated. Its last open one — criterion 7, a
repeated-camera-path heap verdict at citywide scale under forced GC — was closed
by capture in T008 (`data/citywide-heap-repeat-20260815/heap-repeat-evidence.json`),
which repeats one island-scale path eight times in a single document with a
forced collection before every sample and passes its pre-registered rule while
stating its own detection floor. Both records carry residual risks by number
rather than closing quietly.
