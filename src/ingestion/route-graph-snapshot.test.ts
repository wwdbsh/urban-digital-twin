import { describe, expect, it } from "vitest";
import fixture from "./fixtures/route-graph.synthetic.fixture.json";
import { sourceRegistry } from "../data/source-registry";
import { validateRouteGraph } from "../domain/routing";
import { sha256Hex } from "./offline";
import { ROUTE_SNAP_MAX_DISTANCE_METERS, RouteGraphSnapshotAdapter } from "./route-graph-snapshot";
import { runtimeFixtureFeatures } from "../domain/features";

const snapshotText = JSON.stringify(fixture);
const metadata = async (text = snapshotText) => ({ inputFileName: "route-graph.synthetic.fixture.json", inputChecksumSha256: await sha256Hex(text), ingestedAt: "2026-08-03T00:00:00Z", immutable: true as const, fixtureOnly: true });
const feature = (sourceRecordId: string) => runtimeFixtureFeatures.find((item) => item.sourceRefs[0]?.sourceRecordId === sourceRecordId)!;

describe("RouteGraphSnapshotAdapter", () => {
  it("validates topology, accounts for the malformed edge, and preserves provenance", async () => {
    const adapter = await RouteGraphSnapshotAdapter.fromSnapshot({ snapshotText, metadata: await metadata() });
    const report = adapter.getIngestionReport();
    expect(report.acceptedNodeCount).toBe(6);
    expect(report.acceptedEdgeCount).toBe(11);
    expect(report.rejectedRecordIndices).toEqual([17]);
    expect(report.allInputRecordsAccountedFor).toBe(true);
    expect(adapter.graph.inputCrs).toBe("EPSG:4326");
    expect(adapter.graph.edges.every((edge) => edge.sourceRefs[0]?.licenseRefId === "license:fixture.local.route-graph")).toBe(true);
  });

  it("routes walking and synthetic transit deterministically with mode constraints", async () => {
    const adapter = await RouteGraphSnapshotAdapter.fromSnapshot({ snapshotText, metadata: await metadata() });
    const walking = adapter.route(feature("fixture-poi-001"), feature("fixture-building-001"), "walking", { avoidStairs: false, stepFreeOnly: false, maxSlopePercent: null });
    expect(walking?.mode).toBe("walking");
    expect(walking?.legs[0]?.steps.length).toBe(2);
    expect(walking?.fixtureOnly).toBe(true);
    expect(adapter.route(feature("fixture-poi-001"), feature("fixture-building-001"), "walking", { avoidStairs: false, stepFreeOnly: false, maxSlopePercent: null })?.id).toBe(walking?.id);
    const transit = adapter.route(feature("fixture-station-001"), feature("fixture-retail-001"), "transit", { avoidStairs: false, stepFreeOnly: false, maxSlopePercent: null });
    expect(transit?.geometrySemantics).toBe("transit-schematic");
    expect(adapter.route(feature("fixture-poi-001"), feature("fixture-building-001"), "transit", { avoidStairs: false, stepFreeOnly: false, maxSlopePercent: null })).toBeNull();
  });

  it("snaps by exact feature ID first and reports uncertainty for arbitrary coordinates", async () => {
    const adapter = await RouteGraphSnapshotAdapter.fromSnapshot({ snapshotText, metadata: await metadata() });
    const exact = adapter.snapToFeature(feature("fixture-station-001"));
    expect(exact?.distanceMeters).toBe(0);
    expect(exact?.nodeId).toContain("node-fixture-station-001");
    const arbitrary = adapter.snapToFeature({ ...feature("fixture-poi-001"), id: "invented-feature", coordinates: [-73.9901, 40.7361], geometry: { type: "Point", coordinates: [-73.9901, 40.7361] } });
    expect(arbitrary?.distanceMeters).toBeGreaterThan(0);
    expect(arbitrary?.uncertainty).toContain("Synthetic snap distance");
    expect(ROUTE_SNAP_MAX_DISTANCE_METERS).toBe(150);
  });

  it("fails closed for areas, routes, stale IDs, and distant points", async () => {
    const adapter = await RouteGraphSnapshotAdapter.fromSnapshot({ snapshotText, metadata: await metadata() });
    const area = feature("fixture-area-nta-001");
    expect(adapter.snapToFeature(area)).toBeNull();
    expect(adapter.canRouteFeature(area, "walking")).toBe(false);
    const neighborhood = { ...area, kind: "neighborhood", geometry: { type: "Point", coordinates: [-73.9915, 40.744] } } as typeof area;
    const street = { ...area, kind: "street", geometry: { type: "Point", coordinates: [-73.9915, 40.744] } } as typeof area;
    expect(adapter.snapToFeature(neighborhood)).toBeNull();
    expect(adapter.snapToFeature(street)).toBeNull();
    const polygon = { ...area, id: "stale-area", geometry: { type: "Polygon", coordinates: [[[-73.99, 40.74], [-73.989, 40.74], [-73.989, 40.741], [-73.99, 40.74]]] } } as typeof area;
    expect(adapter.snapToFeature(polygon)).toBeNull();
    expect(adapter.canRouteFeature(polygon)).toBe(false);
    const stalePoint = { ...feature("fixture-poi-001"), id: "stale-point", geometry: { type: "Point", coordinates: [-73.7, 40.7] } } as typeof area;
    expect(adapter.snapToFeature(stalePoint)).toBeNull();
    expect(adapter.route(stalePoint, feature("fixture-building-001"), "walking")).toBeNull();
    expect(adapter.routeByNodes({ featureId: "stale-point", nodeId: "missing", distanceMeters: 0, uncertainty: "stale" }, { featureId: feature("fixture-building-001").id, nodeId: "missing", distanceMeters: 0, uncertainty: "stale" }, "stale-point", feature("fixture-building-001").id, "walking", { avoidStairs: false, stepFreeOnly: false, maxSlopePercent: null })).toBeNull();
  });

  it("fails closed for pending sources, checksum errors, and invalid graph schema", async () => {
    const pending = snapshotText.replaceAll("fixture.local.route-graph", "overture.transportation-routing").replaceAll("route-graph-v1", "transportation-segment-connector");
    await expect(RouteGraphSnapshotAdapter.fromSnapshot({ snapshotText: pending, metadata: await metadata(pending) })).rejects.toThrow(/pending/);
    await expect(RouteGraphSnapshotAdapter.fromSnapshot({ snapshotText, metadata: { ...(await metadata()), inputChecksumSha256: "0".repeat(64) } })).rejects.toThrow(/checksum/);
    expect(validateRouteGraph({ schemaVersion: "1.0", inputCrs: "EPSG:4326", outputCrs: "EPSG:4326", nodes: [], edges: [{ id: "bad", fromNodeId: "missing", toNodeId: "missing", modes: ["walking"], distanceMeters: 0, durationSeconds: 0 }] }).ok).toBe(false);
    expect(sourceRegistry.find((entry) => entry.id === "osm.nyc-routing")?.approval.state).toBe("pending");
  });
});
