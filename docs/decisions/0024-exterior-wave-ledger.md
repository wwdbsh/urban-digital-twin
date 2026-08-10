# 0024 - Immutable Manhattan exterior wave ledger

- Status: accepted
- Date: 2026-08-10
- Task: T011 (Goal Issue #12)
- Scope: the canonical exterior ownership ledger, its wave order, its
  reconciliation contract, and its change-impact index. Materializing exterior
  assets, promoting cells, and any change to the citywide snapshot are out of
  scope.

## Context

The exterior Goal fixes the rollout order: after Block 835, prioritize the exact
WGS84 cells covering the Midtown core, then Lower Manhattan, then complete all
remaining Manhattan cells in deterministic south-to-north order. District names
are labels only; the immutable spatial-cell and canonical-building ledger
defines coverage.

The accepted release schema already defines the ledger shape
(`src/release/exterior-release.ts`), and `validateExteriorReleaseGraph` closes
the ledger and cell key sets exactly. T011 therefore had to fit inside that
shape, not extend it.

## Decisions

### D1 - Membership is the frozen shard grouping, not a second geometry pass

Canonical membership is the level-14 shard grouping already frozen inside
`manhattan-citywide-20260804`. `src/release/exterior-wave-ledger.ts` computes no
centroid, footprint, or boundary geometry, so it cannot become a second,
drifting geographic authority alongside the snapshot builder.

The emit script proves the grouping is a sound basis before using it. Every shard
is read through its manifest-declared `relativeContentRef` and verified against
the declared `checksumSha256` and `byteSize` before a single id is trusted, since
an unverified read would let silent local corruption become canonical membership:

- all 56 building shards match their declared checksum and byte size, and no
  undeclared shard file is present;
- 56 building shards, 50 distinct level-14 tiles, 45,194 features;
- every `parentId` unique (one render part per building, no non-zero
  `partIndex`);
- every representative `coordinates` pair reproduces its own shard `tileKey`
  under `tileKeyForCoordinate(..., 14)` - **0 mismatches out of 45,194**.

The same representative point is the only geometric input this module uses, and
only for sub-partitioning inside a tile the snapshot already assigned. That
sub-partition is re-derived and checked at the leaf's own tile level too: every
member's representative point resolves to its own leaf cell tile, **0 mismatches
across 45,194 buildings**.

### D2 - Waves are inclusive level-14 tile-row ranges

`tileBounds` in `src/runtime/spatial.ts` computes `north = 90 - (y/2^level)*180`,
so **larger `y` is further south**; "south-to-north" is descending `y`. The
occupied rows are `4471..4488`. No latitude constant appears in the contract:
the rows are the contract, and the latitudes below are derived.

| Wave | Id | Tile rows (y) | Latitude band | Cells | Buildings | Rationale |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | `block-835` | declared set | clip rect | 1 | 14 | Goal-fixed first wave; already-approved pilot block. |
| 1 | `midtown-core` | 4482..4481 | 40.74829..40.77026 | 149 | 7,201 | Contains Block 835's tile `14/4824/4482` and its dense neighbour row. The band brackets 34th St (~40.7484) to 59th St (~40.7660) to within one row edge. |
| 2 | `lower-manhattan` | 4488..4485 | 40.68237..40.72632 | 126 | 6,425 | Southernmost band. Northern edge 40.72632 sits at Houston/Broome St, keeping the Financial District, Battery, Tribeca, Chinatown, the Lower East Side, and the Manhattan-borough harbour islands (rows 4487/4488) in one wave. |
| 3 | `southern-remainder` | 4484..4483 | 40.72632..40.74829 | 176 | 9,603 | The rows left between waves 2 and 1 (Village, Chelsea, Flatiron, Gramercy). First of the three deterministic south-to-north remainder waves. |
| 4 | `central-upper-manhattan` | 4480..4478 | 40.77026..40.80322 | 249 | 11,721 | Next band north. Northern edge 40.80322 sits within ~500 m of 110th St, the conventional Northern Manhattan boundary. |
| 5 | `northern-manhattan` | 4477..4471 | 40.80322..40.88013 | 182 | 10,230 | Remaining rows to the northern tip (Morningside Heights, Harlem, Washington Heights, Inwood). |

Measured per-row building counts that anchored the choices (north to south):
4471:378, 4472:697, 4473:889, 4474:734, 4475:1469, 4476:2545, 4477:3518,
4478:3686, 4479:3736, 4480:4299, 4481:4270, 4482:2945, 4483:4399, 4484:5204,
4485:4632, 4486:1560, 4487:87, 4488:146.

Waves 1..5 partition `4471..4488` exactly once, are contiguous, and waves 3..5
run strictly south to north (`4484..4483` -> `4480..4478` -> `4477..4471`). This
is enforced by `validateExteriorWaveLedger` and by tests, not just asserted here.

The manifest's `coverage.anchors` were used only as cross-checks, never as a
partition - they overlap and sum to 50,316 against 45,194 accepted buildings.
Every anchor lands in the wave its label implies except `roosevelt-island`
(40.762, row 4481), which falls in `midtown-core`. That is expected: the Goal
states district names are labels only and the cell ledger defines coverage.

Alternative considered and rejected: `lower-manhattan = 4486..4488` (nearest row
edge to Canal St). It yields only 1,793 buildings and reduces the second Goal
wave to the Financial District alone, so the Houston-St edge was chosen instead.

### D3 - Block 835 is a declared set carved out of its host tile

Membership is exactly `BLOCK_835_DOITT_IDS` (`src/domain/commercial-frontage.ts`),
14 ids, all present in tile `14/4824/4482`. Those 14 ids are removed from that
tile's membership, so the host tile's cells and their checksums differ from a
naive tile partition. That is a stated and tested consequence.

The cell's `bounds` are the frozen public-realm clip rectangle recorded in
`data/normalized/manhattan-esb-block-public-realm-20260806/manifest.json`
(`clip.clipBounds`). These are **declared assignment bounds only, never a
membership rule**: 62 citywide buildings have a representative point inside that
rectangle, against the 14 declared Block 835 ids. A bounds-derived membership
rule is therefore disproved and is not used anywhere.

### D4 - Cell sizing: 120 buildings, enforced at generation time

The accepted runtime budgets (`src/runtime/exterior-cell-runtime.ts`) are 256
cache entries, 256 MiB of verified compressed GLB bytes, and 4 concurrent
requests. Cells load atomically.

- Per render, `loadCell` requests one selected LOD per available building, so a
  single cell load costs `buildings` cache entries: 120 <= 256. This is what the
  cap buys: **one cell is always individually loadable**, with 53% of the cache
  still free at the moment of the load.
- Bytes do not bind. The Stage 3 pilot measured 28 GLBs (14 buildings x 2 LODs)
  at 2,457,444 bytes, i.e. ~87.8 KiB per asset and ~171 KiB per building for
  both LODs. 120 buildings at both LODs is ~20.1 MiB, about 8% of 256 MiB.

What the cap explicitly does **not** buy - an earlier draft of this ADR claimed a
"16-entry margin" under a `2 x buildings = 240` worst case, and that claim was
wrong:

- **It is not a safety margin.** The predecessor-fallback path in `loadCell`
  runs `verifyCellRelease` a second time, so a single fallback load of a
  119-building cell can cost roughly 238 entries while the earliest entries of
  that same load are still resident. A 256-entry cache is then effectively
  saturated by one cell, not comfortably under budget.
- **The cache is shared across all cells.** `EXTERIOR_RUNTIME_BUDGETS` bounds the
  whole loader, not one cell. This cap therefore constrains per-cell atomicity
  only and says nothing about cache pressure once more than one cell is
  resident, which is the normal multi-cell case.

Cache pressure in multi-cell operation is a runtime scheduling concern for
T013+, not something a per-cell membership cap can solve. The cap is enforced as
a generation-time invariant and by tests, not left as guidance.

Sub-partition rule: any over-cap level-14 tile is recursively split into its
four children at the next tile level, each building assigned by its frozen
representative point via `tileKeyForCoordinate` at the child level, repeating
until every cell is at or below the cap. Cell ids stay tile-key based, the
scheme stays WGS84 geodetic, and splitting fails closed at level 24.

Realized partition: 883 cells, maximum membership 119. Cells by level:
12 at 14, 38 at 15, 193 at 16, 623 at 17, 16 at 18, plus the Block 835 cell.

### D5 - Ordering and cell ids

Global `order` is contiguous `0..882`: wave order first, then within a wave the
level-14 tile order (row `y` descending = south to north, then column `x`
ascending = west to east), then leaves inside a tile by the same rule.

Cell ids are `manhattan-exterior-cell-w<2-digit wave>-<6-digit order>-<tile>`,
where `<tile>` is `level-x-y` or `block-00835`. Because the zero-padded global
order is embedded, **lexicographic cell-id order equals visual-priority order**.
That matters because the accepted runtime sorts lexicographically
(`exterior-cell-runtime.ts:366-368`), so visual priority survives into runtime
without any change to `src/runtime/`.

Trade-off accepted: cell identity is coupled to the ordering, so a re-partition
produces new cell ids. The ledger is immutable, so a re-partition is a new
ledger with a new `ledgerId` in any case.

The order field is zero-padded to six digits, so the scheme encodes at most
999,999 cells; generation throws beyond that rather than silently breaking the
lexicographic ordering guarantee. At the accepted cap that ceiling corresponds to
well over 100 million buildings, so it constrains nothing today.

On the acceptance criterion "cell dependencies are acyclic": a ledger cell has no
predecessor field and the ledger declares no cell-to-cell edges at all, so the
dependency graph is empty and trivially acyclic. What the ledger does declare is
a contiguous total order over cells, which is by construction a valid topological
order. Real predecessor edges live on cell releases and source snapshots, where
`validateExteriorReleaseGraph` already enforces acyclicity.

### D6 - Bounds and coverage semantics

`bounds` on every cell is an **assignment rectangle**, not a containment
rectangle. Membership is decided by the representative point, so footprints may
overhang:

- 9,944 of 45,194 buildings (22.0%) have at least one footprint vertex outside
  their assigned cell rectangle;
- the maximum overhang measured against the assigned cell rectangle is
  **248.2 m** (`doitt:308707`).

This is much larger than the ~103 m figure measured against level-14 tiles,
because splitting produces cells as small as a level-18 tile (~76 m of latitude).
Nothing in the ledger depends on containment, but T013+ must not treat cell
bounds as a render or cull extent (see Forward findings).

Rectangle overlap: the level-14 tiles and all their split descendants form a
quadtree partition, so those rectangles never overlap except along shared edges.
The only genuine overlap is the Block 835 declared clip rectangle, which
straddles the 4482/4483 row edge and overlaps **8** leaf cell rectangles across
waves 1 and 3. (The frozen plan expected overlap with the host tile only; the
realized subdivision makes it 8 leaf rectangles.)

`coverage` is the exact union rectangle of all cell bounds
(`west -74.0478515625, south 40.682373046875, east -73.89404296875,
north 40.880126953125`), not the diagnostic OTI envelope. Every cell rectangle
is contained by it, which the accepted validator checks.

### D7 - Ledger identity

- `baseIdentitySet.checksumSha256` is the accepted convention:
  `sha256HexSync(stableSerialize(sortedBuildingIds))`.
- `baseIdentitySet.id` is
  `<baseReleaseId>:exterior-base-identity:<16 hex>`, where the hex is a
  domain-separated SHA-256 over `{baseReleaseId, baseManifestChecksumSha256,
  buildingCount, membershipChecksumSha256}` in domain
  `udt:exterior:wave-ledger:base-identity:v1`. It identifies the base set only,
  so it is stable across re-partitions of the same snapshot.
- `ledgerId` is `manhattan-exterior-wave-ledger-20260804-<16 hex>`, where the hex
  is a domain-separated SHA-256 in domain `udt:exterior:wave-ledger:id:v1` over
  the base lineage **and** the full partition (wave plan, cap, coverage, and
  every cell's id, order, bounds, and membership checksum). Any change to the
  base snapshot or to the partition yields a different `ledgerId`.

Non-collision reasoning: both digests are SHA-256 over a canonical, key-sorted
serialization inside an explicit hash namespace, so a value from one contract
cannot be reinterpreted as a value from another, and the human-readable prefix
never carries identity on its own. The truncation to 16 hex characters (64 bits)
is a readability affordance layered on top of full-strength content checksums
(`ledger.sha256`, `membershipChecksumSha256`, `baseIdentitySet.checksumSha256`);
identity comparisons in the release graph are checksum comparisons, not prefix
comparisons.

Runnable cross-checks recorded by the emit script: `buildingCount === 45194 ===
manifest.coverage.acceptedBuildingCount === layers[buildings].parentCount ===
renderPartCount`, and `sourceSnapshots[nyc.building-footprints]
.rawChecksumSha256 === OTI_RAW_SHA256`. `OTI_EXPECTED_MANHATTAN_SET_SHA256` is
deliberately not referenced: it hashes a different domain (raw OBJECTIDs) and
the raw file is not present here.

### D8 - Audience eligibility is a sibling artifact, not a ledger field

`validateExteriorReleaseGraph` closes the ledger and cell key sets exactly
(`exactKeys`), so adding `privateEligible`/`publicEligible` to a cell would break
the accepted schema authority. Eligibility is therefore emitted as
`eligibility.json`, keyed by `cellId` and pinned to `{ledgerId,
ledgerChecksumSha256}`, with a closed field set and its own exported validator.

v1 declares every cell `privateEligible: true, publicEligible: false`. Public
conveyance requires per-cell rights-cleared promotion evidence that no exterior
asset has earned yet; a later promotion task owns widening it.

### D9 - Reconciliation reason codes

Closed vocabulary, one defined referent each:

| Code | Referent | Definition |
| --- | --- | --- |
| `missing` | building | In the base snapshot enumeration but owned by no cell. |
| `duplicate` | building + cell | Listed more than once inside one cell's membership. |
| `cross-cell-duplicate` | building + cell | Owned by more than one cell. `validateExteriorReleaseGraph` already rejects this; the code exists only so a composed report can surface that rejection in the same vocabulary, never to re-own the invariant. |
| `stale` | building + cell | A cell member absent from the base snapshot enumeration. |
| `changed` | cell | Recomputed `membershipChecksumSha256` differs from the declared value. |

Findings are ordered by `(code, cellId, buildingId, detail)`, so two runs over
the same inputs produce byte-identical reports regardless of input order.
Attribution is order-independent too: `cross-cell-duplicate` names the *second*
owner it meets, so reconciliation walks cells in the ledger's own `order`, never
in the array order of the value handed to it. The lower-order cell keeps
ownership and the higher-order cell is reported as the offender.

### D10 - Change-impact index v1

Deliberately narrow, no speculative diff engine:

1. `exteriorLedgerOwnerIndex` - building id to owning cell id, so a future base
   delta maps directly onto impacted cells.
2. `diffExteriorWaveLedgers` - fixture-proven behaviour over synthetic v1->v2
   ledger pairs: adds, removes, moves, added/removed cells, and cells whose
   declared checksum moved, all folded into a sorted `impactedCellIds`.
3. No predecessor-graph-over-ledgers claim. The only real predecessor edges today
   are cell-release lineage and source-snapshot lineage, both already owned by
   `exterior-release.ts`. A ledger has no predecessor field and none is invented.

### D11 - Committed artifacts and the CI strategy

Artifacts are committed under
`data/normalized/manhattan-exterior-wave-ledger-20260804/`, not `public/data/`:
nothing fetches the ledger at runtime, and keeping it out of the browser root
follows the 0023 boundary. Files: `ledger.json`, `ledger.sha256`,
`membership-digest.json`, `eligibility.json`, `reconciliation-report.json`.
`pnpm exterior-ledger:emit` is idempotent - a second run rewrites byte-identical
files and removes stale ones.

vitest never needs the 291 MB local dataset. The CI-runnable tests verify the
committed ledger from the artifact and digest alone: exactly-once ownership by
recomputing `baseIdentitySet.checksumSha256` from the cell arrays, contiguous
order, lexicographic order equal to visual-priority order, count 45,194, cap
compliance, complete tile-row coverage, coverage containment, digest and
eligibility pin agreement, `ledgerId` and `baseIdentitySet.id` recomputed from
first principles through the exported derivations, the Block 835 bounds literal
against the frozen public-realm clip rectangle, and the zero-finding
reconciliation report. The full
shard-level reconciliation against the 45,194 source features runs only in
`scripts/emit-exterior-wave-ledger.mjs`, whose PASS summary is PR evidence.

`validateExteriorWaveLedger` reuses `validateExteriorReleaseGraph` as the schema
authority by wrapping a bare ledger in the smallest structurally complete probe
graph. Those probe roots are never serialized, published, or treated as approval
evidence, and T011 emits no root manifest at all.

## Consequences

- The ledger is derived, reproducible, and checksum-pinned to one base snapshot.
- Any change to the snapshot or to the partition yields a new `ledgerId`; the
  ledger is never edited in place.
- Cell ids encode both wave and priority, so runtime ordering needs no runtime
  change - but a re-partition renames cells.
- 883 cells is the unit of downstream work for T013-T022.

## Forward findings for T013+ (handed forward, not fixed here)

1. **`src/app/App.tsx:1072` loads every cell with no viewport culling**
   (`Promise.all(exteriorCellRuntime.cellIds().map(loadCell))`). With 883 cells
   that is unusable as-is; cell selection must become viewport- and
   priority-driven before any real ledger is wired to the app.
2. **Runtime ordering depends on the cell-id naming scheme.** `cellIds()` sorts
   lexicographically; the zero-padded wave and order prefix is what makes that
   sort equal visual priority. Any future renaming must preserve it, or
   `src/runtime/` must gain an explicit order (outside T011's scope).
3. **Cell bounds are not a render extent.** 22% of buildings overhang their cell
   rectangle, by up to 248 m. Culling or tiling on `cell.bounds` alone would drop
   visible geometry; use it for assignment and provenance only.
4. **The Block 835 rectangle overlaps 8 leaf cell rectangles.** Any code that
   assumes disjoint cell rectangles must special-case the declared-set cell.
5. **The 120-building cap does not bound cache pressure across cells.** The
   256-entry cache is shared by the whole loader, so N resident cells cost
   roughly N x membership entries. Cell scheduling, eviction policy, and how many
   cells may be resident at once are unresolved and belong to T013+.
6. **A predecessor-fallback load roughly doubles a cell's entry cost.**
   `loadCell` re-runs `verifyCellRelease` on that path, so a fallback load of a
   near-cap cell can approach 238 entries on its own. Fallback behaviour should
   be measured against the real cache before any wave is promoted.
