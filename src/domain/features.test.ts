import { describe, expect, it } from "vitest";
import { featureMatchesQuery, provenanceLabel, runtimeMarker } from "./features";

describe("provenanceLabel", () => {
  it("keeps generated geometry visibly distinct from sourced data", () => {
    expect(provenanceLabel("generated")).toBe("Generated");
    expect(provenanceLabel("authoritative")).toBe("Authoritative");
  });
});

describe("featureMatchesQuery", () => {
  it("matches a supported feature by city, name, or stable ID", () => {
    expect(featureMatchesQuery(runtimeMarker, "Manhattan")).toBe(true);
    expect(featureMatchesQuery(runtimeMarker, "fixture coffee")).toBe(true);
    expect(featureMatchesQuery(runtimeMarker, "fixture-poi-001")).toBe(true);
    expect(featureMatchesQuery(runtimeMarker, "brooklyn")).toBe(false);
  });

  it("does not treat an empty query as a feature match", () => {
    expect(featureMatchesQuery(runtimeMarker, "   ")).toBe(false);
  });
});
