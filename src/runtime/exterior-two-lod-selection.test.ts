/**
 * The PROOF that flipping the default selection semantics is a no-op for every
 * release the promoted city serves today (T001, ADR 0057 §2).
 *
 * The tie-rule docblock used to carry the sentence "the serving releases this
 * goal emits are single-LOD by construction", and used it to argue the rule was
 * safe. That sentence stops being true the moment `-s2` ships two levels, so it
 * cannot go on carrying the argument. This file replaces it with the property it
 * was gesturing at, stated as a test over the ACTUAL committed release shapes:
 *
 *   For any LOD list in which no two eligible levels are DISTINGUISHED by their
 *   declared `maxDistanceMeters`, every profile resolves the same level at every
 *   distance.
 *
 * Both frozen shapes satisfy the antecedent. A single-LOD list has one candidate
 * and nothing to prefer; a null-at-both list is one tie, and the tie rule sends
 * both profiles to the finest member. So the flip cannot move what the promoted
 * city serves — not because nothing has two levels, but because nothing has two
 * levels a release DISTINGUISHED.
 *
 * The 424 measured-fallback parents are pinned here for the same reason: ADR
 * 0050 gives them an unbounded `lod_0` and an INELIGIBLE `lod_1`, and that shape
 * must resolve to `lod_0` at every distance under every profile, before and
 * after the flip. A fallback parent that resolved to nothing at range would be
 * `lod-unavailable` — a blank building — which is the failure this exception
 * exists to prevent.
 */
import { describe, expect, it } from "vitest";

import type { AssemblyLod } from "../release/multi-lod-assembly.ts";
import { EXTERIOR_RENDER_PROFILES, selectExteriorLod } from "./exterior-render-profiles.ts";

/** Distances spanning street level, the near ring, the T001 threshold and beyond. */
const DISTANCES = [0, 1, 50, 100, 250, 399, 400, 401, 546, 1_200, 2_400, 5_000, 25_000];

function lod(lodId: string, geometricErrorMeters: number, maxDistanceMeters: number | null, eligible = true): AssemblyLod {
  return {
    lodId,
    artifactRef: `public/assets/x__${lodId}.glb`,
    geometricErrorMeters,
    maxDistanceMeters,
    eligible,
    quality: { triangleCount: 1, materialCount: 1, textureCount: 0, budgets: { maxTriangles: 2, maxMaterials: 2, maxTextures: 2 } },
    silhouette: null,
  } as unknown as AssemblyLod;
}

/** The two shapes every frozen `-s1` release and every retained package presents. */
const FROZEN_SHAPES: ReadonlyArray<{ name: string; lods: AssemblyLod[]; expected: string }> = [
  {
    name: "single-LOD — every promoted -s1 serving release (shippedLodIds: [\"lod_0\"])",
    lods: [lod("lod_0", 0, null)],
    expected: "lod_0",
  },
  {
    name: "null-at-both — every retained -c1/-c2 package, all 44,989 buildings",
    lods: [lod("lod_0", 0, null), lod("lod_1", 0.2, null)],
    expected: "lod_0",
  },
  {
    name: "ADR 0050 measured fallback — lod_0 unbounded, lod_1 INELIGIBLE (424 parents)",
    lods: [lod("lod_0", 0, null), lod("lod_1", 0, null, false)],
    expected: "lod_0",
  },
];

describe("the default-selection flip is a no-op for every shape the city serves today", () => {
  for (const shape of FROZEN_SHAPES) {
    it(`resolves ${shape.expected} at every distance under every profile: ${shape.name}`, () => {
      for (const profile of EXTERIOR_RENDER_PROFILES) {
        for (const distance of DISTANCES) {
          const selected = selectExteriorLod(shape.lods, profile, distance);
          expect(selected, `${profile} @ ${distance}m resolved nothing`).not.toBeNull();
          expect(selected!.lodId, `${profile} @ ${distance}m`).toBe(shape.expected);
        }
      }
    });
  }

  it("states the property the shapes share, rather than relying on the list being complete", () => {
    // The antecedent, checked: no two ELIGIBLE levels are distinguished by their
    // declared threshold. This is what makes the profiles agree, and a future
    // frozen shape that violated it would fail here rather than silently change
    // what a promoted session renders.
    for (const shape of FROZEN_SHAPES) {
      const thresholds = shape.lods.filter((entry) => entry.eligible).map((entry) => entry.maxDistanceMeters);
      expect(new Set(thresholds).size, `${shape.name} distinguishes its eligible levels`).toBe(1);
    }
  });
});

describe("the -s2 two-LOD shape is what MOVES, and only under the new default", () => {
  // lod_0 bounded at the T001 threshold, lod_1 unbounded beyond it (ADR 0057 §1).
  const s2 = [lod("lod_0", 0, 400), lod("lod_1", 0.2, null)];

  it("serves lod_0 inside the near ring and lod_1 beyond it under finest-that-covers", () => {
    expect(selectExteriorLod(s2, "inspection", 0)!.lodId).toBe("lod_0");
    expect(selectExteriorLod(s2, "inspection", 400)!.lodId).toBe("lod_0");
    expect(selectExteriorLod(s2, "inspection", 400.001)!.lodId).toBe("lod_1");
    expect(selectExteriorLod(s2, "inspection", 25_000)!.lodId).toBe("lod_1");
  });

  it("serves lod_1 EVERYWHERE under coarsest-that-covers, which is why the default had to move", () => {
    // The finding that stopped T001's first plan: with distinct thresholds the
    // coarsest-preferring profile takes lod_1 at street level too. This is not a
    // ring, and shipping -s2 under the old default would have put shed geometry
    // in front of the camera at 0 m.
    for (const distance of [0, 100, 399, 400, 401, 5_000]) {
      expect(selectExteriorLod(s2, "exploration", distance)!.lodId).toBe("lod_1");
    }
  });

  it("never resolves nothing, at any distance, under either profile", () => {
    for (const profile of EXTERIOR_RENDER_PROFILES) {
      for (const distance of DISTANCES) expect(selectExteriorLod(s2, profile, distance)).not.toBeNull();
    }
  });
});
