# ADR 0038: The noncommercial public showcase candidate — an inventory, not a grant

Status: accepted (T023)
Date: 2026-08-12
Supersedes: nothing. Superseded by: nothing.

## Why this ADR exists

Six exterior waves are promoted and stream to a default session. Each one
partitions its own bytes into a public and a private root and each carries its
own rights instrument. What did not exist was a CROSS-WAVE statement: which
public roots a showcase may resolve, what it excludes and why, and whether the
claim "no private byte is reachable" is a measurement or a habit.

This ADR records the design of that statement and — more importantly — the two
places where building it found something the waves' own validators did not.

## Context

The task's scope boundary is narrow and load-bearing: **a local build candidate
and an audit, no deployment and no external publication**. That is not a
self-imposed limit. Every wave's instrument excludes deployment, in the wave's
own words: "public deployment" for the two texture-free waves (Block 835 V3,
Midtown-core V3), "public internet deployment" for the four textured ones.

The Northern-Manhattan instrument went further and anticipated this exact
deliverable:

> nothing in this instrument authorizes assembling the six waves into a
> redistributable whole that no single wave's instrument would permit

That sentence is the constraint this ADR is written under, not an obstacle to
route around.

## Decision 1 — the candidate is an INVENTORY, and says so in the type system

`src/release/public-showcase-manifest.ts` enumerates a closed set of six public
roots. It is a description of what six separately approved local releases
contain. It creates no seventh conveyable thing.

`PUBLIC_SHOWCASE_ASSEMBLY_POSTURE` states this in prose, and
`PUBLIC_SHOWCASE_STANDING_REFUSALS.crossWaveAssembly` quotes the clause above
verbatim. The quotation is not trusted: `public-showcase-manifest.test.ts`
asserts the quoted string is still a substring of
`NORTHERN_MANHATTAN_APPROVAL_NOTE`, so a paraphrase cannot drift in.

## Decision 2 — instruments are carried BY REFERENCE, never restated

The first draft copied each wave's `exclusions` array into the manifest as
string literals. That was wrong, and the reason is worth recording: a copy of an
exclusion can be edited into something weaker, and no test would necessarily
notice, because the copy would still be internally consistent.

The manifest therefore imports the six `ExteriorApprovalEvidence` objects the
release modules already export and holds the OBJECT:

```ts
rights: { instrument: NORTHERN_MANHATTAN_APPROVAL, redistribution: "tiles-withheld" }
```

The test asserts object identity (`toBe`), not text equality. "Restate, never
weaken" is now structural rather than editorial: there is no second copy to
drift. As a check on the wiring, all six referenced fingerprints were compared
against the fingerprints the six release graphs independently pin, and match.

### The per-wave disagreement is preserved, not normalized

Two waves cover redistribution of their texture-free generated geometry; four
expressly withhold redistribution of their procedural detail tiles "or of any
package carrying them". Two say "public deployment"; four say "public internet
deployment". Flattening either difference into one tidy sentence would be an
edit to an approved instrument, so the manifest keeps them per wave and exposes
only a UNION (`PUBLIC_SHOWCASE_RESTATED_EXCLUSIONS`) — a union, because a
six-wave view may do only what ALL six instruments allow.

## Decision 3 — the audit splits DISCLOSURE from LEAK, and enumerates both

This is the substantive finding of T023.

A naive check — "grep the public tree for `private` and fail" — would have
passed only by ignoring what the release graphs actually contain. Two categories
of private reference are legitimately present in browser-reachable bytes:

1. **`privatePredecessor`** on the public root (and mirrored in
   `assemblies.json`): the id and checksum of the private root the public root
   succeeded. A public root cannot state its own provenance without it.
2. **The private root object itself** inside `release-graph.json`.
   `validateExteriorReleaseGraph` REQUIRES exactly one private and one public
   root (`exterior-release.ts:508`); a graph without the private block fails
   validation. It carries an id, a release id, two checksums and one allowlisted
   path.

Neither names a fetchable byte. Both are disclosed to any browser that loads a
package, because `release-graph.json` is fetched at runtime.

`scripts/public-showcase-audit-cli.mjs` therefore classifies every finding into
three headings rather than two:

| classification | verdict | count |
| --- | --- | --- |
| `declared-provenance-disclosure` | accepted, enumerated | 24 (4 per wave) |
| `declared-private-root-metadata` | accepted, enumerated | 36 (6 per wave) |
| `undeclared-private-reference` | **fails closed** | 0 |

The second heading is the one a reader should be suspicious of, because a
category that makes a failing audit pass is how an audit gets hollowed out. Three
things keep it honest:

- It is resolved from CONTENT, not a path pattern: the audit finds the index of
  the root whose own `audience` field reads `private` and accepts only that
  subtree. The same identifier one field away still fails, and a test proves it.
- The scan is structural (dotted JSON path per string leaf), not a substring
  grep, so `privatePredecessor.rootId` is distinguishable from the same string
  smuggled into a `note`.
- It is not accepted on the schema's word alone. For every declared private
  path the audit proves no byte exists there, and the smoke proves the same
  path over HTTP (Decision 5).

### What is excluded, and why, per wave

| exclusion | reason recorded | count |
| --- | --- | --- |
| private root artifacts (1 per wave) | `unmaterialized-by-design` — declared, never emitted into the payload tree | 6 |
| private reference packages | `private-reference-package` — every artifact under `private/`; pruned from `dist/` | 4 packages, 116 files |
| working records under `data/` | `working-evidence-record` — never served; `data/` is outside the browser-reachable tree | 18 directories |

### Tombstones

44,710 buildings across the six waves ship as explicitly unavailable, and every
one carries a stated reason (`unexplainedFallbacks: 0`). The reasons are two
kinds: bounded-subset materialization, and deterministic grammar refusals with a
named cause (`source-height-below-grammar-minimum`,
`ring-vertex-count-unsupported`).

## Decision 4 — the candidate enumerates the BASE packages too

The first allowlist covered only the six waves, and the smoke run refused 32
requests a default session had legitimately issued: `manhattan-citywide-20260804`
(27), `manhattan-civic-context-20260804` (2) and `real-wave-20260804` (3).

This was the allowlist being wrong, not the session. A wave ships exterior
geometry for a bounded subset of the buildings it owns; the citywide massing,
the detail and search shards behind a pick, and the civic context layers come
from separately approved public releases. A candidate enumerating only the six
waves is an incomplete description of what the showcase resolves.

`PUBLIC_SHOWCASE_BASE_PACKAGES` names exactly those three. It remains a CLOSED
set: a fourth base package is refused by name, and adding one moves the
candidate digest. Each carries its own instrument, and each also excludes
deployment. None has an audience partition — checked, not assumed.

## Decision 5 — unreachability is proven on CONTENT, because status codes lie here

The smoke's first draft asserted that the declared private paths must answer
404. All ten answered **200**, which for a moment looked exactly like the leak
this task exists to rule out.

It was not. `vite preview` is an SPA server: an unmatched path falls through to
`index.html` at status 200. The bytes returned were byte-identical to
`dist/index.html`, `Content-Type: text/html`.

The status code therefore carries no information about whether a private byte
exists, and the assertion was rewritten onto the thing that does. Each response
is hashed in the page and matched against two known digests: this build's own
`index.html` (the SPA fallback) and the private artifact's own declared
checksum. **A response matching the latter is the leak, under any status code.**
Result: 10 probes, 0 private bytes served, 0 unexplained responses.

This is strictly stronger than the 404 check it replaced, and it is the
compensating proof that keeps Decision 3's second heading from being a loophole.

## Decision 6 — what the smoke measures, and what it refuses to claim

Against a production build served locally and driven through CDP:

- **Build partition.** `dist/` carries no directory named `private` (the four
  reference packages' partitions are pruned) and no undeclared private
  identifier in any of the six packages. Pruning is verified by its EFFECT, not
  trusted by its exit code.
- **Request containment.** A default session — no exterior URL parameter at all
  — resolved all six waves and issued 548 distinct requests. Every one
  classified: 14 app shell, 502 wave payload, 32 base payload, 0 refusals, 0
  external hosts. The record asserts `everyRequestAccountedFor`, so the
  classification cannot silently skip a request.
- **Provenance.** A building picked through the application's own search opens a
  panel naming the release, the active asset's checksum, truth tiers
  (`absent · generated`), an uncertainty statement, and the NYC OTI attribution
  with the source dataset link. Nothing on the page asserts survey-grade or real
  facade accuracy.

It measures no frame time and no memory; each wave's own acceptance record holds
those. It is not a deployment and asserts no right to become one.

## Residual risks

- **Metadata disclosure is real and accepted.** Any browser loading a package
  learns the private root's id, release id, two checksums and one path. No byte
  follows, and it is enumerated rather than hidden — but it is disclosure, and a
  future audience model that treats private IDENTIFIERS as sensitive would have
  to change the release-graph schema, not this audit.
- **The pins describe untracked payloads.** `public/data/**` is deliberately not
  committed, so the manifest's pins are the committed record of bytes that live
  only locally. That is the citywide precedent, and it means a pin can only be
  re-verified where the payload exists.
- **The smoke is one machine, one browser, one pose.** It proves containment and
  provenance, not visual fidelity.
- **`real-wave-20260804` is enumerated as a base package** because a default
  session probes it. It is a small pilot fallback; if it is ever retired the
  candidate digest must move with it.

## Files

- `src/release/public-showcase-manifest.ts` — the closed manifest, digest, refusals
- `src/release/public-showcase-manifest.test.ts` — closed-set, by-reference, drift
- `src/release/public-showcase-evidence-consistency.test.ts` — pins both records
- `scripts/public-showcase-audit-cli.mjs` — the differential audit
- `scripts/public-showcase-audit.test.mjs` — planted-leak detection
- `scripts/public-showcase-smoke-cli.mjs` — the local public-build smoke
- `data/public-showcase-20260812/differential-audit.json`
- `data/public-showcase-20260812/smoke-evidence.json`

## Reproducing it

```bash
pnpm build
node scripts/public-showcase-audit-cli.mjs

npx vite preview --port 4177 --strictPort
# Chrome: --remote-debugging-port=9225
node scripts/public-showcase-smoke-cli.mjs --preview http://localhost:4177 --port 9225
```
