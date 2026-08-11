/* global console, process */
/**
 * Emits the Block 835 public-audience canary exterior-cell release
 * `manhattan-exterior-cells-20260811` into the local public data root.
 *
 * Input is the private generated-exterior package
 * `manhattan-esb-block-reference-20260811`; the input package is opened
 * read-only and is never modified. Output is fully deterministic:
 * `src/release/block835-canary-release.test.ts` re-generates it and asserts
 * byte equality with the emitted files, so this script and that module are the
 * single source of truth for the emitted directory.
 *
 * Private-audience artifacts are declared by the release graph but are never
 * written to disk, so no private byte reaches a browser-reachable root.
 *
 * Usage:
 *   node scripts/emit-block835-canary-release.mjs [--profile v2|v3] [--package DIR] [--out DIR]
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BLOCK835_CANARY_PILOT_RELEASE_PATH,
  BLOCK835_CANARY_V2_PROFILE,
  buildBlock835CanaryRelease,
} from "../src/release/block835-canary-release.ts";
import { BLOCK835_V3_CANARY_PROFILE } from "../src/release/block835-v3-canary-release.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The release profiles this emitter may write. Naming a profile is the ONLY way
 * to select a release id, an input package and an output directory, so a `--out`
 * or `--package` typo can never make one profile overwrite another's bytes.
 */
const PROFILES = {
  v2: BLOCK835_CANARY_V2_PROFILE,
  v3: BLOCK835_V3_CANARY_PROFILE,
};

function fail(message) { throw new Error(message); }

function parseOptions(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`Missing value for ${token}.`);
    parsed[token.slice(2)] = value;
    index += 1;
  }
  return parsed;
}

function resolveProfile(name) {
  const profile = PROFILES[name ?? "v2"];
  if (!profile) fail(`Unknown profile ${name}. Known profiles: ${Object.keys(PROFILES).join(", ")}.`);
  return profile;
}

function resolvePackageDirectory(profile, explicit) {
  const directory = explicit ? resolve(explicit) : join(repositoryRoot, profile.inputPackageDirectory);
  if (!existsSync(join(directory, "manifest.json"))) fail(`No package manifest at ${directory}.`);
  return directory;
}

/**
 * Refuses any output directory this emitter does not own, so a `--out` typo can
 * never recursively delete a pinned release.
 */
function resolveOutputDirectory(profile, explicit) {
  const directory = explicit ? resolve(explicit) : join(repositoryRoot, profile.outputDirectory);
  if (basename(directory) !== profile.releaseId) fail(`Refusing to write ${directory}: only a directory named ${profile.releaseId} is writable for profile ${profile.releaseId}.`);
  return directory;
}

async function existingFiles(directory) {
  if (!existsSync(directory)) return [];
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => relative(directory, join(entry.parentPath ?? entry.path, entry.name)));
}

async function main() {
  const parsed = parseOptions(process.argv.slice(2));
  const profile = resolveProfile(parsed.profile);
  const packageDirectory = resolvePackageDirectory(profile, parsed.package);
  const outputDirectory = resolveOutputDirectory(profile, parsed.out);
  if (resolve(outputDirectory) === resolve(packageDirectory)) fail("Refusing to emit into the read-only input package.");

  const manifest = JSON.parse(await readFile(join(packageDirectory, "manifest.json"), "utf8"));
  const packageBytes = new Map();
  for (const artifact of manifest.artifacts ?? []) {
    packageBytes.set(artifact.relativeRef, new Uint8Array(await readFile(join(packageDirectory, ...artifact.relativeRef.split("/")))));
  }
  const pilotRelease = JSON.parse(await readFile(join(repositoryRoot, BLOCK835_CANARY_PILOT_RELEASE_PATH), "utf8"));

  const release = buildBlock835CanaryRelease({ manifest, packageBytes, pilotRelease }, profile);
  const files = release.files;

  const stale = (await existingFiles(outputDirectory)).filter((path) => !files.has(path.split("\\").join("/")));
  for (const path of stale) await rm(join(outputDirectory, path));

  for (const [path, bytes] of [...files].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))) {
    const target = join(outputDirectory, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  console.log(JSON.stringify({
    ok: true,
    releaseId: profile.releaseId,
    packageDirectory: relative(repositoryRoot, packageDirectory),
    outputDirectory: relative(repositoryRoot, outputDirectory),
    files: files.size,
    removedStale: stale.length,
    declaredPrivateArtifacts: release.graph.roots.find((root) => root.audience === "private")?.artifacts.length ?? 0,
    emittedPrivateFiles: [...files.keys()].filter((path) => path.startsWith("private/")).length,
    publicRootChecksumSha256: release.graph.roots.find((root) => root.audience === "public")?.rootChecksumSha256,
  }, null, 2));
}

await main();
