

<!-- codex-lean-workflow:start -->
## Codex operating contract

- Work inside this repository unless the user explicitly expands scope.
- For every nontrivial repository change, root GPT-5.6 Sol High briefs the task
  and creates exactly one visible GPT-5.6 Sol Medium planning session. Root must
  not substitute for, skip, or perform that planning.
- Sol Medium clarifies requirements, analyzes risks, reuses completed research,
  decisions, and validation evidence, and produces an implementation-ready plan
  with observable completion conditions. The plan is the explicit handoff for
  implementation and must preserve the user's scope and acceptance criteria.
- From the explicit Sol Medium handoff, root creates exactly one visible
  GPT-5.6 Luna Max session. Luna Max owns implementation, focused and full tests,
  fixes, and repeated deterministic test loops until completion or a
  report-instead-of-guessing condition is reached.
- Root GPT-5.6 Sol High only orchestrates and reviews high-risk portions or the
  final diff; root never implements code and never takes over the Luna Max loop.
- All agent sessions, including root, Sol Medium, Sol High review, and Luna Max,
  must be visible in Orca. Do not create hidden or untracked sessions.
- Every Luna Max handoff must explicitly include: goal; allowed areas;
  do-not-touch areas; ordered implementation steps; observable completion
  conditions; exact tests and checks; rollback point; report-instead-of-guessing
  conditions; and a pre-exit checklist.
- Use the minimum useful agents: normally root plus one Sol Medium plus one Luna
  Max, with no extra worker absent an independent, bounded need. Never create
  workers to satisfy a quota or to duplicate completed research.
- Keep Claude/Opus disabled unless the user explicitly enables it. Reuse
  completed research, decisions, and review evidence rather than repeating work
  for fresh contexts, model diversity, or reviewer counts.
- Batch related changes and run deterministic validation first: relevant tests,
  type checks, lint, builds, fixed captures, diffs, playtests, and performance
  measurements. Keep output concise and store large reusable findings in project
  files.
- Do not lower acceptance criteria to make the current result pass. When user
  feedback arrives during active work, finish the safe in-progress operation
  before applying additive feedback unless the user clearly overrides or
  cancels it.
- If an exceptional worker is created, give it one independent bounded task,
  persist reusable findings when useful, and close or interrupt it promptly when
  its role ends; do not accumulate idle or completed agents.
- Record why any model escalation, routing exception, or additional worker was
  necessary, including the evidence and scope that justified it.
- Narrow exceptions only: root may directly answer a trivial read-only question
  that needs no mutation, extended investigation, material planning, or risk
  judgment. Sol Medium may be bypassed only for a fully specified, bounded,
  low-risk, reversible, non-code, user-authorized action whose instruction
  already supplies a complete Luna Max handoff; root may then perform only
  read-only, orchestration, review, or administrative actions. Any code,
  configuration, test, or build-artifact implementation remains Luna Max-owned,
  and no exception may let root implement code.
<!-- codex-lean-workflow:end -->

# Urban Digital Twin project contract

## Product direction

- Build a reusable real-world city digital-twin platform; Manhattan is the first
  city, not a one-off hard-coded scene.
- Preserve geographic coordinates, source provenance, capture/update dates, and
  known uncertainty. Do not claim visual or factual fidelity beyond the source
  data and validation evidence.
- The product must remain a practical web application: users can navigate the
  city, select buildings or map features, and inspect sourced information in a
  clear details panel.

## Required toolchain

- Use Orca for Orca-managed repository, worktree, terminal, and embedded-browser
  operations. Load the version-matched guide with `orca skills get orca-cli`
  before using Orca commands, and prefer JSON output for agent-driven calls.
- Blender MCP is required for procedural 3D authoring, scene inspection,
  validation, and export. If Blender MCP is unavailable or disconnected, stop
  the affected 3D task and ask the user to connect or authorize it; do not
  silently replace it with unrelated desktop automation.
- Web baseline: React, TypeScript, Vite, CesiumJS, and 3D Tiles. CesiumJS owns
  WGS84 positioning, terrain/globe behavior, large geospatial dataset streaming,
  level of detail, and feature picking. Use Three.js only for a demonstrated
  rendering need that CesiumJS cannot meet cleanly.
- Prefer glTF/GLB for individual reusable assets and 3D Tiles for city-scale
  delivery. Do not ship Manhattan as one monolithic Blender or browser scene.

## Reference and acceptance gates

- Treat <https://x.com/RoundtableSpace/status/2084032743843803219?s=20> as an
  inspiration and prototype benchmark: the post reports roughly 45,000 real
  buildings, landmarks, and street-grid traffic produced through Blender MCP in
  about 2.5 hours. It is not proof of geographic, architectural, metadata, or
  production-web accuracy.
- Validate visual fidelity, feature identity, click selection, information
  provenance, streaming behavior, memory, and frame time separately.
- Ask the user before adding an unapproved MCP, paid or credentialed service,
  external data provider with licensing obligations, or a materially different
  architecture. Ask whenever an ambiguity would materially change fidelity,
  cost, licensing, privacy, or product scope.
