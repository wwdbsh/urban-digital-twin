import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { EXTERIOR_TWO_LOD_SERVING_NEAR_RING_METERS } from "../src/release/exterior-serving-release.ts";
import { EXTERIOR_RUNTIME_BUDGETS } from "../src/runtime/exterior-cell-runtime.ts";

/**
 * The drift instrument for T001's two-LOD pose captures.
 *
 * It holds three things and deliberately not a fourth:
 *
 *   1. the record still matches its sidecar, and every still it names is
 *      present at the checksum it declares;
 *   2. the universal gates ADR 0057 §4.2 registered for EVERY pose were
 *      actually evaluated and actually passed;
 *   3. the request-level LOD readings still say what the ADR reports them as
 *      saying, so editing the prose without re-capturing breaks a test.
 *
 * It does NOT judge whether 400 m reads correctly on screen. That is T007's
 * measurement, and ADR 0057 Part 5 says so.
 */
const DIR = "data/exterior-two-lod-serving-20260818";
const RECORD_PATH = `${DIR}/pose-captures.json`;
const text = readFileSync(RECORD_PATH, "utf8");
const record = JSON.parse(text);
const pose = (id) => record.poses.find((entry) => entry.poseId === id);

describe("the two-LOD pose captures are intact", () => {
  it("matches its committed checksum sidecar", () => {
    expect(readFileSync(`${DIR}/pose-captures.sha256`, "utf8")).toBe(`${createHash("sha256").update(text).digest("hex")}  pose-captures.json\n`);
  });

  it("captured all six registered poses, once each, in one attempt", () => {
    expect(record.poses.map((entry) => entry.poseId)).toEqual(["P1", "P2", "P3", "P4", "P5", "P6"]);
    expect(record.attemptCount).toBe(1);
    expect(record.attemptPolicy).toContain("RECORDED and NOT re-run");
    // The scratch browser was cleaned up and the count was READ, not assumed.
    expect(record.survivingChromeProcessCount).toBe(0);
  });

  it("names every still at the checksum it declares", () => {
    for (const entry of record.poses) {
      const path = `${DIR}/${entry.still.file}`;
      expect(existsSync(path), `${entry.poseId} still is missing`).toBe(true);
      expect(createHash("sha256").update(readFileSync(path)).digest("hex"), `${entry.poseId} still drifted`).toBe(entry.still.sha256);
    }
  });
});

describe("the universal gates registered for every pose", () => {
  it("evaluated and passed at all six poses", () => {
    for (const entry of record.poses) {
      const gates = entry.universalGates;
      expect(gates.failedCellCount, `${entry.poseId} failed cells`).toBe(0);
      expect(gates.fallbackCellCount, `${entry.poseId} fallback-to-massing`).toBe(0);
      expect(gates.failedArtifactCount, `${entry.poseId} failed artifacts`).toBe(0);
      expect(gates.externalHosts, `${entry.poseId} contacted an external host`).toEqual([]);
      expect(gates.peakConcurrentRequests, `${entry.poseId} concurrency`).toBeLessThanOrEqual(EXTERIOR_RUNTIME_BUDGETS.maxConcurrentRequests);
      expect(gates.pass, `${entry.poseId} universal gates`).toBe(true);
    }
  });

  it("pins the ceiling it judged against", () => {
    expect(record.requestCeiling).toBe(4);
    expect(record.nearRingMeters).toBe(EXTERIOR_TWO_LOD_SERVING_NEAR_RING_METERS);
    expect(record.nearRingMeters).toBe(400);
  });
});

describe("the request-level LOD readings the ADR reports", () => {
  it("labels itself a request reading rather than a pixel reading", () => {
    // The honesty constraint. If this sentence is ever removed, the numbers
    // below start reading as claims about what a building LOOKS like.
    expect(record.lodReadingMethod).toContain("REQUEST-LEVEL");
    expect(record.lodReadingMethod).toContain("not a pixel reading");
  });

  it("P3 mid ring is dominated by the coarse level", () => {
    const entry = pose("P3");
    expect(entry.lodRequests.lod1DistinctCount).toBeGreaterThan(entry.lodRequests.lod0DistinctCount * 5);
    expect(entry.lodRequests.lod1DistinctCount).toBeGreaterThanOrEqual(50);
  });

  it("P6 Block 835 pulls the FINE level inside 250 m, which is the forward-annotated change", () => {
    const entry = pose("P6");
    expect(entry.pose.height).toBeLessThan(250);
    expect(entry.lodRequests.lod0DistinctCount).toBeGreaterThan(entry.lodRequests.lod1DistinctCount);
  });

  it("P5 pulls BOTH levels in the fallback-carrying wave", () => {
    // The registered shape: fallback parents keep an unbounded fine level and
    // resolve lod_0 at range while their neighbours resolve lod_1.
    const entry = pose("P5");
    expect(entry.lodRequests.lod1DistinctCount).toBeGreaterThan(10);
    expect(entry.lodRequests.lod0DistinctCount).toBeGreaterThan(0);
  });

  it("P4 is recorded and does NOT gate, exactly as registered", () => {
    expect(pose("P4").gated).toBe(false);
    for (const id of ["P1", "P2", "P3", "P5", "P6"]) expect(pose(id).gated, id).toBe(true);
  });
});

/**
 * THE INSTRUMENT DEFECT AND ITS RE-RUN, with BOTH readings pinned.
 *
 * The probe payload never carried `residentUnitIds` or `distanceMetersByUnitId`
 * at all — and `distanceMetersByUnitId` is a `Map`, which `JSON.stringify`
 * renders as `{}` even when present. The first capture therefore recorded zero
 * resident cells and zero distances at ALL SIX poses, and P2's straddle gate
 * could not be proven.
 *
 * It was NOT a finding about the scheduler: the request-level LOD readings in
 * the same captures show it resolving cells throughout. P2 and P3 were re-taken
 * under the INSTRUMENT-DEFECT RE-RUN convention, single attempt.
 *
 * Both readings are pinned. The defective zero stays on the record under
 * `instrumentDefectAndReRun.supersededReadings`, and the fixed non-empty reading
 * is in `poses[]`. A later edit that dropped either one has to argue with this.
 */
describe("the per-cell distance instrument: the defect, and the reading that replaced it", () => {
  it("keeps the DEFECTIVE zero reading, superseded with its reason", () => {
    const defect = record.instrumentDefectAndReRun;
    expect(defect.supersededReadings.length).toBe(2);
    for (const superseded of defect.supersededReadings) {
      expect(["P2", "P3"]).toContain(superseded.poseId);
      expect(superseded.residentUnitCount, `${superseded.poseId} superseded reading`).toBe(0);
      expect(superseded.distances.count, `${superseded.poseId} superseded reading`).toBe(0);
      expect(superseded.reason).toContain("Instrument defect");
    }
    expect(defect.whatItWasNot).toContain("NOT a finding about the scheduler");
    expect(defect.convention).toContain("INSTRUMENT-DEFECT RE-RUN");
    // The second defect the re-run itself introduced, kept rather than tidied.
    expect(defect.aSecondDefectFoundDuringTheReRun).toContain("CLOBBERED");
  });

  it("carries the FIXED non-empty reading at the two re-captured poses", () => {
    for (const poseId of ["P2", "P3"]) {
      const entry = record.poses.find((pose) => pose.poseId === poseId);
      expect(entry.recaptured, poseId).toBe(true);
      expect(entry.residentUnitCount, poseId).toBeGreaterThan(0);
      expect(entry.distances.count, poseId).toBe(entry.residentUnitCount);
      expect(entry.distances.nearRingCells.length + entry.distances.farRingCells.length, poseId).toBeGreaterThan(0);
    }
  });

  it("leaves the four poses that were NOT re-taken exactly as they were", () => {
    for (const poseId of ["P1", "P4", "P5", "P6"]) {
      const entry = record.poses.find((pose) => pose.poseId === poseId);
      expect(entry.recaptured, poseId).toBeUndefined();
      // Their distance reading is still the defective zero, and saying so is the
      // point: only the two poses that needed the instrument were re-taken.
      expect(entry.distances.count, poseId).toBe(0);
    }
  });

  it("proves the P2 straddle with NAMED cells on both sides of the ring", () => {
    const straddle = record.p2Straddle;
    expect(straddle.verdict).toBe("PROVEN");
    expect(straddle.ringMeters).toBe(400);
    expect(straddle.nearRingCount).toBeGreaterThan(0);
    expect(straddle.farRingCount).toBeGreaterThan(0);
    expect(straddle.closestBelowRing.meters).toBeLessThanOrEqual(400);
    expect(straddle.closestAboveRing.meters).toBeGreaterThan(400);
    for (const cell of straddle.nearRingCells) expect(cell.meters, cell.unitId).toBeLessThanOrEqual(400);
    for (const cell of straddle.farRingCells) expect(cell.meters, cell.unitId).toBeGreaterThan(400);
  });

  it("claims the crossing=reload proof at BUILDING granularity and refuses it at cell", () => {
    const crossing = record.crossingIsReload;
    expect(crossing.verdict).toContain("PROVEN AT BUILDING GRANULARITY");
    expect(crossing.verdict).toContain("NOT PROVEN AT CELL GRANULARITY");
    expect(crossing.buildingsRefetchedAtTheOtherLevel).toBeGreaterThan(0);
    // The honest half: no cell changed ring side between the two poses.
    expect(crossing.whatIsNotProven).toContain("No CELL changed ring side");
    // And the metric caveat that stops the distance map being read as the router.
    expect(crossing.metricCaveat).toContain("ground-plane distance");
  });

  it("reads D-11 against its registered allowance", () => {
    const d11 = record.d11Reading;
    expect(d11.allowance).toContain("4 of 8");
    expect(d11.verdict).toBe("WITHIN ALLOWANCE");
    for (const measured of [d11.measuredAtP2, d11.measuredAtP3]) {
      expect(measured.count).toBeLessThanOrEqual(4);
    }
    // The reading is per BUILDING; the cell figure is an upper bound and the
    // record must keep saying so.
    expect(d11.statement).toContain("upper bound");
  });
});
