/**
 * Zero-missing reconciliation and the change-impact index for the canonical
 * Manhattan exterior wave ledger (Task T011).
 *
 * The reason codes are closed and each has one defined referent:
 *
 * - `missing`               a base-snapshot building that no ledger cell owns.
 * - `duplicate`             a building listed more than once *inside one cell*.
 * - `cross-cell-duplicate`  a building owned by more than one cell.  The
 *                           accepted `validateExteriorReleaseGraph` already
 *                           rejects this; the code exists only so a composed
 *                           report can surface that rejection with the same
 *                           vocabulary, never to re-own the invariant.
 * - `stale`                 a ledger cell member absent from the base snapshot.
 * - `changed`               a cell whose recomputed membership checksum differs
 *                           from its declared `membershipChecksumSha256`.
 *
 * The change-impact index is v1 and deliberately narrow: an id -> owning-cell
 * map plus a ledger-to-ledger diff that names impacted cells.  It makes no
 * predecessor-graph-over-ledgers claim: the only real predecessor edges today
 * are cell-release lineage and source-snapshot lineage.
 */

import { stableSerialize } from "./catalog-release.ts";
import type { ExteriorOwnershipLedger } from "./exterior-release.ts";
import { EXTERIOR_WAVE_LEDGER_SCHEMA_VERSION, membershipChecksum } from "./exterior-wave-ledger.ts";

export const EXTERIOR_LEDGER_RECONCILIATION_CODES = [
  "missing",
  "duplicate",
  "cross-cell-duplicate",
  "stale",
  "changed",
] as const;

export type ExteriorLedgerReconciliationCode = (typeof EXTERIOR_LEDGER_RECONCILIATION_CODES)[number];

export interface ExteriorLedgerReconciliationFinding {
  code: ExteriorLedgerReconciliationCode;
  /** The referent building, or `null` when the finding is about a whole cell. */
  buildingId: string | null;
  /** The referent cell, or `null` when the finding is about the base snapshot. */
  cellId: string | null;
  detail: string;
}

export interface ExteriorLedgerReconciliationReport {
  schemaVersion: typeof EXTERIOR_WAVE_LEDGER_SCHEMA_VERSION;
  ledgerId: string;
  ledgerChecksumSha256: string;
  baseIdentitySetId: string;
  baseIdentitySetChecksumSha256: string;
  baseReleaseId: string;
  observedBuildingCount: number;
  ownedBuildingCount: number;
  cellCount: number;
  counts: Record<ExteriorLedgerReconciliationCode, number>;
  ok: boolean;
  findings: readonly ExteriorLedgerReconciliationFinding[];
}

export interface ExteriorLedgerReconciliationInput {
  /** Exact building-id enumeration of the pinned base snapshot. */
  baseBuildingIds: readonly string[];
  baseReleaseId: string;
  ledgerChecksumSha256: string;
}

function compareFindings(left: ExteriorLedgerReconciliationFinding, right: ExteriorLedgerReconciliationFinding): number {
  const codeOrder = EXTERIOR_LEDGER_RECONCILIATION_CODES.indexOf(left.code) - EXTERIOR_LEDGER_RECONCILIATION_CODES.indexOf(right.code);
  if (codeOrder !== 0) return codeOrder;
  const cellLeft = left.cellId ?? "";
  const cellRight = right.cellId ?? "";
  if (cellLeft !== cellRight) return cellLeft < cellRight ? -1 : 1;
  const buildingLeft = left.buildingId ?? "";
  const buildingRight = right.buildingId ?? "";
  if (buildingLeft !== buildingRight) return buildingLeft < buildingRight ? -1 : 1;
  return left.detail < right.detail ? -1 : left.detail > right.detail ? 1 : 0;
}

/**
 * Reconciles a candidate ledger against the pinned base snapshot enumeration.
 * Deterministic: findings are ordered by (code, cellId, buildingId, detail).
 */
export function reconcileExteriorWaveLedger(
  ledger: ExteriorOwnershipLedger,
  input: ExteriorLedgerReconciliationInput,
): ExteriorLedgerReconciliationReport {
  const findings: ExteriorLedgerReconciliationFinding[] = [];
  const base = new Set(input.baseBuildingIds);
  const owner = new Map<string, string>();
  let ownedBuildingCount = 0;

  // Walk cells in the ledger's own canonical order, not the array order of the
  // value handed to us: `cross-cell-duplicate` names the *second* owner it
  // meets, so an unsorted walk would attribute the same defect to a different
  // cell depending on how the caller happened to arrange the array.
  for (const cell of [...ledger.cells].sort((left, right) => left.order - right.order)) {
    const withinCell = new Set<string>();
    for (const buildingId of cell.buildingIds) {
      ownedBuildingCount += 1;
      if (withinCell.has(buildingId)) {
        findings.push({ code: "duplicate", buildingId, cellId: cell.cellId, detail: "Building is listed more than once inside a single cell." });
        continue;
      }
      withinCell.add(buildingId);
      const previous = owner.get(buildingId);
      if (previous !== undefined) {
        findings.push({ code: "cross-cell-duplicate", buildingId, cellId: cell.cellId, detail: `Building is already owned by ${previous}.` });
        continue;
      }
      owner.set(buildingId, cell.cellId);
      if (!base.has(buildingId)) {
        findings.push({ code: "stale", buildingId, cellId: cell.cellId, detail: "Cell member is absent from the pinned base snapshot." });
      }
    }
    if (membershipChecksum(cell.buildingIds) !== cell.membershipChecksumSha256) {
      findings.push({ code: "changed", buildingId: null, cellId: cell.cellId, detail: "Recomputed membership checksum differs from the declared value." });
    }
  }

  for (const buildingId of input.baseBuildingIds) {
    if (!owner.has(buildingId)) {
      findings.push({ code: "missing", buildingId, cellId: null, detail: "Base snapshot building is owned by no ledger cell." });
    }
  }

  findings.sort(compareFindings);
  const counts = Object.fromEntries(EXTERIOR_LEDGER_RECONCILIATION_CODES.map((code) => [code, findings.filter((finding) => finding.code === code).length])) as Record<ExteriorLedgerReconciliationCode, number>;
  return {
    schemaVersion: EXTERIOR_WAVE_LEDGER_SCHEMA_VERSION,
    ledgerId: ledger.ledgerId,
    ledgerChecksumSha256: input.ledgerChecksumSha256,
    baseIdentitySetId: ledger.baseIdentitySet.id,
    baseIdentitySetChecksumSha256: ledger.baseIdentitySet.checksumSha256,
    baseReleaseId: input.baseReleaseId,
    observedBuildingCount: new Set(input.baseBuildingIds).size,
    ownedBuildingCount,
    cellCount: ledger.cells.length,
    counts,
    ok: findings.length === 0,
    findings,
  };
}

// ---------------------------------------------------------------------------
// Change-impact index v1
// ---------------------------------------------------------------------------

/** Building id -> owning cell id, sorted by building id. */
export function exteriorLedgerOwnerIndex(ledger: ExteriorOwnershipLedger): Map<string, string> {
  const entries: [string, string][] = [];
  for (const cell of ledger.cells) for (const buildingId of cell.buildingIds) entries.push([buildingId, cell.cellId]);
  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return new Map(entries);
}

export interface ExteriorLedgerMovedBuilding {
  buildingId: string;
  fromCellId: string;
  toCellId: string;
}

export interface ExteriorLedgerChangeImpact {
  schemaVersion: typeof EXTERIOR_WAVE_LEDGER_SCHEMA_VERSION;
  fromLedgerId: string;
  toLedgerId: string;
  addedBuildingIds: readonly string[];
  removedBuildingIds: readonly string[];
  movedBuildings: readonly ExteriorLedgerMovedBuilding[];
  addedCellIds: readonly string[];
  removedCellIds: readonly string[];
  /** Every cell in either ledger whose membership is touched by the delta. */
  impactedCellIds: readonly string[];
  unchanged: boolean;
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/**
 * Maps a base delta between two ledger versions onto the cells it impacts.
 * A cell is impacted when a building enters it, leaves it, or the cell itself
 * appears or disappears.
 */
export function diffExteriorWaveLedgers(from: ExteriorOwnershipLedger, to: ExteriorOwnershipLedger): ExteriorLedgerChangeImpact {
  const before = exteriorLedgerOwnerIndex(from);
  const after = exteriorLedgerOwnerIndex(to);
  const impacted = new Set<string>();
  const added: string[] = [];
  const removed: string[] = [];
  const moved: ExteriorLedgerMovedBuilding[] = [];

  for (const [buildingId, toCellId] of after) {
    const fromCellId = before.get(buildingId);
    if (fromCellId === undefined) {
      added.push(buildingId);
      impacted.add(toCellId);
      continue;
    }
    if (fromCellId !== toCellId) {
      moved.push({ buildingId, fromCellId, toCellId });
      impacted.add(fromCellId);
      impacted.add(toCellId);
    }
  }
  for (const [buildingId, fromCellId] of before) {
    if (!after.has(buildingId)) {
      removed.push(buildingId);
      impacted.add(fromCellId);
    }
  }

  const fromCells = new Set(from.cells.map((cell) => cell.cellId));
  const toCells = new Set(to.cells.map((cell) => cell.cellId));
  const addedCellIds = sorted([...toCells].filter((cellId) => !fromCells.has(cellId)));
  const removedCellIds = sorted([...fromCells].filter((cellId) => !toCells.has(cellId)));
  for (const cellId of [...addedCellIds, ...removedCellIds]) impacted.add(cellId);

  // A cell can also change without any id crossing a boundary if its declared
  // membership checksum moves; catch that against the same cell id.
  const fromByCell = new Map(from.cells.map((cell) => [cell.cellId, cell]));
  for (const cell of to.cells) {
    const previous = fromByCell.get(cell.cellId);
    if (previous && previous.membershipChecksumSha256 !== cell.membershipChecksumSha256) impacted.add(cell.cellId);
  }

  moved.sort((left, right) => (left.buildingId < right.buildingId ? -1 : left.buildingId > right.buildingId ? 1 : 0));
  const impactedCellIds = sorted(impacted);
  return {
    schemaVersion: EXTERIOR_WAVE_LEDGER_SCHEMA_VERSION,
    fromLedgerId: from.ledgerId,
    toLedgerId: to.ledgerId,
    addedBuildingIds: sorted(added),
    removedBuildingIds: sorted(removed),
    movedBuildings: moved,
    addedCellIds,
    removedCellIds,
    impactedCellIds,
    unchanged: impactedCellIds.length === 0 && stableSerialize(from.cells) === stableSerialize(to.cells),
  };
}
