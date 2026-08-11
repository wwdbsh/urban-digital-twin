import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DETERMINISTIC_FACADE_V3T_UNCERTAINTY } from "../domain/deterministic-facade-generator-v3.ts";
import { V3T_QUALITY_BUDGETS, V3_QUALITY_BUDGETS } from "./block835-v3-package.ts";
import {
  PROCEDURAL_TEXTURE_PROFILE,
  PROCEDURAL_TEXTURE_RASTERIZER_VERSION,
  PROCEDURAL_TEXTURE_SAMPLER_FILTER,
  proceduralTextureParametersHash,
} from "./procedural-texture.ts";
import { MIDTOWN_CORE_V3_APPROVAL_EXCLUSIONS, MIDTOWN_CORE_V3_APPROVAL_SCOPE } from "./midtown-core-v3-release.ts";
import { LOWER_MANHATTAN_RELEASE_ID } from "./lower-manhattan-package.ts";
import {
  LOWER_MANHATTAN_APPROVAL,
  LOWER_MANHATTAN_APPROVAL_EXCLUSIONS,
  LOWER_MANHATTAN_APPROVAL_NOTE,
  LOWER_MANHATTAN_APPROVAL_SCOPE,
  LOWER_MANHATTAN_CENSUS_PROFILE,
  LOWER_MANHATTAN_PREDECESSOR_RELEASE_ID,
  LOWER_MANHATTAN_TEXTURE_ADMISSION,
  LOWER_MANHATTAN_WAVE_PROFILE,
  lowerManhattanApprovalFingerprint,
  lowerManhattanPredecessor,
  lowerManhattanRenderableCells,
  lowerManhattanRenderableEntryBudget,
} from "./lower-manhattan-release.ts";

const RECORD_ROOT = "data/lower-manhattan-20260812";

function readText(path: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(readFileSync(path)));
}
function readJson<T>(path: string): T {
  return JSON.parse(readText(path)) as T;
}

interface PayloadInventory {
  releaseId: string;
  ownershipLedgerId: string;
  occupancy: { maxCacheEntries: number; block835AssetEntries: number; midtownAssetEntries: number; promotedAssetEntries: number; entryBudget: number };
  renderableCellIds: string[];
  roots: Record<string, { rootId: string; rootChecksumSha256: string; artifactCount: number }>;
  textureAdmission: { policy: string; profile: string; rasterizerVersion: string; parametersHashSha256: string; samplerFilter: { magFilter: number; minFilter: number } };
  census: { materializedBuildingCount: number; maximumTextureCount: number; textureCatalog: { profile: string; rasterizerVersion: string; parametersHashSha256: string } | null };
  stats: { cellCount: number; renderableCellCount: number; notShippedCellCount: number; ownedBuildingCount: number; availableBuildingCount: number; unavailableBuildingCount: number };
  totals: { fileCount: number; byteSize: number };
  files: { path: string; byteSize: number; checksumSha256: string }[];
}

const inventory = readJson<PayloadInventory>(`${RECORD_ROOT}/payload-inventory.json`);

describe("lower-manhattan rights instrument", () => {
  /**
   * The whole reason this wave authors a NEW approval rather than reusing the
   * Midtown-core one: that scope says the release is TEXTURE-FREE and its
   * exclusions forbid "runtime textures of any kind, procedural or captured". A
   * scope that excludes textures cannot admit them, so borrowing it would be a
   * false claim about what was approved.
   */
  it("cannot be satisfied by the frozen midtown scope, and does not edit it", () => {
    expect(MIDTOWN_CORE_V3_APPROVAL_SCOPE).toContain("TEXTURE-FREE");
    expect(MIDTOWN_CORE_V3_APPROVAL_EXCLUSIONS).toContain("runtime textures of any kind, procedural or captured");
    expect(LOWER_MANHATTAN_APPROVAL_SCOPE).not.toBe(MIDTOWN_CORE_V3_APPROVAL_SCOPE);
    expect(LOWER_MANHATTAN_APPROVAL_EXCLUSIONS).not.toContain("runtime textures of any kind, procedural or captured");
  });

  it("states the reference-only calibration and ingests no image data", () => {
    expect(LOWER_MANHATTAN_APPROVAL_SCOPE).toContain("calibrated by VIEWING public reference imagery only");
    expect(LOWER_MANHATTAN_APPROVAL_SCOPE).toContain("no image data was ingested, decoded, traced, sampled, or reproduced");
    expect(LOWER_MANHATTAN_APPROVAL_SCOPE).toContain("no pixel of any photograph is present in or derivable from the shipped bytes");
    expect(LOWER_MANHATTAN_APPROVAL_SCOPE).toContain("re-rasterized and required to match byte for byte");
  });

  /** The two things that stay false, narrowed from the blanket texture exclusion. */
  it("still excludes public deployment, captured imagery and any facade-fidelity claim", () => {
    expect(LOWER_MANHATTAN_APPROVAL_EXCLUSIONS).toContain("public internet deployment");
    expect(LOWER_MANHATTAN_APPROVAL_EXCLUSIONS).toContain("captured, photographic, or otherwise source-derived texture imagery of any kind");
    expect(LOWER_MANHATTAN_APPROVAL_EXCLUSIONS.some((entry) => entry.includes("reproduces, resembles, or reports on a real building's facade"))).toBe(true);
    expect(LOWER_MANHATTAN_APPROVAL_EXCLUSIONS).toContain("redistribution of the raw jh45-qr5r source dataset");
    expect(LOWER_MANHATTAN_APPROVAL_EXCLUSIONS).toContain("runtime external network requests");
  });

  /** The evidence is exactly two recorded items, and neither is a third-party licence. */
  it("names its recorded evidence and represents no licence grant", () => {
    expect(LOWER_MANHATTAN_APPROVAL_NOTE).toContain("recorded texture direction of 2026-08-11");
    expect(LOWER_MANHATTAN_APPROVAL_NOTE).toContain("REFERENCE ONLY with no image data ingested");
    expect(LOWER_MANHATTAN_APPROVAL_NOTE).toContain("recorded standing autonomy directive");
    expect(LOWER_MANHATTAN_APPROVAL_NOTE).toContain("Neither item is a licence grant from any third party");
  });

  /** Pinned exactly as the midtown scope is pinned: a moved word moves the hash. */
  it("pins the approval fingerprint to its own text", () => {
    expect(LOWER_MANHATTAN_APPROVAL.fingerprintSha256).toBe(lowerManhattanApprovalFingerprint());
    expect(LOWER_MANHATTAN_APPROVAL.fingerprintSha256).toBe("608e6c307d05362f12807545a2c9543ccebe75679a36d4794b052cfe43f15fea");
  });
});

describe("lower-manhattan emission profiles", () => {
  it("ships textures at LOD 0 under the V3T budgets, never the zero-texture V3 ones", () => {
    expect(LOWER_MANHATTAN_WAVE_PROFILE.texture).toBe(PROCEDURAL_TEXTURE_PROFILE);
    expect(LOWER_MANHATTAN_WAVE_PROFILE.budgets).toEqual(V3T_QUALITY_BUDGETS);
    expect(V3_QUALITY_BUDGETS.maxTextures).toBe(0);
    expect(LOWER_MANHATTAN_WAVE_PROFILE.textureFilter).toEqual(PROCEDURAL_TEXTURE_SAMPLER_FILTER);
    expect(LOWER_MANHATTAN_WAVE_PROFILE.uncertainty).toBe(DETERMINISTIC_FACADE_V3T_UNCERTAINTY);
  });

  /**
   * The census profile is untextured but must share every field that enters a
   * plan hash, or the wave census would be a statement about different buildings
   * than the ones that ship.
   */
  it("censuses on the identical grammar it ships", () => {
    expect(LOWER_MANHATTAN_CENSUS_PROFILE.seed).toBe(LOWER_MANHATTAN_WAVE_PROFILE.seed);
    expect(LOWER_MANHATTAN_CENSUS_PROFILE.generatedAt).toBe(LOWER_MANHATTAN_WAVE_PROFILE.generatedAt);
    expect(LOWER_MANHATTAN_CENSUS_PROFILE.tool).toEqual(LOWER_MANHATTAN_WAVE_PROFILE.tool);
    expect(LOWER_MANHATTAN_CENSUS_PROFILE.releaseId).toBe(LOWER_MANHATTAN_WAVE_PROFILE.releaseId);
    expect(LOWER_MANHATTAN_CENSUS_PROFILE.texture).toBeNull();
  });

  it("declares the procedural-replay admission the runtime reads unchanged", () => {
    expect(LOWER_MANHATTAN_TEXTURE_ADMISSION.policy).toBe("procedural-replay");
    const fact = LOWER_MANHATTAN_TEXTURE_ADMISSION.generatedTextureFact!;
    expect(fact.basis).toBe("generated-texture");
    expect(fact.gate).toBe("rasterizer-replay");
    // Explicitly null, never absent: a generated tile cites no evidence record.
    expect(fact.evidenceBasis).toBeNull();
    expect(fact.samplerFilter).toEqual(PROCEDURAL_TEXTURE_SAMPLER_FILTER);
  });
});

describe("lower-manhattan renderable-subset derivation", () => {
  /**
   * The subset is sized by ENTRIES against the shared cache, and sized to fit
   * ALONGSIDE both promoted waves rather than merely alone — a subset that only
   * fits alone would have to be re-cut at promotion.
   */
  it("derives its budget from the cap less the promoted waves", () => {
    expect(lowerManhattanRenderableEntryBudget({ maxCacheEntries: 256, promotedAssetEntries: 184 })).toBe(72);
    expect(() => lowerManhattanRenderableEntryBudget({ maxCacheEntries: 256, promotedAssetEntries: 256 })).toThrow(/no renderable subset fits/u);
  });

  it("admits whole cells only, in priority order, while the subset still fits", () => {
    const cells = [
      { cellId: "a", buildingIds: Array.from({ length: 10 }, (_, index) => `a${index}`) },
      { cellId: "b", buildingIds: Array.from({ length: 52 }, (_, index) => `b${index}`) },
      { cellId: "c", buildingIds: Array.from({ length: 56 }, (_, index) => `c${index}`) },
    ];
    const chosen = lowerManhattanRenderableCells(cells, 72);
    expect(chosen.cells.map((cell) => cell.cellId)).toEqual(["a", "b"]);
    expect(chosen.ownedBuildingCount).toBe(62);
    expect(chosen.spareEntries).toBe(10);
    // A cell is never split: a partially renderable cell could never finish loading.
    expect(lowerManhattanRenderableCells(cells, 61).cells.map((cell) => cell.cellId)).toEqual(["a"]);
  });

  it("refuses a budget no cell fits", () => {
    expect(() => lowerManhattanRenderableCells([{ cellId: "a", buildingIds: ["x", "y"] }], 1)).toThrow(/no cell fits/u);
  });
});

describe("lower-manhattan predecessor lineage", () => {
  it("refuses pins that did not come from the promoted midtown V3 wave", () => {
    expect(() => lowerManhattanPredecessor({ releaseId: "something-else", files: [] })).toThrow(/pins must come from/u);
  });

  it("derives the promoted wave's root and snapshot from its committed inventory", () => {
    const committed = readJson<{ releaseId: string; roots: Record<string, { rootId: string; rootChecksumSha256: string; artifactCount: number }>; files: { path: string; byteSize: number; checksumSha256: string }[] }>(
      "data/midtown-core-20260811-v3/payload-inventory.json",
    );
    const committedPublicRoot = committed.roots.public;
    expect(committedPublicRoot).toBeDefined();
    const predecessor = lowerManhattanPredecessor(committed);
    expect(predecessor.releaseId).toBe(LOWER_MANHATTAN_PREDECESSOR_RELEASE_ID);
    expect(predecessor.publicRoot.rootChecksumSha256).toBe(committedPublicRoot!.rootChecksumSha256);
    expect(predecessor.cellReleases.size).toBe(149);
  });
});

describe("lower-manhattan committed payload inventory", () => {
  it("describes the release this module names", () => {
    expect(inventory.releaseId).toBe(LOWER_MANHATTAN_RELEASE_ID);
    expect(inventory.stats.cellCount).toBe(126);
    expect(inventory.stats.ownedBuildingCount).toBe(6_425);
    // Every owned cell the wave does not render ships as a truthful tombstone.
    expect(inventory.stats.renderableCellCount + inventory.stats.notShippedCellCount).toBe(inventory.stats.cellCount);
    expect(inventory.stats.availableBuildingCount + inventory.stats.unavailableBuildingCount).toBe(inventory.stats.ownedBuildingCount);
  });

  /**
   * The texture-catalogue pin. If the rasterizer's code or its constants ever
   * move, the shipped tiles are no longer the tiles this record describes, and
   * this fails rather than the change passing silently.
   */
  it("pins the rasterizer version and parameters hash the shipped tiles came from", () => {
    expect(inventory.textureAdmission.policy).toBe("procedural-replay");
    expect(inventory.textureAdmission.profile).toBe(PROCEDURAL_TEXTURE_PROFILE);
    expect(inventory.textureAdmission.rasterizerVersion).toBe(PROCEDURAL_TEXTURE_RASTERIZER_VERSION);
    expect(inventory.textureAdmission.parametersHashSha256).toBe(proceduralTextureParametersHash());
    expect(inventory.textureAdmission.samplerFilter).toEqual(PROCEDURAL_TEXTURE_SAMPLER_FILTER);
    expect(inventory.census.textureCatalog).toEqual({
      profile: PROCEDURAL_TEXTURE_PROFILE,
      rasterizerVersion: PROCEDURAL_TEXTURE_RASTERIZER_VERSION,
      parametersHashSha256: proceduralTextureParametersHash(),
    });
    // Tiles ride on LOD 0 alone and the catalogue has four classes.
    expect(inventory.census.maximumTextureCount).toBeGreaterThan(0);
    expect(inventory.census.maximumTextureCount).toBeLessThanOrEqual(V3T_QUALITY_BUDGETS.maxTextures);
  });

  it("fits the entry budget it was derived from", () => {
    expect(inventory.occupancy.promotedAssetEntries).toBe(inventory.occupancy.block835AssetEntries + inventory.occupancy.midtownAssetEntries);
    expect(inventory.occupancy.entryBudget).toBe(inventory.occupancy.maxCacheEntries - inventory.occupancy.promotedAssetEntries);
    expect(inventory.census.materializedBuildingCount).toBeLessThanOrEqual(inventory.occupancy.entryBudget);
    expect(inventory.renderableCellIds).toEqual(inventory.renderableCellIds.slice().sort());
  });

  /**
   * Never skipped when the payload is absent. The inventory is COMMITTED, so its
   * internal consistency is checkable on a fresh clone, and a rebuild that moved
   * a byte has to move this file to stay green.
   */
  it("is internally consistent and carries no private-audience path", () => {
    expect(inventory.files).toHaveLength(inventory.totals.fileCount);
    expect(inventory.files.reduce((total, file) => total + file.byteSize, 0)).toBe(inventory.totals.byteSize);
    expect(inventory.files.every((file) => /^[0-9a-f]{64}$/u.test(file.checksumSha256))).toBe(true);
    expect(inventory.files.every((file) => file.path.startsWith("public/") || !file.path.includes("private"))).toBe(true);
    expect(new Set(inventory.files.map((file) => file.path)).size).toBe(inventory.files.length);
    expect(inventory.files.map((file) => file.path)).toEqual(inventory.files.map((file) => file.path).slice().sort());
  });

});
