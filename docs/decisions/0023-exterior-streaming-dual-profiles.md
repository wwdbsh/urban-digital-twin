# Decision 0023: exterior cell streaming and dual render profiles

Date: 2026-08-10

Status: accepted for runtime composition and synthetic-fixture validation. It
authorizes no acquisition, no provider request, no publication, no production
exterior asset, and no canary promotion.

## Decision

The browser composes versioned exterior cells through a new runtime loader,
`src/runtime/exterior-cell-runtime.ts`, and a pure runtime LOD policy,
`src/runtime/exterior-render-profiles.ts`. Nothing in the accepted release
contracts changes: `exterior-release.ts`, `citywide-release.ts`,
`travel-context-release.ts`, `composed-release-runtime.ts` and everything under
`src/domain/` keep their exact behavior. The only change to an accepted module
is an export-only one in `src/release/multi-lod-assembly.ts` (below).

## Head selection: operator-pinned, deterministic, never "latest"

The runtime index declares exactly one `defaultHead` — an immutable
`{snapshotId, checksumSha256, assemblyPackageIds}` pin chosen by an operator —
and a closed list of `canaryHeads`. The runtime never selects a snapshot by
date, lineage depth, or "latest". A canary is only reachable through an explicit
user opt-in (a UI control or the `exteriorCanary` URL parameter), is always
visibly flagged as a canary in the runtime note and in the details panel, and
never becomes the default on reload. A shared deep link naming a canary that
this release does not pin resolves to the pinned default and says so in an
explicit notice; it never silently resolves to something else.

A canary head that aliases the default head is rejected by index validation, so
"canary" and "default" can never be the same pin wearing two labels.

## The only pinned release in this build is a synthetic fixture package

`public/data/udt-fixture-exterior-cells/` is emitted deterministically from
`src/runtime/exterior-cell-fixtures.ts` by
`pnpm exterior-cells:emit-fixture`, and
`src/runtime/exterior-cell-runtime.test.ts` re-generates it and asserts byte
equality, so the checked-in release cannot drift from its generator. Only
`public/`-audience artifacts are emitted; no `private/` artifact is ever written
into a browser-reachable root.

The package is obviously named a fixture and can never be mistaken for a
production release. Its geometry is synthetic and its ownership-cell bounds are
a deterministic partition of the Manhattan working area, not derived from base
footprints. What is *real* is the identity coupling: its canonical feature IDs
are genuine DOITT building IDs (`doitt:778052`, `doitt:982383`) and its
`baseCompatibility.baseReleaseIds` name the base releases the app actually
loads (`manhattan-citywide-20260804`, `manhattan-civic-context-20260804`). That
is what makes profile switching, canary selection, fallback notices, and
exterior picking genuinely exercisable in the running app rather than dead UI.

Production exterior assets remain out of scope and are expected from a later
task. A deep link naming any other exterior release fails closed with an
explicit notice naming the release it asked for and the one this build pins.

## Explicit binding: snapshot to geometry

There is no forward link from a cell release to geometry. The runtime therefore
indexes assembly packages and enforces pin equality before it renders a byte:

- the package must be listed in the active head's `assemblyPackageIds`;
- `assembly.audience` must be `public`;
- `assembly.release.{rootId, rootChecksumSha256, releaseId, cityId, configId}`
  must equal the loaded public root;
- `assembly.ownershipLedger` must equal the ledger's logical ID and the public
  root's declared ledger artifact checksum;
- `assembly.baseIdentitySet` must equal the ledger's pinned base identity set;
- `assembly.cells[c].cellRelease.{id, checksumSha256}` must equal the snapshot's
  `{cellReleaseId, checksumSha256}` for that cell;
- `assembly.cells[c].membershipChecksumSha256` and `buildingIds` must equal the
  canonical ownership cell.

A structurally valid package for a different cell release — even one relabeled
with the expected package ID — is rejected. This is covered by a negative test.

Two further rules keep the binding from resolving by accident:

- **Ambiguity is a failure.** If more than one package binds the same cell
  release, the runtime raises `assembly-pin-mismatch` rather than taking the
  first match in file order.
- **Blast radius is the active head only.** Each package is structurally
  validated exactly once, at construction. A package the resolved head pins must
  be valid or the runtime fails closed; a package the head does *not* pin
  (a canary-only package while the default head is active, say) is dropped with
  a recorded reason on `droppedAssemblyPackages` and cannot disable the head
  that is actually in use.

## Public-root-only runtime

The browser resolves only the public audience root. Every artifact reference is
checked with `isSafeReleaseArtifactReference` and must start with `public/` and
contain no `private` segment, and the check runs *before* any fetch. There is no
audience branch in the runtime that could reach a private artifact. A negative
test asserts that a leaked `private/` reference fails closed with zero fetches.

This guarantee covers artifact *bytes*, not graph *metadata*. Because
`validateExteriorReleaseGraph` requires exactly one private root and one public
root, the served `release-graph.json` necessarily includes the private root's
manifest metadata — its root id, checksum, approval fingerprint, and artifact
allowlist entries with their paths, byte sizes, and hashes. In this build that
inventory is a single synthetic three-key fixture blob whose bytes are never
emitted, so nothing sensitive is exposed. Before any non-fixture exterior
release is emitted, the production emitter must ship a public-only projection
of the release graph so the private artifact inventory (paths, sizes, hashes)
is never published to browsers. This is a recorded follow-up obligation, not a
property the current emitter provides.

## Per-artifact verification

Verified bytes are cached under `${relativeRef}#${expectedChecksum}`, not under
the path alone. Two declarations that share a relative reference but pin
different checksums are therefore verified independently, and a cache hit can
never serve bytes that were verified against a different pin.

For every selected LOD the runtime verifies, in order: the declared byte size,
the declared SHA-256 of the fetched bytes, `parseGlbV2`, and
`validateGlbBinding` (canonical metadata equality for `canonicalFeatureId`,
`lodId`, `ownerCellId`, `inventoryId`, `inventoryHashSha256`,
`evidenceShardId`, `truthTiers`, `sourceDates`, `predecessor`, `uncertainty`,
`planHashSha256`, plus measured triangle/material/texture counts), with the
texture-free gate enforced because the package audience is public.

### Disclosed deviation: export-only change to an accepted module

`validateGlbBinding` and `requiresTextureFreeAssembly` were private to
`src/release/multi-lod-assembly.ts`. They are now exported with no behavior or
signature change. Decision 0021 and Decision 0022 name the texture-free gate as
the imagery backstop for public packages, and a runtime that admitted a GLB the
offline replay would have rejected would defeat that backstop. Re-implementing
the checks in the runtime would create two drifting copies of a rights-relevant
gate, which is worse. This is the only change to an accepted module.

## Evidence-shard audience admission

Before any of a cell's assets render, the runtime calls
`validateProjectedGraphAudience` (`src/domain/exterior-evidence-intake.ts`) for
each available building's evidence shard with the active audience and the cell
release's declared `runtimeTexture` flag. This closes Decision 0022's deferred
runtime obligation.

Scope, stated honestly: this guard can only detect **projected exclusion
sentinels that are present** in the serialized graph. It cannot detect a
*removed* sentinel, because Phase A bindings are not persisted into the release
graph. A graph that had a blocking exclusion stripped before promotion would
pass this guard. Detecting that requires persisting the Phase A projection
bindings, which is out of scope here.

## Fallback: exactly one hop, contract-derived, never by name

On any cell verification failure the runtime resolves that cell release's own
`fallback` pin:

- `predecessor` — the checksum-pinned predecessor cell release is verified with
  the same full pipeline. Its own fallback is never followed; a second failure
  puts that cell into an isolated explicit failure state with no exterior
  geometry and a user-visible notice.
- `pinned-base` — an initial cell version falls back to the pinned base identity
  set, which carries no exterior geometry. The existing verified citywide/civic
  base massing therefore remains exactly as it is, plus a notice.

There is no fixture substitution and no same-name substitution anywhere: the
fallback target is an immutable `{id, checksum}` pin taken from the release
itself, and its checksum is re-verified against the public root declaration.
Failure is per-cell; a sibling cell is unaffected.

## Base-identity compatibility

Exterior `canonicalFeatureId`s are base building IDs. The runtime is constructed
with an explicit base-identity predicate and fails closed with a
`base-incompatible` error when an exterior asset names a feature the active base
does not have. The runtime also mirrors the accepted overlay gate with
`compatibleWith(baseReleaseId)` against the index's declared compatibility pins.

Limitation: the predicate is only as complete as the base that is actually
loaded. In the app it is backed by the active adapter's `getFeature`, so a
building outside the currently loaded base surface fails closed rather than
rendering unverified geometry. That is the intended direction of the error.

## Budgets — claim scoped honestly

- **≤ 256 MiB of verified compressed GLB bytes retained by the exterior loader
  cache** (`CitywideLruCache<Uint8Array>(256, 256 MiB)`), plus ≤ 256 entries.
  GPU and decoded-mesh memory inside Cesium is not observable here and is
  explicitly **out of scope** of this claim.
- **Concurrency: 4, shared app-wide.** The exterior pool reuses the accepted
  `CitywideRequestPool` at its accepted ceiling of 4 and shares the single
  app-wide `AggregateRequestBudget` with the citywide and civic loaders, so
  total app concurrency stays provable in one place. The contract's
  "≤ 8 active requests" is satisfied by a stricter, provable 4-shared.
- A single artifact whose declared size exceeds the cache byte budget is failed
  closed with a typed error **before** it is fetched, rather than being silently
  discarded inside the LRU where it would look like a network error.

## Why runtime LOD policy over verified GLBs, not a `Cesium3DTileset`

A `Cesium3DTileset` self-fetches `tileset.json` and its tile content. Those
fetches bypass the request pool, the byte accounting, and — decisively — the
per-artifact SHA-256 and `validateGlbBinding` verification, which makes
acceptance criterion (c) unenforceable and reopens the exact
time-of-check/time-of-use gap this decision closes. At fixture scale the runtime
therefore selects a LOD per asset from the assembly manifest and hands Cesium
bytes it has already verified. 3D Tiles delivery is revisited when city-scale
waves land and a verifying resource/loader seam exists.

Relatedly, the viewport is handed verified `Uint8Array` bytes and creates an
object URL from them. It never re-resolves an artifact by path. The Block 835
public-realm overlay's double fetch (manifest verification, then a second
Cesium-side fetch by path) is a known TOCTOU and accounting defect and is
deliberately not replicated.

## Why overlay composition, not `ComposedReleaseAdapter`

Exterior geometry reuses existing base feature identities. Registering it as a
second release inside `ComposedReleaseAdapter` would throw
`ComposedReleaseCollisionError` by design, because that adapter's contract is
that two composed releases never share a feature ID. Exterior cells are
therefore composed the same way the public-realm and commercial overlays are:
an additive viewport overlay prop alongside the base adapter.

## Render profiles

Two profiles, both pure runtime LOD policy over the LODs an immutable assembly
package already declares. No manifest field, no schema version, no eligibility
changes.

- `inspection` — the finest eligible LOD whose declared `maxDistanceMeters`
  still covers the camera distance.
- `exploration` — the coarsest eligible LOD that covers the same distance.

If no eligible LOD covers the distance the selection returns nothing and the
cell fails closed; it never substitutes a different asset. A non-monotone LOD
list is treated as unusable rather than silently reordered.

The value the thresholds are evaluated against (`lodDistanceMeters`) is supplied
by the app as a **bucketed camera ellipsoid height**, not a measured
camera-to-asset distance. Bucketing keeps a continuous camera move from
restarting LOD selection every frame.

A profile change is a rendering change only. Canonical identity, the URL feature
and camera parameters, details content, provenance, and the pinned release
origin are byte-identical across profiles; only the `exteriorProfile` URL
parameter and the drawn LOD differ.

## Pick precedence

Exterior entity IDs are `exterior-cell:<cellId>:<canonicalFeatureId>` and carry
no LOD, so a pick is stable across LOD and profile swaps. The runtime translates
an exterior entity ID to its base canonical feature ID and then uses the
existing canonical parent-ID cascade unchanged. Precedence is therefore exactly:

1. commercial storefront proxy,
2. base feature (**including** exterior geometry, which resolves to a base
   feature),
3. public-realm proxy.

The existing cascade order is not reordered; only the ID translation is new, and
the precedence is covered by a test.

## Anchoring

Exterior geometry is positioned at its base building's canonical WGS84
coordinates, so CesiumJS keeps its WGS84 authority and the base-identity
coupling stays visible. When the matching base record is not loaded there is no
verified anchor, so that asset is **not drawn and is named in a notice**. The
cell is recorded as incomplete, never memoized as done, so a later pass draws it
once the base record arrives. Withholding geometry silently would be the worse
failure: the details panel would describe an active asset the scene does not
contain.

## Residual risks

- Deterministic fixture tests prove none of visual fidelity, geographic
  accuracy, frame time, or memory acceptance. Those remain separate gates.
- LOD gating uses camera ellipsoid height as a proxy for distance-to-asset. At
  fixture scale this is adequate; a per-asset distance is the honest long-term
  input.
- The app loads every cell in the active snapshot rather than only the cells the
  viewport intersects. That is acceptable at fixture scale (two cells) and must
  become viewport-driven before any city-scale exterior wave.
- Verified geometry whose base record is not loaded is withheld until it is. It
  is announced, but it is still a visible gap rather than a render.
- SHA-256 equality proves byte identity, not rights. It cannot prove a GLB was
  produced from evidence anyone was entitled to use.
- Cesium-internal decoded/GPU memory is unaccounted by the exterior budget.
- The evidence audience guard cannot detect a *removed* exclusion sentinel.
- The base-identity predicate is only as complete as the loaded base surface.
- No production exterior release exists. The only pinned local exterior-cell
  release in this build is the synthetic, obviously named fixture package, and a
  deep link naming any other exterior release fails closed with a notice.
