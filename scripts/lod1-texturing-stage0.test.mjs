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

  it("keeps the refusal it originally issued, and the falsification it named", () => {
    const gate = readJson(join(root, "stage0-gate.json"));
    // AMENDED, NOT REWRITTEN. The original verdict and blocking condition stay
    // in the record so the sequence of belief is readable; a later stage that
    // silently deleted them would be editing history rather than adding to it.
    expect(gate.verdict).toContain("NO-GO");
    expect(gate.blockingCondition.item).toContain("1");
    expect(gate.blockingCondition.status).toBe("NOT CAPTURED");
    expect(gate.blockingCondition.couldItOverturnTheRescope).toContain("YES");
    expect(gate.supersededBy.note).toContain("AMENDED, NOT REWRITTEN");
  });
});

/**
 * THE RENDER THAT UNBLOCKED THE GATE.
 *
 * Item 1 was the one reading that could have overturned the rescope, and the
 * gate said so in advance. It was captured on 2026-08-17 and it confirmed the
 * rescope instead. What is pinned here is the verdict, the falsification that
 * was offered and not met, and the arithmetic the conclusion rests on -- so a
 * later edit to any of them is a diff somebody has to explain.
 */
describe("the rendered comparison, and the verdict it settles", () => {
  it("records the rendered answer as TONE, on its own evidence", () => {
    const render = readJson(join(root, "render-comparison.json"));
    expect(render.artifact).toBe("render-comparison");
    expect(render.findings.theAnswer).toContain("TONE");
    // Five buildings, two distances, three variants.
    expect(new Set(render.rows.map((row) => row.buildingId)).size).toBe(5);
    expect(new Set(render.rows.map((row) => row.d))).toEqual(new Set([350, 120]));
    expect(Object.keys(render.variants).sort()).toEqual(["lod0", "lod0flat", "lod1"]);
  });

  it("re-derives the screen-pixel arithmetic the seam rationale turns on", () => {
    const render = readJson(join(root, "render-comparison.json"));
    const hfov = (render.instrument.horizontalFovDeg * Math.PI) / 180;
    const [width] = render.instrument.viewport;
    for (const [label, distance] of [["350m", 350], ["120m", 120]]) {
      const perPixel = (2 * distance * Math.tan(hfov / 2)) / width;
      expect(perPixel, label).toBeCloseTo(render.screenPixelArithmetic.worldMetresPerScreenPixel[label], 4);
      // The joint must be SUB-PIXEL at both distances, which is what makes the
      // seam right about detail and silent about tone.
      const texels = Object.values(render.screenPixelArithmetic.texelSizeMm).map((mm) => (perPixel * 1000) / mm);
      expect(Math.min(...texels), `${label}: smallest texels per screen pixel`).toBeGreaterThan(1);
    }
    expect(render.screenPixelArithmetic.seamRationaleVerdict).toContain("CONFIRMED");
  });

  it("shows a hue error that a grayscale tile cannot explain, wherever geometry does not mask it", () => {
    const render = readJson(join(root, "render-comparison.json"));
    // A grayscale tile can only move all three channels together, so a non-zero
    // channel spread is a HUE error and cannot have come from the tile.
    const limestone = render.rows.filter((row) => row.classes.includes("limestone-ashlar"));
    for (const row of limestone) expect(row.shipped.toneChannelSpread, `${row.buildingId}@${row.d}`).toBeGreaterThan(0.01);
    // The geometry-constant comparison is the cleanest isolation available, and
    // it shows the spread on a BRICK building -- which is why the record does
    // not claim the error is limestone-only.
    const fallback = render.rows.filter((row) => row.fallback);
    expect(fallback.length).toBe(2);
    for (const row of fallback) expect(row.shipped.toneChannelSpread, `${row.buildingId}@${row.d}`).toBeGreaterThan(0.005);
    expect(render.findings.hueErrorConfirmedInARender).toContain("NOT 'limestone only'");
  });

  it("commits every still it cites, and each one matches its recorded digest", () => {
    const render = readJson(join(root, "render-comparison.json"));
    expect(render.stills.length).toBe(30);
    for (const still of render.stills) {
      const path = join(root, "stills", still.name);
      expect(existsSync(path), still.name).toBe(true);
      expect(digest(path), still.name).toBe(still.checksumSha256);
      expect(readFileSync(path).length, still.name).toBe(still.byteSize);
    }
  });

  it("carries the instrument defect it found in itself", () => {
    const render = readJson(join(root, "render-comparison.json"));
    // The first crop implementation compared misaligned rows. A record that
    // dropped that would read as a clean first try.
    expect(render.instrument.instrumentDefectFound).toContain("201x162");
    expect(render.instrument.blenderIncidentAvoided).toContain("read_factory_settings");
  });

  it("states the amended verdict as RESCOPE and keeps its limitations", () => {
    const gate = readJson(join(root, "stage0-gate.json"));
    expect(gate.amendment2026_08_17.verdict).toBe("RESCOPE");
    expect(gate.amendment2026_08_17.couldItHaveOverturnedTheRescope).toContain("YES");
    const render = readJson(join(root, "render-comparison.json"));
    expect(render.limitations.length).toBeGreaterThanOrEqual(5);
  });
});

/**
 * The asset-budget dry run (item 4), re-derived rather than trusted.
 *
 * The gate's zero-violation claim rests on a structural fact - the catalogue has
 * four class tiles - and on a measured worst case over all 44,989 assets. The
 * structural half is checked here against the shipped class list; the measured
 * half is pinned so a re-walk that disagreed would surface.
 */
describe("the asset-budget dry run for a textured lod_1", () => {
  it("cannot exceed the texture budget, because the catalogue is smaller than it", () => {
    const gate = readJson(join(root, "stage0-gate.json"));
    const item = gate.items["4"];
    expect(item.status).toContain("ZERO VIOLATIONS");
    expect(item.violations).toEqual([]);
    // The shipped catalogue, not a number copied into the record.
    expect(PROCEDURAL_TEXTURE_CLASSES.length).toBe(4);
    expect(item.measured.maxDistinctClassTilesPerAsset).toBeLessThanOrEqual(PROCEDURAL_TEXTURE_CLASSES.length);
    expect(item.measured.maxDistinctClassTilesPerAsset).toBeLessThanOrEqual(item.measured.maxTexturesBudget);
    expect(item.measured.maxLod1MaterialsPerAsset).toBeLessThanOrEqual(item.measured.maxMaterialsBudget);
  });

  it("walked the whole population, and its histograms account for it", () => {
    const item = readJson(join(root, "stage0-gate.json")).items["4"];
    expect(item.measured.assetsWalked).toBe(44_989);
    const tiles = Object.values(item.measured.distinctClassTilesPerAsset).reduce((a, b) => a + b, 0);
    const mats = Object.values(item.measured.lod1MaterialsPerAsset).reduce((a, b) => a + b, 0);
    expect(tiles).toBe(44_989);
    expect(mats).toBe(44_989);
  });

  it("still reads the budgets out of the shipped profile", () => {
    const source = readFileSync(join("src", "release", "block835-v3-package.ts"), "utf8");
    expect(source).toContain("V3T_QUALITY_BUDGETS = { maxTriangles: 200_000, maxMaterials: 12, maxTextures: 4 }");
  });
});

/**
 * Item 5: a -c2 must physically carry its bytes. This is asserted against the
 * VALIDATOR SOURCE rather than against the record's prose, because the record's
 * recommendation is only as good as the refusal it cites.
 */
describe("the retention validator's physical-presence rule", () => {
  it("refuses a symlinked artifact, so a referencing -c2 is not available", () => {
    const source = readFileSync(join("scripts", "validate-retention-release.mjs"), "utf8");
    expect(source).toContain("candidate.isSymbolicLink()");
    expect(source).toContain("Artifact size/type differs before read");
    const gate = readJson(join(root, "stage0-gate.json"));
    expect(gate.items["5"].resolution).toContain("MUST COPY");
  });
});
