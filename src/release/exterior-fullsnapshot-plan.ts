/**
 * Full-snapshot package planning, budget simulation, and generation
 * reconciliation for the Manhattan exterior wave (Task T012).
 *
 * Everything in this module is an **estimate over deterministic plans**, never
 * a measurement of built artifacts.  Nothing here can discharge the obligations
 * of `MultiLodAssemblyManifest`, which requires real byte sizes and real
 * checksums; the package plan therefore has its own schema, is explicitly
 * marked `estimated: true`, and is deliberately *not* shaped like an assembly
 * manifest so it can never be mistaken for one.
 *
 * The module owns three things:
 *
 * 1. **A structural glTF byte estimator** derived from accessor arithmetic.
 *    This is the estimate that *gates* the budget table.
 * 2. **A labelled non-gating cross-check** against the Stage 3 pilot's measured
 *    bytes per building.  The pilot is Blender-authored commercial frontage
 *    over real footprint outlines; the full snapshot is generated rectangular
 *    massing.  The two are not the same product, so the pilot rate is reported
 *    beside the structural total and explicitly does not gate.
 * 3. **A T012-owned reconciliation vocabulary.**  The T011 codes in
 *    `./exterior-wave-reconciliation.ts` are closed by ADR 0024 and pinned by
 *    committed artifacts; this task reconciles a different thing (generation
 *    outcomes against ledger enumeration) and therefore uses its own codes.
 */

import { EXTERIOR_CELL_MAX_BUILDINGS, cellWaveId, cellWaveIndex } from "./exterior-wave-ledger.ts";
import { exteriorLedgerOwnerIndex } from "./exterior-wave-reconciliation.ts";
import type { ExteriorOwnershipLedger } from "./exterior-release.ts";
import { MULTI_LOD_ASSEMBLY_LIMITS } from "./multi-lod-assembly.ts";

export const EXTERIOR_FULLSNAPSHOT_PLAN_SCHEMA_VERSION = "1.0" as const;

// ---------------------------------------------------------------------------
// Structural glTF byte estimator (gating)
// ---------------------------------------------------------------------------

/**
 * Byte model for one generated GLB, from glTF accessor arithmetic.
 *
 * Geometry rule: every planar quad the plan describes - a surface ring or a
 * placement footprint - becomes four unshared vertices and two triangles.
 * Vertices are unshared because adjacent quads carry different normals.
 *
 * Calibration: the Stage 3 pilot's 28 measured GLBs run 55.1 to 104.3 bytes per
 * triangle, which brackets this model's ~102 bytes per triangle for small
 * meshes.  That agreement is why the model is trusted as a gate; it is not a
 * claim that a built artifact will land on the estimate.
 */
export const EXTERIOR_FULLSNAPSHOT_BYTE_MODEL = {
  /** POSITION vec3 f32 + NORMAL vec3 f32 + TEXCOORD_0 vec2 f32. */
  vertexAttributeBytes: 32,
  verticesPerQuad: 4,
  indicesPerQuad: 6,
  /** glTF requires 4-byte accessor alignment; one pad word per accessor. */
  accessorAlignmentBytes: 4,
  accessorsPerPrimitive: 4,
  bufferViewsPerPrimitive: 4,
  /** JSON-chunk cost model, in bytes. */
  jsonBaseBytes: 1_024,
  jsonBytesPerAccessor: 96,
  jsonBytesPerBufferView: 72,
  jsonBytesPerPrimitive: 160,
  jsonBytesPerMaterial: 220,
  jsonBytesPerNode: 96,
  nodesPerAsset: 2,
  /** GLB header plus two chunk headers. */
  containerBytes: 28,
  /** Index width switches at the uint16 ceiling. */
  uint16VertexCeiling: 65_535,
} as const;

/**
 * The Stage 3 pilot's measured total: 28 GLBs (14 buildings x 2 LODs) at
 * 2,457,444 bytes, i.e. 175,531.7 bytes (~171.4 KiB) per building.  Reported as
 * a labelled cross-check only.
 */
export const EXTERIOR_FULLSNAPSHOT_PILOT_CROSS_CHECK = {
  measuredAssetCount: 28,
  measuredBuildingCount: 14,
  measuredTotalBytes: 2_457_444,
  bytesPerBuildingNumerator: 2_457_444,
  bytesPerBuildingDenominator: 14,
  gating: false,
} as const;

/** The two LOD profiles this task plans for, finest first. */
export const EXTERIOR_FULLSNAPSHOT_LOD_PROFILE = [
  { lodId: "lod-0", geometricErrorMeters: 0, rule: "every plan surface and every placement quad" },
  { lodId: "lod-1", geometricErrorMeters: 4, rule: "the six plan surface quads only" },
] as const;

export type ExteriorFullSnapshotLodId = (typeof EXTERIOR_FULLSNAPSHOT_LOD_PROFILE)[number]["lodId"];

export interface FullSnapshotAssetShape {
  /** Quads the LOD realizes. */
  quadCount: number;
  /** Distinct materials the LOD references, one primitive each. */
  materialCount: number;
}

/** Quad and material shape of each LOD for a plan with `placementCount` placements. */
export function fullSnapshotLodShapes(placementCount: number): Record<ExteriorFullSnapshotLodId, FullSnapshotAssetShape> {
  return {
    // Six surfaces plus one quad per placement; the plan's palette has six
    // materials and LOD 0 references all of them.
    "lod-0": { quadCount: 6 + placementCount, materialCount: 6 },
    // Massing only: two facade materials plus roof and ground.
    "lod-1": { quadCount: 6, materialCount: 4 },
  };
}

/** Structural byte estimate for one GLB of the given shape. */
export function estimateFullSnapshotAssetBytes(shape: FullSnapshotAssetShape): number {
  const model = EXTERIOR_FULLSNAPSHOT_BYTE_MODEL;
  const vertexCount = shape.quadCount * model.verticesPerQuad;
  const indexCount = shape.quadCount * model.indicesPerQuad;
  const indexBytes = vertexCount > model.uint16VertexCeiling ? 4 : 2;
  const primitiveCount = Math.max(1, shape.materialCount);
  const accessorCount = primitiveCount * model.accessorsPerPrimitive;
  const bufferViewCount = primitiveCount * model.bufferViewsPerPrimitive;
  const binaryBytes = vertexCount * model.vertexAttributeBytes
    + indexCount * indexBytes
    + accessorCount * model.accessorAlignmentBytes;
  const jsonBytes = model.jsonBaseBytes
    + accessorCount * model.jsonBytesPerAccessor
    + bufferViewCount * model.jsonBytesPerBufferView
    + primitiveCount * model.jsonBytesPerPrimitive
    + shape.materialCount * model.jsonBytesPerMaterial
    + model.nodesPerAsset * model.jsonBytesPerNode;
  return binaryBytes + jsonBytes + model.containerBytes;
}

/** Structural byte estimate for one building across the whole LOD profile. */
export function estimateFullSnapshotBuildingBytes(placementCount: number): Record<ExteriorFullSnapshotLodId, number> {
  const shapes = fullSnapshotLodShapes(placementCount);
  return {
    "lod-0": estimateFullSnapshotAssetBytes(shapes["lod-0"]),
    "lod-1": estimateFullSnapshotAssetBytes(shapes["lod-1"]),
  };
}

// ---------------------------------------------------------------------------
// Package plan (estimated, T012-owned schema)
// ---------------------------------------------------------------------------

export interface FullSnapshotPackagePlanLod {
  lodId: ExteriorFullSnapshotLodId;
  artifactCount: number;
  estimatedBytes: number;
  maximumArtifactEstimatedBytes: number;
}

export interface FullSnapshotPackagePlanCell {
  cellId: string;
  order: number;
  waveIndex: number;
  waveId: string;
  buildingCount: number;
  placementCount: number;
  lods: FullSnapshotPackagePlanLod[];
  estimatedBytes: number;
}

export interface FullSnapshotPackagePlan {
  schemaVersion: typeof EXTERIOR_FULLSNAPSHOT_PLAN_SCHEMA_VERSION;
  planId: string;
  /**
   * Always true.  These are derived byte estimates over deterministic plans, so
   * this document can never satisfy a contract that requires measured bytes and
   * artifact checksums.
   */
  estimated: true;
  estimateBasis: "structural-gltf-accessor-arithmetic-v1";
  baseReleaseId: string;
  baseManifestChecksumSha256: string;
  ledgerId: string;
  ledgerChecksumSha256: string;
  lodProfile: typeof EXTERIOR_FULLSNAPSHOT_LOD_PROFILE;
  cellCount: number;
  assetCount: number;
  artifactCount: number;
  estimatedTotalBytes: number;
  maximumArtifactEstimatedBytes: number;
  maximumCellEstimatedBytes: number;
  /** Non-gating: the Stage 3 pilot rate applied to the same asset count. */
  pilotCrossCheckTotalBytes: number;
  pilotCrossCheckGating: false;
  cells: FullSnapshotPackagePlanCell[];
}

export interface FullSnapshotPlannedBuilding {
  buildingId: string;
  placementCount: number;
}

export interface FullSnapshotPackagePlanInput {
  ledger: ExteriorOwnershipLedger;
  ledgerChecksumSha256: string;
  baseReleaseId: string;
  baseManifestChecksumSha256: string;
  /** Planned buildings keyed by id; every ledger member must be present. */
  planned: ReadonlyMap<string, FullSnapshotPlannedBuilding>;
}

function comparePlanCells(left: FullSnapshotPackagePlanCell, right: FullSnapshotPackagePlanCell): number {
  return left.order - right.order;
}

/**
 * Builds the estimated package plan.  Cells are emitted in ledger order so the
 * document is byte-stable across replays regardless of iteration order.
 */
export function buildFullSnapshotPackagePlan(input: FullSnapshotPackagePlanInput): FullSnapshotPackagePlan {
  const cells: FullSnapshotPackagePlanCell[] = [];
  let assetCount = 0;
  let estimatedTotalBytes = 0;
  let maximumArtifactEstimatedBytes = 0;
  let maximumCellEstimatedBytes = 0;

  for (const cell of input.ledger.cells) {
    const perLod: Record<ExteriorFullSnapshotLodId, { bytes: number; maximum: number; count: number }> = {
      "lod-0": { bytes: 0, maximum: 0, count: 0 },
      "lod-1": { bytes: 0, maximum: 0, count: 0 },
    };
    let placementCount = 0;
    for (const buildingId of cell.buildingIds) {
      const planned = input.planned.get(buildingId);
      if (!planned) continue;
      assetCount += 1;
      placementCount += planned.placementCount;
      const bytes = estimateFullSnapshotBuildingBytes(planned.placementCount);
      for (const lod of EXTERIOR_FULLSNAPSHOT_LOD_PROFILE) {
        const bucket = perLod[lod.lodId];
        bucket.count += 1;
        bucket.bytes += bytes[lod.lodId];
        bucket.maximum = Math.max(bucket.maximum, bytes[lod.lodId]);
      }
    }
    const lods = EXTERIOR_FULLSNAPSHOT_LOD_PROFILE.map((lod) => ({
      lodId: lod.lodId,
      artifactCount: perLod[lod.lodId].count,
      estimatedBytes: perLod[lod.lodId].bytes,
      maximumArtifactEstimatedBytes: perLod[lod.lodId].maximum,
    }));
    const cellBytes = lods.reduce((total, lod) => total + lod.estimatedBytes, 0);
    estimatedTotalBytes += cellBytes;
    maximumCellEstimatedBytes = Math.max(maximumCellEstimatedBytes, cellBytes);
    for (const lod of lods) maximumArtifactEstimatedBytes = Math.max(maximumArtifactEstimatedBytes, lod.maximumArtifactEstimatedBytes);
    cells.push({
      cellId: cell.cellId,
      order: cell.order,
      waveIndex: cellWaveIndex(cell.cellId),
      waveId: cellWaveId(cell.cellId),
      buildingCount: cell.buildingIds.length,
      placementCount,
      lods,
      estimatedBytes: cellBytes,
    });
  }
  cells.sort(comparePlanCells);

  const pilot = EXTERIOR_FULLSNAPSHOT_PILOT_CROSS_CHECK;
  return {
    schemaVersion: EXTERIOR_FULLSNAPSHOT_PLAN_SCHEMA_VERSION,
    planId: `exterior-fullsnapshot-package-plan:${input.ledger.ledgerId}`,
    estimated: true,
    estimateBasis: "structural-gltf-accessor-arithmetic-v1",
    baseReleaseId: input.baseReleaseId,
    baseManifestChecksumSha256: input.baseManifestChecksumSha256,
    ledgerId: input.ledger.ledgerId,
    ledgerChecksumSha256: input.ledgerChecksumSha256,
    lodProfile: EXTERIOR_FULLSNAPSHOT_LOD_PROFILE,
    cellCount: cells.length,
    assetCount,
    artifactCount: assetCount * EXTERIOR_FULLSNAPSHOT_LOD_PROFILE.length,
    estimatedTotalBytes,
    maximumArtifactEstimatedBytes,
    maximumCellEstimatedBytes,
    pilotCrossCheckTotalBytes: Math.round((assetCount * pilot.bytesPerBuildingNumerator) / pilot.bytesPerBuildingDenominator),
    pilotCrossCheckGating: false,
    cells,
  };
}

// ---------------------------------------------------------------------------
// Budget table
// ---------------------------------------------------------------------------

export interface FullSnapshotBudgetCheck {
  id: string;
  limit: number;
  observed: number;
  /** Remaining share of the limit, in parts per million. */
  headroomPartsPerMillion: number;
  ok: boolean;
  detail: string;
}

export interface FullSnapshotBudgetTable {
  schemaVersion: typeof EXTERIOR_FULLSNAPSHOT_PLAN_SCHEMA_VERSION;
  gatingBasis: "structural-gltf-accessor-arithmetic-v1";
  nonGatingPilotTotalBytes: number;
  ok: boolean;
  checks: FullSnapshotBudgetCheck[];
}

function budgetCheck(id: string, limit: number, observed: number, detail: string): FullSnapshotBudgetCheck {
  return {
    id,
    limit,
    observed,
    headroomPartsPerMillion: limit === 0 ? 0 : Math.round(((limit - observed) / limit) * 1_000_000),
    ok: observed <= limit,
    detail,
  };
}

export interface FullSnapshotBudgetInput {
  plan: FullSnapshotPackagePlan;
  maximumPlacementCount: number;
  maximumCellBuildingCount: number;
  placementCap: number;
}

/**
 * Checks the estimated package plan against `MULTI_LOD_ASSEMBLY_LIMITS` and the
 * accepted per-cell membership cap.  Every check is a hard ceiling: a failing
 * check must stop the run before any wave is materialized.
 */
export function buildFullSnapshotBudgetTable(input: FullSnapshotBudgetInput): FullSnapshotBudgetTable {
  const { plan } = input;
  const checks: FullSnapshotBudgetCheck[] = [
    budgetCheck("total-bytes", MULTI_LOD_ASSEMBLY_LIMITS.totalBytes, plan.estimatedTotalBytes, "Structural estimate of all LOD artifacts against the 8 GiB package cap."),
    budgetCheck("artifact-bytes", MULTI_LOD_ASSEMBLY_LIMITS.artifactBytes, plan.maximumArtifactEstimatedBytes, "Largest single estimated GLB against the 256 MiB artifact cap."),
    budgetCheck("assets", MULTI_LOD_ASSEMBLY_LIMITS.assets, plan.assetCount, "One asset per accepted building parent against the 50,000 asset cap."),
    budgetCheck("artifacts", MULTI_LOD_ASSEMBLY_LIMITS.artifacts, plan.artifactCount, "Assets times LOD profile depth against the 200,000 artifact cap."),
    budgetCheck("cells", MULTI_LOD_ASSEMBLY_LIMITS.cells, plan.cellCount, "Ledger cells against the 20,000 cell cap."),
    budgetCheck("lods-per-asset", MULTI_LOD_ASSEMBLY_LIMITS.lodsPerAsset, plan.lodProfile.length, "LOD profile depth against the 8 LOD cap."),
    budgetCheck("placements-per-plan", input.placementCap, input.maximumPlacementCount, "Largest generated placement count against the deterministic facade cap."),
    budgetCheck("cell-membership", EXTERIOR_CELL_MAX_BUILDINGS, input.maximumCellBuildingCount, "Largest ledger cell membership against the accepted per-cell cap."),
  ];
  return {
    schemaVersion: EXTERIOR_FULLSNAPSHOT_PLAN_SCHEMA_VERSION,
    gatingBasis: "structural-gltf-accessor-arithmetic-v1",
    nonGatingPilotTotalBytes: plan.pilotCrossCheckTotalBytes,
    ok: checks.every((check) => check.ok),
    checks,
  };
}

// ---------------------------------------------------------------------------
// Runtime cache and request simulation (confirms ADR 0024 D4)
// ---------------------------------------------------------------------------

export interface FullSnapshotCacheSimulation {
  schemaVersion: typeof EXTERIOR_FULLSNAPSHOT_PLAN_SCHEMA_VERSION;
  /** Restates the accepted runtime budgets this simulation is measured against. */
  maxCacheEntries: number;
  maxCachedBytes: number;
  cellCount: number;
  maximumCellBuildingCount: number;
  medianCellBuildingCount: number;
  /** One selected-LOD entry per available building: the atomic cell-load cost. */
  maximumSingleCellEntries: number;
  singleCellFitsCache: boolean;
  /** `verifyCellRelease` re-runs on the predecessor path, doubling the load. */
  maximumPredecessorFallbackEntries: number;
  predecessorFallbackFitsCache: boolean;
  /** Median-sized cells that fit the shared 256-entry cache at once. */
  medianCellsPerCache: number;
  maximumCellEstimatedBytes: number;
  maximumCellFitsCachedBytes: boolean;
  /** Cells whose estimated both-LOD bytes exceed the 256 MiB cache ceiling. */
  cellsOverCachedBytes: number;
}

export interface FullSnapshotCacheSimulationInput {
  plan: FullSnapshotPackagePlan;
  maxCacheEntries: number;
  maxCachedBytes: number;
}

/**
 * Confirms ADR 0024 D4 against generator-derived sizes rather than the pilot's
 * measured ones.  It restates that decision's arithmetic; it discovers nothing
 * new and re-owns no invariant.
 */
export function simulateFullSnapshotCache(input: FullSnapshotCacheSimulationInput): FullSnapshotCacheSimulation {
  const memberships = input.plan.cells.map((cell) => cell.buildingCount).sort((left, right) => left - right);
  const maximumCellBuildingCount = memberships.length === 0 ? 0 : memberships[memberships.length - 1]!;
  const medianCellBuildingCount = memberships.length === 0 ? 0 : memberships[Math.floor(memberships.length / 2)]!;
  return {
    schemaVersion: EXTERIOR_FULLSNAPSHOT_PLAN_SCHEMA_VERSION,
    maxCacheEntries: input.maxCacheEntries,
    maxCachedBytes: input.maxCachedBytes,
    cellCount: input.plan.cellCount,
    maximumCellBuildingCount,
    medianCellBuildingCount,
    maximumSingleCellEntries: maximumCellBuildingCount,
    singleCellFitsCache: maximumCellBuildingCount <= input.maxCacheEntries,
    maximumPredecessorFallbackEntries: maximumCellBuildingCount * 2,
    predecessorFallbackFitsCache: maximumCellBuildingCount * 2 <= input.maxCacheEntries,
    medianCellsPerCache: medianCellBuildingCount === 0 ? 0 : Math.floor(input.maxCacheEntries / medianCellBuildingCount),
    maximumCellEstimatedBytes: input.plan.maximumCellEstimatedBytes,
    maximumCellFitsCachedBytes: input.plan.maximumCellEstimatedBytes <= input.maxCachedBytes,
    cellsOverCachedBytes: input.plan.cells.filter((cell) => cell.estimatedBytes > input.maxCachedBytes).length,
  };
}

// ---------------------------------------------------------------------------
// T012 generation reconciliation
// ---------------------------------------------------------------------------

/**
 * Closed T012 reason codes.  Each has exactly one referent:
 *
 * - `missing`       an enumerated ledger member that produced no outcome at all.
 * - `duplicate`     a building id that produced more than one outcome.
 * - `unclassified`  an outcome this task cannot classify as a validated plan of
 *                   an enumerated parent, nor as an explicit deterministic stop
 *                   carrying a stop code.
 *
 * These are deliberately **not** the T011
 * `EXTERIOR_LEDGER_RECONCILIATION_CODES`: that vocabulary is closed by ADR 0024
 * and pinned by committed artifacts, and it reconciles ledger membership rather
 * than generation outcomes.
 */
export const EXTERIOR_FULLSNAPSHOT_RECONCILIATION_CODES = ["missing", "duplicate", "unclassified"] as const;

export type FullSnapshotReconciliationCode = (typeof EXTERIOR_FULLSNAPSHOT_RECONCILIATION_CODES)[number];

export type FullSnapshotOutcome =
  | { kind: "planned"; buildingId: string; cellId: string; planHashSha256: string }
  | { kind: "stopped"; buildingId: string; cellId: string; stopCode: string };

export interface FullSnapshotReconciliationFinding {
  code: FullSnapshotReconciliationCode;
  buildingId: string;
  /** The owning cell, or `null` when no outcome named one. */
  cellId: string | null;
  detail: string;
}

export interface FullSnapshotReconciliationReport {
  schemaVersion: typeof EXTERIOR_FULLSNAPSHOT_PLAN_SCHEMA_VERSION;
  ledgerId: string;
  ledgerChecksumSha256: string;
  enumeratedBuildingCount: number;
  plannedBuildingCount: number;
  stoppedBuildingCount: number;
  counts: Record<FullSnapshotReconciliationCode, number>;
  ok: boolean;
  findings: readonly FullSnapshotReconciliationFinding[];
}

function compareFindings(left: FullSnapshotReconciliationFinding, right: FullSnapshotReconciliationFinding): number {
  const codeOrder = EXTERIOR_FULLSNAPSHOT_RECONCILIATION_CODES.indexOf(left.code) - EXTERIOR_FULLSNAPSHOT_RECONCILIATION_CODES.indexOf(right.code);
  if (codeOrder !== 0) return codeOrder;
  if (left.buildingId !== right.buildingId) return left.buildingId < right.buildingId ? -1 : 1;
  const cellLeft = left.cellId ?? "";
  const cellRight = right.cellId ?? "";
  if (cellLeft !== cellRight) return cellLeft < cellRight ? -1 : 1;
  return left.detail < right.detail ? -1 : left.detail > right.detail ? 1 : 0;
}

const HASH_PATTERN = /^[a-f0-9]{64}$/u;

/**
 * Reconciles generation outcomes against the ledger's own enumeration.
 * Deterministic: findings are ordered by (code, buildingId, cellId, detail).
 */
export function reconcileFullSnapshotGeneration(
  ledger: ExteriorOwnershipLedger,
  input: { ledgerChecksumSha256: string; outcomes: readonly FullSnapshotOutcome[]; stopCodes: readonly string[] },
): FullSnapshotReconciliationReport {
  const owner = exteriorLedgerOwnerIndex(ledger);
  const stopCodes = new Set(input.stopCodes);
  const findings: FullSnapshotReconciliationFinding[] = [];
  const seen = new Map<string, number>();
  let plannedBuildingCount = 0;
  let stoppedBuildingCount = 0;

  for (const outcome of input.outcomes) {
    const count = (seen.get(outcome.buildingId) ?? 0) + 1;
    seen.set(outcome.buildingId, count);
    if (count === 2) {
      findings.push({ code: "duplicate", buildingId: outcome.buildingId, cellId: outcome.cellId, detail: "Building produced more than one generation outcome." });
    }
    const ownerCellId = owner.get(outcome.buildingId);
    if (ownerCellId === undefined) {
      findings.push({ code: "unclassified", buildingId: outcome.buildingId, cellId: outcome.cellId, detail: "Outcome names a building the ledger enumerates for no cell." });
      continue;
    }
    if (ownerCellId !== outcome.cellId) {
      findings.push({ code: "unclassified", buildingId: outcome.buildingId, cellId: outcome.cellId, detail: `Outcome cell differs from the ledger owner ${ownerCellId}.` });
      continue;
    }
    if (outcome.kind === "planned") {
      if (!HASH_PATTERN.test(outcome.planHashSha256)) {
        findings.push({ code: "unclassified", buildingId: outcome.buildingId, cellId: outcome.cellId, detail: "Planned outcome carries no lowercase SHA-256 plan hash." });
        continue;
      }
      plannedBuildingCount += 1;
      continue;
    }
    if (!stopCodes.has(outcome.stopCode)) {
      findings.push({ code: "unclassified", buildingId: outcome.buildingId, cellId: outcome.cellId, detail: `Stop code ${outcome.stopCode} is outside the closed stop vocabulary.` });
      continue;
    }
    stoppedBuildingCount += 1;
  }

  for (const [buildingId, cellId] of owner) {
    if (!seen.has(buildingId)) {
      findings.push({ code: "missing", buildingId, cellId, detail: "Enumerated ledger member produced no generation outcome." });
    }
  }

  findings.sort(compareFindings);
  const counts = Object.fromEntries(EXTERIOR_FULLSNAPSHOT_RECONCILIATION_CODES.map((code) => [code, findings.filter((finding) => finding.code === code).length])) as Record<FullSnapshotReconciliationCode, number>;
  return {
    schemaVersion: EXTERIOR_FULLSNAPSHOT_PLAN_SCHEMA_VERSION,
    ledgerId: ledger.ledgerId,
    ledgerChecksumSha256: input.ledgerChecksumSha256,
    enumeratedBuildingCount: owner.size,
    plannedBuildingCount,
    stoppedBuildingCount,
    counts,
    ok: findings.length === 0 && plannedBuildingCount + stoppedBuildingCount === owner.size,
    findings,
  };
}
