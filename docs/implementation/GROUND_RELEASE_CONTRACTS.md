# Ground release contracts (T005, Goal #129)

Durable record of the citywide public-realm ground contracts introduced by
`src/domain/ground.ts` and `src/release/ground-release.ts` (PR for Issue
#134). The code and its 78 colocated tests are the schema authority; this
records the decisions a future maintainer must not rediscover in a PR.

## Decisions

1. **Ground has its own space-filling partition** (`partitionSchemeId:
   ground-partition-v1-level14`). Exterior wave-ledger cells are frozen
   building shards — tiles with no buildings (rivers, park interiors) have no
   cell — so they cannot host ground. Ground cells tile a declared extent
   exactly once, and the validator enforces coverage-exactly-once (an
   invariant the exterior ledger does not have). The scheme id is part of
   ledger identity: changing the partition is an explicit new scheme, never a
   silent cellId rewrite.

2. **Two-level identity.** A multi-cell polygon (Central Park, a river) is
   one deep-linkable `GroundFeature` (canonicalFeatureId) split into
   deterministic per-cell `GroundFeaturePart`s (partId, owned by exactly one
   cell). Membership checksums hash sorted partIds. Identity checksums
   deliberately exclude `sourceRefs`/`uncertainty` so an evidence-only
   re-materialization does not change identity.

3. **Parks reference existing identities.** `identityOrigin:
   referenced-existing` reuses `udt:manhattan:park:<gispropnum>` ids already
   normalized under the civic approval; `GroundIdentityPolicy` (default:
   parks strict) makes minting a duplicate park id a validation failure.
   Never two selectable Central Parks. Ground-owned ids use the
   `udt:ground:<city>:<class>:<local>` namespace with class-segment checking.

4. **Classes split by nature.** Flat base classes `GroundClass =
   roadbed | sidewalk | park | plaza | water` versus near-tier 3D
   `GroundEmbellishmentClass = curb | crosswalk`, the latter pinned to
   `claimLevel: "estimated"` at the type level and in validators (matching
   the Block 835 claim-ceiling precedent). This keeps "every cell has
   roadbed+sidewalk" statable without conflating embellishments.

5. **Minimal `GroundTier`, not `AssemblyLod`.** `AssemblyLod` is a
   building-GLB contract (silhouette/facade-plan obligations) and was
   rejected for ground. Every asset must have exactly one flat tier with
   `maxDistanceMeters: null` — the always-covering standalone cartographic
   base required by the Goal. Runtime tier selection is intentionally NOT
   contracted here (T007/T010); `selectExteriorLod` reuse was rejected
   because its exploration profile would render flat at every distance.

6. **Imagery seam reserved.** `GroundReleaseDocument.zoneImagery` is an
   optional, additive slot (zoneRef, artifactRef, checksum, captureYear,
   attribution) that fails closed to the polygon base, so T012/T013 do not
   need a hash-breaking schema change.

7. **Conventions.** cityId uses the wave-ledger form `city:manhattan`
   (`block835-public-realm-release.ts` still uses bare `manhattan`; consumers
   joining them must translate explicitly). Ordering is south-to-north then
   west-to-east; id sorting is by code unit, never `localeCompare`. Hashing
   reuses `src/domain/deterministic-hash.ts` exclusively. No budget numbers
   are restated; materialization tasks derive against live budgets.

## T006 materialization record (release `manhattan-ground-20260824`)

Built by `scripts/manhattan-ground-build-cli.mjs` (deterministic: two full
builds byte-identical across 356 files); validated by
`scripts/validate-manhattan-ground-release.mjs`, composed into
`pnpm citywide:validate` alongside the untouched buildings phase.

- **Content-addressed identity**: `udt:ground:manhattan:<class>:<sha256-16>`
  over `{geometry, properties}` — chosen because measured source ids are not
  identities (1,853 duplicate roadbed `source_id`s, sidewalk `"0.0"` ×871,
  plazas have none). `source_id`/`objectid` retained as attributes;
  0 collisions across 42,384 minted ids.
- **Scale**: 140 cells, 42,778 features → 47,779 parts, 352 per-class
  per-cell JSON artifacts, 182 MB. Only boundary-crossing features are
  clipped (Sutherland–Hodgman vs cell rectangle, no buffer); single-cell
  features require full containment (build-failing assertion).
- **Coordinates quantized to 7 dp** (~1.1 cm), disclosed in
  `geometryValidation.method`. One roadbed sliver (0.0066 m²) has no
  representable area at 7 dp and was explicitly REFUSED with measurements
  (refusal-transparency precedent), not dropped.
- **Area gates**: the pre-registered relative bar (1e-9) FAILED at 2.48e-9;
  investigation showed a relative bar cannot bound fixed-magnitude float
  error on small polygons. An absolute gate (1.07e-14 deg² ≈ 1 cm²) is
  operative; both bars, both observations, and the failure are recorded in
  the release. Areas use local-origin shoelace (naive shoelase loses ~1%
  to cancellation at −74°).
- **Honest censuses**: empty-class cells /140 — roadbed 45, sidewalk 45,
  water 64, plaza 102, park 92 (water/margin cells; the "every cell has
  roadbed+sidewalk" acceptance wording is unmeetable literally and is
  recorded as a census instead). 66 self-touching rings shipped unrepaired
  and measured for T007. Pavement-edge (45,129 features) deliberately left
  raw for T009.
- **Known gap**: `generatedAt` tampering is NOT caught (T005 schema has no
  self-digest field) — future schema task.

## T007 runtime canary record

At T007 the flat ground rendered behind the explicit
`ground=manhattan-ground-20260824` URL flag, with the default session
byte-for-byte unchanged without it. **T008 inverted that** — the ground is now
the default and the flag is the explicit request; see the T008 section below.
The rest of this record describes the machinery, which T008 did not change:
fail-closed loader
(`src/runtime/ground-release-runtime.ts`) with runtime SHA-256 of every
artifact plus re-derivation of the unhashed ledger/identity manifests;
visibility-driven per-cell per-class streaming under borrowed
`CITYWIDE_BUDGETS` caps (24 visible cells / 48 MiB / 4 requests) with a
visibility-protected LRU; per-class `PrimitiveCollection` batches; the 66
non-simple rings are skipped with a counted refusal, never repaired; ground
picks resolve to `ground:<canonicalFeatureId>` (cell/tier-independent) and
surface class, claim level, referenced park identity, and release provenance
in the details panel. SHA-256 falls back to the repository's pure-JS digest
when `crypto.subtle` is absent (plain-http LAN serving is a legitimate
local-first context; discovered when an insecure context refused all 161
fetched artifacts for a reason unrelated to integrity).

Browser verification (2026-08-24, dev server): street grid + sidewalks +
parks + Hudson water rendered (readings: "6 cells drawn · 2055 polygons",
"24 cells drawn · 14738 polygons" at region view with the cell cap binding);
park pick → `groundFeature=udt:manhattan:park:M022` deep link with
referenced identity in details; `groundFault=artifact-checksum` → "0 cells
drawn … 3 cell artifacts refused (verification failed)" with zero partial
geometry. Camera-pose capture was hampered by pre-existing Issue #46
(presets intermittently write roll=180; URL pose not applied at boot) —
unrelated to the ground overlay and left to its own backlog item.

## T009 embellishment record (release `manhattan-ground-embellishment-20260825`)

Curbs-only, by adversarially-reviewed decision: Block 835's crosswalks are
enumerated (bbox corners of a hardcoded building union) and the repo has no
intersection ground truth (route-graph is a synthetic 6-node fixture), so
geometric crosswalk inference would ship an unfalsifiable "estimated" claim.
Crosswalk generalization is deferred pending a user decision on acquiring an
authoritative intersection/centerline source (goal PENDING-DECISIONS P2).

- **Tier invariant amended (deliberate schema change)**: surface-class assets
  keep "exactly one unbounded flat tier"; embellishment-class assets require
  ≥1 finite `near-3d` tier and NO flat tier — additive 3D that vanishes at
  distance and must never be the standalone base (`src/domain/ground.ts`).
- Separate release id/document; the shipped flat release and the T007 loader
  guard are untouched (regression-tested). Runtime consumption is T010's.
- Generator: `scripts/manhattan-embellishment-cli.mjs` + shared derivation in
  `src/release/ground-embellishment.ts` (the Block 835 equivalence fixture
  runs the same code the CLI runs). Liang-Barsky segment clip ported into
  `ground-geometry.ts`; clipped line pieces are never bridged (bridging would
  invent pavement edge); L1 lengths used for conservation ratios (additive
  across splits, no `Math.sqrt`).
- Scale: 45,129 pavement-edge features → 49,621 parts across 95/140 cells,
  94.5 MB artifacts, 0 refusals/collisions; two builds byte-identical (102
  files). Near-ring 400 m aliased with a drift-check test against
  `EXTERIOR_TWO_LOD_SERVING_NEAR_RING_METERS`.
- Block 835 promoted release proven byte-identical after the whole run;
  record-level curb equivalence (geometry verbatim, 0.22 m profile, estimated
  label, derivation id) asserted by fixture.
- Watch item: largest artifact is 94.6% of `geometryShardBytes`; nothing
  gates per-artifact size yet (T010 must set the serving ceiling).

## Known limitations as recorded at T005 (with their later disposition)

- The Manhattan ground extent (`-74.03/40.68/-73.90/40.89`, outward-snapped
  to 140 level-14 cells) is a declared envelope, not a surveyed boundary;
  T006 must validate it against the real hydrography/shoreline snapshots.
  A feature outside it fails the build (fail-closed) and widening it changes
  `ledgerId`.
- `{kind:"bounds"}` occupancy is a documented over-approximation for
  fixtures; real polygons must use `declared-cells` from an actual clipper
  (T006).
- Contracts are validated invariants, not observed rendering; nothing was
  wired to the runtime at T005. **Superseded**: T007 wired the fail-closed
  loader (`src/runtime/ground-release-runtime.ts`) and T008/T011/T013 made
  the ground, its curbs, and its zone imagery the default — see those
  sections. What remains true is the narrower original point: a passing
  contract validator is still not evidence of observed rendering, which is
  why each runtime section carries its own separate evidence.

## T008 — the ground becomes the default (2026-08-24, Issue #137)

Contract hash
`a0725a6958c9bb690de7e20b94d5dd631161a64515f4b35a6d21cf78690390ee`.
Decision record: [ADR 0059](../decisions/0059-cartographic-ground-default-flip.md).

**No release byte changed.** `manhattan-ground-20260824` — 140 cells, 42,778
features, 47,779 parts, 352 artifacts, ledger
`ground-ledger:city-manhattan:ground-partition-v1-level14:35a834d29aafc8be7f4352c61d575f03`
— is exactly what T007 shipped. No budget was raised: the runtime keeps the
borrowed `CITYWIDE_BUDGETS` ceilings and the T007 caps (24 cells / 48 MiB).

- **One switch.** `GROUND_DEFAULT_ON = true` (`src/app/App.tsx`), read by the
  boot parse, the `popstate` parse and `appendGroundUrl` and nowhere else.
- **URL contract, polarity-agnostic.** Silent = the default;
  `?ground=manhattan-ground-20260824` = an explicit request honoured in either
  polarity; `?ground=off` = the opt-out; any other spelling resolves to the
  default rather than to an unverifiable release. The writer states the opt-out
  and deletes the parameter otherwise, so default links carry no ground token.
- **Grid demoted, not deleted.** `GridImageryProvider` is still constructed once
  per viewer; `ImageryLayer.show` follows `syntheticGridVisible(groundActive)`.
  Idle, loading, **failed** and opted-out sessions keep the grid, so a failed
  verification is grid + explicit failure line, never a void.
- **Boot cost published, not claimed.** The status line reports
  `verified in N ms` (`data-ground-verify-ms`) from the session's own load.
  Node-side over the same loader: 690 / 659 / 661 / 666 / 655 ms, **median
  661 ms** for documents + graph + re-derived identity (42,778 features, 103
  materialized cells). Per-cell artifacts stay lazy and checksum-verified at
  draw time. **No idle-deferral was built** — recorded as ADR 0059 risk 1.

### Verification run for this record

- `pnpm citywide:validate` — both phases pass. Ground phase: 140 cells,
  42,778 features, 47,779 parts, 352/352 artifacts, 13,154,558 coordinates
  checked, max relative area error 2.48e-9, max cell excursion 5.0e-8 deg.
- `pnpm citywide:benchmark` — cold/warm search P95 13.65 / 13.55 ms (baseline
  16.96 / 16.81), cold/warm pick P95 4.55 / 1.77 ms (baseline 6.44 / 2.68),
  shard loads 117/78 and 30/2 and 451 bounded shards / 304,382,520 bytes, all
  identical to baseline. **It measures no ground byte**; it is evidence only
  that the flip left the buildings/search path undisturbed.
- **Rollback rehearsal, both polarities, on the branch.** With
  `GROUND_DEFAULT_ON = false`, the HEAD (pre-flip) copy of
  `ground-canary.test.tsx` passes **6/6** — pre-flip default behaviour is
  restored exactly — while the new suite fails exactly its three default-ON
  pins and nothing else. Restored to `true`, the new suite passes 12/12. The
  three pre-existing `App.test.tsx` exterior-streaming timeouts fail in the OFF
  polarity too, so they are not caused by this flip.

## T011 — near-tier curbs promoted island-wide (2026-08-26, Issue #140)

**No release byte changed.** `manhattan-ground-embellishment-20260825` is
exactly what T009 shipped — 95 cells with curb artifacts, 49,621 parts,
94,477,695 artifact bytes. **No budget was raised**: the serving ceiling is
still `CITYWIDE_BUDGETS.geometryShardBytes` (2,097,152) and the active-cell
ceiling is still the derived `GROUND_EMBELLISHMENT_MAX_ACTIVE_CELLS` = 4.

**One edit.** `GROUND_EMBELLISHMENT_CANARY_WAVES` went from `["midtown-core"]`
to every row-owning wave of `EXTERIOR_WAVE_PLAN`. T010's prediction held: no
consumer, no ledger, no artifact and no budget changed with it.

### Per-wave census (`pnpm ground-embellishment:census`)

Measured over checksum-verified shipped artifacts; walls and segments come from
the production render planner, triangles are its own 2-per-segment identity.

| wave | rows | cells | artifact bytes | parts | walls | segments | triangles | largest artifact | worst-case ring |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| midtown-core | 4481-4482 | 12 | 12,418,615 | 6,593 | 6,600 | 379,672 | 759,344 | 1,480,256 (70.6%) | 4 |
| lower-manhattan | 4485-4488 | 26 | 28,223,296 | 14,786 | 14,801 | 866,327 | 1,732,654 | 1,983,941 (94.6%) | 4 |
| southern-remainder | 4483-4484 | 12 | 13,307,589 | 7,152 | 7,158 | 405,365 | 810,730 | 1,714,767 (81.8%) | 4 |
| central-upper-manhattan | 4478-4480 | 15 | 11,569,763 | 6,267 | 6,285 | 351,272 | 702,544 | 1,227,346 (58.5%) | 4 |
| northern-manhattan | 4471-4477 | 22 | 20,670,685 | 10,724 | 10,744 | 636,325 | 1,272,650 | 1,475,769 (70.4%) | 4 |
| **promoted release** | **4471-4488** | **87** | **86,189,948** | **45,522** | **45,588** | **2,638,961** | **5,277,922** | **1,983,941 (94.6%)** | **4** |

- **0 budget breaches.** No artifact exceeds the serving ceiling; the T009 watch
  item's 94.6% artifact is now GATED rather than merely under. The worst-case
  ring is 4 = the ceiling exactly, and it is 4 for one wave and for all five:
  promotion widens COVERAGE, not the active set, because the 400 m ring is
  smaller than a level-14 cell in both dimensions. Cache residency is therefore
  unchanged by this promotion.
- **8 cells (8,287,747 bytes) ship curbs and are never promoted**: they sit in
  level-14 row 4489, which the ground partition reaches by outward-snapping the
  declared extent and which no building wave owns. Recorded, not hidden.
- **`refusedParts` = 0** across every wave: no shipped alignment collapses to a
  single position at the release's 7-decimal precision.
- Report: `artifacts/ground-embellishment-promotion-20260826/wave-curb-census.json`,
  deterministic (no timestamps, no paths; two runs byte-identical,
  `79fee7721fe1a308958f66041380bfbaf8cb2e712d6edd17a526d1f2542913bf`). It is a
  drift gate as well as evidence: the never-skipped half of
  `ground-embellishment-wave-census.test.ts` re-applies both budget gates to the
  committed numbers on every run, and where the release tree is present the
  second half re-measures and requires byte-identity.

### Rollback

**Per wave, one line.** Deleting a wave id from
`GROUND_EMBELLISHMENT_CANARY_WAVES` deactivates exactly that wave's level-14
rows: those cells stop being offered to the renderer and `loadCellClass` refuses
them by name, while every other wave keeps serving and the flat base is untouched
in either direction. No release byte, no budget and no other module is involved.
Proven at two levels: `ground-embellishment-runtime.test.ts` rehearses removal of
each of the five waves in turn (exactly that wave's rows leave, all others stay),
and `ground-canary.test.tsx` rehearses it as a session.

### Wave left out, and why

**`block-835` is not promoted, and its curbs are still served.** It is the one
wave in the plan with `tileRowRange: null` — a declared building set carved out
of a tile, not an owner of level-14 rows — so it cannot scope a row-based ground
gate at all, and `groundEmbellishmentCanaryTileRows` refuses it by name rather
than letting it contribute nothing. The ground beneath that block lies in rows
4481-4482, which `midtown-core` promotes. This is a naming exclusion, not a
coverage gap. It is NOT a budget refusal: no wave breached.

### Verification run for this record

- `npx vitest run` on `ground-embellishment-runtime.test.ts` (18), `ground-canary.test.tsx` (16),
  `ground-embellishment-wave-census.test.ts` (7), `ground-embellishment-render-plan.test.ts` — all pass.
- `pnpm typecheck`, `npx eslint` on the changed files, `pnpm build`, and
  `pnpm citywide:validate` (all three phases) pass.
- **Not measured here**: frame time, memory and visual acceptance of curbs drawn
  in five waves rather than one. The census bounds what CAN be resident (4 cells,
  largest 1.98 MB) but is not a rendering measurement; browser validation of a
  camera roaming the promoted rows remains outstanding.

## T013 — zone orthoimagery in the default view (2026-08-26, Issue #142)

`ZONE_IMAGERY_DEFAULT_ON = true`. A default session that already has a verified
ground base loads `manhattan-ground-zone-imagery-20260826` and draws each
textured park, plaza and water zone with its 2024 orthoimagery instead of a flat
colour. **Imagery rides the ground default recorded in ADR 0059 and cannot turn
itself on without one**: the loader is gated on a loaded base release, so no
separate ADR is minted — the addendum in `0059` records the flip.

### What the drape actually is

The T012 contract is that each artifact is a RECTANGULAR texture covering its
ownership cell's full WGS84 rectangle, that nothing is masked at build time, and
that the zone polygon is the display mask. The renderer implements exactly that
and nothing more:

- The drawn geometry is the flat pass's own geometry — same rings, same holes,
  same `ground:` pick ids, same batch, same collection. Picking is therefore
  unchanged by construction; there is no second pick path to keep in step.
- The only addition is an explicit `PolygonGeometry.textureCoordinates`
  hierarchy computed by `zoneImageryRingTextureCoordinates`:
  `s = (lon - west) / (east - west)`, `t = (lat - south) / (north - south)` over
  the **cell** rectangle. Cesium's default polygon st normalizes to the polygon's
  own bounding box, which would squeeze a cell-sized photograph into whatever
  fraction of the cell the zone occupies.
- The appearance is a `MaterialAppearance` with a `Material.fromType("Image")`
  over the verified bytes, `flat: true`. An undraped zone keeps
  `PerInstanceColorAppearance` and its `GROUND_CLASS_COLORS` fill.
- Values are clamped to [0, 1] so a clipped vertex that rounds a step outside its
  cell samples the edge pixel rather than wrapping to the far side.

### Fail-closed, in three grades

| Failure | Consequence |
| --- | --- |
| Release document malformed, not local-only, or **compatibility pin** mismatch against the loaded ground release | whole imagery layer refused |
| `zone-imagery.json` SHA-256 ≠ the digest `release.json` pins | whole imagery layer refused — the index is hashed as bytes **before** it is parsed |
| One texture's bytes ≠ the digest the verified index declares | that one drape refused and named; every other drape and every polygon untouched |

In every grade the flat polygon base and the near-tier curbs are untouched:
`ground-zone-imagery-runtime.ts` never reads or writes the flat loader's cache,
primitives or state, and the flat loader's asset-class guard is byte-identical to
what T007 shipped.

**The compatibility pin** is the mirrored assets array: the imagery release ships
the base release's 162 park/plaza/water assets verbatim and no artifact of its
own for them. `assertZoneImageryCompatibility` requires an exact match on asset
id, cell, class, `contentSha256` and the whole tier list, plus the same
`ownershipLedgerId`. A regenerated base release therefore drops the whole layer
rather than draping 2024 pixels over polygons the build never saw.

### Attribution, on screen and accessible

Three surfaces, and the first two need no click:

1. **Status line segment** — `· imagery 2024: N zones draped across M cells`,
   appended to the flat ground's own reading exactly as the curb segment is.
2. **Persistent attribution line** — a `role="status"` note carrying vintage,
   capture window, both source agencies and the CC BY 4.0 licence in one
   sentence, present whenever ≥1 drape is visible and gone when the last one
   leaves view. A CC BY credit reachable only behind a click would put the
   obligation on the reader.
3. **Details panel** — selecting a draped zone adds capture year, capture window,
   attribution, terms, 1.2 m/px resolution, the ~1 px NAD83/WGS84 registration
   disclosure, and the release id with the index digest. A zone that is **not**
   currently draped shows none of it.

### Measured (node-side, `tsx`, warm page cache)

| Quantity | Value |
| --- | --- |
| Index gate: fetch + SHA-256 + full validation of `zone-imagery.json` | **2 ms**, 71,258 bytes, 87 entries / 75 refusals |
| Typical visible set (mid-zoom over Central Park, production selector) | 15 cells → **31 textured zones** |
| Those 31 textures: fetch + per-texture SHA-256 + admission | **30 ms**, **23,444,838 bytes** |
| Resident after that camera | 31 entries / 23.4 MB against the 48 MiB ceiling |

Budget accounting: the texture cache is a separate `GroundArtifactCache` with the
**same** `GROUND_RUNTIME_BUDGETS.maxCachedBytes` ceiling (48 MiB) and a per-texture
ceiling of `CITYWIDE_BUDGETS.geometryShardBytes` (2 MiB; the largest shipped
texture is 998,502 B). It is retained from the flat pass's own visible-key set at
the same call site, so the two caches can never disagree about what is on screen,
and both resident numbers are published rather than implied.

### Rollback

**One token.** `ZONE_IMAGERY_DEFAULT_ON = false` in `src/app/App.tsx`. Every zone
draws its flat colour, no texture is requested, and the status segment,
attribution line and details block all disappear because each is gated on a live
drape. No release byte, no budget and no other module changes.
`zone-imagery-canary.test.tsx` rehearses the opt-out as a session.

### Verification run for this record

- `npx vitest run` on `ground-zone-imagery-runtime.test.ts` (10),
  `ground-zone-imagery-render-plan.test.ts` (10),
  `zone-imagery-canary.test.tsx` (10), `ground-canary.test.tsx` (16) — all pass.
- `pnpm typecheck`, `npx eslint` on the changed files, `pnpm build`, and
  `pnpm citywide:validate` (all three phases) pass.
- **Not measured here**: rendered-verified drape registration, frame time and GPU
  memory with 31 textures resident, and whether the ~1 px misregistration is
  visible at close range. The `textureCoordinates` path is not exercised in
  jsdom — CesiumJS does not render there — so the st arithmetic is unit-tested
  and the Cesium plumbing rests on browser validation, which remains outstanding.

## T014 — named places get deep-linked poses (2026-08-26, Issue #143)

Seven landmarks are bound to one canonical ground identity each in
`src/domain/named-places.ts`, with a derived camera pose, a sourced display
name, and a deep link. Full record:
`docs/implementation/20260826-named-places.md`.

- **Ground consumers may now name a feature, but only from its source.** Each
  entry carries `sourceDisplayName` and `displayNameField` — the literal string
  and the property it was read from — so a display name is a citation, not a
  label. The only transformation permitted is recorded per entry
  (`displayNameNote`); today that is title-casing two upper-cased hydrography
  names.
- **The naming decision on record: "The Battery" (M005), never "Battery
  Park".** NYC Parks has no property with that literal name, and M283 is the
  separate "Battery Park City". No alias is offered in any surface.
- **A named-place deep link pins nothing but the pose and the ground
  selection.** No `data=`, no `release=`, and no `ground=` token: the ground
  release loads independently of data mode, and `GROUND_DEFAULT_ON` keeps the
  default polarity silent, so the link stays a request for one surface.
- **Cell extents are plate carrée.** `groundCellBounds` derives a cell's box
  from its id as 2^level equal steps of 360/2^level longitude and 180/2^level
  latitude. A Mercator reading of the same numbers misses Manhattan by ~20
  degrees; the disk half of the test checks the derivation against the
  `cellBounds` in every per-cell artifact.
- **Imagery accounting, not imagery completeness.** Every `(cell, class)` pair
  the seven places own is textured or refused with a stated reason;
  `unaccounted` is zero and the generator refuses to write the record otherwise.
  Fourteen are refusals (Hudson 22/8, East River 3/5, The Battery 1/1) at the
  edge of the retained 2024 orthoimagery footprint.
- **Not measured here**: anything visual. No screenshots were captured this
  cycle, so "recognizable" is asserted structurally only and is deferred to the
  P3 browser batch.
