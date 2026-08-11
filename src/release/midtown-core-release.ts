/**
 * Deterministic assembly of the midtown-core exterior-cell canary release
 * `manhattan-midtown-core-cells-20260811`.
 *
 * Input is the derived-subset ownership ledger of wave `w01`
 * (`midtown-core-package.ts`) plus the offline materialization of that wave
 * (`midtown-core-materialization.ts`). Nothing here reads an external source,
 * mutates a pinned release, or promotes a truth tier above `generated`.
 *
 * Three properties shape every decision below.
 *
 * Bounded availability. The release owns all 149 `w01` cells and all 7,201 of
 * their buildings, but materializes exterior geometry for only the first cells
 * in priority order. Every other owned building ships as an explicit
 * `unavailable` detail with a stated reason, so the release still enumerates a
 * complete, closed cell map. A cell whose every detail is `unavailable` is
 * resolved by the runtime as `not-shipped` — a bounded-availability outcome,
 * never a verification failure (see `exterior-cell-runtime.ts`).
 *
 * Anti-leak. The private root declares exactly one artifact — its own
 * audience-scoped ownership-ledger blob — and that blob is never written to
 * disk. Every emitted byte lives under `public/`.
 *
 * Single shipped LOD. `validateMultiLodAssembly` requires every LOD after the
 * finest to carry an authoring-declared projected-silhouette measurement bound
 * to the asset's plan hash. Those measurements exist only for the fourteen
 * Block 835 buildings, and declaring one for 160 buildings without measuring
 * would fabricate evidence, so this canary ships the finest LOD only, with an
 * unbounded `maxDistanceMeters` so no camera distance can leave a cell without
 * an eligible representation. The materialization census still generates and
 * validates both LODs; only the coarse LOD's *shipping* is deferred.
 */

import { sha256HexBytes, sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";
import {
  EXTERIOR_COMPONENT_SCHEMA_VERSION,
  isExteriorComponentReleaseEligible,
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
  EXTERIOR_RELEASE_SCHEMA_VERSION,
  validateExteriorReleaseGraph,
  type ExteriorArtifactKind,
  type ExteriorArtifactRef,
  type ExteriorBuildingDetail,
  type ExteriorCellRelease,
  type ExteriorEvidenceShard,
  type ExteriorInventoryShard,
  type ExteriorReleaseAudience,
  type ExteriorReleaseGraph,
  type ExteriorRolloutSnapshot,
  type ExteriorRootManifest,
} from "./exterior-release.ts";
import {
  validateMultiLodAssembly,
  type AssemblyArtifact,
  type AssemblyAsset,
  type AssemblyLod,
  type ImmutablePin,
  type MultiLodAssemblyManifest,
} from "./multi-lod-assembly.ts";
import { BLOCK835_QUALITY_BUDGETS, enuFrame, toEnuMeters } from "./block835-reference-package.ts";
import { membershipChecksum } from "./exterior-wave-ledger.ts";
import { MIDTOWN_CORE_RELEASE_ID, type MidtownCoreSubset } from "./midtown-core-package.ts";
import {
  MIDTOWN_CORE_GENERATED_AT,
  midtownCoreEvidenceShardId,
  midtownCoreInventoryId,
} from "./midtown-core-materialization.ts";

// ---------------------------------------------------------------------------
// Declared identity
// ---------------------------------------------------------------------------

/** The in-session user authorization this release is conveyed under. */
export const MIDTOWN_CORE_APPROVED_AT = "2026-08-11T00:00:00.000Z" as const;
export const MIDTOWN_CORE_SOURCE_REGISTRY_ID = "nyc.building-footprints" as const;
export const MIDTOWN_CORE_PRIVATE_ROOT_ID = `root:${MIDTOWN_CORE_RELEASE_ID}:private` as const;
export const MIDTOWN_CORE_PUBLIC_ROOT_ID = `root:${MIDTOWN_CORE_RELEASE_ID}:public` as const;
export const MIDTOWN_CORE_PRIVATE_RELEASE_ID = `${MIDTOWN_CORE_RELEASE_ID}-private` as const;
export const MIDTOWN_CORE_SNAPSHOT_ID = `snapshot:${MIDTOWN_CORE_RELEASE_ID}:v1` as const;
export const MIDTOWN_CORE_APPROVAL_ID = `approval:${MIDTOWN_CORE_RELEASE_ID}:midtown-core-canary` as const;
export const MIDTOWN_CORE_LICENSE_ID = `license:${MIDTOWN_CORE_SOURCE_REGISTRY_ID}` as const;
export const MIDTOWN_CORE_ASSEMBLY_PACKAGE_ID = `assembly:${MIDTOWN_CORE_RELEASE_ID}:v1` as const;
export const MIDTOWN_CORE_CELL_RELEASE_VERSION = "v1" as const;
/** Repository-relative directory this emitter owns and is allowed to replace. */
export const MIDTOWN_CORE_OUTPUT_DIRECTORY = `public/data/${MIDTOWN_CORE_RELEASE_ID}` as const;
/** The only LOD this canary ships; see the module header. */
export const MIDTOWN_CORE_SHIPPED_LOD_ID = "lod_0" as const;
export const MIDTOWN_CORE_TILESET_REF = "public/tiles/tileset.json" as const;

/** The base releases the running app loads underneath this exterior release. */
export const MIDTOWN_CORE_BASE_RELEASE_IDS: readonly string[] = [
  "manhattan-citywide-20260804",
  "manhattan-civic-context-20260804",
];

export const MIDTOWN_CORE_APPROVAL_SCOPE =
  "Midtown-core exterior-cell canary release manhattan-midtown-core-cells-20260811: wave w01 of the provider-neutral Manhattan exterior configuration, owning 149 ownership cells and 7,201 canonical buildings of the pinned manhattan-citywide-20260804 base. It covers local-only delivery, public display, derivative conveyance, and redistribution of deterministically generated exterior geometry derived from NYC OTI Building Footprints (jh45-qr5r), with NYC OTI attribution, the City modified-data disclaimer, source IDs, capture timestamps, checksums, CRS, and height uncertainty retained. Exterior geometry is materialized for a bounded subset of the owned cells; every other owned building ships as an explicit unavailable detail with a stated reason." as const;

/**
 * Everything the approval deliberately does not authorize. Public *deployment*
 * stays excluded: the 2026-08-11 authorization broadened conveyance of the
 * generated geometry, not hosting of this release.
 */
export const MIDTOWN_CORE_APPROVAL_EXCLUSIONS: readonly string[] = [
  "public deployment",
  "redistribution of the raw jh45-qr5r source dataset",
  "runtime external network requests",
  "private-audience bytes in any browser-reachable root",
  "exterior geometry for owned buildings this release marks unavailable",
  "real-world facade, tenant, brand, signage, or survey-grade accuracy claims",
];

/**
 * The exact durable text hashed into the approval fingerprint. It is exported
 * so the fingerprint derivation stays reproducible from this file alone.
 */
export const MIDTOWN_CORE_APPROVAL_NOTE =
  "In-session user authorization dated 2026-08-11 broadened the NYC OTI Building Footprints (jh45-qr5r) envelope so exterior geometry generated from those footprints may additionally be publicly displayed, conveyed as a derivative, and redistributed, provided NYC OTI attribution, the City modified-data disclaimer, source IDs, capture timestamp, checksum, CRS, and height uncertainty travel with it. This release relies on that same envelope and widens nothing: it covers generated geometry only, never the raw jh45-qr5r source dataset, and public deployment remains excluded." as const;

/** `sha256HexSync(stableSerialize({ scope, exclusions, approvedAt, approvalNote }))`. */
export function midtownCoreApprovalFingerprint(): string {
  return sha256HexSync(stableSerialize({
    scope: MIDTOWN_CORE_APPROVAL_SCOPE,
    exclusions: [...MIDTOWN_CORE_APPROVAL_EXCLUSIONS],
    approvedAt: MIDTOWN_CORE_APPROVED_AT,
    approvalNote: MIDTOWN_CORE_APPROVAL_NOTE,
  }));
}

export const MIDTOWN_CORE_APPROVAL: ExteriorApprovalEvidence = {
  id: MIDTOWN_CORE_APPROVAL_ID,
  fingerprintSha256: midtownCoreApprovalFingerprint(),
  scope: MIDTOWN_CORE_APPROVAL_SCOPE,
  exclusions: [...MIDTOWN_CORE_APPROVAL_EXCLUSIONS],
  approvedAt: MIDTOWN_CORE_APPROVED_AT,
};

/** Stated reason carried by every building the cycle deliberately defers. */
export const MIDTOWN_CORE_DEFERRED_REASON =
  "Owned by this release but not materialized in this cycle: exterior geometry ships only for the bounded set of cells named by the release record, so this building carries no exterior asset and no substitute was selected." as const;

export function midtownCoreCellReleaseId(cellId: string, releaseId: string = MIDTOWN_CORE_RELEASE_ID): string {
  return `cell-release:${releaseId}:${cellId}:${MIDTOWN_CORE_CELL_RELEASE_VERSION}`;
}

export function midtownCoreTombstoneId(buildingId: string, releaseId: string = MIDTOWN_CORE_RELEASE_ID): string {
  return `tombstone:${releaseId}:${buildingId}`;
}

// ---------------------------------------------------------------------------
// Release profile
//
// The emitter is parameterised so a SUCCESSOR wave can reuse it without a
// second copy and without touching a byte of the release above. Every logical
// id derives from the profile's release id, so the two releases can never
// collide on an artifact path, an inventory id or a cell-release id.
//
// The V2 profile below is the default, and `buildMidtownCoreRelease(input)`
// keeps its original call shape. `midtown-core-release.test.ts` re-emits the V2
// release through the now-two-profile emitter and compares it against the
// committed checksum inventory, so "V2 bytes are unchanged" is asserted rather
// than asserted-by-intent.
// ---------------------------------------------------------------------------

/** Every logical identity a midtown-core wave release derives from its id. */
export function midtownCoreReleaseIds(releaseId: string): {
  releaseId: string;
  privateRootId: string;
  publicRootId: string;
  privateReleaseId: string;
  snapshotId: string;
  approvalId: string;
  assemblyPackageId: string;
  outputDirectory: string;
} {
  return {
    releaseId,
    privateRootId: `root:${releaseId}:private`,
    publicRootId: `root:${releaseId}:public`,
    privateReleaseId: `${releaseId}-private`,
    snapshotId: `snapshot:${releaseId}:v1`,
    approvalId: `approval:${releaseId}:midtown-core-canary`,
    assemblyPackageId: `assembly:${releaseId}:v1`,
    outputDirectory: `public/data/${releaseId}`,
  };
}

/**
 * Pins of the wave release a successor supersedes without editing it.
 *
 * Cross-release lineage is expressed at the ROOT and SNAPSHOT level only, and
 * deliberately NOT on the cell releases. `ExteriorCellRelease.predecessor` is an
 * intra-graph version link — the contract requires the predecessor cell release
 * to exist in the same graph and requires a versioned cell's fallback to BE that
 * predecessor — so pointing it at another release's cell would either be
 * unresolvable or would promise a runtime substitution into bytes this release
 * never verified. Each cell of a successor release is therefore the initial
 * version of its own lineage, falling back to pinned base massing, exactly as
 * the Block 835 V3 successor does.
 */
export interface MidtownCoreReleasePredecessor {
  releaseId: string;
  /** The predecessor's public root manifest. */
  publicRoot: { rootId: string; rootChecksumSha256: string };
  /** The predecessor's public rollout snapshot. */
  snapshot: { snapshotId: string; checksumSha256: string };
  /** Predecessor cell-release pins, keyed by cell id. Recorded, never emitted as a cell predecessor. */
  cellReleases: ReadonlyMap<string, { cellReleaseId: string; checksumSha256: string }>;
}

export interface MidtownCoreReleaseProfile {
  releaseId: string;
  generatedAt: string;
  approval: ExteriorApprovalEvidence;
  /** Asset quality budgets this wave's shipped LODs are measured against. */
  budgets: { maxTriangles: number; maxMaterials: number; maxTextures: number };
  inventoryId: (buildingId: string) => string;
  evidenceShardId: (buildingId: string) => string;
  predecessor: MidtownCoreReleasePredecessor | null;
}

export const MIDTOWN_CORE_V2_PROFILE: MidtownCoreReleaseProfile = {
  releaseId: MIDTOWN_CORE_RELEASE_ID,
  generatedAt: MIDTOWN_CORE_GENERATED_AT,
  approval: MIDTOWN_CORE_APPROVAL,
  budgets: { ...BLOCK835_QUALITY_BUDGETS },
  inventoryId: midtownCoreInventoryId,
  evidenceShardId: midtownCoreEvidenceShardId,
  predecessor: null,
};

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface MidtownCoreShippedAsset {
  lodId: string;
  relativeRef: string;
  byteSize: number;
  checksumSha256: string;
  counts: { triangleCount: number; materialCount: number; textureCount: number };
  /**
   * Axis-aligned bounds of the shipped GLB's own vertices, in its glTF Y-up
   * building frame. Measured from the emitted bytes, never estimated.
   */
  bounds: { minimum: readonly [number, number, number]; maximum: readonly [number, number, number] };
}

export interface MidtownCoreMaterializedBuilding {
  buildingId: string;
  ownerCellId: string;
  /** WGS84 `[longitude, latitude]` the building's own ENU frame is anchored at. */
  representative: readonly [number, number];
  /** The citywide snapshot's own source reference id for this building. */
  sourceRefId: string;
  sourceRecordId: string;
  planId: string;
  planHashSha256: string;
  uncertainty: string;
  inventory: ExteriorComponentInventory;
  assets: readonly MidtownCoreShippedAsset[];
  /**
   * The predecessor wave's asset this one supersedes, pinned by checksum.
   * Absent or `null` means the predecessor shipped nothing for this building,
   * which is the honest statement for a first-generation wave.
   */
  predecessor?: ImmutablePin | null;
}

export interface MidtownCoreReleaseInput {
  subset: MidtownCoreSubset;
  /** Cells whose buildings this cycle materializes, in ledger order. */
  renderableCellIds: readonly string[];
  materialized: readonly MidtownCoreMaterializedBuilding[];
  /** Building id to the deterministic refusal reason that kept it unavailable. */
  refusals?: ReadonlyMap<string, string>;
  /** Real capture chronology of the pinned base snapshot. */
  capture: { capturedAt: string; updatedAt: string };
  /** Omitted selects the V2 profile and reproduces its bytes exactly. */
  profile?: MidtownCoreReleaseProfile;
}

export interface MidtownCoreReleaseStats {
  cellCount: number;
  renderableCellCount: number;
  notShippedCellCount: number;
  ownedBuildingCount: number;
  availableBuildingCount: number;
  unavailableBuildingCount: number;
  refusedBuildingCount: number;
  shippedAssetCount: number;
  shippedAssetBytes: number;
  graphBytes: number;
  indexBytes: number;
  assembliesBytes: number;
  artifactBytes: number;
  totalPayloadBytes: number;
}

export interface MidtownCoreRelease {
  index: ExteriorCellReleaseIndex;
  graph: ExteriorReleaseGraph;
  assemblies: MultiLodAssemblyManifest[];
  /** Every declared root artifact blob, private ledger blob included. */
  rootArtifactBytes: Map<string, Uint8Array>;
  /** Exact byte map of the emitted release directory, keyed by relative path. */
  files: Map<string, Uint8Array>;
  stats: MidtownCoreReleaseStats;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();
function encode(value: string): Uint8Array { return encoder.encode(value); }
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function slug(value: string): string { return value.replaceAll(":", "-"); }
function fail(message: string): never { throw new Error(`Midtown-core release: ${message}`); }

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
 * never collide on bytes or checksum — the same technique the Block 835 canary
 * and the exterior fixture use to satisfy the graph's checksum-uniqueness rule.
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

interface SourceRights {
  license: ExteriorLicenseEvidence;
  source: (building: MidtownCoreMaterializedBuilding, capturedAt: string, updatedAt: string) => ExteriorSourceEvidence;
}

/**
 * The exact clauses the 2026-08-11 broadening added to the
 * `nyc.building-footprints` derivative policy. Each shipped right is derived
 * from the presence of its own clause, so a right this release asserts is a
 * restatement of the registry's text, never a literal written here.
 */
export const MIDTOWN_CORE_CONVEYANCE_CLAUSES = {
  publicDisplay: "may be publicly displayed",
  derivativeConveyance: "conveyed as a derivative",
  redistribution: "and redistributed",
} as const;

/**
 * `sha256HexSync(stableSerialize(entry.derivativePolicy))` of the pinned
 * generated-geometry conveyance policy. ADR 0027 Decision 6 makes that
 * broadening independently revertible, so the clause checks above are backed by
 * an exact-text pin: any edit to the policy — a revert to `openDerivative`, a
 * narrowing, or a rewording — fails this builder closed instead of leaving 160
 * evidence shards asserting rights the registry no longer grants.
 */
export const MIDTOWN_CORE_DERIVATIVE_POLICY_SHA256 = "3d3e4a802a48d4e6fa595acc73278ff5b9e46fdb00cd8b0d87061918eb2482a6" as const;

export interface MidtownCoreConveyanceRights {
  publicDisplay: boolean;
  derivativeConveyance: boolean;
  redistribution: boolean;
}

/**
 * Derives the conveyance rights this release may assert from the registry's own
 * derivative policy, and fails closed when it no longer grants them.
 *
 * Exported so the fail-closed path can be exercised against a mutated registry
 * entry without mocking the registry module.
 */
export function midtownCoreConveyanceRights(entry: {
  id: string;
  derivativePolicy: { allowed: string; constraints: string };
}): MidtownCoreConveyanceRights {
  const policy = entry.derivativePolicy;
  if (policy.allowed !== "yes" && policy.allowed !== "conditional") {
    fail(`source registry entry ${entry.id} declares derivative use ${policy.allowed}; no exterior geometry may be conveyed under it.`);
  }
  const granted: MidtownCoreConveyanceRights = {
    publicDisplay: policy.constraints.includes(MIDTOWN_CORE_CONVEYANCE_CLAUSES.publicDisplay),
    derivativeConveyance: policy.constraints.includes(MIDTOWN_CORE_CONVEYANCE_CLAUSES.derivativeConveyance),
    redistribution: policy.constraints.includes(MIDTOWN_CORE_CONVEYANCE_CLAUSES.redistribution),
  };
  const missing = (Object.keys(granted) as (keyof MidtownCoreConveyanceRights)[]).filter((right) => !granted[right]);
  if (missing.length > 0) {
    fail(`source registry entry ${entry.id} no longer grants ${missing.join(", ")} for exterior geometry generated from it; this release cannot assert those rights.`);
  }
  const fingerprint = sha256HexSync(stableSerialize(policy));
  if (fingerprint !== MIDTOWN_CORE_DERIVATIVE_POLICY_SHA256) {
    fail(`source registry entry ${entry.id} derivative policy text changed (fingerprint ${fingerprint}, expected ${MIDTOWN_CORE_DERIVATIVE_POLICY_SHA256}); conveyance rights must be re-reviewed rather than inherited.`);
  }
  return granted;
}

/**
 * License and per-building source evidence, read from the approved
 * `nyc.building-footprints` registry entry rather than restated here.
 *
 * Chronology is the pinned citywide snapshot's own record: `capturedAt` is the
 * snapshot's `captureTimestamp` and `sourceDate`/`updatedAt` its
 * `sourceUpdatedAt`. Both are real values at or before the 2026-08-11
 * authorization, so nothing has to be substituted.
 *
 * The source id is the citywide release's own `sourceRefIds[0]` for the
 * building, not a locally-invented identifier: the V2 plan's constraint source
 * ids are taken from the same field, so the evidence graph and the inventory
 * cite one identity.
 */
function sourceRights(approvalId: string): SourceRights {
  const entry = getSourceRegistryEntry(MIDTOWN_CORE_SOURCE_REGISTRY_ID);
  if (!entry) fail(`source registry entry ${MIDTOWN_CORE_SOURCE_REGISTRY_ID} is absent.`);
  if (entry.datasetId !== "jh45-qr5r") fail(`source registry entry ${entry.id} no longer names dataset jh45-qr5r.`);
  if (entry.approval.state !== "approved") fail(`source registry entry ${entry.id} is not approved.`);
  if (entry.retention.maximumDays !== null) fail(`source registry entry ${entry.id} declares a retention expiry this release cannot carry.`);
  // Public-audience rights are read out of the registry's derivative policy, not
  // written here; a reverted broadening fails the release closed.
  const conveyance = midtownCoreConveyanceRights(entry);

  const license: ExteriorLicenseEvidence = {
    id: MIDTOWN_CORE_LICENSE_ID,
    termsUrl: entry.termsUrl,
    attribution: entry.attribution,
    retention: { mode: "conditional", expiresAt: null, conditions: entry.retention.constraints },
    allowedUse: {
      privateDerivative: true,
      publicDisplay: conveyance.publicDisplay,
      derivativeConveyance: conveyance.derivativeConveyance,
      redistribution: conveyance.redistribution,
      // No shipped asset carries imagery and nothing here is a training or
      // validation-only input; these stay closed regardless of the policy text.
      runtimeTexture: false,
      trainingInput: false,
      generationInput: true,
      validationOnly: false,
    },
    personalDataRestricted: false,
  };

  return {
    license,
    source: (building, capturedAt, updatedAt) => {
      const expected = `source-ref:${entry.id}:${building.sourceRecordId}`;
      if (building.sourceRefId !== expected) fail(`building ${building.buildingId} cites source ref ${building.sourceRefId}, not the registry-derived ${expected}.`);
      return {
        id: building.sourceRefId,
        provider: entry.provider,
        datasetId: entry.datasetId,
        sourceRecordId: building.sourceRecordId,
        sourceUrl: entry.canonicalUrl,
        sourceDate: updatedAt,
        observedAt: capturedAt,
        capturedAt,
        updatedAt,
        attribution: entry.attribution,
        licenseId: license.id,
        approvalId,
      };
    },
  };
}

function tileBox(bounds: MidtownCoreShippedAsset["bounds"]): number[] {
  const center = [0, 1, 2].map((axis) => (bounds.minimum[axis]! + bounds.maximum[axis]!) / 2);
  // A degenerate half axis is rejected by the 3D Tiles gate, so a flat extent is
  // widened to a declared millimetre rather than shipped as zero.
  const half = [0, 1, 2].map((axis) => Math.max((bounds.maximum[axis]! - bounds.minimum[axis]!) / 2, 0.001));
  return [
    center[0]!, center[1]!, center[2]!,
    half[0]!, 0, 0,
    0, half[1]!, 0,
    0, 0, half[2]!,
  ];
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export function buildMidtownCoreRelease(input: MidtownCoreReleaseInput): MidtownCoreRelease {
  const profile = input.profile ?? MIDTOWN_CORE_V2_PROFILE;
  const ids = midtownCoreReleaseIds(profile.releaseId);
  const approval = profile.approval;
  const ledger = input.subset.ledger;
  const refusals = input.refusals ?? new Map<string, string>();
  const cellById = new Map(ledger.cells.map((cell) => [cell.cellId, cell]));
  const renderableCellIds = [...input.renderableCellIds];
  if (renderableCellIds.length === 0) fail("at least one renderable cell is required.");
  if (new Set(renderableCellIds).size !== renderableCellIds.length) fail("renderable cell ids must be unique.");
  for (const cellId of renderableCellIds) if (!cellById.has(cellId)) fail(`renderable cell ${cellId} is outside canonical ownership.`);

  const capturedAt = requireNotAfter(canonicalTimestamp(input.capture.capturedAt, "base capture timestamp"), approval.approvedAt, "base capture timestamp");
  const updatedAt = requireNotAfter(canonicalTimestamp(input.capture.updatedAt, "base source update timestamp"), approval.approvedAt, "base source update timestamp");
  const rights = sourceRights(approval.id);

  const materializedById = new Map(input.materialized.map((building) => [building.buildingId, building]));
  if (materializedById.size !== input.materialized.length) fail("a materialized building was supplied more than once.");
  const renderable = new Set(renderableCellIds);
  for (const building of input.materialized) {
    if (!renderable.has(building.ownerCellId)) fail(`materialized building ${building.buildingId} names owner cell ${building.ownerCellId}, which is not renderable this cycle.`);
    const owner = cellById.get(building.ownerCellId)!;
    if (!owner.buildingIds.includes(building.buildingId)) fail(`materialized building ${building.buildingId} is not owned by ${building.ownerCellId}.`);
    if (building.assets.length !== 1 || building.assets[0]!.lodId !== MIDTOWN_CORE_SHIPPED_LOD_ID) {
      fail(`building ${building.buildingId} must ship exactly the ${MIDTOWN_CORE_SHIPPED_LOD_ID} asset; see the single-shipped-LOD note.`);
    }
  }
  // Every building of a renderable cell must be materialized or explicitly
  // refused; a silently missing asset would turn a rendered cell into a
  // verification failure at runtime instead of a stated availability decision.
  for (const cellId of renderableCellIds) {
    for (const buildingId of cellById.get(cellId)!.buildingIds) {
      if (!materializedById.has(buildingId) && !refusals.has(buildingId)) fail(`renderable cell ${cellId} owns ${buildingId}, which is neither materialized nor refused.`);
    }
  }

  const inventoryShards: ExteriorInventoryShard[] = [];
  const evidenceShards: ExteriorEvidenceShard[] = [];
  const assets: AssemblyAsset[] = [];
  const glbArtifacts: AssemblyArtifact[] = [];
  const tileChains: Array<Record<string, unknown>> = [];
  const cellReleases: ExteriorCellRelease[] = [];

  // One package anchor for the whole assembly, so per-building ENU frames can be
  // placed relative to each other inside the tileset.
  const anchorCells = renderableCellIds.map((cellId) => cellById.get(cellId)!);
  const packageFrame = enuFrame({
    longitude: (Math.min(...anchorCells.map((cell) => cell.bounds.west)) + Math.max(...anchorCells.map((cell) => cell.bounds.east))) / 2,
    latitude: (Math.min(...anchorCells.map((cell) => cell.bounds.south)) + Math.max(...anchorCells.map((cell) => cell.bounds.north))) / 2,
  });
  const packageBounds = {
    minimum: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    maximum: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  };

  const assetBytes = new Map<string, Uint8Array | null>();
  let shippedAssetBytes = 0;

  for (const cell of ledger.cells) {
    const isRenderable = renderable.has(cell.cellId);
    const details: ExteriorBuildingDetail[] = [];
    for (const buildingId of cell.buildingIds) {
      const building = isRenderable ? materializedById.get(buildingId) : undefined;
      if (!building) {
        const refusal = refusals.get(buildingId);
        details.push({
          buildingId,
          status: "unavailable",
          tombstoneId: midtownCoreTombstoneId(buildingId, profile.releaseId),
          reason: refusal ?? MIDTOWN_CORE_DEFERRED_REASON,
          // The predecessor wave's inventory for this building, when it shipped
          // one. A first-generation wave has no predecessor inventory to cite
          // and states `null` rather than inventing a lineage.
          previousInventoryId: null,
        });
        continue;
      }
      const inventoryId = profile.inventoryId(buildingId);
      const evidenceShardId = profile.evidenceShardId(buildingId);
      if (building.inventory.buildingId !== buildingId) fail(`inventory for ${buildingId} names building ${building.inventory.buildingId}.`);
      const inventoryHashSha256 = sha256HexSync(stableSerialize(building.inventory));
      const truthTiers = [...new Set(building.inventory.components.map((component) => component.state))].sort(compareText);
      // The contract's own promotion gate, not a local restatement of it. It
      // still refuses every absent kind except the conditionally-applicable
      // ones, and refuses those unless the absence carries a stated reason.
      const ineligible = building.inventory.components.filter((component) => !isExteriorComponentReleaseEligible(component));
      if (ineligible.length > 0) {
        fail(`asset ${buildingId} declares components no release may promote: ${ineligible.map((component) => `${component.kind} is ${component.state}`).join(", ")}.`);
      }
      const source = rights.source(building, capturedAt, updatedAt);
      const constraintIds = [...new Set(building.inventory.components.flatMap((component) => component.state === "generated" ? component.generator.constraintSourceIds : []))];
      if (constraintIds.length !== 1 || constraintIds[0] !== source.id) fail(`inventory for ${buildingId} does not constrain exactly the ${source.id} source.`);

      const graph: ExteriorEvidenceGraph = {
        schemaVersion: EXTERIOR_COMPONENT_SCHEMA_VERSION,
        sources: [source],
        licenses: [{ ...rights.license, allowedUse: { ...rights.license.allowedUse }, retention: { ...rights.license.retention } }],
        approvals: [{ ...approval, exclusions: [...approval.exclusions] }],
        // Every component ships at the generated tier, so there is no claim
        // evidence to cite and the list is explicitly empty.
        evidence: [],
      };

      inventoryShards.push({
        schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
        shardId: inventoryId,
        audience: "public",
        artifactRef: artifactRefFor("public", "inventory", inventoryId),
        inventoryId,
        inventory: building.inventory,
      });
      evidenceShards.push({
        schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
        shardId: evidenceShardId,
        audience: "public",
        artifactRef: artifactRefFor("public", "evidence", evidenceShardId),
        inventoryId,
        graph,
      });
      details.push({ buildingId, status: "available", inventoryId, evidenceShardId, runtimeTexture: false });

      const lods: AssemblyLod[] = [];
      for (const asset of building.assets) {
        if (asset.counts.textureCount !== 0) fail(`asset ${buildingId} ${asset.lodId} declares embedded imagery.`);
        glbArtifacts.push({
          logicalId: `glb:${buildingId}:${asset.lodId}`,
          role: "glb",
          relativeRef: asset.relativeRef,
          byteSize: asset.byteSize,
          checksumSha256: asset.checksumSha256,
          ownerCellId: cell.cellId,
        });
        assetBytes.set(asset.relativeRef, null);
        shippedAssetBytes += asset.byteSize;
        lods.push({
          lodId: asset.lodId,
          artifactRef: asset.relativeRef,
          geometricErrorMeters: 0,
          // Unbounded: with one shipped LOD, no camera distance may leave this
          // asset without an eligible representation.
          maxDistanceMeters: null,
          eligible: true,
          quality: { ...asset.counts, budgets: { ...profile.budgets } },
          silhouette: null,
        });
        const offset = toEnuMeters(packageFrame, building.representative);
        // glTF Y-up: (east, north, up) maps to (east, up, -north), so the tile
        // translation uses the same convention as the shipped vertices.
        const translation: [number, number, number] = [offset[0], 0, -offset[1]];
        for (let axis = 0; axis < 3; axis += 1) {
          packageBounds.minimum[axis] = Math.min(packageBounds.minimum[axis]!, asset.bounds.minimum[axis]! + translation[axis]!);
          packageBounds.maximum[axis] = Math.max(packageBounds.maximum[axis]!, asset.bounds.maximum[axis]! + translation[axis]!);
        }
        tileChains.push({
          boundingVolume: { box: tileBox(asset.bounds) },
          geometricError: 0,
          refine: "REPLACE",
          transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, translation[0], translation[1], translation[2], 1],
          content: { uri: `../assets/${slug(buildingId)}__${asset.lodId}.glb` },
        });
      }

      assets.push({
        canonicalFeatureId: buildingId,
        ownerCellId: cell.cellId,
        inventoryId,
        inventoryHashSha256,
        evidenceShardId,
        truthTiers: truthTiers as AssemblyAsset["truthTiers"],
        sourceDates: { capturedAt, updatedAt },
        predecessor: building.predecessor ?? null,
        uncertainty: building.uncertainty,
        source: { kind: "facade-plan", planId: building.planId, planHashSha256: building.planHashSha256 },
        lods,
      });
    }

    const cellReleaseId = midtownCoreCellReleaseId(cell.cellId, profile.releaseId);
    cellReleases.push({
      schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
      cellReleaseId,
      version: MIDTOWN_CORE_CELL_RELEASE_VERSION,
      audience: "public",
      artifactRef: artifactRefFor("public", "cell-release", cellReleaseId),
      cityId: ledger.cityId,
      configId: ledger.configId,
      cellId: cell.cellId,
      bounds: { ...cell.bounds },
      ownershipLedgerId: ledger.ledgerId,
      baseIdentitySetId: ledger.baseIdentitySet.id,
      baseIdentitySetChecksumSha256: ledger.baseIdentitySet.checksumSha256,
      buildingIds: [...cell.buildingIds],
      // Intra-graph version link only; see `MidtownCoreReleasePredecessor`.
      predecessor: null,
      promotion: { ...approval, exclusions: [...approval.exclusions] },
      // The fallback stays the pinned base identity set even for a successor
      // wave. A cell-release fallback is what the runtime degrades to when THIS
      // release fails verification, and degrading to a predecessor release the
      // runtime has not verified in the same session would substitute bytes
      // nobody checked; base massing is the representation that is always
      // verified. The lineage is pinned on the root and the snapshot instead,
      // which records it without promising a silent substitution.
      fallback: { mode: "pinned-base", baseIdentitySetId: ledger.baseIdentitySet.id, checksumSha256: ledger.baseIdentitySet.checksumSha256 },
      buildingDetails: details,
      immutable: true,
    });
  }

  if (assets.length === 0) fail("no building was materialized; a canary with no geometry is refused.");

  // ---------------------------------------------------------------------
  // Artifact blobs
  // ---------------------------------------------------------------------
  const ledgerBlobs = {
    private: artifactBlob("private", "ownership-ledger", ledger.ledgerId, ledger),
    public: artifactBlob("public", "ownership-ledger", ledger.ledgerId, ledger),
  };
  const cellReleaseBlobs = new Map(cellReleases.map((cell) => [cell.cellReleaseId, artifactBlob("public", "cell-release", cell.cellReleaseId, cell)]));
  const inventoryBlobs = inventoryShards.map((shard) => artifactBlob("public", "inventory", shard.inventoryId, shard));
  const evidenceBlobs = evidenceShards.map((shard) => artifactBlob("public", "evidence", shard.shardId, shard));

  const snapshot: ExteriorRolloutSnapshot = {
    schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
    snapshotId: ids.snapshotId,
    audience: "public",
    artifactRef: artifactRefFor("public", "rollout-snapshot", ids.snapshotId),
    cityId: ledger.cityId,
    configId: ledger.configId,
    ownershipLedgerId: ledger.ledgerId,
    baseIdentitySetId: ledger.baseIdentitySet.id,
    baseIdentitySetChecksumSha256: ledger.baseIdentitySet.checksumSha256,
    // Both are intra-graph links, exactly like the cell-release predecessor:
    // the contract requires a snapshot predecessor to exist in this graph, and
    // requires each audience to carry exactly one initial complete snapshot. A
    // successor RELEASE is a new lineage, so its only snapshot is that initial
    // one. The cross-release ancestry is cited on the public root, and the
    // rollback a second promotion actually needs is the promotion-record swap in
    // `exterior-default-activation.ts`, which restores the predecessor RELEASE
    // rather than an ancestor snapshot inside this one.
    predecessor: null,
    rollbackTarget: null,
    cells: cellReleases.map((cell) => ({ cellId: cell.cellId, cellReleaseId: cell.cellReleaseId, checksumSha256: cellReleaseBlobs.get(cell.cellReleaseId)!.ref.checksumSha256 })),
    promotion: { ...approval, exclusions: [...approval.exclusions] },
    generatedAt: profile.generatedAt,
    immutable: true,
  };
  const snapshotBlob = artifactBlob("public", "rollout-snapshot", snapshot.snapshotId, snapshot);

  const privateArtifacts = [ledgerBlobs.private.ref];
  const publicBlobs = [ledgerBlobs.public, ...cellReleaseBlobs.values(), ...inventoryBlobs, ...evidenceBlobs, snapshotBlob];
  const publicArtifacts = publicBlobs.map((blob) => blob.ref);

  const privateRootDraft = {
    schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
    audience: "private" as const,
    rootId: ids.privateRootId,
    releaseId: ids.privateReleaseId,
    cityId: ledger.cityId,
    configId: ledger.configId,
    generatedAt: profile.generatedAt,
    immutable: true as const,
    artifactAllowlist: privateArtifacts.map((artifact) => artifact.relativeRef),
    artifacts: privateArtifacts,
    approval: { ...approval, exclusions: [...approval.exclusions] },
    predecessor: null,
    privatePredecessor: null,
  };
  const privateRoot: ExteriorRootManifest = { ...privateRootDraft, rootChecksumSha256: rootChecksum(privateRootDraft) };

  const publicRootDraft = {
    schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
    audience: "public" as const,
    rootId: ids.publicRootId,
    releaseId: ids.releaseId,
    cityId: ledger.cityId,
    configId: ledger.configId,
    generatedAt: profile.generatedAt,
    immutable: true as const,
    artifactAllowlist: publicArtifacts.map((artifact) => artifact.relativeRef),
    artifacts: publicArtifacts,
    approval: { ...approval, exclusions: [...approval.exclusions] },
    // Path-free citation of the public wave release this one supersedes, by
    // immutable logical identity and checksum — the same citation form the
    // contract defines for `privatePredecessor`, and the only level at which
    // cross-release ancestry is representable: cell-release and snapshot
    // predecessors are both intra-graph version links. The predecessor's own
    // bytes are untouched and remain on disk.
    predecessor: profile.predecessor
      ? { rootId: profile.predecessor.publicRoot.rootId, rootChecksumSha256: profile.predecessor.publicRoot.rootChecksumSha256 }
      : null,
    // Path-free citation of private ancestry; the private bytes never ship.
    privatePredecessor: { rootId: privateRoot.rootId, rootChecksumSha256: privateRoot.rootChecksumSha256 },
  };
  const publicRoot: ExteriorRootManifest = { ...publicRootDraft, rootChecksumSha256: rootChecksum(publicRootDraft) };

  const graph: ExteriorReleaseGraph = {
    schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
    roots: [privateRoot, publicRoot],
    ownershipLedger: ledger,
    cellReleases,
    inventoryShards,
    evidenceShards,
    snapshots: [snapshot],
  };
  const graphResult = validateExteriorReleaseGraph(graph);
  if (!graphResult.ok) fail(`emitted release graph is invalid: ${stableSerialize(graphResult.issues.slice(0, 8))}`);

  // ---------------------------------------------------------------------
  // Assembly package: only the cells this cycle materializes
  // ---------------------------------------------------------------------
  const tileset = {
    asset: { version: "1.1" },
    geometricError: 1,
    root: {
      boundingVolume: {
        box: tileBox({
          minimum: packageBounds.minimum as unknown as readonly [number, number, number],
          maximum: packageBounds.maximum as unknown as readonly [number, number, number],
        }),
      },
      geometricError: 1,
      refine: "REPLACE",
      children: [...tileChains].sort((left, right) => compareText(String((left.content as { uri: string }).uri), String((right.content as { uri: string }).uri))),
    },
  };
  const tilesetBytes = encode(JSON.stringify(tileset));
  const artifacts: AssemblyArtifact[] = [
    ...glbArtifacts,
    { logicalId: `tileset:${ids.assemblyPackageId}`, role: "tileset-json" as const, relativeRef: MIDTOWN_CORE_TILESET_REF, byteSize: tilesetBytes.byteLength, checksumSha256: sha256HexBytes(tilesetBytes), ownerCellId: null },
  ].sort((left, right) => compareText(left.relativeRef, right.relativeRef));

  const assembly: MultiLodAssemblyManifest = {
    schemaVersion: "1.0",
    packageId: ids.assemblyPackageId,
    audience: "public",
    generatedAt: profile.generatedAt,
    immutable: true,
    release: {
      rootId: publicRoot.rootId,
      rootChecksumSha256: publicRoot.rootChecksumSha256,
      releaseId: publicRoot.releaseId,
      cityId: ledger.cityId,
      configId: ledger.configId,
      privatePredecessor: { id: privateRoot.rootId, checksumSha256: privateRoot.rootChecksumSha256 },
    },
    baseIdentitySet: { id: ledger.baseIdentitySet.id, checksumSha256: ledger.baseIdentitySet.checksumSha256 },
    ownershipLedger: { id: ledger.ledgerId, checksumSha256: ledgerBlobs.public.ref.checksumSha256 },
    cells: renderableCellIds.map((cellId) => {
      const cell = cellById.get(cellId)!;
      const cellReleaseId = midtownCoreCellReleaseId(cellId, profile.releaseId);
      // The ASSEMBLY states the membership this package actually packages, and
      // the assembly validator enforces exactly that: every listed member must
      // carry a shipped asset. Owned-but-refused buildings are not a hole here —
      // they are stated in the release graph's cell release, which lists every
      // owned building and carries an `unavailable` detail with its reason for
      // each one that ships nothing. When the two sets coincide the ledger's own
      // membership checksum already describes this list and is carried verbatim;
      // when a building was refused, the checksum is recomputed over the packaged
      // list through the ledger's own derivation, so it never describes a
      // different set from the one beside it.
      const packaged = cell.buildingIds.filter((buildingId) => materializedById.has(buildingId));
      return {
        cellId,
        cellRelease: { id: cellReleaseId, checksumSha256: cellReleaseBlobs.get(cellReleaseId)!.ref.checksumSha256 },
        predecessor: null,
        buildingIds: packaged,
        membershipChecksumSha256: packaged.length === cell.buildingIds.length
          ? cell.membershipChecksumSha256
          : membershipChecksum(packaged),
      };
    }),
    assets,
    artifacts,
    tilesetRef: MIDTOWN_CORE_TILESET_REF,
    declaredTotalBytes: artifacts.reduce((total, artifact) => total + artifact.byteSize, 0),
  };
  const assemblyResult = validateMultiLodAssembly(assembly);
  if (!assemblyResult.ok) fail(`emitted public assembly is invalid: ${stableSerialize(assemblyResult.issues.slice(0, 8))}`);

  const index: ExteriorCellReleaseIndex = {
    schemaVersion: EXTERIOR_CELL_RUNTIME_SCHEMA_VERSION,
    releaseId: ids.releaseId,
    audience: "public",
    cityId: ledger.cityId,
    configId: ledger.configId,
    defaultHead: { snapshotId: snapshot.snapshotId, checksumSha256: snapshotBlob.ref.checksumSha256, assemblyPackageIds: [assembly.packageId] },
    // One snapshot only: this canary publishes no alternate head to opt into.
    canaryHeads: [],
    baseCompatibility: { baseReleaseIds: [...MIDTOWN_CORE_BASE_RELEASE_IDS] },
    localOnly: true,
    runtimeExternalNetwork: false,
  };
  const indexResult = validateExteriorCellReleaseIndex(index);
  if (!indexResult.ok) fail(`emitted runtime index is invalid: ${stableSerialize(indexResult.issues)}`);

  const rootArtifactBytes = new Map<string, Uint8Array>([
    [ledgerBlobs.private.ref.relativeRef, ledgerBlobs.private.bytes],
    ...publicBlobs.map((blob) => [blob.ref.relativeRef, blob.bytes] as const),
  ]);

  const indexBytes = encode(`${JSON.stringify(index, null, 2)}\n`);
  const graphBytes = encode(`${JSON.stringify(graph, null, 2)}\n`);
  const assembliesBytes = encode(`${JSON.stringify([assembly], null, 2)}\n`);
  const files = new Map<string, Uint8Array>([
    ["index.json", indexBytes],
    ["release-graph.json", graphBytes],
    ["assemblies.json", assembliesBytes],
    [MIDTOWN_CORE_TILESET_REF, tilesetBytes],
  ]);
  // Private-audience bytes are never written into a browser-reachable root.
  for (const blob of publicBlobs) {
    if (!blob.ref.relativeRef.startsWith("public/")) fail(`refusing to emit a non-public artifact path: ${blob.ref.relativeRef}`);
    files.set(blob.ref.relativeRef, blob.bytes);
  }
  for (const ref of assetBytes.keys()) if (!ref.startsWith("public/")) fail(`refusing to emit a non-public asset path: ${ref}`);

  const artifactBytesTotal = [...publicBlobs].reduce((total, blob) => total + blob.ref.byteSize, 0);
  const unavailableBuildingCount = cellReleases.reduce((total, cell) => total + cell.buildingDetails.filter((detail) => detail.status === "unavailable").length, 0);

  return {
    index,
    graph,
    assemblies: [assembly],
    rootArtifactBytes,
    files,
    stats: {
      cellCount: ledger.cells.length,
      renderableCellCount: renderableCellIds.length,
      notShippedCellCount: ledger.cells.length - renderableCellIds.length,
      ownedBuildingCount: ledger.baseIdentitySet.buildingCount,
      availableBuildingCount: assets.length,
      unavailableBuildingCount,
      refusedBuildingCount: refusals.size,
      shippedAssetCount: glbArtifacts.length,
      shippedAssetBytes,
      graphBytes: graphBytes.byteLength,
      indexBytes: indexBytes.byteLength,
      assembliesBytes: assembliesBytes.byteLength,
      artifactBytes: artifactBytesTotal,
      totalPayloadBytes: indexBytes.byteLength + graphBytes.byteLength + assembliesBytes.byteLength + tilesetBytes.byteLength + artifactBytesTotal + shippedAssetBytes,
    },
  };
}
