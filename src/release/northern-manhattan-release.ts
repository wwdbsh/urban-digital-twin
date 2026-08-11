/**
 * Identity, rights instrument and emission profile of the Northern-Manhattan
 * exterior canary release `manhattan-northern-manhattan-cells-20260812`.
 *
 * The FIFTH wave to be materialized and the LAST the committed ledger declares:
 * 182 ownership cells and 10,230 canonical buildings. Everything else about it is
 * the accepted wave shape — a derived subset of the committed wave ledger, the
 * footprint-faithful V3 grammar, a bounded renderable subset, truthful tombstones
 * for every other owned cell, and a private root plus a public-audience candidate
 * root emitted by the shared wave emitter.
 *
 * It is a CANARY, not a promotion. Nothing here adds the release to the promoted
 * default; opting into it takes an explicit `?exteriorCells=` deep link against a
 * build that pins the id. Promotion is T022's separate decision with its own
 * evidence, and this wave's promotion is CONSTRAINED BEFORE IT BEGINS by a
 * reservation another release already committed — see
 * `northernManhattanRenderableEntryBudget`.
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
import { deriveExteriorWaveRenderableCells } from "./exterior-wave-subset.ts";
import { NORTHERN_MANHATTAN_RELEASE_ID, NORTHERN_MANHATTAN_WAVE_ID } from "./northern-manhattan-package.ts";

export const NORTHERN_MANHATTAN_APPROVAL_SLUG = "northern-manhattan-textured-canary" as const;
export const NORTHERN_MANHATTAN_IDS = midtownCoreReleaseIds(NORTHERN_MANHATTAN_RELEASE_ID, NORTHERN_MANHATTAN_APPROVAL_SLUG);
export const NORTHERN_MANHATTAN_OUTPUT_DIRECTORY = NORTHERN_MANHATTAN_IDS.outputDirectory;

export const NORTHERN_MANHATTAN_GENERATED_AT = "2026-08-12T00:00:00.000Z" as const;
export const NORTHERN_MANHATTAN_APPROVED_AT = "2026-08-12T00:00:00.000Z" as const;
export const NORTHERN_MANHATTAN_SEED = "manhattan-northern-manhattan-20260812" as const;
export const NORTHERN_MANHATTAN_TOOL = { id: "urban-digital-twin:northern-manhattan-materialization", version: "1.0.0" } as const;

/** The most recently promoted wave this canary composes over in the wave sequence. */
export const NORTHERN_MANHATTAN_PREDECESSOR_RELEASE_ID = "manhattan-central-upper-manhattan-cells-20260812-p1" as const;

// ---------------------------------------------------------------------------
// Rights instrument
//
// A NEW approval scope, authored for this wave, on exactly the terms the
// Central-and-upper-Manhattan instrument was authored on. No frozen approval text
// is edited and no earlier instrument is borrowed: the Block 835 and Midtown-core
// scopes exclude "runtime textures of any kind", which stays true of those
// releases; and each textured wave's instrument names its own wave's partition in
// its operative first sentence — 126 cells and 6,425 buildings, 176 and 9,603,
// 249 and 11,721. An instrument that enumerates another wave's partition cannot be
// made to describe this one by reading it generously, so this wave authors its own
// and pins it by fingerprint.
// ---------------------------------------------------------------------------

/**
 * What this release is authorized to be.
 *
 * The texture clause is carried over from the Central-and-upper-Manhattan
 * instrument deliberately unchanged in substance, because the facts it states are
 * facts about the SHARED procedural-texture-v1 catalogue rather than about any one
 * wave:
 *
 * - the tiles are PROCEDURALLY GENERATED in this repository, a pure function of
 *   named constants, and the release validator re-rasterizes the catalogue and
 *   demands byte equality with every embedded PNG, so an ingested image cannot
 *   survive the gate even in principle;
 * - the motif dimensions were CALIBRATED BY VIEWING public reference imagery and
 *   nothing else. No image was ingested, decoded, traced, sampled, or reproduced,
 *   and no pixel of any photograph is present in or derivable from the shipped
 *   bytes;
 * - the tile verbs are NARROWER than the geometry's, and the operative text says
 *   so rather than letting them inherit. Geometry may be delivered locally,
 *   displayed, conveyed as a derivative AND redistributed, because an in-session
 *   authorization broadened the NYC OTI envelope to permit that. No authorization
 *   broadened anything to cover redistributing tiles, so tiles get local
 *   application display and derivative conveyance ONLY, and redistribution of the
 *   tiles is excluded outright. This instrument broadens nothing about the NYC OTI
 *   source data.
 *
 * It deliberately does NOT claim that any tile resembles, reproduces or reports on
 * any real building's facade, and it does not authorize public internet deployment.
 */
export const NORTHERN_MANHATTAN_APPROVAL_SCOPE =
  "Public-audience candidate exterior-cell canary release manhattan-northern-manhattan-cells-20260812, materializing wave w05 (northern-manhattan) of the provider-neutral Manhattan exterior configuration. It owns 182 ownership cells and 10,230 canonical buildings of the pinned manhattan-citywide-20260804 base, disjoint by derivation from the promoted Block 835, Midtown-core, Lower-Manhattan, Southern-remainder and Central-and-upper-Manhattan waves. It covers local-only delivery, local application display, derivative conveyance, and redistribution of deterministically generated exterior geometry derived from NYC OTI Building Footprints (jh45-qr5r), with NYC OTI attribution, the City modified-data disclaimer, source IDs, capture timestamps, checksums, CRS, and height uncertainty retained. It ADDITIONALLY covers, FOR LOCAL APPLICATION DISPLAY AND DERIVATIVE CONVEYANCE ONLY AND EXPRESSLY NOT FOR REDISTRIBUTION, procedurally generated, replay-gated, designed facade detail tiles carried on that generated geometry at level of detail 0: every tile is a pure function of named constants in this repository, is re-rasterized and required to match byte for byte by the release validator, carries luminance modulation only and no colour, and cites no evidence record. The tile dimensions were calibrated by VIEWING public reference imagery only; no image data was ingested, decoded, traced, sampled, or reproduced, and no pixel of any photograph is present in or derivable from the shipped bytes. Exterior geometry is materialized for a bounded subset of the owned cells; every other owned building, and every building this grammar refused, ships as an explicit unavailable detail with a stated reason." as const;

/**
 * Everything this approval deliberately does not authorize.
 *
 * The list is the Central-and-upper-Manhattan set, carried BYTE-EQUAL because
 * every entry is still true of this release, plus nothing: a canary that added a
 * permission its predecessor wave did not have would be broadening an envelope,
 * which no recorded item authorizes. Its byte equality with the predecessor list
 * is asserted by test rather than left to inspection.
 */
export const NORTHERN_MANHATTAN_APPROVAL_EXCLUSIONS: readonly string[] = [
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
 * The evidence behind this instrument, stated in full — including what it is NOT.
 *
 * There is NO fresh signature for this wave. Nobody was asked to approve wave w05
 * specifically and nobody did. The authority is exactly the two recorded items
 * every textured wave's instrument has named — the user's texture direction of
 * 2026-08-11 and the recorded standing autonomy directive — applied to a further
 * wave of the same configuration under that same directive.
 *
 * It adds one clause its predecessors did not need. This is the LAST wave, so
 * this instrument is the one that makes the ledger's partition fully covered by
 * approved releases, and "the whole city is covered now" is exactly the sentence a
 * reader could mistake for a broader permission. It is not one: completeness of
 * coverage is an arithmetic property of the partition, not a verb, not a source
 * and not an audience.
 */
export const NORTHERN_MANHATTAN_APPROVAL_NOTE =
  "In-session user authorization dated 2026-08-11 broadened the NYC OTI Building Footprints (jh45-qr5r) envelope so exterior geometry generated from those footprints may be publicly displayed, conveyed as a derivative, and redistributed, provided NYC OTI attribution, the City modified-data disclaimer, source IDs, capture timestamp, checksum, CRS, and height uncertainty travel with it. That broadened envelope covers generated geometry only, never the raw jh45-qr5r source dataset, and public internet deployment remains excluded; this release adds no source and stays inside it. THIS INSTRUMENT RESTS ON NO FRESH SIGNATURE. No approval was sought or given for wave w05 specifically. Its authority is exactly the two recorded items the earlier textured waves' instruments named and no others: the user's recorded texture direction of 2026-08-11, which directed that facade appearance be calibrated by REFERENCE ONLY with no image data ingested, and the recorded standing autonomy directive under which these waves are executed. A separate instrument is authored for this wave because the operative text enumerates a specific partition — 182 cells and 10,230 buildings — and an instrument that enumerates another wave's partition cannot describe this one; it is not authored because new permission was obtained, and it grants no verb, no source and no envelope that the 2026-08-11 authorization did not already carry. THAT THIS IS THE LAST WAVE BROADENS NOTHING, AND THE COMPLETED COVERAGE IT PRODUCES IS NOT A NEW PERMISSION. With this release every wave the committed ledger declares has an approved instrument, so the ledger's whole partition is covered for the first time. An envelope is a set of verbs over a set of sources for a stated audience, and none of those three moved: the verbs are the 2026-08-11 verbs, the source is the same pinned jh45-qr5r snapshot, and the audience is still local, with public internet deployment excluded here exactly as it is excluded in every predecessor. Covering the last buildings of the same pinned source under the same verbs is not a wider envelope, and nothing in this instrument authorizes assembling the six waves into a redistributable whole that no single wave's instrument would permit. Neither recorded item is a licence grant from any third party and neither is represented as one. The tiles admitted here are the procedural-texture-v1 catalogue: four grayscale motifs at 128 by 128 pixels, generated from named constants in this repository, embedded only at level of detail 0, and gated by a rasterizer replay that recomputes the catalogue and requires byte equality with every embedded image. A tile derived from a photograph is unreproducible by that gate by definition and therefore cannot ship. The tile verbs are deliberately narrower than the geometry's: the 2026-08-11 authorization broadened the geometry envelope to permit redistribution, and no recorded item broadened anything to permit redistributing generated tiles, so this instrument authorizes tiles for local application display and derivative conveyance only and excludes their redistribution outright. Colour is never carried by a tile; it stays in the per-material factor the grammar already designs. Buildings whose sourced polygon this grammar cannot carry are refused with a stated deterministic reason and ship as unavailable rather than being given invented geometry." as const;

/** `sha256HexSync(stableSerialize({ scope, exclusions, approvedAt, approvalNote }))`. */
export function northernManhattanApprovalFingerprint(): string {
  return sha256HexSync(stableSerialize({
    scope: NORTHERN_MANHATTAN_APPROVAL_SCOPE,
    exclusions: [...NORTHERN_MANHATTAN_APPROVAL_EXCLUSIONS],
    approvedAt: NORTHERN_MANHATTAN_APPROVED_AT,
    approvalNote: NORTHERN_MANHATTAN_APPROVAL_NOTE,
  }));
}

export const NORTHERN_MANHATTAN_APPROVAL: ExteriorApprovalEvidence = {
  id: NORTHERN_MANHATTAN_IDS.approvalId,
  fingerprintSha256: northernManhattanApprovalFingerprint(),
  scope: NORTHERN_MANHATTAN_APPROVAL_SCOPE,
  exclusions: [...NORTHERN_MANHATTAN_APPROVAL_EXCLUSIONS],
  approvedAt: NORTHERN_MANHATTAN_APPROVED_AT,
};

/**
 * The release-level texture admission carried onto the emitted roots.
 *
 * `procedural-replay` plus the decided sampler filter, identical in substance to
 * every textured wave's because it describes the same catalogue. The runtime reads
 * this field identically for an opt-in load and for a promoted one, so admitting
 * the tiles needs no runtime change at all.
 */
export const NORTHERN_MANHATTAN_TEXTURE_ADMISSION: ExteriorTextureAdmission = {
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
export function northernManhattanRefusalReason(code: string, detail: string): string {
  return `Refused by the footprint-faithful V3 exterior grammar [${code}]: ${detail}. No geometry was invented for this building, and no substitute representation was selected; base massing from the pinned citywide release is what remains on screen.`;
}

// ---------------------------------------------------------------------------
// Emission profiles
// ---------------------------------------------------------------------------

const WAVE_PROFILE_BASE = {
  releaseId: NORTHERN_MANHATTAN_RELEASE_ID,
  generatedAt: NORTHERN_MANHATTAN_GENERATED_AT,
  seed: NORTHERN_MANHATTAN_SEED,
  tool: { ...NORTHERN_MANHATTAN_TOOL },
} as const;

/**
 * The SHIPPED profile: textured, at level of detail 0 only.
 *
 * `V3T_QUALITY_BUDGETS` rather than `V3_QUALITY_BUDGETS`, because the latter
 * declares `maxTextures: 0` — an accurate statement about a texture-free package
 * that is byte-frozen into committed manifests and is never edited.
 */
export const NORTHERN_MANHATTAN_WAVE_PROFILE: V3WaveProfile = {
  ...WAVE_PROFILE_BASE,
  uncertainty: DETERMINISTIC_FACADE_V3T_UNCERTAINTY,
  budgets: { ...V3T_QUALITY_BUDGETS },
  texture: PROCEDURAL_TEXTURE_PROFILE,
  textureFilter: { ...PROCEDURAL_TEXTURE_SAMPLER_FILTER },
};

/**
 * The CENSUS profile: identical grammar, no tiles.
 *
 * The wave census runs over all 10,230 owned buildings to state which sourced
 * polygons this grammar can carry. That is a question about GEOMETRY, and tiles
 * are a writer-stage concern that touches no plan field — the seed, tool and
 * generated instant are shared with the shipped profile, so every plan hash is
 * identical between the two passes and the census is a true statement about the
 * buildings that ship.
 */
export const NORTHERN_MANHATTAN_CENSUS_PROFILE: V3WaveProfile = {
  ...WAVE_PROFILE_BASE,
  uncertainty: DETERMINISTIC_FACADE_V3_UNCERTAINTY,
  budgets: { ...V3_QUALITY_BUDGETS },
  texture: null,
};

// ---------------------------------------------------------------------------
// Predecessor lineage, derived from the promoted wave's committed inventory
// ---------------------------------------------------------------------------

/** The shape this module needs out of a wave's `payload-inventory.json`. */
export interface NorthernManhattanPredecessorInventory {
  releaseId: string;
  roots?: Record<string, { rootId: string; rootChecksumSha256: string; artifactCount: number }>;
  files: { path: string; byteSize: number; checksumSha256: string }[];
}

const PREDECESSOR_CELL_RELEASE_PREFIX = `public/cell-release/cell-release-${NORTHERN_MANHATTAN_PREDECESSOR_RELEASE_ID}-`;
const PREDECESSOR_SNAPSHOT_PATH = `public/rollout-snapshot/snapshot-${NORTHERN_MANHATTAN_PREDECESSOR_RELEASE_ID}-v1.json`;

function fail(message: string): never { throw new Error(`Northern-Manhattan predecessor: ${message}`); }

/**
 * Derives this canary's wave-sequence lineage from the PROMOTED
 * Central-and-upper-Manhattan P1 successor's own COMMITTED inventory, never from
 * hand-typed constants and never from the untracked payload directory.
 *
 * The predecessor is the P1 SUCCESSOR rather than the T019 canary, because the
 * wave sequence this release composes over is the promoted one: that canary was
 * never promoted, so a release that pinned it would claim to follow bytes no
 * ordinary session loads.
 */
export function northernManhattanPredecessor(inventory: NorthernManhattanPredecessorInventory): MidtownCoreReleasePredecessor {
  if (inventory.releaseId !== NORTHERN_MANHATTAN_PREDECESSOR_RELEASE_ID) {
    fail(`pins must come from ${NORTHERN_MANHATTAN_PREDECESSOR_RELEASE_ID}, not ${inventory.releaseId}.`);
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
      cellReleaseId: `cell-release:${NORTHERN_MANHATTAN_PREDECESSOR_RELEASE_ID}:${match[1]!}:${match[2]!}`,
      checksumSha256: file.checksumSha256,
    });
  }
  if (cellReleases.size === 0) fail("the committed inventory declares no cell releases.");
  return {
    releaseId: NORTHERN_MANHATTAN_PREDECESSOR_RELEASE_ID,
    publicRoot: { rootId: publicRoot.rootId, rootChecksumSha256: publicRoot.rootChecksumSha256 },
    snapshot: { snapshotId: `snapshot:${NORTHERN_MANHATTAN_PREDECESSOR_RELEASE_ID}:v1`, checksumSha256: snapshotFile.checksumSha256 },
    cellReleases,
  };
}

/**
 * The RESERVATION this wave's promotion inherits, read from the release that made
 * it rather than restated here.
 *
 * T020 promoted wave `w04` by taking ADR 0036 Decision 3's response 2: it split
 * the 78-entry headroom 42 to itself and RESERVED 36 for this wave, and it wrote
 * both numbers into its own committed `payload-inventory.json`. Reading them back
 * out of those bytes is what makes the reservation binding in a checkable sense —
 * a constant retyped here could disagree with the record and nothing would notice.
 */
export interface NorthernManhattanReservation {
  fromReleaseId: string;
  forWaveId: string;
  entries: number;
  splitResponse: number;
  /** The two halves the recorded split divided, carried so the sum is checkable. */
  splitFromHeadroomEntries: number;
  splitTakenByPredecessorEntries: number;
}

export function northernManhattanReservation(inventory: {
  releaseId: string;
  occupancy?: {
    reservedForNextWaveEntries?: number;
    reservedForNextWaveId?: string;
    splitResponse?: number;
    curatedSubsetCeiling?: number;
    alongsidePromotedHeadroom?: number;
  };
}): NorthernManhattanReservation {
  if (inventory.releaseId !== NORTHERN_MANHATTAN_PREDECESSOR_RELEASE_ID) {
    fail(`the reservation must be read from ${NORTHERN_MANHATTAN_PREDECESSOR_RELEASE_ID}, not ${inventory.releaseId}.`);
  }
  const occupancy = inventory.occupancy;
  const entries = occupancy?.reservedForNextWaveEntries;
  const forWaveId = occupancy?.reservedForNextWaveId;
  const splitResponse = occupancy?.splitResponse;
  const takenByPredecessor = occupancy?.curatedSubsetCeiling;
  const splitFromHeadroom = occupancy?.alongsidePromotedHeadroom;
  if (typeof entries !== "number" || typeof forWaveId !== "string" || typeof splitResponse !== "number") {
    fail("the promoted predecessor's committed occupancy declares no reservation; this wave's promotion budget cannot be inherited by silence.");
  }
  if (entries <= 0) fail(`the recorded reservation is ${entries} entries, which reserves nothing.`);
  if (forWaveId !== NORTHERN_MANHATTAN_WAVE_ID) {
    fail(`the recorded reservation is for wave ${forWaveId}, not ${NORTHERN_MANHATTAN_WAVE_ID}; it is not this wave's to inherit.`);
  }
  // Checked AFTER the identity checks above, on the registry's precedent: an error
  // naming the wave to fix is more useful than one reporting a missing field, and a
  // reservation that is not this wave's is not made this wave's by carrying its
  // halves.
  if (typeof takenByPredecessor !== "number" || typeof splitFromHeadroom !== "number") {
    fail("the promoted predecessor's committed occupancy declares a reservation without the headroom it was split out of or the share it kept; the split cannot be checked and must not be inherited on trust.");
  }
  // THE SPLIT MUST ADD UP, or it is not the split that was recorded.
  //
  // Reading only `reservedForNextWaveEntries` would inherit a number without ever
  // checking it against the decision that produced it. A predecessor re-emitted
  // with a different share, or a different headroom, or a reservation edited on its
  // own, would all leave the number here looking exactly as authoritative as a
  // coherent one. So the two halves are read as well and required to reconstitute
  // the headroom they were split out of.
  if (takenByPredecessor + entries !== splitFromHeadroom) {
    fail(`the recorded split takes ${takenByPredecessor} entries and reserves ${entries}, which is ${takenByPredecessor + entries} against the ${splitFromHeadroom}-entry headroom it was split out of; a split that does not add up is not the decision that was recorded and must be re-opened rather than inherited.`);
  }
  return {
    fromReleaseId: inventory.releaseId,
    forWaveId,
    entries,
    splitResponse,
    splitFromHeadroomEntries: splitFromHeadroom,
    splitTakenByPredecessorEntries: takenByPredecessor,
  };
}

// ---------------------------------------------------------------------------
// The renderable-subset entry budget
// ---------------------------------------------------------------------------

/** One promoted wave's occupancy, named so a further promotion cannot be forgotten. */
export interface NorthernManhattanPromotedWaveEntries {
  releaseId: string;
  assetEntries: number;
}

/** Every quantity the entry budget is derived from, and the ones it refuses to hide. */
export interface NorthernManhattanEntryBudget {
  maxCacheEntries: number;
  promotedWaves: NorthernManhattanPromotedWaveEntries[];
  promotedWaveCount: number;
  promotedAssetEntries: number;
  /** `maxCacheEntries - promotedAssetEntries`: what is actually free today. */
  alongsidePromotedHeadroom: number;
  /**
   * THE LAST-WAVE STATEMENT. `true` only when this wave is the sole remaining
   * unpromoted wave of the declared plan, which is what makes every sentence below
   * about "the reservation" rather than "a share of a contested headroom".
   */
  isLastUnpromotedWave: boolean;
  remainingUnpromotedWaveIds: string[];
  /** What T020's split committed to leaving behind, read from its own record. */
  reservation: NorthernManhattanReservation;
  /**
   * `alongsidePromotedHeadroom - reservation.entries`. Positive means the promoted
   * set spent LESS than its split allowed, so more is free than was promised; it is
   * reported rather than absorbed, because the promise is what binds T022 and the
   * surplus is an accident of what the promoted wave happened to ship.
   */
  headroomExceedsReservationBy: number;
  /**
   * TAUTOLOGICAL BY CONSTRUCTION, AND KEPT ANYWAY — with the tautology stated
   * rather than left for a reader to discover.
   *
   * The derivation THROWS when the reservation exceeds the headroom, so this field
   * can only ever be `true` in a record that exists at all. It is not a check and
   * must not be read as one; the check is the guard, and its evidence is the
   * refusal test that drives it.
   *
   * It ships because a record that carries `alongsidePromotedHeadroom` and
   * `reservation.entries` side by side invites the question "was that compared?",
   * and the honest answer — yes, before anything else, fail-closed — is worth
   * stating in the bytes. A reader who wants the interesting number wants
   * `headroomExceedsReservationBy`, which is a real measurement and can be
   * negative in no record that was ever emitted, but whose SIZE varies.
   */
  reservationStillFitsHeadroom: true;
  waveCellCount: number;
  smallestCellBuildingCount: number;
  /** Upper of the two middle values for an even cell count. */
  medianCellBuildingCount: number;
  largestCellBuildingCount: number;
  /** How many of the wave's cells fit whole in what is actually free. */
  cellsFittingAlongsidePromoted: number;
  /** How many fit whole in the RESERVATION, which is the number T022 is bound by. */
  cellsFittingReservation: number;
  admitsMedianCellAlongsidePromoted: boolean;
  admitsMedianCellWithinReservation: boolean;
  /** What an OPT-IN-ONLY session may occupy: the whole cache, because it loads alone. */
  optInSoloCeiling: number;
  /** The deliberate self-imposed ceiling that keeps a canary a canary. */
  modestSubsetCeiling: number;
  /** The budget actually applied: the smaller of the two ceilings. */
  entryBudget: number;
  /**
   * Whether the canary's applied budget would fit inside the promotion
   * reservation. It does NOT, and recording `false` is the point: this canary is
   * budgeted against the cache it loads alone in, so its size is not a preview of
   * what T022 may promote and must never be read as one.
   */
  entryBudgetFitsReservation: boolean;
}

/**
 * The renderable-subset entry budget for an OPT-IN-ONLY canary, on the LAST wave.
 *
 * WHAT IS DIFFERENT HERE, AND IT IS NOT THE ARITHMETIC. Every earlier wave canary
 * derived a headroom and then said the headroom was not yet anybody's to spend.
 * For this wave the question is already settled: T020 took ADR 0036's response 2,
 * split the 78 entries 42/36, and RESERVED 36 for `northern-manhattan` in its own
 * committed bytes. So this release does not open a split, it inherits a number, and
 * what it owes the record is to say what that number does and does not buy.
 *
 * IT DOES NOT BUY AN ORDINARY CELL OF THIS WAVE. The wave's median cell owns 55
 * buildings and the reservation is 36, so `admitsMedianCellWithinReservation` is
 * FALSE — and so is `admitsMedianCellAlongsidePromoted`, because even the whole
 * measured headroom is smaller than 55. Only a minority of the 182 cells fit the
 * reservation at all. That is a real constraint on T022 discovered by this canary
 * rather than at promotion time, and it is recorded as a measurement rather than as
 * a warning.
 *
 * THE MEASURED HEADROOM AND THE RESERVATION ARE NOT THE SAME NUMBER, AND BOTH SHIP.
 * The promoted set occupies 28 + 156 + 71 + 179 + 40 = 474 of 512 entries, so 38
 * are free while 36 were reserved. The 2-entry difference is what wave `w04`'s
 * promotion did not spend of its own 42-entry share — one curated building the
 * grammar refused, and one entry the curated subset never claimed. T022 is bound by
 * the 36 it was PROMISED, not by the 38 that happen to be free, because the promise
 * is a recorded decision and the surplus is an artifact of a refusal. A promotion
 * that wants the extra 2 must re-open the split and say that it did.
 *
 * NONE OF THAT BINDS THE CANARY, and the difference is a browser fact:
 * `?exteriorCells=` SELECTS the named release and only it, so an opt-in session
 * holds this release's assets and nothing else. The binding ceiling for an opt-in
 * canary is therefore the cache itself, and a second, deliberately chosen ceiling
 * applies on top of it — `modestSubsetCeiling`, a judgement recorded as one. The
 * derivation states plainly, in `entryBudgetFitsReservation`, that the canary's
 * ceiling is LARGER than the reservation, so nobody can read this release's size as
 * a promotion rehearsal.
 *
 * `EXTERIOR_RUNTIME_BUDGETS` is NOT changed by this release.
 */
export function northernManhattanRenderableEntryBudget(input: {
  maxCacheEntries: number;
  /** Every promoted wave, counted from its own committed record. */
  promotedWaves: readonly NorthernManhattanPromotedWaveEntries[];
  modestSubsetCeiling: number;
  /**
   * Every cell's building count, so what the headroom and the reservation admit is
   * MEASURED across the whole wave rather than asserted from one summary statistic.
   */
  cellBuildingCounts: readonly number[];
  /**
   * Every wave that is still unpromoted, THIS ONE INCLUDED. For the last wave this
   * must be exactly this wave: any other member means a promotion was rolled back
   * and the reservation is no longer the whole story.
   */
  remainingUnpromotedWaveIds: readonly string[];
  reservation: NorthernManhattanReservation;
}): NorthernManhattanEntryBudget {
  if (input.promotedWaves.length === 0) fail("no promoted wave was supplied; the occupancy statement would understate the promoted set.");
  for (const wave of input.promotedWaves) {
    if (wave.assetEntries <= 0) fail(`promoted wave ${wave.releaseId} declares ${wave.assetEntries} asset entries; a promoted wave that ships nothing is not a promoted wave.`);
  }
  if (new Set(input.promotedWaves.map((wave) => wave.releaseId)).size !== input.promotedWaves.length) {
    fail("a promoted release was counted twice; the occupancy statement would overstate the promoted set.");
  }
  if (input.modestSubsetCeiling <= 0) fail(`the modest subset ceiling must admit at least one entry, not ${input.modestSubsetCeiling}.`);
  if (input.modestSubsetCeiling > input.maxCacheEntries) {
    fail(`the modest subset ceiling ${input.modestSubsetCeiling} exceeds the ${input.maxCacheEntries}-entry cache cap; an opt-in session cannot hold it.`);
  }
  if (input.cellBuildingCounts.length === 0) fail("the wave declares no cells; what the promoted headroom admits cannot be measured.");
  if (input.remainingUnpromotedWaveIds.length === 0) fail("no unpromoted wave was supplied; this release is itself one, so the list can never be empty.");
  if (!input.remainingUnpromotedWaveIds.includes(NORTHERN_MANHATTAN_WAVE_ID)) {
    fail(`this wave is missing from the unpromoted list; it is a canary and cannot be counted as promoted.`);
  }

  const promotedAssetEntries = input.promotedWaves.reduce((total, wave) => total + wave.assetEntries, 0);
  const alongsidePromotedHeadroom = input.maxCacheEntries - promotedAssetEntries;
  // The reservation is a DECISION taken against a headroom. A reservation that no
  // longer fits what is actually free is not the decision that was recorded, and
  // must be re-opened deliberately rather than silently honoured at a smaller size.
  if (input.reservation.entries > alongsidePromotedHeadroom) {
    fail(`the recorded split reserves ${input.reservation.entries} entries for ${input.reservation.forWaveId}, but only ${alongsidePromotedHeadroom} of ${input.maxCacheEntries} are free beside the ${input.promotedWaves.length} promoted waves; the reservation no longer fits the cache it was split out of and must be re-decided rather than silently re-cut.`);
  }

  const sorted = [...input.cellBuildingCounts].sort((left, right) => left - right);
  const medianCellBuildingCount = sorted[Math.floor(sorted.length / 2)]!;
  const remainingUnpromotedWaveIds = [...input.remainingUnpromotedWaveIds];
  return {
    maxCacheEntries: input.maxCacheEntries,
    promotedWaves: input.promotedWaves.map((wave) => ({ ...wave })),
    promotedWaveCount: input.promotedWaves.length,
    promotedAssetEntries,
    alongsidePromotedHeadroom,
    isLastUnpromotedWave: remainingUnpromotedWaveIds.length === 1 && remainingUnpromotedWaveIds[0] === NORTHERN_MANHATTAN_WAVE_ID,
    remainingUnpromotedWaveIds,
    reservation: { ...input.reservation },
    headroomExceedsReservationBy: alongsidePromotedHeadroom - input.reservation.entries,
    // Literal `true`, not a recomputation of the guard above. Recomputing it would
    // dress a tautology up as a check; writing the constant makes the type say
    // what the field can be, and the guard remains the only thing that decides.
    reservationStillFitsHeadroom: true,
    waveCellCount: sorted.length,
    smallestCellBuildingCount: sorted[0]!,
    medianCellBuildingCount,
    largestCellBuildingCount: sorted[sorted.length - 1]!,
    cellsFittingAlongsidePromoted: sorted.filter((count) => count <= alongsidePromotedHeadroom).length,
    cellsFittingReservation: sorted.filter((count) => count <= input.reservation.entries).length,
    admitsMedianCellAlongsidePromoted: alongsidePromotedHeadroom >= medianCellBuildingCount,
    admitsMedianCellWithinReservation: input.reservation.entries >= medianCellBuildingCount,
    optInSoloCeiling: input.maxCacheEntries,
    modestSubsetCeiling: input.modestSubsetCeiling,
    entryBudget: Math.min(input.maxCacheEntries, input.modestSubsetCeiling),
    entryBudgetFitsReservation: Math.min(input.maxCacheEntries, input.modestSubsetCeiling) <= input.reservation.entries,
  };
}

/**
 * The self-imposed ceiling, and why it is this number rather than the 80 three
 * canaries in a row have used.
 *
 * 80 WAS TRIED FIRST AND IT ADMITS NOTHING HERE. Wave `w05`'s leading cell in
 * ledger priority order owns 86 buildings, more than the whole 80-entry ceiling,
 * so the order-derived walk selects zero cells and
 * `deriveExteriorWaveRenderableCells` throws by design rather than skipping ahead
 * to a smaller cell. That is a fact about this wave and not about the walk: `w05`
 * has the largest median cell of the six (55 against `w04`'s 48) and its first
 * cells are among its largest.
 *
 * So the ceiling moves, once, to 100 — the smallest round ceiling that admits the
 * wave's leading cell — and the move is recorded as a decision rather than
 * presented as the number that was always there. 100 of 512 entries is under a
 * fifth of the cache, so this canary is still cheaper in relative terms than the
 * `w03` canary was at 80 of 256.
 *
 * WHAT IT ADMITS IS ONE CELL, AND THAT IS ALSO A FACT ABOUT THE WAVE. 86 + 42 =
 * 128, so the second cell does not fit under any ceiling this task would call
 * modest; the walk stops after the first and 14 entries are spare. A subset of two
 * or three cells was the shape the earlier canaries had, and it is not reachable
 * here without either doubling the ceiling or skipping cells, and skipping cells
 * is a curation this canary is not entitled to make.
 */
export const NORTHERN_MANHATTAN_MODEST_SUBSET_CEILING = 100 as const;

/**
 * Chooses the renderable cells: highest visual priority first, admitting a cell
 * only while the whole subset still fits the entry budget.
 *
 * Delegates to the wave-generic walk in `exterior-wave-subset.ts`, which was
 * extracted at this task rather than copied a fourth time out of the three earlier
 * waves' release modules.
 */
export function northernManhattanRenderableCells<T extends { cellId: string; buildingIds: readonly string[] }>(
  cells: readonly T[],
  entryBudget: number,
): { cells: T[]; ownedBuildingCount: number; spareEntries: number; stoppedAt: { cellId: string; buildingCount: number; wouldHaveTotalled: number } | null } {
  return deriveExteriorWaveRenderableCells(cells, entryBudget, NORTHERN_MANHATTAN_WAVE_ID);
}

export function northernManhattanInventoryId(buildingId: string): string {
  return midtownCoreV3InventoryId(buildingId, NORTHERN_MANHATTAN_RELEASE_ID);
}
export function northernManhattanEvidenceShardId(buildingId: string): string {
  return midtownCoreV3EvidenceShardId(buildingId, NORTHERN_MANHATTAN_RELEASE_ID);
}
export function northernManhattanCellReleaseId(cellId: string): string {
  return midtownCoreCellReleaseId(cellId, NORTHERN_MANHATTAN_RELEASE_ID);
}

/**
 * The release-emitter profile.
 *
 * `predecessor` is the wave-sequence lineage this canary composes over — the
 * promoted Central-and-upper-Manhattan P1 release's public root and snapshot,
 * pinned by checksum. It is deliberately NOT a per-building predecessor: no
 * building of wave `w05` was ever shipped by an earlier wave, so every cell here is
 * the initial version of its own lineage and falls back to pinned base massing.
 * Inventing a per-asset pin for geometry that never existed would be false lineage.
 */
export function northernManhattanProfile(predecessor: MidtownCoreReleasePredecessor | null): MidtownCoreReleaseProfile {
  return {
    releaseId: NORTHERN_MANHATTAN_RELEASE_ID,
    generatedAt: NORTHERN_MANHATTAN_GENERATED_AT,
    approval: NORTHERN_MANHATTAN_APPROVAL,
    budgets: { ...V3T_QUALITY_BUDGETS },
    inventoryId: northernManhattanInventoryId,
    evidenceShardId: northernManhattanEvidenceShardId,
    predecessor,
    textureAdmission: NORTHERN_MANHATTAN_TEXTURE_ADMISSION,
  };
}
