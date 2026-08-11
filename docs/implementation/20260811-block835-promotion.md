# 2026-08-11 — Block 835 exterior wave promoted to the default (T010, Issue #11)

Decision record: `docs/decisions/0028-block835-exterior-default-activation.md`.
Predecessor wave: `docs/implementation/20260811-block835-exterior-canary.md`.

## What changed

| File | Purpose |
| --- | --- |
| `src/runtime/exterior-default-activation.ts` | New. The indivisible promotion record, the activation resolver, the pin and identity gates, and the explicit-unavailable statement. |
| `src/runtime/exterior-default-activation.test.ts` | New. Record-vs-committed-bytes drift gate, activation matrix, both verification paths, rollback. |
| `src/app/App.tsx` | URL intent parse/serialize, derived activation, promoted-default verification, popstate restore, toggle semantics, unavailable section. |
| `src/app/App.test.tsx` | Updated URL contract tests; new default-activation, disable, Back/Forward, toggle-target, fault-isolation and rollback-rehearsal tests. |

No release byte changed. `git diff --stat` over `public/data/` and `data/`
against the task base commit `032306f` is empty; the only new file under `data/`
is this task's own evidence inventory.

## Promotion record

```
release   manhattan-exterior-cells-20260811
snapshot  snapshot:manhattan-exterior-cells-20260811:v1
checksum  18e1689e19264543d8aaacafe989769b5d74f04cf0f5ca9cfc6c5407632e0ae7
packages  manhattan-esb-block-reference-20260811
cell      cell:manhattan:block-835
          cell-release:manhattan-exterior-cells-20260811:v1
          418ec17d40cdbe89be781367df5cf4d47dc4fba3bf3902b019c6431e05ce4a87
identities 14 DOITT ids (doitt:39969 … doitt:982383)
approval  Issue #11 gate approval 2026-08-11 + perf evidence PR #38
```

## Rollback procedure

In `src/runtime/exterior-default-activation.ts`, export the predecessor:

```ts
export const EXTERIOR_DEFAULT_ACTIVATION: ExteriorDefaultActivationRecord =
  { enabled: false, releaseId: null };
```

That is the whole rollback. Effects, all covered by tests:

- real-base sessions render base-only massing and no exterior request is made;
- the details panel states the wave is not active in this build and that no
  substitute exterior was selected;
- selection, search, deep links and identities are untouched;
- `?exteriorCells=…` opt-in links keep behaving exactly as they did before the
  promotion — that *is* the predecessor behaviour, and rollback withdraws the
  default only.

The rehearsal is automated: `App.test.tsx` swaps the record through the same
live binding the app reads and asserts the base-only outcome.

## URL contract

| URL | Result |
| --- | --- |
| no exterior params, real base active | promoted release streams (default) |
| no exterior params, fixture mode | quiet: no load, no notice, no banner |
| `exteriorStreaming=off` | no exterior wave; explicit unavailable statement |
| `exteriorCells=<pinned>` | that release, exactly as before the promotion |
| `exteriorCells=<unpinned>` | fails closed to off, with the existing loud notice |
| `exteriorStreaming=<not "off">` | unsupported-value notice; build default resolves |

Serialization writes explicit intent only: `exteriorStreaming=off` when disabled,
`exteriorCells` when a release was explicitly chosen, `exteriorProfile` whenever
the wave is streaming. Back/Forward restores all of it.

## Verification

- `pnpm typecheck`, `pnpm lint`, `pnpm build` — pass.
- `pnpm test` — 67 files, 655 tests, pass (629 pre-existing kept green; 26 added).
- Immutability gate — `git diff --stat` over `public/data/` and `data/` vs
  `032306f`: empty. `git diff --check`: clean.

## Renderer journeys

Seven journeys were run in the Orca embedded browser against `vite preview` on
loopback. Evidence: `artifacts/block835-promotion-20260811/`, hashed in
`data/block835-promotion-20260811/evidence-inventory.json`.

| # | Journey | Outcome |
| --- | --- | --- |
| a | Cold load over a real base, no exterior params | Default pinned snapshot streams; a clean tab requests only `/data/manhattan-exterior-cells-20260811/` — index, graph, assemblies and exactly 14 `lod_1` GLBs; zero fixture-package requests. |
| b | Pick a Block 835 building | `doitt:778052` selected; exterior section shows the release, cell, active asset checksum, truth tier `generated`, capture date and the procedural-generation uncertainty. |
| c | Deep link + browser Back/Forward across off/on | Four popstate transitions restored the correct exterior state each time. |
| d | `exteriorStreaming=off` | Base massing only; "Unavailable" badge with the explicit statement; no exterior request. |
| e | `exteriorCellFault=head-checksum` (harness build) | "Pinned exterior snapshot … checksum does not match its public root declaration. Exterior streaming was disabled; the existing base/exterior state was left unchanged." Base release, selection and details intact. |
| f | `exteriorCells=udt-fixture-exterior-cells` | Unchanged pre-promotion behaviour, including its prerequisite message; the promoted release was never requested. |
| g | Fixtures-mode default session | No exterior request, no status line, no banner, "Enable exterior streaming" available. |

Journey (e) needs `VITE_BLOCK835_PROBE=1` because the fault seam is compiled out
of the production build. Journeys (a)–(d), (f) and (g) ran against the ordinary
`pnpm build` output.

## Observations worth keeping

- Exterior geometry is drawn only for buildings whose **base** record is
  resident. At the citywide overview camera, journey (a) reported 4 of 14
  withheld for want of a WGS84 anchor, and at one intermediate camera 13 of 14.
  This is the pre-existing anchor rule (and its existing explicit notice), not a
  promotion regression: all 14 draw once the block's base shards are resident.
  Default activation makes that notice much more visible than an opt-in canary
  did, and it is the honest report of what the scene contains.
- The Stage 3 performance probe now needs `&exteriorStreaming=off` over a real
  base. See ADR 0028 Consequences.

## What this does not prove

Passing every test and journey shows the promoted release is what a real-base
session sees, and that it was verified against the accepted pin and membership
before rendering. It is not evidence of architectural, material or visual
accuracy, and not a performance or accessibility certification.
