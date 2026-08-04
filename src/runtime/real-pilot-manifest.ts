import { validateFeature, type Feature } from "../domain/schema.ts";

export const REAL_PILOT_MANIFEST_SCHEMA_VERSION = "1.0" as const;
const EXPECTED_RELEASE_ID = "real-wave-20260804";
const EXPECTED_PARTITIONS = ["buildings", "restaurants"] as const;
const EXPECTED_PARTITION_REGISTRY: Record<(typeof EXPECTED_PARTITIONS)[number], string> = {
  buildings: "nyc.building-footprints",
  restaurants: "nyc.dohmh-restaurant-inspections",
};

export interface RealPilotPartitionManifest {
  id: (typeof EXPECTED_PARTITIONS)[number];
  path: string;
  schemaVersion: typeof REAL_PILOT_MANIFEST_SCHEMA_VERSION;
  outputCrs: "EPSG:4326";
  featureCount: number;
  byteSize: number;
  sha256: string;
}

export interface RealPilotManifest {
  schemaVersion: typeof REAL_PILOT_MANIFEST_SCHEMA_VERSION;
  releaseId: typeof EXPECTED_RELEASE_ID;
  generatedAt: string;
  fixtureOnly: false;
  outputCrs: "EPSG:4326";
  sourceRegistryEntryIds: string[];
  partitions: RealPilotPartitionManifest[];
  fallback: { mode: "fixtures"; reason: string };
}

export interface LoadedRealPilot {
  manifest: RealPilotManifest;
  features: Feature[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

export function validateRealPilotManifest(value: unknown): RealPilotManifest {
  if (!isRecord(value) || value.schemaVersion !== REAL_PILOT_MANIFEST_SCHEMA_VERSION || value.releaseId !== EXPECTED_RELEASE_ID || value.fixtureOnly !== false || value.outputCrs !== "EPSG:4326" || !isTimestamp(value.generatedAt)) throw new Error("Real pilot manifest schema/version/CRS validation failed.");
  if (!Array.isArray(value.sourceRegistryEntryIds) || value.sourceRegistryEntryIds.slice().sort().join(",") !== "nyc.building-footprints,nyc.dohmh-restaurant-inspections") throw new Error("Real pilot source identity validation failed.");
  if (!Array.isArray(value.partitions) || value.partitions.length !== EXPECTED_PARTITIONS.length) throw new Error("Real pilot partition manifest is incomplete.");
  const partitions = value.partitions.map((partition) => {
    if (!isRecord(partition) || !EXPECTED_PARTITIONS.includes(partition.id as (typeof EXPECTED_PARTITIONS)[number]) || partition.schemaVersion !== REAL_PILOT_MANIFEST_SCHEMA_VERSION || partition.outputCrs !== "EPSG:4326" || typeof partition.path !== "string" || !partition.path.startsWith("/data/real-wave-20260804/") || partition.path.includes("..") || typeof partition.featureCount !== "number" || !Number.isSafeInteger(partition.featureCount) || partition.featureCount <= 0 || typeof partition.byteSize !== "number" || !Number.isSafeInteger(partition.byteSize) || partition.byteSize <= 0 || !isSha256(partition.sha256)) throw new Error("Real pilot partition declaration is invalid.");
    return partition as unknown as RealPilotPartitionManifest;
  }).sort((left, right) => left.id.localeCompare(right.id));
  if (partitions.map((partition) => partition.id).join(",") !== EXPECTED_PARTITIONS.slice().sort().join(",")) throw new Error("Real pilot partition IDs are invalid.");
  if (!isRecord(value.fallback) || value.fallback.mode !== "fixtures" || typeof value.fallback.reason !== "string") throw new Error("Real pilot fixture fallback declaration is invalid.");
  return { ...value, partitions, sourceRegistryEntryIds: [...value.sourceRegistryEntryIds].sort() } as unknown as RealPilotManifest;
}

async function sha256Bytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

function validatePartitionFeature(value: unknown, partitionId: RealPilotPartitionManifest["id"]): Feature {
  const result = validateFeature(value);
  if (!result.ok) {
    const details = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new Error(`Real pilot partition ${partitionId} feature schema validation failed: ${details}; fixture fallback is active.`);
  }
  const feature = result.value;
  const expectedKind = partitionId === "buildings" ? "building" : "poi";
  const expectedRegistry = EXPECTED_PARTITION_REGISTRY[partitionId];
  const sourceRefsValid = feature.sourceRefs.length > 0 && feature.sourceRefs.every((source) => source.registryEntryId === expectedRegistry && source.role !== "fixture");
  if (feature.kind !== expectedKind || !sourceRefsValid) {
    throw new Error(`Real pilot partition ${partitionId} feature schema, source identity, or feature kind validation failed; fixture fallback is active.`);
  }
  if (partitionId === "restaurants" && "placeInspectionObservations" in feature.attributes) {
    throw new Error("Real pilot partition restaurants feature schema validation failed: full inspection history is not allowed; fixture fallback is active.");
  }
  return feature;
}

export async function loadRealPilot(basePath = "/data/real-wave-20260804/", signal?: AbortSignal): Promise<LoadedRealPilot> {
  const manifestResponse = await fetch(`${basePath}manifest.json`, { cache: "no-store", signal });
  if (!manifestResponse.ok) throw new Error("Real pilot manifest is unavailable; fixture fallback is active.");
  const manifest = validateRealPilotManifest(await manifestResponse.json());
  const loaded = await Promise.all(manifest.partitions.map(async (partition) => {
    const response = await fetch(partition.path, { cache: "no-store", signal });
    if (!response.ok) throw new Error(`Real pilot partition ${partition.id} is unavailable; fixture fallback is active.`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== partition.byteSize || (await sha256Bytes(bytes)).toLowerCase() !== partition.sha256.toLowerCase()) throw new Error(`Real pilot partition ${partition.id} checksum validation failed; fixture fallback is active.`);
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(value) || value.length !== partition.featureCount) throw new Error(`Real pilot partition ${partition.id} feature schema validation failed; fixture fallback is active.`);
    return value.map((feature) => validatePartitionFeature(feature, partition.id));
  }));
  return { manifest, features: loaded.flat() };
}
