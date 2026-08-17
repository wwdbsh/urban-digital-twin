# T009 — the textured-lod_1 campaign

Date: 2026-08-17
Decision record: [ADR 0056](../decisions/0056-textured-lod1-tone-and-copy.md)
Evidence: `data/lod1-texturing-20260817/` (`stage0-gate.json`, `step2-gates.json`,
`palette-binding.json`, `sampling-pre-registration.json`, `sampling-results.json`,
`coverage.json`, each with a `.sha256`), and per wave `data/<releaseId>-c2/`
(`payload-inventory.json`, `wave-census.json`, `retention-validation.json`,
`verification.json`, each with a `.sha256`)

## The headline

**44,989 buildings now carry a TEXTURED coarse level, including all
424 textured fallbacks, and 205 tombstones are carried untouched
from `-c1`. 44,989 + 205 = 45,194**, the immutable ownership ledger's own
owned-parent count, recomputed from its cell membership rather than carried
forward from the censuses that produced it.

## The six waves

| wave | textured lod_1 | tombstoned | fallbacks | cells | lod_0 MB (copied) | lod_1 MB | lod_1 delta MB | validator | replay | lod_0 verify |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| w00 | 14 | 0 | 0 | 1 | 7.5 | 2.8 | +0.8 | 1/1 | 28/28 | 14/14 |
| w01 | 7,179 | 22 | 4 | 149 | 1,269.3 | 527.6 | +153.0 | 149/149 | 40/40 | 7,179/7,179 |
| w02 | 6,382 | 43 | 114 | 126 | 739.7 | 329.8 | +92.7 | 126/126 | 40/40 | 6,382/6,382 |
| w03 | 9,560 | 43 | 289 | 176 | 868.5 | 400.3 | +110.5 | 176/176 | 40/40 | 9,560/9,560 |
| w04 | 11,682 | 39 | 3 | 249 | 1,057.5 | 492.2 | +134.6 | 249/249 | 40/40 | 11,682/11,682 |
| w05 | 10,172 | 58 | 14 | 182 | 736.8 | 367.5 | +97.8 | 182/182 | 40/40 | 10,172/10,172 |
| **island** | **44,989** | **205** | **424** | **883** | **4.68 GB** | **2.12 GB** | **+0.59 GB** | 883/883 | 228/228 | **44,989/44,989** |

## Measured storage, replacing the projection

Stage 0 projected the lod_1 texturing delta at **0.4-1.3 GB**, consistent with
the architect's +0.5-1.1 GB and NOT with +3-4 GB. **The measured delta is
+0.59 GB** — `-c1` lod_1 totalled 1.53 GB and `-c2` lod_1 totals
2.12 GB. It lands inside both ranges and the projection is now retired.

Total `-c2` payload is **7.01 GB**, of which 4.68 GB is copied lod_0.

## What was proved, and how

- **Palette**: no code change was needed and that was VERIFIED, not assumed —
  containment 446/446 in emitted bytes, and 58/58 element-for-element at the
  seam. See ADR 0056.
- **lod_0 unmoved**: every one of the 44,989 copied lod_0 assets verified twice,
  against the `-c1` inventory and against re-emission. Gate 2b re-run: 214/214.
- **Validator**: ADR 0051 retention validator green over all **883** declared cell
  manifests, with both completeness sources on every wave.
- **Determinism**: 40 GLBs per wave (28 for w00, its whole population),
  byte-identical, under a sampler that reserves a FALLBACK QUOTA (4) and caps
  per-cell contribution so the sample spreads across 10 ownership cells and
  covers 36 shed assets as well. The earlier reading, where fallbacks consumed
  the whole cap on w03 and left shed coverage at zero, is preserved in each
  wave's `verification.json` under `supersededReadings`.
- **`-c1` immutability**: spot-checked on every wave, 335 artifacts re-hashed
  from disk, 0 differing, 0 symlinks.

## The appearance sampling, and its miss

Pre-registered before any still existed; 39 pairs, 78 stills, 0 errors.

**The FALLBACK cell passes outright: 15/15 at a luminance ratio of exactly
1.000000 with a per-channel spread of exactly 0.0.** Those levels share geometry,
so the cell isolates the material binding, and it is what settles the palette
question. The same buildings differed by 11-16% before the campaign.

**The SHED cell MISSES on 12 of 24 pairs.** A post-hoc intersection measure
attributes most of the dip to the pre-registered measure conflating silhouette
AREA with tone — a flaw in the measure, owned rather than hidden — and recovers
19/24. **Five pairs remain unexplained and the pre-registered result stands as a
MISS.** The campaign does not establish that every shed lod_1 matches its lod_0
in tone at mid distance.

## What is NOT claimed

- No visual, geographic, architectural, accessibility or performance acceptance.
- The tile is NOT resolvable at mid ring; Stage 0 measured that and it is
  unchanged. This campaign was a completeness decision, not a refutation.
- `-c2` keeps `maxDistanceMeters: null` at both levels and `eligible: false` for
  the 424. Distinct thresholds belong to T001's `-s2`.

## Known-open: the App Escape failure is LOAD-DEPENDENT, and the two measurements disagree

`src/app/App.test.tsx > "closes details with Escape and returns focus to the
located-pick trigger"`. Both readings are recorded because they do not agree, and
picking the more convenient one would be the error:

| observer | method | result |
| --- | --- | --- |
| reviewer | full-suite runs | **2 of 2 FAILED**, same assertion |
| this task | full-suite runs, idle machine | **1 of 3 FAILED** (pass, pass, fail) |
| this task | isolated file runs | **0 of 3 failed** |

**"Deterministic under load" is therefore too strong, and "intermittent flake" is
too dismissive.** The defensible statement is that it is **load-dependent and
non-deterministic**: it never fails in isolation, it fails often under full-suite
load, and it does not fail on every such run. The reviewer's 2/2 and this task's
1/3 are consistent with a high but sub-unity failure rate rather than with
determinism.

That distinction matters for the remedy. A genuinely deterministic failure can be
debugged from one run; this one needs a harness that reproduces it reliably
before a fix can be trusted, and any "fixed" claim needs repeated full-suite runs
rather than a single green.

It is **pre-existing** — it reproduces at `b598b78`, before any T004 or T009
change — and unrelated to this campaign, which touches nothing under `src/app/`.
It is **not** claimed as cleared by anything here.

**It needs an owning task that may touch `src/`.** T009 cannot be that task: this
campaign's constraint is that no serving-surface code changes, so a React
focus-restoration fix is outside its envelope by construction.

## Retention hold

The six `public/data/*-c2` payload directories (7.01 GB, gitignored) and the
six `-c1` directories they were built from are both required to re-run any of
this. `-c1` is READ-ONLY and was spot-checked unchanged on every wave.
