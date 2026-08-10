# 0021: Immutable multi-LOD assembly packages

Status: Accepted

## Context

The exterior release graph in ADR 0019 pins ownership, provenance, partitions,
predecessors, and rollback, but does not define GLB or 3D Tiles as root-owned
artifact kinds. The existing tile package is a JSON layer quadtree and its CLI
reads content as text, so it cannot validate arbitrary GLB bytes safely. T004
needs a provider-neutral, read-only assembly boundary before any production
Blender authoring, citywide materialization, Cesium integration, or publication.

## Decision

Use a separately immutable derived assembly manifest. It cites the exact ADR
0019 root, release, ownership ledger, base identity set, cell release, and
predecessor checksums instead of duplicating or replacing that graph. Private
and public packages are independently closed under distinct path roots; mixed
paths, undeclared content, orphan content, and cross-audience references fail
closed.

The v1 binary profile accepts embedded GLB 2 only. It checks exact raw bytes and
hashes, header and chunk closure, strict JSON, embedded buffer ranges, indexed
triangle topology, bounded counts, and canonical metadata for building, LOD,
owner cell, inventory/evidence, truth tiers, source dates, uncertainty, and
predecessor identity. External buffers/images, sparse accessors, compression,
extensions, nonconformant strides, NUL JSON padding, and unsupported primitive
modes are rejected. Shared POSITION and index accessors are scanned once under
an aggregate component-work cap.

The v1 3D Tiles profile accepts one 1.1 tileset with box bounding volumes,
bounded acyclic topology, `REPLACE` refinement, non-increasing child geometric
error, zero-error leaves, and finite nonsingular column-major affine
transforms. This convention is deliberately distinct from the row-major local
ENU matrices in the existing city asset manifest. The contentless root has one
deterministically ordered branch per asset; each branch is an exact
coarsest-to-finest `REPLACE` chain whose URI and geometric error match the
manifest LOD, ending in a zero-error finest leaf. Sibling/co-rendered variants,
reversed LODs, missing variants, and orphan content fail closed.
Content URIs use standard tileset-relative semantics, resolve inside the
audience package root, and close over declared artifacts. Multiple-content,
implicit-tiling, extension, and other unsupported URI-bearing surfaces are
rejected rather than ignored.

LOD silhouette eligibility retains a method/version, facade-plan hash, view
set, and a maximum two-percent deviation. It is explicitly an
`authoring-declared` measurement. This validator proves metadata closure and
the declared threshold; it does not claim to derive or visually verify the
silhouette from GLB pixels or geometry.

Replay is pure and sequential over a caller-provided map of raw bytes. It uses
bounded safe-integer byte accounting and a domain-separated canonical
fingerprint independent of map and manifest collection order. The CLI reads
only declared regular non-symlink files contained under an explicit content
root, checks size before bounded allocation, and caps retained CLI content at
256 MiB. Reads use a no-follow file descriptor whose device, inode, type, and
size must match the checked path. The CLI performs no writes, network requests,
acquisition, or publication.

## Consequences

- Fixture packages can be replayed deterministically with complete hash and
  byte accounting before production assets exist.
- Unsafe paths, malformed binary structure, invalid transforms/topology/LOD,
  membership drift, metadata promotion, and undeclared content fail closed.
- Visual fidelity, geographic registration, Blender scene validity, Cesium
  picking, browser performance, and public conveyance approval remain separate
  later gates. Rollback removes the derived assembly mapping and restores its
  pinned predecessor; it never mutates an accepted release or canonical ID.
