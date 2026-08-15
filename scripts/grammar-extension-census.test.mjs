/**
 * Drift gate for the T003 grammar-extension census.
 *
 * The census itself takes minutes — it plans 45,194 buildings twice and writes
 * both canonical GLBs for every accepted parent — so this suite deliberately
 * does NOT re-run it. Re-running is `node scripts/grammar-extension-census-cli.mjs run`.
 *
 * What it holds instead is everything a reader would otherwise have to take on
 * trust: that the committed record is the bytes its sidecar names, that its
 * internal arithmetic closes, that it reconciles to the goal's own 899, that the
 * differential digest is byte-equal rather than merely present, and that the
 * closed stop-code vocabulary did not grow.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CENSUS_ID,
  GOAL_LEDGER,
  RECORD_PATH,
  SHIPPED_GRAMMAR_OPTIONS,
  T001_PROJECTED_FULL_CITY_ASSET_COUNT,
  censusInvariants,
  repositoryRoot,
} from "./grammar-extension-census-cli.mjs";
import { MIDTOWN_CORE_V3_STOP_CODES } from "../src/release/midtown-core-v3-materialization.ts";
import { V3_EXTENDED_GRAMMAR_OPTIONS } from "../src/domain/deterministic-facade-generator-v3.ts";

const SIDECAR_PATH = RECORD_PATH.replace(/\.json$/u, ".sha256");
const PRESENT = existsSync(RECORD_PATH);
const record = PRESENT ? JSON.parse(readFileSync(RECORD_PATH, "utf8")) : null;

describe("T003 grammar-extension census record", () => {
  it("is committed under its own new directory, never inside a frozen one", () => {
    expect(CENSUS_ID).toBe("grammar-extension-20260815");
    expect(RECORD_PATH.startsWith(join(repositoryRoot, "data", CENSUS_ID))).toBe(true);
    expect(PRESENT).toBe(true);
  });

  it("hashes to the checksum its sidecar records", () => {
    const bytes = readFileSync(RECORD_PATH);
    const digest = createHash("sha256").update(bytes).digest("hex");
    expect(readFileSync(SIDECAR_PATH, "utf8")).toContain(digest);
  });

  it("closes its own arithmetic, one invariant at a time", () => {
    // `censusInvariants` is the CLI's own gate, so the record cannot be written
    // in a state this test would accept and the CLI would not.
    expect(censusInvariants(record)).toEqual([]);
  });

  it("reconciles to the goal's committed 899, rather than restating it", () => {
    expect(record.counts.enumerated).toBe(GOAL_LEDGER.ownedParents);
    expect(record.counts.shippedRefused).toBe(GOAL_LEDGER.refused);
    expect(record.counts.shippedPlanned).toBe(GOAL_LEDGER.materialized);
    expect(record.goalLedgerReconciliation.refusedAgrees).toBe(true);
    expect(record.goalLedgerReconciliation.materializedAgrees).toBe(true);
    expect(record.refusals).toHaveLength(GOAL_LEDGER.refused);
  });

  /**
   * The determinism instrument. Byte-equal digests, not equal counts: T001's own
   * adjudication note is that cardinality equality is not identity, and the
   * whole reason this digest exists is to make that distinction checkable.
   */
  it("proves every accepted plan hash is byte-identical under both envelopes", () => {
    expect(record.differential.shippedDigestSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(record.differential.extendedDigestSha256).toBe(record.differential.shippedDigestSha256);
    expect(record.differential.byteEqual).toBe(true);
    expect(record.differential.movedPlanHashCount).toBe(0);
    expect(record.differential.acceptedSetSize).toBe(GOAL_LEDGER.materialized);
  });

  it("measured both envelopes, and names which is shipped", () => {
    expect(record.envelopes.shipped).toEqual(SHIPPED_GRAMMAR_OPTIONS);
    expect(record.envelopes.extended).toEqual({ ...V3_EXTENDED_GRAMMAR_OPTIONS });
    // The extension is a MEASUREMENT, not an activation: the shipped envelope is
    // still the pre-extension one.
    expect(record.envelopes.shipped.lowRiseFloorHeight).toBe(false);
    expect(record.envelopes.shipped.maxRingVertices).toBe(64);
  });

  it("adds no stop code, and draws every observed code from the closed twelve", () => {
    expect(record.stopCodesAdded).toEqual([]);
    expect(record.closedStopCodeVocabulary).toEqual([...MIDTOWN_CORE_V3_STOP_CODES]);
    const observed = new Set(record.refusals.flatMap((row) => [row.shippedStopCode, row.extendedStopCode]).filter((code) => code !== null));
    for (const code of observed) expect(MIDTOWN_CORE_V3_STOP_CODES).toContain(code);
  });

  it("keeps RECOVERY and RECLASSIFICATION as separate numbers", () => {
    const table = record.reclassificationVersusRecovery;
    const recovered = Object.values(table.recoveredByShippedStopCode).reduce((total, value) => total + value, 0);
    const residual = Object.values(table.residualByShippedStopCode).reduce((total, value) => total + value, 0);
    expect(recovered).toBe(record.counts.recovered);
    expect(residual).toBe(record.counts.residualRefused);
    // A reclassified building is still refused: it must never be counted as
    // recovered, which is what this equality forbids.
    expect(table.reclassifiedCount).toBeLessThanOrEqual(record.counts.residualRefused);
  });

  it("carries a gate-failure VECTOR for every refusal, not just the priority winner", () => {
    for (const row of record.refusals) {
      expect(typeof row.gates.vertexCount).toBe("number");
      expect(typeof row.gates.heightMm).toBe("number");
      expect(typeof row.gates.heightBelowNominalFloor).toBe("boolean");
      expect(typeof row.gates.vertexCountAboveShippedCap).toBe("boolean");
    }
  });

  it("states extension C as a decision with its measured basis, not as a silence", () => {
    // C recovers nothing by design, so the record has to carry the measurement
    // the refusal rests on rather than merely omitting the extension.
    expect(record.extensionC.change).toContain("NONE");
    expect(record.extensionC.belowAreaFloorCount).toBeGreaterThan(0);
    expect(record.extensionC.areaSquareMeters.max).toBeLessThan(20);
    expect(Object.keys(record.extensionC.areaBandCounts).length).toBeGreaterThan(0);
  });

  it("reconciles against T001's projection instead of inheriting it", () => {
    expect(record.projectionReconciliation.t001ProjectedFullCityAssetCount).toBe(T001_PROJECTED_FULL_CITY_ASSET_COUNT);
    expect(record.projectionReconciliation.impliedRecoverable).toBe(T001_PROJECTED_FULL_CITY_ASSET_COUNT - GOAL_LEDGER.materialized);
    expect(record.projectionReconciliation.observedRecoverable).toBe(record.counts.recovered);
  });
});
