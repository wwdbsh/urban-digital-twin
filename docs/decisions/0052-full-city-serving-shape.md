# ADR 0052 — The full-city serving shape

Status: accepted, and LANDED. Sections 1 and 2 change runtime behaviour;
sections 4 to 7 are the emitted-and-measured record added 2026-08-16; section 3
was decided ahead of the promotion and **has now landed**, which section 8
records together with the size of the rewrite it actually cost. Sections 9 to 11
were added at the promotion commit: the record-id scoping defect and its
decision, the camera-dependence the cap flip introduces, and the reconciliation
seam plus the carries that stay open. **Section 12 records the C5 session
captures, both of which FAILED their pre-registered bars.**
Date: 2026-08-16
Task: T005
Supersedes: nothing. **Amends ADR 0046 D1** (per-wave assembly partitioning) and
its manifest-weight measurement (section 7), and **corrects one cited figure in
ADR 0042** (the cap 96/128 re-entry comparison).

## Context

T004 retained the full island: 883 ownership cells, 44,989 buildings, both LODs,
6.2 GB, validated per cell and committed as inventories and censuses with the
payload left gitignored. Nothing of it is served. T005 is the task that turns
retained bytes into a serving surface, and the shape it has to choose is
constrained by three facts that only become visible at island scale.

This ADR records the shape decision, the two runtime defects that had to be
fixed before the shape could be sized honestly, and the sequencing of the budget
changes the shape needs.

---

## 1. D-4 — the scheduler ranks by distance inside a band, not by census order

### The defect

`selectResidentUnits` ranked candidates by tier, then distance BAND, then the
census `order`. `order` is the ledger's wave-and-position index — Block 835 at
0, midtown from 1, northern to 882 — which says where a cell sits in an
enumeration of the island and nothing about where the camera is. The band edges
are 1,200 m and 2,400 m and an ownership cell is a few hundred metres across, so
band 0 routinely holds dozens of cells. Whenever the cap truncated inside a
single band — which is the normal case — the admitted set was "the
lowest-numbered cells that happen to be within 1.2 km", not "the nearest cells".

T003 found this, recorded it as a FINDING, and deliberately did not fix it:
changing the rank moves the frozen thrash baselines, and T003's contract was
cache governance rather than ranking policy. It handed the fix to T005 as the
first task with a rendered A/B in scope. The finding was pinned by a test that
asserted an inversion EXISTS, so the fix had to be a decision rather than a
drive-by.

### The fix

`compareRanked` now compares the measured nearest-point distance immediately
below the band and above `order`. Because `bandIndexOf` is monotone in distance,
ranking by (band, distance) is the SAME total order as ranking by distance
alone: the band is retained because it is the unit ADR 0041's evidence is stated
in, not because it changes the result. `order` survives below distance because
two rectangles can be exactly equidistant, and a float comparison falling
straight through to the tie-break key would make those pairs depend on census
row order.

### Why it had to land before anything was sized

`exterior-serving-residency.ts` bounds serving residency by taking "the `cap`
cells nearest some camera" and maximising over every anchor. Before this fix
that model described **no code that existed**: the runtime did not admit the
nearest cells, so a bound built on nearest-cell admission could not be cited as
a bound on the runtime. The budget flip in section 3 rests on that bound, so
D-4 is a precondition for it rather than an improvement alongside it.

### What it measurably did

Replayed over the three committed camera traces at the shipped cap of 128:

| path | re-entry | wide re-entry | evictions | peak resident |
| --- | --- | --- | --- | --- |
| midtown-street-pan-v1 | 0 → 0 | 0 → 0 | 92 → 92 | 91 → 91 |
| midtown-zoom-out-v1 | 15 → 13 | 25 → 25 | 62 → 58 | 128 → 128 |
| midtown-roam-v1 | 32 → **15** | 75 → **38** | 362 → **310** | 128 → 128 |

Every path is unchanged or better, and the roaming session — the only one of the
three that is a session rather than a gesture — improves 53% at the hysteresis
horizon and 49% over the wider window. The mechanism is mechanical: a small
camera movement reorders a distance ranking slightly and can reorder a
ledger-order ranking arbitrarily, so ranking by distance removes churn at its
source. `peakResidentCount` is unchanged everywhere, because D-4 changes WHICH
cells are admitted when the cap binds and never HOW MANY.

At the T002 cap of 96 the zoom-out path moves in both directions, 13 → 14 at the
horizon and 30 → 24 over the wider window. The one-worse horizon figure is
recorded rather than smoothed: that path's churn is driven by cells crossing the
1,200 m band edge while the cap boundary sits mid-band, and distance ranking
changes which cells sit on that boundary.

### The ADR 0042 correction

ADR 0042 cited the roam's **"29% fall in horizon re-entries"** — 45 at cap 96
against 32 at cap 128 — as evidence for the raised cap. At the D-4 ranking that
finding **reverses**: the roam scores 14 at cap 96 and 15 at cap 128, so the
larger cap is marginally worse at the horizon and worse over the wider window
(31 against 38).

The honest reading is that the raised cap's re-entry benefit was largely an
artifact of the ordering defect: ranking by `order` made the admitted set churn
as the camera moved, and a bigger cap masked that churn by holding more cells.

**This does not retract the cap.** Cap 128's justification was never only
re-entries — its floor is ADR 0041's measured six-pool overview residency of 110
cells, which cap 96 cannot hold, and the zoom path is still better at 128 at the
horizon. What is retracted is the specific 29% claim.
`exterior-cache-governance-gate.test.ts` carries the corrected table so
ADR 0042 does not keep citing a figure this repository no longer produces.

---

## 2. The assembly seam — per-cell packages become lazily fetched artifacts

### What ADR 0046 decided, and why it does not survive contact with serving

ADR 0046 D1 partitioned the full-city assembly **per wave** and explicitly
rejected a per-cell partition ("A finer partition (per cell, 883 assemblies) was
rejected: it multiplies the manifest weight below by 147 for no
limit-compliance benefit"). It then measured the manifest weight and named the
consequence as unfinished business:

> Per wave the worst case is ~59 MiB, which is still large and is named as a
> T004/T005 obligation rather than declared acceptable here.

That obligation is discharged here. ADR 0046's rejection of per-cell packages
was correct **about limit compliance** and incomplete **about boot weight**:
`MULTI_LOD_ASSEMBLY_LIMITS` is not the binding constraint, the boot fetch is.

### The measurement

`loadExteriorCellRuntime` fetches `index.json`, `release-graph.json` and
`assemblies.json` whole, in parallel, `cache: "no-store"`, before anything
renders; the `ExteriorCellRuntime` constructor then runs
`validateMultiLodAssembly` over every head-pinned package synchronously.

Measured from the committed w02 `-c1` payload — the 126 per-cell manifests
transformed to the single-LOD serving form this release ships:

| term | per shipped asset | w02 (6,382) | island (44,989) |
| --- | --- | --- | --- |
| assembly manifests, two-LOD (retained) | 3,932 B | 23.93 MiB | — |
| assembly manifests, **single-LOD (served)** | **2,567 B** | **15.86 MiB** | **110.1 MiB** |
| `cellRelease.buildingDetails` rows | 251 B | 1.5 MiB | 10.8 MiB |
| ownership ledger cells | — | 0.13 MiB | 0.89 MiB |

The island figure is measured across all six waves' committed `-c1` manifests
rather than scaled from w02: 115,499,836 B over 44,989 buildings and 883 cells.
Per wave the single-LOD ratio runs 2,316–2,629 B/building (w00, one cell of 14
buildings, sits at 2,756 because its fixed header amortises over almost
nothing).

With all six waves promoted that is ~110 MiB of assembly manifests plus ~14 MiB
of release graphs — **~124 MiB of blocking JSON before first paint**, plus full
structural validation of 44,989 assets and ~90,000 artifact records across six
constructors.

This is the same defect class the T005 C1 seam already closed for
`release-graph.json`, where the inventory+evidence shard pair cost 18,766 B per
shipped asset and projected to ~841 MB island-wide. That seam moved the shard
bodies into one `cell-detail-sidecar` per ownership cell. It left an
equivalent-class term untouched one artifact over.

### The decision

**Per-cell assembly manifests become lazily fetched artifacts on the same
verified path as every GLB and every sidecar**: declared byte size, declared
SHA-256, public-root ref check, shared LRU, shared request budget.
`assemblies.json` reduces to head-pinned identity — cell to artifact ref and
digest — so boot weight becomes O(cells) pins rather than O(assets) manifests.

This is the natural completion of the C1 seam and it is deliberately the same
shape: per cell, all-or-nothing, resolved through `loadVerifiedArtifact`, with
the same fail-closed outcome.

### The timing change, stated explicitly

Structural validation of a per-cell package **moves from construction time to
cell-load time**. The outcome is unchanged — an invalid package pinned by the
active head still fails closed, with the same issue text — but it fails when the
cell is first needed rather than before the first frame.

Two consequences, neither hidden:

- A release whose 400th cell carries a malformed manifest now boots and renders
  its first 399 cells before failing. Previously it refused to construct at all.
  This is the price of not fetching 112 MiB up front, and it is the same
  trade the C1 seam already made for evidence.
- The refusal surface is per cell, so a single bad cell degrades one cell rather
  than the session. That is a genuine improvement in blast radius and is not the
  reason for the change.

### What this costs the residency bound

Every resident cell gains one cache entry and its manifest's bytes. The serving
residency bound is RE-DERIVED against this rather than assumed to absorb it,
because at 92% of the byte cap there is no room for a term nobody counted.

At the serving cap of 8, over the worst reachable anchor
(`manhattan-exterior-cell-w01-000037-16-19300-17928`):

| | before the seam | after the seam |
| --- | --- | --- |
| entries | 591 | **599** (58.5% of 1,024) |
| bytes | 245,393,546 (234.02 MiB) | **247,000,877 (235.56 MiB)** |
| byte headroom | 8.6% | **8.0%** (21,434,579 B) |
| binding constraint | bytes | bytes |

Cap 8 still fits both caps, so the contingency of dropping to 7 is not taken.
Cap 16 remains impossible by a wider margin than before: 441,016,698 B, 164.3%
of the byte cap, and 1,186 entries against the raised 1,024.

The charge is deliberately conservative: the bound charges 2,757 B per shipped
asset (w00's ratio) against a measured island mean of 2,567, so it over-states
the island by 8,534,837 B rather than under-stating any wave.

---

## 3. Sequencing — the budget flip lands with promotion, not before

The serving composition needs `maxResidentUnits` 8 (down from 128) and
`maxCacheEntries` 1,024 (up from 512). The frozen plan bundled both with D-4 as
one atomic unit. **They are split**, on measured evidence.

### Why

Cap 8 is correct for a DENSE composition and destructive for a SPARSE one. The
scheduler decides over all 883 census cells regardless of which of them any
release actually has content for. Today's promoted composition has content in
**13 cells**; a `-s1` island has content in all 883.

Measured over those 13 content-bearing cells, at 15 cameras (the two ADR 0041
cameras plus one anchored on each content cell), counting how many
content-bearing cells the decision admits:

| camera | cap 128 | cap 8 |
| --- | --- | --- |
| overview 2,400 m | 2/13 | **0/13** |
| midtown street | 4/13 | 1/13 |
| at Block 835 | 5/13 | 1/13 |
| at the w03 cluster (4 cameras) | 5/13 | 2/13 |
| at the w04 pair | 2/13 | 1/13 |

At the overview camera the promoted exterior would render **nothing**. The cause
is structural: the nearest 8 of 883 dense census cells almost never coincide
with 13 sparse content cells, whereas under a `-s1` release every one of the
nearest 8 has content by construction.

### The decision

- **D-4 lands alone**, now. At cap 128 it is a no-op on the promoted
  composition at all 15 cameras above, and it improves the committed baselines
  (section 1). It carries no promotion risk.
- **`maxResidentUnits` 128 → 8 and `maxCacheEntries` 512 → 1,024 land together,
  in the first promotion commit.** Both are properties of the serving
  composition, and moving either before the composition exists degrades a
  shipped default to buy nothing.

### The rollback contract

The two budget constants are CODE, not records, so there is no predecessor
record to restore. The contract is therefore the commit: **the promotion commit
is the atomic unit, and reverting it restores both constants together with the
activation records they were sized for.** A revert that restored the records and
left the constants would leave cap 8 governing a 13-cell composition, which
section 3 measures as the worst of both.

---

## 4. The serving transform — `-s1` is derived from `-c1`, not rebuilt

Added 2026-08-16, after the six waves were emitted.

### The decision

A serving release is a **pure transformation of the retention package**, not a
re-cut of the wave. `buildMidtownCoreRelease` is not called. The per-cell
assembly manifest T004 wrote is re-pinned to the new release, reduced to the
shipped LOD, and its tileset chain unwrapped to the innermost tile; the GLB
bytes are copied. Everything that describes the BUILDING — canonical identity,
inventory hash, evidence shard, truth tiers, source dates, uncertainty, plan id
and plan hash, and the shipped LOD's measured quality — is carried through
untouched, and everything that describes the RELEASE is replaced. There is no
third category, which is what makes the claim checkable.

Two reasons, and the first is the one that matters. **Evidence**: the `-c1`
bytes are what T004 validated, byte-replayed and committed an inventory for, and
a re-materialization produces a second set of bytes believed equal and never
checked to be. **Cost**: the island took nine hours to generate; regenerating it
to serve it would take nine more for bytes already on disk. The six waves
transformed in 12 minutes of generation.

### What still has to be regenerated

Inventories. A retention manifest pins each asset's `inventoryHashSha256` but
carries no inventory, because nothing was served and there was no evidence
surface. So `buildMidtownCoreV3Plan` re-runs under the same successor profile
and `plan.inventory` is taken — and then **hashed and compared against what the
retained manifest declared**, with a single mismatch stopping the wave. All
44,989 matched, as did every plan id and plan hash. The regeneration is a
derivation proven against the retained bytes, not a second opinion about them.

### Copies, never links

Payload GLBs are read and written as bytes. A hardlink would make the served and
the retained file one inode, and the retention packages are the evidence base
for the whole island. The writer refuses a symlink or a multiply-linked
destination, and the full retention fingerprint — all 91,774 declared files,
re-hashed — ran after every wave and passed six times.

---

## 5. D-B — the root self-pin excludes the assembly-package byte accounting

A serving release has a circularity the curated releases do not: every assembly
package pins `release.rootChecksumSha256`, and under the §2 seam every package
is a root-declared artifact whose byte size and checksum the root declares.

`exteriorServingRootChecksum` excludes **exactly** the `byteSize` and
`checksumSha256` of `cell-assembly-package` entries and nothing else. The
package-id SET stays inside the pin — the retention root's `ownedCellIds`
precedent — so a dropped, added, renamed or moved package is still a detectable
edit. For any root declaring no such package the function is **bit-identical**
to the pre-seam `sha256HexSync(stableSerialize({ ...root, rootChecksumSha256:
"" }))`, and the test pins that against the pre-seam expression itself rather
than against a remembered digest.

---

## 6. D-A — a large acceptance is stated as a digest

`buildingIdsDigestSha256` and `assemblyPackageIdsDigestSha256` join
`cellsDigestSha256` on the same canonical join, with the same COUNT-FIRST-then-
digest ordering, and the same refusal of a caller that computed no digest. Both
are optional and absent means the literal form, so every record committed before
this build is byte-unchanged.

One consequence is not cosmetic and is recorded here rather than left to be
discovered. `verifyPromotedExteriorMembership` gates rendered identities against
the accepted set, and in the digest form there is no accepted list to read. It
now takes the resolved membership as an argument and **refuses outright when a
digest-form record is not handed one**. That argument is
`runtime.promotedBuildingIds()` — the set `verifyPromotedExteriorPin` has
already compared against the record's digest at load — so it is "the set that
check verified", never "a set the caller believes in".

---

## 7. §2's boot-cost measurement was understated, by about eight times

§2 measured the per-cell assembly manifests at ~110 MiB island-wide and treated
them as the term worth moving. Measured over the six emitted `-s1` releases, the
two sharded documents together cost **21,263 B per shipped asset**, and the
EVIDENCE sidecars dominate the manifests' ~2,567 B by roughly eight to one.

| wave | blocking boot, after the seam | before the seam | removed |
| --- | --- | --- | --- |
| w00 | 28,807 | 327,807 | 91.21% |
| w01 | 3,835,123 | 154,279,360 | 97.51% |
| w02 | 3,379,392 | 139,084,682 | 97.57% |
| w03 | 5,013,967 | 208,615,537 | 97.60% |
| w04 | 6,508,947 | 256,137,559 | 97.46% |
| w05 | 5,302,721 | 221,555,915 | 97.61% |
| **island** | **24,068,957** | **980,000,860** | **97.54%** |

Assets structurally validated before the first frame: **44,989 before the seam,
0 after it.**

The BEFORE column is a counterfactual and an exact one: the byte sum of the same
documents these releases emitted, carried the way the pre-seam form carried
them, differing only by the array punctuation joining the elements. The
correction is in the flattering direction, which is why it is stated as a
correction rather than quietly enjoyed. `data/exterior-serving-20260817/boot-cost.json`
carries the derivation.

---

## 8. Status of section 3 — the budget flip HAS landed

**Amended 2026-08-16, at the promotion commit.** This section previously read
"has NOT landed" and was correct on the day it was written. It is now history:
`maxResidentUnits` is 8, `maxCacheEntries` is 1,024, and all six `-s1` releases
are the promotion record. Section 3's sequencing decision was honoured exactly —
the two constants moved in the same commit as the six activation records, and
neither moved before the composition they were sized for existed.

### The rewrite was about five and a half times larger than this section estimated

The estimate below was **about twenty-five** committed assertions. The measured
figure at the promotion commit is **138**, counted as removed `expect(` lines
across the residency, governance, promotion-record and journey suites this
section named:

```
git diff <pre-promotion> -- \
  src/runtime/exterior-serving-residency.test.ts \
  src/app/exterior-global-residency.test.ts \
  src/runtime/exterior-cache-ceiling.test.ts \
  src/runtime/exterior-cache-governance-gate.test.ts \
  src/runtime/exterior-cache-eviction-correctness.test.ts \
  src/runtime/exterior-cell-scheduling.test.ts \
  src/runtime/exterior-default-activation.test.ts \
  src/runtime/exterior-multiwave-activation.test.ts \
  src/runtime/exterior-serving-activation.test.ts \
  src/runtime/exterior-*-promotion-record.test.ts \
  src/app/App.test.tsx | grep -c '^-.*expect('
```

The estimate was low for a reason worth naming rather than rounding away: it
counted the assertions that state a NUMBER against the sparse composition, and
missed the ones that state a RELATION which the promotion inverted — "no `-s1`
release is in the promotion record", "the P1 successor IS the promoted default",
"the predecessor is base massing". Those are not cap arithmetic and were not
visible from a constant flip; they became false because six records were added
above them.

The pre-commit trial the paragraph below describes was therefore a partial
rehearsal, and its "about twenty-five" should be read as the cap-arithmetic
subset rather than as the cost of the promotion.

The frozen scheduler-trace baselines, which at cap 8 read:

| path | re-entry | wide re-entry | peak | evictions |
| --- | --- | --- | --- | --- |
| midtown-street-pan-v1 | 1 | 1 | 8 | 35 |
| midtown-zoom-out-v1 | 2 | 2 | 8 | 28 |
| midtown-roam-v1 | 4 | 10 | 8 | 104 |

Those falls are arithmetic and not an improvement: a session that may hold 8
cells cannot evict 128 and cannot re-enter what it never held. What they do
establish is that the cap BINDS on every path — peak is exactly 8 everywhere,
where the street pan never reached 128 — and that eviction remains routine, at
1.79 evictions per decision against 5.34 at the sparse cap.

Rewriting those assertions was promotion's work, not the transform's, and doing
it while nothing was promoted would have left the repository describing a
composition it did not ship. It is done here, in that commit.

---

## 9. D-C — a serving release republishes the RETENTION record ids

Added 2026-08-16, at the promotion commit. The defect below was found by the two
App tests that drive the real exterior runtime over the real committed bytes:
both waited for a rendered entry count of 14 and both read **0**.

### The defect

Every `-s1` cell release published inventory and evidence-shard ids scoped to
itself — `inventory:manhattan-lower-manhattan-cells-20260812-s1:doitt:…`. Every
one of its assembly packages published the retained `-c1`-scoped ids, because
`transformRetentionAssemblyToServing` carries the building-describing fields
through untouched and those two are building-describing fields.

Nothing structural caught it. `validateExteriorReleaseGraph`,
`validateExteriorCellDetailSidecar` and `validateMultiLodAssembly` all check
INTERNAL CONSISTENCY — that a cited id resolves, once, in the right audience —
and none of them requires an id to be prefixed by the release carrying it. All
six waves passed offline validation, including per-cell `replayMultiLodAssembly`
over every GLB, and every cell failed in the browser with
`assembly-pin-mismatch`. Rendered entry count: **zero**.

The comparison that catches it is `ExteriorCellRuntime.renderCell`:

```ts
if (detail.inventoryId !== asset.inventoryId || detail.evidenceShardId !== asset.evidenceShardId)
  throw new ExteriorRuntimeError("assembly-pin-mismatch", …);
```

### Why the other side cannot move

The obvious repair — re-mint the assembly manifests with `-s1` ids — is not
available, and this is the whole of the decision. `verifyGlb` requires the GLB's
canonical `urbanDigitalTwin` metadata to be byte-equal to the manifest asset
that declares it, and `inventoryId` and `evidenceShardId` are inside that
metadata, inside 44,989 immutable T004 GLBs. Re-minting the manifest changes the
field the bytes are pinned against, so every re-minted cell fails replay with
"GLB canonical metadata differs from the immutable assembly manifest" — which
was confirmed by doing it, not reasoned about.

Regenerating the GLBs is not a repair either: it discards the retained evidence
base, whose entire claim (section 4) is that the serving release carries the
retained bytes and no others.

### The decision

**The record ids move.** `buildServingCellRelease` and
`buildServingCellDetailSidecar` take a `recordReleaseId` — the RETENTION release
— and publish `inventory:<-c1>:<building>` and `evidence-shard:<-c1>:<building>`.
A TOMBSTONE keeps the `-s1` scope, because no retained record exists for a
building the retention wave refused: the serving release is the author of that
statement and names itself.

This is not a workaround dressed as a principle. A serving release did not
materialize these records — section 4's whole argument is that it transforms
rather than rebuilds — so an `-s1`-scoped inventory id was a claim of authorship
over evidence that came from somewhere else. The ids now say where the evidence
is from, which is what a provenance-preserving platform should have said first.

### It fails closed offline now

The formula alone would be a second thing to keep in step, so it is BOUND to the
bytes: `buildServingCellDetailSidecar` takes each building's declared
`inventoryId`/`evidenceShardId` from the retained manifest asset and refuses to
emit if the derived ids differ. The cell release is bound transitively —
`validateExteriorCellDetailSidecar` requires the sidecar's shards to be exactly
the ids the cell release cites — so a mis-scoped id is a build-time stop with a
name on it rather than a blank viewport.

### What it cost to find

A structural validator suite of 2,238 tests, six offline validations over 5.7 GB
of real bytes, and a committed promotion record, all green, on a release that
rendered nothing. The gap was that no test loaded an emitted serving release
THROUGH THE RUNTIME. One does now
(`exterior-serving-release.test.ts`, "renders every shipped asset through the
runtime, against the retained GLB metadata"), and it fails on the defect.

---

## 10. The cap flip changes WHERE a curated opt-in renders, not whether

Added 2026-08-16, at the promotion commit. Section 3 measured this and decided
to accept it; this section states it as a user-visible behaviour change, because
that is what it is.

`maxResidentUnits` 128 → 8 does not withdraw anything. Every curated and canary
release stays pinned, and `?exteriorCells=manhattan-exterior-cells-20260811-v3`
still resolves, still gates, still verifies. What changed is that the scheduler
now admits the nearest **8** of 883 census cells instead of the nearest 128, so
a SPARSE release is resident only when the camera is near the cells it has
content for.

Concretely: at the default overview pose the nearest eight cells are all wave
w03's. Block 835 is not among them, so a session that opens the curated Block
835 opt-in and does not travel there streams none of it — where before the flip
the same link rendered from the opening pose.

**The loss is real and it is named rather than absorbed.** The tests that are
about activation and gating rather than about where the camera starts now carry
`BLOCK_835_CAMERA_QUERY`, a six-parameter pose standing inside Block 835's own
census cell. That constant IS the loss, written down: before this promotion no
test needed one. It is deterministic because of the scheduler's first rule:
every unit whose rectangle contains the camera ground point is reserved and
resident ahead of everything else.

**That reservation is exempt from TRUNCATION, not from the cap**, and the
difference matters at cap 8. `selectResidentUnits` computes
`budget = max(0, maxResidentUnits - reserved.length)` and admits only that many
contested units, so reserved cells CONSUME the cap rather than sitting outside
it: standing where several overlapping cells contain the camera ground point
leaves proportionally fewer slots for everything visible around it, and enough
reservations drive the contested budget to zero. What the reservation guarantees
is that the cell the camera is standing in can never be truncated away by a
distance-ranked cut — the T009 F2 lesson — not that residency can exceed the cap.

So the tests place the camera in the cell they are about instead of relying on a
cap wide enough to hold everything.

The alternative, keeping cap 128 for sparse releases and 8 for dense ones, was
not taken: it makes residency depend on which release is loaded, which is a rule
the scheduler would have to be told about and a user could not predict. One cap
sized for the composition this build promotes, with the sparse consequence
stated, is the choice.

---

## 11. The reconciliation seam, and the carries that stay open

Added 2026-08-16, at the promotion commit.

### `computePromotedCoverage` takes the activation set as a parameter

`data/goal-integration-reconciliation.json` is a Goal completion artifact
describing the CURATED composition, and it is not regenerated to follow a later
promotion. Its coverage block used to be held byte-equal to a live recompute,
which is the only fully arithmetic part of that Goal's completion argument; the
serving promotion broke that equality by changing what "the promoted set" means.

The seam is one parameter: `computePromotedCoverage(activations)` defaults to
what the build ships, and the reconciliation suite passes the CURATED set, read
off the live records' `predecessor` chain rather than hand-typed. The byte-equal
drift check is therefore RESTORED — a curated record edited underneath the
promotion still fails — rather than split into a frozen half and a live half.

One field could not be restored and is named instead of hidden:
`maxCacheEntries` is read from the live build, not from the activation set, and
it moved 512 → 1,024. The suite subtracts that field and its derived
`cacheEntryHeadroom` by name, asserts both the record's numbers and the build's,
and holds everything else equal.

### 484, 314 and D-8 are three different numbers

They are close enough to be confused and have been:

- **484** — the curated composition's promoted BUILDING count across the six
  waves, against **498** shipped ASSETS. The 14-entry gap is Block 835 shipping
  both canonical LODs for its fourteen buildings. This promotion replaces 484
  with **44,989**.
- **314** — ADR 0047's count of TEXTURED assets in the `-t1` shared-class
  variant. Nothing to do with promotion: the `-t1` releases are pinned opt-ins
  and are not in the promotion record before or after this commit.
- **D-8** — ADR 0044's UNRESOLVED 484 / 474 discrepancy, carried by number since
  ADR 0045. It is about how the curated promoted set was counted, and this
  promotion neither closes it nor makes it worse; it makes it historical, since
  the composition it disagrees about is no longer the default.

### Carried forward, unclosed

- **D-8** — the 484 / 474 discrepancy, carried unchanged, now historical (above).
- **D-11** — the island-scale bounds-membership double-draw at 5,746 ms, named
  by ADR 0045 §5.2 as a strictly cheaper, un-attempted fix. Untouched here. The
  serving promotion does not make it worse: it changes what the exterior
  scheduler admits, not how the citywide base computes bounds membership.
- **D-17** — the commit gate's WIRING is unguarded, only its arithmetic is.
  Routed to T007 by ADR 0045 and not closed here. Worth restating at this
  commit because the promotion adds forty-eight pinned digits whose ARITHMETIC
  is re-derived on every run by `exterior-serving-promotion-record.test.ts` —
  and whose wiring is guarded by nothing more than that suite existing, which is
  exactly D-17's shape one layer up.

---

## 12. C5 on the promoted build: two bars FAILED, and one capture found a defect

Added 2026-08-16, after the captures. Recorded in the ADR rather than only in the
implementation record because section 3's cap decision was made on synthetic
scheduler arithmetic, and this is the first time it met a browser.

**Frame time (C5 a).** Every p50 and every p95 is inside the pre-registered
tolerance on all four poses, including the pose where the serving arm holds 371
resident assets against the curated arm's 54 — p50 8.3 ms in both arms
everywhere, 720 frames per pose per arm against a 120-frame floor. The bar fails
on `maximumDecodedTextures: 4` against a reading of 5, where exactly four are the
shared class tiles the bound was written about and the fifth is a non-class PNG
that ARM A ALSO LOADS with no serving release present.

That reads like a harness-wiring defect — the bar's own docblock is about class
tiles and the harness feeds it every PNG on the page — and it is deliberately NOT
repaired here. Changing which field feeds a pre-registered threshold after seeing
it fail is moving the goalposts whatever the argument, so the failure stands and
the re-wiring is a decision for review.

### THE FRAME-TIME PASS IS A SATURATED INSTRUMENT, and must not be read as a cost measurement

The p50 is **8.3 ms in both arms at every pose**, and 8.3 ms is the presentation
interval of a 120 Hz display. That is the instrument's floor, not a property of
the scene. `requestAnimationFrame` deltas cannot report anything faster than the
compositor's cadence, so an arm doing more work reads identically to an arm doing
less until the work exceeds the frame budget.

The signature is visible in the data: the serving arm holds **371 resident assets
against the curated arm's 54 — 6.9x — and returns the same p50 to the digit.**
Identical percentiles across a 6.9x change in scene population is the shape of an
instrument with no headroom, not of a cost that happens to be zero.

So the claim this evidence supports is narrowed, deliberately, to:

> **No regression is detectable above the ~8.3 ms presentation floor at these
> four poses.**

It does NOT support "the serving shape costs no more than the tolerance", which
is what the bar was written to test and what the numbers would otherwise be read
as saying. The tolerance was never approached, because the instrument could not
have shown it being approached.

**Routed to T006: a headroom-sensitive instrument.** A CPU/GPU frame-span
reading (`Performance.getMetrics` over CDP, or Cesium's own frame-rate monitor)
or an uncapped render loop would put the measurement below the presentation
ceiling, where a difference between 54 and 371 resident assets could actually
show. No re-capture is taken here: re-running the same instrument would produce
the same saturated numbers.

**Eviction at scale.** `cacheEvictions` is **0**, because the roam peaked at 544
entries of 1,024 and 190.4 MB of 256 MB and never reached either cap. So the
cap-driven eviction path is UNEXERCISED at the promoted caps, and section 3's
"eviction remains routine, at 1.79 evictions per decision" — which is a
scheduler-trace figure, not a browser figure — has no browser corroboration. The
session does show residency-driven release (1,410 artifacts, 298.9 MB, 118 cells
deferred against 8 scheduled), which is a different mechanism.

The identity reading was not taken at all: the details panel the probe reads was
absent at every stop. Nothing in this evidence says a re-admitted mesh does or
does not resolve to the same sourced information.

**D-18** passes: `dispatchCount === 1` at all four frame poses, all five roam
stops, and all four default-session poses. The landing loop does not re-dispatch
on the promoted build.

### The six-wave DEFAULT session — it found a defect, and it PASSES

Both captures above name ONE wave with an explicit `?exteriorCells=`, so the
composition this build actually promotes — six co-resident wave runtimes sharing
one exterior cache under one global residency cap — had no browser evidence at
all. It does now, over the same four poses with no exterior parameter.

What it establishes:

| | |
| --- | --- |
| promoted waves resolved | **6 of 6** |
| boot documents | **18** — three per release, exactly |
| declared cells across the six | **883** |
| scheduled cells at any pose | **8**, the cap, split across waves |
| cells FAILED | **0** |
| cells FELL BACK | **0** |
| failed artifacts | **0** |
| shared cache entries / cap | peak 876 / 1,024 |
| shared cache bytes / cap | peak 236.6 MB / 256 MB (**92.4%**) |
| peak concurrent requests / budget | 4 / 4 |
| every pose landed, dispatches | yes, 1 each |

All nine pre-registered gates pass. They did NOT pass on the first run, and what
failed was worth the whole exercise — see below.

The cross-wave behaviour cap 8 was chosen for is visible and correct: the
overview pose put all eight slots in w02, the transition and midtown poses split
1/7 between w00 and w01, and the Lower-Manhattan street pose split 1/2/5 across
three waves. Residency crosses wave boundaries by distance, exactly as ADR 0052
§1's D-4 fix intends, and the shared cache stayed inside both caps while doing it.

### The three-cell fallback: a curated-era latent defect, made reachable and FIXED

The first run of this capture failed. Three cells of
`manhattan-midtown-core-cells-20260811-v3-s1` —
`w01-000038-16-19301-17928`, `w01-000116-16-19301-17926` and
`w01-000117-17-38604-35853` — fell back to base massing at the transition pose,
deterministically, the same three across two independent captures.

It was **not** an emission defect, which is what held the promotion: all 170
artifacts those cells declare byte-match their manifests on disk AND re-fetch
over HTTP with a 2xx and the declared size in the same page and session; no
loading failure or HTTP error touched any of them; and the app requested 6 of 48,
6 of 87 and 6 of 20 GLBs before giving up — three cells of very different sizes
each stopping at exactly six is a cancelled load, not a bad byte.

**The mechanism.** `CitywideRequestPool` shares one in-flight request per
artifact key. When the last waiter on a key aborts, `releaseWaiter` aborts the
underlying request; a task that has already STARTED keeps its pending entry until
that abort lands, and an aborted task settles the SHARED promise with `undefined`
rather than rejecting it. A decision joining that window received `undefined` for
an artifact nobody had faulted. `loadVerifiedArtifact` counted a failed artifact
and threw a synthesised `request-failed`, which `renderCell` cannot distinguish
from a verification failure — so a healthy cell fell back under a moving camera.
It is the same defect class as the shared-texture memoization defect §2 already
records: one batch's cancellation reaching another batch as if it were an error.

**Reachability is the promotion's doing, the defect is not.** It needs several
co-resident cells still loading when the scheduler re-decides. The curated
composition had content in 13 cells of 883 and rarely had more than one or two in
flight; the promoted composition has content in all 883 and fills all eight
residency slots at every pose. The defect was latent through the whole curated
era and the promotion made it reachable — which is the honest form of "the
promotion surfaced it", and the reason a density change deserves a session
capture rather than a suite run.

**The fix**, in `loadVerifiedArtifact` only. `artifactErrors` is an exact
discriminator, not a heuristic: the loader records every non-abort error there
and deliberately records no abort, so an `undefined` pool result with nothing
recorded is reachable only through cancellation. Such a caller now RETRIES once —
the shared entry is gone by then, so it issues its own request and renders
normally — and only a second cancelled result raises an abort, which `loadCell`
re-throws instead of falling back. `failedArtifactCount` is not incremented on
the cancellation path. `CitywideRequestPool` is untouched: its `undefined`
contract is depended on by the citywide runtime, and the classification belongs
to the caller that knows what its own errors mean.

Raising the abort *without* the retry was implemented and rejected: it converts a
spurious fallback into a spurious blank, because the innocent decision then
carries an abort it never asked for.

**The re-capture passes all nine gates**: `fallbackCellCount` 0,
`failedArtifactCount` 0, six waves, 18 boot documents, 8 scheduled cells per
pose, both caps and the request budget respected, every pose landing in one
dispatch.

One consequence is worth recording. The transition pose now LOADS the three cells
it used to abandon, so residency there rises from 718 entries / 167.6 MB to **876
entries / 236.6 MB — 92.4% of the unchanged 256 MiB byte cap**, within half a
point of the **92.0%** §3's residency bound predicted for the worst reachable
neighbourhood. The bound and the browser agree, and they agree at the tightest
point in the composition.

### Cap-driven eviction WAS observed, in the six-wave session

`cacheEvictions` reads **223** at the two street poses of the default session,
against **0** for the whole single-wave roam. Six co-resident waves filling eight
residency slots reach the shared cache's caps where one wave walking its own
cells did not, which is the direct explanation for why the roam's
`cacheEvictions > 0` condition failed: the roam was not dense enough to exercise
the path, not the path being absent. **The pre-registered roam FAIL stands
unchanged** — this is a different capture with different poses and no
pre-registered eviction conditions, and an incidental observation cannot retire a
named condition. A systematic study of eviction and re-admission at the promoted
caps is T006's.

Neither single-wave capture was re-run under different conditions after failing.
The default session was captured twice, and only to test whether the fallback was
deterministic; both runs are identical on every gate.

### Ratified follow-ups, recorded rather than acted on

Both were adjudicated as legitimate FOLLOW-UPS. Neither changes anything in T005,
and both FAILs stand.

1. **The decoded-texture re-wire.** Legitimate because it can be evaluated over
   the ALREADY COMMITTED arm documents — `sharedClassTextureCount` is 4 in every
   arm-B pose and was recorded before the threshold was known to fail. The
   threshold itself is untouched. A follow-up that re-wires the bar must also
   assert that `sharedClassTextureRequestCount` does not scale with residency
   (it is 4 at both 12 and 371 resident assets, which
   `exterior-serving-drift.test.ts` now pins) and must keep `distinctUrlCount` as
   a reported, NON-GATING column so the page's other PNGs stay visible.
2. **The deeper cap-eviction roam**, routed to **T006**. Legitimate because its
   pass conditions are byte-identical to the ones that failed and its poses are
   pre-committed; it is a longer path, not a different bar. The T005 FAIL stands.

The w01 fallback and the saturated frame instrument (above) also route to T006.

---

## Consequences

- ADR 0046 D1's per-wave assembly partition is amended to per-cell lazily
  fetched packages. Its limit-compliance table is unaffected and still correct.
- ADR 0042's cap 96/128 re-entry comparison is corrected; its cap decision
  stands on its residency floor.
- Boot weight for a promoted island becomes O(cells) rather than O(assets); the
  before/after is measured as T005 C5 evidence rather than asserted here.
- Per-cell assembly validation is later and narrower. Stated in section 2.
- A serving release is DERIVED from its retention package rather than rebuilt,
  so the island has one set of geometry bytes with one lineage (section 4).
- Section 2's boot-cost figure was understated by roughly eight times; the
  measured island removal is 980.0 MB to 24.1 MB (section 7).
- Section 3's budget flip HAS landed, with the six activation records, in one
  commit that is its own rollback contract (section 8).
- A serving release's inventory and evidence-shard ids are the RETENTION
  release's, because the retained GLB bytes name them and cannot be rewritten
  (section 9). This is a provenance statement, not only a repair.
- A sparse curated opt-in is now resident only when the camera is near its
  cells. Nothing is withdrawn; where it renders changed (section 10).
- `computePromotedCoverage` takes its activation set as a parameter, which keeps
  the Goal reconciliation's byte-equal drift check alive across a promotion
  (section 11).
- D-8, D-11 and D-17 are carried forward unclosed and are restated by number
  (section 11).
- Two of the three C5 captures FAIL their pre-registered conditions (section
  12): the frame-time A/B on a decoded-texture bound that looks mis-wired and was
  not re-wired, and the single-wave eviction roam on an eviction that was never
  exercised. The six-wave default session FAILED, found a real runtime defect,
  and PASSES all nine gates after it was fixed.
- The frame-time PASS half is a SATURATED instrument — 8.3 ms p50 in both arms
  across a 6.9x residency difference is the 120 Hz presentation floor. The claim
  is narrowed to "no regression detectable above the ~8.3 ms floor at these
  poses", and a headroom-sensitive instrument routes to T006 (section 12).
- The promoted six-wave composition IS observed: six waves resolve, 18 boot
  documents, 883 declared cells, 8 scheduled cells split across waves by
  distance, both caps and the request budget respected (section 12). ADR 0052
  §1's D-4 cross-wave ranking is confirmed in a browser.
- A CANCELLED artifact load was classified as a FAILED one, so a healthy cell
  fell back to base massing under a moving camera (section 12). Latent through
  the whole curated era; the promoted composition's density made it reachable.
  Fixed in `loadVerifiedArtifact` — cancellation is retried once, then raised as
  an abort, and never counted — with `CitywideRequestPool` untouched. Three
  regression tests, one reproducing and two holding the fail-closed path.
- The residency bound and the browser AGREE at the tightest point: 92.4%
  measured against 92.0% predicted for the worst reachable neighbourhood
  (section 12).
- Cap-driven eviction IS reached in a six-wave session (`cacheEvictions` 223),
  which explains the single-wave roam's zero rather than retiring its FAIL
  (section 12).
- ADR 0042 and ADR 0046 carry reciprocal amendment markers for §1 and §2.

## Related

ADR 0041 (visibility scheduler, band edges, overview residency), ADR 0042
(cache governance, the corrected comparison), ADR 0046 (retention and assembly
partitioning, amended), ADR 0050 (measured LOD-1 fallback), ADR 0051 (retention
package validation).

---
