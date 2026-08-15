/**
 * The LOD 0 / LOD 1 projected-silhouette measurement, for WAVE buildings.
 *
 * WHY THIS EXISTS. `multi-lod-assembly.ts` refuses any asset whose coarse LOD
 * carries no silhouette measurement bound to the asset's own immutable source,
 * and refuses a measurement above a 2% deviation ratio. Only the Block 835
 * authoring paths ever produced one: it was measured in Blender, promoted by
 * hand through `block835-*-plan-cli.mjs measurements`, and committed as a
 * `SilhouetteMeasurementFile`. The wave materializer produces none, which is
 * exactly why every frozen wave ships a SINGLE LOD. A wave that means to ship
 * two needs this number for tens of thousands of buildings, and a hand-run
 * Blender pass is not available at that scale.
 *
 * WHAT IT IS, PRECISELY. The same metric, computed exactly instead of rendered:
 * `projected-silhouette-ratio` v1.0, four axis-aligned horizontal orthographic
 * views, deviation stated as a fraction of the LOD 0 silhouette area.
 *
 * WHY IT CAN BE EXACT. Under an axis-aligned horizontal orthographic view every
 * piece of V3 geometry projects to an AXIS-ALIGNED RECTANGLE or to nothing:
 *
 *   - a tier is a vertical extrusion of a ring, so its shadow is the ring's
 *     projected interval crossed with its z-band — one rectangle per tier;
 *   - a rooftop prism is a vertical extrusion — one rectangle;
 *   - a placement box is a box, so its shadow is the interval of its eight
 *     projected corners crossed with its z-band — one rectangle;
 *   - every cap, deck and prism lid is horizontal, so it projects to a segment
 *     of zero area.
 *
 * The shadow of a union of solids is the union of their shadows, so the whole
 * silhouette is a union of a few hundred axis-aligned rectangles and its area
 * is computed by an exact integer sweep. No rasterizer, no resolution, no
 * quantization floor — which matters, because a 512-pixel raster's own
 * quantization is the same order as the ratios being compared against a 2% cap.
 *
 * RECESSES ARE CORRECTLY ABSENT. An opening is cut INTO a wall to a depth of
 * 200 mm, and `ringLocalThicknessMm` refuses any ring pinched below 600 mm, so
 * a recess never punches through the massing. Interior material cannot change a
 * shadow, so LOD 0's recess boxes contribute nothing and the whole LOD 0 / LOD 1
 * difference is the ATTACHMENTS — cornices, balconies, fire escapes, the sign
 * band and the blade sign — which `tessellateV3Plan` emits only when
 * `includeRecesses` is true.
 *
 * WHAT IT IS NOT. It is not a render, and it is not visual acceptance. It says
 * the coarse level's outline agrees with the fine level's to within a stated
 * fraction; it says nothing about whether either reads correctly on screen. The
 * schema's silhouette record has a CLOSED key set which the assembly validator
 * enforces exactly, so the instrument that produced a number cannot be named
 * inside the record. It is named here, in ADR 0049, and in the Stage-0 evidence.
 */
import {
  type Point2Mm,
  type V3Placement,
  type V3Plan,
} from "../domain/deterministic-facade-generator-v3.ts";

/**
 * The four views, in the order the Block 835 measurement file carries them.
 *
 * All four are computed literally rather than folded into the two independent
 * ones. An orthographic shadow from north and from south are mirror images with
 * identical areas, so the pairs agree by construction — the redundancy is the
 * declared metric's, and reproducing it is cheaper than claiming four views and
 * measuring two.
 */
export const MIDTOWN_CORE_V3_SILHOUETTE_VIEW_IDS = ["view:east", "view:north", "view:south", "view:west"] as const;
export type MidtownCoreV3SilhouetteViewId = (typeof MIDTOWN_CORE_V3_SILHOUETTE_VIEW_IDS)[number];

/** The metric identity, matching the committed Block 835 measurement files. */
export const MIDTOWN_CORE_V3_SILHOUETTE_METHOD = "projected-silhouette-ratio" as const;
export const MIDTOWN_CORE_V3_SILHOUETTE_METRIC_VERSION = "1.0" as const;
/** The multi-LOD assembly schema's cap. Not a tuning knob: the schema pins it. */
export const MIDTOWN_CORE_V3_SILHOUETTE_MAXIMUM_RATIO = 0.02 as const;

/**
 * The horizontal screen axis of each view, as a unit vector in plan-local
 * millimetres. Areas are invariant under the sign, so the choice per view only
 * has to be perpendicular to that view's direction.
 */
const VIEW_AXIS: Record<MidtownCoreV3SilhouetteViewId, readonly [number, number]> = {
  "view:east": [0, 1],
  "view:north": [-1, 0],
  "view:south": [1, 0],
  "view:west": [0, -1],
};

/** One projected rectangle, in integer millimetres. */
interface Rect { uMinMm: number; uMaxMm: number; zMinMm: number; zMaxMm: number }

function rectOf(points: readonly (readonly [number, number])[], axis: readonly [number, number], zMinMm: number, zMaxMm: number): Rect | null {
  if (points.length === 0 || zMaxMm <= zMinMm) return null;
  let uMin = Number.POSITIVE_INFINITY;
  let uMax = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const u = point[0] * axis[0] + point[1] * axis[1];
    if (u < uMin) uMin = u;
    if (u > uMax) uMax = u;
  }
  return uMax <= uMin ? null : { uMinMm: uMin, uMaxMm: uMax, zMinMm, zMaxMm };
}

/**
 * The eight corners of a placement box, in plan-local millimetres.
 *
 * A transliteration of `framePoint`: `u` enters as a fraction of the rounded
 * edge length and the depth rides the outward normal, which is why a protrusion
 * on an edge-on wall widens that view's silhouette by its depth.
 */
function placementFootprint(plan: V3Plan, placement: V3Placement): { points: Point2Mm[]; zMinMm: number; zMaxMm: number } | null {
  const surface = plan.surfaces.find((candidate) => candidate.id === placement.surfaceId);
  if (!surface || surface.kind !== "facade") return null;
  const spanX = surface.endMm[0] - surface.startMm[0];
  const spanY = surface.endMm[1] - surface.startMm[1];
  const length = Math.hypot(spanX, spanY);
  const normalX = length === 0 ? 0 : spanY / length;
  const normalY = length === 0 ? 0 : -spanX / length;
  const points: Point2Mm[] = [];
  for (const u of [placement.bounds.uMinMm, placement.bounds.uMaxMm]) {
    const t = surface.uLengthMm === 0 ? 0 : u / surface.uLengthMm;
    for (const depth of [0, placement.depthMm]) {
      points.push([
        surface.startMm[0] + spanX * t + normalX * depth,
        surface.startMm[1] + spanY * t + normalY * depth,
      ]);
    }
  }
  return { points, zMinMm: surface.baseZMm + placement.bounds.vMinMm, zMaxMm: surface.baseZMm + placement.bounds.vMaxMm };
}

/**
 * Every rectangle the plan's solid casts in one view.
 *
 * `includeAttachments` is the LOD switch, and it names the same thing
 * `tessellateV3Plan`'s `includeRecesses` selects: LOD 0 emits the outward
 * placement boxes, LOD 1 does not. Recesses are deliberately absent from both —
 * they are interior and cannot cast.
 */
export function midtownCoreV3SilhouetteRectangles(
  plan: V3Plan,
  viewId: MidtownCoreV3SilhouetteViewId,
  options: { includeAttachments: boolean },
): Rect[] {
  const axis = VIEW_AXIS[viewId];
  const rects: Rect[] = [];
  const push = (rect: Rect | null): void => { if (rect) rects.push(rect); };
  for (const tier of plan.tiers) push(rectOf(tier.ring, axis, tier.baseZMm, tier.topZMm));
  for (const prism of plan.prisms) push(rectOf(prism.ring, axis, prism.baseZMm, prism.topZMm));
  if (options.includeAttachments) {
    for (const placement of plan.placements) {
      // Openings are cut inward and cannot cast; only glued-on boxes can.
      if (placement.depthMm <= 0) continue;
      const box = placementFootprint(plan, placement);
      if (box) push(rectOf(box.points, axis, box.zMinMm, box.zMaxMm));
    }
  }
  return rects;
}

/**
 * Exact area of a union of axis-aligned rectangles, in square millimetres.
 *
 * A slab sweep over the distinct u coordinates: within a slab every active
 * rectangle contributes a fixed z interval, so the covered z length is a plain
 * interval merge. Exact for any input, and the rectangle count here is in the
 * hundreds because the plan's solid parts are counted, not its triangles.
 */
export function rectangleUnionAreaMm2(rects: readonly Rect[]): number {
  if (rects.length === 0) return 0;
  const boundaries = [...new Set(rects.flatMap((rect) => [rect.uMinMm, rect.uMaxMm]))].sort((left, right) => left - right);
  let area = 0;
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const uLow = boundaries[index]!;
    const uHigh = boundaries[index + 1]!;
    const width = uHigh - uLow;
    if (width <= 0) continue;
    const intervals = rects
      .filter((rect) => rect.uMinMm <= uLow && rect.uMaxMm >= uHigh)
      .map((rect) => [rect.zMinMm, rect.zMaxMm] as const)
      .sort((left, right) => left[0] - right[0]);
    let covered = 0;
    let openFrom = Number.NEGATIVE_INFINITY;
    let openTo = Number.NEGATIVE_INFINITY;
    for (const [low, high] of intervals) {
      if (low > openTo) {
        if (openTo > openFrom) covered += openTo - openFrom;
        openFrom = low;
        openTo = high;
      } else if (high > openTo) openTo = high;
    }
    if (openTo > openFrom) covered += openTo - openFrom;
    area += width * covered;
  }
  return area;
}

export interface MidtownCoreV3SilhouetteView {
  viewId: MidtownCoreV3SilhouetteViewId;
  lod0AreaMm2: number;
  lod1AreaMm2: number;
  /** Symmetric-difference area over the LOD 0 area. */
  deviationRatio: number;
}

export interface MidtownCoreV3SilhouetteMeasurement {
  buildingId: string;
  planHashSha256: string;
  method: typeof MIDTOWN_CORE_V3_SILHOUETTE_METHOD;
  metricVersion: typeof MIDTOWN_CORE_V3_SILHOUETTE_METRIC_VERSION;
  viewIds: readonly MidtownCoreV3SilhouetteViewId[];
  /** The WORST of the four views. A bound is only honest at its worst view. */
  deviationRatio: number;
  worstViewId: MidtownCoreV3SilhouetteViewId;
  perView: readonly MidtownCoreV3SilhouetteView[];
  maximumRatio: typeof MIDTOWN_CORE_V3_SILHOUETTE_MAXIMUM_RATIO;
  withinBound: boolean;
}

/**
 * Measures one plan. NEVER throws and never refuses: it reports a number, and
 * the caller decides what a number that large means.
 *
 * That split is deliberate. `writeMidtownCoreV3Assets` calls this on every
 * building of every wave, including the five frozen single-LOD waves, and a
 * measurement that threw would turn a frozen release build into a failure over
 * a property those releases never claimed.
 */
export function midtownCoreV3SilhouetteMeasurement(plan: V3Plan): MidtownCoreV3SilhouetteMeasurement {
  const perView = MIDTOWN_CORE_V3_SILHOUETTE_VIEW_IDS.map((viewId) => {
    const lod0 = midtownCoreV3SilhouetteRectangles(plan, viewId, { includeAttachments: true });
    const lod1 = midtownCoreV3SilhouetteRectangles(plan, viewId, { includeAttachments: false });
    const lod0AreaMm2 = rectangleUnionAreaMm2(lod0);
    const lod1AreaMm2 = rectangleUnionAreaMm2(lod1);
    // |A xor B| = |A union B| - |A intersect B| = 2|A union B| - |A| - |B|.
    // Written in the general form rather than as |A| - |B|, so the instrument
    // stays correct if a future coarse level ever adds geometry of its own.
    const unionAreaMm2 = rectangleUnionAreaMm2([...lod0, ...lod1]);
    // Clamped at zero: the three areas are computed by the same float sweep, so
    // an exactly-equal pair can land a few parts in 1e16 below zero, and a
    // NEGATIVE deviation would be a nonsense number in a gate record.
    const symmetricDifferenceMm2 = Math.max(0, 2 * unionAreaMm2 - lod0AreaMm2 - lod1AreaMm2);
    return {
      viewId,
      lod0AreaMm2,
      lod1AreaMm2,
      deviationRatio: lod0AreaMm2 <= 0 ? Number.POSITIVE_INFINITY : symmetricDifferenceMm2 / lod0AreaMm2,
    };
  });
  const worst = perView.reduce((left, right) => (right.deviationRatio > left.deviationRatio ? right : left));
  return {
    buildingId: plan.buildingId,
    planHashSha256: plan.planHashSha256,
    method: MIDTOWN_CORE_V3_SILHOUETTE_METHOD,
    metricVersion: MIDTOWN_CORE_V3_SILHOUETTE_METRIC_VERSION,
    viewIds: [...MIDTOWN_CORE_V3_SILHOUETTE_VIEW_IDS],
    deviationRatio: worst.deviationRatio,
    worstViewId: worst.viewId,
    perView,
    maximumRatio: MIDTOWN_CORE_V3_SILHOUETTE_MAXIMUM_RATIO,
    withinBound: worst.deviationRatio <= MIDTOWN_CORE_V3_SILHOUETTE_MAXIMUM_RATIO,
  };
}

/**
 * The record a two-LOD assembly's coarse level must carry.
 *
 * The key set is EXACTLY what `multi-lod-assembly.ts` admits — it validates with
 * an exact-key check, so an extra field of provenance would be refused. Which is
 * why the instrument is documented at the top of this module and in ADR 0049
 * rather than described inside the value.
 */
export interface MidtownCoreV3SilhouetteRecord {
  status: "authoring-declared";
  method: typeof MIDTOWN_CORE_V3_SILHOUETTE_METHOD;
  metricVersion: typeof MIDTOWN_CORE_V3_SILHOUETTE_METRIC_VERSION;
  planHashSha256: string;
  viewIds: readonly string[];
  deviationRatio: number;
  maximumRatio: typeof MIDTOWN_CORE_V3_SILHOUETTE_MAXIMUM_RATIO;
}

/**
 * Builds that record, FAIL CLOSED.
 *
 * Two refusals, and neither is a `MidtownCoreV3Stop`. The stop-code vocabulary
 * is closed and pinned by a committed goal-completion record, and neither of
 * these is a statement that this grammar cannot carry some property of a sourced
 * polygon:
 *
 *   - a binding mismatch is the caller attaching a measurement to a plan it was
 *     not taken from, which is the repository contradicting itself;
 *   - a ratio over the cap is a building that CANNOT be shipped as a two-LOD
 *     asset under the approved LOD contract, and emitting the record anyway
 *     would push the refusal down to the assembly validator with the honest
 *     number already written into a release.
 */
export function midtownCoreV3SilhouetteRecord(
  plan: V3Plan,
  options: { expectedPlanHashSha256: string },
): MidtownCoreV3SilhouetteRecord {
  if (plan.planHashSha256 !== options.expectedPlanHashSha256) {
    throw new Error(
      `Silhouette measurement for ${plan.buildingId} would bind plan hash ${plan.planHashSha256}, but the asset it is being attached to declares ${options.expectedPlanHashSha256}.`,
    );
  }
  const measurement = midtownCoreV3SilhouetteMeasurement(plan);
  if (!measurement.withinBound) {
    throw new Error(
      `LOD 1 silhouette for ${plan.buildingId} deviates ${measurement.deviationRatio} from LOD 0 at ${measurement.worstViewId}, outside the approved ${MIDTOWN_CORE_V3_SILHOUETTE_MAXIMUM_RATIO} bound.`,
    );
  }
  return {
    status: "authoring-declared",
    method: MIDTOWN_CORE_V3_SILHOUETTE_METHOD,
    metricVersion: MIDTOWN_CORE_V3_SILHOUETTE_METRIC_VERSION,
    planHashSha256: plan.planHashSha256,
    viewIds: [...measurement.viewIds],
    deviationRatio: measurement.deviationRatio,
    maximumRatio: MIDTOWN_CORE_V3_SILHOUETTE_MAXIMUM_RATIO,
  };
}
