/* global console, process */

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getSourceRegistryEntry } from "../src/data/source-registry.ts";
import { NycBuildingFootprintsSnapshotAdapter } from "../src/ingestion/nyc-building-footprints.ts";

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

function nullableTimestamp(value) {
  if (value === "null") return null;
  required({ value }, "value");
  if (Number.isNaN(Date.parse(value))) throw new Error(`Invalid timestamp: ${value}`);
  return value;
}

const args = parseArgs(process.argv.slice(2));
const inputPath = resolve(required(args, "input"));
const outputPath = resolve(required(args, "output"));
const checksum = required(args, "checksum");
const termsUrl = required(args, "terms-url");
const inputCrs = required(args, "input-crs");
if (inputCrs !== "EPSG:4326" && inputCrs !== "EPSG:3857") throw new Error("--input-crs must be EPSG:4326 or EPSG:3857");
const heightUnit = required(args, "height-unit");
if (heightUnit !== "feet" && heightUnit !== "meters" && heightUnit !== "unknown") throw new Error("--height-unit must be feet, meters, or unknown");
const groundElevationUnit = required(args, "ground-elevation-unit");
if (groundElevationUnit !== "feet" && groundElevationUnit !== "meters" && groundElevationUnit !== "unknown") throw new Error("--ground-elevation-unit must be feet, meters, or unknown");
if (inputPath === outputPath) throw new Error("--input and --output must be different paths");

const registryEntry = getSourceRegistryEntry("nyc.building-footprints");
if (!registryEntry) throw new Error("nyc.building-footprints is missing from the source registry");
const snapshotText = await readFile(inputPath, "utf8");
const adapter = await NycBuildingFootprintsSnapshotAdapter.fromSnapshot({
  snapshotText,
  metadata: {
    sourceRegistryEntryId: registryEntry.id,
    inputFileName: inputPath,
    inputChecksumSha256: checksum,
    termsUrl,
    attribution: registryEntry.attribution,
    releaseTimestamp: nullableTimestamp(required(args, "release")),
    captureTimestamp: nullableTimestamp(required(args, "capture")),
    updateTimestamp: nullableTimestamp(required(args, "updated")),
    ingestedAt: nullableTimestamp(required(args, "ingested-at")) ?? new Date(0).toISOString(),
    inputCrs,
    verticalDatum: required(args, "vertical-datum"),
    heightUnit,
    groundElevationUnit,
    fixtureOnly: false,
    immutable: true,
  },
});

const outputs = {
  manifest: `${outputPath}/manifest.json`,
  features: `${outputPath}/normalized-features.json`,
  layerManifest: `${outputPath}/layer-manifest-buildings.json`,
};
for (const output of Object.values(outputs)) {
  try {
    await access(output);
    throw new Error(`Refusing to overwrite immutable output: ${output}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Refusing")) throw error;
  }
}
await mkdir(outputPath, { recursive: true });
const report = adapter.getIngestionReport();
await writeFile(outputs.manifest, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
await writeFile(outputs.features, `${JSON.stringify(await adapter.loadLayerFeatures("buildings"), null, 2)}\n`, { encoding: "utf8", flag: "wx" });
await writeFile(outputs.layerManifest, `${JSON.stringify(report.layerManifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({
  outputPath,
  checksumSha256: report.inputChecksumSha256,
  acceptedRecords: report.acceptedCount,
  acceptedFeatures: report.acceptedFeatureCount,
  rejectedRecords: report.rejectedCount,
  rejectedRecordIndices: report.rejectedRecordIndices,
}, null, 2));
