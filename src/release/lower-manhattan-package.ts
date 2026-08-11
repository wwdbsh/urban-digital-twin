/**
 * Lower-Manhattan exterior canary package `manhattan-lower-manhattan-cells-20260812`.
 *
 * The identity of wave `w02` (`lower-manhattan`) of the committed exterior wave
 * ledger `manhattan-exterior-wave-ledger-20260804`: 126 ownership cells and
 * 6,425 canonical buildings of the pinned `manhattan-citywide-20260804` base.
 *
 * The derivation itself is `exterior-wave-subset.ts`, shared with wave `w01`.
 * This module supplies only what is this wave's own — its release id, its two
 * hash domains, its declared shape, and the set of predecessor waves it must be
 * proven disjoint from.
 *
 * Why the excluded set is BOTH earlier waves, where `w01` excluded only wave 0:
 * wave `w01` was derived when the Block 835 cell was the only other partition
 * that existed. Two waves are promoted now, and the App shares ONE exterior
 * cache across every promoted wave, so a building owned by two releases would be
 * an ownership contradiction AND a cache-identity hazard. Naming waves 0 and 1
 * makes the disjointness a derived fact recorded in the derivation record rather
 * than an assumption.
 */

import type { ExteriorOwnershipLedger } from "./exterior-release.ts";
import {
  buildExteriorWaveSubsetLedger,
  reconcileExteriorWaveSubsetAgainstDigest,
  validateExteriorWaveSubsetLedger,
  type ExteriorWaveDigestCell,
  type ExteriorWaveReconciliationReport,
  type ExteriorWaveSubset,
  type ExteriorWaveSubsetIdentity,
  type ExteriorWaveSubsetInput,
} from "./exterior-wave-subset.ts";

export const LOWER_MANHATTAN_RELEASE_ID = "manhattan-lower-manhattan-cells-20260812" as const;
export const LOWER_MANHATTAN_WAVE_INDEX = 2 as const;
export const LOWER_MANHATTAN_WAVE_ID = "lower-manhattan" as const;

/**
 * Declared shape of wave `w02`, asserted against the committed ledger.
 *
 * Both numbers are the committed `membership-digest.json`'s own statement for
 * `waveIndex: 2`, not a target: the subset builder refuses to produce a ledger
 * that enumerates any other count.
 */
export const LOWER_MANHATTAN_CELL_COUNT = 126 as const;
export const LOWER_MANHATTAN_BUILDING_COUNT = 6_425 as const;

/**
 * This wave's own hash domains.
 *
 * They exist so wave `w02`'s ledger id and base-identity-set id can never
 * collide with wave `w01`'s, even for an identical partition shape. Borrowing
 * `udt.midtown-core.*` here would defeat the separation entirely.
 */
const SUBSET_LEDGER_ID_DOMAIN = "udt.lower-manhattan.subset-ledger-id.v1" as const;
const SUBSET_BASE_IDENTITY_DOMAIN = "udt.lower-manhattan.subset-base-identity.v1" as const;

export const LOWER_MANHATTAN_SUBSET_IDENTITY: ExteriorWaveSubsetIdentity = {
  releaseId: LOWER_MANHATTAN_RELEASE_ID,
  waveIndex: LOWER_MANHATTAN_WAVE_INDEX,
  waveId: LOWER_MANHATTAN_WAVE_ID,
  cellCount: LOWER_MANHATTAN_CELL_COUNT,
  buildingCount: LOWER_MANHATTAN_BUILDING_COUNT,
  ledgerIdDomain: SUBSET_LEDGER_ID_DOMAIN,
  baseIdentityDomain: SUBSET_BASE_IDENTITY_DOMAIN,
  exclusionWaveIndexes: [0, 1],
};

export function buildLowerManhattanSubsetLedger(input: ExteriorWaveSubsetInput): ExteriorWaveSubset {
  return buildExteriorWaveSubsetLedger(LOWER_MANHATTAN_SUBSET_IDENTITY, input);
}

export function reconcileLowerManhattanAgainstDigest(
  subset: ExteriorWaveSubset,
  digest: { ledgerId: string; ledgerChecksumSha256: string; cells: readonly ExteriorWaveDigestCell[] },
): ExteriorWaveReconciliationReport {
  return reconcileExteriorWaveSubsetAgainstDigest(LOWER_MANHATTAN_SUBSET_IDENTITY, subset, digest);
}

export function validateLowerManhattanSubsetLedger(ledger: ExteriorOwnershipLedger): { ok: boolean; issues: { path: string; message: string }[] } {
  return validateExteriorWaveSubsetLedger(ledger);
}
