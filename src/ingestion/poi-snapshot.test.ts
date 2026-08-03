import { describe, expect, it } from "vitest";
import fixtureText from "./fixtures/poi.schema.fixture.json?raw";
import { sourceRegistry } from "../data/source-registry";
import { manhattanAdapter } from "../data/city-adapters";
import { sha256Hex } from "./offline";
import { PoiSnapshotAdapter, type PoiSnapshotMetadata } from "./poi-snapshot";
import { placeCategoriesFromFeature, validatePlaceRecord } from "../domain/places";

const fixtureEntry = sourceRegistry.find((entry) => entry.id === "fixture.local.manhattan-slice") ?? (() => { throw new Error("Fixture source registry entry is required."); })();

async function metadata(text: string = fixtureText): Promise<PoiSnapshotMetadata> {
  return {
    inputFileName: "poi.schema.fixture.json",
    inputChecksumSha256: await sha256Hex(text),
    ingestedAt: "2026-08-03T00:00:01Z",
    immutable: true,
    fixtureOnly: true,
  };
}

describe("provider-neutral POI contract", () => {
  it("keeps absent address, contact, hours, cuisine, and accessibility unknown", async () => {
    const adapter = await PoiSnapshotAdapter.fromSnapshot({ snapshotText: fixtureText, metadata: await metadata(), city: manhattanAdapter });
    const retail = adapter.getPlaces(["department-store"])[0];
    expect(retail?.address.formatted).toBeNull();
    expect(retail?.contact.website).toBeNull();
    expect(retail?.openingHours.weekdayText).toBeNull();
    expect(retail?.cuisine).toBeNull();
    expect(retail?.accessibility.wheelchair).toBe("unknown");
    expect(validatePlaceRecord(retail).ok).toBe(true);
  });

  it("reconciles explicit multi-source conflicts without laundering source IDs or licenses", async () => {
    const alpha = {
      ...fixtureEntry,
      id: "fixture.poi.alpha",
      provider: "Invented POI Provider Alpha",
      datasetId: "alpha-v1",
      termsUrl: "https://example.invalid/alpha-terms",
      licenseClass: "cdla-permissive-2.0" as const,
      attribution: "Invented Alpha attribution.",
      approval: { ...fixtureEntry.approval, state: "approved" as const, scope: "ingestion" as const },
    };
    const beta = {
      ...fixtureEntry,
      id: "fixture.poi.beta",
      provider: "Invented POI Provider Beta",
      datasetId: "beta-v1",
      termsUrl: "https://example.invalid/beta-terms",
      licenseClass: "apache-2.0" as const,
      attribution: "Invented Beta attribution.",
      approval: { ...fixtureEntry.approval, state: "approved" as const, scope: "ingestion" as const },
    };
    const snapshot = JSON.stringify({ records: [
      { sourceRegistryEntryId: alpha.id, provider: alpha.provider, datasetId: alpha.datasetId, sourceRecordId: "alpha-1", matchKey: "shared-place", termsUrl: alpha.termsUrl, attribution: alpha.attribution, licenseClass: alpha.licenseClass, name: "Alpha Name", categories: ["restaurant"], coordinates: [-73.991, 40.743], cuisine: "Thai" },
      { sourceRegistryEntryId: beta.id, provider: beta.provider, datasetId: beta.datasetId, sourceRecordId: "beta-1", matchKey: "shared-place", termsUrl: beta.termsUrl, attribution: beta.attribution, licenseClass: beta.licenseClass, name: "Beta Name", categories: ["cafe"], coordinates: [-73.991, 40.743], cuisine: "Bakery" },
    ] });
    const adapter = await PoiSnapshotAdapter.fromSnapshot({ snapshotText: snapshot, metadata: await metadata(snapshot), city: manhattanAdapter, registryEntries: [alpha, beta] });
    const place = adapter.getPlaces()[0];
    expect(place?.sourceRecordIds).toEqual(["alpha-1", "beta-1"]);
    expect(place?.sourceLicenses.map((license) => license.licenseClass)).toEqual(["cdla-permissive-2.0", "apache-2.0"]);
    expect(place?.conflicts.some((conflict) => conflict.field === "name")).toBe(true);
    expect(place?.categories).toEqual(["cafe", "restaurant"]);
  });

  it("provides stable IDs, category filters, source searches, tiled loading, and cache hits", async () => {
    const first = await PoiSnapshotAdapter.fromSnapshot({ snapshotText: fixtureText, metadata: await metadata(), city: manhattanAdapter });
    const second = await PoiSnapshotAdapter.fromSnapshot({ snapshotText: fixtureText, metadata: await metadata(), city: manhattanAdapter });
    const firstPlace = first.getPlaces()[0];
    const secondPlace = second.getPlaces()[0];
    expect(firstPlace?.canonicalId).toBe(secondPlace?.canonicalId);
    expect(first.getPlaces(["cafe", "restaurant"])).toHaveLength(1);
    expect(first.getPlaces(["retail", "department-store"])).toHaveLength(1);
    expect(first.search("fixture-poi-beta")[0]?.sourceRefs[0]?.sourceRecordId).toBe("fixture-poi-alpha");
    expect(placeCategoriesFromFeature(first.getFeature(firstPlace?.canonicalId ?? "missing")!)).toContain("cafe");
    await first.loadLayerFeatures("pois");
    await first.loadLayerFeatures("pois");
    expect(first.cacheSize()).toBe(first.getLayerManifest("pois").tileKeys.length);
    expect(first.getIngestionReport().allInputRecordsAccountedFor).toBe(true);
    expect(first.getIngestionReport().rejectedRecordIndices).toEqual([3, 4]);
  });

  it("refuses pending sources before a production snapshot can load", async () => {
    const pending = JSON.stringify({ records: [{
      sourceRegistryEntryId: "overture.places",
      provider: "Overture Maps Foundation",
      datasetId: "places",
      sourceRecordId: "pending-real-record",
      termsUrl: "https://docs.overturemaps.org/attribution/",
      attribution: "Not a real record.",
      licenseClass: "cdla-permissive-2.0",
      coordinates: [-73.99, 40.743],
      categories: ["other"],
    }] });
    await expect(PoiSnapshotAdapter.fromSnapshot({ snapshotText: pending, metadata: await metadata(pending), city: manhattanAdapter })).rejects.toThrow(/pending/);
  });

  it("rejects malformed categories and preserves complete rejection accounting", async () => {
    const malformed = JSON.stringify({ records: [{
      sourceRegistryEntryId: fixtureEntry.id,
      provider: fixtureEntry.provider,
      datasetId: fixtureEntry.datasetId,
      sourceRecordId: "invalid-category",
      termsUrl: fixtureEntry.termsUrl,
      attribution: fixtureEntry.attribution,
      licenseClass: fixtureEntry.licenseClass,
      coordinates: [-73.99, 40.743],
      categories: ["not-a-category"],
    }] });
    const adapter = await PoiSnapshotAdapter.fromSnapshot({ snapshotText: malformed, metadata: await metadata(malformed), city: manhattanAdapter });
    expect(adapter.getIngestionReport().acceptedCount).toBe(0);
    expect(adapter.getIngestionReport().rejectedCount).toBe(1);
    expect(adapter.getIngestionReport().allInputRecordsAccountedFor).toBe(true);
  });
});
