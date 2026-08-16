/**
 * What a SERVING composition actually costs the shared exterior cache, derived
 * from the committed retention inventories rather than remembered from a plan.
 *
 * `exterior-cache-ceiling.ts` answers the release-time question for the CURATED
 * composition: every promoted wave resident at once, 484 entries and ~117 MiB,
 * comfortably inside both caps. That question stops being the interesting one
 * when the whole island ships. 44,989 buildings at `lod_0` are 4.679 GB and
 * 44,989 entries; no cap holds them, none is meant to, and the number that
 * matters becomes "how much can the scheduler make resident AT ONCE".
 *
 * ## Three bounds, because only one of them is reachable
 *
 * The same idiom as the cache ceiling, for the same reason: collapsing them to
 * one number would be the estimate this task was told not to produce.
 *
 * - **`reachable`** — the worst value of "the `cap` cells nearest some camera",
 *   maximised over every cell centre in the committed extents census. This is
 *   the bound that matters, because the scheduler admits by proximity: it
 *   reserves the cells containing the camera, then admits intersecting cells
 *   ranked by distance band, then truncates at `maxResidentUnits`. A camera can
 *   stand anywhere, so the worst NEIGHBOURHOOD is reachable; the worst arbitrary
 *   SET is not.
 *
 * - **`heaviestSet`** — the `cap` heaviest cells anywhere on the island, summed.
 *   MODELLED and UNREACHABLE, and stated because it is the number a reader
 *   reaches for first and it is wrong: those cells are scattered across six
 *   waves and several kilometres, and no camera admits them together. It sits
 *   here so nobody has to re-derive it to find out it does not bind.
 *
 * - **`composition`** — every cell of the wave set at once. Not a cache bound at
 *   all at serving scale; it is the size of the thing being served, and it is
 *   reported so the ratio between what ships and what is ever resident is
 *   visible rather than implied.
 *
 * ## The sidecar is charged, not waved past
 *
 * A serving release fetches one `cell-detail-sidecar` per resident cell through
 * the same verified path as its GLBs, so it occupies one cache entry and its
 * bytes count against the same byte cap. Charging it is the difference between a
 * bound and a bound-shaped guess: at the worst anchor it is worth about twelve
 * mebibytes, which is most of the remaining headroom.
 *
 * ## What this deliberately does NOT claim
 *
 * Nothing about decoded GPU memory, which is not observable from the loader.
 * Nothing about hysteresis: a cell that has left the footprint stays resident
 * for `hysteresisDecisions` further decisions, so a MOVING camera can transiently
 * hold more than `cap` cells. That transient is a scheduler property measured by
 * the roam evidence, not a release-time bound, and pretending this module
 * covered it would be the more dangerous error.
 */

import { CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE, citywideOverviewCellExtent } from "./citywide-overview-cell-extents.ts";

/** The one shape this module needs out of a committed `payload-inventory.json`. */
export interface ExteriorServingInventoryFile {
  readonly path: string;
  readonly byteSize: number;
}

/** Exactly the level a serving release ships. `lod_1` stays retained-unserved. */
const SERVED_ASSET_PATH = /^public\/assets\/(.+)__lod_0\.glb$/u;

/**
 * Per-shipped-asset weight of the inventory and evidence pair a sidecar carries.
 *
 * MEASURED, from the three largest committed `-p1` release graphs: 18,637 /
 * 18,766 / 18,717 bytes per shipped asset. The largest is used, because a bound
 * built from the average of three would understate the worst wave by
 * construction. It is a constant here and a MEASUREMENT there, and
 * `exterior-serving-residency.test.ts` re-derives it from the committed graphs
 * so it cannot drift from the bytes it describes.
 */
export const EXTERIOR_SERVING_SIDECAR_BYTES_PER_ASSET = 18_766;

function fail(message: string): never {
  throw new Error(`Exterior serving residency: ${message}`);
}

export interface ExteriorServingCellOccupancy {
  readonly cellId: string;
  /** Cache entries this cell occupies: one per served GLB, PLUS its sidecar. */
  readonly entries: number;
  readonly buildingCount: number;
  readonly assetBytes: number;
  readonly sidecarBytes: number;
  readonly totalBytes: number;
}

/**
 * Fold committed inventories into per-cell occupancy.
 *
 * `ownerByBuildingId` comes from the committed ownership ledger and
 * `files` from the committed payload inventories, so this runs with NO payload
 * directory present — which is the whole point. A drift gate that needs six
 * gigabytes of local bytes to run is a drift gate that gets skipped.
 *
 * An asset whose building the ledger does not own is a REFUSAL rather than a
 * skip: it would mean the inventory and the ledger disagree about what was
 * generated, and silently dropping it would understate the bound.
 */
export function exteriorServingCellOccupancy(input: {
  files: readonly ExteriorServingInventoryFile[];
  ownerByBuildingId: ReadonlyMap<string, string>;
}): ExteriorServingCellOccupancy[] {
  const byCell = new Map<string, { entries: number; assetBytes: number }>();
  for (const file of input.files) {
    const matched = SERVED_ASSET_PATH.exec(file.path);
    if (!matched) continue;
    // `doitt-410284__lod_0.glb` names building `doitt:410284`: the emitter
    // replaces the FIRST colon only, so the inverse replaces the first hyphen.
    const buildingId = matched[1]!.replace("-", ":");
    const cellId = input.ownerByBuildingId.get(buildingId);
    if (cellId === undefined) fail(`inventory names asset ${file.path}, whose building ${buildingId} the committed ledger does not own.`);
    const bucket = byCell.get(cellId) ?? { entries: 0, assetBytes: 0 };
    bucket.entries += 1;
    bucket.assetBytes += file.byteSize;
    byCell.set(cellId, bucket);
  }
  return [...byCell.entries()]
    .map(([cellId, bucket]) => {
      const sidecarBytes = bucket.entries * EXTERIOR_SERVING_SIDECAR_BYTES_PER_ASSET;
      return {
        cellId,
        // One sidecar per cell, on top of one entry per served GLB.
        entries: bucket.entries + 1,
        buildingCount: bucket.entries,
        assetBytes: bucket.assetBytes,
        sidecarBytes,
        totalBytes: bucket.assetBytes + sidecarBytes,
      };
    })
    .sort((left, right) => (left.cellId < right.cellId ? -1 : left.cellId > right.cellId ? 1 : 0));
}

export interface ExteriorServingResidencyFigure {
  readonly entries: number;
  readonly bytes: number;
  readonly cellIds: readonly string[];
}

export interface ExteriorServingResidencyBound {
  readonly cap: number;
  readonly maxCacheEntries: number;
  readonly maxCachedBytes: number;
  readonly cellCount: number;
  /** REACHABLE: the worst `cap`-cell neighbourhood, over every camera anchor. */
  readonly reachable: ExteriorServingResidencyFigure;
  readonly reachableAnchorCellId: string;
  /** MODELLED and UNREACHABLE: the `cap` heaviest cells anywhere. */
  readonly heaviestSet: ExteriorServingResidencyFigure;
  /** The whole served composition; a size, not a cache bound. */
  readonly composition: ExteriorServingResidencyFigure;
  readonly entryRatio: number;
  readonly byteRatio: number;
  /** Which cap the REACHABLE bound meets first. */
  readonly bindingConstraint: "entries" | "bytes";
  readonly fitsEntryCap: boolean;
  readonly fitsByteCap: boolean;
}

function figure(cells: readonly ExteriorServingCellOccupancy[]): ExteriorServingResidencyFigure {
  return {
    entries: cells.reduce((sum, cell) => sum + cell.entries, 0),
    bytes: cells.reduce((sum, cell) => sum + cell.totalBytes, 0),
    cellIds: cells.map((cell) => cell.cellId).sort(),
  };
}

/**
 * The derivation.
 *
 * Distances use the extents census's own frozen planar scale, which is the
 * metric the scheduler ranks with — a geodesic here would be a more accurate
 * answer to a question the scheduler is not asking.
 *
 * Nearest-by-CENTRE is a deliberate simplification of the scheduler's
 * nearest-point-to-rectangle ranking, and it is the conservative direction for a
 * grid of comparable cells: it can only reorder cells at the boundary of the
 * admitted set, never admit a cell from another neighbourhood. It is named as a
 * model rather than presented as a replay of `selectResidentUnits`.
 */
export function exteriorServingResidencyBound(input: {
  cells: readonly ExteriorServingCellOccupancy[];
  cap: number;
  maxCacheEntries: number;
  maxCachedBytes: number;
}): ExteriorServingResidencyBound {
  if (input.cells.length === 0) fail("a residency bound over no cell is not a bound.");
  if (input.cap <= 0) fail("the residency cap must be positive.");
  if (input.maxCacheEntries <= 0 || input.maxCachedBytes <= 0) fail("the cache caps must both be positive.");

  const anchors = input.cells.map((cell) => {
    const extent = citywideOverviewCellExtent(cell.cellId);
    if (!extent) fail(`cell ${cell.cellId} has no entry in committed census ${CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE.censusId}, so its position is unknown and the bound would be computed over a hole.`);
    return {
      cell,
      longitude: (extent.renderBounds.west + extent.renderBounds.east) / 2,
      latitude: (extent.renderBounds.south + extent.renderBounds.north) / 2,
    };
  });

  const scaleX = CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE.metersPerDegreeLongitude;
  const scaleY = CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE.metersPerDegreeLatitude;
  let worst: { anchorCellId: string; cells: ExteriorServingCellOccupancy[]; bytes: number } | null = null;
  for (const anchor of anchors) {
    const nearest = [...anchors]
      .map((candidate) => ({
        candidate,
        distance: Math.hypot((candidate.longitude - anchor.longitude) * scaleX, (candidate.latitude - anchor.latitude) * scaleY),
      }))
      // Ties broken by cell id so the bound is deterministic rather than
      // dependent on input order.
      .sort((left, right) => (left.distance !== right.distance ? left.distance - right.distance : left.candidate.cell.cellId < right.candidate.cell.cellId ? -1 : 1))
      .slice(0, input.cap)
      .map((entry) => entry.candidate.cell);
    const bytes = nearest.reduce((sum, cell) => sum + cell.totalBytes, 0);
    if (worst === null || bytes > worst.bytes) worst = { anchorCellId: anchor.cell.cellId, cells: nearest, bytes };
  }
  const reachableCells = worst!.cells;
  const heaviest = [...input.cells].sort((left, right) => right.totalBytes - left.totalBytes).slice(0, input.cap);

  const reachable = figure(reachableCells);
  const entryRatio = reachable.entries / input.maxCacheEntries;
  const byteRatio = reachable.bytes / input.maxCachedBytes;
  return {
    cap: input.cap,
    maxCacheEntries: input.maxCacheEntries,
    maxCachedBytes: input.maxCachedBytes,
    cellCount: input.cells.length,
    reachable,
    reachableAnchorCellId: worst!.anchorCellId,
    heaviestSet: figure(heaviest),
    composition: figure(input.cells),
    entryRatio,
    byteRatio,
    bindingConstraint: byteRatio >= entryRatio ? "bytes" : "entries",
    fitsEntryCap: reachable.entries <= input.maxCacheEntries,
    fitsByteCap: reachable.bytes <= input.maxCachedBytes,
  };
}
