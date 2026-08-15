# ADR 0047 — Shared per-class texture images

Status: accepted (opt-in releases; promotion not decided here)
Date: 2026-08-15
Task: T002
Supersedes: nothing. Amends ADR 0040 D7. Routes one item to T004.

## Context

Four promoted exterior waves ship textured facades. Every textured GLB carries a
copy of each detail tile it draws, inside its own BIN chunk. The measured
population, taken from the committed inventories rather than estimated:

| wave | release | textured assets | embedded tile copies |
| --- | --- | --- | --- |
| w03 | `manhattan-southern-remainder-cells-20260812-p1` | 179 | — |
| w02 | `manhattan-lower-manhattan-cells-20260812-p1` | 71 | — |
| w04 | `manhattan-central-upper-manhattan-cells-20260812-p1` | 40 | — |
| w05 | `manhattan-northern-manhattan-cells-20260812-p1` | 24 | — |
| **total** | | **314** | **941** |

There are only FOUR distinct tiles. All 941 copies are one of
`brick-running-bond`, `limestone-ashlar`, `curtain-mullion-grid` or
`spandrel-panel`, each 16,580 bytes, each 128 x 128 grayscale PNG, all four
sharing one sampler `{magFilter 9729, minFilter 9987, wrapS 10497, wrapT 10497}`.

### The contract note this ADR is answering, corrected

The approved contract named a **484**-asset tier. That figure is wrong and the
correction is recorded rather than quietly applied: the textured arm is **314**
assets across four `-p1` waves. Block 835 and the midtown core waves are
texture-free BY DESIGN and are outside this tier entirely. The contract's
"(or measured equivalent)" clause is what this correction is exercised under.

### Why duplication is not merely wasteful

Cesium keys an EMBEDDED image through the owning model's absolute URL
(`ResourceCacheKey.getImageCacheKey` falls through to
`getEmbeddedBufferCacheKey`, which is `${getAbsoluteUri(gltfResource.url)}-buffer-id-${id}`
plus the bufferView range). Two models embedding byte-identical tiles therefore
get two cache keys and two decoded GPU textures. There is no content dedupe at
any level. An EXTERNAL image is keyed by its own resolved absolute URI
(`getExternalResourceCacheKey`), so the same tile referenced by URI from any
number of models collapses to one entry.

## Decision

Ship each class tile ONCE per release as a `role: "texture"` artifact and have
every GLB reference it by strict relative URI.

- **No atlas.** Maximum observed |UV| in the shipped assets is **1210.1**. The
  tiles tile by repeat wrapping, and an atlas cannot repeat: packing four tiles
  into one image would require either remapping every UV into a sub-rectangle
  (which breaks repeat at |UV| > 1, i.e. essentially everywhere here) or a
  shader that emulates wrapping. Both are ruled out.
- **No UV, material, sampler or geometry change.** The `-t1` variants are
  emitted from the same plans, seed, tool and generated instant as their `-p1`
  predecessors. Only where the image bytes live differs.
- **No glTF extension, no KTX2.** KTX2 would change what the tiles ARE and would
  need its own honesty story (a transcoded tile is not the tile the rasterizer
  produced). The saving here is a residency saving, not a format saving.
- **No render toggle.** Delivery is selected by RELEASE ID through
  `?exteriorCells=`, per ADR 0032 B3. There is no switch that changes how a
  release's own bytes are drawn.

## Empirical Cesium evidence (1.143.0 / @cesium/engine 26.1.0)

Established by probing the installed engine, not by reading documentation.
Line numbers are deliberately not cited; the named functions are.

1. External URI images share ONE cache key per resolved URI — dedupe holds.
2. Embedded images key per model. The four waves' 941 copies are 941 keys.
3. A SHARED `basePath` COLLIDES embedded-buffer keys: two models given the same
   base resource resolve to the same `embedded-buffer:` key and the second is
   served the first's BIN, silently. A **unique per-artifact URL is mandatory**,
   and this is why the model URL is the release-relative artifact path.
4. `Resource.createIfNeeded` and `getDerivedResource` both go through
   `Resource.prototype.clone`, and `clone()` WITH NO ARGUMENT returns a BASE
   `Resource`. Subclass survival is therefore not something Cesium provides; it
   is obtained by overriding `clone`, which this implementation does. Without
   that override the model would silently degrade to a plain resource pointed at
   a real URL and start fetching unverified bytes.
5. `ModelVisualizer` passes `entity.model.uri` to `Resource.createIfNeeded` and
   then to `Model.fromGltfAsync({url})`; `GltfJsonLoader` calls
   `fetchArrayBuffer()` on it; `GltfLoader` sets `baseResource = gltfResource.clone()`;
   `GltfImageLoader` derives the image resource from that base and calls
   `fetchImage()` on it. Every one of those is a subclass survival point.
6. `ConstantProperty` calls `value.clone(result)` on set AND on every read,
   because `Resource` has a `clone` method. The override must handle both forms.

## The entity path is RETAINED

The alternative was migrating exterior geometry from Cesium entities to
primitives. It was probed and is NOT needed: the entity path reaches
`Model.fromGltfAsync` with whatever resource the ModelGraphics `uri` holds, so a
`Resource` subclass is sufficient. Retaining it preserves the properties bag,
the pick map, the selection silhouette and the details-panel provenance by
construction rather than by re-implementation, and those are asserted by test.

## The Verified Resource

`src/features/explorer/exterior-verified-resource.ts`.

- `fetchArrayBuffer()` serves the checksum-verified GLB bytes, as a COPY, and
  refuses any URL but its own — so a glTF naming an external `.bin` cannot be
  handed the model's own bytes.
- `fetchImage()` serves the verified class tile for the resolved URL, decoded
  with Cesium's own image parameters, and refuses anything else.
- `clone()` carries the verified payload, which is what makes the subclass
  survive points 4-6 above.
- FAIL CLOSED is the default in every direction: an undeclared URI, a contained
  but undeclared path, an escape above the release root, the right tile path
  under a DIFFERENT release, and an absolute URL are each refused, and each is
  a test.

Session-scoped verification: a release's tiles are fetched through the SAME
verified-artifact path a GLB uses — declared byte size, declared SHA-256, shared
LRU, shared request budget — and then replayed byte-for-byte against
`proceduralTextureCatalog()`. It happens once per assembly package per session.
A cell of a texture-declaring release whose tiles do not verify FAILS CLOSED; it
never renders untextured. A rejected verification is not memoized, so a
cancelled request cannot become the session's permanent answer.

## Gate (d) re-derivation

The exterior cache release seam's gate (d) treated the viewport's revoke of a
Blob URL as evidence that the second copy of the bytes is gone. A
texture-declaring release creates NO Blob URL: the resource references the very
`Uint8Array` the cache holds. Gates (a), (b) and (c) are untouched. Gate (d) is
re-derived and the derivation is recorded at the gate itself:

- `reachedScene` still means a scene holder existed, and the viewport still
  reports retirement for the cells whose entities it removed;
- the revoke list for such a cell is simply EMPTY, so the ordering contract
  (revoke strictly before report) holds vacuously;
- honestly WEAKER: releasing the cache entry frees only the cache entry, because
  there is no second copy — the bytes were never duplicated.

## GPU measurement

### Instrument validation FIRST — and it caught a wrong claim

The probe module originally documented `ResourceCache.statistics.texturesByteLength`
as BASE LEVELS ONLY. Validation against a scene with a known texture count
refuted that in one step: the reading divides EXACTLY by **87,381** bytes per
texture, not by the 65,536 an uncompressed 128 x 128 RGBA base level costs.
87,381 is `65,536 * 4 / 3` truncated — Cesium adds a third for a mipmapped
texture, which the shipped LINEAR_MIPMAP_LINEAR sampler makes these. The base
level is 75% of the figure and the pyramid 25%. The module and its test now
state the measured behaviour, and the correction is recorded here because it is
the reason instrument validation runs before any delta is quoted.

Wire versus GPU, stated separately and never conflated: a tile is **16,580** PNG
bytes on the wire, **65,536** as an RGBA base level, **87,381** as Cesium
accounts for it with mips — a 5.27x expansion from the wire.

### The campaign

Identical pose, both arms, same browser instance, fresh tab each, settle tied to
the reading going stationary (texture upload is async), resident asset set
asserted equal before any delta was quoted.

Pose: `lon -73.988800, lat 40.746231, height 380, heading 20, pitch -32, roll 0`
over the w03 curated cells. Chrome 151.0.7922.138, own scratch user-data-dir.

| arm | release | resident assets | geometry bytes | texture bytes | decoded textures |
| --- | --- | --- | --- | --- | --- |
| embedded | `...-20260812-p1` | 78 | 6,971,032 | 15,204,294 | **174** |
| shared | `...-20260812-t1` | 78 | 6,971,032 | **349,524** | **4** |
| delta | | 0 | 0 | **-14,854,770** | **-170** |

- `15,204,294 = 174 x 87,381` exactly; `349,524 = 4 x 87,381` exactly. Both arms
  validate against the instrument with a delta of zero.
- **Resident assets identical (78 = 78)** and **geometry bytes identical**
  (6,971,032 = 6,971,032). The two arms are the same scene; only the texture
  accounting moved.
- **97.70% reduction**, 43.5x fewer decoded textures, at this pose.

### The island figure is a PROJECTION, labelled, with its arithmetic

Not a measurement. The campaign held 78 of the 314 textured assets resident.
Restating the measured per-texture cost over the full population:

- embedded, 941 tile copies: `941 x 87,381 = 82,225,521` bytes (~78.4 MiB)
- shared, 16 artifacts (4 classes x 4 releases, distinct URLs): `16 x 87,381 = 1,398,096` bytes (~1.3 MiB)
- projected saving: **~80.8 MiB of GPU texture memory**

It assumes every projected texture costs what the measured ones cost, which
holds for this catalogue because all four tiles share dimensions and format. It
is arithmetic over a measured unit cost and nothing more.

### Payload, separately

The four `-t1` payloads total 142,672,284 bytes against the `-p1` releases'
158,028,067 — **15,355,783 bytes smaller**, which is the embedded duplication
leaving the wire. This is a wire number and is not the GPU number above.

## Visual equivalence

Argued STRUCTURALLY and corroborated, not asserted from a screenshot:

- the tiles are byte-identical (the same `proceduralTextureCatalog()` objects,
  replayed on both the offline gate and the runtime);
- UVs, materials, samplers and geometry are emitted by the same code from the
  same plans, and the campaign's identical `geometryByteLength` is independent
  evidence of it;
- stills at one street pose are **byte-identical between the two arms**
  (SHA-256 `80be6daf7b41f4b8…` for both), committed beside this record.

LIMITATION, stated: that pose frames the cell footprints from above rather than
a textured facade at close range, so the stills prove frame equivalence at that
pose and do NOT constitute close-range facade parity evidence. A facade-level
visual comparison is not claimed here.

## Rollback rehearsal

Transcript committed. Three states, each observed rather than reasoned about:

- `?exteriorCells=…-t1` → the `-t1` release ALONE, 78 assets.
- `?exteriorCells=` removed → the promoted six-wave default, 92 assets, texture
  reading 15,204,294 — the default composition is entirely unaffected by these
  releases existing.
- `?exteriorCells=…-t9` (an id this build does not pin) → no wave activates, 0
  assets, exterior streaming not enabled, and the app says so. Fails closed
  loudly, which is the withdrawn-successor behaviour.

## Amendments and routing

- **ADR 0040 D7 is amended.** It recorded that decoded GPU bytes are "not
  observable from outside Cesium". That is too strong in one narrow place:
  `ResourceCache.statistics.{texturesByteLength, geometryByteLength}` exposes
  Cesium's own CPU-side upload accounting, and this ADR's measurement rests on
  it. D7 remains true of the exterior cache release seam, which frees no GPU
  byte and measures none. An append-only cross-reference is recorded at that
  seam's gate 4 comment.
- **ADR 0046 D1 is NOT recomputed here.** The full-city retention and assembly
  storage design was derived against embedded payloads. These four `-t1`
  releases change per-release payload size, so D1's arithmetic would move. It is
  ROUTED TO T004 rather than adjusted in passing, because recomputing a storage
  design from inside a texture task is exactly how two designs start disagreeing.

## Operational-safety fix, disclosed

The four wave pipelines defaulted a missing stage to `all`. A bare invocation —
and `--help`, whose only token is a flag — therefore STARTED the full five-stage
pipeline. That happened during this task: `--help` was typed, a real run began,
it was killed immediately and damaged no artifact. `scripts/wave-cli-arguments.mjs`
replaces the default with a fail-closed grammar shared by all four pipelines.
It is in scope as an operational-safety fix and is disclosed rather than folded
into the feature work.

## Consequences

- Four new immutable opt-in releases exist. Default serving is unchanged.
- Promotion is NOT decided here. It needs its own evidence and is T005's call.
- The runtime now has two model-delivery paths. Which one applies is decided by
  the release's own manifest, never by a flag, and the Blob path is byte-identical
  for every release frozen before this change.
- One Cesium-internal export is named in one file
  (`src/features/explorer/cesium-resource-cache.ts`), pinned at 1.143.0. A
  version bump invalidates the reading rather than adjusting it.
