/* global AbortSignal, console, fetch, process, setTimeout, URLSearchParams */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const endpoint = "https://services6.arcgis.com/yG5s3afENB5iO9fj/arcgis/rest/services/BUILDING_view/FeatureServer/0/query";
const fields = [
  "OBJECTID", "DOITT_ID", "BIN", "BASE_BBL", "MAPPLUTO_BBL", "CONSTRUCTION_YEAR", "FEATURE_CODE",
  "GEOM_SOURCE", "GROUND_ELEVATION", "HEIGHT_ROOF", "LAST_EDITED_DATE", "LAST_STATUS_TYPE", "NAME",
].join(",");

function args(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index]?.startsWith("--")) continue;
    output[argv[index].slice(2)] = argv[index + 1]; index += 1;
  }
  return output;
}

const values = args(process.argv.slice(2));
const idsPath = resolve(values.ids ?? "data/raw/real-wave-20260804/building-ids.json");
const outputPath = resolve(values.output ?? "data/raw/real-wave-20260804/manhattan-building-footprints-20260804.geojson");
const manifestPath = resolve(values.manifest ?? "data/raw/real-wave-20260804/manhattan-building-footprints-20260804.manifest.json");
const batchSize = Number(values["batch-size"] ?? 1000);
const timeoutMs = Number(values["timeout-ms"] ?? 180_000);
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error("--batch-size must be an integer from 1 through 1000.");
if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) throw new Error("--timeout-ms must be an integer from 1000 through 300000.");
const partialPath = `${outputPath}.partial`;
const outputDirectory = dirname(outputPath);
const capturedAt = new Date().toISOString();
const idsEnvelope = JSON.parse(await readFile(idsPath, "utf8"));
const ids = [...new Set((idsEnvelope.objectIds ?? []).map(Number))].filter(Number.isInteger).sort((left, right) => left - right);
if (ids.length === 0) throw new Error("No object IDs were supplied.");
await mkdir(outputDirectory, { recursive: true });
for (const path of [outputPath, partialPath, manifestPath]) {
  try { await stat(path); throw new Error(`Refusing to overwrite existing immutable path: ${path}`); } catch (error) { if (error instanceof Error && error.message.startsWith("Refusing")) throw error; }
}

async function request(objectIds) {
  const body = new URLSearchParams({ objectIds: objectIds.join(","), outFields: fields, returnGeometry: "true", outSR: "4326", f: "geojson" });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "urban-digital-twin/real-wave-20260804" }, body, signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`ArcGIS HTTP ${response.status}`);
      const parsed = await response.json();
      if (parsed.error) throw new Error(JSON.stringify(parsed.error));
      if (!Array.isArray(parsed.features)) throw new Error("ArcGIS response omitted features.");
      return parsed.features;
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 2 ** attempt * 1000));
    }
  }
  throw new Error("Unreachable request retry state.");
}

let featureCount = 0;
const seenObjectIds = new Set();
let first = true;
const handle = await import("node:fs/promises").then(({ open }) => open(partialPath, "wx"));
try {
  await handle.write('{"type":"FeatureCollection","features":[');
  for (let offset = 0; offset < ids.length; offset += batchSize) {
    const features = await request(ids.slice(offset, offset + batchSize));
    for (const feature of features) {
      if (!first) await handle.write(",");
      const text = JSON.stringify(feature);
      await handle.write(text); first = false; featureCount += 1;
      const objectId = feature?.properties?.OBJECTID;
      if (Number.isInteger(objectId)) seenObjectIds.add(objectId);
    }
    console.log(`batch ${Math.floor(offset / batchSize) + 1}/${Math.ceil(ids.length / batchSize)}: ${features.length}`);
  }
  await handle.write("]}\n");
} finally {
  await handle.close();
}
const missing = ids.filter((id) => !seenObjectIds.has(id));
if (missing.length > 0) throw new Error(`Snapshot omitted ${missing.length} requested object IDs.`);
await rename(partialPath, outputPath);
const bytes = (await stat(outputPath)).size;
const hash = createHash("sha256");
for await (const chunk of createReadStream(outputPath)) hash.update(chunk);
const manifest = {
  source: "NYC OTI GIS BUILDING_view FeatureServer/0",
  datasetId: "jh45-qr5r",
  sourceEndpoint: endpoint,
  idsInputPath: idsPath,
  geometryFilter: idsEnvelope.geometryFilter ?? null,
  geometryFilterCrs: "EPSG:4326",
  filterSemantics: "esriGeometryEnvelope intersects, Manhattan bounding envelope; records are clipped later to the adapter study boundary",
  objectIdCount: ids.length,
  featureCount,
  objectIdsUnique: seenObjectIds.size === featureCount,
  batchSize,
  timeoutMs,
  requestMethod: "POST",
  outFields: fields.split(","),
  outputCrs: "EPSG:4326",
  capturedAt,
  finishedAt: new Date().toISOString(),
  idsQueryUrl: `${endpoint}?where=1%3D1&geometry=-74.03%2C40.68%2C-73.91%2C40.88&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&returnIdsOnly=true&f=json`,
  batchQueryUrlTemplate: `${endpoint}?objectIds=<comma-separated-OBJECTIDs>&outFields=${encodeURIComponent(fields)}&returnGeometry=true&outSR=4326&f=geojson`,
  immutable: true,
  rawSnapshot: outputPath,
  snapshotSha256: hash.digest("hex"),
  snapshotBytes: bytes,
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ outputPath, manifestPath, featureCount, objectIdCount: ids.length, bytes, snapshotSha256: manifest.snapshotSha256 }, null, 2));
