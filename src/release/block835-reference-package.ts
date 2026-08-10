/**
 * Deterministic assembly of the Block 835 generated-exterior reference package.
 *
 * Every byte is a pure function of the pinned pilot release
 * (`manhattan-esb-block-exterior-pilot-20260805`), the deterministic facade
 * plans derived from it, and the Blender-measured silhouette record. No
 * external source is read, no evidence is admitted, and no truth tier above
 * `generated` is ever produced: the repository holds zero rights-cleared
 * exterior evidence for Block 835, so `evidence-backed` would be a false claim.
 */

import {
  DETERMINISTIC_FACADE_SCHEMA_VERSION,
  DETERMINISTIC_FACADE_UNCERTAINTY,
  generateDeterministicFacadePlan,
  type DeterministicFacadeInput,
  type DeterministicFacadePlan,
  type FacadePlacement,
  type FacadeSurface,
  type Point3Mm,
} from "../domain/deterministic-facade-generator.ts";
import { sha256HexBytes, sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";
import { writeCanonicalGlb, type CanonicalGlbMaterial, type CanonicalGlbQuad, type Vec3 } from "./canonical-glb.ts";
import type { AssemblyAsset, AssemblyLod, ComponentTruthTier, MultiLodAssemblyManifest } from "./multi-lod-assembly.ts";

export const BLOCK835_REFERENCE_PACKAGE_ID = "manhattan-esb-block-reference-20260810" as const;
export const BLOCK835_REFERENCE_GENERATED_AT = "2026-08-10T00:00:00.000Z" as const;
export const BLOCK835_REFERENCE_SEED = "block-835-reference-20260810" as const;
export const BLOCK835_REFERENCE_TOOL = { id: "urban-digital-twin:block835-reference", version: "1.0.0" } as const;
export const BLOCK835_PILOT_RELEASE_ID = "manhattan-esb-block-exterior-pilot-20260805" as const;
export const BLOCK835_CITY_ID = "manhattan" as const;
export const BLOCK835_CONFIG_ID = "manhattan-esb-block-835" as const;
export const BLOCK835_CELL_ID = "cell:manhattan:block-835" as const;
export const BLOCK835_BASE_IDENTITY_SET_ID = "base-identity-set:manhattan:block-835:20260810" as const;
export const BLOCK835_OWNERSHIP_LEDGER_ID = "ownership-ledger:manhattan:block-835:20260810" as const;
/**
 * Explicit no-evidence sentinel. The assembly contract requires a non-empty
 * evidence shard ID; naming the absence is safer than pointing at a shard that
 * does not exist or reusing an unrelated approved shard.
 */
export const BLOCK835_NO_EVIDENCE_SHARD_ID = "evidence-shard:none:block-835-reference-20260810" as const;
export const BLOCK835_QUALITY_BUDGETS = { maxTriangles: 75_000, maxMaterials: 8, maxTextures: 0 } as const;
export const BLOCK835_REGISTRATION_TOLERANCE = { horizontalMeters: 0.25, verticalMeters: 0.5 } as const;
export const BLOCK835_LOD1_GEOMETRIC_ERROR_METERS = 0.2 as const;
export const BLOCK835_LOD0_MAX_DISTANCE_METERS = 250 as const;
export const WGS84_METERS_PER_DEGREE_LAT = 111_320 as const;

const OPENING_INSET_MM = 200;
const TARGET_FLOOR_HEIGHT_MM = 3_600;
const MAX_BAYS = 8;

function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

// ---------------------------------------------------------------------------
// Pinned pilot source
// ---------------------------------------------------------------------------

export interface PilotBuildingSource {
  canonicalBuildingId: string;
  doittId: string;
  anchor: { longitude: number; latitude: number };
  footprint: Array<readonly [number, number]>;
  heightMeters: number;
  sourceRefIds: string[];
  licenseRefIds: string[];
  attribution: string;
  capturedAt: string | null;
  updatedAt: string | null;
  predecessor: { id: string; checksumSha256: string };
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number in the pinned pilot release.`);
  return value;
}
function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be a non-empty string in the pinned pilot release.`);
  return value;
}

/** Reads the 14 Block 835 buildings out of the pinned pilot release, failing closed on any drift. */
export function readPilotBuildings(release: unknown): PilotBuildingSource[] {
  if (!record(release) || !record(release.boundaryRule) || !Array.isArray(release.boundaryRule.buildings)) throw new Error("Pilot release is missing boundaryRule.buildings.");
  if (release.releaseId !== BLOCK835_PILOT_RELEASE_ID) throw new Error("Pilot release identity does not match the pinned Block 835 exterior pilot.");
  const assets = record(release.assets) && Array.isArray(release.assets.assets) ? release.assets.assets : null;
  if (!assets) throw new Error("Pilot release is missing its asset manifest.");
  const assetById = new Map<string, Record<string, unknown>>();
  for (const asset of assets) if (record(asset) && typeof asset.canonicalFeatureId === "string") assetById.set(asset.canonicalFeatureId, asset);

  const buildings = release.boundaryRule.buildings.map((raw) => {
    if (!record(raw)) throw new Error("Pilot building entry must be an object.");
    const canonicalBuildingId = requireText(raw.canonicalBuildingId, "canonicalBuildingId");
    if (!canonicalBuildingId.startsWith("doitt:")) throw new Error(`Unexpected canonical building namespace: ${canonicalBuildingId}`);
    const asset = assetById.get(canonicalBuildingId);
    if (!asset || !record(asset.lineage) || !record(asset.capture) || !Array.isArray(asset.lodVariants)) throw new Error(`Pilot asset lineage is missing for ${canonicalBuildingId}.`);
    const lineage = asset.lineage;
    const lod0 = asset.lodVariants[0];
    if (!record(lod0) || !record(lod0.content)) throw new Error(`Pilot LOD0 pin is missing for ${canonicalBuildingId}.`);
    if (!record(raw.geometry) || !Array.isArray(raw.geometry.coordinates) || !Array.isArray(raw.geometry.coordinates[0])) throw new Error(`Pilot footprint geometry is missing for ${canonicalBuildingId}.`);
    const ring = (raw.geometry.coordinates[0] as unknown[]).map((point) => {
      if (!Array.isArray(point) || point.length < 2) throw new Error(`Pilot footprint vertex is malformed for ${canonicalBuildingId}.`);
      return [requireNumber(point[0], "longitude"), requireNumber(point[1], "latitude")] as const;
    });
    const closed = ring.length > 1 && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1];
    const footprint = closed ? ring.slice(0, -1) : ring;
    if (footprint.length < 3) throw new Error(`Pilot footprint for ${canonicalBuildingId} has fewer than three vertices.`);
    const centroid = raw.centroid;
    if (!Array.isArray(centroid) || centroid.length !== 2) throw new Error(`Pilot centroid is missing for ${canonicalBuildingId}.`);
    return {
      canonicalBuildingId,
      doittId: requireText(raw.doittId, "doittId"),
      anchor: { longitude: requireNumber(centroid[0], "anchor longitude"), latitude: requireNumber(centroid[1], "anchor latitude") },
      footprint,
      heightMeters: requireNumber(raw.heightMeters, "heightMeters"),
      sourceRefIds: [...new Set((Array.isArray(lineage.sourceRefIds) ? lineage.sourceRefIds : []).map((id) => requireText(id, "sourceRefId")))].sort(compareText),
      licenseRefIds: [...new Set((Array.isArray(lineage.licenseRefIds) ? lineage.licenseRefIds : []).map((id) => requireText(id, "licenseRefId")))].sort(compareText),
      attribution: requireText(lineage.attribution, "attribution"),
      capturedAt: typeof asset.capture.capturedAt === "string" ? asset.capture.capturedAt : null,
      updatedAt: typeof asset.capture.updatedAt === "string" ? asset.capture.updatedAt : null,
      predecessor: { id: `${BLOCK835_PILOT_RELEASE_ID}:${canonicalBuildingId}:lod0`, checksumSha256: requireText(lod0.content.sha256, "pilot LOD0 checksum") },
    } satisfies PilotBuildingSource;
  });
  if (buildings.length === 0) throw new Error("Pilot release declares no Block 835 buildings.");
  const ids = buildings.map((building) => building.canonicalBuildingId);
  if (new Set(ids).size !== ids.length) throw new Error("Pilot release repeats a canonical building ID.");
  return buildings.sort((left, right) => compareText(left.canonicalBuildingId, right.canonicalBuildingId));
}

/** Base identity checksum uses the exact ownership rule in `exterior-release.ts`. */
export function deriveBaseIdentityChecksum(buildingIds: readonly string[]): string {
  return sha256HexSync(stableSerialize([...buildingIds].sort()));
}

// ---------------------------------------------------------------------------
// Local ENU frame and oriented footprint rectangle
// ---------------------------------------------------------------------------

export interface EnuFrame { metersPerDegreeLongitude: number; anchor: { longitude: number; latitude: number } }
export type Point2 = readonly [number, number];

export function enuFrame(anchor: { longitude: number; latitude: number }): EnuFrame {
  return { anchor, metersPerDegreeLongitude: WGS84_METERS_PER_DEGREE_LAT * Math.cos(anchor.latitude * Math.PI / 180) };
}
export function toEnuMeters(frame: EnuFrame, point: Point2): Point2 {
  return [(point[0] - frame.anchor.longitude) * frame.metersPerDegreeLongitude, (point[1] - frame.anchor.latitude) * WGS84_METERS_PER_DEGREE_LAT];
}

function cross2(origin: Point2, left: Point2, right: Point2): number {
  return (left[0] - origin[0]) * (right[1] - origin[1]) - (left[1] - origin[1]) * (right[0] - origin[0]);
}

/** Deterministic monotone-chain convex hull; input order is already canonical. */
function convexHull(points: readonly Point2[]): Point2[] {
  const sorted = [...points].sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const build = (source: readonly Point2[]): Point2[] => {
    const chain: Point2[] = [];
    for (const point of source) {
      while (chain.length >= 2 && cross2(chain[chain.length - 2]!, chain[chain.length - 1]!, point) <= 0) chain.pop();
      chain.push(point);
    }
    chain.pop();
    return chain;
  };
  if (sorted.length < 3) return [...sorted];
  return [...build(sorted), ...build([...sorted].reverse())];
}

export interface OrientedRectangle {
  /** Unit east/north axis taken from a hull edge; derived with sqrt only, so it is bit-reproducible. */
  axis: Point2;
  center: Point2;
  widthMeters: number;
  depthMeters: number;
}

/**
 * Minimum-area oriented bounding rectangle of the source footprint.
 *
 * The deterministic facade generator's V1 contract accepts one axis-aligned
 * rectangle per building, so the shipped massing is this rectangle, not the
 * source polygon. That abstraction is disclosed in the ADR, the implementation
 * record and the plan uncertainty; the registration gate measures drift of the
 * rectangle through the pipeline, never shape fidelity to the polygon.
 */
export function orientedFootprintRectangle(points: readonly Point2[]): OrientedRectangle {
  const hull = convexHull(points);
  if (hull.length < 3) throw new Error("Footprint does not form a non-degenerate hull.");
  let best: OrientedRectangle | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (let index = 0; index < hull.length; index += 1) {
    const from = hull[index]!;
    const to = hull[(index + 1) % hull.length]!;
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (length === 0) continue;
    const axis: Point2 = [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
    let minU = Number.POSITIVE_INFINITY; let maxU = Number.NEGATIVE_INFINITY;
    let minV = Number.POSITIVE_INFINITY; let maxV = Number.NEGATIVE_INFINITY;
    for (const point of hull) {
      const u = point[0] * axis[0] + point[1] * axis[1];
      const v = -point[0] * axis[1] + point[1] * axis[0];
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const width = maxU - minU; const depth = maxV - minV; const area = width * depth;
    if (area < bestArea) {
      const centerU = (minU + maxU) / 2; const centerV = (minV + maxV) / 2;
      bestArea = area;
      best = { axis, center: [centerU * axis[0] - centerV * axis[1], centerU * axis[1] + centerV * axis[0]], widthMeters: width, depthMeters: depth };
    }
  }
  if (!best) throw new Error("Footprint does not admit an oriented bounding rectangle.");
  return best;
}

// ---------------------------------------------------------------------------
// Deterministic facade plans
// ---------------------------------------------------------------------------

export interface BuildingPlanContext {
  building: PilotBuildingSource;
  frame: EnuFrame;
  rectangle: OrientedRectangle;
  plan: DeterministicFacadePlan;
}

function clamp(value: number, minimum: number, maximum: number): number { return Math.min(maximum, Math.max(minimum, value)); }

function facadeParameters(widthMm: number, depthMm: number, rawHeightMm: number): { parameters: DeterministicFacadeInput["parameters"]; heightMm: number } {
  const minimumDimension = Math.min(widthMm, depthMm);
  const bayCount = clamp(Math.floor(minimumDimension / 4_000), 2, MAX_BAYS);
  const minimumBay = Math.floor(minimumDimension / bayCount);
  const floorCount = clamp(Math.round(rawHeightMm / TARGET_FLOOR_HEIGHT_MM), 2, 512);
  // Never round the storey height up to a nominal value: the product of floors
  // and storey height is the shipped roof elevation and must stay inside the
  // registration tolerance of the sourced `heightMeters`.
  const floorHeightMm = Math.max(1, Math.round(rawHeightMm / floorCount));
  const heightMm = floorCount * floorHeightMm;
  const usableBay = minimumBay - OPENING_INSET_MM * 2;
  if (usableBay < 2) throw new Error("Footprint is too narrow for the V1 deterministic bay grid.");
  const windowSillMm = Math.floor(floorHeightMm * 0.25);
  const corniceHeightMm = Math.max(1, Math.floor(floorHeightMm * 0.08));
  const windowHeightMm = Math.max(1, floorHeightMm - windowSillMm - corniceHeightMm - Math.floor(floorHeightMm * 0.12));
  return {
    heightMm,
    parameters: {
      floorCount,
      bayCount,
      floorHeightMm,
      windowWidthMm: Math.max(1, Math.floor(usableBay * 0.6)),
      windowHeightMm,
      windowSillMm,
      openingInsetMm: OPENING_INSET_MM,
      entranceWidthMm: Math.max(1, Math.floor(usableBay * 0.5)),
      entranceHeightMm: Math.max(1, Math.floor(floorHeightMm * 0.8)),
      storefrontHeightMm: Math.max(1, Math.floor(floorHeightMm * 0.7)),
      corniceHeightMm,
      roofEquipmentSizeMm: Math.max(1, Math.floor(minimumDimension / 4)),
    },
  };
}

export function buildBuildingPlan(building: PilotBuildingSource): BuildingPlanContext {
  const frame = enuFrame(building.anchor);
  const rectangle = orientedFootprintRectangle(building.footprint.map((point) => toEnuMeters(frame, point)));
  const widthMm = Math.round(rectangle.widthMeters * 1_000);
  const depthMm = Math.round(rectangle.depthMeters * 1_000);
  const { parameters, heightMm } = facadeParameters(widthMm, depthMm, Math.round(building.heightMeters * 1_000));
  const halfWidth = Math.round(widthMm / 2); const halfDepth = Math.round(depthMm / 2);
  const sourceRefId = building.sourceRefIds[0] ?? `source-ref:${building.doittId}`;
  const input: DeterministicFacadeInput = {
    schemaVersion: DETERMINISTIC_FACADE_SCHEMA_VERSION,
    buildingId: building.canonicalBuildingId,
    generatedAt: BLOCK835_REFERENCE_GENERATED_AT,
    seed: BLOCK835_REFERENCE_SEED,
    tool: { ...BLOCK835_REFERENCE_TOOL },
    geometry: { unit: "millimeter", footprint: { outer: [[-halfWidth, -halfDepth], [halfWidth, -halfDepth], [halfWidth, halfDepth], [-halfWidth, halfDepth]], holes: [] }, baseElevationMm: 0, heightMm },
    sourceAnchors: [
      { id: `${building.canonicalBuildingId}:anchor:footprint`, kind: "footprint", sourceRefId, fingerprintSha256: sha256HexSync(stableSerialize({ footprint: building.footprint, licenseRefIds: building.licenseRefIds })) },
      { id: `${building.canonicalBuildingId}:anchor:height`, kind: "height", sourceRefId, fingerprintSha256: sha256HexSync(stableSerialize({ heightMeters: building.heightMeters })) },
    ],
    parameters,
  };
  const generated = generateDeterministicFacadePlan(input);
  if (!generated.ok) throw new Error(`Deterministic facade plan failed for ${building.canonicalBuildingId}: ${generated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
  return { building, frame, rectangle, plan: generated.value };
}

// ---------------------------------------------------------------------------
// Plan -> canonical mesh
// ---------------------------------------------------------------------------

type Mutable3 = [number, number, number];

function subtract(left: Point3Mm, right: Point3Mm): Mutable3 { return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]; }
function normalize(value: Mutable3): Mutable3 {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length === 0) throw new Error("Surface ring is degenerate.");
  return [value[0] / length, value[1] / length, value[2] / length];
}
function crossProduct(left: Mutable3, right: Mutable3): Mutable3 {
  return [left[1] * right[2] - left[2] * right[1], left[2] * right[0] - left[0] * right[2], left[0] * right[1] - left[1] * right[0]];
}

interface SurfaceFrame { origin: Point3Mm; uDir: Mutable3; vDir: Mutable3; normal: Mutable3 }
function surfaceFrame(surface: FacadeSurface): SurfaceFrame {
  const [p0, p1, , p3] = surface.ring;
  const uDir = normalize(subtract(p1!, p0!));
  const vDir = normalize(subtract(p3!, p0!));
  return { origin: p0!, uDir, vDir, normal: crossProduct(uDir, vDir) };
}

interface Interval { minimum: number; maximum: number }

/** Placement depth in millimetres: positive recesses into the surface, negative extrudes outward. */
function placementDepthMm(placement: FacadePlacement, insetMm: number, equipmentHeightMm: number): number {
  switch (placement.kind) {
    case "window": case "entrance": case "storefront": return insetMm;
    case "roof-equipment": return -equipmentHeightMm;
    case "cornice": return 0;
    default: return 0;
  }
}

/**
 * Height of the generated rooftop appurtenance, capped at 1.2 m.
 *
 * `roof-equipment` is a required component kind that the approved deterministic
 * generator declares `generated`, so it is authored rather than suppressed; the
 * cap keeps the unsourced volume above the sourced roof elevation small, and
 * the registration report publishes both elevations so it is never hidden.
 */
export function roofEquipmentHeightMm(plan: DeterministicFacadePlan): number {
  return Math.min(1_200, Math.max(1, Math.floor(plan.input.parameters.roofEquipmentSizeMm / 4)));
}

export function tessellatePlan(plan: DeterministicFacadePlan, options: { includeFacadeDetail: boolean }): { quads: CanonicalGlbQuad[]; materials: CanonicalGlbMaterial[] } {
  const materialIndexById = new Map(plan.materials.map((material, index) => [material.id, index]));
  const materials: CanonicalGlbMaterial[] = plan.materials.map((material) => ({
    baseColorFactor: [material.baseColorSrgb[0] / 255, material.baseColorSrgb[1] / 255, material.baseColorSrgb[2] / 255, material.baseColorSrgb[3] / 255],
    metallicFactor: material.metallicPermille / 1_000,
    roughnessFactor: material.roughnessPermille / 1_000,
  }));
  const equipmentHeightMm = roofEquipmentHeightMm(plan);
  const insetMm = plan.input.parameters.openingInsetMm;
  const quads: CanonicalGlbQuad[] = [];
  const materialIndexOf = (id: string): number => {
    const index = materialIndexById.get(id);
    if (index === undefined) throw new Error(`Plan placement cites an undeclared material: ${id}`);
    return index;
  };

  for (const surface of plan.surfaces) {
    const frame = surfaceFrame(surface);
    const point = (u: number, v: number, depth: number): Vec3 => [
      frame.origin[0] + frame.uDir[0] * u + frame.vDir[0] * v - frame.normal[0] * depth,
      frame.origin[1] + frame.uDir[1] * u + frame.vDir[1] * v - frame.normal[1] * depth,
      frame.origin[2] + frame.uDir[2] * u + frame.vDir[2] * v - frame.normal[2] * depth,
    ];
    const surfacePlacements = plan.placements
      .filter((placement) => placement.surfaceId === surface.id && (options.includeFacadeDetail || placement.kind === "roof-equipment"))
      .sort((left, right) => left.bounds.vMinMm - right.bounds.vMinMm || left.bounds.uMinMm - right.bounds.uMinMm || compareText(left.id, right.id));

    const breaks = [...new Set([0, surface.vLengthMm, ...surfacePlacements.flatMap((placement) => [placement.bounds.vMinMm, placement.bounds.vMaxMm])])].sort((left, right) => left - right);
    for (let index = 0; index + 1 < breaks.length; index += 1) {
      const vMin = breaks[index]!; const vMax = breaks[index + 1]!;
      if (vMax <= vMin) continue;
      const skips: Interval[] = surfacePlacements
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
      const depth = placementDepthMm(placement, insetMm, equipmentHeightMm);
      quads.push({ materialIndex, corners: [point(uMinMm, vMinMm, depth), point(uMaxMm, vMinMm, depth), point(uMaxMm, vMaxMm, depth), point(uMinMm, vMaxMm, depth)] });
      if (depth === 0) continue;
      // Reveal windings are chosen so each face points into the opening for a
      // recess and away from the solid for an extrusion; the sign of `depth`
      // flips them together. A reversed winding here is invisible to the glTF
      // profile check but breaks the closed-solid volume, so it is proven by
      // the analytic volume comparison in the Blender authoring pass.
      quads.push({ materialIndex, corners: [point(uMinMm, vMinMm, 0), point(uMaxMm, vMinMm, 0), point(uMaxMm, vMinMm, depth), point(uMinMm, vMinMm, depth)] });
      quads.push({ materialIndex, corners: [point(uMinMm, vMaxMm, depth), point(uMaxMm, vMaxMm, depth), point(uMaxMm, vMaxMm, 0), point(uMinMm, vMaxMm, 0)] });
      quads.push({ materialIndex, corners: [point(uMinMm, vMinMm, depth), point(uMinMm, vMaxMm, depth), point(uMinMm, vMaxMm, 0), point(uMinMm, vMinMm, 0)] });
      quads.push({ materialIndex, corners: [point(uMaxMm, vMinMm, 0), point(uMaxMm, vMaxMm, 0), point(uMaxMm, vMaxMm, depth), point(uMaxMm, vMinMm, depth)] });
    }
  }
  return { quads, materials };
}

/** Maps plan-local millimetres into the building-anchored ENU metre frame the GLB ships in. */
export function planToEnu(context: BuildingPlanContext, quads: readonly CanonicalGlbQuad[]): CanonicalGlbQuad[] {
  const [axisX, axisY] = context.rectangle.axis;
  const [centerX, centerY] = context.rectangle.center;
  const map = (corner: Vec3): Vec3 => {
    const localEast = corner[0] / 1_000; const localNorth = corner[1] / 1_000;
    return [centerX + localEast * axisX - localNorth * axisY, centerY + localEast * axisY + localNorth * axisX, corner[2] / 1_000];
  };
  return quads.map((quad) => ({ materialIndex: quad.materialIndex, corners: [map(quad.corners[0]), map(quad.corners[1]), map(quad.corners[2]), map(quad.corners[3])] }));
}

// ---------------------------------------------------------------------------
// Registration gate
// ---------------------------------------------------------------------------

export interface RegistrationEntry {
  canonicalBuildingId: string;
  horizontalDeviationMeters: number;
  verticalDeviationMeters: number;
  sourceHeightMeters: number;
  /** Exported roof-plane elevation of the massing envelope. */
  exportedRoofElevationMeters: number;
  /** Highest exported vertex, including the generated rooftop appurtenance. */
  exportedMaxElevationMeters: number;
  withinTolerance: boolean;
}

const ENVELOPE_EPSILON_METERS = 1e-3;

/**
 * Compares the exported massing envelope against the source-derived oriented
 * rectangle and `heightMeters`. This detects unit, anchor, rounding and float32
 * drift through the pipeline; it does not and cannot certify polygon shape
 * fidelity, and it deliberately measures the roof plane rather than the
 * generated rooftop appurtenance that sits above the sourced height.
 */
export function registrationEntry(context: BuildingPlanContext, exported: readonly CanonicalGlbQuad[]): RegistrationEntry {
  const rectangle = context.rectangle;
  const [axisX, axisY] = rectangle.axis;
  const halfWidth = rectangle.widthMeters / 2; const halfDepth = rectangle.depthMeters / 2;
  const localCorners: Point2[] = [[-halfWidth, -halfDepth], [halfWidth, -halfDepth], [halfWidth, halfDepth], [-halfWidth, halfDepth]];
  const expectedCorners: Point2[] = localCorners.map((corner) => [rectangle.center[0] + corner[0] * axisX - corner[1] * axisY, rectangle.center[1] + corner[0] * axisY + corner[1] * axisX]);
  let minimumZ = Number.POSITIVE_INFINITY; let maximumZ = Number.NEGATIVE_INFINITY;
  const observed: Point2[] = [];
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
  // Fail closed rather than trusting the plan: the roof plane must actually be
  // present in the shipped vertices before it can stand in for exported height.
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
// Package assembly
// ---------------------------------------------------------------------------

export interface SilhouetteMeasurement { canonicalBuildingId: string; planHashSha256: string; viewIds: string[]; deviationRatio: number }
export interface SilhouetteMeasurementFile { schemaVersion: "1.0"; packageId: string; method: "projected-silhouette-ratio"; metricVersion: "1.0"; tool: string; measuredAt: string; buildings: SilhouetteMeasurement[] }

export interface AssembledPackage {
  manifest: MultiLodAssemblyManifest;
  contents: Map<string, Uint8Array>;
  plans: DeterministicFacadePlan[];
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
function tileBox(bounds: BoundingBox, offset: Point2): number[] {
  const half = (axis: number): number => Math.max((bounds.maximum[axis]! - bounds.minimum[axis]!) / 2, 1e-3);
  return [
    offset[0] + (bounds.minimum[0]! + bounds.maximum[0]!) / 2,
    offset[1] + (bounds.minimum[1]! + bounds.maximum[1]!) / 2,
    (bounds.minimum[2]! + bounds.maximum[2]!) / 2,
    half(0), 0, 0, 0, half(1), 0, 0, 0, half(2),
  ];
}

export function assembleBlock835ReferencePackage(options: {
  release: unknown;
  releaseChecksumSha256: string;
  measurements: SilhouetteMeasurementFile;
}): AssembledPackage {
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
  const plans: DeterministicFacadePlan[] = [];
  const registration: RegistrationEntry[] = [];
  const tileChains: Array<Record<string, unknown>> = [];
  const blockBounds: BoundingBox = { minimum: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY], maximum: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY] };

  for (const building of buildings) {
    const context = buildBuildingPlan(building);
    const plan = context.plan;
    plans.push(plan);
    const inventoryId = `inventory:${BLOCK835_REFERENCE_PACKAGE_ID}:${building.canonicalBuildingId}`;
    const inventoryHashSha256 = sha256HexSync(stableSerialize(plan.inventory));
    const truthTiers = [...new Set(plan.inventory.components.map((component) => component.state as ComponentTruthTier))].sort(compareText);
    if (truthTiers.includes("evidence-backed")) throw new Error(`Block 835 reference assets must not claim evidence-backed truth for ${building.canonicalBuildingId}.`);
    const measurement = measurementById.get(building.canonicalBuildingId);
    if (!measurement) throw new Error(`Missing Blender silhouette measurement for ${building.canonicalBuildingId}.`);
    if (measurement.planHashSha256 !== plan.planHashSha256) throw new Error(`Silhouette measurement for ${building.canonicalBuildingId} is bound to a different plan hash.`);

    const offset = toEnuMeters(blockFrame, [building.anchor.longitude, building.anchor.latitude]);
    const lods: AssemblyLod[] = [];
    const chain: Array<Record<string, unknown>> = [];
    for (const [lodIndex, lodId] of ["lod_0", "lod_1"].entries()) {
      const tessellated = tessellatePlan(plan, { includeFacadeDetail: lodIndex === 0 });
      const quads = planToEnu(context, tessellated.quads);
      if (lodIndex === 0) registration.push(registrationEntry(context, quads));
      const relativeRef = `private/assets/${building.canonicalBuildingId.replace(":", "-")}__${lodId}.glb`;
      const metadata = {
        canonicalFeatureId: building.canonicalBuildingId,
        lodId,
        ownerCellId: BLOCK835_CELL_ID,
        inventoryId,
        inventoryHashSha256,
        evidenceShardId: BLOCK835_NO_EVIDENCE_SHARD_ID,
        truthTiers,
        sourceDates: { capturedAt: building.capturedAt, updatedAt: building.updatedAt },
        predecessor: building.predecessor,
        uncertainty: DETERMINISTIC_FACADE_UNCERTAINTY,
        planHashSha256: plan.planHashSha256,
      };
      const written = writeCanonicalGlb({ quads, materials: tessellated.materials, metadata });
      if (written.counts.triangleCount > BLOCK835_QUALITY_BUDGETS.maxTriangles || written.counts.materialCount > BLOCK835_QUALITY_BUDGETS.maxMaterials || written.counts.textureCount !== 0) {
        throw new Error(`Block 835 ${building.canonicalBuildingId} ${lodId} exceeds the approved asset budgets.`);
      }
      contents.set(relativeRef, written.bytes);
      artifacts.push({ logicalId: `glb:${building.canonicalBuildingId}:${lodId}`, role: "glb", relativeRef, byteSize: written.bytes.byteLength, checksumSha256: sha256HexBytes(written.bytes), ownerCellId: BLOCK835_CELL_ID });
      lods.push({
        lodId,
        artifactRef: relativeRef,
        geometricErrorMeters: lodIndex === 0 ? 0 : BLOCK835_LOD1_GEOMETRIC_ERROR_METERS,
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
      chain.push({ boundingVolume: { box: tileBox(bounds, [0, 0]) }, geometricError: lodIndex === 0 ? 0 : BLOCK835_LOD1_GEOMETRIC_ERROR_METERS, refine: "REPLACE", content: { uri: `../assets/${building.canonicalBuildingId.replace(":", "-")}__${lodId}.glb` } });
    }
    const coarse = chain[1]!; const fine = chain[0]!;
    coarse.transform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, offset[0], offset[1], 0, 1];
    coarse.children = [fine];
    tileChains.push(coarse);

    assets.push({
      canonicalFeatureId: building.canonicalBuildingId,
      ownerCellId: BLOCK835_CELL_ID,
      inventoryId,
      inventoryHashSha256,
      evidenceShardId: BLOCK835_NO_EVIDENCE_SHARD_ID,
      truthTiers,
      sourceDates: { capturedAt: building.capturedAt, updatedAt: building.updatedAt },
      predecessor: building.predecessor,
      uncertainty: DETERMINISTIC_FACADE_UNCERTAINTY,
      source: { kind: "facade-plan", planId: plan.planId, planHashSha256: plan.planHashSha256 },
      lods,
    });
  }

  const tilesetRef = "private/tiles/tileset.json";
  const tileset = {
    asset: { version: "1.1" },
    geometricError: 1,
    root: { boundingVolume: { box: tileBox(blockBounds, [0, 0]) }, geometricError: 1, refine: "REPLACE", children: tileChains },
  };
  const tilesetBytes = new TextEncoder().encode(JSON.stringify(tileset));
  contents.set(tilesetRef, tilesetBytes);
  artifacts.push({ logicalId: `tileset:${BLOCK835_REFERENCE_PACKAGE_ID}`, role: "tileset-json", relativeRef: tilesetRef, byteSize: tilesetBytes.byteLength, checksumSha256: sha256HexBytes(tilesetBytes), ownerCellId: null });

  const ownershipLedger = {
    ledgerId: BLOCK835_OWNERSHIP_LEDGER_ID,
    cityId: BLOCK835_CITY_ID,
    configId: BLOCK835_CONFIG_ID,
    baseIdentitySet: { id: BLOCK835_BASE_IDENTITY_SET_ID, buildingCount: buildingIds.length, checksumSha256: baseChecksum },
    cells: [{ cellId: BLOCK835_CELL_ID, order: 0, buildingIds: [...buildingIds].sort(), membershipChecksumSha256: baseChecksum }],
    derivedFrom: { releaseId: BLOCK835_PILOT_RELEASE_ID, checksumSha256: options.releaseChecksumSha256 },
  };

  const manifest: MultiLodAssemblyManifest = {
    schemaVersion: "1.0",
    packageId: BLOCK835_REFERENCE_PACKAGE_ID,
    audience: "private",
    generatedAt: BLOCK835_REFERENCE_GENERATED_AT,
    immutable: true,
    release: {
      rootId: `private:${BLOCK835_REFERENCE_PACKAGE_ID}`,
      rootChecksumSha256: options.releaseChecksumSha256,
      releaseId: BLOCK835_PILOT_RELEASE_ID,
      cityId: BLOCK835_CITY_ID,
      configId: BLOCK835_CONFIG_ID,
      privatePredecessor: null,
    },
    baseIdentitySet: { id: BLOCK835_BASE_IDENTITY_SET_ID, checksumSha256: baseChecksum },
    ownershipLedger: { id: BLOCK835_OWNERSHIP_LEDGER_ID, checksumSha256: sha256HexSync(stableSerialize(ownershipLedger)) },
    cells: [{
      cellId: BLOCK835_CELL_ID,
      cellRelease: { id: BLOCK835_PILOT_RELEASE_ID, checksumSha256: options.releaseChecksumSha256 },
      predecessor: null,
      buildingIds: [...buildingIds].sort(),
      membershipChecksumSha256: baseChecksum,
    }],
    assets,
    artifacts,
    tilesetRef,
    declaredTotalBytes: artifacts.reduce((sum, artifact) => sum + artifact.byteSize, 0),
  };

  return { manifest, contents, plans, registration, ownershipLedger };
}

