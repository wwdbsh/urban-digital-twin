# 2026-08-15 — Shared per-class texture images (T002)

Durable implementation record for ADR 0047. What was built, in what order, what
it cost, what was found out the hard way, and what is still open.

## What shipped, in four commits

1. **Library half.** `canonical-glb.ts` gained `uriTextures`, the URI-image
   sibling of the embedded texture set, with the embedded branch proven
   byte-identical against the pre-change writer (digest pinned in-test).
   `multi-lod-assembly.ts` gained the `role: "texture"` artifact — release-scoped,
   cell-less, claimed by no LOD, refused if no GLB draws it — and
   `validateProceduralTextureUriGlb`, a SIBLING gate. The two existing image
   gates are byte-untouched. `parseGlbV2` gained an opt-in
   `allowExternalImageUri`, default false.
2. **Runtime half.** The Verified `Resource` subclass, session-scoped tile
   verification, the `shared-texture-invalid` failure code, and the viewport
   branch. The Blob path is unchanged for every release frozen before this.
3. **Releases.** The `-t1` variant mechanism, the four `-t1` releases staged per
   wave, and the wave-CLI argument guard.
4. **Evidence.** The GPU probe, the campaign, the rollback rehearsal, ADR 0047
   and this record.

## The accidental pipeline invocation — disclosure

While orienting in the wave pipelines, `node scripts/southern-remainder-cli.mjs --help`
was run. It did not print help. The parser was
`const stage = requested[0] ?? "all"` over tokens that excluded anything
starting with `--`, so a flags-only invocation resolved to the `all` stage and
**started the real five-stage pipeline**. It was killed within seconds. No
payload root, record root or receipt was written; the four `-p1` payloads were
subsequently re-verified file-by-file against their committed inventories with
zero mismatches, twice.

The fix is `scripts/wave-cli-arguments.mjs`: one grammar shared by all four
pipelines, because the original default survived unnoticed in four separate
copies. The stage is required; `--help`, a bare invocation, an unknown flag, an
unknown stage, an unknown variant and an extra positional all print usage and
exit 1 having touched nothing. `all` still works and still has to be typed.

This is disclosed as an operational-safety fix taken in scope, not as feature
work, and it is recorded in ADR 0047 as well.

## Things that were found rather than assumed

**Cesium's `clone()` does not preserve a subclass.** `Resource.prototype.clone()`
called with no argument constructs a base `Resource`. Cesium clones on every
path this design depends on — `createIfNeeded` (twice), `getDerivedResource`
(image URIs and cache keys), `GltfLoader`'s `baseResource = gltfResource.clone()`,
and `ConstantProperty` on set and on every read. The subclass survives because
`clone` is overridden here. Had it not been, the model would have degraded to a
plain resource pointed at a real URL and begun fetching unverified bytes with no
error anywhere. This is the single most load-bearing line in the change.

**`texturesByteLength` includes the mip chain.** The probe module first
documented it as base-level only. Instrument validation against a known texture
count refuted that immediately: the reading divides exactly by 87,381, which is
`65,536 * 4/3` truncated. Both campaign arms validate with delta zero once the
prediction is corrected. This is why the instrument is validated before it is
used, and it is why the ADR quotes 87,381 rather than 65,536.

**`midtownCoreGlbBounds` had to be widened.** It parses the emitted GLB to read
POSITION accessors. It admits nothing and gates nothing, but it refused a
URI-image GLB and stopped a measurement. It gained an opt-in parse widening,
defaulted false, passed only by the shared-uri materialization path.

**The class a URI names is recovered from bytes, twice.** Once from each tile's
digest through the rasterizer replay index (so a URI can never name a class the
bytes are not), and again from the WRITTEN GLB's own image array (so a tile the
writer dropped as unreferenced is never declared and never becomes the orphan
the release gate refuses). Neither recovery restates the writer's rule; both
read what the writer produced.

## Generation

Per wave: `plans`, `glbs`, `gates`, `graph`. No `sample` stage — the Blender
inspection sample is chosen on geometry and this variant's geometry is the
promoted release's geometry. Wave w03 was the longest at roughly 50 s + 78 s +
0 s + 6 s.

| wave | release | GLBs | tiles | files | bytes | vs `-p1` |
| --- | --- | --- | --- | --- | --- | --- |
| w03 | `manhattan-southern-remainder-cells-20260812-t1` | 179 | 4 | 723 | 50,361,628 | -8,833,077 |
| w02 | `manhattan-lower-manhattan-cells-20260812-t1` | 71 | 4 | 349 | 48,331,187 | -3,469,512 |
| w04 | `manhattan-central-upper-manhattan-cells-20260812-t1` | 40 | 4 | 379 | 28,154,768 | -1,925,152 |
| w05 | `manhattan-northern-manhattan-cells-20260812-t1` | 24 | 4 | 264 | 15,824,701 | -1,128,042 |
| | **total** | **314** | **16** | | **142,672,284** | **-15,355,783** |

Each wave was validated before the next was started, so a failure would have
stopped with the earlier waves already recorded. Per wave: assembly replay green
under the release's own declared admission; all four declared tiles replay
byte-for-byte against `proceduralTextureCatalog()`; every committed inventory
entry re-verified against the payload (0 mismatches). The four frozen `-p1`
payloads were re-verified after every wave: 1,699 files, 0 mismatches.

## Open items

- **Promotion is not decided.** The `-t1` releases are `?exteriorCells=` opt-in
  only and absent from the promotion record. T005 owns that decision.
- **ADR 0046 D1 is not recomputed.** Payload sizes moved; the full-city storage
  design derived against embedded payloads is routed to T004.
- **Close-range facade parity is not claimed.** The committed stills are
  byte-identical between arms at the campaign pose, but that pose frames the
  cells from above rather than a facade at close range.
- **The GPU reading is pinned to cesium 1.143.0.** `ResourceCache.statistics` is
  a Cesium-internal export, named in exactly one file. A version bump invalidates
  the reading rather than adjusting it.
