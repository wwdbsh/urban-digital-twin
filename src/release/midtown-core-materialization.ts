/**
 * Midtown-core offline materialization: V2 plans and canonical GLBs for every
 * building the derived-subset ledger owns.
 *
 * This is a NEW SIBLING of the hard-pinned Block 835 modules. It imports the
 * shared, building-agnostic primitives from them — the V2 tessellator, the ENU
 * mapping, the oriented-rectangle footprint proxy, the canonical GLB writer —
 * and owns only what must differ for a wave release: its own seed, tool
 * identity, generation instant, and parameter derivation. The Block 835 modules
 * are never edited and their emitted bytes never move.
 *
 * Parameter derivation
 * --------------------
 * `midtownCoreV2Parameters` is arithmetically identical to the Block 835
 * successor derivation except for two added clamps that keep the V2 rooftop
 * guard satisfiable on very small footprints:
 *
 *   1. `setbackInsetMm` is additionally clamped so the cumulative setback leaves
 *      a crown of at least `MINIMUM_CROWN_MM`;
 *   2. `waterTankRadiusMm` is additionally clamped so `crown > 2 * radius +
 *      ROOFTOP_CLEARANCE_MM`, which is exactly the V2 validator's rule.
 *
 * Both clamps are provably NON-BINDING above roughly a 2.2 m minimum footprint
 * dimension (clamp 1) and a 2.7 m crown (clamp 2), so they change no parameter
 * for any ordinarily sized building. `midtown-core-materialization.test.ts`
 * proves this by asserting that, for all fourteen Block 835 buildings, this
 * derivation reproduces the pinned `buildSuccessorPlan` parameters exactly.
 *
 * Measured on the committed midtown-core subset: without the clamps 8 of 7,201
 * buildings fail the V2 rooftop guard (every one with a minimum footprint
 * dimension below 2.91 m, against 3.08 m for the smallest building that
 * passes). With the clamps 7 of those 8 generate valid plans. The eighth,
 * `doitt:1273172`, has a 1.108 m minimum dimension and cannot carry the grammar
 * at any parameter choice; it is refused with an explicit deterministic stop
 * rather than given invented geometry, and ships as a tombstone.
 */

import {
  DETERMINISTIC_FACADE_V2_SCHEMA_VERSION,
  generateV2FacadePlan,
  validateV2Plan,
  type V2Input,
  type V2Plan,
} from "../domain/deterministic-facade-generator-v2.ts";
import { sha256HexBytes, sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";
import { writeCanonicalGlb, type CanonicalGlbMaterial, type CanonicalGlbQuad } from "./canonical-glb.ts";
import {
  BLOCK835_QUALITY_BUDGETS,
  enuFrame,
  orientedFootprintRectangle,
  toEnuMeters,
  toGltfYUp,
  type EnuFrame,
  type OrientedRectangle,
} from "./block835-reference-package.ts";
import { tessellateV2Plan } from "./block835-successor-package.ts";
import { MIDTOWN_CORE_RELEASE_ID } from "./midtown-core-package.ts";

// ---------------------------------------------------------------------------
// Declared generation identity
// ---------------------------------------------------------------------------

export const MIDTOWN_CORE_GENERATED_AT = "2026-08-11T00:00:00.000Z" as const;
export const MIDTOWN_CORE_SEED = "manhattan-midtown-core-20260811" as const;
export const MIDTOWN_CORE_TOOL = { id: "urban-digital-twin:midtown-core-materialization", version: "1.0.0" } as const;

/** Two LODs per building, matching the accepted exterior LOD profile. */
export const MIDTOWN_CORE_LOD_IDS = ["lod_0", "lod_1"] as const;
export type MidtownCoreLodId = (typeof MIDTOWN_CORE_LOD_IDS)[number];
export const MIDTOWN_CORE_LOD0_MAX_DISTANCE_METERS = 250 as const;
export const MIDTOWN_CORE_LOD1_GEOMETRIC_ERROR_METERS = 0.2 as const;

const OPENING_INSET_MM = 200;
const TARGET_FLOOR_HEIGHT_MM = 3_600;
const MAX_BAYS = 8;
/** The V2 validator's rooftop clearance term, mirrored exactly. */
const ROOFTOP_CLEARANCE_MM = 2_000;
/** Smallest crown that can host a minimum-radius tank under that rule. */
const MINIMUM_CROWN_MM = ROOFTOP_CLEARANCE_MM + 3;

/**
 * The two added small-footprint clamps, exported so the offline pipeline can
 * fingerprint them: editing either changes every plan and every emitted GLB, so
 * a stage receipt taken before the edit must not be reusable after it.
 */
export const MIDTOWN_CORE_PARAMETER_CLAMPS = {
  rooftopClearanceMm: ROOFTOP_CLEARANCE_MM,
  minimumCrownMm: MINIMUM_CROWN_MM,
} as const;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Closed refusal vocabulary for a building this grammar cannot describe. */
export const MIDTOWN_CORE_STOP_CODES = [
  "absent-from-base-shards",
  "degenerate-footprint",
  "footprint-below-grammar-minimum",
  "plan-generation-failed",
  "plan-validation-failed",
  "asset-budget-exceeded",
] as const;
export type MidtownCoreStopCode = (typeof MIDTOWN_CORE_STOP_CODES)[number];

export class MidtownCoreStop extends Error {
  readonly code: MidtownCoreStopCode;
  readonly buildingId: string;
  constructor(buildingId: string, code: MidtownCoreStopCode, detail: string) {
    super(`${buildingId} [${code}]: ${detail}`);
    this.name = "MidtownCoreStop";
    this.code = code;
    this.buildingId = buildingId;
  }
}

/**
 * Derives the V2 parameter set for one footprint.
 *
 * Throws `footprint-below-grammar-minimum` when no parameter choice can satisfy
 * the V2 rooftop guard, rather than emitting geometry the source cannot support.
 */
export function midtownCoreV2Parameters(
  buildingId: string,
  widthMm: number,
  depthMm: number,
  rawHeightMm: number,
): { parameters: V2Input["parameters"]; heightMm: number } {
  const minimumDimension = Math.min(widthMm, depthMm);
  const bayCount = clamp(Math.floor(minimumDimension / 4_000), 2, MAX_BAYS);
  const minimumBay = Math.floor(minimumDimension / bayCount);
  const floorCount = clamp(Math.round(rawHeightMm / TARGET_FLOOR_HEIGHT_MM), 2, 512);
  const floorHeightMm = Math.max(1, Math.round(rawHeightMm / floorCount));
  const heightMm = floorCount * floorHeightMm;
  const usableBay = minimumBay - OPENING_INSET_MM * 2;
  if (usableBay < 2) {
    throw new MidtownCoreStop(buildingId, "footprint-below-grammar-minimum", `Bay of ${minimumBay} mm is too narrow for the V2 opening inset.`);
  }
  const windowSillMm = Math.floor(floorHeightMm * 0.25);
  const corniceHeightMm = Math.max(1, Math.floor(floorHeightMm * 0.08));
  const windowHeightMm = Math.max(1, floorHeightMm - windowSillMm - corniceHeightMm - Math.floor(floorHeightMm * 0.12));
  const entranceHeightMm = Math.max(1, Math.floor(floorHeightMm * 0.62));
  const storefrontHeightMm = Math.max(1, Math.floor(floorHeightMm * 0.55));
  const signBandHeightMm = Math.max(1, Math.min(Math.floor(floorHeightMm * 0.16), floorHeightMm - entranceHeightMm - 1));
  const tierCount = clamp(2 + Math.floor(floorCount / 24), 2, 5);
  const maximumInsetTotal = Math.floor((minimumDimension - Math.floor(minimumDimension / 3)) / 2);
  // Added clamp 1: keep a crown of at least MINIMUM_CROWN_MM. Non-binding above
  // roughly a 2.2 m minimum dimension, where minimumDimension/24 is smaller.
  const crownLimitedInset = Math.floor((minimumDimension - MINIMUM_CROWN_MM) / (2 * (tierCount - 1)));
  const setbackInsetMm = Math.max(1, Math.min(
    Math.floor(minimumDimension / 24),
    Math.floor(maximumInsetTotal / Math.max(1, tierCount - 1)),
    crownLimitedInset,
  ));
  const crownDimension = minimumDimension - (tierCount - 1) * setbackInsetMm * 2;
  // Added clamp 2: the V2 validator requires
  //   (tierCount - 1) * setbackInsetMm * 2 < minimumDimension - 2 * radius - 2000,
  // which is exactly `crownDimension > 2 * radius + ROOFTOP_CLEARANCE_MM`.
  // Non-binding above a ~2.7 m crown, where crownDimension/8 is smaller.
  const clearanceLimitedRadius = Math.floor((crownDimension - ROOFTOP_CLEARANCE_MM - 1) / 2);
  const waterTankRadiusMm = Math.max(1, Math.min(1_800, Math.floor(crownDimension / 8), clearanceLimitedRadius));
  if (crownDimension <= 2 * waterTankRadiusMm + ROOFTOP_CLEARANCE_MM) {
    throw new MidtownCoreStop(
      buildingId,
      "footprint-below-grammar-minimum",
      `Crown of ${crownDimension} mm cannot clear a minimum rooftop tank; the ${minimumDimension} mm footprint is below the V2 grammar minimum.`,
    );
  }
  return {
    heightMm,
    parameters: {
      floorCount, bayCount, floorHeightMm,
      windowWidthMm: Math.max(1, Math.floor(usableBay * 0.6)),
      windowHeightMm, windowSillMm, openingInsetMm: OPENING_INSET_MM,
      entranceWidthMm: Math.max(1, Math.floor(usableBay * 0.5)),
      entranceHeightMm, storefrontHeightMm, corniceHeightMm,
      roofEquipmentSizeMm: Math.max(1, Math.floor(crownDimension / 4)),
      tierCount, setbackInsetMm,
      balconyDepthMm: Math.max(1, Math.min(900, Math.floor(minimumDimension / 24))),
      balconyHeightMm: Math.max(1, Math.floor(floorHeightMm * 0.09)),
      balconyFloorInterval: floorCount >= 24 ? 4 : 3,
      fireEscapeWidthMm: Math.max(1, Math.min(2_400, Math.floor(minimumBay * 0.7))),
      fireEscapeDepthMm: Math.max(1, Math.min(1_100, Math.floor(minimumDimension / 20))),
      fireEscapePlatformHeightMm: Math.max(1, Math.floor(floorHeightMm * 0.06)),
      waterTankSides: 8,
      waterTankRadiusMm,
      waterTankHeightMm: Math.max(1, Math.floor(waterTankRadiusMm * 1.6)),
      waterTankLegHeightMm: Math.max(1, Math.floor(waterTankRadiusMm * 1.2)),
      waterTankLegSizeMm: Math.max(1, Math.floor(waterTankRadiusMm / 6)),
      signBandHeightMm,
      signBandDepthMm: Math.max(1, Math.floor(OPENING_INSET_MM * 0.9)),
      bladeSignWidthMm: Math.max(1, Math.min(900, Math.floor(usableBay * 0.3))),
      bladeSignHeightMm: Math.max(1, Math.min(Math.floor(floorHeightMm * 0.5), floorHeightMm - corniceHeightMm - Math.max(entranceHeightMm, storefrontHeightMm) - 1)),
      bladeSignDepthMm: Math.max(1, Math.min(900, Math.floor(minimumDimension / 24))),
    },
  };
}

// ---------------------------------------------------------------------------
// Source adaptation
// ---------------------------------------------------------------------------

/** One accepted building of the pinned citywide snapshot. */
export interface MidtownCoreBuildingSource {
  buildingId: string;
  /** Representative point `[longitude, latitude]` in WGS84 degrees. */
  representative: readonly [number, number];
  /** Closed outer ring in WGS84 degrees, first vertex repeated last. */
  outerRing: ReadonlyArray<readonly [number, number]>;
  heightMeters: number | null;
  heightUnknown: boolean;
  sourceRefId: string;
  sourceRecordId: string;
}

/** Fallback used only when the snapshot carries no height, and disclosed as such. */
export const MIDTOWN_CORE_FALLBACK_HEIGHT_METERS = 10 as const;

export interface MidtownCorePlanContext {
  source: MidtownCoreBuildingSource;
  frame: EnuFrame;
  rectangle: OrientedRectangle;
  plan: V2Plan;
  heightSource: "source" | "fallback";
  widthMm: number;
  depthMm: number;
}

/**
 * Builds and fully validates the V2 plan for one building.
 *
 * Generation alone does not run the V2 validator, so the validator is always
 * applied: it carries the surface containment and overlap guard.
 */
export function buildMidtownCorePlan(source: MidtownCoreBuildingSource, baseManifestChecksumSha256: string): MidtownCorePlanContext {
  const ring = source.outerRing.length > 1
    && source.outerRing[0]![0] === source.outerRing[source.outerRing.length - 1]![0]
    && source.outerRing[0]![1] === source.outerRing[source.outerRing.length - 1]![1]
    ? source.outerRing.slice(0, -1)
    : [...source.outerRing];
  if (ring.length < 3) {
    throw new MidtownCoreStop(source.buildingId, "degenerate-footprint", `Outer ring carries ${ring.length} distinct vertices.`);
  }
  const frame = enuFrame({ longitude: source.representative[0], latitude: source.representative[1] });
  let rectangle: OrientedRectangle;
  try {
    rectangle = orientedFootprintRectangle(ring.map((point) => toEnuMeters(frame, point)));
  } catch (error) {
    throw new MidtownCoreStop(source.buildingId, "degenerate-footprint", error instanceof Error ? error.message : String(error));
  }
  const widthMm = Math.round(rectangle.widthMeters * 1_000);
  const depthMm = Math.round(rectangle.depthMeters * 1_000);
  const heightSource: "source" | "fallback" = source.heightMeters === null || source.heightUnknown ? "fallback" : "source";
  const rawHeightMm = Math.round((heightSource === "fallback" ? MIDTOWN_CORE_FALLBACK_HEIGHT_METERS : source.heightMeters!) * 1_000);
  const { parameters, heightMm } = midtownCoreV2Parameters(source.buildingId, widthMm, depthMm, rawHeightMm);
  const halfWidth = Math.round(widthMm / 2);
  const halfDepth = Math.round(depthMm / 2);
  const input: V2Input = {
    schemaVersion: DETERMINISTIC_FACADE_V2_SCHEMA_VERSION,
    buildingId: source.buildingId,
    generatedAt: MIDTOWN_CORE_GENERATED_AT,
    seed: MIDTOWN_CORE_SEED,
    tool: { ...MIDTOWN_CORE_TOOL },
    geometry: {
      unit: "millimeter",
      footprint: { outer: [[-halfWidth, -halfDepth], [halfWidth, -halfDepth], [halfWidth, halfDepth], [-halfWidth, halfDepth]], holes: [] },
      baseElevationMm: 0,
      heightMm,
    },
    sourceAnchors: [
      {
        id: `${source.buildingId}:anchor:footprint`,
        kind: "footprint",
        sourceRefId: source.sourceRefId,
        // The anchor is bound to the pinned base manifest, so a plan can never
        // silently claim provenance from a different snapshot.
        fingerprintSha256: sha256HexSync(stableSerialize({ outerRing: source.outerRing, baseManifestChecksumSha256 })),
      },
      {
        id: `${source.buildingId}:anchor:height`,
        kind: "height",
        sourceRefId: source.sourceRefId,
        fingerprintSha256: sha256HexSync(stableSerialize({ heightMeters: source.heightMeters, heightUnknown: source.heightUnknown, heightSource, baseManifestChecksumSha256 })),
      },
    ],
    parameters,
  };
  const generated = generateV2FacadePlan(input);
  if (!generated.ok) {
    throw new MidtownCoreStop(source.buildingId, "plan-generation-failed", generated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
  const validated = validateV2Plan(generated.value);
  if (!validated.ok) {
    throw new MidtownCoreStop(source.buildingId, "plan-validation-failed", validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
  return { source, frame, rectangle, plan: validated.value, heightSource, widthMm, depthMm };
}

// ---------------------------------------------------------------------------
// Canonical GLB emission
// ---------------------------------------------------------------------------

export interface MidtownCoreAssetBytes {
  lodId: MidtownCoreLodId;
  relativeRef: string;
  bytes: Uint8Array;
  checksumSha256: string;
  counts: { triangleCount: number; materialCount: number; textureCount: number };
}

/**
 * Maps plan-local millimetres into the building-anchored ENU metre frame.
 *
 * Identical arithmetic to the Block 835 successor mapping, but it reads only the
 * oriented rectangle, so this module needs no pilot-shaped building record.
 * `midtown-core-materialization.test.ts` asserts the two agree exactly.
 */
export function midtownCorePlanToEnu(rectangle: OrientedRectangle, quads: readonly CanonicalGlbQuad[]): CanonicalGlbQuad[] {
  const [axisX, axisY] = rectangle.axis;
  const [centerX, centerY] = rectangle.center;
  const map = (corner: readonly [number, number, number]): [number, number, number] => {
    const localEast = corner[0] / 1_000;
    const localNorth = corner[1] / 1_000;
    return [centerX + localEast * axisX - localNorth * axisY, centerY + localEast * axisY + localNorth * axisX, corner[2] / 1_000];
  };
  return quads.map((quad) => ({
    materialIndex: quad.materialIndex,
    corners: [map(quad.corners[0]), map(quad.corners[1]), map(quad.corners[2]), map(quad.corners[3])],
  }));
}

export function midtownCoreAssetRef(buildingId: string, lodId: MidtownCoreLodId): string {
  return `public/assets/${buildingId.replace(":", "-")}__${lodId}.glb`;
}

export function midtownCoreInventoryId(buildingId: string): string {
  return `inventory:${MIDTOWN_CORE_RELEASE_ID}:${buildingId}`;
}

export function midtownCoreEvidenceShardId(buildingId: string): string {
  return `evidence-shard:${MIDTOWN_CORE_RELEASE_ID}:${buildingId}`;
}

/**
 * Writes both canonical GLBs for one planned building.
 *
 * The inventory and evidence-shard ids are baked into the GLB `extras`, so a
 * shipped asset always names the records that justify it.
 */
export function writeMidtownCoreAssets(
  context: MidtownCorePlanContext,
  options: { ownerCellId: string; capturedAt: string | null; updatedAt: string | null },
): MidtownCoreAssetBytes[] {
  const plan = context.plan;
  const buildingId = context.source.buildingId;
  const inventoryId = midtownCoreInventoryId(buildingId);
  const inventoryHashSha256 = sha256HexSync(stableSerialize(plan.inventory));
  const truthTiers = [...new Set(plan.inventory.components.map((component) => component.state))].sort();
  if (truthTiers.length !== 1 || truthTiers[0] !== "generated") {
    throw new MidtownCoreStop(buildingId, "plan-validation-failed", `V2 assets must be entirely generated; declared ${truthTiers.join(", ")}.`);
  }
  const assets: MidtownCoreAssetBytes[] = [];
  for (const [lodIndex, lodId] of MIDTOWN_CORE_LOD_IDS.entries()) {
    const tessellated: { quads: CanonicalGlbQuad[]; materials: CanonicalGlbMaterial[] } =
      tessellateV2Plan(plan, { includeRecesses: lodIndex === 0 });
    const quads = midtownCorePlanToEnu(context.rectangle, tessellated.quads);
    const metadata = {
      canonicalFeatureId: buildingId,
      lodId,
      ownerCellId: options.ownerCellId,
      inventoryId,
      inventoryHashSha256,
      evidenceShardId: midtownCoreEvidenceShardId(buildingId),
      truthTiers,
      sourceDates: { capturedAt: options.capturedAt, updatedAt: options.updatedAt },
      // First generation of this wave: no superseded asset to cite. The closed
      // GLB metadata schema requires the field, so it is explicitly null rather
      // than omitted.
      predecessor: null,
      uncertainty: plan.uncertainty,
      planHashSha256: plan.planHashSha256,
    };
    const written = writeCanonicalGlb({ quads: toGltfYUp(quads), materials: tessellated.materials, metadata });
    if (
      written.counts.triangleCount > BLOCK835_QUALITY_BUDGETS.maxTriangles
      || written.counts.materialCount > BLOCK835_QUALITY_BUDGETS.maxMaterials
      || written.counts.textureCount !== 0
    ) {
      throw new MidtownCoreStop(
        buildingId,
        "asset-budget-exceeded",
        `${lodId} declares ${written.counts.triangleCount} triangles / ${written.counts.materialCount} materials / ${written.counts.textureCount} textures.`,
      );
    }
    assets.push({
      lodId,
      relativeRef: midtownCoreAssetRef(buildingId, lodId),
      bytes: written.bytes,
      checksumSha256: sha256HexBytes(written.bytes),
      counts: written.counts,
    });
  }
  return assets;
}
