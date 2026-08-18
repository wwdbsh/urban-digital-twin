#!/usr/bin/env node
/* global console, process */
/**
 * Stage baked far-tier tiles into the local serving tree.
 *
 * AN OPERATOR STEP, NOT A BUILD STEP. The baked bytes are local work product
 * under the gitignored `artifacts/` root; this script copies them to the
 * gitignored serving root and writes a committed inventory that pins what it
 * copied. Nothing uncommitted is required for the test suite: every far-tier
 * test derives from the committed inventory or from synthetic fixtures, so a
 * fresh clone runs the whole gate without ever staging a byte.
 *
 * It VERIFIES BEFORE IT COPIES. A tile whose bytes do not match the checksum
 * recorded at bake time is refused rather than staged, because staging it would
 * move the failure from here — where it names the file — to the browser, where
 * it would surface as a checksum-mismatch on someone else's screen.
 *
 * Usage:
 *   node scripts/far-tier-stage-cli.mjs --check
 *   node scripts/far-tier-stage-cli.mjs --stage
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";

const REPO_ROOT = process.cwd();
const BAKE_ROOT = join(REPO_ROOT, "artifacts", "far-tier-hlod-20260818");
const SERVING_ROOT = join(REPO_ROOT, "public", "far-tier");
const INVENTORY_PATH = join(REPO_ROOT, "data", "far-tier-hlod-runtime-20260818", "payload-inventory.json");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const exists = async (path) => { try { await access(path); return true; } catch { return false; } };

async function main() {
  const mode = process.argv.includes("--stage") ? "stage" : "check";
  const inventory = JSON.parse(await readFile(INVENTORY_PATH, "utf8"));
  const results = [];

  for (const entry of inventory.entries) {
    const glbSource = join(BAKE_ROOT, `${entry.cellId}.far_0.glb`);
    const atlasSource = join(BAKE_ROOT, `${entry.cellId}.atlas.png`);
    if (!(await exists(glbSource))) { results.push({ cellId: entry.cellId, status: "bake-absent", detail: glbSource }); continue; }

    const glb = await readFile(glbSource);
    const glbDigest = sha256(glb);
    if (glbDigest !== entry.glbSha256) {
      results.push({ cellId: entry.cellId, status: "REFUSED", detail: `GLB digest ${glbDigest} does not match the inventory's ${entry.glbSha256}.` });
      continue;
    }
    if (glb.byteLength !== entry.glbByteSize) {
      results.push({ cellId: entry.cellId, status: "REFUSED", detail: `GLB is ${glb.byteLength} bytes; ${entry.glbByteSize} were declared.` });
      continue;
    }

    let atlas = null;
    if (await exists(atlasSource)) {
      atlas = await readFile(atlasSource);
      const atlasDigest = sha256(atlas);
      if (atlasDigest !== entry.atlasSha256) {
        results.push({ cellId: entry.cellId, status: "REFUSED", detail: `Atlas digest ${atlasDigest} does not match the inventory's ${entry.atlasSha256}.` });
        continue;
      }
    }

    if (mode === "stage") {
      await mkdir(dirname(join(SERVING_ROOT, `${entry.cellId}.far_0.glb`)), { recursive: true });
      await writeFile(join(SERVING_ROOT, `${entry.cellId}.far_0.glb`), glb);
      if (atlas) await writeFile(join(SERVING_ROOT, `${entry.cellId}.atlas.png`), atlas);
    }
    results.push({ cellId: entry.cellId, status: mode === "stage" ? "staged" : "verified" });
  }

  // The inventory is staged alongside the tiles so the runtime can fetch it
  // from the same served root. The committed copy under data/ stays the source
  // of truth; this is a copy of it, not a second authority.
  if (mode === "stage") {
    await mkdir(SERVING_ROOT, { recursive: true });
    await writeFile(join(SERVING_ROOT, "payload-inventory.json"), JSON.stringify(inventory, null, 1) + "\n");
  }

  const refused = results.filter((result) => result.status === "REFUSED");
  console.log(JSON.stringify({ mode, servingRoot: SERVING_ROOT, results }, null, 1));
  if (refused.length > 0) {
    console.error(`\n${refused.length} tile(s) REFUSED. Nothing about a refused tile was staged.`);
    process.exitCode = 1;
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
