# Northern-Manhattan wave promotion (T022) — implementation record

Wave `w05` (`northern-manhattan`) is promoted as
`manhattan-northern-manhattan-cells-20260812-p1`, the **sixth and last** default
exterior record. The decision record is the T022 amendment appended to
[ADR 0037](../decisions/0037-northern-manhattan-textured-canary.md); this file is
the durable implementation record: what was built, what was measured, and what
went wrong on the way.

## What shipped

| | |
| --- | --- |
| Release | `manhattan-northern-manhattan-cells-20260812-p1` |
| Predecessor (graph) | `manhattan-northern-manhattan-cells-20260812` (T021 canary), pinned by its committed inventory checksum |
| Renderable subset | ONE curated cell, `manhattan-exterior-cell-w05-000727-17-38611-35819` |
| Owned / materialized / refused | 24 / 24 / 0 |
| Cells / tombstones | 182 / 181 |
| Shipped assets | 24 GLB, 4,219,756 B, 260 payload files |
| Snapshot | `snapshot:…-p1:v1` `5369464f…` |
| Assembly | `assembly:…-p1:v1` |
| Cell-membership digest | `54b43905…` over 182 cell releases |
| Entry budget | 36 (the reservation T020 recorded), 12 unspent |
| Ledger-wide occupancy | 498 of 512 entries, 14 free |

## Files by stage

**Curation and release identity**

- `src/release/northern-manhattan-curation.ts` — the curated list, the decision
  rule, the rejected alternatives, the inherited-reservation budget, the local
  refusal census and the volume margin.
- `src/release/northern-manhattan-p1-release.ts` — successor identity, the
  canary's rights instrument carried by reference, predecessor pins derived from
  the canary's committed inventory.

**Pipeline**

- `scripts/northern-manhattan-cli.mjs` — the `p1` variant added to
  `RELEASE_VARIANTS`; the plans stage grew the skyline census over all 182 cells
  at seven thresholds; the graph stage grew the `skyline-census.json` write and
  made `renderableWalk` conditional, because a curated list is not a walk.
- `scripts/northern-manhattan-acceptance-cli.mjs` — six-wave acceptance capture.
- `scripts/northern-manhattan-journeys-p1-cli.mjs` — five renderer journeys.
- `scripts/blender/northern_manhattan_sample.py`,
  `scripts/northern-manhattan-blender-record-cli.mjs` — the `p1` variant, selected
  together with its work root so a report cannot name one release and measure
  another.

**Promotion**

- `src/runtime/exterior-default-activation.ts` — `NORTHERN_MANHATTAN_EXTERIOR_ACTIVATION`,
  its base-only predecessor and its 24 accepted identities; `exteriorDefaultActivations`
  gained a sixth parameter. The five earlier records are byte-untouched.
- `src/app/App.tsx` — the successor added to `PINNED_EXTERIOR_CELL_RELEASE_IDS`.

**Committed records** — `data/northern-manhattan-20260812-p1/`:
`payload-inventory.json`, `derivation.json`, `wave-census.json`,
`skyline-census.json`, `acceptance-evidence.json`, `journey-evidence.json`,
`blender-sample.json`.

## Tests

New: `northern-manhattan-curation.test.ts` (23),
`northern-manhattan-curation-optimum.test.ts` (14),
`northern-manhattan-fingerprint.test.ts` (3),
`northern-manhattan-p1-evidence-consistency.test.ts` (18) — a SIBLING of the T021 canary's evidence suite, which is untouched,
`exterior-northern-manhattan-promotion-record.test.ts` (20).

Edited: `exterior-cache-ceiling.test.ts` (six-wave arithmetic + byte profile row),
`exterior-multiwave-activation.test.ts` (six-wave set + the `w05` rollback
rehearsal), `northern-manhattan-release.test.ts` (canary occupancy frozen),
`central-upper-manhattan-release.test.ts` and
`exterior-central-upper-manhattan-promotion-record.test.ts` (position, not set
length), `App.test.tsx`.

## Findings, in the order they were found

### The reservation could not be read from the variant's own predecessor

The canary read its reservation from the same bytes it pinned as its graph
predecessor, so one path served both. That coincidence does not survive the
successor: its predecessor is the CANARY, while the reservation still belongs to
the promoted wave-`w04` release that recorded it. The first `p1` run failed with
*"the reservation must be read from manhattan-central-upper-manhattan-cells-20260812-p1,
not manhattan-northern-manhattan-cells-20260812"* — the guard working. Fixed by
reading the reservation from a named constant path rather than from whatever a
variant happens to pin. The canary's emitted bytes are unaffected, because for it
the two paths are the same file.

### Key 5 is reached at 60 m, and the first draft said otherwise

The curation module was drafted claiming `{707}` wins outright at 60 m. The
optimum suite disagreed on its first run: cells 707 and 782 both carry two
buildings at 60 m and both are single cells, so keys 3 and 4 leave a two-way tie
that only the lexicographic fallback breaks. The module, the shipped curation
statement and the suite were corrected to record that key 5 is reached at two of
the seven thresholds — 60 m and 120 m — and not at the stated one. The release was
re-emitted with the corrected statement.

### The wave's sourced-height total was guessed and then measured

The first emitted statement said "19 of 10,206 sourced heights". 10,206 is the
wave's UNAVAILABLE building count, not its sourced-height count; the true figure
is 10,214. Caught by reading the emitted skyline census rather than by a test, and
the release was re-emitted. A reminder that a number written before the census
exists is a guess even when it is nearly right.

### Responses and distinct artifacts stop being the same number at six waves

The first journeys run failed `cold-default`: 25 GLB responses for a release that
ships 24 assets. It is not a defect in the release — the shared LRU cache holds
512 entries, a six-wave session gets close to that, and an artifact evicted and
then brought back into view is fetched twice. Both CLIs now count DISTINCT
artifacts as well as responses; residency is derived from the distinct count,
because occupancy is a question about entries, and the response count ships beside
it so the gap is visible rather than absorbed. Counting responses would have
overstated residency — the safe direction, but not the true one.

### Three prose defects in committed evidence, found by review

Every one of these was in text a human reads, beside machine-readable fields that
were correct. None was reachable by a checksum.

1. **The Blender record shipped the CANARY's sentences.** A single shared
   `NOTE_SUFFIX` carried "THE SAMPLE IS 69 OF 76 SHIPPED ASSETS" and a volume
   paragraph phrased as though its wave-scale figures were the record's own into
   the promoted successor's `blender-sample.json` — beside a summary stating 24
   samples, zero refusals and a worst deviation of 1.63e-07. The variant-specific
   sentences moved into the variants (the canary's concatenation is byte-identical
   and that is verified), `crossCheck.statement` is now derived from
   `sampledShareOfShipped` rather than written for one variant, and a new gate in
   `northern-manhattan-p1-evidence-consistency.test.ts` refuses ANY number in the
   record's prose that the record, its inventory or its census does not carry. Run
   against the old shared prose that gate reports the unsupported tokens `69`,
   `76`, `53`.
2. **"The first record where they differ" was not true of any committed row.** The
   responses-versus-distinct-artifacts statement claimed a difference that the
   observed run did not contain. It is now DERIVED — the record counts the captures
   in which responses exceeded entries and says what it found — because a constant
   sentence about a run that has not happened yet is a guess. The re-run reports 1
   of 12 captures with a re-fetch, at most three responses over entries. The
   "counting responses would overstate residency" line was also softened: distinct
   over a whole session is ITSELF an upper bound on concurrent residency, because
   an artifact fetched early and evicted later is counted and is not resident at
   the end.
3. **Assets were substituted for buildings** in the ADR's completion arithmetic:
   "498 of 45,194 buildings". The promoted set accepts 484 canonical buildings and
   ships 498 GLB assets, because Block 835 alone ships both levels of detail for
   its 14. Corrected in both places, with the two counts kept apart.

A fourth, smaller item: the threshold-winner table pinned the 120 m entry by
calling the rule on both sides of the comparison, which pinned nothing. It carries
the literal now, with a note saying why 120 m is the one threshold whose "winner"
is only the fallback's output.

### The sixth-wave cache guard fired

Adding the promotion record made `exterior-cache-ceiling.test.ts` fail to LOAD
with *"promoted release manhattan-northern-manhattan-cells-20260812-p1 has no
measured byte profile"* before its row existed. This is the second time that guard
has fired on a real promotion, and the suite now says so where the row lives.

### The T021 canary's live occupancy check went red, as designed

That record asserted its promoted-wave list EQUALS the live enabled set, and said
in its own comment that a sixth promotion would make it go red. It did. Resolved
by FREEZING the canary's record — an immutable canary's own count of the five
waves promoted when it was emitted — and keeping the live comparison as a prefix
check, exactly as `w03` and `w04` resolved theirs.

## Verification

`pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` all pass. Frame
budgets, residency, journeys and the Blender census are recorded in the ADR
amendment and in the committed evidence files.

## What is NOT closed

- **ADR 0037 precondition (e)** — the wave-scale volume margin at 0.9895 of
  tolerance and the 16 buildings refused for exceeding it — is not explained by
  this promotion. The curated subset contains none of the narrow cases.
- **Breadth inside each wave** stays bounded by the 512-entry cache contract.
  ADR 0024's cell scheduling is the structural follow-up.
