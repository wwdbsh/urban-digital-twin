import type { Feature, Freshness, Geometry, LicenseRef, Position, SourceRef } from "./schema";

export const ROUTING_SCHEMA_VERSION = "1.0" as const;
export type TravelMode = "walking" | "transit";
export type RouteNodeKind = Feature["kind"];
export type RouteGeometrySemantics = "pedestrian-centerline" | "transit-schematic" | "synthetic-fixture";

export interface AccessibilityConstraints {
  avoidStairs: boolean;
  stepFreeOnly: boolean;
  maxSlopePercent: number | null;
}

export interface RouteNode {
  schemaVersion: typeof ROUTING_SCHEMA_VERSION;
  id: string;
  sourceRecordId: string;
  featureId: string;
  name: string;
  kind: RouteNodeKind;
  coordinates: Position;
  modes: TravelMode[];
  sourceRefs: SourceRef[];
  freshness: Freshness;
  uncertainty: { horizontalMeters: number | null; notes: string };
}

export interface RouteEdge {
  schemaVersion: typeof ROUTING_SCHEMA_VERSION;
  id: string;
  fromNodeId: string;
  toNodeId: string;
  modes: TravelMode[];
  distanceMeters: number;
  durationSeconds: number;
  geometry: Geometry;
  geometrySemantics: RouteGeometrySemantics;
  accessible: "yes" | "no" | "unknown";
  sourceRefs: SourceRef[];
  freshness: Freshness;
  uncertainty: { distanceMeters: number | null; durationSeconds: number | null; notes: string };
}

export interface RouteGraph {
  schemaVersion: typeof ROUTING_SCHEMA_VERSION;
  id: string;
  cityId: string;
  inputCrs: "EPSG:4326";
  outputCrs: "EPSG:4326";
  nodes: RouteNode[];
  edges: RouteEdge[];
  sourceRefs: SourceRef[];
  licenseRefs: LicenseRef[];
  freshness: Freshness;
  geometrySemantics: RouteGeometrySemantics;
  fixtureOnly: boolean;
}

export interface RouteStep {
  id: string;
  instruction: string;
  mode: TravelMode;
  fromNodeId: string;
  toNodeId: string;
  distanceMeters: number;
  durationSeconds: number;
  geometry: Geometry;
  geometrySemantics: RouteGeometrySemantics;
  sourceRefs: SourceRef[];
  uncertainty: string;
}

export interface ItineraryLeg {
  id: string;
  mode: TravelMode;
  distanceMeters: number;
  durationSeconds: number;
  steps: RouteStep[];
  geometry: Geometry;
  sourceRefs: SourceRef[];
  uncertainty: string;
}

export interface Itinerary {
  schemaVersion: typeof ROUTING_SCHEMA_VERSION;
  id: string;
  originFeatureId: string;
  destinationFeatureId: string;
  originNodeId: string;
  destinationNodeId: string;
  mode: TravelMode;
  distanceMeters: number;
  durationSeconds: number;
  legs: ItineraryLeg[];
  freshness: Freshness;
  sourceRefs: SourceRef[];
  geometrySemantics: RouteGeometrySemantics;
  uncertainty: string;
  fixtureOnly: boolean;
}

export interface SnapResult {
  featureId: string;
  nodeId: string;
  distanceMeters: number;
  uncertainty: string;
}

export interface RouteValidationIssue { path: string; message: string; }
export type RouteValidationResult<T> = { ok: true; value: T } | { ok: false; issues: RouteValidationIssue[] };

function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function position(value: unknown): value is Position { return Array.isArray(value) && (value.length === 2 || value.length === 3) && value.every(finite); }

export function validateRouteGraph(value: unknown): RouteValidationResult<RouteGraph> {
  const issues: RouteValidationIssue[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, issues: [{ path: "$", message: "Expected a RouteGraph object." }] };
  const graph = value as Record<string, unknown>;
  if (graph.schemaVersion !== ROUTING_SCHEMA_VERSION) issues.push({ path: "schemaVersion", message: "Unsupported routing schema version." });
  if (typeof graph.id !== "string" || !graph.id) issues.push({ path: "id", message: "Graph ID is required." });
  if (graph.inputCrs !== "EPSG:4326" || graph.outputCrs !== "EPSG:4326") issues.push({ path: "crs", message: "Route graph must be normalized to WGS84." });
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return { ok: false, issues: [...issues, { path: "nodes/edges", message: "Nodes and edges arrays are required." }] };
  const nodeIds = new Set<string>();
  graph.nodes.forEach((item, index) => {
    const node = item as Record<string, unknown>;
    if (typeof node.id !== "string" || !node.id || nodeIds.has(node.id)) issues.push({ path: `nodes[${index}].id`, message: "Node IDs must be non-empty and unique." });
    if (typeof node.id === "string") nodeIds.add(node.id);
    if (typeof node.featureId !== "string" || !node.featureId) issues.push({ path: `nodes[${index}].featureId`, message: "Node feature ID is required." });
    if (!position(node.coordinates)) issues.push({ path: `nodes[${index}].coordinates`, message: "Node coordinates must be WGS84 positions." });
    if (!Array.isArray(node.modes) || node.modes.some((mode) => mode !== "walking" && mode !== "transit")) issues.push({ path: `nodes[${index}].modes`, message: "Node modes must be walking or transit." });
  });
  const edgeIds = new Set<string>();
  graph.edges.forEach((item, index) => {
    const edge = item as Record<string, unknown>;
    if (typeof edge.id !== "string" || !edge.id || edgeIds.has(edge.id)) issues.push({ path: `edges[${index}].id`, message: "Edge IDs must be non-empty and unique." });
    if (typeof edge.id === "string") edgeIds.add(edge.id);
    if (typeof edge.fromNodeId !== "string" || !nodeIds.has(edge.fromNodeId)) issues.push({ path: `edges[${index}].fromNodeId`, message: "Edge origin must reference an existing node." });
    if (typeof edge.toNodeId !== "string" || !nodeIds.has(edge.toNodeId)) issues.push({ path: `edges[${index}].toNodeId`, message: "Edge destination must reference an existing node." });
    if (!Array.isArray(edge.modes) || edge.modes.length === 0 || edge.modes.some((mode) => mode !== "walking" && mode !== "transit")) issues.push({ path: `edges[${index}].modes`, message: "Edges need one or more supported travel modes." });
    if (!finite(edge.distanceMeters) || edge.distanceMeters <= 0) issues.push({ path: `edges[${index}].distanceMeters`, message: "Edge distance must be positive." });
    if (!finite(edge.durationSeconds) || edge.durationSeconds <= 0) issues.push({ path: `edges[${index}].durationSeconds`, message: "Edge duration must be positive." });
    if (edge.geometry === null || typeof edge.geometry !== "object") issues.push({ path: `edges[${index}].geometry`, message: "Edge geometry is required." });
  });
  return issues.length ? { ok: false, issues } : { ok: true, value: value as unknown as RouteGraph };
}
