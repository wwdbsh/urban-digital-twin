# Decision 0015: compose the civic context over the citywide release at runtime

Date: 2026-08-05 (Asia/Seoul)
Status: Root Sol High review accepted; delivery authorized

## Decision

Keep `manhattan-civic-context-20260804` as the canonical civic URL and compose
its validated `baseReleaseId` at runtime with the existing immutable
`manhattan-citywide-20260804` release. The composition is a provider-neutral
adapter seam: it owns one camera generation/abort path, one aggregate request
budget, one bounded cache, collision-checked feature identity, mixed search,
and exact detail dispatch, while the existing citywide and civic adapters keep
their release-specific decoding and provenance behavior.

The civic manifest remains the authority for the base relationship:

```text
context: manhattan-civic-context-20260804
context.baseReleaseId: manhattan-citywide-20260804
loaded base: manhattan-citywide-20260804
```

No composed manifest, release directory, provider, dependency, asset, Blender
state, or URL parameter was added. Standalone citywide, bounded-pilot, fixture,
and legacy URLs remain separate modes. A selected feature carries its own
origin release, so a citywide building remains citywide in details, search,
picking, deep links, history, share links, and local bookmarks.

## Immutable evidence

The two manifests are unchanged and remain checksum-pinned:

```text
acb5a9b52014f86535c8478e7d4e516efc03f6dff95c17e9896dfea4413c203c  public/data/manhattan-citywide-20260804/manifest.json
225aba4efb041b26c38932b265f927373ec8974f0fb4a5e63e34baefd07da2a2  public/data/manhattan-civic-context-20260804/manifest.json
```

The citywide manifest declares 45,194 building parents and 12,439 restaurant
parents across 103 geometry, 214 search, and 134 detail shards. The civic
manifest declares 38 statistical areas, 395 Parks parents, and 1,140 LPC
parents (1,130 placed parts) across 114 geometry, 307 search, and 52 detail
shards; its declared base pin is exact.

## Runtime budgets and truth boundary

The composition uses a shared maximum of 4 active shard requests and one
24-entry/48 MiB cache (`50,331,648` bytes). Rendering selects independent
deterministic groups of at most 6,000 citywide base features and 128 civic
context parts; only the active selection may be retained outside its group
bulk cap. Base primitives are created before context geometry and selected
feedback is created last. Layer toggles filter both semantic and dense groups,
and ambiguous IDs are omitted from the pick map or rejected as collisions.

The citywide layer is procedural footprint/height massing. It is not real
facade imagery, textures, roofs, interiors, entrances, or a photorealistic
model. Civic statistical, Parks, and LPC records remain source-backed
geometries/markers and metadata; bounded-pilot GLB assets are inactive in the
composition.

## Validation boundary

Focused and full automated checks, typecheck, lint, build, citywide and civic
validators/benchmarks, immutable hashes, protected-path review, and fresh Orca
desktop/mobile/fault journeys are recorded in
[`MANHATTAN_CIVIC_RUNTIME_COMPOSITION_IMPLEMENTATION.md`](../codex/MANHATTAN_CIVIC_RUNTIME_COMPOSITION_IMPLEMENTATION.md).
The current browser frame probe at 1440×900 measured 1,158 samples after a
3-second settle: median 8.3 ms and p95 10.3 ms. Browser evidence summaries are
also retained under `/tmp/urban-digital-twin-composition-browser-evidence.md`.

## Rollback

Return only this work unit's edits to baseline
`77aab1a3835c22ff314ba824a9b5893535148984`; preserve the pre-existing
`docs/research/MANHATTAN_TRANSIT_RESEARCH.md` edit and `artifacts/**`. Never
delete or overwrite either immutable release. Root Sol High accepted the
implementation and authorized the one-commit delivery on `main` after the
final focused checks.
