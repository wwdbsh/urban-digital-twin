/* global console, process, Buffer */
/**
 * T005 — merge the six sealed wave inventories into the promoted inventory the
 * runtime pins.
 *
 * It reads COMMITTED TEXT ONLY. Not the staged bytes, not a directory listing:
 * every entry comes from a per-wave inventory that its own byte replay sealed,
 * and every wave record is checksum-verified against its sidecar first. A
 * promotion assembled from whatever happens to be on disk would pin a digest
 * for an island nobody sealed.
 *
 * Usage: node --experimental-strip-types scripts/far-tier-promote-cli.mjs merge
 */

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { mergeFarTierWaveInventories, serializeFarTierInventory } from "../src/release/far-tier-promoted-inventory.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CAMPAIGN_ID = "far-tier-hlod-mass-20260819";
const PROMOTION_ID = "far-tier-hlod-promotion-20260819";
const campaignRoot = join(repositoryRoot, "data", CAMPAIGN_ID);
const promotionRoot = join(repositoryRoot, "data", PROMOTION_ID);
const WAVE_IDS = ["w00", "w01", "w02", "w03", "w04", "w05"];
const TOOL = "far-tier-promote";

const fail = (message) => { console.error(`${TOOL}: ${message}`); process.exit(1); };
const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** Read a committed record and verify it against its own sidecar before using it. */
async function readVerified(root, name) {
  const text = await readFile(join(root, `${name}.json`), "utf8");
  const declared = (await readFile(join(root, `${name}.sha256`), "utf8")).trim().split(/\s+/u)[0];
  const actual = sha256HexSync(text);
  if (declared !== actual) fail(`${name}.json does not match its own sha256 sidecar (${actual} against ${declared}).`);
  return { text, json: JSON.parse(text), sha256: actual };
}

async function commandMerge() {
  const summary = await readVerified(campaignRoot, "campaign-summary");
  const waves = [];
  const honestStopCellIds = [];
  for (const waveId of WAVE_IDS) {
    const inventory = await readVerified(campaignRoot, `inventory-${waveId}`);
    const telemetry = await readVerified(campaignRoot, `telemetry-${waveId}`);
    if (inventory.json.waveId !== waveId || telemetry.json.waveId !== waveId) {
      fail(`wave ${waveId}'s records do not both declare that wave.`);
    }
    if (inventory.json.recipeSha256 !== summary.json.recipe.recipeSha256) {
      fail(`wave ${waveId} was baked under recipe ${inventory.json.recipeSha256}, not the campaign's ${summary.json.recipe.recipeSha256}; a promotion must not mix recipes.`);
    }
    waves.push({ waveId, entries: inventory.json.entries, recordSha256: inventory.sha256 });
    for (const stop of telemetry.json.honestStops) honestStopCellIds.push(stop.cellId);
  }

  let promoted;
  try {
    promoted = mergeFarTierWaveInventories({
      waves,
      honestStopCellIds,
      ledgerCellCount: summary.json.totals.ledgerCells,
      ledgerChecksumSha256: summary.json.parentLedgerChecksumSha256,
      recipeId: summary.json.recipe.recipeId,
      recipeSha256: summary.json.recipe.recipeSha256,
      campaignSummarySha256: summary.sha256,
    });
  } catch (error) {
    fail(error.message);
  }

  const text = serializeFarTierInventory(promoted);
  await mkdir(promotionRoot, { recursive: true });
  await writeFile(join(promotionRoot, "promoted-inventory.json"), text);
  await writeFile(join(promotionRoot, "promoted-inventory.sha256"), `${sha256HexSync(text)}  promoted-inventory.json\n`);

  const memberCount = promoted.entries.reduce((sum, entry) => sum + entry.members.length, 0);
  const excludedMembers = promoted.entries.reduce((sum, entry) => sum + entry.members.filter((member) => !member.included).length, 0);
  console.log(serialize({
    ok: true,
    entries: promoted.entries.length,
    honestStops: promoted.coverage.honestStopCells,
    accountedFor: promoted.coverage.accountedFor,
    ledgerCellCount: promoted.coverage.ledgerCellCount,
    memberCount,
    excludedMembers,
    inventorySha256: sha256HexSync(text),
    byteSize: Buffer.byteLength(text),
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2] ?? "merge";
  if (command !== "merge") fail("usage: far-tier-promote-cli.mjs merge");
  await commandMerge();
}
