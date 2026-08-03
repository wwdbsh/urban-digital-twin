import { normalizeLocalReleaseReference } from "./path-security.ts";
import { validateCityAssetManifest, type CityAssetManifest, type CityAssetValidationIssue } from "./city-asset-manifest.ts";

export const CITY_ASSET_PACKAGE_SCHEMA_VERSION = "1.0" as const;

export interface CityAssetPackage {
  schemaVersion: typeof CITY_ASSET_PACKAGE_SCHEMA_VERSION;
  packageId: string;
  generatedAt: string;
  fixtureOnly: boolean;
  /** Content refs are sorted and never rewritten after staging. */
  immutable: true;
  assets: CityAssetManifest[];
  expectedContentRefs: string[];
  verifiedContentRefs: string[];
  missingContentRefs: string[];
  corruptContentRefs: string[];
  state: "staged" | "replayed";
}

export type AssetPackageAssemblyResult = { ok: true; value: CityAssetPackage } | { ok: false; issues: CityAssetValidationIssue[] };
export interface AssetPackageContent { bytes: string | Uint8Array; }

export function validateCityAssetPackage(value: unknown): AssetPackageAssemblyResult {
  const issues: CityAssetValidationIssue[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, issues: [issue("$", "Expected an immutable CityAssetPackage object.")] };
  const pkg = value as Record<string, unknown>;
  if (pkg.schemaVersion !== CITY_ASSET_PACKAGE_SCHEMA_VERSION) issues.push(issue("schemaVersion", "Unsupported asset package schema version."));
  if (typeof pkg.packageId !== "string" || !pkg.packageId.trim()) issues.push(issue("packageId", "Package ID is required."));
  if (typeof pkg.generatedAt !== "string" || Number.isNaN(Date.parse(pkg.generatedAt))) issues.push(issue("generatedAt", "Package generatedAt must be an ISO timestamp."));
  if (typeof pkg.fixtureOnly !== "boolean") issues.push(issue("fixtureOnly", "Package fixtureOnly claim is required."));
  if (pkg.immutable !== true) issues.push(issue("immutable", "Asset packages must be immutable."));
  if (!Array.isArray(pkg.assets)) issues.push(issue("assets", "Asset manifests are required."));
  if (!Array.isArray(pkg.expectedContentRefs) || !pkg.expectedContentRefs.every((ref) => typeof ref === "string")) issues.push(issue("expectedContentRefs", "Expected content refs are required."));
  if (issues.length) return { ok: false, issues };
  const assembled = assembleCityAssetPackage(pkg.assets as CityAssetManifest[], { packageId: pkg.packageId as string, generatedAt: pkg.generatedAt as string, fixtureOnly: pkg.fixtureOnly as boolean });
  if (!assembled.ok) return assembled;
  const expected = assembled.value.expectedContentRefs;
  if (JSON.stringify(expected) !== JSON.stringify(pkg.expectedContentRefs)) issues.push(issue("expectedContentRefs", "Expected content refs must be deterministic and sorted."));
  return issues.length ? { ok: false, issues } : { ok: true, value: value as unknown as CityAssetPackage };
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value === "object" && value !== null) return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function issue(path: string, message: string): CityAssetValidationIssue { return { path, message }; }

function contentRefs(manifests: readonly CityAssetManifest[]): string[] {
  return [...new Set(manifests.flatMap((manifest) => manifest.assets.flatMap((asset) => asset.lodVariants.map((lod) => lod.content.relativeContentRef))))].sort();
}

/** Pure deterministic staging. It never reads or writes a path and never invents model bytes. */
export function assembleCityAssetPackage(manifests: readonly CityAssetManifest[], options: { packageId: string; generatedAt: string; fixtureOnly: boolean }): AssetPackageAssemblyResult {
  const issues: CityAssetValidationIssue[] = [];
  if (!options.packageId.trim() || !options.generatedAt || Number.isNaN(Date.parse(options.generatedAt))) issues.push(issue("options", "Package identity and ISO generatedAt are required."));
  const featureIds = new Set<string>(); const refs = new Set<string>();
  const assets = [...manifests].sort((left, right) => left.manifestId.localeCompare(right.manifestId)).map((manifest) => {
    const result = validateCityAssetManifest(manifest);
    if (!result.ok) result.issues.forEach((item) => issues.push({ path: `${manifest.manifestId}.${item.path}`, message: item.message }));
    for (const asset of manifest.assets) {
      if (featureIds.has(asset.canonicalFeatureId)) issues.push(issue(asset.canonicalFeatureId, "Canonical feature identity must be unique across the package."));
      featureIds.add(asset.canonicalFeatureId);
      for (const lod of asset.lodVariants) { if (refs.has(lod.content.relativeContentRef)) issues.push(issue(lod.content.relativeContentRef, "Content reference must be unique across the package.")); refs.add(lod.content.relativeContentRef); }
    }
    if (manifest.fixtureOnly !== options.fixtureOnly) issues.push(issue(manifest.manifestId, "Manifest fixtureOnly must match package fixtureOnly."));
    return manifest;
  });
  if (issues.length) return { ok: false, issues };
  const expectedContentRefs = contentRefs(assets);
  return { ok: true, value: { schemaVersion: CITY_ASSET_PACKAGE_SCHEMA_VERSION, packageId: options.packageId, generatedAt: options.generatedAt, fixtureOnly: options.fixtureOnly, immutable: true, assets, expectedContentRefs, verifiedContentRefs: [], missingContentRefs: expectedContentRefs, corruptContentRefs: [], state: "staged" } };
}

/** Resumable integrity pass: supplied bytes are checked independently, so a corrupt partial output never becomes eligible. */
export async function replayCityAssetPackage(pkg: CityAssetPackage, contents: ReadonlyMap<string, AssetPackageContent | undefined>): Promise<AssetPackageAssemblyResult> {
  const issues: CityAssetValidationIssue[] = [];
  const packageShape = validateCityAssetPackage(pkg);
  if (!packageShape.ok) return packageShape;
  const packageValidation = assembleCityAssetPackage(pkg.assets, { packageId: pkg.packageId, generatedAt: pkg.generatedAt, fixtureOnly: pkg.fixtureOnly });
  if (!packageValidation.ok) return packageValidation;
  const verified: string[] = []; const missing: string[] = []; const corrupt: string[] = [];
  for (const manifest of packageValidation.value.expectedContentRefs) {
    const ref = contents.get(manifest);
    const expected = pkg.assets.flatMap((manifestValue) => manifestValue.assets.flatMap((asset) => asset.lodVariants)).find((lod) => lod.content.relativeContentRef === manifest)?.content;
    if (!expected || !normalizeLocalReleaseReference(manifest)) { corrupt.push(manifest); continue; }
    if (expected.contentStatus === "metadata-only") { missing.push(manifest); continue; }
    if (!ref) { missing.push(manifest); continue; }
    const bytes = typeof ref.bytes === "string" ? new TextEncoder().encode(ref.bytes) : ref.bytes;
    if (bytes.byteLength !== expected.byteSize || (await sha256Bytes(bytes)).toLowerCase() !== expected.sha256.toLowerCase()) corrupt.push(manifest);
    else verified.push(manifest);
  }
  if (corrupt.length) issues.push(issue("contents", `Corrupt content refs refused: ${corrupt.join(", ")}`));
  if (issues.length) return { ok: false, issues };
  const replayedAssets = packageValidation.value.assets.map((manifestValue) => ({ ...manifestValue, assets: manifestValue.assets.map((asset) => ({ ...asset, lodVariants: asset.lodVariants.map((lod) => verified.includes(lod.content.relativeContentRef) ? { ...lod, content: { ...lod.content, contentStatus: "verified" as const } } : lod) })) }));
  return { ok: true, value: { ...packageValidation.value, assets: replayedAssets, expectedContentRefs: [...packageValidation.value.expectedContentRefs], verifiedContentRefs: verified, missingContentRefs: missing, corruptContentRefs: [], state: "replayed" } };
}

export function assetPackageFingerprint(pkg: CityAssetPackage): string {
  return stable({ ...pkg, state: undefined, verifiedContentRefs: undefined, missingContentRefs: undefined, corruptContentRefs: undefined });
}
