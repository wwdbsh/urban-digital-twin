# Stage 3 block 835 commercial frontage implementation record

Date: 2026-08-05 (Asia/Seoul)
Owner: GPT-5.6 Luna Max
Baseline: `2822468fdc7e49b1d3b6197029164916688ce2e3`
Release: `manhattan-esb-block-exterior-pilot-20260805`
Decision: [0016](../decisions/0016-stage3-commercial-frontage.md)

## Executive result

This record documents a local-runtime, additive overlay for exactly 14 OTI
building parents in tax block 835. It preserves the claim ceiling required by
the amendment: ESB and Herald Towers are licensed-near-real only for visible
evidence-backed portions, while the remaining twelve are OTI footprint/height
massings with machine-readable estimated facade/storefront geometry. Factual
commercial names are limited to the eight accepted OSM placements below;
unknown and ambiguous records remain unrendered but accounted.

The release is opt-in and does not replace the citywide or civic root:

```text
http://127.0.0.1:4175/?data=citywide&release=manhattan-civic-context-20260804&exterior=manhattan-esb-block-exterior-pilot-20260805&commercial=1
```

No Google content or lineage, runtime provider request, source image pixel,
external font/logo/image, dependency, public deployment, or public conveyance
is part of this work. Implementation and review/fix workers did not stage,
commit, or push this work unit. The 2026-08-06 user approval
`codex-user-turn:2026-08-06:stage3-private-repo-commit-push-approval` makes this
separately authorized release task the private-repository staging, commit, and
push step for the existing private GitHub repository only. The original
acquisition approval's commit/push exclusions remain its own scope boundary;
public deployment, hosting, redistribution, and other public conveyance remain
excluded.

## Exact identity and evidence matrix

Membership is `BASE_BBL[0] == "1" && BASE_BBL[1:6] == "00835"` over OTI
`jh45-qr5r`, captured `2026-08-04T08:25:05.580Z`, raw SHA
`52c841e388f8e56e6e3666d2ce8b6436ec10f9eeb2bbcad2b2452b51d58dafc7`. The
sorted IDs are:

| Canonical ID | BIN | BBL | Visual claim ceiling | Accepted sign/proxy |
| --- | --- | --- | --- | --- |
| `doitt:39969` | `1083635` | `1008350056` | source-constrained; estimated facade | Timberland |
| `doitt:102705` | `1015860` | `1008350009` | source-constrained; estimated facade | none |
| `doitt:131170` | `1015859` | `1008350001` | licensed-near-real visible Herald evidence | none |
| `doitt:147902` | `1083636` | `1008350056` | source-constrained; estimated facade | Smoke Shop; Build-A-Bear Workshop |
| `doitt:262867` | `1015863` | `1008350061` | source-constrained; estimated facade | I Love NY Gifts & Luggage |
| `doitt:460555` | `1015865` | `1008350065` | source-constrained; estimated facade | none |
| `doitt:498980` | `1083637` | `1008350063` | source-constrained; estimated facade | none |
| `doitt:502491` | `1015866` | `1008350067` | source-constrained; estimated facade | none |
| `doitt:584049` | `1015861` | `1008350011` | source-constrained; estimated facade | Inhale Cannabis Club |
| `doitt:778052` | `1015862` | `1008350041` | licensed-near-real visible ESB evidence | STATE Grill and Bar |
| `doitt:812702` | `1083634` | `1008350056` | source-constrained; estimated facade | Dim Sum Palace |
| `doitt:835659` | `1015864` | `1008350064` | source-constrained; estimated facade | none |
| `doitt:925937` | `1086750` | `1008350063` | source-constrained; estimated facade | none |
| `doitt:982383` | `1084660` | `1008350015` | source-constrained; estimated facade | Nonstop Style |

The duplicate BBL parents remain separate picks and assets. The ESB OTI roof
height is `377.583 m`; its separately evidenced overall pinnacle is
approximately `442.6 m`. Herald's OTI roof is `99.222 m`.

## Source packet, attempts, and partitions

Raw root: `data/raw/manhattan-esb-block-commercial-20260805`
Raw manifest SHA: `ae0819a83adb38eb8ca6ec0759de154a2c0a503e73450027eb1039bffcbdda1d`
Normalized root: `data/normalized/manhattan-esb-block-commercial-20260805`
Normalized manifest SHA: `11ee84b2c24db9247b222cb895bf7af6f76f34901a58cf5568083e83bed30f97`
Frozen source packet SHA: `cdca91b102e5ccca8143158088b512c7e64bd006d279226bafeff059e105bda0`

The immutable raw manifest records all attempts and approvals:

| Attempt | Result | Approval | Query SHA |
| --- | --- | --- | --- |
| 1 | HTTP 504 | `codex-user-turn:2026-08-05:bounded-overpass-single-query-approval` | `5ba65d622b8c8165d31d805d90fae3a00ab1e5f919282fdc4c7c6c56de135c62` |
| 2 | response-size-limit | `codex-user-turn:2026-08-05:overpass-identical-single-retry-approval` | `5ba65d622b8c8165d31d805d90fae3a00ab1e5f919282fdc4c7c6c56de135c62` |
| 3 | HTTP 200, 64,249 bytes, 100 elements | `codex-user-turn:2026-08-05:overpass-commercial-poi-single-query-approval` | `ce61419f88fe87c2344cf45ecf1766a5a3d404c15f30c8903ea65a2dc28056e7` |

The successful cached response SHA is
`ed7acab3fd48105e718b1a6e734a3c3ac31320a62bff6b229c5c0691f0f7219e`.
The first two failure packets remain immutable; there was no fourth request.
The NYC-independent partition contains OTI/DOHMH/AddressPoint/DCWP source
observations. The `odbl-derived` partition contains OSM observations, OSM-based
spatial/address decisions, and cross-source association edges, with visible
`Map data © OpenStreetMap contributors.`, ODbL-1.0 link, exact query/response,
and reproducible-build/database-offer metadata.

## Association accounting

The deterministic normalizer reports:

| Metric | Count |
| --- | ---: |
| Observations | 236 |
| Accepted tenant-building links | 164 |
| Metadata-only links | 0 |
| Ambiguous links | 0 |
| Rejected links | 72 |
| Accepted storefront placements | 8 |
| Metadata-only storefronts | 144 |
| Ambiguous storefronts | 12 |
| Unknown storefronts | 72 |
| Rejected or unmatched | 72 |
| OSM elements | 100 |

Only `storefront-exact` (7) and `storefront-high` (1) placements become
neutral text signs and close-range pick proxies; the release limits both to 32
and records 8 actual entries. Names, raw values, source IDs, evidence IDs,
confidence, placement reasons, source/status dates, and licence partition are
retained in `commercial-frontage.json`. A source-listed licence or mapping
observation is not rendered as “open now.”

## Blender and package evidence

Blender MCP was confirmed at pin
`3ab892510cc0e5435ba5e611c01fb1021fbde8de`, loopback `127.0.0.1:9876`,
Blender `5.2.0`, telemetry disabled, and optional PolyHaven/Sketchfab/
Hyper3D/Hunyuan providers disabled. The existing scene/file was not modified;
rollback copies and all checkpoints are under
`/tmp/udt-stage3-commercial-20260805/blender/`.

The disposable source scene authored all 14 canonical buildings at LOD0/LOD1,
exported exactly 28 GLBs, and passed clean-scene MCP reimport. Reimport report:
`/tmp/udt-stage3-commercial-20260805/blender/reimport.json`. The 28 assets
contain 28,288 total triangles (maximum 6,648), maximum six materials per
asset, zero textures, and 2,457,444 total bytes. ESB LOD0 ends at `442.600006 m`
and ESB LOD1 preserves the OTI roof at `377.583282 m`; this intentionally keeps
the roof/pinnacle observations distinct. Fixed renders were saved and inspected
at `/tmp/udt-stage3-commercial-20260805/renders/`:

```text
01_ne_block.png  02_sw_block.png  03_esb_close.png  04_herald_close.png
05_33rd_frontage.png  06_34th_frontage.png  07_fifth_frontage.png
08_west_herald_edge.png
```

QA cameras/lights are not exported. No external texture, font, image, logo, or
provider asset is present.

## Runtime and browser evidence

`src/runtime/exterior-pilot-release.ts` validates exact membership, source and
licence partitions, base compatibility, all 28 local GLB hashes, and
component-scoped fallback. Cesium remains WGS84/pick authority; the overlay
adds up to 14 model entities and up to 8 accepted storefront proxies, with
LOD0/LOD1/procedural transitions and canonical `doitt:` IDs. The details panel
shows claim level, source IDs, BIN/BBL, dates, confidence, reasons, ODbL
attribution, active LOD, and asset hash; overlay/base/commercial/storefront
state persists in URL navigation.

The final production-preview evidence is under
`/tmp/udt-stage3-commercial-20260805/browser-final/` and was captured against
the local Vite preview on `127.0.0.1:4175`:

| Evidence | Result |
| --- | --- |
| `01-overview.png`, `02-block.png` and snapshots | Overlay loaded: 14 buildings, 28 LODs, 8 accepted signs; ODbL attribution visible |
| `03-esb.png` and `04-herald.png` | ESB/Herald details show licensed-near-real claim, exact OTI identity, active LOD, hash and source evidence |
| `picks/pick-final-<id>.json` and `14-pick-matrix.tsv` | Machine snapshots cover all 14 exact IDs: `39969`, `102705`, `131170`, `147902`, `262867`, `460555`, `498980`, `502491`, `584049`, `778052`, `812702`, `835659`, `925937`, `982383` |
| `05-frame-probe.json` | 658 samples; median `8.9 ms`, p95 `25.8 ms`, max `34.3 ms` at the measured desktop preview surface |
| `06-mobile.png`, `08-mobile-building.png`, `08-mobile-dimensions.json` | iPhone 12 emulation; CSS width/client width `390`, selected ESB and ordinary estimated building details visible |
| `09-console-final.json`, `09-network-final.json` | Zero console messages; 1,340 requests observed with zero external hosts (app origin only) |
| `14-deeplink-storefront-canonical.json`, `15-back.json`, `16-forward.json`, `17-reload.json` | Canonical `storefront=` deep link, browser back/forward and reload URL/detail persistence demonstrated |
| `10-close.png`, `07-mobile-closed.png` | Details close and mobile layout captures; mobile physical screenshots exhibit the browser's DPR-3 duplication artifact, while DOM dimensions remain bounded |

The final browser evidence is deliberately split into demonstrated and unmet
journeys. Demonstrated journeys include the 14 machine-readable building picks,
desktop ESB/Herald/ordinary details, canonical storefront deep link with
back/forward/reload, mobile dimensions and keyboard focus (`Close details` then
`Save place locally`), local-only network, zero console messages, and the
measured desktop frame probe. The following exact mandatory journeys remain
unmet and are not inferred from unit tests: direct canvas click proof for every
accepted storefront proxy (the proxies are implemented and unit-tested, but
Orca canvas coordinate dispatch could not produce a deterministic selected
storefront capture), injected browser fault interception for tenant/placement,
ODbL, GLB and base-release failures, and reduced-motion media emulation (the
requested Orca setting did not make `matchMedia('(prefers-reduced-motion:
reduce)').matches` true). The mobile screenshot DPR artifact and the absence
of a separately provisioned 1440x900 browser viewport are also recorded as
capture limitations; there is no claim that these gaps passed the product gate.

## Root-review repair follow-up

The review follow-up keeps the map canvas unobscured by folding the exterior
status into the existing compact `runtime-note`. The note reports the Block 835
count and accepted sign count, exposes visible `Map data © OpenStreetMap
contributors.` attribution as a link, and leaves the detailed ODbL/source,
identity, uncertainty, date, hash, and claim information in the inspector/Data
surface. The superseded permanent exterior overlay card is no longer rendered;
Diagnostics, Directions, Layers, POI, civic facets, and the inspector retain
their existing surfaces and now close competing expandable controls when
opened. POI filters use a compact lane above the civic-facet lane so the two
filter surfaces remain independently readable at both viewport sizes.

Fresh transient Orca captures were inspected after the repair. The available
desktop browser surface was CSS `1097 × 899`, DPR 2 (the Orca browser could not
provision a separate `1440 × 900` surface), and the overview-closed DOM record
was: runtime `(110,78)-(342.4,128.5)`, Camera `(589.3,78)-(927.8,178)`,
Diagnostics `(110,138)-(286.3,178)`, Layers `(948.4,190)-(1079,228)`, POI
filters `(957.4,742)-(1079,785)`, civic facets `(712.3,794)-(1079,837)`, and
Directions `(110,745)-(310.2,785)`. ESB, Herald, and ordinary selected captures
kept the runtime note at `(110,78)-(342.4,128.5)` and Camera at
`(429,78)-(747.9,178)` beside the right inspector `(756.9,60)-(1097,855)`;
the machine pairwise intersection check across all eight overlay surfaces
returned no collisions.

Fresh iPhone 12 emulation measured CSS `390 × 844`, DPR 3. With the inspector
closed, runtime was `(18,78)-(244.4,124.5)`, Layers `(259.5,78)-(372,112)`,
Camera `(12,146)-(378,182)`, Diagnostics `(18,220)-(172.6,256)`, POI filters
`(250.4,693)-(372,736)`, civic facets `(18,745)-(372,788)`, and Directions
`(18,700)-(194.4,736)`. With the inspector open, it occupied the bottom sheet
`(0,373.3)-(390,806)`; POI filters moved to `(250.4,260.3)-(372,303.3)` and
civic facets to `(18,312.3)-(372,355.3)`, while Camera, Directions, and the
compact status controls remained outside it. Opening Layers then Diagnostics,
and opening Directions, also returned no pairwise intersections across the
same eight surfaces.
The mobile physical screenshot is duplicated vertically by the browser's DPR-3
capture tool, so only the first CSS viewport is interpreted visually and the
DOM measurements are the authoritative layout evidence.

Selection framing now resolves the verified exterior entry and its full authored
bound height before focusing. The camera is placed behind the WGS84 target along
the opposite of the 35° three-quarter heading (`pitch=-35°`), rather than at the
target point itself; the selected asset remains on its highest verified LOD
while the camera is outside the full bounds. Fresh selected URLs recorded
ESB at `height=977`, `lon=-73.993852`, `lat=40.738315`, Herald at
`height=359`, `lon=-73.990480`, `lat=40.745485`, and ordinary `doitt:39969`
at `height=240`, `lon=-73.988482`, `lat=40.746417`, all with heading 35° and
pitch -35°. The inspected ESB frame visibly includes the pinnacle silhouette
and selected label; Herald and ordinary frames show their exterior model
silhouettes with three-quarter surrounding context. The selected inspector now
reports the same highest verified LOD used by the selected render.

Direct deep-link selection, browser back to the closed overview, forward to the
ESB inspector, and reload all preserved the exterior/commercial query and exact
`doitt:778052` identity. The rebuilt local preview at `127.0.0.1:4175` returned
zero console messages and its network host set was exactly `127.0.0.1:4175`;
the development server's Vite/React informational messages are not evidence
of a production zero-console result. A fresh 3-second desktop frame probe
returned 118 samples with median `9.7 ms`, p95 `33.4 ms`, and no horizontal
overflow (`scrollWidth=clientWidth=1097`), satisfying the median ≤33.3 ms and
p95 ≤50 ms thresholds. The remaining unmet journeys are unchanged:
accepted storefront canvas-click proof, injected fault interception,
reduced-motion media emulation, and a separately provisioned 1440 × 900
viewport; none is claimed as passed.

### Private-repository commit inventory (authorized; not performed by this worker)

The separately authorized private-repository commit task must force-add these
ignored runtime inputs because repository-wide patterns currently hide them
(do not change `.gitignore`):

```text
public/data/manhattan-esb-block-exterior-pilot-20260805
data/raw/manhattan-esb-block-commercial-20260805
```

Without those two force-add operations, a clean clone loses the published
runtime release and raw-lineage validation inputs. The raw root remains subject
to the source/licence policy check; if that policy does not permit raw
inclusion, report the inconsistency instead of guessing. Intended Stage 3
implementation inputs are the Stage 3 source/runtime/data/assets/scripts and
implementation/decision records already enumerated by the coordinator, plus
the review-repair edits in `src/app/App.tsx`,
`src/features/explorer/CesiumViewport.tsx`,
`src/features/explorer/CesiumViewport.test.ts`, and `src/styles.css`.
`docs/research/MANHATTAN_TRANSIT_RESEARCH.md` and `artifacts/**` remain
protected user-owned paths and are excluded from that inventory; prior release
roots, dependencies, lockfile, CI, MCP configuration, and Blender assets are
also excluded.

## Automated validation

The pre-repair executable loop is recorded in
`/tmp/udt-stage3-commercial-20260805/final-command-transcript.txt` with
per-command logs alongside it. The root-review repair re-run after the final
source/style mutation passed with:

```text
12 files / 56 tests: commercial frontage, raw lineage, exterior release/assets/
composition, runtime fallback, offline/source registry, Cesium, and App tests
```

The full suite passed (`37 files / 206 tests`) and the focused loop passed
(`12 files / 56 tests`). The raw and coverage validators, staged/public
exterior validators and benchmarks, citywide validator/benchmark, civic
validator/benchmark, typecheck, lint, and build all passed; Vite emitted only
its existing large-JavaScript advisory (>500 KiB). Blender clean reimport is
recorded at `/tmp/udt-stage3-commercial-20260805/blender/reimport.json`, all
eight fixed renders are under
`/tmp/udt-stage3-commercial-20260805/renders/`, and the earlier browser final
evidence is under `/tmp/udt-stage3-commercial-20260805/browser-final/`; the
fresh repair captures were inspected transiently in Orca because its screenshot
command has no output-path option.

## Protected state and final checklist

Protected hashes recorded before implementation and required unchanged after:

```text
citywide manifest   acb5a9b52014f86535c8478e7d4e516efc03f6dff95c17e9896dfea4413c203c
civic manifest      225aba4efb041b26c38932b265f927373ec8974f0fb4a5e63e34baefd07da2a2
landmark manifest   41fd7e909fc82c5910308da1955ed9f81cc84902fb338224b1a2cf8cce0604e1
ESB LOD0            1062622b08d456d2011b744da83dd6d6ccfda399f0a8e5635436cea6ed2a4d80
ESB LOD1            ccbd194969405a2bfdff734e089de8528ef7c382729c459c570e64823ba39511
Flatiron LOD0       89ea83cff781dc52bdd853fb855c7fa61c0617442429c4334e2ad5b42c602db2
Flatiron LOD1       7a7c2c7467966d8ca77e4fb0a7ffad73418fcd0ae19a7ea5d2e38fb6aac5e38c
TR birthplace LOD0  70723b90da12a30fdbc5306897ba957ab439178a6ce51d819edf1c656422ae01
TR birthplace LOD1  3d76db1a843ebf59bb62499591d86e44daa0c023e904955d118be060008f2a32
```

Pre-existing `docs/research/MANHATTAN_TRANSIT_RESEARCH.md` and `artifacts/**`
remain user-owned and are not part of Stage 3. Dependencies, lockfile, CI,
deployment, credentials, MCP configuration, prior release roots, and existing
blend/assets remain untouched.

Final status is intentionally evidence-based:

- [x] Approval IDs, exact 14-ID predicate, source hashes, partition policy, and claim ceiling recorded.
- [x] Raw/normalized manifests, Overpass failure/retry/success lineage, and deterministic replay recorded.
- [x] Exact 14 identities, duplicate-BBL preservation, 28 GLBs, eight renders, and clean reimport recorded.
- [x] ODbL attribution/offer metadata, neutral text policy, and unknown/ambiguous accounting recorded.
- [x] Runtime URL/loader, exact-ID composition, LOD/fallback, provenance, and storefront limits implemented and unit-tested.
- [x] Final post-documentation focused/full/validator/typecheck/lint/build command transcript appended after the last mutation.
- [ ] All nine fresh Orca journeys are complete: building picks, details/LOD, deep links, mobile/accessibility, local-only network, and performance are demonstrated, but accepted-proxy click and injected-fault captures remain unavailable.
- [x] Protected hashes and protected dirty paths were rechecked unchanged; no dependency/lockfile/deployment/CI/MCP config change or external publication occurred. Implementation and review/fix workers did not stage, commit, or push; this separately authorized release task stages, commits, and pushes only to the private repository under `codex-user-turn:2026-08-06:stage3-private-repo-commit-push-approval`, while public deployment/conveyance remains excluded.

The local-runtime Stage 3 implementation is validated as an evidence-backed
release, while the explicit browser proxy/fault/reduced-motion capture gaps
remain mandatory limitations; it is not a fully complete product gate. The
executable tests, assets, source partitions, hashes, local-only network, and
measured frame probe pass. No procedural or licensed claim was substituted for
those missing journeys.
