# Manhattan catalog release assembly (2026-08-03)

This note records the approval-safe assembly boundary for the Urban Digital
Twin. It is a local build over immutable, independently approved adapter
artifacts; this task contacted no provider and includes no real NYC records.
The checked-in fixtures describe a Manhattan-like vertical slice only and must
not be presented as citywide coverage.

## Evidence and standards

The runtime package follows the repository's WGS84 tile contract and the
CesiumJS tile/primitive split documented in the [Cesium 3D Tiles guide](https://cesium.com/learn/3d-tiling/), with semantic feature picking kept in
the app-owned canonical index. The release does not assert production 3D Tiles
conformance: it emits a CityTilePackage-compatible manifest now and leaves
provider-specific conversion to a separately approved adapter/build step.
The [OGC 3D Tiles 1.1 standard](https://www.ogc.org/standard/3dtiles/) and
[glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)
remain the standards boundary for a later production tile/asset publisher.
CesiumJS remains the selected geospatial renderer; Three.js is not needed for
catalog assembly.

## Assembly pipeline

```
approved immutable adapters
        -> checksum/schema/provenance gates
        -> deterministic catalog release + global relationship validation
        -> WGS84 layer/tile partitions + Unicode/source search indexes
        -> CityTilePackage-compatible manifest and exact content bytes
        -> atomic rename of a private staging directory
```

`SourceArtifact.inputPath` is a relative lineage reference, never an absolute
filesystem path. The CLI may read an explicitly supplied absolute local path,
but records only the safe lineage reference. Every source artifact records its
registry entry, license, terms, attribution, CRS, vertical datum, freshness,
counts, rejection/conflict counts, and fixture/production claim. Pending
registry entries are rejected before staging.

The pure builder emits `BuildJournal.status = staged`; only the CLI changes it
to `published` after validating all files. Partition content is deterministic
UTF-8 stable serialization and its `checksumSha256` is a real SHA-256 digest.
This foundation claims and emits only LOD 12 content: `LayerPartition.lods` and
the release tile coverage are `[12]`, with one exact manifest/content file per
partition. It does not claim four LODs; a later production generator must emit
actual parent/child payloads and validate each claimed LOD before expanding this
array.
`publishedFiles` records the checksums of all non-self-referential release
payloads (indexes, tile package, partitions, and content). The release and
journal themselves are structurally validated on replay; self-checksums are
intentionally excluded because embedding a file's own digest would be
circular.

The CLI creates a new invocation-owned temporary directory under the output
parent (`mkdtemp`), never removes a predictable pre-existing staging path, and
renames only after package, manifest, byte-size, and content checks pass. A
resume requires a checksum-pinned previous release, matching fingerprint and
artifact checksums, published journal, complete expected-file list, and every
payload checksum. Missing or corrupt files refuse replay. Every release-
controlled reference is a normalized relative POSIX path; replay checks lexical
containment, realpath containment, regular-file type, and every path component
for symlinks before reading. Publication applies the same containment checks to
staging targets, so malformed or symlinked references cannot direct access
outside the invocation-owned root.

## Identity, relationships, and diffs

Canonical feature/entity IDs and `(registryEntryId, sourceRecordId)` identities
are globally unique within a release. Relationships are validated after all
artifacts have contributed IDs, so a POI-to-building or station-to-POI edge may
span artifacts; dangling canonical/source references and duplicate relationship
IDs fail closed. A current canonical ID may not coexist with a tombstone in the
same release. Omission is not deletion: only `explicitRemovals` or an explicit
authoritative tombstone produces a removal/tombstone diff.

The search index recursively flattens names, aliases, addresses, categories,
raw attributes, and all source identifiers before Unicode-safe tokenization.
Visitor-facing values live only in `byToken`; the compact exact lookup map
`bySourceIdentifier` contains canonical IDs, observation IDs, source-ref IDs,
registry IDs, provider, dataset, and source-record IDs (plus normalized exact
forms), never arbitrary address/category/attribute values.
Entity snapshots resolve `runtimeFeatureId` to partition tile keys, allowing
field/provenance/freshness changes to invalidate affected tiles. Diffs include
field-level, provenance, freshness, and bounded tile impact.

## Limits and next gate

This local release is not a database, hosted tile service, live freshness
system, or proof of full-Manhattan scale. It does not grant any license to
ingest NYC, OSM, Overture, MTA, or other data. Before the first real release,
the coordinator must approve each source's registry state, terms/attribution,
retention/derivative plan, CRS/vertical datum mapping, and immutable snapshot
checksums. The exact post-approval sequence is: run each approved adapter to
produce local artifacts, then run

```sh
pnpm catalog:build -- --output <new-release-dir> --release-version <version> \
  --generated-at <iso-time> --previous-release <prior-release.json::sha256> \
  --artifact <artifact-a.json::sha256> --artifact <artifact-b.json::sha256>
```

with all paths and checksums supplied explicitly; no provider call is made by
the catalog builder.

The developer-only `pnpm catalog:benchmark -- --records 2000` command generates
2,000 invented records across 12 deterministic tiles and reports elapsed time,
bytes, fingerprint, and bounded-budget status. It is a regression/performance
proxy for local assembly only, not a full-Manhattan performance claim.
