/** Synthetic multi-artifact release inputs. Names, coordinates and IDs are
 * invented; this module makes no claim about Manhattan coverage. */
import { licenseRegistry } from "../data/source-registry.ts";
import { buildSyntheticReconciliationCatalog } from "../domain/reconciliation-fixtures.ts";
import type { Feature, SourceRef } from "../domain/schema.ts";
import { runtimeFixtureFeatures } from "../domain/features.ts";
import { makeSyntheticSourceArtifact, type CatalogRelationship, type SourceArtifact, type Tombstone } from "./catalog-release.ts";

const FIXTURE_TIME = "2026-08-03T00:00:00Z";
const SCOPE = { cityId: "manhattan" as const, label: "Synthetic Manhattan-like vertical-slice fixture", boundaryId: "manhattan-city-boundary-v1", coverageClaim: "vertical-slice" as const };

function freshness() { return { earliest: FIXTURE_TIME, latest: FIXTURE_TIME, observationCount: 1 }; }
function sourceLicenses(sourceIds: string[]) { return licenseRegistry.filter((license) => sourceIds.includes(license.id.replace(/^license:/, ""))); }
function featureSources(features: readonly Feature[]): string[] { return [...new Set(features.flatMap((feature) => feature.sourceRefs.map((source) => source.registryEntryId)))].sort(); }

function cloneFeature(feature: Feature, changes: Partial<Feature> = {}): Feature { return { ...feature, ...changes, sourceRefs: feature.sourceRefs.map((source) => ({ ...source })), attributes: { ...feature.attributes } }; }

function addedPoi(base: Feature): Feature {
  const source = base.sourceRefs[0]; if (!source) throw new Error("Synthetic POI source missing.");
  const sourceRecordId = "fixture-added-poi-001"; const sourceRef: SourceRef = { ...source, id: `${source.id}:${sourceRecordId}`, sourceRecordId };
  return { ...cloneFeature(base), id: `${base.id}-added`, name: "Fixture Added Place", sourceRefs: [sourceRef], geometry: { type: "Point", coordinates: [-73.9885, 40.746] }, coordinates: [-73.9885, 40.746], attributes: { ...base.attributes, placeAddress: "303 Invented Fixture Way, Manhattan, NY 10010", placeSourceRecordIds: JSON.stringify([sourceRecordId]) } };
}

function artifact(kind: SourceArtifact["kind"], artifactId: string, features: Feature[], options: { entities?: SourceArtifact["entities"]; relationships?: CatalogRelationship[]; tombstones?: Tombstone[]; explicitRemovals?: string[]; nonAuthoritativeOmission?: boolean; generatedAt?: string } = {}): SourceArtifact {
  const sourceRegistryEntryIds = featureSources(features);
  const allSources = sourceRegistryEntryIds.length > 0 ? sourceRegistryEntryIds : ["fixture.local.manhattan-slice"];
  const generatedAt = options.generatedAt ?? FIXTURE_TIME;
  return makeSyntheticSourceArtifact({ schemaVersion: "1.0", artifactId, kind, cityId: "manhattan", scope: SCOPE, inputPath: `fixtures/catalog/${artifactId}.json`, sourceRegistryEntryIds: allSources, sourceLicenses: sourceLicenses(allSources), outputCrs: "EPSG:4326", verticalDatum: "fixture-illustrative-height", generatedAt, freshness: { ...freshness(), latest: generatedAt, earliest: generatedAt }, fixtureOnly: true, acceptedCount: features.length + (options.entities?.length ?? 0), rejectedCount: 0, conflictCount: options.entities?.reduce((count, entity) => count + entity.conflicts.length, 0) ?? 0, features, entities: options.entities ?? [], relationships: options.relationships ?? [], tombstones: options.tombstones ?? [], explicitRemovals: options.explicitRemovals ?? [], nonAuthoritativeOmission: options.nonAuthoritativeOmission ?? false });
}

function relationship(fromCanonicalId: string, toCanonicalId: string, sourceRefIds: string[], id: string, relation: CatalogRelationship["relationship"] = "near"): CatalogRelationship { return { relationshipId: id, fromCanonicalId, toCanonicalId, relationship: relation, sourceRefIds, confidence: 0.5, observedAt: FIXTURE_TIME }; }

export function buildSyntheticCatalogArtifacts(release: "v1" | "v2" = "v1"): SourceArtifact[] {
  const original = [...runtimeFixtureFeatures]; const building = original.find((feature) => feature.kind === "building")!; const poi = original.find((feature) => feature.id.endsWith("fixture-poi-001"))!; const administrativeArea = original.find((feature) => feature.id.endsWith("fixture-area-cd-001"))!; const attraction = original.find((feature) => feature.id.endsWith("fixture-attraction-001")); const station = original.find((feature) => feature.kind === "transit-station")!;
  const current = release === "v1" ? original : original.filter((feature) => feature.id !== administrativeArea.id && feature.id !== attraction?.id).map((feature) => feature.id === poi.id ? cloneFeature(feature, { name: "Fixture Coffee Counter Updated", freshness: { ...feature.freshness, updatedAt: "2026-08-04T00:00:00Z", ingestedAt: "2026-08-04T00:00:00Z" }, attributes: { ...feature.attributes, fixtureRevision: "v2" } }) : feature).concat(addedPoi(poi));
  const reconciliation = buildSyntheticReconciliationCatalog(); const sourceRef = poi.sourceRefs[0]?.id ? [poi.sourceRefs[0].id] : [];
  const relationships = [relationship(poi.id, building.id, sourceRef, "fixture-rel-poi-building", "located-on"), relationship(station.id, poi.id, station.sourceRefs[0]?.id ? [station.sourceRefs[0].id] : [], "fixture-rel-station-poi", "near")];
  const tombstones: Tombstone[] = release === "v2" ? [{ tombstoneId: "fixture-tombstone-area-cd-001", canonicalId: administrativeArea.id, sourceRefIds: administrativeArea.sourceRefs.map((source) => source.id), reason: "source-removed", effectiveAt: "2026-08-04T00:00:00Z", replacementCanonicalId: null, authoritativeRuleId: "fixture-explicit-tombstone-rule" }] : [];
  const byLayer = (kind: SourceArtifact["kind"]): Feature[] => kind === "buildings" ? current.filter((feature) => feature.kind === "building") : kind === "pois" ? current.filter((feature) => feature.kind === "poi") : kind === "areas" ? current.filter((feature) => feature.kind === "area") : kind === "transit" ? current.filter((feature) => feature.kind === "transit-station" || feature.kind === "transit-entrance") : current.filter((feature) => feature.kind === "transit-route");
  return [artifact("buildings", `fixture-buildings-${release}`, byLayer("buildings")), artifact("pois", `fixture-pois-${release}`, byLayer("pois"), { nonAuthoritativeOmission: release === "v2" }), artifact("areas", `fixture-areas-${release}`, byLayer("areas")), artifact("transit", `fixture-transit-${release}`, byLayer("transit")), artifact("routes", `fixture-routes-${release}`, byLayer("routes")), artifact("reconciliation", `fixture-reconciliation-${release}`, [], { entities: reconciliation.entities, relationships, tombstones })];
}

export function buildSyntheticReleaseRelationships(release: "v1" | "v2" = "v1"): CatalogRelationship[] { return buildSyntheticCatalogArtifacts(release).flatMap((artifact) => artifact.relationships); }
