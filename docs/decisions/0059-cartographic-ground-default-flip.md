# Decision 0059: the cartographic ground becomes the default, and the synthetic grid is demoted rather than deleted

Date: 2026-08-24

Status: **accepted**. Shipped as one revertable commit.

Task: T008 of goal `manhattan-citywide-public-realm` (Issue #137). Contract hash
`a0725a6958c9bb690de7e20b94d5dd631161a64515f4b35a6d21cf78690390ee`.

No release was assembled, no artifact was published, and **no frozen byte
changed**. `manhattan-ground-20260824` — its 140 cells, 42,778 features, 47,779
parts, 352 artifacts and its ledger id — is byte-identical to what T007 shipped.
No budget was raised: the ground runtime keeps the borrowed `CITYWIDE_BUDGETS`
ceilings and the T007 streaming caps (24 cells / 48 MiB) unchanged.

---

## Part 1 — the flip

`GROUND_DEFAULT_ON = true` (`src/app/App.tsx`) is the whole decision. It is read
in exactly three places — the boot parse, the `popstate` parse, and the URL
writer — following the pattern ADR 0045 established for
`EXTERIOR_SCHEDULER_DEFAULT_ON` and T005 re-used for `FAR_TIER_DEFAULT_ON`.

The URL contract is polarity-agnostic, which is the property that makes the
constant a real switch rather than a label:

| URL | meaning |
| --- | --- |
| *(no `ground` parameter)* | whatever `GROUND_DEFAULT_ON` currently is |
| `?ground=manhattan-ground-20260824` | an explicit request, honoured in **either** polarity |
| `?ground=off` | the opt-out |
| any other spelling | falls back to the **default**, never to an unverifiable release |

`appendGroundUrl` writes the opt-out and deletes the parameter otherwise, so a
default session's URL carries no ground token in either polarity and the flip
does not churn shared links. Every `?ground=manhattan-ground-20260824` link
minted while the ground was an opt-in canary still means exactly what it meant.

The opt-out is not a one-way door: the control that disables the ground re-arms
it, because a default-on feature whose only escape hatch is a hand-edited URL is
a defect, not a safeguard.

## Part 2 — the grid is demoted, not deleted

`GridImageryProvider` is still constructed exactly once per viewer
(`src/features/explorer/CesiumViewport.tsx`). What changed is that its
`ImageryLayer.show` is now a function of the ground state:

```
syntheticGridVisible(groundBaseActive) === !groundBaseActive
```

where `groundBaseActive` is the app's `groundActive` — requested **and** verified
**and** loaded — handed to the viewport as a non-null `groundOverlay`.

Deleting the provider was rejected for the reason the invariant exists. Idle,
loading, **failed** and opted-out sessions all keep the grid, so a release that
fails verification leaves the grid plus the existing explicit failure line rather
than a void. The `show` toggle is used instead of re-creating the provider
because rebuilding an imagery provider would re-tile the globe for what is a
visibility decision.

Between "verified" and "first cell drawn" there is a seam where the grid is
hidden and no ground cell has been tessellated yet. It is not a void: the
globe's own `baseColor` (`#18252d`) is the same colour as the grid's background.
That is a mitigation, not a measurement — see Part 5.

## Part 3 — the boot cost, measured rather than assumed

The ground load fires on mount, so its verification is boot cost. Stating that
without a number would be the kind of claim this project refuses, so the number
is both measured and **published in the product**: the status line now reports
`verified in N ms` from the session's own load, and `data-ground-verify-ms`
carries it for inspection.

Node-side, over the same loader and the same bytes:

| run | 1 | 2 | 3 | 4 | 5 | median |
| --- | --- | --- | --- | --- | --- | --- |
| ms | 690 | 659 | 661 | 666 | 655 | **661** |

That covers `release.json`, `ledger.json`, `features.json`, `parts.json`, the
release-graph validation and the re-derived identity/ledger checksums — 42,778
features and 103 materialized cells. Per-cell artifacts are **not** in it; they
are verified lazily at draw time under the unchanged T007 caps.

**This task did not build idle-deferral infrastructure**, deliberately: deferring
the load is a scheduling change with its own failure modes, and bundling it into
a default flip would make the flip unmeasurable. The cost is recorded here as an
open risk (Part 5).

## Part 4 — what the benchmark does and does not prove

`pnpm citywide:benchmark` was run and stayed within its recorded shape:

| metric | this run | recorded baseline |
| --- | --- | --- |
| cold search P95 | 13.65 ms | 16.96 ms |
| warm search P95 | 13.55 ms | 16.81 ms |
| cold pick P95 | 4.55 ms | 6.44 ms |
| warm pick P95 | 1.77 ms | 2.68 ms |
| cold/warm search shard loads | 117 / 78 | 117 / 78 |
| cold/warm detail shard loads | 30 / 2 | 30 / 2 |
| bounded shards / declared bytes | 451 / 304,382,520 | 451 / 304,382,520 |

**It does not measure the ground at all.** It exercises the citywide
buildings/search release; no ground byte is loaded by it. Reporting it as
evidence *for* the flip would be dishonest. It is here for one narrower claim:
the flip did not disturb the buildings/search path. The ground-cost evidence is
Part 3's 661 ms plus the unchanged T007 streaming caps, and nothing else.

`pnpm citywide:validate` passed both phases, including the ground release phase:
140 cells, 42,778 features, 47,779 parts, 352/352 artifacts, 13,154,558
coordinates checked, max relative area error 2.48e-9.

## Part 5 — rollback, and what a rollback actually restores

Flipping `GROUND_DEFAULT_ON` back to `false` restores **everything**: the parser
returns to "false unless the URL names the release", the writer returns to
writing the release id on opt-in and deleting the parameter otherwise, and the
grid is visible in every session because no session holds a verified overlay.
Unlike ADR 0045's scheduler flip there is **no third configuration** left behind
— this flip raises no budget, swaps no pin, and assembles no release.

The rehearsal was run on the branch, in both polarities, before this ADR was
accepted; the results are in the T008 implementation record.

### Open risks, recorded rather than closed

1. **Boot cost is paid by every session** — 661 ms node-side, more over HTTP with
   cold cache. Idle-deferral is the obvious next move and is deliberately not in
   this task.
2. **`ImageryLayer.show` is not covered by an automated test.** CesiumJS does not
   render in jsdom. The *rule* is pinned (`syntheticGridVisible`, plus the app
   test that drives it from the real prop), but the layer write itself rests on
   visual confirmation.
3. **The verified-to-first-cell seam** is argued from the matching `baseColor`,
   not measured. A slow first cell shows a flat dark surface for that interval.
4. **Fixture sessions now load a real Manhattan ground release.** Unlike the far
   tier, which is switched off in fixture mode by `farTierActiveForSession`, the
   ground is not gated on the data mode. A fixture session therefore pays the
   boot cost and draws real Manhattan surfaces under synthetic geometry.
