/**
 * Per-wave promotion census for the near-tier curb release (Task T011).
 *
 * T010 promoted one wave and predicted that widening
 * `GROUND_EMBELLISHMENT_CANARY_WAVES` was the only edit the rest of the island
 * needed. This module is the evidence that widening it is SAFE: given one
 * measurement per shipped curb artifact, it reports what each exterior wave
 * costs the near tier, and it applies the two budget gates that decide whether
 * a wave may be named in that constant at all.
 *
 * Four rules it holds itself to, because a census that estimates is worth
 * nothing as a promotion gate:
 *
 * 1. **Nothing is re-derived that production already derives.** Wave rows come
 *    from `EXTERIOR_WAVE_PLAN`, the cell-to-row mapping from `groundCellTileKey`,
 *    the ring test from `activeGroundEmbellishmentCells`, and the ceilings from
 *    `GROUND_EMBELLISHMENT_BUDGETS`. The caller supplies wall and segment counts
 *    from `planGroundEmbellishmentCellRender` — the same function the viewport
 *    draws from — so a "segment" here is a segment the renderer would emit,
 *    including its degenerate-alignment refusals, rather than a count of
 *    coordinates in a file.
 * 2. **The measurements are of verified bytes.** This module cannot check that;
 *    its caller must, and `ground-embellishment-wave-census.test.ts` does, by
 *    hashing every artifact against the checksum `release.json` declares before
 *    it is measured. A byte count over unverified bytes measures whatever
 *    happens to be on disk.
 * 3. **A breach blocks promotion; it never raises a ceiling.** A wave whose
 *    artifact breaches the serving ceiling, or whose ring can hold more cells
 *    than `GROUND_EMBELLISHMENT_MAX_ACTIVE_CELLS`, is reported as breaching. The
 *    honest response is to leave that wave out of the constant with the reason
 *    recorded — an honest partial promotion — not to widen the budget the breach
 *    was measured against.
 * 4. **The report is deterministic.** No timestamps, no paths, sorted ids,
 *    integer counts. Re-running it over unchanged release bytes produces a
 *    byte-identical report, so any diff in the committed report is a real
 *    change in the release or in the promoted wave set.
 */

import {
  EXTERIOR_WAVE_PLAN,
  type ExteriorWaveDefinition,
  type ExteriorWaveId,
} from "./exterior-wave-ledger.ts";
import {
  GROUND_EMBELLISHMENT_BUDGETS,
  GROUND_EMBELLISHMENT_CANARY_WAVES,
  GROUND_EMBELLISHMENT_MAX_ACTIVE_CELLS,
  MANHATTAN_GROUND_EMBELLISHMENT_RELEASE_ID,
  activeGroundEmbellishmentCells,
} from "../runtime/ground-embellishment-runtime.ts";
import { groundCellTileKey, type GroundBounds } from "./ground-release.ts";

export const GROUND_EMBELLISHMENT_WAVE_CENSUS_SCHEMA_VERSION = "manhattan-ground-embellishment-wave-census-1" as const;

/**
 * Why `block-835` is not in the promoted set, stated where the report can carry
 * it rather than only in a commit message.
 */
export const GROUND_EMBELLISHMENT_NON_ROW_WAVE_REASON = "Declared building set carved out of a tile (tileRowRange: null), not an owner of level-14 rows, so it cannot scope a row-based ground gate; groundEmbellishmentCanaryTileRows refuses it by name rather than letting it contribute nothing. The ground beneath Block 835 lies in rows 4481-4482, which midtown-core promotes, so its curbs are served without a second name for rows another wave already owns." as const;

/** One shipped curb artifact, measured. Every field is counted, never estimated. */
export interface GroundEmbellishmentCellMeasurement {
  cellId: string;
  order: number;
  bounds: GroundBounds;
  /** The tier's own declared ring, carried so the census measures the release's number. */
  maxDistanceMeters: number;
  artifactBytes: number;
  curbParts: number;
  drawnWalls: number;
  drawnSegments: number;
  /** Parts the render planner refuses as degenerate; shipped, but never drawn. */
  refusedParts: number;
}

export interface GroundEmbellishmentRingWorstCase {
  /** The most cells any one ground point can put inside the declared ring. */
  cells: number;
  at: { longitude: number; latitude: number } | null;
  cellIds: string[];
}

export interface GroundEmbellishmentArtifactExtreme {
  cellId: string;
  bytes: number;
  fractionOfServingCeiling: number;
  overServingCeiling: boolean;
}

export interface GroundEmbellishmentWaveCensusEntry {
  waveIndex: number;
  waveId: ExteriorWaveId;
  tileRowRange: { northRowY: number; southRowY: number };
  promoted: boolean;
  cellsWithCurbArtifacts: number;
  totalArtifactBytes: number;
  curbParts: number;
  drawnWalls: number;
  drawnSegments: number;
  drawnTriangles: number;
  refusedParts: number;
  largestArtifact: GroundEmbellishmentArtifactExtreme | null;
  worstCaseActiveSet: GroundEmbellishmentRingWorstCase;
  breachesBudget: boolean;
}

export interface GroundEmbellishmentBudgetBreach {
  waveId: string;
  artifactsOverServingCeiling: string[];
  worstCaseActiveCells: number;
  maxActiveCells: number;
}

export interface GroundEmbellishmentWaveCensusReport {
  schemaVersion: typeof GROUND_EMBELLISHMENT_WAVE_CENSUS_SCHEMA_VERSION;
  releaseId: string;
  note: string;
  servingCeilingBytes: number;
  maxActiveCells: number;
  promotedWaves: ExteriorWaveId[];
  wavesWithoutTileRows: { waveId: ExteriorWaveId; reason: string }[];
  waves: GroundEmbellishmentWaveCensusEntry[];
  promotedRelease: {
    cellsWithCurbArtifacts: number;
    totalArtifactBytes: number;
    curbParts: number;
    drawnWalls: number;
    drawnSegments: number;
    drawnTriangles: number;
    refusedParts: number;
    largestArtifact: GroundEmbellishmentArtifactExtreme | null;
    worstCaseActiveSet: GroundEmbellishmentRingWorstCase;
  };
  shippedCellsInNoWaveRow: { note: string; cellIds: string[]; totalArtifactBytes: number };
  budgetBreaches: GroundEmbellishmentBudgetBreach[];
}

/**
 * The wave that owns a ground cell's level-14 row, or `null`.
 *
 * A row no wave owns is a real category rather than an error: the ground
 * partition outward-snaps the declared extent to 140 level-14 cells and reaches
 * row 4489, which is south of every building wave. Those cells ship curbs and
 * are simply never promoted, which the report states rather than omits.
 */
export function groundEmbellishmentWaveForCell(cellId: string): ExteriorWaveDefinition | null {
  let tile;
  try {
    tile = groundCellTileKey(cellId);
  } catch {
    return null;
  }
  if (tile.level !== 14) return null;
  for (const wave of EXTERIOR_WAVE_PLAN) {
    if (wave.tileRowRange === null) continue;
    if (tile.y >= wave.tileRowRange.northRowY && tile.y <= wave.tileRowRange.southRowY) return wave;
  }
  return null;
}

/**
 * The most cells any single ground point can put inside the declared ring.
 *
 * The T010 corner method, applied to a measured set rather than argued about. A
 * level-14 cell is about 1.22 km of latitude and 1.85 km of longitude at this
 * latitude, both larger than the 400 m ring the release declares, so no point
 * can be within the ring of two cells that do not touch — which makes a shared
 * cell corner the only place the count can be maximized. Each candidate corner
 * is then handed to the PRODUCTION activation function with the cap lifted, so
 * the number reported is what the ring admits rather than what the budget
 * allows; comparing the two is the whole point of the guard.
 */
export function groundEmbellishmentRingWorstCase(
  cells: readonly GroundEmbellishmentCellMeasurement[],
): GroundEmbellishmentRingWorstCase {
  const servingCells = cells.map((cell) => ({
    cellId: cell.cellId,
    groundClass: "curb" as const,
    bounds: cell.bounds,
    maxDistanceMeters: cell.maxDistanceMeters,
    order: cell.order,
  }));
  let best: GroundEmbellishmentRingWorstCase = { cells: 0, at: null, cellIds: [] };
  const seen = new Set<string>();
  for (const cell of cells) {
    for (const longitude of [cell.bounds.west, cell.bounds.east]) {
      for (const latitude of [cell.bounds.south, cell.bounds.north]) {
        const key = `${longitude},${latitude}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const active = activeGroundEmbellishmentCells({
          groundCenter: { longitude, latitude },
          cells: servingCells,
          maxActiveCells: Math.max(servingCells.length, 1),
        });
        if (active.length > best.cells) {
          best = { cells: active.length, at: { longitude, latitude }, cellIds: active.map((entry) => entry.cellId).sort() };
        }
      }
    }
  }
  return best;
}

interface Totals {
  cellsWithCurbArtifacts: number;
  totalArtifactBytes: number;
  curbParts: number;
  drawnWalls: number;
  drawnSegments: number;
  drawnTriangles: number;
  refusedParts: number;
}

function totalsOf(cells: readonly GroundEmbellishmentCellMeasurement[]): Totals {
  const totals: Totals = {
    cellsWithCurbArtifacts: 0,
    totalArtifactBytes: 0,
    curbParts: 0,
    drawnWalls: 0,
    drawnSegments: 0,
    drawnTriangles: 0,
    refusedParts: 0,
  };
  for (const cell of cells) {
    totals.cellsWithCurbArtifacts += 1;
    totals.totalArtifactBytes += cell.artifactBytes;
    totals.curbParts += cell.curbParts;
    totals.drawnWalls += cell.drawnWalls;
    totals.drawnSegments += cell.drawnSegments;
    // The render plan's own documented identity: a wall is two triangles per
    // segment. Stated where it is applied so it cannot drift from that module.
    totals.drawnTriangles += cell.drawnSegments * 2;
    totals.refusedParts += cell.refusedParts;
  }
  return totals;
}

function largestOf(
  cells: readonly GroundEmbellishmentCellMeasurement[],
  ceilingBytes: number,
): GroundEmbellishmentArtifactExtreme | null {
  let largest: GroundEmbellishmentCellMeasurement | null = null;
  for (const cell of cells) if (largest === null || cell.artifactBytes > largest.artifactBytes) largest = cell;
  if (largest === null) return null;
  return {
    cellId: largest.cellId,
    bytes: largest.artifactBytes,
    fractionOfServingCeiling: largest.artifactBytes / ceilingBytes,
    overServingCeiling: largest.artifactBytes > ceilingBytes,
  };
}

/**
 * The census, and the promotion gate it exists to be.
 *
 * `promotedWaves` defaults to the live constant, so the report always describes
 * the wave set the application is actually serving. Passing an explicit set is
 * how a rehearsal asks "what WOULD this wave cost" before its name is added.
 */
export function buildGroundEmbellishmentWaveCensus(
  measurements: readonly GroundEmbellishmentCellMeasurement[],
  promotedWaves: readonly ExteriorWaveId[] = GROUND_EMBELLISHMENT_CANARY_WAVES,
): GroundEmbellishmentWaveCensusReport {
  const ceilingBytes = GROUND_EMBELLISHMENT_BUDGETS.maxArtifactBytes;
  const promoted = new Set(promotedWaves);
  const ordered = [...measurements].sort((left, right) => left.order - right.order);
  const waveOf = new Map(ordered.map((cell) => [cell.cellId, groundEmbellishmentWaveForCell(cell.cellId)]));
  const breaches: GroundEmbellishmentBudgetBreach[] = [];

  const waves: GroundEmbellishmentWaveCensusEntry[] = [];
  for (const wave of EXTERIOR_WAVE_PLAN) {
    if (wave.tileRowRange === null) continue;
    const cells = ordered.filter((cell) => waveOf.get(cell.cellId)?.waveId === wave.waveId);
    const totals = totalsOf(cells);
    const worstCaseActiveSet = groundEmbellishmentRingWorstCase(cells);
    const artifactsOverServingCeiling = cells.filter((cell) => cell.artifactBytes > ceilingBytes).map((cell) => cell.cellId);
    const ringBreach = worstCaseActiveSet.cells > GROUND_EMBELLISHMENT_MAX_ACTIVE_CELLS;
    const breachesBudget = artifactsOverServingCeiling.length > 0 || ringBreach;
    if (breachesBudget) {
      breaches.push({
        waveId: wave.waveId,
        artifactsOverServingCeiling,
        worstCaseActiveCells: worstCaseActiveSet.cells,
        maxActiveCells: GROUND_EMBELLISHMENT_MAX_ACTIVE_CELLS,
      });
    }
    waves.push({
      waveIndex: wave.waveIndex,
      waveId: wave.waveId,
      tileRowRange: wave.tileRowRange,
      promoted: promoted.has(wave.waveId),
      ...totals,
      largestArtifact: largestOf(cells, ceilingBytes),
      worstCaseActiveSet,
      breachesBudget,
    });
  }

  const promotedCells = ordered.filter((cell) => {
    const wave = waveOf.get(cell.cellId);
    return wave !== null && wave !== undefined && promoted.has(wave.waveId);
  });
  const promotedWorstCase = groundEmbellishmentRingWorstCase(promotedCells);
  if (promotedWorstCase.cells > GROUND_EMBELLISHMENT_MAX_ACTIVE_CELLS) {
    breaches.push({
      waveId: "*promoted-release*",
      artifactsOverServingCeiling: [],
      worstCaseActiveCells: promotedWorstCase.cells,
      maxActiveCells: GROUND_EMBELLISHMENT_MAX_ACTIVE_CELLS,
    });
  }
  const unownedCells = ordered.filter((cell) => waveOf.get(cell.cellId) === null);

  return {
    schemaVersion: GROUND_EMBELLISHMENT_WAVE_CENSUS_SCHEMA_VERSION,
    releaseId: MANHATTAN_GROUND_EMBELLISHMENT_RELEASE_ID,
    note: "Per-wave cost of the near-tier curb release, measured over checksum-verified shipped artifacts. Wall and segment counts come from the production render planner, so refusedParts are alignments the viewport would decline to extrude rather than parts missing from the release; triangles are two per segment, that planner's own identity. worstCaseActiveSet is the most cells any single ground point can put inside the release's declared 400 m ring, evaluated by the production activation function with its cap lifted.",
    servingCeilingBytes: ceilingBytes,
    maxActiveCells: GROUND_EMBELLISHMENT_MAX_ACTIVE_CELLS,
    promotedWaves: [...promotedWaves],
    wavesWithoutTileRows: EXTERIOR_WAVE_PLAN
      .filter((wave) => wave.tileRowRange === null)
      .map((wave) => ({ waveId: wave.waveId, reason: GROUND_EMBELLISHMENT_NON_ROW_WAVE_REASON })),
    waves,
    promotedRelease: {
      ...totalsOf(promotedCells),
      largestArtifact: largestOf(promotedCells, ceilingBytes),
      worstCaseActiveSet: promotedWorstCase,
    },
    shippedCellsInNoWaveRow: {
      note: "Cells that ship a curb artifact but sit in a level-14 row no building wave owns. They are never promoted and never activate: the ground partition outward-snaps past the wave plan's southernmost row.",
      cellIds: unownedCells.map((cell) => cell.cellId).sort(),
      totalArtifactBytes: unownedCells.reduce((sum, cell) => sum + cell.artifactBytes, 0),
    },
    budgetBreaches: breaches,
  };
}

/** The exact bytes the committed report is written and compared as. */
export function serializeGroundEmbellishmentWaveCensus(report: GroundEmbellishmentWaveCensusReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
