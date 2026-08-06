import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BLOCK_835_DOITT_IDS } from "../domain/commercial-frontage";

interface RawManifest {
  immutable: boolean;
  membership: { parentCount: number; partCount: number; doittIds: string[] };
  reusedInputs: Array<{ datasetId: string; sha256: string }>;
}

interface AttemptLineage {
  first: { status: number };
  second: { reason: string };
  third: { status: number; querySha256: string; sha256: string };
}

interface NormalizedManifest {
  replay: { deterministic: boolean; stableSerializer: string };
  partitionIds: string[];
}

interface SourcePacket {
  counts: Record<string, number>;
  licensePartitions: Array<{ partitionId: string; license: string; attribution?: string; licenseUrl?: string }>;
}

function readJson<T>(path: string): T {
  return JSON.parse(new TextDecoder().decode(readFileSync(path))) as T;
}

const rawRoot = "data/raw/manhattan-esb-block-commercial-20260805";
const normalizedRoot = "data/normalized/manhattan-esb-block-commercial-20260805";

describe("Stage 3 commercial snapshot replay", () => {
  it("keeps immutable acquisition lineage, exact block membership, and source hashes", () => {
    const raw = readJson<RawManifest>(`${rawRoot}/manifest.json`);
    const attempts = readJson<AttemptLineage>(`${rawRoot}/osm/attempts.json`);
    expect(raw.immutable).toBe(true);
    expect(raw.membership.parentCount).toBe(14);
    expect(raw.membership.partCount).toBe(14);
    expect(raw.membership.doittIds).toEqual([...BLOCK_835_DOITT_IDS]);
    expect(raw.reusedInputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ datasetId: "jh45-qr5r", sha256: "52c841e388f8e56e6e3666d2ce8b6436ec10f9eeb2bbcad2b2452b51d58dafc7" }),
      expect.objectContaining({ datasetId: "43nn-pn8j", sha256: "cb4cb6fce7a3744672882e63f2d3542674d7f76334d1a8aa2a7bfa76bd48b627" }),
    ]));
    expect(attempts.first.status).toBe(504);
    expect(attempts.second.reason).toBe("response-size-limit");
    expect(attempts.third.status).toBe(200);
    expect(attempts.third.querySha256).toBe("ce61419f88fe87c2344cf45ecf1766a5a3d404c15f30c8903ea65a2dc28056e7");
    expect(attempts.third.sha256).toBe("ed7acab3fd48105e718b1a6e734a3c3ac31320a62bff6b229c5c0691f0f7219e");
  });

  it("replays normalized counts and keeps NYC and ODbL partitions explicit", () => {
    const manifest = readJson<NormalizedManifest>(`${normalizedRoot}/manifest.json`);
    const packet = readJson<SourcePacket>(`${normalizedRoot}/source-packet.json`);
    expect(manifest.replay).toEqual(expect.objectContaining({ deterministic: true, stableSerializer: "stableCommercialJson-v1" }));
    expect(manifest.partitionIds).toEqual(["nyc-independent", "odbl-derived"]);
    expect(packet.counts).toEqual(expect.objectContaining({
      observations: 236,
      acceptedTenantBuildingLinks: 164,
      metadataOnlyLinks: 0,
      ambiguousLinks: 0,
      rejectedLinks: 72,
      acceptedStorefronts: 8,
      metadataOnlyStorefronts: 144,
      unknownStorefronts: 72,
      ambiguousStorefronts: 12,
      rejectedOrUnmatched: 72,
    }));
    expect(packet.licensePartitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ partitionId: "nyc-independent", license: "nyc-open-data-terms" }),
      expect.objectContaining({ partitionId: "odbl-derived", license: "ODbL-1.0", attribution: "Map data © OpenStreetMap contributors.", licenseUrl: "https://www.openstreetmap.org/copyright" }),
    ]));
  });
});
