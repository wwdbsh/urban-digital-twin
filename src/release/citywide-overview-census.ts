/**
 * Derivations for the citywide overview-tier census (Task T001).
 *
 * T001 is a measurement-and-decision task: its deliverable is an evidence-backed
 * DESIGN DECISION for an island-wide overview representation, not a mass build.
 * This module holds the pure derivations that decision rests on, so every number
 * in ADR 0040 is re-derivable from committed code rather than quoted from a
 * one-off script:
 *
 *   - integer distributions (ring vertex counts, effective tier counts);
 *   - per-cell RENDER extents, which the ledger deliberately does not commit;
 *   - the overhang measure ADR 0024 reported in prose and never committed code
 *     for.
 *
 * The I/O — reading the pinned snapshot, walking the ledger, running the V3
 * plan stage — lives in `scripts/citywide-overview-census-cli.mjs`. Everything
 * here is a function of its arguments and is unit-tested on synthetic fixtures,
 * including a fixture built to reproduce ADR 0024's 248 m overhang case.
 */
import { EXTERIOR_FULLSNAPSHOT_PROJECTION } from "../domain/exterior-fullsnapshot-input.ts";
import type { Wgs84Bounds } from "./exterior-release.ts";

export const CITYWIDE_OVERVIEW_CENSUS_SCHEMA_VERSION = "1.0" as const;

/**
 * The metric ADR 0024's overhang figures are re-derived under.
 *
 * ADR 0024 states "9,944 of 45,194 buildings have at least one footprint vertex
 * outside their assigned cell rectangle" and "the maximum overhang … is 248.2 m
 * (doitt:308707)", but it committed no code for either, so the convention was
 * only ever implicit. This is the convention this census uses, named so a
 * re-derivation that lands somewhere else is a disagreement about a stated rule
 * rather than an unexplained discrepancy:
 *
 *   - a vertex is OUTSIDE when it is strictly outside the closed assignment
 *     rectangle in longitude or latitude;
 *   - its overhang is the Euclidean distance from the rectangle, with degrees
 *     converted to metres by the frozen citywide scale pair of ADR 0025
 *     (`EXTERIOR_FULLSNAPSHOT_PROJECTION`) — one city-wide constant pair, no
 *     trigonometry, the same convention every plan hash in this repository is
 *     already defined under;
 *   - a building's overhang is the maximum over its OUTER ring vertices. Hole
 *     rings are interior by construction and cannot extend the extent.
 */
export const CITYWIDE_OVERHANG_METRIC = {
  metricId: "rect-euclidean-frozen-scale-v1",
  metersPerDegreeLongitude: EXTERIOR_FULLSNAPSHOT_PROJECTION.millimetersPerDegreeLongitude / 1_000,
  metersPerDegreeLatitude: EXTERIOR_FULLSNAPSHOT_PROJECTION.millimetersPerDegreeLatitude / 1_000,
  referenceLatitude: EXTERIOR_FULLSNAPSHOT_PROJECTION.referenceLatitudeNanodegrees / 1e9,
} as const;

/** Distance in metres from a WGS84 point to a closed rectangle; 0 when inside. */
export function overhangMeters(longitude: number, latitude: number, bounds: Wgs84Bounds): number {
  const outsideLongitudeDegrees = Math.max(bounds.west - longitude, longitude - bounds.east, 0);
  const outsideLatitudeDegrees = Math.max(bounds.south - latitude, latitude - bounds.north, 0);
  if (outsideLongitudeDegrees === 0 && outsideLatitudeDegrees === 0) return 0;
  const east = outsideLongitudeDegrees * CITYWIDE_OVERHANG_METRIC.metersPerDegreeLongitude;
  const north = outsideLatitudeDegrees * CITYWIDE_OVERHANG_METRIC.metersPerDegreeLatitude;
  return Math.hypot(east, north);
}

// ---------------------------------------------------------------------------
// Integer distributions
// ---------------------------------------------------------------------------

export interface IntegerHistogram {
  /** Exact value → count, ascending by value. Never bucketed: these ranges are small. */
  buckets: Array<{ value: number; count: number }>;
  count: number;
  min: number | null;
  max: number | null;
  /** Lower-median (the `floor((n-1)/2)`-th order statistic), so it is always an observed value. */
  median: number | null;
  p95: number | null;
  p99: number | null;
  /** Rounded to 4 decimals so the artifact is byte-stable across platforms. */
  mean: number | null;
}

function quantile(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index]!;
}

/**
 * Exact-value histogram over a bounded integer distribution.
 *
 * Rejects non-integers rather than rounding: every distribution this census
 * reports is a count of something, and a fractional count is a bug upstream,
 * not a value to coerce.
 */
export function integerHistogram(values: readonly number[]): IntegerHistogram {
  const counts = new Map<number, number>();
  for (const value of values) {
    if (!Number.isInteger(value)) throw new Error(`integerHistogram requires integers; received ${value}.`);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const buckets = [...counts.entries()].sort((left, right) => left[0] - right[0]).map(([value, count]) => ({ value, count }));
  const sorted = [...values].sort((left, right) => left - right);
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    buckets,
    count: values.length,
    min: sorted[0] ?? null,
    max: sorted[sorted.length - 1] ?? null,
    median: sorted.length === 0 ? null : sorted[Math.floor((sorted.length - 1) / 2)]!,
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
    mean: sorted.length === 0 ? null : Math.round((total / sorted.length) * 10_000) / 10_000,
  };
}

// ---------------------------------------------------------------------------
// Per-cell render extents
// ---------------------------------------------------------------------------

export interface CensusBuildingSource {
  buildingId: string;
  /** Outer ring as the snapshot carries it (closed or open; both are accepted). */
  outerRing: ReadonlyArray<readonly [number, number]>;
  /** Sourced height in metres, or `null` when the source states none. */
  heightMeters: number | null;
  heightUnknown: boolean;
}

export interface CellExtentInput {
  cellId: string;
  order: number;
  /** The ledger's ASSIGNMENT rectangle. Never a containment rectangle (ADR 0024 D6). */
  assignmentBounds: Wgs84Bounds;
  buildings: readonly CensusBuildingSource[];
  /**
   * Substitute height, in metres, for buildings whose source states none. The
   * caller supplies it so the substitution stays a caller's stated decision
   * rather than a default this module hides.
   */
  unknownHeightSubstituteMeters: number;
}

export interface CellExtentRow {
  cellId: string;
  order: number;
  buildingCount: number;
  assignmentBounds: Wgs84Bounds;
  /**
   * The union of the assignment rectangle and every member footprint vertex.
   *
   * This is the rectangle a scheduler may cull on. `assignmentBounds` is not:
   * 22% of buildings put geometry outside it, so culling on assignment bounds
   * drops visible buildings.
   */
  renderBounds: Wgs84Bounds;
  maxOverhangMeters: number;
  maxOverhangBuildingId: string | null;
  /** Members with at least one outer-ring vertex outside the assignment rectangle. */
  overhangBuildingCount: number;
  /**
   * Tallest member top, in metres above ground. Substituted heights are
   * included and counted separately; a cell whose tallest member has no sourced
   * height must not silently report a substitute as a measurement.
   */
  maxTopMeters: number;
  maxTopBuildingId: string | null;
  maxTopSource: "source" | "substituted" | "none";
  unknownHeightCount: number;
  outerRingVertexCount: number;
}

function unionBounds(into: Wgs84Bounds, longitude: number, latitude: number): void {
  if (longitude < into.west) into.west = longitude;
  if (longitude > into.east) into.east = longitude;
  if (latitude < into.south) into.south = latitude;
  if (latitude > into.north) into.north = latitude;
}

/**
 * Open a ring: drop the trailing duplicate of the first vertex when present.
 *
 * Every geometry cost in this census is per DISTINCT vertex, and the V3 grammar
 * counts the same way (`buildMidtownCoreV3Plan` strips the closing point before
 * projecting), so counting the closing duplicate would inflate every estimate by
 * one vertex per building — about 45,000 phantom vertices island-wide.
 */
export function openRing(ring: ReadonlyArray<readonly [number, number]>): ReadonlyArray<readonly [number, number]> {
  if (ring.length > 1) {
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    if (first[0] === last[0] && first[1] === last[1]) return ring.slice(0, -1);
  }
  return ring;
}

/** Derive one cell's render extent, overhang and skyline top from its members. */
export function deriveCellExtent(input: CellExtentInput): CellExtentRow {
  const renderBounds: Wgs84Bounds = { ...input.assignmentBounds };
  let maxOverhangMeters = 0;
  let maxOverhangBuildingId: string | null = null;
  let overhangBuildingCount = 0;
  let maxTopMeters = 0;
  let maxTopBuildingId: string | null = null;
  let maxTopSource: CellExtentRow["maxTopSource"] = "none";
  let unknownHeightCount = 0;
  let outerRingVertexCount = 0;

  for (const building of input.buildings) {
    const ring = openRing(building.outerRing);
    outerRingVertexCount += ring.length;
    let buildingOverhang = 0;
    for (const [longitude, latitude] of ring) {
      unionBounds(renderBounds, longitude, latitude);
      const distance = overhangMeters(longitude, latitude, input.assignmentBounds);
      if (distance > buildingOverhang) buildingOverhang = distance;
    }
    if (buildingOverhang > 0) {
      overhangBuildingCount += 1;
      if (buildingOverhang > maxOverhangMeters) {
        maxOverhangMeters = buildingOverhang;
        maxOverhangBuildingId = building.buildingId;
      }
    }
    const substituted = building.heightUnknown || building.heightMeters === null;
    if (substituted) unknownHeightCount += 1;
    const top = substituted ? input.unknownHeightSubstituteMeters : building.heightMeters!;
    if (top > maxTopMeters) {
      maxTopMeters = top;
      maxTopBuildingId = building.buildingId;
      maxTopSource = substituted ? "substituted" : "source";
    }
  }

  return {
    cellId: input.cellId,
    order: input.order,
    buildingCount: input.buildings.length,
    assignmentBounds: { ...input.assignmentBounds },
    renderBounds,
    maxOverhangMeters,
    maxOverhangBuildingId,
    overhangBuildingCount,
    maxTopMeters,
    maxTopBuildingId,
    maxTopSource,
    unknownHeightCount,
    outerRingVertexCount,
  };
}

export interface CellExtentAggregates {
  cellCount: number;
  buildingCount: number;
  /** Buildings with at least one outer-ring vertex outside their assignment rectangle. */
  overhangBuildingCount: number;
  overhangBuildingShare: number;
  maxOverhangMeters: number;
  maxOverhangBuildingId: string | null;
  maxOverhangCellId: string | null;
  /** Cells whose render extent is strictly wider than their assignment rectangle. */
  cellsWithOverhang: number;
  maxTopMeters: number;
  maxTopBuildingId: string | null;
  totalOuterRingVertexCount: number;
}

/** Aggregate the per-cell rows into the figures ADR 0024 reported in prose. */
export function aggregateCellExtents(rows: readonly CellExtentRow[]): CellExtentAggregates {
  let buildingCount = 0;
  let overhangBuildingCount = 0;
  let maxOverhangMeters = 0;
  let maxOverhangBuildingId: string | null = null;
  let maxOverhangCellId: string | null = null;
  let cellsWithOverhang = 0;
  let maxTopMeters = 0;
  let maxTopBuildingId: string | null = null;
  let totalOuterRingVertexCount = 0;
  for (const row of rows) {
    buildingCount += row.buildingCount;
    overhangBuildingCount += row.overhangBuildingCount;
    totalOuterRingVertexCount += row.outerRingVertexCount;
    if (row.overhangBuildingCount > 0) cellsWithOverhang += 1;
    if (row.maxOverhangMeters > maxOverhangMeters) {
      maxOverhangMeters = row.maxOverhangMeters;
      maxOverhangBuildingId = row.maxOverhangBuildingId;
      maxOverhangCellId = row.cellId;
    }
    if (row.maxTopMeters > maxTopMeters) {
      maxTopMeters = row.maxTopMeters;
      maxTopBuildingId = row.maxTopBuildingId;
    }
  }
  return {
    cellCount: rows.length,
    buildingCount,
    overhangBuildingCount,
    overhangBuildingShare: buildingCount === 0 ? 0 : Math.round((overhangBuildingCount / buildingCount) * 1e6) / 1e6,
    maxOverhangMeters,
    maxOverhangBuildingId,
    maxOverhangCellId,
    cellsWithOverhang,
    maxTopMeters,
    maxTopBuildingId,
    totalOuterRingVertexCount,
  };
}
