/**
 * Identity, rights instrument and emission profile of the
 * Central-and-upper-Manhattan exterior canary release
 * `manhattan-central-upper-manhattan-cells-20260812`.
 *
 * The FOURTH wave to be materialized, the third to carry procedural facade
 * detail tiles, and the LARGEST partition any of them has covered: 249 ownership
 * cells and 11,721 canonical buildings. Everything else about it is the accepted
 * wave shape: a derived subset of the committed wave ledger, the
 * footprint-faithful V3 grammar, a bounded renderable subset, truthful tombstones
 * for every other owned cell, and a private root plus a public-audience candidate
 * root emitted by the shared wave emitter.
 *
 * It is a CANARY, not a promotion. Nothing here adds the release to the promoted
 * default; opting into it takes an explicit `?exteriorCells=` deep link against a
 * build that pins the id. Promotion is a separate decision with its own evidence,
 * and for this wave that decision cannot be taken alone — see
 * `centralUpperManhattanRenderableEntryBudget`.
 */

import { sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";
import type { ExteriorApprovalEvidence } from "../domain/exterior-contract.ts";
import type { ExteriorTextureAdmission } from "./exterior-release.ts";
import { V3T_QUALITY_BUDGETS, V3_QUALITY_BUDGETS } from "./block835-v3-package.ts";
import {
  PROCEDURAL_TEXTURE_PROFILE,
  PROCEDURAL_TEXTURE_SAMPLER_FILTER,
} from "./procedural-texture.ts";
import { DETERMINISTIC_FACADE_V3T_UNCERTAINTY, DETERMINISTIC_FACADE_V3_UNCERTAINTY } from "../domain/deterministic-facade-generator-v3.ts";
import {
  midtownCoreCellReleaseId,
  midtownCoreReleaseIds,
  type MidtownCoreReleasePredecessor,
  type MidtownCoreReleaseProfile,
} from "./midtown-core-release.ts";
import {
  V3_FROZEN_WAVE_ADMISSION_ENVELOPE,
  midtownCoreV3EvidenceShardId,
  midtownCoreV3InventoryId,
  type V3WaveProfile,
} from "./midtown-core-v3-materialization.ts";
import { CENTRAL_UPPER_MANHATTAN_RELEASE_ID } from "./central-upper-manhattan-package.ts";

export const CENTRAL_UPPER_MANHATTAN_APPROVAL_SLUG = "central-upper-manhattan-textured-canary" as const;
export const CENTRAL_UPPER_MANHATTAN_IDS = midtownCoreReleaseIds(CENTRAL_UPPER_MANHATTAN_RELEASE_ID, CENTRAL_UPPER_MANHATTAN_APPROVAL_SLUG);
export const CENTRAL_UPPER_MANHATTAN_OUTPUT_DIRECTORY = CENTRAL_UPPER_MANHATTAN_IDS.outputDirectory;

export const CENTRAL_UPPER_MANHATTAN_GENERATED_AT = "2026-08-12T00:00:00.000Z" as const;
export const CENTRAL_UPPER_MANHATTAN_APPROVED_AT = "2026-08-12T00:00:00.000Z" as const;
export const CENTRAL_UPPER_MANHATTAN_SEED = "manhattan-central-upper-manhattan-20260812" as const;
export const CENTRAL_UPPER_MANHATTAN_TOOL = { id: "urban-digital-twin:central-upper-manhattan-materialization", version: "1.0.0" } as const;

/** The most recently promoted wave this canary composes over in the wave sequence. */
export const CENTRAL_UPPER_MANHATTAN_PREDECESSOR_RELEASE_ID = "manhattan-southern-remainder-cells-20260812-p1" as const;

// ---------------------------------------------------------------------------
// Rights instrument
//
// A NEW approval scope, authored for this wave, on exactly the terms the
// Southern-remainder instrument was authored on. No frozen approval text is
// edited and no earlier instrument is borrowed: the Block 835 and Midtown-core
// scopes exclude "runtime textures of any kind", which stays true of those
// releases; the Lower-Manhattan instrument names wave w02's 126 cells and 6,425
// buildings in its operative first sentence, and the Southern-remainder one names
// wave w03's 176 cells and 9,603 buildings in its own. An instrument that
// enumerates another wave's partition cannot be made to describe this one by
// reading it generously, so this wave authors its own and pins it by fingerprint.
// ---------------------------------------------------------------------------

/**
 * What this release is authorized to be.
 *
 * The texture clause is carried over from the Southern-remainder instrument
 * deliberately unchanged in substance, because the facts it states are facts
 * about the SHARED procedural-texture-v1 catalogue rather than about any one
 * wave:
 *
 * - the tiles are PROCEDURALLY GENERATED in this repository, a pure function of
 *   named constants, and the release validator re-rasterizes the catalogue and
 *   demands byte equality with every embedded PNG, so an ingested image cannot
 *   survive the gate even in principle;
 * - the motif dimensions were CALIBRATED BY VIEWING public reference imagery and
 *   nothing else. No image was ingested, decoded, traced, sampled, or
 *   reproduced, and no pixel of any photograph is present in or derivable from
 *   the shipped bytes;
 * - the tile verbs are NARROWER than the geometry's, and the operative text says
 *   so rather than letting them inherit. Geometry may be delivered locally,
 *   displayed, conveyed as a derivative AND redistributed, because an in-session
 *   authorization broadened the NYC OTI envelope to permit that. No authorization
 *   broadened anything to cover redistributing tiles, so tiles get local
 *   application display and derivative conveyance ONLY, and redistribution of
 *   the tiles is excluded outright. This instrument broadens nothing about the
 *   NYC OTI source data.
 *
 * It deliberately does NOT claim that any tile resembles, reproduces or reports
 * on any real building's facade, and it does not authorize public internet
 * deployment.
 */
export const CENTRAL_UPPER_MANHATTAN_APPROVAL_SCOPE =
  "Public-audience candidate exterior-cell canary release manhattan-central-upper-manhattan-cells-20260812, materializing wave w04 (central-upper-manhattan) of the provider-neutral Manhattan exterior configuration. It owns 249 ownership cells and 11,721 canonical buildings of the pinned manhattan-citywide-20260804 base, disjoint by derivation from the promoted Block 835, Midtown-core, Lower-Manhattan and Southern-remainder waves. It covers local-only delivery, local application display, derivative conveyance, and redistribution of deterministically generated exterior geometry derived from NYC OTI Building Footprints (jh45-qr5r), with NYC OTI attribution, the City modified-data disclaimer, source IDs, capture timestamps, checksums, CRS, and height uncertainty retained. It ADDITIONALLY covers, FOR LOCAL APPLICATION DISPLAY AND DERIVATIVE CONVEYANCE ONLY AND EXPRESSLY NOT FOR REDISTRIBUTION, procedurally generated, replay-gated, designed facade detail tiles carried on that generated geometry at level of detail 0: every tile is a pure function of named constants in this repository, is re-rasterized and required to match byte for byte by the release validator, carries luminance modulation only and no colour, and cites no evidence record. The tile dimensions were calibrated by VIEWING public reference imagery only; no image data was ingested, decoded, traced, sampled, or reproduced, and no pixel of any photograph is present in or derivable from the shipped bytes. Exterior geometry is materialized for a bounded subset of the owned cells; every other owned building, and every building this grammar refused, ships as an explicit unavailable detail with a stated reason." as const;

/**
 * Everything this approval deliberately does not authorize.
 *
 * The list is the Southern-remainder set, carried because every entry is still
 * true of this release, plus nothing: a canary that added a permission its
 * predecessor wave did not have would be broadening an envelope, which no
 * recorded item authorizes.
 */
export const CENTRAL_UPPER_MANHATTAN_APPROVAL_EXCLUSIONS: readonly string[] = [
  "public internet deployment",
  "redistribution of the raw jh45-qr5r source dataset",
  "runtime external network requests",
  "private-audience bytes in any browser-reachable root",
  "exterior geometry for owned buildings this release marks unavailable",
  "real-world facade, tenant, brand, signage, or survey-grade accuracy claims",
  "captured, photographic, or otherwise source-derived texture imagery of any kind",
  "redistribution of the procedural facade detail tiles, or of any package carrying them, whether or not the underlying geometry is separately redistributable",
  "any claim that a designed detail tile reproduces, resembles, or reports on a real building's facade, material, colour, age, or condition",
];

/**
 * The evidence behind this instrument, stated in full — including what it is
 * NOT.
 *
 * There is NO fresh signature for this wave. Nobody was asked to approve wave
 * w04 specifically and nobody did. The authority is exactly the two recorded
 * items the Lower-Manhattan and Southern-remainder instruments named — the user's
 * texture direction of 2026-08-11 and the recorded standing autonomy directive —
 * applied to a further wave of the same configuration under that same directive.
 * The note says so in those words rather than letting a reader infer a per-wave
 * approval event from the existence of a per-wave instrument. A new instrument
 * was authored because the operative text enumerates a partition, not because new
 * permission was obtained.
 */
export const CENTRAL_UPPER_MANHATTAN_APPROVAL_NOTE =
  "In-session user authorization dated 2026-08-11 broadened the NYC OTI Building Footprints (jh45-qr5r) envelope so exterior geometry generated from those footprints may be publicly displayed, conveyed as a derivative, and redistributed, provided NYC OTI attribution, the City modified-data disclaimer, source IDs, capture timestamp, checksum, CRS, and height uncertainty travel with it. That broadened envelope covers generated geometry only, never the raw jh45-qr5r source dataset, and public internet deployment remains excluded; this release adds no source and stays inside it. THIS INSTRUMENT RESTS ON NO FRESH SIGNATURE. No approval was sought or given for wave w04 specifically. Its authority is exactly the two recorded items the Lower-Manhattan and Southern-remainder waves' instruments named and no others: the user's recorded texture direction of 2026-08-11, which directed that facade appearance be calibrated by REFERENCE ONLY with no image data ingested, and the recorded standing autonomy directive under which these waves are executed. A separate instrument is authored for this wave because the operative text enumerates a specific partition — 249 cells and 11,721 buildings, the largest of the six waves — and an instrument that enumerates another wave's partition cannot describe this one; it is not authored because new permission was obtained, and it grants no verb, no source and no envelope that the 2026-08-11 authorization did not already carry. THAT THIS IS THE LARGEST WAVE BROADENS NOTHING: an envelope is a set of verbs over a set of sources, and covering more buildings of the same pinned source under the same verbs is not a wider envelope. Neither recorded item is a licence grant from any third party and neither is represented as one. The tiles admitted here are the procedural-texture-v1 catalogue: four grayscale motifs at 128 by 128 pixels, generated from named constants in this repository, embedded only at level of detail 0, and gated by a rasterizer replay that recomputes the catalogue and requires byte equality with every embedded image. A tile derived from a photograph is unreproducible by that gate by definition and therefore cannot ship. The tile verbs are deliberately narrower than the geometry's: the 2026-08-11 authorization broadened the geometry envelope to permit redistribution, and no recorded item broadened anything to permit redistributing generated tiles, so this instrument authorizes tiles for local application display and derivative conveyance only and excludes their redistribution outright. Colour is never carried by a tile; it stays in the per-material factor the grammar already designs. Buildings whose sourced polygon this grammar cannot carry are refused with a stated deterministic reason and ship as unavailable rather than being given invented geometry." as const;

/** `sha256HexSync(stableSerialize({ scope, exclusions, approvedAt, approvalNote }))`. */
export function centralUpperManhattanApprovalFingerprint(): string {
  return sha256HexSync(stableSerialize({
    scope: CENTRAL_UPPER_MANHATTAN_APPROVAL_SCOPE,
    exclusions: [...CENTRAL_UPPER_MANHATTAN_APPROVAL_EXCLUSIONS],
    approvedAt: CENTRAL_UPPER_MANHATTAN_APPROVED_AT,
    approvalNote: CENTRAL_UPPER_MANHATTAN_APPROVAL_NOTE,
  }));
}

export const CENTRAL_UPPER_MANHATTAN_APPROVAL: ExteriorApprovalEvidence = {
  id: CENTRAL_UPPER_MANHATTAN_IDS.approvalId,
  fingerprintSha256: centralUpperManhattanApprovalFingerprint(),
  scope: CENTRAL_UPPER_MANHATTAN_APPROVAL_SCOPE,
  exclusions: [...CENTRAL_UPPER_MANHATTAN_APPROVAL_EXCLUSIONS],
  approvedAt: CENTRAL_UPPER_MANHATTAN_APPROVED_AT,
};

/**
 * The release-level texture admission carried onto the emitted roots.
 *
 * `procedural-replay` plus the decided sampler filter, identical in substance to
 * the Southern-remainder wave's because it describes the same catalogue. The
 * runtime reads this field identically for an opt-in load and for a promoted one,
 * so admitting the tiles needs no runtime change at all.
 */
export const CENTRAL_UPPER_MANHATTAN_TEXTURE_ADMISSION: ExteriorTextureAdmission = {
  policy: "procedural-replay",
  generatedTextureFact: {
    basis: "generated-texture",
    profile: PROCEDURAL_TEXTURE_PROFILE,
    gate: "rasterizer-replay",
    evidenceBasis: null,
    samplerFilter: { ...PROCEDURAL_TEXTURE_SAMPLER_FILTER },
    statement: "Facade detail tiles in this release are four grayscale, pattern-only motifs generated from named constants in this repository and embedded at level of detail 0 only. They carry luminance modulation and no colour, cite no evidence record, and reproduce no photograph: the release validator re-rasterizes the catalogue and requires byte equality with every embedded image, so a tile derived from an image cannot pass. No tile asserts the material, colour, age, or condition of any real building.",
  },
};

/** Stated reason for a building the V3 grammar refused. */
export function centralUpperManhattanRefusalReason(code: string, detail: string): string {
  return `Refused by the footprint-faithful V3 exterior grammar [${code}]: ${detail}. No geometry was invented for this building, and no substitute representation was selected; base massing from the pinned citywide release is what remains on screen.`;
}

// ---------------------------------------------------------------------------
// Emission profiles
// ---------------------------------------------------------------------------

const WAVE_PROFILE_BASE = {
  releaseId: CENTRAL_UPPER_MANHATTAN_RELEASE_ID,
  generatedAt: CENTRAL_UPPER_MANHATTAN_GENERATED_AT,
  seed: CENTRAL_UPPER_MANHATTAN_SEED,
  tool: { ...CENTRAL_UPPER_MANHATTAN_TOOL },
} as const;

/**
 * The SHIPPED profile: textured, at level of detail 0 only.
 *
 * `V3T_QUALITY_BUDGETS` rather than `V3_QUALITY_BUDGETS`, because the latter
 * declares `maxTextures: 0` — an accurate statement about a texture-free package
 * that is byte-frozen into committed manifests and is never edited.
 */
export const CENTRAL_UPPER_MANHATTAN_WAVE_PROFILE: V3WaveProfile = {
  ...WAVE_PROFILE_BASE,
  uncertainty: DETERMINISTIC_FACADE_V3T_UNCERTAINTY,
  budgets: { ...V3T_QUALITY_BUDGETS },
  texture: PROCEDURAL_TEXTURE_PROFILE,
  textureFilter: { ...PROCEDURAL_TEXTURE_SAMPLER_FILTER },
  admissionEnvelope: V3_FROZEN_WAVE_ADMISSION_ENVELOPE,
};

/**
 * The CENSUS profile: identical grammar, no tiles.
 *
 * The wave census runs over all 11,721 owned buildings to state which sourced
 * polygons this grammar can carry. That is a question about GEOMETRY, and tiles
 * are a writer-stage concern that touches no plan field — the seed, tool and
 * generated instant are shared with the shipped profile, so every plan hash is
 * identical between the two passes and the census is a true statement about the
 * buildings that ship. Rasterizing tiles for eleven thousand buildings whose
 * bytes are then discarded would buy nothing but hours.
 */
export const CENTRAL_UPPER_MANHATTAN_CENSUS_PROFILE: V3WaveProfile = {
  ...WAVE_PROFILE_BASE,
  uncertainty: DETERMINISTIC_FACADE_V3_UNCERTAINTY,
  budgets: { ...V3_QUALITY_BUDGETS },
  texture: null,
  admissionEnvelope: V3_FROZEN_WAVE_ADMISSION_ENVELOPE,
};

// ---------------------------------------------------------------------------
// Predecessor lineage, derived from the promoted wave's committed inventory
// ---------------------------------------------------------------------------

/** The shape this module needs out of a wave's `payload-inventory.json`. */
export interface CentralUpperManhattanPredecessorInventory {
  releaseId: string;
  roots?: Record<string, { rootId: string; rootChecksumSha256: string; artifactCount: number }>;
  files: { path: string; byteSize: number; checksumSha256: string }[];
}

const PREDECESSOR_CELL_RELEASE_PREFIX = `public/cell-release/cell-release-${CENTRAL_UPPER_MANHATTAN_PREDECESSOR_RELEASE_ID}-`;
const PREDECESSOR_SNAPSHOT_PATH = `public/rollout-snapshot/snapshot-${CENTRAL_UPPER_MANHATTAN_PREDECESSOR_RELEASE_ID}-v1.json`;

function fail(message: string): never { throw new Error(`Central-upper-Manhattan predecessor: ${message}`); }

/**
 * Derives this canary's wave-sequence lineage from the PROMOTED Southern-remainder
 * P1 successor's own COMMITTED inventory, never from hand-typed constants and
 * never from the untracked payload directory.
 *
 * The predecessor is the P1 SUCCESSOR rather than the T017 canary, because the
 * wave sequence this release composes over is the promoted one: that canary was
 * never promoted, so a release that pinned it would claim to follow bytes no
 * ordinary session loads.
 */
export function centralUpperManhattanPredecessor(inventory: CentralUpperManhattanPredecessorInventory): MidtownCoreReleasePredecessor {
  if (inventory.releaseId !== CENTRAL_UPPER_MANHATTAN_PREDECESSOR_RELEASE_ID) {
    fail(`pins must come from ${CENTRAL_UPPER_MANHATTAN_PREDECESSOR_RELEASE_ID}, not ${inventory.releaseId}.`);
  }
  const publicRoot = inventory.roots?.public;
  if (!publicRoot) fail("the committed inventory declares no public root.");
  const snapshotFile = inventory.files.find((file) => file.path === PREDECESSOR_SNAPSHOT_PATH);
  if (!snapshotFile) fail(`the committed inventory declares no ${PREDECESSOR_SNAPSHOT_PATH}.`);
  const cellReleases = new Map<string, { cellReleaseId: string; checksumSha256: string }>();
  for (const file of inventory.files) {
    if (!file.path.startsWith(PREDECESSOR_CELL_RELEASE_PREFIX)) continue;
    const stem = file.path.slice(PREDECESSOR_CELL_RELEASE_PREFIX.length, -".json".length);
    const match = /^(.*)-(v\d+)$/.exec(stem);
    if (!match) fail(`unrecognised cell-release artifact name ${file.path}.`);
    cellReleases.set(match[1]!, {
      cellReleaseId: `cell-release:${CENTRAL_UPPER_MANHATTAN_PREDECESSOR_RELEASE_ID}:${match[1]!}:${match[2]!}`,
      checksumSha256: file.checksumSha256,
    });
  }
  if (cellReleases.size === 0) fail("the committed inventory declares no cell releases.");
  return {
    releaseId: CENTRAL_UPPER_MANHATTAN_PREDECESSOR_RELEASE_ID,
    publicRoot: { rootId: publicRoot.rootId, rootChecksumSha256: publicRoot.rootChecksumSha256 },
    snapshot: { snapshotId: `snapshot:${CENTRAL_UPPER_MANHATTAN_PREDECESSOR_RELEASE_ID}:v1`, checksumSha256: snapshotFile.checksumSha256 },
    cellReleases,
  };
}

// ---------------------------------------------------------------------------
// The renderable-subset entry budget
// ---------------------------------------------------------------------------

/** One promoted wave's occupancy, named so a fifth promotion cannot be forgotten. */
export interface CentralUpperManhattanPromotedWaveEntries {
  releaseId: string;
  assetEntries: number;
}

/** Every quantity the entry budget is derived from, and the ones it refuses to hide. */
export interface CentralUpperManhattanEntryBudget {
  maxCacheEntries: number;
  /**
   * The promoted waves, ENUMERATED rather than summed into named scalar fields.
   *
   * The three earlier waves' budget records carried one field per promoted wave
   * (`block835AssetEntries`, `midtownAssetEntries`, ...), which had to grow by a
   * field and a parameter at every promotion. A list is the same statement, is
   * still fully named — each row carries the release id it was counted from — and
   * cannot silently omit a wave, because the count of rows is committed beside
   * the sum.
   */
  promotedWaves: CentralUpperManhattanPromotedWaveEntries[];
  promotedWaveCount: number;
  promotedAssetEntries: number;
  /** `maxCacheEntries - promotedAssetEntries`: what a PROMOTED subset could occupy today. */
  alongsidePromotedHeadroom: number;
  /** How many of the wave's 249 cells fit whole in that headroom. */
  cellsFittingAlongsidePromoted: number;
  waveCellCount: number;
  smallestCellBuildingCount: number;
  /** Upper of the two middle values for an even cell count. */
  medianCellBuildingCount: number;
  /** Whether the headroom admits a cell of ORDINARY size for THIS wave. */
  admitsMedianCellAlongsidePromoted: boolean;
  /**
   * The headroom is not this wave's to spend, and the record says so.
   *
   * Two waves remain unpromoted — this one and `northern-manhattan` — and both
   * would have to fit inside the SAME headroom. So the record carries each
   * remaining wave's median cell size and both derived answers: whether the
   * headroom admits one median cell, and whether it admits one from each. The
   * second is the question a promotion has to answer and this release does not.
   */
  remainingUnpromotedWaves: { waveId: string; cellCount: number; medianCellBuildingCount: number }[];
  medianCellsOfAllRemainingWaves: number;
  headroomAdmitsMedianCellOfEveryRemainingWaveTogether: boolean;
  /** What an OPT-IN-ONLY session may occupy: the whole cache, because it loads alone. */
  optInSoloCeiling: number;
  /** The deliberate self-imposed ceiling that keeps a canary a canary. */
  modestSubsetCeiling: number;
  /** The budget actually applied: the smaller of the two ceilings. */
  entryBudget: number;
}

/**
 * The renderable-subset entry budget for an OPT-IN-ONLY canary.
 *
 * WHAT CHANGED SINCE THE PREVIOUS WAVE, AND WHAT DID NOT. Wave w03's canary had
 * to report that the promoted set occupied 255 of 256 cache entries, so no subset
 * anyone would promote could fit beside it. T018 cleared that by taking ADR 0034's
 * admissible response 1 — `maxCacheEntries` is 512 — and then promoted wave w03's
 * curated successor into it. Four waves are promoted now:
 *
 *     512 - 28 (Block 835) - 156 (Midtown-core) - 71 (Lower-Manhattan P1)
 *         - 179 (Southern-remainder P1) = 78 entries
 *
 * 78 is a real headroom rather than a technicality, and this wave's median cell
 * owns 48 buildings, so `admitsMedianCellAlongsidePromoted` is TRUE here where it
 * was false for w03. That is the honest reading and it is deliberately not the end
 * of the statement, because 78 IS NOT THIS WAVE'S TO SPEND. Two waves remain
 * unpromoted — w04 and w05 — and their median cells are 48 and 55, which sum to
 * 103. The single headroom admits either wave's median cell and NOT one from each.
 *
 * So the promotion decision this canary informs is a SPLIT decision, not a
 * fit-check, and this release NAMES it rather than making it: whether T020 takes
 * the headroom for w04 and leaves T022 nothing, whether the two share it at
 * sub-median scale, or whether the cap moves again. All three are admissible and
 * none is chosen here, because choosing would be deciding a promotion inside a
 * canary, with none of promotion's evidence.
 *
 * None of that binds the CANARY, and the difference is a browser fact:
 * `?exteriorCells=` SELECTS the named release and only it, so an opt-in session
 * holds this release's assets and nothing else. The binding ceiling for an opt-in
 * canary is therefore the cache itself, and a second, deliberately chosen ceiling
 * applies on top of it — `modestSubsetCeiling`, a judgement recorded as one.
 *
 * `EXTERIOR_RUNTIME_BUDGETS` is NOT changed by this release.
 */
export function centralUpperManhattanRenderableEntryBudget(input: {
  maxCacheEntries: number;
  /** Every promoted wave, counted from its own committed record. */
  promotedWaves: readonly CentralUpperManhattanPromotedWaveEntries[];
  modestSubsetCeiling: number;
  /**
   * Every cell's building count, so what the headroom admits is MEASURED across
   * the whole wave rather than asserted from one summary statistic.
   */
  cellBuildingCounts: readonly number[];
  /**
   * Every wave that is still unpromoted, THIS ONE INCLUDED, with its own cell
   * building counts. The headroom question is about all of them at once.
   */
  remainingUnpromotedWaves: readonly { waveId: string; cellBuildingCounts: readonly number[] }[];
}): CentralUpperManhattanEntryBudget {
  if (input.promotedWaves.length === 0) fail("no promoted wave was supplied; the occupancy statement would understate the promoted set.");
  for (const wave of input.promotedWaves) {
    if (wave.assetEntries <= 0) fail(`promoted wave ${wave.releaseId} declares ${wave.assetEntries} asset entries; a promoted wave that ships nothing is not a promoted wave.`);
  }
  if (new Set(input.promotedWaves.map((wave) => wave.releaseId)).size !== input.promotedWaves.length) {
    fail("a promoted release was counted twice; the occupancy statement would overstate the promoted set.");
  }
  const promotedAssetEntries = input.promotedWaves.reduce((total, wave) => total + wave.assetEntries, 0);
  const alongsidePromotedHeadroom = input.maxCacheEntries - promotedAssetEntries;
  if (input.modestSubsetCeiling <= 0) fail(`the modest subset ceiling must admit at least one entry, not ${input.modestSubsetCeiling}.`);
  if (input.modestSubsetCeiling > input.maxCacheEntries) {
    fail(`the modest subset ceiling ${input.modestSubsetCeiling} exceeds the ${input.maxCacheEntries}-entry cache cap; an opt-in session cannot hold it.`);
  }
  if (input.cellBuildingCounts.length === 0) fail("the wave declares no cells; what the promoted headroom admits cannot be measured.");
  if (input.remainingUnpromotedWaves.length === 0) fail("no unpromoted wave was supplied; this release is itself one, so the list can never be empty.");
  const median = (counts: readonly number[]): number => {
    const sorted = [...counts].sort((left, right) => left - right);
    return sorted[Math.floor(sorted.length / 2)]!;
  };
  const sorted = [...input.cellBuildingCounts].sort((left, right) => left - right);
  const medianCellBuildingCount = median(sorted);
  const remainingUnpromotedWaves = input.remainingUnpromotedWaves.map((wave) => ({
    waveId: wave.waveId,
    cellCount: wave.cellBuildingCounts.length,
    medianCellBuildingCount: median(wave.cellBuildingCounts),
  }));
  const medianCellsOfAllRemainingWaves = remainingUnpromotedWaves.reduce((total, wave) => total + wave.medianCellBuildingCount, 0);
  return {
    maxCacheEntries: input.maxCacheEntries,
    promotedWaves: input.promotedWaves.map((wave) => ({ ...wave })),
    promotedWaveCount: input.promotedWaves.length,
    promotedAssetEntries,
    alongsidePromotedHeadroom,
    cellsFittingAlongsidePromoted: sorted.filter((count) => count <= alongsidePromotedHeadroom).length,
    waveCellCount: sorted.length,
    smallestCellBuildingCount: sorted[0]!,
    medianCellBuildingCount,
    admitsMedianCellAlongsidePromoted: alongsidePromotedHeadroom >= medianCellBuildingCount,
    remainingUnpromotedWaves,
    medianCellsOfAllRemainingWaves,
    headroomAdmitsMedianCellOfEveryRemainingWaveTogether: alongsidePromotedHeadroom >= medianCellsOfAllRemainingWaves,
    optInSoloCeiling: input.maxCacheEntries,
    modestSubsetCeiling: input.modestSubsetCeiling,
    entryBudget: Math.min(input.maxCacheEntries, input.modestSubsetCeiling),
  };
}

/**
 * The self-imposed ceiling, and why it is this number.
 *
 * 80 entries, CARRIED FORWARD UNCHANGED from the Southern-remainder canary rather
 * than re-derived. It is a judgement, and the reason to keep it fixed is that two
 * canaries of adjacent waves then cost the same, so anything that differs between
 * them is about the waves rather than about how much of the cache each was allowed
 * to take.
 *
 * It is deliberately NOT re-scaled to the raised cap. T018 doubled the cache to
 * 512 to make a fourth PROMOTION representable; spending part of that raise on a
 * canary would quietly consume a decision that was taken for a different purpose.
 * At 512 entries this ceiling is under a sixth of the cache rather than the under-
 * a-third it was at 256, which makes the canary cheaper in relative terms than its
 * predecessor and is stated here rather than presented as a fresh derivation.
 *
 * What it admits for THIS wave is a fact about this wave's cell sizes: its three
 * leading cells own 25, 51 and 2 buildings, so 78 of the 80 entries are used by
 * three whole cells and 2 are spare. The fourth cell owns 50 and does not fit,
 * which is why the walk stops there.
 */
export const CENTRAL_UPPER_MANHATTAN_MODEST_SUBSET_CEILING = 80 as const;

/**
 * Chooses the renderable cells: highest visual priority first, admitting a cell
 * only while the whole subset still fits the entry budget.
 *
 * Order-derived, exactly as the Lower-Manhattan and Southern-remainder canaries'
 * were. A canary's subset may be order-derived because it is proving that the wave
 * materializes at all; choosing cells for what they look like is a curation
 * decision that belongs to promotion, where it can be recorded and defended as
 * one.
 *
 * Whole cells only. A cell loads atomically, so a partially renderable cell would
 * be a cell that can never finish loading.
 */
export function centralUpperManhattanRenderableCells<T extends { cellId: string; buildingIds: readonly string[] }>(
  cells: readonly T[],
  entryBudget: number,
): { cells: T[]; ownedBuildingCount: number; spareEntries: number } {
  const chosen: T[] = [];
  let owned = 0;
  for (const cell of cells) {
    if (owned + cell.buildingIds.length > entryBudget) break;
    chosen.push(cell);
    owned += cell.buildingIds.length;
  }
  if (chosen.length === 0) fail(`no cell fits the ${entryBudget}-entry renderable budget.`);
  return { cells: chosen, ownedBuildingCount: owned, spareEntries: entryBudget - owned };
}

export function centralUpperManhattanInventoryId(buildingId: string): string {
  return midtownCoreV3InventoryId(buildingId, CENTRAL_UPPER_MANHATTAN_RELEASE_ID);
}
export function centralUpperManhattanEvidenceShardId(buildingId: string): string {
  return midtownCoreV3EvidenceShardId(buildingId, CENTRAL_UPPER_MANHATTAN_RELEASE_ID);
}
export function centralUpperManhattanCellReleaseId(cellId: string): string {
  return midtownCoreCellReleaseId(cellId, CENTRAL_UPPER_MANHATTAN_RELEASE_ID);
}

/**
 * The release-emitter profile.
 *
 * `predecessor` is the wave-sequence lineage this canary composes over — the
 * promoted Southern-remainder P1 release's public root and snapshot, pinned by
 * checksum. It is deliberately NOT a per-building predecessor: no building of wave
 * w04 was ever shipped by an earlier wave, so every cell here is the initial
 * version of its own lineage and falls back to pinned base massing. Inventing a
 * per-asset pin for geometry that never existed would be false lineage.
 */
export function centralUpperManhattanProfile(predecessor: MidtownCoreReleasePredecessor | null): MidtownCoreReleaseProfile {
  return {
    releaseId: CENTRAL_UPPER_MANHATTAN_RELEASE_ID,
    generatedAt: CENTRAL_UPPER_MANHATTAN_GENERATED_AT,
    approval: CENTRAL_UPPER_MANHATTAN_APPROVAL,
    budgets: { ...V3T_QUALITY_BUDGETS },
    inventoryId: centralUpperManhattanInventoryId,
    evidenceShardId: centralUpperManhattanEvidenceShardId,
    predecessor,
    textureAdmission: CENTRAL_UPPER_MANHATTAN_TEXTURE_ADMISSION,
  };
}
