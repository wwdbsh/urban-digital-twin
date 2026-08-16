/**
 * Identity of the Northern-Manhattan **P1 successor** exterior-cell release
 * `manhattan-northern-manhattan-cells-20260812-p1` — the release wave `w05` is
 * PROMOTED as, and the SIXTH and last default exterior record this build carries.
 *
 * It is a sibling of `northern-manhattan-release.ts`, not a revision of it. That
 * module keeps the frozen T021 canary `manhattan-northern-manhattan-cells-20260812`
 * and every byte of it, and the canary stays reachable by its `?exteriorCells=`
 * opt-in; this module supplies only what the successor's own identity needs.
 *
 * WHY A SUCCESSOR RELEASE AT ALL. ADR 0037 precondition (b) forbids promoting the
 * canary's renderable subset, and a release is immutable: the renderable subset is
 * baked into its snapshot, its cell releases, its assembly package and every asset
 * checksum, so "ship different cells" is not an edit that an immutable release can
 * absorb. The Lower-Manhattan, Southern-remainder and Central-and-upper-Manhattan
 * P1 successors established the mechanics for a first-promotion textured wave and
 * this follows them exactly — same wave, same wave-scoped ownership ledger and
 * therefore the same two hash domains from the closed-table registry, new release
 * id, predecessor pinned by the predecessor's own committed inventory.
 *
 * THE PREDECESSOR SET IS DISJOINT, so every per-building pin is `null`. The
 * canary's single renderable cell is 701 at the wave's southern edge; the curated
 * cell 727 is a different tile in a different tile row, so not one building this
 * release ships was ever shipped by the canary. Inventing a per-asset pin for
 * geometry that never existed under this wave would be false lineage; the
 * predecessor relationship is graph lineage at the root and snapshot level, which
 * is what the pins below express.
 *
 * THE RIGHTS INSTRUMENT IS THE CANARY'S, UNEDITED. `NORTHERN_MANHATTAN_APPROVAL`
 * is carried through verbatim: same approval id, same scope text, same exclusions,
 * same note, same fingerprint. It is not re-authored and not amended, because
 * amending it would move the fingerprint the canary's own committed release graph
 * pins and would falsify what was approved. Every operative clause of that
 * instrument is true of this release: it authorizes wave w05's 182 cells and 10,230
 * buildings, procedural replay-gated tiles at LOD 0 for local display and
 * derivative conveyance only, and materialization "for a bounded subset of the
 * owned cells" — which is precisely what changes here and precisely what the
 * instrument left bounded rather than enumerated. The instrument's opening sentence
 * names the release it was authored for; that sentence is the only part of it that
 * is about the canary rather than about the wave, and this release adds no source,
 * no verb and no envelope to it.
 *
 * IT ALSO RESTS ON NO FRESH SIGNATURE, and promotion does not change that: nobody
 * was asked to approve wave w05 for default activation and nobody did. The
 * carry-over and the absence of a fresh signature are both stated in this release's
 * own committed inventory bytes, so a reader holding the record does not have to
 * find this comment to learn that the instrument is borrowed rather than new.
 *
 * THE INSTRUMENT'S LAST-WAVE CLAUSE APPLIES HERE AT ITS FULL FORCE AND STILL
 * BROADENS NOTHING. That clause was written for the canary and says that completed
 * coverage of the ledger's partition is an arithmetic property rather than a verb,
 * a source or an audience. With THIS release the completion becomes a fact about
 * the promoted DEFAULT rather than only about approved releases — every wave the
 * ledger declares now streams to an ordinary session — and the clause is exactly as
 * true of that stronger statement: the verbs are the 2026-08-11 verbs, the source
 * is the same pinned jh45-qr5r snapshot, public internet deployment stays excluded,
 * and nothing here authorizes assembling the six waves into a redistributable whole
 * that no single wave's instrument would permit.
 */

import type { MidtownCoreReleasePredecessor, MidtownCoreReleaseProfile } from "./midtown-core-release.ts";
import { midtownCoreCellReleaseId, midtownCoreReleaseIds } from "./midtown-core-release.ts";
import { V3_FROZEN_WAVE_ADMISSION_ENVELOPE, midtownCoreV3EvidenceShardId, midtownCoreV3InventoryId, type V3WaveProfile } from "./midtown-core-v3-materialization.ts";
import { V3T_QUALITY_BUDGETS } from "./block835-v3-package.ts";
import { DETERMINISTIC_FACADE_V3T_UNCERTAINTY } from "../domain/deterministic-facade-generator-v3.ts";
import { PROCEDURAL_TEXTURE_PROFILE, PROCEDURAL_TEXTURE_SAMPLER_FILTER } from "./procedural-texture.ts";
import { NORTHERN_MANHATTAN_RELEASE_ID } from "./northern-manhattan-package.ts";
import {
  NORTHERN_MANHATTAN_APPROVAL,
  NORTHERN_MANHATTAN_APPROVAL_SLUG,
  NORTHERN_MANHATTAN_SEED,
  NORTHERN_MANHATTAN_TEXTURE_ADMISSION,
  NORTHERN_MANHATTAN_TOOL,
} from "./northern-manhattan-release.ts";

export const NORTHERN_MANHATTAN_P1_RELEASE_ID = "manhattan-northern-manhattan-cells-20260812-p1" as const;

/** The release this successor supersedes: the T021 canary, pinned by checksum. */
export const NORTHERN_MANHATTAN_P1_PREDECESSOR_RELEASE_ID = NORTHERN_MANHATTAN_RELEASE_ID;

export const NORTHERN_MANHATTAN_P1_IDS = midtownCoreReleaseIds(NORTHERN_MANHATTAN_P1_RELEASE_ID, NORTHERN_MANHATTAN_APPROVAL_SLUG);
export const NORTHERN_MANHATTAN_P1_OUTPUT_DIRECTORY = NORTHERN_MANHATTAN_P1_IDS.outputDirectory;

/**
 * The successor's generated instant.
 *
 * It is the canary's instant, deliberately. The plans are the SAME immutable
 * plans: this successor re-materializes the same wave through the same grammar with
 * the same seed and the same tool, and the only thing that moved is WHICH cells
 * retain their bytes. Moving the generated instant would change every plan hash and
 * make the two releases' geometry incomparable for no reason anybody could point at.
 */
export const NORTHERN_MANHATTAN_P1_GENERATED_AT = "2026-08-12T00:00:00.000Z" as const;

/**
 * The SHIPPED profile: identical to the canary's in every field.
 *
 * Same seed, same tool, same generated instant, same uncertainty, same budgets,
 * same tile catalogue and same sampler filter. Only the release id differs, and the
 * release id is not an input to any plan hash — which is what makes "the same
 * immutable plans" a checkable statement rather than a claim.
 */
export const NORTHERN_MANHATTAN_P1_WAVE_PROFILE: V3WaveProfile = {
  releaseId: NORTHERN_MANHATTAN_P1_RELEASE_ID,
  generatedAt: NORTHERN_MANHATTAN_P1_GENERATED_AT,
  seed: NORTHERN_MANHATTAN_SEED,
  tool: { ...NORTHERN_MANHATTAN_TOOL },
  uncertainty: DETERMINISTIC_FACADE_V3T_UNCERTAINTY,
  budgets: { ...V3T_QUALITY_BUDGETS },
  texture: PROCEDURAL_TEXTURE_PROFILE,
  textureFilter: { ...PROCEDURAL_TEXTURE_SAMPLER_FILTER },
  admissionEnvelope: V3_FROZEN_WAVE_ADMISSION_ENVELOPE,
};

// ---------------------------------------------------------------------------
// Predecessor pins, derived from the canary's committed checksum inventory
// ---------------------------------------------------------------------------

/** The shape this module needs out of `data/northern-manhattan-20260812/payload-inventory.json`. */
export interface NorthernManhattanP1PredecessorInventory {
  releaseId: string;
  roots?: Record<string, { rootId: string; rootChecksumSha256: string; artifactCount: number }>;
  files: { path: string; byteSize: number; checksumSha256: string }[];
}

const PREDECESSOR_CELL_RELEASE_PREFIX = `public/cell-release/cell-release-${NORTHERN_MANHATTAN_P1_PREDECESSOR_RELEASE_ID}-`;
const PREDECESSOR_SNAPSHOT_PATH = `public/rollout-snapshot/snapshot-${NORTHERN_MANHATTAN_P1_PREDECESSOR_RELEASE_ID}-v1.json`;

function fail(message: string): never { throw new Error(`Northern-Manhattan P1 predecessor: ${message}`); }

/**
 * Derives this successor's lineage from the CANARY's own committed inventory,
 * never from hand-typed constants and never from the untracked payload tree.
 *
 * A successor built against a different canary than the one that is committed
 * cannot claim to follow it: the public root and snapshot checksums below are the
 * canary's published bytes, and the emitter records them on this release's roots.
 * This is also what proves the canary's BYTE FREEZE — the successor's own committed
 * record carries the canary inventory's checksum, so a canary that had been
 * re-emitted would break this release's pin rather than quietly diverging.
 */
export function northernManhattanP1Predecessor(inventory: NorthernManhattanP1PredecessorInventory): MidtownCoreReleasePredecessor {
  if (inventory.releaseId !== NORTHERN_MANHATTAN_P1_PREDECESSOR_RELEASE_ID) {
    fail(`pins must come from ${NORTHERN_MANHATTAN_P1_PREDECESSOR_RELEASE_ID}, not ${inventory.releaseId}.`);
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
      cellReleaseId: `cell-release:${NORTHERN_MANHATTAN_P1_PREDECESSOR_RELEASE_ID}:${match[1]!}:${match[2]!}`,
      checksumSha256: file.checksumSha256,
    });
  }
  if (cellReleases.size === 0) fail("the committed canary inventory declares no cell releases.");
  return {
    releaseId: NORTHERN_MANHATTAN_P1_PREDECESSOR_RELEASE_ID,
    publicRoot: { rootId: publicRoot.rootId, rootChecksumSha256: publicRoot.rootChecksumSha256 },
    snapshot: { snapshotId: `snapshot:${NORTHERN_MANHATTAN_P1_PREDECESSOR_RELEASE_ID}:v1`, checksumSha256: snapshotFile.checksumSha256 },
    cellReleases,
  };
}

export function northernManhattanP1InventoryId(buildingId: string): string {
  return midtownCoreV3InventoryId(buildingId, NORTHERN_MANHATTAN_P1_RELEASE_ID);
}
export function northernManhattanP1EvidenceShardId(buildingId: string): string {
  return midtownCoreV3EvidenceShardId(buildingId, NORTHERN_MANHATTAN_P1_RELEASE_ID);
}
export function northernManhattanP1CellReleaseId(cellId: string): string {
  return midtownCoreCellReleaseId(cellId, NORTHERN_MANHATTAN_P1_RELEASE_ID);
}

/**
 * The release-emitter profile.
 *
 * `approval` is `NORTHERN_MANHATTAN_APPROVAL` by reference rather than by copy, so
 * the successor cannot drift from the instrument it ships under even in principle:
 * there is one object, and the canary and this release both point at it.
 */
export function northernManhattanP1Profile(predecessor: MidtownCoreReleasePredecessor | null): MidtownCoreReleaseProfile {
  return {
    releaseId: NORTHERN_MANHATTAN_P1_RELEASE_ID,
    generatedAt: NORTHERN_MANHATTAN_P1_GENERATED_AT,
    approval: NORTHERN_MANHATTAN_APPROVAL,
    budgets: { ...V3T_QUALITY_BUDGETS },
    inventoryId: northernManhattanP1InventoryId,
    evidenceShardId: northernManhattanP1EvidenceShardId,
    predecessor,
    textureAdmission: NORTHERN_MANHATTAN_TEXTURE_ADMISSION,
  };
}
