# Block 835 generative exterior completion and canary implementation

Date: 2026-08-11 (Asia/Seoul)

Package: `manhattan-esb-block-reference-20260811`

Canary release graph: `manhattan-exterior-cells-20260811`

Decision record: [ADR 0027](../decisions/0027-block835-generative-exterior-canary.md)

Source of truth: the pinned pilot release
`manhattan-esb-block-exterior-pilot-20260805`
(`release.json` SHA-256 `4a84ddbb5b46dcc5ad84fc618922cc2c2225f9a86ee0373e9f3cec4246d1b38a`).
No pinned byte was modified, no external source was contacted, and the frozen
`manhattan-esb-block-reference-20260810` package was not edited.

This wave implements the two binding user decisions recorded on the T008 Issue:
generative completion of the five previously-`absent` component kinds
(Decision A), and a broadened `jh45-qr5r` conveyance envelope with public
deployment still excluded (Decision B). See ADR 0027.

## Pipeline

Driven by
[`scripts/block835-successor-plan-cli.mjs`](../../scripts/block835-successor-plan-cli.mjs),
a sibling of the 20260810 CLI with the same command surface.

| Command | Output |
| --- | --- |
| `plans` | 14 canonical V2 facade plans + plan index under `data/manhattan-esb-block-reference-20260811/plans/` |
| `authoring` | Per-building Blender inputs (plan path, ENU frame, tessellation constants) |
| `measurements` | Promotes Blender silhouette evidence to the committed build input |
| `evidence` | Commits the hashed Blender evidence inventory alongside the plans |
| `build` | Manifest, ownership ledger, registration report and `private/` content |
| `registration` / `determinism` | The two release gates |

### V2 grammar

`src/domain/deterministic-facade-generator-v2.ts` is a **sibling** of the V1
generator, not a revision of it. V1 stays byte-frozen: `ABSENT_KINDS`,
`buildInventory` and the V1 canonicality guard are unchanged, and the 20260810
drift test still passes. V2 declares its own identity — schema version `2.0`,
generator id `urban-digital-twin:deterministic-facade-plan-v2`, version `2.0.0`
— and its own uncertainty constants. ADR 0027 Decision 1 gives the reasoning.

All fifteen `REQUIRED_EXTERIOR_COMPONENT_KINDS` are `generated`. `absent` is not
expressible in V2 at all. The plan index confirms 15 components at truth tier
`generated` for all 14 buildings.

The grammar adds, over V1:

- **Stepped massing tiers.** `tierCount` is always ≥ 2 and scales 2..5 with
  floor count, so setbacks are always real geometry.
- **Setback decks.** A deck surface at every tier boundary.
- **Balconies and fire escapes.** Facade-attached protrusions on a floor
  interval.
- **Signage.** A blank sign band plus a blade sign massing.
- **Water tanks.** A rooftop even-sided prism on four leg prisms. Prisms are a
  new plan concept; the even side count makes the caps decompose into quads for
  the quad-only canonical GLB writer.

Two uncertainty statements travel verbatim on every plan and every shipped
asset:

- `DETERMINISTIC_FACADE_V2_UNCERTAINTY` — "Procedurally generated complete
  exterior in local millimetres. Every component is generated from footprint and
  height constraints only; it does not assert real-world facade, setback,
  balcony, fire-escape, water-tank or signage accuracy, nor any tenant, brand or
  text."
- `DETERMINISTIC_FACADE_V2_SIGNAGE_UNCERTAINTY` — "Generated blank sign-band and
  blade massing only. No real-world sign presence, size, position, orientation,
  text, brand or tenant is asserted, and no glyph, logo or lettering is
  generated."

The signage rule is structural: no glyph, logo, lettering or texture is emitted
anywhere, and the package is texture-free by construction.

### Package

`audience: "private"`, one cell `cell:manhattan:block-835` owning all 14
buildings, one tileset artifact plus 28 GLBs.

| Property | Value |
| --- | --- |
| Assets | 14 |
| Artifacts | 29 |
| `declaredTotalBytes` | 3,588,230 |
| Assembly fingerprint | `6155a41de1d5f42a5a512d0efc8dedcc14b1fe6cb34bfb00269152e996b5a0f5` |
| Base identity checksum | `98a7c50abc157fb4f2e52f23e2a129274b7273cace496929406bbbff448a8dfa` |
| Ownership ledger checksum | `a99e3773c1c0cc5df50a2480a9a46e7f4ca446fd8aec1187d86c481167fbd3fe` |

Evidence shard ids are truthful per-building ids,
`evidence-shard:manhattan-esb-block-reference-20260811:<buildingId>`, replacing
the 20260810 `evidence-shard:none:` sentinel. No asset carries the
`evidence-backed` tier; the shards record the rights basis, not admitted
imagery.

Supersession is by pins only. `cells[0].predecessor` is the 20260810
cell-release pin, and each asset's `predecessor` is that building's 20260810
`lod_0` artifact pin. The 20260810 package is not edited.

Shipped GLBs are +Y up via `toGltfYUp`, reused unchanged from the 20260810
pipeline (ADR 0026 Decision 5).

### LOD 1 composition

`lod_1` keeps the massing envelope **and every protruding component** —
balconies, fire escapes, sign band, blade sign, roof equipment, water-tank
prisms — and drops **only** recesses (windows, entrances, storefronts) and flush
cornice trim.

Only a strict protrusion can change a projected silhouette: a recess is inside
the envelope and a flush band is on it. That is why measured deviation is
exactly **0.0** even though V2 adds many new components, and it is how the 2 %
bound is satisfied without weakening the gate.

## Per-asset results

Horizontal deviation is the worst corner offset of the exported massing from the
source-derived oriented rectangle; vertical is roof plane against sourced
`heightMeters`. Tolerances are 250 mm and 500 mm.

| Building | LOD0 tris | LOD1 tris | Placements | Source height (m) | Exported roof (m) | Δ horiz (mm) | Δ vert (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `doitt:102705` | 814 | 278 | 59 | 14.79 | 14.79 | 0.31 | 2.2 |
| `doitt:131170` | 12720 | 1796 | 1010 | 99.22 | 99.23 | 0.45 | 10.5 |
| `doitt:147902` | 1714 | 354 | 131 | 22.82 | 22.82 | 0.60 | 0.7 |
| `doitt:262867` | 382 | 166 | 27 | 8.17 | 8.17 | 0.22 | 0.3 |
| `doitt:39969` | 1422 | 406 | 104 | 23.50 | 23.50 | 0.91 | 2.0 |
| `doitt:460555` | 1162 | 306 | 85 | 21.89 | 21.89 | 0.53 | 3.3 |
| `doitt:498980` | 758 | 266 | 53 | 17.61 | 17.61 | 0.13 | 0.2 |
| `doitt:502491` | 758 | 266 | 53 | 19.37 | 19.37 | 0.69 | 0.0 |
| `doitt:584049` | 1438 | 330 | 108 | 23.34 | 23.34 | 0.54 | 1.6 |
| `doitt:778052` | 48792 | 7052 | 3879 | 377.58 | 377.58 | 0.28 | 3.3 |
| `doitt:812702` | 758 | 266 | 53 | 16.86 | 16.86 | 0.22 | 0.4 |
| `doitt:835659` | 886 | 282 | 62 | 23.13 | 23.14 | 0.57 | 1.7 |
| `doitt:925937` | 758 | 266 | 53 | 16.26 | 16.26 | 0.42 | 1.1 |
| `doitt:982383` | 9580 | 1556 | 741 | 115.69 | 115.68 | 0.50 | 13.1 |

Worst case: **0.9 mm** horizontal, **13.1 mm** vertical, both inside tolerance.
Budgets are 75,000 triangles, 8 materials and 0 textures per asset. The heaviest
asset (`doitt:778052`, the Empire State Building) uses **48,792** triangles
against the 75,000 cap; every asset uses **7** materials at `lod_0` and 6 at
`lod_1`, against the cap of 8; texture count is **0** everywhere.

## Blender authoring and evidence

Blender MCP built a disposable metric Z-up ENU scene from the committed V2
plans, all 14 buildings authored in chunked `execute_blender_code` calls with a
checkpoint after each. Nothing was downloaded; Polyhaven, Sketchfab, Hyper3D and
Hunyuan were not used.

[`scripts/blender/block835_successor_author.py`](../../scripts/blender/block835_successor_author.py)
is a Python **transliteration** of `tessellateV2Plan`. Its agreement with the
TypeScript writer catches transcription and transport errors, but it is **not**
independent verification of the tessellation rules. The two genuinely
independent checks are the analytic volume identity and the up-axis-asserting
re-import diff.

**Watertightness.** For each of the 28 meshes the divergence-theorem volume was
compared against the analytic solid volume. All 28 are watertight, worst
relative volume deviation **1.36e-7**, all normals outward-consistent, **0**
degenerate faces. The tessellation intentionally leaves T-junctions where a
subdivided surface meets an unsubdivided neighbour, so the raw boundary-edge
count is non-zero; the volume identity is the closure proof, not the edge count.

**This check found a real defect.** The first authoring round reported
`doitt:262867` **not** watertight, with 1.50 % volume excess at `lod_0` and
1.42 % at `lod_1`. The cause was the blade sign: its v-extent overran its tier-0
facade, so the band decomposition emitted wall bands and phantom solid volume
*above* the facade. The root cause was that V2's validator was missing V1's
"Placement exceeds its surface bounds" guard, so an out-of-bounds placement was
accepted rather than rejected.

It was fixed two ways, deliberately both:

1. The successor grammar now clamps `bladeSignHeightMm` so the blade terminates
   below the tier cornice — the specific bug.
2. V2 gained `validateSurfaceContainmentAndOverlap`, which fails closed on any
   placement outside its surface or overlapping another — the class of bug.

After the fix all 28 meshes are watertight.

**Silhouette.** `lod_1` deviation was measured, not asserted: **112** fixed-view
512×512 orthographic Workbench renders across 4 compass views (`view:east`,
`view:north`, `view:south`, `view:west`) for both LODs of all 14 buildings,
alpha thresholded, ratio = symmetric-difference pixels over `lod_0` covered
pixels. Worst deviation across all 56 view comparisons is **0.0**. The minimum
`lod_0` covered area is **36,653** pixels, so the zero is a real match rather
than an empty render. Each measurement is bound to its plan hash in the
committed measurement file, and the builder refuses to run when a measurement's
plan hash does not match the plan it is building.

**Re-import diff.** All 28 shipped GLBs were imported back into Blender and
compared with the authored meshes: **191,064** vertices total, 28/28 exact,
identical vertex counts, identical unique-position sets, **0** mismatches, 0.0 m
bounds deviation. The comparison uses **raw** imported world coordinates with no
axis compensation, relying on Blender's own y-up-to-z-up import mapping to
recover ENU — so it **asserts** the +Y up axis. A z-up file fails it.

### Evidence inventory

Worktree-local and untracked, under
`artifacts/blender/manhattan-esb-block-reference-20260811/`:

| File | SHA-256 |
| --- | --- |
| `scene-inspection.json` | `69ad337f27ab412c608da3294b5b017c8a9dfc5a4f1f1f808a217c3c94206c14` |
| `silhouette-measurement.json` | `ac5d135ab7d1b5aca8e49d849f09a78c93b457dd360cd388c71e1b7567c3cec4` |
| `reimport-diff.json` | `dcc7ff6fa70e66cee3db18089e826bfeb50873a7c83590240a698405a49d870e` |
| `block835-successor-authoring.blend` | `1594a29e36395a2d9a513c4833b2dfde14be30d297090156b13df3fea44743d5` |

Plus `renders/` (112 silhouette PNGs and 2 viewport screenshots) and `inputs/`
(15 authoring input files). All **133** files are hashed in
`evidence-inventory.json`, which is committed to
[`data/manhattan-esb-block-reference-20260811/blender-evidence-inventory.json`](../../data/manhattan-esb-block-reference-20260811/blender-evidence-inventory.json)
so the hashes stay checkable after this untracked worktree tree is removed. The
inventory hashes every evidence file except itself. The committed copy is a
`stableSerialize` re-serialization, so its own bytes differ from the worktree
`evidence-inventory.json`; the 133 inner file hashes are the authoritative
artifact, not the digest of either container.

## Canary release graph and app wiring

`public/data/manhattan-exterior-cells-20260811/` carries the Block 835 snapshot
into a browser-reachable exterior cell release graph:

- `index.json` — `defaultHead` is the single Block 835 snapshot
  `snapshot:manhattan-exterior-cells-20260811:v1`
  (`18e1689e19264543d8aaacafe989769b5d74f04cf0f5ca9cfc6c5407632e0ae7`),
  `canaryHeads` is empty, `baseCompatibility.baseReleaseIds` is
  `["manhattan-citywide-20260804", "manhattan-civic-context-20260804"]`,
  `localOnly` is true and `runtimeExternalNetwork` is false.
- `release-graph.json` — one private root and one public root. The private root
  declares **exactly one** artifact, its 1,085-byte ownership-ledger blob
  (`aad95ee5d30c13348e0f864b9513eb8662a647c0bd0147ada4cfc7726c44bd7f`), with a
  matching single-entry `artifactAllowlist`. No `private/` directory exists
  under the release at all, so no private byte is browser-reachable. That
  count-of-one is the anti-leak invariant.
- The public root declares 31 artifacts: 1 ownership ledger, 1 cell release, 14
  inventory shards, 14 evidence shards and 1 rollout snapshot.
- `assemblies.json` — one assembly, `audience: "public"`, packageId
  `manhattan-esb-block-reference-20260811`, 29 artifacts (28 GLB + 1 tileset),
  14 assets, 3,588,230 declared bytes: the same content as the private package,
  re-rooted under `public/`.
- 60 files under `public/` — 28 GLB byte copies, the tileset, 14 inventory
  shards, 14 evidence shards, the cell release, the ownership ledger and the
  rollout snapshot.
- The 14 evidence shards each declare exactly 1 source
  (`source-ref:jh45-qr5r:<recordId>`), 1 license
  (`license:nyc.building-footprints`), 1 approval and `evidence: []`. The empty
  array is the honest statement: the shard records the rights basis, not
  admitted imagery.

Approval fingerprints are derived as
`sha256HexSync(stableSerialize({ scope, exclusions, approvedAt, approvalNote }))`,
which for `approval:manhattan-exterior-cells-20260811:public-canary` gives
`ec15715560f61045803a7401effd5f161a93bbce2c849163c0be158fe82dbafc`. Note that
`approvalNote` is not a field of the emitted approval object: it is the
build-time constant `BLOCK835_CANARY_APPROVAL_NOTE` in
`src/release/block835-canary-release.ts`, so the fingerprint is reproducible
from that module but not from `release-graph.json` alone. See ADR 0027
Decision 4.

App wiring: `PINNED_EXTERIOR_CELL_RELEASE_IDS` is
`["udt-fixture-exterior-cells", "manhattan-exterior-cells-20260811"]`, with
`isPinnedExteriorCellRelease` and `exteriorCellBasePath`;
`ExteriorStreamingUrlState` gained `releaseId`. An unknown id still fails closed
with the preserved "is not pinned by this build" message.
`src/runtime/exterior-cell-runtime.ts` and
`src/features/explorer/CesiumViewport.tsx` were **not** edited — both were
already generic over the release id.

The `jh45-qr5r` source envelope was broadened per Decision B: a dedicated
`generatedGeometryConveyanceDerivative` policy (so no other source moves with
it) plus a 2026-08-11 in-session user authorization recorded in `approvalNote`.
Redistribution covers generated geometry only, never the raw source dataset, and
public deployment remains excluded.

## Verification

| Gate | Result |
| --- | --- |
| `npx vitest run src/release/block835-successor-package.test.ts` | Pass, 7 tests |
| `npx vitest run src/release/block835-reference-package.test.ts` (20260810 drift) | Pass, 9 tests — the frozen package stays green |
| V2 generator focused tests | Pass, 6/6 |
| `npx eslint src/release/block835-successor-package.test.ts` | Pass, 0 problems |
| `npx tsc --noEmit -p tsconfig.app.json` | Pass for all changed files; 3 pre-existing `real-wave-20260804/restaurants.json` module errors unrelated to this task |
| `pnpm multi-lod:validate --require-texture-free` | Pass, 29 artifacts, `textureFreeEnforced` true |
| Registration gate | Pass, 0.9 mm horizontal / 13.1 mm vertical against 250 mm / 500 mm |
| Double-run byte determinism | Pass, 32 files byte-identical, identical fingerprint |
| Blender watertightness | Pass, 28/28 watertight, worst 1.36e-7 relative, 0 degenerate faces |
| Blender silhouette | Pass, worst deviation 0.0 across 56 view comparisons, min covered area 36,653 px |
| Blender re-import diff (asserts +Y up) | Pass, 28/28 exact, 191,064 vertices, 0 mismatches |
| Committed-package drift test | Pass, on-disk fingerprint and all 29 artifact checksums match a fresh build |
| Replay with `requireTextureFreeAssembly` | Pass, no issues |
| `npx vitest run src/runtime/block835-canary-runtime.test.ts` | Pass, 5 tests — the committed canary bytes driven through the real `ExteriorCellRuntime` |
| `npx vitest run src/app/exterior-base-identity.test.ts src/app/exterior-activation-ordering.test.tsx` | Pass, 7 tests — membership and clean-load activation ordering |
| `npx vitest run src/app/App.test.tsx` | Pass, 44 tests — includes the clean-load canary activation regression rendering `<App />` over the committed release bytes |
| **Renderer validation on a clean load — required gate** | Required for every release in this family. The canary deep link must reach rendered geometry in a browser on a **first** load, with no manual disable/enable toggle. All three defects below were found only here. |

### What the green suite did not prove

The committed suite was green — 536 to 549 tests through the whole wave — while
three defects made the canary render nothing in a browser. They are recorded
here because each is a durable rule for this family; ADR 0027 carries the same
three as Lessons.

**An emitter must re-root every pin.** Turning the private assembly manifest
into the public one rewrote `release.*`, `baseIdentitySet`, `ownershipLedger`
and the artifact refs, but copied `cells[].cellRelease` verbatim, so the public
assembly still pinned the private package. `validateMultiLodAssembly` and
`validateExteriorReleaseGraph` both passed it: each document was internally
consistent. The consumer was not — `assemblyForCell` in
`src/runtime/exterior-cell-runtime.ts` rejected it as `assembly-pin-mismatch`,
fell back to pinned-base, and rendered no geometry. When a manifest is rewritten
from one audience or release into another, every pin is in scope, and structural
validators agreeing is not the consumer accepting: the runtime is the authority,
so a release is not proven until its committed bytes have been driven through
the real runtime. `src/runtime/block835-canary-runtime.test.ts` now does exactly
that and fails on the pre-fix bytes.

**Base membership is release membership, not residency.** The app proved base
membership with `adapter.getFeature`, which only sees shards the camera has
already streamed. That is a residency question — camera- and load-order
dependent — so it answered false for all 14 Block 835 buildings whenever the
camera was elsewhere, and every cell failed `base-incompatible`. Membership now
comes from checksum-verified release data: `ensureIdentityIndex` /
`hasIdentityMember` on the citywide adapter, backed by the detail index (57,633
entries, all 14 Block 835 `doitt` ids present). The fixture path hid this
completely, because fixture adapters are fully resident and residency and
membership coincide there and only there.

**Activation ordering on a clean load.** `exteriorStreamingRequested` is
URL-derived and true on the first render, while the citywide adapter arrives
asynchronously; the activation effect captured `activeAdapterRef.current` and
carried no adapter in its dependency list, so it ran once against the
placeholder and never re-ran when the real adapter landed. Only a manual
disable/enable toggle recovered — which is precisely why a toggle does not
satisfy the renderer gate: re-running the effect by hand hides the defect the
gate exists to catch. The regression is now pinned against the real wiring by
the clean-load test in `src/app/App.test.tsx`, which renders `<App />`, lets the
base adapter arrive after the first activation attempt, serves the committed
canary bytes to the real exterior runtime, and asserts 14 verified assets reach
the renderer with no interaction; reverting either half of the fix turns it red.

## What this package does not claim

It does not show what these buildings look like. The grammar is **procedural**:
setbacks, balconies, fire escapes, water tanks and signage are generated from
footprint and height constraints alone. The massing is the minimum-area
**oriented bounding rectangle** of the DOITT footprint, not the footprint itself
(ADR 0026 Decision 3). Nothing here asserts real-world facade, setback, balcony,
fire-escape, water-tank or signage accuracy for any of the 14 buildings, and
there is **zero** text, glyph, logo, brand or tenant content anywhere in the
package.

Generating a component is not evidence that the real building has one, and the
20260810 package's statement that a component was *not generated* was never a
claim that the real building lacks it. Both packages remain honest about their
own grammar.

Passing every gate above proves pipeline determinism, geometric closure and
contract conformance — not architectural, material or visual accuracy.
