/* global console, process */

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AreaSnapshotAdapter } from "../src/ingestion/area-snapshot.ts";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--") continue;
    if (!key?.startsWith("--")) throw new Error(`Unexpected argument: ${key ?? ""}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    args[key.slice(2)] = value;
    index += 1;
  }
  return args;
}

function required(args, key) {
  const value = args[key];
  if (!value) throw new Error(`--${key} is required`);
  return value;
}

const args = parseArgs(process.argv.slice(2));
const inputValue = required(args, "input");
const outputValue = required(args, "output");
if (inputValue.includes("://") || outputValue.includes("://")) throw new Error("Area ingest accepts local filesystem paths only; URLs are refused.");
const inputPath = resolve(inputValue);
const outputPath = resolve(outputValue);
const checksum = required(args, "checksum");
const ingestedAt = required(args, "ingested-at");
if (Number.isNaN(Date.parse(ingestedAt))) throw new Error("--ingested-at must be an ISO timestamp");
if (inputPath === outputPath) throw new Error("--input and --output must be different paths");

try {
  await access(outputPath);
  throw new Error(`Refusing to overwrite immutable output directory: ${outputPath}`);
} catch (error) {
  if (error instanceof Error && error.message.startsWith("Refusing")) throw error;
}

const snapshotText = await readFile(inputPath, "utf8");
const adapter = await AreaSnapshotAdapter.fromSnapshot({
  snapshotText,
  metadata: { inputFileName: inputPath, inputChecksumSha256: checksum, ingestedAt, immutable: true, fixtureOnly: false },
});
const outputs = {
  manifest: `${outputPath}/manifest.json`,
  features: `${outputPath}/normalized-features.json`,
  layerManifest: `${outputPath}/layer-manifest-areas.json`,
};
await mkdir(outputPath, { recursive: false });
for (const output of Object.values(outputs)) {
  try {
    await access(output);
    throw new Error(`Refusing to overwrite immutable output: ${output}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Refusing")) throw error;
  }
}
const report = adapter.getIngestionReport();
await writeFile(outputs.manifest, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
await writeFile(outputs.features, `${JSON.stringify(await adapter.loadLayerFeatures("areas"), null, 2)}\n`, { encoding: "utf8", flag: "wx" });
await writeFile(outputs.layerManifest, `${JSON.stringify(report.layerManifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({ outputPath, checksumSha256: report.inputChecksumSha256, acceptedAreas: report.acceptedAreaCount, rejectedRecords: report.rejectedCount, rejectedRecordIndices: report.rejectedRecordIndices }, null, 2));
