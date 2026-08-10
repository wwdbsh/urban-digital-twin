/**
 * V2 deterministic facade grammar: complete generative exterior completion.
 *
 * V1 (`deterministic-facade-generator.ts`) declares five component kinds
 * `absent` because its grammar produces no geometry for them. V2 generates all
 * fifteen required kinds, so every component carries truth tier `generated`.
 *
 * V1 stays byte-frozen: the committed `manhattan-esb-block-reference-20260810`
 * package is a drift-tested artifact of V1, and this module is a sibling with
 * its own generator id, version, schema version and uncertainty statements. It
 * never imports V1 behaviour that could drift V1 output.
 *
 * The plan *vocabulary* is deliberately the same shape as V1 — materials,
 * surfaces, placements, topology — so the existing canonical tessellator and
 * GLB writer extend rather than fork. V2 adds stepped massing tiers, four new
 * facade-attached placement kinds and extruded prisms.
 *
 * Signage is the one kind that needs an explicit honesty rule: V2 emits blank
 * sign-band and blade massing only. There is no text, glyph, logo, brand or
 * tenant content anywhere in the grammar, and the generated band is not a claim
 * that a sign exists at that position, size or orientation in the real world.
 */

import {
  EXTERIOR_COMPONENT_SCHEMA_VERSION,
  REQUIRED_EXTERIOR_COMPONENT_KINDS,
  type ExteriorComponentInventory,
} from "./exterior-contract.ts";
import { domainSeparatedSha256, stableSerialize } from "./deterministic-hash.ts";

export const DETERMINISTIC_FACADE_V2_SCHEMA_VERSION = "2.0" as const;
export const DETERMINISTIC_FACADE_V2_GENERATOR_ID = "urban-digital-twin:deterministic-facade-plan-v2" as const;
export const DETERMINISTIC_FACADE_V2_GENERATOR_VERSION = "2.0.0" as const;

export const DETERMINISTIC_FACADE_V2_UNCERTAINTY =
  "Procedurally generated complete exterior in local millimetres. Every component is generated from footprint and height constraints only; it does not assert real-world facade, setback, balcony, fire-escape, water-tank or signage accuracy, nor any tenant, brand or text." as const;

export const DETERMINISTIC_FACADE_V2_SIGNAGE_UNCERTAINTY =
  "Generated blank sign-band and blade massing only. No real-world sign presence, size, position, orientation, text, brand or tenant is asserted, and no glyph, logo or lettering is generated." as const;

export const DETERMINISTIC_FACADE_V2_LIMITS = {
  maxTiers: 6,
  maxFloors: 512,
  maxBays: 256,
  maxSurfaces: 4_096,
  maxPlacements: 200_000,
  maxPrisms: 4_096,
  maxPrismSides: 32,
  maxInputIdLength: 128,
  maxPlanIdLength: 256,
  maxLocalMillimeters: 1_000_000_000,
} as const;

export type Point2Mm = [number, number];
export type Point3Mm = [number, number, number];

export type V2PlacementKind =
  | "window" | "entrance" | "storefront" | "cornice" | "roof-equipment"
  | "balcony" | "fire-escape" | "sign-band" | "blade-sign";

export type V2SurfaceKind = "facade" | "roof" | "ground" | "setback-deck";
export type V2PrismKind = "water-tank" | "water-tank-leg";

export interface V2SourceAnchor { id: string; kind: "footprint" | "height" | "constraint"; sourceRefId: string; fingerprintSha256: string }

export interface V2Parameters {
  floorCount: number;
  bayCount: number;
  floorHeightMm: number;
  windowWidthMm: number;
  windowHeightMm: number;
  windowSillMm: number;
  openingInsetMm: number;
  entranceWidthMm: number;
  entranceHeightMm: number;
  storefrontHeightMm: number;
  corniceHeightMm: number;
  roofEquipmentSizeMm: number;
  /** Stepped massing: at least two tiers, so every building carries real setback geometry. */
  tierCount: number;
  setbackInsetMm: number;
  balconyDepthMm: number;
  balconyHeightMm: number;
  balconyFloorInterval: number;
  fireEscapeWidthMm: number;
  fireEscapeDepthMm: number;
  fireEscapePlatformHeightMm: number;
  waterTankSides: number;
  waterTankRadiusMm: number;
  waterTankHeightMm: number;
  waterTankLegHeightMm: number;
  waterTankLegSizeMm: number;
  signBandHeightMm: number;
  signBandDepthMm: number;
  bladeSignWidthMm: number;
  bladeSignHeightMm: number;
  bladeSignDepthMm: number;
}

export interface V2Input {
  schemaVersion: typeof DETERMINISTIC_FACADE_V2_SCHEMA_VERSION;
  buildingId: string;
  generatedAt: string;
  seed: string;
  tool: { id: string; version: string };
  geometry: { unit: "millimeter"; footprint: { outer: Point2Mm[]; holes: [] }; baseElevationMm: number; heightMm: number };
  sourceAnchors: V2SourceAnchor[];
  parameters: V2Parameters;
}

export interface V2Material { id: string; role: "facade" | "glazing" | "trim" | "roof" | "ground" | "metal"; baseColorSrgb: [number, number, number, number]; metallicPermille: number; roughnessPermille: number }
export interface V2Surface { id: string; kind: V2SurfaceKind; axis: "x" | "y" | "z"; materialId: string; tierIndex: number; uLengthMm: number; vLengthMm: number; ring: Point3Mm[] }
export interface V2Placement {
  id: string; kind: V2PlacementKind; surfaceId: string; materialId: string;
  anchor: "facade" | "ground" | "roof"; tierIndex: number; floorIndex: number | null; bayIndex: number | null;
  bounds: { uMinMm: number; vMinMm: number; uMaxMm: number; vMaxMm: number };
}
/** Vertically extruded polygon, used for the rooftop water tank and its legs. */
export interface V2Prism { id: string; kind: V2PrismKind; materialId: string; ring: Point2Mm[]; baseZMm: number; topZMm: number }

export interface V2Tier { index: number; baseZMm: number; topZMm: number; minX: number; minY: number; maxX: number; maxY: number; firstFloorIndex: number; floorCount: number }

export interface V2Plan {
  schemaVersion: typeof DETERMINISTIC_FACADE_V2_SCHEMA_VERSION;
  planId: string;
  buildingId: string;
  coordinateSystem: "local-millimeters";
  generatedAt: string;
  tool: { id: string; version: string };
  input: V2Input;
  inputFingerprintSha256: string;
  parametersHashSha256: string;
  anchors: V2SourceAnchor[];
  uncertainty: typeof DETERMINISTIC_FACADE_V2_UNCERTAINTY;
  inventory: ExteriorComponentInventory;
  tiers: V2Tier[];
  materials: V2Material[];
  surfaces: V2Surface[];
  placements: V2Placement[];
  prisms: V2Prism[];
  topology: { parts: Array<{ id: string; bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number } }>; closedManifold: true };
  planHashSha256: string;
}

export interface V2Issue { path: string; message: string }
export type V2Validation<T> = { ok: true; value: T } | { ok: false; issues: V2Issue[] };

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function addIssue(issues: V2Issue[], path: string, message: string): void { issues.push({ path, message }); }
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function safeInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
function safeId(value: unknown, maximum: number = DETERMINISTIC_FACADE_V2_LIMITS.maxInputIdLength): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && /^[A-Za-z0-9][A-Za-z0-9:._-]*$/u.test(value);
}
function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const milliseconds = Date.parse(value);
  return !Number.isNaN(milliseconds) && new Date(milliseconds).toISOString() === value;
}
function checksum(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }

const PARAMETER_KEYS = [
  "floorCount", "bayCount", "floorHeightMm", "windowWidthMm", "windowHeightMm", "windowSillMm", "openingInsetMm",
  "entranceWidthMm", "entranceHeightMm", "storefrontHeightMm", "corniceHeightMm", "roofEquipmentSizeMm",
  "tierCount", "setbackInsetMm", "balconyDepthMm", "balconyHeightMm", "balconyFloorInterval",
  "fireEscapeWidthMm", "fireEscapeDepthMm", "fireEscapePlatformHeightMm",
  "waterTankSides", "waterTankRadiusMm", "waterTankHeightMm", "waterTankLegHeightMm", "waterTankLegSizeMm",
  "signBandHeightMm", "signBandDepthMm", "bladeSignWidthMm", "bladeSignHeightMm", "bladeSignDepthMm",
] as const;

export function validateV2Input(value: unknown): V2Validation<V2Input> {
  const issues: V2Issue[] = [];
  if (!record(value)) return { ok: false, issues: [{ path: "$", message: "V2 facade input must be an object." }] };
  if (value.schemaVersion !== DETERMINISTIC_FACADE_V2_SCHEMA_VERSION) addIssue(issues, "schemaVersion", "Unsupported V2 facade input schema.");
  if (!safeId(value.buildingId)) addIssue(issues, "buildingId", "Building ID must use bounded safe identifier characters.");
  if (!safeId(value.seed)) addIssue(issues, "seed", "Seed must use bounded safe identifier characters.");
  if (!canonicalTimestamp(value.generatedAt)) addIssue(issues, "generatedAt", "Generated time must be canonical UTC with millisecond precision.");
  if (!record(value.tool) || !safeId(value.tool.id) || !safeId(value.tool.version)) addIssue(issues, "tool", "Tool ID and version must be bounded safe identifiers.");

  let outer: Point2Mm[] | null = null; let baseElevationMm = 0; let heightMm = 0;
  if (!record(value.geometry)) addIssue(issues, "geometry", "Local-mm geometry is required.");
  else {
    const geometry = value.geometry;
    if (geometry.unit !== "millimeter") addIssue(issues, "geometry.unit", "Geometry unit must be millimetre.");
    if (!record(geometry.footprint) || !Array.isArray(geometry.footprint.outer) || geometry.footprint.outer.length !== 4 || !Array.isArray(geometry.footprint.holes) || geometry.footprint.holes.length !== 0) {
      addIssue(issues, "geometry.footprint", "V2 footprint must be one unclosed four-vertex rectangle ring without holes.");
    } else {
      const points = geometry.footprint.outer as unknown[];
      const parsed: Point2Mm[] = [];
      points.forEach((point, index) => {
        if (!Array.isArray(point) || point.length !== 2 || !safeInteger(point[0], -DETERMINISTIC_FACADE_V2_LIMITS.maxLocalMillimeters, DETERMINISTIC_FACADE_V2_LIMITS.maxLocalMillimeters) || !safeInteger(point[1], -DETERMINISTIC_FACADE_V2_LIMITS.maxLocalMillimeters, DETERMINISTIC_FACADE_V2_LIMITS.maxLocalMillimeters)) addIssue(issues, `geometry.footprint.outer[${index}]`, "Local-mm point must contain two bounded safe integers.");
        else parsed.push([point[0], point[1]]);
      });
      if (parsed.length === 4) {
        const xs = parsed.map(([x]) => x); const ys = parsed.map(([, y]) => y);
        const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
        if (minX === maxX || minY === maxY) addIssue(issues, "geometry.footprint.outer", "V2 footprint rectangle must be non-degenerate.");
        else outer = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
      }
    }
    if (!safeInteger(geometry.baseElevationMm, -DETERMINISTIC_FACADE_V2_LIMITS.maxLocalMillimeters, DETERMINISTIC_FACADE_V2_LIMITS.maxLocalMillimeters)) addIssue(issues, "geometry.baseElevationMm", "Base elevation must be a bounded safe integer.");
    else baseElevationMm = geometry.baseElevationMm;
    if (!safeInteger(geometry.heightMm, 1, DETERMINISTIC_FACADE_V2_LIMITS.maxLocalMillimeters)) addIssue(issues, "geometry.heightMm", "Height must be a positive bounded safe integer.");
    else heightMm = geometry.heightMm;
  }

  let parameters: V2Parameters | null = null;
  if (!record(value.parameters)) addIssue(issues, "parameters", "V2 generator parameters are required.");
  else {
    const raw = value.parameters;
    for (const key of Object.keys(raw)) if (!(PARAMETER_KEYS as readonly string[]).includes(key)) addIssue(issues, `parameters.${key}`, "Unexpected parameter.");
    for (const key of PARAMETER_KEYS) if (!(key in raw)) addIssue(issues, `parameters.${key}`, "Required parameter is missing.");
    if (!safeInteger(raw.floorCount, 2, DETERMINISTIC_FACADE_V2_LIMITS.maxFloors)) addIssue(issues, "parameters.floorCount", "Floor count is outside the V2 cap.");
    if (!safeInteger(raw.bayCount, 2, DETERMINISTIC_FACADE_V2_LIMITS.maxBays)) addIssue(issues, "parameters.bayCount", "Bay count is outside the V2 cap.");
    if (!safeInteger(raw.tierCount, 2, DETERMINISTIC_FACADE_V2_LIMITS.maxTiers)) addIssue(issues, "parameters.tierCount", "V2 requires at least two massing tiers so setbacks are always real geometry.");
    if (!safeInteger(raw.waterTankSides, 6, DETERMINISTIC_FACADE_V2_LIMITS.maxPrismSides) || (raw.waterTankSides as number) % 2 !== 0) addIssue(issues, "parameters.waterTankSides", "Water tank must use an even side count so its caps decompose into quads.");
    if (!safeInteger(raw.balconyFloorInterval, 1, DETERMINISTIC_FACADE_V2_LIMITS.maxFloors)) addIssue(issues, "parameters.balconyFloorInterval", "Balcony interval must be a positive bounded integer.");
    for (const key of PARAMETER_KEYS) {
      if (["floorCount", "bayCount", "tierCount", "waterTankSides", "balconyFloorInterval"].includes(key)) continue;
      if (!safeInteger(raw[key], 1, DETERMINISTIC_FACADE_V2_LIMITS.maxLocalMillimeters)) addIssue(issues, `parameters.${key}`, "Parameter must be a positive bounded safe integer in millimetres.");
    }
    if (!issues.some((issue) => issue.path.startsWith("parameters"))) parameters = Object.freeze({ ...raw } as unknown as V2Parameters);
  }

  const anchors: V2SourceAnchor[] = [];
  if (!Array.isArray(value.sourceAnchors) || value.sourceAnchors.length === 0) addIssue(issues, "sourceAnchors", "Canonical source anchors are required.");
  else value.sourceAnchors.forEach((anchor, index) => {
    if (!record(anchor) || !safeId(anchor.id) || !safeId(anchor.sourceRefId) || !checksum(anchor.fingerprintSha256) || (anchor.kind !== "footprint" && anchor.kind !== "height" && anchor.kind !== "constraint")) addIssue(issues, `sourceAnchors[${index}]`, "Source anchor identity, kind or fingerprint is invalid.");
    else anchors.push({ id: anchor.id, kind: anchor.kind, sourceRefId: anchor.sourceRefId, fingerprintSha256: anchor.fingerprintSha256 });
  });
  anchors.sort((left, right) => compareText(left.id, right.id));
  if (!anchors.some((anchor) => anchor.kind === "footprint") || !anchors.some((anchor) => anchor.kind === "height")) addIssue(issues, "sourceAnchors", "V2 requires canonical footprint and height anchors.");

  if (outer && parameters) {
    const width = outer[1]![0] - outer[0]![0]; const depth = outer[3]![1] - outer[0]![1];
    const minimumDimension = Math.min(width, depth);
    const minimumBay = Math.floor(minimumDimension / parameters.bayCount);
    if (parameters.floorCount * parameters.floorHeightMm !== heightMm) addIssue(issues, "geometry.heightMm", "Height must exactly equal floorCount times floorHeightMm.");
    if (parameters.openingInsetMm * 2 >= minimumBay) addIssue(issues, "parameters.openingInsetMm", "Opening inset leaves no usable bay width.");
    for (const [key, amount] of [["windowWidthMm", parameters.windowWidthMm], ["entranceWidthMm", parameters.entranceWidthMm]] as const) {
      if (amount > minimumBay - parameters.openingInsetMm * 2) addIssue(issues, `parameters.${key}`, "Opening width exceeds the smallest deterministic bay.");
    }
    if (parameters.windowSillMm + parameters.windowHeightMm + parameters.corniceHeightMm > parameters.floorHeightMm) addIssue(issues, "parameters.windowHeightMm", "Window and cornice vertical bounds overlap.");
    if (parameters.entranceHeightMm > parameters.floorHeightMm || parameters.storefrontHeightMm > parameters.floorHeightMm) addIssue(issues, "parameters", "Ground opening height exceeds the first floor.");
    if (parameters.signBandHeightMm + parameters.entranceHeightMm > parameters.floorHeightMm) addIssue(issues, "parameters.signBandHeightMm", "Sign band and entrance overlap on the ground floor.");
    // The topmost tier must keep a usable footprint after every setback step.
    const totalInset = (parameters.tierCount - 1) * parameters.setbackInsetMm * 2;
    if (totalInset >= minimumDimension - parameters.waterTankRadiusMm * 2 - 2_000) addIssue(issues, "parameters.setbackInsetMm", "Cumulative setbacks leave no usable top tier for rooftop structures.");
    if (parameters.tierCount > parameters.floorCount) addIssue(issues, "parameters.tierCount", "Tier count cannot exceed floor count.");
    if (parameters.roofEquipmentSizeMm > minimumDimension - totalInset) addIssue(issues, "parameters.roofEquipmentSizeMm", "Roof equipment exceeds the top tier footprint.");
  }

  if (issues.length > 0 || !outer || !parameters) return { ok: false, issues };
  return {
    ok: true,
    value: {
      schemaVersion: DETERMINISTIC_FACADE_V2_SCHEMA_VERSION,
      buildingId: value.buildingId as string,
      generatedAt: value.generatedAt as string,
      seed: value.seed as string,
      tool: { id: (value.tool as { id: string; version: string }).id, version: (value.tool as { id: string; version: string }).version },
      geometry: { unit: "millimeter", footprint: { outer, holes: [] }, baseElevationMm, heightMm },
      sourceAnchors: anchors,
      parameters,
    },
  };
}

const V2_COLORS: ReadonlyArray<readonly [number, number, number, number]> = [
  [186, 122, 96, 255], [206, 184, 148, 255], [112, 134, 148, 255], [162, 152, 140, 255],
  [92, 108, 96, 255], [122, 98, 118, 255], [198, 200, 194, 255], [74, 82, 92, 255],
];

function makeMaterials(choiceHash: string): V2Material[] {
  const start = Number.parseInt(choiceHash.slice(0, 8), 16) % V2_COLORS.length;
  const color = (offset: number): [number, number, number, number] => [...V2_COLORS[(start + offset) % V2_COLORS.length]!] as [number, number, number, number];
  return [
    { id: "material:facade:0", role: "facade", baseColorSrgb: color(0), metallicPermille: 0, roughnessPermille: 760 },
    { id: "material:facade:1", role: "facade", baseColorSrgb: color(1), metallicPermille: 0, roughnessPermille: 700 },
    { id: "material:glazing", role: "glazing", baseColorSrgb: color(2), metallicPermille: 80, roughnessPermille: 180 },
    { id: "material:trim", role: "trim", baseColorSrgb: color(3), metallicPermille: 0, roughnessPermille: 620 },
    { id: "material:roof", role: "roof", baseColorSrgb: color(4), metallicPermille: 120, roughnessPermille: 820 },
    { id: "material:ground", role: "ground", baseColorSrgb: color(5), metallicPermille: 0, roughnessPermille: 900 },
    { id: "material:metal", role: "metal", baseColorSrgb: color(7), metallicPermille: 700, roughnessPermille: 380 },
  ];
}

function buildTiers(input: V2Input): V2Tier[] {
  const { parameters, geometry } = input;
  const [southWest, southEast, , northWest] = geometry.footprint.outer;
  const minX = southWest![0]; const minY = southWest![1]; const maxX = southEast![0]; const maxY = northWest![1];
  const base = geometry.baseElevationMm;
  const perTier = Math.floor(parameters.floorCount / parameters.tierCount);
  const remainder = parameters.floorCount - perTier * parameters.tierCount;
  const tiers: V2Tier[] = [];
  let firstFloorIndex = 0;
  for (let index = 0; index < parameters.tierCount; index += 1) {
    // Lower tiers absorb the remainder so the crown stays the shallowest step.
    const floorCount = perTier + (index < remainder ? 1 : 0);
    const inset = index * parameters.setbackInsetMm;
    tiers.push({
      index,
      baseZMm: base + firstFloorIndex * parameters.floorHeightMm,
      topZMm: base + (firstFloorIndex + floorCount) * parameters.floorHeightMm,
      minX: minX + inset, minY: minY + inset, maxX: maxX - inset, maxY: maxY - inset,
      firstFloorIndex, floorCount,
    });
    firstFloorIndex += floorCount;
  }
  return tiers;
}

function facadeSurfaces(tier: V2Tier): V2Surface[] {
  const { minX, minY, maxX, maxY, baseZMm: z0, topZMm: z1, index } = tier;
  const width = maxX - minX; const depth = maxY - minY; const height = z1 - z0;
  const make = (side: string, axis: "x" | "y", materialId: string, uLengthMm: number, ring: Point3Mm[]): V2Surface =>
    ({ id: `surface:tier:${index}:facade:${side}`, kind: "facade", axis, materialId, tierIndex: index, uLengthMm, vLengthMm: height, ring });
  return [
    make("south", "y", "material:facade:0", width, [[minX, minY, z0], [maxX, minY, z0], [maxX, minY, z1], [minX, minY, z1]]),
    make("east", "x", "material:facade:1", depth, [[maxX, minY, z0], [maxX, maxY, z0], [maxX, maxY, z1], [maxX, minY, z1]]),
    make("north", "y", "material:facade:0", width, [[maxX, maxY, z0], [minX, maxY, z0], [minX, maxY, z1], [maxX, maxY, z1]]),
    make("west", "x", "material:facade:1", depth, [[minX, maxY, z0], [minX, minY, z0], [minX, minY, z1], [minX, maxY, z1]]),
  ];
}

/** Horizontal annulus between a tier and the narrower tier above it, as four non-overlapping decks. */
function setbackDeckSurfaces(lower: V2Tier, upper: V2Tier): V2Surface[] {
  const z = lower.topZMm;
  const deck = (side: string, x0: number, y0: number, x1: number, y1: number): V2Surface => ({
    id: `surface:tier:${upper.index}:setback-deck:${side}`,
    kind: "setback-deck", axis: "z", materialId: "material:roof", tierIndex: upper.index,
    uLengthMm: x1 - x0, vLengthMm: y1 - y0,
    ring: [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]],
  });
  return [
    deck("south", lower.minX, lower.minY, lower.maxX, upper.minY),
    deck("north", lower.minX, upper.maxY, lower.maxX, lower.maxY),
    deck("west", lower.minX, upper.minY, upper.minX, upper.maxY),
    deck("east", upper.maxX, upper.minY, lower.maxX, upper.maxY),
  ];
}

function buildSurfaces(input: V2Input, tiers: V2Tier[]): V2Surface[] {
  const surfaces: V2Surface[] = [];
  const ground = tiers[0]!;
  surfaces.push({
    id: "surface:ground", kind: "ground", axis: "z", materialId: "material:ground", tierIndex: 0,
    uLengthMm: ground.maxX - ground.minX, vLengthMm: ground.maxY - ground.minY,
    ring: [[ground.minX, ground.maxY, ground.baseZMm], [ground.maxX, ground.maxY, ground.baseZMm], [ground.maxX, ground.minY, ground.baseZMm], [ground.minX, ground.minY, ground.baseZMm]],
  });
  for (const tier of tiers) surfaces.push(...facadeSurfaces(tier));
  for (let index = 1; index < tiers.length; index += 1) surfaces.push(...setbackDeckSurfaces(tiers[index - 1]!, tiers[index]!));
  const crown = tiers[tiers.length - 1]!;
  surfaces.push({
    id: "surface:roof", kind: "roof", axis: "z", materialId: "material:roof", tierIndex: crown.index,
    uLengthMm: crown.maxX - crown.minX, vLengthMm: crown.maxY - crown.minY,
    ring: [[crown.minX, crown.minY, crown.topZMm], [crown.maxX, crown.minY, crown.topZMm], [crown.maxX, crown.maxY, crown.topZMm], [crown.minX, crown.maxY, crown.topZMm]],
  });
  void input;
  return surfaces;
}

function bayBounds(uLengthMm: number, bayCount: number, bayIndex: number): { start: number; end: number } {
  const start = Number((BigInt(bayIndex) * BigInt(uLengthMm)) / BigInt(bayCount));
  const end = Number((BigInt(bayIndex + 1) * BigInt(uLengthMm)) / BigInt(bayCount));
  return { start, end };
}

function buildPlacements(input: V2Input, tiers: V2Tier[], surfaces: V2Surface[]): V2Placement[] {
  const parameters = input.parameters;
  const placements: V2Placement[] = [];
  const facades = surfaces.filter((surface) => surface.kind === "facade");
  const primary = facades.find((surface) => surface.id === "surface:tier:0:facade:south")!;

  for (const surface of facades) {
    const tier = tiers[surface.tierIndex]!;
    const side = surface.id.split(":").at(-1)!;
    for (let localFloor = 0; localFloor < tier.floorCount; localFloor += 1) {
      const globalFloor = tier.firstFloorIndex + localFloor;
      const floorBase = localFloor * parameters.floorHeightMm;
      if (globalFloor === 0) continue; // Ground floor carries entrance, storefronts and the sign band.
      for (let bayIndex = 0; bayIndex < parameters.bayCount; bayIndex += 1) {
        const { start, end } = bayBounds(surface.uLengthMm, parameters.bayCount, bayIndex);
        const center = Number((BigInt(start) + BigInt(end)) / 2n);
        const half = Number(BigInt(parameters.windowWidthMm) / 2n);
        placements.push({
          id: `placement:window:${surface.tierIndex}:${side}:${globalFloor}:${bayIndex}`, kind: "window",
          surfaceId: surface.id, materialId: "material:glazing", anchor: "facade",
          tierIndex: surface.tierIndex, floorIndex: globalFloor, bayIndex,
          bounds: { uMinMm: center - half, vMinMm: floorBase + parameters.windowSillMm, uMaxMm: center - half + parameters.windowWidthMm, vMaxMm: floorBase + parameters.windowSillMm + parameters.windowHeightMm },
        });
      }
    }
    placements.push({
      id: `placement:cornice:${surface.tierIndex}:${side}`, kind: "cornice", surfaceId: surface.id,
      materialId: "material:trim", anchor: "facade", tierIndex: surface.tierIndex, floorIndex: null, bayIndex: null,
      bounds: { uMinMm: 0, vMinMm: surface.vLengthMm - parameters.corniceHeightMm, uMaxMm: surface.uLengthMm, vMaxMm: surface.vLengthMm },
    });
  }

  // Ground floor: one entrance, storefronts in the remaining bays, and a blank sign band above them.
  for (let bayIndex = 0; bayIndex < parameters.bayCount; bayIndex += 1) {
    const { start, end } = bayBounds(primary.uLengthMm, parameters.bayCount, bayIndex);
    if (bayIndex === 0) {
      const center = Number((BigInt(start) + BigInt(end)) / 2n);
      const half = Number(BigInt(parameters.entranceWidthMm) / 2n);
      placements.push({ id: "placement:entrance:primary", kind: "entrance", surfaceId: primary.id, materialId: "material:trim", anchor: "ground", tierIndex: 0, floorIndex: 0, bayIndex, bounds: { uMinMm: center - half, vMinMm: 0, uMaxMm: center - half + parameters.entranceWidthMm, vMaxMm: parameters.entranceHeightMm } });
    } else {
      placements.push({ id: `placement:storefront:${bayIndex}`, kind: "storefront", surfaceId: primary.id, materialId: "material:glazing", anchor: "ground", tierIndex: 0, floorIndex: 0, bayIndex, bounds: { uMinMm: start + parameters.openingInsetMm, vMinMm: 0, uMaxMm: end - parameters.openingInsetMm, vMaxMm: parameters.storefrontHeightMm } });
    }
  }
  const signBase = Math.max(parameters.entranceHeightMm, parameters.storefrontHeightMm);
  placements.push({
    id: "placement:sign-band:primary", kind: "sign-band", surfaceId: primary.id, materialId: "material:trim",
    anchor: "ground", tierIndex: 0, floorIndex: 0, bayIndex: null,
    bounds: { uMinMm: parameters.openingInsetMm, vMinMm: signBase, uMaxMm: primary.uLengthMm - parameters.openingInsetMm, vMaxMm: signBase + parameters.signBandHeightMm },
  });
  const blade = facades.find((surface) => surface.id === "surface:tier:0:facade:east")!;
  placements.push({
    id: "placement:blade-sign:primary", kind: "blade-sign", surfaceId: blade.id, materialId: "material:trim",
    anchor: "facade", tierIndex: 0, floorIndex: 1, bayIndex: null,
    bounds: { uMinMm: parameters.openingInsetMm, vMinMm: signBase, uMaxMm: parameters.openingInsetMm + parameters.bladeSignWidthMm, vMaxMm: signBase + parameters.bladeSignHeightMm },
  });

  // Balconies on the long faces, every `balconyFloorInterval` floors above the ground floor.
  for (const surface of facades) {
    const side = surface.id.split(":").at(-1)!;
    if (side !== "south" && side !== "north") continue;
    const tier = tiers[surface.tierIndex]!;
    for (let localFloor = 0; localFloor < tier.floorCount; localFloor += 1) {
      const globalFloor = tier.firstFloorIndex + localFloor;
      if (globalFloor === 0 || globalFloor % parameters.balconyFloorInterval !== 0) continue;
      const floorBase = localFloor * parameters.floorHeightMm;
      for (let bayIndex = 0; bayIndex < parameters.bayCount; bayIndex += 1) {
        const { start, end } = bayBounds(surface.uLengthMm, parameters.bayCount, bayIndex);
        placements.push({
          id: `placement:balcony:${surface.tierIndex}:${side}:${globalFloor}:${bayIndex}`, kind: "balcony",
          surfaceId: surface.id, materialId: "material:trim", anchor: "facade",
          tierIndex: surface.tierIndex, floorIndex: globalFloor, bayIndex,
          bounds: { uMinMm: start + parameters.openingInsetMm, vMinMm: floorBase, uMaxMm: end - parameters.openingInsetMm, vMaxMm: floorBase + parameters.balconyHeightMm },
        });
      }
    }
  }

  // One fire-escape stack per tier on the west face: a platform at every floor.
  for (const surface of facades) {
    if (!surface.id.endsWith(":facade:west")) continue;
    const tier = tiers[surface.tierIndex]!;
    for (let localFloor = 0; localFloor < tier.floorCount; localFloor += 1) {
      const globalFloor = tier.firstFloorIndex + localFloor;
      if (globalFloor === 0) continue;
      const floorBase = localFloor * parameters.floorHeightMm;
      const uMin = Number((BigInt(surface.uLengthMm) - BigInt(parameters.fireEscapeWidthMm)) / 2n);
      placements.push({
        id: `placement:fire-escape:${surface.tierIndex}:${globalFloor}`, kind: "fire-escape",
        surfaceId: surface.id, materialId: "material:metal", anchor: "facade",
        tierIndex: surface.tierIndex, floorIndex: globalFloor, bayIndex: null,
        bounds: { uMinMm: uMin, vMinMm: floorBase, uMaxMm: uMin + parameters.fireEscapeWidthMm, vMaxMm: floorBase + parameters.fireEscapePlatformHeightMm },
      });
    }
  }

  const roof = surfaces.find((surface) => surface.kind === "roof")!;
  const equipment = parameters.roofEquipmentSizeMm;
  const roofU = Number((BigInt(roof.uLengthMm) - BigInt(equipment)) / 2n);
  const roofV = Number((BigInt(roof.vLengthMm) - BigInt(equipment)) / 2n);
  placements.push({ id: "placement:roof-equipment:0", kind: "roof-equipment", surfaceId: roof.id, materialId: "material:roof", anchor: "roof", tierIndex: roof.tierIndex, floorIndex: null, bayIndex: null, bounds: { uMinMm: roofU, vMinMm: roofV, uMaxMm: roofU + equipment, vMaxMm: roofV + equipment } });
  return placements;
}

/**
 * Rooftop water tank: an even-sided prism on four legs.
 *
 * The ring is generated from integer millimetre lattice points so it stays
 * bit-reproducible; an even side count lets the caps decompose into quads for
 * the quad-only canonical GLB writer.
 */
function buildPrisms(input: V2Input, tiers: V2Tier[]): V2Prism[] {
  const parameters = input.parameters;
  const crown = tiers[tiers.length - 1]!;
  const centreX = Number((BigInt(crown.minX) + BigInt(crown.maxX)) / 2n);
  const centreY = Number((BigInt(crown.minY) + BigInt(crown.maxY)) / 2n);
  // Offset the tank away from the central roof equipment block.
  const offsetY = Number(BigInt(crown.maxY - crown.minY) / 4n);
  const tankY = centreY + offsetY;
  const sides = parameters.waterTankSides;
  const ring: Point2Mm[] = [];
  for (let index = 0; index < sides; index += 1) {
    const angle = (2 * Math.PI * index) / sides;
    ring.push([centreX + Math.round(parameters.waterTankRadiusMm * Math.cos(angle)), tankY + Math.round(parameters.waterTankRadiusMm * Math.sin(angle))]);
  }
  const legBase = crown.topZMm;
  const tankBase = legBase + parameters.waterTankLegHeightMm;
  const prisms: V2Prism[] = [{ id: "prism:water-tank:0", kind: "water-tank", materialId: "material:metal", ring, baseZMm: tankBase, topZMm: tankBase + parameters.waterTankHeightMm }];
  const legOffset = Number((BigInt(parameters.waterTankRadiusMm) * 7n) / 10n);
  const legSize = parameters.waterTankLegSizeMm;
  const half = Number(BigInt(legSize) / 2n);
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([signX, signY], index) => {
    const x = centreX + signX! * legOffset; const y = tankY + signY! * legOffset;
    prisms.push({
      id: `prism:water-tank-leg:${index}`, kind: "water-tank-leg", materialId: "material:metal",
      ring: [[x - half, y - half], [x + half, y - half], [x + half, y + half], [x - half, y + half]],
      baseZMm: legBase, topZMm: tankBase,
    });
  });
  return prisms;
}

const V2_COMPONENT_UNCERTAINTY: Partial<Record<(typeof REQUIRED_EXTERIOR_COMPONENT_KINDS)[number], string>> = {
  signage: DETERMINISTIC_FACADE_V2_SIGNAGE_UNCERTAINTY,
};

function buildInventory(input: V2Input, inputFingerprintSha256: string, parametersHashSha256: string): ExteriorComponentInventory {
  const constraintSourceIds = [...new Set(input.sourceAnchors.map((anchor) => anchor.sourceRefId))].sort(compareText);
  return {
    schemaVersion: EXTERIOR_COMPONENT_SCHEMA_VERSION,
    buildingId: input.buildingId,
    // V2 generates every required kind, so nothing is `absent`.
    components: REQUIRED_EXTERIOR_COMPONENT_KINDS.map((kind) => ({
      componentId: `${input.buildingId}:${kind}`,
      kind,
      state: "generated" as const,
      uncertainty: V2_COMPONENT_UNCERTAINTY[kind] ?? DETERMINISTIC_FACADE_V2_UNCERTAINTY,
      generator: {
        id: DETERMINISTIC_FACADE_V2_GENERATOR_ID,
        version: DETERMINISTIC_FACADE_V2_GENERATOR_VERSION,
        inputFingerprintSha256,
        parametersHashSha256,
        generatedAt: input.generatedAt,
        constraintSourceIds,
      },
    })),
  };
}

function buildPlan(input: V2Input): V2Plan {
  const inputFingerprintSha256 = domainSeparatedSha256("udt.facade.input.v2", input);
  const parametersHashSha256 = domainSeparatedSha256("udt.facade.parameters.v2", input.parameters);
  const choiceHash = domainSeparatedSha256("udt.facade.choices.v2", { inputFingerprintSha256, seed: input.seed });
  const tiers = buildTiers(input);
  const surfaces = buildSurfaces(input, tiers);
  const placements = buildPlacements(input, tiers, surfaces);
  const prisms = buildPrisms(input, tiers);
  const withoutHash: Omit<V2Plan, "planHashSha256"> = {
    schemaVersion: DETERMINISTIC_FACADE_V2_SCHEMA_VERSION,
    planId: `facade-plan-v2:${inputFingerprintSha256.slice(0, 24)}`,
    buildingId: input.buildingId,
    coordinateSystem: "local-millimeters",
    generatedAt: input.generatedAt,
    tool: { ...input.tool },
    input,
    inputFingerprintSha256,
    parametersHashSha256,
    anchors: input.sourceAnchors.map((anchor) => ({ ...anchor })),
    uncertainty: DETERMINISTIC_FACADE_V2_UNCERTAINTY,
    inventory: buildInventory(input, inputFingerprintSha256, parametersHashSha256),
    tiers,
    materials: makeMaterials(choiceHash),
    surfaces,
    placements,
    prisms,
    topology: {
      parts: tiers.map((tier) => ({ id: `part:tier:${tier.index}`, bounds: { minX: tier.minX, minY: tier.minY, minZ: tier.baseZMm, maxX: tier.maxX, maxY: tier.maxY, maxZ: tier.topZMm } })),
      closedManifold: true,
    },
  };
  return { ...withoutHash, planHashSha256: domainSeparatedSha256("udt.facade.plan.v2", withoutHash) };
}

export function calculateV2PlanHash(plan: Omit<V2Plan, "planHashSha256"> | V2Plan): string {
  const payload: Partial<V2Plan> = { ...plan };
  delete payload.planHashSha256;
  return domainSeparatedSha256("udt.facade.plan.v2", payload);
}

export function generateV2FacadePlan(value: unknown): V2Validation<V2Plan> {
  const input = validateV2Input(value);
  return input.ok ? { ok: true, value: buildPlan(input.value) } : input;
}

/** Re-derives the plan from its embedded input and rejects any non-canonical content. */
export function validateV2Plan(value: unknown): V2Validation<V2Plan> {
  const issues: V2Issue[] = [];
  if (!record(value)) return { ok: false, issues: [{ path: "$", message: "V2 facade plan must be an object." }] };
  if (value.schemaVersion !== DETERMINISTIC_FACADE_V2_SCHEMA_VERSION || value.coordinateSystem !== "local-millimeters") addIssue(issues, "schemaVersion", "Unsupported V2 plan schema or coordinate system.");
  if (!safeId(value.planId, DETERMINISTIC_FACADE_V2_LIMITS.maxPlanIdLength) || !safeId(value.buildingId)) addIssue(issues, "planId", "Plan or building identity is invalid.");
  if (!checksum(value.planHashSha256)) addIssue(issues, "planHashSha256", "Plan hash must be lowercase SHA-256.");
  if (value.uncertainty !== DETERMINISTIC_FACADE_V2_UNCERTAINTY) addIssue(issues, "uncertainty", "V2 plan uncertainty statement is fixed.");
  const inputResult = validateV2Input(value.input);
  if (!inputResult.ok) for (const issue of inputResult.issues) addIssue(issues, `input.${issue.path}`, issue.message);
  if (issues.length > 0 || !inputResult.ok) return { ok: false, issues };

  const plan = value as unknown as V2Plan;
  const expected = buildPlan(inputResult.value);
  if (plan.surfaces.length > DETERMINISTIC_FACADE_V2_LIMITS.maxSurfaces || plan.placements.length > DETERMINISTIC_FACADE_V2_LIMITS.maxPlacements || plan.prisms.length > DETERMINISTIC_FACADE_V2_LIMITS.maxPrisms) addIssue(issues, "$", "V2 plan exceeds its bounded content caps.");
  const surfaceIds = new Set(plan.surfaces.map((surface) => surface.id));
  const materialIds = new Set(plan.materials.map((material) => material.id));
  if (surfaceIds.size !== plan.surfaces.length) addIssue(issues, "surfaces", "Surface IDs must be unique.");
  if (materialIds.size !== plan.materials.length) addIssue(issues, "materials", "Material IDs must be unique.");
  const placementIds = new Set<string>();
  for (const placement of plan.placements) {
    if (placementIds.has(placement.id)) addIssue(issues, `placements.${placement.id}`, "Placement IDs must be unique.");
    placementIds.add(placement.id);
    if (!surfaceIds.has(placement.surfaceId) || !materialIds.has(placement.materialId)) addIssue(issues, `placements.${placement.id}`, "Placement surface/material references must resolve.");
  }
  for (const prism of plan.prisms) {
    if (!materialIds.has(prism.materialId)) addIssue(issues, `prisms.${prism.id}`, "Prism material must resolve.");
    if (prism.ring.length < 4 || prism.ring.length % 2 !== 0) addIssue(issues, `prisms.${prism.id}`, "Prism ring must have an even vertex count of at least four.");
    if (prism.topZMm <= prism.baseZMm) addIssue(issues, `prisms.${prism.id}`, "Prism must have positive height.");
  }
  validateSurfaceContainmentAndOverlap(plan, issues);
  // V2 admits no state other than `generated`: absence is no longer expressible.
  if (plan.inventory.components.length !== REQUIRED_EXTERIOR_COMPONENT_KINDS.length || plan.inventory.components.some((component) => component.state !== "generated")) addIssue(issues, "inventory", "V2 inventory must declare every required kind as generated.");
  if (calculateV2PlanHash(plan) !== plan.planHashSha256) addIssue(issues, "planHashSha256", "Plan hash does not match canonical content with the hash field excluded.");
  if (stableSerialize(plan) !== stableSerialize(expected)) addIssue(issues, "$", "Plan is not the canonical deterministic V2 output for its embedded input.");
  return issues.length === 0 ? { ok: true, value: plan } : { ok: false, issues };
}

/**
 * Placements must stay inside their surface and must not overlap each other.
 *
 * Without this, a placement whose v-extent overruns its surface silently emits
 * wall bands beyond the facade and phantom solid volume — a defect the glTF
 * profile cannot see and only the analytic volume identity catches.
 */
function validateSurfaceContainmentAndOverlap(plan: V2Plan, issues: V2Issue[]): void {
  const bySurface = new Map<string, V2Placement[]>();
  const surfaceById = new Map(plan.surfaces.map((surface) => [surface.id, surface]));
  for (const placement of plan.placements) {
    const surface = surfaceById.get(placement.surfaceId);
    if (!surface) continue;
    const { uMinMm, vMinMm, uMaxMm, vMaxMm } = placement.bounds;
    if (uMinMm < 0 || vMinMm < 0 || uMinMm >= uMaxMm || vMinMm >= vMaxMm) addIssue(issues, `placements.${placement.id}.bounds`, "Placement bounds must have positive area.");
    if (uMaxMm > surface.uLengthMm || vMaxMm > surface.vLengthMm) addIssue(issues, `placements.${placement.id}.bounds`, "Placement exceeds its surface bounds.");
    const bucket = bySurface.get(placement.surfaceId);
    if (bucket) bucket.push(placement); else bySurface.set(placement.surfaceId, [placement]);
  }
  for (const [surfaceId, placements] of bySurface) {
    const ordered = [...placements].sort((left, right) => left.bounds.vMinMm - right.bounds.vMinMm || left.bounds.uMinMm - right.bounds.uMinMm || compareText(left.id, right.id));
    // Sweep in v: only placements whose v-range is still open can overlap.
    const active: V2Placement[] = [];
    for (const placement of ordered) {
      for (let index = active.length - 1; index >= 0; index -= 1) if (active[index]!.bounds.vMaxMm <= placement.bounds.vMinMm) active.splice(index, 1);
      for (const other of active) {
        const overlapsU = other.bounds.uMinMm < placement.bounds.uMaxMm && placement.bounds.uMinMm < other.bounds.uMaxMm;
        const overlapsV = other.bounds.vMinMm < placement.bounds.vMaxMm && placement.bounds.vMinMm < other.bounds.vMaxMm;
        if (overlapsU && overlapsV) {
          addIssue(issues, `placements.${surfaceId}`, `Placements ${other.id} and ${placement.id} overlap.`);
          return;
        }
      }
      active.push(placement);
    }
  }
}

export function serializeV2Plan(value: unknown): V2Validation<string> {
  const validation = validateV2Plan(value);
  return validation.ok ? { ok: true, value: stableSerialize(validation.value) } : validation;
}
