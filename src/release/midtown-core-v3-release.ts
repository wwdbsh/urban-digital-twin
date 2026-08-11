/**
 * Identity of the Midtown-core **V3 successor** public exterior-cell release
 * `manhattan-midtown-core-cells-20260811-v3`.
 *
 * It is a sibling of `midtown-core-release.ts`, not a revision of it. That module
 * keeps the frozen V2 wave release `manhattan-midtown-core-cells-20260811` and
 * every byte of it; this module only supplies the second profile that emitter now
 * accepts, plus the derivation of the predecessor pins from the V2 wave's own
 * committed checksum inventory.
 *
 * Why a whole second release rather than a new head inside the V2 one: the
 * promoted geometry changes, so its snapshot, cell releases, ownership ledger and
 * every asset checksum change with it. An immutable release cannot carry two
 * mutually exclusive versions of its own cells, and the promotion record — not a
 * head selector — is what a build swaps.
 */

import { sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";
import type { ExteriorApprovalEvidence } from "../domain/exterior-contract.ts";
import type { ImmutablePin } from "./multi-lod-assembly.ts";
import { MIDTOWN_CORE_RELEASE_ID } from "./midtown-core-package.ts";
import {
  MIDTOWN_CORE_CELL_RELEASE_VERSION,
  MIDTOWN_CORE_SHIPPED_LOD_ID,
  midtownCoreCellReleaseId,
  midtownCoreReleaseIds,
  type MidtownCoreReleasePredecessor,
  type MidtownCoreReleaseProfile,
} from "./midtown-core-release.ts";
import {
  MIDTOWN_CORE_V3_GENERATED_AT,
  MIDTOWN_CORE_V3_PREDECESSOR_RELEASE_ID,
  MIDTOWN_CORE_V3_RELEASE_ID,
  midtownCoreV3EvidenceShardId,
  midtownCoreV3InventoryId,
} from "./midtown-core-v3-materialization.ts";
import { V3_QUALITY_BUDGETS } from "./block835-v3-package.ts";

export const MIDTOWN_CORE_V3_IDS = midtownCoreReleaseIds(MIDTOWN_CORE_V3_RELEASE_ID);
export const MIDTOWN_CORE_V3_APPROVED_AT = "2026-08-11T00:00:00.000Z" as const;
export const MIDTOWN_CORE_V3_OUTPUT_DIRECTORY = MIDTOWN_CORE_V3_IDS.outputDirectory;

export const MIDTOWN_CORE_V3_APPROVAL_SCOPE =
  "Public-audience successor exterior-cell release manhattan-midtown-core-cells-20260811-v3, promoting the footprint-faithful V3 generated exterior for wave w01 of the provider-neutral Manhattan exterior configuration in place of the V2 release manhattan-midtown-core-cells-20260811. It owns the same 149 ownership cells and the same 7,201 canonical buildings of the pinned manhattan-citywide-20260804 base, and covers local-only delivery, public display, derivative conveyance, and redistribution of deterministically generated, TEXTURE-FREE exterior geometry derived from NYC OTI Building Footprints (jh45-qr5r), with NYC OTI attribution, the City modified-data disclaimer, source IDs, capture timestamps, checksums, CRS, and height uncertainty retained. Exterior geometry is materialized for a bounded subset of the owned cells; every other owned building, and every building this grammar refused, ships as an explicit unavailable detail with a stated reason." as const;

/**
 * Everything this approval deliberately does not authorize.
 *
 * The V2 exclusions are carried verbatim and two are added, for the same reasons
 * the Block 835 V3 successor added them: this release ships no imagery of any
 * kind, and no designed style class here is claimed to reproduce a real
 * building's material. Unlike Block 835, no building of this wave carries a
 * cited facade fact at all — every style class is the grammar's own designed
 * draw.
 */
export const MIDTOWN_CORE_V3_APPROVAL_EXCLUSIONS: readonly string[] = [
  "public deployment",
  "redistribution of the raw jh45-qr5r source dataset",
  "runtime external network requests",
  "private-audience bytes in any browser-reachable root",
  "exterior geometry for owned buildings this release marks unavailable",
  "real-world facade, tenant, brand, signage, or survey-grade accuracy claims",
  "runtime textures of any kind, procedural or captured",
  "any claim that a designed style class reproduces a real building's material",
];

export const MIDTOWN_CORE_V3_APPROVAL_NOTE =
  "In-session user authorization dated 2026-08-11 broadened the NYC OTI Building Footprints (jh45-qr5r) envelope so exterior geometry generated from those footprints may additionally be publicly displayed, conveyed as a derivative, and redistributed, provided NYC OTI attribution, the City modified-data disclaimer, source IDs, capture timestamp, checksum, CRS, and height uncertainty travel with it. The broadened envelope covers that generated geometry only, never the raw jh45-qr5r source dataset, and public deployment remains excluded. This successor release promotes the V3 footprint-faithful grammar under that same envelope and adds no source: the V3 massing follows the same sourced polygon, vertex for vertex, and the same sourced height, at higher fidelity, and remains texture-free. No building of this wave carries a cited facade-material fact, so every style class shipped here is this grammar's own designed draw and asserts nothing about any real building's appearance. Buildings whose sourced polygon this grammar cannot carry are refused with a stated deterministic reason and ship as unavailable rather than being given invented geometry." as const;

/** `sha256HexSync(stableSerialize({ scope, exclusions, approvedAt, approvalNote }))`. */
export function midtownCoreV3ApprovalFingerprint(): string {
  return sha256HexSync(stableSerialize({
    scope: MIDTOWN_CORE_V3_APPROVAL_SCOPE,
    exclusions: [...MIDTOWN_CORE_V3_APPROVAL_EXCLUSIONS],
    approvedAt: MIDTOWN_CORE_V3_APPROVED_AT,
    approvalNote: MIDTOWN_CORE_V3_APPROVAL_NOTE,
  }));
}

export const MIDTOWN_CORE_V3_APPROVAL: ExteriorApprovalEvidence = {
  id: MIDTOWN_CORE_V3_IDS.approvalId,
  fingerprintSha256: midtownCoreV3ApprovalFingerprint(),
  scope: MIDTOWN_CORE_V3_APPROVAL_SCOPE,
  exclusions: [...MIDTOWN_CORE_V3_APPROVAL_EXCLUSIONS],
  approvedAt: MIDTOWN_CORE_V3_APPROVED_AT,
};

/**
 * Stated reason for a building the V3 grammar refused.
 *
 * The refusal detail is appended by the materializer, so the shipped sentence
 * names both the fact that nothing was invented and the property of the sourced
 * polygon that could not be carried.
 */
export function midtownCoreV3RefusalReason(code: string, detail: string): string {
  return `Refused by the footprint-faithful V3 exterior grammar [${code}]: ${detail}. No geometry was invented for this building, and no substitute representation was selected; base massing from the pinned citywide release is what remains on screen.`;
}

// ---------------------------------------------------------------------------
// Predecessor pins, derived from the V2 wave's committed checksum inventory
// ---------------------------------------------------------------------------

/** The shape this module needs out of `data/midtown-core-20260811/payload-inventory.json`. */
export interface MidtownCoreV2PayloadInventory {
  releaseId: string;
  roots?: Record<string, { rootId: string; rootChecksumSha256: string; artifactCount: number }>;
  files: { path: string; byteSize: number; checksumSha256: string }[];
}

const V2_CELL_RELEASE_PREFIX = `public/cell-release/cell-release-${MIDTOWN_CORE_RELEASE_ID}-`;
const V2_SNAPSHOT_PATH = `public/rollout-snapshot/snapshot-${MIDTOWN_CORE_RELEASE_ID}-v1.json`;
const V2_ASSET_PATTERN = /^public\/assets\/(doitt-\d+)__lod_0\.glb$/;

function fail(message: string): never { throw new Error(`Midtown-core V3 predecessor: ${message}`); }

/**
 * Derives every V2 pin this successor carries from the V2 wave's own COMMITTED
 * inventory rather than from hand-typed constants or from the untracked payload
 * directory.
 *
 * The cell id and its version live in the artifact file NAME, and each file's
 * own checksum is the checksum the V2 snapshot pinned, so the whole triple is
 * recoverable without opening the payload. A pin that cannot be derived is an
 * error, never a silently-null lineage.
 */
export function midtownCoreV3Predecessor(inventory: MidtownCoreV2PayloadInventory): MidtownCoreReleasePredecessor {
  if (inventory.releaseId !== MIDTOWN_CORE_V3_PREDECESSOR_RELEASE_ID) {
    fail(`pins must come from ${MIDTOWN_CORE_V3_PREDECESSOR_RELEASE_ID}, not ${inventory.releaseId}.`);
  }
  const publicRoot = inventory.roots?.public;
  if (!publicRoot) fail("the committed inventory declares no public root.");
  const snapshotFile = inventory.files.find((file) => file.path === V2_SNAPSHOT_PATH);
  if (!snapshotFile) fail(`the committed inventory declares no ${V2_SNAPSHOT_PATH}.`);
  const cellReleases = new Map<string, { cellReleaseId: string; checksumSha256: string }>();
  for (const file of inventory.files) {
    if (!file.path.startsWith(V2_CELL_RELEASE_PREFIX)) continue;
    const stem = file.path.slice(V2_CELL_RELEASE_PREFIX.length, -".json".length);
    const match = /^(.*)-(v\d+)$/.exec(stem);
    if (!match) fail(`unrecognised cell-release artifact name ${file.path}.`);
    const cellId = match[1]!;
    cellReleases.set(cellId, {
      cellReleaseId: `cell-release:${MIDTOWN_CORE_RELEASE_ID}:${cellId}:${match[2]!}`,
      checksumSha256: file.checksumSha256,
    });
  }
  if (cellReleases.size === 0) fail("the committed inventory declares no cell releases.");
  return {
    releaseId: MIDTOWN_CORE_V3_PREDECESSOR_RELEASE_ID,
    publicRoot: { rootId: publicRoot.rootId, rootChecksumSha256: publicRoot.rootChecksumSha256 },
    snapshot: { snapshotId: `snapshot:${MIDTOWN_CORE_RELEASE_ID}:v1`, checksumSha256: snapshotFile.checksumSha256 },
    cellReleases,
  };
}

/**
 * Per-building V2 asset pins, keyed by canonical building id.
 *
 * A building the V2 wave never shipped simply has no entry: a successor pins the
 * predecessor it actually had, and inventing a pin for geometry that never
 * existed would be false lineage.
 */
export function midtownCoreV3PredecessorAssets(inventory: MidtownCoreV2PayloadInventory): Map<string, ImmutablePin> {
  const pins = new Map<string, ImmutablePin>();
  for (const file of inventory.files) {
    const match = V2_ASSET_PATTERN.exec(file.path);
    if (!match) continue;
    const buildingId = match[1]!.replace("doitt-", "doitt:");
    pins.set(buildingId, {
      id: `${MIDTOWN_CORE_RELEASE_ID}:${buildingId}:${MIDTOWN_CORE_SHIPPED_LOD_ID}`,
      checksumSha256: file.checksumSha256,
    });
  }
  return pins;
}

/** The cell-release ids this successor emits, for evidence and drift records. */
export function midtownCoreV3CellReleaseId(cellId: string): string {
  return midtownCoreCellReleaseId(cellId, MIDTOWN_CORE_V3_RELEASE_ID);
}

export const MIDTOWN_CORE_V3_CELL_RELEASE_VERSION = MIDTOWN_CORE_CELL_RELEASE_VERSION;

/**
 * The V3 profile. Everything the emitter needs that differs from V2 is here and
 * nowhere else, so "the V2 path is unchanged" is checkable by reading.
 */
export function midtownCoreV3Profile(predecessor: MidtownCoreReleasePredecessor | null): MidtownCoreReleaseProfile {
  return {
    releaseId: MIDTOWN_CORE_V3_RELEASE_ID,
    generatedAt: MIDTOWN_CORE_V3_GENERATED_AT,
    approval: MIDTOWN_CORE_V3_APPROVAL,
    budgets: { ...V3_QUALITY_BUDGETS },
    inventoryId: midtownCoreV3InventoryId,
    evidenceShardId: midtownCoreV3EvidenceShardId,
    predecessor,
  };
}
