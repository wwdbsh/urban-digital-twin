import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AssemblyLod } from "../release/multi-lod-assembly.ts";
import {
  DEFAULT_EXTERIOR_RENDER_PROFILE,
  EXTERIOR_RENDER_PROFILES,
  exteriorRenderProfileLabel,
  isMonotoneAssemblyLodOrder,
  parseExteriorRenderProfile,
  selectExteriorLod,
} from "./exterior-render-profiles.ts";

function lod(lodId: string, geometricErrorMeters: number, maxDistanceMeters: number | null, eligible = true): AssemblyLod {
  return {
    lodId,
    artifactRef: `public/assets/${lodId}.glb`,
    geometricErrorMeters,
    maxDistanceMeters,
    eligible,
    quality: { triangleCount: 1, materialCount: 1, textureCount: 0, budgets: { maxTriangles: 1, maxMaterials: 1, maxTextures: 0 } },
    silhouette: null,
  };
}

describe("exterior render profiles", () => {
  it("parses only the two supported profiles", () => {
    expect(EXTERIOR_RENDER_PROFILES).toEqual(["exploration", "inspection"]);
    expect(DEFAULT_EXTERIOR_RENDER_PROFILE).toBe("exploration");
    expect(parseExteriorRenderProfile("exploration")).toBe("exploration");
    expect(parseExteriorRenderProfile("inspection")).toBe("inspection");
    expect(parseExteriorRenderProfile("Inspection")).toBeNull();
    expect(parseExteriorRenderProfile("")).toBeNull();
    expect(parseExteriorRenderProfile(null)).toBeNull();
    expect(exteriorRenderProfileLabel("inspection")).toContain("finest");
    expect(exteriorRenderProfileLabel("exploration")).toContain("coarsest");
  });

  it("takes the finest covering LOD for inspection and the coarsest for exploration", () => {
    const lods = [lod("lod-0", 0, 200), lod("lod-1", 2, 800), lod("lod-2", 8, null)];
    expect(selectExteriorLod(lods, "inspection", 120)?.lodId).toBe("lod-0");
    expect(selectExteriorLod(lods, "exploration", 120)?.lodId).toBe("lod-2");
    expect(selectExteriorLod(lods, "inspection", 500)?.lodId).toBe("lod-1");
    expect(selectExteriorLod(lods, "exploration", 500)?.lodId).toBe("lod-2");
    expect(selectExteriorLod(lods, "inspection", 5_000)?.lodId).toBe("lod-2");
    expect(selectExteriorLod(lods, "exploration", 5_000)?.lodId).toBe("lod-2");
  });

  it("agrees on a single-LOD asset, and resolves a threshold TIE to the finest of the tie", () => {
    const single = [lod("only", 0, null)];
    expect(selectExteriorLod(single, "inspection", 10)?.lodId).toBe("only");
    expect(selectExteriorLod(single, "exploration", 10)?.lodId).toBe("only");

    // CHANGED IN T005, deliberately. This case previously asserted that
    // exploration took `lod-2` — the last of three levels the release declared
    // no distinction between. That is the defect: `maxDistanceMeters` is how a
    // release says where a representation stops being appropriate, and when
    // three levels say the same thing the release has authorised no preference
    // among them. Taking the coarsest was "last one wins" wearing a policy's
    // clothes. The tie now resolves to the finest member, which is the only
    // member the release positively supports at this distance.
    const equal = [lod("lod-0", 0, 300), lod("lod-1", 0, 300), lod("lod-2", 0, 300)];
    expect(selectExteriorLod(equal, "inspection", 300)?.lodId).toBe("lod-0");
    expect(selectExteriorLod(equal, "exploration", 300)?.lodId).toBe("lod-0");
    expect(selectExteriorLod(equal, "inspection", 301)).toBeNull();
    expect(selectExteriorLod(equal, "exploration", 301)).toBeNull();
  });

  it("resolves the retained full-city two-LOD shape to the FINE level in both profiles", () => {
    // The exact shape of all 44,989 retained buildings: ADR 0050's
    // measured-fallback rule leaves the fine level unbounded whenever the coarse
    // level is a full-geometry fallback, so both levels declare `null`. Before
    // the tie rule, exploration selected the coarse, UNTEXTURED level at every
    // distance including street level.
    const retained = [lod("lod_0", 0, null), lod("lod_1", 0.2, null)];
    for (const distance of [0, 60, 250, 380, 1_200, 2_400, 52_000]) {
      expect(selectExteriorLod(retained, "exploration", distance)?.lodId).toBe("lod_0");
      expect(selectExteriorLod(retained, "inspection", distance)?.lodId).toBe("lod_0");
    }
  });

  it("leaves a release that DID distinguish its thresholds exactly as it was", () => {
    // Block 835 is the one promoted two-LOD wave, and it declares 250 m on the
    // fine level and unbounded on the coarse one. Exploration preferring the
    // coarse level inside 250 m is what the profile is FOR, and the tie rule must
    // not quietly repeal it.
    const block835 = [lod("lod_0", 0, 250), lod("lod_1", 1.5, null)];
    expect(selectExteriorLod(block835, "exploration", 100)?.lodId).toBe("lod_1");
    expect(selectExteriorLod(block835, "exploration", 250)?.lodId).toBe("lod_1");
    expect(selectExteriorLod(block835, "exploration", 251)?.lodId).toBe("lod_1");
    expect(selectExteriorLod(block835, "inspection", 100)?.lodId).toBe("lod_0");
    expect(selectExteriorLod(block835, "inspection", 251)?.lodId).toBe("lod_1");
  });

  it("never selects an ineligible fallback level as the coarse representation", () => {
    // ADR 0050 marks a measured-fallback level `eligible: false` and gives its
    // fine level an unbounded threshold. 424 of the retained buildings are this
    // shape. The fallback must be unreachable in BOTH profiles at every distance,
    // and the fine level must still resolve rather than the asset failing closed.
    const fallback = [lod("lod_0", 0, null), lod("lod_1", 0.2, null, false)];
    for (const distance of [0, 250, 2_400, 52_000]) {
      expect(selectExteriorLod(fallback, "exploration", distance)?.lodId).toBe("lod_0");
      expect(selectExteriorLod(fallback, "inspection", distance)?.lodId).toBe("lod_0");
    }
  });

  it("skips ineligible LODs in both profiles", () => {
    const lods = [lod("lod-0", 0, 200), lod("lod-1", 2, 800, false), lod("lod-2", 8, null)];
    expect(selectExteriorLod(lods, "exploration", 120)?.lodId).toBe("lod-2");
    expect(selectExteriorLod(lods, "inspection", 500)?.lodId).toBe("lod-2");
    const noneEligible = [lod("lod-0", 0, 200, false)];
    expect(selectExteriorLod(noneEligible, "inspection", 100)).toBeNull();
  });

  /**
   * The drift gate for the tie rule, run against the bytes rather than against a
   * remembered claim.
   *
   * The rule was introduced on the argument that it changes nothing any committed
   * release resolves. That argument is worth exactly as much as a test that
   * re-derives it from the committed manifests, so this walks every one of them
   * and refuses any asset whose declared levels tie — which is the only shape the
   * rule can move. A release that later ships a tie has to come here and say so.
   */
  it("changes nothing that any committed release resolves", () => {
    const releases = [
      "manhattan-exterior-cells-20260811",
      "manhattan-exterior-cells-20260811-v3",
      "manhattan-esb-block-reference-20260811-v3",
      "udt-fixture-exterior-cells",
    ].filter((releaseId) => existsSync(`public/data/${releaseId}/assemblies.json`));
    // Fail closed rather than pass vacuously if the committed payloads move.
    expect(releases).toContain("manhattan-exterior-cells-20260811-v3");

    let assetsChecked = 0;
    let twoLodAssetsChecked = 0;
    for (const releaseId of releases) {
      const decoded = JSON.parse(new TextDecoder().decode(readFileSync(`public/data/${releaseId}/assemblies.json`))) as unknown;
      const packages = (Array.isArray(decoded) ? decoded : [decoded]) as Array<{ packageId: string; assets: Array<{ canonicalFeatureId: string; lods: AssemblyLod[] }> }>;
      for (const assemblyPackage of packages) {
        for (const asset of assemblyPackage.assets) {
          assetsChecked += 1;
          if (asset.lods.length > 1) twoLodAssetsChecked += 1;
          const thresholds = asset.lods.filter((level) => level.eligible).map((level) => level.maxDistanceMeters);
          expect(
            new Set(thresholds).size,
            `${releaseId} / ${assemblyPackage.packageId} / ${asset.canonicalFeatureId} declares tied LOD thresholds, so the T005 tie rule MOVES what it resolves; this release predates the rule and must be re-evidenced before it can ship a tie.`,
          ).toBe(thresholds.length);
        }
      }
    }
    expect(assetsChecked).toBeGreaterThan(0);
    expect(twoLodAssetsChecked).toBeGreaterThan(0);
  });

  it("refuses an empty, non-monotone, or non-finite request instead of reordering it", () => {
    expect(isMonotoneAssemblyLodOrder([])).toBe(false);
    expect(isMonotoneAssemblyLodOrder([lod("lod-0", 0, 200), lod("lod-1", 2, 800)])).toBe(true);
    expect(isMonotoneAssemblyLodOrder([lod("lod-0", 0, 800), lod("lod-1", 2, 200)])).toBe(false);
    expect(isMonotoneAssemblyLodOrder([lod("lod-0", 4, 200), lod("lod-1", 2, 800)])).toBe(false);
    expect(isMonotoneAssemblyLodOrder([lod("lod-0", 0, null), lod("lod-1", 2, 800)])).toBe(false);
    expect(selectExteriorLod([], "inspection", 100)).toBeNull();
    expect(selectExteriorLod([lod("lod-0", 0, 800), lod("lod-1", 2, 200)], "inspection", 100)).toBeNull();
    expect(selectExteriorLod([lod("lod-0", 0, null)], "inspection", Number.NaN)).toBeNull();
    expect(selectExteriorLod([lod("lod-0", 0, null)], "inspection", -1)).toBeNull();
  });
});
