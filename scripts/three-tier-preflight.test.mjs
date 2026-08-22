/**
 * The pre-flight, validated before it is trusted to gate a campaign.
 *
 * Its whole value is that it REFUSES. A pre-flight that passes when a condition
 * is unmet is worse than none, because it converts an unchecked assumption into
 * a documented one.
 */
import { describe, expect, it } from "vitest";

import { PINNED, FROZEN_PINS, REQUIRED_BUNDLE_MARKERS, SERVING_RELEASE_IDS, powerState } from "./three-tier-preflight-cli.mjs";

describe("the pre-flight pins what the pre-registration pinned", () => {
  it("carries the far-tier payload inventory digest T005 froze", () => {
    expect(PINNED.farTierPayloadInventory).toBe("cf8e26480eecc91f2e7b473d217a0d3551d0be59b4d8da39ee1217a6e0538f0a");
  });

  it("carries the exemption set and pose registry digests", () => {
    expect(PINNED.sweepExemptions).toBe("6354676da304ab03783132730f75dafdfce60c82f509dd740b9fc18c92e8d430");
    expect(PINNED.sweepPoses).toBe("94a40e8acd377539d61e8c06767859a4a95a43823c97dd9a31b43cae54e149b0");
  });

  it("checks all six serving packages, not a sample", () => {
    expect(SERVING_RELEASE_IDS).toHaveLength(6);
    expect(new Set(SERVING_RELEASE_IDS).size).toBe(6);
    for (const id of SERVING_RELEASE_IDS) expect(id.endsWith("-s2"), id).toBe(true);
  });

  it("guards the frozen records both campaigns depend on", () => {
    // The heap record is the one at genuine risk: its CLI writes there by
    // default and has no guard of its own.
    expect(FROZEN_PINS["data/citywide-heap-repeat-20260815/heap-repeat-evidence.json"]).toBe("6c3ef7c38118dcc1630a1da73ae2224592b5c4fbd94c60c4488a07ddc925eb9a");
    expect(Object.keys(FROZEN_PINS).length).toBeGreaterThanOrEqual(7);
  });

  it("requires BOTH probe markers in the served bytes", () => {
    // A probe-less bundle does not fail loudly: it reads null and produces a
    // record full of absences that looks like a measurement.
    expect(REQUIRED_BUNDLE_MARKERS).toContain("data-exterior-texture-probe");
    expect(REQUIRED_BUNDLE_MARKERS).toContain("data-exterior-scheduler-probe");
  });
});

describe("power is read, not asserted", () => {
  it("reports a source and an AC boolean rather than assuming either", () => {
    const power = powerState();
    expect(["AC Power", "Battery Power", "unreadable"]).toContain(power.source);
    expect(typeof power.onAcPower === "boolean" || power.onAcPower === null).toBe(true);
    // The pre-registration made AC power a condition; the campaign's own record
    // must be able to say which state it actually ran in.
    if (power.onAcPower === true) expect(power.source).toBe("AC Power");
  });
});
