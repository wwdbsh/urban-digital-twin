/** Synthetic-only catalog used by the UI and tests. Every coordinate, name and
 * source ID here is invented and must never be presented as Manhattan data. */
import { runtimeFixtureFeatures } from "./features.ts";
import { reconcileObservations, observationFromFeature, type ReconciliationResult, type SourceObservation } from "./reconciliation.ts";

const poi = runtimeFixtureFeatures.find((feature) => feature.id.endsWith("fixture-poi-001"));
const retail = runtimeFixtureFeatures.find((feature) => feature.id.endsWith("fixture-retail-001"));
const building = runtimeFixtureFeatures.find((feature) => feature.id.endsWith("fixture-building-001"));
const area = runtimeFixtureFeatures.find((feature) => feature.id.endsWith("fixture-area-nta-001"));
const station = runtimeFixtureFeatures.find((feature) => feature.id.endsWith("fixture-station-001"));

function requiredFeature(feature: typeof poi): NonNullable<typeof feature> {
  if (!feature) throw new Error("Synthetic reconciliation fixture is incomplete.");
  return feature;
}

export function syntheticReconciliationObservations(): (SourceObservation | unknown)[] {
  const primary = observationFromFeature(requiredFeature(poi), { observationId: "fixture-observation-coffee-primary", aliases: ["Coffee Counter", "카페 서울"], confidence: 0.78 });
  const enrichment = observationFromFeature(requiredFeature(poi), {
    observationId: "fixture-observation-coffee-enrichment",
    sourceRecordId: "fixture-coffee-enrichment-001",
    aliases: ["Counter Cafe"],
    confidence: 0.65,
    conflictingPhone: "+1 (212) 555-0199",
  });
  const observations: (SourceObservation | unknown)[] = [
    primary,
    enrichment,
    observationFromFeature(requiredFeature(retail), { observationId: "fixture-observation-market", aliases: ["Fixture Market"], confidence: 0.52 }),
    observationFromFeature(requiredFeature(building), { observationId: "fixture-observation-building", confidence: 0.72 }),
    observationFromFeature(requiredFeature(area), { observationId: "fixture-observation-area", confidence: 0.4 }),
    observationFromFeature(requiredFeature(station), { observationId: "fixture-observation-station", confidence: 0.4 }),
    { observationId: "fixture-observation-malformed", source: { registryEntryId: "fixture.local.manhattan-slice" } },
  ];
  return observations;
}

export function buildSyntheticReconciliationCatalog(): ReconciliationResult {
  return reconcileObservations(syntheticReconciliationObservations(), { fixtureOnly: true, now: "2026-08-03T00:00:00Z" });
}
