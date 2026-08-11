/**
 * Identity, rights instrument and emission profile of the Southern-remainder
 * exterior canary release `manhattan-southern-remainder-cells-20260812`.
 *
 * The THIRD wave to be materialized and the second to carry procedural facade
 * detail tiles. Everything else about it is the accepted wave shape: a derived
 * subset of the committed wave ledger, the footprint-faithful V3 grammar, a
 * bounded renderable subset, truthful tombstones for every other owned cell, and
 * a private root plus a public-audience candidate root emitted by the shared
 * wave emitter.
 *
 * It is a CANARY, not a promotion. Nothing here adds the release to the promoted
 * default; opting into it takes an explicit `?exteriorCells=` deep link against
 * a build that pins the id. Promotion is a separate decision with its own
 * evidence, and for this wave it has a precondition this release cannot satisfy
 * on its own — see `southernRemainderRenderableEntryBudget`.
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
  midtownCoreV3EvidenceShardId,
  midtownCoreV3InventoryId,
  type V3WaveProfile,
} from "./midtown-core-v3-materialization.ts";
import { SOUTHERN_REMAINDER_RELEASE_ID } from "./southern-remainder-package.ts";

export const SOUTHERN_REMAINDER_APPROVAL_SLUG = "southern-remainder-textured-canary" as const;
export const SOUTHERN_REMAINDER_IDS = midtownCoreReleaseIds(SOUTHERN_REMAINDER_RELEASE_ID, SOUTHERN_REMAINDER_APPROVAL_SLUG);
export const SOUTHERN_REMAINDER_OUTPUT_DIRECTORY = SOUTHERN_REMAINDER_IDS.outputDirectory;

export const SOUTHERN_REMAINDER_GENERATED_AT = "2026-08-12T00:00:00.000Z" as const;
export const SOUTHERN_REMAINDER_APPROVED_AT = "2026-08-12T00:00:00.000Z" as const;
export const SOUTHERN_REMAINDER_SEED = "manhattan-southern-remainder-20260812" as const;
export const SOUTHERN_REMAINDER_TOOL = { id: "urban-digital-twin:southern-remainder-materialization", version: "1.0.0" } as const;

/** The most recently promoted wave this canary composes over in the wave sequence. */
export const SOUTHERN_REMAINDER_PREDECESSOR_RELEASE_ID = "manhattan-lower-manhattan-cells-20260812-p1" as const;

// ---------------------------------------------------------------------------
// Rights instrument
//
// A NEW approval scope, authored for this wave. No frozen approval text is
// edited and no earlier instrument is borrowed: the Block 835 and Midtown-core
// scopes exclude "runtime textures of any kind", which stays true of those
// releases, and the Lower-Manhattan instrument names wave w02's 126 cells and
// 6,425 buildings in its operative first sentence. An instrument that enumerates
// another wave's partition cannot be made to describe this one by reading it
// generously, so this wave authors its own and pins it by fingerprint.
// ---------------------------------------------------------------------------

/**
 * What this release is authorized to be.
 *
 * The texture clause is carried over from the Lower-Manhattan instrument
 * deliberately unchanged in substance, because the facts it states are facts
 * about the SHARED procedural-texture-v1 catalogue rather than about wave w02:
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
export const SOUTHERN_REMAINDER_APPROVAL_SCOPE =
  "Public-audience candidate exterior-cell canary release manhattan-southern-remainder-cells-20260812, materializing wave w03 (southern-remainder) of the provider-neutral Manhattan exterior configuration. It owns 176 ownership cells and 9,603 canonical buildings of the pinned manhattan-citywide-20260804 base, disjoint by derivation from the promoted Block 835, Midtown-core and Lower-Manhattan waves. It covers local-only delivery, local application display, derivative conveyance, and redistribution of deterministically generated exterior geometry derived from NYC OTI Building Footprints (jh45-qr5r), with NYC OTI attribution, the City modified-data disclaimer, source IDs, capture timestamps, checksums, CRS, and height uncertainty retained. It ADDITIONALLY covers, FOR LOCAL APPLICATION DISPLAY AND DERIVATIVE CONVEYANCE ONLY AND EXPRESSLY NOT FOR REDISTRIBUTION, procedurally generated, replay-gated, designed facade detail tiles carried on that generated geometry at level of detail 0: every tile is a pure function of named constants in this repository, is re-rasterized and required to match byte for byte by the release validator, carries luminance modulation only and no colour, and cites no evidence record. The tile dimensions were calibrated by VIEWING public reference imagery only; no image data was ingested, decoded, traced, sampled, or reproduced, and no pixel of any photograph is present in or derivable from the shipped bytes. Exterior geometry is materialized for a bounded subset of the owned cells; every other owned building, and every building this grammar refused, ships as an explicit unavailable detail with a stated reason." as const;

/**
 * Everything this approval deliberately does not authorize.
 *
 * The list is the Lower-Manhattan set, carried because every entry is still
 * true of this release, plus nothing: a canary that added a permission its
 * predecessor wave did not have would be broadening an envelope, which no
 * recorded item authorizes.
 */
export const SOUTHERN_REMAINDER_APPROVAL_EXCLUSIONS: readonly string[] = [
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
 * w03 specifically and nobody did. The authority is exactly the two recorded
 * items the Lower-Manhattan instrument named — the user's texture direction of
 * 2026-08-11 and the recorded standing autonomy directive — applied to a further
 * wave of the same configuration under that same directive. The note says so in
 * those words rather than letting a reader infer a per-wave approval event from
 * the existence of a per-wave instrument. A new instrument was authored because
 * the operative text enumerates a partition, not because new permission was
 * obtained.
 */
export const SOUTHERN_REMAINDER_APPROVAL_NOTE =
  "In-session user authorization dated 2026-08-11 broadened the NYC OTI Building Footprints (jh45-qr5r) envelope so exterior geometry generated from those footprints may be publicly displayed, conveyed as a derivative, and redistributed, provided NYC OTI attribution, the City modified-data disclaimer, source IDs, capture timestamp, checksum, CRS, and height uncertainty travel with it. That broadened envelope covers generated geometry only, never the raw jh45-qr5r source dataset, and public internet deployment remains excluded; this release adds no source and stays inside it. THIS INSTRUMENT RESTS ON NO FRESH SIGNATURE. No approval was sought or given for wave w03 specifically. Its authority is exactly the two recorded items the Lower-Manhattan wave's instrument named and no others: the user's recorded texture direction of 2026-08-11, which directed that facade appearance be calibrated by REFERENCE ONLY with no image data ingested, and the recorded standing autonomy directive under which these waves are executed. A separate instrument is authored for this wave because the operative text enumerates a specific partition — 176 cells and 9,603 buildings — and an instrument that enumerates another wave's partition cannot describe this one; it is not authored because new permission was obtained, and it grants no verb, no source and no envelope that the 2026-08-11 authorization did not already carry. Neither recorded item is a licence grant from any third party and neither is represented as one. The tiles admitted here are the procedural-texture-v1 catalogue: four grayscale motifs at 128 by 128 pixels, generated from named constants in this repository, embedded only at level of detail 0, and gated by a rasterizer replay that recomputes the catalogue and requires byte equality with every embedded image. A tile derived from a photograph is unreproducible by that gate by definition and therefore cannot ship. The tile verbs are deliberately narrower than the geometry's: the 2026-08-11 authorization broadened the geometry envelope to permit redistribution, and no recorded item broadened anything to permit redistributing generated tiles, so this instrument authorizes tiles for local application display and derivative conveyance only and excludes their redistribution outright. Colour is never carried by a tile; it stays in the per-material factor the grammar already designs. Buildings whose sourced polygon this grammar cannot carry are refused with a stated deterministic reason and ship as unavailable rather than being given invented geometry." as const;

/** `sha256HexSync(stableSerialize({ scope, exclusions, approvedAt, approvalNote }))`. */
export function southernRemainderApprovalFingerprint(): string {
  return sha256HexSync(stableSerialize({
    scope: SOUTHERN_REMAINDER_APPROVAL_SCOPE,
    exclusions: [...SOUTHERN_REMAINDER_APPROVAL_EXCLUSIONS],
    approvedAt: SOUTHERN_REMAINDER_APPROVED_AT,
    approvalNote: SOUTHERN_REMAINDER_APPROVAL_NOTE,
  }));
}

export const SOUTHERN_REMAINDER_APPROVAL: ExteriorApprovalEvidence = {
  id: SOUTHERN_REMAINDER_IDS.approvalId,
  fingerprintSha256: southernRemainderApprovalFingerprint(),
  scope: SOUTHERN_REMAINDER_APPROVAL_SCOPE,
  exclusions: [...SOUTHERN_REMAINDER_APPROVAL_EXCLUSIONS],
  approvedAt: SOUTHERN_REMAINDER_APPROVED_AT,
};

/**
 * The release-level texture admission carried onto the emitted roots.
 *
 * `procedural-replay` plus the decided sampler filter, identical in substance to
 * the Lower-Manhattan wave's because it describes the same catalogue. The
 * runtime reads this field identically for an opt-in load and for a promoted
 * one, so admitting the tiles needs no runtime change at all.
 */
export const SOUTHERN_REMAINDER_TEXTURE_ADMISSION: ExteriorTextureAdmission = {
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
export function southernRemainderRefusalReason(code: string, detail: string): string {
  return `Refused by the footprint-faithful V3 exterior grammar [${code}]: ${detail}. No geometry was invented for this building, and no substitute representation was selected; base massing from the pinned citywide release is what remains on screen.`;
}

// ---------------------------------------------------------------------------
// Emission profiles
// ---------------------------------------------------------------------------

const WAVE_PROFILE_BASE = {
  releaseId: SOUTHERN_REMAINDER_RELEASE_ID,
  generatedAt: SOUTHERN_REMAINDER_GENERATED_AT,
  seed: SOUTHERN_REMAINDER_SEED,
  tool: { ...SOUTHERN_REMAINDER_TOOL },
} as const;

/**
 * The SHIPPED profile: textured, at level of detail 0 only.
 *
 * `V3T_QUALITY_BUDGETS` rather than `V3_QUALITY_BUDGETS`, because the latter
 * declares `maxTextures: 0` — an accurate statement about a texture-free package
 * that is byte-frozen into committed manifests and is never edited.
 */
export const SOUTHERN_REMAINDER_WAVE_PROFILE: V3WaveProfile = {
  ...WAVE_PROFILE_BASE,
  uncertainty: DETERMINISTIC_FACADE_V3T_UNCERTAINTY,
  budgets: { ...V3T_QUALITY_BUDGETS },
  texture: PROCEDURAL_TEXTURE_PROFILE,
  textureFilter: { ...PROCEDURAL_TEXTURE_SAMPLER_FILTER },
};

/**
 * The CENSUS profile: identical grammar, no tiles.
 *
 * The wave census runs over all 9,603 owned buildings to state which sourced
 * polygons this grammar can carry. That is a question about GEOMETRY, and tiles
 * are a writer-stage concern that touches no plan field — the seed, tool and
 * generated instant are shared with the shipped profile, so every plan hash is
 * identical between the two passes and the census is a true statement about the
 * buildings that ship. Rasterizing tiles for nine thousand buildings whose bytes
 * are then discarded would buy nothing but hours.
 */
export const SOUTHERN_REMAINDER_CENSUS_PROFILE: V3WaveProfile = {
  ...WAVE_PROFILE_BASE,
  uncertainty: DETERMINISTIC_FACADE_V3_UNCERTAINTY,
  budgets: { ...V3_QUALITY_BUDGETS },
  texture: null,
};

// ---------------------------------------------------------------------------
// Predecessor lineage, derived from the promoted wave's committed inventory
// ---------------------------------------------------------------------------

/** The shape this module needs out of a wave's `payload-inventory.json`. */
export interface SouthernRemainderPredecessorInventory {
  releaseId: string;
  roots?: Record<string, { rootId: string; rootChecksumSha256: string; artifactCount: number }>;
  files: { path: string; byteSize: number; checksumSha256: string }[];
}

const PREDECESSOR_CELL_RELEASE_PREFIX = `public/cell-release/cell-release-${SOUTHERN_REMAINDER_PREDECESSOR_RELEASE_ID}-`;
const PREDECESSOR_SNAPSHOT_PATH = `public/rollout-snapshot/snapshot-${SOUTHERN_REMAINDER_PREDECESSOR_RELEASE_ID}-v1.json`;

function fail(message: string): never { throw new Error(`Southern-remainder predecessor: ${message}`); }

/**
 * Derives this canary's wave-sequence lineage from the PROMOTED Lower-Manhattan
 * P1 successor's own COMMITTED inventory, never from hand-typed constants and
 * never from the untracked payload directory.
 *
 * The predecessor is the P1 SUCCESSOR rather than the T015 canary, because the
 * wave sequence this release composes over is the promoted one: the canary was
 * never promoted, so a release that pinned it would claim to follow bytes no
 * ordinary session loads.
 */
export function southernRemainderPredecessor(inventory: SouthernRemainderPredecessorInventory): MidtownCoreReleasePredecessor {
  if (inventory.releaseId !== SOUTHERN_REMAINDER_PREDECESSOR_RELEASE_ID) {
    fail(`pins must come from ${SOUTHERN_REMAINDER_PREDECESSOR_RELEASE_ID}, not ${inventory.releaseId}.`);
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
      cellReleaseId: `cell-release:${SOUTHERN_REMAINDER_PREDECESSOR_RELEASE_ID}:${match[1]!}:${match[2]!}`,
      checksumSha256: file.checksumSha256,
    });
  }
  if (cellReleases.size === 0) fail("the committed inventory declares no cell releases.");
  return {
    releaseId: SOUTHERN_REMAINDER_PREDECESSOR_RELEASE_ID,
    publicRoot: { rootId: publicRoot.rootId, rootChecksumSha256: publicRoot.rootChecksumSha256 },
    snapshot: { snapshotId: `snapshot:${SOUTHERN_REMAINDER_PREDECESSOR_RELEASE_ID}:v1`, checksumSha256: snapshotFile.checksumSha256 },
    cellReleases,
  };
}

// ---------------------------------------------------------------------------
// The renderable-subset entry budget
// ---------------------------------------------------------------------------

/** Every quantity the entry budget is derived from, and the two it refuses to hide. */
export interface SouthernRemainderEntryBudget {
  maxCacheEntries: number;
  block835AssetEntries: number;
  midtownAssetEntries: number;
  lowerManhattanAssetEntries: number;
  promotedAssetEntries: number;
  /** `maxCacheEntries - promotedAssetEntries`: what a PROMOTED w03 subset could occupy today. */
  alongsidePromotedHeadroom: number;
  /** How many of the wave's 176 cells fit whole in that headroom. */
  cellsFittingAlongsidePromoted: number;
  waveCellCount: number;
  smallestCellBuildingCount: number;
  /** Upper of the two middle values for an even cell count. */
  medianCellBuildingCount: number;
  /**
   * Whether the headroom admits a cell of ORDINARY size.
   *
   * Named for its criterion rather than called "admissible", because the
   * unqualified word would have been a lie by a technicality: this wave owns two
   * single-building cells, so a headroom of one entry does literally admit a
   * cell. It admits nothing anyone would promote.
   */
  admitsMedianCellAlongsidePromoted: boolean;
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
 * This wave is where the Lower-Manhattan derivation stops working, and the
 * arithmetic says so rather than being quietly reinterpreted. That derivation
 * sized a subset to fit ALONGSIDE the promoted waves, so it would not need
 * re-cutting at promotion:
 *
 *     256 cache entries - 28 (Block 835) - 156 (Midtown-core) = 72
 *
 * Three waves are promoted now, and the Lower-Manhattan P1 successor occupies 71
 * more:
 *
 *     256 - 28 - 156 - 71 = 1 entry
 *
 * ONE entry. What one entry admits is stated precisely rather than rounded to
 * "nothing": this wave owns two single-building cells, so two of its 176 cells
 * do fit, and the record says so. Its median cell owns 50 buildings and its
 * leading cell owns 77, so a promoted subset of wave w03 that anyone would
 * actually promote is impossible at today's cap. That is a real, stated blocker
 * on PROMOTION (T018's precondition, ADR 0034's 255-of-256 observation carried
 * forward), and it is deliberately NOT treated as a blocker here, because a
 * canary is not promoted: `?exteriorCells=` SELECTS the named release and only
 * it, so an opt-in session holds this release's assets and nothing else. The
 * binding ceiling for an opt-in canary is therefore the cache itself.
 *
 * The cache alone would admit 235 entries of this wave's leading cells, which
 * would make a "canary" that occupies 92% of the runtime cache. So a second,
 * deliberately chosen ceiling applies: `modestSubsetCeiling`. It is a judgement,
 * not a derivation, and it is recorded as one — its job is to keep the canary
 * small enough that its cost is obviously bounded while still shipping a real
 * cell of real buildings.
 *
 * `EXTERIOR_RUNTIME_BUDGETS` is NOT changed by this release. Raising the cap is
 * exactly the promotion decision this canary exists to inform, and making that
 * change here would be deciding it without the evidence.
 */
export function southernRemainderRenderableEntryBudget(input: {
  maxCacheEntries: number;
  block835AssetEntries: number;
  midtownAssetEntries: number;
  lowerManhattanAssetEntries: number;
  modestSubsetCeiling: number;
  /**
   * Every cell's building count, so what the headroom admits is MEASURED across
   * the whole wave rather than asserted from one summary statistic.
   */
  cellBuildingCounts: readonly number[];
}): SouthernRemainderEntryBudget {
  const promotedAssetEntries = input.block835AssetEntries + input.midtownAssetEntries + input.lowerManhattanAssetEntries;
  const alongsidePromotedHeadroom = input.maxCacheEntries - promotedAssetEntries;
  if (input.modestSubsetCeiling <= 0) fail(`the modest subset ceiling must admit at least one entry, not ${input.modestSubsetCeiling}.`);
  if (input.modestSubsetCeiling > input.maxCacheEntries) {
    fail(`the modest subset ceiling ${input.modestSubsetCeiling} exceeds the ${input.maxCacheEntries}-entry cache cap; an opt-in session cannot hold it.`);
  }
  if (input.cellBuildingCounts.length === 0) fail("the wave declares no cells; what the promoted headroom admits cannot be measured.");
  const sorted = [...input.cellBuildingCounts].sort((left, right) => left - right);
  const medianCellBuildingCount = sorted[Math.floor(sorted.length / 2)]!;
  return {
    maxCacheEntries: input.maxCacheEntries,
    block835AssetEntries: input.block835AssetEntries,
    midtownAssetEntries: input.midtownAssetEntries,
    lowerManhattanAssetEntries: input.lowerManhattanAssetEntries,
    promotedAssetEntries,
    alongsidePromotedHeadroom,
    cellsFittingAlongsidePromoted: sorted.filter((count) => count <= alongsidePromotedHeadroom).length,
    waveCellCount: sorted.length,
    smallestCellBuildingCount: sorted[0]!,
    medianCellBuildingCount,
    admitsMedianCellAlongsidePromoted: alongsidePromotedHeadroom >= medianCellBuildingCount,
    optInSoloCeiling: input.maxCacheEntries,
    modestSubsetCeiling: input.modestSubsetCeiling,
    entryBudget: Math.min(input.maxCacheEntries, input.modestSubsetCeiling),
  };
}

/**
 * The self-imposed ceiling, and why it is this number.
 *
 * 80 entries is a little under a third of the 256-entry cache, and it is the
 * smallest round ceiling that admits this wave's leading cell whole — that cell
 * owns 77 buildings, and a cell is never split because a partially renderable
 * cell could never finish loading. Choosing 72 to echo the Lower-Manhattan
 * budget would have admitted NOTHING, which is a fact about this wave's cell
 * sizes rather than about its cost.
 */
export const SOUTHERN_REMAINDER_MODEST_SUBSET_CEILING = 80 as const;

/**
 * Chooses the renderable cells: highest visual priority first, admitting a cell
 * only while the whole subset still fits the entry budget.
 *
 * Order-derived, exactly as the Lower-Manhattan canary's was. A canary's subset
 * may be order-derived because it is proving that the wave materializes at all;
 * choosing cells for what they look like is a curation decision that belongs to
 * promotion, where it can be recorded and defended as one.
 *
 * Whole cells only. A cell loads atomically, so a partially renderable cell
 * would be a cell that can never finish loading.
 */
export function southernRemainderRenderableCells<T extends { cellId: string; buildingIds: readonly string[] }>(
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

export function southernRemainderInventoryId(buildingId: string): string {
  return midtownCoreV3InventoryId(buildingId, SOUTHERN_REMAINDER_RELEASE_ID);
}
export function southernRemainderEvidenceShardId(buildingId: string): string {
  return midtownCoreV3EvidenceShardId(buildingId, SOUTHERN_REMAINDER_RELEASE_ID);
}
export function southernRemainderCellReleaseId(cellId: string): string {
  return midtownCoreCellReleaseId(cellId, SOUTHERN_REMAINDER_RELEASE_ID);
}

/**
 * The release-emitter profile.
 *
 * `predecessor` is the wave-sequence lineage this canary composes over — the
 * promoted Lower-Manhattan P1 release's public root and snapshot, pinned by
 * checksum. It is deliberately NOT a per-building predecessor: no building of
 * wave w03 was ever shipped by an earlier wave, so every cell here is the
 * initial version of its own lineage and falls back to pinned base massing.
 * Inventing a per-asset pin for geometry that never existed would be false
 * lineage.
 */
export function southernRemainderProfile(predecessor: MidtownCoreReleasePredecessor | null): MidtownCoreReleaseProfile {
  return {
    releaseId: SOUTHERN_REMAINDER_RELEASE_ID,
    generatedAt: SOUTHERN_REMAINDER_GENERATED_AT,
    approval: SOUTHERN_REMAINDER_APPROVAL,
    budgets: { ...V3T_QUALITY_BUDGETS },
    inventoryId: southernRemainderInventoryId,
    evidenceShardId: southernRemainderEvidenceShardId,
    predecessor,
    textureAdmission: SOUTHERN_REMAINDER_TEXTURE_ADMISSION,
  };
}
