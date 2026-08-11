/* global console, process */
/**
 * Turns the gitignored Blender pass output into the committed evidence record.
 *
 * `scripts/blender/central_upper_manhattan_sample.py` runs inside Blender and
 * writes its report, its per-sample inputs and its renders under
 * `artifacts/central-upper-manhattan-20260812/blender/`, which is untracked. This
 * script is what makes that pass survive the tree being deleted, and it does one
 * thing the pass itself cannot: it CROSS-CHECKS every measured asset against the
 * release's own committed payload inventory.
 *
 * That cross-check is the difference between "Blender opened 67 files" and
 * "Blender opened the 67 files this release shipped". A re-import report whose
 * assets were never tied back to the inventory would measure whatever happened
 * to be on disk, and would stay green if the payload were rebuilt underneath it.
 * A mismatch here fails the script rather than being recorded as a finding.
 *
 * The renders are NOT committed — they are PNGs of geometry that is already
 * checksummed — but each one is pinned by SHA-256, so re-running the pass and
 * re-running this script is a check rather than a fresh assertion.
 *
 * Usage:
 *   node scripts/central-upper-manhattan-blender-record-cli.mjs [--release canary|p1]
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexBytes, sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { serializeExteriorWaveArtifact } from "../src/release/exterior-wave-subset.ts";
import { CENTRAL_UPPER_MANHATTAN_RELEASE_ID } from "../src/release/central-upper-manhattan-package.ts";
import { CENTRAL_UPPER_MANHATTAN_OUTPUT_DIRECTORY } from "../src/release/central-upper-manhattan-release.ts";
import { CENTRAL_UPPER_MANHATTAN_P1_OUTPUT_DIRECTORY, CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID } from "../src/release/central-upper-manhattan-p1-release.ts";
import {
  CENTRAL_UPPER_MANHATTAN_P1_RECORD_ROOT,
  CENTRAL_UPPER_MANHATTAN_P1_WORK_ROOT,
  CENTRAL_UPPER_MANHATTAN_RECORD_ROOT,
  CENTRAL_UPPER_MANHATTAN_WORK_ROOT,
} from "./central-upper-manhattan-cli.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const VARIANTS = {
  canary: {
    releaseId: CENTRAL_UPPER_MANHATTAN_RELEASE_ID,
    workRoot: CENTRAL_UPPER_MANHATTAN_WORK_ROOT,
    recordRoot: CENTRAL_UPPER_MANHATTAN_RECORD_ROOT,
    outputDirectory: CENTRAL_UPPER_MANHATTAN_OUTPUT_DIRECTORY,
    note: "T019 Blender re-import, measurement and render pass over the deterministic stratified sample of the Central-and-upper-Manhattan canary's shipped assets.",
  },
  p1: {
    releaseId: CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID,
    workRoot: CENTRAL_UPPER_MANHATTAN_P1_WORK_ROOT,
    recordRoot: CENTRAL_UPPER_MANHATTAN_P1_RECORD_ROOT,
    outputDirectory: CENTRAL_UPPER_MANHATTAN_P1_OUTPUT_DIRECTORY,
    note: "T020 Blender re-import, measurement and render pass over the PROMOTED curated subset. The subset ships 40 assets and the deterministic stratified sample selects every one of them, so this is a whole-release pass rather than a sample of one — including the asset carrying the subset's WORST writer-side volume margin, which is the one ADR 0036 asked to be corroborated independently.",
  },
};

const NOTE_SUFFIX = " Blender inspects and measures; the Node writer owns the shipped bytes and nothing in the pass authors geometry. Committed because the work root is gitignored. Each sample's checksumSha256 is cross-checked against this release's committed payload inventory before it is recorded, so this report is provably about the bytes that shipped rather than about whatever was on disk. The renders are not committed; each is pinned by SHA-256 so re-running the pass is a check rather than a fresh assertion. READ THE VOLUME NUMBERS AS AN INDEPENDENT CHECK: this wave's committed census records a worst writer-side volume deviation of 0.988 of the accepted tolerance across the whole wave, so the identity passed narrowly there. The deviations below are recomputed from the IMPORTED mesh by a different implementation, which is what makes them evidence about the geometry rather than a second reading of the writer's own arithmetic."

function fail(message) { throw new Error(`central-upper-manhattan-blender-record: ${message}`); }

async function main() {
  const argv = process.argv.slice(2);
  const variantIndex = argv.indexOf("--release");
  const variantId = variantIndex >= 0 ? argv[variantIndex + 1] : "canary";
  const variant = VARIANTS[variantId];
  if (!variant) fail(`unknown release variant ${variantId}; expected one of ${Object.keys(VARIANTS).join(", ")}.`);
  const blenderRoot = join(repositoryRoot, variant.workRoot, "blender");
  const recordRoot = join(repositoryRoot, variant.recordRoot);
  const payloadRoot = join(repositoryRoot, variant.outputDirectory);

  const report = JSON.parse(await readFile(join(blenderRoot, "inspection.json"), "utf8"));
  if (report.releaseId !== variant.releaseId) {
    fail(`the Blender report describes ${report.releaseId}, not ${variant.releaseId}.`);
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
    releaseId: variant.releaseId,
    note: variant.note + NOTE_SUFFIX,
    // Read off the running Blender rather than copied forward. The earlier waves'
    // records say "EEVEE Next on this build"; on the Blender that ran THIS pass
    // the engine enum offers only BLENDER_EEVEE, so the pass's first-available
    // selection resolved to that. Those records are frozen bytes and are not
    // edited here, but this one states what was actually measured.
    blender: { version: "5.2.0 LTS", python: "3.13.13", renderEngine: "BLENDER_EEVEE — the first available real-time engine on this build; BLENDER_EEVEE_NEXT is not offered by its engine enum" },
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
    outPath: join(variant.recordRoot, "blender-sample.json"),
    outChecksumSha256: sha256HexSync(text),
    sampleCount: samples.length,
    renderCount: renders.length,
  }, null, 2));
}

await main();
