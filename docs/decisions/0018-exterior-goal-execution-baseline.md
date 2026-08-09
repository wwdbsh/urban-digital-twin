# Decision 0018: Exterior Goal execution baseline and dirty-main ownership boundary

Date: 2026-08-09 (Asia/Seoul)
Status: Accepted T001 execution baseline
Product baseline: `251c33a88b10c73569d265a1543ecd51c9f325f5`
Goal contract: `aff1b99a5557b730594ddffa4753dfb343c6d36aefc47e45817aa3a73d52f608`

## Decision

Run the approved Manhattan high-fidelity exteriors Goal from isolated Orca
worktrees without mutating, importing, or treating the pre-existing dirty main
worktree as code ancestry. The accepted product baseline is both local `HEAD`
and `origin/main` at
`251c33a88b10c73569d265a1543ecd51c9f325f5`. The separately approved Goal
contract is identified by
`aff1b99a5557b730594ddffa4753dfb343c6d36aefc47e45817aa3a73d52f608`,
Goal Issue 1, and T001 Issue 2.

The four untracked Control Plane files listed below are ownership and execution
evidence for that Goal. They are not part of the accepted product commit, do
not make the dirty worktree an accepted ancestor, and must not be copied or
staged merely to make a Task branch self-contained.

After T001 is accepted, every later Task branches from the clean accepted T001
commit, which is itself a descendant of `251c33a88b10c73569d265a1543ecd51c9f325f5`.
Tasks must not branch from dirty main and must not repeatedly branch directly
from `251c33a88b10c73569d265a1543ecd51c9f325f5`, because doing so would omit this
ownership decision.

SHA-256 values in this decision establish byte identity only. A matching hash
does not by itself establish product acceptance, source or derivative-license
sufficiency, approval scope, redistribution rights, or public-conveyance
authority.

## Accepted product and release anchors

These are the accepted pre-Goal product anchors protected by the repository's
existing decisions and implementation evidence. Local release loaders remain
checksum-pinned and fail closed; no Goal Task may rewrite these bytes in place.

| Path | Accepted SHA-256 |
| --- | --- |
| `public/data/real-wave-20260804/manifest.json` | `3cf97db3425f64370720e31450c102e50ef7d733126860b2d7b588aecafb4d45` |
| `public/data/manhattan-citywide-20260804/manifest.json` | `acb5a9b52014f86535c8478e7d4e516efc03f6dff95c17e9896dfea4413c203c` |
| `public/data/manhattan-civic-context-20260804/manifest.json` | `225aba4efb041b26c38932b265f927373ec8974f0fb4a5e63e34baefd07da2a2` |
| `public/data/manhattan-esb-block-exterior-pilot-20260805/manifest.json` | `6021a766cf1137b5fed516edbca41a2ea2945a170bae4de65c056afad3b2cfd5` |
| `public/data/manhattan-esb-block-exterior-pilot-20260805/commercial-frontage.json` | `0cb53d95639c01dc821f42ce7aa47667d6db5226cc08efb47e9b8194ba99c7b0` |
| `public/data/manhattan-esb-block-exterior-pilot-20260805/release.json` | `4a84ddbb5b46dcc5ad84fc618922cc2c2225f9a86ee0373e9f3cec4246d1b38a` |
| `public/assets/landmarks/landmark-wave-20260804/manifest.json` | `41fd7e909fc82c5910308da1955ed9f81cc84902fb338224b1a2cf8cce0604e1` |
| `public/assets/landmarks/landmark-wave-20260804/flatiron-building__lod_0.glb` | `89ea83cff781dc52bdd853fb855c7fa61c0617442429c4334e2ad5b42c602db2` |
| `public/assets/landmarks/landmark-wave-20260804/flatiron-building__lod_1.glb` | `7a7c2c7467966d8ca77e4fb0a7ffad73418fcd0ae19a7ea5d2e38fb6aac5e38c` |
| `public/assets/landmarks/landmark-wave-20260804/empire-state-building__lod_0.glb` | `1062622b08d456d2011b744da83dd6d6ccfda399f0a8e5635436cea6ed2a4d80` |
| `public/assets/landmarks/landmark-wave-20260804/empire-state-building__lod_1.glb` | `ccbd194969405a2bfdff734e089de8528ef7c382729c459c570e64823ba39511` |
| `public/assets/landmarks/landmark-wave-20260804/theodore-roosevelt-birthplace__lod_0.glb` | `70723b90da12a30fdbc5306897ba957ab439178a6ce51d819edf1c656422ae01` |
| `public/assets/landmarks/landmark-wave-20260804/theodore-roosevelt-birthplace__lod_1.glb` | `3d76db1a843ebf59bb62499591d86e44daa0c023e904955d118be060008f2a32` |

## Protected public-realm candidate anchors

The staged Block 835 public-realm work is a protected candidate only, even
where its staged Decision 0017 or implementation record uses “approved” or
“immutable” language. T001 does not accept the candidate, its source/legal
review, its fidelity claims, or its conveyance rights.

| Candidate path | Snapshot SHA-256 |
| --- | --- |
| `data/raw/manhattan-esb-block-public-realm-20260806/manifest.json` | `7ce5ba0b1a58cb5bfd0fe1e7d7c27f0b5e35c577cbf1c072da3720598f449224` |
| `data/normalized/manhattan-esb-block-public-realm-20260806/manifest.json` | `7a5db2833a899bd645eb95008b0551efd96fbe67e1cddb17860d5aaaf6d8ab02` |
| `public/data/manhattan-esb-block-public-realm-20260806/manifest.json` | `f92b75fa42a48a751ba447b965bab85894bd7cea26fabd05130734d64e62509f` |
| `public/data/manhattan-esb-block-public-realm-20260806/release.json` | `f92b75fa42a48a751ba447b965bab85894bd7cea26fabd05130734d64e62509f` |
| `public/data/manhattan-esb-block-public-realm-20260806/benchmark.json` | `7853757e49ea9bdfb64adc05d178bce2105a5d166cc91113f003fde186327472` |
| `public/assets/manhattan-esb-block-public-realm-20260806/crosswalk__lod_0.glb` | `c264ef54043e66a766304134e5055f1646c2f6eb91c7f5ffaf6ebb8f86d97f05` |
| `public/assets/manhattan-esb-block-public-realm-20260806/crosswalk__lod_1.glb` | `b81c422ea0c687589ab095d8901aad2c0ca6e17021f4f2af2df77e859524da46` |
| `public/assets/manhattan-esb-block-public-realm-20260806/curb__lod_0.glb` | `833ef957c648b0868579e5fb0f813bdf3bce816c68a9fb96b794a4c6547aea77` |
| `public/assets/manhattan-esb-block-public-realm-20260806/curb__lod_1.glb` | `7eba1c5de7d93579897443bac1ba35eba1dbbb96e73f2f1633f89a764cd80f60` |
| `public/assets/manhattan-esb-block-public-realm-20260806/roadbed__lod_0.glb` | `cfdf935f5b9d9ee8bb6c8a315c1c8f3838e694c161f01959b6720489c616c985` |
| `public/assets/manhattan-esb-block-public-realm-20260806/roadbed__lod_1.glb` | `67310814648914f8685c5cfe63f85c0433a2090ecf12b92a27c766805e7dfd4b` |
| `public/assets/manhattan-esb-block-public-realm-20260806/sidewalk__lod_0.glb` | `ece5351bb5e000d4c1ce00fe2b805d6a2962414a07e15c62edca325dcf45a859` |
| `public/assets/manhattan-esb-block-public-realm-20260806/sidewalk__lod_1.glb` | `c3e6a5939481f9450e40c04bd82129d46a2a7c79e01212d1d6e3dec132f19011` |

The complete candidate set remains only in dirty main. No Task may stash,
reset, clean, restore, cherry-pick, copy, or otherwise import it without a new
explicit ownership and acceptance decision.

## Dirty-main snapshot and ownership

The read-only snapshot was taken on 2026-08-09 with dirty main and
`origin/main` both at `251c33a88b10c73569d265a1543ecd51c9f325f5`.
File-level inventory is exactly 50 staged paths, 3 unstaged paths, and 28
untracked paths. A short status collapses the untracked files under `.codex/`
and `artifacts/`; the inventory below expands them.

### Staged: 50 protected Block 835 candidate paths

Every row is owned by the user as a pre-existing Block 835 candidate. Its
disposition is: leave staged and untouched in dirty main; do not treat it as
accepted ancestry, copy it, restore it, or cherry-pick it into a Goal Task.

| Exact path | Owner / disposition |
| --- | --- |
| `README.md` | User / protected candidate; retain only on dirty main |
| `data/normalized/manhattan-esb-block-public-realm-20260806/crosswalks.json` | User / protected candidate; retain only on dirty main |
| `data/normalized/manhattan-esb-block-public-realm-20260806/curbs.json` | User / protected candidate; retain only on dirty main |
| `data/normalized/manhattan-esb-block-public-realm-20260806/features.json` | User / protected candidate; retain only on dirty main |
| `data/normalized/manhattan-esb-block-public-realm-20260806/manifest.json` | User / protected candidate; retain only on dirty main |
| `data/normalized/manhattan-esb-block-public-realm-20260806/manifest.sha256` | User / protected candidate; retain only on dirty main |
| `data/normalized/manhattan-esb-block-public-realm-20260806/quarantine.json` | User / protected candidate; retain only on dirty main |
| `data/raw/manhattan-esb-block-public-realm-20260806/acquisition-contract.json` | User / protected candidate; retain only on dirty main |
| `data/raw/manhattan-esb-block-public-realm-20260806/approval.json` | User / protected candidate; retain only on dirty main |
| `data/raw/manhattan-esb-block-public-realm-20260806/manifest.json` | User / protected candidate; retain only on dirty main |
| `data/raw/manhattan-esb-block-public-realm-20260806/manifest.sha256` | User / protected candidate; retain only on dirty main |
| `data/raw/manhattan-esb-block-public-realm-20260806/terms/capture-rules.md` | User / protected candidate; retain only on dirty main |
| `data/raw/manhattan-esb-block-public-realm-20260806/terms/nyc-open-data-overview.html` | User / protected candidate; retain only on dirty main |
| `data/raw/manhattan-esb-block-public-realm-20260806/vfx9-tbb6/mapped-metadata.json` | User / protected candidate; retain only on dirty main |
| `data/raw/manhattan-esb-block-public-realm-20260806/vfx9-tbb6/metadata.json` | User / protected candidate; retain only on dirty main |
| `data/raw/manhattan-esb-block-public-realm-20260806/vfx9-tbb6/query.json` | User / protected candidate; retain only on dirty main |
| `data/raw/manhattan-esb-block-public-realm-20260806/vfx9-tbb6/response.geojson` | User / protected candidate; retain only on dirty main |
| `data/raw/manhattan-esb-block-public-realm-20260806/x9uq-u3qs/mapped-metadata.json` | User / protected candidate; retain only on dirty main |
| `data/raw/manhattan-esb-block-public-realm-20260806/x9uq-u3qs/metadata.json` | User / protected candidate; retain only on dirty main |
| `data/raw/manhattan-esb-block-public-realm-20260806/x9uq-u3qs/query.json` | User / protected candidate; retain only on dirty main |
| `data/raw/manhattan-esb-block-public-realm-20260806/x9uq-u3qs/response.geojson` | User / protected candidate; retain only on dirty main |
| `data/raw/manhattan-esb-block-public-realm-20260806/xgwd-7vhd/mapped-metadata.json` | User / protected candidate; retain only on dirty main |
| `data/raw/manhattan-esb-block-public-realm-20260806/xgwd-7vhd/metadata.json` | User / protected candidate; retain only on dirty main |
| `data/raw/manhattan-esb-block-public-realm-20260806/xgwd-7vhd/query.json` | User / protected candidate; retain only on dirty main |
| `data/raw/manhattan-esb-block-public-realm-20260806/xgwd-7vhd/response.geojson` | User / protected candidate; retain only on dirty main |
| `docs/decisions/0017-block835-public-realm.md` | User / protected candidate; its approval language does not override this boundary |
| `docs/implementation/20260806-block835-public-realm.md` | User / protected candidate; its approval language does not override this boundary |
| `package.json` | User / protected candidate; retain only on dirty main |
| `public/assets/manhattan-esb-block-public-realm-20260806/crosswalk__lod_0.glb` | User / protected candidate; retain only on dirty main |
| `public/assets/manhattan-esb-block-public-realm-20260806/crosswalk__lod_1.glb` | User / protected candidate; retain only on dirty main |
| `public/assets/manhattan-esb-block-public-realm-20260806/curb__lod_0.glb` | User / protected candidate; retain only on dirty main |
| `public/assets/manhattan-esb-block-public-realm-20260806/curb__lod_1.glb` | User / protected candidate; retain only on dirty main |
| `public/assets/manhattan-esb-block-public-realm-20260806/roadbed__lod_0.glb` | User / protected candidate; retain only on dirty main |
| `public/assets/manhattan-esb-block-public-realm-20260806/roadbed__lod_1.glb` | User / protected candidate; retain only on dirty main |
| `public/assets/manhattan-esb-block-public-realm-20260806/sidewalk__lod_0.glb` | User / protected candidate; retain only on dirty main |
| `public/assets/manhattan-esb-block-public-realm-20260806/sidewalk__lod_1.glb` | User / protected candidate; retain only on dirty main |
| `public/data/manhattan-esb-block-public-realm-20260806/benchmark.json` | User / protected candidate; retain only on dirty main |
| `public/data/manhattan-esb-block-public-realm-20260806/crosswalks.json` | User / protected candidate; retain only on dirty main |
| `public/data/manhattan-esb-block-public-realm-20260806/curbs.json` | User / protected candidate; retain only on dirty main |
| `public/data/manhattan-esb-block-public-realm-20260806/features.json` | User / protected candidate; retain only on dirty main |
| `public/data/manhattan-esb-block-public-realm-20260806/manifest.json` | User / protected candidate; retain only on dirty main |
| `public/data/manhattan-esb-block-public-realm-20260806/release.json` | User / protected candidate; retain only on dirty main |
| `scripts/block835-public-realm-cli.mjs` | User / protected candidate; retain only on dirty main |
| `src/app/App.test.tsx` | User / protected candidate; retain only on dirty main |
| `src/app/App.tsx` | User / protected candidate; retain only on dirty main |
| `src/data/source-registry.ts` | User / protected candidate; retain only on dirty main |
| `src/features/explorer/CesiumViewport.test.ts` | User / protected candidate; retain only on dirty main |
| `src/features/explorer/CesiumViewport.tsx` | User / protected candidate; retain only on dirty main |
| `src/runtime/block835-public-realm-release.test.ts` | User / protected candidate; retain only on dirty main |
| `src/runtime/block835-public-realm-release.ts` | User / protected candidate; retain only on dirty main |

The staged count classification is exactly 18 raw paths, 6 normalized paths,
8 GLBs, 6 published-release paths, and 12 code/documentation/package paths.

### Unstaged: 3 user-owned paths

| Exact path | Owner / disposition |
| --- | --- |
| `AGENTS.md` | User / preserve unstaged; do not copy, stage, or make code ancestry |
| `docs/codex/AGENT_WORKFLOW.md` | User / preserve unstaged; excluded from T001 and later Task imports |
| `docs/research/MANHATTAN_TRANSIT_RESEARCH.md` | User / preserve unstaged; unrelated to the exterior Goal baseline |

### Untracked: 28 paths

| Exact path | Owner / disposition |
| --- | --- |
| `.codex/codex-control-plane/goals/manhattan-high-fidelity-exteriors/GOAL.md` | Control Plane / Goal ownership evidence only; retain untracked on dirty main, not accepted code ancestry |
| `.codex/codex-control-plane/goals/manhattan-high-fidelity-exteriors/goal.json` | Control Plane / Goal ownership evidence only; retain untracked on dirty main, not accepted code ancestry |
| `.codex/codex-control-plane/goals/manhattan-high-fidelity-exteriors/state.json` | Control Plane / Goal ownership evidence only; retain untracked on dirty main, not accepted code ancestry |
| `.codex/codex-control-plane/goals/manhattan-high-fidelity-exteriors/tasks.json` | Control Plane / Goal ownership evidence only; retain untracked on dirty main, not accepted code ancestry |
| `artifacts/blender/landmark-wave-20260804/blender-overview.png` | User / retained Blender evidence; preserve untracked and do not import |
| `artifacts/blender/landmark-wave-20260804/empire-state-three-quarter.png` | User / retained Blender evidence; preserve untracked and do not import |
| `artifacts/blender/landmark-wave-20260804/flatiron-three-quarter.png` | User / retained Blender evidence; preserve untracked and do not import |
| `artifacts/blender/landmark-wave-20260804/theodore-roosevelt-birthplace-three-quarter.png` | User / retained Blender evidence; preserve untracked and do not import |
| `artifacts/browser/landmark-wave-20260804/README.md` | User / retained browser evidence; preserve untracked and do not import |
| `artifacts/browser/landmark-wave-20260804/empire-runtime-height-corrected.png` | User / retained browser evidence; preserve untracked and do not import |
| `artifacts/browser/landmark-wave-20260804/empire-runtime.png` | User / retained browser evidence; preserve untracked and do not import |
| `artifacts/browser/landmark-wave-20260804/flatiron-runtime-height-corrected.png` | User / retained browser evidence; preserve untracked and do not import |
| `artifacts/browser/landmark-wave-20260804/flatiron-runtime.png` | User / retained browser evidence; preserve untracked and do not import |
| `artifacts/browser/landmark-wave-20260804/procedural-building-runtime-height-corrected.png` | User / retained browser evidence; preserve untracked and do not import |
| `artifacts/browser/landmark-wave-20260804/procedural-building-runtime.png` | User / retained browser evidence; preserve untracked and do not import |
| `artifacts/citywide-wave-20260804/baseline/README.md` | User / retained citywide evidence; preserve untracked and do not import |
| `artifacts/citywide-wave-20260804/baseline/status.txt` | User / retained citywide evidence; preserve untracked and do not import |
| `artifacts/citywide-wave-20260804/checkpoint-1/README.md` | User / retained citywide evidence; preserve untracked and do not import |
| `artifacts/citywide-wave-20260804/checkpoint-2/STOP-REPORT.md` | User / retained citywide evidence; preserve untracked and do not import |
| `artifacts/citywide-wave-20260804/recovery-cp2a/README.md` | User / retained citywide evidence; preserve untracked and do not import |
| `artifacts/citywide-wave-20260804/recovery-cp2b/README.md` | User / retained citywide evidence; preserve untracked and do not import |
| `artifacts/citywide-wave-20260804/recovery-cp2c/STOP-REPORT.md` | User / retained citywide evidence; preserve untracked and do not import |
| `artifacts/travel-context-wave-20260804/CP0-baseline.md` | User / retained travel-context evidence; preserve untracked and do not import |
| `artifacts/travel-context-wave-20260804/CP3-release.md` | User / retained travel-context evidence; preserve untracked and do not import |
| `artifacts/travel-context-wave-20260804/CP5-validation.md` | User / retained travel-context evidence; preserve untracked and do not import |
| `artifacts/travel-context-wave-20260804/browser-journeys.md` | User / retained travel-context evidence; preserve untracked and do not import |
| `artifacts/travel-context-wave-20260804/documentation-matrix.md` | User / retained travel-context evidence; preserve untracked and do not import |
| `artifacts/travel-context-wave-20260804/work-unit-paths.txt` | User / retained travel-context evidence; preserve untracked and do not import |

The untracked classification is exactly 4 Control Plane, 4 Blender, 7 browser,
7 citywide, and 6 travel-context evidence files.

## Ignored, generated, immutable, and availability boundaries

The relevant Git ignore rules are exact: `data/raw/`, `data/generated/`,
`public/tiles/`, `public/data/`, `artifacts/offline-ingest/`, `*.blend`, and
`*.blend1`. A previously force-added tracked file beneath an ignored root stays
tracked, but that exception does not make neighboring payloads available in a
clean worktree or authorize their reuse.

| Exact root | Class | Availability at clean T001 baseline |
| --- | --- | --- |
| `data/raw/real-wave-20260804/` | Ignored immutable bounded-pilot raw payload | Absent |
| `data/raw/manhattan-citywide-20260804/` | Ignored immutable citywide raw payload | Absent |
| `data/generated/manhattan-citywide-20260804/` | Ignored generated citywide payload | Absent |
| `data/generated/catalog/manhattan-citywide-20260804-replay-a/` | Ignored generated release assembly | Absent |
| `data/raw/travel-context-wave-20260804/` | Ignored immutable civic raw payload | Absent |
| `public/data/real-wave-20260804/` | Ignored immutable bounded-pilot release | Absent |
| `public/data/manhattan-citywide-20260804/` | Ignored immutable citywide release | Absent |
| `public/data/manhattan-civic-context-20260804/` | Ignored immutable civic release | Absent |
| `data/raw/manhattan-esb-block-commercial-20260805/` | Force-tracked immutable commercial evidence | Present |
| `data/normalized/manhattan-esb-block-commercial-20260805/` | Tracked normalized commercial evidence | Present |
| `public/data/manhattan-esb-block-exterior-pilot-20260805/` | Force-tracked immutable exterior release | Present |
| `public/assets/manhattan-esb-block-exterior-pilot-20260805/` | Tracked immutable exterior assets | Present |
| `public/assets/landmarks/landmark-wave-20260804/` | Tracked immutable landmark package | Present |
| `data/raw/manhattan-esb-block-public-realm-20260806/` | Ignored protected candidate raw root | Absent |
| `data/normalized/manhattan-esb-block-public-realm-20260806/` | Protected candidate normalized root | Absent |
| `public/data/manhattan-esb-block-public-realm-20260806/` | Ignored protected candidate release root | Absent |
| `public/assets/manhattan-esb-block-public-realm-20260806/` | Protected candidate asset root | Absent |
| `public/tiles/` | Ignored generated tile root | Absent |
| `artifacts/offline-ingest/` | Ignored generated/validation evidence root | Absent |
| `artifacts/blender/**/*.blend` and `artifacts/blender/**/*.blend1` | Ignored Blender authoring and backup payloads | Absent |

Availability is an invariant, not a setup inconvenience: an ignored or
untracked payload absent from a clean Task worktree may enter that worktree only
through an explicitly approved copy, reuse, or operator workflow followed by
hash revalidation. A Task must never acquire, rebuild, normalize, publish, or
silently read the payload across worktrees. Presence in dirty main is neither
availability nor authorization, and presence in a clean worktree does not
expand licensing or conveyance scope.

## Governance and architecture invariants

The `AGENTS.md` version tracked by the clean product baseline is a superseded
policy snapshot, while dirty main contains an unstaged user-owned policy edit.
Every future Task must receive and re-read the authoritative current repository
contract at Task start. If the delivered contract and the worktree copy differ
materially, stop for reconciliation. Do not copy, stage, or otherwise adopt the
dirty-main policy edit as part of exterior implementation.

This execution baseline does not change public behavior or architecture.
CesiumJS remains the sole world-camera, WGS84 positioning, terrain/globe, and
picking authority. Provider-neutral domain boundaries, stable feature identity,
deep links, provenance, capture/update dates, uncertainty, license and approval
scope, local-only no-provider-request behavior, checksum pinning, immutability,
and fail-closed release behavior remain mandatory.

## Task isolation and overlap stop gates

Before every later Task:

1. Use Orca to create an isolated descendant of the accepted T001 commit.
2. Confirm the new worktree is clean and re-read the authoritative repository
   contract; do not use dirty main as an input checkout.
3. Re-inventory dirty main read-only. Snapshot drift triggers a new inventory
   and ownership decision, never restoration of the old snapshot.
4. Compare the Task touch set with both this record and current dirty-main
   changes. Stop on any unapproved overlap.
5. Resolve availability of every ignored payload through an explicitly approved
   workflow before attempting data-dependent validation.

The overlap stop gate applies specifically to T005, T008, and any later Task
touching `src/app/App.tsx`, `src/features/explorer/CesiumViewport.tsx`,
`src/runtime/`, `public/data/`, or `public/assets/`. A matching path, root, or
semantic responsibility is not permission to overwrite the protected candidate;
the Task stops until ownership, precedence, and disposition are explicit.

No Goal Task may use `git stash`, reset, clean, restore, or a candidate
cherry-pick as a recovery shortcut. It must not delete or replace retained raw,
normalized, release, Blender, browser, citywide, travel-context, or Control
Plane evidence.

## Dirty-main recovery, re-inventory, and rollback

If main remains dirty when a Task starts, leave it dirty and perform only
read-only inventory there: record HEAD/origin, staged/unstaged/untracked
file-level counts, exact paths, relevant hashes, and diff-check findings. If
anything differs from this snapshot, classify the current state afresh and
obtain the required decision; do not force main back to this record.

Create or continue the Task only in its clean accepted-T001 descendant. If an
authorized Task requires a missing ignored payload, pause until an approved
operator supplies it to that Task worktree and its declared hashes are
revalidated. Acquisition, normalization, release construction, and publication
remain separate operator workflows and are not authorized by this decision.

Rollback of T001 means reverting only this ADR's branch or accepted commit. It
must never modify dirty main, the protected candidate, any ignored/generated
payload, or any immutable accepted release. Snapshot drift is recovered by
re-inventory, not by cleaning, restoring, or reconstructing user state.

## Verification evidence

- Orca `status --json` reported the runtime ready; `worktree current --json`
  reported clean branch `ccp/2-freeze-exterior-goal-baseline` at
  `251c33a88b10c73569d265a1543ecd51c9f325f5` with base
  `refs/remotes/origin/main`.
- Dirty-main file-level inventory reproduced 50 staged, 3 unstaged, and 28
  untracked paths with the category totals stated above.
- Independent SHA-256 replay reproduced every accepted and candidate anchor in
  this decision; the Goal/T001 contract hash was independently cross-checked in
  `state.json` and the T001 entry in `tasks.json`.
- Dirty main `git diff --cached --check` exits 2 with 11 pre-existing whitespace
  findings in retained Block 835 source-evidence files. T001 does not fix them
  and does not claim that dirty-main check passed.
- T001 verification is limited to Orca status/current, exact inventory and
  hashes, a one-file ADR diff, and `git diff --check
  251c33a88b10c73569d265a1543ecd51c9f325f5...HEAD` after the accepted T001
  commit exists. Product tests, builds, acquisition, publication, and runtime
  validation are intentionally outside this documentation-only decision.
