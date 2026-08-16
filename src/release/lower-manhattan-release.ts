/**
 * Identity, rights instrument and emission profile of the Lower-Manhattan
 * exterior canary release `manhattan-lower-manhattan-cells-20260812`.
 *
 * This is the FIRST TEXTURED WAVE. Everything else about it is the accepted
 * wave shape: a derived subset of the committed wave ledger, the footprint-
 * faithful V3 grammar, a bounded renderable subset, truthful tombstones for
 * every other owned cell, and a private root plus a public-audience candidate
 * root emitted by the shared wave emitter.
 *
 * It is a CANARY, not a promotion. Nothing here adds the release to the
 * promoted default; opting into it takes an explicit `?exteriorCells=` deep
 * link against a build that pins the id. Promotion is a separate decision with
 * its own evidence.
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
import { LOWER_MANHATTAN_RELEASE_ID } from "./lower-manhattan-package.ts";

export const LOWER_MANHATTAN_APPROVAL_SLUG = "lower-manhattan-textured-canary" as const;
export const LOWER_MANHATTAN_IDS = midtownCoreReleaseIds(LOWER_MANHATTAN_RELEASE_ID, LOWER_MANHATTAN_APPROVAL_SLUG);
export const LOWER_MANHATTAN_OUTPUT_DIRECTORY = LOWER_MANHATTAN_IDS.outputDirectory;

export const LOWER_MANHATTAN_GENERATED_AT = "2026-08-12T00:00:00.000Z" as const;
export const LOWER_MANHATTAN_APPROVED_AT = "2026-08-12T00:00:00.000Z" as const;
export const LOWER_MANHATTAN_SEED = "manhattan-lower-manhattan-20260812" as const;
export const LOWER_MANHATTAN_TOOL = { id: "urban-digital-twin:lower-manhattan-materialization", version: "1.0.0" } as const;

/** The promoted wave this canary composes over in the wave sequence. */
export const LOWER_MANHATTAN_PREDECESSOR_RELEASE_ID = "manhattan-midtown-core-cells-20260811-v3" as const;

// ---------------------------------------------------------------------------
// Rights instrument
//
// A NEW approval scope, authored for this wave. No frozen approval text is
// edited: the Block 835 and Midtown-core scopes stay exactly as they were
// approved, and both of them say "runtime textures of any kind, procedural or
// captured" are EXCLUDED — which is true of those releases and stays true. This
// wave cannot borrow either of them, because a scope that excludes textures
// cannot admit them.
// ---------------------------------------------------------------------------

/**
 * What this release is authorized to be.
 *
 * The texture clause is the whole reason this instrument is new, and it is
 * written to claim the minimum that is actually true:
 *
 * - the tiles are PROCEDURALLY GENERATED in this repository, a pure function of
 *   named constants, and the release validator re-rasterizes the catalogue and
 *   demands byte equality with every embedded PNG, so an ingested image cannot
 *   survive the gate even in principle;
 * - the motif dimensions were CALIBRATED BY VIEWING public reference imagery and
 *   nothing else. No image was ingested, decoded, traced, sampled, or
 *   reproduced, and no pixel of any photograph is present in or derivable from
 *   the shipped bytes. Viewing a photograph to choose a conventional
 *   construction module is not a use of that photograph's expression;
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
export const LOWER_MANHATTAN_APPROVAL_SCOPE =
  "Public-audience candidate exterior-cell canary release manhattan-lower-manhattan-cells-20260812, materializing wave w02 (lower-manhattan) of the provider-neutral Manhattan exterior configuration. It owns 126 ownership cells and 6,425 canonical buildings of the pinned manhattan-citywide-20260804 base, disjoint by derivation from the promoted Block 835 and Midtown-core waves. It covers local-only delivery, local application display, derivative conveyance, and redistribution of deterministically generated exterior geometry derived from NYC OTI Building Footprints (jh45-qr5r), with NYC OTI attribution, the City modified-data disclaimer, source IDs, capture timestamps, checksums, CRS, and height uncertainty retained. It ADDITIONALLY covers, FOR LOCAL APPLICATION DISPLAY AND DERIVATIVE CONVEYANCE ONLY AND EXPRESSLY NOT FOR REDISTRIBUTION, procedurally generated, replay-gated, designed facade detail tiles carried on that generated geometry at level of detail 0: every tile is a pure function of named constants in this repository, is re-rasterized and required to match byte for byte by the release validator, carries luminance modulation only and no colour, and cites no evidence record. The tile dimensions were calibrated by VIEWING public reference imagery only; no image data was ingested, decoded, traced, sampled, or reproduced, and no pixel of any photograph is present in or derivable from the shipped bytes. Exterior geometry is materialized for a bounded subset of the owned cells; every other owned building, and every building this grammar refused, ships as an explicit unavailable detail with a stated reason." as const;

/**
 * Everything this approval deliberately does not authorize.
 *
 * The geometry exclusions are the Midtown-core V3 set, carried because they are
 * still true. The two texture exclusions REPLACE that release's blanket "runtime
 * textures of any kind" — this wave does carry tiles — with the narrower pair of
 * things that remain false: captured or source-derived imagery, and any claim
 * that a designed tile reports on a real facade.
 */
export const LOWER_MANHATTAN_APPROVAL_EXCLUSIONS: readonly string[] = [
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
 * The evidence behind the added texture clause, stated in full.
 *
 * Two recorded items and nothing else: the user's texture direction of
 * 2026-08-11, which was explicitly reference-only, and the recorded standing
 * autonomy directive under which this wave was executed. Neither is a licence
 * grant from a third party, and this note does not represent one.
 */
export const LOWER_MANHATTAN_APPROVAL_NOTE =
  "In-session user authorization dated 2026-08-11 broadened the NYC OTI Building Footprints (jh45-qr5r) envelope so exterior geometry generated from those footprints may be publicly displayed, conveyed as a derivative, and redistributed, provided NYC OTI attribution, the City modified-data disclaimer, source IDs, capture timestamp, checksum, CRS, and height uncertainty travel with it. That broadened envelope covers generated geometry only, never the raw jh45-qr5r source dataset, and public internet deployment remains excluded; this release adds no source and stays inside it. The ADDED texture clause rests on two recorded items and no others: the user's recorded texture direction of 2026-08-11, which directed that facade appearance be calibrated by REFERENCE ONLY with no image data ingested, and the recorded standing autonomy directive under which this wave was executed. Neither item is a licence grant from any third party and neither is represented as one. The tiles admitted here are the procedural-texture-v1 catalogue: four grayscale motifs at 128 by 128 pixels, generated from named constants in this repository, embedded only at level of detail 0, and gated by a rasterizer replay that recomputes the catalogue and requires byte equality with every embedded image. A tile derived from a photograph is unreproducible by that gate by definition and therefore cannot ship. The tile verbs are deliberately narrower than the geometry's: the 2026-08-11 authorization broadened the geometry envelope to permit redistribution, and no recorded item broadened anything to permit redistributing generated tiles, so this instrument authorizes tiles for local application display and derivative conveyance only and excludes their redistribution outright. Colour is never carried by a tile; it stays in the per-material factor the grammar already designs. Buildings whose sourced polygon this grammar cannot carry are refused with a stated deterministic reason and ship as unavailable rather than being given invented geometry." as const;

/** `sha256HexSync(stableSerialize({ scope, exclusions, approvedAt, approvalNote }))`. */
export function lowerManhattanApprovalFingerprint(): string {
  return sha256HexSync(stableSerialize({
    scope: LOWER_MANHATTAN_APPROVAL_SCOPE,
    exclusions: [...LOWER_MANHATTAN_APPROVAL_EXCLUSIONS],
    approvedAt: LOWER_MANHATTAN_APPROVED_AT,
    approvalNote: LOWER_MANHATTAN_APPROVAL_NOTE,
  }));
}

export const LOWER_MANHATTAN_APPROVAL: ExteriorApprovalEvidence = {
  id: LOWER_MANHATTAN_IDS.approvalId,
  fingerprintSha256: lowerManhattanApprovalFingerprint(),
  scope: LOWER_MANHATTAN_APPROVAL_SCOPE,
  exclusions: [...LOWER_MANHATTAN_APPROVAL_EXCLUSIONS],
  approvedAt: LOWER_MANHATTAN_APPROVED_AT,
};

/**
 * The release-level texture admission carried onto the emitted roots.
 *
 * `procedural-replay` plus the decided sampler filter. The runtime reads this
 * field identically for an opt-in load and for a promoted one, so admitting the
 * tiles needs no runtime change at all.
 */
export const LOWER_MANHATTAN_TEXTURE_ADMISSION: ExteriorTextureAdmission = {
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
export function lowerManhattanRefusalReason(code: string, detail: string): string {
  return `Refused by the footprint-faithful V3 exterior grammar [${code}]: ${detail}. No geometry was invented for this building, and no substitute representation was selected; base massing from the pinned citywide release is what remains on screen.`;
}

// ---------------------------------------------------------------------------
// Emission profiles
// ---------------------------------------------------------------------------

const WAVE_PROFILE_BASE = {
  releaseId: LOWER_MANHATTAN_RELEASE_ID,
  generatedAt: LOWER_MANHATTAN_GENERATED_AT,
  seed: LOWER_MANHATTAN_SEED,
  tool: { ...LOWER_MANHATTAN_TOOL },
} as const;

/**
 * The SHIPPED profile: textured, at level of detail 0 only.
 *
 * `V3T_QUALITY_BUDGETS` rather than `V3_QUALITY_BUDGETS`, because the latter
 * declares `maxTextures: 0` — an accurate statement about a texture-free package
 * that is byte-frozen into committed manifests and is never edited.
 */
export const LOWER_MANHATTAN_WAVE_PROFILE: V3WaveProfile = {
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
 * The wave census runs over all 6,425 owned buildings to state which sourced
 * polygons this grammar can carry. That is a question about GEOMETRY, and tiles
 * are a writer-stage concern that touches no plan field — the seed, tool and
 * generated instant are shared with the shipped profile, so every plan hash is
 * identical between the two passes and the census is a true statement about the
 * buildings that ship. Rasterizing tiles for six thousand buildings whose bytes
 * are then discarded would buy nothing but hours.
 */
export const LOWER_MANHATTAN_CENSUS_PROFILE: V3WaveProfile = {
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
export interface LowerManhattanPredecessorInventory {
  releaseId: string;
  roots?: Record<string, { rootId: string; rootChecksumSha256: string; artifactCount: number }>;
  files: { path: string; byteSize: number; checksumSha256: string }[];
}

const PREDECESSOR_CELL_RELEASE_PREFIX = `public/cell-release/cell-release-${LOWER_MANHATTAN_PREDECESSOR_RELEASE_ID}-`;
const PREDECESSOR_SNAPSHOT_PATH = `public/rollout-snapshot/snapshot-${LOWER_MANHATTAN_PREDECESSOR_RELEASE_ID}-v1.json`;

function fail(message: string): never { throw new Error(`Lower-Manhattan predecessor: ${message}`); }

/**
 * Derives this canary's wave-sequence lineage from the promoted Midtown-core V3
 * wave's own COMMITTED inventory, never from hand-typed constants and never from
 * the untracked payload directory.
 *
 * This is the graph expression of "composes over its predecessors": the
 * predecessor's public root and snapshot are pinned by the checksums that wave
 * published, so a canary built against a different Midtown-core than the one
 * that is promoted cannot claim to follow it.
 */
export function lowerManhattanPredecessor(inventory: LowerManhattanPredecessorInventory): MidtownCoreReleasePredecessor {
  if (inventory.releaseId !== LOWER_MANHATTAN_PREDECESSOR_RELEASE_ID) {
    fail(`pins must come from ${LOWER_MANHATTAN_PREDECESSOR_RELEASE_ID}, not ${inventory.releaseId}.`);
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
      cellReleaseId: `cell-release:${LOWER_MANHATTAN_PREDECESSOR_RELEASE_ID}:${match[1]!}:${match[2]!}`,
      checksumSha256: file.checksumSha256,
    });
  }
  if (cellReleases.size === 0) fail("the committed inventory declares no cell releases.");
  return {
    releaseId: LOWER_MANHATTAN_PREDECESSOR_RELEASE_ID,
    publicRoot: { rootId: publicRoot.rootId, rootChecksumSha256: publicRoot.rootChecksumSha256 },
    snapshot: { snapshotId: `snapshot:${LOWER_MANHATTAN_PREDECESSOR_RELEASE_ID}:v1`, checksumSha256: snapshotFile.checksumSha256 },
    cellReleases,
  };
}

/**
 * The renderable-subset entry budget, derived from the runtime cache cap.
 *
 * The binding constraint is ENTRIES, not bytes: `EXTERIOR_CELL_MAX_BUILDINGS`'s
 * own derivation records that 120 buildings at both LODs is roughly 8% of the
 * 256 MiB ceiling, so bytes never bind first. The App holds ONE exterior cache
 * for every promoted wave, so this canary's renderable subset is sized to fit
 * ALONGSIDE the two already-promoted waves rather than merely to fit alone —
 * a subset that only fits alone would have to be re-cut at promotion.
 *
 * Caller supplies the promoted occupancy it measured from the committed
 * inventories, so the number is derived from what actually shipped.
 */
export function lowerManhattanRenderableEntryBudget(input: {
  maxCacheEntries: number;
  promotedAssetEntries: number;
}): number {
  const budget = input.maxCacheEntries - input.promotedAssetEntries;
  if (budget <= 0) fail(`the promoted waves already occupy ${input.promotedAssetEntries} of ${input.maxCacheEntries} cache entries; no renderable subset fits.`);
  return budget;
}

/**
 * Chooses the renderable cells: highest visual priority first, admitting a cell
 * only while the whole subset still fits the entry budget.
 *
 * Whole cells only. A cell loads atomically, so a partially renderable cell
 * would be a cell that can never finish loading.
 */
export function lowerManhattanRenderableCells<T extends { cellId: string; buildingIds: readonly string[] }>(
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

export function lowerManhattanInventoryId(buildingId: string): string {
  return midtownCoreV3InventoryId(buildingId, LOWER_MANHATTAN_RELEASE_ID);
}
export function lowerManhattanEvidenceShardId(buildingId: string): string {
  return midtownCoreV3EvidenceShardId(buildingId, LOWER_MANHATTAN_RELEASE_ID);
}
export function lowerManhattanCellReleaseId(cellId: string): string {
  return midtownCoreCellReleaseId(cellId, LOWER_MANHATTAN_RELEASE_ID);
}

/**
 * The release-emitter profile.
 *
 * `predecessor` is the wave-sequence lineage this canary composes over — the
 * promoted Midtown-core V3 release's public root and snapshot, pinned by
 * checksum. It is deliberately NOT a per-building predecessor: no building of
 * wave w02 was ever shipped by an earlier wave, so every cell here is the
 * initial version of its own lineage and falls back to pinned base massing.
 * Inventing a per-asset pin for geometry that never existed would be false
 * lineage.
 */
export function lowerManhattanProfile(predecessor: MidtownCoreReleasePredecessor | null): MidtownCoreReleaseProfile {
  return {
    releaseId: LOWER_MANHATTAN_RELEASE_ID,
    generatedAt: LOWER_MANHATTAN_GENERATED_AT,
    approval: LOWER_MANHATTAN_APPROVAL,
    budgets: { ...V3T_QUALITY_BUDGETS },
    inventoryId: lowerManhattanInventoryId,
    evidenceShardId: lowerManhattanEvidenceShardId,
    predecessor,
    textureAdmission: LOWER_MANHATTAN_TEXTURE_ADMISSION,
  };
}
