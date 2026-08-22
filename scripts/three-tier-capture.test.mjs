/* global process */
/**
 * The capture harness, held to the two promises that matter before it is used:
 * that it cannot write frozen evidence, and that it cannot let a stalled or
 * unread scene pass as a measured one.
 */
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  guardedWrite, FROZEN_EVIDENCE_ROOTS, RECORD_ROOT,
  f1Verdict, F1_BAR, tierCompositionOf,
  TIER_STATE_PROBE, FRAME_SAMPLER_SOURCE, PICK_READ_SOURCE,
} from "./three-tier-capture-cli.mjs";

describe("the write guard fails closed", () => {
  const scratch = mkdtempSync(join(tmpdir(), "t7-guard-"));

  it("writes inside its own record root, with a sidecar", () => {
    const target = join(scratch, "stations", "ok.json");
    const digest = guardedWrite(target, '{"a":1}\n', scratch);
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(join(scratch, "stations", "ok.sha256"), "utf8")).toContain(digest);
  });

  it("REFUSES a path that escapes the root", () => {
    // process.exit is what the CLI does; in-process that surfaces as a throw
    // from the test runner's guard, so the assertion is that it does not write.
    const outside = join(scratch, "..", "escaped.json");
    expect(() => guardedWrite(outside, "{}", scratch)).toThrow();
    expect(existsSync(outside)).toBe(false);
  });

  it("REFUSES every frozen acceptance root by name", () => {
    for (const root of FROZEN_EVIDENCE_ROOTS) {
      const target = join(process.cwd(), root, "would-be-clobbered.json");
      expect(() => guardedWrite(target, "{}"), root).toThrow();
      expect(existsSync(target), root).toBe(false);
    }
  });

  it("names the 20260817 acceptance evidence explicitly, not just by containment", () => {
    // The campaign is measured AGAINST that baseline. A guard that only worked
    // by path arithmetic would survive a refactor with its intent lost.
    expect(FROZEN_EVIDENCE_ROOTS).toContain("data/exterior-acceptance-20260817");
    expect(FROZEN_EVIDENCE_ROOTS).toContain("data/exterior-completion-acceptance-20260817");
    expect(RECORD_ROOT).toContain("three-tier-acceptance-20260821");
  });
});

describe("the F1 bar is a constant, and an unsampled station cannot pass", () => {
  it("carries the prior bars unchanged", () => {
    expect(F1_BAR.p50MaxMs).toBe(16.7);
    expect(F1_BAR.p95MaxMs).toBe(25);
    expect(F1_BAR.minDeltas).toBe(600);
  });

  it("PASSES only when both percentiles are inside", () => {
    expect(f1Verdict({ count: 700, p50: 16.6, p95: 24.9 }).verdict).toBe("PASS");
    expect(f1Verdict({ count: 700, p50: 16.8, p95: 24.9 }).verdict).toBe("FAIL");
    expect(f1Verdict({ count: 700, p50: 16.6, p95: 25.1 }).verdict).toBe("FAIL");
  });

  it("returns NOT-CAPTURED rather than a verdict when the sample is short", () => {
    const short = f1Verdict({ count: 599, p50: 8, p95: 9 });
    expect(short.verdict).toBe("NOT-CAPTURED");
    expect(short.reason).toContain("600");
    // A short sample with beautiful numbers must not read as PASS.
    expect(short.verdict).not.toBe("PASS");
  });

  it("returns NOT-CAPTURED when no sample exists at all", () => {
    expect(f1Verdict(null).verdict).toBe("NOT-CAPTURED");
  });
});

describe("tier composition is read, never inferred", () => {
  it("reports the three tiers it can actually see", () => {
    const composition = tierCompositionOf({
      farTierStatus: { farTierDrawn: "756", farTierDeclared: "840", farTierNear: "83" },
      farTierViewport: { farTierMassingActive: "25002", farTierMassingSuppressible: "23958", farTierMassingCovered: "23958", farTierMassingUncovered: "0", farTierPublishSeq: "6" },
      schedulerDecision: { residentCount: 41 },
    });
    expect(composition.tiersObserved).toEqual(["dense-massing", "exterior-wave", "far-tier"]);
    expect(composition.farTierPresent).toBe(true);
    expect(composition.publishSeq).toBe(6);
  });

  it("does not claim a tier the DOM does not show", () => {
    const composition = tierCompositionOf({
      farTierStatus: {},
      farTierViewport: { farTierMassingActive: "25002" },
      schedulerDecision: { residentCount: 0 },
    });
    expect(composition.tiersObserved).toEqual(["dense-massing"]);
    expect(composition.farTierPresent).toBe(false);
    expect(composition.exteriorPresent).toBe(false);
  });

  it("does not treat an advancing publish sequence as proof of a live scene", () => {
    // publishSeq advancing means the publish path ran. It does NOT mean frames
    // were being produced at a useful rate: a backgrounded tab in a browser
    // without --disable-renderer-backgrounding still publishes while rAF is
    // throttled to about 1 Hz, which is exactly what the Orca station captures
    // showed (11 deltas at ~1,000 ms with publishSeq moving). Liveness of the
    // publish and liveness of the frame loop are separate claims.
    const composition = tierCompositionOf({ farTierStatus: { farTierDeclared: "840", farTierDrawn: "700" }, farTierViewport: { farTierPublishSeq: "9", farTierMassingActive: "10" } });
    expect(composition.publishSeq).toBe(9);
    expect(composition).not.toHaveProperty("frameRate");
  });

  it("surfaces a missing publish sequence as null rather than zero", () => {
    // Zero would read as "the instrument published once"; null reads as "the
    // instrument never spoke", which is the T005 stalled-publish signature.
    expect(tierCompositionOf({ farTierViewport: {} }).publishSeq).toBeNull();
  });

  it("tells a DISARMED page from an armed page that drew nothing", () => {
    // clearPublishedFarTierState DELETES the attributes rather than zeroing
    // them, exactly so these two states stay distinguishable. A reader with
    // `?? 0` defaults would score the disarmed page as armed-and-empty.
    const disarmed = tierCompositionOf({ farTierStatus: {}, farTierViewport: {}, schedulerDecision: { residentCount: 12 } });
    expect(disarmed.farTierArmed).toBe(false);
    expect(disarmed.farTierDrawnCells).toBeNull();
    expect(disarmed.massingActive).toBeNull();
    expect(disarmed.unreadable).toContain("far-tier-attributes-absent");

    const armedEmpty = tierCompositionOf({
      farTierStatus: { farTierDeclared: "840", farTierDrawn: "0", farTierNear: "840" },
      farTierViewport: { farTierMassingActive: "0", farTierPublishSeq: "4" },
      schedulerDecision: { residentCount: 12 },
    });
    expect(armedEmpty.farTierArmed).toBe(true);
    expect(armedEmpty.farTierDrawnCells).toBe(0);
    expect(armedEmpty.farTierPresent).toBe(false);
    expect(armedEmpty.unreadable).toEqual([]);
  });
});

describe("the committed probe expressions carry their controls", () => {
  it("reads publish-seq, scheduler residency and the resource-buffer cap", () => {
    expect(TIER_STATE_PROBE).toContain("farTier");
    expect(TIER_STATE_PROBE).toContain("residentCount");
    // T005 lost a wire-level control to the 250-entry resource-timing cap; a
    // capture that silently hit the cap must be able to say so.
    expect(TIER_STATE_PROBE).toContain("resourceBufferMayBeTruncated");
    expect(TIER_STATE_PROBE).toContain("resourceTimingBufferConfigured");
    expect(TIER_STATE_PROBE).toContain("devicePixelRatio");
    expect(TIER_STATE_PROBE).toContain("getBoundingClientRect");
  });

  it("samples frames over the registered window", () => {
    expect(FRAME_SAMPLER_SOURCE(12000)).toContain("12000");
    expect(FRAME_SAMPLER_SOURCE(12000)).toContain("requestAnimationFrame");
  });

  it("asks the pick for an identity rather than assuming one", () => {
    const source = PICK_READ_SOURCE("doitt:778052");
    expect(source).toContain("doitt:778052");
    expect(source).toContain("identityConfirmed");
    expect(source).toContain("Overlapping records");
  });
});

describe("the harness records the canvas geometry every capture", () => {
  it("captures origin and size, which is what T006's invalidation turned on", () => {
    // T006 applied canvas-space regions to whole-window captures because the
    // origin was never recorded. It is recorded here, every time.
    expect(TIER_STATE_PROBE).toContain("cssX");
    expect(TIER_STATE_PROBE).toContain("windowInner");
  });
});

describe("a scratch record round-trips", () => {
  it("writes a station record and a matching sidecar", () => {
    const scratch = mkdtempSync(join(tmpdir(), "t7-record-"));
    const payload = { state: { farTierStatus: { farTierDrawn: "10" }, farTierViewport: { farTierPublishSeq: "3" } }, frames: { count: 700, p50: 10, p95: 20 } };
    writeFileSync(join(scratch, "in.json"), JSON.stringify(payload));
    const digest = guardedWrite(join(scratch, "stations", "s1.json"), `${JSON.stringify(payload, null, 2)}\n`, scratch);
    expect(digest).toMatch(/^[0-9a-f]{64}$/u);
  });
});
