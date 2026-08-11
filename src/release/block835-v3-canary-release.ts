/**
 * Identity of the Block 835 **V3 successor** public exterior-cell release
 * `manhattan-exterior-cells-20260811-v3`.
 *
 * It is a sibling of `block835-canary-release.ts`, not a revision of it. That
 * module keeps the frozen V2 release `manhattan-exterior-cells-20260811` and
 * every byte of it; this module only supplies the second profile the emitter now
 * accepts. Nothing here edits, re-emits or supersedes the V2 directory.
 *
 * Why a whole second release rather than a new head inside the V2 one: the
 * promoted geometry changes, so its snapshot, cell release, ownership ledger and
 * every asset checksum change with it. An immutable release cannot carry two
 * mutually exclusive versions of its own cell, and the promotion record — not a
 * head selector — is what this build swaps.
 */

import type { ExteriorApprovalEvidence } from "../domain/exterior-contract.ts";
import {
  BLOCK835_CANARY_BASE_RELEASE_IDS,
  block835CanaryApprovalOf,
  block835CanaryReleaseIds,
  block835CanaryV3Profile,
  type Block835CanaryReleaseProfile,
} from "./block835-canary-release.ts";
import {
  BLOCK835_V3_BASE_IDENTITY_SET_ID,
  BLOCK835_V3_GENERATED_AT,
  BLOCK835_V3_PACKAGE_ID,
} from "./block835-v3-package.ts";

export const BLOCK835_V3_CANARY_RELEASE_ID = "manhattan-exterior-cells-20260811-v3" as const;
export const BLOCK835_V3_CANARY_GENERATED_AT = BLOCK835_V3_GENERATED_AT;
export const BLOCK835_V3_CANARY_APPROVED_AT = "2026-08-11T00:00:00.000Z" as const;
export const BLOCK835_V3_CANARY_IDS = block835CanaryReleaseIds(BLOCK835_V3_CANARY_RELEASE_ID);
/** The V2 public release this one succeeds. It is pinned, never edited. */
export const BLOCK835_V3_CANARY_PREDECESSOR_RELEASE_ID = "manhattan-exterior-cells-20260811" as const;

export const BLOCK835_V3_CANARY_APPROVAL_SCOPE =
  "Public-audience successor exterior-cell release manhattan-exterior-cells-20260811-v3, promoting the private footprint-faithful V3 generated-exterior package for Manhattan Block 835 (config manhattan-esb-block-835) in place of the V2 release manhattan-exterior-cells-20260811. It covers local-only delivery, public display, derivative conveyance, and redistribution of deterministically generated, TEXTURE-FREE exterior geometry derived from NYC OTI Building Footprints (jh45-qr5r), with NYC OTI attribution, the City modified-data disclaimer, source IDs, capture timestamps, checksums, CRS, and height uncertainty retained." as const;

/**
 * Everything this approval deliberately does not authorize.
 *
 * The V2 exclusions are carried verbatim and two are added. Runtime textures
 * stay excluded because this release ships none: V3 designs appearance with
 * per-primitive materials and samples no imagery, and the separately gated
 * textured package is not what is promoted here. Real-world material accuracy
 * stays excluded because the one cited facade fact this lineage admits selects a
 * designed STYLE CLASS and never claims the shipped surface reproduces the real
 * one.
 */
export const BLOCK835_V3_CANARY_APPROVAL_EXCLUSIONS: readonly string[] = [
  "public deployment",
  "redistribution of the raw jh45-qr5r source dataset",
  "runtime external network requests",
  "private-audience bytes in any browser-reachable root",
  "real-world facade, tenant, brand, signage, or survey-grade accuracy claims",
  "runtime textures of any kind, procedural or captured",
  "any claim that a designed style class reproduces a real building's material",
];

export const BLOCK835_V3_CANARY_APPROVAL_NOTE =
  "In-session user authorization dated 2026-08-11 broadened the NYC OTI Building Footprints (jh45-qr5r) envelope so exterior geometry generated from those footprints may additionally be publicly displayed, conveyed as a derivative, and redistributed, provided NYC OTI attribution, the City modified-data disclaimer, source IDs, capture timestamp, checksum, CRS, and height uncertainty travel with it. The broadened envelope covers that generated geometry only, never the raw jh45-qr5r source dataset, and public deployment remains excluded. This successor release promotes the V3 footprint-faithful grammar under that same envelope and adds no source: the V3 massing follows the same sourced polygon and height, at higher fidelity, and remains texture-free." as const;

export const BLOCK835_V3_CANARY_APPROVAL: ExteriorApprovalEvidence = block835CanaryApprovalOf({
  id: BLOCK835_V3_CANARY_IDS.approvalId,
  scope: BLOCK835_V3_CANARY_APPROVAL_SCOPE,
  exclusions: BLOCK835_V3_CANARY_APPROVAL_EXCLUSIONS,
  approvedAt: BLOCK835_V3_CANARY_APPROVED_AT,
  approvalNote: BLOCK835_V3_CANARY_APPROVAL_NOTE,
});

/** The base releases the running app loads underneath this exterior release. */
export const BLOCK835_V3_CANARY_BASE_RELEASE_IDS = BLOCK835_CANARY_BASE_RELEASE_IDS;

/** The private input package this release promotes. */
export const BLOCK835_V3_CANARY_INPUT_PACKAGE_ID: string = BLOCK835_V3_PACKAGE_ID;

export const BLOCK835_V3_CANARY_PROFILE: Block835CanaryReleaseProfile = block835CanaryV3Profile({
  releaseId: BLOCK835_V3_CANARY_RELEASE_ID,
  inputPackageId: BLOCK835_V3_CANARY_INPUT_PACKAGE_ID,
  baseIdentitySetId: BLOCK835_V3_BASE_IDENTITY_SET_ID,
  generatedAt: BLOCK835_V3_CANARY_GENERATED_AT,
  approval: BLOCK835_V3_CANARY_APPROVAL,
});
