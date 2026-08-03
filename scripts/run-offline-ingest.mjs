/* global console */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ingestFixtureText } from "../src/ingestion/offline.ts";
import { manhattanAdapter } from "../src/data/city-adapters.ts";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const fixturePath = resolve(projectRoot, "src/ingestion/fixtures/manhattan-slice.fixture.json");
const outputDirectory = resolve(projectRoot, "artifacts/offline-ingest/manhattan-flatiron-v1");
const fixtureText = await readFile(fixturePath, "utf8");
const result = await ingestFixtureText(fixtureText, {
  adapter: manhattanAdapter,
  inputFileName: "src/ingestion/fixtures/manhattan-slice.fixture.json",
  runId: "offline-run:manhattan-flatiron-fixture-v1",
  startedAt: "2026-08-03T00:00:00Z",
  finishedAt: "2026-08-03T00:00:01Z",
  ingestedAt: "2026-08-03T00:00:01Z",
});

await mkdir(outputDirectory, { recursive: true });
await writeFile(resolve(outputDirectory, "manifest.json"), result.manifestJson, { encoding: "utf8", flag: "wx" });
await writeFile(resolve(outputDirectory, "normalized-features.json"), `${JSON.stringify(result.features, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
await writeFile(resolve(outputDirectory, "adapter.json"), `${JSON.stringify(result.adapter, null, 2)}\n`, { encoding: "utf8", flag: "wx" });

console.log(JSON.stringify({
  outputDirectory: "artifacts/offline-ingest/manhattan-flatiron-v1",
  checksumSha256: result.manifest.inputChecksumSha256,
  acceptedCount: result.manifest.acceptedCount,
  rejectedCount: result.manifest.rejectedCount,
  rejectedRecordIndices: result.manifest.rejectionAccounting.rejectedRecordIndices,
}, null, 2));
