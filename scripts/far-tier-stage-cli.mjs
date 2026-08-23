#!/usr/bin/env node
/* global console, process, Buffer */
/**
 * Stage the promoted far-tier tiles into the local serving tree.
 *
 * AN OPERATOR STEP, NOT A BUILD STEP. The baked bytes are local work product
 * under the gitignored `artifacts/` root; this script copies them to the
 * gitignored serving root. Nothing uncommitted is required for the test suite:
 * every far-tier test derives from the committed inventory or from synthetic
 * fixtures, so a fresh clone runs the whole gate without staging a byte.
 *
 * IT VERIFIES BEFORE IT COPIES. A tile whose bytes do not match the checksum
 * the promoted inventory declares is refused rather than staged, because
 * staging it would move the failure from here — where it names the file — to
 * the browser, where it would surface as a checksum-mismatch on someone's
 * screen.
 *
 * WHAT T005 CHANGED, and why the old version could not do this job:
 *
 * 1. THE SOURCE LAYOUT. The campaign writes `payloads/<waveId>/<cellId>.*`;
 *    this script read a flat `artifacts/far-tier-hlod-20260818/` root. The wave
 *    is derived from the cell id, which is where it already lives.
 * 2. THE INVENTORY. It read the one-cell T003 record. It now reads the promoted
 *    883-cell one -- the 840-cell record it read between those two is
 *    superseded, not deleted.
 * 3. THE STAGED INVENTORY IS A BYTE COPY. The runtime pins ONE digest and fails
 *    closed on a mismatch, so the staged copy must be byte-identical to the
 *    committed record — not equivalent, IDENTICAL. Re-serializing it here would
 *    be a second writer with its own spacing, and the symptom would not be a
 *    diff: it would be the whole tier failing closed in every session. The
 *    bytes are copied, and `far-tier-promotion.test.ts` asserts the identity.
 *
 * Usage:
 *   node scripts/far-tier-stage-cli.mjs --check
 *   node scripts/far-tier-stage-cli.mjs --stage
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access, rm } from "node:fs/promises";
import { join } from "node:path";

const REPO_ROOT = process.cwd();
// The phantom-shaft fix re-baked all 883 cells into its own payload root, so
// that root -- not T004's 840-tile one -- is what the current promotion
// declares. Staging from the old root would find 43 tiles missing.
const PAYLOAD_ROOT = join(REPO_ROOT, "artifacts", "far-tier-hlod-phantom-shaft-20260823", "payloads");
const SERVING_ROOT = join(REPO_ROOT, "public", "far-tier");
const INVENTORY_PATH = join(REPO_ROOT, "data", "far-tier-hlod-promotion-20260823", "promoted-inventory.json");
const INVENTORY_SIDECAR = join(REPO_ROOT, "data", "far-tier-hlod-promotion-20260823", "promoted-inventory.sha256");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const exists = async (path) => { try { await access(path); return true; } catch { return false; } };

/** The wave a cell belongs to, from the id. Anchored: a `w05` elsewhere is not a wave. */
const waveOf = (cellId) => /^manhattan-exterior-cell-(w\d{2})-/u.exec(cellId)?.[1] ?? null;

async function main() {
  const mode = process.argv.includes("--stage") ? "stage" : "check";
  const inventoryText = await readFile(INVENTORY_PATH, "utf8");

  // The committed record is checked against its OWN sidecar before a byte of it
  // is trusted to say what any tile should contain.
  const declaredSidecar = (await readFile(INVENTORY_SIDECAR, "utf8")).trim().split(/\s+/u)[0];
  const inventoryDigest = sha256(Buffer.from(inventoryText, "utf8"));
  if (declaredSidecar !== inventoryDigest) {
    console.error(`far-tier-stage: the promoted inventory does not match its own sidecar (${inventoryDigest} against ${declaredSidecar}); refusing to stage.`);
    process.exit(1);
  }
  const inventory = JSON.parse(inventoryText);

  const results = [];
  let staged = 0;
  for (const entry of inventory.entries) {
    const waveId = waveOf(entry.cellId);
    if (waveId === null) { results.push({ cellId: entry.cellId, status: "REFUSED", detail: "cell id carries no wave" }); continue; }
    const glbSource = join(PAYLOAD_ROOT, waveId, `${entry.cellId}.far_0.glb`);
    const atlasSource = join(PAYLOAD_ROOT, waveId, `${entry.cellId}.atlas.png`);
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
    if (!(await exists(atlasSource))) { results.push({ cellId: entry.cellId, status: "bake-absent", detail: atlasSource }); continue; }
    const atlas = await readFile(atlasSource);
    const atlasDigest = sha256(atlas);
    if (atlasDigest !== entry.atlasSha256) {
      results.push({ cellId: entry.cellId, status: "REFUSED", detail: `atlas digest ${atlasDigest} does not match the inventory's ${entry.atlasSha256}.` });
      continue;
    }
    if (atlas.byteLength !== entry.atlasByteSize) {
      results.push({ cellId: entry.cellId, status: "REFUSED", detail: `atlas is ${atlas.byteLength} bytes; ${entry.atlasByteSize} were declared.` });
      continue;
    }

    if (mode === "stage") {
      await mkdir(SERVING_ROOT, { recursive: true });
      await writeFile(join(SERVING_ROOT, `${entry.cellId}.far_0.glb`), glb);
      await writeFile(join(SERVING_ROOT, `${entry.cellId}.atlas.png`), atlas);
      staged += 1;
    }
    results.push({ cellId: entry.cellId, status: "verified" });
  }

  const refused = results.filter((row) => row.status === "REFUSED");
  const absent = results.filter((row) => row.status === "bake-absent");
  if (refused.length > 0) {
    // THE OLD MESSAGE SAID "NOTHING further was staged", WHICH WAS NOT TRUE.
    // Verification and staging happen in the same loop, so every tile checked
    // before the first mismatch has ALREADY been written to the serving root.
    // What is actually withheld is the INVENTORY — and that is the part that
    // matters, because the runtime pins its digest and will not serve a tier
    // whose inventory is missing. Saying "nothing was staged" invited an
    // operator to believe the serving root was clean when it was not.
    console.error(`far-tier-stage: ${refused.length} tile(s) do not match the promoted inventory.`);
    if (staged > 0) {
      console.error(`  ${staged} tile(s) were ALREADY WRITTEN to the serving root before the mismatch was reached; they are still there.`);
    }
    console.error("  The INVENTORY was not written, so the tier cannot be served from this staging. Re-run with --unstage to clear the serving root.");
    for (const row of refused.slice(0, 5)) console.error(`  ${row.cellId}: ${row.detail}`);
    process.exit(1);
  }

  if (mode === "stage") {
    // THE STAGED INVENTORY IS THE COMMITTED BYTES. Copied, never re-serialized.
    await writeFile(join(SERVING_ROOT, "payload-inventory.json"), Buffer.from(inventoryText, "utf8"));
  }

  console.log(JSON.stringify({
    ok: true,
    mode,
    inventoryId: inventory.inventoryId,
    inventorySha256: inventoryDigest,
    declared: inventory.entries.length,
    verified: results.filter((row) => row.status === "verified").length,
    bakeAbsent: absent.length,
    refused: refused.length,
    staged,
    servingRoot: "public/far-tier",
    absentSample: absent.slice(0, 5).map((row) => row.cellId),
  }, null, 2));
}

/** Remove the staged tree, so a partial-stage fault arm starts from a known state. */
async function unstage() {
  await rm(SERVING_ROOT, { recursive: true, force: true });
  console.log(JSON.stringify({ ok: true, mode: "unstage", removed: "public/far-tier" }, null, 2));
}

if (process.argv.includes("--unstage")) await unstage();
else await main();
