import type { CameraPose } from "../domain/visitor-navigation";
import { citywideOverviewCellExtent, CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE } from "./citywide-overview-cell-extents";
import { EXTERIOR_CELL_SCHEDULER_POLICY, selectResidentUnits, type SchedulableUnit, type SchedulerCarry, type SchedulerDecision } from "./exterior-visibility-scheduler";
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
  });
  const resident = new Set([...decision.resident, ...unschedulable]);
  // The runtime's own declared order is preserved so the load array stays
  // comparable, element for element, with the array the default path builds.
  const cellIds = declaredCellIds.filter((cellId) => resident.has(cellId));
  const deferredCellIds = declaredCellIds.filter((cellId) => !resident.has(cellId));
  return { cellIds, deferredCellIds, unschedulableCellIds: unschedulable, carry: decision.carry, decision };
}
