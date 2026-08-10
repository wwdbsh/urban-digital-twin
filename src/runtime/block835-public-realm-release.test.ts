import { describe, expect, it } from "vitest";
import {
  BLOCK835_PUBLIC_REALM_APPROVAL_ID,
  createBlock835PublicRealmFaultFetcher,
  BLOCK835_PUBLIC_REALM_RELEASE_ID,
  parseBlock835PublicRealmFault,
  validateBlock835PublicRealmRelease,
  publicRealmFeatureToFeature,
  type Block835PublicRealmReleaseDocument,
} from "./block835-public-realm-release";

const hash = "a".repeat(64);

function releaseFixture(): Block835PublicRealmReleaseDocument {
  const assetEntries = ["roadbed", "sidewalk", "curb", "crosswalk"].flatMap((semantic) => ["lod0", "lod1"].map((lod) => ({
    id: `public-realm:${semantic}:${lod}`,
    semantic: semantic as "roadbed" | "sidewalk" | "curb" | "crosswalk",
    lod: lod as "lod0" | "lod1",
    fileName: `${semantic}__${lod === "lod0" ? "lod_0" : "lod_1"}.glb`,
    relativeContentRef: `assets/${BLOCK835_PUBLIC_REALM_RELEASE_ID}/${semantic}__${lod === "lod0" ? "lod_0" : "lod_1"}.glb`,
    byteSize: 128,
    sha256: hash,
    triangles: lod === "lod0" ? 100 : 20,
    materials: 1,
    textures: 0,
    images: 0,
    bounds: { min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number] },
    maxDistanceMeters: lod === "lod0" ? 220 : 900,
  })));
  return {
    schemaVersion: "1.0",
    releaseId: BLOCK835_PUBLIC_REALM_RELEASE_ID,
    cityId: "manhattan",
    generatedAt: "2026-08-06T00:00:00.000Z",
    fixtureOnly: false,
    approval: { evidenceId: BLOCK835_PUBLIC_REALM_APPROVAL_ID, scope: "Approved local Block 835 OTI public realm; estimated curb/crosswalk claim ceilings." },
    baseCompatibility: { baseReleaseIds: ["manhattan-esb-block-exterior-pilot-20260805"], requiredExteriorReleaseId: "manhattan-esb-block-exterior-pilot-20260805" },
    sourceSnapshots: ["vfx9-tbb6", "xgwd-7vhd", "x9uq-u3qs"].map((datasetId) => ({ datasetId, mappedViewId: "mapped", rawSha256: hash, sourceFeatureCount: 1 })),
    clip: { sourceExtent: { west: -73.99, east: -73.98, south: 40.74, north: 40.75 }, clipBounds: { west: -73.991, east: -73.979, south: 40.739, north: 40.751 }, bufferMeters: 35, rule: "Existing 14-member Block 835 union plus deterministic 35m buffer." },
    anchorWgs84: [-73.985, 40.745, 0],
    transform: { inputCrs: "CRS84", outputCrs: "EPSG:4326", sourceNativeCrs: "EPSG:2263", verticalDatum: "NAVD88", method: "identity for published CRS84 response", residualMeters: 0, zPolicy: "preserve source Z; absent in response" },
    claimCeilings: { roadbed: "Source-backed horizontal planimetry only.", sidewalk: "Source-backed horizontal planimetry only.", curb: "Estimated/source-constrained curb profile; not survey-grade.", crosswalk: "Deterministic estimated placement/striping; not current paint or survey truth." },
    features: { sourceBacked: 3, roadbed: 1, sidewalk: 1, curbs: 1, crosswalks: 4, intersections: 4 },
    geometryValidation: { method: "mathutils.geometry.tessellate_polygon", polygonContourResolution: "full source resolution in LOD0 and LOD1", areaResidualToleranceRelative: 0.00005, maxObservedRelativeAreaError: 0.000024, holeRegression: { sourceFeatureId: "sidewalk:12380001933", expectedInteriorRingCount: 1, observedInteriorRingCount: 1, status: "pass" } },
    assetEntries,
    dataFileEntries: ["features.json", "curbs.json", "crosswalks.json"].map((fileName) => ({ fileName: fileName as "features.json" | "curbs.json" | "crosswalks.json", byteSize: 32, sha256: hash })),
    assetBudget: { maxTotalBytes: 1_572_864, maxLod0Triangles: 25_000, maxLod1Triangles: 6_000, maxMaterialsPerAsset: 4, maxTextures: 0, maxCloseRangeRequests: 12 },
    sourcePacketSha256: hash,
    provenance: { sourceEpoch: "2022 imagery; 2023 update context", termsUrl: "https://opendata.cityofnewyork.us/overview/", attribution: "NYC OTI Planimetrics via NYC Open Data", disclaimer: "NYC Open Data may be updated or corrected; no warranty is made.", localOnly: true, runtimeExternalNetwork: false },
    fallback: "Omit only the public-realm overlay when its manifest, data, or asset checks fail; retain buildings/storefronts.",
  };
}

describe("Block 835 public-realm release", () => {
  it("requires the exact approved source trio and claim ceilings", () => {
    const result = validateBlock835PublicRealmRelease(releaseFixture());
    expect(result.ok).toBe(true);
    const invalid = releaseFixture();
    invalid.approval = { ...invalid.approval, evidenceId: "approval:wrong" };
    expect(validateBlock835PublicRealmRelease(invalid).ok).toBe(false);
  });

  it("projects an estimated crosswalk with source and uncertainty detail", () => {
    const feature = publicRealmFeatureToFeature({
      id: "crosswalk:w33-broadway",
      semantic: "crosswalk",
      sourceDatasetId: "derived:nyc-oti-planimetrics",
      sourceFeatureIds: ["12350000592"],
      geometry: { type: "MultiPolygon", coordinates: [[[[-73.987, 40.748], [-73.9869, 40.748], [-73.9869, 40.7481], [-73.987, 40.7481], [-73.987, 40.748]]]] },
      sourceCrs: "CRS84",
      normalizedCrs: "EPSG:4326",
      verticalDatum: "NAVD88",
      claimLevel: "estimated",
      intersectionId: "w33-broadway",
      derivation: { algorithm: "deterministic-four-corner-crosswalk-v1", noCurrentPaintEvidence: true },
      uncertainty: { horizontalMeters: 2, verticalMeters: 0.05, temporal: "Estimated placement; no current-paint or survey truth." },
      transform: { inputCrs: "CRS84", outputCrs: "EPSG:4326", verticalDatum: "NAVD88", method: "identity", residualMeters: 0, zPolicy: "no Z present" },
    }, "2026-08-06T00:00:00.000Z");
    expect(feature.id).toBe("public-realm:crosswalk:w33-broadway");
    expect(feature.provenance).toBe("derived");
    expect(feature.attributes.publicRealmClaimLevel).toBe("estimated");
    expect(feature.sourceRefs[0]?.datasetId).toBe("xgwd-7vhd");
  });

  it("requires the Blender hole/concavity triangulation regression evidence", () => {
    const invalid = releaseFixture();
    invalid.geometryValidation = { ...invalid.geometryValidation, holeRegression: { ...invalid.geometryValidation.holeRegression, observedInteriorRingCount: 0 } };
    expect(validateBlock835PublicRealmRelease(invalid).ok).toBe(false);
    const inflated = releaseFixture();
    inflated.geometryValidation = { ...inflated.geometryValidation, maxObservedRelativeAreaError: 0.01 };
    expect(validateBlock835PublicRealmRelease(inflated).ok).toBe(false);
  });

  it("keeps the development fault journey local and leaves immutable release bytes alone", async () => {
    expect(parseBlock835PublicRealmFault("release", true)).toBe("release");
    expect(parseBlock835PublicRealmFault("unsupported", true)).toBeNull();
    expect(parseBlock835PublicRealmFault("release", false)).toBeNull();
    const fetcher = createBlock835PublicRealmFaultFetcher("release", async () => new Response("immutable local payload", { status: 200 }));
    await expect(fetcher("https://example.com/data/release.json")).rejects.toThrow(/current app-origin release files/u);
    const fault = await fetcher(`/data/${BLOCK835_PUBLIC_REALM_RELEASE_ID}/release.json`);
    expect(fault.status).toBe(503);
    expect(await fault.text()).toBe("forced public-realm release fault");
  });
});
