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
import { SOUTHERN_REMAINDER_APPROVAL, SOUTHERN_REMAINDER_APPROVAL_SCOPE } from "./southern-remainder-release.ts";
import { BLOCK835_MEMBERSHIP_BUILDING_IDS, EXTERIOR_DEFAULT_ACTIVATIONS } from "../runtime/exterior-default-activation.ts";
import { EXTERIOR_RUNTIME_BUDGETS } from "../runtime/exterior-cell-runtime.ts";
import { CENTRAL_UPPER_MANHATTAN_RELEASE_ID } from "./central-upper-manhattan-package.ts";

/** Block 835 ships both LODs per building; every wave since ships one. */
const BLOCK835_SHIPPED_LOD_COUNT = 2;
import {
  CENTRAL_UPPER_MANHATTAN_APPROVAL,
  CENTRAL_UPPER_MANHATTAN_APPROVAL_EXCLUSIONS,
  CENTRAL_UPPER_MANHATTAN_APPROVAL_NOTE,
  CENTRAL_UPPER_MANHATTAN_APPROVAL_SCOPE,
  CENTRAL_UPPER_MANHATTAN_CENSUS_PROFILE,
  CENTRAL_UPPER_MANHATTAN_MODEST_SUBSET_CEILING,
  CENTRAL_UPPER_MANHATTAN_PREDECESSOR_RELEASE_ID,
  CENTRAL_UPPER_MANHATTAN_TEXTURE_ADMISSION,
  CENTRAL_UPPER_MANHATTAN_WAVE_PROFILE,
  centralUpperManhattanApprovalFingerprint,
  centralUpperManhattanPredecessor,
  centralUpperManhattanRenderableCells,
  centralUpperManhattanRenderableEntryBudget,
} from "./central-upper-manhattan-release.ts";

const RECORD_ROOT = "data/central-upper-manhattan-20260812";

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
    promotedWaves: { releaseId: string; assetEntries: number }[];
    promotedWaveCount: number;
    promotedAssetEntries: number;
    alongsidePromotedHeadroom: number;
    cellsFittingAlongsidePromoted: number;
    waveCellCount: number;
    smallestCellBuildingCount: number;
    medianCellBuildingCount: number;
    admitsMedianCellAlongsidePromoted: boolean;
    remainingUnpromotedWaves: { waveId: string; cellCount: number; medianCellBuildingCount: number }[];
    medianCellsOfAllRemainingWaves: number;
    headroomAdmitsMedianCellOfEveryRemainingWaveTogether: boolean;
    optInSoloCeiling: number;
    modestSubsetCeiling: number;
    entryBudget: number;
  };
  renderableCellIds: string[];
  refusedBuildingIds: string[];
  predecessor: { releaseId: string; inventoryChecksumSha256: string; publicRootChecksumSha256: string; snapshotChecksumSha256: string };
  roots: Record<string, { rootId: string; rootChecksumSha256: string; artifactCount: number }>;
  textureAdmission: { policy: string; profile: string; rasterizerVersion: string; parametersHashSha256: string; samplerFilter: { magFilter: number; minFilter: number } };
  census: { requestedBuildingCount: number; materializedBuildingCount: number; maximumTextureCount: number; textureCatalog: { profile: string; rasterizerVersion: string; parametersHashSha256: string } | null };
  stats: { cellCount: number; renderableCellCount: number; notShippedCellCount: number; ownedBuildingCount: number; availableBuildingCount: number; unavailableBuildingCount: number };
  totals: { fileCount: number; byteSize: number };
  files: { path: string; byteSize: number; checksumSha256: string }[];
}

const inventory = readJson<PayloadInventory>(`${RECORD_ROOT}/payload-inventory.json`);

describe("central-upper-manhattan rights instrument", () => {
  /**
   * Why this wave authors a NEW instrument rather than reusing any live one. The
   * Midtown-core scope says its release is TEXTURE-FREE and excludes runtime
   * textures outright, so it cannot admit tiles. The Lower-Manhattan and
   * Southern-remainder scopes do admit them, but each one's operative first
   * sentence enumerates its own wave's partition — 126 cells and 6,425 buildings,
   * 176 cells and 9,603 buildings. None can be read onto wave w04 without saying
   * something false about what was approved.
   */
  it("cannot be satisfied by any frozen scope, and edits none of them", () => {
    expect(MIDTOWN_CORE_V3_APPROVAL_SCOPE).toContain("TEXTURE-FREE");
    expect(MIDTOWN_CORE_V3_APPROVAL_EXCLUSIONS).toContain("runtime textures of any kind, procedural or captured");
    expect(LOWER_MANHATTAN_APPROVAL_SCOPE).toContain("126 ownership cells and 6,425 canonical buildings");
    expect(SOUTHERN_REMAINDER_APPROVAL_SCOPE).toContain("176 ownership cells and 9,603 canonical buildings");
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL_SCOPE).toContain("wave w04 (central-upper-manhattan)");
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL_SCOPE).toContain("249 ownership cells and 11,721 canonical buildings");
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL_SCOPE).not.toBe(SOUTHERN_REMAINDER_APPROVAL_SCOPE);
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL_SCOPE).not.toBe(LOWER_MANHATTAN_APPROVAL_SCOPE);
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL_SCOPE).not.toBe(MIDTOWN_CORE_V3_APPROVAL_SCOPE);
    // The instruments it was adapted from are untouched, fingerprints included.
    expect(LOWER_MANHATTAN_APPROVAL.fingerprintSha256).toBe("ff8da10f3f4cb7bcb93e58578baea652088b80b3020f0fc1ddc4e088962d120f");
    expect(SOUTHERN_REMAINDER_APPROVAL.fingerprintSha256).toBe("c4ba50b33490e619fa2662e312d796fb82db47c3561a73c65da9f8fef6054ac4");
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL.id).not.toBe(SOUTHERN_REMAINDER_APPROVAL.id);
  });

  it("states the reference-only calibration and ingests no image data", () => {
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL_SCOPE).toContain("calibrated by VIEWING public reference imagery only");
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL_SCOPE).toContain("no image data was ingested, decoded, traced, sampled, or reproduced");
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL_SCOPE).toContain("no pixel of any photograph is present in or derivable from the shipped bytes");
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL_SCOPE).toContain("re-rasterized and required to match byte for byte");
  });

  /**
   * The tile verbs are narrower than the geometry's, and the operative text has
   * to SAY so. Nothing broadened anything to cover redistributing generated
   * tiles, so letting the tile clause inherit the geometry's verb list would
   * assert a permission nobody granted.
   */
  it("grants tiles display and conveyance only, never redistribution", () => {
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL_SCOPE).toContain("FOR LOCAL APPLICATION DISPLAY AND DERIVATIVE CONVEYANCE ONLY AND EXPRESSLY NOT FOR REDISTRIBUTION");
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL_EXCLUSIONS.some((entry) => entry.startsWith("redistribution of the procedural facade detail tiles"))).toBe(true);
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL_SCOPE).toContain("redistribution of deterministically generated exterior geometry");
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL_NOTE).toContain("no recorded item broadened anything to permit redistributing generated tiles");
  });

  it("still excludes public deployment, captured imagery and any facade-fidelity claim", () => {
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL_EXCLUSIONS).toContain("public internet deployment");
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL_EXCLUSIONS).toContain("captured, photographic, or otherwise source-derived texture imagery of any kind");
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL_EXCLUSIONS.some((entry) => entry.includes("reproduces, resembles, or reports on a real building's facade"))).toBe(true);
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL_EXCLUSIONS).toContain("redistribution of the raw jh45-qr5r source dataset");
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL_EXCLUSIONS).toContain("runtime external network requests");
    // No permission the predecessor wave lacked: the two exclusion lists agree.
    expect([...CENTRAL_UPPER_MANHATTAN_APPROVAL_EXCLUSIONS].sort()).toEqual([...SOUTHERN_REMAINDER_APPROVAL.exclusions].sort());
  });

  /**
   * The honesty clause, carried from the previous wave because the situation is
   * identical: a per-wave instrument invites a reader to assume a per-wave
   * approval event. There was none.
   */
  it("says in its own text that it rests on no fresh signature", () => {
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL_NOTE).toContain("THIS INSTRUMENT RESTS ON NO FRESH SIGNATURE");
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL_NOTE).toContain("No approval was sought or given for wave w04 specifically");
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL_NOTE).toContain("recorded texture direction of 2026-08-11");
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL_NOTE).toContain("recorded standing autonomy directive");
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL_NOTE).toContain("it is not authored because new permission was obtained");
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL_NOTE).toContain("Neither recorded item is a licence grant from any third party");
  });

  /**
   * The clause this wave adds, and why it needs one the earlier waves did not.
   *
   * This is the largest partition any instrument has covered, and "largest" is
   * exactly the word that invites a reader to think the envelope grew with it. It
   * did not: an envelope is a set of verbs over a set of sources, and covering
   * more buildings of the same pinned source under the same verbs is the same
   * envelope. The note says so rather than leaving the inference open.
   */
  it("says that being the largest wave broadens nothing", () => {
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL_NOTE).toContain("THAT THIS IS THE LARGEST WAVE BROADENS NOTHING");
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL_NOTE).toContain("covering more buildings of the same pinned source under the same verbs is not a wider envelope");
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL_NOTE).toContain("it grants no verb, no source and no envelope that the 2026-08-11 authorization did not already carry");
  });

  /** Pinned exactly as the earlier scopes are pinned: a moved word moves the hash. */
  it("pins the approval fingerprint to its own text", () => {
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL.fingerprintSha256).toBe(centralUpperManhattanApprovalFingerprint());
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL.fingerprintSha256).toBe("81ba0879fbc956c912db7548ff7650a3364fd0bf1ab117a7926cf75d0714df5e");
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL.fingerprintSha256).not.toBe(SOUTHERN_REMAINDER_APPROVAL.fingerprintSha256);
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL.fingerprintSha256).not.toBe(LOWER_MANHATTAN_APPROVAL.fingerprintSha256);
  });
});

describe("central-upper-manhattan emission profiles", () => {
  it("ships textures at LOD 0 under the V3T budgets, never the zero-texture V3 ones", () => {
    expect(CENTRAL_UPPER_MANHATTAN_WAVE_PROFILE.texture).toBe(PROCEDURAL_TEXTURE_PROFILE);
    expect(CENTRAL_UPPER_MANHATTAN_WAVE_PROFILE.budgets).toEqual(V3T_QUALITY_BUDGETS);
    expect(V3_QUALITY_BUDGETS.maxTextures).toBe(0);
    expect(CENTRAL_UPPER_MANHATTAN_WAVE_PROFILE.textureFilter).toEqual(PROCEDURAL_TEXTURE_SAMPLER_FILTER);
    expect(CENTRAL_UPPER_MANHATTAN_WAVE_PROFILE.uncertainty).toBe(DETERMINISTIC_FACADE_V3T_UNCERTAINTY);
  });

  /**
   * The census profile is untextured but must share every field that enters a
   * plan hash, or the wave census would be a statement about different buildings
   * than the ones that ship.
   */
  it("censuses on the identical grammar it ships", () => {
    expect(CENTRAL_UPPER_MANHATTAN_CENSUS_PROFILE.seed).toBe(CENTRAL_UPPER_MANHATTAN_WAVE_PROFILE.seed);
    expect(CENTRAL_UPPER_MANHATTAN_CENSUS_PROFILE.generatedAt).toBe(CENTRAL_UPPER_MANHATTAN_WAVE_PROFILE.generatedAt);
    expect(CENTRAL_UPPER_MANHATTAN_CENSUS_PROFILE.tool).toEqual(CENTRAL_UPPER_MANHATTAN_WAVE_PROFILE.tool);
    expect(CENTRAL_UPPER_MANHATTAN_CENSUS_PROFILE.releaseId).toBe(CENTRAL_UPPER_MANHATTAN_WAVE_PROFILE.releaseId);
    expect(CENTRAL_UPPER_MANHATTAN_CENSUS_PROFILE.texture).toBeNull();
  });

  it("declares the procedural-replay admission the runtime reads unchanged", () => {
    expect(CENTRAL_UPPER_MANHATTAN_TEXTURE_ADMISSION.policy).toBe("procedural-replay");
    const fact = CENTRAL_UPPER_MANHATTAN_TEXTURE_ADMISSION.generatedTextureFact!;
    expect(fact.basis).toBe("generated-texture");
    expect(fact.gate).toBe("rasterizer-replay");
    // Explicitly null, never absent: a generated tile cites no evidence record.
    expect(fact.evidenceBasis).toBeNull();
    expect(fact.samplerFilter).toEqual(PROCEDURAL_TEXTURE_SAMPLER_FILTER);
  });
});

describe("central-upper-manhattan renderable-subset derivation", () => {
  const promotedWaves = [
    { releaseId: "manhattan-exterior-cells-20260811-v3", assetEntries: 28 },
    { releaseId: "manhattan-midtown-core-cells-20260811-v3", assetEntries: 156 },
    { releaseId: "manhattan-lower-manhattan-cells-20260812-p1", assetEntries: 71 },
    { releaseId: "manhattan-southern-remainder-cells-20260812-p1", assetEntries: 179 },
  ];
  const remainingUnpromotedWaves = [
    { waveId: "central-upper-manhattan", cellBuildingCounts: [1, 2, 25, 48, 51, 67, 119] },
    { waveId: "northern-manhattan", cellBuildingCounts: [1, 20, 55, 90, 119] },
  ];

  /**
   * The arithmetic this wave exists to state, and it is a DIFFERENT statement
   * from wave w03's. Four promoted waves occupy 28 + 156 + 71 + 179 = 434 of the
   * 512-entry cache T018 raised the cap to, so 78 entries are free — a real
   * headroom rather than the single entry w03 had to report. This wave's median
   * cell owns 48, so the headroom does admit an ordinary cell of it.
   */
  it("reports a promoted headroom that admits this wave's median cell", () => {
    const budget = centralUpperManhattanRenderableEntryBudget({
      maxCacheEntries: 512,
      promotedWaves,
      modestSubsetCeiling: CENTRAL_UPPER_MANHATTAN_MODEST_SUBSET_CEILING,
      cellBuildingCounts: remainingUnpromotedWaves[0]!.cellBuildingCounts,
      remainingUnpromotedWaves,
    });
    expect(budget.promotedWaveCount).toBe(4);
    expect(budget.promotedAssetEntries).toBe(434);
    expect(budget.alongsidePromotedHeadroom).toBe(78);
    expect(budget.medianCellBuildingCount).toBe(48);
    expect(budget.admitsMedianCellAlongsidePromoted).toBe(true);
    // The opt-in ceiling is the cache itself, because `?exteriorCells=` selects
    // the named release ALONE; the applied budget is the modest ceiling.
    expect(budget.optInSoloCeiling).toBe(512);
    expect(budget.entryBudget).toBe(CENTRAL_UPPER_MANHATTAN_MODEST_SUBSET_CEILING);
  });

  /**
   * And the half that stops the sentence above from being read as a promotion
   * clearance. The 78 entries are not this wave's to spend: wave w05 is also
   * unpromoted, its median cell owns 55, and 48 + 55 = 103 does not fit in 78.
   * The headroom admits EITHER wave's median cell and not one from each, which is
   * the split T020 and T022 have to settle and this canary does not.
   */
  it("reports that the headroom cannot hold a median cell from both unpromoted waves", () => {
    const budget = centralUpperManhattanRenderableEntryBudget({
      maxCacheEntries: 512,
      promotedWaves,
      modestSubsetCeiling: CENTRAL_UPPER_MANHATTAN_MODEST_SUBSET_CEILING,
      cellBuildingCounts: remainingUnpromotedWaves[0]!.cellBuildingCounts,
      remainingUnpromotedWaves,
    });
    expect(budget.remainingUnpromotedWaves.map((wave) => wave.waveId)).toEqual(["central-upper-manhattan", "northern-manhattan"]);
    expect(budget.remainingUnpromotedWaves.map((wave) => wave.medianCellBuildingCount)).toEqual([48, 55]);
    expect(budget.medianCellsOfAllRemainingWaves).toBe(103);
    expect(budget.headroomAdmitsMedianCellOfEveryRemainingWaveTogether).toBe(false);
    // Both answers are recorded, because reporting only the first would read as a
    // clearance and reporting only the second would read as a blocker.
    expect(budget.admitsMedianCellAlongsidePromoted).toBe(true);
  });

  /** A ceiling no session could hold, or none at all, is refused rather than clamped. */
  it("refuses a ceiling the cache cannot hold", () => {
    const base = {
      maxCacheEntries: 512,
      promotedWaves,
      cellBuildingCounts: [1, 48, 77],
      remainingUnpromotedWaves,
    };
    expect(() => centralUpperManhattanRenderableEntryBudget({ ...base, modestSubsetCeiling: 513 })).toThrow(/exceeds the 512-entry cache cap/u);
    expect(() => centralUpperManhattanRenderableEntryBudget({ ...base, modestSubsetCeiling: 0 })).toThrow(/must admit at least one entry/u);
  });

  /**
   * The promoted list is the whole basis of the occupancy statement, so the ways
   * of corrupting it fail rather than quietly changing the answer. An empty list
   * would report the entire cache as free; a duplicated release would double-count
   * a wave; a zero-asset wave is not a promoted wave.
   */
  it("refuses a promoted list that would misstate the occupied set", () => {
    const base = {
      maxCacheEntries: 512,
      modestSubsetCeiling: CENTRAL_UPPER_MANHATTAN_MODEST_SUBSET_CEILING,
      cellBuildingCounts: [1, 48, 77],
      remainingUnpromotedWaves,
    };
    expect(() => centralUpperManhattanRenderableEntryBudget({ ...base, promotedWaves: [] })).toThrow(/no promoted wave was supplied/u);
    expect(() => centralUpperManhattanRenderableEntryBudget({ ...base, promotedWaves: [...promotedWaves, promotedWaves[0]!] })).toThrow(/counted twice/u);
    expect(() => centralUpperManhattanRenderableEntryBudget({ ...base, promotedWaves: [{ releaseId: "empty", assetEntries: 0 }] })).toThrow(/is not a promoted wave/u);
    expect(() => centralUpperManhattanRenderableEntryBudget({ ...base, promotedWaves, remainingUnpromotedWaves: [] })).toThrow(/no unpromoted wave was supplied/u);
  });

  it("admits whole cells only, in priority order, while the subset still fits", () => {
    const cells = [
      { cellId: "a", buildingIds: Array.from({ length: 25 }, (_, index) => `a${index}`) },
      { cellId: "b", buildingIds: Array.from({ length: 51 }, (_, index) => `b${index}`) },
      { cellId: "c", buildingIds: Array.from({ length: 2 }, (_, index) => `c${index}`) },
      { cellId: "d", buildingIds: Array.from({ length: 50 }, (_, index) => `d${index}`) },
    ];
    // The real wave's leading four cells: 25 + 51 + 2 = 78 fits an 80-entry
    // budget and the fourth cell's 50 does not.
    const chosen = centralUpperManhattanRenderableCells(cells, 80);
    expect(chosen.cells.map((cell) => cell.cellId)).toEqual(["a", "b", "c"]);
    expect(chosen.ownedBuildingCount).toBe(78);
    expect(chosen.spareEntries).toBe(2);
    // A cell is never split, and the walk STOPS at the first cell that does not
    // fit rather than skipping it: skipping would reorder the wave's declared
    // visual priority to fill a budget, which is a curation nobody recorded. Here
    // that is visible — cell `d` does not fit at 100 but `c` alone would have.
    expect(centralUpperManhattanRenderableCells(cells, 100).cells.map((cell) => cell.cellId)).toEqual(["a", "b", "c"]);
    expect(centralUpperManhattanRenderableCells(cells, 130).cells.map((cell) => cell.cellId)).toEqual(["a", "b", "c", "d"]);
  });

  it("refuses a budget no cell fits", () => {
    expect(() => centralUpperManhattanRenderableCells([{ cellId: "a", buildingIds: ["x", "y"] }], 1)).toThrow(/no cell fits/u);
  });
});

describe("central-upper-manhattan predecessor lineage", () => {
  it("refuses pins that did not come from the promoted Southern-remainder P1 wave", () => {
    expect(() => centralUpperManhattanPredecessor({ releaseId: "manhattan-southern-remainder-cells-20260812", files: [] })).toThrow(/pins must come from/u);
  });

  it("derives the promoted wave's root and snapshot from its committed inventory", () => {
    const committed = readJson<{ releaseId: string; roots: Record<string, { rootId: string; rootChecksumSha256: string; artifactCount: number }>; files: { path: string; byteSize: number; checksumSha256: string }[] }>(
      "data/southern-remainder-20260812-p1/payload-inventory.json",
    );
    const predecessor = centralUpperManhattanPredecessor(committed);
    expect(predecessor.releaseId).toBe(CENTRAL_UPPER_MANHATTAN_PREDECESSOR_RELEASE_ID);
    expect(predecessor.publicRoot.rootChecksumSha256).toBe(committed.roots.public!.rootChecksumSha256);
    // Wave w03 owns 176 cells and every one of them ships a cell release, the
    // tombstoned ones included.
    expect(predecessor.cellReleases.size).toBe(176);
  });
});

describe("central-upper-manhattan committed payload inventory", () => {
  it("describes the release this module names", () => {
    expect(inventory.releaseId).toBe(CENTRAL_UPPER_MANHATTAN_RELEASE_ID);
    expect(inventory.stats.cellCount).toBe(249);
    expect(inventory.stats.ownedBuildingCount).toBe(11_721);
    // Every owned cell the wave does not render ships as a truthful tombstone.
    expect(inventory.stats.renderableCellCount).toBe(3);
    expect(inventory.stats.notShippedCellCount).toBe(246);
    expect(inventory.stats.renderableCellCount + inventory.stats.notShippedCellCount).toBe(inventory.stats.cellCount);
    expect(inventory.stats.availableBuildingCount + inventory.stats.unavailableBuildingCount).toBe(inventory.stats.ownedBuildingCount);
  });

  it("pins its predecessor to the promoted Southern-remainder P1 release", () => {
    expect(inventory.predecessor.releaseId).toBe(CENTRAL_UPPER_MANHATTAN_PREDECESSOR_RELEASE_ID);
    const committedText = readText("data/southern-remainder-20260812-p1/payload-inventory.json");
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
   * function of the committed membership constant; the other three are their own
   * committed inventories' shipped GLB counts.
   *
   * COMPLETENESS IS CHECKED AGAINST THE LIVE PROMOTION RECORD, NOT AGAINST THIS
   * INVENTORY'S OWN ROW COUNT.
   *
   * An earlier version of this comment claimed a fifth promotion that forgot to
   * update the pipeline "would fail here". It would not have. Every assertion
   * below reads `payload-inventory.json`, which is immutable committed bytes:
   * `promotedWaveCount === 4` is a true statement about a frozen record and stays
   * green forever, however many waves are promoted afterwards. The claim was the
   * one untrue sentence in this suite.
   *
   * The assertion that DOES fail on a fifth promotion is the one added here: the
   * release ids this inventory counted, compared against the enabled records of
   * the LIVE `EXTERIOR_DEFAULT_ACTIVATIONS`. Promoting a wave adds an enabled
   * record there, so the two lists diverge and this test goes red — which is the
   * signal to re-derive this release's occupancy or to freeze it deliberately,
   * the way the w03 canary froze its historical 256-entry cap.
   *
   * The immutable-side assertions are kept beside it. They pin what the committed
   * record says; the live comparison pins that the record is still current.
   */
  it("pins each promoted wave's occupancy to that wave's own committed record", () => {
    const glbCount = (path: string): number =>
      readJson<{ files: { path: string }[] }>(path).files.filter((file) => /^public\/assets\/.*\.glb$/u.test(file.path)).length;
    expect(BLOCK835_MEMBERSHIP_BUILDING_IDS).toHaveLength(14);
    // THE LIVE CHECK FIRED AT T020, EXACTLY AS IT WAS WRITTEN TO. The fifth
    // promotion added an enabled record and this line went red, which was the
    // signal to decide whether to re-derive this release's occupancy or freeze
    // it. It is FROZEN, deliberately, on the precedent the w03 canary set when
    // it froze its historical 256-entry cap: this is a CANARY's immutable
    // record, it counted the four waves that were promoted when it was emitted,
    // and re-emitting it to mention a wave promoted afterwards would move the
    // checksum the successor's own predecessor pin is taken over.
    //
    // The live comparison is kept, in the only form that stays a real check on
    // frozen bytes: the four waves this record counted are still enabled and
    // still occupy what it recorded, and they are the PREFIX of the live set
    // rather than the whole of it.
    //
    // T005 MOVED WHAT "THE LIVE SET" MEANS, and the comparison follows the
    // records rather than the name. Each live record is now a serving `-s1`
    // promotion whose PREDECESSOR is the curated release this frozen inventory
    // counted, so the curated composition is read off the predecessor chain. The
    // alternative — comparing this record's four curated ids against six serving
    // ids — would have failed for a true reason and been silenced by deleting the
    // check, which is the outcome the paragraph above exists to prevent.
    const liveCurated = EXTERIOR_DEFAULT_ACTIVATIONS.flatMap((record) =>
      record.enabled && record.predecessor.enabled ? [record.predecessor.releaseId] : [],
    );
    expect(inventory.occupancy.promotedWaves.map((wave) => wave.releaseId))
      .toEqual(liveCurated.slice(0, inventory.occupancy.promotedWaveCount));
    expect(liveCurated).toHaveLength(6);
    expect(liveCurated[4]).toBe("manhattan-central-upper-manhattan-cells-20260812-p1");
    // T022 promoted a sixth wave and appended it, so the prefix comparison above
    // is what stays true of this frozen record; the length is the LIVE set's and
    // is asserted here rather than in the prefix.
    expect(liveCurated[5]).toBe("manhattan-northern-manhattan-cells-20260812-p1");
    // The curated releases are no longer what a parameterless session loads.
    // Saying so here keeps this suite from reading as if they were.
    const livePromoted = EXTERIOR_DEFAULT_ACTIVATIONS.flatMap((record) => (record.enabled ? [record.releaseId] : []));
    expect(livePromoted).toHaveLength(6);
    for (const releaseId of livePromoted) expect(liveCurated).not.toContain(releaseId);
    expect(inventory.occupancy.promotedWaveCount).toBe(4);
    expect(inventory.occupancy.promotedWaves).toHaveLength(4);
    expect(inventory.occupancy.promotedWaves).toEqual([
      { releaseId: "manhattan-exterior-cells-20260811-v3", assetEntries: BLOCK835_MEMBERSHIP_BUILDING_IDS.length * BLOCK835_SHIPPED_LOD_COUNT },
      { releaseId: "manhattan-midtown-core-cells-20260811-v3", assetEntries: glbCount("data/midtown-core-20260811-v3/payload-inventory.json") },
      { releaseId: "manhattan-lower-manhattan-cells-20260812-p1", assetEntries: glbCount("data/lower-manhattan-20260812-p1/payload-inventory.json") },
      { releaseId: "manhattan-southern-remainder-cells-20260812-p1", assetEntries: glbCount("data/southern-remainder-20260812-p1/payload-inventory.json") },
    ]);
    expect(inventory.occupancy.promotedAssetEntries).toBe(434);
    // Emitted at the T018 cap of 512, which was the LIVE constant when this
    // record was written — unlike the w03 canary, which was frozen against the
    // historical 256 and pins that number literally. T005 raised the live cap
    // again, to 1,024, so this figure joins the w03 canary's: it is the cap of
    // its own day and is pinned as a literal. The live constant is still read,
    // but for the only relation that survives a raise — the record's cap cannot
    // exceed the build's.
    expect(inventory.occupancy.maxCacheEntries).toBe(512);
    expect(EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries).toBe(1_024);
    expect(inventory.occupancy.maxCacheEntries).toBeLessThanOrEqual(EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries);
  });

  /**
   * The committed record states the promotion QUESTION rather than only the
   * budget it used, and it states both halves. A record that carried only
   * `admitsMedianCellAlongsidePromoted: true` would read as a promotion
   * clearance for this wave, which it is not: the same 78 entries are the only
   * headroom wave w05 has too.
   */
  it("records that the 78-entry headroom is shared with the other unpromoted wave", () => {
    expect(inventory.occupancy.promotedAssetEntries)
      .toBe(inventory.occupancy.promotedWaves.reduce((total, wave) => total + wave.assetEntries, 0));
    expect(inventory.occupancy.alongsidePromotedHeadroom)
      .toBe(inventory.occupancy.maxCacheEntries - inventory.occupancy.promotedAssetEntries);
    expect(inventory.occupancy.alongsidePromotedHeadroom).toBe(78);
    expect(inventory.occupancy.waveCellCount).toBe(249);
    expect(inventory.occupancy.smallestCellBuildingCount).toBe(1);
    expect(inventory.occupancy.medianCellBuildingCount).toBe(48);
    expect(inventory.occupancy.admitsMedianCellAlongsidePromoted).toBe(true);
    expect(inventory.occupancy.remainingUnpromotedWaves.map((wave) => wave.waveId))
      .toEqual(["central-upper-manhattan", "northern-manhattan"]);
    expect(inventory.occupancy.medianCellsOfAllRemainingWaves).toBe(103);
    expect(inventory.occupancy.headroomAdmitsMedianCellOfEveryRemainingWaveTogether).toBe(false);
    expect(inventory.occupancy.entryBudget).toBe(CENTRAL_UPPER_MANHATTAN_MODEST_SUBSET_CEILING);
    expect(inventory.occupancy.entryBudget).toBeLessThanOrEqual(inventory.occupancy.optInSoloCeiling);
    // The inventory note says the same thing in words, so a reader who never
    // opens this test still meets the split.
    expect(readText(`${RECORD_ROOT}/payload-inventory.json`))
      .toContain("is NOT this release's to spend");
  });

  /**
   * 78 shipped-cell buildings and a 78-entry promoted headroom are the same
   * number and NOT the same quantity, and the coincidence is pinned so nobody
   * later reads the canary as having been sized to the promotion headroom. One is
   * 25 + 51 + 2 under an 80-entry self-imposed ceiling; the other is 512 - 434.
   */
  it("keeps the shipped subset's size independent of the promoted headroom", () => {
    // The renderable cells own 78 buildings — 25 + 51 + 2, the wave's three
    // leading cells — and the promoted headroom is also 78. Both numbers are
    // asserted so the coincidence is on the record.
    expect(inventory.census.requestedBuildingCount).toBe(78);
    expect(inventory.occupancy.alongsidePromotedHeadroom).toBe(78);
    expect(inventory.renderableCellIds).toHaveLength(3);
    // And it is a coincidence rather than a derivation: what produced the subset
    // is the 80-entry self-imposed ceiling, which is not 78 and does not move
    // when the promoted set does.
    expect(inventory.occupancy.entryBudget).toBe(80);
    expect(inventory.occupancy.entryBudget).not.toBe(inventory.occupancy.alongsidePromotedHeadroom);
  });

  /**
   * This release is the first wave canary whose renderable cells are PARTIALLY
   * packaged, and that is worth pinning because it exercises the refined
   * assembly-cell coverage rule rather than the equality it replaced.
   *
   * Three of the 78 buildings the renderable cells own were refused by the
   * grammar, so the assembly packages 75 and the release declares the other 3
   * unavailable. Under the old equality rule that cell was unrepresentable; under
   * `assemblyCellCoverage` it is admitted only because the remainder is EXACTLY
   * the unavailable set. The graph stage's `replayMultiLodAssembly` gate is what
   * proves that on the emitted bytes; this asserts the committed record really
   * does describe the subset case rather than a fully packaged one.
   */
  it("exercises the strict-subset assembly-cell coverage path, not the fully packaged one", () => {
    expect(inventory.census.requestedBuildingCount).toBe(78);
    expect(inventory.census.materializedBuildingCount).toBe(75);
    expect(inventory.stats.availableBuildingCount).toBe(75);
    expect(inventory.census.materializedBuildingCount).toBeLessThan(inventory.census.requestedBuildingCount);
    // The remainder is named, never merely missing.
    expect(inventory.refusedBuildingIds).toHaveLength(3);
    expect(inventory.census.requestedBuildingCount - inventory.census.materializedBuildingCount)
      .toBe(inventory.refusedBuildingIds.length);
  });

  it("fits the entry budget it was derived from", () => {
    expect(inventory.census.materializedBuildingCount).toBeLessThanOrEqual(inventory.occupancy.entryBudget);
    expect(inventory.census.materializedBuildingCount).toBe(75);
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
