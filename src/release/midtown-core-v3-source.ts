/**
 * Wave-scale V3 materialization over the pinned `manhattan-citywide-20260804`
 * snapshot.
 *
 * The sibling of `midtown-core-source.ts` for the V3 grammar. It owns no I/O:
 * callers hand it already-parsed, already-checksum-verified shard documents
 * through the SHARED `collectMidtownCoreSources` adapter, which is
 * geometry-independent and therefore reused rather than copied. That keeps the
 * CLI and the vitest replay on one code path, so a byte-level replay compares
 * two runs of the same deterministic function.
 */

import {
  DETERMINISTIC_FACADE_V3_GENERATOR_VERSION,
  DETERMINISTIC_FACADE_V3_SCHEMA_VERSION,
  type V3StyleClass,
} from "../domain/deterministic-facade-generator-v3.ts";
import { sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";
import type { ExteriorOwnershipCell } from "./exterior-release.ts";
import type { ImmutablePin } from "./multi-lod-assembly.ts";
import { proceduralTextureProvenance, type ProceduralTextureProvenance } from "./procedural-texture.ts";
import type { MidtownCoreBuildingSource } from "./midtown-core-materialization.ts";
import { midtownCoreGlbBounds } from "./midtown-core-source.ts";
import {
  MIDTOWN_CORE_SHIPPED_LOD_ID,
  type MidtownCoreMaterializedBuilding,
  type MidtownCoreShippedAsset,
} from "./midtown-core-release.ts";
import {
  MIDTOWN_CORE_V3_VOLUME_TOLERANCE,
  MIDTOWN_CORE_V3_WAVE_PROFILE,
  MidtownCoreV3Stop,
  buildMidtownCoreV3Plan,
  midtownCoreV3AssetRef,
  writeMidtownCoreV3Assets,
  type MidtownCoreV3Registration,
  type V3WaveProfile,
} from "./midtown-core-v3-materialization.ts";
import { midtownCoreV3RefusalReason } from "./midtown-core-v3-release.ts";

function fail(message: string): never { throw new Error(`Midtown-core V3 source: ${message}`); }

export interface MidtownCoreV3Census {
  requestedBuildingCount: number;
  resolvedBuildingCount: number;
  materializedBuildingCount: number;
  refusedBuildingCount: number;
  /**
   * Materialized buildings whose inward tier offset was refused, so `setbacks`
   * ships `absent` with a stated reason. These are NOT refusals: the building is
   * shipped with a disclosed hole, which the promoted contract admits for this
   * one kind and only with a reason.
   */
  tierCollapseAbsentSetbackCount: number;
  generatedAssetCount: number;
  generatedAssetBytes: number;
  shippedAssetCount: number;
  shippedAssetBytes: number;
  maximumTriangleCount: number;
  maximumMaterialCount: number;
  triangleBudget: number;
  materialBudget: number;
  textureBudget: number;
  /** Worst declared texture count over every generated LOD of this pass. */
  maximumTextureCount: number;
  /**
   * The texture catalogue the shipped tiles were rasterized from, or `null` for
   * a texture-free wave. Pinning the rasterizer version and the parameters hash
   * into the census is what makes "these bytes came from this profile" a
   * checkable statement rather than a claim.
   */
  textureCatalog: ProceduralTextureProvenance | null;
  totalShippedTriangleCount: number;
  fallbackHeightCount: number;
  uniquePlanHashCount: number;
  reversedRingCount: number;
  worstVolumeDeviation: number;
  worstPerVertexShapeDeviationMeters: number;
  worstHorizontalDeviationMeters: number;
  worstVerticalDeviationMeters: number;
  maximumRingVertexCount: number;
  refusalsByCode: Record<string, number>;
  styleClassCounts: Record<string, number>;
}

export interface MidtownCoreV3Materialization {
  buildings: MidtownCoreMaterializedBuilding[];
  /** Shipped GLB bytes keyed by their public artifact ref. */
  assetBytes: Map<string, Uint8Array>;
  /** Building id to the stated refusal reason. */
  refusals: Map<string, string>;
  /** Building id to the deterministic stop code behind that refusal. */
  refusalCodes: Map<string, string>;
  registration: MidtownCoreV3Registration[];
  /** Buildings shipped with `setbacks` absent, with the disclosure each carries. */
  absentSetbacks: Map<string, string>;
  census: MidtownCoreV3Census;
}

export interface MidtownCoreV3MaterializeInput {
  /** Ownership cells whose buildings are materialized, in ledger order. */
  cells: readonly ExteriorOwnershipCell[];
  sources: ReadonlyMap<string, MidtownCoreBuildingSource>;
  baseManifestChecksumSha256: string;
  capture: { capturedAt: string; updatedAt: string };
  /** V2 asset pins, keyed by canonical building id. Absent means no predecessor. */
  predecessorAssets?: ReadonlyMap<string, ImmutablePin>;
  /**
   * When false, only the shipped LOD's bytes are retained. Both LODs are always
   * generated and gated, so the census statement is unaffected.
   */
  retainAllLods?: boolean;
  /**
   * `"census-only"` runs the identical pipeline — same plans, same tessellation,
   * same emitted bytes, same gates — but retains no GLB bytes and parses no GLB
   * bounds. It exists for the full-wave pass, where holding roughly seven
   * thousand shipped LODs in memory would cost several gigabytes to produce a
   * statement that is about counts rather than bytes. It is NOT a second code
   * path: every byte is still written and still measured, it is simply dropped
   * instead of kept.
   */
  retain?: "shipped-bytes" | "census-only";
  /**
   * Wave identity, budgets and texture policy. Defaults to wave `w01`'s, so the
   * midtown pipeline calls this function exactly as it always did.
   */
  profile?: V3WaveProfile;
}

/**
 * Materializes every building of the given cells through the V3 grammar.
 *
 * A `MidtownCoreV3Stop` is recorded as a stated refusal rather than rethrown: an
 * exterior grammar that cannot describe one sourced polygon must not stop a
 * wave, and the building ships as an explicit unavailable detail carrying the
 * refusal text. Everything else — an unexpected exception, a corrupt shard —
 * still propagates, because that is a pipeline fault rather than a statement
 * about a building.
 */
export function materializeMidtownCoreV3Cells(input: MidtownCoreV3MaterializeInput): MidtownCoreV3Materialization {
  const profile = input.profile ?? MIDTOWN_CORE_V3_WAVE_PROFILE;
  const buildings: MidtownCoreMaterializedBuilding[] = [];
  const assetBytes = new Map<string, Uint8Array>();
  const refusals = new Map<string, string>();
  const refusalCodes = new Map<string, string>();
  const registration: MidtownCoreV3Registration[] = [];
  const absentSetbacks = new Map<string, string>();
  const planHashes = new Set<string>();
  const refusalsByCode: Record<string, number> = {};
  const styleClassCounts: Record<string, number> = {};

  let requested = 0;
  let resolved = 0;
  let generatedAssetCount = 0;
  let generatedAssetBytes = 0;
  let shippedAssetBytes = 0;
  let totalShippedTriangleCount = 0;
  let maximumTriangleCount = 0;
  let maximumMaterialCount = 0;
  let maximumTextureCount = 0;
  let fallbackHeightCount = 0;
  let reversedRingCount = 0;
  let worstVolumeDeviation = 0;
  let worstShape = 0;
  let worstHorizontal = 0;
  let worstVertical = 0;
  let maximumRingVertexCount = 0;

  const censusOnly = input.retain === "census-only";
  const refuse = (buildingId: string, code: string, detail: string): void => {
    refusals.set(buildingId, midtownCoreV3RefusalReason(code, detail));
    refusalCodes.set(buildingId, code);
    refusalsByCode[code] = (refusalsByCode[code] ?? 0) + 1;
  };

  for (const cell of input.cells) {
    for (const buildingId of cell.buildingIds) {
      requested += 1;
      const source = input.sources.get(buildingId);
      if (!source) {
        refuse(buildingId, "absent-from-base-shards", `${buildingId} is owned by cell ${cell.cellId} but no accepted footprint resolves for it in the pinned base geometry shards`);
        continue;
      }
      resolved += 1;
      let context;
      try {
        context = buildMidtownCoreV3Plan(source, input.baseManifestChecksumSha256, profile);
      } catch (error) {
        if (!(error instanceof MidtownCoreV3Stop)) throw error;
        refuse(buildingId, error.code, error.detail);
        continue;
      }
      let written;
      try {
        written = writeMidtownCoreV3Assets(context, {
          ownerCellId: cell.cellId,
          capturedAt: input.capture.capturedAt,
          updatedAt: input.capture.updatedAt,
          predecessor: input.predecessorAssets?.get(buildingId) ?? null,
          profile,
        });
      } catch (error) {
        if (!(error instanceof MidtownCoreV3Stop)) throw error;
        refuse(buildingId, error.code, error.detail);
        continue;
      }

      if (context.heightSource === "fallback") fallbackHeightCount += 1;
      if (context.reversed) reversedRingCount += 1;
      maximumRingVertexCount = Math.max(maximumRingVertexCount, context.ringMm.length);
      styleClassCounts[context.plan.styleClass as V3StyleClass] = (styleClassCounts[context.plan.styleClass] ?? 0) + 1;
      registration.push(written.registration);
      worstShape = Math.max(worstShape, written.registration.perVertexShapeDeviationMeters);
      worstHorizontal = Math.max(worstHorizontal, written.registration.horizontalDeviationMeters);
      worstVertical = Math.max(worstVertical, written.registration.verticalDeviationMeters);
      if (written.setbacksAbsent) absentSetbacks.set(buildingId, written.setbackDisclosure);

      generatedAssetCount += written.assets.length;
      const shipped: MidtownCoreShippedAsset[] = [];
      for (const asset of written.assets) {
        generatedAssetBytes += asset.bytes.byteLength;
        maximumTriangleCount = Math.max(maximumTriangleCount, asset.counts.triangleCount);
        maximumMaterialCount = Math.max(maximumMaterialCount, asset.counts.materialCount);
        maximumTextureCount = Math.max(maximumTextureCount, asset.counts.textureCount);
        worstVolumeDeviation = Math.max(worstVolumeDeviation, asset.volumeDeviation);
        if (asset.lodId !== MIDTOWN_CORE_SHIPPED_LOD_ID && input.retainAllLods !== true) continue;
        if (asset.relativeRef !== midtownCoreV3AssetRef(buildingId, asset.lodId)) fail(`asset ref drifted for ${buildingId} ${asset.lodId}.`);
        if (asset.lodId === MIDTOWN_CORE_SHIPPED_LOD_ID) {
          shippedAssetBytes += asset.bytes.byteLength;
          totalShippedTriangleCount += asset.counts.triangleCount;
        }
        if (censusOnly) continue;
        assetBytes.set(asset.relativeRef, asset.bytes);
        shipped.push({
          lodId: asset.lodId,
          relativeRef: asset.relativeRef,
          byteSize: asset.bytes.byteLength,
          checksumSha256: asset.checksumSha256,
          counts: { ...asset.counts },
          bounds: midtownCoreGlbBounds(asset.bytes),
        });
      }
      planHashes.add(context.plan.planHashSha256);
      buildings.push({
        buildingId,
        ownerCellId: cell.cellId,
        representative: source.representative,
        sourceRefId: source.sourceRefId,
        sourceRecordId: source.sourceRecordId,
        planId: context.plan.planId,
        planHashSha256: context.plan.planHashSha256,
        uncertainty: profile.uncertainty,
        inventory: context.plan.inventory,
        assets: shipped,
        predecessor: input.predecessorAssets?.get(buildingId) ?? null,
      });
    }
  }

  return {
    buildings,
    assetBytes,
    refusals,
    refusalCodes,
    registration,
    absentSetbacks,
    census: {
      requestedBuildingCount: requested,
      resolvedBuildingCount: resolved,
      materializedBuildingCount: buildings.length,
      refusedBuildingCount: refusals.size,
      tierCollapseAbsentSetbackCount: absentSetbacks.size,
      generatedAssetCount,
      generatedAssetBytes,
      shippedAssetCount: buildings.reduce((total, building) => total + building.assets.length, 0),
      shippedAssetBytes,
      maximumTriangleCount,
      maximumMaterialCount,
      triangleBudget: profile.budgets.maxTriangles,
      materialBudget: profile.budgets.maxMaterials,
      textureBudget: profile.budgets.maxTextures,
      maximumTextureCount,
      textureCatalog: profile.texture === null ? null : proceduralTextureProvenance(),
      totalShippedTriangleCount,
      fallbackHeightCount,
      uniquePlanHashCount: planHashes.size,
      reversedRingCount,
      worstVolumeDeviation,
      worstPerVertexShapeDeviationMeters: worstShape,
      worstHorizontalDeviationMeters: worstHorizontal,
      worstVerticalDeviationMeters: worstVertical,
      maximumRingVertexCount,
      refusalsByCode,
      styleClassCounts,
    },
  };
}

/** Stable digest of a V3 census, used to pin CLI stage outputs. */
export function midtownCoreV3CensusDigest(census: MidtownCoreV3Census): string {
  return sha256HexSync(stableSerialize(census));
}

export interface MidtownCoreV3StageFingerprintInput {
  stage: string;
  baseManifestChecksumSha256: string;
  parentLedgerChecksumSha256: string;
  subsetLedgerChecksumSha256: string;
  /** Checksum of the predecessor wave's committed inventory, which supplies every pin. */
  predecessorInventoryChecksumSha256: string;
  renderableCellCount: number;
  shippedLodId: string;
  /** Wave identity, budgets and texture policy. Defaults to wave `w01`'s. */
  profile?: V3WaveProfile;
}

/**
 * Fingerprint of everything a resumable stage depends on.
 *
 * It covers the GENERATOR as well as the inputs — V3 schema and generator
 * version, this wave's own tool version, seed and frozen generation instant, the
 * wave's quality budgets and the volume tolerance — so a receipt taken before
 * any of those moved is not reusable after. It additionally covers the
 * predecessor inventory's checksum: a successor's per-asset pins are derived
 * from it, so a changed predecessor record must invalidate every stage.
 *
 * A TEXTURED wave additionally binds the rasterizer version and the parameters
 * hash of the tile catalogue: the tiles are embedded in the emitted bytes, so a
 * rasterizer change has to invalidate a receipt exactly as a grammar change
 * does. The key is emitted only when the wave is textured, so wave `w01`'s
 * fingerprints are the values they always were.
 */
export function midtownCoreV3StageFingerprint(input: MidtownCoreV3StageFingerprintInput): string {
  const profile = input.profile ?? MIDTOWN_CORE_V3_WAVE_PROFILE;
  return sha256HexSync(stableSerialize({
    releaseId: profile.releaseId,
    stage: input.stage,
    baseManifestChecksumSha256: input.baseManifestChecksumSha256,
    parentLedgerChecksumSha256: input.parentLedgerChecksumSha256,
    subsetLedgerChecksumSha256: input.subsetLedgerChecksumSha256,
    predecessorInventoryChecksumSha256: input.predecessorInventoryChecksumSha256,
    renderableCellCount: input.renderableCellCount,
    shippedLodId: input.shippedLodId,
    generator: {
      schemaVersion: DETERMINISTIC_FACADE_V3_SCHEMA_VERSION,
      generatorVersion: DETERMINISTIC_FACADE_V3_GENERATOR_VERSION,
      tool: { ...profile.tool },
      seed: profile.seed,
      generatedAt: profile.generatedAt,
      budgets: { ...profile.budgets },
      volumeTolerance: MIDTOWN_CORE_V3_VOLUME_TOLERANCE,
      ...(profile.texture === null ? {} : {
        texture: {
          ...proceduralTextureProvenance(),
          ...(profile.textureFilter ? { samplerFilter: { ...profile.textureFilter } } : {}),
        },
      }),
    },
  }));
}
