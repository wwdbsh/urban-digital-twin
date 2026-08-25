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

The flat ground renders behind the explicit `ground=manhattan-ground-20260824`
URL flag (default byte-for-byte unchanged without it): fail-closed loader
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

## Known limitations (recorded, not hidden)

- The Manhattan ground extent (`-74.03/40.68/-73.90/40.89`, outward-snapped
  to 140 level-14 cells) is a declared envelope, not a surveyed boundary;
  T006 must validate it against the real hydrography/shoreline snapshots.
  A feature outside it fails the build (fail-closed) and widening it changes
  `ledgerId`.
- `{kind:"bounds"}` occupancy is a documented over-approximation for
  fixtures; real polygons must use `declared-cells` from an actual clipper
  (T006).
- Contracts are validated invariants, not observed rendering; nothing is
  wired to the runtime yet.
