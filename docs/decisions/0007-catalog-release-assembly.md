# ADR 0007: deterministic local catalog release assembly

Date: 2026-08-03

Status: accepted for fixture-only implementation; real-source integration
pending explicit source-by-source approval.

## Decision

Assemble separately approved immutable adapter outputs through a pure,
provider-neutral TypeScript builder. The builder validates the complete input
set globally, preserves every source/license/freshness reference, emits
deterministic WGS84 partitions and indexes, and computes cryptographic SHA-256
checksums over the exact UTF-8 bytes. A local CLI owns filesystem acquisition,
checksum-pinned inputs, invocation-owned staging, final manifest validation, and
atomic publication.

CesiumJS remains the runtime geospatial engine. The release is a
CityTilePackage-compatible local manifest, not a claim that fixture output is a
production OGC 3D Tiles tileset. Dense rendering and semantic picking remain
runtime concerns; no Three.js, hosted storage, or provider service is added.
The current release claims only generated LOD 12 payloads; expanding coverage
requires real content and parent/child manifests for every additional LOD.

## Integrity rules

- Relative lineage references and absolute local acquisition paths are separate
  values; URLs, traversal and unsafe paths are refused.
- Cross-artifact relationships are valid only when both endpoints and all source
  references exist in the complete release input set.
- Tombstones cannot contradict a current canonical entity. Missing records are
  not deletions unless explicitly authoritative.
- Pure builds are `staged`; only a successfully atomically published directory
  is `published`. Replay checks journal, release schema, fingerprint, expected
  files, and every checksum.
- Release-controlled content references are normalized relative POSIX paths;
  lexical/realpath containment and component-wise symlink/regular-file checks
  protect both publication staging and replay.
- The synthetic scope is a Manhattan-like vertical slice. It is not a citywide
  coverage claim.

## Consequences

The design supports replayable multi-city adapters by keeping city scope and
registry provenance in contracts, while avoiding accidental provider licensing
laundering. It adds a small amount of manifest duplication and excludes
self-referential release/journal checksums from `publishedFiles`; those files
are instead parsed and validated structurally during replay. Real source
adapter approval, legal review, retention, and operational freshness remain
gates outside this implementation.
