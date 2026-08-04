/* global Buffer, console, process */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const [buildingPath, restaurantPath, outputDir = "public/data/real-wave-20260804"] = process.argv.slice(2);
if (!buildingPath || !restaurantPath) throw new Error("Usage: node scripts/build-browser-pilot-partitions.mjs <building-features> <restaurant-features> [output-dir]");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const writePartition = async (name, value) => {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  const path = `${outputDir}/${name}.json`;
  await writeFile(path, bytes, { flag: "wx" });
  return { id: name, path: `/data/real-wave-20260804/${name}.json`, schemaVersion: "1.0", outputCrs: "EPSG:4326", featureCount: value.length, byteSize: bytes.byteLength, sha256: hash(bytes) };
};
const buildings = await readJson(buildingPath);
const restaurants = await readJson(restaurantPath);
const lightweightRestaurants = restaurants.map((feature) => {
  const attributes = { ...feature.attributes };
  const history = typeof attributes.placeInspectionObservations === "string" ? JSON.parse(attributes.placeInspectionObservations) : [];
  const latest = [...history].sort((left, right) => `${right.inspectionDate ?? ""}|${right.recordDate ?? ""}|${right.sourceRefId}`.localeCompare(`${left.inspectionDate ?? ""}|${left.recordDate ?? ""}|${left.sourceRefId}`))[0] ?? null;
  delete attributes.placeInspectionObservations;
  attributes.placeSourceRecordIds = feature.sourceRefs[0]?.sourceRecordId ? JSON.stringify([feature.sourceRefs[0].sourceRecordId]) : null;
  attributes.placeConflicts = JSON.stringify([]);
  const licenses = typeof attributes.placeLicenses === "string" ? JSON.parse(attributes.placeLicenses) : [];
  attributes.placeLicenses = licenses.length > 0 ? JSON.stringify([licenses[0]]) : null;
  attributes.placeInspectionObservationCount = history.length;
  attributes.placeLatestInspection = latest ? JSON.stringify({ camis: latest.camis, inspectionDate: latest.inspectionDate, recordDate: latest.recordDate, grade: latest.grade, score: latest.score, action: latest.action, inspectionType: latest.inspectionType }) : null;
  return { ...feature, sourceRefs: feature.sourceRefs.length > 0 ? [feature.sourceRefs[0]] : [], attributes };
});
const partitions = [await writePartition("buildings", buildings), await writePartition("restaurants", lightweightRestaurants)];
const manifest = {
  schemaVersion: "1.0",
  releaseId: "real-wave-20260804",
  generatedAt: "2026-08-04T03:15:00.000Z",
  fixtureOnly: false,
  outputCrs: "EPSG:4326",
  scope: { cityId: "manhattan", boundaryId: "manhattan-real-wave-pilot-bbox-20260804", coverageClaim: "vertical-slice" },
  sourceRegistryEntryIds: ["nyc.building-footprints", "nyc.dohmh-restaurant-inspections"],
  partitions,
  fallback: { mode: "fixtures", reason: "Missing, invalid, or checksum-mismatched real partition" },
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(`${outputDir}/manifest.json`, manifestBytes, { flag: "wx" });
console.log(JSON.stringify({ outputDir, manifestSha256: hash(manifestBytes), partitions }, null, 2));
