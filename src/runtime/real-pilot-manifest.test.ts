import { afterEach, describe, expect, it, vi } from "vitest";
import type { Feature, SourceRef } from "../domain/schema";
import { loadRealPilot, validateRealPilotManifest } from "./real-pilot-manifest";

const BUILDING_REGISTRY = "nyc.building-footprints";
const RESTAURANT_REGISTRY = "nyc.dohmh-restaurant-inspections";
const capturedAt = "2026-08-04T03:12:00.000Z";

function makeSourceRef(registryEntryId: string, role: SourceRef["role"] = "primary"): SourceRef {
  const isBuilding = registryEntryId === BUILDING_REGISTRY;
  return {
    schemaVersion: "1.0",
    id: `source-ref:${registryEntryId}:test-record`,
    registryEntryId,
    provider: isBuilding ? "NYC Office of Technology and Innovation (OTI) GIS" : "NYC Department of Health and Mental Hygiene",
    datasetId: isBuilding ? "jh45-qr5r" : "43nn-pn8j",
    sourceRecordId: "test-record",
    sourceUrl: "https://example.test/source",
    licenseRefId: `license:${registryEntryId}`,
    role,
    capturedAt,
    updatedAt: capturedAt,
    observedAt: null,
    release: null,
  };
}

function makeFeature(kind: Feature["kind"], registryEntryId: string, role: SourceRef["role"] = "primary"): Feature {
  const sourceRef = makeSourceRef(registryEntryId, role);
  return {
    schemaVersion: "1.0",
    id: `real:${kind}:test-record`,
    cityId: "manhattan",
    kind,
    name: kind === "building" ? "Test Building" : "Test Restaurant",
    geometry: { type: "Point", coordinates: [-74, 40.74] },
    coordinates: [-74, 40.74],
    geometryProvenance: {
      schemaVersion: "1.0",
      sourceRefId: sourceRef.id,
      inputCrs: "EPSG:4326",
      outputCrs: "EPSG:4326",
      capturedAt,
      height: {
        schemaVersion: "1.0",
        valueMeters: null,
        sourceValue: null,
        sourceUnit: "unknown",
        verticalDatum: "unknown",
        sourceRefId: null,
        method: "unknown",
        uncertaintyMeters: null,
      },
      horizontalUncertaintyMeters: null,
      notes: "Test geometry provenance.",
    },
    sourceRefs: [sourceRef],
    provenance: kind === "building" ? "authoritative" : "derived",
    confidence: { score: 1, label: "high", rationale: "Test fixture." },
    uncertainty: { horizontalMeters: null, verticalMeters: null, temporalDays: null, notes: "Test uncertainty." },
    freshness: { capturedAt, updatedAt: capturedAt, observedAt: null, ingestedAt: capturedAt },
    attributes: {},
  };
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes))]
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
}

async function manifestFor(building: unknown, restaurant: unknown) {
  const values = { buildings: [building], restaurants: [restaurant] };
  const partitions = await Promise.all((Object.keys(values) as Array<keyof typeof values>).map(async (id) => {
    const bytes = new TextEncoder().encode(`${JSON.stringify(values[id])}\n`);
    return {
      id,
      path: `/data/real-wave-20260804/${id}.json`,
      schemaVersion: "1.0" as const,
      outputCrs: "EPSG:4326" as const,
      featureCount: values[id].length,
      byteSize: bytes.byteLength,
      sha256: await sha256(bytes.buffer),
      bytes,
    };
  }));
  return {
    schemaVersion: "1.0",
    releaseId: "real-wave-20260804",
    generatedAt: capturedAt,
    fixtureOnly: false,
    outputCrs: "EPSG:4326",
    sourceRegistryEntryIds: [BUILDING_REGISTRY, RESTAURANT_REGISTRY],
    partitions: partitions.map((partition) => ({
      id: partition.id,
      path: partition.path,
      schemaVersion: partition.schemaVersion,
      outputCrs: partition.outputCrs,
      featureCount: partition.featureCount,
      byteSize: partition.byteSize,
      sha256: partition.sha256,
    })),
    fallback: { mode: "fixtures", reason: "test" },
    partitionBytes: Object.fromEntries(partitions.map((partition) => [partition.id, partition.bytes])),
  };
}

function stubFetch(manifest: Awaited<ReturnType<typeof manifestFor>>) {
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.endsWith("manifest.json")) return new Response(JSON.stringify(manifest), { status: 200 });
    const id = url.endsWith("buildings.json") ? "buildings" : "restaurants";
    return new Response(manifest.partitionBytes[id], { status: 200 });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("real pilot manifest", () => {
  it("rejects wrong release/schema/source declarations", () => {
    expect(() => validateRealPilotManifest({ schemaVersion: "0", releaseId: "other", fixtureOnly: true })).toThrow(/schema|version/);
  });

  it("loads a valid building and restaurant partition unchanged", async () => {
    const building = makeFeature("building", BUILDING_REGISTRY);
    const restaurant = makeFeature("poi", RESTAURANT_REGISTRY);
    const manifest = await manifestFor(building, restaurant);
    stubFetch(manifest);
    await expect(loadRealPilot()).resolves.toMatchObject({
      manifest: { releaseId: "real-wave-20260804" },
      features: [building, restaurant],
    });
  });

  it.each([
    ["buildings", makeFeature("poi", BUILDING_REGISTRY)],
    ["restaurants", makeFeature("building", RESTAURANT_REGISTRY)],
  ] as const)("rejects wrong feature kind in the %s partition", async (partitionId, invalidFeature) => {
    const building = partitionId === "buildings" ? invalidFeature : makeFeature("building", BUILDING_REGISTRY);
    const restaurant = partitionId === "restaurants" ? invalidFeature : makeFeature("poi", RESTAURANT_REGISTRY);
    const manifest = await manifestFor(building, restaurant);
    stubFetch(manifest);
    await expect(loadRealPilot()).rejects.toThrow(/feature schema/);
  });

  it.each([
    ["buildings", makeFeature("building", RESTAURANT_REGISTRY)],
    ["restaurants", makeFeature("poi", BUILDING_REGISTRY)],
  ] as const)("rejects wrong registry source in the %s partition", async (partitionId, invalidFeature) => {
    const building = partitionId === "buildings" ? invalidFeature : makeFeature("building", BUILDING_REGISTRY);
    const restaurant = partitionId === "restaurants" ? invalidFeature : makeFeature("poi", RESTAURANT_REGISTRY);
    const manifest = await manifestFor(building, restaurant);
    stubFetch(manifest);
    await expect(loadRealPilot()).rejects.toThrow(/source identity|feature schema/);
  });

  it("rejects fixture source roles in a real partition", async () => {
    const building = makeFeature("building", BUILDING_REGISTRY, "fixture");
    const restaurant = makeFeature("poi", RESTAURANT_REGISTRY);
    const manifest = await manifestFor(building, restaurant);
    stubFetch(manifest);
    await expect(loadRealPilot()).rejects.toThrow(/source identity|feature schema/);
  });

  it("rejects a malformed full Feature through the domain validator", async () => {
    const malformed = makeFeature("building", BUILDING_REGISTRY) as unknown as Record<string, unknown>;
    delete malformed.geometry;
    const restaurant = makeFeature("poi", RESTAURANT_REGISTRY);
    const manifest = await manifestFor(malformed, restaurant);
    stubFetch(manifest);
    await expect(loadRealPilot()).rejects.toThrow(/feature schema/);
  });

  it("rejects full inspection history from the browser restaurant partition", async () => {
    const building = makeFeature("building", BUILDING_REGISTRY);
    const restaurant = makeFeature("poi", RESTAURANT_REGISTRY);
    restaurant.attributes.placeInspectionObservations = "[]";
    const manifest = await manifestFor(building, restaurant);
    stubFetch(manifest);
    await expect(loadRealPilot()).rejects.toThrow(/feature schema/);
  });
});
