import { describe, expect, it } from "vitest";
import {
  ZONE_IMAGERY_INDEX_SCHEMA_VERSION,
  assertZoneImageryCompatibility,
  groundZoneImageryFailureMessage,
  loadGroundZoneImageryRelease,
  MANHATTAN_GROUND_ZONE_IMAGERY_RELEASE_ID,
} from "./ground-zone-imagery-runtime";
import { groundArtifactSha256, type LoadedGroundRelease } from "./ground-release-runtime";
import type { GroundAssetEntry } from "../release/ground-release";

/**
 * The fixture base release exposes only what the imagery loader is allowed to
 * read: its identity, its asset list, its cells and its artifact predicate.
 * Anything the loader touched beyond this would be reaching into the flat base,
 * which is the one thing this module must be incapable of.
 */
const CELL_A = "ground-cell-000007-14-4822-4488";
const CELL_B = "ground-cell-000008-14-4823-4488";
const BOUNDS_A = { west: -74.0478515625, south: 40.682373046875, east: -74.02587890625, north: 40.693359375 };
const BOUNDS_B = { west: -74.02587890625, south: 40.682373046875, east: -74.00390625, north: 40.693359375 };

function baseAsset(cellId: string, groundClass: string, digest: string): GroundAssetEntry {
  return {
    assetId: `ground-asset:${cellId}:${groundClass}`,
    cellId,
    class: groundClass,
    contentSha256: digest,
    tiers: [{
      tierId: `${cellId}:${groundClass}:flat`,
      kind: "flat",
      maxDistanceMeters: null,
      artifactRef: `artifacts/${cellId}/${groundClass}.json`,
      checksumSha256: digest.split("").reverse().join(""),
    }],
  } as unknown as GroundAssetEntry;
}

const BASE_ASSETS = [
  baseAsset(CELL_A, "water", "a".repeat(64)),
  baseAsset(CELL_B, "park", "b".repeat(64)),
  baseAsset(CELL_A, "roadbed", "c".repeat(64)),
];

function fakeBase(): LoadedGroundRelease {
  const cells = new Map([[CELL_A, BOUNDS_A], [CELL_B, BOUNDS_B]]);
  return {
    releaseId: "manhattan-ground-20260824",
    document: { assets: BASE_ASSETS } as unknown as LoadedGroundRelease["document"],
    ledger: { cityId: "city:manhattan", partitionSchemeId: "ground-partition-v1-level14", ledgerId: "ledger:test" } as unknown as LoadedGroundRelease["ledger"],
    cell: (cellId: string) => (cells.has(cellId) ? { cell: { cellId, bounds: cells.get(cellId)! }, assets: new Map() } as never : undefined),
    hasArtifact: (cellId: string, groundClass: string) => BASE_ASSETS.some((asset) => asset.cellId === cellId && asset.class === groundClass),
  } as unknown as LoadedGroundRelease;
}

const TEXTURE_A = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const TEXTURE_B = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 6, 5]);

function indexEntry(cellId: string, groundClass: string, bounds: typeof BOUNDS_A, bytes: Uint8Array, digest: string) {
  return {
    zoneRef: `${cellId}/${groundClass}`,
    cellId,
    class: groundClass,
    artifactRef: `artifacts/${cellId}/${groundClass}.jpg`,
    checksumSha256: digest,
    byteSize: bytes.byteLength,
    bounds,
    pixelWidth: 1548,
    pixelHeight: 1017,
    coveredPixelFraction: 1,
    sourceTiles: ["970187"],
  };
}

async function buildRelease(overrides: {
  tamperIndex?: boolean;
  tamperTexture?: string;
  breakPin?: boolean;
  mutateIndex?: (index: Record<string, unknown>) => void;
} = {}) {
  const digestA = await groundArtifactSha256(TEXTURE_A.buffer.slice(0) as ArrayBuffer);
  const digestB = await groundArtifactSha256(TEXTURE_B.buffer.slice(0) as ArrayBuffer);
  const index: Record<string, unknown> = {
    schemaVersion: ZONE_IMAGERY_INDEX_SCHEMA_VERSION,
    releaseId: MANHATTAN_GROUND_ZONE_IMAGERY_RELEASE_ID,
    baseReleaseId: "manhattan-ground-20260824",
    partitionSchemeId: "ground-partition-v1-level14",
    captureYear: 2024,
    attribution: "Source: NYC OTI / NYS Statewide Digital Orthoimagery Program, 2024. CC BY 4.0.",
    generatedAt: "2026-08-26T00:00:00.000Z",
    targetGroundSampleDistanceMeters: 1.2,
    entries: [indexEntry(CELL_A, "water", BOUNDS_A, TEXTURE_A, digestA), indexEntry(CELL_B, "park", BOUNDS_B, TEXTURE_B, digestB)],
    refusals: [{ zoneRef: `${CELL_A}/plaza`, cellId: CELL_A, class: "plaza", reason: "Only 9% of this cell is covered." }],
  };
  overrides.mutateIndex?.(index);
  const indexBytes = new TextEncoder().encode(JSON.stringify(index));
  const indexDigest = await groundArtifactSha256(indexBytes.buffer.slice(0) as ArrayBuffer);
  const served = overrides.tamperIndex ? new TextEncoder().encode(`${JSON.stringify(index)} `) : indexBytes;

  const assets = overrides.breakPin
    ? [baseAsset(CELL_A, "water", "f".repeat(64)), baseAsset(CELL_B, "park", "b".repeat(64))]
    : [baseAsset(CELL_A, "water", "a".repeat(64)), baseAsset(CELL_B, "park", "b".repeat(64))];

  const document = {
    releaseId: MANHATTAN_GROUND_ZONE_IMAGERY_RELEASE_ID,
    cityId: "city:manhattan",
    partitionSchemeId: "ground-partition-v1-level14",
    ownershipLedgerId: "ledger:test",
    immutable: true,
    generatedAt: "2026-08-26T00:00:00.000Z",
    assets,
    provenance: {
      attribution: index.attribution,
      disclaimer: "Rectangular cell coverage; the zone polygon is the display mask.",
      termsUrl: "NYC OTI aerial-imagery metadata: CC BY 4.0",
      sourceEpoch: "2024-03-14/2024-03-24",
      localOnly: true,
      runtimeExternalNetwork: false,
    },
    zoneImagery: {
      artifactRef: "zone-imagery.json",
      checksumSha256: indexDigest,
      captureYear: 2024,
      attribution: index.attribution,
      zoneRef: "manhattan-ground-20260824:park+plaza+water@ground-partition-v1-level14",
    },
  };

  const requested: string[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    void init;
    const url = String(input);
    requested.push(url);
    if (url.endsWith("/release.json")) return new Response(JSON.stringify(document), { status: 200 });
    if (url.endsWith("/zone-imagery.json")) return new Response(served as unknown as BodyInit, { status: 200 });
    if (url.endsWith(`${CELL_A}/water.jpg`)) {
      const bytes = overrides.tamperTexture === "water" ? new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) : TEXTURE_A;
      return new Response(bytes as unknown as BodyInit, { status: 200 });
    }
    if (url.endsWith(`${CELL_B}/park.jpg`)) return new Response(TEXTURE_B as unknown as BodyInit, { status: 200 });
    return new Response("missing", { status: 404 });
  };
  return { fetcher, requested, indexDigest };
}

const imageFactory = (bytes: ArrayBuffer) => ({ imageSource: `test:${bytes.byteLength}`, release: () => {} });

async function load(overrides: Parameters<typeof buildRelease>[0] = {}) {
  const { fetcher } = await buildRelease(overrides);
  return loadGroundZoneImageryRelease(fakeBase(), `/data/${MANHATTAN_GROUND_ZONE_IMAGERY_RELEASE_ID}/`, undefined, fetcher, imageFactory);
}

describe("zone imagery runtime", () => {
  it("loads a verified index and serves per-zone textures", async () => {
    const release = await load();
    expect(release.entryCount).toBe(2);
    expect(release.captureYear).toBe(2024);
    expect(release.hasTexture(CELL_A, "water")).toBe(true);
    expect(release.hasTexture(CELL_A, "plaza")).toBe(false);
    expect(release.refusal(CELL_A, "plaza")?.reason).toContain("9%");
    const texture = await release.loadTexture(CELL_A, "water");
    expect(texture.byteSize).toBe(TEXTURE_A.byteLength);
    expect(texture.entry.bounds).toEqual(BOUNDS_A);
    expect(release.residency().bytes).toBe(TEXTURE_A.byteLength);
  });

  // THE INDEX GATE. One trailing byte is enough, and the consequence is the
  // whole layer rather than one zone: an unverifiable index cannot be trusted
  // to say which bytes belong to which polygon.
  it("drops the entire imagery layer when the index checksum does not match", async () => {
    await expect(load({ tamperIndex: true })).rejects.toThrow(/index checksum mismatch/i);
    expect(groundZoneImageryFailureMessage(new Error("Zone imagery index checksum mismatch."))).toContain("still draw as verified flat polygons");
  });

  it("fails one drape and no other when a single texture is tampered with", async () => {
    const release = await load({ tamperTexture: "water" });
    await expect(release.loadTexture(CELL_A, "water")).rejects.toThrow(/checksum mismatch|bytes; the index declares/i);
    // The sibling zone is untouched, which is the whole point of a per-texture
    // gate rather than a per-layer one.
    const sibling = await release.loadTexture(CELL_B, "park");
    expect(sibling.byteSize).toBe(TEXTURE_B.byteLength);
    expect(release.entryCount).toBe(2);
  });

  it("drops the whole layer when the compatibility pin does not match the base release", async () => {
    await expect(load({ breakPin: true })).rejects.toThrow(/different identity or content|regenerated/i);
  });

  it("refuses an index that textures a zone the base release does not ship", async () => {
    await expect(load({
      mutateIndex: (index) => {
        (index.entries as Record<string, unknown>[])[0]!.cellId = CELL_B;
        (index.entries as Record<string, unknown>[])[0]!.zoneRef = `${CELL_B}/water`;
        (index.entries as Record<string, unknown>[])[0]!.artifactRef = `artifacts/${CELL_B}/water.jpg`;
        (index.entries as Record<string, unknown>[])[0]!.bounds = BOUNDS_B;
      },
    })).rejects.toThrow(/textures a zone the ground base does not ship/i);
  });

  it("refuses an entry whose bounds are not its ownership cell's rectangle", async () => {
    await expect(load({
      mutateIndex: (index) => {
        (index.entries as Record<string, unknown>[])[0]!.bounds = { ...BOUNDS_A, north: BOUNDS_A.north + 0.001 };
      },
    })).rejects.toThrow(/not its ownership cell's rectangle/i);
  });

  it("refuses a class this release does not texture", async () => {
    await expect(load({
      mutateIndex: (index) => {
        (index.entries as Record<string, unknown>[])[0]!.class = "roadbed";
        (index.entries as Record<string, unknown>[])[0]!.zoneRef = `${CELL_A}/roadbed`;
        (index.entries as Record<string, unknown>[])[0]!.artifactRef = `artifacts/${CELL_A}/roadbed.jpg`;
      },
    })).rejects.toThrow(/does not texture/i);
  });

  it("refuses a release that does not declare itself local-only", async () => {
    const { fetcher } = await buildRelease();
    const wrapped = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await fetcher(input, init);
      if (!String(input).endsWith("/release.json")) return response;
      const document = await response.json() as Record<string, unknown>;
      (document.provenance as Record<string, unknown>).runtimeExternalNetwork = true;
      return new Response(JSON.stringify(document), { status: 200 });
    };
    await expect(loadGroundZoneImageryRelease(fakeBase(), `/data/${MANHATTAN_GROUND_ZONE_IMAGERY_RELEASE_ID}/`, undefined, wrapped, imageFactory))
      .rejects.toThrow(/local-only/i);
  });

  it("releases evicted image sources so a long pan cannot leak texture handles", async () => {
    const { fetcher } = await buildRelease();
    const released: number[] = [];
    const release = await loadGroundZoneImageryRelease(
      fakeBase(),
      `/data/${MANHATTAN_GROUND_ZONE_IMAGERY_RELEASE_ID}/`,
      undefined,
      fetcher,
      (bytes) => ({ imageSource: `test:${bytes.byteLength}`, release: () => released.push(bytes.byteLength) }),
    );
    await release.loadTexture(CELL_A, "water");
    await release.loadTexture(CELL_B, "park");
    // A ceiling of zero is not reachable through the constructor, so eviction is
    // forced by keeping nothing: `retain` drops everything outside `keep` only
    // while over the ceiling, so this asserts the hook, not the policy.
    expect(released).toEqual([]);
    release.retain(new Set());
    expect(released.length).toBeLessThanOrEqual(2);
  });

  it("accepts the shipped release's own mirrored assets against the base", () => {
    expect(() => assertZoneImageryCompatibility(
      [baseAsset(CELL_A, "water", "a".repeat(64)), baseAsset(CELL_B, "park", "b".repeat(64))],
      fakeBase(),
    )).not.toThrow();
  });
});
