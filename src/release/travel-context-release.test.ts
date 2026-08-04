import { describe, expect, it } from "vitest";
import {
  buildSyntheticTravelContextRelease,
  isTravelContextExactIdentifier,
  normalizeTravelContextQuery,
  selectTravelContextSearchPrefixes,
  stableTravelContextOverlapCandidates,
  validateTravelContextReleaseManifest,
} from "./travel-context-release.ts";

describe("travel-context v2 release contract", () => {
  it("builds a deterministic five-kind fixture without changing the v1 release", () => {
    const first = buildSyntheticTravelContextRelease();
    const second = buildSyntheticTravelContextRelease();
    expect(JSON.stringify(first.manifest)).toBe(JSON.stringify(second.manifest));
    expect([...first.bytes.entries()]).toEqual([...second.bytes.entries()]);
    expect(validateTravelContextReleaseManifest(first.manifest).ok).toBe(true);
    expect(first.manifest.layers.map((layer) => layer.id)).toEqual(["buildings", "restaurants", "statistical-areas", "parks", "landmarks"]);
    expect(first.manifest.coverage.replayStable).toBe(true);
  });

  it("fails closed for unsafe paths, nonzero accounting, and invalid approval", () => {
    const fixture = buildSyntheticTravelContextRelease();
    const unsafe = { ...fixture.manifest, geometryShards: fixture.manifest.geometryShards.map((shard, index) => index === 0 ? { ...shard, relativeContentRef: "../escape.json" } : shard) };
    expect(validateTravelContextReleaseManifest(unsafe).ok).toBe(false);
    const remainder = { ...fixture.manifest, coverage: { ...fixture.manifest.coverage, replayStable: false } };
    expect(validateTravelContextReleaseManifest(remainder).ok).toBe(false);
    const approval = { ...fixture.manifest, approval: { ...fixture.manifest.approval, fingerprintSha256: "bad" } };
    expect(validateTravelContextReleaseManifest(approval).ok).toBe(false);
  });

  it("normalizes exact/source identifiers and chooses the smallest complete prefix", () => {
    expect(normalizeTravelContextQuery("NTA-Éast / 2020")).toBe("nta east 2020");
    expect(isTravelContextExactIdentifier("LP-0219")).toBe(true);
    expect(isTravelContextExactIdentifier("GISPROPNUM GI0001")).toBe(true);
    expect(isTravelContextExactIdentifier("not an id")).toBe(false);
    expect(selectTravelContextSearchPrefixes([
      { prefix: "ea", summaryCount: 50, byteSize: 500 },
      { prefix: "ny", summaryCount: 2, byteSize: 50 },
      { prefix: "lp", summaryCount: 4, byteSize: 100 },
    ], "east park")).toEqual([]);
    expect(selectTravelContextSearchPrefixes([
      { prefix: "lp", summaryCount: 4, byteSize: 100 },
      { prefix: "pa", summaryCount: 2, byteSize: 50 },
    ], "park")).toEqual(["pa"]);
  });

  it("orders overlap candidates deterministically and keeps kind semantics", () => {
    const ordered = stableTravelContextOverlapCandidates([
      { canonicalId: "building", layerId: "buildings", kind: "building", label: "Same", priority: 40 },
      { canonicalId: "lpc", layerId: "landmarks", kind: "landmark-record", label: "Same", priority: 10 },
      { canonicalId: "park", layerId: "parks", kind: "park", label: "Same", priority: 20 },
    ]);
    expect(ordered.map((item) => item.canonicalId)).toEqual(["lpc", "park", "building"]);
    expect(ordered[0]?.kind).toBe("landmark-record");
  });
});
