# T004 — the six mass-generation retention waves

Date: 2026-08-16
Decision records: [ADR 0048](../decisions/0048-grammar-extensions.md),
[ADR 0049](../decisions/0049-rooftop-honesty-rules.md),
[ADR 0050](../decisions/0050-measured-lod1-fallback.md),
[ADR 0051](../decisions/0051-retention-package-validation.md)
Evidence: `data/mass-generation-20260816/coverage.json` (with `.sha256`), and per
wave `data/<releaseId>-c1/` — `payload-inventory.json`, `wave-census.json`,
`determinism-replay.json`, each with a `.sha256`

## The headline

**The island closes: 44,989 generated + 205 tombstoned = 45,194**, which is the
immutable ownership ledger's own owned-parent count, recomputed from its cell
membership rather than carried forward from the censuses that produced it.

Every one of the 45,194 canonical parents is now accounted for by a wave record
that either ships two levels of detail for it or names it with a stop code.

## The six rows

| wave | predecessor | owned | materialized | recovered | tombstoned | LOD-1 fallback | cells | bytes |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| w00 | `manhattan-exterior-cells-20260811-v3` | 14 | 14 | 0 | 0 | 0 | 1 | 9,620,802 |
| w01 | `manhattan-midtown-core-cells-20260811-v3` | 7,201 | 7,179 | 88 | 22 | 4 | 149 | 1,674,977,793 |
| w02 | `manhattan-lower-manhattan-cells-20260812` | 6,425 | 6,382 | 91 | 43 | 114 | 126 | 1,006,166,980 |
| w03 | `manhattan-southern-remainder-cells-20260812` | 9,603 | 9,560 | 53 | 43 | 289 | 176 | 1,202,442,064 |
| w04 | `manhattan-central-upper-manhattan-cells-20260812` | 11,721 | 11,682 | 139 | 39 | 3 | 249 | 1,469,180,692 |
| w05 | `manhattan-northern-manhattan-cells-20260812` | 10,230 | 10,172 | 323 | 58 | 14 | 182 | 1,053,432,311 |
| **island** | | **45,194** | **44,989** | **694** | **205** | **424** | **883** | **6,415,820,642** |

`recovered` is **re-measured** in the coverage pass, not carried forward: every
owned parent is planned again under the SHIPPED admission envelope, and a
building the retention wave generated while the shipped grammar refuses is a
recovery. The island total independently reproduces T003's **694**.

Its distribution is uneven and informative: **323 of the 694 recoveries are in
northern Manhattan alone**, against 53 in the southern remainder. The extensions
ADR 0048 measured are, in practice, mostly a northern-Manhattan low-rise story.

### The tombstones, per category

| stop code | count |
| --- | ---: |
| `ring-area-below-floor` | 114 |
| `ring-neck-below-grammar-minimum` | 44 |
| `volume-identity-failed` | 43 |
| `ring-not-simple` | 4 |
| **total** | **205** |

Every tombstone carries its building id, its owning cell, its stop code and the
stated refusal reason. A refusal is never a bare number.

## The LOD-1 fallback set is not a function of wave size

424 island-wide, distributed 0 / 4 / 114 / 289 / 3 / 14. The **largest** wave
(w04, 11,721 owned) produced **three** fallbacks; the smaller southern remainder
produced 289. Central and upper Manhattan's stock is deep-block and tall, so its
LOD-1 silhouette deviation sits far inside the 2% cap almost everywhere, while
lower Manhattan and the southern remainder carry exactly the small, narrow
footprints ADR 0050 predicted would exhibit it.

A rule keyed on an island-wide share would have mispredicted w04 by two orders
of magnitude in one direction and w02 in the other. That is the argument for
keying on a per-building measurement, restated as a measurement.

### 424 against ADR 0050's 425, reconciled

ADR 0050's island pass measured **425** over the **45,032** parents the
mass-generation envelope admits **at plan stage**. The waves generate **44,989**,
and the difference is exactly the **43** `volume-identity-failed` refusals, which
occur at ASSET stage — after a plan exists. One of the 425 over-cap buildings is
among those 43, so it is tombstoned rather than shipped as a fallback. 425 − 1 =
**424**. The two numbers describe different sets and both are correct.

## What was validated, and how

Per wave, the retention validator was green over **every declared cell manifest**
— 883 of 883 island-wide, not a sample:

- the assembly schema, then a full byte replay of every declared artifact;
- **one silhouette record for every coarse level**, including all 424 fallback
  zeros, each bound to its asset's own plan hash;
- the measured-fallback contract checked as a pair: an ineligible coarse level
  declares a derived error of 0, carries the fine level's triangle count, and
  forces its fine level unbounded so the asset always has an eligible
  representation;
- shared detail tiles re-rasterized from named constants and byte-compared, with
  only the classes a cell's own GLBs reference declared, so no orphan rides along;
- tombstone accounting: generated + tombstoned = owned, no building both packaged
  and tombstoned, and the packaged count equal to the census.

**The admission policy came from the package, never the operator.** See ADR 0051.

Each wave's validator output is committed as
`data/<releaseId>-c1/retention-validation.json` with a `.sha256`, and the
coverage record pins both it and the determinism replay by checksum. The drift
test asserts `validatedCellCount === declaredCellCount === cellManifestCount`,
`silhouetteRecords === materialized`, and that the fallback counts agree between
the validator and the census — so the table states what was CHECKED, not only
what was generated.

**Completeness is enforced rather than offered.** The validator refuses to
report `ok` without a committed completeness source, and refuses a `--max-cells`
run outright.

### Determinism

40 GLBs per wave, stratified across 40 distinct ownership cells by a stride over
cell order so the sample cannot come from one neighbourhood, regenerated from the
same pinned snapshot and ledger and byte-compared to the committed inventory.
**40/40 byte-identical on every wave**, and 28/28 on w00, which has only 28 GLBs.

## What is NOT claimed

- **The per-wave 16-sample Blender agreement did not run.** Blender MCP was
  disconnected for the entire task and was re-probed at every wave boundary. Each
  census records `"pending Blender connection"` and **nothing was substituted** —
  no render, no screenshot, no proxy measurement.
- No visual, geographic, architectural, accessibility or performance acceptance.
  A coarse level can sit inside a 2% area ratio and still read wrongly on screen.
- Cache-ceiling and streaming benchmarks against a two-LOD population belong to
  T005/T006.

## PAYLOAD RETENTION HOLD

**The six `public/data/*-c1` payload directories (~6.4 GB, gitignored) must
survive until the per-wave Blender samples have run.**

The 16-sample agreement has to be taken from the SAME bytes these records pin.
Deleting the payloads costs a full island regeneration — roughly 12 minutes of
generation plus a full re-validation — before the agreement could be run at all,
and the regenerated bytes would themselves need re-validating before they could
carry it.

Release the hold only after the Blender agreement has run, or after an explicit
decision that it will not be run. The hold is also carried in
`coverage.json.payloadRetentionHold` so it is machine-readable, and asserted by
the drift test.

**The Blender obligation is a hard pre-T005 item, pending the user's decision.**

Note that `scripts/validate-retention-release.test.mjs` skips its end-to-end
cases when the w00 payload is absent. That skip is honest — there are no emitted
bytes to assert about on a fresh clone — but it means deleting the payloads also
silently reduces that suite to its unit cases.

## Known-open: the App Escape-focus flake

`src/app/App.test.tsx > "closes details with Escape and returns focus to the
located-pick trigger"` **fails intermittently and is STILL OPEN.**

It is **pre-existing** — reproduced at `b598b78`, before any of this task's
changes — and it is **not** fixed by anything here. An earlier revision of this
record's task claimed the F13 memoization had fixed it. That claim was wrong and
is withdrawn: memoizing the V3 release build fixed a *different* failure (the
`midtown-core-v3-release` timeout) and reduced overall suite load, which makes
this flake rarer but does not remove it. A reviewer reproduced it once in two
full runs after the memoization landed.

It is unrelated to the retention waves — nothing in this task touches
`src/app/` — and it is recorded here so a green full-suite run is not mistaken
for evidence that it is gone.

## Rights and blast radius

The six `-c1` packages **retain bytes locally only**, under gitignored payload
directories totalling 6.4 GB. Nothing is conveyed, redistributed, published or
served. No external data was acquired and no retained snapshot was replaced.

**No approval envelope is widened.** ADR 0048 withheld the grammar extensions
from ACTIVATION and named the resolution it withheld them for: "a successor
release, not a constant edit" (R1 — the envelope in the wave profile, frozen
waves pinned to the shipped grammar, a new approved wave selecting the extended
one). The `-c1` profiles are exactly that selection. Every frozen wave profile
still carries `V3_FROZEN_WAVE_ADMISSION_ENVELOPE`, and the 89 frozen-pin tests
over the V3 release, its stage fingerprints, the materialization and the assembly
schema are green and unmoved.

No serving surface, no pinned release id and no promoted default changed. The
runtime rollback surface of this task is zero.
