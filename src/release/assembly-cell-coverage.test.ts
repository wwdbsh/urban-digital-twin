/**
 * The refined assembly-cell coverage rule.
 *
 * The rule replaced exact membership equality between an assembly cell and its
 * owned cell. Equality prevented a package silently covering fewer buildings
 * than the cell claims; it also made a cell containing a REFUSED building
 * unrepresentable, because the assembly validator independently forbids listing
 * a building with no asset. These tests pin BOTH halves: the honest subset is
 * admitted, and every way of losing the anti-silent-omission property is still
 * refused.
 */
import { describe, expect, it } from "vitest";

import { assemblyCellCoverage, assemblyCellMembershipChecksum } from "./multi-lod-assembly.ts";

const OWNED = ["doitt:1", "doitt:2", "doitt:3", "doitt:4"];

function coverage(packaged: readonly string[], unavailable: readonly string[], checksum?: string) {
  return assemblyCellCoverage({
    packagedBuildingIds: packaged,
    ownedBuildingIds: OWNED,
    unavailableBuildingIds: unavailable,
    declaredMembershipChecksumSha256: checksum ?? assemblyCellMembershipChecksum(packaged),
  });
}

describe("assembly cell coverage", () => {
  it("admits a fully packaged cell, which is what every existing package is", () => {
    expect(coverage(OWNED, [])).toEqual({ ok: true });
    // Byte-neutrality: for a fully packaged cell the re-derived checksum is the
    // ownership cell's own derivation, so committed packages keep their bytes.
    expect(assemblyCellMembershipChecksum(OWNED)).toBe(assemblyCellMembershipChecksum([...OWNED].reverse()));
  });

  it("admits a strict subset when the remainder is exactly the unavailable set", () => {
    expect(coverage(["doitt:1", "doitt:3"], ["doitt:2", "doitt:4"])).toEqual({ ok: true });
    expect(coverage([], OWNED)).toEqual({ ok: true });
  });

  it("refuses a building that is neither packaged nor declared unavailable", () => {
    // The silent omission the original equality rule existed to prevent. It is
    // still refused, and now the message names the building.
    const result = coverage(["doitt:1", "doitt:2"], ["doitt:3"]);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("doitt:4");
    expect(result.ok === false && result.message).toContain("neither packaged nor declared unavailable");
  });

  it("refuses a building that is BOTH packaged and declared unavailable", () => {
    // A package contradicting its own release: it ships geometry for a building
    // the release tells the user has none.
    const result = coverage(OWNED, ["doitt:2"]);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("doitt:2");
    expect(result.ok === false && result.message).toContain("declares unavailable");
  });

  it("refuses a building the owned cell does not contain, from either side", () => {
    const packagedForeign = coverage([...OWNED, "doitt:99"], []);
    expect(packagedForeign.ok).toBe(false);
    expect(packagedForeign.ok === false && packagedForeign.message).toContain("doitt:99");
    const unavailableForeign = coverage(OWNED, ["doitt:99"]);
    expect(unavailableForeign.ok).toBe(false);
    expect(unavailableForeign.ok === false && unavailableForeign.message).toContain("doitt:99");
  });

  it("is set equality both ways, so neither a subset nor a superset passes", () => {
    // Subset of owned with nothing declared unavailable.
    expect(coverage(["doitt:1", "doitt:2", "doitt:3"], []).ok).toBe(false);
    // Superset: everything owned, plus an extra declared unavailable.
    expect(coverage(OWNED, ["doitt:99"]).ok).toBe(false);
  });

  it("refuses a repeated packaged building rather than deduplicating it", () => {
    const result = coverage(["doitt:1", "doitt:1", "doitt:2", "doitt:3", "doitt:4"], []);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("repeats a building");
  });

  it("refuses a membership checksum that describes a different set", () => {
    const result = coverage(["doitt:1", "doitt:3"], ["doitt:2", "doitt:4"], assemblyCellMembershipChecksum(OWNED));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("does not describe the packaged membership");
    // Specifically: the OWNED cell's checksum no longer passes for a subset
    // package, which is what stops a partial package borrowing a full cell's
    // identity.
    expect(assemblyCellMembershipChecksum(["doitt:1", "doitt:3"])).not.toBe(assemblyCellMembershipChecksum(OWNED));
  });
});
