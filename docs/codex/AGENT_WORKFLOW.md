

<!-- codex-lean-workflow:start -->
# Current Codex/Orca workflow

Project root: `/Users/sangheonlee/dev/games/urban-digital-twin`

## Objective

This repository uses a visible, staged workflow for nontrivial changes. Model
calls and worker count are costs, not evidence of quality; the explicit plan,
deterministic checks, ownership evidence, and final diff are the acceptance
artifacts.

## Routing

| Responsibility | Route |
|---|---|
| Briefing and orchestration | Root GPT-5.6 Sol High |
| Requirement clarification and implementation-ready plan | Exactly one visible GPT-5.6 Sol Medium session |
| Implementation, focused/full tests, fixes, and deterministic loops | Exactly one visible GPT-5.6 Luna Max session from the handoff |
| High-risk/final review | Root Sol High; no code implementation by Root |
| Disabled model family | Claude/Opus unless the user explicitly enables it |

Use capability-equivalent replacements if these labels are unavailable, while
preserving the visible one-planner/one-implementation-owner structure. Do not
create workers for quota, duplicated research, or fresh-context review.

## Escalation evidence

Before escalation, record:

1. The concrete blocker or decision.
2. What the default owner attempted.
3. The test, build, capture, trace, or other evidence showing failure.
4. Why the next tier is likely to add information rather than duplicate context.
5. The bounded output expected from the escalation.

Task size alone is not escalation evidence. A large mechanical change can remain
with the default owner; a small cross-system defect may justify deeper reasoning.

## Worker lifecycle and handoff

The normal shape is Root plus one Sol Medium plus one Luna Max. Every Luna Max
handoff names the goal, allowed areas, do-not-touch areas, ordered steps,
observable completion conditions, exact tests/checks, rollback point,
report-instead-of-guessing conditions, and a pre-exit checklist. All sessions
must be visible in Orca. Exceptional workers require one independent bounded
need, a recorded reason, persisted findings when useful, and prompt closure.

## Delivery gate

Luna Max owns implementation and validation. Root reviews ownership, truth,
rights, protected/generated paths, and the complete diff. No commit or push is
allowed until Root explicitly authorizes the exact staged path list and staged
diff; a completed work unit creates exactly one normal commit and one normal
push attempt. Never reset, clean, discard, force-push, or silently absorb a
path with unclear ownership.

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

When routing changes materially, append a short decision containing the date,
accepted policy, superseded policy, route, disabled models, and primary
verification evidence. The current repository contract is also maintained in
`AGENTS.md`; this file is its concise operational summary.

## Final review and work-unit publication policy

For the approved civic-context wave, Luna Max may implement and validate only
the handoff scope. Before any commit or push, Root Sol High must review the
high-risk source registry, acquisition/accounting, immutable release, runtime
failure isolation, browser evidence, protected hashes, and final documentation
matrix. Root review is complete; this commit is the scoped CP7 delivery; push
verification follows/is recorded in Git history. The current user authorization
permits this dispatched implementation worker to execute only the explicitly
reviewed stage, normal commit, and normal push sequence; no additional path,
deployment, or external notification is implied. The rollback target remains
the baseline commit plus the untouched old release, with new release activation
reversible by switching back rather than deleting evidence.
<!-- codex-lean-workflow:end -->
