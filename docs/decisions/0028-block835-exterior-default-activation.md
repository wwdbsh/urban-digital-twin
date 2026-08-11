# 0028 — Block 835 exterior wave as the default over a real base

- Status: Accepted
- Date: 2026-08-11
- Related: 0019 (provider-neutral exterior contracts), 0021 (multi-LOD assembly
  packages), 0023 (exterior streaming dual profiles), 0024 (exterior wave
  ledger), 0027 (Block 835 generative exterior completion and canary release)

## Context

`manhattan-exterior-cells-20260811` shipped in ADR 0027 as a browser-reachable
**canary**: it rendered only when a URL asked for it by name
(`?exteriorCells=manhattan-exterior-cells-20260811`). T009 measured it and the
Issue #11 gate accepted it. A release nobody reaches by default is not a
delivered wave, so the remaining decision was how it becomes what a normal
session sees, and how it stops being that if it must be withdrawn.

Three properties had to survive the change:

- The runtime is fail-closed and pinned. Promotion must not become a second,
  softer path into rendering exterior geometry.
- A fixture-mode session has no real base identity to anchor exterior cells to.
  Turning the wave on there would produce a guaranteed loud failure for a user
  who asked for nothing.
- Rollback must be a single reviewable edit, not a hunt through URL parsing,
  activation, verification and UI.

## Decision 1 — The promotion is one indivisible frozen record

`src/runtime/exterior-default-activation.ts` holds the whole promotion as one
constant: release id, pinned snapshot id, snapshot checksum, assembly package
ids, the cell membership (`cellId` → `cellReleaseId` → `checksumSha256`), the 14
accepted building identities, an approval reference, and the base-only
predecessor. Its type is a discriminated union: the disabled variant carries
`releaseId: null` and nothing else, so "default on, but with no pin" and "pinned,
but with no membership" are unrepresentable rather than merely discouraged.

The values are data-in-code, not fetched. A runtime-fetched promotion document
could disagree with the bytes the build was reviewed against; a constant cannot.
`exterior-default-activation.test.ts` reads the committed `index.json` and
`release-graph.json` and fails closed on any drift from `defaultHead` or from the
public snapshot's cell membership and 14 `buildingIds`.

**Rollback is swapping the exported record for `.predecessor`.** One edit, one
line, no other file.

## Decision 2 — The activation gate is the record *plus* an active real base

`resolveExteriorActivation` turns URL intent, the record and the live base
release into one resolution. With no URL opinion:

- an active compatible real base → stream the promoted release;
- no real base (fixture mode) → **quiet**: no load, no notice, no banner.

This is deliberately not "attempt and report". The activation prerequisite
(exterior cells reuse canonical base building identities) is known before any
request, so a fixture session that never asked for an exterior wave is never
shown its failure. The pre-existing explicit opt-in
(`?exteriorCells=udt-fixture-exterior-cells`) is untouched and still reports its
prerequisite message, because there the user did ask.

## Decision 3 — `exteriorStreaming=off` is a distinct parameter

`exteriorCells` keeps meaning *which* pinned release. The new
`exteriorStreaming=off` sentinel means *no exterior wave at all*. Overloading
`exteriorCells` with an "off" value would have conflated identity with presence
and made a shared link ambiguous once the default changed.

Consequences of the split, all deliberate:

- An explicit disable outranks every other exterior parameter.
- A URL naming an unpinned release fails closed to **off**, never to the promoted
  release: asking for a release this build does not have must not be answered
  with a different one. The existing "is not pinned by this build" notice stays
  accurate.
- Only explicit intent is serialized. A default-on session carries no
  `exteriorCells`, so its links stay reproducible against whatever the build
  promotes instead of freezing today's release id into every shared URL.
- Exterior intent is now restored on Back/Forward. The old parse ran once at
  mount, so history navigation silently kept the session's last exterior state.

Toggling off clears the explicit release too, so re-enabling over a real base
targets what the build promotes rather than resurrecting a release the URL no
longer names. This reverses the pre-promotion expectation that enabling resolves
the synthetic fixture package.

## Decision 4 — The promoted default is verified before it renders

Being the default is not a reason to trust less. When — and only when — the
promoted record (not an explicit URL) selected the release, two gates run:

1. **Pin gate**, after load: the resolved release id, snapshot id, snapshot
   checksum, assembly packages and cell membership must equal the record. Any
   mismatch renders nothing and states which field disagreed.
2. **Identity gate**, after cells resolve: every rendered canonical feature id
   must be inside the accepted 14. An exterior asset that reuses an identity
   outside the accepted wave means the bytes are not the accepted wave.

Both fail closed with an explicit message and no substitute release. A cell that
degrades to base massing renders no asset, so the identity gate treats an empty
render as valid and leaves that reporting to the existing per-cell notices.

An explicitly opted-in release is *not* checked against these gates — it is a
different release, and borrowing the promotion's acceptance would be a false
claim about it.

## Decision 5 — A real-base session without the wave says so

When a real base is active and the wave is not, the details panel renders an
explicit statement instead of dropping the exterior section:

- rolled back → "The Block 835 exterior wave is not active in this build, so base
  massing from release … is shown; no substitute exterior was selected."
- switched off → "Exterior streaming is switched off for this session, …".

Fixture-mode sessions stay silent: nothing was promised, so nothing is reported
missing.

## Consequences

- The Stage 3 performance probe (`?block835Performance=…`) refuses to certify a
  scene that streams exterior cells. Over a real base that is now the default, so
  operators must add `&exteriorStreaming=off` to measure the Stage-3-only scene.
  The probe message names that escape hatch. This is a real cost of the
  promotion, accepted because certifying a Stage-3-only budget against a scene
  that renders an extra wave would compare two different scenes.
- `EXTERIOR_CELL_STREAMING_RELEASE_ID` (the synthetic fixture package) is no
  longer "the default"; it is the fallback for sessions with no real base, which
  are reachable only by explicit opt-in.
- A future wave promotion is a record swap plus its own membership, not new
  activation code.

### What this promotion does not claim

- Nothing about the geometry changed. The wave is still the procedurally
  generated, truth-tier `generated` package of ADR 0027, with no real-world
  facade, tenant, brand or text claim, and the details panel still says so.
- Default activation is not a fidelity statement. It states that the accepted
  release is what a normal real-base session sees, and that what it sees was
  verified against the accepted pin and membership before rendering.
- The renderer journeys are functional evidence captured on loopback
  `vite preview`. They are not a performance, accessibility or visual-accuracy
  certification; T009's measurements remain the performance evidence.
