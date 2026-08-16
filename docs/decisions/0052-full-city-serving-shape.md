# ADR 0052 — The full-city serving shape

Status: accepted for the T005 `-s1` serving releases and the runtime seams they
need. Sections 1 and 2 change runtime behaviour for the CURRENT promoted
default; sections 4 to 7 are the emitted-and-measured record added 2026-08-16;
section 3 is DECIDED BUT NOT YET LANDED, and section 8 says so plainly.
Date: 2026-08-16
Task: T005
Supersedes: nothing. **Amends ADR 0046 D1** (per-wave assembly partitioning) and
**corrects one cited figure in ADR 0042** (the cap 96/128 re-entry comparison).

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

## 8. Status of section 3 — the budget flip has NOT landed

Section 3 remains a decision and not yet an edit. `maxResidentUnits` is still
128 and `maxCacheEntries` is still 512 in this build, because both are to land
**in the first promotion commit** and no `-s1` release is promoted: all six are
pinned as `?exteriorCells=` opt-ins and absent from the promotion record.

The flip was implemented and reverted before commit, and what that attempt found
is recorded here because the next agent will meet it. Flipping the two constants
turns over about twenty-five committed assertions across the residency,
governance, promotion-record and journey suites — every figure that describes
the CURRENT sparse composition against a 512-entry ceiling, plus the three
frozen scheduler-trace baselines, which at cap 8 read:

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

Rewriting those assertions is promotion's work, not the transform's, and doing
it while nothing is promoted would leave the repository describing a composition
it does not ship.

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
- Section 3's budget flip is decided and NOT landed in this build (section 8).

## Related

ADR 0041 (visibility scheduler, band edges, overview residency), ADR 0042
(cache governance, the corrected comparison), ADR 0046 (retention and assembly
partitioning, amended), ADR 0050 (measured LOD-1 fallback), ADR 0051 (retention
package validation).

---
