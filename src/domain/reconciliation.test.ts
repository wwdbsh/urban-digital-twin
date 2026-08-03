import { describe, expect, it } from "vitest";
import { getSourceRegistryEntry } from "../data/source-registry.ts";
import { buildSyntheticReconciliationCatalog, syntheticReconciliationObservations } from "./reconciliation-fixtures.ts";
import {
  normalizeAddress,
  normalizePhone,
  normalizeText,
  reconcileObservations,
  searchReconciledCatalog,
  scoreCandidate,
  unknownHours,
  validateReconciliationInput,
  validateSourceObservation,
  type SourceObservation,
} from "./reconciliation.ts";

describe("provider-neutral reconciliation", () => {
  it("normalizes names, phones, addresses and leaves complex hours explicit", () => {
    expect(normalizeText("Café — Fixture")).toBe("cafe fixture");
    expect(normalizeText("카페 서울")).toBe("카페 서울");
    expect(normalizePhone("+1 (212) 555-0100")).toBe("12125550100");
    expect(normalizeAddress({ houseNumber: "100", street: "Invented Fixture Way", postalCode: "10010" }).normalizedKey).toContain("100 invented fixture way");
    expect(unknownHours(null).parsedStatus).toBe("unknown");
    expect(unknownHours("Monday 08:00-17:00").parsedStatus).toBe("invalid");
  });

  it("merges a conservative same-place pair and keeps a reversible lineage", () => {
    const result = buildSyntheticReconciliationCatalog();
    expect(result.quality.sourceObservationCount).toBe(6);
    expect(result.quality.rejectedRecordCount).toBe(1);
    expect(result.quality.mergedGroupCount).toBeGreaterThanOrEqual(1);
    const coffee = result.entities.find((entity) => entity.fields.name === "Fixture Coffee Counter");
    expect(coffee?.observationIds).toEqual(["fixture-observation-coffee-enrichment", "fixture-observation-coffee-primary"]);
    expect(coffee?.reversibleMerge).toBe(true);
    expect(coffee?.conflicts.some((conflict) => conflict.field === "contact")).toBe(true);
  });

  it("does not merge contradictory high-confidence source IDs", () => {
    const observations = syntheticReconciliationObservations().filter((value): value is SourceObservation => validateSourceObservation(value).ok).slice(0, 2).map((value) => ({ ...value, confidence: 0.95 }));
    const decision = scoreCandidate(observations[0]!, observations[1]!);
    expect(decision.decision).toBe("quarantined");
    const result = reconcileObservations(observations, { fixtureOnly: true });
    expect(result.quality.quarantinedCount).toBe(1);
    expect(result.quality.mergedGroupCount).toBe(0);
  });

  it("allows strong high-confidence evidence to merge across provider namespaces", () => {
    const observations = syntheticReconciliationObservations().filter((value): value is SourceObservation => validateSourceObservation(value).ok).slice(0, 1).map((value) => ({ ...value, observationId: "fixture-cross-provider", confidence: 0.95, source: { ...value.source, id: "source-ref:cross-provider", registryEntryId: "fixture.local.transit", provider: "Synthetic second provider", datasetId: "places-v2", sourceRecordId: "different-provider-id" } }));
    const primary = syntheticReconciliationObservations()[0] as SourceObservation;
    const decision = scoreCandidate({ ...primary, confidence: 0.95 }, observations[0]!);
    expect(decision.decision).toBe("merge");
    const result = reconcileObservations([{ ...primary, confidence: 0.95 }, ...observations], { fixtureOnly: true });
    expect(result.quality.mergedGroupCount).toBe(1);
    expect(result.quality.quarantinedCount).toBe(0);
  });

  it("uses deterministic source-ID/name/category/address search ranking", () => {
    const catalog = buildSyntheticReconciliationCatalog();
    expect(searchReconciledCatalog(catalog, "Counter Cafe")[0]?.fields.name).toBe("Fixture Coffee Counter");
    expect(searchReconciledCatalog(catalog, "fixture-coffee-enrichment-001")[0]?.observationIds).toContain("fixture-observation-coffee-enrichment");
    expect(searchReconciledCatalog(catalog, "grocery")[0]?.fields.name).toBe("Fixture Market Shelf");
  });

  it("searches Unicode aliases and every observation/source metadata identifier", () => {
    const primary = syntheticReconciliationObservations()[0] as SourceObservation;
    const multilingual = { ...primary, observationId: "fixture-observation-korean-alias", source: { ...primary.source, id: "source-ref:korean-alias", sourceRecordId: "fixture-korean-001" }, payload: { ...primary.payload, name: "Café Seoul", aliases: ["카페 서울"] } };
    const catalog = reconcileObservations([multilingual], { fixtureOnly: true });
    expect(searchReconciledCatalog(catalog, "카페 서울")[0]?.fields.name).toBe("Café Seoul");
    const built = buildSyntheticReconciliationCatalog();
    const observation = built.observations[0]!;
    for (const identifier of [observation.observationId, observation.source.id, observation.source.registryEntryId, observation.source.provider, observation.source.datasetId, observation.source.sourceRecordId]) {
      expect(searchReconciledCatalog(built, identifier).some((entity) => entity.observationIds.includes(observation.observationId))).toBe(true);
    }
    expect(searchReconciledCatalog(built, built.entities[0]!.canonicalId)[0]?.canonicalId).toBe(built.entities[0]!.canonicalId);
  });

  it("rejects pending sources and malformed observations without silently accepting them", () => {
    const fixture = syntheticReconciliationObservations()[0] as SourceObservation;
    const pending = { ...fixture, observationId: "pending", source: { ...fixture.source, registryEntryId: "overture.places" } };
    const result = reconcileObservations([pending, { bad: true }], { fixtureOnly: true });
    expect(result.observations).toHaveLength(0);
    expect(result.rejected.map((item) => item.code)).toEqual(["pending-source", "schema-invalid"]);
    expect(getSourceRegistryEntry("overture.places")?.approval.state).toBe("pending");
  });

  it("requires pinned local checksums and approved entries", () => {
    const valid = "a".repeat(64);
    expect(validateReconciliationInput({ inputFileName: "snapshot.json", inputChecksumSha256: valid, snapshotChecksumSha256: valid, sourceRegistryEntryIds: ["fixture.local.manhattan-slice"], ingestedAt: "2026-08-03T00:00:00Z", fixtureOnly: true }).ok).toBe(true);
    const invalid = validateReconciliationInput({ inputFileName: "https://example.invalid/snapshot.json", inputChecksumSha256: valid, snapshotChecksumSha256: "b".repeat(64), sourceRegistryEntryIds: ["overture.places"], ingestedAt: "not-a-date", fixtureOnly: false });
    expect(invalid.ok).toBe(false);
    expect(invalid.issues.join(" ")).toContain("URL");
    expect(invalid.issues.join(" ")).toContain("pending");
  });
});
