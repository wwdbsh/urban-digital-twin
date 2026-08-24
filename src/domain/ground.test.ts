import { describe, expect, it } from "vitest";

import {
  DEFAULT_GROUND_IDENTITY_POLICY,
  GROUND_BASE_CLASSES,
  GROUND_EMBELLISHMENT_CLASSES,
  GROUND_SURFACE_CLASSES,
  compareGroundIds,
  groundIdentitySetChecksum,
  groundPartId,
  isGroundClass,
  isGroundEmbellishmentClass,
  isGroundSurfaceClass,
  parseGroundPartId,
  sortGroundIds,
  validateGroundAssetTiers,
  validateGroundFeature,
  validateGroundFeaturePart,
  validateGroundFeatureSet,
  type GroundFeature,
  type GroundFeaturePart,
  type GroundIdentityPolicy,
  type GroundSurfaceFeature,
  type GroundTier,
} from "./ground.ts";
import { sha256HexSync } from "./deterministic-hash.ts";
import { DOMAIN_SCHEMA_VERSION, type SourceRef } from "./schema.ts";

const HASH_A = sha256HexSync("ground-fixture-a");
const HASH_B = sha256HexSync("ground-fixture-b");

function sourceRef(id: string): SourceRef {
  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    id,
    registryEntryId: "registry:nyc-planimetrics",
    provider: "NYC Open Data",
    datasetId: "vfx9-tbb6",
    sourceRecordId: `${id}:record`,
    sourceUrl: "https://data.cityofnewyork.us/d/vfx9-tbb6",
    licenseRefId: "license:nyc-open-data",
    role: "primary",
    capturedAt: "2022-01-01",
    updatedAt: "2023-06-01",
    observedAt: "2026-08-04",
    release: "2023-06",
  };
}

const UNCERTAINTY = { horizontalMeters: 1.5, verticalMeters: null, temporal: "2022 planimetric capture; not resurveyed." };

function roadbed(local = "w-42nd-street", cityId = "city:manhattan"): GroundSurfaceFeature {
  return {
    canonicalFeatureId: `udt:ground:manhattan:roadbed:${local}`,
    cityId,
    class: "roadbed",
    claimLevel: "source-backed",
    sourceRefs: [sourceRef("source:roadbed")],
    uncertainty: UNCERTAINTY,
    identityOrigin: { kind: "ground-owned" },
  };
}

function referencedPark(gispropnum = "M010"): GroundSurfaceFeature {
  return {
    canonicalFeatureId: `udt:manhattan:park:${gispropnum}`,
    cityId: "city:manhattan",
    class: "park",
    claimLevel: "source-backed",
    sourceRefs: [sourceRef("source:park")],
    uncertainty: UNCERTAINTY,
    identityOrigin: { kind: "referenced-existing", existingFeatureId: `udt:manhattan:park:${gispropnum}` },
  };
}

function curb(): GroundFeature {
  return {
    canonicalFeatureId: "udt:ground:manhattan:curb:w-42nd-street-north",
    cityId: "city:manhattan",
    class: "curb",
    claimLevel: "estimated",
    sourceRefs: [sourceRef("source:sidewalk")],
    uncertainty: UNCERTAINTY,
    identityOrigin: { kind: "ground-owned" },
  };
}

function flatTier(overrides: Partial<GroundTier> = {}): GroundTier {
  return { tierId: "flat", kind: "flat", maxDistanceMeters: null, artifactRef: "ground/flat.json", checksumSha256: HASH_A, ...overrides };
}

function nearTier(overrides: Partial<GroundTier> = {}): GroundTier {
  return { tierId: "near", kind: "near-3d", maxDistanceMeters: 300, artifactRef: "ground/near.glb", checksumSha256: HASH_B, ...overrides };
}

/** Removes one key so a validator can be shown a value that is missing it. */
function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const { [key]: _removed, ...rest } = value;
  void _removed;
  return rest;
}

function paths(result: { ok: boolean; issues?: { path: string; message: string }[] }): string[] {
  return (result.issues ?? []).map((entry) => entry.path);
}

describe("ground class taxonomy", () => {
  it("keeps base classes and embellishments disjoint and complete", () => {
    expect(GROUND_BASE_CLASSES).toEqual(["roadbed", "sidewalk", "park", "plaza", "water"]);
    expect(GROUND_EMBELLISHMENT_CLASSES).toEqual(["curb", "crosswalk"]);
    expect(new Set(GROUND_SURFACE_CLASSES).size).toBe(GROUND_BASE_CLASSES.length + GROUND_EMBELLISHMENT_CLASSES.length);
    for (const value of GROUND_BASE_CLASSES) expect(isGroundEmbellishmentClass(value)).toBe(false);
    for (const value of GROUND_EMBELLISHMENT_CLASSES) expect(isGroundClass(value)).toBe(false);
    for (const value of GROUND_SURFACE_CLASSES) expect(isGroundSurfaceClass(value)).toBe(true);
  });

  it("rejects an unknown class outright rather than treating it as a base surface", () => {
    for (const value of ["building", "roadway", "ROADBED", "", null, 3]) expect(isGroundSurfaceClass(value)).toBe(false);
    const result = validateGroundFeature({ ...roadbed(), class: "roadway" });
    expect(result.ok).toBe(false);
    expect(paths(result)).toContain("$.class");
  });
});

describe("ground feature validation", () => {
  it("accepts a well-formed source-backed base feature", () => {
    expect(validateGroundFeature(roadbed()).ok).toBe(true);
  });

  it("accepts a non-Manhattan city because the contract is configuration-driven", () => {
    const chicago: GroundFeature = {
      canonicalFeatureId: "udt:ground:chicago:plaza:daley",
      cityId: "city:chicago",
      class: "plaza",
      claimLevel: "estimated",
      sourceRefs: [sourceRef("source:chicago-plaza")],
      uncertainty: UNCERTAINTY,
      identityOrigin: { kind: "ground-owned" },
    };
    expect(validateGroundFeature(chicago).ok).toBe(true);
  });

  it("fails closed on a missing required key and on an unexpected one", () => {
    const missing = validateGroundFeature(omit(roadbed(), "cityId"));
    expect(missing.ok).toBe(false);
    expect(paths(missing)).toContain("$.cityId");

    const extra = validateGroundFeature({ ...roadbed(), renderOrder: 3 });
    expect(extra.ok).toBe(false);
    expect(paths(extra)).toContain("$.renderOrder");
  });

  it("requires a citation for a source-backed claim", () => {
    const result = validateGroundFeature({ ...roadbed(), sourceRefs: [] });
    expect(result.ok).toBe(false);
    expect(paths(result)).toContain("$.sourceRefs");
  });

  it("requires an explicit uncertainty statement", () => {
    const result = validateGroundFeature({ ...roadbed(), uncertainty: { horizontalMeters: 1, verticalMeters: null, temporal: "  " } });
    expect(result.ok).toBe(false);
    expect(paths(result)).toContain("$.uncertainty.temporal");
  });
});

describe("embellishments are always estimated", () => {
  it("accepts an estimated curb", () => {
    expect(validateGroundFeature(curb()).ok).toBe(true);
  });

  it("refuses a curb or crosswalk declared source-backed", () => {
    for (const embellishment of GROUND_EMBELLISHMENT_CLASSES) {
      const result = validateGroundFeature({ ...curb(), class: embellishment, canonicalFeatureId: `udt:ground:manhattan:${embellishment}:x`, claimLevel: "source-backed" });
      expect(result.ok, embellishment).toBe(false);
      expect(paths(result), embellishment).toContain("$.claimLevel");
    }
  });
});

describe("two-level identity", () => {
  it("requires a referenced catalog identity for parks by default", () => {
    expect(validateGroundFeature(referencedPark()).ok).toBe(true);

    const minted = validateGroundFeature({ ...referencedPark(), canonicalFeatureId: "udt:ground:manhattan:park:central", identityOrigin: { kind: "ground-owned" } });
    expect(minted.ok).toBe(false);
    expect(paths(minted)).toContain("$.identityOrigin.kind");
  });

  it("lets a configuration relax the referenced-identity requirement", () => {
    const relaxed: GroundIdentityPolicy = { referencedExistingClasses: [] };
    expect(DEFAULT_GROUND_IDENTITY_POLICY.referencedExistingClasses).toEqual(["park"]);
    const minted = { ...referencedPark(), canonicalFeatureId: "udt:ground:manhattan:park:central", identityOrigin: { kind: "ground-owned" as const } };
    expect(validateGroundFeature(minted, relaxed).ok).toBe(true);
  });

  it("refuses a reference that points at a different id than the canonical one", () => {
    const result = validateGroundFeature({ ...referencedPark(), identityOrigin: { kind: "referenced-existing", existingFeatureId: "udt:manhattan:park:M099" } });
    expect(result.ok).toBe(false);
    expect(paths(result)).toContain("$.identityOrigin.existingFeatureId");
  });

  it("refuses a reference whose class segment disagrees with the feature class", () => {
    const result = validateGroundFeature({
      ...referencedPark(),
      canonicalFeatureId: "udt:manhattan:nta:MN17",
      identityOrigin: { kind: "referenced-existing", existingFeatureId: "udt:manhattan:nta:MN17" },
    });
    expect(result.ok).toBe(false);
    expect(paths(result)).toContain("$.identityOrigin.existingFeatureId");
  });

  it("keeps minted identities inside the udt:ground namespace so they cannot shadow a catalog id", () => {
    const collision = validateGroundFeature({ ...roadbed(), canonicalFeatureId: "udt:manhattan:roadbed:w-42nd-street" });
    expect(collision.ok).toBe(false);
    expect(paths(collision)).toContain("$.identityOrigin.kind");

    const wrongClass = validateGroundFeature({ ...roadbed(), canonicalFeatureId: "udt:ground:manhattan:sidewalk:w-42nd-street" });
    expect(wrongClass.ok).toBe(false);
    expect(paths(wrongClass)).toContain("$.identityOrigin.kind");
  });

  it("refuses an unknown identity origin", () => {
    const result = validateGroundFeature({ ...roadbed(), identityOrigin: { kind: "inferred" } });
    expect(result.ok).toBe(false);
    expect(paths(result)).toContain("$.identityOrigin.kind");
  });
});

describe("part identity", () => {
  it("derives and re-parses a part id", () => {
    const partId = groundPartId("udt:manhattan:park:M010", "ground-cell-000007-14-4825-4479");
    expect(partId).toBe("udt:manhattan:park:M010#ground-cell-000007-14-4825-4479");
    expect(parseGroundPartId(partId)).toEqual({ canonicalFeatureId: "udt:manhattan:park:M010", ownerCellId: "ground-cell-000007-14-4825-4479" });
  });

  it("refuses identity segments that would make the derived id ambiguous", () => {
    expect(() => groundPartId("udt:manhattan:park:M#010", "cell")).toThrow(/must not contain/u);
    expect(() => groundPartId("", "cell")).toThrow(/requires a canonical feature id/u);
    expect(parseGroundPartId("no-separator")).toBeNull();
    expect(parseGroundPartId("a#b#c")).toBeNull();
    expect(parseGroundPartId(42)).toBeNull();
  });

  it("refuses a part whose declared id was not derived from its own parent and cell", () => {
    const result = validateGroundFeaturePart({ partId: "udt:manhattan:park:M010#cell-a", canonicalFeatureId: "udt:manhattan:park:M010", ownerCellId: "cell-b" });
    expect(result.ok).toBe(false);
    expect(paths(result)).toContain("$.partId");
  });
});

describe("ground tier sets", () => {
  it("accepts one near tier over exactly one always-covering flat tier", () => {
    expect(validateGroundAssetTiers({ assetId: "asset:roadbed:cell-0", class: "roadbed", tiers: [nearTier(), flatTier()] }).ok).toBe(true);
  });

  it("refuses an asset with zero unbounded flat tiers", () => {
    const result = validateGroundAssetTiers({ assetId: "asset:roadbed:cell-0", class: "roadbed", tiers: [nearTier(), flatTier({ maxDistanceMeters: 5_000 })] });
    expect(result.ok).toBe(false);
    expect(paths(result)).toContain("$.tiers");
  });

  it("refuses an asset with two unbounded flat tiers", () => {
    const result = validateGroundAssetTiers({
      assetId: "asset:roadbed:cell-0",
      class: "roadbed",
      tiers: [flatTier(), flatTier({ tierId: "flat-alt", artifactRef: "ground/flat-alt.json" })],
    });
    expect(result.ok).toBe(false);
    expect(paths(result)).toContain("$.tiers");
  });

  it("refuses a near-3d tier that claims to cover every distance", () => {
    const result = validateGroundAssetTiers({ assetId: "asset:curb:cell-0", class: "curb", tiers: [nearTier({ maxDistanceMeters: null })] });
    expect(result.ok).toBe(false);
    expect(paths(result)).toContain("$.tiers[0].kind");
  });

  it("refuses duplicate tier ids, non-positive distances, and malformed checksums", () => {
    const duplicate = validateGroundAssetTiers({ assetId: "a", class: "plaza", tiers: [flatTier(), nearTier({ tierId: "flat" })] });
    expect(paths(duplicate)).toContain("$.tiers[1].tierId");

    const nonPositive = validateGroundAssetTiers({ assetId: "a", class: "plaza", tiers: [flatTier(), nearTier({ maxDistanceMeters: 0 })] });
    expect(paths(nonPositive)).toContain("$.tiers[1].maxDistanceMeters");

    const badChecksum = validateGroundAssetTiers({ assetId: "a", class: "plaza", tiers: [flatTier({ checksumSha256: "NOT-A-HASH" })] });
    expect(paths(badChecksum)).toContain("$.tiers[0].checksumSha256");
  });
});

describe("ground feature set", () => {
  const park = referencedPark();
  const road = roadbed();
  const cells = ["ground-cell-000000-14-4824-4481", "ground-cell-000001-14-4825-4481"];
  const parts: GroundFeaturePart[] = [
    { partId: groundPartId(park.canonicalFeatureId, cells[0]!), canonicalFeatureId: park.canonicalFeatureId, ownerCellId: cells[0]! },
    { partId: groundPartId(park.canonicalFeatureId, cells[1]!), canonicalFeatureId: park.canonicalFeatureId, ownerCellId: cells[1]! },
    { partId: groundPartId(road.canonicalFeatureId, cells[0]!), canonicalFeatureId: road.canonicalFeatureId, ownerCellId: cells[0]! },
  ];

  it("accepts a multi-cell feature with one identity and many parts", () => {
    const result = validateGroundFeatureSet({ features: [park, road], parts });
    expect(result.ok).toBe(true);
  });

  it("refuses a duplicate canonical identity", () => {
    const result = validateGroundFeatureSet({ features: [park, { ...park }, road], parts });
    expect(result.ok).toBe(false);
    expect(paths(result)).toContain("features[1].canonicalFeatureId");
  });

  it("refuses a part whose parent feature is absent", () => {
    const result = validateGroundFeatureSet({ features: [road], parts });
    expect(result.ok).toBe(false);
    expect(paths(result)).toContain("parts[0].canonicalFeatureId");
  });

  it("refuses the same cell owning a feature share twice", () => {
    const result = validateGroundFeatureSet({ features: [park, road], parts: [...parts, parts[0]!] });
    expect(result.ok).toBe(false);
    expect(paths(result)).toContain("parts[3].partId");
  });

  it("refuses a feature that owns no part at all", () => {
    const orphan = roadbed("w-14th-street");
    const result = validateGroundFeatureSet({ features: [park, road, orphan], parts });
    expect(result.ok).toBe(false);
    expect(paths(result)).toContain(`features.${orphan.canonicalFeatureId}`);
  });

  it("propagates the identity policy into the set validator", () => {
    const minted = { ...park, canonicalFeatureId: "udt:ground:manhattan:park:central", identityOrigin: { kind: "ground-owned" as const } };
    const mintedParts = cells.map((cellId) => ({ partId: groundPartId(minted.canonicalFeatureId, cellId), canonicalFeatureId: minted.canonicalFeatureId, ownerCellId: cellId }));
    expect(validateGroundFeatureSet({ features: [minted], parts: mintedParts }).ok).toBe(false);
    expect(validateGroundFeatureSet({ features: [minted], parts: mintedParts }, { referencedExistingClasses: [] }).ok).toBe(true);
  });
});

describe("identity determinism", () => {
  const park = referencedPark();
  const road = roadbed();
  const cells = ["ground-cell-000000-14-4824-4481", "ground-cell-000001-14-4825-4481"];
  const parts: GroundFeaturePart[] = [
    { partId: groundPartId(park.canonicalFeatureId, cells[0]!), canonicalFeatureId: park.canonicalFeatureId, ownerCellId: cells[0]! },
    { partId: groundPartId(road.canonicalFeatureId, cells[1]!), canonicalFeatureId: road.canonicalFeatureId, ownerCellId: cells[1]! },
  ];

  it("hashes equal across repeat computation and across input ordering", () => {
    const first = groundIdentitySetChecksum([park, road], parts);
    expect(groundIdentitySetChecksum([park, road], parts)).toBe(first);
    expect(groundIdentitySetChecksum([road, park], [...parts].reverse())).toBe(first);
  });

  it("hashes equal across object key ordering", () => {
    const reordered: GroundSurfaceFeature = {
      identityOrigin: park.identityOrigin,
      uncertainty: park.uncertainty,
      sourceRefs: park.sourceRefs,
      claimLevel: park.claimLevel,
      class: park.class,
      cityId: park.cityId,
      canonicalFeatureId: park.canonicalFeatureId,
    };
    expect(groundIdentitySetChecksum([reordered, road], parts)).toBe(groundIdentitySetChecksum([park, road], parts));
  });

  it("changes when identity changes and not when unrelated evidence does", () => {
    const base = groundIdentitySetChecksum([park, road], parts);
    expect(groundIdentitySetChecksum([{ ...park, claimLevel: "estimated" }, road], parts)).not.toBe(base);
    expect(groundIdentitySetChecksum([{ ...park, sourceRefs: [sourceRef("source:park-rebuilt")] }, road], parts)).toBe(base);
  });

  it("orders ids by code unit rather than by locale", () => {
    expect(sortGroundIds(["b", "A", "a", "B"])).toEqual(["A", "B", "a", "b"]);
    expect(compareGroundIds("a", "a")).toBe(0);
    expect(compareGroundIds("a", "b")).toBe(-1);
    expect(compareGroundIds("b", "a")).toBe(1);
  });
});
