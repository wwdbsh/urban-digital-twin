/**
 * What a TWO-LOD serving composition costs the shared exterior cache (T001).
 *
 * `exterior-serving-residency.ts` answers this for the single-LOD `-s1`
 * composition and its three-bound idiom is reused verbatim here. It is left
 * untouched: it describes what ships today, and a bound that moved with the code
 * it gates would not be a bound.
 *
 * ## The one thing that changes, and it changes the answer
 *
 * A `-s2` release ships both levels but the runtime FETCHES ONE. `selectExteriorLod`
 * picks a single level per building and only that artifact reaches
 * `loadVerifiedArtifact`, so a resident cell costs one entry per building either
 * way — what moves is BYTES, and it moves DOWNWARD: textured `lod_1` is 45.31%
 * of `lod_0` across the island.
 *
 * That inverts the constraint that forced `maxResidentUnits` to 8. Under
 * `lod_0`-only serving the worst reachable neighbourhood is 92.0% of the byte
 * cap. With a 400 m near ring it is 59.0%.
 *
 * ## Why the threshold is compared against the cell CENTRE
 *
 * The same deliberate simplification `exterior-serving-residency.ts` names: the
 * scheduler ranks by nearest-point-to-rectangle, and centre distance can only
 * reorder cells at the boundary of the admitted set. Here it additionally
 * decides which SIDE of the threshold a cell falls on, so a cell straddling the
 * boundary is charged wholly at one level. That is a model, and it is the reason
 * the amplification allowance in ADR 0057 §4.1 exists as a separate registered
 * bound rather than being folded into this one.
 *
 * ## What this does NOT claim
 *
 * Nothing about hysteresis, decoded GPU memory, or the transient in which one
 * cell holds both levels. That transient is registered as an amplification
 * ALLOWANCE in ADR 0057 §4.1 and measured by T007; `twoLodAmplificationCeiling`
 * below states its modelled ceiling only so nobody re-derives it and mistakes it
 * for a reachable figure.
 */

import { CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE, citywideOverviewCellExtent } from "./citywide-overview-cell-extents.ts";
import {
  EXTERIOR_SERVING_ASSEMBLY_BYTES_PER_ASSET,
  EXTERIOR_SERVING_SIDECAR_BYTES_PER_ASSET,
  type ExteriorServingInventoryFile,
} from "./exterior-serving-residency.ts";

/**
 * The T001 near-ring threshold, in metres (ADR 0057 §1.4).
 *
 * DERIVED: the median cell diagonal of the committed extents census is 316.5 m,
 * which is the outer edge of the camera cell's adjacent ring. Rounded up to the
 * next 100 m — a stated convention, not a measurement.
 *
 * It is NOT a scheduler distance-band edge. ADR 0044 §1.1 recorded that those
 * edges are sort keys rather than admission tests, and at 1,200 m the mid ring
 * contains zero resident cells at the live cap of 8.
 */
export const EXTERIOR_TWO_LOD_NEAR_RING_METERS = 400;

function fail(message: string): never {
  throw new Error(`Exterior two-LOD residency: ${message}`);
}

const LOD0_PATH = /^public\/assets\/(.+)__lod_0\.glb$/u;
const LOD1_PATH = /^public\/assets\/(.+)__lod_1\.glb$/u;

/** `doitt-410284__lod_0.glb` names `doitt:410284`: the emitter replaced the FIRST colon only. */
function buildingIdOf(slug: string): string {
  return slug.replace("-", ":");
}

export interface ExteriorTwoLodCellOccupancy {
  readonly cellId: string;
  readonly entries: number;
  readonly buildingCount: number;
  /** Buildings whose `lod_1` is INELIGIBLE (ADR 0050); they cost `lod_0` at every distance. */
  readonly fallbackCount: number;
  /** Total bytes when this cell is inside the near ring: every building at `lod_0`. */
  readonly nearBytes: number;
  /** Total bytes when this cell is beyond it: `lod_1`, except the fallback parents. */
  readonly midBytes: number;
}

/**
 * Fold the committed `-c1` and `-c2` inventories into per-cell two-LOD occupancy.
 *
 * A building the ledger does not own is a REFUSAL rather than a skip, and so is
 * a non-fallback building with no `-c2` `lod_1`: both would mean the committed
 * records disagree about what exists, and either silently understates the bound.
 */
export function exteriorTwoLodCellOccupancy(input: {
  /** `-c1` inventory files; the `lod_0` bytes a near cell serves. */
  lod0Files: readonly ExteriorServingInventoryFile[];
  /** `-c2` inventory files; the textured `lod_1` bytes a mid cell serves. */
  lod1Files: readonly ExteriorServingInventoryFile[];
  ownerByBuildingId: ReadonlyMap<string, string>;
  /** The measured-fallback parents, whose `lod_1` is ineligible. */
  fallbackBuildingIds: ReadonlySet<string>;
}): ExteriorTwoLodCellOccupancy[] {
  const lod1ByBuilding = new Map<string, number>();
  for (const file of input.lod1Files) {
    const matched = LOD1_PATH.exec(file.path);
    if (matched) lod1ByBuilding.set(buildingIdOf(matched[1]!), file.byteSize);
  }

  const byCell = new Map<string, { n: number; fallback: number; near: number; mid: number }>();
  for (const file of input.lod0Files) {
    const matched = LOD0_PATH.exec(file.path);
    if (!matched) continue;
    const buildingId = buildingIdOf(matched[1]!);
    const cellId = input.ownerByBuildingId.get(buildingId);
    if (cellId === undefined) fail(`inventory names asset ${file.path}, whose building ${buildingId} the committed ledger does not own.`);
    const isFallback = input.fallbackBuildingIds.has(buildingId);
    const lod1Bytes = lod1ByBuilding.get(buildingId);
    if (!isFallback && lod1Bytes === undefined) {
      fail(`building ${buildingId} is not a measured fallback yet no committed -c2 inventory declares its lod_1; the mid-ring bound would be computed over a hole.`);
    }
    const bucket = byCell.get(cellId) ?? { n: 0, fallback: 0, near: 0, mid: 0 };
    bucket.n += 1;
    bucket.near += file.byteSize;
    // A fallback parent serves lod_0 WHEREVER it is resident, so it charges
    // lod_0 bytes to the mid ring too. Dropping this term would understate every
    // mid-ring cell that carries one, and w03 carries 289 of the 424.
    bucket.mid += isFallback ? file.byteSize : lod1Bytes!;
    if (isFallback) bucket.fallback += 1;
    byCell.set(cellId, bucket);
  }

  return [...byCell.entries()]
    .map(([cellId, bucket]) => {
      const overhead = bucket.n * (EXTERIOR_SERVING_SIDECAR_BYTES_PER_ASSET + EXTERIOR_SERVING_ASSEMBLY_BYTES_PER_ASSET);
      return {
        cellId,
        // One entry per served GLB, plus the cell's evidence sidecar and its own
        // assembly manifest — both separately fetched, separately pinned
        // documents on the verified path (ADR 0052 §2). Unchanged by the level
        // served, because only one level is ever fetched.
        entries: bucket.n + 2,
        buildingCount: bucket.n,
        fallbackCount: bucket.fallback,
        nearBytes: bucket.near + overhead,
        midBytes: bucket.mid + overhead,
      };
    })
    .sort((left, right) => (left.cellId < right.cellId ? -1 : left.cellId > right.cellId ? 1 : 0));
}

export interface ExteriorTwoLodResidencyBound {
  readonly cap: number;
  readonly nearRingMeters: number;
  readonly maxCacheEntries: number;
  readonly maxCachedBytes: number;
  readonly cellCount: number;
  readonly reachableBytes: number;
  readonly reachableEntries: number;
  readonly reachableAnchorCellId: string;
  /** Cells of the worst neighbourhood that fall BEYOND the near ring. */
  readonly midRingCellCount: number;
  /** Distance to the outermost cell of the worst neighbourhood. */
  readonly residentRadiusMeters: number;
  readonly entryRatio: number;
  readonly byteRatio: number;
  readonly bindingConstraint: "entries" | "bytes";
  readonly fitsEntryCap: boolean;
  readonly fitsByteCap: boolean;
}

interface Anchor {
  readonly cell: ExteriorTwoLodCellOccupancy;
  readonly longitude: number;
  readonly latitude: number;
}

function anchorsOf(cells: readonly ExteriorTwoLodCellOccupancy[]): Anchor[] {
  return cells.map((cell) => {
    const extent = citywideOverviewCellExtent(cell.cellId);
    if (!extent) fail(`cell ${cell.cellId} has no entry in committed census ${CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE.censusId}, so the bound would be computed over a hole.`);
    return {
      cell,
      longitude: (extent.renderBounds.west + extent.renderBounds.east) / 2,
      latitude: (extent.renderBounds.south + extent.renderBounds.north) / 2,
    };
  });
}

function nearestOf(anchors: readonly Anchor[], anchor: Anchor, cap: number): Array<{ cell: ExteriorTwoLodCellOccupancy; distance: number }> {
  const scaleX = CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE.metersPerDegreeLongitude;
  const scaleY = CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE.metersPerDegreeLatitude;
  return [...anchors]
    .map((candidate) => ({
      cell: candidate.cell,
      distance: Math.hypot((candidate.longitude - anchor.longitude) * scaleX, (candidate.latitude - anchor.latitude) * scaleY),
    }))
    // Ties broken by cell id so the bound is deterministic rather than
    // dependent on input order.
    .sort((left, right) => (left.distance !== right.distance ? left.distance - right.distance : left.cell.cellId < right.cell.cellId ? -1 : 1))
    .slice(0, cap);
}

/**
 * The REACHABLE bound: the worst `cap`-cell neighbourhood over every anchor,
 * with each cell charged at the level its distance selects.
 */
export function exteriorTwoLodResidencyBound(input: {
  cells: readonly ExteriorTwoLodCellOccupancy[];
  cap: number;
  nearRingMeters: number;
  maxCacheEntries: number;
  maxCachedBytes: number;
}): ExteriorTwoLodResidencyBound {
  if (input.cells.length === 0) fail("a residency bound over no cell is not a bound.");
  if (input.cap <= 0) fail("the residency cap must be positive.");
  if (!(input.nearRingMeters > 0)) fail("the near-ring threshold must be a positive distance.");
  const anchors = anchorsOf(input.cells);

  let worst: { anchorCellId: string; bytes: number; entries: number; midCells: number; radius: number } | null = null;
  for (const anchor of anchors) {
    const nearest = nearestOf(anchors, anchor, input.cap);
    let bytes = 0;
    let entries = 0;
    let midCells = 0;
    for (const entry of nearest) {
      const beyond = entry.distance > input.nearRingMeters;
      bytes += beyond ? entry.cell.midBytes : entry.cell.nearBytes;
      entries += entry.cell.entries;
      if (beyond) midCells += 1;
    }
    if (worst === null || bytes > worst.bytes) {
      worst = { anchorCellId: anchor.cell.cellId, bytes, entries, midCells, radius: nearest[nearest.length - 1]!.distance };
    }
  }

  const entryRatio = worst!.entries / input.maxCacheEntries;
  const byteRatio = worst!.bytes / input.maxCachedBytes;
  return {
    cap: input.cap,
    nearRingMeters: input.nearRingMeters,
    maxCacheEntries: input.maxCacheEntries,
    maxCachedBytes: input.maxCachedBytes,
    cellCount: input.cells.length,
    reachableBytes: worst!.bytes,
    reachableEntries: worst!.entries,
    reachableAnchorCellId: worst!.anchorCellId,
    midRingCellCount: worst!.midCells,
    residentRadiusMeters: worst!.radius,
    entryRatio,
    byteRatio,
    bindingConstraint: byteRatio >= entryRatio ? "bytes" : "entries",
    fitsEntryCap: worst!.entries <= input.maxCacheEntries,
    fitsByteCap: worst!.bytes <= input.maxCachedBytes,
  };
}

export interface ExteriorTwoLodAmplificationCeiling {
  readonly cap: number;
  readonly bytes: number;
  readonly entries: number;
  readonly anchorCellId: string;
  readonly reachable: false;
}

/**
 * The MODELLED ceiling in which every resident cell holds BOTH levels at once.
 *
 * Stated so nobody re-derives it and mistakes it for a bound. It is not
 * reachable by translation: the resident cells sit at distinct distances and a
 * single threshold crosses them one at a time. ADR 0057 §4.1 registers the
 * reachable ALLOWANCE — how many cells may double before a cap binds — which is
 * the falsifiable number.
 */
export function twoLodAmplificationCeiling(input: {
  cells: readonly ExteriorTwoLodCellOccupancy[];
  cap: number;
}): ExteriorTwoLodAmplificationCeiling {
  const anchors = anchorsOf(input.cells);
  let worst: { anchorCellId: string; bytes: number; entries: number } | null = null;
  for (const anchor of anchors) {
    let bytes = 0;
    let entries = 0;
    for (const entry of nearestOf(anchors, anchor, input.cap)) {
      const overhead = entry.cell.buildingCount * (EXTERIOR_SERVING_SIDECAR_BYTES_PER_ASSET + EXTERIOR_SERVING_ASSEMBLY_BYTES_PER_ASSET);
      // Both GLB sets, but ONE sidecar and ONE manifest: those documents do not
      // duplicate when the level changes.
      bytes += (entry.cell.nearBytes - overhead) + (entry.cell.midBytes - overhead) + overhead;
      entries += entry.cell.buildingCount * 2 + 2;
    }
    if (worst === null || bytes > worst.bytes) worst = { anchorCellId: anchor.cell.cellId, bytes, entries };
  }
  return { cap: input.cap, bytes: worst!.bytes, entries: worst!.entries, anchorCellId: worst!.anchorCellId, reachable: false };
}
