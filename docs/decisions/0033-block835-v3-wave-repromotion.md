# ADR 0033 — Repromote Block 835 onto the V3 grammar, untextured

Date: 2026-08-11 · Task T026 (Issue #44) · Supersedes nothing; extends
[ADR 0028](0028-block835-exterior-default-activation.md),
[ADR 0030](0030-multi-wave-exterior-default-activation.md),
[ADR 0031](0031-v3-footprint-faithful-facade-grammar.md).

## Status

Accepted for the Block 835 wave only. Midtown-core is untouched by this decision
and stays on its V2 promotion.

## Context

ADR 0031 built the V3 footprint-faithful grammar and froze it as the private
package `manhattan-esb-block-reference-20260811-v3`. ADR 0032 added procedural
facade textures as a separate package, `-v3t`, behind a rasterizer-replay gate.
Block 835's public default was still the V2 release
`manhattan-exterior-cells-20260811`, whose massing is an oriented bounding
rectangle per building.

## Decision A — promote V3, and promote it UNTEXTURED

The public successor `manhattan-exterior-cells-20260811-v3` promotes the
untextured V3 package. The textured `-v3t` package is deliberately not promoted
in the same step.

The argument is single-variable attribution. This promotion already changes the
thing most likely to break a frame-time budget: block LOD-0 triangles rise from
roughly 24,000 to **139,476**, about 5.8x, with the Empire State Building alone
at 102,988. Admitting textures in the same step would additionally change GPU
memory, sampler count, decode cost and the public texture-admission rules. If
the combined change had regressed frame time, memory or visual acceptance,
nothing in the evidence would say which half caused it — and the honest response
to an unattributable regression is to roll back both, discarding a good change
with a bad one. Promoting one variable at a time keeps every measurement
attributable and keeps each rollback proportionate.

The public assemblies are therefore texture-free, every `buildingDetail` carries
`runtimeTexture: false`, and the release approval explicitly excludes runtime
textures of any kind.

## Decision B — admit an absent `setbacks` component into a promoted release

**This is a platform-wide contract change and is flagged as such.**

`isExteriorComponentReleaseEligible` refused to promote any building whose
inventory declared a component `absent`. V3 collides with that rule on five of
the fourteen real footprints: the inward tier offset self-intersects, V3 refuses
the offset rather than repairing it, and the plan then declares `setbacks`
absent with the refusal reason attached.

`CONDITIONALLY_APPLICABLE_EXTERIOR_COMPONENT_KINDS = ["setbacks"]` now admits
that one kind, and only when the component carries a non-empty `reason`.

This is a refinement, not a weakening. The original rule prevented promoting an
incomplete representation **silently**. The refined rule keeps refusing every
other absent kind — a missing massing, roof form or material treatment is still a
hole and is still refused — and additionally requires the machine-readable reason
that makes the absence explicit and carries it into per-building provenance.
The admission is a contract constant, so no release can widen its own gate;
adding a kind is a reviewable contract edit.

Two alternatives were rejected:

- **Transform at the release layer** (ship `not-applicable`/`grammar` in the
  release inventory while the plan keeps `absent`). Feasible — the runtime never
  re-hashes the shipped inventory shard — but it would state one fact two
  different ways in two committed artifacts.
- **Change the grammar** to emit `not-applicable`/`grammar`. Rejected: it moves
  all fourteen V3 plan hashes and breaks the byte-frozen `-v3` package, its drift
  tests, the Blender volume-identity bindings and the V3T lineage.

Scope note on the earlier "generative completion, no absent" direction: that
addressed wholesale ungenerated component kinds. These five are buildings whose
generated massing geometrically **cannot** carry a setback, which is a different
claim and one already visible and approved in the T025 package.

## Decision C — a promotion record may roll back to an ENABLED predecessor

`ExteriorDefaultActivationEnabled.predecessor` was typed
`ExteriorDefaultActivationDisabled`, so the only representable rollback was "off,
back to base massing". That was right for a first promotion and wrong for a
second one: Block 835's previous verified representation is the V2 release, and
rolling back to base would discard verified geometry nobody withdrew.

`predecessor` is now `ExteriorDefaultActivationRecord`, and
`rolledBackReleaseId` is readable on the enabled shape as well. The shipped
rollback target is `BLOCK835_V2_EXTERIOR_ROLLBACK` — the retained V2 record in
every operative field, plus `rolledBackReleaseId: "…-20260811-v3"`.

`rolledBackReleaseId` semantics for an enabled-predecessor rollback: exporting
the predecessor makes V2 the active default **and** makes
`exteriorRolledBackReleaseNotice` refuse
`?exteriorCells=manhattan-exterior-cells-20260811-v3`, so the withdrawal is still
a single record swap. Without it, the successor would stop being the default
while every promotion-era bookmark kept rendering the withdrawn wave, ungated.

Per-record indivisibility is preserved: the predecessor is still one whole record
carrying its own release, pin and membership together. The field is optional and
absent means "withdrew nothing", which is what kept every existing promotion
record and existing test literally unchanged. A record may never name its own
`releaseId` as withdrawn; that is pinned by test.

## Decision D — cited style override: shape decided, not yet applied

The grammar can now accept `V3Input.styleOverride { styleClass,
evidenceRecordId, fact }`. `selectV3StyleClass` is untouched and still runs for
every building without a cited override.

Constraints, all test-pinned:

- The override lives **inside** `V3Input`, so the plan hash covers it. An
  override that could change shipped appearance without moving the plan hash
  would be an unrecorded change.
- It is **uncited-impossible**: a non-empty `evidenceRecordId` is required.
- It selects a style class and **nothing else**. Materials are the only thing a
  style class feeds; tiers, surfaces, placements, prisms and the inventory are
  derived without reading it, so tessellated triangle counts are provably
  identical with and without an override — which is why an override cannot
  invalidate a measured frame-time gate.
- The key is **omitted** when absent, never set to `undefined`, because
  `stableSerialize` writes a present undefined key as `null` and that would move
  all fourteen V3 plan hashes.
- It never authorises a texture. The intended intake record for the Empire State
  Building facade fact carries `derivativeScope: measurement-only` and the
  restriction code `derivative-scope-excludes-texture`, and that restriction is
  **correct and must remain**: the fact may drive the style class, never a
  texture.

### The ESB limestone override, as applied

The one override this build ships maps `doitt:778052` to `stone-neutral`, cited
from intake record `intake:wikipedia:doitt-778052:facade-material`. Before it,
the Empire State Building drew `curtain-cool` — a glass curtain wall.

The admitted evidence is encyclopaedia article **TEXT** about documented
exterior materials, classification `compatible-licensed`, provider `wikipedia`,
`derivativeScope: "measurement-only"`, `privacyReview: "reviewed-no-identifiers"`.
The evaluator therefore raises `derivative-scope-excludes-texture` and
`runtime-texture-not-permitted`, and the record is admitted `publicEligible: true`,
`runtimeTextureEligible: false`. **Those restrictions are correct and are pinned
by test**: the fact may drive a designed style class and may never become a
texture. No imagery was ingested, traced, sampled or reproduced.

**The projection is deliberately not spliced into the release evidence graph.**
`validateExteriorInventoryEvidence` closes its graph: every evidence node must be
referenced by a component that is `evidence-backed`, or `not-applicable` with an
evidence basis. V3's components are `generated` (or `absent` for a refused
setback), and that is the honest description — a sourced material fact does not
make a generated bay rhythm evidence-backed. Splicing a claim node in would have
forced either relabelling generated components as evidence-backed, or leaving the
orphan node the closure rule exists to forbid. So the citation travels where it
is true: in the PLAN, whose hash covers it, and from there into per-asset
provenance and the details panel. The release's evidence graph keeps stating what
it always stated — the rights basis for the geometry is the NYC footprint
dataset.

### Uncertainty: a sibling constant, not an edit

`DETERMINISTIC_FACADE_V3_UNCERTAINTY` says colour and material are "derived from
no imagery and no observation". Inside a plan carrying a cited override that
sentence is false. `DETERMINISTIC_FACADE_V3_CITED_STYLE_UNCERTAINTY` states the
narrower truth, and `validateV3Plan` accepts **exactly** the two constants, keyed
on the presence of `styleOverride` in the plan's own embedded input — a cited
plan wearing the uncited wording, and an uncited plan wearing the cited wording,
are both refused. The V3 constant is not edited, so the fourteen committed V3
plans keep their bytes.

Component-level uncertainty follows the same precision: only the `materials`
component of the cited plan carries the cited statement. A facade-material fact
says nothing about that building's bay rhythm, roof form or water tanks, so those
components keep the standard statement rather than inheriting a citation they are
not covered by.

### Package mechanics

`-v3` is merged and frozen, so the cited plan needs a successor:
`manhattan-esb-block-reference-20260811-v3e`, with per-asset predecessor pins to
`-v3`. All fourteen assets get new bytes, because package identity (`inventoryId`,
`evidenceShardId`) is embedded in every asset's GLB metadata — but **thirteen
plan hashes are byte-identical to `-v3`** and only `doitt:778052` moves
(`cc65ce6e…` to `861811019f…`). That is the integrity claim that matters and it
is asserted rather than described.

The public release directory `manhattan-exterior-cells-20260811-v3` is **rebuilt
in place** rather than stacked behind a second successor. It is unmerged on this
branch and therefore not yet immutable; nothing is frozen until it merges. The
release id is kept because the pins update coherently — snapshot checksum,
cell-release checksum and `assemblyPackageIds` all move together in one record
swap — and a second successor release id would have implied a supersession that
never publicly happened.

## Consequences

- Block 835's default is `manhattan-exterior-cells-20260811-v3`; Midtown-core is
  byte-for-byte unaffected.
- Membership is unchanged: the same fourteen identities, one cell. This
  promotion carries **no availability drift**.
- The V2 release stays on disk, immutable, pinned, and reachable by explicit
  opt-in until it is withdrawn.
- `V3_QUALITY_BUDGETS`' triangle raise to 200,000 is now backed by a measured
  frame-time gate at the higher count rather than by an intention (ADR 0031 made
  that raise conditional on exactly this measurement).

## Measured evidence

Production build, dedicated desktop Chrome 151 with CDP and `--expose-gc`,
`vite preview` on `localhost:4310`, viewport 1728x913 CSS px at
devicePixelRatio 2, ~135 Hz display, 1 s settle, 8 poses x 60 samples x 4
repeats = 1,920 accepted samples per profile, `documentHasFocus` true before and
after both runs, 0 console errors, `localhost:4310` the only host contacted.

| Profile | Median | p95 | Budget | Verdict |
| --- | ---: | ---: | --- | --- |
| exploration | **8.30 ms** | **9.30 ms** | 16.7 / 25 | pass |
| inspection | **8.30 ms** | **9.30 ms** | 33.3 / 45 | pass |

Those numbers were measured on the pre-override assembly and **remain valid for
the shipped bytes**, which is asserted rather than assumed: a test compares
per-LOD triangle, material and texture counts for all fourteen assets against the
`-v3` manifest and requires equality, and Blender independently re-measured the
same volumes and the same silhouette ratios under the new plan hash. The override
changed material factors only.

`droppedFrameRatio` 0 on a ~135 Hz display, so the margin is real headroom rather
than refresh quantization. Peak concurrent requests 4 (limit 8); peak exterior
cache 1,910,044 bytes (limit 256 MiB); 14 cache entries, 0 evictions — direct
evidence that all fourteen V3 assets loaded rather than degrading to base
massing. JS heap with **forced collection** shrank across repeats
(-13.3 % exploration, -12.0 % inspection), which also closes the T009 row-18
memory item that the earlier collection-free method could not certify.

The 5.8x triangle rise cost no measurable frame time: the V2 median on comparable
hardware was also 8.3 ms.

## What this decision does not claim

It does not claim textured public admission is safe — that is deliberately
unmeasured here. It does not claim 1440p-class, mobile, keyboard-traversal or
reduced-motion behaviour. It does not claim the designed V3 appearance resembles
any real building; the shipped uncertainty statements say the opposite. For the
Empire State Building it claims only this: a documented material list selected
which of four designed style classes is drawn. The tones, coursing and geometry
expressing that class are still designed, and nothing here claims the shipped
surface reproduces the real facade.
