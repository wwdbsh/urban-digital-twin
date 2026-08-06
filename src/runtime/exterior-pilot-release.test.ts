import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import releaseJson from "../../public/data/manhattan-esb-block-exterior-pilot-20260805/release.json";
import { BLOCK_835_DOITT_IDS } from "../domain/commercial-frontage";
import {
  EXTERIOR_PILOT_RELEASE_ID,
  OSM_ATTRIBUTION,
  loadExteriorPilotRelease,
  validateExteriorPilotRelease,
} from "./exterior-pilot-release";

const release = releaseJson as never;

function localFetcher(failPath: string | null = null) {
  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/release.json")) return new Response(JSON.stringify(release), { status: 200, headers: { "content-type": "application/json" } });
    const relative = url.replace(/^\/assets\//u, "");
    if (failPath && url.endsWith(failPath)) return new Response("missing", { status: 404 });
    try {
      const bytes = readFileSync(`public/assets/${relative}`);
      return new Response(bytes.buffer as ArrayBuffer, { status: 200, headers: { "content-type": "model/gltf-binary" } });
    } catch {
      return new Response("missing", { status: 404 });
    }
  };
}

describe("Stage 3 exterior/commercial overlay runtime", () => {
  it("validates exact block identity, ODbL partition, and 14 x 2 assets", () => {
    const validation = validateExteriorPilotRelease(release);
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    expect(validation.value.releaseId).toBe(EXTERIOR_PILOT_RELEASE_ID);
    expect(validation.value.boundaryRule.doittIds).toEqual([...BLOCK_835_DOITT_IDS]);
    expect(validation.value.assets.assets).toHaveLength(14);
    expect(validation.value.assetEntries).toHaveLength(28);
    expect(validation.value.commercialRelease.totals.acceptedSigns).toBe(8);
    expect(validation.value.commercialRelease.storefrontPlacements.filter((placement) => placement.signPolicy === "neutral-text-only")).toHaveLength(8);
    expect(validation.value.licensePartitions.find((partition) => partition.partitionId === "odbl-derived")?.attribution).toBe(OSM_ATTRIBUTION);
    expect(JSON.stringify({ approval: validation.value.approval, sourceSnapshots: validation.value.sourceSnapshots, licensePartitions: validation.value.licensePartitions, assetLineage: validation.value.assets.assets.map((asset) => asset.lineage) })).not.toMatch(/google/iu);
  });

  it("replays every local GLB and selects LOD0, LOD1, then procedural fallback deterministically", async () => {
    const loaded = await loadExteriorPilotRelease("/data/manhattan-esb-block-exterior-pilot-20260805/", undefined, localFetcher());
    expect(loaded.assetFailures).toHaveLength(0);
    expect(loaded.verifiedContentRefs).toHaveLength(28);
    expect(loaded.compatibleWith("manhattan-citywide-20260804")).toBe(true);
    expect(loaded.compatibleWith("manhattan-civic-context-20260804")).toBe(true);
    expect(loaded.resolve("doitt:778052", 120, 1).kind).toBe("asset");
    expect(loaded.resolve("doitt:778052", 500, 1).kind).toBe("asset");
    expect(loaded.resolve("doitt:778052", 1_500, 1).kind).toBe("procedural-fallback");
    expect(loaded.resolve("doitt:39969", 120, 1).kind).toBe("asset");
    expect(loaded.commercialForBuilding("doitt:39969").visualEvidenceLevel).toBe("source-constrained-massing");
    expect(loaded.commercialForBuilding("doitt:778052").visualEvidenceLevel).toBe("licensed-near-real");
    expect(loaded.commercialForBuilding("doitt:39969").acceptedPlacements).toHaveLength(1);
  });

  it("isolates one missing LOD to that building while retaining other assets and metadata", async () => {
    const loaded = await loadExteriorPilotRelease("/data/manhattan-esb-block-exterior-pilot-20260805/", undefined, localFetcher("doitt-778052__lod_0.glb"));
    expect(loaded.assetFailures).toHaveLength(1);
    expect(loaded.assetFailures[0]?.canonicalFeatureId).toBe("doitt:778052");
    expect(loaded.resolve("doitt:778052", 120, 1).kind).toBe("procedural-fallback");
    expect(loaded.resolve("doitt:39969", 120, 1).kind).toBe("asset");
    expect(loaded.commercialForBuilding("doitt:778052").claim).toMatch(/unseen sides and roof remain unknown/iu);
  });
});
