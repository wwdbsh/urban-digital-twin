// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runtimeFixtureFeatures } from "../domain/features";
import type { Feature } from "../domain/schema";
import type { CameraPose } from "../domain/visitor-navigation";
import type { CommercialStorefrontPlacement, LoadedExteriorPilotRelease } from "../runtime/exterior-pilot-release";

const exteriorRuntimeMocks = vi.hoisted(() => ({
  loadExteriorPilotRelease: vi.fn(),
}));

vi.mock("../features/explorer/CesiumViewport", async () => {
  const React = await import("react");

  type MockProps = {
    adapter: { getFeatures: () => Feature[] };
    focusRequest: number;
    focusFeatureId: string | null;
    focusOverlayOpen?: boolean;
    cameraPoseRequest?: { longitude: number; latitude: number; height: number; heading: number; pitch: number; roll: number; requestId: number };
    onFeatureSelected?: (feature: Feature) => void;
    onCameraChanged?: (camera: CameraPose) => void;
    onStorefrontSelected?: (placement: CommercialStorefrontPlacement) => void;
  };

  const MockCesiumViewport = ({ adapter, focusRequest, focusFeatureId, focusOverlayOpen, cameraPoseRequest, onFeatureSelected, onCameraChanged, onStorefrontSelected }: MockProps) => {
    const [cameraCallbackSetupCount, setCameraCallbackSetupCount] = React.useState(0);
    React.useEffect(() => { setCameraCallbackSetupCount((count) => count + 1); }, [onCameraChanged]);
    const locatedFeature = adapter.getFeatures().find((feature) => feature.kind === "poi") ?? adapter.getFeatures()[0]!;
    const locationlessFeature: Feature = {
      ...locatedFeature,
      id: `${locatedFeature.id}:locationless-test`,
      name: "Locationless test record",
      attributes: { ...locatedFeature.attributes, civicNoMarker: true },
    };
    return React.createElement(
      "div",
      {
        className: "viewport",
        "data-focus-request": focusRequest,
        "data-focus-feature-id": focusFeatureId ?? "",
        "data-focus-overlay-open": focusOverlayOpen ? "true" : "false",
        "data-camera-pose-request": cameraPoseRequest ? `${cameraPoseRequest.longitude},${cameraPoseRequest.latitude},${cameraPoseRequest.height},${cameraPoseRequest.pitch},${cameraPoseRequest.requestId}` : "",
        "data-camera-callback-setup-count": cameraCallbackSetupCount,
      },
      React.createElement("button", { type: "button", onClick: () => onFeatureSelected?.(locatedFeature) }, "Mock located pick"),
      React.createElement("button", { type: "button", onClick: () => onFeatureSelected?.(locationlessFeature) }, "Mock locationless pick"),
      React.createElement("button", { type: "button", onClick: () => onStorefrontSelected?.({ canonicalBuildingId: locatedFeature.id, storefrontId: "storefront:osm:node:10908810995@1" } as CommercialStorefrontPlacement) }, "Mock storefront pick"),
      React.createElement("button", { type: "button", onClick: () => onCameraChanged?.({ longitude: -73.99, latitude: 40.748, height: 900, heading: 15, pitch: -45, roll: 0 }) }, "Mock camera update"),
    );
  };

  return {
    CesiumViewport: MockCesiumViewport,
    medianFrameInterval: (values: readonly number[]) => values.length === 0 ? null : values[0] ?? null,
    shouldFocusFeature: (feature: Pick<Feature, "attributes"> | null | undefined) => Boolean(feature && feature.attributes.civicNoMarker !== true && feature.attributes.citywideNoMarker !== true),
  };
});

vi.mock("../runtime/exterior-pilot-release", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, loadExteriorPilotRelease: exteriorRuntimeMocks.loadExteriorPilotRelease };
});

import { App, applyStorefrontResolution, isCurrentStorefrontResolution, overlayLayoutPolicy, preserveFeatureSequence, resolveStorefrontBuilding, selectionFocusTransaction, type StorefrontResolutionState } from "./App";
import { navigationUrl, parseNavigationUrl } from "../domain/visitor-navigation";

const initialTestUrl = window.location.href;
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function exteriorOverlayFixture(assetFailures: LoadedExteriorPilotRelease["assetFailures"] = []): LoadedExteriorPilotRelease {
  return {
    document: { commercialRelease: { totals: { acceptedSigns: 8 } } },
    manifest: { assets: [] },
    resolver: {},
    verifiedContentRefs: new Set(),
    assetFailures,
    diagnostics: { overlay: "active", reason: null, assetFailures: [...assetFailures], buildingFallbacks: [...new Set(assetFailures.map((failure) => failure.canonicalFeatureId))], acceptedStorefronts: 8, unknownStorefronts: 72, ambiguousStorefronts: 12 },
    compatibleWith: () => true,
    resolve: () => ({ kind: "procedural-fallback", featureId: "doitt:778052", diagnostic: { message: "Fixture fallback" } }),
    buildingEntry: () => undefined,
    commercialForBuilding: () => ({ canonicalBuildingId: "doitt:778052", visualEvidenceLevel: "licensed-near-real", claim: "Fixture", entry: undefined, links: [], placements: [], unknownPlacements: [], acceptedPlacements: [] }),
    storefront: () => undefined,
  } as unknown as LoadedExteriorPilotRelease;
}

beforeEach(() => {
  exteriorRuntimeMocks.loadExteriorPilotRelease.mockReset();
  exteriorRuntimeMocks.loadExteriorPilotRelease.mockResolvedValue(exteriorOverlayFixture());
});
afterEach(() => { cleanup(); window.history.replaceState({}, "", initialTestUrl); });
const locatedFeature = runtimeFixtureFeatures.find((feature) => feature.kind === "poi")!;

describe("explorer overlay policy", () => {
  it("keeps the map as the desktop main region while reserving only overlay insets", () => {
    expect(overlayLayoutPolicy(false, false)).toEqual({
      mapOwnsMainRegion: true,
      inspectorPosition: "overlay",
      desktopRightInset: "none",
      mobileBottomInset: "none",
      runtimeNoteLane: "left-control-lane",
      cameraControlsLane: "centered-control-lane",
    });
    expect(overlayLayoutPolicy(true, false)).toEqual({
      mapOwnsMainRegion: true,
      inspectorPosition: "overlay",
      desktopRightInset: "inspector-width",
      mobileBottomInset: "none",
      runtimeNoteLane: "left-control-lane",
      cameraControlsLane: "centered-control-lane",
    });
    expect(overlayLayoutPolicy(true, true)).toEqual({
      mapOwnsMainRegion: true,
      inspectorPosition: "overlay",
      desktopRightInset: "none",
      mobileBottomInset: "inspector-sheet",
      runtimeNoteLane: "left-control-lane",
      cameraControlsLane: "centered-control-lane",
    });
  });

  it("claims exactly one focus transaction for a locatable selection", () => {
    expect(selectionFocusTransaction(locatedFeature)).toEqual({ focusFeatureId: locatedFeature.id, shouldFly: true });
  });

  it("opens locationless records without claiming a camera transaction", () => {
    const locationless = { ...locatedFeature, attributes: { ...locatedFeature.attributes, civicNoMarker: true } };
    expect(selectionFocusTransaction(locationless)).toEqual({ focusFeatureId: null, shouldFly: false });
  });

  it("does not retain an ID-only sequence when a same-ID feature receives new geometry or detail content", () => {
    const revisedCoordinates: Feature["coordinates"] = [locatedFeature.coordinates[0] + 0.001, locatedFeature.coordinates[1]];
    const revised: Feature = {
      ...locatedFeature,
      name: "Revised same-ID feature",
      coordinates: revisedCoordinates,
      geometry: locatedFeature.geometry.type === "Point" ? { ...locatedFeature.geometry, coordinates: revisedCoordinates } : locatedFeature.geometry,
      attributes: { ...locatedFeature.attributes, refreshedDetail: "new-content" },
    };
    const previous = [locatedFeature];
    const retained = preserveFeatureSequence(previous, [revised]);
    expect(retained).not.toBe(previous);
    expect(retained).toEqual([revised]);
  });

  it("loads a missing canonical building before resolving a storefront selection", async () => {
    const canonical = { ...locatedFeature, id: "doitt:982383" };
    const loadCanonical = vi.fn().mockResolvedValue(canonical);
    const adapter = { getFeature: vi.fn(() => undefined) };
    await expect(resolveStorefrontBuilding({ canonicalBuildingId: canonical.id }, adapter, loadCanonical)).resolves.toBe(canonical);
    expect(loadCanonical).toHaveBeenCalledWith(canonical.id);
  });

  it("ignores a stale storefront completion after a newer storefront selection", async () => {
    const adapter = {};
    const featureA = { ...locatedFeature, id: "doitt:storefront-a" };
    const featureB = { ...locatedFeature, id: "doitt:storefront-b" };
    const pendingA = deferred<Feature | undefined>();
    const pendingB = deferred<Feature | undefined>();
    let current: StorefrontResolutionState = { requestId: 0, adapter, dataMode: "real-pilot" };
    const state: { featureId: string | null; storefrontId: string | null; url: string } = { featureId: null, storefrontId: null, url: "" };
    const begin = (storefrontId: string, resolution: Promise<Feature | undefined>) => {
      current = { requestId: current.requestId + 1, adapter, dataMode: "real-pilot" };
      const request = current;
      return applyStorefrontResolution(request, () => current, resolution, (building) => {
        state.featureId = building?.id ?? null;
        state.storefrontId = building ? storefrontId : null;
        state.url = building ? `?feature=${building.id}&storefront=${storefrontId}` : "";
      });
    };

    const first = begin("storefront:A", pendingA.promise);
    const second = begin("storefront:B", pendingB.promise);
    pendingB.resolve(featureB);
    await second;
    pendingA.resolve(featureA);
    await first;

    expect(state).toEqual({ featureId: featureB.id, storefrontId: "storefront:B", url: `?feature=${featureB.id}&storefront=storefront:B` });
  });

  it("ignores stale success and rejection after an ordinary selection invalidates the request", async () => {
    const adapter = {};
    const nextAdapter = {};
    const staleFeature = { ...locatedFeature, id: "doitt:stale-storefront" };
    const pendingSuccess = deferred<Feature | undefined>();
    let current: StorefrontResolutionState = { requestId: 1, adapter, dataMode: "real-pilot" };
    const state: { featureId: string | null; storefrontId: string | null; url: string } = { featureId: null, storefrontId: "storefront:A", url: "?feature=doitt:old&storefront=storefront:A" };
    const staleRequest = current;
    const success = applyStorefrontResolution(staleRequest, () => current, pendingSuccess.promise, (building) => {
      state.featureId = building?.id ?? null;
      state.storefrontId = building ? "storefront:A" : null;
      state.url = building ? `?feature=${building.id}&storefront=storefront:A` : "";
    });

    current = { requestId: 2, adapter: nextAdapter, dataMode: "civic-context" };
    state.featureId = "doitt:ordinary-selection";
    state.storefrontId = null;
    state.url = "?feature=doitt:ordinary-selection";
    pendingSuccess.resolve(staleFeature);
    await success;
    expect(state).toEqual({ featureId: "doitt:ordinary-selection", storefrontId: null, url: "?feature=doitt:ordinary-selection" });
    expect(isCurrentStorefrontResolution(staleRequest, current)).toBe(false);

    const pendingFailure = deferred<Feature | undefined>();
    const failingRequest = current;
    const failure = applyStorefrontResolution(failingRequest, () => current, pendingFailure.promise, () => {
      state.featureId = "doitt:should-not-commit";
      state.storefrontId = "storefront:should-not-commit";
      state.url = "?feature=doitt:should-not-commit&storefront=storefront:should-not-commit";
    });
    current = { requestId: 3, adapter: nextAdapter, dataMode: "civic-context" };
    pendingFailure.reject(new Error("stale failure"));
    await failure;
    expect(state).toEqual({ featureId: "doitt:ordinary-selection", storefrontId: null, url: "?feature=doitt:ordinary-selection" });
    expect(isCurrentStorefrontResolution(failingRequest, current)).toBe(false);
  });
});

describe("App overlay and selection regressions", () => {
  it("keeps a selected storefront in the URL after a camera update without rebuilding the viewport callback", async () => {
    const storefrontId = "storefront:osm:node:10908810995@1";
    window.history.replaceState({}, "", `/?exterior=manhattan-esb-block-exterior-pilot-20260805&commercial=1`);
    render(<App />);

    const viewport = document.querySelector<HTMLElement>(".viewport");
    expect(viewport).not.toBeNull();
    await waitFor(() => expect(viewport).toHaveAttribute("data-camera-callback-setup-count", "1"));
    fireEvent.click(screen.getByRole("button", { name: "Mock storefront pick" }));
    await waitFor(() => expect(new URL(window.location.href).searchParams.get("storefront")).toBe(storefrontId));
    const callbackSetupCount = viewport?.getAttribute("data-camera-callback-setup-count");

    fireEvent.click(screen.getByRole("button", { name: "Mock camera update" }));
    await waitFor(() => expect(new URL(window.location.href).searchParams.get("storefront")).toBe(storefrontId));
    expect(viewport).toHaveAttribute("data-camera-callback-setup-count", callbackSetupCount);
  });

  it("keeps the optional commercial overlay and storefront deep-link separate from the base release", () => {
    const url = navigationUrl({ featureId: "doitt:778052", query: "", cameraMode: "overview", pose: null, poseInvalid: false, dataMode: "civic-context", releaseId: "manhattan-civic-context-20260804", exteriorReleaseId: "manhattan-esb-block-exterior-pilot-20260805", commercial: true, storefrontId: "storefront:osm:node:1@2" }, "http://localhost/");
    const parsed = parseNavigationUrl(url);
    expect(parsed.releaseId).toBe("manhattan-civic-context-20260804");
    expect(parsed.exteriorReleaseId).toBe("manhattan-esb-block-exterior-pilot-20260805");
    expect(parsed.commercial).toBe(true);
    expect(parsed.storefrontId).toBe("storefront:osm:node:1@2");
  });

  it("requests the normalized URL pose or safe default on the first viewport render", () => {
    render(<App />);

    expect(document.querySelector(".viewport")).toHaveAttribute("data-camera-pose-request", "-73.991,40.744,4000,-75,1");
    const cameraControls = within(screen.getByRole("region", { name: "Camera controls" }));
    expect(cameraControls.getByRole("button", { name: "Overview" })).toHaveAttribute("aria-pressed", "true");
    expect(cameraControls.getByRole("button", { name: "Explore" })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps the inspector inside the map region and claims one focus request for a direct pick", async () => {
    render(<App />);

    const mapRegion = document.querySelector<HTMLElement>(".map-region");
    const viewport = document.querySelector<HTMLElement>(".viewport");
    const inspector = screen.getByRole("complementary", { name: "Selected feature details" });
    expect(mapRegion).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(mapRegion).toContainElement(viewport);
    expect(mapRegion).toContainElement(inspector);

    const requestBeforePick = Number(viewport?.getAttribute("data-focus-request"));
    fireEvent.click(screen.getByRole("button", { name: "Mock located pick" }));
    await waitFor(() => expect(viewport).toHaveAttribute("data-focus-request", String(requestBeforePick + 1)));
    expect(viewport).toHaveAttribute("data-focus-feature-id", locatedFeature.id);
  });

  it("closes details with Escape and returns focus to the located-pick trigger", async () => {
    render(<App />);

    const trigger = screen.getByRole("button", { name: "Mock located pick" });
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveFocus());

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Selected feature details" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("keeps locationless picks in details without incrementing the focus transaction", async () => {
    render(<App />);

    const viewport = document.querySelector<HTMLElement>(".viewport");
    const requestBeforePick = Number(viewport?.getAttribute("data-focus-request"));
    fireEvent.click(screen.getByRole("button", { name: "Mock locationless pick" }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Locationless test record"));
    expect(viewport).toHaveAttribute("data-focus-request", String(requestBeforePick));
    expect(viewport).toHaveAttribute("data-focus-feature-id", "");
  });

  it("starts diagnostics and directions collapsed and makes their expanded surfaces mutually exclusive", async () => {
    render(<App />);

    const diagnostics = screen.getByRole("button", { name: /Diagnostics.*Runtime health/ });
    const directions = screen.getByRole("button", { name: /Directions.*Plan a synthetic route/ });
    expect(diagnostics).toHaveAttribute("aria-expanded", "false");
    expect(directions).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(diagnostics);
    expect(diagnostics).toHaveAttribute("aria-expanded", "true");
    expect(directions).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(directions);
    await waitFor(() => expect(directions).toHaveAttribute("aria-expanded", "true"));
    expect(diagnostics).toHaveAttribute("aria-expanded", "false");
  });

  it.each([
    ["tenant-placement", "Exterior overlay manifest failed closed: commercialRelease.storefrontPlacements Accepted storefront placement must reference one canonical tenant"],
    ["odbl-partition", "Exterior overlay manifest failed closed: commercialRelease.licensePartitions.odbl-derived ODbL partition must include exact attribution"],
    ["base-compatibility", "Exterior overlay manifest failed closed: baseReleaseId Exterior release must pin an approved citywide/civic base release"],
  ])("keeps the base/civic surface usable when the %s fault fails the overlay closed", async (fault, message) => {
    exteriorRuntimeMocks.loadExteriorPilotRelease.mockRejectedValueOnce(new Error(message));
    window.history.replaceState({}, "", `/?data=citywide&release=manhattan-civic-context-20260804&exterior=manhattan-esb-block-exterior-pilot-20260805&commercial=1&exteriorFault=${fault}`);
    render(<App />);

    const status = await waitFor(() => {
      const element = document.querySelector<HTMLElement>("[data-overlay-status='failed'] [role='status']");
      expect(element).not.toBeNull();
      return element!;
    });
    expect(status).toHaveTextContent(`${message} The untouched base/civic release remains active.`);
    expect(document.querySelector(".viewport")).toBeInTheDocument();
    expect(exteriorRuntimeMocks.loadExteriorPilotRelease).toHaveBeenCalledWith(
      "/data/manhattan-esb-block-exterior-pilot-20260805/",
      expect.any(AbortSignal),
      expect.any(Function),
    );
  });

  it("keeps exactly one GLB fallback localized in the development fault journey", async () => {
    exteriorRuntimeMocks.loadExteriorPilotRelease.mockResolvedValueOnce(exteriorOverlayFixture([{
      canonicalFeatureId: "doitt:778052",
      lod: "lod0",
      relativeContentRef: "assets/manhattan-esb-block-exterior-pilot-20260805/doitt-778052__lod_0.glb",
      code: "checksum-mismatch",
      message: "Injected one-GLB response corruption; procedural building fallback remains active.",
    }]));
    window.history.replaceState({}, "", "/?data=citywide&release=manhattan-civic-context-20260804&exterior=manhattan-esb-block-exterior-pilot-20260805&commercial=1&exteriorFault=one-glb");
    render(<App />);

    const status = await waitFor(() => {
      const element = document.querySelector<HTMLElement>("[data-overlay-status='ready'] [role='status']");
      expect(element).not.toBeNull();
      return element!;
    });
    expect(status).toHaveTextContent("Exterior overlay active with 1 asset fallback; the affected building remains procedural.");
    expect(exteriorRuntimeMocks.loadExteriorPilotRelease.mock.calls[0]?.[2]).toEqual(expect.any(Function));
  });

  it("treats unsupported exteriorFault values as an inert production-equivalent query", async () => {
    window.history.replaceState({}, "", "/?data=citywide&release=manhattan-civic-context-20260804&exterior=manhattan-esb-block-exterior-pilot-20260805&commercial=1&exteriorFault=unsupported");
    render(<App />);
    await waitFor(() => expect(exteriorRuntimeMocks.loadExteriorPilotRelease).toHaveBeenCalled());
    expect(exteriorRuntimeMocks.loadExteriorPilotRelease.mock.calls[0]?.[2]).toBeUndefined();
  });
});
