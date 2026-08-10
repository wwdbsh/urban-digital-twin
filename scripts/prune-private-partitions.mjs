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
 * Runs as the last step of `pnpm build`. Also runnable standalone:
 *   node scripts/prune-private-partitions.mjs [--dist <dir>] [--dry-run]
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

export function prunePrivatePartitions(distDir, { dryRun = false } = {}) {
  const dataDir = join(distDir, "data");
  const directories = findPrivatePartitionDirectories(dataDir);
  const removed = directories.map((directory) => relative(distDir, directory).split(sep).join("/"));
  if (!dryRun) for (const directory of directories) rmSync(directory, { recursive: true, force: true });
  return { distDir, dataDir, removed, removedCount: removed.length, dryRun };
}

function main() {
  const args = process.argv.slice(2);
  const distIndex = args.indexOf("--dist");
  const distDir = distIndex >= 0 && args[distIndex + 1] ? resolve(args[distIndex + 1]) : join(repoRoot, "dist");
  const result = prunePrivatePartitions(distDir, { dryRun: args.includes("--dry-run") });
  if (result.removedCount === 0) {
    console.log(`prune-private-partitions: no private partition reached ${result.dataDir}`);
    return;
  }
  console.log(`prune-private-partitions: ${result.dryRun ? "would remove" : "removed"} ${result.removedCount} private partition director${result.removedCount === 1 ? "y" : "ies"} from the build output`);
  for (const entry of result.removed) console.log(`  ${entry}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
