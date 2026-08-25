/* global Buffer, process */

/**
 * Fail-closed tests for the zone imagery validator.
 *
 * A validator that only ever runs against a good release is untested. Each case
 * here copies the SHIPPED release into a temporary root, damages exactly one
 * thing, and asserts the validator exits non-zero and names the damage. The
 * copies are cheap because only the documents are rewritten; the textures are
 * hard-linked.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { stableSerialize } from "../src/domain/deterministic-hash.ts";

const REPO_ROOT = process.cwd();
const RELEASE_ID = "manhattan-ground-zone-imagery-20260826";
const SHIPPED = join(REPO_ROOT, "public/data", RELEASE_ID);
const VALIDATOR = join(REPO_ROOT, "scripts/validate-manhattan-zone-imagery.mjs");

const scratchRoots = [];

/**
 * Runs the validator against a damaged COPY of the shipped release.
 *
 * The validator resolves the release from a fixed path under the repo, so the
 * copy is staged there and removed afterwards rather than passed as an
 * argument. That keeps the validator's own path handling under test instead of
 * adding an override that only tests would use.
 */
function runWithDamage(damage) {
  const backup = mkdtempSync(join(tmpdir(), "zone-imagery-backup-"));
  scratchRoots.push(backup);
  cpSync(SHIPPED, join(backup, "release"), { recursive: true });
  try {
    damage(SHIPPED);
    const result = execFileSync(
      process.execPath,
      ["--experimental-strip-types", VALIDATOR],
      { cwd: REPO_ROOT, encoding: "utf8", stdio: "pipe" },
    );
    return { code: 0, output: result };
  } catch (error) {
    return { code: error.status ?? 1, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  } finally {
    rmSync(SHIPPED, { recursive: true, force: true });
    cpSync(join(backup, "release"), SHIPPED, { recursive: true });
    rmSync(backup, { recursive: true, force: true });
  }
}

function readIndex(root) {
  return JSON.parse(readFileSync(join(root, "zone-imagery.json"), "utf8"));
}

/**
 * Rewrites the index in CANONICAL form and re-pins the seam checksum.
 *
 * Needed whenever a test targets a check that sits BEHIND the layer-wide gate:
 * a non-canonical or unpinned index trips the gate first, and the test would
 * pass while proving nothing about the check it names.
 */
function rewriteIndexCanonically(root, index) {
  const bytes = Buffer.from(stableSerialize(index), "utf8");
  writeFileSync(join(root, "zone-imagery.json"), bytes);
  const document = JSON.parse(readFileSync(join(root, "release.json"), "utf8"));
  document.zoneImagery.checksumSha256 = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(join(root, "release.json"), Buffer.from(stableSerialize(document), "utf8"));
}

afterAll(() => {
  for (const root of scratchRoots) rmSync(root, { recursive: true, force: true });
});

describe("zone imagery validator fails closed", () => {
  it("passes against the undamaged shipped release", () => {
    const result = runWithDamage(() => {});
    expect(result.code, result.output).toBe(0);
    expect(result.output).toMatch(/PASSED/u);
  });

  it("refuses a corrupted texture", () => {
    const result = runWithDamage((root) => {
      const index = readIndex(root);
      const target = join(root, index.entries[0].artifactRef);
      const bytes = Buffer.from(readFileSync(target));
      // Flip one byte deep inside the scan data. The file stays a valid JPEG.
      bytes[bytes.length - 32] ^= 0xff;
      writeFileSync(target, bytes);
    });
    expect(result.code).not.toBe(0);
    expect(result.output).toMatch(/do not match the declared checksum/u);
  });

  it("refuses a tampered index, dropping the whole imagery layer", () => {
    const result = runWithDamage((root) => {
      const index = readIndex(root);
      index.entries[0].coveredPixelFraction = 0.5;
      writeFileSync(join(root, "zone-imagery.json"), JSON.stringify(index));
    });
    expect(result.code).not.toBe(0);
    expect(result.output).toMatch(/entire imagery layer fails closed/u);
  });

  it("refuses an index whose declared pixel grid is not what the build rule derives", () => {
    const result = runWithDamage((root) => {
      const index = readIndex(root);
      index.entries[0].pixelWidth += 1;
      rewriteIndexCanonically(root, index);
    });
    expect(result.code).not.toBe(0);
    expect(result.output).toMatch(/not what the pinned build rule derives/u);
  });

  it("refuses a missing texture rather than treating it as an absent zone", () => {
    const result = runWithDamage((root) => {
      const index = readIndex(root);
      rmSync(join(root, index.entries[0].artifactRef), { force: true });
    });
    expect(result.code).not.toBe(0);
    expect(result.output).toMatch(/is absent/u);
  });

  it("refuses an undeclared file inside the checksum-pinned root", () => {
    const result = runWithDamage((root) => {
      writeFileSync(join(root, "artifacts", "stray.jpg"), "not declared");
    });
    expect(result.code).not.toBe(0);
    expect(result.output).toMatch(/undeclared file/u);
  });

  it("refuses a silent gap: a zone that is neither textured nor refused", () => {
    const result = runWithDamage((root) => {
      const index = readIndex(root);
      index.refusals.pop();
      rewriteIndexCanonically(root, index);
    });
    expect(result.code).not.toBe(0);
    expect(result.output).toMatch(/neither textured nor refused/u);
  });

  it("refuses a broken compatibility pin", () => {
    const result = runWithDamage((root) => {
      const document = JSON.parse(readFileSync(join(root, "release.json"), "utf8"));
      // Pretend the base geometry moved: same asset id, different tier digest.
      document.assets[0].tiers[0].checksumSha256 = "b".repeat(64);
      writeFileSync(join(root, "release.json"), JSON.stringify(document));
    });
    expect(result.code).not.toBe(0);
    expect(result.output).toMatch(/compatibility pin is broken|does not match its declared tiers|T005 ground schema/u);
  });
});
