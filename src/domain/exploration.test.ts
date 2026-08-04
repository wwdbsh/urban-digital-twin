import { describe, expect, it } from "vitest";
import { buildSyntheticReconciliationCatalog } from "./reconciliation-fixtures.ts";
import { runtimeFixtureFeatures } from "./features.ts";
import restaurants from "../../public/data/real-wave-20260804/restaurants.json";
import { explorationUrl, parseExplorationUrl, searchRealPlaceCatalog, searchUnifiedCatalog } from "./exploration.ts";
import type { Feature } from "./schema.ts";

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

  it("searches the approved real partition by name, normalized address, cuisine, CAMIS, source ID, and category", () => {
    const realFeatures = restaurants as unknown as Feature[];
    const expectedId = realFeatures.find((feature) => feature.name === "DONUT PUB")?.id;
    expect(expectedId).toBeDefined();
    for (const [query, matchedBy, exactFirst] of [["DONUT PUB", "name", true], ["203 WEST 14 STREET", "address", true], ["Donuts", "cuisine", false], ["40365525", "source", true], ["dohmh:40365525:0e6096543c6e29e12747eaf6", "source", true]] as const) {
      const result = searchRealPlaceCatalog(realFeatures, query);
      const match = exactFirst ? result[0] : result.find((item) => item.feature.id === expectedId);
      expect(match?.feature.id).toBe(expectedId);
      expect(match?.matchedBy).toBe(matchedBy);
    }
    const categoryResults = searchRealPlaceCatalog(realFeatures, "restaurant", ["restaurant"]);
    expect(categoryResults.some((result) => result.feature.id === expectedId && result.matchedBy === "category")).toBe(true);
    expect(searchRealPlaceCatalog(realFeatures, "retail", ["retail"])).toEqual([]);
  });

  it("keeps duplicate-name real results deterministic by canonical feature ID", () => {
    const realFeatures = restaurants as unknown as Feature[];
    const duplicate = realFeatures.find((feature) => feature.name === "DONUT PUB")!;
    const copy = { ...duplicate, id: `${duplicate.id}:duplicate` };
    const results = searchRealPlaceCatalog([copy, duplicate], "DONUT PUB");
    expect(results.map((result) => result.feature.id)).toEqual([duplicate.id, copy.id].sort());
  });
});
