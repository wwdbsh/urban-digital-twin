import { describe, expect, it } from "vitest";
import { exteriorCellSignature, exteriorOverlayRenderEntries, type ExteriorCellOverlay } from "./CesiumViewport";

const provenance = {
  inventoryId: "inventory:1",
  inventoryHashSha256: "a".repeat(64),
  evidenceShardId: "evidence:1",
  truthTiers: ["generated" as const],
  sourceDates: { capturedAt: null, updatedAt: null },
  predecessor: null,
  uncertainty: "Generated exterior geometry; not observed real-world truth.",
};

function asset(canonicalFeatureId: string, lodId = "lod-0", checksumSha256 = "b".repeat(64)) {
  return {
    canonicalFeatureId,
    ownerCellId: "c1",
    lodId,
    artifactRef: `public/assemblies/cell-c1-v2/assets/${lodId}.glb`,
    byteSize: 240,
    checksumSha256,
    bytes: new Uint8Array([1, 2, 3]),
    geometricErrorMeters: 0,
    maxDistanceMeters: null,
    provenance,
  };
}

function wave(releaseId: string, cellId: string, canonicalFeatureIds: readonly string[], origin: "default" | "canary" = "default"): ExteriorCellOverlay {
  return {
    releaseId,
    snapshotId: `snapshot:${releaseId}:v1`,
    origin,
    profile: "exploration",
    cells: [{
      kind: "rendered",
      cellId,
      cellReleaseId: `cell:${cellId}:v1`,
      cellReleaseVersion: "v1",
      assemblyPackageId: `assembly:cell:${cellId}:v1`,
      representation: "head",
      assets: canonicalFeatureIds.map((featureId) => asset(featureId)),
      notice: null,
    }],
  };
}

describe("exterior overlay release attribution rides on the entry", () => {
  it("stamps every entry of a single wave with that wave's release, snapshot, origin, and profile", () => {
    const only = wave("manhattan-exterior-cells-20260811", "cell:manhattan:block-835", ["doitt:778052", "doitt:982383"]);
    const entries = exteriorOverlayRenderEntries(only);
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.releaseId).toBe(only.releaseId);
      expect(entry.snapshotId).toBe(only.snapshotId);
      expect(entry.origin).toBe("default");
      expect(entry.profile).toBe("exploration");
    }
  });

  it("accepts one overlay and a set of overlays identically for a single wave", () => {
    const only = wave("manhattan-exterior-cells-20260811", "cell:manhattan:block-835", ["doitt:778052"]);
    expect(exteriorOverlayRenderEntries([only])).toEqual(exteriorOverlayRenderEntries(only));
    expect(exteriorOverlayRenderEntries([])).toEqual([]);
    expect(exteriorOverlayRenderEntries(null)).toEqual([]);
  });

  it("attributes each entry to the wave that shipped it, never to the leading wave", () => {
    const first = wave("release-one", "cell:one", ["doitt:111111"]);
    const second = wave("release-two", "cell:two", ["doitt:222222"], "canary");
    const entries = exteriorOverlayRenderEntries([first, second]);
    expect(entries).toHaveLength(2);
    const byFeature = new Map(entries.map((entry) => [entry.canonicalFeatureId, entry]));
    expect(byFeature.get("doitt:111111")!.releaseId).toBe("release-one");
    expect(byFeature.get("doitt:111111")!.origin).toBe("default");
    expect(byFeature.get("doitt:222222")!.releaseId).toBe("release-two");
    expect(byFeature.get("doitt:222222")!.snapshotId).toBe(second.snapshotId);
    expect(byFeature.get("doitt:222222")!.origin).toBe("canary");
  });

  it("treats a cell whose wave attribution changed as different scene state", () => {
    const before = exteriorOverlayRenderEntries(wave("release-one", "cell:one", ["doitt:111111"]));
    const after = exteriorOverlayRenderEntries(wave("release-two", "cell:one", ["doitt:111111"]));
    // Same cell id, same geometry bytes, different release: the entity
    // properties that carry the attribution have to be rebuilt.
    expect(after[0]!.entityId).toBe(before[0]!.entityId);
    expect(exteriorCellSignature(after)).not.toBe(exteriorCellSignature(before));
  });
});
