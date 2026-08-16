/* global process */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { args, retentionAssertions } from "./validate-retention-release.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(repositoryRoot, "scripts", "validate-retention-release.mjs");
const RELEASE_ID = "manhattan-exterior-cells-20260811-v3-c1";
const SOURCE_PACKAGE = join(repositoryRoot, "public", "data", RELEASE_ID);
const SOURCE_RECORDS = join(repositoryRoot, "data", RELEASE_ID);

const temporaries = [];
afterAll(() => { for (const path of temporaries) rmSync(path, { recursive: true, force: true }); });

/** A throwaway copy of the real w00 package, so mutations test real bytes. */
function scratch() {
  const root = mkdtempSync(join(tmpdir(), "retention-validate-"));
  temporaries.push(root);
  cpSync(SOURCE_PACKAGE, join(root, "package"), { recursive: true });
  cpSync(SOURCE_RECORDS, join(root, "records"), { recursive: true });
  return root;
}

/** Rewrites a committed record and its sidecar, so only the intended edit is under test. */
function rewriteRecord(path, mutate) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  mutate(value);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(path, serialized);
  writeFileSync(path.replace(/\.json$/u, ".sha256"), `${sha256HexSync(serialized)}  ${path.split("/").pop()}\n`);
}

function run(root, extra = []) {
  try {
    const stdout = execFileSync(process.execPath, [
      "--experimental-strip-types", CLI,
      "--package", join(root, "package"),
      "--inventory", join(root, "records", "payload-inventory.json"),
      "--census", join(root, "records", "wave-census.json"),
      ...extra,
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, stdout };
  } catch (error) {
    return { ok: false, stderr: `${error.stderr ?? ""}${error.stdout ?? ""}` };
  }
}

describe("the forbidden flags are refused BY NAME", () => {
  // The whole security property is that no operator token reaches the admission
  // decision. Each name is asserted separately so deleting one from the set is
  // a failing test rather than a silent reopening.
  for (const flag of ["texture-admission", "admission", "policy", "procedural-replay", "require-textured", "require-texture-free", "texture-free"]) {
    it(`refuses --${flag}`, () => {
      expect(() => args(["--package", "p", `--${flag}`, "procedural-replay"])).toThrow(/read from the package's pinned root|is refused/u);
    });
  }

  it("refuses --max-cells AT PARSE TIME, before any cell is read", () => {
    expect(() => args(["--package", "p", "--max-cells", "2"])).toThrow(/partial walk cannot establish completeness/u);
  });

  it("still accepts the legitimate flags", () => {
    const parsed = args(["--package", "p", "--inventory", "i", "--census", "c", "--evidence-out", "e"]);
    expect(parsed).toEqual({ package: "p", inventory: "i", census: "c", "evidence-out": "e" });
  });
});

describe("the measured-fallback pair assertions, each failing independently", () => {
  const silhouette = { status: "authoring-declared", method: "projected-silhouette-ratio", metricVersion: "1.0", planHashSha256: "a".repeat(64), viewIds: ["view:east"], deviationRatio: 0, maximumRatio: 0.02 };
  const quality = { triangleCount: 100, materialCount: 1, textureCount: 1, budgets: { maxTriangles: 1, maxMaterials: 1, maxTextures: 1 } };
  /** A conforming FALLBACK asset; each case below breaks exactly one rule. */
  function fallbackAsset(overrides = {}) {
    const fine = { lodId: "lod_0", artifactRef: "a.glb", geometricErrorMeters: 0, maxDistanceMeters: null, eligible: true, quality: { ...quality }, silhouette: null };
    const coarse = { lodId: "lod_1", artifactRef: "b.glb", geometricErrorMeters: 0, maxDistanceMeters: null, eligible: false, quality: { ...quality }, silhouette: { ...silhouette } };
    return { canonicalFeatureId: "doitt:1", source: { planHashSha256: "a".repeat(64) }, lods: [{ ...fine, ...(overrides.fine ?? {}) }, { ...coarse, ...(overrides.coarse ?? {}) }] };
  }
  const check = (asset) => retentionAssertions({ assets: [asset] }).issues.join(" ");

  it("passes a conforming fallback", () => {
    const result = retentionAssertions({ assets: [fallbackAsset()] });
    expect(result.issues).toEqual([]);
    expect(result.fallbackCount).toBe(1);
    expect(result.silhouetteCount).toBe(1);
  });

  it("1. refuses a nonzero derived error on an ineligible level", () => {
    expect(check(fallbackAsset({ coarse: { geometricErrorMeters: 0.2 } }))).toMatch(/derived geometric error of 0/u);
  });

  it("2. refuses a nonzero deviation on a full-geometry level", () => {
    expect(check(fallbackAsset({ coarse: { silhouette: { ...silhouette, deviationRatio: 0.001 } } }))).toMatch(/dropped nothing, so its deviation must be 0/u);
  });

  it("3. refuses a fallback whose triangle count differs from the fine level", () => {
    expect(check(fallbackAsset({ coarse: { quality: { ...quality, triangleCount: 99 } } }))).toMatch(/must carry the fine level's triangle count/u);
  });

  it("4. refuses a bounded fine level under an ineligible coarse one", () => {
    expect(check(fallbackAsset({ fine: { maxDistanceMeters: 500 } }))).toMatch(/no eligible representation at range/u);
  });

  it("5. refuses a coarse level carrying no silhouette record at all", () => {
    expect(check(fallbackAsset({ coarse: { silhouette: null } }))).toMatch(/carries no silhouette record/u);
  });

  it("also refuses a silhouette bound to a different plan hash, and one over the cap", () => {
    expect(check(fallbackAsset({ coarse: { silhouette: { ...silhouette, planHashSha256: "b".repeat(64) } } }))).toMatch(/bound to a different plan hash/u);
    expect(check(fallbackAsset({ coarse: { eligible: true, silhouette: { ...silhouette, deviationRatio: 0.5 } } }))).toMatch(/exceeds the 0.02 cap/u);
  });

  it("refuses a fine level that carries a silhouette record", () => {
    expect(check(fallbackAsset({ fine: { silhouette: { ...silhouette } } }))).toMatch(/fine level must carry no silhouette record/u);
  });

  it("refuses an asset that is not two levels", () => {
    expect(retentionAssertions({ assets: [{ canonicalFeatureId: "doitt:1", source: { planHashSha256: "a".repeat(64) }, lods: [] }] }).issues.join(" "))
      .toMatch(/declares exactly two levels/u);
  });
});

/**
 * The end-to-end cases run against the REAL w00 retention payload, which is
 * gitignored by design. They are skipped rather than failed when it is absent,
 * and the skip is the honest outcome: these cases assert properties of emitted
 * bytes, and there are no bytes to assert about on a fresh clone.
 *
 * CONCRETELY, measured by hiding the payload directories and re-running:
 * without them CI runs 18 of the 26 cases in this file — every unit case over
 * the argument grammar and the measured-fallback assertions — and SKIPS THE 8
 * that need emitted bytes. See the PAYLOAD RETENTION HOLD in the implementation
 * record.
 */
describe.skipIf(!existsSync(SOURCE_PACKAGE))("the real w00 package, end to end", () => {
  it("is green with both completeness sources", () => {
    const result = run(scratch());
    expect(result.ok).toBe(true);
    const report = JSON.parse(result.stdout);
    expect(report.textureAdmission.policy).toBe("procedural-replay");
    expect(report.completenessSources).toEqual(["payload-inventory", "wave-census"]);
    expect(report.validatedCellCount).toBe(report.declaredCellCount);
  });

  it("REFUSES with no completeness source at all", () => {
    const root = scratch();
    let stderr = "";
    let exited = false;
    try {
      execFileSync(process.execPath, ["--experimental-strip-types", CLI, "--package", join(root, "package")], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      exited = true;
      stderr = `${error.stderr ?? ""}`;
    }
    expect(exited).toBe(true);
    expect(stderr).toMatch(/no completeness source/u);
  });

  it("refuses an edited self-pin before reading any policy", () => {
    const root = scratch();
    const path = join(root, "package", "retention-root.json");
    const value = JSON.parse(readFileSync(path, "utf8"));
    value.textureAdmission.policy = "texture-free";
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
    const result = run(root);
    expect(result.ok).toBe(false);
    expect(result.stderr).toMatch(/self-pin disagrees/u);
  });

  it("refuses a manifest count that disagrees with the committed inventory", () => {
    const root = scratch();
    rewriteRecord(join(root, "records", "payload-inventory.json"), (value) => { value.cellManifestCount += 1; });
    const result = run(root);
    expect(result.ok).toBe(false);
    expect(result.stderr).toMatch(/dropped or appended/u);
  });

  it("refuses a census whose accounting does not close", () => {
    const root = scratch();
    rewriteRecord(join(root, "records", "wave-census.json"), (value) => { value.ownedBuildingCount += 1; });
    const result = run(root);
    expect(result.ok).toBe(false);
    expect(result.stderr).toMatch(/does not account for its own wave/u);
  });

  it("refuses a building that is both tombstoned and packaged", () => {
    const root = scratch();
    const manifest = JSON.parse(readFileSync(join(root, "package", "public", "assemblies", "manhattan-exterior-cell-w00-000000-block-00835.json"), "utf8"));
    const packagedId = manifest.assets[0].canonicalFeatureId;
    rewriteRecord(join(root, "records", "wave-census.json"), (value) => {
      // The owned count rises with the tombstone so the ARITHMETIC still closes
      // and the packaged count still equals `generated`. Without that, the
      // accounting checks fire first and this case would pass for the wrong
      // reason — it must be the conflict itself that is caught.
      value.ownedBuildingCount += 1;
      value.tombstones.push({ buildingId: packagedId, ownerCellId: manifest.cells[0].cellId, stopCode: "ring-area-below-floor", reason: "synthetic conflict" });
      value.tombstonedBuildingCount = value.tombstones.length;
    });
    const result = run(root);
    expect(result.ok).toBe(false);
    expect(result.stderr).toMatch(/both tombstoned and packaged/u);
  });

  it("refuses a census whose sidecar does not match its bytes", () => {
    const root = scratch();
    const path = join(root, "records", "wave-census.json");
    const value = JSON.parse(readFileSync(path, "utf8"));
    value.ownedBuildingCount += 1;
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
    const result = run(root);
    expect(result.ok).toBe(false);
    expect(result.stderr).toMatch(/does not match its committed sidecar/u);
  });

});

const MULTI_CELL_PACKAGE = join(repositoryRoot, "public", "data", "manhattan-midtown-core-cells-20260811-v3-c1");

describe.skipIf(!existsSync(MULTI_CELL_PACKAGE))("a capped walk of a real multi-cell wave", () => {
  it("is refused before it reads a cell, not after", () => {
    let stderr = "";
    let exited = false;
    const startedAt = Date.now();
    try {
      execFileSync(process.execPath, [
        "--experimental-strip-types", CLI,
        "--package", MULTI_CELL_PACKAGE,
        "--inventory", join(repositoryRoot, "data", "manhattan-midtown-core-cells-20260811-v3-c1", "payload-inventory.json"),
        "--max-cells", "2",
      ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      exited = true;
      stderr = `${error.stderr ?? ""}`;
    }
    expect(exited).toBe(true);
    expect(stderr).toMatch(/partial walk cannot establish completeness/u);
    // Parse-time means it cannot have replayed 149 cells of GLBs on the way.
    expect(Date.now() - startedAt).toBeLessThan(20_000);
  });
});
