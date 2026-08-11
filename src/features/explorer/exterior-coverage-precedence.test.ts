/**
 * Issue #41: Block 835 buildings were drawn twice — once as verified exterior
 * geometry from the wave, and once again underneath it as the pilot asset model
 * or the procedural extrusion. These tests pin the single precedence rule the
 * viewport's draw paths now share, and the two properties that rule must not
 * break: coverage fails open to the base, and nothing about non-exterior
 * selection changes.
 */
import { describe, expect, it } from "vitest";
import {
  denseFeatureRenderOwner,
  exteriorCoveredCanonicalFeatureIds,
  exteriorSelectionSilhouetteSize,
  EXTERIOR_SELECTION_SILHOUETTE_SIZE_PIXELS,
  type ExteriorCellOverlay,
} from "./CesiumViewport";

const provenance = {
  inventoryId: "inventory:1",
  inventoryHashSha256: "a".repeat(64),
  evidenceShardId: "evidence:1",
  truthTiers: ["generated" as const],
  sourceDates: { capturedAt: null, updatedAt: null },
  predecessor: null,
  uncertainty: "Generated exterior geometry; not observed real-world truth.",
};

function asset(canonicalFeatureId: string) {
  return {
    canonicalFeatureId,
    ownerCellId: "cell:manhattan:block-835",
    lodId: "lod-0",
    artifactRef: "public/assemblies/cell-block-835-v2/assets/lod-0.glb",
    byteSize: 240,
    checksumSha256: "b".repeat(64),
    bytes: new Uint8Array([1, 2, 3]),
    geometricErrorMeters: 0,
    maxDistanceMeters: null,
    provenance,
  };
}

function renderedWave(canonicalFeatureIds: readonly string[]): ExteriorCellOverlay {
  return {
    releaseId: "manhattan-exterior-cells-20260811",
    snapshotId: "snapshot:manhattan-exterior-cells-20260811:v1",
    origin: "default",
    profile: "exploration",
    cells: [{
      kind: "rendered",
      cellId: "cell:manhattan:block-835",
      cellReleaseId: "cell:block-835:v1",
      cellReleaseVersion: "v1",
      assemblyPackageId: "assembly:cell:block-835:v1",
      representation: "head",
      assets: canonicalFeatureIds.map(asset),
      notice: null,
    }],
  };
}

function failedWave(): ExteriorCellOverlay {
  return {
    releaseId: "manhattan-exterior-cells-20260811",
    snapshotId: "snapshot:manhattan-exterior-cells-20260811:v1",
    origin: "default",
    profile: "exploration",
    cells: [{
      kind: "failed",
      cellId: "cell:manhattan:block-835",
      cellReleaseId: "cell:block-835:v1",
      code: "cell-release-missing",
      message: "Cell release is absent from the public release graph.",
      notice: "Exterior cell failed verification; no exterior geometry is shown for it.",
    }],
  };
}

const PILOT_IDS = new Set(["doitt:778052", "doitt:982383"]);

describe("exterior coverage fails open to the base representation", () => {
  it("covers nothing when the only cell of the wave failed verification", () => {
    const covered = exteriorCoveredCanonicalFeatureIds(failedWave());
    expect(covered.size).toBe(0);
    // With no coverage the building falls back to exactly what it drew before:
    // the pilot asset, or the procedural extrusion when there is no asset.
    expect(denseFeatureRenderOwner("doitt:778052", covered, PILOT_IDS)).toBe("pilot-asset");
    expect(denseFeatureRenderOwner("doitt:584049", covered, PILOT_IDS)).toBe("procedural-extrusion");
  });

  it("covers nothing when there is no exterior wave at all", () => {
    expect(exteriorCoveredCanonicalFeatureIds(null).size).toBe(0);
    expect(exteriorCoveredCanonicalFeatureIds(undefined).size).toBe(0);
    expect(exteriorCoveredCanonicalFeatureIds([]).size).toBe(0);
  });

  it("drops coverage for exactly the cell that failed and keeps the rest", () => {
    const mixed: ExteriorCellOverlay = {
      ...renderedWave(["doitt:778052"]),
      cells: [...renderedWave(["doitt:778052"]).cells, ...failedWave().cells.map((cell) => ({ ...cell, cellId: "cell:manhattan:other" }))],
    };
    const covered = exteriorCoveredCanonicalFeatureIds(mixed);
    expect([...covered]).toEqual(["doitt:778052"]);
  });
});

describe("draw precedence is exterior wave over pilot asset over procedural extrusion", () => {
  it("gives the exterior wave a building that is also in the pilot asset set", () => {
    // The Block 835 duplicate: `doitt:778052` is resolvable as a pilot asset AND
    // shipped by the wave. Exactly one path may draw it.
    const covered = exteriorCoveredCanonicalFeatureIds(renderedWave(["doitt:778052"]));
    expect(denseFeatureRenderOwner("doitt:778052", covered, PILOT_IDS)).toBe("exterior-wave");
  });

  it("gives the pilot asset a building the wave does not ship", () => {
    const covered = exteriorCoveredCanonicalFeatureIds(renderedWave(["doitt:778052"]));
    expect(denseFeatureRenderOwner("doitt:982383", covered, PILOT_IDS)).toBe("pilot-asset");
  });

  it("leaves every other building on the procedural extrusion path", () => {
    const covered = exteriorCoveredCanonicalFeatureIds(renderedWave(["doitt:778052"]));
    expect(denseFeatureRenderOwner("doitt:131170", covered, PILOT_IDS)).toBe("procedural-extrusion");
    expect(denseFeatureRenderOwner("doitt:131170", new Set(), new Set())).toBe("procedural-extrusion");
  });

  it("assigns exactly one owner to every building", () => {
    const covered = exteriorCoveredCanonicalFeatureIds(renderedWave(["doitt:778052", "doitt:982383"]));
    const owners = ["doitt:778052", "doitt:982383", "doitt:584049"].map((id) => denseFeatureRenderOwner(id, covered, PILOT_IDS));
    expect(owners).toEqual(["exterior-wave", "exterior-wave", "procedural-extrusion"]);
  });
});

describe("exterior selection feedback", () => {
  it("silhouettes only the selected exterior building", () => {
    expect(exteriorSelectionSilhouetteSize("doitt:778052", "doitt:778052")).toBe(EXTERIOR_SELECTION_SILHOUETTE_SIZE_PIXELS);
    expect(exteriorSelectionSilhouetteSize("doitt:982383", "doitt:778052")).toBe(0);
  });

  it("leaves non-exterior selections untouched", () => {
    // Selecting a station, a storefront proxy, or nothing at all must clear the
    // silhouette on every exterior entity rather than style one of them.
    for (const selection of [null, undefined, "station:R16", "commercial-storefront:s-1"]) {
      expect(exteriorSelectionSilhouetteSize("doitt:778052", selection)).toBe(0);
    }
  });

  it("does not change which path draws a building when the selection changes", () => {
    const covered = exteriorCoveredCanonicalFeatureIds(renderedWave(["doitt:778052"]));
    const before = denseFeatureRenderOwner("doitt:778052", covered, PILOT_IDS);
    expect(exteriorSelectionSilhouetteSize("doitt:778052", "doitt:778052")).toBeGreaterThan(0);
    expect(denseFeatureRenderOwner("doitt:778052", covered, PILOT_IDS)).toBe(before);
  });
});
