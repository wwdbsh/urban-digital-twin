/**
 * The far-tier rollback switch, and the proof that a default session is
 * untouched by its existence.
 */

import { describe, expect, it } from "vitest";
import {
  appendExteriorProfileUrl, farTierOptOutValue, parseExteriorStreamingUrl,
  FAR_TIER_DEFAULT_ON, FAR_TIER_OFF_VALUE, FAR_TIER_ON_VALUE, FAR_TIER_PARAM,
} from "./App";

const BASE = "https://example.test/";
/** A write that predates the far tier: it names no flag at all. */
const LEGACY_WRITE = { override: null, releaseId: "manhattan-block835-exterior-20260806", streaming: true, profile: "exploration", canarySnapshotId: null, scheduler: true, detailRadiusMeters: null } as const;

describe("the rollback switch", () => {
  it("defaults OFF, so no session gets the far tier without asking", () => {
    // The far tier replaces the massing draw with baked geometry whose
    // appearance defects are open and owned by T013.
    expect(FAR_TIER_DEFAULT_ON).toBe(false);
  });

  it("states the opt-IN in the URL, because the default is off", () => {
    expect(farTierOptOutValue()).toBe(FAR_TIER_ON_VALUE);
  });
});

describe("a default session's URL is unchanged", () => {
  it("serializes no far-tier parameter at all", () => {
    // THE NO-GO CONDITION: the default session's serialized URL must be
    // character-identical to what it was before this task existed.
    const written = appendExteriorProfileUrl(BASE, LEGACY_WRITE);
    expect(written).not.toContain(FAR_TIER_PARAM);
    expect(new URL(written).searchParams.has(FAR_TIER_PARAM)).toBe(false);
  });

  it("writes nothing even when the flag is passed explicitly at its default", () => {
    const written = appendExteriorProfileUrl(BASE, { ...LEGACY_WRITE, farTier: FAR_TIER_DEFAULT_ON });
    expect(new URL(written).searchParams.has(FAR_TIER_PARAM)).toBe(false);
  });

  it("is byte-identical with and without the new optional field", () => {
    // An omitted flag and an explicitly-default flag must produce the same URL,
    // or every pre-existing caller would start emitting a different link.
    expect(appendExteriorProfileUrl(BASE, { ...LEGACY_WRITE, farTier: FAR_TIER_DEFAULT_ON }))
      .toBe(appendExteriorProfileUrl(BASE, LEGACY_WRITE));
  });

  it("parses an ordinary URL to the default", () => {
    expect(parseExteriorStreamingUrl(BASE).farTier).toBe(FAR_TIER_DEFAULT_ON);
  });
});

describe("opting in", () => {
  it("serializes the flag only when it differs from the default", () => {
    const written = appendExteriorProfileUrl(BASE, { ...LEGACY_WRITE, farTier: true });
    expect(new URL(written).searchParams.get(FAR_TIER_PARAM)).toBe(FAR_TIER_ON_VALUE);
  });

  it("round-trips through parse", () => {
    const written = appendExteriorProfileUrl(BASE, { ...LEGACY_WRITE, farTier: true });
    expect(parseExteriorStreamingUrl(written).farTier).toBe(true);
  });

  it("survives a rewrite, instead of dying on the first camera move", () => {
    // The defect the scheduler flag had to be fixed for: a parameter the writer
    // does not know about is dropped by the next settled-camera replaceState.
    const first = appendExteriorProfileUrl(BASE, { ...LEGACY_WRITE, farTier: true });
    const state = parseExteriorStreamingUrl(first);
    const second = appendExteriorProfileUrl(first, { ...LEGACY_WRITE, farTier: state.farTier });
    expect(new URL(second).searchParams.get(FAR_TIER_PARAM)).toBe(FAR_TIER_ON_VALUE);
  });

  it("deletes a stale parameter when the session goes back to the default", () => {
    // The `else delete(...)` half. Without it the flag leaks across rewrites.
    const opted = appendExteriorProfileUrl(BASE, { ...LEGACY_WRITE, farTier: true });
    const reverted = appendExteriorProfileUrl(opted, { ...LEGACY_WRITE, farTier: false });
    expect(new URL(reverted).searchParams.has(FAR_TIER_PARAM)).toBe(false);
  });
});

describe("a link this build cannot honour", () => {
  it("resolves to the build's own default, never a third state", () => {
    for (const spelling of ["ON", "yes", "1", "", "far-tier", "true"]) {
      const url = `${BASE}?${FAR_TIER_PARAM}=${encodeURIComponent(spelling)}`;
      expect(parseExteriorStreamingUrl(url).farTier, spelling).toBe(FAR_TIER_DEFAULT_ON);
    }
  });

  it("accepts exactly two spellings", () => {
    expect(parseExteriorStreamingUrl(`${BASE}?${FAR_TIER_PARAM}=${FAR_TIER_ON_VALUE}`).farTier).toBe(true);
    expect(parseExteriorStreamingUrl(`${BASE}?${FAR_TIER_PARAM}=${FAR_TIER_OFF_VALUE}`).farTier).toBe(false);
  });
});
