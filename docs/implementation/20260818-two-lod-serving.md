# Two-LOD serving — T001 implementation record

Date: 2026-08-18
Task: T001
Branch: `fcp/101-lod1-serving`
Decision record: ADR 0057

This is the honest history, including the parts that went wrong. T001 took four
sessions and three of them ended in context exhaustion; the promotion was landed
by the control plane rather than by the task, and two defects were found *at*
landing rather than before it. A record that showed only the final green would
misrepresent how this arrived.

## What shipped

Every `-s2` serving release now offers both levels, and the runtime resolves the
**finest level that covers** the camera distance per cell, with a 400 m ring
between them. Six `-s2` records are the default; the promotion is one revertable
unit.

## The exploration-profile contradiction, and the STOP

The task began by treating the render profiles as the place the level is chosen.
That contradicted itself immediately: `exploration` and `inspection` are quality
profiles, and a level-of-detail ring is a *distance* rule, so wiring the ring
into the profile would have made the same camera distance resolve differently
depending on a setting that is not about distance.

Work **stopped** rather than picking one reading. The ruling was that the ring is
a property of the distance and the profile is a property of the request, and they
do not compose — which is why `exterior-render-profiles.ts` carries the ring and
the profiles do not.

## The untextured-`lod_1` discovery, routed away

While measuring what the coarse level would look like at the ring, the level was
found to be **untextured** across the retained island — not a T001 defect and not
a T001 fix. It was routed to **T009**, which took it as its own goal and
eventually measured that the visible mid-ring defect is a *tone* discontinuity
rather than missing tile detail. T001 did not wait on that and did not assume its
outcome.

## The budget inversion: the mid ring is a byte SAVING

The plan assumed two-LOD serving would need a cap raise. Re-derived from the
committed extents census, it does not: at the mid ring the coarse level is
**smaller** than the fine one it replaces, so a session that resolves coarse
holds *fewer* bytes than the same session did before. **No cap was raised.** ADR
0057 Part 3 carries the arithmetic and names the constraint that actually binds.

That inversion is the reason the promotion is as small as it is. A task that had
kept the assumption would have shipped a cap change nothing needed.

## Three context-exhausted handbacks

Three sessions ended at a boundary with work incomplete and handed back rather
than rushing a landing. Each left the tree clean and the next step named. It cost
elapsed time and it is the reason the history is worth writing down: the
alternative — a session forcing a promotion it could not finish verifying — is
the failure this avoided.

## The control plane landed the promotion, and found two defects doing it

**The rollback-shape defect.** The promotion record's rollback target restored the
predecessor but did not *refuse* the promoted release, so a promotion-era deep
link would have kept resolving the withdrawn bytes ungated. Found at landing,
fixed before it, and rehearsed in both directions at `c2a07ce`.

**The file-corruption incident.** A record file was truncated mid-write during the
landing sequence. It was detected by reading the file back rather than by
trusting the write, restored from the committed version, and the write path was
re-run. Nothing shipped from the corrupted state. The lesson generalised into how
this session handled its own re-capture (below).

## The Map-serialization defect, and its supersession

The six registered poses were captured against the promoted composition. Every
universal gate passed. But **every pose reported zero resident cells and zero
per-cell distances**, so P2 — the 400 m straddle, the one pose whose gate is a
browser-only proof — could not be proven, and D-11 had no reading at all.

The cause was the probe payload, not the scheduler: `residentUnitIds` and
`distanceMetersByUnitId` were never put into it, and `distanceMetersByUnitId` is
a `Map`, which `JSON.stringify` renders as `{}` even when present. The scheduler
had been resolving cells the whole time, as the request-level LOD readings in the
same captures show.

The fix is in the probe payload only — behind `EXTERIOR_SCHEDULER_PROBE_ENABLED`,
which compiles out unless `VITE_EXTERIOR_SCHEDULER_PROBE` is set. The decision
object is untouched and no runtime behaviour depends on it.

P2 and P3 were re-taken under the **instrument-defect re-run** convention — the
one permitted re-run class — single attempt, with the four unaffected poses left
alone. **The defective zero reading stays on the record**, superseded with its
reason, and the drift test pins both readings so neither can be quietly dropped.

**A second defect surfaced during that re-run.** The capture CLI writes its record
from the poses it captured, so a *filtered* re-run clobbered the four poses it did
not take. It was caught by reading the file back — the habit the corruption
incident taught — and the four were restored from the committed version with the
two re-captures merged in. It is recorded rather than tidied away, because a
harness that destroys evidence when used correctly is worth knowing about.

## What the capture established, and what it did not

- **Universal gates pass at all six poses.**
- **The P2 straddle is proven**: 6 cells at or below 400 m, 2 above, all named.
- **Crossing is a reload — at building granularity.** 15 buildings were fetched
  coarse at P3 having been fetched fine at P2. **No cell** was observed changing
  ring side, and that claim is not made.
- **D-11 is within its allowance**: at most 3 cells holding both levels against
  an allowance of 4.
- **P1 is WEAK** — few resident cells at 180 m. Left as captured rather than
  re-posed until it looked better.
- **Nothing here is an appearance claim.** Every live reading is a request or a
  counter. No pose says a building *looks* coarse, and none can.

## Where things are

- Decision record: `docs/decisions/0057-two-lod-serving-and-the-mid-distance-ring.md`
- Capture evidence: `data/exterior-two-lod-serving-20260818/pose-captures.json`
- Capture harness: `scripts/exterior-two-lod-capture-cli.mjs`
- Drift test: `scripts/exterior-two-lod-serving-evidence.test.mjs`
- Revert rehearsal: commit `c2a07ce`
