import { domainSeparatedSha256, stableSerialize } from "../domain/deterministic-hash.ts";
import { isSafeReleaseArtifactReference } from "../runtime/path-security.ts";

export const MULTI_LOD_ASSEMBLY_SCHEMA_VERSION = "1.0" as const;
export const MULTI_LOD_ASSEMBLY_LIMITS = {
  assets: 50_000, artifacts: 200_000, cells: 20_000, lodsPerAsset: 8,
  artifactBytes: 256 * 1024 * 1024, totalBytes: 8 * 1024 * 1024 * 1024,
  glbJsonBytes: 16 * 1024 * 1024, accessors: 200_000, primitives: 200_000,
  glbScannedComponents: 10_000_000,
  bufferViews: 200_000, meshes: 50_000, materials: 10_000, textures: 10_000,
  nodes: 200_000, scenes: 10_000, tileNodes: 200_000, tileDepth: 32,
} as const;

export type AssemblyAudience = "private" | "public";
export type ComponentTruthTier = "generated" | "evidence-backed" | "absent" | "not-applicable";
export interface ImmutablePin { id: string; checksumSha256: string }
export interface AssemblyArtifact {
  logicalId: string;
  role: "tileset-json" | "glb";
  relativeRef: string;
  byteSize: number;
  checksumSha256: string;
  ownerCellId: string | null;
}
export interface AssemblyCell {
  cellId: string;
  cellRelease: ImmutablePin;
  predecessor: ImmutablePin | null;
  buildingIds: string[];
  membershipChecksumSha256: string;
}
export type AssemblyAssetSource =
  | { kind: "facade-plan"; planId: string; planHashSha256: string }
  | { kind: "authored-override"; assetManifestId: string; assetManifestChecksumSha256: string; approvalFingerprintSha256: string };
export interface AssemblyLod {
  lodId: string;
  artifactRef: string;
  geometricErrorMeters: number;
  maxDistanceMeters: number | null;
  eligible: boolean;
  quality: {
    triangleCount: number; materialCount: number; textureCount: number;
    budgets: { maxTriangles: number; maxMaterials: number; maxTextures: number };
  };
  silhouette: null | {
    status: "authoring-declared";
    method: "projected-silhouette-ratio";
    metricVersion: "1.0";
    planHashSha256: string;
    viewIds: string[];
    deviationRatio: number;
    maximumRatio: 0.02;
  };
}
export interface AssemblyAsset {
  canonicalFeatureId: string;
  ownerCellId: string;
  inventoryId: string;
  inventoryHashSha256: string;
  evidenceShardId: string;
  truthTiers: ComponentTruthTier[];
  sourceDates: { capturedAt: string | null; updatedAt: string | null };
  predecessor: ImmutablePin | null;
  uncertainty: string;
  source: AssemblyAssetSource;
  lods: AssemblyLod[];
}
export interface MultiLodAssemblyManifest {
  schemaVersion: typeof MULTI_LOD_ASSEMBLY_SCHEMA_VERSION;
  packageId: string;
  audience: AssemblyAudience;
  generatedAt: string;
  immutable: true;
  release: { rootId: string; rootChecksumSha256: string; releaseId: string; cityId: string; configId: string; privatePredecessor: ImmutablePin | null };
  baseIdentitySet: ImmutablePin;
  ownershipLedger: ImmutablePin;
  cells: AssemblyCell[];
  assets: AssemblyAsset[];
  artifacts: AssemblyArtifact[];
  tilesetRef: string;
  declaredTotalBytes: number;
}
export interface AssemblyIssue { path: string; message: string }
export type AssemblyValidation<T = MultiLodAssemblyManifest> = { ok: true; value: T } | { ok: false; issues: AssemblyIssue[] };
export interface ParsedGlb { json: Record<string, unknown>; jsonBytes: number; binBytes: number }
export interface AssemblyReplay {
  manifest: MultiLodAssemblyManifest;
  fingerprintSha256: string;
  verifiedArtifacts: Array<{ relativeRef: string; byteSize: number; checksumSha256: string }>;
  totalBytes: number;
  cellBytes: Record<string, number>;
}

const HASH = /^[a-f0-9]{64}$/u;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const TRUTH = new Set<ComponentTruthTier>(["generated", "evidence-backed", "absent", "not-applicable"]);
function rec(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function hash(value: unknown): value is string { return typeof value === "string" && HASH.test(value); }
function iso(value: unknown, nullable = false): value is string | null { return (nullable && value === null) || (typeof value === "string" && ISO.test(value) && new Date(value).toISOString() === value); }
function finite(value: unknown, minimum = Number.NEGATIVE_INFINITY): value is number { return typeof value === "number" && Number.isFinite(value) && value >= minimum; }
function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number { return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum; }
function add(left: number, right: number): number | null { const value = left + right; return Number.isSafeInteger(value) ? value : null; }
function issue(issues: AssemblyIssue[], path: string, message: string): void { issues.push({ path, message }); }
function exact(value: Record<string, unknown>, keys: readonly string[], path: string, issues: AssemblyIssue[]): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) issue(issues, `${path}.${key}`, "Unexpected field.");
  for (const key of keys) if (!(key in value)) issue(issues, `${path}.${key}`, "Required field is missing.");
}
function pin(value: unknown, path: string, issues: AssemblyIssue[]): value is ImmutablePin {
  if (!rec(value)) { issue(issues, path, "Immutable ID/checksum pin is required."); return false; }
  exact(value, ["id", "checksumSha256"], path, issues);
  if (!text(value.id)) issue(issues, `${path}.id`, "Immutable ID is required.");
  if (!hash(value.checksumSha256)) issue(issues, `${path}.checksumSha256`, "Lowercase SHA-256 is required.");
  return true;
}
function stringList(value: unknown, path: string, issues: AssemblyIssue[], allowEmpty = false): value is string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.some((part) => !text(part))) { issue(issues, path, "Unique non-empty strings are required."); return false; }
  if (new Set(value).size !== value.length) issue(issues, path, "Values must be unique.");
  return true;
}
function audiencePath(value: unknown, audience: AssemblyAudience): value is string {
  return isSafeReleaseArtifactReference(value) && value.startsWith(`${audience}/`) && (audience !== "public" || !value.toLowerCase().includes("private"));
}
/** Locale-independent UTF-16 code-unit order; unlike localeCompare this is a total order for every accepted ID. */
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function canonicalManifest(manifest: MultiLodAssemblyManifest): MultiLodAssemblyManifest {
  return {
    ...manifest,
    cells: [...manifest.cells].map((cell) => ({ ...cell, buildingIds: [...cell.buildingIds].sort(compareText) })).sort((a, b) => compareText(a.cellId, b.cellId)),
    assets: [...manifest.assets].map((asset) => ({
      ...asset,
      truthTiers: [...asset.truthTiers].sort(compareText),
      lods: asset.lods.map((lod) => ({ ...lod, silhouette: lod.silhouette === null ? null : { ...lod.silhouette, viewIds: [...lod.silhouette.viewIds].sort(compareText) } })),
    })).sort((a, b) => compareText(a.canonicalFeatureId, b.canonicalFeatureId)),
    artifacts: [...manifest.artifacts].sort((a, b) => compareText(a.relativeRef, b.relativeRef)),
  };
}

export function serializeMultiLodAssembly(manifest: MultiLodAssemblyManifest): string { return `${stableSerialize(canonicalManifest(manifest))}\n`; }
export function multiLodAssemblyFingerprint(manifest: MultiLodAssemblyManifest): string { return domainSeparatedSha256("urban-digital-twin/multi-lod-assembly/1.0", canonicalManifest(manifest)); }

export function validateMultiLodAssembly(value: unknown): AssemblyValidation {
  const issues: AssemblyIssue[] = [];
  if (!rec(value)) return { ok: false, issues: [{ path: "$", message: "Assembly manifest must be an object." }] };
  exact(value, ["schemaVersion", "packageId", "audience", "generatedAt", "immutable", "release", "baseIdentitySet", "ownershipLedger", "cells", "assets", "artifacts", "tilesetRef", "declaredTotalBytes"], "$", issues);
  if (value.schemaVersion !== MULTI_LOD_ASSEMBLY_SCHEMA_VERSION) issue(issues, "$.schemaVersion", "Unsupported assembly schema.");
  if (!text(value.packageId)) issue(issues, "$.packageId", "Package ID is required.");
  if (value.audience !== "private" && value.audience !== "public") issue(issues, "$.audience", "Audience must be private or public.");
  const audience: AssemblyAudience = value.audience === "public" ? "public" : "private";
  if (!iso(value.generatedAt)) issue(issues, "$.generatedAt", "Canonical UTC timestamp is required.");
  if (value.immutable !== true) issue(issues, "$.immutable", "Assembly must declare immutability.");
  if (!rec(value.release)) issue(issues, "$.release", "Pinned exterior release identity is required.");
  else {
    exact(value.release, ["rootId", "rootChecksumSha256", "releaseId", "cityId", "configId", "privatePredecessor"], "$.release", issues);
    for (const key of ["rootId", "releaseId", "cityId", "configId"] as const) if (!text(value.release[key])) issue(issues, `$.release.${key}`, "Release identity is required.");
    if (!hash(value.release.rootChecksumSha256)) issue(issues, "$.release.rootChecksumSha256", "Root checksum is required.");
    if (value.release.privatePredecessor !== null) {
      pin(value.release.privatePredecessor, "$.release.privatePredecessor", issues);
      if (audience === "private") issue(issues, "$.release.privatePredecessor", "Private ancestry citation is public-root metadata only.");
    }
  }
  pin(value.baseIdentitySet, "$.baseIdentitySet", issues); pin(value.ownershipLedger, "$.ownershipLedger", issues);
  if (!Array.isArray(value.cells) || value.cells.length === 0 || value.cells.length > MULTI_LOD_ASSEMBLY_LIMITS.cells) issue(issues, "$.cells", "Bounded non-empty cells are required.");
  if (!Array.isArray(value.assets) || value.assets.length === 0 || value.assets.length > MULTI_LOD_ASSEMBLY_LIMITS.assets) issue(issues, "$.assets", "Bounded non-empty assets are required.");
  if (!Array.isArray(value.artifacts) || value.artifacts.length === 0 || value.artifacts.length > MULTI_LOD_ASSEMBLY_LIMITS.artifacts) issue(issues, "$.artifacts", "Bounded non-empty artifacts are required.");
  const cells = new Map<string, AssemblyCell>(); const membership = new Map<string, string>();
  if (Array.isArray(value.cells)) value.cells.forEach((raw, index) => {
    const path = `$.cells[${index}]`; if (!rec(raw)) return issue(issues, path, "Cell must be an object.");
    exact(raw, ["cellId", "cellRelease", "predecessor", "buildingIds", "membershipChecksumSha256"], path, issues);
    if (!text(raw.cellId) || cells.has(String(raw.cellId))) issue(issues, `${path}.cellId`, "Cell IDs must be unique.");
    pin(raw.cellRelease, `${path}.cellRelease`, issues); if (raw.predecessor !== null) pin(raw.predecessor, `${path}.predecessor`, issues);
    if (stringList(raw.buildingIds, `${path}.buildingIds`, issues)) for (const id of raw.buildingIds) { if (membership.has(id)) issue(issues, `${path}.buildingIds`, "Canonical building belongs to more than one cell."); membership.set(id, String(raw.cellId)); }
    if (!hash(raw.membershipChecksumSha256)) issue(issues, `${path}.membershipChecksumSha256`, "Membership checksum is required.");
    if (text(raw.cellId)) cells.set(raw.cellId, raw as unknown as AssemblyCell);
  });
  const artifacts = new Map<string, AssemblyArtifact>(); const artifactLogicalIds = new Set<string>(); let total = 0;
  if (Array.isArray(value.artifacts)) value.artifacts.forEach((raw, index) => {
    const path = `$.artifacts[${index}]`; if (!rec(raw)) return issue(issues, path, "Artifact must be an object.");
    exact(raw, ["logicalId", "role", "relativeRef", "byteSize", "checksumSha256", "ownerCellId"], path, issues);
    if (!text(raw.logicalId) || artifactLogicalIds.has(String(raw.logicalId))) issue(issues, `${path}.logicalId`, "Logical IDs must be unique and non-empty."); else artifactLogicalIds.add(raw.logicalId);
    if (raw.role !== "tileset-json" && raw.role !== "glb") issue(issues, `${path}.role`, "Artifact role must be tileset-json or glb.");
    if (!audiencePath(raw.relativeRef, audience)) issue(issues, `${path}.relativeRef`, "Artifact path must be safe and audience-rooted.");
    else if (artifacts.has(raw.relativeRef)) issue(issues, `${path}.relativeRef`, "Artifact refs must be unique.");
    if (!integer(raw.byteSize, MULTI_LOD_ASSEMBLY_LIMITS.artifactBytes)) issue(issues, `${path}.byteSize`, "Artifact bytes exceed the safe bound.");
    else { const next = add(total, raw.byteSize); if (next === null || next > MULTI_LOD_ASSEMBLY_LIMITS.totalBytes) issue(issues, "$.declaredTotalBytes", "Total bytes overflow or exceed the package cap."); else total = next; }
    if (!hash(raw.checksumSha256)) issue(issues, `${path}.checksumSha256`, "Artifact checksum is required.");
    if (raw.role === "glb" && (!text(raw.ownerCellId) || !cells.has(raw.ownerCellId))) issue(issues, `${path}.ownerCellId`, "GLB must name a declared owner cell.");
    if (raw.role === "tileset-json" && raw.ownerCellId !== null) issue(issues, `${path}.ownerCellId`, "Tileset ownerCellId must be null.");
    if (typeof raw.relativeRef === "string") artifacts.set(raw.relativeRef, raw as unknown as AssemblyArtifact);
  });
  if (!integer(value.declaredTotalBytes, MULTI_LOD_ASSEMBLY_LIMITS.totalBytes) || value.declaredTotalBytes !== total) issue(issues, "$.declaredTotalBytes", "Declared total must exactly equal artifact bytes.");
  if (!audiencePath(value.tilesetRef, audience) || artifacts.get(String(value.tilesetRef))?.role !== "tileset-json") issue(issues, "$.tilesetRef", "One declared audience-rooted tileset artifact is required.");
  if ([...artifacts.values()].filter((artifact) => artifact.role === "tileset-json").length !== 1) issue(issues, "$.artifacts", "Exactly one tileset JSON artifact is supported.");
  const assetIds = new Set<string>(); const claimedRefs = new Set<string>();
  if (Array.isArray(value.assets)) value.assets.forEach((raw, index) => {
    const path = `$.assets[${index}]`; if (!rec(raw)) return issue(issues, path, "Asset must be an object.");
    exact(raw, ["canonicalFeatureId", "ownerCellId", "inventoryId", "inventoryHashSha256", "evidenceShardId", "truthTiers", "sourceDates", "predecessor", "uncertainty", "source", "lods"], path, issues);
    if (!text(raw.canonicalFeatureId) || assetIds.has(String(raw.canonicalFeatureId))) issue(issues, `${path}.canonicalFeatureId`, "Canonical feature IDs must be unique."); else assetIds.add(raw.canonicalFeatureId);
    if (!text(raw.ownerCellId) || membership.get(String(raw.canonicalFeatureId)) !== raw.ownerCellId) issue(issues, `${path}.ownerCellId`, "Asset owner must match exact cell membership.");
    if (!text(raw.inventoryId) || !hash(raw.inventoryHashSha256) || !text(raw.evidenceShardId)) issue(issues, path, "Inventory/evidence pins are required.");
    if (!Array.isArray(raw.truthTiers) || raw.truthTiers.length === 0 || raw.truthTiers.some((tier) => !TRUTH.has(tier as ComponentTruthTier)) || new Set(raw.truthTiers).size !== raw.truthTiers.length) issue(issues, `${path}.truthTiers`, "Unique supported truth tiers are required.");
    if (!rec(raw.sourceDates)) issue(issues, `${path}.sourceDates`, "Source dates are required."); else { exact(raw.sourceDates, ["capturedAt", "updatedAt"], `${path}.sourceDates`, issues); if (!iso(raw.sourceDates.capturedAt, true) || !iso(raw.sourceDates.updatedAt, true)) issue(issues, `${path}.sourceDates`, "Canonical nullable source dates are required."); }
    if (raw.predecessor !== null) pin(raw.predecessor, `${path}.predecessor`, issues);
    if (!text(raw.uncertainty)) issue(issues, `${path}.uncertainty`, "Explicit uncertainty is required.");
    if (!rec(raw.source)) issue(issues, `${path}.source`, "Closed source discriminant is required."); else if (raw.source.kind === "facade-plan") { exact(raw.source, ["kind", "planId", "planHashSha256"], `${path}.source`, issues); if (!text(raw.source.planId) || !hash(raw.source.planHashSha256)) issue(issues, `${path}.source`, "Facade-plan ID/hash are required."); } else if (raw.source.kind === "authored-override") { exact(raw.source, ["kind", "assetManifestId", "assetManifestChecksumSha256", "approvalFingerprintSha256"], `${path}.source`, issues); if (!text(raw.source.assetManifestId) || !hash(raw.source.assetManifestChecksumSha256) || !hash(raw.source.approvalFingerprintSha256)) issue(issues, `${path}.source`, "Authored override manifest/approval pins are required."); } else issue(issues, `${path}.source.kind`, "Unsupported asset source.");
    if (!Array.isArray(raw.lods) || raw.lods.length === 0 || raw.lods.length > MULTI_LOD_ASSEMBLY_LIMITS.lodsPerAsset) return issue(issues, `${path}.lods`, "A bounded LOD list is required.");
    let previousDistance = -1; let previousError = -1; let previousTriangles = Number.POSITIVE_INFINITY; const lodIds = new Set<string>();
    raw.lods.forEach((lodRaw, lodIndex) => {
      const lodPath = `${path}.lods[${lodIndex}]`; if (!rec(lodRaw)) return issue(issues, lodPath, "LOD must be an object.");
      exact(lodRaw, ["lodId", "artifactRef", "geometricErrorMeters", "maxDistanceMeters", "eligible", "quality", "silhouette"], lodPath, issues);
      if (!text(lodRaw.lodId) || lodIds.has(String(lodRaw.lodId))) issue(issues, `${lodPath}.lodId`, "Per-asset LOD IDs must be unique and non-empty."); else lodIds.add(lodRaw.lodId);
      if (!audiencePath(lodRaw.artifactRef, audience) || artifacts.get(String(lodRaw.artifactRef))?.role !== "glb" || artifacts.get(String(lodRaw.artifactRef))?.ownerCellId !== raw.ownerCellId || claimedRefs.has(String(lodRaw.artifactRef))) issue(issues, `${lodPath}.artifactRef`, "Each LOD must uniquely cite an owner-cell GLB."); else claimedRefs.add(lodRaw.artifactRef);
      if (!finite(lodRaw.geometricErrorMeters, 0) || lodRaw.geometricErrorMeters < previousError) issue(issues, `${lodPath}.geometricErrorMeters`, "Near-to-far geometric error must be nondecreasing."); else previousError = lodRaw.geometricErrorMeters;
      if (lodIndex === 0 && lodRaw.geometricErrorMeters !== 0) issue(issues, `${lodPath}.geometricErrorMeters`, "Finest LOD geometric error must be zero.");
      let distance: number;
      if (lodRaw.maxDistanceMeters === null) distance = Number.POSITIVE_INFINITY;
      else if (finite(lodRaw.maxDistanceMeters, 0)) distance = lodRaw.maxDistanceMeters;
      else { issue(issues, `${lodPath}.maxDistanceMeters`, "Near-to-far distances must be nondecreasing."); distance = previousDistance; }
      if (distance < previousDistance) issue(issues, `${lodPath}.maxDistanceMeters`, "Near-to-far distances must be nondecreasing."); previousDistance = distance;
      if (typeof lodRaw.eligible !== "boolean") issue(issues, `${lodPath}.eligible`, "Eligibility is required.");
      if (!rec(lodRaw.quality)) issue(issues, `${lodPath}.quality`, "Measured quality and budgets are required."); else {
        exact(lodRaw.quality, ["triangleCount", "materialCount", "textureCount", "budgets"], `${lodPath}.quality`, issues);
        if (!rec(lodRaw.quality.budgets)) issue(issues, `${lodPath}.quality.budgets`, "Quality budgets are required."); else {
          exact(lodRaw.quality.budgets, ["maxTriangles", "maxMaterials", "maxTextures"], `${lodPath}.quality.budgets`, issues);
          for (const [count, budget] of [["triangleCount", "maxTriangles"], ["materialCount", "maxMaterials"], ["textureCount", "maxTextures"]] as const) if (!integer(lodRaw.quality[count]) || !integer(lodRaw.quality.budgets[budget]) || lodRaw.quality[count] > lodRaw.quality.budgets[budget]) issue(issues, `${lodPath}.quality.${count}`, "Measured count must fit its safe budget.");
        }
        if (integer(lodRaw.quality.triangleCount) && lodRaw.quality.triangleCount > previousTriangles) issue(issues, `${lodPath}.quality.triangleCount`, "Near-to-far detail must not increase."); else if (integer(lodRaw.quality.triangleCount)) previousTriangles = lodRaw.quality.triangleCount;
      }
      if (lodIndex === 0 && lodRaw.silhouette !== null) issue(issues, `${lodPath}.silhouette`, "Finest LOD has no transition silhouette measurement.");
      if (lodIndex > 0) {
        if (!rec(lodRaw.silhouette)) issue(issues, `${lodPath}.silhouette`, "LOD transition requires declared authoring measurement.");
        else { exact(lodRaw.silhouette, ["status", "method", "metricVersion", "planHashSha256", "viewIds", "deviationRatio", "maximumRatio"], `${lodPath}.silhouette`, issues); if (lodRaw.silhouette.status !== "authoring-declared" || lodRaw.silhouette.method !== "projected-silhouette-ratio" || lodRaw.silhouette.metricVersion !== "1.0" || !hash(lodRaw.silhouette.planHashSha256) || !stringList(lodRaw.silhouette.viewIds, `${lodPath}.silhouette.viewIds`, issues) || !finite(lodRaw.silhouette.deviationRatio, 0) || lodRaw.silhouette.maximumRatio !== 0.02 || lodRaw.silhouette.deviationRatio > 0.02) issue(issues, `${lodPath}.silhouette`, "Declared silhouette metadata must use v1 and stay within 2%."); if (rec(raw.source)) { const sourceHash = raw.source.kind === "facade-plan" ? raw.source.planHashSha256 : raw.source.kind === "authored-override" ? raw.source.assetManifestChecksumSha256 : null; if (lodRaw.silhouette.planHashSha256 !== sourceHash) issue(issues, `${lodPath}.silhouette.planHashSha256`, "Silhouette measurement must bind the immutable asset source."); } }
      }
    });
  });
  for (const [id] of membership) if (!assetIds.has(id)) issue(issues, "$.cells", `Cell member has no packaged asset: ${id}.`);
  for (const artifact of artifacts.values()) if (artifact.role === "glb" && !claimedRefs.has(artifact.relativeRef)) issue(issues, "$.artifacts", `Orphan GLB artifact: ${artifact.relativeRef}.`);
  return issues.length ? { ok: false, issues } : { ok: true, value: value as unknown as MultiLodAssemblyManifest };
}

function u32(view: DataView, offset: number): number { return view.getUint32(offset, true); }
function parseJsonBytes(bytes: Uint8Array): unknown {
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes); let end = decoded.length;
  while (end > 0 && decoded.charCodeAt(end - 1) === 32) end -= 1;
  return JSON.parse(decoded.slice(0, end));
}
export function parseGlbV2(bytes: Uint8Array): ParsedGlb {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 20 || bytes.byteLength > MULTI_LOD_ASSEMBLY_LIMITS.artifactBytes) throw new Error("GLB byte length is outside the supported profile.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (u32(view, 0) !== 0x46546c67 || u32(view, 4) !== 2 || u32(view, 8) !== bytes.byteLength) throw new Error("GLB 2 header or declared length is invalid.");
  let offset = 12; let json: Record<string, unknown> | null = null; let jsonBytes = 0; let bin: Uint8Array | null = null; let chunks = 0;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) throw new Error("GLB chunk header is truncated.");
    const length = u32(view, offset); const type = u32(view, offset + 4); offset += 8;
    if (length % 4 !== 0 || offset + length > bytes.byteLength) throw new Error("GLB chunk alignment or length is invalid.");
    const chunk = bytes.subarray(offset, offset + length); offset += length; chunks += 1;
    if (chunks === 1 && type !== 0x4e4f534a) throw new Error("GLB JSON must be the first chunk.");
    if (type === 0x4e4f534a) { if (json) throw new Error("GLB may contain exactly one JSON chunk."); jsonBytes = length; if (length > MULTI_LOD_ASSEMBLY_LIMITS.glbJsonBytes) throw new Error("GLB JSON exceeds the cap."); const parsed = parseJsonBytes(chunk); if (!rec(parsed)) throw new Error("GLB JSON must be an object."); json = parsed; }
    else if (type === 0x004e4942) { if (bin !== null) throw new Error("GLB may contain at most one BIN chunk."); bin = chunk; }
    else throw new Error("Unsupported GLB chunk type.");
  }
  if (!json || offset !== bytes.byteLength) throw new Error("GLB JSON or exact byte closure is missing.");
  validateGltfJson(json, bin ?? new Uint8Array());
  return { json, jsonBytes, binBytes: bin?.byteLength ?? 0 };
}
const COMPONENT_BYTES: Record<number, number> = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const GLTF_ATTRIBUTES = new Set(["POSITION", "NORMAL", "TANGENT", "COLOR_0", ...Array.from({ length: 8 }, (_, index) => `TEXCOORD_${index}`)]);
function gltfObjects(value: unknown, label: string, maximum: number, required = false): Record<string, unknown>[] {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || (required && value.length === 0) || value.length > maximum || value.some((part) => !rec(part))) throw new Error(`${label} must be a bounded array of objects.`);
  return value as Record<string, unknown>[];
}
function finiteArray(value: unknown, length: number, label: string, minimum = Number.NEGATIVE_INFINITY, maximum = Number.POSITIVE_INFINITY): value is number[] {
  if (!Array.isArray(value) || value.length !== length || value.some((part) => typeof part !== "number" || !Number.isFinite(part) || part < minimum || part > maximum)) throw new Error(`${label} must contain exactly ${length} bounded finite numbers.`);
  return true;
}
function gltfIndices(value: unknown, maximum: number, label: string, allowEmpty = true): value is number[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.some((part) => !integer(part, maximum)) || new Set(value).size !== value.length) throw new Error(`${label} must contain unique in-range indices.`);
  return true;
}
function validateTextureInfo(value: unknown, textureMaximum: number, label: string, kind: "basic" | "normal" | "occlusion" = "basic"): number {
  if (!rec(value)) throw new Error(`${label} must be an object.`);
  const extraKey = kind === "normal" ? "scale" : kind === "occlusion" ? "strength" : null;
  closedKeys(value, extraKey ? ["index", "texCoord", extraKey] : ["index", "texCoord"], ["index"], label);
  if (!integer(value.index, textureMaximum) || (value.texCoord !== undefined && !integer(value.texCoord, 7))) throw new Error(`${label} texture or coordinate index is invalid.`);
  if (kind === "normal" && value.scale !== undefined && !finite(value.scale)) throw new Error(`${label} scale must be finite.`);
  if (kind === "occlusion" && value.strength !== undefined && (!finite(value.strength, 0) || value.strength > 1)) throw new Error(`${label} strength must be within [0, 1].`);
  return value.index;
}
function validateMaterial(material: Record<string, unknown>, textureMaximum: number, referencedTextures: Set<number>): void {
  closedKeys(material, ["pbrMetallicRoughness", "normalTexture", "occlusionTexture", "emissiveTexture", "emissiveFactor", "alphaMode", "alphaCutoff", "doubleSided"], [], "Material");
  if (material.pbrMetallicRoughness !== undefined) {
    if (!rec(material.pbrMetallicRoughness)) throw new Error("Material PBR metallic-roughness data must be an object.");
    const pbr = material.pbrMetallicRoughness;
    closedKeys(pbr, ["baseColorFactor", "baseColorTexture", "metallicFactor", "roughnessFactor", "metallicRoughnessTexture"], [], "Material PBR metallic-roughness data");
    if (pbr.baseColorFactor !== undefined) finiteArray(pbr.baseColorFactor, 4, "Material base color", 0, 1);
    for (const key of ["metallicFactor", "roughnessFactor"] as const) if (pbr[key] !== undefined && (!finite(pbr[key], 0) || pbr[key] > 1)) throw new Error(`Material ${key} must be within [0, 1].`);
    for (const key of ["baseColorTexture", "metallicRoughnessTexture"] as const) if (pbr[key] !== undefined) referencedTextures.add(validateTextureInfo(pbr[key], textureMaximum, `Material ${key}`));
  }
  if (material.normalTexture !== undefined) referencedTextures.add(validateTextureInfo(material.normalTexture, textureMaximum, "Material normalTexture", "normal"));
  if (material.occlusionTexture !== undefined) referencedTextures.add(validateTextureInfo(material.occlusionTexture, textureMaximum, "Material occlusionTexture", "occlusion"));
  if (material.emissiveTexture !== undefined) referencedTextures.add(validateTextureInfo(material.emissiveTexture, textureMaximum, "Material emissiveTexture"));
  if (material.emissiveFactor !== undefined) finiteArray(material.emissiveFactor, 3, "Material emissive factor", 0, 1);
  if (material.alphaMode !== undefined && (typeof material.alphaMode !== "string" || !["OPAQUE", "MASK", "BLEND"].includes(material.alphaMode))) throw new Error("Material alphaMode is invalid.");
  if (material.alphaCutoff !== undefined && !finite(material.alphaCutoff)) throw new Error("Material alphaCutoff must be finite.");
  if (material.doubleSided !== undefined && typeof material.doubleSided !== "boolean") throw new Error("Material doubleSided must be boolean.");
}
function validateAttributeAccessor(accessors: Record<string, unknown>[], semantic: string, index: number): void {
  const accessor = accessors[index]!; const componentType = accessor.componentType; const normalized = accessor.normalized === true; const type = accessor.type;
  if (semantic === "POSITION" && (componentType !== 5126 || type !== "VEC3" || normalized)) throw new Error("POSITION must use unnormalized FLOAT VEC3 data.");
  if (semantic === "NORMAL" && (componentType !== 5126 || type !== "VEC3" || normalized)) throw new Error("NORMAL must use unnormalized FLOAT VEC3 data.");
  if (semantic === "TANGENT" && (componentType !== 5126 || type !== "VEC4" || normalized)) throw new Error("TANGENT must use unnormalized FLOAT VEC4 data.");
  if (semantic.startsWith("TEXCOORD_") && (type !== "VEC2" || (componentType !== 5126 && !([5121, 5123].includes(Number(componentType)) && normalized)))) throw new Error("Texture coordinates use an unsupported accessor profile.");
  if (semantic === "COLOR_0" && (!["VEC3", "VEC4"].includes(String(type)) || (componentType !== 5126 && !([5121, 5123].includes(Number(componentType)) && normalized)))) throw new Error("Vertex colors use an unsupported accessor profile.");
}
function validateGltfJson(json: Record<string, unknown>, bin: Uint8Array): void {
  const topLevel = new Set(["asset", "buffers", "bufferViews", "accessors", "meshes", "materials", "textures", "images", "samplers", "nodes", "scenes", "scene", "extras"]);
  if (Object.keys(json).some((key) => !topLevel.has(key))) throw new Error("Unsupported top-level glTF field or extension declaration.");
  if (!rec(json.asset)) throw new Error("glTF asset metadata is required.");
  closedKeys(json.asset, ["version"], ["version"], "glTF asset");
  if (json.asset.version !== "2.0") throw new Error("glTF asset.version 2.0 is required.");
  glbMetadata(json);
  const buffers = gltfObjects(json.buffers, "glTF buffers", 1, true);
  if (buffers.length !== 1) throw new Error("One embedded BIN buffer is required.");
  if (Object.hasOwn(buffers[0]!, "uri")) throw new Error("External buffer URIs are unsupported; one embedded BIN buffer is required.");
  closedKeys(buffers[0]!, ["byteLength"], ["byteLength"], "glTF buffer");
  if (!integer(buffers[0]!.byteLength, bin.byteLength) || buffers[0]!.byteLength > bin.byteLength || bin.byteLength - buffers[0]!.byteLength > 3) throw new Error("One embedded BIN buffer with a bounded length is required.");
  const views = gltfObjects(json.bufferViews, "glTF bufferViews", MULTI_LOD_ASSEMBLY_LIMITS.bufferViews, true);
  for (const raw of views) {
    closedKeys(raw, ["buffer", "byteOffset", "byteLength", "byteStride", "target"], ["buffer", "byteLength"], "glTF bufferView");
    if (raw.buffer !== 0 || !integer(raw.byteOffset ?? 0) || !integer(raw.byteLength) || (raw.byteOffset as number | undefined ?? 0) + (raw.byteLength as number) > (buffers[0]!.byteLength as number) || (raw.byteStride !== undefined && (!integer(raw.byteStride, 252) || raw.byteStride < 4 || raw.byteStride % 4 !== 0)) || (raw.target !== undefined && raw.target !== 34962 && raw.target !== 34963)) throw new Error("bufferView range or target is invalid.");
  }
  const accessors = gltfObjects(json.accessors, "glTF accessors", MULTI_LOD_ASSEMBLY_LIMITS.accessors, true);
  for (const raw of accessors) {
    closedKeys(raw, ["bufferView", "byteOffset", "componentType", "normalized", "count", "type", "min", "max"], ["bufferView", "componentType", "count", "type"], "glTF accessor");
    if (!integer(raw.bufferView, Math.max(0, views.length - 1)) || !integer(raw.count) || raw.count === 0 || typeof raw.componentType !== "number" || ![5121, 5123, 5125, 5126].includes(raw.componentType) || typeof raw.type !== "string" || !["SCALAR", "VEC2", "VEC3", "VEC4"].includes(raw.type) || !integer(raw.byteOffset ?? 0) || (raw.normalized !== undefined && typeof raw.normalized !== "boolean") || (raw.componentType === 5126 && raw.normalized === true)) throw new Error("Accessor profile or range is invalid.");
    const view = views[raw.bufferView as number]; if (!rec(view)) throw new Error("Accessor bufferView is missing.");
    const componentBytes = COMPONENT_BYTES[raw.componentType as number]!; const elementBytes = componentBytes * TYPE_COMPONENTS[raw.type as string]!;
    const accessorOffset = raw.byteOffset as number | undefined ?? 0; const viewOffset = view.byteOffset as number | undefined ?? 0; const stride = view.byteStride as number | undefined ?? elementBytes;
    if (accessorOffset % componentBytes !== 0 || viewOffset % componentBytes !== 0 || stride < elementBytes || stride % componentBytes !== 0) throw new Error("Accessor alignment or stride is invalid.");
    const extent = accessorOffset + ((raw.count as number) - 1) * stride + elementBytes;
    if (!Number.isSafeInteger(extent) || extent > (view.byteLength as number)) throw new Error("Accessor byte range exceeds its bufferView.");
    const components = TYPE_COMPONENTS[raw.type as string]!;
    if (raw.min !== undefined) finiteArray(raw.min, components, "Accessor minimum");
    if (raw.max !== undefined) finiteArray(raw.max, components, "Accessor maximum");
    if (Array.isArray(raw.min) && Array.isArray(raw.max) && raw.min.some((part, index) => part > (raw.max as number[])[index]!)) throw new Error("Accessor minimum exceeds maximum.");
  }
  const images = gltfObjects(json.images, "glTF images", MULTI_LOD_ASSEMBLY_LIMITS.textures); const textures = gltfObjects(json.textures, "glTF textures", MULTI_LOD_ASSEMBLY_LIMITS.textures); const samplers = gltfObjects(json.samplers, "glTF samplers", MULTI_LOD_ASSEMBLY_LIMITS.textures);
  for (const image of images) {
    closedKeys(image, ["bufferView", "mimeType"], ["bufferView", "mimeType"], "glTF image");
    if (!integer(image.bufferView, Math.max(0, views.length - 1)) || typeof image.mimeType !== "string" || !["image/png", "image/jpeg", "image/webp"].includes(image.mimeType)) throw new Error("Embedded image profile is invalid.");
    const view = views[image.bufferView as number]!; if (view.byteStride !== undefined || view.target !== undefined) throw new Error("Image bufferView cannot declare geometry stride or target.");
  }
  const magFilters = new Set([9728, 9729]); const minFilters = new Set([9728, 9729, 9984, 9985, 9986, 9987]); const wraps = new Set([33071, 33648, 10497]);
  for (const sampler of samplers) {
    closedKeys(sampler, ["magFilter", "minFilter", "wrapS", "wrapT"], [], "glTF sampler");
    if ((sampler.magFilter !== undefined && (typeof sampler.magFilter !== "number" || !magFilters.has(sampler.magFilter))) || (sampler.minFilter !== undefined && (typeof sampler.minFilter !== "number" || !minFilters.has(sampler.minFilter))) || (sampler.wrapS !== undefined && (typeof sampler.wrapS !== "number" || !wraps.has(sampler.wrapS))) || (sampler.wrapT !== undefined && (typeof sampler.wrapT !== "number" || !wraps.has(sampler.wrapT)))) throw new Error("Sampler filter or wrapping mode is invalid.");
  }
  for (const texture of textures) {
    closedKeys(texture, ["sampler", "source"], ["source"], "glTF texture");
    if (!integer(texture.source, images.length - 1) || (texture.sampler !== undefined && !integer(texture.sampler, samplers.length - 1))) throw new Error("Texture source or sampler index is invalid.");
  }
  const referencedTextures = new Set<number>();
  const materials = gltfObjects(json.materials, "glTF materials", MULTI_LOD_ASSEMBLY_LIMITS.materials);
  for (const material of materials) validateMaterial(material, textures.length - 1, referencedTextures);
  const meshes = gltfObjects(json.meshes, "glTF meshes", MULTI_LOD_ASSEMBLY_LIMITS.meshes, true); let primitives = 0; let scannedComponents = 0;
  const binary = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const info = (index: number) => { const accessor = accessors[index] as Record<string, unknown>; const view = views[accessor.bufferView as number] as Record<string, unknown>; const componentBytes = COMPONENT_BYTES[accessor.componentType as number]!; const elementBytes = componentBytes * TYPE_COMPONENTS[accessor.type as string]!; return { accessor, count: accessor.count as number, componentType: accessor.componentType as number, offset: (view.byteOffset as number | undefined ?? 0) + (accessor.byteOffset as number | undefined ?? 0), stride: view.byteStride as number | undefined ?? elementBytes }; };
  const component = (type: number, offset: number): number => type === 5121 ? binary.getUint8(offset) : type === 5123 ? binary.getUint16(offset, true) : type === 5125 ? binary.getUint32(offset, true) : binary.getFloat32(offset, true);
  const positionCounts = new Map<number, number>(); const indexMaximums = new Map<number, number>();
  const reserveScan = (count: number): void => { const next = add(scannedComponents, count); if (next === null || next > MULTI_LOD_ASSEMBLY_LIMITS.glbScannedComponents) throw new Error("GLB component scan work cap exceeded."); scannedComponents = next; };
  for (const mesh of meshes) {
    closedKeys(mesh, ["primitives"], ["primitives"], "glTF mesh");
    if (!Array.isArray(mesh.primitives) || mesh.primitives.length === 0) throw new Error("Mesh primitives are required.");
    for (const primitive of mesh.primitives) {
      primitives += 1; if (!rec(primitive)) throw new Error("Mesh primitive must be an object.");
      closedKeys(primitive, ["attributes", "indices", "material", "mode"], ["attributes", "indices"], "glTF mesh primitive");
      if ((primitive.mode ?? 4) !== 4 || !rec(primitive.attributes) || !integer(primitive.attributes.POSITION, Math.max(0, accessors.length - 1)) || !integer(primitive.indices, Math.max(0, accessors.length - 1))) throw new Error("Only indexed TRIANGLES with POSITION are supported.");
      if (Object.keys(primitive.attributes).some((key) => !GLTF_ATTRIBUTES.has(key))) throw new Error("Primitive contains an unsupported attribute semantic.");
      for (const [semantic, accessorIndex] of Object.entries(primitive.attributes)) {
        if (!integer(accessorIndex, Math.max(0, accessors.length - 1))) throw new Error("Primitive attribute accessor is invalid.");
        validateAttributeAccessor(accessors, semantic, accessorIndex);
        const attributeView = views[accessors[accessorIndex]!.bufferView as number]!;
        if (attributeView.target !== undefined && attributeView.target !== 34962) throw new Error("Vertex attribute bufferView target is incompatible.");
      }
      if (primitive.material !== undefined && !integer(primitive.material, materials.length - 1)) throw new Error("Primitive material index is invalid.");
      const positionIndex = primitive.attributes.POSITION; const indexIndex = primitive.indices as number; const positions = info(positionIndex); const indices = info(indexIndex);
      const indexView = views[indices.accessor.bufferView as number]!;
      if (indexView.byteStride !== undefined) throw new Error("Index bufferView cannot declare byteStride.");
      if (indexView.target !== undefined && indexView.target !== 34963) throw new Error("Index bufferView target is incompatible.");
      if (indices.accessor.type !== "SCALAR" || indices.componentType === 5126 || indices.count % 3 !== 0 || positions.accessor.type !== "VEC3" || positions.componentType !== 5126 || positions.count < 3) throw new Error("Triangle topology accessor counts are invalid.");
      if (!positionCounts.has(positionIndex)) { reserveScan(positions.count * 3); for (let index = 0; index < positions.count; index += 1) for (let axis = 0; axis < 3; axis += 1) if (!Number.isFinite(component(5126, positions.offset + index * positions.stride + axis * 4))) throw new Error("POSITION contains a non-finite coordinate."); positionCounts.set(positionIndex, positions.count); }
      if (!indexMaximums.has(indexIndex)) { reserveScan(indices.count); let maximum = -1; for (let index = 0; index < indices.count; index += 1) maximum = Math.max(maximum, component(indices.componentType, indices.offset + index * indices.stride)); indexMaximums.set(indexIndex, maximum); }
      if (indexMaximums.get(indexIndex)! >= positionCounts.get(positionIndex)!) throw new Error("Triangle index exceeds POSITION count.");
    }
  }
  if (primitives === 0 || primitives > MULTI_LOD_ASSEMBLY_LIMITS.primitives) throw new Error("Primitive count is outside the profile.");
  const nodes = gltfObjects(json.nodes, "glTF nodes", MULTI_LOD_ASSEMBLY_LIMITS.nodes); const scenes = gltfObjects(json.scenes, "glTF scenes", MULTI_LOD_ASSEMBLY_LIMITS.scenes);
  const nodeChildren: number[][] = Array.from({ length: nodes.length }, () => []); const indegrees = new Uint32Array(nodes.length);
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!; closedKeys(node, ["children", "mesh", "matrix", "translation", "rotation", "scale"], [], "glTF node");
    if (node.children !== undefined) {
      gltfIndices(node.children, nodes.length - 1, "Node children", false); const children = node.children as number[]; nodeChildren[index] = children;
      for (const child of children) { const indegree = (indegrees[child] ?? 0) + 1; indegrees[child] = indegree; if (indegree > 1) throw new Error("Node cannot have multiple parents."); }
    }
    if (node.mesh !== undefined && !integer(node.mesh, meshes.length - 1)) throw new Error("Node mesh index is invalid.");
    const hasTrs = node.translation !== undefined || node.rotation !== undefined || node.scale !== undefined;
    if (node.matrix !== undefined) { if (hasTrs) throw new Error("Node matrix and TRS transforms are mutually exclusive."); finiteArray(node.matrix, 16, "Node matrix"); }
    if (node.translation !== undefined) finiteArray(node.translation, 3, "Node translation");
    if (node.rotation !== undefined) {
      finiteArray(node.rotation, 4, "Node rotation", -1, 1);
      if (Math.abs(Math.hypot(...node.rotation as number[]) - 1) > 1e-6) throw new Error("Node rotation quaternion must be normalized.");
    }
    if (node.scale !== undefined) finiteArray(node.scale, 3, "Node scale");
  }
  const colors = new Uint8Array(nodes.length); const nodeStack: number[] = []; const childOffsets: number[] = [];
  for (let start = 0; start < nodes.length; start += 1) {
    if (colors[start] !== 0) continue;
    colors[start] = 1; nodeStack.push(start); childOffsets.push(0);
    while (nodeStack.length > 0) {
      const stackIndex = nodeStack.length - 1; const current = nodeStack[stackIndex]!; const childOffset = childOffsets[stackIndex]!; const children = nodeChildren[current]!;
      if (childOffset >= children.length) { colors[current] = 2; nodeStack.pop(); childOffsets.pop(); continue; }
      childOffsets[stackIndex] = childOffset + 1; const child = children[childOffset]!;
      if (colors[child] === 1) throw new Error("Node hierarchy contains a cycle.");
      if (colors[child] === 0) { colors[child] = 1; nodeStack.push(child); childOffsets.push(0); }
    }
  }
  for (const scene of scenes) { closedKeys(scene, ["nodes"], [], "glTF scene"); if (scene.nodes !== undefined) gltfIndices(scene.nodes, nodes.length - 1, "Scene root nodes"); }
  if (json.scene !== undefined && !integer(json.scene, scenes.length - 1)) throw new Error("Default scene index is invalid.");
}

interface UdtGlbMetadata { canonicalFeatureId: string; lodId: string; ownerCellId: string; inventoryId: string; inventoryHashSha256: string; evidenceShardId: string; truthTiers: ComponentTruthTier[]; sourceDates: { capturedAt: string | null; updatedAt: string | null }; predecessor: ImmutablePin | null; uncertainty: string; planHashSha256: string }
function glbMetadata(json: Record<string, unknown>): UdtGlbMetadata {
  if (!rec(json.extras)) throw new Error("GLB canonical metadata extras are required.");
  closedKeys(json.extras, ["urbanDigitalTwin"], ["urbanDigitalTwin"], "GLB root extras");
  const metadata = json.extras.urbanDigitalTwin;
  if (!rec(metadata)) throw new Error("GLB canonical metadata must be an object.");
  closedKeys(metadata, ["canonicalFeatureId", "lodId", "ownerCellId", "inventoryId", "inventoryHashSha256", "evidenceShardId", "truthTiers", "sourceDates", "predecessor", "uncertainty", "planHashSha256"], ["canonicalFeatureId", "lodId", "ownerCellId", "inventoryId", "inventoryHashSha256", "evidenceShardId", "truthTiers", "sourceDates", "predecessor", "uncertainty", "planHashSha256"], "GLB canonical metadata");
  for (const key of ["canonicalFeatureId", "lodId", "ownerCellId", "inventoryId", "evidenceShardId", "uncertainty"] as const) if (!text(metadata[key])) throw new Error(`GLB canonical metadata ${key} is invalid.`);
  if (!hash(metadata.inventoryHashSha256) || !hash(metadata.planHashSha256)) throw new Error("GLB canonical metadata source hashes are invalid.");
  if (!Array.isArray(metadata.truthTiers) || metadata.truthTiers.length === 0 || metadata.truthTiers.length > TRUTH.size || metadata.truthTiers.some((tier) => !TRUTH.has(tier as ComponentTruthTier)) || new Set(metadata.truthTiers).size !== metadata.truthTiers.length) throw new Error("GLB canonical metadata truth tiers are invalid.");
  if (!rec(metadata.sourceDates)) throw new Error("GLB canonical metadata source dates are invalid.");
  closedKeys(metadata.sourceDates, ["capturedAt", "updatedAt"], ["capturedAt", "updatedAt"], "GLB canonical metadata source dates");
  if (!iso(metadata.sourceDates.capturedAt, true) || !iso(metadata.sourceDates.updatedAt, true)) throw new Error("GLB canonical metadata source dates are invalid.");
  if (metadata.predecessor !== null) {
    if (!rec(metadata.predecessor)) throw new Error("GLB canonical metadata predecessor is invalid.");
    closedKeys(metadata.predecessor, ["id", "checksumSha256"], ["id", "checksumSha256"], "GLB canonical metadata predecessor");
    if (!text(metadata.predecessor.id) || !hash(metadata.predecessor.checksumSha256)) throw new Error("GLB canonical metadata predecessor is invalid.");
  }
  return metadata as unknown as UdtGlbMetadata;
}
function counts(json: Record<string, unknown>): { triangleCount: number; materialCount: number; textureCount: number } {
  const accessors = json.accessors as Record<string, unknown>[]; const materialIds = new Set<number>(); const textureIds = new Set<number>(); let triangles = 0;
  for (const mesh of json.meshes as Array<{ primitives: Array<{ indices: number; material?: number }> }>) for (const primitive of mesh.primitives) { triangles += (accessors[primitive.indices]!.count as number) / 3; if (primitive.material !== undefined) materialIds.add(primitive.material); }
  const collect = (value: unknown, key = ""): void => { if (!rec(value)) return; if (key.endsWith("Texture")) { textureIds.add(value.index as number); return; } for (const [childKey, child] of Object.entries(value)) collect(child, childKey); };
  const materials = Array.isArray(json.materials) ? json.materials : []; for (const id of materialIds) collect(materials[id]);
  return { triangleCount: triangles, materialCount: materialIds.size, textureCount: textureIds.size };
}
function validateGlbBinding(parsed: ParsedGlb, asset: AssemblyAsset, lod: AssemblyLod): void {
  const metadata = glbMetadata(parsed.json);
  const expected = { canonicalFeatureId: asset.canonicalFeatureId, lodId: lod.lodId, ownerCellId: asset.ownerCellId, inventoryId: asset.inventoryId, inventoryHashSha256: asset.inventoryHashSha256, evidenceShardId: asset.evidenceShardId, truthTiers: [...asset.truthTiers].sort(compareText), sourceDates: asset.sourceDates, predecessor: asset.predecessor, uncertainty: asset.uncertainty, planHashSha256: asset.source.kind === "facade-plan" ? asset.source.planHashSha256 : asset.source.assetManifestChecksumSha256 };
  if (stableSerialize({ ...metadata, truthTiers: [...metadata.truthTiers].sort(compareText) }) !== stableSerialize(expected)) throw new Error("GLB canonical metadata differs from the immutable assembly manifest.");
  if (stableSerialize(counts(parsed.json)) !== stableSerialize({ triangleCount: lod.quality.triangleCount, materialCount: lod.quality.materialCount, textureCount: lod.quality.textureCount })) throw new Error("GLB topology/material/texture counts differ from declared quality.");
}

interface Tile { boundingVolume?: { box?: number[] }; geometricError?: number; refine?: string; transform?: number[]; content?: { uri?: string }; children?: Tile[] }
function closedKeys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[], label: string): void {
  const keys = new Set(allowed); if (Object.keys(value).some((key) => !keys.has(key)) || required.some((key) => !Object.hasOwn(value, key))) throw new Error(`${label} contains unsupported or missing fields.`);
}
function resolveTilesetUri(tilesetRef: string, uri: unknown, audience: AssemblyAudience): string {
  if (typeof uri !== "string" || uri.length === 0 || uri.startsWith("/") || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(uri) || /[%?#\\]/u.test(uri) || [...uri].some((part) => part.charCodeAt(0) <= 0x20 || part.charCodeAt(0) === 0x7f)) throw new Error("Tile content URI is not a strict local relative reference.");
  const parts = tilesetRef.split("/").slice(0, -1);
  for (const segment of uri.split("/")) {
    if (segment === "..") { if (parts.length === 0) throw new Error("Tile content URI escapes the package root."); parts.pop(); }
    else if (segment.length === 0 || segment === "." || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(segment)) throw new Error("Tile content URI has a non-canonical segment.");
    else parts.push(segment);
  }
  const resolved = parts.join("/"); if (!audiencePath(resolved, audience)) throw new Error("Tile content URI resolves outside its audience root."); return resolved;
}
function validateTransform(value: unknown): void { if (!Array.isArray(value) || value.length !== 16 || !value.every(Number.isFinite) || value.some((part) => Math.abs(part) > 1e9) || value[3] !== 0 || value[7] !== 0 || value[11] !== 0 || value[15] !== 1) throw new Error("3D Tiles transform must be bounded column-major affine."); const determinant = value[0]! * (value[5]! * value[10]! - value[9]! * value[6]!) - value[4]! * (value[1]! * value[10]! - value[9]! * value[2]!) + value[8]! * (value[1]! * value[6]! - value[5]! * value[2]!); if (Math.abs(determinant) < 1e-9) throw new Error("3D Tiles transform is singular."); }
function validateBox(value: unknown): void { if (!Array.isArray(value) || value.length !== 12 || !value.every(Number.isFinite)) throw new Error("3D Tiles box requires 12 finite numbers."); for (const offset of [3, 6, 9]) if (Math.hypot(value[offset]!, value[offset + 1]!, value[offset + 2]!) <= 0) throw new Error("3D Tiles box half axes must be nondegenerate."); }
function validateTileset(bytes: Uint8Array, manifest: MultiLodAssemblyManifest): Set<string> {
  if (bytes.byteLength > MULTI_LOD_ASSEMBLY_LIMITS.glbJsonBytes) throw new Error("Tileset JSON exceeds the cap."); const raw = parseJsonBytes(bytes); if (!rec(raw)) throw new Error("3D Tiles 1.1 document is required.");
  closedKeys(raw, ["asset", "geometricError", "root"], ["asset", "geometricError", "root"], "Tileset");
  if (!rec(raw.asset)) throw new Error("3D Tiles asset metadata is required."); closedKeys(raw.asset, ["version"], ["version"], "Tileset asset");
  if (raw.asset.version !== "1.1" || !finite(raw.geometricError, 0) || !rec(raw.root)) throw new Error("3D Tiles 1.1 root and top-level geometricError are required.");
  const expected = new Map<string, { asset: AssemblyAsset; lod: AssemblyLod }>(); for (const asset of manifest.assets) for (const lod of asset.lods) expected.set(lod.artifactRef, { asset, lod });
  const seen = new Set<string>(); const active = new Set<object>(); let nodes = 0;
  const walk = (tile: Tile, parentError: number | null, depth: number, expectedBinding: { asset: AssemblyAsset; lodIndex: number } | null): void => {
    if (!rec(tile)) throw new Error("Tile must be an object."); if (active.has(tile as object)) throw new Error("Tile graph cycle detected."); active.add(tile as object); nodes += 1;
    closedKeys(tile, ["boundingVolume", "geometricError", "refine", "transform", "content", "children"], ["boundingVolume", "geometricError", "refine"], "Tile");
    if (nodes > MULTI_LOD_ASSEMBLY_LIMITS.tileNodes || depth > MULTI_LOD_ASSEMBLY_LIMITS.tileDepth) throw new Error("Tileset topology cap exceeded.");
    const volume = tile.boundingVolume; if (!rec(volume)) throw new Error("Tile bounding volume is required."); closedKeys(volume, ["box"], ["box"], "Tile boundingVolume"); validateBox(volume.box);
    if (!finite(tile.geometricError, 0) || (parentError !== null && tile.geometricError! > parentError)) throw new Error("Tile geometric error hierarchy is invalid.");
    if ((tile.refine ?? "REPLACE") !== "REPLACE") throw new Error("Only REPLACE refinement is supported."); if (tile.transform !== undefined) validateTransform(tile.transform);
    const children = tile.children ?? []; if (!Array.isArray(children)) throw new Error("Tile children must be an array.");
    if (expectedBinding === null) {
      if (tile.content !== undefined || depth !== 0 || children.length !== manifest.assets.length) throw new Error("Tileset root must be one contentless container with one LOD chain per asset.");
      const orderedAssets = [...manifest.assets].sort((a, b) => compareText(a.canonicalFeatureId, b.canonicalFeatureId));
      for (let index = 0; index < orderedAssets.length; index += 1) walk(children[index]!, tile.geometricError!, depth + 1, { asset: orderedAssets[index]!, lodIndex: orderedAssets[index]!.lods.length - 1 });
    } else {
      if (!rec(tile.content)) throw new Error("Every asset LOD chain node requires content."); closedKeys(tile.content, ["uri"], ["uri"], "Tile content"); const resolvedUri = resolveTilesetUri(manifest.tilesetRef, tile.content.uri, manifest.audience); const lod = expectedBinding.asset.lods[expectedBinding.lodIndex]!;
      if (resolvedUri !== lod.artifactRef || !expected.has(resolvedUri) || seen.has(resolvedUri)) throw new Error("Tile content URI does not match the canonical asset LOD refinement chain.");
      if (tile.geometricError !== lod.geometricErrorMeters) throw new Error("Tile geometric error differs from its manifest LOD."); seen.add(resolvedUri);
      if (expectedBinding.lodIndex === 0) { if (children.length !== 0 || tile.geometricError !== 0) throw new Error("Finest LOD must be a zero-error leaf."); }
      else { if (children.length !== 1) throw new Error("Each coarser LOD must refine to exactly one finer LOD."); walk(children[0]!, tile.geometricError!, depth + 1, { asset: expectedBinding.asset, lodIndex: expectedBinding.lodIndex - 1 }); }
    }
    active.delete(tile as object);
  };
  const rootError = (raw.root as Record<string, unknown>).geometricError; if (!finite(rootError, 0) || rootError > raw.geometricError) throw new Error("Tileset top-level geometricError must bound the root tile.");
  walk(raw.root as Tile, raw.geometricError, 0, null); if (seen.size !== expected.size) throw new Error("Tileset content closure is incomplete."); return seen;
}
async function sha256Bytes(bytes: Uint8Array): Promise<string> { const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>); return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, "0")).join(""); }

export async function replayMultiLodAssembly(manifest: MultiLodAssemblyManifest, contents: ReadonlyMap<string, Uint8Array>): Promise<AssemblyValidation<AssemblyReplay>> {
  const structural = validateMultiLodAssembly(manifest); if (!structural.ok) return structural;
  const issues: AssemblyIssue[] = []; const declared = new Map(manifest.artifacts.map((artifact) => [artifact.relativeRef, artifact]));
  const lodBindings = new Map<string, { asset: AssemblyAsset; lod: AssemblyLod }>();
  for (const asset of manifest.assets) for (const lod of asset.lods) {
    if (lodBindings.has(lod.artifactRef)) issue(issues, `assets.${asset.canonicalFeatureId}`, "Duplicate LOD artifact binding is forbidden.");
    else lodBindings.set(lod.artifactRef, { asset, lod });
  }
  for (const key of contents.keys()) if (!declared.has(key)) issue(issues, `contents.${key}`, "Undeclared content is forbidden.");
  const verified: AssemblyReplay["verifiedArtifacts"] = []; const cellByteTotals = new Map<string, number>(); let total = 0; let tilesetBytes: Uint8Array | null = null;
  for (const artifact of [...manifest.artifacts].sort((a, b) => compareText(a.relativeRef, b.relativeRef))) {
    const bytes = contents.get(artifact.relativeRef); if (!(bytes instanceof Uint8Array)) { issue(issues, `contents.${artifact.relativeRef}`, "Declared raw Uint8Array content is missing."); continue; }
    if (bytes.byteLength !== artifact.byteSize || await sha256Bytes(bytes) !== artifact.checksumSha256) { issue(issues, `contents.${artifact.relativeRef}`, "Artifact byte/hash accounting failed."); continue; }
    const next = add(total, bytes.byteLength); if (next === null || next > MULTI_LOD_ASSEMBLY_LIMITS.totalBytes) { issue(issues, "contents", "Verified byte accounting overflowed."); continue; } total = next;
    if (artifact.ownerCellId) { const cellNext = add(cellByteTotals.get(artifact.ownerCellId) ?? 0, bytes.byteLength); if (cellNext === null) issue(issues, `contents.${artifact.relativeRef}`, "Cell bytes overflowed."); else cellByteTotals.set(artifact.ownerCellId, cellNext); }
    try { if (artifact.role === "tileset-json") tilesetBytes = bytes; else { const binding = lodBindings.get(artifact.relativeRef); if (!binding) throw new Error("GLB has no asset/LOD binding."); validateGlbBinding(parseGlbV2(bytes), binding.asset, binding.lod); } } catch (error) { issue(issues, `contents.${artifact.relativeRef}`, error instanceof Error ? error.message : "Artifact validation failed."); }
    verified.push({ relativeRef: artifact.relativeRef, byteSize: bytes.byteLength, checksumSha256: artifact.checksumSha256 });
  }
  if (total !== manifest.declaredTotalBytes) issue(issues, "contents", "Verified total differs from the manifest.");
  if (tilesetBytes) try { validateTileset(tilesetBytes, manifest); } catch (error) { issue(issues, `contents.${manifest.tilesetRef}`, error instanceof Error ? error.message : "Tileset validation failed."); }
  if (issues.length) return { ok: false, issues };
  const cellBytes = Object.create(null) as Record<string, number>;
  for (const [cellId, byteSize] of [...cellByteTotals].sort(([left], [right]) => compareText(left, right))) cellBytes[cellId] = byteSize;
  return { ok: true, value: { manifest: canonicalManifest(manifest), fingerprintSha256: multiLodAssemblyFingerprint(manifest), verifiedArtifacts: verified, totalBytes: total, cellBytes } };
}
