/**
 * ONE cell-bake, shared by the v4 adoption cycle and the mass campaign.
 *
 * WHY THIS IS A MODULE AND NOT A SECOND COPY IN A SECOND CLI. T013's fix CLI
 * grew its own `bakeCellV3`, and a campaign CLI with its own third copy would
 * be three implementations of "bake one cell" that must agree byte for byte and
 * have no mechanism forcing them to. The adoption cycle and the campaign MUST
 * bake identically or the adoption proves nothing about the campaign, so they
 * call this.
 *
 * WHAT IT REFUSES, and each refusal is a named honest stop rather than a crash:
 *
 * - A recipe that is not the adopted one. The caller asserts it; this module
 *   records which recipe it was handed into every result.
 * - A cell that produces no bakeable face.
 * - A packing that is infeasible at every declared scale.
 * - A zone that would silently fall back to v1's facade-only colour.
 * - An aggregated factor above the closed profile's ceiling.
 *
 * Every one of those is a `FarTierCellStop`, which a campaign records and moves
 * past. An unexpected exception is NOT converted into a stop: a bug must not be
 * indistinguishable from a refusal.
 */

import type { V3Plan } from "../domain/deterministic-facade-generator-v3.ts";
import {
  FAR_TIER_BAKE_RECIPE,
  FarTierAggregateMissingZoneError,
  FarTierAggregateOutOfRangeError,
  FarTierPackingUnfeasibleError,
  bakeFarTierAtlas,
  farTierEffectiveParameters,
  farTierFacesForBuilding,
  farTierGeometry,
} from "./far-tier-bake.ts";
import type { FarTierFace, FarTierPacking } from "./far-tier-bake.ts";
import { packFarTierAtlas } from "./far-tier-bake.ts";
import {
  FAR_TIER_ATLAS_PIXELS,
  FAR_TIER_NEAR_EDGE_METERS,
  farTierDeliveredQuality,
  farTierResolution,
  farTierTexelWorldSizeMeters,
} from "./far-tier-budget.ts";

/** Every way one cell can decline to produce a tile, each with a stable code. */
export type FarTierStopCode =
  | "no-bakeable-face"
  | "packing-infeasible"
  | "zone-aggregate-missing"
  | "zone-aggregate-out-of-range"
  | "fallback-share-over-bar";

export class FarTierCellStop extends Error {
  readonly code: FarTierStopCode;
  readonly cellId: string;
  readonly detail: Readonly<Record<string, unknown>>;
  constructor(cellId: string, code: FarTierStopCode, message: string, detail: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.name = "FarTierCellStop";
    this.code = code;
    this.cellId = cellId;
    this.detail = detail;
  }
}

export interface FarTierCellBakeOptions {
  /** The recipe object. The CALLER asserts it is the adopted one. */
  recipe: Record<string, unknown>;
  /** `area-correct-aggregate` for the campaign; `facade-only` only for additivity checks. */
  zoneColourMode: "facade-only" | "area-correct-aggregate";
  /** The recipe whose PACKING fields are used. Defaults to `recipe`; the additivity check passes v1. */
  packingRecipe?: Record<string, unknown>;
  /**
   * Accept zones that found no aggregate, up to `fallbackAreaShareBar` of the
   * cell's wall area. Off entirely by default: a caller must opt in AND the
   * share must clear the pre-registered bar.
   */
  allowFacadeOnlyFallback?: boolean;
  fallbackAreaShareBar?: number;
}

export interface FarTierCellTelemetry {
  cellId: string;
  recipeId: string;
  faceCount: number;
  wallFaceCount: number;
  flatFaceCount: number;
  atlasPixels: number;
  appliedScale: number;
  texelWorldSizeMeters: number;
  achievedTexelRatio: number;
  underResolved: boolean;
  criticalDistanceMeters: number;
  occupancy: number;
  surfaceAreaSquareMeters: number;
  wallAreaSquareMeters: number;
  includedBuildings: number;
  refusedBuildings: number;
  unitySnapCount: number;
  fallbackZoneCount: number;
  fallbackAreaSquareMeters: number;
  fallbackAreaShare: number;
  aggregateInScopeAreaSquareMeters: number;
  aggregateAttributedAreaSquareMeters: number;
}

export interface FarTierCellBake {
  packing: FarTierPacking;
  rgb: Uint8Array;
  geometry: ReturnType<typeof farTierGeometry>;
  members: Array<{ buildingId: string; included: boolean; reason?: string; styleClass?: string; faceCount?: number; planHashSha256?: string }>;
  telemetry: FarTierCellTelemetry;
  fallbackZones: Array<{ buildingId: string; zoneKey: string; materialId: string }>;
  unitySnaps: Array<{ buildingId: string; zoneKey: string; overshoot: number }>;
}

export interface FarTierCellInput {
  cellId: string;
  /** Building ids in the ledger's own order; the caller sorts. */
  buildingIds: readonly string[];
  /** Returns the plan for one building, or a refusal reason. */
  planFor: (buildingId: string) => { plan: V3Plan; offsetMeters: readonly [number, number] } | { refusal: string };
}

/**
 * Bake one cell.
 *
 * THE B2 INVARIANT IS STRUCTURAL, NOT CHECKED PER CELL. `farTierResolution`
 * clamps the atlas edge to `FAR_TIER_ATLAS_PIXELS.maximum`, so no cell can
 * exceed the per-tile atlas budget that ceiling implies. Asserting it per cell
 * would be asserting `Math.min(x, 256) <= 256`. It is asserted ONCE here, as a
 * property of the constants, so that a later change to either constant fails
 * loudly instead of silently widening the budget.
 */
export function bakeFarTierCell(input: FarTierCellInput, options: FarTierCellBakeOptions): FarTierCellBake {
  if (FAR_TIER_ATLAS_PIXELS.maximum > 256) {
    throw new Error(`The far-tier atlas ceiling is ${FAR_TIER_ATLAS_PIXELS.maximum}; the B2 per-tile budget was derived at 256 and does not cover a larger one.`);
  }

  const faces: FarTierFace[] = [];
  const members: FarTierCellBake["members"] = [];
  const aggregateReport: Array<{ inScopeAreaSquareMeters: number; attributedAreaSquareMeters: number }> = [];
  const unitySnapReport: FarTierCellBake["unitySnaps"] = [];
  const facadeOnlyFallbackReport: FarTierCellBake["fallbackZones"] = [];

  for (const buildingId of [...input.buildingIds].sort()) {
    const resolved = input.planFor(buildingId);
    if ("refusal" in resolved) { members.push({ buildingId, included: false, reason: resolved.refusal }); continue; }
    const { plan, offsetMeters } = resolved;
    let built: FarTierFace[];
    try {
      built = farTierFacesForBuilding(plan, offsetMeters, {
        zoneColourMode: options.zoneColourMode,
        aggregateReport: aggregateReport as never,
        unitySnapReport,
        facadeOnlyFallbackReport,
        // Collected here and JUDGED against the pre-registered bar below, so a
        // cell whose share clears the bar is accepted by name and one that does
        // not is a stop — neither is a silent pass.
        allowFacadeOnlyFallback: options.allowFacadeOnlyFallback === true,
      });
    } catch (error) {
      if (error instanceof FarTierAggregateMissingZoneError) {
        throw new FarTierCellStop(input.cellId, "zone-aggregate-missing", error.message, { buildingId });
      }
      if (error instanceof FarTierAggregateOutOfRangeError) {
        throw new FarTierCellStop(input.cellId, "zone-aggregate-out-of-range", error.message, { buildingId });
      }
      throw error;
    }
    faces.push(...built);
    members.push({ buildingId, included: true, styleClass: plan.styleClass, faceCount: built.length, planHashSha256: plan.planHashSha256 });
  }

  if (faces.length === 0) {
    throw new FarTierCellStop(input.cellId, "no-bakeable-face", `Cell ${input.cellId} produced no bakeable face; every member was refused by the grammar or absent from the snapshot.`, {
      members: members.filter((member) => !member.included).length,
    });
  }

  const surfaceArea = faces.reduce((sum, face) => sum + face.areaSquareMeters, 0);
  const resolution = farTierResolution(surfaceArea);
  let packing: FarTierPacking;
  try {
    packing = packFarTierAtlas(faces, resolution.atlasPixels, farTierTexelWorldSizeMeters(FAR_TIER_NEAR_EDGE_METERS), options.packingRecipe ?? options.recipe);
  } catch (error) {
    if (error instanceof FarTierPackingUnfeasibleError) {
      throw new FarTierCellStop(input.cellId, "packing-infeasible", error.message, { faceCount: faces.length, atlasPixels: resolution.atlasPixels });
    }
    throw error;
  }

  const wallFaces = packing.faces.filter((face) => face.kind === "wall");
  const wallArea = wallFaces.reduce((sum, face) => sum + face.areaSquareMeters, 0);
  const fallbackFaceKey = new Set(facadeOnlyFallbackReport.map((entry) => `${entry.buildingId}:${entry.zoneKey.split(":")[0]}`));
  const fallbackArea = wallFaces
    .filter((face) => fallbackFaceKey.has(`${face.buildingId}:${face.faceIndex}`))
    .reduce((sum, face) => sum + face.areaSquareMeters, 0);
  const fallbackShare = wallArea > 0 ? fallbackArea / wallArea : 0;

  if (facadeOnlyFallbackReport.length > 0) {
    const bar = options.fallbackAreaShareBar;
    if (bar === undefined || options.allowFacadeOnlyFallback !== true) {
      throw new FarTierCellStop(input.cellId, "zone-aggregate-missing", `Cell ${input.cellId} has ${facadeOnlyFallbackReport.length} zone(s) with no aggregate and no bar was supplied to judge them against.`, { zones: facadeOnlyFallbackReport });
    }
    if (fallbackShare > bar) {
      throw new FarTierCellStop(input.cellId, "fallback-share-over-bar", `Cell ${input.cellId} would carry v1's facade-only colour on ${(fallbackShare * 100).toFixed(3)} per cent of its wall area, over the pre-registered bar of ${(bar * 100).toFixed(3)} per cent.`, {
        zones: facadeOnlyFallbackReport,
        fallbackAreaShare: fallbackShare,
        bar,
      });
    }
  }

  const rgb = bakeFarTierAtlas(packing);
  const geometry = farTierGeometry(packing);
  const delivered = farTierDeliveredQuality(packing.texelWorldSizeMeters);
  const aggregate = aggregateReport.reduce((accumulated, report) => ({
    inScope: accumulated.inScope + report.inScopeAreaSquareMeters,
    attributed: accumulated.attributed + report.attributedAreaSquareMeters,
  }), { inScope: 0, attributed: 0 });

  return {
    packing,
    rgb,
    geometry,
    members,
    fallbackZones: facadeOnlyFallbackReport,
    unitySnaps: unitySnapReport,
    telemetry: {
      cellId: input.cellId,
      recipeId: options.recipe.recipeId as string,
      faceCount: packing.faces.length,
      wallFaceCount: wallFaces.length,
      flatFaceCount: packing.flatFaceCount,
      atlasPixels: packing.atlasPixels,
      appliedScale: packing.appliedScale,
      texelWorldSizeMeters: packing.texelWorldSizeMeters,
      achievedTexelRatio: delivered.achievedRatio,
      underResolved: delivered.underResolved,
      criticalDistanceMeters: delivered.criticalDistanceMeters,
      occupancy: packing.occupancy,
      surfaceAreaSquareMeters: surfaceArea,
      wallAreaSquareMeters: wallArea,
      includedBuildings: members.filter((member) => member.included).length,
      refusedBuildings: members.filter((member) => !member.included).length,
      unitySnapCount: unitySnapReport.length,
      fallbackZoneCount: facadeOnlyFallbackReport.length,
      fallbackAreaSquareMeters: fallbackArea,
      fallbackAreaShare: fallbackShare,
      aggregateInScopeAreaSquareMeters: aggregate.inScope,
      aggregateAttributedAreaSquareMeters: aggregate.attributed,
    },
  };
}


/**
 * THE PER-CELL ADDITIVITY GATE, and the one case where it cannot run.
 *
 * The gate proves that the adopted recipe's code path reproduces v1 EXACTLY
 * when both of its switches are off — facade-only colour and v1 packing. That
 * is a property of the rasterizer, and it is worth checking on every cell
 * rather than on the one the prototype froze.
 *
 * BUT IT CANNOT BE CHECKED ON A CELL v1 CANNOT PACK. Under v1 a face costs at
 * least (4 + 2x2)^2 = 64 texels, so a 256px atlas holds 1,024 faces; under v4 a
 * flat face costs (1 + 2x1)^2 = 9, so it holds 7,281. Midtown has cells of
 * 1,031 to 1,853 faces that v4 packs comfortably and v1 cannot pack at all.
 *
 * An earlier version of this campaign ran the v1 reference FIRST and let its
 * refusal propagate, which recorded 22 Midtown cells as `packing-infeasible`
 * under a recipe that packs them fine. The tiles were never wrong — they were
 * never built. That is the failure mode this function exists to prevent: the
 * gate now reports NOT-APPLICABLE with its reason instead of vetoing the cell,
 * and every other refusal from the reference bake still propagates.
 */
export interface FarTierAdditivityGate {
  applicable: boolean;
  verdict: "PASS" | "FAIL" | "not-applicable";
  v1AtlasSha256: string | null;
  reason: string | null;
}

export function farTierAdditivityGate(
  input: FarTierCellInput,
  adoptedRecipe: Record<string, unknown>,
  encodeAtlas: (bake: FarTierCellBake) => string,
): FarTierAdditivityGate {
  let reference: FarTierCellBake;
  try {
    reference = bakeFarTierCell(input, { recipe: FAR_TIER_BAKE_RECIPE, zoneColourMode: "facade-only" });
  } catch (error) {
    if (error instanceof FarTierCellStop && error.code === "packing-infeasible") {
      return {
        applicable: false,
        verdict: "not-applicable",
        v1AtlasSha256: null,
        reason: `v1 cannot pack this cell (${error.message}), so there is no v1 atlas to reproduce. The cell is NOT refused for it.`,
      };
    }
    throw error;
  }
  const asAdopted = bakeFarTierCell(input, { recipe: adoptedRecipe, zoneColourMode: "facade-only", packingRecipe: FAR_TIER_BAKE_RECIPE });
  const referenceSha = encodeAtlas(reference);
  const adoptedSha = encodeAtlas(asAdopted);
  return {
    applicable: true,
    verdict: referenceSha === adoptedSha ? "PASS" : "FAIL",
    v1AtlasSha256: referenceSha,
    reason: referenceSha === adoptedSha ? null : `the adopted recipe with both switches off produced ${adoptedSha} against v1's ${referenceSha}`,
  };
}

/** The v1 packing recipe, for the additivity check the campaign runs per cell. */
export const FAR_TIER_V1_PACKING_RECIPE = FAR_TIER_BAKE_RECIPE;

/** Effective parameters a caller can log beside a bake without re-deriving them. */
export function farTierCampaignParameters(recipe: Record<string, unknown>) {
  return farTierEffectiveParameters(recipe);
}
