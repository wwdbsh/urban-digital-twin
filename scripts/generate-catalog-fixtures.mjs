/* global console, process */
import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildSyntheticCatalogArtifacts } from "../src/release/fixtures.ts";

const argv = process.argv.slice(2); const outputValue = argv[argv.indexOf("--output") + 1]; const release = argv[argv.indexOf("--release") + 1] ?? "v1";
if (!outputValue || outputValue.startsWith("--")) throw new Error("--output is required");
if (outputValue.includes("://") || outputValue.includes("..") || outputValue.includes("\\") || outputValue === "/") throw new Error("Fixture output must be a safe local path.");
const outputPath = resolve(outputValue);
try { await access(outputPath); throw new Error(`Refusing to overwrite existing fixture directory: ${outputPath}`); } catch (error) { if (error instanceof Error && error.message.startsWith("Refusing")) throw error; if (error?.code !== "ENOENT") throw error; }
await mkdir(outputPath, { recursive: false });
const artifacts = buildSyntheticCatalogArtifacts(release === "v2" ? "v2" : "v1");
for (const artifact of artifacts) await writeFile(`${outputPath}/${artifact.artifactId}.json`, `${JSON.stringify(artifact, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ outputPath, release, artifacts: artifacts.map((artifact) => artifact.artifactId) }, null, 2));
