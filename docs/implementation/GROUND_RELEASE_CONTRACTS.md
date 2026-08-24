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
