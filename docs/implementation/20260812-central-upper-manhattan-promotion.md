# T020 — Promoting wave `w04` as the fifth default exterior record

- Task: T020 (Issue #21)
- Decision record: ADR 0036, section "Promotion of wave `w04` (T020, Issue #21)"
- Promoted release: `manhattan-central-upper-manhattan-cells-20260812-p1`
- Predecessor pinned: the T019 canary `manhattan-central-upper-manhattan-cells-20260812`, unedited

## What shipped

| | |
| --- | --- |
| Curated cells | 490 and 491 of wave `w04` |
| Owned / materialized / refused | 41 / 40 / 1 (`doitt:996078`, ring over 64 vertices) |
| Cache entries taken | 40 of a decided 42-entry share |
| Promoted composition | 474 of 512 entries, 117.79 MiB of 256 MiB |
| Reserved for wave `w05` | 36 entries, binding on T022 |
| Tombstoned cells | 247 of 249 |

## Files by stage

**Curation and successor identity**

- `src/release/central-upper-manhattan-curation.ts` — the curated list, the
  lexicographic rule, the split arithmetic, the refusal-rate gate and the
  volume-identity margin gate.
- `src/release/central-upper-manhattan-p1-release.ts` — successor identity,
  predecessor pins derived from the canary's committed inventory, the rights
  instrument carried by reference.
- `src/release/central-upper-manhattan-curation.test.ts`,
  `central-upper-manhattan-curation-optimum.test.ts`,
  `central-upper-manhattan-fingerprint.test.ts`.

**Pipeline**

- `scripts/central-upper-manhattan-cli.mjs` — the `p1` variant, the skyline
  census over all 249 cells, the volume-margin measurement in `gates`, the
  fail-closed `graph` edges for the refusal census and the margin, and the
  committed `skyline-census.json`.

**Committed records** (`data/central-upper-manhattan-20260812-p1/`)

- `payload-inventory.json`, `derivation.json`, `wave-census.json`,
  `skyline-census.json`, `acceptance-evidence.json`, `journey-evidence.json`,
  `blender-sample.json`.

**Promotion record**

- `src/runtime/exterior-default-activation.ts` — the fifth record, its base-only
  predecessor and the 40 accepted identities; `exteriorDefaultActivations` gains
  a fifth parameter.
- `src/runtime/exterior-central-upper-manhattan-promotion-record.test.ts` — the
  never-skipped drift gate.
- `src/runtime/exterior-cache-ceiling.test.ts` — the fifth wave's byte profile
  and the five-wave arithmetic.
- `src/runtime/exterior-multiwave-activation.test.ts` — five-wave resolution and
  the `w04` rollback rehearsal.
- `src/app/App.tsx`, `src/app/App.test.tsx` — the pin list.

**Measurement and journeys**

- `scripts/central-upper-manhattan-acceptance-cli.mjs`
- `scripts/central-upper-manhattan-journeys-p1-cli.mjs`
- `scripts/central-upper-manhattan-blender-record-cli.mjs` and
  `scripts/blender/central_upper_manhattan_sample.py` — both variant-selected
  rather than forked, so the canary's committed record still means what it meant.

## The decisions worth re-reading

1. **The split is response 2, proportional to buildings: 42 here, 36 reserved.**
   Response 1 and response 3 were both available and neither was taken; the cache
   cap did not move. ADR 0034's response 3 — count resolved entries rather than
   files on disk — was considered and REJECTED because both Block 835 LODs can be
   session-resident, so a resolved count would understate real occupancy.
2. **The enumeration ranges over the whole wave**, not a band, and the
   connectivity-ignoring optimum is computed exactly rather than searched.
   Contiguity's price is four skyline buildings and is recorded.
3. **The 90 m threshold does not determine the answer** — the same cell wins at
   60, 75, 90, 100 and 120 m — which is a better answer to ADR 0036 (b) than
   defending the constant.
4. **The subset's volume margin is 0.365 of tolerance**, against the wave's
   0.988, and the same worst-margin building was independently confirmed in
   Blender at 3.2744e-07.
5. **The local refusal rate is HIGHER than the wave's** — 2.44% against 1.52% —
   and the record says so rather than reporting only that it passed its ceiling.

## Evidence

- Acceptance: capped control 8.30 ms; four stations at 2.00–3.30 ms p50 and
  5.50–8.00 ms p95 against 16.7/25 and 33.3/45 budgets; worst single frames
  51–53 ms at the facade station, stated; residency 460 entries / 117.72 MiB;
  GPU 9.98 MiB COMPUTED; zero external hosts.
- Journeys: five, all passed, bundle identified before capture, stills differ
  between the promoted default and `exteriorStreaming=off` at the same pose.
- Blender: all 40 shipped assets re-imported; triangle delta 0, material
  mismatches 0, bounds deviation 0.0 m against a 6.888 m Z-up control, non-solid
  0, 120 embedded images with 0 unreachable and a minimum of one UV layer.

## Incident during the Blender pass

The first attempt drove the pass from a worker thread inside Blender, which is
not a supported way to call `bpy`. Blender terminated and the MCP connection
dropped. It was relaunched, the MCP server came back, and the pass was re-run
SYNCHRONOUSLY and completed. No shipped byte was affected — the pass only ever
opens emitted GLBs read-only — and the committed `blender-sample.json` is from
the successful synchronous run. Recorded because a crash that leaves no trace in
the record is indistinguishable from one that never happened.

## Known limitations carried forward

- The wave-scale volume margin of 0.988 is still unexplained, and no independent
  check covers all 11,543 materialized buildings.
- The two waves' textured patches do NOT touch; they abut across a tombstoned
  Midtown-core ownership cell.
- Fault isolation is not exercised in a browser; the injector is behind a probe
  build.
