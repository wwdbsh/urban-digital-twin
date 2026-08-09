# Decision 0019: provider-neutral exterior truth and release contracts

Date: 2026-08-09

Status: accepted for contract and synthetic-fixture validation; generation,
runtime integration, acquisition, and publication remain out of scope.

## Decision

Exterior detail uses an additive, versioned domain contract that does not alter
the existing `Feature`, provenance, catalog, citywide, travel-context, asset, or
exterior-pilot contracts. Manhattan is a city configuration, not a schema
assumption.

Every building inventory contains exactly one class-level entry for each
required exterior kind: massing, setbacks, facade bays, windows, entrances,
ground-floor divisions, storefronts, cornices, roof form, balconies, fire
escapes, roof equipment, water tanks, materials, and signage. Geometry-level
subcomponents are deferred.

Inventory truth is a closed discriminated union:

- `generated` records deterministic generator identity, version, input
  fingerprint, seed or parameter hash, timestamp, uncertainty, and optional
  constraint sources. It remains generated regardless of its constraints.
- `evidence-backed` records whether a claim is source-observed or derived and
  resolves complete evidence.
- `absent` means only that the release has no representation. It never asserts
  that the real building lacks the component and is not release-eligible for a
  required/applicable profile entry.
- `not-applicable` requires either an explicit grammar reason or complete
  evidence.

Fidelity and release eligibility are derived from that discriminant. They are
not independently stored flags that can contradict inventory truth. Constraint
evidence cannot promote generated facade existence or carry accuracy, tenant,
or signage claims.

Evidence-based claims close over source, observation/capture/update dates,
attribution, uncertainty, license, retention, durable approval fingerprint,
scope, exclusions, allowed-use decisions, and personal-data restrictions.
Dates are canonical UTC timestamps, and release eligibility is evaluated at the
cell's frozen promotion timestamp: future evidence or approvals, expired
retention, and contradictory retention mode/expiry declarations fail closed.
Allowed use is explicit for private derivatives, public display, derivative
conveyance, redistribution, runtime texture, training input, generation input,
and validation-only use. Public release requires the corresponding public
rights; personal-data-restricted evidence cannot enter public or runtime-texture
content.

## Immutable release model

Private and public releases have distinct immutable roots, root/release IDs,
artifact allowlists, checksums, and approval envelopes. Their artifact paths
are separated by root and use a stricter canonical-reference grammar that
rejects URL encoding, query strings, fragments, controls, whitespace, schemes,
absolute paths, backslashes, dot segments, traversal, and non-allowlisted
characters. A public root may cite private ancestry only by immutable logical
ID and hash, never by a private path.

Canonical ownership is independent of version membership. The ownership ledger
pins provider-neutral city/config identity, the base building identity-set ID,
checksum and count, exact WGS84 coverage, and stable ordered cell bounds and
membership. Every base building has exactly one owner cell. A building may
appear in multiple releases of that same owner cell without becoming a
duplicate owner.

Rollout snapshots are complete immutable maps from every stable cell ID to one
cell-release ID and checksum. Snapshot and cell predecessors must exist, remain
acyclic and within the same audience/city/config/base/cell, and preserve exact
hashes for unchanged mappings. A changed cell must continue from the version in
the predecessor snapshot. Each promoted release carries approval evidence, and
each non-initial snapshot pins a complete ancestor rollback target. Removed
exterior detail remains explicit as unavailable with a tombstone; fallback is
only the exact predecessor or the checksum-pinned base identity, never a
same-name fixture.

Validation is deliberately layered:

1. structural validation decodes unknown input and rejects malformed or
   discriminant-incompatible fields, including complete nested inventory and
   evidence shard payloads;
2. semantic validation closes decoded root, cell, inventory, evidence,
   ownership, predecessor, rollout, approval, and rights graphs;
3. asynchronous replay checks supplied artifact byte sizes and SHA-256 values.

`immutable: true` is only a declaration. A matching hash proves byte identity,
not source truth, license rights, approval scope, or public-conveyance rights;
those remain separate mandatory evidence.

## Consequences and deferrals

The contracts and tests use only small synthetic shards and do not embed
production building membership, acquired data, 3D Tiles, or release artifacts.
Generation algorithms, asset/content generation, rendering, runtime wiring,
acquisition, publication, and deployment are deferred.

Runtime request, cache, and local-only-provider enforcement is explicitly
deferred to T005. This decision does not authorize provider requests, loosen
retention, or treat deterministic tests as proof of visual, geographic,
factual, accessibility, or performance acceptance.
