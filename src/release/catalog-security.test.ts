import { describe, expect, it } from "vitest";
import { buildCatalogRelease, validateCatalogRelease, validatePublishedFileMap } from "./catalog-release.ts";
import { buildSyntheticCatalogArtifacts } from "./fixtures.ts";
import { normalizeLocalReleaseReference } from "../runtime/path-security.ts";

const release = buildCatalogRelease(buildSyntheticCatalogArtifacts("v1"), { releaseVersion: "security-fixture", generatedAt: "2026-08-03T00:00:00Z", fixtureOnly: true });

describe("catalog release reference security", () => {
  it("rejects absolute, URL, backslash, empty, dot and traversal references", () => {
    for (const value of ["../escape.json", "/tmp/escape.json", "file:///tmp/escape.json", "layers\\tile.json", "layers//tile.json", "layers/./tile.json", "layers/../tile.json", "./tile.json", "tile.json/"]) expect(normalizeLocalReleaseReference(value)).toBeNull();
    expect(normalizeLocalReleaseReference("layers/buildings/tile.json")).toBe("layers/buildings/tile.json");
  });

  it("deep-validates partitions, maps, checksums and duplicate refs before iteration", () => {
    const unsafePartition = { ...release, partitions: [{ ...release.partitions[0], relativeContentRef: "../escape.json" }] };
    expect(validateCatalogRelease(unsafePartition).ok).toBe(false);
    const duplicatePartition = { ...release, partitions: release.partitions.map((partition, index) => index === 1 ? { ...partition, relativeContentRef: release.partitions[0]!.relativeContentRef } : partition) };
    expect(validateCatalogRelease(duplicatePartition).ok).toBe(false);
    expect(validatePublishedFileMap({ "layers/tile.json": "not-a-sha" }).ok).toBe(false);
    expect(validatePublishedFileMap({ "layers//tile.json": "a".repeat(64) }).ok).toBe(false);
    expect(validateCatalogRelease({ ...release, partitions: [{}] }).ok).toBe(false);
  });
});
