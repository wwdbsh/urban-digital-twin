/**
 * Midtown-core exterior canary package `manhattan-midtown-core-cells-20260811`.
 *
 * This module owns the *identity* of wave `w01` (`midtown-core`) of the
 * committed exterior wave ledger `manhattan-exterior-wave-ledger-20260804`.
 *
 * The derivation itself now lives in `exterior-wave-subset.ts`, which was
 * EXTRACTED from this file when wave `w02` needed the same construction. This
 * module keeps every name it exported and every value it derived: the two hash
 * domains below are the exact strings this wave has always used, the excluded
 * wave set is still wave 0 alone, and the derivation record is still built in
 * the same key order. `midtown-core-package.test.ts` re-derives the COMMITTED
 * `data/midtown-core-20260811-v3/derivation.json` record — ledger id, base
 * identity set id, exclusions and all 149 order mappings — from the committed
 * parent ledger, so this extraction is proven byte-neutral rather than asserted
 * to be.
 *
 * See `exterior-wave-subset.ts` for why a wave ships a derived subset rather
 * than the full 883-cell wave ledger.
 */

import type { ExteriorOwnershipCell, ExteriorOwnershipLedger, Wgs84Bounds } from "./exterior-release.ts";
import {
  EXTERIOR_WAVE_SUBSET_PARENT_LEDGER_RELEASE_ID,
  buildExteriorWaveSubsetLedger,
  deriveExteriorWaveBaseIdentitySetId,
  deriveExteriorWaveSubsetLedgerId,
  exteriorWaveArtifactChecksum,
  reconcileExteriorWaveSubsetAgainstDigest,
  serializeExteriorWaveArtifact,
  validateExteriorWaveSubsetLedger,
  type ExteriorWaveDerivationRecord,
  type ExteriorWaveDigestCell,
  type ExteriorWaveOrderMapping,
  type ExteriorWaveReconciliationFinding,
  type ExteriorWaveReconciliationReport,
  type ExteriorWaveSubset,
  type ExteriorWaveSubsetIdentity,
  type ExteriorWaveSubsetInput,
} from "./exterior-wave-subset.ts";

// ---------------------------------------------------------------------------
// Declared identity of the materialized wave
// ---------------------------------------------------------------------------

export const MIDTOWN_CORE_RELEASE_ID = "manhattan-midtown-core-cells-20260811" as const;
export const MIDTOWN_CORE_WAVE_INDEX = 1 as const;
export const MIDTOWN_CORE_WAVE_ID = "midtown-core" as const;

/** Declared shape of wave `w01`, asserted against the committed ledger. */
export const MIDTOWN_CORE_CELL_COUNT = 149 as const;
export const MIDTOWN_CORE_BUILDING_COUNT = 7_201 as const;

/** Parent artifact this subset is derived from; never mutated by this module. */
export const MIDTOWN_CORE_PARENT_LEDGER_RELEASE_ID = EXTERIOR_WAVE_SUBSET_PARENT_LEDGER_RELEASE_ID;

/**
 * This wave's own hash domains. Frozen strings: they are inputs to the committed
 * ledger id `ownership-ledger:manhattan-midtown-core-cells-20260811:aad83fe4a9350353`
 * and to the committed base identity set id, so neither may ever be edited, and
 * no other wave may borrow them.
 */
const SUBSET_LEDGER_ID_DOMAIN = "udt.midtown-core.subset-ledger-id.v1" as const;
const SUBSET_BASE_IDENTITY_DOMAIN = "udt.midtown-core.subset-base-identity.v1" as const;

/**
 * Wave `w01`'s subset identity.
 *
 * `exclusionWaveIndexes` is wave 0 alone, exactly as this module has always
 * computed it: the Block 835 cell is the only other partition that existed when
 * this wave was derived, and widening the set now would move the committed
 * derivation record's `exclusions` array.
 */
export const MIDTOWN_CORE_SUBSET_IDENTITY: ExteriorWaveSubsetIdentity = {
  releaseId: MIDTOWN_CORE_RELEASE_ID,
  waveIndex: MIDTOWN_CORE_WAVE_INDEX,
  waveId: MIDTOWN_CORE_WAVE_ID,
  cellCount: MIDTOWN_CORE_CELL_COUNT,
  buildingCount: MIDTOWN_CORE_BUILDING_COUNT,
  ledgerIdDomain: SUBSET_LEDGER_ID_DOMAIN,
  baseIdentityDomain: SUBSET_BASE_IDENTITY_DOMAIN,
  exclusionWaveIndexes: [0],
};

// ---------------------------------------------------------------------------
// Names this wave has always exported, now aliased onto the generic core
// ---------------------------------------------------------------------------

export type MidtownCoreOrderMapping = ExteriorWaveOrderMapping;
export type MidtownCoreDerivationRecord = ExteriorWaveDerivationRecord;
export type MidtownCoreSubsetInput = ExteriorWaveSubsetInput;
export type MidtownCoreSubset = ExteriorWaveSubset;
export type MidtownCoreDigestCell = ExteriorWaveDigestCell;
export type MidtownCoreReconciliationFinding = ExteriorWaveReconciliationFinding;
export type MidtownCoreReconciliationReport = ExteriorWaveReconciliationReport;

export function deriveMidtownCoreBaseIdentitySetId(input: {
  baseReleaseId: string;
  baseManifestChecksumSha256: string;
  waveId: string;
  buildingCount: number;
  membershipChecksumSha256: string;
}): string {
  return deriveExteriorWaveBaseIdentitySetId(MIDTOWN_CORE_SUBSET_IDENTITY, input);
}

export function deriveMidtownCoreLedgerId(input: {
  parentLedgerId: string;
  parentLedgerChecksumSha256: string;
  baseIdentitySetId: string;
  cityId: string;
  configId: string;
  coverage: Wgs84Bounds;
  cells: readonly ExteriorOwnershipCell[];
}): string {
  return deriveExteriorWaveSubsetLedgerId(MIDTOWN_CORE_SUBSET_IDENTITY, input);
}

/** Builds the derived-subset ownership ledger for wave `w01`. */
export function buildMidtownCoreSubsetLedger(input: MidtownCoreSubsetInput): MidtownCoreSubset {
  return buildExteriorWaveSubsetLedger(MIDTOWN_CORE_SUBSET_IDENTITY, input);
}

/** Reconciles the derived subset against the committed `membership-digest.json`. */
export function reconcileMidtownCoreAgainstDigest(
  subset: MidtownCoreSubset,
  digest: { ledgerId: string; ledgerChecksumSha256: string; cells: readonly MidtownCoreDigestCell[] },
): MidtownCoreReconciliationReport {
  return reconcileExteriorWaveSubsetAgainstDigest(MIDTOWN_CORE_SUBSET_IDENTITY, subset, digest);
}

export function validateMidtownCoreSubsetLedger(ledger: ExteriorOwnershipLedger): { ok: boolean; issues: { path: string; message: string }[] } {
  return validateExteriorWaveSubsetLedger(ledger);
}

/** Canonical serialization used for every committed midtown-core JSON artifact. */
export function serializeMidtownCoreArtifact(value: unknown): string {
  return serializeExteriorWaveArtifact(value);
}

export function midtownCoreArtifactChecksum(value: unknown): string {
  return exteriorWaveArtifactChecksum(value);
}
