import type { Feature, Geometry, SourceRef } from "../domain/schema";
import { isSafeLocalReleaseReference } from "./path-security";

export const BLOCK835_PUBLIC_REALM_RELEASE_ID = "manhattan-esb-block-public-realm-20260806";
export const BLOCK835_PUBLIC_REALM_APPROVAL_ID = "approval:block835-public-realm:20260806:user-approved";
export const BLOCK835_PUBLIC_REALM_FAULTS = ["release"] as const;
export type Block835PublicRealmFault = (typeof BLOCK835_PUBLIC_REALM_FAULTS)[number];
export const BLOCK835_PUBLIC_REALM_BASE_RELEASE_IDS = [
  "manhattan-esb-block-exterior-pilot-20260805",
  "manhattan-citywide-20260804",
  "manhattan-civic-context-20260804",
] as const;
export const BLOCK835_PUBLIC_REALM_SOURCE_DATASET_IDS = ["vfx9-tbb6", "xgwd-7vhd", "x9uq-u3qs"] as const;
export const BLOCK835_PUBLIC_REALM_SEMANTICS = ["roadbed", "sidewalk", "curb", "crosswalk"] as const;
export type Block835PublicRealmSemantic = (typeof BLOCK835_PUBLIC_REALM_SEMANTICS)[number];
export type Block835PublicRealmClaimLevel = "source-backed" | "estimated";

type PublicRealmGeometry = Extract<Geometry, { type: "MultiPolygon" | "MultiLineString" }>;

export interface Block835PublicRealmFeature {
  id: string;
  semantic: Block835PublicRealmSemantic;
  sourceDatasetId: string;
  sourceMappedViewId?: string;
  sourceFeatureId?: string;
  sourceFeatureIds?: string[];
  sourceFeatureIndex?: number;
  sourceFeatureIdRaw?: unknown;
  sourceProperties?: Record<string, unknown>;
  sourceGeometry?: PublicRealmGeometry;
  geometry: PublicRealmGeometry;
  sourceCoordinates?: unknown;
  sourceCrs: string;
  normalizedCrs: "EPSG:4326";
  verticalDatum: string;
  claimLevel: Block835PublicRealmClaimLevel;
  sourceEpoch?: string;
  intersectionId?: string;
  streetFace?: string;
  derivation?: {
    algorithm: string;
    inputs?: string[];
    inputDataset?: string;
    inputSourceFeatureId?: string;
    parameters?: Record<string, number | string | boolean>;
    noCurrentPaintEvidence?: boolean;
    profile?: Record<string, number | string | boolean>;
  };
  uncertainty: { horizontalMeters: number | null; verticalMeters: number | null; temporal: string };
  transform: { inputCrs: string; outputCrs: "EPSG:4326"; sourceNativeCrs?: string; verticalDatum: string; method: string; residualMeters: number; zPolicy: string };
}

export interface Block835PublicRealmAssetEntry {
  id: string;
  semantic: Block835PublicRealmSemantic;
  lod: "lod0" | "lod1";
  fileName: string;
  relativeContentRef: string;
  byteSize: number;
  sha256: string;
  triangles: number;
  materials: number;
  textures: number;
  images?: number;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  maxDistanceMeters: number;
}

export interface Block835PublicRealmDataFileEntry {
  fileName: "features.json" | "curbs.json" | "crosswalks.json";
  byteSize: number;
  sha256: string;
}

export interface Block835PublicRealmReleaseDocument {
  schemaVersion: "1.0";
  releaseId: string;
  cityId: "manhattan";
  generatedAt: string;
  fixtureOnly: false;
  approval: { evidenceId: string; fingerprintSha256?: string; scope: string; exclusions?: string[] };
  baseCompatibility: { baseReleaseIds: string[]; requiredExteriorReleaseId: string };
  sourceSnapshots: Array<{ datasetId: string; mappedViewId?: string; rawSha256: string; sourceFeatureCount: number }>;
  clip: { sourceExtent: { west: number; east: number; south: number; north: number }; clipBounds: { west: number; east: number; south: number; north: number }; bufferMeters: number; rule: string };
  anchorWgs84: [number, number, number];
  transform: { inputCrs: string; outputCrs: "EPSG:4326"; sourceNativeCrs?: string; verticalDatum: string; method: string; residualMeters: number; zPolicy: string };
  claimCeilings: Record<Block835PublicRealmSemantic, string>;
  features: { sourceBacked: number; roadbed: number; sidewalk: number; curbs: number; crosswalks: number; intersections: number };
  geometryValidation: { method: "mathutils.geometry.tessellate_polygon"; polygonContourResolution: "full source resolution in LOD0 and LOD1"; areaResidualToleranceRelative: number; maxObservedRelativeAreaError: number; holeRegression: { sourceFeatureId: string; expectedInteriorRingCount: number; observedInteriorRingCount: number; status: "pass" } };
  assetEntries: Block835PublicRealmAssetEntry[];
  dataFileEntries: Block835PublicRealmDataFileEntry[];
  assetBudget: { maxTotalBytes: number; maxLod0Triangles: number; maxLod1Triangles: number; maxMaterialsPerAsset: number; maxTextures: number; maxCloseRangeRequests: number };
  sourcePacketSha256: string;
  provenance: { sourceEpoch: string; termsUrl: string; attribution: string; disclaimer: string; localOnly: boolean; runtimeExternalNetwork: boolean };
  fallback: string;
}

export interface Block835PublicRealmAssetResolution {
  kind: "asset";
  semantic: Block835PublicRealmSemantic;
  lod: "lod0" | "lod1";
  entry: Block835PublicRealmAssetEntry;
  uri: string;
}

export interface LoadedBlock835PublicRealmRelease {
  document: Block835PublicRealmReleaseDocument;
  features: readonly Block835PublicRealmFeature[];
  verifiedContentRefs: ReadonlySet<string>;
  verifiedDataFiles: ReadonlySet<string>;
  assetFailures: readonly Block835PublicRealmAssetFailure[];
  compatibleWith(baseReleaseId: string): boolean;
  resolve(semantic: Block835PublicRealmSemantic, distanceMeters?: number): Block835PublicRealmAssetResolution | null;
  feature(featureId: string): Block835PublicRealmFeature | undefined;
  featuresForSemantic(semantic: Block835PublicRealmSemantic): readonly Block835PublicRealmFeature[];
}

export interface Block835PublicRealmAssetFailure {
  relativeContentRef: string;
  code: "missing-content" | "checksum-mismatch" | "invalid-content";
  message: string;
}

export interface Block835PublicRealmValidationIssue { path: string; message: string }
export type Block835PublicRealmValidationResult =
  | { ok: true; value: Block835PublicRealmReleaseDocument }
  | { ok: false; issues: Block835PublicRealmValidationIssue[] };

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function sha256Pattern(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/iu.test(value); }
function issue(issues: Block835PublicRealmValidationIssue[], path: string, message: string): void { issues.push({ path, message }); }
function safeArray(value: unknown): value is unknown[] { return Array.isArray(value); }
function validGeometry(value: unknown): value is PublicRealmGeometry {
  if (!record(value) || (value.type !== "MultiPolygon" && value.type !== "MultiLineString") || !Array.isArray(value.coordinates)) return false;
  let valid = true;
  const walk = (part: unknown): void => {
    if (!Array.isArray(part)) { valid = false; return; }
    if (part.length >= 2 && typeof part[0] === "number" && typeof part[1] === "number") {
      if (!finite(part[0]) || !finite(part[1]) || Math.abs(part[0]) > 180 || Math.abs(part[1]) > 90) valid = false;
      return;
    }
    part.forEach(walk);
  };
  walk(value.coordinates);
  return valid;
}

export function validateBlock835PublicRealmRelease(value: unknown): Block835PublicRealmValidationResult {
  const issues: Block835PublicRealmValidationIssue[] = [];
  if (!record(value)) return { ok: false, issues: [{ path: "$", message: "Public-realm release must be an object." }] };
  if (value.schemaVersion !== "1.0") issue(issues, "schemaVersion", "Unsupported public-realm schema.");
  if (value.releaseId !== BLOCK835_PUBLIC_REALM_RELEASE_ID) issue(issues, "releaseId", "Public-realm release ID mismatch.");
  if (value.cityId !== "manhattan") issue(issues, "cityId", "Public-realm city ID mismatch.");
  if (value.fixtureOnly !== false) issue(issues, "fixtureOnly", "Public-realm release must be non-fixture.");
  const approval = value.approval;
  if (!record(approval) || approval.evidenceId !== BLOCK835_PUBLIC_REALM_APPROVAL_ID) issue(issues, "approval.evidenceId", "The durable Block 835 approval evidence is required.");
  const compatibility = value.baseCompatibility;
  if (!record(compatibility) || !safeArray(compatibility.baseReleaseIds) || !compatibility.baseReleaseIds.includes(BLOCK835_PUBLIC_REALM_BASE_RELEASE_IDS[0]) || compatibility.requiredExteriorReleaseId !== BLOCK835_PUBLIC_REALM_BASE_RELEASE_IDS[0]) issue(issues, "baseCompatibility", "Exterior/base compatibility pins are required.");
  if (!Array.isArray(value.sourceSnapshots) || value.sourceSnapshots.length !== 3 || value.sourceSnapshots.some((snapshot) => !record(snapshot) || !BLOCK835_PUBLIC_REALM_SOURCE_DATASET_IDS.includes(snapshot.datasetId as (typeof BLOCK835_PUBLIC_REALM_SOURCE_DATASET_IDS)[number]) || !sha256Pattern(snapshot.rawSha256))) issue(issues, "sourceSnapshots", "Exactly the three approved OTI snapshots with hashes are required.");
  if (!record(value.clip) || !record(value.clip.clipBounds) || !nonEmpty(value.clip.rule)) issue(issues, "clip", "Deterministic clip rule is required.");
  if (!Array.isArray(value.anchorWgs84) || value.anchorWgs84.length !== 3 || value.anchorWgs84.some((part) => !finite(part))) issue(issues, "anchorWgs84", "Finite ENU anchor is required.");
  if (!record(value.transform) || value.transform.outputCrs !== "EPSG:4326" || !finite(value.transform.residualMeters)) issue(issues, "transform", "WGS84 transform record is required.");
  const claimCeilings = value.claimCeilings;
  for (const semantic of BLOCK835_PUBLIC_REALM_SEMANTICS) if (!record(claimCeilings) || !nonEmpty(claimCeilings[semantic])) issue(issues, `claimCeilings.${semantic}`, "Claim ceiling is required.");
  if (record(claimCeilings) && (!/current|survey/iu.test(String(claimCeilings.crosswalk)) || !/current|survey/iu.test(String(claimCeilings.curb)))) {
    issue(issues, "claimCeilings", "Curb/crosswalk claim ceilings must retain explicit uncertainty language.");
  }
  const features = value.features;
  if (!record(features) || features.intersections !== 4 || features.crosswalks !== 4 || !finite(features.roadbed) || !finite(features.sidewalk) || !finite(features.curbs)) issue(issues, "features", "Four intersections and all semantic counts are required.");
  const geometryValidation = value.geometryValidation;
  if (!record(geometryValidation) || geometryValidation.method !== "mathutils.geometry.tessellate_polygon" || geometryValidation.polygonContourResolution !== "full source resolution in LOD0 and LOD1" || !finite(geometryValidation.areaResidualToleranceRelative) || !finite(geometryValidation.maxObservedRelativeAreaError) || geometryValidation.maxObservedRelativeAreaError > geometryValidation.areaResidualToleranceRelative || !record(geometryValidation.holeRegression) || geometryValidation.holeRegression.sourceFeatureId !== "sidewalk:12380001933" || geometryValidation.holeRegression.expectedInteriorRingCount !== 1 || geometryValidation.holeRegression.observedInteriorRingCount !== 1 || geometryValidation.holeRegression.status !== "pass") issue(issues, "geometryValidation", "Concave/hole-preserving Blender tessellation evidence is required and must pass area/hole regression.");
  const assets = value.assetEntries;
  if (!Array.isArray(assets) || assets.length !== 8) issue(issues, "assetEntries", "Four semantic LOD0/LOD1 asset pairs are required.");
  else {
    const keys = new Set<string>();
    for (const asset of assets) {
      if (!record(asset) || !BLOCK835_PUBLIC_REALM_SEMANTICS.includes(asset.semantic as Block835PublicRealmSemantic) || !["lod0", "lod1"].includes(String(asset.lod)) || !sha256Pattern(asset.sha256) || !isSafeLocalReleaseReference(String(asset.relativeContentRef)) || !String(asset.relativeContentRef).startsWith(`assets/${BLOCK835_PUBLIC_REALM_RELEASE_ID}/`) || !finite(asset.byteSize) || !finite(asset.triangles) || !finite(asset.materials) || !finite(asset.textures)) issue(issues, "assetEntries", "Asset entries must be safe, hashed, finite, and local.");
      else keys.add(`${asset.semantic}:${asset.lod}`);
    }
    for (const semantic of BLOCK835_PUBLIC_REALM_SEMANTICS) for (const lod of ["lod0", "lod1"]) if (!keys.has(`${semantic}:${lod}`)) issue(issues, "assetEntries", `Missing ${semantic}/${lod} asset.`);
  }
  if (!Array.isArray(value.dataFileEntries) || value.dataFileEntries.length !== 3 || value.dataFileEntries.some((entry) => !record(entry) || !["features.json", "curbs.json", "crosswalks.json"].includes(String(entry.fileName)) || !sha256Pattern(entry.sha256) || !finite(entry.byteSize))) issue(issues, "dataFileEntries", "Three hashed local normalized data files are required.");
  if (!sha256Pattern(value.sourcePacketSha256)) issue(issues, "sourcePacketSha256", "Normalized source packet hash is required.");
  if (!record(value.provenance) || value.provenance.localOnly !== true || value.provenance.runtimeExternalNetwork !== false || !nonEmpty(value.provenance.disclaimer) || !nonEmpty(value.provenance.attribution)) issue(issues, "provenance", "Local-only provenance, attribution, and disclaimer are required.");
  if (!nonEmpty(value.fallback)) issue(issues, "fallback", "Component-scoped fail-closed fallback is required.");
  // Approval exclusions intentionally name disallowed providers; inspect only
  // lineage/content fields so those exclusions do not become false positives.
  const encoded = JSON.stringify({ sourceSnapshots: value.sourceSnapshots, clip: value.clip, transform: value.transform, provenance: value.provenance, assetEntries: value.assetEntries, dataFileEntries: value.dataFileEntries });
  if (/google|overpass|openstreetmap|overture/iu.test(encoded)) issue(issues, "$", "Prohibited provider lineage is present in the public-realm release.");
  return issues.length ? { ok: false, issues } : { ok: true, value: value as unknown as Block835PublicRealmReleaseDocument };
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto SHA-256 is unavailable; public-realm overlay failed closed.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

export type Block835PublicRealmFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function parseBlock835PublicRealmFault(value: string | null | undefined, developmentEnabled: boolean): Block835PublicRealmFault | null {
  if (!developmentEnabled || !value) return null;
  return (BLOCK835_PUBLIC_REALM_FAULTS as readonly string[]).includes(value) ? value as Block835PublicRealmFault : null;
}

function normalizeBasePath(basePath: string): string {
  if (!basePath.startsWith(`/data/${BLOCK835_PUBLIC_REALM_RELEASE_ID}/`) || !basePath.endsWith("/")) throw new Error("Public-realm base path is not the approved local release root.");
  return basePath;
}

function localDataPath(basePath: string, fileName: string): string {
  if (fileName.includes("..") || fileName.includes("\\") || !/^[a-z0-9._-]+\.json$/u.test(fileName)) throw new Error("Public-realm data path is unsafe.");
  return `${basePath}${fileName}`;
}

function localPublicRealmFaultPath(input: RequestInfo | URL): string | null {
  const raw = input instanceof URL ? input.href : typeof input === "string" ? input : input.url;
  const currentOrigin = typeof window !== "undefined" ? window.location.origin : null;
  try {
    const url = new URL(raw, currentOrigin ?? "http://block835-local.invalid");
    if (currentOrigin && url.origin !== currentOrigin) return null;
    if (!currentOrigin && !raw.startsWith("/")) return null;
    return url.pathname.startsWith(`/data/${BLOCK835_PUBLIC_REALM_RELEASE_ID}/`) || url.pathname.startsWith(`/assets/${BLOCK835_PUBLIC_REALM_RELEASE_ID}/`)
      ? url.pathname
      : null;
  } catch {
    return null;
  }
}

/** Development-only local fault seam; immutable release bytes are never changed. */
export function createBlock835PublicRealmFaultFetcher(
  fault: Block835PublicRealmFault,
  fetcher: Block835PublicRealmFetcher = globalThis.fetch.bind(globalThis),
): Block835PublicRealmFetcher {
  return async (input, init) => {
    const path = localPublicRealmFaultPath(input);
    if (!path) throw new Error("Public-realm development fault fetcher permits only current app-origin release files.");
    if (fault === "release" && path.endsWith("/release.json")) {
      return new Response("forced public-realm release fault", { status: 503, statusText: "Forced local fault" });
    }
    return fetcher(input, init);
  };
}

async function fetchJson(fetcher: Block835PublicRealmFetcher, url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetcher(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`Public-realm request failed (${response.status}) for ${url}.`);
  return response.json();
}

function featureRepresentative(feature: Block835PublicRealmFeature): [number, number] {
  let point: [number, number] | null = null;
  const walk = (part: unknown): void => {
    if (point || !Array.isArray(part)) return;
    if (part.length >= 2 && typeof part[0] === "number" && typeof part[1] === "number") { point = [part[0], part[1]]; return; }
    part.forEach(walk);
  };
  walk(feature.geometry.coordinates);
  return point ?? [0, 0];
}

export function publicRealmFeatureToFeature(feature: Block835PublicRealmFeature, generatedAt: string): Feature {
  const [longitude, latitude] = featureRepresentative(feature);
  const sourceIds = feature.sourceFeatureIds ?? (feature.sourceFeatureId ? [feature.sourceFeatureId] : []);
  const sourceRefs: SourceRef[] = sourceIds.map((sourceRecordId, index) => {
    const datasetId = feature.sourceDatasetId.startsWith("derived:") ? (index === 0 ? "xgwd-7vhd" : "x9uq-u3qs") : feature.sourceDatasetId;
    const registryEntryId = datasetId === "vfx9-tbb6" ? "nyc.oti-planimetrics-sidewalk-block835" : datasetId === "xgwd-7vhd" ? "nyc.oti-planimetrics-roadbed-block835" : "nyc.oti-planimetrics-pavement-edge-block835";
    return {
      schemaVersion: "1.0",
      id: `source-ref:block835-public-realm:${feature.id}:${index}`,
      registryEntryId,
      provider: "NYC Office of Technology and Innovation (OTI) Planimetrics",
      datasetId,
      sourceRecordId,
      sourceUrl: datasetId === "vfx9-tbb6" ? "https://data.cityofnewyork.us/City-Government/Sidewalk/vfx9-tbb6" : datasetId === "xgwd-7vhd" ? "https://data.cityofnewyork.us/City-Government/Roadbed/xgwd-7vhd" : "https://data.cityofnewyork.us/City-Government/Pavement-Edge/x9uq-u3qs",
      licenseRefId: `license:${registryEntryId}`,
      role: feature.claimLevel === "source-backed" ? "primary" : "derived",
      capturedAt: generatedAt,
      updatedAt: null,
      observedAt: generatedAt,
      release: BLOCK835_PUBLIC_REALM_RELEASE_ID,
    };
  });
  const geometry: Geometry = feature.geometry;
  return {
    schemaVersion: "1.0",
    id: `public-realm:${feature.id}`,
    cityId: "manhattan",
    kind: "street",
    name: `${feature.semantic}${feature.sourceFeatureId ? ` · ${feature.sourceFeatureId}` : feature.intersectionId ? ` · ${feature.intersectionId}` : ""}`,
    geometry,
    coordinates: [longitude, latitude],
    geometryProvenance: {
      schemaVersion: "1.0",
      sourceRefId: sourceRefs[0]?.id ?? `source-ref:block835-public-realm:${feature.id}`,
      inputCrs: "EPSG:4326",
      outputCrs: "EPSG:4326",
      capturedAt: generatedAt,
      height: { schemaVersion: "1.0", valueMeters: null, sourceValue: null, sourceUnit: "unknown", verticalDatum: feature.verticalDatum, sourceRefId: sourceRefs[0]?.id ?? null, method: feature.claimLevel === "source-backed" ? "source" : "derived", uncertaintyMeters: feature.uncertainty.verticalMeters },
      horizontalUncertaintyMeters: feature.uncertainty.horizontalMeters,
      notes: feature.claimLevel === "estimated" ? feature.uncertainty.temporal : "Source-backed planimetric horizontal geometry; not current survey truth.",
    },
    sourceRefs,
    provenance: feature.claimLevel === "source-backed" ? "authoritative" : "derived",
    confidence: feature.claimLevel === "source-backed" ? { score: 0.82, label: "high", rationale: "Official NYC OTI Planimetrics geometry retained in the approved immutable local snapshot." } : { score: 0.38, label: "low", rationale: "Deterministic derived public-realm geometry with an explicit estimated claim ceiling." },
    uncertainty: { horizontalMeters: feature.uncertainty.horizontalMeters, verticalMeters: feature.uncertainty.verticalMeters, temporalDays: null, notes: feature.uncertainty.temporal },
    freshness: { capturedAt: generatedAt, updatedAt: null, observedAt: generatedAt, ingestedAt: generatedAt },
    attributes: {
      publicRealmSemantic: feature.semantic,
      publicRealmClaimLevel: feature.claimLevel,
      publicRealmSourceDatasetId: feature.sourceDatasetId,
      publicRealmSourceRecordIds: JSON.stringify(sourceIds),
      publicRealmIntersectionId: feature.intersectionId ?? null,
      publicRealmDerivation: feature.derivation ? JSON.stringify(feature.derivation) : null,
      publicRealmAttribution: "NYC OTI Planimetrics via NYC Open Data; local snapshot; City disclaimer applies.",
    },
  };
}

function buildLoaded(document: Block835PublicRealmReleaseDocument, features: readonly Block835PublicRealmFeature[], verifiedContentRefs: ReadonlySet<string>, verifiedDataFiles: ReadonlySet<string>): LoadedBlock835PublicRealmRelease {
  const byId = new Map(features.map((feature) => [feature.id, feature]));
  const assets = new Map(document.assetEntries.map((entry) => [`${entry.semantic}:${entry.lod}`, entry]));
  return {
    document,
    features,
    verifiedContentRefs,
    verifiedDataFiles,
    assetFailures: [],
    compatibleWith: (baseReleaseId) => document.baseCompatibility.baseReleaseIds.includes(baseReleaseId),
    resolve: (semantic, distanceMeters = 240) => {
      const lod = distanceMeters <= 220 ? "lod0" : distanceMeters <= 900 ? "lod1" : null;
      if (!lod) return null;
      const entry = assets.get(`${semantic}:${lod}`);
      if (!entry || !verifiedContentRefs.has(entry.relativeContentRef)) return null;
      return { kind: "asset", semantic, lod, entry, uri: `/${entry.relativeContentRef}` };
    },
    feature: (featureId) => byId.get(featureId),
    featuresForSemantic: (semantic) => features.filter((feature) => feature.semantic === semantic),
  };
}

export async function loadBlock835PublicRealmRelease(
  basePath = `/data/${BLOCK835_PUBLIC_REALM_RELEASE_ID}/`,
  signal?: AbortSignal,
  fetcher: Block835PublicRealmFetcher = globalThis.fetch.bind(globalThis),
): Promise<LoadedBlock835PublicRealmRelease> {
  const normalizedPath = normalizeBasePath(basePath);
  const parsed = validateBlock835PublicRealmRelease(await fetchJson(fetcher, `${normalizedPath}release.json`, signal));
  if (!parsed.ok) throw new Error(`Block 835 public-realm manifest failed closed: ${parsed.issues.map((item) => `${item.path} ${item.message}`).join("; ")}`);
  const document = parsed.value;
  const verifiedDataFiles = new Set<string>();
  const dataSets: Block835PublicRealmFeature[] = [];
  for (const file of document.dataFileEntries) {
    const url = localDataPath(normalizedPath, file.fileName);
    const response = await fetcher(url, { signal, cache: "no-store" });
    if (!response.ok) throw new Error(`Block 835 public-realm data request failed (${response.status}) for ${url}.`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== file.byteSize || (await sha256(bytes)) !== file.sha256) throw new Error(`Block 835 public-realm data checksum mismatch for ${file.fileName}.`);
    const value = JSON.parse(new TextDecoder().decode(bytes));
    const expectedSemantic: Block835PublicRealmSemantic = file.fileName === "features.json" ? "roadbed" : file.fileName === "curbs.json" ? "curb" : "crosswalk";
    if (!record(value) || !Array.isArray(value.features)) throw new Error(`Block 835 public-realm data file ${file.fileName} failed schema validation.`);
    for (const feature of value.features) {
      if (!record(feature)) throw new Error(`Block 835 public-realm feature in ${file.fileName} is invalid.`);
      const isSourceSemantic = feature.semantic === "pavement-edge" || BLOCK835_PUBLIC_REALM_SEMANTICS.includes(feature.semantic as Block835PublicRealmSemantic);
      if (!isSourceSemantic || !validGeometry(feature.geometry)) throw new Error(`Block 835 public-realm feature in ${file.fileName} is invalid.`);
      if (file.fileName === "features.json" && feature.semantic !== "roadbed" && feature.semantic !== "sidewalk" && feature.semantic !== "pavement-edge") throw new Error(`Unexpected source semantic in ${file.fileName}.`);
      if (expectedSemantic === "curb" && feature.semantic !== "curb") throw new Error("Curb data file contains a non-curb feature.");
      if (expectedSemantic === "crosswalk" && feature.semantic !== "crosswalk") throw new Error("Crosswalk data file contains a non-crosswalk feature.");
      dataSets.push(feature as unknown as Block835PublicRealmFeature);
    }
    verifiedDataFiles.add(file.fileName);
  }
  // Pavement-edge records remain represented by the derived curb records in
  // the runtime semantic surface; the raw source partition is still retained
  // in the immutable normalized data file and in each curb's sourceFeatureIds.
  const features = dataSets.filter((feature) => (feature.semantic as string) !== "pavement-edge");
  const allFeatures = features;
  if (features.filter((feature) => feature.semantic === "roadbed").length !== document.features.roadbed || features.filter((feature) => feature.semantic === "sidewalk").length !== document.features.sidewalk || features.filter((feature) => feature.semantic === "curb").length !== document.features.curbs || features.filter((feature) => feature.semantic === "crosswalk").length !== document.features.crosswalks) throw new Error("Block 835 public-realm data counts do not match the release manifest.");
  const verifiedContentRefs = new Set<string>();
  for (const asset of document.assetEntries) {
    if (!isSafeLocalReleaseReference(asset.relativeContentRef) || !asset.relativeContentRef.startsWith(`assets/${BLOCK835_PUBLIC_REALM_RELEASE_ID}/`)) throw new Error(`Block 835 public-realm asset path is unsafe: ${asset.relativeContentRef}`);
    const response = await fetcher(`/${asset.relativeContentRef}`, { signal, cache: "no-store" });
    if (!response.ok) throw new Error(`Block 835 public-realm asset request failed (${response.status}) for ${asset.relativeContentRef}.`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== asset.byteSize || (await sha256(bytes)) !== asset.sha256) throw new Error(`Block 835 public-realm asset checksum mismatch for ${asset.relativeContentRef}.`);
    verifiedContentRefs.add(asset.relativeContentRef);
  }
  return buildLoaded(document, allFeatures, verifiedContentRefs, verifiedDataFiles);
}
