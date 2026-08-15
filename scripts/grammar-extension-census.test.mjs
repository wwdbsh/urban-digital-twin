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
const OBSERVATIONS_PATH = join(repositoryRoot, "data", CENSUS_ID, "sample-observations.json");
const PRESENT = existsSync(RECORD_PATH);

/**
 * The record is committed, so its absence is a FAILURE and not a reason to skip.
 * It is read once behind a guard rather than at module scope so that a missing
 * file produces one honest failure below instead of a TypeError in every case.
 */
function readRecord() {
  expect(PRESENT, `${RECORD_PATH} is committed evidence and must be present`).toBe(true);
  return JSON.parse(readFileSync(RECORD_PATH, "utf8"));
}
const record = PRESENT ? readRecord() : null;

describe("T003 grammar-extension census record", () => {
  it("is committed under its own new directory, never inside a frozen one", () => {
    expect(CENSUS_ID).toBe("grammar-extension-20260815");
    expect(RECORD_PATH.startsWith(join(repositoryRoot, "data", CENSUS_ID))).toBe(true);
    expect(PRESENT).toBe(true);
    expect(existsSync(OBSERVATIONS_PATH)).toBe(true);
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
    // Recomputed from the per-building rows rather than read off the record's
    // own summary tables: a summary that agreed only with itself would satisfy
    // any assertion phrased against it.
    const rows = record.refusals;
    const recovered = rows.filter((row) => row.extendedOutcome === "generated");
    const residual = rows.filter((row) => row.extendedOutcome === "refused");
    expect(recovered.length + residual.length).toBe(rows.length);
    expect(recovered.length).toBe(record.counts.recovered);
    expect(residual.length).toBe(record.counts.residualRefused);

    // A recovered building has no post-extension stop code; a refused one does.
    for (const row of recovered) expect(row.extendedStopCode).toBeNull();
    for (const row of residual) expect(typeof row.extendedStopCode).toBe("string");

    // RECLASSIFIED is a strict subset of RESIDUAL — a reclassified building is
    // still refused and must never be counted as progress.
    const reclassified = residual.filter((row) => row.extendedStopCode !== row.shippedStopCode);
    for (const row of reclassified) expect(row.reclassified).toBe(true);
    expect(reclassified.length).toBe(record.reclassificationVersusRecovery.reclassifiedCount);
    expect(reclassified.length).toBeLessThanOrEqual(residual.length);
    expect(recovered.filter((row) => row.reclassified)).toEqual([]);

    // ...and the record's summary tables must agree with the rows they claim to
    // summarise, checked in that direction.
    const tally = (subset) => subset.reduce((counts, row) => {
      counts[row.shippedStopCode] = (counts[row.shippedStopCode] ?? 0) + 1;
      return counts;
    }, {});
    expect(record.reclassificationVersusRecovery.recoveredByShippedStopCode).toEqual(tally(recovered));
    expect(record.reclassificationVersusRecovery.residualByShippedStopCode).toEqual(tally(residual));
  });

  /**
   * The Blender sample and the ring-predicate timings, committed beside the
   * census so ADR 0048's claims can be checked rather than taken on trust.
   *
   * The deterministic half is asserted; the host-observation half is asserted
   * only to be LABELLED, because a wall clock and an external Blender import do
   * not replay byte for byte and a gate that pretended otherwise would fail for
   * the wrong reason.
   */
  it("commits the extension-B sample observations, with host facts labelled as such", () => {
    const bytes = readFileSync(OBSERVATIONS_PATH);
    expect(readFileSync(OBSERVATIONS_PATH.replace(/\.json$/u, ".sha256"), "utf8"))
      .toContain(createHash("sha256").update(bytes).digest("hex"));
    const observations = JSON.parse(bytes.toString("utf8"));
    expect(observations.censusId).toBe(CENSUS_ID);
    expect(observations.envelope).toEqual({ ...V3_EXTENDED_GRAMMAR_OPTIONS });
    expect(observations.hostObservations.note).toContain("NOT REPRODUCIBLE");
    expect(observations.buildings).toHaveLength(8);
    // Four per height band, as the sampling basis claims.
    expect(observations.buildings.filter((row) => row.heightBand === "below-3m")).toHaveLength(4);
    expect(observations.buildings.filter((row) => row.heightBand === "3.0-3.6m")).toHaveLength(4);

    const recoveredIds = new Set(record.refusals.filter((row) => row.extendedOutcome === "generated").map((row) => row.buildingId));
    for (const row of observations.buildings) {
      // Every sampled building really is one the census recovered.
      expect(recoveredIds.has(row.buildingId), row.buildingId).toBe(true);
      // THE CLAIM EXTENSION B RESTS ON: one floor, one tier, and a crown at the
      // sourced height. Deterministic, so it is asserted rather than described.
      expect(row.floorCount, row.buildingId).toBe(1);
      expect(row.effectiveTierCount, row.buildingId).toBe(1);
      expect(row.roofZMm, row.buildingId).toBe(row.planHeightMm);
      expect(row.planHeightMm, row.buildingId).toBeLessThan(3_600);
      // And the Blender import found the sourced ring's own plan extents.
      expect(row.blenderImport.xExtentMatchesSourcedRing, row.buildingId).toBe(true);
      // The rooftop cluster is what makes the imported Z extent exceed the
      // building, which is the defect ADR 0048 routes to T004 rather than a
      // failure of the massing claim above.
      expect(row.silhouetteTopOverSourcedHeight, row.buildingId).toBeGreaterThan(1);
    }
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
