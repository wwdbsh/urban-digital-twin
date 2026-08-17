# Exterior-completion goal closure (T008)

Date: 2026-08-17
Task: T008 (Issue #90)
Decision record: ADR 0055
Records: `data/exterior-completion-acceptance-20260817/`

## Three staged commits

| Commit | Contents |
| --- | --- |
| 1 — licensing + docs | `LICENSE`, `NOTICE`, the registry-agreement test, README/PROJECT_BRIEF closure edits, and the live-pin assertion message |
| 2 — this goal's record | `reconciliation.json`, `refusal-code-mapping.json`, sidecars, drift test — frozen, then hashed |
| 3 — the amendment | prior criterion #1 closed, its test edits, the cross-file pin, ADR 0055, this record |
| 4 — review closure | 3 blocking + 7 non-blocking review findings, re-cutting both hashes in the chain |

Ordering is load-bearing: commit 3 embeds commit 2's frozen hash, so commit 2
had to be complete before commit 3 was written. Any later edit to the frozen
record breaks the amendment and requires re-hashing both in one fix commit.

## Licensing

`LICENSE` claims project code and generated artifacts and disclaims third-party
source data, with **six** carve-outs by name. The plan asked for two; CC BY-SA
4.0 is also share-alike, so carving out only ODbL and NYC Open Data would have
left a real share-alike obligation inside a proprietary claim, and review
closure added `nyc-publication-facts` (agency publications, outside the literal
wording of the Open Data terms). The remaining two of the registry's eight
classes — `public-domain` and `fixture-only` — need no carve-out and are named
as such, so the mapping is exhaustive on its face.

`NOTICE` is derived from the source registry (45 entries, 8 licence classes) and
names it as governing. `scripts/source-attribution-notice.test.mjs` asserts every
attribution string, source id, terms URL and licence class still appears.

Its share-alike check was **inverted during review closure**, and the reason is
worth recording: it had filtered the registry against a hard-coded set of two
share-alike classes and asserted those were carved out, which could only ever
check what it already knew — a newly ingested class would not be in the set, the
filter would skip it, and the test would pass while `LICENSE` said nothing about
it. The comment claimed the check was derived from the registry; it was not. The
allow-list now covers **classification**: every class the registry uses must be
classified share-alike or not, and an unclassified class fails.

## Docs

README and PROJECT_BRIEF now say 44,989 of 45,194 (99.55%) with 205 tombstoned,
carry the post-extension four-code refusal vocabulary, and describe criterion 1
as closed-as-adjudicated. Review closure corrected two further stale claims that
survived the first pass: the cell bullet said **870 of 883** cells ship no
generated geometry when the true figure is **0 of 883** (and the not-shipped
notice it quotes no longer fires on the shipped default — ADR 0054 D-4), and the
refusal paragraph said all three extension-eligible categories were "gone" when
in fact **two of three** cleared outright (384 -> 0, 324 -> 0) and
`ring-area-below-floor` cleared **none** of its 113, reading 114 after a single
migration. Three live pins were preserved deliberately because
they remain true as dense-tier facts: `41,841`, `58,243,420`, and lowercase
`textured`. The README rollback paragraph (41,841 → 5,289) is untouched; T007
depends on that arm. The pin test's assertion *message* was updated in lockstep
now that 484 is gone — the assertion itself is unchanged because the hazard it
guards (quoting the textured tier as "what renders") is unchanged.

## The mapping

`refusal-code-mapping.json` re-aggregates committed per-building vectors from
`data/grammar-extension-20260815/`; nothing was re-measured. The test asserts the
sets partition 899 exactly and that the transition matrix balances against both
the before and after tallies — every before-code's still-refused plus recovered
equals its original count.

| | before | after |
| --- | --- | --- |
| `source-height-below-grammar-minimum` | 384 | 0 |
| `ring-vertex-count-unsupported` | 324 | 0 |
| `ring-area-below-floor` | 113 | **114** |
| `ring-neck-below-grammar-minimum` | 39 | 44 |
| `volume-identity-failed` | 35 | 43 |
| `ring-not-simple` | 4 | 4 |
| **total** | **899** | **205** (+694 recovered) |

The 113 → 114 inversion: the classifier is priority-ordered, so raising the
vertex cap let exactly one building past that gate and into the area-floor gate.

## Findings recorded rather than smoothed

- **The frozen plan contradicted itself on the grade split.** Its summary said
  3 MET / 8 adjudicated; its itemized table named four MET criteria. The record
  follows the itemized table and derives the counts, because reaching 3/8 would
  have meant regrading a clean MET with no delta to justify it.
- **The `App.test.tsx` Escape flake is omitted from the record's residual risks,
  on SCOPE grounds** — disclosed here instead, which is the T006 precedent for a
  defect that is real but not this goal's.

  The earlier justification given for the omission was wrong and is corrected
  rather than quietly replaced: it said citing the flake would breach the
  record's rule that every figure be findable in a checksummed file. That rule
  binds `data/` paths named in verdict prose. It does not constrain
  `residualRisks`, and a risk naming `src/app/App.test.tsx` would have needed no
  checksum at all. The omission was defensible; the reason given for it was not.

  The actual reason: `src/app/App.test.tsx > "closes details with Escape and
  returns focus to the located-pick trigger"` fails intermittently under full-
  suite load and **reproduces at base `34fa700`** with none of this task's
  changes (1 failed / 2331 passed), passing in isolation on both trees. It is
  pre-existing, unrelated to anything this goal shipped, and belongs to whoever
  owns that test rather than to this closure. It is not fixed and is not
  claimed to be.
- **One test edit beyond the enumerated list.** `goal-integration-reconciliation.test.mjs`
  built its verdict counts by accumulation, so once `NOT-MET` reached zero the
  key vanished and the comparison failed on object shape rather than on counts.
  Seeding from `verdictVocabulary` fixes it and keeps the `stopReportCount`
  assertion from comparing against `undefined`.

## Not claimed

- Criterion 4 is NOT-MET. Not deferred, not acceptable.
- 14 of 31 closed criteria in the prior record are adjudicated, not clean.
- Replay is provable only where a retained payload exists; the payload trees are
  gitignored.
