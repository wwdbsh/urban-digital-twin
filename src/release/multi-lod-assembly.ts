import { domainSeparatedSha256, stableSerialize } from "../domain/deterministic-hash.ts";
import { isSafeReleaseArtifactReference } from "../runtime/path-security.ts";

export const MULTI_LOD_ASSEMBLY_SCHEMA_VERSION = "1.0" as const;
export const MULTI_LOD_ASSEMBLY_LIMITS = {
  assets: 50_000, artifacts: 200_000, cells: 20_000, lodsPerAsset: 8,
  artifactBytes: 256 * 1024 * 1024, totalBytes: 8 * 1024 * 1024 * 1024,
  glbJsonBytes: 16 * 1024 * 1024, accessors: 200_000, primitives: 200_000,
  materials: 10_000, textures: 10_000, tileNodes: 200_000, tileDepth: 32,
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
function canonicalManifest(manifest: MultiLodAssemblyManifest): MultiLodAssemblyManifest {
  return {
    ...manifest,
    cells: [...manifest.cells].map((cell) => ({ ...cell, buildingIds: [...cell.buildingIds].sort() })).sort((a, b) => a.cellId.localeCompare(b.cellId)),
    assets: [...manifest.assets].map((asset) => ({ ...asset, truthTiers: [...asset.truthTiers].sort(), lods: [...asset.lods] })).sort((a, b) => a.canonicalFeatureId.localeCompare(b.canonicalFeatureId)),
    artifacts: [...manifest.artifacts].sort((a, b) => a.relativeRef.localeCompare(b.relativeRef)),
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
  const artifacts = new Map<string, AssemblyArtifact>(); let total = 0;
  if (Array.isArray(value.artifacts)) value.artifacts.forEach((raw, index) => {
    const path = `$.artifacts[${index}]`; if (!rec(raw)) return issue(issues, path, "Artifact must be an object.");
    exact(raw, ["logicalId", "role", "relativeRef", "byteSize", "checksumSha256", "ownerCellId"], path, issues);
    if (!text(raw.logicalId)) issue(issues, `${path}.logicalId`, "Logical ID is required.");
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
    let previousDistance = -1; let previousError = -1; let previousTriangles = Number.POSITIVE_INFINITY;
    raw.lods.forEach((lodRaw, lodIndex) => {
      const lodPath = `${path}.lods[${lodIndex}]`; if (!rec(lodRaw)) return issue(issues, lodPath, "LOD must be an object.");
      exact(lodRaw, ["lodId", "artifactRef", "geometricErrorMeters", "maxDistanceMeters", "eligible", "quality", "silhouette"], lodPath, issues);
      if (!text(lodRaw.lodId)) issue(issues, `${lodPath}.lodId`, "LOD ID is required.");
      if (!audiencePath(lodRaw.artifactRef, audience) || artifacts.get(String(lodRaw.artifactRef))?.role !== "glb" || artifacts.get(String(lodRaw.artifactRef))?.ownerCellId !== raw.ownerCellId || claimedRefs.has(String(lodRaw.artifactRef))) issue(issues, `${lodPath}.artifactRef`, "Each LOD must uniquely cite an owner-cell GLB."); else claimedRefs.add(lodRaw.artifactRef);
      if (!finite(lodRaw.geometricErrorMeters, 0) || lodRaw.geometricErrorMeters < previousError) issue(issues, `${lodPath}.geometricErrorMeters`, "Near-to-far geometric error must be nondecreasing."); else previousError = lodRaw.geometricErrorMeters;
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
        else { exact(lodRaw.silhouette, ["status", "method", "metricVersion", "planHashSha256", "viewIds", "deviationRatio", "maximumRatio"], `${lodPath}.silhouette`, issues); if (lodRaw.silhouette.status !== "authoring-declared" || lodRaw.silhouette.method !== "projected-silhouette-ratio" || lodRaw.silhouette.metricVersion !== "1.0" || !hash(lodRaw.silhouette.planHashSha256) || !stringList(lodRaw.silhouette.viewIds, `${lodPath}.silhouette.viewIds`, issues) || !finite(lodRaw.silhouette.deviationRatio, 0) || lodRaw.silhouette.maximumRatio !== 0.02 || lodRaw.silhouette.deviationRatio > 0.02) issue(issues, `${lodPath}.silhouette`, "Declared silhouette metadata must use v1 and stay within 2%."); if (rec(raw.source) && raw.source.kind === "facade-plan" && lodRaw.silhouette.planHashSha256 !== raw.source.planHashSha256) issue(issues, `${lodPath}.silhouette.planHashSha256`, "Silhouette measurement must bind the facade plan."); }
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
  while (end > 0 && (decoded.charCodeAt(end - 1) === 0 || decoded.charCodeAt(end - 1) === 32)) end -= 1;
  return JSON.parse(decoded.slice(0, end));
}
export function parseGlbV2(bytes: Uint8Array): ParsedGlb {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 20 || bytes.byteLength > MULTI_LOD_ASSEMBLY_LIMITS.artifactBytes) throw new Error("GLB byte length is outside the supported profile.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (u32(view, 0) !== 0x46546c67 || u32(view, 4) !== 2 || u32(view, 8) !== bytes.byteLength) throw new Error("GLB 2 header or declared length is invalid.");
  let offset = 12; let json: Record<string, unknown> | null = null; let jsonBytes = 0; let binBytes = 0; let chunks = 0;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) throw new Error("GLB chunk header is truncated.");
    const length = u32(view, offset); const type = u32(view, offset + 4); offset += 8;
    if (length % 4 !== 0 || offset + length > bytes.byteLength) throw new Error("GLB chunk alignment or length is invalid.");
    const chunk = bytes.subarray(offset, offset + length); offset += length; chunks += 1;
    if (chunks === 1 && type !== 0x4e4f534a) throw new Error("GLB JSON must be the first chunk.");
    if (type === 0x4e4f534a) { if (json) throw new Error("GLB may contain exactly one JSON chunk."); jsonBytes = length; if (length > MULTI_LOD_ASSEMBLY_LIMITS.glbJsonBytes) throw new Error("GLB JSON exceeds the cap."); const parsed = parseJsonBytes(chunk); if (!rec(parsed)) throw new Error("GLB JSON must be an object."); json = parsed; }
    else if (type === 0x004e4942) { if (binBytes) throw new Error("GLB may contain at most one BIN chunk."); binBytes = length; }
    else throw new Error("Unsupported GLB chunk type.");
  }
  if (!json || offset !== bytes.byteLength) throw new Error("GLB JSON or exact byte closure is missing.");
  validateGltfJson(json, binBytes);
  return { json, jsonBytes, binBytes };
}
function validateGltfJson(json: Record<string, unknown>, binBytes: number): void {
  if (!rec(json.asset) || json.asset.version !== "2.0") throw new Error("glTF asset.version 2.0 is required.");
  const unsupported = Array.isArray(json.extensionsUsed) ? json.extensionsUsed.filter((name) => typeof name === "string" && /draco|meshopt|compression/iu.test(name)) : [];
  if (unsupported.length) throw new Error("Compressed glTF extensions are unsupported.");
  const buffers = Array.isArray(json.buffers) ? json.buffers : [];
  if (buffers.length !== 1 || !rec(buffers[0]) || "uri" in buffers[0] || !integer(buffers[0].byteLength, binBytes) || buffers[0].byteLength > binBytes) throw new Error("One embedded BIN buffer with a bounded length is required.");
  if (Array.isArray(json.images) && json.images.some((image) => rec(image) && "uri" in image)) throw new Error("External image URIs are forbidden.");
  const views = Array.isArray(json.bufferViews) ? json.bufferViews : [];
  for (const raw of views) { if (!rec(raw) || raw.buffer !== 0 || !integer(raw.byteOffset ?? 0) || !integer(raw.byteLength) || (raw.byteOffset as number | undefined ?? 0) + (raw.byteLength as number) > (buffers[0].byteLength as number)) throw new Error("bufferView range is invalid."); }
  const accessors = Array.isArray(json.accessors) ? json.accessors : [];
  if (accessors.length > MULTI_LOD_ASSEMBLY_LIMITS.accessors) throw new Error("Accessor cap exceeded.");
  for (const raw of accessors) { if (!rec(raw) || "sparse" in raw || !integer(raw.bufferView, Math.max(0, views.length - 1)) || !integer(raw.count) || ![5121, 5123, 5125, 5126].includes(Number(raw.componentType)) || !["SCALAR", "VEC2", "VEC3", "VEC4"].includes(String(raw.type))) throw new Error("Accessor profile or range is invalid."); }
  const meshes = Array.isArray(json.meshes) ? json.meshes : []; let primitives = 0;
  for (const mesh of meshes) { if (!rec(mesh) || !Array.isArray(mesh.primitives)) throw new Error("Mesh primitives are required."); for (const primitive of mesh.primitives) { primitives += 1; if (!rec(primitive) || (primitive.mode ?? 4) !== 4 || !rec(primitive.attributes) || !integer(primitive.attributes.POSITION, Math.max(0, accessors.length - 1)) || !integer(primitive.indices, Math.max(0, accessors.length - 1))) throw new Error("Only indexed TRIANGLES with POSITION are supported."); const indexAccessor = accessors[primitive.indices as number] as Record<string, unknown>; const positionAccessor = accessors[primitive.attributes.POSITION as number] as Record<string, unknown>; if (indexAccessor.type !== "SCALAR" || (indexAccessor.count as number) % 3 !== 0 || positionAccessor.type !== "VEC3" || (positionAccessor.count as number) < 3) throw new Error("Triangle topology accessor counts are invalid."); } }
  if (primitives === 0 || primitives > MULTI_LOD_ASSEMBLY_LIMITS.primitives) throw new Error("Primitive count is outside the profile.");
  if ((Array.isArray(json.materials) ? json.materials.length : 0) > MULTI_LOD_ASSEMBLY_LIMITS.materials || (Array.isArray(json.textures) ? json.textures.length : 0) > MULTI_LOD_ASSEMBLY_LIMITS.textures) throw new Error("Material or texture cap exceeded.");
}

interface UdtGlbMetadata { canonicalFeatureId: string; lodId: string; ownerCellId: string; inventoryId: string; inventoryHashSha256: string; evidenceShardId: string; truthTiers: ComponentTruthTier[]; sourceDates: { capturedAt: string | null; updatedAt: string | null }; predecessor: ImmutablePin | null; uncertainty: string; planHashSha256: string }
function glbMetadata(json: Record<string, unknown>): UdtGlbMetadata | null { const extras = rec(json.extras) ? json.extras : null; return extras && rec(extras.urbanDigitalTwin) ? extras.urbanDigitalTwin as unknown as UdtGlbMetadata : null; }
function counts(json: Record<string, unknown>): { triangleCount: number; materialCount: number; textureCount: number } {
  const accessors = json.accessors as Record<string, unknown>[]; let triangles = 0;
  for (const mesh of json.meshes as Array<{ primitives: Array<{ indices: number }> }>) for (const primitive of mesh.primitives) triangles += (accessors[primitive.indices]!.count as number) / 3;
  return { triangleCount: triangles, materialCount: Array.isArray(json.materials) ? json.materials.length : 0, textureCount: Array.isArray(json.textures) ? json.textures.length : 0 };
}
function validateGlbBinding(parsed: ParsedGlb, asset: AssemblyAsset, lod: AssemblyLod): void {
  const metadata = glbMetadata(parsed.json); if (!metadata) throw new Error("GLB canonical metadata is required.");
  const expected = { canonicalFeatureId: asset.canonicalFeatureId, lodId: lod.lodId, ownerCellId: asset.ownerCellId, inventoryId: asset.inventoryId, inventoryHashSha256: asset.inventoryHashSha256, evidenceShardId: asset.evidenceShardId, truthTiers: [...asset.truthTiers].sort(), sourceDates: asset.sourceDates, predecessor: asset.predecessor, uncertainty: asset.uncertainty, planHashSha256: asset.source.kind === "facade-plan" ? asset.source.planHashSha256 : asset.source.assetManifestChecksumSha256 };
  if (stableSerialize({ ...metadata, truthTiers: [...metadata.truthTiers].sort() }) !== stableSerialize(expected)) throw new Error("GLB canonical metadata differs from the immutable assembly manifest.");
  if (stableSerialize(counts(parsed.json)) !== stableSerialize({ triangleCount: lod.quality.triangleCount, materialCount: lod.quality.materialCount, textureCount: lod.quality.textureCount })) throw new Error("GLB topology/material/texture counts differ from declared quality.");
}

interface Tile { boundingVolume?: { box?: number[] }; geometricError?: number; refine?: string; transform?: number[]; content?: { uri?: string }; children?: Tile[] }
function validateTransform(value: unknown): void { if (!Array.isArray(value) || value.length !== 16 || !value.every(Number.isFinite) || value.some((part) => Math.abs(part) > 1e9) || value[3] !== 0 || value[7] !== 0 || value[11] !== 0 || value[15] !== 1) throw new Error("3D Tiles transform must be bounded column-major affine."); const determinant = value[0]! * (value[5]! * value[10]! - value[9]! * value[6]!) - value[4]! * (value[1]! * value[10]! - value[9]! * value[2]!) + value[8]! * (value[1]! * value[6]! - value[5]! * value[2]!); if (Math.abs(determinant) < 1e-9) throw new Error("3D Tiles transform is singular."); }
function validateBox(value: unknown): void { if (!Array.isArray(value) || value.length !== 12 || !value.every(Number.isFinite)) throw new Error("3D Tiles box requires 12 finite numbers."); for (const offset of [3, 6, 9]) if (Math.hypot(value[offset]!, value[offset + 1]!, value[offset + 2]!) <= 0) throw new Error("3D Tiles box half axes must be nondegenerate."); }
function validateTileset(bytes: Uint8Array, manifest: MultiLodAssemblyManifest): Set<string> {
  if (bytes.byteLength > MULTI_LOD_ASSEMBLY_LIMITS.glbJsonBytes) throw new Error("Tileset JSON exceeds the cap."); const raw = parseJsonBytes(bytes); if (!rec(raw) || !rec(raw.asset) || raw.asset.version !== "1.1" || !rec(raw.root)) throw new Error("3D Tiles 1.1 root is required.");
  const expected = new Map<string, { asset: AssemblyAsset; lod: AssemblyLod }>(); for (const asset of manifest.assets) for (const lod of asset.lods) expected.set(lod.artifactRef, { asset, lod });
  const seen = new Set<string>(); const active = new Set<object>(); let nodes = 0;
  const walk = (tile: Tile, parentError: number | null, depth: number): void => {
    if (!rec(tile)) throw new Error("Tile must be an object."); if (active.has(tile as object)) throw new Error("Tile graph cycle detected."); active.add(tile as object); nodes += 1;
    if (nodes > MULTI_LOD_ASSEMBLY_LIMITS.tileNodes || depth > MULTI_LOD_ASSEMBLY_LIMITS.tileDepth) throw new Error("Tileset topology cap exceeded.");
    const volume = tile.boundingVolume; if (!rec(volume)) throw new Error("Tile bounding volume is required."); validateBox(volume.box);
    if (!finite(tile.geometricError, 0) || (parentError !== null && tile.geometricError! > parentError)) throw new Error("Tile geometric error hierarchy is invalid.");
    if ((tile.refine ?? "REPLACE") !== "REPLACE") throw new Error("Only REPLACE refinement is supported."); if (tile.transform !== undefined) validateTransform(tile.transform);
    const children = tile.children ?? []; if (!Array.isArray(children)) throw new Error("Tile children must be an array.");
    if (children.length === 0 && tile.geometricError !== 0) throw new Error("Content leaves must have zero geometric error.");
    if (tile.content !== undefined) { if (!rec(tile.content)) throw new Error("Tile content must be an object."); const uri = tile.content.uri; if (!audiencePath(uri, manifest.audience) || !expected.has(uri) || seen.has(uri)) throw new Error("Tile content URI is unsafe, undeclared, or duplicated."); seen.add(uri); }
    for (const child of children) walk(child, tile.geometricError!, depth + 1); active.delete(tile as object);
  };
  walk(raw.root as Tile, null, 0); if (seen.size !== expected.size) throw new Error("Tileset content closure is incomplete."); return seen;
}
async function sha256Bytes(bytes: Uint8Array): Promise<string> { const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>); return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, "0")).join(""); }

export async function replayMultiLodAssembly(manifest: MultiLodAssemblyManifest, contents: ReadonlyMap<string, Uint8Array>): Promise<AssemblyValidation<AssemblyReplay>> {
  const structural = validateMultiLodAssembly(manifest); if (!structural.ok) return structural;
  const issues: AssemblyIssue[] = []; const declared = new Map(manifest.artifacts.map((artifact) => [artifact.relativeRef, artifact]));
  for (const key of contents.keys()) if (!declared.has(key)) issue(issues, `contents.${key}`, "Undeclared content is forbidden.");
  const verified: AssemblyReplay["verifiedArtifacts"] = []; const cellBytes: Record<string, number> = {}; let total = 0; let tilesetBytes: Uint8Array | null = null;
  for (const artifact of [...manifest.artifacts].sort((a, b) => a.relativeRef.localeCompare(b.relativeRef))) {
    const bytes = contents.get(artifact.relativeRef); if (!(bytes instanceof Uint8Array)) { issue(issues, `contents.${artifact.relativeRef}`, "Declared raw Uint8Array content is missing."); continue; }
    if (bytes.byteLength !== artifact.byteSize || await sha256Bytes(bytes) !== artifact.checksumSha256) { issue(issues, `contents.${artifact.relativeRef}`, "Artifact byte/hash accounting failed."); continue; }
    const next = add(total, bytes.byteLength); if (next === null || next > MULTI_LOD_ASSEMBLY_LIMITS.totalBytes) { issue(issues, "contents", "Verified byte accounting overflowed."); continue; } total = next;
    if (artifact.ownerCellId) { const cellNext = add(cellBytes[artifact.ownerCellId] ?? 0, bytes.byteLength); if (cellNext === null) issue(issues, `contents.${artifact.relativeRef}`, "Cell bytes overflowed."); else cellBytes[artifact.ownerCellId] = cellNext; }
    try { if (artifact.role === "tileset-json") tilesetBytes = bytes; else { const binding = manifest.assets.flatMap((asset) => asset.lods.map((lod) => ({ asset, lod }))).find(({ lod }) => lod.artifactRef === artifact.relativeRef); if (!binding) throw new Error("GLB has no asset/LOD binding."); validateGlbBinding(parseGlbV2(bytes), binding.asset, binding.lod); } } catch (error) { issue(issues, `contents.${artifact.relativeRef}`, error instanceof Error ? error.message : "Artifact validation failed."); }
    verified.push({ relativeRef: artifact.relativeRef, byteSize: bytes.byteLength, checksumSha256: artifact.checksumSha256 });
  }
  if (total !== manifest.declaredTotalBytes) issue(issues, "contents", "Verified total differs from the manifest.");
  if (tilesetBytes) try { validateTileset(tilesetBytes, manifest); } catch (error) { issue(issues, `contents.${manifest.tilesetRef}`, error instanceof Error ? error.message : "Tileset validation failed."); }
  if (issues.length) return { ok: false, issues };
  return { ok: true, value: { manifest: canonicalManifest(manifest), fingerprintSha256: multiLodAssemblyFingerprint(manifest), verifiedArtifacts: verified, totalBytes: total, cellBytes } };
}
