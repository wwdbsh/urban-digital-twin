import { describe, expect, it } from "vitest";
import { runSyntheticCatalogBenchmark } from "./benchmark.ts";

describe("synthetic catalog benchmark", () => {
  it("generates a deterministic thousand-record multi-tile fixture within bounded budgets", () => {
    const first = runSyntheticCatalogBenchmark(1_000); const second = runSyntheticCatalogBenchmark(1_000);
    expect(first.records).toBe(1_000); expect(first.partitions).toBeGreaterThan(4); expect(first.deterministicFingerprint).toBe(second.deterministicFingerprint); expect(first.withinBudget).toBe(true); expect(first.fixtureOnly).toBe(true); expect(first.claim).toContain("not full-Manhattan");
  });
});
