/* global TextDecoder */
/**
 * A PRE-REGISTRATION THAT CAN BE EDITED AFTER A CAPTURE IS NOT A PRE-REGISTRATION.
 *
 * These tests bind T007's record to its sidecar, bind the bars it inherits to
 * the constants they came from, and bind the frozen roots it promises not to
 * touch. They never bind a PNG: a still is a checksummed input, and a test that
 * fails when an image re-encodes teaches its readers to ignore it.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { FRAME_F1, FRAME_F4, HEAP_GATES, STATIONS } from "./exterior-acceptance-campaign-constants.mjs";
import { FROZEN_EVIDENCE_ROOTS, F1_BAR } from "./three-tier-capture-cli.mjs";
import { MASSING_REFUSAL_SHARE } from "./draw-composition.mjs";

const ROOT = join("data", "three-tier-acceptance-20260821");
const readText = (path) => new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
const readRecord = (name) => {
  const text = readText(join(ROOT, `${name}.json`));
  const declared = readText(join(ROOT, `${name}.sha256`)).trim().split(/\s+/u)[0];
  expect(createHash("sha256").update(text).digest("hex"), `${name}.json does not match its sidecar`).toBe(declared);
  return JSON.parse(text);
};

describe("every record in the campaign root is bound to its sidecar", () => {
  it("covers all of them, derived from the directory rather than a hand-kept list", () => {
    const names = readdirSync(ROOT).filter((n) => n.endsWith(".json")).map((n) => n.replace(/\.json$/u, ""));
    expect(names.length).toBeGreaterThanOrEqual(2);
    for (const name of names) expect(readRecord(name), name).toBeTypeOf("object");
  });
});

describe("the bars are inherited, not invented", () => {
  const pre = () => readRecord("pre-registration");

  it("carries F1 exactly as the prior campaign set it", () => {
    expect(FRAME_F1.p50Ms).toBe(16.7);
    expect(FRAME_F1.p95Ms).toBe(25);
    expect(FRAME_F1.minimumFrames).toBe(600);
    expect(FRAME_F1.windowMs).toBe(12_000);
    expect(FRAME_F1.settleMs).toBe(45_000);
    // ...and the harness that will apply it holds the same numbers, so a bar
    // cannot drift between the record and the instrument.
    expect(F1_BAR.p50MaxMs).toBe(FRAME_F1.p50Ms);
    expect(F1_BAR.p95MaxMs).toBe(FRAME_F1.p95Ms);
    expect(F1_BAR.minDeltas).toBe(FRAME_F1.minimumFrames);
    expect(pre().frames.F1.bar).toContain("16.7");
    expect(pre().frames.F1.bar).toContain("25");
  });

  it("pre-declares that far-tier stations may FAIL F1, before any capture", () => {
    // Registered so a FAIL cannot later be spun as a surprise, and so this
    // campaign cannot move the bar when one arrives.
    expect(pre().frames.F1.preDeclaredExpectation).toContain("MAY FAIL F1");
    expect(pre().frames.F1.preDeclaredExpectation).toContain("198");
  });

  it("keeps F2 as an interpretation rule and never as a bar", () => {
    expect(pre().frames.F2.disposition).toContain("NOT A BAR");
    expect(pre().frames.F2.disposition).toContain("capped control");
  });

  it("keeps D-11 carry-only and refuses to close it in either direction", () => {
    expect(FRAME_F4.legYDoubleDrawMs).toBe(4_000);
    const d11 = pre().d11;
    expect(d11.disposition).toContain("CARRY-ONLY");
    expect(d11.rule).toContain("does NOT close D-11");
    expect(d11.rule).toContain("WILL NOT BE REPORTED CLOSED");
  });

  it("re-derives the heap lap cap and raises it BEFORE any lap", () => {
    // The inherited cap would have fired on a healthy slow run: the three-tier
    // floor is 73.5 min against a 75 min cap.
    expect(HEAP_GATES.lapPhaseCapMs).toBe(75 * 60 * 1000);
    const heap = pre().heap;
    expect(heap.lapPhaseCapMsReDerived).toBe(150 * 60 * 1000);
    expect(heap.capDerivation).toContain("73.5 min");
    expect(heap.whyThisMattersMoreThanItSounds).toContain("masquerading as a result");
  });
});

describe("the unit prohibition is registered, not remembered", () => {
  it("names the two unit systems and forbids mixing them", () => {
    const gpu = readRecord("pre-registration").gpu;
    expect(gpu.unitDiscipline.prohibition).toContain("NEVER COMPARED");
    expect(gpu.unitDiscipline.bars.B3residentTextureBytes).toBe(291_984_434);
    expect(gpu.unitDiscipline.bars.B4residentGeometryBytes).toBe(98_310_624);
    expect(gpu.unitDiscipline.bars.B5residentTotalBytes).toBe(390_295_058);
    // B5 = B3 + B4, as ADR 0058 froze them.
    expect(gpu.unitDiscipline.bars.B3residentTextureBytes + gpu.unitDiscipline.bars.B4residentGeometryBytes).toBe(gpu.unitDiscipline.bars.B5residentTotalBytes);
  });

  it("gates B3-B5 behind an exactly-zero G1-far", () => {
    const gpu = readRecord("pre-registration").gpu;
    expect(gpu.G1far.runsFirst).toBe(true);
    expect(gpu.G1far.rule).toContain("EXACTLY ZERO");
    expect(gpu.G1far.rule).toContain("NOT quoted");
    // The mip question is to be answered by measurement, not assumed either way.
    expect(gpu.G1far.theMipQuestion).toContain("RESOLVED BY MEASUREMENT");
  });

  it("keeps criterion #30 separate and states what B3-B5 do not bound", () => {
    const gpu = readRecord("pre-registration").gpu;
    expect(gpu.unitDiscipline.criterion30).toContain("CLOSED");
    expect(gpu.unitDiscipline.whatB3toB5DoNotBound).toContain("ONE SELECTED CUT");
    expect(gpu.unitDiscipline.whatB3toB5DoNotBound).toContain("1,024-entry cache");
  });
});

describe("the frozen evidence this campaign must not write", () => {
  it("names the roots the committed harnesses default into", () => {
    // Each of the three committed harnesses will happily write a frozen root if
    // run without --out; two of them default into one.
    for (const root of ["data/exterior-acceptance-20260817", "data/exterior-serving-20260817", "data/citywide-heap-repeat-20260815"]) {
      expect(FROZEN_EVIDENCE_ROOTS.some((r) => root.startsWith(r)) || FROZEN_EVIDENCE_ROOTS.includes(root), root).toBe(true);
    }
  });

  it("records the --out obligation and the hazard for each committed harness", () => {
    const inventory = readRecord("pre-registration").instrumentInventory;
    const committed = inventory.filter((entry) => entry.status === "COMMITTED");
    expect(committed.length).toBeGreaterThanOrEqual(3);
    for (const entry of committed) {
      expect(entry.mustPass, entry.instrument).toContain("three-tier-acceptance-20260821");
      expect(entry.hazard, entry.instrument).toBeTruthy();
    }
  });

  it("keeps the frozen 20260817 and 20260815 records byte-identical right now", () => {
    // The campaign has not run yet; this is the baseline assertion the closing
    // pre-flight repeats.
    const pinned = {
      "data/citywide-heap-repeat-20260815/heap-repeat-evidence.json": "6c3ef7c38118dcc1630a1da73ae2224592b5c4fbd94c60c4488a07ddc925eb9a",
      "data/exterior-serving-20260817/frame-time-ab.json": "8bf220330cf70232aca2acf1a25bebdd2c29f0ecffc46433902c69e095b72482",
      "data/exterior-serving-20260817/eviction-at-scale.json": "84809b28ad88460a5bd3ee678bfed5a210b0ec3d859773824f8fe57bc18575cb",
    };
    for (const [path, digest] of Object.entries(pinned)) {
      if (!existsSync(path)) continue;
      expect(createHash("sha256").update(readFileSync(path)).digest("hex"), path).toBe(digest);
    }
  });
});

describe("the campaign registers its own honesty conditions", () => {
  const pre = () => readRecord("pre-registration");

  it("requires both controls on every appearance or identity reading", () => {
    const controls = pre().controlsOnEveryAppearanceOrIdentityReading;
    expect(controls.rule).toContain("BOTH controls");
    expect(controls.fetchIsNotDraw).toContain("does not prove");
    expect(MASSING_REFUSAL_SHARE).toBe(0.02);
    expect(controls.drawCompositionControl).toContain("2 per cent");
  });

  it("verifies tier composition by DOM read rather than geometry", () => {
    const stations = pre().stations;
    expect(stations.everyStationCarries).toContain("publish-seq");
    expect(stations.everyStationCarries).toContain("residentCount");
    expect(stations.threeTierBelowTheBucket.resolution).toContain("NEVER ASSUMED");
    expect(stations.threeTierBelowTheBucket.whyItIsACandidateAndNotAClaim).toContain("DUAL-KEYED");
  });

  it("registers the five prior stations unchanged", () => {
    const registered = pre().stations.priorFive.map((s) => s.stationId).sort();
    expect(registered).toEqual(STATIONS.map((s) => s.stationId).sort());
  });

  it("states the rollback consequence before any reading exists", () => {
    const rollback = pre().rollbackStatement;
    expect(rollback.ifTheCampaignFails).toContain("does not automatically flip");
    expect(rollback.whyNot).toContain("THIRD CONFIGURATION");
    expect(rollback.whatACampaignFailActuallyProduces).toContain("FIXES ARE OUT OF SCOPE");
  });

  it("discloses the hardware and refuses the phrase a reference machine", () => {
    const hardware = pre().hardwareDisclosure;
    expect(hardware.statement).toContain("no 'reference MacBook'");
    expect(hardware.chip).toContain("M4 Pro");
    expect(hardware.oneMachineOneSession).toContain("carries no confidence interval");
    // The power state is a live condition, not a footnote.
    expect(hardware.powerIsAPreFlightCondition).toContain("REQUESTS AC POWER");
  });

  it("discloses the vehicle split rather than implying one browser", () => {
    expect(pre().vehicle.disclosedSplit).toContain("VEHICLE SPLIT");
    expect(pre().vehicle.disclosedSplit).toContain("not vehicle-controlled");
  });

  it("keeps every no-bar item REPORTED instead of inventing a bar", () => {
    for (const item of pre().noBarDispositions) expect(item.disposition, item.item).toBe("REPORTED");
  });
});
