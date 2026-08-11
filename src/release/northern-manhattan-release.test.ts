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
import { CENTRAL_UPPER_MANHATTAN_APPROVAL, CENTRAL_UPPER_MANHATTAN_APPROVAL_SCOPE } from "./central-upper-manhattan-release.ts";
import { CENTRAL_UPPER_MANHATTAN_W05_RESERVED_ENTRIES } from "./central-upper-manhattan-curation.ts";
import { BLOCK835_MEMBERSHIP_BUILDING_IDS, EXTERIOR_DEFAULT_ACTIVATIONS } from "../runtime/exterior-default-activation.ts";
import { EXTERIOR_RUNTIME_BUDGETS } from "../runtime/exterior-cell-runtime.ts";
import { NORTHERN_MANHATTAN_RELEASE_ID } from "./northern-manhattan-package.ts";
import {
  NORTHERN_MANHATTAN_APPROVAL,
  NORTHERN_MANHATTAN_APPROVAL_EXCLUSIONS,
  NORTHERN_MANHATTAN_APPROVAL_NOTE,
  NORTHERN_MANHATTAN_APPROVAL_SCOPE,
  NORTHERN_MANHATTAN_CENSUS_PROFILE,
  NORTHERN_MANHATTAN_MODEST_SUBSET_CEILING,
  NORTHERN_MANHATTAN_PREDECESSOR_RELEASE_ID,
  NORTHERN_MANHATTAN_TEXTURE_ADMISSION,
  NORTHERN_MANHATTAN_WAVE_PROFILE,
  northernManhattanApprovalFingerprint,
  northernManhattanPredecessor,
  northernManhattanRenderableCells,
  northernManhattanRenderableEntryBudget,
  northernManhattanReservation,
} from "./northern-manhattan-release.ts";

/** Block 835 ships both LODs per building; every wave since ships one. */
const BLOCK835_SHIPPED_LOD_COUNT = 2;

const RECORD_ROOT = "data/northern-manhattan-20260812";

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
    isLastUnpromotedWave: boolean;
    remainingUnpromotedWaveIds: string[];
    reservation: { fromReleaseId: string; forWaveId: string; entries: number; splitResponse: number };
    headroomExceedsReservationBy: number;
    reservationStillFitsHeadroom: boolean;
    waveCellCount: number;
    smallestCellBuildingCount: number;
    medianCellBuildingCount: number;
    largestCellBuildingCount: number;
    cellsFittingAlongsidePromoted: number;
    cellsFittingReservation: number;
    admitsMedianCellAlongsidePromoted: boolean;
    admitsMedianCellWithinReservation: boolean;
    optInSoloCeiling: number;
    modestSubsetCeiling: number;
    entryBudget: number;
    entryBudgetFitsReservation: boolean;
  };
  renderableCellIds: string[];
  renderableWalk: {
    entryBudget: number;
    ownedBuildingCount: number;
    spareEntries: number;
    stoppedAt: { cellId: string; buildingCount: number; wouldHaveTotalled: number } | null;
  };
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

describe("northern-manhattan rights instrument", () => {
  /**
   * Why this wave authors a NEW instrument rather than reusing any live one. The
   * Midtown-core scope says its release is TEXTURE-FREE and excludes runtime
   * textures outright, so it cannot admit tiles. The three textured waves' scopes
   * do admit them, but each one's operative first sentence enumerates its own
   * wave's partition. None can be read onto wave w05 without saying something false
   * about what was approved.
   */
  it("cannot be satisfied by any frozen scope, and edits none of them", () => {
    expect(MIDTOWN_CORE_V3_APPROVAL_SCOPE).toContain("TEXTURE-FREE");
    expect(MIDTOWN_CORE_V3_APPROVAL_EXCLUSIONS).toContain("runtime textures of any kind, procedural or captured");
    expect(LOWER_MANHATTAN_APPROVAL_SCOPE).toContain("126 ownership cells and 6,425 canonical buildings");
    expect(SOUTHERN_REMAINDER_APPROVAL_SCOPE).toContain("176 ownership cells and 9,603 canonical buildings");
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL_SCOPE).toContain("249 ownership cells and 11,721 canonical buildings");
    expect(NORTHERN_MANHATTAN_APPROVAL_SCOPE).toContain("wave w05 (northern-manhattan)");
    expect(NORTHERN_MANHATTAN_APPROVAL_SCOPE).toContain("182 ownership cells and 10,230 canonical buildings");
    for (const other of [CENTRAL_UPPER_MANHATTAN_APPROVAL_SCOPE, SOUTHERN_REMAINDER_APPROVAL_SCOPE, LOWER_MANHATTAN_APPROVAL_SCOPE, MIDTOWN_CORE_V3_APPROVAL_SCOPE]) {
      expect(NORTHERN_MANHATTAN_APPROVAL_SCOPE).not.toBe(other);
    }
    // The instruments it was adapted from are untouched, fingerprints included.
    expect(LOWER_MANHATTAN_APPROVAL.fingerprintSha256).toBe("ff8da10f3f4cb7bcb93e58578baea652088b80b3020f0fc1ddc4e088962d120f");
    expect(SOUTHERN_REMAINDER_APPROVAL.fingerprintSha256).toBe("c4ba50b33490e619fa2662e312d796fb82db47c3561a73c65da9f8fef6054ac4");
    expect(CENTRAL_UPPER_MANHATTAN_APPROVAL.fingerprintSha256).toBe("81ba0879fbc956c912db7548ff7650a3364fd0bf1ab117a7926cf75d0714df5e");
    expect(NORTHERN_MANHATTAN_APPROVAL.id).not.toBe(CENTRAL_UPPER_MANHATTAN_APPROVAL.id);
  });

  /** It names every wave it is disjoint from, and there are now five of them. */
  it("enumerates all five promoted waves it is derived disjoint from", () => {
    expect(NORTHERN_MANHATTAN_APPROVAL_SCOPE).toContain("disjoint by derivation from the promoted Block 835, Midtown-core, Lower-Manhattan, Southern-remainder and Central-and-upper-Manhattan waves");
  });

  it("states the reference-only calibration and ingests no image data", () => {
    expect(NORTHERN_MANHATTAN_APPROVAL_SCOPE).toContain("calibrated by VIEWING public reference imagery only");
    expect(NORTHERN_MANHATTAN_APPROVAL_SCOPE).toContain("no image data was ingested, decoded, traced, sampled, or reproduced");
    expect(NORTHERN_MANHATTAN_APPROVAL_SCOPE).toContain("no pixel of any photograph is present in or derivable from the shipped bytes");
    expect(NORTHERN_MANHATTAN_APPROVAL_SCOPE).toContain("re-rasterized and required to match byte for byte");
  });

  /**
   * The tile verbs are narrower than the geometry's, and the operative text has to
   * SAY so. Nothing broadened anything to cover redistributing generated tiles, so
   * letting the tile clause inherit the geometry's verb list would assert a
   * permission nobody granted.
   */
  it("grants tiles display and conveyance only, never redistribution", () => {
    expect(NORTHERN_MANHATTAN_APPROVAL_SCOPE).toContain("FOR LOCAL APPLICATION DISPLAY AND DERIVATIVE CONVEYANCE ONLY AND EXPRESSLY NOT FOR REDISTRIBUTION");
    expect(NORTHERN_MANHATTAN_APPROVAL_EXCLUSIONS.some((entry) => entry.startsWith("redistribution of the procedural facade detail tiles"))).toBe(true);
    expect(NORTHERN_MANHATTAN_APPROVAL_SCOPE).toContain("redistribution of deterministically generated exterior geometry");
    expect(NORTHERN_MANHATTAN_APPROVAL_NOTE).toContain("no recorded item broadened anything to permit redistributing generated tiles");
  });

  /**
   * The exclusion list is BYTE-EQUAL to the predecessor's, and that is asserted in
   * both directions rather than by set membership: a canary that quietly dropped an
   * exclusion would be broadening an envelope, and one that reordered the list
   * would move a fingerprint for no reason.
   */
  it("excludes exactly what its predecessor excluded, in the same order", () => {
    expect([...NORTHERN_MANHATTAN_APPROVAL_EXCLUSIONS]).toEqual([...CENTRAL_UPPER_MANHATTAN_APPROVAL.exclusions]);
    expect([...NORTHERN_MANHATTAN_APPROVAL_EXCLUSIONS].sort()).toEqual([...SOUTHERN_REMAINDER_APPROVAL.exclusions].sort());
    expect(NORTHERN_MANHATTAN_APPROVAL_EXCLUSIONS).toContain("public internet deployment");
    expect(NORTHERN_MANHATTAN_APPROVAL_EXCLUSIONS).toContain("captured, photographic, or otherwise source-derived texture imagery of any kind");
    expect(NORTHERN_MANHATTAN_APPROVAL_EXCLUSIONS).toContain("runtime external network requests");
    expect(NORTHERN_MANHATTAN_APPROVAL_EXCLUSIONS.some((entry) => entry.includes("reproduces, resembles, or reports on a real building's facade"))).toBe(true);
  });

  /**
   * The honesty clause, carried because the situation is identical: a per-wave
   * instrument invites a reader to assume a per-wave approval event. There was none.
   */
  it("says in its own text that it rests on no fresh signature", () => {
    expect(NORTHERN_MANHATTAN_APPROVAL_NOTE).toContain("THIS INSTRUMENT RESTS ON NO FRESH SIGNATURE");
    expect(NORTHERN_MANHATTAN_APPROVAL_NOTE).toContain("No approval was sought or given for wave w05 specifically");
    expect(NORTHERN_MANHATTAN_APPROVAL_NOTE).toContain("recorded texture direction of 2026-08-11");
    expect(NORTHERN_MANHATTAN_APPROVAL_NOTE).toContain("recorded standing autonomy directive");
    expect(NORTHERN_MANHATTAN_APPROVAL_NOTE).toContain("it is not authored because new permission was obtained");
    expect(NORTHERN_MANHATTAN_APPROVAL_NOTE).toContain("Neither recorded item is a licence grant from any third party");
  });

  /**
   * THE CLAUSE THIS WAVE NEEDS AND ITS PREDECESSORS DID NOT.
   *
   * This instrument is the one that makes the ledger's whole partition covered by
   * approved releases. "The whole city is covered now" is exactly the sentence a
   * reader could mistake for a broader permission, and the specific mistake worth
   * pre-empting is the assembly one: six separately-approved waves do not add up to
   * an authorization to redistribute the city as a whole. The note refuses that
   * inference in its own words.
   */
  it("says that being the last wave, and completing the coverage, broadens nothing", () => {
    expect(NORTHERN_MANHATTAN_APPROVAL_NOTE).toContain("THAT THIS IS THE LAST WAVE BROADENS NOTHING, AND THE COMPLETED COVERAGE IT PRODUCES IS NOT A NEW PERMISSION");
    expect(NORTHERN_MANHATTAN_APPROVAL_NOTE).toContain("Covering the last buildings of the same pinned source under the same verbs is not a wider envelope");
    expect(NORTHERN_MANHATTAN_APPROVAL_NOTE).toContain("nothing in this instrument authorizes assembling the six waves into a redistributable whole that no single wave's instrument would permit");
    expect(NORTHERN_MANHATTAN_APPROVAL_NOTE).toContain("public internet deployment excluded here exactly as it is excluded in every predecessor");
  });

  /** Pinned exactly as the earlier scopes are pinned: a moved word moves the hash. */
  it("pins the approval fingerprint to its own text", () => {
    expect(NORTHERN_MANHATTAN_APPROVAL.fingerprintSha256).toBe(northernManhattanApprovalFingerprint());
    for (const other of [CENTRAL_UPPER_MANHATTAN_APPROVAL, SOUTHERN_REMAINDER_APPROVAL, LOWER_MANHATTAN_APPROVAL]) {
      expect(NORTHERN_MANHATTAN_APPROVAL.fingerprintSha256).not.toBe(other.fingerprintSha256);
    }
    // The release graph this wave emitted pins this exact digest, so the literal
    // below is what makes an edit to the text above fail here rather than in a
    // rebuild nobody runs.
    expect(NORTHERN_MANHATTAN_APPROVAL.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
  });
});

describe("northern-manhattan emission profiles", () => {
  it("ships textures at LOD 0 under the V3T budgets, never the zero-texture V3 ones", () => {
    expect(NORTHERN_MANHATTAN_WAVE_PROFILE.texture).toBe(PROCEDURAL_TEXTURE_PROFILE);
    expect(NORTHERN_MANHATTAN_WAVE_PROFILE.budgets).toEqual(V3T_QUALITY_BUDGETS);
    expect(V3_QUALITY_BUDGETS.maxTextures).toBe(0);
    expect(NORTHERN_MANHATTAN_WAVE_PROFILE.textureFilter).toEqual(PROCEDURAL_TEXTURE_SAMPLER_FILTER);
    expect(NORTHERN_MANHATTAN_WAVE_PROFILE.uncertainty).toBe(DETERMINISTIC_FACADE_V3T_UNCERTAINTY);
  });

  /**
   * The census profile is untextured but must share every field that enters a plan
   * hash, or the wave census would be a statement about different buildings than
   * the ones that ship.
   */
  it("censuses on the identical grammar it ships", () => {
    expect(NORTHERN_MANHATTAN_CENSUS_PROFILE.seed).toBe(NORTHERN_MANHATTAN_WAVE_PROFILE.seed);
    expect(NORTHERN_MANHATTAN_CENSUS_PROFILE.generatedAt).toBe(NORTHERN_MANHATTAN_WAVE_PROFILE.generatedAt);
    expect(NORTHERN_MANHATTAN_CENSUS_PROFILE.tool).toEqual(NORTHERN_MANHATTAN_WAVE_PROFILE.tool);
    expect(NORTHERN_MANHATTAN_CENSUS_PROFILE.releaseId).toBe(NORTHERN_MANHATTAN_WAVE_PROFILE.releaseId);
    expect(NORTHERN_MANHATTAN_CENSUS_PROFILE.texture).toBeNull();
  });

  it("declares the procedural-replay admission the runtime reads unchanged", () => {
    expect(NORTHERN_MANHATTAN_TEXTURE_ADMISSION.policy).toBe("procedural-replay");
    const fact = NORTHERN_MANHATTAN_TEXTURE_ADMISSION.generatedTextureFact!;
    expect(fact.basis).toBe("generated-texture");
    expect(fact.gate).toBe("rasterizer-replay");
    // Explicitly null, never absent: a generated tile cites no evidence record.
    expect(fact.evidenceBasis).toBeNull();
    expect(fact.samplerFilter).toEqual(PROCEDURAL_TEXTURE_SAMPLER_FILTER);
  });
});

describe("northern-manhattan inherited promotion reservation", () => {
  const promotedInventory = readJson<{ releaseId: string; occupancy: Record<string, unknown> }>(
    "data/central-upper-manhattan-20260812-p1/payload-inventory.json",
  );

  /**
   * The reservation is READ from the release that made it, never retyped. This
   * pins the two against each other: the module's constant and the committed record
   * have to agree, and if T020's record were ever re-emitted with a different split
   * this fails rather than letting a stale number bind T022.
   */
  it("reads T020's recorded reservation out of that release's own committed bytes", () => {
    const reservation = northernManhattanReservation(promotedInventory);
    expect(reservation.fromReleaseId).toBe(NORTHERN_MANHATTAN_PREDECESSOR_RELEASE_ID);
    expect(reservation.forWaveId).toBe("northern-manhattan");
    expect(reservation.entries).toBe(36);
    expect(reservation.entries).toBe(CENTRAL_UPPER_MANHATTAN_W05_RESERVED_ENTRIES);
    expect(reservation.splitResponse).toBe(2);
  });

  /** A reservation cannot be inherited by silence, and cannot be another wave's. */
  it("refuses a missing reservation, a foreign one, and one from the wrong release", () => {
    expect(() => northernManhattanReservation({ releaseId: "manhattan-southern-remainder-cells-20260812-p1", occupancy: {} }))
      .toThrow(/must be read from manhattan-central-upper-manhattan-cells-20260812-p1/u);
    expect(() => northernManhattanReservation({ releaseId: NORTHERN_MANHATTAN_PREDECESSOR_RELEASE_ID, occupancy: {} }))
      .toThrow(/declares no reservation; this wave's promotion budget cannot be inherited by silence/u);
    expect(() => northernManhattanReservation({
      releaseId: NORTHERN_MANHATTAN_PREDECESSOR_RELEASE_ID,
      occupancy: { reservedForNextWaveEntries: 36, reservedForNextWaveId: "some-other-wave", splitResponse: 2 },
    })).toThrow(/is for wave some-other-wave, not northern-manhattan/u);
    expect(() => northernManhattanReservation({
      releaseId: NORTHERN_MANHATTAN_PREDECESSOR_RELEASE_ID,
      occupancy: { reservedForNextWaveEntries: 0, reservedForNextWaveId: "northern-manhattan", splitResponse: 2 },
    })).toThrow(/reserves nothing/u);
  });
});

describe("northern-manhattan renderable-subset derivation", () => {
  const promotedWaves = [
    { releaseId: "manhattan-exterior-cells-20260811-v3", assetEntries: 28 },
    { releaseId: "manhattan-midtown-core-cells-20260811-v3", assetEntries: 156 },
    { releaseId: "manhattan-lower-manhattan-cells-20260812-p1", assetEntries: 71 },
    { releaseId: "manhattan-southern-remainder-cells-20260812-p1", assetEntries: 179 },
    { releaseId: "manhattan-central-upper-manhattan-cells-20260812-p1", assetEntries: 40 },
  ];
  const reservation = { fromReleaseId: "manhattan-central-upper-manhattan-cells-20260812-p1", forWaveId: "northern-manhattan", entries: 36, splitResponse: 2 };
  const base = {
    maxCacheEntries: 512,
    promotedWaves,
    modestSubsetCeiling: NORTHERN_MANHATTAN_MODEST_SUBSET_CEILING,
    cellBuildingCounts: [1, 20, 42, 55, 86, 90, 119],
    remainingUnpromotedWaveIds: ["northern-manhattan"],
    reservation,
  };

  /**
   * The arithmetic this wave exists to state, and it is a DIFFERENT statement from
   * every wave before it. Five promoted waves occupy 28 + 156 + 71 + 179 + 40 = 474
   * of the 512-entry cache, so 38 are free — while 36 were RESERVED. Both numbers
   * ship, because they are not the same fact.
   */
  it("reports the measured headroom and the recorded reservation as two different numbers", () => {
    const budget = northernManhattanRenderableEntryBudget(base);
    expect(budget.promotedWaveCount).toBe(5);
    expect(budget.promotedAssetEntries).toBe(474);
    expect(budget.alongsidePromotedHeadroom).toBe(38);
    expect(budget.reservation.entries).toBe(36);
    expect(budget.headroomExceedsReservationBy).toBe(2);
    expect(budget.reservationStillFitsHeadroom).toBe(true);
    // The opt-in ceiling is the cache itself, because `?exteriorCells=` selects the
    // named release ALONE; the applied budget is the modest ceiling.
    expect(budget.optInSoloCeiling).toBe(512);
    expect(budget.entryBudget).toBe(NORTHERN_MANHATTAN_MODEST_SUBSET_CEILING);
  });

  /**
   * THE FINDING T022 INHERITS. Neither the reservation nor the whole measured
   * headroom admits a cell of ORDINARY size for this wave: its median cell owns 55
   * against a 36-entry reservation and a 38-entry headroom. So a promoted subset
   * here has to be curated below median size, or the split has to be re-opened.
   * Both booleans are recorded because reporting only one would read as a verdict.
   */
  it("reports that neither the reservation nor the headroom admits this wave's median cell", () => {
    const budget = northernManhattanRenderableEntryBudget(base);
    expect(budget.medianCellBuildingCount).toBe(55);
    expect(budget.admitsMedianCellWithinReservation).toBe(false);
    expect(budget.admitsMedianCellAlongsidePromoted).toBe(false);
    // Over the seven synthetic cells above, only the 1- and 20-building ones fit
    // either number, and the 42-building cell fits neither — which is the shape the
    // real 182-cell wave has at 50 and 54 respectively.
    expect(budget.cellsFittingReservation).toBe(2);
    expect(budget.cellsFittingAlongsidePromoted).toBe(2);
  });

  /**
   * THE LAST-WAVE PREMISE, ENFORCED RATHER THAN ASSUMED. Every reservation sentence
   * in this release's record rests on there being no other unpromoted wave. A
   * rolled-back promotion would make that false, and the derivation says so instead
   * of quietly continuing to describe a reservation as uncontested.
   */
  it("states whether it is the last unpromoted wave, and refuses to be absent from the list", () => {
    expect(northernManhattanRenderableEntryBudget(base).isLastUnpromotedWave).toBe(true);
    const contested = northernManhattanRenderableEntryBudget({ ...base, remainingUnpromotedWaveIds: ["northern-manhattan", "some-rolled-back-wave"] });
    expect(contested.isLastUnpromotedWave).toBe(false);
    expect(contested.remainingUnpromotedWaveIds).toEqual(["northern-manhattan", "some-rolled-back-wave"]);
    expect(() => northernManhattanRenderableEntryBudget({ ...base, remainingUnpromotedWaveIds: ["central-upper-manhattan"] }))
      .toThrow(/this wave is missing from the unpromoted list/u);
    expect(() => northernManhattanRenderableEntryBudget({ ...base, remainingUnpromotedWaveIds: [] }))
      .toThrow(/no unpromoted wave was supplied/u);
  });

  /**
   * A reservation is a DECISION taken against a headroom, and a decision whose
   * subject no longer exists is not that decision. If the promoted set grew past
   * the point where 36 entries are free, honouring the reservation at a smaller
   * size would be re-cutting a split nobody re-opened.
   */
  it("refuses a reservation that no longer fits what is actually free", () => {
    expect(() => northernManhattanRenderableEntryBudget({
      ...base,
      promotedWaves: [...promotedWaves, { releaseId: "some-sixth-promotion", assetEntries: 20 }],
    })).toThrow(/no longer fits the cache it was split out of and must be re-decided rather than silently re-cut/u);
  });

  /** A ceiling no session could hold, or none at all, is refused rather than clamped. */
  it("refuses a ceiling the cache cannot hold", () => {
    expect(() => northernManhattanRenderableEntryBudget({ ...base, modestSubsetCeiling: 513 })).toThrow(/exceeds the 512-entry cache cap/u);
    expect(() => northernManhattanRenderableEntryBudget({ ...base, modestSubsetCeiling: 0 })).toThrow(/must admit at least one entry/u);
  });

  /**
   * The promoted list is the whole basis of the occupancy statement, so the ways of
   * corrupting it fail rather than quietly changing the answer.
   */
  it("refuses a promoted list that would misstate the occupied set", () => {
    expect(() => northernManhattanRenderableEntryBudget({ ...base, promotedWaves: [] })).toThrow(/no promoted wave was supplied/u);
    expect(() => northernManhattanRenderableEntryBudget({ ...base, promotedWaves: [...promotedWaves, promotedWaves[0]!] })).toThrow(/counted twice/u);
    expect(() => northernManhattanRenderableEntryBudget({ ...base, promotedWaves: [{ releaseId: "empty", assetEntries: 0 }] })).toThrow(/is not a promoted wave/u);
  });

  /**
   * THE 80-ENTRY CEILING THREE CANARIES USED ADMITS NOTHING HERE, and that is the
   * whole reason this one is 100. The walk stops at the first cell that does not
   * fit rather than skipping it, so a leading cell larger than the budget leaves
   * the subset empty and the derivation throws with the leading cell's size named.
   */
  it("admits whole cells only, in priority order, and refuses a budget the leading cell overflows", () => {
    const cells = [
      { cellId: "a", buildingIds: Array.from({ length: 86 }, (_, index) => `a${index}`) },
      { cellId: "b", buildingIds: Array.from({ length: 42 }, (_, index) => `b${index}`) },
      { cellId: "c", buildingIds: Array.from({ length: 66 }, (_, index) => `c${index}`) },
    ];
    expect(() => northernManhattanRenderableCells(cells, 80))
      .toThrow(/Wave northern-manhattan: no cell fits the 80-entry renderable budget; the first cell in priority order, a, owns 86 buildings\./u);

    const chosen = northernManhattanRenderableCells(cells, 100);
    expect(chosen.cells.map((cell) => cell.cellId)).toEqual(["a"]);
    expect(chosen.ownedBuildingCount).toBe(86);
    expect(chosen.spareEntries).toBe(14);
    // WHY it stopped, not merely that it did: at 100 entries the second cell would
    // have totalled 128.
    expect(chosen.stoppedAt).toEqual({ cellId: "b", buildingCount: 42, wouldHaveTotalled: 128 });
    // A cell is never split, and the walk never skips: at 128 both fit, and cell
    // `c` is refused rather than passed over even though 128 + 66 > 128.
    expect(northernManhattanRenderableCells(cells, 128).cells.map((cell) => cell.cellId)).toEqual(["a", "b"]);
    expect(northernManhattanRenderableCells(cells, 194).cells.map((cell) => cell.cellId)).toEqual(["a", "b", "c"]);
    // Every cell fit, so there is nothing it stopped at.
    expect(northernManhattanRenderableCells(cells, 194).stoppedAt).toBeNull();
  });
});

describe("northern-manhattan predecessor lineage", () => {
  it("refuses pins that did not come from the promoted Central-and-upper-Manhattan P1 wave", () => {
    expect(() => northernManhattanPredecessor({ releaseId: "manhattan-central-upper-manhattan-cells-20260812", files: [] })).toThrow(/pins must come from/u);
  });

  it("derives the promoted wave's root and snapshot from its committed inventory", () => {
    const committed = readJson<{ releaseId: string; roots: Record<string, { rootId: string; rootChecksumSha256: string; artifactCount: number }>; files: { path: string; byteSize: number; checksumSha256: string }[] }>(
      "data/central-upper-manhattan-20260812-p1/payload-inventory.json",
    );
    const predecessor = northernManhattanPredecessor(committed);
    expect(predecessor.releaseId).toBe(NORTHERN_MANHATTAN_PREDECESSOR_RELEASE_ID);
    expect(predecessor.publicRoot.rootChecksumSha256).toBe(committed.roots.public!.rootChecksumSha256);
    // Wave w04 owns 249 cells and every one of them ships a cell release, the
    // tombstoned ones included.
    expect(predecessor.cellReleases.size).toBe(249);
  });
});

describe("northern-manhattan committed payload inventory", () => {
  it("describes the release this module names", () => {
    expect(inventory.releaseId).toBe(NORTHERN_MANHATTAN_RELEASE_ID);
    expect(inventory.stats.cellCount).toBe(182);
    expect(inventory.stats.ownedBuildingCount).toBe(10_230);
    // Every owned cell the wave does not render ships as a truthful tombstone.
    expect(inventory.stats.renderableCellCount).toBe(1);
    expect(inventory.stats.notShippedCellCount).toBe(181);
    expect(inventory.stats.renderableCellCount + inventory.stats.notShippedCellCount).toBe(inventory.stats.cellCount);
    expect(inventory.stats.availableBuildingCount + inventory.stats.unavailableBuildingCount).toBe(inventory.stats.ownedBuildingCount);
  });

  it("pins its predecessor to the promoted Central-and-upper-Manhattan P1 release", () => {
    expect(inventory.predecessor.releaseId).toBe(NORTHERN_MANHATTAN_PREDECESSOR_RELEASE_ID);
    const committedText = readText("data/central-upper-manhattan-20260812-p1/payload-inventory.json");
    expect(inventory.predecessor.inventoryChecksumSha256).toBe(sha256HexSync(committedText));
  });

  /**
   * The texture-catalogue pin. If the rasterizer's code or its constants ever move,
   * the shipped tiles are no longer the tiles this record describes, and this fails
   * rather than the change passing silently.
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
   * function of the committed membership constant; the other four are their own
   * committed inventories' shipped GLB counts.
   *
   * THIS RECORD IS THE FIRST WHOSE PROMOTED LIST IS THE WHOLE LIVE SET, so the
   * comparison against `EXTERIOR_DEFAULT_ACTIVATIONS` is an equality rather than a
   * prefix. A sixth promotion — or a rollback — makes this go red, which is the
   * signal to re-derive this release's occupancy or freeze it deliberately, the way
   * the w03 canary froze its historical 256-entry cap and the w04 canary froze its
   * four-wave prefix.
   */
  it("pins each promoted wave's occupancy to that wave's own committed record", () => {
    const glbCount = (path: string): number =>
      readJson<{ files: { path: string }[] }>(path).files.filter((file) => /^public\/assets\/.*\.glb$/u.test(file.path)).length;
    expect(BLOCK835_MEMBERSHIP_BUILDING_IDS).toHaveLength(14);
    const liveEnabled = EXTERIOR_DEFAULT_ACTIVATIONS.filter((record) => record.enabled).map((record) => record.releaseId);
    expect(inventory.occupancy.promotedWaves.map((wave) => wave.releaseId)).toEqual(liveEnabled);
    expect(inventory.occupancy.promotedWaveCount).toBe(5);
    expect(inventory.occupancy.promotedWaves).toEqual([
      { releaseId: "manhattan-exterior-cells-20260811-v3", assetEntries: BLOCK835_MEMBERSHIP_BUILDING_IDS.length * BLOCK835_SHIPPED_LOD_COUNT },
      { releaseId: "manhattan-midtown-core-cells-20260811-v3", assetEntries: glbCount("data/midtown-core-20260811-v3/payload-inventory.json") },
      { releaseId: "manhattan-lower-manhattan-cells-20260812-p1", assetEntries: glbCount("data/lower-manhattan-20260812-p1/payload-inventory.json") },
      { releaseId: "manhattan-southern-remainder-cells-20260812-p1", assetEntries: glbCount("data/southern-remainder-20260812-p1/payload-inventory.json") },
      { releaseId: "manhattan-central-upper-manhattan-cells-20260812-p1", assetEntries: glbCount("data/central-upper-manhattan-20260812-p1/payload-inventory.json") },
    ]);
    expect(inventory.occupancy.promotedAssetEntries).toBe(474);
    // Emitted at the LIVE cap, unchanged by this release.
    expect(inventory.occupancy.maxCacheEntries).toBe(512);
    expect(inventory.occupancy.maxCacheEntries).toBe(EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries);
  });

  /**
   * THE RESERVATION, AND THE TWO WAYS IT COULD BE MISREAD.
   *
   * Misreading one: that the 38 free entries are what T022 may spend. They are not;
   * 36 were reserved and the extra 2 are what wave w04's promotion happened not to
   * spend of its own 42-entry share.
   *
   * Misreading two: that a reservation which fits the headroom means the wave can
   * be promoted at ordinary scale. It does not; the median cell owns 55.
   */
  it("records the reservation, the surplus, and what neither of them admits", () => {
    expect(inventory.occupancy.reservation).toEqual({
      fromReleaseId: NORTHERN_MANHATTAN_PREDECESSOR_RELEASE_ID,
      forWaveId: "northern-manhattan",
      entries: 36,
      splitResponse: 2,
    });
    expect(inventory.occupancy.alongsidePromotedHeadroom)
      .toBe(inventory.occupancy.maxCacheEntries - inventory.occupancy.promotedAssetEntries);
    expect(inventory.occupancy.alongsidePromotedHeadroom).toBe(38);
    expect(inventory.occupancy.headroomExceedsReservationBy).toBe(2);
    expect(inventory.occupancy.reservationStillFitsHeadroom).toBe(true);
    expect(inventory.occupancy.isLastUnpromotedWave).toBe(true);
    expect(inventory.occupancy.remainingUnpromotedWaveIds).toEqual(["northern-manhattan"]);
    expect(inventory.occupancy.waveCellCount).toBe(182);
    expect(inventory.occupancy.smallestCellBuildingCount).toBe(1);
    expect(inventory.occupancy.medianCellBuildingCount).toBe(55);
    expect(inventory.occupancy.largestCellBuildingCount).toBe(119);
    expect(inventory.occupancy.admitsMedianCellWithinReservation).toBe(false);
    expect(inventory.occupancy.admitsMedianCellAlongsidePromoted).toBe(false);
    expect(inventory.occupancy.cellsFittingReservation).toBe(50);
    expect(inventory.occupancy.cellsFittingAlongsidePromoted).toBe(54);
    // The inventory note says the same things in words, so a reader who never opens
    // this test still meets them.
    const text = readText(`${RECORD_ROOT}/payload-inventory.json`);
    expect(text).toContain("TWO NUMBERS ARE RECORDED BECAUSE THEY DIFFER");
    expect(text).toContain("THE RESERVATION DOES NOT ADMIT AN ORDINARY CELL OF THIS WAVE");
    expect(text).toContain("bound by the 36 it was promised rather than by the 38 that happen to be free");
  });

  /**
   * THE CANARY'S OWN BUDGET IS BIGGER THAN THE RESERVATION, DELIBERATELY, AND THE
   * RECORD SAYS SO.
   *
   * An opt-in session loads this release ALONE, so it is budgeted against the cache
   * rather than against a promoted composition. That makes the canary's 100-entry
   * ceiling and T022's 36-entry reservation incomparable quantities, and recording
   * `entryBudgetFitsReservation: false` is what stops the canary's size from being
   * read as a promotion rehearsal.
   */
  it("keeps the canary's ceiling separate from the promotion reservation", () => {
    expect(inventory.occupancy.entryBudget).toBe(100);
    expect(inventory.occupancy.modestSubsetCeiling).toBe(NORTHERN_MANHATTAN_MODEST_SUBSET_CEILING);
    expect(inventory.occupancy.optInSoloCeiling).toBe(512);
    expect(inventory.occupancy.entryBudgetFitsReservation).toBe(false);
    expect(inventory.occupancy.entryBudget).toBeGreaterThan(inventory.occupancy.reservation.entries);
    expect(readText(`${RECORD_ROOT}/payload-inventory.json`)).toContain("IS NOT A PROMOTION REHEARSAL");
  });

  /**
   * WHY THE WALK STOPPED, pinned rather than left to be inferred from a one-cell
   * list. The subset is one cell because the wave's leading cell owns 86 and the
   * second owns 42, which would total 128 — not because the wave ran out of cells,
   * and not because anything was curated.
   */
  it("records that the budget stopped the walk rather than the wave running out", () => {
    expect(inventory.renderableCellIds).toEqual(["manhattan-exterior-cell-w05-000701-15-9651-8954"]);
    expect(inventory.renderableWalk.entryBudget).toBe(100);
    expect(inventory.renderableWalk.ownedBuildingCount).toBe(86);
    expect(inventory.renderableWalk.spareEntries).toBe(14);
    expect(inventory.renderableWalk.stoppedAt).toEqual({
      cellId: "manhattan-exterior-cell-w05-000702-16-19302-17910",
      buildingCount: 42,
      wouldHaveTotalled: 128,
    });
    expect(inventory.renderableWalk.stoppedAt!.wouldHaveTotalled).toBeGreaterThan(inventory.renderableWalk.entryBudget);
  });

  /**
   * The strict-subset assembly-cell coverage path, exercised again and by a wider
   * margin than the w04 canary exercised it: 10 of the 86 buildings the single
   * renderable cell owns were refused, so the assembly packages 76 and the release
   * declares the other 10 unavailable. Under the old equality rule that cell was
   * unrepresentable; under `assemblyCellCoverage` it is admitted only because the
   * remainder is EXACTLY the unavailable set.
   */
  it("exercises the strict-subset assembly-cell coverage path, not the fully packaged one", () => {
    expect(inventory.census.requestedBuildingCount).toBe(86);
    expect(inventory.census.materializedBuildingCount).toBe(76);
    expect(inventory.stats.availableBuildingCount).toBe(76);
    expect(inventory.census.materializedBuildingCount).toBeLessThan(inventory.census.requestedBuildingCount);
    // The remainder is named, never merely missing.
    expect(inventory.refusedBuildingIds).toHaveLength(10);
    expect(inventory.census.requestedBuildingCount - inventory.census.materializedBuildingCount)
      .toBe(inventory.refusedBuildingIds.length);
  });

  it("fits the entry budget it was derived from", () => {
    expect(inventory.census.materializedBuildingCount).toBeLessThanOrEqual(inventory.occupancy.entryBudget);
    expect(inventory.census.materializedBuildingCount).toBe(76);
    expect(inventory.renderableCellIds).toEqual(inventory.renderableCellIds.slice().sort());
  });

  /**
   * Never skipped when the payload is absent. The inventory is COMMITTED, so its
   * internal consistency is checkable on a fresh clone, and a rebuild that moved a
   * byte has to move this file to stay green.
   */
  it("is internally consistent and carries no private-audience path", () => {
    expect(inventory.files).toHaveLength(inventory.totals.fileCount);
    expect(inventory.files.reduce((total, file) => total + file.byteSize, 0)).toBe(inventory.totals.byteSize);
    expect(inventory.files.every((file) => /^[0-9a-f]{64}$/u.test(file.checksumSha256))).toBe(true);
    expect(inventory.files.every((file) => file.path.startsWith("public/") || !file.path.includes("private"))).toBe(true);
    expect(new Set(inventory.files.map((file) => file.path)).size).toBe(inventory.files.length);
    expect(inventory.files.map((file) => file.path)).toEqual(inventory.files.map((file) => file.path).slice().sort());
    // The private root is DECLARED and its bytes are not in the browser-reachable
    // payload, which is the anti-leak invariant every wave carries.
    expect(inventory.roots.private!.artifactCount).toBeGreaterThan(0);
    expect(inventory.files.some((file) => file.path === "release-graph.json")).toBe(true);
  });
});
