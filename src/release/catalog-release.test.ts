import { describe, expect, it } from "vitest";
import { getSourceRegistryEntry } from "../data/source-registry.ts";
import { syntheticReconciliationObservations } from "../domain/reconciliation-fixtures.ts";
import { buildCatalogRelease, cityTilePackageForRelease, makeSyntheticSourceArtifact, deterministicFingerprint, partitionContentBytes, sha256HexSync, validateCatalogArtifacts, validateCatalogTileCoverage, validateSourceArtifact } from "./catalog-release.ts";
import { buildSyntheticCatalogArtifacts } from "./fixtures.ts";

const options = { releaseVersion: "fixture-v1", generatedAt: "2026-08-03T00:00:00Z", fixtureOnly: true } as const;

describe("catalog release assembly", () => {
  it("builds deterministic city scope, partitions, indexes, lineage and journal", () => {
    const artifacts = buildSyntheticCatalogArtifacts("v1");
    const first = buildCatalogRelease(artifacts, options);
    const second = buildCatalogRelease(buildSyntheticCatalogArtifacts("v1"), options);
    expect(first.releaseId).toBe(second.releaseId);
    expect(deterministicFingerprint(first.partitions)).toBe(deterministicFingerprint(second.partitions));
    expect(first.cityId).toBe("manhattan");
    expect(first.scope.coverageClaim).toBe("vertical-slice");
    expect(first.outputCrs).toBe("EPSG:4326");
    expect(first.partitions.length).toBeGreaterThan(0);
    expect(first.partitions.every((partition) => partition.lods.length === 1 && partition.lods[0] === 12)).toBe(true);
    expect(first.tileCoverage.lods).toEqual([12]);
    expect(validateCatalogTileCoverage(first, cityTilePackageForRelease(first))).toEqual({ ok: true });
    expect(first.searchIndex.byToken["fixture"]?.length).toBeGreaterThan(0);
    expect(first.searchIndex.bySourceIdentifier["fixture-poi-001"]?.length).toBeGreaterThan(0);
    expect(first.searchIndex.byToken["restaurant"]?.length).toBeGreaterThan(0);
    expect(first.searchIndex.byToken["100"]?.length).toBeGreaterThan(0);
    expect(first.searchIndex.byToken["카페"]?.length).toBeGreaterThan(0);
    expect(first.searchIndex.bySourceIdentifier["fixture.local.manhattan-slice"]?.length).toBeGreaterThan(0);
    expect(first.searchIndex.bySourceIdentifier["fixture-observation-coffee-primary"]?.length).toBeGreaterThan(0);
    expect(first.searchIndex.bySourceIdentifier.restaurant).toBeUndefined();
    expect(first.searchIndex.bySourceIdentifier["100"]).toBeUndefined();
    expect(first.relationshipIndex.relationshipCount).toBe(2);
    expect(first.buildJournal.status).toBe("staged");
    expect(sha256HexSync("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    const partition = first.partitions[0]!; const bytes = partitionContentBytes(first, partition);
    expect(sha256HexSync(bytes)).toBe(partition.checksumSha256);
    expect(new TextEncoder().encode(bytes).byteLength).toBe(partition.byteSize);
    expect(first.entitySnapshots.find((snapshot) => snapshot.featureId && snapshot.canonicalId !== snapshot.featureId)?.tileKeys.length).toBeGreaterThan(0);
    expect(first.buildJournal.immutable).toBe(true);
  });

  it("diffs additions, modifications and explicit tombstones without treating omission as deletion", () => {
    const first = buildCatalogRelease(buildSyntheticCatalogArtifacts("v1"), options);
    const second = buildCatalogRelease(buildSyntheticCatalogArtifacts("v2"), { ...options, releaseVersion: "fixture-v2", generatedAt: "2026-08-04T00:00:00Z", previousRelease: first });
    expect(second.releaseDiff?.fromReleaseId).toBe(first.releaseId);
    expect(second.releaseDiff?.addedCount).toBeGreaterThan(0);
    expect(second.releaseDiff?.modifiedCount).toBeGreaterThan(0);
    expect(second.releaseDiff?.tombstonedCount).toBe(1);
    expect(second.releaseDiff?.removedCount).toBe(0);
    expect(second.releaseDiff?.affectedTileKeys.length).toBeGreaterThan(0);
    const omissionId = buildSyntheticCatalogArtifacts("v1").flatMap((artifact) => artifact.features).find((feature) => feature.id.endsWith("fixture-attraction-001"))?.id;
    expect(omissionId).toBeTruthy();
    expect(second.releaseDiff?.entries.some((entry) => entry.canonicalId === omissionId && entry.status === "removed")).toBe(false);
  });

  it("rejects pending sources, incompatible scope/CRS, missing provenance, duplicates and corrupt relationships", () => {
    const valid = buildSyntheticCatalogArtifacts("v1")[0]!;
    const pending = { ...valid, artifactId: "pending", sourceRegistryEntryIds: ["overture.places"], sourceLicenses: [] };
    expect(validateSourceArtifact(pending).ok).toBe(false);
    expect(getSourceRegistryEntry("overture.places")?.approval.state).toBe("pending");
    expect(validateCatalogArtifacts([{ ...valid, artifactId: "wrong-crs", outputCrs: "EPSG:3857" as "EPSG:4326" }]).ok).toBe(false);
    const duplicate = { ...valid, artifactId: "duplicate", features: [...valid.features, valid.features[0]!] };
    expect(validateCatalogArtifacts([valid, duplicate]).ok).toBe(false);
    const corrupt = { ...valid, artifactId: "corrupt", relationships: [{ relationshipId: "bad", fromCanonicalId: "missing", toCanonicalId: "also-missing", relationship: "near" as const, sourceRefIds: [], confidence: 0.1, observedAt: null }] };
    expect(validateCatalogArtifacts([corrupt]).ok).toBe(false);
    const allFixtureArtifacts = buildSyntheticCatalogArtifacts("v1"); const buildings = allFixtureArtifacts.find((artifact) => artifact.kind === "buildings")!; const pois = allFixtureArtifacts.find((artifact) => artifact.kind === "pois")!;
    const crossArtifact = makeSyntheticSourceArtifact({ ...pois, artifactId: "cross-artifact-relation", inputPath: "fixtures/cross.json", features: [], entities: [], acceptedCount: 0, relationships: [{ relationshipId: "cross", fromCanonicalId: pois.features[0]!.id, toCanonicalId: buildings.features[0]!.id, relationship: "located-on" as const, sourceRefIds: pois.features[0]!.sourceRefs.map((source) => source.id), confidence: 0.5, observedAt: null }] });
    expect(validateCatalogArtifacts([buildings, pois, crossArtifact]).ok).toBe(true);
    const tombstone = { ...buildings, artifactId: "contradictory-tombstone", tombstones: [{ tombstoneId: "tombstone", canonicalId: buildings.features[0]!.id, sourceRefIds: buildings.features[0]!.sourceRefs.map((source) => source.id), reason: "source-removed" as const, effectiveAt: "2026-08-03T00:00:00Z", replacementCanonicalId: null, authoritativeRuleId: "fixture-rule" }] };
    expect(validateCatalogArtifacts([tombstone]).ok).toBe(false);
  });

  it("keeps malformed lineage and checksum metadata fail-closed", () => {
    const valid = buildSyntheticCatalogArtifacts("v1")[0]!;
    expect(validateSourceArtifact({ ...valid, inputPath: "../escape.json" }).ok).toBe(false);
    expect(validateSourceArtifact({ ...valid, checksumSha256: "bad" }).ok).toBe(false);
    const malformed = { ...valid, artifactId: "malformed", sourceRegistryEntryIds: ["fixture.local.manhattan-slice"], sourceLicenses: [], features: [{ ...valid.features[0], sourceRefs: [] }] };
    expect(validateSourceArtifact(malformed).ok).toBe(false);
  });

  it("accepts a minimal approved artifact only when all contracts are explicit", () => {
    const artifact = makeSyntheticSourceArtifact({
      schemaVersion: "1.0", artifactId: "minimal", kind: "buildings", cityId: "manhattan", scope: { cityId: "manhattan", label: "Synthetic", boundaryId: "fixture", coverageClaim: "vertical-slice" }, inputPath: "fixtures/minimal.json", sourceRegistryEntryIds: ["fixture.local.manhattan-slice"], sourceLicenses: [], outputCrs: "EPSG:4326", verticalDatum: "unknown", generatedAt: "2026-08-03T00:00:00Z", freshness: { earliest: null, latest: null, observationCount: 0 }, fixtureOnly: true, acceptedCount: 0, rejectedCount: 0, conflictCount: 0, features: [], entities: [], relationships: [], tombstones: [], explicitRemovals: [], nonAuthoritativeOmission: false,
    });
    expect(artifact.checksumSha256).toHaveLength(64);
    expect(validateSourceArtifact(artifact).ok).toBe(false);
    expect(syntheticReconciliationObservations().length).toBeGreaterThan(0);
  });
});
