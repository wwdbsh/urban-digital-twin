# Southern-remainder textured canary (T017)

Durable implementation record for
`manhattan-southern-remainder-cells-20260812`, wave `w03` of the provider-neutral
Manhattan exterior configuration. See ADR 0035 for the decisions; this file is
what was built, what it measured, and how to reproduce it.

## What shipped

| fact | value |
| --- | --- |
| release id | `manhattan-southern-remainder-cells-20260812` |
| wave | `w03` / `southern-remainder`, ledger `manhattan-exterior-wave-ledger-20260804` |
| owned | 176 cells, 9,603 canonical buildings |
| renderable | 1 cell (`…-w03-000276-17-38590-35872`), 77 owned buildings, 76 materialized assets |
| tombstoned | 175 cells |
| textures | `procedural-texture-v1`, LOD 0 only, `LINEAR` / `LINEAR_MIPMAP_LINEAR` |
| admission | `procedural-replay` on both emitted roots |
| predecessor | `manhattan-lower-manhattan-cells-20260812-p1` (root + snapshot pins) |
| approval | `approval:…:southern-remainder-textured-canary`, fingerprint `c4ba50b3…6054ac4` |
| payload | 410 files, 22,574,234 bytes |
| promoted | **no** — pinned for explicit `?exteriorCells=` opt-in only |

## Reproducing it

```sh
pnpm install --frozen-lockfile

pnpm southern-remainder:pipeline plans
pnpm southern-remainder:pipeline glbs
pnpm southern-remainder:pipeline gates
pnpm southern-remainder:pipeline graph
pnpm southern-remainder:pipeline sample
```

There is no `probe` stage. The kill switch is INHERITED from T015/T016 on an
identical tile catalogue; ADR 0035 Decision 2 records the inheritance and its
limits.

Then the Blender pass, through Blender MCP, running
`scripts/blender/southern_remainder_sample.py`, followed by the record writer
that cross-checks it against the committed inventory:

```sh
pnpm southern-remainder:blender-record
```

Then the renderer journeys, against a production preview on a port **you own**:

```sh
pnpm build
npx vite preview --port 4187 --strictPort
# Chrome: --remote-debugging-port=9222 --headless=new
pnpm southern-remainder:journeys --preview http://localhost:4187 --port 9222
```

Verify the served bundle is yours before believing a journey — see "Verification
gaps, stated". Every stage writes a receipt fingerprinting its inputs, so an
interrupted run resumes; `--force` re-runs one regardless.

## Refusal census (stages `plans` and `glbs`)

Over all 9,603 owned buildings, untextured, `census-only` retention. Tiles touch
no plan field, so every plan hash is identical to the shipped pass.

| | count |
| --- | --- |
| owned | 9,603 |
| resolved from the pinned base shards | 9,603 |
| materialized | 9,507 |
| refused | **96 (1.00%)** |
| `setbacks` ABSENT with a stated reason | **3,960** |
| unique plan hashes | 9,507 (one per materialized building) |
| fallback heights | 6 |

| stop code | count | stage that raised it |
| --- | --- | --- |
| `source-height-below-grammar-minimum` | 33 | plan |
| `ring-vertex-count-unsupported` | 22 | plan |
| `ring-area-below-floor` | 20 | plan |
| `volume-identity-failed` | 11 | writer |
| `ring-neck-below-grammar-minimum` | 10 | plan |

The plan stage reports **85** refusals and the asset stage reports **96**. The
difference is exactly the 11 `volume-identity-failed` — the writer's own
mesh-versus-analytic identity check failing after a plan was accepted. It is a
stage boundary, not a discrepancy, and both numbers are committed.

Wave-scale worst observations, all inside budget: 44,360 triangles (budget
200,000), 9 materials (budget 12), worst volume deviation 9.66e-07, worst
per-vertex shape deviation 0.70 mm, worst horizontal 0.45 mm, worst vertical
0.50 mm. Style classes: 3,719 masonry-warm, 3,055 masonry-light, 1,716
stone-neutral, 1,017 curtain-cool.

## Renderable-subset derivation (stage `gates`)

| quantity | value |
| --- | --- |
| runtime cache cap | 256 entries |
| Block 835 V3 | 28 |
| Midtown-core V3 | 156 |
| Lower-Manhattan P1 | 71 |
| promoted total | **255** |
| headroom alongside promoted | **1** |
| cells of this wave that fit in that headroom | **2 of 176** |
| smallest / median cell | 1 / 50 buildings |
| `admitsMedianCellAlongsidePromoted` | **false** |
| opt-in solo ceiling | 256 |
| modest subset ceiling (judgement) | **80** |
| applied entry budget | 80 |
| chosen | 1 cell, 77 owned, 3 spare |
| shipped assets | 76 (1 refused: `doitt:197488`) |
| local refusal rate | 1 of 77 = **1.30%** vs the 1.00% wave rate |

Every promoted term is read from that wave's own committed inventory or payload
directory, never from a remembered number, and tests pin each one to its source.
`EXTERIOR_RUNTIME_BUDGETS` is unchanged by this release.

## Blender re-import (stage `sample`)

Blender 5.2.0 LTS / Python 3.13.13, over **all 56** sampled assets — 11 strata of
4, plus **every one of the 35** disclosed tier collapses in the renderable cell
rather than a sample of them.

| measurement | result | tolerance |
| --- | --- | --- |
| triangle delta, worst | **0** | exact |
| material mismatches | **0** | exact |
| bounds deviation, worst | **0.0 m** | 1e-3 m |
| Z-up control hypothesis, best case | **3.23 m** | must be large |
| volume deviation, worst | **3.74e-07** | 1e-06 |
| not-solid count | **0** | 0 |
| embedded images | **167** across 56 assets | — |
| image-count mismatches | **0** | 0 |
| unreachable textures | **0** | 0 |
| minimum UV layer count | **1** | ≥ 1 |
| checksum mismatches vs committed inventory | **0** | 0 |

The Z-up control is what makes the bounds diff mean something: pretending the
file was authored Z-up puts the best case 3.23 m out, so a 0.0 m result under the
correct remap is a measurement rather than a tautology.

"Unreachable textures" is the check no checksum can perform: an asset can embed a
valid PNG, declare it, pass every byte gate and still render flat if no material
samples it. Zero unreachable, minimum one UV layer, 167 images bound.

The 56 renders are not committed; each is pinned by SHA-256 in
`blender-sample.json`, and every sampled asset's checksum is cross-checked
against the committed payload inventory **before** it is recorded — a mismatch
fails the record writer rather than being logged as a finding.

## Renderer journeys

Production preview, real pinned citywide base, Chrome 151 headless, viewport
1280×800. All four pass; every `passed` is computed from the readings.

| journey | reading |
| --- | --- |
| `promoted-default-unchanged` | clean load: Block 835 14 GLBs, Midtown 136, Lower-Manhattan P1 71, **this release 0 GLBs / 0 bytes**, 0 external hosts |
| `canary-opt-in` | opt-in link: **this release 76 GLBs / 9.10 MB**, every promoted wave **0**, 0 external hosts |
| `textured-pick` | picked `doitt:465469`: badge `Local · manhattan-southern-remainder-cells-20260812`, cell + cell release `…w03-000276…:v1`, active asset `lod_0 · 0b0f0698…5649e`, truth tiers `absent · generated`, source dates, full uncertainty statement |
| `tombstone-truth` | "Exterior release manhattan-southern-remainder-cells-20260812: 175 of 176 exterior cells ship no exterior geometry in this release; no substitute was selected for them." |

`canary-opt-in` is load-bearing beyond its own claim: the entry budget rests on
`?exteriorCells=` **selecting** rather than adding, and the zero counts for all
three promoted waves are what makes that a measurement rather than an assumption.

`promoted-default-unchanged` read 136 Midtown GLBs rather than 156 because the
camera stands in the West Village and the loader is progressive; the criterion is
"> 0 for each promoted wave, exactly 0 for this one", which is what the claim
needs.

## Committed records

`data/southern-remainder-20260812/`:

| file | what it pins |
| --- | --- |
| `derivation.json` | the 176-cell subset derivation and its digest reconciliation, re-derived byte for byte by a never-skipped test |
| `wave-census.json` | the full 9,603-building stop-code census and the shipped-subset census |
| `payload-inventory.json` | every emitted file's size and SHA-256, the occupancy derivation, the texture-catalogue pin, the predecessor pins |
| `blender-sample.json` | the 56-asset re-import, its inventory cross-check, and 56 render checksums |
| `journey-evidence.json` | four browser journeys with URLs, DOM text, per-release network readings and checksummed stills |

The payload tree `public/data/manhattan-southern-remainder-cells-20260812/` and
the work root `artifacts/southern-remainder-20260812/` are untracked, following
the citywide precedent.

## Verification gaps, stated

- **Not measured here:** frame time, heap, GPU texture accounting, cache
  residency. Those are promotion's instrument — they measure a promoted
  composition under the default activation — and this release is not promoted.
  ADR 0035 precondition (c) carries them to T018 unchanged.
- **The kill switch was not re-run.** It is inherited on a byte-identical tile
  catalogue and ADR 0035 Decision 2 states the inheritance rather than implying a
  fresh measurement.
- **`verifyPromotedExteriorPin` does not run for this release.** It reads the
  promotion record, and this release has no entry there. Verification rests on
  the release graph and the committed inventory, which is a narrower guarantee.
- **Two stills are byte-identical.** `canary-opt-in.png` and
  `tombstone-truth.png` share checksum `2759c9d1…`: same pose, same content. The
  tombstone claim is carried by the DOM notice, not the image. Both are kept
  rather than deduplicated so a reader can see which is evidence and which is
  corroboration.
- **A stale preview server was measured once, and that reading was discarded.**
  The first journey run reached a `vite preview` left on port 4174 by another
  worktree, serving a bundle without this release pinned;
  `promoted-default-unchanged` "passed" against it, meaninglessly. Every reading
  in `journey-evidence.json` is from a re-run against a preview this task started
  on port 4187 and verified by bundle hash. Check the served bundle before
  believing a journey.
- **The renderable subset is one cell.** It exercises no cell-boundary behaviour;
  two promoted multi-cell waves and the T015 two-cell canary do. ADR 0035
  Decision 3 records why any two-cell subset of this wave costs 153 entries.
