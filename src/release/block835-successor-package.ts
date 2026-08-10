/**
 * Successor package `manhattan-esb-block-reference-20260811`.
 *
 * Same pinned pilot source and same canonical byte pipeline as the frozen
 * `20260810` package, but planned by the V2 generative-completion grammar, so
 * every one of the fifteen required exterior component kinds ships as real
 * geometry with truth tier `generated`. The `20260810` package is never edited:
 * it stays byte-frozen and this package cites it as its predecessor.
 *
 * Two things differ from `20260810` beyond the grammar:
 *   - evidence shard ids are truthful per-building ids rather than the
 *     no-evidence sentinel, because the canary release graph carries a real
 *     source/license/approval shard for every building;
 *   - LOD 1 keeps every protruding component and drops only recesses and flush
 *     trim, so the measured silhouette deviation stays at zero even though V2
 *     adds balconies, fire escapes, sign bands and rooftop tanks.
 */

import {
  DETERMINISTIC_FACADE_V2_SCHEMA_VERSION,
  DETERMINISTIC_FACADE_V2_UNCERTAINTY,
  generateV2FacadePlan,
  validateV2Plan,
  type V2Input,
  type V2Placement,
  type V2Plan,
  type V2Prism,
  type V2Surface,
} from "../domain/deterministic-facade-generator-v2.ts";
import { sha256HexBytes, sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";
import { writeCanonicalGlb, type CanonicalGlbMaterial, type CanonicalGlbQuad, type Vec3 } from "./canonical-glb.ts";
import {
  BLOCK835_CELL_ID,
  BLOCK835_CITY_ID,
  BLOCK835_CONFIG_ID,
  BLOCK835_LOD0_MAX_DISTANCE_METERS,
  BLOCK835_PILOT_RELEASE_ID,
  BLOCK835_QUALITY_BUDGETS,
  BLOCK835_REGISTRATION_TOLERANCE,
  BLOCK835_SUCCESSOR_PACKAGE_ID,
  deriveBaseIdentityChecksum,
  enuFrame,
  orientedFootprintRectangle,
  readPilotBuildings,
  toEnuMeters,
  toGltfYUp,
  type EnuFrame,
  type OrientedRectangle,
  type PilotBuildingSource,
  type RegistrationEntry,
  type SilhouetteMeasurementFile,
} from "./block835-reference-package.ts";
import type { AssemblyAsset, AssemblyLod, ComponentTruthTier, ImmutablePin, MultiLodAssemblyManifest } from "./multi-lod-assembly.ts";

export const BLOCK835_SUCCESSOR_GENERATED_AT = "2026-08-11T00:00:00.000Z" as const;
export const BLOCK835_SUCCESSOR_SEED = "block-835-reference-20260811" as const;
export const BLOCK835_SUCCESSOR_TOOL = { id: "urban-digital-twin:block835-successor", version: "2.0.0" } as const;
export const BLOCK835_SUCCESSOR_BASE_IDENTITY_SET_ID = "base-identity-set:manhattan:block-835:20260811" as const;
export const BLOCK835_SUCCESSOR_OWNERSHIP_LEDGER_ID = "ownership-ledger:manhattan:block-835:20260811" as const;
/** LOD 1 keeps the massing envelope plus every protrusion, so its silhouette matches LOD 0 exactly. */
export const BLOCK835_SUCCESSOR_LOD1_GEOMETRIC_ERROR_METERS = 0.2 as const;

const OPENING_INSET_MM = 200;
const TARGET_FLOOR_HEIGHT_MM = 3_600;
const MAX_BAYS = 8;

function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function clamp(value: number, minimum: number, maximum: number): number { return Math.min(maximum, Math.max(minimum, value)); }

/** Truthful per-building evidence shard id; the canary graph carries a real shard for each. */
export function successorEvidenceShardId(canonicalBuildingId: string): string {
  return `evidence-shard:${BLOCK835_SUCCESSOR_PACKAGE_ID}:${canonicalBuildingId}`;
}
export function successorInventoryId(canonicalBuildingId: string): string {
  return `inventory:${BLOCK835_SUCCESSOR_PACKAGE_ID}:${canonicalBuildingId}`;
}

export interface SuccessorPlanContext { building: PilotBuildingSource; frame: EnuFrame; rectangle: OrientedRectangle; plan: V2Plan }

function v2Parameters(widthMm: number, depthMm: number, rawHeightMm: number): { parameters: V2Input["parameters"]; heightMm: number } {
  const minimumDimension = Math.min(widthMm, depthMm);
  const bayCount = clamp(Math.floor(minimumDimension / 4_000), 2, MAX_BAYS);
  const minimumBay = Math.floor(minimumDimension / bayCount);
  const floorCount = clamp(Math.round(rawHeightMm / TARGET_FLOOR_HEIGHT_MM), 2, 512);
  const floorHeightMm = Math.max(1, Math.round(rawHeightMm / floorCount));
  const heightMm = floorCount * floorHeightMm;
  const usableBay = minimumBay - OPENING_INSET_MM * 2;
  if (usableBay < 2) throw new Error("Footprint is too narrow for the V2 bay grid.");
  const windowSillMm = Math.floor(floorHeightMm * 0.25);
  const corniceHeightMm = Math.max(1, Math.floor(floorHeightMm * 0.08));
  const windowHeightMm = Math.max(1, floorHeightMm - windowSillMm - corniceHeightMm - Math.floor(floorHeightMm * 0.12));
  const entranceHeightMm = Math.max(1, Math.floor(floorHeightMm * 0.62));
  const storefrontHeightMm = Math.max(1, Math.floor(floorHeightMm * 0.55));
  const signBandHeightMm = Math.max(1, Math.min(Math.floor(floorHeightMm * 0.16), floorHeightMm - entranceHeightMm - 1));
  // Tiers scale with height so tall towers step more than low-rise blocks, but
  // every building gets at least two tiers: setbacks are always real geometry.
  const tierCount = clamp(2 + Math.floor(floorCount / 24), 2, 5);
  const maximumInsetTotal = Math.floor((minimumDimension - Math.floor(minimumDimension / 3)) / 2);
  const setbackInsetMm = Math.max(1, Math.min(Math.floor(minimumDimension / 24), Math.floor(maximumInsetTotal / Math.max(1, tierCount - 1))));
  const crownDimension = minimumDimension - (tierCount - 1) * setbackInsetMm * 2;
  const waterTankRadiusMm = Math.max(1, Math.min(1_800, Math.floor(crownDimension / 8)));
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
      // A blade sign hangs off the ground floor, so it must terminate below the
      // tier cornice; without this clamp a low building would push it past the
      // top of its own facade.
      bladeSignHeightMm: Math.max(1, Math.min(Math.floor(floorHeightMm * 0.5), floorHeightMm - corniceHeightMm - Math.max(entranceHeightMm, storefrontHeightMm) - 1)),
      bladeSignDepthMm: Math.max(1, Math.min(900, Math.floor(minimumDimension / 24))),
    },
  };
}

export function buildSuccessorPlan(building: PilotBuildingSource): SuccessorPlanContext {
  const frame = enuFrame(building.anchor);
  const rectangle = orientedFootprintRectangle(building.footprint.map((point) => toEnuMeters(frame, point)));
  const widthMm = Math.round(rectangle.widthMeters * 1_000);
  const depthMm = Math.round(rectangle.depthMeters * 1_000);
  const { parameters, heightMm } = v2Parameters(widthMm, depthMm, Math.round(building.heightMeters * 1_000));
  const halfWidth = Math.round(widthMm / 2); const halfDepth = Math.round(depthMm / 2);
  const sourceRefId = building.sourceRefIds[0] ?? `source-ref:${building.doittId}`;
  const input: V2Input = {
    schemaVersion: DETERMINISTIC_FACADE_V2_SCHEMA_VERSION,
    buildingId: building.canonicalBuildingId,
    generatedAt: BLOCK835_SUCCESSOR_GENERATED_AT,
    seed: BLOCK835_SUCCESSOR_SEED,
    tool: { ...BLOCK835_SUCCESSOR_TOOL },
    geometry: { unit: "millimeter", footprint: { outer: [[-halfWidth, -halfDepth], [halfWidth, -halfDepth], [halfWidth, halfDepth], [-halfWidth, halfDepth]], holes: [] }, baseElevationMm: 0, heightMm },
    sourceAnchors: [
      { id: `${building.canonicalBuildingId}:anchor:footprint`, kind: "footprint", sourceRefId, fingerprintSha256: sha256HexSync(stableSerialize({ footprint: building.footprint, licenseRefIds: building.licenseRefIds })) },
      { id: `${building.canonicalBuildingId}:anchor:height`, kind: "height", sourceRefId, fingerprintSha256: sha256HexSync(stableSerialize({ heightMeters: building.heightMeters })) },
    ],
    parameters,
  };
  const generated = generateV2FacadePlan(input);
  if (!generated.ok) throw new Error(`V2 facade plan failed for ${building.canonicalBuildingId}: ${generated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
  // Validation only, never serialization: the shipped plan must clear the full
  // V2 validator, including the surface containment and overlap guard that
  // caught the blade-sign overrun. Generation alone does not run it.
  const validated = validateV2Plan(generated.value);
  if (!validated.ok) throw new Error(`V2 facade plan failed validation for ${building.canonicalBuildingId}: ${validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
  return { building, frame, rectangle, plan: validated.value };
}

// ---------------------------------------------------------------------------
// V2 tessellation
// ---------------------------------------------------------------------------

type Mutable3 = [number, number, number];
function subtract(left: readonly number[], right: readonly number[]): Mutable3 { return [left[0]! - right[0]!, left[1]! - right[1]!, left[2]! - right[2]!]; }
function normalize(value: Mutable3): Mutable3 {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length === 0) throw new Error("Surface ring is degenerate.");
  return [value[0] / length, value[1] / length, value[2] / length];
}
function crossProduct(left: Mutable3, right: Mutable3): Mutable3 {
  return [left[1] * right[2] - left[2] * right[1], left[2] * right[0] - left[0] * right[2], left[0] * right[1] - left[1] * right[0]];
}

/**
 * Signed placement depth in millimetres: positive recesses into the surface,
 * negative extrudes outward. Only strict protrusions change a silhouette, which
 * is what makes the LOD 1 composition below measurably lossless.
 */
export function v2PlacementDepthMm(placement: V2Placement, parameters: V2Input["parameters"], equipmentHeightMm: number): number {
  switch (placement.kind) {
    case "window": case "entrance": case "storefront": return parameters.openingInsetMm;
    case "cornice": return 0;
    case "roof-equipment": return -equipmentHeightMm;
    case "balcony": return -parameters.balconyDepthMm;
    case "fire-escape": return -parameters.fireEscapeDepthMm;
    case "sign-band": return -parameters.signBandDepthMm;
    case "blade-sign": return -parameters.bladeSignDepthMm;
    default: return 0;
  }
}

export function successorRoofEquipmentHeightMm(plan: V2Plan): number {
  return Math.min(1_200, Math.max(1, Math.floor(plan.input.parameters.roofEquipmentSizeMm / 4)));
}

/** Even-sided ring fan: quad j covers ring vertices 0, 2j+1, 2j+2, 2j+3. */
function capQuads(ring: readonly (readonly [number, number])[], z: number, upward: boolean): Array<[Vec3, Vec3, Vec3, Vec3]> {
  const ordered = upward ? [...ring] : [...ring].reverse();
  const quads: Array<[Vec3, Vec3, Vec3, Vec3]> = [];
  // An even-sided ring fans into exactly (n - 2) / 2 quads anchored at vertex 0,
  // which keeps the cap inside the quad-only canonical GLB writer.
  for (let index = 0; 2 * index + 3 <= ordered.length - 1; index += 1) {
    const base = 2 * index;
    const a = ordered[0]!; const b = ordered[base + 1]!; const c = ordered[base + 2]!; const d = ordered[base + 3]!;
    quads.push([[a[0], a[1], z], [b[0], b[1], z], [c[0], c[1], z], [d[0], d[1], z]]);
  }
  return quads;
}

function prismQuads(prism: V2Prism, materialIndex: number): CanonicalGlbQuad[] {
  const quads: CanonicalGlbQuad[] = [];
  const ring = prism.ring;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index]!; const next = ring[(index + 1) % ring.length]!;
    quads.push({ materialIndex, corners: [[current[0], current[1], prism.baseZMm], [next[0], next[1], prism.baseZMm], [next[0], next[1], prism.topZMm], [current[0], current[1], prism.topZMm]] });
  }
  for (const corners of capQuads(ring, prism.topZMm, true)) quads.push({ materialIndex, corners });
  for (const corners of capQuads(ring, prism.baseZMm, false)) quads.push({ materialIndex, corners });
  return quads;
}

export interface V2TessellationOptions { includeRecesses: boolean }

export function tessellateV2Plan(plan: V2Plan, options: V2TessellationOptions): { quads: CanonicalGlbQuad[]; materials: CanonicalGlbMaterial[] } {
  const materialIndexById = new Map(plan.materials.map((material, index) => [material.id, index]));
  const materials: CanonicalGlbMaterial[] = plan.materials.map((material) => ({
    baseColorFactor: [material.baseColorSrgb[0] / 255, material.baseColorSrgb[1] / 255, material.baseColorSrgb[2] / 255, material.baseColorSrgb[3] / 255],
    metallicFactor: material.metallicPermille / 1_000,
    roughnessFactor: material.roughnessPermille / 1_000,
  }));
  const materialIndexOf = (id: string): number => {
    const index = materialIndexById.get(id);
    if (index === undefined) throw new Error(`V2 plan cites an undeclared material: ${id}`);
    return index;
  };
  const parameters = plan.input.parameters;
  const equipmentHeightMm = successorRoofEquipmentHeightMm(plan);
  const quads: CanonicalGlbQuad[] = [];

  const surfaceFrame = (surface: V2Surface) => {
    const [p0, p1, , p3] = surface.ring;
    const uDir = normalize(subtract(p1!, p0!));
    const vDir = normalize(subtract(p3!, p0!));
    return { origin: p0!, uDir, vDir, normal: crossProduct(uDir, vDir) };
  };

  for (const surface of plan.surfaces) {
    const frame = surfaceFrame(surface);
    const point = (u: number, v: number, depth: number): Vec3 => [
      frame.origin[0] + frame.uDir[0] * u + frame.vDir[0] * v - frame.normal[0] * depth,
      frame.origin[1] + frame.uDir[1] * u + frame.vDir[1] * v - frame.normal[1] * depth,
      frame.origin[2] + frame.uDir[2] * u + frame.vDir[2] * v - frame.normal[2] * depth,
    ];
    const surfacePlacements = plan.placements
      .filter((placement) => placement.surfaceId === surface.id)
      .filter((placement) => options.includeRecesses || v2PlacementDepthMm(placement, parameters, equipmentHeightMm) < 0)
      .sort((left, right) => left.bounds.vMinMm - right.bounds.vMinMm || left.bounds.uMinMm - right.bounds.uMinMm || compareText(left.id, right.id));

    const breaks = [...new Set([0, surface.vLengthMm, ...surfacePlacements.flatMap((placement) => [placement.bounds.vMinMm, placement.bounds.vMaxMm])])].sort((left, right) => left - right);
    for (let index = 0; index + 1 < breaks.length; index += 1) {
      const vMin = breaks[index]!; const vMax = breaks[index + 1]!;
      if (vMax <= vMin) continue;
      const skips = surfacePlacements
        .filter((placement) => placement.bounds.vMinMm <= vMin && placement.bounds.vMaxMm >= vMax)
        .map((placement) => ({ minimum: placement.bounds.uMinMm, maximum: placement.bounds.uMaxMm }))
        .sort((left, right) => left.minimum - right.minimum);
      let cursor = 0;
      for (const skip of skips) {
        if (skip.minimum > cursor) quads.push({ materialIndex: materialIndexOf(surface.materialId), corners: [point(cursor, vMin, 0), point(skip.minimum, vMin, 0), point(skip.minimum, vMax, 0), point(cursor, vMax, 0)] });
        cursor = Math.max(cursor, skip.maximum);
      }
      if (cursor < surface.uLengthMm) quads.push({ materialIndex: materialIndexOf(surface.materialId), corners: [point(cursor, vMin, 0), point(surface.uLengthMm, vMin, 0), point(surface.uLengthMm, vMax, 0), point(cursor, vMax, 0)] });
    }

    for (const placement of surfacePlacements) {
      const { uMinMm, vMinMm, uMaxMm, vMaxMm } = placement.bounds;
      const materialIndex = materialIndexOf(placement.materialId);
      const depth = v2PlacementDepthMm(placement, parameters, equipmentHeightMm);
      quads.push({ materialIndex, corners: [point(uMinMm, vMinMm, depth), point(uMaxMm, vMinMm, depth), point(uMaxMm, vMaxMm, depth), point(uMinMm, vMaxMm, depth)] });
      if (depth === 0) continue;
      quads.push({ materialIndex, corners: [point(uMinMm, vMinMm, 0), point(uMaxMm, vMinMm, 0), point(uMaxMm, vMinMm, depth), point(uMinMm, vMinMm, depth)] });
      quads.push({ materialIndex, corners: [point(uMinMm, vMaxMm, depth), point(uMaxMm, vMaxMm, depth), point(uMaxMm, vMaxMm, 0), point(uMinMm, vMaxMm, 0)] });
      quads.push({ materialIndex, corners: [point(uMinMm, vMinMm, depth), point(uMinMm, vMaxMm, depth), point(uMinMm, vMaxMm, 0), point(uMinMm, vMinMm, 0)] });
      quads.push({ materialIndex, corners: [point(uMaxMm, vMinMm, 0), point(uMaxMm, vMaxMm, 0), point(uMaxMm, vMaxMm, depth), point(uMaxMm, vMinMm, depth)] });
    }
  }

  // Rooftop prisms ship in both LODs: they are large protrusions and dropping
  // them would move the silhouette.
  for (const prism of plan.prisms) quads.push(...prismQuads(prism, materialIndexOf(prism.materialId)));
  return { quads, materials };
}

export function successorPlanToEnu(context: SuccessorPlanContext, quads: readonly CanonicalGlbQuad[]): CanonicalGlbQuad[] {
  const [axisX, axisY] = context.rectangle.axis;
  const [centerX, centerY] = context.rectangle.center;
  const map = (corner: Vec3): Vec3 => {
    const localEast = corner[0] / 1_000; const localNorth = corner[1] / 1_000;
    return [centerX + localEast * axisX - localNorth * axisY, centerY + localEast * axisY + localNorth * axisX, corner[2] / 1_000];
  };
  return quads.map((quad) => ({ materialIndex: quad.materialIndex, corners: [map(quad.corners[0]), map(quad.corners[1]), map(quad.corners[2]), map(quad.corners[3])] }));
}

const ENVELOPE_EPSILON_METERS = 1e-3;

export function successorRegistrationEntry(context: SuccessorPlanContext, exported: readonly CanonicalGlbQuad[]): RegistrationEntry {
  const rectangle = context.rectangle;
  const [axisX, axisY] = rectangle.axis;
  const halfWidth = rectangle.widthMeters / 2; const halfDepth = rectangle.depthMeters / 2;
  const localCorners: Array<readonly [number, number]> = [[-halfWidth, -halfDepth], [halfWidth, -halfDepth], [halfWidth, halfDepth], [-halfWidth, halfDepth]];
  const expectedCorners = localCorners.map((corner) => [rectangle.center[0] + corner[0] * axisX - corner[1] * axisY, rectangle.center[1] + corner[0] * axisY + corner[1] * axisX] as const);
  let minimumZ = Number.POSITIVE_INFINITY; let maximumZ = Number.NEGATIVE_INFINITY;
  const observed: Array<readonly [number, number]> = [];
  for (const quad of exported) for (const corner of quad.corners) {
    observed.push([corner[0], corner[1]]);
    if (corner[2] < minimumZ) minimumZ = corner[2];
    if (corner[2] > maximumZ) maximumZ = corner[2];
  }
  let horizontal = 0;
  for (const expected of expectedCorners) {
    let nearest = Number.POSITIVE_INFINITY;
    for (const point of observed) nearest = Math.min(nearest, Math.hypot(point[0] - expected[0], point[1] - expected[1]));
    horizontal = Math.max(horizontal, nearest);
  }
  const roofElevation = context.plan.input.geometry.heightMm / 1_000;
  if (!exported.some((quad) => quad.corners.some((corner) => Math.abs(corner[2] - roofElevation) <= ENVELOPE_EPSILON_METERS))) {
    throw new Error(`Exported geometry for ${context.building.canonicalBuildingId} has no vertex on its declared roof plane.`);
  }
  const vertical = Math.abs(roofElevation - minimumZ - context.building.heightMeters);
  return {
    canonicalBuildingId: context.building.canonicalBuildingId,
    horizontalDeviationMeters: horizontal,
    verticalDeviationMeters: vertical,
    sourceHeightMeters: context.building.heightMeters,
    exportedRoofElevationMeters: roofElevation - minimumZ,
    exportedMaxElevationMeters: maximumZ - minimumZ,
    withinTolerance: horizontal <= BLOCK835_REGISTRATION_TOLERANCE.horizontalMeters && vertical <= BLOCK835_REGISTRATION_TOLERANCE.verticalMeters,
  };
}

// ---------------------------------------------------------------------------
// Successor package assembly
// ---------------------------------------------------------------------------

export interface SuccessorPredecessorPins {
  /** The `20260810` cell-release pin this successor supersedes. */
  cellRelease: ImmutablePin;
  /** Per-building `20260810` asset pins, keyed by canonical building id. */
  assets: ReadonlyMap<string, ImmutablePin>;
}

export interface AssembledSuccessor {
  manifest: MultiLodAssemblyManifest;
  contents: Map<string, Uint8Array>;
  plans: V2Plan[];
  registration: RegistrationEntry[];
  ownershipLedger: Record<string, unknown>;
}

interface BoundingBox { minimum: Mutable3; maximum: Mutable3 }
function quadBounds(quads: readonly CanonicalGlbQuad[]): BoundingBox {
  const minimum: Mutable3 = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const maximum: Mutable3 = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const quad of quads) for (const corner of quad.corners) for (let axis = 0; axis < 3; axis += 1) {
    if (corner[axis]! < minimum[axis]!) minimum[axis] = corner[axis]!;
    if (corner[axis]! > maximum[axis]!) maximum[axis] = corner[axis]!;
  }
  return { minimum, maximum };
}
function tileBox(bounds: BoundingBox): number[] {
  const half = (axis: number): number => Math.max((bounds.maximum[axis]! - bounds.minimum[axis]!) / 2, 1e-3);
  return [
    (bounds.minimum[0]! + bounds.maximum[0]!) / 2,
    (bounds.minimum[1]! + bounds.maximum[1]!) / 2,
    (bounds.minimum[2]! + bounds.maximum[2]!) / 2,
    half(0), 0, 0, 0, half(1), 0, 0, 0, half(2),
  ];
}

/** Reads the `20260810` manifest and derives the successor's predecessor pins. */
export function successorPredecessorPins(previousManifest: MultiLodAssemblyManifest): SuccessorPredecessorPins {
  const assets = new Map<string, ImmutablePin>();
  for (const asset of previousManifest.assets) {
    const finest = asset.lods.find((lod) => lod.lodId === "lod_0") ?? asset.lods[0]!;
    const artifact = previousManifest.artifacts.find((entry) => entry.relativeRef === finest.artifactRef);
    if (!artifact) throw new Error(`Predecessor manifest has no artifact for ${asset.canonicalFeatureId}.`);
    assets.set(asset.canonicalFeatureId, { id: `${previousManifest.packageId}:${asset.canonicalFeatureId}:${finest.lodId}`, checksumSha256: artifact.checksumSha256 });
  }
  return { cellRelease: { ...previousManifest.cells[0]!.cellRelease }, assets };
}

export function assembleBlock835SuccessorPackage(options: {
  release: unknown;
  releaseChecksumSha256: string;
  measurements: SilhouetteMeasurementFile;
  predecessor: SuccessorPredecessorPins;
}): AssembledSuccessor {
  const buildings = readPilotBuildings(options.release);
  const buildingIds = buildings.map((building) => building.canonicalBuildingId);
  const baseChecksum = deriveBaseIdentityChecksum(buildingIds);
  const measurementById = new Map(options.measurements.buildings.map((entry) => [entry.canonicalBuildingId, entry]));

  const blockAnchor = {
    longitude: (Math.min(...buildings.map((building) => building.anchor.longitude)) + Math.max(...buildings.map((building) => building.anchor.longitude))) / 2,
    latitude: (Math.min(...buildings.map((building) => building.anchor.latitude)) + Math.max(...buildings.map((building) => building.anchor.latitude))) / 2,
  };
  const blockFrame = enuFrame(blockAnchor);

  const contents = new Map<string, Uint8Array>();
  const artifacts: MultiLodAssemblyManifest["artifacts"] = [];
  const assets: AssemblyAsset[] = [];
  const plans: V2Plan[] = [];
  const registration: RegistrationEntry[] = [];
  const tileChains: Array<Record<string, unknown>> = [];
  const blockBounds: BoundingBox = { minimum: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY], maximum: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY] };

  for (const building of buildings) {
    const context = buildSuccessorPlan(building);
    const plan = context.plan;
    plans.push(plan);
    const inventoryId = successorInventoryId(building.canonicalBuildingId);
    const inventoryHashSha256 = sha256HexSync(stableSerialize(plan.inventory));
    const truthTiers = [...new Set(plan.inventory.components.map((component) => component.state as ComponentTruthTier))].sort(compareText);
    if (truthTiers.length !== 1 || truthTiers[0] !== "generated") throw new Error(`V2 assets must be entirely generated: ${building.canonicalBuildingId} declared ${truthTiers.join(", ")}.`);
    const measurement = measurementById.get(building.canonicalBuildingId);
    if (!measurement) throw new Error(`Missing Blender silhouette measurement for ${building.canonicalBuildingId}.`);
    if (measurement.planHashSha256 !== plan.planHashSha256) throw new Error(`Silhouette measurement for ${building.canonicalBuildingId} is bound to a different plan hash.`);
    const predecessor = options.predecessor.assets.get(building.canonicalBuildingId);
    if (!predecessor) throw new Error(`Missing 20260810 predecessor pin for ${building.canonicalBuildingId}.`);

    const offset = toEnuMeters(blockFrame, [building.anchor.longitude, building.anchor.latitude]);
    const lods: AssemblyLod[] = [];
    const chain: Array<Record<string, unknown>> = [];
    for (const [lodIndex, lodId] of ["lod_0", "lod_1"].entries()) {
      const tessellated = tessellateV2Plan(plan, { includeRecesses: lodIndex === 0 });
      const quads = successorPlanToEnu(context, tessellated.quads);
      if (lodIndex === 0) registration.push(successorRegistrationEntry(context, quads));
      const relativeRef = `private/assets/${building.canonicalBuildingId.replace(":", "-")}__${lodId}.glb`;
      const metadata = {
        canonicalFeatureId: building.canonicalBuildingId,
        lodId,
        ownerCellId: BLOCK835_CELL_ID,
        inventoryId,
        inventoryHashSha256,
        evidenceShardId: successorEvidenceShardId(building.canonicalBuildingId),
        truthTiers,
        sourceDates: { capturedAt: building.capturedAt, updatedAt: building.updatedAt },
        predecessor,
        uncertainty: DETERMINISTIC_FACADE_V2_UNCERTAINTY,
        planHashSha256: plan.planHashSha256,
      };
      const written = writeCanonicalGlb({ quads: toGltfYUp(quads), materials: tessellated.materials, metadata });
      if (written.counts.triangleCount > BLOCK835_QUALITY_BUDGETS.maxTriangles || written.counts.materialCount > BLOCK835_QUALITY_BUDGETS.maxMaterials || written.counts.textureCount !== 0) {
        throw new Error(`Successor ${building.canonicalBuildingId} ${lodId} exceeds the approved asset budgets (${written.counts.triangleCount} triangles, ${written.counts.materialCount} materials).`);
      }
      contents.set(relativeRef, written.bytes);
      artifacts.push({ logicalId: `glb:${building.canonicalBuildingId}:${lodId}`, role: "glb", relativeRef, byteSize: written.bytes.byteLength, checksumSha256: sha256HexBytes(written.bytes), ownerCellId: BLOCK835_CELL_ID });
      lods.push({
        lodId, artifactRef: relativeRef,
        geometricErrorMeters: lodIndex === 0 ? 0 : BLOCK835_SUCCESSOR_LOD1_GEOMETRIC_ERROR_METERS,
        maxDistanceMeters: lodIndex === 0 ? BLOCK835_LOD0_MAX_DISTANCE_METERS : null,
        eligible: true,
        quality: { ...written.counts, budgets: { ...BLOCK835_QUALITY_BUDGETS } },
        silhouette: lodIndex === 0 ? null : {
          status: "authoring-declared", method: "projected-silhouette-ratio", metricVersion: "1.0",
          planHashSha256: plan.planHashSha256, viewIds: [...measurement.viewIds].sort(compareText), deviationRatio: measurement.deviationRatio, maximumRatio: 0.02,
        },
      });
      const bounds = quadBounds(quads);
      for (let axis = 0; axis < 3; axis += 1) {
        const shift = axis === 2 ? 0 : offset[axis]!;
        blockBounds.minimum[axis] = Math.min(blockBounds.minimum[axis]!, bounds.minimum[axis]! + shift);
        blockBounds.maximum[axis] = Math.max(blockBounds.maximum[axis]!, bounds.maximum[axis]! + shift);
      }
      chain.push({ boundingVolume: { box: tileBox(bounds) }, geometricError: lodIndex === 0 ? 0 : BLOCK835_SUCCESSOR_LOD1_GEOMETRIC_ERROR_METERS, refine: "REPLACE", content: { uri: `../assets/${building.canonicalBuildingId.replace(":", "-")}__${lodId}.glb` } });
    }
    const coarse = chain[1]!; const fine = chain[0]!;
    coarse.transform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, offset[0], offset[1], 0, 1];
    coarse.children = [fine];
    tileChains.push(coarse);

    assets.push({
      canonicalFeatureId: building.canonicalBuildingId,
      ownerCellId: BLOCK835_CELL_ID,
      inventoryId, inventoryHashSha256,
      evidenceShardId: successorEvidenceShardId(building.canonicalBuildingId),
      truthTiers,
      sourceDates: { capturedAt: building.capturedAt, updatedAt: building.updatedAt },
      predecessor,
      uncertainty: DETERMINISTIC_FACADE_V2_UNCERTAINTY,
      source: { kind: "facade-plan", planId: plan.planId, planHashSha256: plan.planHashSha256 },
      lods,
    });
  }

  const tilesetRef = "private/tiles/tileset.json";
  const tileset = {
    asset: { version: "1.1" },
    geometricError: 1,
    root: { boundingVolume: { box: tileBox(blockBounds) }, geometricError: 1, refine: "REPLACE", children: tileChains },
  };
  const tilesetBytes = new TextEncoder().encode(JSON.stringify(tileset));
  contents.set(tilesetRef, tilesetBytes);
  artifacts.push({ logicalId: `tileset:${BLOCK835_SUCCESSOR_PACKAGE_ID}`, role: "tileset-json", relativeRef: tilesetRef, byteSize: tilesetBytes.byteLength, checksumSha256: sha256HexBytes(tilesetBytes), ownerCellId: null });

  const ownershipLedger = {
    ledgerId: BLOCK835_SUCCESSOR_OWNERSHIP_LEDGER_ID,
    cityId: BLOCK835_CITY_ID,
    configId: BLOCK835_CONFIG_ID,
    baseIdentitySet: { id: BLOCK835_SUCCESSOR_BASE_IDENTITY_SET_ID, buildingCount: buildingIds.length, checksumSha256: baseChecksum },
    cells: [{ cellId: BLOCK835_CELL_ID, order: 0, buildingIds: [...buildingIds].sort(), membershipChecksumSha256: baseChecksum }],
    derivedFrom: { releaseId: BLOCK835_PILOT_RELEASE_ID, checksumSha256: options.releaseChecksumSha256 },
  };

  const manifest: MultiLodAssemblyManifest = {
    schemaVersion: "1.0",
    packageId: BLOCK835_SUCCESSOR_PACKAGE_ID,
    audience: "private",
    generatedAt: BLOCK835_SUCCESSOR_GENERATED_AT,
    immutable: true,
    release: {
      rootId: `private:${BLOCK835_SUCCESSOR_PACKAGE_ID}`,
      rootChecksumSha256: options.releaseChecksumSha256,
      releaseId: BLOCK835_PILOT_RELEASE_ID,
      cityId: BLOCK835_CITY_ID,
      configId: BLOCK835_CONFIG_ID,
      privatePredecessor: null,
    },
    baseIdentitySet: { id: BLOCK835_SUCCESSOR_BASE_IDENTITY_SET_ID, checksumSha256: baseChecksum },
    ownershipLedger: { id: BLOCK835_SUCCESSOR_OWNERSHIP_LEDGER_ID, checksumSha256: sha256HexSync(stableSerialize(ownershipLedger)) },
    cells: [{
      cellId: BLOCK835_CELL_ID,
      cellRelease: { id: BLOCK835_SUCCESSOR_PACKAGE_ID, checksumSha256: sha256HexSync(stableSerialize(ownershipLedger)) },
      // Package-level lineage: this package supersedes the frozen 20260810 one.
      predecessor: { ...options.predecessor.cellRelease },
      buildingIds: [...buildingIds].sort(),
      membershipChecksumSha256: baseChecksum,
    }],
    assets, artifacts, tilesetRef,
    declaredTotalBytes: artifacts.reduce((sum, artifact) => sum + artifact.byteSize, 0),
  };

  return { manifest, contents, plans, registration, ownershipLedger };
}
