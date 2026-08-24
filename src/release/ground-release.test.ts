import { describe, expect, it } from "vitest";

import {
  GROUND_CELL_ID_PATTERN,
  GROUND_PARTITION_SCHEMES,
  GROUND_PARTITION_SCHEME_ID,
  GROUND_RELEASE_SCHEMA_VERSION,
  MANHATTAN_GROUND_CITY_ID,
  MANHATTAN_GROUND_CONFIG_ID,
  MANHATTAN_GROUND_EXTENT,
  buildGroundOwnershipLedger,
  groundAssetContentSha256,
  groundCellOrder,
  groundCellTileKey,
  groundMembershipChecksum,
  groundPartitionTiles,
  validateGroundOwnershipLedgerStructure,
  validateGroundPartitionCoverage,
  validateGroundReleaseGraph,
  validateGroundReleaseStructure,
  type GroundAssetEntry,
  type GroundExtentDeclaration,
  type GroundOwnershipLedger,
  type GroundOwnershipLedgerInput,
  type GroundReleaseDocument,
} from "./ground-release.ts";
import { CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_EVIDENCE } from "../data/source-registry.ts";
import { sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";
import { groundPartId, type GroundFeature, type GroundSurfaceFeature, type GroundTier } from "../domain/ground.ts";
import { tileBounds, tileKeyString } from "../runtime/spatial.ts";
import { DOMAIN_SCHEMA_VERSION, type SourceRef } from "../domain/schema.ts";

/**
 * A small declared extent (3 x 5 level-14 tiles) so a whole partition can be
 * asserted cell by cell. The Manhattan constants are exercised separately.
 */
const TEST_EXTENT: GroundExtentDeclaration = {
  extentId: "ground-test-extent-v1",
  requested: { west: -73.99, south: 40.76, east: -73.94, north: 40.81 },
  note: "Fixture extent. Not a claim about any real coverage.",
};

const HASH = (seed: string): string => sha256HexSync(seed);
const UNCERTAINTY = { horizontalMeters: 1.5, verticalMeters: null, temporal: "2022 planimetric capture; not resurveyed." };

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

/** A Central-Park-shaped envelope: it spans eight cells of `TEST_EXTENT`. */
const CENTRAL_PARK_BOUNDS = { west: -73.9812, south: 40.7644, east: -73.949, north: 40.8006 };

const PARK: GroundSurfaceFeature = {
  canonicalFeatureId: "udt:manhattan:park:M010",
  cityId: MANHATTAN_GROUND_CITY_ID,
  class: "park",
  claimLevel: "source-backed",
  sourceRefs: [sourceRef("source:park")],
  uncertainty: UNCERTAINTY,
  identityOrigin: { kind: "referenced-existing", existingFeatureId: "udt:manhattan:park:M010" },
};

const ROADBED: GroundSurfaceFeature = {
  canonicalFeatureId: "udt:ground:manhattan:roadbed:w-79th-street",
  cityId: MANHATTAN_GROUND_CITY_ID,
  class: "roadbed",
  claimLevel: "source-backed",
  sourceRefs: [sourceRef("source:roadbed")],
  uncertainty: UNCERTAINTY,
  identityOrigin: { kind: "ground-owned" },
};

const CURB: GroundFeature = {
  canonicalFeatureId: "udt:ground:manhattan:curb:w-79th-street-north",
  cityId: MANHATTAN_GROUND_CITY_ID,
  class: "curb",
  claimLevel: "estimated",
  sourceRefs: [sourceRef("source:sidewalk")],
  uncertainty: UNCERTAINTY,
  identityOrigin: { kind: "ground-owned" },
};

const WATER: GroundSurfaceFeature = {
  canonicalFeatureId: "udt:ground:manhattan:water:hudson-reach",
  cityId: MANHATTAN_GROUND_CITY_ID,
  class: "water",
  claimLevel: "source-backed",
  sourceRefs: [sourceRef("source:hydrography")],
  uncertainty: UNCERTAINTY,
  identityOrigin: { kind: "ground-owned" },
};

const SINGLE_CELL_BOUNDS = { west: -73.982, south: 40.7625, east: -73.9815, north: 40.7628 };

function ledgerInput(overrides: Partial<GroundOwnershipLedgerInput> = {}): GroundOwnershipLedgerInput {
  return {
    cityId: MANHATTAN_GROUND_CITY_ID,
    configId: MANHATTAN_GROUND_CONFIG_ID,
    partitionSchemeId: GROUND_PARTITION_SCHEME_ID,
    extent: TEST_EXTENT,
    baseIdentitySetId: "ground-identity-set:fixture-v1",
    features: [PARK, ROADBED, CURB, WATER],
    occupancy: [
      { canonicalFeatureId: PARK.canonicalFeatureId, occupancy: { kind: "bounds", bounds: CENTRAL_PARK_BOUNDS } },
      { canonicalFeatureId: ROADBED.canonicalFeatureId, occupancy: { kind: "bounds", bounds: SINGLE_CELL_BOUNDS } },
      { canonicalFeatureId: CURB.canonicalFeatureId, occupancy: { kind: "bounds", bounds: SINGLE_CELL_BOUNDS } },
      { canonicalFeatureId: WATER.canonicalFeatureId, occupancy: { kind: "declared-cells", tileKeys: ["wgs84-geodetic/14/4824/4477", "wgs84-geodetic/14/4824/4478"] } },
    ],
    ...overrides,
  };
}

function flatTier(overrides: Partial<GroundTier> = {}): GroundTier {
  return { tierId: "flat", kind: "flat", maxDistanceMeters: null, artifactRef: "ground/flat.json", checksumSha256: HASH("flat"), ...overrides };
}

function nearTier(overrides: Partial<GroundTier> = {}): GroundTier {
  return { tierId: "near", kind: "near-3d", maxDistanceMeters: 300, artifactRef: "ground/near.glb", checksumSha256: HASH("near"), ...overrides };
}

function assetEntry(assetId: string, cellId: string, className: GroundAssetEntry["class"], tiers: GroundTier[]): GroundAssetEntry {
  return { assetId, cellId, class: className, tiers, contentSha256: groundAssetContentSha256(tiers) };
}

function releaseDocument(ledger: GroundOwnershipLedger, overrides: Partial<GroundReleaseDocument> = {}): GroundReleaseDocument {
  const cellId = ledger.cells[0]!.cellId;
  return {
    schemaVersion: GROUND_RELEASE_SCHEMA_VERSION,
    releaseId: "manhattan-ground-fixture-20260824",
    cityId: ledger.cityId,
    configId: ledger.configId,
    partitionSchemeId: ledger.partitionSchemeId,
    ownershipLedgerId: ledger.ledgerId,
    generatedAt: "2026-08-24T00:00:00.000Z",
    immutable: true,
    sourceSnapshots: [{ datasetId: "vfx9-tbb6", mappedViewId: null, rawSha256: HASH("snapshot"), sourceFeatureCount: 4 }],
    clip: { sourceExtent: ledger.coverage, clipBounds: ledger.coverage, bufferMeters: 25, rule: "Retain any source feature intersecting the declared extent; clip geometry at the cell boundary." },
    geometryValidation: { method: "shapely.ops.unary_union area residual", areaResidualToleranceRelative: 0.00005, maxObservedRelativeAreaError: 0.000012, status: "pass" },
    assets: [
      assetEntry("asset:roadbed:0", cellId, "roadbed", [flatTier()]),
      assetEntry("asset:park:0", ledger.cells[1]!.cellId, "park", [flatTier({ artifactRef: "ground/park-flat.json" })]),
      assetEntry("asset:water:0", ledger.cells[12]!.cellId, "water", [flatTier({ artifactRef: "ground/water-flat.json" })]),
      assetEntry("asset:curb:0", cellId, "curb", [nearTier(), flatTier({ artifactRef: "ground/curb-flat.json" })]),
    ],
    claimCeilings: {
      roadbed: "Source-backed horizontal planimetry only.",
      park: "Source-backed NYC Parks property boundary; not a legal survey.",
      water: "Source-backed hydrographic extent only.",
      curb: "Estimated/source-constrained curb profile; not survey-grade and not current-condition truth.",
    },
    provenance: {
      sourceEpoch: "2022 planimetric capture",
      termsUrl: "https://opendata.cityofnewyork.us/overview/",
      attribution: "NYC OTI Planimetrics via NYC Open Data",
      disclaimer: "NYC Open Data may be updated or corrected; no warranty is made.",
      localOnly: true,
      runtimeExternalNetwork: false,
    },
    fallback: "Drop the ground overlay entirely if its ledger, document, or asset checks fail; never serve a partially covered base.",
    ...overrides,
  };
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

function messages(result: { ok: boolean; issues?: { path: string; message: string }[] }): string {
  return (result.issues ?? []).map((entry) => `${entry.path}: ${entry.message}`).join("\n");
}

describe("ground partition scheme", () => {
  it("versions the grid so a future partition is a new scheme rather than a silent rewrite", () => {
    expect(GROUND_PARTITION_SCHEMES[GROUND_PARTITION_SCHEME_ID].tileLevel).toBe(14);
    const { ledger } = buildGroundOwnershipLedger(ledgerInput());
    expect(ledger.partitionSchemeId).toBe(GROUND_PARTITION_SCHEME_ID);
    expect(ledger.ledgerId).toContain(GROUND_PARTITION_SCHEME_ID);
    expect(() => buildGroundOwnershipLedger(ledgerInput({ partitionSchemeId: "ground-partition-v2-level15" as never }))).toThrow(/Unknown ground partition scheme/u);
  });

  it("snaps the declared extent outward to whole tiles and publishes the snapped rectangle", () => {
    const { coverage, tiles } = groundPartitionTiles(TEST_EXTENT, GROUND_PARTITION_SCHEME_ID);
    expect(tiles).toHaveLength(15);
    expect(coverage.west).toBeLessThanOrEqual(TEST_EXTENT.requested.west);
    expect(coverage.south).toBeLessThanOrEqual(TEST_EXTENT.requested.south);
    expect(coverage.east).toBeGreaterThanOrEqual(TEST_EXTENT.requested.east);
    expect(coverage.north).toBeGreaterThanOrEqual(TEST_EXTENT.requested.north);
    // Snapping is idempotent: re-snapping the published coverage is a fixed point.
    expect(groundPartitionTiles({ ...TEST_EXTENT, requested: coverage }, GROUND_PARTITION_SCHEME_ID).coverage).toEqual(coverage);
  });

  it("covers tiles the exterior building partition necessarily omits", () => {
    const { ledger } = buildGroundOwnershipLedger(ledgerInput());
    const empty = ledger.cells.filter((cell) => cell.partIds.length === 0);
    expect(empty.length).toBeGreaterThan(0);
    expect(empty.every((cell) => cell.membershipChecksumSha256 === groundMembershipChecksum([]))).toBe(true);
  });

  it("builds the declared Manhattan extent as a whole-island grid", () => {
    const { coverage, tiles } = groundPartitionTiles(MANHATTAN_GROUND_EXTENT, GROUND_PARTITION_SCHEME_ID);
    expect(tiles).toHaveLength(140);
    expect(coverage.west).toBeLessThan(MANHATTAN_GROUND_EXTENT.requested.west);
    expect(coverage.north).toBeGreaterThan(MANHATTAN_GROUND_EXTENT.requested.north);
    const { ledger } = buildGroundOwnershipLedger(ledgerInput({ extent: MANHATTAN_GROUND_EXTENT }));
    expect(ledger.cells).toHaveLength(140);
    expect(validateGroundPartitionCoverage(ledger).ok, messages(validateGroundPartitionCoverage(ledger))).toBe(true);
  });

  /**
   * `scripts/citywide-public-realm-cli.mjs` clips the T003 vector acquisition to
   * this rectangle, and `CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_EVIDENCE.scope`
   * states it as the approved envelope. Neither can import this module — one is
   * dependency-free `.mjs`, the other is a frozen approval record — so both
   * restate the numbers. This is the assertion that keeps the restatements
   * honest: change the extent or the partition scheme and this fails loudly
   * instead of letting a snapshot clip to a stale envelope.
   */
  it("snapped Manhattan ground coverage is the clip envelope restated in the T003 acquisition CLI", () => {
    const { coverage } = groundPartitionTiles(MANHATTAN_GROUND_EXTENT, GROUND_PARTITION_SCHEME_ID);
    expect(coverage).toEqual({ west: -74.0478515625, south: 40.67138671875, east: -73.89404296875, north: 40.89111328125 });
    for (const bound of Object.values(coverage)) {
      expect(CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_EVIDENCE.scope).toContain(String(bound));
    }
  });
});

describe("ledger determinism", () => {
  it("produces byte-identical identity across repeat builds", () => {
    const first = buildGroundOwnershipLedger(ledgerInput());
    const second = buildGroundOwnershipLedger(ledgerInput());
    expect(second.ledger.ledgerId).toBe(first.ledger.ledgerId);
    expect(second.ledger.baseIdentitySet).toEqual(first.ledger.baseIdentitySet);
    expect(second.ledger.cells.map((cell) => cell.membershipChecksumSha256)).toEqual(first.ledger.cells.map((cell) => cell.membershipChecksumSha256));
    expect(stableSerialize(second.ledger)).toBe(stableSerialize(first.ledger));
    expect(second.parts).toEqual(first.parts);
  });

  it("is insensitive to input ordering and to object key ordering", () => {
    const baseline = buildGroundOwnershipLedger(ledgerInput());
    const reorderedPark: GroundSurfaceFeature = {
      identityOrigin: PARK.identityOrigin,
      uncertainty: PARK.uncertainty,
      sourceRefs: PARK.sourceRefs,
      claimLevel: PARK.claimLevel,
      class: PARK.class,
      cityId: PARK.cityId,
      canonicalFeatureId: PARK.canonicalFeatureId,
    };
    const shuffled = buildGroundOwnershipLedger(ledgerInput({
      features: [WATER, CURB, reorderedPark, ROADBED],
      occupancy: [...ledgerInput().occupancy].reverse(),
    }));
    expect(shuffled.ledger.ledgerId).toBe(baseline.ledger.ledgerId);
    expect(stableSerialize(shuffled.ledger)).toBe(stableSerialize(baseline.ledger));
    expect(shuffled.parts).toEqual(baseline.parts);
  });

  it("keeps tile bound floats stable and exactly equal to the tile authority", () => {
    const first = buildGroundOwnershipLedger(ledgerInput()).ledger;
    const second = buildGroundOwnershipLedger(ledgerInput()).ledger;
    for (const [index, cell] of first.cells.entries()) {
      const authority = tileBounds(groundCellTileKey(cell.cellId));
      expect(cell.bounds).toEqual(authority);
      expect(stableSerialize(cell.bounds)).toBe(stableSerialize(second.cells[index]!.bounds));
      expect(stableSerialize(cell.bounds)).toBe(stableSerialize(authority));
    }
    // The published coverage is the union of the corner tiles, to the bit.
    expect(first.coverage.west).toBe(tileBounds(groundCellTileKey(first.cells[0]!.cellId)).west);
    expect(first.coverage.south).toBe(tileBounds(groundCellTileKey(first.cells[0]!.cellId)).south);
  });

  it("changes ledger identity when the partition changes and not when nothing does", () => {
    const baseline = buildGroundOwnershipLedger(ledgerInput()).ledger;
    const widened = buildGroundOwnershipLedger(ledgerInput({ extent: { ...TEST_EXTENT, extentId: "ground-test-extent-v2", requested: { ...TEST_EXTENT.requested, north: 40.83 } } })).ledger;
    expect(widened.ledgerId).not.toBe(baseline.ledgerId);
    expect(buildGroundOwnershipLedger(ledgerInput()).ledger.ledgerId).toBe(baseline.ledgerId);
  });
});

describe("cell ordering", () => {
  it("runs south-to-north then west-to-east, with the order embedded in the cell id", () => {
    const { ledger } = buildGroundOwnershipLedger(ledgerInput());
    ledger.cells.forEach((cell, index) => {
      expect(cell.order).toBe(index);
      expect(groundCellOrder(cell.cellId)).toBe(index);
      expect(GROUND_CELL_ID_PATTERN.test(cell.cellId)).toBe(true);
    });
    const keys = ledger.cells.map((cell) => groundCellTileKey(cell.cellId));
    expect(keys[0]!.y).toBe(Math.max(...keys.map((key) => key.y)));
    for (let index = 1; index < keys.length; index += 1) {
      const previous = keys[index - 1]!;
      const current = keys[index]!;
      expect(previous.y > current.y || (previous.y === current.y && previous.x < current.x)).toBe(true);
    }
  });

  it("resolves the row/column tie rule identically whatever order the input arrived in", () => {
    const forward = buildGroundOwnershipLedger(ledgerInput()).ledger.cells.map((cell) => cell.cellId);
    const reversed = buildGroundOwnershipLedger(ledgerInput({ features: [...ledgerInput().features].reverse() })).ledger.cells.map((cell) => cell.cellId);
    expect(reversed).toEqual(forward);
    // Same row, different column: the westerly cell always sorts first.
    const sameRow = forward.map(groundCellTileKey).filter((key) => key.y === groundCellTileKey(forward[0]!).y);
    expect(sameRow.map((key) => key.x)).toEqual([...sameRow.map((key) => key.x)].sort((left, right) => left - right));
  });
});

describe("multi-cell feature parts", () => {
  it("splits one canonical park across eight cells, each owning it exactly once", () => {
    const { ledger, parts } = buildGroundOwnershipLedger(ledgerInput());
    const parkParts = parts.filter((part) => part.canonicalFeatureId === PARK.canonicalFeatureId);
    expect(parkParts.length).toBeGreaterThanOrEqual(4);
    expect(parkParts).toHaveLength(8);
    expect(new Set(parkParts.map((part) => part.partId)).size).toBe(parkParts.length);
    expect(new Set(parkParts.map((part) => part.ownerCellId)).size).toBe(parkParts.length);
    for (const part of parkParts) {
      expect(part.partId).toBe(groundPartId(PARK.canonicalFeatureId, part.ownerCellId));
      const owners = ledger.cells.filter((cell) => cell.partIds.includes(part.partId));
      expect(owners).toHaveLength(1);
      expect(owners[0]!.cellId).toBe(part.ownerCellId);
    }
    // The canonical feature stays singular: one deep-linkable identity, many parts.
    expect(new Set(parts.map((part) => part.canonicalFeatureId)).size).toBe(4);
    expect(ledger.baseIdentitySet.featureCount).toBe(4);
    expect(ledger.baseIdentitySet.partCount).toBe(parts.length);
  });

  it("derives identical part ids across repeat builds", () => {
    const first = buildGroundOwnershipLedger(ledgerInput()).parts.map((part) => part.partId);
    const second = buildGroundOwnershipLedger(ledgerInput()).parts.map((part) => part.partId);
    expect(second).toEqual(first);
  });

  it("honours caller-declared clipped occupancy without over-approximating from bounds", () => {
    const { parts } = buildGroundOwnershipLedger(ledgerInput());
    const waterParts = parts.filter((part) => part.canonicalFeatureId === WATER.canonicalFeatureId);
    expect(waterParts).toHaveLength(2);
    expect(waterParts.map((part) => groundCellTileKey(part.ownerCellId)).map(tileKeyString).sort()).toEqual(["wgs84-geodetic/14/4824/4477", "wgs84-geodetic/14/4824/4478"]);
  });
});

describe("build-time fail-closed behaviour", () => {
  it("refuses a feature that falls outside the declared extent instead of dropping it", () => {
    expect(() => buildGroundOwnershipLedger(ledgerInput({
      occupancy: [
        ...ledgerInput().occupancy.slice(1),
        { canonicalFeatureId: PARK.canonicalFeatureId, occupancy: { kind: "bounds", bounds: { west: -74.2, south: 40.5, east: -74.19, north: 40.51 } } },
      ],
    }))).toThrow(/outside the declared extent/u);
  });

  it("refuses a park that mints its own identity, and accepts it only under an explicit relaxed policy", () => {
    const minted: GroundFeature = { ...PARK, canonicalFeatureId: "udt:ground:manhattan:park:central", identityOrigin: { kind: "ground-owned" } };
    const input = ledgerInput({
      features: [minted],
      occupancy: [{ canonicalFeatureId: minted.canonicalFeatureId, occupancy: { kind: "bounds", bounds: CENTRAL_PARK_BOUNDS } }],
    });
    expect(() => buildGroundOwnershipLedger(input)).toThrow(/must reference an existing catalog identity/u);
    expect(buildGroundOwnershipLedger({ ...input, identityPolicy: { referencedExistingClasses: [] } }).ledger.baseIdentitySet.featureCount).toBe(1);
  });

  it("refuses a feature with no declared occupancy, occupancy for an unknown feature, and a duplicated identity", () => {
    expect(() => buildGroundOwnershipLedger(ledgerInput({ occupancy: ledgerInput().occupancy.slice(1) }))).toThrow(/declared no cell occupancy/u);
    expect(() => buildGroundOwnershipLedger(ledgerInput({
      occupancy: [...ledgerInput().occupancy, { canonicalFeatureId: "udt:ground:manhattan:plaza:ghost", occupancy: { kind: "bounds", bounds: SINGLE_CELL_BOUNDS } }],
    }))).toThrow(/unknown feature/u);
    expect(() => buildGroundOwnershipLedger(ledgerInput({ features: [PARK, PARK] }))).toThrow(/a canonical identity is singular/u);
  });

  it("refuses a feature belonging to another city than the ledger", () => {
    expect(() => buildGroundOwnershipLedger(ledgerInput({ features: [{ ...ROADBED, cityId: "city:boston" }, PARK, CURB, WATER] }))).toThrow(/belongs to city:boston/u);
  });

  it("refuses declared cells at the wrong partition level", () => {
    expect(() => buildGroundOwnershipLedger(ledgerInput({
      occupancy: [
        ...ledgerInput().occupancy.slice(0, 3),
        { canonicalFeatureId: WATER.canonicalFeatureId, occupancy: { kind: "declared-cells", tileKeys: ["wgs84-geodetic/16/19296/17910"] } },
      ],
    }))).toThrow(/wrong partition level/u);
  });
});

describe("coverage tiles exactly once", () => {
  it("accepts the built partition", () => {
    const { ledger } = buildGroundOwnershipLedger(ledgerInput());
    const result = validateGroundPartitionCoverage(ledger);
    expect(result.ok, messages(result)).toBe(true);
  });

  it("fails closed on a missing cell", () => {
    const { ledger } = buildGroundOwnershipLedger(ledgerInput());
    const gapped: GroundOwnershipLedger = { ...ledger, cells: ledger.cells.filter((cell) => cell.order !== 7) };
    const result = validateGroundPartitionCoverage(gapped);
    expect(result.ok).toBe(false);
    expect(messages(result)).toMatch(/is not owned by any cell/u);
  });

  it("fails closed on an overlapping cell", () => {
    const { ledger } = buildGroundOwnershipLedger(ledgerInput());
    const duplicateTile = groundCellTileKey(ledger.cells[4]!.cellId);
    const overlapped: GroundOwnershipLedger = {
      ...ledger,
      cells: ledger.cells.map((cell) => cell.order === 5
        ? { ...cell, cellId: `ground-cell-000005-${duplicateTile.level}-${duplicateTile.x}-${duplicateTile.y}`, bounds: tileBounds(duplicateTile) }
        : cell),
    };
    const result = validateGroundPartitionCoverage(overlapped);
    expect(result.ok).toBe(false);
    expect(messages(result)).toMatch(/claimed by more than one cell/u);
  });

  it("fails closed on unsnapped coverage, mismatched cell bounds, and a broken order", () => {
    const { ledger } = buildGroundOwnershipLedger(ledgerInput());
    expect(messages(validateGroundPartitionCoverage({ ...ledger, coverage: { ...ledger.coverage, north: ledger.coverage.north - 0.001 } }))).toMatch(/snapped to whole partition tiles/u);
    const movedBounds: GroundOwnershipLedger = { ...ledger, cells: ledger.cells.map((cell) => cell.order === 3 ? { ...cell, bounds: { ...cell.bounds, north: cell.bounds.north + 0.0001 } } : cell) };
    expect(messages(validateGroundPartitionCoverage(movedBounds))).toMatch(/exactly its partition tile bounds/u);
    const reordered: GroundOwnershipLedger = { ...ledger, cells: [...ledger.cells].reverse() };
    expect(validateGroundPartitionCoverage(reordered).ok).toBe(false);
  });

  it("rejects an unknown partition scheme without attempting to tile it", () => {
    const { ledger } = buildGroundOwnershipLedger(ledgerInput());
    const result = validateGroundPartitionCoverage({ ...ledger, partitionSchemeId: "ground-partition-v9" });
    expect(result.ok).toBe(false);
    expect(paths(result)).toEqual(["partitionSchemeId"]);
  });
});

describe("ledger structure validation", () => {
  it("accepts the built ledger", () => {
    const { ledger } = buildGroundOwnershipLedger(ledgerInput());
    const result = validateGroundOwnershipLedgerStructure(ledger);
    expect(result.ok, messages(result)).toBe(true);
  });

  it("fails closed on a missing key, an unexpected key, and a wrong schema version", () => {
    const { ledger } = buildGroundOwnershipLedger(ledgerInput());
    expect(paths(validateGroundOwnershipLedgerStructure(omit(ledger, "coverage")))).toContain("$.coverage");
    expect(paths(validateGroundOwnershipLedgerStructure({ ...ledger, waveIndex: 2 }))).toContain("$.waveIndex");
    expect(paths(validateGroundOwnershipLedgerStructure({ ...ledger, schemaVersion: "2.0" }))).toContain("schemaVersion");
  });

  it("fails closed on a membership checksum that does not match its part ids", () => {
    const { ledger } = buildGroundOwnershipLedger(ledgerInput());
    const tampered: GroundOwnershipLedger = {
      ...ledger,
      cells: ledger.cells.map((cell) => cell.order === 1 ? { ...cell, partIds: [...cell.partIds, "udt:ground:manhattan:plaza:ghost#" + cell.cellId] } : cell),
    };
    expect(paths(validateGroundOwnershipLedgerStructure(tampered))).toContain("cells[1].membershipChecksumSha256");
  });

  it("requires the ledger id to name its own partition scheme and to declare immutability", () => {
    const { ledger } = buildGroundOwnershipLedger(ledgerInput());
    expect(paths(validateGroundOwnershipLedgerStructure({ ...ledger, ledgerId: "ground-ledger:city-manhattan:anonymous" }))).toContain("ledgerId");
    expect(paths(validateGroundOwnershipLedgerStructure({ ...ledger, immutable: false }))).toContain("immutable");
  });
});

describe("release document validation", () => {
  const { ledger } = buildGroundOwnershipLedger(ledgerInput());

  it("accepts a well-formed document", () => {
    const result = validateGroundReleaseStructure(releaseDocument(ledger));
    expect(result.ok, messages(result)).toBe(true);
  });

  it("fails closed on a missing key, an unexpected key, and a wrong schema version", () => {
    expect(paths(validateGroundReleaseStructure(omit(releaseDocument(ledger), "clip")))).toContain("$.clip");
    expect(paths(validateGroundReleaseStructure({ ...releaseDocument(ledger), tileset: "ground.json" }))).toContain("$.tileset");
    expect(paths(validateGroundReleaseStructure({ ...releaseDocument(ledger), schemaVersion: "0.9" }))).toContain("schemaVersion");
  });

  it("rejects an unknown ground class on an asset and in the claim ceilings", () => {
    const document = releaseDocument(ledger);
    const withUnknownAsset = { ...document, assets: [{ ...document.assets[0]!, class: "roadway" as never }] };
    expect(paths(validateGroundReleaseStructure(withUnknownAsset))).toContain("assets[0].class");
    const withUnknownCeiling = { ...document, claimCeilings: { ...document.claimCeilings, roadway: "anything" } };
    expect(paths(validateGroundReleaseStructure(withUnknownCeiling))).toContain("claimCeilings.roadway");
  });

  it("requires every shipped class to declare a claim ceiling", () => {
    const document = releaseDocument(ledger);
    expect(paths(validateGroundReleaseStructure({ ...document, claimCeilings: omit(document.claimCeilings, "curb") }))).toContain("claimCeilings.curb");
  });

  it("keeps the embellishment claim ceiling explicitly estimated and uncertain", () => {
    const document = releaseDocument(ledger);
    const promoted = { ...document, claimCeilings: { ...document.claimCeilings, curb: "Source-backed curb geometry." } };
    expect(messages(validateGroundReleaseStructure(promoted))).toMatch(/estimated/u);
  });

  it("refuses an asset with zero or two always-covering flat tiers", () => {
    const document = releaseDocument(ledger);
    const zero = { ...document, assets: [assetEntry("asset:roadbed:0", ledger.cells[0]!.cellId, "roadbed", [nearTier()])] };
    expect(messages(validateGroundReleaseStructure(zero))).toMatch(/exactly one always-covering flat tier/u);
    const two = { ...document, assets: [assetEntry("asset:roadbed:0", ledger.cells[0]!.cellId, "roadbed", [flatTier(), flatTier({ tierId: "flat-2", artifactRef: "ground/flat-2.json" })])] };
    expect(messages(validateGroundReleaseStructure(two))).toMatch(/exactly one always-covering flat tier/u);
  });

  it("refuses an unsafe tier artifact reference and a stale per-asset digest", () => {
    const document = releaseDocument(ledger);
    const unsafe = { ...document, assets: [assetEntry("asset:roadbed:0", ledger.cells[0]!.cellId, "roadbed", [flatTier({ artifactRef: "../secrets/flat.json" })])] };
    expect(paths(validateGroundReleaseStructure(unsafe))).toContain("assets[0].tiers[0].artifactRef");
    const stale = { ...document, assets: [{ ...document.assets[0]!, contentSha256: HASH("stale") }] };
    expect(paths(validateGroundReleaseStructure(stale))).toContain("assets[0].contentSha256");
  });

  it("refuses geometry evidence that does not pass its own tolerance", () => {
    const document = releaseDocument(ledger);
    expect(paths(validateGroundReleaseStructure({ ...document, geometryValidation: { ...document.geometryValidation, maxObservedRelativeAreaError: 0.5 } }))).toContain("geometryValidation.maxObservedRelativeAreaError");
    expect(paths(validateGroundReleaseStructure({ ...document, geometryValidation: { ...document.geometryValidation, status: "fail" as never } }))).toContain("geometryValidation.status");
  });

  it("refuses a local-only release that declares runtime external network use", () => {
    const document = releaseDocument(ledger);
    expect(paths(validateGroundReleaseStructure({ ...document, provenance: { ...document.provenance, runtimeExternalNetwork: true } }))).toContain("provenance.runtimeExternalNetwork");
  });

  it("treats the zone imagery seam as additive and optional", () => {
    const document = releaseDocument(ledger);
    expect(validateGroundReleaseStructure(document).ok).toBe(true);
    expect(validateGroundReleaseStructure({ ...document, zoneImagery: null }).ok).toBe(true);
    const imagery = { zoneRef: "zone:midtown", artifactRef: "ground/imagery/midtown.ktx2", checksumSha256: HASH("imagery"), captureYear: 2022, attribution: "NYC OTI orthoimagery" };
    expect(validateGroundReleaseStructure({ ...document, zoneImagery: imagery }).ok).toBe(true);
    expect(paths(validateGroundReleaseStructure({ ...document, zoneImagery: { ...imagery, checksumSha256: "nope" } }))).toContain("zoneImagery.checksumSha256");
    // The seam is additive: declaring it changes the release bytes, and dropping
    // it again restores exactly the pre-seam serialization, so a release written
    // before T012/T013 needs no schema migration to stay valid.
    const withImagery: GroundReleaseDocument = { ...document, zoneImagery: imagery };
    expect(stableSerialize(withImagery)).not.toBe(stableSerialize(document));
    expect(stableSerialize(omit(withImagery, "zoneImagery"))).toBe(stableSerialize(document));
    expect("zoneImagery" in document).toBe(false);
  });
});

describe("release graph validation", () => {
  function graph(): { ledger: GroundOwnershipLedger; document: GroundReleaseDocument; features: GroundFeature[]; parts: ReturnType<typeof buildGroundOwnershipLedger>["parts"] } {
    const build = buildGroundOwnershipLedger(ledgerInput());
    return { ledger: build.ledger, document: releaseDocument(build.ledger), features: [PARK, ROADBED, CURB, WATER], parts: build.parts };
  }

  it("accepts a consistent ledger, document, feature set, and part set", () => {
    const result = validateGroundReleaseGraph(graph());
    expect(result.ok, messages(result)).toBe(true);
  });

  it("requires the document and the ledger to agree on schema, identity, and scheme", () => {
    const base = graph();
    expect(paths(validateGroundReleaseGraph({ ...base, document: { ...base.document, ownershipLedgerId: "ground-ledger:other" } }))).toContain("document.ownershipLedgerId");
    expect(messages(validateGroundReleaseGraph({ ...base, document: { ...base.document, cityId: "city:boston" } }))).toMatch(/must name the same city/u);
    expect(messages(validateGroundReleaseGraph({ ...base, ledger: { ...base.ledger, schemaVersion: "2.0" as never } }))).toMatch(/Unsupported ground ownership schema/u);
  });

  it("refuses a part that is not listed in its owning cell, and a cell that claims an unknown part", () => {
    const base = graph();
    const orphanCell = { ...base.ledger, cells: base.ledger.cells.map((cell) => cell.order === 1 ? { ...cell, partIds: [], membershipChecksumSha256: groundMembershipChecksum([]) } : cell) };
    expect(messages(validateGroundReleaseGraph({ ...base, ledger: orphanCell }))).toMatch(/not listed in its owning cell/u);

    const ghostPartId = `${PARK.canonicalFeatureId}#${base.ledger.cells[0]!.cellId}`;
    const ghostCell = {
      ...base.ledger,
      cells: base.ledger.cells.map((cell) => cell.order === 0 ? { ...cell, partIds: [ghostPartId], membershipChecksumSha256: groundMembershipChecksum([ghostPartId]) } : cell),
    };
    expect(messages(validateGroundReleaseGraph({ ...base, ledger: ghostCell }))).toMatch(/unknown part/u);
  });

  it("refuses a pinned identity checksum or count that no longer matches the set", () => {
    const base = graph();
    expect(paths(validateGroundReleaseGraph({ ...base, ledger: { ...base.ledger, baseIdentitySet: { ...base.ledger.baseIdentitySet, featureCount: 99 } } }))).toContain("ledger.baseIdentitySet.featureCount");
    expect(paths(validateGroundReleaseGraph({ ...base, ledger: { ...base.ledger, baseIdentitySet: { ...base.ledger.baseIdentitySet, checksumSha256: HASH("wrong") } } }))).toContain("ledger.baseIdentitySet.checksumSha256");
  });

  it("refuses an embellishment feature promoted to source-backed anywhere in the graph", () => {
    const base = graph();
    const promoted = base.features.map((feature) => feature.canonicalFeatureId === CURB.canonicalFeatureId ? { ...feature, claimLevel: "source-backed" } : feature);
    const result = validateGroundReleaseGraph({ ...base, features: promoted });
    expect(result.ok).toBe(false);
    expect(messages(result)).toMatch(/always estimated/u);
  });

  it("refuses an asset that names a cell outside the ownership ledger", () => {
    const base = graph();
    const document = { ...base.document, assets: [{ ...base.document.assets[0]!, cellId: "ground-cell-000999-14-4824-4481" }] };
    expect(messages(validateGroundReleaseGraph({ ...base, document }))).toMatch(/not in the ownership ledger/u);
  });

  it("fails closed on a malformed graph envelope", () => {
    expect(validateGroundReleaseGraph(null).ok).toBe(false);
    expect(paths(validateGroundReleaseGraph({ ledger: {}, document: {} }))).toEqual(expect.arrayContaining(["$.features", "$.parts"]));
  });
});

describe("configuration-driven, not Manhattan-specific", () => {
  const BOSTON_PLAZA: GroundSurfaceFeature = {
    canonicalFeatureId: "udt:ground:boston:plaza:city-hall",
    cityId: "city:boston",
    class: "plaza",
    claimLevel: "estimated",
    sourceRefs: [sourceRef("source:boston-plaza")],
    uncertainty: UNCERTAINTY,
    identityOrigin: { kind: "ground-owned" },
  };

  const BOSTON_EXTENT: GroundExtentDeclaration = {
    extentId: "boston-ground-extent-fixture",
    requested: { west: -71.07, south: 42.35, east: -71.05, north: 42.37 },
    note: "Fixture extent for a second city. Not a real Boston release.",
  };

  it("builds and validates a ledger for a city that is not Manhattan", () => {
    const build = buildGroundOwnershipLedger({
      cityId: "city:boston",
      configId: "config:boston-ground",
      partitionSchemeId: GROUND_PARTITION_SCHEME_ID,
      extent: BOSTON_EXTENT,
      baseIdentitySetId: "ground-identity-set:boston-fixture",
      features: [BOSTON_PLAZA],
      occupancy: [{ canonicalFeatureId: BOSTON_PLAZA.canonicalFeatureId, occupancy: { kind: "bounds", bounds: { west: -71.065, south: 42.355, east: -71.06, north: 42.358 } } }],
    });
    expect(build.ledger.cityId).toBe("city:boston");
    expect(build.ledger.ledgerId).toContain("city-boston");
    expect(validateGroundOwnershipLedgerStructure(build.ledger).ok, messages(validateGroundOwnershipLedgerStructure(build.ledger))).toBe(true);
    expect(validateGroundPartitionCoverage(build.ledger).ok, messages(validateGroundPartitionCoverage(build.ledger))).toBe(true);
    expect(build.parts.length).toBeGreaterThan(0);
    expect(build.ledger.ledgerId).not.toBe(buildGroundOwnershipLedger(ledgerInput()).ledger.ledgerId);
  });
});
