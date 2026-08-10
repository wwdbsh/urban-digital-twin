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

  it("agrees on a single-LOD asset and on equal thresholds resolves deterministically by declared order", () => {
    const single = [lod("only", 0, null)];
    expect(selectExteriorLod(single, "inspection", 10)?.lodId).toBe("only");
    expect(selectExteriorLod(single, "exploration", 10)?.lodId).toBe("only");

    const equal = [lod("lod-0", 0, 300), lod("lod-1", 0, 300), lod("lod-2", 0, 300)];
    expect(selectExteriorLod(equal, "inspection", 300)?.lodId).toBe("lod-0");
    expect(selectExteriorLod(equal, "exploration", 300)?.lodId).toBe("lod-2");
    expect(selectExteriorLod(equal, "inspection", 301)).toBeNull();
    expect(selectExteriorLod(equal, "exploration", 301)).toBeNull();
  });

  it("skips ineligible LODs in both profiles", () => {
    const lods = [lod("lod-0", 0, 200), lod("lod-1", 2, 800, false), lod("lod-2", 8, null)];
    expect(selectExteriorLod(lods, "exploration", 120)?.lodId).toBe("lod-2");
    expect(selectExteriorLod(lods, "inspection", 500)?.lodId).toBe("lod-2");
    const noneEligible = [lod("lod-0", 0, 200, false)];
    expect(selectExteriorLod(noneEligible, "inspection", 100)).toBeNull();
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
