import { describe, expect, it } from "vitest";
import { sourceRegistry } from "../data/source-registry";
import { sha256Hex } from "./offline";
import { TransitSnapshotAdapter } from "./transit-snapshot";
import fixture from "./fixtures/transit.schema.fixture.geojson?raw";

const metadata = async (snapshotText = fixture) => ({ inputFileName: "transit.schema.fixture.geojson", inputChecksumSha256: await sha256Hex(snapshotText), ingestedAt: "2026-08-03T00:00:00Z", immutable: true as const, fixtureOnly: true });

describe("TransitSnapshotAdapter", () => {
  it("normalizes station, entrance, clipped multiline route and counts malformed/outside records", async () => {
    const adapter = await TransitSnapshotAdapter.fromSnapshot({ snapshotText: fixture, metadata: await metadata() });
    const report = adapter.getIngestionReport();
    expect(report.acceptedFeatureCount).toBe(3);
    expect(report.rejectedRecordIndices).toEqual([3]);
    expect(report.allInputRecordsAccountedFor).toBe(true);
    expect(report.layerManifests.stations.acceptedCount).toBe(1);
    expect(report.layerManifests.entrances.acceptedCount).toBe(1);
    expect(report.layerManifests.routes.acceptedCount).toBe(1);
    const route = (await adapter.loadLayerFeatures("routes"))[0]!;
    expect(route.geometry.type).toBe("MultiLineString");
    expect(route.attributes.transitGeometrySemantics).toBe("schematic-route-centerline-not-tunnel");
    expect(route.geometryProvenance.outputCrs).toBe("EPSG:4326");
  });

  it("preserves canonical IDs and parent relationships across repeated loads", async () => {
    const adapter = await TransitSnapshotAdapter.fromSnapshot({ snapshotText: fixture, metadata: await metadata() });
    const station = (await adapter.loadLayerFeatures("stations"))[0]!;
    const entrance = (await adapter.loadLayerFeatures("entrances"))[0]!;
    expect(station.id).toContain(encodeURIComponent("fixture-station-001"));
    expect(entrance.attributes.transitParentStationId).toBe("fixture-station-001");
    expect(adapter.search("fixture-station-001")[0]?.name).toBe("Fixture Union Square Station Complex");
    expect(adapter.search("fixture-route-001")[0]?.kind).toBe("transit-route");
    expect(adapter.search("fixture-complex-001").map((feature) => feature.kind)).toEqual(["transit-entrance", "transit-station"]);
    await adapter.loadLayerFeatures("routes");
    expect(adapter.cacheSize()).toBeGreaterThan(0);
    expect((await adapter.loadLayerFeatures("routes")).map((feature) => feature.id)).toEqual([routeId(adapter)]);
  });

  it("fails closed for pending production sources before output concerns", async () => {
    const pending = fixture.replaceAll("fixture.local.transit", "mta.gtfs-static");
    await expect(TransitSnapshotAdapter.fromSnapshot({ snapshotText: pending, metadata: await metadata(pending) })).rejects.toThrow(/pending/);
    expect(sourceRegistry.find((entry) => entry.id === "mta.gtfs-static")?.approval.state).toBe("pending");
  });

  it("rejects checksum mismatch and mutable metadata", async () => {
    await expect(TransitSnapshotAdapter.fromSnapshot({ snapshotText: fixture, metadata: { ...(await metadata()), inputChecksumSha256: "0".repeat(64) } })).rejects.toThrow(/checksum/);
    await expect(TransitSnapshotAdapter.fromSnapshot({ snapshotText: fixture, metadata: { ...(await metadata()), immutable: false as never } })).rejects.toThrow(/immutable/);
  });
});

function routeId(adapter: TransitSnapshotAdapter): string {
  return adapter.search("fixture-route-001")[0]?.id ?? "";
}
