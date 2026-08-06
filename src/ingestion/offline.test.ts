import { describe, expect, it } from "vitest";
import fixture from "./fixtures/manhattan-slice.fixture.json";
import { manhattanAdapter } from "../data/city-adapters";
import { sourceRegistry } from "../data/source-registry";
import {
  validateConfidence,
  validateCityAdapter,
  validateFeature,
  validateGeometryProvenance,
  validateSourceRef,
  validateUncertainty,
} from "../domain/schema";
import {
  ingestFixtureText,
  makeCanonicalFeatureId,
  stableSerialize,
} from "./offline";
import { featureMatchesQuery, projectFeatureToCityFeature } from "../domain/features";

const options = {
  adapter: manhattanAdapter,
  inputFileName: "src/ingestion/fixtures/manhattan-slice.fixture.json",
  runId: "test-run:fixture-v1",
  startedAt: "2026-08-03T00:00:00Z",
  finishedAt: "2026-08-03T00:00:01Z",
  ingestedAt: "2026-08-03T00:00:01Z",
};

describe("source registry and city adapter", () => {
  it("requires explicit approval state and complete source fields", () => {
    expect(sourceRegistry.length).toBeGreaterThan(10);
    sourceRegistry.forEach((source) => {
      expect(["pending", "approved", "rejected"]).toContain(source.approval.state);
      expect(source.id).toBeTruthy();
      expect(source.provider).toBeTruthy();
      expect(source.datasetId).toBeTruthy();
      expect(source.canonicalUrl).toBeTruthy();
      expect(source.termsUrl).toBeTruthy();
      expect(source.licenseClass).toBeTruthy();
      expect(source.attribution).toBeTruthy();
      expect(source.cadence).toBeTruthy();
      expect(source.geographicScope).toBeTruthy();
      expect(source.expectedCrs).toBeTruthy();
      expect(source.expectedVerticalDatum).toBeTruthy();
    });
  });

  it("keeps licensed facade evidence scoped to ESB and Herald only", () => {
    const esb = sourceRegistry.find((source) => source.id === "commons.empire-state-photo-cc-by-sa-4");
    const herald = sourceRegistry.find((source) => source.id === "commons.herald-towers-photo-cc-by-sa-4");
    expect(esb?.approval.state).toBe("approved");
    expect(herald?.approval.state).toBe("approved");
    expect(esb?.licenseClass).toBe("cc-by-sa-4.0");
    expect(herald?.licenseClass).toBe("cc-by-sa-4.0");
    expect(sourceRegistry.filter((source) => source.id.startsWith("commons.")).map((source) => source.id)).toEqual(expect.arrayContaining([
      "commons.empire-state-photo-cc-by-sa-4",
      "commons.herald-towers-photo-cc-by-sa-4",
    ]));
  });

  it("records the commercial approval fingerprint as a lowercase SHA-256 digest", () => {
    const commercialApprovals = sourceRegistry
      .flatMap((source) => "approvalEvidence" in source ? [source.approvalEvidence] : [])
      .filter((evidence) => evidence?.evidenceId === "codex-user-turn:2026-08-05:bounded-overpass-single-query-approval");

    expect(commercialApprovals.length).toBeGreaterThan(0);
    for (const evidence of commercialApprovals) expect(evidence?.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(commercialApprovals[0]?.fingerprintSha256).toBe("b4fc25a430fabacaba0250bc223e99e071b1aaa04f563607e5c8c97b05b20949");
  });

  it("validates the reviewable Manhattan slice polygon", () => {
    const result = validateCityAdapter(manhattanAdapter);
    expect(result.ok).toBe(true);
    expect(manhattanAdapter.boundary.coordinates[0]).toHaveLength(5);
    expect(manhattanAdapter.boundary.coordinates[0]?.[0]).toEqual(manhattanAdapter.boundary.coordinates[0]?.[4]);

    const invalid = validateCityAdapter({ ...manhattanAdapter, outputCrs: "EPSG:3857" });
    expect(invalid.ok).toBe(false);
  });
});

describe("offline fixture ingestion", () => {
  it("normalizes local records and accounts for every rejected record", async () => {
    const result = await ingestFixtureText(JSON.stringify(fixture, null, 2), options);

    expect(result.features).toHaveLength(2);
    expect(result.manifest.acceptedCount).toBe(2);
    expect(result.manifest.rejectedCount).toBe(1);
    expect(result.manifest.rejectionAccounting.rejectedRecordIndices).toEqual([2]);
    expect(result.manifest.rejectionAccounting.allInputRecordsAccountedFor).toBe(true);
    expect(result.manifest.rejectionAccounting.rejected[0]?.sourceId).toBe("fixture-invalid-001");
    expect(result.features.every((feature) => feature.geometryProvenance.outputCrs === "EPSG:4326")).toBe(true);
    expect(result.features[0]?.sourceRefs[0]?.sourceRecordId).toBe("fixture-building-001");
    expect(result.features[0]?.freshness.capturedAt).toBe("2026-08-03T00:00:00Z");
    expect(result.features[0]?.confidence.score).toBe(0.72);
    expect(result.manifest.immutable).toBe(true);
  });

  it("keeps checksums and manifests deterministic across JSON formatting", async () => {
    const pretty = JSON.stringify(fixture, null, 2);
    const compact = JSON.stringify(fixture);
    const first = await ingestFixtureText(pretty, options);
    const second = await ingestFixtureText(compact, options);

    expect(first.manifest.inputChecksumSha256).toBe(second.manifest.inputChecksumSha256);
    expect(first.manifestJson).toBe(second.manifestJson);
    expect(stableSerialize({ b: 2, a: 1 })).toBe(stableSerialize({ a: 1, b: 2 }));
  });

  it("keeps canonical IDs stable and projects provenance into search/detail", async () => {
    const result = await ingestFixtureText(JSON.stringify(fixture), options);
    const feature = result.features[0];
    if (!feature) throw new Error("Expected a normalized feature.");
    const projected = projectFeatureToCityFeature(feature, "Manhattan, New York", {
      manifestVersion: result.manifest.manifestVersion,
      manifestId: result.manifest.runId,
      fixtureOnly: true,
      acceptedCount: result.manifest.acceptedCount,
      rejectedCount: result.manifest.rejectedCount,
      rejectionReport: "Fixture rejection report",
    });
    const expectedId = makeCanonicalFeatureId("manhattan", "building", {
      provider: "Urban Digital Twin local test fixture",
      datasetId: "manhattan-flatiron-v1",
      sourceId: "fixture-building-001",
    });

    expect(feature.id).toBe(expectedId);
    expect(projected.id).toBe(expectedId);
    expect(projected.sourceRefs[0]?.sourceRecordId).toBe("fixture-building-001");
    expect(projected.freshness.updatedAt).toBe("2026-08-03T00:00:00Z");
    expect(featureMatchesQuery(projected, "fixture-building-001")).toBe(true);
  });

  it("normalizes Web Mercator input to WGS84", async () => {
    const longitude = -73.9912;
    const latitude = 40.7431;
    const x = (longitude * 20_037_508.342789244) / 180;
    const y = (Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360)) * 20_037_508.342789244) / Math.PI;
    const mercatorFixture = {
      ...fixture,
      fixtureId: "manhattan-flatiron-mercator-v1",
      inputCrs: "EPSG:3857",
      features: [{
        sourceId: "fixture-mercator-001",
        kind: "poi",
        name: "Mercator Fixture",
        geometry: { type: "Point", coordinates: [x, y] },
      }],
    };
    const result = await ingestFixtureText(JSON.stringify(mercatorFixture), options);

    expect(result.features).toHaveLength(1);
    expect(result.features[0]?.coordinates[0]).toBeCloseTo(longitude, 5);
    expect(result.features[0]?.coordinates[1]).toBeCloseTo(latitude, 5);
  });

  it("returns rejection reports for malformed JSON and runtime schema failures", async () => {
    const malformed = await ingestFixtureText("{not-json", options);
    expect(malformed.features).toHaveLength(0);
    expect(malformed.manifest.rejectionAccounting.rejected[0]?.code).toBe("parse-error");

    const invalidFeature = validateFeature({ schemaVersion: "1.0", id: "bad" });
    expect(invalidFeature.ok).toBe(false);
    const invalidSourceRef = validateSourceRef({ schemaVersion: "1.0", sourceRecordId: "" });
    expect(invalidSourceRef.ok).toBe(false);
    expect(validateConfidence({ score: 2, label: "high", rationale: "bad" }).ok).toBe(false);
    expect(validateUncertainty({ horizontalMeters: -1, verticalMeters: null, temporalDays: null, notes: "bad" }).ok).toBe(false);
    expect(validateGeometryProvenance({ schemaVersion: "1.0", outputCrs: "EPSG:3857" }).ok).toBe(false);
  });
});
