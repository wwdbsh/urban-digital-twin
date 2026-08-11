import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256, EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID } from "../domain/exterior-fullsnapshot-input.ts";
import type { ExteriorOwnershipLedger } from "./exterior-release.ts";
import { EXTERIOR_CELL_MAX_BUILDINGS, cellWaveIndex } from "./exterior-wave-ledger.ts";
import { exteriorWaveArtifactChecksum } from "./exterior-wave-subset.ts";
import {
  CENTRAL_UPPER_MANHATTAN_BUILDING_COUNT,
  CENTRAL_UPPER_MANHATTAN_CELL_COUNT,
  CENTRAL_UPPER_MANHATTAN_RELEASE_ID,
  CENTRAL_UPPER_MANHATTAN_SUBSET_IDENTITY,
  CENTRAL_UPPER_MANHATTAN_WAVE_ID,
  CENTRAL_UPPER_MANHATTAN_WAVE_INDEX,
  buildCentralUpperManhattanSubsetLedger,
  reconcileCentralUpperManhattanAgainstDigest,
  validateCentralUpperManhattanSubsetLedger,
} from "./central-upper-manhattan-package.ts";
import { LOWER_MANHATTAN_SUBSET_IDENTITY } from "./lower-manhattan-package.ts";
import { MIDTOWN_CORE_SUBSET_IDENTITY } from "./midtown-core-package.ts";
import { SOUTHERN_REMAINDER_SUBSET_IDENTITY } from "./southern-remainder-package.ts";

const LEDGER_ROOT = "data/normalized/manhattan-exterior-wave-ledger-20260804";
const RECORD_ROOT = "data/central-upper-manhattan-20260812";

function readText(path: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(readFileSync(path)));
}

const parentLedger = JSON.parse(readText(`${LEDGER_ROOT}/ledger.json`)) as ExteriorOwnershipLedger;
const parentLedgerChecksumSha256 = exteriorWaveArtifactChecksum(parentLedger);
const digest = JSON.parse(readText(`${LEDGER_ROOT}/membership-digest.json`)) as never;

function build() {
  return buildCentralUpperManhattanSubsetLedger({
    parentLedger,
    parentLedgerChecksumSha256,
    baseReleaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID,
    baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
  });
}

describe("central-upper-manhattan derived-subset ownership ledger", () => {
  it("pins the committed parent ledger by its own recorded checksum", () => {
    const recorded = readText(`${LEDGER_ROOT}/ledger.sha256`).trim().split(/\s+/u)[0];
    expect(parentLedgerChecksumSha256).toBe(recorded);
  });

  /**
   * The declared shape is not a target the pipeline aims at, it is the committed
   * digest's own statement. Reading it out of the digest rather than repeating
   * the constants is what makes this a check.
   */
  it("owns exactly the wave the committed digest declares for w04", () => {
    const declared = (digest as { waves: { waveIndex: number; waveId: string; cellCount: number; buildingCount: number }[] }).waves
      .find((wave) => wave.waveIndex === CENTRAL_UPPER_MANHATTAN_WAVE_INDEX);
    expect(declared).toBeDefined();
    // The wave SLUG is read out of the ledger too, because this wave's two hash
    // domains are named after it: `udt.central-upper-manhattan.*`. A module that
    // renamed the wave without renaming its domains would derive ids under a
    // string that describes nothing.
    expect(CENTRAL_UPPER_MANHATTAN_WAVE_ID).toBe(declared!.waveId);
    expect(CENTRAL_UPPER_MANHATTAN_CELL_COUNT).toBe(declared!.cellCount);
    expect(CENTRAL_UPPER_MANHATTAN_BUILDING_COUNT).toBe(declared!.buildingCount);

    const subset = build();
    expect(subset.ledger.cells).toHaveLength(CENTRAL_UPPER_MANHATTAN_CELL_COUNT);
    expect(subset.buildingIds).toHaveLength(CENTRAL_UPPER_MANHATTAN_BUILDING_COUNT);
    expect(new Set(subset.buildingIds).size).toBe(CENTRAL_UPPER_MANHATTAN_BUILDING_COUNT);
    expect(subset.ledger.cells.every((cell) => cellWaveIndex(cell.cellId) === CENTRAL_UPPER_MANHATTAN_WAVE_INDEX)).toBe(true);
  });

  /**
   * The claim that made this wave the one to materialize next, checked against
   * the digest rather than asserted: `w04` is the LARGEST wave of the six on both
   * axes. If a re-partition ever made another wave larger, this fails rather than
   * letting a document keep saying "the largest wave".
   */
  it("is the largest wave the committed digest declares, on both axes", () => {
    const waves = (digest as { waves: { waveIndex: number; cellCount: number; buildingCount: number }[] }).waves;
    expect(Math.max(...waves.map((wave) => wave.cellCount))).toBe(CENTRAL_UPPER_MANHATTAN_CELL_COUNT);
    expect(Math.max(...waves.map((wave) => wave.buildingCount))).toBe(CENTRAL_UPPER_MANHATTAN_BUILDING_COUNT);
  });

  it("renumbers cell orders contiguously from zero while preserving priority", () => {
    const subset = build();
    expect(subset.ledger.cells.map((cell) => cell.order)).toEqual([...Array(CENTRAL_UPPER_MANHATTAN_CELL_COUNT).keys()]);
    const lexicographic = [...subset.ledger.cells].sort((left, right) => (left.cellId < right.cellId ? -1 : 1));
    expect(lexicographic.map((cell) => cell.cellId)).toEqual(subset.ledger.cells.map((cell) => cell.cellId));
  });

  it("keeps every cell inside the runtime per-cell cap", () => {
    expect(Math.max(...build().ledger.cells.map((cell) => cell.buildingIds.length))).toBeLessThanOrEqual(EXTERIOR_CELL_MAX_BUILDINGS);
  });

  it("passes the accepted ownership checks and reconciles exactly against the digest", () => {
    const subset = build();
    expect(validateCentralUpperManhattanSubsetLedger(subset.ledger)).toEqual({ ok: true, issues: [] });
    const report = reconcileCentralUpperManhattanAgainstDigest(subset, digest);
    expect(report.findings).toEqual([]);
    expect(report.counts.missingOwners).toBe(0);
    expect(report.counts.duplicateOwners).toBe(0);
    expect(report.counts.subsetBuildings).toBe(CENTRAL_UPPER_MANHATTAN_BUILDING_COUNT);
    expect(report.ok).toBe(true);
  });

  /**
   * The disjointness this wave has to prove, and the reason its excluded set is
   * all FOUR earlier waves rather than the three wave w03 named: four waves are
   * promoted now, and the App holds ONE exterior cache across every promoted
   * wave, so a building owned twice would be an ownership contradiction and a
   * cache-identity hazard at once.
   *
   * Wave 3 is excluded by its PARENT cells, which are exactly the buildings the
   * promoted `-p1` successor owns: that successor changed which cells retain
   * bytes, never which buildings the wave owns.
   */
  it("shares no building with any of the four promoted waves", () => {
    const subset = build();
    expect(subset.derivation.exclusions.length).toBeGreaterThan(0);
    expect(subset.derivation.exclusions.every((exclusion) => exclusion.overlapWithSubset === 0)).toBe(true);
    const excludedWaves = new Set(subset.derivation.exclusions.map((exclusion) => cellWaveIndex(exclusion.cellId)));
    expect([...excludedWaves].sort()).toEqual([0, 1, 2, 3]);
    // Every cell of each excluded wave is accounted for, not merely some of them.
    const parentExcluded = parentLedger.cells.filter((cell) => [0, 1, 2, 3].includes(cellWaveIndex(cell.cellId)));
    expect(subset.derivation.exclusions).toHaveLength(parentExcluded.length);
  });

  /**
   * Wave `w05` is deliberately NOT excluded, and that is a statement rather than
   * an omission: it has never been promoted, so it occupies no cache and owns no
   * shipped byte. Excluding it would still be true and would cost a 182-cell
   * overlap scan per build to prove something no release depends on. What matters
   * is that the two partitions are disjoint at all, which the parent ledger's own
   * wave assignment already guarantees and this asserts directly.
   */
  it("is disjoint from the unpromoted northern-manhattan wave as well, by the parent partition", () => {
    const subset = build();
    const owned = new Set(subset.buildingIds);
    const northern = parentLedger.cells.filter((cell) => cellWaveIndex(cell.cellId) === 5);
    expect(northern.length).toBe(182);
    expect(northern.flatMap((cell) => cell.buildingIds).filter((id) => owned.has(id))).toEqual([]);
    expect(CENTRAL_UPPER_MANHATTAN_SUBSET_IDENTITY.exclusionWaveIndexes).not.toContain(5);
  });

  it("derives ids under its OWN hash domains, never an earlier wave's", () => {
    for (const other of [MIDTOWN_CORE_SUBSET_IDENTITY, LOWER_MANHATTAN_SUBSET_IDENTITY, SOUTHERN_REMAINDER_SUBSET_IDENTITY]) {
      expect(CENTRAL_UPPER_MANHATTAN_SUBSET_IDENTITY.ledgerIdDomain).not.toBe(other.ledgerIdDomain);
      expect(CENTRAL_UPPER_MANHATTAN_SUBSET_IDENTITY.baseIdentityDomain).not.toBe(other.baseIdentityDomain);
    }
    // The `udt.<wave-slug>.*` scheme, checked rather than described.
    expect(CENTRAL_UPPER_MANHATTAN_SUBSET_IDENTITY.ledgerIdDomain).toBe(`udt.${CENTRAL_UPPER_MANHATTAN_WAVE_ID}.subset-ledger-id.v1`);
    expect(CENTRAL_UPPER_MANHATTAN_SUBSET_IDENTITY.baseIdentityDomain).toBe(`udt.${CENTRAL_UPPER_MANHATTAN_WAVE_ID}.subset-base-identity.v1`);
    const subset = build();
    expect(subset.ledger.ledgerId).toContain(`ownership-ledger:${CENTRAL_UPPER_MANHATTAN_RELEASE_ID}:`);
    expect(subset.ledger.baseIdentitySet.id).toContain(`:exterior-base-identity:${CENTRAL_UPPER_MANHATTAN_WAVE_ID}:`);
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
    expect(JSON.stringify(reconcileCentralUpperManhattanAgainstDigest(subset, digest), null, 2))
      .toBe(JSON.stringify(committed.reconciliation, null, 2));
  });
});
