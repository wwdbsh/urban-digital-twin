# Public showcase candidate and differential audit (T023)

The cross-wave public-candidate view of six promoted waves, plus the audit and
local smoke that prove restricted material is unreachable from it. Local build
only: no deployment, no external publication, no new approval.

Decisions and their reasoning are in ADR 0038. This record is what was built,
what was measured, and what a reader needs in order to re-run it.

## What shipped

| file | purpose |
| --- | --- |
| `src/release/public-showcase-manifest.ts` | Closed enumeration of six public roots + three base packages; instruments by reference; independent digest; request classifier |
| `scripts/public-showcase-audit-cli.mjs` | Private/public differential audit across all six waves |
| `scripts/public-showcase-smoke-cli.mjs` | Local public-build smoke (build partition, request containment, unreachability, provenance) |
| `data/public-showcase-20260812/differential-audit.json` | Committed audit record |
| `data/public-showcase-20260812/smoke-evidence.json` | Committed smoke record |
| `docs/decisions/0038-public-showcase-candidate.md` | ADR |
| `package.json` | `showcase:audit` and `showcase:smoke` scripts |

Tests: `public-showcase-manifest.test.ts` (26),
`public-showcase-evidence-consistency.test.ts` (14),
`scripts/public-showcase-audit.test.mjs` (21). Run them with
`pnpm showcase:audit` / `pnpm showcase:smoke` to regenerate the records.

## The manifest

`manhattan-public-showcase-20260812`, digest
`c242ec4357d1dda46712c65f7e667453036c04fe8dca426bd285c9fb50db7cc2`.

Six waves, in activation order, pinned against
`EXTERIOR_DEFAULT_ACTIVATIONS`:

| wave | package | artifacts | texture admission |
| --- | --- | --- | --- |
| block-835 | `manhattan-exterior-cells-20260811-v3` | 31 | texture-free |
| midtown-core | `manhattan-midtown-core-cells-20260811-v3` | 463 | texture-free |
| lower-manhattan | `manhattan-lower-manhattan-cells-20260812-p1` | 270 | procedural-replay |
| southern-remainder | `manhattan-southern-remainder-cells-20260812-p1` | 536 | procedural-replay |
| central-upper-manhattan | `manhattan-central-upper-manhattan-cells-20260812-p1` | 331 | procedural-replay |
| northern-manhattan | `manhattan-northern-manhattan-cells-20260812-p1` | 232 | procedural-replay |

Plus three base packages the waves compose over: `manhattan-citywide-20260804`,
`manhattan-civic-context-20260804`, `real-wave-20260804`.

Each wave pins an independent `artifactChecksumDigestSha256` — sha256 over
sorted `"<relativeRef> <checksum> <byteSize>"` lines — which deliberately does
not reuse the release graph's own root-checksum algorithm.

`PUBLIC_SHOWCASE_SUCCESSOR` is `null`: no pin may move without recording one.

## Audit results

`node scripts/public-showcase-audit-cli.mjs` — record checksum
`b6366c3c2d442aa8e1a47b64745c3d1d70639d6e55f22307d5570267912bada8`.

```
declaredArtifacts              1863     resolvedArtifacts            1863
unresolvedArtifacts               0     declaredPayloadRefs          1387
unresolvedPayloadRefs             0     scannedPublicFiles           2385
privateRootArtifactsExcluded      6     privateReferencePackageFiles  116
workingRecordDirectories         19
declaredDisclosures              24     declaredPrivateRootMetadata    36
undeclaredPrivateReferences       0     privateBytesReachable           0
declaredPrivatePathsMaterialized  0
unavailableBuildingDetails    44710     unexplainedFallbacks            0
```

Every one of 1,863 declared artifacts resolves at its declared size and
checksum; every one of 1,387 cell/assembly payload references resolves. The 24 +
36 accepted findings are enumerated individually with their exact JSON paths —
see ADR 0038 Decision 3 for why they are accepted and what keeps that from being
a loophole.

Tombstones by wave (all with stated reasons):

| wave | unavailable | distinct reasons |
| --- | --- | --- |
| block-835 | 0 | — |
| midtown-core | 7,045 | 3 |
| lower-manhattan | 6,354 | 2 |
| southern-remainder | 9,424 | 2 |
| central-upper-manhattan | 11,681 | 2 |
| northern-manhattan | 10,206 | 1 |

## Smoke evidence

`node scripts/public-showcase-smoke-cli.mjs` — record checksum
`4617d4667245e345ac4fe37f8e2d930407f0678856a4c47434b68204648c2e15`.
Served bundle verified byte-identical to this tree's `dist/index.html`; entry
script `/assets/index-CsMbhorl.js` names all six promoted releases.

**Build partition.** `dist/` private directories: none. The four private
reference packages' partitions are removed by `prune-private-partitions.mjs`
(verified by effect). Undeclared private references across the six packages in
`dist/`: 0. Materialized declared private paths: 0.

**`six-wave-default`.** All six waves streamed with no exterior URL parameter.
**553 distinct URLs ATTEMPTED** (`Network.requestWillBeSent`, unioned with
responses), of which 548 produced a response — so five were attempted and never
completed. All 553 classified:

| class | count |
| --- | --- |
| app shell | 19 |
| wave payload | 502 |
| base payload | 32 |
| refusals | 0 |
| external hostnames | 0 |
| failed requests | 0 |

`noRequestDropped` and `everyRequestClassified` are asserted separately: a
refusal proves nothing was dropped from the accounting and does NOT count as
allowed, so a leaking session cannot report a tidy true.

**`private-paths-unreachable`.** 10 probes (6 declared private root artifacts +
4 pruned reference-package tilesets). 0 served private bytes, 0 unexplained
responses. Assertion is on response SHA-256, not status — see ADR 0038
Decision 5.

**`pick-provenance`.** `doitt:342401` selected through the app's own search.
Panel rows: release origin, render profile, cell/release, active asset
(`lod_0 · 6b5d3cec…`), truth tiers `absent · generated`, source capture/update
dates, and an uncertainty statement. Badge:
`Local · manhattan-northern-manhattan-cells-20260812-p1`. Attribution rendered:
"NYC Office of Technology and Innovation (OTI) GIS · origin release
manhattan-citywide-20260804; source attribution retained" plus the jh45-qr5r
source link. `claimsRealFacadeAccuracy` false.

Stills: `artifacts/public-showcase-20260812/journeys/` (gitignored work root;
checksums are in the committed evidence record).

## Two corrections worth knowing about

Both were found by running the thing, and both are recorded because the first
version of each looked fine.

1. **The allowlist was wrong, not the session.** The first smoke refused 32
   legitimate base-release requests. Fixed by enumerating the three base
   packages as a closed set — not by loosening the `/data/` rule.
2. **A 404 assertion that could never fail meaningfully.** All ten private-path
   probes returned 200 via SPA fallback. Had the assertion been written the
   other way round ("must not 200"), it would have failed forever for the wrong
   reason; as written it would have passed a real leak served at 200. The
   content-hash assertion replaced it.

A third, smaller: the pick journey initially read an empty search result list
because the citywide search shards were still streaming when the exterior waves
had settled. A wait on the results existing was not enough either — a single
`input` event dispatched before the index is warm produces nothing and nothing
re-triggers the search — so the query is now re-typed on every poll.

Review then found two more, both now fixed and both with pre-fix-failing tests:
the request measurement counted only requests that RECEIVED a response (a
blocked off-origin request would have been invisible to a claim about requests
leaving the candidate), and the classifier's accepted headings were wide enough
to admit a private artifact path at a citation position, an invented key inside
the private root, and a private id used as an object key. It also caught an
unbacked rights conclusion for `real-wave-20260804` — see ADR 0038.

## Reproducing it

```bash
pnpm build
node scripts/public-showcase-audit-cli.mjs

npx vite preview --port 4177 --strictPort
# Chrome: --remote-debugging-port=9225 --user-data-dir=<throwaway>
node scripts/public-showcase-smoke-cli.mjs --preview http://localhost:4177 --port 9225

pnpm test -- src/release/public-showcase-manifest.test.ts
pnpm test -- src/release/public-showcase-evidence-consistency.test.ts
pnpm test -- scripts/public-showcase-audit.test.mjs
```

The smoke aborts rather than warns if the preview is serving another tree's
bundle, if `dist/` is absent, or if Chrome is not listening.

## What this leaves

Nothing in this task changed a release, an instrument, or a frozen byte. The
candidate is a view; retiring or adding a wave means moving the manifest pins and
recording a successor, and the drift suite is what will insist on it.
