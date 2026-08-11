import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { sha256HexSync } from "../domain/deterministic-hash.ts";
import { DETERMINISTIC_FACADE_V3T_UNCERTAINTY } from "../domain/deterministic-facade-generator-v3.ts";
import { V3T_QUALITY_BUDGETS, V3_QUALITY_BUDGETS } from "./block835-v3-package.ts";
import {
  PROCEDURAL_TEXTURE_PROFILE,
  PROCEDURAL_TEXTURE_RASTERIZER_VERSION,
  PROCEDURAL_TEXTURE_SAMPLER_FILTER,
  proceduralTextureParametersHash,
} from "./procedural-texture.ts";
import { MIDTOWN_CORE_V3_APPROVAL_EXCLUSIONS, MIDTOWN_CORE_V3_APPROVAL_SCOPE } from "./midtown-core-v3-release.ts";
import { LOWER_MANHATTAN_APPROVAL, LOWER_MANHATTAN_APPROVAL_SCOPE } from "./lower-manhattan-release.ts";
import { BLOCK835_MEMBERSHIP_BUILDING_IDS } from "../runtime/exterior-default-activation.ts";
import { EXTERIOR_RUNTIME_BUDGETS } from "../runtime/exterior-cell-runtime.ts";
import { SOUTHERN_REMAINDER_RELEASE_ID } from "./southern-remainder-package.ts";

/** Block 835 ships both LODs per building; every wave since ships one. */
const BLOCK835_SHIPPED_LOD_COUNT = 2;
import {
  SOUTHERN_REMAINDER_APPROVAL,
  SOUTHERN_REMAINDER_APPROVAL_EXCLUSIONS,
  SOUTHERN_REMAINDER_APPROVAL_NOTE,
  SOUTHERN_REMAINDER_APPROVAL_SCOPE,
  SOUTHERN_REMAINDER_CENSUS_PROFILE,
  SOUTHERN_REMAINDER_MODEST_SUBSET_CEILING,
  SOUTHERN_REMAINDER_PREDECESSOR_RELEASE_ID,
  SOUTHERN_REMAINDER_TEXTURE_ADMISSION,
  SOUTHERN_REMAINDER_WAVE_PROFILE,
  southernRemainderApprovalFingerprint,
  southernRemainderPredecessor,
  southernRemainderRenderableCells,
  southernRemainderRenderableEntryBudget,
} from "./southern-remainder-release.ts";

const RECORD_ROOT = "data/southern-remainder-20260812";

function readText(path: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(readFileSync(path)));
}
function readJson<T>(path: string): T {
  return JSON.parse(readText(path)) as T;
}

interface PayloadInventory {
  releaseId: string;
  ownershipLedgerId: string;
  occupancy: {
    maxCacheEntries: number;
    block835AssetEntries: number;
    midtownAssetEntries: number;
    lowerManhattanAssetEntries: number;
    promotedAssetEntries: number;
    alongsidePromotedHeadroom: number;
    cellsFittingAlongsidePromoted: number;
    waveCellCount: number;
    smallestCellBuildingCount: number;
    medianCellBuildingCount: number;
    admitsMedianCellAlongsidePromoted: boolean;
    optInSoloCeiling: number;
    modestSubsetCeiling: number;
    entryBudget: number;
  };
  renderableCellIds: string[];
  predecessor: { releaseId: string; inventoryChecksumSha256: string; publicRootChecksumSha256: string; snapshotChecksumSha256: string };
  roots: Record<string, { rootId: string; rootChecksumSha256: string; artifactCount: number }>;
  textureAdmission: { policy: string; profile: string; rasterizerVersion: string; parametersHashSha256: string; samplerFilter: { magFilter: number; minFilter: number } };
  census: { materializedBuildingCount: number; maximumTextureCount: number; textureCatalog: { profile: string; rasterizerVersion: string; parametersHashSha256: string } | null };
  stats: { cellCount: number; renderableCellCount: number; notShippedCellCount: number; ownedBuildingCount: number; availableBuildingCount: number; unavailableBuildingCount: number };
  totals: { fileCount: number; byteSize: number };
  files: { path: string; byteSize: number; checksumSha256: string }[];
}

const inventory = readJson<PayloadInventory>(`${RECORD_ROOT}/payload-inventory.json`);

describe("southern-remainder rights instrument", () => {
  /**
   * Why this wave authors a NEW instrument rather than reusing either live one.
   * The Midtown-core scope says its release is TEXTURE-FREE and excludes runtime
   * textures outright, so it cannot admit tiles. The Lower-Manhattan scope does
   * admit them, but its operative first sentence enumerates wave w02's 126 cells
   * and 6,425 buildings — a partition this release does not own. Neither can be
   * read onto wave w03 without saying something false about what was approved.
   */
  it("cannot be satisfied by either frozen scope, and edits neither", () => {
    expect(MIDTOWN_CORE_V3_APPROVAL_SCOPE).toContain("TEXTURE-FREE");
    expect(MIDTOWN_CORE_V3_APPROVAL_EXCLUSIONS).toContain("runtime textures of any kind, procedural or captured");
    expect(LOWER_MANHATTAN_APPROVAL_SCOPE).toContain("126 ownership cells and 6,425 canonical buildings");
    expect(LOWER_MANHATTAN_APPROVAL_SCOPE).toContain("wave w02 (lower-manhattan)");
    expect(SOUTHERN_REMAINDER_APPROVAL_SCOPE).toContain("wave w03 (southern-remainder)");
    expect(SOUTHERN_REMAINDER_APPROVAL_SCOPE).toContain("176 ownership cells and 9,603 canonical buildings");
    expect(SOUTHERN_REMAINDER_APPROVAL_SCOPE).not.toBe(LOWER_MANHATTAN_APPROVAL_SCOPE);
    expect(SOUTHERN_REMAINDER_APPROVAL_SCOPE).not.toBe(MIDTOWN_CORE_V3_APPROVAL_SCOPE);
    // The instrument it was adapted from is untouched, fingerprint included.
    expect(LOWER_MANHATTAN_APPROVAL.fingerprintSha256).toBe("ff8da10f3f4cb7bcb93e58578baea652088b80b3020f0fc1ddc4e088962d120f");
    expect(SOUTHERN_REMAINDER_APPROVAL.id).not.toBe(LOWER_MANHATTAN_APPROVAL.id);
  });

  it("states the reference-only calibration and ingests no image data", () => {
    expect(SOUTHERN_REMAINDER_APPROVAL_SCOPE).toContain("calibrated by VIEWING public reference imagery only");
    expect(SOUTHERN_REMAINDER_APPROVAL_SCOPE).toContain("no image data was ingested, decoded, traced, sampled, or reproduced");
    expect(SOUTHERN_REMAINDER_APPROVAL_SCOPE).toContain("no pixel of any photograph is present in or derivable from the shipped bytes");
    expect(SOUTHERN_REMAINDER_APPROVAL_SCOPE).toContain("re-rasterized and required to match byte for byte");
  });

  /**
   * The tile verbs are narrower than the geometry's, and the operative text has
   * to SAY so. Nothing broadened anything to cover redistributing generated
   * tiles, so letting the tile clause inherit the geometry's verb list would
   * assert a permission nobody granted.
   */
  it("grants tiles display and conveyance only, never redistribution", () => {
    expect(SOUTHERN_REMAINDER_APPROVAL_SCOPE).toContain("FOR LOCAL APPLICATION DISPLAY AND DERIVATIVE CONVEYANCE ONLY AND EXPRESSLY NOT FOR REDISTRIBUTION");
    expect(SOUTHERN_REMAINDER_APPROVAL_EXCLUSIONS.some((entry) => entry.startsWith("redistribution of the procedural facade detail tiles"))).toBe(true);
    expect(SOUTHERN_REMAINDER_APPROVAL_SCOPE).toContain("redistribution of deterministically generated exterior geometry");
    expect(SOUTHERN_REMAINDER_APPROVAL_NOTE).toContain("no recorded item broadened anything to permit redistributing generated tiles");
  });

  it("still excludes public deployment, captured imagery and any facade-fidelity claim", () => {
    expect(SOUTHERN_REMAINDER_APPROVAL_EXCLUSIONS).toContain("public internet deployment");
    expect(SOUTHERN_REMAINDER_APPROVAL_EXCLUSIONS).toContain("captured, photographic, or otherwise source-derived texture imagery of any kind");
    expect(SOUTHERN_REMAINDER_APPROVAL_EXCLUSIONS.some((entry) => entry.includes("reproduces, resembles, or reports on a real building's facade"))).toBe(true);
    expect(SOUTHERN_REMAINDER_APPROVAL_EXCLUSIONS).toContain("redistribution of the raw jh45-qr5r source dataset");
    expect(SOUTHERN_REMAINDER_APPROVAL_EXCLUSIONS).toContain("runtime external network requests");
    // No permission the predecessor wave lacked: the two exclusion lists agree.
    expect([...SOUTHERN_REMAINDER_APPROVAL_EXCLUSIONS].sort()).toEqual([...LOWER_MANHATTAN_APPROVAL.exclusions].sort());
  });

  /**
   * The honesty clause this wave adds, and the reason it exists: a per-wave
   * instrument invites a reader to assume a per-wave approval event. There was
   * none. The note must say so in words rather than leaving the inference open.
   */
  it("says in its own text that it rests on no fresh signature", () => {
    expect(SOUTHERN_REMAINDER_APPROVAL_NOTE).toContain("THIS INSTRUMENT RESTS ON NO FRESH SIGNATURE");
    expect(SOUTHERN_REMAINDER_APPROVAL_NOTE).toContain("No approval was sought or given for wave w03 specifically");
    expect(SOUTHERN_REMAINDER_APPROVAL_NOTE).toContain("recorded texture direction of 2026-08-11");
    expect(SOUTHERN_REMAINDER_APPROVAL_NOTE).toContain("recorded standing autonomy directive");
    expect(SOUTHERN_REMAINDER_APPROVAL_NOTE).toContain("it is not authored because new permission was obtained");
    expect(SOUTHERN_REMAINDER_APPROVAL_NOTE).toContain("Neither recorded item is a licence grant from any third party");
  });

  /** Pinned exactly as the earlier scopes are pinned: a moved word moves the hash. */
  it("pins the approval fingerprint to its own text", () => {
    expect(SOUTHERN_REMAINDER_APPROVAL.fingerprintSha256).toBe(southernRemainderApprovalFingerprint());
    expect(SOUTHERN_REMAINDER_APPROVAL.fingerprintSha256).toBe("c4ba50b33490e619fa2662e312d796fb82db47c3561a73c65da9f8fef6054ac4");
    expect(SOUTHERN_REMAINDER_APPROVAL.fingerprintSha256).not.toBe(LOWER_MANHATTAN_APPROVAL.fingerprintSha256);
  });
});

describe("southern-remainder emission profiles", () => {
  it("ships textures at LOD 0 under the V3T budgets, never the zero-texture V3 ones", () => {
    expect(SOUTHERN_REMAINDER_WAVE_PROFILE.texture).toBe(PROCEDURAL_TEXTURE_PROFILE);
    expect(SOUTHERN_REMAINDER_WAVE_PROFILE.budgets).toEqual(V3T_QUALITY_BUDGETS);
    expect(V3_QUALITY_BUDGETS.maxTextures).toBe(0);
    expect(SOUTHERN_REMAINDER_WAVE_PROFILE.textureFilter).toEqual(PROCEDURAL_TEXTURE_SAMPLER_FILTER);
    expect(SOUTHERN_REMAINDER_WAVE_PROFILE.uncertainty).toBe(DETERMINISTIC_FACADE_V3T_UNCERTAINTY);
  });

  /**
   * The census profile is untextured but must share every field that enters a
   * plan hash, or the wave census would be a statement about different buildings
   * than the ones that ship.
   */
  it("censuses on the identical grammar it ships", () => {
    expect(SOUTHERN_REMAINDER_CENSUS_PROFILE.seed).toBe(SOUTHERN_REMAINDER_WAVE_PROFILE.seed);
    expect(SOUTHERN_REMAINDER_CENSUS_PROFILE.generatedAt).toBe(SOUTHERN_REMAINDER_WAVE_PROFILE.generatedAt);
    expect(SOUTHERN_REMAINDER_CENSUS_PROFILE.tool).toEqual(SOUTHERN_REMAINDER_WAVE_PROFILE.tool);
    expect(SOUTHERN_REMAINDER_CENSUS_PROFILE.releaseId).toBe(SOUTHERN_REMAINDER_WAVE_PROFILE.releaseId);
    expect(SOUTHERN_REMAINDER_CENSUS_PROFILE.texture).toBeNull();
  });

  it("declares the procedural-replay admission the runtime reads unchanged", () => {
    expect(SOUTHERN_REMAINDER_TEXTURE_ADMISSION.policy).toBe("procedural-replay");
    const fact = SOUTHERN_REMAINDER_TEXTURE_ADMISSION.generatedTextureFact!;
    expect(fact.basis).toBe("generated-texture");
    expect(fact.gate).toBe("rasterizer-replay");
    // Explicitly null, never absent: a generated tile cites no evidence record.
    expect(fact.evidenceBasis).toBeNull();
    expect(fact.samplerFilter).toEqual(PROCEDURAL_TEXTURE_SAMPLER_FILTER);
  });
});

describe("southern-remainder renderable-subset derivation", () => {
  /**
   * The arithmetic this wave exists to state. Three promoted waves occupy
   * 28 + 156 + 71 = 255 of the 256-entry cache, so ONE entry is free and no cell
   * of any wave fits in it. That blocks PROMOTION at today's cap and is reported
   * as blocking, rather than being quietly reinterpreted into a passing number.
   */
  it("reports the promoted headroom honestly and calls it inadmissible", () => {
    const budget = southernRemainderRenderableEntryBudget({
      maxCacheEntries: 256,
      block835AssetEntries: 28,
      midtownAssetEntries: 156,
      lowerManhattanAssetEntries: 71,
      modestSubsetCeiling: SOUTHERN_REMAINDER_MODEST_SUBSET_CEILING,
      // The real wave: two single-building cells, a median of 50, a leading
      // cell of 77.
      cellBuildingCounts: [1, 1, 2, 50, 50, 77, 119],
    });
    expect(budget.promotedAssetEntries).toBe(255);
    expect(budget.alongsidePromotedHeadroom).toBe(1);
    // One free entry admits exactly the two single-building cells and nothing
    // else. Saying "no cell fits" would have been false by a technicality, and
    // saying "a cell fits" would have been true and useless; both numbers ship.
    expect(budget.cellsFittingAlongsidePromoted).toBe(2);
    expect(budget.medianCellBuildingCount).toBe(50);
    expect(budget.admitsMedianCellAlongsidePromoted).toBe(false);
    // The opt-in ceiling is the cache itself, because `?exteriorCells=` selects
    // the named release ALONE; the applied budget is the modest ceiling.
    expect(budget.optInSoloCeiling).toBe(256);
    expect(budget.entryBudget).toBe(SOUTHERN_REMAINDER_MODEST_SUBSET_CEILING);
  });

  /** A ceiling no session could hold, or none at all, is refused rather than clamped. */
  it("refuses a ceiling the cache cannot hold", () => {
    const base = {
      maxCacheEntries: 256,
      block835AssetEntries: 28,
      midtownAssetEntries: 156,
      lowerManhattanAssetEntries: 71,
      cellBuildingCounts: [1, 50, 77],
    };
    expect(() => southernRemainderRenderableEntryBudget({ ...base, modestSubsetCeiling: 257 })).toThrow(/exceeds the 256-entry cache cap/u);
    expect(() => southernRemainderRenderableEntryBudget({ ...base, modestSubsetCeiling: 0 })).toThrow(/must admit at least one entry/u);
  });

  it("admits whole cells only, in priority order, while the subset still fits", () => {
    const cells = [
      { cellId: "a", buildingIds: Array.from({ length: 77 }, (_, index) => `a${index}`) },
      { cellId: "b", buildingIds: Array.from({ length: 76 }, (_, index) => `b${index}`) },
      { cellId: "c", buildingIds: Array.from({ length: 30 }, (_, index) => `c${index}`) },
    ];
    const chosen = southernRemainderRenderableCells(cells, 80);
    expect(chosen.cells.map((cell) => cell.cellId)).toEqual(["a"]);
    expect(chosen.ownedBuildingCount).toBe(77);
    expect(chosen.spareEntries).toBe(3);
    // A cell is never split, and the walk STOPS at the first cell that does not
    // fit rather than skipping it: skipping would reorder the wave's declared
    // visual priority to fill a budget, which is a curation nobody recorded.
    expect(southernRemainderRenderableCells(cells, 160).cells.map((cell) => cell.cellId)).toEqual(["a", "b"]);
    expect(southernRemainderRenderableCells(cells, 110).cells.map((cell) => cell.cellId)).toEqual(["a"]);
  });

  it("refuses a budget no cell fits", () => {
    expect(() => southernRemainderRenderableCells([{ cellId: "a", buildingIds: ["x", "y"] }], 1)).toThrow(/no cell fits/u);
  });
});

describe("southern-remainder predecessor lineage", () => {
  it("refuses pins that did not come from the promoted Lower-Manhattan P1 wave", () => {
    expect(() => southernRemainderPredecessor({ releaseId: "manhattan-lower-manhattan-cells-20260812", files: [] })).toThrow(/pins must come from/u);
  });

  it("derives the promoted wave's root and snapshot from its committed inventory", () => {
    const committed = readJson<{ releaseId: string; roots: Record<string, { rootId: string; rootChecksumSha256: string; artifactCount: number }>; files: { path: string; byteSize: number; checksumSha256: string }[] }>(
      "data/lower-manhattan-20260812-p1/payload-inventory.json",
    );
    const predecessor = southernRemainderPredecessor(committed);
    expect(predecessor.releaseId).toBe(SOUTHERN_REMAINDER_PREDECESSOR_RELEASE_ID);
    expect(predecessor.publicRoot.rootChecksumSha256).toBe(committed.roots.public!.rootChecksumSha256);
    // Wave w02 owns 126 cells and every one of them ships a cell release, the
    // tombstoned ones included.
    expect(predecessor.cellReleases.size).toBe(126);
  });
});

describe("southern-remainder committed payload inventory", () => {
  it("describes the release this module names", () => {
    expect(inventory.releaseId).toBe(SOUTHERN_REMAINDER_RELEASE_ID);
    expect(inventory.stats.cellCount).toBe(176);
    expect(inventory.stats.ownedBuildingCount).toBe(9_603);
    // Every owned cell the wave does not render ships as a truthful tombstone.
    expect(inventory.stats.renderableCellCount + inventory.stats.notShippedCellCount).toBe(inventory.stats.cellCount);
    expect(inventory.stats.availableBuildingCount + inventory.stats.unavailableBuildingCount).toBe(inventory.stats.ownedBuildingCount);
  });

  it("pins its predecessor to the promoted Lower-Manhattan P1 release", () => {
    expect(inventory.predecessor.releaseId).toBe(SOUTHERN_REMAINDER_PREDECESSOR_RELEASE_ID);
    const committedText = readText("data/lower-manhattan-20260812-p1/payload-inventory.json");
    expect(inventory.predecessor.inventoryChecksumSha256).toBe(sha256HexSync(committedText));
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

  /**
   * The promoted occupancy is not a remembered number. Block 835 ships both LODs
   * for each of its fourteen canonical buildings, so its 28 cache entries are a
   * function of the committed membership constant; the other two are their own
   * committed inventories' LOD 0 asset counts.
   */
  it("pins each promoted wave's occupancy to that wave's own committed record", () => {
    expect(BLOCK835_MEMBERSHIP_BUILDING_IDS).toHaveLength(14);
    expect(inventory.occupancy.block835AssetEntries).toBe(BLOCK835_MEMBERSHIP_BUILDING_IDS.length * BLOCK835_SHIPPED_LOD_COUNT);
    expect(inventory.occupancy.block835AssetEntries).toBe(28);
    const glbCount = (path: string): number =>
      readJson<{ files: { path: string }[] }>(path).files.filter((file) => /^public\/assets\/.*\.glb$/u.test(file.path)).length;
    expect(inventory.occupancy.midtownAssetEntries).toBe(glbCount("data/midtown-core-20260811-v3/payload-inventory.json"));
    expect(inventory.occupancy.lowerManhattanAssetEntries).toBe(glbCount("data/lower-manhattan-20260812-p1/payload-inventory.json"));
    // 256, LITERALLY, and no longer compared against the live constant.
    //
    // This inventory is FROZEN BYTES: its checksum is what the P1 successor's
    // predecessor pin is taken over, so re-emitting it to carry a newer cap would
    // move a pin the successor depends on. The canary was emitted against a
    // 256-entry cap and that is a true historical statement about it. T018 raised
    // the live cap to 512 (ADR 0034 admissible response 1), and comparing a frozen
    // record against a constant that has since moved would have forced exactly the
    // re-emission the freeze exists to prevent.
    expect(inventory.occupancy.maxCacheEntries).toBe(256);
    expect(EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries).toBe(512);
  });

  /**
   * The committed record states the promotion blocker rather than only the
   * budget it used. `admissibleAlongsidePromoted: false` is the fact T018 has to
   * resolve before this wave can be promoted at all, and it is carried in the
   * release's own bytes so a reader does not have to find an ADR to learn it.
   */
  it("records that no subset of this wave fits beside the promoted set today", () => {
    expect(inventory.occupancy.promotedAssetEntries)
      .toBe(inventory.occupancy.block835AssetEntries + inventory.occupancy.midtownAssetEntries + inventory.occupancy.lowerManhattanAssetEntries);
    expect(inventory.occupancy.alongsidePromotedHeadroom)
      .toBe(inventory.occupancy.maxCacheEntries - inventory.occupancy.promotedAssetEntries);
    expect(inventory.occupancy.admitsMedianCellAlongsidePromoted).toBe(false);
    expect(inventory.occupancy.waveCellCount).toBe(176);
    expect(inventory.occupancy.smallestCellBuildingCount).toBe(1);
    expect(inventory.occupancy.cellsFittingAlongsidePromoted).toBe(2);
    expect(inventory.occupancy.entryBudget).toBe(SOUTHERN_REMAINDER_MODEST_SUBSET_CEILING);
    expect(inventory.occupancy.entryBudget).toBeLessThanOrEqual(inventory.occupancy.optInSoloCeiling);
  });

  it("fits the entry budget it was derived from", () => {
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
