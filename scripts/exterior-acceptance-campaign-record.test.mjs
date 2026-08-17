import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CAMPAIGN_EVIDENCE_ID,
  FRAME_F1,
  GPU_GATES,
  REQUEST_CEILINGS,
} from "./exterior-acceptance-campaign-constants.mjs";

/**
 * THE CAMPAIGN'S DRIFT TEST.
 *
 * Three separate things are checked here, and they fail for different reasons:
 *
 *   1. EVERY committed record matches its own `.sha256` sidecar. A record whose
 *      sidecar no longer matches has been edited after the fact, which is the
 *      one thing a measurement record must never survive quietly.
 *   2. THE ROLL-UP DID NOT INVENT A VERDICT. `campaign-record.json` is a join
 *      over the capture records; every load-bearing verdict in it is re-derived
 *      here FROM THE CAPTURE RECORD and compared. If the roll-up ever starts
 *      deciding rather than reporting, this is what catches it.
 *   3. NO GATE WENT MISSING. The pre-registration's gate list is enumerated and
 *      every id must appear in the roll-up with a verdict from the closed set.
 *      A gate that was never captured must say NOT-CAPTURED; it must not be
 *      absent.
 *
 * The stills are checked too, because a record that cites what-is-drawn
 * evidence and points at a file that is not there, or not the file it names, is
 * making a claim it cannot support.
 */
const root = join("data", CAMPAIGN_EVIDENCE_ID);
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const readJson = (name) => JSON.parse(readFileSync(join(root, name), "utf8"));

/** Every record the campaign writes, with the sidecar it must agree with. */
const RECORDS = [
  "pre-registration",
  "frame-control",
  "frames-and-gpu",
  "headroom",
  "storm",
  "eviction-loop",
  "lod-l1",
  "journeys",
  "campaign-record",
  "chrome-cleanup",
];

const VERDICTS = new Set(["PASS", "FAIL", "REPORTED", "HONEST-STOP", "NOT-MEASURED", "NOT-CAPTURED", "CROSS-REFERENCE", "CARRIED-VERBATIM"]);

/** The full gate list, restated so a silently dropped gate breaks a test. */
const REGISTERED_GATE_IDS = [
  "F1", "F2", "F4",
  "H1", "H2",
  "S-1a", "S-1b", "S-1c", "S-1d", "S-1e",
  "G1", "G2", "G3", "G4",
  "E-1a", "E-1b", "E-1c", "E-1d", "E-1e", "E-1f",
  "M1", "M2", "M3", "M4",
  "J1", "J2", "J3", "J4", "J5", "J6",
  "L1", "L2",
  "REQUEST_CEILINGS", "VISUAL",
];

describe("T006 campaign records are byte-stable", () => {
  for (const name of RECORDS) {
    it(`${name}.json matches its committed sidecar`, () => {
      const jsonPath = join(root, `${name}.json`);
      const sidecarPath = join(root, `${name}.sha256`);
      expect(existsSync(jsonPath), `${jsonPath} is missing`).toBe(true);
      expect(existsSync(sidecarPath), `${sidecarPath} is missing`).toBe(true);
      const [checksum, file] = readFileSync(sidecarPath, "utf8").trim().split(/\s+/u);
      expect(file).toBe(`${name}.json`);
      expect(digest(jsonPath)).toBe(checksum);
    });
  }

  it("the heap record written to the campaign root matches its sidecar and is NOT the frozen T008 record", () => {
    const jsonPath = join(root, "heap-repeat-evidence.json");
    expect(existsSync(jsonPath), `${jsonPath} is missing`).toBe(true);
    const [checksum] = readFileSync(join(root, "heap-repeat-evidence.sha256"), "utf8").trim().split(/\s+/u);
    expect(digest(jsonPath)).toBe(checksum);
    const record = readJson("heap-repeat-evidence.json");
    expect(record.recordId).toBe(`${CAMPAIGN_EVIDENCE_ID}:repeated-camera-path`);
    expect(record.t006).not.toBeNull();
    expect(record.t006.writtenTo).toBe(`data/${CAMPAIGN_EVIDENCE_ID}/`);
  });
});

describe("the T006 roll-up reports rather than decides", () => {
  const rollUp = () => readJson("campaign-record.json");
  const gateOf = (gateId) => rollUp().gates.find((gate) => gate.gateId === gateId) ?? null;

  it("carries every registered gate, each with a verdict from the closed set", () => {
    const record = rollUp();
    const present = record.gates.map((gate) => gate.gateId);
    for (const gateId of REGISTERED_GATE_IDS) expect(present, `gate ${gateId} is missing from the roll-up`).toContain(gateId);
    for (const gate of record.gates) expect(VERDICTS, `gate ${gate.gateId} has verdict ${gate.verdict}`).toContain(gate.verdict);
  });

  it("F1's verdict is the frames capture's own verdict, against the frozen bar", () => {
    const frames = readJson("frames-and-gpu.json");
    expect(gateOf("F1").verdict).toBe(frames.gates.F1.pass ? "PASS" : "FAIL");
    expect(gateOf("F1").keyNumbers.bar).toEqual({ p50Ms: FRAME_F1.p50Ms, p95Ms: FRAME_F1.p95Ms, minimumFrames: FRAME_F1.minimumFrames, settleMs: FRAME_F1.settleMs, windowMs: FRAME_F1.windowMs });
    // Each station's own pass is exactly the conjunction of the three bars.
    for (const station of frames.gates.F1.perStation) {
      expect(station.pass).toBe(station.sampleCount >= FRAME_F1.minimumFrames && station.p50Ms <= FRAME_F1.p50Ms && station.p95Ms <= FRAME_F1.p95Ms);
    }
  });

  it("G1 is an EXACT zero delta or it is a failure, and G2/G3 are gated on it", () => {
    const frames = readJson("frames-and-gpu.json");
    const g1 = gateOf("G1");
    expect(g1.keyNumbers.barBytes).toBe(GPU_GATES.G1.barBytes);
    expect(g1.verdict).toBe(frames.gates.G1.verdict.deltaByteLength === 0 ? "PASS" : "FAIL");
    if (g1.verdict === "FAIL") {
      expect(gateOf("G2").verdict).toBe("NOT-MEASURED");
      expect(gateOf("G3").verdict).toBe("NOT-MEASURED");
    }
  });

  it("E-1e's verdict requires BOTH digests non-null, not merely equal", () => {
    const eviction = readJson("eviction-loop.json");
    const gate = eviction.gates["E-1e"];
    expect(gate.pass).toBe(gate.bothNonNull && gate.equal);
    expect(gateOf("E-1e").verdict).toBe(gate.pass ? "PASS" : "FAIL");
    // The defect this gate was rewritten for: two nulls are equal.
    if (gate.selectionDigestFirstVisit === null && gate.selectionDigestAfterReEntry === null) expect(gate.pass).toBe(false);
  });

  it("L2 is an HONEST-STOP and is never counted as a failure", () => {
    const record = rollUp();
    expect(gateOf("L2").verdict).toBe("HONEST-STOP");
    expect(record.summary.fail).not.toContain("L2");
    expect(record.summary.honestStop).toContain("L2");
  });

  it("the request ceiling is 4 everywhere and no combined 8 is reported", () => {
    const gate = gateOf("REQUEST_CEILINGS");
    expect(gate.keyNumbers.appWideSharedSemaphoreMaxConcurrent).toBe(4);
    expect(gate.neverSum).toBe(REQUEST_CEILINGS.neverSum);
    expect(JSON.stringify(gate.keyNumbers)).not.toMatch(/"combined"/u);
    if (typeof gate.keyNumbers.maxPeakObserved === "number") expect(gate.keyNumbers.maxPeakObserved).toBeLessThanOrEqual(4);
  });

  it("every still the roll-up cites exists and is the file it names", () => {
    const gate = gateOf("VISUAL");
    expect(gate.keyNumbers.stillCount).toBeGreaterThan(0);
    for (const still of gate.keyNumbers.stills) {
      const path = join(root, still.file);
      expect(existsSync(path), `${path} is cited but missing`).toBe(true);
      expect(digest(path), `${path} does not match the checksum the record cites`).toBe(still.sha256);
    }
  });

  it("no capture record is missing, and every Chrome session was cleaned up", () => {
    const record = rollUp();
    expect(record.missingCaptureRecords).toEqual([]);
    expect(record.chromeCleanup.everySessionClean).toBe(true);
  });
});
