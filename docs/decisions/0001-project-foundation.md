# Decision 0001: Project foundation

Date: 2026-08-03

## Accepted

- The repository is named `urban-digital-twin` to support Manhattan first and
  additional cities later.
- The Codex Lean Workflow is the active operating policy.
- Default owner: GPT-5.6 Luna High.
- Deep escalation: GPT-5.6 Luna Max only after two evidenced failed attempts or
  a documented cross-system reasoning problem.
- Milestone architecture review: at most one GPT-5.6 Sol Medium/High pass.
- Claude/Opus remains disabled unless the user explicitly changes the rule.
- Orca is the required interface for Orca-managed state.
- React + TypeScript + Vite + CesiumJS + 3D Tiles is the provisional web
  baseline. Three.js is an optional rendering supplement.
- Blender MCP is mandatory for Blender automation, but its installation and
  connection are pending explicit user confirmation.

## Superseded

No prior repository policy or architecture existed.

## Evidence and rationale

- The workflow installer check reported only two new files and no conflicting
  existing `AGENTS.md`.
- Cesium's official documentation describes CesiumJS as a high-precision WGS84
  web visualization library and 3D Tiles as its massive geospatial streaming
  path with LOD, caching, and asynchronous loading.
- The referenced X post demonstrates the plausibility of rapid Blender MCP city
  generation, but does not provide production accuracy or web-performance
  evidence.

## Pending gates

Blender MCP connectivity, data licensing/providers, Cesium ion versus self-hosted
tiling, traffic semantics, device/performance targets, and interior scope require
user decisions before the corresponding implementation work.
