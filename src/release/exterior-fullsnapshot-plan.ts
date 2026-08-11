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
// Estimate basis v2: image and UV terms (T028)
// ---------------------------------------------------------------------------

/**
 * ADR 0032 precondition 2 said this estimator "has no image term", would
 * under-report a textured citywide snapshot, and would under-report the UV term
 * far more badly than the image term. Basis v2 adds both.
 *
 * It is NEW code beside v1, never an edit of it. The committed dryrun artifact
 * pins `gatingBasis: "structural-gltf-accessor-arithmetic-v1"`, that artifact is
 * byte-frozen, and every existing caller keeps producing exactly the numbers it
 * produced before. A textured plan opts into v2 explicitly.
 *
 * TWO NON-COMPARABILITY WARNINGS, because a number without them is misleading:
 *
 * 1. **This estimator models the SIX-QUAD grammar, not V3.** Its asset shape is
 *    six surface quads plus one quad per placement. V3 carries the sourced
 *    polygon vertex for vertex and runs to six figures of triangles on a single
 *    tower. A v2 estimate is therefore not comparable with a measured V3 or V3T
 *    byte total, and neither number should be quoted as a check on the other.
 * 2. **v1's per-vertex figure already assumed a UV attribute.**
 *    `vertexAttributeBytes: 32` is POSITION + NORMAL + TEXCOORD_0, while the
 *    canonical writer emits POSITION alone when untextured and POSITION plus
 *    TEXCOORD_0 when textured, and never a NORMAL. So v1 is not simply "v2
 *    without the UV": the two differ in what they assume a vertex costs at all.
 *    v2 states its attribute set explicitly instead of inheriting v1's.
 */
export const EXTERIOR_FULLSNAPSHOT_ESTIMATE_BASIS_V2 = "structural-gltf-accessor-image-uv-arithmetic-v2" as const;

export const EXTERIOR_FULLSNAPSHOT_TEXTURE_BYTE_MODEL = {
  /** POSITION vec3 f32 only, which is what the canonical writer emits untextured. */
  untexturedVertexBytes: 12,
  /** POSITION vec3 f32 + TEXCOORD_0 vec2 f32, which is what it emits textured. */
  texturedVertexBytes: 20,
  /**
   * One measured procedural tile: 128x128 8-bit gray, stored DEFLATE, 16,580 B.
   * Measured rather than modelled, because the encoder is byte-exact and the
   * number is therefore a fact about the shipped tiles rather than an estimate.
   */
  imageBytes: 16_580,
  /** One extra accessor and bufferView per textured primitive, for TEXCOORD_0. */
  accessorsPerTexturedPrimitive: 1,
  bufferViewsPerTexturedPrimitive: 1,
  /** One bufferView per embedded image, plus the images/samplers/textures JSON. */
  bufferViewsPerImage: 1,
  jsonBytesPerImage: 64,
  jsonBytesPerTexture: 40,
  jsonBytesPerSampler: 72,
  /** Image views are padded to the 4-byte alignment the closed profile allows. */
  imageAlignmentBytes: 4,
} as const;

export interface FullSnapshotTexturedShape extends FullSnapshotAssetShape {
  /** Distinct embedded tiles this LOD draws. Zero reproduces the untextured arithmetic. */
  textureCount: number;
  /** Primitives whose material samples a tile, and which therefore carry TEXCOORD_0. */
  texturedPrimitiveCount: number;
}

/**
 * Byte estimate for one GLB under basis v2.
 *
 * `textureCount: 0` with `texturedPrimitiveCount: 0` is the untextured case and
 * is a legitimate v2 estimate in its own right — it is simply v1's model with
 * the vertex attribute set corrected to what the writer actually emits.
 */
export function estimateFullSnapshotTexturedAssetBytes(shape: FullSnapshotTexturedShape): number {
  const model = EXTERIOR_FULLSNAPSHOT_BYTE_MODEL;
  const texture = EXTERIOR_FULLSNAPSHOT_TEXTURE_BYTE_MODEL;
  if (shape.textureCount < 0 || shape.texturedPrimitiveCount < 0) throw new Error("Texture counts must be non-negative.");
  if (shape.texturedPrimitiveCount > Math.max(1, shape.materialCount)) throw new Error("A textured primitive count cannot exceed the primitive count.");
  if (shape.textureCount > 0 && shape.texturedPrimitiveCount === 0) throw new Error("A tile nothing draws would be dropped by the writer rather than embedded.");
  const vertexCount = shape.quadCount * model.verticesPerQuad;
  const indexCount = shape.quadCount * model.indicesPerQuad;
  const indexBytes = vertexCount > model.uint16VertexCeiling ? 4 : 2;
  const primitiveCount = Math.max(1, shape.materialCount);
  const accessorCount = primitiveCount * model.accessorsPerPrimitive + shape.texturedPrimitiveCount * texture.accessorsPerTexturedPrimitive;
  const bufferViewCount = primitiveCount * model.bufferViewsPerPrimitive
    + shape.texturedPrimitiveCount * texture.bufferViewsPerTexturedPrimitive
    + shape.textureCount * texture.bufferViewsPerImage;
  // The UV term rides on VERTEX count, not on texture count: it grows with
  // geometric detail and is completely unaffected by tile size. ADR 0032
  // measured it at 76% of the textured delta, and this is where that comes from.
  const untexturedVertexShare = vertexCount * (primitiveCount === 0 ? 0 : (primitiveCount - shape.texturedPrimitiveCount) / primitiveCount);
  const texturedVertexShare = vertexCount - untexturedVertexShare;
  const binaryBytes = untexturedVertexShare * texture.untexturedVertexBytes
    + texturedVertexShare * texture.texturedVertexBytes
    + indexCount * indexBytes
    + accessorCount * model.accessorAlignmentBytes
    + shape.textureCount * (texture.imageBytes + texture.imageAlignmentBytes);
  const jsonBytes = model.jsonBaseBytes
    + accessorCount * model.jsonBytesPerAccessor
    + bufferViewCount * model.jsonBytesPerBufferView
    + primitiveCount * model.jsonBytesPerPrimitive
    + shape.materialCount * model.jsonBytesPerMaterial
    + model.nodesPerAsset * model.jsonBytesPerNode
    + shape.textureCount * (texture.jsonBytesPerImage + texture.jsonBytesPerTexture)
    + (shape.textureCount > 0 ? texture.jsonBytesPerSampler : 0);
  return Math.ceil(binaryBytes + jsonBytes + model.containerBytes);
}

export interface FullSnapshotCacheResidency {
  basis: typeof EXTERIOR_FULLSNAPSHOT_ESTIMATE_BASIS_V2;
  cacheBytes: number;
  perAssetBytes: number;
  /** Assets the cache holds before it must evict, floored. */
  residentAssets: number;
  /** Same cache, same arithmetic, on the untextured estimate. */
  untexturedResidentAssets: number;
  /** Residency retained relative to untextured, in parts per million. */
  retainedPartsPerMillion: number;
}

/**
 * What a textured asset costs a FIXED artifact cache.
 *
 * ADR 0032 precondition 5 asked for this to be measured rather than assumed. The
 * arithmetic is deliberately trivial and deliberately explicit: a cache with a
 * byte ceiling holds `floor(budget / size)` assets, so a larger asset means
 * fewer of them, and the retained share is the ratio of the two counts rather
 * than a rule of thumb about percentages.
 *
 * It bounds VERIFIED COMPRESSED GLB BYTES retained by the exterior cache, which
 * is the only thing that cache holds. Decoded GPU memory is a different budget
 * on a different contract and is not modelled here; see the ADR 0032 amendment
 * for the mipmapped GPU figure.
 */
export function estimateFullSnapshotCacheResidency(input: { cacheBytes: number; texturedAssetBytes: number; untexturedAssetBytes: number }): FullSnapshotCacheResidency {
  if (!Number.isFinite(input.cacheBytes) || input.cacheBytes <= 0) throw new Error("Cache budget must be a positive byte count.");
  for (const bytes of [input.texturedAssetBytes, input.untexturedAssetBytes]) {
    if (!Number.isFinite(bytes) || bytes <= 0) throw new Error("Asset byte estimates must be positive.");
  }
  const residentAssets = Math.floor(input.cacheBytes / input.texturedAssetBytes);
  const untexturedResidentAssets = Math.floor(input.cacheBytes / input.untexturedAssetBytes);
  return {
    basis: EXTERIOR_FULLSNAPSHOT_ESTIMATE_BASIS_V2,
    cacheBytes: input.cacheBytes,
    perAssetBytes: input.texturedAssetBytes,
    residentAssets,
    untexturedResidentAssets,
    retainedPartsPerMillion: untexturedResidentAssets === 0 ? 0 : Math.round((residentAssets / untexturedResidentAssets) * 1_000_000),
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
