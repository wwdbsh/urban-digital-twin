import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { validateV2Plan } from "../domain/deterministic-facade-generator-v2.ts";
import { sha256HexBytes } from "../domain/deterministic-hash.ts";
import { EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256, EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID } from "../domain/exterior-fullsnapshot-input.ts";
import { BLOCK835_QUALITY_BUDGETS, readPilotBuildings } from "./block835-reference-package.ts";
import { buildSuccessorPlan, tessellateV2Plan, successorPlanToEnu } from "./block835-successor-package.ts";
import { parseGlbV2 } from "./multi-lod-assembly.ts";
import { buildMidtownCoreSubsetLedger, midtownCoreArtifactChecksum } from "./midtown-core-package.ts";
import {
  MIDTOWN_CORE_LOD_IDS,
  MidtownCoreStop,
  buildMidtownCorePlan,
  midtownCoreAssetRef,
  midtownCoreEvidenceShardId,
  midtownCoreInventoryId,
  midtownCorePlanToEnu,
  midtownCoreV2Parameters,
  writeMidtownCoreAssets,
  type MidtownCoreBuildingSource,
} from "./midtown-core-materialization.ts";

const SNAPSHOT_ROOT = "public/data/manhattan-citywide-20260804";
const LEDGER_ROOT = "data/normalized/manhattan-exterior-wave-ledger-20260804";
const PILOT_RELEASE = "public/data/manhattan-esb-block-exterior-pilot-20260805/release.json";

function readJson(path: string): never {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(readFileSync(path)))) as never;
}

const parentLedger = readJson(`${LEDGER_ROOT}/ledger.json`);
const subset = buildMidtownCoreSubsetLedger({
  parentLedger,
  parentLedgerChecksumSha256: midtownCoreArtifactChecksum(parentLedger),
  baseReleaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID,
  baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
});

/**
 * Deterministic sample: the whole first cell plus the whole largest cell.
 * A full 7,201-building pass takes ~73 s and belongs to the CLI census, not to
 * the unit suite; this sample is fixed by ledger order, so it never drifts.
 */
function sampleSources(): MidtownCoreBuildingSource[] {
  const manifest = readJson(`${SNAPSHOT_ROOT}/manifest.json`) as unknown as {
    geometryShards: { layer: string; relativeContentRef: string }[];
  };
  const cells = subset.ledger.cells;
  const largest = [...cells].sort((left, right) => right.buildingIds.length - left.buildingIds.length)[0]!;
  const wanted = new Set([...cells[0]!.buildingIds, ...largest.buildingIds]);
  const sources: MidtownCoreBuildingSource[] = [];
  for (const shard of manifest.geometryShards.filter((entry) => entry.layer === "buildings")) {
    const features = (readJson(`${SNAPSHOT_ROOT}/${shard.relativeContentRef}`) as unknown as {
      features: {
        parentId: string; coordinates: [number, number]; geometry: { coordinates: [number, number][][] };
        heightMeters: number | null; heightUnknown?: boolean; sourceRefIds: string[]; sourceRecordId: string;
      }[];
    }).features;
    for (const feature of features) {
      if (!wanted.has(feature.parentId)) continue;
      sources.push({
        buildingId: feature.parentId,
        representative: feature.coordinates,
        outerRing: feature.geometry.coordinates[0]!,
        heightMeters: feature.heightMeters,
        heightUnknown: feature.heightUnknown === true,
        sourceRefId: feature.sourceRefIds[0]!,
        sourceRecordId: feature.sourceRecordId,
      });
    }
  }
  return sources.sort((left, right) => (left.buildingId < right.buildingId ? -1 : 1));
}

describe("midtown-core V2 parameter derivation", () => {
  /**
   * The added small-footprint clamps must be provably non-binding for ordinary
   * buildings. Reproducing the pinned Block 835 successor parameters exactly,
   * for all fourteen buildings, is that proof.
   */
  it("reproduces the pinned Block 835 parameters exactly", () => {
    const buildings = readPilotBuildings(readJson(PILOT_RELEASE));
    expect(buildings).toHaveLength(14);
    for (const building of buildings) {
      const context = buildSuccessorPlan(building);
      const derived = midtownCoreV2Parameters(
        building.canonicalBuildingId,
        Math.round(context.rectangle.widthMeters * 1_000),
        Math.round(context.rectangle.depthMeters * 1_000),
        Math.round(building.heightMeters * 1_000),
      );
      expect(derived.parameters).toEqual(context.plan.input.parameters);
      expect(derived.heightMm).toBe(context.plan.input.geometry.heightMm);
    }
  });

  it("maps plan-local millimetres to ENU exactly as the pinned path does", () => {
    const buildings = readPilotBuildings(readJson(PILOT_RELEASE));
    for (const building of buildings) {
      const context = buildSuccessorPlan(building);
      const tessellated = tessellateV2Plan(context.plan, { includeRecesses: true });
      expect(midtownCorePlanToEnu(context.rectangle, tessellated.quads)).toEqual(successorPlanToEnu(context, tessellated.quads));
    }
  });

  it("refuses a footprint below the grammar minimum instead of inventing geometry", () => {
    // 1.1 m minimum dimension: no parameter choice clears the V2 rooftop guard.
    expect(() => midtownCoreV2Parameters("doitt:test", 8_288, 1_108, 2_438)).toThrow(MidtownCoreStop);
    try {
      midtownCoreV2Parameters("doitt:test", 8_288, 1_108, 2_438);
    } catch (error) {
      expect((error as MidtownCoreStop).code).toBe("footprint-below-grammar-minimum");
    }
  });

  it("recovers small footprints that the unclamped derivation could not plan", () => {
    // 2.063 m minimum dimension: fails without the clamps, plans with them.
    const derived = midtownCoreV2Parameters("doitt:test", 7_086, 2_063, 5_300);
    const { tierCount, setbackInsetMm, waterTankRadiusMm } = derived.parameters;
    const crown = 2_063 - (tierCount - 1) * setbackInsetMm * 2;
    expect(crown).toBeGreaterThan(2 * waterTankRadiusMm + 2_000);
  });
});

describe("midtown-core materialization", () => {
  const sources = sampleSources();

  it("resolves every sampled building from the pinned citywide snapshot", () => {
    const cells = subset.ledger.cells;
    const largest = [...cells].sort((left, right) => right.buildingIds.length - left.buildingIds.length)[0]!;
    expect(largest.buildingIds).toHaveLength(114);
    expect(sources).toHaveLength(cells[0]!.buildingIds.length + largest.buildingIds.length);
  });

  it("generates a fully validated V2 plan for every sampled building", () => {
    for (const source of sources) {
      const context = buildMidtownCorePlan(source, EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256);
      expect(validateV2Plan(context.plan).ok).toBe(true);
      expect(context.plan.buildingId).toBe(source.buildingId);
      // Every component ships as real geometry, tier "generated".
      expect([...new Set(context.plan.inventory.components.map((component) => component.state))]).toEqual(["generated"]);
      // Provenance is bound to the pinned base manifest, not to a bare ring.
      expect(context.plan.input.sourceAnchors).toHaveLength(2);
      expect(context.plan.input.sourceAnchors.every((anchor) => anchor.sourceRefId === source.sourceRefId)).toBe(true);
    }
  });

  it("writes two texture-free canonical GLBs per building inside the asset budgets", () => {
    for (const source of sources.slice(0, 12)) {
      const context = buildMidtownCorePlan(source, EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256);
      const assets = writeMidtownCoreAssets(context, { ownerCellId: "cell", capturedAt: null, updatedAt: null });
      expect(assets.map((asset) => asset.lodId)).toEqual([...MIDTOWN_CORE_LOD_IDS]);
      for (const asset of assets) {
        expect(asset.counts.textureCount).toBe(0);
        expect(asset.counts.triangleCount).toBeLessThanOrEqual(BLOCK835_QUALITY_BUDGETS.maxTriangles);
        expect(asset.counts.materialCount).toBeLessThanOrEqual(BLOCK835_QUALITY_BUDGETS.maxMaterials);
        expect(asset.checksumSha256).toBe(sha256HexBytes(asset.bytes));
        expect(asset.relativeRef).toBe(midtownCoreAssetRef(source.buildingId, asset.lodId));
        // Parses as a closed-profile GLB with no embedded imagery.
        const parsed = parseGlbV2(asset.bytes);
        expect(parsed.json.images).toBeUndefined();
        expect(parsed.json.textures).toBeUndefined();
        expect(parsed.binBytes).toBeGreaterThan(0);
      }
      // LOD 1 keeps every protrusion, so it is never larger than LOD 0.
      expect(assets[1]!.bytes.byteLength).toBeLessThanOrEqual(assets[0]!.bytes.byteLength);
    }
  });

  it("bakes the inventory and evidence ids the release graph must publish into every asset", () => {
    const source = sources[0]!;
    const context = buildMidtownCorePlan(source, EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256);
    const [asset] = writeMidtownCoreAssets(context, { ownerCellId: "cell:x", capturedAt: "2026-08-04T00:00:00.000Z", updatedAt: null });
    const extras = (parseGlbV2(asset!.bytes).json as { extras: { urbanDigitalTwin: Record<string, unknown> } }).extras.urbanDigitalTwin;
    expect(extras.inventoryId).toBe(midtownCoreInventoryId(source.buildingId));
    expect(extras.evidenceShardId).toBe(midtownCoreEvidenceShardId(source.buildingId));
    expect(extras.ownerCellId).toBe("cell:x");
    expect(extras.truthTiers).toEqual(["generated"]);
    expect(extras.predecessor).toBeNull();
    expect(extras.sourceDates).toEqual({ capturedAt: "2026-08-04T00:00:00.000Z", updatedAt: null });
  });

  it("is byte-deterministic across regeneration", () => {
    for (const source of sources.slice(0, 8)) {
      const first = writeMidtownCoreAssets(buildMidtownCorePlan(source, EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256), { ownerCellId: "c", capturedAt: null, updatedAt: null });
      const second = writeMidtownCoreAssets(buildMidtownCorePlan(source, EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256), { ownerCellId: "c", capturedAt: null, updatedAt: null });
      expect(second.map((asset) => asset.checksumSha256)).toEqual(first.map((asset) => asset.checksumSha256));
    }
  });

  it("discloses a fallback height rather than asserting an unknown one", () => {
    const source: MidtownCoreBuildingSource = {
      ...sources[0]!,
      buildingId: "doitt:unknown-height",
      heightMeters: null,
      heightUnknown: true,
    };
    const context = buildMidtownCorePlan(source, EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256);
    expect(context.heightSource).toBe("fallback");
  });
});
