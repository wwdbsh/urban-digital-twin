/* global console, process */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getSourceRegistryEntry } from "../src/data/source-registry.ts";
import { reconcileObservations, validateReconciliationInput } from "../src/domain/reconciliation.ts";

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
  if (!args[key]) throw new Error(`--${key} is required`);
  return args[key];
}

function rejectUnsafePath(value, label, allowAbsolute = false) {
  if (/^https?:\/\//i.test(value) || value.includes("://")) throw new Error(`${label} accepts local filesystem paths only; URLs are refused.`);
  if ((!allowAbsolute && value.startsWith("/")) || value === "/" || value.includes("..") || value.includes("\\")) throw new Error(`${label} must be a safe traversal-free path.`);
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const args = parseArgs(process.argv.slice(2));
const inputValue = required(args, "input");
const outputValue = required(args, "output");
rejectUnsafePath(inputValue, "--input");
rejectUnsafePath(outputValue, "--output", true);
const inputChecksumSha256 = required(args, "checksum").toLocaleLowerCase();
const sourceRegistryEntryIds = required(args, "source-registry-id").split(",").map((value) => value.trim()).filter(Boolean);
const ingestedAt = required(args, "ingested-at");
const fixtureOnly = args["fixture-only"] === "true";
if (!/^[a-f0-9]{64}$/.test(inputChecksumSha256)) throw new Error("--checksum must be a SHA-256 checksum.");
if (Number.isNaN(Date.parse(ingestedAt))) throw new Error("--ingested-at must be an ISO timestamp.");
if (inputValue === outputValue) throw new Error("--input and --output must be different paths.");

const inputPath = resolve(inputValue);
const outputPath = resolve(outputValue);
try {
  await access(outputPath);
  throw new Error(`Refusing to overwrite immutable output: ${outputPath}`);
} catch (error) {
  if (error instanceof Error && error.message.startsWith("Refusing")) throw error;
}

const snapshotText = await readFile(inputPath, "utf8");
const actualChecksum = sha256(snapshotText);
if (actualChecksum !== inputChecksumSha256) throw new Error(`Checksum mismatch: expected ${inputChecksumSha256}, got ${actualChecksum}.`);
const parsed = JSON.parse(snapshotText);
if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray(parsed.observations)) throw new Error("Snapshot must be an object with an observations array.");
const metadata = { inputFileName: inputValue, inputChecksumSha256, snapshotChecksumSha256: actualChecksum, sourceRegistryEntryIds, ingestedAt, fixtureOnly };
const metadataValidation = validateReconciliationInput(metadata);
if (!metadataValidation.ok) throw new Error(metadataValidation.issues.join(" "));
sourceRegistryEntryIds.forEach((id) => {
  const entry = getSourceRegistryEntry(id);
  if (!entry || entry.approval.state !== "approved") throw new Error(`Source remains pending: ${id}`);
});
const result = reconcileObservations(parsed.observations, { fixtureOnly, now: ingestedAt });
if (result.rejected.some((record) => record.code === "schema-invalid" || record.code === "malformed")) throw new Error("Malformed observations are refused before output; correct the snapshot and retry.");
await mkdir(outputPath, { recursive: false });
await writeFile(`${outputPath}/catalog.json`, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
await writeFile(`${outputPath}/manifest.json`, `${JSON.stringify({ schemaVersion: "1.0", immutable: true, fixtureOnly, inputFileName: inputValue, inputChecksumSha256, sourceRegistryEntryIds, ingestedAt, quality: result.quality }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({ outputPath, inputChecksumSha256, canonicalEntities: result.quality.canonicalEntityCount, sourceObservations: result.quality.sourceObservationCount, rejectedRecords: result.quality.rejectedRecordCount }, null, 2));
