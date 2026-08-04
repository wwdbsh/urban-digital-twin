import { describe, expect, it } from "vitest";
import areasText from "./fixtures/areas.schema.fixture.geojson?raw";
import { sourceRegistry } from "../data/source-registry";
import { manhattanAdapter } from "../data/city-adapters";
import { validateFeature } from "../domain/schema";
import { sha256Hex } from "./offline";
import { AreaSnapshotAdapter, type AreaSnapshotMetadata } from "./area-snapshot";

const fixtureEntry = sourceRegistry.find((entry) => entry.id === "fixture.local.manhattan-slice")!;

async function metadata(text: string = areasText): Promise<AreaSnapshotMetadata> {
  return {
    inputFileName: "areas.schema.fixture.geojson",
    inputChecksumSha256: await sha256Hex(text),
    ingestedAt: "2026-08-03T00:00:01Z",
    immutable: true,
    fixtureOnly: true,
  };
}

describe("approval-safe area snapshots", () => {
  it("normalizes Polygon holes and MultiPolygon parts, clips the slice, and preserves semantics", async () => {
    const adapter = await AreaSnapshotAdapter.fromSnapshot({ snapshotText: areasText, metadata: await metadata(), city: manhattanAdapter });
    const features = await adapter.loadLayerFeatures("areas");
    expect(features).toHaveLength(2);
    expect(features.find((feature) => feature.name.includes("Flatiron"))?.geometry.type).toBe("Polygon");
    const flatiron = features.find((feature) => feature.name.includes("Flatiron"));
    expect(flatiron?.geometry.type === "Polygon" && flatiron.geometry.coordinates).toHaveLength(2);
    expect(flatiron?.geometry.type === "Polygon" && flatiron.geometry.coordinates[0]?.some(([longitude]) => longitude === -74.010)).toBe(true);
    expect(features.find((feature) => feature.name.includes("NoMad"))?.geometry.type).toBe("MultiPolygon");
    expect(validateFeature(features.find((feature) => feature.name.includes("NoMad"))).ok).toBe(true);
    expect(adapter.getIngestionReport().rejectedRecordIndices).toEqual([2]);
    expect(adapter.getIngestionReport().allInputRecordsAccountedFor).toBe(true);
    expect(adapter.getArea(features[0]!.id)?.sourceLicense.licenseClass).toBe("fixture-only");
    expect(features[0]?.attributes.areaSemantics).toBe("administrative");
  });

  it("keeps canonical IDs and label points deterministic across repeated loads", async () => {
    const first = await AreaSnapshotAdapter.fromSnapshot({ snapshotText: areasText, metadata: await metadata(), city: manhattanAdapter });
    const second = await AreaSnapshotAdapter.fromSnapshot({ snapshotText: areasText, metadata: await metadata(), city: manhattanAdapter });
    const firstFeatures = await first.loadLayerFeatures("areas");
    const secondFeatures = await second.loadLayerFeatures("areas");
    expect(firstFeatures.map((feature) => feature.id)).toEqual(secondFeatures.map((feature) => feature.id));
    expect(firstFeatures.map((feature) => feature.coordinates)).toEqual(secondFeatures.map((feature) => feature.coordinates));
    expect(first.search("fixture-area-cd-001")[0]?.name).toContain("NoMad");
    await first.loadLayerFeatures("areas");
    expect(first.cacheSize()).toBe(first.getLayerManifest("areas").tileKeys.length);
    expect(first.getFeatures({ buildings: true, pois: true, areas: false, stations: false, entrances: false, routes: false })).toHaveLength(0);
    expect(first.getFeatures({ buildings: true, pois: true, areas: true, stations: false, entrances: false, routes: false })).toHaveLength(2);
  });

  it("refuses a pending production source before any output can be created", async () => {
    const pending = JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: {
      sourceRegistryEntryId: "nyc.community-districts", provider: "NYC DCP", datasetId: "yfnk-k7r4", sourceRecordId: "pending", termsUrl: "https://opendata.cityofnewyork.us/overview/", attribution: "Synthetic", licenseClass: "unknown", officialName: "Pending", areaType: "district", areaLevel: "2020", semantics: "administrative",
    }, geometry: { type: "Polygon", coordinates: [[[-73.99, 40.74], [-73.98, 40.74], [-73.98, 40.75], [-73.99, 40.75], [-73.99, 40.74]]] } }] });
    await expect(AreaSnapshotAdapter.fromSnapshot({ snapshotText: pending, metadata: await metadata(pending), city: manhattanAdapter })).rejects.toThrow(/pending/);
  });

  it("accepts injected approved invented metadata while production registry remains pending", async () => {
    const approved = { ...fixtureEntry, id: "fixture.area.approved", provider: "Invented Area Provider", datasetId: "areas-v1", termsUrl: "https://example.invalid/areas-terms", approval: { ...fixtureEntry.approval, state: "approved" as const, scope: "ingestion" as const } };
    const snapshot = JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: {
      sourceRegistryEntryId: approved.id, provider: approved.provider, datasetId: approved.datasetId, sourceRecordId: "approved-1", termsUrl: approved.termsUrl, attribution: approved.attribution, licenseClass: approved.licenseClass, officialName: "Invented Approved Area", areaType: "planning-area", areaLevel: "slice", semantics: "planning",
    }, geometry: { type: "Polygon", coordinates: [[[-73.99, 40.74], [-73.98, 40.74], [-73.98, 40.75], [-73.99, 40.75], [-73.99, 40.74]]] } }] });
    const adapter = await AreaSnapshotAdapter.fromSnapshot({ snapshotText: snapshot, metadata: await metadata(snapshot), city: manhattanAdapter, registryEntries: [approved] });
    expect(adapter.getIngestionReport().rejected).toEqual([]);
    expect(adapter.getIngestionReport().sourceRegistryEntryIds).toEqual([approved.id]);
  });
});
