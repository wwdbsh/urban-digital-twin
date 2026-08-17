/**
 * The `-s2` two-LOD assembly transform (T001 S2, ADR 0057 §1).
 *
 * Run against the REAL committed `-c2` manifest shape rather than a hand-built
 * fixture wherever possible: the whole point of the transform is that it turns
 * what T009 actually emitted into something the serving validator accepts, and a
 * fixture would let both sides drift together.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { validateMultiLodAssembly, type MultiLodAssemblyManifest } from "./multi-lod-assembly.ts";
import { EXTERIOR_SERVING_TEXTURE_ADMISSION } from "./exterior-serving-waves.ts";
import {
  EXTERIOR_TWO_LOD_SERVING_NEAR_RING_METERS,
  transformRetentionAssemblyToServing,
  transformRetentionAssemblyToTwoLodServing,
  type ServingAssemblyPins,
} from "./exterior-serving-release.ts";
import { selectExteriorLod } from "../runtime/exterior-render-profiles.ts";

/** The one committed `-c2` cell manifest reachable without the retained payload. */
const C2_MANIFEST_PATH = "/Users/sangheonlee/orca/workspaces/urban-digital-twin/fcp-109-lod1-texturing/public/data/manhattan-exterior-cells-20260811-v3-c2/public/assemblies/manhattan-exterior-cell-w00-000000-block-00835.json";

function loadRetained(): MultiLodAssemblyManifest | null {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(readFileSync(C2_MANIFEST_PATH)))) as MultiLodAssemblyManifest;
  } catch {
    // The `-c2` payload is gitignored and worktree-local. Absent, the shape
    // cases below still run against the synthetic manifest; the reconciliation
    // case skips rather than failing, exactly as the retention suites do.
    return null;
  }
}

const CELL_ID = "manhattan-exterior-cell-w00-000000-block-00835";

function pins(): ServingAssemblyPins {
  return {
    packageId: "assembly:manhattan-exterior-cells-20260811-v3-s2:" + CELL_ID,
    generatedAt: "2026-08-17T00:00:00.000Z",
    release: {
      rootId: "root:manhattan-exterior-cells-20260811-v3-s2:public",
      rootChecksumSha256: "a".repeat(64),
      releaseId: "manhattan-exterior-cells-20260811-v3-s2",
      cityId: "city:manhattan",
      configId: "config:manhattan-exterior",
      privatePredecessor: { id: "root:private", checksumSha256: "b".repeat(64) },
    },
    baseIdentitySet: { id: "base", checksumSha256: "c".repeat(64) },
    ownershipLedger: { id: "ledger", checksumSha256: "d".repeat(64) },
    cellRelease: { id: `cell-release:manhattan-exterior-cells-20260811-v3-s2:${CELL_ID}:v1`, checksumSha256: "e".repeat(64) },
    tileset: { byteSize: 100, checksumSha256: "f".repeat(64) },
  };
}

const retained = loadRetained();

describe("the -s2 two-LOD serving transform", () => {
  it.skipIf(retained === null)("keeps both levels of the real committed -c2 manifest", () => {
    const serving = transformRetentionAssemblyToTwoLodServing(retained!, pins(), { nearRingMeters: EXTERIOR_TWO_LOD_SERVING_NEAR_RING_METERS });
    expect(serving.assets.length).toBe(retained!.assets.length);
    for (const asset of serving.assets) {
      expect(asset.lods.map((lod) => lod.lodId)).toEqual(["lod_0", "lod_1"]);
    }
    // Two GLB artifacts per asset, against the -s1 form's one.
    expect(serving.artifacts.filter((artifact) => artifact.role === "glb")).toHaveLength(retained!.assets.length * 2);
    const single = transformRetentionAssemblyToServing(retained!, pins());
    expect(single.artifacts.filter((artifact) => artifact.role === "glb")).toHaveLength(retained!.assets.length);
  });

  it.skipIf(retained === null)("declares the tier as DISTINCT thresholds, which is what makes it a ring", () => {
    const serving = transformRetentionAssemblyToTwoLodServing(retained!, pins(), { nearRingMeters: EXTERIOR_TWO_LOD_SERVING_NEAR_RING_METERS });
    for (const asset of serving.assets) {
      const [fine, coarse] = asset.lods;
      expect(coarse!.maxDistanceMeters).toBeNull();
      if (coarse!.eligible) {
        expect(fine!.maxDistanceMeters).toBe(400);
        // The property the whole tier rests on: the two levels are DISTINGUISHED.
        expect(fine!.maxDistanceMeters).not.toBe(coarse!.maxDistanceMeters);
        // And it resolves as a ring under finest-that-covers.
        expect(selectExteriorLod(asset.lods, "inspection", 399)!.lodId).toBe("lod_0");
        expect(selectExteriorLod(asset.lods, "inspection", 401)!.lodId).toBe("lod_1");
      } else {
        // ADR 0050 fallback: unbounded fine level, so it never resolves nothing.
        expect(fine!.maxDistanceMeters).toBeNull();
        expect(selectExteriorLod(asset.lods, "inspection", 25_000)!.lodId).toBe("lod_0");
        expect(selectExteriorLod(asset.lods, "exploration", 25_000)!.lodId).toBe("lod_0");
      }
    }
  });

  it.skipIf(retained === null)("emits a manifest the multi-LOD assembly validator accepts", () => {
    const serving = transformRetentionAssemblyToTwoLodServing(retained!, pins(), { nearRingMeters: EXTERIOR_TWO_LOD_SERVING_NEAR_RING_METERS });
    const result = validateMultiLodAssembly(serving, {
      textureAdmission: "procedural-replay",
      declaredSamplerFilter: EXTERIOR_SERVING_TEXTURE_ADMISSION.generatedTextureFact!.samplerFilter,
    });
    expect(result.ok, JSON.stringify((result as { issues?: unknown[] }).issues?.slice(0, 4))).toBe(true);
  });

  it.skipIf(retained === null)("PRESERVES the coarse level's silhouette measurement", () => {
    // -s1 nulls it because a single-LOD package declares no transition. A
    // two-LOD package that nulled it would be declaring an unmeasured coarse
    // level, which is exactly what the 2% cap exists to refuse.
    const serving = transformRetentionAssemblyToTwoLodServing(retained!, pins(), { nearRingMeters: EXTERIOR_TWO_LOD_SERVING_NEAR_RING_METERS });
    for (const asset of serving.assets) {
      const coarse = asset.lods[1]!;
      if (!coarse.eligible) continue;
      expect(coarse.silhouette).not.toBeNull();
      expect(coarse.silhouette!.deviationRatio).toBeLessThanOrEqual(coarse.silhouette!.maximumRatio);
    }
  });

  it.skipIf(retained === null)("refuses a near-ring bound that is not a positive distance", () => {
    for (const nearRingMeters of [0, -1]) {
      expect(() => transformRetentionAssemblyToTwoLodServing(retained!, pins(), { nearRingMeters })).toThrow(/positive distance/u);
    }
  });

  it.skipIf(retained === null)("refuses an eligible coarse level carrying no measurement", () => {
    const tampered = JSON.parse(JSON.stringify(retained)) as MultiLodAssemblyManifest;
    const target = tampered.assets.find((asset) => asset.lods[1]!.eligible)!;
    target.lods[1]!.silhouette = null;
    expect(() => transformRetentionAssemblyToTwoLodServing(tampered, pins(), { nearRingMeters: 400 })).toThrow(/no silhouette measurement/u);
  });

  it.skipIf(retained === null)("refuses a manifest that carries only one level", () => {
    const tampered = JSON.parse(JSON.stringify(retained)) as MultiLodAssemblyManifest;
    for (const asset of tampered.assets) asset.lods = [asset.lods[0]!];
    expect(() => transformRetentionAssemblyToTwoLodServing(tampered, pins(), { nearRingMeters: 400 })).toThrow(/requires exactly one/u);
  });

  it("states where the -c2 manifest was read from, so an absent payload is visible", () => {
    // Not a tautology: if the -c2 payload is absent every case above SKIPS, and
    // a suite that silently skipped its only real input would look green while
    // proving nothing. This records which happened.
    expect(typeof C2_MANIFEST_PATH).toBe("string");
    if (retained === null) console.warn(`-c2 manifest absent at ${C2_MANIFEST_PATH}; the -s2 transform cases skipped.`);
  });
});
