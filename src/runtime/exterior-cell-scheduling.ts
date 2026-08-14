import type { CameraPose } from "../domain/visitor-navigation";
import { citywideOverviewCellExtent, CITYWIDE_OVERVIEW_CELL_EXTENTS, CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE } from "./citywide-overview-cell-extents";
import { EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY, EXTERIOR_CELL_SCHEDULER_POLICY, selectResidentUnits, type SchedulableUnit, type SchedulerCarry, type SchedulerDecision } from "./exterior-visibility-scheduler";
import type { ViewportFootprint } from "./viewport-footprint";

/**
 * The exterior-cell binding of the generic scheduler.
 *
 * This is the only module that knows the unit class is a cell. It resolves a
 * runtime's declared cell ids to committed render extents and hands the generic
 * decision back as a load list. The scheduler module stays free of cells; T004
 * binds the same decision to citywide shards in a sibling of this file.
 *
 * ## The identity guarantee
 *
 * With `enabled: false` this function returns the caller's own array, by
 * reference. Not a copy, not a re-sort, not a filter that happens to keep
 * everything — the same array. That is what makes "the default path is
 * unchanged" a checkable claim rather than a hopeful one, and
 * `exterior-cell-scheduling.test.ts` pins it with `toBe`.
 */

export const EXTERIOR_CELL_UNIT_CLASS = "exterior-cell" as const;

export interface ExteriorCellScheduleInput {
  readonly enabled: boolean;
  readonly footprint: ViewportFootprint;
  readonly camera: CameraPose;
  readonly heightBucket: number;
  readonly previous: SchedulerCarry | null;
  /**
   * The T005 detail radius in metres, or `null`/absent for no radius. Passed
   * straight through to the policy; this binding adds no default of its own, so
   * "the caller said nothing" and "today's behaviour" stay the same statement.
   */
  readonly maxUnitDistanceMeters?: number | null;
}

export interface ExteriorCellSchedule {
  /** Cells to load, in the runtime's own declared order. Identical to the input when disabled. */
  readonly cellIds: readonly string[];
  /** Cells the scheduler withheld this decision. */
  readonly deferredCellIds: readonly string[];
  /**
   * Cells the committed census carries no render extent for. They are ALWAYS
   * loaded. A cell whose extent is unknown cannot be proven invisible, and the
   * fail-closed direction for a scheduler is to keep geometry, never to withhold
   * it on an assumption. The fixture release's `c1`/`c2` are the live example.
   */
  readonly unschedulableCellIds: readonly string[];
  readonly carry: SchedulerCarry | null;
  readonly decision: SchedulerDecision | null;
}

const EMPTY: readonly string[] = [];

/** Build the generic units for a runtime's declared cells, dropping ids the census does not carry. */
export function exteriorCellUnits(cellIds: readonly string[]): { units: SchedulableUnit[]; unschedulable: string[] } {
  const units: SchedulableUnit[] = [];
  const unschedulable: string[] = [];
  for (const cellId of cellIds) {
    const extent = citywideOverviewCellExtent(cellId);
    if (!extent) { unschedulable.push(cellId); continue; }
    units.push({ unitId: cellId, class: EXTERIOR_CELL_UNIT_CLASS, bounds: extent.renderBounds, order: extent.order, tieBreakKey: extent.cellId });
  }
  return { units, unschedulable };
}

export function scheduleExteriorCells(declaredCellIds: readonly string[], input: ExteriorCellScheduleInput): ExteriorCellSchedule {
  if (!input.enabled) {
    return { cellIds: declaredCellIds, deferredCellIds: EMPTY, unschedulableCellIds: EMPTY, carry: null, decision: null };
  }
  const { units, unschedulable } = exteriorCellUnits(declaredCellIds);
  const decision = selectResidentUnits(units, { footprint: input.footprint, camera: input.camera, heightBucket: input.heightBucket }, {
    ...EXTERIOR_CELL_SCHEDULER_POLICY,
    metersPerDegreeLongitude: CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE.metersPerDegreeLongitude,
    metersPerDegreeLatitude: CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE.metersPerDegreeLatitude,
    previous: input.previous,
    maxUnitDistanceMeters: input.maxUnitDistanceMeters ?? null,
  });
  const resident = new Set([...decision.resident, ...unschedulable]);
  // The runtime's own declared order is preserved so the load array stays
  // comparable, element for element, with the array the default path builds.
  const cellIds = declaredCellIds.filter((cellId) => resident.has(cellId));
  const deferredCellIds = declaredCellIds.filter((cellId) => !resident.has(cellId));
  return { cellIds, deferredCellIds, unschedulableCellIds: unschedulable, carry: decision.carry, decision };
}

/**
 * ## The single-decision pool (T003)
 *
 * `scheduleExteriorCells` above is the T002 shape: one decision per wave, one
 * cap per wave, one carry per wave. It is retained because the thrash gate
 * replays it as a frozen baseline, and because a per-wave decision is still the
 * right primitive for a caller that genuinely has one pool.
 *
 * The APP does not. Six promoted waves running six decisions gave every wave its
 * own copy of the cap, so a session was bounded by 6 x 96 and four waves held
 * budget they could not spend while the wave the camera was looking at truncated
 * 53 visible cells. `scheduleExteriorCellsGlobally` is one decision for the
 * session, and two properties of it are load-bearing:
 *
 *   1. **The unit list is the STATIC 883-row census table, always.** Not "the
 *      cells of the waves that have loaded so far". A pool built from loaded
 *      waves would hand the first wave to arrive the entire cap, and the
 *      residency of a wave would then depend on the order the waves' indexes
 *      happened to come back — a decision that is not reproducible from a camera
 *      trace, which is the one property the scheduler contract exists to have.
 *      Every decision ranks all 883 rows; the loaded runtimes only decide which
 *      part of that decision is actionable this pass.
 *   2. **Waves INTERSECT the decision; they do not shrink it.** A wave whose
 *      index has not arrived contributes nothing and consumes nothing. When it
 *      arrives, the cells the standing decision already admitted for it become
 *      loadable immediately, with no re-decision and no reshuffle of the waves
 *      that were already resident.
 */
export interface ExteriorWaveCells {
  readonly releaseId: string;
  readonly declaredCellIds: readonly string[];
}

export interface ExteriorGlobalSchedule {
  /** Per-wave load lists, each in that runtime's own declared order. */
  readonly byRelease: ReadonlyMap<string, ExteriorCellSchedule>;
  readonly carry: SchedulerCarry | null;
  readonly decision: SchedulerDecision | null;
  /** Cells resident by the one decision, across the whole census. */
  readonly residentCellIds: readonly string[];
}

/**
 * The static pool: every cell the census carries, built once.
 *
 * Module-level and frozen in shape on purpose — rebuilding 883 units on every
 * camera move would be the kind of cost that only shows up in a profile, and the
 * rows are immutable data generated from a digest-pinned census.
 */
export const EXTERIOR_CELL_STATIC_UNITS: readonly SchedulableUnit[] = CITYWIDE_OVERVIEW_CELL_EXTENTS.map((entry) => ({
  unitId: entry.cellId,
  class: EXTERIOR_CELL_UNIT_CLASS,
  bounds: entry.renderBounds,
  order: entry.order,
  tieBreakKey: entry.cellId,
}));

export function scheduleExteriorCellsGlobally(waves: readonly ExteriorWaveCells[], input: ExteriorCellScheduleInput): ExteriorGlobalSchedule {
  if (!input.enabled) {
    const disabled = new Map<string, ExteriorCellSchedule>();
    // Identity by reference, per wave, exactly as the per-wave binding: the
    // caller's own array, not a copy that happens to hold the same ids.
    for (const wave of waves) disabled.set(wave.releaseId, { cellIds: wave.declaredCellIds, deferredCellIds: EMPTY, unschedulableCellIds: EMPTY, carry: null, decision: null });
    return { byRelease: disabled, carry: null, decision: null, residentCellIds: EMPTY };
  }
  const decision = selectResidentUnits(EXTERIOR_CELL_STATIC_UNITS, { footprint: input.footprint, camera: input.camera, heightBucket: input.heightBucket }, {
    ...EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY,
    metersPerDegreeLongitude: CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE.metersPerDegreeLongitude,
    metersPerDegreeLatitude: CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE.metersPerDegreeLatitude,
    previous: input.previous,
    maxUnitDistanceMeters: input.maxUnitDistanceMeters ?? null,
  });
  const resident = new Set(decision.resident);
  const byRelease = new Map<string, ExteriorCellSchedule>();
  for (const wave of waves) {
    const unschedulable: string[] = [];
    const cellIds: string[] = [];
    const deferredCellIds: string[] = [];
    for (const cellId of wave.declaredCellIds) {
      const extent = citywideOverviewCellExtent(cellId);
      // A cell the census carries no extent for cannot be proven invisible, so
      // it is always loaded — the same fail-closed direction as the per-wave
      // binding, applied per wave because it is a property of the wave's own
      // declared list and not of the global decision.
      if (!extent) { unschedulable.push(cellId); cellIds.push(cellId); continue; }
      // Match on the CENSUS id, not the declared one. Block 835 shipped before
      // the wave ledger existed, so its release names the cell
      // `cell:manhattan:block-835` while the census names it
      // `manhattan-exterior-cell-w00-000000-block-00835`. The static unit pool
      // is built from census ids, so comparing the declared id against the
      // resident set would defer Block 835 at EVERY camera — including the one
      // it is standing in. A latency capture on the real build is what caught
      // it: the street-level session requested 6 artifacts where it had
      // requested 20, and the 14 missing ones were the whole of wave w00.
      if (resident.has(extent.cellId)) cellIds.push(cellId);
      else deferredCellIds.push(cellId);
    }
    byRelease.set(wave.releaseId, { cellIds, deferredCellIds, unschedulableCellIds: unschedulable, carry: decision.carry, decision });
  }
  return { byRelease, carry: decision.carry, decision, residentCellIds: decision.resident };
}
