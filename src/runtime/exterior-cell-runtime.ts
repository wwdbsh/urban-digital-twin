import { validateProjectedGraphAudience } from "../domain/exterior-evidence-intake.ts";
import { CitywideLruCache, CitywideRequestPool } from "../release/citywide-release.ts";
import {
  assemblyCellCoverage,
  parseGlbV2,
  publiclyAdmittedSamplerFilter,
  replaySharedTextureArtifact,
  requiresTextureFreeAssembly,
  validateGlbBinding,
  validateMultiLodAssembly,
  type AssemblyAsset,
  type AssemblyCitedStyle,
  type AssemblyLod,
  type ComponentTruthTier,
  type ImmutablePin,
  type MultiLodAssemblyManifest,
  type SharedTextureContext,
} from "../release/multi-lod-assembly.ts";
import {
  exteriorTextureAdmissionPolicyOf,
  validateExteriorCellDetailSidecar,
  validateExteriorReleaseGraph,
  type ExteriorCellRelease,
  type ExteriorEvidenceShard,
  type ExteriorOwnershipCell,
  type ExteriorReleaseGraph,
  type ExteriorRolloutSnapshot,
  type ExteriorRootManifest,
  type ExteriorTextureAdmissionPolicy,
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
 *
 * ## `maxCacheEntries` was RAISED from 256 to 512 on 2026-08-12 (T018)
 *
 * This is a runtime contract change, not a nudge, and it is recorded as ADR
 * 0034's **admissible response 1** — "raise `EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries`
 * and re-measure the byte ceiling and the frame budgets against the raised cap".
 * ADR 0034 named three responses and required that whichever is taken be
 * recorded by number; ADR 0035 precondition (a) repeated the requirement for
 * this promotion. The other two were available and were not taken: response 2
 * (re-cut a promoted wave's renderable subset) buys entries by withdrawing
 * geometry that is already promoted and verified, and response 3 (count what the
 * runtime resolves rather than what is on disk) recovers only the 14 entries of
 * Block 835's second-LOD conservatism and requires proving a per-camera worst
 * case, which is a harder claim than the per-release one this pipeline makes.
 *
 * Three quantities changed, and only one of them is this constant:
 *
 * 1. **Entries.** Three promoted waves occupy 255 of the old 256 by the
 *    release-time disk derivation (28 + 156 + 71). A fourth wave could not
 *    promote at all. 512 restores usable headroom without becoming a number
 *    nobody sized: it is one doubling, it is stated as a contract, and every
 *    derivation that reads it re-derives rather than remembering.
 * 2. **Bytes.** `maxCachedBytes` is deliberately UNCHANGED at 256 MiB. The byte
 *    ceiling was re-derived at the raised cap from the promoted waves' own
 *    committed inventories — see `exterior-cache-ceiling.ts`, which computes it
 *    rather than asserting it — and bytes remain non-binding for the promoted
 *    composition by a wide margin. Because bytes did not move, the byte cap is
 *    still a live backstop: a composition whose assets were far heavier than
 *    today's would evict on bytes before it reached 512 entries, and that is the
 *    intended behaviour rather than an oversight.
 * 3. **Blast radius of the ADR 0030 disclosure.** Eviction here is recency-only
 *    with NO per-wave reservation. That disclosure still holds unchanged, and
 *    raising the entry cap WIDENS it: more waves can be co-resident, so more
 *    waves can evict each other's already-verified bytes under camera pressure.
 *    Nothing renders wrongly when that happens — every re-fetch is re-verified
 *    against its pin — but the cost stays invisible in the current metrics.
 *    `EXTERIOR_CACHE_EVICTION_DISCLOSURE` carries the statement in code.
 *
 * Frame budgets were re-measured with this raised cap in force; the acceptance
 * evidence records `runtimeBudgets` from this object rather than from a constant
 * typed into the measurement, so a reading taken at the old cap cannot be
 * presented as a reading at the new one.
 */
/**
 * How long the SHARED CLASS TILES of one release may take to verify.
 *
 * It exists because the tiles are deliberately uncancellable (see
 * `sharedTextureLifetime`), and uncancellable plus untimed is a hang: a request
 * that never settles leaves the memoized promise pending forever, and every
 * later cell load of that package awaits it forever. The wave never publishes,
 * nothing clears it, and no notice is ever produced — the worst failure shape
 * this runtime has, because it looks like nothing happening.
 *
 * 30 s is generous rather than tuned, and it is allowed to be: these are four
 * same-origin static files of about 16 KB from the local release root. Anything
 * approaching this bound is a broken environment, not a slow one. The timeout is
 * a typed failure rather than an abort, so a cell that hits it fails CLOSED with
 * a notice instead of being mistaken for a cancelled batch, and the rejection is
 * not memoized so a later load retries.
 */
export const EXTERIOR_SHARED_TEXTURE_TIMEOUT_MS = 30_000;

export const EXTERIOR_RUNTIME_BUDGETS = {
  maxCacheEntries: 512,
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
  /**
   * A release that DECLARES shared class tiles could not put verified tile
   * bytes in front of the GLBs that draw them.
   *
   * It is its own code rather than `glb-invalid` because the GLB is not what
   * failed: the geometry may verify perfectly while the tile it references is
   * absent, mis-checksummed, or not what this repository's rasterizer produces.
   * Reporting that as a GLB fault would send an operator to the wrong artifact.
   */
  "shared-texture-invalid",
  /**
   * A release that shards its per-cell evidence into a fetched document could
   * not put a verified, cell-bound sidecar in front of that cell's geometry.
   *
   * Its own code for the same reason `shared-texture-invalid` is: neither the
   * cell release nor any GLB is what failed. The geometry may verify perfectly
   * while the document carrying the cell's inventory and evidence is absent,
   * mis-checksummed, or bound to a different cell — and reporting that as
   * `graph-invalid` would send an operator to `release-graph.json`, which is
   * exactly the artifact that is fine.
   */
  "cell-detail-sidecar-invalid",
  /**
   * A release that shards its per-cell ASSEMBLY into a fetched document could
   * not put a verified, cell-bound package in front of that cell's geometry.
   *
   * Distinct from `assembly-invalid`, which is the boot-time refusal of an
   * inline package, and from `assembly-pin-mismatch`, which is a package that
   * parsed but does not bind this cell. This code means the document carrying
   * the package is absent, mis-checksummed or not a conforming assembly at all —
   * so an operator is sent to the sharded artifact rather than to
   * `assemblies.json`, which for a sharded release is nearly empty and fine.
   */
  "cell-assembly-package-invalid",
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

/**
 * Everything the scene needs to draw ONE asset of a release that ships its
 * detail tiles as shared, release-scoped artifacts instead of embedding a copy
 * of each tile in every GLB.
 *
 * Present only on such a release. Its absence is the ordinary case and means
 * the asset carries whatever images it carries inside its own bytes, which is
 * every release frozen before this seam existed.
 *
 * The runtime hands over BYTES and a URL and stops there. It does not build a
 * Cesium object, because CesiumJS ownership lives in the viewport; and it does
 * not hand over a path for the scene to fetch, because a fetched path would be
 * bytes nobody verified. Both halves here are already verified: the GLB against
 * its pinned checksum and canonical binding, each tile against its pinned
 * checksum AND against `procedural-texture.ts`'s rasterizer.
 */
export interface ExteriorSharedTextureBinding {
  /**
   * The URL this artifact's bytes are served under, and the reason it exists.
   *
   * Cesium keys a model's embedded buffers on the OWNING MODEL's absolute URL
   * (`ResourceCacheKey.getEmbeddedBufferCacheKey`), so two models sharing one
   * URL share one buffer cache entry and the second silently renders the
   * first's BIN. The URL therefore has to be UNIQUE PER ARTIFACT, and the
   * release-relative artifact path already is: it is the same path the bytes
   * were fetched and verified from.
   */
  modelUrl: string;
  /** This GLB's package-relative ref; its image URIs resolve against it. */
  glbRef: string;
  /**
   * The verified tiles this GLB draws, keyed by the URL each one resolves to
   * from `modelUrl`. Sharing is the whole point: every asset of a class hands
   * over the SAME url and the SAME `Uint8Array`, so Cesium's image cache — keyed
   * on the resolved absolute URI — collapses them to one decoded GPU texture.
   */
  textureUrls: ReadonlyMap<string, Uint8Array>;
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
  /** Present only for a release that declares shared texture artifacts. */
  sharedTextures?: ExteriorSharedTextureBinding;
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
  /**
   * Cells the most recent reconciliation asked this runtime to load.
   *
   * A new counter rather than a re-reading of `notShippedCellCount` or
   * `failedCellCount`, which mean what they have always meant: a cell the
   * RELEASE declares empty, and a cell whose load FAILED. A deferred cell is
   * neither — it is a cell nobody asked for yet. Conflating the three would make
   * every existing exterior notice count a scheduling decision as a defect.
   *
   * On the default path the app records every declared cell as scheduled and
   * none as deferred, so the pair reads as "no scheduler ran" rather than as
   * zeroes of unknown meaning.
   */
  scheduledCellCount: number;
  /** Cells the most recent reconciliation withheld. Zero unless the scheduler flag is on. */
  deferredCellCount: number;
  /**
   * Artifacts the SESSION's cache release seam has freed, and their declared
   * bytes.
   *
   * Session-wide, not per wave — exactly like `cacheEntries` and `cachedBytes`,
   * which read the shared cache instance every promoted wave writes into. The
   * app sets the same session totals on every live runtime, so a reader must
   * take these from one wave and never sum them, on pain of multiplying one
   * pool by the number of promotions.
   *
   * Both stay 0 for a session without the scheduler flag: the seam only ever
   * releases what a scheduler eviction dropped, and an unflagged session drops
   * nothing.
   */
  releasedArtifactCount: number;
  releasedArtifactBytes: number;
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
  /**
   * The local release root every artifact ref is served under, used ONLY to
   * build the unique per-artifact URLs a shared-texture release needs.
   *
   * It is the same root `loadExteriorCellRuntime` fetches from, passed
   * explicitly rather than reconstructed, so the URL an artifact is identified
   * by and the URL its bytes came from cannot drift apart. It is never fetched
   * from here: nothing in the shared-texture path issues a request.
   */
  artifactUrlBase?: string;
  /** Test seam for `EXTERIOR_SHARED_TEXTURE_TIMEOUT_MS`; the default is the contract. */
  sharedTextureTimeoutMs?: number;
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

/**
 * The exterior cache key, in the ONE place that may derive it.
 *
 * Keyed on the DECLARATION and not just the path: two declarations that share a
 * relative ref but pin different checksums must be verified independently, and a
 * cache hit must never serve bytes verified against a different pin.
 *
 * It is exported because T003 gave the cache a release seam, and a release that
 * derived its own key would delete nothing the moment either side changed the
 * format. The loader writes with this function and the release plan reads with
 * it, so the two cannot drift; `exterior-cache-release.test.ts` pins that the key
 * a rendered asset resolves to is the key its bytes were stored under.
 */
export function exteriorArtifactCacheKey(relativeRef: string, checksumSha256: string): string {
  return `${relativeRef}#${checksumSha256}`;
}

/**
 * The cache keys and declared bytes a settled outcome is holding.
 *
 * Only a `rendered` outcome holds bytes at all: `base-massing`, `failed` and
 * `not-shipped` fetched nothing, so they have nothing to release, and returning
 * an empty result for them is a fact rather than a default.
 */
export function exteriorOutcomeCacheKeys(outcome: ExteriorCellOutcome): { keys: string[]; byteSize: number } {
  if (outcome.kind !== "rendered") return { keys: [], byteSize: 0 };
  const keys: string[] = [];
  let byteSize = 0;
  for (const asset of outcome.assets) {
    const key = exteriorArtifactCacheKey(asset.artifactRef, asset.checksumSha256);
    if (keys.includes(key)) continue;
    keys.push(key);
    byteSize += asset.byteSize;
  }
  return { keys, byteSize };
}

/**
 * The refs of every RELEASE-SCOPED shared tile a package declares.
 *
 * A non-empty result is the single fact that selects the shared-texture image
 * gate for every GLB in the package, which is how the runtime and the offline
 * validator reach the same decision from the same evidence.
 */
export function sharedTextureArtifactRefs(assembly: MultiLodAssemblyManifest): ReadonlySet<string> {
  return new Set(assembly.artifacts.filter((artifact) => artifact.role === "texture").map((artifact) => artifact.relativeRef));
}

export class ExteriorCellRuntime {
  readonly index: ExteriorCellReleaseIndex;
  readonly head: ExteriorHeadResolution;
  readonly snapshot: ExteriorRolloutSnapshot;
  readonly releaseId: string;
  readonly origin: "default" | "canary";
  private readonly graph: ExteriorReleaseGraph;
  private readonly publicRoot: ExteriorRootManifest;
  /**
   * The active release's texture admission, read ONCE from the public root and
   * threaded to every site that used to derive texture-freeness from
   * `audience === "public"` on its own.
   *
   * On "pinned", precisely: the root DECLARES `rootChecksumSha256`, and the
   * runtime enforces string equality between that declaration and each assembly
   * package's `release.rootChecksumSha256`, so a package cannot bind to a root
   * whose declaration differs. It does NOT recompute the root's digest from the
   * root's own bytes at load time; that is pre-existing behaviour for every
   * field on this manifest, not something this field introduces.
   *
   * That independent derivation was the real problem. The assembly validator had
   * a policy parameter; the runtime had none and simply decided for itself, so a
   * seam opened in the validator alone would have changed nothing here — the
   * runtime would have kept refusing, and the refusal would have looked like a
   * bug rather than a policy. Reading it here, from the release, is what makes
   * the admission one decision instead of two agreeing by luck.
   */
  readonly textureAdmission: ExteriorTextureAdmissionPolicy;
  /**
   * The sampler pair the active release's generated-texture fact declares, or
   * null when nothing textured is admitted. Read from the release rather than
   * defaulted here, so the bytes are checked against what THIS release says.
   */
  private readonly declaredSamplerFilter: { magFilter: number; minFilter: number } | undefined;
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
  /**
   * SESSION-scoped shared-tile verification, one entry per assembly package.
   *
   * A release's four class tiles are the same four bytes for every one of its
   * cells, so verifying them per cell would replay the rasterizer hundreds of
   * times for an answer that cannot differ. Memoizing the PROMISE also
   * collapses the concurrent case: several cells loading at once await one
   * verification rather than racing four fetches each.
   *
   * A rejection is deliberately NOT memoized (see `verifiedSharedTextures`):
   * an abort or a transport failure is not evidence about the bytes, and a
   * session that cached it would refuse the release forever on the strength of
   * a cancelled request.
   */
  private readonly sharedTextureVerification = new Map<string, Promise<ReadonlyMap<string, Uint8Array>>>();
  /**
   * The signal the shared tiles are fetched under, owned by the RUNTIME and not
   * by whichever batch happened to ask first.
   *
   * This is the fix for a real defect, and the defect is worth stating because
   * the shape recurs. `CitywideRequestPool` rejects EACH caller's await when
   * THAT caller's signal aborts. A memoized promise created under batch 1's
   * signal is therefore a promise batch 2 can be handed and then have aborted
   * out from under it: a height-bucket change abandons batch 1, batch 2 receives
   * batch 1's `AbortError`, `loadCell` re-throws it as an abort, and the wave's
   * outcomes are deleted — the wave blanks with NO NOTICE until residency moves
   * again. Serialised batches hide it, because a rejected verification is
   * forgotten and simply re-runs; it only appears while two batches overlap,
   * which is the ordinary case under a moving camera.
   *
   * Making the tiles uncancellable is a deliberate, bounded choice rather than
   * an oversight: they are four artifacts of about 16 KB, every cell of the
   * release needs them, and a camera move that abandons one batch does not make
   * them less needed. Nothing aborts this controller today — the app drops a
   * runtime rather than disposing it — so it is a scope marker, not a live
   * cancellation path, and it is named that way rather than pretending to more.
   */
  private readonly sharedTextureLifetime = new AbortController();
  private readonly artifactUrlBase: string;
  private readonly sharedTextureTimeoutMs: number;
  private requestedArtifactCount = 0;
  private loadedArtifactCount = 0;
  private failedArtifactCount = 0;
  private fallbackCellCount = 0;
  private failedCellCount = 0;
  private notShippedCellCount = 0;
  private scheduledCellCount = 0;
  private deferredCellCount = 0;
  private releasedArtifactCount = 0;
  private releasedArtifactBytes = 0;
  private declaredNotShippedCellCountCache: number | null = null;

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
    // Fail-closed: absent, unknown or malformed all read as texture-free.
    const textureAdmission = exteriorTextureAdmissionPolicyOf(publicRoot);
    this.textureAdmission = textureAdmission;
    const declaredSamplerFilter = publicRoot.textureAdmission?.generatedTextureFact?.samplerFilter;
    this.declaredSamplerFilter = declaredSamplerFilter ? { ...declaredSamplerFilter } : undefined;
    const assemblyPolicy = { textureAdmission };
    // Only packages the resolved head actually pins are hard-validated. A
    // canary-only package that is invalid must not disable the default head.
    const allowed = new Set(head.pin.assemblyPackageIds);
    const validated: MultiLodAssemblyManifest[] = [];
    const dropped: ExteriorDroppedAssemblyPackage[] = [];
    for (const [position, candidate] of source.assemblies.entries()) {
      const declaredId = (candidate as { packageId?: unknown } | null)?.packageId;
      const label = typeof declaredId === "string" && declaredId.length > 0 ? declaredId : `<unidentified assembly [${position}]>`;
      const structural = validateMultiLodAssembly(candidate, assemblyPolicy);
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
    // Defaulted rather than required: every caller that does not ship shared
    // tiles is unaffected, and the default is exactly what the app computes
    // (`exteriorCellBasePath`) so the two cannot disagree for a real release.
    this.artifactUrlBase = options.artifactUrlBase ?? `/data/${source.index.releaseId}/`;
    this.sharedTextureTimeoutMs = options.sharedTextureTimeoutMs ?? EXTERIOR_SHARED_TEXTURE_TIMEOUT_MS;
  }

  /** Mirrors the accepted overlay compatibility gate; identity is not implied by name. */
  compatibleWith(baseReleaseId: string | null): boolean {
    return baseReleaseId !== null && this.index.baseCompatibility.baseReleaseIds.includes(baseReleaseId);
  }

  cellIds(): string[] {
    return this.snapshot.cells.map((entry) => entry.cellId).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  }

  /**
   * Record what the caller's most recent residency reconciliation decided.
   *
   * The runtime does not schedule and must not start: it is handed the two
   * numbers so `getMetrics()` can report them beside the request counters they
   * explain. Purely additive — nothing else in the runtime reads them.
   */
  noteCellSchedule(scheduledCellCount: number, deferredCellCount: number): void {
    this.scheduledCellCount = scheduledCellCount;
    this.deferredCellCount = deferredCellCount;
  }

  /**
   * Record the SESSION-wide cache release totals so `getMetrics()` reports them
   * beside the residency they explain. The runtime does not release and must not
   * start: the seam lives in the app, which owns the shared cache instance.
   */
  noteArtifactRelease(releasedArtifactCount: number, releasedArtifactBytes: number): void {
    this.releasedArtifactCount = releasedArtifactCount;
    this.releasedArtifactBytes = releasedArtifactBytes;
  }

  /**
   * The RELEASE-scoped not-shipped count: how many of this release's declared
   * cells would return `not-shipped`, decided over the whole snapshot and not
   * over whatever the current camera happened to reconcile.
   *
   * It exists because `notShippedCellCount` is camera-scoped by construction —
   * it counts the cells `loadCell` was actually asked about — and pairing a
   * camera-scoped numerator with a release-scoped denominator produces a
   * sentence that is false in both directions ("11 of 149" at a street camera
   * for a release that declares 146 of its 149 cells empty).
   *
   * Costs no request: the same `buildingDetails` the not-shipped branch reads
   * are already resident in the verified release graph, so this is the same
   * decision evaluated over every declared cell instead of one.
   */
  declaredNotShippedCellCount(): number {
    if (this.declaredNotShippedCellCountCache !== null) return this.declaredNotShippedCellCountCache;
    let count = 0;
    for (const mapping of this.snapshot.cells) {
      const cellRelease = this.cellById.get(mapping.cellReleaseId);
      if (!cellRelease) continue;
      if (cellRelease.buildingDetails.length > 0 && cellRelease.buildingDetails.every((detail) => detail.status === "unavailable")) count += 1;
    }
    this.declaredNotShippedCellCountCache = count;
    return count;
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
      scheduledCellCount: this.scheduledCellCount,
      deferredCellCount: this.deferredCellCount,
      releasedArtifactCount: this.releasedArtifactCount,
      releasedArtifactBytes: this.releasedArtifactBytes,
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

  /**
   * The binding one assembly package must satisfy to be this cell's package.
   *
   * Extracted so the in-`assemblies.json` form and the fetched
   * `cell-assembly-package` form reach the IDENTICAL rules through the same
   * code. A rule tightened for one form and forgotten for the other would mean a
   * serving release admitted on weaker terms than a curated one, which is the
   * exact failure the sharded form must not introduce.
   *
   * Returns `null` when the candidate simply does not cover this cell — which is
   * not a failure, it is another cell's package — and a message otherwise.
   */
  private assemblyBindingFailure(
    candidate: MultiLodAssemblyManifest,
    cellRelease: ExteriorCellRelease,
    expectedCellReleaseChecksum: string,
    ownerCell: ExteriorOwnershipCell,
    ledgerArtifactChecksum: string,
  ): { covers: false } | { covers: true; failure: string | null } {
    const ledger = this.graph.ownershipLedger;
    if (candidate.audience !== "public") return { covers: true, failure: `${candidate.packageId}: non-public assembly audience.` };
    if (candidate.release.rootId !== this.publicRoot.rootId || candidate.release.rootChecksumSha256 !== this.publicRoot.rootChecksumSha256 || candidate.release.releaseId !== this.publicRoot.releaseId || candidate.release.cityId !== ledger.cityId || candidate.release.configId !== ledger.configId) return { covers: true, failure: `${candidate.packageId}: release root pin mismatch.` };
    if (candidate.ownershipLedger.id !== ledger.ledgerId || candidate.ownershipLedger.checksumSha256 !== ledgerArtifactChecksum) return { covers: true, failure: `${candidate.packageId}: ownership ledger pin mismatch.` };
    if (candidate.baseIdentitySet.id !== ledger.baseIdentitySet.id || candidate.baseIdentitySet.checksumSha256 !== ledger.baseIdentitySet.checksumSha256) return { covers: true, failure: `${candidate.packageId}: base identity pin mismatch.` };
    const cell = candidate.cells.find((entry) => entry.cellId === cellRelease.cellId);
    if (!cell) return { covers: false };
    if (cell.cellRelease.id !== cellRelease.cellReleaseId || cell.cellRelease.checksumSha256 !== expectedCellReleaseChecksum) return { covers: true, failure: `${candidate.packageId}: cell-release pin mismatch.` };
    // Coverage, not equality. The package may ship geometry for a strict
    // SUBSET of the owned cell, and only if every building it leaves out is
    // one this cell release explicitly declares unavailable with a reason.
    // That is the anti-silent-omission property the old exact-equality rule
    // was written for, stated as what it always meant; a cell containing a
    // building the grammar refuses had no legal form under equality.
    const coverage = assemblyCellCoverage({
      packagedBuildingIds: cell.buildingIds,
      ownedBuildingIds: ownerCell.buildingIds,
      unavailableBuildingIds: cellRelease.buildingDetails.filter((detail) => detail.status === "unavailable").map((detail) => detail.buildingId),
      declaredMembershipChecksumSha256: cell.membershipChecksumSha256,
    });
    if (!coverage.ok) return { covers: true, failure: `${candidate.packageId}: ${coverage.message}` };
    return { covers: true, failure: null };
  }

  /**
   * This cell's assembly package, from wherever the release puts it.
   *
   * The sharded branch mirrors `cellEvidenceShards` exactly, for the same reason
   * and on the same path: one `loadVerifiedArtifact` fetch, then the SAME
   * structural validation the constructor applies to an inline package and the
   * SAME binding every inline package must satisfy. What moves is when it runs,
   * not how strictly; see the `cell-assembly-package` docblock in
   * `exterior-release.ts` and ADR 0052 §2.
   *
   * The head pin still governs. A sharded package whose `packageId` the active
   * head does not list is refused here exactly as an inline one is dropped at
   * construction, so the head remains the single statement of what this release
   * serves.
   */
  private async assemblyForCell(cellRelease: ExteriorCellRelease, expectedCellReleaseChecksum: string, signal?: AbortSignal): Promise<MultiLodAssemblyManifest> {
    const ledger = this.graph.ownershipLedger;
    const ledgerArtifact = this.publicRoot.artifacts.find((artifact) => artifact.kind === "ownership-ledger" && artifact.logicalId === ledger.ledgerId);
    if (!ledgerArtifact) throw new ExteriorRuntimeError("graph-invalid", "The public root does not checksum-pin the ownership ledger.");
    const ownerCell = ledger.cells.find((entry) => entry.cellId === cellRelease.cellId);
    if (!ownerCell) throw new ExteriorRuntimeError("graph-invalid", `Cell ${cellRelease.cellId} is outside canonical ownership.`);

    const sharded = this.publicRoot.artifacts.find((artifact) => artifact.kind === "cell-assembly-package" && artifact.logicalId === cellRelease.cellReleaseId);
    if (sharded) {
      const bytes = await this.loadVerifiedArtifact(sharded.relativeRef, sharded.byteSize, sharded.checksumSha256, signal);
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(bytes));
      } catch (error) {
        throw new ExteriorRuntimeError("cell-assembly-package-invalid", `Exterior cell assembly package ${sharded.relativeRef} is not parseable JSON: ${error instanceof Error ? error.message : String(error)}`, sharded.relativeRef);
      }
      const structural = validateMultiLodAssembly(parsed, { textureAdmission: this.textureAdmission });
      if (!structural.ok) throw new ExteriorRuntimeError("cell-assembly-package-invalid", `Exterior cell assembly package ${sharded.relativeRef} failed closed: ${issueText(structural.issues)}`, sharded.relativeRef);
      const candidate = structural.value;
      if (!this.head.pin.assemblyPackageIds.includes(candidate.packageId)) throw new ExteriorRuntimeError("assembly-pin-mismatch", `Assembly package ${candidate.packageId} is not listed by head ${this.head.pin.snapshotId}.`, sharded.relativeRef);
      const bound = this.assemblyBindingFailure(candidate, cellRelease, expectedCellReleaseChecksum, ownerCell, ledgerArtifact.checksumSha256);
      if (!bound.covers) throw new ExteriorRuntimeError("assembly-pin-mismatch", `Assembly package ${candidate.packageId} is declared for cell release ${cellRelease.cellReleaseId} but packages no such cell.`, sharded.relativeRef);
      if (bound.failure) throw new ExteriorRuntimeError("assembly-pin-mismatch", `Assembly package ${candidate.packageId} does not bind cell release ${cellRelease.cellReleaseId}: ${bound.failure}`, sharded.relativeRef);
      return candidate;
    }

    const failures: string[] = [];
    const matches: MultiLodAssemblyManifest[] = [];
    // `this.assemblies` was structurally validated once at construction.
    for (const candidate of this.assemblies) {
      const bound = this.assemblyBindingFailure(candidate, cellRelease, expectedCellReleaseChecksum, ownerCell, ledgerArtifact.checksumSha256);
      if (!bound.covers) continue;
      if (bound.failure) { failures.push(bound.failure); continue; }
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

    const assembly = await this.assemblyForCell(cellRelease, expectedCellReleaseChecksum, signal);
    const assemblyPolicy = { textureAdmission: this.textureAdmission, ...(this.declaredSamplerFilter ? { declaredSamplerFilter: this.declaredSamplerFilter } : {}) };
    const textureFree = requiresTextureFreeAssembly(assembly.audience, assemblyPolicy);
    // Under a public procedural-replay admission the shipped samplers must name
    // the declared pair; null everywhere else, so nothing already admitted moves.
    const requiredSamplerFilter = publiclyAdmittedSamplerFilter(assembly.audience, assemblyPolicy);

    // Which image gate applies is decided by the PACKAGE, exactly as it is
    // offline in `replayMultiLodAssembly`: a package that declares texture
    // artifacts is gated by the shared-texture rule, and one that declares none
    // parses under the byte-identical embedded-only rule it always did. A GLB
    // cannot elect its own gate by what its bytes happen to contain.
    //
    // The verification is awaited BEFORE any GLB of this cell is admitted, so a
    // cell of a texture-declaring release whose class tiles are unverified
    // fails closed as a cell rather than rendering untextured.
    const declaredTextureRefs = sharedTextureArtifactRefs(assembly);
    const verifiedTextures = declaredTextureRefs.size > 0 ? await this.verifiedSharedTextures(assembly) : null;

    // Where this cell's inventory and evidence shards live. A release that
    // declares a sidecar for this cell resolves them from that fetched, verified
    // document; every release frozen before the seam existed resolves them from
    // the boot graph exactly as it always did.
    const evidenceById = await this.cellEvidenceShards(cellRelease, signal);

    // Evidence-shard audience admission for every building this cell publishes.
    for (const detail of cellRelease.buildingDetails) {
      if (detail.status !== "available") continue;
      const shard = evidenceById.get(detail.evidenceShardId);
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
      const sharedTextureContext: SharedTextureContext | null = verifiedTextures
        ? { glbRef: artifact.relativeRef, audience: assembly.audience, declaredTextureRefs }
        : null;
      const referencedTextureRefs = this.verifyGlb(bytes, asset, lod, textureFree, artifact.relativeRef, requiredSamplerFilter, sharedTextureContext);
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
        ...(verifiedTextures ? { sharedTextures: this.sharedTextureBinding(artifact.relativeRef, referencedTextureRefs, verifiedTextures) } : {}),
      });
    }
    if (rendered.length === 0) throw new ExteriorRuntimeError("assembly-pin-mismatch", `Cell release ${cellRelease.cellReleaseId} published no verifiable exterior asset.`);
    return { assemblyPackageId: assembly.packageId, assets: rendered };
  }

  /**
   * This cell's evidence shards, from wherever the release puts them.
   *
   * The sidecar branch is one fetch on the SAME verified path as every GLB —
   * `loadVerifiedArtifact` enforces the public-root ref check, the declared byte
   * size and the declared SHA-256 before a byte is parsed — followed by the same
   * per-building binding `validateExteriorReleaseGraph` performs at boot for an
   * in-graph release. Nothing is checked more weakly because it arrived later.
   *
   * The sidecar occupies a cache entry and its bytes count against the byte cap,
   * which is a real cost and is measured rather than waved past: see
   * `exterior-cache-ceiling.ts`, where the residency derivation counts one
   * sidecar per resident cell alongside that cell's assets.
   */
  private async cellEvidenceShards(cellRelease: ExteriorCellRelease, signal?: AbortSignal): Promise<ReadonlyMap<string, ExteriorEvidenceShard>> {
    const declared = this.publicRoot.artifacts.find((artifact) => artifact.kind === "cell-detail-sidecar" && artifact.logicalId === cellRelease.cellReleaseId);
    if (!declared) return this.evidenceById;
    const bytes = await this.loadVerifiedArtifact(declared.relativeRef, declared.byteSize, declared.checksumSha256, signal);
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch (error) {
      throw new ExteriorRuntimeError("cell-detail-sidecar-invalid", `Exterior cell detail sidecar ${declared.relativeRef} is not parseable JSON: ${error instanceof Error ? error.message : String(error)}`, declared.relativeRef);
    }
    const validation = validateExteriorCellDetailSidecar(parsed, { cell: cellRelease, artifactRef: declared.relativeRef });
    if (!validation.ok) throw new ExteriorRuntimeError("cell-detail-sidecar-invalid", `Exterior cell detail sidecar ${declared.relativeRef} failed closed: ${issueText(validation.issues)}`, declared.relativeRef);
    return new Map(validation.value.evidenceShards.map((shard) => [shard.shardId, shard]));
  }

  /**
   * Repeats, in the browser, the exact binding the offline validator applied.
   *
   * The returned set names the shared texture artifacts this GLB actually
   * draws, and is empty for every embedded, texture-free and untextured GLB —
   * so a caller that ignores it sees precisely the behaviour it saw when this
   * returned void.
   */
  private verifyGlb(bytes: Uint8Array, asset: AssemblyAsset, lod: AssemblyLod, textureFree: boolean, relativeRef: string, requiredSamplerFilter: { magFilter: number; minFilter: number } | null = null, sharedTextures: SharedTextureContext | null = null): ReadonlySet<string> {
    try {
      // The opt-in is derived from the same package fact that produced the
      // context, so a package declaring no texture artifact parses under the
      // byte-identical rule it always did.
      const parsed = parseGlbV2(bytes, { allowExternalImageUri: sharedTextures !== null });
      return validateGlbBinding(parsed, asset, lod, textureFree, requiredSamplerFilter, sharedTextures);
    } catch (error) {
      throw new ExteriorRuntimeError("glb-invalid", `Exterior GLB ${relativeRef} failed canonical binding: ${error instanceof Error ? error.message : String(error)}`, relativeRef);
    }
  }

  /**
   * Verify every class tile this package declares, once for the session.
   *
   * The tiles go through the SAME verified-artifact path every GLB does —
   * declared byte size, declared SHA-256, the shared LRU and the shared request
   * budget — and then through the rasterizer replay that is the honesty claim
   * itself. Nothing here is a weaker check applied to a smaller artifact.
   */
  private async verifiedSharedTextures(assembly: MultiLodAssemblyManifest): Promise<ReadonlyMap<string, Uint8Array>> {
    const memoized = this.sharedTextureVerification.get(assembly.packageId);
    if (memoized) return memoized;
    // Deliberately NOT the caller's signal; see `sharedTextureLifetime`.
    const pending = this.loadSharedTextures(assembly, this.sharedTextureLifetime.signal);
    this.sharedTextureVerification.set(assembly.packageId, pending);
    pending.catch(() => {
      // Forget a FAILED verification so a later cell can retry it. Only this
      // promise is forgotten, so a concurrent success is never discarded.
      if (this.sharedTextureVerification.get(assembly.packageId) === pending) this.sharedTextureVerification.delete(assembly.packageId);
    });
    return pending;
  }

  private async loadSharedTextures(assembly: MultiLodAssemblyManifest, signal?: AbortSignal): Promise<ReadonlyMap<string, Uint8Array>> {
    // Bounded, because the tiles are uncancellable. See
    // `EXTERIOR_SHARED_TEXTURE_TIMEOUT_MS` for why the pair matters.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ExteriorRuntimeError("shared-texture-invalid", `Shared texture verification for assembly package ${assembly.packageId} did not settle within ${this.sharedTextureTimeoutMs}ms.`)), this.sharedTextureTimeoutMs);
    });
    try {
      return await Promise.race([this.verifySharedTextures(assembly, signal), expiry]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async verifySharedTextures(assembly: MultiLodAssemblyManifest, signal?: AbortSignal): Promise<ReadonlyMap<string, Uint8Array>> {
    const verified = new Map<string, Uint8Array>();
    const classes = new Map<string, string>();
    const declared = assembly.artifacts.filter((artifact) => artifact.role === "texture");
    for (const artifact of [...declared].sort((left, right) => (left.relativeRef < right.relativeRef ? -1 : left.relativeRef > right.relativeRef ? 1 : 0))) {
      // Restated here rather than inherited from the structural validator: a
      // tile charged to a cell would be double-counted against every other cell
      // that draws it, and this loader must not depend on someone else having
      // refused that shape first.
      if (artifact.ownerCellId !== null) throw new ExteriorRuntimeError("shared-texture-invalid", `Shared texture artifact ${artifact.relativeRef} claims owner cell ${artifact.ownerCellId}; a release-scoped tile owns no cell.`, artifact.relativeRef);
      const bytes = await this.loadVerifiedArtifact(artifact.relativeRef, artifact.byteSize, artifact.checksumSha256, signal);
      let textureClass: string;
      try {
        textureClass = replaySharedTextureArtifact(bytes, artifact.relativeRef);
      } catch (error) {
        throw new ExteriorRuntimeError("shared-texture-invalid", `Shared texture artifact ${artifact.relativeRef} is not byte-identical to the tile this repository's rasterizer produces: ${error instanceof Error ? error.message : String(error)}`, artifact.relativeRef);
      }
      // One class, one artifact. Two paths carrying identical bytes would give
      // Cesium two cache keys for one tile and quietly halve the deduplication
      // this whole mechanism exists to produce.
      const previous = classes.get(textureClass);
      if (previous !== undefined) throw new ExteriorRuntimeError("shared-texture-invalid", `Shared texture class ${textureClass} is declared twice, at ${previous} and ${artifact.relativeRef}.`, artifact.relativeRef);
      classes.set(textureClass, artifact.relativeRef);
      verified.set(artifact.relativeRef, bytes);
    }
    return verified;
  }

  /**
   * Bind ONE GLB to the verified tiles it draws.
   *
   * `referenced` comes from the binding validator, which already refused any
   * URI that escaped the audience root or named an artifact this package does
   * not declare. The lookup below is the last of the three: bytes this session
   * has verified, or nothing at all.
   */
  private sharedTextureBinding(glbRef: string, referenced: ReadonlySet<string>, verified: ReadonlyMap<string, Uint8Array>): ExteriorSharedTextureBinding {
    const textureUrls = new Map<string, Uint8Array>();
    for (const ref of [...referenced].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))) {
      const bytes = verified.get(ref);
      if (!bytes) throw new ExteriorRuntimeError("shared-texture-invalid", `Exterior GLB ${glbRef} draws shared texture ${ref}, which this session has not verified.`, glbRef);
      textureUrls.set(`${this.artifactUrlBase}${ref}`, bytes);
    }
    return { modelUrl: `${this.artifactUrlBase}${glbRef}`, glbRef, textureUrls };
  }

  private async loadVerifiedArtifact(relativeRef: string, byteSize: number, expectedChecksum: string, signal?: AbortSignal): Promise<Uint8Array> {
    assertPublicExteriorArtifactRef(relativeRef);
    // A single artifact that cannot fit the cache budget is failed closed here
    // rather than thrown away inside the LRU, which would look like a network error.
    if (byteSize > this.cache.maxBytes) throw new ExteriorRuntimeError("artifact-exceeds-cache-budget", `Exterior artifact ${relativeRef} declares ${byteSize} bytes, which exceeds the ${this.cache.maxBytes} byte exterior cache budget.`, relativeRef);
    // Key on the declaration, not just the path: two declarations that share a
    // relative ref but pin different checksums must be verified independently,
    // and a cache hit must never serve bytes verified against a different pin.
    const cacheKey = exteriorArtifactCacheKey(relativeRef, expectedChecksum);
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
  // At least one assembly package must be REACHABLE, and since ADR 0052 §2 there
  // are two ways to reach one. The check used to read `assemblies.length === 0`,
  // which was the same question while `assemblies.json` was the only carrier;
  // it stopped being the same question when a cell's manifest became its own
  // root-declared artifact, and it made the fully-sharded form — the one the
  // seam exists to produce — unrepresentable. A `-s1` release shards EVERY cell,
  // so its `assemblies.json` is `[]` by construction, and the old guard refused
  // it at boot with a message about a package it had deliberately moved.
  //
  // What the guard protects is unchanged and is still enforced: a release that
  // packages no geometry AT ALL fails closed, before the first frame, with the
  // same code and the same shape of message. Only the definition of "carries a
  // package" widens, to the union of the two forms the runtime already reads.
  // Declaring a sharded package is not a promise that it is valid — that is
  // still proven per cell at load time, on the terms ADR 0052 §2 states.
  if (!Array.isArray(source.assemblies)) throw new ExteriorRuntimeError("assembly-invalid", "The multi-LOD assembly list must be an array.");
  const declaresShardedAssembly = graph.value.roots.some((root) => root.audience === "public" && root.artifacts.some((artifact) => artifact.kind === "cell-assembly-package"));
  if (source.assemblies.length === 0 && !declaresShardedAssembly) throw new ExteriorRuntimeError("assembly-invalid", "At least one multi-LOD assembly package is required, inline or as a declared cell-assembly-package.");
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
    // The root the bytes were actually fetched from, so a shared-texture
    // release identifies an artifact by the URL it came from and not by a
    // second derivation that could drift from this one.
    artifactUrlBase: root,
  });
}
