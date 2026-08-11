/**
 * Deterministic assembly of the Block 835 public-audience canary exterior-cell
 * release `manhattan-exterior-cells-20260811`.
 *
 * The input is the private generated-exterior package
 * `manhattan-esb-block-reference-20260811` (manifest plus its 29 immutable
 * artifact blobs). Nothing here reads an external source, mutates the input
 * package, or promotes a truth tier above `generated`.
 *
 * Two invariants shape every decision below.
 *
 * Anti-leak: the private root declares exactly one artifact — its own
 * audience-scoped ownership-ledger blob — and that blob is never written into
 * the browser-reachable release root. Every byte that reaches disk lives under
 * `public/`. This follows the precedent set by
 * `src/runtime/exterior-cell-fixtures.ts`.
 *
 * Open-graph closure: every inventory shard and evidence shard is referenced by
 * exactly one `buildingDetails[status:"available"]` entry, and every declared
 * root artifact decodes to a graph node, so `validateExteriorReleaseGraph`
 * cannot be satisfied by an orphan.
 */

import type { V3StyleOverride } from "../domain/deterministic-facade-generator-v3.ts";
import { sha256HexBytes, sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";
import {
  EXTERIOR_COMPONENT_SCHEMA_VERSION,
  type ExteriorApprovalEvidence,
  type ExteriorComponentInventory,
  type ExteriorEvidenceGraph,
  type ExteriorLicenseEvidence,
  type ExteriorSourceEvidence,
} from "../domain/exterior-contract.ts";
import { getSourceRegistryEntry } from "../data/source-registry.ts";
import {
  EXTERIOR_CELL_RUNTIME_SCHEMA_VERSION,
  validateExteriorCellReleaseIndex,
  type ExteriorCellReleaseIndex,
} from "../runtime/exterior-cell-runtime.ts";
import {
  BLOCK835_CELL_ID,
  BLOCK835_CITY_ID,
  BLOCK835_CONFIG_ID,
  BLOCK835_SUCCESSOR_PACKAGE_ID,
  readPilotBuildings,
  type PilotBuildingSource,
} from "./block835-reference-package.ts";
import {
  buildSuccessorPlan,
  successorEvidenceShardId,
  successorInventoryId,
} from "./block835-successor-package.ts";
import { block835CitedStyleFor } from "./block835-facade-material-intake.ts";
import { buildV3Plan, v3EvidenceShardId, v3InventoryId } from "./block835-v3-package.ts";
import {
  EXTERIOR_RELEASE_SCHEMA_VERSION,
  validateExteriorReleaseGraph,
  type ExteriorArtifactKind,
  type ExteriorArtifactRef,
  type ExteriorBuildingDetail,
  type ExteriorCellRelease,
  type ExteriorEvidenceShard,
  type ExteriorInventoryShard,
  type ExteriorOwnershipLedger,
  type ExteriorReleaseAudience,
  type ExteriorReleaseGraph,
  type ExteriorRolloutSnapshot,
  type ExteriorRootManifest,
  type Wgs84Bounds,
} from "./exterior-release.ts";
import { validateMultiLodAssembly, type AssemblyCitedStyle, type MultiLodAssemblyManifest } from "./multi-lod-assembly.ts";

/**
 * Every logical id this emitter mints is a pure function of the release id, so a
 * successor release cannot silently reuse a predecessor's node identity. The V2
 * constants below are stated as literals as well and `block835-canary-release.test.ts`
 * pins them against this derivation, which is what keeps the frozen V2 bytes
 * provably unchanged by the parameterisation.
 */
export function block835CanaryReleaseIds(releaseId: string): {
  privateRootId: string;
  publicRootId: string;
  privateReleaseId: string;
  ownershipLedgerId: string;
  cellReleaseId: string;
  snapshotId: string;
  approvalId: string;
} {
  return {
    privateRootId: `root:${releaseId}:private`,
    publicRootId: `root:${releaseId}:public`,
    privateReleaseId: `${releaseId}-private`,
    ownershipLedgerId: `ownership-ledger:${releaseId}`,
    cellReleaseId: `cell-release:${releaseId}:v1`,
    snapshotId: `snapshot:${releaseId}:v1`,
    approvalId: `approval:${releaseId}:public-canary`,
  };
}

export const BLOCK835_CANARY_RELEASE_ID = "manhattan-exterior-cells-20260811" as const;
export const BLOCK835_CANARY_INPUT_PACKAGE_ID = BLOCK835_SUCCESSOR_PACKAGE_ID;
export const BLOCK835_CANARY_GENERATED_AT = "2026-08-11T00:00:00.000Z" as const;
/** The in-session user authorization that opened the public audience. */
export const BLOCK835_CANARY_APPROVED_AT = "2026-08-11T00:00:00.000Z" as const;
export const BLOCK835_CANARY_SOURCE_REGISTRY_ID = "nyc.building-footprints" as const;
export const BLOCK835_CANARY_PRIVATE_ROOT_ID = "root:manhattan-exterior-cells-20260811:private" as const;
export const BLOCK835_CANARY_PUBLIC_ROOT_ID = "root:manhattan-exterior-cells-20260811:public" as const;
export const BLOCK835_CANARY_PRIVATE_RELEASE_ID = "manhattan-exterior-cells-20260811-private" as const;
export const BLOCK835_CANARY_OWNERSHIP_LEDGER_ID = "ownership-ledger:manhattan-exterior-cells-20260811" as const;
export const BLOCK835_CANARY_BASE_IDENTITY_SET_ID = "base-identity-set:manhattan:block-835:20260811" as const;
export const BLOCK835_CANARY_CELL_RELEASE_ID = "cell-release:manhattan-exterior-cells-20260811:v1" as const;
export const BLOCK835_CANARY_CELL_RELEASE_VERSION = "v1" as const;
export const BLOCK835_CANARY_SNAPSHOT_ID = "snapshot:manhattan-exterior-cells-20260811:v1" as const;
export const BLOCK835_CANARY_APPROVAL_ID = "approval:manhattan-exterior-cells-20260811:public-canary" as const;
export const BLOCK835_CANARY_LICENSE_ID = "license:nyc.building-footprints" as const;
/** Repository-relative directory of the private input package, opened read-only. */
export const BLOCK835_CANARY_INPUT_PACKAGE_DIRECTORY = `public/data/${BLOCK835_SUCCESSOR_PACKAGE_ID}` as const;
/** Repository-relative path of the pinned pilot release this package derives from. */
export const BLOCK835_CANARY_PILOT_RELEASE_PATH = "public/data/manhattan-esb-block-exterior-pilot-20260805/release.json" as const;
/** Repository-relative directory this emitter owns and is allowed to replace. */
export const BLOCK835_CANARY_OUTPUT_DIRECTORY = `public/data/${BLOCK835_CANARY_RELEASE_ID}` as const;

/** The base releases the running app loads underneath this exterior release. */
export const BLOCK835_CANARY_BASE_RELEASE_IDS: readonly string[] = [
  "manhattan-citywide-20260804",
  "manhattan-civic-context-20260804",
];

export const BLOCK835_CANARY_APPROVAL_SCOPE =
  "Public-audience canary exterior-cell release manhattan-exterior-cells-20260811, promoting the private generated-exterior package manhattan-esb-block-reference-20260811 for Manhattan Block 835 (config manhattan-esb-block-835). It covers local-only delivery, public display, derivative conveyance, and redistribution of deterministically generated exterior geometry derived from NYC OTI Building Footprints (jh45-qr5r), with NYC OTI attribution, the City modified-data disclaimer, source IDs, capture timestamps, checksums, CRS, and height uncertainty retained." as const;

/**
 * Everything the approval deliberately does not authorize. Public *deployment*
 * stays excluded: the 2026-08-11 authorization broadened conveyance of the
 * generated geometry, not hosting of this release.
 */
export const BLOCK835_CANARY_APPROVAL_EXCLUSIONS: readonly string[] = [
  "public deployment",
  "redistribution of the raw jh45-qr5r source dataset",
  "runtime external network requests",
  "private-audience bytes in any browser-reachable root",
  "real-world facade, tenant, brand, signage, or survey-grade accuracy claims",
];

/**
 * The exact durable text hashed into the approval fingerprint. It is exported
 * so the fingerprint derivation stays reproducible from this file alone.
 */
export const BLOCK835_CANARY_APPROVAL_NOTE =
  "In-session user authorization dated 2026-08-11 broadened the NYC OTI Building Footprints (jh45-qr5r) envelope so exterior geometry generated from those footprints may additionally be publicly displayed, conveyed as a derivative, and redistributed, provided NYC OTI attribution, the City modified-data disclaimer, source IDs, capture timestamp, checksum, CRS, and height uncertainty travel with it. The broadened envelope covers that generated geometry only, never the raw jh45-qr5r source dataset, and public deployment remains excluded." as const;

/** `sha256HexSync(stableSerialize({ scope, exclusions, approvedAt, approvalNote }))`. */
export function block835CanaryApprovalFingerprint(): string {
  return sha256HexSync(stableSerialize({
    scope: BLOCK835_CANARY_APPROVAL_SCOPE,
    exclusions: [...BLOCK835_CANARY_APPROVAL_EXCLUSIONS],
    approvedAt: BLOCK835_CANARY_APPROVED_AT,
    approvalNote: BLOCK835_CANARY_APPROVAL_NOTE,
  }));
}

export const BLOCK835_CANARY_APPROVAL: ExteriorApprovalEvidence = {
  id: BLOCK835_CANARY_APPROVAL_ID,
  fingerprintSha256: block835CanaryApprovalFingerprint(),
  scope: BLOCK835_CANARY_APPROVAL_SCOPE,
  exclusions: [...BLOCK835_CANARY_APPROVAL_EXCLUSIONS],
  approvedAt: BLOCK835_CANARY_APPROVED_AT,
};

/**
 * Approval fingerprint for any release this emitter mints, derived from exactly
 * the four durable fields the V2 fingerprint is derived from. The V2 helper
 * above is kept as its own zero-argument function so its call sites and its test
 * pin stay literally unchanged.
 */
export function block835CanaryApprovalOf(input: {
  id: string;
  scope: string;
  exclusions: readonly string[];
  approvedAt: string;
  approvalNote: string;
}): ExteriorApprovalEvidence {
  return {
    id: input.id,
    fingerprintSha256: sha256HexSync(stableSerialize({
      scope: input.scope,
      exclusions: [...input.exclusions],
      approvedAt: input.approvedAt,
      approvalNote: input.approvalNote,
    })),
    scope: input.scope,
    exclusions: [...input.exclusions],
    approvedAt: input.approvedAt,
  };
}

/**
 * Everything that differs between the V2 canary release and a V3 successor.
 *
 * The V2 profile below reproduces the frozen `manhattan-exterior-cells-20260811`
 * bytes exactly — it is the default, and `buildBlock835CanaryRelease(input)`
 * keeps its original one-argument shape — so the parameterisation adds a second
 * reachable configuration without moving a single V2 byte.
 *
 * `admitTruthTiers` is a PROFILE decision rather than a shared rule because the
 * two packages make materially different honest statements. V2 asserts a single
 * `generated` tier for every asset. V3 cannot: on five of the fourteen real
 * footprints the tier offset is refused and the plan declares `setbacks` absent
 * with the refusal reason attached, so the V3 profile admits exactly that shape
 * — `["generated"]`, or `["absent","generated"]` where every absent component is
 * a setback — and still throws on anything else.
 */
export interface Block835CanaryReleaseProfile {
  readonly releaseId: string;
  readonly inputPackageId: string;
  /** Repository-relative directory of the private input package, opened read-only. */
  readonly inputPackageDirectory: string;
  /** Repository-relative directory this profile owns and may replace. */
  readonly outputDirectory: string;
  /** The input package's base identity set, which the emitted ledger reuses verbatim. */
  readonly baseIdentitySetId: string;
  readonly generatedAt: string;
  readonly approval: ExteriorApprovalEvidence;
  readonly ids: ReturnType<typeof block835CanaryReleaseIds>;
  readonly inventoryIdFor: (canonicalBuildingId: string) => string;
  readonly evidenceShardIdFor: (canonicalBuildingId: string) => string;
  /**
   * Rebuilds the shipped inventory from the pilot source so the emitter can
   * compare it against the input package's pinned `inventoryHashSha256` rather
   * than trusting the manifest's own claim about its bytes.
   */
  readonly rebuildInventory: (building: PilotBuildingSource) => ExteriorComponentInventory;
  /** Throws unless the asset's declared tiers are one of this profile's admitted shapes. */
  readonly admitTruthTiers: (
    truthTiers: readonly string[],
    inventory: ExteriorComponentInventory,
    canonicalBuildingId: string,
  ) => void;
  /**
   * Throws unless the asset's cited facade style is exactly the one this build
   * can RE-DERIVE from the rights-cleared intake admission.
   *
   * Every other trust-bearing field on this path is re-derived rather than
   * copied — the inventory is rebuilt and hash-compared, and truth tiers are
   * admitted against the rebuilt inventory — but `citedStyle` reached the public
   * assembly through a plain spread of the private manifest. A manifest-only
   * edit could therefore have attached a sourced-material citation to a building
   * no intake record covers, and nothing before the runtime would have noticed.
   * A citation is a rights and provenance claim, so it is re-derived here too.
   */
  readonly admitCitedStyle: (
    citedStyle: AssemblyCitedStyle | undefined,
    canonicalBuildingId: string,
  ) => void;
}

/**
 * A package with no cited lineage may carry no citation at all.
 *
 * The V2 grammar has no style-override mechanism, so any `citedStyle` on a V2
 * asset is by construction something the manifest asserted and nothing produced.
 */
export function admitNoCitedStyle(citedStyle: AssemblyCitedStyle | undefined, canonicalBuildingId: string): void {
  if (citedStyle !== undefined) {
    fail(`asset ${canonicalBuildingId} declares a cited facade style, which this release's grammar cannot produce and this build cannot re-derive.`);
  }
}

/**
 * Re-derives the citation from the admission and refuses any disagreement.
 *
 * `block835CitedStyleFor` resolves through `block835FacadeMaterialAdmission`, so
 * it returns a citation only for a building whose intake record was actually
 * admitted and is actually conveyable in public, and throws otherwise. Comparing
 * its result against the manifest's own claim closes both directions: an
 * invented citation and a dropped one.
 */
export function admitV3CitedStyle(citedStyle: AssemblyCitedStyle | undefined, canonicalBuildingId: string): void {
  const derived = block835CitedStyleFor(canonicalBuildingId);
  if (stableSerialize(citedStyle ?? null) !== stableSerialize(derived ?? null)) {
    fail(
      `asset ${canonicalBuildingId} declares a cited facade style this build cannot re-derive from the rights-cleared intake admission. `
      + "A public asset may only carry a citation the admission produces, so the input manifest's claim is refused rather than copied.",
    );
  }
}

export const BLOCK835_CANARY_V2_PROFILE: Block835CanaryReleaseProfile = {
  releaseId: BLOCK835_CANARY_RELEASE_ID,
  inputPackageId: BLOCK835_CANARY_INPUT_PACKAGE_ID,
  inputPackageDirectory: BLOCK835_CANARY_INPUT_PACKAGE_DIRECTORY,
  outputDirectory: BLOCK835_CANARY_OUTPUT_DIRECTORY,
  baseIdentitySetId: BLOCK835_CANARY_BASE_IDENTITY_SET_ID,
  generatedAt: BLOCK835_CANARY_GENERATED_AT,
  approval: BLOCK835_CANARY_APPROVAL,
  ids: block835CanaryReleaseIds(BLOCK835_CANARY_RELEASE_ID),
  inventoryIdFor: successorInventoryId,
  evidenceShardIdFor: successorEvidenceShardId,
  rebuildInventory: (building) => buildSuccessorPlan(building).plan.inventory,
  admitTruthTiers: (truthTiers, _inventory, canonicalBuildingId) => {
    if (truthTiers.length !== 1 || truthTiers[0] !== "generated") fail(`asset ${canonicalBuildingId} is not entirely generated.`);
  },
  admitCitedStyle: admitNoCitedStyle,
};

/**
 * The exact truth-tier shapes a V3 package may declare.
 *
 * `["generated"]` is the ordinary case. `["absent","generated"]` is admitted for
 * one reason only: on five of the fourteen real Block 835 footprints the V3
 * grammar REFUSES the tier offset rather than inventing one, and the plan then
 * declares `setbacks` absent with the refusal reason attached. Admitting that is
 * admitting an honest statement, so the check is written against the rebuilt
 * inventory: every absent component must be a `setbacks` component, and any
 * other absent kind — or any tier outside these two shapes — still throws.
 */
export function admitV3TruthTiers(
  truthTiers: readonly string[],
  inventory: ExteriorComponentInventory,
  canonicalBuildingId: string,
): void {
  const shape = [...truthTiers].sort(compareText).join(",");
  if (shape !== "generated" && shape !== "absent,generated") {
    fail(`asset ${canonicalBuildingId} declares truth tiers [${truthTiers.join(", ")}], which this V3 release does not admit.`);
  }
  const absentKinds = [...new Set(inventory.components.filter((component) => component.state === "absent").map((component) => component.kind))].sort(compareText);
  if (absentKinds.some((kind) => kind !== "setbacks")) {
    fail(`asset ${canonicalBuildingId} declares absent components [${absentKinds.join(", ")}]; only a refused setback tier is admitted.`);
  }
  if (shape === "absent,generated" && absentKinds.length === 0) {
    fail(`asset ${canonicalBuildingId} declares an absent truth tier its rebuilt inventory does not justify.`);
  }
  if (shape === "generated" && absentKinds.length > 0) {
    fail(`asset ${canonicalBuildingId} hides absent components [${absentKinds.join(", ")}] behind a wholly generated truth tier.`);
  }
}

/**
 * A V3-input profile for this emitter.
 *
 * It is a factory rather than a constant because the same shape has to serve
 * both the committed untextured V3 package and its evidence-cited successor,
 * and a constant would have forced one of them to be expressed as an edit of the
 * other.
 */
export function block835CanaryV3Profile(options: {
  releaseId: string;
  inputPackageId: string;
  baseIdentitySetId: string;
  generatedAt: string;
  approval: ExteriorApprovalEvidence;
  /** Applied when rebuilding a plan inventory, so an overridden asset's pinned hash still verifies. */
  styleOverrides?: ReadonlyMap<string, V3StyleOverride>;
}): Block835CanaryReleaseProfile {
  const styleOverrides = options.styleOverrides ?? new Map<string, V3StyleOverride>();
  return {
    releaseId: options.releaseId,
    inputPackageId: options.inputPackageId,
    inputPackageDirectory: `public/data/${options.inputPackageId}`,
    outputDirectory: `public/data/${options.releaseId}`,
    baseIdentitySetId: options.baseIdentitySetId,
    generatedAt: options.generatedAt,
    approval: options.approval,
    ids: block835CanaryReleaseIds(options.releaseId),
    inventoryIdFor: (canonicalBuildingId) => v3InventoryId(canonicalBuildingId, options.inputPackageId),
    evidenceShardIdFor: (canonicalBuildingId) => v3EvidenceShardId(canonicalBuildingId, options.inputPackageId),
    rebuildInventory: (building) => buildV3Plan(building, styleOverrides.get(building.canonicalBuildingId)).plan.inventory,
    admitTruthTiers: admitV3TruthTiers,
    admitCitedStyle: admitV3CitedStyle,
  };
}

export interface Block835CanaryInput {
  /** Parsed `manifest.json` of the private input package. */
  manifest: unknown;
  /** Input-package artifact bytes keyed by the manifest's `private/...` refs. */
  packageBytes: ReadonlyMap<string, Uint8Array>;
  /** Parsed pinned pilot release, the sole source of footprints and capture dates. */
  pilotRelease: unknown;
}

export interface Block835CanaryRelease {
  index: ExteriorCellReleaseIndex;
  graph: ExteriorReleaseGraph;
  assemblies: MultiLodAssemblyManifest[];
  /**
   * Every declared root artifact blob, including the private ownership-ledger
   * blob that is deliberately never emitted to disk.
   */
  rootArtifactBytes: Map<string, Uint8Array>;
  /** Exact byte map of the emitted release directory, keyed by relative path. */
  files: Map<string, Uint8Array>;
}

const encoder = new TextEncoder();
function encode(value: string): Uint8Array { return encoder.encode(value); }
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function slug(value: string): string { return value.replaceAll(":", "-"); }
function fail(message: string): never { throw new Error(`Block 835 canary release: ${message}`); }

/** Canonical millisecond UTC form; the exterior contract accepts nothing else. */
function canonicalTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${label} must be an explicit timestamp.`);
  const milliseconds = Date.parse(value);
  if (Number.isNaN(milliseconds)) fail(`${label} is not a parseable UTC timestamp: ${value}`);
  return new Date(milliseconds).toISOString();
}

function requireNotAfter(value: string, limit: string, label: string): string {
  if (Date.parse(value) > Date.parse(limit)) fail(`${label} (${value}) is later than the promotion timestamp ${limit}.`);
  return value;
}

interface ArtifactBlob { ref: ExteriorArtifactRef; bytes: Uint8Array }

/**
 * Audience-scoped artifact envelope. The audience is part of the hashed body,
 * so the private and public ownership-ledger blobs share one `ledgerId` yet can
 * never collide on bytes or checksum — the exact technique the exterior fixture
 * uses to satisfy the graph's global checksum-uniqueness rule.
 */
function artifactBlob(
  audience: ExteriorReleaseAudience,
  kind: ExteriorArtifactKind,
  logicalId: string,
  payload: unknown,
): ArtifactBlob {
  const relativeRef = `${audience}/${kind}/${slug(logicalId)}.json`;
  const bytes = encode(`${stableSerialize({ schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION, audience, kind, logicalId, payload })}\n`);
  return { ref: { logicalId, kind, relativeRef, byteSize: bytes.byteLength, checksumSha256: sha256HexBytes(bytes) }, bytes };
}

function artifactRefFor(audience: ExteriorReleaseAudience, kind: ExteriorArtifactKind, logicalId: string): string {
  return `${audience}/${kind}/${slug(logicalId)}.json`;
}

/** Immutable root checksum over the root's own identity and artifact declarations. */
function rootChecksum(root: Omit<ExteriorRootManifest, "rootChecksumSha256">): string {
  return sha256HexSync(stableSerialize({ ...root, rootChecksumSha256: "" }));
}

function reroot(ref: string): string {
  if (!ref.startsWith("private/")) fail(`input package artifact ref is not private-rooted: ${ref}`);
  const rerooted = `public/${ref.slice("private/".length)}`;
  // `audiencePath()` in multi-lod-assembly.ts rejects any public ref that still
  // names a private partition, case-insensitively.
  if (rerooted.toLowerCase().includes("private")) fail(`re-rooted public ref still names a private partition: ${ref}`);
  return rerooted;
}

function footprintBounds(buildings: readonly PilotBuildingSource[]): Wgs84Bounds {
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (const building of buildings) for (const [longitude, latitude] of building.footprint) {
    west = Math.min(west, longitude); east = Math.max(east, longitude);
    south = Math.min(south, latitude); north = Math.max(north, latitude);
  }
  if (!Number.isFinite(west) || !Number.isFinite(south) || !Number.isFinite(east) || !Number.isFinite(north) || west >= east || south >= north) {
    fail("pilot footprints do not form an ordered WGS84 envelope.");
  }
  return { west, south, east, north };
}

interface SourceRights { license: ExteriorLicenseEvidence; source: (building: PilotBuildingSource, capturedAt: string) => ExteriorSourceEvidence }

/**
 * License and per-building source evidence, read from the approved
 * `nyc.building-footprints` registry entry rather than restated here.
 *
 * Chronology (every value is real and every value is at or before the
 * 2026-08-11 promotion):
 *   - `capturedAt`/`observedAt` = the pilot release's per-asset
 *     `capture.capturedAt` (2026-08-04T08:25:05.580Z), the citywide footprint
 *     snapshot this block was cut from;
 *   - `sourceDate`/`updatedAt` = the registry's `updateTimestamp`
 *     (2026-07-18), the dataset's published update. The pilot records
 *     `capture.updatedAt: null`, and the contract requires a real timestamp, so
 *     the dataset's own published update date is used instead of inventing one.
 */
function sourceRights(approval: ExteriorApprovalEvidence): SourceRights {
  const entry = getSourceRegistryEntry(BLOCK835_CANARY_SOURCE_REGISTRY_ID);
  if (!entry) fail(`source registry entry ${BLOCK835_CANARY_SOURCE_REGISTRY_ID} is absent.`);
  if (entry.datasetId !== "jh45-qr5r") fail(`source registry entry ${entry.id} no longer names dataset jh45-qr5r.`);
  if (entry.approval.state !== "approved") fail(`source registry entry ${entry.id} is not approved.`);
  if (entry.retention.maximumDays !== null) fail(`source registry entry ${entry.id} declares a retention expiry this release cannot carry.`);
  const datasetDate = requireNotAfter(canonicalTimestamp(entry.updateTimestamp, "registry updateTimestamp"), approval.approvedAt, "registry updateTimestamp");

  const license: ExteriorLicenseEvidence = {
    id: BLOCK835_CANARY_LICENSE_ID,
    termsUrl: entry.termsUrl,
    attribution: entry.attribution,
    retention: { mode: "conditional", expiresAt: null, conditions: entry.retention.constraints },
    allowedUse: {
      privateDerivative: true,
      publicDisplay: true,
      derivativeConveyance: true,
      redistribution: true,
      runtimeTexture: false,
      trainingInput: false,
      generationInput: true,
      validationOnly: false,
    },
    personalDataRestricted: false,
  };

  return {
    license,
    source: (building, capturedAt) => ({
      id: `source-ref:${entry.datasetId}:${building.doittId}`,
      provider: entry.provider,
      datasetId: entry.datasetId,
      sourceRecordId: building.doittId,
      sourceUrl: entry.canonicalUrl,
      sourceDate: datasetDate,
      observedAt: capturedAt,
      capturedAt,
      updatedAt: datasetDate,
      attribution: entry.attribution,
      licenseId: license.id,
      approvalId: approval.id,
    }),
  };
}

export function buildBlock835CanaryRelease(
  input: Block835CanaryInput,
  profile: Block835CanaryReleaseProfile = BLOCK835_CANARY_V2_PROFILE,
): Block835CanaryRelease {
  const manifestResult = validateMultiLodAssembly(input.manifest);
  if (!manifestResult.ok) fail(`input package manifest is invalid: ${stableSerialize(manifestResult.issues)}`);
  const inputManifest = manifestResult.value;
  if (inputManifest.packageId !== profile.inputPackageId) fail(`input package is ${inputManifest.packageId}, not ${profile.inputPackageId}.`);
  if (inputManifest.audience !== "private") fail("input package must be the private generated-exterior package.");
  if (inputManifest.cells.length !== 1) fail("input package must declare exactly one ownership cell.");
  const inputCell = inputManifest.cells[0]!;
  if (inputCell.cellId !== BLOCK835_CELL_ID) fail(`input package cell is ${inputCell.cellId}, not ${BLOCK835_CELL_ID}.`);
  if (inputManifest.release.cityId !== BLOCK835_CITY_ID || inputManifest.release.configId !== BLOCK835_CONFIG_ID) fail("input package city/config identity drifted.");
  if (inputManifest.baseIdentitySet.id !== profile.baseIdentitySetId) fail(`input package base identity set is ${inputManifest.baseIdentitySet.id}.`);

  const buildings = readPilotBuildings(input.pilotRelease);
  const buildingIds = [...inputCell.buildingIds].sort(compareText);
  if (stableSerialize(buildings.map((building) => building.canonicalBuildingId).sort(compareText)) !== stableSerialize(buildingIds)) {
    fail("pilot membership and input package cell membership differ.");
  }
  const baseIdentityChecksum = sha256HexSync(stableSerialize([...buildingIds].sort(compareText)));
  if (baseIdentityChecksum !== inputManifest.baseIdentitySet.checksumSha256) fail("input package base identity checksum does not match canonical ownership membership.");
  if (baseIdentityChecksum !== inputCell.membershipChecksumSha256) fail("input package cell membership checksum does not match canonical ownership membership.");

  const bounds = footprintBounds(buildings);
  const rights = sourceRights(profile.approval);
  const assetById = new Map(inputManifest.assets.map((asset) => [asset.canonicalFeatureId, asset]));

  const ledger: ExteriorOwnershipLedger = {
    schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
    ledgerId: profile.ids.ownershipLedgerId,
    cityId: BLOCK835_CITY_ID,
    configId: BLOCK835_CONFIG_ID,
    immutable: true,
    baseIdentitySet: { id: profile.baseIdentitySetId, checksumSha256: baseIdentityChecksum, buildingCount: buildingIds.length },
    // One cell covers the whole block, so release coverage is exactly the cell.
    coverage: { ...bounds },
    cells: [{ cellId: BLOCK835_CELL_ID, order: 0, bounds: { ...bounds }, buildingIds: [...buildingIds], membershipChecksumSha256: baseIdentityChecksum }],
  };

  const inventoryShards: ExteriorInventoryShard[] = [];
  const evidenceShards: ExteriorEvidenceShard[] = [];
  const buildingDetails: ExteriorBuildingDetail[] = [];

  for (const building of buildings) {
    const asset = assetById.get(building.canonicalBuildingId);
    if (!asset) fail(`input package has no packaged asset for ${building.canonicalBuildingId}.`);
    const inventoryId = profile.inventoryIdFor(building.canonicalBuildingId);
    const evidenceShardId = profile.evidenceShardIdFor(building.canonicalBuildingId);
    if (asset.inventoryId !== inventoryId || asset.evidenceShardId !== evidenceShardId) fail(`input package inventory/evidence identity drifted for ${building.canonicalBuildingId}.`);

    // The shipped inventory is the package's own plan inventory; the hash check
    // binds these bytes to the immutable manifest pin rather than re-asserting a
    // component vocabulary here.
    const inventory: ExteriorComponentInventory = profile.rebuildInventory(building);
    if (sha256HexSync(stableSerialize(inventory)) !== asset.inventoryHashSha256) fail(`rebuilt inventory for ${building.canonicalBuildingId} does not match the package's pinned inventory hash.`);
    // Read against the REBUILT inventory rather than the manifest's own claim,
    // so an admitted `absent` tier is admitted only when the rebuilt components
    // actually justify it.
    profile.admitTruthTiers(asset.truthTiers, inventory, building.canonicalBuildingId);
    // Re-derived, never copied: see `admitCitedStyle` on the profile.
    profile.admitCitedStyle(asset.citedStyle, building.canonicalBuildingId);

    const capturedAt = requireNotAfter(
      canonicalTimestamp(asset.sourceDates.capturedAt ?? building.capturedAt, `capture timestamp for ${building.canonicalBuildingId}`),
      profile.approval.approvedAt,
      `capture timestamp for ${building.canonicalBuildingId}`,
    );
    const source = rights.source(building, capturedAt);
    const constraintIds = [...new Set(inventory.components.flatMap((component) => component.state === "generated" ? component.generator.constraintSourceIds : []))];
    if (constraintIds.length !== 1 || constraintIds[0] !== source.id) fail(`inventory for ${building.canonicalBuildingId} does not constrain exactly the ${source.id} source.`);

    const graph: ExteriorEvidenceGraph = {
      schemaVersion: EXTERIOR_COMPONENT_SCHEMA_VERSION,
      sources: [source],
      licenses: [{ ...rights.license, allowedUse: { ...rights.license.allowedUse }, retention: { ...rights.license.retention } }],
      approvals: [{ ...profile.approval, exclusions: [...profile.approval.exclusions] }],
      evidence: [],
    };

    inventoryShards.push({
      schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
      shardId: inventoryId,
      audience: "public",
      artifactRef: artifactRefFor("public", "inventory", inventoryId),
      inventoryId,
      inventory,
    });
    evidenceShards.push({
      schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
      shardId: evidenceShardId,
      audience: "public",
      artifactRef: artifactRefFor("public", "evidence", evidenceShardId),
      inventoryId,
      graph,
    });
    buildingDetails.push({ buildingId: building.canonicalBuildingId, status: "available", inventoryId, evidenceShardId, runtimeTexture: false });
  }

  const cellRelease: ExteriorCellRelease = {
    schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
    cellReleaseId: profile.ids.cellReleaseId,
    version: BLOCK835_CANARY_CELL_RELEASE_VERSION,
    audience: "public",
    artifactRef: artifactRefFor("public", "cell-release", profile.ids.cellReleaseId),
    cityId: BLOCK835_CITY_ID,
    configId: BLOCK835_CONFIG_ID,
    cellId: BLOCK835_CELL_ID,
    bounds: { ...bounds },
    ownershipLedgerId: ledger.ledgerId,
    baseIdentitySetId: ledger.baseIdentitySet.id,
    baseIdentitySetChecksumSha256: baseIdentityChecksum,
    buildingIds: [...buildingIds],
    predecessor: null,
    promotion: { ...profile.approval, exclusions: [...profile.approval.exclusions] },
    // No public predecessor exists for this cell, so the only honest fallback
    // is the pinned base identity set, never a package named by convention.
    fallback: { mode: "pinned-base", baseIdentitySetId: ledger.baseIdentitySet.id, checksumSha256: baseIdentityChecksum },
    buildingDetails,
    immutable: true,
  };

  const ledgerBlobs = {
    private: artifactBlob("private", "ownership-ledger", ledger.ledgerId, ledger),
    public: artifactBlob("public", "ownership-ledger", ledger.ledgerId, ledger),
  };
  const inventoryBlobs = inventoryShards.map((shard) => artifactBlob("public", "inventory", shard.inventoryId, shard));
  const evidenceBlobs = evidenceShards.map((shard) => artifactBlob("public", "evidence", shard.shardId, shard));
  const cellReleaseBlob = artifactBlob("public", "cell-release", cellRelease.cellReleaseId, cellRelease);

  const snapshot: ExteriorRolloutSnapshot = {
    schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
    snapshotId: profile.ids.snapshotId,
    audience: "public",
    artifactRef: artifactRefFor("public", "rollout-snapshot", profile.ids.snapshotId),
    cityId: BLOCK835_CITY_ID,
    configId: BLOCK835_CONFIG_ID,
    ownershipLedgerId: ledger.ledgerId,
    baseIdentitySetId: ledger.baseIdentitySet.id,
    baseIdentitySetChecksumSha256: baseIdentityChecksum,
    predecessor: null,
    rollbackTarget: null,
    cells: [{ cellId: BLOCK835_CELL_ID, cellReleaseId: cellRelease.cellReleaseId, checksumSha256: cellReleaseBlob.ref.checksumSha256 }],
    promotion: { ...profile.approval, exclusions: [...profile.approval.exclusions] },
    generatedAt: profile.generatedAt,
    immutable: true,
  };
  const snapshotBlob = artifactBlob("public", "rollout-snapshot", snapshot.snapshotId, snapshot);

  const privateArtifacts = [ledgerBlobs.private.ref];
  const publicBlobs = [ledgerBlobs.public, cellReleaseBlob, ...inventoryBlobs, ...evidenceBlobs, snapshotBlob];
  const publicArtifacts = publicBlobs.map((blob) => blob.ref);

  const privateRootDraft = {
    schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
    audience: "private" as const,
    rootId: profile.ids.privateRootId,
    releaseId: profile.ids.privateReleaseId,
    cityId: BLOCK835_CITY_ID,
    configId: BLOCK835_CONFIG_ID,
    generatedAt: profile.generatedAt,
    immutable: true as const,
    artifactAllowlist: privateArtifacts.map((artifact) => artifact.relativeRef),
    artifacts: privateArtifacts,
    approval: { ...profile.approval, exclusions: [...profile.approval.exclusions] },
    predecessor: null,
    privatePredecessor: null,
  };
  const privateRoot: ExteriorRootManifest = { ...privateRootDraft, rootChecksumSha256: rootChecksum(privateRootDraft) };

  const publicRootDraft = {
    schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
    audience: "public" as const,
    rootId: profile.ids.publicRootId,
    releaseId: profile.releaseId,
    cityId: BLOCK835_CITY_ID,
    configId: BLOCK835_CONFIG_ID,
    generatedAt: profile.generatedAt,
    immutable: true as const,
    artifactAllowlist: publicArtifacts.map((artifact) => artifact.relativeRef),
    artifacts: publicArtifacts,
    approval: { ...profile.approval, exclusions: [...profile.approval.exclusions] },
    predecessor: null,
    // Path-free citation of private ancestry; the private bytes never ship.
    privatePredecessor: { rootId: privateRoot.rootId, rootChecksumSha256: privateRoot.rootChecksumSha256 },
  };
  const publicRoot: ExteriorRootManifest = { ...publicRootDraft, rootChecksumSha256: rootChecksum(publicRootDraft) };

  const graph: ExteriorReleaseGraph = {
    schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
    roots: [privateRoot, publicRoot],
    ownershipLedger: ledger,
    cellReleases: [cellRelease],
    inventoryShards,
    evidenceShards,
    snapshots: [snapshot],
  };

  const graphResult = validateExteriorReleaseGraph(graph);
  if (!graphResult.ok) fail(`emitted release graph is invalid: ${stableSerialize(graphResult.issues)}`);

  // ---------------------------------------------------------------------
  // Public assembly package: byte-identical content, re-rooted and re-pinned.
  // ---------------------------------------------------------------------
  const assemblyBytes = new Map<string, Uint8Array>();
  const artifacts = inputManifest.artifacts.map((artifact) => {
    const bytes = input.packageBytes.get(artifact.relativeRef);
    if (!bytes) fail(`input package artifact bytes are missing for ${artifact.relativeRef}.`);
    if (bytes.byteLength !== artifact.byteSize) fail(`input package artifact ${artifact.relativeRef} byte size drifted.`);
    const checksumSha256 = sha256HexBytes(bytes);
    if (checksumSha256 !== artifact.checksumSha256) fail(`input package artifact ${artifact.relativeRef} checksum drifted.`);
    const relativeRef = reroot(artifact.relativeRef);
    assemblyBytes.set(relativeRef, bytes);
    return { ...artifact, relativeRef, byteSize: bytes.byteLength, checksumSha256 };
  });

  const assembly: MultiLodAssemblyManifest = {
    ...inputManifest,
    audience: "public",
    release: {
      rootId: publicRoot.rootId,
      rootChecksumSha256: publicRoot.rootChecksumSha256,
      releaseId: publicRoot.releaseId,
      cityId: BLOCK835_CITY_ID,
      configId: BLOCK835_CONFIG_ID,
      privatePredecessor: { id: privateRoot.rootId, checksumSha256: privateRoot.rootChecksumSha256 },
    },
    baseIdentitySet: { id: ledger.baseIdentitySet.id, checksumSha256: ledger.baseIdentitySet.checksumSha256 },
    ownershipLedger: { id: ledger.ledgerId, checksumSha256: ledgerBlobs.public.ref.checksumSha256 },
    // The runtime binds an assembly to a cell by matching `cellRelease` against
    // the graph's cell-release node and the public root's declared artifact
    // checksum. Carrying over the private package's own pin here is what caused
    // `assembly-pin-mismatch` and silently fell back to pinned-base with no
    // geometry, so it is rewritten to this graph's cell release exactly as the
    // `release.*` fields above are.
    cells: inputManifest.cells.map((cell) => ({
      ...cell,
      cellRelease: { id: cellRelease.cellReleaseId, checksumSha256: cellReleaseBlob.ref.checksumSha256 },
      buildingIds: [...cell.buildingIds],
    })),
    assets: inputManifest.assets.map((asset) => ({
      ...asset,
      truthTiers: [...asset.truthTiers],
      sourceDates: { ...asset.sourceDates },
      lods: asset.lods.map((lod) => ({
        ...lod,
        artifactRef: reroot(lod.artifactRef),
        quality: { ...lod.quality, budgets: { ...lod.quality.budgets } },
        silhouette: lod.silhouette === null ? null : { ...lod.silhouette, viewIds: [...lod.silhouette.viewIds] },
      })),
    })),
    artifacts,
    tilesetRef: reroot(inputManifest.tilesetRef),
    declaredTotalBytes: artifacts.reduce((total, artifact) => total + artifact.byteSize, 0),
  };
  const assemblyResult = validateMultiLodAssembly(assembly);
  if (!assemblyResult.ok) fail(`emitted public assembly is invalid: ${stableSerialize(assemblyResult.issues)}`);

  const index: ExteriorCellReleaseIndex = {
    schemaVersion: EXTERIOR_CELL_RUNTIME_SCHEMA_VERSION,
    releaseId: profile.releaseId,
    audience: "public",
    cityId: BLOCK835_CITY_ID,
    configId: BLOCK835_CONFIG_ID,
    defaultHead: { snapshotId: snapshot.snapshotId, checksumSha256: snapshotBlob.ref.checksumSha256, assemblyPackageIds: [assembly.packageId] },
    canaryHeads: [],
    baseCompatibility: { baseReleaseIds: [...BLOCK835_CANARY_BASE_RELEASE_IDS] },
    localOnly: true,
    runtimeExternalNetwork: false,
  };
  const indexResult = validateExteriorCellReleaseIndex(index);
  if (!indexResult.ok) fail(`emitted runtime index is invalid: ${stableSerialize(indexResult.issues)}`);

  const rootArtifactBytes = new Map<string, Uint8Array>([
    [ledgerBlobs.private.ref.relativeRef, ledgerBlobs.private.bytes],
    ...publicBlobs.map((blob) => [blob.ref.relativeRef, blob.bytes] as const),
  ]);

  const files = new Map<string, Uint8Array>([
    ["index.json", encode(`${JSON.stringify(index, null, 2)}\n`)],
    ["release-graph.json", encode(`${JSON.stringify(graph, null, 2)}\n`)],
    ["assemblies.json", encode(`${JSON.stringify([assembly], null, 2)}\n`)],
  ]);
  // Private-audience bytes are never written into a browser-reachable root.
  for (const [relativeRef, bytes] of [...publicBlobs.map((blob) => [blob.ref.relativeRef, blob.bytes] as const), ...assemblyBytes].sort(([left], [right]) => compareText(left, right))) {
    if (!relativeRef.startsWith("public/")) fail(`refusing to emit a non-public artifact path: ${relativeRef}`);
    files.set(relativeRef, bytes);
  }

  return { index, graph, assemblies: [assembly], rootArtifactBytes, files };
}
