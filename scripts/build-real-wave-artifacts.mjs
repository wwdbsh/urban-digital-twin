/* global console, process */

import { readFile, writeFile } from "node:fs/promises";
import { makeSyntheticSourceArtifact } from "../src/release/catalog-release.ts";
import { getSourceRegistryEntry, licenseRegistry } from "../src/data/source-registry.ts";

const [buildingPath, buildingManifestPath, poiPath, poiManifestPath, outputPath, generatedAt = "2026-08-04T03:13:00.000Z"] = process.argv.slice(2);
if (!buildingPath || !buildingManifestPath || !poiPath || !poiManifestPath || !outputPath) {
  throw new Error("Usage: node scripts/build-real-wave-artifacts.mjs <building-features> <building-manifest> <poi-features> <poi-manifest> <output> [generated-at]");
}

const load = async (path) => JSON.parse(await readFile(path, "utf8"));
const buildingFeatures = await load(buildingPath);
const buildingManifest = await load(buildingManifestPath);
const poiFeatures = await load(poiPath);
const poiManifest = await load(poiManifestPath);
const sourceIds = ["nyc.building-footprints", "nyc.dohmh-restaurant-inspections"];
const sourceLicenses = sourceIds.map((id) => licenseRegistry.find((license) => license.id === `license:${id}`));
if (sourceLicenses.some((license) => !license)) throw new Error("Approved real-wave licenses are missing from the registry.");
const sourceEntry = (id) => {
  const entry = getSourceRegistryEntry(id);
  if (!entry || entry.approval.state !== "approved") throw new Error(`Source is not approved: ${id}`);
  return entry;
};
sourceIds.forEach(sourceEntry);
const freshness = (features) => {
  const values = features.flatMap((feature) => feature.sourceRefs.flatMap((source) => [source.capturedAt, source.updatedAt, source.observedAt])).filter((value) => typeof value === "string").sort();
  return { earliest: values[0] ?? null, latest: values.at(-1) ?? null, observationCount: values.length };
};
const scope = { cityId: "manhattan", label: "Manhattan Flatiron/NoMad/Union Square real-data pilot", boundaryId: "manhattan-real-wave-pilot-bbox-20260804", coverageClaim: "vertical-slice" };
const artifact = (kind, artifactId, features, inputPath, checksumSha256, sourceRegistryEntryIds, acceptedCount, rejectedCount, verticalDatum) => makeSyntheticSourceArtifact({
  schemaVersion: "1.0", artifactId, kind, cityId: "manhattan", scope, inputPath, checksumSha256, sourceRegistryEntryIds,
  sourceLicenses: sourceRegistryEntryIds.map((id) => licenseRegistry.find((license) => license.id === `license:${id}`)).filter(Boolean),
  outputCrs: "EPSG:4326", verticalDatum, generatedAt, freshness: freshness(features), fixtureOnly: false,
  acceptedCount, rejectedCount, conflictCount: 0, features, entities: [], relationships: [], tombstones: [], explicitRemovals: [], nonAuthoritativeOmission: false,
});
const artifacts = [
  artifact("buildings", "real-wave-buildings-manhattan-pilot-20260804", buildingFeatures, buildingManifest.inputFileName, buildingManifest.inputChecksumSha256, ["nyc.building-footprints"], buildingManifest.acceptedCount, buildingManifest.rejectedCount, "GROUND_ELEVATION NAVD88 when documented; HEIGHT_ROOF relative to source ground; source uncertainty preserved"),
  artifact("pois", "real-wave-restaurants-manhattan-pilot-20260804", poiFeatures, poiManifest.inputFileName, poiManifest.inputChecksumSha256, ["nyc.dohmh-restaurant-inspections"], poiManifest.acceptedCount, poiManifest.rejectedCount, "No elevation supplied by DOHMH; unknown"),
];
await writeFile(outputPath, `${JSON.stringify(artifacts, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ outputPath, artifacts: artifacts.map((item) => ({ artifactId: item.artifactId, kind: item.kind, features: item.features.length, acceptedCount: item.acceptedCount, checksumSha256: item.checksumSha256 })) }, null, 2));
