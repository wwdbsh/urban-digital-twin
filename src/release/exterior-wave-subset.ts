/**
 * Wave-generic derived-subset ownership ledgers.
 *
 * This module is the parameterized core that `midtown-core-package.ts` (wave
 * `w01`) and `lower-manhattan-package.ts` (wave `w02`) both call. It was
 * EXTRACTED from the midtown module rather than written beside it, so there is
 * exactly one derivation of a wave subset and a second wave cannot drift from
 * the first by copy-paste.
 *
 * Why a derived subset rather than the full wave ledger
 * -----------------------------------------------------
 * `validateExteriorReleaseGraph` requires a release's ownership ledger to
 * enumerate *exactly* the buildings that release owns, with contiguous cell
 * orders `0..n-1` and a `baseIdentitySet.checksumSha256` taken over exactly that
 * membership. The full 883-cell / 45,194-building wave ledger therefore cannot
 * be the ledger of a 149-cell or 126-cell release: its orders start at the
 * Block 835 cell and its base identity set covers the whole city.
 *
 * So this module re-derives a ledger that owns only the selected wave's cells:
 *
 *   - stable cell ids are preserved verbatim, so the committed
 *     `membership-digest.json` still reconciles against this subset;
 *   - cell orders are renumbered contiguously `0..n-1`, preserving the parent's
 *     visual priority (lexicographic cell-id order equals parent order order,
 *     which this module asserts rather than assumes);
 *   - `coverage` is recomputed as the exact union rectangle of the wave's cells;
 *   - a NEW `baseIdentitySet` is derived over exactly the owned canonical ids.
 *
 * Deliberate scope note: the subset is validated by
 * `validateExteriorReleaseGraph`, NOT by `validateExteriorWaveLedger`. The wave
 * validator additionally requires that a cell id's embedded sequence equals its
 * `order` and that exactly one Block 835 (wave 0) cell is present. Both are
 * properties of the *parent* full-city partition and are intentionally not
 * properties of a single-wave derived subset: renumbering to `0..n-1` is
 * mandated by the release-graph contract, and the wave-0 cell is excluded by
 * design. Preserving the parent cell ids while renumbering orders is what lets
 * both artifacts stay true at once.
 *
 * Parent provenance is NOT carried inside the ledger: the release-graph schema
 * is closed (`exactKeys`), so an extra `derivedFrom` field would be rejected.
 * It is emitted beside the ledger as an `ExteriorWaveDerivationRecord`.
 *
 * PER-WAVE HASH DOMAINS ARE MANDATORY. Both derived ids are domain-separated,
 * and each wave supplies its OWN domain strings through
 * `ExteriorWaveSubsetIdentity`. Reusing another wave's domain would let two
 * different partitions collide in id space, so `assertDistinctWaveDomains`
 * refuses any identity that borrows a domain another wave has issued, and
 * `buildExteriorWaveSubsetLedger` calls it before it does anything else.
 */

import { domainSeparatedSha256, sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";
import type { ExteriorOwnershipCell, ExteriorOwnershipLedger, Wgs84Bounds } from "./exterior-release.ts";
import { validateExteriorReleaseGraph } from "./exterior-release.ts";
import {
  EXTERIOR_CELL_MAX_BUILDINGS,
  EXTERIOR_WAVE_LEDGER_CITY_ID,
  EXTERIOR_WAVE_LEDGER_CONFIG_ID,
  EXTERIOR_WAVE_LEDGER_RELEASE_ID,
  EXTERIOR_WAVE_PLAN,
  cellWaveIndex,
  membershipChecksum,
} from "./exterior-wave-ledger.ts";

/** Parent artifact every subset is derived from; never mutated by this module. */
export const EXTERIOR_WAVE_SUBSET_PARENT_LEDGER_RELEASE_ID = EXTERIOR_WAVE_LEDGER_RELEASE_ID;

/**
 * Everything that makes one wave's subset derivation different from another's.
 *
 * `ledgerIdDomain` and `baseIdentityDomain` are the domain-separation strings
 * for the two derived ids. They are per-wave by contract: a wave that reused
 * another wave's domain could derive a colliding id from a different partition.
 */
export interface ExteriorWaveSubsetIdentity {
  /** Release id the derived ledger id is namespaced under. */
  releaseId: string;
  waveIndex: number;
  waveId: string;
  /** Declared shape of the wave, asserted against the committed parent ledger. */
  cellCount: number;
  buildingCount: number;
  ledgerIdDomain: string;
  baseIdentityDomain: string;
  /**
   * Wave indexes whose parent cells must be proven to share no building with
   * this subset, so no two releases can ever own the same building.
   */
  exclusionWaveIndexes: readonly number[];
}

/**
 * Every domain string this repository has issued, and the wave that owns it.
 *
 * A closed table rather than a registry populated at import time: a guard whose
 * completeness depends on which modules happened to be imported would pass in
 * exactly the situation it exists to catch — a new wave module written in
 * isolation. Adding a wave means adding its row here, and the wave's own module
 * is checked against this table rather than trusted to agree with it.
 *
 * A domain that has ever been issued is never reused or reassigned, because both
 * derived ids of the waves that used it are committed.
 */
export const EXTERIOR_WAVE_DOMAIN_REGISTRY: readonly {
  waveId: string;
  ledgerIdDomain: string;
  baseIdentityDomain: string;
}[] = [
  {
    waveId: "midtown-core",
    ledgerIdDomain: "udt.midtown-core.subset-ledger-id.v1",
    baseIdentityDomain: "udt.midtown-core.subset-base-identity.v1",
  },
  {
    waveId: "lower-manhattan",
    ledgerIdDomain: "udt.lower-manhattan.subset-ledger-id.v1",
    baseIdentityDomain: "udt.lower-manhattan.subset-base-identity.v1",
  },
  {
    waveId: "southern-remainder",
    ledgerIdDomain: "udt.southern-remainder.subset-ledger-id.v1",
    baseIdentityDomain: "udt.southern-remainder.subset-base-identity.v1",
  },
  {
    waveId: "central-upper-manhattan",
    ledgerIdDomain: "udt.central-upper-manhattan.subset-ledger-id.v1",
    baseIdentityDomain: "udt.central-upper-manhattan.subset-base-identity.v1",
  },
  // The LAST row this table will ever gain from the committed wave ledger. That
  // ledger declares exactly six waves, `w00` through `w05`, and `w00` is Block 835
  // — which predates the wave-subset machinery and derives no subset id — so the
  // five rows above and this one are every wave that can issue a domain under it.
  //
  // "Closed table" now means closed in a second sense, and the distinction is
  // worth keeping: the guard is still open to any wave a FUTURE ledger might
  // declare, and would refuse it for having no row, exactly as it refuses one
  // today. What is complete is this ledger's coverage, not the mechanism.
  {
    waveId: "northern-manhattan",
    ledgerIdDomain: "udt.northern-manhattan.subset-ledger-id.v1",
    baseIdentityDomain: "udt.northern-manhattan.subset-base-identity.v1",
  },
];

/**
 * Refuses any identity whose domains collide with another wave's, or with each
 * other, or with what this wave itself has already committed to.
 *
 * Three distinct failures, because they fail for three different reasons:
 *
 *  - BORROWING. A wave using another wave's domain could derive a colliding
 *    ledger id from a genuinely different partition. The error names the wave
 *    that owns the string, so the fix is obvious rather than a puzzle.
 *  - SELF-COLLISION. One string used for both derived ids collapses the
 *    separation between them, so a ledger id and a base-identity id computed
 *    over equal payloads would be equal.
 *  - SILENT REASSIGNMENT. A registered wave that arrives with domains other than
 *    its registered ones has moved ids that are already committed. That is not a
 *    collision, it is a rewrite, and it fails just as hard.
 *  - UNREGISTERED. A wave with no row at all, whatever its domains. This is the
 *    case the closed table exists for and it was the one case the guard let
 *    through: a new wave module written in isolation, with perfectly fresh
 *    strings, collided with nothing and passed silently — so the table's
 *    completeness was enforced only by whoever remembered to add a row. It is
 *    checked LAST so that a module copied from another wave still reports the
 *    borrow, which names the wave to fix rather than merely the missing row.
 */
export function assertDistinctWaveDomains(identity: ExteriorWaveSubsetIdentity): void {
  if (identity.ledgerIdDomain === identity.baseIdentityDomain) {
    throw new Error(`Wave ${identity.waveId} uses one domain "${identity.ledgerIdDomain}" for both derived ids; the two must be separated.`);
  }
  let registeredHere = false;
  for (const registered of EXTERIOR_WAVE_DOMAIN_REGISTRY) {
    if (registered.waveId === identity.waveId) {
      registeredHere = true;
      if (registered.ledgerIdDomain !== identity.ledgerIdDomain || registered.baseIdentityDomain !== identity.baseIdentityDomain) {
        throw new Error(`Wave ${identity.waveId} supplies domains that differ from its registered ones; its committed ids were derived under the registered strings and must not move.`);
      }
      continue;
    }
    const owned = [registered.ledgerIdDomain, registered.baseIdentityDomain];
    for (const domain of [identity.ledgerIdDomain, identity.baseIdentityDomain]) {
      if (owned.includes(domain)) {
        throw new Error(`Wave ${identity.waveId} borrows hash domain "${domain}", which is issued to wave ${registered.waveId}; every wave must derive its ids under its own domains.`);
      }
    }
  }
  if (!registeredHere) {
    throw new Error(`Wave ${identity.waveId} is not in the closed domain registry; add its row to EXTERIOR_WAVE_DOMAIN_REGISTRY before deriving any id under "${identity.ledgerIdDomain}".`);
  }
}

export interface ExteriorWaveOrderMapping {
  cellId: string;
  /** Order this cell carries in the parent full-city wave ledger. */
  parentOrder: number;
  /** Contiguous order this cell carries in the derived subset. */
  order: number;
  buildingCount: number;
}

export interface ExteriorWaveDerivationRecord {
  schemaVersion: "1.0";
  subsetLedgerId: string;
  waveIndex: number;
  waveId: string;
  parent: {
    ledgerReleaseId: string;
    ledgerId: string;
    ledgerChecksumSha256: string;
    baseIdentitySetId: string;
    baseIdentitySetChecksumSha256: string;
    cellCount: number;
    buildingCount: number;
  };
  base: { releaseId: string; manifestChecksumSha256: string };
  subset: {
    cellCount: number;
    buildingCount: number;
    maxCellBuildings: number;
    maxObservedCellBuildings: number;
    coverage: Wgs84Bounds;
    baseIdentitySetId: string;
    baseIdentitySetChecksumSha256: string;
  };
  /**
   * Explicit statement that every excluded wave's cells share no building with
   * this subset, so a predecessor release and this one cannot both own a
   * building.
   */
  exclusions: { cellId: string; buildingCount: number; overlapWithSubset: number }[];
  orderMap: ExteriorWaveOrderMapping[];
}

export interface ExteriorWaveSubsetInput {
  /** The committed parent wave ledger, already parsed. */
  parentLedger: ExteriorOwnershipLedger;
  /** SHA-256 over the parent ledger's exact committed bytes. */
  parentLedgerChecksumSha256: string;
  baseReleaseId: string;
  baseManifestChecksumSha256: string;
}

export interface ExteriorWaveSubset {
  ledger: ExteriorOwnershipLedger;
  derivation: ExteriorWaveDerivationRecord;
  /** Canonical sorted ids of every building this release owns. */
  buildingIds: string[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function unionBounds(bounds: readonly Wgs84Bounds[], waveId: string): Wgs84Bounds {
  const first = bounds[0];
  if (!first) throw new Error(`Wave ${waveId} coverage requires at least one cell.`);
  return bounds.reduce<Wgs84Bounds>((accumulator, entry) => ({
    west: Math.min(accumulator.west, entry.west),
    south: Math.min(accumulator.south, entry.south),
    east: Math.max(accumulator.east, entry.east),
    north: Math.max(accumulator.north, entry.north),
  }), { ...first });
}

/**
 * Derives the subset base-identity-set id from the base lineage *and* the exact
 * subset membership, so it can never be confused with the full-city base
 * identity set the parent ledger pins.
 */
export function deriveExteriorWaveBaseIdentitySetId(
  identity: Pick<ExteriorWaveSubsetIdentity, "baseIdentityDomain">,
  input: {
    baseReleaseId: string;
    baseManifestChecksumSha256: string;
    waveId: string;
    buildingCount: number;
    membershipChecksumSha256: string;
  },
): string {
  const digest = domainSeparatedSha256(identity.baseIdentityDomain, {
    baseReleaseId: input.baseReleaseId,
    baseManifestChecksumSha256: input.baseManifestChecksumSha256,
    waveId: input.waveId,
    buildingCount: input.buildingCount,
    membershipChecksumSha256: input.membershipChecksumSha256,
  });
  return `${input.baseReleaseId}:exterior-base-identity:${input.waveId}:${digest.slice(0, 16)}`;
}

/**
 * Derives the subset ledger id from the parent lineage and the full renumbered
 * partition, so any change to the parent ledger or to this subset's layout
 * yields a different ledger id.
 */
export function deriveExteriorWaveSubsetLedgerId(
  identity: Pick<ExteriorWaveSubsetIdentity, "ledgerIdDomain" | "waveId" | "releaseId">,
  input: {
    parentLedgerId: string;
    parentLedgerChecksumSha256: string;
    baseIdentitySetId: string;
    cityId: string;
    configId: string;
    coverage: Wgs84Bounds;
    cells: readonly ExteriorOwnershipCell[];
  },
): string {
  const digest = domainSeparatedSha256(identity.ledgerIdDomain, {
    parentLedgerId: input.parentLedgerId,
    parentLedgerChecksumSha256: input.parentLedgerChecksumSha256,
    baseIdentitySetId: input.baseIdentitySetId,
    cityId: input.cityId,
    configId: input.configId,
    waveId: identity.waveId,
    coverage: input.coverage,
    cells: [...input.cells]
      .sort((left, right) => left.order - right.order)
      .map((cell) => ({ cellId: cell.cellId, order: cell.order, bounds: cell.bounds, membershipChecksumSha256: cell.membershipChecksumSha256 })),
  });
  return `ownership-ledger:${identity.releaseId}:${digest.slice(0, 16)}`;
}

/**
 * Builds the derived-subset ownership ledger for one wave.
 *
 * Fails closed on every shape the contract cannot describe: a wrong wave count,
 * an unsorted membership, a cell over the runtime cap, a priority order that
 * lexicographic cell-id sorting would not reproduce, or any overlap with an
 * excluded wave's cells.
 */
export function buildExteriorWaveSubsetLedger(
  identity: ExteriorWaveSubsetIdentity,
  input: ExteriorWaveSubsetInput,
): ExteriorWaveSubset {
  // Before anything else, and before a single byte is read: an identity that
  // borrows another wave's domain must never reach the point of deriving an id.
  assertDistinctWaveDomains(identity);
  const parent = input.parentLedger;
  // The whole validation boundary of this module rests on the *pairing* of the
  // supplied ledger with the supplied checksum: the subset inherits its cell
  // ids, bounds, and membership verbatim from a parent that its own committed
  // artifact (`ledger.sha256`) attests to. A caller-supplied checksum that does
  // not describe the supplied bytes would let an unattested partition through
  // and would propagate into the derived ledger id and the derivation record,
  // so it is recomputed here rather than trusted. `exteriorWaveArtifactChecksum`
  // is the serialization the committed `ledger.sha256` records, so this is the
  // same value the wave-ledger emitter published.
  const recomputedParentChecksum = exteriorWaveArtifactChecksum(parent);
  if (recomputedParentChecksum !== input.parentLedgerChecksumSha256) {
    throw new Error(`Parent ledger checksum ${input.parentLedgerChecksumSha256} does not describe the supplied parent ledger (recomputed ${recomputedParentChecksum}).`);
  }
  const wave = EXTERIOR_WAVE_PLAN[identity.waveIndex];
  if (!wave || wave.waveId !== identity.waveId) {
    throw new Error(`Wave index ${identity.waveIndex} is not ${identity.waveId} in the declared wave plan.`);
  }
  if (identity.exclusionWaveIndexes.includes(identity.waveIndex)) {
    throw new Error(`Wave ${identity.waveId} cannot exclude itself.`);
  }

  const selected = parent.cells.filter((cell) => cellWaveIndex(cell.cellId) === identity.waveIndex);
  if (selected.length !== identity.cellCount) {
    throw new Error(`Wave ${identity.waveId} holds ${selected.length} cells in the parent ledger, not the declared ${identity.cellCount}.`);
  }

  // Visual priority must survive renumbering. The accepted runtime sorts cell
  // ids lexicographically, so lexicographic order has to equal parent order
  // order; this is asserted, never assumed.
  const byParentOrder = [...selected].sort((left, right) => left.order - right.order);
  const lexicographic = [...selected].sort((left, right) => compareText(left.cellId, right.cellId));
  if (stableSerialize(byParentOrder.map((cell) => cell.cellId)) !== stableSerialize(lexicographic.map((cell) => cell.cellId))) {
    throw new Error("Lexicographic cell-id order does not equal parent priority order; renumbering would silently reorder the wave.");
  }

  const cells: ExteriorOwnershipCell[] = byParentOrder.map((cell, index) => {
    const buildingIds = [...cell.buildingIds];
    if (stableSerialize(buildingIds) !== stableSerialize([...buildingIds].sort(compareText))) {
      throw new Error(`Parent cell ${cell.cellId} does not record its membership in sorted order.`);
    }
    if (buildingIds.length === 0) throw new Error(`Parent cell ${cell.cellId} is empty.`);
    if (buildingIds.length > EXTERIOR_CELL_MAX_BUILDINGS) {
      throw new Error(`Parent cell ${cell.cellId} holds ${buildingIds.length} buildings, above the ${EXTERIOR_CELL_MAX_BUILDINGS}-building runtime cap.`);
    }
    // Re-derived, not copied: a stale parent checksum must not propagate.
    const recomputed = membershipChecksum(buildingIds);
    if (recomputed !== cell.membershipChecksumSha256) {
      throw new Error(`Parent cell ${cell.cellId} membership checksum does not match its own membership.`);
    }
    return { cellId: cell.cellId, order: index, bounds: { ...cell.bounds }, buildingIds, membershipChecksumSha256: recomputed };
  });

  const buildingIds = cells.flatMap((cell) => cell.buildingIds).sort(compareText);
  if (new Set(buildingIds).size !== buildingIds.length) {
    throw new Error(`A building is owned by more than one ${identity.waveId} cell.`);
  }
  if (buildingIds.length !== identity.buildingCount) {
    throw new Error(`Wave ${identity.waveId} enumerates ${buildingIds.length} buildings, not the declared ${identity.buildingCount}.`);
  }

  // Zero overlap with every excluded wave's cells, by design.
  const owned = new Set(buildingIds);
  const exclusions = parent.cells
    .filter((cell) => cellWaveIndex(cell.cellId) !== identity.waveIndex && identity.exclusionWaveIndexes.includes(cellWaveIndex(cell.cellId)))
    .map((cell) => ({
      cellId: cell.cellId,
      buildingCount: cell.buildingIds.length,
      overlapWithSubset: cell.buildingIds.filter((id) => owned.has(id)).length,
    }));
  for (const exclusion of exclusions) {
    if (exclusion.overlapWithSubset !== 0) {
      throw new Error(`Excluded cell ${exclusion.cellId} shares ${exclusion.overlapWithSubset} buildings with the ${identity.waveId} subset.`);
    }
  }

  const coverage = unionBounds(cells.map((cell) => cell.bounds), identity.waveId);
  const membershipChecksumSha256 = membershipChecksum(buildingIds);
  const baseIdentitySetId = deriveExteriorWaveBaseIdentitySetId(identity, {
    baseReleaseId: input.baseReleaseId,
    baseManifestChecksumSha256: input.baseManifestChecksumSha256,
    waveId: identity.waveId,
    buildingCount: buildingIds.length,
    membershipChecksumSha256,
  });
  if (baseIdentitySetId === parent.baseIdentitySet.id) {
    throw new Error("Subset base identity set must not alias the parent full-city base identity set.");
  }

  const ledgerId = deriveExteriorWaveSubsetLedgerId(identity, {
    parentLedgerId: parent.ledgerId,
    parentLedgerChecksumSha256: input.parentLedgerChecksumSha256,
    baseIdentitySetId,
    cityId: EXTERIOR_WAVE_LEDGER_CITY_ID,
    configId: EXTERIOR_WAVE_LEDGER_CONFIG_ID,
    coverage,
    cells,
  });

  const ledger: ExteriorOwnershipLedger = {
    schemaVersion: "1.0",
    ledgerId,
    // Wave-ledger vocabulary, not the Block 835 config: this release is one wave
    // of the provider-neutral Manhattan exterior configuration.
    cityId: EXTERIOR_WAVE_LEDGER_CITY_ID,
    configId: EXTERIOR_WAVE_LEDGER_CONFIG_ID,
    immutable: true,
    baseIdentitySet: { id: baseIdentitySetId, checksumSha256: membershipChecksumSha256, buildingCount: buildingIds.length },
    coverage,
    cells,
  };

  const derivation: ExteriorWaveDerivationRecord = {
    schemaVersion: "1.0",
    subsetLedgerId: ledgerId,
    waveIndex: identity.waveIndex,
    waveId: identity.waveId,
    parent: {
      ledgerReleaseId: EXTERIOR_WAVE_SUBSET_PARENT_LEDGER_RELEASE_ID,
      ledgerId: parent.ledgerId,
      ledgerChecksumSha256: input.parentLedgerChecksumSha256,
      baseIdentitySetId: parent.baseIdentitySet.id,
      baseIdentitySetChecksumSha256: parent.baseIdentitySet.checksumSha256,
      cellCount: parent.cells.length,
      buildingCount: parent.baseIdentitySet.buildingCount,
    },
    base: { releaseId: input.baseReleaseId, manifestChecksumSha256: input.baseManifestChecksumSha256 },
    subset: {
      cellCount: cells.length,
      buildingCount: buildingIds.length,
      maxCellBuildings: EXTERIOR_CELL_MAX_BUILDINGS,
      maxObservedCellBuildings: Math.max(...cells.map((cell) => cell.buildingIds.length)),
      coverage,
      baseIdentitySetId,
      baseIdentitySetChecksumSha256: membershipChecksumSha256,
    },
    exclusions,
    orderMap: cells.map((cell, index) => ({
      cellId: cell.cellId,
      parentOrder: byParentOrder[index]!.order,
      order: cell.order,
      buildingCount: cell.buildingIds.length,
    })),
  };

  return { ledger, derivation, buildingIds };
}

// ---------------------------------------------------------------------------
// The order-derived renderable-cell walk
// ---------------------------------------------------------------------------

export interface ExteriorWaveRenderableSubset<T> {
  cells: T[];
  ownedBuildingCount: number;
  spareEntries: number;
  /**
   * The first cell the budget could NOT admit, and what admitting it would have
   * cost. `null` only when every supplied cell fit.
   *
   * Emitted because "the walk stopped" and "the wave ran out of cells" are
   * different facts that the chosen list alone cannot distinguish, and because a
   * budget that is one building short of the next cell is worth being able to see.
   */
  stoppedAt: { cellId: string; buildingCount: number; wouldHaveTotalled: number } | null;
}

/**
 * Chooses a wave's renderable cells: highest visual priority first, admitting a
 * cell only while the whole subset still fits the entry budget.
 *
 * EXTRACTED AT T021 RATHER THAN COPIED A FOURTH TIME. Waves `w02`, `w03` and
 * `w04` each carry their own private copy of this walk in their own release
 * module, which is exactly the drift this file's header says the subset builder
 * was extracted to prevent. Those three copies are NOT edited — they are the code
 * three shipped releases were emitted by, and rewriting them to call this would
 * change the modules that describe frozen bytes for no behavioural reason.
 * Instead `exterior-wave-subset.test.ts` proves this function agrees with all
 * three over the same inputs, so the copies are pinned to this one rather than
 * merely coexisting with it.
 *
 * Order-derived, and that is a deliberate limit rather than a simplification: a
 * canary's subset may be order-derived because it is proving that the wave
 * materializes at all. Choosing cells for what they look like is a curation
 * decision that belongs to promotion, where it can be recorded and defended as
 * one.
 *
 * Whole cells only, and the walk STOPS at the first cell that does not fit
 * rather than skipping it. Skipping would reorder the wave's declared visual
 * priority to fill a budget, which is a curation nobody recorded.
 */
export function deriveExteriorWaveRenderableCells<T extends { cellId: string; buildingIds: readonly string[] }>(
  cells: readonly T[],
  entryBudget: number,
  waveId: string,
): ExteriorWaveRenderableSubset<T> {
  const chosen: T[] = [];
  let owned = 0;
  let stoppedAt: ExteriorWaveRenderableSubset<T>["stoppedAt"] = null;
  for (const cell of cells) {
    if (owned + cell.buildingIds.length > entryBudget) {
      stoppedAt = { cellId: cell.cellId, buildingCount: cell.buildingIds.length, wouldHaveTotalled: owned + cell.buildingIds.length };
      break;
    }
    chosen.push(cell);
    owned += cell.buildingIds.length;
  }
  if (chosen.length === 0) {
    // The message names the leading cell's size, because "no cell fits" alone
    // sends a reader looking for a bug in the walk when the actual fact is that
    // this wave's first cell is larger than the whole budget.
    const leading = cells[0];
    throw new Error(
      leading
        ? `Wave ${waveId}: no cell fits the ${entryBudget}-entry renderable budget; the first cell in priority order, ${leading.cellId}, owns ${leading.buildingIds.length} buildings.`
        : `Wave ${waveId}: no cell fits the ${entryBudget}-entry renderable budget; no cell was supplied at all.`,
    );
  }
  return { cells: chosen, ownedBuildingCount: owned, spareEntries: entryBudget - owned, stoppedAt };
}

// ---------------------------------------------------------------------------
// Reconciliation against the committed membership digest
// ---------------------------------------------------------------------------

export interface ExteriorWaveDigestCell {
  cellId: string;
  order: number;
  waveIndex: number;
  waveId: string;
  bounds: Wgs84Bounds;
  buildingCount: number;
  membershipChecksumSha256: string;
}

export interface ExteriorWaveReconciliationFinding {
  cellId: string;
  code: "missing-in-subset" | "missing-in-digest" | "duplicate-owner" | "membership-mismatch" | "bounds-mismatch" | "count-mismatch";
  detail: string;
}

export interface ExteriorWaveReconciliationReport {
  schemaVersion: "1.0";
  subsetLedgerId: string;
  digestLedgerId: string;
  digestLedgerChecksumSha256: string;
  waveId: string;
  counts: {
    digestCells: number;
    subsetCells: number;
    digestBuildings: number;
    subsetBuildings: number;
    missingOwners: number;
    duplicateOwners: number;
  };
  ok: boolean;
  findings: ExteriorWaveReconciliationFinding[];
}

/**
 * Reconciles the derived subset against the committed `membership-digest.json`.
 *
 * The digest is the independent record of what a wave contains, so this is the
 * check that the subset owns exactly the declared buildings: zero missing owners
 * and zero duplicate owners.
 */
export function reconcileExteriorWaveSubsetAgainstDigest(
  identity: Pick<ExteriorWaveSubsetIdentity, "waveIndex" | "waveId">,
  subset: ExteriorWaveSubset,
  digest: { ledgerId: string; ledgerChecksumSha256: string; cells: readonly ExteriorWaveDigestCell[] },
): ExteriorWaveReconciliationReport {
  const findings: ExteriorWaveReconciliationFinding[] = [];
  const digestCells = digest.cells.filter((cell) => cell.waveIndex === identity.waveIndex);
  const subsetById = new Map(subset.ledger.cells.map((cell) => [cell.cellId, cell]));
  const digestById = new Map(digestCells.map((cell) => [cell.cellId, cell]));

  for (const cell of digestCells) {
    if (cell.waveId !== identity.waveId) {
      findings.push({ cellId: cell.cellId, code: "membership-mismatch", detail: `Digest names wave ${cell.waveId}.` });
    }
    const owned = subsetById.get(cell.cellId);
    if (!owned) {
      findings.push({ cellId: cell.cellId, code: "missing-in-subset", detail: "Digest cell has no owner cell in the subset ledger." });
      continue;
    }
    if (owned.buildingIds.length !== cell.buildingCount) {
      findings.push({ cellId: cell.cellId, code: "count-mismatch", detail: `Subset owns ${owned.buildingIds.length}, digest declares ${cell.buildingCount}.` });
    }
    if (owned.membershipChecksumSha256 !== cell.membershipChecksumSha256) {
      findings.push({ cellId: cell.cellId, code: "membership-mismatch", detail: "Re-derived membership checksum differs from the committed digest." });
    }
    if (stableSerialize(owned.bounds) !== stableSerialize(cell.bounds)) {
      findings.push({ cellId: cell.cellId, code: "bounds-mismatch", detail: "Subset cell bounds differ from the committed digest." });
    }
  }
  for (const cell of subset.ledger.cells) {
    if (!digestById.has(cell.cellId)) {
      findings.push({ cellId: cell.cellId, code: "missing-in-digest", detail: "Subset cell is absent from the committed digest." });
    }
  }

  const allOwners = subset.ledger.cells.flatMap((cell) => cell.buildingIds);
  const seen = new Set<string>();
  let duplicateOwners = 0;
  for (const id of allOwners) {
    if (seen.has(id)) duplicateOwners += 1;
    seen.add(id);
  }
  const digestBuildings = digestCells.reduce((total, cell) => total + cell.buildingCount, 0);
  const missingOwners = Math.max(0, digestBuildings - seen.size);
  if (duplicateOwners > 0) {
    findings.push({ cellId: "*", code: "duplicate-owner", detail: `${duplicateOwners} buildings are owned more than once.` });
  }

  return {
    schemaVersion: "1.0",
    subsetLedgerId: subset.ledger.ledgerId,
    digestLedgerId: digest.ledgerId,
    digestLedgerChecksumSha256: digest.ledgerChecksumSha256,
    waveId: identity.waveId,
    counts: {
      digestCells: digestCells.length,
      subsetCells: subset.ledger.cells.length,
      digestBuildings,
      subsetBuildings: allOwners.length,
      missingOwners,
      duplicateOwners,
    },
    ok: findings.length === 0 && missingOwners === 0 && duplicateOwners === 0,
    findings,
  };
}

/**
 * Runs the accepted release-graph ownership checks against a subset ledger by
 * probing it inside a minimal graph shell. Structural graph fields other than
 * the ledger are not exercised here; the full graph is validated when the
 * release is assembled.
 */
export function validateExteriorWaveSubsetLedger(ledger: ExteriorOwnershipLedger): { ok: boolean; issues: { path: string; message: string }[] } {
  const result = validateExteriorReleaseGraph({
    schemaVersion: "1.0",
    roots: [],
    ownershipLedger: ledger,
    cellReleases: [],
    inventoryShards: [],
    evidenceShards: [],
    snapshots: [],
  });
  // The empty shell always reports the missing-roots issue; ownership issues are
  // what this probe is for, so root-only findings are filtered out.
  const issues = result.ok ? [] : result.issues.filter((issue) => !issue.path.startsWith("roots"));
  return { ok: issues.length === 0, issues };
}

/** Canonical serialization used for every committed exterior-wave JSON artifact. */
export function serializeExteriorWaveArtifact(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function exteriorWaveArtifactChecksum(value: unknown): string {
  return sha256HexSync(serializeExteriorWaveArtifact(value));
}
