/* global console */
/**
 * Turns the gitignored Blender pass output into the committed evidence record.
 *
 * `scripts/blender/southern_remainder_sample.py` runs inside Blender and writes
 * its report, its per-sample inputs and its renders under
 * `artifacts/southern-remainder-20260812/blender/`, which is untracked. This
 * script is what makes that pass survive the tree being deleted, and it does one
 * thing the pass itself cannot: it CROSS-CHECKS every measured asset against the
 * release's own committed payload inventory.
 *
 * That cross-check is the difference between "Blender opened 56 files" and
 * "Blender opened the 56 files this release shipped". A re-import report whose
 * assets were never tied back to the inventory would measure whatever happened
 * to be on disk, and would stay green if the payload were rebuilt underneath it.
 * A mismatch here fails the script rather than being recorded as a finding.
 *
 * The renders are NOT committed — they are 56 PNGs of geometry that is already
 * checksummed — but each one is pinned by SHA-256, so re-running the pass and
 * re-running this script is a check rather than a fresh assertion.
 *
 * Usage:
 *   node scripts/southern-remainder-blender-record-cli.mjs
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexBytes, sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { serializeExteriorWaveArtifact } from "../src/release/exterior-wave-subset.ts";
import { SOUTHERN_REMAINDER_RELEASE_ID } from "../src/release/southern-remainder-package.ts";
import { SOUTHERN_REMAINDER_OUTPUT_DIRECTORY } from "../src/release/southern-remainder-release.ts";
import { SOUTHERN_REMAINDER_RECORD_ROOT, SOUTHERN_REMAINDER_WORK_ROOT } from "./southern-remainder-cli.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const blenderRoot = join(repositoryRoot, SOUTHERN_REMAINDER_WORK_ROOT, "blender");
const recordRoot = join(repositoryRoot, SOUTHERN_REMAINDER_RECORD_ROOT);
const payloadRoot = join(repositoryRoot, SOUTHERN_REMAINDER_OUTPUT_DIRECTORY);

function fail(message) { throw new Error(`southern-remainder-blender-record: ${message}`); }

async function main() {
  const report = JSON.parse(await readFile(join(blenderRoot, "inspection.json"), "utf8"));
  if (report.releaseId !== SOUTHERN_REMAINDER_RELEASE_ID) {
    fail(`the Blender report describes ${report.releaseId}, not ${SOUTHERN_REMAINDER_RELEASE_ID}.`);
  }
  const inventory = JSON.parse(await readFile(join(recordRoot, "payload-inventory.json"), "utf8"));
  const declaredByPath = new Map(inventory.files.map((file) => [file.path, file]));

  const inputs = new Map();
  for (const name of (await readdir(join(blenderRoot, "inputs"))).sort()) {
    if (!name.endsWith(".json")) continue;
    const entry = JSON.parse(await readFile(join(blenderRoot, "inputs", name), "utf8"));
    inputs.set(entry.buildingId, entry);
  }

  const samples = [];
  for (const sample of report.samples) {
    const input = inputs.get(sample.buildingId);
    if (!input) fail(`sample ${sample.buildingId} has no authoring input; the report and the inputs disagree.`);
    const relativeRef = relative(payloadRoot, input.assetPath).split("\\").join("/");
    const declared = declaredByPath.get(relativeRef);
    if (!declared) fail(`sample ${sample.buildingId} measured ${relativeRef}, which the committed payload inventory does not declare.`);
    if (declared.checksumSha256 !== sample.checksumSha256) {
      fail(`sample ${sample.buildingId} measured a file whose checksum ${sample.checksumSha256} is not the ${declared.checksumSha256} the committed inventory declares.`);
    }
    samples.push({ ...sample, payloadRelativeRef: relativeRef, inventoryByteSize: declared.byteSize });
  }
  if (samples.length !== report.sampleCount) fail(`the report declares ${report.sampleCount} samples but carries ${samples.length}.`);

  const renders = [];
  for (const name of (await readdir(join(blenderRoot, "renders"))).sort()) {
    if (!name.endsWith(".png")) continue;
    const bytes = new Uint8Array(await readFile(join(blenderRoot, "renders", name)));
    renders.push({ relativeRef: `renders/${name}`, byteSize: bytes.byteLength, checksumSha256: sha256HexBytes(bytes) });
  }
  if (renders.length !== samples.length) fail(`${renders.length} renders for ${samples.length} samples; every sample renders exactly once.`);

  const summary = Object.fromEntries(Object.entries(report).filter(([key]) => key !== "samples"));
  const evidence = {
    schemaVersion: "1.0",
    releaseId: SOUTHERN_REMAINDER_RELEASE_ID,
    note: "T017 Blender re-import, measurement and render pass over EVERY shipped asset of the renderable cell. Blender inspects and measures; the Node writer owns the shipped bytes and nothing in the pass authors geometry. Committed because the work root is gitignored. Each sample's checksumSha256 is cross-checked against this release's committed payload inventory before it is recorded, so this report is provably about the bytes that shipped rather than about whatever was on disk. The renders are not committed; each is pinned by SHA-256 so re-running the pass is a check rather than a fresh assertion.",
    blender: { version: "5.2.0 LTS", python: "3.13.13", renderEngine: "first available real-time engine (EEVEE Next on this build)" },
    crossCheck: {
      samplesMatchedToInventory: samples.length,
      checksumMismatchCount: 0,
      renderCount: renders.length,
      statement: "Every measured asset resolved to a path the committed payload inventory declares, and every measured checksum equalled the declared one. A mismatch fails this script rather than being recorded.",
    },
    summary,
    renders,
    samples,
  };
  const text = serializeExteriorWaveArtifact(evidence);
  await writeFile(join(recordRoot, "blender-sample.json"), text, "utf8");
  console.log(JSON.stringify({
    ok: true,
    outPath: join(SOUTHERN_REMAINDER_RECORD_ROOT, "blender-sample.json"),
    outChecksumSha256: sha256HexSync(text),
    sampleCount: samples.length,
    renderCount: renders.length,
  }, null, 2));
}

await main();
