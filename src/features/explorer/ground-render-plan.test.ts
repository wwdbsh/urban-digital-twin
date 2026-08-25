import { describe, expect, it } from "vitest";
import { GROUND_BASE_CLASSES, type GroundClass } from "../../domain/ground";
import { ringSimplicityCensus } from "../../release/ground-geometry";
import { GROUND_ARTIFACT_SCHEMA_VERSION, MANHATTAN_GROUND_RELEASE_ID, type GroundCellArtifact } from "../../runtime/ground-release-runtime";
import { groundFeatureForPickId } from "./CesiumViewport";
import {
  GROUND_CLASS_COLORS,
  GROUND_CLASS_DRAW_ORDER,
  GROUND_CLASS_HEIGHT_METERS,
  groundClassesForVisibility,
  groundPickId,
  groundRenderStatusLine,
  parseGroundPickId,
  planGroundCellRender,
} from "./ground-render-plan";

const SIMPLE_SQUARE = [[[-74, 40.7], [-73.99, 40.7], [-73.99, 40.71], [-74, 40.71], [-74, 40.7]]];
/** A bow tie: the middle vertex is visited twice, exactly what the clipper emits along a cell edge. */
const SELF_TOUCHING = [[[-74, 40.7], [-73.99, 40.71], [-73.98, 40.7], [-73.99, 40.71], [-73.98, 40.72], [-74, 40.7]]];
const WITH_HOLE = [
  [[-74, 40.7], [-73.99, 40.7], [-73.99, 40.71], [-74, 40.71], [-74, 40.7]],
  [[-73.998, 40.702], [-73.992, 40.702], [-73.992, 40.708], [-73.998, 40.708], [-73.998, 40.702]],
];

function artifact(cellId: string, groundClass: GroundClass, parts: { canonicalFeatureId: string; rings: number[][][] }[]): GroundCellArtifact {
  return {
    schemaVersion: GROUND_ARTIFACT_SCHEMA_VERSION,
    releaseId: MANHATTAN_GROUND_RELEASE_ID,
    cellId,
    class: groundClass,
    cellBounds: { west: -74.05, south: 40.67, east: -73.89, north: 40.89 },
    coordinateDecimals: 7,
    partCount: parts.length,
    parts: parts.map((part) => ({
      partId: `${part.canonicalFeatureId}#${cellId}`,
      canonicalFeatureId: part.canonicalFeatureId,
      clipped: true,
      geometry: { type: "MultiPolygon" as const, coordinates: [part.rings] },
    })),
  };
}

describe("ground render plan", () => {
  it("draws simple shares and refuses self-touching ones, with a statement and a count", () => {
    const plan = planGroundCellRender(artifact("ground-cell-000017-14-4825-4487", "roadbed", [
      { canonicalFeatureId: "udt:ground:manhattan:roadbed:simple", rings: SIMPLE_SQUARE },
      { canonicalFeatureId: "udt:ground:manhattan:roadbed:bowtie", rings: SELF_TOUCHING },
    ]));
    expect(plan.polygons).toHaveLength(1);
    expect(plan.polygons[0]!.canonicalFeatureId).toBe("udt:ground:manhattan:roadbed:simple");
    expect(plan.refusals).toHaveLength(1);
    const refusal = plan.refusals[0]!;
    expect(refusal.canonicalFeatureId).toBe("udt:ground:manhattan:roadbed:bowtie");
    expect(refusal.reason).toBe("non-simple-ring");
    expect(refusal.selfTouchingRings).toBe(1);
    expect(refusal.statement).toContain("ground-cell-000017-14-4825-4487");
    expect(refusal.statement).toContain("visit a position twice");
    expect(plan.drawnFeatureIds).toEqual(["udt:ground:manhattan:roadbed:simple"]);
  });

  it("counts refusals by the same predicate the release census counts by", () => {
    const censusOfRefused = ringSimplicityCensus([SELF_TOUCHING]);
    expect(censusOfRefused.selfTouchingRings).toBe(1);
    const censusOfDrawn = ringSimplicityCensus([SIMPLE_SQUARE]);
    expect(censusOfDrawn.selfTouchingRings).toBe(0);
    const plan = planGroundCellRender(artifact("ground-cell-000017-14-4825-4487", "sidewalk", [
      { canonicalFeatureId: "udt:ground:manhattan:sidewalk:a", rings: SELF_TOUCHING },
    ]));
    expect(plan.refusals[0]!.selfTouchingRings).toBe(censusOfRefused.selfTouchingRings);
  });

  it("drops the closing vertex and keeps holes as holes", () => {
    const plan = planGroundCellRender(artifact("ground-cell-000017-14-4825-4487", "park", [
      { canonicalFeatureId: "udt:manhattan:park:M001", rings: WITH_HOLE },
    ]));
    const polygon = plan.polygons[0]!;
    // 5 closed positions become 4 open ones, flattened to 8 ordinates.
    expect(polygon.outer.positions).toHaveLength(8);
    expect(polygon.holes).toHaveLength(1);
    expect(polygon.holes[0]!.positions).toHaveLength(8);
  });

  it("gives one canonical feature one pick id however many cells it is split across", () => {
    const west = planGroundCellRender(artifact("ground-cell-000060-14-4826-4483", "park", [{ canonicalFeatureId: "udt:manhattan:park:M010", rings: SIMPLE_SQUARE }]));
    const east = planGroundCellRender(artifact("ground-cell-000061-14-4827-4483", "park", [{ canonicalFeatureId: "udt:manhattan:park:M010", rings: SIMPLE_SQUARE }]));
    expect(west.polygons[0]!.pickId).toBe(east.polygons[0]!.pickId);
    expect(west.polygons[0]!.partId).not.toBe(east.polygons[0]!.partId);
    expect(parseGroundPickId(west.polygons[0]!.pickId)).toBe("udt:manhattan:park:M010");
  });

  it("stacks the classes in a strict painter's order with a colour for every shipped class", () => {
    expect([...GROUND_CLASS_DRAW_ORDER].sort()).toEqual([...GROUND_BASE_CLASSES].sort());
    const heights = GROUND_CLASS_DRAW_ORDER.map((groundClass) => GROUND_CLASS_HEIGHT_METERS[groundClass]);
    for (let index = 1; index < heights.length; index += 1) expect(heights[index]!).toBeGreaterThan(heights[index - 1]!);
    // Under the public-realm proxy heights already in the scene (0.05/0.16/0.32).
    expect(Math.max(...heights)).toBeLessThanOrEqual(0.32);
    for (const groundClass of GROUND_BASE_CLASSES) expect(GROUND_CLASS_COLORS[groundClass]).toMatch(/^#[0-9a-f]{6}$/u);
  });

  it("fetches only the toggled-on classes the release actually ships", () => {
    const shipped: GroundClass[] = ["roadbed", "sidewalk", "park", "plaza", "water"];
    expect(groundClassesForVisibility({}, shipped)).toEqual(["roadbed", "sidewalk", "park", "plaza", "water"]);
    expect(groundClassesForVisibility({ water: false, plaza: false }, shipped)).toEqual(["roadbed", "sidewalk", "park"]);
    expect(groundClassesForVisibility({}, ["roadbed"])).toEqual(["roadbed"]);
    expect(groundClassesForVisibility({ roadbed: false }, ["roadbed"])).toEqual([]);
  });

  it("states drawn, skipped, refused and undrawn counts rather than an adjective", () => {
    expect(groundRenderStatusLine({ drawnCells: 3, visibleCells: 5, drawnPolygons: 1_200, skippedParts: 2, failedCells: 1, residentBytes: 10 }))
      .toBe("Ground canary · 3 cells drawn · 1200 polygons · 2 parts skipped: non-simple rings · 1 cell artifact refused (verification failed) · 2 cells in view not yet drawn");
    expect(groundRenderStatusLine({ drawnCells: 1, visibleCells: 1, drawnPolygons: 4, skippedParts: 0, failedCells: 0, residentBytes: 10 }))
      .toBe("Ground canary · 1 cell drawn · 4 polygons · 0 parts skipped");
  });
});

describe("ground picking", () => {
  const feature = {
    canonicalFeatureId: "udt:manhattan:park:M010",
    cityId: "city:manhattan",
    class: "park" as const,
    claimLevel: "source-backed" as const,
    sourceRefs: [],
    uncertainty: { horizontalMeters: null, verticalMeters: null, temporal: "n/a" },
    identityOrigin: { kind: "referenced-existing" as const, existingFeatureId: "udt:manhattan:park:M010" },
  };
  const pickMap = new Map([["udt:manhattan:park:M010", feature]]);

  it("resolves a ground pick id to its canonical feature", () => {
    expect(groundFeatureForPickId(groundPickId("udt:manhattan:park:M010"), pickMap)).toBe(feature);
  });

  it("never claims a building, storefront or public-realm pick", () => {
    // Exactly the id shapes the other pick maps use.
    expect(groundFeatureForPickId("udt:manhattan:building:1012340001", pickMap)).toBeNull();
    expect(groundFeatureForPickId("exterior-cell:ground-cell-1:udt:manhattan:building:1", pickMap)).toBeNull();
    expect(groundFeatureForPickId("public-realm-proxy:roadbed:1", pickMap)).toBeNull();
    expect(groundFeatureForPickId(null, pickMap)).toBeNull();
    expect(groundFeatureForPickId("ground:not-in-this-release", pickMap)).toBeNull();
  });
});
