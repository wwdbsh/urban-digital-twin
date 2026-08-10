# 0023 — Block 835 generated-exterior reference asset authoring

- Status: Accepted
- Date: 2026-08-10
- Supersedes: none
- Related: 0011 (Blender MCP install and threat model), 0019 (provider-neutral
  exterior contracts), 0020 (deterministic facade plans), 0021 (multi-LOD
  assembly packages), 0022 (rights-cleared evidence intake)

## Context

ADR 0020 defined deterministic facade plans and ADR 0021 defined the immutable
multi-LOD assembly contract, but no package had yet been produced that carried
real Block 835 buildings through both. This decision records how the first such
package — `manhattan-esb-block-reference-20260810` — is authored, what it does
and does not claim, and how it can be rolled back.

The package covers the 14 buildings of Manhattan Block 835 pinned by the
existing exterior pilot release `manhattan-esb-block-exterior-pilot-20260805`.
It is additive and local-only: no runtime code consumes it, no pinned release
byte changes, and no external source is contacted.

## Decision 1 — Blender authors, Node writes the shipped bytes

Blender MCP is the authoring, inspection and visual-validation authority for
this package. It is **not** the source of the shipped bytes.

The multi-LOD validator accepts a deliberately closed glTF profile
(`validateGltfJson` / `validateTextureFreeGlb` in
`src/release/multi-lod-assembly.ts`): `asset` may carry only `version`, no
`name` may appear on any object, extensions are forbidden, every `bufferView`
must be read by an accessor, the BIN must be gap-free from offset zero with at
most three bytes of alignment slack, and the single root
`extras.urbanDigitalTwin` record is the only permitted metadata surface.

Blender's glTF exporter cannot emit that profile. It writes `asset.generator`,
propagates object and material names, and does not guarantee a gap-free
accessor-covered BIN. Post-processing exported bytes back into the profile
would make the exporter's incidental output the contract of record.

Shipped bytes are therefore written by `src/release/canonical-glb.ts`, a
purpose-built deterministic writer, from the same committed facade plans that
Blender authors from.

The two authorities are reconciled by a **re-import diff**: every shipped GLB is
imported back into a fresh Blender scene and its vertex cloud compared against
the authored mesh. This mirrors the precedent already set by
`release.json.validation.reimportEvidence` in the pilot release. The Blender
tessellator (`scripts/blender/block835_reference_author.py`) is an independent
port of the plan rules rather than a replay of the TypeScript output, so a
disagreement is a real signal, not a tautology.

This split has already paid for itself: the Blender-side analytic volume check
caught an inside-out winding on the top reveal quad of every recessed opening —
a defect the glTF profile check cannot see, because a reversed winding is still
a structurally valid indexed triangle.

## Decision 2 — Zero admitted exterior evidence is a positive finding

The repository holds **no** rights-cleared exterior evidence for Block 835. ADR
0022 built the intake path; nothing has been admitted through it.

Every component in every plan is therefore `generated` or `absent`. No asset
carries the `evidence-backed` truth tier, and the assembly rejects one if it
ever appears. Absence is always stated as "no representation was generated;
this is not a claim that the real building lacks it", never as an assertion that
the real feature is missing. Signage stays `absent` for all 14 buildings, so the
package makes zero tenant, brand, text or signage claims.

The required non-empty `evidenceShardId` is set to the explicit sentinel
`evidence-shard:none:block-835-reference-20260810`. Naming the absence is safer
than pointing at a shard that does not exist or borrowing an unrelated approved
shard, which would imply evidence backing that was never granted.

## Decision 3 — Massing is an oriented bounding rectangle, disclosed as such

The approved V1 deterministic generator accepts exactly one axis-aligned
rectangle per building. Real DOITT footprints on Block 835 are rotated,
non-rectangular polygons. The shipped massing is therefore the **minimum-area
oriented bounding rectangle** of the source footprint, not the footprint.

The registration gate measures the drift of that rectangle through the pipeline
— unit conversion, WGS84-to-ENU anchoring, millimetre rounding, float32
quantisation — against tolerances of 0.25 m horizontal and 0.5 m vertical. It
measured 0.9 mm and 13 mm at worst. It does **not**, and cannot, certify shape
fidelity to the source polygon. Shape simplification is a property of the
approved generator contract, not a defect introduced here; it is disclosed in
the implementation record and in the plan uncertainty carried verbatim on every
asset.

Vertical registration compares the roof plane, not the highest vertex, because
the generated rooftop appurtenance sits above the sourced `heightMeters`. The
registration report publishes both elevations so the appurtenance is visible
rather than hidden. `roof-equipment` is one of the fifteen required component
kinds and the approved generator declares it `generated`, so it is authored
rather than suppressed; its height is capped at 1.2 m to keep the unsourced
volume above the sourced roof small.

## Decision 4 — Private audience with texture-free enforced

The package declares `audience: "private"`; every artifact reference is rooted
at `private/`. The assembly contract only auto-enforces the embedded-image gate
for public packages, so `scripts/validate-multi-lod-assembly.mjs` gained an
additive `--require-texture-free` flag that threads
`requireTextureFreeAssembly` into validation and replay. The flag can only add
enforcement; it can never relax the gate a public package always carries.

The package is texture-free by construction: no images, no textures, no
samplers, and a BIN that contains nothing but accessor-covered geometry. That
closes every route by which raw imagery could ride inside a shipped asset.

## Decision 5 — Shipped glTF content is +Y up; tile transforms stay translation

glTF 2.0 mandates +Y up for file content, and 3D Tiles applies the implicit
y-up-to-z-up rotation to glTF content before the tile transform. The assembly
validator closes the tileset `asset` object to `version` alone, so `gltfUpAxis`
cannot be declared to opt out of that rotation — and should not be, since it is
a legacy 3D Tiles 1.0 extension.

Shipped GLBs therefore carry `(east, height, -north)`. An earlier revision of
this package shipped ENU `(east, north, height)` directly. That is a z-up file
in a format that mandates y-up: CesiumJS would have re-rotated it to
`(east, -height, north)` and laid every building flat on its side. The
deterministic and profile gates all passed on those bytes, because no schema
check can see an up-axis error.

Only the file bytes are rotated. The tile coordinate frame remains z-up ENU, so:

- tile `boundingVolume.box` values are computed from the pre-rotation ENU bounds
  and stay ENU-aligned after the renderer's y-up-to-z-up correction;
- tile `transform` stays a pure translation `(east, north, 0)` in the tile frame,
  with no rotation component, keeping the per-building anchor trivially
  auditable;
- the registration gate keeps measuring in ENU.

The rotation `(x, y, z) -> (x, z, -y)` has determinant +1, so triangle winding
and the outward-normal orientation proven by the volume identity are preserved.

The re-import diff now **asserts** this axis rather than compensating for it. It
compares raw Blender world coordinates against the authored ENU scene with no
correction, relying on Blender's own y-up-to-z-up import mapping to recover ENU.
A z-up file fails that comparison, which is precisely the defect a renderer
would show.

## Decision 6 — T007/T008 boundary

T007 produces the package and its evidence only. It touches no file under
`src/runtime/`, registers no loader, and adds no runtime provider request.
Wiring the package into streaming, camera and picking is T008's scope.

## Rollback

Delete `public/data/manhattan-esb-block-reference-20260810/` and
`data/manhattan-esb-block-reference-20260810/`, then revert the PR. Nothing
else depends on either path: no runtime module resolves them, no pinned release
references them, and the three existing pinned packages
(`manhattan-esb-block-exterior-pilot-20260805`,
`manhattan-esb-block-public-realm-20260806`, the landmark wave) are untouched.

## Consequences

- The closed GLB profile now has a first-class deterministic writer that other
  packages can reuse.
- Blender remains required for authoring judgement, visual validation and the
  watertightness/silhouette measurements that no schema check can supply.
- Any future change to the plan rules must be made in both the TypeScript
  tessellator and its Python port, or the re-import diff will fail. The Python
  port is a transliteration of `tessellatePlan`, so agreement between them is a
  transcription check, not independent verification. The genuinely independent
  checks are the analytic-volume identity (which found the inverted winding) and
  the up-axis-asserting re-import diff.
- `registration.json` is a build report, not part of the immutable contract: it
  is deliberately absent from `manifest.artifacts[]`, so it is neither
  checksum-pinned nor replayed by the multi-LOD validator. It carries its own
  method and limitation disclosure inline.
- A committed-package drift test rebuilds from the committed inputs and asserts
  the on-disk manifest fingerprint and every artifact checksum, so a tessellation
  change can no longer leave the frozen package silently stale.
- The package is a reference set, not a fidelity claim. It must not be presented
  as showing what these buildings actually look like.
