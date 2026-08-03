# Blender MCP research

Date: 2026-08-03

## Local environment

- Blender 5.2.0 LTS is installed at `/Applications/Blender.app`.
- Codex supports project-scoped MCP configuration through `.codex/config.toml`
  for trusted projects, as well as `codex mcp add` for shared host config.
- No Blender MCP is currently configured.
- `uv` and `uvx` are not currently available on the shell path.

## Leading candidates

### `ahujasid/blender-mcp`

- Repository: <https://github.com/ahujasid/blender-mcp>
- MIT licensed, widely adopted, active as of 2026-07-29.
- Supports scene inspection, screenshots, object and material operations,
  external asset services, and arbitrary Blender Python execution.
- Requires a Blender add-on plus an MCP process, commonly launched through
  `uvx blender-mcp`.
- The repository states Blender 3.0 or newer, but this investigation found no
  explicit Blender 5.2 compatibility guarantee.

Security gate: the MCP intentionally accepts arbitrary Python and executes it
inside Blender. Public issue #207 documents that this grants access beyond the
Blender scene to the host operating system. This is powerful enough for city
generation but must be treated as trusted-code execution, not a low-risk design
tool.

### `djeada/blender-mcp-server`

- Repository: <https://github.com/djeada/blender-mcp-server>
- MIT licensed, smaller project, active as of 2026-06-21.
- Exposes structured tools for scenes, objects, materials, rendering, export,
  history, and jobs.
- Also exposes synchronous and asynchronous arbitrary Python execution, so it
  does not remove the core host-code-execution risk.
- Provides explicit Codex registration instructions and can export glTF/GLB.

## Recommendation

Use a pinned revision of `ahujasid/blender-mcp` only after explicit approval,
because it has the strongest adoption and matches the reference workflow. Apply
these controls:

1. Bind the Blender bridge to localhost only.
2. Disable optional external asset/generation integrations initially.
3. Use project-scoped Codex MCP configuration with tool approvals set to prompt.
4. Keep Blender work in a dedicated project directory and save versioned `.blend`
   checkpoints before material operations.
5. Review generated Python before execution when the MCP client exposes it.
6. Pin the MCP package or source revision; do not execute a floating latest build
   in repeatable pipelines.
7. Treat any downloaded `.blend`, model, texture, script, or web content as
   untrusted input.

## Approval required

Installing this MCP changes the local Blender application and enables arbitrary
code execution in its process. Do not install or register it until the user
accepts this risk and chooses whether to use the recommended community server or
a constrained fork with arbitrary-code tools removed.

## Handoff contract (implementation-ready, provider-neutral)

Blender MCP is not installed, configured, invoked, or simulated by this
repository. An approved export may enter the existing Cesium runtime only by
passing `src/runtime/city-asset-manifest.ts` validation and the local immutable
asset package replay. A failed validation or integrity replay keeps the current
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
possible authoring path, not a runtime dependency. Installation and execution
remain approval-gated because the researched MCP servers expose trusted Python
execution in the Blender host.
