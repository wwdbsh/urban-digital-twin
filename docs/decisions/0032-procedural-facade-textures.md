# ADR 0032: Procedural facade detail tiles, and the replay gate that makes them honest

- Status: Accepted
- Date: 2026-08-11
- Supersedes: nothing. Extends ADR 0031 (V3 footprint-faithful facade grammar).
- Scope: `manhattan-esb-block-reference-20260811-v3t`, a PRIVATE package under
  `private/assets/`. Public and runtime admission are unchanged.

## Context

V3 made the massing faithful: the shipped ring follows the sourced DOITT polygon
vertex for vertex. It did not make the surface look like anything. Every wall is
one flat `baseColorFactor`, so a limestone base, a brick shaft and a curtain wall
differ only in tone. At street distance the block reads as coloured cardboard.

The user asked for realistic textures, viewing real photographs as design
reference only, with zero image ingestion and generated labelling. The tension is
the whole problem: "realistic" pulls toward source imagery, and source imagery is
exactly what the embedded-image gate (ADR 0022) exists to keep out of this
pipeline. A photograph carries a face, a licence plate, a rights obligation and a
factual claim about a specific building, none of which any metadata field can
retract.

## Decision

Ship **procedurally rasterized, grayscale, pattern-only detail tiles**, embedded
as PNG in LOD 0 only, under a new **policy** layer whose gate is **mandatory
rasterizer replay**.

### F1. A policy layer, not a schema or profile version

`MULTI_LOD_ASSEMBLY_SCHEMA_VERSION` stays `1.0` and there is no `profile v2`.

This is not conservatism, it is an accurate description of what changed. The
closed glTF profile in `validateGltfJson` has **always** validated `images`,
`samplers`, `textures`, `baseColorTexture` and `TEXCOORD_0` — it validated them
carefully, with closed key sets and index bounds, and `multi-lod-assembly.test.ts`
already exercised every one of those paths. What the profile lacked was a
producer. Nothing about the wire format needed to change; what needed to change
was **which packages are allowed to use that part of the profile, and what they
must prove to do it.** That is a policy question, and it belongs in
`MultiLodAssemblyPolicy`:

```ts
proceduralTextureProfile?: "procedural-texture-v1"
```

The flag is **declarative only**, and that is a deliberate outcome of security
review rather than an oversight. It records which profile a package was built
against, for the census and for operator tooling. It grants no admission, relaxes
no gate, and is not consulted when deciding whether a byte is accepted — because
every image rule below is unconditional (F8). A flag that gated admission would
be a flag a caller could forget to pass, and the browser runtime passes none.

Bumping the schema would have forced every frozen manifest — V1, V2, V3, Midtown,
the exterior cells — through a migration to express a change that touches none of
them. The manifest of an untextured package is byte-identical before and after
this ADR, and the V1/V2/V3 fingerprint tests prove it.

### F2. Anti-smuggling: the texture-free gate is untouched and still wins

`validateTextureFreeGlb` is byte-untouched. `requiresTextureFreeAssembly` is
byte-untouched. Public audience still forces the texture-free gate
unconditionally, and `requireTextureFreeAssembly` still forces it for
intake-linked lineage. Declaring `proceduralTextureProfile` **cannot relax
either**: a package that is texture-free by audience or by flag stays
texture-free, and the two flags together admit nothing.

The V3T package is refused by that gate twice over, and both refusals are
test-pinned:

1. at the manifest, because a texture-free assembly may not even *declare* a
   nonzero `textureCount`; and
2. at the bytes, because a manifest that *lies* about its texture count still
   meets `ASSEMBLY_ISSUE_EMBEDDED_IMAGE_FORBIDDEN` when the GLB is parsed.

`validateProceduralTextureGlb` is a **sibling** of the texture-free function, not
a replacement. It restates the union-coverage, no-unreferenced-view and no-tail
rules rather than sharing them, with the referenced set widened to
`accessors ∪ image.bufferView` — because an image view is legitimately read by no
accessor. The duplication is deliberate: the texture-free function is load-bearing
for every frozen public package and is left alone.

### F3. `textureProvenance` is allowed-not-required, and excluded from the equality

`extras.urbanDigitalTwin.textureProvenance` is added to the closed metadata key
set as **allowed, never required**. Requiring it would break every frozen
untextured package on the next replay. The requirement is conditional and lives
in the procedural validator: an image without provenance fails under the
procedural policy.

It is also **excluded from the `stableSerialize` equality** that binds GLB
metadata to the manifest asset record. The manifest asset has no such field, and
adding one would rewrite the canonical metadata shape that every frozen package is
pinned against. This is not a weakening. The record is bound by **replay**, which
is strictly stronger than string equality: a provenance record that does not match
what the rasterizer produces cannot survive the regeneration check.

### F8. Replay is the gate. The provenance string is not.

This is the decision the rest of the ADR exists to support.

`validateGlbBinding` **regenerates every embedded PNG from the named constants in
`procedural-texture.ts` and requires byte equality.** Not a hash recorded at build
time — a fresh rasterization, compared against the shipped bytes, on every replay
and in the browser runtime.

The reasoning is that a provenance string proves nothing. Anyone can write
`"profile": "procedural-texture-v1"` above a photograph. Byte equality against a
pure function of named constants is a property a photograph **cannot have**:

- a source-derived tile is unreproducible by construction and fails closed;
- a re-encode of a generated tile fails, because the encoder is byte-exact;
- a generated tile with one pixel altered fails, and this is test-pinned by
  mutating a byte deep inside an IDAT payload *and repairing every checksum in
  the manifest to match*. Only regeneration catches that attack.

Both image rules are keyed off the GLB's **own bytes** rather than off a function
parameter, so every caller enforces them without having to remember to —
including `exterior-cell-runtime.ts`, which required **no change at all**. That
preserves the invariant at `multi-lod-assembly.ts:515-519`: the runtime cannot
admit a GLB the release pipeline would reject.

An image WITHOUT provenance is refused **unconditionally**, in every audience,
under every policy including none. An earlier draft of this ADR made that second
rule conditional on `proceduralTextureProfile` being passed. Security review was
right to reject it: the hole was latent only because nothing serves textured GLBs
yet. The runtime passes no policy, so the moment public admission opened,
arbitrary image bytes carrying no provenance would have ridden through with no
replay at all — precisely the payload this whole design exists to exclude.

Closing it required changing one pre-existing behaviour, and the change is
deliberate. `multi-lod-assembly.test.ts` used to assert that a private package
*keeps* an embedded image no material references. That allowance predates any
producer of embedded imagery; now that one exists, it is the hole. Private
packages no longer keep unprovenanced images. Nothing frozen is affected: every
committed package embeds zero images.

Three supporting narrowings keep the gate cheap and total:

- **Grayscale, pattern only.** A tile carries luminance modulation and no colour.
  Colour stays in `baseColorFactor`, and glTF multiplies the two. A tile therefore
  cannot encode a colour claim about a real building even in principle.
- **Stored DEFLATE, written in-repo.** `node:zlib` output is not contractually
  stable across Node or zlib versions, and this profile's entire gate is
  cross-process byte equality. The encoder emits uncompressed DEFLATE blocks, so
  the PNG is a total function of its pixels. A separate-process determinism test
  pins this.
- **Four classes, four images, LOD 0 only.** The catalogue is closed; a GLB may
  embed at most one image per class it draws.

## The tiles

Four motifs, rasterized from integer millimetre construction modules:
brick running bond (190×57 mm face, 10 mm joint), limestone ashlar (250 mm
courses, 750 mm blocks, 8 mm joint), curtain mullion grid (1400 mm bay, 3600 mm
floor-to-floor, 75 mm mullions, 900 mm spandrel) and metal spandrel panel
(1200×600 mm on a 12 mm reveal).

### What the parameters hash covers, exactly

The replay gate is only as strong as the completeness of
`proceduralTextureParametersHash()`. If one pixel-affecting constant sat outside
it, two different rasterizers could declare the same hash, and the validator would
replay against the wrong constants while reporting a match.

The hashed record is exactly `{ profile, rasterizerVersion, tilePixels,
jointMinimumPixels, classes, motifs }`, where `motifs` carries all nineteen
integer fields of every motif. That is the complete set of inputs
`rasterizeProceduralTexture` reads — it reads no module state, no clock, no
environment, and no other constant. The class name list is included because the
per-class variation salt is derived from the class string itself.

Completeness is tested from both ends rather than asserted. Every motif field is
mutated in turn and must move the hash; each must also move the rasterized
pixels, except for a **named** set of eight pairs that are inert by construction
(a spandrel drop on a motif with no spandrel band, a bed shadow with no depth).
The probe is scaled past two quantisation floors — one pixel spatially, and
enough levels tonally that a ramp contributes more than one 8-bit step — because
below those floors a real constant can legitimately round away, and calling that
a failure would be wrong.

`PROCEDURAL_TEXTURE_MINIMUM_MEAN_MODULATION` is deliberately **outside** the hash:
it is a build-time refusal threshold, not an input, and cannot change a pixel.

The calibrated palette is outside it too, and this is load-bearing rather than an
omission: colour lives only in `baseColorFactor`, so no palette value can reach a
tile. That is tested by mutating the palette wholesale and asserting not one
rasterized pixel moves, and by asserting the hashed record contains no hex colour
at all.

### Calibration method, and what it did and did not touch

An agent viewed **public reference imagery of Midtown street walls as design
reference** and wrote down conclusions **in words**: module sizes, joint widths,
where weathering collects, and a palette expressed as hex. Those words and hexes
were transcribed into the constants in `procedural-texture.ts` and
`V3T_CALIBRATED_PALETTE`. **No pixel of any photograph entered this repository**,
nothing was decoded, sampled, traced or reproduced, and no image file is stored,
referenced or shipped. The citations are text-source design conclusions, not image
data.

The calibrated palette does **not** edit `V3_PALETTE`. That constant feeds
`plan.materials`, so changing it would move every V3 plan hash and break the
byte-frozen V3 package. V3T re-expresses colour at the **GLB material factor**,
which no hash covers, and the census re-checks all fourteen plan hashes against
the frozen V3 manifest on every run.

### 128 pixels, not 64, and why

64 was tried first and **refused on the evidence**. At 64 pixels a tile wide
enough to resolve a 10 mm mortar joint holds exactly one brick, so the per-unit
variation degenerates into whole-course banding and the wall reads as horizontal
stripes rather than masonry. 128 buys a 4×4 brick tile at 6.25 mm/px horizontally
and 2.09 mm/px vertically, which resolves the joint and decorrelates sixteen
units. Sub-pixel joints — ashlar at 8 mm, reveals at 12 mm — are drawn at a
one-pixel floor, and the millimetre parameter remains the honest design intent
rather than being rounded to what the grid can resolve.

### The colour/contrast trade, stated plainly

The tile multiplies the material factor, so its mean **is** how much darker the
textured surface reads — in linear light, so the loss is steeper than the number
looks. Every millimetre of legible joint is bought with mean luminance.
`PROCEDURAL_TEXTURE_MINIMUM_MEAN_MODULATION = 0.82` is where that trade was
stopped, and `V3T_CALIBRATED_PALETTE` compensates the residue by dividing the
target colour through the measured mean, with a **uniform** scale across channels
so the hue survives and no channel exceeds the closed profile's `[0,1]` range.

## UV projection: no kernel change

`deterministic-facade-generator-v3.ts` is untouched except for one additive
uncertainty constant that no plan reads. UVs are generated in `v3GeometryForGlb`
by planar projection from each face's own corners using
`u = dot(p, uAxis) / tileUMm`, where `p` is the **plan-local, building-anchored
ENU millimetre** position — the same frame the grammar already works in.

"Absolute" here means *not relative to the face's own corner*. It emphatically
does **not** mean city-absolute, and the distinction is a hard numerical
constraint rather than a preference. Measured on the tallest shipped asset, UVs
reach |u| ≈ 43 and |v| ≈ 160 tile repeats, where float32 resolves roughly 1e-5 of
a tile — four orders of magnitude below one texel. Re-anchoring the same
projection to an ECEF origin would put `p` near 6.4e9 mm, so `u` would land near
8e6, where consecutive float32 values are **half a tile apart**. The motif would
not degrade; it would disintegrate.

The absolute-coordinate part is the whole point. The obvious implementation —
project each face from its own first corner — restarts the pattern at every quad,
which on this grammar means a visible seam at every bay on every floor. Because
the basis depends only on the face **normal** and the offsets are absolute, two
faces in the same plane land on the identical projection and coursing runs
straight across the boundary between them. This is pinned at **shipped float32
precision**, not at double precision: agreement in the bytes is what matters.

For any wall-like face, `+v` is world up, so bed joints are level and streaks fall
vertically regardless of facade orientation; only faces within 45° of horizontal
fall back to world X/Y, and those are untextured anyway.

## Byte math (measured, all fourteen buildings)

| quantity | value |
| --- | --- |
| tile PNG, each | 16,580 B (128×128, 8-bit gray, stored DEFLATE) |
| per-image cap | 24 KiB |
| worst per-GLB image bytes | 49,740 B (3 tiles) against a 96 KiB cap |
| total image bytes, package | 696,360 B |
| total UV + JSON bytes | 2,259,172 B |
| package total | 7,042,937 B → 9,998,469 B (+42.0%) |
| worst single asset delta | 1,698,076 B (Empire State Building, LOD 0) |

**The images are the minority of the cost. `TEXCOORD_0` is the majority — 76% of
the delta.** UV cost scales with vertex count, not with texture count, so it grows
with geometric detail and is unaffected by tile size. This is the single most
important number in this ADR for planning purposes and is called out again below.

## T026 preconditions (explicitly out of scope here)

This cycle ships a **private** package only. Three things must be resolved before
any textured package is publicly admitted:

1. **Public and runtime admission.** `requiresTextureFreeAssembly` is unchanged,
   so public audience still refuses embedded images unconditionally. Admitting
   them publicly is a rights decision, not a code change, and needs its own
   approval: the argument that a regenerable pattern tile carries no rights
   obligation is strong but has not been adjudicated.
2. **The fullsnapshot byte estimator has no image term.**
   `exterior-fullsnapshot-plan.ts:113-132` estimates artifact bytes from triangle
   and material counts alone. It would under-report a textured citywide snapshot,
   and — given the table above — it would under-report the **UV** term far more
   badly than the image term.
3. **GPU scale.** Naively, ~14,000 buildings × 3 tiles × 128² RGBA decoded is on
   the order of 2.7 GB of texture memory before mipmaps. The obvious answer is a
   shared four-tile atlas bound once for the whole city rather than per-GLB
   embedding, which is a runtime architecture change, not a writer change.
4. **UV origin must stay per-building.** Any future merging of assets into a
   shared or ECEF-anchored coordinate frame must re-derive UVs in a building-local
   frame first, for the float32 reason above. This is the one precondition that
   fails silently and catastrophically rather than loudly.
5. **Runtime cache residency.** Textured assets are ~42% larger, so a fixed
   artifact cache holds ~30% fewer of them (1 / 1.42 ≈ 0.70). At the current
   256 MiB budget that is a materially different eviction profile, and it should be
   measured — not assumed — before textured assets are served.
6. **`city-asset-manifest.ts` `maxTextures` is an ACTION item, not merely an
   unaffected surface.** It is untouched by this cycle because nothing public
   carries a texture, but it is a runtime admission budget on a different contract:
   the moment a textured asset is served through that path, its value and the
   validation around it have to be revisited deliberately.
7. **Cesium-side filtering and aliasing validation.** The writer emits `wrapS` and
   `wrapT` only — no `minFilter` or `magFilter` — leaving mip selection to the
   renderer. The stills in this cycle were rendered by Blender EEVEE, which is not
   the shipping renderer. A LOD 0 asset repeats a 128-pixel tile up to ~160 times
   vertically and ~43 horizontally, which is exactly the regime where a renderer
   without mipmapping or with the wrong filter produces moiré. This must be checked
   in Cesium, at LOD 0 range, on real hardware, before public admission.

## Explicitly unaffected

- `requiresTextureFreeAssembly` and the public/runtime admission path.
- `city-asset-manifest.ts` `maxTextures` — a runtime manifest budget field on a
  different contract, untouched **this cycle**; see T026 precondition 6, where it
  becomes an action item rather than a bystander.
- `block835-public-realm-release.ts` `assetBudget.maxTextures: 0` — a separate
  public-realm budget, untouched.
- `V3_QUALITY_BUDGETS` and its zero texture budget, which remains an accurate
  statement about the V3 package. V3T declares its own `V3T_QUALITY_BUDGETS`.
- Every frozen package: V1, V2, V3 and Midtown fingerprints are pinned and
  unchanged.

## Rollback

Delete the V3T package directory and stop passing `profile: BLOCK835_V3T_PROFILE`.
Nothing else has to be undone:

- `writeCanonicalGlb` without a `textures` option reproduces its previous bytes
  exactly, test-pinned against the frozen `QUAD_ONLY_PRE_TRIANGLE_SHA256`;
- `assembleBlock835V3Package` without a `profile` reproduces the V3 package;
- the policy field is optional and absent policies behave as before;
- `textureProvenance` is allowed-not-required, so no frozen artifact references it.

The reverse direction is what is genuinely hard to undo, and it is the reason the
replay gate exists: once a package could embed an image nobody can regenerate,
no later check could tell it apart from one that could.

## Consequences

- The block reads as brick, stone and curtain wall at facade distance, verified by
  orthographic stills through Blender's own importer.
- A 42% byte increase on a private package, dominated by UVs.
- One more gate to run, and one more constant table whose hash must be pinned.
- The honesty claim is now structural. It survives a reviewer who does not believe
  the metadata, which is the only kind of honesty claim worth making.
