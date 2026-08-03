import { describe, expect, it } from "vitest";
import fixtureText from "./fixtures/nyc-building-footprints.schema.fixture.geojson?raw";
import { manhattanAdapter } from "../data/city-adapters";
import { sourceRegistry } from "../data/source-registry";
import { sha256Hex } from "./offline";
import { NycBuildingFootprintsSnapshotAdapter, type NycBuildingFootprintsSnapshotMetadata } from "./nyc-building-footprints";

const pendingEntry = sourceRegistry.find((entry) => entry.id === "nyc.building-footprints") ?? (() => { throw new Error("Expected the NYC Building Footprints registry entry."); })();

const approvedEntry = {
  ...pendingEntry,
  approval: {
    ...pendingEntry.approval,
    state: "approved" as const,
    scope: "ingestion" as const,
    note: "Approved by the test harness only; fixture is invented.",
  },
};


async function metadata(): Promise<NycBuildingFootprintsSnapshotMetadata> {
  return {
    sourceRegistryEntryId: "nyc.building-footprints",
    inputFileName: "nyc-building-footprints.schema.fixture.geojson",
    inputChecksumSha256: await sha256Hex(fixtureText),
    termsUrl: pendingEntry.termsUrl,
    attribution: "Synthetic test fixture shaped like NYC OTI Building Footprints fields; not real data.",
    releaseTimestamp: "2026-08-03T00:00:00Z",
    captureTimestamp: "2026-08-03T00:00:00Z",
    updateTimestamp: "2026-08-03T00:00:00Z",
    ingestedAt: "2026-08-03T00:00:01Z",
    inputCrs: "EPSG:4326",
    verticalDatum: "NAVD88 for GROUND_ELEVATION when documented; HEIGHT_ROOF relative to source ground",
    fixtureOnly: true,
    immutable: true,
  };
}

describe("NycBuildingFootprintsSnapshotAdapter", () => {
  it("fails closed while the production source registry entry is pending", async () => {
    await expect(NycBuildingFootprintsSnapshotAdapter.fromSnapshot({
      snapshotText: fixtureText,
      metadata: await metadata(),
      city: manhattanAdapter,
    })).rejects.toThrow(/pending/);
  });

  it("parses official-shaped fields, preserves provenance, and accounts for invalid records", async () => {
    const adapter = await NycBuildingFootprintsSnapshotAdapter.fromSnapshot({
      snapshotText: fixtureText,
      metadata: await metadata(),
      city: manhattanAdapter,
      registryEntries: [approvedEntry],
    });
    const report = adapter.getIngestionReport();
    expect(report.immutable).toBe(true);
    expect(report.acceptedCount).toBe(2);
    expect(report.acceptedFeatureCount).toBe(3);
    expect(report.rejectedCount).toBe(1);
    expect(report.rejectedRecordIndices).toEqual([2]);
    expect(report.allInputRecordsAccountedFor).toBe(true);
    expect(report.rejected[0]?.sourceId).toBe("fixture-doitt-invalid-height");

    const first = adapter.search("fixture-doitt-001")[0];
    expect(first?.sourceRefs[0]?.sourceRecordId).toBe("fixture-doitt-001");
    expect(first?.attributes.bin).toBe("1000001");
    expect(first?.attributes.baseBbl).toBe("1000010001");
    expect(first?.geometryProvenance.height.valueMeters).toBe(30.5);
    expect(first?.geometryProvenance.height.verticalDatum).toContain("HEIGHT_ROOF relative");
    expect(first?.geometryProvenance.height.uncertaintyMeters).toBeNull();
    expect(first?.geometryProvenance.outputCrs).toBe("EPSG:4326");
    expect(first?.provenance).toBe("generated");
    expect(first?.geometry.type === "Polygon" ? first.geometry.coordinates : []).toHaveLength(2);
  });

  it("normalizes Polygon and MultiPolygon rings with holes and clips to the slice", async () => {
    const adapter = await NycBuildingFootprintsSnapshotAdapter.fromSnapshot({
      snapshotText: fixtureText,
      metadata: await metadata(),
      city: manhattanAdapter,
      registryEntries: [approvedEntry],
    });
    const parts = adapter.search("fixture-doitt-002");
    expect(parts).toHaveLength(2);
    expect(parts.every((feature) => feature.geometry.type === "Polygon")).toBe(true);
    const firstGeometry = parts[0]?.geometry;
    expect(firstGeometry?.type === "Polygon" ? firstGeometry.coordinates : []).toHaveLength(1);
    expect(parts[0]?.attributes.geometryPartCount).toBe(2);
    expect(parts[1]?.geometry.type === "Polygon" ? parts[1].geometry.coordinates[0]?.some(([longitude]) => longitude === -74.01) : false).toBe(true);
    expect(parts.every((feature) => feature.sourceRefs[0]?.sourceRecordId === "fixture-doitt-002")).toBe(true);
    expect(adapter.getLayerManifest("buildings").acceptedCount).toBe(3);
    expect(adapter.getLayerManifest("pois").acceptedCount).toBe(0);
  });

  it("keeps IDs, source-record search, tile loading, and cache deduplication stable", async () => {
    const adapter = await NycBuildingFootprintsSnapshotAdapter.fromSnapshot({
      snapshotText: fixtureText,
      metadata: await metadata(),
      city: manhattanAdapter,
      registryEntries: [approvedEntry],
    });
    const firstLoad = await adapter.loadLayerFeatures("buildings");
    const secondLoad = await adapter.loadLayerFeatures("buildings");
    expect(firstLoad.map((feature) => feature.id)).toEqual(secondLoad.map((feature) => feature.id));
    expect(adapter.cacheSize()).toBe(adapter.getLayerManifest("buildings").tileKeys.length);
    expect(adapter.search("1000002").map((feature) => feature.sourceRefs[0]?.sourceRecordId)).toEqual(["fixture-doitt-002", "fixture-doitt-002"]);
    expect(adapter.getFeature(firstLoad[0]?.id ?? "missing")?.id).toBe(firstLoad[0]?.id);
  });

  it("rejects checksum and terms metadata mismatches before normalization", async () => {
    const current = await metadata();
    await expect(NycBuildingFootprintsSnapshotAdapter.fromSnapshot({
      snapshotText: fixtureText,
      metadata: { ...current, inputChecksumSha256: "0".repeat(64) },
      registryEntries: [approvedEntry],
    })).rejects.toThrow(/checksum/);
    await expect(NycBuildingFootprintsSnapshotAdapter.fromSnapshot({
      snapshotText: fixtureText,
      metadata: { ...current, termsUrl: "https://example.invalid/wrong-terms" },
      registryEntries: [approvedEntry],
    })).rejects.toThrow(/terms URL/);
  });
});
