/**
 * Central-and-upper-Manhattan exterior canary package
 * `manhattan-central-upper-manhattan-cells-20260812`.
 *
 * The identity of wave `w04` (`central-upper-manhattan`) of the committed
 * exterior wave ledger `manhattan-exterior-wave-ledger-20260804`: 249 ownership
 * cells and 11,721 canonical buildings of the pinned
 * `manhattan-citywide-20260804` base. It is the LARGEST wave of the six — more
 * cells and more buildings than any wave materialized so far — and nothing about
 * that changes how it is derived.
 *
 * The derivation itself is `exterior-wave-subset.ts`, shared with waves `w01`,
 * `w02` and `w03`. This module supplies only what is this wave's own — its
 * release id, its two hash domains, its declared shape, and the set of
 * predecessor waves it must be proven disjoint from.
 *
 * Why the excluded set is all FOUR earlier waves: wave `w03` excluded waves 0, 1
 * and 2 because those were the three that had been promoted when it was derived.
 * Wave `w03` has since been promoted as well, through its `-p1` successor, and
 * the App shares ONE exterior cache across every promoted wave. A building owned
 * by two releases would be an ownership contradiction AND a cache-identity
 * hazard, so naming waves 0, 1, 2 and 3 makes disjointness from every promoted
 * partition a derived fact recorded in the derivation record rather than an
 * assumption. The exclusion is over the PARENT ledger's wave-3 cells, which are
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

export const CENTRAL_UPPER_MANHATTAN_RELEASE_ID = "manhattan-central-upper-manhattan-cells-20260812" as const;
export const CENTRAL_UPPER_MANHATTAN_WAVE_INDEX = 4 as const;
export const CENTRAL_UPPER_MANHATTAN_WAVE_ID = "central-upper-manhattan" as const;

/**
 * Declared shape of wave `w04`, asserted against the committed ledger.
 *
 * Both numbers are the committed `membership-digest.json`'s own statement for
 * `waveIndex: 4`, not a target: the subset builder refuses to produce a ledger
 * that enumerates any other count.
 */
export const CENTRAL_UPPER_MANHATTAN_CELL_COUNT = 249 as const;
export const CENTRAL_UPPER_MANHATTAN_BUILDING_COUNT = 11_721 as const;

/**
 * This wave's own hash domains.
 *
 * They exist so wave `w04`'s ledger id and base-identity-set id can never
 * collide with wave `w01`'s, `w02`'s or `w03`'s, even for an identical partition
 * shape. The strings follow the `udt.<wave-slug>.*` scheme and the slug is the
 * ledger's own `waveId`, so the domain a wave issues is derivable from the
 * artifact that defines it rather than invented beside it.
 */
const SUBSET_LEDGER_ID_DOMAIN = "udt.central-upper-manhattan.subset-ledger-id.v1" as const;
const SUBSET_BASE_IDENTITY_DOMAIN = "udt.central-upper-manhattan.subset-base-identity.v1" as const;

export const CENTRAL_UPPER_MANHATTAN_SUBSET_IDENTITY: ExteriorWaveSubsetIdentity = {
  releaseId: CENTRAL_UPPER_MANHATTAN_RELEASE_ID,
  waveIndex: CENTRAL_UPPER_MANHATTAN_WAVE_INDEX,
  waveId: CENTRAL_UPPER_MANHATTAN_WAVE_ID,
  cellCount: CENTRAL_UPPER_MANHATTAN_CELL_COUNT,
  buildingCount: CENTRAL_UPPER_MANHATTAN_BUILDING_COUNT,
  ledgerIdDomain: SUBSET_LEDGER_ID_DOMAIN,
  baseIdentityDomain: SUBSET_BASE_IDENTITY_DOMAIN,
  exclusionWaveIndexes: [0, 1, 2, 3],
};

export function buildCentralUpperManhattanSubsetLedger(input: ExteriorWaveSubsetInput): ExteriorWaveSubset {
  return buildExteriorWaveSubsetLedger(CENTRAL_UPPER_MANHATTAN_SUBSET_IDENTITY, input);
}

export function reconcileCentralUpperManhattanAgainstDigest(
  subset: ExteriorWaveSubset,
  digest: { ledgerId: string; ledgerChecksumSha256: string; cells: readonly ExteriorWaveDigestCell[] },
): ExteriorWaveReconciliationReport {
  return reconcileExteriorWaveSubsetAgainstDigest(CENTRAL_UPPER_MANHATTAN_SUBSET_IDENTITY, subset, digest);
}

export function validateCentralUpperManhattanSubsetLedger(ledger: ExteriorOwnershipLedger): { ok: boolean; issues: { path: string; message: string }[] } {
  return validateExteriorWaveSubsetLedger(ledger);
}
