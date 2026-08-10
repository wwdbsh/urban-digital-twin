/* global TextDecoder, console, process */
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { replayMultiLodAssembly, validateMultiLodAssembly } from "../src/release/multi-lod-assembly.ts";

const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_CLI_TOTAL_BYTES = 256 * 1024 * 1024;
function fail(message) { throw new Error(message); }
/** Value-less switches; every other `--flag` still requires an explicit value. */
const BOOLEAN_FLAGS = new Set(["require-texture-free"]);
function args(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]; if (!token?.startsWith("--")) continue;
    // `--flag=value` is accepted for both forms so a boolean switch written
    // with an explicit value is never silently ignored.
    const equals = token.indexOf("=");
    const name = equals === -1 ? token.slice(2) : token.slice(2, equals);
    const inline = equals === -1 ? null : token.slice(equals + 1);
    if (BOOLEAN_FLAGS.has(name)) {
      if (inline === null) { result[name] = true; continue; }
      if (inline !== "true" && inline !== "false") fail(`Boolean flag --${name} accepts only true or false.`);
      result[name] = inline === "true"; continue;
    }
    if (inline !== null) { if (inline.length === 0) fail(`Missing value for --${name}.`); result[name] = inline; continue; }
    const value = argv[index + 1]; if (!value || value.startsWith("--")) fail(`Missing value for ${token}.`);
    result[name] = value; index += 1;
  }
  return result;
}
async function boundedFile(path, label, expectedBytes, maximumBytes) {
  const before = await lstat(path); if (!before.isFile() || before.isSymbolicLink()) fail(`${label} must be a regular non-symlink file.`);
  if (before.size !== expectedBytes || before.size > maximumBytes) fail(`${label} byte size differs from its bounded declaration.`);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat(); if (!opened.isFile() || opened.size !== expectedBytes || opened.dev !== before.dev || opened.ino !== before.ino) fail(`${label} changed before its bounded read.`);
    const bytes = new Uint8Array(expectedBytes); let offset = 0;
    while (offset < bytes.byteLength) { const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset); if (bytesRead === 0) fail(`${label} ended before its declared byte size.`); offset += bytesRead; }
    const extra = new Uint8Array(1); if ((await handle.read(extra, 0, 1, offset)).bytesRead !== 0) fail(`${label} exceeds its declared byte size.`);
    return bytes;
  } finally { await handle.close(); }
}
function contained(root, candidate) {
  const path = relative(root, candidate); return path.length > 0 && !path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path);
}

async function main() {
  const options = args(process.argv.slice(2)); if (!options.manifest) fail("Usage: pnpm multi-lod:validate -- --manifest FILE [--content-root DIR] [--require-texture-free]");
  // Additive only: the flag can force the embedded-image gate on a private
  // package, and can never relax the gate a public package always carries.
  const policy = { requireTextureFreeAssembly: options["require-texture-free"] === true };
  const manifestPath = resolve(options.manifest); const manifestStat = await lstat(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > MAX_MANIFEST_BYTES) fail("Manifest must be a bounded regular non-symlink file.");
  const manifestBytes = await boundedFile(manifestPath, "Manifest", manifestStat.size, MAX_MANIFEST_BYTES);
  const manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes));
  const shape = validateMultiLodAssembly(manifest, policy); if (!shape.ok) fail(shape.issues.map((item) => `${item.path}: ${item.message}`).join("\n"));
  if (shape.value.declaredTotalBytes > MAX_CLI_TOTAL_BYTES) fail(`CLI replay exceeds its ${MAX_CLI_TOTAL_BYTES}-byte memory bound.`);
  const root = await realpath(resolve(options["content-root"] ?? dirname(manifestPath))); const contents = new Map(); let loadedBytes = 0;
  for (const artifact of [...shape.value.artifacts].sort((a, b) => a.relativeRef.localeCompare(b.relativeRef))) {
    const path = resolve(root, ...artifact.relativeRef.split("/")); if (!contained(root, path)) fail(`Artifact escapes content root: ${artifact.relativeRef}`);
    const candidate = await lstat(path); if (!candidate.isFile() || candidate.isSymbolicLink() || candidate.size !== artifact.byteSize) fail(`Artifact size/type differs before read: ${artifact.relativeRef}`);
    const resolved = await realpath(path); if (!contained(root, resolved)) fail(`Artifact resolves outside content root: ${artifact.relativeRef}`);
    const bytes = await boundedFile(resolved, artifact.relativeRef, artifact.byteSize, MAX_CLI_TOTAL_BYTES); loadedBytes += bytes.byteLength;
    if (loadedBytes > MAX_CLI_TOTAL_BYTES) fail("CLI replay exceeded its aggregate byte bound."); contents.set(artifact.relativeRef, bytes);
  }
  const replay = await replayMultiLodAssembly(shape.value, contents, policy); if (!replay.ok) fail(replay.issues.map((item) => `${item.path}: ${item.message}`).join("\n"));
  console.log(JSON.stringify({ ok: true, packageId: replay.value.manifest.packageId, audience: replay.value.manifest.audience, textureFreeEnforced: replay.value.manifest.audience === "public" || policy.requireTextureFreeAssembly, artifacts: replay.value.verifiedArtifacts.length, totalBytes: replay.value.totalBytes, fingerprintSha256: replay.value.fingerprintSha256 }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
