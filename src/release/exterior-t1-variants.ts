/**
 * The four `-t1` SHARED-TEXTURE variant releases (T002, ADR 0047).
 *
 * ## What a `-t1` release is
 *
 * For each promoted `-p1` wave there is a `-t1` sibling that ships the SAME
 * cells, the SAME buildings, the SAME plans and the SAME geometry, and differs
 * in exactly one thing: where its four detail tiles live. `-p1` embeds a copy of
 * each tile in every GLB that draws it — 941 copies of four 16,580-byte tiles
 * across the four waves — and `-t1` declares each tile once as a release-scoped
 * `role: "texture"` artifact that every GLB references by relative URI.
 *
 * That is not a cosmetic difference. Cesium keys an EMBEDDED image through its
 * owning model's absolute URL and an EXTERNAL one by its own resolved URI, so
 * the identical tile decodes into one GPU texture per asset in the first case
 * and one per release in the second.
 *
 * ## Why a new release id rather than an edit
 *
 * A release is immutable. The tile delivery is baked into every asset checksum,
 * every cell release, the assembly package and the snapshot, so "deliver the
 * tiles differently" is not an edit a frozen release can absorb. This is the
 * same reason the `-p1` successors exist beside their canaries, applied again.
 *
 * ## What is DELIBERATELY identical, and how that is guaranteed
 *
 * Everything except the release id and the tile delivery:
 *
 *   - the SEED, TOOL, GENERATED INSTANT and UNCERTAINTY are the `-p1` values by
 *     reference, so every plan hash is the same plan hash;
 *   - the tile CATALOGUE and the SAMPLER FILTER are the `-p1` values, so no UV,
 *     no material factor and no filtering decision moves;
 *   - the RENDERABLE SUBSET, the CURATION and the OCCUPANCY derivation are not
 *     restated here at all — the pipelines build a `-t1` variant by SPREADING
 *     their `-p1` variant and overriding four fields, so a divergence in which
 *     cells ship is not something this file could express even by mistake.
 *
 * ## The rights instrument
 *
 * Each `-t1` ships under its wave's approval instrument, carried by reference
 * and unedited, exactly as the `-p1` successor carries the canary's. Nothing
 * about the tiles changes what was approved: the same four rasterized tiles,
 * from the same rasterizer, gated by the same replay, admitted under the same
 * `procedural-replay` policy. Only the number of copies of them in the payload
 * changes, and that is a delivery fact rather than a rights fact.
 *
 * ## Rollout
 *
 * These are OPT-IN releases reached through `?exteriorCells=`, never a render
 * toggle (ADR 0032 B3) and never a promoted default. Default serving is
 * unchanged; promotion is a later decision with its own evidence.
 */

import type { MidtownCoreReleasePredecessor, MidtownCoreReleaseProfile } from "./midtown-core-release.ts";
import { midtownCoreReleaseIds } from "./midtown-core-release.ts";
import type { V3WaveProfile } from "./midtown-core-v3-materialization.ts";
import { V3T_QUALITY_BUDGETS } from "./block835-v3-package.ts";

import { CENTRAL_UPPER_MANHATTAN_APPROVAL, CENTRAL_UPPER_MANHATTAN_APPROVAL_SLUG, CENTRAL_UPPER_MANHATTAN_TEXTURE_ADMISSION } from "./central-upper-manhattan-release.ts";
import { LOWER_MANHATTAN_APPROVAL, LOWER_MANHATTAN_APPROVAL_SLUG, LOWER_MANHATTAN_TEXTURE_ADMISSION } from "./lower-manhattan-release.ts";
import { NORTHERN_MANHATTAN_APPROVAL, NORTHERN_MANHATTAN_APPROVAL_SLUG, NORTHERN_MANHATTAN_TEXTURE_ADMISSION } from "./northern-manhattan-release.ts";
import { SOUTHERN_REMAINDER_APPROVAL, SOUTHERN_REMAINDER_APPROVAL_SLUG, SOUTHERN_REMAINDER_TEXTURE_ADMISSION } from "./southern-remainder-release.ts";

import { CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID, CENTRAL_UPPER_MANHATTAN_P1_WAVE_PROFILE, centralUpperManhattanP1Profile } from "./central-upper-manhattan-p1-release.ts";
import { LOWER_MANHATTAN_P1_RELEASE_ID, LOWER_MANHATTAN_P1_WAVE_PROFILE, lowerManhattanP1Profile } from "./lower-manhattan-p1-release.ts";
import { NORTHERN_MANHATTAN_P1_RELEASE_ID, NORTHERN_MANHATTAN_P1_WAVE_PROFILE, northernManhattanP1Profile } from "./northern-manhattan-p1-release.ts";
import { SOUTHERN_REMAINDER_P1_RELEASE_ID, SOUTHERN_REMAINDER_P1_WAVE_PROFILE, southernRemainderP1Profile } from "./southern-remainder-p1-release.ts";

/** The shape a `-t1` needs out of its `-p1`'s committed `payload-inventory.json`. */
export interface ExteriorT1PredecessorInventory {
  releaseId: string;
  roots?: Record<string, { rootId: string; rootChecksumSha256: string; artifactCount: number }>;
  files: { path: string; byteSize: number; checksumSha256: string }[];
}

function fail(releaseId: string, message: string): never {
  throw new Error(`${releaseId} predecessor: ${message}`);
}

/**
 * Derives a `-t1`'s lineage from its `-p1`'s OWN committed inventory.
 *
 * One generic function rather than four copies, because the four `-p1` modules
 * each grew their own and the four bodies were already identical apart from a
 * release id. It also makes the `-p1` BYTE FREEZE checkable in the same way the
 * `-p1` modules make the canaries' freeze checkable: this release's committed
 * record carries the `-p1` inventory's checksum, so a re-emitted `-p1` breaks
 * this pin rather than quietly diverging.
 */
export function exteriorT1Predecessor(predecessorReleaseId: string, inventory: ExteriorT1PredecessorInventory): MidtownCoreReleasePredecessor {
  if (inventory.releaseId !== predecessorReleaseId) fail(predecessorReleaseId, `pins must come from ${predecessorReleaseId}, not ${inventory.releaseId}.`);
  const publicRoot = inventory.roots?.public;
  if (!publicRoot) fail(predecessorReleaseId, "the committed inventory declares no public root.");
  const snapshotPath = `public/rollout-snapshot/snapshot-${predecessorReleaseId}-v1.json`;
  const snapshotFile = inventory.files.find((file) => file.path === snapshotPath);
  if (!snapshotFile) fail(predecessorReleaseId, `the committed inventory declares no ${snapshotPath}.`);
  const prefix = `public/cell-release/cell-release-${predecessorReleaseId}-`;
  const cellReleases = new Map<string, { cellReleaseId: string; checksumSha256: string }>();
  for (const file of inventory.files) {
    if (!file.path.startsWith(prefix)) continue;
    const stem = file.path.slice(prefix.length, -".json".length);
    const match = /^(.*)-(v\d+)$/u.exec(stem);
    if (!match) fail(predecessorReleaseId, `unrecognised cell-release artifact name ${file.path}.`);
    cellReleases.set(match[1]!, { cellReleaseId: `cell-release:${predecessorReleaseId}:${match[1]!}:${match[2]!}`, checksumSha256: file.checksumSha256 });
  }
  if (cellReleases.size === 0) fail(predecessorReleaseId, "the committed inventory declares no cell releases.");
  return {
    releaseId: predecessorReleaseId,
    publicRoot: { rootId: publicRoot.rootId, rootChecksumSha256: publicRoot.rootChecksumSha256 },
    snapshot: { snapshotId: `snapshot:${predecessorReleaseId}:v1`, checksumSha256: snapshotFile.checksumSha256 },
    cellReleases,
  };
}

export interface ExteriorT1Variant {
  waveId: string;
  releaseId: string;
  predecessorReleaseId: string;
  outputDirectory: string;
  /** Identical to the `-p1` wave profile in every field but the release id and the delivery. */
  waveProfile: V3WaveProfile;
  releaseProfile: (predecessor: MidtownCoreReleasePredecessor | null) => MidtownCoreReleaseProfile;
  predecessorOf: (inventory: ExteriorT1PredecessorInventory) => MidtownCoreReleasePredecessor;
}

/**
 * Builds one `-t1` identity from its `-p1`'s.
 *
 * The wave profile is SPREAD from the `-p1` profile rather than rewritten, so
 * seed, tool, generated instant, uncertainty, budgets, tile catalogue and
 * sampler filter are the same values and cannot be edited here in isolation.
 * Exactly two fields are overridden, and both are named.
 */
function t1Variant(options: {
  waveId: string;
  predecessorReleaseId: string;
  approvalSlug: string;
  p1WaveProfile: V3WaveProfile;
  p1ReleaseProfile: (predecessor: MidtownCoreReleasePredecessor | null) => MidtownCoreReleaseProfile;
  approval: MidtownCoreReleaseProfile["approval"];
  textureAdmission: MidtownCoreReleaseProfile["textureAdmission"];
}): ExteriorT1Variant {
  const releaseId = `${options.predecessorReleaseId.slice(0, -"-p1".length)}-t1`;
  const ids = midtownCoreReleaseIds(releaseId, options.approvalSlug);
  return {
    waveId: options.waveId,
    releaseId,
    predecessorReleaseId: options.predecessorReleaseId,
    outputDirectory: ids.outputDirectory,
    waveProfile: {
      ...options.p1WaveProfile,
      releaseId,
      // The ONE substantive change this whole variant family exists for.
      textureDelivery: "shared-uri",
    },
    releaseProfile: (predecessor) => ({
      // Spread from the `-p1` emitter profile so budgets, generated instant and
      // the inventory/evidence id functions cannot drift; the id functions are
      // re-bound below because they namespace on the release id.
      ...options.p1ReleaseProfile(predecessor),
      releaseId,
      approval: options.approval,
      budgets: { ...V3T_QUALITY_BUDGETS },
      inventoryId: (buildingId: string) => `inventory:${releaseId}:${buildingId}`,
      evidenceShardId: (buildingId: string) => `evidence-shard:${releaseId}:${buildingId}`,
      textureAdmission: options.textureAdmission,
    }),
    predecessorOf: (inventory) => exteriorT1Predecessor(options.predecessorReleaseId, inventory),
  };
}

export const SOUTHERN_REMAINDER_T1 = t1Variant({
  waveId: "w03",
  predecessorReleaseId: SOUTHERN_REMAINDER_P1_RELEASE_ID,
  approvalSlug: SOUTHERN_REMAINDER_APPROVAL_SLUG,
  p1WaveProfile: SOUTHERN_REMAINDER_P1_WAVE_PROFILE,
  p1ReleaseProfile: southernRemainderP1Profile,
  approval: SOUTHERN_REMAINDER_APPROVAL,
  textureAdmission: SOUTHERN_REMAINDER_TEXTURE_ADMISSION,
});

export const LOWER_MANHATTAN_T1 = t1Variant({
  waveId: "w02",
  predecessorReleaseId: LOWER_MANHATTAN_P1_RELEASE_ID,
  approvalSlug: LOWER_MANHATTAN_APPROVAL_SLUG,
  p1WaveProfile: LOWER_MANHATTAN_P1_WAVE_PROFILE,
  p1ReleaseProfile: lowerManhattanP1Profile,
  approval: LOWER_MANHATTAN_APPROVAL,
  textureAdmission: LOWER_MANHATTAN_TEXTURE_ADMISSION,
});

export const CENTRAL_UPPER_MANHATTAN_T1 = t1Variant({
  waveId: "w04",
  predecessorReleaseId: CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID,
  approvalSlug: CENTRAL_UPPER_MANHATTAN_APPROVAL_SLUG,
  p1WaveProfile: CENTRAL_UPPER_MANHATTAN_P1_WAVE_PROFILE,
  p1ReleaseProfile: centralUpperManhattanP1Profile,
  approval: CENTRAL_UPPER_MANHATTAN_APPROVAL,
  textureAdmission: CENTRAL_UPPER_MANHATTAN_TEXTURE_ADMISSION,
});

export const NORTHERN_MANHATTAN_T1 = t1Variant({
  waveId: "w05",
  predecessorReleaseId: NORTHERN_MANHATTAN_P1_RELEASE_ID,
  approvalSlug: NORTHERN_MANHATTAN_APPROVAL_SLUG,
  p1WaveProfile: NORTHERN_MANHATTAN_P1_WAVE_PROFILE,
  p1ReleaseProfile: northernManhattanP1Profile,
  approval: NORTHERN_MANHATTAN_APPROVAL,
  textureAdmission: NORTHERN_MANHATTAN_TEXTURE_ADMISSION,
});

export const EXTERIOR_T1_VARIANTS = [SOUTHERN_REMAINDER_T1, LOWER_MANHATTAN_T1, CENTRAL_UPPER_MANHATTAN_T1, NORTHERN_MANHATTAN_T1] as const;

/** The `?exteriorCells=` ids the app must pin for these to be reachable at all. */
export const EXTERIOR_T1_RELEASE_IDS = EXTERIOR_T1_VARIANTS.map((variant) => variant.releaseId);

/** The inventory note every `-t1` record carries, stated once. */
export function exteriorT1InventoryNote(variant: ExteriorT1Variant, script: string): string {
  return `The payload directory is intentionally untracked, following the citywide precedent. This inventory is the committed record that keeps every emitted byte checkable after the local tree is removed; \`node ${script} graph --release t1 --force\` rebuilds it byte-identically. THIS RELEASE IS A SHARED-TEXTURE VARIANT of ${variant.predecessorReleaseId}: same cells, same buildings, same plans, same seed, same tool, same generated instant, same tile catalogue and same sampler filter, differing in exactly one respect — the four detail tiles are declared ONCE as release-scoped \`texture\` artifacts and referenced by relative URI instead of being embedded in every GLB that draws them. Geometry is therefore unchanged and asset checksums are NOT, because the image bytes left the GLB. RIGHTS: it ships under the wave's approval instrument carried unedited, by reference — same approval id, scope text, exclusions and fingerprint — because the tiles, the rasterizer and the replay gate are the same and only the number of copies of them in the payload differs, which is a delivery fact and not a rights fact. ROLLOUT: opt-in through \`?exteriorCells=\` only. It is absent from the promotion record, so an ordinary session never loads it, and it is not a render toggle.`;
}
