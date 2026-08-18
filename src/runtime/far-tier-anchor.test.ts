import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { farTierPlanarPlacementResidual, farTierTileAnchor, FarTierAnchorError, FAR_TIER_BAKE_FRAME, FAR_TIER_METERS_PER_DEGREE_LATITUDE, FAR_TIER_METERS_PER_DEGREE_LONGITUDE } from "./far-tier-anchor";
import { CITYWIDE_OVERVIEW_CELL_EXTENTS } from "./citywide-overview-cell-extents";
import { cellTileKey } from "../release/exterior-wave-ledger";
import { tileBounds } from "./spatial";

/** The T002 prototype cell, the one tile that has actually been baked. */
const PROTOTYPE_CELL = "manhattan-exterior-cell-w05-000747-17-38610-35822";

describe("farTierTileAnchor", () => {
  it("anchors on the tile rectangle the cell id names", () => {
    const anchor = farTierTileAnchor(PROTOTYPE_CELL);
    const expected = tileBounds(cellTileKey(PROTOTYPE_CELL)!);
    // The ledger's own invariant: a cell's bounds ARE its tile rectangle.
    expect(anchor.bounds).toEqual(expected);
    expect(anchor.originLongitude).toBe(expected.west);
    expect(anchor.originLatitude).toBe(expected.south);
  });

  it("does NOT anchor on renderBounds, which is wrong by construction", () => {
    // renderBounds is the union of the assignment rectangle with every member
    // building's outer ring, so it is deliberately LARGER than the tile. If the
    // anchor ever came from it, the tile would be displaced by the overhang —
    // differently for every cell — and it would look like a bake defect.
    const extent = CITYWIDE_OVERVIEW_CELL_EXTENTS.find((entry) => entry.cellId === PROTOTYPE_CELL);
    expect(extent, "prototype cell must be in the census for this test to mean anything").toBeDefined();
    const anchor = farTierTileAnchor(PROTOTYPE_CELL);
    expect(anchor.originLongitude).not.toBe(extent!.renderBounds.west);
    expect(anchor.originLatitude).not.toBe(extent!.renderBounds.south);
  });

  it("never reaches for renderBounds in its source", () => {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync("src/runtime/far-tier-anchor.ts"));
    // Mentioned only in the prohibition, never in an expression.
    expect(/renderBounds\s*[.[]/u.test(source), "far-tier-anchor must not read renderBounds").toBe(false);
  });

  it("refuses the Block 835 cell, whose id encodes no tile", () => {
    // It shipped before the wave ledger existed and carries a frozen suffix, so
    // there is no rectangle to anchor on. Refusing is the fail-closed direction;
    // guessing an origin would place a tile somewhere nobody baked it.
    expect(() => farTierTileAnchor("manhattan-exterior-cell-w00-000000-block-00835")).toThrow(FarTierAnchorError);
    try { farTierTileAnchor("manhattan-exterior-cell-w00-000000-block-00835"); }
    catch (error) { expect((error as FarTierAnchorError).code).toBe("block-835-alias"); }
  });

  it("refuses the Block 835 ALIAS spelling too", () => {
    // Both names must fail; resolving the alias and then anchoring on the
    // resolved id would defeat the refusal.
    expect(() => farTierTileAnchor("cell:manhattan:block-835")).toThrow(FarTierAnchorError);
  });

  it("states the bake frame explicitly rather than leaving it to a matrix", () => {
    expect(FAR_TIER_BAKE_FRAME.upAxis).toBe("y");
    expect(FAR_TIER_BAKE_FRAME.axes).toEqual(["east", "up", "-north"]);
    expect(FAR_TIER_BAKE_FRAME.origin).toContain("south-west corner");
  });

  it("uses the census's frozen planar scale, not a rederived one", () => {
    // These must match CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE exactly; the bake
    // converted degrees to metres with them and nothing else.
    expect(FAR_TIER_METERS_PER_DEGREE_LONGITUDE).toBe(84412.702);
    expect(FAR_TIER_METERS_PER_DEGREE_LATITUDE).toBe(111049.654);
  });
});

describe("farTierPlanarPlacementResidual", () => {
  it("measures the frozen-planar vs geodetic disagreement instead of assuming it away", () => {
    const residual = farTierPlanarPlacementResidual(PROTOTYPE_CELL);
    // The measurement is the deliverable; this test pins that it is small enough
    // to be sub-metre across one cell, so the record can state a number rather
    // than a hope. A regression that changed the scale constants would blow this.
    expect(residual.residualMeters).toBeGreaterThan(0);
    expect(residual.residualMeters).toBeLessThan(1);
  });
});
