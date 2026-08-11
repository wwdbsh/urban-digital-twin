import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256, EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID } from "../domain/exterior-fullsnapshot-input.ts";
import { EXTERIOR_CELL_MAX_BUILDINGS, cellWaveIndex } from "./exterior-wave-ledger.ts";
import { exteriorWaveArtifactChecksum } from "./exterior-wave-subset.ts";
import {
  LOWER_MANHATTAN_BUILDING_COUNT,
  LOWER_MANHATTAN_CELL_COUNT,
  LOWER_MANHATTAN_RELEASE_ID,
  LOWER_MANHATTAN_SUBSET_IDENTITY,
  LOWER_MANHATTAN_WAVE_ID,
  LOWER_MANHATTAN_WAVE_INDEX,
  buildLowerManhattanSubsetLedger,
  reconcileLowerManhattanAgainstDigest,
  validateLowerManhattanSubsetLedger,
} from "./lower-manhattan-package.ts";
import { MIDTOWN_CORE_SUBSET_IDENTITY } from "./midtown-core-package.ts";

const LEDGER_ROOT = "data/normalized/manhattan-exterior-wave-ledger-20260804";
const RECORD_ROOT = "data/lower-manhattan-20260812";

function readText(path: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(readFileSync(path)));
}

const parentLedger = JSON.parse(readText(`${LEDGER_ROOT}/ledger.json`)) as never;
const parentLedgerChecksumSha256 = exteriorWaveArtifactChecksum(parentLedger);
const digest = JSON.parse(readText(`${LEDGER_ROOT}/membership-digest.json`)) as never;

function build() {
  return buildLowerManhattanSubsetLedger({
    parentLedger,
    parentLedgerChecksumSha256,
    baseReleaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID,
    baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
  });
}

describe("lower-manhattan derived-subset ownership ledger", () => {
  it("pins the committed parent ledger by its own recorded checksum", () => {
    const recorded = readText(`${LEDGER_ROOT}/ledger.sha256`).trim().split(/\s+/u)[0];
    expect(parentLedgerChecksumSha256).toBe(recorded);
  });

  /**
   * The declared shape is not a target the pipeline aims at, it is the committed
   * digest's own statement. Reading it out of the digest rather than repeating
   * the constants is what makes this a check.
   */
  it("owns exactly the wave the committed digest declares for w02", () => {
    const declared = (digest as { waves: { waveIndex: number; cellCount: number; buildingCount: number }[] }).waves
      .find((wave) => wave.waveIndex === LOWER_MANHATTAN_WAVE_INDEX);
    expect(declared).toBeDefined();
    expect(LOWER_MANHATTAN_CELL_COUNT).toBe(declared!.cellCount);
    expect(LOWER_MANHATTAN_BUILDING_COUNT).toBe(declared!.buildingCount);

    const subset = build();
    expect(subset.ledger.cells).toHaveLength(LOWER_MANHATTAN_CELL_COUNT);
    expect(subset.buildingIds).toHaveLength(LOWER_MANHATTAN_BUILDING_COUNT);
    expect(new Set(subset.buildingIds).size).toBe(LOWER_MANHATTAN_BUILDING_COUNT);
    expect(subset.ledger.cells.every((cell) => cellWaveIndex(cell.cellId) === LOWER_MANHATTAN_WAVE_INDEX)).toBe(true);
  });

  it("renumbers cell orders contiguously from zero while preserving priority", () => {
    const subset = build();
    expect(subset.ledger.cells.map((cell) => cell.order)).toEqual([...Array(LOWER_MANHATTAN_CELL_COUNT).keys()]);
    const lexicographic = [...subset.ledger.cells].sort((left, right) => (left.cellId < right.cellId ? -1 : 1));
    expect(lexicographic.map((cell) => cell.cellId)).toEqual(subset.ledger.cells.map((cell) => cell.cellId));
  });

  it("keeps every cell inside the runtime per-cell cap", () => {
    expect(Math.max(...build().ledger.cells.map((cell) => cell.buildingIds.length))).toBeLessThanOrEqual(EXTERIOR_CELL_MAX_BUILDINGS);
  });

  it("passes the accepted ownership checks and reconciles exactly against the digest", () => {
    const subset = build();
    expect(validateLowerManhattanSubsetLedger(subset.ledger)).toEqual({ ok: true, issues: [] });
    const report = reconcileLowerManhattanAgainstDigest(subset, digest);
    expect(report.findings).toEqual([]);
    expect(report.counts.missingOwners).toBe(0);
    expect(report.counts.duplicateOwners).toBe(0);
    expect(report.counts.subsetBuildings).toBe(LOWER_MANHATTAN_BUILDING_COUNT);
    expect(report.ok).toBe(true);
  });

  /**
   * The disjointness this wave has to prove, and the reason its excluded set is
   * both earlier waves rather than wave 0 alone: the App holds ONE exterior
   * cache across every promoted wave, so a building owned twice would be an
   * ownership contradiction and a cache-identity hazard at once.
   */
  it("shares no building with either promoted wave", () => {
    const subset = build();
    expect(subset.derivation.exclusions.length).toBeGreaterThan(0);
    expect(subset.derivation.exclusions.every((exclusion) => exclusion.overlapWithSubset === 0)).toBe(true);
    // Both promoted waves are actually covered, not just wave 0.
    const excludedWaves = new Set(subset.derivation.exclusions.map((exclusion) => cellWaveIndex(exclusion.cellId)));
    expect([...excludedWaves].sort()).toEqual([0, 1]);
  });

  it("derives ids under its OWN hash domains, never the midtown wave's", () => {
    expect(LOWER_MANHATTAN_SUBSET_IDENTITY.ledgerIdDomain).not.toBe(MIDTOWN_CORE_SUBSET_IDENTITY.ledgerIdDomain);
    expect(LOWER_MANHATTAN_SUBSET_IDENTITY.baseIdentityDomain).not.toBe(MIDTOWN_CORE_SUBSET_IDENTITY.baseIdentityDomain);
    const subset = build();
    expect(subset.ledger.ledgerId).toContain(`ownership-ledger:${LOWER_MANHATTAN_RELEASE_ID}:`);
    expect(subset.ledger.baseIdentitySet.id).toContain(`:exterior-base-identity:${LOWER_MANHATTAN_WAVE_ID}:`);
    expect(subset.ledger.baseIdentitySet.id).not.toBe(parentLedger.baseIdentitySet.id);
  });

  /**
   * The drift pin. Never skipped: the record it reads is COMMITTED, so an absent
   * payload directory cannot excuse it, and a pipeline change that moved the
   * partition would have to move this file to stay green.
   */
  it("re-derives the committed derivation record byte for byte", () => {
    const committed = JSON.parse(readText(`${RECORD_ROOT}/derivation.json`)) as { derivation: unknown; reconciliation: unknown };
    const subset = build();
    expect(JSON.stringify(subset.derivation, null, 2)).toBe(JSON.stringify(committed.derivation, null, 2));
    expect(JSON.stringify(reconcileLowerManhattanAgainstDigest(subset, digest), null, 2))
      .toBe(JSON.stringify(committed.reconciliation, null, 2));
  });
});
