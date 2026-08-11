import {
  DETERMINISTIC_FACADE_V3_SCHEMA_VERSION,
  DETERMINISTIC_FACADE_V3_UNCERTAINTY,
  deriveV3Parameters,
  generateV3FacadePlan,
  ringSignedAreaMm2,
  tessellateV3Plan,
  validateV3Plan,
  type Point2Mm,
  type V3Plan,
  type V3Tessellation,
} from "../domain/deterministic-facade-generator-v3.ts";
import { sha256HexBytes, sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";
import { writeCanonicalGlb, type CanonicalGlbMaterial, type CanonicalGlbQuad, type CanonicalGlbTri, type Vec3 } from "./canonical-glb.ts";
import {
  BLOCK835_CELL_ID,
  BLOCK835_CITY_ID,
  BLOCK835_CONFIG_ID,
  BLOCK835_LOD0_MAX_DISTANCE_METERS,
  BLOCK835_PILOT_RELEASE_ID,
  BLOCK835_V3_PACKAGE_ID,
  deriveBaseIdentityChecksum,
  enuFrame,
  readPilotBuildings,
  toEnuMeters,
  type EnuFrame,
  type PilotBuildingSource,
  type Point2,
  type SilhouetteMeasurementFile,
} from "./block835-reference-package.ts";
import type { AssemblyAsset, AssemblyLod, ComponentTruthTier, ImmutablePin, MultiLodAssemblyManifest } from "./multi-lod-assembly.ts";

/**
 * V3 asset quality budgets.
 *
 * These are a NEW, versioned gate. `BLOCK835_QUALITY_BUDGETS` is byte-frozen
 * into the committed V1 and V2 manifests and into their drift tests, so it is
 * never edited; a V3 asset is measured against its own budget instead.
 *
 * The triangle raise from 75,000 to 200,000 is a deliberate, named gate change,
 * not an accommodation. A fourteen-vertex concave prism with per-edge facade
 * bands costs several times what an axis-aligned box costs, and the worst case
 * on the real Block 835 data — the Empire State Building — measures 102,338
 * triangles at full detail. The raise is disclosed in ADR 0031 and is only
 * legitimate once measured frame time has been re-checked at the higher count.
 *
 * The material raise from 8 to 12 leaves headroom above the nine materials the
 * base/shaft zoning actually emits, so a later crown zone (T026) does not need
 * a second gate change.
 *
 * Textures stay at zero. V3 designs appearance with per-primitive materials; it
 * derives nothing from imagery, so there is nothing to sample.
 */
export const V3_QUALITY_BUDGETS = { maxTriangles: 200_000, maxMaterials: 12, maxTextures: 0 } as const;

/**
 * Registration semantics change in V3, and the change is the point of the task.
 *
 * V1 and V2 registered the minimum-area oriented bounding RECTANGLE of the
 * DOITT footprint, so their registration report measured pipeline drift — unit
 * conversion, ENU anchoring, millimetre rounding, float32 quantisation — and
 * explicitly disclaimed any claim about shape fidelity. V3 carries the true
 * ring, so registration compares TRUE FOOTPRINT VERTICES and can make the
 * stronger claim.
 *
 * The two tolerances are different measures and must not be conflated:
 * `perVertexShapeMeters` bounds how far any shipped vertex may sit from the
 * sourced vertex it came from, and `horizontalMeters`/`verticalMeters` bound
 * whole-asset placement drift as before.
 */
export const V3_REGISTRATION_TOLERANCE = {
  horizontalMeters: 0.25,
  verticalMeters: 0.5,
  /**
   * One millimetre of rounding plus float32 quantisation over a few hundred
   * metres of local extent. It is a PIPELINE tolerance: it bounds this
   * pipeline's own error against the sourced polygon, and asserts nothing about
   * how well that sourced polygon matches the real building.
   */
  perVertexShapeMeters: 0.05,
} as const;

export const V3_REGISTRATION_METHOD = {
  method: "true-footprint-vertex-registration",
  contractual: false,
  referenceGeometry: "The DOITT source footprint ring itself, vertex for vertex. V1 and V2 registered the minimum-area oriented bounding rectangle of that ring instead.",
  measures: "Per-vertex deviation between each shipped ground-ring vertex and the sourced footprint vertex it was derived from, plus whole-asset horizontal and vertical placement drift.",
  claim: "The shipped massing reproduces the sourced polygon to within the stated per-vertex tolerance. It does NOT claim that the sourced polygon matches the real building, and it claims nothing at all about facade, appearance, colour or material, all of which are designed.",
  verticalReference: "Roof plane of the topmost tier against the sourced heightMeters.",
  aboveSourcedHeight: "Shipped geometry extends above the sourced heightMeters by the rooftop cluster, which is declared truth tier `generated` and is authored rather than suppressed.",
} as const;

// ---------------------------------------------------------------------------
// V3 successor package identity
//
// The package id carries a `-v3` discriminator because the V2 successor already
// owns today's plain date stamp (`manhattan-esb-block-reference-20260811`) and
// that package is byte-frozen. Colliding on the directory name would have meant
// overwriting it, which the supersession rule forbids: a successor pins its
// predecessor, it never edits it.
// ---------------------------------------------------------------------------


export { BLOCK835_V3_PACKAGE_ID };
export const BLOCK835_V3_GENERATED_AT = "2026-08-11T00:00:00.000Z" as const;
export const BLOCK835_V3_SEED = "block-835-reference-20260811-v3" as const;
export const BLOCK835_V3_TOOL = { id: "urban-digital-twin:block835-v3", version: "3.0.0" } as const;
export const BLOCK835_V3_BASE_IDENTITY_SET_ID = "base-identity-set:manhattan:block-835:20260811-v3" as const;
export const BLOCK835_V3_OWNERSHIP_LEDGER_ID = "ownership-ledger:manhattan:block-835:20260811-v3" as const;
/** LOD 1 keeps the massing envelope and every protrusion, so its silhouette matches LOD 0. */
export const BLOCK835_V3_LOD1_GEOMETRIC_ERROR_METERS = 0.2 as const;
/** The V2 package this one supersedes without editing a byte of it. */
export const BLOCK835_V3_PREDECESSOR_PACKAGE_ID = "manhattan-esb-block-reference-20260811" as const;

function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }

export function v3EvidenceShardId(canonicalBuildingId: string): string {
  return `evidence-shard:${BLOCK835_V3_PACKAGE_ID}:${canonicalBuildingId}`;
}
export function v3InventoryId(canonicalBuildingId: string): string {
  return `inventory:${BLOCK835_V3_PACKAGE_ID}:${canonicalBuildingId}`;
}

// ---------------------------------------------------------------------------
// Plan construction
// ---------------------------------------------------------------------------

export interface V3PlanContext {
  building: PilotBuildingSource;
  frame: EnuFrame;
  /** The sourced ring in plan-local millimetres, exactly as the plan carries it. */
  ringMm: Point2Mm[];
  /** True when the sourced ring was clockwise and had to be reversed to CCW. */
  reversed: boolean;
  plan: V3Plan;
}

/**
 * Builds the V3 plan for one pilot building.
 *
 * Unlike V1/V2 there is no oriented rectangle and no rotation: the plan-local
 * frame IS the building-anchored ENU frame in millimetres, so the sourced
 * polygon travels through the pipeline as itself. The only transforms applied
 * to it are a metre-to-millimetre rounding and, when the sourced ring is
 * clockwise, a reversal to the counter-clockwise orientation the grammar
 * requires. Both are recorded so registration can measure them.
 */
export function buildV3Plan(building: PilotBuildingSource): V3PlanContext {
  const frame = enuFrame(building.anchor);
  const raw = building.footprint.map((point) => {
    const [east, north] = toEnuMeters(frame, point);
    return [Math.round(east * 1_000), Math.round(north * 1_000)] as Point2Mm;
  });
  const reversed = ringSignedAreaMm2(raw) < 0;
  const outer = reversed ? [...raw].reverse() : raw;
  const heightMm = Math.round(building.heightMeters * 1_000);
  const sourceRefId = building.sourceRefIds[0] ?? `source-ref:${building.doittId}`;
  const generated = generateV3FacadePlan({
    schemaVersion: DETERMINISTIC_FACADE_V3_SCHEMA_VERSION,
    buildingId: building.canonicalBuildingId,
    generatedAt: BLOCK835_V3_GENERATED_AT,
    seed: BLOCK835_V3_SEED,
    tool: { ...BLOCK835_V3_TOOL },
    geometry: { unit: "millimeter", footprint: { outer }, baseElevationMm: 0, heightMm },
    sourceAnchors: [
      { id: `${building.canonicalBuildingId}:anchor:footprint`, kind: "footprint", sourceRefId, fingerprintSha256: sha256HexSync(stableSerialize({ footprint: building.footprint, licenseRefIds: building.licenseRefIds })) },
      { id: `${building.canonicalBuildingId}:anchor:height`, kind: "height", sourceRefId, fingerprintSha256: sha256HexSync(stableSerialize({ heightMeters: building.heightMeters })) },
    ],
    parameters: deriveV3Parameters({ footprintOuterMm: outer, heightMm }),
  });
  if (!generated.ok) throw new Error(`V3 facade plan failed for ${building.canonicalBuildingId}: ${generated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
  // Generation alone does not run the plan validator. The shipped plan must
  // clear it, including the corner-clearance and containment guards.
  const validated = validateV3Plan(generated.value);
  if (!validated.ok) throw new Error(`V3 facade plan failed validation for ${building.canonicalBuildingId}: ${validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
  return { building, frame, ringMm: outer, reversed, plan: validated.value };
}

// ---------------------------------------------------------------------------
// Tessellation to canonical GLB input
// ---------------------------------------------------------------------------

export interface V3GlbGeometry { quads: CanonicalGlbQuad[]; triangles: CanonicalGlbTri[]; materials: CanonicalGlbMaterial[] }

/** Plan-local millimetres to the building-anchored ENU metre frame. No rotation. */
function toEnuVec(corner: readonly [number, number, number]): Vec3 { return [corner[0] / 1_000, corner[1] / 1_000, corner[2] / 1_000]; }
/** Same +Y-up file mapping the V1/V2 writers use; determinant +1, so winding survives. */
function toYUp(corner: Vec3): Vec3 { return [corner[0], corner[2], -corner[1]]; }

export function v3GeometryForGlb(plan: V3Plan, tessellation: V3Tessellation, options: { yUp: boolean }): V3GlbGeometry {
  const materialIndexById = new Map(plan.materials.map((material, index) => [material.id, index]));
  const materials: CanonicalGlbMaterial[] = plan.materials.map((material) => ({
    baseColorFactor: [material.baseColorSrgb[0] / 255, material.baseColorSrgb[1] / 255, material.baseColorSrgb[2] / 255, material.baseColorSrgb[3] / 255],
    metallicFactor: material.metallicPermille / 1_000,
    roughnessFactor: material.roughnessPermille / 1_000,
  }));
  const materialIndexOf = (id: string): number => {
    const index = materialIndexById.get(id);
    if (index === undefined) throw new Error(`V3 plan cites an undeclared material: ${id}`);
    return index;
  };
  const map = (corner: readonly [number, number, number]): Vec3 => {
    const enu = toEnuVec(corner);
    return options.yUp ? toYUp(enu) : enu;
  };
  return {
    materials,
    quads: tessellation.quads.map((quad) => ({
      materialIndex: materialIndexOf(quad.materialId),
      corners: [map(quad.corners[0]), map(quad.corners[1]), map(quad.corners[2]), map(quad.corners[3])] as const,
    })),
    triangles: tessellation.triangles.map((triangle) => ({
      materialIndex: materialIndexOf(triangle.materialId),
      a: map(triangle.a), b: map(triangle.b), c: map(triangle.c),
    })),
  };
}

// ---------------------------------------------------------------------------
// True-footprint-vertex registration
// ---------------------------------------------------------------------------

export interface V3RegistrationEntry {
  canonicalBuildingId: string;
  sourceVertexCount: number;
  shippedGroundVertexCount: number;
  /** Worst distance from a sourced footprint vertex to the nearest shipped ground-ring vertex. */
  perVertexShapeDeviationMeters: number;
  /** Whole-asset placement drift: shipped ground-ring centroid against the sourced centroid. */
  horizontalDeviationMeters: number;
  verticalDeviationMeters: number;
  sourceHeightMeters: number;
  exportedRoofElevationMeters: number;
  exportedMaxElevationMeters: number;
  ringOrientationReversed: boolean;
  withinTolerance: boolean;
}

const GROUND_PLANE_EPSILON_METERS = 1e-4;
const ENVELOPE_EPSILON_METERS = 1e-3;

/**
 * Measures the shipped ground ring against the SOURCED polygon, vertex for
 * vertex. V1 and V2 could only compare against the oriented bounding rectangle,
 * so they measured pipeline drift and disclaimed shape; V3 carries the true
 * ring, so the same report can bound shape error as well.
 *
 * The two numbers are deliberately different measures and are never summed:
 * `perVertexShapeDeviationMeters` is the worst per-vertex shape error, and
 * `horizontalDeviationMeters` is whole-asset placement drift of the centroid.
 */
export function v3RegistrationEntry(context: V3PlanContext, exported: { quads: readonly CanonicalGlbQuad[]; triangles: readonly CanonicalGlbTri[] }): V3RegistrationEntry {
  const sourceVertices: Point2[] = context.building.footprint.map((point) => toEnuMeters(context.frame, point));
  const observed: Point2[] = [];
  let minimumZ = Number.POSITIVE_INFINITY;
  let maximumZ = Number.NEGATIVE_INFINITY;
  const visit = (corner: Vec3): void => {
    if (corner[2] < minimumZ) minimumZ = corner[2];
    if (corner[2] > maximumZ) maximumZ = corner[2];
  };
  for (const quad of exported.quads) for (const corner of quad.corners) visit(corner);
  for (const triangle of exported.triangles) for (const corner of [triangle.a, triangle.b, triangle.c]) visit(corner);
  const groundZ = minimumZ;
  const collect = (corner: Vec3): void => { if (Math.abs(corner[2] - groundZ) <= GROUND_PLANE_EPSILON_METERS) observed.push([corner[0], corner[1]]); };
  for (const quad of exported.quads) for (const corner of quad.corners) collect(corner);
  for (const triangle of exported.triangles) for (const corner of [triangle.a, triangle.b, triangle.c]) collect(corner);
  if (observed.length === 0) throw new Error(`Exported V3 geometry for ${context.building.canonicalBuildingId} has no vertex on its ground plane.`);

  let shape = 0;
  for (const expected of sourceVertices) {
    let nearest = Number.POSITIVE_INFINITY;
    for (const point of observed) nearest = Math.min(nearest, Math.hypot(point[0] - expected[0], point[1] - expected[1]));
    shape = Math.max(shape, nearest);
  }

  // Placement drift: the shipped ring's own vertices, deduplicated, against the
  // sourced ring. Both centroids are plain vertex means of the same polygon, so
  // any offset between them is pipeline placement error and nothing else.
  const shippedRing = context.ringMm.map((point) => [point[0] / 1_000, point[1] / 1_000] as Point2);
  const mean = (points: readonly Point2[]): Point2 => [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  ];
  const sourceCentroid = mean(sourceVertices);
  const shippedCentroid = mean(shippedRing);
  const horizontal = Math.hypot(shippedCentroid[0] - sourceCentroid[0], shippedCentroid[1] - sourceCentroid[1]);

  const roofElevation = context.plan.input.geometry.heightMm / 1_000;
  if (!exported.quads.some((quad) => quad.corners.some((corner) => Math.abs(corner[2] - roofElevation) <= ENVELOPE_EPSILON_METERS))
    && !exported.triangles.some((triangle) => [triangle.a, triangle.b, triangle.c].some((corner) => Math.abs(corner[2] - roofElevation) <= ENVELOPE_EPSILON_METERS))) {
    throw new Error(`Exported V3 geometry for ${context.building.canonicalBuildingId} has no vertex on its declared roof plane.`);
  }
  const vertical = Math.abs(roofElevation - minimumZ - context.building.heightMeters);
  return {
    canonicalBuildingId: context.building.canonicalBuildingId,
    sourceVertexCount: sourceVertices.length,
    shippedGroundVertexCount: observed.length,
    perVertexShapeDeviationMeters: shape,
    horizontalDeviationMeters: horizontal,
    verticalDeviationMeters: vertical,
    sourceHeightMeters: context.building.heightMeters,
    exportedRoofElevationMeters: roofElevation - minimumZ,
    exportedMaxElevationMeters: maximumZ - minimumZ,
    ringOrientationReversed: context.reversed,
    withinTolerance: shape <= V3_REGISTRATION_TOLERANCE.perVertexShapeMeters
      && horizontal <= V3_REGISTRATION_TOLERANCE.horizontalMeters
      && vertical <= V3_REGISTRATION_TOLERANCE.verticalMeters,
  };
}

// ---------------------------------------------------------------------------
// Package assembly
// ---------------------------------------------------------------------------

export interface V3PredecessorPins {
  /** The V2 cell-release pin this package supersedes. */
  cellRelease: ImmutablePin;
  /** Per-building V2 asset pins, keyed by canonical building id. */
  assets: ReadonlyMap<string, ImmutablePin>;
}

export interface AssembledV3 {
  manifest: MultiLodAssemblyManifest;
  contents: Map<string, Uint8Array>;
  plans: V3Plan[];
  registration: V3RegistrationEntry[];
  ownershipLedger: Record<string, unknown>;
}

/** Reads the frozen V2 manifest and derives this package's predecessor pins. */
export function v3PredecessorPins(previousManifest: MultiLodAssemblyManifest): V3PredecessorPins {
  if (previousManifest.packageId !== BLOCK835_V3_PREDECESSOR_PACKAGE_ID) {
    throw new Error(`V3 predecessor pins must come from ${BLOCK835_V3_PREDECESSOR_PACKAGE_ID}, not ${previousManifest.packageId}.`);
  }
  const assets = new Map<string, ImmutablePin>();
  for (const asset of previousManifest.assets) {
    const finest = asset.lods.find((lod) => lod.lodId === "lod_0") ?? asset.lods[0]!;
    const artifact = previousManifest.artifacts.find((entry) => entry.relativeRef === finest.artifactRef);
    if (!artifact) throw new Error(`Predecessor manifest has no artifact for ${asset.canonicalFeatureId}.`);
    assets.set(asset.canonicalFeatureId, { id: `${previousManifest.packageId}:${asset.canonicalFeatureId}:${finest.lodId}`, checksumSha256: artifact.checksumSha256 });
  }
  return { cellRelease: { ...previousManifest.cells[0]!.cellRelease }, assets };
}

type Mutable3 = [number, number, number];
interface BoundingBox { minimum: Mutable3; maximum: Mutable3 }
function geometryBounds(geometry: { quads: readonly CanonicalGlbQuad[]; triangles: readonly CanonicalGlbTri[] }): BoundingBox {
  const minimum: Mutable3 = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const maximum: Mutable3 = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  const visit = (corner: Vec3): void => {
    for (let axis = 0; axis < 3; axis += 1) {
      if (corner[axis]! < minimum[axis]!) minimum[axis] = corner[axis]!;
      if (corner[axis]! > maximum[axis]!) maximum[axis] = corner[axis]!;
    }
  };
  for (const quad of geometry.quads) for (const corner of quad.corners) visit(corner);
  for (const triangle of geometry.triangles) for (const corner of [triangle.a, triangle.b, triangle.c]) visit(corner);
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

/**
 * Truth tiers for one V3 asset.
 *
 * The V2 assembler asserted a single `generated` tier and threw on anything
 * else. V3 cannot: on five of the fourteen real footprints the tier offset is
 * REFUSED rather than repaired, and the plan then declares `setbacks` absent
 * with the refusal reason attached. Suppressing that to keep a one-tier
 * envelope would be exactly the dishonesty the grammar was built to avoid, so
 * the V3 path accepts `absent` — but only for the one kind and the one reason
 * the V3 validator admits, and never for anything else.
 */
export function v3TruthTiers(plan: V3Plan): ComponentTruthTier[] {
  const tiers = new Set<ComponentTruthTier>();
  for (const component of plan.inventory.components) {
    const admissible = component.state === "generated"
      || (component.state === "absent" && component.kind === "setbacks" && plan.massing.effectiveTierCount <= 1);
    if (!admissible) throw new Error(`V3 asset ${plan.buildingId} declares an inadmissible component state: ${component.kind} is ${component.state}.`);
    tiers.add(component.state as ComponentTruthTier);
  }
  return [...tiers].sort(compareText);
}

export function assembleBlock835V3Package(options: {
  release: unknown;
  releaseChecksumSha256: string;
  measurements: SilhouetteMeasurementFile;
  predecessor: V3PredecessorPins;
}): AssembledV3 {
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
  const plans: V3Plan[] = [];
  const registration: V3RegistrationEntry[] = [];
  const tileChains: Array<Record<string, unknown>> = [];
  const blockBounds: BoundingBox = { minimum: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY], maximum: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY] };

  for (const building of buildings) {
    const context = buildV3Plan(building);
    const plan = context.plan;
    plans.push(plan);
    const inventoryId = v3InventoryId(building.canonicalBuildingId);
    const inventoryHashSha256 = sha256HexSync(stableSerialize(plan.inventory));
    const truthTiers = v3TruthTiers(plan);
    const measurement = measurementById.get(building.canonicalBuildingId);
    if (!measurement) throw new Error(`Missing Blender silhouette measurement for ${building.canonicalBuildingId}.`);
    if (measurement.planHashSha256 !== plan.planHashSha256) throw new Error(`Silhouette measurement for ${building.canonicalBuildingId} is bound to a different plan hash.`);
    const predecessor = options.predecessor.assets.get(building.canonicalBuildingId);
    if (!predecessor) throw new Error(`Missing ${BLOCK835_V3_PREDECESSOR_PACKAGE_ID} predecessor pin for ${building.canonicalBuildingId}.`);

    const offset = toEnuMeters(blockFrame, [building.anchor.longitude, building.anchor.latitude]);
    const lods: AssemblyLod[] = [];
    const chain: Array<Record<string, unknown>> = [];
    for (const [lodIndex, lodId] of ["lod_0", "lod_1"].entries()) {
      const tessellation = tessellateV3Plan(plan, { includeRecesses: lodIndex === 0 });
      const enu = v3GeometryForGlb(plan, tessellation, { yUp: false });
      if (lodIndex === 0) registration.push(v3RegistrationEntry(context, enu));
      const file = v3GeometryForGlb(plan, tessellation, { yUp: true });
      const relativeRef = `private/assets/${building.canonicalBuildingId.replace(":", "-")}__${lodId}.glb`;
      const metadata = {
        canonicalFeatureId: building.canonicalBuildingId,
        lodId,
        ownerCellId: BLOCK835_CELL_ID,
        inventoryId,
        inventoryHashSha256,
        evidenceShardId: v3EvidenceShardId(building.canonicalBuildingId),
        truthTiers,
        sourceDates: { capturedAt: building.capturedAt, updatedAt: building.updatedAt },
        predecessor,
        uncertainty: DETERMINISTIC_FACADE_V3_UNCERTAINTY,
        planHashSha256: plan.planHashSha256,
      };
      const written = writeCanonicalGlb({ quads: file.quads, triangles: file.triangles, materials: file.materials, metadata });
      if (written.counts.triangleCount > V3_QUALITY_BUDGETS.maxTriangles || written.counts.materialCount > V3_QUALITY_BUDGETS.maxMaterials || written.counts.textureCount !== 0) {
        throw new Error(`V3 ${building.canonicalBuildingId} ${lodId} exceeds the V3 asset budgets (${written.counts.triangleCount} triangles, ${written.counts.materialCount} materials).`);
      }
      contents.set(relativeRef, written.bytes);
      artifacts.push({ logicalId: `glb:${building.canonicalBuildingId}:${lodId}`, role: "glb", relativeRef, byteSize: written.bytes.byteLength, checksumSha256: sha256HexBytes(written.bytes), ownerCellId: BLOCK835_CELL_ID });
      lods.push({
        lodId, artifactRef: relativeRef,
        geometricErrorMeters: lodIndex === 0 ? 0 : BLOCK835_V3_LOD1_GEOMETRIC_ERROR_METERS,
        maxDistanceMeters: lodIndex === 0 ? BLOCK835_LOD0_MAX_DISTANCE_METERS : null,
        eligible: true,
        quality: { ...written.counts, budgets: { ...V3_QUALITY_BUDGETS } },
        silhouette: lodIndex === 0 ? null : {
          status: "authoring-declared", method: "projected-silhouette-ratio", metricVersion: "1.0",
          planHashSha256: plan.planHashSha256, viewIds: [...measurement.viewIds].sort(compareText), deviationRatio: measurement.deviationRatio, maximumRatio: 0.02,
        },
      });
      const bounds = geometryBounds(enu);
      for (let axis = 0; axis < 3; axis += 1) {
        const shift = axis === 2 ? 0 : offset[axis]!;
        blockBounds.minimum[axis] = Math.min(blockBounds.minimum[axis]!, bounds.minimum[axis]! + shift);
        blockBounds.maximum[axis] = Math.max(blockBounds.maximum[axis]!, bounds.maximum[axis]! + shift);
      }
      chain.push({ boundingVolume: { box: tileBox(bounds) }, geometricError: lodIndex === 0 ? 0 : BLOCK835_V3_LOD1_GEOMETRIC_ERROR_METERS, refine: "REPLACE", content: { uri: `../assets/${building.canonicalBuildingId.replace(":", "-")}__${lodId}.glb` } });
    }
    const coarse = chain[1]!; const fine = chain[0]!;
    coarse.transform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, offset[0], offset[1], 0, 1];
    coarse.children = [fine];
    tileChains.push(coarse);

    assets.push({
      canonicalFeatureId: building.canonicalBuildingId,
      ownerCellId: BLOCK835_CELL_ID,
      inventoryId, inventoryHashSha256,
      evidenceShardId: v3EvidenceShardId(building.canonicalBuildingId),
      truthTiers,
      sourceDates: { capturedAt: building.capturedAt, updatedAt: building.updatedAt },
      predecessor,
      uncertainty: DETERMINISTIC_FACADE_V3_UNCERTAINTY,
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
  artifacts.push({ logicalId: `tileset:${BLOCK835_V3_PACKAGE_ID}`, role: "tileset-json", relativeRef: tilesetRef, byteSize: tilesetBytes.byteLength, checksumSha256: sha256HexBytes(tilesetBytes), ownerCellId: null });

  const ownershipLedger = {
    ledgerId: BLOCK835_V3_OWNERSHIP_LEDGER_ID,
    cityId: BLOCK835_CITY_ID,
    configId: BLOCK835_CONFIG_ID,
    baseIdentitySet: { id: BLOCK835_V3_BASE_IDENTITY_SET_ID, buildingCount: buildingIds.length, checksumSha256: baseChecksum },
    cells: [{ cellId: BLOCK835_CELL_ID, order: 0, buildingIds: [...buildingIds].sort(), membershipChecksumSha256: baseChecksum }],
    derivedFrom: { releaseId: BLOCK835_PILOT_RELEASE_ID, checksumSha256: options.releaseChecksumSha256 },
  };

  const manifest: MultiLodAssemblyManifest = {
    schemaVersion: "1.0",
    packageId: BLOCK835_V3_PACKAGE_ID,
    audience: "private",
    generatedAt: BLOCK835_V3_GENERATED_AT,
    immutable: true,
    release: {
      rootId: `private:${BLOCK835_V3_PACKAGE_ID}`,
      rootChecksumSha256: options.releaseChecksumSha256,
      releaseId: BLOCK835_PILOT_RELEASE_ID,
      cityId: BLOCK835_CITY_ID,
      configId: BLOCK835_CONFIG_ID,
      privatePredecessor: null,
    },
    baseIdentitySet: { id: BLOCK835_V3_BASE_IDENTITY_SET_ID, checksumSha256: baseChecksum },
    ownershipLedger: { id: BLOCK835_V3_OWNERSHIP_LEDGER_ID, checksumSha256: sha256HexSync(stableSerialize(ownershipLedger)) },
    cells: [{
      cellId: BLOCK835_CELL_ID,
      cellRelease: { id: BLOCK835_V3_PACKAGE_ID, checksumSha256: sha256HexSync(stableSerialize(ownershipLedger)) },
      predecessor: { ...options.predecessor.cellRelease },
      buildingIds: [...buildingIds].sort(),
      membershipChecksumSha256: baseChecksum,
    }],
    assets, artifacts, tilesetRef,
    declaredTotalBytes: artifacts.reduce((sum, artifact) => sum + artifact.byteSize, 0),
  };

  return { manifest, contents, plans, registration, ownershipLedger };
}
