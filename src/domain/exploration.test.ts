import { describe, expect, it } from "vitest";
import { buildSyntheticReconciliationCatalog } from "./reconciliation-fixtures.ts";
import { runtimeFixtureFeatures } from "./features.ts";
import { explorationUrl, parseExplorationUrl, searchUnifiedCatalog } from "./exploration.ts";

describe("exploration contracts", () => {
  const catalog = buildSyntheticReconciliationCatalog();
  it("round trips shareable feature and query URLs", () => {
    const url = explorationUrl({ featureId: runtimeFixtureFeatures[0]!.id, query: "카페 서울" }, "https://fixture.invalid/explore");
    expect(parseExplorationUrl(url)).toEqual({ featureId: runtimeFixtureFeatures[0]!.id, query: "카페 서울" });
    expect(parseExplorationUrl("not a url")).toEqual({ featureId: null, query: "" });
  });
  it("searches Unicode names, aliases, addresses, categories and source identifiers across groups", () => {
    expect(searchUnifiedCatalog(runtimeFixtureFeatures, catalog, "카페 서울")[0]?.feature.name).toBe("Fixture Coffee Counter");
    expect(searchUnifiedCatalog(runtimeFixtureFeatures, catalog, "restaurant")[0]?.group).toBe("Places");
    expect(searchUnifiedCatalog(runtimeFixtureFeatures, catalog, "100 Invented Fixture Way")[0]?.matchedBy).toBe("address");
    expect(searchUnifiedCatalog(runtimeFixtureFeatures, catalog, "fixture-station-001")[0]?.typeLabel).toBe("Station");
    expect(searchUnifiedCatalog(runtimeFixtureFeatures, catalog, "not-present")).toEqual([]);
  });
});
