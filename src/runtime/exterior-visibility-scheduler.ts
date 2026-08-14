import type { CameraPose } from "../domain/visitor-navigation";
import { normalizeViewportLongitude, viewportBoundsCrossesAntimeridian, viewportBoundsIntersect, type ViewportBounds, type ViewportFootprint } from "./viewport-footprint";

/**
 * The visibility-driven residency scheduler, as one pure decision.
 *
 * Deliberately generic over "bounded units" rather than typed to exterior cells.
 * Cells are the unit class this task ships (T002); citywide shards are the unit
 * class T004 will hand it when `refreshViewport` is refactored onto the same
 * decision. Nothing here knows what a cell or a shard IS — a unit is an id, a
 * class label, a rectangle, an explicit order and a tiebreak key.
 *
 * There are no Cesium imports in this module and there must never be. Its whole
 * value is that a decision can be replayed offline from a recorded camera trace
 * without a browser, which is what the thrash gate does.
 *
 * ## What the decision is NOT
 *
 * It is not a frustum test. The input is `ViewportFootprint` — ground the camera
 * was measured to see, sampled by nine globe pick-rays — and a rectangle
 * intersection against it. A true frustum would need Cesium, and would need the
 * camera's projection, which this module deliberately cannot see.
 *
 * It is not a claim about frame time, GPU memory or draw calls. It decides which
 * units are *resident*; ADR 0040 D7 records that decoded GPU bytes are not
 * observable from outside Cesium, and this module observes nothing at all.
 */

/** A bounded schedulable thing. Cells in T002; shards in T004. */
export interface SchedulableUnit {
  readonly unitId: string;
  /** Free-form class label, e.g. `"exterior-cell"`. Carried through to the decision, never interpreted. */
  readonly class: string;
  /**
   * The rectangle to cull on. For exterior cells this is the census
   * `renderBounds` and never `assignmentBounds`: the assignment rectangle is a
   * membership decision by representative point and is smaller than the rendered
   * extent in 870 of 883 cells, so culling on it drops geometry.
   */
  readonly bounds: ViewportBounds;
  /** The explicit priority order. Replaces the incidental lexicographic id order. */
  readonly order: number;
  /** Final deterministic tiebreak when two units share a band and an order. */
  readonly tieBreakKey: string;
}

export interface SchedulerView {
  readonly footprint: ViewportFootprint;
  readonly camera: CameraPose;
  /** The bucketed camera height the LOD thresholds are evaluated against. */
  readonly heightBucket: number;
}

/**
 * The residency carried from the previous decision.
 *
 * It rides in the policy argument rather than as a fourth parameter so the
 * frozen three-argument signature holds: a decision is (units, view, policy) and
 * the policy is everything the caller controls, including where it left off.
 */
export interface SchedulerCarry {
  /** Units resident after the previous decision. */
  readonly resident: readonly string[];
  /** Unit id to the number of further decisions it may survive while invisible. */
  readonly retained: ReadonlyMap<string, number>;
  readonly heightBucket: number;
  readonly footprintSignature: string;
  readonly decisionIndex: number;
}

export interface SchedulerPolicy {
  /**
   * Hard cap on admissions. The output is bounded by construction: it is never
   * longer than `max(maxResidentUnits, reserved.length)`, and the only term that
   * can exceed the cap is the camera reservation, which is never truncated
   * because dropping the unit the camera is standing in is the T009 F2 defect.
   */
  readonly maxResidentUnits: number;
  /**
   * Ascending distance-band edges in metres, measured from the footprint ground
   * centre to the nearest point of a unit's rectangle. Units inside the same
   * band are ranked by `order`, so distance decides coarsely and the explicit
   * order decides finely.
   */
  readonly distanceBandEdgesMeters: readonly number[];
  /**
   * How many further decisions a unit that has left the footprint stays
   * resident. This is the whole anti-thrash mechanism; there is no behind-camera
   * prefetch in this cycle.
   */
  readonly hysteresisDecisions: number;
  /** Planar scale for the band metric. The census's own frozen scale, not a geodesic. */
  readonly metersPerDegreeLongitude: number;
  readonly metersPerDegreeLatitude: number;
  readonly previous: SchedulerCarry | null;
}

export type SchedulerHold = "none" | "held-previous" | "bootstrap-untrusted-footprint";

export interface SchedulerDecision {
  /** The resident set in canonical order (`order`, then `tieBreakKey`, then id). */
  readonly resident: readonly string[];
  /** Newly admitted units, in priority order. */
  readonly load: readonly string[];
  /** Units the previous decision held that this one does not, in canonical order. */
  readonly evict: readonly string[];
  /** The whole resident set in priority order: reservation, then band/order rank, then retained. */
  readonly order: readonly string[];
  readonly carry: SchedulerCarry;
  readonly hold: SchedulerHold;
  /** Units containing the camera ground point. Always resident, never truncated. */
  readonly reserved: readonly string[];
  /**
   * Units the camera could see before the cap was applied: the reserved units
   * PLUS the ones whose rectangle intersects the footprint. Reserved units are
   * counted here because a unit containing the camera is visible by any reading;
   * they are excluded from the intersection tier only so the reservation cannot
   * be truncated, which is a priority decision and not a visibility one.
   */
  readonly visibleCount: number;
  /** Visible-or-retained units the cap refused. */
  readonly deferredCount: number;
  /** Units resident only because hysteresis has not expired for them. */
  readonly retainedCount: number;
}

/**
 * The default policy for exterior cells.
 *
 * Both band edges are evidence-anchored rather than chosen for roundness. ADR
 * 0040 measured the citywide overview p95 screen-space error crossing one pixel
 * at ~2.4 km, and named 1.2-2.4 km as the transition band its successor tasks
 * have to characterise. So: inside 1.2 km is near, 1.2-2.4 km is the transition,
 * beyond 2.4 km is a band that only fills residency the nearer bands left spare.
 *
 * `maxResidentUnits` of 96 is a cap on a set the default currently does not cap
 * at all — the six promoted waves declare 883 cells between them and every one
 * of them is requested on every load. 96 is stated as a starting cap for an
 * opt-in flag, not as a measured optimum: the two numbers this task reports are
 * measured AT this cap, and moving it moves them.
 *
 * `hysteresisDecisions` of 3 is likewise a starting value; the thrash gate
 * reports what it buys on the two recorded paths and no more than that.
 */
export const EXTERIOR_CELL_SCHEDULER_POLICY = {
  maxResidentUnits: 96,
  distanceBandEdgesMeters: [1_200, 2_400] as readonly number[],
  hysteresisDecisions: 3,
} as const;

/**
 * The T003 SESSION-WIDE policy: one pool, one cap, one decision.
 *
 * T002 applied `EXTERIOR_CELL_SCHEDULER_POLICY` once PER WAVE, so a six-wave
 * session was bounded by 6 x 96 = 576 of 883 and not by 96 — a limitation ADR
 * 0041 disclosed and handed here. T003 replaces that with a single
 * `selectResidentUnits` call over the static 883-row census table, and this is
 * the cap that call uses. `EXTERIOR_CELL_SCHEDULER_POLICY` is kept unchanged
 * because the T002 thrash baseline was measured at it and a frozen baseline that
 * moves with the code it gates is not a baseline.
 *
 * ## Why 128, with the arithmetic
 *
 * Anchors, all from ADR 0041's committed opt-in evidence at the two measured
 * cameras (`data/exterior-scheduler-traces-20260814/optin-evidence.json`):
 *
 *   1. **Floor: 110.** The six-pool configuration held 110 cells at the
 *      2,400 m overview camera. One pool must not hold fewer at the same
 *      camera, so 110 is a hard floor. 128 is the next power of two above it —
 *      a stated rounding convention, not a measurement, and named as one.
 *   2. **Entry cost.** At that camera 110 resident cells cost 210 cache
 *      entries: 1.909 entries per cell. 128 x 1.909 = 244 entries, 47.7% of
 *      `EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries` (512). The entry ceiling would
 *      bind at 512 / 1.909 = 268 cells, more than twice this cap.
 *   3. **Byte cost.** The same 110 cells cost 37,164,596 B: 337,860 B per cell.
 *      128 x 337,860 = 43,246,080 B, 16.1% of the 256 MiB byte cap. The byte
 *      ceiling would bind at 794 cells — beyond the 883 the ledger declares.
 *   4. **It is still a bound.** 128 is 4.5x tighter than the 576 it replaces and
 *      6.9x below the 883 the default loads unconditionally.
 *
 * **Residency at the measured overview camera RISES, from 110 to at most 128,
 * and that is the intended direction.** The per-wave cap was deferring 53 cells
 * that were inside the footprint while four other waves held unused budget; one
 * pool spends that budget where the camera is looking. What FALLS is the session
 * bound, from 576 to 128.
 *
 * Neither cache ceiling binds at this cap, and neither binds without it: the
 * whole promoted composition resident at once measures 484 entries and
 * 122,601,292 B, inside both. ADR 0042 states that plainly rather than implying
 * the caps are doing work they are not.
 */
export const EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY = {
  ...EXTERIOR_CELL_SCHEDULER_POLICY,
  maxResidentUnits: 128,
} as const;

export const EMPTY_SCHEDULER_CARRY: SchedulerCarry = {
  resident: [],
  retained: new Map<string, number>(),
  heightBucket: 0,
  footprintSignature: "",
  decisionIndex: 0,
};

function longitudeGap(value: number, west: number, east: number): number {
  // Manhattan never wraps, and a wrapped rectangle has no single nearest edge in
  // this planar metric. A wrapping unit is treated as distance 0 rather than
  // given a fabricated one; the intersection test above it is still exact.
  if (viewportBoundsCrossesAntimeridian({ west, east, south: 0, north: 0 })) return 0;
  const longitude = normalizeViewportLongitude(value);
  if (longitude < west) return west - longitude;
  if (longitude > east) return longitude - east;
  return 0;
}

/** Nearest-point distance from a ground point to a rectangle, in the census planar metric. */
export function unitDistanceMeters(bounds: ViewportBounds, longitude: number, latitude: number, policy: Pick<SchedulerPolicy, "metersPerDegreeLongitude" | "metersPerDegreeLatitude">): number {
  const east = longitudeGap(longitude, bounds.west, bounds.east) * policy.metersPerDegreeLongitude;
  const north = (latitude < bounds.south ? bounds.south - latitude : latitude > bounds.north ? latitude - bounds.north : 0) * policy.metersPerDegreeLatitude;
  return Math.hypot(east, north);
}

function bandIndexOf(distanceMeters: number, edges: readonly number[]): number {
  let band = 0;
  for (const edge of edges) {
    if (distanceMeters < edge) return band;
    band += 1;
  }
  return band;
}

function boundsContain(bounds: ViewportBounds, longitude: number, latitude: number): boolean {
  if (latitude < bounds.south || latitude > bounds.north) return false;
  const value = normalizeViewportLongitude(longitude);
  return viewportBoundsCrossesAntimeridian(bounds) ? value >= bounds.west || value <= bounds.east : value >= bounds.west && value <= bounds.east;
}

interface RankedUnit {
  readonly unit: SchedulableUnit;
  readonly tier: number;
  readonly band: number;
}

function compareRanked(left: RankedUnit, right: RankedUnit): number {
  if (left.tier !== right.tier) return left.tier - right.tier;
  if (left.band !== right.band) return left.band - right.band;
  if (left.unit.order !== right.unit.order) return left.unit.order - right.unit.order;
  if (left.unit.tieBreakKey !== right.unit.tieBreakKey) return left.unit.tieBreakKey < right.unit.tieBreakKey ? -1 : 1;
  return left.unit.unitId < right.unit.unitId ? -1 : left.unit.unitId > right.unit.unitId ? 1 : 0;
}

function compareCanonical(left: SchedulableUnit, right: SchedulableUnit): number {
  if (left.order !== right.order) return left.order - right.order;
  if (left.tieBreakKey !== right.tieBreakKey) return left.tieBreakKey < right.tieBreakKey ? -1 : 1;
  return left.unitId < right.unitId ? -1 : left.unitId > right.unitId ? 1 : 0;
}

function canonicalOrder(ids: Iterable<string>, byId: ReadonlyMap<string, SchedulableUnit>): string[] {
  const known: SchedulableUnit[] = [];
  const unknown: string[] = [];
  for (const id of ids) {
    const unit = byId.get(id);
    if (unit) known.push(unit);
    else unknown.push(id);
  }
  known.sort(compareCanonical);
  unknown.sort();
  return [...known.map((unit) => unit.unitId), ...unknown];
}

/**
 * Decide residency for one camera sample.
 *
 * Order of the policy, which is frozen:
 *
 *   1. **Camera reservation.** Every unit whose rectangle contains the camera
 *      ground point is resident, unconditionally, ahead of everything else and
 *      exempt from the cap. This is the T009 F2 lesson restated for cells: the
 *      shard the camera was standing on fell outside a distance-ranked cut and a
 *      street-level view rendered nothing. Overlapping units mean there can be
 *      several, and all of them are reserved.
 *   2. **Footprint intersection**, on each unit's `bounds`.
 *   3. **Distance band**, nearest-point distance from the footprint ground centre.
 *   4. **Explicit order**, then `tieBreakKey`, then id. Input array order is
 *      never consulted, so a shuffled input yields an identical decision.
 *   5. **Hysteresis**, then the cap. A unit that has left the footprint stays
 *      resident for `hysteresisDecisions` further decisions, at lower priority
 *      than anything visible. There is NO behind-camera prefetch in this cycle;
 *      retaining what was recently visible is the whole mechanism.
 *
 * An untrusted footprint — anything whose source is not a live ground-ray sample
 * — never evicts. With a previous decision it is HELD verbatim; with none there
 * is nothing to hold, so the decision is computed and marked as a bootstrap.
 */
export function selectResidentUnits(units: readonly SchedulableUnit[], view: SchedulerView, policy: SchedulerPolicy): SchedulerDecision {
  const byId = new Map<string, SchedulableUnit>();
  for (const unit of units) if (!byId.has(unit.unitId)) byId.set(unit.unitId, unit);
  const previous = policy.previous;
  const previousResident = previous?.resident ?? [];

  if (!view.footprint.valid && previous !== null) {
    return {
      resident: canonicalOrder(previousResident, byId),
      load: [],
      evict: [],
      order: [...previousResident],
      carry: { ...previous, heightBucket: view.heightBucket, footprintSignature: view.footprint.signature, decisionIndex: previous.decisionIndex + 1 },
      hold: "held-previous",
      reserved: [],
      visibleCount: 0,
      deferredCount: 0,
      retainedCount: 0,
    };
  }

  const previousSet = new Set(previousResident);
  const previousRetained = previous?.retained ?? EMPTY_SCHEDULER_CARRY.retained;
  const reserved: RankedUnit[] = [];
  const visible: RankedUnit[] = [];
  const retained: RankedUnit[] = [];
  const remainingAfter = new Map<string, number>();

  for (const unit of byId.values()) {
    const distance = unitDistanceMeters(unit.bounds, view.footprint.groundCenter.longitude, view.footprint.groundCenter.latitude, policy);
    const band = bandIndexOf(distance, policy.distanceBandEdgesMeters);
    if (boundsContain(unit.bounds, view.camera.longitude, view.camera.latitude)) {
      reserved.push({ unit, tier: 0, band });
      remainingAfter.set(unit.unitId, policy.hysteresisDecisions);
      continue;
    }
    if (viewportBoundsIntersect(unit.bounds, view.footprint.bounds)) {
      visible.push({ unit, tier: 1, band });
      remainingAfter.set(unit.unitId, policy.hysteresisDecisions);
      continue;
    }
    if (!previousSet.has(unit.unitId)) continue;
    const remaining = (previousRetained.get(unit.unitId) ?? policy.hysteresisDecisions) - 1;
    if (remaining <= 0) continue;
    retained.push({ unit, tier: 2, band });
    remainingAfter.set(unit.unitId, remaining);
  }

  reserved.sort(compareRanked);
  visible.sort(compareRanked);
  retained.sort(compareRanked);

  const budget = Math.max(0, policy.maxResidentUnits - reserved.length);
  const contested = [...visible, ...retained];
  const admitted = contested.slice(0, budget);
  const priority = [...reserved, ...admitted];
  const residentIds = new Set(priority.map((entry) => entry.unit.unitId));

  const carryRetained = new Map<string, number>();
  for (const id of residentIds) carryRetained.set(id, remainingAfter.get(id) ?? policy.hysteresisDecisions);

  const orderIds = priority.map((entry) => entry.unit.unitId);
  return {
    resident: canonicalOrder(residentIds, byId),
    load: orderIds.filter((id) => !previousSet.has(id)),
    evict: canonicalOrder(previousResident.filter((id) => !residentIds.has(id)), byId),
    order: orderIds,
    carry: {
      resident: canonicalOrder(residentIds, byId),
      retained: carryRetained,
      heightBucket: view.heightBucket,
      footprintSignature: view.footprint.signature,
      decisionIndex: (previous?.decisionIndex ?? 0) + 1,
    },
    hold: view.footprint.valid ? "none" : "bootstrap-untrusted-footprint",
    reserved: reserved.map((entry) => entry.unit.unitId),
    visibleCount: reserved.length + visible.length,
    deferredCount: contested.length - admitted.length,
    retainedCount: admitted.filter((entry) => entry.tier === 2).length,
  };
}
