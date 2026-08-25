# Citywide public realm — integration acceptance record

Goal: `manhattan-citywide-public-realm` (Issue #129)
Task: T015 (Issue #144) · Branch `fcp/144-acceptance-campaign` · HEAD `6329585`
Date: 2026-08-26
Machine facts: [`evidence.json`](evidence.json), regenerable via
`node artifacts/ground-goal-acceptance-20260826/build-evidence.mjs`

**This record does not declare the goal complete.** It adjudicates the eight
acceptance criteria against evidence and hands the completion decision to the
user, as the goal's own `PENDING-DECISIONS.md` reserves.

| | count |
| --- | --- |
| MET | 1 |
| MET-WITH-QUALIFICATION | 6 |
| PARTIAL | 1 |
| NOT-MET | 0 |

**The single fact that shapes every verdict below**: the public realm has been
rendered in front of a person exactly once, on 2026-08-24, while the ground was
still an opt-in canary (T007, PR #150). The default flip, the curbs, the
orthoimagery and the seven named places have never been looked at. Six of the
eight criteria name visual or interaction evidence in their own text. Where that
evidence is absent it is marked absent, and no verdict below is upgraded by
assuming a render nobody watched.

---

## AC1 — the grid is no longer the ground

> "In the default citywide view, the synthetic GridImageryProvider grid is no
> longer the visible ground; a cartographic polygon ground (roadbed, sidewalk,
> park, plaza, water classes) renders across Manhattan, verified by validator
> plus real-interaction visual evidence"

**Verdict: MET-WITH-QUALIFICATION**

Evidence:

- `GROUND_DEFAULT_ON = true` (`src/app/App.tsx:726`). The grid layer is still
  constructed once per viewer (`src/features/explorer/CesiumViewport.tsx:2517`)
  but `syntheticGridVisible(groundBaseActive)` gates its `ImageryLayer.show` —
  demoted, not deleted, and still what a failed verification shows. PR #154.
- Validator half, fresh run 2026-08-26 (`pnpm citywide:validate`, exit 0):
  `manhattan-ground-20260824` **valid: true** — 140 cells, 42,778 features,
  47,779 parts, 352 artifacts, 182,027,517 artifact bytes, 13,154,558
  coordinates checked, max cell excursion 5.0e-8°, max relative area error
  2.48e-9.
  `release.json` sha256
  `209d72b18f90018b1a7e18a4a4861bcf95b178ee0b28f5db791f7f0df11beb04`;
  `ledger.json` `4f3af537f4bbb87d146bdfdd576d4c513fb5c2facd071faa60844fcfa85a9863`;
  `features.json` `597f7fe7ce1c0205e0093c8e322cc644f9d981f186c11beb545f381e3a736df0`.
  Ledger identity
  `ground-ledger:city-manhattan:ground-partition-v1-level14:35a834d29aafc8be7f4352c61d575f03`.
- Visual half, 2026-08-24 live browser session (PR #150): roadbed grid,
  sidewalk edging, park greens and Hudson water rendered; status readings
  "6 cells drawn · 2055 polygons" at street level and "24 cells drawn · 14738
  polygons" at region view with the cell cap binding; a park pick resolved to
  `groundFeature=udt:manhattan:park:M022`; an injected
  `groundFault=artifact-checksum` produced "0 cells drawn … 3 cell artifacts
  refused (verification failed)" with zero partial geometry.

**Qualification, stated plainly.** That session ran with `?ground=` set
explicitly, because the default flip had not happened yet. What was seen is the
same render path the default now takes — T008 changed *selection*, not drawing,
and no release byte changed — but **"in the default citywide view" is inferred
from that, not observed.** The post-flip checklist is unrun: it is P3 item 2 in
the goal's `PENDING-DECISIONS.md`, blocked on granting the browser extension
site permission for the dev origin.

---

## AC2 — near-tier 3D public realm at Block 835 parity

> "Near-tier 3D public realm (extruded curbs, estimated crosswalk striping)
> streams at Block 835 visual parity in at least the six promoted wave areas;
> entering/leaving the near tier preserves picking and deep links, verified by
> focused tests plus interaction evidence"

**Verdict: PARTIAL**

What is delivered — curbs, and they are real:

- `manhattan-ground-embellishment-20260825`, `release.json` sha256
  `daab076ec9bef4f033d6a22e77e0080f4ba92e9d46638e24511268d4b980ff92`.
- Fresh census (`pnpm ground-embellishment:census`, 7/7 pass, artifact
  byte-identical to the committed one):
  **87 cells · 86,189,948 bytes · 45,522 curb parts · 45,588 drawn walls ·
  5,277,922 triangles · 0 refused parts · 0 budget breaches**, across the five
  row-owning waves. Block 835's own ground lies in rows 4481–4482, which
  `midtown-core` promotes, so all six wave areas' ground is served; the sixth
  name is refused deliberately rather than allowed to contribute nothing.
- Block 835 record-level curb equivalence — geometry verbatim, 0.22 m profile,
  "estimated" label, derivation id — is asserted by fixture against the same
  code the CLI runs (PR #152). Two builds byte-identical.

Why this is PARTIAL and not MET — two independent reasons:

1. **Crosswalk striping does not exist outside Block 835.** The criterion names
   it. Independent architect review disproved the generalization plan: Block
   835's crosswalks are enumerated from the bbox corners of a hardcoded building
   union, and the repository registers no intersection or centerline dataset
   (the route-graph is a synthetic 6-node fixture), so any geometric inference
   would ship an "estimated" claim nothing could falsify. The reduction is
   recorded as P2 and **awaits the user's choice** between accepting it and
   authorizing a LION/DOT-crosswalk acquisition envelope.
2. **"Visual parity" has not been assessed, because nothing was viewed.**
   Picking and deep-link preservation across the tier boundary are covered by
   focused tests (65 in T011, plus the T010 canary suite), which is the
   criterion's first clause; its second clause, "interaction evidence," is
   absent. Two specific visual risks are named and unchecked: a ~1.85 km cell
   activating draws its whole extent's curbs at the 400 m ring boundary, and
   zero-width walls may be hard to see at shallow grazing angles.

Zero-headroom note (carried to the risk register): the worst-case ring holds
**exactly 4 cells against a ceiling of 4**, and the largest artifact is
**94.6%** of the per-artifact serving ceiling. Neither has room.

---

## AC3 — orthoimagery on parks, water and plazas, failing closed

> "Central Park, all NYC Parks properties in Manhattan, water bodies, and
> designated plazas/open spaces render orthoimagery textures with
> on-screen-accessible attribution and capture year; when imagery is absent or
> fails validation, the polygon base renders instead (fail-closed demonstrated
> by test)"

**Verdict: MET-WITH-QUALIFICATION**

- `manhattan-ground-zone-imagery-20260826`, `release.json` sha256
  `1084af6913c3d930bf0187a52fe98d850782107508a13ccb9e23721c0c83a544`;
  `zone-imagery.json`
  `f0edab3f06e5123d311ef834e1988be19a26b8b2582de65de5b4f4a5050b80ca`.
  `ZONE_IMAGERY_DEFAULT_ON = true` (`src/app/App.tsx:793`), PR #158.
- Fresh validator: **PASSED — 87 textures, 75 recorded refusals, 56.8 MiB**
  (19.9% of the citywide byte budget). Capture year 2024, target GSD 1.2 m/px.
- The **compatibility pin holds**: the imagery release mirrors the base's
  ownership ledger id verbatim, so regenerating the base breaks validation
  rather than draping 2024 pixels over geometry never registered against them.
  Machine-checked in `evidence.json` (`compatibilityPinHolds: true`).
- Fail-closed is demonstrated by test in three grades: a bad release document,
  a pin mismatch, or an index whose SHA-256 does not match removes the **entire**
  imagery layer; a single texture whose bytes do not match removes **that one
  drape**. In every grade parks, plazas and water still draw as verified flat
  polygons and the ground status line is untouched.
- Attribution and capture year are on screen unclicked, in the status region,
  whenever any drape is visible; per-zone selection adds capture window,
  resolution, the ~1 px registration disclosure and the release id.

**Qualifications.** (a) "All NYC Parks properties … water bodies … plazas"
overstates what ships: **75 zone-cells are refused**, on purpose, because the
source imagery covers them only partly and `MINIMUM_COVERED_FRACTION = 1.0`
refuses rather than part-synthesizes. Those zones draw as flat polygons — which
is the criterion's own fail-closed clause operating as designed, not a defect,
but the word "all" is not satisfied. Refusals concentrate at the coverage
margin: 41 of 76 water zones. (b) The drape itself has **never been rendered**;
Cesium's `textureCoordinates` plumbing cannot be exercised in jsdom, so the st
arithmetic is unit-tested and the pixels are unverified (P3 item). (c) ~1 px
NAD83 misregistration is disclosed, not corrected.

---

## AC4 — the named-place recognizability set

> "Named-place recognizability set passes: Times Square, Central Park, Bryant
> Park, Washington Square Park, Battery Park, and Hudson/East River each show
> correct boundary geometry, correct layer classes, and sourced details-panel
> provenance at their deep-linked camera poses"

**Verdict: MET-WITH-QUALIFICATION**

Fresh run of `pnpm named-places:evidence` (artifact byte-identical to the
committed one). All seven resolve, all seven have their geometry inside the
deep-linked pose's view footprint, all seven carry a source reference:

| place | class | canonical id | cells | textured | refused | identity |
| --- | --- | --- | --- | --- | --- | --- |
| Central Park | park | `udt:manhattan:park:M010` | 7 | 7 | 0 | referenced-existing |
| Bryant Park | park | `udt:manhattan:park:M008` | 2 | 2 | 0 | referenced-existing |
| Washington Square Park | park | `udt:manhattan:park:M098` | 1 | 1 | 0 | referenced-existing |
| The Battery | park | `udt:manhattan:park:M005` | 2 | 1 | 1 | referenced-existing |
| Times Square | plaza | `udt:ground:manhattan:plaza:24aeb72178ec5bd0` | 2 | 2 | 0 | ground-owned |
| East River | water | `udt:ground:manhattan:water:d32d405d331afe68` | 8 | 3 | 5 | ground-owned |
| Hudson River | water | `udt:ground:manhattan:water:96c4c6af8c1fea9b` | 30 | 22 | 8 | ground-owned |

Provenance is sourced, not asserted: the four parks reference NYC Parks
`enfh-gkve` records by their real property ids (M010, M008, M098, M005) rather
than minting new identities. Per-place `classCensus` confirms the expected layer
classes are present in every owner cell. Zero cells are unaccounted for in any
place's imagery summary.

**Qualification.** The criterion's verb is **"show."** Every element above is
established structurally — by evidence artifact, by identity resolution, by
census — and **not one of the seven has been seen at its deep-linked pose.**
"Recognizability" is precisely the property that structural evidence cannot
establish. T014's own PR states this and makes no visual claim anywhere in the
shipped material. Two lesser gaps: East River is textured in only 3 of 8 owner
cells and The Battery in 1 of 2, so those places are partly flat-coloured even
when the imagery is working; and named-place search results are Tab-reachable
but outside the ↑/↓ traversal index.

---

## AC5 — validators and benchmark within recorded budgets

> "pnpm citywide:validate and pnpm citywide:benchmark pass within the budgets
> recorded by the manhattan-citywide-default-streaming goal, or a user-approved
> re-baseline is recorded with evidence"

**Verdict: MET-WITH-QUALIFICATION**

`pnpm citywide:validate` — **exit 0, all three phases**: citywide release valid
(452 declared files, 304,382,520 bytes, 45,194 buildings, 109,386 restaurants);
ground release valid (see AC1); zone imagery passed (see AC3).

`pnpm citywide:benchmark` — **exit 0**, every percentile inside its recorded
budget, none re-baselined:

| metric | measured | recorded budget | margin |
| --- | --- | --- | --- |
| cold search P95 | 14.92 ms | 16.96 ms | 12.0% |
| warm search P95 | 15.24 ms | 16.81 ms | 9.3% |
| cold pick P95 | 4.58 ms | 6.44 ms | 28.9% |
| warm pick P95 | 1.98 ms | 2.68 ms | 26.1% |

30 search samples, 30 pick samples, 451 bounded release shards. No re-baseline
was requested and none is recorded, which is the criterion's preferred branch.

**Qualification — the recorded gap.** This benchmark exercises **buildings and
restaurants only. It loads zero ground, curb or imagery bytes.** It therefore
proves the goal did not regress the building city's search and pick, and proves
nothing about the cost of the ground itself. What stands in for that is
ground-specific measurement, honestly narrower: a node-side base-release verify
of ~661 ms median (5 runs, 655–690), ~663 ms for the embellishment verify after
it, 2 ms for the imagery index gate, a Central Park mid-zoom visible set of 15
cells → 31 textured zones at 30 ms and 23.4 MB resident against a 48 MiB cap,
and street-level curb corner worst case of 4 cells / 4.65 MiB / 305k triangles /
12 ms. **Real-GPU frame time and GPU memory for the new tiers are unmeasured**,
on any machine. Every timing figure here is one machine, one session.

---

## AC6 — registration, licensing, and fail-closed approval evidence

> "Every new dataset (citywide Planimetrics clip, hydrography, plaza boundaries,
> orthoimagery) is registered in source-registry.ts with approval evidence,
> verified license text, attribution, capture dates, and immutable
> checksum-pinned snapshots; validators fail closed on missing evidence"

**Verdict: MET-WITH-QUALIFICATION**

- Six entries in `src/data/source-registry.ts`, all `approvedEntry` (none left
  pending): sidewalk `vfx9-tbb6`, roadbed `xgwd-7vhd`, pavement edge
  `x9uq-u3qs`, hydrography `pjs3-c3z5`, DOT pedestrian plazas `k5k6-6jex`, and
  `nyc.orthoimagery-2024-manhattan`. Each carries attribution naming the agency
  and dataset id, a capture timestamp and a source update timestamp.
- **The approval fingerprints hash the real approval text, not an id.** T002's
  draft (`754bde75…`, which hashed only the evidenceId) is orphaned — no entry
  cites it, and a test asserts that. The live envelopes are
  `b4977f62687c29d0d4dfc43fbbe2237f579da7622bc5725fd9d3df7511cfcff7` (vectors)
  and `f0bbb1c8bf279e4ce6bf02138ae6d0d9891425c70684e58b7a02a754bb239ffe`
  (ortho), each computed as `sha256HexSync` of the verbatim user approval
  statement stored in the same constant, and each proven reproducible from that
  statement by a colocated test.
- **The fail-closed gate runs before the network does.** `assertApprovalGate()`
  in `scripts/citywide-public-realm-cli.mjs` recomputes the statement hash,
  re-reads the live `source-registry.ts` to confirm the statement, evidenceId
  and fingerprint are still there, and asserts each of the five datasets is
  registered as approved against the right dataset id — refusing with
  "Approval gate refused (registry state does not authorize this acquisition)"
  before any request is made. It also refuses redirects, non-2xx, non-approved
  hosts, and overwriting an existing immutable snapshot.
- Snapshots are checksum-pinned: `data/raw/citywide-public-realm-20260824/`
  carries `manifest.sha256` and per-dataset roots; the ortho archive is pinned
  at `f4a0e5333033ed130c549b135175e9ab79fbafaedee1f6218acafdbd7de70b28` with
  1,300 members CRC-verified.
- License text is verified and recorded in `docs/research/PUBLIC_REALM_LICENSING.md`
  (§1–§7), including the T004 zip-embedded FGDC inspection.

**Qualifications, all four disclosed rather than smoothed:**

1. **The orthoimagery's `licenseClass` is `unknown`.** `LicenseClass` in
   `src/domain/schema.ts` has no `cc-by-4.0` member — only `cc-by-sa-4.0` — so
   the real basis is recorded in `attribution`, `derivativePolicy` and
   `approvalNote` while the machine-readable field says nothing. This was
   deliberately preferred to misstating CC BY 4.0 as share-alike, and a test
   pins that intent. It is a **worked-around schema gap, not a closed one.**
2. **The FGDC inspection is a non-contradiction, not a grant.** The 2024 zip's
   `accconst`/`useconst` are unfilled ESRI template placeholders. Recorded
   verbatim: "Absence of constraint text in an unpopulated template is *not* an
   affirmative grant." The operative basis remains NYC OTI's published
   aerial-imagery metadata.
3. **The three Block 835 planimetrics entries keep their original narrow
   `approvalEvidence`**; the wider citywide clip is recorded in
   `geographicScope`/`approvalNote` prose rather than by swapping the evidence
   field. Defensible and documented, but a strict reading of "registered with
   approval evidence" for the citywide portion rests on prose.
4. **`assertApprovalGate()`'s refusal path is not directly unit-tested.** It is
   a `.mjs` operator CLI; coverage is indirect, via the registry-side invariants
   it depends on. The gate that guards every acquisition has no test of its own.

---

## AC7 — no regression, and pre-existing changes preserved

> "Existing building-tier validators, wave releases, and the full test suite
> pass unchanged (no regression to the exterior/HLOD goals); pre-existing
> unrelated working-tree changes are preserved"

**Verdict: MET-WITH-QUALIFICATION**

The suite does not pass green, and **it did not pass green before this goal
either.** That was established by measurement, not assertion:

| run | files | passed | failed | skipped |
| --- | --- | --- | --- | --- |
| pre-goal baseline `b38e40f` (parallel) | 211 | 3,252 | **5** | 18 |
| HEAD `6329585` (parallel) | 231 | 3,655 | **7** | 18 |
| HEAD `6329585` (`--no-file-parallelism`) | 231 | 3,658 | **4** | 18 |

The baseline was taken at the commit immediately before T001 (#145), in a
detached worktree with `node_modules`, `public/data` and `data` symlinked from
the main tree so the payload-dependent tests saw identical inputs.

**Under serial execution the failure set at HEAD is a strict subset of the
pre-goal failure set.** The four are:

- `exterior-serving-residency.test.ts > re-derives the assembly per-asset
  weight…` — the test file was authored 2026-08-16 in PR #96, eight days before
  this goal began, and it **fails closed by design** when the untracked
  retention tree is absent, which it is on this machine. Its own comment says
  so: it used to `return` early and was deliberately changed not to.
- Three `App.test.tsx` exterior-streaming 20 s timeouts, present in the baseline.

The fifth baseline failure — the `Escape`-focus case — passes under
`--no-file-parallelism`, confirming the prior goal's recorded diagnosis that it
is worker CPU contention.

**Qualification — two new failures that are the goal's own.** Under *parallel*
full-suite load, `src/app/ground-canary.test.tsx` fails two cases ("serves
near-tier curbs in the default session…" and "deactivates exactly one wave's
cells…"). They are **not pre-existing**: the file did not exist before T007.
They pass when the file runs alone (19/19), at T012 (15/15), T013 (16/16) and
T014 (19/19) in a detached worktree under the same payload, and in the full
suite serially. The observed symptom is a leaked relative-URL fetch
("Failed to parse URL from /data/manhattan-ground-zone-imagery-20260826/
release.json"), i.e. cross-file test pollution introduced when T013 made zone
imagery load in default sessions. **This is a real new defect in the test
suite** — not in the shipped release, which validates clean — and it is recorded
here rather than filed under the pre-existing count.

Working-tree preservation: `AGENTS.md`, `docs/codex/AGENT_WORKFLOW.md` and
`docs/research/MANHATTAN_TRANSIT_RESEARCH.md` remain modified and untouched by
this task; the untracked `.claude/`, `.codex/`, `CLAUDE.md` and prior artifact
directories are intact. Building-tier validators and wave releases are unchanged
— no release byte was modified by this goal's runtime tasks.

---

## AC8 — the frozen acceptance record

> "An integration acceptance record freezes MET/NOT-MET per criterion with
> evidence hashes, following the pattern of the prior goals' acceptance records"

**Verdict: MET**

This document, plus [`evidence.json`](evidence.json) (machine facts, regenerable
by `build-evidence.mjs`, byte-identical across repeat runs) and
`ACCEPTANCE.sha256` (this file's digest). It follows the prior goals' pattern:
verdict per criterion, evidence hashes, qualifications stated in the record
rather than in a summary elsewhere, and the completion decision presented to the
user rather than taken.

---

## What a reader should take away

The goal built what it said it would build, and it can prove the build:
deterministic releases, checksum pins, fail-closed validators at three phases, an
approval gate that runs before the network, and evidence artifacts that
regenerate byte-identically. Where it fell short it fell short in two specific,
named places rather than diffusely: **crosswalks do not exist outside Block 835**,
and **nothing has been looked at since the ground became the default.**

The second of those is the one that matters for a goal whose stated outcome was
that users could *recognize* Times Square and Central Park. Recognizability is
not a property that a passing test can establish. Six criteria name visual or
interaction evidence; the record above marks every one of those clauses absent.
