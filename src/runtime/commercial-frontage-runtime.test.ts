import { describe, expect, it } from "vitest";
import releaseJson from "../../public/data/manhattan-esb-block-exterior-pilot-20260805/release.json";
import { validateExteriorPilotRelease } from "./exterior-pilot-release";

describe("commercial frontage runtime metadata", () => {
  it("renders only accepted neutral text and preserves unknown accounting", () => {
    const validation = validateExteriorPilotRelease(releaseJson);
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    const commercial = validation.value.commercialRelease;
    const accepted = commercial.storefrontPlacements.filter((placement) => placement.signPolicy === "neutral-text-only");
    expect(accepted).toHaveLength(8);
    expect(accepted.every((placement) => placement.placementDecision.startsWith("storefront"))).toBe(true);
    expect(accepted.every((placement) => placement.canonicalBuildingId && placement.canonicalTenantId && placement.evidenceIds.length > 0)).toBe(true);
    expect(commercial.totals.storefrontPickProxies).toBe(accepted.length);
    expect(commercial.rejectionConflictSummary.unknownStorefronts).toBe(72);
    expect(commercial.rejectionConflictSummary.ambiguousStorefronts).toBe(12);
  });
});
