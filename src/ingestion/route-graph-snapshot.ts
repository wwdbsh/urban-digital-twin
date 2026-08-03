import type { CityAdapter, Feature, Freshness, Geometry, IngestionRun, Position, Rejection, SourceRef } from "../domain/schema.ts";
import { DOMAIN_SCHEMA_VERSION } from "../domain/schema.ts";
import type { SourceRegistryEntry } from "../domain/schema.ts";
import { getSourceRegistryEntry, licenseRegistry, sourceRegistry } from "../data/source-registry.ts";
import { manhattanAdapter } from "../data/city-adapters.ts";
import { makeCanonicalFeatureId, sha256Hex } from "./offline.ts";
import type { AccessibilityConstraints, Itinerary, ItineraryLeg, RouteEdge, RouteGeometrySemantics, RouteGraph, RouteNode, RouteStep, SnapResult, TravelMode } from "../domain/routing.ts";
import { ROUTING_SCHEMA_VERSION, validateRouteGraph } from "../domain/routing.ts";

export interface RouteGraphSnapshotMetadata {
  inputFileName: string;
  inputChecksumSha256: string;
  ingestedAt: string;
  immutable: true;
  fixtureOnly: boolean;
}

export interface RouteGraphSnapshotRecord {
  sourceRegistryEntryId: string;
  provider: string;
  datasetId: string;
  termsUrl: string;
  attribution: string;
  licenseClass: string;
  inputCrs: "EPSG:4326";
  graphId: string;
  nodes?: unknown;
  edges?: unknown;
}

interface RawNode { sourceRecordId: string; featureId: string; name: string; kind: string; coordinates: unknown; modes: unknown; capturedAt?: string | null; updatedAt?: string | null; observedAt?: string | null; }
interface RawEdge { sourceRecordId: string; fromSourceRecordId: string; toSourceRecordId: string; modes: unknown; distanceMeters: unknown; durationSeconds: unknown; geometry: unknown; geometrySemantics?: string; accessible?: string; capturedAt?: string | null; updatedAt?: string | null; observedAt?: string | null; }

export interface RouteGraphIngestionReport extends IngestionRun {
  manifestVersion: typeof DOMAIN_SCHEMA_VERSION;
  sourceRegistryEntryIds: string[];
  outputCrs: "EPSG:4326";
  acceptedNodeCount: number;
  acceptedEdgeCount: number;
  rejected: Rejection[];
  rejectedRecordIndices: number[];
  allInputRecordsAccountedFor: boolean;
  graphId: string;
}

export interface RouteGraphSnapshotAdapterOptions {
  snapshotText: string;
  metadata: RouteGraphSnapshotMetadata;
  city?: CityAdapter;
  registryEntries?: readonly SourceRegistryEntry[];
}

interface Bounds { west: number; east: number; south: number; north: number; }
/** Maximum deterministic snap distance for a valid point that has no exact node link. */
export const ROUTE_SNAP_MAX_DISTANCE_METERS = 150;
/** Semantic allowlist: only place/building/stop-like destinations are routable. */
export const ROUTE_ENDPOINT_KINDS = ["building", "poi", "transit-stop", "transit-station", "transit-entrance", "fixture-point"] as const;
function isRouteEndpointKind(kind: Feature["kind"]): boolean { return (ROUTE_ENDPOINT_KINDS as readonly string[]).includes(kind); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function timestamp(value: unknown): value is string | null { return value === null || value === undefined || (typeof value === "string" && !Number.isNaN(Date.parse(value))); }
function position(value: unknown): Position | null { if (!Array.isArray(value) || (value.length !== 2 && value.length !== 3) || value.some((item) => !finite(item))) return null; const [x, y] = value as [number, number]; return x >= -180 && x <= 180 && y >= -90 && y <= 90 ? [...value] as Position : null; }
function boundsFor(city: CityAdapter): Bounds { const points = city.boundary.coordinates[0] ?? []; return { west: Math.min(...points.map(([x]) => x)), east: Math.max(...points.map(([x]) => x)), south: Math.min(...points.map(([, y]) => y)), north: Math.max(...points.map(([, y]) => y)) }; }
function inside(pointValue: Position, bounds: Bounds): boolean { return pointValue[0] >= bounds.west && pointValue[0] <= bounds.east && pointValue[1] >= bounds.south && pointValue[1] <= bounds.north; }
function clipSegment(a: Position, b: Position, bounds: Bounds): [Position, Position] | null {
  let t0 = 0; let t1 = 1; const dx = b[0] - a[0]; const dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - bounds.west], [dx, bounds.east - a[0]], [-dy, a[1] - bounds.south], [dy, bounds.north - a[1]]] as const) {
    if (p === 0 && q < 0) return null; if (p === 0) continue; const ratio = q / p;
    if (p < 0) { if (ratio > t1) return null; if (ratio > t0) t0 = ratio; } else { if (ratio < t0) return null; if (ratio < t1) t1 = ratio; }
  }
  return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
}
function clipLine(line: Position[], bounds: Bounds): Position[] | null { const output: Position[] = []; for (let index = 1; index < line.length; index += 1) { const segment = clipSegment(line[index - 1]!, line[index]!, bounds); if (!segment) continue; const [start, end] = segment; if (!output.length || output[output.length - 1]![0] !== start[0] || output[output.length - 1]![1] !== start[1]) output.push(start); output.push(end); } return output.length >= 2 ? output : null; }
function geometry(value: unknown, bounds: Bounds): Geometry | null {
  if (!isRecord(value) || (value.type !== "LineString" && value.type !== "MultiLineString")) return null;
  if (value.type === "LineString") { if (!Array.isArray(value.coordinates) || value.coordinates.length < 2) return null; const lineValue = value.coordinates.map(position); if (lineValue.some((item) => item === null)) return null; const clipped = clipLine(lineValue as Position[], bounds); return clipped ? { type: "LineString", coordinates: clipped } : null; }
  if (!Array.isArray(value.coordinates)) return null; const lines = value.coordinates.map((item) => Array.isArray(item) && item.length >= 2 ? item.map(position) : null).filter((lineValue): lineValue is Position[] => Array.isArray(lineValue) && !lineValue.some((item) => item === null)).map((lineValue) => clipLine(lineValue, bounds)).filter((item): item is Position[] => item !== null); return lines.length ? { type: "MultiLineString", coordinates: lines } : null;
}
function sourceRef(entry: SourceRegistryEntry, sourceRecordId: string, raw: { capturedAt?: string | null; updatedAt?: string | null; observedAt?: string | null }, fixtureOnly: boolean): SourceRef { return { schemaVersion: DOMAIN_SCHEMA_VERSION, id: `source-ref:${entry.id}:${sourceRecordId}`, registryEntryId: entry.id, provider: entry.provider, datasetId: entry.datasetId, sourceRecordId, sourceUrl: entry.canonicalUrl, licenseRefId: `license:${entry.id}`, role: fixtureOnly ? "fixture" : "primary", capturedAt: raw.capturedAt ?? null, updatedAt: raw.updatedAt ?? null, observedAt: raw.observedAt ?? null, release: null }; }
function freshness(raw: { capturedAt?: string | null; updatedAt?: string | null; observedAt?: string | null }, ingestedAt: string): Freshness { return { capturedAt: raw.capturedAt ?? null, updatedAt: raw.updatedAt ?? null, observedAt: raw.observedAt ?? null, ingestedAt }; }
function geometryParts(value: Geometry): Position[][] { return value.type === "LineString" ? [value.coordinates] : value.type === "MultiLineString" ? value.coordinates : []; }
function mergeGeometry(edges: RouteEdge[]): Geometry { const lines = edges.flatMap((edge) => geometryParts(edge.geometry)); return lines.length === 1 ? { type: "LineString", coordinates: lines[0]! } : { type: "MultiLineString", coordinates: lines }; }
function modeList(value: unknown): TravelMode[] | null { if (!Array.isArray(value) || value.length === 0 || value.some((item) => item !== "walking" && item !== "transit")) return null; return [...new Set(value)] as TravelMode[]; }
function graphModeSemantics(mode: TravelMode): RouteGeometrySemantics { return mode === "transit" ? "transit-schematic" : "pedestrian-centerline"; }

export class RouteGraphSnapshotAdapter {
  readonly city: CityAdapter;
  readonly fixtureOnly: boolean;
  readonly graph: RouteGraph;
  private readonly nodesById: ReadonlyMap<string, RouteNode>;
  private readonly nodesByFeatureId: ReadonlyMap<string, RouteNode>;
  private readonly edges: readonly RouteEdge[];
  private readonly report: RouteGraphIngestionReport;
  private readonly routeCache = new Map<string, Itinerary | null>();

  private constructor(graph: RouteGraph, report: RouteGraphIngestionReport, city: CityAdapter, fixtureOnly: boolean) { this.graph = graph; this.report = report; this.city = city; this.fixtureOnly = fixtureOnly; this.nodesById = new Map(graph.nodes.map((node) => [node.id, node])); this.nodesByFeatureId = new Map(graph.nodes.map((node) => [node.featureId, node])); this.edges = graph.edges; }

  static async fromSnapshot(options: RouteGraphSnapshotAdapterOptions): Promise<RouteGraphSnapshotAdapter> {
    const city = options.city ?? manhattanAdapter; const registry = options.registryEntries ?? sourceRegistry;
    if (options.metadata.immutable !== true) throw new Error("Route graph metadata must explicitly mark the local input immutable.");
    if (!/^[a-f0-9]{64}$/i.test(options.metadata.inputChecksumSha256)) throw new Error("A 64-character SHA-256 checksum is required.");
    if (await sha256Hex(options.snapshotText) !== options.metadata.inputChecksumSha256.toLowerCase()) throw new Error("Route graph checksum does not match recorded metadata.");
    let raw: RouteGraphSnapshotRecord; try { const parsed = JSON.parse(options.snapshotText) as unknown; if (!isRecord(parsed)) throw new Error("Route graph snapshot must be a JSON object."); raw = parsed as unknown as RouteGraphSnapshotRecord; } catch (error) { throw new Error(`Route graph JSON is invalid: ${error instanceof Error ? error.message : "parse error"}`, { cause: error }); }
    const entry = registry.find((candidate) => candidate.id === raw.sourceRegistryEntryId) ?? (registry === sourceRegistry ? getSourceRegistryEntry(raw.sourceRegistryEntryId) : undefined);
    if (!entry) throw new Error(`Route graph source registry entry not found: ${raw.sourceRegistryEntryId}`);
    if (entry.approval.state !== "approved") throw new Error(`Route graph source registry entry ${entry.id} is pending; approval is required before ingest.`);
    if (raw.provider !== entry.provider || raw.datasetId !== entry.datasetId || raw.termsUrl !== entry.termsUrl || !text(raw.attribution) || !text(raw.licenseClass) || raw.inputCrs !== "EPSG:4326") throw new Error("Route graph provider, dataset, terms, attribution, license and WGS84 CRS must match the approved registry entry.");
    if (!text(raw.graphId) || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) throw new Error("Route graph requires graphId, nodes and edges arrays.");
    const bounds = boundsFor(city); const rejected: Rejection[] = []; const nodes: RouteNode[] = []; const nodeBySource = new Map<string, RouteNode>(); const seenNodes = new Set<string>();
    raw.nodes.forEach((item, index) => { const node = item as RawNode; const sourceId = text(node?.sourceRecordId); const reject = (message: string) => rejected.push({ index, sourceId, code: "schema-invalid", path: `nodes[${index}]`, message }); if (!sourceId || seenNodes.has(sourceId) || !text(node.featureId) || !text(node.name) || !text(node.kind)) return reject("Node source ID, feature ID, name and kind must be unique and non-empty."); const coordinates = position(node.coordinates); const modes = modeList(node.modes); if (!coordinates || !inside(coordinates, bounds)) return rejected.push({ index, sourceId, code: "outside-slice", path: `nodes[${index}].coordinates`, message: "Node must be a WGS84 point inside the documented Manhattan slice." }); if (!modes || ![node.capturedAt, node.updatedAt, node.observedAt].every(timestamp)) return reject("Node modes and freshness fields are invalid."); const source = sourceRef(entry, sourceId, node, options.metadata.fixtureOnly); const routeNode: RouteNode = { schemaVersion: ROUTING_SCHEMA_VERSION, id: makeCanonicalFeatureId(city.cityId, "fixture-point", { provider: raw.provider, datasetId: raw.datasetId, sourceId: `node-${sourceId}` }), sourceRecordId: sourceId, featureId: node.featureId, name: node.name, kind: node.kind as RouteNode["kind"], coordinates, modes, sourceRefs: [source], freshness: freshness(node, options.metadata.ingestedAt), uncertainty: { horizontalMeters: options.metadata.fixtureOnly ? 10 : null, notes: options.metadata.fixtureOnly ? "Synthetic snap point; not a real routing node." : "Source snap uncertainty must be reviewed." } }; seenNodes.add(sourceId); nodeBySource.set(sourceId, routeNode); nodes.push(routeNode); });
    const edges: RouteEdge[] = []; const seenEdges = new Set<string>(); const offset = raw.nodes.length;
    raw.edges.forEach((item, edgeIndex) => { const edge = item as RawEdge; const index = offset + edgeIndex; const sourceId = text(edge?.sourceRecordId); const reject = (message: string, code: Rejection["code"] = "schema-invalid") => rejected.push({ index, sourceId, code, path: `edges[${edgeIndex}]`, message }); if (!sourceId || seenEdges.has(sourceId) || !text(edge.fromSourceRecordId) || !text(edge.toSourceRecordId)) return reject("Edge source ID and endpoint source IDs are required and unique."); const from = nodeBySource.get(edge.fromSourceRecordId); const to = nodeBySource.get(edge.toSourceRecordId); const modes = modeList(edge.modes); const distance = finite(edge.distanceMeters) && edge.distanceMeters > 0 ? edge.distanceMeters : null; const duration = finite(edge.durationSeconds) && edge.durationSeconds > 0 ? edge.durationSeconds : null; const edgeGeometry = geometry(edge.geometry, bounds); if (!from || !to) return reject("Edge endpoints must reference accepted nodes."); if (!modes || distance === null || duration === null || !edgeGeometry || ![edge.capturedAt, edge.updatedAt, edge.observedAt].every(timestamp)) return reject("Edge modes, positive distance/duration, clipped geometry and freshness are required."); const semantics = edge.geometrySemantics === "transit-schematic" || edge.geometrySemantics === "pedestrian-centerline" || edge.geometrySemantics === "synthetic-fixture" ? edge.geometrySemantics : graphModeSemantics(modes.includes("transit") ? "transit" : "walking"); const accessible = edge.accessible === "yes" || edge.accessible === "no" ? edge.accessible : "unknown"; const source = sourceRef(entry, sourceId, edge, options.metadata.fixtureOnly); const routeEdge: RouteEdge = { schemaVersion: ROUTING_SCHEMA_VERSION, id: makeCanonicalFeatureId(city.cityId, "street", { provider: raw.provider, datasetId: raw.datasetId, sourceId: `edge-${sourceId}` }), fromNodeId: from.id, toNodeId: to.id, modes, distanceMeters: distance, durationSeconds: duration, geometry: edgeGeometry, geometrySemantics: semantics, accessible, sourceRefs: [source], freshness: freshness(edge, options.metadata.ingestedAt), uncertainty: { distanceMeters: options.metadata.fixtureOnly ? 10 : null, durationSeconds: options.metadata.fixtureOnly ? 30 : null, notes: options.metadata.fixtureOnly ? "Synthetic distance and duration; not real travel time." : "Source travel-time uncertainty must be retained." } }; seenEdges.add(sourceId); edges.push(routeEdge); });
    const graph: RouteGraph = { schemaVersion: ROUTING_SCHEMA_VERSION, id: raw.graphId, cityId: city.cityId, inputCrs: "EPSG:4326", outputCrs: "EPSG:4326", nodes, edges, sourceRefs: [sourceRef(entry, raw.graphId, {}, options.metadata.fixtureOnly)], licenseRefs: licenseRegistry.filter((license) => license.id === `license:${entry.id}`), freshness: { capturedAt: entry.captureTimestamp, updatedAt: entry.updateTimestamp, observedAt: null, ingestedAt: options.metadata.ingestedAt }, geometrySemantics: "synthetic-fixture", fixtureOnly: options.metadata.fixtureOnly };
    const validation = validateRouteGraph(graph); if (!validation.ok) throw new Error(`Generated route graph failed validation: ${validation.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
    const rejectedRecordIndices = [...new Set(rejected.map((item) => item.index))].sort((a, b) => a - b); const run: IngestionRun = { schemaVersion: DOMAIN_SCHEMA_VERSION, runId: `route-graph:${options.metadata.inputChecksumSha256.slice(0, 16)}`, adapterId: city.id, sourceRegistryEntryId: entry.id, inputFileName: options.metadata.inputFileName, inputChecksumSha256: options.metadata.inputChecksumSha256, startedAt: options.metadata.ingestedAt, finishedAt: options.metadata.ingestedAt, immutable: true, acceptedCount: nodes.length + edges.length, rejectedCount: rejectedRecordIndices.length, sourceRecordCount: raw.nodes.length + raw.edges.length };
    const report: RouteGraphIngestionReport = { ...run, manifestVersion: DOMAIN_SCHEMA_VERSION, sourceRegistryEntryIds: [entry.id], outputCrs: "EPSG:4326", acceptedNodeCount: nodes.length, acceptedEdgeCount: edges.length, rejected, rejectedRecordIndices, allInputRecordsAccountedFor: run.acceptedCount + run.rejectedCount === run.sourceRecordCount, graphId: raw.graphId };
    return new RouteGraphSnapshotAdapter(graph, report, city, options.metadata.fixtureOnly);
  }

  getIngestionReport(): RouteGraphIngestionReport { return this.report; }
  search(query: string): RouteNode[] { const normalized = query.trim().toLowerCase(); if (!normalized) return []; return this.graph.nodes.filter((node) => [node.id, node.featureId, node.sourceRecordId, node.name].some((field) => field.toLowerCase().includes(normalized))).sort((a, b) => a.id.localeCompare(b.id)); }
  /** Resolve only an exact graph link or a nearby WGS84 Point; polygons, lines, and areas are never endpoints. */
  snapToFeature(feature: Feature): SnapResult | null {
    if (!isRouteEndpointKind(feature.kind)) return null;
    const exact = this.nodesByFeatureId.get(feature.id);
    if (exact) return { featureId: feature.id, nodeId: exact.id, distanceMeters: 0, uncertainty: exact.uncertainty.notes };
    if (feature.geometry.type !== "Point") return null;
    if (!Array.isArray(feature.geometry.coordinates) || feature.geometry.coordinates.length < 2) return null;
    const [longitude, latitude] = feature.geometry.coordinates;
    if (![longitude, latitude].every((value) => finite(value)) || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return null;
    let best: { node: RouteNode; distanceMeters: number } | null = null;
    for (const node of this.graph.nodes) {
      const distanceMeters = Math.hypot((node.coordinates[0] - longitude) * 83_000, (node.coordinates[1] - latitude) * 111_000);
      if (!best || distanceMeters < best.distanceMeters || (distanceMeters === best.distanceMeters && node.id.localeCompare(best.node.id) < 0)) best = { node, distanceMeters };
    }
    return best && best.distanceMeters <= ROUTE_SNAP_MAX_DISTANCE_METERS
      ? { featureId: feature.id, nodeId: best.node.id, distanceMeters: best.distanceMeters, uncertainty: `Synthetic snap distance ${best.distanceMeters.toFixed(1)} m; not a real sidewalk connection.` }
      : null;
  }
  canRouteFeature(feature: Feature | null | undefined, mode: TravelMode = "walking"): boolean {
    const snap = feature ? this.snapToFeature(feature) : null;
    return Boolean(snap && this.nodesById.get(snap.nodeId)?.modes.includes(mode));
  }
  route(origin: Feature, destination: Feature, mode: TravelMode, constraints: AccessibilityConstraints = { avoidStairs: false, stepFreeOnly: false, maxSlopePercent: null }): Itinerary | null { const start = this.snapToFeature(origin); const end = this.snapToFeature(destination); if (!start || !end || !this.canRouteFeature(origin, mode) || !this.canRouteFeature(destination, mode)) return null; return this.routeByNodes(start, end, origin.id, destination.id, mode, constraints); }
  routeByNodes(start: SnapResult, end: SnapResult, originFeatureId: string, destinationFeatureId: string, mode: TravelMode, constraints: AccessibilityConstraints): Itinerary | null { const startNode = this.nodesById.get(start.nodeId); const endNode = this.nodesById.get(end.nodeId); if (!startNode || !endNode || !startNode.modes.includes(mode) || !endNode.modes.includes(mode) || start.featureId !== originFeatureId || end.featureId !== destinationFeatureId) return null; const key = `${start.nodeId}|${end.nodeId}|${mode}|${constraints.avoidStairs}|${constraints.stepFreeOnly}|${constraints.maxSlopePercent ?? ""}`; if (this.routeCache.has(key)) return this.routeCache.get(key) ?? null; if (start.nodeId === end.nodeId) return null; const adjacency = new Map<string, RouteEdge[]>(); for (const edge of this.edges) { if (!edge.modes.includes(mode)) continue; if (constraints.stepFreeOnly && edge.accessible !== "yes") continue; if (constraints.avoidStairs && edge.accessible === "no") continue; adjacency.set(edge.fromNodeId, [...(adjacency.get(edge.fromNodeId) ?? []), edge]); } const queue: Array<{ nodeId: string; distance: number; duration: number; edges: RouteEdge[] }> = [{ nodeId: start.nodeId, distance: 0, duration: 0, edges: [] }]; const best = new Map<string, { distance: number; duration: number; path: string }>(); let found: RouteEdge[] | null = null; while (queue.length) { queue.sort((a, b) => a.distance - b.distance || a.duration - b.duration || a.edges.map((edge) => edge.id).join("|").localeCompare(b.edges.map((edge) => edge.id).join("|"))); const current = queue.shift()!; const path = current.edges.map((edge) => edge.id).join("|"); const prior = best.get(current.nodeId); if (prior && (prior.distance < current.distance || (prior.distance === current.distance && prior.duration <= current.duration && prior.path <= path))) continue; best.set(current.nodeId, { distance: current.distance, duration: current.duration, path }); if (current.nodeId === end.nodeId) { found = current.edges; break; } for (const edge of (adjacency.get(current.nodeId) ?? []).sort((a, b) => a.id.localeCompare(b.id))) queue.push({ nodeId: edge.toNodeId, distance: current.distance + edge.distanceMeters, duration: current.duration + edge.durationSeconds, edges: [...current.edges, edge] }); } if (!found) { this.routeCache.set(key, null); return null; } const steps: RouteStep[] = found.map((edge, index) => ({ id: `${edge.id}:step:${index}`, instruction: `${index === 0 ? "Start" : "Continue"} via synthetic ${mode} edge`, mode, fromNodeId: edge.fromNodeId, toNodeId: edge.toNodeId, distanceMeters: edge.distanceMeters, durationSeconds: edge.durationSeconds, geometry: edge.geometry, geometrySemantics: edge.geometrySemantics, sourceRefs: edge.sourceRefs, uncertainty: edge.uncertainty.notes })); const leg: ItineraryLeg = { id: `leg:${mode}:0`, mode, distanceMeters: found.reduce((sum, edge) => sum + edge.distanceMeters, 0) + start.distanceMeters + end.distanceMeters, durationSeconds: found.reduce((sum, edge) => sum + edge.durationSeconds, 0), steps, geometry: mergeGeometry(found), sourceRefs: [...new Map(found.flatMap((edge) => edge.sourceRefs).map((source) => [source.id, source])).values()], uncertainty: "Synthetic route preview; distance and duration are not real navigation estimates." }; const itinerary: Itinerary = { schemaVersion: ROUTING_SCHEMA_VERSION, id: `itinerary:${mode}:${start.nodeId}:${end.nodeId}`, originFeatureId, destinationFeatureId, originNodeId: start.nodeId, destinationNodeId: end.nodeId, mode, distanceMeters: leg.distanceMeters, durationSeconds: leg.durationSeconds, legs: [leg], geometrySemantics: graphModeSemantics(mode), sourceRefs: leg.sourceRefs, freshness: this.graph.freshness, uncertainty: `${start.uncertainty}; ${end.uncertainty}; synthetic graph only.`, fixtureOnly: this.fixtureOnly }; this.routeCache.set(key, itinerary); return itinerary; }
  cacheSize(): number { return this.routeCache.size; }
}
