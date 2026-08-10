# 0027 — Block 835 generative exterior completion and canary release

- Status: Accepted
- Date: 2026-08-11
- Supersedes: none. Supersedes **statements** in 0020 and 0026 only as scoped in
  Decision 3 below; both ADRs stand unchanged for V1.
- Related: 0011 (Blender MCP install and threat model), 0019 (provider-neutral
  exterior contracts), 0020 (deterministic facade plans), 0021 (multi-LOD
  assembly packages), 0022 (rights-cleared evidence intake), 0023 (exterior
  streaming dual profiles), 0024 (exterior wave ledger), 0026 (Block 835
  generated-exterior reference asset authoring)

## Context

ADR 0026 recorded `manhattan-esb-block-reference-20260810`: the first Block 835
package carried through the deterministic facade plan and multi-LOD assembly
contracts. Its V1 grammar produces no geometry for five of the fifteen required
exterior component kinds — `setbacks`, `balconies`, `fire-escapes`,
`water-tanks` and `signage` — so those kinds ship declared `absent`.

Two binding user decisions were recorded on the T008 Issue (#9):

- **Decision A.** Those five kinds must be *generated* as complete deterministic
  geometry at truth tier `generated`. Signage is limited to blank sign-band and
  blade massing with strictly zero text, brand or tenant content. The promotion
  gate was not to be weakened, and the 20260810 package was not to be edited in
  place.
- **Decision B.** The `jh45-qr5r` (NYC OTI Building Footprints) approval
  envelope is broadened to public display, derivative conveyance and
  redistribution **of generated geometry**. Public deployment stays excluded.

This ADR records how those decisions were implemented as a new package,
`manhattan-esb-block-reference-20260811`, plus the browser-reachable canary
release graph `manhattan-exterior-cells-20260811` that carries it.

## Decision 1 — A V2 sibling generator, not an edit to V1

`src/domain/deterministic-facade-generator.ts` is byte-frozen. The committed
20260810 package is a drift-tested artifact of it: a test rebuilds the package
from the committed inputs and asserts the on-disk manifest fingerprint and every
artifact checksum. Any change to V1's grammar changes those bytes, which would
either break that gate or force a rewrite of an immutable approved package.

Generative completion therefore lives in a sibling module,
`src/domain/deterministic-facade-generator-v2.ts`, with its own identity:

| Field | Value |
| --- | --- |
| Schema version | `2.0` |
| Generator id | `urban-digital-twin:deterministic-facade-plan-v2` |
| Generator version | `2.0.0` |

V2 imports nothing from V1 that could drift V1 output; it shares only the
provider-neutral `exterior-contract.ts` vocabulary and the deterministic hash
helpers. `ABSENT_KINDS`, `buildInventory` and the V1 canonicality guard are
untouched, and the 20260810 drift test still passes unchanged.

The plan *vocabulary* is deliberately the same shape — materials, surfaces,
placements, topology — so the canonical tessellator and the closed-profile GLB
writer extend rather than fork.

Keeping both generators keeps both honest: V1 continues to say truthfully that
it generates nothing for five kinds, and V2 says truthfully that it generates
all fifteen. Neither has to lie about the other's output.

## Decision 2 — Generative completion, with a signage honesty rule

Per Decision A, all fifteen `REQUIRED_EXTERIOR_COMPONENT_KINDS` are `generated`
in V2. `absent` is **not expressible** in the V2 inventory at all, so the
completion is a property of the grammar rather than a per-building choice.

The grammar additions are:

- **Stepped massing tiers.** `tierCount` is always at least 2 and scales 2..5
  with floor count, so setback geometry is real geometry on every building, not
  a special case for towers.
- **Setback decks.** A horizontal deck surface is emitted at every tier
  boundary.
- **Balconies and fire escapes.** Facade-attached protrusions on a floor
  interval.
- **Signage.** A blank sign band above the ground-floor opening plus a blade
  sign massing.
- **Water tanks.** A rooftop even-sided prism on four leg prisms. Prisms are a
  new plan concept; the side count is even so the caps decompose into quads and
  stay inside the quad-only canonical GLB writer.

The promotion gate was **not** weakened. Nothing was reclassified to make it
pass: the silhouette bound stays 2 %, the budgets stay 75,000 triangles / 8
materials / 0 textures, the registration tolerances stay 0.25 m and 0.5 m, and
the same `--require-texture-free` multi-LOD validation is enforced.

Two uncertainty statements travel verbatim on the plans and on every shipped
asset:

> `DETERMINISTIC_FACADE_V2_UNCERTAINTY` — "Procedurally generated complete
> exterior in local millimetres. Every component is generated from footprint and
> height constraints only; it does not assert real-world facade, setback,
> balcony, fire-escape, water-tank or signage accuracy, nor any tenant, brand or
> text."

> `DETERMINISTIC_FACADE_V2_SIGNAGE_UNCERTAINTY` — "Generated blank sign-band and
> blade massing only. No real-world sign presence, size, position, orientation,
> text, brand or tenant is asserted, and no glyph, logo or lettering is
> generated."

The signage rule is a hard property of the grammar, not a convention: V2 emits
no glyph, no logo, no lettering and no texture of any kind anywhere, and the
package is texture-free by construction, so there is no route by which tenant or
brand content could ride inside a shipped asset.

## Decision 3 — Supersession by pins; 20260810 is not edited

`manhattan-esb-block-reference-20260811` supersedes 20260810 by **citation
only**:

- every `AssemblyAsset.predecessor` is that building's 20260810 `lod_0` artifact
  pin, `manhattan-esb-block-reference-20260810:<buildingId>:lod_0` with that
  artifact's immutable checksum. **This is the only place 20260810 is cited**,
  and it is what carries the supersession;
- `cells[0].predecessor` is copied from the 20260810 manifest's
  `cells[0].cellRelease`, which itself pins the shared upstream pilot release
  `manhattan-esb-block-exterior-pilot-20260805`. So the cell-level predecessor
  records the *inherited source lineage*, not a citation of 20260810: both
  packages are cell releases derived from the same pilot snapshot. Reading that
  field as "the previous package" would be wrong.

Not one byte of 20260810 changes. Both packages remain on disk, both remain
immutable, and both remain drift-tested by their own committed-package tests.

**Scoped supersession of prior statements.** ADR 0020 states that in V1 plans
"signage is always absent … with wording that means no representation was
produced, never that real-world signage is absent", and ADR 0026 Decision 2
states that "signage stays `absent` for all 14 buildings, so the package makes
zero tenant, brand, text or signage claims". Both statements are **superseded
for V2 only**. They remain accurate and binding for V1 and for the 20260810
package they describe. What does *not* change in either direction is the
underlying honesty rule: V1 absence was never a claim that real signage is
missing, and V2 presence is never a claim that real signage exists.

## Decision 4 — Evidence-graph fabric, with a reproducible approval fingerprint

20260810 set every asset's required `evidenceShardId` to the explicit sentinel
`evidence-shard:none:block-835-reference-20260810`, because no shard existed.
The canary release graph carries one real shard per building, so 20260811 uses
truthful per-building ids:

```
evidence-shard:manhattan-esb-block-reference-20260811:<canonicalBuildingId>
```

Each of the 14 shards declares exactly one source, one license and one approval,
and an empty `evidence: []` array. The empty array is the honest statement: the
shard records the *rights basis* under which generated geometry is conveyed, and
there is still **no admitted rights-cleared exterior imagery or survey** for
Block 835. ADR 0022's intake path remains unused; no asset carries the
`evidence-backed` truth tier and the assembly still rejects one if it appears.

The approval fingerprint is derived as:

```
sha256HexSync(stableSerialize({ scope, exclusions, approvedAt, approvalNote }))
```

`stableSerialize` is the repository's canonical key-sorted serializer, so the
fingerprint is reproducible from those four fields alone. For the canary
approval `approval:manhattan-exterior-cells-20260811:public-canary` it yields
`ec15715560f61045803a7401effd5f161a93bbce2c849163c0be158fe82dbafc`.

One caveat matters for anyone re-deriving it: `approvalNote` is **not** a field
of the emitted approval object. It is the build-time constant
`BLOCK835_CANARY_APPROVAL_NOTE` in `src/release/block835-canary-release.ts`,
which records the 2026-08-11 in-session user authorization verbatim. The
fingerprint therefore commits to text that is deliberately kept out of the
shipped JSON, and it can only be recomputed from that module — not from
`release-graph.json` in isolation. That is intentional: the hash binds the
shipped approval to the authorization that granted it. It is documented here
rather than left opaque because an approval hash nobody can re-derive is not
evidence of anything.

## Decision 5 — Canary graph shape and the anti-leak invariant

`public/data/manhattan-exterior-cells-20260811/` is a browser-reachable exterior
cell release graph containing the Block 835 snapshot:

- `index.json` declares `defaultHead` = the single Block 835 snapshot
  (`snapshot:manhattan-exterior-cells-20260811:v1`) and `canaryHeads: []`. A
  canary with an empty canary-head list is deliberate: this wave promotes one
  snapshot as the default head rather than running a parallel head, so there is
  exactly one thing a client can resolve and no split-brain between heads.
  `baseCompatibility.baseReleaseIds` is
  `["manhattan-citywide-20260804", "manhattan-civic-context-20260804"]`, and the
  index also declares `localOnly: true` and `runtimeExternalNetwork: false`.
- `release-graph.json` declares one private root
  (`root:manhattan-exterior-cells-20260811:private`) and one public root.
- `assemblies.json` declares one assembly with `audience: "public"` for
  `manhattan-esb-block-reference-20260811`: 29 artifacts (28 GLB plus the
  tileset), 14 assets, 3,588,230 declared bytes — the same content as the
  private package, re-rooted.
- The 29 artifact byte copies live under `public/`, alongside 14 inventory
  shards, 14 evidence shards, the cell release, the public ownership ledger and
  the rollout snapshot.

**Anti-leak invariant.** The private root declares **exactly one** artifact — its
ownership-ledger blob — and its `artifactAllowlist` has exactly one entry. No
private bytes are written to disk under a browser-reachable path; the release
directory has no `private/` subtree at all. The private root exists to carry
lineage, ownership and the approval record, not content. Making that a
structural invariant — a count of one, checkable without interpreting the
artifact — is what prevents a future edit from quietly attaching private content
to a root that a browser can fetch.

The pinning gate in the app is unchanged in kind: only ids in
`PINNED_EXTERIOR_CELL_RELEASE_IDS` resolve, and an unknown id still fails closed
with the preserved "is not pinned by this build" message.

## Decision 6 — Broadened source envelope, deployment still excluded

Per Decision B, the `jh45-qr5r` entry in `src/data/source-registry.ts` now
carries a dedicated `generatedGeometryConveyanceDerivative` policy rather than
the shared `openDerivative` constant, so no other source's envelope moves with
it. The broadening is recorded in the entry's `approvalNote` as a 2026-08-11
in-session user authorization and covers:

- public display,
- derivative conveyance,
- redistribution **of exterior geometry generated from the footprints**.

Three limits are explicit in both the policy constraints and the approval note:

1. Redistribution covers the generated geometry only, **never** the raw
   `jh45-qr5r` source dataset.
2. Public **deployment** remains excluded.
3. NYC OTI attribution, the City modified-data disclaimer, source IDs, capture
   timestamp, checksum, CRS and height uncertainty must travel with any
   conveyed derivative.

## Decision 7 — LOD 1 composition, and why the measured deviation is 0

LOD 1 keeps the massing envelope **and every protruding component** — balconies,
fire escapes, sign band, blade sign, roof equipment and the water-tank prisms —
and drops **only** recesses (windows, entrances, storefronts) and flush cornice
trim.

The reasoning is geometric, not aesthetic: only a strict protrusion can change a
projected silhouette. A recess is by definition inside the envelope and a flush
band is on it, so removing either cannot move an outline. That is why V2 can add
a large number of new components and still measure a silhouette deviation of
exactly **0.0** against the 2 % bound, across 4 compass views for all 14
buildings.

This is a measured result, not an assertion. The deviation is measured in
Blender from fixed-view orthographic renders and bound to each plan hash in the
committed measurement file; the builder refuses to run when a measurement's plan
hash does not match the plan it is building. The V1 package reached zero the
same way by dropping *all* facade detail; V2 reaches it by dropping only the
parts that provably cannot matter.

Shipped GLBs remain **+Y up**, written through the same `toGltfYUp` rotation the
20260810 pipeline uses, with tile bounding volumes and tile transforms left in
the z-up ENU tile frame. That decision is unchanged and is recorded in ADR 0026
Decision 5; this package reuses it rather than restating it.

## Rollback

Revert the PR and delete the new directories:

- `public/data/manhattan-esb-block-reference-20260811/`
- `data/manhattan-esb-block-reference-20260811/`
- `public/data/manhattan-exterior-cells-20260811/`

`manhattan-esb-block-reference-20260810`, the fixture release
`udt-fixture-exterior-cells`, and every other pinned package
(`manhattan-esb-block-exterior-pilot-20260805`,
`manhattan-esb-block-public-realm-20260806`, `manhattan-citywide-20260804`,
`manhattan-civic-context-20260804`) are untouched by this work, so nothing needs
rebuilding. Removing `manhattan-exterior-cells-20260811` from
`PINNED_EXTERIOR_CELL_RELEASE_IDS` returns the app to fixture-only exterior
streaming; the unknown-id path already fails closed.

Reverting the `jh45-qr5r` envelope is a separate, independently revertible edit
to `src/data/source-registry.ts`: restore `derivativePolicy: openDerivative` and
the prior `approvalNote`.

## Consequences

- Two facade generators now exist and must both be maintained. A change to
  shared plan vocabulary must be checked against both, and the V2 Blender
  transliteration must be updated with the V2 tessellator or the re-import diff
  fails.
- V2 gained `validateSurfaceContainmentAndOverlap`, a guard V1 already had in
  spirit ("Placement exceeds its surface bounds"). Its absence let a blade sign
  overrun its tier facade and emit phantom solid volume; the analytic volume
  identity caught it. Any future V2 placement kind inherits that guard for free.
- The evidence-shard sentinel pattern is now retired for this package family,
  but only because real shards exist. It stays correct for 20260810.
- The approval fingerprint formula is now a documented contract. Changing the
  fields it commits to changes every shard fingerprint and must be treated as a
  graph rebuild.

### What this package does not claim

- The grammar is **procedural**. Setbacks, balconies, fire escapes, water tanks
  and signage are generated from footprint and height constraints only.
- The massing is the **minimum-area oriented bounding rectangle** of the DOITT
  footprint, not the footprint itself (ADR 0026 Decision 3).
- Nothing here asserts real-world facade, setback, balcony, fire-escape,
  water-tank or signage accuracy for any of the 14 buildings.
- There is **zero** text, glyph, logo, brand or tenant content anywhere in the
  package.
- Passing every deterministic, geometric and profile gate proves pipeline
  determinism, geometric closure and contract conformance. It is not evidence of
  architectural, material or visual accuracy, and the package must not be
  presented as showing what these buildings actually look like.
