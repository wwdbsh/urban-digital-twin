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

## What the pin covers, and precisely what it does not

An earlier draft of this ADR said a pin over the cell-manifest list would be
"circular and unsatisfiable". **That claim was wider than the truth**, and the
correction matters because it hid a real option.

Only ONE thing is genuinely circular: each cell manifest cites
`release.rootChecksumSha256`, so each entry's `checksumSha256` and `byteSize`
depend on the pin's value. A pin over *those* is unsatisfiable.

The manifest **count** and the **cell-id set** are not circular at all. They are
properties of the ownership ledger, fixed before any manifest exists. Two
non-circular options therefore existed:

- **(a) Pin the ledger's owned-cell id set and require the declared manifest set
  to be a subset of it.** Cheap: the list is at most 249 strings, known at wave
  start.
- **(b) Dual pins** — an identity pin the manifests cite, plus a second
  whole-root pin written afterwards covering the entries.

**Option (a) is implemented.** `RetentionReleaseRoot.ownedCellIds` carries the
wave's full owned-cell list, sorted, and it is INSIDE the pin. The validator
requires every declared manifest's `cellId` to be a duplicate-free member of it,
and refuses a set larger than the wave owns. Appending a foreign cell now moves
the pin or fails membership; the test asserts both.

A **subset** rather than an equality, because a cell whose every owned parent was
refused packages no asset and carries no manifest. Equality would turn an honest
all-refused cell into a validation failure.

**(b) was rejected on its merits.** A second pin written after the manifests
would be a value nothing else cites, so nothing would ever verify it in the
normal path; it would add a field that looks like a guarantee while being, in
practice, a checksum of a file against itself. It also doubles the number of
"the root pin" concepts a reader has to keep straight, for a property (a)
already delivers.

### The residue, stated exactly

What remains outside the pin is only the **per-entry checksum and byte size**.
Those are covered by checks the validator performs anyway:

- each entry's SHA-256 is verified against the manifest's actual bytes on read;
- each manifest cross-cites the root's id and pin, so a manifest from another
  package — or a root re-pointed at manifests it did not produce — fails;
- **completeness is not optional**: the validator refuses to report `ok` without
  at least one committed completeness source (`--inventory` and/or `--census`),
  each verified against its own `.sha256` sidecar, and it refuses outright when
  `--max-cells` means it walked only part of the declared set. The inventory
  cross-check also covers `retention-root.json`'s own bytes, which is how an
  edited root is caught by a record the root cannot influence.

`src/release/mass-generation-retention.test.ts` and
`scripts/validate-retention-release.test.mjs` pin all of this, including that
appending an entry does *not* move the pin — stated explicitly so the residue
cannot be mistaken for an oversight.

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
