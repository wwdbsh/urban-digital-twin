import { validateProjectedGraphAudience } from "../domain/exterior-evidence-intake.ts";
import { CitywideLruCache, CitywideRequestPool } from "../release/citywide-release.ts";
import {
  parseGlbV2,
  requiresTextureFreeAssembly,
  validateGlbBinding,
  validateMultiLodAssembly,
  type AssemblyAsset,
  type AssemblyCitedStyle,
  type AssemblyLod,
  type ComponentTruthTier,
  type ImmutablePin,
  type MultiLodAssemblyManifest,
} from "../release/multi-lod-assembly.ts";
import {
  validateExteriorReleaseGraph,
  type ExteriorCellRelease,
  type ExteriorEvidenceShard,
  type ExteriorReleaseGraph,
  type ExteriorRolloutSnapshot,
  type ExteriorRootManifest,
} from "../release/exterior-release.ts";
import type { AggregateRequestBudget } from "./composed-release-runtime.ts";
import { isSafeReleaseArtifactReference } from "./path-security.ts";
import {
  selectExteriorLod,
  type ExteriorRenderProfile,
} from "./exterior-render-profiles.ts";

export const EXTERIOR_CELL_RUNTIME_SCHEMA_VERSION = "1.0" as const;

/**
 * Cache and concurrency ceilings for the exterior loader.
 *
 * The 256 MiB figure bounds *verified compressed GLB bytes retained by this
 * cache*. Decoded GPU memory inside Cesium is not observable here and is
 * explicitly out of scope. Concurrency is 4 because that is the accepted
 * citywide pool ceiling, and the same permit is shared app-wide through
 * `AggregateRequestBudget`, so the contract's "<= 8 active requests" is
 * satisfied by a stricter, provable 4.
 */
export const EXTERIOR_RUNTIME_BUDGETS = {
  maxCacheEntries: 256,
  maxCachedBytes: 256 * 1024 * 1024,
  maxConcurrentRequests: 4,
} as const;

export const EXTERIOR_RUNTIME_FAILURE_CODES = [
  "index-invalid",
  "graph-invalid",
  "assembly-invalid",
  "assembly-pin-mismatch",
  "private-artifact-forbidden",
  "unsafe-artifact-ref",
  "artifact-exceeds-cache-budget",
  "request-failed",
  "byte-size-mismatch",
  "checksum-mismatch",
  "glb-invalid",
  "evidence-audience-forbidden",
  "base-incompatible",
  "lod-unavailable",
  "cell-missing",
  "cell-release-missing",
  "snapshot-missing",
] as const;
export type ExteriorRuntimeFailureCode = (typeof EXTERIOR_RUNTIME_FAILURE_CODES)[number];

export class ExteriorRuntimeError extends Error {
  readonly code: ExteriorRuntimeFailureCode;
  readonly artifactRef: string | null;

  constructor(code: ExteriorRuntimeFailureCode, message: string, artifactRef: string | null = null) {
    super(message);
    this.name = "ExteriorRuntimeError";
    this.code = code;
    this.artifactRef = artifactRef;
  }
}

export interface ExteriorRuntimeSnapshotPin {
  snapshotId: string;
  checksumSha256: string;
  assemblyPackageIds: string[];
}

/**
 * Operator-pinned head selection. `defaultHead` is one immutable
 * `{snapshotId, checksumSha256}` pin chosen by an operator; the runtime never
 * resolves a "latest" snapshot by date or lineage depth. Canary heads are a
 * closed list of alternates a user may explicitly opt into.
 */
export interface ExteriorCellReleaseIndex {
  schemaVersion: typeof EXTERIOR_CELL_RUNTIME_SCHEMA_VERSION;
  releaseId: string;
  audience: "public";
  cityId: string;
  configId: string;
  defaultHead: ExteriorRuntimeSnapshotPin;
  canaryHeads: ExteriorRuntimeSnapshotPin[];
  baseCompatibility: { baseReleaseIds: string[] };
  localOnly: true;
  runtimeExternalNetwork: false;
}

export interface ExteriorRuntimeIssue { path: string; message: string }
export type ExteriorRuntimeValidation<T> = { ok: true; value: T } | { ok: false; issues: ExteriorRuntimeIssue[] };

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function checksum(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }

function validatePin(value: unknown, path: string, issues: ExteriorRuntimeIssue[]): void {
  if (!record(value)) return void issues.push({ path, message: "Snapshot pin must be an object." });
  for (const key of Object.keys(value)) if (!["snapshotId", "checksumSha256", "assemblyPackageIds"].includes(key)) issues.push({ path: `${path}.${key}`, message: "Unexpected snapshot pin field." });
  if (!nonEmpty(value.snapshotId)) issues.push({ path: `${path}.snapshotId`, message: "Operator-pinned snapshot ID is required." });
  if (!checksum(value.checksumSha256)) issues.push({ path: `${path}.checksumSha256`, message: "Snapshot pin checksum must be lowercase SHA-256." });
  if (!Array.isArray(value.assemblyPackageIds) || value.assemblyPackageIds.length === 0 || value.assemblyPackageIds.some((entry) => !nonEmpty(entry)) || new Set(value.assemblyPackageIds).size !== value.assemblyPackageIds.length) issues.push({ path: `${path}.assemblyPackageIds`, message: "A unique non-empty assembly package list is required." });
}

export function validateExteriorCellReleaseIndex(value: unknown): ExteriorRuntimeValidation<ExteriorCellReleaseIndex> {
  const issues: ExteriorRuntimeIssue[] = [];
  if (!record(value)) return { ok: false, issues: [{ path: "$", message: "Exterior runtime index must be an object." }] };
  const allowed = ["schemaVersion", "releaseId", "audience", "cityId", "configId", "defaultHead", "canaryHeads", "baseCompatibility", "localOnly", "runtimeExternalNetwork"];
  for (const key of Object.keys(value)) if (!allowed.includes(key)) issues.push({ path: `$.${key}`, message: "Unexpected exterior runtime index field." });
  for (const key of allowed) if (!(key in value)) issues.push({ path: `$.${key}`, message: "Required exterior runtime index field is missing." });
  if (value.schemaVersion !== EXTERIOR_CELL_RUNTIME_SCHEMA_VERSION) issues.push({ path: "$.schemaVersion", message: "Unsupported exterior runtime index schema." });
  // The browser resolves only the public audience root; there is no private branch.
  if (value.audience !== "public") issues.push({ path: "$.audience", message: "The browser runtime resolves only the public audience root." });
  for (const key of ["releaseId", "cityId", "configId"] as const) if (!nonEmpty(value[key])) issues.push({ path: `$.${key}`, message: "Exterior runtime identity field is required." });
  validatePin(value.defaultHead, "$.defaultHead", issues);
  if (!Array.isArray(value.canaryHeads)) issues.push({ path: "$.canaryHeads", message: "Canary heads must be an explicit (possibly empty) pinned list." });
  else value.canaryHeads.forEach((entry, index) => validatePin(entry, `$.canaryHeads[${index}]`, issues));
  const defaultHead = record(value.defaultHead) ? value.defaultHead : null;
  if (Array.isArray(value.canaryHeads) && defaultHead && value.canaryHeads.some((entry) => record(entry) && entry.snapshotId === defaultHead.snapshotId)) issues.push({ path: "$.canaryHeads", message: "A canary head cannot alias the default head." });
  if (!record(value.baseCompatibility) || !Array.isArray(value.baseCompatibility.baseReleaseIds) || value.baseCompatibility.baseReleaseIds.length === 0 || value.baseCompatibility.baseReleaseIds.some((entry) => !nonEmpty(entry))) issues.push({ path: "$.baseCompatibility", message: "Explicit base release compatibility pins are required." });
  if (value.localOnly !== true) issues.push({ path: "$.localOnly", message: "The exterior runtime index must declare local-only delivery." });
  if (value.runtimeExternalNetwork !== false) issues.push({ path: "$.runtimeExternalNetwork", message: "The exterior runtime index must declare no runtime external network." });
  return issues.length ? { ok: false, issues } : { ok: true, value: value as unknown as ExteriorCellReleaseIndex };
}

export type ExteriorHeadRequest = { kind: "default" } | { kind: "canary"; snapshotId: string };

export interface ExteriorHeadResolution {
  requested: ExteriorHeadRequest;
  origin: "default" | "canary";
  pin: ExteriorRuntimeSnapshotPin;
  /** Non-null whenever the resolved head is not the requested head. */
  notice: string | null;
}

/**
 * Deterministic head selection. A shared deep link naming a canary that this
 * release does not pin resolves to the operator-pinned default and says so; a
 * canary never becomes the default and is never substituted silently.
 */
export function resolveExteriorHead(index: ExteriorCellReleaseIndex, request: ExteriorHeadRequest): ExteriorHeadResolution {
  if (request.kind === "default") return { requested: request, origin: "default", pin: index.defaultHead, notice: null };
  const canary = index.canaryHeads.find((entry) => entry.snapshotId === request.snapshotId);
  if (canary) return { requested: request, origin: "canary", pin: canary, notice: null };
  return {
    requested: request,
    origin: "default",
    pin: index.defaultHead,
    notice: `Canary exterior snapshot ${request.snapshotId} is not pinned in release ${index.releaseId}; the operator-pinned default snapshot ${index.defaultHead.snapshotId} was used instead.`,
  };
}

export interface ExteriorAssetProvenance {
  inventoryId: string;
  inventoryHashSha256: string;
  evidenceShardId: string;
  truthTiers: ComponentTruthTier[];
  sourceDates: { capturedAt: string | null; updatedAt: string | null };
  predecessor: ImmutablePin | null;
  uncertainty: string;
  /**
   * Present only where a rights-cleared record displaced this asset's designed
   * facade style class. Absence is the ordinary case and means the appearance is
   * entirely designed.
   */
  citedStyle?: AssemblyCitedStyle;
}

export interface ExteriorRenderedAsset {
  canonicalFeatureId: string;
  ownerCellId: string;
  lodId: string;
  artifactRef: string;
  byteSize: number;
  checksumSha256: string;
  bytes: Uint8Array;
  geometricErrorMeters: number;
  maxDistanceMeters: number | null;
  provenance: ExteriorAssetProvenance;
}

export interface ExteriorCellRenderPlan {
  kind: "rendered";
  cellId: string;
  cellReleaseId: string;
  cellReleaseVersion: string;
  assemblyPackageId: string;
  /** `predecessor` means the single-hop fallback rendered instead of the head. */
  representation: "head" | "predecessor";
  assets: ExteriorRenderedAsset[];
  notice: string | null;
}

export interface ExteriorCellFailureState {
  /** `base-massing` keeps the existing verified base/civic massing visible. */
  kind: "base-massing" | "failed";
  cellId: string;
  cellReleaseId: string;
  code: ExteriorRuntimeFailureCode;
  message: string;
  notice: string;
}

/**
 * A cell the release itself declares as carrying no exterior geometry: every
 * owned building has detail status `unavailable`.
 *
 * This is a *bounded-availability* outcome, not a failure. Nothing was fetched,
 * nothing failed verification, and no substitute was selected. It is kept
 * distinct from `base-massing` so a deliberately unshipped cell can never be
 * reported as a verification failure, and so a real failure keeps the alarming
 * path it needs.
 */
export interface ExteriorCellNotShippedState {
  kind: "not-shipped";
  cellId: string;
  cellReleaseId: string;
  /** Owned buildings the release declares unavailable in this version. */
  unavailableBuildingCount: number;
  notice: string;
}

export type ExteriorCellOutcome = ExteriorCellRenderPlan | ExteriorCellFailureState | ExteriorCellNotShippedState;

export interface ExteriorRuntimeMetrics {
  cacheEntries: number;
  cachedBytes: number;
  cacheEvictions: number;
  maxCacheEntries: number;
  maxCachedBytes: number;
  activeRequests: number;
  maxConcurrentRequests: number;
  peakConcurrentRequests: number;
  requestedArtifactCount: number;
  loadedArtifactCount: number;
  failedArtifactCount: number;
  fallbackCellCount: number;
  failedCellCount: number;
  /** Cells the release declares as shipping no exterior geometry, by design. */
  notShippedCellCount: number;
}

export type ExteriorArtifactFetcher = (relativeRef: string, signal?: AbortSignal) => Promise<Uint8Array>;

export interface ExteriorBaseIdentity {
  releaseId: string;
  /** Exterior canonical feature IDs are base building IDs; this proves membership. */
  has(canonicalFeatureId: string): boolean;
}

export interface ExteriorCellRuntimeOptions {
  fetchArtifact: ExteriorArtifactFetcher;
  baseIdentity: ExteriorBaseIdentity;
  sharedBudget?: AggregateRequestBudget | null;
  cache?: CitywideLruCache<Uint8Array> | null;
}

export interface ExteriorCellRuntimeSource {
  index: ExteriorCellReleaseIndex;
  graph: ExteriorReleaseGraph;
  assemblies: readonly unknown[];
}

export interface ExteriorDroppedAssemblyPackage {
  packageId: string;
  reason: string;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new ExteriorRuntimeError("request-failed", "Web Crypto SHA-256 is unavailable; the exterior loader failed closed.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Public-root-only admission. Every artifact the browser may touch must be a
 * canonical safe relative reference inside the public audience root. There is
 * no audience branch that could reach a `private/` artifact.
 */
export function assertPublicExteriorArtifactRef(relativeRef: unknown): string {
  if (!isSafeReleaseArtifactReference(relativeRef)) throw new ExteriorRuntimeError("unsafe-artifact-ref", `Exterior artifact reference is not a canonical safe relative path: ${String(relativeRef)}`, typeof relativeRef === "string" ? relativeRef : null);
  if (!relativeRef.startsWith("public/") || relativeRef.toLowerCase().includes("private")) throw new ExteriorRuntimeError("private-artifact-forbidden", `Exterior artifact reference leaves the public audience root: ${relativeRef}`, relativeRef);
  return relativeRef;
}

function issueText(issues: readonly { path: string; message: string }[]): string {
  return issues.slice(0, 6).map((entry) => `${entry.path} ${entry.message}`).join("; ");
}

export class ExteriorCellRuntime {
  readonly index: ExteriorCellReleaseIndex;
  readonly head: ExteriorHeadResolution;
  readonly snapshot: ExteriorRolloutSnapshot;
  readonly releaseId: string;
  readonly origin: "default" | "canary";
  private readonly graph: ExteriorReleaseGraph;
  private readonly publicRoot: ExteriorRootManifest;
  /** Structurally validated exactly once at construction (memoized for every loadCell). */
  private readonly assemblies: readonly MultiLodAssemblyManifest[];
  readonly droppedAssemblyPackages: readonly ExteriorDroppedAssemblyPackage[];
  private readonly cellById: Map<string, ExteriorCellRelease>;
  private readonly evidenceById: Map<string, ExteriorEvidenceShard>;
  private readonly baseIdentity: ExteriorBaseIdentity;
  private readonly fetchArtifact: ExteriorArtifactFetcher;
  private readonly cache: CitywideLruCache<Uint8Array>;
  private readonly pool: CitywideRequestPool<Uint8Array>;
  private readonly sharedBudget: AggregateRequestBudget | null;
  /**
   * `CitywideRequestPool` reports every loader failure as `undefined`, so the
   * typed reason is recorded here and re-thrown by the caller. This is safe
   * because the key is the fully-qualified cache key (`ref#checksum`), the pool
   * shares one in-flight promise per key, and each asset's artifacts are awaited
   * sequentially inside `verifyCellRelease` while `ownerCellId` enforcement
   * keeps two cells from claiming the same artifact. No two concurrent loads can
   * therefore contend for one entry in this map.
   */
  private readonly artifactErrors = new Map<string, ExteriorRuntimeError>();
  private requestedArtifactCount = 0;
  private loadedArtifactCount = 0;
  private failedArtifactCount = 0;
  private fallbackCellCount = 0;
  private failedCellCount = 0;
  private notShippedCellCount = 0;

  constructor(source: ExteriorCellRuntimeSource, head: ExteriorHeadResolution, options: ExteriorCellRuntimeOptions) {
    const publicRoot = source.graph.roots.find((root) => root.audience === "public");
    if (!publicRoot) throw new ExteriorRuntimeError("graph-invalid", "The exterior release graph has no public audience root.");
    const snapshot = source.graph.snapshots.find((entry) => entry.snapshotId === head.pin.snapshotId && entry.audience === "public");
    if (!snapshot) throw new ExteriorRuntimeError("snapshot-missing", `Pinned exterior snapshot ${head.pin.snapshotId} is not present in the public release graph.`);
    const snapshotArtifact = publicRoot.artifacts.find((artifact) => artifact.kind === "rollout-snapshot" && artifact.logicalId === snapshot.snapshotId);
    if (!snapshotArtifact || snapshotArtifact.checksumSha256 !== head.pin.checksumSha256) throw new ExteriorRuntimeError("checksum-mismatch", `Pinned exterior snapshot ${head.pin.snapshotId} checksum does not match its public root declaration.`);
    this.index = source.index;
    this.head = head;
    this.snapshot = snapshot;
    this.origin = head.origin;
    this.releaseId = source.index.releaseId;
    this.graph = source.graph;
    this.publicRoot = publicRoot;
    // Only packages the resolved head actually pins are hard-validated. A
    // canary-only package that is invalid must not disable the default head.
    const allowed = new Set(head.pin.assemblyPackageIds);
    const validated: MultiLodAssemblyManifest[] = [];
    const dropped: ExteriorDroppedAssemblyPackage[] = [];
    for (const [position, candidate] of source.assemblies.entries()) {
      const declaredId = (candidate as { packageId?: unknown } | null)?.packageId;
      const label = typeof declaredId === "string" && declaredId.length > 0 ? declaredId : `<unidentified assembly [${position}]>`;
      const structural = validateMultiLodAssembly(candidate);
      if (!structural.ok) {
        if (typeof declaredId === "string" && allowed.has(declaredId)) throw new ExteriorRuntimeError("assembly-invalid", `Assembly package ${label} pinned by head ${head.pin.snapshotId} failed closed: ${issueText(structural.issues)}`);
        dropped.push({ packageId: label, reason: `structurally invalid and not pinned by the active head: ${issueText(structural.issues)}` });
        continue;
      }
      if (!allowed.has(structural.value.packageId)) {
        dropped.push({ packageId: structural.value.packageId, reason: `not listed by head ${head.pin.snapshotId}` });
        continue;
      }
      validated.push(structural.value);
    }
    this.assemblies = validated;
    this.droppedAssemblyPackages = dropped;
    this.cellById = new Map(source.graph.cellReleases.map((entry) => [entry.cellReleaseId, entry]));
    this.evidenceById = new Map(source.graph.evidenceShards.map((entry) => [entry.shardId, entry]));
    this.baseIdentity = options.baseIdentity;
    this.fetchArtifact = options.fetchArtifact;
    this.cache = options.cache ?? new CitywideLruCache<Uint8Array>(EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries, EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes);
    this.sharedBudget = options.sharedBudget ?? null;
    this.pool = new CitywideRequestPool<Uint8Array>(EXTERIOR_RUNTIME_BUDGETS.maxConcurrentRequests, this.cache, this.sharedBudget);
  }

  /** Mirrors the accepted overlay compatibility gate; identity is not implied by name. */
  compatibleWith(baseReleaseId: string | null): boolean {
    return baseReleaseId !== null && this.index.baseCompatibility.baseReleaseIds.includes(baseReleaseId);
  }

  cellIds(): string[] {
    return this.snapshot.cells.map((entry) => entry.cellId).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  }

  getMetrics(): ExteriorRuntimeMetrics {
    return {
      cacheEntries: this.cache.size(),
      cachedBytes: this.cache.bytes(),
      cacheEvictions: this.cache.evictionCount(),
      maxCacheEntries: this.cache.maxEntries,
      maxCachedBytes: this.cache.maxBytes,
      activeRequests: this.sharedBudget?.activeCount() ?? this.pool.activeCount(),
      maxConcurrentRequests: this.sharedBudget?.maxConcurrent ?? this.pool.maxConcurrent,
      peakConcurrentRequests: this.sharedBudget?.peakConcurrency() ?? this.pool.peakConcurrency(),
      requestedArtifactCount: this.requestedArtifactCount,
      loadedArtifactCount: this.loadedArtifactCount,
      failedArtifactCount: this.failedArtifactCount,
      fallbackCellCount: this.fallbackCellCount,
      failedCellCount: this.failedCellCount,
      notShippedCellCount: this.notShippedCellCount,
    };
  }

  /**
   * `lodDistanceMeters` is the distance the LOD thresholds are evaluated
   * against. The app supplies a bucketed camera ellipsoid height as a proxy for
   * it; it is not a measured camera-to-asset distance.
   */
  async loadCell(cellId: string, profile: ExteriorRenderProfile, lodDistanceMeters: number, signal?: AbortSignal): Promise<ExteriorCellOutcome> {
    const mapping = this.snapshot.cells.find((entry) => entry.cellId === cellId);
    if (!mapping) {
      this.failedCellCount += 1;
      return { kind: "failed", cellId, cellReleaseId: "", code: "cell-missing", message: `Cell ${cellId} is not mapped by snapshot ${this.snapshot.snapshotId}.`, notice: `Exterior cell ${cellId} is not part of the active exterior snapshot; no exterior geometry is shown for it.` };
    }
    const cellRelease = this.cellById.get(mapping.cellReleaseId);
    if (!cellRelease) {
      this.failedCellCount += 1;
      return { kind: "failed", cellId, cellReleaseId: mapping.cellReleaseId, code: "cell-release-missing", message: `Cell release ${mapping.cellReleaseId} is absent from the public release graph.`, notice: `Exterior cell ${cellId} failed verification and no verified predecessor was available; no exterior geometry is shown for it.` };
    }
    // Bounded availability, decided before any fetch. A cell whose every owned
    // building is declared unavailable has nothing to verify, so treating an
    // empty render as a verification failure would assert a failure that did
    // not happen. It costs no request, no cache entry and no fallback.
    if (cellRelease.buildingDetails.length > 0 && cellRelease.buildingDetails.every((detail) => detail.status === "unavailable")) {
      this.notShippedCellCount += 1;
      return {
        kind: "not-shipped",
        cellId,
        cellReleaseId: cellRelease.cellReleaseId,
        unavailableBuildingCount: cellRelease.buildingDetails.length,
        notice: `Exterior cell ${cellId} ships no exterior geometry in this release; no substitute was selected.`,
      };
    }
    let headError: unknown;
    try {
      const assets = await this.verifyCellRelease(cellRelease, mapping.checksumSha256, profile, lodDistanceMeters, signal);
      return { kind: "rendered", cellId, cellReleaseId: cellRelease.cellReleaseId, cellReleaseVersion: cellRelease.version, assemblyPackageId: assets.assemblyPackageId, representation: "head", assets: assets.assets, notice: null };
    } catch (error) {
      if (isAbort(error)) throw error;
      headError = error;
    }
    const headMessage = headError instanceof Error ? headError.message : String(headError);
    const headCode = headError instanceof ExteriorRuntimeError ? headError.code : "glb-invalid";
    const fallback = cellRelease.fallback;
    if (fallback.mode === "pinned-base") {
      // Initial cell versions fall back to the pinned base identity set, which
      // carries no exterior geometry: the existing verified base/civic massing
      // stays exactly as it is. Never a fixture, never a same-name substitute.
      this.fallbackCellCount += 1;
      return {
        kind: "base-massing",
        cellId,
        cellReleaseId: cellRelease.cellReleaseId,
        code: headCode,
        message: headMessage,
        notice: `Exterior cell ${cellId} failed verification (${headCode}). Its pinned fallback is the base identity set ${fallback.baseIdentitySetId}, which carries no exterior geometry, so the existing verified base massing is shown for this cell.`,
      };
    }
    const predecessor = this.cellById.get(fallback.cellReleaseId);
    if (!predecessor) {
      this.failedCellCount += 1;
      return { kind: "failed", cellId, cellReleaseId: cellRelease.cellReleaseId, code: "cell-release-missing", message: `Pinned predecessor ${fallback.cellReleaseId} is absent from the public release graph.`, notice: `Exterior cell ${cellId} failed verification and its pinned predecessor could not be resolved; no exterior geometry is shown for it.` };
    }
    try {
      // Exactly one hop: the predecessor's own fallback is never followed.
      const assets = await this.verifyCellRelease(predecessor, fallback.checksumSha256, profile, lodDistanceMeters, signal);
      this.fallbackCellCount += 1;
      return {
        kind: "rendered",
        cellId,
        cellReleaseId: predecessor.cellReleaseId,
        cellReleaseVersion: predecessor.version,
        assemblyPackageId: assets.assemblyPackageId,
        representation: "predecessor",
        assets: assets.assets,
        notice: `Exterior cell ${cellId} failed verification (${headCode}); its checksum-pinned predecessor ${predecessor.cellReleaseId} (${predecessor.version}) is shown instead.`,
      };
    } catch (error) {
      if (isAbort(error)) throw error;
      this.failedCellCount += 1;
      const message = error instanceof Error ? error.message : String(error);
      return {
        kind: "failed",
        cellId,
        cellReleaseId: cellRelease.cellReleaseId,
        code: error instanceof ExteriorRuntimeError ? error.code : "glb-invalid",
        message: `${headMessage} Predecessor ${predecessor.cellReleaseId} also failed: ${message}`,
        notice: `Exterior cell ${cellId} and its checksum-pinned predecessor both failed verification; no exterior geometry is shown for this cell.`,
      };
    }
  }

  private assemblyForCell(cellRelease: ExteriorCellRelease, expectedCellReleaseChecksum: string): MultiLodAssemblyManifest {
    const ledger = this.graph.ownershipLedger;
    const ledgerArtifact = this.publicRoot.artifacts.find((artifact) => artifact.kind === "ownership-ledger" && artifact.logicalId === ledger.ledgerId);
    if (!ledgerArtifact) throw new ExteriorRuntimeError("graph-invalid", "The public root does not checksum-pin the ownership ledger.");
    const ownerCell = ledger.cells.find((entry) => entry.cellId === cellRelease.cellId);
    if (!ownerCell) throw new ExteriorRuntimeError("graph-invalid", `Cell ${cellRelease.cellId} is outside canonical ownership.`);
    const failures: string[] = [];
    const matches: MultiLodAssemblyManifest[] = [];
    // `this.assemblies` was structurally validated once at construction.
    for (const candidate of this.assemblies) {
      if (candidate.audience !== "public") { failures.push(`${candidate.packageId}: non-public assembly audience.`); continue; }
      if (candidate.release.rootId !== this.publicRoot.rootId || candidate.release.rootChecksumSha256 !== this.publicRoot.rootChecksumSha256 || candidate.release.releaseId !== this.publicRoot.releaseId || candidate.release.cityId !== ledger.cityId || candidate.release.configId !== ledger.configId) { failures.push(`${candidate.packageId}: release root pin mismatch.`); continue; }
      if (candidate.ownershipLedger.id !== ledger.ledgerId || candidate.ownershipLedger.checksumSha256 !== ledgerArtifact.checksumSha256) { failures.push(`${candidate.packageId}: ownership ledger pin mismatch.`); continue; }
      if (candidate.baseIdentitySet.id !== ledger.baseIdentitySet.id || candidate.baseIdentitySet.checksumSha256 !== ledger.baseIdentitySet.checksumSha256) { failures.push(`${candidate.packageId}: base identity pin mismatch.`); continue; }
      const cell = candidate.cells.find((entry) => entry.cellId === cellRelease.cellId);
      if (!cell) continue;
      if (cell.cellRelease.id !== cellRelease.cellReleaseId || cell.cellRelease.checksumSha256 !== expectedCellReleaseChecksum) { failures.push(`${candidate.packageId}: cell-release pin mismatch.`); continue; }
      if (cell.membershipChecksumSha256 !== ownerCell.membershipChecksumSha256) { failures.push(`${candidate.packageId}: cell membership checksum mismatch.`); continue; }
      const declared = [...cell.buildingIds].sort();
      const owned = [...ownerCell.buildingIds].sort();
      if (declared.length !== owned.length || declared.some((id, index) => id !== owned[index])) { failures.push(`${candidate.packageId}: cell membership mismatch.`); continue; }
      matches.push(candidate);
    }
    // Ambiguity is a pin failure, never a first-match-wins race against file order.
    if (matches.length > 1) throw new ExteriorRuntimeError("assembly-pin-mismatch", `Cell release ${cellRelease.cellReleaseId} is bound by more than one assembly package (${matches.map((entry) => entry.packageId).join(", ")}); the binding is ambiguous.`);
    if (matches.length === 1) return matches[0]!;
    throw new ExteriorRuntimeError("assembly-pin-mismatch", `No assembly package binds cell release ${cellRelease.cellReleaseId} to the active exterior release.${failures.length ? ` Rejected: ${failures.join(" | ")}` : ""}`);
  }

  private async verifyCellRelease(
    cellRelease: ExteriorCellRelease,
    expectedCellReleaseChecksum: string,
    profile: ExteriorRenderProfile,
    lodDistanceMeters: number,
    signal?: AbortSignal,
  ): Promise<{ assemblyPackageId: string; assets: ExteriorRenderedAsset[] }> {
    if (cellRelease.audience !== "public") throw new ExteriorRuntimeError("private-artifact-forbidden", `Cell release ${cellRelease.cellReleaseId} is not public.`);
    const declared = this.publicRoot.artifacts.find((artifact) => artifact.kind === "cell-release" && artifact.logicalId === cellRelease.cellReleaseId);
    if (!declared || declared.checksumSha256 !== expectedCellReleaseChecksum) throw new ExteriorRuntimeError("checksum-mismatch", `Cell release ${cellRelease.cellReleaseId} checksum does not match the pinned public root declaration.`);
    assertPublicExteriorArtifactRef(cellRelease.artifactRef);

    const assembly = this.assemblyForCell(cellRelease, expectedCellReleaseChecksum);
    const textureFree = requiresTextureFreeAssembly(assembly.audience);

    // Evidence-shard audience admission for every building this cell publishes.
    for (const detail of cellRelease.buildingDetails) {
      if (detail.status !== "available") continue;
      const shard = this.evidenceById.get(detail.evidenceShardId);
      if (!shard) throw new ExteriorRuntimeError("evidence-audience-forbidden", `Evidence shard ${detail.evidenceShardId} is absent for building ${detail.buildingId}.`);
      if (shard.audience !== "public") throw new ExteriorRuntimeError("private-artifact-forbidden", `Evidence shard ${detail.evidenceShardId} is not public.`);
      const admission = validateProjectedGraphAudience(shard.graph, { audience: "public", runtimeTexture: detail.runtimeTexture });
      if (!admission.ok) throw new ExteriorRuntimeError("evidence-audience-forbidden", `Evidence shard ${detail.evidenceShardId} is not admissible for the public audience: ${issueText(admission.issues)}`);
    }

    const available = new Map(cellRelease.buildingDetails.filter((detail) => detail.status === "available").map((detail) => [detail.buildingId, detail] as const));
    const cellAssets = assembly.assets.filter((asset) => asset.ownerCellId === cellRelease.cellId);
    const rendered: ExteriorRenderedAsset[] = [];
    for (const asset of [...cellAssets].sort((left, right) => (left.canonicalFeatureId < right.canonicalFeatureId ? -1 : left.canonicalFeatureId > right.canonicalFeatureId ? 1 : 0))) {
      const detail = available.get(asset.canonicalFeatureId);
      if (!detail) continue;
      if (!this.baseIdentity.has(asset.canonicalFeatureId)) throw new ExteriorRuntimeError("base-incompatible", `Exterior canonical feature ${asset.canonicalFeatureId} is not a member of the active base identity set (${this.baseIdentity.releaseId}).`);
      if (detail.inventoryId !== asset.inventoryId || detail.evidenceShardId !== asset.evidenceShardId) throw new ExteriorRuntimeError("assembly-pin-mismatch", `Assembly asset ${asset.canonicalFeatureId} cites inventory/evidence that the cell release does not publish.`);
      const lod = selectExteriorLod(asset.lods, profile, lodDistanceMeters);
      if (!lod) throw new ExteriorRuntimeError("lod-unavailable", `No eligible ${profile} LOD covers ${lodDistanceMeters}m for ${asset.canonicalFeatureId}.`);
      const artifact = assembly.artifacts.find((entry) => entry.relativeRef === lod.artifactRef);
      if (!artifact || artifact.role !== "glb" || artifact.ownerCellId !== cellRelease.cellId) throw new ExteriorRuntimeError("assembly-pin-mismatch", `LOD ${lod.lodId} has no owner-cell GLB declaration.`);
      const bytes = await this.loadVerifiedArtifact(artifact.relativeRef, artifact.byteSize, artifact.checksumSha256, signal);
      this.verifyGlb(bytes, asset, lod, textureFree, artifact.relativeRef);
      rendered.push({
        canonicalFeatureId: asset.canonicalFeatureId,
        ownerCellId: asset.ownerCellId,
        lodId: lod.lodId,
        artifactRef: artifact.relativeRef,
        byteSize: artifact.byteSize,
        checksumSha256: artifact.checksumSha256,
        bytes,
        geometricErrorMeters: lod.geometricErrorMeters,
        maxDistanceMeters: lod.maxDistanceMeters,
        provenance: {
          inventoryId: asset.inventoryId,
          inventoryHashSha256: asset.inventoryHashSha256,
          evidenceShardId: asset.evidenceShardId,
          truthTiers: [...asset.truthTiers],
          ...(asset.citedStyle ? { citedStyle: { ...asset.citedStyle } } : {}),
          sourceDates: { ...asset.sourceDates },
          predecessor: asset.predecessor,
          uncertainty: asset.uncertainty,
        },
      });
    }
    if (rendered.length === 0) throw new ExteriorRuntimeError("assembly-pin-mismatch", `Cell release ${cellRelease.cellReleaseId} published no verifiable exterior asset.`);
    return { assemblyPackageId: assembly.packageId, assets: rendered };
  }

  private verifyGlb(bytes: Uint8Array, asset: AssemblyAsset, lod: AssemblyLod, textureFree: boolean, relativeRef: string): void {
    try {
      validateGlbBinding(parseGlbV2(bytes), asset, lod, textureFree);
    } catch (error) {
      throw new ExteriorRuntimeError("glb-invalid", `Exterior GLB ${relativeRef} failed canonical binding: ${error instanceof Error ? error.message : String(error)}`, relativeRef);
    }
  }

  private async loadVerifiedArtifact(relativeRef: string, byteSize: number, expectedChecksum: string, signal?: AbortSignal): Promise<Uint8Array> {
    assertPublicExteriorArtifactRef(relativeRef);
    // A single artifact that cannot fit the cache budget is failed closed here
    // rather than thrown away inside the LRU, which would look like a network error.
    if (byteSize > this.cache.maxBytes) throw new ExteriorRuntimeError("artifact-exceeds-cache-budget", `Exterior artifact ${relativeRef} declares ${byteSize} bytes, which exceeds the ${this.cache.maxBytes} byte exterior cache budget.`, relativeRef);
    // Key on the declaration, not just the path: two declarations that share a
    // relative ref but pin different checksums must be verified independently,
    // and a cache hit must never serve bytes verified against a different pin.
    const cacheKey = `${relativeRef}#${expectedChecksum}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    this.requestedArtifactCount += 1;
    this.artifactErrors.delete(cacheKey);
    const value = await this.pool.load({
      key: cacheKey,
      loader: async (poolSignal) => {
        try {
          const bytes = await this.fetchArtifact(relativeRef, poolSignal);
          if (!(bytes instanceof Uint8Array)) throw new ExteriorRuntimeError("request-failed", `Exterior artifact ${relativeRef} did not return raw bytes.`, relativeRef);
          if (bytes.byteLength !== byteSize) throw new ExteriorRuntimeError("byte-size-mismatch", `Exterior artifact ${relativeRef} returned ${bytes.byteLength} bytes; ${byteSize} were declared.`, relativeRef);
          if (await sha256Hex(bytes) !== expectedChecksum) throw new ExteriorRuntimeError("checksum-mismatch", `Exterior artifact ${relativeRef} failed its declared SHA-256.`, relativeRef);
          return { value: bytes, bytes: bytes.byteLength };
        } catch (error) {
          if (!isAbort(error)) this.artifactErrors.set(cacheKey, error instanceof ExteriorRuntimeError ? error : new ExteriorRuntimeError("request-failed", error instanceof Error ? error.message : String(error), relativeRef));
          throw error;
        }
      },
    }, signal);
    if (value === undefined) {
      this.failedArtifactCount += 1;
      throw this.artifactErrors.get(cacheKey) ?? new ExteriorRuntimeError("request-failed", `Exterior artifact ${relativeRef} could not be loaded.`, relativeRef);
    }
    this.loadedArtifactCount += 1;
    return value;
  }
}

export function createExteriorCellRuntime(
  source: { index: unknown; graph: unknown; assemblies: unknown },
  request: ExteriorHeadRequest,
  options: ExteriorCellRuntimeOptions,
): { runtime: ExteriorCellRuntime; head: ExteriorHeadResolution } {
  const index = validateExteriorCellReleaseIndex(source.index);
  if (!index.ok) throw new ExteriorRuntimeError("index-invalid", `Exterior runtime index failed closed: ${issueText(index.issues)}`);
  const graph = validateExteriorReleaseGraph(source.graph);
  if (!graph.ok) throw new ExteriorRuntimeError("graph-invalid", `Exterior release graph failed closed: ${issueText(graph.issues)}`);
  if (!Array.isArray(source.assemblies) || source.assemblies.length === 0) throw new ExteriorRuntimeError("assembly-invalid", "At least one multi-LOD assembly package is required.");
  const head = resolveExteriorHead(index.value, request);
  // Structural validation of each package happens once inside the constructor,
  // which hard-fails only for packages the resolved head actually pins.
  const runtime = new ExteriorCellRuntime({ index: index.value, graph: graph.value, assemblies: source.assemblies }, head, options);
  return { runtime, head };
}

export type ExteriorRuntimeFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function normalizeExteriorBasePath(basePath: string): string {
  if (!basePath.startsWith("/data/") || !basePath.endsWith("/") || basePath.includes("..") || basePath.includes("\\")) throw new ExteriorRuntimeError("unsafe-artifact-ref", "The exterior runtime base path is not an approved local release root.");
  return basePath;
}

export interface LoadExteriorCellRuntimeOptions extends Omit<ExteriorCellRuntimeOptions, "fetchArtifact"> {
  fetcher?: ExteriorRuntimeFetcher;
  signal?: AbortSignal;
  request?: ExteriorHeadRequest;
}

/**
 * Local-only loader. Every request is a same-origin path under the approved
 * local release root; no code path here contacts a network provider.
 */
export async function loadExteriorCellRuntime(
  basePath: string,
  options: LoadExteriorCellRuntimeOptions,
): Promise<{ runtime: ExteriorCellRuntime; head: ExteriorHeadResolution }> {
  const root = normalizeExteriorBasePath(basePath);
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  const readJson = async (fileName: string): Promise<unknown> => {
    const response = await fetcher(`${root}${fileName}`, { signal: options.signal, cache: "no-store" });
    if (!response.ok) throw new ExteriorRuntimeError("request-failed", `Exterior runtime request failed (${response.status}) for ${root}${fileName}.`);
    return response.json();
  };
  const [index, graph, assemblies] = await Promise.all([readJson("index.json"), readJson("release-graph.json"), readJson("assemblies.json")]);
  const fetchArtifact: ExteriorArtifactFetcher = async (relativeRef, signal) => {
    const safeRef = assertPublicExteriorArtifactRef(relativeRef);
    const response = await fetcher(`${root}${safeRef}`, { signal, cache: "no-store" });
    if (!response.ok) throw new ExteriorRuntimeError("request-failed", `Exterior artifact request failed (${response.status}) for ${safeRef}.`, safeRef);
    return new Uint8Array(await response.arrayBuffer());
  };
  return createExteriorCellRuntime({ index, graph, assemblies }, options.request ?? { kind: "default" }, {
    fetchArtifact,
    baseIdentity: options.baseIdentity,
    sharedBudget: options.sharedBudget,
    cache: options.cache,
  });
}
