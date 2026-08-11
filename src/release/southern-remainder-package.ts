/**
 * Southern-remainder exterior canary package `manhattan-southern-remainder-cells-20260812`.
 *
 * The identity of wave `w03` (`southern-remainder`) of the committed exterior
 * wave ledger `manhattan-exterior-wave-ledger-20260804`: 176 ownership cells and
 * 9,603 canonical buildings of the pinned `manhattan-citywide-20260804` base.
 *
 * The derivation itself is `exterior-wave-subset.ts`, shared with waves `w01`
 * and `w02`. This module supplies only what is this wave's own — its release id,
 * its two hash domains, its declared shape, and the set of predecessor waves it
 * must be proven disjoint from.
 *
 * Why the excluded set is all THREE earlier waves: wave `w02` excluded waves 0
 * and 1 because those were the two that had been promoted when it was derived.
 * Wave `w02` has since been promoted as well, through its `-p1` successor, and
 * the App shares ONE exterior cache across every promoted wave. A building owned
 * by two releases would be an ownership contradiction AND a cache-identity
 * hazard, so naming waves 0, 1 and 2 makes disjointness from every promoted
 * partition a derived fact recorded in the derivation record rather than an
 * assumption. The exclusion is over the PARENT ledger's wave-2 cells, which are
 * the same buildings the `-p1` successor owns — the successor changed which
 * cells retain bytes, never which buildings the wave owns.
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

export const SOUTHERN_REMAINDER_RELEASE_ID = "manhattan-southern-remainder-cells-20260812" as const;
export const SOUTHERN_REMAINDER_WAVE_INDEX = 3 as const;
export const SOUTHERN_REMAINDER_WAVE_ID = "southern-remainder" as const;

/**
 * Declared shape of wave `w03`, asserted against the committed ledger.
 *
 * Both numbers are the committed `membership-digest.json`'s own statement for
 * `waveIndex: 3`, not a target: the subset builder refuses to produce a ledger
 * that enumerates any other count.
 */
export const SOUTHERN_REMAINDER_CELL_COUNT = 176 as const;
export const SOUTHERN_REMAINDER_BUILDING_COUNT = 9_603 as const;

/**
 * This wave's own hash domains.
 *
 * They exist so wave `w03`'s ledger id and base-identity-set id can never
 * collide with wave `w01`'s or `w02`'s, even for an identical partition shape.
 * The strings follow the `udt.<wave-slug>.*` scheme and the slug is the ledger's
 * own `waveId`, so the domain a wave issues is derivable from the artifact that
 * defines it rather than invented beside it.
 */
const SUBSET_LEDGER_ID_DOMAIN = "udt.southern-remainder.subset-ledger-id.v1" as const;
const SUBSET_BASE_IDENTITY_DOMAIN = "udt.southern-remainder.subset-base-identity.v1" as const;

export const SOUTHERN_REMAINDER_SUBSET_IDENTITY: ExteriorWaveSubsetIdentity = {
  releaseId: SOUTHERN_REMAINDER_RELEASE_ID,
  waveIndex: SOUTHERN_REMAINDER_WAVE_INDEX,
  waveId: SOUTHERN_REMAINDER_WAVE_ID,
  cellCount: SOUTHERN_REMAINDER_CELL_COUNT,
  buildingCount: SOUTHERN_REMAINDER_BUILDING_COUNT,
  ledgerIdDomain: SUBSET_LEDGER_ID_DOMAIN,
  baseIdentityDomain: SUBSET_BASE_IDENTITY_DOMAIN,
  exclusionWaveIndexes: [0, 1, 2],
};

export function buildSouthernRemainderSubsetLedger(input: ExteriorWaveSubsetInput): ExteriorWaveSubset {
  return buildExteriorWaveSubsetLedger(SOUTHERN_REMAINDER_SUBSET_IDENTITY, input);
}

export function reconcileSouthernRemainderAgainstDigest(
  subset: ExteriorWaveSubset,
  digest: { ledgerId: string; ledgerChecksumSha256: string; cells: readonly ExteriorWaveDigestCell[] },
): ExteriorWaveReconciliationReport {
  return reconcileExteriorWaveSubsetAgainstDigest(SOUTHERN_REMAINDER_SUBSET_IDENTITY, subset, digest);
}

export function validateSouthernRemainderSubsetLedger(ledger: ExteriorOwnershipLedger): { ok: boolean; issues: { path: string; message: string }[] } {
  return validateExteriorWaveSubsetLedger(ledger);
}
