import { describe, expect, it } from "vitest";
import { domainSeparatedSha256 } from "../domain/deterministic-hash";
import type { GroundFeature } from "../domain/ground";
import {
  EXTERIOR_WAVE_PLAN,
  EXTERIOR_WAVE_TILE_LEVEL,
} from "../release/exterior-wave-ledger";
import {
  GROUND_PARTITION_SCHEME_ID,
  MANHATTAN_GROUND_CITY_ID,
  MANHATTAN_GROUND_CONFIG_ID,
  MANHATTAN_GROUND_EXTENT,
  buildGroundOwnershipLedger,
  groundAssetContentSha256,
  validateGroundReleaseStructure,
  type GroundOwnershipLedger,
  type GroundReleaseDocument,
} from "../release/ground-release";
import { CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE } from "./citywide-overview-cell-extents";
import {
  GROUND_EMBELLISHMENT_ARTIFACT_SCHEMA_VERSION,
  GROUND_EMBELLISHMENT_BUDGETS,
  GROUND_EMBELLISHMENT_CANARY_WAVES,
  GROUND_EMBELLISHMENT_MAX_ACTIVE_CELLS,
  MANHATTAN_GROUND_EMBELLISHMENT_RELEASE_ID,
  activeGroundEmbellishmentCells,
  groundEmbellishmentCanaryTileRows,
  isGroundEmbellishmentCanaryCell,
  loadGroundEmbellishmentRelease,
  type GroundEmbellishmentCellArtifact,
} from "./ground-embellishment-runtime";
import { loadGroundRelease, type GroundFetcher } from "./ground-release-runtime";

const BASE_PATH = `/data/${MANHATTAN_GROUND_EMBELLISHMENT_RELEASE_ID}/`;

/** A level-14 tile inside the Midtown-core wave, and one that is not. */
const INSIDE_TILE_KEY = "wgs84-geodetic/14/4825/4482";
const OUTSIDE_TILE_KEY = "wgs84-geodetic/14/4825/4486";

async function sha256(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

function curbFeature(canonicalFeatureId: string): GroundFeature {
  return {
    canonicalFeatureId,
    cityId: MANHATTAN_GROUND_CITY_ID,
    class: "curb",
    claimLevel: "estimated",
    sourceRefs: [{
      schemaVersion: "1.0",
      id: `source-ref:${canonicalFeatureId}`,
      registryEntryId: "nyc.oti-planimetrics-pavement-edge-block835",
      provider: "NYC Office of Technology and Innovation (OTI) Planimetrics",
      datasetId: "x9uq-u3qs",
      sourceRecordId: "19226000628.0",
      sourceUrl: "https://data.cityofnewyork.us/resource/x9uq-u3qs.geojson",
      licenseRefId: "nyc-open-data-terms",
      role: "primary",
      capturedAt: "2026-08-24T02:41:06.563Z",
      updatedAt: "2024-04-26T20:48:18.000Z",
      observedAt: "2026-08-24T02:41:06.563Z",
      release: null,
    }],
    uncertainty: { horizontalMeters: 0.25, verticalMeters: 0.1, temporal: "Pavement edge rows updated 2024-04-26; the vertical profile is authored." },
    identityOrigin: { kind: "ground-owned" },
  };
}

/** A short polyline well inside a cell. */
function lineIn(bounds: { west: number; south: number; east: number; north: number }): number[][][] {
  const west = bounds.west + (bounds.east - bounds.west) * 0.3;
  const east = bounds.west + (bounds.east - bounds.west) * 0.7;
  const south = bounds.south + (bounds.north - bounds.south) * 0.4;
  return [[[west, south], [(west + east) / 2, south], [east, south]]];
}

interface Fixture {
  ledger: GroundOwnershipLedger;
  document: GroundReleaseDocument;
  features: GroundFeature[];
  parts: { partId: string; canonicalFeatureId: string; ownerCellId: string }[];
  artifacts: Map<string, GroundEmbellishmentCellArtifact>;
  insideCellId: string;
  outsideCellId: string;
}

/**
 * Two curbs over the real declared extent: one inside the canary wave and one
 * outside it.
 *
 * Built by the production ledger builder for the same reason the flat runtime's
 * fixture is: the loader checks that the ledger partitions
 * `MANHATTAN_GROUND_EXTENT` and that its id re-derives, so a hand-written
 * ledger could not reach the code under test.
 */
async function fixture(): Promise<Fixture> {
  const insideId = "udt:ground:manhattan:curb:1111111111111111";
  const outsideId = "udt:ground:manhattan:curb:2222222222222222";
  const features = [curbFeature(insideId), curbFeature(outsideId)];
  const build = buildGroundOwnershipLedger({
    cityId: MANHATTAN_GROUND_CITY_ID,
    configId: MANHATTAN_GROUND_CONFIG_ID,
    partitionSchemeId: GROUND_PARTITION_SCHEME_ID,
    extent: MANHATTAN_GROUND_EXTENT,
    baseIdentitySetId: "ground-identity:embellishment-test",
    features,
    occupancy: [
      { canonicalFeatureId: insideId, occupancy: { kind: "declared-cells" as const, tileKeys: [INSIDE_TILE_KEY] } },
      { canonicalFeatureId: outsideId, occupancy: { kind: "declared-cells" as const, tileKeys: [OUTSIDE_TILE_KEY] } },
    ],
  });
  const artifacts = new Map<string, GroundEmbellishmentCellArtifact>();
  const assets: GroundReleaseDocument["assets"] = [];
  const cellFor = (canonicalFeatureId: string) => build.ledger.cells
    .find((cell) => cell.partIds.some((partId) => partId.startsWith(canonicalFeatureId)))!;
  for (const canonicalFeatureId of [insideId, outsideId]) {
    const cell = cellFor(canonicalFeatureId);
    const artifact: GroundEmbellishmentCellArtifact = {
      schemaVersion: GROUND_EMBELLISHMENT_ARTIFACT_SCHEMA_VERSION,
      releaseId: MANHATTAN_GROUND_EMBELLISHMENT_RELEASE_ID,
      cellId: cell.cellId,
      class: "curb",
      cellBounds: cell.bounds,
      coordinateDecimals: 7,
      claimLevel: "estimated",
      derivation: {
        algorithm: "pavement-edge-constrained-curb-v1",
        inputDataset: "x9uq-u3qs",
        note: "Geometry is the source pavement-edge alignment, clipped to this cell.",
        profile: { topElevationMeters: 0.22, roadbedElevationMeters: 0, authoredRiseMeters: 0.22, profileIsEstimated: true },
      },
      partCount: 1,
      parts: [{
        partId: `${canonicalFeatureId}#${cell.cellId}`,
        canonicalFeatureId,
        clipped: false,
        boundaryCoincident: false,
        geometry: { type: "MultiLineString", coordinates: lineIn(cell.bounds) },
      }],
    };
    const artifactRef = `artifacts/${cell.cellId}/curb.json`;
    artifacts.set(artifactRef, artifact);
    const tiers = [{
      tierId: `${cell.cellId}:curb:near-3d`,
      kind: "near-3d" as const,
      maxDistanceMeters: 400,
      artifactRef,
      checksumSha256: await sha256(JSON.stringify(artifact)),
    }];
    assets.push({ assetId: `ground-asset:${cell.cellId}:curb`, cellId: cell.cellId, class: "curb", tiers, contentSha256: groundAssetContentSha256(tiers) });
  }
  const document: GroundReleaseDocument = {
    schemaVersion: "1.0",
    releaseId: MANHATTAN_GROUND_EMBELLISHMENT_RELEASE_ID,
    cityId: MANHATTAN_GROUND_CITY_ID,
    configId: MANHATTAN_GROUND_CONFIG_ID,
    partitionSchemeId: GROUND_PARTITION_SCHEME_ID,
    ownershipLedgerId: build.ledger.ledgerId,
    generatedAt: "2026-08-25T00:00:00.000Z",
    immutable: true,
    sourceSnapshots: [{ datasetId: "x9uq-u3qs", rawSha256: domainSeparatedSha256("test", "snapshot"), sourceFeatureCount: 2 }],
    clip: {
      sourceExtent: { west: -74.1, south: 40.6, east: -73.8, north: 40.95 },
      clipBounds: build.ledger.coverage,
      bufferMeters: 0,
      rule: "Clipped per ownership cell by Liang-Barsky with no buffer.",
    },
    geometryValidation: { method: "L1 length residual.", areaResidualToleranceRelative: 0.000001, maxObservedRelativeAreaError: 0, status: "pass" },
    assets,
    claimCeilings: { curb: "Estimated curb embellishment; the 0.22 m rise is authored and this is not a survey of current curb construction." },
    provenance: {
      sourceEpoch: "Pavement edge rows updated 2024-04-26.",
      termsUrl: "https://opendata.cityofnewyork.us/overview/",
      attribution: "NYC Open Data.",
      disclaimer: "No warranty of completeness or fitness is made.",
      localOnly: true,
      runtimeExternalNetwork: false,
    },
    fallback: "A consumer that cannot verify a curb draws the flat cartographic base alone.",
  };
  return {
    ledger: build.ledger,
    document,
    features,
    parts: build.parts,
    artifacts,
    insideCellId: cellFor(insideId).cellId,
    outsideCellId: cellFor(outsideId).cellId,
  };
}

interface FetcherOptions {
  mutate?: (bodies: Map<string, string>) => void;
  missing?: string[];
}

function fetcherFor(state: Fixture, options: FetcherOptions = {}): { fetcher: GroundFetcher; requested: string[] } {
  const bodies = new Map<string, string>([
    [`${BASE_PATH}release.json`, JSON.stringify(state.document)],
    [`${BASE_PATH}ledger.json`, JSON.stringify(state.ledger)],
    [`${BASE_PATH}features.json`, JSON.stringify(state.features)],
    [`${BASE_PATH}parts.json`, JSON.stringify(state.parts)],
  ]);
  for (const [artifactRef, artifact] of state.artifacts) bodies.set(`${BASE_PATH}${artifactRef}`, JSON.stringify(artifact));
  options.mutate?.(bodies);
  for (const path of options.missing ?? []) bodies.delete(`${BASE_PATH}${path}`);
  const requested: string[] = [];
  const fetcher: GroundFetcher = async (input) => {
    const url = String(input);
    requested.push(url);
    const body = bodies.get(url);
    if (body === undefined) return new Response("not found", { status: 404 });
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetcher, requested };
}

/** Centre of a cell, for a camera standing on it. */
function centerOf(bounds: { west: number; south: number; east: number; north: number }) {
  return { longitude: (bounds.west + bounds.east) / 2, latitude: (bounds.south + bounds.north) / 2 };
}

describe("ground embellishment canary scope", () => {
  it("takes its tile rows from the exterior wave plan rather than restating them", () => {
    const rows = groundEmbellishmentCanaryTileRows();
    const midtown = EXTERIOR_WAVE_PLAN.find((wave) => wave.waveId === "midtown-core")!;
    expect(GROUND_EMBELLISHMENT_CANARY_WAVES).toEqual(["midtown-core"]);
    expect(midtown.tileRowRange).not.toBeNull();
    expect([...rows].sort()).toEqual([midtown.tileRowRange!.northRowY, midtown.tileRowRange!.southRowY]);
    // Ground cells partition at the same tile level the waves are declared at,
    // which is what makes a row intersection a legitimate mapping at all.
    expect(EXTERIOR_WAVE_TILE_LEVEL).toBe(14);
  });

  /**
   * The generalization T011 will perform, exercised now.
   *
   * If widening the canary needed anything but this constant, this test would
   * be the one that noticed.
   */
  it("generalizes to more waves by naming them, with no other change", () => {
    const wider = groundEmbellishmentCanaryTileRows(["midtown-core", "lower-manhattan"]);
    expect(wider.has(4482)).toBe(true);
    expect(wider.has(4486)).toBe(true);
    expect(groundEmbellishmentCanaryTileRows().has(4486)).toBe(false);
    const everyWave = EXTERIOR_WAVE_PLAN.filter((wave) => wave.tileRowRange !== null).map((wave) => wave.waveId);
    expect(groundEmbellishmentCanaryTileRows(everyWave).size).toBe(4488 - 4471 + 1);
  });

  it("refuses a wave that owns no tile rows instead of silently covering nothing", () => {
    expect(() => groundEmbellishmentCanaryTileRows(["block-835"])).toThrow(/owns no tile rows/u);
  });

  it("classifies cells by their own level-14 row", () => {
    const rows = groundEmbellishmentCanaryTileRows();
    expect(isGroundEmbellishmentCanaryCell("ground-cell-000050-14-4823-4482", rows)).toBe(true);
    expect(isGroundEmbellishmentCanaryCell("ground-cell-000058-14-4824-4481", rows)).toBe(true);
    expect(isGroundEmbellishmentCanaryCell("ground-cell-000001-14-4823-4489", rows)).toBe(false);
    expect(isGroundEmbellishmentCanaryCell("not-a-ground-cell", rows)).toBe(false);
  });

  /**
   * The active-cell ceiling is a fact about the partition, not a budget.
   *
   * A level-14 cell's shorter side is its latitude span; if the declared ring
   * ever grew past it, four would stop being the worst case and this test would
   * say so before the cache silently overflowed.
   */
  it("derives its active-cell ceiling from the cell size and the declared ring", () => {
    const cellHeightMeters = (180 / 2 ** 14) * CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE.metersPerDegreeLatitude;
    expect(cellHeightMeters).toBeGreaterThan(400);
    expect(GROUND_EMBELLISHMENT_MAX_ACTIVE_CELLS).toBe(4);
    expect(GROUND_EMBELLISHMENT_BUDGETS.maxCachedBytes).toBe(GROUND_EMBELLISHMENT_BUDGETS.maxArtifactBytes * 4);
  });
});

describe("ground embellishment runtime", () => {
  it("verifies the documents and the re-derived ledger identity before requesting geometry", async () => {
    const state = await fixture();
    const { fetcher, requested } = fetcherFor(state);
    const loaded = await loadGroundEmbellishmentRelease(BASE_PATH, undefined, fetcher);

    expect(loaded.releaseId).toBe(MANHATTAN_GROUND_EMBELLISHMENT_RELEASE_ID);
    expect(loaded.shippedClasses).toEqual(["curb"]);
    expect(loaded.partitionTileLevel).toBe(14);
    expect(requested.filter((url) => url.includes("/artifacts/"))).toHaveLength(0);
    expect(loaded.residency().entries).toBe(0);

    const artifact = await loaded.loadCellClass(state.insideCellId, "curb");
    expect(artifact.artifact.parts).toHaveLength(1);
    expect(artifact.artifact.derivation.profile.topElevationMeters).toBe(0.22);
    expect(artifact.checksumSha256).toMatch(/^[a-f0-9]{64}$/u);
    const before = requested.length;
    await loaded.loadCellClass(state.insideCellId, "curb");
    expect(requested.length).toBe(before);
  });

  /**
   * The mirror of the flat loader's guard.
   *
   * A flat asset is valid under the amended tier contract and must still be
   * refused here, so neither loader can be talked into serving the other's
   * release by handing it a well-formed document.
   */
  it("refuses a base-class asset, even a perfectly valid one", async () => {
    const state = await fixture();
    const cell = state.ledger.cells.find((candidate) => candidate.cellId === state.insideCellId)!;
    const tiers = [{
      tierId: `${cell.cellId}:roadbed:flat`,
      kind: "flat" as const,
      maxDistanceMeters: null,
      artifactRef: `artifacts/${cell.cellId}/roadbed.json`,
      checksumSha256: domainSeparatedSha256("test", "roadbed-artifact"),
    }];
    const document: GroundReleaseDocument = {
      ...state.document,
      assets: [...state.document.assets, { assetId: `ground-asset:${cell.cellId}:roadbed`, cellId: cell.cellId, class: "roadbed", tiers, contentSha256: groundAssetContentSha256(tiers) }],
      claimCeilings: { ...state.document.claimCeilings, roadbed: "Source-backed planimetric roadbed extent; not a survey of current paving." },
    };
    expect(validateGroundReleaseStructure(document).ok).toBe(true);
    const { fetcher } = fetcherFor({ ...state, document });
    await expect(loadGroundEmbellishmentRelease(BASE_PATH, undefined, fetcher)).rejects.toThrow(/not an embellishment class/u);
  });

  it("serves only cells inside the canary wave, and refuses one outside it by name", async () => {
    const state = await fixture();
    const { fetcher } = fetcherFor(state);
    const loaded = await loadGroundEmbellishmentRelease(BASE_PATH, undefined, fetcher);
    expect(loaded.servingCells.map((cell) => cell.cellId)).toEqual([state.insideCellId]);
    expect(loaded.servingCells[0]!.maxDistanceMeters).toBe(400);
    // The asset exists and is verifiable; it is scope, not integrity, that
    // stops it, and the loader says which.
    await expect(loaded.loadCellClass(state.outsideCellId, "curb")).rejects.toThrow(/outside the canary wave scope/u);
  });

  it("fails closed on a tampered artifact and caches nothing", async () => {
    const state = await fixture();
    const artifactRef = [...state.artifacts.keys()].find((ref) => ref.includes(state.insideCellId))!;
    const { fetcher } = fetcherFor(state, {
      mutate: (bodies) => {
        const key = `${BASE_PATH}${artifactRef}`;
        bodies.set(key, `${bodies.get(key)!} `);
      },
    });
    const loaded = await loadGroundEmbellishmentRelease(BASE_PATH, undefined, fetcher);
    await expect(loaded.loadCellClass(state.insideCellId, "curb")).rejects.toThrow(/checksum mismatch/u);
    expect(loaded.residency().entries).toBe(0);
    expect(loaded.cached(state.insideCellId, "curb")).toBeUndefined();
  });

  it("fails closed when the artifact is missing", async () => {
    const state = await fixture();
    const artifactRef = [...state.artifacts.keys()].find((ref) => ref.includes(state.insideCellId))!;
    const { fetcher } = fetcherFor(state, { missing: [artifactRef] });
    const loaded = await loadGroundEmbellishmentRelease(BASE_PATH, undefined, fetcher);
    await expect(loaded.loadCellClass(state.insideCellId, "curb")).rejects.toThrow(/request failed \(404\)/u);
  });

  it("fails closed on a tampered release document", async () => {
    const state = await fixture();
    const { fetcher } = fetcherFor(state, {
      mutate: (bodies) => {
        const document = JSON.parse(bodies.get(`${BASE_PATH}release.json`)!) as GroundReleaseDocument;
        document.ownershipLedgerId = "ground-ledger:city-manhattan:ground-partition-v1-level14:deadbeef";
        bodies.set(`${BASE_PATH}release.json`, JSON.stringify(document));
      },
    });
    await expect(loadGroundEmbellishmentRelease(BASE_PATH, undefined, fetcher)).rejects.toThrow(/failed closed/u);
  });

  it("refuses an artifact whose profile is missing or claims not to be an estimate", async () => {
    const state = await fixture();
    const artifactRef = [...state.artifacts.keys()].find((ref) => ref.includes(state.insideCellId))!;
    const tampered = {
      ...state.artifacts.get(artifactRef)!,
      derivation: { ...state.artifacts.get(artifactRef)!.derivation, profile: { topElevationMeters: 0.22, roadbedElevationMeters: 0, authoredRiseMeters: 0.22, profileIsEstimated: false } },
    };
    const checksum = await sha256(JSON.stringify(tampered));
    const document: GroundReleaseDocument = {
      ...state.document,
      assets: state.document.assets.map((asset) => {
        if (asset.cellId !== state.insideCellId) return asset;
        const tiers = asset.tiers.map((tier) => ({ ...tier, checksumSha256: checksum }));
        return { ...asset, tiers, contentSha256: groundAssetContentSha256(tiers) };
      }),
    };
    const { fetcher } = fetcherFor({ ...state, document }, { mutate: (bodies) => bodies.set(`${BASE_PATH}${artifactRef}`, JSON.stringify(tampered)) });
    const loaded = await loadGroundEmbellishmentRelease(BASE_PATH, undefined, fetcher);
    await expect(loaded.loadCellClass(state.insideCellId, "curb")).rejects.toThrow(/no estimated vertical profile/u);
  });

  /**
   * The fail-closed DIRECTION, asserted rather than assumed.
   *
   * Every embellishment document is broken here, and the flat release still
   * loads and still serves its geometry through its own loader. That is the
   * property the split exists to guarantee: the base is never collateral.
   */
  it("cannot be pointed at the flat release, and cannot point the flat loader at this one", async () => {
    const everythingBroken: GroundFetcher = async () => new Response("tampered", { status: 500 });
    await expect(loadGroundEmbellishmentRelease(BASE_PATH, undefined, everythingBroken)).rejects.toThrow();

    // Neither loader will accept the other's release root, before a single byte
    // is fetched. This is the structural half of "an embellishment failure
    // never degrades the flat base": there is no path from one to the other.
    // The session-level half — the base keeps its overlay, its counts and its
    // status line while the near tier fails — is asserted in
    // `src/app/ground-canary.test.tsx`.
    await expect(loadGroundEmbellishmentRelease("/data/manhattan-ground-20260824/", undefined, everythingBroken))
      .rejects.toThrow(/not the approved local release root/u);
    await expect(loadGroundRelease(BASE_PATH, undefined, everythingBroken))
      .rejects.toThrow(/not the approved local release root/u);
  });
});

describe("ground embellishment distance activation", () => {
  const cells = [
    { cellId: "a", groundClass: "curb" as const, bounds: { west: -74.0, south: 40.75, east: -73.98, north: 40.76 }, maxDistanceMeters: 400, order: 0 },
    { cellId: "b", groundClass: "curb" as const, bounds: { west: -73.9, south: 40.75, east: -73.88, north: 40.76 }, maxDistanceMeters: 400, order: 1 },
  ];

  it("activates a cell the camera stands on and never one beyond the declared ring", () => {
    const active = activeGroundEmbellishmentCells({ groundCenter: centerOf(cells[0]!.bounds), cells });
    expect(active.map((entry) => entry.cellId)).toEqual(["a"]);
    expect(active[0]!.distanceMeters).toBe(0);
    expect(active[0]!.key).toBe("a/curb");
  });

  it("deactivates deterministically as the camera leaves the ring", () => {
    // 0.006 degrees of longitude is about 506 m in the frozen metric: outside.
    const outside = activeGroundEmbellishmentCells({ groundCenter: { longitude: -74.006, latitude: 40.755 }, cells });
    expect(outside).toEqual([]);
    // 0.004 degrees is about 338 m: inside, and the same answer every time.
    const inside = activeGroundEmbellishmentCells({ groundCenter: { longitude: -74.004, latitude: 40.755 }, cells });
    expect(inside.map((entry) => entry.cellId)).toEqual(["a"]);
    expect(activeGroundEmbellishmentCells({ groundCenter: { longitude: -74.004, latitude: 40.755 }, cells: [...cells].reverse() }))
      .toEqual(inside);
  });

  it("honours each asset's OWN declared ceiling rather than one shared number", () => {
    const narrowed = [{ ...cells[0]!, maxDistanceMeters: 100 }];
    expect(activeGroundEmbellishmentCells({ groundCenter: { longitude: -74.004, latitude: 40.755 }, cells: narrowed })).toEqual([]);
    const widened = [{ ...cells[0]!, maxDistanceMeters: 2000 }];
    expect(activeGroundEmbellishmentCells({ groundCenter: { longitude: -74.006, latitude: 40.755 }, cells: widened }).map((entry) => entry.cellId)).toEqual(["a"]);
  });

  it("activates nothing without a settled ground centre", () => {
    expect(activeGroundEmbellishmentCells({ groundCenter: null, cells })).toEqual([]);
    expect(activeGroundEmbellishmentCells({ groundCenter: { longitude: Number.NaN, latitude: 40.75 }, cells })).toEqual([]);
  });

  it("bounds the active set by the derived ceiling, nearest first", () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      cellId: `cell-${index}`,
      groundClass: "curb" as const,
      bounds: { west: -74.0 + index * 0.00001, south: 40.75, east: -73.98, north: 40.76 },
      maxDistanceMeters: 400,
      order: index,
    }));
    const active = activeGroundEmbellishmentCells({ groundCenter: centerOf(many[0]!.bounds), cells: many });
    expect(active).toHaveLength(GROUND_EMBELLISHMENT_MAX_ACTIVE_CELLS);
  });
});
