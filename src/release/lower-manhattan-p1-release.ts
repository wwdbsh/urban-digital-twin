/**
 * Identity of the Lower-Manhattan **P1 successor** exterior-cell release
 * `manhattan-lower-manhattan-cells-20260812-p1` — the release wave `w02` is
 * PROMOTED as.
 *
 * It is a sibling of `lower-manhattan-release.ts`, not a revision of it. That
 * module keeps the frozen T015 canary `manhattan-lower-manhattan-cells-20260812`
 * and every byte of it, and the canary stays reachable by its `?exteriorCells=`
 * opt-in; this module supplies only what the successor's own identity needs.
 *
 * WHY A SUCCESSOR RELEASE AT ALL. ADR 0034 precondition (a) forbids promoting
 * the canary's renderable subset, and a release is immutable: the renderable
 * subset is baked into its snapshot, its cell releases, its assembly package and
 * every asset checksum, so "ship different cells" is not an edit that an
 * immutable release can absorb. The Midtown-core V3 successor established the
 * mechanics and this follows them exactly — same wave, same wave-scoped
 * ownership ledger and therefore the same two hash domains from the closed-table
 * registry, new release id, predecessor pinned by the predecessor's own
 * committed inventory.
 *
 * WHAT IS DIFFERENT FROM THE MIDTOWN PRECEDENT, and it matters: the Midtown V3
 * successor re-drew the SAME buildings under a new grammar, so it carried a
 * per-building predecessor pin for each of them. This successor draws a
 * DISJOINT set of buildings — the canary's renderable cells are 150 and 151
 * (harbour), the curated promoted cells are 157 and 160 (World Trade Center
 * site) — so not one building it ships was ever shipped by the canary. Every
 * per-building predecessor pin is therefore `null`, exactly as in the canary,
 * because inventing a pin for geometry that never existed under this wave would
 * be false lineage. The predecessor relationship is graph lineage at the root
 * and snapshot level, which is what the pins below express.
 *
 * THE RIGHTS INSTRUMENT IS THE CANARY'S, UNEDITED. `LOWER_MANHATTAN_APPROVAL`
 * is carried through verbatim: same approval id, same scope text, same
 * exclusions, same note, same fingerprint `ff8da10f…`. It is not re-authored and
 * not amended, because amending it would move the fingerprint the canary's own
 * committed release graph pins and would falsify what was approved. Every
 * operative clause of that instrument is true of this release: it authorizes
 * wave w02's 126 cells and 6,425 buildings, procedural replay-gated tiles at
 * LOD 0 for local display and derivative conveyance only, and materialization
 * "for a bounded subset of the owned cells" — which is precisely what changes
 * here and precisely what the instrument left bounded rather than enumerated.
 * The instrument's opening sentence names the release it was authored for; that
 * sentence is the only part of it that is about the canary rather than about the
 * wave, and this release adds no source, no verb and no envelope to it.
 */

import type { MidtownCoreReleasePredecessor, MidtownCoreReleaseProfile } from "./midtown-core-release.ts";
import { midtownCoreCellReleaseId, midtownCoreReleaseIds } from "./midtown-core-release.ts";
import { midtownCoreV3EvidenceShardId, midtownCoreV3InventoryId, type V3WaveProfile } from "./midtown-core-v3-materialization.ts";
import { V3T_QUALITY_BUDGETS } from "./block835-v3-package.ts";
import { DETERMINISTIC_FACADE_V3T_UNCERTAINTY } from "../domain/deterministic-facade-generator-v3.ts";
import { PROCEDURAL_TEXTURE_PROFILE, PROCEDURAL_TEXTURE_SAMPLER_FILTER } from "./procedural-texture.ts";
import { LOWER_MANHATTAN_RELEASE_ID } from "./lower-manhattan-package.ts";
import {
  LOWER_MANHATTAN_APPROVAL,
  LOWER_MANHATTAN_APPROVAL_SLUG,
  LOWER_MANHATTAN_SEED,
  LOWER_MANHATTAN_TEXTURE_ADMISSION,
  LOWER_MANHATTAN_TOOL,
} from "./lower-manhattan-release.ts";

export const LOWER_MANHATTAN_P1_RELEASE_ID = "manhattan-lower-manhattan-cells-20260812-p1" as const;

/** The release this successor supersedes: the T015 canary, pinned by checksum. */
export const LOWER_MANHATTAN_P1_PREDECESSOR_RELEASE_ID = LOWER_MANHATTAN_RELEASE_ID;

export const LOWER_MANHATTAN_P1_IDS = midtownCoreReleaseIds(LOWER_MANHATTAN_P1_RELEASE_ID, LOWER_MANHATTAN_APPROVAL_SLUG);
export const LOWER_MANHATTAN_P1_OUTPUT_DIRECTORY = LOWER_MANHATTAN_P1_IDS.outputDirectory;

/**
 * The successor's generated instant.
 *
 * It is the canary's instant, deliberately. The plans are the SAME immutable
 * plans: this successor re-materializes the same wave through the same grammar
 * with the same seed and the same tool, and the only thing that moved is WHICH
 * cells retain their bytes. Moving the generated instant would change every plan
 * hash and make the two releases' geometry incomparable for no reason anybody
 * could point at.
 */
export const LOWER_MANHATTAN_P1_GENERATED_AT = "2026-08-12T00:00:00.000Z" as const;

/**
 * The SHIPPED profile: identical to the canary's in every field.
 *
 * Same seed, same tool, same generated instant, same uncertainty, same budgets,
 * same tile catalogue and same sampler filter. Only the release id differs, and
 * the release id is not an input to any plan hash — which is what makes "the
 * same immutable plans" a checkable statement rather than a claim: a building
 * that appears in both releases hashes identically in both.
 */
export const LOWER_MANHATTAN_P1_WAVE_PROFILE: V3WaveProfile = {
  releaseId: LOWER_MANHATTAN_P1_RELEASE_ID,
  generatedAt: LOWER_MANHATTAN_P1_GENERATED_AT,
  seed: LOWER_MANHATTAN_SEED,
  tool: { ...LOWER_MANHATTAN_TOOL },
  uncertainty: DETERMINISTIC_FACADE_V3T_UNCERTAINTY,
  budgets: { ...V3T_QUALITY_BUDGETS },
  texture: PROCEDURAL_TEXTURE_PROFILE,
  textureFilter: { ...PROCEDURAL_TEXTURE_SAMPLER_FILTER },
};

// ---------------------------------------------------------------------------
// Predecessor pins, derived from the canary's committed checksum inventory
// ---------------------------------------------------------------------------

/** The shape this module needs out of `data/lower-manhattan-20260812/payload-inventory.json`. */
export interface LowerManhattanP1PredecessorInventory {
  releaseId: string;
  roots?: Record<string, { rootId: string; rootChecksumSha256: string; artifactCount: number }>;
  files: { path: string; byteSize: number; checksumSha256: string }[];
}

const PREDECESSOR_CELL_RELEASE_PREFIX = `public/cell-release/cell-release-${LOWER_MANHATTAN_P1_PREDECESSOR_RELEASE_ID}-`;
const PREDECESSOR_SNAPSHOT_PATH = `public/rollout-snapshot/snapshot-${LOWER_MANHATTAN_P1_PREDECESSOR_RELEASE_ID}-v1.json`;

function fail(message: string): never { throw new Error(`Lower-Manhattan P1 predecessor: ${message}`); }

/**
 * Derives this successor's lineage from the CANARY's own committed inventory,
 * never from hand-typed constants and never from the untracked payload tree.
 *
 * A successor built against a different canary than the one that is committed
 * cannot claim to follow it: the public root and snapshot checksums below are
 * the canary's published bytes, and the emitter records them on this release's
 * roots.
 */
export function lowerManhattanP1Predecessor(inventory: LowerManhattanP1PredecessorInventory): MidtownCoreReleasePredecessor {
  if (inventory.releaseId !== LOWER_MANHATTAN_P1_PREDECESSOR_RELEASE_ID) {
    fail(`pins must come from ${LOWER_MANHATTAN_P1_PREDECESSOR_RELEASE_ID}, not ${inventory.releaseId}.`);
  }
  const publicRoot = inventory.roots?.public;
  if (!publicRoot) fail("the committed canary inventory declares no public root.");
  const snapshotFile = inventory.files.find((file) => file.path === PREDECESSOR_SNAPSHOT_PATH);
  if (!snapshotFile) fail(`the committed canary inventory declares no ${PREDECESSOR_SNAPSHOT_PATH}.`);
  const cellReleases = new Map<string, { cellReleaseId: string; checksumSha256: string }>();
  for (const file of inventory.files) {
    if (!file.path.startsWith(PREDECESSOR_CELL_RELEASE_PREFIX)) continue;
    const stem = file.path.slice(PREDECESSOR_CELL_RELEASE_PREFIX.length, -".json".length);
    const match = /^(.*)-(v\d+)$/.exec(stem);
    if (!match) fail(`unrecognised cell-release artifact name ${file.path}.`);
    cellReleases.set(match[1]!, {
      cellReleaseId: `cell-release:${LOWER_MANHATTAN_P1_PREDECESSOR_RELEASE_ID}:${match[1]!}:${match[2]!}`,
      checksumSha256: file.checksumSha256,
    });
  }
  if (cellReleases.size === 0) fail("the committed canary inventory declares no cell releases.");
  return {
    releaseId: LOWER_MANHATTAN_P1_PREDECESSOR_RELEASE_ID,
    publicRoot: { rootId: publicRoot.rootId, rootChecksumSha256: publicRoot.rootChecksumSha256 },
    snapshot: { snapshotId: `snapshot:${LOWER_MANHATTAN_P1_PREDECESSOR_RELEASE_ID}:v1`, checksumSha256: snapshotFile.checksumSha256 },
    cellReleases,
  };
}

export function lowerManhattanP1InventoryId(buildingId: string): string {
  return midtownCoreV3InventoryId(buildingId, LOWER_MANHATTAN_P1_RELEASE_ID);
}
export function lowerManhattanP1EvidenceShardId(buildingId: string): string {
  return midtownCoreV3EvidenceShardId(buildingId, LOWER_MANHATTAN_P1_RELEASE_ID);
}
export function lowerManhattanP1CellReleaseId(cellId: string): string {
  return midtownCoreCellReleaseId(cellId, LOWER_MANHATTAN_P1_RELEASE_ID);
}

/**
 * The release-emitter profile.
 *
 * `approval` is `LOWER_MANHATTAN_APPROVAL` by reference rather than by copy, so
 * the successor cannot drift from the instrument it ships under even in
 * principle: there is one object, and the canary and this release both point at
 * it.
 */
export function lowerManhattanP1Profile(predecessor: MidtownCoreReleasePredecessor | null): MidtownCoreReleaseProfile {
  return {
    releaseId: LOWER_MANHATTAN_P1_RELEASE_ID,
    generatedAt: LOWER_MANHATTAN_P1_GENERATED_AT,
    approval: LOWER_MANHATTAN_APPROVAL,
    budgets: { ...V3T_QUALITY_BUDGETS },
    inventoryId: lowerManhattanP1InventoryId,
    evidenceShardId: lowerManhattanP1EvidenceShardId,
    predecessor,
    textureAdmission: LOWER_MANHATTAN_TEXTURE_ADMISSION,
  };
}
