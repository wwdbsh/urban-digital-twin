import { describe, expect, it } from "vitest";
import releaseJson from "../../public/data/manhattan-esb-block-exterior-pilot-20260805/release.json";
import { CITYWIDE_RELEASE_ID } from "../release/citywide-release";
import { TRAVEL_CONTEXT_RELEASE_ID } from "../release/travel-context-release";
import { EXTERIOR_PILOT_RELEASE_ID, validateExteriorPilotRelease } from "./exterior-pilot-release";

describe("Stage 3 exterior composition contract", () => {
  it("pins the optional overlay to the citywide base while allowing civic composition", () => {
    const validation = validateExteriorPilotRelease(releaseJson);
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    expect(validation.value.releaseId).toBe(EXTERIOR_PILOT_RELEASE_ID);
    expect(validation.value.baseReleaseId).toBe(CITYWIDE_RELEASE_ID);
    expect(validation.value.baseReleaseId).not.toBe(TRAVEL_CONTEXT_RELEASE_ID);
    expect(validation.value.approval.scope).toMatch(/local-only additive/iu);
    expect(validation.value.commercialRelease.fallback).toMatch(/per-building/iu);
  });
});
