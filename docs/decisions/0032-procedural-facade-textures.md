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

---

# Amendment — T028 (Issue #50), 2026-08-12

This section is added, not substituted. Nothing above it is edited: the decisions
recorded there were made on the evidence available then, and a later cycle
changing their wording would destroy the record of what was actually decided.
What follows is what T028 measured, decided, and left open.

## A1. Sampler filtering, decided from the shipping renderer

Precondition 7 above said the writer emits `wrapS`/`wrapT` only, that mip
selection is therefore left to whatever renderer opens the file, that the T027
stills were Blender EEVEE rather than the shipping renderer, and that a LOD 0
asset repeating a 128-pixel tile ~160 times vertically is exactly where a wrong
filter produces moire. **It was right, and the defect is real.**

Two sampler variants of the same fourteen-asset V3T package were built from the
same plans — one with the committed wrap-only sampler, one adding
`magFilter: LINEAR (9729)` and `minFilter: LINEAR_MIPMAP_LINEAR (9987)` — and
put in front of CesiumJS 1.143.0 in desktop Chrome 151 at three identical fixed
camera stations. Same viewport (1440x900 CSS at devicePixelRatio 2), same
120-frame settle, same object-URL load path, `localhost` the only host
contacted, zero console errors. The only difference between two captures at one
station is the sampler.

| station | ground distance from ESB centroid | reading |
| --- | ---: | --- |
| `inspection-facade` | 95 m | No legibility difference on the ESB curtain grid. Neighbouring masonry reads as brick under trilinear and as speckle without it. |
| `exploration-street` | 220 m | Wrap-only shows moire clumping on the upper shaft and an unstable brick field on the neighbours. Trilinear removes both; bay rhythm, spandrel bands and floor lines stay legible. |
| `far-shaft-repeats` | 620 m | **Decisive.** Wrap-only breaks the shaft into irregular horizontal clumping and speckle — the pattern reads as noise banding rather than coursing. Trilinear resolves it as an even, stable grid. |

**Decision: `PROCEDURAL_TEXTURE_SAMPLER_FILTER = { magFilter: 9729, minFilter: 9987 }`.**
Any textured package admitted publicly must name that pair in its shipped bytes,
and that is **enforced, not merely asserted**. The release root declares the pair
in its generated-texture fact; under `procedural-replay` — and under nothing else
— `validateProceduralTextureGlb` resolves every drawn texture to its sampler and
requires both fields to equal the declared pair, refusing with
`ASSEMBLY_ISSUE_TEXTURE_SAMPLER_FILTER_REQUIRED`. Without that check a successor
wave could ship the wrap-only samplers whose aliasing was measured here while its
immutable root asserted trilinear, and every other gate would have passed. The
rule is deliberately conditional: the private and replay-only paths are
untouched, so the frozen `-v3t` package — which ships wrap-only samplers and is
not publicly admitted — stays byte-valid.

`writeCanonicalGlb` takes the filter as an OPTIONAL field on its texture set, and
absent reproduces the previous sampler exactly. **The frozen `-v3t` package
deliberately does not adopt it**, because adopting it would move the byte totals
its committed census pins; the variant builds live in the gitignored
`artifacts/` scratch root and no V3T byte is committed by this cycle. The
untextured writer path is untouched and still reproduces
`QUAD_ONLY_PRE_TRIANGLE_SHA256`.

Captures, their checksums, the camera stations and the written verdict are
committed in
`data/manhattan-esb-block-reference-20260811-v3t/cesium-sampler-evidence.json`.
The PNG payloads themselves are not, for the same reason the GLBs are not.

Two honesty notes. A first inspection station at 28 m ground distance placed the
camera **inside** the ESB footprint and produced an unlit interior; it was a
station-design defect and was discarded and replaced rather than reported. And
capture PNG byte sizes are recorded in the evidence file as an observation only:
they corroborate the reading at the far station and contradict nothing at the
near ones, but the verdict rests on the visual comparison, not on them.

## A2. GPU memory, restated with mipmaps in it

Precondition 3 above estimated ~2.7 GB of texture memory for ~14,000 buildings
x 3 tiles x 128² RGBA, **before mipmaps**. A full mip chain adds the familiar
one-third, so the decision in A1 moves that estimate to **~3.6 GB**. That is a
consequence of the decision and is recorded here rather than discovered later.

It does not change the answer: per-GLB embedding does not scale to a citywide
textured wave at any filter setting, and the **shared four-tile atlas bound once
for the whole city** remains the named fix. It is a runtime architecture change,
it is **explicitly out of scope for T028**, and nothing in this cycle assumes it.

## A3. Precondition 4 (UV origin) is closed by test, not by prose

The precondition that "fails silently and catastrophically" is now asserted.
`block835-v3t-package.test.ts` pins three things: every shipped UV stays inside a
building-local magnitude band where one float32 step is far below one texel of a
128-pixel tile; the ECEF-anchored counterfactual is shown numerically to put
consecutive float32 values half a tile — dozens of texels — apart; and UVs are
invariant to the file's axis convention, because the projection reads plan-local
geometry and no anchor is in scope at all. A refactor that merges assets into a
shared or ECEF frame now fails a test instead of shipping a disintegrated motif.

## B1. One versioned admission policy, declared by the release

The refusal that keeps textures out of public delivery was spelled out
independently in at least five places: `requiresTextureFreeAssembly` (public
audience, unconditionally); three points in `exterior-cell-runtime.ts`, which
derived texture-freeness from the audience with **no policy argument at all**;
the wave emitters, which hard-failed on any declared texture; and the
audience-rooted path rule. Five copies of one rule is five places to disagree,
and — the part that matters — **a seam opened in the validator alone would have
been worthless**, because the runtime would have gone on refusing on its own
authority and the refusal would have looked like a bug rather than a policy.

So the policy is declared **once**, on the exterior release root:

```ts
textureAdmission?: { policy: "texture-free" | "procedural-replay"; generatedTextureFact?: … }
```

- **The release declares it, never the package.** The assembly manifest has no
  admission field. A textured package presented to a texture-free release is
  refused and has no say in it.
- **Absent, unknown and malformed all mean `texture-free`.** Every committed root
  predates the field, emits no key, and is byte-unchanged; a release that forgets
  to declare an admission gets the closed answer.
- **`requireTextureFreeAssembly` still wins outright.** That flag could only ever
  ADD enforcement and it still can only add: an intake-linked package stays
  texture-free whatever a release says.
- **`procedural-replay` opens exactly one door** — "a public package MAY carry
  images". Every other rule stays unconditional and keyed off the GLB's own
  bytes: provenance required whenever an image is present, every image
  regenerated from named constants and byte-compared, per-image and per-GLB caps,
  and the 1:1 image/texture/drawn-material shape. All four are test-pinned to
  keep firing under an admitting release.

`audiencePath` was reviewed and **needs no change**: it is a path-safety rule
about `public/` versus `private/` roots and is orthogonal to what a GLB contains.
A publicly admitted textured package writes public-rooted refs like any other.

## B2. The rights boundary: `runtimeTexture` is not the carrier

`runtimeTexture` is a **rights predicate about source-derived texture**: it asks
whether the evidence a building CITES permits a texture to be derived from it. A
procedurally rasterized tile cites no evidence record at all — it is a pure
function of named constants in this repository — so answering that question "yes"
would assert a permission nobody granted over a fact nobody supplied.

Therefore `runtimeTexture: false` stays intact on every building detail, and
`validateProjectedGraphAudience` keeps failing closed for any structural
`runtimeTexture: true`, under every policy — the function takes no admission
parameter, so no release can open it. What carries a textured admission instead
is the release-level generated-texture fact, which says only what is true:
generated in-repo, gated by rasterizer replay, citing **no** evidence basis
(declared literally `null`, never omitted), and naming the decided sampler filter.

**What this argument does NOT dispose of, stated plainly.** A designed tile drawn
onto a named, identifiable, selectable building still makes an implicit visual
assertion: a user looking at the Empire State Building in this application sees a
surface, and surfaces read as claims whether or not any metadata field says so.
Nothing in the rights analysis above makes that go away. The containment is not
that the assertion is absent — it is that **no user-facing claim of facade
fidelity is made anywhere**: the shipped per-asset uncertainty
(`DETERMINISTIC_FACADE_V3T_UNCERTAINTY`, and the cited-style variant beside it)
says the colour, material and detail are designed and derive from no imagery and
no observation, the details panel shows that text next to the geometry, and ADR
0033's "What this decision does not claim" says the same in the record. Anyone
promoting a textured wave inherits the obligation to keep that text visible and
accurate; if it were ever dropped, the tiles would become an unqualified claim
about a real building, and the argument in this section would no longer hold.

**`derivative-scope-excludes-texture` on the Empire State Building intake record
remains correct, untouched, and CONSISTENT with this.** That restriction says a
measurement-only encyclopaedia fact may not become a texture. The designed tile
derives nothing whatever from that fact — not its motif, not its module sizes,
not its tone; the fact selects a designed style class and stops there. Admitting
the tile therefore does not weaken the restriction, and the two statements are
not in tension.

## B3. Immutability, and the rollback unit

**No committed release adopts the new policy this cycle.** The seam is inert. The
promoted V3 waves keep their TEXTURE-FREE approval scope and their
"runtime textures of any kind, procedural or captured" exclusion, byte for byte,
and that is asserted literally rather than paraphrased.

Four things are newly tested, and the first is the one that did not exist:

1. **The RUNTIME itself refuses a textured package under a texture-free policy.**
   Previously only the offline validator was tested; the runtime derived
   texture-freeness on its own and nothing exercised that derivation against real
   textured bytes.
2. A `procedural-replay` release admits a genuine, replayable textured asset end
   to end, through the same object-URL path the application uses.
3. Absent policy means texture-free, at the runtime, the validator and the reader.
4. **Rollback is a release reversion, never a build flag.** The unit is the
   default-activation record — exactly the V2 to V3 mechanism: exporting the
   predecessor makes the untextured release the active default AND, through
   `rolledBackReleaseId`, refuses promotion-era deep links into the withdrawn
   successor. A "textures off" switch is deliberately absent: it would change
   what the application draws without changing which checksum-pinned release it
   claims to be drawing, and the two would then disagree with no record of why.

## B4. Estimate basis v2, and cache residency

Precondition 2 is closed as CODE, not as a regenerated artifact. Basis v2 —
`structural-gltf-accessor-image-uv-arithmetic-v2` — adds the image term and a
per-vertex UV term beside v1. **v1 is not edited and the committed dryrun
artifact is not regenerated**; it still pins
`gatingBasis: "structural-gltf-accessor-arithmetic-v1"` and its numbers.

Two non-comparability warnings ship with it, because a number without them
misleads:

- The estimator models the **six-quad grammar**, not V3. V3 carries the sourced
  polygon vertex for vertex and reaches six figures of triangles on one tower, so
  a v2 estimate is not a check on a measured V3 or V3T total, in either direction.
- v1's `vertexAttributeBytes: 32` already assumed POSITION + NORMAL + TEXCOORD_0,
  while the canonical writer emits POSITION alone untextured and POSITION plus
  TEXCOORD_0 textured, and never a NORMAL. v2 is therefore not "v1 plus UVs"; it
  states its attribute set instead of inheriting v1's.

Cache residency (precondition 5) is **derived from v2**, and the ordering is the
point: no residency figure may be quoted without the v2 estimate it came from,
just as the GPU-memory figure in A2 may not be quoted without the sampler
decision in A1. The arithmetic is explicit — a byte-ceilinged cache holds
`floor(budget / size)` assets and the retained share is the ratio of the two
counts — and it bounds VERIFIED COMPRESSED GLB BYTES only. Decoded GPU memory is
a different budget on a different contract.

## B5. Precondition ledger

| # | Precondition | State after T028 |
| --- | --- | --- |
| 1 | Public and runtime admission | **Infrastructure closed, admission NOT granted.** The seam exists, is versioned, is declared by the release, and is inert. No committed release adopts it. The rights argument is recorded in B2; a wave that opts in is a separate, reviewable decision. |
| 2 | Byte estimator has no image term | **Closed** by basis v2 (B4), as new code beside a byte-frozen v1. |
| 3 | GPU scale | **RE-DEFERRED, named.** ~2.7 GB becomes ~3.6 GB with mipmaps (A2). The shared four-tile atlas remains the named fix and is a runtime architecture change, out of scope here. |
| 4 | UV origin must stay per-building | **Closed by test** (A3). The one precondition that failed silently now fails a suite. |
| 5 | Runtime cache residency | **Closed** as arithmetic derived from basis v2 (B4). It is a byte-budget model, not a measured eviction trace on a shipped textured wave — no such wave exists to trace. |
| 6 | `city-asset-manifest.ts` `maxTextures` | **RE-DEFERRED, with scope note.** It is NOT on the exterior-cell-runtime path: it is consumed by the pilot, landmark and fixture asset resolvers, which no exterior release reaches. The same is true of `block835-public-realm-release.ts`'s `assetBudget.maxTextures`, a public-realm budget on a third contract. Both keep their zero and both must be revisited deliberately by whoever first serves a textured asset through those paths. |
| 7 | Cesium filtering and aliasing | **Closed** by measured evidence (A1), and now ENFORCED on the bytes: under `procedural-replay` only, `validateProceduralTextureGlb` requires every drawn texture to resolve to a sampler naming the exact `magFilter`/`minFilter` pair the release's generated-texture fact declares (`ASSEMBLY_ISSUE_TEXTURE_SAMPLER_FILTER_REQUIRED`). |

`proceduralTextureProfile` stays **DECLARATIVE ONLY**. The F1 security reasoning
above stands unchanged and unweakened: a flag that gated admission would be a
flag a caller could forget to pass. The new `textureAdmission` is not a
counter-example — it lives on the release rather than on the package, its default
is closed, and it is checked in addition to every unconditional byte rule rather
than in place of any of them.
