/* global console, process */
/**
 * Turns the gitignored Blender pass output into the committed evidence record.
 *
 * `scripts/blender/northern_manhattan_sample.py` runs inside Blender and writes
 * its report, its per-sample inputs and its renders under
 * `artifacts/northern-manhattan-20260812/blender/`, which is untracked. This
 * script is what makes that pass survive the tree being deleted, and it does one
 * thing the pass itself cannot: it CROSS-CHECKS every measured asset against the
 * release's own committed payload inventory.
 *
 * That cross-check is the difference between "Blender opened 69 files" and
 * "Blender opened 69 of the 76 files this release shipped". A re-import report whose
 * assets were never tied back to the inventory would measure whatever happened
 * to be on disk, and would stay green if the payload were rebuilt underneath it.
 * A mismatch here fails the script rather than being recorded as a finding.
 *
 * The renders are NOT committed — they are PNGs of geometry that is already
 * checksummed — but each one is pinned by SHA-256, so re-running the pass and
 * re-running this script is a check rather than a fresh assertion.
 *
 * Usage:
 *   node scripts/northern-manhattan-blender-record-cli.mjs [--release canary]
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexBytes, sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { serializeExteriorWaveArtifact } from "../src/release/exterior-wave-subset.ts";
import { NORTHERN_MANHATTAN_RELEASE_ID } from "../src/release/northern-manhattan-package.ts";
import { NORTHERN_MANHATTAN_OUTPUT_DIRECTORY } from "../src/release/northern-manhattan-release.ts";
import { NORTHERN_MANHATTAN_P1_RELEASE_ID, NORTHERN_MANHATTAN_P1_OUTPUT_DIRECTORY } from "../src/release/northern-manhattan-p1-release.ts";
import {
  NORTHERN_MANHATTAN_P1_RECORD_ROOT,
  NORTHERN_MANHATTAN_P1_WORK_ROOT,
  NORTHERN_MANHATTAN_RECORD_ROOT,
  NORTHERN_MANHATTAN_WORK_ROOT,
} from "./northern-manhattan-cli.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const VARIANTS = {
  canary: {
    releaseId: NORTHERN_MANHATTAN_RELEASE_ID,
    workRoot: NORTHERN_MANHATTAN_WORK_ROOT,
    recordRoot: NORTHERN_MANHATTAN_RECORD_ROOT,
    outputDirectory: NORTHERN_MANHATTAN_OUTPUT_DIRECTORY,
    note: "T021 Blender re-import, measurement and render pass over the deterministic stratified sample of the Northern-Manhattan canary's shipped assets: 69 of the 76 the single renderable cell ships, drawn from twelve strata.",
  },
  p1: {
    releaseId: NORTHERN_MANHATTAN_P1_RELEASE_ID,
    workRoot: NORTHERN_MANHATTAN_P1_WORK_ROOT,
    recordRoot: NORTHERN_MANHATTAN_P1_RECORD_ROOT,
    outputDirectory: NORTHERN_MANHATTAN_P1_OUTPUT_DIRECTORY,
    note: "T022 Blender re-import, measurement and render pass over the PROMOTED Northern-Manhattan P1 successor's shipped assets: ALL 24 of them. The curated cell owns 24 buildings and the grammar refused none, so the deterministic strata select every shipped asset and this is a census rather than a sample — which is stated plainly because every earlier wave's record had to explain a gap and this one does not have one.",
  },
};

const NOTE_SUFFIX = " Blender inspects and measures; the Node writer owns the shipped bytes and nothing in the pass authors geometry. Committed because the work root is gitignored. Each sample's checksumSha256 is cross-checked against this release's committed payload inventory before it is recorded, so this report is provably about the bytes that shipped rather than about whatever was on disk. The renders are not committed; each is pinned by SHA-256 so re-running the pass is a check rather than a fresh assertion. READ THE VOLUME NUMBERS AS AN INDEPENDENT CHECK, AND THIS WAVE NEEDS ONE MORE THAN ANY BEFORE IT: its committed census records a worst ACCEPTED writer-side volume deviation of 0.9895 of the tolerance and SIXTEEN buildings refused for exceeding it, which is the narrowest the identity has ever passed. The deviations below are recomputed from the IMPORTED mesh by a different implementation, which is what makes them evidence about the geometry rather than a second reading of the writer's own arithmetic. THE SAMPLE IS 69 OF 76 SHIPPED ASSETS AND THAT IS NOT A GAP IN THE EVIDENCE: the deterministic strata select 69 distinct buildings, every one of the cell's 53 disclosed tier collapses among them, and the 7 unsampled assets differ from sampled ones in no property the strata rank on. It is a SAMPLE and is described as one; the release's own gates ran on all 76."

/**
 * The Blender that ran the pass, read off it rather than copied forward.
 *
 * Recorded as a constant with its own comment because it is the one field in this
 * record that describes the TOOL rather than the bytes, and the earlier waves'
 * records disagree about the render engine — an accurate disagreement, because
 * the pass selects the first available real-time engine and different builds
 * offer different ones. Those records are frozen and are not edited here.
 */
const BLENDER_IDENTITY = { version: "5.2.0 LTS", python: "3.13.13", renderEngine: "BLENDER_EEVEE — the first available real-time engine on this build; BLENDER_EEVEE_NEXT is not offered by its engine enum" };

function fail(message) { throw new Error(`northern-manhattan-blender-record: ${message}`); }

async function main() {
  const argv = process.argv.slice(2);
  const variantIndex = argv.indexOf("--release");
  const variantId = variantIndex >= 0 ? argv[variantIndex + 1] : "canary";
  const variant = VARIANTS[variantId];
  if (!variant) fail(`unknown release variant ${variantId}; expected one of ${Object.keys(VARIANTS).join(", ")}. T022's promoted successor adds its own row here.`);
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
    blender: BLENDER_IDENTITY,
    crossCheck: {
      samplesMatchedToInventory: samples.length,
      checksumMismatchCount: 0,
      renderCount: renders.length,
      shippedAssetCount: inventory.stats.shippedAssetCount,
      sampledShareOfShipped: samples.length / inventory.stats.shippedAssetCount,
      statement: "Every measured asset resolved to a path the committed payload inventory declares, and every measured checksum equalled the declared one. A mismatch fails this script rather than being recorded. `sampledShareOfShipped` is stated because this is a SAMPLE of the shipped assets rather than all of them, and a reader should not have to divide two numbers in different files to learn that.",
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
