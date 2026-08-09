import {
  EXTERIOR_COMPONENT_SCHEMA_VERSION,
  REQUIRED_EXTERIOR_COMPONENT_KINDS,
  validateExteriorComponentInventory,
  type ExteriorComponentInventory,
  type ExteriorComponentKind,
} from "./exterior-contract.ts";
import { domainSeparatedSha256, stableSerialize } from "./deterministic-hash.ts";

export const DETERMINISTIC_FACADE_SCHEMA_VERSION = "1.0" as const;
export const DETERMINISTIC_FACADE_GENERATOR_ID = "urban-digital-twin:deterministic-facade-plan" as const;
export const DETERMINISTIC_FACADE_GENERATOR_VERSION = "1.0.0" as const;
export const DETERMINISTIC_FACADE_LIMITS = {
  maxAnchors: 64,
  maxParts: 64,
  maxVertices: 2_048,
  maxFloors: 512,
  maxBays: 256,
  maxPlacements: 50_000,
  maxInputIdLength: 128,
  maxPlanIdLength: 256,
  maxLocalMillimeters: 1_000_000_000,
} as const;

export const DETERMINISTIC_FACADE_UNCERTAINTY = "Procedural local-millimeter representation only; it does not assert real-world facade accuracy, tenants, brands, text, or signage." as const;
export const DETERMINISTIC_SIGNAGE_ABSENCE_REASON = "No signage representation was generated; this is not a claim that real-world signage is absent." as const;

export type Point2Mm = [number, number];
export type Point3Mm = [number, number, number];

export interface FacadeSourceAnchor {
  id: string;
  kind: "footprint" | "height" | "constraint";
  sourceRefId: string;
  fingerprintSha256: string;
}

export interface FacadeGeneratorParameters {
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
}

export interface DeterministicFacadeInput {
  schemaVersion: typeof DETERMINISTIC_FACADE_SCHEMA_VERSION;
  buildingId: string;
  generatedAt: string;
  seed: string;
  tool: { id: string; version: string };
  geometry: {
    unit: "millimeter";
    footprint: { outer: Point2Mm[]; holes: [] };
    baseElevationMm: number;
    heightMm: number;
  };
  sourceAnchors: FacadeSourceAnchor[];
  parameters: FacadeGeneratorParameters;
}

export interface FacadePbrMaterial {
  id: string;
  role: "facade" | "glazing" | "trim" | "roof" | "ground";
  baseColorSrgb: [number, number, number, number];
  metallicPermille: number;
  roughnessPermille: number;
}

export interface FacadeSurface {
  id: string;
  kind: "facade" | "roof" | "ground";
  axis: "x" | "y" | "z";
  materialId: string;
  uLengthMm: number;
  vLengthMm: number;
  ring: Point3Mm[];
}

export interface FacadePlacement {
  id: string;
  kind: "window" | "entrance" | "storefront" | "cornice" | "roof-equipment";
  surfaceId: string;
  materialId: string;
  anchor: "facade" | "ground" | "roof";
  floorIndex: number | null;
  bayIndex: number | null;
  bounds: { uMinMm: number; vMinMm: number; uMaxMm: number; vMaxMm: number };
}

export interface FacadeTopology {
  parts: Array<{
    id: string;
    surfaceIds: string[];
    bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
  }>;
  adjacency: Array<[string, string]>;
  closedManifold: true;
}

export interface DeterministicFacadePlan {
  schemaVersion: typeof DETERMINISTIC_FACADE_SCHEMA_VERSION;
  planId: string;
  buildingId: string;
  coordinateSystem: "local-millimeters";
  generatedAt: string;
  tool: { id: string; version: string };
  input: DeterministicFacadeInput;
  inputFingerprintSha256: string;
  parametersHashSha256: string;
  anchors: FacadeSourceAnchor[];
  uncertainty: typeof DETERMINISTIC_FACADE_UNCERTAINTY;
  inventory: ExteriorComponentInventory;
  materials: FacadePbrMaterial[];
  surfaces: FacadeSurface[];
  placements: FacadePlacement[];
  topology: FacadeTopology;
  planHashSha256: string;
}

export interface FacadePlanIssue { path: string; message: string }
export type FacadePlanValidation<T> = { ok: true; value: T } | { ok: false; issues: FacadePlanIssue[] };

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function addIssue(issues: FacadePlanIssue[], path: string, message: string): void { issues.push({ path, message }); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string, issues: FacadePlanIssue[]): void {
  const expected = new Set(keys);
  for (const key of Object.keys(value)) if (!expected.has(key)) addIssue(issues, `${path}.${key}`, "Unexpected field.");
  for (const key of keys) if (!(key in value)) addIssue(issues, `${path}.${key}`, "Required field is missing.");
}
function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const milliseconds = Date.parse(value);
  return !Number.isNaN(milliseconds) && new Date(milliseconds).toISOString() === value;
}
function checksum(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }
function safeId(value: unknown, maximum: number = DETERMINISTIC_FACADE_LIMITS.maxInputIdLength): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && /^[A-Za-z0-9][A-Za-z0-9:._-]*$/u.test(value);
}
function safeInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function sameValue(left: unknown, right: unknown): boolean { return stableSerialize(left) === stableSerialize(right); }
function floorRatio(numerator: number, multiplier: number, denominator: number): number {
  return Number((BigInt(numerator) * BigInt(multiplier)) / BigInt(denominator));
}

function canonicalRectangle(value: unknown, path: string, issues: FacadePlanIssue[]): Point2Mm[] | null {
  if (!Array.isArray(value) || value.length !== 4) {
    addIssue(issues, path, "V1 footprint must be one unclosed four-vertex rectangle ring.");
    return null;
  }
  const points: Point2Mm[] = [];
  value.forEach((point, index) => {
    if (!Array.isArray(point) || point.length !== 2 || !safeInteger(point[0], -DETERMINISTIC_FACADE_LIMITS.maxLocalMillimeters, DETERMINISTIC_FACADE_LIMITS.maxLocalMillimeters) || !safeInteger(point[1], -DETERMINISTIC_FACADE_LIMITS.maxLocalMillimeters, DETERMINISTIC_FACADE_LIMITS.maxLocalMillimeters)) addIssue(issues, `${path}[${index}]`, "Local-mm point must contain two bounded safe integers.");
    else points.push([point[0], point[1]]);
  });
  if (points.length !== 4) return null;
  const unique = new Set(points.map(([x, y]) => `${x}:${y}`));
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const expected = new Set([`${minX}:${minY}`, `${maxX}:${minY}`, `${maxX}:${maxY}`, `${minX}:${maxY}`]);
  if (minX === maxX || minY === maxY || unique.size !== 4 || [...unique].some((point) => !expected.has(point))) {
    addIssue(issues, path, "V1 footprint must be a non-degenerate simple axis-aligned rectangle without repeated or crossing vertices.");
    return null;
  }
  return [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
}

function validateParameters(value: unknown, path: string, issues: FacadePlanIssue[]): FacadeGeneratorParameters | null {
  if (!record(value)) { addIssue(issues, path, "Generator parameters must be an object."); return null; }
  const keys = ["floorCount", "bayCount", "floorHeightMm", "windowWidthMm", "windowHeightMm", "windowSillMm", "openingInsetMm", "entranceWidthMm", "entranceHeightMm", "storefrontHeightMm", "corniceHeightMm", "roofEquipmentSizeMm"] as const;
  exactKeys(value, keys, path, issues);
  if (!safeInteger(value.floorCount, 2, DETERMINISTIC_FACADE_LIMITS.maxFloors)) addIssue(issues, `${path}.floorCount`, "Floor count is outside the V1 safe-integer cap.");
  if (!safeInteger(value.bayCount, 2, DETERMINISTIC_FACADE_LIMITS.maxBays)) addIssue(issues, `${path}.bayCount`, "Bay count is outside the V1 safe-integer cap.");
  for (const key of keys.slice(2)) if (!safeInteger(value[key], 1, DETERMINISTIC_FACADE_LIMITS.maxLocalMillimeters)) addIssue(issues, `${path}.${key}`, "Parameter must be a positive bounded safe integer in millimeters.");
  return issues.some((entry) => entry.path === path || entry.path.startsWith(`${path}.`)) ? null : value as unknown as FacadeGeneratorParameters;
}

export function validateDeterministicFacadeInput(value: unknown): FacadePlanValidation<DeterministicFacadeInput> {
  const issues: FacadePlanIssue[] = [];
  if (!record(value)) return { ok: false, issues: [{ path: "$", message: "Deterministic facade input must be an object." }] };
  exactKeys(value, ["schemaVersion", "buildingId", "generatedAt", "seed", "tool", "geometry", "sourceAnchors", "parameters"], "$", issues);
  if (value.schemaVersion !== DETERMINISTIC_FACADE_SCHEMA_VERSION) addIssue(issues, "schemaVersion", "Unsupported deterministic facade input schema.");
  if (!safeId(value.buildingId)) addIssue(issues, "buildingId", "Building ID must use bounded safe identifier characters.");
  if (!safeId(value.seed)) addIssue(issues, "seed", "Seed must use bounded safe identifier characters.");
  if (!canonicalTimestamp(value.generatedAt)) addIssue(issues, "generatedAt", "Generated time must be canonical UTC with millisecond precision.");
  if (!record(value.tool)) addIssue(issues, "tool", "Tool identity is required.");
  else {
    exactKeys(value.tool, ["id", "version"], "tool", issues);
    if (!safeId(value.tool.id) || !safeId(value.tool.version)) addIssue(issues, "tool", "Tool ID and version must be bounded safe identifiers.");
  }
  let outer: Point2Mm[] | null = null;
  let baseElevationMm: number | null = null;
  let heightMm: number | null = null;
  if (!record(value.geometry)) addIssue(issues, "geometry", "Local-mm geometry is required.");
  else {
    exactKeys(value.geometry, ["unit", "footprint", "baseElevationMm", "heightMm"], "geometry", issues);
    if (value.geometry.unit !== "millimeter") addIssue(issues, "geometry.unit", "Geometry unit must be millimeter.");
    if (!record(value.geometry.footprint)) addIssue(issues, "geometry.footprint", "Footprint object is required.");
    else {
      exactKeys(value.geometry.footprint, ["outer", "holes"], "geometry.footprint", issues);
      outer = canonicalRectangle(value.geometry.footprint.outer, "geometry.footprint.outer", issues);
      if (!Array.isArray(value.geometry.footprint.holes) || value.geometry.footprint.holes.length !== 0) addIssue(issues, "geometry.footprint.holes", "V1 rejects footprint holes.");
    }
    if (!safeInteger(value.geometry.baseElevationMm, -DETERMINISTIC_FACADE_LIMITS.maxLocalMillimeters, DETERMINISTIC_FACADE_LIMITS.maxLocalMillimeters)) addIssue(issues, "geometry.baseElevationMm", "Base elevation must be a bounded safe integer.");
    else baseElevationMm = value.geometry.baseElevationMm;
    if (!safeInteger(value.geometry.heightMm, 1, DETERMINISTIC_FACADE_LIMITS.maxLocalMillimeters)) addIssue(issues, "geometry.heightMm", "Height must be a positive bounded safe integer.");
    else heightMm = value.geometry.heightMm;
  }
  const parameters = validateParameters(value.parameters, "parameters", issues);
  const anchors: FacadeSourceAnchor[] = [];
  if (!Array.isArray(value.sourceAnchors) || value.sourceAnchors.length === 0 || value.sourceAnchors.length > DETERMINISTIC_FACADE_LIMITS.maxAnchors) addIssue(issues, "sourceAnchors", "One to 64 canonical source anchors are required.");
  else value.sourceAnchors.forEach((anchor, index) => {
    const path = `sourceAnchors[${index}]`;
    if (!record(anchor)) return addIssue(issues, path, "Source anchor must be an object.");
    exactKeys(anchor, ["id", "kind", "sourceRefId", "fingerprintSha256"], path, issues);
    if (!safeId(anchor.id) || !safeId(anchor.sourceRefId)) addIssue(issues, path, "Anchor and source-ref IDs must be bounded safe identifiers.");
    if (anchor.kind !== "footprint" && anchor.kind !== "height" && anchor.kind !== "constraint") addIssue(issues, `${path}.kind`, "Unknown source anchor kind.");
    if (!checksum(anchor.fingerprintSha256)) addIssue(issues, `${path}.fingerprintSha256`, "Anchor fingerprint must be lowercase SHA-256.");
    if (safeId(anchor.id) && safeId(anchor.sourceRefId) && (anchor.kind === "footprint" || anchor.kind === "height" || anchor.kind === "constraint") && checksum(anchor.fingerprintSha256)) anchors.push({ id: anchor.id, kind: anchor.kind, sourceRefId: anchor.sourceRefId, fingerprintSha256: anchor.fingerprintSha256 });
  });
  anchors.sort((left, right) => compareText(left.id, right.id));
  if (new Set(anchors.map((anchor) => anchor.id)).size !== anchors.length) addIssue(issues, "sourceAnchors", "Source anchor IDs must be unique.");
  if (!anchors.some((anchor) => anchor.kind === "footprint") || !anchors.some((anchor) => anchor.kind === "height")) addIssue(issues, "sourceAnchors", "V1 requires canonical footprint and height anchors.");
  if (outer && parameters && heightMm !== null) {
    const width = outer[1]![0] - outer[0]![0]; const depth = outer[3]![1] - outer[0]![1]; const minimumBay = Number(BigInt(Math.min(width, depth)) / BigInt(parameters.bayCount));
    if (width > DETERMINISTIC_FACADE_LIMITS.maxLocalMillimeters || depth > DETERMINISTIC_FACADE_LIMITS.maxLocalMillimeters) addIssue(issues, "geometry.footprint.outer", "Footprint dimensions exceed the local-mm cap.");
    if (baseElevationMm !== null && !safeInteger(baseElevationMm + heightMm, -DETERMINISTIC_FACADE_LIMITS.maxLocalMillimeters, DETERMINISTIC_FACADE_LIMITS.maxLocalMillimeters)) addIssue(issues, "geometry.heightMm", "Top elevation exceeds the local-mm cap.");
    if (BigInt(parameters.floorCount) * BigInt(parameters.floorHeightMm) !== BigInt(heightMm)) addIssue(issues, "geometry.heightMm", "Height must exactly equal floorCount times floorHeightMm.");
    if (parameters.openingInsetMm * 2 >= minimumBay) addIssue(issues, "parameters.openingInsetMm", "Opening inset leaves no usable bay width.");
    for (const [key, amount] of [["windowWidthMm", parameters.windowWidthMm], ["entranceWidthMm", parameters.entranceWidthMm]] as const) if (amount > minimumBay - parameters.openingInsetMm * 2) addIssue(issues, `parameters.${key}`, "Opening width exceeds the smallest deterministic bay.");
    if (parameters.windowSillMm + parameters.windowHeightMm + parameters.corniceHeightMm > parameters.floorHeightMm) addIssue(issues, "parameters.windowHeightMm", "Window and cornice vertical bounds overlap.");
    if (parameters.entranceHeightMm > parameters.floorHeightMm || parameters.storefrontHeightMm > parameters.floorHeightMm) addIssue(issues, "parameters", "Ground opening height exceeds the first floor.");
    if (parameters.roofEquipmentSizeMm > Math.min(width, depth)) addIssue(issues, "parameters.roofEquipmentSizeMm", "Roof equipment exceeds the footprint.");
    const placementCount = 4 * (parameters.floorCount - 1) * parameters.bayCount + parameters.bayCount + 5;
    if (placementCount > DETERMINISTIC_FACADE_LIMITS.maxPlacements) addIssue(issues, "parameters", "Parameters exceed the 50,000-placement cap.");
  }
  if (issues.length > 0 || !outer || baseElevationMm === null || heightMm === null || !parameters || !record(value.tool) || !safeId(value.buildingId) || !safeId(value.seed) || !canonicalTimestamp(value.generatedAt)) return { ok: false, issues };
  const canonical: DeterministicFacadeInput = {
    schemaVersion: DETERMINISTIC_FACADE_SCHEMA_VERSION,
    buildingId: value.buildingId,
    generatedAt: value.generatedAt,
    seed: value.seed,
    tool: { id: value.tool.id as string, version: value.tool.version as string },
    geometry: { unit: "millimeter", footprint: { outer, holes: [] }, baseElevationMm, heightMm },
    sourceAnchors: anchors,
    parameters,
  };
  return { ok: true, value: canonical };
}

const COLORS: ReadonlyArray<readonly [number, number, number, number]> = [
  [184, 96, 68, 255], [215, 178, 112, 255], [104, 128, 142, 255], [168, 155, 139, 255],
  [86, 112, 92, 255], [128, 92, 118, 255], [202, 204, 196, 255], [66, 76, 88, 255],
];
const ABSENT_KINDS = new Set<ExteriorComponentKind>(["balconies", "fire-escapes", "water-tanks", "signage"]);

function buildInventory(input: DeterministicFacadeInput, inputFingerprintSha256: string, parametersHashSha256: string): ExteriorComponentInventory {
  const constraintSourceIds = [...new Set(input.sourceAnchors.map((anchor) => anchor.sourceRefId))].sort(compareText);
  return {
    schemaVersion: EXTERIOR_COMPONENT_SCHEMA_VERSION,
    buildingId: input.buildingId,
    components: REQUIRED_EXTERIOR_COMPONENT_KINDS.map((kind) => ABSENT_KINDS.has(kind) ? {
      componentId: `${input.buildingId}:${kind}`,
      kind,
      state: "absent" as const,
      representation: "none" as const,
      reason: kind === "signage" ? DETERMINISTIC_SIGNAGE_ABSENCE_REASON : `No ${kind} representation was generated; this is not a claim that the real building lacks it.`,
      uncertainty: DETERMINISTIC_FACADE_UNCERTAINTY,
    } : {
      componentId: `${input.buildingId}:${kind}`,
      kind,
      state: "generated" as const,
      uncertainty: DETERMINISTIC_FACADE_UNCERTAINTY,
      generator: {
        id: DETERMINISTIC_FACADE_GENERATOR_ID,
        version: DETERMINISTIC_FACADE_GENERATOR_VERSION,
        inputFingerprintSha256,
        parametersHashSha256,
        generatedAt: input.generatedAt,
        constraintSourceIds,
      },
    }),
  };
}

function makeMaterials(choiceHash: string): FacadePbrMaterial[] {
  const start = Number.parseInt(choiceHash.slice(0, 8), 16) % COLORS.length;
  const color = (offset: number): [number, number, number, number] => [...COLORS[(start + offset) % COLORS.length]!] as [number, number, number, number];
  return [
    { id: "material:facade:0", role: "facade", baseColorSrgb: color(0), metallicPermille: 0, roughnessPermille: 760 },
    { id: "material:facade:1", role: "facade", baseColorSrgb: color(1), metallicPermille: 0, roughnessPermille: 700 },
    { id: "material:glazing", role: "glazing", baseColorSrgb: color(2), metallicPermille: 80, roughnessPermille: 180 },
    { id: "material:trim", role: "trim", baseColorSrgb: color(3), metallicPermille: 0, roughnessPermille: 620 },
    { id: "material:roof", role: "roof", baseColorSrgb: color(4), metallicPermille: 120, roughnessPermille: 820 },
    { id: "material:ground", role: "ground", baseColorSrgb: color(5), metallicPermille: 0, roughnessPermille: 900 },
  ];
}

function buildSurfaces(input: DeterministicFacadeInput): FacadeSurface[] {
  const [southWest, southEast, , northWest] = input.geometry.footprint.outer;
  const [minX, minY] = southWest!; const [maxX] = southEast!; const [, maxY] = northWest!;
  const minZ = input.geometry.baseElevationMm; const maxZ = minZ + input.geometry.heightMm;
  const width = maxX - minX; const depth = maxY - minY;
  return [
    { id: "surface:facade:south", kind: "facade", axis: "y", materialId: "material:facade:0", uLengthMm: width, vLengthMm: input.geometry.heightMm, ring: [[minX, minY, minZ], [maxX, minY, minZ], [maxX, minY, maxZ], [minX, minY, maxZ]] },
    { id: "surface:facade:east", kind: "facade", axis: "x", materialId: "material:facade:1", uLengthMm: depth, vLengthMm: input.geometry.heightMm, ring: [[maxX, minY, minZ], [maxX, maxY, minZ], [maxX, maxY, maxZ], [maxX, minY, maxZ]] },
    { id: "surface:facade:north", kind: "facade", axis: "y", materialId: "material:facade:0", uLengthMm: width, vLengthMm: input.geometry.heightMm, ring: [[maxX, maxY, minZ], [minX, maxY, minZ], [minX, maxY, maxZ], [maxX, maxY, maxZ]] },
    { id: "surface:facade:west", kind: "facade", axis: "x", materialId: "material:facade:1", uLengthMm: depth, vLengthMm: input.geometry.heightMm, ring: [[minX, maxY, minZ], [minX, minY, minZ], [minX, minY, maxZ], [minX, maxY, maxZ]] },
    { id: "surface:ground", kind: "ground", axis: "z", materialId: "material:ground", uLengthMm: width, vLengthMm: depth, ring: [[minX, maxY, minZ], [maxX, maxY, minZ], [maxX, minY, minZ], [minX, minY, minZ]] },
    { id: "surface:roof", kind: "roof", axis: "z", materialId: "material:roof", uLengthMm: width, vLengthMm: depth, ring: [[minX, minY, maxZ], [maxX, minY, maxZ], [maxX, maxY, maxZ], [minX, maxY, maxZ]] },
  ];
}

function buildPlacements(input: DeterministicFacadeInput, surfaces: readonly FacadeSurface[]): FacadePlacement[] {
  const parameters = input.parameters; const placements: FacadePlacement[] = [];
  const facades = surfaces.filter((surface) => surface.kind === "facade");
  for (const surface of facades) {
    for (let floorIndex = 1; floorIndex < parameters.floorCount; floorIndex += 1) for (let bayIndex = 0; bayIndex < parameters.bayCount; bayIndex += 1) {
      const bayStart = floorRatio(bayIndex, surface.uLengthMm, parameters.bayCount);
      const bayEnd = floorRatio(bayIndex + 1, surface.uLengthMm, parameters.bayCount);
      const center = Number((BigInt(bayStart) + BigInt(bayEnd)) / 2n); const half = Number(BigInt(parameters.windowWidthMm) / 2n);
      const floorStart = floorIndex * parameters.floorHeightMm;
      placements.push({ id: `placement:window:${surface.id.slice(15)}:${floorIndex}:${bayIndex}`, kind: "window", surfaceId: surface.id, materialId: "material:glazing", anchor: "facade", floorIndex, bayIndex, bounds: { uMinMm: center - half, vMinMm: floorStart + parameters.windowSillMm, uMaxMm: center - half + parameters.windowWidthMm, vMaxMm: floorStart + parameters.windowSillMm + parameters.windowHeightMm } });
    }
    placements.push({ id: `placement:cornice:${surface.id.slice(15)}`, kind: "cornice", surfaceId: surface.id, materialId: "material:trim", anchor: "facade", floorIndex: parameters.floorCount - 1, bayIndex: null, bounds: { uMinMm: 0, vMinMm: surface.vLengthMm - parameters.corniceHeightMm, uMaxMm: surface.uLengthMm, vMaxMm: surface.vLengthMm } });
  }
  const primary = facades[0]!;
  for (let bayIndex = 0; bayIndex < parameters.bayCount; bayIndex += 1) {
    const bayStart = floorRatio(bayIndex, primary.uLengthMm, parameters.bayCount); const bayEnd = floorRatio(bayIndex + 1, primary.uLengthMm, parameters.bayCount);
    if (bayIndex === 0) {
      const center = Number((BigInt(bayStart) + BigInt(bayEnd)) / 2n); const half = Number(BigInt(parameters.entranceWidthMm) / 2n);
      placements.push({ id: "placement:entrance:primary", kind: "entrance", surfaceId: primary.id, materialId: "material:trim", anchor: "ground", floorIndex: 0, bayIndex, bounds: { uMinMm: center - half, vMinMm: 0, uMaxMm: center - half + parameters.entranceWidthMm, vMaxMm: parameters.entranceHeightMm } });
    } else placements.push({ id: `placement:storefront:${bayIndex}`, kind: "storefront", surfaceId: primary.id, materialId: "material:glazing", anchor: "ground", floorIndex: 0, bayIndex, bounds: { uMinMm: bayStart + parameters.openingInsetMm, vMinMm: 0, uMaxMm: bayEnd - parameters.openingInsetMm, vMaxMm: parameters.storefrontHeightMm } });
  }
  const roof = surfaces.find((surface) => surface.kind === "roof")!; const equipment = parameters.roofEquipmentSizeMm;
  const roofU = Number((BigInt(roof.uLengthMm) - BigInt(equipment)) / 2n); const roofV = Number((BigInt(roof.vLengthMm) - BigInt(equipment)) / 2n);
  placements.push({ id: "placement:roof-equipment:0", kind: "roof-equipment", surfaceId: roof.id, materialId: "material:roof", anchor: "roof", floorIndex: null, bayIndex: null, bounds: { uMinMm: roofU, vMinMm: roofV, uMaxMm: roofU + equipment, vMaxMm: roofV + equipment } });
  return placements;
}

function buildPlan(input: DeterministicFacadeInput): DeterministicFacadePlan {
  const inputFingerprintSha256 = domainSeparatedSha256("udt.facade.input.v1", input);
  const parametersHashSha256 = domainSeparatedSha256("udt.facade.parameters.v1", input.parameters);
  const choiceHash = domainSeparatedSha256("udt.facade.choices.v1", { inputFingerprintSha256, seed: input.seed });
  const surfaces = buildSurfaces(input);
  const [southWest, southEast, , northWest] = input.geometry.footprint.outer;
  const [minX, minY] = southWest!; const [maxX] = southEast!; const [, maxY] = northWest!;
  const withoutHash: Omit<DeterministicFacadePlan, "planHashSha256"> = {
    schemaVersion: DETERMINISTIC_FACADE_SCHEMA_VERSION,
    planId: `facade-plan:${inputFingerprintSha256.slice(0, 24)}`,
    buildingId: input.buildingId,
    coordinateSystem: "local-millimeters",
    generatedAt: input.generatedAt,
    tool: { ...input.tool },
    input,
    inputFingerprintSha256,
    parametersHashSha256,
    anchors: input.sourceAnchors.map((anchor) => ({ ...anchor })),
    uncertainty: DETERMINISTIC_FACADE_UNCERTAINTY,
    inventory: buildInventory(input, inputFingerprintSha256, parametersHashSha256),
    materials: makeMaterials(choiceHash),
    surfaces,
    placements: buildPlacements(input, surfaces),
    topology: {
      parts: [{ id: "part:building", surfaceIds: surfaces.map((surface) => surface.id), bounds: { minX, minY, minZ: input.geometry.baseElevationMm, maxX, maxY, maxZ: input.geometry.baseElevationMm + input.geometry.heightMm } }],
      adjacency: [["surface:facade:south", "surface:facade:east"], ["surface:facade:east", "surface:facade:north"], ["surface:facade:north", "surface:facade:west"], ["surface:facade:west", "surface:facade:south"]],
      closedManifold: true,
    },
  };
  return { ...withoutHash, planHashSha256: domainSeparatedSha256("udt.facade.plan.v1", withoutHash) };
}

export function generateDeterministicFacadePlan(value: unknown): FacadePlanValidation<DeterministicFacadePlan> {
  const input = validateDeterministicFacadeInput(value);
  return input.ok ? { ok: true, value: buildPlan(input.value) } : input;
}

function validateMaterial(value: unknown, path: string, issues: FacadePlanIssue[]): void {
  if (!record(value)) return addIssue(issues, path, "PBR material must be an object.");
  exactKeys(value, ["id", "role", "baseColorSrgb", "metallicPermille", "roughnessPermille"], path, issues);
  if (!safeId(value.id, DETERMINISTIC_FACADE_LIMITS.maxPlanIdLength)) addIssue(issues, `${path}.id`, "Material ID is invalid or oversized.");
  if (!["facade", "glazing", "trim", "roof", "ground"].includes(String(value.role))) addIssue(issues, `${path}.role`, "Unknown material role.");
  if (!Array.isArray(value.baseColorSrgb) || value.baseColorSrgb.length !== 4 || value.baseColorSrgb.some((channel) => !safeInteger(channel, 0, 255))) addIssue(issues, `${path}.baseColorSrgb`, "sRGB color must contain four integer bytes.");
  if (!safeInteger(value.metallicPermille, 0, 1_000) || !safeInteger(value.roughnessPermille, 0, 1_000)) addIssue(issues, path, "PBR factors must be integer permille values.");
}

function validateSurface(value: unknown, path: string, issues: FacadePlanIssue[]): void {
  if (!record(value)) return addIssue(issues, path, "Surface must be an object.");
  exactKeys(value, ["id", "kind", "axis", "materialId", "uLengthMm", "vLengthMm", "ring"], path, issues);
  if (!safeId(value.id, DETERMINISTIC_FACADE_LIMITS.maxPlanIdLength) || !safeId(value.materialId, DETERMINISTIC_FACADE_LIMITS.maxPlanIdLength)) addIssue(issues, path, "Surface and material IDs must be bounded and safe.");
  if (!["facade", "roof", "ground"].includes(String(value.kind)) || !["x", "y", "z"].includes(String(value.axis))) addIssue(issues, path, "Surface kind or axis is invalid.");
  if (!safeInteger(value.uLengthMm, 1, DETERMINISTIC_FACADE_LIMITS.maxLocalMillimeters) || !safeInteger(value.vLengthMm, 1, DETERMINISTIC_FACADE_LIMITS.maxLocalMillimeters)) addIssue(issues, path, "Surface dimensions must be positive bounded integers.");
  if (!Array.isArray(value.ring) || value.ring.length !== 4) addIssue(issues, `${path}.ring`, "Surface must use a canonical unclosed four-vertex ring.");
  else {
    const points = value.ring;
    for (const [index, point] of points.entries()) if (!Array.isArray(point) || point.length !== 3 || point.some((coordinate) => !safeInteger(coordinate, -DETERMINISTIC_FACADE_LIMITS.maxLocalMillimeters, DETERMINISTIC_FACADE_LIMITS.maxLocalMillimeters))) addIssue(issues, `${path}.ring[${index}]`, "Surface coordinates must be bounded local-mm safe integers.");
    if (points.every((point) => Array.isArray(point) && point.length === 3)) {
      const strings = points.map((point) => point.join(":"));
      if (new Set(strings).size !== 4) addIssue(issues, `${path}.ring`, "Surface ring cannot repeat vertices.");
      const axis = value.axis === "x" ? 0 : value.axis === "y" ? 1 : 2;
      if (!points.every((point) => point[axis] === points[0]![axis])) addIssue(issues, `${path}.ring`, "Surface ring must lie on its declared axis plane.");
    }
  }
}

function validatePlacement(value: unknown, path: string, issues: FacadePlanIssue[]): void {
  if (!record(value)) return addIssue(issues, path, "Placement must be an object.");
  exactKeys(value, ["id", "kind", "surfaceId", "materialId", "anchor", "floorIndex", "bayIndex", "bounds"], path, issues);
  for (const field of ["id", "surfaceId", "materialId"] as const) if (!safeId(value[field], DETERMINISTIC_FACADE_LIMITS.maxPlanIdLength)) addIssue(issues, `${path}.${field}`, "Placement identity is invalid or oversized.");
  if (!["window", "entrance", "storefront", "cornice", "roof-equipment"].includes(String(value.kind)) || !["facade", "ground", "roof"].includes(String(value.anchor))) addIssue(issues, path, "Placement kind or anchor is invalid.");
  for (const field of ["floorIndex", "bayIndex"] as const) if (value[field] !== null && !safeInteger(value[field], 0, field === "floorIndex" ? DETERMINISTIC_FACADE_LIMITS.maxFloors - 1 : DETERMINISTIC_FACADE_LIMITS.maxBays - 1)) addIssue(issues, `${path}.${field}`, "Placement index is invalid.");
  if (!record(value.bounds)) addIssue(issues, `${path}.bounds`, "Placement bounds are required.");
  else {
    exactKeys(value.bounds, ["uMinMm", "vMinMm", "uMaxMm", "vMaxMm"], `${path}.bounds`, issues);
    for (const field of ["uMinMm", "vMinMm", "uMaxMm", "vMaxMm"] as const) if (!safeInteger(value.bounds[field], 0, DETERMINISTIC_FACADE_LIMITS.maxLocalMillimeters)) addIssue(issues, `${path}.bounds.${field}`, "Placement bound must be a non-negative bounded safe integer.");
    if (typeof value.bounds.uMinMm === "number" && typeof value.bounds.uMaxMm === "number" && value.bounds.uMinMm >= value.bounds.uMaxMm || typeof value.bounds.vMinMm === "number" && typeof value.bounds.vMaxMm === "number" && value.bounds.vMinMm >= value.bounds.vMaxMm) addIssue(issues, `${path}.bounds`, "Placement bounds must have positive area.");
  }
}

function overlaps(left: FacadePlacement["bounds"], right: FacadePlacement["bounds"]): boolean {
  return left.uMinMm < right.uMaxMm && right.uMinMm < left.uMaxMm && left.vMinMm < right.vMaxMm && right.vMinMm < left.vMaxMm;
}

export function calculateDeterministicFacadePlanHash(plan: Omit<DeterministicFacadePlan, "planHashSha256"> | DeterministicFacadePlan): string {
  const payload: Partial<DeterministicFacadePlan> = { ...plan };
  delete payload.planHashSha256;
  return domainSeparatedSha256("udt.facade.plan.v1", payload);
}

export function validateDeterministicFacadePlan(value: unknown): FacadePlanValidation<DeterministicFacadePlan> {
  const issues: FacadePlanIssue[] = [];
  if (!record(value)) return { ok: false, issues: [{ path: "$", message: "Deterministic facade plan must be an object." }] };
  const keys = ["schemaVersion", "planId", "buildingId", "coordinateSystem", "generatedAt", "tool", "input", "inputFingerprintSha256", "parametersHashSha256", "anchors", "uncertainty", "inventory", "materials", "surfaces", "placements", "topology", "planHashSha256"] as const;
  exactKeys(value, keys, "$", issues);
  if (value.schemaVersion !== DETERMINISTIC_FACADE_SCHEMA_VERSION || value.coordinateSystem !== "local-millimeters") addIssue(issues, "schemaVersion", "Unsupported plan schema or coordinate system.");
  if (!safeId(value.planId, DETERMINISTIC_FACADE_LIMITS.maxPlanIdLength) || !safeId(value.buildingId)) addIssue(issues, "planId", "Plan/building identity is invalid or oversized.");
  if (!canonicalTimestamp(value.generatedAt)) addIssue(issues, "generatedAt", "Plan time must be canonical UTC.");
  if (!record(value.tool)) addIssue(issues, "tool", "Plan tool identity is required.");
  else {
    exactKeys(value.tool, ["id", "version"], "tool", issues);
    if (!safeId(value.tool.id) || !safeId(value.tool.version)) addIssue(issues, "tool", "Plan tool ID/version is invalid or oversized.");
  }
  if (!checksum(value.inputFingerprintSha256) || !checksum(value.parametersHashSha256) || !checksum(value.planHashSha256)) addIssue(issues, "planHashSha256", "Plan hashes must be lowercase SHA-256.");
  if (value.uncertainty !== DETERMINISTIC_FACADE_UNCERTAINTY) addIssue(issues, "uncertainty", "Plan uncertainty statement is fixed by V1.");
  const inputResult = validateDeterministicFacadeInput(value.input);
  if (!inputResult.ok) for (const entry of inputResult.issues) addIssue(issues, entry.path === "$" ? "input" : `input.${entry.path}`, entry.message);
  if (!Array.isArray(value.anchors)) addIssue(issues, "anchors", "Canonical anchors are required.");
  const inventoryResult = validateExteriorComponentInventory(value.inventory);
  if (!inventoryResult.ok) for (const entry of inventoryResult.issues) addIssue(issues, entry.path === "$" ? "inventory" : `inventory.${entry.path}`, entry.message);
  if (!Array.isArray(value.materials) || value.materials.length !== 6) addIssue(issues, "materials", "V1 requires the exact six-material PBR palette.");
  else value.materials.forEach((material, index) => validateMaterial(material, `materials[${index}]`, issues));
  if (!Array.isArray(value.surfaces) || value.surfaces.length !== 6) addIssue(issues, "surfaces", "V1 requires four facades, one ground, and one roof surface.");
  else {
    value.surfaces.forEach((surface, index) => validateSurface(surface, `surfaces[${index}]`, issues));
    const vertices = value.surfaces.reduce((sum, surface) => sum + (record(surface) && Array.isArray(surface.ring) ? surface.ring.length : 0), 0);
    if (vertices > DETERMINISTIC_FACADE_LIMITS.maxVertices) addIssue(issues, "surfaces", "Surface vertices exceed the 2,048-vertex cap.");
  }
  if (!Array.isArray(value.placements) || value.placements.length > DETERMINISTIC_FACADE_LIMITS.maxPlacements) addIssue(issues, "placements", "Placements must stay within the 50,000 cap.");
  else value.placements.forEach((placement, index) => validatePlacement(placement, `placements[${index}]`, issues));
  if (!record(value.topology)) addIssue(issues, "topology", "Topology is required.");
  else {
    exactKeys(value.topology, ["parts", "adjacency", "closedManifold"], "topology", issues);
    if (!Array.isArray(value.topology.parts) || value.topology.parts.length === 0 || value.topology.parts.length > DETERMINISTIC_FACADE_LIMITS.maxParts) addIssue(issues, "topology.parts", "Topology must contain one to 64 parts.");
    else value.topology.parts.forEach((part, index) => {
      const path = `topology.parts[${index}]`;
      if (!record(part)) return addIssue(issues, path, "Topology part must be an object.");
      exactKeys(part, ["id", "surfaceIds", "bounds"], path, issues);
      if (!safeId(part.id, DETERMINISTIC_FACADE_LIMITS.maxPlanIdLength)) addIssue(issues, `${path}.id`, "Topology part ID is invalid or oversized.");
      if (!Array.isArray(part.surfaceIds) || part.surfaceIds.length === 0 || part.surfaceIds.some((id) => !safeId(id, DETERMINISTIC_FACADE_LIMITS.maxPlanIdLength))) addIssue(issues, `${path}.surfaceIds`, "Topology part surface IDs are required.");
      if (!record(part.bounds)) addIssue(issues, `${path}.bounds`, "Topology part bounds are required.");
      else {
        const fields = ["minX", "minY", "minZ", "maxX", "maxY", "maxZ"] as const;
        exactKeys(part.bounds, fields, `${path}.bounds`, issues);
        for (const field of fields) if (!safeInteger(part.bounds[field], -DETERMINISTIC_FACADE_LIMITS.maxLocalMillimeters, DETERMINISTIC_FACADE_LIMITS.maxLocalMillimeters)) addIssue(issues, `${path}.bounds.${field}`, "Topology bounds must be local-mm safe integers.");
        if (typeof part.bounds.minX === "number" && typeof part.bounds.maxX === "number" && part.bounds.minX >= part.bounds.maxX || typeof part.bounds.minY === "number" && typeof part.bounds.maxY === "number" && part.bounds.minY >= part.bounds.maxY || typeof part.bounds.minZ === "number" && typeof part.bounds.maxZ === "number" && part.bounds.minZ >= part.bounds.maxZ) addIssue(issues, `${path}.bounds`, "Topology bounds must have positive volume.");
      }
    });
    if (!Array.isArray(value.topology.adjacency)) addIssue(issues, "topology.adjacency", "Topology adjacency is required.");
    else value.topology.adjacency.forEach((edge, index) => {
      if (!Array.isArray(edge) || edge.length !== 2 || !safeId(edge[0], DETERMINISTIC_FACADE_LIMITS.maxPlanIdLength) || !safeId(edge[1], DETERMINISTIC_FACADE_LIMITS.maxPlanIdLength) || edge[0] === edge[1]) addIssue(issues, `topology.adjacency[${index}]`, "Adjacency edge requires two distinct bounded surface IDs.");
    });
    if (value.topology.closedManifold !== true) addIssue(issues, "topology.closedManifold", "Topology must declare a closed manifold.");
  }
  if (issues.length > 0 || !inputResult.ok || !inventoryResult.ok) return { ok: false, issues };
  const plan = value as unknown as DeterministicFacadePlan;
  const materialIds = new Set(plan.materials.map((material) => material.id)); const surfaceIds = new Set(plan.surfaces.map((surface) => surface.id));
  if (materialIds.size !== plan.materials.length || new Set(plan.materials.map((material) => stableSerialize(material.baseColorSrgb))).size !== plan.materials.length) addIssue(issues, "materials", "Material IDs and palette colors must be distinct.");
  if (surfaceIds.size !== plan.surfaces.length) addIssue(issues, "surfaces", "Surface IDs must be unique.");
  for (const surface of plan.surfaces) if (!materialIds.has(surface.materialId)) addIssue(issues, `surfaces.${surface.id}.materialId`, "Surface material does not resolve.");
  for (let index = 0; index < 4; index += 1) if (plan.surfaces[index]!.materialId === plan.surfaces[(index + 1) % 4]!.materialId) addIssue(issues, "surfaces", "Adjacent facade surfaces cannot repeat a material.");
  const placementIds = new Set<string>();
  for (const placement of plan.placements) {
    if (placementIds.has(placement.id)) addIssue(issues, `placements.${placement.id}`, "Placement IDs must be unique.");
    placementIds.add(placement.id);
    const surface = plan.surfaces.find((candidate) => candidate.id === placement.surfaceId);
    if (!surface || !materialIds.has(placement.materialId)) addIssue(issues, `placements.${placement.id}`, "Placement surface/material references must resolve.");
    else {
      if (placement.bounds.uMaxMm > surface.uLengthMm || placement.bounds.vMaxMm > surface.vLengthMm) addIssue(issues, `placements.${placement.id}.bounds`, "Placement exceeds its surface bounds.");
      if ((placement.kind === "entrance" || placement.kind === "storefront") && (placement.anchor !== "ground" || placement.bounds.vMinMm !== 0 || surface.kind !== "facade")) addIssue(issues, `placements.${placement.id}.anchor`, "Ground openings must anchor to facade ground.");
      if (placement.kind === "roof-equipment" && (placement.anchor !== "roof" || surface.kind !== "roof")) addIssue(issues, `placements.${placement.id}.anchor`, "Roof equipment must anchor to the roof.");
    }
  }
  for (let leftIndex = 0; leftIndex < plan.placements.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < plan.placements.length; rightIndex += 1) {
    const left = plan.placements[leftIndex]!; const right = plan.placements[rightIndex]!;
    if (left.surfaceId === right.surfaceId && overlaps(left.bounds, right.bounds)) addIssue(issues, "placements", `Placements ${left.id} and ${right.id} overlap.`);
  }
  const ownedSurfaces = plan.topology.parts.flatMap((part) => part.surfaceIds);
  if (plan.topology.parts.length > DETERMINISTIC_FACADE_LIMITS.maxParts || new Set(plan.topology.parts.map((part) => part.id)).size !== plan.topology.parts.length || new Set(ownedSurfaces).size !== ownedSurfaces.length || !sameValue([...ownedSurfaces].sort(compareText), [...surfaceIds].sort(compareText))) addIssue(issues, "topology.parts", "Topology parts must uniquely own every surface exactly once.");
  for (let left = 0; left < plan.topology.parts.length; left += 1) for (let right = left + 1; right < plan.topology.parts.length; right += 1) {
    const a = plan.topology.parts[left]!.bounds; const b = plan.topology.parts[right]!.bounds;
    if (a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY && a.minZ < b.maxZ && b.minZ < a.maxZ) addIssue(issues, "topology.parts", "Topology part volumes cannot overlap.");
  }
  const expected = buildPlan(inputResult.value);
  if (!sameValue(plan.anchors, inputResult.value.sourceAnchors)) addIssue(issues, "anchors", "Plan anchors must use canonical input order.");
  if (plan.inventory.components.some((component) => component.state !== "generated" && component.state !== "absent")) addIssue(issues, "inventory", "V1 inventory permits generated or absent states only.");
  if (calculateDeterministicFacadePlanHash(plan) !== plan.planHashSha256) addIssue(issues, "planHashSha256", "Plan hash does not match canonical content with the hash field excluded.");
  if (!sameValue(plan, expected)) addIssue(issues, "$", "Plan is not the canonical deterministic output for its embedded input.");
  return issues.length === 0 ? { ok: true, value: plan } : { ok: false, issues };
}

export function serializeDeterministicFacadePlan(value: unknown): FacadePlanValidation<string> {
  const validation = validateDeterministicFacadePlan(value);
  return validation.ok ? { ok: true, value: stableSerialize(validation.value) } : validation;
}
