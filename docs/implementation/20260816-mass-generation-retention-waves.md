# T004 — the six mass-generation retention waves

Date: 2026-08-16
Decision records: [ADR 0048](../decisions/0048-grammar-extensions.md),
[ADR 0049](../decisions/0049-rooftop-honesty-rules.md),
[ADR 0050](../decisions/0050-measured-lod1-fallback.md),
[ADR 0051](../decisions/0051-retention-package-validation.md)
Evidence: `data/mass-generation-20260816/coverage.json` and
`data/mass-generation-20260816/blender-agreement.json` (each with a `.sha256`),
and per wave `data/<releaseId>-c1/` — `payload-inventory.json`,
`wave-census.json`, `determinism-replay.json`, each with a `.sha256`

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

- **The per-wave 16-sample Blender agreement did not run** *at the time this
  record was first written.* Blender MCP was disconnected for the entire task and
  was re-probed at every wave boundary. Each census recorded `"pending Blender
  connection"` and **nothing was substituted** — no render, no screenshot, no
  proxy measurement. **SUPERSEDED:** the agreement has since run; see
  *The Blender agreement, run* below.
- No visual, geographic, architectural, accessibility or performance acceptance.
  A coarse level can sit inside a 2% area ratio and still read wrongly on screen.
- Cache-ceiling and streaming benchmarks against a two-LOD population belong to
  T005/T006.

## PAYLOAD RETENTION HOLD — released

**SUPERSEDED by *The Blender agreement, run* below.** The samples have been
taken from these exact bytes and `coverage.json.payloadRetentionHold.status` is
now `released`. The section below is kept as written because it states why the
hold existed and what releasing it costs to reverse.

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

## The Blender agreement, run

Blender MCP became available after this record was first written, and the
obligation the six censuses carried as `"pending Blender connection"` has been
discharged. `data/mass-generation-20260816/blender-agreement.json`
(`d3135d1f…`) is the evidence; each census's `blenderAgreement` block is amended
from pending to the measured outcome and re-pinned, and `coverage.json` carries
the new census hashes and the released hold.

**94 buildings, 188 shipped GLBs, 855,112 re-imported triangles.** The
obligation was sixteen per wave. Five waves give sixteen. **Wave `w00` owns 14
generatable buildings in total and cannot give sixteen distinct ones**, so it is
measured WHOLE — 14 of 14, 100% coverage — and that is stated as an exception in
the record rather than padded to a nominal sixteen. The island total is
therefore 94 rather than 96.

**The selection rule is seedless and rank-based**, so a reader reproduces it
with a sort. Per wave, candidates are the committed census's own materialized
set (its `lod1Decisions`, tombstones excluded). Sourced height ranks into four
quartiles; ring vertex count ranks into three terciles of which only the two
EDGE terciles are eligible; the eight resulting cells give two picks each, taken
at ranks `floor((m-1)/3)` and `floor(2(m-1)/3)` of the cell ordered by building
id. Four mandatory inclusions — largest ring, shortest building, worst measured
silhouette deviation, largest shipped asset — are then applied in that fixed
order, each displacing the largest-id ordinary pick from its own cell.

### What Blender measured, and what it did not

Blender re-imported each sample at BOTH LODs and measured, from its own importer
and its own topology: world bounds; ground-plane vertex bounds against the
sourced footprint polygon; triangle, material and image counts; signed mesh
volume by the divergence theorem; the two T004 rooftop rules; and the SHA-256 of
every file it opened, computed inside Blender and matched against the committed
payload inventory.

The imported frame is checked rather than assumed: the importer maps a Y-up file
`(x, y, z)` to `(x, -z, y)`, and these GLBs are written `(east, up, -north)`, so
the imported world frame IS the building-anchored ENU metre frame with no
compensation. A mis-stated mapping would show as a metres-scale disagreement.

**It did NOT re-measure the projected-silhouette deviation ratio.** That metric
is an exact union of axis-aligned rectangles over the plan's solid parts;
Blender holds a triangle soup and an exact union over it is neither cheap nor
exact. What Blender contributes to that number is a consistency statement, and
the record says only that: a zero ratio must come with equal imported bounds, a
positive ratio with strictly fewer LOD-1 triangles, and a `full-geometry`
fallback with two indistinguishable levels.

**It did not isolate the crown for itself either.** Every sampled building
carries a rooftop cluster, so the highest vertex is never the crown; the
analytic crown is handed in and Blender reports falsifiable properties of it.
The direct crown-equals-sourced-height comparison therefore applied to *no*
sample, and the record shows it as absent rather than as a passing zero.

Nothing was rendered. No image, screenshot or eyeball stands behind any number.

### Per-wave outcome

Worst value in each wave, all six `agreed`, zero failing samples:

| wave | samples | GLBs | ring vs SOURCED polygon | ring vs shipped ring | bounds vs analytic | crown vs sourced height (analytic) | rooftop rise above crown | rooftop containment slack | volume deviation | triangle delta |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| w00 | 14/14 | 28 | 0.4644 mm | 0.0035 mm | 0.0144 mm | 0.4560 mm | 3.5960 m | −6.697 m | 1.46e-7 | 0 |
| w01 | 16 | 32 | 0.4924 mm | 0.0028 mm | 0.0028 mm | 0.4560 mm | 3.5960 m | −1.171 m | 3.27e-7 | 0 |
| w02 | 16 | 32 | 0.4974 mm | 0.0020 mm | 0.0049 mm | 0.4857 mm | 3.5960 m | −1.782 m | 3.16e-7 | 0 |
| w03 | 16 | 32 | 0.4975 mm | 0.0020 mm | 0.0056 mm | 0.4734 mm | 3.5960 m | −2.300 m | 3.06e-7 | 0 |
| w04 | 16 | 32 | 0.4937 mm | 0.0037 mm | 0.0037 mm | 0.4240 mm | 3.5960 m | −1.843 m | 4.60e-7 | 0 |
| w05 | 16 | 32 | 0.4801 mm | 0.0037 mm | 0.0037 mm | 0.4960 mm | 3.5960 m | −2.821 m | 5.07e-7 | 0 |

The containment slack is **signed**: a negative number is the roof cluster
sitting that far *inside* the massing footprint, which is the passing direction.

### The tolerances are the quantization, not a knob

Every number above lands where the arithmetic says it must, and the two scales
are worth separating because they are different claims.

Against the **shipped** ring and the analytic tessellation the worst
disagreement is **3.7 µm**, and its whole content is glTF's float32 POSITION
storage: these frames reach a few hundred metres from their own origin, where a
float32 ulp is ~2.4e-5 m. Blender is reading back exactly what the writer wrote.

Against the **sourced** polygon the worst is **0.4975 mm**, and its whole
content is the plan rounding a float64 ENU ring to INTEGER MILLIMETRES before a
byte exists — a bound of 0.5 mm per axis, which the measurement approaches and
does not cross. That sits directly alongside the Block 835 precedent's 0.679 mm
per-vertex shape deviation and 0.248 mm vertical, measured on the same rounding
by a different pass.

**No tolerance was widened to absorb a delta.** The volume identity is judged at
`MIDTOWN_CORE_V3_VOLUME_TOLERANCE` (1e-6) — the writer's own constant, re-derived
here through Blender's topology — and the worst sample sits at 5.07e-7, half of
it. Triangle and material counts are judged at exact equality and every one of
the 188 assets matched.

### Two corrections made to the instrument, and one finding that is not one

Two rules in the *agreement harness* were wrong on first run and were corrected;
neither is a defect in the shipped bytes, the censuses or the analytic
instrument, and both are worth recording because a silently-fixed instrument is
indistinguishable from a rigged one.

1. The consistency rule asserted that a zero deviation ratio predicts
   geometrically identical LODs. It does not: `includeRecesses` gates the inward
   openings as well as the outward attachments, so LOD 0 differs from a
   shed-protrusions LOD 1 by recess geometry, which is interior and casts no
   shadow. 64 of 94 samples failed against the wrong rule. The corrected rule
   predicts equal *bounds*, which is what a zero ratio actually implies.
2. The "against the sourced polygon" extent was computed from the
   millimetre-rounded ring, which made it a duplicate of the "against the
   shipped ring" number rather than a statement about the source. It now
   projects the sourced polygon in float64 and never rounds it — which is why
   the two columns above differ by two orders of magnitude.

A third finding was first recorded here as "pre-existing and not caused by this
work": six failures in `scripts/validate-retention-release.test.mjs`, all with
`root self-pin disagrees with its own canonical bytes`. **That
characterisation was WRONG and is withdrawn.** It was not pre-existing, and it
was not a defect in committed bytes. See *Incident: the test suite wrote to the
retained payload* below.

### What this does and does not license

The hold is released because the samples it was protecting have been taken.
Releasing it says these local bytes are no longer needed for THIS evidence item.
It is not a deletion, not a conveyance, and not permission to replace or
republish anything.

The agreement is a **geometry-agreement** statement over 94 of 44,989 generated
buildings (0.21%), stratified and forced to include four per-wave extremes. It
is not visual, geographic, architectural, accessibility or performance
acceptance, and it says nothing about the 44,895 buildings it did not open.

## Incident: the test suite wrote to the retained payload

**`scripts/validate-retention-release.test.mjs` corrupted the real w00
`retention-root.json`.** It has been fixed, the file has been restored
byte-exactly, and a tripwire now fails loudly if it ever happens again. This is
recorded in full because it is precisely the hazard the PAYLOAD RETENTION HOLD
exists to guard against, and because the first diagnosis of it was wrong.

### What happened

`public/data/<releaseId>` is a **symlink** whenever the retained payload lives in
another worktree — which is exactly the arrangement the hold creates. The
suite's `scratch()` helper built its throwaway copy with:

```js
cpSync(SOURCE_PACKAGE, join(root, "package"), { recursive: true });
```

`cpSync` defaults to `dereference: false`. **Handed a symlinked source it copies
the symlink, not the tree.** `<tmp>/package` therefore became a second name for
the real payload directory, and the case *"refuses an edited self-pin before
reading any policy"* — which writes a deliberately tampered `retention-root.json`
into what it believes is scratch space — wrote

```
"textureAdmission": { "policy": "texture-free", ... }
```

straight into the retained package. The tamper is 5 bytes shorter than the
truth (`texture-free` against `procedural-replay`), which is exactly the 2,624 →
2,619 byte drop observed.

`data/<releaseId>` is a real tracked directory, so `<tmp>/records` was a genuine
copy. That is why the blast radius was one file in one package rather than the
whole tree.

The corrupted root then failed its own self-pin, which took the other five
payload-gated cases down with it — six failures whose message pointed at the
committed bytes rather than at the test that had just rewritten them.

### Why the first diagnosis was wrong

The failures were checked by stashing every change in this task and re-running,
which reproduced them exactly — and that was read as proof they pre-dated the
work. **It was not proof.** The damage had already been done by an *earlier*
full-suite run in this same session, so the stashed baseline was measuring an
already-corrupted tree. A stash reverts the working tree; it does not revert a
gitignored payload directory that a test wrote to. The reproduction was real and
the inference from it was invalid.

### The fix

The source is resolved through `realpathSync` and copied with
`dereference: true`, so the destination is always an independent tree, and the
result is **asserted** not to be a link. Restore-on-failure was considered and
rejected: a crashed or killed run would leave the payload tampered. The real
directory is simply never writable from the suite.

Two new cases guard it:

- *"copies the real package instead of aliasing it"* — the scratch root's
  `package` and `records` must not resolve to the real directories.
- A `beforeAll`/`afterAll` tripwire hashing the real w00 `retention-root.json`
  around the whole block, which throws and names the file on any change. One
  file, hashed twice.

Both were verified against the old behaviour in isolation: `cpSync` on a
symlinked source produces a link and a write through it reaches the original;
with `realpathSync` + `dereference: true` it produces a real copy and the
original is untouched.

### The restoration

Restored by setting the tampered field back and re-serialising with the writer's
own format, then **verified against the committed payload inventory** rather
than against intent:

| | value |
| --- | --- |
| restored SHA-256 | `e5cb9357df22f1fa50d4a7b2eb0f1e7a54660231ceb063cd5155e9d5dc4a9f73` |
| inventory pin | `e5cb9357df22f1fa50d4a7b2eb0f1e7a54660231ceb063cd5155e9d5dc4a9f73` |
| restored byteSize | 2,624 |
| inventory pin | 2,624 |

`scripts/validate-retention-release.test.mjs` is **27/27** (26 original plus the
new alias guard), the w00 retention validator runs green end to end against the
real package, and the tripwire confirms the payload is byte-identical after the
suite.

### What it did NOT affect

**The Blender agreement is unaffected**, and this is checked rather than
asserted. The agreement never reads `retention-root.json`: its selection stage
verifies every cell assembly manifest and every sampled GLB against the
committed payload inventory and stops on any mismatch, and it was re-run after
the restoration and still resolves all 94 samples with zero checksum
disagreements. The measurements themselves were taken before the first suite run
that caused the damage, and no GLB was ever written to. All other files across
all six waves match their inventories.
