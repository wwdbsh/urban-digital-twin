/**
 * The far-tier rollback switch, and the proof that a default session is
 * untouched by its existence.
 */

import { describe, expect, it } from "vitest";
import {
  appendExteriorProfileUrl, farTierOptOutValue, parseExteriorStreamingUrl,
  FAR_TIER_DEFAULT_ON, FAR_TIER_OFF_VALUE, FAR_TIER_ON_VALUE, FAR_TIER_PARAM, farTierActiveForSession,
} from "./App";

const BASE = "https://example.test/";
/** A write that predates the far tier: it names no flag at all. */
const LEGACY_WRITE = { override: null, releaseId: "manhattan-block835-exterior-20260806", streaming: true, profile: "exploration", canarySnapshotId: null, scheduler: true, detailRadiusMeters: null, farTier: FAR_TIER_DEFAULT_ON } as const;

describe("the rollback switch", () => {
  it("is ON: T005 activated the promotion on its second sweep", () => {
    // Sweep-1 FAILED at P2 and the flip was reverted. That failure was an
    // instrument defect — the far-tier state was published at the moment the
    // drawn set advanced, before any alpha was written — and sweep-2 on the
    // corrected build read 0 uncovered at all five ON poses. BOTH sweeps are in
    // data/far-tier-hlod-promotion-20260819/sweep-results.json; the FAIL was
    // not edited away.
    expect(FAR_TIER_DEFAULT_ON).toBe(true);
  });

  it("states the opt-OUT in the URL, because the default is on", () => {
    // The polarity is derived, not written twice: the writer states whatever
    // the default is NOT, so flipping the constant flips the URL grammar with
    // it and neither the parser nor the writer changed for this promotion.
    expect(farTierOptOutValue()).toBe(FAR_TIER_OFF_VALUE);
  });
});

describe("a default session's URL is unchanged", () => {
  it("is a REQUIRED field, so no writer can silently drop it", () => {
    // It was optional once. The production writer did not pass it, the flag
    // defaulted, and `?farTier=on` died on the first camera move. This is a
    // type-level guarantee, asserted here so the reason survives.
    const write: Parameters<typeof appendExteriorProfileUrl>[1] = { ...LEGACY_WRITE };
    expect(write.farTier).toBe(FAR_TIER_DEFAULT_ON);
  });

  it("serializes no far-tier parameter at all", () => {
    // STILL THE CONDITION, with the polarity now genuinely inverted: a default
    // session's URL stays silent. Before promotion silence meant no far tier;
    // it now means the promoted composition. Either way the URL carries only a
    // DEPARTURE from the build's default.
    const written = appendExteriorProfileUrl(BASE, LEGACY_WRITE);
    expect(written).not.toContain(FAR_TIER_PARAM);
    expect(new URL(written).searchParams.has(FAR_TIER_PARAM)).toBe(false);
  });

  it("parses an ordinary URL to the default", () => {
    expect(parseExteriorStreamingUrl(BASE).farTier).toBe(FAR_TIER_DEFAULT_ON);
  });
});

describe("opting OUT", () => {
  it("serializes the flag only when it differs from the default", () => {
    const written = appendExteriorProfileUrl(BASE, { ...LEGACY_WRITE, farTier: false });
    expect(new URL(written).searchParams.get(FAR_TIER_PARAM)).toBe(FAR_TIER_OFF_VALUE);
  });

  it("round-trips through parse", () => {
    const written = appendExteriorProfileUrl(BASE, { ...LEGACY_WRITE, farTier: false });
    expect(parseExteriorStreamingUrl(written).farTier).toBe(false);
  });

  it("survives a rewrite, instead of dying on the first camera move", () => {
    // The defect the scheduler flag had to be fixed for: a parameter the writer
    // does not know about is dropped by the next settled-camera replaceState.
    // THIS IS NOW THE ROLLBACK PATH: a user who opted out of the far tier must
    // still be opted out after the first pan.
    const first = appendExteriorProfileUrl(BASE, { ...LEGACY_WRITE, farTier: false });
    const state = parseExteriorStreamingUrl(first);
    const second = appendExteriorProfileUrl(first, { ...LEGACY_WRITE, farTier: state.farTier });
    expect(new URL(second).searchParams.get(FAR_TIER_PARAM)).toBe(FAR_TIER_OFF_VALUE);
  });

  it("deletes a stale parameter when the session goes back to the default", () => {
    // The `else delete(...)` half. Without it the flag leaks across rewrites.
    const opted = appendExteriorProfileUrl(BASE, { ...LEGACY_WRITE, farTier: false });
    const reverted = appendExteriorProfileUrl(opted, { ...LEGACY_WRITE, farTier: true });
    expect(new URL(reverted).searchParams.has(FAR_TIER_PARAM)).toBe(false);
  });
});

describe("fixture sessions do not arm the tier", () => {
  it("refuses to arm in fixture mode even when the session requests it", () => {
    // 840 real Manhattan tiles over a synthetic city would report 840 `absent`
    // cells in a session that is working exactly as designed.
    expect(farTierActiveForSession(true, "fixtures")).toBe(false);
  });

  it("arms over a real base when the session asks for it", () => {
    expect(farTierActiveForSession(true, "real-pilot")).toBe(true);
    expect(farTierActiveForSession(true, "civic-context")).toBe(true);
  });

  it("still honours an explicit opt-OUT over a real base", () => {
    expect(farTierActiveForSession(false, "real-pilot")).toBe(false);
  });
});

describe("a bookmarked ?farTier=on, written while the default was OFF", () => {
  it("still parses to ON, so no old link changes meaning", () => {
    const bookmarked = `${BASE}${BASE.includes("?") ? "&" : "?"}${FAR_TIER_PARAM}=${FAR_TIER_ON_VALUE}`;
    expect(parseExteriorStreamingUrl(bookmarked).farTier).toBe(true);
  });

  it("is DROPPED by the first settled-camera rewrite, and the session is unchanged", () => {
    // The writer states only a DEPARTURE from the default. `farTier=on` is no
    // longer a departure, so the first `replaceState` deletes it — the link
    // stops saying something it no longer needs to say, and the session it
    // describes is identical before and after.
    //
    // This is the same mechanism that once dropped `farTier=on` as a DEFECT,
    // when ON was the departure. Asserting it here records that the behaviour
    // is now correct rather than merely surviving: what matters is that the
    // PARSED STATE is preserved across the rewrite, not the token.
    const bookmarked = `${BASE}${BASE.includes("?") ? "&" : "?"}${FAR_TIER_PARAM}=${FAR_TIER_ON_VALUE}`;
    const state = parseExteriorStreamingUrl(bookmarked);
    const rewritten = appendExteriorProfileUrl(bookmarked, { ...LEGACY_WRITE, farTier: state.farTier });
    expect(new URL(rewritten).searchParams.has(FAR_TIER_PARAM)).toBe(false);
    expect(parseExteriorStreamingUrl(rewritten).farTier).toBe(true);
  });

  it("keeps a bookmarked ?farTier=off opted out across the same rewrite", () => {
    // The arm that actually matters after promotion: an opt-OUT link must not
    // be silently upgraded into the promoted composition by a camera move.
    const bookmarked = `${BASE}${BASE.includes("?") ? "&" : "?"}${FAR_TIER_PARAM}=${FAR_TIER_OFF_VALUE}`;
    const state = parseExteriorStreamingUrl(bookmarked);
    expect(state.farTier).toBe(false);
    const rewritten = appendExteriorProfileUrl(bookmarked, { ...LEGACY_WRITE, farTier: state.farTier });
    expect(new URL(rewritten).searchParams.get(FAR_TIER_PARAM)).toBe(FAR_TIER_OFF_VALUE);
    expect(parseExteriorStreamingUrl(rewritten).farTier).toBe(false);
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
