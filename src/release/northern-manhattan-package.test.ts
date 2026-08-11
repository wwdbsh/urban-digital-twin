import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256, EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID } from "../domain/exterior-fullsnapshot-input.ts";
import type { ExteriorOwnershipLedger } from "./exterior-release.ts";
import { EXTERIOR_CELL_MAX_BUILDINGS, EXTERIOR_WAVE_PLAN, cellWaveIndex } from "./exterior-wave-ledger.ts";
import { exteriorWaveArtifactChecksum } from "./exterior-wave-subset.ts";
import {
  NORTHERN_MANHATTAN_BUILDING_COUNT,
  NORTHERN_MANHATTAN_CELL_COUNT,
  NORTHERN_MANHATTAN_RELEASE_ID,
  NORTHERN_MANHATTAN_SUBSET_IDENTITY,
  NORTHERN_MANHATTAN_WAVE_ID,
  NORTHERN_MANHATTAN_WAVE_INDEX,
  buildNorthernManhattanSubsetLedger,
  reconcileNorthernManhattanAgainstDigest,
  validateNorthernManhattanSubsetLedger,
} from "./northern-manhattan-package.ts";
import { CENTRAL_UPPER_MANHATTAN_SUBSET_IDENTITY } from "./central-upper-manhattan-package.ts";
import { LOWER_MANHATTAN_SUBSET_IDENTITY } from "./lower-manhattan-package.ts";
import { MIDTOWN_CORE_SUBSET_IDENTITY } from "./midtown-core-package.ts";
import { SOUTHERN_REMAINDER_SUBSET_IDENTITY } from "./southern-remainder-package.ts";

const LEDGER_ROOT = "data/normalized/manhattan-exterior-wave-ledger-20260804";
const RECORD_ROOT = "data/northern-manhattan-20260812";

function readText(path: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(readFileSync(path)));
}

const parentLedger = JSON.parse(readText(`${LEDGER_ROOT}/ledger.json`)) as ExteriorOwnershipLedger;
const parentLedgerChecksumSha256 = exteriorWaveArtifactChecksum(parentLedger);
const digest = JSON.parse(readText(`${LEDGER_ROOT}/membership-digest.json`)) as never;

interface DigestWave { waveIndex: number; waveId: string; cellCount: number; buildingCount: number }
const digestWaves = (digest as { waves: DigestWave[] }).waves;

function build() {
  return buildNorthernManhattanSubsetLedger({
    parentLedger,
    parentLedgerChecksumSha256,
    baseReleaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID,
    baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
  });
}

/** Upper of the two middle values, matching the entry-budget derivation. */
function median(counts: readonly number[]): number {
  const sorted = [...counts].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function waveCellCounts(waveIndex: number): number[] {
  return parentLedger.cells.filter((cell) => cellWaveIndex(cell.cellId) === waveIndex).map((cell) => cell.buildingIds.length);
}

describe("northern-manhattan derived-subset ownership ledger", () => {
  it("pins the committed parent ledger by its own recorded checksum", () => {
    const recorded = readText(`${LEDGER_ROOT}/ledger.sha256`).trim().split(/\s+/u)[0];
    expect(parentLedgerChecksumSha256).toBe(recorded);
  });

  /**
   * The declared shape is not a target the pipeline aims at, it is the committed
   * digest's own statement. Reading it out of the digest rather than repeating the
   * constants is what makes this a check.
   */
  it("owns exactly the wave the committed digest declares for w05", () => {
    const declared = digestWaves.find((wave) => wave.waveIndex === NORTHERN_MANHATTAN_WAVE_INDEX);
    expect(declared).toBeDefined();
    // The wave SLUG is read out of the ledger too, because this wave's two hash
    // domains are named after it: `udt.northern-manhattan.*`. A module that renamed
    // the wave without renaming its domains would derive ids under a string that
    // describes nothing.
    expect(NORTHERN_MANHATTAN_WAVE_ID).toBe(declared!.waveId);
    expect(NORTHERN_MANHATTAN_CELL_COUNT).toBe(declared!.cellCount);
    expect(NORTHERN_MANHATTAN_BUILDING_COUNT).toBe(declared!.buildingCount);

    const subset = build();
    expect(subset.ledger.cells).toHaveLength(NORTHERN_MANHATTAN_CELL_COUNT);
    expect(subset.buildingIds).toHaveLength(NORTHERN_MANHATTAN_BUILDING_COUNT);
    expect(new Set(subset.buildingIds).size).toBe(NORTHERN_MANHATTAN_BUILDING_COUNT);
    expect(subset.ledger.cells.every((cell) => cellWaveIndex(cell.cellId) === NORTHERN_MANHATTAN_WAVE_INDEX)).toBe(true);
  });

  /**
   * "THE LAST WAVE" IS A CLAIM ABOUT THE COMMITTED LEDGER, SO IT IS CHECKED
   * AGAINST IT.
   *
   * Every document this task writes leans on the statement that no seventh wave
   * exists, and the domain registry's hypothetical was made permanently fictional
   * on the strength of it. If a re-partition ever added a wave, this fails rather
   * than letting the prose keep saying "the last".
   */
  it("is the highest wave index the committed digest and the declared plan both contain", () => {
    expect(Math.max(...digestWaves.map((wave) => wave.waveIndex))).toBe(NORTHERN_MANHATTAN_WAVE_INDEX);
    expect(digestWaves).toHaveLength(6);
    expect(Math.max(...EXTERIOR_WAVE_PLAN.map((wave) => wave.waveIndex))).toBe(NORTHERN_MANHATTAN_WAVE_INDEX);
    expect(EXTERIOR_WAVE_PLAN).toHaveLength(6);
    // The plan and the digest agree about every wave, not merely about the last.
    expect(EXTERIOR_WAVE_PLAN.map((wave) => wave.waveId)).toEqual(digestWaves.map((wave) => wave.waveId));
  });

  /**
   * THE FACT THAT SET THIS CANARY'S CEILING, measured rather than asserted.
   *
   * The three canaries before this one used an 80-entry self-imposed ceiling. It
   * admits nothing here, because wave `w05` has the LARGEST cells of the six by
   * the statistic that matters to an order-derived walk — its median cell owns 55
   * buildings against `w04`'s 48 — and its first cell in priority order owns 86,
   * more than the whole 80-entry ceiling.
   *
   * Both halves are checked against the committed ledger so that ADR 0037's
   * account of why the ceiling moved cannot drift from the partition it describes.
   */
  it("has the largest median cell of the six waves, and a leading cell larger than the old 80-entry ceiling", () => {
    const medians = digestWaves.map((wave) => ({ waveId: wave.waveId, median: median(waveCellCounts(wave.waveIndex)) }));
    expect(Math.max(...medians.map((entry) => entry.median))).toBe(55);
    expect(medians.find((entry) => entry.median === 55)!.waveId).toBe(NORTHERN_MANHATTAN_WAVE_ID);

    const leading = build().ledger.cells[0]!;
    expect(leading.buildingIds).toHaveLength(86);
    expect(leading.buildingIds.length).toBeGreaterThan(80);
    // And the second cell does not fit beside it under any ceiling this task would
    // call modest: 86 + 42 = 128.
    expect(build().ledger.cells[1]!.buildingIds).toHaveLength(42);
  });

  it("renumbers cell orders contiguously from zero while preserving priority", () => {
    const subset = build();
    expect(subset.ledger.cells.map((cell) => cell.order)).toEqual([...Array(NORTHERN_MANHATTAN_CELL_COUNT).keys()]);
    const lexicographic = [...subset.ledger.cells].sort((left, right) => (left.cellId < right.cellId ? -1 : 1));
    expect(lexicographic.map((cell) => cell.cellId)).toEqual(subset.ledger.cells.map((cell) => cell.cellId));
  });

  it("keeps every cell inside the runtime per-cell cap", () => {
    expect(Math.max(...build().ledger.cells.map((cell) => cell.buildingIds.length))).toBeLessThanOrEqual(EXTERIOR_CELL_MAX_BUILDINGS);
  });

  it("passes the accepted ownership checks and reconciles exactly against the digest", () => {
    const subset = build();
    expect(validateNorthernManhattanSubsetLedger(subset.ledger)).toEqual({ ok: true, issues: [] });
    const report = reconcileNorthernManhattanAgainstDigest(subset, digest);
    expect(report.findings).toEqual([]);
    expect(report.counts.missingOwners).toBe(0);
    expect(report.counts.duplicateOwners).toBe(0);
    expect(report.counts.subsetBuildings).toBe(NORTHERN_MANHATTAN_BUILDING_COUNT);
    expect(report.ok).toBe(true);
  });

  /**
   * The disjointness this wave has to prove, and the reason its excluded set is all
   * FIVE earlier waves: every one of them is promoted now, and the App holds ONE
   * exterior cache across every promoted wave, so a building owned twice would be
   * an ownership contradiction and a cache-identity hazard at once.
   *
   * Waves 2, 3 and 4 are excluded by their PARENT cells, which are exactly the
   * buildings their promoted `-p1` successors own: a successor changed which cells
   * retain bytes, never which buildings the wave owns.
   */
  it("shares no building with any of the five promoted waves", () => {
    const subset = build();
    expect(subset.derivation.exclusions.length).toBeGreaterThan(0);
    expect(subset.derivation.exclusions.every((exclusion) => exclusion.overlapWithSubset === 0)).toBe(true);
    const excludedWaves = new Set(subset.derivation.exclusions.map((exclusion) => cellWaveIndex(exclusion.cellId)));
    expect([...excludedWaves].sort()).toEqual([0, 1, 2, 3, 4]);
    // Every cell of each excluded wave is accounted for, not merely some of them.
    const parentExcluded = parentLedger.cells.filter((cell) => [0, 1, 2, 3, 4].includes(cellWaveIndex(cell.cellId)));
    expect(subset.derivation.exclusions).toHaveLength(parentExcluded.length);
  });

  /**
   * THE CLAIM ONLY THE LAST WAVE CAN MAKE, and the reason it is worth a test of its
   * own.
   *
   * Every earlier wave's exclusion list was COMPLETE-FOR-NOW: it named the waves
   * that had been promoted when it was derived, and a later wave existed that it
   * said nothing about. This one has no such remainder. Its own cells plus its
   * excluded cells are the WHOLE parent ledger, and its own buildings plus the
   * excluded waves' buildings are the whole 45,194-building base identity set.
   *
   * So this asserts partition coverage rather than pairwise disjointness: after
   * this release every building of the pinned base is owned by exactly one wave
   * release, with none left over and none owned twice.
   */
  it("completes the parent partition: its cells plus its exclusions are the whole ledger", () => {
    const subset = build();
    expect(subset.ledger.cells.length + subset.derivation.exclusions.length).toBe(parentLedger.cells.length);
    expect(parentLedger.cells).toHaveLength(883);

    const excludedIds = new Set(
      parentLedger.cells
        .filter((cell) => cellWaveIndex(cell.cellId) !== NORTHERN_MANHATTAN_WAVE_INDEX)
        .flatMap((cell) => cell.buildingIds),
    );
    const owned = new Set(subset.buildingIds);
    expect(excludedIds.size + owned.size).toBe(parentLedger.baseIdentitySet.buildingCount);
    expect(parentLedger.baseIdentitySet.buildingCount).toBe(45_194);
    expect([...owned].filter((id) => excludedIds.has(id))).toEqual([]);
    // No wave index outside the declared plan appears in the parent at all, which
    // is what makes "the whole ledger" a closed statement rather than a count.
    const planIndexes = new Set(EXTERIOR_WAVE_PLAN.map((wave) => wave.waveIndex));
    expect(parentLedger.cells.every((cell) => planIndexes.has(cellWaveIndex(cell.cellId)))).toBe(true);
  });

  it("derives ids under its OWN hash domains, never an earlier wave's", () => {
    for (const other of [MIDTOWN_CORE_SUBSET_IDENTITY, LOWER_MANHATTAN_SUBSET_IDENTITY, SOUTHERN_REMAINDER_SUBSET_IDENTITY, CENTRAL_UPPER_MANHATTAN_SUBSET_IDENTITY]) {
      expect(NORTHERN_MANHATTAN_SUBSET_IDENTITY.ledgerIdDomain).not.toBe(other.ledgerIdDomain);
      expect(NORTHERN_MANHATTAN_SUBSET_IDENTITY.baseIdentityDomain).not.toBe(other.baseIdentityDomain);
    }
    // The `udt.<wave-slug>.*` scheme, checked rather than described.
    expect(NORTHERN_MANHATTAN_SUBSET_IDENTITY.ledgerIdDomain).toBe(`udt.${NORTHERN_MANHATTAN_WAVE_ID}.subset-ledger-id.v1`);
    expect(NORTHERN_MANHATTAN_SUBSET_IDENTITY.baseIdentityDomain).toBe(`udt.${NORTHERN_MANHATTAN_WAVE_ID}.subset-base-identity.v1`);
    const subset = build();
    expect(subset.ledger.ledgerId).toContain(`ownership-ledger:${NORTHERN_MANHATTAN_RELEASE_ID}:`);
    expect(subset.ledger.baseIdentitySet.id).toContain(`:exterior-base-identity:${NORTHERN_MANHATTAN_WAVE_ID}:`);
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
    expect(JSON.stringify(reconcileNorthernManhattanAgainstDigest(subset, digest), null, 2))
      .toBe(JSON.stringify(committed.reconciliation, null, 2));
  });
});
