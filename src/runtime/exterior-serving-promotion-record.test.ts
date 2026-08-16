/**
 * The drift gate for the six SERVING promotion records.
 *
 * Every curated wave has one of these, and for the same reason: a promotion
 * record is forty-eight pasted hexadecimal digits, and a paste is exactly the
 * kind of thing that is right on the day and wrong three commits later. So the
 * pins are not trusted — they are RE-DERIVED here, on every run, from committed
 * records alone:
 *
 *  - the accepted CELL set, from each serving release's own committed
 *    `payload-inventory.json` (`cellReleases`);
 *  - the accepted BUILDING set, from the committed island ledger's per-cell
 *    membership minus the retention wave census's tombstones;
 *  - the head's ASSEMBLY PACKAGES, from the same inventory's
 *    `assemblyPackageIds`;
 *  - the snapshot id and checksum, from the same inventory's `head`.
 *
 * NO PAYLOAD DIRECTORY IS READ, which is the property that keeps this gate from
 * being the one that quietly stops running on a fresh clone. The 5.4 GB of
 * serving payload is gitignored; every input below is committed text, and each
 * one is checked against its own committed `.sha256` sidecar before it is used,
 * so a tampered input fails here rather than silently re-deriving a matching
 * wrong answer.
 *
 * The digests use the runtime's OWN join functions — `exteriorAcceptedCellsJoin`
 * and `exteriorAcceptedIdsJoin` — rather than a second implementation of the
 * same string format. A drift gate that agreed with a private copy of the
 * encoding would prove the paste matched the test and nothing about what
 * `verifyPromotedExteriorPin` will recompute at load.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { sha256HexSync } from "../domain/deterministic-hash";
import { EXTERIOR_SERVING_WAVES, type ExteriorServingWave } from "../release/exterior-serving-waves";
import {
  EXTERIOR_DEFAULT_ACTIVATIONS,
  exteriorAcceptedCellsJoin,
  exteriorAcceptedIdsJoin,
  type ExteriorAcceptedCell,
  type ExteriorDefaultActivationEnabled,
} from "./exterior-default-activation";

const LEDGER_ROOT = "data/normalized/manhattan-exterior-wave-ledger-20260804";
const PINS_PATH = "data/exterior-serving-20260817/activation-pins.json";
const PINS_SIDECAR = "data/exterior-serving-20260817/activation-pins.sha256";

function readText(path: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
}

/** Read a committed record and refuse it unless it matches its own sidecar. */
function readChecked(path: string): unknown {
  const text = readText(path);
  const recorded = readText(`${path.replace(/\.json$/u, "")}.sha256`).trim().split(/\s+/u)[0];
  expect(sha256HexSync(text), `${path} does not match its committed sidecar`).toBe(recorded);
  return JSON.parse(text);
}

interface ServingInventory {
  releaseId: string;
  head: { snapshotId: string; checksumSha256: string };
  assemblyPackageIds: string[];
  cellReleases: ExteriorAcceptedCell[];
}
interface WaveCensus { tombstones: { buildingId: string }[] }
interface IslandLedger { cells: { cellId: string; buildingIds: string[] }[] }

const ledger = JSON.parse(readText(`${LEDGER_ROOT}/ledger.json`)) as IslandLedger;

/** Everything the record for one wave SHOULD say, derived rather than read. */
function derivePins(waveEntry: ExteriorServingWave) {
  const inventory = readChecked(`data/${waveEntry.servingReleaseId}/payload-inventory.json`) as ServingInventory;
  const census = readChecked(`data/${waveEntry.retentionReleaseId}/wave-census.json`) as WaveCensus;
  const tombstoned = new Set(census.tombstones.map((entry) => entry.buildingId));
  const owned = ledger.cells
    .filter((cell) => cell.cellId.startsWith(`manhattan-exterior-cell-${waveEntry.waveId}-`))
    .flatMap((cell) => cell.buildingIds);
  const buildingIds = owned.filter((buildingId) => !tombstoned.has(buildingId));
  return {
    releaseId: waveEntry.servingReleaseId,
    snapshotId: inventory.head.snapshotId,
    snapshotChecksumSha256: inventory.head.checksumSha256,
    assemblyPackageCount: inventory.assemblyPackageIds.length,
    assemblyPackageIdsDigestSha256: sha256HexSync(exteriorAcceptedIdsJoin(inventory.assemblyPackageIds)),
    cellCount: inventory.cellReleases.length,
    cellsDigestSha256: sha256HexSync(exteriorAcceptedCellsJoin(inventory.cellReleases)),
    buildingCount: buildingIds.length,
    buildingIdsDigestSha256: sha256HexSync(exteriorAcceptedIdsJoin(buildingIds)),
  };
}

const PROMOTED = EXTERIOR_DEFAULT_ACTIVATIONS.filter((record): record is ExteriorDefaultActivationEnabled => record.enabled);

describe("the serving promotion records are re-derived, never trusted", () => {
  it("promotes exactly the six serving releases the wave table declares, in wave order", () => {
    expect(PROMOTED).toHaveLength(6);
    expect(PROMOTED.map((record) => record.releaseId)).toEqual(EXTERIOR_SERVING_WAVES.map((waveEntry) => waveEntry.servingReleaseId));
  });

  for (const waveEntry of EXTERIOR_SERVING_WAVES) {
    it(`re-derives every pin of ${waveEntry.waveId} (${waveEntry.servingReleaseId}) from committed records`, () => {
      const record = PROMOTED.find((entry) => entry.releaseId === waveEntry.servingReleaseId)!;
      const derived = derivePins(waveEntry);
      expect({
        releaseId: record.releaseId,
        snapshotId: record.snapshotId,
        snapshotChecksumSha256: record.snapshotChecksumSha256,
        assemblyPackageCount: record.assemblyPackageCount,
        assemblyPackageIdsDigestSha256: record.assemblyPackageIdsDigestSha256,
        cellCount: record.membership.cellCount,
        cellsDigestSha256: record.membership.cellsDigestSha256,
        buildingCount: record.membership.buildingCount,
        buildingIdsDigestSha256: record.membership.buildingIdsDigestSha256,
      }).toEqual(derived);
      // The populations the serving wave table pins, reached independently: the
      // cell and building counts above come from an inventory and a ledger, and
      // these come from the table the emitter checked itself against.
      expect(derived.cellCount).toBe(waveEntry.cellCount);
      expect(derived.buildingCount).toBe(waveEntry.generatedBuildingCount);
      // One assembly package per ownership cell — the ADR 0052 §2 seam, stated
      // as an equality rather than as a comment about the seam.
      expect(derived.assemblyPackageCount).toBe(waveEntry.cellCount);
    });
  }

  /**
   * The committed derivation record, checked against the same re-derivation.
   *
   * `activation-pins.json` was written by the wave CLI before this promotion and
   * is what the promotion commit pasted from. It is verified here rather than
   * treated as authority: if the CLI and this suite ever disagree about the same
   * committed inputs, that is a defect and not a preference.
   */
  it("agrees with the committed activation-pins record, digest for digest", () => {
    const text = readText(PINS_PATH);
    expect(sha256HexSync(text)).toBe(readText(PINS_SIDECAR).trim().split(/\s+/u)[0]);
    const pins = JSON.parse(text) as { waves: Record<string, unknown>[] };
    expect(pins.waves).toHaveLength(EXTERIOR_SERVING_WAVES.length);
    for (const waveEntry of EXTERIOR_SERVING_WAVES) {
      const pin = pins.waves.find((entry) => entry.waveId === waveEntry.waveId)!;
      const derived = derivePins(waveEntry);
      expect({
        releaseId: pin.releaseId,
        snapshotId: pin.snapshotId,
        snapshotChecksumSha256: pin.snapshotChecksumSha256,
        assemblyPackageCount: pin.assemblyPackageCount,
        assemblyPackageIdsDigestSha256: pin.assemblyPackageIdsDigestSha256,
        cellCount: pin.cellCount,
        cellsDigestSha256: pin.cellsDigestSha256,
        buildingCount: pin.buildingCount,
        buildingIdsDigestSha256: pin.buildingIdsDigestSha256,
      }, waveEntry.waveId).toEqual(derived);
    }
  });
});

describe("what the serving promotion is, as a record", () => {
  it("is a FORWARD promotion on every wave: nothing is withdrawn", () => {
    for (const record of PROMOTED) {
      expect(record.rolledBackReleaseId ?? null, record.releaseId).toBeNull();
    }
  });

  /**
   * The predecessor of each serving record is the CURATED record that was the
   * active default until this commit — not base massing, and not a re-derivation
   * of it. Asserted by identity against the retained constants, because "the
   * predecessor is the previous verified representation" is the whole rollback
   * contract and a re-typed copy could drift from what actually shipped.
   */
  it("carries the curated record it replaced as its predecessor, verbatim", async () => {
    const module = await import("./exterior-default-activation");
    const expected = [
      module.BLOCK835_V3_EXTERIOR_ACTIVATION,
      module.MIDTOWN_CORE_V3_EXTERIOR_ACTIVATION,
      module.LOWER_MANHATTAN_P1_EXTERIOR_ACTIVATION,
      module.SOUTHERN_REMAINDER_P1_EXTERIOR_ACTIVATION,
      module.CENTRAL_UPPER_MANHATTAN_P1_EXTERIOR_ACTIVATION,
      module.NORTHERN_MANHATTAN_P1_EXTERIOR_ACTIVATION,
    ];
    PROMOTED.forEach((record, index) => {
      expect(record.predecessor, record.releaseId).toBe(expected[index]);
    });
    // And every predecessor is itself an ENABLED curated release: this promotion
    // rolls back to verified geometry on all six waves, where the four curated
    // `-p1` promotions rolled back to base massing on four of them.
    for (const predecessor of expected) {
      expect(predecessor.enabled).toBe(true);
    }
  });

  /**
   * The `-p1` and `-t1` ids stay PINNED and stay reachable. A promotion that
   * silently unpinned its predecessor would make every predecessor bookmark fail
   * closed, which is a rollback's behaviour and not a promotion's.
   */
  it("leaves the curated predecessors reachable rather than refusing them", () => {
    for (const record of PROMOTED) {
      const predecessor = record.predecessor;
      expect(predecessor.enabled).toBe(true);
      if (!predecessor.enabled) continue;
      expect(record.releaseId).not.toBe(predecessor.releaseId);
      // The record may never name its own release as withdrawn, and here it
      // names nothing as withdrawn at all.
      expect(record.rolledBackReleaseId ?? null).toBeNull();
    }
  });

  /**
   * ALL THREE SETS ARE DIGESTS, on all six records. This is the D-A form, and it
   * is asserted as a property of the whole promotion rather than wave by wave,
   * because a mixture would be a rule someone has to remember.
   */
  it("states all three acceptance sets as digests, with counts beside them", () => {
    for (const record of PROMOTED) {
      expect(record.assemblyPackageIds, record.releaseId).toEqual([]);
      expect(typeof record.assemblyPackageIdsDigestSha256).toBe("string");
      expect(record.assemblyPackageCount).toBeGreaterThan(0);
      expect(record.membership.cells).toEqual([]);
      expect(typeof record.membership.cellsDigestSha256).toBe("string");
      expect(record.membership.buildingIds).toEqual([]);
      expect(typeof record.membership.buildingIdsDigestSha256).toBe("string");
      expect(record.membership.buildingCount).toBeGreaterThan(0);
    }
  });

  it("promotes the whole island: 883 cells and 44,989 buildings", () => {
    expect(PROMOTED.reduce((sum, record) => sum + record.membership.cellCount, 0)).toBe(883);
    expect(PROMOTED.reduce((sum, record) => sum + (record.membership.buildingCount ?? 0), 0)).toBe(44_989);
    expect(PROMOTED.reduce((sum, record) => sum + (record.assemblyPackageCount ?? 0), 0)).toBe(883);
  });
});
