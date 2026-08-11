import {
  DETERMINISTIC_FACADE_V3_SCHEMA_VERSION,
  DETERMINISTIC_FACADE_V3_UNCERTAINTY,
  DETERMINISTIC_FACADE_V3T_UNCERTAINTY,
  v3UncertaintyFor,
  deriveV3Parameters,
  generateV3FacadePlan,
  ringSignedAreaMm2,
  tessellateV3Plan,
  validateV3Plan,
  type Point2Mm,
  type V3Plan,
  type V3StyleClass,
  type V3StyleOverride,
  type V3Tessellation,
} from "../domain/deterministic-facade-generator-v3.ts";
import { sha256HexBytes, sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";
import { writeCanonicalGlb, type CanonicalGlbMaterial, type CanonicalGlbQuad, type CanonicalGlbTextureSet, type CanonicalGlbTri, type Vec2, type Vec3 } from "./canonical-glb.ts";
import { BLOCK835_V3_STYLE_OVERRIDES, block835CitedStyleFor } from "./block835-facade-material-intake.ts";
import {
  BLOCK835_CELL_ID,
  BLOCK835_CITY_ID,
  BLOCK835_CONFIG_ID,
  BLOCK835_LOD0_MAX_DISTANCE_METERS,
  BLOCK835_PILOT_RELEASE_ID,
  BLOCK835_V3_PACKAGE_ID,
  BLOCK835_V3E_PACKAGE_ID,
  BLOCK835_V3T_PACKAGE_ID,
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
import {
  PROCEDURAL_TEXTURE_CLASSES,
  PROCEDURAL_TEXTURE_PROFILE,
  proceduralTextureProvenance,
  proceduralTextureTile,
  type ProceduralTextureClass,
  type ProceduralTextureProfile,
} from "./procedural-texture.ts";

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
 * V3T asset quality budgets: a THIRD, separately versioned gate.
 *
 * `V3_QUALITY_BUDGETS` above is byte-frozen into the committed V3 manifest and
 * pinned by its drift test, so it is never edited — including its zero texture
 * budget, which was an accurate statement about a package that samples no
 * imagery and stays accurate for that package.
 *
 * Four is the profile ceiling, not a guess: the catalogue has four motif classes
 * and a GLB may embed at most one image per class. In practice no style reaches
 * it — every V3 style resolves to three classes at most — so the budget has one
 * class of headroom and still fails closed if a future style mapping widens.
 * Triangles and materials are unchanged from V3: texturing adds no geometry.
 */
export const V3T_QUALITY_BUDGETS = { maxTriangles: 200_000, maxMaterials: 12, maxTextures: 4 } as const;

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
  measures: "Symmetric worst per-vertex deviation between the sourced footprint ring and the shipped tier-0 ring: the larger of (worst sourced vertex to its nearest shipped ring vertex) and (worst shipped ring vertex to its nearest sourced vertex). The candidate set is the ring alone, not every vertex on the ground plane, so an entrance or storefront recess corner can never stand in for a ring vertex; `ringVertexPresenceMeters` separately proves the measured ring is the one written into the shipped bytes. Reported alongside whole-asset horizontal and vertical placement drift, which are different measures and are never summed with it.",
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

export { BLOCK835_V3E_PACKAGE_ID };
export const BLOCK835_V3E_BASE_IDENTITY_SET_ID = "base-identity-set:manhattan:block-835:20260811-v3e" as const;
export const BLOCK835_V3E_OWNERSHIP_LEDGER_ID = "ownership-ledger:manhattan:block-835:20260811-v3e" as const;
/** The untextured V3 package `-v3e` supersedes without editing a byte of it. */
export const BLOCK835_V3E_PREDECESSOR_PACKAGE_ID = BLOCK835_V3_PACKAGE_ID;

export { BLOCK835_V3T_PACKAGE_ID };
export const BLOCK835_V3T_BASE_IDENTITY_SET_ID = "base-identity-set:manhattan:block-835:20260811-v3t" as const;
export const BLOCK835_V3T_OWNERSHIP_LEDGER_ID = "ownership-ledger:manhattan:block-835:20260811-v3t" as const;
/** The untextured V3 package V3T supersedes without editing a byte of it. */
export const BLOCK835_V3T_PREDECESSOR_PACKAGE_ID = BLOCK835_V3_PACKAGE_ID;

/**
 * The two package identities this assembler can emit.
 *
 * Everything the grammar produces is shared: the same plans, the same plan
 * hashes, the same massing, the same tessellation. What the profile selects is
 * the package's IDENTITY, its quality gate, its uncertainty statement, and
 * whether LOD 0 carries detail tiles. Keeping them in one record is what makes
 * "the untextured path is unchanged" checkable by reading rather than by hoping.
 */
export interface V3PackageProfile {
  packageId: string;
  baseIdentitySetId: string;
  ownershipLedgerId: string;
  predecessorPackageId: string;
  budgets: { maxTriangles: number; maxMaterials: number; maxTextures: number };
  /**
   * The asset-level statement, when every asset in the package makes the same
   * one. `uncertaintyForPlan` overrides it per asset; a package whose assets do
   * NOT all say the same thing must use that instead of picking one.
   */
  uncertainty: string;
  /** Per-asset statement, read from the plan. Only `-v3e` needs it today. */
  uncertaintyForPlan?: (plan: V3Plan) => string;
  /** Cited style overrides, keyed by canonical building id. Empty for V3/V3T. */
  styleOverrides?: ReadonlyMap<string, V3StyleOverride>;
  /** LOD 0 only. LOD 1 is viewed from beyond 250 m, where a detail tile is invisible cost. */
  texture: ProceduralTextureProfile | null;
}

export const BLOCK835_V3_PROFILE: V3PackageProfile = {
  packageId: BLOCK835_V3_PACKAGE_ID,
  baseIdentitySetId: BLOCK835_V3_BASE_IDENTITY_SET_ID,
  ownershipLedgerId: BLOCK835_V3_OWNERSHIP_LEDGER_ID,
  predecessorPackageId: BLOCK835_V3_PREDECESSOR_PACKAGE_ID,
  budgets: { ...V3_QUALITY_BUDGETS },
  uncertainty: DETERMINISTIC_FACADE_V3_UNCERTAINTY,
  texture: null,
};

/**
 * The evidence-cited successor of `-v3`.
 *
 * It differs from `-v3` in exactly two ways, and both are consequences of the
 * same fact rather than independent choices: the Empire State Building's plan
 * carries a cited `styleOverride`, and asset uncertainty is therefore read from
 * each PLAN rather than declared once for the package — because the fourteen
 * assets no longer all make the same statement. Budgets, textures (none), LOD
 * policy and the grammar are unchanged.
 */
export const BLOCK835_V3E_PROFILE: V3PackageProfile = {
  packageId: BLOCK835_V3E_PACKAGE_ID,
  baseIdentitySetId: BLOCK835_V3E_BASE_IDENTITY_SET_ID,
  ownershipLedgerId: BLOCK835_V3E_OWNERSHIP_LEDGER_ID,
  predecessorPackageId: BLOCK835_V3E_PREDECESSOR_PACKAGE_ID,
  budgets: { ...V3_QUALITY_BUDGETS },
  uncertainty: DETERMINISTIC_FACADE_V3_UNCERTAINTY,
  uncertaintyForPlan: (plan) => plan.uncertainty,
  styleOverrides: BLOCK835_V3_STYLE_OVERRIDES,
  texture: null,
};

export const BLOCK835_V3T_PROFILE: V3PackageProfile = {
  packageId: BLOCK835_V3T_PACKAGE_ID,
  baseIdentitySetId: BLOCK835_V3T_BASE_IDENTITY_SET_ID,
  ownershipLedgerId: BLOCK835_V3T_OWNERSHIP_LEDGER_ID,
  predecessorPackageId: BLOCK835_V3T_PREDECESSOR_PACKAGE_ID,
  budgets: { ...V3T_QUALITY_BUDGETS },
  uncertainty: DETERMINISTIC_FACADE_V3T_UNCERTAINTY,
  texture: PROCEDURAL_TEXTURE_PROFILE,
};

function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }

export function v3EvidenceShardId(canonicalBuildingId: string, packageId: string = BLOCK835_V3_PACKAGE_ID): string {
  return `evidence-shard:${packageId}:${canonicalBuildingId}`;
}
export function v3InventoryId(canonicalBuildingId: string, packageId: string = BLOCK835_V3_PACKAGE_ID): string {
  return `inventory:${packageId}:${canonicalBuildingId}`;
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
export function buildV3Plan(building: PilotBuildingSource, styleOverride?: V3StyleOverride): V3PlanContext {
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
    // Omitted rather than set to `undefined`: `stableSerialize` writes a present
    // undefined key as `null`, which would move all fourteen V3 plan hashes
    // instead of only the overridden building's.
    ...(styleOverride ? { styleOverride: { ...styleOverride } } : {}),
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

export interface V3GlbGeometry { quads: CanonicalGlbQuad[]; triangles: CanonicalGlbTri[]; materials: CanonicalGlbMaterial[]; textures: CanonicalGlbTextureSet | null }

/** Plan-local millimetres to the building-anchored ENU metre frame. No rotation. */
function toEnuVec(corner: readonly [number, number, number]): Vec3 { return [corner[0] / 1_000, corner[1] / 1_000, corner[2] / 1_000]; }
/** Same +Y-up file mapping the V1/V2 writers use; determinant +1, so winding survives. */
function toYUp(corner: Vec3): Vec3 { return [corner[0], corner[2], -corner[1]]; }

// ---------------------------------------------------------------------------
// Procedural detail tiles (V3T)
//
// Nothing in this section touches the grammar. `deterministic-facade-generator-v3.ts`
// is untouched, no plan field moves, and every V3 plan hash is unchanged — the
// V3T tests assert exactly that. Texturing is a WRITER-stage concern here: UVs
// are projected from geometry the grammar already produced, and colour is
// re-expressed in the GLB material factors the grammar already declared.
// ---------------------------------------------------------------------------

/**
 * Which detail tile a designed material wears.
 *
 * Roof and ground stay untextured: the tiles are facade motifs, and stretching a
 * brick bond across a roof deck would be a claim about a surface nobody has
 * looked at. At most three classes are reachable for any one style, comfortably
 * inside the profile's four-image ceiling.
 */
export function v3TextureClassFor(styleClass: V3StyleClass, materialId: string): ProceduralTextureClass | null {
  if (materialId === "material:roof" || materialId === "material:ground") return null;
  if (materialId === "material:metal" || materialId.startsWith("material:trim")) return "spandrel-panel";
  if (materialId.startsWith("material:glazing")) return "curtain-mullion-grid";
  if (styleClass === "curtain-cool") return materialId === "material:facade:base" ? "limestone-ashlar" : "curtain-mullion-grid";
  if (styleClass === "stone-neutral") return "limestone-ashlar";
  return "brick-running-bond";
}

/**
 * Calibrated sRGB targets for the textured package, per style and material.
 *
 * Covers every material the grammar emits EXCEPT `material:ground`, which keeps
 * its V3 sidewalk tone on purpose: it is public realm rather than building
 * fabric, it carries no detail tile, and recolouring it here would change the
 * street surface as a side effect of a facade decision.
 *
 * These come from the same written calibration brief as the motif modules —
 * design conclusions in text, transcribed as hex. They are NOT a change to
 * `V3_PALETTE`: that constant feeds `plan.materials`, so editing it would move
 * every plan hash and break the byte-frozen V3 package. The plan keeps its own
 * designed palette; V3T re-expresses colour at the GLB material factor, which no
 * hash covers.
 *
 * Base-course weathering lives here rather than in the tiles, and that placement
 * is the honest one: a repeating tile has no idea which storey it is on, so
 * "the base is dirtier than the shaft" can only be said by giving the base zone
 * — which the grammar already separates — its own weathered tone.
 *
 * The hexes remain designed plausible tones. They assert nothing about the
 * colour, material, age or condition of any real building.
 */
export const V3T_CALIBRATED_PALETTE: Readonly<Record<V3StyleClass, Readonly<Record<string, string>>>> = {
  "masonry-warm": {
    "material:facade:base": "#7A3A2C", "material:facade:shaft": "#9C4A34",
    "material:glazing:base": "#5C4A32", "material:glazing:shaft": "#5C4A32",
    "material:trim:base": "#5A4326", "material:trim:shaft": "#8A6B3E",
    "material:roof": "#1C1B19", "material:metal": "#8E9092",
  },
  "masonry-light": {
    "material:facade:base": "#B7B0A0", "material:facade:shaft": "#D8D3C4",
    "material:glazing:base": "#6B6F72", "material:glazing:shaft": "#6B6F72",
    "material:trim:base": "#8A6B3E", "material:trim:shaft": "#C4834F",
    "material:roof": "#1C1B19", "material:metal": "#B8BAB8",
  },
  "stone-neutral": {
    "material:facade:base": "#B8AC94", "material:facade:shaft": "#D9CFB8",
    "material:glazing:base": "#3E5A57", "material:glazing:shaft": "#3E5A57",
    "material:trim:base": "#C9BC9E", "material:trim:shaft": "#C9BC9E",
    "material:roof": "#8A8478", "material:metal": "#8E9092",
  },
  "curtain-cool": {
    "material:facade:base": "#8F8A7C", "material:facade:shaft": "#3E5A57",
    "material:glazing:base": "#6B6F72", "material:glazing:shaft": "#6B6F72",
    "material:trim:base": "#B8BAB8", "material:trim:shaft": "#B8BAB8",
    "material:roof": "#B9BBBC", "material:metal": "#8E9092",
  },
};

function srgbTriple(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

/**
 * Divides the calibrated target through the tile's mean modulation so the
 * TEXTURED surface averages the intended tone rather than the tile's darkening
 * of it. The scale is uniform across the three channels — a per-channel divide
 * would clip one channel first and shift the hue — and is reduced when it would
 * push any channel past 1, which the closed glTF profile forbids.
 *
 * Exported so the hue-preservation and range claims can be tested directly
 * rather than inferred from shipped bytes.
 */
export function v3tCalibratedFactor(hex: string, meanModulation: number): [number, number, number, number] {
  const target = srgbTriple(hex);
  const headroom = Math.max(...target);
  const scale = Math.min(1 / meanModulation, headroom > 0 ? 1 / headroom : 1);
  return [target[0] * scale, target[1] * scale, target[2] * scale, 1];
}

type Vec3Mm = readonly [number, number, number];
function subtract(left: Vec3Mm, right: Vec3Mm): Vec3Mm { return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]; }
function cross(left: Vec3Mm, right: Vec3Mm): Vec3Mm {
  return [left[1] * right[2] - left[2] * right[1], left[2] * right[0] - left[0] * right[2], left[0] * right[1] - left[1] * right[0]];
}
function dot(left: Vec3Mm, right: Vec3Mm): number { return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]; }
/** `Math.sqrt` is correctly rounded by IEEE 754; `Math.hypot` is not specified to be, and these bytes ship. */
function normalize(vector: Vec3Mm): Vec3Mm {
  const length = Math.sqrt(dot(vector, vector));
  return length === 0 ? [0, 0, 1] : [vector[0] / length, vector[1] / length, vector[2] / length];
}

/**
 * The projection basis for one face, derived from the face's own corners.
 *
 * Two properties matter and both are load-bearing.
 *
 * CONTINUITY. The basis depends only on the face NORMAL, never on a corner
 * chosen as an origin, and the UV is `dot(position, axis)` taken in the
 * PLAN-LOCAL, building-anchored ENU millimetre frame — absolute with respect to
 * the building, never with respect to the city. Two coplanar faces on the same
 * wall therefore land on the same basis and the same offsets, so coursing runs
 * straight across the boundary between them. A per-face origin — the obvious
 * implementation — restarts the pattern at every quad and draws a visible seam at
 * every subdivision line, which on this grammar means one per bay per floor.
 *
 * The building-local frame is also a float32 requirement, not just a convention:
 * UVs peak near 160 tile repeats here, where float32 resolves ~1e-5 of a tile.
 * The same projection anchored to an ECEF origin would reach ~8e6, where
 * consecutive float32 values are half a tile apart. See ADR 0032.
 *
 * UPRIGHTNESS. For anything wall-like, +v is world up, so bed joints are level
 * and streaks fall vertically no matter how the facade is oriented. Only when
 * the face is within 45 degrees of horizontal — roof decks, ground — does the
 * basis fall back to the world X/Y axes, and those surfaces are untextured
 * anyway.
 */
function projectionBasis(corners: readonly Vec3Mm[]): { uAxis: Vec3Mm; vAxis: Vec3Mm } {
  // Newell's method: uses every corner, so it is stable on a near-degenerate
  // triangle fan where a three-point cross product would collapse.
  let normal: Vec3Mm = [0, 0, 0];
  for (let index = 0; index < corners.length; index += 1) {
    const current = corners[index]!;
    const next = corners[(index + 1) % corners.length]!;
    normal = [
      normal[0] + (current[1] - next[1]) * (current[2] + next[2]),
      normal[1] + (current[2] - next[2]) * (current[0] + next[0]),
      normal[2] + (current[0] - next[0]) * (current[1] + next[1]),
    ];
  }
  const unit = normalize(normal);
  if (Math.abs(unit[2]) < Math.SQRT1_2) {
    const vAxis = normalize(subtract([0, 0, 1], [unit[0] * unit[2], unit[1] * unit[2], unit[2] * unit[2]]));
    return { uAxis: normalize(cross(vAxis, unit)), vAxis };
  }
  const uAxis = normalize(subtract([1, 0, 0], [unit[0] * unit[0], unit[1] * unit[0], unit[2] * unit[0]]));
  return { uAxis, vAxis: normalize(cross(unit, uAxis)) };
}

interface TextureBinding { materialImage: (number | null)[]; images: ProceduralTextureClass[]; tileFor: (materialIndex: number) => { uAxisMm: number; vAxisMm: number } | null }

function bindTextures(plan: V3Plan): TextureBinding {
  const classPerMaterial = plan.materials.map((material) => v3TextureClassFor(plan.styleClass, material.id));
  const images = PROCEDURAL_TEXTURE_CLASSES.filter((textureClass) => classPerMaterial.includes(textureClass));
  const materialImage = classPerMaterial.map((textureClass) => (textureClass === null ? null : images.indexOf(textureClass)));
  return {
    materialImage, images: [...images],
    tileFor: (materialIndex) => {
      const textureClass = classPerMaterial[materialIndex] ?? null;
      if (textureClass === null) return null;
      const tile = proceduralTextureTile(textureClass);
      return { uAxisMm: tile.tileUMm, vAxisMm: tile.tileVMm };
    },
  };
}

export function v3GeometryForGlb(plan: V3Plan, tessellation: V3Tessellation, options: { yUp: boolean; texture?: ProceduralTextureProfile | null }): V3GlbGeometry {
  const textured = options.texture === PROCEDURAL_TEXTURE_PROFILE;
  const binding = textured ? bindTextures(plan) : null;
  const materialIndexById = new Map(plan.materials.map((material, index) => [material.id, index]));
  const palette = textured ? V3T_CALIBRATED_PALETTE[plan.styleClass] : null;
  const materials: CanonicalGlbMaterial[] = plan.materials.map((material) => {
    const hex = palette?.[material.id];
    if (hex !== undefined && binding) {
      const textureClass = v3TextureClassFor(plan.styleClass, material.id);
      const mean = textureClass === null ? 1 : proceduralTextureTile(textureClass).meanModulation;
      return { baseColorFactor: v3tCalibratedFactor(hex, mean), metallicFactor: material.metallicPermille / 1_000, roughnessFactor: material.roughnessPermille / 1_000 };
    }
    return {
      baseColorFactor: [material.baseColorSrgb[0] / 255, material.baseColorSrgb[1] / 255, material.baseColorSrgb[2] / 255, material.baseColorSrgb[3] / 255],
      metallicFactor: material.metallicPermille / 1_000,
      roughnessFactor: material.roughnessPermille / 1_000,
    };
  });
  const materialIndexOf = (id: string): number => {
    const index = materialIndexById.get(id);
    if (index === undefined) throw new Error(`V3 plan cites an undeclared material: ${id}`);
    return index;
  };
  const map = (corner: readonly [number, number, number]): Vec3 => {
    const enu = toEnuVec(corner);
    return options.yUp ? toYUp(enu) : enu;
  };
  const uvFor = (materialIndex: number, corners: readonly Vec3Mm[]): Vec2[] | null => {
    const tile = binding?.tileFor(materialIndex);
    if (!tile) return null;
    const { uAxis, vAxis } = projectionBasis(corners);
    return corners.map((corner) => [dot(corner, uAxis) / tile.uAxisMm, dot(corner, vAxis) / tile.vAxisMm] as Vec2);
  };
  return {
    materials,
    textures: binding === null ? null : { images: binding.images.map((textureClass) => ({ mimeType: "image/png" as const, bytes: proceduralTextureTile(textureClass).pngBytes })), materialImage: binding.materialImage },
    quads: tessellation.quads.map((quad) => {
      const materialIndex = materialIndexOf(quad.materialId);
      const uv = uvFor(materialIndex, quad.corners);
      return {
        materialIndex,
        corners: [map(quad.corners[0]), map(quad.corners[1]), map(quad.corners[2]), map(quad.corners[3])] as const,
        ...(uv ? { uv: [uv[0]!, uv[1]!, uv[2]!, uv[3]!] as const } : {}),
      };
    }),
    triangles: tessellation.triangles.map((triangle) => {
      const materialIndex = materialIndexOf(triangle.materialId);
      const uv = uvFor(materialIndex, [triangle.a, triangle.b, triangle.c]);
      return {
        materialIndex,
        a: map(triangle.a), b: map(triangle.b), c: map(triangle.c),
        ...(uv ? { uv: [uv[0]!, uv[1]!, uv[2]!] as const } : {}),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// True-footprint-vertex registration
// ---------------------------------------------------------------------------

export interface V3RegistrationEntry {
  canonicalBuildingId: string;
  sourceVertexCount: number;
  shippedGroundVertexCount: number;
  /**
   * Symmetric worst per-vertex distance between the sourced footprint ring and
   * the shipped tier-0 ring: `max(sourceToRing, ringToSource)`. Taken against
   * the ring alone, never against every ground-plane vertex.
   */
  perVertexShapeDeviationMeters: number;
  /** Worst sourced vertex to its nearest shipped ring vertex. */
  sourceToRingDeviationMeters: number;
  /** Worst shipped ring vertex to its nearest sourced vertex. */
  ringToSourceDeviationMeters: number;
  /** Worst shipped ring vertex to the nearest ground-plane vertex actually written. */
  ringVertexPresenceMeters: number;
  /** Ring vertices compared; equals `sourceVertexCount` because the ring is carried verbatim. */
  ringVertexCount: number;
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
/** One millimetre. The ring and the shipped cap are the same doubles here, so this is slack, not a budget. */
const RING_PRESENCE_EPSILON_METERS = 1e-3;

/** Worst distance from any point in `from` to its nearest neighbour in `to`. */
function directedVertexDeviation(from: readonly Point2[], to: readonly Point2[]): number {
  let worst = 0;
  for (const point of from) {
    let nearest = Number.POSITIVE_INFINITY;
    for (const candidate of to) nearest = Math.min(nearest, Math.hypot(candidate[0] - point[0], candidate[1] - point[1]));
    worst = Math.max(worst, nearest);
  }
  return worst;
}

/**
 * Measures the shipped ground ring against the SOURCED polygon, vertex for
 * vertex. V1 and V2 could only compare against the oriented bounding rectangle,
 * so they measured pipeline drift and disclaimed shape; V3 carries the true
 * ring, so the same report can bound shape error as well.
 *
 * The shape measure is SYMMETRIC and is taken against the ring alone.
 *
 * A one-directional measure over every ground-plane vertex would have been much
 * weaker than it looks, in two separate ways. It would have searched a candidate
 * SUPERSET — the ground plane also carries entrance and storefront recess
 * corners — so a sourced vertex could be "matched" by an unrelated detail vertex
 * that happens to sit near it. And searching in one direction only bounds how
 * far a sourced vertex is from SOMETHING shipped; it says nothing about a
 * shipped ring vertex that wandered away from every sourced one, because that
 * vertex is never the argument of a minimum. The symmetric form over the ring
 * bounds both failure modes, and `ringVertexPresenceMeters` proves the ring it
 * measures is the ring actually written into the bytes.
 *
 * `perVertexShapeDeviationMeters` and `horizontalDeviationMeters` remain
 * different measures and are never summed: the first is worst per-vertex shape
 * error, the second is whole-asset placement drift of the centroid.
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

  const shippedRing: Point2[] = context.ringMm.map((point) => [point[0] / 1_000, point[1] / 1_000]);
  // The ring this measure is taken against must be provably the one in the
  // shipped bytes, or the comparison is against an intention rather than an
  // artifact. Both sides are pre-quantisation doubles here, so the match is
  // exact up to binary rounding; the bound is a millimetre and holds far below.
  const ringPresence = directedVertexDeviation(shippedRing, observed);
  if (ringPresence > RING_PRESENCE_EPSILON_METERS) {
    throw new Error(`Shipped V3 ground plane for ${context.building.canonicalBuildingId} does not carry its own tier-0 ring (worst ${ringPresence} m).`);
  }
  const sourceToRing = directedVertexDeviation(sourceVertices, shippedRing);
  const ringToSource = directedVertexDeviation(shippedRing, sourceVertices);
  const shape = Math.max(sourceToRing, ringToSource);

  // Placement drift: the shipped ring's own vertices against the sourced ring.
  // Both centroids are plain vertex means of the same polygon, so any offset
  // between them is pipeline placement error and nothing else.
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
    sourceToRingDeviationMeters: sourceToRing,
    ringToSourceDeviationMeters: ringToSource,
    ringVertexPresenceMeters: ringPresence,
    ringVertexCount: shippedRing.length,
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

/**
 * Reads a frozen predecessor manifest and derives this package's pins.
 *
 * The expected id is a parameter rather than a constant so V3T can pin V3 the
 * same way V3 pins V2, and so neither can accidentally pin the wrong ancestor:
 * the check is still exact, it is simply parameterised.
 */
export function v3PredecessorPins(previousManifest: MultiLodAssemblyManifest, expectedPackageId: string = BLOCK835_V3_PREDECESSOR_PACKAGE_ID): V3PredecessorPins {
  if (previousManifest.packageId !== expectedPackageId) {
    throw new Error(`V3 predecessor pins must come from ${expectedPackageId}, not ${previousManifest.packageId}.`);
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
  /**
   * Omitted or `null` selects the untextured V3 package and reproduces its bytes
   * exactly; the V3 drift test asserts the committed fingerprint is unchanged.
   */
  profile?: V3PackageProfile;
}): AssembledV3 {
  const profile = options.profile ?? BLOCK835_V3_PROFILE;
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
    const context = buildV3Plan(building, profile.styleOverrides?.get(building.canonicalBuildingId));
    const plan = context.plan;
    plans.push(plan);
    const inventoryId = v3InventoryId(building.canonicalBuildingId, profile.packageId);
    const inventoryHashSha256 = sha256HexSync(stableSerialize(plan.inventory));
    const truthTiers = v3TruthTiers(plan);
    // Read from the plan when the package's assets do not all make the same
    // statement, so a cited asset cannot inherit the uncited wording.
    const assetUncertainty = profile.uncertaintyForPlan?.(plan) ?? profile.uncertainty;
    // Resolved from the admission, so an asset can only carry a citation whose
    // record was actually admitted and is actually conveyable in public.
    const citedStyle = plan.input.styleOverride ? block835CitedStyleFor(building.canonicalBuildingId) : undefined;
    if (Boolean(citedStyle) !== Boolean(plan.input.styleOverride)) {
      throw new Error(`V3 asset ${building.canonicalBuildingId} disagrees with its plan about whether its style class is cited.`);
    }
    if (assetUncertainty !== v3UncertaintyFor(plan.input.styleOverride) && profile.uncertaintyForPlan) {
      throw new Error(`V3 asset ${building.canonicalBuildingId} uncertainty does not match its cited-override state.`);
    }
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
      // Detail tiles ride on LOD 0 alone. LOD 1 is selected beyond 250 m, where a
      // 128-pixel joint is far below a screen pixel: the bytes would buy nothing
      // and the coarse level stays byte-comparable with its V3 predecessor.
      const texture = lodIndex === 0 ? profile.texture : null;
      const enu = v3GeometryForGlb(plan, tessellation, { yUp: false });
      if (lodIndex === 0) registration.push(v3RegistrationEntry(context, enu));
      const file = v3GeometryForGlb(plan, tessellation, { yUp: true, texture });
      const relativeRef = `private/assets/${building.canonicalBuildingId.replace(":", "-")}__${lodId}.glb`;
      const metadata = {
        canonicalFeatureId: building.canonicalBuildingId,
        lodId,
        ownerCellId: BLOCK835_CELL_ID,
        inventoryId,
        inventoryHashSha256,
        evidenceShardId: v3EvidenceShardId(building.canonicalBuildingId, profile.packageId),
        truthTiers,
        sourceDates: { capturedAt: building.capturedAt, updatedAt: building.updatedAt },
        predecessor,
        uncertainty: assetUncertainty,
        planHashSha256: plan.planHashSha256,
        ...(citedStyle ? { citedStyle } : {}),
        // Present exactly when the GLB carries images, which is the condition
        // the release validator uses to decide whether to demand a replay.
        ...(file.textures ? { textureProvenance: proceduralTextureProvenance() } : {}),
      };
      const written = writeCanonicalGlb({ quads: file.quads, triangles: file.triangles, materials: file.materials, metadata, ...(file.textures ? { textures: file.textures } : {}) });
      if (written.counts.triangleCount > profile.budgets.maxTriangles || written.counts.materialCount > profile.budgets.maxMaterials || written.counts.textureCount > profile.budgets.maxTextures) {
        throw new Error(`V3 ${building.canonicalBuildingId} ${lodId} exceeds the ${profile.packageId} asset budgets (${written.counts.triangleCount} triangles, ${written.counts.materialCount} materials, ${written.counts.textureCount} textures).`);
      }
      contents.set(relativeRef, written.bytes);
      artifacts.push({ logicalId: `glb:${building.canonicalBuildingId}:${lodId}`, role: "glb", relativeRef, byteSize: written.bytes.byteLength, checksumSha256: sha256HexBytes(written.bytes), ownerCellId: BLOCK835_CELL_ID });
      lods.push({
        lodId, artifactRef: relativeRef,
        geometricErrorMeters: lodIndex === 0 ? 0 : BLOCK835_V3_LOD1_GEOMETRIC_ERROR_METERS,
        maxDistanceMeters: lodIndex === 0 ? BLOCK835_LOD0_MAX_DISTANCE_METERS : null,
        eligible: true,
        quality: { ...written.counts, budgets: { ...profile.budgets } },
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
      evidenceShardId: v3EvidenceShardId(building.canonicalBuildingId, profile.packageId),
      truthTiers,
      sourceDates: { capturedAt: building.capturedAt, updatedAt: building.updatedAt },
      predecessor,
      uncertainty: assetUncertainty,
      source: { kind: "facade-plan", planId: plan.planId, planHashSha256: plan.planHashSha256 },
      ...(citedStyle ? { citedStyle } : {}),
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
  artifacts.push({ logicalId: `tileset:${profile.packageId}`, role: "tileset-json", relativeRef: tilesetRef, byteSize: tilesetBytes.byteLength, checksumSha256: sha256HexBytes(tilesetBytes), ownerCellId: null });

  const ownershipLedger = {
    ledgerId: profile.ownershipLedgerId,
    cityId: BLOCK835_CITY_ID,
    configId: BLOCK835_CONFIG_ID,
    baseIdentitySet: { id: profile.baseIdentitySetId, buildingCount: buildingIds.length, checksumSha256: baseChecksum },
    cells: [{ cellId: BLOCK835_CELL_ID, order: 0, buildingIds: [...buildingIds].sort(), membershipChecksumSha256: baseChecksum }],
    derivedFrom: { releaseId: BLOCK835_PILOT_RELEASE_ID, checksumSha256: options.releaseChecksumSha256 },
  };

  const manifest: MultiLodAssemblyManifest = {
    schemaVersion: "1.0",
    packageId: profile.packageId,
    audience: "private",
    generatedAt: BLOCK835_V3_GENERATED_AT,
    immutable: true,
    release: {
      rootId: `private:${profile.packageId}`,
      rootChecksumSha256: options.releaseChecksumSha256,
      releaseId: BLOCK835_PILOT_RELEASE_ID,
      cityId: BLOCK835_CITY_ID,
      configId: BLOCK835_CONFIG_ID,
      privatePredecessor: null,
    },
    baseIdentitySet: { id: profile.baseIdentitySetId, checksumSha256: baseChecksum },
    ownershipLedger: { id: profile.ownershipLedgerId, checksumSha256: sha256HexSync(stableSerialize(ownershipLedger)) },
    cells: [{
      cellId: BLOCK835_CELL_ID,
      cellRelease: { id: profile.packageId, checksumSha256: sha256HexSync(stableSerialize(ownershipLedger)) },
      predecessor: { ...options.predecessor.cellRelease },
      buildingIds: [...buildingIds].sort(),
      membershipChecksumSha256: baseChecksum,
    }],
    assets, artifacts, tilesetRef,
    declaredTotalBytes: artifacts.reduce((sum, artifact) => sum + artifact.byteSize, 0),
  };

  return { manifest, contents, plans, registration, ownershipLedger };
}
