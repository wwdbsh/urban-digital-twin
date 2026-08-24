/**
 * Provider-neutral ground contracts (Task T005).
 *
 * This module owns the *city-agnostic* half of the citywide ground surface:
 * what a ground feature is, how a multi-cell ground feature is split into
 * per-cell parts without ever gaining a second selectable identity, and what a
 * ground asset's distance tiers may look like. Manhattan constants, the
 * partition ledger, and the release document live in
 * `../release/ground-release.ts`; nothing here may name a city.
 *
 * Four decisions are load-bearing and are stated once, here:
 *
 * 1. **Two-level identity.** A `GroundFeature` is the single deep-linkable
 *    identity for a real-world surface. A `GroundFeaturePart` is that feature's
 *    clipped share of exactly one ownership cell. Central Park spans many cells
 *    and therefore has many parts, but it remains ONE feature, so a deep link,
 *    a details panel, and a selection all resolve to one thing.
 * 2. **Referenced identity beats minted identity.** Classes named by
 *    `GroundIdentityPolicy.referencedExistingClasses` (parks, by default) MUST
 *    reuse the catalog identity the ingestion pipeline already normalized —
 *    `udt:<city>:park:<gispropnum>` — instead of minting a ground-owned
 *    duplicate. Ground-owned ids live in their own `udt:ground:` namespace, so
 *    the two can never be confused and there can never be two selectable
 *    Central Parks.
 * 3. **Embellishments are always estimated.** `curb` and `crosswalk` are
 *    near-tier 3D embellishments derived from planimetric inputs, not surveyed
 *    facts. The Block 835 public-realm release already caps their claims at
 *    "estimated" in prose (`../runtime/block835-public-realm-release.ts`
 *    `claimCeilings`); here it is unrepresentable at the type level and refused
 *    at the validator level, so citywide scale cannot quietly promote it.
 * 4. **Every asset has exactly one always-covering flat tier.** The polygon
 *    base must work standalone at any distance, so each asset declares exactly
 *    one `flat` tier with `maxDistanceMeters === null`. This is deliberately
 *    NOT `AssemblyLod` from the building pipeline: that type carries silhouette
 *    and facade-plan obligations a cartographic ground surface does not have.
 *    Runtime tier SELECTION is a later task's concern; this module only pins
 *    the shape and the coverage invariant.
 *
 * Artifact-reference SAFETY is deliberately not checked here. `src/domain` may
 * not import `../runtime/path-security.ts`, and a second, weaker path check
 * would be exactly the drifting authority this contract exists to prevent.
 * `../release/ground-release.ts` applies `isSafeReleaseArtifactReference` to
 * every `artifactRef` it validates; this module only requires non-emptiness.
 */

import { domainSeparatedSha256 } from "./deterministic-hash.ts";
import type { SourceRef } from "./schema.ts";

export const GROUND_CONTRACT_VERSION = "1.0" as const;

/** Flat cartographic base classes. These are the surfaces the polygon base draws. */
export const GROUND_BASE_CLASSES = ["roadbed", "sidewalk", "park", "plaza", "water"] as const;
export type GroundClass = (typeof GROUND_BASE_CLASSES)[number];

/** Near-tier 3D embellishments layered over the flat base. Always estimated. */
export const GROUND_EMBELLISHMENT_CLASSES = ["curb", "crosswalk"] as const;
export type GroundEmbellishmentClass = (typeof GROUND_EMBELLISHMENT_CLASSES)[number];

export const GROUND_SURFACE_CLASSES = [...GROUND_BASE_CLASSES, ...GROUND_EMBELLISHMENT_CLASSES] as const;
export type GroundSurfaceClass = GroundClass | GroundEmbellishmentClass;

/** Per-feature claim strength. Aggregate prose ceilings live on the release document. */
export type GroundClaimLevel = "source-backed" | "estimated";

export function isGroundClass(value: unknown): value is GroundClass {
  return typeof value === "string" && (GROUND_BASE_CLASSES as readonly string[]).includes(value);
}

export function isGroundEmbellishmentClass(value: unknown): value is GroundEmbellishmentClass {
  return typeof value === "string" && (GROUND_EMBELLISHMENT_CLASSES as readonly string[]).includes(value);
}

export function isGroundSurfaceClass(value: unknown): value is GroundSurfaceClass {
  return isGroundClass(value) || isGroundEmbellishmentClass(value);
}

/**
 * Where a ground feature's identity comes from.
 *
 * `referenced-existing` is the anti-duplication case: the ground layer renders a
 * surface for a feature the catalog already owns, and reuses its id rather than
 * minting one. `existingFeatureId` must equal `canonicalFeatureId` — a reference
 * that points somewhere else would be a second identity wearing a citation.
 */
export type GroundIdentityOrigin =
  | { kind: "ground-owned" }
  | { kind: "referenced-existing"; existingFeatureId: string };

export interface GroundUncertainty {
  horizontalMeters: number | null;
  verticalMeters: number | null;
  temporal: string;
}

interface GroundFeatureCommon {
  canonicalFeatureId: string;
  cityId: string;
  sourceRefs: SourceRef[];
  uncertainty: GroundUncertainty;
  identityOrigin: GroundIdentityOrigin;
}

export interface GroundSurfaceFeature extends GroundFeatureCommon {
  class: GroundClass;
  claimLevel: GroundClaimLevel;
}

/** A source-backed curb or crosswalk is unrepresentable, by construction. */
export interface GroundEmbellishmentFeature extends GroundFeatureCommon {
  class: GroundEmbellishmentClass;
  claimLevel: "estimated";
}

export type GroundFeature = GroundSurfaceFeature | GroundEmbellishmentFeature;

/**
 * One canonical feature's clipped share of exactly one ownership cell.
 *
 * A part is NOT selectable and carries no provenance of its own: it exists so a
 * cell can be loaded, cached, and checksummed atomically. Everything a user can
 * ask about resolves through `canonicalFeatureId`.
 */
export interface GroundFeaturePart {
  partId: string;
  canonicalFeatureId: string;
  ownerCellId: string;
}

/**
 * One distance tier of one ground asset.
 *
 * `maxDistanceMeters === null` means "covers every distance". Exactly one tier
 * per asset may say that, and it must be the `flat` one.
 */
export interface GroundTier {
  tierId: string;
  kind: "near-3d" | "flat";
  maxDistanceMeters: number | null;
  artifactRef: string;
  checksumSha256: string;
}

export interface GroundAssetTiers {
  assetId: string;
  class: GroundSurfaceClass;
  tiers: GroundTier[];
}

/**
 * Which classes may not mint their own identity.
 *
 * A configuration switch rather than a constant so a city whose parks have no
 * catalog identity can still be expressed — but the default is strict, because
 * the failure it prevents (two selectable Central Parks) is silent and
 * user-visible.
 */
export interface GroundIdentityPolicy {
  referencedExistingClasses: readonly GroundSurfaceClass[];
}

export const DEFAULT_GROUND_IDENTITY_POLICY: GroundIdentityPolicy = {
  referencedExistingClasses: ["park"],
};

/**
 * Catalog identities normalized by the ingestion pipeline, e.g.
 * `udt:manhattan:park:M010` (see `scripts/travel-context-cli.mjs`
 * `normalizeParks`, which groups park rows by GISPROPNUM into exactly this
 * form). The class segment is captured so it can be checked against the
 * feature's own class.
 */
export const GROUND_EXISTING_FEATURE_ID_PATTERN = /^udt:([a-z0-9-]+):([a-z0-9-]+):([A-Za-z0-9._-]+)$/u;

/**
 * Ground-owned identities live under their own `udt:ground:` prefix so they can
 * never be mistaken for, or collide with, a catalog identity.
 */
export const GROUND_OWNED_FEATURE_ID_PATTERN = /^udt:ground:([a-z0-9-]+):([a-z0-9-]+):([A-Za-z0-9._-]+)$/u;

/**
 * Part ids are derived, never declared, so a feature/cell pair has exactly one
 * spelling. `#` is the separator because it is rejected by
 * `normalizeReleaseArtifactReference`, which means a part id can never be
 * mistaken for an artifact path.
 */
export const GROUND_PART_ID_SEPARATOR = "#" as const;

export function groundPartId(canonicalFeatureId: string, ownerCellId: string): string {
  if (canonicalFeatureId.includes(GROUND_PART_ID_SEPARATOR) || ownerCellId.includes(GROUND_PART_ID_SEPARATOR)) {
    throw new Error(`Ground identity segments must not contain "${GROUND_PART_ID_SEPARATOR}".`);
  }
  if (canonicalFeatureId.length === 0 || ownerCellId.length === 0) {
    throw new Error("Ground part identity requires a canonical feature id and an owner cell id.");
  }
  return `${canonicalFeatureId}${GROUND_PART_ID_SEPARATOR}${ownerCellId}`;
}

export function parseGroundPartId(partId: unknown): { canonicalFeatureId: string; ownerCellId: string } | null {
  if (typeof partId !== "string") return null;
  const segments = partId.split(GROUND_PART_ID_SEPARATOR);
  if (segments.length !== 2) return null;
  const [canonicalFeatureId, ownerCellId] = segments as [string, string];
  if (canonicalFeatureId.length === 0 || ownerCellId.length === 0) return null;
  return { canonicalFeatureId, ownerCellId };
}

export interface GroundIssue { path: string; message: string }
export type GroundValidation<T> = { ok: true; value: T } | { ok: false; issues: GroundIssue[] };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function checksum(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }
function issue(issues: GroundIssue[], path: string, message: string): void { issues.push({ path, message }); }

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, issues: GroundIssue[], optional: readonly string[] = []): void {
  const allowlist = new Set([...allowed, ...optional]);
  for (const key of Object.keys(value)) if (!allowlist.has(key)) issue(issues, `${path}.${key}`, "Unexpected ground field.");
  for (const key of allowed) if (!(key in value)) issue(issues, `${path}.${key}`, "Required ground field is missing.");
}

/**
 * Byte-order-independent id ordering.
 *
 * `localeCompare` is locale- and ICU-version dependent, which is precisely the
 * kind of environment sensitivity a checksummed membership list must not have.
 */
export function compareGroundIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sortGroundIds(values: Iterable<string>): string[] {
  return [...values].sort(compareGroundIds);
}

/**
 * Identity-critical `SourceRef` subset.
 *
 * `./schema.ts` remains the shape authority; re-validating every field here
 * would create a second contract to keep in sync. What ground genuinely needs
 * is that a citation can be resolved back to a registered source and a record.
 */
function validateSourceRefs(value: unknown, path: string, issues: GroundIssue[]): void {
  if (!Array.isArray(value)) return issue(issues, path, "Source references must be an array.");
  value.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!record(entry)) return issue(issues, entryPath, "Source reference must be an object.");
    for (const field of ["id", "registryEntryId", "provider", "datasetId", "sourceRecordId", "licenseRefId"] as const) {
      if (!nonEmpty(entry[field])) issue(issues, `${entryPath}.${field}`, "Source reference identity field is required.");
    }
  });
}

function validateUncertainty(value: unknown, path: string, issues: GroundIssue[]): void {
  if (!record(value)) return issue(issues, path, "Uncertainty declaration is required.");
  exactKeys(value, ["horizontalMeters", "verticalMeters", "temporal"], path, issues);
  for (const field of ["horizontalMeters", "verticalMeters"] as const) {
    const measure = value[field];
    if (measure !== null && !(typeof measure === "number" && Number.isFinite(measure) && measure >= 0)) {
      issue(issues, `${path}.${field}`, "Uncertainty magnitude must be null or a finite non-negative number.");
    }
  }
  if (!nonEmpty(value.temporal)) issue(issues, `${path}.temporal`, "Temporal uncertainty statement is required.");
}

function validateIdentityOrigin(value: unknown, path: string, featureClass: unknown, canonicalFeatureId: unknown, policy: GroundIdentityPolicy, issues: GroundIssue[]): void {
  if (!record(value)) return issue(issues, path, "Identity origin is required.");
  const mustReference = isGroundSurfaceClass(featureClass) && policy.referencedExistingClasses.includes(featureClass);
  if (value.kind === "ground-owned") {
    exactKeys(value, ["kind"], path, issues);
    if (mustReference) {
      issue(issues, `${path}.kind`, `Class ${String(featureClass)} must reference an existing catalog identity rather than mint a ground-owned one.`);
      return;
    }
    const match = typeof canonicalFeatureId === "string" ? GROUND_OWNED_FEATURE_ID_PATTERN.exec(canonicalFeatureId) : null;
    if (!match) issue(issues, `${path}.kind`, "A ground-owned identity must be minted as udt:ground:<city>:<class>:<local>.");
    else if (match[2] !== featureClass) issue(issues, `${path}.kind`, "A ground-owned identity must name its own class.");
    return;
  }
  if (value.kind === "referenced-existing") {
    exactKeys(value, ["kind", "existingFeatureId"], path, issues);
    if (!nonEmpty(value.existingFeatureId)) return issue(issues, `${path}.existingFeatureId`, "Referenced catalog identity is required.");
    if (value.existingFeatureId !== canonicalFeatureId) {
      issue(issues, `${path}.existingFeatureId`, "A referenced identity must BE the canonical feature id, not point at another one.");
    }
    const match = GROUND_EXISTING_FEATURE_ID_PATTERN.exec(value.existingFeatureId);
    if (!match) issue(issues, `${path}.existingFeatureId`, "Referenced catalog identity must be a normalized udt:<city>:<class>:<sourceId> id.");
    else if (match[2] !== featureClass) issue(issues, `${path}.existingFeatureId`, "Referenced catalog identity must name the same class as the ground feature.");
    else if (match[1] === "ground") issue(issues, `${path}.existingFeatureId`, "A ground-owned id is not an existing catalog identity.");
    return;
  }
  issue(issues, `${path}.kind`, "Unknown ground identity origin.");
}

export function collectGroundFeatureIssues(value: unknown, path: string, issues: GroundIssue[], policy: GroundIdentityPolicy = DEFAULT_GROUND_IDENTITY_POLICY): void {
  if (!record(value)) return issue(issues, path, "Ground feature must be an object.");
  exactKeys(value, ["canonicalFeatureId", "cityId", "class", "claimLevel", "sourceRefs", "uncertainty", "identityOrigin"], path, issues);
  if (!nonEmpty(value.canonicalFeatureId)) issue(issues, `${path}.canonicalFeatureId`, "Canonical feature id is required.");
  else if (value.canonicalFeatureId.includes(GROUND_PART_ID_SEPARATOR)) issue(issues, `${path}.canonicalFeatureId`, `Canonical feature id must not contain "${GROUND_PART_ID_SEPARATOR}".`);
  if (!nonEmpty(value.cityId)) issue(issues, `${path}.cityId`, "City id is required.");
  if (!isGroundSurfaceClass(value.class)) issue(issues, `${path}.class`, "Unknown ground class.");
  if (value.claimLevel !== "source-backed" && value.claimLevel !== "estimated") issue(issues, `${path}.claimLevel`, "Claim level must be source-backed or estimated.");
  else if (isGroundEmbellishmentClass(value.class) && value.claimLevel !== "estimated") {
    issue(issues, `${path}.claimLevel`, "Curb and crosswalk embellishments are always estimated; they may never be declared source-backed.");
  }
  if (value.claimLevel === "source-backed" && Array.isArray(value.sourceRefs) && value.sourceRefs.length === 0) {
    issue(issues, `${path}.sourceRefs`, "A source-backed ground feature requires at least one source reference.");
  }
  validateSourceRefs(value.sourceRefs, `${path}.sourceRefs`, issues);
  validateUncertainty(value.uncertainty, `${path}.uncertainty`, issues);
  validateIdentityOrigin(value.identityOrigin, `${path}.identityOrigin`, value.class, value.canonicalFeatureId, policy, issues);
}

export function validateGroundFeature(value: unknown, policy: GroundIdentityPolicy = DEFAULT_GROUND_IDENTITY_POLICY): GroundValidation<GroundFeature> {
  const issues: GroundIssue[] = [];
  collectGroundFeatureIssues(value, "$", issues, policy);
  return issues.length === 0 ? { ok: true, value: value as GroundFeature } : { ok: false, issues };
}

export function collectGroundFeaturePartIssues(value: unknown, path: string, issues: GroundIssue[]): void {
  if (!record(value)) return issue(issues, path, "Ground feature part must be an object.");
  exactKeys(value, ["partId", "canonicalFeatureId", "ownerCellId"], path, issues);
  if (!nonEmpty(value.partId)) issue(issues, `${path}.partId`, "Part id is required.");
  if (!nonEmpty(value.canonicalFeatureId)) issue(issues, `${path}.canonicalFeatureId`, "Parent canonical feature id is required.");
  if (!nonEmpty(value.ownerCellId)) issue(issues, `${path}.ownerCellId`, "Owner cell id is required.");
  const parsed = parseGroundPartId(value.partId);
  if (!parsed) issue(issues, `${path}.partId`, "Part id must be <canonicalFeatureId>#<ownerCellId>.");
  else if (parsed.canonicalFeatureId !== value.canonicalFeatureId || parsed.ownerCellId !== value.ownerCellId) {
    issue(issues, `${path}.partId`, "Part id must be derived from its own parent feature and owner cell.");
  }
}

export function validateGroundFeaturePart(value: unknown): GroundValidation<GroundFeaturePart> {
  const issues: GroundIssue[] = [];
  collectGroundFeaturePartIssues(value, "$", issues);
  return issues.length === 0 ? { ok: true, value: value as GroundFeaturePart } : { ok: false, issues };
}

/**
 * Tier-set invariants, in the one place that may state them.
 *
 * The unbounded flat tier is what makes the polygon base usable standalone: at
 * any distance, with every near-tier embellishment absent, there is still
 * something to draw. Two unbounded tiers would make the choice ambiguous; zero
 * would make far views empty.
 */
export function collectGroundAssetTierIssues(value: unknown, path: string, issues: GroundIssue[]): void {
  if (!record(value)) return issue(issues, path, "Ground asset tier set must be an object.");
  exactKeys(value, ["assetId", "class", "tiers"], path, issues);
  if (!nonEmpty(value.assetId)) issue(issues, `${path}.assetId`, "Asset id is required.");
  if (!isGroundSurfaceClass(value.class)) issue(issues, `${path}.class`, "Unknown ground class.");
  if (!Array.isArray(value.tiers) || value.tiers.length === 0) return issue(issues, `${path}.tiers`, "At least one ground tier is required.");
  const tierIds = new Set<string>();
  let unbounded = 0;
  value.tiers.forEach((tier, index) => {
    const tierPath = `${path}.tiers[${index}]`;
    if (!record(tier)) return issue(issues, tierPath, "Ground tier must be an object.");
    exactKeys(tier, ["tierId", "kind", "maxDistanceMeters", "artifactRef", "checksumSha256"], tierPath, issues);
    if (!nonEmpty(tier.tierId)) issue(issues, `${tierPath}.tierId`, "Tier id is required.");
    else if (tierIds.has(tier.tierId)) issue(issues, `${tierPath}.tierId`, "Tier ids must be unique within an asset.");
    else tierIds.add(tier.tierId);
    if (tier.kind !== "near-3d" && tier.kind !== "flat") issue(issues, `${tierPath}.kind`, "Tier kind must be near-3d or flat.");
    if (tier.maxDistanceMeters === null) {
      unbounded += 1;
      if (tier.kind !== "flat") issue(issues, `${tierPath}.kind`, "Only the flat cartographic tier may cover every distance.");
    } else if (!(typeof tier.maxDistanceMeters === "number" && Number.isFinite(tier.maxDistanceMeters) && tier.maxDistanceMeters > 0)) {
      issue(issues, `${tierPath}.maxDistanceMeters`, "Tier max distance must be null or a finite positive number of metres.");
    }
    if (!nonEmpty(tier.artifactRef)) issue(issues, `${tierPath}.artifactRef`, "Tier artifact reference is required.");
    if (!checksum(tier.checksumSha256)) issue(issues, `${tierPath}.checksumSha256`, "Tier checksum must be lowercase SHA-256.");
  });
  if (unbounded !== 1) {
    issue(issues, `${path}.tiers`, `Every ground asset requires exactly one always-covering flat tier (maxDistanceMeters null); found ${unbounded}.`);
  }
}

export function validateGroundAssetTiers(value: unknown): GroundValidation<GroundAssetTiers> {
  const issues: GroundIssue[] = [];
  collectGroundAssetTierIssues(value, "$", issues);
  return issues.length === 0 ? { ok: true, value: value as GroundAssetTiers } : { ok: false, issues };
}

export interface GroundFeatureSet {
  features: GroundFeature[];
  parts: GroundFeaturePart[];
}

/**
 * The feature/part graph, validated closed.
 *
 * Non-overlap is structural rather than geometric: a part id is derived from
 * (feature, cell), so two parts of one feature inside one cell are the same id
 * and are rejected as a duplicate. That is the whole of "each part is owned by
 * exactly one cell" at the identity layer; geometric non-overlap of the clipped
 * polygons is the materializer's obligation, not this contract's claim.
 */
export function validateGroundFeatureSet(value: unknown, policy: GroundIdentityPolicy = DEFAULT_GROUND_IDENTITY_POLICY): GroundValidation<GroundFeatureSet> {
  const issues: GroundIssue[] = [];
  if (!record(value)) return { ok: false, issues: [{ path: "$", message: "Ground feature set must be an object." }] };
  exactKeys(value, ["features", "parts"], "$", issues);
  if (!Array.isArray(value.features)) issue(issues, "features", "Ground features must be an array.");
  if (!Array.isArray(value.parts)) issue(issues, "parts", "Ground feature parts must be an array.");
  if (issues.length > 0) return { ok: false, issues };

  const features = value.features as unknown[];
  const parts = value.parts as unknown[];
  features.forEach((feature, index) => collectGroundFeatureIssues(feature, `features[${index}]`, issues, policy));
  parts.forEach((part, index) => collectGroundFeaturePartIssues(part, `parts[${index}]`, issues));

  const featureIds = new Set<string>();
  features.forEach((feature, index) => {
    if (!record(feature) || !nonEmpty(feature.canonicalFeatureId)) return;
    if (featureIds.has(feature.canonicalFeatureId)) issue(issues, `features[${index}].canonicalFeatureId`, "Canonical feature ids must be unique; a duplicate is a second selectable identity.");
    featureIds.add(feature.canonicalFeatureId);
  });

  const partIds = new Set<string>();
  const partedFeatureIds = new Set<string>();
  parts.forEach((part, index) => {
    if (!record(part) || !nonEmpty(part.partId) || !nonEmpty(part.canonicalFeatureId)) return;
    if (partIds.has(part.partId)) issue(issues, `parts[${index}].partId`, "Part ids must be unique; a duplicate means one cell owns the same feature share twice.");
    partIds.add(part.partId);
    if (!featureIds.has(part.canonicalFeatureId)) issue(issues, `parts[${index}].canonicalFeatureId`, "Every part's parent feature must be present exactly once in the same set.");
    partedFeatureIds.add(part.canonicalFeatureId);
  });

  for (const featureId of sortGroundIds(featureIds)) {
    if (!partedFeatureIds.has(featureId)) issue(issues, `features.${featureId}`, "Every ground feature requires at least one owned part.");
  }

  return issues.length === 0 ? { ok: true, value: { features: features as GroundFeature[], parts: parts as GroundFeaturePart[] } } : { ok: false, issues };
}

const GROUND_IDENTITY_SET_DOMAIN = "udt:ground:identity-set:v1";

/**
 * Content fingerprint of a ground identity set.
 *
 * Only identity participates: ids, classes, claim levels, origins and part
 * ownership. Geometry, byte sizes and artifact refs deliberately do not, so the
 * same real-world identity set fingerprints equal across a re-materialization
 * that changes only the bytes on disk.
 */
export function groundIdentitySetChecksum(features: readonly GroundFeature[], parts: readonly GroundFeaturePart[]): string {
  return domainSeparatedSha256(GROUND_IDENTITY_SET_DOMAIN, {
    features: [...features]
      .map((feature) => ({
        canonicalFeatureId: feature.canonicalFeatureId,
        cityId: feature.cityId,
        class: feature.class,
        claimLevel: feature.claimLevel,
        identityOrigin: feature.identityOrigin,
      }))
      .sort((left, right) => compareGroundIds(left.canonicalFeatureId, right.canonicalFeatureId)),
    parts: [...parts]
      .map((part) => ({ partId: part.partId, canonicalFeatureId: part.canonicalFeatureId, ownerCellId: part.ownerCellId }))
      .sort((left, right) => compareGroundIds(left.partId, right.partId)),
  });
}
