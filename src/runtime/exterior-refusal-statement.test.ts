import { describe, expect, it } from "vitest";

import { EXTERIOR_REFUSAL_STOP_CODES, exteriorRefusalStatement, exteriorRefusalStopCode } from "./exterior-cell-runtime.ts";

/**
 * A refusal reason exactly as the release carries it, copied from
 * `data/manhattan-southern-remainder-cells-20260812-c1/wave-census.json` rather
 * than paraphrased, so the tests below run against the real sentence shape
 * including the doubled period the generator emits.
 */
const REAL_REASON = "Refused by the footprint-faithful V3 exterior grammar [ring-neck-below-grammar-minimum]: geometry.footprint.outer: V3 ring has a neck 51 mm across, thinner than the 600 mm two opposed recesses and a wall need; the openings would punch through the massing.. No geometry was invented for this building, and no substitute representation was selected; base massing from the pinned citywide release is what remains on screen.";

describe("exteriorRefusalStopCode", () => {
  it("reads the bracketed code out of a real reason", () => {
    expect(exteriorRefusalStopCode(REAL_REASON)).toBe("ring-neck-below-grammar-minimum");
  });

  it("pins the closed four-code vocabulary", () => {
    expect([...EXTERIOR_REFUSAL_STOP_CODES]).toEqual([
      "ring-area-below-floor",
      "ring-neck-below-grammar-minimum",
      "ring-not-simple",
      "volume-identity-failed",
    ]);
  });

  it("returns null for a code this build does not recognize, rather than echoing it", () => {
    // The vocabulary is closed. A release carrying a new category is a fact the
    // panel must surface as unrecognized; echoing an unknown token as though it
    // were understood is the failure this guards.
    expect(exteriorRefusalStopCode("Refused by something [brand-new-category]: whatever.")).toBeNull();
    expect(exteriorRefusalStopCode("Refused with no bracketed code at all.")).toBeNull();
  });
});

/**
 * H1 — THE ARM-DEPENDENT CLAUSE.
 *
 * Every shipped reason ends "...; base massing from the pinned citywide release
 * is what remains on screen." That is true in the default arm and FALSE under
 * `?exteriorScheduler=off`, where the citywide base tier is not drawing. The app
 * cannot repeat it as a live claim, because the reason string does not know
 * which arm the session is in.
 *
 * These tests are the ones that would catch the clause leaking back into what
 * the app asserts.
 */
describe("exteriorRefusalStatement (H1)", () => {
  it("drops the arm-dependent trailing clause from the app's own assertion", () => {
    const statement = exteriorRefusalStatement(REAL_REASON);
    expect(statement).not.toContain("base massing");
    expect(statement).not.toContain("what remains on screen");
    // ...while keeping everything that is true in BOTH arms: the code, the
    // measured gate values, and the no-substitution promise.
    expect(statement).toContain("[ring-neck-below-grammar-minimum]");
    expect(statement).toContain("51 mm");
    expect(statement).toContain("600 mm");
    expect(statement).toContain("No geometry was invented for this building");
    expect(statement).toContain("no substitute representation was selected");
    expect(statement.endsWith(".")).toBe(true);
  });

  it("is a prefix of the release's own sentence, so it cannot invent wording", () => {
    // Truncation only. If this ever fails, the app has started rewriting a
    // refusal in its own words and calling the result provenance.
    const statement = exteriorRefusalStatement(REAL_REASON);
    expect(REAL_REASON.startsWith(statement.slice(0, -1))).toBe(true);
  });

  it("leaves a reason without the clause unchanged", () => {
    const plain = "Not scheduled for exterior materialization in this release.";
    expect(exteriorRefusalStatement(plain)).toBe(plain);
  });

  it("holds for every distinct reason shape shipped across the six waves", () => {
    const shapes = [
      "Refused by the footprint-faithful V3 exterior grammar [ring-area-below-floor]: geometry.footprint.outer: V3 ring area is below the footprint area floor.. No geometry was invented for this building, and no substitute representation was selected; base massing from the pinned citywide release is what remains on screen.",
      "Refused by the footprint-faithful V3 exterior grammar [ring-not-simple]: geometry.footprint.outer: V3 ring must be simple: it self-intersects or folds back on itself.. No geometry was invented for this building, and no substitute representation was selected; base massing from the pinned citywide release is what remains on screen.",
      "Refused by the footprint-faithful V3 exterior grammar [volume-identity-failed]: lod_0 signed mesh volume 145.7161392935687 m³ against analytic 145.716309871 m³ (deviation 0.0000011706131692205764).. No geometry was invented for this building, and no substitute representation was selected; base massing from the pinned citywide release is what remains on screen.",
    ];
    for (const reason of shapes) {
      expect(exteriorRefusalStatement(reason)).not.toContain("base massing");
      expect(exteriorRefusalStopCode(reason)).not.toBeNull();
    }
  });
});
