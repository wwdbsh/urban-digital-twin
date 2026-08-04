import { describe, expect, it } from "vitest";
import { DEFAULT_CAMERA_POSE, navigationUrl, normalizeCameraPose, parseNavigationUrl, saveJourney, savePlace, loadSavedNavigation, VISITOR_NAVIGATION_SCHEMA_VERSION, VISITOR_NAVIGATION_STORAGE_KEY, stepIndex } from "./visitor-navigation";

const featureIds = new Set(["place:one", "place:two"]);
const storage = (value: string | null) => ({ value, getItem() { return this.value; }, setItem(_key: string, next: string) { this.value = next; } });

describe("visitor navigation contracts", () => {
  it("round trips clamped camera poses with feature/query state", () => {
    const url = navigationUrl({ featureId: "place:one", query: "카페 서울", cameraMode: "overview", pose: { ...DEFAULT_CAMERA_POSE, longitude: 190, latitude: -100, height: 1, heading: -30, pitch: 20, roll: 500 }, poseInvalid: false }, "https://fixture.invalid/explore");
    expect(parseNavigationUrl(url)).toEqual({ featureId: "place:one", query: "카페 서울", cameraMode: "overview", pose: { longitude: 180, latitude: -90, height: 80, heading: 330, pitch: 0, roll: 180 }, poseInvalid: false });
    const cameraOnly = navigationUrl({ featureId: null, query: "", cameraMode: "explore", pose: DEFAULT_CAMERA_POSE, poseInvalid: false }, "https://fixture.invalid/explore");
    expect(parseNavigationUrl(cameraOnly).featureId).toBeNull();
  });

  it("round trips an explicit real release and keeps legacy feature links fixture-compatible", () => {
    const url = navigationUrl({ featureId: "real:place:donut-pub", query: "DONUT PUB", cameraMode: "explore", pose: null, poseInvalid: false, dataMode: "real-pilot", releaseId: "real-wave-20260804" }, "https://fixture.invalid/explore");
    expect(new URL(url).searchParams.get("data")).toBe("real-wave-20260804");
    expect(new URL(url).searchParams.get("release")).toBe("real-wave-20260804");
    expect(parseNavigationUrl(url)).toMatchObject({ dataMode: "real-pilot", releaseId: "real-wave-20260804", featureId: "real:place:donut-pub" });
    expect(parseNavigationUrl("https://fixture.invalid/explore?feature=fixture:one")).not.toHaveProperty("dataMode");
    expect(parseNavigationUrl("https://fixture.invalid/explore?data=real-wave-missing&feature=real:place:donut-pub")).toMatchObject({ dataMode: "real-pilot", releaseId: "real-wave-missing" });
    expect(parseNavigationUrl("https://fixture.invalid/explore?data=unknown-release&release=unknown-release")).toMatchObject({ dataMode: "real-pilot", releaseId: "unknown-release" });
  });

  it("fails closed on malformed or partial poses", () => {
    expect(parseNavigationUrl("https://fixture.invalid/?feature=place:one&lon=bad&lat=40&height=500&heading=0&pitch=-45&roll=0").pose).toBeNull();
    expect(parseNavigationUrl("https://fixture.invalid/?lon=1&lat=2").poseInvalid).toBe(true);
    expect(normalizeCameraPose(DEFAULT_CAMERA_POSE)).toEqual(DEFAULT_CAMERA_POSE);
  });

  it("guards itinerary step navigation at both ends", () => {
    expect(stepIndex(0, "previous", 3)).toBe(0);
    expect(stepIndex(0, "next", 3)).toBe(1);
    expect(stepIndex(2, "next", 3)).toBe(2);
    expect(stepIndex(99, "focus", 3)).toBe(2);
    expect(stepIndex(0, "next", 0)).toBe(0);
  });

  it("recovers corrupt/versioned storage, removes stale IDs, and deduplicates", () => {
    const invalid = storage("not-json");
    expect(loadSavedNavigation(invalid, featureIds).places).toEqual([]);
    const state = { schemaVersion: VISITOR_NAVIGATION_SCHEMA_VERSION, places: [{ schemaVersion: VISITOR_NAVIGATION_SCHEMA_VERSION, canonicalId: "place:two", label: "Two", savedAt: "2026-01-02" }, { schemaVersion: VISITOR_NAVIGATION_SCHEMA_VERSION, canonicalId: "stale", label: "Stale", savedAt: "2026-01-01" }, { schemaVersion: VISITOR_NAVIGATION_SCHEMA_VERSION, canonicalId: "place:two", label: "New Two", savedAt: "2026-01-03" }], journeys: [{ schemaVersion: VISITOR_NAVIGATION_SCHEMA_VERSION, id: "journey:1", originFeatureId: "place:one", destinationFeatureId: "stale", mode: "walking" as const, label: "bad", savedAt: "2026-01-01" }] };
    const loaded = loadSavedNavigation(storage(JSON.stringify(state)), featureIds);
    expect(loaded.places).toHaveLength(1);
    expect(loaded.places[0]?.label).toBe("New Two");
    expect(loaded.journeys).toEqual([]);
    const saved = savePlace({ schemaVersion: VISITOR_NAVIGATION_SCHEMA_VERSION, places: [], journeys: [] }, { schemaVersion: VISITOR_NAVIGATION_SCHEMA_VERSION, canonicalId: "place:one", label: "One", savedAt: "2026-01-01" });
    expect(saveJourney(saved, { schemaVersion: VISITOR_NAVIGATION_SCHEMA_VERSION, id: "journey:1", originFeatureId: "place:one", destinationFeatureId: "place:two", mode: "walking", label: "One → Two", savedAt: "2026-01-01" }).journeys[0]?.id).toBe("journey:1");
    expect(VISITOR_NAVIGATION_STORAGE_KEY).toContain("visitor-navigation");
  });
});
