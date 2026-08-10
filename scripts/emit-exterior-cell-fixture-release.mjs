// Emits the synthetic exterior-cell fixture release into the local public data
// root so the app can exercise exterior streaming, profiles, canary selection,
// fallback notices, and exterior picking without any production asset and
// without any network request.
//
// The output is fully deterministic. `src/runtime/exterior-cell-runtime.test.ts`
// re-generates it and asserts byte equality with the checked-in files, so this
// script is the single source of truth for that directory.
//
// Usage: pnpm exterior-cells:emit-fixture
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { EXTERIOR_FIXTURE_RELEASE_ID, exteriorCellFixture, exteriorCellFixtureReleaseFiles } from "../src/runtime/exterior-cell-fixtures.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = join(repositoryRoot, "public", "data", EXTERIOR_FIXTURE_RELEASE_ID);

async function existingFiles(directory) {
  if (!existsSync(directory)) return [];
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => relative(directory, join(entry.parentPath ?? entry.path, entry.name)));
}

const fixture = await exteriorCellFixture();
const files = exteriorCellFixtureReleaseFiles(fixture);

const stale = (await existingFiles(releaseRoot)).filter((path) => !files.has(path.split("\\").join("/")));
for (const path of stale) await rm(join(releaseRoot, path));

for (const [path, bytes] of [...files].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))) {
  const target = join(releaseRoot, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

globalThis.process.stdout.write(`Emitted ${files.size} files for ${EXTERIOR_FIXTURE_RELEASE_ID} (removed ${stale.length} stale).\n`);
