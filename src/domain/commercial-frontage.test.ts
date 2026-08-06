import { describe, expect, it } from "vitest";
import { BLOCK_835_DOITT_IDS, deriveFacadeSegments, matchTenantToBuilding, normalizeCommercialName, placementForPoint, stableCommercialJson } from "./commercial-frontage";

const buildings = [
  { canonicalBuildingId: "doitt:39969", doittId: "39969", bin: "1083635", bbl: "1008350056", name: "Building 39969", geometry: { type: "Polygon" as const, coordinates: [] }, footprint: [[-73.99, 40.75], [-73.989, 40.75], [-73.989, 40.751], [-73.99, 40.751]], centroid: [-73.9895, 40.7505] as [number, number], heightMeters: 23, roofBasis: "oti-height-roof" as const },
  { canonicalBuildingId: "doitt:147902", doittId: "147902", bin: "1083636", bbl: "1008350056", name: "Building 147902", geometry: { type: "Polygon" as const, coordinates: [] }, footprint: [[-73.988, 40.75], [-73.987, 40.75], [-73.987, 40.751], [-73.988, 40.751]], centroid: [-73.9875, 40.7505] as [number, number], heightMeters: 23, roofBasis: "oti-height-roof" as const },
] as const;

describe("commercial frontage contracts", () => {
  it("keeps the exact sorted 14-parent allowlist and stable serialization", () => {
    expect(BLOCK_835_DOITT_IDS).toHaveLength(14);
    expect([...BLOCK_835_DOITT_IDS]).toEqual([...BLOCK_835_DOITT_IDS].sort((a, b) => Number(a) - Number(b)));
    expect(stableCommercialJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it("normalizes comparison names without overwriting raw display values", () => {
    expect(normalizeCommercialName("  Café & Co., LLC ")).toBe("café");
    expect(normalizeCommercialName("A/B")).toBe("a b");
  });

  it("preserves duplicate-BBL identity and resolves only explicit unique BIN", () => {
    const exact = matchTenantToBuilding({ longitude: -73.9895, latitude: 40.7505, bin: "1083635", bbl: "1008350056", sourceId: "dcwp:1", source: "dcwp" }, buildings);
    expect(exact.decision).toBe("exact");
    expect(exact.canonicalBuildingId).toBe("doitt:39969");
    const ambiguous = matchTenantToBuilding({ longitude: -73.9875, latitude: 40.7505, bbl: "1008350056", sourceId: "osm:node:1@1", source: "osm" }, buildings);
    expect(ambiguous.decision).toBe("ambiguous");
    expect(ambiguous.canonicalBuildingId).toBeNull();
  });

  it("attaches a point-only POI only to a unique footprint or facade", () => {
    const inside = matchTenantToBuilding({ longitude: -73.9895, latitude: 40.7505, sourceId: "osm:node:inside@1", source: "osm" }, buildings);
    expect(inside.decision).toBe("high");
    expect(inside.canonicalBuildingId).toBe("doitt:39969");
    const outside = matchTenantToBuilding({ longitude: -73.9800, latitude: 40.7400, sourceId: "osm:node:outside@1", source: "osm" }, buildings);
    expect(outside.decision).toBe("rejected");
    expect(outside.canonicalBuildingId).toBeNull();
  });

  it("requires ground-floor and separated facade evidence for signs", () => {
    const building = buildings[0]!;
    const segments = deriveFacadeSegments(building);
    expect(segments.length).toBeGreaterThan(0);
    const point: [number, number] = [(segments[0]!.start[0] + segments[0]!.end[0]) / 2, (segments[0]!.start[1] + segments[0]!.end[1]) / 2];
    const placement = placementForPoint({ storefrontId: "storefront:1", tenantId: "tenant:1", building, point, groundFloorEvidence: true, evidenceIds: ["osm:node:1@2"], otherPlacements: [], sourceKind: "osm" });
    expect(placement.placementDecision).toBe("storefront-exact");
    expect(placement.signPolicy).toBe("neutral-text-only");
    const unknown = placementForPoint({ storefrontId: "storefront:2", tenantId: null, building, point, groundFloorEvidence: false, evidenceIds: [], otherPlacements: [], sourceKind: "nyc" });
    expect(unknown.placementDecision).toBe("metadata-only");
    expect(unknown.signPolicy).toBe("none");
  });
});
