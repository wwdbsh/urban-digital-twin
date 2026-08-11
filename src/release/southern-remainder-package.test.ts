import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256, EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID } from "../domain/exterior-fullsnapshot-input.ts";
import type { ExteriorOwnershipLedger } from "./exterior-release.ts";
import { EXTERIOR_CELL_MAX_BUILDINGS, cellWaveIndex } from "./exterior-wave-ledger.ts";
import { exteriorWaveArtifactChecksum } from "./exterior-wave-subset.ts";
import {
  SOUTHERN_REMAINDER_BUILDING_COUNT,
  SOUTHERN_REMAINDER_CELL_COUNT,
  SOUTHERN_REMAINDER_RELEASE_ID,
  SOUTHERN_REMAINDER_SUBSET_IDENTITY,
  SOUTHERN_REMAINDER_WAVE_ID,
  SOUTHERN_REMAINDER_WAVE_INDEX,
  buildSouthernRemainderSubsetLedger,
  reconcileSouthernRemainderAgainstDigest,
  validateSouthernRemainderSubsetLedger,
} from "./southern-remainder-package.ts";
import { LOWER_MANHATTAN_SUBSET_IDENTITY } from "./lower-manhattan-package.ts";
import { MIDTOWN_CORE_SUBSET_IDENTITY } from "./midtown-core-package.ts";

const LEDGER_ROOT = "data/normalized/manhattan-exterior-wave-ledger-20260804";
const RECORD_ROOT = "data/southern-remainder-20260812";

function readText(path: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(readFileSync(path)));
}

const parentLedger = JSON.parse(readText(`${LEDGER_ROOT}/ledger.json`)) as ExteriorOwnershipLedger;
const parentLedgerChecksumSha256 = exteriorWaveArtifactChecksum(parentLedger);
const digest = JSON.parse(readText(`${LEDGER_ROOT}/membership-digest.json`)) as never;

function build() {
  return buildSouthernRemainderSubsetLedger({
    parentLedger,
    parentLedgerChecksumSha256,
    baseReleaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID,
    baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
  });
}

describe("southern-remainder derived-subset ownership ledger", () => {
  it("pins the committed parent ledger by its own recorded checksum", () => {
    const recorded = readText(`${LEDGER_ROOT}/ledger.sha256`).trim().split(/\s+/u)[0];
    expect(parentLedgerChecksumSha256).toBe(recorded);
  });

  /**
   * The declared shape is not a target the pipeline aims at, it is the committed
   * digest's own statement. Reading it out of the digest rather than repeating
   * the constants is what makes this a check.
   */
  it("owns exactly the wave the committed digest declares for w03", () => {
    const declared = (digest as { waves: { waveIndex: number; waveId: string; cellCount: number; buildingCount: number }[] }).waves
      .find((wave) => wave.waveIndex === SOUTHERN_REMAINDER_WAVE_INDEX);
    expect(declared).toBeDefined();
    // The wave SLUG is read out of the ledger too, because this wave's two hash
    // domains are named after it: `udt.southern-remainder.*`. A module that
    // renamed the wave without renaming its domains would derive ids under a
    // string that describes nothing.
    expect(SOUTHERN_REMAINDER_WAVE_ID).toBe(declared!.waveId);
    expect(SOUTHERN_REMAINDER_CELL_COUNT).toBe(declared!.cellCount);
    expect(SOUTHERN_REMAINDER_BUILDING_COUNT).toBe(declared!.buildingCount);

    const subset = build();
    expect(subset.ledger.cells).toHaveLength(SOUTHERN_REMAINDER_CELL_COUNT);
    expect(subset.buildingIds).toHaveLength(SOUTHERN_REMAINDER_BUILDING_COUNT);
    expect(new Set(subset.buildingIds).size).toBe(SOUTHERN_REMAINDER_BUILDING_COUNT);
    expect(subset.ledger.cells.every((cell) => cellWaveIndex(cell.cellId) === SOUTHERN_REMAINDER_WAVE_INDEX)).toBe(true);
  });

  it("renumbers cell orders contiguously from zero while preserving priority", () => {
    const subset = build();
    expect(subset.ledger.cells.map((cell) => cell.order)).toEqual([...Array(SOUTHERN_REMAINDER_CELL_COUNT).keys()]);
    const lexicographic = [...subset.ledger.cells].sort((left, right) => (left.cellId < right.cellId ? -1 : 1));
    expect(lexicographic.map((cell) => cell.cellId)).toEqual(subset.ledger.cells.map((cell) => cell.cellId));
  });

  it("keeps every cell inside the runtime per-cell cap", () => {
    expect(Math.max(...build().ledger.cells.map((cell) => cell.buildingIds.length))).toBeLessThanOrEqual(EXTERIOR_CELL_MAX_BUILDINGS);
  });

  it("passes the accepted ownership checks and reconciles exactly against the digest", () => {
    const subset = build();
    expect(validateSouthernRemainderSubsetLedger(subset.ledger)).toEqual({ ok: true, issues: [] });
    const report = reconcileSouthernRemainderAgainstDigest(subset, digest);
    expect(report.findings).toEqual([]);
    expect(report.counts.missingOwners).toBe(0);
    expect(report.counts.duplicateOwners).toBe(0);
    expect(report.counts.subsetBuildings).toBe(SOUTHERN_REMAINDER_BUILDING_COUNT);
    expect(report.ok).toBe(true);
  });

  /**
   * The disjointness this wave has to prove, and the reason its excluded set is
   * all THREE earlier waves rather than the two wave w02 named: three waves are
   * promoted now, and the App holds ONE exterior cache across every promoted
   * wave, so a building owned twice would be an ownership contradiction and a
   * cache-identity hazard at once.
   *
   * Wave 2 is excluded by its PARENT cells, which are exactly the buildings the
   * promoted `-p1` successor owns: that successor changed which cells retain
   * bytes, never which buildings the wave owns.
   */
  it("shares no building with any of the three promoted waves", () => {
    const subset = build();
    expect(subset.derivation.exclusions.length).toBeGreaterThan(0);
    expect(subset.derivation.exclusions.every((exclusion) => exclusion.overlapWithSubset === 0)).toBe(true);
    const excludedWaves = new Set(subset.derivation.exclusions.map((exclusion) => cellWaveIndex(exclusion.cellId)));
    expect([...excludedWaves].sort()).toEqual([0, 1, 2]);
    // Every cell of each excluded wave is accounted for, not merely some of them.
    const parentExcluded = parentLedger.cells.filter((cell) => [0, 1, 2].includes(cellWaveIndex(cell.cellId)));
    expect(subset.derivation.exclusions).toHaveLength(parentExcluded.length);
  });

  it("derives ids under its OWN hash domains, never an earlier wave's", () => {
    for (const other of [MIDTOWN_CORE_SUBSET_IDENTITY, LOWER_MANHATTAN_SUBSET_IDENTITY]) {
      expect(SOUTHERN_REMAINDER_SUBSET_IDENTITY.ledgerIdDomain).not.toBe(other.ledgerIdDomain);
      expect(SOUTHERN_REMAINDER_SUBSET_IDENTITY.baseIdentityDomain).not.toBe(other.baseIdentityDomain);
    }
    // The `udt.<wave-slug>.*` scheme, checked rather than described.
    expect(SOUTHERN_REMAINDER_SUBSET_IDENTITY.ledgerIdDomain).toBe(`udt.${SOUTHERN_REMAINDER_WAVE_ID}.subset-ledger-id.v1`);
    expect(SOUTHERN_REMAINDER_SUBSET_IDENTITY.baseIdentityDomain).toBe(`udt.${SOUTHERN_REMAINDER_WAVE_ID}.subset-base-identity.v1`);
    const subset = build();
    expect(subset.ledger.ledgerId).toContain(`ownership-ledger:${SOUTHERN_REMAINDER_RELEASE_ID}:`);
    expect(subset.ledger.baseIdentitySet.id).toContain(`:exterior-base-identity:${SOUTHERN_REMAINDER_WAVE_ID}:`);
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
    expect(JSON.stringify(reconcileSouthernRemainderAgainstDigest(subset, digest), null, 2))
      .toBe(JSON.stringify(committed.reconciliation, null, 2));
  });
});
