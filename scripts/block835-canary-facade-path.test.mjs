import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { deriveFacadePose, fullFacadeStandoffMeters, metersPerDegree } from "./block835-canary-facade-path-cli.mjs";

const FIXTURE = JSON.parse(readFileSync("data/block835-canary-validation-20260811/facade-path.json", "utf8"));

const BUILDING = {
  heightMeters: 20,
  tier0HalfExtentEastMeters: 10,
  tier0HalfExtentNorthMeters: 6,
  anchorLongitude: -73.9868,
  anchorLatitude: 40.7488,
  anchorSource: { releaseId: "test" },
  planFile: "plans/test.json",
  planHashSha256: "a".repeat(64),
  planFileSha256: "b".repeat(64),
  tier0BoundsMm: { minX: -10000, maxX: 10000, minY: -6000, maxY: 6000 },
  heightMm: 20000,
};

describe("metres per degree", () => {
  it("matches the well-known WGS84 values near 40.75 N", () => {
    const scale = metersPerDegree(40.7488);
    expect(scale.latitude).toBeGreaterThan(111_000);
    expect(scale.latitude).toBeLessThan(111_200);
    expect(scale.longitude).toBeGreaterThan(84_000);
    expect(scale.longitude).toBeLessThan(84_600);
  });
});

describe("full-facade standoff", () => {
  it("solves the standoff so the declared vertical framing fits the building height", () => {
    // 16:9 vertical half-angle is 18.005 degrees, so 2*tan gives ~0.65.
    expect(fullFacadeStandoffMeters(20)).toBe(31);
    expect(fullFacadeStandoffMeters(100)).toBe(154);
  });

  it("grows monotonically with height", () => {
    expect(fullFacadeStandoffMeters(50)).toBeGreaterThan(fullFacadeStandoffMeters(20));
  });
});

describe("pose derivation", () => {
  it("places the camera outside the named facade and looks back at it", () => {
    const east = deriveFacadePose({ poseId: "p", buildingId: "doitt:1", facade: "east", framing: "full-facade" }, BUILDING);
    expect(east.pose.heading).toBe(270);
    expect(east.pose.longitude).toBeGreaterThan(BUILDING.anchorLongitude);
    expect(east.pose.latitude).toBe(BUILDING.anchorLatitude);
    const south = deriveFacadePose({ poseId: "p", buildingId: "doitt:1", facade: "south", framing: "full-facade" }, BUILDING);
    expect(south.pose.heading).toBe(0);
    expect(south.pose.latitude).toBeLessThan(BUILDING.anchorLatitude);
  });

  it("reports the perpendicular camera-to-facade distance, not the centre distance", () => {
    const east = deriveFacadePose({ poseId: "p", buildingId: "doitt:1", facade: "east", framing: "full-facade" }, BUILDING);
    expect(east.cameraToFacadeMeters).toBe(31);
    expect(east.cameraToBuildingCentreMeters).toBeCloseTo(41, 3);
    expect(east.cameraToBuildingCentreMeters - east.tier0HalfExtentMeters).toBeCloseTo(east.cameraToFacadeMeters, 6);
  });

  it("uses the facade-normal half extent, so east and north poses differ", () => {
    const east = deriveFacadePose({ poseId: "p", buildingId: "doitt:1", facade: "east", framing: "full-facade" }, BUILDING);
    const north = deriveFacadePose({ poseId: "p", buildingId: "doitt:1", facade: "north", framing: "full-facade" }, BUILDING);
    expect(east.tier0HalfExtentMeters).toBe(10);
    expect(north.tier0HalfExtentMeters).toBe(6);
  });

  it("never claims a roofline for a street-level lower-facade pose", () => {
    const street = deriveFacadePose({ poseId: "p", buildingId: "doitt:1", facade: "east", framing: "street-level-lower-facade" }, { ...BUILDING, heightMeters: 380, heightMm: 380000 });
    expect(street.rooflineInFrame).toBe(false);
    expect(street.cameraToFacadeMeters).toBe(25);
    expect(street.pose.pitch).toBe(25);
  });

  it("keeps the 10 m contract floor even for a very short building", () => {
    const tiny = deriveFacadePose({ poseId: "p", buildingId: "doitt:1", facade: "east", framing: "full-facade" }, { ...BUILDING, heightMeters: 3, heightMm: 3000 });
    expect(tiny.cameraToFacadeMeters).toBeGreaterThanOrEqual(10);
  });
});

describe("committed fixture", () => {
  it("pins every pose to a committed plan hash and a named anchor source", () => {
    expect(FIXTURE.pathId).toBe("block835-canary-facade-v1");
    for (const pose of FIXTURE.poses) {
      expect(pose.plan.planHashSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(pose.plan.fileSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(pose.anchor.source.fileSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(pose.anchor.source.releaseId).toBe("manhattan-citywide-20260804");
    }
  });

  it("targets distinct buildings across the block", () => {
    expect(new Set(FIXTURE.poses.map((pose) => pose.buildingId)).size).toBe(FIXTURE.poses.length);
  });
});
