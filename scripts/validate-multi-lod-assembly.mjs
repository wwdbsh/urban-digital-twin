/* global TextDecoder, console, process */
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { replayMultiLodAssembly, validateMultiLodAssembly } from "../src/release/multi-lod-assembly.ts";

const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
function fail(message) { throw new Error(message); }
function args(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]; if (!token?.startsWith("--")) continue;
    const value = argv[index + 1]; if (!value || value.startsWith("--")) fail(`Missing value for ${token}.`);
    result[token.slice(2)] = value; index += 1;
  }
  return result;
}
async function regularFile(path, label) {
  const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink()) fail(`${label} must be a regular non-symlink file.`);
}
function contained(root, candidate) {
  const path = relative(root, candidate); return path.length > 0 && !path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path);
}

async function main() {
  const options = args(process.argv.slice(2)); if (!options.manifest) fail("Usage: pnpm multi-lod:validate -- --manifest FILE [--content-root DIR]");
  const manifestPath = resolve(options.manifest); await regularFile(manifestPath, "Manifest");
  const manifestBytes = await readFile(manifestPath); if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) fail("Manifest exceeds the validation cap.");
  const manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes));
  const shape = validateMultiLodAssembly(manifest); if (!shape.ok) fail(shape.issues.map((item) => `${item.path}: ${item.message}`).join("\n"));
  const root = await realpath(resolve(options["content-root"] ?? dirname(manifestPath))); const contents = new Map();
  for (const artifact of [...shape.value.artifacts].sort((a, b) => a.relativeRef.localeCompare(b.relativeRef))) {
    const path = resolve(root, ...artifact.relativeRef.split("/")); if (!contained(root, path)) fail(`Artifact escapes content root: ${artifact.relativeRef}`);
    await regularFile(path, artifact.relativeRef); const resolved = await realpath(path); if (!contained(root, resolved)) fail(`Artifact resolves outside content root: ${artifact.relativeRef}`);
    const bytes = await readFile(resolved); contents.set(artifact.relativeRef, new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  }
  const replay = await replayMultiLodAssembly(shape.value, contents); if (!replay.ok) fail(replay.issues.map((item) => `${item.path}: ${item.message}`).join("\n"));
  console.log(JSON.stringify({ ok: true, packageId: replay.value.manifest.packageId, audience: replay.value.manifest.audience, artifacts: replay.value.verifiedArtifacts.length, totalBytes: replay.value.totalBytes, fingerprintSha256: replay.value.fingerprintSha256 }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
