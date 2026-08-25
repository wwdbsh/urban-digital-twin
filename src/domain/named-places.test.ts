import { describe, expect, it } from "vitest";

import {
  GROUND_FEATURE_URL_PARAM,
  NAMED_PLACES,
  boundsIntersect,
  groundTargetForPose,
  namedPlace,
  namedPlaceDeepLink,
  namedPlaceForFeatureId,
  poseViewFootprint,
  searchNamedPlaces,
} from "./named-places.ts";
import { parseNavigationUrl } from "./visitor-navigation.ts";

const BASE = "https://twin.invalid/";

describe("named place registry", () => {
  it("binds each place to exactly one canonical identity", () => {
    expect(NAMED_PLACES.length).toBeGreaterThan(0);
    expect(new Set(NAMED_PLACES.map((place) => place.placeKey)).size).toBe(NAMED_PLACES.length);
    expect(new Set(NAMED_PLACES.map((place) => place.canonicalFeatureId)).size).toBe(NAMED_PLACES.length);
    for (const place of NAMED_PLACES) {
      expect(namedPlace(place.placeKey)).toBe(place);
      expect(namedPlaceForFeatureId(place.canonicalFeatureId)).toBe(place);
      // A referenced-existing identity keeps the civic id it reuses; a
      // ground-owned identity is content-addressed under `udt:ground`.
      if (place.identityOrigin === "referenced-existing") expect(place.canonicalFeatureId).toMatch(/^udt:manhattan:[a-z]+:[A-Za-z0-9._-]+$/u);
      else expect(place.canonicalFeatureId).toMatch(/^udt:ground:manhattan:[a-z]+:[0-9a-f]{16}$/u);
      expect(place.expectedClasses).toContain(place.groundClass);
      expect(place.sourceRecordId).not.toBe("");
      expect(place.displayNameField).not.toBe("");
    }
  });

  it("throws rather than guessing for an unknown key", () => {
    // @ts-expect-error the registry is a closed set, and asking for a place
    // outside it must fail loudly instead of resolving to a nearby feature.
    expect(() => namedPlace("battery-park")).toThrow(/Unknown named place/u);
    expect(namedPlaceForFeatureId("udt:manhattan:park:M283")).toBeNull();
  });

  it("never presents an unsourced display name", () => {
    for (const place of NAMED_PLACES) {
      if (place.displayName === place.sourceDisplayName) expect(place.displayNameNote).toBeUndefined();
      // Anything that is not byte-identical to the source string must say why.
      else expect(place.displayNameNote).toBeTruthy();
      expect(place.displayName.toLocaleLowerCase("en-US")).toBe(place.sourceDisplayName.toLocaleLowerCase("en-US"));
    }
  });

  /**
   * THE BATTERY NAMING TRAP, closed in a test so it cannot be reopened.
   *
   * NYC Parks has no property literally named "Battery Park". M005 is "The
   * Battery"; M283 is "Battery Park City", a different property. The registry
   * ships neither an invented "Battery Park" alias nor M283.
   */
  it("ships The Battery, not Battery Park or Battery Park City", () => {
    const battery = namedPlace("the-battery");
    expect(battery.canonicalFeatureId).toBe("udt:manhattan:park:M005");
    expect(battery.displayName).toBe("The Battery");
    expect(battery.sourceDisplayName).toBe("The Battery");
    expect(NAMED_PLACES.some((place) => place.canonicalFeatureId.endsWith("M283"))).toBe(false);
    expect(NAMED_PLACES.map((place) => place.displayName)).not.toContain("Battery Park");
    expect(searchNamedPlaces("Battery Park City")).toEqual([]);
    expect(searchNamedPlaces("battery").map((match) => match.place.placeKey)).toEqual(["the-battery"]);
  });
});

describe("named place deep links", () => {
  it("round-trips the pose and the ground selection", () => {
    for (const place of NAMED_PLACES) {
      const link = namedPlaceDeepLink(place, BASE);
      const parsed = parseNavigationUrl(link);
      expect(parsed.cameraMode).toBe("explore");
      expect(parsed.poseInvalid).toBe(false);
      expect(parsed.pose).toEqual(place.pose);
      expect(parsed.featureId).toBeNull();
      expect(new URL(link).searchParams.get(GROUND_FEATURE_URL_PARAM)).toBe(place.canonicalFeatureId);
    }
  });

  it("writes the pose in the canonical six-decimal form", () => {
    const link = namedPlaceDeepLink(namedPlace("times-square"), BASE);
    const params = new URL(link).searchParams;
    for (const key of ["lon", "lat", "height", "heading", "pitch", "roll"]) {
      expect(params.get(key)).toMatch(/^-?\d+\.\d{6}$/u);
    }
  });

  it("pins nothing it does not need", () => {
    // No catalog release, and no `ground` token: the ground layer is default-on
    // and loads independently of data mode, so either would put a second,
    // unrelated release into a link that asks for one surface.
    for (const place of NAMED_PLACES) {
      const params = new URL(namedPlaceDeepLink(place, BASE)).searchParams;
      expect(params.get("data")).toBeNull();
      expect(params.get("release")).toBeNull();
      expect(params.get("ground")).toBeNull();
      expect(params.get("zoneImagery")).toBeNull();
    }
  });
});

describe("pose framing geometry", () => {
  it("targets the camera position itself only at nadir", () => {
    const nadir = groundTargetForPose({ longitude: -73.98, latitude: 40.75, height: 900, heading: 0, pitch: -90, roll: 0 });
    expect(nadir.longitude).toBeCloseTo(-73.98, 9);
    expect(nadir.latitude).toBeCloseTo(40.75, 9);
  });

  it("walks the target forward along the heading by height / tan(pitch)", () => {
    // 45 degrees puts the target exactly one height ahead: 1000 m north is
    // 1000 / 111320 degrees of latitude.
    const target = groundTargetForPose({ longitude: -73.98, latitude: 40.75, height: 1_000, heading: 0, pitch: -45, roll: 0 });
    expect(target.longitude).toBeCloseTo(-73.98, 9);
    expect(target.latitude).toBeCloseTo(40.75 + 1_000 / 111_320, 6);
    const eastward = groundTargetForPose({ longitude: -73.98, latitude: 40.75, height: 1_000, heading: 90, pitch: -45, roll: 0 });
    expect(eastward.latitude).toBeCloseTo(40.75, 6);
    expect(eastward.longitude).toBeGreaterThan(-73.98);
  });

  it("keeps the ground target inside the footprint it derives", () => {
    for (const place of NAMED_PLACES) {
      const target = groundTargetForPose(place.pose);
      const footprint = poseViewFootprint(place.pose);
      expect(target.longitude).toBeGreaterThan(footprint.west);
      expect(target.longitude).toBeLessThan(footprint.east);
      expect(target.latitude).toBeGreaterThan(footprint.south);
      expect(target.latitude).toBeLessThan(footprint.north);
    }
  });

  it("rejects boxes that only touch on one axis", () => {
    const left = { west: 0, south: 0, east: 1, north: 1 };
    expect(boundsIntersect(left, { west: 0.5, south: 0.5, east: 2, north: 2 })).toBe(true);
    expect(boundsIntersect(left, { west: 2, south: 0.5, east: 3, north: 2 })).toBe(false);
    expect(boundsIntersect(left, { west: 0.5, south: 2, east: 2, north: 3 })).toBe(false);
  });
});

describe("named place search", () => {
  it("finds the ground-owned places that no catalog carries", () => {
    expect(searchNamedPlaces("Times Square").map((match) => match.place.placeKey)).toEqual(["times-square"]);
    expect(searchNamedPlaces("Hudson River").map((match) => match.place.placeKey)).toEqual(["hudson-river"]);
    expect(searchNamedPlaces("East River").map((match) => match.place.placeKey)).toEqual(["east-river"]);
  });

  it("matches the source spelling, the canonical id and the source record id", () => {
    expect(searchNamedPlaces("HUDSON RIVER")[0]?.place.placeKey).toBe("hudson-river");
    expect(searchNamedPlaces("udt:ground:manhattan:plaza:24aeb72178ec5bd0")[0]?.matchedBy).toBe("id");
    expect(searchNamedPlaces("M098")[0]?.place.placeKey).toBe("washington-square-park");
  });

  it("is deterministic, prefix-friendly and empty for an empty query", () => {
    expect(searchNamedPlaces("")).toEqual([]);
    expect(searchNamedPlaces("   ")).toEqual([]);
    expect(searchNamedPlaces("park").map((match) => match.place.placeKey)).toEqual(searchNamedPlaces("park").map((match) => match.place.placeKey));
    expect(searchNamedPlaces("park").map((match) => match.place.placeKey)).toEqual(["bryant-park", "central-park", "washington-square-park"]);
    expect(searchNamedPlaces("zzz")).toEqual([]);
  });
});
