# ADR 0051 — Retention-package validation reads its policy from the package

Status: accepted for the T004 mass-generation retention waves. It changes no
approved release, no serving surface and no runtime default.
Date: 2026-08-16
Task: T004
Supersedes: nothing. Amends nothing. Decides the validator question Stage 0 left
open once the waves were cleared to run.

## Context

The six retention waves emit `-c1` packages that are **textured** under
`procedural-replay` and **sharded into one assembly manifest per ownership
cell**. Neither property is optional:

- Textured, because the waves generate at `lod_0` + `lod_1` under
  `V3T_QUALITY_BUDGETS` with shared-URI detail tiles.
- Sharded per cell, because `scripts/validate-multi-lod-assembly.mjs` refuses a
  replay over 256 MiB in memory, and a whole-wave manifest is 1.0–1.7 GB. The
  measured cell is ~51 buildings on average and 119 at the largest, which fits
  with three orders of magnitude to spare.

The existing gate validates ONE manifest per invocation and has exactly one
flag, `--require-texture-free`, which is **additive only**: it can force the
embedded-image gate on, and can never relax the gate a public package always
carries. That asymmetry is why the script is safe to point at untrusted bytes.

What the waves needed and it could not do is walk a whole package of per-cell
manifests while knowing which admission policy the package was written under.

## The decision, and the option that was refused

**Build a purpose-built retention validator whose admission policy arrives ONLY
from the package's own checksum-pinned root. Leave
`scripts/validate-multi-lod-assembly.mjs` byte-untouched.**

The refused option was a `--texture-admission` flag on either script. It would
have turned the admission decision into an **operator assertion**: anyone able
to run the validator could declare `procedural-replay` over a package that never
earned it. `procedural-replay` is the rights boundary between "generated from
named constants in this repository" and "derived from someone's photograph", and
a flag would have made that boundary one command-line token wide.

### Why no gate is widened

`scripts/validate-retention-release.mjs` resolves the policy in four steps and
has no other path to it:

1. `retention-root.json` is read as a regular non-symlink file, at its declared
   size, inside the package directory.
2. Its self-pin is recomputed over its own canonical bytes. **A root edited to
   claim a policy it was not written under fails here, before any policy is
   read.**
3. `exteriorTextureAdmissionPolicyOf` — the SAME fail-closed reader the release
   emitter, the assembly validator and the browser runtime use — turns the
   declaration into a policy. Absent, malformed and unknown all yield
   `texture-free`.
4. That policy, and nothing else, reaches `validateMultiLodAssembly` and
   `replayMultiLodAssembly`.

So the validator has strictly **less** authority than the operator running it.
There is no token, environment variable or flag that reaches the decision, and
the argument parser additionally refuses `--texture-admission`, `--policy`,
`--admission` and their neighbours **by name**, so the flag cannot be
reintroduced by accident. A package whose root declares nothing is validated
texture-free and its textured GLBs fail, which is the fail-closed direction.

Nothing about the underlying gates changes. Every rule that makes a textured
byte acceptable stays unconditional and keyed off the GLB's own bytes:
provenance is required whenever an image is present, every tile is re-rasterized
from named constants and byte-compared, the per-image and per-GLB caps apply,
and the 1:1 image/texture/drawn-material shape is enforced. `procedural-replay`
opens exactly one door — "this package MAY carry images" — and every other gate
still has to be passed to walk through it.

## The pin's one honest gap

Each cell manifest cites `release.rootChecksumSha256`. A pin that covered the
manifest list would therefore be **circular and unsatisfiable**: the manifests'
bytes depend on the pin, and the pin would depend on their bytes.

The list is excluded, and the pin covers the identity a manifest cites **plus
the admission policy** — the whole security surface. What that costs is stated
rather than hidden:

- The manifest **count** is not pinned. Census accounting is what proves no cell
  was dropped, and the validator refuses that comparison unless it walked the
  entire declared set in that run.
- Every entry still carries its manifest's own SHA-256 and byte size, verified
  on read.
- Every manifest cross-cites the root's id and pin, so a manifest from another
  package, or a root re-pointed at manifests it did not produce, fails.

`src/release/mass-generation-retention.test.ts` pins the security property in
both directions: editing the policy moves the pin and the root is refused;
appending a manifest entry does not move it, and the test says so explicitly so
the gap cannot be mistaken for an oversight.

## A retention root is not an `ExteriorRootManifest`

`ExteriorArtifactKind` is a **closed** vocabulary — `ownership-ledger`,
`cell-release`, `inventory`, `evidence`, `rollout-snapshot` — describing a
SERVING release. A retention package publishes none of those. Reusing the type
meant either widening a closed security vocabulary to admit an
`assembly-manifest` kind, or filing manifests under a kind they are not. Both
are worse than a smaller type that says only what is true.

The admission **vocabulary** is reused unchanged (`ExteriorTextureAdmission` and
its reader), so a retention root and a serving root cannot drift into two
different ideas of what `procedural-replay` means.

## What is NOT decided here

- Whether any `-c1` package is ever served. It is not, and nothing in
  `src/runtime/` can reach one.
- Any visual, geographic, architectural, accessibility or performance
  acceptance.
- The per-wave 16-sample Blender agreement, which is a separate evidence item
  and was **pending connection** for all six waves.
