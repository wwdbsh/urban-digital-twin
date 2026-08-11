# 0030 — Multi-wave exterior default activation

- Status: Accepted
- Date: 2026-08-11
- Related: 0023 (exterior streaming dual profiles), 0024 (exterior wave ledger),
  0027 (Block 835 generative exterior canary), 0028 (Block 835 exterior default
  activation), 0029 (Midtown-core wave materialization and bounded availability)

## Context

ADR 0028 promoted exactly one exterior wave and encoded it as ONE indivisible
record: `EXTERIOR_DEFAULT_ACTIVATION`. Every rule around it — the pin gate, the
identity gate, the rolled-back refusal, the explicit-unavailable statement, the
toggle's return-to-default — was written against that single record, and the
whole App held one exterior runtime, one overlay, one cache, one set of notices.

ADR 0029 then materialized a second wave, `manhattan-midtown-core-cells-20260811`
(149 cells, 3 renderable, 160 buildings), as a strictly opt-in canary. Promoting
it is not "add another release id": with two waves the singular assumptions stop
being simplifications and start being false claims. A scene-level release stamp
would attribute Midtown geometry to Block 835. A single rolled-back record could
not withdraw one wave without implying something about the other. One shared
"exterior streaming" status line could not say which snapshot it meant.

This ADR records the architecture that promotion required, and it was landed in
two steps on purpose: a behaviour-neutral generalization to an ordered set
containing only Block 835, and then the Midtown record. The first step's whole
acceptance bar was that no existing test changed.

## Decision 1 — The build activates an ORDERED SET of promotion records

`EXTERIOR_DEFAULT_ACTIVATIONS` is the authority; `EXTERIOR_DEFAULT_ACTIVATION`
remains the Block 835 record's own export. The set is COMPOSED from the per-wave
records by `exteriorDefaultActivations(...)` rather than being a second,
independently editable constant. Each wave therefore keeps exactly one record
and exactly one rollback edit, and the set can never disagree with the record
that edit swapped.

Every per-record rule now holds PER RECORD:

- the pin gate and the identity gate run against the record of the wave being
  verified, so no wave can borrow another's acceptance evidence;
- `rolledBackReleaseId` refuses opt-in links into ITS release only, while the
  other waves keep streaming;
- the explicit-unavailable statement names WHICH wave is not active;
- the "partial rollback is unrepresentable" property is restated and tested per
  record, not once for the build.

`resolveExteriorActivationSet` returns one resolution per record plus a
deduplicated target list. Deduplication matters: when no wave can promote (a
fixture-mode session with an explicit enable), every record resolves the same
fallback release, and the session must load one runtime rather than one per
promotion record.

## Decision 2 — URL semantics: `off` disables all waves, `exteriorCells=X` selects X alone

Two rules, chosen because they are the only ones that keep a shared link meaning
what it said on the day it was taken:

1. `exteriorStreaming=off` (and the unpinned-parse variant) disables **all**
   default waves. "Off" has never meant "off except the ones you did not know
   about", and a session that switched exteriors off must not start streaming a
   wave because a later build promoted one.
2. `exteriorCells=X` means **exactly release X and nothing else**. Explicit
   intent REPLACES the default set instead of adding to it. The alternative —
   "X plus whatever else is promoted" — would make a link render more than it
   named, and would silently change what an old bookmark shows every time a wave
   is promoted.

Under rule 2 the governing record is the one that CLAIMS X: the enabled record
that publishes it, or the withdrawn record that rolled it back. That is what
makes a promotion-era bookmark into a withdrawn wave fail closed with that
wave's own words while other waves stay enabled.

The toggle follows from rule 2 rather than fighting it. Disabling writes `off`;
re-enabling asks `restoresPromotedDefault`, which is now a SET-level question
("is the release I would pin one this build promotes?"). When it is, the toggle
clears the override entirely and returns to the **full** default set. Pinning
that release instead would have narrowed a two-wave session to one wave every
time a user pressed Disable and then Enable.

## Decision 3 — Release attribution rides on the ENTRY, not the scene

`ExteriorCellRenderEntry` carries `releaseId`, `snapshotId`, `origin`, and
`profile`, and the viewport stamps each entity from its own entry. The details
panel reports the release of the SELECTED feature, resolved through the wave
that owns it. Status lines and fallback notices are per wave, and notices are
qualified by their release unconditionally — two waves produce otherwise
identical lines ("N of M cells ship no exterior geometry"), and a reader cannot
act on a fallback notice without knowing which release it is about.

The wave attribution is also part of the per-cell diff signature: the same cell
resolved from a different wave, snapshot, or head origin is different scene
state, and the entity properties that carry that attribution have to be rebuilt
with it.

## Decision 4 — One shared exterior cache, so the declared ceiling stays a ceiling

The exterior runtime's cache is now constructed once by the App and injected
into every wave, keeping `EXTERIOR_RUNTIME_BUDGETS` (256 entries / 256 MiB) a
COMBINED ceiling. A per-runtime cache would have multiplied the declared budget
by the number of promoted waves, which is exactly the kind of quiet ceiling
inflation the Goal's runtime budget exists to prevent. Sharing is safe because
cache keys are `artifactRef#checksum`: a hit can only ever reuse identical,
already-verified bytes. Measured with both waves streaming: 174 entries /
15.9 MB.

Because the cache is shared, cache metrics are read ONCE from the cache rather
than summed per runtime; summing would have counted the same bytes once per
wave and reported a false ceiling. Peak concurrency remains a max across the
shared aggregate budget and every active wave's pool.

Disclosed limitation: eviction in the shared LRU is recency-only, with NO
per-wave reservation. Today's promoted set fits with room to spare (174 of 256
entries, 15.9 MB of 256 MiB), so no wave evicts another. Under future pressure —
a third wave, or Midtown-core's availability widening beyond 160 buildings — a
larger or more recently touched wave can evict a smaller wave's entries and
cause silent re-fetches of already-verified bytes. Nothing renders wrongly if
that happens (every re-fetch is re-verified against its pin), but the cost is
invisible in the current metrics. Fixing it properly means per-wave residency
policy, which belongs with the deferred cell-scheduling and prioritization work
recorded against ADR 0024 rather than being improvised here.

## Decision 5 — Large membership is stated as a digest, not as 20 KB of literals

Block 835 lists its single accepted cell literally. Midtown-core states its 149
accepted cells as one SHA-256 over the canonical
`cellId|cellReleaseId|checksum` join, recomputed by the pin gate from what the
runtime actually resolved, plus a stated `cellCount`. Its 160 accepted building
identities stay a literal list, because the identity gate compares individual
rendered ids and the error message has to name the offender.

Rejected alternatives, and why:

- **(b) 149 literal cell triples in the record.** No reviewer reads twenty
  kilobytes of hashes, so the "reviewable data-in-code" property that justified
  the literal form at Block 835's size is lost while the cost is real. It is not
  more verifiable either: the gate compares the same canonical join in both
  forms.
- **(c) Fetching the accepted membership from the release at runtime.** This is
  the failure the whole record exists to prevent (finding 9): a runtime-fetched
  acceptance document can disagree with the bytes the build was reviewed
  against, and a gate that reads its expectation from the artifact it is
  gating verifies nothing.

The digest is exactly as strict as the literal list — any cell id, cell-release
id, or checksum differing changes it — and it is stated in a form a reviewer can
check. A digest-form record that reaches the gate with no computed digest fails
closed: the digest form must never pass by omission.

The record is pinned by a drift gate that is NEVER skipped
(`exterior-midtown-promotion-record.test.ts`). It recomputes the snapshot pin,
the cell digest, the 160 identities, and the bounded-availability stats from the
committed `data/midtown-core-20260811/payload-inventory.json` alone. The
payload directory is untracked, so a gate that depended on it would be unchecked
on CI and on every fresh clone — which is precisely where drift survives.

## Decision 6 — Anchor residency is a truthful notice, not a rendering guarantee

Exterior assets reuse canonical BASE building identities and are anchored on the
base feature's own WGS84 coordinates. A building therefore renders its exterior
only once the camera has streamed the base shard that carries it. On a cold load
away from both waves, every verified building of both waves is withheld and one
explicit notice says so by identity; flying to a wave anchors its buildings.
This is reported, never hidden, and it is a property of base residency rather
than of the exterior release.

## Consequences

- Promoting a further wave is appending one record; every gate, notice, cache,
  and attribution path is already per wave.
- A wave rolls back by exporting its own predecessor, and that withdrawal says
  nothing about any other wave. Proven live, both directions.
- Cell ids must stay disjoint across waves: the scene diffs owned collections by
  cell id. Block 835 uses `cell:manhattan:block-835`, Midtown-core uses
  `manhattan-exterior-cell-w01-*`; disjointness is asserted in tests.
- Measured with both waves promoted, on the production build in desktop Chrome
  with `--expose-gc`, along the Midtown facade path: exploration median 8.30 ms
  / p95 10.00 ms against 16.7 / 25; inspection median 8.30 ms / p95 10.20 ms
  against 33.3 / 45; peak concurrency 4 against 8; combined exterior cache
  15.9 MB / 174 entries against 256 MiB / 256. **JS heap after a forced
  collection at every repeat did not grow** (growth ratio −0.107 exploration,
  −0.105 inspection, against a 0.10 noise band), so the bounded-memory claim is
  made against collected heap rather than collection lag. The Midtown release
  ships a single LOD, so the exploration/inspection difference is a profile
  label rather than a different asset, and the ~0.2 ms p95 delta is noise; both
  budgets are reported because both are claimed.
