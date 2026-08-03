/* global process, console */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { RouteGraphSnapshotAdapter } from "../src/ingestion/route-graph-snapshot.ts";
import { sha256Hex } from "../src/ingestion/offline.ts";

function args(argv) { const result = {}; for (let index = 0; index < argv.length; index += 1) { const arg = argv[index]; if (arg === "--") continue; if (!arg.startsWith("--")) continue; result[arg.slice(2)] = argv[index + 1]; index += 1; } return result; }
const values = args(process.argv.slice(2)); const inputValue = values.input; const outputValue = values.output; const checksum = values.checksum; const ingestedAt = values["ingested-at"];
if (!inputValue || !outputValue || !checksum || !ingestedAt) throw new Error("Usage: pnpm route:ingest -- --input <local-file> --output <new-dir> --checksum <sha256> --ingested-at <ISO> [--fixture-only]");
if (inputValue.includes("://")) throw new Error("Route graph ingest accepts local files only; URLs and network locations are refused.");
const inputPath = resolve(inputValue); const outputPath = resolve(outputValue); if (existsSync(outputPath)) throw new Error(`Refusing to overwrite existing output directory: ${outputPath}`);
const snapshotText = readFileSync(inputPath, "utf8"); if (await sha256Hex(snapshotText) !== checksum.toLowerCase()) throw new Error("Route graph checksum does not match recorded metadata.");
const adapter = await RouteGraphSnapshotAdapter.fromSnapshot({ snapshotText, metadata: { inputFileName: inputPath, inputChecksumSha256: checksum, ingestedAt, immutable: true, fixtureOnly: values["fixture-only"] === "true" } });
mkdirSync(outputPath, { recursive: true }); writeFileSync(resolve(outputPath, "route-graph.json"), `${JSON.stringify(adapter.graph, null, 2)}\n`, { flag: "wx" }); writeFileSync(resolve(outputPath, "manifest.json"), `${JSON.stringify(adapter.getIngestionReport(), null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ outputPath, acceptedNodes: adapter.getIngestionReport().acceptedNodeCount, acceptedEdges: adapter.getIngestionReport().acceptedEdgeCount, rejected: adapter.getIngestionReport().rejectedRecordIndices.length }));
