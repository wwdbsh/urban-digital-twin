import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { sha256HexBytes } from "../domain/deterministic-hash";
import { citywideOverviewCellExtent, CITYWIDE_OVERVIEW_CELL_EXTENTS, CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE, CITYWIDE_OVERVIEW_CELL_ID_ALIASES } from "./citywide-overview-cell-extents";

/**
 * The delivery-path gate.
 *
 * The scheduler culls on rectangles that live in `src/`, generated from a
 * committed census that lives in `data/`. Two copies of the same numbers is a
 * drift risk, so this suite is the thing that makes it not one: it re-hashes the
 * census, checks that digest against BOTH the committed sidecar and the digest
 * frozen into the generated module, and then re-derives every row. A census that
 * moves without the module being regenerated fails here rather than culling
 * geometry against stale rectangles in a browser.
 */

const CENSUS_PATH = "data/citywide-overview-census-20260814/cell-extents.json";
const SIDECAR_PATH = "data/citywide-overview-census-20260814/cell-extents.sha256";

interface CensusRow {
  cellId: string;
  order: number;
  buildingCount: number;
  assignmentBounds: { west: number; south: number; east: number; north: number };
  renderBounds: { west: number; south: number; east: number; north: number };
}

function readText(path: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(readFileSync(path)));
}

const censusBytes = new Uint8Array(readFileSync(CENSUS_PATH));
const censusDigest = sha256HexBytes(censusBytes);
const census = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(censusBytes)) as { censusId: string; cells: CensusRow[]; overhangMetric: { metersPerDegreeLongitude: number; metersPerDegreeLatitude: number } };

describe("citywide overview cell extents, as delivered to the scheduler", () => {
  it("fails closed on any drift between the committed census and the generated module", () => {
    const sidecar = readText(SIDECAR_PATH).trim().split(/\s+/u)[0];
    expect(censusDigest).toBe(sidecar);
    expect(CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE.fileSha256).toBe(censusDigest);
    expect(CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE.file).toBe(CENSUS_PATH);
    expect(CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE.censusId).toBe(census.censusId);
  });

  it("carries every census row verbatim, in census order", () => {
    const expected = [...census.cells].sort((left, right) => left.order - right.order).map((row) => ({ cellId: row.cellId, order: row.order, renderBounds: row.renderBounds }));
    expect(CITYWIDE_OVERVIEW_CELL_EXTENTS).toEqual(expected);
    expect(CITYWIDE_OVERVIEW_CELL_EXTENTS).toHaveLength(883);
    expect(CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE.cellCount).toBe(883);
  });

  it("carries the census planar metric rather than a scale invented here", () => {
    expect(CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE.metersPerDegreeLongitude).toBe(census.overhangMetric.metersPerDegreeLongitude);
    expect(CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE.metersPerDegreeLatitude).toBe(census.overhangMetric.metersPerDegreeLatitude);
  });

  /**
   * The one structural property that makes `assignmentBounds` unreachable rather
   * than merely discouraged: it is not in the module at all. A future caller
   * cannot cull on it by accident because there is nothing to reach for.
   */
  it("delivers renderBounds only, never the assignment rectangle", () => {
    const source = readText("src/runtime/citywide-overview-cell-extents.ts");
    expect(source).not.toContain("assignmentBounds");
    for (const entry of CITYWIDE_OVERVIEW_CELL_EXTENTS) expect(Object.keys(entry).sort()).toEqual(["cellId", "order", "renderBounds"]);
  });

  it("resolves the Block 835 release cell id through the proven ledger alias", () => {
    expect(CITYWIDE_OVERVIEW_CELL_ID_ALIASES).toEqual({ "cell:manhattan:block-835": "manhattan-exterior-cell-w00-000000-block-00835" });
    const aliased = citywideOverviewCellExtent("cell:manhattan:block-835");
    expect(aliased?.cellId).toBe("manhattan-exterior-cell-w00-000000-block-00835");
    expect(aliased?.order).toBe(0);
    // Proven from the shipped release graph, not from the names looking similar:
    // the census extent must contain the bounds the release itself declares.
    const graph = JSON.parse(readText("public/data/manhattan-exterior-cells-20260811-v3/release-graph.json")) as { ownershipLedger: { cells: Array<{ cellId: string; order: number; bounds: { west: number; south: number; east: number; north: number }; buildingIds: string[] }> } };
    const shipped = graph.ownershipLedger.cells.find((cell) => cell.cellId === "cell:manhattan:block-835");
    expect(shipped).toBeDefined();
    expect(shipped?.order).toBe(aliased?.order);
    expect(shipped?.buildingIds).toHaveLength(14);
    expect(aliased!.renderBounds.west).toBeLessThanOrEqual(shipped!.bounds.west);
    expect(aliased!.renderBounds.east).toBeGreaterThanOrEqual(shipped!.bounds.east);
    expect(aliased!.renderBounds.south).toBeLessThanOrEqual(shipped!.bounds.south);
    expect(aliased!.renderBounds.north).toBeGreaterThanOrEqual(shipped!.bounds.north);
  });

  it("returns null rather than a guess for a cell the census does not carry", () => {
    expect(citywideOverviewCellExtent("c1")).toBeNull();
    expect(citywideOverviewCellExtent("manhattan-exterior-cell-w09-999999-16-0-0")).toBeNull();
  });

  /**
   * The reason the whole delivery path exists. If the render extent equalled the
   * assignment rectangle everywhere, culling on either would be the same
   * decision and this module would be redundant. It does not: 870 of 883 cells
   * extend beyond their assignment rectangle.
   */
  it("proves the render extent is materially larger than the assignment rectangle", () => {
    const larger = census.cells.filter((row) => (
      row.renderBounds.west < row.assignmentBounds.west || row.renderBounds.east > row.assignmentBounds.east ||
      row.renderBounds.south < row.assignmentBounds.south || row.renderBounds.north > row.assignmentBounds.north
    ));
    expect(larger).toHaveLength(870);
  });
});
