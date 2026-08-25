import { describe, expect, it } from "vitest";
import { MANHATTAN_GROUND_EMBELLISHMENT_RELEASE_ID, type GroundEmbellishmentCellArtifact } from "../../runtime/ground-embellishment-runtime";
import {
  GROUND_EMBELLISHMENT_BASE_HEIGHT_METERS,
  GROUND_EMBELLISHMENT_COLORS,
  groundEmbellishmentStatusSegment,
  planGroundEmbellishmentCellRender,
} from "./ground-embellishment-render-plan";
import { GROUND_CLASS_COLORS, GROUND_CLASS_HEIGHT_METERS, groundPickId } from "./ground-render-plan";

const CELL_BOUNDS = { west: -73.99, south: 40.75, east: -73.97, north: 40.76 };

function artifact(overrides: Partial<GroundEmbellishmentCellArtifact> = {}): GroundEmbellishmentCellArtifact {
  return {
    schemaVersion: "manhattan-ground-embellishment-artifact-1",
    releaseId: MANHATTAN_GROUND_EMBELLISHMENT_RELEASE_ID,
    cellId: "ground-cell-000051-14-4824-4482",
    class: "curb",
    cellBounds: CELL_BOUNDS,
    coordinateDecimals: 7,
    claimLevel: "estimated",
    derivation: {
      algorithm: "pavement-edge-constrained-curb-v1",
      inputDataset: "x9uq-u3qs",
      note: "Alignment verbatim.",
      profile: { topElevationMeters: 0.22, roadbedElevationMeters: 0, authoredRiseMeters: 0.22, profileIsEstimated: true },
    },
    partCount: 1,
    parts: [{
      partId: "udt:ground:manhattan:curb:aaaa#ground-cell-000051-14-4824-4482",
      canonicalFeatureId: "udt:ground:manhattan:curb:aaaa",
      clipped: false,
      boundaryCoincident: false,
      geometry: { type: "MultiLineString", coordinates: [[[-73.985, 40.752], [-73.984, 40.753], [-73.983, 40.754]]] },
    }],
    ...overrides,
  };
}

describe("ground embellishment render plan", () => {
  it("extrudes the artifact's OWN declared profile above the drawn roadbed", () => {
    const plan = planGroundEmbellishmentCellRender(artifact());
    expect(plan.baseHeightMeters).toBe(GROUND_CLASS_HEIGHT_METERS.roadbed);
    expect(plan.topHeightMeters).toBeCloseTo(GROUND_CLASS_HEIGHT_METERS.roadbed + 0.22, 10);
    expect(plan.profileIsEstimated).toBe(true);
    // A release shipping a different rise draws a different curb, with no code
    // change here: the number is read, never assumed.
    const taller = planGroundEmbellishmentCellRender(artifact({
      derivation: { ...artifact().derivation, profile: { topElevationMeters: 0.5, roadbedElevationMeters: 0.05, authoredRiseMeters: 0.45, profileIsEstimated: true } },
    }));
    expect(taller.topHeightMeters).toBeCloseTo(GROUND_EMBELLISHMENT_BASE_HEIGHT_METERS + 0.5, 10);
    expect(taller.baseHeightMeters).toBeCloseTo(GROUND_EMBELLISHMENT_BASE_HEIGHT_METERS + 0.05, 10);
  });

  it("emits one wall per line, with the segment count it will actually cost", () => {
    const plan = planGroundEmbellishmentCellRender(artifact());
    expect(plan.walls).toHaveLength(1);
    expect(plan.walls[0]!.positions).toEqual([-73.985, 40.752, -73.984, 40.753, -73.983, 40.754]);
    expect(plan.walls[0]!.segments).toBe(2);
    expect(plan.segments).toBe(2);
  });

  /**
   * The identity claim of this task, at its source.
   *
   * A curb's pick id is minted by the SAME function the flat surfaces use, from
   * the canonical feature id alone. There is no per-tier or per-cell component
   * that a tier switch could change.
   */
  it("mints the same ground pick identity the flat surfaces mint", () => {
    const plan = planGroundEmbellishmentCellRender(artifact());
    expect(plan.walls[0]!.pickId).toBe(groundPickId("udt:ground:manhattan:curb:aaaa"));
    expect(plan.walls[0]!.pickId).toBe("ground:udt:ground:manhattan:curb:aaaa");
    expect(plan.drawnFeatureIds).toEqual(["udt:ground:manhattan:curb:aaaa"]);
    // Two cells' shares of one curb produce the same pick id, so picking either
    // share selects the curb once.
    const otherCell = planGroundEmbellishmentCellRender(artifact({
      cellId: "ground-cell-000052-14-4825-4482",
      parts: [{ ...artifact().parts[0]!, partId: "udt:ground:manhattan:curb:aaaa#ground-cell-000052-14-4825-4482" }],
    }));
    expect(otherCell.walls[0]!.pickId).toBe(plan.walls[0]!.pickId);
  });

  it("refuses a part whose every line collapses at the shipped precision, and says so", () => {
    const plan = planGroundEmbellishmentCellRender(artifact({
      parts: [{ ...artifact().parts[0]!, geometry: { type: "MultiLineString", coordinates: [[[-73.985, 40.752], [-73.985, 40.752]]] } }],
    }));
    expect(plan.walls).toHaveLength(0);
    expect(plan.refusals).toHaveLength(1);
    expect(plan.refusals[0]!.reason).toBe("degenerate-alignment");
    expect(plan.refusals[0]!.groundClass).toBe("curb");
    expect(plan.refusals[0]!.statement).toContain("ground-cell-000051-14-4824-4482");
    expect(plan.refusals[0]!.statement).toContain("0.22");
  });

  it("drops a repeated position without dropping the line it belongs to", () => {
    const plan = planGroundEmbellishmentCellRender(artifact({
      parts: [{ ...artifact().parts[0]!, geometry: { type: "MultiLineString", coordinates: [[[-73.985, 40.752], [-73.985, 40.752], [-73.984, 40.753]]] } }],
    }));
    expect(plan.refusals).toHaveLength(0);
    expect(plan.walls[0]!.positions).toEqual([-73.985, 40.752, -73.984, 40.753]);
    expect(plan.walls[0]!.segments).toBe(1);
  });

  it("colours the near tier a step above the sidewalk it abuts", () => {
    expect(GROUND_EMBELLISHMENT_COLORS.curb).toBe("#4a5761");
    expect(GROUND_EMBELLISHMENT_COLORS.curb).not.toBe(GROUND_CLASS_COLORS.sidewalk);
  });
});

describe("ground embellishment status segment", () => {
  const summary = {
    activeCells: 2,
    eligibleCells: 3,
    drawnSegments: 41_233,
    skippedParts: 0,
    failedCells: 0,
    residentBytes: 2_400_000,
    nearTierMaxDistanceMeters: 400,
  };

  it("says nothing at all when the near tier is not serving", () => {
    expect(groundEmbellishmentStatusSegment(null)).toBe("");
    expect(groundEmbellishmentStatusSegment({ ...summary, activeCells: 0, drawnSegments: 0 })).toBe("");
  });

  it("reports counts and the release's own ring, never an adjective", () => {
    expect(groundEmbellishmentStatusSegment(summary)).toBe(" · near-tier curbs within 400 m: 2 cells / 41233 segments");
    expect(groundEmbellishmentStatusSegment({ ...summary, activeCells: 1 })).toContain("1 cell / ");
  });

  it("names refusals and skipped parts without touching the base's reading", () => {
    const segment = groundEmbellishmentStatusSegment({ ...summary, failedCells: 1, skippedParts: 3 });
    expect(segment).toContain("3 curb parts skipped: degenerate alignment");
    expect(segment).toContain("1 curb cell refused (verification failed)");
    expect(segment.startsWith(" · ")).toBe(true);
    // A failure with nothing drawn still reports, and still only about curbs.
    expect(groundEmbellishmentStatusSegment({ ...summary, activeCells: 0, drawnSegments: 0, failedCells: 2 }))
      .toBe(" · 2 curb cells refused (verification failed)");
  });
});
