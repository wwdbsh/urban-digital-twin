# Two-LOD promotion revert rehearsal — 2026-08-17

The single-revert rule (ADR 0057 Part 0): one `git revert` of the promotion
commit must restore the `-s1` composition, the pre-promotion selection
semantics (`exploration` default), and the constants together.

## What was run

- `git revert --no-commit 9075453` in the task worktree (revert staged, tree at
  the reverted state).
- Suites at the reverted state — all green:
  - `src/release/exterior-serving-drift.test.ts`
  - `src/release/exterior-two-lod-selection.test.ts` (the no-op pin holds in
    BOTH directions of the flip)
  - `src/runtime/exterior-default-activation.test.ts`
  - `src/runtime/exterior-cache-ceiling.test.ts`
  - `src/app/App.test.tsx`
  - Total: 218/218.
- `pnpm goal:reconcile -- --check` at the reverted state: `ok: true`,
  `compositionDrift: false` (the CLI's curated derivation reverts with the
  commit, so the one-hop walk matches the restored one-link chain).
- The revert was then discarded (`git reset --hard`), restoring the promotion.

## What this proves

The promotion commit is one revertable unit: composition (`-s2` records),
semantics (`inspection` default), pins, ceiling profiles, and every dependent
test move together in both directions. No third, unmeasured configuration is
reachable by reverting it.

## Re-verified from the branch tip (2026-08-18, review closure)

The independent verifier replayed the revert from tip `0d5ec85` in a scratch
worktree and saw 3 `App.test.tsx` failures (20 s `waitFor` timeouts); the
independent reviewer's control run showed the SAME 3 failures with the revert
NOT applied in the same scratch — isolating the cause as the scratch worktree's
missing untracked payload symlinks, not the revert. Settled with bytes in the
live worktree (payloads present): `git revert --no-commit 9075453` from tip
`0d5ec85` auto-merges cleanly and the five-suite set runs **218/218 green** —
the same count as the original rehearsal. The revert property holds at both
points in history; a scratch replay of it needs the payload symlinks or the
fail-closed tests time out on absent fetches.
