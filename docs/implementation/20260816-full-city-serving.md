# The full city, served and promoted — T005 implementation record

Date: 2026-08-16
Task: T005
Branch: `fcp/87-serving`
Decision record: ADR 0052 (amended here, sections 4–11)

This record describes the PROMOTED build. An earlier version of this file
described the same six releases as opt-in-only artifacts; that state lasted one
commit and is not what ships.

## What a session gets now

A session that names no exterior release streams six `-s1` serving releases
covering every ownership cell the committed island ledger declares.

| wave | area | cells | shipped | tombstoned | files | payload bytes |
| --- | --- | --- | --- | --- | --- | --- |
| w00 | Block 835 | 1 | 14 | 0 | 27 | 7,945,145 |
| w01 | Midtown core | 149 | 7,179 | 22 | 7,784 | 1,428,801,392 |
| w02 | Lower Manhattan | 126 | 6,382 | 43 | 6,895 | 883,358,732 |
| w03 | Southern remainder | 176 | 9,560 | 43 | 10,273 | 1,083,927,081 |
| w04 | Central and upper | 249 | 11,682 | 39 | 12,687 | 1,322,239,520 |
| w05 | Northern Manhattan | 182 | 10,172 | 58 | 10,909 | 965,577,026 |
| | | **883** | **44,989** | **205** | **48,575** | **5,691,848,896** |

The curated composition this replaces shipped 498 assets across 13
content-bearing cells. **That is roughly ninety times the geometry under the
same permission, and it is not a fidelity claim.** The approval instrument and
its exclusions are carried verbatim; no truth tier rises, no new source is read,
no photograph is ingested. The 205 buildings the T004 grammar refused ship as
explicit unavailable details carrying the deterministic reason the retention
census recorded, and every per-building uncertainty statement still says exactly
what the geometry does and does not claim about a real facade.

## The defect that had to be fixed before any of it rendered

Every `-s1` cell release published inventory and evidence-shard ids scoped to
itself; every `-s1` assembly package published the retained `-c1`-scoped ids.
Nothing structural caught it — the validators check internal consistency, and an
`-s1`-scoped id is internally consistent — so all six waves passed offline
validation over 5.7 GB of real bytes and **every cell would have failed in the
browser with `assembly-pin-mismatch`.**

The fix is D-C (ADR 0052 §9): the RECORD ids move, not the manifests. The
manifests cannot move, because `inventoryId` and `evidenceShardId` are inside
the canonical metadata of 44,989 immutable T004 GLBs and `verifyGlb` requires
byte equality; re-minting reproduces "GLB canonical metadata differs" on every
cell, which was confirmed rather than reasoned about. A serving release did not
materialize those records, so citing the retention release is what it should
have said in the first place.

It fails closed offline now, bound to the retained bytes rather than to a
formula, and the gap that let it ship — no test loaded an emitted serving release
THROUGH THE RUNTIME — is closed by a test that does.

## What the promotion changed besides the records

- `EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY.maxResidentUnits` 128 → 8 and
  `EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries` 512 → 1,024, in the same commit as
  the six records, exactly as ADR 0052 §3 sequenced. Those constants are code
  and have no predecessor record, so **the commit is the rollback contract.**
- All three acceptance sets are digests, on all six records (ADR 0052 D-A), each
  re-derived from committed records alone on every run.
- Six `EXTERIOR_SERVING_ROLLBACKS` constants ship: the curated predecessor plus
  the withdrawal statement a rollback needs to refuse promotion-era `-s1`
  bookmarks. A verbatim predecessor alone would leave those bookmarks streaming
  withdrawn bytes UNGATED.
- 138 committed assertions were rewritten, against ADR 0052 §8's estimate of
  about twenty-five.

**A sparse curated opt-in now renders where the camera is.** At cap 8 the nearest
eight of 883 cells at the default overview pose are all wave w03's, so a session
that opens the Block 835 curated link and does not travel there streams none of
it. Nothing is withdrawn — every curated, canary and `-t1` release stays pinned
and still resolves. `BLOCK_835_CAMERA_QUERY` in the App suite is that loss
written down: before this promotion no test needed a pose.

## What is proven, and by what

**Structural and byte acceptance, over the real payload.** Every cell of every
wave through `replayMultiLodAssembly`: 883/883 packages, 44,989/44,989 assets,
zero issues, re-run after the record-id fix. `data/<releaseId>/serving-validation.json`.

**Copy fidelity, without a payload.** `exterior-serving-drift.test.ts` joins the
committed `-s1` and `-c1` inventories on every run: every shipped GLB
byte-identical to a retained one, only `lod_0`, the retained detail tiles,
shipped + tombstoned equal to owned against the census's own numbers, and no
`private/` byte in the browser-reachable payload. **The regeneration was
manifest-level: not one GLB byte changed, and that gate re-proves it.**

**The retention packages are untouched.** All 91,774 files the six `-c1`
inventories declare, re-hashed after the regeneration, zero mismatches.

**The promotion pins are re-derived, never trusted.** All forty-eight, from the
serving inventories, the retention censuses and the island ledger, with no
payload directory present.

**Boot cost (C5 c).** Derived, because the quantity is three file sizes:
980,000,860 blocking bytes before the assembly seam against 24,068,957 after it,
and 44,989 assets structurally validated before the first frame against 0.

**D-18.** `dispatchCount === 1` at all four frame poses and all five roam stops
on the promoted build. The landing loop does not re-dispatch.

## What FAILED, and what a reader must not conclude from it

**All three captures failed.** They are listed worst-news-first.

**The six-wave DEFAULT session FAILS.** This is the capture that did not exist
until review demanded it: both others named one wave with an explicit
`?exteriorCells=`, so the composition this build promotes had no browser evidence.
It establishes a great deal — six waves resolve, 18 boot documents (three per
release, exactly), 883 declared cells, 8 scheduled cells at every pose split
across waves by distance (overview 0/0/8/0/0/0, transition 1/7/0/0/0/0, Lower
Manhattan 1/2/5/0/0/0), zero failed cells, 731 of 1,024 cache entries, 192.8 MB
of 256 MB, peak 4 of a 4-request budget, every pose landing in one dispatch. The
cross-wave residency ranking cap 8 was chosen for is confirmed in a browser.

**And three cells of `manhattan-midtown-core-cells-20260811-v3-s1` fell back to
pinned base massing, with three failed artifact fetches**, first at the
transition pose and persisting. The pre-registered condition was zero. Nothing
failed closed to nothing — the fallback is the runtime behaving as designed when
an artifact does not arrive — but three cells of the promoted default did not
render their served geometry. **It is not diagnosed:** the capture does not name
the failing artifacts, and one session cannot say whether it is deterministic.
Per the stop rule it was not re-run to look for a greener sample. Routed to T006.

**The frame-time A/B (C5 a) FAILS its pre-registered bar.** Frame times pass on
every pose — p50 8.3 ms in both arms everywhere, p95 within tolerance at all
four, including the pose where the serving arm holds 371 resident assets against
the curated arm's 54. The bar fails on `maximumDecodedTextures: 4` against a
reading of 5. Exactly four of those five are shared class tiles — the whole
`procedural-texture-v1` catalogue, decoded once each, which is the property the
bound protects — and the fifth is a non-class PNG that **arm A also loads, in a
build with no serving release at all.** That is a harness-wiring question, and it
is deliberately NOT resolved here: changing which field feeds a pre-registered
threshold after seeing it fail is moving the goalposts. The failure stands.

**The frame-time PASS half is a saturated instrument, and must not be read as a
cost measurement.** 8.3 ms is the presentation interval of a 120 Hz display, and
both arms sit on it at every pose. `requestAnimationFrame` deltas cannot report
anything faster than the compositor's cadence, so identical percentiles across a
**6.9x difference in resident assets** is the signature of an instrument with no
headroom rather than of a cost that happens to be zero. The claim this evidence
supports is therefore narrowed to: **no regression is detectable above the
~8.3 ms presentation floor at these four poses.** It does not support "the
serving shape costs no more than the tolerance" — the tolerance was never
approached, because the instrument could not have shown it being approached. A
headroom-sensitive instrument (CPU/GPU frame span, or an uncapped loop) routes to
T006; no re-capture is taken, because the same instrument would return the same
saturated numbers.

**The eviction-at-scale roam FAILS its bar**, on two of seven checks:

| check | result |
| --- | --- |
| `cacheEvictions > 0` | **FAIL** — 0 |
| selection stable across eviction | **FAIL** — no reading taken |
| `peakConcurrentRequests <= 8` | pass — 4 |
| entries within cap | pass — 544 of 1,024 |
| bytes within cap | pass — 190.4 MB of 256 MB |
| failed artifacts / failed cells | pass — 0 / 0 of 1,942 requested |

`cacheEvictions` is 0 **because the roam never reached either cache cap.** The
cap-driven eviction path was therefore not exercised, and this capture does not
establish that it works at the promoted caps. The same session does show
residency-driven release — 1,410 artifacts and 298.9 MB released, 118 cells
deferred against 8 scheduled at the final stop — which is a different mechanism
and is not a substitute for the claim that failed.

The identity reading was never taken: the details panel the probe reads was
absent at every stop, so both selection digests are null. **Nothing in this
evidence says a re-admitted mesh does or does not resolve to the same sourced
information.** That is an instrument gap, named rather than approximated. The
pre-existing gap it sits beside is unchanged: no CANVAS PICK on a re-admitted
mesh has ever been captured.

**No capture was re-run under different conditions after failing**, and no bar
was moved. The three verdicts are pinned as they stand by
`exterior-serving-drift.test.ts`, so a later task that turns one green has to say
so in a diff rather than by dropping a new JSON into `data/`.

**Two follow-ups are ratified and recorded, not acted on.** The decoded-texture
re-wire is evaluable over the already-committed arm documents (the shared-class
subset is 4 in every arm-B pose, and does not scale with residency — 4 requests
at both 12 and 371 resident assets); a re-wire must also keep `distinctUrlCount`
as a reported, non-gating column. The deeper cap-eviction roam routes to T006
with byte-identical pass conditions and pre-committed poses. Both T005 FAILs
stand.

## Still not established

- **No visual, geographic, architectural or accessibility acceptance.** Passing
  every gate here is a statement that the bytes are the retained bytes, that
  they validate, and that the release shape is what it claims.
- **Why three cells of w01 fall back on the promoted default.** Observed once,
  undiagnosed, routed to T006.
- **Frame cost below the ~8.3 ms presentation floor.** Unmeasurable with this
  instrument; a headroom-sensitive one routes to T006.
- **Cap-driven eviction under a pre-registered roam.** The single-wave roam
  never reached either cap. The default session did reach eviction
  (`cacheEvictions` 226), but that is an observation, not the roam whose
  conditions failed.
- **Identity across an eviction cycle**, and the older gap beside it: no canvas
  pick on a re-admitted mesh has ever been captured.
- **A distribution.** The default session is ONE run at four poses.
- **D-8, D-11 and D-17** are carried forward unclosed; ADR 0052 §11 restates
  each by number and says what this promotion did and did not do to it.

## Where things are

- Transform and release parts: `src/release/exterior-serving-release.ts`
- Wave table, approval, texture admission: `src/release/exterior-serving-waves.ts`
- Emitter and validators: `scripts/exterior-serving-wave-cli.mjs`
- Session-evidence harness: `scripts/exterior-serving-evidence-cli.mjs`
- Pre-registered frame bar: `src/runtime/exterior-serving-frame-bar.ts`
- Promotion records and rollback targets: `src/runtime/exterior-default-activation.ts`
- Promotion pin re-derivation: `src/runtime/exterior-serving-promotion-record.test.ts`
- Per-wave records: `data/<releaseId>-s1/`
- Task evidence: `data/exterior-serving-20260817/`
