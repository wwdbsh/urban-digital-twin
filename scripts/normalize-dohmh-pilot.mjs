/* global process, console */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const [inputPath, outputPath, capturedAt = "2026-08-04T00:00:00Z"] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error("Usage: node scripts/normalize-dohmh-pilot.mjs <socrata-json> <records-json> [captured-at]");
const rows = JSON.parse(await readFile(inputPath, "utf8"));
if (!Array.isArray(rows)) throw new Error("DOHMH input must be a JSON array.");
const text = (value) => value === null || value === undefined || value === "" ? null : String(value);
const coordinates = (row) => {
  const location = row.location?.coordinates;
  const longitude = Number(location?.[0] ?? row.longitude);
  const latitude = Number(location?.[1] ?? row.latitude);
  return Number.isFinite(longitude) && Number.isFinite(latitude) ? [longitude, latitude] : null;
};
const stableRow = (row) => JSON.stringify(Object.fromEntries(Object.entries(row).sort(([left], [right]) => left.localeCompare(right))));
const records = rows.map((row, index) => {
  const camis = text(row.camis);
  const point = coordinates(row);
  if (!camis || !point) throw new Error(`Row ${index} lacks CAMIS or valid WGS84 coordinates.`);
  const digest = createHash("sha256").update(stableRow(row)).digest("hex").slice(0, 24);
  const building = text(row.building);
  const street = text(row.street);
  const postalCode = text(row.zipcode);
  const line1 = building && street ? `${building} ${street}` : building ?? street;
  return {
    sourceRegistryEntryId: "nyc.dohmh-restaurant-inspections",
    provider: "NYC Department of Health and Mental Hygiene",
    datasetId: "43nn-pn8j",
    sourceRecordId: `dohmh:${camis}:${digest}`,
    matchKey: `dohmh:camis:${camis}`,
    termsUrl: "https://www.nyc.gov/html/datamine/html/data/terms.html?dataSetJs=raw",
    attribution: "Source: NYC Department of Health and Mental Hygiene, DOHMH New York City Restaurant Inspection Results (dataset 43nn-pn8j), accessed through NYC Open Data.",
    licenseClass: "nyc-open-data-terms",
    name: text(row.dba),
    categories: ["restaurant"],
    coordinates: point,
    address: { formatted: line1 ? `${line1}, New York, NY${postalCode ? ` ${postalCode}` : ""}` : null, line1, line2: null, locality: "New York", region: "NY", postalCode, countryCode: "US" },
    contact: { website: null, phone: text(row.phone), email: null },
    openingHours: null,
    cuisine: text(row.cuisine_description),
    brand: null,
    accessibility: null,
    capturedAt,
    updatedAt: text(row.record_date),
    observedAt: text(row.inspection_date),
    inspectionObservation: {
      camis,
      inspectionDate: text(row.inspection_date),
      recordDate: text(row.record_date),
      action: text(row.action),
      violationCode: text(row.violation_code),
      violationDescription: text(row.violation_description),
      criticalFlag: text(row.critical_flag),
      score: text(row.score),
      grade: text(row.grade),
      gradeDate: text(row.grade_date),
      inspectionType: text(row.inspection_type),
    },
  };
});
await writeFile(outputPath, `${JSON.stringify({ records }, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ inputPath, outputPath, sourceRows: rows.length, normalizedRecords: records.length, restaurantKeys: new Set(records.map((row) => row.matchKey)).size, capturedAt }, null, 2));
