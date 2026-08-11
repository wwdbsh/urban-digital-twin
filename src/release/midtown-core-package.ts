/**
 * Midtown-core exterior canary package `manhattan-midtown-core-cells-20260811`.
 *
 * This module owns the *derived-subset ownership ledger* for wave `w01`
 * (`midtown-core`) of the committed exterior wave ledger
 * `manhattan-exterior-wave-ledger-20260804`.
 *
 * Why a derived subset rather than the full wave ledger
 * -----------------------------------------------------
 * `validateExteriorReleaseGraph` requires a release's ownership ledger to
 * enumerate *exactly* the buildings that release owns, with contiguous cell
 * orders `0..n-1` and a `baseIdentitySet.checksumSha256` taken over exactly that
 * membership. The full 883-cell / 45,194-building wave ledger therefore cannot
 * be the ledger of a 149-cell / 7,201-building release: its orders start at the
 * Block 835 cell and its base identity set covers the whole city.
 *
 * So this module re-derives a ledger that owns only the 149 `w01` cells:
 *
 *   - stable cell ids are preserved verbatim, so the committed
 *     `membership-digest.json` still reconciles against this subset;
 *   - cell orders are renumbered contiguously `0..148`, preserving the parent's
 *     visual priority (lexicographic cell-id order equals parent order order,
 *     which this module asserts rather than assumes);
 *   - `coverage` is recomputed as the exact union rectangle of the 149 cells;
 *   - a NEW `baseIdentitySet` is derived over exactly the 7,201 canonical ids.
 *
 * Deliberate scope note: the subset is validated by
 * `validateExteriorReleaseGraph`, NOT by `validateExteriorWaveLedger`. The wave
 * validator additionally requires that a cell id's embedded sequence equals its
 * `order` and that exactly one Block 835 (wave 0) cell is present. Both are
 * properties of the *parent* full-city partition and are intentionally not
 * properties of a single-wave derived subset: renumbering to `0..148` is
 * mandated by the release-graph contract, and the Block 835 cell is excluded by
 * design (`w00 n w01 = {}`). Preserving the parent cell ids while renumbering
 * orders is what lets both artifacts stay true at once.
 *
 * Parent provenance is NOT carried inside the ledger: the release-graph schema
 * is closed (`exactKeys`), so an extra `derivedFrom` field would be rejected.
 * It is emitted beside the ledger as a `MidtownCoreDerivationRecord`.
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
export const MIDTOWN_CORE_PARENT_LEDGER_RELEASE_ID = EXTERIOR_WAVE_LEDGER_RELEASE_ID;

const SUBSET_LEDGER_ID_DOMAIN = "udt.midtown-core.subset-ledger-id.v1" as const;
const SUBSET_BASE_IDENTITY_DOMAIN = "udt.midtown-core.subset-base-identity.v1" as const;

// ---------------------------------------------------------------------------
// Derivation record (sibling provenance artifact)
// ---------------------------------------------------------------------------

export interface MidtownCoreOrderMapping {
  cellId: string;
  /** Order this cell carries in the parent full-city wave ledger. */
  parentOrder: number;
  /** Contiguous order this cell carries in the derived subset. */
  order: number;
  buildingCount: number;
}

export interface MidtownCoreDerivationRecord {
  schemaVersion: "1.0";
  subsetLedgerId: string;
  waveIndex: typeof MIDTOWN_CORE_WAVE_INDEX;
  waveId: typeof MIDTOWN_CORE_WAVE_ID;
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
   * Explicit statement that the excluded wave-0 cell shares no building with
   * this subset, so the Block 835 release and this one cannot both own a
   * building.
   */
  exclusions: { cellId: string; buildingCount: number; overlapWithSubset: number }[];
  orderMap: MidtownCoreOrderMapping[];
}

export interface MidtownCoreSubsetInput {
  /** The committed parent wave ledger, already parsed. */
  parentLedger: ExteriorOwnershipLedger;
  /** SHA-256 over the parent ledger's exact committed bytes. */
  parentLedgerChecksumSha256: string;
  baseReleaseId: string;
  baseManifestChecksumSha256: string;
}

export interface MidtownCoreSubset {
  ledger: ExteriorOwnershipLedger;
  derivation: MidtownCoreDerivationRecord;
  /** Canonical sorted ids of every building this release owns. */
  buildingIds: string[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function unionBounds(bounds: readonly Wgs84Bounds[]): Wgs84Bounds {
  const first = bounds[0];
  if (!first) throw new Error("Midtown-core coverage requires at least one cell.");
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
export function deriveMidtownCoreBaseIdentitySetId(input: {
  baseReleaseId: string;
  baseManifestChecksumSha256: string;
  waveId: string;
  buildingCount: number;
  membershipChecksumSha256: string;
}): string {
  const digest = domainSeparatedSha256(SUBSET_BASE_IDENTITY_DOMAIN, {
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
export function deriveMidtownCoreLedgerId(input: {
  parentLedgerId: string;
  parentLedgerChecksumSha256: string;
  baseIdentitySetId: string;
  cityId: string;
  configId: string;
  coverage: Wgs84Bounds;
  cells: readonly ExteriorOwnershipCell[];
}): string {
  const digest = domainSeparatedSha256(SUBSET_LEDGER_ID_DOMAIN, {
    parentLedgerId: input.parentLedgerId,
    parentLedgerChecksumSha256: input.parentLedgerChecksumSha256,
    baseIdentitySetId: input.baseIdentitySetId,
    cityId: input.cityId,
    configId: input.configId,
    waveId: MIDTOWN_CORE_WAVE_ID,
    coverage: input.coverage,
    cells: [...input.cells]
      .sort((left, right) => left.order - right.order)
      .map((cell) => ({ cellId: cell.cellId, order: cell.order, bounds: cell.bounds, membershipChecksumSha256: cell.membershipChecksumSha256 })),
  });
  return `ownership-ledger:${MIDTOWN_CORE_RELEASE_ID}:${digest.slice(0, 16)}`;
}

/**
 * Builds the derived-subset ownership ledger for wave `w01`.
 *
 * Fails closed on every shape the contract cannot describe: a wrong wave count,
 * an unsorted membership, a cell over the runtime cap, a priority order that
 * lexicographic cell-id sorting would not reproduce, or any overlap with the
 * excluded wave-0 cell.
 */
export function buildMidtownCoreSubsetLedger(input: MidtownCoreSubsetInput): MidtownCoreSubset {
  const parent = input.parentLedger;
  // The whole validation boundary of this module rests on the *pairing* of the
  // supplied ledger with the supplied checksum: the subset inherits its cell
  // ids, bounds, and membership verbatim from a parent that its own committed
  // artifact (`ledger.sha256`) attests to. A caller-supplied checksum that does
  // not describe the supplied bytes would let an unattested partition through
  // and would propagate into the derived ledger id and the derivation record,
  // so it is recomputed here rather than trusted. `midtownCoreArtifactChecksum`
  // is the serialization the committed `ledger.sha256` records, so this is the
  // same value the wave-ledger emitter published.
  const recomputedParentChecksum = midtownCoreArtifactChecksum(parent);
  if (recomputedParentChecksum !== input.parentLedgerChecksumSha256) {
    throw new Error(`Parent ledger checksum ${input.parentLedgerChecksumSha256} does not describe the supplied parent ledger (recomputed ${recomputedParentChecksum}).`);
  }
  const wave = EXTERIOR_WAVE_PLAN[MIDTOWN_CORE_WAVE_INDEX];
  if (!wave || wave.waveId !== MIDTOWN_CORE_WAVE_ID) {
    throw new Error(`Wave index ${MIDTOWN_CORE_WAVE_INDEX} is not ${MIDTOWN_CORE_WAVE_ID} in the declared wave plan.`);
  }

  const selected = parent.cells.filter((cell) => cellWaveIndex(cell.cellId) === MIDTOWN_CORE_WAVE_INDEX);
  if (selected.length !== MIDTOWN_CORE_CELL_COUNT) {
    throw new Error(`Wave ${MIDTOWN_CORE_WAVE_ID} holds ${selected.length} cells in the parent ledger, not the declared ${MIDTOWN_CORE_CELL_COUNT}.`);
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
    throw new Error("A building is owned by more than one midtown-core cell.");
  }
  if (buildingIds.length !== MIDTOWN_CORE_BUILDING_COUNT) {
    throw new Error(`Wave ${MIDTOWN_CORE_WAVE_ID} enumerates ${buildingIds.length} buildings, not the declared ${MIDTOWN_CORE_BUILDING_COUNT}.`);
  }

  // Zero overlap with every excluded parent cell, wave 0 included by design.
  const owned = new Set(buildingIds);
  const exclusions = parent.cells
    .filter((cell) => cellWaveIndex(cell.cellId) !== MIDTOWN_CORE_WAVE_INDEX && cellWaveIndex(cell.cellId) === 0)
    .map((cell) => ({
      cellId: cell.cellId,
      buildingCount: cell.buildingIds.length,
      overlapWithSubset: cell.buildingIds.filter((id) => owned.has(id)).length,
    }));
  for (const exclusion of exclusions) {
    if (exclusion.overlapWithSubset !== 0) {
      throw new Error(`Excluded cell ${exclusion.cellId} shares ${exclusion.overlapWithSubset} buildings with the midtown-core subset.`);
    }
  }

  const coverage = unionBounds(cells.map((cell) => cell.bounds));
  const membershipChecksumSha256 = membershipChecksum(buildingIds);
  const baseIdentitySetId = deriveMidtownCoreBaseIdentitySetId({
    baseReleaseId: input.baseReleaseId,
    baseManifestChecksumSha256: input.baseManifestChecksumSha256,
    waveId: MIDTOWN_CORE_WAVE_ID,
    buildingCount: buildingIds.length,
    membershipChecksumSha256,
  });
  if (baseIdentitySetId === parent.baseIdentitySet.id) {
    throw new Error("Subset base identity set must not alias the parent full-city base identity set.");
  }

  const ledgerId = deriveMidtownCoreLedgerId({
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

  const derivation: MidtownCoreDerivationRecord = {
    schemaVersion: "1.0",
    subsetLedgerId: ledgerId,
    waveIndex: MIDTOWN_CORE_WAVE_INDEX,
    waveId: MIDTOWN_CORE_WAVE_ID,
    parent: {
      ledgerReleaseId: MIDTOWN_CORE_PARENT_LEDGER_RELEASE_ID,
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
// Reconciliation against the committed membership digest
// ---------------------------------------------------------------------------

export interface MidtownCoreDigestCell {
  cellId: string;
  order: number;
  waveIndex: number;
  waveId: string;
  bounds: Wgs84Bounds;
  buildingCount: number;
  membershipChecksumSha256: string;
}

export interface MidtownCoreReconciliationFinding {
  cellId: string;
  code: "missing-in-subset" | "missing-in-digest" | "duplicate-owner" | "membership-mismatch" | "bounds-mismatch" | "count-mismatch";
  detail: string;
}

export interface MidtownCoreReconciliationReport {
  schemaVersion: "1.0";
  subsetLedgerId: string;
  digestLedgerId: string;
  digestLedgerChecksumSha256: string;
  waveId: typeof MIDTOWN_CORE_WAVE_ID;
  counts: {
    digestCells: number;
    subsetCells: number;
    digestBuildings: number;
    subsetBuildings: number;
    missingOwners: number;
    duplicateOwners: number;
  };
  ok: boolean;
  findings: MidtownCoreReconciliationFinding[];
}

/**
 * Reconciles the derived subset against the committed `membership-digest.json`.
 *
 * The digest is the independent record of what wave `w01` contains, so this is
 * the check that the subset owns exactly the declared buildings: zero missing
 * owners and zero duplicate owners.
 */
export function reconcileMidtownCoreAgainstDigest(
  subset: MidtownCoreSubset,
  digest: { ledgerId: string; ledgerChecksumSha256: string; cells: readonly MidtownCoreDigestCell[] },
): MidtownCoreReconciliationReport {
  const findings: MidtownCoreReconciliationFinding[] = [];
  const digestCells = digest.cells.filter((cell) => cell.waveIndex === MIDTOWN_CORE_WAVE_INDEX);
  const subsetById = new Map(subset.ledger.cells.map((cell) => [cell.cellId, cell]));
  const digestById = new Map(digestCells.map((cell) => [cell.cellId, cell]));

  for (const cell of digestCells) {
    if (cell.waveId !== MIDTOWN_CORE_WAVE_ID) {
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
    waveId: MIDTOWN_CORE_WAVE_ID,
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
 * Runs the accepted release-graph ownership checks against the subset ledger by
 * probing it inside a minimal graph shell. Structural graph fields other than
 * the ledger are not exercised here; the full graph is validated in Phase C.
 */
export function validateMidtownCoreSubsetLedger(ledger: ExteriorOwnershipLedger): { ok: boolean; issues: { path: string; message: string }[] } {
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

/** Canonical serialization used for every committed midtown-core JSON artifact. */
export function serializeMidtownCoreArtifact(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function midtownCoreArtifactChecksum(value: unknown): string {
  return sha256HexSync(serializeMidtownCoreArtifact(value));
}
