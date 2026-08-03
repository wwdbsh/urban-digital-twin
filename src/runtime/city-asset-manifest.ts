import { getSourceRegistryEntry, licenseRegistry } from "../data/source-registry.ts";
import type { Feature } from "../domain/schema.ts";
import { isSafeLocalReleaseReference } from "./path-security.ts";

/** Provider-neutral handoff contract for approved Blender (or other) GLB/glTF output. */
export const CITY_ASSET_MANIFEST_SCHEMA_VERSION = "1.0" as const;
export type CityAssetFormat = "glb" | "gltf";
export type CityAssetFeatureKind = "building" | "landmark" | "facility" | "transit-station" | "transit-entrance" | "poi";
export type CityAssetApprovalState = "pending" | "approved" | "rejected";
export type CityAssetApprovalScope = "test-only" | "ingestion" | "runtime";

export interface CityAssetLineage {
  sourceRegistryEntryIds: string[];
  sourceRefIds: string[];
  licenseRefIds: string[];
  attribution: string;
}

export interface CityAssetApproval {
  fixtureOnly: boolean;
  state: CityAssetApprovalState;
  scope: CityAssetApprovalScope;
  reviewedAt: string;
  note: string;
}

export interface Wgs84Anchor {
  longitude: number;
  latitude: number;
  heightMeters: number;
}

export interface LocalAssetTransform {
  coordinateFrame: "ENU";
  units: "meters";
  origin: "wgs84-anchor";
  /** Row-major 4x4 affine matrix from asset-local ENU coordinates to anchor-local coordinates. */
  matrix: number[];
  /** Heading is clockwise from true north; local +X east, +Y north, +Z up. */
  orientationConvention: "heading-degrees-clockwise-from-north;local+x-east;local+y-north;local+z-up;right-handed";
}

export interface AssetBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export interface AssetContentReference {
  relativeContentRef: string;
  format: CityAssetFormat;
  sha256: string;
  byteSize: number;
  /** Metadata-only is an explicit fixture state: it is never runtime-eligible. */
  contentStatus: "metadata-only" | "staged" | "verified";
}

export interface CityAssetLodVariant {
  id: string;
  geometricErrorMeters: number;
  selection: {
    maxDistanceMeters: number | null;
    maxScreenSpaceError: number;
  };
  content: AssetContentReference;
}

export interface AssetBudgets {
  maxTriangles: number;
  maxMaterials: number;
  maxTextures: number;
}

export interface AssetQuality {
  triangleCount: number;
  materialCount: number;
  textureCount: number;
  budgets: AssetBudgets;
}

export interface ProvidedProxyMetadata {
  provided: true;
  relativeContentRef?: string;
  note: string;
}

export interface CityAssetEntry {
  canonicalFeatureId: string;
  featureKind: CityAssetFeatureKind;
  lineage: CityAssetLineage;
  capture: { capturedAt: string | null; authoredAt: string; updatedAt: string | null };
  approval: CityAssetApproval;
  wgs84Anchor: Wgs84Anchor;
  transform: LocalAssetTransform;
  bounds: AssetBounds;
  lodVariants: CityAssetLodVariant[];
  quality: AssetQuality;
  uncertaintyNotes: string;
  accessibility?: ProvidedProxyMetadata;
  collision?: ProvidedProxyMetadata;
  pickingProxy?: ProvidedProxyMetadata;
}

export interface CityAssetManifest {
  schemaVersion: typeof CITY_ASSET_MANIFEST_SCHEMA_VERSION;
  manifestId: string;
  cityId: string;
  generatedAt: string;
  fixtureOnly: boolean;
  assets: CityAssetEntry[];
}

export interface CityAssetValidationIssue { path: string; message: string; }
export type CityAssetValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: CityAssetValidationIssue[] };

const HEX_SHA256 = /^[a-f0-9]{64}$/i;
const ASSET_KINDS = new Set<CityAssetFeatureKind>(["building", "landmark", "facility", "transit-station", "transit-entrance", "poi"]);
const ORIENTATION = "heading-degrees-clockwise-from-north;local+x-east;local+y-north;local+z-up;right-handed" as const;

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function timestamp(value: unknown, nullable = false): value is string | null { return (nullable && value === null) || (typeof value === "string" && !Number.isNaN(Date.parse(value))); }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function uniqueStrings(value: unknown): value is string[] { return Array.isArray(value) && value.length > 0 && value.every(nonEmpty) && new Set(value).size === value.length; }
function issue(issues: CityAssetValidationIssue[], path: string, message: string): void { issues.push({ path, message }); }
function vector(value: unknown, path: string, issues: CityAssetValidationIssue[], strictOrder = false): value is [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(finite)) { issue(issues, path, "Expected three finite numbers."); return false; }
  if (strictOrder && (value[0]! >= value[1]! || value[1]! >= value[2]!)) issue(issues, path, "Bounds vector must be ordered only by axis, not by magnitude.");
  return true;
}

function validateContent(value: unknown, path: string, issues: CityAssetValidationIssue[], refs: Set<string>): value is AssetContentReference {
  if (!record(value)) { issue(issues, path, "Content reference is required."); return false; }
  if (!isSafeLocalReleaseReference(value.relativeContentRef) || !/\.(glb|gltf)$/i.test(String(value.relativeContentRef))) issue(issues, `${path}.relativeContentRef`, "Content reference must be a unique normalized local .glb or .gltf path.");
  if (typeof value.relativeContentRef === "string") { if (refs.has(value.relativeContentRef)) issue(issues, `${path}.relativeContentRef`, "Content references must be unique across the manifest."); refs.add(value.relativeContentRef); }
  if (value.format !== "glb" && value.format !== "gltf") issue(issues, `${path}.format`, "Only GLB and glTF content is supported.");
  if (typeof value.sha256 !== "string" || !HEX_SHA256.test(value.sha256)) issue(issues, `${path}.sha256`, "A SHA-256 content checksum is required.");
  if (!Number.isSafeInteger(value.byteSize) || (value.byteSize as number) < 0) issue(issues, `${path}.byteSize`, "Content byte size must be a non-negative safe integer.");
  if (!["metadata-only", "staged", "verified"].includes(String(value.contentStatus))) issue(issues, `${path}.contentStatus`, "Content status must be metadata-only, staged, or verified.");
  return true;
}

function validateEntry(value: unknown, path: string, packageFixtureOnly: boolean, featureIds: Set<string>, refs: Set<string>, issues: CityAssetValidationIssue[]): value is CityAssetEntry {
  if (!record(value)) { issue(issues, path, "Asset entry is required."); return false; }
  if (!nonEmpty(value.canonicalFeatureId)) issue(issues, `${path}.canonicalFeatureId`, "Canonical feature ID is required.");
  else if (featureIds.has(value.canonicalFeatureId)) issue(issues, `${path}.canonicalFeatureId`, "Canonical feature IDs must be unique."); else featureIds.add(value.canonicalFeatureId);
  if (!ASSET_KINDS.has(value.featureKind as CityAssetFeatureKind)) issue(issues, `${path}.featureKind`, "Unsupported asset feature kind.");
  const lineage = value.lineage;
  if (!record(lineage)) issue(issues, `${path}.lineage`, "Source registry, source reference, license and attribution lineage are required.");
  else {
    for (const field of ["sourceRegistryEntryIds", "sourceRefIds", "licenseRefIds"] as const) if (!uniqueStrings(lineage[field])) issue(issues, `${path}.lineage.${field}`, "Lineage must contain unique non-empty IDs.");
    if (!nonEmpty(lineage.attribution)) issue(issues, `${path}.lineage.attribution`, "Attribution is required.");
    if (Array.isArray(lineage.sourceRegistryEntryIds)) lineage.sourceRegistryEntryIds.forEach((id, index) => { const source = getSourceRegistryEntry(String(id)); if (!source) issue(issues, `${path}.lineage.sourceRegistryEntryIds[${index}]`, `Unknown source registry entry: ${String(id)}.`); else if (!packageFixtureOnly && (source.approval.state !== "approved" || source.licenseClass === "fixture-only")) issue(issues, `${path}.lineage.sourceRegistryEntryIds[${index}]`, "Unapproved or fixture-only source cannot support a production asset claim."); });
    if (Array.isArray(lineage.licenseRefIds)) lineage.licenseRefIds.forEach((id, index) => { if (!licenseRegistry.some((license) => license.id === id)) issue(issues, `${path}.lineage.licenseRefIds[${index}]`, `Unknown license reference: ${String(id)}.`); });
  }
  const capture = value.capture;
  if (!record(capture) || !timestamp(capture.authoredAt) || !timestamp(capture.capturedAt, true) || !timestamp(capture.updatedAt, true)) issue(issues, `${path}.capture`, "Captured, authored and updated timestamps are required and must be ISO dates (nullable where declared).\n");
  const approval = value.approval;
  if (!record(approval) || typeof approval.fixtureOnly !== "boolean" || !["pending", "approved", "rejected"].includes(String(approval.state)) || !["test-only", "ingestion", "runtime"].includes(String(approval.scope)) || !timestamp(approval.reviewedAt) || !nonEmpty(approval.note)) issue(issues, `${path}.approval`, "Fixture/approval state, scope, review timestamp and note are required.");
  else {
    if (approval.fixtureOnly !== packageFixtureOnly) issue(issues, `${path}.approval.fixtureOnly`, "Entry fixtureOnly must match the manifest fixtureOnly claim.");
    if (!approval.fixtureOnly && (approval.state !== "approved" || approval.scope !== "runtime")) issue(issues, `${path}.approval`, "Production assets require approved runtime scope.");
    if (approval.fixtureOnly && approval.scope !== "test-only") issue(issues, `${path}.approval.scope`, "Fixture assets must be scoped test-only.");
  }
  const anchor = value.wgs84Anchor;
  if (!record(anchor) || !finite(anchor.longitude) || anchor.longitude < -180 || anchor.longitude > 180 || !finite(anchor.latitude) || anchor.latitude < -90 || anchor.latitude > 90 || !finite(anchor.heightMeters)) issue(issues, `${path}.wgs84Anchor`, "WGS84 anchor must contain finite longitude/latitude/height in bounds.");
  const transform = value.transform;
  if (!record(transform) || transform.coordinateFrame !== "ENU" || transform.units !== "meters" || transform.origin !== "wgs84-anchor" || transform.orientationConvention !== ORIENTATION || !Array.isArray(transform.matrix) || transform.matrix.length !== 16 || !transform.matrix.every(finite)) issue(issues, `${path}.transform`, "Transform must be a finite 4x4 ENU/meters matrix with the documented orientation convention.");
  else {
    const matrix = transform.matrix as number[];
    if (matrix.some((part) => Math.abs(part) > 1_000_000) || matrix[12] !== 0 || matrix[13] !== 0 || matrix[14] !== 0 || matrix[15] !== 1) issue(issues, `${path}.transform.matrix`, "Unsafe transform: non-affine row or unreasonable value.");
    const determinant = matrix[0]! * (matrix[5]! * matrix[10]! - matrix[6]! * matrix[9]!) - matrix[1]! * (matrix[4]! * matrix[10]! - matrix[6]! * matrix[8]!) + matrix[2]! * (matrix[4]! * matrix[9]! - matrix[5]! * matrix[8]!);
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-9) issue(issues, `${path}.transform.matrix`, "Transform rotation/scale is singular.");
  }
  const bounds = value.bounds;
  if (!record(bounds) || !vector(bounds.min, `${path}.bounds.min`, issues) || !vector(bounds.max, `${path}.bounds.max`, issues)) issue(issues, `${path}.bounds`, "A finite local bounding box is required.");
  else if ((bounds.min as number[]).some((part, index) => part >= (bounds.max as number[])[index]! || Math.abs(part) > 1_000_000 || Math.abs((bounds.max as number[])[index]!) > 1_000_000)) issue(issues, `${path}.bounds`, "Bounds must be ordered and within safe local limits.");
  const variants = value.lodVariants;
  if (!Array.isArray(variants) || variants.length === 0) issue(issues, `${path}.lodVariants`, "At least one LOD variant is required.");
  else {
    const lodIds = new Set<string>(); let previousDistance = -1;
    variants.forEach((variant, index) => {
      const variantPath = `${path}.lodVariants[${index}]`;
      if (!record(variant) || !nonEmpty(variant.id) || lodIds.has(String(variant.id))) issue(issues, `${variantPath}.id`, "LOD IDs must be unique and non-empty."); else lodIds.add(variant.id as string);
      if (!finite(variant.geometricErrorMeters) || (variant.geometricErrorMeters as number) < 0) issue(issues, `${variantPath}.geometricErrorMeters`, "Geometric error must be non-negative.");
      const selection = variant.selection;
      if (!record(selection) || (selection.maxDistanceMeters !== null && (!finite(selection.maxDistanceMeters) || selection.maxDistanceMeters < 0)) || !finite(selection.maxScreenSpaceError) || selection.maxScreenSpaceError < 0) issue(issues, `${variantPath}.selection`, "LOD selection requires non-negative distance and screen-space error semantics.");
      else { const distance = selection.maxDistanceMeters === null ? Number.POSITIVE_INFINITY : selection.maxDistanceMeters; if (distance < previousDistance) issue(issues, `${variantPath}.selection.maxDistanceMeters`, "LOD variants must be ordered from near to far."); previousDistance = distance; }
      validateContent(variant.content, `${variantPath}.content`, issues, refs);
      if (!packageFixtureOnly && record(variant.content) && variant.content.contentStatus === "metadata-only") issue(issues, `${variantPath}.content.contentStatus`, "Metadata-only content cannot support a production asset claim.");
    });
  }
  const quality = value.quality;
  if (!record(quality)) issue(issues, `${path}.quality`, "Triangle/material/texture counts and budgets are required.");
  else {
    const qualityRecord = quality as Record<string, unknown>;
    for (const field of ["triangleCount", "materialCount", "textureCount"] as const) if (!Number.isSafeInteger(qualityRecord[field]) || (qualityRecord[field] as number) < 0) issue(issues, `${path}.quality.${field}`, "Budget count must be a non-negative safe integer.");
    const budgets = qualityRecord.budgets;
    if (!record(budgets)) issue(issues, `${path}.quality.budgets`, "All quality budgets are required.");
    else {
      const budgetFields = [["maxTriangles", "triangleCount"], ["maxMaterials", "materialCount"], ["maxTextures", "textureCount"]] as const;
      const budgetRecord = budgets as Record<string, unknown>;
      for (const [budgetField, countField] of budgetFields) if (!Number.isSafeInteger(budgetRecord[budgetField]) || (budgetRecord[budgetField] as number) < 0 || (Number.isSafeInteger(qualityRecord[countField]) && (qualityRecord[countField] as number) > (budgetRecord[budgetField] as number))) issue(issues, `${path}.quality.budgets.${budgetField}`, "Declared count exceeds its declared budget.");
    }
  }
  if (!nonEmpty(value.uncertaintyNotes)) issue(issues, `${path}.uncertaintyNotes`, "Explicit quality/uncertainty notes are required.");
  for (const field of ["accessibility", "collision", "pickingProxy"] as const) {
    const proxy = value[field];
    if (proxy !== undefined && (!record(proxy) || proxy.provided !== true || !nonEmpty(proxy.note) || (proxy.relativeContentRef !== undefined && !isSafeLocalReleaseReference(proxy.relativeContentRef)))) issue(issues, `${path}.${field}`, "Optional proxy metadata is allowed only when actually provided and safely referenced.");
  }
  return true;
}

export function validateCityAssetManifest(value: unknown): CityAssetValidationResult<CityAssetManifest> {
  const issues: CityAssetValidationIssue[] = [];
  if (!record(value)) return { ok: false, issues: [{ path: "$", message: "Expected a CityAssetManifest object." }] };
  if (value.schemaVersion !== CITY_ASSET_MANIFEST_SCHEMA_VERSION) issue(issues, "schemaVersion", "Unsupported city asset manifest schema version.");
  for (const field of ["manifestId", "cityId"] as const) if (!nonEmpty(value[field])) issue(issues, field, "Required manifest identity is missing.");
  if (!timestamp(value.generatedAt)) issue(issues, "generatedAt", "Manifest generatedAt must be an ISO timestamp.");
  if (typeof value.fixtureOnly !== "boolean") issue(issues, "fixtureOnly", "Manifest fixtureOnly claim is required.");
  if (!Array.isArray(value.assets)) issue(issues, "assets", "Manifest assets must be an array.");
  const featureIds = new Set<string>(); const refs = new Set<string>();
  if (Array.isArray(value.assets)) value.assets.forEach((asset, index) => validateEntry(asset, `assets[${index}]`, value.fixtureOnly === true, featureIds, refs, issues));
  return issues.length ? { ok: false, issues } : { ok: true, value: value as unknown as CityAssetManifest };
}

export interface AssetResolutionDiagnostic { code: string; message: string; }
export type CityAssetResolution =
  | { kind: "asset"; featureId: string; entry: CityAssetEntry; lod: CityAssetLodVariant }
  | { kind: "procedural-fallback"; featureId: string; diagnostic: AssetResolutionDiagnostic };

export interface CityAssetResolverOptions {
  verifiedContentRefs?: ReadonlySet<string>;
  validateManifest?: boolean;
}

/** Resolve only content that passed package integrity and approval gates. */
export class CityAssetResolver {
  readonly manifest: CityAssetManifest;
  readonly diagnostics: CityAssetValidationIssue[];
  private readonly verifiedContentRefs: ReadonlySet<string>;

  constructor(manifest: CityAssetManifest, options: CityAssetResolverOptions = {}) {
    this.manifest = manifest;
    this.verifiedContentRefs = options.verifiedContentRefs ?? new Set<string>();
    const validation = options.validateManifest === false ? { ok: true as const, value: manifest } : validateCityAssetManifest(manifest);
    this.diagnostics = validation.ok ? [] : validation.issues;
  }

  resolve(featureId: string, distanceMeters: number, screenSpaceError = 1): CityAssetResolution {
    const fallback = (code: string, message: string): CityAssetResolution => ({ kind: "procedural-fallback", featureId, diagnostic: { code, message } });
    if (this.diagnostics.length) return fallback("manifest-invalid", "Asset manifest failed closed validation; procedural geometry remains active.");
    if (!Number.isFinite(distanceMeters) || distanceMeters < 0 || !Number.isFinite(screenSpaceError) || screenSpaceError < 0) return fallback("unsafe-view-metrics", "Asset LOD request has unsafe distance or screen-space error.");
    const entry = this.manifest.assets.find((candidate) => candidate.canonicalFeatureId === featureId);
    if (!entry) return fallback("asset-missing", "No asset is registered for this canonical feature; procedural geometry remains active.");
    if (entry.approval.fixtureOnly || entry.approval.state !== "approved" || entry.approval.scope !== "runtime") return fallback("asset-unapproved", "Registered asset is fixture-only or not approved for runtime; procedural geometry remains active.");
    const lod = entry.lodVariants.find((candidate) => (candidate.selection.maxDistanceMeters === null || distanceMeters <= candidate.selection.maxDistanceMeters) && screenSpaceError <= candidate.selection.maxScreenSpaceError);
    if (!lod) return fallback("lod-unavailable", "No LOD variant accepts the current distance and screen-space error; procedural geometry remains active.");
    if (!this.verifiedContentRefs.has(lod.content.relativeContentRef) || lod.content.contentStatus !== "verified") return fallback("content-unverified", "Asset metadata is present but immutable content integrity is not verified; procedural geometry remains active.");
    return { kind: "asset", featureId, entry, lod };
  }

  countByStatus(): { registered: number; approved: number; verified: number; fallback: number } {
    const registered = this.manifest.assets.length;
    const approved = this.manifest.assets.filter((entry) => !entry.approval.fixtureOnly && entry.approval.state === "approved" && entry.approval.scope === "runtime").length;
    const verified = this.manifest.assets.flatMap((entry) => entry.lodVariants).filter((lod) => this.verifiedContentRefs.has(lod.content.relativeContentRef) && lod.content.contentStatus === "verified").length;
    return { registered, approved, verified, fallback: registered - approved };
  }
}

export const IDENTITY_MATRIX: number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** A metadata-only fixture is useful for exercising handoff, diagnostics and fallback without a fake model. */
export function buildMetadataOnlyFixtureAssetManifest(features: readonly Feature[], generatedAt = "2026-08-03T00:00:00Z"): CityAssetManifest {
  const assets: CityAssetEntry[] = features.flatMap((feature, index) => {
    const featureKind = feature.kind === "building" || feature.kind === "landmark" || feature.kind === "facility" || feature.kind === "transit-station" || feature.kind === "transit-entrance" || feature.kind === "poi" ? feature.kind : null;
    const source = feature.sourceRefs[0];
    if (!featureKind || !source) return [];
    return [{
      canonicalFeatureId: feature.id,
      featureKind,
      lineage: { sourceRegistryEntryIds: [source.registryEntryId], sourceRefIds: [source.id], licenseRefIds: [source.licenseRefId], attribution: `Metadata-only fixture lineage: ${source.provider}.` },
      capture: { capturedAt: feature.freshness.capturedAt, authoredAt: generatedAt, updatedAt: feature.freshness.updatedAt },
      approval: { fixtureOnly: true, state: "approved", scope: "test-only", reviewedAt: generatedAt, note: "Metadata-only fixture; no model binary or production visual-fidelity claim." },
      wgs84Anchor: { longitude: feature.coordinates[0], latitude: feature.coordinates[1], heightMeters: feature.geometryProvenance.height.valueMeters ?? 0 },
      transform: { coordinateFrame: "ENU", units: "meters", origin: "wgs84-anchor", matrix: [...IDENTITY_MATRIX], orientationConvention: ORIENTATION },
      bounds: { min: [-1, -1, 0], max: [1, 1, 1] },
      lodVariants: [{ id: "fixture-lod", geometricErrorMeters: 1, selection: { maxDistanceMeters: null, maxScreenSpaceError: 16 }, content: { relativeContentRef: `fixtures/assets/${index}-${featureKind}.glb`, format: "glb", sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", byteSize: 0, contentStatus: "metadata-only" } }],
      quality: { triangleCount: 0, materialCount: 0, textureCount: 0, budgets: { maxTriangles: 0, maxMaterials: 0, maxTextures: 0 } },
      uncertaintyNotes: "Synthetic metadata only; no geometry fidelity, architectural detail, collision, accessibility or picking proxy is claimed.",
    } satisfies CityAssetEntry];
  });
  return { schemaVersion: CITY_ASSET_MANIFEST_SCHEMA_VERSION, manifestId: "fixture-city-asset-manifest-v1", cityId: "manhattan", generatedAt, fixtureOnly: true, assets };
}
