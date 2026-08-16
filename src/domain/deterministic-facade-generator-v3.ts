/**
 * V3 deterministic facade grammar: footprint-faithful massing.
 *
 * V1 and V2 both ship a rectangle. `validateV2Input` rejects any ring that is
 * not four vertices, so the shipped massing of every Block 835 building is the
 * minimum-area oriented bounding rectangle of its DOITT footprint, not the
 * footprint. All fourteen of those footprints are concave — one to four reflex
 * vertices, up to nineteen vertices, edges down to 0.05 m — so the rectangle is
 * a visible, disclosed abstraction.
 *
 * V3 carries the sourced ring VERBATIM. There is no simplification pass and no
 * vertex budget beyond a bounded cap: the only vertices that ever disappear are
 * exactly duplicated consecutive millimetre coordinates. Everything the grammar
 * builds — tiers, facade bands, setback decks, caps — is derived from that ring.
 *
 * V2 stays byte-frozen. This is a sibling module with its own generator id,
 * version, schema version and uncertainty statements; it never imports V2
 * behaviour that could drift V2 output.
 *
 * What V3 does NOT claim. The massing follows the sourced polygon and the
 * sourced height. The APPEARANCE — tier subdivision, bay rhythm, opening sizes,
 * colours, materials — is designed. It is derived from no imagery and no
 * observation of the real building and asserts nothing about how that building
 * actually looks. See `DETERMINISTIC_FACADE_V3_UNCERTAINTY`.
 *
 * Three invariants are new in V3 and exist because a concave ring can fail in
 * ways a rectangle cannot:
 *
 *   - Reject, don't repair. An inward tier offset that flips orientation,
 *     falls under the area floor or self-intersects is refused. The planner's
 *     documented response is to drop setbacks entirely and disclose it, never to
 *     nudge the ring back into validity.
 *   - Corner clearance. Placements keep clear of both ends of their edge by
 *     `depth / tan(theta/2)` at sharp convex corners and by a flat `depth`
 *     from 90 degrees up, so opposed recesses cannot meet inside a corner.
 *   - Local thickness. A ring with a neck thinner than two opposed recesses
 *     plus a wall is refused at input, because those recesses would punch
 *     straight through the massing.
 */

import {
  EXTERIOR_COMPONENT_SCHEMA_VERSION,
  REQUIRED_EXTERIOR_COMPONENT_KINDS,
  type ExteriorComponentInventory,
} from "./exterior-contract.ts";
import { domainSeparatedSha256, stableSerialize } from "./deterministic-hash.ts";

export const DETERMINISTIC_FACADE_V3_SCHEMA_VERSION = "3.0" as const;
export const DETERMINISTIC_FACADE_V3_GENERATOR_ID = "urban-digital-twin:deterministic-facade-plan-v3" as const;
export const DETERMINISTIC_FACADE_V3_GENERATOR_VERSION = "3.0.0" as const;

/**
 * Plan-level honesty statement. It separates what the geometry follows (the
 * sourced polygon and height) from what the grammar invents (everything about
 * how the building looks), because V3's whole point is that the first became
 * faithful while the second did not.
 */
export const DETERMINISTIC_FACADE_V3_UNCERTAINTY =
  "Footprint-faithful procedural exterior in local millimetres. The massing follows the sourced building polygon vertex for vertex and the sourced height; nothing else does. Tier subdivision, bay rhythm, openings, attached elements, colour and material are designed by this grammar, derived from no imagery and no observation, and assert nothing about the real building's appearance, facade, setbacks, balconies, fire escapes, water tanks or signage, nor any tenant, brand or text." as const;

/**
 * Uncertainty statement for a plan whose style class came from a CITED source
 * rather than from this grammar's designed draw.
 *
 * The V3 statement above says colour and material are "derived from no imagery
 * and no observation". Inside a plan carrying `styleOverride` that sentence is
 * false, and shipping it would be exactly the kind of stale boilerplate that
 * makes an uncertainty statement worthless. This constant states the narrower
 * truth: one designed property — the facade material class — follows a cited
 * public documentary source named by record id, and everything else is
 * unchanged, including the signage sentence, which is carried verbatim because
 * a cited material fact licenses nothing about tenants, brands or text.
 *
 * `DETERMINISTIC_FACADE_V3_UNCERTAINTY` is NOT edited: the fourteen committed V3
 * plans keep their bytes and their hashes.
 */
export const DETERMINISTIC_FACADE_V3_CITED_STYLE_UNCERTAINTY =
  "Footprint-faithful procedural exterior in local millimetres. The massing follows the sourced building polygon vertex for vertex and the sourced height; nothing else does. Tier subdivision, bay rhythm, openings and attached elements are designed by this grammar and derived from no observation. The facade material CLASS follows a cited public documentary source, recorded by intake record id in this plan; the specific tones, coursing and geometry expressing that class are still designed. No imagery was ingested, traced, sampled or reproduced, and no other real-world appearance claim is made. This plan asserts nothing about the real building's setbacks, balconies, fire escapes, water tanks or signage, nor any tenant, brand or text." as const;

export const DETERMINISTIC_FACADE_V3_UNCERTAINTY_STATEMENTS = [
  DETERMINISTIC_FACADE_V3_UNCERTAINTY,
  DETERMINISTIC_FACADE_V3_CITED_STYLE_UNCERTAINTY,
] as const;
export type DeterministicFacadeV3Uncertainty = (typeof DETERMINISTIC_FACADE_V3_UNCERTAINTY_STATEMENTS)[number];

/**
 * The statement a plan must carry, decided by the ONE fact that makes the two
 * differ. There is no third option and no operator choice: a plan with a cited
 * override carries the cited statement, a plan without one carries the standard
 * statement, and `validateV3Plan` refuses either mismatch.
 */
export function v3UncertaintyFor(styleOverride: V3StyleOverride | undefined): DeterministicFacadeV3Uncertainty {
  return styleOverride === undefined ? DETERMINISTIC_FACADE_V3_UNCERTAINTY : DETERMINISTIC_FACADE_V3_CITED_STYLE_UNCERTAINTY;
}

/**
 * Successor statement for an asset that additionally carries procedural detail
 * tiles. Versioned, never an edit: `DETERMINISTIC_FACADE_V3_UNCERTAINTY` above
 * is byte-frozen into every committed V3 plan and manifest and is pinned by the
 * V3 plan validator, so a textured package states its own successor instead.
 *
 * It adds exactly one thing to the V3 statement — what the surface pattern is
 * and, more importantly, what it is not. The calibration sentence is the whole
 * point: an agent looked at public photographs of Midtown street walls and wrote
 * down conclusions in words. No pixel of any photograph was ingested, decoded,
 * traced, sampled or reproduced, and the shipped tiles are regenerated from
 * named constants by the release validator on every replay.
 *
 * The generator itself is untouched by this constant: it appears here so the two
 * statements stay adjacent and comparable, and it changes no plan and no plan
 * hash.
 */
export const DETERMINISTIC_FACADE_V3T_UNCERTAINTY =
  "Footprint-faithful procedural exterior in local millimetres with procedural surface detail. The massing follows the sourced building polygon vertex for vertex and the sourced height; nothing else does. Tier subdivision, bay rhythm, openings, attached elements, colour, material and surface pattern are designed by this grammar and assert nothing about the real building's appearance, facade, setbacks, balconies, fire escapes, water tanks or signage, nor any tenant, brand or text. The surface pattern is a designed repeating motif whose construction module was calibrated by human and agent viewing of public reference imagery; no image data was ingested, traced, sampled or reproduced, and no material, colour, age, condition or cladding of the real building is asserted." as const;

/** Kept verbatim from V2: the signage honesty rule did not change in V3. */
export const DETERMINISTIC_FACADE_V3_SIGNAGE_UNCERTAINTY =
  "Generated blank sign-band and blade massing only. No real-world sign presence, size, position, orientation, text, brand or tenant is asserted, and no glyph, logo or lettering is generated." as const;

export const DETERMINISTIC_FACADE_V3_LIMITS = {
  minRingVertices: 3,
  /**
   * The ACTIVE ring-vertex cap: what every shipped materializer admits.
   *
   * It carries no derivation, and that absence is itself a finding (T003). Every
   * neighbour in this block states the fact it comes from — `maxRingMillimeters`
   * from the exactness of the orientation predicate in doubles, `minRingAreaMm2`
   * from what a footprint has to be to be a building, `maxAssetTriangles` from a
   * measured frame-time re-check — and this one states nothing. It is not
   * derived from a measured cost, a budget or a property of the source. It
   * refuses 324 real DOITT footprints whose only fault is being finely traced.
   *
   * `V3_EXTENDED_MAX_RING_VERTICES` is the measured replacement. It is NOT the
   * default, because raising this number changes what the already-approved V3
   * wave releases emit when they are re-derived — see that constant.
   */
  maxRingVertices: 64,
  maxTiers: 6,
  maxFloors: 512,
  maxBaysPerEdge: 64,
  maxSurfaces: 8_192,
  maxPlacements: 200_000,
  maxPrisms: 4_096,
  maxPrismSides: 32,
  maxInputIdLength: 128,
  maxPlanIdLength: 256,
  /** Bound on the sourced-fact text a style override may carry into a plan. */
  maxStyleOverrideFactLength: 512,
  /**
   * Footprint coordinates are bounded far below the vertical bound so every
   * orientation and containment predicate stays EXACT in doubles: a cross
   * product of two 5e6 mm spans is 2.5e13, well inside 2^53.
   */
  maxRingMillimeters: 5_000_000,
  maxLocalMillimeters: 1_000_000_000,
  /** Twenty square metres. Below this a "building footprint" is a digitising artefact. */
  minRingAreaMm2: 20_000_000,
  /**
   * The V3 asset triangle budget. It is deliberately larger than the V1/V2
   * budget because a fourteen-edge concave prism costs more than a box; the
   * raise is a named gate change, disclosed in ADR 0031 and re-checked against
   * measured frame time before it ships.
   */
  maxAssetTriangles: 200_000,
} as const;

export type Point2Mm = [number, number];
export type Point3Mm = [number, number, number];

export type V3PlacementKind =
  | "window" | "storefront" | "entrance" | "cornice"
  | "balcony" | "fire-escape" | "sign-band" | "blade-sign";

export type V3SurfaceKind = "facade" | "roof" | "ground" | "setback-deck";
export type V3PrismKind = "water-tank" | "water-tank-leg" | "roof-equipment";

export interface V3SourceAnchor { id: string; kind: "footprint" | "height" | "constraint"; sourceRefId: string; fingerprintSha256: string }

export interface V3Parameters {
  /** Nominal floor height; the real per-floor height is `heightMm / floorCount`. */
  targetFloorHeightMm: number;
  tierCount: number;
  setbackInsetMm: number;
  bayPitchMm: number;
  maxBaysPerEdge: number;
  minPierMm: number;
  windowWidthMm: number;
  windowHeightMm: number;
  windowSillMm: number;
  /** Depth of every opening recess. Half the local-thickness gate is built on it. */
  recessDepthMm: number;
  minWallThicknessMm: number;
  entranceWidthMm: number;
  entranceHeightMm: number;
  storefrontHeightMm: number;
  corniceHeightMm: number;
  corniceDepthMm: number;
  balconyDepthMm: number;
  balconyHeightMm: number;
  balconyFloorInterval: number;
  fireEscapeWidthMm: number;
  fireEscapeDepthMm: number;
  fireEscapePlatformHeightMm: number;
  signBandHeightMm: number;
  signBandDepthMm: number;
  bladeSignWidthMm: number;
  bladeSignHeightMm: number;
  bladeSignDepthMm: number;
  roofEquipmentSizeMm: number;
  roofEquipmentHeightMm: number;
  waterTankSides: number;
  waterTankRadiusMm: number;
  waterTankHeightMm: number;
  waterTankLegHeightMm: number;
  waterTankLegSizeMm: number;
}

/**
 * A cited replacement for this grammar's own designed style draw.
 *
 * The default style class is a DESIGNED draw — deterministic from the input
 * fingerprint and modulated only by sourced height and footprint area — and it
 * is deliberately not an inference about any real building. This override is the
 * one way that draw can be displaced, and it can only be displaced by a fact
 * that came through rights-cleared evidence intake: `evidenceRecordId` names the
 * intake record, and a plan carrying an override with no record is not
 * constructible.
 *
 * It selects a STYLE CLASS and nothing else. The class drives designed material
 * tones; it drives no geometry (`buildPlan` derives tiers, surfaces, placements
 * and prisms without ever reading `styleClass`) and it never authorises a
 * texture. A sourced material fact may therefore make the designed appearance
 * less wrong; it may not become a claim that the shipped surface reproduces the
 * real one, which is why `DETERMINISTIC_FACADE_V3_UNCERTAINTY` is unchanged by
 * an override.
 *
 * It lives inside `V3Input` rather than beside it because the plan hash must
 * cover it. An override that could be applied without moving the plan hash would
 * be an unrecorded change of shipped appearance.
 */
export interface V3StyleOverride {
  styleClass: V3StyleClass;
  /** Rights-cleared evidence intake record id this override is cited from. */
  evidenceRecordId: string;
  /** The sourced fact, in the words a details panel may show verbatim. */
  fact: string;
}

export interface V3Input {
  schemaVersion: typeof DETERMINISTIC_FACADE_V3_SCHEMA_VERSION;
  buildingId: string;
  generatedAt: string;
  seed: string;
  tool: { id: string; version: string };
  /** Single ring, no holes. `holes` is not a key of this type on purpose. */
  geometry: { unit: "millimeter"; footprint: { outer: Point2Mm[] }; baseElevationMm: number; heightMm: number };
  sourceAnchors: V3SourceAnchor[];
  parameters: V3Parameters;
  /** Present only on a plan whose style class was displaced by a cited fact. */
  styleOverride?: V3StyleOverride;
}

export interface V3Material { id: string; role: "facade" | "glazing" | "trim" | "roof" | "ground" | "metal"; baseColorSrgb: [number, number, number, number]; metallicPermille: number; roughnessPermille: number }

export interface V3Tier {
  index: number;
  baseZMm: number;
  topZMm: number;
  firstFloorIndex: number;
  floorCount: number;
  /** CCW, integer millimetres, same vertex count as the source ring. */
  ring: Point2Mm[];
  areaMm2: number;
  perimeterMm: number;
}

export interface V3FacadeSurface {
  id: string;
  kind: "facade";
  /** Shaft-zone wall material; the band below `baseVMaxMm` uses `baseMaterialId`. */
  materialId: string;
  baseMaterialId: string;
  /** Height within this band at which the base zone ends. Zero above tier 0. */
  baseVMaxMm: number;
  tierIndex: number;
  edgeIndex: number;
  startVertexIndex: number;
  endVertexIndex: number;
  startMm: Point2Mm;
  endMm: Point2Mm;
  uLengthMm: number;
  vLengthMm: number;
  baseZMm: number;
  /** Placement window after corner clearance; `uStartMm > 0` or `uEndMm < uLengthMm` means a corner charged clearance. */
  uStartMm: number;
  uEndMm: number;
  bayCount: number;
}

export interface V3CapSurface {
  id: string;
  kind: "roof" | "ground";
  materialId: string;
  tierIndex: number;
  zMm: number;
  ring: Point2Mm[];
  /** Ear-clipped indices into `ring`, deterministic and ties broken by vertex index. */
  triangles: Array<[number, number, number]>;
  /** True when the cap faces down (the ground slab), which reverses the winding. */
  downward: boolean;
}

export interface V3DeckSurface {
  id: string;
  kind: "setback-deck";
  materialId: string;
  tierIndex: number;
  zMm: number;
  outerRing: Point2Mm[];
  innerRing: Point2Mm[];
  /** Indices into `[...outerRing, ...innerRing]`; a ring-to-ring annulus, not a four-deck box. */
  triangles: Array<[number, number, number]>;
}

export type V3Surface = V3FacadeSurface | V3CapSurface | V3DeckSurface;

export interface V3Placement {
  id: string;
  kind: V3PlacementKind;
  surfaceId: string;
  materialId: string;
  tierIndex: number;
  floorIndex: number | null;
  bayIndex: number | null;
  bounds: { uMinMm: number; vMinMm: number; uMaxMm: number; vMaxMm: number };
  /** Negative recesses into the wall, positive protrudes from it. */
  depthMm: number;
}

export interface V3Prism { id: string; kind: V3PrismKind; materialId: string; ring: Point2Mm[]; baseZMm: number; topZMm: number; triangles: Array<[number, number, number]> }

export interface V3Massing {
  /** Indexes into the source ring whose interior angle exceeds 180 degrees. */
  reflexVertexIndexes: number[];
  /** Narrowest neck of the ring: the gate that keeps opposed recesses apart. */
  localThicknessMm: number;
  inscribedRadiusMm: number;
  requestedTierCount: number;
  effectiveTierCount: number;
  effectiveSetbackInsetMm: number;
  /** Verbatim disclosure of what happened to the requested setbacks. */
  setbackDisclosure: string;
  floorCount: number;
}

export interface V3Plan {
  schemaVersion: typeof DETERMINISTIC_FACADE_V3_SCHEMA_VERSION;
  planId: string;
  buildingId: string;
  coordinateSystem: "local-millimeters";
  generatedAt: string;
  tool: { id: string; version: string };
  input: V3Input;
  parameters: V3Parameters;
  inputFingerprintSha256: string;
  parametersHashSha256: string;
  anchors: V3SourceAnchor[];
  uncertainty: DeterministicFacadeV3Uncertainty;
  inventory: ExteriorComponentInventory;
  /** The designed appearance family this plan drew; see `V3_STYLE_CLASSES`. */
  styleClass: V3StyleClass;
  massing: V3Massing;
  tiers: V3Tier[];
  materials: V3Material[];
  surfaces: V3Surface[];
  placements: V3Placement[];
  prisms: V3Prism[];
  planHashSha256: string;
}

export interface V3Issue { path: string; message: string }
export type V3Validation<T> = { ok: true; value: T } | { ok: false; issues: V3Issue[] };

// ---------------------------------------------------------------------------
// Exact integer ring predicates
// ---------------------------------------------------------------------------

/** Twice the signed area; positive for counter-clockwise. Exact for bounded integer rings. */
export function ringSignedAreaMm2(ring: readonly Point2Mm[]): number {
  let twice = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index]!;
    const next = ring[(index + 1) % ring.length]!;
    twice += current[0] * next[1] - next[0] * current[1];
  }
  return twice / 2;
}

function orientation(a: Point2Mm, b: Point2Mm, c: Point2Mm): number {
  const value = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

function onSegment(a: Point2Mm, b: Point2Mm, point: Point2Mm): boolean {
  return orientation(a, b, point) === 0
    && point[0] >= Math.min(a[0], b[0]) && point[0] <= Math.max(a[0], b[0])
    && point[1] >= Math.min(a[1], b[1]) && point[1] <= Math.max(a[1], b[1]);
}

function segmentsIntersect(a1: Point2Mm, a2: Point2Mm, b1: Point2Mm, b2: Point2Mm): boolean {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && onSegment(a1, a2, b1))
    || (o2 === 0 && onSegment(a1, a2, b2))
    || (o3 === 0 && onSegment(b1, b2, a1))
    || (o4 === 0 && onSegment(b1, b2, a2));
}

/**
 * O(n^2) simplicity test. Non-adjacent edges may not touch at all; adjacent
 * edges may only share their common vertex, so a spike that folds an edge back
 * over its neighbour is non-simple even though it never crosses anything.
 */
export function ringIsSimple(ring: readonly Point2Mm[]): boolean {
  const count = ring.length;
  if (count < 3) return false;
  for (let index = 0; index < count; index += 1) {
    const current = ring[index]!;
    const next = ring[(index + 1) % count]!;
    if (current[0] === next[0] && current[1] === next[1]) return false;
  }
  for (let left = 0; left < count; left += 1) {
    const a1 = ring[left]!;
    const a2 = ring[(left + 1) % count]!;
    for (let right = left + 1; right < count; right += 1) {
      const b1 = ring[right]!;
      const b2 = ring[(right + 1) % count]!;
      const adjacent = right === left + 1 || (left === 0 && right === count - 1);
      if (adjacent) {
        // Shared vertex only; a fold-back makes the two edges overlap.
        const shared = right === left + 1 ? a2 : a1;
        const far = right === left + 1 ? b2 : b1;
        const other = right === left + 1 ? a1 : a2;
        if (orientation(other, shared, far) === 0 && (far[0] - shared[0]) * (shared[0] - other[0]) + (far[1] - shared[1]) * (shared[1] - other[1]) < 0) return false;
        continue;
      }
      if (segmentsIntersect(a1, a2, b1, b2)) return false;
    }
  }
  return true;
}

function pointInRing(ring: readonly Point2Mm[], x: number, y: number): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const current = ring[index]!;
    const last = ring[previous]!;
    if ((current[1] > y) !== (last[1] > y)) {
      const crossing = current[0] + ((y - current[1]) * (last[0] - current[0])) / (last[1] - current[1]);
      if (x < crossing) inside = !inside;
    }
  }
  return inside;
}

function distancePointToSegment(point: Point2Mm, a: Point2Mm, b: Point2Mm): { distance: number; interior: boolean; footX: number; footY: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return { distance: Math.hypot(point[0] - a[0], point[1] - a[1]), interior: false, footX: a[0], footY: a[1] };
  const t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared;
  const clamped = Math.min(1, Math.max(0, t));
  const footX = a[0] + clamped * dx;
  const footY = a[1] + clamped * dy;
  return { distance: Math.hypot(point[0] - footX, point[1] - footY), interior: t > 0 && t < 1, footX, footY };
}

/**
 * Narrowest neck of the ring: the shortest distance from a vertex to a
 * non-neighbouring edge whose perpendicular foot is interior to that edge AND
 * whose connecting segment runs through the inside of the polygon. The last
 * condition is what makes it a neck rather than an accident of two edges that
 * happen to pass near each other on opposite sides of the boundary.
 */
export function ringLocalThicknessMm(ring: readonly Point2Mm[]): number {
  const count = ring.length;
  let narrowest = Number.POSITIVE_INFINITY;
  /**
   * A true neck of width w puts its midpoint w/2 away from BOTH walls. A pair
   * of near-collinear digitising vertices on one wall — three of the fourteen
   * footprints carry runs of them, one only 51 mm apart — also has an interior
   * midpoint, but that midpoint skims the boundary. Requiring real clearance at
   * the midpoint separates a neck from a wobble in the traced boundary.
   */
  const isNeck = (fromX: number, fromY: number, toX: number, toY: number, distance: number): boolean => {
    const midX = (fromX + toX) / 2;
    const midY = (fromY + toY) / 2;
    if (!pointInRing(ring, midX, midY)) return false;
    return distanceToRingMm(ring, [midX, midY]) >= distance * 0.4;
  };
  for (let vertex = 0; vertex < count; vertex += 1) {
    const point = ring[vertex]!;
    for (let edge = 0; edge < count; edge += 1) {
      const next = (edge + 1) % count;
      // Skip the two edges that meet at this vertex and their immediate neighbours:
      // a short edge next door is a corner detail, not a neck.
      const gapForward = (edge - vertex + count) % count;
      const gapBackward = (vertex - next + count) % count;
      if (gapForward <= 1 || gapBackward <= 1) continue;
      const measured = distancePointToSegment(point, ring[edge]!, ring[next]!);
      if (!measured.interior || measured.distance >= narrowest) continue;
      if (!isNeck(point[0], point[1], measured.footX, measured.footY, measured.distance)) continue;
      narrowest = measured.distance;
    }
    // Vertex-to-vertex necks as well. The waist of a dumbbell lot is bounded by
    // two facing CORNERS, so its perpendicular foot lands on an endpoint and the
    // segment test above skips it — the one shape the gate exists to catch.
    for (let other = 0; other < count; other += 1) {
      const gapForward = (other - vertex + count) % count;
      if (gapForward <= 1 || gapForward >= count - 1) continue;
      const target = ring[other]!;
      const distance = Math.hypot(target[0] - point[0], target[1] - point[1]);
      if (distance >= narrowest) continue;
      if (!isNeck(point[0], point[1], target[0], target[1], distance)) continue;
      narrowest = distance;
    }
  }
  return narrowest;
}

/**
 * How far past straight a vertex must turn before it counts as reflex.
 *
 * Measured on the fourteen real footprints: DOITT rings are dense with vertices
 * within a hundredth of a degree of straight — one nineteen-vertex ring carries
 * eleven of them — which are digitising artefacts of a traced boundary, not
 * corners of the building. Counting them as reflex would report a ring as far
 * more concave than it is. It changes no geometry: corner clearance charges a
 * flat depth from 90 degrees up, so a 180.01-degree vertex and a 180.00-degree
 * vertex are treated identically either way.
 */
export const V3_REFLEX_ANGLE_TOLERANCE_DEGREES = 0.1 as const;

/** Interior angle at each vertex, in degrees, for a counter-clockwise ring. */
export function ringInteriorAnglesDegrees(ring: readonly Point2Mm[]): number[] {
  const count = ring.length;
  return ring.map((point, index) => {
    const previous = ring[(index - 1 + count) % count]!;
    const next = ring[(index + 1) % count]!;
    const toPrevious = Math.atan2(previous[1] - point[1], previous[0] - point[0]);
    const toNext = Math.atan2(next[1] - point[1], next[0] - point[0]);
    let angle = (toPrevious - toNext) * 180 / Math.PI;
    while (angle <= 0) angle += 360;
    while (angle > 360) angle -= 360;
    return angle;
  });
}

/**
 * Corner clearance for a placement of `depthMm` at a corner of `angleDegrees`.
 *
 * Below 90 degrees the two faces close on each other, and two opposed recesses
 * of depth d overlap within `d / tan(theta/2)` of the corner. From 90 degrees up
 * — including every reflex corner — a flat `d` is the binding rule.
 */
export function cornerClearanceMm(angleDegrees: number, depthMm: number): number {
  if (!(angleDegrees > 0)) return depthMm;
  if (angleDegrees >= 90) return depthMm;
  return Math.ceil(depthMm / Math.tan((angleDegrees / 2) * Math.PI / 180));
}

export type EarClipResult = { ok: true; triangles: Array<[number, number, number]> } | { ok: false; reason: string };

/**
 * Deterministic ear clipping on integer millimetres.
 *
 * Among all valid ears the LOWEST ORIGINAL VERTEX INDEX always wins, so the
 * output depends on the ring alone and not on list rotation or iteration
 * incidentals. Two runs over the same ring produce the same index buffer, byte
 * for byte, which is what the shipped GLB determinism rests on.
 */
export function earClipRing(ring: readonly Point2Mm[]): EarClipResult {
  const count = ring.length;
  if (count < 3) return { ok: false, reason: "ring-too-small" };
  if (ringSignedAreaMm2(ring) <= 0) return { ok: false, reason: "orientation" };
  const remaining = ring.map((_, index) => index);
  const triangles: Array<[number, number, number]> = [];
  let guard = count * count + 16;
  while (remaining.length > 3) {
    if (guard-- <= 0) return { ok: false, reason: "no-ear" };
    let chosen = -1;
    for (let position = 0; position < remaining.length; position += 1) {
      const previous = ring[remaining[(position - 1 + remaining.length) % remaining.length]!]!;
      const current = ring[remaining[position]!]!;
      const next = ring[remaining[(position + 1) % remaining.length]!]!;
      if (orientation(previous, current, next) <= 0) continue;
      let clear = true;
      for (let other = 0; other < remaining.length && clear; other += 1) {
        if (other === position || other === (position - 1 + remaining.length) % remaining.length || other === (position + 1) % remaining.length) continue;
        const candidate = ring[remaining[other]!]!;
        if (orientation(previous, current, candidate) > 0 && orientation(current, next, candidate) > 0 && orientation(next, previous, candidate) > 0) clear = false;
      }
      if (!clear) continue;
      if (chosen === -1 || remaining[position]! < remaining[chosen]!) chosen = position;
    }
    if (chosen === -1) return { ok: false, reason: "no-ear" };
    const previousIndex = remaining[(chosen - 1 + remaining.length) % remaining.length]!;
    const currentIndex = remaining[chosen]!;
    const nextIndex = remaining[(chosen + 1) % remaining.length]!;
    triangles.push([previousIndex, currentIndex, nextIndex]);
    remaining.splice(chosen, 1);
  }
  triangles.push([remaining[0]!, remaining[1]!, remaining[2]!]);
  return { ok: true, triangles };
}

export type OffsetRefusalReason = "orientation-flip" | "area-floor" | "self-intersection" | "not-contained";
export type OffsetResult = { ok: true; ring: Point2Mm[] } | { ok: false; reason: OffsetRefusalReason };

/**
 * Mitered inward offset of a counter-clockwise ring.
 *
 * REJECT, DON'T REPAIR. Every failure mode a concave ring can reach — the ring
 * turning itself inside out, shrinking below the area floor, or folding across
 * itself at a reflex vertex — returns a refusal. Nothing here nudges a vertex to
 * make the result valid, because a repaired tier is a silent claim that the
 * building steps back somewhere it does not.
 */
export function offsetRingInward(ring: readonly Point2Mm[], offsetMm: number): OffsetResult {
  const count = ring.length;
  if (offsetMm === 0) return { ok: true, ring: ring.map((point) => [point[0], point[1]] as Point2Mm) };
  const directions: Array<{ dx: number; dy: number }> = [];
  for (let index = 0; index < count; index += 1) {
    const current = ring[index]!;
    const next = ring[(index + 1) % count]!;
    const length = Math.hypot(next[0] - current[0], next[1] - current[1]);
    if (length === 0) return { ok: false, reason: "self-intersection" };
    directions.push({ dx: (next[0] - current[0]) / length, dy: (next[1] - current[1]) / length });
  }
  const offset: Point2Mm[] = [];
  for (let index = 0; index < count; index += 1) {
    const point = ring[index]!;
    const incoming = directions[(index - 1 + count) % count]!;
    const outgoing = directions[index]!;
    // Interior of a counter-clockwise ring lies to the left of each edge.
    const incomingNormal = { x: -incoming.dy, y: incoming.dx };
    const outgoingNormal = { x: -outgoing.dy, y: outgoing.dx };
    // Bisector form, not line-line intersection. DOITT rings are full of
    // near-collinear vertices (one of these fourteen carries eleven of them
    // within 0.02 degrees of straight); there the two offset lines are almost
    // parallel and almost coincident, and solving for their crossing is a 0/0
    // that throws the vertex kilometres away. The bisector stays well
    // conditioned exactly there, and degrades into a long miter — which the
    // simplicity check then refuses — exactly at the sharp corners where a long
    // miter is the honest answer.
    let bisectorX = incomingNormal.x + outgoingNormal.x;
    let bisectorY = incomingNormal.y + outgoingNormal.y;
    const bisectorLength = Math.hypot(bisectorX, bisectorY);
    // A spike that doubles back on itself has no inward bisector at all.
    if (bisectorLength < 1e-9) return { ok: false, reason: "self-intersection" };
    bisectorX /= bisectorLength;
    bisectorY /= bisectorLength;
    const projection = bisectorX * incomingNormal.x + bisectorY * incomingNormal.y;
    if (Math.abs(projection) < 1e-9) return { ok: false, reason: "self-intersection" };
    const miter = offsetMm / projection;
    offset.push([Math.round(point[0] + bisectorX * miter), Math.round(point[1] + bisectorY * miter)]);
  }
  for (let index = 0; index < count; index += 1) {
    const current = offset[index]!;
    const next = offset[(index + 1) % count]!;
    if (current[0] === next[0] && current[1] === next[1]) return { ok: false, reason: "self-intersection" };
  }
  const area = ringSignedAreaMm2(offset);
  if (area <= 0) return { ok: false, reason: "orientation-flip" };
  if (area < DETERMINISTIC_FACADE_V3_LIMITS.minRingAreaMm2) return { ok: false, reason: "area-floor" };
  if (!ringIsSimple(offset)) return { ok: false, reason: "self-intersection" };
  // Positive area and simplicity are not enough. Offset a polygon far past its
  // own inscribed circle and the miters turn it inside out into a NEW simple,
  // positively oriented ring that sits outside the building. A tier that leaves
  // the tier below it is not a setback, so containment is checked explicitly.
  if (!offset.every((point) => pointInRing(ring, point[0], point[1]))) return { ok: false, reason: "not-contained" };
  return { ok: true, ring: offset };
}

/**
 * A point guaranteed to lie strictly inside a concave ring: the centroid of the
 * largest triangle of its own triangulation. A polygon centroid would not do —
 * for an L-shaped lot it can land outside the building.
 */
export function ringInteriorAnchor(ring: readonly Point2Mm[]): Point2Mm | null {
  const clipped = earClipRing(ring);
  if (!clipped.ok) return null;
  let best: [number, number, number] | null = null;
  let bestArea = -1;
  for (const triangle of clipped.triangles) {
    const a = ring[triangle[0]]!;
    const b = ring[triangle[1]]!;
    const c = ring[triangle[2]]!;
    const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    if (area > bestArea) { bestArea = area; best = triangle; }
  }
  if (!best) return null;
  const a = ring[best[0]]!;
  const b = ring[best[1]]!;
  const c = ring[best[2]]!;
  return [Math.round((a[0] + b[0] + c[0]) / 3), Math.round((a[1] + b[1] + c[1]) / 3)];
}

function distanceToRingMm(ring: readonly Point2Mm[], point: Point2Mm): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < ring.length; index += 1) {
    const measured = distancePointToSegment(point, ring[index]!, ring[(index + 1) % ring.length]!);
    if (measured.distance < nearest) nearest = measured.distance;
  }
  return nearest;
}

// ---------------------------------------------------------------------------
// Input contract
// ---------------------------------------------------------------------------

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function addIssue(issues: V3Issue[], path: string, message: string): void { issues.push({ path, message }); }
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function safeInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
function safeId(value: unknown, maximum: number = DETERMINISTIC_FACADE_V3_LIMITS.maxInputIdLength): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && /^[A-Za-z0-9][A-Za-z0-9:._-]*$/u.test(value);
}
function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const milliseconds = Date.parse(value);
  return !Number.isNaN(milliseconds) && new Date(milliseconds).toISOString() === value;
}
function checksum(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }

const PARAMETER_KEYS = [
  "targetFloorHeightMm", "tierCount", "setbackInsetMm", "bayPitchMm", "maxBaysPerEdge", "minPierMm",
  "windowWidthMm", "windowHeightMm", "windowSillMm", "recessDepthMm", "minWallThicknessMm",
  "entranceWidthMm", "entranceHeightMm", "storefrontHeightMm", "corniceHeightMm", "corniceDepthMm",
  "balconyDepthMm", "balconyHeightMm", "balconyFloorInterval",
  "fireEscapeWidthMm", "fireEscapeDepthMm", "fireEscapePlatformHeightMm",
  "signBandHeightMm", "signBandDepthMm", "bladeSignWidthMm", "bladeSignHeightMm", "bladeSignDepthMm",
  "roofEquipmentSizeMm", "roofEquipmentHeightMm",
  "waterTankSides", "waterTankRadiusMm", "waterTankHeightMm", "waterTankLegHeightMm", "waterTankLegSizeMm",
] as const;

const COUNT_PARAMETER_KEYS: ReadonlySet<string> = new Set(["tierCount", "maxBaysPerEdge", "balconyFloorInterval", "waterTankSides"]);

// ---------------------------------------------------------------------------
// Grammar extensions (T003)
//
// Two admission rules of this grammar refuse buildings for reasons that are
// properties of the GRAMMAR rather than of the source. Both are implemented
// here, both are measured, and NEITHER is active by default.
//
// WHY THEY ARE NOT DEFAULTS. Raising an admission rule is not hash-neutral at
// the release layer, even though it is hash-neutral at the plan layer. The V3
// wave releases are re-derived from this grammar and pinned byte for byte
// against committed payload inventories: `midtown-core-v3-release.test.ts`
// rebuilds the whole midtown-core V3 release from these constants and asserts
// its emitted artifact set and every checksum. A wider envelope admits
// buildings that release refused, so it emits artifacts the frozen inventory
// does not name. Five committed V3 wave releases carry shipped-subset buildings
// in exactly that position. Turning either extension on by default therefore
// breaks "local releases remain checksum-pinned, immutable once approved" and
// broadens an approved release's contents, which needs an explicit approval and
// a successor release rather than a constant edit.
//
// So the extensions travel through `V3GrammarOptions`, whose defaults are the
// shipped grammar exactly. Activating either one is a one-token change to the
// default, reviewable on its own.
// ---------------------------------------------------------------------------

/**
 * Ring-vertex cap for the EXTENDED admission envelope (T003 extension A).
 *
 * Bounded by measured input rather than chosen. The committed citywide histogram
 * (`data/citywide-overview-census-20260814/distributions.json`) records exactly
 * 324 of 45,194 accepted parents above the active 64-vertex cap, with a maximum
 * of 362 distinct ring vertices; 384 is that observed maximum plus headroom, and
 * it is still a bounded cap.
 *
 * Nothing in the ring pipeline assumes 64. Every stage is generically
 * O(outer.length), and the superlinear predicates were TIMED at the observed
 * maximum rather than assumed cheap: on the 362-vertex ring of `doitt:17224`,
 * `ringIsSimple` (O(n^2)) takes 1.1 ms, `ringLocalThicknessMm` (O(n^3) through
 * its interior-midpoint test) 50 ms and `earClipRing` (O(n^3) worst case) 40 ms.
 *
 * No PLAN content depends on this number — it is read only by the admission gate
 * in `validateV3Input` and by the text of the refusal that gate writes — so it
 * moves no plan hash. The massing statement in
 * `DETERMINISTIC_FACADE_V3_UNCERTAINTY` stays literally true for a ring admitted
 * under it: the same sourced ring is carried vertex for vertex at the same
 * sourced height, and this cap ships no designed massing of its own.
 */
export const V3_EXTENDED_MAX_RING_VERTICES = 384 as const;

/**
 * The nominal floor height this grammar designs to. A designed choice, not a
 * sourced fact, and the number `V3_LOW_RISE_HEIGHT_THRESHOLD_MM` is equal to
 * because they are the same statement read two ways: below one nominal floor,
 * the nominal floor cannot describe the building.
 */
export const V3_NOMINAL_FLOOR_HEIGHT_MM = 3_600 as const;

/**
 * Sourced height below which this grammar derives its floor height from the
 * building instead of from its own nominal floor (T003 extension B).
 *
 * A building 2.4 m tall is not a failure of the source. It is a garage, a
 * pumphouse, a rooftop bulkhead traced as its own parent — 384 of the 45,194
 * accepted parents, none of them a tombstone (the full-city dry run records
 * `invalid-height: 0`, so every one of the 384 carries a real sourced height;
 * the 76 `heightUnknown` parents take the 10 m fallback and are not among them).
 * With the extension off the grammar asks for a 3.6 m floor, finds the sourced
 * height below it, and refuses the building under
 * `source-height-below-grammar-minimum`. That refusal says nothing about the
 * building and everything about the grammar's own request.
 *
 * DISJOINTNESS. `validateV3Input` refuses any input with
 * `heightMm < parameters.targetFloorHeightMm`, so EVERY input this grammar has
 * ever accepted satisfies `heightMm >= 3_600` — the only floor height
 * `deriveV3Parameters` has ever produced. A branch taken only below 3,600 mm
 * therefore cannot reach a single accepted plan, and every plan hash this
 * repository has committed is untouched. `deriveV3Parameters` is pinned
 * byte-identical above the threshold by its own unit test, and the property was
 * re-proved at city scale by a differential plan-hash set digest over every
 * accepted parent in both grammar states.
 */
export const V3_LOW_RISE_HEIGHT_THRESHOLD_MM = 3_600 as const;

/**
 * Floor height for a low-rise: the sourced height itself, so the building is one
 * floor tall.
 *
 * `planTiers` computes `floorCount` as `round(heightMm / targetFloorHeightMm)`
 * clamped to at least 1, so this derivation makes `floorCount` exactly 1 and the
 * existing clamps produce the single-band massing with no further change:
 * `requestedTierCount = min(tierCount, floorCount)` collapses to one tier, and
 * `validateV3Plan` already admits `setbacks: absent` at a single tier.
 *
 * It substitutes NO massing. The ring is still carried vertex for vertex and the
 * extrusion is still the sourced height — `floorBoundaryZMm` divides that height
 * into `floorCount` bands and one band spans it exactly — so
 * `DETERMINISTIC_FACADE_V3_UNCERTAINTY` stays literally true for these buildings
 * and no third uncertainty statement is needed.
 */
export function v3LowRiseTargetFloorHeightMm(heightMm: number): number {
  return heightMm;
}

/**
 * The grammar-extension state for one call.
 *
 * Every field is optional and every default is exactly the shipped grammar, so a
 * caller that passes nothing travels the identical path it travelled before this
 * type existed. It exists for two reasons and no others:
 *
 *   - the extensions must be measurable against the shipped grammar in ONE
 *     process, and a differential that compared them by mutating module state
 *     would prove nothing about the module anybody ships;
 *   - a future wave that is approved to carry the extended envelope selects it
 *     here, per wave, instead of by editing a constant every frozen release is
 *     re-derived from.
 */
export interface V3GrammarOptions {
  /** Ring-vertex admission cap. Defaults to the active `maxRingVertices` (64). */
  maxRingVertices?: number;
  /** Enables the low-rise floor-height derivation below the threshold. Defaults to OFF. */
  lowRiseFloorHeight?: boolean;
  /**
   * Drops the water-tank legs whenever the tank itself is dropped (T004 rule 1).
   *
   * The crown-containment filter is per prism, so a tank whose ring crosses the
   * parapet is dropped while its four legs — which sit well inside the tank's
   * own footprint — are kept, and the asset ships four metal posts holding
   * nothing. Defaults to OFF, so the shipped grammar is byte-identical.
   */
  rooftopGroupContainment?: boolean;
  /**
   * Bounds the rooftop cluster to one nominal storey above the crown (T004
   * rule 2). Defaults to OFF, so the shipped grammar is byte-identical.
   */
  rooftopClusterHeightClamp?: boolean;
}

/**
 * The T003 ADMISSION envelope, as one value. Not a default anywhere.
 *
 * It names the two admission rules T003 measured and NOTHING ELSE. The T004
 * rooftop rules are deliberately absent: this constant is the second half of the
 * committed differential plan-hash set digest, which asserts that every plan the
 * SHIPPED envelope accepts is byte-identical under it, and a rule that changes
 * rooftop geometry on an already-accepted building would break that assertion
 * rather than be measured by it. The two families are selected together where a
 * caller wants both (`V3_ROOFTOP_HONESTY_OPTIONS`), never merged here.
 */
export const V3_EXTENDED_GRAMMAR_OPTIONS: Required<Pick<V3GrammarOptions, "maxRingVertices" | "lowRiseFloorHeight">> = {
  maxRingVertices: V3_EXTENDED_MAX_RING_VERTICES,
  lowRiseFloorHeight: true,
};

/** The two T004 rooftop rules, as one value. Not a default anywhere. */
export const V3_ROOFTOP_HONESTY_OPTIONS: Required<Pick<V3GrammarOptions, "rooftopGroupContainment" | "rooftopClusterHeightClamp">> = {
  rooftopGroupContainment: true,
  rooftopClusterHeightClamp: true,
};

/**
 * The shipped grammar, written out.
 *
 * Every field is the value a caller that passes nothing travels under, so
 * `v3EffectiveGrammarOptions(undefined)` is deep-equal to it. It exists so a
 * consumer can ask whether an envelope DIFFERS from the shipped one by value
 * rather than by reference or by remembering four defaults.
 */
export const V3_SHIPPED_GRAMMAR_OPTIONS: Required<V3GrammarOptions> = {
  maxRingVertices: DETERMINISTIC_FACADE_V3_LIMITS.maxRingVertices,
  lowRiseFloorHeight: false,
  rooftopGroupContainment: false,
  rooftopClusterHeightClamp: false,
};

/** Fills every unset field with the shipped default, in one place. */
export function v3EffectiveGrammarOptions(options: V3GrammarOptions | undefined): Required<V3GrammarOptions> {
  return {
    maxRingVertices: options?.maxRingVertices ?? V3_SHIPPED_GRAMMAR_OPTIONS.maxRingVertices,
    lowRiseFloorHeight: options?.lowRiseFloorHeight ?? V3_SHIPPED_GRAMMAR_OPTIONS.lowRiseFloorHeight,
    rooftopGroupContainment: options?.rooftopGroupContainment ?? V3_SHIPPED_GRAMMAR_OPTIONS.rooftopGroupContainment,
    rooftopClusterHeightClamp: options?.rooftopClusterHeightClamp ?? V3_SHIPPED_GRAMMAR_OPTIONS.rooftopClusterHeightClamp,
  };
}

/** True when `options` selects anything the shipped grammar does not. */
export function v3GrammarOptionsDifferFromShipped(options: V3GrammarOptions | undefined): boolean {
  const effective = v3EffectiveGrammarOptions(options);
  return effective.maxRingVertices !== V3_SHIPPED_GRAMMAR_OPTIONS.maxRingVertices
    || effective.lowRiseFloorHeight !== V3_SHIPPED_GRAMMAR_OPTIONS.lowRiseFloorHeight
    || effective.rooftopGroupContainment !== V3_SHIPPED_GRAMMAR_OPTIONS.rooftopGroupContainment
    || effective.rooftopClusterHeightClamp !== V3_SHIPPED_GRAMMAR_OPTIONS.rooftopClusterHeightClamp;
}

/**
 * The one canonical parameter policy for V3.
 *
 * It lives with the grammar rather than in the package builder so the triangle
 * budget proved by the pin tests and the triangle count of the shipped asset are
 * derived from the same numbers. Everything here is a designed choice, not a
 * sourced fact.
 */
export function deriveV3Parameters(
  geometry: { footprintOuterMm: readonly Point2Mm[]; heightMm: number },
  options: Pick<V3GrammarOptions, "lowRiseFloorHeight"> = {},
): V3Parameters {
  const area = Math.abs(ringSignedAreaMm2(geometry.footprintOuterMm));
  const tall = geometry.heightMm >= 60_000;
  const large = area >= 1_500_000_000;
  // The ONE extension-B conditional. The safe-integer and positivity guards are
  // part of it rather than a second branch: a non-integer or non-positive height
  // is refused by the input contract under `geometry.heightMm`, and deriving an
  // invalid parameter from it would re-label that refusal as a parameter fault.
  const lowRise = options.lowRiseFloorHeight === true
    && Number.isSafeInteger(geometry.heightMm)
    && geometry.heightMm >= 1
    && geometry.heightMm < V3_LOW_RISE_HEIGHT_THRESHOLD_MM;
  return {
    targetFloorHeightMm: lowRise ? v3LowRiseTargetFloorHeightMm(geometry.heightMm) : V3_NOMINAL_FLOOR_HEIGHT_MM,
    tierCount: tall ? 4 : 2,
    setbackInsetMm: 1_800,
    bayPitchMm: 4_000,
    maxBaysPerEdge: 24,
    minPierMm: 600,
    windowWidthMm: 1_800,
    windowHeightMm: 1_800,
    windowSillMm: 900,
    recessDepthMm: 200,
    minWallThicknessMm: 200,
    entranceWidthMm: 2_400,
    entranceHeightMm: 2_800,
    storefrontHeightMm: 3_000,
    corniceHeightMm: 400,
    corniceDepthMm: 250,
    balconyDepthMm: 1_200,
    balconyHeightMm: 1_100,
    balconyFloorInterval: tall ? 12 : 4,
    fireEscapeWidthMm: 2_400,
    fireEscapeDepthMm: 1_000,
    fireEscapePlatformHeightMm: 900,
    signBandHeightMm: 700,
    signBandDepthMm: 150,
    bladeSignWidthMm: 900,
    bladeSignHeightMm: 2_400,
    bladeSignDepthMm: 600,
    roofEquipmentSizeMm: large ? 6_000 : 3_000,
    roofEquipmentHeightMm: 1_200,
    waterTankSides: 12,
    waterTankRadiusMm: 1_800,
    waterTankHeightMm: 3_000,
    waterTankLegHeightMm: 2_400,
    waterTankLegSizeMm: 300,
  };
}

/** Collapses only exactly duplicated consecutive millimetre vertices; nothing else is simplified. */
function collapseExactDuplicates(points: readonly Point2Mm[]): Point2Mm[] {
  const collapsed: Point2Mm[] = [];
  for (const point of points) {
    const last = collapsed[collapsed.length - 1];
    if (last && last[0] === point[0] && last[1] === point[1]) continue;
    collapsed.push([point[0], point[1]]);
  }
  while (collapsed.length > 1) {
    const first = collapsed[0]!;
    const last = collapsed[collapsed.length - 1]!;
    if (first[0] === last[0] && first[1] === last[1]) collapsed.pop(); else break;
  }
  return collapsed;
}

export function validateV3Input(value: unknown, options: Pick<V3GrammarOptions, "maxRingVertices"> = {}): V3Validation<V3Input> {
  const maxRingVertices = options.maxRingVertices ?? DETERMINISTIC_FACADE_V3_LIMITS.maxRingVertices;
  const issues: V3Issue[] = [];
  if (!record(value)) return { ok: false, issues: [{ path: "$", message: "V3 facade input must be an object." }] };
  if (value.schemaVersion !== DETERMINISTIC_FACADE_V3_SCHEMA_VERSION) addIssue(issues, "schemaVersion", "Unsupported V3 facade input schema.");
  if (!safeId(value.buildingId)) addIssue(issues, "buildingId", "Building ID must use bounded safe identifier characters.");
  if (!safeId(value.seed)) addIssue(issues, "seed", "Seed must use bounded safe identifier characters.");
  if (!canonicalTimestamp(value.generatedAt)) addIssue(issues, "generatedAt", "Generated time must be canonical UTC with millisecond precision.");
  if (!record(value.tool) || !safeId(value.tool.id) || !safeId(value.tool.version)) addIssue(issues, "tool", "Tool ID and version must be bounded safe identifiers.");

  let outer: Point2Mm[] | null = null;
  let baseElevationMm = 0;
  let heightMm = 0;
  if (!record(value.geometry)) addIssue(issues, "geometry", "Local-mm geometry is required.");
  else {
    const geometry = value.geometry;
    if (geometry.unit !== "millimeter") addIssue(issues, "geometry.unit", "Geometry unit must be millimetre.");
    if (!record(geometry.footprint) || !Array.isArray(geometry.footprint.outer)) {
      addIssue(issues, "geometry.footprint", "V3 footprint must carry one outer ring.");
    } else if ("holes" in geometry.footprint) {
      // Not "ignored if empty": a hole is not representable in this grammar, and
      // silently dropping one would ship a solid building over a courtyard.
      addIssue(issues, "geometry.footprint.holes", "V3 footprints are single-ring; a hole key is forbidden because holes are not representable in this grammar.");
    } else {
      const points = geometry.footprint.outer as unknown[];
      const parsed: Point2Mm[] = [];
      let malformed = false;
      points.forEach((point, index) => {
        if (!Array.isArray(point) || point.length !== 2
          || !safeInteger(point[0], -DETERMINISTIC_FACADE_V3_LIMITS.maxRingMillimeters, DETERMINISTIC_FACADE_V3_LIMITS.maxRingMillimeters)
          || !safeInteger(point[1], -DETERMINISTIC_FACADE_V3_LIMITS.maxRingMillimeters, DETERMINISTIC_FACADE_V3_LIMITS.maxRingMillimeters)) {
          addIssue(issues, `geometry.footprint.outer[${index}]`, "Local-mm point must contain two bounded safe integers.");
          malformed = true;
        } else parsed.push([point[0], point[1]]);
      });
      if (!malformed) {
        const collapsed = collapseExactDuplicates(parsed);
        if (collapsed.length < DETERMINISTIC_FACADE_V3_LIMITS.minRingVertices || collapsed.length > maxRingVertices) {
          addIssue(issues, "geometry.footprint.outer", `V3 ring must carry ${DETERMINISTIC_FACADE_V3_LIMITS.minRingVertices} to ${maxRingVertices} distinct vertices.`);
        } else {
          const oriented = ringSignedAreaMm2(collapsed) < 0 ? [...collapsed].reverse() : collapsed;
          if (!ringIsSimple(oriented)) addIssue(issues, "geometry.footprint.outer", "V3 ring must be simple: it self-intersects or folds back on itself.");
          else if (Math.abs(ringSignedAreaMm2(oriented)) < DETERMINISTIC_FACADE_V3_LIMITS.minRingAreaMm2) addIssue(issues, "geometry.footprint.outer", "V3 ring area is below the footprint area floor.");
          else outer = oriented;
        }
      }
    }
    if (!safeInteger(geometry.baseElevationMm, -DETERMINISTIC_FACADE_V3_LIMITS.maxLocalMillimeters, DETERMINISTIC_FACADE_V3_LIMITS.maxLocalMillimeters)) addIssue(issues, "geometry.baseElevationMm", "Base elevation must be a bounded safe integer.");
    else baseElevationMm = geometry.baseElevationMm;
    if (!safeInteger(geometry.heightMm, 1, DETERMINISTIC_FACADE_V3_LIMITS.maxLocalMillimeters)) addIssue(issues, "geometry.heightMm", "Height must be a positive bounded safe integer.");
    else heightMm = geometry.heightMm;
  }

  let parameters: V3Parameters | null = null;
  if (!record(value.parameters)) addIssue(issues, "parameters", "V3 generator parameters are required.");
  else {
    const raw = value.parameters;
    for (const key of Object.keys(raw)) if (!(PARAMETER_KEYS as readonly string[]).includes(key)) addIssue(issues, `parameters.${key}`, "Unexpected parameter.");
    for (const key of PARAMETER_KEYS) if (!(key in raw)) addIssue(issues, `parameters.${key}`, "Required parameter is missing.");
    if (!safeInteger(raw.tierCount, 1, DETERMINISTIC_FACADE_V3_LIMITS.maxTiers)) addIssue(issues, "parameters.tierCount", "Tier count is outside the V3 cap.");
    if (!safeInteger(raw.maxBaysPerEdge, 0, DETERMINISTIC_FACADE_V3_LIMITS.maxBaysPerEdge)) addIssue(issues, "parameters.maxBaysPerEdge", "Bay cap is outside the V3 range; zero bays are legal.");
    if (!safeInteger(raw.balconyFloorInterval, 1, DETERMINISTIC_FACADE_V3_LIMITS.maxFloors)) addIssue(issues, "parameters.balconyFloorInterval", "Balcony interval must be a positive bounded integer.");
    if (!safeInteger(raw.waterTankSides, 6, DETERMINISTIC_FACADE_V3_LIMITS.maxPrismSides)) addIssue(issues, "parameters.waterTankSides", "Water tank side count is outside the V3 range.");
    for (const key of PARAMETER_KEYS) {
      if (COUNT_PARAMETER_KEYS.has(key)) continue;
      if (!safeInteger(raw[key], 1, DETERMINISTIC_FACADE_V3_LIMITS.maxLocalMillimeters)) addIssue(issues, `parameters.${key}`, "Parameter must be a positive bounded safe integer in millimetres.");
    }
    if (!issues.some((issue) => issue.path.startsWith("parameters"))) parameters = Object.freeze({ ...raw } as unknown as V3Parameters);
  }

  const anchors: V3SourceAnchor[] = [];
  if (!Array.isArray(value.sourceAnchors) || value.sourceAnchors.length === 0) addIssue(issues, "sourceAnchors", "Canonical source anchors are required.");
  else value.sourceAnchors.forEach((anchor, index) => {
    if (!record(anchor) || !safeId(anchor.id) || !safeId(anchor.sourceRefId) || !checksum(anchor.fingerprintSha256) || (anchor.kind !== "footprint" && anchor.kind !== "height" && anchor.kind !== "constraint")) addIssue(issues, `sourceAnchors[${index}]`, "Source anchor identity, kind or fingerprint is invalid.");
    else anchors.push({ id: anchor.id, kind: anchor.kind, sourceRefId: anchor.sourceRefId, fingerprintSha256: anchor.fingerprintSha256 });
  });
  anchors.sort((left, right) => compareText(left.id, right.id));
  if (!anchors.some((anchor) => anchor.kind === "footprint") || !anchors.some((anchor) => anchor.kind === "height")) addIssue(issues, "sourceAnchors", "V3 requires canonical footprint and height anchors.");

  if (outer && parameters) {
    // Local thickness gate: two opposed recesses plus a wall must fit inside the
    // narrowest neck, or the openings punch through the massing.
    const thickness = ringLocalThicknessMm(outer);
    const required = parameters.recessDepthMm * 2 + parameters.minWallThicknessMm;
    if (thickness < required) addIssue(issues, "geometry.footprint.outer", `V3 ring has a neck ${Math.round(thickness)} mm across, thinner than the ${required} mm two opposed recesses and a wall need; the openings would punch through the massing.`);
    if (parameters.windowWidthMm + parameters.minPierMm * 2 > parameters.bayPitchMm) addIssue(issues, "parameters.windowWidthMm", "Window plus its piers exceeds the bay pitch.");
    if (parameters.entranceWidthMm + parameters.minPierMm * 2 > parameters.bayPitchMm) addIssue(issues, "parameters.entranceWidthMm", "Entrance plus its piers exceeds the bay pitch.");
    if (heightMm < parameters.targetFloorHeightMm) addIssue(issues, "geometry.heightMm", "Sourced height is below one floor of the requested floor height.");
  }

  // The override is optional, and "absent" must stay byte-indistinguishable from
  // "never had one": the key is omitted rather than set to null or undefined, so
  // every plan generated before this field existed keeps its exact plan hash.
  let styleOverride: V3StyleOverride | null = null;
  if (value.styleOverride !== undefined) {
    const raw = value.styleOverride;
    if (!record(raw)) addIssue(issues, "styleOverride", "Style override must be an object.");
    else {
      for (const key of Object.keys(raw)) if (!["styleClass", "evidenceRecordId", "fact"].includes(key)) addIssue(issues, `styleOverride.${key}`, "Unexpected style override field.");
      if (!(V3_STYLE_CLASSES as readonly unknown[]).includes(raw.styleClass)) addIssue(issues, "styleOverride.styleClass", "Style override must name a declared V3 style class.");
      // A cited override with no citation is the exact failure this field exists
      // to prevent, so the record id is required rather than merely encouraged.
      if (!safeId(raw.evidenceRecordId)) addIssue(issues, "styleOverride.evidenceRecordId", "Style override must cite a rights-cleared evidence intake record id.");
      if (typeof raw.fact !== "string" || raw.fact.trim().length === 0 || raw.fact.length > DETERMINISTIC_FACADE_V3_LIMITS.maxStyleOverrideFactLength) {
        addIssue(issues, "styleOverride.fact", "Style override must state its sourced fact as bounded non-empty text.");
      }
      if (!issues.some((issue) => issue.path.startsWith("styleOverride"))) {
        styleOverride = { styleClass: raw.styleClass as V3StyleClass, evidenceRecordId: raw.evidenceRecordId as string, fact: raw.fact as string };
      }
    }
  }

  if (issues.length > 0 || !outer || !parameters) return { ok: false, issues };
  return {
    ok: true,
    value: {
      schemaVersion: DETERMINISTIC_FACADE_V3_SCHEMA_VERSION,
      buildingId: value.buildingId as string,
      generatedAt: value.generatedAt as string,
      seed: value.seed as string,
      tool: { id: (value.tool as { id: string; version: string }).id, version: (value.tool as { id: string; version: string }).version },
      geometry: { unit: "millimeter", footprint: { outer }, baseElevationMm, heightMm },
      sourceAnchors: anchors,
      parameters,
      ...(styleOverride ? { styleOverride } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

/**
 * Four designed style classes. The names describe a LOOK this grammar invents;
 * none of them is a claim about what any real building is faced with. Selection
 * is deterministic from the input fingerprint and seed, and the only thing that
 * modulates the distribution is sourced height and sourced footprint area —
 * never an address, a neighbourhood, a photograph or an observation.
 */
export const V3_STYLE_CLASSES = ["masonry-warm", "masonry-light", "stone-neutral", "curtain-cool"] as const;
export type V3StyleClass = (typeof V3_STYLE_CLASSES)[number];

/**
 * Manhattan-plausible tone palette. "Plausible" is the whole claim: these are
 * designed sRGB tones chosen to sit believably in a Manhattan street wall. They
 * are not sampled from imagery and not measured from any building.
 */
export const V3_PALETTE = {
  brickWarm: [150, 92, 74, 255],
  brickWarmLight: [172, 116, 96, 255],
  brickLight: [196, 172, 146, 255],
  brickLightPale: [214, 196, 174, 255],
  limestone: [186, 180, 168, 255],
  limestonePale: [204, 199, 188, 255],
  glassCool: [120, 142, 158, 255],
  glassCoolPale: [148, 168, 182, 255],
  glazingWarm: [104, 118, 122, 255],
  glazingCool: [98, 122, 140, 255],
  trimStone: [162, 156, 144, 255],
  trimBronze: [122, 104, 78, 255],
  roofTar: [78, 80, 82, 255],
  sidewalk: [138, 136, 132, 255],
  metalGrey: [116, 120, 126, 255],
} as const satisfies Record<string, readonly [number, number, number, number]>;

interface StyleRecipe {
  baseFacade: readonly [number, number, number, number];
  shaftFacade: readonly [number, number, number, number];
  glazing: readonly [number, number, number, number];
  trim: readonly [number, number, number, number];
  facadeRoughnessPermille: number;
  glazingMetallicPermille: number;
  glazingRoughnessPermille: number;
}

const V3_STYLE_RECIPES: Record<V3StyleClass, StyleRecipe> = {
  "masonry-warm": { baseFacade: V3_PALETTE.brickWarm, shaftFacade: V3_PALETTE.brickWarmLight, glazing: V3_PALETTE.glazingWarm, trim: V3_PALETTE.trimBronze, facadeRoughnessPermille: 800, glazingMetallicPermille: 60, glazingRoughnessPermille: 220 },
  "masonry-light": { baseFacade: V3_PALETTE.brickLight, shaftFacade: V3_PALETTE.brickLightPale, glazing: V3_PALETTE.glazingWarm, trim: V3_PALETTE.trimStone, facadeRoughnessPermille: 780, glazingMetallicPermille: 60, glazingRoughnessPermille: 220 },
  "stone-neutral": { baseFacade: V3_PALETTE.limestone, shaftFacade: V3_PALETTE.limestonePale, glazing: V3_PALETTE.glazingCool, trim: V3_PALETTE.trimStone, facadeRoughnessPermille: 720, glazingMetallicPermille: 80, glazingRoughnessPermille: 200 },
  "curtain-cool": { baseFacade: V3_PALETTE.limestone, shaftFacade: V3_PALETTE.glassCool, glazing: V3_PALETTE.glassCoolPale, trim: V3_PALETTE.metalGrey, facadeRoughnessPermille: 420, glazingMetallicPermille: 140, glazingRoughnessPermille: 120 },
};

/**
 * Selection weights, modulated by sourced height and sourced footprint area and
 * by nothing else. A tall tower leans curtain-cool, a small low lot leans
 * masonry-warm; every class stays reachable for every building, so the choice
 * remains a designed draw and never reads as an inference about the address.
 */
export function v3StyleWeights(sourced: { heightMm: number; footprintAreaMm2: number }): Record<V3StyleClass, number> {
  const tall = sourced.heightMm >= 60_000;
  const midRise = !tall && sourced.heightMm >= 30_000;
  const large = sourced.footprintAreaMm2 >= 1_500_000_000;
  return {
    "masonry-warm": tall ? 1 : large ? 3 : 5,
    "masonry-light": tall ? 2 : midRise ? 4 : 4,
    "stone-neutral": tall ? 4 : midRise ? 3 : 2,
    "curtain-cool": tall ? 6 : midRise ? 2 : 1,
  };
}

export function selectV3StyleClass(styleHash: string, sourced: { heightMm: number; footprintAreaMm2: number }): V3StyleClass {
  const weights = v3StyleWeights(sourced);
  const total = V3_STYLE_CLASSES.reduce((sum, style) => sum + weights[style], 0);
  let draw = Number.parseInt(styleHash.slice(0, 8), 16) % total;
  for (const style of V3_STYLE_CLASSES) {
    draw -= weights[style];
    if (draw < 0) return style;
  }
  return V3_STYLE_CLASSES[V3_STYLE_CLASSES.length - 1]!;
}

/**
 * Base/shaft zoning only this cycle. A crown zone and horizontal banding are
 * deliberately deferred: they would push the material count and the surface
 * subdivision up in the same cycle that raises the triangle budget, and each of
 * those is worth measuring on its own.
 */
export type V3MaterialZone = "base" | "shaft";

export function v3StyleMaterials(style: V3StyleClass): V3Material[] {
  const recipe = V3_STYLE_RECIPES[style];
  const rgba = (color: readonly [number, number, number, number]): [number, number, number, number] => [color[0], color[1], color[2], color[3]];
  return [
    { id: "material:facade:base", role: "facade", baseColorSrgb: rgba(recipe.baseFacade), metallicPermille: 0, roughnessPermille: recipe.facadeRoughnessPermille },
    { id: "material:facade:shaft", role: "facade", baseColorSrgb: rgba(recipe.shaftFacade), metallicPermille: 0, roughnessPermille: recipe.facadeRoughnessPermille },
    { id: "material:glazing:base", role: "glazing", baseColorSrgb: rgba(recipe.glazing), metallicPermille: recipe.glazingMetallicPermille, roughnessPermille: recipe.glazingRoughnessPermille },
    { id: "material:glazing:shaft", role: "glazing", baseColorSrgb: rgba(recipe.glazing), metallicPermille: recipe.glazingMetallicPermille, roughnessPermille: Math.max(80, recipe.glazingRoughnessPermille - 40) },
    { id: "material:trim:base", role: "trim", baseColorSrgb: rgba(recipe.trim), metallicPermille: 0, roughnessPermille: 620 },
    { id: "material:trim:shaft", role: "trim", baseColorSrgb: rgba(recipe.trim), metallicPermille: 0, roughnessPermille: 680 },
    { id: "material:roof", role: "roof", baseColorSrgb: rgba(V3_PALETTE.roofTar), metallicPermille: 60, roughnessPermille: 860 },
    { id: "material:ground", role: "ground", baseColorSrgb: rgba(V3_PALETTE.sidewalk), metallicPermille: 0, roughnessPermille: 900 },
    { id: "material:metal", role: "metal", baseColorSrgb: rgba(V3_PALETTE.metalGrey), metallicPermille: 700, roughnessPermille: 380 },
  ];
}

/** The base zone is the street-facing lower floors; everything above is shaft. */
export function v3BaseFloorCount(floorCount: number): number {
  return Math.min(2, floorCount);
}

function zoneOf(floorIndex: number, floorCount: number): V3MaterialZone {
  return floorIndex < v3BaseFloorCount(floorCount) ? "base" : "shaft";
}

// ---------------------------------------------------------------------------
// Massing
// ---------------------------------------------------------------------------

function floorBoundaryZMm(input: V3Input, floorCount: number, floorIndex: number): number {
  return input.geometry.baseElevationMm + Math.round((floorIndex * input.geometry.heightMm) / floorCount);
}

interface TierPlan { tiers: V3Tier[]; massing: V3Massing }

function planTiers(input: V3Input, outer: Point2Mm[]): TierPlan {
  const parameters = input.parameters;
  const floorCount = Math.min(DETERMINISTIC_FACADE_V3_LIMITS.maxFloors, Math.max(1, Math.round(input.geometry.heightMm / parameters.targetFloorHeightMm)));
  const angles = ringInteriorAnglesDegrees(outer);
  const reflexVertexIndexes = angles.map((angle, index) => ({ angle, index })).filter((entry) => entry.angle > 180 + V3_REFLEX_ANGLE_TOLERANCE_DEGREES).map((entry) => entry.index);
  const thickness = ringLocalThicknessMm(outer);
  const area = ringSignedAreaMm2(outer);
  let perimeter = 0;
  for (let index = 0; index < outer.length; index += 1) {
    const current = outer[index]!;
    const next = outer[(index + 1) % outer.length]!;
    perimeter += Math.hypot(next[0] - current[0], next[1] - current[1]);
  }
  // An inward offset cannot exceed the inscribed radius; both bounds matter,
  // because a long thin lot has a wide "neck" and a tiny inradius.
  const inscribedRadiusMm = Math.floor(Math.min(Number.isFinite(thickness) ? thickness / 2 : Number.POSITIVE_INFINITY, (2 * area) / Math.max(1, perimeter)));

  const requestedTierCount = Math.min(parameters.tierCount, floorCount);
  const singleTier = (disclosure: string, effectiveInset: number): TierPlan => ({
    tiers: [{
      index: 0, baseZMm: floorBoundaryZMm(input, floorCount, 0), topZMm: floorBoundaryZMm(input, floorCount, floorCount),
      firstFloorIndex: 0, floorCount, ring: outer.map((point) => [point[0], point[1]] as Point2Mm),
      areaMm2: area, perimeterMm: Math.round(perimeter),
    }],
    massing: {
      reflexVertexIndexes, localThicknessMm: Number.isFinite(thickness) ? Math.round(thickness) : -1, inscribedRadiusMm,
      requestedTierCount: parameters.tierCount, effectiveTierCount: 1, effectiveSetbackInsetMm: effectiveInset,
      setbackDisclosure: disclosure, floorCount,
    },
  });

  if (requestedTierCount <= 1) return singleTier("Single-tier massing: no setbacks were requested for this building.", 0);
  // Clamp the per-tier inset so the cumulative inset at the crown stays inside
  // the inscribed circle, then refuse outright if that leaves nothing usable.
  const maxTotalInsetMm = Math.floor((inscribedRadiusMm * 800) / 1_000);
  const effectiveSetbackInsetMm = Math.min(parameters.setbackInsetMm, Math.floor(maxTotalInsetMm / (requestedTierCount - 1)));
  if (effectiveSetbackInsetMm < 100) {
    return singleTier(`tier-offset-collapse (inscribed-radius): this lot cannot carry a setback (inscribed radius ${inscribedRadiusMm} mm), so the massing is a single tier with no setbacks. This is a refusal, not a repaired ring.`, 0);
  }

  const rings: Point2Mm[][] = [outer.map((point) => [point[0], point[1]] as Point2Mm)];
  for (let index = 1; index < requestedTierCount; index += 1) {
    const offsetResult = offsetRingInward(outer, effectiveSetbackInsetMm * index);
    if (!offsetResult.ok) {
      return singleTier(`tier-offset-collapse (${offsetResult.reason}) at tier ${index}: the inward offset was refused rather than repaired, so the massing is a single tier with no setbacks.`, 0);
    }
    if (offsetResult.ring.length !== outer.length) {
      return singleTier(`tier-offset-collapse (vertex-count-change) at tier ${index}: the inward offset was refused rather than repaired, so the massing is a single tier with no setbacks.`, 0);
    }
    rings.push(offsetResult.ring);
  }

  const perTier = Math.floor(floorCount / requestedTierCount);
  const remainder = floorCount - perTier * requestedTierCount;
  const tiers: V3Tier[] = [];
  let firstFloorIndex = 0;
  for (let index = 0; index < requestedTierCount; index += 1) {
    // Lower tiers absorb the remainder so the crown stays the shallowest step.
    const tierFloorCount = perTier + (index < remainder ? 1 : 0);
    const ring = rings[index]!;
    let tierPerimeter = 0;
    for (let vertex = 0; vertex < ring.length; vertex += 1) {
      const current = ring[vertex]!;
      const next = ring[(vertex + 1) % ring.length]!;
      tierPerimeter += Math.hypot(next[0] - current[0], next[1] - current[1]);
    }
    tiers.push({
      index,
      baseZMm: floorBoundaryZMm(input, floorCount, firstFloorIndex),
      topZMm: floorBoundaryZMm(input, floorCount, firstFloorIndex + tierFloorCount),
      firstFloorIndex, floorCount: tierFloorCount, ring,
      areaMm2: ringSignedAreaMm2(ring), perimeterMm: Math.round(tierPerimeter),
    });
    firstFloorIndex += tierFloorCount;
  }
  return {
    tiers,
    massing: {
      reflexVertexIndexes, localThicknessMm: Number.isFinite(thickness) ? Math.round(thickness) : -1, inscribedRadiusMm,
      requestedTierCount: parameters.tierCount, effectiveTierCount: requestedTierCount, effectiveSetbackInsetMm,
      setbackDisclosure: `Tiered massing: ${requestedTierCount} tiers stepped inward by ${effectiveSetbackInsetMm} mm each. The step is designed, not sourced.`,
      floorCount,
    },
  };
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/** The deepest thing the grammar attaches to a wall; corner clearance is charged against it. */
function maxPlacementDepthMm(parameters: V3Parameters): number {
  return Math.max(parameters.recessDepthMm, parameters.corniceDepthMm, parameters.balconyDepthMm, parameters.fireEscapeDepthMm, parameters.signBandDepthMm, parameters.bladeSignDepthMm);
}

function buildFacadeSurfaces(input: V3Input, tiers: V3Tier[], floorCount: number): V3FacadeSurface[] {
  const parameters = input.parameters;
  const depth = maxPlacementDepthMm(parameters);
  const baseFloorCount = v3BaseFloorCount(floorCount);
  const surfaces: V3FacadeSurface[] = [];
  for (const tier of tiers) {
    // The base zone only exists where the lower floors actually are.
    const baseVMaxMm = tier.firstFloorIndex >= baseFloorCount ? 0 : floorBoundaryZMm(input, floorCount, Math.min(baseFloorCount, tier.firstFloorIndex + tier.floorCount)) - tier.baseZMm;
    const ring = tier.ring;
    const angles = ringInteriorAnglesDegrees(ring);
    for (let edgeIndex = 0; edgeIndex < ring.length; edgeIndex += 1) {
      const startVertexIndex = edgeIndex;
      const endVertexIndex = (edgeIndex + 1) % ring.length;
      const start = ring[startVertexIndex]!;
      const end = ring[endVertexIndex]!;
      const uLengthMm = Math.round(Math.hypot(end[0] - start[0], end[1] - start[1]));
      const startClearance = Math.min(uLengthMm, cornerClearanceMm(angles[startVertexIndex]!, depth));
      const endClearance = Math.min(uLengthMm, cornerClearanceMm(angles[endVertexIndex]!, depth));
      const uStartMm = startClearance;
      const uEndMm = Math.max(startClearance, uLengthMm - endClearance);
      const usable = uEndMm - uStartMm;
      // Zero bays is legal and is what keeps a 0.05 m edge safe: it becomes a
      // blank wall rather than a sliver of impossible openings.
      const bayCount = Math.max(0, Math.min(parameters.maxBaysPerEdge, Math.floor(usable / parameters.bayPitchMm)));
      surfaces.push({
        id: `surface:tier:${tier.index}:facade:${edgeIndex}`,
        kind: "facade", materialId: "material:facade:shaft", baseMaterialId: "material:facade:base", baseVMaxMm,
        tierIndex: tier.index, edgeIndex, startVertexIndex, endVertexIndex,
        startMm: [start[0], start[1]], endMm: [end[0], end[1]],
        uLengthMm, vLengthMm: tier.topZMm - tier.baseZMm, baseZMm: tier.baseZMm,
        uStartMm, uEndMm, bayCount,
      });
    }
  }
  return surfaces;
}

function buildCapAndDeckSurfaces(input: V3Input, tiers: V3Tier[]): V3Validation<Array<V3CapSurface | V3DeckSurface>> {
  const issues: V3Issue[] = [];
  const surfaces: Array<V3CapSurface | V3DeckSurface> = [];
  const ground = tiers[0]!;
  const groundClip = earClipRing(ground.ring);
  if (!groundClip.ok) addIssue(issues, "tiers[0].ring", `Ground cap could not be triangulated: ${groundClip.reason}.`);
  else surfaces.push({ id: "surface:ground", kind: "ground", materialId: "material:ground", tierIndex: 0, zMm: ground.baseZMm, ring: ground.ring, triangles: groundClip.triangles, downward: true });

  for (let index = 1; index < tiers.length; index += 1) {
    const lower = tiers[index - 1]!;
    const upper = tiers[index]!;
    // Ring-to-ring annulus. The V2 four-deck box construction assumes an
    // axis-aligned rectangle and does not generalise to a polygon.
    const count = lower.ring.length;
    const triangles: Array<[number, number, number]> = [];
    for (let vertex = 0; vertex < count; vertex += 1) {
      const nextVertex = (vertex + 1) % count;
      triangles.push([vertex, nextVertex, count + nextVertex]);
      triangles.push([vertex, count + nextVertex, count + vertex]);
    }
    surfaces.push({
      id: `surface:tier:${upper.index}:setback-deck`, kind: "setback-deck", materialId: "material:roof",
      tierIndex: upper.index, zMm: lower.topZMm, outerRing: lower.ring, innerRing: upper.ring, triangles,
    });
  }

  const crown = tiers[tiers.length - 1]!;
  const roofClip = earClipRing(crown.ring);
  if (!roofClip.ok) addIssue(issues, "tiers[last].ring", `Roof cap could not be triangulated: ${roofClip.reason}.`);
  else surfaces.push({ id: "surface:roof", kind: "roof", materialId: "material:roof", tierIndex: crown.index, zMm: crown.topZMm, ring: crown.ring, triangles: roofClip.triangles, downward: false });

  void input;
  return issues.length === 0 ? { ok: true, value: surfaces } : { ok: false, issues };
}

// ---------------------------------------------------------------------------
// Placements
// ---------------------------------------------------------------------------

interface RowGeometry { floorIndex: number; vMinMm: number; vMaxMm: number }

function tierRows(input: V3Input, tier: V3Tier, floorCount: number): RowGeometry[] {
  const rows: RowGeometry[] = [];
  for (let local = 0; local < tier.floorCount; local += 1) {
    const floorIndex = tier.firstFloorIndex + local;
    rows.push({
      floorIndex,
      vMinMm: floorBoundaryZMm(input, floorCount, floorIndex) - tier.baseZMm,
      vMaxMm: floorBoundaryZMm(input, floorCount, floorIndex + 1) - tier.baseZMm,
    });
  }
  return rows;
}

/** Bay cell boundaries inside the clearance-corrected usable span, exact in integers. */
export function bayCellBounds(surface: V3FacadeSurface, bayIndex: number): { startMm: number; endMm: number } {
  const span = surface.uEndMm - surface.uStartMm;
  return {
    startMm: surface.uStartMm + Math.round((bayIndex * span) / surface.bayCount),
    endMm: surface.uStartMm + Math.round(((bayIndex + 1) * span) / surface.bayCount),
  };
}

function longestSurfaceOfTier(surfaces: readonly V3FacadeSurface[], tierIndex: number): V3FacadeSurface | null {
  let best: V3FacadeSurface | null = null;
  for (const surface of surfaces) {
    if (surface.tierIndex !== tierIndex || surface.bayCount === 0) continue;
    // Ties break on the lower edge index so the choice is a function of the ring.
    if (!best || surface.uLengthMm > best.uLengthMm) best = surface;
  }
  return best;
}

function buildPlacements(input: V3Input, tiers: V3Tier[], facades: V3FacadeSurface[], floorCount: number): V3Placement[] {
  const parameters = input.parameters;
  const placements: V3Placement[] = [];

  for (const tier of tiers) {
    const rows = tierRows(input, tier, floorCount);
    const tierSurfaces = facades.filter((surface) => surface.tierIndex === tier.index);
    for (const surface of tierSurfaces) {
      // A cornice caps every band that HAS a usable span. An edge whose corner
      // clearance consumes its whole length carries no trim, because a
      // zero-width cornice is not a thinner cornice, it is nothing.
      if (surface.uEndMm <= surface.uStartMm || surface.vLengthMm <= parameters.corniceHeightMm) continue;
      placements.push({
        id: `placement:cornice:${tier.index}:${surface.edgeIndex}`, kind: "cornice", surfaceId: surface.id,
        materialId: "material:trim:shaft", tierIndex: tier.index, floorIndex: null, bayIndex: null,
        bounds: { uMinMm: surface.uStartMm, vMinMm: Math.max(0, surface.vLengthMm - parameters.corniceHeightMm), uMaxMm: surface.uEndMm, vMaxMm: surface.vLengthMm },
        depthMm: parameters.corniceDepthMm,
      });
      if (surface.bayCount === 0) continue;
      for (const row of rows) {
        const rowHeight = row.vMaxMm - row.vMinMm;
        const ground = row.floorIndex === 0;
        const sill = ground ? 0 : Math.min(parameters.windowSillMm, Math.floor(rowHeight / 4));
        const openingHeight = ground
          ? Math.min(parameters.storefrontHeightMm, rowHeight - 300)
          : Math.min(parameters.windowHeightMm, rowHeight - sill - parameters.corniceHeightMm - 200);
        if (openingHeight <= 0) continue;
        for (let bayIndex = 0; bayIndex < surface.bayCount; bayIndex += 1) {
          const cell = bayCellBounds(surface, bayIndex);
          const cellWidth = cell.endMm - cell.startMm;
          const primaryEntrance = ground && bayIndex === 0 && surface.tierIndex === 0;
          const desiredWidth = primaryEntrance ? parameters.entranceWidthMm : ground ? cellWidth - parameters.minPierMm * 2 : parameters.windowWidthMm;
          const width = Math.min(desiredWidth, cellWidth - parameters.minPierMm * 2);
          if (width <= 0) continue;
          const center = cell.startMm + Math.round(cellWidth / 2);
          const uMinMm = center - Math.round(width / 2);
          // Every opening in a row shares one v-band. The row is tiled by piers
          // between openings, so an opening of a different height would force a
          // second overlapping tiling of the same wall and double-count its
          // volume — which is exactly what the analytic identity caught. The
          // entrance is distinguished by its width, material and kind instead.
          const height = openingHeight;
          placements.push({
            id: `placement:${primaryEntrance ? "entrance" : ground ? "storefront" : "window"}:${tier.index}:${surface.edgeIndex}:${row.floorIndex}:${bayIndex}`,
            kind: primaryEntrance ? "entrance" : ground ? "storefront" : "window",
            surfaceId: surface.id, materialId: primaryEntrance ? `material:trim:${zoneOf(row.floorIndex, floorCount)}` : `material:glazing:${zoneOf(row.floorIndex, floorCount)}`,
            tierIndex: tier.index, floorIndex: row.floorIndex, bayIndex,
            bounds: { uMinMm, vMinMm: row.vMinMm + sill, uMaxMm: uMinMm + width, vMaxMm: row.vMinMm + sill + height },
            depthMm: -parameters.recessDepthMm,
          });
        }
      }
    }

    // Balconies on the longest band of the tier, on every `balconyFloorInterval`
    // floor above the ground floor.
    const balconySurface = longestSurfaceOfTier(facades, tier.index);
    if (balconySurface) {
      for (const row of rows) {
        if (row.floorIndex === 0 || row.floorIndex % parameters.balconyFloorInterval !== 0) continue;
        for (let bayIndex = 0; bayIndex < balconySurface.bayCount; bayIndex += 1) {
          const cell = bayCellBounds(balconySurface, bayIndex);
          placements.push({
            id: `placement:balcony:${tier.index}:${balconySurface.edgeIndex}:${row.floorIndex}:${bayIndex}`, kind: "balcony",
            surfaceId: balconySurface.id, materialId: `material:trim:${zoneOf(row.floorIndex, floorCount)}`, tierIndex: tier.index, floorIndex: row.floorIndex, bayIndex,
            bounds: { uMinMm: cell.startMm, vMinMm: row.vMinMm, uMaxMm: cell.endMm, vMaxMm: row.vMinMm + Math.min(parameters.balconyHeightMm, row.vMaxMm - row.vMinMm) },
            depthMm: parameters.balconyDepthMm,
          });
        }
      }
    }

    // One fire-escape stack per tier, on the longest band that is not carrying
    // the balconies; a tier with a single usable band carries both.
    const fireEscapeSurface = tierSurfaces
      .filter((surface) => surface.uEndMm - surface.uStartMm >= parameters.fireEscapeWidthMm && surface.id !== balconySurface?.id)
      .sort((left, right) => right.uLengthMm - left.uLengthMm || left.edgeIndex - right.edgeIndex)[0] ?? balconySurface;
    if (fireEscapeSurface && fireEscapeSurface.uEndMm - fireEscapeSurface.uStartMm >= parameters.fireEscapeWidthMm) {
      const center = fireEscapeSurface.uStartMm + Math.round((fireEscapeSurface.uEndMm - fireEscapeSurface.uStartMm) / 2);
      const uMinMm = center - Math.round(parameters.fireEscapeWidthMm / 2);
      for (const row of rows) {
        if (row.floorIndex === 0) continue;
        placements.push({
          id: `placement:fire-escape:${tier.index}:${row.floorIndex}`, kind: "fire-escape", surfaceId: fireEscapeSurface.id,
          materialId: "material:metal", tierIndex: tier.index, floorIndex: row.floorIndex, bayIndex: null,
          bounds: { uMinMm, vMinMm: row.vMinMm, uMaxMm: uMinMm + parameters.fireEscapeWidthMm, vMaxMm: row.vMinMm + Math.min(parameters.fireEscapePlatformHeightMm, row.vMaxMm - row.vMinMm) },
          depthMm: parameters.fireEscapeDepthMm,
        });
      }
    }
  }

  // Signage: one blank band over the ground floor and one blade, both on tier 0.
  const primary = longestSurfaceOfTier(facades, 0);
  if (primary) {
    const groundRow = tierRows(input, tiers[0]!, floorCount)[0]!;
    const bandBase = Math.min(groundRow.vMaxMm - parameters.signBandHeightMm, groundRow.vMinMm + parameters.storefrontHeightMm);
    if (bandBase > groundRow.vMinMm) {
      placements.push({
        id: "placement:sign-band:primary", kind: "sign-band", surfaceId: primary.id, materialId: "material:trim:base",
        tierIndex: 0, floorIndex: 0, bayIndex: null,
        bounds: { uMinMm: primary.uStartMm, vMinMm: bandBase, uMaxMm: primary.uEndMm, vMaxMm: bandBase + parameters.signBandHeightMm },
        depthMm: parameters.signBandDepthMm,
      });
    }
    const bladeSurface = facades.filter((surface) => surface.tierIndex === 0 && surface.id !== primary.id && surface.uEndMm - surface.uStartMm >= parameters.bladeSignWidthMm)
      .sort((left, right) => right.uLengthMm - left.uLengthMm || left.edgeIndex - right.edgeIndex)[0] ?? primary;
    const bladeTop = Math.min(bladeSurface.vLengthMm - parameters.corniceHeightMm, groundRow.vMaxMm + parameters.bladeSignHeightMm);
    if (bladeTop - parameters.bladeSignHeightMm > 0 && bladeSurface.uEndMm - bladeSurface.uStartMm >= parameters.bladeSignWidthMm) {
      placements.push({
        id: "placement:blade-sign:primary", kind: "blade-sign", surfaceId: bladeSurface.id, materialId: "material:trim:base",
        tierIndex: 0, floorIndex: 1, bayIndex: null,
        bounds: { uMinMm: bladeSurface.uStartMm, vMinMm: bladeTop - parameters.bladeSignHeightMm, uMaxMm: bladeSurface.uStartMm + parameters.bladeSignWidthMm, vMaxMm: bladeTop },
        depthMm: parameters.bladeSignDepthMm,
      });
    }
  }
  return placements;
}

// ---------------------------------------------------------------------------
// Rooftop prisms
// ---------------------------------------------------------------------------

/**
 * The rooftop cluster's UNSCALED height above the crown.
 *
 * The tank stands on its legs, so the tank column is the leg height plus the
 * tank height; the equipment box is the other candidate. Read from the
 * parameters rather than written down, so a parameter change cannot leave this
 * bound behind.
 */
function rooftopClusterRawHeightMm(parameters: V3Parameters): number {
  return Math.max(parameters.roofEquipmentHeightMm, parameters.waterTankLegHeightMm + parameters.waterTankHeightMm);
}

function buildPrisms(input: V3Input, tiers: V3Tier[], options: V3GrammarOptions = {}): V3Prism[] {
  const parameters = input.parameters;
  const crown = tiers[tiers.length - 1]!;
  const anchor = ringInteriorAnchor(crown.ring);
  if (!anchor) return [];
  const clearance = distanceToRingMm(crown.ring, anchor);
  const desiredHalf = Math.max(parameters.roofEquipmentSizeMm / 2, parameters.waterTankRadiusMm) + parameters.waterTankRadiusMm;
  // One scale for the whole rooftop cluster, so it always sits inside the crown.
  const planScalePermille = Math.max(80, Math.min(1_000, Math.floor((clearance * 800) / Math.max(1, desiredHalf))));
  // T004 rule 2, expressed as a SECOND BOUND ON THE ONE EXISTING SCALE rather
  // than as a new vertical rule. The cluster already has exactly one scale, so
  // bounding that scale bounds the cluster's height, keeps its proportions, and
  // adds no geometry vocabulary.
  //
  // THE BOUND IS THE BUILDING'S OWN DESIGNED STOREY, not the grammar's nominal
  // one. `parameters.targetFloorHeightMm` IS `V3_NOMINAL_FLOOR_HEIGHT_MM` for
  // every building at or above 3.6 m — `validateV3Input` refuses anything below
  // its own floor height, so that is every building the shipped grammar has ever
  // accepted — which makes this a byte-identical no-op there. It differs only
  // for a T003-recovered low-rise, where the storey IS the sourced height, and
  // it is the honest bound for exactly those: a 305 mm building has no 3.6 m
  // storey to hide a water tank inside.
  //
  // THE FLOOR IS 80 PERMILLE, the same lower bound `planScalePermille` already
  // carries one line above. Below it the cluster stops being a cluster and
  // becomes a scattering of 1 mm prisms, and a rule that produced sub-millimetre
  // geometry to satisfy a height bound would be trading one false claim for
  // another. It costs the low-rise case its exactness and says so: on the 305 mm
  // parent the cluster lands 432 mm above the crown rather than 305 mm.
  const heightBoundPermille = Math.max(
    80,
    Math.floor((parameters.targetFloorHeightMm * 1_000) / Math.max(1, rooftopClusterRawHeightMm(parameters))),
  );
  const scalePermille = options.rooftopClusterHeightClamp === true
    ? Math.min(planScalePermille, heightBoundPermille)
    : planScalePermille;
  const scale = (value: number): number => Math.max(1, Math.round((value * scalePermille) / 1_000));

  const equipmentHalf = scale(Math.round(parameters.roofEquipmentSizeMm / 2));
  const tankRadius = scale(parameters.waterTankRadiusMm);
  const legSize = scale(parameters.waterTankLegSizeMm);
  const box = (centerX: number, centerY: number, half: number): Point2Mm[] => [
    [centerX - half, centerY - half], [centerX + half, centerY - half], [centerX + half, centerY + half], [centerX - half, centerY + half],
  ];
  const withTriangles = (id: string, kind: V3PrismKind, materialId: string, ring: Point2Mm[], baseZMm: number, topZMm: number): V3Prism | null => {
    const clipped = earClipRing(ring);
    return clipped.ok ? { id, kind, materialId, ring, baseZMm, topZMm, triangles: clipped.triangles } : null;
  };

  // Each candidate carries the CLUSTER MEMBER it belongs to. `null` is a prism
  // that stands on its own; a named group is a prism that only means anything
  // while the group's anchor survives containment.
  const prisms: Array<{ prism: V3Prism | null; dependsOn: string | null }> = [];
  const equipmentCenterX = anchor[0];
  const equipmentCenterY = anchor[1];
  prisms.push({ prism: withTriangles("prism:roof-equipment:0", "roof-equipment", "material:roof", box(equipmentCenterX, equipmentCenterY, equipmentHalf), crown.topZMm, crown.topZMm + scale(parameters.roofEquipmentHeightMm)), dependsOn: null });

  const tankOffset = equipmentHalf + tankRadius + scale(600);
  const tankX = anchor[0] + tankOffset;
  const tankY = anchor[1];
  const tankRing: Point2Mm[] = [];
  for (let index = 0; index < parameters.waterTankSides; index += 1) {
    const angle = (2 * Math.PI * index) / parameters.waterTankSides;
    tankRing.push([tankX + Math.round(tankRadius * Math.cos(angle)), tankY + Math.round(tankRadius * Math.sin(angle))]);
  }
  const legBase = crown.topZMm;
  const tankBase = legBase + scale(parameters.waterTankLegHeightMm);
  const tankId = "prism:water-tank:0";
  prisms.push({ prism: withTriangles(tankId, "water-tank", "material:metal", tankRing, tankBase, tankBase + scale(parameters.waterTankHeightMm)), dependsOn: null });
  const legOffset = Math.round((tankRadius * 7) / 10);
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([signX, signY], index) => {
    prisms.push({
      prism: withTriangles(`prism:water-tank-leg:${index}`, "water-tank-leg", "material:metal", box(tankX + signX! * legOffset, tankY + signY! * legOffset, Math.max(1, Math.round(legSize / 2))), legBase, tankBase),
      // A leg exists to hold THIS tank up. It is not a rooftop object in its
      // own right, so it cannot outlive the thing it carries.
      dependsOn: tankId,
    });
  });

  // Anything that could not be placed inside the crown is dropped rather than
  // clipped: a rooftop object hanging over the parapet is a false claim.
  const contained = prisms
    .filter((entry): entry is { prism: V3Prism; dependsOn: string | null } => entry.prism !== null && entry.prism.topZMm > entry.prism.baseZMm)
    .filter((entry) => entry.prism.ring.every((point) => pointInRing(crown.ring, point[0], point[1])));
  if (options.rooftopGroupContainment !== true) return contained.map((entry) => entry.prism);
  // T004 rule 1. The filter above is per prism, and the legs sit inside the
  // tank's own footprint, so a tank clipped by the parapet is dropped while its
  // legs survive — four metal posts holding nothing, which is the same "false
  // claim" the comment above already forbids, one level down.
  const survivingIds = new Set(contained.map((entry) => entry.prism.id));
  return contained
    .filter((entry) => entry.dependsOn === null || survivingIds.has(entry.dependsOn))
    .map((entry) => entry.prism);
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

const V3_COMPONENT_UNCERTAINTY: Partial<Record<(typeof REQUIRED_EXTERIOR_COMPONENT_KINDS)[number], string>> = {
  signage: DETERMINISTIC_FACADE_V3_SIGNAGE_UNCERTAINTY,
};

function buildInventory(input: V3Input, massing: V3Massing, inputFingerprintSha256: string, parametersHashSha256: string): ExteriorComponentInventory {
  const constraintSourceIds = [...new Set(input.sourceAnchors.map((anchor) => anchor.sourceRefId))].sort(compareText);
  return {
    schemaVersion: EXTERIOR_COMPONENT_SCHEMA_VERSION,
    buildingId: input.buildingId,
    components: REQUIRED_EXTERIOR_COMPONENT_KINDS.map((kind) => {
      const componentId = `${input.buildingId}:${kind}`;
      // The cited statement is attached to the ONE component the cited fact
      // bears on. A sourced facade-material fact says nothing about this
      // building's bay rhythm, roof form or water tanks, so those components
      // keep the standard statement rather than inheriting a citation they are
      // not covered by.
      const uncertainty = V3_COMPONENT_UNCERTAINTY[kind]
        ?? (kind === "materials" ? v3UncertaintyFor(input.styleOverride) : DETERMINISTIC_FACADE_V3_UNCERTAINTY);
      // When the tier offset was refused, this building HAS no setbacks. V2
      // could always claim them because a rectangle always offsets; a real ring
      // does not, and declaring a generated component that produced no geometry
      // would be exactly the "unknown becomes asserted truth" failure.
      if (kind === "setbacks" && massing.effectiveTierCount <= 1) {
        return { componentId, kind, state: "absent" as const, representation: "none" as const, uncertainty, reason: massing.setbackDisclosure };
      }
      return {
        componentId,
        kind,
        state: "generated" as const,
        uncertainty,
        generator: {
          id: DETERMINISTIC_FACADE_V3_GENERATOR_ID,
          version: DETERMINISTIC_FACADE_V3_GENERATOR_VERSION,
          inputFingerprintSha256,
          parametersHashSha256,
          generatedAt: input.generatedAt,
          constraintSourceIds,
        },
      };
    }),
  };
}

/**
 * Builds the canonical plan for one admitted input.
 *
 * `options` is the SAME grammar state the input was admitted under. It reaches
 * `buildPrisms` and nothing else, and `validateV3Plan` re-derives the whole plan
 * through this function — so a rule that reached generation but not validation
 * would make every successor plan refuse itself.
 */
function buildPlan(input: V3Input, options: V3GrammarOptions = {}): V3Validation<V3Plan> {
  const inputFingerprintSha256 = domainSeparatedSha256("udt.facade.input.v3", input);
  const parametersHashSha256 = domainSeparatedSha256("udt.facade.parameters.v3", input.parameters);
  const styleHash = domainSeparatedSha256("udt.facade.style.v3", { inputFingerprintSha256, seed: input.seed });
  const outer = input.geometry.footprint.outer;
  // `selectV3StyleClass` is untouched and still runs for every building without
  // a cited override. The override does not bias the draw, does not reseed it
  // and is not a fifth class: it replaces the drawn class outright for exactly
  // the buildings a rights-cleared record names.
  const styleClass = input.styleOverride?.styleClass ?? selectV3StyleClass(styleHash, { heightMm: input.geometry.heightMm, footprintAreaMm2: Math.abs(ringSignedAreaMm2(outer)) });
  const { tiers, massing } = planTiers(input, outer);
  const facades = buildFacadeSurfaces(input, tiers, massing.floorCount);
  const caps = buildCapAndDeckSurfaces(input, tiers);
  if (!caps.ok) return caps;
  const surfaces: V3Surface[] = [...facades, ...caps.value];
  if (surfaces.length > DETERMINISTIC_FACADE_V3_LIMITS.maxSurfaces) return { ok: false, issues: [{ path: "surfaces", message: "V3 plan exceeds its bounded surface cap." }] };
  const placements = buildPlacements(input, tiers, facades, massing.floorCount);
  if (placements.length > DETERMINISTIC_FACADE_V3_LIMITS.maxPlacements) return { ok: false, issues: [{ path: "placements", message: "V3 plan exceeds its bounded placement cap." }] };
  const prisms = buildPrisms(input, tiers, options);
  const withoutHash: Omit<V3Plan, "planHashSha256"> = {
    schemaVersion: DETERMINISTIC_FACADE_V3_SCHEMA_VERSION,
    planId: `facade-plan-v3:${inputFingerprintSha256.slice(0, 24)}`,
    buildingId: input.buildingId,
    coordinateSystem: "local-millimeters",
    generatedAt: input.generatedAt,
    tool: { ...input.tool },
    input,
    parameters: input.parameters,
    inputFingerprintSha256,
    parametersHashSha256,
    anchors: input.sourceAnchors.map((anchor) => ({ ...anchor })),
    uncertainty: v3UncertaintyFor(input.styleOverride),
    inventory: buildInventory(input, massing, inputFingerprintSha256, parametersHashSha256),
    styleClass,
    massing,
    tiers,
    materials: v3StyleMaterials(styleClass),
    surfaces,
    placements,
    prisms,
  };
  return { ok: true, value: { ...withoutHash, planHashSha256: domainSeparatedSha256("udt.facade.plan.v3", withoutHash) } };
}

export function calculateV3PlanHash(plan: Omit<V3Plan, "planHashSha256"> | V3Plan): string {
  const payload: Partial<V3Plan> = { ...plan };
  delete payload.planHashSha256;
  return domainSeparatedSha256("udt.facade.plan.v3", payload);
}

export function generateV3FacadePlan(value: unknown, options: V3GrammarOptions = {}): V3Validation<V3Plan> {
  const input = validateV3Input(value, options);
  return input.ok ? buildPlan(input.value, options) : input;
}

/**
 * Re-derives the plan from its embedded input and rejects any non-canonical content.
 *
 * `options` must name the SAME grammar state the plan was generated under. The
 * validator re-runs the input contract AND re-derives the plan, so a plan
 * legitimately generated at a wider cap or under a rooftop rule is otherwise
 * refused here — under `plan-validation-failed`, which would be the wrong word
 * for it — rather than round-tripping.
 */
export function validateV3Plan(value: unknown, options: V3GrammarOptions = {}): V3Validation<V3Plan> {
  const issues: V3Issue[] = [];
  if (!record(value)) return { ok: false, issues: [{ path: "$", message: "V3 facade plan must be an object." }] };
  if (value.schemaVersion !== DETERMINISTIC_FACADE_V3_SCHEMA_VERSION || value.coordinateSystem !== "local-millimeters") addIssue(issues, "schemaVersion", "Unsupported V3 plan schema or coordinate system.");
  if (!safeId(value.planId, DETERMINISTIC_FACADE_V3_LIMITS.maxPlanIdLength) || !safeId(value.buildingId)) addIssue(issues, "planId", "Plan or building identity is invalid.");
  if (!checksum(value.planHashSha256)) addIssue(issues, "planHashSha256", "Plan hash must be lowercase SHA-256.");
  // Exactly two statements are accepted, and which one is required is decided by
  // the plan's own embedded input rather than by the plan's claim about itself.
  // A cited override wearing the "no observation" statement, or an uncited plan
  // wearing the cited statement, are both refused.
  if (!(DETERMINISTIC_FACADE_V3_UNCERTAINTY_STATEMENTS as readonly unknown[]).includes(value.uncertainty)) {
    addIssue(issues, "uncertainty", "V3 plan uncertainty statement is fixed to one of the two declared statements.");
  } else if (record(value.input) && value.uncertainty !== v3UncertaintyFor((value.input as { styleOverride?: V3StyleOverride }).styleOverride)) {
    addIssue(issues, "uncertainty", "V3 plan uncertainty statement does not match the presence of a cited style override.");
  }
  const inputResult = validateV3Input(value.input, options);
  if (!inputResult.ok) for (const issue of inputResult.issues) addIssue(issues, `input.${issue.path}`, issue.message);
  if (issues.length > 0 || !inputResult.ok) return { ok: false, issues };

  const plan = value as unknown as V3Plan;
  const expected = buildPlan(inputResult.value, options);
  if (!expected.ok) return expected;
  if (calculateV3PlanHash(plan) !== plan.planHashSha256) addIssue(issues, "planHashSha256", "Plan hash does not match canonical content with the hash field excluded.");
  if (stableSerialize(plan) !== stableSerialize(expected.value)) addIssue(issues, "$", "Plan is not the canonical deterministic V3 output for its embedded input.");
  if (plan.inventory.components.length !== REQUIRED_EXTERIOR_COMPONENT_KINDS.length) addIssue(issues, "inventory", "V3 inventory must declare every required kind.");
  for (const component of plan.inventory.components) {
    // `absent` is admissible for exactly one kind and exactly one reason: a
    // refused tier offset. Anything else absent would be a silent gap.
    const admissible = component.state === "generated" || (component.state === "absent" && component.kind === "setbacks" && plan.massing.effectiveTierCount <= 1);
    if (!admissible) addIssue(issues, `inventory.${component.kind}`, "V3 admits only generated components, plus absent setbacks when the tier offset was refused.");
  }
  for (const tier of plan.tiers) {
    if (!ringIsSimple(tier.ring)) addIssue(issues, `tiers[${tier.index}].ring`, "Tier ring must be simple.");
    if (ringSignedAreaMm2(tier.ring) <= 0) addIssue(issues, `tiers[${tier.index}].ring`, "Tier ring must be positively oriented.");
  }
  const surfaceById = new Map(plan.surfaces.map((surface) => [surface.id, surface]));
  for (const placement of plan.placements) {
    const surface = surfaceById.get(placement.surfaceId);
    if (!surface || surface.kind !== "facade") { addIssue(issues, `placements.${placement.id}`, "Placement must resolve to a facade surface."); continue; }
    const { uMinMm, vMinMm, uMaxMm, vMaxMm } = placement.bounds;
    if (uMinMm >= uMaxMm || vMinMm >= vMaxMm) addIssue(issues, `placements.${placement.id}.bounds`, "Placement bounds must have positive area.");
    if (uMinMm < surface.uStartMm || uMaxMm > surface.uEndMm) addIssue(issues, `placements.${placement.id}.bounds`, "Placement violates the corner clearance of its edge.");
    if (vMinMm < 0 || vMaxMm > surface.vLengthMm) addIssue(issues, `placements.${placement.id}.bounds`, "Placement exceeds its surface bounds.");
  }
  return issues.length === 0 ? { ok: true, value: plan } : { ok: false, issues };
}

/**
 * `options` is threaded rather than left at the shipped default so a plan built
 * under a wider envelope can be serialized at all. Omitting it would make this
 * entrypoint silently unusable for every successor plan — the exact shape of
 * the defect the T004 threading exists to close, one function further out.
 */
export function serializeV3Plan(value: unknown, options: V3GrammarOptions = {}): V3Validation<string> {
  const validation = validateV3Plan(value, options);
  return validation.ok ? { ok: true, value: stableSerialize(validation.value) } : validation;
}

// ---------------------------------------------------------------------------
// Tessellation
//
// Provider-neutral local-millimetre geometry. The release layer maps material
// ids to indexes and applies the ENU and Y-up transforms; nothing here knows
// about glTF.
// ---------------------------------------------------------------------------

export interface V3Quad { materialId: string; corners: [Point3Mm, Point3Mm, Point3Mm, Point3Mm] }
export interface V3Triangle { materialId: string; a: Point3Mm; b: Point3Mm; c: Point3Mm }
export interface V3Tessellation { quads: V3Quad[]; triangles: V3Triangle[]; triangleCount: number }

interface SurfaceFrame { originX: number; originY: number; spanX: number; spanY: number; normalX: number; normalY: number; baseZ: number; length: number }

function surfaceFrame(surface: V3FacadeSurface): SurfaceFrame {
  const spanX = surface.endMm[0] - surface.startMm[0];
  const spanY = surface.endMm[1] - surface.startMm[1];
  const length = Math.hypot(spanX, spanY);
  return {
    originX: surface.startMm[0], originY: surface.startMm[1], spanX, spanY,
    // Exterior of a counter-clockwise ring lies to the right of each edge.
    normalX: length === 0 ? 0 : spanY / length, normalY: length === 0 ? 0 : -spanX / length,
    baseZ: surface.baseZMm, length,
  };
}

/**
 * `u` is a length along the edge and enters as a FRACTION of the rounded edge
 * length, so `u = 0` and `u = uLengthMm` land exactly on the ring vertices. That
 * is what makes neighbouring bands share a vertex column and the corner joins
 * watertight.
 */
function framePoint(frame: SurfaceFrame, uLengthMm: number, u: number, v: number, depth: number): Point3Mm {
  const t = uLengthMm === 0 ? 0 : u / uLengthMm;
  return [
    frame.originX + frame.spanX * t + frame.normalX * depth,
    frame.originY + frame.spanY * t + frame.normalY * depth,
    frame.baseZ + v,
  ];
}

function wallQuad(out: V3Quad[], frame: SurfaceFrame, surface: V3FacadeSurface, materialId: string, uMin: number, vMin: number, uMax: number, vMax: number, depth = 0): void {
  if (uMax <= uMin || vMax <= vMin) return;
  out.push({
    materialId,
    corners: [
      framePoint(frame, surface.uLengthMm, uMin, vMin, depth),
      framePoint(frame, surface.uLengthMm, uMax, vMin, depth),
      framePoint(frame, surface.uLengthMm, uMax, vMax, depth),
      framePoint(frame, surface.uLengthMm, uMin, vMax, depth),
    ],
  });
}

/**
 * Wall between two heights, split at the base/shaft boundary.
 *
 * Row strips never straddle the boundary — it is a floor boundary — but the
 * corner margins and a blank wall run the full height of the band, so the split
 * has to happen here rather than at the caller. Splitting adds vertices along a
 * shared edge, which keeps the band watertight.
 */
function zonedWall(out: V3Quad[], frame: SurfaceFrame, surface: V3FacadeSurface, uMin: number, vMin: number, uMax: number, vMax: number): void {
  const boundary = surface.baseVMaxMm;
  if (boundary <= vMin || boundary >= vMax) {
    wallQuad(out, frame, surface, vMax <= boundary ? surface.baseMaterialId : surface.materialId, uMin, vMin, uMax, vMax);
    return;
  }
  wallQuad(out, frame, surface, surface.baseMaterialId, uMin, vMin, uMax, boundary);
  wallQuad(out, frame, surface, surface.materialId, uMin, boundary, uMax, vMax);
}

/** Five faces: the four sides of the opening plus its back, wound outward-facing. */
function recessBox(out: V3Quad[], frame: SurfaceFrame, surface: V3FacadeSurface, glazingId: string, wallId: string, uMin: number, vMin: number, uMax: number, vMax: number, depth: number): void {
  const point = (u: number, v: number, d: number): Point3Mm => framePoint(frame, surface.uLengthMm, u, v, d);
  out.push({ materialId: glazingId, corners: [point(uMin, vMin, depth), point(uMax, vMin, depth), point(uMax, vMax, depth), point(uMin, vMax, depth)] });
  out.push({ materialId: wallId, corners: [point(uMin, vMin, 0), point(uMin, vMin, depth), point(uMin, vMax, depth), point(uMin, vMax, 0)] });
  out.push({ materialId: wallId, corners: [point(uMax, vMin, depth), point(uMax, vMin, 0), point(uMax, vMax, 0), point(uMax, vMax, depth)] });
  out.push({ materialId: wallId, corners: [point(uMin, vMin, depth), point(uMin, vMin, 0), point(uMax, vMin, 0), point(uMax, vMin, depth)] });
  out.push({ materialId: wallId, corners: [point(uMin, vMax, 0), point(uMin, vMax, depth), point(uMax, vMax, depth), point(uMax, vMax, 0)] });
}

/**
 * A CLOSED outward box: front, four returns, and a back face lying in the wall.
 *
 * The back face is not decoration. Without it the box is an open shell, the
 * wall behind it is still emitted, and the surface no longer bounds a solid:
 * the analytic volume identity comes out several per cent high. Emitting the
 * box closed makes the shipped surface the union of two closed solids whose
 * volumes simply add, which is exactly what the identity asserts. The
 * coincident back face is interior and never seen.
 */
function protrusionBox(out: V3Quad[], frame: SurfaceFrame, surface: V3FacadeSurface, materialId: string, uMin: number, vMin: number, uMax: number, vMax: number, depth: number): void {
  const point = (u: number, v: number, d: number): Point3Mm => framePoint(frame, surface.uLengthMm, u, v, d);
  out.push({ materialId, corners: [point(uMin, vMin, depth), point(uMax, vMin, depth), point(uMax, vMax, depth), point(uMin, vMax, depth)] });
  out.push({ materialId, corners: [point(uMin, vMin, 0), point(uMin, vMax, 0), point(uMax, vMax, 0), point(uMax, vMin, 0)] });
  out.push({ materialId, corners: [point(uMin, vMin, 0), point(uMin, vMin, depth), point(uMin, vMax, depth), point(uMin, vMax, 0)] });
  out.push({ materialId, corners: [point(uMax, vMin, depth), point(uMax, vMin, 0), point(uMax, vMax, 0), point(uMax, vMax, depth)] });
  out.push({ materialId, corners: [point(uMin, vMin, depth), point(uMin, vMin, 0), point(uMax, vMin, 0), point(uMax, vMin, depth)] });
  out.push({ materialId, corners: [point(uMin, vMax, 0), point(uMin, vMax, depth), point(uMax, vMax, depth), point(uMax, vMax, 0)] });
}

export function tessellateV3Plan(plan: V3Plan, options: { includeRecesses: boolean }): V3Tessellation {
  const quads: V3Quad[] = [];
  const triangles: V3Triangle[] = [];
  const openingsBySurface = new Map<string, V3Placement[]>();
  const attachmentsBySurface = new Map<string, V3Placement[]>();
  for (const placement of plan.placements) {
    const bucket = placement.depthMm < 0 ? openingsBySurface : attachmentsBySurface;
    const existing = bucket.get(placement.surfaceId);
    if (existing) existing.push(placement); else bucket.set(placement.surfaceId, [placement]);
  }

  for (const surface of plan.surfaces) {
    if (surface.kind !== "facade") continue;
    const frame = surfaceFrame(surface);
    const openings = openingsBySurface.get(surface.id) ?? [];
    if (openings.length === 0) {
      zonedWall(quads, frame, surface, 0, 0, surface.uLengthMm, surface.vLengthMm);
    } else {
      // Corner-clearance margins, full height, split at the zone boundary.
      zonedWall(quads, frame, surface, 0, 0, surface.uStartMm, surface.vLengthMm);
      zonedWall(quads, frame, surface, surface.uEndMm, 0, surface.uLengthMm, surface.vLengthMm);
      // Rows: one band of openings each, tiled by two strips and n+1 piers.
      const rows = new Map<string, V3Placement[]>();
      for (const opening of openings) {
        const key = `${opening.bounds.vMinMm}:${opening.bounds.vMaxMm}`;
        const bucket = rows.get(key);
        if (bucket) bucket.push(opening); else rows.set(key, [opening]);
      }
      const ordered = [...rows.values()].map((row) => [...row].sort((left, right) => left.bounds.uMinMm - right.bounds.uMinMm)).sort((left, right) => left[0]!.bounds.vMinMm - right[0]!.bounds.vMinMm);
      let previousTop = 0;
      for (const row of ordered) {
        const vMin = row[0]!.bounds.vMinMm;
        const vMax = row[0]!.bounds.vMaxMm;
        zonedWall(quads, frame, surface, surface.uStartMm, previousTop, surface.uEndMm, vMin);
        const rowMaterialId = vMax <= surface.baseVMaxMm ? surface.baseMaterialId : surface.materialId;
        let cursor = surface.uStartMm;
        for (const opening of row) {
          wallQuad(quads, frame, surface, rowMaterialId, cursor, vMin, opening.bounds.uMinMm, vMax);
          if (options.includeRecesses) recessBox(quads, frame, surface, opening.materialId, rowMaterialId, opening.bounds.uMinMm, vMin, opening.bounds.uMaxMm, vMax, opening.depthMm);
          else wallQuad(quads, frame, surface, opening.materialId, opening.bounds.uMinMm, vMin, opening.bounds.uMaxMm, vMax);
          cursor = opening.bounds.uMaxMm;
        }
        wallQuad(quads, frame, surface, rowMaterialId, cursor, vMin, surface.uEndMm, vMax);
        previousTop = vMax;
      }
      zonedWall(quads, frame, surface, surface.uStartMm, previousTop, surface.uEndMm, surface.vLengthMm);
    }
    if (!options.includeRecesses) continue;
    for (const attachment of attachmentsBySurface.get(surface.id) ?? []) {
      protrusionBox(quads, frame, surface, attachment.materialId, attachment.bounds.uMinMm, attachment.bounds.vMinMm, attachment.bounds.uMaxMm, attachment.bounds.vMaxMm, attachment.depthMm);
    }
  }

  for (const surface of plan.surfaces) {
    if (surface.kind === "roof" || surface.kind === "ground") {
      for (const triangle of surface.triangles) {
        const a = surface.ring[triangle[0]]!;
        const b = surface.ring[triangle[1]]!;
        const c = surface.ring[triangle[2]]!;
        // A downward cap reverses its winding so it faces out of the solid.
        const first: Point3Mm = [a[0], a[1], surface.zMm];
        const second: Point3Mm = [b[0], b[1], surface.zMm];
        const third: Point3Mm = [c[0], c[1], surface.zMm];
        triangles.push(surface.downward ? { materialId: surface.materialId, a: first, b: third, c: second } : { materialId: surface.materialId, a: first, b: second, c: third });
      }
    } else if (surface.kind === "setback-deck") {
      const combined = [...surface.outerRing, ...surface.innerRing];
      for (const triangle of surface.triangles) {
        const a = combined[triangle[0]]!;
        const b = combined[triangle[1]]!;
        const c = combined[triangle[2]]!;
        triangles.push({ materialId: surface.materialId, a: [a[0], a[1], surface.zMm], b: [b[0], b[1], surface.zMm], c: [c[0], c[1], surface.zMm] });
      }
    }
  }

  for (const prism of plan.prisms) {
    const count = prism.ring.length;
    for (let index = 0; index < count; index += 1) {
      const current = prism.ring[index]!;
      const next = prism.ring[(index + 1) % count]!;
      quads.push({
        materialId: prism.materialId,
        corners: [
          [current[0], current[1], prism.baseZMm], [next[0], next[1], prism.baseZMm],
          [next[0], next[1], prism.topZMm], [current[0], current[1], prism.topZMm],
        ],
      });
    }
    for (const triangle of prism.triangles) {
      const a = prism.ring[triangle[0]]!;
      const b = prism.ring[triangle[1]]!;
      const c = prism.ring[triangle[2]]!;
      triangles.push({ materialId: prism.materialId, a: [a[0], a[1], prism.topZMm], b: [b[0], b[1], prism.topZMm], c: [c[0], c[1], prism.topZMm] });
      triangles.push({ materialId: prism.materialId, a: [a[0], a[1], prism.baseZMm], b: [c[0], c[1], prism.baseZMm], c: [b[0], b[1], prism.baseZMm] });
    }
  }

  return { quads, triangles, triangleCount: quads.length * 2 + triangles.length };
}
