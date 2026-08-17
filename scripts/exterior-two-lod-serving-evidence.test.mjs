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
 * THE INSTRUMENT LIMITATION, pinned so it cannot be quietly dropped.
 *
 * `distanceMetersByUnitId` is a `Map` on `SchedulerDecision`, and the DOM probe
 * serializes the decision with `JSON.stringify` — which renders a Map as `{}`.
 * Every pose therefore captured ZERO per-cell distances, and no capture here
 * can say which side of the 400 m ring a NAMED cell sat on.
 *
 * That is why P2's registered gate is reported as NOT FULLY PROVEN rather than
 * passed: the aggregate request counts show both levels present in the same
 * session, which is consistent with a straddle but does not establish the
 * per-cell side assignment the gate asks for.
 */
describe("the per-cell distance instrument did not report", () => {
  it("captured zero distances at every pose, and the record says so", () => {
    for (const entry of record.poses) {
      expect(entry.distances.count, `${entry.poseId} unexpectedly reported distances`).toBe(0);
    }
  });
});
