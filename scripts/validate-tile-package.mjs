import { readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { validateCityTilePackage, isSafeRelativeContentRef } from "../src/runtime/tile-package.ts";
import { sha256Hex } from "../src/ingestion/offline.ts";

function args(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--") continue;
    if (!argv[index]?.startsWith("--")) continue;
    result[argv[index].slice(2)] = argv[index + 1];
    index += 1;
  }
  return result;
}

const values = args(globalThis.process.argv.slice(2));
if (!values.input || !values["content-root"]) throw new Error("Usage: pnpm tile:validate -- --input <local-package.json> --content-root <local-content-directory>");
if (String(values.input).includes("://") || String(values["content-root"]).includes("://")) throw new Error("Tile package validation accepts local paths only; URLs are refused.");

const inputPath = resolve(values.input);
const contentRoot = resolve(values["content-root"]);
const packageValue = JSON.parse(await readFile(inputPath, "utf8"));
const packageResult = validateCityTilePackage(packageValue);
if (!packageResult.ok) throw new Error(`Tile package validation failed: ${packageResult.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);

let checkedBytes = 0;
for (const manifest of packageResult.value.tiles) {
  if (!isSafeRelativeContentRef(manifest.relativeContentRef)) throw new Error(`Unsafe tile content reference: ${manifest.relativeContentRef}`);
  const contentPath = resolve(contentRoot, manifest.relativeContentRef);
  const relativePath = relative(contentRoot, contentPath);
  if (isAbsolute(relativePath) || relativePath.startsWith("..")) throw new Error(`Tile content escapes the declared content root: ${manifest.relativeContentRef}`);
  const content = await readFile(contentPath, "utf8");
  const contentBytes = new globalThis.TextEncoder().encode(content).byteLength;
  checkedBytes += contentBytes;
  if (contentBytes !== manifest.byteSize) throw new Error(`Tile byte size mismatch: ${manifest.contentId}`);
  if (await sha256Hex(content) !== manifest.checksumSha256.toLowerCase()) throw new Error(`Tile checksum mismatch: ${manifest.contentId}`);
}

globalThis.console.log(JSON.stringify({ packageId: packageResult.value.packageId, fixtureOnly: packageResult.value.fixtureOnly, tileCount: packageResult.value.tiles.length, checkedBytes, network: false, outputWritten: false }, null, 2));
