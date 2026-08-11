/**
 * Pure adapter between the pinned `manhattan-citywide-20260804` snapshot and the
 * midtown-core release assembly.
 *
 * It owns no I/O: callers hand it already-parsed, already-checksum-verified
 * shard documents, exactly as `readPilotBuildings` takes a parsed pilot release.
 * That keeps the CLI (which verifies shard bytes against the manifest) and the
 * vitest replay (which reads the same files) on one code path, so a byte-level
 * replay compares two runs of the same deterministic function rather than two
 * independent re-implementations.
 */

import { DETERMINISTIC_FACADE_V2_GENERATOR_VERSION, DETERMINISTIC_FACADE_V2_SCHEMA_VERSION } from "../domain/deterministic-facade-generator-v2.ts";
import { sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";
import { parseGlbV2 } from "./multi-lod-assembly.ts";
import type { ExteriorOwnershipCell } from "./exterior-release.ts";
import {
  MIDTOWN_CORE_GENERATED_AT,
  MIDTOWN_CORE_PARAMETER_CLAMPS,
  MIDTOWN_CORE_SEED,
  MIDTOWN_CORE_TOOL,
  MidtownCoreStop,
  buildMidtownCorePlan,
  midtownCoreAssetRef,
  writeMidtownCoreAssets,
  type MidtownCoreBuildingSource,
} from "./midtown-core-materialization.ts";
import { MIDTOWN_CORE_RELEASE_ID } from "./midtown-core-package.ts";
import { MIDTOWN_CORE_SHIPPED_LOD_ID, type MidtownCoreMaterializedBuilding, type MidtownCoreShippedAsset } from "./midtown-core-release.ts";

/** The citywide geometry-shard layer this release reads. */
export const MIDTOWN_CORE_SOURCE_LAYER = "buildings" as const;

interface RawShardFeature {
  parentId?: unknown;
  partIndex?: unknown;
  coordinates?: unknown;
  geometry?: { type?: unknown; coordinates?: unknown };
  heightMeters?: unknown;
  heightUnknown?: unknown;
  sourceRefIds?: unknown;
  sourceRecordId?: unknown;
}

function fail(message: string): never { throw new Error(`Midtown-core source: ${message}`); }

/**
 * Collects the requested buildings out of parsed citywide geometry shards.
 *
 * Fails closed on anything the release contract cannot describe: a non-polygon
 * footprint, a split render part, or a building that carries more or fewer than
 * one source reference.
 */
export function collectMidtownCoreSources(
  shards: Iterable<{ layer?: unknown; features?: unknown }>,
  wanted: ReadonlySet<string>,
): Map<string, MidtownCoreBuildingSource> {
  const collected = new Map<string, MidtownCoreBuildingSource>();
  for (const shard of shards) {
    if (shard.layer !== MIDTOWN_CORE_SOURCE_LAYER) continue;
    if (!Array.isArray(shard.features)) fail("a geometry shard declares no feature list.");
    for (const raw of shard.features as RawShardFeature[]) {
      const buildingId = raw.parentId;
      if (typeof buildingId !== "string" || !wanted.has(buildingId)) continue;
      if (collected.has(buildingId)) fail(`building ${buildingId} appears in more than one shard.`);
      if (raw.partIndex !== 0) fail(`building ${buildingId} is not a single render part.`);
      if (raw.geometry?.type !== "Polygon") fail(`building ${buildingId} does not carry a polygon footprint.`);
      const rings = raw.geometry.coordinates;
      if (!Array.isArray(rings) || !Array.isArray(rings[0])) fail(`building ${buildingId} carries no outer ring.`);
      if (!Array.isArray(raw.coordinates) || raw.coordinates.length !== 2) fail(`building ${buildingId} carries no representative point.`);
      if (!Array.isArray(raw.sourceRefIds) || raw.sourceRefIds.length !== 1 || typeof raw.sourceRefIds[0] !== "string") fail(`building ${buildingId} does not carry exactly one source reference.`);
      if (typeof raw.sourceRecordId !== "string" || raw.sourceRecordId.length === 0) fail(`building ${buildingId} carries no source record id.`);
      if (raw.heightMeters !== null && typeof raw.heightMeters !== "number") fail(`building ${buildingId} carries a non-numeric height.`);
      collected.set(buildingId, {
        buildingId,
        representative: raw.coordinates as [number, number],
        outerRing: rings[0] as [number, number][],
        heightMeters: raw.heightMeters as number | null,
        heightUnknown: raw.heightUnknown === true,
        sourceRefId: raw.sourceRefIds[0],
        sourceRecordId: raw.sourceRecordId,
      });
    }
  }
  return collected;
}

/** Y-up axis-aligned bounds of the emitted GLB's own POSITION data. */
export function midtownCoreGlbBounds(bytes: Uint8Array): MidtownCoreShippedAsset["bounds"] {
  const parsed = parseGlbV2(bytes);
  const accessors = parsed.json.accessors as Array<{ type?: string; min?: number[]; max?: number[] }>;
  const minimum: [number, number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const maximum: [number, number, number] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const accessor of accessors) {
    if (accessor.type !== "VEC3" || !accessor.min || !accessor.max) continue;
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis]!, accessor.min[axis]!);
      maximum[axis] = Math.max(maximum[axis]!, accessor.max[axis]!);
    }
  }
  if (!minimum.every(Number.isFinite) || !maximum.every(Number.isFinite)) fail("a shipped GLB declares no bounded POSITION extent.");
  return { minimum, maximum };
}

export interface MidtownCoreMaterializationCensus {
  requestedBuildingCount: number;
  resolvedBuildingCount: number;
  materializedBuildingCount: number;
  refusedBuildingCount: number;
  generatedAssetCount: number;
  shippedAssetCount: number;
  shippedAssetBytes: number;
  generatedAssetBytes: number;
  maximumTriangleCount: number;
  fallbackHeightCount: number;
  uniquePlanHashCount: number;
  refusalsByCode: Record<string, number>;
}

export interface MidtownCoreMaterialization {
  buildings: MidtownCoreMaterializedBuilding[];
  /** Shipped GLB bytes keyed by their public artifact ref. */
  assetBytes: Map<string, Uint8Array>;
  /** Building id to the stated refusal reason. */
  refusals: Map<string, string>;
  census: MidtownCoreMaterializationCensus;
}

export interface MidtownCoreMaterializeInput {
  /** Ownership cells whose buildings are materialized, in ledger order. */
  cells: readonly ExteriorOwnershipCell[];
  sources: ReadonlyMap<string, MidtownCoreBuildingSource>;
  baseManifestChecksumSha256: string;
  capture: { capturedAt: string; updatedAt: string };
  /**
   * When false, only the shipped LOD's bytes are retained. Both LODs are always
   * generated and budget-checked, so the census statement is unaffected.
   */
  retainAllLods?: boolean;
}

/**
 * Materializes every building of the given cells.
 *
 * A `MidtownCoreStop` is recorded as a stated refusal rather than rethrown: an
 * exterior grammar that cannot describe one footprint must not stop a wave, and
 * the building ships as an explicit tombstone carrying the refusal text.
 */
export function materializeMidtownCoreCells(input: MidtownCoreMaterializeInput): MidtownCoreMaterialization {
  const buildings: MidtownCoreMaterializedBuilding[] = [];
  const assetBytes = new Map<string, Uint8Array>();
  const refusals = new Map<string, string>();
  const planHashes = new Set<string>();
  const refusalsByCode: Record<string, number> = {};
  let requested = 0;
  let resolved = 0;
  let generatedAssetCount = 0;
  let generatedAssetBytes = 0;
  let shippedAssetBytes = 0;
  let maximumTriangleCount = 0;
  let fallbackHeightCount = 0;

  for (const cell of input.cells) {
    for (const buildingId of cell.buildingIds) {
      requested += 1;
      const source = input.sources.get(buildingId);
      if (!source) {
        refusals.set(buildingId, `Absent from the pinned base geometry shards: ${buildingId} is owned by cell ${cell.cellId} but no accepted footprint resolves for it, so no exterior geometry was generated.`);
        refusalsByCode["absent-from-base-shards"] = (refusalsByCode["absent-from-base-shards"] ?? 0) + 1;
        continue;
      }
      resolved += 1;
      let context;
      try {
        context = buildMidtownCorePlan(source, input.baseManifestChecksumSha256);
      } catch (error) {
        if (!(error instanceof MidtownCoreStop)) throw error;
        refusals.set(buildingId, `Refused by the deterministic exterior grammar [${error.code}]: ${error.message}. No geometry was invented for this building.`);
        refusalsByCode[error.code] = (refusalsByCode[error.code] ?? 0) + 1;
        continue;
      }
      if (context.heightSource === "fallback") fallbackHeightCount += 1;
      const assets = writeMidtownCoreAssets(context, {
        ownerCellId: cell.cellId,
        capturedAt: input.capture.capturedAt,
        updatedAt: input.capture.updatedAt,
      });
      generatedAssetCount += assets.length;
      for (const asset of assets) {
        generatedAssetBytes += asset.bytes.byteLength;
        maximumTriangleCount = Math.max(maximumTriangleCount, asset.counts.triangleCount);
      }
      const shipped: MidtownCoreShippedAsset[] = [];
      for (const asset of assets) {
        if (asset.lodId !== MIDTOWN_CORE_SHIPPED_LOD_ID && input.retainAllLods !== true) continue;
        if (asset.relativeRef !== midtownCoreAssetRef(buildingId, asset.lodId)) fail(`asset ref drifted for ${buildingId} ${asset.lodId}.`);
        assetBytes.set(asset.relativeRef, asset.bytes);
        if (asset.lodId === MIDTOWN_CORE_SHIPPED_LOD_ID) shippedAssetBytes += asset.bytes.byteLength;
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
        uncertainty: context.plan.uncertainty,
        inventory: context.plan.inventory,
        assets: shipped,
      });
    }
  }

  return {
    buildings,
    assetBytes,
    refusals,
    census: {
      requestedBuildingCount: requested,
      resolvedBuildingCount: resolved,
      materializedBuildingCount: buildings.length,
      refusedBuildingCount: refusals.size,
      generatedAssetCount,
      shippedAssetCount: buildings.reduce((total, building) => total + building.assets.length, 0),
      shippedAssetBytes,
      generatedAssetBytes,
      maximumTriangleCount,
      fallbackHeightCount,
      uniquePlanHashCount: planHashes.size,
      refusalsByCode,
    },
  };
}

/** Stable digest of a materialization census, used to pin CLI stage outputs. */
export function midtownCoreCensusDigest(census: MidtownCoreMaterializationCensus): string {
  return sha256HexSync(stableSerialize(census));
}

export interface MidtownCoreStageFingerprintInput {
  stage: string;
  /** SHA-256 of the pinned base snapshot's own `manifest.json` bytes. */
  baseManifestChecksumSha256: string;
  /** SHA-256 of the committed parent wave ledger's own bytes. */
  parentLedgerChecksumSha256: string;
  /**
   * SHA-256 of the DERIVED subset ledger's own serialization. The ledger id is
   * a digest of the parent lineage and the partition layout, so it would not
   * move if a cell's membership changed under a fixed layout; the ledger's own
   * checksum does.
   */
  subsetLedgerChecksumSha256: string;
  renderableCellCount: number;
  shippedLodId: string;
}

/**
 * Fingerprint of everything a resumable pipeline stage depends on.
 *
 * It deliberately covers the *generator* as well as the inputs: the V2 schema
 * and generator versions, this wave's own tool version, seed and frozen
 * generation instant, and both added small-footprint parameter clamps. Editing a
 * clamp changes every plan and every emitted GLB, so a receipt taken before that
 * edit must not be reusable after it without `--force`.
 */
export function midtownCoreStageFingerprint(input: MidtownCoreStageFingerprintInput): string {
  return sha256HexSync(stableSerialize({
    releaseId: MIDTOWN_CORE_RELEASE_ID,
    stage: input.stage,
    baseManifestChecksumSha256: input.baseManifestChecksumSha256,
    parentLedgerChecksumSha256: input.parentLedgerChecksumSha256,
    subsetLedgerChecksumSha256: input.subsetLedgerChecksumSha256,
    renderableCellCount: input.renderableCellCount,
    shippedLodId: input.shippedLodId,
    generator: {
      schemaVersion: DETERMINISTIC_FACADE_V2_SCHEMA_VERSION,
      generatorVersion: DETERMINISTIC_FACADE_V2_GENERATOR_VERSION,
      tool: { ...MIDTOWN_CORE_TOOL },
      seed: MIDTOWN_CORE_SEED,
      generatedAt: MIDTOWN_CORE_GENERATED_AT,
      parameterClamps: { ...MIDTOWN_CORE_PARAMETER_CLAMPS },
    },
  }));
}
