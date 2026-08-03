

<!-- codex-lean-workflow:start -->
## Codex operating contract

- Work inside this repository unless the user explicitly expands scope.
- Use one GPT-5.6 Luna High session as the default owner for exploration,
  implementation, refactoring, testing, builds, and routine review.
- Do not create subagents or external workers by default. Use the minimum number
  only for demonstrably independent work whose benefit exceeds duplicated context
  and token cost. Never create workers to satisfy a quota.
- Escalate to GPT-5.6 Luna Max only after two failed default-model attempts on the
  same blocker, or for a documented cross-system reasoning problem.
- Reserve GPT-5.6 Sol Medium/High for major architecture or direction decisions, one
  review after a substantial milestone batch, or final diagnosis of a complex
  defect the default path could not resolve. Do not use it for routine edits.
- Keep Claude/Opus disabled unless the user explicitly changes this rule.
- Reuse completed research, decisions, and review evidence. Do not repeat work
  merely to obtain fresh contexts, model diversity, or reviewer counts.
- Batch related changes and run deterministic evidence first: relevant tests,
  type checks, lint, builds, fixed captures, diffs, playtests, and performance
  measurements.
- If an exceptional worker is created, assign one bounded independent task,
  persist reusable findings in the repository, and close or interrupt the worker
  promptly when its role ends. Do not accumulate idle or completed agents.
- Keep tool output concise and store large reusable findings in project files.
- Do not lower acceptance criteria to make the current result pass.
- When user feedback arrives during active work, finish the safe in-progress
  operation before applying additive feedback unless the user clearly overrides
  or cancels it.
- Record why any model escalation or additional worker was necessary.
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
