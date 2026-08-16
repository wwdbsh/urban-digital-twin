import {
  isExteriorComponentReleaseEligible,
  validateExteriorComponentInventory,
  validateExteriorEvidenceGraphStructure,
  validateExteriorInventoryEvidence,
  type ExteriorApprovalEvidence,
  type ExteriorComponentInventory,
  type ExteriorEvidenceGraph,
} from "../domain/exterior-contract.ts";
import { isSafeReleaseArtifactReference } from "../runtime/path-security.ts";
import { sha256HexSync, stableSerialize } from "./catalog-release.ts";

export const EXTERIOR_RELEASE_SCHEMA_VERSION = "1.0" as const;
export type ExteriorReleaseAudience = "private" | "public";
/**
 * `cell-detail-sidecar` is the ONE kind T005 adds, and it exists because
 * `release-graph.json` stopped being fetchable at island scale.
 *
 * Measured, not projected: across the three largest committed `-p1` waves the
 * inventory and evidence shard PAIR costs 18,637 / 18,765 / 18,717 bytes per
 * SHIPPED asset. The curated waves ship 40-179 assets each, so the pair is a
 * rounding error there and `cellReleases` dominates — which is why ADR 0046
 * concluded that "`release-graph.json` does not scale with asset count". That
 * conclusion is correct for a curated release and FALSE for a serving one: at
 * 44,989 shipped assets the same pair projects to ~841 MB island-wide, and the
 * worst single wave (central-and-upper, 11,682 buildings) to ~224 MB — one
 * blocking fetch, parsed in full, before the first byte of geometry is verified.
 * The correction is recorded in ADR 0052 rather than applied silently.
 *
 * The seam moves ONLY the shard BODIES, one document per ownership cell, onto
 * the artifact path every GLB already travels: declared byte size, declared
 * SHA-256, public-root ref check, shared LRU, shared request budget. Nothing
 * about verification is weakened — the same per-building checks run over the
 * same shards, at cell-load time instead of at boot — and `release-graph.json`
 * keeps roots, ownership, cell releases and snapshots, which are the parts a
 * runtime genuinely needs before it can decide anything.
 *
 * A release that declares no sidecar is byte-unchanged and behaves exactly as it
 * did; the form is per cell and all-or-nothing, so a cell can never have half its
 * evidence in the graph and half in a fetched document.
 */
export type ExteriorArtifactKind = "ownership-ledger" | "cell-release" | "inventory" | "evidence" | "rollout-snapshot" | "cell-detail-sidecar";

export interface ExteriorArtifactRef {
  logicalId: string;
  kind: ExteriorArtifactKind;
  relativeRef: string;
  byteSize: number;
  checksumSha256: string;
}

// ---------------------------------------------------------------------------
// Texture admission: one versioned policy, declared by the RELEASE
// ---------------------------------------------------------------------------

/**
 * Which textures a release admits into public delivery.
 *
 * Before this existed, the refusal was spelled out independently in at least
 * five places — the assembly validator, three points in the exterior-cell
 * runtime, and the wave emitters — each deriving "no textures" from
 * `audience === "public"` with no policy in scope at all. Five copies of a rule
 * is five places to disagree, and a seam in one of them would have been
 * worthless: the runtime would have kept refusing on its own derivation.
 *
 * So the policy is declared ONCE, HERE, on the release root — which is a
 * reviewable, immutability-declaring artifact whose `rootChecksumSha256` every
 * assembly package must match by string equality — and threaded to every site
 * that used to derive it. (The root's digest is declared and cross-checked, not
 * recomputed from the root's bytes at load time; that is pre-existing behaviour
 * for this manifest and is unchanged here.) Two things follow from putting it on the release rather
 * than on the package:
 *
 * - **A package cannot widen its own gate.** The assembly manifest carries no
 *   admission field. A textured package presented to a `texture-free` release is
 *   refused, and the package has no say in it.
 * - **Absent means `texture-free`.** Every release committed before this field
 *   existed keeps its exact bytes and its exact behaviour, and a release that
 *   forgets to declare an admission gets the closed answer rather than the open
 *   one.
 */
export const EXTERIOR_TEXTURE_ADMISSION_POLICIES = ["texture-free", "procedural-replay"] as const;
export type ExteriorTextureAdmissionPolicy = (typeof EXTERIOR_TEXTURE_ADMISSION_POLICIES)[number];
export const DEFAULT_EXTERIOR_TEXTURE_ADMISSION_POLICY: ExteriorTextureAdmissionPolicy = "texture-free";

/**
 * The package-level statement that carries a textured admission.
 *
 * This is the crux of the rights boundary and it is deliberately NOT expressed
 * through `runtimeTexture`. That field is a RIGHTS predicate about
 * source-derived texture: it asks whether the evidence a building cites permits
 * a texture to be derived from it. A procedurally rasterized tile cites no
 * evidence record at all — it is a pure function of named constants in this
 * repository — so answering that question "yes" would assert a permission
 * nobody granted, over a fact nobody supplied.
 *
 * `runtimeTexture: false` therefore stays intact on every building detail, and
 * `validateProjectedGraphAudience` keeps failing closed for any structural
 * `runtimeTexture: true`. What admits a generated tile is this separate,
 * release-level fact, which says exactly what is true and nothing more:
 * generated in-repo, gated by rasterizer replay, and citing no evidence basis.
 *
 * In particular the `derivative-scope-excludes-texture` restriction on the
 * Empire State Building intake record remains correct and untouched. That
 * restriction says a measurement-only encyclopaedia fact may not become a
 * texture. The designed tile derives NOTHING from that fact — not its motif,
 * not its module sizes, not its tone — so admitting the tile does not weaken the
 * restriction, and the two statements are consistent rather than in tension.
 */
export interface ExteriorGeneratedTextureFact {
  basis: "generated-texture";
  profile: "procedural-texture-v1";
  gate: "rasterizer-replay";
  /** Literally null: a generated tile cites no evidence record, and says so. */
  evidenceBasis: null;
  /** The sampler filtering the admitted bytes must name; see ADR 0032 amendment A1. */
  samplerFilter: { magFilter: number; minFilter: number };
  statement: string;
}

export interface ExteriorTextureAdmission {
  policy: ExteriorTextureAdmissionPolicy;
  /** Required exactly when the policy is `procedural-replay`, forbidden otherwise. */
  generatedTextureFact?: ExteriorGeneratedTextureFact;
}

/** Fail-closed read of a root's declaration: absent, malformed or unknown all mean texture-free. */
export function exteriorTextureAdmissionPolicyOf(root: { textureAdmission?: ExteriorTextureAdmission } | null | undefined): ExteriorTextureAdmissionPolicy {
  const declared = root?.textureAdmission?.policy;
  return typeof declared === "string" && (EXTERIOR_TEXTURE_ADMISSION_POLICIES as readonly string[]).includes(declared)
    ? declared as ExteriorTextureAdmissionPolicy
    : DEFAULT_EXTERIOR_TEXTURE_ADMISSION_POLICY;
}

export interface ExteriorRootManifest {
  schemaVersion: typeof EXTERIOR_RELEASE_SCHEMA_VERSION;
  audience: ExteriorReleaseAudience;
  rootId: string;
  rootChecksumSha256: string;
  releaseId: string;
  cityId: string;
  configId: string;
  generatedAt: string;
  immutable: true;
  artifactAllowlist: string[];
  artifacts: ExteriorArtifactRef[];
  approval: ExteriorApprovalEvidence;
  predecessor: { rootId: string; rootChecksumSha256: string } | null;
  /** Public roots may cite private ancestry only by immutable logical identity. */
  privatePredecessor: { rootId: string; rootChecksumSha256: string } | null;
  /**
   * OPTIONAL, and absent means `texture-free`. Every committed root predates
   * this field and is byte-unchanged by its existence.
   */
  textureAdmission?: ExteriorTextureAdmission;
}

export interface Wgs84Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface ExteriorOwnershipCell {
  cellId: string;
  order: number;
  bounds: Wgs84Bounds;
  buildingIds: string[];
  membershipChecksumSha256: string;
}

export interface ExteriorOwnershipLedger {
  schemaVersion: typeof EXTERIOR_RELEASE_SCHEMA_VERSION;
  ledgerId: string;
  cityId: string;
  configId: string;
  immutable: true;
  baseIdentitySet: { id: string; checksumSha256: string; buildingCount: number };
  coverage: Wgs84Bounds;
  cells: ExteriorOwnershipCell[];
}

export type ExteriorCellFallback =
  | { mode: "predecessor"; cellReleaseId: string; checksumSha256: string }
  | { mode: "pinned-base"; baseIdentitySetId: string; checksumSha256: string };

export type ExteriorBuildingDetail =
  | { buildingId: string; status: "available"; inventoryId: string; evidenceShardId: string; runtimeTexture: boolean }
  | { buildingId: string; status: "unavailable"; tombstoneId: string; reason: string; previousInventoryId: string | null };

export interface ExteriorCellRelease {
  schemaVersion: typeof EXTERIOR_RELEASE_SCHEMA_VERSION;
  cellReleaseId: string;
  version: string;
  audience: ExteriorReleaseAudience;
  artifactRef: string;
  cityId: string;
  configId: string;
  cellId: string;
  bounds: Wgs84Bounds;
  ownershipLedgerId: string;
  baseIdentitySetId: string;
  baseIdentitySetChecksumSha256: string;
  buildingIds: string[];
  predecessor: { cellReleaseId: string; checksumSha256: string } | null;
  promotion: ExteriorApprovalEvidence;
  fallback: ExteriorCellFallback;
  buildingDetails: ExteriorBuildingDetail[];
  immutable: true;
}

export interface ExteriorInventoryShard {
  schemaVersion: typeof EXTERIOR_RELEASE_SCHEMA_VERSION;
  shardId: string;
  audience: ExteriorReleaseAudience;
  artifactRef: string;
  inventoryId: string;
  inventory: ExteriorComponentInventory;
}

export interface ExteriorEvidenceShard {
  schemaVersion: typeof EXTERIOR_RELEASE_SCHEMA_VERSION;
  shardId: string;
  audience: ExteriorReleaseAudience;
  artifactRef: string;
  inventoryId: string;
  graph: ExteriorEvidenceGraph;
}

/**
 * One ownership cell's inventory and evidence shards, as a separately fetched
 * and separately checksum-pinned document.
 *
 * `sidecarId` equals the `cellReleaseId` it serves, and the root declares it
 * under that same logical ID with kind `cell-detail-sidecar` — so resolving a
 * cell's evidence is the same lookup shape as resolving the cell release itself,
 * and there is no second naming scheme to keep in step.
 *
 * Every contained shard's `artifactRef` must equal this document's own
 * `artifactRef`. That is not redundancy: a shard's `artifactRef` has always
 * meant "the artifact whose bytes carry me", and for a sharded-out shard that
 * artifact IS the sidecar. Stating it keeps `ExteriorInventoryShard` and
 * `ExteriorEvidenceShard` byte-identical to their in-graph form, so a document
 * moved between the two forms is the same object either way.
 */
export interface ExteriorCellDetailSidecar {
  schemaVersion: typeof EXTERIOR_RELEASE_SCHEMA_VERSION;
  sidecarId: string;
  audience: ExteriorReleaseAudience;
  artifactRef: string;
  cellReleaseId: string;
  inventoryShards: ExteriorInventoryShard[];
  evidenceShards: ExteriorEvidenceShard[];
}

export interface ExteriorRolloutCell {
  cellId: string;
  cellReleaseId: string;
  checksumSha256: string;
}

export interface ExteriorRolloutSnapshot {
  schemaVersion: typeof EXTERIOR_RELEASE_SCHEMA_VERSION;
  snapshotId: string;
  audience: ExteriorReleaseAudience;
  artifactRef: string;
  cityId: string;
  configId: string;
  ownershipLedgerId: string;
  baseIdentitySetId: string;
  baseIdentitySetChecksumSha256: string;
  predecessor: { snapshotId: string; checksumSha256: string } | null;
  rollbackTarget: { snapshotId: string; checksumSha256: string } | null;
  cells: ExteriorRolloutCell[];
  promotion: ExteriorApprovalEvidence;
  generatedAt: string;
  immutable: true;
}

export interface ExteriorReleaseGraph {
  schemaVersion: typeof EXTERIOR_RELEASE_SCHEMA_VERSION;
  roots: ExteriorRootManifest[];
  ownershipLedger: ExteriorOwnershipLedger;
  cellReleases: ExteriorCellRelease[];
  inventoryShards: ExteriorInventoryShard[];
  evidenceShards: ExteriorEvidenceShard[];
  snapshots: ExteriorRolloutSnapshot[];
}

export interface ExteriorReleaseIssue { path: string; message: string }
export type ExteriorReleaseValidation<T = ExteriorReleaseGraph> = { ok: true; value: T } | { ok: false; issues: ExteriorReleaseIssue[] };

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function timestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const milliseconds = Date.parse(value);
  return !Number.isNaN(milliseconds) && new Date(milliseconds).toISOString() === value;
}
function checksum(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }
function issue(issues: ExteriorReleaseIssue[], path: string, message: string): void { issues.push({ path, message }); }
function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, issues: ExteriorReleaseIssue[], optional: readonly string[] = []): void {
  const allowlist = new Set([...allowed, ...optional]);
  for (const key of Object.keys(value)) if (!allowlist.has(key)) issue(issues, `${path}.${key}`, "Unexpected release field.");
  for (const key of allowed) if (!(key in value)) issue(issues, `${path}.${key}`, "Required release field is missing.");
}

/**
 * The admission declaration, validated closed.
 *
 * A malformed declaration is an ISSUE rather than a silent downgrade: the
 * fail-closed default in `exteriorTextureAdmissionPolicyOf` protects a caller
 * that never validated, but a release that reaches this validator and declares
 * nonsense should be refused outright rather than quietly served texture-free.
 */
function validateTextureAdmission(value: unknown, path: string, issues: ExteriorReleaseIssue[]): void {
  if (!record(value)) return issue(issues, path, "Texture admission must be an object.");
  exactKeys(value, ["policy"], path, issues, ["generatedTextureFact"]);
  if (typeof value.policy !== "string" || !(EXTERIOR_TEXTURE_ADMISSION_POLICIES as readonly string[]).includes(value.policy)) {
    return issue(issues, `${path}.policy`, `Texture admission policy must be one of: ${EXTERIOR_TEXTURE_ADMISSION_POLICIES.join(", ")}.`);
  }
  if (value.policy === "texture-free") {
    if (value.generatedTextureFact !== undefined) issue(issues, `${path}.generatedTextureFact`, "A texture-free release may not carry a generated-texture fact.");
    return;
  }
  const fact = value.generatedTextureFact;
  if (!record(fact)) return issue(issues, `${path}.generatedTextureFact`, "A procedural-replay release must carry the generated-texture fact that admits it.");
  exactKeys(fact, ["basis", "profile", "gate", "evidenceBasis", "samplerFilter", "statement"], `${path}.generatedTextureFact`, issues);
  if (fact.basis !== "generated-texture") issue(issues, `${path}.generatedTextureFact.basis`, "The only admissible basis is generated-texture.");
  if (fact.profile !== "procedural-texture-v1") issue(issues, `${path}.generatedTextureFact.profile`, "The only admissible profile is procedural-texture-v1.");
  if (fact.gate !== "rasterizer-replay") issue(issues, `${path}.generatedTextureFact.gate`, "The only admissible gate is rasterizer-replay.");
  // Explicitly null, never absent and never an id: a generated tile cites no
  // evidence record, and the record has to SAY that rather than omit it.
  if (fact.evidenceBasis !== null) issue(issues, `${path}.generatedTextureFact.evidenceBasis`, "A generated tile cites no evidence record; this must be declared null.");
  if (!record(fact.samplerFilter)) issue(issues, `${path}.generatedTextureFact.samplerFilter`, "The decided sampler filter must be declared.");
  else {
    exactKeys(fact.samplerFilter, ["magFilter", "minFilter"], `${path}.generatedTextureFact.samplerFilter`, issues);
    if (fact.samplerFilter.magFilter !== 9729 || fact.samplerFilter.minFilter !== 9987) issue(issues, `${path}.generatedTextureFact.samplerFilter`, "Publicly admitted tiles must name LINEAR magnification and LINEAR_MIPMAP_LINEAR minification (ADR 0032 amendment A1).");
  }
  if (!nonEmpty(fact.statement)) issue(issues, `${path}.generatedTextureFact.statement`, "A plain statement of what the tiles are is required.");
}
function ids(value: unknown, path: string, issues: ExteriorReleaseIssue[]): value is string[] {
  if (!Array.isArray(value) || value.some((entry) => !nonEmpty(entry))) { issue(issues, path, "Expected an array of non-empty IDs."); return false; }
  if (new Set(value).size !== value.length) issue(issues, path, "IDs must be unique.");
  return true;
}
function validBounds(value: unknown, path: string, issues: ExteriorReleaseIssue[]): value is Wgs84Bounds {
  if (!record(value)) { issue(issues, path, "WGS84 bounds are required."); return false; }
  exactKeys(value, ["west", "south", "east", "north"], path, issues);
  const valid = ["west", "south", "east", "north"].every((field) => typeof value[field] === "number" && Number.isFinite(value[field]));
  if (!valid) issue(issues, path, "WGS84 bounds must contain finite coordinates.");
  else if ((value.west as number) < -180 || (value.east as number) > 180 || (value.south as number) < -90 || (value.north as number) > 90 || (value.west as number) >= (value.east as number) || (value.south as number) >= (value.north as number)) issue(issues, path, "WGS84 bounds are outside their valid ordered range.");
  return valid;
}
function sameBounds(a: Wgs84Bounds, b: Wgs84Bounds): boolean { return a.west === b.west && a.south === b.south && a.east === b.east && a.north === b.north; }
function withinBounds(inner: Wgs84Bounds, outer: Wgs84Bounds): boolean { return inner.west >= outer.west && inner.south >= outer.south && inner.east <= outer.east && inner.north <= outer.north; }

function validateApproval(value: unknown, path: string, issues: ExteriorReleaseIssue[]): void {
  if (!record(value)) return issue(issues, path, "Approval evidence is required.");
  exactKeys(value, ["id", "fingerprintSha256", "scope", "exclusions", "approvedAt"], path, issues);
  if (!nonEmpty(value.id) || !nonEmpty(value.scope)) issue(issues, path, "Approval ID and scope are required.");
  if (!checksum(value.fingerprintSha256)) issue(issues, `${path}.fingerprintSha256`, "Approval fingerprint must be lowercase SHA-256.");
  ids(value.exclusions, `${path}.exclusions`, issues);
  if (!timestamp(value.approvedAt)) issue(issues, `${path}.approvedAt`, "Approval timestamp is required.");
}

function validateImmutableRef(value: unknown, path: string, issues: ExteriorReleaseIssue[]): void {
  if (!record(value)) return issue(issues, path, "Immutable logical reference is required.");
  const idField = "rootId" in value ? "rootId" : "snapshotId" in value ? "snapshotId" : "cellReleaseId";
  const checksumField = idField === "rootId" ? "rootChecksumSha256" : "checksumSha256";
  exactKeys(value, [idField, checksumField], path, issues);
  if (!nonEmpty(value[idField])) issue(issues, `${path}.${idField}`, "Immutable logical ID is required.");
  if (!checksum(value[checksumField])) issue(issues, `${path}.${checksumField}`, "Immutable reference checksum must be lowercase SHA-256.");
}

function validateRoot(value: unknown, path: string, issues: ExteriorReleaseIssue[]): void {
  if (!record(value)) return issue(issues, path, "Exterior root manifest must be an object.");
  exactKeys(value, ["schemaVersion", "audience", "rootId", "rootChecksumSha256", "releaseId", "cityId", "configId", "generatedAt", "immutable", "artifactAllowlist", "artifacts", "approval", "predecessor", "privatePredecessor"], path, issues, ["textureAdmission"]);
  if (value.schemaVersion !== EXTERIOR_RELEASE_SCHEMA_VERSION) issue(issues, `${path}.schemaVersion`, "Unsupported exterior root schema.");
  if (value.audience !== "private" && value.audience !== "public") issue(issues, `${path}.audience`, "Root audience must be private or public.");
  for (const field of ["rootId", "releaseId", "cityId", "configId"] as const) if (!nonEmpty(value[field])) issue(issues, `${path}.${field}`, "Non-empty root identity field is required.");
  if (!checksum(value.rootChecksumSha256)) issue(issues, `${path}.rootChecksumSha256`, "Root checksum must be lowercase SHA-256.");
  if (!timestamp(value.generatedAt)) issue(issues, `${path}.generatedAt`, "Root timestamp is required.");
  if (value.immutable !== true) issue(issues, `${path}.immutable`, "Immutable declaration must be true (and remains only a declaration)." );
  ids(value.artifactAllowlist, `${path}.artifactAllowlist`, issues);
  if (!Array.isArray(value.artifacts)) issue(issues, `${path}.artifacts`, "Artifact declarations are required.");
  else value.artifacts.forEach((artifact, index) => {
    const artifactPath = `${path}.artifacts[${index}]`;
    if (!record(artifact)) return issue(issues, artifactPath, "Artifact declaration must be an object.");
    exactKeys(artifact, ["logicalId", "kind", "relativeRef", "byteSize", "checksumSha256"], artifactPath, issues);
    if (!nonEmpty(artifact.logicalId)) issue(issues, `${artifactPath}.logicalId`, "Artifact logical ID is required.");
    if (!(["ownership-ledger", "cell-release", "inventory", "evidence", "rollout-snapshot", "cell-detail-sidecar"] as unknown[]).includes(artifact.kind)) issue(issues, `${artifactPath}.kind`, "Unknown exterior artifact kind.");
    if (!isSafeReleaseArtifactReference(artifact.relativeRef)) issue(issues, `${artifactPath}.relativeRef`, "Artifact ref must be a canonical safe relative path.");
    if (!Number.isSafeInteger(artifact.byteSize) || (artifact.byteSize as number) < 0) issue(issues, `${artifactPath}.byteSize`, "Artifact byte size must be a non-negative integer.");
    if (!checksum(artifact.checksumSha256)) issue(issues, `${artifactPath}.checksumSha256`, "Artifact checksum must be lowercase SHA-256.");
  });
  validateApproval(value.approval, `${path}.approval`, issues);
  if (value.predecessor !== null) validateImmutableRef(value.predecessor, `${path}.predecessor`, issues);
  if (value.privatePredecessor !== null) validateImmutableRef(value.privatePredecessor, `${path}.privatePredecessor`, issues);
  if (value.textureAdmission !== undefined) validateTextureAdmission(value.textureAdmission, `${path}.textureAdmission`, issues);
}

function validateLedger(value: unknown, path: string, issues: ExteriorReleaseIssue[]): void {
  if (!record(value)) return issue(issues, path, "Canonical ownership ledger must be an object.");
  exactKeys(value, ["schemaVersion", "ledgerId", "cityId", "configId", "immutable", "baseIdentitySet", "coverage", "cells"], path, issues);
  if (value.schemaVersion !== EXTERIOR_RELEASE_SCHEMA_VERSION) issue(issues, `${path}.schemaVersion`, "Unsupported ownership schema.");
  for (const field of ["ledgerId", "cityId", "configId"] as const) if (!nonEmpty(value[field])) issue(issues, `${path}.${field}`, "Ownership identity field is required.");
  if (value.immutable !== true) issue(issues, `${path}.immutable`, "Ownership ledger must declare immutability.");
  if (!record(value.baseIdentitySet)) issue(issues, `${path}.baseIdentitySet`, "Pinned base identity set is required.");
  else {
    exactKeys(value.baseIdentitySet, ["id", "checksumSha256", "buildingCount"], `${path}.baseIdentitySet`, issues);
    if (!nonEmpty(value.baseIdentitySet.id)) issue(issues, `${path}.baseIdentitySet.id`, "Base identity-set ID is required.");
    if (!checksum(value.baseIdentitySet.checksumSha256)) issue(issues, `${path}.baseIdentitySet.checksumSha256`, "Base identity checksum must be lowercase SHA-256.");
    if (!Number.isSafeInteger(value.baseIdentitySet.buildingCount) || (value.baseIdentitySet.buildingCount as number) < 0) issue(issues, `${path}.baseIdentitySet.buildingCount`, "Base building count must be a non-negative integer.");
  }
  validBounds(value.coverage, `${path}.coverage`, issues);
  if (!Array.isArray(value.cells) || value.cells.length === 0) issue(issues, `${path}.cells`, "At least one ownership cell is required.");
  else value.cells.forEach((cell, index) => {
    const cellPath = `${path}.cells[${index}]`;
    if (!record(cell)) return issue(issues, cellPath, "Ownership cell must be an object.");
    exactKeys(cell, ["cellId", "order", "bounds", "buildingIds", "membershipChecksumSha256"], cellPath, issues);
    if (!nonEmpty(cell.cellId)) issue(issues, `${cellPath}.cellId`, "Stable cell ID is required.");
    if (!Number.isSafeInteger(cell.order) || (cell.order as number) < 0) issue(issues, `${cellPath}.order`, "Stable cell order must be a non-negative integer.");
    validBounds(cell.bounds, `${cellPath}.bounds`, issues);
    ids(cell.buildingIds, `${cellPath}.buildingIds`, issues);
    if (!checksum(cell.membershipChecksumSha256)) issue(issues, `${cellPath}.membershipChecksumSha256`, "Membership checksum must be lowercase SHA-256.");
  });
}

function validateCellRelease(value: unknown, path: string, issues: ExteriorReleaseIssue[]): void {
  if (!record(value)) return issue(issues, path, "Cell release must be an object.");
  exactKeys(value, ["schemaVersion", "cellReleaseId", "version", "audience", "artifactRef", "cityId", "configId", "cellId", "bounds", "ownershipLedgerId", "baseIdentitySetId", "baseIdentitySetChecksumSha256", "buildingIds", "predecessor", "promotion", "fallback", "buildingDetails", "immutable"], path, issues);
  if (value.schemaVersion !== EXTERIOR_RELEASE_SCHEMA_VERSION) issue(issues, `${path}.schemaVersion`, "Unsupported cell release schema.");
  for (const field of ["cellReleaseId", "version", "cityId", "configId", "cellId", "ownershipLedgerId", "baseIdentitySetId"] as const) if (!nonEmpty(value[field])) issue(issues, `${path}.${field}`, "Cell release identity field is required.");
  if (value.audience !== "private" && value.audience !== "public") issue(issues, `${path}.audience`, "Cell audience must be private or public.");
  if (!isSafeReleaseArtifactReference(value.artifactRef)) issue(issues, `${path}.artifactRef`, "Cell artifact ref must be canonical and safe.");
  validBounds(value.bounds, `${path}.bounds`, issues);
  if (!checksum(value.baseIdentitySetChecksumSha256)) issue(issues, `${path}.baseIdentitySetChecksumSha256`, "Pinned base identity checksum is required.");
  ids(value.buildingIds, `${path}.buildingIds`, issues);
  if (value.predecessor !== null) validateImmutableRef(value.predecessor, `${path}.predecessor`, issues);
  validateApproval(value.promotion, `${path}.promotion`, issues);
  if (!record(value.fallback)) issue(issues, `${path}.fallback`, "Fallback contract is required.");
  else if (value.fallback.mode === "predecessor") {
    exactKeys(value.fallback, ["mode", "cellReleaseId", "checksumSha256"], `${path}.fallback`, issues);
    if (!nonEmpty(value.fallback.cellReleaseId) || !checksum(value.fallback.checksumSha256)) issue(issues, `${path}.fallback`, "Predecessor fallback identity and checksum are required.");
  }
  else if (value.fallback.mode === "pinned-base") {
    exactKeys(value.fallback, ["mode", "baseIdentitySetId", "checksumSha256"], `${path}.fallback`, issues);
    if (!nonEmpty(value.fallback.baseIdentitySetId) || !checksum(value.fallback.checksumSha256)) issue(issues, `${path}.fallback`, "Pinned-base fallback identity and checksum are required.");
  } else issue(issues, `${path}.fallback.mode`, "Fallback must be the exact predecessor or pinned base.");
  if (!Array.isArray(value.buildingDetails)) issue(issues, `${path}.buildingDetails`, "Complete building detail statuses are required.");
  else value.buildingDetails.forEach((detail, index) => {
    const detailPath = `${path}.buildingDetails[${index}]`;
    if (!record(detail)) return issue(issues, detailPath, "Building detail status must be an object.");
    if (detail.status === "available") {
      exactKeys(detail, ["buildingId", "status", "inventoryId", "evidenceShardId", "runtimeTexture"], detailPath, issues);
      if (!nonEmpty(detail.buildingId) || !nonEmpty(detail.inventoryId) || !nonEmpty(detail.evidenceShardId)) issue(issues, detailPath, "Available detail requires building, inventory, and evidence IDs.");
      if (typeof detail.runtimeTexture !== "boolean") issue(issues, `${detailPath}.runtimeTexture`, "Runtime texture use must be explicit.");
    } else if (detail.status === "unavailable") {
      exactKeys(detail, ["buildingId", "status", "tombstoneId", "reason", "previousInventoryId"], detailPath, issues);
      if (!nonEmpty(detail.buildingId) || !nonEmpty(detail.tombstoneId) || !nonEmpty(detail.reason)) issue(issues, detailPath, "Unavailable detail requires an explicit tombstone and reason.");
      if (detail.previousInventoryId !== null && !nonEmpty(detail.previousInventoryId)) issue(issues, `${detailPath}.previousInventoryId`, "Previous inventory ID must be non-empty or null.");
    } else issue(issues, `${detailPath}.status`, "Unknown building detail status.");
  });
  if (value.immutable !== true) issue(issues, `${path}.immutable`, "Cell release must declare immutability.");
}

function validateShard(value: unknown, path: string, issues: ExteriorReleaseIssue[], kind: "inventory" | "evidence"): void {
  if (!record(value)) return issue(issues, path, `${kind} shard must be an object.`);
  const payload = kind === "inventory" ? "inventory" : "graph";
  exactKeys(value, ["schemaVersion", "shardId", "audience", "artifactRef", "inventoryId", payload], path, issues);
  if (value.schemaVersion !== EXTERIOR_RELEASE_SCHEMA_VERSION) issue(issues, `${path}.schemaVersion`, `Unsupported ${kind} shard schema.`);
  if (!nonEmpty(value.shardId) || !nonEmpty(value.inventoryId)) issue(issues, path, `${kind} shard identity is required.`);
  if (value.audience !== "private" && value.audience !== "public") issue(issues, `${path}.audience`, `${kind} shard audience is invalid.`);
  if (!isSafeReleaseArtifactReference(value.artifactRef)) issue(issues, `${path}.artifactRef`, `${kind} shard artifact ref must be canonical and safe.`);
  const nestedPath = (nested: string): string => nested === "$" ? `${path}.${payload}` : `${path}.${payload}.${nested.startsWith("$.") ? nested.slice(2) : nested}`;
  const nested = kind === "inventory" ? validateExteriorComponentInventory(value.inventory) : validateExteriorEvidenceGraphStructure(value.graph);
  if (!nested.ok) for (const nestedIssue of nested.issues) issue(issues, nestedPath(nestedIssue.path), nestedIssue.message);
}

function validateSnapshot(value: unknown, path: string, issues: ExteriorReleaseIssue[]): void {
  if (!record(value)) return issue(issues, path, "Rollout snapshot must be an object.");
  exactKeys(value, ["schemaVersion", "snapshotId", "audience", "artifactRef", "cityId", "configId", "ownershipLedgerId", "baseIdentitySetId", "baseIdentitySetChecksumSha256", "predecessor", "rollbackTarget", "cells", "promotion", "generatedAt", "immutable"], path, issues);
  if (value.schemaVersion !== EXTERIOR_RELEASE_SCHEMA_VERSION) issue(issues, `${path}.schemaVersion`, "Unsupported rollout snapshot schema.");
  for (const field of ["snapshotId", "cityId", "configId", "ownershipLedgerId", "baseIdentitySetId"] as const) if (!nonEmpty(value[field])) issue(issues, `${path}.${field}`, "Snapshot identity field is required.");
  if (value.audience !== "private" && value.audience !== "public") issue(issues, `${path}.audience`, "Snapshot audience is invalid.");
  if (!isSafeReleaseArtifactReference(value.artifactRef)) issue(issues, `${path}.artifactRef`, "Snapshot artifact ref must be canonical and safe.");
  if (!checksum(value.baseIdentitySetChecksumSha256)) issue(issues, `${path}.baseIdentitySetChecksumSha256`, "Snapshot base identity checksum is required.");
  if (value.predecessor !== null) validateImmutableRef(value.predecessor, `${path}.predecessor`, issues);
  if (value.rollbackTarget !== null) validateImmutableRef(value.rollbackTarget, `${path}.rollbackTarget`, issues);
  if (!Array.isArray(value.cells)) issue(issues, `${path}.cells`, "Complete snapshot cell mapping is required.");
  else value.cells.forEach((cell, index) => {
    const cellPath = `${path}.cells[${index}]`;
    if (!record(cell)) return issue(issues, cellPath, "Snapshot cell mapping must be an object.");
    exactKeys(cell, ["cellId", "cellReleaseId", "checksumSha256"], cellPath, issues);
    if (!nonEmpty(cell.cellId) || !nonEmpty(cell.cellReleaseId) || !checksum(cell.checksumSha256)) issue(issues, cellPath, "Snapshot cell mapping requires immutable ID and checksum.");
  });
  validateApproval(value.promotion, `${path}.promotion`, issues);
  if (!timestamp(value.generatedAt)) issue(issues, `${path}.generatedAt`, "Snapshot timestamp is required.");
  if (value.immutable !== true) issue(issues, `${path}.immutable`, "Snapshot must declare immutability.");
}

export function validateExteriorReleaseStructure(value: unknown): ExteriorReleaseValidation {
  const issues: ExteriorReleaseIssue[] = [];
  if (!record(value)) return { ok: false, issues: [{ path: "$", message: "Exterior release graph must be an object." }] };
  exactKeys(value, ["schemaVersion", "roots", "ownershipLedger", "cellReleases", "inventoryShards", "evidenceShards", "snapshots"], "$", issues);
  if (value.schemaVersion !== EXTERIOR_RELEASE_SCHEMA_VERSION) issue(issues, "schemaVersion", "Unsupported exterior release graph schema.");
  const validators = [
    ["roots", validateRoot],
    ["cellReleases", validateCellRelease],
    ["inventoryShards", (entry: unknown, path: string, list: ExteriorReleaseIssue[]) => validateShard(entry, path, list, "inventory")],
    ["evidenceShards", (entry: unknown, path: string, list: ExteriorReleaseIssue[]) => validateShard(entry, path, list, "evidence")],
    ["snapshots", validateSnapshot],
  ] as const;
  for (const [field, validator] of validators) {
    if (!Array.isArray(value[field])) issue(issues, field, `${field} must be an array.`);
    else value[field].forEach((entry, index) => validator(entry, `${field}[${index}]`, issues));
  }
  validateLedger(value.ownershipLedger, "ownershipLedger", issues);
  return issues.length === 0 ? { ok: true, value: value as unknown as ExteriorReleaseGraph } : { ok: false, issues };
}

/**
 * The per-building evidence resolution, in the ONE place that may perform it.
 *
 * It was inline in `validateExteriorReleaseGraph` and had exactly one caller
 * until the sidecar seam gave it a second — the browser, resolving a cell's
 * shards out of a fetched document instead of out of the boot graph. Extracting
 * it is what stops the two forms from drifting: a rule tightened for the in-graph
 * form and forgotten for the sidecar form would be a serving release verified
 * more weakly than a curated one, which is the exact failure this seam must not
 * introduce. The checks below are byte-for-byte the ones the graph validator ran
 * before extraction, and `exterior-release.test.ts` pins that both callers reach
 * them.
 */
export function validateExteriorCellDetailResolution(
  input: {
    cell: ExteriorCellRelease;
    inventoryById: ReadonlyMap<string, ExteriorInventoryShard>;
    evidenceById: ReadonlyMap<string, ExteriorEvidenceShard>;
    path: string;
  },
  issues: ExteriorReleaseIssue[],
): { usedInventoryIds: Set<string>; usedEvidenceShardIds: Set<string> } {
  const { cell, inventoryById, evidenceById, path } = input;
  const usedInventoryIds = new Set<string>();
  const usedEvidenceShardIds = new Set<string>();
  for (const detail of cell.buildingDetails) if (detail.status === "available") {
    usedInventoryIds.add(detail.inventoryId);
    usedEvidenceShardIds.add(detail.evidenceShardId);
    const inventoryShard = inventoryById.get(detail.inventoryId);
    const evidenceShard = evidenceById.get(detail.evidenceShardId);
    if (!inventoryShard || inventoryShard.audience !== cell.audience || inventoryShard.inventory.buildingId !== detail.buildingId) issue(issues, `${path}.buildingDetails.${detail.buildingId}`, "Available inventory must resolve within the same audience and building.");
    if (!evidenceShard || evidenceShard.audience !== cell.audience || evidenceShard.inventoryId !== detail.inventoryId) issue(issues, `${path}.buildingDetails.${detail.buildingId}`, "Available evidence shard must resolve within the same audience and inventory.");
    if (inventoryShard && evidenceShard) {
      if (inventoryShard.inventory.components.some((component) => !isExteriorComponentReleaseEligible(component))) issue(issues, `${path}.buildingDetails.${detail.buildingId}`, "Required/applicable release inventory cannot promote absent representation.");
      const evidenceResult = validateExteriorInventoryEvidence(inventoryShard.inventory, evidenceShard.graph, { audience: cell.audience, runtimeTexture: detail.runtimeTexture, evaluatedAt: cell.promotion.approvedAt });
      if (!evidenceResult.ok) for (const evidenceIssue of evidenceResult.issues) issue(issues, `${path}.buildingDetails.${detail.buildingId}.${evidenceIssue.path}`, evidenceIssue.message);
    }
  }
  return { usedInventoryIds, usedEvidenceShardIds };
}

/**
 * A fetched sidecar, validated closed against the cell release it claims.
 *
 * Two halves, and both are required. The STRUCTURAL half checks the document is
 * what it says it is and that every contained shard names this document as the
 * artifact carrying it. The BINDING half runs
 * `validateExteriorCellDetailResolution` — the identical per-building evidence
 * resolution the boot graph runs for an in-graph release — so a sidecar cannot
 * admit a shard the graph form would have refused.
 *
 * The caller supplies the `artifactRef` it actually fetched from rather than
 * trusting the document's own field, so a sidecar cannot claim to be an artifact
 * other than the one whose checksum was just verified.
 */
export function validateExteriorCellDetailSidecar(
  value: unknown,
  expected: { cell: ExteriorCellRelease; artifactRef: string },
): ExteriorReleaseValidation<ExteriorCellDetailSidecar> {
  const issues: ExteriorReleaseIssue[] = [];
  const path = "$";
  if (!record(value)) return { ok: false, issues: [{ path, message: "Exterior cell detail sidecar must be an object." }] };
  exactKeys(value, ["schemaVersion", "sidecarId", "audience", "artifactRef", "cellReleaseId", "inventoryShards", "evidenceShards"], path, issues);
  if (value.schemaVersion !== EXTERIOR_RELEASE_SCHEMA_VERSION) issue(issues, `${path}.schemaVersion`, "Unsupported exterior cell detail sidecar schema.");
  if (value.audience !== expected.cell.audience) issue(issues, `${path}.audience`, "Sidecar audience must equal the audience of the cell release it serves.");
  if (value.cellReleaseId !== expected.cell.cellReleaseId) issue(issues, `${path}.cellReleaseId`, "Sidecar must name the cell release it was fetched for.");
  if (value.sidecarId !== expected.cell.cellReleaseId) issue(issues, `${path}.sidecarId`, "Sidecar logical ID must equal its cell release ID.");
  if (value.artifactRef !== expected.artifactRef) issue(issues, `${path}.artifactRef`, "Sidecar must declare the artifact reference its bytes were verified under.");
  for (const [field, kind] of [["inventoryShards", "inventory"], ["evidenceShards", "evidence"]] as const) {
    if (!Array.isArray(value[field])) { issue(issues, `${path}.${field}`, `${field} must be an array.`); continue; }
    value[field].forEach((entry, index) => {
      const entryPath = `${path}.${field}[${index}]`;
      validateShard(entry, entryPath, issues, kind);
      // The shard's own ref must be this document. See the type docblock: a
      // sharded-out shard's carrying artifact IS the sidecar, and saying so is
      // what lets the shard type stay identical across both forms.
      if (record(entry) && entry.artifactRef !== expected.artifactRef) issue(issues, `${entryPath}.artifactRef`, "A sharded-out shard must name the sidecar artifact that carries it.");
      if (record(entry) && entry.audience !== expected.cell.audience) issue(issues, `${entryPath}.audience`, "Sharded-out shard audience must equal the cell release audience.");
    });
  }
  if (issues.length > 0) return { ok: false, issues };
  const sidecar = value as unknown as ExteriorCellDetailSidecar;
  const inventoryIds = sidecar.inventoryShards.map((shard) => shard.inventoryId);
  const evidenceIds = sidecar.evidenceShards.map((shard) => shard.shardId);
  if (new Set(inventoryIds).size !== inventoryIds.length) issue(issues, `${path}.inventoryShards`, "Inventory IDs must be unique.");
  if (new Set(evidenceIds).size !== evidenceIds.length) issue(issues, `${path}.evidenceShards`, "Evidence shard IDs must be unique.");
  for (const shard of sidecar.inventoryShards) if (shard.shardId !== shard.inventoryId) issue(issues, `${path}.inventoryShards.${shard.inventoryId}.shardId`, "Inventory shard ID must equal its audited inventory logical ID.");
  const inventoryById = new Map(sidecar.inventoryShards.map((shard) => [shard.inventoryId, shard]));
  const evidenceById = new Map(sidecar.evidenceShards.map((shard) => [shard.shardId, shard]));
  const used = validateExteriorCellDetailResolution({ cell: expected.cell, inventoryById, evidenceById, path }, issues);
  // Closed in both directions: a sidecar carrying a shard no building of this
  // cell cites is unreviewed weight nobody asked for, exactly as an unreferenced
  // in-graph shard is.
  for (const id of inventoryById.keys()) if (!used.usedInventoryIds.has(id)) issue(issues, `${path}.inventoryShards.${id}`, "Sidecar carries an inventory shard this cell release does not cite.");
  for (const id of evidenceById.keys()) if (!used.usedEvidenceShardIds.has(id)) issue(issues, `${path}.evidenceShards.${id}`, "Sidecar carries an evidence shard this cell release does not cite.");
  return issues.length === 0 ? { ok: true, value: sidecar } : { ok: false, issues };
}

function artifactByLogicalId(root: ExteriorRootManifest, id: string, kind: ExteriorArtifactKind): ExteriorArtifactRef | undefined {
  return root.artifacts.find((artifact) => artifact.logicalId === id && artifact.kind === kind);
}

function artifactByAudience(
  roots: ReadonlyMap<ExteriorReleaseAudience, ExteriorRootManifest>,
  audience: ExteriorReleaseAudience,
  id: string,
  kind: ExteriorArtifactKind,
): ExteriorArtifactRef | undefined {
  const root = roots.get(audience);
  return root ? artifactByLogicalId(root, id, kind) : undefined;
}

function validateAcyclic<T>(items: readonly T[], idOf: (item: T) => string, predecessorOf: (item: T) => string | null, path: string, issues: ExteriorReleaseIssue[]): void {
  const byId = new Map(items.map((item) => [idOf(item), item]));
  for (const item of items) {
    const visited = new Set<string>();
    let cursor: T | undefined = item;
    while (cursor) {
      const id = idOf(cursor);
      if (visited.has(id)) { issue(issues, path, `Predecessor cycle includes ${id}.`); break; }
      visited.add(id);
      const predecessor = predecessorOf(cursor);
      cursor = predecessor === null ? undefined : byId.get(predecessor);
    }
  }
}

export function validateExteriorReleaseGraph(value: unknown): ExteriorReleaseValidation {
  const structure = validateExteriorReleaseStructure(value);
  if (!structure.ok) return structure;
  const graph = structure.value;
  const issues: ExteriorReleaseIssue[] = [];
  const ledger = graph.ownershipLedger;
  const privateRoot = graph.roots.find((root) => root.audience === "private");
  const publicRoot = graph.roots.find((root) => root.audience === "public");
  if (graph.roots.length !== 2 || !privateRoot || !publicRoot) issue(issues, "roots", "Exactly one private root and one public root are required.");
  if (privateRoot && publicRoot) {
    if (privateRoot.rootId === publicRoot.rootId || privateRoot.releaseId === publicRoot.releaseId) issue(issues, "roots", "Private and public roots require distinct root and release IDs.");
    if (privateRoot.privatePredecessor !== null) issue(issues, "roots.private.privatePredecessor", "Private roots cannot cite a private predecessor through the public-only field.");
    if (publicRoot.privatePredecessor && (publicRoot.privatePredecessor.rootId !== privateRoot.rootId || publicRoot.privatePredecessor.rootChecksumSha256 !== privateRoot.rootChecksumSha256)) issue(issues, "roots.public.privatePredecessor", "Public private-predecessor citation must match immutable private logical ID and hash.");
    if (publicRoot.predecessor?.rootId === privateRoot.rootId || privateRoot.predecessor?.rootId === publicRoot.rootId) issue(issues, "roots.predecessor", "Cross-audience ancestry must use the public root's path-free privatePredecessor citation.");
  }

  const seenRefs = new Set<string>();
  const seenHashes = new Set<string>();
  for (const root of graph.roots) {
    const declaredRefs = root.artifacts.map((artifact) => artifact.relativeRef);
    if (stableSerialize([...root.artifactAllowlist].sort()) !== stableSerialize([...declaredRefs].sort())) issue(issues, `roots.${root.audience}.artifactAllowlist`, "Artifact allowlist must exactly equal declared root refs.");
    for (const artifact of root.artifacts) {
      if (!artifact.relativeRef.startsWith(`${root.audience}/`)) issue(issues, `roots.${root.audience}.artifacts`, "Artifact path crosses its public/private root boundary.");
      if (seenRefs.has(artifact.relativeRef)) issue(issues, `roots.${root.audience}.artifacts`, "Artifact refs must be globally unique.");
      if (seenHashes.has(artifact.checksumSha256)) issue(issues, `roots.${root.audience}.artifacts`, "Artifact checksums must not alias multiple declarations.");
      seenRefs.add(artifact.relativeRef);
      seenHashes.add(artifact.checksumSha256);
    }
    const logicalKeys = root.artifacts.map((artifact) => `${artifact.kind}:${artifact.logicalId}`);
    if (new Set(logicalKeys).size !== logicalKeys.length) issue(issues, `roots.${root.audience}.artifacts`, "Artifact logical IDs must be unique per kind.");
    if (root.cityId !== ledger.cityId || root.configId !== ledger.configId) issue(issues, `roots.${root.audience}`, "Root city/config must match canonical ownership.");
    if (!artifactByLogicalId(root, ledger.ledgerId, "ownership-ledger")) issue(issues, `roots.${root.audience}.artifacts`, "Each root must checksum-pin the ownership ledger.");
  }

  const cellIds = ledger.cells.map((cell) => cell.cellId);
  const orders = ledger.cells.map((cell) => cell.order);
  if (new Set(cellIds).size !== cellIds.length) issue(issues, "ownershipLedger.cells", "Stable ownership cell IDs must be unique.");
  if (new Set(orders).size !== orders.length || [...orders].sort((a, b) => a - b).some((order, index) => order !== index)) issue(issues, "ownershipLedger.cells", "Stable ownership cell order must be contiguous and unique.");
  const allOwners = ledger.cells.flatMap((cell) => cell.buildingIds);
  if (new Set(allOwners).size !== allOwners.length) issue(issues, "ownershipLedger.cells", "Each base building must have exactly one canonical owner cell.");
  if (allOwners.length !== ledger.baseIdentitySet.buildingCount) issue(issues, "ownershipLedger.baseIdentitySet.buildingCount", "Pinned base building count does not match ownership membership.");
  if (sha256HexSync(stableSerialize([...allOwners].sort())) !== ledger.baseIdentitySet.checksumSha256) issue(issues, "ownershipLedger.baseIdentitySet.checksumSha256", "Pinned base identity checksum does not match exact membership.");
  for (const cell of ledger.cells) {
    if (!withinBounds(cell.bounds, ledger.coverage)) issue(issues, `ownershipLedger.cells.${cell.cellId}.bounds`, "Cell bounds must be contained by exact WGS84 coverage.");
    if (sha256HexSync(stableSerialize([...cell.buildingIds].sort())) !== cell.membershipChecksumSha256) issue(issues, `ownershipLedger.cells.${cell.cellId}.membershipChecksumSha256`, "Cell membership checksum mismatch.");
  }

  const rootsByAudience = new Map(graph.roots.map((root) => [root.audience, root]));
  const cellById = new Map(graph.cellReleases.map((cell) => [cell.cellReleaseId, cell]));
  const inventoryById = new Map(graph.inventoryShards.map((shard) => [shard.inventoryId, shard]));
  const evidenceById = new Map(graph.evidenceShards.map((shard) => [shard.shardId, shard]));
  const snapshotById = new Map(graph.snapshots.map((snapshot) => [snapshot.snapshotId, snapshot]));
  const usedInventoryIds = new Set<string>();
  const usedEvidenceShardIds = new Set<string>();
  for (const [collection, idsToCheck] of [
    ["cellReleases", graph.cellReleases.map((entry) => entry.cellReleaseId)],
    ["inventoryShards", graph.inventoryShards.map((entry) => entry.inventoryId)],
    ["inventoryShardIds", graph.inventoryShards.map((entry) => entry.shardId)],
    ["evidenceShards", graph.evidenceShards.map((entry) => entry.shardId)],
    ["snapshots", graph.snapshots.map((entry) => entry.snapshotId)],
  ] as const) if (new Set(idsToCheck).size !== idsToCheck.length) issue(issues, collection, "Logical IDs must be unique.");

  for (const cell of graph.cellReleases) {
    const path = `cellReleases.${cell.cellReleaseId}`;
    const root = rootsByAudience.get(cell.audience);
    const artifact = root && artifactByLogicalId(root, cell.cellReleaseId, "cell-release");
    if (!artifact || artifact.relativeRef !== cell.artifactRef) issue(issues, `${path}.artifactRef`, "Cell release must resolve to its audience root declaration.");
    const owner = ledger.cells.find((candidate) => candidate.cellId === cell.cellId);
    if (!owner) issue(issues, `${path}.cellId`, "Cell release is outside canonical ownership.");
    else {
      if (!sameBounds(cell.bounds, owner.bounds)) issue(issues, `${path}.bounds`, "Cell release bounds drift from canonical ownership.");
      if (stableSerialize([...cell.buildingIds].sort()) !== stableSerialize([...owner.buildingIds].sort())) issue(issues, `${path}.buildingIds`, "Cell release membership must exactly match its canonical owner cell.");
    }
    if (cell.cityId !== ledger.cityId || cell.configId !== ledger.configId || cell.ownershipLedgerId !== ledger.ledgerId || cell.baseIdentitySetId !== ledger.baseIdentitySet.id || cell.baseIdentitySetChecksumSha256 !== ledger.baseIdentitySet.checksumSha256) issue(issues, path, "Cell release must pin the same city/config/ledger/base identity.");
    const detailIds = cell.buildingDetails.map((detail) => detail.buildingId);
    if (new Set(detailIds).size !== detailIds.length || stableSerialize([...detailIds].sort()) !== stableSerialize([...cell.buildingIds].sort())) issue(issues, `${path}.buildingDetails`, "Every owned building requires exactly one detail status.");
    if (cell.predecessor) {
      const predecessor = cellById.get(cell.predecessor.cellReleaseId);
      const predecessorRoot = predecessor ? rootsByAudience.get(predecessor.audience) : undefined;
      const predecessorArtifact = predecessor && artifactByAudience(rootsByAudience, predecessor.audience, predecessor.cellReleaseId, "cell-release");
      if (predecessor && !predecessorRoot) issue(issues, `${path}.predecessor`, "Cell predecessor audience root is missing.");
      if (!predecessor || predecessor.cellId !== cell.cellId || predecessor.audience !== cell.audience || predecessor.cityId !== cell.cityId || predecessor.configId !== cell.configId || predecessor.baseIdentitySetId !== cell.baseIdentitySetId) issue(issues, `${path}.predecessor`, "Cell predecessor must exist in the same audience/city/cell/base identity.");
      else {
        if (predecessorRoot && (!predecessorArtifact || predecessorArtifact.checksumSha256 !== cell.predecessor.checksumSha256)) issue(issues, `${path}.predecessor.checksumSha256`, "Cell predecessor checksum mismatch.");
        const predecessorDetails = new Map(predecessor.buildingDetails.map((detail) => [detail.buildingId, detail]));
        for (const detail of cell.buildingDetails) if (detail.status === "unavailable") {
          const previous = predecessorDetails.get(detail.buildingId);
          if (previous?.status === "available" && detail.previousInventoryId !== previous.inventoryId) issue(issues, `${path}.buildingDetails.${detail.buildingId}.previousInventoryId`, "Removed detail tombstone must identify the predecessor inventory.");
        }
      }
      if (cell.fallback.mode !== "predecessor" || cell.fallback.cellReleaseId !== cell.predecessor.cellReleaseId || cell.fallback.checksumSha256 !== cell.predecessor.checksumSha256) issue(issues, `${path}.fallback`, "Versioned cell fallback must be its exact predecessor.");
    } else if (cell.fallback.mode !== "pinned-base" || cell.fallback.baseIdentitySetId !== ledger.baseIdentitySet.id || cell.fallback.checksumSha256 !== ledger.baseIdentitySet.checksumSha256) issue(issues, `${path}.fallback`, "Initial cell fallback must be the pinned base, never a fixture by name.");

    // Sidecar form, decided PER CELL and ALL-OR-NOTHING. A cell whose audience
    // root declares a `cell-detail-sidecar` under this cell-release ID keeps its
    // shards in that separately checksum-pinned document, and the graph must
    // then carry none of them. The exclusion is what makes the form legible: a
    // cell with half its evidence resolved at boot and half at load would be a
    // release nobody could reason about, and a reviewer could not tell by looking
    // at the graph which half they were reading.
    const sidecarArtifact = root ? artifactByLogicalId(root, cell.cellReleaseId, "cell-detail-sidecar") : undefined;
    if (sidecarArtifact) {
      for (const detail of cell.buildingDetails) if (detail.status === "available") {
        if (inventoryById.has(detail.inventoryId)) issue(issues, `${path}.buildingDetails.${detail.buildingId}`, "A sidecar-form cell may not also carry its inventory shard in the release graph.");
        if (evidenceById.has(detail.evidenceShardId)) issue(issues, `${path}.buildingDetails.${detail.buildingId}`, "A sidecar-form cell may not also carry its evidence shard in the release graph.");
      }
    } else {
      const used = validateExteriorCellDetailResolution({ cell, inventoryById, evidenceById, path }, issues);
      for (const id of used.usedInventoryIds) usedInventoryIds.add(id);
      for (const id of used.usedEvidenceShardIds) usedEvidenceShardIds.add(id);
    }
  }
  validateAcyclic(graph.cellReleases, (entry) => entry.cellReleaseId, (entry) => entry.predecessor?.cellReleaseId ?? null, "cellReleases", issues);
  const cellLineages = new Map<string, ExteriorCellRelease[]>();
  for (const cell of graph.cellReleases) {
    const key = `${cell.audience}:${cell.cellId}`;
    cellLineages.set(key, [...(cellLineages.get(key) ?? []), cell]);
  }
  for (const [key, lineage] of cellLineages) if (lineage.filter((entry) => entry.predecessor === null).length !== 1) issue(issues, `cellReleases.${key}`, "Each audience/cell lineage requires exactly one initial version.");
  const versionKeys = graph.cellReleases.map((cell) => `${cell.audience}:${cell.cellId}:${cell.version}`);
  if (new Set(versionKeys).size !== versionKeys.length) issue(issues, "cellReleases", "Cell-release versions must be unique within each audience/cell lineage.");

  for (const inventory of graph.inventoryShards) {
    const root = rootsByAudience.get(inventory.audience);
    const artifact = root && artifactByLogicalId(root, inventory.inventoryId, "inventory");
    if (inventory.shardId !== inventory.inventoryId) issue(issues, `inventoryShards.${inventory.inventoryId}.shardId`, "Inventory shard ID must equal its audited inventory/artifact logical ID.");
    if (!artifact || artifact.relativeRef !== inventory.artifactRef) issue(issues, `inventoryShards.${inventory.inventoryId}.artifactRef`, "Inventory shard must resolve to its audience root declaration.");
  }
  for (const evidence of graph.evidenceShards) {
    const root = rootsByAudience.get(evidence.audience);
    const artifact = root && artifactByLogicalId(root, evidence.shardId, "evidence");
    if (!artifact || artifact.relativeRef !== evidence.artifactRef) issue(issues, `evidenceShards.${evidence.shardId}.artifactRef`, "Evidence shard must resolve to its audience root declaration.");
  }
  for (const inventory of graph.inventoryShards) if (!usedInventoryIds.has(inventory.inventoryId)) issue(issues, `inventoryShards.${inventory.inventoryId}`, "Unreferenced inventory shard leaves the release graph open.");
  for (const evidence of graph.evidenceShards) if (!usedEvidenceShardIds.has(evidence.shardId)) issue(issues, `evidenceShards.${evidence.shardId}`, "Unreferenced evidence shard leaves the release graph open.");

  for (const snapshot of graph.snapshots) {
    const path = `snapshots.${snapshot.snapshotId}`;
    const root = rootsByAudience.get(snapshot.audience);
    const artifact = root && artifactByLogicalId(root, snapshot.snapshotId, "rollout-snapshot");
    if (!artifact || artifact.relativeRef !== snapshot.artifactRef) issue(issues, `${path}.artifactRef`, "Snapshot must resolve to its audience root declaration.");
    if (snapshot.cityId !== ledger.cityId || snapshot.configId !== ledger.configId || snapshot.ownershipLedgerId !== ledger.ledgerId || snapshot.baseIdentitySetId !== ledger.baseIdentitySet.id || snapshot.baseIdentitySetChecksumSha256 !== ledger.baseIdentitySet.checksumSha256) issue(issues, path, "Snapshot must pin the same city/config/ledger/base identity.");
    const mappingIds = snapshot.cells.map((entry) => entry.cellId);
    if (new Set(mappingIds).size !== mappingIds.length || stableSerialize([...mappingIds].sort()) !== stableSerialize([...cellIds].sort())) issue(issues, `${path}.cells`, "Rollout snapshot must be a complete exact cell map.");
    for (const mapping of snapshot.cells) {
      const release = cellById.get(mapping.cellReleaseId);
      const releaseRoot = release ? rootsByAudience.get(release.audience) : undefined;
      const releaseArtifact = release && artifactByAudience(rootsByAudience, release.audience, release.cellReleaseId, "cell-release");
      if (release && !releaseRoot) issue(issues, `${path}.cells.${mapping.cellId}`, "Snapshot cell-release audience root is missing.");
      if (!release || release.audience !== snapshot.audience || release.cellId !== mapping.cellId) issue(issues, `${path}.cells.${mapping.cellId}`, "Snapshot cell release must exist for the same audience and cell.");
      else if (releaseRoot && (!releaseArtifact || releaseArtifact.checksumSha256 !== mapping.checksumSha256)) issue(issues, `${path}.cells.${mapping.cellId}.checksumSha256`, "Snapshot cell release checksum mismatch.");
    }
    if (!snapshot.predecessor) {
      if (snapshot.rollbackTarget !== null) issue(issues, `${path}.rollbackTarget`, "Initial snapshot cannot name a rollback target.");
    } else {
      const predecessor = snapshotById.get(snapshot.predecessor.snapshotId);
      const predecessorRoot = predecessor ? rootsByAudience.get(predecessor.audience) : undefined;
      const predecessorArtifact = predecessor && artifactByAudience(rootsByAudience, predecessor.audience, predecessor.snapshotId, "rollout-snapshot");
      if (predecessor && !predecessorRoot) issue(issues, `${path}.predecessor`, "Snapshot predecessor audience root is missing.");
      if (!predecessor || predecessor.audience !== snapshot.audience || predecessor.cityId !== snapshot.cityId || predecessor.configId !== snapshot.configId || predecessor.baseIdentitySetId !== snapshot.baseIdentitySetId) issue(issues, `${path}.predecessor`, "Snapshot predecessor must exist in the same audience/city/base identity.");
      else {
        if (predecessorRoot && (!predecessorArtifact || predecessorArtifact.checksumSha256 !== snapshot.predecessor.checksumSha256)) issue(issues, `${path}.predecessor.checksumSha256`, "Snapshot predecessor checksum mismatch.");
        const previousMap = new Map(predecessor.cells.map((entry) => [entry.cellId, entry]));
        for (const mapping of snapshot.cells) {
          const previous = previousMap.get(mapping.cellId);
          if (!previous) continue;
          if (mapping.cellReleaseId === previous.cellReleaseId && mapping.checksumSha256 !== previous.checksumSha256) issue(issues, `${path}.cells.${mapping.cellId}`, "Unchanged cell mapping must retain its exact checksum.");
          if (mapping.cellReleaseId !== previous.cellReleaseId) {
            const changed = cellById.get(mapping.cellReleaseId);
            if (!changed?.predecessor || changed.predecessor.cellReleaseId !== previous.cellReleaseId || changed.predecessor.checksumSha256 !== previous.checksumSha256) issue(issues, `${path}.cells.${mapping.cellId}`, "Changed cell release must continue exactly from the predecessor snapshot mapping.");
          }
        }
      }
      if (!snapshot.rollbackTarget) issue(issues, `${path}.rollbackTarget`, "Changed rollout requires a complete immutable rollback target.");
      else {
        let cursor = predecessor;
        let isAncestor = false;
        const visited = new Set<string>();
        while (cursor && !visited.has(cursor.snapshotId)) {
          visited.add(cursor.snapshotId);
          if (cursor.snapshotId === snapshot.rollbackTarget.snapshotId) { isAncestor = true; break; }
          cursor = cursor.predecessor ? snapshotById.get(cursor.predecessor.snapshotId) : undefined;
        }
        const rollback = snapshotById.get(snapshot.rollbackTarget.snapshotId);
        const rollbackRoot = rollback ? rootsByAudience.get(rollback.audience) : undefined;
        const rollbackArtifact = rollback && artifactByAudience(rootsByAudience, rollback.audience, rollback.snapshotId, "rollout-snapshot");
        if (rollback && !rollbackRoot) issue(issues, `${path}.rollbackTarget`, "Rollback target audience root is missing.");
        if (!isAncestor || !rollback || rollback.cells.length !== ledger.cells.length || (rollbackRoot && (!rollbackArtifact || rollbackArtifact.checksumSha256 !== snapshot.rollbackTarget.checksumSha256))) issue(issues, `${path}.rollbackTarget`, "Rollback target must be a complete immutable ancestor snapshot with matching checksum.");
      }
    }
  }
  validateAcyclic(graph.snapshots, (entry) => entry.snapshotId, (entry) => entry.predecessor?.snapshotId ?? null, "snapshots", issues);
  const snapshotLineages = new Map<ExteriorReleaseAudience, ExteriorRolloutSnapshot[]>();
  for (const snapshot of graph.snapshots) snapshotLineages.set(snapshot.audience, [...(snapshotLineages.get(snapshot.audience) ?? []), snapshot]);
  for (const [audience, lineage] of snapshotLineages) if (lineage.filter((entry) => entry.predecessor === null).length !== 1) issue(issues, `snapshots.${audience}`, "Each rollout audience requires exactly one initial complete snapshot.");

  const expectedArtifacts = new Set<string>([
    ...graph.cellReleases.map((entry) => `${entry.audience}:cell-release:${entry.cellReleaseId}`),
    // A sidecar's decoded graph node is the cell release it serves. Declaring
    // one for a cell release that does not exist is still refused, because this
    // set is built from the cell releases the graph actually decodes.
    ...graph.cellReleases.map((entry) => `${entry.audience}:cell-detail-sidecar:${entry.cellReleaseId}`),
    ...graph.inventoryShards.map((entry) => `${entry.audience}:inventory:${entry.inventoryId}`),
    ...graph.evidenceShards.map((entry) => `${entry.audience}:evidence:${entry.shardId}`),
    ...graph.snapshots.map((entry) => `${entry.audience}:rollout-snapshot:${entry.snapshotId}`),
    ...graph.roots.map((entry) => `${entry.audience}:ownership-ledger:${ledger.ledgerId}`),
  ]);
  for (const root of graph.roots) for (const artifact of root.artifacts) if (!expectedArtifacts.has(`${root.audience}:${artifact.kind}:${artifact.logicalId}`)) issue(issues, `roots.${root.audience}.artifacts`, "Root artifact declaration has no decoded graph node.");

  return issues.length === 0 ? { ok: true, value: graph } : { ok: false, issues };
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const copied = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copied.buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function replayExteriorArtifactIntegrity(
  graphValue: unknown,
  suppliedBytes: ReadonlyMap<string, Uint8Array | string>,
): Promise<ExteriorReleaseValidation<ExteriorReleaseGraph>> {
  const validation = validateExteriorReleaseGraph(graphValue);
  if (!validation.ok) return validation;
  const issues: ExteriorReleaseIssue[] = [];
  const declarations = validation.value.roots.flatMap((root) => root.artifacts);
  const declaredRefs = new Set(declarations.map((artifact) => artifact.relativeRef));
  for (const ref of suppliedBytes.keys()) if (!declaredRefs.has(ref)) issue(issues, `bytes.${ref}`, "Supplied bytes are not declared by either immutable root.");
  await Promise.all(declarations.map(async (artifact) => {
    const supplied = suppliedBytes.get(artifact.relativeRef);
    if (supplied === undefined) return issue(issues, `bytes.${artifact.relativeRef}`, "Declared artifact bytes are missing.");
    const bytes = typeof supplied === "string" ? new TextEncoder().encode(supplied) : supplied;
    if (bytes.byteLength !== artifact.byteSize) issue(issues, `bytes.${artifact.relativeRef}`, "Artifact byte-size replay mismatch.");
    if (await sha256Bytes(bytes) !== artifact.checksumSha256) issue(issues, `bytes.${artifact.relativeRef}`, "Artifact SHA-256 replay mismatch.");
  }));
  return issues.length === 0 ? { ok: true, value: validation.value } : { ok: false, issues };
}
