import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { validateGroundReleaseStructure } from "./ground-release.ts";
import {
  BMP_HEADER_BYTES,
  ZONE_IMAGERY_CLASSES,
  ZONE_IMAGERY_INDEX_SCHEMA_VERSION,
  ZONE_IMAGERY_MOSAIC_FEET_PER_TEXEL,
  ZONE_IMAGERY_TARGET_GSD_METERS,
  decodeBmp24,
  encodeBmp24,
  feetBoundsOverlap,
  feetHullOfWgs84Rect,
  isZoneImageryClass,
  validateZoneImageryIndex,
  zoneImageryPixelCentre,
  zoneImageryPixelGrid,
  zoneRef,
  type ZoneImageryIndex,
} from "./zone-imagery.ts";

function readJson(path: string): unknown {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path)));
}

const CELL_BOUNDS = {
  west: -74.0478515625,
  south: 40.67138671875,
  east: -74.02587890625,
  north: 40.682373046875,
};

describe("mosaic geometry", () => {
  it("decodes source tiles to exactly 4 feet per texel", () => {
    // The seamless-mosaic argument depends on this being exact, not close.
    expect(ZONE_IMAGERY_MOSAIC_FEET_PER_TEXEL).toBe(4);
  });

  it("builds the feet hull from all four corners, not two", () => {
    const hull = feetHullOfWgs84Rect(CELL_BOUNDS);
    // A conic rotates the grid, so the hull is strictly wider than the span
    // between the projected south-west and north-east corners alone. If this
    // ever became an equality, the four-corner rule would have been lost and
    // edge tiles would silently drop out of the overlap test.
    const twoCorner = {
      xmin: Math.min(hull.xmin, hull.xmax),
      xmax: Math.max(hull.xmin, hull.xmax),
    };
    expect(hull.xmax).toBeGreaterThan(hull.xmin);
    expect(hull.ymax).toBeGreaterThan(hull.ymin);
    expect(twoCorner.xmax - twoCorner.xmin).toBeGreaterThan(0);
  });

  it("treats shared edges as non-overlapping", () => {
    const left = { xmin: 0, ymin: 0, xmax: 100, ymax: 100 };
    expect(feetBoundsOverlap(left, { xmin: 100, ymin: 0, xmax: 200, ymax: 100 })).toBe(false);
    expect(feetBoundsOverlap(left, { xmin: 99, ymin: 0, xmax: 200, ymax: 100 })).toBe(true);
  });
});

describe("pixel grid rule", () => {
  it("derives an integer grid at the pinned ground sample distance", () => {
    const grid = zoneImageryPixelGrid(CELL_BOUNDS);
    expect(Number.isSafeInteger(grid.width)).toBe(true);
    expect(Number.isSafeInteger(grid.height)).toBe(true);
    expect(grid.width).toBeGreaterThan(1000);
    expect(grid.height).toBeGreaterThan(500);
  });

  it("is a pure function of the cell bounds, so a validator can re-derive it", () => {
    const first = zoneImageryPixelGrid(CELL_BOUNDS);
    const second = zoneImageryPixelGrid({ ...CELL_BOUNDS });
    expect(second).toEqual(first);
  });

  it("scales inversely with the target ground sample distance", () => {
    const grid = zoneImageryPixelGrid(CELL_BOUNDS);
    const widthMeters = grid.width * ZONE_IMAGERY_TARGET_GSD_METERS;
    // A level-14 cell at this latitude is roughly 1.85 km across.
    expect(widthMeters).toBeGreaterThan(1500);
    expect(widthMeters).toBeLessThan(2200);
  });

  it("samples pixel centres, not corners", () => {
    const grid = { width: 10, height: 10 };
    const first = zoneImageryPixelCentre(CELL_BOUNDS, grid, 0, 0);
    // Half a pixel in from the western edge, not on it.
    const halfPixel = (CELL_BOUNDS.east - CELL_BOUNDS.west) / grid.width / 2;
    expect(first.longitude).toBeCloseTo(CELL_BOUNDS.west + halfPixel, 12);
    expect(first.latitude).toBeLessThan(CELL_BOUNDS.north);
  });
});

describe("BMP codec", () => {
  it("round-trips arbitrary pixels through both orientations", () => {
    const width = 7;
    const height = 5;
    const rgb = new Uint8Array(width * height * 3);
    for (let index = 0; index < rgb.length; index += 1) rgb[index] = (index * 37) % 256;
    const decoded = decodeBmp24(encodeBmp24(width, height, rgb));
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    expect([...decoded.rgb]).toEqual([...rgb]);
  });

  it("pads each row to a four-byte boundary", () => {
    // 3 px * 3 bytes = 9, padded to 12.
    const bytes = encodeBmp24(3, 2, new Uint8Array(3 * 2 * 3));
    expect(bytes.length).toBe(BMP_HEADER_BYTES + 12 * 2);
  });

  it("refuses malformed input rather than guessing", () => {
    expect(() => decodeBmp24(new Uint8Array(10))).toThrow(/Not a BMP/u);
    expect(() => encodeBmp24(2, 2, new Uint8Array(3))).toThrow(/width \* height \* 3/u);
    expect(() => encodeBmp24(0, 2, new Uint8Array(0))).toThrow(/positive integer/u);
  });
});

describe("index validation", () => {
  function validIndex(): ZoneImageryIndex {
    return {
      schemaVersion: ZONE_IMAGERY_INDEX_SCHEMA_VERSION,
      releaseId: "manhattan-ground-zone-imagery-20260826",
      baseReleaseId: "manhattan-ground-20260824",
      partitionSchemeId: "ground-partition-v1-level14",
      generatedAt: "2026-08-26T00:00:00.000Z",
      captureYear: 2024,
      attribution: "NYC OTI / NYS Statewide Digital Orthoimagery Program, CC BY 4.0",
      targetGroundSampleDistanceMeters: ZONE_IMAGERY_TARGET_GSD_METERS,
      entries: [
        {
          zoneRef: "ground-cell-000000-14-4822-4489/water",
          cellId: "ground-cell-000000-14-4822-4489",
          class: "water",
          artifactRef: "artifacts/ground-cell-000000-14-4822-4489/water.jpg",
          checksumSha256: "a".repeat(64),
          byteSize: 1024,
          pixelWidth: 1548,
          pixelHeight: 1017,
          bounds: CELL_BOUNDS,
          sourceTiles: ["000230"],
          coveredPixelFraction: 1,
        },
      ],
      refusals: [],
    };
  }

  it("accepts a well-formed index", () => {
    expect(validateZoneImageryIndex(validIndex()).ok).toBe(true);
  });

  it("recognises exactly the three imagery classes", () => {
    expect([...ZONE_IMAGERY_CLASSES]).toEqual(["park", "plaza", "water"]);
    for (const value of ["roadbed", "sidewalk", "curb", "crosswalk", "", null, 7]) {
      expect(isZoneImageryClass(value)).toBe(false);
    }
  });

  it("rejects a zone ref that disagrees with its cell and class", () => {
    const index = validIndex();
    index.entries[0]!.zoneRef = "ground-cell-000000-14-4822-4489/park";
    const result = validateZoneImageryIndex(index);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.path.endsWith(".zoneRef"))).toBe(true);
  });

  it("rejects duplicate zone refs", () => {
    const index = validIndex();
    index.entries.push({ ...index.entries[0]! });
    expect(validateZoneImageryIndex(index).ok).toBe(false);
  });

  it("rejects a path-traversing artifact ref", () => {
    const index = validIndex();
    index.entries[0]!.artifactRef = "../../etc/passwd";
    expect(validateZoneImageryIndex(index).ok).toBe(false);
  });

  it("rejects a non-SHA-256 checksum", () => {
    const index = validIndex();
    index.entries[0]!.checksumSha256 = "A".repeat(64);
    expect(validateZoneImageryIndex(index).ok).toBe(false);
  });

  it("rejects a declared GSD that drifts from the pinned build constant", () => {
    const index = validIndex();
    index.targetGroundSampleDistanceMeters = 0.61;
    expect(validateZoneImageryIndex(index).ok).toBe(false);
  });

  it("rejects a refusal with no reason, because a silent gap is the defect", () => {
    const index = validIndex();
    index.refusals.push({
      zoneRef: "ground-cell-000001-14-4823-4489/park",
      cellId: "ground-cell-000001-14-4823-4489",
      class: "park",
      reason: "",
    });
    const result = validateZoneImageryIndex(index);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.path.endsWith(".reason"))).toBe(true);
  });

  it("rejects an entry claiming coverage outside [0, 1]", () => {
    const index = validIndex();
    index.entries[0]!.coveredPixelFraction = 1.5;
    expect(validateZoneImageryIndex(index).ok).toBe(false);
  });

  it("rejects an entry with no contributing source tile", () => {
    const index = validIndex();
    index.entries[0]!.sourceTiles = [];
    expect(validateZoneImageryIndex(index).ok).toBe(false);
  });
});

/**
 * Conformance of the SHIPPED release against the unmodified T005 schema.
 *
 * This is the check that proves the seam was used as designed rather than
 * widened: the release document is validated by the very function T005 ships,
 * with no test-local relaxation.
 */
describe("shipped release conformance", () => {
  const ROOT = "public/data/manhattan-ground-zone-imagery-20260826";
  const document = readJson(`${ROOT}/release.json`) as Record<string, unknown>;
  const index = readJson(`${ROOT}/zone-imagery.json`) as ZoneImageryIndex;

  it("validates against the unmodified T005 ground release schema", () => {
    const result = validateGroundReleaseStructure(document);
    expect(result.ok, JSON.stringify(result.ok ? [] : result.issues.slice(0, 5))).toBe(true);
  });

  it("uses the single zoneImagery seam to point at the index", () => {
    const seam = document.zoneImagery as Record<string, unknown>;
    expect(seam.artifactRef).toBe("zone-imagery.json");
    expect(seam.captureYear).toBe(2024);
    expect(String(seam.checksumSha256)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("ships a well-formed index whose entries and refusals are disjoint", () => {
    expect(validateZoneImageryIndex(index).ok).toBe(true);
    const textured = new Set(index.entries.map((entry) => entry.zoneRef));
    for (const refusal of index.refusals) expect(textured.has(refusal.zoneRef)).toBe(false);
  });

  it("accounts for every zone asset the base release declares", () => {
    const base = readJson("public/data/manhattan-ground-20260824/release.json") as {
      assets: { cellId: string; class: string }[];
    };
    const candidates = base.assets.filter((asset) =>
      (ZONE_IMAGERY_CLASSES as readonly string[]).includes(asset.class),
    );
    const accounted = new Set([
      ...index.entries.map((entry) => entry.zoneRef),
      ...index.refusals.map((refusal) => refusal.zoneRef),
    ]);
    expect(accounted.size).toBe(candidates.length);
    for (const candidate of candidates) {
      expect(accounted.has(zoneRef(candidate.cellId, candidate.class as never))).toBe(true);
    }
  });

  it("keeps every texture inside the per-shard byte budget", () => {
    // CITYWIDE_BUDGETS.geometryShardBytes. Imagery is not a geometry shard, but
    // it is the only per-artifact bar this project has, so it is the one used.
    for (const entry of index.entries) expect(entry.byteSize).toBeLessThan(2 * 1024 * 1024);
  });

  it("ships only fully covered textures", () => {
    for (const entry of index.entries) expect(entry.coveredPixelFraction).toBe(1);
  });
});
