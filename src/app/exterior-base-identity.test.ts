import { describe, expect, it } from "vitest";
import { BLOCK_835_DOITT_IDS } from "../domain/commercial-frontage";
import { ensureExteriorBaseIdentity, exteriorBaseIdentityHas } from "./App";

/**
 * Regression cover for `base-incompatible` on the Block 835 canary.
 *
 * App proved base membership with `adapter.getFeature`, which only sees shards
 * the camera has already streamed. With the camera elsewhere the Block 835
 * buildings were not resident, membership answered false, and every exterior
 * cell failed `base-incompatible` and fell back to base massing. Membership has
 * to be deterministic release membership, so it is now answered from the
 * checksum-verified detail index instead.
 */
const BLOCK_835_IDS = [...BLOCK_835_DOITT_IDS].map((id) => `doitt:${id}`);

/** Streaming adapter: nothing resident, but the release identity index is loadable. */
function streamingAdapter(memberIds: readonly string[]) {
  const index = new Set<string>();
  let ensureCalls = 0;
  return {
    ensureCalls: () => ensureCalls,
    adapter: {
      // Deliberately empty: this is the camera-elsewhere case.
      getFeature: () => undefined,
      ensureIdentityIndex: async () => { ensureCalls += 1; for (const id of memberIds) index.add(id); return index.size; },
      hasIdentityMember: (featureId: string) => index.has(featureId) || false,
    },
  };
}

/** Fully-resident adapter with no identity surface at all, like the fixture. */
function residentAdapter(residentIds: readonly string[]) {
  const resident = new Set(residentIds);
  return { getFeature: (featureId: string) => (resident.has(featureId) ? { id: featureId } : undefined) };
}

describe("exterior base identity membership", () => {
  it("proves membership for buildings that are not resident yet", async () => {
    const { adapter } = streamingAdapter(BLOCK_835_IDS);
    // Pre-fix wiring answered from residency alone, so this was false for all 14.
    expect(BLOCK_835_IDS.every((id) => exteriorBaseIdentityHas(adapter, id))).toBe(false);

    await ensureExteriorBaseIdentity(adapter);

    expect(BLOCK_835_IDS).toHaveLength(14);
    for (const id of BLOCK_835_IDS) expect(exteriorBaseIdentityHas(adapter, id)).toBe(true);
  });

  it("resolves the identity index once per activation", async () => {
    const streaming = streamingAdapter(BLOCK_835_IDS);
    await ensureExteriorBaseIdentity(streaming.adapter);
    expect(streaming.ensureCalls()).toBe(1);
  });

  it("still fails closed for an id that is genuinely not a member", async () => {
    const { adapter } = streamingAdapter(BLOCK_835_IDS);
    await ensureExteriorBaseIdentity(adapter);
    expect(exteriorBaseIdentityHas(adapter, "doitt:999999")).toBe(false);
    expect(exteriorBaseIdentityHas(adapter, "dohmh:camis:30191841")).toBe(false);
  });

  it("leaves fully-resident adapters that publish no identity surface unchanged", async () => {
    const adapter = residentAdapter(BLOCK_835_IDS);
    // No ensureIdentityIndex to call; this must be a no-op rather than a throw.
    await expect(ensureExteriorBaseIdentity(adapter)).resolves.toBeUndefined();
    for (const id of BLOCK_835_IDS) expect(exteriorBaseIdentityHas(adapter, id)).toBe(true);
    expect(exteriorBaseIdentityHas(adapter, "doitt:999999")).toBe(false);
  });
});
