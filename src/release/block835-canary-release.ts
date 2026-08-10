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
import { validateMultiLodAssembly, type MultiLodAssemblyManifest } from "./multi-lod-assembly.ts";

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
function sourceRights(): SourceRights {
  const entry = getSourceRegistryEntry(BLOCK835_CANARY_SOURCE_REGISTRY_ID);
  if (!entry) fail(`source registry entry ${BLOCK835_CANARY_SOURCE_REGISTRY_ID} is absent.`);
  if (entry.datasetId !== "jh45-qr5r") fail(`source registry entry ${entry.id} no longer names dataset jh45-qr5r.`);
  if (entry.approval.state !== "approved") fail(`source registry entry ${entry.id} is not approved.`);
  if (entry.retention.maximumDays !== null) fail(`source registry entry ${entry.id} declares a retention expiry this release cannot carry.`);
  const datasetDate = requireNotAfter(canonicalTimestamp(entry.updateTimestamp, "registry updateTimestamp"), BLOCK835_CANARY_APPROVED_AT, "registry updateTimestamp");

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
      approvalId: BLOCK835_CANARY_APPROVAL.id,
    }),
  };
}

export function buildBlock835CanaryRelease(input: Block835CanaryInput): Block835CanaryRelease {
  const manifestResult = validateMultiLodAssembly(input.manifest);
  if (!manifestResult.ok) fail(`input package manifest is invalid: ${stableSerialize(manifestResult.issues)}`);
  const inputManifest = manifestResult.value;
  if (inputManifest.packageId !== BLOCK835_CANARY_INPUT_PACKAGE_ID) fail(`input package is ${inputManifest.packageId}, not ${BLOCK835_CANARY_INPUT_PACKAGE_ID}.`);
  if (inputManifest.audience !== "private") fail("input package must be the private generated-exterior package.");
  if (inputManifest.cells.length !== 1) fail("input package must declare exactly one ownership cell.");
  const inputCell = inputManifest.cells[0]!;
  if (inputCell.cellId !== BLOCK835_CELL_ID) fail(`input package cell is ${inputCell.cellId}, not ${BLOCK835_CELL_ID}.`);
  if (inputManifest.release.cityId !== BLOCK835_CITY_ID || inputManifest.release.configId !== BLOCK835_CONFIG_ID) fail("input package city/config identity drifted.");
  if (inputManifest.baseIdentitySet.id !== BLOCK835_CANARY_BASE_IDENTITY_SET_ID) fail(`input package base identity set is ${inputManifest.baseIdentitySet.id}.`);

  const buildings = readPilotBuildings(input.pilotRelease);
  const buildingIds = [...inputCell.buildingIds].sort(compareText);
  if (stableSerialize(buildings.map((building) => building.canonicalBuildingId).sort(compareText)) !== stableSerialize(buildingIds)) {
    fail("pilot membership and input package cell membership differ.");
  }
  const baseIdentityChecksum = sha256HexSync(stableSerialize([...buildingIds].sort(compareText)));
  if (baseIdentityChecksum !== inputManifest.baseIdentitySet.checksumSha256) fail("input package base identity checksum does not match canonical ownership membership.");
  if (baseIdentityChecksum !== inputCell.membershipChecksumSha256) fail("input package cell membership checksum does not match canonical ownership membership.");

  const bounds = footprintBounds(buildings);
  const rights = sourceRights();
  const assetById = new Map(inputManifest.assets.map((asset) => [asset.canonicalFeatureId, asset]));

  const ledger: ExteriorOwnershipLedger = {
    schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
    ledgerId: BLOCK835_CANARY_OWNERSHIP_LEDGER_ID,
    cityId: BLOCK835_CITY_ID,
    configId: BLOCK835_CONFIG_ID,
    immutable: true,
    baseIdentitySet: { id: BLOCK835_CANARY_BASE_IDENTITY_SET_ID, checksumSha256: baseIdentityChecksum, buildingCount: buildingIds.length },
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
    const inventoryId = successorInventoryId(building.canonicalBuildingId);
    const evidenceShardId = successorEvidenceShardId(building.canonicalBuildingId);
    if (asset.inventoryId !== inventoryId || asset.evidenceShardId !== evidenceShardId) fail(`input package inventory/evidence identity drifted for ${building.canonicalBuildingId}.`);
    if (asset.truthTiers.length !== 1 || asset.truthTiers[0] !== "generated") fail(`asset ${building.canonicalBuildingId} is not entirely generated.`);

    // The shipped inventory is the package's own V2 plan inventory; the hash
    // check binds these bytes to the immutable manifest pin rather than
    // re-asserting a component vocabulary here.
    const inventory: ExteriorComponentInventory = buildSuccessorPlan(building).plan.inventory;
    if (sha256HexSync(stableSerialize(inventory)) !== asset.inventoryHashSha256) fail(`rebuilt inventory for ${building.canonicalBuildingId} does not match the package's pinned inventory hash.`);

    const capturedAt = requireNotAfter(
      canonicalTimestamp(asset.sourceDates.capturedAt ?? building.capturedAt, `capture timestamp for ${building.canonicalBuildingId}`),
      BLOCK835_CANARY_APPROVED_AT,
      `capture timestamp for ${building.canonicalBuildingId}`,
    );
    const source = rights.source(building, capturedAt);
    const constraintIds = [...new Set(inventory.components.flatMap((component) => component.state === "generated" ? component.generator.constraintSourceIds : []))];
    if (constraintIds.length !== 1 || constraintIds[0] !== source.id) fail(`inventory for ${building.canonicalBuildingId} does not constrain exactly the ${source.id} source.`);

    const graph: ExteriorEvidenceGraph = {
      schemaVersion: EXTERIOR_COMPONENT_SCHEMA_VERSION,
      sources: [source],
      licenses: [{ ...rights.license, allowedUse: { ...rights.license.allowedUse }, retention: { ...rights.license.retention } }],
      approvals: [{ ...BLOCK835_CANARY_APPROVAL, exclusions: [...BLOCK835_CANARY_APPROVAL.exclusions] }],
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
    cellReleaseId: BLOCK835_CANARY_CELL_RELEASE_ID,
    version: BLOCK835_CANARY_CELL_RELEASE_VERSION,
    audience: "public",
    artifactRef: artifactRefFor("public", "cell-release", BLOCK835_CANARY_CELL_RELEASE_ID),
    cityId: BLOCK835_CITY_ID,
    configId: BLOCK835_CONFIG_ID,
    cellId: BLOCK835_CELL_ID,
    bounds: { ...bounds },
    ownershipLedgerId: ledger.ledgerId,
    baseIdentitySetId: ledger.baseIdentitySet.id,
    baseIdentitySetChecksumSha256: baseIdentityChecksum,
    buildingIds: [...buildingIds],
    predecessor: null,
    promotion: { ...BLOCK835_CANARY_APPROVAL, exclusions: [...BLOCK835_CANARY_APPROVAL.exclusions] },
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
    snapshotId: BLOCK835_CANARY_SNAPSHOT_ID,
    audience: "public",
    artifactRef: artifactRefFor("public", "rollout-snapshot", BLOCK835_CANARY_SNAPSHOT_ID),
    cityId: BLOCK835_CITY_ID,
    configId: BLOCK835_CONFIG_ID,
    ownershipLedgerId: ledger.ledgerId,
    baseIdentitySetId: ledger.baseIdentitySet.id,
    baseIdentitySetChecksumSha256: baseIdentityChecksum,
    predecessor: null,
    rollbackTarget: null,
    cells: [{ cellId: BLOCK835_CELL_ID, cellReleaseId: cellRelease.cellReleaseId, checksumSha256: cellReleaseBlob.ref.checksumSha256 }],
    promotion: { ...BLOCK835_CANARY_APPROVAL, exclusions: [...BLOCK835_CANARY_APPROVAL.exclusions] },
    generatedAt: BLOCK835_CANARY_GENERATED_AT,
    immutable: true,
  };
  const snapshotBlob = artifactBlob("public", "rollout-snapshot", snapshot.snapshotId, snapshot);

  const privateArtifacts = [ledgerBlobs.private.ref];
  const publicBlobs = [ledgerBlobs.public, cellReleaseBlob, ...inventoryBlobs, ...evidenceBlobs, snapshotBlob];
  const publicArtifacts = publicBlobs.map((blob) => blob.ref);

  const privateRootDraft = {
    schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
    audience: "private" as const,
    rootId: BLOCK835_CANARY_PRIVATE_ROOT_ID,
    releaseId: BLOCK835_CANARY_PRIVATE_RELEASE_ID,
    cityId: BLOCK835_CITY_ID,
    configId: BLOCK835_CONFIG_ID,
    generatedAt: BLOCK835_CANARY_GENERATED_AT,
    immutable: true as const,
    artifactAllowlist: privateArtifacts.map((artifact) => artifact.relativeRef),
    artifacts: privateArtifacts,
    approval: { ...BLOCK835_CANARY_APPROVAL, exclusions: [...BLOCK835_CANARY_APPROVAL.exclusions] },
    predecessor: null,
    privatePredecessor: null,
  };
  const privateRoot: ExteriorRootManifest = { ...privateRootDraft, rootChecksumSha256: rootChecksum(privateRootDraft) };

  const publicRootDraft = {
    schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
    audience: "public" as const,
    rootId: BLOCK835_CANARY_PUBLIC_ROOT_ID,
    releaseId: BLOCK835_CANARY_RELEASE_ID,
    cityId: BLOCK835_CITY_ID,
    configId: BLOCK835_CONFIG_ID,
    generatedAt: BLOCK835_CANARY_GENERATED_AT,
    immutable: true as const,
    artifactAllowlist: publicArtifacts.map((artifact) => artifact.relativeRef),
    artifacts: publicArtifacts,
    approval: { ...BLOCK835_CANARY_APPROVAL, exclusions: [...BLOCK835_CANARY_APPROVAL.exclusions] },
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
    cells: inputManifest.cells.map((cell) => ({ ...cell, buildingIds: [...cell.buildingIds] })),
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
    releaseId: BLOCK835_CANARY_RELEASE_ID,
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
