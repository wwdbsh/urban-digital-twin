/**
 * Northern-Manhattan exterior canary package
 * `manhattan-northern-manhattan-cells-20260812`.
 *
 * The identity of wave `w05` (`northern-manhattan`) of the committed exterior
 * wave ledger `manhattan-exterior-wave-ledger-20260804`: 182 ownership cells and
 * 10,230 canonical buildings of the pinned `manhattan-citywide-20260804` base.
 *
 * IT IS THE LAST WAVE. The committed ledger declares exactly six waves, `w00`
 * through `w05`, and this is `w05`. Every earlier wave has been materialized and
 * promoted, so with this module the ledger's partition is fully covered by
 * releases for the first time. That is a fact about coverage and about nothing
 * else: it does not make this wave larger, safer, or better evidenced than its
 * predecessors, and no gate is relaxed because it is the last.
 *
 * The derivation itself is `exterior-wave-subset.ts`, shared with waves `w01`,
 * `w02`, `w03` and `w04`. This module supplies only what is this wave's own — its
 * release id, its two hash domains, its declared shape, and the set of
 * predecessor waves it must be proven disjoint from.
 *
 * Why the excluded set is all FIVE earlier waves: every one of them is now
 * PROMOTED, and the App shares ONE exterior cache across every promoted wave. A
 * building owned by two releases would be an ownership contradiction AND a
 * cache-identity hazard, so naming waves 0, 1, 2, 3 and 4 makes disjointness from
 * every promoted partition a derived fact recorded in the derivation record
 * rather than an assumption. Waves 2, 3 and 4 are excluded over the PARENT
 * ledger's cells, which are the same buildings their `-p1` successors own: a
 * successor changed which cells retain bytes, never which buildings the wave owns.
 *
 * This is also the first wave module whose exclusion list can be complete rather
 * than merely current. There is no sixth wave to leave out.
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

export const NORTHERN_MANHATTAN_RELEASE_ID = "manhattan-northern-manhattan-cells-20260812" as const;
export const NORTHERN_MANHATTAN_WAVE_INDEX = 5 as const;
export const NORTHERN_MANHATTAN_WAVE_ID = "northern-manhattan" as const;

/**
 * Declared shape of wave `w05`, asserted against the committed ledger.
 *
 * Both numbers are the committed `membership-digest.json`'s own statement for
 * `waveIndex: 5`, not a target: the subset builder refuses to produce a ledger
 * that enumerates any other count.
 */
export const NORTHERN_MANHATTAN_CELL_COUNT = 182 as const;
export const NORTHERN_MANHATTAN_BUILDING_COUNT = 10_230 as const;

/**
 * This wave's own hash domains.
 *
 * They exist so wave `w05`'s ledger id and base-identity-set id can never collide
 * with any earlier wave's, even for an identical partition shape. The strings
 * follow the `udt.<wave-slug>.*` scheme and the slug is the ledger's own `waveId`,
 * so the domain a wave issues is derivable from the artifact that defines it
 * rather than invented beside it.
 *
 * These two strings were the registry's standing EXAMPLE of a fresh, unowned
 * domain: every earlier wave's borrow test used `udt.northern-manhattan.*` as the
 * string that collided with nothing. Registering them here is what ends that, and
 * `exterior-wave-subset.test.ts` had to stop using them as examples in the same
 * change.
 */
const SUBSET_LEDGER_ID_DOMAIN = "udt.northern-manhattan.subset-ledger-id.v1" as const;
const SUBSET_BASE_IDENTITY_DOMAIN = "udt.northern-manhattan.subset-base-identity.v1" as const;

export const NORTHERN_MANHATTAN_SUBSET_IDENTITY: ExteriorWaveSubsetIdentity = {
  releaseId: NORTHERN_MANHATTAN_RELEASE_ID,
  waveIndex: NORTHERN_MANHATTAN_WAVE_INDEX,
  waveId: NORTHERN_MANHATTAN_WAVE_ID,
  cellCount: NORTHERN_MANHATTAN_CELL_COUNT,
  buildingCount: NORTHERN_MANHATTAN_BUILDING_COUNT,
  ledgerIdDomain: SUBSET_LEDGER_ID_DOMAIN,
  baseIdentityDomain: SUBSET_BASE_IDENTITY_DOMAIN,
  exclusionWaveIndexes: [0, 1, 2, 3, 4],
};

export function buildNorthernManhattanSubsetLedger(input: ExteriorWaveSubsetInput): ExteriorWaveSubset {
  return buildExteriorWaveSubsetLedger(NORTHERN_MANHATTAN_SUBSET_IDENTITY, input);
}

export function reconcileNorthernManhattanAgainstDigest(
  subset: ExteriorWaveSubset,
  digest: { ledgerId: string; ledgerChecksumSha256: string; cells: readonly ExteriorWaveDigestCell[] },
): ExteriorWaveReconciliationReport {
  return reconcileExteriorWaveSubsetAgainstDigest(NORTHERN_MANHATTAN_SUBSET_IDENTITY, subset, digest);
}

export function validateNorthernManhattanSubsetLedger(ledger: ExteriorOwnershipLedger): { ok: boolean; issues: { path: string; message: string }[] } {
  return validateExteriorWaveSubsetLedger(ledger);
}
