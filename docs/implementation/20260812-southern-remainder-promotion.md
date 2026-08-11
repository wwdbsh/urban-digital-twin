# Southern-remainder curated promotion (T018)

Durable implementation record for
`manhattan-southern-remainder-cells-20260812-p1`, the release wave `w03` is
PROMOTED as, and the fourth record in `EXTERIOR_DEFAULT_ACTIVATIONS`. See ADR
0035's promotion section for the decisions and ADR 0034's discharge section for
the cache-ceiling response; this file is what was built, what it measured, and
how to reproduce it.

## The runtime contract changed, and that is the headline

`EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries` went from **256 to 512**.
`maxCachedBytes` did not move. This is ADR 0034 admissible response 1, executed
and recorded by number in both ADRs, and it is what makes a fourth promoted wave
representable at all: three promoted waves occupied 255 of the old 256 entries.

It is a separate commit from the promotion, because a runtime contract change and
a release emission are different kinds of risk and should be reviewable
separately.

### The byte ceiling, re-derived at the raised cap

`src/runtime/exterior-cache-ceiling.ts` computes it; its suite recomputes it on
every run from committed records only — three `payload-inventory.json` files
under `data/` and, for Block 835 V3, its committed payload tree. No untracked
payload directory is involved, so the arithmetic is checked on a fresh clone.

| release | entries | total | mean | median | max |
| --- | --- | --- | --- | --- | --- |
| `manhattan-exterior-cells-20260811-v3` | 28 | 7,037,116 B | 251,326 B | 50,896 B | 3,716,836 B |
| `manhattan-midtown-core-cells-20260811-v3` | 156 | 20,884,440 B | 133,875 B | 43,812 B | 1,882,048 B |
| `manhattan-lower-manhattan-cells-20260812-p1` | 71 | 41,189,232 B | 580,130 B | 157,888 B | 4,269,904 B |
| `manhattan-southern-remainder-cells-20260812-p1` | 179 | 40,027,708 B | 223,618 B | — | — |

Reachable composition bound: **109,138,496 B = 104.08 MiB, 41% of an unchanged
256 MiB cap**, at **434 of 512 entries**. Bytes are non-binding; entries remain
the binding constraint. The modelled 512-entry mean fill is 283.27 MiB, ABOVE the
byte cap, which is exactly why the byte cap was not raised alongside.

### Which test pins moved

Three, each annotated where it moved:

| suite | pin | before | after | why |
| --- | --- | --- | --- | --- |
| `exterior-cell-runtime.test.ts` | live runtime metric | 256 | 512 | the constant moved |
| `exterior-fullsnapshot-plan.test.ts` | ADR 0024 D4 saturation | `>0.9` of cap | 240 entries, `>0.9` of the OLD 256, `0.469` of the new cap | the fallback path's COST did not change; its headroom did |
| `southern-remainder-release.test.ts` | canary inventory occupancy | `EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries` | literal `256`, plus a separate assertion that the live constant is 512 | that inventory is FROZEN BYTES and its checksum is the successor's predecessor pin; comparing it against a moving constant would have forced the re-emission the freeze exists to prevent |

`exterior-lower-manhattan-promotion-record.test.ts` did **not** move: it already
read its own frozen inventory rather than the constant, which is the pattern the
third row above was corrected into.

## What shipped

| fact | value |
| --- | --- |
| release id | `manhattan-southern-remainder-cells-20260812-p1` |
| wave | `w03` / `southern-remainder`, ledger `manhattan-exterior-wave-ledger-20260804` |
| ownership ledger | the wave's own, unchanged from the canary's |
| owned | 176 cells, 9,603 canonical buildings |
| renderable | 4 **curated** cells, 180 owned buildings, **179** materialized assets |
| tombstoned | 172 cells |
| local refusal rate | 1 of 180 = **0.556%** (wave rate 1.00%; canary's own cell 1.30%) |
| textures | `procedural-texture-v1`, LOD 0 only, `LINEAR` / `LINEAR_MIPMAP_LINEAR` |
| admission | `procedural-replay` on both emitted roots |
| rights instrument | `SOUTHERN_REMAINDER_APPROVAL`, the CANARY's, carried **unedited** — same id, scope, exclusions, note, fingerprint. The carry-over is disclosed in the committed `payload-inventory.json` note, not only in source comments. It rests on no fresh signature. |
| predecessor | `manhattan-southern-remainder-cells-20260812` (the T017 canary; root + snapshot + inventory pins) |
| snapshot checksum | `9d6a1d3d7931c648406e1c7461d791894365f79ba5ce2f5a5efae9783707a025` |
| cells digest | `8220025ddaf4b1f888d5eb90d2d08fc63fdde6c5e2f1d3e5c572b7b068726102` |
| assembly package | `assembly:manhattan-southern-remainder-cells-20260812-p1:v1` |
| payload | 59,194,705 B across 719 files, of which 179 are textured LOD 0 GLBs |
| promoted | **yes** — fourth record, `predecessor` is base-only |

## The curated subset

| cell | full-city order | owned | materialized | refused | skyline (>= 90 m) | tallest |
| --- | --- | --- | --- | --- | --- | --- |
| `manhattan-exterior-cell-w03-000379-17-38597-35864` | 379 | 29 | 29 | 0 | 6 | 190.0 m |
| `manhattan-exterior-cell-w03-000385-17-38596-35865` | 385 | 65 | 65 | 0 | 4 | 137.2 m |
| `manhattan-exterior-cell-w03-000386-17-38597-35865` | 386 | 50 | 49 | 1 | 2 | 155.8 m |
| `manhattan-exterior-cell-w03-000387-17-38598-35865` | 387 | 36 | 36 | 0 | 4 | **245.4 m** |

Four edge-connected cells through the hub at 386, in the high-rise band
immediately south of the Midtown-core wave boundary. Cell 387 owns the tallest
sourced structure in the whole of wave `w03` at 245.4 m and the second at
202.1 m. Cell 379's north bound `40.748291015625` is shared exactly with promoted
Midtown-core cell `manhattan-exterior-cell-w01-000030-16-19298-17931`, so the
promoted waves meet on the ground rather than as separate patches. The one
refusal is `doitt:938827`, `source-height-below-grammar-minimum`, shipped as an
explicit unavailable detail and deliberately outside the accepted membership.

Selected on **skyline value** — owned buildings whose sourced height reaches
90 m — over 154 admissible combinations inside a stated envelope. Four
combinations tie at the maximum score of 16 and exactly one is edge-connected,
which is the tie-break. `southern-remainder-curation-optimum.test.ts` re-runs the
enumeration on every run, over the committed ledger and the committed
`skyline-census.json` this pipeline now emits.

Heights quoted anywhere here are the SOURCED `heightMeters` of the pinned
`manhattan-citywide-20260804` base. The NYC OTI footprint dataset carries no
building names, so no cell rationale identifies a building by name and none is
implied.

## Acceptance measurement

Off the vsync floor, at the raised cap, against a bundle identified before the
first capture (served `index.html` byte-identical to this tree's `dist/`, entry
script `/assets/index-BLRu1W7M.js` naming this release). Capped-control p50
**8.30 ms** in a second Chrome without the uncapping flags.

| station | profile | p50 / budget | p95 / budget | worst frame | heap after GC (median) |
| --- | --- | --- | --- | --- | --- |
| `nomad-facade` | inspection | 2.60 / 33.3 ms | 8.00 / 45 ms | 31.4 ms | 330.5 MiB |
| `nomad-skyline` | exploration | 2.30 / 16.7 ms | 6.60 / 25 ms | **140.0 ms** | 255.0 MiB |
| `crosswave-wide` | exploration | 1.60 / 16.7 ms | 4.80 / 25 ms | 14.9 ms | 185.6 MiB |
| `fidi-facade` | inspection | 3.80 / 33.3 ms | 7.90 / 45 ms | **70.3 ms** | 233.0 MiB |

Every p50 and p95 inside both budgets. `fidi-facade` is the T016 station kept
pose-for-pose unchanged for continuity. The two isolated slow frames are stated
rather than smoothed: single frames in 240-frame windows whose p95 is under 8 ms,
so upload and first-decode spikes, but real frames a user could see.

- **Cache residency, worst observed: 420 entries / 100.45 MiB** against 512 and
  256 MiB. Derived per release from the network measurement, because the in-app
  cache counter only reaches the DOM in a `VITE_BLOCK835_PROBE` build.
- **GPU texture memory: 44.55 MiB, COMPUTED AND NOT MEASURED** —
  `128 * 128 * 4 * 1.33 * 536`, not deduplicated across models. This release's
  share alone; Lower-Manhattan P1 is also textured and computes its own.
- **Zero external hosts** in any capture.

## Journeys

Five, all passed, bundle-verified.

| journey | what it proved |
| --- | --- |
| `cold-default` | all four waves stream; 179 curated assets fetched; **zero** canary bytes |
| `cross-wave-pick` | `doitt:1290754` names release, cell, cell release, 64-hex asset checksum, truth tier `generated`, source dates, uncertainty |
| `canary-opt-in` | the T017 canary's link resolves to the canary ALONE — 76 GLBs, zero from any promoted wave — from a pose derived from that cell's committed bounds |
| `streaming-off` | all four waves off, no exterior GLB, and the still **DIFFERS** from `cold-default`'s at the identical pose (`6c5360e5…` vs `a0a0bc3f…`), which is what proves the tiles are drawn rather than downloaded |
| `tombstone-truth` | "172 of 176 exterior cells ship no exterior geometry in this release; no substitute was selected for them." |

Rollback runs through the promotion record's injection seam in
`exterior-multiwave-activation.test.ts`, not in a browser, because no URL
expresses a build-time record swap. `streaming-off`'s `unavailableStatements` is
recorded as the empty array it actually returned — the same reading the T016
record carries; the journey's pass is computed from the wave and network readings
instead.

## Blender

86 of 179 curated assets re-imported, measured and rendered — the deterministic
stratified sample, every one textured, against a required minimum of 10. Blender
5.2.0 LTS / Python 3.13.13 / EEVEE Next.

| check | result |
| --- | --- |
| triangle delta | 0 |
| material mismatches | 0 |
| bounds deviation | 0.0 m (Z-up control hypothesis deviates 5.67 m) |
| worst volume deviation | 5.92e-7 |
| non-solid meshes | 0 |
| embedded images | 257, mismatches 0 |
| textures unreachable | **0**, minimum UV layers 1 |
| re-imported triangles | 408,428 |

Every measured checksum was cross-checked against this release's committed
payload inventory before being recorded; a mismatch fails the writer.

## The tileset ordering fix

`validateTileset` walks the assembly root's children in `canonicalFeatureId`
order; `buildMidtownCoreRelease` sorted them by content URI. Those agree only
while no building id is a strict prefix of another, because the URI appends
`__lod_0.glb` and `7` sorts before `_`. This 179-asset subset is the first set
where they diverge — `doitt:615` is a prefix of `doitt:61531` — and the assembly
replay REFUSED the emitted tileset rather than shipping an unwalkable chain. It
failed closed, which is why this is a fix and not an incident.

No frozen byte moves with it, and that is checked:
`exterior-tileset-ordering.test.ts` verifies every already-emitted release's
asset id set orders identically under either key.

## Files

| path | what |
| --- | --- |
| `src/runtime/exterior-cell-runtime.ts` | `maxCacheEntries` 256 → 512, with the response recorded |
| `src/runtime/exterior-cache-ceiling.ts` | the byte-ceiling re-derivation and the ADR 0030 eviction disclosure, in code |
| `src/release/southern-remainder-curation.ts` | the curated list, envelope, connectivity, budget and refusal gates |
| `src/release/southern-remainder-p1-release.ts` | successor identity, predecessor pins, carried rights instrument |
| `src/runtime/exterior-default-activation.ts` | the fourth promotion record |
| `src/release/midtown-core-release.ts` | the tileset child-ordering fix |
| `scripts/southern-remainder-cli.mjs` | the `p1` variant and the skyline census |
| `scripts/southern-remainder-acceptance-cli.mjs` | the four-wave measurement at the raised cap |
| `scripts/southern-remainder-journeys-p1-cli.mjs` | the five renderer journeys |
| `scripts/blender/southern_remainder_sample.py` | variant-selected work root and release id |
| `data/southern-remainder-20260812-p1/` | inventory, derivation, wave census, skyline census, acceptance, journeys, Blender |

## Reproducing it

```
node scripts/southern-remainder-cli.mjs all --release p1
pnpm build
npx vite preview --port <port> --strictPort
# Chrome A: --remote-debugging-port=<a> --disable-gpu-vsync --disable-frame-rate-limit
# Chrome B: --remote-debugging-port=<b>            (the capped control)
node scripts/southern-remainder-acceptance-cli.mjs --preview http://localhost:<port> --port <a> --capped-port <b> --repeats 3
node scripts/southern-remainder-journeys-p1-cli.mjs --preview http://localhost:<port> --port <a>
# In Blender, with UDT_W03_VARIANT=p1: exec scripts/blender/southern_remainder_sample.py
node scripts/southern-remainder-blender-record-cli.mjs --release p1
```

`graph --release p1 --force` rebuilds the committed inventory byte-identically.
The payload tree under `public/data/manhattan-southern-remainder-cells-20260812-p1/`
and the work root under `artifacts/southern-remainder-20260812-p1/` are both
intentionally untracked; `data/southern-remainder-20260812-p1/` is the committed
record that keeps every emitted byte checkable after they are removed.

## What this promotion leaves for w04 and w05

    512 - (255 + 179) = 78 entries

78 entries for two waves owning 249 and 182 cells, against a `w03` median cell of
50. That is roughly one and a half ordinary cells split between two waves. ADR
0035's next-wave preconditions state the arithmetic and the residual conditions;
the short version is that a fifth wave faces the same decision this one did, one
doubling later, and that raising the entry cap again would very plausibly make
BYTES binding for the first time.
