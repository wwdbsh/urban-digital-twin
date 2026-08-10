#!/usr/bin/env node
/* global console, process */
/**
 * Keep `private/` partitions out of the browser-resolvable build output.
 *
 * Vite copies `public/` into `dist/` verbatim, so
 * `public/data/<package>/private/**` lands in `dist/data/<package>/private/**`
 * and becomes fetchable by path from a production build even though no
 * manifest, release graph or allowlist references it. That is a partition/path
 * violation: the private partition is supposed to be unreachable from a public
 * build.
 *
 * The correction is applied where the browser-reachable tree is *produced*, not
 * where the release is stored. The committed packages under `public/data/` are
 * immutable and are never edited, moved or deleted by this script — it only
 * ever removes directories under `dist/data/`.
 *
 * Scope is deliberately narrow: directories literally named `private` beneath
 * `dist/data/`, and nothing else. The canary release
 * `manhattan-exterior-cells-20260811` references only `public/`-rooted
 * artifacts, so it is unaffected.
 *
 * That restriction is enforced, not just documented: `--dist` is refused unless
 * it resolves to the repository's own `dist/`, so no argument can point the
 * recursive removal at `public/data/**` or `data/**`.
 *
 * Runs as the last step of `pnpm build`. Also runnable standalone:
 *   node scripts/prune-private-partitions.mjs [--dist <dist dir>] [--dry-run]
 */
import { readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Directories literally named `private`; `privateer` and the like are not matches. */
export function findPrivatePartitionDirectories(root) {
  const found = [];
  const visit = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = join(directory, entry.name);
      if (entry.name === "private") {
        found.push(full);
        continue;
      }
      visit(full);
    }
  };
  try {
    statSync(root);
  } catch {
    return found;
  }
  visit(root);
  return found.sort();
}

export const DEFAULT_DIST_DIR = join(repoRoot, "dist");

/**
 * Resolve `--dist` under a containment guard.
 *
 * This script deletes directories recursively, so the one argument that steers
 * it has to be the narrowest thing that still works. Unguarded, `--dist public`
 * resolves to `public/` and `prunePrivatePartitions` would then delete
 * `public/data/<package>/private/**` — committed, immutable release bytes. The
 * refusal is a `throw` before any traversal or removal, so a rejected argument
 * cannot remove anything, and the accepted set is exactly one path: the
 * repository's own build output.
 *
 * `defaultDistDir` is injectable so a test can prove the refusal against a
 * throwaway tree instead of the real one; production callers never pass it.
 */
export function resolveDistArgument(rawValue, { defaultDistDir = DEFAULT_DIST_DIR } = {}) {
  if (rawValue === undefined || rawValue === null || rawValue === "") return defaultDistDir;
  const resolved = resolve(rawValue);
  if (resolved !== resolve(defaultDistDir)) {
    throw new Error(`prune-private-partitions refuses --dist ${resolved}: it only ever prunes the build output at ${defaultDistDir}. Committed release partitions under public/ and data/ are immutable and are never deleted by this script.`);
  }
  return resolved;
}

export function prunePrivatePartitions(distDir, { dryRun = false } = {}) {
  const dataDir = join(distDir, "data");
  const directories = findPrivatePartitionDirectories(dataDir);
  const removed = directories.map((directory) => relative(distDir, directory).split(sep).join("/"));
  if (!dryRun) for (const directory of directories) rmSync(directory, { recursive: true, force: true });
  return { distDir, dataDir, removed, removedCount: removed.length, dryRun };
}

export function runPrunePrivatePartitionsCli(args, { defaultDistDir = DEFAULT_DIST_DIR } = {}) {
  const distIndex = args.indexOf("--dist");
  // Guard first: nothing is scanned or removed until the target is accepted.
  const distDir = resolveDistArgument(distIndex >= 0 ? args[distIndex + 1] : undefined, { defaultDistDir });
  return prunePrivatePartitions(distDir, { dryRun: args.includes("--dry-run") });
}

function main() {
  const args = process.argv.slice(2);
  const result = runPrunePrivatePartitionsCli(args);
  if (result.removedCount === 0) {
    console.log(`prune-private-partitions: no private partition reached ${result.dataDir}`);
    return;
  }
  console.log(`prune-private-partitions: ${result.dryRun ? "would remove" : "removed"} ${result.removedCount} private partition director${result.removedCount === 1 ? "y" : "ies"} from the build output`);
  for (const entry of result.removed) console.log(`  ${entry}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
