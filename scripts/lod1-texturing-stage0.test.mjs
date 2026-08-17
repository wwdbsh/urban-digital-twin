import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PROCEDURAL_TEXTURE_CLASSES,
  rasterizeProceduralTexture,
} from "../src/release/procedural-texture.ts";

/**
 * T009 STAGE 0 DRIFT TEST.
 *
 * The stage refuses a campaign. A refusal is only worth anything if the readings
 * it rests on stay checkable, so this asserts three different kinds of thing:
 *
 *   1. Every record matches its sidecar. A reading edited after the fact is the
 *      one thing an evidence record must not survive quietly.
 *   2. The load-bearing NUMBERS are RE-DERIVED here from their own sources
 *      rather than compared to themselves. The tile means are recomputed by
 *      calling the shipped rasterizer; the 424 is recounted from the six
 *      committed wave censuses; the 425/424 difference is re-checked to be the
 *      one named tombstoned building. If any of those move, the verdict's
 *      reasoning moves with them and this fails.
 *   3. The stage did not do what it promised not to do: the emission seam is
 *      unchanged, and the frozen mass-generation record is byte-identical.
 */
const root = join("data", "lod1-texturing-20260817");
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const RECORDS = [
  "class-tile-luminance",
  "lod-material-delta",
  "island-uv-magnitude",
  "payload-retention-hold",
  "fallback-count-reconciliation",
  "stage0-gate",
];

const RETENTION_WAVES = [
  "manhattan-exterior-cells-20260811-v3-c1",
  "manhattan-midtown-core-cells-20260811-v3-c1",
  "manhattan-lower-manhattan-cells-20260812-c1",
  "manhattan-southern-remainder-cells-20260812-c1",
  "manhattan-central-upper-manhattan-cells-20260812-c1",
  "manhattan-northern-manhattan-cells-20260812-c1",
];

describe("T009 Stage 0 records are byte-stable", () => {
  for (const name of RECORDS) {
    it(`${name}.json matches its committed sidecar`, () => {
      const jsonPath = join(root, `${name}.json`);
      const sidecarPath = join(root, `${name}.sha256`);
      expect(existsSync(jsonPath), `${jsonPath} is missing`).toBe(true);
      const [checksum, file] = readFileSync(sidecarPath, "utf8").trim().split(/\s+/u);
      expect(file).toBe(`${name}.json`);
      expect(digest(jsonPath)).toBe(checksum);
    });
  }
});

describe("the numbers the refusal rests on are re-derivable", () => {
  it("the class-tile means are what the SHIPPED rasterizer produces", () => {
    const record = readJson(join(root, "class-tile-luminance.json"));
    expect(record.rows.map((row) => row.textureClass).sort()).toEqual([...PROCEDURAL_TEXTURE_CLASSES].sort());
    for (const row of record.rows) {
      const pixels = rasterizeProceduralTexture(row.textureClass);
      const mean = [...pixels].reduce((total, texel) => total + texel, 0) / pixels.length;
      expect(Number(mean.toFixed(6))).toBe(row.meanTexel);
      // The whole tone argument needs these to be BELOW 1: a grayscale tile
      // darkens. A tile that averaged 1.0 would make texturing tone-neutral and
      // the argument would not apply.
      expect(row.meanNormalized).toBeLessThan(1);
      expect(row.meanNormalized).toBeGreaterThan(0.5);
    }
  });

  it("lod_1 carries no texture anywhere, which is the contract's one true premise", () => {
    const record = readJson(join(root, "lod-material-delta.json"));
    expect(record.population.pairsRead).toBe(44_989);
    expect(record.premiseFindings.lod1PairsCarryingImages).toBe(0);
    expect(record.premiseFindings.lod1PairsCarryingTexcoords).toBe(0);
  });

  it("lod_1 is entirely byte-palette authored and lod_0 is not, which is the two-path finding", () => {
    const { paletteAuthoring } = readJson(join(root, "lod-material-delta.json"));
    expect(paletteAuthoring.lod1MaterialsContinuous).toBe(0);
    expect(paletteAuthoring.lod0MaterialsContinuous).toBeGreaterThan(0);
    // Small CLOSED palettes are why the recommended fix is a lookup table
    // rather than a campaign. If either grows into the thousands, that argument
    // is gone and this test is where it should break.
    expect(paletteAuthoring.distinctLod0Factors).toBeLessThanOrEqual(64);
    expect(paletteAuthoring.distinctLod1Factors).toBeLessThanOrEqual(64);
  });

  it("the emitted fallback count is 424, recounted from the six committed censuses", () => {
    let fullGeometry = 0;
    let total = 0;
    for (const releaseId of RETENTION_WAVES) {
      const census = readJson(join("data", releaseId, "wave-census.json"));
      for (const decision of census.lod1Decisions) {
        total += 1;
        if (decision.variant === "full-geometry") fullGeometry += 1;
      }
    }
    expect(total).toBe(44_989);
    expect(fullGeometry).toBe(424);
    const record = readJson(join(root, "fallback-count-reconciliation.json"));
    expect(record.the424.value).toBe(424);
    expect(record.whichNumberT009ShouldUse.value).toBe(424);
  });

  it("the 425/424 gap is exactly one building, and it is tombstoned rather than emitted", () => {
    const record = readJson(join(root, "fallback-count-reconciliation.json"));
    expect(record.symmetricDifference.in425NotIn424).toEqual(["doitt:263078"]);
    expect(record.symmetricDifference.in424NotIn425).toEqual([]);
    const census = readJson(join("data", "manhattan-southern-remainder-cells-20260812-c1", "wave-census.json"));
    const tombstone = census.tombstones.find((entry) => entry.buildingId === "doitt:263078");
    expect(tombstone, "doitt:263078 must still be tombstoned for the reconciliation to hold").toBeDefined();
    expect(tombstone.stopCode).toBe("volume-identity-failed");
  });
});

describe("Stage 0 changed nothing it promised not to change", () => {
  it("the emission seam still binds a texture at lod_0 only", () => {
    const source = readFileSync(join("src", "release", "midtown-core-v3-materialization.ts"), "utf8");
    expect(source).toContain("const texture = lodIndex === 0 ? profile.texture : null;");
  });

  it("the frozen mass-generation coverage record is untouched", () => {
    const [checksum] = readFileSync(join("data", "mass-generation-20260816", "coverage.sha256"), "utf8").trim().split(/\s+/u);
    expect(digest(join("data", "mass-generation-20260816", "coverage.json"))).toBe(checksum);
  });

  it("the gate refuses, and says which reading is missing", () => {
    const gate = readJson(join(root, "stage0-gate.json"));
    expect(gate.verdict).toContain("NO-GO");
    expect(gate.blockingCondition.item).toContain("1");
    expect(gate.blockingCondition.status).toBe("NOT CAPTURED");
    // The refusal must keep naming what could overturn it.
    expect(gate.blockingCondition.couldItOverturnTheRescope).toContain("YES");
  });
});
