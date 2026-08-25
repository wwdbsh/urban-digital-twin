import { describe, expect, it } from "vitest";
import { domainSeparatedSha256 } from "../domain/deterministic-hash";
import type { GroundFeature } from "../domain/ground";
import {
  GROUND_PARTITION_SCHEME_ID,
  MANHATTAN_GROUND_CITY_ID,
  MANHATTAN_GROUND_CONFIG_ID,
  MANHATTAN_GROUND_EXTENT,
  buildGroundOwnershipLedger,
  groundAssetContentSha256,
  type GroundOwnershipLedger,
  type GroundReleaseDocument,
} from "../release/ground-release";
import {
  GROUND_ARTIFACT_SCHEMA_VERSION,
  GroundArtifactCache,
  MANHATTAN_GROUND_RELEASE_ID,
  groundCacheKey,
  loadGroundRelease,
  visibleGroundCellIds,
  type GroundCellArtifact,
  type GroundFetcher,
  type LoadedGroundCellArtifact,
} from "./ground-release-runtime";

const BASE_PATH = `/data/${MANHATTAN_GROUND_RELEASE_ID}/`;

async function sha256(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

function groundFeature(canonicalFeatureId: string, groundClass: "roadbed" | "park"): GroundFeature {
  return {
    canonicalFeatureId,
    cityId: MANHATTAN_GROUND_CITY_ID,
    class: groundClass,
    claimLevel: "source-backed",
    sourceRefs: [{
      schemaVersion: "1.0",
      id: `source-ref:${canonicalFeatureId}`,
      registryEntryId: "nyc.oti-planimetrics-roadbed-block835",
      provider: "NYC Office of Technology and Innovation (OTI) Planimetrics",
      datasetId: "xgwd-7vhd",
      sourceRecordId: "5350000758.0",
      sourceUrl: "https://data.cityofnewyork.us/resource/i36f-5ih7.geojson",
      licenseRefId: "nyc-open-data-terms",
      role: "primary",
      capturedAt: "2026-08-24T02:41:06.563Z",
      updatedAt: "2024-04-24T20:25:27.000Z",
      observedAt: "2026-08-24T02:41:06.563Z",
      release: null,
    }],
    uncertainty: { horizontalMeters: null, verticalMeters: null, temporal: "Rows updated 2024-04-24; not re-surveyed here." },
    identityOrigin: groundClass === "park"
      ? { kind: "referenced-existing", existingFeatureId: canonicalFeatureId }
      : { kind: "ground-owned" },
  };
}

/** A square inside one cell, closed, simple. */
function squareIn(bounds: { west: number; south: number; east: number; north: number }): number[][][][] {
  const west = bounds.west + (bounds.east - bounds.west) * 0.25;
  const east = bounds.west + (bounds.east - bounds.west) * 0.75;
  const south = bounds.south + (bounds.north - bounds.south) * 0.25;
  const north = bounds.south + (bounds.north - bounds.south) * 0.75;
  return [[[[west, south], [east, south], [east, north], [west, north], [west, south]]]];
}

interface Fixture {
  ledger: GroundOwnershipLedger;
  document: GroundReleaseDocument;
  features: GroundFeature[];
  parts: { partId: string; canonicalFeatureId: string; ownerCellId: string }[];
  artifacts: Map<string, GroundCellArtifact>;
  cellId: string;
}

/**
 * A real ledger over the real declared extent.
 *
 * The loader checks that the ownership ledger actually partitions
 * `MANHATTAN_GROUND_EXTENT` and that its id re-derives, so a fixture cannot
 * shortcut the partition — it has to be built by the same builder the release
 * was built by. That is the point: the test exercises the production binding
 * rather than a parallel one.
 */
async function fixture(): Promise<Fixture> {
  const roadbedId = "udt:ground:manhattan:roadbed:aaaaaaaaaaaaaaaa";
  const parkId = "udt:manhattan:park:M001";
  const features = [groundFeature(roadbedId, "roadbed"), groundFeature(parkId, "park")];
  // One occupied tile near the middle of the island, declared explicitly so the
  // fixture does not depend on envelope arithmetic.
  const tileKeys = ["wgs84-geodetic/14/4825/4483"];
  const build = buildGroundOwnershipLedger({
    cityId: MANHATTAN_GROUND_CITY_ID,
    configId: MANHATTAN_GROUND_CONFIG_ID,
    partitionSchemeId: GROUND_PARTITION_SCHEME_ID,
    extent: MANHATTAN_GROUND_EXTENT,
    baseIdentitySetId: "ground-identity:test",
    features,
    occupancy: features.map((feature) => ({ canonicalFeatureId: feature.canonicalFeatureId, occupancy: { kind: "declared-cells" as const, tileKeys } })),
  });
  const cell = build.ledger.cells.find((candidate) => candidate.partIds.length > 0)!;
  const artifacts = new Map<string, GroundCellArtifact>();
  const assets: GroundReleaseDocument["assets"] = [];
  for (const [groundClass, canonicalFeatureId] of [["roadbed", roadbedId], ["park", parkId]] as const) {
    const artifact: GroundCellArtifact = {
      schemaVersion: GROUND_ARTIFACT_SCHEMA_VERSION,
      releaseId: MANHATTAN_GROUND_RELEASE_ID,
      cellId: cell.cellId,
      class: groundClass,
      cellBounds: cell.bounds,
      coordinateDecimals: 7,
      partCount: 1,
      parts: [{
        partId: `${canonicalFeatureId}#${cell.cellId}`,
        canonicalFeatureId,
        clipped: false,
        geometry: { type: "MultiPolygon", coordinates: squareIn(cell.bounds) },
      }],
    };
    const artifactRef = `artifacts/${cell.cellId}/${groundClass}.json`;
    artifacts.set(artifactRef, artifact);
    const tiers = [{
      tierId: `${cell.cellId}:${groundClass}:flat`,
      kind: "flat" as const,
      maxDistanceMeters: null,
      artifactRef,
      checksumSha256: await sha256(JSON.stringify(artifact)),
    }];
    assets.push({ assetId: `ground-asset:${cell.cellId}:${groundClass}`, cellId: cell.cellId, class: groundClass, tiers, contentSha256: groundAssetContentSha256(tiers) });
  }
  const document: GroundReleaseDocument = {
    schemaVersion: "1.0",
    releaseId: MANHATTAN_GROUND_RELEASE_ID,
    cityId: MANHATTAN_GROUND_CITY_ID,
    configId: MANHATTAN_GROUND_CONFIG_ID,
    partitionSchemeId: GROUND_PARTITION_SCHEME_ID,
    ownershipLedgerId: build.ledger.ledgerId,
    generatedAt: "2026-08-24T12:00:00.000Z",
    immutable: true,
    sourceSnapshots: [{ datasetId: "xgwd-7vhd", rawSha256: domainSeparatedSha256("test", "snapshot"), sourceFeatureCount: 2 }],
    clip: {
      sourceExtent: { west: -74.1, south: 40.6, east: -73.8, north: 40.95 },
      clipBounds: build.ledger.coverage,
      bufferMeters: 0,
      rule: "Clipped per ownership cell by Sutherland-Hodgman with no buffer.",
    },
    geometryValidation: { method: "Shoelace about each ring's first vertex.", areaResidualToleranceRelative: 0.000001, maxObservedRelativeAreaError: 0, status: "pass" },
    assets,
    claimCeilings: {
      roadbed: "Source-backed planimetric roadbed extent; not a survey of current paving.",
      park: "Source-backed NYC Parks managed property; not a legal boundary.",
    },
    provenance: {
      sourceEpoch: "Rows updated 2024-04-24.",
      termsUrl: "https://opendata.cityofnewyork.us/overview/",
      attribution: "NYC Open Data.",
      disclaimer: "No warranty of completeness or fitness is made.",
      localOnly: true,
      runtimeExternalNetwork: false,
    },
    fallback: "Every asset declares one always-covering flat tier.",
  };
  return { ledger: build.ledger, document, features, parts: build.parts, artifacts, cellId: cell.cellId };
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

describe("ground release runtime", () => {
  it("verifies the documents, the re-derived ledger identity, and each artifact before drawing anything", async () => {
    const state = await fixture();
    const { fetcher, requested } = fetcherFor(state);
    const loaded = await loadGroundRelease(BASE_PATH, undefined, fetcher);

    expect(loaded.releaseId).toBe(MANHATTAN_GROUND_RELEASE_ID);
    expect(loaded.shippedClasses).toEqual(["roadbed", "park"]);
    expect(loaded.partitionTileLevel).toBe(14);
    // The manifest load fetches the four documents and NOT a single artifact.
    expect(requested.filter((url) => url.includes("/artifacts/"))).toHaveLength(0);
    expect(loaded.residency().entries).toBe(0);

    const artifact = await loaded.loadCellClass(state.cellId, "roadbed");
    expect(artifact.artifact.parts).toHaveLength(1);
    expect(artifact.checksumSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(loaded.residency().entries).toBe(1);
    // A second request is served from the cache rather than refetched.
    const before = requested.length;
    await loaded.loadCellClass(state.cellId, "roadbed");
    expect(requested.length).toBe(before);
  });

  it("fails closed when an artifact's bytes do not match the manifest checksum, and caches nothing", async () => {
    const state = await fixture();
    const artifactRef = [...state.artifacts.keys()].find((ref) => ref.endsWith("roadbed.json"))!;
    const { fetcher } = fetcherFor(state, {
      mutate: (bodies) => {
        const key = `${BASE_PATH}${artifactRef}`;
        bodies.set(key, `${bodies.get(key)!} `);
      },
    });
    const loaded = await loadGroundRelease(BASE_PATH, undefined, fetcher);
    await expect(loaded.loadCellClass(state.cellId, "roadbed")).rejects.toThrow(/checksum mismatch/u);
    expect(loaded.residency().entries).toBe(0);
    expect(loaded.cached(state.cellId, "roadbed")).toBeUndefined();
    // The sibling class is unaffected: one artifact fails, not the release.
    await expect(loaded.loadCellClass(state.cellId, "park")).resolves.toBeDefined();
  });

  it("fails closed when a per-cell artifact is missing", async () => {
    const state = await fixture();
    const artifactRef = [...state.artifacts.keys()].find((ref) => ref.endsWith("park.json"))!;
    const { fetcher } = fetcherFor(state, { missing: [artifactRef] });
    const loaded = await loadGroundRelease(BASE_PATH, undefined, fetcher);
    await expect(loaded.loadCellClass(state.cellId, "park")).rejects.toThrow(/request failed \(404\)/u);
  });

  it("refuses an artifact carrying a part its cell does not own", async () => {
    const state = await fixture();
    const artifactRef = [...state.artifacts.keys()].find((ref) => ref.endsWith("roadbed.json"))!;
    const tampered = { ...state.artifacts.get(artifactRef)!, parts: [{ ...state.artifacts.get(artifactRef)!.parts[0]!, partId: "udt:ground:manhattan:roadbed:aaaaaaaaaaaaaaaa#ground-cell-000000-14-4822-4489" }] };
    const checksum = await sha256(JSON.stringify(tampered));
    state.document.assets = state.document.assets.map((asset) => {
      if (asset.class !== "roadbed") return asset;
      const tiers = asset.tiers.map((tier) => ({ ...tier, checksumSha256: checksum }));
      return { ...asset, tiers, contentSha256: groundAssetContentSha256(tiers) };
    });
    const { fetcher } = fetcherFor(state, { mutate: (bodies) => bodies.set(`${BASE_PATH}${artifactRef}`, JSON.stringify(tampered)) });
    const loaded = await loadGroundRelease(BASE_PATH, undefined, fetcher);
    await expect(loaded.loadCellClass(state.cellId, "roadbed")).rejects.toThrow(/does not own/u);
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
    await expect(loadGroundRelease(BASE_PATH, undefined, fetcher)).rejects.toThrow(/failed closed/u);
  });

  it("fails closed when the ledger no longer re-derives its own identity", async () => {
    const state = await fixture();
    const { fetcher } = fetcherFor(state, {
      mutate: (bodies) => {
        const ledger = JSON.parse(bodies.get(`${BASE_PATH}ledger.json`)!) as GroundOwnershipLedger;
        // Legal by structure — the id is simply no longer the id these contents
        // produce, which is exactly the tamper a checksum-less file admits.
        ledger.configId = "config:manhattan-ground-forged";
        bodies.set(`${BASE_PATH}ledger.json`, JSON.stringify(ledger));
        const document = JSON.parse(bodies.get(`${BASE_PATH}release.json`)!) as GroundReleaseDocument;
        document.configId = ledger.configId;
        bodies.set(`${BASE_PATH}release.json`, JSON.stringify(document));
      },
    });
    await expect(loadGroundRelease(BASE_PATH, undefined, fetcher)).rejects.toThrow(/does not re-derive/u);
  });

  it("fails closed when features.json no longer matches the pinned identity checksum", async () => {
    const state = await fixture();
    const { fetcher } = fetcherFor(state, {
      mutate: (bodies) => {
        const features = JSON.parse(bodies.get(`${BASE_PATH}features.json`)!) as GroundFeature[];
        features[0]!.claimLevel = "estimated";
        bodies.set(`${BASE_PATH}features.json`, JSON.stringify(features));
      },
    });
    await expect(loadGroundRelease(BASE_PATH, undefined, fetcher)).rejects.toThrow(/failed closed/u);
  });

  it("refuses a base path that is not the approved local release root", async () => {
    const state = await fixture();
    const { fetcher } = fetcherFor(state);
    await expect(loadGroundRelease("/data/somewhere-else/", undefined, fetcher)).rejects.toThrow(/approved local release root/u);
  });
});

describe("ground visibility", () => {
  const coverage = { west: -74.0478515625, south: 40.67138671875, east: -73.89404296875, north: 40.89111328125 };
  const everyCell = (tileKey: string): string | undefined => {
    const parts = tileKey.split("/");
    return `ground-cell-000000-${parts[1]}-${parts[2]}-${parts[3]}`;
  };

  it("is deterministic for the same camera", () => {
    const bounds = { west: -74.01, south: 40.73, east: -73.96, north: 40.78 };
    const first = visibleGroundCellIds({ bounds, coverage, tileLevel: 14, cellIdForTileKey: everyCell });
    const second = visibleGroundCellIds({ bounds, coverage, tileLevel: 14, cellIdForTileKey: everyCell });
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
    expect(new Set(first).size).toBe(first.length);
  });

  it("returns nothing for a viewport that misses the coverage, and nothing for a wrapped one", () => {
    expect(visibleGroundCellIds({ bounds: { west: -0.2, south: 51.4, east: -0.1, north: 51.6 }, coverage, tileLevel: 14, cellIdForTileKey: everyCell })).toEqual([]);
    expect(visibleGroundCellIds({ bounds: { west: 179, south: 40.7, east: -179, north: 40.8 }, coverage, tileLevel: 14, cellIdForTileKey: everyCell })).toEqual([]);
  });

  it("bounds an island-wide camera to the ceiling, keeping the cells nearest the view centre", () => {
    const bounds = { west: -74.05, south: 40.67, east: -73.89, north: 40.89 };
    const capped = visibleGroundCellIds({ bounds, coverage, tileLevel: 14, cellIdForTileKey: everyCell, maxCells: 6 });
    expect(capped).toHaveLength(6);
    const uncapped = visibleGroundCellIds({ bounds, coverage, tileLevel: 14, cellIdForTileKey: everyCell, maxCells: 1_000 });
    expect(uncapped.length).toBeGreaterThan(capped.length);
    for (const cellId of capped) expect(uncapped).toContain(cellId);
  });

  it("skips tiles the release does not materialize", () => {
    const bounds = { west: -74.01, south: 40.73, east: -73.96, north: 40.78 };
    const empty = visibleGroundCellIds({ bounds, coverage, tileLevel: 14, cellIdForTileKey: () => undefined });
    expect(empty).toEqual([]);
  });
});

describe("ground artifact cache", () => {
  const entry = (bytes: number): LoadedGroundCellArtifact => ({
    artifact: { schemaVersion: GROUND_ARTIFACT_SCHEMA_VERSION, releaseId: MANHATTAN_GROUND_RELEASE_ID, cellId: "c", class: "roadbed", cellBounds: { west: 0, south: 0, east: 1, north: 1 }, coordinateDecimals: 7, partCount: 0, parts: [] },
    byteSize: bytes,
    checksumSha256: "a".repeat(64),
  });

  it("evicts only entries the camera cannot see", () => {
    const cache = new GroundArtifactCache(100);
    cache.set(groundCacheKey("cell-a", "roadbed"), entry(60));
    cache.set(groundCacheKey("cell-b", "roadbed"), entry(60));
    // `cell-b` is the visible one, so the older `cell-a` is the only candidate.
    const evicted = cache.retain(new Set([groundCacheKey("cell-b", "roadbed")]));
    expect(evicted).toBe(1);
    expect(cache.has(groundCacheKey("cell-b", "roadbed"))).toBe(true);
    expect(cache.has(groundCacheKey("cell-a", "roadbed"))).toBe(false);
    expect(cache.bytes()).toBe(60);
  });

  it("keeps an over-budget visible set rather than dropping what is on screen", () => {
    const cache = new GroundArtifactCache(100);
    cache.set(groundCacheKey("cell-a", "roadbed"), entry(60));
    cache.set(groundCacheKey("cell-b", "roadbed"), entry(60));
    const keep = new Set([groundCacheKey("cell-a", "roadbed"), groundCacheKey("cell-b", "roadbed")]);
    expect(cache.retain(keep)).toBe(0);
    expect(cache.size()).toBe(2);
  });
});
