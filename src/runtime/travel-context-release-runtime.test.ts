import { describe, expect, it } from "vitest";
import { buildSyntheticTravelContextRelease } from "../release/travel-context-release.ts";
import { TravelContextReleaseAdapter } from "./travel-context-release-runtime.ts";

function response(text: string, status = 200): Response {
  return new Response(text, { status, headers: { "content-type": "application/json" } });
}

function fixtureAdapter(manifestOverride?: ReturnType<typeof buildSyntheticTravelContextRelease>["manifest"], options: ConstructorParameters<typeof TravelContextReleaseAdapter>[3] = {}) {
  const contents = buildSyntheticTravelContextRelease();
  const manifest = manifestOverride ?? contents.manifest;
  return new TravelContextReleaseAdapter(manifest, "/data/civic", async (input) => {
    const ref = input.replace("/data/civic/", "");
    const text = contents.bytes.get(ref);
    return text === undefined ? response("{}", 404) : response(text);
  }, { allowFixture: true, ...options });
}

describe("TravelContextReleaseAdapter", () => {
  it("loads generic point/area records, searches summaries, and hydrates cold detail", async () => {
    const adapter = fixtureAdapter();
    const visible = await adapter.refreshViewport({ longitude: -73.991, latitude: 40.744, height: 700, heading: 0, pitch: -35, roll: 0 });
    expect(visible.some((feature) => feature.attributes.civicRecordKind === "statistical-area")).toBe(true);
    expect(visible.some((feature) => feature.attributes.civicRecordKind === "park")).toBe(true);

    const results = await adapter.searchAsync("Synthetic");
    expect(results.some((feature) => feature.id === "udt:manhattan:nta:MN01")).toBe(true);
    const detail = await adapter.loadDetail("udt:manhattan:nta:MN01");
    expect(detail?.attributes.civicDetailLoaded).toBe(true);
    expect(detail?.attributes.areaSemantics).toBe("statistical");
    expect(adapter.getMetrics().detailIndexEntryCount).toBe(5);
  });

  it("uses the shared ground footprint for viewport selection and joins duplicate settled refreshes", async () => {
    const adapter = fixtureAdapter();
    const shard = adapter.manifest.geometryShards[0]!;
    const request = {
      camera: { longitude: -73.7, latitude: 40.95, height: 8_000, heading: 20, pitch: -50, roll: 0 },
      footprint: {
        bounds: shard.bounds,
        groundCenter: { longitude: (shard.bounds.west + shard.bounds.east) / 2, latitude: (shard.bounds.south + shard.bounds.north) / 2 },
        valid: true,
        source: "ground-rays" as const,
        signature: "travel-ground-footprint",
      },
    };
    const first = adapter.refreshViewport(request);
    const duplicate = adapter.refreshViewport(request);
    expect(duplicate).toBe(first);
    await expect(first).resolves.not.toEqual([]);
    await expect(adapter.refreshViewport(request)).resolves.not.toEqual([]);
    expect(adapter.getMetrics().dedupedRefreshCount).toBe(2);
  });

  it("fails only the injected parks layer while retaining other loaded layers", async () => {
    const adapter = fixtureAdapter(undefined, { fault: "parks-geometry" });
    await expect(adapter.refreshViewport({ longitude: -73.991, latitude: 40.744, height: 700, heading: 0, pitch: -35, roll: 0 })).resolves.toBeDefined();
    const metrics = adapter.getMetrics();
    expect(metrics.failedLayers).toContain("parks");
    expect(metrics.failedLayers).not.toContain("statistical-areas");
  });

  it("fails closed on a checksum-invalid geometry shard without substituting fixture records", async () => {
    const contents = buildSyntheticTravelContextRelease();
    const first = contents.manifest.geometryShards[0];
    if (!first) throw new Error("Synthetic geometry fixture is empty.");
    const manifest = structuredClone(contents.manifest);
    manifest.geometryShards[0]!.checksumSha256 = "0".repeat(64);
    const adapter = fixtureAdapter(manifest);
    await expect(adapter.refreshViewport({ longitude: -73.991, latitude: 40.744, height: 700, heading: 0, pitch: -35, roll: 0 })).resolves.toBeDefined();
    expect(adapter.getMetrics().failedRequestCount).toBeGreaterThanOrEqual(1);
    expect(adapter.getFeature("fixture:does-not-exist")).toBeUndefined();
  });
});
