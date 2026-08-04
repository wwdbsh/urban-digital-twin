# Blender MCP research

Date: 2026-08-04

## Current asset-wave status (2026-08-04)

The later protected landmark wave completed the bounded-pilot asset package:
Flatiron Building, Empire State Building, and Theodore Roosevelt Birthplace,
with two GLB LODs each and a manifest. The seven candidate runtime files under
`public/assets/landmarks/landmark-wave-20260804/` are immutable for this
documentation catch-up; their expected SHA-256 values are recorded in the
[implementation record](../codex/MANHATTAN_CITYWIDE_FOUNDATION_IMPLEMENTATION.md)
and the asset-wave research note. Do not open, regenerate, edit, or export
those files here. They are not activated by citywide mode; ordinary and
citywide buildings remain procedural footprint massing.

Blender MCP was not needed for this documentation/civic-data-free work unit.
Future asset authoring, inspection, or export must use the connected Blender
MCP gate and remain a separate work unit.

## Local environment

- Blender 5.2.0 LTS is installed at `/Applications/Blender.app`.
- Codex's available configuration is user-level
  `/Users/sangheonlee/.codex/config.toml`; it now contains one minimal,
  project-scoped-by-`cwd` Blender entry and preserves all previous settings.
- `uv` 0.12.1 is installed at `/opt/homebrew/bin/uv`; `uvx` resolves to the
  same Homebrew installation.
- The exact installation record, source checksums, validation transcript,
  threat model, and rollback procedure are in
  `docs/decisions/0011-blender-mcp-install-and-threat-model.md`.

## Leading candidates

### `ahujasid/blender-mcp` (installed exact pin)

- Repository: <https://github.com/ahujasid/blender-mcp>
- MIT licensed; the reviewed upstream head is
  `3ab892510cc0e5435ba5e611c01fb1021fbde8de` (2026-08-03). No stable tag or
  release was found, so the source SHA is pinned rather than using `main`.
- Supports scene inspection, screenshots, object and material operations,
  external asset services, and arbitrary Blender Python execution.
- Requires a Blender add-on plus an MCP stdio process, launched here through
  `uvx --python 3.11 --from git+...@<SHA> blender-mcp`.
- The repository states Blender 3.0 or newer. Blender 5.2.0 LTS was verified
  locally through its executable, and the pinned addon connected successfully
  in a disposable default scene; upstream does not make a Blender 5.2-specific
  compatibility guarantee.

Security gate: the MCP intentionally accepts arbitrary Python and executes it
inside Blender. Upstream issue #202 demonstrates a path where a tool can read a
local file and send its contents to a remote provider; this confirms that the
bridge must be treated as trusted-code execution with host-file and network
risk, not as a low-risk design tool. Telemetry is explicitly disabled and all
optional asset/provider integrations are disabled, but those controls do not
remove arbitrary Python risk.

### `djeada/blender-mcp-server`

- Repository: <https://github.com/djeada/blender-mcp-server>
- MIT licensed, smaller project, active as of 2026-06-21.
- Exposes structured tools for scenes, objects, materials, rendering, export,
  history, and jobs.
- Also exposes synchronous and asynchronous arbitrary Python execution, so it
  does not remove the core host-code-execution risk.
- Provides explicit Codex registration instructions and can export glTF/GLB.

## Installation and controls

The user approved installation on 2026-08-04. The installed addon lives at
`/Users/sangheonlee/Library/Application Support/Blender/5.2/scripts/addons/blender_mcp_pinned/__init__.py`,
and the MCP command is configured in the user's Codex config with
`BLENDER_HOST=127.0.0.1`, `BLENDER_PORT=9876`, and
`DISABLE_TELEMETRY=true`. The running Blender listener was observed as
`127.0.0.1:9876` only, and fresh MCP initialize, scene inspection, temporary
cube create/inspect/delete, and scene restoration all passed.

Continue to apply these controls:

1. Bind the Blender bridge to localhost only.
2. Disable optional external asset/generation integrations initially.
3. Use the reviewed source SHA and the dedicated user-level addon directory;
   start a fresh Codex/Luna session when discovery is needed.
4. Keep Blender work in a dedicated disposable directory and save versioned `.blend`
   checkpoints before material operations.
5. Review generated Python before execution when the MCP client exposes it.
6. Pin the MCP package or source revision; do not execute a floating latest build
   in repeatable pipelines.
7. Treat any downloaded `.blend`, model, texture, script, or web content as
   untrusted input.

At the installation checkpoint no Manhattan assets had been authored and no
provider/API/credentialed service had been called. The later protected
landmark wave supersedes only that asset-status statement; installation remains
reversible, and any future real asset generation remains approval-gated and
must preserve source provenance and uncertainty.

## Handoff contract (implementation-ready, provider-neutral)

Blender MCP is installed outside this repository as an optional authoring tool;
it is not a runtime dependency. The protected landmark wave is an approved
bounded-pilot export; any later export may enter the existing Cesium runtime
only by passing
`src/runtime/city-asset-manifest.ts` validation and the local immutable asset
package replay. A failed validation or integrity replay keeps the current
Cesium procedural geometry and reports a diagnostic.

Each approved feature entry must preserve its canonical feature ID exactly; the
ID is the join key for picking, URLs, search, catalogs, and asset diagnostics.
The lineage must include source registry IDs, source-reference IDs, license
reference IDs, and human-readable attribution. Capture, authoring, update, and
review timestamps are required. A production claim requires `fixtureOnly:false`,
approval `approved`, and scope `runtime`; fixtures are explicitly
`fixtureOnly:true`, `approved`, and `test-only`.

Geometry handoff rules:

- Export GLB (preferred) or glTF only, with one immutable relative POSIX content
  reference per LOD. URL, absolute, traversal, backslash, duplicate, and
  unsupported-extension references are refused. Record exact SHA-256 and byte
  size; a metadata-only fixture is allowed only as a non-runtime placeholder.
- Author in meters with a right-handed Blender Z-up scene. The manifest transform
  maps local coordinates to ENU: local +X east, +Y north, +Z up, origin at the
  WGS84 longitude/latitude/height anchor. Heading is clockwise from true north.
  The manifest stores a finite row-major affine 4x4 matrix; its final row must
  be `[0,0,0,1]`, and singular or unreasonable transforms are rejected.
- Name the exported object/collection with the canonical feature ID, then the
  LOD ID (`<canonicalFeatureId>__lod_<id>`). Do not encode a second identity in
  the model. Keep the anchor at the documented origin and report local min/max
  bounds in meters.
- Export ordered LOD variants with geometric error and both max distance and max
  screen-space-error selection semantics. Near-to-far ordering is deterministic;
  every LOD has its own checksum and byte size.
- Record triangle, material, and texture counts plus hard budgets. Accessibility,
  collision, and picking-proxy fields may be present only when the export
  actually provides them; never infer these properties from visual appearance.
  Include explicit quality and uncertainty notes.

The handoff validator is deliberately provider-neutral: Blender MCP is one
possible authoring path, not a runtime dependency. Future authoring remains
subject to source/license approval because the MCP exposes trusted Python
execution in the Blender host.
