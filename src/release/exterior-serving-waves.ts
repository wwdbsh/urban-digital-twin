/**
 * The six serving waves: what each `-s1` release is, and what it may assert.
 *
 * One entry per wave the committed island ledger declares. Every number here is
 * an EXPECTATION the emitter checks against the committed `-c1` census rather
 * than a figure it prints: a wave that generates a different population from the
 * one T004 retained is a wave whose retained bytes changed, and the emitter
 * stops instead of cutting a serving release over them.
 *
 * ## The approval instrument
 *
 * A `-s1` release conveys the SAME bytes, under the SAME rights, as the `-c1`
 * package it transforms — which in turn descends from the curated wave release
 * whose approval this restates. Nothing here widens an envelope:
 *
 * - The geometry verbs are the ones the 2026-08-11 in-session authorization
 *   granted for NYC OTI Building Footprints (jh45-qr5r) derivatives, read out of
 *   the source registry by `servingSourceRights` rather than written here.
 * - The detail tiles keep the NARROWER verbs the curated waves gave them: local
 *   application display and derivative conveyance, never redistribution.
 * - Public internet deployment stays excluded, in every wave, unchanged.
 *
 * What IS new is breadth, and it is stated rather than implied: a curated wave
 * shipped tens to a few hundred buildings of its area and marked the rest
 * unavailable; a serving wave ships every building its grammar could carry. That
 * is more bytes under the same permission, not a new permission, and the scope
 * text says exactly that.
 */

import { sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";
import type { ExteriorApprovalEvidence } from "../domain/exterior-contract.ts";
import type { ExteriorTextureAdmission } from "./exterior-release.ts";
import { PROCEDURAL_TEXTURE_PROFILE, PROCEDURAL_TEXTURE_SAMPLER_FILTER } from "./procedural-texture.ts";
import { exteriorServingReleaseId, servingApprovalId } from "./exterior-serving-release.ts";

export const EXTERIOR_SERVING_GENERATED_AT = "2026-08-17T00:00:00.000Z" as const;
export const EXTERIOR_SERVING_APPROVED_AT = "2026-08-17T00:00:00.000Z" as const;
/** The pinned base the whole island was generated from, and its capture chronology. */
export const EXTERIOR_SERVING_BASE_RELEASE_IDS: readonly string[] = ["manhattan-citywide-20260804", "manhattan-civic-context-20260804"];
export const EXTERIOR_SERVING_CAPTURE = { capturedAt: "2026-08-04T00:00:00.000Z", updatedAt: "2026-08-04T00:00:00.000Z" } as const;
/** The evidence directory this task's serving records are committed under. */
export const EXTERIOR_SERVING_EVIDENCE_ID = "exterior-serving-20260817" as const;

export type ExteriorServingWaveId = "w00" | "w01" | "w02" | "w03" | "w04" | "w05";

export interface ExteriorServingWave {
  waveId: ExteriorServingWaveId;
  /** The T004 retention package this wave is transformed from. */
  retentionReleaseId: string;
  servingReleaseId: string;
  /** Human area name, used only in the approval scope text. */
  area: string;
  /** Pinned from the committed `-c1` census; the emitter compares, never assumes. */
  cellCount: number;
  ownedBuildingCount: number;
  generatedBuildingCount: number;
  tombstonedBuildingCount: number;
}

function wave(
  waveId: ExteriorServingWaveId,
  retentionReleaseId: string,
  area: string,
  counts: { cellCount: number; ownedBuildingCount: number; generatedBuildingCount: number; tombstonedBuildingCount: number },
): ExteriorServingWave {
  return { waveId, retentionReleaseId, servingReleaseId: exteriorServingReleaseId(retentionReleaseId), area, ...counts };
}

/** Ordered oldest wave first, exactly as the promotion set is composed. */
export const EXTERIOR_SERVING_WAVES: readonly ExteriorServingWave[] = [
  wave("w00", "manhattan-exterior-cells-20260811-v3-c1", "Block 835", { cellCount: 1, ownedBuildingCount: 14, generatedBuildingCount: 14, tombstonedBuildingCount: 0 }),
  wave("w01", "manhattan-midtown-core-cells-20260811-v3-c1", "Midtown core", { cellCount: 149, ownedBuildingCount: 7_201, generatedBuildingCount: 7_179, tombstonedBuildingCount: 22 }),
  wave("w02", "manhattan-lower-manhattan-cells-20260812-c1", "Lower Manhattan", { cellCount: 126, ownedBuildingCount: 6_425, generatedBuildingCount: 6_382, tombstonedBuildingCount: 43 }),
  wave("w03", "manhattan-southern-remainder-cells-20260812-c1", "Southern remainder", { cellCount: 176, ownedBuildingCount: 9_603, generatedBuildingCount: 9_560, tombstonedBuildingCount: 43 }),
  wave("w04", "manhattan-central-upper-manhattan-cells-20260812-c1", "Central and upper Manhattan", { cellCount: 249, ownedBuildingCount: 11_721, generatedBuildingCount: 11_682, tombstonedBuildingCount: 39 }),
  wave("w05", "manhattan-northern-manhattan-cells-20260812-c1", "Northern Manhattan", { cellCount: 182, ownedBuildingCount: 10_230, generatedBuildingCount: 10_172, tombstonedBuildingCount: 58 }),
];

export function exteriorServingWave(waveId: string): ExteriorServingWave {
  const found = EXTERIOR_SERVING_WAVES.find((entry) => entry.waveId === waveId);
  if (!found) throw new Error(`Exterior serving release: unknown wave ${waveId}; expected one of ${EXTERIOR_SERVING_WAVES.map((entry) => entry.waveId).join(", ")}.`);
  return found;
}

/** The island totals, derived from the table rather than restated beside it. */
export const EXTERIOR_SERVING_ISLAND_TOTALS = {
  cellCount: EXTERIOR_SERVING_WAVES.reduce((total, entry) => total + entry.cellCount, 0),
  ownedBuildingCount: EXTERIOR_SERVING_WAVES.reduce((total, entry) => total + entry.ownedBuildingCount, 0),
  generatedBuildingCount: EXTERIOR_SERVING_WAVES.reduce((total, entry) => total + entry.generatedBuildingCount, 0),
  tombstonedBuildingCount: EXTERIOR_SERVING_WAVES.reduce((total, entry) => total + entry.tombstonedBuildingCount, 0),
} as const;

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

export const EXTERIOR_SERVING_APPROVAL_EXCLUSIONS: readonly string[] = [
  "public internet deployment",
  "redistribution of the raw jh45-qr5r source dataset",
  "runtime external network requests",
  "private-audience bytes in any browser-reachable root",
  "exterior geometry for owned buildings this release marks unavailable",
  "real-world facade, tenant, brand, signage, or survey-grade accuracy claims",
  "captured, photographic, or otherwise source-derived texture imagery of any kind",
  "redistribution of the procedural facade detail tiles, or of any package carrying them, whether or not the underlying geometry is separately redistributable",
  "any claim that a designed detail tile reproduces, resembles, or reports on a real building's facade, material, colour, age, or condition",
  "any claim that serving a wave in full makes it visually, architecturally or geographically accepted",
];

export const EXTERIOR_SERVING_APPROVAL_NOTE =
  "This serving release conveys the bytes T004 retained, and conveys them under the rights that were already granted for them. The geometry verbs come from the in-session user authorization dated 2026-08-11, which broadened the NYC OTI Building Footprints (jh45-qr5r) envelope so exterior geometry generated from those footprints may be publicly displayed, conveyed as a derivative, and redistributed, provided NYC OTI attribution, the City modified-data disclaimer, source IDs, capture timestamp, checksum, CRS, and height uncertainty travel with it; the emitter reads those verbs out of the source registry entry and fails closed if the registry stops granting them, so nothing is asserted here that the registry does not still say. The detail tiles keep the NARROWER verbs the curated waves gave them: they are the procedural-texture-v1 catalogue, four grayscale motifs generated from named constants in this repository and delivered by shared relative URI, gated by a rasterizer replay that recomputes the catalogue and requires byte equality with every declared tile, and they are authorized for local application display and derivative conveyance only, never for redistribution. What this instrument adds is BREADTH and nothing else: a curated wave shipped a bounded subset of its area and marked every other owned building unavailable, and this release ships every owned building its grammar could carry, with the remainder still shipping as explicit unavailable details with stated deterministic reasons. No new source is read, no truth tier rises above generated, no photograph is ingested, and public internet deployment remains excluded. Serving a wave in full is an availability statement about bytes; it is not visual, architectural, geographic or performance acceptance, and the per-building uncertainty statement continues to say what the geometry does and does not claim.";

export function exteriorServingApprovalScope(waveEntry: ExteriorServingWave): string {
  const format = (value: number): string => value.toLocaleString("en-US");
  return `Public-audience exterior-cell SERVING release ${waveEntry.servingReleaseId}, transformed without regeneration from the T004 retention package ${waveEntry.retentionReleaseId} and materializing wave ${waveEntry.waveId} (${waveEntry.area}) of the provider-neutral Manhattan exterior configuration. It owns ${format(waveEntry.cellCount)} ownership cells and ${format(waveEntry.ownedBuildingCount)} canonical buildings of the pinned manhattan-citywide-20260804 base, disjoint by derivation from every other wave. It ships deterministically generated exterior geometry at level of detail 0 for ${format(waveEntry.generatedBuildingCount)} of those buildings; the remaining ${format(waveEntry.tombstonedBuildingCount)} are buildings this grammar refused and ship as explicit unavailable details with stated deterministic reasons. It covers local-only delivery, local application display, derivative conveyance, and redistribution of that generated geometry, derived from NYC OTI Building Footprints (jh45-qr5r), with NYC OTI attribution, the City modified-data disclaimer, source IDs, capture timestamps, checksums, CRS, and height uncertainty retained. It ADDITIONALLY covers, FOR LOCAL APPLICATION DISPLAY AND DERIVATIVE CONVEYANCE ONLY AND EXPRESSLY NOT FOR REDISTRIBUTION, procedurally generated, replay-gated, designed facade detail tiles delivered by shared relative URI and drawn by that geometry at level of detail 0: every tile is a pure function of named constants in this repository, is re-rasterized and required to match byte for byte by the release validator, carries luminance modulation only and no colour, and cites no evidence record. The tile dimensions were calibrated by VIEWING public reference imagery only; no image data was ingested, decoded, traced, sampled, or reproduced, and no pixel of any photograph is present in or derivable from the shipped bytes. The coarse level of detail this wave retained is NOT served: only level of detail 0 ships, with an unbounded eligible distance, so no camera distance leaves a shipped building without a representation.`;
}

export function exteriorServingApprovalFingerprint(waveEntry: ExteriorServingWave): string {
  return sha256HexSync(stableSerialize({
    scope: exteriorServingApprovalScope(waveEntry),
    exclusions: [...EXTERIOR_SERVING_APPROVAL_EXCLUSIONS],
    approvedAt: EXTERIOR_SERVING_APPROVED_AT,
    approvalNote: EXTERIOR_SERVING_APPROVAL_NOTE,
  }));
}

export function exteriorServingApproval(waveEntry: ExteriorServingWave): ExteriorApprovalEvidence {
  return {
    id: servingApprovalId(waveEntry.servingReleaseId),
    fingerprintSha256: exteriorServingApprovalFingerprint(waveEntry),
    scope: exteriorServingApprovalScope(waveEntry),
    exclusions: [...EXTERIOR_SERVING_APPROVAL_EXCLUSIONS],
    approvedAt: EXTERIOR_SERVING_APPROVED_AT,
  };
}

/**
 * The release-level texture admission.
 *
 * `procedural-replay` with the decided sampler pair, and a statement that
 * describes SHARED-URI delivery rather than the embedded delivery the curated
 * `-p1` waves used. The distinction is real — a shared tile is one artifact the
 * release declares and every GLB references, and the shared-texture gate is what
 * replays it — so the statement says what these bytes actually are.
 */
export const EXTERIOR_SERVING_TEXTURE_ADMISSION: ExteriorTextureAdmission = {
  policy: "procedural-replay",
  generatedTextureFact: {
    basis: "generated-texture",
    profile: PROCEDURAL_TEXTURE_PROFILE,
    gate: "rasterizer-replay",
    evidenceBasis: null,
    samplerFilter: { ...PROCEDURAL_TEXTURE_SAMPLER_FILTER },
    statement: "Facade detail tiles in this release are four grayscale, pattern-only motifs generated from named constants in this repository, declared once per release and delivered to every level-of-detail-0 asset by shared relative URI. They carry luminance modulation and no colour, cite no evidence record, and reproduce no photograph: the release validator re-rasterizes the catalogue and requires byte equality with every declared tile, so a tile derived from an image cannot pass. No tile asserts the material, colour, age, or condition of any real building.",
  },
};
