/* global process */
/**
 * Drives the real `build` CLI wiring, not the pure predicate.
 *
 * The pure `decidePackageTarget` unit tests prove the decision is correct; this
 * proves the CLI actually consults it *before* the recursive delete. If
 * `assertWritableTarget` were ever reordered after `rm()`, the predicate tests
 * would still pass and only these assertions would fail.
 *
 * Written as `.mjs` because the repository has no `@types/node`, so a TypeScript
 * test cannot import `node:child_process`.
 */
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "block835-reference-plan-cli.mjs");
const ROOT = resolve(HERE, "..");
const SCRATCH = join(ROOT, "artifacts", "block835-guard-cli-test");

async function build(target) {
  try {
    await run(process.execPath, [CLI, "build", "--out", target], { cwd: ROOT });
    return { failed: false, stderr: "" };
  } catch (error) {
    return { failed: true, stderr: error.stderr ?? "" };
  }
}

/** Materialises a directory shaped like a pinned immutable release. */
async function pinnedReleaseShape(target, packageId) {
  await mkdir(join(target, "private", "assets"), { recursive: true });
  await writeFile(join(target, "release.json"), JSON.stringify({ releaseId: packageId }), "utf8");
  await writeFile(join(target, "manifest.json"), JSON.stringify({ packageId }), "utf8");
  await writeFile(join(target, "private", "assets", "pinned.glb"), "immutable-bytes", "utf8");
}

async function survives(target) {
  return {
    release: await readFile(join(target, "release.json"), "utf8"),
    asset: await readFile(join(target, "private", "assets", "pinned.glb"), "utf8"),
    entries: (await readdir(target)).sort(),
  };
}

describe("Block 835 reference build CLI target guard", () => {
  afterAll(async () => { await rm(SCRATCH, { recursive: true, force: true }); });

  it("refuses a pinned-release-shaped directory and deletes nothing", async () => {
    const target = join(SCRATCH, "pinned-shaped");
    await pinnedReleaseShape(target, "manhattan-esb-block-exterior-pilot-20260805");
    const before = await survives(target);

    const result = await build(target);

    expect(result.failed).toBe(true);
    expect(result.stderr).toMatch(/owned by another package/u);
    expect(await survives(target)).toEqual(before);
  });

  it("refuses a target outside the package and scratch roots without touching it", async () => {
    const outside = await mkdtemp(join(tmpdir(), "udt-block835-outside-"));
    try {
      await pinnedReleaseShape(outside, "manhattan-esb-block-exterior-pilot-20260805");
      const before = await survives(outside);

      const result = await build(outside);

      expect(result.failed).toBe(true);
      expect(result.stderr).toMatch(/Refusing to write outside the package directory/u);
      expect(await survives(outside)).toEqual(before);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("explains how to proceed when a scratch target exists but is not this package", async () => {
    const target = join(SCRATCH, "pre-created-empty");
    await mkdir(target, { recursive: true });
    const result = await build(target);
    expect(result.failed).toBe(true);
    expect(result.stderr).toMatch(/no manhattan-esb-block-reference-20260810 manifest/u);
    expect(result.stderr).toMatch(/remove it first or choose a path that does not exist yet/u);
  });

  it("writes a fresh scratch target and rewrites its own output", async () => {
    const target = join(SCRATCH, "own-package");
    expect((await build(target)).failed).toBe(false);
    expect((await build(target)).failed).toBe(false);
    const manifest = JSON.parse(await readFile(join(target, "manifest.json"), "utf8"));
    expect(manifest.packageId).toBe("manhattan-esb-block-reference-20260810");
  });
});
