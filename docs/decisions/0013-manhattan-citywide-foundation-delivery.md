# Decision 0013: Manhattan citywide foundation delivery

Date: 2026-08-04 (Asia/Seoul)

Status: accepted local foundation; staged-diff, commit, and push remain behind
the Root Sol High review gate.

## Context

The repository's earlier fixture, bounded-pilot, source-registry, release, and
navigation work was present in one dirty shared worktree, but the documentation
still described the application primarily as a synthetic scaffold. The approved
local wave needs a truthful, reproducible record without acquiring data again,
changing runtime behavior, or implying a public release.

## Decision

Treat the following as one completed Manhattan foundation:

1. Synthetic fixture mode remains the deterministic fallback and preserves
   provider-neutral multi-city contracts.
2. The bounded real pilot uses approved local OTI Building Footprints and DOHMH
   Restaurant Inspection Results data in the documented Flatiron/NoMad/Union
   Square envelope. Its verified pilot integration also includes the three
   protected landmark GLB LOD pairs.
3. The explicit `manhattan-citywide-20260804` release uses only approved local
   OTI dataset `jh45-qr5r` and DOHMH dataset `43nn-pn8j`, under approval
   `msg_91770ac6d098`. It loads WGS84 JSON geometry, search, and detail shards
   lazily, preserves stable parent/source IDs, and fails closed for unknown or
   corrupt release/parent/shard state.
4. The citywide release is snapshot-relative and local-only. Its ignored raw,
   normalized, replay, and published payloads are prerequisites for local
   validation but are not a fresh-clone or public-deployment guarantee. It is
   not a hosted OGC 3D Tiles service.
5. The registry remains explicit: pending DCP/NTA, Parks, LPC sites,
   Facilities, MTA, OSM, Overture, Google, traffic, and other providers do not
   become approved by appearing in research or future plans.
6. Source truth and uncertainty remain visible. OTI footprint extrusion is
   source-derived massing; a DOHMH grade/action is inspection history rather
   than a rating, review, current opening state, or complete directory. An
   unlocated CAMIS parent remains searchable/detail-addressable without
   invented geometry.
7. Workflow policy is delivered as a synchronized documentation pair:
   `AGENTS.md` remains read-only in this task and
   `docs/codex/AGENT_WORKFLOW.md` is updated to summarize it. Root Sol High
   retains the exact-path staged-diff and one-commit/normal-push gate.

## Observed release facts

The authoritative local manifest records:

| Fact | Value |
| --- | ---: |
| OTI accepted building parents / render parts | 45,194 / 45,194 |
| DOHMH accepted inspection observations | 109,386 |
| DOHMH CAMIS parents / located / unlocated | 12,439 / 12,353 / 86 |
| Geometry / search / detail shards | 103 / 214 / 134 |
| Detail-index entries | 57,633 |
| Declared release bytes | 304,382,520 |
| Accounting remainder / identity collisions | 0 / 0 |

OTI raw snapshot evidence is 41,739,923 bytes with SHA-256
`52c841e388f8e56e6e3666d2ce8b6436ec10f9eeb2bbcad2b2452b51d58dafc7`; DOHMH
raw snapshot evidence is 114,488,021 bytes with SHA-256
`cb4cb6fce7a3744672882e63f2d3542674d7f76334d1a8aa2a7bfa76bd48b627`.
The manifest also records capture/source-update timestamps, attribution, and
the local-only approval exclusions.

## Consequences and limits

This decision makes the current worktree understandable and reviewable without
turning ignored local data into a Git release. It does not add neighborhoods,
parks, shops beyond DOHMH restaurant observations, broad attractions, transit,
routing, hours, live status, reviews, ratings, photos, street imagery, traffic,
facade imagery, photorealism, public hosting, or production 3D Tiles. The
three protected GLB pairs are bounded-pilot assets; citywide mode uses
procedural footprint massing and does not claim landmark replacement.

Reduced-motion code, mobile layout, keyboard search/focus, and local network
isolation are documented only to the degree supported by deterministic tests and
preserved browser evidence. The connected browser could not force the enabled
reduced-motion media-query path or corrupt-payload interception, so those are
not claimed as browser passes.

## Evidence and follow-up boundary

The complete evidence transcript and document audit are maintained in
[`MANHATTAN_CITYWIDE_FOUNDATION_IMPLEMENTATION.md`](../codex/MANHATTAN_CITYWIDE_FOUNDATION_IMPLEMENTATION.md).
This task performs no provider contact, Blender MCP work, package/dependency
change, code/test/script/data/asset edit, public deployment, staging, commit,
or push. A future civic-data wave still requires separate approval for each
source and its local retention/derivative/attribution scope.
