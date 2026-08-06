import {
  BLOCK_835_DOITT_IDS,
  COMMERCIAL_APPROVAL_ID,
  COMMERCIAL_RELEASE_ID,
  OSM_ODBL_LICENSE,
} from "../domain/commercial-frontage.ts";
import { CITYWIDE_RELEASE_ID } from "../release/citywide-release.ts";
import { TRAVEL_CONTEXT_RELEASE_ID } from "../release/travel-context-release.ts";
import {
  CityAssetResolver,
  validateCityAssetManifest,
  type CityAssetEntry,
  type CityAssetManifest,
  type CityAssetResolution,
} from "./city-asset-manifest.ts";
import { isSafeLocalReleaseReference } from "./path-security.ts";

export const EXTERIOR_PILOT_RELEASE_ID = COMMERCIAL_RELEASE_ID;
export const EXTERIOR_PILOT_BASE_RELEASE_IDS = [CITYWIDE_RELEASE_ID, TRAVEL_CONTEXT_RELEASE_ID] as const;
export const OSM_ATTRIBUTION = "Map data © OpenStreetMap contributors.";
export const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";

export interface CommercialTenantObservation {
  observationId: string;
  source: "nyc" | "osm" | "addresspoint" | "dohmh" | "dcwp";
  sourceRecordId: string;
  rawName: string | null;
  displayName: string | null;
  normalizedName: string | null;
  rawStatus?: string | null;
  sourceCapturedAt?: string | null;
  sourceDatasetUpdatedAt?: string | null;
  sourceRecordObservedAt?: string | null;
  statusObservedAt?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  coordinates?: readonly [number, number] | null;
  categories?: string[];
  structuredAddress?: { formatted?: string | null; unit?: string | null };
  evidenceIds?: string[];
  licensePartition: "nyc-independent" | "odbl-derived";
  uncertainty?: string;
}

export interface CommercialTenantEntity {
  canonicalTenantId: string;
  displayName: string | null;
  signText: string | null;
  observations: string[];
  status: string;
  matchConfidence: number;
  fieldProvenance?: unknown[];
  conflicts?: unknown[];
  uncertainty: string;
}

export interface CommercialBuildingLink {
  canonicalTenantId: string | null;
  canonicalBuildingId: string | null;
  decision: string;
  confidence: number;
  reasons: string[];
  candidates?: unknown[];
  sourceObservationId: string;
  addressPointId?: string | null;
  effectiveAt?: string | null;
  evidenceIds: string[];
  reversible: true;
  licensePartition: "nyc-independent" | "odbl-derived";
}

export interface CommercialStorefrontPlacement {
  storefrontId: string;
  canonicalTenantId: string | null;
  canonicalBuildingId: string | null;
  facadeSegmentId: string | null;
  anchorWgs84?: readonly [number, number] | null;
  headingDegrees?: number | null;
  widthMeters?: number | null;
  occupancyClass?: string;
  placementDecision: string;
  confidence: number;
  reasons: string[];
  evidenceIds: string[];
  geometryEvidenceLevel: string;
  signPolicy: "neutral-text-only" | "none";
  sourceObservationId?: string;
  rawName?: string | null;
  displayName?: string | null;
  rawStatus?: string | null;
  normalizedName?: string | null;
  licensePartition: "nyc-independent" | "odbl-derived";
}

export interface CommercialLicensePartition {
  partitionId: "nyc-independent" | "odbl-derived";
  license: string;
  sources: string[];
  attribution?: string;
  licenseUrl?: string;
  databaseOffer?: string;
}

export interface CommercialFrontageRelease {
  schemaVersion: string;
  releaseId: string;
  cityId: string;
  baseReleaseId: string;
  exteriorAssetPackageId: string;
  boundaryRule: { doittIds: string[]; buildings?: unknown[] };
  sourceSnapshots: Array<{ datasetId: string; rawSha256: string }>;
  licensePartitions: CommercialLicensePartition[];
  tenantObservations: CommercialTenantObservation[];
  tenantEntities: CommercialTenantEntity[];
  buildingOccupancyLinks: CommercialBuildingLink[];
  storefrontPlacements: CommercialStorefrontPlacement[];
  rejectionConflictSummary: Record<string, number>;
  totals: { buildings: number; parts?: number; lodAssets: number; acceptedSigns: number; storefrontPickProxies: number };
  budgets: { maxSigns: number; maxProxies: number; maxCompressedMetadataBytes: number };
  fallback: string;
}

export interface ExteriorPilotReleaseDocument {
  schemaVersion: string;
  releaseId: string;
  cityId: string;
  generatedAt: string;
  fixtureOnly: boolean;
  approval: { evidenceId: string; scope: string };
  baseReleaseId: string;
  boundaryRule: { doittIds: string[]; buildings?: unknown[] };
  sourceSnapshots: Array<{ datasetId: string; rawSha256: string }>;
  licensePartitions: CommercialLicensePartition[];
  commercialRelease: CommercialFrontageRelease;
  assets: CityAssetManifest;
  assetEntries: Array<{ id: string; lod: number; fileName: string; relativeContentRef: string; bytes: number; sha256: string; triangles?: number; materials?: number; textures?: number }>;
  sourcePacketSha256: string;
  validation?: { stage?: boolean; reimportEvidence?: string; renderEvidence?: string };
}

export interface ExteriorPilotValidationIssue { path: string; message: string }
export type ExteriorPilotValidationResult =
  | { ok: true; value: ExteriorPilotReleaseDocument }
  | { ok: false; issues: ExteriorPilotValidationIssue[] };

export interface ExteriorPilotAssetFailure {
  canonicalFeatureId: string;
  lod: string;
  relativeContentRef: string;
  code: "missing-content" | "checksum-mismatch" | "invalid-content";
  message: string;
}

export interface ExteriorPilotOverlayDiagnostics {
  overlay: "active" | "disabled";
  reason: string | null;
  assetFailures: ExteriorPilotAssetFailure[];
  buildingFallbacks: string[];
  acceptedStorefronts: number;
  unknownStorefronts: number;
  ambiguousStorefronts: number;
}

export interface LoadedExteriorPilotRelease {
  document: ExteriorPilotReleaseDocument;
  manifest: CityAssetManifest;
  resolver: CityAssetResolver;
  verifiedContentRefs: ReadonlySet<string>;
  assetFailures: readonly ExteriorPilotAssetFailure[];
  diagnostics: ExteriorPilotOverlayDiagnostics;
  compatibleWith(baseReleaseId: string): boolean;
  resolve(featureId: string, distanceMeters?: number, screenSpaceError?: number): CityAssetResolution;
  buildingEntry(featureId: string): CityAssetEntry | undefined;
  commercialForBuilding(featureId: string): CommercialBuildingOverlay;
  storefront(storefrontId: string): CommercialStorefrontPlacement | undefined;
}

export interface CommercialBuildingOverlay {
  canonicalBuildingId: string;
  visualEvidenceLevel: "licensed-near-real" | "source-constrained-massing";
  claim: string;
  entry: CityAssetEntry | undefined;
  links: readonly CommercialBuildingLink[];
  placements: readonly CommercialStorefrontPlacement[];
  unknownPlacements: readonly CommercialStorefrontPlacement[];
  acceptedPlacements: readonly CommercialStorefrontPlacement[];
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function sha256Pattern(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/iu.test(value); }
function exactIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length === BLOCK_835_DOITT_IDS.length && new Set(value).size === BLOCK_835_DOITT_IDS.length && BLOCK_835_DOITT_IDS.every((id) => value.includes(id));
}
function isoDate(value: unknown): value is string { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }
function issue(issues: ExteriorPilotValidationIssue[], path: string, message: string): void { issues.push({ path, message }); }

function validateCommercial(value: unknown, issues: ExteriorPilotValidationIssue[]): value is CommercialFrontageRelease {
  if (!record(value)) { issue(issues, "commercialRelease", "Commercial frontage release is required."); return false; }
  for (const field of ["schemaVersion", "releaseId", "cityId", "baseReleaseId", "exteriorAssetPackageId"] as const) if (!nonEmpty(value[field])) issue(issues, `commercialRelease.${field}`, "Non-empty field required.");
  if (value.releaseId !== EXTERIOR_PILOT_RELEASE_ID) issue(issues, "commercialRelease.releaseId", "Commercial release ID mismatch.");
  if (!exactIds((value.boundaryRule as Record<string, unknown> | undefined)?.doittIds)) issue(issues, "commercialRelease.boundaryRule.doittIds", "Commercial boundary must contain the exact 14 block-835 IDs.");
  const partitions = value.licensePartitions;
  if (!Array.isArray(partitions)) issue(issues, "commercialRelease.licensePartitions", "License partitions are required.");
  else {
    const nyc = partitions.find((partition) => record(partition) && partition.partitionId === "nyc-independent");
    const odbl = partitions.find((partition) => record(partition) && partition.partitionId === "odbl-derived");
    if (!record(nyc) || nyc.license !== "nyc-open-data-terms") issue(issues, "commercialRelease.licensePartitions.nyc-independent", "NYC independent partition is missing its terms claim.");
    if (!record(odbl) || odbl.license !== OSM_ODBL_LICENSE || odbl.attribution !== OSM_ATTRIBUTION || odbl.licenseUrl !== OSM_COPYRIGHT_URL || !nonEmpty(odbl.databaseOffer)) issue(issues, "commercialRelease.licensePartitions.odbl-derived", "ODbL partition must include exact attribution, copyright link, and database offer.");
  }
  for (const [field, required] of [["tenantObservations", true], ["tenantEntities", true], ["buildingOccupancyLinks", true], ["storefrontPlacements", true]] as const) if (required && !Array.isArray(value[field])) issue(issues, `commercialRelease.${field}`, "Array required.");
  const totals = value.totals;
  if (!record(totals) || totals.buildings !== 14 || totals.lodAssets !== 28 || !finite(totals.acceptedSigns) || totals.acceptedSigns < 0 || !finite(totals.storefrontPickProxies) || totals.storefrontPickProxies !== totals.acceptedSigns || totals.storefrontPickProxies > 32) issue(issues, "commercialRelease.totals", "Commercial totals must be exact and within the 32-sign/proxy ceiling.");
  const budgets = value.budgets;
  if (!record(budgets) || budgets.maxSigns !== 32 || budgets.maxProxies !== 32 || !Number.isSafeInteger(budgets.maxCompressedMetadataBytes)) issue(issues, "commercialRelease.budgets", "Commercial budgets are missing or changed.");
  if (!nonEmpty(value.fallback)) issue(issues, "commercialRelease.fallback", "Component-scoped fallback contract is required.");
  return true;
}

export function validateExteriorPilotRelease(value: unknown): ExteriorPilotValidationResult {
  const issues: ExteriorPilotValidationIssue[] = [];
  if (!record(value)) return { ok: false, issues: [{ path: "$", message: "Exterior release must be an object." }] };
  if (value.schemaVersion !== "1.0") issue(issues, "schemaVersion", "Unsupported exterior release schema.");
  if (value.releaseId !== EXTERIOR_PILOT_RELEASE_ID) issue(issues, "releaseId", "Exterior release ID mismatch.");
  if (value.cityId !== "manhattan") issue(issues, "cityId", "Exterior release city ID mismatch.");
  if (value.fixtureOnly !== false) issue(issues, "fixtureOnly", "Exterior release must be non-fixture.");
  if (!isoDate(value.generatedAt)) issue(issues, "generatedAt", "Exterior release generatedAt must be an ISO date.");
  if (!record(value.approval) || value.approval.evidenceId !== COMMERCIAL_APPROVAL_ID) issue(issues, "approval.evidenceId", "Original bounded-overpass approval evidence must remain attached.");
  if (!nonEmpty(value.baseReleaseId) || !EXTERIOR_PILOT_BASE_RELEASE_IDS.includes(value.baseReleaseId as (typeof EXTERIOR_PILOT_BASE_RELEASE_IDS)[number])) issue(issues, "baseReleaseId", "Exterior release must pin an approved citywide/civic base release.");
  if (!exactIds((value.boundaryRule as Record<string, unknown> | undefined)?.doittIds)) issue(issues, "boundaryRule.doittIds", "Exterior boundary must contain exactly the 14 block-835 IDs.");
  const sourceSnapshots = value.sourceSnapshots;
  if (!Array.isArray(sourceSnapshots) || sourceSnapshots.length < 5 || sourceSnapshots.some((snapshot) => !record(snapshot) || !nonEmpty(snapshot.datasetId) || !sha256Pattern(snapshot.rawSha256))) issue(issues, "sourceSnapshots", "Every source snapshot requires a dataset ID and SHA-256.");
  const partitions = value.licensePartitions;
  if (!Array.isArray(partitions)) issue(issues, "licensePartitions", "Top-level license partitions are required.");
  else if (!partitions.some((partition) => record(partition) && partition.partitionId === "odbl-derived" && partition.license === OSM_ODBL_LICENSE && partition.attribution === OSM_ATTRIBUTION && partition.licenseUrl === OSM_COPYRIGHT_URL && nonEmpty(partition.databaseOffer))) issue(issues, "licensePartitions.odbl-derived", "Top-level ODbL partition is missing exact metadata.");
  if (!validateCommercial(value.commercialRelease, issues)) { /* issues already recorded */ }
  const manifestValue = value.assets;
  const manifest = validateCityAssetManifest(manifestValue);
  if (!manifest.ok) manifest.issues.forEach((item) => issue(issues, `assets.${item.path}`, item.message));
  else {
    if (manifest.value.fixtureOnly || manifest.value.assets.length !== 14) issue(issues, "assets", "Exterior package must contain exactly 14 approved building assets.");
    const ids = manifest.value.assets.map((asset) => asset.canonicalFeatureId.replace(/^doitt:/u, ""));
    if (!exactIds(ids)) issue(issues, "assets.canonicalFeatureId", "Exterior asset IDs must match the exact block-835 matrix.");
    if (manifest.value.assets.some((asset) => asset.lodVariants.length !== 2)) issue(issues, "assets.lodVariants", "Every building requires LOD0 and LOD1.");
  }
  if (!Array.isArray(value.assetEntries) || value.assetEntries.length !== 28) issue(issues, "assetEntries", "Exterior package must contain exactly 28 LOD entries.");
  if (!sha256Pattern(value.sourcePacketSha256)) issue(issues, "sourcePacketSha256", "Normalized source packet SHA-256 is required.");
  const lineageString = JSON.stringify({
    approval: value.approval,
    baseReleaseId: value.baseReleaseId,
    sourceSnapshots: value.sourceSnapshots,
    licensePartitions: value.licensePartitions,
    assetLineage: manifest.ok ? manifest.value.assets.map((asset) => ({ lineage: asset.lineage, capture: asset.capture })) : [],
  });
  if (/google/iu.test(lineageString)) issue(issues, "$", "Google lineage is prohibited.");
  if (issues.length) return { ok: false, issues };
  return { ok: true, value: value as unknown as ExteriorPilotReleaseDocument };
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto SHA-256 is unavailable; exterior overlay failed closed.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

type ReleaseFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function fetchJson(fetcher: ReleaseFetcher, url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetcher(url, { signal, cache: "force-cache" });
  if (!response.ok) throw new Error(`Exterior overlay request failed (${response.status}) for ${url}.`);
  return response.json();
}

function normalizedBasePath(basePath: string): string {
  if (!basePath.startsWith(`/data/${EXTERIOR_PILOT_RELEASE_ID}/`) || !basePath.endsWith("/")) throw new Error("Exterior overlay base path is not the approved local release root.");
  return basePath;
}

function buildingClaim(canonicalFeatureId: string): { visualEvidenceLevel: CommercialBuildingOverlay["visualEvidenceLevel"]; claim: string } {
  const nearReal = canonicalFeatureId === "doitt:778052" || canonicalFeatureId === "doitt:131170";
  return nearReal
    ? { visualEvidenceLevel: "licensed-near-real", claim: "Near-real licensed details are limited to cited visible ESB/Herald evidence; unseen sides and roof remain unknown." }
    : { visualEvidenceLevel: "source-constrained-massing", claim: "Source-constrained OTI footprint/height massing; estimated facade/storefront geometry, with unsupported details unknown." };
}

function buildLoaded(document: ExteriorPilotReleaseDocument, verifiedContentRefs: ReadonlySet<string>, assetFailures: readonly ExteriorPilotAssetFailure[]): LoadedExteriorPilotRelease {
  const resolver = new CityAssetResolver(document.assets, { verifiedContentRefs });
  const commercial = document.commercialRelease;
  const buildingEntry = (featureId: string): CityAssetEntry | undefined => document.assets.assets.find((entry) => entry.canonicalFeatureId === featureId);
  const commercialForBuilding = (featureId: string): CommercialBuildingOverlay => {
    const { visualEvidenceLevel, claim } = buildingClaim(featureId);
    const links = commercial.buildingOccupancyLinks.filter((link) => link.canonicalBuildingId === featureId);
    const placements = commercial.storefrontPlacements.filter((placement) => placement.canonicalBuildingId === featureId);
    const acceptedPlacements = placements.filter((placement) => placement.signPolicy === "neutral-text-only" && placement.placementDecision.startsWith("storefront"));
    return { canonicalBuildingId: featureId, visualEvidenceLevel, claim, entry: buildingEntry(featureId), links, placements, unknownPlacements: placements.filter((placement) => placement.placementDecision === "unknown" || placement.placementDecision === "ambiguous"), acceptedPlacements };
  };
  const failedBuildings = [...new Set(assetFailures.map((failure) => failure.canonicalFeatureId))];
  const diagnostics: ExteriorPilotOverlayDiagnostics = {
    overlay: "active",
    reason: null,
    assetFailures: [...assetFailures],
    buildingFallbacks: failedBuildings,
    acceptedStorefronts: commercial.totals.acceptedSigns,
    unknownStorefronts: Number(commercial.rejectionConflictSummary.unknownStorefronts ?? 0),
    ambiguousStorefronts: Number(commercial.rejectionConflictSummary.ambiguousStorefronts ?? 0),
  };
  return {
    document,
    manifest: document.assets,
    resolver,
    verifiedContentRefs,
    assetFailures,
    diagnostics,
    compatibleWith: (baseReleaseId: string) => document.baseReleaseId === CITYWIDE_RELEASE_ID && EXTERIOR_PILOT_BASE_RELEASE_IDS.includes(baseReleaseId as (typeof EXTERIOR_PILOT_BASE_RELEASE_IDS)[number]),
    resolve: (featureId, distanceMeters = 240, screenSpaceError = 1) => resolver.resolve(featureId, distanceMeters, screenSpaceError),
    buildingEntry,
    commercialForBuilding,
    storefront: (storefrontId) => commercial.storefrontPlacements.find((placement) => placement.storefrontId === storefrontId),
  };
}

/** Load and checksum the immutable local overlay; one bad GLB falls back only that building. */
export async function loadExteriorPilotRelease(
  basePath = `/data/${EXTERIOR_PILOT_RELEASE_ID}/`,
  signal?: AbortSignal,
  fetcher: ReleaseFetcher = globalThis.fetch.bind(globalThis),
): Promise<LoadedExteriorPilotRelease> {
  const normalizedPath = normalizedBasePath(basePath);
  const parsed = validateExteriorPilotRelease(await fetchJson(fetcher, `${normalizedPath}release.json`, signal));
  if (!parsed.ok) throw new Error(`Exterior overlay manifest failed closed: ${parsed.issues.map((item) => `${item.path} ${item.message}`).join("; ")}`);
  const document = parsed.value;
  const verified = new Set<string>();
  const assetFailures: ExteriorPilotAssetFailure[] = [];
  for (const asset of document.assets.assets) {
    for (const lod of asset.lodVariants) {
      if (!isSafeLocalReleaseReference(lod.content.relativeContentRef) || !lod.content.relativeContentRef.startsWith(`assets/${EXTERIOR_PILOT_RELEASE_ID}/`)) {
        assetFailures.push({ canonicalFeatureId: asset.canonicalFeatureId, lod: lod.id, relativeContentRef: lod.content.relativeContentRef, code: "invalid-content", message: "Asset path is not a safe local exterior package reference; procedural building fallback remains active." });
        continue;
      }
      try {
        const response = await fetcher(`/${lod.content.relativeContentRef}`, { signal, cache: "force-cache" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength !== lod.content.byteSize || (await sha256(bytes)).toLowerCase() !== lod.content.sha256.toLowerCase()) throw new Error("checksum/byte-size mismatch");
        verified.add(lod.content.relativeContentRef);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        assetFailures.push({ canonicalFeatureId: asset.canonicalFeatureId, lod: lod.id, relativeContentRef: lod.content.relativeContentRef, code: error instanceof Error && error.message.includes("HTTP") ? "missing-content" : "checksum-mismatch", message: `${error instanceof Error ? error.message : "Asset content unavailable"}; procedural building fallback remains active.` });
      }
    }
  }
  return buildLoaded(document, verified, assetFailures);
}
