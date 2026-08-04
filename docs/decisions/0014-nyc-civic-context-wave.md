# Decision 0014: NYC civic-context local sibling release

Date: 2026-08-05 (Asia/Seoul)
Status: approved local implementation; CP0–CP6 complete; Root review complete;
this commit is the scoped CP7 delivery; push verification follows/is recorded
in Git history

## Decision

Deliver one immutable, local-only Manhattan sibling release,
`manhattan-civic-context-20260804`, using the generic v2 multi-kind contracts
for three and only three approved NYC Open Data snapshots:

- DCP 2020 Neighborhood Tabulation Areas, base `9nt8-h7nd`, mapped view
  `4hft-v355`, rendered only as `2020 NTA (statistical)`;
- NYC Parks Properties, `enfh-gkve`, rendered only as `NYC Parks-managed
  property`;
- LPC Designated and Calendared Buildings and Sites, `ncre-qhxs`, rendered
  only as `LPC landmark record`.

Cesium remains the WGS84 viewer and picker. The release uses lazy, independently
validated geometry/search/detail shards, reversible parent/observation identity,
release-pinned URLs and bookmarks, deterministic overlap ordering, and isolated
layer failures. The prior `manhattan-citywide-20260804` release remains the
rollback target and is not rewritten.

## Approval evidence and scope

Durable approval ID:
`codex-user-turn:2026-08-04:manhattan-civic-context-local-v1`
Canonical scope SHA-256:
`7860f0c6c867488935443df1f1f1bb6fefa950646fa7cd1cd32d5a3d0c1eda58`

The exact canonical scope JSON, exclusions, source predicates, terms, and
metadata pins are carried in `src/data/source-registry.ts`, the ignored raw
`acquisition-manifest.json`, the normalized manifests, the immutable release
manifest, and the [implementation record](../codex/MANHATTAN_TRAVEL_CONTEXT_IMPLEMENTATION.md).
The approval covers dated Manhattan-filtered local snapshots, local raw and
metadata retention, local WGS84 geometry/search/detail/source relationships and
browser derivatives, DCP/Parks/LPC attribution, NYC Open Data terms, the City
modified-data disclaimer, capture/update dates, and explicit uncertainty. The
portal metadata's unspecified license is accepted only for this local scope.

It does not cover public deployment or redistribution, other providers,
credentials, fees, imagery, facades, textures, Blender work, shops, transit,
routing, live status, or any stronger fidelity/completeness claim. Any later
need for one of those items is a stop-and-interview gate; no assumption is made.

## Evidence and limits

The capture returned 38 NTA rows, 395 Parks rows, and 15,313 LPC observations;
all were accounted for with zero rejected rows, zero remainder, and zero
identity collisions. LPC grouping produced 1,140 reversible parent records;
10 observations have no usable location and remain searchable/detail-visible
without a map marker. All normalized and published geometry is EPSG:4326.

The release declares 22,424,795 bytes across 114 geometry, 307 search, and 52
detail shards plus a 1,573-entry detail index, within the 40 MiB incremental
budget. The latest local benchmark is within search/detail and initial-load
budgets. CP5 uses the approved focused-page rAF probe (3-second settle, 340
frames, median 8.3 ms, p95 16.6 ms); the unchanged seven-anchor harness's
11-frame/about-1008-ms-per-anchor artifact is retained as a known validation
issue, not treated as a product-frame result.

All automated tests, release validators, replay checks, protected hash checks,
and app-origin browser journeys are embedded in the implementation record and
this decision. Any local `artifacts/**` evidence is intentionally untracked and
excluded from staging/commit. Root review is complete; this commit is the
scoped CP7 delivery; push verification follows/is recorded in Git history. No
commit SHA is predicted in this decision; Git records it after commit.

## Rollback

Use baseline commit `179305c507312e74d7f2b67398a96bec43c02736` and activate the
untouched `manhattan-citywide-20260804` release. Keep any new local evidence for
diagnosis without staging it; never overwrite or delete the old release as a
rollback shortcut.
