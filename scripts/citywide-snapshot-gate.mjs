/* global console, process */
/**
 * Fail-closed availability gate for the pinned citywide snapshot (Task T001).
 *
 * Every deterministic measurement in this repository is defined relative to ONE
 * set of source bytes: `manhattan-citywide-20260804`, whose `manifest.json`
 * hashes to `acb5a9b5…c203c`. Those bytes are gitignored, they are reached
 * through a symlink in every Orca worktree, and their absence or drift is the
 * likeliest way a "citywide" measurement quietly describes something else.
 *
 * This script performs the I/O and hands it to `verifyCitywideSnapshot`, which
 * owns the decision and is unit-tested against synthetic bytes. It acquires
 * nothing, writes nothing, and exits 1 with an operator message on any stop.
 *
 * Usage: pnpm citywide:snapshot-gate [--json]
 */
import { existsSync, statSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID } from "../src/domain/exterior-fullsnapshot-input.ts";
import { verifyCitywideSnapshot } from "../src/release/citywide-snapshot-gate.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotRoot = join(repositoryRoot, "public", "data", EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID);

async function readOrNull(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function countBuildingShards(root) {
  try {
    const names = await readdir(join(root, "geometry", "buildings"));
    return names.filter((name) => name.endsWith(".json")).length;
  } catch {
    return null;
  }
}

/** Resolves symlinks, so a dangling worktree link reads as absent rather than present-but-broken. */
function directoryPresent(path) {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

const present = directoryPresent(snapshotRoot);
const result = verifyCitywideSnapshot({
  snapshotRoot,
  snapshotRootPresent: present,
  manifestText: present ? await readOrNull(join(snapshotRoot, "manifest.json")) : null,
  recordedChecksumText: present ? await readOrNull(join(snapshotRoot, "manifest.sha256")) : null,
  buildingShardFileCount: present ? await countBuildingShards(snapshotRoot) : null,
});

if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
else console.log(result.message);
process.exit(result.ok ? 0 : 1);
