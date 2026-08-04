# Decision 0011: pinned local Blender MCP installation

Date: 2026-08-04 (Asia/Seoul)
Status: installed for local validation; protected landmark authoring is recorded
separately and this documentation task performs no asset work

> **Asset-wave note (2026-08-04):** The installation-only status below is
> historical. A later approved bounded-pilot wave authored and validated the
> three protected landmark GLB pairs plus manifest; the seven files are
> byte-immutable candidate deliverables. Blender MCP is not needed for this
> documentation catch-up and remains mandatory for any future asset authoring,
> inspection, or export.

## Decision

Install the upstream `ahujasid/blender-mcp` source at the exact reviewed commit
`3ab892510cc0e5435ba5e611c01fb1021fbde8de`. No stable release/tag was present in
the upstream `refs/tags` listing on 2026-08-04, so the floating `main` branch
and an unpinned `uvx blender-mcp` command are not used. The project remains
provider-neutral: this bridge is an optional local authoring tool and is not a
runtime dependency of the Cesium application.

Upstream sources, all checked 2026-08-04:

- Repository and README: <https://github.com/ahujasid/blender-mcp> and
  <https://raw.githubusercontent.com/ahujasid/blender-mcp/main/README.md>
- Exact source revision: <https://github.com/ahujasid/blender-mcp/commit/3ab892510cc0e5435ba5e611c01fb1021fbde8de>
- Package metadata and lockfile:
  <https://raw.githubusercontent.com/ahujasid/blender-mcp/3ab892510cc0e5435ba5e611c01fb1021fbde8de/pyproject.toml> and
  <https://raw.githubusercontent.com/ahujasid/blender-mcp/3ab892510cc0e5435ba5e611c01fb1021fbde8de/uv.lock>
- License: <https://raw.githubusercontent.com/ahujasid/blender-mcp/3ab892510cc0e5435ba5e611c01fb1021fbde8de/LICENSE>
- Upstream terms/telemetry: <https://raw.githubusercontent.com/ahujasid/blender-mcp/3ab892510cc0e5435ba5e611c01fb1021fbde8de/TERMS_AND_CONDITIONS.md>
- Upstream arbitrary-file/security report: <https://github.com/ahujasid/blender-mcp/issues/202>

## Reviewed upstream behavior

The repository is MIT licensed (copyright Siddharth Ahuja, 2025), and its
package metadata reports version `1.8.0`, Python `>=3.10`, `mcp[cli]>=1.3.0,<2`,
and `httpx>=0.27.0`. The `addon.py` socket server is installed inside Blender;
the `src/blender_mcp/server.py` process is an MCP stdio server that forwards
commands to that socket. The upstream README documents Blender 3.0+ and a
default `localhost:9876` bridge; this installation uses the reviewed Blender
5.2.0 LTS and sets the client-side host explicitly to `127.0.0.1`.

The addon exposes arbitrary Blender Python execution, scene inspection,
screenshots, object operations, and optional Poly Haven, Sketchfab, Hyper3D,
and Hunyuan3D integrations. Those integrations remain disabled and no API key,
provider account, asset download, or provider request was made. The upstream
README and terms describe telemetry; `DISABLE_TELEMETRY=true` is set, and no
telemetry consent was enabled. Arbitrary Python is still a trusted-code and
host-file-access capability: do not connect an untrusted MCP client, paste
unreviewed code, or open untrusted `.blend`/script inputs.

## Installation record

- Installed: 2026-08-04.
- Blender verified with `/Applications/Blender.app/Contents/MacOS/Blender
  --version`: Blender `5.2.0 LTS`, build hash `fbe6228777e7`, release build
  dated 2026-07-14.
- Installed `uv` with Homebrew: `brew install uv`; version `0.12.1`, binary
  `/opt/homebrew/bin/uv`, SHA-256
  `863fe76e73a5d2ddcf192b583df205b996748542023272b1dc2d6f210e430fb3`.
- The exact upstream checkout was cloned outside the repository under
  `/tmp/blender-mcp-upstream.zJdyYr/repo` and checked out at the pin. Source
  SHA-256: `addon.py`
  `ca6955bb584d78e229f020a8b9d7011440adc6e94dab0ac8e01ab2794db19dc0`,
  `LICENSE` `049501fd54d27852507853a5b88094ca1c6ff97404418a5032f3310eecc9cde6`,
  `pyproject.toml`
  `924ffd88d4e1a99fa2177aaa398a71306df03f023ec22f42514e8825beb12962`, and
  `uv.lock` `b390666920cd02756604df354ae67f41b4bc7c5ecd7781b87f71043cdd1ad4d7`.
- The addon is installed as the exact `addon.py` bytes at
  `/Users/sangheonlee/Library/Application Support/Blender/5.2/scripts/addons/blender_mcp_pinned/__init__.py`
  (same SHA-256 as above). This dedicated package path avoids replacing an
  unrelated addon and is outside this repository.
- Blender user preferences were saved only to enable this addon; no existing
  `.blend` was opened or modified. The current preferences file is
  `/Users/sangheonlee/Library/Application Support/Blender/5.2/config/userpref.blend`.
- The existing Codex user config was backed up to
  `/Users/sangheonlee/.codex/config.toml.blender-mcp-preinstall-20260804.bak`
  (SHA-256
  `1db4ac63ceec28fb6f948be42060ecec238d6d61bb5e43c6cd33afd9a1eb13ed`).
  The only config addition is the `[mcp_servers.blender]` entry in
  `/Users/sangheonlee/.codex/config.toml`; existing MCPs and settings were
  preserved.

Commands used for the reversible install and validation were:

```sh
brew install uv
git clone https://github.com/ahujasid/blender-mcp.git /tmp/blender-mcp-upstream.zJdyYr/repo
git -C /tmp/blender-mcp-upstream.zJdyYr/repo checkout 3ab892510cc0e5435ba5e611c01fb1021fbde8de
/Applications/Blender.app/Contents/MacOS/Blender --background --python-expr \
  "import bpy; bpy.ops.preferences.addon_enable(module='blender_mcp_pinned'); bpy.ops.wm.save_userpref()"
/opt/homebrew/bin/uvx --python 3.11 --from \
  git+https://github.com/ahujasid/blender-mcp.git@3ab892510cc0e5435ba5e611c01fb1021fbde8de \
  blender-mcp
```

The MCP validation used an isolated temporary uv cache at
`/tmp/blender-mcp-uv-cache-20260804` (about 91 MB of Python dependencies); it
contains no project data and may be removed during rollback. Blender's
validation log was `/tmp/blender-mcp-blender-20260804.log`.

Effective client configuration:

```toml
[mcp_servers.blender]
command = "/opt/homebrew/bin/uvx"
args = ["--python", "3.11", "--from", "git+https://github.com/ahujasid/blender-mcp.git@3ab892510cc0e5435ba5e611c01fb1021fbde8de", "blender-mcp"]
cwd = "/Users/sangheonlee/dev/games/urban-digital-twin"
startup_timeout_sec = 120

[mcp_servers.blender.env]
BLENDER_HOST = "127.0.0.1"
BLENDER_PORT = "9876"
DISABLE_TELEMETRY = "true"
```

Codex reports this server as configured/enabled; its host-side status is
`Unsupported` in this older client build, so a fresh Codex/Luna session may be
needed for discovery. No existing process was killed or forcibly restarted.

## Validation evidence

The addon was enabled in Blender 5.2.0 LTS and Blender was launched with the
default startup scene as a disposable session. `lsof -nP -iTCP:9876 -sTCP:LISTEN`
reported only `TCP 127.0.0.1:9876 (LISTEN)` for the Blender process; no LAN or
public interface was bound. A fresh stdio MCP client launched the exact pinned
`uvx --python 3.11 --from git+...@3ab892... blender-mcp` command with
`BLENDER_HOST=127.0.0.1`, `BLENDER_PORT=9876`, and
`DISABLE_TELEMETRY=true`. MCP initialize and `tools/list` succeeded; the server
reported `BlenderMCP` `1.29.0` and 22 tools.

The client successfully called read-only `get_scene_info`, executed a benign
temporary `LunaMCP_ValidationCube` creation, read it with `get_object_info`,
deleted it, and confirmed the default scene returned to three objects (Cube,
Light, Camera). Read-only status calls confirmed Poly Haven, Hyper3D,
Hunyuan3D, and Sketchfab integrations were disabled. At this installation
checkpoint no project `.blend`, city asset, external image, provider payload,
or credential was created or stored; the later protected landmark wave is
documented in its own dated research record.
The repository remained uncommitted; `git diff --check`, typecheck, 81 tests,
lint, build, and `origin` branch inspection passed. The only repository changes
are the two documentation files from this task plus pre-existing place-truth
worktree changes; no dependency lockfile, build output, cache, secret, or
database was added.

## Startup, update, and rollback

1. Start Blender 5.2.0 normally from `/Applications/Blender.app`; with the
   installed preference, the enabled addon auto-starts its local server on
   `127.0.0.1:9876` (the upstream addon source uses the loopback hostname
   `localhost` internally).
2. If auto-start is disabled or the listener is absent, open a 3D Viewport,
   press `N` if the sidebar is hidden, select the `BlenderMCP` tab, and click
   `Connect to MCP server` (the underlying operator is labelled `Connect to
   Claude`). Keep the optional provider checkboxes off.
3. Start a fresh Codex/Luna task or session in this project so it reads the MCP
   entry; a forced app restart is not required for discovery. Confirm the
   listener is loopback-only before using any tool.
4. Keep all generated work in a disposable, explicitly named `.blend` outside
   the repository until it has passed asset-manifest validation and review.

The earlier `--background --python-expr` command was a one-time installation
step to persist addon enablement and is not the normal startup workflow. The
2026-08-04 disposable validation process (PID 47917) was terminated with
`SIGTERM`; TCP 9876 is now closed and no scene `.blend` was saved.

To update, stop the MCP client and Blender, review a new upstream commit and
its source checksums, replace the dedicated addon package, and update the
`uvx --from ...@<SHA>` pin. Re-run the loopback, provider-disabled, and benign
MCP validation before using it. Do not update to floating `main`.

To roll back, stop the client and Blender, remove the dedicated
`blender_mcp_pinned` addon directory, disable the addon in Blender preferences,
and remove only the `[mcp_servers.blender]` and its `.env` table from the Codex
config; the dated config backup is available for comparison/recovery. Remove
the temporary uv cache at `/tmp/blender-mcp-uv-cache-20260804` if desired. Do
not delete unrelated Blender preferences or addons.

## Remaining asset-pipeline work

At the installation checkpoint no Manhattan asset authoring, photogrammetry,
imagery capture, provider data ingest, or runtime export had been approved or
performed. The later protected landmark wave is bounded-pilot provenance only.
Before any further real asset work, obtain the project approval gates for source data/licensing, choose
per-asset provenance and review rules, define deterministic GLB/3D Tiles
validation, and decide whether each generated `.blend` may leave the disposable
workspace. The MCP's arbitrary Python capability remains a standing risk even
with loopback binding and telemetry disabled.
