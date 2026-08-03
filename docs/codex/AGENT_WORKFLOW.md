

<!-- codex-lean-workflow:start -->
# Token-efficient Codex workflow

Project root: `/Users/sangheonlee/dev/games/urban-digital-twin`

## Objective

Maximize completed, verified work per token. Model calls and worker count are
costs, not evidence of quality. Prefer a single context that understands the
repository and use deterministic evidence to decide whether escalation is useful.

## Routing

| Work | Default route |
|---|---|
| Exploration, implementation, refactoring, tests, builds | GPT-5.6 Luna High |
| Routine diagnosis and review | GPT-5.6 Luna High |
| Same blocker after two failed default attempts | GPT-5.6 Luna Max |
| Documented cross-system reasoning problem | GPT-5.6 Luna Max |
| Major architecture or direction gate | GPT-5.6 Sol Medium/High |
| Review after a substantial milestone batch | At most one GPT-5.6 Sol Medium/High pass |
| Routine critique, fresh-context checks, reviewer voting | Do not delegate |
| Disabled model family | Claude/Opus |

Use capability-equivalent replacements if these labels are unavailable, while
preserving the same cheap-to-expensive escalation order.

## Escalation evidence

Before escalation, record:

1. The concrete blocker or decision.
2. What the default owner attempted.
3. The test, build, capture, trace, or other evidence showing failure.
4. Why the next tier is likely to add information rather than duplicate context.
5. The bounded output expected from the escalation.

Task size alone is not escalation evidence. A large mechanical change can remain
with the default owner; a small cross-system defect may justify deeper reasoning.

## Worker lifecycle

Create a worker only when its task can proceed independently and in parallel.
Give it one named deliverable and explicit scope. When it finishes, persist useful
findings, integrate or reject them, and close or interrupt the worker. Retain no
idle worker for speculative reuse.

## Validation order

1. Run the narrowest relevant checks while implementing.
2. Run type checks, lint, and focused tests.
3. Run the full regression suite and production build when proportional to risk.
4. For rendered products, use fixed captures and real interaction checks.
5. Compare before/after evidence and state remaining failures honestly.
6. Request one expensive review only if the completed batch reaches a genuine
   architecture, direction, or milestone gate.

Functional correctness and visual or product acceptance are separate verdicts.
Passing tests must never be presented as proof of visual quality.

## Context and feedback

Reuse existing research, decisions, captures, and reports. Do not regenerate them
to manufacture reviewer independence. When new feedback arrives during work,
treat it as additive unless it clearly cancels or replaces the active request.
Finish safe in-progress commands before switching to the added work.

## Decision log entry

When routing changes materially, append a short project decision containing the
date, accepted policy, superseded policy, default model, escalation conditions,
disabled models, and primary verification evidence.
<!-- codex-lean-workflow:end -->
